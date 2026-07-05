/**
 * CRM ↔ Google Sheets sync — מוסדות אלכסנדר
 * מקבל בקשות GET/POST עם פרמטר p = {type, action, data}
 * וכותב/מעדכן/מוחק שורות בלשוניות: אנשי קשר / נדרים / תשלומים.
 * שומר גם על ניהול המשתמשים הקיים (loadUsers / saveUsers).
 */

var SHEET_ID = '1Z2bU7w9x6vV5AYJORtFKcDfghz0rbDZZZx0sq9qZN0o';

// הגדרת הלשוניות והעמודות (לפי סדר)
var TABS = {
  contact: {
    name: 'אנשי קשר',
    headers: ['id','דירה','תואר','שם פרטי','שם משפחה','שם האב','טלפון בית','נייד','רחוב','מספר בית','עיר','מיקוד','מייל','שם לתצוגה','בוצע ע״י'],
    fields:  ['id','apt','title','first_name','last_name','father_name','phone_home','phone_mobile','street','house_num','city','zip','email','display_name','_user']
  },
  vow: {
    name: 'נדרים ונדבות',
    headers: ['id','תאריך','תאריך עברי','שם','עבור א','עבור ב','סכום','הערה','מקום','בוצע ע״י'],
    fields:  ['id','date','hebrewDate','name','forA','forB','amount','note','place','_user']
  },
  payment: {
    name: 'תשלומים',
    headers: ['id','תאריך','תאריך עברי','שם','מספר נדר','סכום','אמצעי תשלום','מספר תשלומים','הערה','בוצע ע״י'],
    fields:  ['id','date','hebrewDate','name','vowId','amount','method','numPayments','note','_user']
  }
};

function doGet(e)  { return handle(e); }
function doPost(e) { return handle(e); }

function handle(e) {
  try {
    var p = e && e.parameter ? e.parameter : {};

    // ----- ניהול משתמשים (תאימות לאחור) -----
    if (p.action === 'loadUsers') {
      var u = PropertiesService.getScriptProperties().getProperty('users');
      return json({ users: u ? JSON.parse(u) : [] });
    }
    if (p.action === 'saveUsers') {
      PropertiesService.getScriptProperties().setProperty('users', p.data || '[]');
      return json({ status: 'ok' });
    }

    // ----- סנכרון נתונים -----
    if (p.p) {
      var payload = JSON.parse(p.p);
      syncRow(payload.type, payload.action, payload.data || {});
      return json({ status: 'ok' });
    }

    return json({ status: 'idle' });
  } catch (err) {
    return json({ status: 'error', message: String(err) });
  }
}

function syncRow(type, action, data) {
  var cfg = TABS[type];
  if (!cfg) return;
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(cfg.name);
  if (!sh) {
    sh = ss.insertSheet(cfg.name);
    sh.appendRow(cfg.headers);
    sh.getRange(1, 1, 1, cfg.headers.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  if (sh.getLastRow() === 0) sh.appendRow(cfg.headers);

  var id = String(data.id);
  var rowIndex = findRowById(sh, id);

  if (action === 'delete') {
    if (rowIndex > 0) sh.deleteRow(rowIndex);
    return;
  }

  var row = cfg.fields.map(function (f) {
    var v = data[f];
    return (v === undefined || v === null) ? '' : v;
  });

  if (action === 'edit' && rowIndex > 0) {
    sh.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  } else if (rowIndex > 0) {
    // add אך השורה כבר קיימת -> עדכן (מונע כפילויות)
    sh.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  } else {
    sh.appendRow(row);
  }
}

function findRowById(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) return i + 2;
  }
  return -1;
}

/**
 * מופעל אוטומטית בכל עריכה בגיליון.
 * כשמסירים סימון מעמודה H בלשונית "ביקורי רופאים - עתידי",
 * מעביר את הנתונים (עמודות B-G) ללשונית "ביקורי רופאים" בעמודות C-H.
 */
function onEdit(e) {
  var range = e.range;
  var sheet = range.getSheet();

  // בדיקה שאנחנו בלשונית הנכונה ובעמודה H
  if (sheet.getName() !== 'ביקורי רופאים - עתידי') return;
  if (range.getColumn() !== 8) return;  // עמודה H
  if (range.getRow() < 2) return;       // מדלג על שורת כותרת

  // פועל כשהערך הוא FALSE
  if (e.value !== 'FALSE') return;

  var row = range.getRow();
  var data = sheet.getRange(row, 2, 1, 6).getValues()[0];

  // אם כל השורה ריקה - לא עושים כלום
  if (data.every(function(cell) { return cell === ''; })) {
    range.setValue(true);
    return;
  }

  var target = e.source.getSheetByName('ביקורי רופאים');
  if (!target) return;

  var colC = target.getRange('C:C').getValues();
  var lastRow = 1;
  for (var i = colC.length - 1; i >= 0; i--) {
    if (colC[i][0] !== '') { lastRow = i + 2; break; }
  }
  target.getRange(lastRow, 3, 1, 6).setValues([data]);

  sheet.getRange(row, 2, 1, 6).clearContent();
  range.setValue(true);
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
