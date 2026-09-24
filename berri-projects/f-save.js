/* BERRI — שמירה ומחיקה מול השרת */
'use strict';

function saveEntry(btn, kind, id) {
  var K = KIND[kind];
  var amount = parseAmount(val('f-amount'));
  if (!val('f-date')) return setMsg('m', 'יש לבחור תאריך');
  if (!isFinite(amount) || amount <= 0) return setMsg('m', 'יש להזין סכום גדול מאפס');
  if (K.proj && !val('f-project')) return setMsg('m', 'יש לבחור פרוייקט');
  var row = { id: id || newId(kind === 'tr' || kind === 'in' || kind === 'out' ? 'cm' : kind),
              date: val('f-date'), amount: amount, registerId: val('f-reg'), note: val('f-note') };
  if (K.type) row.type = K.type;
  if (K.proj) row.projectId = val('f-project');
  if (K.reg2) {
    row.toRegisterId = val('f-reg2');
    if (row.toRegisterId === row.registerId) return setMsg('m', 'בהעברה יש לבחור שתי קופות שונות');
  }
  if (K.cat) row.category = val('f-cat');
  if (K.sup) row.supplier = val('f-sup');
  if (K.method) { row.method = val('f-method'); row.reference = val('f-ref'); }
  if (K.deduct) row.deductSub = checked('f-ded');
  setMsg('m', ''); busy(btn, true);
  api('save', { table: K.table, row: row }).then(function (r) {
    busy(btn, false);
    if (!r.ok) { if (!handleExpired(r)) setMsg('m', r.error); return; }
    upsertLocal(K.table, r.row);
    if (r.category) { S.d.categories.push(r.category); S.ver++; cacheState(); }
    closeModal(); rerender();
    toast(K.i + ' ' + (id ? 'התנועה עודכנה' : K.t + ' נרשם — ' + money(amount)), 'ok');
  });
}

/* עריכה משורה בטבלה */
var TABLE_KIND = { clientPayments: 'cp', subPayments: 'sp', projectExpenses: 'pe',
                   businessExpenses: 'be', homeExpenses: 'he' };
function editRow(tk, id) {
  if (tk === 'cashMoves') {
    var m = findRow('cashMoves', id);
    return entryModal(m.type === 'transfer' ? 'tr' : m.type, id);
  }
  entryModal(TABLE_KIND[tk], id);
}

var DEL_LABEL = { projects: 'הפרוייקט', registers: 'הקופה', categories: 'הקטגוריה' };
function askDelete(table, id) {
  var row = findRow(table, id), what = DEL_LABEL[table] || 'השורה';
  var desc = table === 'projects' || table === 'registers' || table === 'categories'
    ? '<b>' + esc(row.name) + '</b>'
    : fmtDate(row.date) + ' · <b>' + money(row.amount) + '</b>';
  confirmModal('מחיקה', 'למחוק את ' + what + '?<div style="margin-top:8px">' + desc + '</div>' +
    '<div class="hint" style="margin-top:10px">השורה נשארת בגיליון מסומנת כ"נמחק", ואפשר לבטל מיד אחרי המחיקה.</div>',
    '🗑️ מחיקה', function (btn) { doDelete(btn, table, id); });
}
function doDelete(btn, table, id) {
  busy(btn, true, 'מוחק…');
  api('remove', { table: table, id: id }).then(function (r) {
    busy(btn, false);
    if (!r.ok) { if (!handleExpired(r)) toast(r.error, 'err'); closeModal(); return; }
    removeLocal(table, id);
    closeModal();
    if (table === 'projects' && S.route.page === 'project') go('projects'); else rerender();
    toast('נמחק', 'ok', { label: 'ביטול', fn: function () { undoDelete(table, id); } });
  });
}
function undoDelete(table, id) {
  api('restore', { table: table, id: id }).then(function (r) {
    if (!r.ok) { if (!handleExpired(r)) toast(r.error, 'err'); return; }
    upsertLocal(table, r.row); rerender();
    toast('המחיקה בוטלה', 'ok');
  });
}

/* שמירה כללית לטפסים (פרוייקט, קופה, קטגוריה) */
function saveRow(btn, table, row, okMsg, after) {
  setMsg('m', ''); busy(btn, true);
  api('save', { table: table, row: row }).then(function (r) {
    busy(btn, false);
    if (!r.ok) { if (!handleExpired(r)) setMsg('m', r.error); return; }
    upsertLocal(table, r.row);
    closeModal(); rerender();
    toast(okMsg, 'ok');
    if (after) after(r.row);
  });
}
