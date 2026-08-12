// יצירת גיליון גיבוי חדש ומתן גישה למשתמש — בלי שיתוף ידני.
// חשבון השירות יוצר את הגיליון (ולכן יש לו גישה מלאה אליו מיידית),
// ואז מוסיף את כתובת המייל שלך כעורך.
// שימוש:  node scripts/create_sheet.js you@gmail.com ["שם הגיליון"]
require('dotenv').config();
const { google } = require('googleapis');
const { loadServiceAccount } = require('../gauth');

const email = process.argv[2];
const title = process.argv[3] || 'פסיכולוגיה מסילות — גיבוי';

(async () => {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('❌ צריך למסור כתובת מייל תקינה: node scripts/create_sheet.js you@gmail.com');
    process.exit(1);
  }
  const creds = loadServiceAccount();
  if (!creds) { console.error('❌ קובץ חשבון השירות חסר או פגום'); process.exit(1); }

  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'],
  });

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const created = await sheets.spreadsheets.create({
      requestBody: { properties: { title } },
      fields: 'spreadsheetId',
    });
    const id = created.data.spreadsheetId;

    const drive = google.drive({ version: 'v3', auth });
    await drive.permissions.create({
      fileId: id,
      requestBody: { type: 'user', role: 'writer', emailAddress: email },
      sendNotificationEmail: false,
    });

    // השורה האחרונה היא המזהה בלבד — סקריפט ההתקנה קורא אותה
    console.error(`✔ נוצר גיליון "${title}" ושותף עם ${email}`);
    console.error(`  https://docs.google.com/spreadsheets/d/${id}/edit`);
    console.log(id);
    process.exit(0);
  } catch (e) {
    const m = (e && e.message) || String(e);
    console.error('❌ יצירת הגיליון נכשלה: ' + m);
    if (/API has not been used|accessNotConfigured|disabled/i.test(m)) {
      console.error('   צריך להפעיל בגוגל קלאוד את Google Drive API (וגם Sheets API).');
    } else if (/quota|storage/i.test(m)) {
      console.error('   לחשבון השירות אין מקום ב-Drive. צור גיליון ידנית ושתף אותו במקום.');
    }
    process.exit(1);
  }
})();
