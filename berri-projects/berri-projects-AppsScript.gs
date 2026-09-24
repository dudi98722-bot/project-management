/* =====================================================================
   BERRI — ניהול פרוייקטים   |   Google Apps Script (Web App)
   ---------------------------------------------------------------------
   השרת של המערכת. כל הנתונים נשמרים בגיליון Google Sheets רגיל —
   לשונית לכל טבלה, עם כותרות בעברית — כך שהגיליון הוא גם הגיבוי:
   אפשר לפתוח אותו בכל רגע ולראות בו כל פרוייקט, תשלום, הוצאה ותנועת קופה.
   שום שורה לא נמחקת פיזית — מחיקה מסמנת "נמחק" בעמודה האחרונה.

   ────────────  התקנה (פעם אחת, ~5 דק')  ────────────
   1. צור גיליון חדש בגוגל שיטס בשם "BERRI — ניהול פרוייקטים"
   2. בגיליון: תוספים ▸ Apps Script. מחק את הקוד הקיים, הדבק את כל הקובץ, שמור
   3. Deploy ▸ New deployment ▸ סוג "Web app"
        • Execute as:      Me
        • Who has access:  Anyone
      Deploy ▸ אשר הרשאות (Authorize / Allow)
   4. העתק את כתובת ה-Web app (מסתיימת ב-/exec) — היא תוטמע במערכת.
      עד אז אפשר להדביק אותה במסך הפתיחה של https://berri.dudi-ananalytics.com

   בכניסה הראשונה המערכת תבקש להגדיר מנהל — שם משתמש וסיסמה.
   עדכון קוד בעתיד: הדבק כאן מחדש ▸ Deploy ▸ Manage deployments ▸ עריכה ▸
   Version: New version ▸ Deploy.  (הכתובת נשארת אותה כתובת)
   ===================================================================== */

var APP            = 'berri';
var SCRIPT_VERSION = '2026-09-23';
var API_VERSION    = 1;
var TZ             = 'Asia/Jerusalem';
var SS_ID          = '';                         // ריק = הגיליון שהסקריפט מחובר אליו
var TOKEN_TTL      = 30 * 24 * 60 * 60 * 1000;   // תוקף כניסה: 30 יום
var HASH_ROUNDS    = 100;
var LOGIN_MAX_FAILS = 8;                         // ניסיונות כושלים לפני נעילה
var LOGIN_LOCK_SEC  = 15 * 60;                   //   נעילה ל-15 דקות
var HEAD_BG        = '#0F1642';
var ID_RE          = /^[a-z]{1,3}[a-z0-9]{6,30}$/;

/* ---------- הלשוניות. עמודות חדשות נוספות רק בסוף: הקריאה היא לפי מיקום ---------- */
var MOVE_TAIL = [['userName', 'נרשם על ידי'], ['userId', 'מזהה משתמש'], ['createdAt', 'נרשם בתאריך'],
                 ['updatedAt', 'עודכן בתאריך'], ['deleted', 'נמחק', 'bool']];
