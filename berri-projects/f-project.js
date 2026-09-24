/* BERRI — טופס פרוייקט: מחירים, תאריכים וצפי הוצאות */
'use strict';

function projectModal(id) {
  if (!canEdit()) return toast('אין לך הרשאה', 'err');
  var p = id ? findRow('projects', id) : null;
  var d = p || { startDate: calc().today, active: true };
  openModal(modalHtml('🏗️ ' + (id ? 'עריכת פרוייקט' : 'פרוייקט חדש'),
    '<div id="m" class="msg"></div>' +
    fld('שם הפרוייקט', '<input id="f-name" class="inp" autofocus value="' + esc(d.name || '') + '" placeholder="לדוגמה: וילה ברחוב הרצל">', 1) +
    '<div class="grid2">' +
      fld('לקוח', '<input id="f-client" class="inp" value="' + esc(d.client || '') + '">') +
      fld('טלפון הלקוח', '<input id="f-cphone" class="inp" dir="ltr" inputmode="tel" value="' + esc(d.clientPhone || '') + '">') +
    '</div>' +
    fld('כתובת', '<input id="f-address" class="inp" value="' + esc(d.address || '') + '">') +
    '<div class="grid2">' +
      fld('קבלן משנה', '<input id="f-sub" class="inp" list="dl-sub" value="' + esc(d.subName || '') + '">' + subList()) +
      fld('טלפון הקבלן', '<input id="f-sphone" class="inp" dir="ltr" inputmode="tel" value="' + esc(d.subPhone || '') + '">') +
    '</div>' +
    '<div class="grid3">' +
      fld('מחיר ללקוח', '<input id="f-cprice" class="inp num" inputmode="decimal" value="' + (d.clientPrice || '') + '" oninput="projPreview()">') +
      fld('מחיר לקבלן', '<input id="f-sprice" class="inp num" inputmode="decimal" value="' + (d.subPrice || '') + '" oninput="projPreview()">') +
      fld('צפי הוצאות', '<input id="f-exp" class="inp num" inputmode="decimal" value="' + (d.expected || '') + '" oninput="projPreview()">') +
    '</div>' +
    '<div id="prev"></div>' +
    '<div class="grid2">' +
      fld('תאריך התחלה', '<input id="f-start" class="inp" type="date" value="' + esc(d.startDate || '') + '" onchange="projPreview()">') +
      fld('תאריך סיום', '<input id="f-end" class="inp" type="date" value="' + esc(d.endDate || '') + '" onchange="projPreview()">') +
    '</div>' +
    '<label class="check' + (d.active ? ' on' : '') + '" onclick="setTimeout(function(){this.classList.toggle(\'on\',byId(\'f-active\').checked)}.bind(this),0)">' +
      '<input type="checkbox" id="f-active"' + (d.active ? ' checked' : '') + '>' +
      '<span><b>פרוייקט פעיל</b><small>פרוייקט שהסתיים — הסירו את הסימון, והוא יעבור ל"לא פעילים"</small></span></label>' +
    fld('הערות', '<textarea id="f-note" class="inp">' + esc(d.note || '') + '</textarea>'),

    '<button class="btn o" onclick="saveProject(this,\'' + (id || '') + '\')">' + (id ? 'שמירה' : 'יצירת פרוייקט') + '</button>' +
    '<button class="btn gh" onclick="closeModal()">ביטול</button>'), true);
  projPreview();
}
function subList() {
  var seen = {};
  S.d.projects.forEach(function (p) { if (p.subName) seen[p.subName] = 1; });
  return '<datalist id="dl-sub">' + Object.keys(seen).map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>';
}

/* תצוגה חיה של הרווח המתוכנן והרווח לחודש בזמן ההקלדה */
function projPreview() {
  var el = byId('prev'); if (!el) return;
  var cp = parseAmount(val('f-cprice')) || 0, sp = parseAmount(val('f-sprice')) || 0, ex = parseAmount(val('f-exp')) || 0;
  var profit = round2(cp - sp - ex);
  var st = val('f-start'), en = val('f-end') || calc().today;
  var mon = st ? monthsBetween(st, en) : 0;
  el.innerHTML = '<div class="info-line' + (profit < 0 ? ' warn' : '') + '">' +
    '<span>רווח מתוכנן: <b>' + money(profit) + '</b>' + (cp ? ' (' + Math.round(profit / cp * 100) + '%)' : '') + '</span>' +
    (mon ? '<span>משך: <b>' + fmtMonths(mon) + ' חודשים</b>' + (val('f-end') ? '' : ' עד היום') + '</span>' +
      '<span>רווח לחודש: <b>' + money(profit / mon) + '</b></span>' : '') + '</div>';
}

function saveProject(btn, id) {
  var name = val('f-name');
  if (!name) return setMsg('m', 'יש להזין שם לפרוייקט');
  var st = val('f-start'), en = val('f-end');
  if (st && en && en < st) return setMsg('m', 'תאריך הסיום מוקדם מתאריך ההתחלה');
  var row = { id: id || newId('p'), name: name, client: val('f-client'), clientPhone: val('f-cphone'),
    address: val('f-address'), subName: val('f-sub'), subPhone: val('f-sphone'),
    clientPrice: parseAmount(val('f-cprice')) || 0, subPrice: parseAmount(val('f-sprice')) || 0,
    expected: parseAmount(val('f-exp')) || 0, startDate: st, endDate: en,
    active: checked('f-active'), note: val('f-note') };
  saveRow(btn, 'projects', row, id ? 'הפרוייקט עודכן' : 'הפרוייקט נוצר', function (saved) {
    if (!id) go('project', saved.id);
  });
}
