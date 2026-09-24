/* =====================================================================
   BERRI — הרשאות לפי משתמש (צד המסך).
   המסך רק מסתיר ומציע — האכיפה האמיתית בשרת. אותה טבלה בדיוק:
   לכל אזור: צפייה / הוספה / עריכה / מחיקה. מנהל — הכל, וניהול משתמשים.
   ===================================================================== */
'use strict';

var PERM_AREAS = [
  { k: 'projects',         t: 'פרוייקטים ותוספות',   h: 'כולל מחירים, רווח ותוספות למחיר' },
  { k: 'clientPayments',   t: 'תשלומי לקוחות' },
  { k: 'subPayments',      t: 'תשלומים לקבלני משנה' },
  { k: 'projectExpenses',  t: 'הוצאות פרוייקט' },
  { k: 'businessExpenses', t: 'הוצאות עסק' },
  { k: 'homeExpenses',     t: 'הוצאות בית' },
  { k: 'cashMoves',        t: 'תנועות קופה',          h: 'כסף נכנס / יצא / העברות' },
  { k: 'registers',        t: 'קופות ויתרות',          h: 'צפייה = יתרות, כרטסת ודוח יומי; הוספה/עריכה = הגדרת קופות' },
  { k: 'reports',          t: 'דוחות ותמונת מצב',     h: 'צפייה בלבד. מציגים רק נתונים מאזורים שיש בהם צפייה', only: ['view'] },
  { k: 'categories',       t: 'קטגוריות',              h: 'של האזורים שהמשתמש עובד בהם' }
];
var PERM_ACTS = [{ k: 'view', t: 'צפייה' }, { k: 'add', t: 'הוספה' }, { k: 'edit', t: 'עריכה' }, { k: 'delete', t: 'מחיקה' }];
/* איזה אזור שולט בכל טבלה */
var AREA_OF = { projects: 'projects', additions: 'projects', clientPayments: 'clientPayments',
  subPayments: 'subPayments', projectExpenses: 'projectExpenses', businessExpenses: 'businessExpenses',
  homeExpenses: 'homeExpenses', cashMoves: 'cashMoves', registers: 'registers', categories: 'categories' };
var CAT_AREA = { project: 'projectExpenses', business: 'businessExpenses', home: 'homeExpenses',
                 'in': 'cashMoves', out: 'cashMoves' };

/* תבניות מוכנות — נקודת התחלה, ואחר כך מסמנים/מורידים תיבות */
function presetPerms(name) {
  var p = {};
  PERM_AREAS.forEach(function (a) { p[a.k] = { view: false, add: false, edit: false, 'delete': false }; });
  var set = function (areas, acts) { areas.forEach(function (a) { acts.forEach(function (k) { p[a][k] = true; }); }); };
  var work = ['projects', 'clientPayments', 'subPayments', 'projectExpenses', 'businessExpenses', 'cashMoves', 'categories'];
  if (name === 'viewer' || name === 'editor') set(work.concat(['registers', 'reports']), ['view']);
  if (name === 'editor') set(work, ['add', 'edit', 'delete']);
  if (name === 'field') set(['projectExpenses', 'businessExpenses'], ['add']);
  return p;
}

function can(area, act) {
  if (!S.user) return false;
  if (S.user.role === 'admin') return true;
  var P = S.perms || S.user.perms || presetPerms(S.user.role);   // שרת ישן שעוד לא מחזיר הרשאות
  return !!(P[area] && P[area][act]);
}
function canT(table, act) { return can(AREA_OF[table], act); }
function canAny(area) { return ['view', 'add', 'edit', 'delete'].some(function (k) { return can(area, k); }); }
function canCatGroup(group) { return canAny(CAT_AREA[group] || ''); }
function canCat(group, act) { return can('categories', act) && canCatGroup(group); }

/* ---------- עורך ההרשאות בחלון המשתמש ---------- */
function permMatrix(P) {
  return '<div class="perm-presets"><span class="lbl" style="margin:0">תבנית מהירה:</span>' +
      '<button type="button" class="btn sm" onclick="permApply(\'viewer\')">👁 צפייה בכל</button>' +
      '<button type="button" class="btn sm" onclick="permApply(\'editor\')">✏️ עורך</button>' +
      '<button type="button" class="btn sm" onclick="permApply(\'field\')">🧱 עובד שטח — הזנת הוצאות</button>' +
      '<button type="button" class="btn sm gh" onclick="permApply(\'none\')">✕ ניקוי</button></div>' +
    '<div class="tbl-scroll"><table class="tbl perm-tbl"><thead><tr><th class="nosort">אזור</th>' +
      PERM_ACTS.map(function (a) { return '<th class="nosort" style="text-align:center">' + a.t + '</th>'; }).join('') +
    '</tr></thead><tbody>' + PERM_AREAS.map(function (a) {
      return '<tr><td><b>' + a.t + '</b>' + (a.h ? '<div class="muted" style="font-size:11.5px">' + a.h + '</div>' : '') + '</td>' +
        PERM_ACTS.map(function (x) {
          var off = a.only && a.only.indexOf(x.k) < 0;
          return '<td style="text-align:center">' + (off ? '<span class="muted">—</span>' :
            '<input type="checkbox" class="perm-cb" data-a="' + a.k + '" data-k="' + x.k + '"' +
            (P && P[a.k] && P[a.k][x.k] ? ' checked' : '') + '>') + '</td>';
        }).join('') + '</tr>';
    }).join('') + '</tbody></table></div>' +
    '<p class="hint" style="margin-top:8px">הוספה בלי צפייה מותרת בכוונה — למשל עובד שטח שמזין הוצאות ולא רואה את כל ההוצאות. ' +
      'מה שאין עליו צפייה לא נשלח למחשב שלו בכלל.</p>';
}
function permApply(name) {
  var P = presetPerms(name);
  document.querySelectorAll('.perm-cb').forEach(function (cb) { cb.checked = !!P[cb.dataset.a][cb.dataset.k]; });
}
function permRead() {
  var P = presetPerms('none');
  document.querySelectorAll('.perm-cb').forEach(function (cb) { P[cb.dataset.a][cb.dataset.k] = cb.checked; });
  return P;
}
/* תקציר להצגה בטבלת המשתמשים */
function permSummary(u) {
  if (u.role === 'admin') return 'הכל';
  var P = u.perms || presetPerms(u.role), seen = [], added = [];
  PERM_AREAS.forEach(function (a) {
    var x = P[a.k] || {};
    if (x.view) seen.push(a.t);
    else if (x.add) added.push(a.t);
  });
  if (!seen.length && !added.length) return 'אין גישה';
  return (seen.length ? 'רואה: ' + seen.length + ' אזורים' : '') + (seen.length && added.length ? ' · ' : '') +
         (added.length ? 'מזין בלבד: ' + added.join(', ') : '');
}