var TABLES = {
  users: { name: 'משתמשים', cols: [
    ['id', 'מזהה'], ['username', 'שם משתמש'], ['fullName', 'שם מלא'], ['role', 'תפקיד'],
    ['salt', 'מלח'], ['hash', 'סיסמה מוצפנת'], ['active', 'פעיל', 'bool'], ['createdAt', 'נוצר בתאריך']] },
  registers: { name: 'קופות', cols: [
    ['id', 'מזהה'], ['name', 'שם הקופה'], ['kind', 'סוג'], ['opening', 'יתרת פתיחה', 'money'],
    ['openingDate', 'יתרת הפתיחה נכונה לתאריך', 'date'], ['sort', 'סדר', 'num'], ['active', 'פעילה', 'bool'],
    ['note', 'הערה']].concat(MOVE_TAIL) },
  projects: { name: 'פרוייקטים', cols: [
    ['id', 'מזהה'], ['name', 'שם הפרוייקט'], ['client', 'לקוח'], ['clientPhone', 'טלפון לקוח'],
    ['address', 'כתובת'], ['subName', 'קבלן משנה'], ['subPhone', 'טלפון קבלן'],
    ['clientPrice', 'מחיר ללקוח', 'money'], ['subPrice', 'מחיר לקבלן משנה', 'money'],
    ['expected', 'צפי הוצאות', 'money'], ['startDate', 'תאריך התחלה', 'date'],
    ['endDate', 'תאריך סיום', 'date'], ['active', 'פעיל', 'bool'], ['note', 'הערות']].concat(MOVE_TAIL) },
  clientPayments: { name: 'תשלומי לקוחות', cols: [
    ['id', 'מזהה'], ['date', 'תאריך', 'date'], ['projectId', 'מזהה פרוייקט'], ['projectName', 'פרוייקט'],
    ['amount', 'סכום', 'money'], ['registerId', 'מזהה קופה'], ['registerName', 'לקופה'],
    ['method', 'אמצעי תשלום'], ['reference', 'אסמכתא'], ['note', 'הערה']].concat(MOVE_TAIL) },
  subPayments: { name: 'תשלומים לקבלני משנה', cols: [
    ['id', 'מזהה'], ['date', 'תאריך', 'date'], ['projectId', 'מזהה פרוייקט'], ['projectName', 'פרוייקט'],
    ['subName', 'קבלן משנה'], ['amount', 'סכום', 'money'], ['registerId', 'מזהה קופה'],
    ['registerName', 'מקופה'], ['method', 'אמצעי תשלום'], ['reference', 'אסמכתא'],
    ['note', 'הערה']].concat(MOVE_TAIL) },
  projectExpenses: { name: 'הוצאות פרוייקטים', cols: [
    ['id', 'מזהה'], ['date', 'תאריך', 'date'], ['projectId', 'מזהה פרוייקט'], ['projectName', 'פרוייקט'],
    ['amount', 'סכום', 'money'], ['registerId', 'מזהה קופה'], ['registerName', 'מקופה'],
    ['category', 'קטגוריה'], ['supplier', 'ספק / פירוט'], ['deductSub', 'מקוזז מקבלן המשנה', 'bool'],
    ['subName', 'קבלן משנה (בקיזוז)'], ['note', 'הערה']].concat(MOVE_TAIL) },
  businessExpenses: { name: 'הוצאות עסק', cols: [
    ['id', 'מזהה'], ['date', 'תאריך', 'date'], ['amount', 'סכום', 'money'], ['registerId', 'מזהה קופה'],
    ['registerName', 'מקופה'], ['category', 'קטגוריה'], ['supplier', 'ספק / פירוט'],
    ['note', 'הערה']].concat(MOVE_TAIL) },
  homeExpenses: { name: 'הוצאות בית', cols: [
    ['id', 'מזהה'], ['date', 'תאריך', 'date'], ['amount', 'סכום', 'money'], ['registerId', 'מזהה קופה'],
    ['registerName', 'מקופה'], ['category', 'קטגוריה'], ['supplier', 'פירוט'],
    ['note', 'הערה']].concat(MOVE_TAIL) },
  cashMoves: { name: 'תנועות קופה', cols: [
    ['id', 'מזהה'], ['date', 'תאריך', 'date'], ['type', 'קוד סוג'], ['typeHe', 'סוג התנועה'],
    ['amount', 'סכום', 'money'], ['registerId', 'מזהה קופה'], ['registerName', 'קופה'],
    ['toRegisterId', 'מזהה קופת יעד'], ['toRegisterName', 'לקופה (בהעברה)'],
    ['category', 'מקור / מטרה'], ['note', 'הערה']].concat(MOVE_TAIL) },
  categories: { name: 'קטגוריות', cols: [
    ['id', 'מזהה'], ['group', 'קוד קבוצה'], ['groupHe', 'קבוצה'], ['name', 'שם'], ['sort', 'סדר', 'num'],
    ['createdAt', 'נוצר בתאריך'], ['deleted', 'נמחק', 'bool']] }
};
var SCHEMA_VERSION = '1';

/* מי רשאי לכתוב לכל טבלה, ואיזו קבוצת קטגוריות משויכת אליה */
var RULES = {
  registers:        { prefix: 'r',  who: 'admin' },
  projects:         { prefix: 'p',  who: 'editor' },
  clientPayments:   { prefix: 'cp', who: 'editor' },
  subPayments:      { prefix: 'sp', who: 'editor' },
  projectExpenses:  { prefix: 'pe', who: 'editor', cat: 'project' },
  businessExpenses: { prefix: 'be', who: 'editor', cat: 'business' },
  homeExpenses:     { prefix: 'he', who: 'admin',  cat: 'home' },
  cashMoves:        { prefix: 'cm', who: 'editor' },
  categories:       { prefix: 'c',  who: 'editor' }
};
var MOVE_TABLES = ['clientPayments', 'subPayments', 'projectExpenses', 'businessExpenses', 'homeExpenses', 'cashMoves'];
var PROJECT_TABLES = ['clientPayments', 'subPayments', 'projectExpenses'];
var GROUPS = { project: 'הוצאות פרוייקט', business: 'הוצאות עסק', home: 'הוצאות בית',
               'in': 'כסף נכנס לקופה', out: 'כסף יצא מקופה' };
var CAT_TABLE = { project: 'projectExpenses', business: 'businessExpenses', home: 'homeExpenses',
                  'in': 'cashMoves', out: 'cashMoves' };
var MOVE_TYPES = { 'in': 'כסף נכנס לקופה', out: 'כסף יצא מקופה', transfer: 'העברה בין קופות' };
var REG_KINDS = ['מזומן', 'בנק', 'צ׳קים', 'אשראי', 'אחר'];
var METHODS = ['העברה בנקאית', 'צ׳ק', 'מזומן', 'אשראי', 'אחר'];
var ROLES = { admin: 'מנהל', editor: 'עורך', viewer: 'צופה' };

/* =====================  תשתית גיליון  ===================== */
var _ss = null, _sh = {}, _memo = {};

