/* BERRI — טופס תנועת כסף: תשלום לקוח / לקבלן / הוצאה / קופה */
'use strict';

/* לכל סוג תנועה: הטבלה בשרת, השדות, וקבוצת הקטגוריות */
var KIND = {
  cp: { t: 'תשלום מלקוח', i: '📥', table: 'clientPayments', proj: 1, reg: 'לאיזו קופה נכנס', method: 1 },
  sp: { t: 'תשלום לקבלן משנה', i: '👷', table: 'subPayments', proj: 1, reg: 'מאיזו קופה יצא', method: 1 },
  pe: { t: 'הוצאה לפרוייקט', i: '🧱', table: 'projectExpenses', proj: 1, reg: 'מאיזו קופה יצא', cat: 'project', sup: 'ספק / פירוט', deduct: 1 },
  be: { t: 'הוצאת עסק', i: '🧾', table: 'businessExpenses', reg: 'מאיזו קופה יצא', cat: 'business', sup: 'ספק / פירוט' },
  he: { t: 'הוצאת בית', i: '🏠', table: 'homeExpenses', reg: 'מאיזו קופה יצא', cat: 'home', sup: 'פירוט', admin: 1 },
  in: { t: 'כסף נכנס לקופה', i: '⬇️', table: 'cashMoves', type: 'in', reg: 'לאיזו קופה', cat: 'in' },
  out: { t: 'כסף יצא מקופה', i: '⬆️', table: 'cashMoves', type: 'out', reg: 'מאיזו קופה', cat: 'out' },
  tr: { t: 'העברה בין קופות', i: '⇄', table: 'cashMoves', type: 'transfer', reg: 'מאיזו קופה', reg2: 'לאיזו קופה' }
};
var METHODS = ['העברה בנקאית', 'צ׳ק', 'מזומן', 'אשראי', 'אחר'];

function selOpts(list, cur, valKey, txtKey) {
  return list.map(function (x) {
    var v = valKey ? x[valKey] : x, t = txtKey ? x[txtKey] : x;
    return '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(t) + '</option>';
  }).join('');
}
function fld(label, inner, req) {
  return '<div class="field"><label>' + label + (req ? ' <span class="req">*</span>' : '') + '</label>' + inner + '</div>';
}
function catList(group) {
  return '<datalist id="dl-cat">' + catsOf(group).map(function (c) { return '<option value="' + esc(c.name) + '">'; }).join('') + '</datalist>';
}

