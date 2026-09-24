/* BERRI — עדכון ומחיקה מרוכזים לשורות מסומנות.
   השדות כאן חייבים להתאים ל-BULK_FIELDS בשרת (סכומים לא משנים במרוכז). */
'use strict';

var BF = {
  date:        { t: 'תאריך',            type: 'date' },
  projectId:   { t: 'פרוייקט',          type: 'project' },
  registerId:  { t: 'קופה',             type: 'register' },
  category:    { t: 'קטגוריה',          type: 'cat' },
  supplier:    { t: 'ספק / פירוט',      type: 'text' },
  method:      { t: 'אמצעי תשלום',      type: 'method' },
  reference:   { t: 'אסמכתא',           type: 'text' },
  deductSub:   { t: 'קיזוז מהקבלן',     type: 'yesno' },
  note:        { t: 'הערה',             type: 'text' },
  active:      { t: 'פעיל',             type: 'active' },
  client:      { t: 'לקוח',             type: 'text' },
  subName:     { t: 'קבלן משנה',        type: 'text' },
  subPhone:    { t: 'טלפון הקבלן',      type: 'text' },
  startDate:   { t: 'תאריך התחלה',      type: 'date' },
  endDate:     { t: 'תאריך סיום',       type: 'date' }
};
var BULK_FIELDS = {
  projects:         ['active', 'client', 'subName', 'subPhone', 'startDate', 'endDate', 'note'],
  additions:        ['date', 'projectId', 'note'],
  clientPayments:   ['date', 'projectId', 'registerId', 'method', 'reference', 'note'],
  subPayments:      ['date', 'projectId', 'registerId', 'method', 'reference', 'note'],
  projectExpenses:  ['date', 'projectId', 'registerId', 'category', 'supplier', 'deductSub', 'note'],
  businessExpenses: ['date', 'registerId', 'category', 'supplier', 'note'],
  homeExpenses:     ['date', 'registerId', 'category', 'supplier', 'note'],
  cashMoves:        ['date', 'registerId', 'category', 'note']
};
var BULK_CHUNK = 150;

function bulkPicked(tk, ctx) {
  var s = selOf(tk, ctx);
  return (tk === 'projects' ? S.d.projects : TBL[tk].rows(ctx)).filter(function (r) { return s[r.id]; });
}
function bfInput(k, tk) {
  var f = BF[k], on = 'onchange="byId(\'bc-' + k + '\').checked=true" oninput="byId(\'bc-' + k + '\').checked=true"';
  if (f.type === 'date') return '<input id="bv-' + k + '" class="inp" type="date" ' + on + '>';
  if (f.type === 'project') return '<select id="bv-' + k + '" class="inp" ' + on + '>' + selOpts(sortedProjects(), '', 'id', 'name') + '</select>';
  if (f.type === 'register') return '<select id="bv-' + k + '" class="inp" ' + on + '>' + selOpts(sortedRegisters(), '', 'id', 'name') + '</select>';
  if (f.type === 'method') return '<select id="bv-' + k + '" class="inp" ' + on + '><option value="">—</option>' + selOpts(METHODS, '') + '</select>';
  if (f.type === 'yesno') return '<select id="bv-' + k + '" class="inp" ' + on + '><option value="1">כן — לקזז מהקבלן</option><option value="0">לא</option></select>';
  if (f.type === 'active') return '<select id="bv-' + k + '" class="inp" ' + on + '><option value="1">פעיל</option><option value="0">לא פעיל</option></select>';
  if (f.type === 'cat') {
    var g = CAT_GROUP[tk] || '';
    return '<input id="bv-' + k + '" class="inp" list="dl-bcat" ' + on + '>' +
      '<datalist id="dl-bcat">' + (g ? catsOf(g) : S.d.categories.filter(function (c) { return c.group === 'in' || c.group === 'out'; }))
        .map(function (c) { return '<option value="' + esc(c.name) + '">'; }).join('') + '</datalist>';
  }
  return '<input id="bv-' + k + '" class="inp" ' + on + '>';
}