function ss_() {
  if (_ss) return _ss;
  if (SS_ID) return (_ss = SpreadsheetApp.openById(SS_ID));
  var props = PropertiesService.getScriptProperties();
  var saved = props.getProperty('berri_ss_id');
  if (saved) { try { return (_ss = SpreadsheetApp.openById(saved)); } catch (e) {} }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return (_ss = active);
  /* פרויקט עצמאי שאינו מחובר לגיליון — יוצרים גיליון וזוכרים אותו */
  _ss = SpreadsheetApp.create('BERRI — ניהול פרוייקטים');
  props.setProperty('berri_ss_id', _ss.getId());
  return _ss;
}

function cols_(key) {
  return TABLES[key].cols.map(function (c) { return { f: c[0], h: c[1], t: c[2] || 'text' }; });
}

function sheet_(key) {
  if (_sh[key]) return _sh[key];
  var cfg = TABLES[key], ss = ss_();
  var sh = ss.getSheetByName(cfg.name);
  if (!sh) {
    sh = ss.insertSheet(cfg.name);
    var cols = cols_(key);
    sh.getRange(1, 1, 1, cols.length).setValues([cols.map(function (c) { return c.h; })])
      .setFontWeight('bold').setBackground(HEAD_BG).setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    sh.setRightToLeft(true);
    var n = Math.max(sh.getMaxRows() - 1, 1);
    cols.forEach(function (c, i) {
      if (c.t === 'date')  sh.getRange(2, i + 1, n, 1).setNumberFormat('dd/mm/yyyy');
      if (c.t === 'money') sh.getRange(2, i + 1, n, 1).setNumberFormat('#,##0.##');
    });
  }
  return (_sh[key] = sh);
}

/* כל השורות של לשונית (כולל מחוקות), כאובייקטים עם מספר השורה בגיליון.
   נקרא פעם אחת לכל בקשה — כתיבות מעדכנות את העותק בזיכרון. */
function rows_(key) {
  if (_memo[key]) return _memo[key];
  var cols = cols_(key), sh = sheet_(key), last = sh.getLastRow(), out = [];
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, cols.length).getValues();
    for (var i = 0; i < vals.length; i++) {
      var row = vals[i];
      if (row[0] === '' || row[0] === null) continue;
      var o = { _row: i + 2 };
      for (var c = 0; c < cols.length; c++) o[cols[c].f] = fromCell_(cols[c].t, row[c]);
      out.push(o);
    }
  }
  return (_memo[key] = out);
}
function live_(key) { return rows_(key).filter(function (r) { return !r.deleted; }); }
function find_(key, id) {
  var all = rows_(key);
  for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return null;
}

function fromCell_(t, v) {
  if (t === 'date')  return dstr_(v);
  if (t === 'money' || t === 'num') return Number(v) || 0;
  if (t === 'bool')  return v === true || v === 'TRUE' || v === 1 || v === '1';
  return (v === null || v === undefined) ? '' : String(v);
}
function toCell_(t, v) {
  if (t === 'date')  return v ? toDate_(v) : '';
  if (t === 'money' || t === 'num') return Number(v) || 0;
  if (t === 'bool')  return !!v;
  return asText_(v);
}
/* גוגל שיטס הופך "050…" למספר, "1/2" לתאריך ו-"=…" לנוסחה. גרש בתחילת התא
   שומר אותו כטקסט כפי שנכתב — והגרש עצמו אינו חלק מהערך שנקרא בחזרה. */
function asText_(v) {
  var s = (v === null || v === undefined) ? '' : String(v);
  if (s === '') return '';
  if (/\d/.test(s) || /^[=+\-@']/.test(s) || /^(true|false)$/i.test(s)) return "'" + s;
  return s;
}
function rowValues_(key, o) {
  return cols_(key).map(function (c) { return toCell_(c.t, o[c.f]); });
}
function insert_(key, o) {
  var sh = sheet_(key);
  sh.appendRow(rowValues_(key, o));
  o._row = sh.getLastRow();
  rows_(key).push(o);
  return o;
}
function update_(key, o) {
  sheet_(key).getRange(o._row, 1, 1, cols_(key).length).setValues([rowValues_(key, o)]);
  var all = rows_(key);
  for (var i = 0; i < all.length; i++) if (all[i].id === o.id) all[i] = o;
}
/* משנה עמודה אחת בכל השורות המתאימות — בכתיבה אחת לגיליון */
function syncColumn_(key, match, field, value) {
  var cols = cols_(key), idx = -1;
  for (var i = 0; i < cols.length; i++) if (cols[i].f === field) idx = i;
  var hits = rows_(key).filter(match);
  if (idx < 0 || !hits.length) return 0;
  var sh = sheet_(key), rng = sh.getRange(2, idx + 1, sh.getLastRow() - 1, 1), vals = rng.getValues();
  hits.forEach(function (r) { r[field] = value; vals[r._row - 2][0] = toCell_(cols[idx].t, value); });
  rng.setValues(vals);
  return hits.length;
}

/* משלים כותרות של עמודות שנוספו בגרסה חדשה, בלי להזיז שום נתון */
function ensureSchema_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('berri_schema') === SCHEMA_VERSION) return;
  Object.keys(TABLES).forEach(function (key) {
    var cols = cols_(key), sh = sheet_(key);
    var head = sh.getRange(1, 1, 1, cols.length).getValues()[0];
    for (var i = 0; i < cols.length; i++) {
      var cur = String(head[i] === null || head[i] === undefined ? '' : head[i]).trim();
      if (cur === cols[i].h || cur !== '') continue;   // כותרת ששונתה ידנית לא מפריעה
      sh.getRange(1, i + 1).setValue(cols[i].h)
        .setFontWeight('bold').setBackground(HEAD_BG).setFontColor('#FFFFFF');
    }
  });
  props.setProperty('berri_schema', SCHEMA_VERSION);
}

