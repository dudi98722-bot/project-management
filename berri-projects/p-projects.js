/* BERRI — רשימת הפרוייקטים (גם הבסיס של "דוח כללי לפרוייקטים") */
'use strict';

/* עמודות הדוח הכללי. get = הערך לייצוא ולסיכום */
var PROJ_COLS = [
  { k: 'name', t: 'פרוייקט', get: function (s) { return s.p.name; } },
  { k: 'client', t: 'לקוח', get: function (s) { return s.p.client; } },
  { k: 'sub', t: 'קבלן משנה', get: function (s) { return s.p.subName; } },
  { k: 'start', t: 'התחלה', d: 1, get: function (s) { return s.p.startDate; } },
  { k: 'end', t: 'סיום', d: 1, get: function (s) { return s.p.endDate; } },
  { k: 'months', t: 'חודשים', n: 1, get: function (s) { return s.months ? Math.round(s.months * 10) / 10 : ''; } },
  { k: 'basePrice', t: 'מחיר בסיס', m: 1 }, { k: 'addClient', t: 'תוספות', m: 1 },
  { k: 'clientPrice', t: 'סה״כ ללקוח', m: 1 }, { k: 'clientPaid', t: 'נגבה', m: 1, c: 'in' },
  { k: 'clientDue', t: 'יתרת לקוח', m: 1 }, { k: 'subPrice', t: 'מחיר לקבלן', m: 1 },
  { k: 'subCovered', t: 'שולם + קוזז לקבלן', m: 1, c: 'out' }, { k: 'subDue', t: 'יתרה לקבלן', m: 1 },
  { k: 'expected', t: 'צפי הוצאות', m: 1 }, { k: 'ownExp', t: 'הוצאות בפועל', m: 1, c: 'out' },
  { k: 'planned', t: 'רווח מתוכנן', m: 1 }, { k: 'profit', t: 'רווח צפוי', m: 1, b: 1 },
  { k: 'monthly', t: 'רווח לחודש', m: 1, b: 1 }
];
function pv(c, s) { return c.get ? c.get(s) : s[c.k]; }

function projFiltered() {
  var v = calc(), f = S.ui.projFilter, q = S.ui.projSearch.toLowerCase();
  return sortedProjects().filter(function (p) {
    if (f === 'active' && !p.active) return false;
    if (f === 'closed' && p.active) return false;
    return !q || [p.name, p.client, p.subName, p.address].join(' ').toLowerCase().indexOf(q) >= 0;
  }).map(function (p) { return v.proj[p.id]; });
}

function projSeg() {
  var all = S.d.projects.length, act = S.d.projects.filter(function (p) { return p.active; }).length;
  return '<div class="seg">' + [['active', 'פעילים', act], ['closed', 'לא פעילים', all - act], ['all', 'הכל', all]].map(function (x) {
    return '<button class="' + (S.ui.projFilter === x[0] ? 'on' : '') + '" onclick="S.ui.projFilter=\'' + x[0] + '\';renderPage()">' +
      x[1] + '<span class="c">' + x[2] + '</span></button>';
  }).join('') + '</div>';
}

function pageProjects(w) {
  w.innerHTML = '<div class="page-head"><h2>🏗️ פרוייקטים</h2><div class="sp"></div>' +
      (canEdit() ? '<button class="btn o" onclick="projectModal()">➕ פרוייקט חדש</button>' : '') + '</div>' +
    '<div class="toolbar">' + projSeg() +
      '<input class="inp search" type="search" placeholder="חיפוש פרוייקט, לקוח או קבלן…" value="' + esc(S.ui.projSearch) + '" ' +
        'oninput="S.ui.projSearch=this.value;refreshProjTable()">' +
      '<div class="sp"></div><button class="btn sm gh" onclick="exportProjects()">📤 אקסל</button>' +
      '<button class="btn sm gh" onclick="printPage(\'דוח פרוייקטים\')">🖨️ הדפסה</button></div>' +
    '<div class="card"><div class="tbl-scroll"><table class="tbl"><thead><tr>' +
      '<th class="nosort toggle-col">פעיל</th>' + PROJ_COLS.map(function (c) { return '<th class="nosort' + (c.m || c.n ? ' num' : '') + '">' + c.t + '</th>'; }).join('') +
    '</tr></thead><tbody id="ptb"></tbody><tfoot id="ptf"></tfoot></table></div>' +
    '<div class="count-line" id="pcl"></div></div>' +
    '<p class="hint">סה״כ ללקוח = מחיר הבסיס שסוכם + כל התוספות שנרשמו. ' +
    'רווח צפוי = סה״כ ללקוח − סה״כ לקבלן − הוצאות (בפרוייקט פעיל: הגבוה מבין צפי ההוצאות לבפועל; בפרוייקט שהסתיים: בפועל). ' +
    'רווח לחודש = רווח צפוי חלקי משך הפרוייקט — מתאריך ההתחלה עד תאריך הסיום, ואם אין תאריך סיום — עד היום. ' +
    'מוצג רק בפרוייקט שרץ חודש לפחות, כי בפחות מזה החלוקה מנפחת את המספר.</p>';
  refreshProjTable();
}

