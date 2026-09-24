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
var SCRIPT_VERSION = '2026-09-25-perms';   // להעלות בכל שינוי — כך רואים ב-ping איזו גרסה פרוסה
var API_VERSION    = 3;    // 2 = עדכון מרוכז, 3 = הרשאות לפי משתמש. הדפדפן בודק את המספר לפני שהוא מציע יכולת
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
    ['salt', 'מלח'], ['hash', 'סיסמה מוצפנת'], ['active', 'פעיל', 'bool'], ['createdAt', 'נוצר בתאריך'],
    ['perms', 'הרשאות (JSON)']] },
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
  additions: { name: 'תוספות לפרוייקט', cols: [
    ['id', 'מזהה'], ['date', 'תאריך', 'date'], ['projectId', 'מזהה פרוייקט'], ['projectName', 'פרוייקט'],
    ['description', 'תיאור התוספת'], ['clientAmount', 'תוספת למחיר ללקוח', 'money'],
    ['subAmount', 'תוספת למחיר לקבלן', 'money'], ['note', 'הערה']].concat(MOVE_TAIL) },
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
var SCHEMA_VERSION = '3';   // 3 = עמודת הרשאות בלשונית המשתמשים

/* מי רשאי לכתוב לכל טבלה, ואיזו קבוצת קטגוריות משויכת אליה */
var RULES = {
  registers:        { prefix: 'r',  who: 'admin' },
  projects:         { prefix: 'p',  who: 'editor' },
  additions:        { prefix: 'ad', who: 'editor' },
  clientPayments:   { prefix: 'cp', who: 'editor' },
  subPayments:      { prefix: 'sp', who: 'editor' },
  projectExpenses:  { prefix: 'pe', who: 'editor', cat: 'project' },
  businessExpenses: { prefix: 'be', who: 'editor', cat: 'business' },
  homeExpenses:     { prefix: 'he', who: 'admin',  cat: 'home' },
  cashMoves:        { prefix: 'cm', who: 'editor' },
  categories:       { prefix: 'c',  who: 'editor' }
};
var MOVE_TABLES = ['clientPayments', 'subPayments', 'projectExpenses', 'businessExpenses', 'homeExpenses', 'cashMoves'];
var PROJECT_TABLES = ['additions', 'clientPayments', 'subPayments', 'projectExpenses'];
var GROUPS = { project: 'הוצאות פרוייקט', business: 'הוצאות עסק', home: 'הוצאות בית',
               'in': 'כסף נכנס לקופה', out: 'כסף יצא מקופה' };
var CAT_TABLE = { project: 'projectExpenses', business: 'businessExpenses', home: 'homeExpenses',
                  'in': 'cashMoves', out: 'cashMoves' };
var MOVE_TYPES = { 'in': 'כסף נכנס לקופה', out: 'כסף יצא מקופה', transfer: 'העברה בין קופות' };
var REG_KINDS = ['מזומן', 'בנק', 'צ׳קים', 'אשראי', 'אחר'];
var METHODS = ['העברה בנקאית', 'צ׳ק', 'מזומן', 'אשראי', 'אחר'];
var ROLES = { admin: 'מנהל', user: 'משתמש', editor: 'עורך', viewer: 'צופה' };

/* =====================  הרשאות לפי משתמש  =====================
   מנהל — הכל, כולל ניהול משתמשים. כל משתמש אחר מקבל טבלת הרשאות שהמנהל
   קובע: לכל אזור — צפייה / הוספה / עריכה / מחיקה. הכל נאכף כאן בשרת:
   מה שאין עליו צפייה לא נשלח לדפדפן בכלל. */
var AREAS = ['projects', 'clientPayments', 'subPayments', 'projectExpenses', 'businessExpenses',
             'homeExpenses', 'cashMoves', 'registers', 'reports', 'categories'];
var ACTS = ['view', 'add', 'edit', 'delete'];
var AREA_OF = { projects: 'projects', additions: 'projects', clientPayments: 'clientPayments',
  subPayments: 'subPayments', projectExpenses: 'projectExpenses', businessExpenses: 'businessExpenses',
  homeExpenses: 'homeExpenses', cashMoves: 'cashMoves', registers: 'registers', categories: 'categories' };