/* =====================  עזרים  ===================== */
function Bad(msg) { this.msg = msg; }
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function err_(msg) { return json_({ ok: false, error: msg }); }
function expired_() { return json_({ ok: false, error: 'פג תוקף החיבור — התחבר מחדש', expired: true }); }
function uid_(p) {
  return p + Date.now().toString(36) + Math.floor(Math.random() * 1e8).toString(36);
}
function dstr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  return m ? m[0] : '';
}
function toDate_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '';
  return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);   // צהריים — עוקף הפרשי אזורי זמן
}
function now_()   { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function clean_(s, max) {
  return String(s === null || s === undefined ? '' : s).replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, max || 200);
}
function num_(v) {
  if (v === '' || v === null || v === undefined) return 0;
  var n = Number(String(v).replace(/[,\s₪]/g, ''));
  return isFinite(n) ? Math.round(n * 100) / 100 : null;
}
function validDate_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return false;
  var d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
}
function strip_(o) {
  var c = {};
  Object.keys(o).forEach(function (k) { if (k !== '_row' && k !== 'deleted') c[k] = o[k]; });
  return c;
}

/* =====================  סיסמאות, טוקנים והרשאות  ===================== */
function secret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('berri_secret');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('berri_secret', s); }
  return s;
}
function hashPass_(pass, salt) {
  var bytes = Utilities.newBlob(String(salt) + '|' + String(pass)).getBytes();
  for (var i = 0; i < HASH_ROUNDS; i++) {
    bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  }
  return 'v1$' + Utilities.base64Encode(bytes);
}
function newSalt_() { return Utilities.getUuid().replace(/-/g, ''); }
function sign_(payload) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, secret_()));
}
/* הטוקן נושא חותמת מהסיסמה: החלפת סיסמה מנתקת את כל החיבורים הישנים */
function makeToken_(u) {
  var payload = u.id + '|' + (Date.now() + TOKEN_TTL) + '|' + String(u.hash).slice(-10);
  return Utilities.base64EncodeWebSafe(payload) + '.' + sign_(payload);
}
function auth_(token) {
  try {
    var parts = String(token || '').split('.');
    if (parts.length !== 2) return null;
    var payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
    if (sign_(payload) !== parts[1]) return null;
    var bits = payload.split('|');
    if (Number(bits[1]) < Date.now()) return null;
    var u = find_('users', bits[0]);
    if (!u || !u.active || String(u.hash).slice(-10) !== bits[2]) return null;
    return u;
  } catch (e) { return null; }
}
function can_(me, need) {
  if (need === 'admin') return me.role === 'admin';
  return me.role === 'admin' || me.role === 'editor';
}
function pubUser_(u) {
  return { id: u.id, username: u.username, fullName: u.fullName, role: u.role,
           active: u.active, createdAt: u.createdAt };
}
function admins_() { return live_('users').filter(function (u) { return u.active && u.role === 'admin'; }); }
function needsSetup_() { return !rows_('users').some(function (u) { return u.active; }); }

/* =====================  נקודת הכניסה  ===================== */
function doGet(e)  { return route_(e); }
function doPost(e) { return route_(e); }

function route_(e) {
  var p = (e && e.parameter) ? e.parameter : {};
  try {
    ensureSchema_();
    switch (p.action || '') {
      case '':
      case 'ping':       return json_({ ok: true, app: APP, apiVersion: API_VERSION,
                                        scriptVersion: SCRIPT_VERSION, needsSetup: needsSetup_() });
      case 'setup':      return setupAdmin_(p);
      case 'login':      return login_(p);
      case 'load':       return load_(p);
      case 'save':       return save_(p);
      case 'remove':     return remove_(p, true);
      case 'restore':    return remove_(p, false);
      case 'saveUser':   return saveUser_(p);
      case 'deleteUser': return deleteUser_(p);
      case 'changePass': return changePass_(p);
      default:           return err_('פעולה לא מוכרת');
    }
  } catch (ex) {
    if (ex instanceof Bad) return err_(ex.msg);
    return err_('שגיאת שרת: ' + (ex && ex.message ? ex.message : ex));
  }
}

/* להרצה ידנית מהעורך (לא חובה): יוצר את כל הלשוניות ומדפיס לאיזה גיליון הסקריפט מחובר */
function setup() {
  Object.keys(TABLES).forEach(function (k) { sheet_(k); });
  ensureSchema_();
  var msg = '✅ מחובר לגיליון: ' + ss_().getName() + '\n' + ss_().getUrl();
  Logger.log(msg);
  return msg;
}

