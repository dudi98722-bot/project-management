/* =====================================================================
   שניצל שף — קופה קטנה   |   Google Apps Script (Web App)
   ---------------------------------------------------------------------
   השרת של המערכת. כל הנתונים נשמרים בגיליון Google Sheets רגיל,
   כך שאפשר לפתוח ולראות אותם גם ישירות בשיטס.

   ────────────  התקנה (פעם אחת, ~5 דק')  ────────────
   1. פתח גיליון חדש בגוגל שיטס  ▸  תוספים ▸ Apps Script
   2. מחק את הקוד הקיים, הדבק את כל הקובץ הזה, שמור
   3. Deploy ▸ New deployment ▸ סוג "Web app"
        • Execute as:      Me        (כותב בשמך לגיליון)
        • Who has access:  Anyone    (כדי שהעובדים יוכלו להיכנס)
      Deploy ▸ אשר הרשאות (Authorize / Allow)
   4. העתק את כתובת ה-Web app (מסתיימת ב-/exec)
   5. הדבק אותה במסך ההתקנה של https://schnitzel-kupa.dudi-ananalytics.com

   בכניסה הראשונה המערכת תבקש להגדיר את המנהל הראשי — שם משתמש וסיסמה.
   כל עדכון עתידי של הקוד: הדבק כאן מחדש ואז Deploy ▸ Manage deployments
   ▸ עריכה ▸ Version: New version ▸ Deploy.
   ===================================================================== */

var TZ        = 'Asia/Jerusalem';
var SS_ID     = '';                    // ריק = הסקריפט משתמש בגיליון שאליו הוא מחובר
var TOKEN_TTL = 30 * 24 * 60 * 60 * 1000;   // תוקף כניסה: 30 יום
var PBKDF_ROUNDS = 60;                 // סיבובי גיבוב לסיסמה

/* ---------- הגדרת הלשוניות בגיליון ---------- */
var SHEETS = {
  users: {
    name: 'משתמשים',
    headers: ['מזהה', 'שם משתמש', 'שם מלא', 'תפקיד', 'מלח', 'סיסמה מוצפנת', 'פעיל', 'נוצר בתאריך'],
    fields:  ['id', 'username', 'fullName', 'role', 'salt', 'hash', 'active', 'createdAt']
  },
  deposits: {
    name: 'הפקדות',
    headers: ['מזהה', 'תאריך', 'סכום', 'הערה', 'נרשם על ידי', 'מזהה משתמש', 'נרשם בתאריך', 'עודכן בתאריך', 'נמחק'],
    fields:  ['id', 'date', 'amount', 'note', 'userName', 'userId', 'createdAt', 'updatedAt', 'deleted']
  },
  withdrawals: {
    name: 'משיכות',
    headers: ['מזהה', 'תאריך', 'סכום', 'סוג הוצאה', 'מזהה סוג', 'פרטים נוספים', 'נרשם על ידי', 'מזהה משתמש', 'נרשם בתאריך', 'עודכן בתאריך', 'נמחק'],
    fields:  ['id', 'date', 'amount', 'catName', 'catId', 'details', 'userName', 'userId', 'createdAt', 'updatedAt', 'deleted']
  },
  categories: {
    name: 'סוגי הוצאות',
    headers: ['מזהה', 'שם הסוג', 'נוצר על ידי', 'מזהה משתמש', 'נוצר בתאריך', 'נמחק'],
    fields:  ['id', 'name', 'userName', 'userId', 'createdAt', 'deleted']
  }
};

var DATE_FIELDS = { date: 1 };
var NUM_FIELDS  = { amount: 1 };
var BOOL_FIELDS = { deleted: 1, active: 1 };

