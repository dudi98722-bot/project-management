/**
 * נוכחות ויזניץ ↔ Google Sheets
 * ------------------------------------------------------------
 * מערכת דיווח שעות ל-3 עמותות — backend.
 * בשונה ממערכת המזוזות (דריסה מלאה), כאן כל פעולה מעדכנת שורה
 * בודדת לפי id — כך 15 עובדים יכולים להחתים במקביל בלי לדרוס זה את זה.
 *
 * API (הכל דרך GET, כי Apps Script מחזיר CORS פתוח ל-GET):
 *   ?action=load                                  -> כל הנתונים JSON
 *   ?action=upsert&sheet=records&data=<JSON>      -> הוספה/עדכון שורה לפי id
 *   ?action=del&sheet=records&id=<id>             -> מחיקת שורה
 *   ?action=setSetting&key=..&value=..            -> הגדרה
 *   ?action=batch&ops=<JSON array>                -> כמה פעולות בנעילה אחת
 *
 * הגדרה:
 *   1. script.google.com -> New project, הדבק את כל הקוד הזה.
 *   2. Deploy > New deployment > Web app
 *        Execute as: Me   |   Who has access: Anyone
 *   3. אשר הרשאות (Authorize / Allow).
 *   4. העתק את כתובת ה-/exec והדבק אותה במערכת (מסך ההגדרות / מסך הכניסה).
 *
 * הסקריפט יוצר לבד גיליון "נוכחות ויזניץ" ב-Drive בפעם הראשונה.
 */

var SHEET_ID = ''; // אופציונלי: ID של גיליון קיים. ריק = ייווצר אוטומטית.

function getSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  if (SHEET_ID) return SpreadsheetApp.openById(SHEET_ID);
  var saved = props.getProperty('att_sheet_id');
  if (saved) {
    try { return SpreadsheetApp.openById(saved); } catch (e) {}
  }
  var ss = SpreadsheetApp.create('נוכחות ויזניץ');
  props.setProperty('att_sheet_id', ss.getId());
  return ss;
}

var SHEETS = {
  users:    { name: 'משתמשים',
              headers: ['id','שם','שם משתמש','סיסמה מוצפנת','תפקיד','עריכה עצמית','פעיל'],
              fields:  ['id','name','username','hash','role','canEdit','active'] },
  terms:    { name: 'תנאי העסקה',
              headers: ['id','עובד','עמותה','מס עובד','היקף משרה','תעריף','ימי עבודה בשבוע','תקן ימים','תקן שעות','נסיעות','תחילת עבודה','הפסקת עבודה','סיבת הפסקה'],
              fields:  ['id','userId','amutaId','empNum','empType','rate','daysPerWeek','quotaDays','quotaHours','travel','startDate','endDate','endReason'] },
  records:  { name: 'דיווחים',
              headers: ['id','עובד','עמותה','תאריך','כניסה','יציאה','סוג','הערה','מקור','עודכן ע"י','חותמת'],
              fields:  ['id','userId','amutaId','date','tin','tout','type','note','src','by','ts'] },
  extras:   { name: 'תוספות',
              headers: ['id','עובד','עמותה','חודש','סוג תוספת','סכום','הערה'],
              fields:  ['id','userId','amutaId','month','label','amount','note'] },
  holidays: { name: 'חגים',
              headers: ['id','תאריך','שם'],
              fields:  ['id','date','name'] },
  settings: { name: 'הגדרות',
              headers: ['key','value'],
              fields:  ['key','value'] }
};

function doGet(e)  { return handle(e); }
function doPost(e) { return handle(e); }