/* ---------- התקנה ראשונה: המנהל הראשון + קופות וקטגוריות התחלתיות ---------- */
function setupAdmin_(p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    if (!needsSetup_()) return err_('המערכת כבר הותקנה — יש להתחבר');
    var username = clean_(p.username, 40).toLowerCase();
    var pass = String(p.password || '');
    if (username.length < 3) return err_('שם משתמש חייב 3 תווים לפחות');
    if (pass.length < 6) return err_('סיסמה חייבת 6 תווים לפחות');
    var salt = newSalt_();
    var u = insert_('users', { id: uid_('u'), username: username, fullName: clean_(p.fullName, 60) || username,
      role: 'admin', salt: salt, hash: hashPass_(pass, salt), active: true, createdAt: now_() });
    seed_(u);
    var out = payload_(u);
    out.token = makeToken_(u);
    return json_(out);
  } finally { lock.releaseLock(); }
}

function seed_(u) {
  var stamp = now_();
  if (!live_('registers').length) {
    [['קופה ראשית', 'מזומן'], ['בנק', 'בנק']].forEach(function (r, i) {
      insert_('registers', { id: uid_('r'), name: r[0], kind: r[1], opening: 0, openingDate: '',
        sort: i + 1, active: true, note: '', userName: u.fullName, userId: u.id,
        createdAt: stamp, updatedAt: '', deleted: false });
    });
  }
  if (live_('categories').length) return;
  var base = {
    project:  ['חומרי בניין', 'ציוד והשכרת כלים', 'הובלות', 'פועלים', 'מהנדס / פיקוח',
               'אגרות והיתרים', 'חשמל ואינסטלציה', 'שונות'],
    business: ['שכירות משרד', 'רכב ודלק', 'טלפון ותקשורת', 'רואה חשבון', 'ביטוחים', 'משכורות',
               'מיסים (מע״מ / מס הכנסה)', 'פרסום ושיווק', 'ציוד משרדי', 'עמלות בנק', 'שונות'],
    home:     ['מזון וסופר', 'חשבונות (חשמל / מים / גז)', 'ארנונה', 'חינוך', 'ביגוד', 'בריאות',
               'רכב פרטי', 'שבת וחגים', 'שונות'],
    'in':     ['הפקדת בעלים', 'הלוואה', 'הכנסה אחרת'],
    out:      ['משיכת בעלים', 'החזר הלוואה', 'אחר']
  };
  Object.keys(base).forEach(function (g) {
    base[g].forEach(function (name, i) {
      insert_('categories', { id: uid_('c'), group: g, groupHe: GROUPS[g], name: name, sort: i + 1,
        createdAt: stamp, deleted: false });
    });
  });
}

/* ---------- כניסה ---------- */
function login_(p) {
  var username = clean_(p.username, 40).toLowerCase();
  var cache = CacheService.getScriptCache(), ck = 'lf_' + username;
  var fails = Number(cache.get(ck) || 0);
  if (fails >= LOGIN_MAX_FAILS) return err_('יותר מדי ניסיונות כושלים — נסה שוב בעוד רבע שעה');
  var u = rows_('users').filter(function (x) {
    return x.active && String(x.username).toLowerCase() === username;
  })[0];
  if (!u || hashPass_(String(p.password || ''), u.salt) !== u.hash) {
    cache.put(ck, String(fails + 1), LOGIN_LOCK_SEC);
    return err_('שם משתמש או סיסמה שגויים');
  }
  cache.remove(ck);
  var out = payload_(u);
  out.token = makeToken_(u);
  return json_(out);
}

function load_(p) {
  var me = auth_(p.token);
  if (!me) return expired_();
  return json_(payload_(me));
}

/* כל מצב המערכת למשתמש נתון — משמש גם בכניסה, כדי שתסתיים בסבב רשת אחד.
   מי שאינו מנהל מקבל את הוצאות הבית בלי פירוט: רק סכום, תאריך וקופה,
   כדי שיתרות הקופות יהיו נכונות גם אצלו. */
function payload_(me) {
  var out = { ok: true, app: APP, apiVersion: API_VERSION, scriptVersion: SCRIPT_VERSION,
              today: today_(), user: pubUser_(me) };
  ['registers', 'projects', 'clientPayments', 'subPayments', 'projectExpenses',
   'businessExpenses', 'cashMoves', 'categories'].forEach(function (k) { out[k] = live_(k).map(strip_); });
  var home = live_('homeExpenses');
  if (me.role === 'admin') {
    out.homeExpenses = home.map(strip_);
    out.users = rows_('users').map(pubUser_);
    out.sheetUrl = ss_().getUrl();
  } else {
    out.homeExpenses = home.map(function (h) {
      return { id: h.id, date: h.date, amount: h.amount, registerId: h.registerId,
               registerName: h.registerName, masked: true };
    });
    out.categories = out.categories.filter(function (c) { return c.group !== 'home'; });
  }
  return out;
}

