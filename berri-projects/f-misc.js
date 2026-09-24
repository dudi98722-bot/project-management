/* BERRI — טפסים: קופה, קטגוריה, משתמש, סיסמה, והזנה מהירה */
'use strict';

var REG_KINDS = ['מזומן', 'בנק', 'צ׳קים', 'אשראי', 'אחר'];

function registerModal(id) {
  if (!isAdmin()) return toast('קופות מוגדרות על ידי מנהל בלבד', 'err');
  var r = id ? findRow('registers', id) : null, d = r || { kind: 'מזומן', active: true, sort: S.d.registers.length + 1 };
  openModal(modalHtml('💰 ' + (id ? 'עריכת קופה' : 'קופה חדשה'),
    '<div id="m" class="msg"></div>' +
    fld('שם הקופה', '<input id="f-name" class="inp" autofocus value="' + esc(d.name || '') + '" placeholder="לדוגמה: מזומן, בנק, צ׳קים">', 1) +
    fld('סוג', '<select id="f-kind" class="inp">' + selOpts(REG_KINDS, d.kind) + '</select>') +
    '<div class="grid2">' +
      fld('יתרת פתיחה', '<input id="f-open" class="inp num" inputmode="decimal" value="' + (d.opening || '') + '">') +
      fld('נכונה לתאריך', '<input id="f-odate" class="inp" type="date" value="' + esc(d.openingDate || '') + '">') +
    '</div>' +
    '<p class="hint" style="margin:-8px 0 12px">יתרת הפתיחה היא הסכום שהיה בקופה לפני שהתחלתם להזין במערכת. תנועות מלפני התאריך לא ייספרו שוב.</p>' +
    '<label class="check' + (d.active ? ' on' : '') + '" onclick="setTimeout(function(){this.classList.toggle(\'on\',byId(\'f-active\').checked)}.bind(this),0)">' +
      '<input type="checkbox" id="f-active"' + (d.active ? ' checked' : '') + '>' +
      '<span><b>קופה פעילה</b><small>קופה לא פעילה לא תוצע בטפסים, אבל היתרה שלה נשמרת</small></span></label>' +
    fld('הערה', '<input id="f-note" class="inp" value="' + esc(d.note || '') + '">'),
    '<button class="btn o" onclick="saveRegister(this,\'' + (id || '') + '\')">שמירה</button>' +
    '<button class="btn gh" onclick="closeModal()">ביטול</button>'));
}
function saveRegister(btn, id) {
  if (!val('f-name')) return setMsg('m', 'יש להזין שם לקופה');
  saveRow(btn, 'registers', { id: id || newId('r'), name: val('f-name'), kind: val('f-kind'),
    opening: parseAmount(val('f-open')) || 0, openingDate: val('f-odate'),
    active: checked('f-active'), note: val('f-note') }, id ? 'הקופה עודכנה' : 'הקופה נוספה');
}

function catModal(id, group) {
  if (!canEdit()) return toast('אין לך הרשאה', 'err');
  var c = id ? findRow('categories', id) : null;
  openModal(modalHtml('🏷️ ' + (id ? 'שינוי שם קטגוריה' : 'קטגוריה חדשה'),
    '<div id="m" class="msg"></div>' +
    '<div class="hint">' + esc(GROUP_HE[(c ? c.group : group)] || '') + '</div>' +
    fld('שם', '<input id="f-name" class="inp" autofocus value="' + esc(c ? c.name : '') + '">', 1) +
    (id ? '<p class="hint">שינוי השם יעדכן גם את כל השורות שכבר משויכות לקטגוריה.</p>' : ''),
    '<button class="btn o" onclick="saveCat(this,\'' + (id || '') + '\',\'' + (c ? c.group : group) + '\')">שמירה</button>' +
    '<button class="btn gh" onclick="closeModal()">ביטול</button>'));
  bindEnter(['f-name'], function () { saveCat(document.querySelector('.modal-foot .btn.o'), id || '', c ? c.group : group); });
}
var GROUP_HE = { project: 'הוצאות פרוייקט', business: 'הוצאות עסק', home: 'הוצאות בית',
                 'in': 'כסף נכנס לקופה', out: 'כסף יצא מקופה' };
function saveCat(btn, id, group) {
  if (!val('f-name')) return setMsg('m', 'יש להזין שם');
  saveRow(btn, 'categories', { id: id || newId('c'), group: group, name: val('f-name') }, 'נשמר');
}

