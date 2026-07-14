/**
 * ממסר חשבוניות ל-Google Drive עבור מערכת הקבלן.
 * פורס כ-Web App (Deploy → New deployment → Web app):
 *   - Execute as: Me (הכתובת שלך)
 *   - Who has access: Anyone
 * מעתיקים את כתובת ה-/exec ונותנים אותה למערכת (DRIVE_APPSCRIPT_URL).
 *
 * הסקריפט רץ בשם החשבון שלך, ולכן שומר קבצים בדרייב שלך (עם מכסת האחסון שלך) —
 * בניגוד ל"חשבון שירות" שאין לו מקום אחסון.
 */

// מזהה תיקיית החשבוניות (מה-URL של התיקייה בדרייב)
var FOLDER_ID = 'PASTE_FOLDER_ID_HERE';

// טוקן סודי (אופציונלי אך מומלץ) — חייב להיות זהה ל-DRIVE_APPSCRIPT_TOKEN בשרת.
// אם תשאיר ריק, כל מי שיש לו את הכתובת יוכל להעלות.
var TOKEN = '';

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (TOKEN && data.token !== TOKEN) {
      return _json({ error: 'unauthorized' });
    }
    var folder = DriveApp.getFolderById(FOLDER_ID);
    var bytes = Utilities.base64Decode(data.base64);
    var blob = Utilities.newBlob(bytes, data.mimeType || 'application/octet-stream', data.filename || 'invoice');
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return _json({ url: file.getUrl() });
  } catch (err) {
    return _json({ error: String(err) });
  }
}

function doGet() {
  return _json({ ok: true });
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