/* =====================  שמירת שורה (הוספה או עדכון)  ===================== */
function save_(p) {
  var me = auth_(p.token);
  if (!me) return expired_();
  var key = String(p.table || ''), rule = RULES[key];
  if (!rule) return err_('טבלה לא מוכרת');
  var inp;
  try { inp = JSON.parse(p.row || '{}'); } catch (e) { return err_('נתונים לא תקינים'); }
  if (!inp || typeof inp !== 'object') return err_('נתונים לא תקינים');
  var need = (key === 'categories' && inp.group === 'home') ? 'admin' : rule.who;
  if (!can_(me, need)) return err_(need === 'admin' ? 'הפעולה מותרת למנהל בלבד' : 'אין לך הרשאה לשנות נתונים');
  var id = clean_(inp.id, 40);
  if (id && !ID_RE.test(id)) return err_('מזהה לא תקין');

  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    /* המזהה נוצר בדפדפן: לחיצה כפולה או ניסיון חוזר אחרי ניתוק
       מגיעים עם אותו מזהה והופכים לעדכון — לא לשורה כפולה */
    var cur = id ? find_(key, id) : null;
    if (cur && cur.deleted) return err_('השורה נמחקה בינתיים — רענן את הנתונים');
    if (cur && key === 'categories' && cur.group === 'home' && me.role !== 'admin') {
      return err_('הפעולה מותרת למנהל בלבד');
    }
    var o = build_(key, inp, cur);
    var newCat = null;
    if (cur) {
      o._row = cur._row; o.id = cur.id; o.deleted = false;
      if ('createdAt' in cur) o.createdAt = cur.createdAt;
      if ('userName' in cur) { o.userName = cur.userName; o.userId = cur.userId; o.updatedAt = now_(); }
      update_(key, o);
      afterUpdate_(key, cur, o);
    } else {
      o.id = id || uid_(rule.prefix);
      o.createdAt = now_(); o.deleted = false;
      if (key !== 'categories') { o.userName = me.fullName; o.userId = me.id; o.updatedAt = ''; }
      insert_(key, o);
    }
    var g = rule.cat || (key === 'cashMoves' && o.type !== 'transfer' ? o.type : '');
    if (g && o.category && (g !== 'home' || me.role === 'admin')) newCat = ensureCategory_(g, o.category);
    return json_({ ok: true, row: strip_(o), category: newCat ? strip_(newCat) : null });
  } finally { lock.releaseLock(); }
}

/* בונה את השורה מהקלט: רק שדות מוכרים, בסוג הנכון, עם בדיקות תקינות.
   שדה שלא נשלח נשאר כפי שהיה בגיליון. */