function userModal(id) {
  if (!isAdmin()) return toast('ניהול משתמשים למנהל בלבד', 'err');
  var u = id ? findRow('users', id) : null, d = u || { role: 'editor', active: true };
  var me = u && u.id === S.user.id;
  openModal(modalHtml('👥 ' + (id ? 'עריכת משתמש' : 'משתמש חדש'),
    '<div id="m" class="msg"></div>' +
    fld('שם מלא', '<input id="f-full" class="inp" autofocus value="' + esc(d.fullName || '') + '">') +
    fld('שם משתמש', '<input id="f-user" class="inp" dir="ltr" autocomplete="off" value="' + esc(d.username || '') + '">', 1) +
    fld('סיסמה' + (id ? ' חדשה' : ''), '<input id="f-pass" class="inp" type="password" autocomplete="new-password" placeholder="' +
      (id ? 'להשאיר ריק — בלי שינוי' : '6 תווים לפחות') + '">', !id) +
    fld('תפקיד', '<select id="f-role" class="inp"' + (me ? ' disabled' : '') + '>' +
      selOpts([{ v: 'admin', t: 'מנהל — הכל' }, { v: 'editor', t: 'עורך — הזנה ועריכה' }, { v: 'viewer', t: 'צופה — צפייה בלבד' }], d.role, 'v', 't') + '</select>') +
    (me ? '<p class="hint">אי אפשר לשנות לעצמך תפקיד או להשבית את עצמך.</p>' :
      '<label class="check' + (d.active ? ' on' : '') + '" onclick="setTimeout(function(){this.classList.toggle(\'on\',byId(\'f-active\').checked)}.bind(this),0)">' +
      '<input type="checkbox" id="f-active"' + (d.active ? ' checked' : '') + '><span><b>משתמש פעיל</b></span></label>'),
    '<button class="btn o" onclick="saveUser(this,\'' + (id || '') + '\')">שמירה</button>' +
    '<button class="btn gh" onclick="closeModal()">ביטול</button>'));
}
function saveUser(btn, id) {
  var u = id ? findRow('users', id) : null, me = u && u.id === S.user.id;
  if (!val('f-user')) return setMsg('m', 'יש להזין שם משתמש');
  setMsg('m', ''); busy(btn, true);
  api('saveUser', { id: id, username: val('f-user'), fullName: val('f-full'),
    role: me ? u.role : val('f-role'), password: byId('f-pass').value,
    active: (me || checked('f-active')) ? '1' : '0' }).then(function (r) {
    busy(btn, false);
    if (!r.ok) { if (!handleExpired(r)) setMsg('m', r.error); return; }
    var i = S.d.users.map(function (x) { return x.id; }).indexOf(r.user.id);
    if (i < 0) S.d.users.push(r.user); else S.d.users[i] = r.user;
    S.ver++; cacheState(); closeModal(); rerender();
    toast(id ? 'המשתמש עודכן' : 'המשתמש נוצר', 'ok');
  });
}
function askDisableUser(id) {
  var u = findRow('users', id);
  confirmModal('השבתת משתמש', 'להשבית את <b>' + esc(u.fullName) + '</b>? הוא לא יוכל להיכנס יותר.', '🚫 השבתה', function (btn) {
    busy(btn, true);
    api('deleteUser', { id: id }).then(function (r) {
      busy(btn, false); closeModal();
      if (!r.ok) { if (!handleExpired(r)) toast(r.error, 'err'); return; }
      u.active = false; S.ver++; cacheState(); rerender(); toast('המשתמש הושבת', 'ok');
    });
  });
}

function passwordModal() {
  openModal(modalHtml('🔑 החלפת סיסמה', '<div id="m" class="msg"></div>' +
    fld('סיסמה נוכחית', '<input id="f-old" class="inp" type="password" autocomplete="current-password" autofocus>', 1) +
    fld('סיסמה חדשה', '<input id="f-new" class="inp" type="password" autocomplete="new-password" placeholder="6 תווים לפחות">', 1) +
    '<p class="hint">אחרי ההחלפה תנותקו מכל שאר המכשירים.</p>',
    '<button class="btn o" onclick="savePass(this)">שמירה</button><button class="btn gh" onclick="closeModal()">ביטול</button>'));
  bindEnter(['f-old', 'f-new'], function () { savePass(document.querySelector('.modal-foot .btn.o')); });
}
function savePass(btn) {
  var n = byId('f-new').value;
  if (n.length < 6) return setMsg('m', 'הסיסמה החדשה חייבת 6 תווים לפחות');
  busy(btn, true);
  api('changePass', { oldPassword: byId('f-old').value, newPassword: n }).then(function (r) {
    busy(btn, false);
    if (!r.ok) { if (!handleExpired(r)) setMsg('m', r.error); return; }
    S.token = r.token; lsSet(LS.tok, r.token);
    closeModal(); toast('הסיסמה הוחלפה', 'ok');
  });
}

/* כפתור ה"הזנה" שבסרגל העליון */
function quickAdd() {
  var opts = [['cp', 'תשלום מלקוח', 'כסף שנכנס מלקוח'], ['sp', 'תשלום לקבלן', 'כסף שיצא לקבלן משנה'],
    ['pe', 'הוצאה לפרוייקט', 'חומרים, כלים, פועלים'], ['be', 'הוצאת עסק', 'בלי שיוך לפרוייקט']];
  if (isAdmin()) opts.push(['he', 'הוצאת בית', 'הוצאות פרטיות']);
  opts.push(['in', 'כסף נכנס לקופה', 'הפקדה, הלוואה'], ['out', 'כסף יצא מקופה', 'משיכה, החזר'],
    ['tr', 'העברה בין קופות', 'מקופה לקופה']);
  openModal(modalHtml('➕ מה להזין?', '<div class="quick">' + opts.map(function (o) {
    return '<button onclick="closeModal();entryModal(\'' + o[0] + '\')"><span class="qi">' + KIND[o[0]].i + '</span>' +
      '<b>' + o[1] + '</b><small>' + o[2] + '</small></button>';
  }).join('') + '</div>' + (canEdit() ? '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' +
    '<button class="btn sm" onclick="closeModal();projectModal()">🏗️ פרוייקט חדש</button>' +
    (isAdmin() ? '<button class="btn sm" onclick="closeModal();registerModal()">💰 קופה חדשה</button>' : '') + '</div>' : ''), ''), true);
}
