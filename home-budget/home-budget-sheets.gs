/**
 * ניהול הוצאות בית ↔ Google Sheets (backend)
 * ------------------------------------------------------------
 * שומר תנועות, קטגוריות, שטאנצים (מקורות ייבוא), כללי סיווג, משתמשים
 * והגדרות. כל תנועה נשמרת יחד עם תיעוד מלא מאיפה היא הגיעה.
 *
 * אבטחה
 * ------
 * הכניסה היא בשני שלבים: קוד אישי + קוד חד-פעמי שנשלח למייל המשתמש.
 * שני השלבים נבדקים כאן בשרת, לא בדפדפן. בסיום מתקבל טוקן שתוקפו
 * 30 יום, וכל בקשת נתונים חייבת לשאת אותו — בלי טוקן תקף לא ניתן
 * לקרוא או לכתוב כלום, גם למי שיש בידיו את כתובת ה-/exec.
 *
 * API פתוח (ללא טוקן):
 *   POST {action:'authmeta'}                        -> שם המערכת בלבד, בלי שמות משתמשים
 *   POST {action:'requestCode', name, pin}          -> שולח קוד למייל, מחזיר ref
 *   POST {action:'verifyCode',  ref, otp}           -> מחזיר טוקן
 *
 * API מוגן (חייב token):
 *   POST {action:'load',     token}                 -> כל הנתונים
 *   POST {action:'importTx', token, rows:[...]}     -> ייבוא עם דילוג כפולות
 *   POST {action:'batch',    token, ops:[...]}      -> פעולות מרובות בנעילה אחת
 *   POST {action:'logout',   token}                 -> ביטול הטוקן
 *
 *   פעולות בתוך ops:
 *        {op:'upsertTx',rows} {op:'delTx',ids}
 *        {op:'upsertCat',rows} {op:'delCat',ids}
 *        {op:'upsertStencil',rows} {op:'delStencil',ids}
 *        {op:'upsertRule',rows} {op:'delRule',ids}
 *        {op:'upsertUser',rows} {op:'delUser',ids}   <-- מנהל בלבד
 *        {op:'setSetting',key,value}
 *
 * הגדרה (פעם אחת):
 *   1. צור גיליון חדש בשם "ניהול הוצאות בית".
 *   2. בתוך הגיליון: Extensions (תוספים) ← Apps Script (סקריפט של Apps).
 *   3. מחק את הקוד שבעורך והדבק את כל הקוד הזה במקומו.
 *   4. Deploy ← New deployment ← Web app
 *        Execute as: Me   |   Who has access: Anyone
 *   5. אשר הרשאות (Authorize / Allow) — כולל הרשאת שליחת מייל.
 *   6. העתק את כתובת ה-/exec והדבק אותה במסך ההגדרות של המערכת.
 *
 * שים לב: "Who has access: Anyone" נדרש כדי שהדפדפן יוכל לפנות לשרת,
 * אבל הגישה לנתונים עצמם חסומה מאחורי הטוקן.
 *
 * הלשוניות נוצרות לבד בשימוש הראשון — אין צורך להכין כלום מראש.
 */