/* kind — סוג התנועה; id — עריכה של שורה קיימת; pre — ערכים מוכנים מראש */
function entryModal(kind, id, pre) {
  var K = KIND[kind];
  if (!canT(K.table, id ? 'edit' : 'add')) return toast(id ? 'אין לך הרשאה לערוך' : 'אין לך הרשאה להזין', 'err');
  var regs = sortedRegisters();
  if (!regs.length) return toast('צריך להגדיר קופה אחת לפחות — הגדרות ‹ קופות', 'err');
  var projs = sortedProjects().filter(function (p) { return p.active; });
  var r = id ? findRow(K.table, id) : null;
  var d = Object.assign({ date: calc().today, registerId: regs[0].id }, r || {}, pre || {});
  /* עריכת תנועה בקופה שהועברה ללא פעילה: הקופה שלה חייבת להופיע ברשימה,
     אחרת הרשימה מציגה קופה אחרת והשמירה מעבירה אליה את הכסף בשקט */
  [d.registerId, d.toRegisterId].forEach(function (rid) {
    var reg = rid && findRow('registers', rid);
    if (reg && !regs.some(function (x) { return x.id === rid; })) {
      regs = regs.concat([Object.assign({}, reg, { name: reg.name + ' (לא פעילה)' })]);
    }
  });
  if (K.proj && !d.projectId && projs.length === 1) d.projectId = projs[0].id;

  openModal(modalHtml(K.i + ' ' + (id ? 'עריכת ' : '') + K.t,
    '<div id="m" class="msg"></div>' +
    '<div class="grid2">' +
      fld('תאריך', '<input id="f-date" class="inp" type="date" value="' + esc(d.date) + '">', 1) +
      fld('סכום', '<input id="f-amount" class="inp num" inputmode="decimal" autofocus value="' + (d.amount || '') + '" placeholder="0">', 1) +
    '</div>' +
    (K.proj ? fld('פרוייקט', '<select id="f-project" class="inp" onchange="entryProjInfo(\'' + kind + '\')">' +
      '<option value="">— בחר פרוייקט —</option>' + selOpts(sortedProjects(), d.projectId, 'id', 'name') + '</select>', 1) +
      '<div id="pinfo"></div>' : '') +
    fld(K.reg, '<select id="f-reg" class="inp">' + selOpts(regs, d.registerId, 'id', 'name') + '</select>', 1) +
    (K.reg2 ? fld(K.reg2, '<select id="f-reg2" class="inp">' + selOpts(regs, d.toRegisterId, 'id', 'name') + '</select>', 1) : '') +
    (K.cat ? fld('קטגוריה', '<input id="f-cat" class="inp" list="dl-cat" value="' + esc(d.category || '') + '" placeholder="בחר או הקלד חדשה">') + catList(K.cat) : '') +
    (K.sup ? fld(K.sup, '<input id="f-sup" class="inp" value="' + esc(d.supplier || '') + '">') : '') +
    (K.method ? '<div class="grid2">' + fld('אמצעי תשלום', '<select id="f-method" class="inp"><option value="">—</option>' + selOpts(METHODS, d.method) + '</select>') +
      fld('אסמכתא', '<input id="f-ref" class="inp" value="' + esc(d.reference || '') + '">') + '</div>' : '') +
    (K.deduct ? '<label class="check' + (d.deductSub ? ' on' : '') + '" onclick="setTimeout(function(){this.classList.toggle(\'on\',byId(\'f-ded\').checked)}.bind(this),0)">' +
      '<input type="checkbox" id="f-ded"' + (d.deductSub ? ' checked' : '') + '>' +
      '<span><b>לקזז מקבלן המשנה</b><small>ההוצאה תיזקף על חשבון מה שמגיע לקבלן, ולא על חשבון הרווח</small></span></label>' : '') +
    fld('הערה', '<input id="f-note" class="inp" value="' + esc(d.note || '') + '">'),

    '<button class="btn o" onclick="saveEntry(this,\'' + kind + '\',\'' + (id || '') + '\')">' + (id ? 'שמירה' : 'הוספה') + '</button>' +
    '<button class="btn gh" onclick="closeModal()">ביטול</button>' +
    (id && canT(K.table, 'delete') ? '<div class="sp"></div><button class="btn d" onclick="askDelete(\'' + K.table + '\',\'' + id + '\')">🗑️ מחיקה</button>' : '')));
  if (K.proj) entryProjInfo(kind);
  bindEnter(['f-amount', 'f-cat', 'f-sup', 'f-ref', 'f-note'], function () {
    saveEntry(document.querySelector('.modal-foot .btn.o'), kind, id || '');
  });
}

/* שורת המצב מתחת לבחירת הפרוייקט — כמה נותר לגבות או לשלם */
function entryProjInfo(kind) {
  var el = byId('pinfo'); if (!el) return;
  var s = calc().proj[val('f-project')];
  if (!s) { el.innerHTML = ''; return; }
  var t = kind === 'cp' ? ['נותר לגבות מהלקוח', s.clientDue] : kind === 'sp' ? ['נותר לשלם לקבלן', s.subDue] : ['נותר מצפי ההוצאות', s.expLeft];
  el.innerHTML = '<div class="info-line' + (t[1] < 0 ? ' warn' : '') + '">' +
    '<span>' + t[0] + ': <b>' + money(Math.abs(t[1])) + '</b>' + (t[1] < 0 ? ' (חריגה)' : '') + '</span>' +
    (kind === 'sp' && s.dedExp ? '<span>כולל קיזוז הוצאות: <b>' + money(s.dedExp) + '</b></span>' : '') + '</div>';
}
