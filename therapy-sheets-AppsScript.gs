/* =====================================================================
   פסיכולוגיה מסילות — גיבוי אוטומטי לגוגל שיטס  (Google Apps Script)
   ---------------------------------------------------------------------
   הקוד הזה יושב בתוך הגיליון שלך ומקבל את הנתונים מהשרת.
   אין צורך בחשבון שירות, במפתחות או בשיתופים — הגיליון בבעלותך.

   הוא יוצר לבד 6 לשוניות ומעדכן אותן בכל שינוי במערכת:
     ממתינים · מטפלים · קבוצות מטפלים · סדרות טיפול · פגישות · פעולות

   ────────────  התקנה (פעם אחת, ~3 דק')  ────────────
   1. פתח גיליון חדש ב-Google Sheets
   2. תוספים ▸ Apps Script   (Extensions ▸ Apps Script)
   3. מחק את הקוד הקיים, הדבק את כל הקובץ הזה
   4. בשורה למטה החלף את הסיסמה בטקסט אקראי משלך:
          var SECRET = '...'
      (זה מה שמונע מאחרים לכתוב לגיליון שלך — שמור אותו, תצטרך אותו בשרת)
   5. שמור 💾. בחר בתפריט הפונקציות את authorizeDrive ולחץ ▶ Run,
      ואשר את ההרשאות (Advanced ← Go to... ← Allow).
      חשוב: הרצת פונקציה שלא נוגעת ב-Drive לא תבקש את ההרשאה,
      והגיבוי ייכשל בשקט.
   6. Deploy ▸ New deployment ▸ סוג "Web app"
        • Execute as:      Me
        • Who has access:  Anyone
      והעתק את כתובת ה-Web app (מסתיימת ב-/exec)
   7. בשרת הרץ:
        sudo bash setup-sheets-therapy.sh "<הכתובת>" "<הסיסמה>"

   ⚠️  אחרי כל שינוי בקוד הזה צריך  Deploy ▸ Manage deployments ▸ עריכה ▸
       Version: New version ▸ Deploy   (אחרת הגרסה הישנה ממשיכה לרוץ)
   ===================================================================== */

var SECRET = 'שנה-אותי-לטקסט-אקראי';