var APP_NAME  = 'ניהול הוצאות בית';
var OTP_TTL   = 10 * 60 * 1000;               // תוקף קוד המייל: 10 דקות
var SESS_TTL  = 30 * 24 * 60 * 60 * 1000;     // תוקף התחברות: 30 יום
var OTP_TRIES = 5;                            // ניסיונות לפני ביטול הקוד
var RL_MAX    = 5;                            // בקשות קוד מקסימום
var RL_WINDOW = 15 * 60 * 1000;               //   בחלון של 15 דקות

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
              'מיפוי עמודות (JSON)', 'פורמט תאריך', 'שיטת סכום',
              'משמעות מספר חיובי', 'נמחק'],
    fields:  ['id', 'name', 'type', 'payment', 'skip',
              'map', 'dateFmt', 'amountMode', 'signFlip', 'deleted']
  },
  rules: {
    name: 'כללי סיווג',
    headers: ['מזהה', 'טקסט לזיהוי', 'סוג התאמה', 'קטגוריה', 'סטטוס', 'פעמים', 'נמחק'],
    fields:  ['id', 'match', 'matchType', 'category', 'status', 'hits', 'deleted']
  },
  users: {
    name: 'משתמשים',
    headers: ['מזהה', 'שם', 'אימייל', 'קוד אישי', 'הרשאה', 'נמחק'],
    fields:  ['id', 'name', 'email', 'code', 'role', 'deleted']
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
    var g = function (k) { return p[k] !== undefined ? p[k] : (body ? body[k] : undefined); };
    var action = g('action') || '';

    /* ---------- פתוח: כניסה ---------- */
    if (action === 'authmeta')    return json(authMeta());
    if (action === 'requestCode') { lock.waitLock(20000); return json(requestCode(g('name'), g('pin'))); }
    if (action === 'verifyCode')  { lock.waitLock(20000); return json(verifyCode(g('ref'), g('otp'))); }
    if (action === 'logout')      { props().deleteProperty('sess_' + g('token')); return json({ status: 'ok' }); }

    /* ---------- מכאן ואילך חייב טוקן ---------- */
    var me = authUser(g('token'));
    if (!me) return json({ status: 'unauthorized', message: 'ההתחברות פגה — יש להתחבר מחדש' });

    if (action === 'load') return json(loadAll(me));

    if (action === 'importTx') {
      lock.waitLock(30000);
      var res = importTx(g('rows') || []);
      return json({ status: 'ok', added: res.added, dups: res.dups });
    }

    if (action === 'batch') {
      lock.waitLock(30000);
      var ops = g('ops') || [];
      if (typeof ops === 'string') ops = JSON.parse(ops);
      var count = 0;
      for (var i = 0; i < ops.length; i++) {
        var o = ops[i];
        if (o.op === 'upsertTx')            { upsertMany('tx', o.rows || []);       count += (o.rows || []).length; }
        else if (o.op === 'delTx')          { markDeleted('tx', o.ids || []);       count += (o.ids || []).length; }
        else if (o.op === 'upsertCat')      { upsertMany('cats', o.rows || []);     count += (o.rows || []).length; }
        else if (o.op === 'delCat')         { markDeleted('cats', o.ids || []);     count += (o.ids || []).length; }
        else if (o.op === 'upsertStencil')  { upsertMany('stencils', o.rows || []); count += (o.rows || []).length; }
        else if (o.op === 'delStencil')     { markDeleted('stencils', o.ids || []); count += (o.ids || []).length; }
        else if (o.op === 'upsertRule')     { upsertMany('rules', o.rows || []);    count += (o.rows || []).length; }
        else if (o.op === 'delRule')        { markDeleted('rules', o.ids || []);    count += (o.ids || []).length; }
        else if (o.op === 'setSetting')     { setSetting(o.key, o.value);           count++; }
        /* ניהול משתמשים — מנהל בלבד, ונבדק כאן ולא רק בממשק */
        else if (o.op === 'upsertUser') {
          if (me.role !== 'admin') return json({ status: 'error', message: 'ניהול משתמשים מותר למנהל בלבד' });
          var guard = guardAdmins(o.rows || [], []);
          if (guard) return json({ status: 'error', message: guard });
          upsertMany('users', o.rows || []); count += (o.rows || []).length;
        }
        else if (o.op === 'delUser') {
          if (me.role !== 'admin') return json({ status: 'error', message: 'ניהול משתמשים מותר למנהל בלבד' });
          var guard2 = guardAdmins([], o.ids || []);
          if (guard2) return json({ status: 'error', message: guard2 });
          markDeleted('users', o.ids || []); count += (o.ids || []).length;
        }
      }
      return json({ status: 'ok', count: count });
    }

    return json({ status: 'idle' });
  } catch (err) {
    return json({ status: 'error', message: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

/* ============================================================
   כניסה ואימות
   ============================================================ */

function props() { return PropertiesService.getScriptProperties(); }

/** רשימת המשתמשים. בשימוש הראשון נוצרת מתוך ההגדרות הישנות
 *  (settings.users מגרסה קודמת) או מברירת מחדל. */
function readUsers() {
  var list = readAll('users').filter(function (u) { return !u.deleted; });
  if (list.length) return list;

  var s = {};
  readAll('settings').forEach(function (r) { s[r.key] = r.value; });
  var old = null;
  try { old = JSON.parse(s.users || 'null'); } catch (x) {}
  var seed = (old && old.length) ? old
           : [{ id: 'u1', name: 'דודי', code: '1234', role: 'admin' },
              { id: 'u2', name: 'בן/בת זוג', code: '5678', role: 'user' }];
  seed.forEach(function (u) {
    if (u.role !== 'admin' && u.role !== 'user') u.role = 'user';
    if (!u.email) u.email = '';
    u.deleted = '';
  });
  var hasAdmin = seed.some(function (u) { return u.role === 'admin'; });
  if (!hasAdmin) seed[0].role = 'admin';
  upsertMany('users', seed);
  return seed;
}

/** המייל של בעל הסקריפט — מי שפרס אותו. הוא המנהל הראשון, ובלי זה
 *  אי אפשר להיכנס בפעם הראשונה כדי להזין מיילים. */
function ownerEmail() {
  try { return Session.getEffectiveUser().getEmail() || ''; } catch (x) { return ''; }
}

function findUser(id) {
  var m = readUsers().filter(function (u) { return String(u.id) === String(id); });
  return m.length ? m[0] : null;
}

/** מוודא שלא נמחק ולא הורד המנהל האחרון — גם אם הבקשה הגיעה
 *  בעקיפה על הממשק. */
function guardAdmins(upserts, delIds) {
  var list = readUsers();
  var byId = {};
  list.forEach(function (u) { byId[String(u.id)] = { role: u.role, deleted: false }; });
  (upserts || []).forEach(function (u) {
    byId[String(u.id)] = { role: u.role, deleted: !!u.deleted };
  });
  (delIds || []).forEach(function (id) {
    if (byId[String(id)]) byId[String(id)].deleted = true;
  });
  var admins = 0;
  for (var k in byId) if (byId[k].role === 'admin' && !byId[k].deleted) admins++;
  return admins ? '' : 'חייב להישאר לפחות מנהל אחד במערכת';
}

function maskEmail(e) {
  e = String(e || '');
  var at = e.indexOf('@');
  if (at < 1) return '';
  return e.slice(0, Math.min(2, at)) + '•••' + e.slice(at);
}

/** מסך הכניסה לא מקבל שום רשימת משתמשים — כל אחד מקליד את שמו.
 *  חשיפת השמות הייתה מאפשרת לדעת מי רשום במערכת לפני כל אימות. */
function authMeta() {
  return { status: 'ok', app: APP_NAME };
}

var BAD_CREDS = 'שם משתמש או קוד אישי שגוי';

function normName(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').replace(/^ | $/g, '').toLowerCase();
}
function findUserByName(name) {
  var want = normName(name);
  if (!want) return null;
  var m = readUsers().filter(function (u) { return normName(u.name) === want; });
  return m.length ? m[0] : null;
}

function requestCode(name, pin) {
  /* הגבלת קצב לפי השם שהוקלד, ולפני בדיקת קיומו — אחרת אפשר היה
     להבדיל בין שם קיים לשם שאינו קיים לפי עצם קיום ההגבלה. */
  var rlKey = 'rl_' + normName(name);
  var rl = {};
  try { rl = JSON.parse(props().getProperty(rlKey) || '{}'); } catch (x) {}
  if (!rl.since || (Date.now() - rl.since) > RL_WINDOW) rl = { since: Date.now(), n: 0 };
  if (rl.n >= RL_MAX) {
    return { status: 'error', message: 'יותר מדי ניסיונות. נסה שוב בעוד רבע שעה.' };
  }
  rl.n++;
  props().setProperty(rlKey, JSON.stringify(rl));

  var u = findUserByName(name);
  /* אותה הודעה לשם לא קיים ולקוד שגוי — בלי לרמוז מי רשום */
  if (!u || String(u.code) !== String(pin)) return { status: 'error', message: BAD_CREDS };

  if (!u.email && u.role === 'admin') {
    /* מנהל בלי מייל — נשאב מחשבון הגוגל שמריץ את הסקריפט ונשמר.
       פותר את הביצה והתרנגולת של הכניסה הראשונה. */
    u.email = ownerEmail();
    if (u.email) upsertMany('users', [u]);
  }
  if (!u.email) {
    return { status: 'error',
             message: 'למשתמש הזה לא הוגדר אימייל. המנהל צריך להזין אותו בהגדרות ← משתמשים.' };
  }

  var code = String(Math.floor(100000 + Math.random() * 900000));
  /* האתגר מזוהה במזהה אקראי ולא במזהה המשתמש — הדפדפן לא צריך
     לדעת את מזהה המשתמש כדי להשלים כניסה. */
  var ref = Utilities.getUuid();
  props().setProperty('chal_' + ref, JSON.stringify({
    u: u.id, n: normName(name), c: code, exp: Date.now() + OTP_TTL, t: 0
  }));
  sendCodeMail(u, code);
  return { status: 'ok', ref: ref, to: maskEmail(u.email) };
}

function sendCodeMail(u, code) {
  var html =
    '<div style="direction:rtl;text-align:right;font-family:Arial,Helvetica,sans-serif;' +
    'max-width:460px;margin:0 auto;padding:24px;color:#0f172a">' +
      '<h2 style="margin:0 0 4px;font-size:19px">' + APP_NAME + '</h2>' +
      '<p style="margin:0 0 20px;color:#64748b;font-size:14px">שלום ' + escapeHtml(u.name) + ', הנה קוד הכניסה שלך:</p>' +
      '<div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:12px;' +
      'padding:18px;text-align:center;font-size:34px;font-weight:bold;' +
      'letter-spacing:9px;direction:ltr;color:#3730a3">' + code + '</div>' +
      '<p style="margin:18px 0 0;color:#64748b;font-size:13px;line-height:1.7">' +
        'הקוד תקף ל-10 דקות ולשימוש אחד בלבד.<br>' +
        'אם לא ניסית להתחבר עכשיו — אל תמסור את הקוד לאיש, ' +
        'וכדאי להחליף את הקוד האישי במערכת.' +
      '</p>' +
    '</div>';
  MailApp.sendEmail({
    to: u.email,
    subject: 'קוד כניסה ' + code + ' — ' + APP_NAME,
    htmlBody: html,
    name: APP_NAME
  });
}

function verifyCode(ref, otp) {
  var key = 'chal_' + String(ref || '');
  var raw = ref ? props().getProperty(key) : null;
  if (!raw) return { status: 'error', message: 'לא נשלח קוד, או שכבר נעשה בו שימוש. בקש קוד חדש.' };

  var o = JSON.parse(raw);
  if (Date.now() > o.exp) {
    props().deleteProperty(key);
    return { status: 'error', message: 'הקוד פג תוקף. בקש קוד חדש.' };
  }
  o.t = (o.t || 0) + 1;
  if (o.t > OTP_TRIES) {
    props().deleteProperty(key);
    return { status: 'error', message: 'יותר מדי ניסיונות. בקש קוד חדש.' };
  }
  if (String(o.c) !== String(otp)) {
    props().setProperty(key, JSON.stringify(o));
    return { status: 'error', message: 'קוד שגוי (' + (OTP_TRIES - o.t + 1) + ' ניסיונות נותרו)' };
  }

  props().deleteProperty(key);
  if (o.n) props().deleteProperty('rl_' + o.n);
  var u = findUser(o.u);
  if (!u) return { status: 'error', message: 'המשתמש הוסר מהמערכת' };
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  props().setProperty('sess_' + token, JSON.stringify({ u: o.u, exp: Date.now() + SESS_TTL }));
  cleanupExpired();
  return { status: 'ok', token: token,
           user: { id: u.id, name: u.name, role: u.role, email: u.email } };
}

function authUser(token) {
  if (!token) return null;
  var raw = props().getProperty('sess_' + token);
  if (!raw) return null;
  var s;
  try { s = JSON.parse(raw); } catch (x) { return null; }
  if (Date.now() > s.exp) { props().deleteProperty('sess_' + token); return null; }
  return findUser(s.u);
}

/** ניקוי טוקנים וקודים שפג תוקפם — כדי שאחסון המאפיינים לא יתמלא. */
function cleanupExpired() {
  var all = props().getProperties();
  var now = Date.now();
  for (var k in all) {
    if (k.indexOf('sess_') !== 0 && k.indexOf('chal_') !== 0) continue;
    try {
      var v = JSON.parse(all[k]);
      if (v.exp && now > v.exp) props().deleteProperty(k);
    } catch (x) { props().deleteProperty(k); }
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ============================================================
   נתונים
   ============================================================ */

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

/** הקוד האישי של משתמשים אחרים לא נשלח לדפדפן.
 *  המנהל מקבל אימייל מלא כדי שיוכל לערוך; משתמש רגיל מקבל שם בלבד. */
function loadAll(me) {
  var out = {
    tx: readAll('tx'),
    cats: readAll('cats'),
    stencils: readAll('stencils'),
    rules: readAll('rules'),
    users: readUsers().map(function (u) {
      var safe = { id: u.id, name: u.name, role: u.role, deleted: u.deleted || '' };
      if (me.role === 'admin') { safe.email = u.email; safe.code = u.code; }
      else if (String(u.id) === String(me.id)) { safe.email = u.email; }
      return safe;
    }),
    me: { id: me.id, name: me.name, role: me.role },
    settings: {}
  };
  readAll('settings').forEach(function (r) {
    if (r.key === 'users') return;          // שארית מגרסה קודמת — לא בשימוש יותר
    out.settings[r.key] = r.value;
  });
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
    /* היום הקלנדרי לפי אזור הזמן של הגיליון עצמו — לא של הסקריפט.
       הבדל ביניהם היה מזיז תאריך שלם יום אחורה. */
    return Utilities.formatDate(v, getSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
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
  var appends = [], updates = {};
  rows.forEach(function (obj) {
    var rowVals = cfg.fields.map(function (f) {
      var v = obj[f];
      return (v === undefined || v === null) ? '' : String(v);
    });
    var r = idMap[String(obj.id)];
    if (r) updates[r] = rowVals;
    else appends.push(rowVals);
  });
  /* עדכונים בודדים — שורה-שורה. עדכון מרוכז — קוראים את כל הבלוק פעם
     אחת, מחליפים בזיכרון, וכותבים פעם אחת. */
  var upRows = Object.keys(updates);
  if (upRows.length > 10 && last >= 2) {
    var block = s.getRange(2, 1, last - 1, cfg.fields.length).getValues();
    upRows.forEach(function (r) { block[Number(r) - 2] = updates[r]; });
    s.getRange(2, 1, last - 1, cfg.fields.length).setValues(block);
  } else {
    upRows.forEach(function (r) {
      s.getRange(Number(r), 1, 1, cfg.fields.length).setValues([updates[r]]);
    });
  }
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
  /* קריאה אחת וכתיבה אחת של כל העמודה — מחיקה מרוכזת של מאות שורות
     בקריאת setValue לכל שורה בנפרד הייתה לוקחת דקות. */
  var idVals  = s.getRange(2, 1, last - 1, 1).getValues();
  var delVals = s.getRange(2, delCol, last - 1, 1).getValues();
  var stamp = new Date().toISOString().slice(0, 10);
  var changed = false;
  for (var i = 0; i < idVals.length; i++) {
    if (wanted[String(idVals[i][0])] && !delVals[i][0]) { delVals[i][0] = stamp; changed = true; }
  }
  if (changed) s.getRange(2, delCol, last - 1, 1).setValues(delVals);
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
  /* שורות שנמחקו לא חוסמות ייבוא מחדש — אחרת אי אפשר לתקן ייבוא שגוי */
  readAll('tx').forEach(function (t) { if (!t.deleted) existing[dedupKey(t)] = true; });
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