/* התפקידים הישנים ממשיכים לעבוד בלי שינוי — הם פשוט תבנית הרשאות */
function presetPerms_(role) {
  var p = {};
  AREAS.forEach(function (a) {
    var full = role === 'editor', view = role === 'editor' || role === 'viewer';
    p[a] = { view: view, add: full, edit: full, 'delete': full };
  });
  p.homeExpenses = { view: false, add: false, edit: false, 'delete': false };
  p.registers = { view: p.registers.view, add: false, edit: false, 'delete': false };
  return p;
}
/* מקבל הרשאות מהדפדפן או מהגיליון, ומשאיר רק אזורים ופעולות מוכרים */
function cleanPerms_(raw) {
  var src = raw;
  if (typeof src === 'string') { try { src = JSON.parse(src || '{}'); } catch (e) { src = {}; } }
  var out = {};
  AREAS.forEach(function (a) {
    var s = (src && src[a]) || {};
    out[a] = {};
    ACTS.forEach(function (k) { out[a][k] = s[k] === true; });
    /* הוספה בלי צפייה מותרת בכוונה: עובד שטח שמזין הוצאות בלי לראות את
       כל ההוצאות. דוחות הם צפייה בלבד */
    if (a === 'reports') { out[a].add = out[a].edit = out[a]['delete'] = false; }
  });
  return out;
}
function permsOf_(u) {
  if (!u) return cleanPerms_({});
  if (u.role === 'admin') {
    var all = {};
    AREAS.forEach(function (a) { all[a] = { view: true, add: true, edit: true, 'delete': true }; });
    return all;
  }
  if (u.perms) return cleanPerms_(u.perms);
  return presetPerms_(u.role);
}
function allowed_(u, area, act) {
  if (!u) return false;
  if (u.role === 'admin') return true;
  var p = permsOf_(u)[area];
  return !!(p && p[act]);
}
var ACT_HE = { view: 'לצפות ב', add: 'להוסיף ל', edit: 'לערוך את', 'delete': 'למחוק מ' };
var AREA_HE = { projects: 'פרוייקטים', clientPayments: 'תשלומי לקוחות', subPayments: 'תשלומים לקבלנים',
  projectExpenses: 'הוצאות פרוייקט', businessExpenses: 'הוצאות עסק', homeExpenses: 'הוצאות בית',
  cashMoves: 'תנועות קופה', registers: 'קופות', reports: 'דוחות', categories: 'קטגוריות' };
function denied_(area, act) { return err_('אין לך הרשאה ' + ACT_HE[act] + AREA_HE[area]); }
/* כל קבוצת קטגוריות שייכת לאזור. משתמש רואה ומנהל רק את הקטגוריות של
   האזורים שהוא עובד בהם — הרשאת "קטגוריות" קובעת מה מותר לו לעשות בהן */
var CAT_AREA = { project: 'projectExpenses', business: 'businessExpenses', home: 'homeExpenses',
                 'in': 'cashMoves', out: 'cashMoves' };
function catGroupOk_(u, group) {
  var a = CAT_AREA[group];
  if (!a) return false;
  return ACTS.some(function (k) { return allowed_(u, a, k); });
}
function catAllowed_(u, group, act) {
  return allowed_(u, 'categories', act) && catGroupOk_(u, group);
}

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
      /* רק שורה עם מזהה של המערכת היא נתון. שורת "סה״כ" או הערה שמישהו
         הקליד ידנית בגיליון לא תיספר כהוצאה ולא תכפיל סכומים */
      if (!ID_RE.test(String(row[0] === null || row[0] === undefined ? '' : row[0]))) continue;
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
/* שורה חדשה לא מחייבת לקרוא את כל הלשונית: נכנסת לזיכרון רק אם הוא
   כבר נטען בבקשה הזו, ואחרת קריאה מאוחרת תמצא אותה בגיליון ממילא. */
function insert_(key, o) {
  var sh = sheet_(key);
  sh.appendRow(rowValues_(key, o));
  if (_memo[key]) { o._row = sh.getLastRow(); _memo[key].push(o); }
  cacheDrop_(key);
  return o;
}
/* הוספת הרבה שורות בכתיבה אחת. appendRow לכל שורה היה לוקח דקות
   בייבוא של מאות שורות, ו-Apps Script היה קוטע את הבקשה באמצע. */
