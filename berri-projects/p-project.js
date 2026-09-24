/* BERRI — תמונת מצב של פרוייקט אחד + הטבלאות שלו */
'use strict';

function ln(label, value, cls) {
  return '<div class="ln"><span>' + label + '</span><b class="' + (cls || '') + moneyCls(value) + '">' + money(value) + '</b></div>';
}

function pageProject(w, id) {
  var p = findRow('projects', id);
  if (!p) {
    w.innerHTML = '<div class="empty"><span class="ico">🔍</span><b>הפרוייקט לא נמצא</b>' +
      '<button class="btn" style="margin-top:10px" onclick="go(\'projects\')">חזרה לפרוייקטים</button></div>';
    return;
  }
  var s = calc().proj[id], ed = can('projects', 'edit');
  var ex = s.expected || s.ownExp;
  w.innerHTML =
    '<div class="crumb noprint"><a onclick="go(\'projects\')">🏗️ פרוייקטים</a> ‹ ' + esc(p.name) + '</div>' +
    '<div class="p-head"><h2>' + esc(p.name) + ' ' + activeToggle(p) + '<span class="sp" style="flex:1"></span>' +
      '<span class="noprint" style="display:flex;gap:6px">' +
      (ed ? '<button class="btn sm" onclick="projectModal(\'' + id + '\')">✏️ עריכה</button>' : '') +
      '<button class="btn sm gh" onclick="exportProject(\'' + id + '\')">📤 אקסל</button>' +
      '<button class="btn sm gh" onclick="printPage(\'תמונת מצב — ' + jsq(p.name) + '\')">🖨️ הדפסה</button>' +
      (can('projects', 'delete') ? '<button class="btn sm gh" onclick="askDelete(\'projects\',\'' + id + '\')">🗑️</button>' : '') + '</span></h2>' +
      '<div class="p-meta">' +
        (p.client ? '<span>לקוח: <b>' + esc(p.client) + '</b>' + (p.clientPhone ? ' · <a href="tel:' + esc(p.clientPhone) + '">' + esc(p.clientPhone) + '</a>' : '') + '</span>' : '') +
        (p.subName ? '<span>קבלן משנה: <b>' + esc(p.subName) + '</b>' + (p.subPhone ? ' · <a href="tel:' + esc(p.subPhone) + '">' + esc(p.subPhone) + '</a>' : '') + '</span>' : '') +
        (p.address ? '<span>📍 ' + esc(p.address) + '</span>' : '') +
        '<span>📅 ' + (p.startDate ? fmtDate(p.startDate) : 'אין תאריך התחלה') + ' – ' + (p.endDate ? fmtDate(p.endDate) : 'ללא תאריך סיום') +
          (s.months ? ' · <b>' + fmtMonths(s.months) + ' חודשים</b>' + (s.endEst ? ' (עד היום)' : '') : '') + '</span>' +
      '</div>' + (p.note ? '<div class="hint" style="margin-top:8px">📝 ' + esc(p.note) + '</div>' : '') +
    '</div>' +

    '<div class="p-grid">' +
      '<div class="pbox"><h4>📥 הלקוח</h4>' +
        (s.addClient ? ln('מחיר בסיס', s.basePrice) + ln('תוספות (' + s.ads.length + ')', s.addClient, 'in') +
          ln('סה״כ ללקוח', s.clientPrice) : ln('מחיר ללקוח', s.clientPrice)) +
        ln('נגבה עד היום', s.clientPaid, 'in') +
        bar(pct(s.clientPaid, s.clientPrice), 'g') +
        '<div class="ln tot"><span>יתרה לגבייה</span><b class="' + moneyCls(s.clientDue) + '">' + money(s.clientDue) + '</b></div></div>' +
      '<div class="pbox"><h4>👷 קבלן המשנה' + (p.subName ? ' — ' + esc(p.subName) : '') + '</h4>' +
        (s.addSub ? ln('מחיר בסיס', s.baseSubPrice) + ln('תוספות', s.addSub, 'out') + ln('סה״כ לקבלן', s.subPrice)
                  : ln('מחיר לקבלן', s.subPrice)) +
        ln('שולם לו', s.subPaid, 'out') + ln('קוזז מהוצאות', s.dedExp, 'out') + bar(pct(s.subCovered, s.subPrice), 'n') +
        '<div class="ln tot"><span>יתרה לתשלום</span><b class="' + moneyCls(s.subDue) + '">' + money(s.subDue) + '</b></div></div>' +
      '<div class="pbox"><h4>🧱 הוצאות</h4>' + ln('צפי הוצאות', s.expected) + ln('הוצאות בפועל', s.ownExp, 'out') +
        bar(pct(s.ownExp, ex), s.ownExp > s.expected ? 'r' : '') +
        '<div class="ln tot"><span>' + (s.expLeft < 0 ? 'חריגה מהצפי' : 'נותר מהצפי') + '</span><b class="' + (s.expLeft < 0 ? 'neg' : '') + '">' +
          money(Math.abs(s.expLeft)) + '</b></div></div>' +
      '<div class="pbox profit"><h4>📈 רווח</h4><div class="big' + moneyCls(s.profit) + '">' + money(s.profit) + '</div>' +
        '<div class="muted" style="font-size:12px;margin-bottom:6px">רווח צפוי' + (s.clientPrice ? ' · ' + Math.round(s.margin) + '% מהמחיר' : '') + '</div>' +
        ln('רווח מתוכנן', s.planned) +
        '<div class="ln"><span>רווח ממוצע לחודש</span><b>' + (s.monthly === null ? '—' : money(s.monthly)) + '</b></div>' +
        ln('מזומן נטו מהפרוייקט', s.cashNet) + '</div>' +
    '</div>' +
    s.warns.map(function (x) { return '<div class="warn-line" style="margin-bottom:8px">⚠️ ' + esc(x) + '</div>'; }).join('') +

    tableOrAdd('additions', id, { title: 'תוספות למחיר', add: 'additionModal(null,{projectId:\'' + id + '\'})', addLabel: 'תוספת' }) +
    tableOrAdd('clientPayments', id, { title: 'תשלומי הלקוח', add: 'entryModal(\'cp\',null,{projectId:\'' + id + '\'})', addLabel: 'תשלום מלקוח' }) +
    tableOrAdd('subPayments', id, { title: 'תשלומים לקבלן המשנה', add: 'entryModal(\'sp\',null,{projectId:\'' + id + '\'})', addLabel: 'תשלום לקבלן' }) +
    tableOrAdd('projectExpenses', id, { title: 'הוצאות הפרוייקט', add: 'entryModal(\'pe\',null,{projectId:\'' + id + '\'})', addLabel: 'הוצאה' });
  mountTables([['additions', id], ['clientPayments', id], ['subPayments', id], ['projectExpenses', id]]);
}

