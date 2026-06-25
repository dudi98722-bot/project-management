/**
 * ניהול מזוזות ↔ Google Sheets
 * ------------------------------------------------------------
 * doGet  ?action=load            -> מחזיר את כל הנתונים כ-JSON
 * doPost p=<JSON מלא> action=save -> כותב מחדש את כל הלשוניות
 *
 * הגדרה (פשוט!):
 *   1. script.google.com  ->  New project, הדבק את כל הקוד הזה.
 *   2. Deploy > New deployment > Web app
 *        Execute as: Me   |   Who has access: Anyone
 *   3. אשר את ההרשאות (Authorize / Allow).
 *   4. העתק את כתובת ה-/exec ושלח אותה.
 *
 * הסקריפט יוצר לבד גיליון בשם "ניהול מזוזות" ב-Google Drive שלך
 * בפעם הראשונה — אין צורך ליצור גיליון או להעתיק ID ידנית.
 */

// הסקריפט מוצא/יוצר את הגיליון לבד. אם רוצים גיליון קיים — אפשר להדביק כאן ID ידני.
var SHEET_ID = '';

function getSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  if (SHEET_ID) return SpreadsheetApp.openById(SHEET_ID);
  var saved = props.getProperty('mz_sheet_id');
  if (saved) {
    try { return SpreadsheetApp.openById(saved); } catch (e) {}
  }
  var ss = SpreadsheetApp.create('ניהול מזוזות');
  props.setProperty('mz_sheet_id', ss.getId());
  return ss;
}

var SHEETS = {
  scribes:  { name: 'סופרים',
              headers: ['id','שם הסופר','מחיר בית יוסף','מחיר ארי'],
              fields:  ['id','name','by','ari'] },
  computer: { name: 'מגיהי מחשב',
              headers: ['id','שם המגיה','מחיר ליחי'],
              fields:  ['id','name','price'] },
  gavra:    { name: 'מגיהי גברא',
              headers: ['id','שם המגיה','מחיר ליחי'],
              fields:  ['id','name','price'] },
  mezuzot:  { name: 'מזוזות',
              headers: ['id','מק"ט','סופר','מוצר','תאריך','מחיר ליחי','הגהת מחשב','גברא 1','גברא 2','אישור הרב','מחיר מופחת','הולוגרמה בד"ץ','נשלח לכתר','תמונה'],
              fields:  ['id','sku','scribe','product','date','price','comp','g1','g2','approve','adj','holo','keter','img'] },
  payments: { name: 'תשלומים',
              headers: ['id','שם','תאריך','סכום','הערה'],
              fields:  ['id','name','date','amount','note'] }
};

var TEXT_FIELDS = { sku:1, holo:1, name:1, scribe:1, product:1, comp:1, g1:1, g2:1, approve:1, keter:1, note:1, date:1, img:1 };
var NUM_FIELDS  = { by:1, ari:1, price:1, adj:1, amount:1 };

function doGet(e)  { return handle(e); }
function doPost(e) { return handle(e); }

function handle(e) {
  var lock = LockService.getScriptLock();
  try {
    var p = (e && e.parameter) ? e.parameter : {};
    if (p.action === 'load') {
      return json(loadAll());
    }
    if (p.action === 'save' || p.p) {
      lock.waitLock(20000);
      var payload = JSON.parse(p.data || p.p || '{}');
      saveAll(payload);
      return json({ status: 'ok' });
    }
    return json({ status: 'idle' });
  } catch (err) {
    return json({ status: 'error', message: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function ss() { return getSpreadsheet(); }

function getSheet(cfg) {
  var s = ss().getSheetByName(cfg.name);
  if (!s) s = ss().insertSheet(cfg.name);
  if (s.getLastRow() === 0) {
    s.appendRow(cfg.headers);
    s.getRange(1, 1, 1, cfg.headers.length).setFontWeight('bold').setBackground('#edf2f7');
    s.setFrozenRows(1);
  }
  return s;
}

function loadAll() {
  var out = { scribes: [], computer: [], gavra: [], mezuzot: [], payments: [], seq: 1 };
  Object.keys(SHEETS).forEach(function (key) {
    var cfg = SHEETS[key];
    var s = getSheet(cfg);
    var last = s.getLastRow();
    if (last < 2) return;
    var values = s.getRange(2, 1, last - 1, cfg.fields.length).getValues();
    values.forEach(function (row) {
      if (String(row[0]) === '') return;
      var obj = {};
      cfg.fields.forEach(function (f, i) {
        var v = row[i];
        if (NUM_FIELDS[f]) v = Number(v) || 0;
        else if (f === 'date') v = fmtDate(v);
        else if (TEXT_FIELDS[f]) v = (v === null || v === undefined) ? '' : String(v);
        obj[f] = v;
      });
      out[key].push(obj);
    });
  });
  var seqProp = PropertiesService.getScriptProperties().getProperty('mz_seq');
  out.seq = seqProp ? Number(seqProp) : (out.mezuzot.length + 1);
  return out;
}

function saveAll(data) {
  Object.keys(SHEETS).forEach(function (key) {
    var cfg = SHEETS[key];
    var s = getSheet(cfg);
    var last = s.getLastRow();
    if (last > 1) s.getRange(2, 1, last - 1, cfg.headers.length).clearContent();
    var arr = data[key] || [];
    if (!arr.length) return;
    var rows = arr.map(function (item) {
      return cfg.fields.map(function (f) {
        var v = item[f];
        return (v === undefined || v === null) ? '' : v;
      });
    });
    s.getRange(2, 1, rows.length, cfg.fields.length).setValues(rows);
  });
  if (data.seq) PropertiesService.getScriptProperties().setProperty('mz_seq', String(data.seq));
}

function fmtDate(v) {
  if (v instanceof Date) {
    var y = v.getFullYear(),
        m = ('0' + (v.getMonth() + 1)).slice(-2),
        d = ('0' + v.getDate()).slice(-2);
    return y + '-' + m + '-' + d;
  }
  return v ? String(v) : '';
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
