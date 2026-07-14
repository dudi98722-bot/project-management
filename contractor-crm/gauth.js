// טעינת פרטי חשבון השירות של גוגל (משותף ל-Drive ול-Sheets)
const fs = require('fs');

function loadServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  try {
    if (raw && raw.trim().startsWith('{')) return JSON.parse(raw);
    if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('Google auth: bad service account JSON:', e.message);
  }
  return null;
}

module.exports = { loadServiceAccount };
