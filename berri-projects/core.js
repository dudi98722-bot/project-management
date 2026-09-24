/* =====================================================================
   BERRI — ניהול פרוייקטים · ליבה: מצב, עזרים, שרת, כניסה וניווט
   כל הנתונים נשמרים בגוגל שיטס דרך Apps Script Web App.
   ===================================================================== */
'use strict';

/* כתובת ה-Web App של Apps Script. כשהיא מוגדרת כאן — אף אחד לא צריך
   להזין כלום; אם היא ריקה, מזינים אותה פעם אחת והיא נשמרת בדפדפן. */
var DEFAULT_GS_URL = 'https://script.google.com/macros/s/AKfycbwamNXeJ-5KU80Zm6zJBN2iI2Hh365nmLCDR7tHQ48n0eqeWSxJzzjIEQDj1mxUy4WJJA/exec';

var LS = { url: 'berri_gs_url', tok: 'berri_token', cache: 'berri_cache', last: 'berri_last' };
var TABLE_KEYS = ['registers', 'projects', 'additions', 'clientPayments', 'subPayments', 'projectExpenses',
                  'businessExpenses', 'homeExpenses', 'cashMoves', 'categories', 'users'];
var ROLE_HE = { admin: 'מנהל', editor: 'עורך', viewer: 'צופה' };

var S = {
  /* בשרת האמיתי הכתובת המוטמעת קובעת תמיד. על localhost — רק כתובת שהוזנה
     בדפדפן, כדי שבדיקה מקומית לא תדבר בטעות עם הגיליון החי */
  url: isLocal() ? lsGet(LS.url) : (DEFAULT_GS_URL || lsGet(LS.url)),
  token: lsGet(LS.tok),
  user: null, today: '', sheetUrl: '', scriptVersion: '',
  d: {}, ver: 0,
  route: { page: 'dash', arg: '' },
  ui: { projFilter: 'active', projSearch: '', repTab: 'summary', repYear: '', dayMode: 'day',
        day: '', dayFrom: '', dayTo: '', ledgerFrom: '', ledgerTo: '', expPeriod: 'month' },
  filters: {}, sorts: {},
  syncing: false, lastLoad: 0, offline: false
};
TABLE_KEYS.forEach(function (k) { S.d[k] = []; });

function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

