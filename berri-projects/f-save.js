/* BERRI — שמירה ומחיקה. המסך מתעדכן מיד והשרת ברקע (sync.js) */
'use strict';

function nowStamp() {
  var d = new Date(), p = function (x) { return ('0' + x).slice(-2); };
  return iso(d) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
/* השדות שהשרת משלים (שמות, מי רשם, מתי) — כדי שהשורה תיראה שלמה מיד */
function localRow(table, row, prev) {
  var o = Object.assign({}, prev || {}, row);
  if ('registerId' in o) o.registerName = regName(o.registerId);
  if ('toRegisterId' in o) o.toRegisterName = o.toRegisterId ? regName(o.toRegisterId) : '';
  if ('projectId' in o) o.projectName = projName(o.projectId);
  var p = o.projectId ? findRow('projects', o.projectId) : null;
  if (table === 'subPayments') o.subName = p ? p.subName : '';
  if (table === 'projectExpenses') o.subName = o.deductSub && p ? p.subName : '';
  if (table === 'cashMoves') o.typeHe = { 'in': 'כסף נכנס לקופה', out: 'כסף יצא מקופה', transfer: 'העברה בין קופות' }[o.type] || '';
  if (table === 'categories') o.groupHe = GROUP_HE[o.group] || '';
  if (table === 'registers' && !prev && !('sort' in row)) {     // כמו בשרת: קופה חדשה נכנסת בסוף
    o.sort = S.d.registers.reduce(function (m, r) { return Math.max(m, Number(r.sort) || 0); }, 0) + 1;
  }
  if (!prev) {
    o.createdAt = nowStamp();
    if (table !== 'categories') { o.userName = S.user.fullName; o.userId = S.user.id; }
  }
  return o;
}
var CAT_GROUP = { projectExpenses: 'project', businessExpenses: 'business', homeExpenses: 'home' };
function catKnown(table, row) {
  var g = CAT_GROUP[table] || (table === 'cashMoves' && row.type !== 'transfer' ? row.type : '');
  if (!g || !row.category) return true;
  return S.d.categories.some(function (c) { return c.group === g && c.name === row.category; });
}

/* נקודת השמירה היחידה: מעדכנת מקומית, סוגרת, ושולחת לתור */
function commit(table, row, redo) {
  var prev = qCopy(findRow(table, row.id));
  var local = localRow(table, row, prev);
  upsertLocal(table, local);
  enqueue({ kind: 'save', table: table, row: row, local: local, prev: prev, fresh: !prev,
            catKnown: catKnown(table, row), redo: redo });
  return local;
}

function saveEntry(btn, kind, id) {
  var K = KIND[kind];
  var amount = parseAmount(val('f-amount'));
  if (!val('f-date')) return setMsg('m', 'יש לבחור תאריך');
  if (!isFinite(amount) || amount <= 0) return setMsg('m', 'יש להזין סכום גדול מאפס');
  if (K.proj && !val('f-project')) return setMsg('m', 'יש לבחור פרוייקט');
  if (!val('f-reg')) return setMsg('m', 'יש לבחור קופה');
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
  commit(K.table, row, { fn: 'entryModal', args: [kind, id || null, row] });
  closeModal(); rerender();
  toast(K.i + ' ' + (id ? 'התנועה עודכנה' : K.t + ' נרשם — ' + money(amount)), 'ok');
}

/* עריכה משורה בטבלה */
var TABLE_KIND = { clientPayments: 'cp', subPayments: 'sp', projectExpenses: 'pe',
                   businessExpenses: 'be', homeExpenses: 'he' };
function editRow(tk, id) {
  if (tk === 'additions') return additionModal(id);
  if (tk === 'cashMoves') {
    var m = findRow('cashMoves', id);
    return entryModal(m.type === 'transfer' ? 'tr' : m.type, id);
  }
  entryModal(TABLE_KIND[tk], id);
}

var DEL_LABEL = { projects: 'הפרוייקט', registers: 'הקופה', categories: 'הקטגוריה', additions: 'התוספת' };
function askDelete(table, id) {
  var row = findRow(table, id), what = DEL_LABEL[table] || 'השורה';
  if (!row) return;
  var okDel = table === 'categories' ? canCat(row.group, 'delete') : canT(table, 'delete');
  if (!okDel) return toast('אין לך הרשאה למחוק', 'err');
  var block = deleteBlocker(table, id);
  if (block) return toast(block, 'err');
  var desc = table === 'projects' || table === 'registers' || table === 'categories'
    ? '<b>' + esc(row.name) + '</b>'
    : table === 'additions'
      ? fmtDate(row.date) + ' · ' + esc(row.description) + ' · <b>' + money(row.clientAmount) + '</b>'
      : fmtDate(row.date) + ' · <b>' + money(row.amount) + '</b>';
  confirmModal('מחיקה', 'למחוק את ' + what + '?<div style="margin-top:8px">' + desc + '</div>' +
    '<div class="hint" style="margin-top:10px">השורה נשארת בגיליון מסומנת כ"נמחק", ואפשר לבטל מיד אחרי המחיקה.</div>',
    '🗑️ מחיקה', function () { doDelete(table, id); });
}
/* אותן בדיקות שהשרת עושה — כדי לא למחוק במסך משהו שהשרת יסרב למחוק */
function deleteBlocker(table, id) {
  var n = 0;
  if (table === 'projects') {
    ['additions', 'clientPayments', 'subPayments', 'projectExpenses'].forEach(function (t) {
      n += S.d[t].filter(function (x) { return x.projectId === id; }).length;
    });
    if (n) return 'בפרוייקט יש ' + n + ' תנועות. אפשר לסמן אותו כלא פעיל, או למחוק קודם את התנועות.';
  }
  if (table === 'registers') {
    ['clientPayments', 'subPayments', 'projectExpenses', 'businessExpenses', 'homeExpenses', 'cashMoves'].forEach(function (t) {
      n += S.d[t].filter(function (x) { return x.registerId === id || x.toRegisterId === id; }).length;
    });
    if (n) return 'בקופה יש ' + n + ' תנועות. אפשר להעביר אותה ללא פעילה במקום למחוק.';
  }
  return '';
}
function doDelete(table, id) {
  var prev = qCopy(findRow(table, id));
  removeLocal(table, id);
  enqueue({ kind: 'remove', table: table, id: id, prev: prev });
  closeModal();
  if (table === 'projects' && S.route.page === 'project') go('projects'); else rerender();
  toast('נמחק', 'ok', { label: 'ביטול', fn: function () { undoDelete(table, prev); } });
}
function undoDelete(table, prev) {
  if (!prev) return;
  upsertLocal(table, prev);
  enqueue({ kind: 'restore', table: table, id: prev.id, prev: prev });
  rerender();
  toast('המחיקה בוטלה', 'ok');
}

/* שמירה כללית לטפסים (פרוייקט, קופה, קטגוריה, תוספת) */
function saveRow(btn, table, row, okMsg, after) {
  var clash = uniqueClash(table, row);
  if (clash) return setMsg('m', clash);
  var local = commit(table, row, null);
  closeModal(); rerender();
  toast(okMsg, 'ok');
  if (after) after(local);
}
/* שמות שהשרת דורש שיהיו ייחודיים — נבדק כאן, כדי לא לגלות רק אחרי שהחלון נסגר */
function uniqueClash(table, row) {
  if (table === 'registers' && S.d.registers.some(function (r) { return r.name === row.name && r.id !== row.id; })) {
    return 'כבר קיימת קופה בשם הזה';
  }
  if (table === 'categories') {
    var cur = findRow('categories', row.id), g = cur ? cur.group : row.group;
    if (S.d.categories.some(function (c) { return c.group === g && c.name === row.name && c.id !== row.id; })) {
      return 'הקטגוריה כבר קיימת';
    }
  }
  return '';
}