function insertMany_(key, list) {
  if (!list.length) return;
  var sh = sheet_(key), cols = cols_(key), start = sh.getLastRow() + 1;
  var over = start + list.length - 1 - sh.getMaxRows();
  if (over > 0) sh.insertRowsAfter(sh.getMaxRows(), over);
  sh.getRange(start, 1, list.length, cols.length)
    .setValues(list.map(function (o) { return rowValues_(key, o); }));
  list.forEach(function (o, i) { o._row = start + i; if (_memo[key]) _memo[key].push(o); });
  cacheDrop_(key);
}
function update_(key, o) {
  sheet_(key).getRange(o._row, 1, 1, cols_(key).length).setValues([rowValues_(key, o)]);
  var all = rows_(key);
  for (var i = 0; i < all.length; i++) if (all[i].id === o.id) all[i] = o;
  cacheDrop_(key);
}

/* =====================  מטמון שמות (מהירות)  =====================
   כל שמירה צריכה את שם הקופה ואת שם הפרוייקט. במקום לקרוא את שתי
   הלשוניות בכל פעם, שומרים מפה קטנה במטמון של השרת. כל כתיבה של
   המערכת לקופות/לפרוייקטים מוחקת אותה, כך שהיא תמיד מעודכנת.
   שינוי ידני ישירות בגיליון ייקלט תוך שעה לכל היותר. */