/* ---------- עזרים ---------- */
function byId(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function jsq(s) { return esc(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")); }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function money(n) {
  n = round2(n);
  var s = Math.abs(n).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return (n < 0 ? '-' : '') + '₪' + s;
}
function moneyCls(n) { return round2(n) < 0 ? ' neg' : ''; }
function pct(a, b) { return b > 0 ? Math.max(0, Math.min(100, a / b * 100)) : 0; }
/* סכום מהקלדה או מאקסל: "12,500", "₪1,200.50", "12 500",
   ובפורמט החשבונאי של אקסל: "₪ -" = 0, "(500)" או "500-" = מינוס 500.
   "1.200,50" (אירופאי) מזוהה רק כשיש גם נקודות אלפים וגם פסיק עשרוני */
function parseAmount(s) {
  s = String(s == null ? '' : s).replace(/[\s  ₪$]/g, '');
  if (s === '') return NaN;
  if (s === '-' || s === '–') return 0;
  var neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^[^-].*-$/.test(s)) { neg = true; s = s.slice(0, -1); }
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  var n = Number(s);
  if (!isFinite(n) || !/\d/.test(s)) return NaN;
  return round2(neg ? -Math.abs(n) : n);
}
/* שדה סכום אופציונלי בטופס: ריק = 0, טקסט שלא מובן = null (ואז מציגים שגיאה).
   בלי ההבחנה הזו "12,5OO" עם אות O היה נשמר בשקט כ-0 */
function amountField(id, label, allowNeg) {
  var raw = val(id);
  if (raw === '') return 0;
  var n = parseAmount(raw);
  if (!isFinite(n)) { setMsg('m', label + ': "' + raw + '" אינו סכום תקין'); return null; }
  if (n < 0 && !allowNeg) { setMsg('m', label + ' לא יכול להיות שלילי'); return null; }
  return n;
}
function iso(d) {
  var p = function (x) { return ('0' + x).slice(-2); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function todayISO() { return S.today && S.today >= iso(new Date()) ? S.today : iso(new Date()); }
function parseISO(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
function addDays(s, n) { var d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); }
function fmtDate(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? (m[3] + '/' + m[2] + '/' + m[1]) : '';
}
var MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
var DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
function monthLabel(ym) {
  var p = String(ym || '').split('-');
  return p.length >= 2 ? MONTHS[+p[1] - 1] + ' ' + p[0] : ym;
}
function dayLabel(s) { var d = parseISO(s); return d ? 'יום ' + DAYS[d.getDay()] + ', ' + fmtDate(s) : ''; }
function newId(prefix) {
  return prefix + Date.now().toString(36) + Math.floor(Math.random() * 1e8).toString(36);
}
function initials(name) {
  var p = String(name || '').trim().split(/\s+/);
  return ((p[0] || '')[0] || '') + ((p[1] || '')[0] || '');
}
function isAdmin() { return !!S.user && S.user.role === 'admin'; }
function canEdit() { return !!S.user && (S.user.role === 'admin' || S.user.role === 'editor'); }
function val(id) { var e = byId(id); return e ? String(e.value).trim() : ''; }
function checked(id) { var e = byId(id); return !!(e && e.checked); }
function setMsg(id, text, kind) {
  var e = byId(id); if (!e) return;
  e.className = text ? 'msg on ' + (kind || 'err') : 'msg';
  e.textContent = text || '';
}
function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.lbl = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> ' + (label || 'שומר…'); }
  else { btn.disabled = false; if (btn.dataset.lbl) btn.innerHTML = btn.dataset.lbl; }
}
function toast(text, kind, action) {
  var el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.appendChild(document.createTextNode(text));
  if (action) {
    var b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = function () { el.remove(); action.fn(); };
    el.appendChild(b);
  }
  byId('toasts').appendChild(el);
  setTimeout(function () { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(function () { el.remove(); }, 320); },
             action ? 7000 : 3400);
}

/* ---------- שרת ---------- */
/* טופס רגיל (לא JSON) — כך הדפדפן לא שולח בקשת preflight, ש-Apps Script לא עונה לה */
/* timeoutMs — אחרי הזמן הזה מוותרים על התשובה. זה לא אומר שהשרת לא
   שמר: הבקשה כבר יצאה. לכן שמירות עוברות בתור (sync.js), ששולח שוב את
   אותה בקשה עם אותו מזהה — והשרת מזהה אותה ולא יוצר כפילות. */
function api(action, params, timeoutMs) {
  var body = new URLSearchParams();
  body.append('action', action);
  if (S.token) body.append('token', S.token);
  Object.keys(params || {}).forEach(function (k) {
    var v = params[k];
    if (v !== undefined && v !== null && v !== '') body.append(k, typeof v === 'object' ? JSON.stringify(v) : v);
  });
  var ctl = (timeoutMs && typeof AbortController === 'function') ? new AbortController() : null;
  var t = ctl ? setTimeout(function () { ctl.abort(); }, timeoutMs) : null;
  return fetch(S.url, { method: 'POST', body: body, signal: ctl ? ctl.signal : undefined })
    .then(function (r) { return r.json(); })
    .then(function (r) { clearTimeout(t); setOffline(false); return r; })
    .catch(function () {
      clearTimeout(t); setOffline(true);
      return { ok: false, error: 'לא התקבלה תשובה מהשרת — בדוק את החיבור ונסה שוב', net: true };
    });
}
/* תשובה אחת שלא הגיעה היא לרוב תקלה חולפת (והשמירה נשלחת שוב לבד) —
   הפס האדום מופיע רק אחרי שתי תקלות ברצף, כדי לא להבהיל לחינם */
function setOffline(on) {
  S.netFails = on ? (S.netFails || 0) + 1 : 0;
  on = on && S.netFails >= 2;
  if (S.offline === on) return;
  S.offline = on;
  var b = byId('offline'); if (b) b.classList.toggle('hide', !on);
  var d = byId('syncdot'); if (d) d.classList.toggle('off', on);
}
function handleExpired(r) {
  if (r && r.expired) { toast('פג תוקף החיבור — התחבר מחדש', 'err'); logout(); return true; }
  return false;
}

/* ---------- מצב מקומי ---------- */
function applyPayload(r) {
  S.user = r.user; S.today = r.today || iso(new Date());
  S.sheetUrl = r.sheetUrl || ''; S.scriptVersion = r.scriptVersion || '';
  S.apiVersion = Number(r.apiVersion) || 1;     // 2 ומעלה = השרת יודע לעדכן במרוכז
  TABLE_KEYS.forEach(function (k) { S.d[k] = r[k] || []; });
  if (typeof qOverlay === 'function') qOverlay();      // שינויים שעוד בדרך לשרת
  S.ver++;
}
function cacheState() {
  var o = { user: S.user, today: S.today, sheetUrl: S.sheetUrl, scriptVersion: S.scriptVersion, apiVersion: S.apiVersion };
  TABLE_KEYS.forEach(function (k) { o[k] = S.d[k]; });
  lsSet(LS.cache, JSON.stringify(o));
}
/* המטמון מוצג רק אם הוא של המשתמש שהטוקן שייך לו — אחרת צופה שנכנס
   במחשב של מנהל היה רואה לרגע את נתוני המנהל (הוצאות בית, משתמשים) */
function tokenUid(t) {
  try { return atob(String(t || '').split('.')[0].replace(/-/g, '+').replace(/_/g, '/')).split('|')[0]; }
  catch (e) { return ''; }
}
function cacheGet() {
  try {
    var o = JSON.parse(lsGet(LS.cache) || 'null');
    return o && o.user && o.user.id === tokenUid(S.token) ? o : null;
  } catch (e) { return null; }
}
/* אחרי שמירה מוצלחת: מעדכנים את השורה מקומית, בלי לטעון הכל מחדש */
function upsertLocal(table, row) {
  var list = S.d[table], i;
  for (i = 0; i < list.length; i++) if (list[i].id === row.id) { list[i] = row; break; }
  if (i === list.length) list.push(row);
  S.ver++; cacheState();
}
function removeLocal(table, id) {
  S.d[table] = S.d[table].filter(function (x) { return x.id !== id; });
  S.ver++; cacheState();
}
function findRow(table, id) {
  var list = S.d[table] || [];
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

function loadAll(silent) {
  setSync(true);
  return api('load', {}).then(function (r) {
    setSync(false);
    if (!r.ok) {
      if (handleExpired(r)) return false;
      if (!silent) toast(r.error, 'err');
      hideBoot();
      return false;
    }
    var firstRender = !S.user || S.user.role !== r.user.role;
    applyPayload(r); cacheState(); S.lastLoad = Date.now();
    if (firstRender || !byId('wrap')) renderApp(); else if (!silent || !typingInPage()) { renderTop(); renderPage(); }
    qPump();
    return true;
  });
}
function refresh() { return loadAll(false).then(function (ok) { if (ok) toast('הנתונים עודכנו מהגיליון', 'ok'); }); }
function setSync(on) {
  S.syncing = on;
  var d = byId('syncdot'); if (d) d.classList.toggle('on', !!on);
}
/* חזרה ללשונית אחרי זמן — מושכים את מה שאחרים הזינו בינתיים */
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible' && S.user && Date.now() - S.lastLoad > 60000) loadAll(true);
});

/* =====================================================================
   מסכי פתיחה: חיבור לשרת · התקנה · כניסה
   ===================================================================== */
function hideBoot() { var b = byId('boot'); if (b) b.classList.add('hide'); }
function gate(inner) {
  byId('screen').innerHTML = '<div class="gate"><div class="gate-card">' +
    '<img class="gate-logo" src="logo.png" alt="BERRI" onerror="this.remove()">' + inner + '</div></div>';
  hideBoot();
}
function bindEnter(ids, fn) {
  ids.forEach(function (id) {
    var e = byId(id); if (!e) return;
    e.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); fn(); } });
  });
}
function isLocal() { return /^(localhost|127\.0\.0\.1)$/.test(location.hostname); }