function handle(e) {
  var lock = LockService.getScriptLock();
  try {
    var p = (e && e.parameter) ? e.parameter : {};
    if (p.action === 'load') return json(loadAll());
    if (p.action === 'upsert') {
      lock.waitLock(20000);
      upsertRow(p.sheet, JSON.parse(p.data));
      return json({ status: 'ok' });
    }
    if (p.action === 'del') {
      lock.waitLock(20000);
      deleteRow(p.sheet, p.id);
      return json({ status: 'ok' });
    }
    if (p.action === 'setSetting') {
      lock.waitLock(20000);
      setSetting(p.key, p.value);
      return json({ status: 'ok' });
    }
    if (p.action === 'batch') {
      lock.waitLock(20000);
      var ops = JSON.parse(p.ops || '[]');
      ops.forEach(function (o) {
        if (o.op === 'upsert') upsertRow(o.sheet, o.data);
        else if (o.op === 'del') deleteRow(o.sheet, o.id);
        else if (o.op === 'setSetting') setSetting(o.key, o.value);
      });
      return json({ status: 'ok', count: ops.length });
    }
    return json({ status: 'idle' });
  } catch (err) {
    return json({ status: 'error', message: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function getSheet(key) {
  var cfg = SHEETS[key];
  if (!cfg) throw new Error('unknown sheet: ' + key);
  var ss = getSpreadsheet();
  var s = ss.getSheetByName(cfg.name);
  if (!s) {
    s = ss.insertSheet(cfg.name);
    s.appendRow(cfg.headers);
    s.getRange(1, 1, 1, cfg.headers.length).setFontWeight('bold').setBackground('#e0e7ff');
    s.setFrozenRows(1);
    // עמודות כטקסט — שלא יהפוך תאריכים/שעות לפורמט של Sheets
    s.getRange(2, 1, 5000, cfg.headers.length).setNumberFormat('@');
    if (s.getMaxColumns() > cfg.headers.length) {
      s.deleteColumns(cfg.headers.length + 1, s.getMaxColumns() - cfg.headers.length);
    }
    try { ss.setSpreadsheetLocale('iw_IL'); } catch (e) {}
  }
  return s;
}

function loadAll() {
  var out = {};
  Object.keys(SHEETS).forEach(function (key) {
    var cfg = SHEETS[key];
    var s = getSheet(key);
    var last = s.getLastRow();
    out[key] = [];
    if (last < 2) return;
    var values = s.getRange(2, 1, last - 1, cfg.fields.length).getValues();
    values.forEach(function (row) {
      if (String(row[0]) === '') return;
      var obj = {};
      cfg.fields.forEach(function (f, i) {
        obj[f] = normalize(row[i], f);
      });
      out[key].push(obj);
    });
  });
  out.ts = new Date().toISOString();
  return out;
}

function normalize(v, field) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    // תאריך או שעה שהומרו ע"י Sheets למרות פורמט הטקסט
    if (field === 'tin' || field === 'tout') {
      return pad(v.getHours()) + ':' + pad(v.getMinutes());
    }
    if (field === 'month') {
      return v.getFullYear() + '-' + pad(v.getMonth() + 1);
    }
    return v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
  }
  return String(v);
}
function pad(n) { return ('0' + n).slice(-2); }

function findRow(s, id) {
  var last = s.getLastRow();
  if (last < 2) return -1;
  var ids = s.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function upsertRow(key, obj) {
  var cfg = SHEETS[key];
  var s = getSheet(key);
  var rowVals = cfg.fields.map(function (f) {
    var v = obj[f];
    return (v === undefined || v === null) ? '' : String(v);
  });
  var r = findRow(s, obj.id);
  if (r > 0) s.getRange(r, 1, 1, cfg.fields.length).setValues([rowVals]);
  else s.appendRow(rowVals);
}

function deleteRow(key, id) {
  var s = getSheet(key);
  var r = findRow(s, id);
  if (r > 0) s.deleteRow(r);
}

function setSetting(k, v) {
  var s = getSheet('settings');
  var last = s.getLastRow();
  if (last >= 2) {
    var keys = s.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]) === String(k)) {
        s.getRange(i + 2, 2).setValue(String(v));
        return;
      }
    }
  }
  s.appendRow([String(k), String(v)]);
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