/* =====================  תשתית גיליון  ===================== */
var _ssCache = null, _shCache = {};
function ss_() {
  if (_ssCache) return _ssCache;
  _ssCache = ssOpen_();
  return _ssCache;
}
function ssOpen_() {
  if (SS_ID) return SpreadsheetApp.openById(SS_ID);
  var saved = PropertiesService.getScriptProperties().getProperty('kupa_ss_id');
  if (saved) { try { return SpreadsheetApp.openById(saved); } catch (e) {} }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  var created = SpreadsheetApp.create('שניצל שף — קופה קטנה');
  PropertiesService.getScriptProperties().setProperty('kupa_ss_id', created.getId());
  return created;
}

function sheet_(key) {
  if (_shCache[key]) return _shCache[key];
  var cfg = SHEETS[key], ss = ss_();
  var sh = ss.getSheetByName(cfg.name);
  if (!sh) {
    sh = ss.insertSheet(cfg.name);
    sh.getRange(1, 1, 1, cfg.headers.length).setValues([cfg.headers])
      .setFontWeight('bold').setBackground('#4A4A2A').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    sh.setRightToLeft(true);
  }
  _shCache[key] = sh;
  return sh;
}

/* קורא לשונית שלמה ומחזיר מערך אובייקטים (בלי שורות שנמחקו, אלא אם withDeleted) */
function readAll_(key, withDeleted) {
  var cfg = SHEETS[key], sh = sheet_(key);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, cfg.headers.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var row = vals[i];
    if (row[0] === '' || row[0] === null) continue;
    var o = { _row: i + 2 };
    for (var c = 0; c < cfg.fields.length; c++) {
      var f = cfg.fields[c], v = row[c];
      if (DATE_FIELDS[f])      o[f] = dstr_(v);
      else if (NUM_FIELDS[f])  o[f] = Number(v) || 0;
      else if (BOOL_FIELDS[f]) o[f] = (v === true || v === 'TRUE' || v === 1 || v === '1');
      else                     o[f] = (v === null || v === undefined) ? '' : String(v);
    }
    if (!withDeleted && o.deleted) continue;
    out.push(o);
  }
  return out;
}

function rowValues_(key, o) {
  var cfg = SHEETS[key];
  return cfg.fields.map(function (f) {
    var v = o[f];
    if (DATE_FIELDS[f]) return v ? toDate_(v) : '';
    if (NUM_FIELDS[f])  return Number(v) || 0;
    if (BOOL_FIELDS[f]) return !!v;
    return (v === null || v === undefined) ? '' : v;
  });
}

function insert_(key, o) {
  sheet_(key).appendRow(rowValues_(key, o));
  return o;
}

function findRow_(key, id) {
  var all = readAll_(key, true);
  for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return null;
}

function writeRow_(key, rowNum, o) {
  var cfg = SHEETS[key];
  sheet_(key).getRange(rowNum, 1, 1, cfg.headers.length).setValues([rowValues_(key, o)]);
}

/* =====================  עזרים  ===================== */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function uid_(p) {
  return (p || 'x') + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}
function dstr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  return m ? m[0] : String(v || '');
}
function toDate_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);   // צהריים — עוקף הפרשי אזור זמן
}
function now_()   { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function clean_(s, max) {
  return String(s === null || s === undefined ? '' : s).trim().slice(0, max || 200);
}
function err_(msg) { return json_({ ok: false, error: msg }); }

/* =====================  סיסמאות וטוקנים  ===================== */
function secret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('kupa_secret');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('kupa_secret', s); }
  return s;
}
function hashPass_(pass, salt) {
  var bytes = Utilities.newBlob(String(salt) + '|' + String(pass)).getBytes();
  for (var i = 0; i < PBKDF_ROUNDS; i++) {
    bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  }
  return 'v2$' + Utilities.base64Encode(bytes);
}

/* הגיבוב מהגרסה הראשונה — איטי (2,400 קריאות). נשאר רק כדי לאמת סיסמאות
   שנוצרו לפניו; בכניסה מוצלחת הן מוסבות אוטומטית לגיבוב החדש. */
