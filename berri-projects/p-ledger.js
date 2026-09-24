/* BERRI — כרטסת קופה: כל התנועות עם יתרה מצטברת */
'use strict';

function ledgerRows(r, from, to) {
  var v = calc();
  var list = v.moves.filter(function (m) {
    return m.reg === r.id && (!r.openingDate || m.date >= r.openingDate) && (!from || m.date >= from) && (!to || m.date <= to);
  });
  var open = from ? regBalance(r, addDays(from, -1)) : (Number(r.opening) || 0);
  var bal = open;
  list.forEach(function (m) { bal = round2(bal + m.dir * m.amount); m.run = bal; });
  return { open: open, list: list, close: bal };
}

function pageRegister(w, id) {
  var r = findRow('registers', id);
  if (!r) { w.innerHTML = '<div class="empty"><b>הקופה לא נמצאה</b></div>'; return; }
  var L = ledgerRows(r, S.ui.ledgerFrom, S.ui.ledgerTo), ed = can('cashMoves', 'add');
  var tin = sumOf(L.list.filter(function (m) { return m.dir > 0; })), tout = sumOf(L.list.filter(function (m) { return m.dir < 0; }));
  w.innerHTML =
    '<div class="crumb noprint"><a onclick="go(\'registers\')">💰 קופות</a> ‹ ' + esc(r.name) + '</div>' +
    '<div class="page-head"><h2>📒 כרטסת — ' + esc(r.name) + '</h2><div class="sp"></div>' +
      (can('registers', 'edit') ? '<button class="btn sm" onclick="registerModal(\'' + id + '\')">✏️ עריכת קופה</button>' : '') +
      '<button class="btn sm gh" onclick="exportLedger(\'' + id + '\')">📤 אקסל</button>' +
      '<button class="btn sm gh" onclick="printPage(\'כרטסת קופה — ' + jsq(r.name) + '\')">🖨️ הדפסה</button></div>' +
    '<div class="toolbar noprint"><span class="lbl" style="margin:0">מתאריך</span>' +
      '<input class="inp" style="width:auto" type="date" value="' + esc(S.ui.ledgerFrom) + '" onchange="S.ui.ledgerFrom=this.value;renderPage()">' +
      '<span class="lbl" style="margin:0">עד</span>' +
      '<input class="inp" style="width:auto" type="date" value="' + esc(S.ui.ledgerTo) + '" onchange="S.ui.ledgerTo=this.value;renderPage()">' +
      ((S.ui.ledgerFrom || S.ui.ledgerTo) ? '<button class="btn sm gh" onclick="S.ui.ledgerFrom=S.ui.ledgerTo=\'\';renderPage()">✕ כל התקופה</button>' : '') +
      '<div class="sp"></div>' + (ed ? '<button class="btn sm" onclick="entryModal(\'in\',null,{registerId:\'' + id + '\'})">⬇️ כסף נכנס</button>' +
        '<button class="btn sm" onclick="entryModal(\'out\',null,{registerId:\'' + id + '\'})">⬆️ כסף יצא</button>' : '') + '</div>' +
    '<div class="kpis">' + kpi('יתרת פתיחה', L.open, S.ui.ledgerFrom ? 'לפני ' + fmtDate(S.ui.ledgerFrom) : (r.openingDate ? 'נכון ל-' + fmtDate(r.openingDate) : ''), 'navy') +
      kpi('נכנס', tin, '', 'green') + kpi('יצא', tout, '', 'red') + kpi('יתרת סגירה', L.close, 'כולל תנועות עתידיות אם יש', 'blue') + '</div>' +
    '<div class="card"><div class="tbl-scroll"><table class="tbl"><thead><tr><th class="nosort">תאריך</th><th class="nosort">סוג</th><th class="nosort">פירוט</th>' +
      '<th class="nosort num">נכנס</th><th class="nosort num">יצא</th><th class="nosort num">יתרה</th></tr></thead><tbody>' +
      '<tr class="grp-row"><td colspan="5">יתרת פתיחה</td><td class="num">' + money(L.open) + '</td></tr>' +
      L.list.map(function (m) {
        return '<tr><td class="num">' + fmtDate(m.date) + '</td><td><span class="mv-type">' + MV[m.k].i + ' ' + MV[m.k].t + '</span></td>' +
          '<td>' + esc(m.desc) + '</td><td class="num in">' + (m.dir > 0 ? money(m.amount) : '') + '</td>' +
          '<td class="num out">' + (m.dir < 0 ? money(m.amount) : '') + '</td><td class="num m' + moneyCls(m.run) + '">' + money(m.run) + '</td></tr>';
      }).join('') +
      (L.list.length ? '' : '<tr><td colspan="6"><div class="empty">אין תנועות בתקופה הזו</div></td></tr>') +
    '</tbody><tfoot><tr><td colspan="3">סה״כ ' + L.list.length + ' תנועות</td><td class="num">' + money(tin) + '</td><td class="num">' + money(tout) + '</td>' +
      '<td class="num">' + money(L.close) + '</td></tr></tfoot></table></div></div>';
}

function exportLedger(id) {
  var r = findRow('registers', id), L = ledgerRows(r, S.ui.ledgerFrom, S.ui.ledgerTo), M = function (v) { return { v: v, t: 'money' }; };
  saveXlsx([{ name: 'כרטסת', rows: [['תאריך', 'סוג', 'פירוט', 'נכנס', 'יצא', 'יתרה'], ['', 'יתרת פתיחה', '', '', '', M(L.open)]].concat(
    L.list.map(function (m) {
      return [{ v: m.date, t: 'd' }, MV[m.k].t, m.desc, m.dir > 0 ? M(m.amount) : '', m.dir < 0 ? M(m.amount) : '', M(m.run)];
    })) }], 'כרטסת ' + r.name);
}
