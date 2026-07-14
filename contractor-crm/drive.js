// העלאת חשבוניות ל-Google Drive, עם נפילה חזרה (fallback) לאחסון מקומי.
// אם לא הוגדרו פרטי חשבון שירות + תיקיית יעד - הקובץ נשמר מקומית תחת uploads/.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadServiceAccount } = require('./gauth');

const UPLOAD_DIR = path.join(__dirname, 'uploads');

function ensureLocalDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// שם קובץ בלתי ניתן לניחוש (מונע ספירה/גישה לקישורים של אחרים), שומר סיומת בטוחה בלבד
function safeName(name) {
  const m = /\.([a-zA-Z0-9]{1,8})$/.exec(name || '');
  const ext = m ? '.' + m[1].toLowerCase() : '';
  return crypto.randomUUID() + ext;
}

function driveConfigured() {
  return !!(process.env.DRIVE_FOLDER_ID && loadServiceAccount());
}

async function uploadToDrive(buffer, filename, mimetype) {
  const { google } = require('googleapis');
  const creds = loadServiceAccount();
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive.file']
  });
  const drive = google.drive({ version: 'v3', auth });
  const { Readable } = require('stream');
  const res = await drive.files.create({
    requestBody: { name: filename, parents: [process.env.DRIVE_FOLDER_ID] },
    media: { mimeType: mimetype || 'application/octet-stream', body: Readable.from(buffer) },
    fields: 'id, webViewLink'
  });
  // הרשאת צפייה לכל מי שיש לו את הקישור
  try {
    await drive.permissions.create({
      fileId: res.data.id,
      requestBody: { role: 'reader', type: 'anyone' }
    });
  } catch (e) { /* לא קריטי */ }
  return res.data.webViewLink || ('https://drive.google.com/file/d/' + res.data.id + '/view');
}

function saveLocal(buffer, filename) {
  ensureLocalDir();
  const fname = safeName(filename);
  fs.writeFileSync(path.join(UPLOAD_DIR, fname), buffer);
  return '/uploads/' + fname;
}

// העלאה דרך Apps Script (רץ בשם המשתמש - עובד עם Gmail פרטי, בלי בעיית מכסת חשבון שירות)
function appsScriptConfigured() { return !!process.env.DRIVE_APPSCRIPT_URL; }
async function uploadViaAppsScript(buffer, filename, mimetype) {
  const res = await fetch(process.env.DRIVE_APPSCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: process.env.DRIVE_APPSCRIPT_TOKEN || '',
      filename, mimeType: mimetype || 'application/octet-stream',
      base64: buffer.toString('base64'),
    }),
  });
  const data = await res.json().catch(() => null);
  if (!data || !data.url) throw new Error((data && data.error) || ('apps script status ' + res.status));
  return data.url;
}

// מצב אחסון פעיל (לתצוגה)
function storageMode() {
  if (appsScriptConfigured()) return 'appsscript';
  if (driveConfigured()) return 'drive';
  return 'local';
}

// נקודת הכניסה הראשית: מקבל buffer ומחזיר URL לחשבונית
async function saveInvoice(buffer, filename, mimetype) {
  const safe = safeName(filename);
  // 1) Apps Script relay (מומלץ ל-Gmail פרטי)
  if (appsScriptConfigured()) {
    try { return await uploadViaAppsScript(buffer, safe, mimetype); }
    catch (e) { console.error('Apps Script upload failed:', e.message); }
  }
  // 2) חשבון שירות (Workspace / Shared Drive)
  if (driveConfigured()) {
    try { return await uploadToDrive(buffer, safe, mimetype); }
    catch (e) { console.error('Drive upload failed, saving locally:', e.message); }
  }
  // 3) מקומי
  return saveLocal(buffer, filename);
}

module.exports = { saveInvoice, driveConfigured, storageMode, UPLOAD_DIR };
