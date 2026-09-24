/* BERRI — דוח חודשי ודוח חובות פתוחים */
'use strict';

/* עמודות הדוח החודשי. הוצאות הבית מוצגות לכולם כסכום (כמו בכרטסת הקופה),
   בלי פירוט — אחרת התזרים לא היה מסתכם מהעמודות. ניתן להסתיר (⚙️ עמודות) */
var MONTH_COLS = [
  { k: 'cp',  t: '📥 מלקוחות',       x: 'מלקוחות',         c: 'in' },
  { k: 'in',  t: '⬇️ כסף אחר',       x: 'כסף אחר שנכנס',  c: 'in' },
  { k: 'sp',  t: '👷 לקבלנים',        x: 'לקבלנים',         c: 'out' },
  { k: 'pe',  t: '🧱 הוצ׳ פרוייקט',   x: 'הוצאות פרוייקט',  c: 'out' },
  { k: 'be',  t: '🧾 הוצ׳ עסק',       x: 'הוצאות עסק',      c: 'out' },
  { k: 'he',  t: '🏠 הוצ׳ בית',       x: 'הוצאות בית',      c: 'out' },
  { k: 'out', t: '⬆️ כסף אחר',       x: 'כסף אחר שיצא',   c: 'out' },
  { k: 'net', t: 'תזרים',            x: 'תזרים',           c: 'net' }
];
/* התזרים תמיד מחושב מכל התנועות — הסתרת עמודה משנה את התצוגה, לא את החשבון */
function monthRows() {
  var by = {};
  calc().moves.forEach(function (m) {
    if (m.k === 'tr') return;
    var ym = m.date.slice(0, 7);
    by[ym] = by[ym] || { ym: ym, cp: 0, sp: 0, pe: 0, be: 0, he: 0, in: 0, out: 0 };
    by[ym][m.k] += m.amount;
  });
  return Object.keys(by).sort().reverse().map(function (k) {
    var r = by[k];
    r.net = round2(r.cp + r.in - r.sp - r.pe - r.be - r.he - r.out);
    return r;
  });
}

function repMonthly(el) {
  var list = monthRows(), cols = visibleCols('monthly', MONTH_COLS);
  var cell = function (c, r) {
    if (c.k === 'net') return '<td class="num m' + moneyCls(r.net) + '">' + money(r.net) + '</td>';
    return '<td class="num ' + (r[c.k] ? c.c : 'muted') + '">' + money(r[c.k]) + '</td>';
  };
  el.innerHTML = '<div class="card"><div class="card-head"><h3>🗓️ תזרים לפי חודשים</h3><div class="sp"></div>' +
      colsBtn('monthly', 'דוח חודשי') +
      '<button class="btn sm gh" onclick="exportMonthly()">📤 אקסל</button></div><div class="tbl-scroll">' +
    '<table class="tbl"><thead><tr><th class="nosort">חודש</th>' +
      cols.map(function (c) { return '<th class="nosort num">' + c.t + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (list.length ? list.map(function (r) {
        return '<tr><td><b>' + monthLabel(r.ym) + '</b></td>' + cols.map(function (c) { return cell(c, r); }).join('') + '</tr>';
      }).join('') : '<tr><td colspan="' + (cols.length + 1) + '"><div class="empty">אין תנועות עדיין</div></td></tr>') +
    '</tbody><tfoot><tr><td>סה״כ</td>' +
      cols.map(function (c) { return '<td class="num">' + money(sumOf(list, function (r) { return r[c.k]; })) + '</td>'; }).join('') +
    '</tr></tfoot></table></div></div>';
}
function exportMonthly() {
  var list = monthRows(), cols = visibleCols('monthly', MONTH_COLS), M = function (x) { return { v: x, t: 'money' }; };
  saveXlsx([{ name: 'לפי חודשים',
    rows: [['חודש'].concat(cols.map(function (c) { return c.x; }))].concat(list.map(function (r) {
      return [monthLabel(r.ym)].concat(cols.map(function (c) { return M(r[c.k]); }));
    })),
    foot: [['סה״כ'].concat(cols.map(function (c) { return M(sumOf(list, function (r) { return r[c.k]; })); }))] }], 'דוח חודשי');
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