function build_(key, inp, cur) {
  var o = {};
  cols_(key).forEach(function (c) { o[c.f] = cur ? cur[c.f] : (c.t === 'bool' ? false : (c.t === 'text' ? '' : 0)); });
  if (!cur) { ['date', 'startDate', 'endDate', 'openingDate'].forEach(function (f) { if (f in o) o[f] = ''; }); }
  function has(f) { return inp[f] !== undefined && inp[f] !== null; }
  function text(f, max) { if (has(f)) o[f] = clean_(inp[f], max); }
  function money(f, allowNeg) {
    if (!has(f)) return;
    var n = num_(inp[f]);
    if (n === null) throw new Bad('סכום לא תקין');
    if (n < 0 && !allowNeg) throw new Bad('סכום לא יכול להיות שלילי');
    o[f] = n;
  }
  function date(f, required) {
    if (has(f)) {
      var s = String(inp[f]).trim();
      if (s && !validDate_(s)) throw new Bad('תאריך לא תקין');
      o[f] = s;
    }
    if (required && !o[f]) throw new Bad('יש לבחור תאריך');
  }
  function bool(f) { if (has(f)) o[f] = (inp[f] === true || inp[f] === 'true' || inp[f] === 1 || inp[f] === '1'); }
  function amount() { money('amount'); if (!(o.amount > 0)) throw new Bad('יש להזין סכום גדול מאפס'); }
  function register(f, nameF) {
    if (has(f)) o[f] = clean_(inp[f], 40);
    var r = o[f] ? find_('registers', o[f]) : null;
    if (!r || r.deleted) throw new Bad('יש לבחור קופה');
    o[nameF] = r.name;
    return r;
  }
  function project() {
    if (has('projectId')) o.projectId = clean_(inp.projectId, 40);
    var pr = o.projectId ? find_('projects', o.projectId) : null;
    if (!pr || pr.deleted) throw new Bad('יש לבחור פרוייקט');
    o.projectName = pr.name;
    return pr;
  }
  function pick(f, list) {
    if (!has(f)) return;
    var v = clean_(inp[f], 40);
    if (v && list.indexOf(v) < 0) throw new Bad('ערך לא תקין');
    o[f] = v;
  }

  switch (key) {
    case 'registers':
      text('name', 60); if (!o.name) throw new Bad('יש להזין שם לקופה');
      if (live_('registers').some(function (r) { return r.name === o.name && (!cur || r.id !== cur.id); })) {
        throw new Bad('כבר קיימת קופה בשם הזה');
      }
      pick('kind', REG_KINDS); if (!o.kind) o.kind = 'אחר';
      money('opening', true); date('openingDate'); money('sort', true);
      if (!cur) o.active = true;
      bool('active'); text('note', 500);
      break;
    case 'projects':
      text('name', 80); if (!o.name) throw new Bad('יש להזין שם לפרוייקט');
      text('client', 80); text('clientPhone', 30); text('address', 120);
      text('subName', 80); text('subPhone', 30);
      money('clientPrice'); money('subPrice'); money('expected');
      date('startDate'); date('endDate');
      if (o.startDate && o.endDate && o.endDate < o.startDate) throw new Bad('תאריך הסיום לפני תאריך ההתחלה');
      if (!cur) o.active = true;
      bool('active'); text('note', 1000);
      break;
    case 'clientPayments':
    case 'subPayments':
      date('date', true); amount();
      var pr = project();
      register('registerId', 'registerName');
      pick('method', METHODS); text('reference', 60); text('note', 500);
      if (key === 'subPayments') o.subName = pr.subName;
      break;
    case 'projectExpenses':
      date('date', true); amount();
      var pr2 = project();
      register('registerId', 'registerName');
      text('category', 60); text('supplier', 120); bool('deductSub'); text('note', 500);
      o.subName = o.deductSub ? pr2.subName : '';
      break;
    case 'businessExpenses':
    case 'homeExpenses':
      date('date', true); amount();
      register('registerId', 'registerName');
      text('category', 60); text('supplier', 120); text('note', 500);
      break;
    case 'cashMoves':
      date('date', true); amount();
      if (has('type')) o.type = clean_(inp.type, 10);
      if (!MOVE_TYPES[o.type]) throw new Bad('סוג תנועה לא תקין');
      o.typeHe = MOVE_TYPES[o.type];
      var from = register('registerId', 'registerName');
      if (o.type === 'transfer') {
        var to = register('toRegisterId', 'toRegisterName');
        if (to.id === from.id) throw new Bad('בהעברה יש לבחור שתי קופות שונות');
        o.category = '';
      } else {
        o.toRegisterId = ''; o.toRegisterName = '';
        text('category', 60);
      }
      text('note', 500);
      break;
    case 'categories':
      if (cur) { o.group = cur.group; } else { o.group = clean_(inp.group, 10); }
      if (!GROUPS[o.group]) throw new Bad('קבוצה לא תקינה');
      o.groupHe = GROUPS[o.group];
      text('name', 60); if (!o.name) throw new Bad('יש להזין שם');
      if (live_('categories').some(function (c) {
        return c.group === o.group && c.name === o.name && (!cur || c.id !== cur.id);
      })) throw new Bad('הקטגוריה כבר קיימת');
      money('sort', true);
      break;
  }
  return o;
}

/* שינוי שם מתעדכן גם בשורות שמפנות אליו — כדי שהגיליון יישאר קריא */
function afterUpdate_(key, cur, o) {
  if (key === 'registers' && cur.name !== o.name) {
    MOVE_TABLES.forEach(function (t) {
      syncColumn_(t, function (r) { return r.registerId === o.id; }, 'registerName', o.name);
    });
    syncColumn_('cashMoves', function (r) { return r.toRegisterId === o.id; }, 'toRegisterName', o.name);
  }
  if (key === 'projects') {
    if (cur.name !== o.name) {
      PROJECT_TABLES.forEach(function (t) {
        syncColumn_(t, function (r) { return r.projectId === o.id; }, 'projectName', o.name);
      });
    }
    if (cur.subName !== o.subName) {
      syncColumn_('subPayments', function (r) { return r.projectId === o.id; }, 'subName', o.subName);
      syncColumn_('projectExpenses', function (r) { return r.projectId === o.id && r.deductSub; }, 'subName', o.subName);
    }
  }
  if (key === 'categories' && cur.name !== o.name) {
    syncColumn_(CAT_TABLE[o.group], function (r) {
      return r.category === cur.name && (o.group !== 'in' && o.group !== 'out' || r.type === o.group);
    }, 'category', o.name);
  }
}

/* קטגוריה חדשה שהוקלדה בטופס נוספת לרשימה, כדי שתוצע בפעם הבאה */
function ensureCategory_(group, name) {
  var all = rows_('categories').filter(function (c) { return c.group === group && c.name === name; });
  if (all.some(function (c) { return !c.deleted; })) return null;
  if (all.length) { all[0].deleted = false; update_('categories', all[0]); return all[0]; }
  var max = 0;
  rows_('categories').forEach(function (c) { if (c.group === group && c.sort > max) max = c.sort; });
  return insert_('categories', { id: uid_('c'), group: group, groupHe: GROUPS[group], name: name,
    sort: max + 1, createdAt: now_(), deleted: false });
}

