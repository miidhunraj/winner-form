require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const ExcelJS = require('exceljs');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { ADMIN_USER, ADMIN_PASS } = process.env;
if (!ADMIN_USER || !ADMIN_PASS) {
  console.error('Set ADMIN_USER and ADMIN_PASS in .env');
  process.exit(1);
}

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
if (!SPREADSHEET_ID || !GOOGLE_SERVICE_ACCOUNT_JSON) {
  console.error('Set GOOGLE_SHEETS_ID and GOOGLE_SERVICE_ACCOUNT_JSON in .env');
  process.exit(1);
}

const SHEET = process.env.GOOGLE_SHEET_NAME || 'Giveaway Winners';
const ALLOW_DUP = process.env.ALLOW_DUPLICATES === 'true';
const STATUSES = ['Pending Verification', 'Verified', 'Contacted', 'Reward Processing', 'Completed', 'Rejected'];
const HEADERS = ['Submission ID', 'Timestamp', 'Full Name', 'Email', 'Primary Mobile', 'Backup Mobile', 'Age', 'Gender', 'City', 'State', 'Country', 'Giveaway Name', 'Social Platform', 'Social Username', 'Profile Link', 'Preferred Contact Method', 'Preferred Contact Time', 'Additional Notes', 'Verification Confirmed', 'Privacy Consent', 'Status', 'Winner Username'];
const WIDTHS = [14, 22, 24, 28, 15, 15, 6, 16, 16, 20, 12, 26, 14, 22, 30, 16, 16, 36, 12, 12, 22, 22];
const GENDERS = ['Male', 'Female', 'Prefer not to say', 'Other'];
const PLATFORMS = ['Instagram', 'YouTube', 'Facebook', 'X', 'Other'];
const METHODS = ['WhatsApp', 'Phone Call', 'Email'];
const TIMES = ['Morning', 'Afternoon', 'Evening', 'Anytime'];

// Serialise writes so concurrent submissions cannot race each other.
let queue = Promise.resolve();
const locked = fn => { const r = queue.then(fn); queue = r.catch(() => {}); return r; };

function getGoogleCredentials() {
  let raw = GOOGLE_SERVICE_ACCOUNT_JSON.trim();
  try {
    // Supports either plain JSON or base64-encoded JSON in deployment secrets.
    if (!raw.startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8');
    const credentials = JSON.parse(raw);
    if (!credentials.client_email || !credentials.private_key) throw new Error('Invalid service-account JSON');
    return credentials;
  } catch (err) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is invalid: ' + err.message);
  }
}

const auth = new google.auth.GoogleAuth({
  credentials: getGoogleCredentials(),
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

async function ensureSheet() {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const found = (meta.data.sheets || []).find(s => s.properties && s.properties.title === SHEET);
  if (found) return found.properties.sheetId;

  const created = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: SHEET } } }] }
  });
  return created.data.replies[0].addSheet.properties.sheetId;
}

async function ensureHeaders() {
  await ensureSheet();
  const range = `${SHEET}!A1:V1`;
  const current = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
  const values = current.data.values || [];
  if (!values.length || values[0].join('|') !== HEADERS.join('|')) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET}!A1:V1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] }
    });
    const sheetId = await ensureSheet();
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [
          { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
          { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEADERS.length }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
          { autoResizeDimensions: { dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: HEADERS.length } } }
        ]
      }
    });
  }
}

async function getRows() {
  await ensureHeaders();
  const result = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET}!A2:V` });
  return result.data.values || [];
}

const rowToObj = row => Object.fromEntries(HEADERS.map((h, i) => [h, row[i] ?? '']));

async function appendWinner(values) {
  await ensureHeaders();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET}!A:V`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] }
  });
}

async function updateStatusById(id, status) {
  await ensureHeaders();
  const rows = await getRows();
  const index = rows.findIndex(r => r[0] === id);
  if (index === -1) return false;
  const sheetRow = index + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET}!U${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[status]] }
  });
  return true;
}

// ---------- Validation & sanitising ----------
const clean = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/[<>]/g, '').trim().slice(0, max);
const xl = s => (/^[=+\-@]/.test(s) ? "'" + s : s);
const mobile = /^[6-9]\d{9}$/;

