/* BERRI — הוצאות עסק (ללא שיוך לפרוייקט) והוצאות בית */
'use strict';

/* סיכום לפי קטגוריה לתקופה — משמש בשני המסכים */
function expenseView(w, opt) {
  var per = S.ui.expPeriod, today = calc().today, from = '', to = '';
  /* גם גבול עליון: הוצאה שנרשמה מראש לחודש הבא לא נכנסת ל"החודש" */
  if (per === 'month') { from = today.slice(0, 7) + '-01'; to = today.slice(0, 7) + '-31'; }
  else if (per === 'year') { from = today.slice(0, 4) + '-01-01'; to = today.slice(0, 4) + '-12-31'; }
  var rows = TBL[opt.tk].rows().filter(function (x) { return (!from || x.date >= from) && (!to || x.date <= to); });
  var by = {};
  rows.forEach(function (x) {
    var k = x.category || '(ללא קטגוריה)';
    by[k] = (by[k] || 0) + (Number(x.amount) || 0);
  });
  var cats = Object.keys(by).map(function (k) { return { n: k, a: by[k] }; }).sort(function (a, b) { return b.a - a.a; });
  var tot = sumOf(rows), max = cats.length ? cats[0].a : 0;
  var perLabel = { month: monthLabel(today.slice(0, 7)), year: 'שנת ' + today.slice(0, 4), all: 'כל התקופות' }[per];

  w.innerHTML =
    '<div class="page-head"><h2>' + opt.icon + ' ' + opt.title + '</h2><div class="sp"></div>' +
      (opt.can ? '<button class="btn o" onclick="entryModal(\'' + opt.kind + '\')">➕ הוצאה חדשה</button>' : '') + '</div>' +
    '<div class="toolbar"><div class="seg">' + [['month', 'החודש'], ['year', 'השנה'], ['all', 'הכל']].map(function (x) {
      return '<button class="' + (per === x[0] ? 'on' : '') + '" onclick="S.ui.expPeriod=\'' + x[0] + '\';renderPage()">' + x[1] + '</button>';
    }).join('') + '</div><div class="sp"></div>' +
      '<button class="btn sm gh" onclick="printPage(\'' + jsq(opt.title) + '\')">🖨️ הדפסה</button></div>' +
    '<div class="kpis">' + kpi('סה״כ ' + perLabel, tot, rows.length + ' הוצאות', 'red') +
      (cats.length ? kpi('הקטגוריה הגדולה', cats[0].a, cats[0].n, 'amber') : '') +
      kpi('ממוצע להוצאה', rows.length ? tot / rows.length : 0, '', 'navy') + '</div>' +
    '<div class="cols2"><div>' + tableCard(opt.tk, '', { add: 'entryModal(\'' + opt.kind + '\')', addLabel: 'הוצאה' }) + '</div><div>' +
      '<div class="card"><div class="card-head"><h3>📊 לפי קטגוריה — ' + perLabel + '</h3></div><div class="card-body">' +
        (cats.length ? cats.map(function (c) {
          return '<div style="padding:7px 0;border-bottom:1px solid var(--line-2)">' +
            '<div style="display:flex;gap:8px;align-items:baseline"><span style="font-weight:600">' + esc(c.n) + '</span>' +
            '<span class="sp" style="flex:1"></span><b class="num">' + money(c.a) + '</b>' +
            '<span class="muted" style="font-size:12px;min-width:38px;text-align:end">' + Math.round(pct(c.a, tot)) + '%</span></div>' +
            bar(pct(c.a, max), 'r') + '</div>';
        }).join('') : '<div class="empty">אין הוצאות בתקופה</div>') +
      '</div></div>' +
    '</div></div>';
  mountTables([[opt.tk, '']]);
}

function pageBusiness(w) {
  expenseView(w, { tk: 'businessExpenses', kind: 'be', icon: '🧾', title: 'הוצאות עסק', can: can('businessExpenses', 'add') });
}
function pageHome(w) {
  if (!can('homeExpenses', 'view')) { w.innerHTML = '<div class="empty"><b>אין לך הרשאה לצפות בהוצאות הבית</b></div>'; return; }
  expenseView(w, { tk: 'homeExpenses', kind: 'he', icon: '🏠', title: 'הוצאות בית', can: can('homeExpenses', 'add') });
}