function showUrlSetup() {
  gate('<h1>חיבור לגיליון</h1><p class="sub">הדבק את כתובת ה-Web App של Apps Script</p>' +
    '<div id="m" class="msg"></div>' +
    '<div class="field"><label>כתובת ‎/exec</label>' +
    '<input id="u" class="inp" dir="ltr" placeholder="https://script.google.com/macros/s/.../exec"></div>' +
    '<button class="btn p block" id="ub" onclick="saveUrl(this)">התחבר</button>' +
    '<p class="hint" style="margin-top:12px">הכתובת נשמרת בדפדפן הזה. אחרי שהיא תוטמע במערכת — אף אחד לא יצטרך להזין אותה.</p>');
  bindEnter(['u'], function () { saveUrl(byId('ub')); });
}
function saveUrl(btn) {
  var u = val('u');
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^\/]+\/exec/.test(u) && !(isLocal() && /^https?:\/\//.test(u))) {
    return setMsg('m', 'הכתובת צריכה להיות קישור ‎/exec של Apps Script');
  }
  S.url = u; busy(btn, true, 'בודק…');
  api('ping', {}).then(function (r) {
    busy(btn, false);
    if (!r.ok || r.app !== 'berri') return setMsg('m', r.error || 'הכתובת לא מגיבה כמו השרת של BERRI');
    lsSet(LS.url, u); boot();
  });
}