function hashLegacy_(pass, salt) {
  var v = String(salt) + '|' + String(pass);
  for (var i = 0; i < 1200; i++) {
    v = Utilities.base64Encode(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, v, Utilities.Charset.UTF_8));
  }
  return v;
}

/* מאמת סיסמה מול משתמש. מחזיר true/false, ומשדרג גיבוב ישן תוך כדי. */
function verifyPass_(u, pass) {
  if (String(u.hash).indexOf('v2$') === 0) {
    return hashPass_(pass, u.salt) === u.hash;
  }
  if (hashLegacy_(pass, u.salt) !== u.hash) return false;
  try {
    u.hash = hashPass_(pass, u.salt);
    writeRow_('users', u._row, u);
  } catch (e) {}
  return true;
}
function newSalt_() { return Utilities.getUuid().replace(/-/g, ''); }

function sign_(payload) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(payload, secret_()));
}
function makeToken_(userId) {
  var payload = userId + '|' + (Date.now() + TOKEN_TTL);
  return Utilities.base64EncodeWebSafe(payload) + '.' + sign_(payload);
}
function readToken_(token) {
  try {
    var parts = String(token || '').split('.');
    if (parts.length !== 2) return null;
    var payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
    if (sign_(payload) !== parts[1]) return null;
    var bits = payload.split('|');
    if (Number(bits[1]) < Date.now()) return null;
    return bits[0];
  } catch (e) { return null; }
}

/* מחזיר את המשתמש המחובר, או null */
function auth_(token) {
  var uid = readToken_(token);
  if (!uid) return null;
  var users = readAll_('users', true);
  for (var i = 0; i < users.length; i++) {
    if (users[i].id === uid && users[i].active) return users[i];
  }
  return null;
}
function isManager_(u) { return !!u && (u.role === 'super' || u.role === 'admin'); }
function pubUser_(u) {
  return { id: u.id, username: u.username, fullName: u.fullName, role: u.role,
           active: u.active, createdAt: u.createdAt };
}

/* =====================  נקודת הכניסה  ===================== */
function doGet(e)  { return route_(e); }
function doPost(e) { return route_(e); }

function route_(e) {
  var p = (e && e.parameter) ? e.parameter : {};
  var action = p.action || '';
  try {
    switch (action) {
      case 'ping':         return json_({ ok: true, app: 'kupa', needsSetup: needsSetup_() });
      case 'setupSuper':   return setupSuper_(p);
      case 'login':        return login_(p);
      case 'load':         return load_(p);
      case 'saveEntry':    return saveEntry_(p);
      case 'deleteEntry':  return deleteEntry_(p);
      case 'addCategory':  return addCategory_(p);
      case 'saveCategory': return saveCategory_(p);
      case 'saveUser':     return saveUser_(p);
      case 'deleteUser':   return deleteUser_(p);
      case 'changePass':   return changePass_(p);
      default:             return err_('פעולה לא מוכרת: ' + action);
    }
  } catch (ex) {
    return err_('שגיאת שרת: ' + (ex && ex.message ? ex.message : ex));
  }
}

function needsSetup_() {
  var users = readAll_('users', true);
  for (var i = 0; i < users.length; i++) if (users[i].active) return false;
  return true;
}

/* ---------- התקנה ראשונית: יצירת המנהל הראשי ---------- */
function setupSuper_(p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (!needsSetup_()) return err_('המערכת כבר הותקנה');
    var username = clean_(p.username, 40).toLowerCase();
    var pass     = String(p.password || '');
    var fullName = clean_(p.fullName, 60) || username;
    if (username.length < 3) return err_('שם משתמש חייב 3 תווים לפחות');
    if (pass.length < 4)     return err_('סיסמה חייבת 4 תווים לפחות');

    var salt = newSalt_();
    var u = { id: uid_('u'), username: username, fullName: fullName, role: 'super',
              salt: salt, hash: hashPass_(pass, salt), active: true, createdAt: now_() };
    insert_('users', u);
    seedCategories_(u);
    var out = payload_(u);
    out.token = makeToken_(u.id);
    return json_(out);
  } finally { lock.releaseLock(); }
}

