# Giveaway Winner Form — Production Setup

## Google Sheets

1. Create a Google Spreadsheet.
2. Share it with the backend service account as Editor.
3. Copy the Spreadsheet ID into `.env`.
4. The backend can use the `Giveaway Winners` worksheet.
5. If you want to create the headings manually/automatically from Sheets, open:
   `google-apps-script/Code.gs`
   and run `createGiveawayHeadings()` once.

## Environment variables

Copy `.env.example` to `.env` and configure your production values.

Never commit `.env` or service-account credentials.

## Local run

```bash
npm install
npm start
```

Then open:

http://localhost:3000

Health check:

http://localhost:3000/api/health

Admin:

http://localhost:3000/admin