function validate(b) {
  const d = {
    fullName: clean(b.fullName, 100), email: clean(b.email, 120).toLowerCase(),
    primaryMobile: clean(b.primaryMobile, 10), backupMobile: clean(b.backupMobile, 10),
    age: clean(b.age, 3), gender: clean(b.gender, 30), city: clean(b.city, 80), state: clean(b.state, 60),
    country: clean(b.country, 60) || 'India', campaign: clean(b.campaign, 120), winnerUsername: clean(b.winnerUsername, 80),
    platform: clean(b.platform, 20), social: clean(b.social, 200), contactMethod: clean(b.contactMethod, 20),
    contactTime: clean(b.contactTime, 20), notes: clean(b.notes, 500),
  };
  const e = {};
  if (d.fullName.length < 2) e.fullName = 'Enter your full name';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) e.email = 'Enter a valid email address';
  if (!mobile.test(d.primaryMobile)) e.primaryMobile = 'Enter a valid 10-digit Indian mobile number';
  if (d.backupMobile && !mobile.test(d.backupMobile)) e.backupMobile = 'Enter a valid 10-digit mobile number';
  else if (d.backupMobile && d.backupMobile === d.primaryMobile) e.backupMobile = 'Backup number must be different from the primary number';
  if (d.age && !(Number(d.age) >= 13 && Number(d.age) <= 100)) e.age = 'Enter an age between 13 and 100';
  if (d.gender && !GENDERS.includes(d.gender)) e.gender = 'Choose one of the options';
  if (d.platform && !PLATFORMS.includes(d.platform)) e.platform = 'Choose one of the options';
  if (!d.campaign) e.campaign = 'Enter the giveaway or campaign name';
  if (!METHODS.includes(d.contactMethod)) e.contactMethod = 'Choose how we should contact you';
  if (d.contactTime && !TIMES.includes(d.contactTime)) e.contactTime = 'Choose one of the options';
  if (b.verified !== true) e.verified = 'Please confirm your information is accurate';
  if (b.consent !== true) e.consent = 'Please accept to continue';
  return { d, e };
}

// ---------- App ----------
const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ['https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"]
} } }));
const origins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
if (origins.length) app.use('/api', cors({ origin: origins, methods: ['GET', 'POST', 'PATCH'] }));
app.use(express.json({ limit: '20kb' }));

const safeEq = (a, b) => { const x = crypto.createHash('sha256').update(a).digest(), y = crypto.createHash('sha256').update(b).digest(); return crypto.timingSafeEqual(x, y); };
function adminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Basic ')) {
    const [u, ...p] = Buffer.from(header.slice(6), 'base64').toString().split(':');
    if (safeEq(u || '', ADMIN_USER) && safeEq(p.join(':') || '', ADMIN_PASS)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Admin"').status(401).send('Authentication required');
}

const submitLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please try again in a few minutes.' } });
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });

app.get('/api/health', async (req, res) => {
  try { await ensureHeaders(); res.json({ ok: true, storage: 'google-sheets' }); }
  catch (err) { console.error('Health check:', err); res.status(503).json({ ok: false, storage: 'google-sheets' }); }
});

app.post('/api/giveaway/submit', submitLimiter, async (req, res) => {
  try {
    const b = req.body || {};
    if (b.website) return res.json({ ok: true, submissionId: 'GW-' + crypto.randomBytes(3).toString('hex').toUpperCase() });
    const { d, e } = validate(b);
    if (Object.keys(e).length) return res.status(422).json({ errors: e });

    const id = await locked(async () => {
      const rows = await getRows();
      if (!ALLOW_DUP && rows.some(r => String(r[3]).toLowerCase() === d.email && String(r[4]) === d.primaryMobile)) return null;
      const used = new Set(rows.map(r => r[0]));
      let sid; do sid = 'GW-' + crypto.randomBytes(3).toString('hex').toUpperCase(); while (used.has(sid));
      const isUrl = /^https?:\/\//i.test(d.social);
      const values = [sid, new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC', xl(d.fullName), xl(d.email), d.primaryMobile, d.backupMobile,
        d.age ? Number(d.age) : '', d.gender, xl(d.city), d.state, xl(d.country), xl(d.campaign), d.platform, isUrl ? '' : xl(d.social), isUrl ? xl(d.social) : '',
        d.contactMethod, d.contactTime, xl(d.notes), 'Yes', 'Yes', 'Pending Verification', xl(d.winnerUsername)];
      await appendWinner(values);
      return sid;
    });

    if (!id) return res.status(409).json({ error: 'A submission with this email and mobile number already exists.' });
    res.status(201).json({ ok: true, submissionId: id });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});

async function buildExcel() {
  const rows = await getRows();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(HEADERS).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5B3DF5' } };
  WIDTHS.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  for (const row of rows) ws.addRow(row);
  ws.autoFilter = { from: 'A1', to: { row: 1, column: HEADERS.length } };
  return wb;
}

app.get('/api/giveaway/export', adminLimiter, adminAuth, async (req, res) => {
  try {
    await queue;
    const wb = await buildExcel();
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="giveaway-winners.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not export Excel file.' }); }
});

app.get('/api/admin/winners', adminLimiter, adminAuth, async (req, res) => {
  try {
    const rows = await locked(getRows);
    res.json({ winners: rows.map(rowToObj).reverse(), statuses: STATUSES });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load winners.' }); }
});

app.patch('/api/admin/winners/:id/status', adminLimiter, adminAuth, async (req, res) => {
  const status = req.body?.status;
  if (!STATUSES.includes(status)) return res.status(422).json({ error: 'Invalid status' });
  try {
    const ok = await locked(() => updateStatusById(req.params.id, status));
    ok ? res.json({ ok: true }) : res.status(404).json({ error: 'Not found' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not update status.' }); }
});

app.get('/admin', adminAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