/* סוגי הוצאות התחלתיים — אפשר להוסיף ולשנות מתוך המערכת */
function seedCategories_(u) {
  var base = ['חומרי גלם', 'ניקיון', 'משלוחים', 'תחזוקה', 'ציוד מטבח',
              'דלק ונסיעות', 'כיבוד', 'ציוד משרדי', 'שונות'];
  for (var i = 0; i < base.length; i++) {
    insert_('categories', { id: uid_('c'), name: base[i], userName: u.fullName,
                            userId: u.id, createdAt: now_(), deleted: false });
  }
}

/* ---------- כניסה ---------- */
function login_(p) {
  var username = clean_(p.username, 40).toLowerCase();
  var pass = String(p.password || '');
  var users = readAll_('users', true);
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    if (String(u.username).toLowerCase() === username && u.active) {
      if (verifyPass_(u, pass)) {
        var out = payload_(u);
        out.token = makeToken_(u.id);
        return json_(out);
      }
      return err_('שם משתמש או סיסמה שגויים');
    }
  }
  return err_('שם משתמש או סיסמה שגויים');
}

/* ---------- טעינת כל הנתונים ---------- */
function load_(p) {
  var me = auth_(p.token);
  if (!me) return err_('פג תוקף החיבור — התחבר מחדש');
  return json_(payload_(me));
}

/* בונה את מצב המערכת המלא למשתמש נתון. משמש גם ב-load וגם בכניסה,
   כדי שהכניסה תסתיים בסבב רשת אחד ולא בשניים. */
function payload_(me) {
  var deposits    = readAll_('deposits');
  var withdrawals = readAll_('withdrawals');
  var categories  = readAll_('categories');

  var totalIn = 0, totalOut = 0;
  deposits.forEach(function (d)    { totalIn  += d.amount; delete d._row; });
  withdrawals.forEach(function (w) { totalOut += w.amount; delete w._row; });
  categories.forEach(function (c)  { delete c._row; });

  var out = {
    ok: true, user: pubUser_(me), today: today_(),
    deposits: deposits, withdrawals: withdrawals, categories: categories,
    totals: { deposits: totalIn, withdrawals: totalOut, balance: totalIn - totalOut }
  };
  if (isManager_(me)) {
    out.users = readAll_('users', true).map(function (u) { return pubUser_(u); });
  }
  return out;
}

/* ---------- הפקדה / משיכה: הוספה ועריכה ---------- */
function saveEntry_(p) {
  var me = auth_(p.token);
  if (!me) return err_('פג תוקף החיבור — התחבר מחדש');

  var kind = (p.kind === 'deposit') ? 'deposits' : 'withdrawals';
  var id   = clean_(p.id, 40);
  var date = dstr_(p.date) || today_();
  var amount = Number(p.amount);
  if (!isFinite(amount) || amount <= 0) return err_('יש להזין סכום גדול מאפס');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err_('תאריך לא תקין');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (id) {                                   /* ---- עריכה: מנהלים בלבד ---- */
      if (!isManager_(me)) return err_('רק מנהל רשאי לערוך שורות');
      var row = findRow_(kind, id);
      if (!row || row.deleted) return err_('השורה לא נמצאה');
      row.date = date; row.amount = amount; row.updatedAt = now_();
      if (kind === 'deposits') {
        row.note = clean_(p.note, 300);
      } else {
        var cat = catById_(clean_(p.catId, 40));
        if (!cat) return err_('יש לבחור סוג הוצאה');
        row.catId = cat.id; row.catName = cat.name;
        row.details = clean_(p.details, 500);
      }
      writeRow_(kind, row._row, row);
      delete row._row;
      return json_({ ok: true, entry: row });
    }

    /* ---- הוספה: כל משתמש ---- */
    var o = { id: uid_(kind === 'deposits' ? 'd' : 'w'), date: date, amount: amount,
              userName: me.fullName, userId: me.id, createdAt: now_(),
              updatedAt: '', deleted: false };
    if (kind === 'deposits') {
      o.note = clean_(p.note, 300);
    } else {
      var c2 = catById_(clean_(p.catId, 40));
      if (!c2) return err_('יש לבחור סוג הוצאה');
      o.catId = c2.id; o.catName = c2.name;
      o.details = clean_(p.details, 500);
    }
    insert_(kind, o);
    return json_({ ok: true, entry: o });
  } finally { lock.releaseLock(); }
}