function showFirstSetup() {
  gate('<h1>התקנה ראשונה</h1><p class="sub">הגדרת המנהל של המערכת</p><div id="m" class="msg"></div>' +
    '<div class="field"><label>שם מלא</label><input id="fn" class="inp" autocomplete="name"></div>' +
    '<div class="field"><label>שם משתמש</label><input id="un" class="inp" dir="ltr" autocomplete="username"></div>' +
    '<div class="field"><label>סיסמה</label><input id="pw" class="inp" type="password" autocomplete="new-password" placeholder="6 תווים לפחות"></div>' +
    '<button class="btn o block" id="sb" onclick="doSetup(this)">יצירת מנהל וכניסה</button>' +
    '<p class="hint" style="margin-top:12px">אחר כך אפשר להוסיף משתמשים נוספים ממסך ההגדרות.</p>');
  byId('fn').focus();
  bindEnter(['fn', 'un', 'pw'], function () { doSetup(byId('sb')); });
}
function doSetup(btn) {
  var un = val('un'), pw = byId('pw').value;
  if (un.length < 3) return setMsg('m', 'שם משתמש חייב 3 תווים לפחות');
  if (pw.length < 6) return setMsg('m', 'סיסמה חייבת 6 תווים לפחות');
  busy(btn, true, 'יוצר…');
  api('setup', { username: un, password: pw, fullName: val('fn') }).then(function (r) {
    busy(btn, false);
    if (!r.ok) return setMsg('m', r.error);
    loginDone(r);
    toast('המערכת מוכנה — ברוך הבא', 'ok');
  });
}

function showLogin() {
  gate('<h1>ניהול פרוייקטים</h1><p class="sub">כניסה למערכת</p><div id="m" class="msg"></div>' +
    '<div class="field"><label>שם משתמש</label><input id="un" class="inp" dir="ltr" autocomplete="username"></div>' +
    '<div class="field"><label>סיסמה</label><input id="pw" class="inp" type="password" autocomplete="current-password"></div>' +
    '<button class="btn p block" id="lb" onclick="doLogin(this)">כניסה</button>');
  byId('un').focus();
  bindEnter(['un', 'pw'], function () { doLogin(byId('lb')); });
}
function doLogin(btn) {
  var un = val('un'), pw = byId('pw').value;
  if (!un || !pw) return setMsg('m', 'יש להזין שם משתמש וסיסמה');
  busy(btn, true, 'מתחבר…');
  api('login', { username: un, password: pw }).then(function (r) {
    busy(btn, false);
    if (!r.ok) return setMsg('m', r.error);
    loginDone(r);
  });
}
function loginDone(r) {
  S.token = r.token; lsSet(LS.tok, r.token);
  applyPayload(r); cacheState(); S.lastLoad = Date.now();
  renderApp();
  qPump();                                  // שינויים שחיכו לכניסה מחדש
}
/* רענון ברקע לא בונה את המסך מחדש בזמן שמקלידים בו (למשל בשורת הסינון) */
function typingInPage() {
  var a = document.activeElement;
  return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !!byId('wrap') && byId('wrap').contains(a);
}
function logout() {
  S.token = ''; S.user = null; lsDel(LS.tok); lsDel(LS.cache); closeModal();
  showLogin();
}
/* יציאה כשעוד יש שינויים בדרך: הם לא הולכים לאיבוד (שמורים במחשב הזה),
   אבל יישלחו רק בכניסה הבאה — כדאי שהמשתמש יידע */
