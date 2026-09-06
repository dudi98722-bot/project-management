/**
 * ניהול הוצאות בית ↔ Google Sheets (backend)
 * ------------------------------------------------------------
 * שומר תנועות, קטגוריות, שטאנצים (מקורות ייבוא), כללי סיווג והגדרות.
 * כל תנועה נשמרת יחד עם תיעוד מלא מאיפה היא הגיעה.
 *
 * API:
 *   GET  ?action=load                       -> כל הנתונים JSON
 *   POST  {action:'importTx', rows:[...]}   -> ייבוא עם דילוג כפולות בצד השרת
 *   POST  {action:'batch', ops:[...]}       -> פעולות מרובות בנעילה אחת
 *
 *   פעולות בתוך ops:
 *        {op:'upsertTx',       rows:[...]}
 *        {op:'delTx',          ids:[...]}
 *        {op:'upsertCat',      rows:[...]}
 *        {op:'delCat',         ids:[...]}
 *        {op:'upsertStencil',  rows:[...]}
 *        {op:'delStencil',     ids:[...]}
 *        {op:'upsertRule',     rows:[...]}
 *        {op:'delRule',        ids:[...]}
 *        {op:'setSetting',     key:'..', value:'..'}
 *
 * הגדרה (פעם אחת) — הסקריפט "קשור" לגיליון עצמו, כך שהקוד והנתונים
 * יושבים באותו קובץ ב-Drive:
 *   1. צור גיליון חדש בשם "ניהול הוצאות בית".
 *   2. בתוך הגיליון: Extensions (תוספים) ← Apps Script (סקריפט של Apps).
 *   3. מחק את הקוד שבעורך והדבק את כל הקוד הזה במקומו.
 *   4. Deploy ← New deployment ← Web app
 *        Execute as: Me   |   Who has access: Anyone
 *   5. אשר הרשאות (Authorize / Allow).
 *   6. העתק את כתובת ה-/exec והדבק אותה במסך ההגדרות של המערכת.
 *
 * הלשוניות נוצרות לבד בשימוש הראשון — אין צורך להכין כלום מראש.
 */

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

var SHEETS = {
  tx: {
    name: 'תנועות',
    headers: ['מזהה', 'תאריך', 'תיאור', 'סכום', 'סוג', 'קטגוריה', 'סטטוס',
              'אמצעי תשלום', 'הערה', 'מקור', 'קובץ מקור', 'שורה במקור',
              'טקסט גולמי', 'תאריך ייבוא', 'ייבא', 'אופן סיווג', 'הזין', 'נמחק'],
    fields:  ['id', 'date', 'desc', 'amount', 'kind', 'category', 'status',
              'payment', 'note', 'src', 'srcFile', 'srcRow',
              'srcRaw', 'importedAt', 'importedBy', 'classBy', 'enteredBy', 'deleted']
  },
  cats: {
    name: 'קטגוריות',
    headers: ['מזהה', 'שם', 'סוג', 'צבע', 'אייקון', 'סדר', 'נמחק'],
    fields:  ['id', 'name', 'kind', 'color', 'icon', 'ord', 'deleted']
  },
  stencils: {
    name: 'מקורות',
    headers: ['מזהה', 'שם', 'סוג', 'אמצעי תשלום', 'שורות לדילוג',
              'מיפוי עמודות (JSON)', 'פורמט תאריך', 'שיטת סכום', 'היפוך סימן', 'נמחק'],
    fields:  ['id', 'name', 'type', 'payment', 'skip',
              'map', 'dateFmt', 'amountMode', 'signFlip', 'deleted']
  },
  rules: {
    name: 'כללי סיווג',
    headers: ['מזהה', 'טקסט לזיהוי', 'סוג התאמה', 'קטגוריה', 'סטטוס', 'פעמים', 'נמחק'],
    fields:  ['id', 'match', 'matchType', 'category', 'status', 'hits', 'deleted']
  },
  settings: {
    name: 'הגדרות',
    headers: ['key', 'value'],
    fields:  ['key', 'value']
  }
};

function doGet(e)  { return handle(e); }
function doPost(e) { return handle(e); }