function deleteEntry_(p) {
  var me = auth_(p.token);
  if (!me) return err_('פג תוקף החיבור — התחבר מחדש');
  if (!isManager_(me)) return err_('רק מנהל רשאי למחוק שורות');

  var kind = (p.kind === 'deposit') ? 'deposits' : 'withdrawals';
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var row = findRow_(kind, clean_(p.id, 40));
    if (!row) return err_('השורה לא נמצאה');
    row.deleted = true; row.updatedAt = now_();
    writeRow_(kind, row._row, row);
    return json_({ ok: true });
  } finally { lock.releaseLock(); }
}

/* ---------- סוגי הוצאות ---------- */
function catById_(id) {
  var all = readAll_('categories');
  for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return null;
}

function addCategory_(p) {                       /* כל משתמש רשאי להוסיף */
  var me = auth_(p.token);
  if (!me) return err_('פג תוקף החיבור — התחבר מחדש');
  var name = clean_(p.name, 60);
  if (!name) return err_('יש להזין שם לסוג ההוצאה');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var all = readAll_('categories');
    for (var i = 0; i < all.length; i++) {
      if (all[i].name === name) {
        return json_({ ok: true, category: { id: all[i].id, name: all[i].name }, existed: true });
      }
    }
    var c = { id: uid_('c'), name: name, userName: me.fullName, userId: me.id,
              createdAt: now_(), deleted: false };
    insert_('categories', c);
    return json_({ ok: true, category: c });
  } finally { lock.releaseLock(); }
}

function saveCategory_(p) {                      /* שינוי שם / מחיקה — מנהלים בלבד */
  var me = auth_(p.token);
  if (!me) return err_('פג תוקף החיבור — התחבר מחדש');
  if (!isManager_(me)) return err_('רק מנהל רשאי לשנות סוגי הוצאה');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var row = findRow_('categories', clean_(p.id, 40));
    if (!row) return err_('סוג ההוצאה לא נמצא');

    if (p.remove === '1') {
      var used = readAll_('withdrawals').filter(function (w) { return w.catId === row.id; });
      if (used.length) return err_('לא ניתן למחוק — הסוג משויך ל-' + used.length + ' משיכות');
      row.deleted = true;
      writeRow_('categories', row._row, row);
      return json_({ ok: true });
    }

    var name = clean_(p.name, 60);
    if (!name) return err_('יש להזין שם');
    var old = row.name;
    row.name = name;
    writeRow_('categories', row._row, row);

    if (old !== name) {   /* מסנכרן את השם גם בשורות המשיכה, כדי שהגיליון יישאר קריא */
      var sh = sheet_('withdrawals');
      var col = SHEETS.withdrawals.fields.indexOf('catName') + 1;
      readAll_('withdrawals', true).forEach(function (w) {
        if (w.catId === row.id) sh.getRange(w._row, col).setValue(name);
      });
    }
    return json_({ ok: true });
  } finally { lock.releaseLock(); }
}

