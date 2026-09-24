/* BERRI — דוח חודשי ודוח חובות פתוחים */
'use strict';

function repMonthly(el) {
  var v = calc(), by = {};
  v.moves.forEach(function (m) {
    if (m.k === 'tr') return;
    var ym = m.date.slice(0, 7);
    by[ym] = by[ym] || { ym: ym, cp: 0, sp: 0, pe: 0, be: 0, he: 0, in: 0, out: 0 };
    by[ym][m.k] += m.amount;
  });
  var list = Object.keys(by).sort().reverse().map(function (k) {
    var r = by[k];
    r.inn = r.cp + r.in; r.exp = r.sp + r.pe + r.be + r.he + r.out; r.net = round2(r.inn - r.exp);
    return r;
  });
  var COLS = [['cp', '📥 מלקוחות', 'in'], ['in', '⬇️ כסף אחר', 'in'], ['sp', '👷 לקבלנים', 'out'],
    ['pe', '🧱 הוצ׳ פרוייקט', 'out'], ['be', '🧾 הוצ׳ עסק', 'out']];
  if (isAdmin()) COLS.push(['he', '🏠 הוצ׳ בית', 'out']);
  COLS.push(['out', '⬆️ כסף אחר', 'out']);
  el.innerHTML = '<div class="card"><div class="card-head"><h3>🗓️ תזרים לפי חודשים</h3><div class="sp"></div>' +
      '<button class="btn sm gh" onclick="exportMonthly()">📤 אקסל</button></div><div class="tbl-scroll">' +
    '<table class="tbl"><thead><tr><th class="nosort">חודש</th>' +
      COLS.map(function (c) { return '<th class="nosort num">' + c[1] + '</th>'; }).join('') +
      '<th class="nosort num">תזרים</th></tr></thead><tbody>' +
      (list.length ? list.map(function (r) {
        return '<tr><td><b>' + monthLabel(r.ym) + '</b></td>' +
          COLS.map(function (c) { return '<td class="num ' + (r[c[0]] ? c[2] : 'muted') + '">' + money(r[c[0]]) + '</td>'; }).join('') +
          '<td class="num m' + moneyCls(r.net) + '">' + money(r.net) + '</td></tr>';
      }).join('') : '<tr><td colspan="' + (COLS.length + 2) + '"><div class="empty">אין תנועות עדיין</div></td></tr>') +
    '</tbody><tfoot><tr><td>סה״כ</td>' +
      COLS.map(function (c) { return '<td class="num">' + money(sumOf(list, function (r) { return r[c[0]]; })) + '</td>'; }).join('') +
      '<td class="num">' + money(sumOf(list, function (r) { return r.net; })) + '</td></tr></tfoot></table></div></div>';
}
function exportMonthly() {
  var v = calc(), by = {};
  v.moves.forEach(function (m) {
    if (m.k === 'tr') return;
    var ym = m.date.slice(0, 7);
    by[ym] = by[ym] || { cp: 0, sp: 0, pe: 0, be: 0, he: 0, in: 0, out: 0 };
    by[ym][m.k] += m.amount;
  });
  var M = function (x) { return { v: x, t: 'money' }; };
  saveXlsx([{ name: 'לפי חודשים', rows: [['חודש', 'מלקוחות', 'כסף אחר שנכנס', 'לקבלנים', 'הוצאות פרוייקט', 'הוצאות עסק', 'הוצאות בית', 'כסף אחר שיצא', 'תזרים']].concat(
    Object.keys(by).sort().reverse().map(function (k) {
      var r = by[k], net = r.cp + r.in - r.sp - r.pe - r.be - r.he - r.out;
      return [monthLabel(k), M(r.cp), M(r.in), M(r.sp), M(r.pe), M(r.be), M(r.he), M(r.out), M(round2(net))];
    })) }], 'דוח חודשי');
}

function repDebts(el) {
  var v = calc();
  var cl = S.d.projects.map(function (p) { return v.proj[p.id]; }).filter(function (s) { return s.clientDue > 0.5; })
    .sort(function (a, b) { return b.clientDue - a.clientDue; });
  var sb = S.d.projects.map(function (p) { return v.proj[p.id]; }).filter(function (s) { return s.subDue > 0.5; })
    .sort(function (a, b) { return b.subDue - a.subDue; });
  var tbl = function (title, icon, list, key, who, cls) {
    return '<div class="card"><div class="card-head"><h3>' + icon + ' ' + title + '</h3><div class="sp"></div>' +
        '<span class="badge ' + cls + '">' + money(sumOf(list, function (s) { return s[key]; })) + '</span></div>' +
      (list.length ? '<div class="tbl-scroll"><table class="tbl"><thead><tr><th class="nosort">פרוייקט</th><th class="nosort">' + who + '</th>' +
        '<th class="nosort num">מחיר</th><th class="nosort num">שולם</th><th class="nosort num">יתרה</th><th class="nosort">התקדמות</th></tr></thead><tbody>' +
        list.map(function (s) {
          var price = key === 'clientDue' ? s.clientPrice : s.subPrice, paid = key === 'clientDue' ? s.clientPaid : s.subCovered;
          return '<tr class="click' + (s.p.active ? '' : ' dim') + '" onclick="go(\'project\',\'' + s.p.id + '\')">' +
            '<td><b>' + esc(s.p.name) + '</b>' + (s.p.active ? '' : ' <span class="badge gray">לא פעיל</span>') + '</td>' +
            '<td>' + esc((key === 'clientDue' ? s.p.client : s.p.subName) || '—') + '</td>' +
            '<td class="num">' + money(price) + '</td><td class="num">' + money(paid) + '</td>' +
            '<td class="num m">' + money(s[key]) + '</td>' +
            '<td style="min-width:90px">' + bar(pct(paid, price), cls === 'g' ? 'g' : 'n') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty">אין יתרות פתוחות 👍</div>') + '</div>';
  };
  el.innerHTML = '<div class="kpis">' +
      kpi('📥 לגבות מלקוחות', v.clientDebt, cl.length + ' פרוייקטים', 'green') +
      kpi('👷 לשלם לקבלנים', v.subDebt, sb.length + ' פרוייקטים', 'red') +
      kpi('⚖️ הפרש', round2(v.clientDebt - v.subDebt), 'גבייה פחות תשלומים', 'navy') + '</div>' +
    tbl('חובות לקוחות', '📥', cl, 'clientDue', 'לקוח', 'g') +
    tbl('יתרות לקבלני משנה', '👷', sb, 'subDue', 'קבלן משנה', 'r');
}
