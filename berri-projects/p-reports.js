/* BERRI — דוחות: סיכום כללי, חודשי, וחובות פתוחים */
'use strict';

var REP_TABS = [['summary', '📋 סיכום כללי'], ['monthly', '🗓️ לפי חודשים'], ['debts', '⚖️ חובות פתוחים']];

function pageReports(w) {
  var t = S.ui.repTab;
  w.innerHTML = '<div class="page-head"><h2>📈 דוחות</h2><div class="sp"></div>' +
      '<button class="btn sm gh" onclick="printPage(\'דוח BERRI\')">🖨️ הדפסה</button></div>' +
    '<div class="toolbar noprint"><div class="seg">' + REP_TABS.map(function (x) {
      return '<button class="' + (t === x[0] ? 'on' : '') + '" onclick="S.ui.repTab=\'' + x[0] + '\';renderPage()">' + x[1] + '</button>';
    }).join('') + '</div></div>' +
    '<div id="rep"></div>';
  ({ summary: repSummary, monthly: repMonthly, debts: repDebts }[t] || repSummary)(byId('rep'));
}

function repSummary(el) {
  var v = calc(), all = S.d.projects.map(function (p) { return v.proj[p.id]; });
  var act = all.filter(function (s) { return s.p.active; }), done = all.filter(function (s) { return !s.p.active; });
  var S_ = function (list, f) { return sumOf(list, f); };
  var totBiz = sumOf(S.d.businessExpenses), totHome = sumOf(S.d.homeExpenses);
  var profit = S_(all, function (s) { return s.profit; });
  var rows = [
    ['הכנסות מפרוייקטים (מחיר ללקוח)', S_(all, function (s) { return s.clientPrice; })],
    ['נגבה בפועל', S_(all, function (s) { return s.clientPaid; }), 'in'],
    ['יתרה לגבייה', v.clientDebt],
    ['—'],
    ['עלות קבלני משנה', S_(all, function (s) { return s.subPrice; })],
    ['שולם וקוזז לקבלנים', S_(all, function (s) { return s.subCovered; }), 'out'],
    ['יתרה לתשלום לקבלנים', v.subDebt],
    ['—'],
    ['הוצאות פרוייקטים בפועל', S_(all, function (s) { return s.ownExp; }), 'out'],
    ['הוצאות עסק (ללא שיוך)', totBiz, 'out'],
    ['—'],
    ['רווח מכל הפרוייקטים', profit, 'b'],
    ['בניכוי הוצאות עסק', round2(profit - totBiz), 'b']
  ];
  el.innerHTML = '<div class="kpis">' +
      kpi('📈 רווח מפרוייקטים', profit, all.length + ' פרוייקטים', 'green') +
      kpi('🧾 הוצאות עסק', totBiz, 'ללא שיוך לפרוייקט', 'red') +
      kpi('💼 רווח נטו', round2(profit - totBiz), 'אחרי הוצאות העסק', 'navy') +
      (can('homeExpenses', 'view') ? kpi('🏠 הוצאות בית', totHome, 'סך הכל', 'amber') : '') +
      kpi('💰 בקופות עכשיו', v.totalBalance, '', 'blue') +
    '</div>' +
    '<div class="cols2"><div><div class="card"><div class="card-head"><h3>📋 סיכום כספי כולל</h3></div><table class="tbl"><tbody>' +
      rows.map(function (r) {
        if (r[0] === '—') return '<tr><td colspan="2" style="padding:3px;background:var(--line-2)"></td></tr>';
        return '<tr><td' + (r[2] === 'b' ? ' style="font-weight:800"' : '') + '>' + r[0] + '</td>' +
          '<td class="num m ' + (r[2] === 'in' ? 'in' : r[2] === 'out' ? 'out' : '') + moneyCls(r[1]) + '"' +
          (r[2] === 'b' ? ' style="font-size:15px"' : '') + '>' + money(r[1]) + '</td></tr>';
      }).join('') + '</tbody></table></div></div><div>' +
      '<div class="card"><div class="card-head"><h3>🏗️ לפי סטטוס</h3></div><table class="tbl"><thead><tr>' +
        '<th class="nosort"></th><th class="nosort num">פרוייקטים</th><th class="nosort num">רווח</th><th class="nosort num">לחודש</th></tr></thead><tbody>' +
        [['פעילים', act], ['הסתיימו', done]].map(function (x) {
          return '<tr><td>' + x[0] + '</td><td class="num">' + x[1].length + '</td>' +
            '<td class="num m' + moneyCls(S_(x[1], function (s) { return s.profit; })) + '">' + money(S_(x[1], function (s) { return s.profit; })) + '</td>' +
            '<td class="num">' + money(S_(x[1], function (s) { return s.monthly || 0; })) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
      '<div class="card"><div class="card-head"><h3>🏆 הפרוייקטים הרווחיים</h3></div><table class="tbl"><tbody>' +
        all.slice().sort(function (a, b) { return b.profit - a.profit; }).slice(0, 7).map(function (s) {
          return '<tr class="click" onclick="go(\'project\',\'' + s.p.id + '\')"><td>' + esc(s.p.name) + '</td>' +
            '<td class="num m' + moneyCls(s.profit) + '">' + money(s.profit) + '</td>' +
            '<td class="num muted">' + (s.monthly === null ? '—' : money(s.monthly) + '/ח') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
    '</div></div>';
}