// סדר העמודות בכל לשונית. חייב להתאים לשרת (sheets.js).
var TABS = {
  patients: { title: 'ממתינים', header: ['מזהה','שם משפחה','שם פרטי','ת.ז','תאריך אינטייק','תאריך לידה','קופת חולים','בן/בת','קהילה','אבחנה','הערות','דחיפות','שעות מתאימות','מטפלים מועדפים','קבוצות','סטטוס','נמחק','עודכן','הערות נוספות'] },
  therapists: { title: 'מטפלים', header: ['מזהה','שם','טלפון','אימייל','הערות','לוח עבודה','פעיל','נמחק','עודכן'] },
  therapist_groups: { title: 'קבוצות מטפלים', header: ['מזהה','שם','הערות','חברים','נמחק','עודכן'] },
  assignments: { title: 'סדרות טיפול', header: ['מזהה','מטופל','מטפל','כמות טיפולים','תאריך התחלה','שעה','יום בשבוע','סטטוס','הערות','נמחק','עודכן','סוג'] },
  sessions: { title: 'פגישות', header: ['מזהה','סדרה','מטופל','מטפל','מספר פגישה','תאריך','שעה','סטטוס','הערות','נמחק','עודכן'] }
};
var LOG = { title: 'פעולות', header: ['זמן','משתמש','פעולה','טבלה','מזהה','פרטים'] };

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (String(body.secret || '') !== String(SECRET)) {
      return json_({ ok: false, error: 'סיסמה שגויה' });
    }
    if (body.ping) {
      ensureAll_();
      return json_({ ok: true, sheet: SpreadsheetApp.getActiveSpreadsheet().getName() });
    }
    if (body.file) return json_(saveFile_(body.file));
    var lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try {
      var acts = body.actions || [];
      // אינדקס מזהה->שורה נבנה פעם אחת לכל לשונית בבקשה. בלעדיו כל שורה
      // הייתה סורקת מחדש את כל העמודה, וייצוא של מאות פגישות היה נתקע.
      var ctx = {};
      for (var i = 0; i < acts.length; i++) apply_(acts[i], ctx);
      return json_({ ok: true, applied: acts.length });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doGet() {
  return HtmlService.createHtmlOutput(
    '<div style="font-family:Arial;direction:rtl;padding:30px;text-align:center">' +
    '<h2>פסיכולוגיה מסילות — נקודת גיבוי</h2>' +
    '<p>הכתובת פעילה. הנתונים נכתבים לגיליון אוטומטית מהמערכת.</p></div>');
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function sheetFor_(title, header) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(title);
  if (!sh) {
    sh = ss.insertSheet(title);
    sh.getRange(1, 1, 1, header.length).setValues([header])
      .setFontWeight('bold').setBackground('#e8effc');
    sh.setFrozenRows(1);
    sh.setRightToLeft(true);
  }
  return sh;
}

function ensureAll_() {
  sheetFor_(LOG.title, LOG.header);
  for (var k in TABS) sheetFor_(TABS[k].title, TABS[k].header);
}

// ===== גיבוי קבצים ל-Drive =====
// נשמרים תחת תיקייה ראשית -> תיקייה לכל מטופל, ליד הגיליון.
var DRIVE_ROOT = 'פסיכולוגיה מסילות — קבצים';

// הרץ אותי פעם אחת מהעורך כדי לאשר את הרשאת ה-Drive.
// הפונקציה *יוצרת* תיקייה ומוחקת אותה בכוונה: גוגל מעניקה את ההרשאה
// המינימלית שהקוד שרץ צריך, ופעולת קריאה בלבד הייתה נותנת drive.readonly —
// ואז יצירת התיקיות בגיבוי נכשלת.
function authorizeDrive() {
  var f = DriveApp.getRootFolder().createFolder('בדיקת הרשאה — אפשר למחוק');
  f.setTrashed(true);
  Logger.log('Drive מחובר — הרשאת כתיבה ניתנה');
  return 'ok';
}

function folder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function saveFile_(f) {
  if (!f.name || !f.data) return { ok: false, error: 'חסר שם או תוכן' };
  // התיקייה הראשית נוצרת ליד הגיליון, כדי שתמצא אותה באותו מקום
  var ssFile = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId());
  var parents = ssFile.getParents();
  var base = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  var root = folder_(base, DRIVE_ROOT);
  var dir = f.patient ? folder_(root, String(f.patient).slice(0, 100)) : root;

  var blob = Utilities.newBlob(Utilities.base64Decode(f.data), f.mime || 'application/octet-stream', f.name);
  // אותו מזהה שעולה שוב — מחליף את הקובץ הקודם במקום לשכפל
  if (f.ref) {
    var old = dir.getFilesByName(f.name);
    while (old.hasNext()) { var o = old.next(); if (o.getDescription() === String(f.ref)) o.setTrashed(true); }
  }
  var saved = dir.createFile(blob);
  if (f.ref) saved.setDescription(String(f.ref));
  return { ok: true, id: saved.getId(), url: saved.getUrl(), folder: dir.getName() };
}

function apply_(a, ctx) {
  ctx = ctx || {};
  if (a.type === 'log') {
    sheetFor_(LOG.title, LOG.header).appendRow(a.values);
    return;
  }
  if (a.type === 'upsert') {
    var def = TABS[a.table];
    if (!def) return;

    // אינדקס לכל לשונית: נבנה פעם אחת, ומתעדכן תוך כדי כשמוסיפים שורות
    var st = ctx[a.table];
    if (!st) {
      var sh = sheetFor_(def.title, def.header);
      var last = sh.getLastRow();
      var idx = {};
      if (last > 1) {
        var col = sh.getRange(2, 1, last - 1, 1).getValues();
        for (var i = 0; i < col.length; i++) idx[String(col[i][0])] = i + 2;
      }
      st = ctx[a.table] = { sh: sh, idx: idx, next: Math.max(last + 1, 2) };
    }

    var id = String(a.values[0]);
    var row = st.idx[id];
    if (!row) { row = st.next++; st.idx[id] = row; }
    st.sh.getRange(row, 1, 1, a.values.length).setValues([a.values]);
  }
}
