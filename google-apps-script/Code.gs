/**
 * Giveaway Winners - Google Sheets setup helper
 *
 * Run createGiveawayHeadings() once from Extensions -> Apps Script.
 * It creates the "Giveaway Winners" worksheet, headings, filter and frozen header.
 */
function createGiveawayHeadings() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = "Giveaway Winners";

  let sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }

  const headings = [
    "Submission ID",
    "Timestamp",
    "Full Name",
    "Email",
    "Primary Mobile",
    "Backup Mobile",
    "Age",
    "Gender",
    "City",
    "State",
    "Country",
    "Giveaway Name",
    "Social Media Platform",
    "Social Media Username",
    "Profile Link",
    "Preferred Contact Method",
    "Preferred Contact Time",
    "Additional Notes",
    "Verification Confirmed",
    "Privacy Consent",
    "Status"
  ];

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headings.length).setValues([headings]);
  } else {
    const existing = sheet.getRange(1, 1, 1, headings.length).getValues()[0];
    const hasHeader = existing.some(value => String(value).trim() !== "");

    if (!hasHeader) {
      sheet.getRange(1, 1, 1, headings.length).setValues([headings]);
    }
  }

  const header = sheet.getRange(1, 1, 1, headings.length);
  header
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");

  sheet.setFrozenRows(1);

  if (sheet.getFilter()) {
    sheet.getFilter().remove();
  }

  const rows = Math.max(sheet.getLastRow(), 1);
  sheet.getRange(1, 1, rows, headings.length).createFilter();

  for (let i = 1; i <= headings.length; i++) {
    sheet.autoResizeColumn(i);
  }

  SpreadsheetApp.flush();
  Logger.log("Giveaway Winners headings created successfully.");
}
