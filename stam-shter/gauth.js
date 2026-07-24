// טעינת חשבון השירות של גוגל — מקובץ או ממשתנה סביבה.
// אם אין — מחזיר null, והגיבוי לשיטס פשוט לא פעיל.
const fs = require('fs');
const path = require('path');

let cached = null, tried = false;

function loadServiceAccount() {
  if (tried) return cached;
  tried = true;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  try {
    if (raw && raw.trim().startsWith('{')) {
      cached = JSON.parse(raw);
    } else if (file) {
      const p = path.isAbsolute(file) ? file : path.join(__dirname, file);
      if (fs.existsSync(p)) cached = JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (e) {
    console.error('⚠️ טעינת חשבון השירות של גוגל נכשלה:', e.message);
    cached = null;
  }
  return cached;
}

module.exports = { loadServiceAccount };