var LOOKUP_TABLES = { registers: 1, projects: 1 };
function lookup_(key, id) {
  if (_memo[key]) return find_(key, id);          // כבר נקרא בבקשה הזו
  var cache = CacheService.getScriptCache(), ck = 'lk_' + key, map = null, hit = cache.get(ck);
  if (hit) { try { map = JSON.parse(hit); } catch (e) { map = null; } }
  if (!map) {
    map = {};
    rows_(key).forEach(function (r) {
      map[r.id] = { id: r.id, name: r.name, subName: r.subName || '', deleted: !!r.deleted };
    });
    try { cache.put(ck, JSON.stringify(map), 3600); } catch (e) {}
  }
  return map[id] || null;
}
function cacheDrop_(key) {
  if (!LOOKUP_TABLES[key]) return;
  try { CacheService.getScriptCache().remove('lk_' + key); } catch (e) {}
}
/* משנה עמודה אחת בכל השורות המתאימות — בכתיבה אחת לגיליון */
function syncColumn_(key, match, field, value) {
  var cols = cols_(key), idx = -1;
  for (var i = 0; i < cols.length; i++) if (cols[i].f === field) idx = i;
  var hits = rows_(key).filter(match);
  if (idx < 0 || !hits.length) return 0;
  var sh = sheet_(key), rng = sh.getRange(2, idx + 1, sh.getLastRow() - 1, 1), t = cols[idx].t;
  /* כותבים את כל העמודה חזרה — ולכן כל טקסט עובר שוב דרך toCell_, אחרת
     שיטס היה מפרש מחדש "050…" כמספר או "1/2" כתאריך גם בשורות שלא שונו */
  var vals = rng.getValues().map(function (v) { return [typeof v[0] === 'string' ? toCell_(t, v[0]) : v[0]]; });
  hits.forEach(function (r) { r[field] = value; vals[r._row - 2][0] = toCell_(t, value); });
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
/* המשתמש המחובר נשמר במטמון השרת ל-10 דקות, כדי שלא לקרוא את לשונית
   המשתמשים בכל שמירה. כל שינוי דרך המערכת (עריכה, השבתה, החלפת סיסמה)
   מוחק אותו מיד. השבתה ידנית ישירות בגיליון נכנסת לתוקף תוך 10 דקות. */
var AUTH_CACHE_SEC = 600;
function auth_(token) {
  try {
    var parts = String(token || '').split('.');
    if (parts.length !== 2) return null;
    var payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
    if (sign_(payload) !== parts[1]) return null;
    var bits = payload.split('|');
    if (Number(bits[1]) < Date.now()) return null;
    var cache = CacheService.getScriptCache(), ck = 'au_' + bits[0], u = null, hit = cache.get(ck);
    if (hit) { try { u = JSON.parse(hit); } catch (e) { u = null; } }
    if (!u) {
      var row = find_('users', bits[0]);
      if (!row) return null;
      u = { id: row.id, username: row.username, fullName: row.fullName, role: row.role,
            active: row.active, createdAt: row.createdAt, stamp: String(row.hash).slice(-10), perms: row.perms || '' };
      cache.put(ck, JSON.stringify(u), AUTH_CACHE_SEC);
    }
    if (!u.active || u.stamp !== bits[2]) return null;
    return u;
  } catch (e) { return null; }
}
function authDrop_(id) { try { CacheService.getScriptCache().remove('au_' + id); } catch (e) {} }
/* מזהה = קידומת + זמן יצירה (8 תווים בבסיס 36) + אקראי. "חדש" = נוצר ב-6 השעות האחרונות */
var FRESH_MS = 6 * 60 * 60 * 1000;
function idRecent_(id, prefix) {
  if (!prefix || String(id).indexOf(prefix) !== 0) return false;
  var t = parseInt(String(id).substr(prefix.length, 8), 36);
  return isFinite(t) && Math.abs(Date.now() - t) < FRESH_MS;
}
function pubUser_(u) {
  return { id: u.id, username: u.username, fullName: u.fullName, role: u.role,
           active: u.active, createdAt: u.createdAt, perms: permsOf_(u) };
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
      case 'saveBulk':   return saveBulk_(p);
      case 'bulk':       return bulk_(p);
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
/* כל טבלה נשלחת רק לפי ההרשאות:
   - צפייה באזור  -> כל השורות
   - בלי צפייה, אבל עם צפייה בקופות -> שורות "מוסתרות": רק תאריך, סכום וקופה,
     כדי שיתרות הקופות יהיו נכונות (בלי פרוייקט, קטגוריה או הערה)
   - אחרת -> כלום
   פרוייקטים בלי הרשאת צפייה נשלחים רק כשם (לבחירה בטופס) — בלי מחירים. */
function payload_(me) {
  var P = permsOf_(me), admin = me.role === 'admin';
  var out = { ok: true, app: APP, apiVersion: API_VERSION, scriptVersion: SCRIPT_VERSION,
              today: today_(), user: pubUser_(me), perms: P };
  var any = function (a) { var x = P[a]; return x.view || x.add || x.edit || x['delete']; };

  var regs = live_('registers').map(strip_);
  out.registers = P.registers.view ? regs : regs.map(function (r) {
    return { id: r.id, name: r.name, kind: r.kind, active: r.active, sort: r.sort };
  });

  var projs = live_('projects').map(strip_);
  var needNames = ['projects', 'clientPayments', 'subPayments', 'projectExpenses'].some(any);
  out.projects = P.projects.view ? projs : (needNames ? projs.map(function (p) {
    return { id: p.id, name: p.name, subName: p.subName, active: p.active };
  }) : []);
  out.additions = P.projects.view ? live_('additions').map(strip_) : [];

  MOVE_TABLES.forEach(function (t) {
    var rows = live_(t);
    out[t] = P[t].view ? rows.map(strip_) : (P.registers.view ? rows.map(mask_) : []);
  });

  out.categories = live_('categories').filter(function (c) { return catGroupOk_(me, c.group); }).map(strip_);

  if (admin) {
    out.users = rows_('users').map(pubUser_);
    out.sheetUrl = ss_().getUrl();
  }
  return out;
}
function mask_(h) {
  var m = { id: h.id, date: h.date, amount: h.amount, registerId: h.registerId,
            registerName: h.registerName, masked: true };
  if (h.type) { m.type = h.type; m.toRegisterId = h.toRegisterId; m.toRegisterName = h.toRegisterName; }
  return m;
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
  /* מנקים את הקבוצה לפני בדיקת ההרשאה — אחרת " home" עם רווח עוקף אותה
     ונשמר בכל זאת כ-home */
  if (inp.group !== undefined) inp.group = clean_(inp.group, 10);
  var area = AREA_OF[key];
  /* בדיקה ראשונה, זולה: בלי הרשאת הוספה וגם בלי עריכה אין מה לחפש */
  if (!allowed_(me, area, 'add') && !allowed_(me, area, 'edit')) return denied_(area, 'add');
  var id = clean_(inp.id, 40);
  if (id && !ID_RE.test(id)) return err_('מזהה לא תקין');

  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    /* המזהה נוצר בדפדפן: לחיצה כפולה או ניסיון חוזר אחרי ניתוק
       מגיעים עם אותו מזהה והופכים לעדכון — לא לשורה כפולה.
       שורה חדשה (fresh) לא מחייבת לקרוא את כל הלשונית: מספיק לבדוק
       במטמון אם המזהה הזה כבר נשמר בשעות האחרונות. זה תקף רק למזהה
       שנוצר בשעות האחרונות — מזהה ישן תמיד נבדק מול הגיליון, כדי שאי
       אפשר יהיה "להוסיף" שורה בשם של שורה קיימת ולעקוף הרשאת עריכה. */
    var cache = CacheService.getScriptCache();
    var fresh = p.fresh === '1' && id && idRecent_(id, rule.prefix) && !cache.get('nid_' + id);
    var cur = (id && !fresh) ? find_(key, id) : null;
    if (cur && cur.deleted) return err_('השורה נמחקה בינתיים — רענן את הנתונים');
    var act = cur ? 'edit' : 'add';
    if (key === 'categories' ? !catAllowed_(me, cur ? cur.group : inp.group, act) : !allowed_(me, area, act)) {
      return denied_(area, act);
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
      try { cache.put('nid_' + o.id, '1', 21600); } catch (e) {}
    }
    /* catKnown = הדפדפן כבר מכיר את הקטגוריה — אין צורך לקרוא את הלשונית */
    var g = rule.cat || (key === 'cashMoves' && o.type !== 'transfer' ? o.type : '');
    if (g && o.category && p.catKnown !== '1' && catAllowed_(me, g, 'add')) newCat = ensureCategory_(g, o.category);
    return json_({ ok: true, row: strip_(o), category: newCat ? strip_(newCat) : null });
  } finally { lock.releaseLock(); }
}

/* =====================  ייבוא מרוכז (אקסל)  =====================
   כל שורה נבדקת בדיוק כמו הזנה ידנית. שורה פסולה אינה עוצרת את השאר —
   היא חוזרת ברשימת הנפילות עם הסיבה, כדי שאפשר יהיה לתקן ולייבא שוב.
   שורה שמזהה שלה כבר קיים מדולגת: כך ניסיון חוזר אחרי ניתוק באמצע
   לא מייצר כפילויות. */
var BULK_MAX = 300;
function saveBulk_(p) {
  var me = auth_(p.token);
  if (!me) return expired_();
  var key = String(p.table || ''), rule = RULES[key];
  if (!rule || key === 'categories') return err_('טבלה לא מוכרת');
  if (!allowed_(me, AREA_OF[key], 'add')) return denied_(AREA_OF[key], 'add');
  var list;
  try { list = JSON.parse(p.rows || '[]'); } catch (e) { return err_('נתונים לא תקינים'); }
  if (!list || !list.length) return err_('אין שורות לייבוא');
  if (list.length > BULK_MAX) return err_('אפשר לייבא עד ' + BULK_MAX + ' שורות בפעם אחת');

  var lock = LockService.getScriptLock();
  lock.waitLock(45000);
  try {
    var stamp = now_(), ready = [], failed = [], skipped = 0, cats = {}, inBatch = {};
    for (var i = 0; i < list.length; i++) {
      var inp = list[i];
      try {
        if (!inp || typeof inp !== 'object') throw new Bad('שורה לא תקינה');
        var id = clean_(inp.id, 40);
        if (id && !ID_RE.test(id)) throw new Bad('מזהה לא תקין');
        /* אותו מזהה פעמיים באותה מנה היה נכנס פעמיים — ואת הכפיל אי אפשר למחוק */
        if (id && (inBatch[id] || find_(key, id))) { skipped++; continue; }
        if (id) inBatch[id] = 1;
        var o = build_(key, inp, null);
        o.id = id || uid_(rule.prefix);
        o.createdAt = stamp; o.deleted = false;
        o.userName = me.fullName; o.userId = me.id; o.updatedAt = '';
        ready.push(o);
        var g = rule.cat || (key === 'cashMoves' && o.type !== 'transfer' ? o.type : '');
        if (g && o.category && catAllowed_(me, g, 'add')) cats[g + '|' + o.category] = 1;
      } catch (ex) {
        failed.push({ i: i, error: (ex instanceof Bad) ? ex.msg : String(ex && ex.message ? ex.message : ex) });
      }
    }
    insertMany_(key, ready);
    /* זוכרים את המזהים החדשים — כמו בשמירה רגילה — כדי ששורה שיובאה עכשיו
       לא תוכל להיכתב שוב כ"חדשה" בלי בדיקה מול הגיליון */
    if (ready.length) {
      var seen = {};
      ready.forEach(function (o) { seen['nid_' + o.id] = '1'; });
      try { CacheService.getScriptCache().putAll(seen, 21600); } catch (e) {}
    }
    var newCats = [];
    Object.keys(cats).forEach(function (k) {
      var at = k.indexOf('|');
      var c = ensureCategory_(k.slice(0, at), k.slice(at + 1));
      if (c) newCats.push(strip_(c));
    });
    return json_({ ok: true, added: ready.map(strip_), failed: failed, skipped: skipped, categories: newCats });
  } finally { lock.releaseLock(); }
}

/* =====================  עדכון / מחיקה מרוכזים  =====================
   op = update (אותם שדות לכל השורות שנבחרו) / delete / restore.
   כל שורה נבדקת בנפרד בדיוק כמו בעריכה רגילה; שורה שנכשלה חוזרת
   ברשימת הנפילות ואינה עוצרת את השאר. */
var BULK_FIELDS = {
  projects:         ['active', 'client', 'subName', 'subPhone', 'startDate', 'endDate', 'note'],
  additions:        ['date', 'projectId', 'note'],
  clientPayments:   ['date', 'projectId', 'registerId', 'method', 'reference', 'note'],
  subPayments:      ['date', 'projectId', 'registerId', 'method', 'reference', 'note'],
  projectExpenses:  ['date', 'projectId', 'registerId', 'category', 'supplier', 'deductSub', 'note'],
  businessExpenses: ['date', 'registerId', 'category', 'supplier', 'note'],
  homeExpenses:     ['date', 'registerId', 'category', 'supplier', 'note'],
  cashMoves:        ['date', 'registerId', 'category', 'note']
};
function bulk_(p) {
  var me = auth_(p.token);
  if (!me) return expired_();
  var key = String(p.table || ''), rule = RULES[key], op = String(p.op || '');
  if (!rule || !BULK_FIELDS[key]) return err_('טבלה לא מוכרת');
  if (['update', 'delete', 'restore'].indexOf(op) < 0) return err_('פעולה לא מוכרת');
  var bulkAct = op === 'update' ? 'edit' : 'delete';
  if (!allowed_(me, AREA_OF[key], bulkAct)) return denied_(AREA_OF[key], bulkAct);
  var ids, patch = {};
  try {
    ids = JSON.parse(p.ids || '[]');
    if (op === 'update') patch = JSON.parse(p.patch || '{}');
  } catch (e) { return err_('נתונים לא תקינים'); }
  if (!ids || !ids.length) return err_('לא נבחרו שורות');
  if (ids.length > BULK_MAX) return err_('אפשר לעדכן עד ' + BULK_MAX + ' שורות בפעם אחת');
  if (op === 'update') {
    var clean = {};
    Object.keys(patch || {}).forEach(function (k) { if (BULK_FIELDS[key].indexOf(k) >= 0) clean[k] = patch[k]; });
    if (!Object.keys(clean).length) return err_('לא נבחר שדה לעדכון');
    patch = clean;
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(45000);
  try {
    var stamp = now_(), done = [], failed = [], cats = {};
    ids.forEach(function (raw) {
      var id = clean_(raw, 40);
      try {
        var cur = find_(key, id);
        if (!cur) throw new Bad('השורה לא נמצאה');
        if (op === 'update') {
          if (cur.deleted) throw new Bad('השורה נמחקה');
          var o = build_(key, patch, cur);
          o._row = cur._row; o.id = cur.id; o.deleted = false; o.createdAt = cur.createdAt;
          if ('userName' in cur) { o.userName = cur.userName; o.userId = cur.userId; o.updatedAt = stamp; }
          update_(key, o);
          afterUpdate_(key, cur, o);
          var g = rule.cat || (key === 'cashMoves' && o.type !== 'transfer' ? o.type : '');
          if (g && o.category && catAllowed_(me, g, 'add')) cats[g + '|' + o.category] = 1;
          done.push(strip_(o));
          return;
        }
        if (op === 'delete') {
          if (!cur.deleted && key === 'projects') {
            var n = 0;
            PROJECT_TABLES.forEach(function (t) {
              n += live_(t).filter(function (r) { return r.projectId === cur.id; }).length;
            });
            if (n) throw new Bad('בפרוייקט "' + cur.name + '" יש ' + n + ' תנועות');
          }
          cur.deleted = true;
        } else {
          if (cur.deleted) restoreCheck_(key, cur);
          cur.deleted = false;
        }
        if ('updatedAt' in cur) cur.updatedAt = stamp;
        update_(key, cur);
        done.push(strip_(cur));
      } catch (ex) {
        failed.push({ id: id, error: (ex instanceof Bad) ? ex.msg : String(ex && ex.message ? ex.message : ex) });
      }
    });
    var newCats = [];
    Object.keys(cats).forEach(function (k) {
      var at = k.indexOf('|');
      var c = ensureCategory_(k.slice(0, at), k.slice(at + 1));
      if (c) newCats.push(strip_(c));
    });
    if (key === 'projects' && done.length) cacheDrop_('projects');
    return json_({ ok: true, rows: done, failed: failed, categories: newCats });
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
    var r = o[f] ? lookup_('registers', o[f]) : null;
    if (!r || r.deleted) throw new Bad('יש לבחור קופה');
    o[nameF] = r.name;
    return r;
  }
  function project() {
    if (has('projectId')) o.projectId = clean_(inp.projectId, 40);
    var pr = o.projectId ? lookup_('projects', o.projectId) : null;
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
      /* קופה חדשה בלי סדר מפורש נכנסת בסוף — אחרת סדר 0 היה מקפיץ
         אותה לראש הרשימה, והופך אותה לברירת המחדל בכל טופס */
      if (!cur && !has('sort')) {
        o.sort = live_('registers').reduce(function (m, r) { return Math.max(m, Number(r.sort) || 0); }, 0) + 1;
      }
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
    /* תוספת אינה תנועת כסף אלא שינוי במחיר שסוכם, ולכן היא לא נוגעת
       בקופות. סכום שלילי מותר — כך נרשם זיכוי על עבודה שירדה. */
    case 'additions':
      date('date', true);
      project();
      text('description', 200);
      if (!o.description) throw new Bad('יש להזין תיאור לתוספת');
      money('clientAmount', true); money('subAmount', true);
      if (!o.clientAmount && !o.subAmount) throw new Bad('יש להזין סכום — ללקוח, לקבלן, או לשניהם');
      text('note', 500);
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

/* קטגוריה חדשה שהוקלדה בטופס נוספת לרשימה, כדי שתוצע בפעם הבאה.
   קטגוריה שנמחקה נשארת מחוקה — עריכה של שורה ישנה שמשתמשת בה לא
   מחזירה אותה לרשימה בלי שאיש ביקש. */
function ensureCategory_(group, name) {
  var all = rows_('categories').filter(function (c) { return c.group === group && c.name === name; });
  if (all.length) return null;
  var max = 0;
  rows_('categories').forEach(function (c) { if (c.group === group && c.sort > max) max = c.sort; });
  return insert_('categories', { id: uid_('c'), group: group, groupHe: GROUPS[group], name: name,
    sort: max + 1, createdAt: now_(), deleted: false });
}

/* =====================  מחיקה ושחזור  ===================== */
/* שחזור מותר רק אם כל מה שהשורה מפנה אליו עדיין קיים — כולל קופת היעד
   של העברה (אחרת הכסף "נעלם" מהיתרות) — ובלי ליצור שם כפול */
function restoreCheck_(key, cur) {
  var gone = function (t, id) { var r = find_(t, id); return !r || r.deleted; };
  if (cur.projectId && gone('projects', cur.projectId)) throw new Bad('הפרוייקט של השורה נמחק');
  if (cur.registerId && gone('registers', cur.registerId)) throw new Bad('הקופה של השורה נמחקה');
  if (cur.toRegisterId && gone('registers', cur.toRegisterId)) throw new Bad('קופת היעד של ההעברה נמחקה');
  if ((key === 'registers' || key === 'categories') && live_(key).some(function (r) {
    return r.id !== cur.id && r.name === cur.name && (key !== 'categories' || r.group === cur.group);
  })) throw new Bad('כבר קיים פריט פעיל בשם "' + cur.name + '"');
}
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
    if (key === 'categories' ? !catAllowed_(me, cur.group, 'delete') : !allowed_(me, AREA_OF[key], 'delete')) {
      return denied_(AREA_OF[key], 'delete');
    }
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
      restoreCheck_(key, cur);
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
    delete _memo.users;                    // קוראים מחדש אחרי הנעילה: שני מנהלים במקביל לא יורידו זה את זה
    var users = rows_('users');
    if (users.some(function (u) { return u.active && String(u.username).toLowerCase() === username && u.id !== id; })) {
      return err_('שם המשתמש כבר תפוס');
    }
    if (id) {
      var u = find_('users', id);
      if (!u) return err_('המשתמש לא נמצא');
      if (u.id === me.id && (!active || role !== 'admin')) return err_('אי אפשר להוריד הרשאות מעצמך');
      if (u.active && u.role === 'admin' && (role !== 'admin' || !active) && admins_().length < 2) {
        return err_('חייב להישאר לפחות מנהל אחד פעיל');
      }
      if (pass && pass.length < 6) return err_('סיסמה חייבת 6 תווים לפחות');
      u.username = username; u.fullName = fullName || username; u.role = role; u.active = active;
      if (pass) { u.salt = newSalt_(); u.hash = hashPass_(pass, u.salt); }
      /* הרשאות נשמרות רק למשתמש רגיל; למנהל אין צורך — יש לו הכל */
      if (p.perms !== undefined) u.perms = role === 'admin' ? '' : JSON.stringify(cleanPerms_(p.perms));
      update_('users', u);
      authDrop_(u.id);                     // תפקיד/השבתה נכנסים לתוקף מיד
      /* מנהל שהחליף לעצמו סיסמה ממסך המשתמשים — מקבל טוקן חדש, אחרת היה מנותק בפעולה הבאה */
      return json_({ ok: true, user: pubUser_(u), token: (pass && u.id === me.id) ? makeToken_(u) : undefined });
    }
    if (pass.length < 6) return err_('סיסמה חייבת 6 תווים לפחות');
    var salt = newSalt_();
    var nu = insert_('users', { id: uid_('u'), username: username, fullName: fullName || username, role: role,
      salt: salt, hash: hashPass_(pass, salt), active: true, createdAt: now_(),
      perms: (role === 'admin' || p.perms === undefined) ? '' : JSON.stringify(cleanPerms_(p.perms)) });
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
    delete _memo.users;
    var u = find_('users', clean_(p.id, 40));
    if (!u) return err_('המשתמש לא נמצא');
    if (u.id === me.id) return err_('אי אפשר להשבית את עצמך');
    if (u.role === 'admin' && u.active && admins_().length < 2) return err_('חייב להישאר לפחות מנהל אחד פעיל');
    u.active = false;
    update_('users', u);
    authDrop_(u.id);
    return json_({ ok: true });
  } finally { lock.releaseLock(); }
}

function changePass_(p) {
  var me = auth_(p.token);
  if (!me) return expired_();
  var newP = String(p.newPassword || '');
  if (newP.length < 6) return err_('הסיסמה החדשה חייבת 6 תווים לפחות');
  var full = find_('users', me.id);        // במטמון אין מלח וגיבוב — צריך את השורה המלאה
  if (!full || hashPass_(String(p.oldPassword || ''), full.salt) !== full.hash) return err_('הסיסמה הנוכחית שגויה');
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    full.salt = newSalt_();
    full.hash = hashPass_(newP, full.salt);
    update_('users', full);
    authDrop_(full.id);
    return json_({ ok: true, token: makeToken_(full) });   // החיבורים האחרים מתנתקים
  } finally { lock.releaseLock(); }
}