function askLogout() {
  var n = (typeof Q !== 'undefined' && Q.items) ? Q.items.filter(qMine).length : 0;
  if (!n) return logout();
  confirmModal('יציאה', 'יש עוד <b>' + n + '</b> שינויים שנשלחים לגיליון ברקע.<br>' +
    'אם תצא עכשיו הם יישמרו במחשב הזה ויישלחו בכניסה הבאה ממנו.', 'לצאת בכל זאת',
    function () { closeModal(); logout(); });
}
function resetUrl() { lsDel(LS.url); S.url = DEFAULT_GS_URL || ''; boot(); }

function boot() {
  window.addEventListener('hashchange', onRoute);
  if (!S.url) return showUrlSetup();
  if (S.token) {
    var c = cacheGet();
    if (c) { applyPayload(c); renderApp(); }          /* מציגים מיד מהמטמון, ומרעננים ברקע */
    loadAll(!!c).then(function (ok) { if (ok === false && !S.user) pingThenGate(); });
    return;
  }
  pingThenGate();
}
function pingThenGate() {
  api('ping', {}).then(function (r) {
    if (!r.ok) {
      return gate('<h1>אין חיבור לשרת</h1><p class="sub">' + esc(r.error || 'הגיליון לא מגיב') + '</p>' +
        '<button class="btn p block" onclick="boot()">נסה שוב</button>' +
        (DEFAULT_GS_URL ? '' : '<button class="btn gh block" style="margin-top:8px" onclick="resetUrl()">הגדרת כתובת מחדש</button>'));
    }
    if (r.needsSetup) showFirstSetup(); else showLogin();
  });
}

/* =====================================================================
   שלד וניווט (לפי ה-hash בכתובת — כפתור "חזור" בדפדפן עובד)
   ===================================================================== */
