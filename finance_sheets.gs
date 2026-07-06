/**
 * ניהול כספים — בית ועסק ↔ Google Sheets (backend)
 * ------------------------------------------------------------
 * שומר את כל תנועות המערכת, הפרויקטים וההגדרות בגיליון Google.
 * משרת גם את הטופס הציבורי (דיווח ידני ללא התחברות).
 *
 * API:
 *   GET  ?action=load                      -> כל הנתונים JSON
 *   GET  ?action=formmeta                  -> קטגוריות+פרויקטים+מבנים לטופס הציבורי
 *   GET  ?action=addTx&data=<JSON>         -> הוספת תנועה בודדת (הטופס)
 *   POST ?action=importTx  body={rows:[..]} -> ייבוא אקסל מהטופס: דילוג כפולות
 *                                              + סיווג אוטומטי לפי הכללים השמורים
 *   GET/POST ?action=batch&ops=<JSON>      -> פעולות מרובות בנעילה אחת
 *        (ב-POST אפשר לשלוח body בפורמט {"action":"batch","ops":[...]})
 *   פעולות בתוך ops:
 *        {op:'upsertTx',  rows:[tx,...]}
 *        {op:'delTx',     ids:[...]}
 *        {op:'upsertProject', rows:[p,...]}
 *        {op:'delProject',    ids:[...]}
 *        {op:'setSetting', key:'..', value:'..'}
 *
 * הגדרה (פעם אחת) — הסקריפט "קשור" לגיליון עצמו, כך שהקוד והנתונים
 * יושבים באותו קובץ ב-Drive:
 *   1. פתח את גיליון "ניהול כספים בני" (או צור גיליון חדש בשם הזה).
 *   2. בתוך הגיליון: Extensions (תוספים) → Apps Script (סקריפט של Apps).
 *   3. מחק את הקוד שבעורך והדבק את כל הקוד הזה במקומו.
 *   4. Deploy → New deployment → Web app
 *        Execute as: Me   |   Who has access: Anyone
 *   5. אשר הרשאות (Authorize / Allow).
 *   6. העתק את כתובת ה-/exec והדבק אותה במסך ההגדרות של המערכת.
 *
 * הסקריפט יוצר לבד את הלשוניות "תנועות"/"פרויקטים"/"הגדרות" בתוך אותו
 * גיליון בפעם הראשונה — אין קובץ נפרד.
 */

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