function bulkEditOpen(tk, ctx) {
  var rows = bulkPicked(tk, ctx);
  if (!rows.length) return;
  var fields = BULK_FIELDS[tk].filter(function (k) { return !(ctx && k === 'projectId' && tk !== 'projects'); });
  openModal(modalHtml('✏️ עדכון מרוכז — ' + rows.length + ' שורות',
    '<div id="m" class="msg"></div>' +
    '<p class="hint" style="margin:0 0 12px">מסמנים רק את השדות שרוצים לשנות. כל שאר הפרטים בשורות נשארים כמו שהם.</p>' +
    fields.map(function (k) {
      return '<div class="bulk-f"><label class="bulk-c"><input type="checkbox" id="bc-' + k + '"> ' + BF[k].t + '</label>' +
        '<div class="bulk-v">' + bfInput(k, tk) + '</div></div>';
    }).join(''),
    '<button class="btn o" onclick="bulkEditRun(\'' + tk + '\',\'' + (ctx || '') + '\')">עדכון ' + rows.length + ' שורות</button>' +
    '<button class="btn gh" onclick="closeModal()">ביטול</button>'));
}

function bulkEditRun(tk, ctx) {
  var patch = {};
  BULK_FIELDS[tk].forEach(function (k) {
    var c = byId('bc-' + k), v = byId('bv-' + k);
    if (!c || !c.checked || !v) return;
    var x = String(v.value).trim();
    if (BF[k].type === 'yesno' || BF[k].type === 'active') x = x === '1';
    patch[k] = x;
  });
  if (!Object.keys(patch).length) return setMsg('m', 'לא סומן אף שדה לעדכון');
  if ('date' in patch && !patch.date) return setMsg('m', 'יש לבחור תאריך');
  var table = tk, rows = bulkPicked(tk, ctx);
  if (table === 'cashMoves' && 'registerId' in patch &&
      rows.some(function (r) { return r.type === 'transfer' && r.toRegisterId === patch.registerId; })) {
    return setMsg('m', 'בחלק מהשורות זו העברה לאותה קופה — בחר קופה אחרת, או הסר את ההעברות מהסימון');
  }
  bulkSend(table, 'update', rows, patch);
  selAll(tk, ctx, false);
  closeModal(); rerender();
  toast('✏️ ' + rows.length + ' שורות עודכנו', 'ok');
}

function bulkDeleteAsk(tk, ctx) {
  var rows = bulkPicked(tk, ctx);
  if (!rows.length) return;
  if (tk === 'projects') {
    var busyP = rows.filter(function (r) { return deleteBlocker('projects', r.id); });
    if (busyP.length) return toast('ב-' + busyP.length + ' מהפרוייקטים יש תנועות — אפשר לסמן אותם כלא פעילים במקום', 'err');
  }
  var mc = tk === 'projects' ? null : colsOf(tk, ctx).filter(function (c) { return c.sum && c.type === 'money'; })[0];
  confirmModal('מחיקה מרוכזת', 'למחוק <b>' + rows.length + '</b> שורות' +
    (mc ? ' בסך <b>' + money(sumOf(rows, function (r) { return cellVal(mc, r); })) + '</b>' : '') + '?' +
    '<div class="hint" style="margin-top:10px">השורות נשארות בגיליון מסומנות כ"נמחק", ואפשר לבטל מיד אחרי המחיקה.</div>',
    '🗑️ מחיקת ' + rows.length + ' שורות', function () {
      bulkSend(tk, 'delete', rows);
      selAll(tk, ctx, false);
      closeModal(); rerender();
      toast('נמחקו ' + rows.length + ' שורות', 'ok', { label: 'ביטול', fn: function () {
        bulkSend(tk, 'restore', rows); rerender(); toast('המחיקה בוטלה', 'ok');
      } });
    });
}

/* מעדכן מקומית ושולח לתור, במנות */
function bulkSend(table, op, rows, patch) {
  for (var i = 0; i < rows.length; i += BULK_CHUNK) {
    var part = rows.slice(i, i + BULK_CHUNK), prevs = {}, locals = [];
    part.forEach(function (r) {
      var prev = qCopy(findRow(table, r.id) || r);
      prevs[r.id] = prev;
      if (op === 'delete') { removeLocal(table, r.id); locals.push(prev); }
      else if (op === 'restore') { upsertLocal(table, prev); locals.push(prev); }
      else { var l = localRow(table, Object.assign({}, prev, patch), prev); upsertLocal(table, l); locals.push(l); }
    });
    enqueue({ kind: 'bulk', table: table, op: op, ids: part.map(function (r) { return r.id; }),
              patch: patch || null, prevs: prevs, locals: locals });
  }
}