/* ---------- משתמשים ---------- */
function saveUser_(p) {
  var me = auth_(p.token);
  if (!me) return err_('פג תוקף החיבור — התחבר מחדש');
  if (!isManager_(me)) return err_('רק מנהל רשאי לנהל משתמשים');

  var id       = clean_(p.id, 40);
  var username = clean_(p.username, 40).toLowerCase();
  var fullName = clean_(p.fullName, 60);
  var role     = clean_(p.role, 20);
  var pass     = String(p.password || '');
  var active   = (p.active !== '0');

  if (['super', 'admin', 'employee'].indexOf(role) < 0) return err_('תפקיד לא תקין');
  if (role === 'super' && me.role !== 'super') return err_('רק מנהל ראשי רשאי להגדיר מנהל ראשי');
  if (username.length < 3) return err_('שם משתמש חייב 3 תווים לפחות');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var users = readAll_('users', true);
    for (var i = 0; i < users.length; i++) {
      if (String(users[i].username).toLowerCase() === username && users[i].id !== id) {
        return err_('שם המשתמש כבר תפוס');
      }
    }

    if (id) {                                    /* ---- עדכון ---- */
      var u = null;
      for (var j = 0; j < users.length; j++) if (users[j].id === id) u = users[j];
      if (!u) return err_('המשתמש לא נמצא');
      if (u.role === 'super' && me.role !== 'super') {
        return err_('אין הרשאה לשנות את פרטי המנהל הראשי');
      }
      if (u.id === me.id && !active) return err_('אי אפשר להשבית את עצמך');
      if (u.role === 'super' && role !== 'super' && countSupers_(users) < 2) {
        return err_('חייב להישאר לפחות מנהל ראשי אחד');
      }
      u.username = username;
      u.fullName = fullName || username;
      u.role = role;
      u.active = active;
      if (pass) { u.salt = newSalt_(); u.hash = hashPass_(pass, u.salt); }
      writeRow_('users', u._row, u);
      return json_({ ok: true, user: pubUser_(u) });
    }

    /* ---- משתמש חדש ---- */
    if (pass.length < 4) return err_('סיסמה חייבת 4 תווים לפחות');
    var salt = newSalt_();
    var nu = { id: uid_('u'), username: username, fullName: fullName || username, role: role,
               salt: salt, hash: hashPass_(pass, salt), active: true, createdAt: now_() };
    insert_('users', nu);
    return json_({ ok: true, user: pubUser_(nu) });
  } finally { lock.releaseLock(); }
}

function countSupers_(users) {
  var n = 0;
  users.forEach(function (u) { if (u.role === 'super' && u.active) n++; });
  return n;
}

function deleteUser_(p) {
  var me = auth_(p.token);
  if (!me) return err_('פג תוקף החיבור — התחבר מחדש');
  if (!isManager_(me)) return err_('רק מנהל רשאי לנהל משתמשים');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var users = readAll_('users', true), u = null;
    for (var i = 0; i < users.length; i++) if (users[i].id === clean_(p.id, 40)) u = users[i];
    if (!u) return err_('המשתמש לא נמצא');
    if (u.id === me.id) return err_('אי אפשר למחוק את עצמך');
    if (u.role === 'super' && me.role !== 'super') return err_('אין הרשאה למחוק את המנהל הראשי');
    if (u.role === 'super' && countSupers_(users) < 2) return err_('חייב להישאר לפחות מנהל ראשי אחד');
    u.active = false;
    writeRow_('users', u._row, u);
    return json_({ ok: true });
  } finally { lock.releaseLock(); }
}

function changePass_(p) {                        /* כל משתמש מחליף לעצמו */
  var me = auth_(p.token);
  if (!me) return err_('פג תוקף החיבור — התחבר מחדש');
  var oldP = String(p.oldPassword || ''), newP = String(p.newPassword || '');
  if (newP.length < 4) return err_('הסיסמה החדשה חייבת 4 תווים לפחות');
  if (!verifyPass_(me, oldP)) return err_('הסיסמה הנוכחית שגויה');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    me.salt = newSalt_();
    me.hash = hashPass_(newP, me.salt);
    writeRow_('users', me._row, me);
    return json_({ ok: true });
  } finally { lock.releaseLock(); }
}