var SHEETS = {
  tx: { name: 'תנועות',
        headers: ['מזהה','תאריך','תיאור','פרטים','סכום','סוג','מקור','שיוך','קטגוריה','פרויקט','חשבונית','אסמכתא','פרטים נוספים 1','פרטים נוספים 2','פרטים נוספים 3','פרטים נוספים 4','קובץ מקור','נמחק'],
        fields:  ['id','date','desc','details','amount','kind','account','scope','category','project','invoice','ref','extra1','extra2','extra3','extra4','origin','deleted'] },
  projects: { name: 'פרויקטים',
        headers: ['מזהה','שם','מחיר ללא מע"מ','שלבי תשלום (JSON)','צפי הוצאות (JSON)','נמחק','תוספות למחיר (JSON)'],
        fields:  ['id','name','price','stages','budget','deleted','extras'] },
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
    var body = null;
    if (e && e.postData && e.postData.contents) {
      try { body = JSON.parse(e.postData.contents); } catch (x) {}
    }
    var action = p.action || (body && body.action) || '';

    if (action === 'load') return json(loadAll());
    if (action === 'formmeta') return json(formMeta());

    if (action === 'addTx') {
      lock.waitLock(20000);
      var data = p.data ? JSON.parse(p.data) : (body && body.data);
      if (!data) return json({ status: 'error', message: 'no data' });
      if (!data.id) data.id = 'f-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
      upsertMany('tx', [data]);
      return json({ status: 'ok', id: data.id });
    }

    if (action === 'importTx') {
      lock.waitLock(30000);
      var rows = (body && body.rows) || (p.rows ? JSON.parse(p.rows) : []);
      var res = importTx(rows);
      return json({ status: 'ok', added: res.added, dups: res.dups, auto: res.auto });
    }

    if (action === 'batch') {
      lock.waitLock(30000);
      var ops = p.ops ? JSON.parse(p.ops) : ((body && body.ops) || []);
      var count = 0;
      ops.forEach(function (o) {
        if (o.op === 'upsertTx')      { upsertMany('tx', o.rows || []); count += (o.rows || []).length; }
        else if (o.op === 'delTx')    { markDeleted('tx', o.ids || []); count += (o.ids || []).length; }
        else if (o.op === 'upsertProject') { upsertMany('projects', o.rows || []); count += (o.rows || []).length; }
        else if (o.op === 'delProject')    { markDeleted('projects', o.ids || []); count += (o.ids || []).length; }
        else if (o.op === 'setSetting')    { setSetting(o.key, o.value); count++; }
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
    s.getRange(1, 1, 1, cfg.headers.length).setFontWeight('bold').setBackground('#e0e7ff');
    s.setFrozenRows(1);
    // עמודות כטקסט — שלא יהפוך תאריכים לפורמט פנימי של Sheets
    s.getRange(2, 1, 20000, cfg.headers.length).setNumberFormat('@');
    if (s.getMaxColumns() > cfg.headers.length) {
      s.deleteColumns(cfg.headers.length + 1, s.getMaxColumns() - cfg.headers.length);
    }
    try { ss.setSpreadsheetLocale('iw_IL'); } catch (e) {}
    // מוחק את Sheet1 הריק שנוצר אוטומטית
    var def = ss.getSheetByName('Sheet1') || ss.getSheetByName('גיליון1');
    if (def && ss.getSheets().length > 1) { try { ss.deleteSheet(def); } catch (e) {} }
  }
  return s;
}

function loadAll() {
  var out = { tx: readAll('tx'), projects: readAll('projects'), settings: {} };
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

/** הוספה/עדכון יעילים בבת אחת: קורא את עמודת המזהים פעם אחת,
 *  מעדכן שורות קיימות, ומוסיף את כל החדשות בכתיבה אחת. */
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
 *  רק עמודת "נמחק" מסומנת בתאריך, וניתן לשחזר מהמערכת. */
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

/** מידע מינימלי לטופס הציבורי — בלי לחשוף תנועות וסכומים. */
function formMeta() {
  var settings = {};
  readAll('settings').forEach(function (r) { settings[r.key] = r.value; });
  var cats = null, accounts = null, templates = null;
  try { cats = JSON.parse(settings.categories || 'null'); } catch (e) {}
  try { accounts = JSON.parse(settings.accounts || 'null'); } catch (e) {}
  try { templates = JSON.parse(settings.templates || 'null'); } catch (e) {}
  var projects = readAll('projects').filter(function (p) { return !p.deleted; })
                                    .map(function (p) { return p.name; });
  return { status: 'ok', categories: cats, projects: projects, vat: settings.vat || '18',
           accounts: accounts, templates: templates };
}

/** ייבוא אקסל מהטופס הציבורי: מדלג על כפולות (אותו מפתח כמו במערכת)
 *  ומסווג אוטומטית לפי הכללים השמורים. */
function normDesc(s) { return String(s || '').replace(/[־–—]+/g, '-').replace(/\s+/g, ' ').trim(); }
function dedupKey(t) {
  return [t.date, t.kind, Number(t.amount).toFixed(2), normDesc(t.desc), t.account].join('|');
}
function importTx(rows) {
  var existing = {};
  readAll('tx').forEach(function (t) { existing[dedupKey(t)] = true; });
  // אין סיווג אוטומטי נלמד — רק החרגת חיוב אשראי מרוכז (מניעת ספירה כפולה)
  var EXCLUDE_RE = /די+רקט-?\s*מצטבר/;
  var toAdd = [], dups = 0, auto = 0;
  (rows || []).forEach(function (r) {
    if (!r || !r.date || !r.amount || !r.kind) return;
    var key = dedupKey(r);
    if (existing[key]) { dups++; return; }
    existing[key] = true;
    if (!r.id) r.id = 'f-' + Date.now() + '-' + Math.floor(Math.random() * 1000000);
    if (!r.scope && EXCLUDE_RE.test(String(r.desc || ''))) { r.scope = 'exclude'; auto++; }
    toAdd.push(r);
  });
  if (toAdd.length) upsertMany('tx', toAdd);
  // פרויקטים חדשים שהופיעו בקובץ — נוצרים אוטומטית ברשימת הפרויקטים
  var known = {};
  readAll('projects').forEach(function (p) { known[p.name] = true; });
  var newProjects = [];
  toAdd.forEach(function (r) {
    if (r.project && !known[r.project]) {
      known[r.project] = true;
      newProjects.push({ id: 'p-' + Date.now() + '-' + Math.floor(Math.random() * 100000),
        name: r.project, price: '0', stages: '[]',
        budget: '{"workers":0,"materials":0,"cranes":0}', deleted: '' });
    }
  });
  if (newProjects.length) upsertMany('projects', newProjects);
  return { added: toAdd.length, dups: dups, auto: auto };
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
