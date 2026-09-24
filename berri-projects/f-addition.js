/* BERRI — טופס תוספת לפרוייקט: עבודה שנוספה אחרי שהמחיר כבר סוכם */
'use strict';

function additionModal(id, pre) {
  if (!canEdit()) return toast('אין לך הרשאה להזין', 'err');
  var projs = sortedProjects();
  if (!projs.length) return toast('צריך להגדיר פרוייקט קודם', 'err');
  var r = id ? findRow('additions', id) : null;
  var d = Object.assign({ date: calc().today }, r || {}, pre || {});
  if (!d.projectId && projs.length === 1) d.projectId = projs[0].id;

  /* בעריכה, המחיר המוצג כבר כולל את התוספת הזו — מחסירים אותה כדי
     שהתצוגה המקדימה תראה את ההפרש ולא תספור אותה פעמיים */
  window._addWas = r ? { c: Number(r.clientAmount) || 0, s: Number(r.subAmount) || 0 } : { c: 0, s: 0 };
  openModal(modalHtml('➕ ' + (id ? 'עריכת תוספת' : 'תוספת לפרוייקט'),
    '<div id="m" class="msg"></div>' +
    fld('פרוייקט', '<select id="f-project" class="inp" onchange="addPreview()">' +
      '<option value="">— בחר פרוייקט —</option>' + selOpts(projs, d.projectId, 'id', 'name') + '</select>', 1) +
    '<div class="grid2">' +
      fld('תאריך', '<input id="f-date" class="inp" type="date" value="' + esc(d.date) + '">', 1) +
      fld('תיאור התוספת', '<input id="f-desc" class="inp" autofocus value="' + esc(d.description || '') + '" placeholder="לדוגמה: ריצוף מרפסת">', 1) +
    '</div>' +
    '<div class="grid2">' +
      fld('תוספת למחיר ללקוח', '<input id="f-cadd" class="inp num" inputmode="decimal" value="' + (d.clientAmount || '') + '" oninput="addPreview()" placeholder="0">') +
      fld('תוספת למחיר לקבלן', '<input id="f-sadd" class="inp num" inputmode="decimal" value="' + (d.subAmount || '') + '" oninput="addPreview()" placeholder="0">') +
    '</div>' +
    '<div id="aprev"></div>' +
    '<p class="hint" style="margin:-6px 0 12px">אם קבלן המשנה לא מקבל תוספת על העבודה הזו — להשאיר את השדה שלו ריק, וכל הסכום ייכנס לרווח. ' +
      'לזיכוי (עבודה שירדה מהחוזה) אפשר להזין סכום שלילי, למשל ‎-5000.</p>' +
    fld('הערה', '<input id="f-note" class="inp" value="' + esc(d.note || '') + '">'),

    '<button class="btn o" onclick="saveAddition(this,\'' + (id || '') + '\')">' + (id ? 'שמירה' : 'הוספה') + '</button>' +
    '<button class="btn gh" onclick="closeModal()">ביטול</button>' +
    (id ? '<div class="sp"></div><button class="btn d" onclick="askDelete(\'additions\',\'' + id + '\')">🗑️ מחיקה</button>' : '')), true);
  addPreview();
  bindEnter(['f-desc', 'f-cadd', 'f-sadd', 'f-note'], function () {
    saveAddition(document.querySelector('.modal-foot .btn.o'), id || '');
  });
}

/* מראה לאן המחיר והרווח זזים עוד לפני השמירה */
function addPreview() {
  var el = byId('aprev'); if (!el) return;
  var s = calc().proj[val('f-project')];
  if (!s) { el.innerHTML = ''; return; }
  var ca = parseAmount(val('f-cadd')) || 0, sa = parseAmount(val('f-sadd')) || 0;
  var w = window._addWas || { c: 0, s: 0 };
  var cFrom = round2(s.clientPrice - w.c), sFrom = round2(s.subPrice - w.s);
  el.innerHTML = '<div class="info-line">' +
    '<span>מחיר ללקוח: ' + money(cFrom) + ' ← <b>' + money(cFrom + ca) + '</b></span>' +
    (sa || w.s ? '<span>לקבלן: ' + money(sFrom) + ' ← <b>' + money(sFrom + sa) + '</b></span>' : '') +
    '<span>תוספת לרווח: <b class="' + (ca - sa < 0 ? 'neg' : 'pos') + '">' + money(ca - sa) + '</b></span></div>';
}

function saveAddition(btn, id) {
  if (!val('f-project')) return setMsg('m', 'יש לבחור פרוייקט');
  if (!val('f-date')) return setMsg('m', 'יש לבחור תאריך');
  if (!val('f-desc')) return setMsg('m', 'יש להזין תיאור לתוספת');
  var ca = val('f-cadd') ? parseAmount(val('f-cadd')) : 0;
  var sa = val('f-sadd') ? parseAmount(val('f-sadd')) : 0;
  if (!isFinite(ca) || !isFinite(sa)) return setMsg('m', 'סכום לא תקין');
  if (!ca && !sa) return setMsg('m', 'יש להזין סכום — ללקוח, לקבלן, או לשניהם');
  saveRow(btn, 'additions', { id: id || newId('ad'), date: val('f-date'), projectId: val('f-project'),
    description: val('f-desc'), clientAmount: ca, subAmount: sa, note: val('f-note') },
    id ? 'התוספת עודכנה' : 'התוספת נוספה — המחיר עודכן');
}