/* =====================  מחיקה ושחזור  ===================== */
/* מחיקה רכה: השורה נשארת בגיליון עם סימון "נמחק", וניתן לבטל אותה */
function remove_(p, del) {
  var me = auth_(p.token);
  if (!me) return expired_();
  var key = String(p.table || ''), rule = RULES[key];
  if (!rule) return err_('טבלה לא מוכרת');
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var cur = find_(key, clean_(p.id, 40));
    if (!cur) return err_('השורה לא נמצאה');
    var need = (key === 'categories' && cur.group === 'home') ? 'admin' : rule.who;
    if (!can_(me, need)) return err_(need === 'admin' ? 'הפעולה מותרת למנהל בלבד' : 'אין לך הרשאה לשנות נתונים');
    if (del) {
      if (cur.deleted) return json_({ ok: true });
      if (key === 'projects') {
        var n = 0;
        PROJECT_TABLES.forEach(function (t) {
          n += live_(t).filter(function (r) { return r.projectId === cur.id; }).length;
        });
        if (n) return err_('בפרוייקט יש ' + n + ' תנועות. אפשר לסמן אותו כלא פעיל, או למחוק קודם את התנועות.');
      }
      if (key === 'registers') {
        var m = 0;
        MOVE_TABLES.forEach(function (t) {
          m += live_(t).filter(function (r) { return r.registerId === cur.id || r.toRegisterId === cur.id; }).length;
        });
        if (m) return err_('בקופה יש ' + m + ' תנועות. אפשר להעביר אותה ללא פעילה במקום למחוק.');
      }
    } else {
      if (!cur.deleted) return json_({ ok: true, row: strip_(cur) });
      if (cur.projectId) { var pr = find_('projects', cur.projectId); if (!pr || pr.deleted) return err_('הפרוייקט של השורה נמחק'); }
      if (cur.registerId) { var rg = find_('registers', cur.registerId); if (!rg || rg.deleted) return err_('הקופה של השורה נמחקה'); }
    }
    cur.deleted = del;
    if ('updatedAt' in cur) cur.updatedAt = now_();
    update_(key, cur);
    return json_({ ok: true, row: strip_(cur) });
  } finally { lock.releaseLock(); }
}

/* =====================  משתמשים  ===================== */
function saveUser_(p) {
  var me = auth_(p.token);
  if (!me) return expired_();
  if (me.role !== 'admin') return err_('ניהול משתמשים מותר למנהל בלבד');
  var id = clean_(p.id, 40), username = clean_(p.username, 40).toLowerCase();
  var fullName = clean_(p.fullName, 60), role = clean_(p.role, 10), pass = String(p.password || '');
  var active = (p.active !== '0');
  if (!ROLES[role]) return err_('תפקיד לא תקין');
  if (!/^[a-z0-9._\-֐-׿]{3,40}$/.test(username)) return err_('שם משתמש: 3 תווים לפחות, בלי רווחים');

  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var users = rows_('users');
    if (users.some(function (u) { return u.active && String(u.username).toLowerCase() === username && u.id !== id; })) {
      return err_('שם המשתמש כבר תפוס');
    }
    if (id) {
      var u = find_('users', id);
      if (!u) return err_('המשתמש לא נמצא');
      if (u.id === me.id && (!active || role !== 'admin')) return err_('אי אפשר להוריד הרשאות מעצמך');
      if (u.role === 'admin' && (role !== 'admin' || !active) && admins_().length < 2) {
        return err_('חייב להישאר לפחות מנהל אחד פעיל');
      }
      if (pass && pass.length < 6) return err_('סיסמה חייבת 6 תווים לפחות');
      u.username = username; u.fullName = fullName || username; u.role = role; u.active = active;
      if (pass) { u.salt = newSalt_(); u.hash = hashPass_(pass, u.salt); }
      update_('users', u);
      return json_({ ok: true, user: pubUser_(u) });
    }
    if (pass.length < 6) return err_('סיסמה חייבת 6 תווים לפחות');
    var salt = newSalt_();
    var nu = insert_('users', { id: uid_('u'), username: username, fullName: fullName || username, role: role,
      salt: salt, hash: hashPass_(pass, salt), active: true, createdAt: now_() });
    return json_({ ok: true, user: pubUser_(nu) });
  } finally { lock.releaseLock(); }
}

function deleteUser_(p) {
  var me = auth_(p.token);
  if (!me) return expired_();
  if (me.role !== 'admin') return err_('ניהול משתמשים מותר למנהל בלבד');
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var u = find_('users', clean_(p.id, 40));
    if (!u) return err_('המשתמש לא נמצא');
    if (u.id === me.id) return err_('אי אפשר להשבית את עצמך');
    if (u.role === 'admin' && u.active && admins_().length < 2) return err_('חייב להישאר לפחות מנהל אחד פעיל');
    u.active = false;
    update_('users', u);
    return json_({ ok: true });
  } finally { lock.releaseLock(); }
}

function changePass_(p) {
  var me = auth_(p.token);
  if (!me) return expired_();
  var newP = String(p.newPassword || '');
  if (newP.length < 6) return err_('הסיסמה החדשה חייבת 6 תווים לפחות');
  if (hashPass_(String(p.oldPassword || ''), me.salt) !== me.hash) return err_('הסיסמה הנוכחית שגויה');
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    me.salt = newSalt_();
    me.hash = hashPass_(newP, me.salt);
    update_('users', me);
    return json_({ ok: true, token: makeToken_(me) });   // החיבורים האחרים מתנתקים
  } finally { lock.releaseLock(); }
}