function refreshProjTable() {
  var tb = byId('ptb'); if (!tb) return;
  var list = projFiltered();
  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="' + (PROJ_COLS.length + 1) + '"><div class="empty"><span class="ico">🏗️</span>' +
      (S.d.projects.length ? 'אין פרוייקטים שמתאימים לסינון' : '<b>עדיין אין פרוייקטים</b>התחילו ב"פרוייקט חדש"') + '</div></td></tr>';
    byId('ptf').innerHTML = ''; byId('pcl').textContent = '';
    return;
  }
  tb.innerHTML = list.map(function (s) {
    return '<tr class="click' + (s.p.active ? '' : ' dim') + '" onclick="go(\'project\',\'' + s.p.id + '\')">' +
      '<td class="toggle-col" onclick="event.stopPropagation()">' + activeToggle(s.p) + '</td>' +
      PROJ_COLS.map(function (c) {
        var x = pv(c, s);
        if (c.m) return '<td class="num' + (c.b ? ' m' : '') + (c.c ? ' ' + c.c : '') + moneyCls(x) + '">' + (x === null ? '<span class="muted">—</span>' : money(x)) + '</td>';
        if (c.d) return '<td class="num">' + (fmtDate(x) || '<span class="muted">—</span>') + '</td>';
        if (c.n) return '<td class="num">' + (x === '' ? '<span class="muted">—</span>' : x) + '</td>';
        return '<td>' + (c.k === 'name' ? '<b>' + esc(x) + '</b>' : esc(x || '')) + '</td>';
      }).join('') + '</tr>';
  }).join('');
  byId('ptf').innerHTML = '<tr><td></td>' + PROJ_COLS.map(function (c, i) {
    if (!c.m) return '<td>' + (i === 0 ? 'סה״כ ' + list.length + ' פרוייקטים' : '') + '</td>';
    return '<td class="num">' + money(sumOf(list, function (s) { return pv(c, s) || 0; })) + '</td>';
  }).join('') + '</tr>';
  byId('pcl').textContent = list.length + ' פרוייקטים';
}

function activeToggle(p) {
  var h = '<i></i>' + (p.active ? 'פעיל' : 'לא פעיל');
  return canEdit() ? '<button class="toggle' + (p.active ? ' on' : '') + '" onclick="toggleActive(\'' + p.id + '\')">' + h + '</button>'
    : '<span class="toggle' + (p.active ? ' on' : '') + '">' + h + '</span>';
}
function toggleActive(id) {
  var p = findRow('projects', id); if (!p) return;
  var next = !p.active;
  p.active = next; S.ver++; rerender();                 /* המסך מתעדכן מיד, השרת ברקע */
  api('save', { table: 'projects', row: { id: id, active: next } }).then(function (r) {
    if (r.ok) { upsertLocal('projects', r.row); toast(next ? 'הפרוייקט סומן כפעיל' : 'הפרוייקט סומן כלא פעיל', 'ok'); return; }
    if (handleExpired(r)) return;
    p.active = !next; S.ver++; rerender(); toast(r.error, 'err');
  });
}

function exportProjects() {
  var list = projFiltered();
  var head = ['פעיל'].concat(PROJ_COLS.map(function (c) { return c.t; }));
  var rows = list.map(function (s) {
    return [s.p.active ? 'כן' : 'לא'].concat(PROJ_COLS.map(function (c) {
      var x = pv(c, s);
      if (c.m) return { v: x === null ? '' : x, t: 'money' };
      if (c.d) return { v: x, t: 'd' };
      if (c.n) return x === '' ? '' : { v: x, t: 'n' };
      return x || '';
    }));
  });
  var foot = ['סה״כ'].concat(PROJ_COLS.map(function (c) { return c.m ? { v: sumOf(list, function (s) { return pv(c, s) || 0; }), t: 'money' } : ''; }));
  saveXlsx([{ name: 'פרוייקטים', rows: [head].concat(rows), foot: [foot] }], 'דוח פרוייקטים');
}