var PAGES = [
  { k: 'dash',     t: 'תמונת מצב',     i: '📊' },
  { k: 'projects', t: 'פרוייקטים',      i: '🏗️' },
  { k: 'registers',t: 'קופות',          i: '💰' },
  { k: 'daily',    t: 'דוח יומי',       i: '📅' },
  { k: 'business', t: 'הוצאות עסק',     i: '🧾' },
  { k: 'home',     t: 'הוצאות בית',     i: '🏠', admin: true },
  { k: 'reports',  t: 'דוחות',          i: '📈' },
  { k: 'settings', t: 'הגדרות',         i: '⚙️' }
];
function pageAllowed(k) {
  var p = PAGES.filter(function (x) { return x.k === k; })[0];
  return !!p && (!p.admin || isAdmin());
}
function parseHash() {
  var h = decodeURIComponent(location.hash.replace(/^#\/?/, '')), i = h.indexOf('/');
  var page = i < 0 ? h : h.slice(0, i), arg = i < 0 ? '' : h.slice(i + 1);
  if (page === 'project' || page === 'register') return { page: page, arg: arg };
  if (!pageAllowed(page)) page = 'dash';
  return { page: page, arg: arg };
}
function go(page, arg) {
  var h = '#' + page + (arg ? '/' + encodeURIComponent(arg) : '');
  if (location.hash === h) { renderPage(); window.scrollTo(0, 0); }
  else location.hash = h;
}
function onRoute() {
  if (!S.user) return;
  S.route = parseHash();
  closeMenu();
  renderNav(); renderPage();
  window.scrollTo(0, 0);
}

function renderApp() {
  S.route = parseHash();
  byId('screen').innerHTML =
    '<div class="topbar"><div class="topbar-in">' +
      '<div class="brandmark" onclick="go(\'dash\')"><span class="bx"><i></i><i></i><i></i></span>' +
        '<span class="bn">BERRI<small>ניהול פרוייקטים</small></span></div>' +
      '<div class="sp"></div>' +
      '<span id="qbadge" class="qbadge hide"></span>' +
      '<div class="bal-pill" onclick="go(\'registers\')" title="יתרה בכל הקופות"><span class="t">בקופות</span>' +
        '<b id="balpill"></b><i id="syncdot" class="syncdot"></i></div>' +
      (canEdit() ? '<button class="tb-add" onclick="quickAdd()">➕<span class="t"> הזנה</span></button>' : '') +
      '<div class="who"><button class="who-btn" onclick="toggleMenu(event)">' +
        '<span class="avatar">' + esc(initials(S.user.fullName)) + '</span>' +
        '<span class="who-name">' + esc(S.user.fullName) + '<small>' + (ROLE_HE[S.user.role] || '') + '</small></span></button>' +
        '<div id="usermenu" class="menu hide">' +
          '<button onclick="closeMenu();refresh()">🔄 רענון מהגיליון</button>' +
          (S.sheetUrl ? '<a href="' + esc(S.sheetUrl) + '" target="_blank" rel="noopener" onclick="closeMenu()">📗 פתיחת הגיליון בגוגל שיטס</a>' : '') +
          '<button onclick="closeMenu();passwordModal()">🔑 החלפת סיסמה</button>' +
          '<button onclick="closeMenu();askLogout()">🚪 יציאה</button>' +
        '</div></div>' +
    '</div></div>' +
    '<div id="offline" class="offline' + (S.offline ? '' : ' hide') + '">אין חיבור לשרת — הנתונים המוצגים הם מהפעם האחרונה</div>' +
    '<div class="nav"><div class="nav-in" id="nav"></div></div>' +
    '<div class="wrap" id="wrap"></div>';
  hideBoot();
  renderTop(); renderNav(); renderPage();
  if (S.syncing) setSync(true);
  qBadge();
}
function renderTop() {
  var b = byId('balpill');
  if (b) b.textContent = money(calc().totalBalance);
}
function renderNav() {
  var n = byId('nav'); if (!n) return;
  var cur = S.route.page === 'project' ? 'projects' : S.route.page === 'register' ? 'registers' : S.route.page;
  n.innerHTML = PAGES.filter(function (p) { return !p.admin || isAdmin(); }).map(function (p) {
    return '<button class="nav-item' + (cur === p.k ? ' on' : '') + '" onclick="go(\'' + p.k + '\')"><span>' + p.i + '</span>' + p.t + '</button>';
  }).join('');
}
function toggleMenu(ev) { ev.stopPropagation(); byId('usermenu').classList.toggle('hide'); }
function closeMenu() { var m = byId('usermenu'); if (m) m.classList.add('hide'); }
document.addEventListener('click', closeMenu);

function renderPage() {
  var w = byId('wrap'); if (!w || !S.user) return;
  var r = S.route;
  var fn = { dash: pageDash, projects: pageProjects, project: pageProject, registers: pageRegisters,
             register: pageRegister, daily: pageDaily, business: pageBusiness, home: pageHome,
             reports: pageReports, settings: pageSettings }[r.page] || pageDash;
  fn(w, r.arg);
}
/* רינדור מחדש אחרי שינוי נתונים — המסך הנוכחי והיתרה למעלה */
function rerender() { renderTop(); renderPage(); }

/* ---------- חלונות ---------- */
function openModal(html, wide) {
  byId('modal-host').innerHTML = '<div class="modal" onmousedown="bgClose(event)"><div class="modal-box' + (wide ? ' wide' : '') + '">' + html + '</div></div>';
  var f = byId('modal-host').querySelector('[autofocus]');
  if (f && window.innerWidth > 720) f.focus();
}
function closeModal() { byId('modal-host').innerHTML = ''; }
function bgClose(ev) { if (ev.target.classList.contains('modal')) closeModal(); }
document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && byId('modal-host').innerHTML) closeModal(); });
function modalHtml(title, body, foot) {
  return '<div class="modal-head"><h3>' + title + '</h3><button class="icon-btn" onclick="closeModal()" aria-label="סגירה">✕</button></div>' +
    '<div class="modal-body">' + body + '</div>' + (foot ? '<div class="modal-foot">' + foot + '</div>' : '');
}
function confirmModal(title, html, okLabel, fn) {
  window._confirmFn = fn;
  openModal(modalHtml(title, '<div style="font-size:14.5px">' + html + '</div>',
    '<button class="btn d" id="cfb" onclick="window._confirmFn(this)">' + (okLabel || 'אישור') + '</button>' +
    '<button class="btn gh" onclick="closeModal()">ביטול</button>'));
}
function printPage(title) {
  var w = byId('wrap'), old = byId('print-head');
  if (old) old.remove();
  var h = document.createElement('div');
  h.id = 'print-head'; h.className = 'print-head';
  h.innerHTML = '<div><div class="t">' + esc(title) + '</div><div class="d">הופק ב-' + fmtDate(iso(new Date())) + ' · ' + esc(S.user.fullName) + '</div></div>' +
    '<img src="logo.png" alt="BERRI" onerror="this.remove()">';
  w.insertBefore(h, w.firstChild);
  setTimeout(function () { window.print(); }, 50);
}
