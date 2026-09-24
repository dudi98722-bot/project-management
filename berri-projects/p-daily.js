/* BERRI — דוח יומי: לאן זז הכסף, בחלוקה לקופות */
'use strict';

/* ברירת המחדל היא היום; אם היום עוד לא זזה בו אגורה — היום האחרון
   שהיה בו כסף, כדי שהמסך לא ייפתח ריק */
function defaultDay() {
  var v = calc(), today = v.today;
  if (v.moves.some(function (m) { return m.date === today; })) return today;
  var past = v.moves.filter(function (m) { return m.date <= today; });
  return past.length ? past[past.length - 1].date : today;
}
function dayRange() {
  var u = S.ui, d = u.day || defaultDay();
  if (u.dayMode === 'range') return { from: u.dayFrom || d, to: u.dayTo || d };
  return { from: d, to: d };
}
function dayMoves(R) {
  return calc().moves.filter(function (m) { return m.date >= R.from && m.date <= R.to; });
}

function pageDaily(w) {
  var R = dayRange(), list = dayMoves(R), one = R.from === R.to;
  var byReg = {};
  list.forEach(function (m) { (byReg[m.reg] = byReg[m.reg] || []).push(m); });
  var tin = sumOf(list.filter(function (m) { return m.dir > 0; })), tout = sumOf(list.filter(function (m) { return m.dir < 0; }));
  w.innerHTML =
    '<div class="page-head"><h2>📅 דוח יומי</h2><div class="sp"></div>' +
      '<button class="btn sm gh" onclick="exportDaily()">📤 אקסל</button>' +
      '<button class="btn sm gh" onclick="printPage(\'דוח יומי\')">🖨️ הדפסה</button></div>' +
    '<div class="card noprint"><div class="card-body daybar">' +
      '<div class="seg">' + [['day', 'יום אחד'], ['range', 'טווח תאריכים']].map(function (x) {
        return '<button class="' + (S.ui.dayMode === x[0] ? 'on' : '') + '" onclick="S.ui.dayMode=\'' + x[0] + '\';renderPage()">' + x[1] + '</button>';
      }).join('') + '</div>' +
      (one && S.ui.dayMode === 'day'
        ? '<button class="btn sm" onclick="shiftDay(-1)">‹ אתמול</button>' +
          '<input class="inp" type="date" value="' + esc(R.from) + '" onchange="S.ui.day=this.value;renderPage()">' +
          '<button class="btn sm" onclick="shiftDay(1)">מחר ›</button>' +
          '<button class="btn sm gh" onclick="S.ui.day=\'\';renderPage()">היום</button>'
        : '<input class="inp" type="date" value="' + esc(R.from) + '" onchange="S.ui.dayFrom=this.value;renderPage()">' +
          '<span class="muted">עד</span>' +
          '<input class="inp" type="date" value="' + esc(R.to) + '" onchange="S.ui.dayTo=this.value;renderPage()">') +
      '<div class="sp" style="flex:1"></div><span class="day-title">' + (one ? dayLabel(R.from) : fmtDate(R.from) + ' – ' + fmtDate(R.to)) + '</span>' +
    '</div></div>' +
    '<div class="kpis">' + kpi('⬇️ נכנס', tin, '', 'green') + kpi('⬆️ יצא', tout, '', 'red') +
      kpi('תזרים', tin - tout, list.length + ' תנועות', 'navy') + '</div>' +
    (list.length ? sortedRegisters(true).filter(function (r) { return byReg[r.id]; }).map(function (r) {
      return dayRegCard(r, byReg[r.id], R);
    }).join('') : '<div class="card"><div class="empty"><span class="ico">📅</span><b>אין תנועות בתקופה הזו</b>נסו תאריך אחר</div></div>');
}
/* אתמול/מחר ביחס ליום שמוצג על המסך — לא ביחס להיום */
function shiftDay(n) { S.ui.day = addDays(dayRange().from, n); renderPage(); }

function dayRegCard(r, list, R) {
  var start = regBalance(r, addDays(R.from, -1)), end = regBalance(r, R.to);
  /* תנועה מלפני תאריך יתרת הפתיחה כבר כלולה ביתרה — מוצגת, אבל לא נספרת,
     כדי שפתיחה + נכנס − יצא = סגירה */
  var counts = function (m) { return !r.openingDate || m.date >= r.openingDate; };
  var tin = sumOf(list.filter(function (m) { return m.dir > 0 && counts(m); }));
  var tout = sumOf(list.filter(function (m) { return m.dir < 0 && counts(m); }));
  return '<div class="card"><div class="card-head"><h3>💰 ' + esc(r.name) + '</h3><div class="sp"></div>' +
      '<span class="muted">פתיחה ' + money(start) + '</span><span class="badge' + (end < 0 ? ' r' : '') + '">סגירה ' + money(end) + '</span></div>' +
    '<div class="tbl-scroll"><table class="tbl"><thead><tr><th class="nosort">תאריך</th><th class="nosort">סוג</th>' +
      '<th class="nosort">פירוט</th><th class="nosort num">נכנס</th><th class="nosort num">יצא</th></tr></thead><tbody>' +
      list.map(function (m) {
        var pre = !counts(m);
        return '<tr class="' + (m.pid ? 'click' : '') + (pre ? ' dim' : '') + '"' + (m.pid ? ' onclick="go(\'project\',\'' + m.pid + '\')"' : '') + '>' +
          '<td class="num">' + fmtDate(m.date) + '</td><td><span class="mv-type">' + MV[m.k].i + ' ' + MV[m.k].t + '</span></td>' +
          '<td>' + esc(m.desc) + (pre ? ' <span class="badge gray">כלול ביתרת הפתיחה</span>' : '') + '</td>' +
          '<td class="num in">' + (m.dir > 0 ? money(m.amount) : '') + '</td>' +
          '<td class="num out">' + (m.dir < 0 ? money(m.amount) : '') + '</td></tr>';
      }).join('') +
    '</tbody><tfoot><tr><td colspan="3">סה״כ</td><td class="num">' + money(tin) + '</td><td class="num">' + money(tout) + '</td></tr></tfoot></table></div></div>';
}

function exportDaily() {
  var R = dayRange(), list = dayMoves(R);
  saveXlsx([{ name: 'דוח יומי', rows: [['תאריך', 'קופה', 'סוג', 'פירוט', 'נכנס', 'יצא']].concat(
    list.map(function (m) {
      return [{ v: m.date, t: 'd' }, regName(m.reg), MV[m.k].t, m.desc,
        m.dir > 0 ? { v: m.amount, t: 'money' } : '', m.dir < 0 ? { v: m.amount, t: 'money' } : ''];
    })) }], 'דוח יומי ' + R.from + (R.from === R.to ? '' : ' עד ' + R.to));
}