function exportProject(id) {
  var s = calc().proj[id], p = s.p;
  var M = function (v) { return { v: v, t: 'money' }; };
  var list = function (rows, cols) {
    return [cols.map(function (c) { return c[0]; })].concat(rows.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(function (r) {
      return cols.map(function (c) { var x = c[1](r); return c[2] === 'm' ? M(x) : c[2] === 'd' ? { v: x, t: 'd' } : (x || ''); });
    }));
  };
  saveXlsx([
    { name: 'תמונת מצב', rows: [['פרוייקט', p.name], ['לקוח', p.client], ['קבלן משנה', p.subName],
      ['התחלה', { v: p.startDate, t: 'd' }], ['סיום', { v: p.endDate, t: 'd' }], ['משך בחודשים', s.months ? { v: Math.round(s.months * 10) / 10, t: 'n' } : ''], [],
      ['מחיר בסיס ללקוח', M(s.basePrice)], ['תוספות ללקוח', M(s.addClient)], ['סה״כ ללקוח', M(s.clientPrice)],
      ['נגבה', M(s.clientPaid)], ['יתרה לגבייה', M(s.clientDue)], [],
      ['מחיר בסיס לקבלן', M(s.baseSubPrice)], ['תוספות לקבלן', M(s.addSub)], ['סה״כ לקבלן', M(s.subPrice)],
      ['שולם לקבלן', M(s.subPaid)], ['קוזז מהקבלן', M(s.dedExp)], ['יתרה לקבלן', M(s.subDue)], [],
      ['צפי הוצאות', M(s.expected)], ['הוצאות בפועל', M(s.ownExp)], [],
      ['רווח מתוכנן', M(s.planned)], ['רווח צפוי', M(s.profit)], ['רווח לחודש', s.monthly === null ? '' : M(s.monthly)], ['מזומן נטו', M(s.cashNet)]] },
    { name: 'תוספות', rows: list(s.ads, [['תאריך', function (r) { return r.date; }, 'd'], ['תיאור התוספת', function (r) { return r.description; }],
      ['תוספת ללקוח', function (r) { return r.clientAmount; }, 'm'], ['תוספת לקבלן', function (r) { return r.subAmount; }, 'm'],
      ['הערה', function (r) { return r.note; }]]) },
    { name: 'תשלומי לקוח', rows: list(s.cps, [['תאריך', function (r) { return r.date; }, 'd'], ['סכום', function (r) { return r.amount; }, 'm'],
      ['קופה', function (r) { return regName(r.registerId); }], ['אמצעי', function (r) { return r.method; }], ['אסמכתא', function (r) { return r.reference; }], ['הערה', function (r) { return r.note; }]]) },
    { name: 'תשלומים לקבלן', rows: list(s.sps, [['תאריך', function (r) { return r.date; }, 'd'], ['סכום', function (r) { return r.amount; }, 'm'],
      ['קופה', function (r) { return regName(r.registerId); }], ['אמצעי', function (r) { return r.method; }], ['אסמכתא', function (r) { return r.reference; }], ['הערה', function (r) { return r.note; }]]) },
    { name: 'הוצאות', rows: list(s.pes, [['תאריך', function (r) { return r.date; }, 'd'], ['סכום', function (r) { return r.amount; }, 'm'],
      ['קופה', function (r) { return regName(r.registerId); }], ['קטגוריה', function (r) { return r.category; }], ['ספק / פירוט', function (r) { return r.supplier; }],
      ['קיזוז מהקבלן', function (r) { return r.deductSub ? 'כן' : ''; }], ['הערה', function (r) { return r.note; }]]) }
  ], 'פרוייקט ' + p.name);
}
