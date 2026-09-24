/* BERRI — בחירת עמודות לתצוגה, לכל טבלה ודוח בנפרד.
   ההגדרה אישית ונשמרת במחשב הזה (לכל משתמש בנפרד). עמודה מוסתרת לא
   מופיעה גם בהדפסה ובייצוא לאקסל — מה שרואים הוא מה שמקבלים. */
'use strict';

function colsKey() { return 'berri_cols_' + (S.user ? S.user.id : ''); }
function colsPrefs() { try { return JSON.parse(lsGet(colsKey()) || '{}') || {}; } catch (e) { return {}; } }
function hiddenCols(key) { return colsPrefs()[key] || []; }
function isHidden(key, k) { return hiddenCols(key).indexOf(k) >= 0; }
function visibleCols(key, cols) {
  var h = hiddenCols(key);
  return cols.filter(function (c) { return h.indexOf(c.k) < 0; });
}

/* כל העמודות שאפשר לבחור, לכל מפתח */
function colsCatalog(key) {
  if (key === 'projects') return [{ k: '_active', t: 'פעיל' }].concat(PROJ_COLS);
  if (key === 'monthly') return MONTH_COLS;
  return TBL[key] ? TBL[key].cols : [];
}
var COLS_LOCKED = { projects: ['name'] };     // שם הפרוייקט הוא הקישור לדף שלו — תמיד מוצג

function colsModal(key, title) {
  var all = colsCatalog(key), locked = COLS_LOCKED[key] || [];
  openModal(modalHtml('⚙️ עמודות — ' + esc(title),
    '<p class="hint" style="margin:0 0 12px">מה שמסומן מוצג בטבלה, בהדפסה ובייצוא לאקסל. ' +
      'הבחירה נשמרת במחשב הזה, רק אצלך.</p>' +
    '<div class="cols-pick">' + all.map(function (c) {
      var on = !isHidden(key, c.k), lock = locked.indexOf(c.k) >= 0;
      return '<label class="check' + (on ? ' on' : '') + (lock ? ' locked' : '') + '">' +
        '<input type="checkbox"' + (on ? ' checked' : '') + (lock ? ' disabled' : '') +
        ' onchange="colToggle(\'' + key + '\',\'' + c.k + '\',this.checked,this)">' +
        '<span><b>' + esc(c.t) + '</b>' + (lock ? '<small>תמיד מוצג</small>' : '') + '</span></label>';
    }).join('') + '</div>',
    '<button class="btn" onclick="colsReset(\'' + key + '\',\'' + jsq(title) + '\')">↺ להציג הכל</button>' +
    '<div class="sp"></div><button class="btn o" onclick="closeModal()">סגירה</button>'));
}

function colToggle(key, k, on, el) {
  var p = colsPrefs(), h = (p[key] || []).filter(function (x) { return x !== k; });
  if (!on) {
    var shown = colsCatalog(key).filter(function (c) { return h.indexOf(c.k) < 0 && c.k !== k; });
    if (!shown.length) { el.checked = true; return toast('צריך להשאיר לפחות עמודה אחת', 'err'); }
    h.push(k);
    colsDropFilter(key, k);
  }
  p[key] = h;
  lsSet(colsKey(), JSON.stringify(p));
  if (el && el.parentNode) el.parentNode.classList.toggle('on', on);
  renderPage();                         // הטבלה שמאחורי החלון מתעדכנת מיד
}
function colsReset(key, title) {
  var p = colsPrefs(); delete p[key];
  lsSet(colsKey(), JSON.stringify(p));
  renderPage(); colsModal(key, title);
}
/* סינון על עמודה שהוסתרה היה ממשיך להסתיר שורות בלי שרואים למה — מבטלים אותו */
function colsDropFilter(key, k) {
  if (key === 'projects') { if (S.filters._proj) delete S.filters._proj[k]; return; }
  Object.keys(S.filters).forEach(function (id) {
    if ((id === key || id.indexOf(key + '_') === 0) && S.filters[id] && typeof S.filters[id] === 'object') delete S.filters[id][k];
  });
}
function colsBtn(key, title) {
  var n = hiddenCols(key).length;
  return '<button class="btn sm gh" onclick="colsModal(\'' + key + '\',\'' + jsq(title) + '\')" title="בחירת העמודות שיוצגו">' +
    '⚙️ עמודות' + (n ? ' · ' + n + ' מוסתרות' : '') + '</button>';
}