function handle(e) {
  var lock = LockService.getScriptLock();
  try {
    var p = (e && e.parameter) ? e.parameter : {};
    var body = null;
    if (e && e.postData && e.postData.contents) {
      try { body = JSON.parse(e.postData.contents); } catch (x) {}
    }
    var action = p.action || (body && body.action) || '';

    if (action === 'load') return json(loadAll());

    if (action === 'importTx') {
      lock.waitLock(30000);
      var rows = (body && body.rows) || (p.rows ? JSON.parse(p.rows) : []);
      var res = importTx(rows);
      return json({ status: 'ok', added: res.added, dups: res.dups });
    }

    if (action === 'batch') {
      lock.waitLock(30000);
      var ops = p.ops ? JSON.parse(p.ops) : ((body && body.ops) || []);
      var count = 0;
      ops.forEach(function (o) {
        if (o.op === 'upsertTx')            { upsertMany('tx', o.rows || []);       count += (o.rows || []).length; }
        else if (o.op === 'delTx')          { markDeleted('tx', o.ids || []);       count += (o.ids || []).length; }
        else if (o.op === 'upsertCat')      { upsertMany('cats', o.rows || []);     count += (o.rows || []).length; }
        else if (o.op === 'delCat')         { markDeleted('cats', o.ids || []);     count += (o.ids || []).length; }
        else if (o.op === 'upsertStencil')  { upsertMany('stencils', o.rows || []); count += (o.rows || []).length; }
        else if (o.op === 'delStencil')     { markDeleted('stencils', o.ids || []); count += (o.ids || []).length; }
        else if (o.op === 'upsertRule')     { upsertMany('rules', o.rows || []);    count += (o.rows || []).length; }
        else if (o.op === 'delRule')        { markDeleted('rules', o.ids || []);    count += (o.ids || []).length; }
        else if (o.op === 'setSetting')     { setSetting(o.key, o.value);           count++; }
      });
      return json({ status: 'ok', count: count });
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
    s.getRange(1, 1, 1, cfg.headers.length).setFontWeight('bold').setBackground('#dbeafe');
    s.setFrozenRows(1);
    // עמודות כטקסט — שלא יהפוך תאריכים וסכומים לפורמט פנימי של Sheets
    s.getRange(2, 1, 20000, cfg.headers.length).setNumberFormat('@');
    if (s.getMaxColumns() > cfg.headers.length) {
      s.deleteColumns(cfg.headers.length + 1, s.getMaxColumns() - cfg.headers.length);
    }
    try { ss.setSpreadsheetLocale('iw_IL'); } catch (x) {}
    var def = ss.getSheetByName('Sheet1') || ss.getSheetByName('גיליון1');
    if (def && ss.getSheets().length > 1) { try { ss.deleteSheet(def); } catch (x) {} }
  }
  return s;
}

function loadAll() {
  var out = {
    tx: readAll('tx'),
    cats: readAll('cats'),
    stencils: readAll('stencils'),
    rules: readAll('rules'),
    settings: {}
  };
  readAll('settings').forEach(function (r) { out.settings[r.key] = r.value; });
  out.ts = new Date().toISOString();
  return out;
}

function readAll(key) {
  var cfg = SHEETS[key];
  var s = getSheet(key);
  var last = s.getLastRow();
  var list = [];
  if (last < 2) return list;
  var values = s.getRange(2, 1, last - 1, cfg.fields.length).getValues();
  values.forEach(function (row) {
    if (String(row[0]) === '') return;
    var obj = {};
    cfg.fields.forEach(function (f, i) { obj[f] = normalize(row[i]); });
    list.push(obj);
  });
  return list;
}

function normalize(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    return v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
  }
  return String(v);
}
function pad(n) { return ('0' + n).slice(-2); }

/** הוספה/עדכון בבת אחת: קורא את עמודת המזהים פעם אחת, מעדכן קיימות,
 *  ומוסיף את כל החדשות בכתיבה אחת. */
function upsertMany(key, rows) {
  if (!rows || !rows.length) return;
  var cfg = SHEETS[key];
  var s = getSheet(key);
  var last = s.getLastRow();
  var idMap = {};
  if (last >= 2) {
    var ids = s.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) idMap[String(ids[i][0])] = i + 2;
  }
  var appends = [];
  rows.forEach(function (obj) {
    var rowVals = cfg.fields.map(function (f) {
      var v = obj[f];
      return (v === undefined || v === null) ? '' : String(v);
    });
    var r = idMap[String(obj.id)];
    if (r) s.getRange(r, 1, 1, cfg.fields.length).setValues([rowVals]);
    else appends.push(rowVals);
  });
  if (appends.length) {
    s.getRange(s.getLastRow() + 1, 1, appends.length, cfg.fields.length)
     .setNumberFormat('@').setValues(appends);
  }
}

/** מחיקה רכה בלבד: שום שורה לא נמחקת מהגיליון לעולם —
 *  רק עמודת "נמחק" מסומנת בתאריך. תיעוד המקור נשמר תמיד. */
function markDeleted(key, ids) {
  if (!ids || !ids.length) return;
  var cfg = SHEETS[key];
  var s = getSheet(key);
  var last = s.getLastRow();
  if (last < 2) return;
  var delCol = cfg.fields.indexOf('deleted') + 1;
  if (delCol < 1) return;
  var wanted = {};
  ids.forEach(function (id) { wanted[String(id)] = true; });
  var idVals = s.getRange(2, 1, last - 1, 1).getValues();
  var stamp = new Date().toISOString().slice(0, 10);
  for (var i = 0; i < idVals.length; i++) {
    if (wanted[String(idVals[i][0])]) s.getRange(i + 2, delCol).setValue(stamp);
  }
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

/** מפתח כפילות — אותו תאריך, סכום, תיאור ומקור = אותה תנועה.
 *  שומר מפני ייבוא כפול של אותו קובץ, גם משני מכשירים במקביל. */
function normDesc(s) {
  return String(s || '').replace(/[־–—]+/g, '-').replace(/\s+/g, ' ').trim();
}
function dedupKey(t) {
  return [t.date, t.kind, Number(t.amount || 0).toFixed(2), normDesc(t.desc), t.src].join('|');
}

function importTx(rows) {
  var existing = {};
  readAll('tx').forEach(function (t) { existing[dedupKey(t)] = true; });
  var toAdd = [], dups = 0;
  (rows || []).forEach(function (r) {
    if (!r || !r.date || !r.amount) return;
    var key = dedupKey(r);
    if (existing[key]) { dups++; return; }
    existing[key] = true;
    if (!r.id) r.id = 't-' + Date.now() + '-' + Math.floor(Math.random() * 1000000);
    toAdd.push(r);
  });
  if (toAdd.length) upsertMany('tx', toAdd);
  return { added: toAdd.length, dups: dups };
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
