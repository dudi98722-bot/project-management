/* =====================================================================
   BERRI — ייבוא מאקסל: בחירת קובץ ▸ מיפוי עמודות ▸ בדיקה ▸ ייבוא.
   שום שורה לא נשמרת לפני שרואים אותה בטבלת הבדיקה.
   ===================================================================== */
'use strict';

/* השדות שאפשר למלא בייבוא, לכל טבלה. alias = כותרות שמזוהות אוטומטית */
var IMP = {
  clientPayments: { title: 'תשלומי לקוחות', fields: [
    { k: 'date', t: 'תאריך', type: 'date', req: 1, alias: ['תאריך', 'תאריך תשלום', 'date'] },
    { k: 'projectId', t: 'פרוייקט', type: 'project', req: 1, alias: ['פרוייקט', 'פרויקט', 'project', 'אתר'] },
    { k: 'amount', t: 'סכום', type: 'money', req: 1, alias: ['סכום', 'תשלום', 'amount', 'סה"כ', 'סה״כ'] },
    { k: 'registerId', t: 'לקופה', type: 'register', alias: ['קופה', 'לקופה', 'חשבון', 'בנק'] },
    { k: 'method', t: 'אמצעי תשלום', type: 'text', alias: ['אמצעי', 'אמצעי תשלום', 'סוג תשלום'] },
    { k: 'reference', t: 'אסמכתא', type: 'text', alias: ['אסמכתא', 'מספר שיק', 'שיק', 'צ׳ק', 'ref'] },
    { k: 'note', t: 'הערה', type: 'text', alias: ['הערה', 'הערות', 'note'] }] },
  subPayments: { title: 'תשלומים לקבלני משנה', fields: [
    { k: 'date', t: 'תאריך', type: 'date', req: 1, alias: ['תאריך', 'date'] },
    { k: 'projectId', t: 'פרוייקט', type: 'project', req: 1, alias: ['פרוייקט', 'פרויקט', 'project'] },
    { k: 'amount', t: 'סכום', type: 'money', req: 1, alias: ['סכום', 'תשלום', 'amount'] },
    { k: 'registerId', t: 'מקופה', type: 'register', alias: ['קופה', 'מקופה', 'חשבון', 'בנק'] },
    { k: 'method', t: 'אמצעי תשלום', type: 'text', alias: ['אמצעי', 'אמצעי תשלום'] },
    { k: 'reference', t: 'אסמכתא', type: 'text', alias: ['אסמכתא', 'שיק', 'צ׳ק'] },
    { k: 'note', t: 'הערה', type: 'text', alias: ['הערה', 'הערות'] }] },
  projectExpenses: { title: 'הוצאות פרוייקטים', fields: [
    { k: 'date', t: 'תאריך', type: 'date', req: 1, alias: ['תאריך', 'date'] },
    { k: 'projectId', t: 'פרוייקט', type: 'project', req: 1, alias: ['פרוייקט', 'פרויקט', 'project', 'אתר'] },
    { k: 'amount', t: 'סכום', type: 'money', req: 1, alias: ['סכום', 'amount', 'סה"כ', 'סה״כ'] },
    { k: 'registerId', t: 'מקופה', type: 'register', alias: ['קופה', 'מקופה', 'חשבון'] },
    { k: 'category', t: 'קטגוריה', type: 'text', alias: ['קטגוריה', 'סוג', 'סוג הוצאה', 'סעיף'] },
    { k: 'supplier', t: 'ספק / פירוט', type: 'text', alias: ['ספק', 'פירוט', 'תיאור', 'שם הספק'] },
    { k: 'deductSub', t: 'קיזוז מהקבלן', type: 'bool', alias: ['קיזוז', 'מקוזז', 'קיזוז מהקבלן'] },
    { k: 'note', t: 'הערה', type: 'text', alias: ['הערה', 'הערות'] }] },
  businessExpenses: { title: 'הוצאות עסק', fields: [
    { k: 'date', t: 'תאריך', type: 'date', req: 1, alias: ['תאריך', 'date'] },
    { k: 'amount', t: 'סכום', type: 'money', req: 1, alias: ['סכום', 'amount', 'סה"כ', 'סה״כ'] },
    { k: 'registerId', t: 'מקופה', type: 'register', alias: ['קופה', 'מקופה', 'חשבון'] },
    { k: 'category', t: 'קטגוריה', type: 'text', alias: ['קטגוריה', 'סוג', 'סעיף'] },
    { k: 'supplier', t: 'ספק / פירוט', type: 'text', alias: ['ספק', 'פירוט', 'תיאור'] },
    { k: 'note', t: 'הערה', type: 'text', alias: ['הערה', 'הערות'] }] },
  homeExpenses: { title: 'הוצאות בית', fields: [
    { k: 'date', t: 'תאריך', type: 'date', req: 1, alias: ['תאריך', 'date'] },
    { k: 'amount', t: 'סכום', type: 'money', req: 1, alias: ['סכום', 'amount'] },
    { k: 'registerId', t: 'מקופה', type: 'register', alias: ['קופה', 'מקופה', 'חשבון'] },
    { k: 'category', t: 'קטגוריה', type: 'text', alias: ['קטגוריה', 'סוג', 'סעיף'] },
    { k: 'supplier', t: 'פירוט', type: 'text', alias: ['פירוט', 'תיאור', 'ספק'] },
    { k: 'note', t: 'הערה', type: 'text', alias: ['הערה', 'הערות'] }] },
  additions: { title: 'תוספות לפרוייקט', fields: [
    { k: 'date', t: 'תאריך', type: 'date', req: 1, alias: ['תאריך', 'date'] },
    { k: 'projectId', t: 'פרוייקט', type: 'project', req: 1, alias: ['פרוייקט', 'פרויקט'] },
    { k: 'description', t: 'תיאור התוספת', type: 'text', req: 1, alias: ['תיאור', 'תוספת', 'פירוט'] },
    { k: 'clientAmount', t: 'תוספת ללקוח', type: 'money', neg: 1, alias: ['ללקוח', 'תוספת ללקוח', 'סכום'] },
    { k: 'subAmount', t: 'תוספת לקבלן', type: 'money', neg: 1, alias: ['לקבלן', 'תוספת לקבלן'] },
    { k: 'note', t: 'הערה', type: 'text', alias: ['הערה', 'הערות'] }] }
};

var IMPS = { step: 1, tk: '', ctx: '', rows: [], head: [], map: {}, parsed: [], busy: false };

function importOpen(tk, ctx) {
  var C = IMP[tk];
  if (!C) return toast('אין ייבוא לטבלה הזו', 'err');
  if (!tableEditable(tk)) return toast('אין לך הרשאה לייבא', 'err');
  IMPS = { step: 1, tk: tk, ctx: ctx || '', rows: [], head: [], map: {}, parsed: [], busy: false };
  importRender();
}
function importRender() {
  var C = IMP[IMPS.tk];
  openModal(modalHtml('📥 ייבוא מאקסל — ' + C.title,
    '<div id="m" class="msg"></div><div id="imp-body">' + (IMPS.step === 1 ? impStep1() : impStep2()) + '</div>',
    IMPS.step === 1 ? '<button class="btn gh" onclick="closeModal()">סגירה</button>'
      : '<button class="btn o" id="imp-go" onclick="importRun(this)">✔ ייבוא ' + impValid().length + ' שורות</button>' +
        '<button class="btn" onclick="IMPS.step=1;importRender()">← קובץ אחר</button>' +
        '<div class="sp"></div><button class="btn gh" onclick="closeModal()">ביטול</button>'), true);
  if (IMPS.step === 1) impBindDrop();
}

/* --- שלב 1: קובץ או הדבקה --- */
function impStep1() {
  var C = IMP[IMPS.tk];
  return '<div id="imp-drop" style="border:2px dashed var(--line);border-radius:var(--r);padding:26px 18px;' +
      'text-align:center;background:#FBFCFE;cursor:pointer" onclick="byId(\'imp-file\').click()">' +
      '<div style="font-size:34px">📄</div>' +
      '<div style="font-weight:800;color:var(--navy);margin-top:6px">בחירת קובץ אקסל</div>' +
      '<div class="muted" style="font-size:13px">או גרירת הקובץ לכאן · xlsx או csv</div>' +
      '<input type="file" id="imp-file" accept=".xlsx,.csv,.txt,.tsv" class="hide" onchange="impFile(this.files[0])">' +
    '</div>' +
    '<div class="lbl" style="margin:14px 0 4px">או להדביק כאן מתוך אקסל (Ctrl+V)</div>' +
    '<textarea id="imp-paste" class="inp" rows="4" placeholder="להעתיק באקסל את השורות כולל שורת הכותרות, ולהדביק כאן…" ' +
      'oninput="impPaste(this.value)"></textarea>' +
    '<div class="hint" style="margin-top:10px">השורה הראשונה צריכה להיות <b>שורת כותרות</b> — לפי השמות שלה המערכת ' +
      'מזהה לבד איזו עמודה היא מה, ואפשר לתקן אחר כך.<br>עמודות שהמערכת מחפשת: ' +
      C.fields.map(function (f) { return '<b>' + esc(f.t) + '</b>' + (f.req ? ' (חובה)' : ''); }).join(' · ') + '</div>';
}
function impBindDrop() {
  var d = byId('imp-drop'); if (!d) return;
  ['dragenter', 'dragover'].forEach(function (e) {
    d.addEventListener(e, function (ev) { ev.preventDefault(); d.style.borderColor = 'var(--orange)'; d.style.background = 'var(--orange-p)'; });
  });
  ['dragleave', 'drop'].forEach(function (e) {
    d.addEventListener(e, function (ev) { ev.preventDefault(); d.style.borderColor = 'var(--line)'; d.style.background = '#FBFCFE'; });
  });
  d.addEventListener('drop', function (ev) {
    if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]) impFile(ev.dataTransfer.files[0]);
  });
}
function impFile(file) {
  if (!file) return;
  setMsg('m', 'קורא את הקובץ…', 'ok');
  readSpreadsheet(file).then(function (rows) { impLoaded(rows, file.name); })
    .catch(function (e) { setMsg('m', e.message || 'לא הצלחתי לקרוא את הקובץ'); });
}
function impPaste(text) {
  if (!text || text.indexOf('\n') < 0) return;
  impLoaded(parseDelimited(text), 'הדבקה');
}
function impLoaded(rows, name) {
  rows = rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  if (rows.length < 2) return setMsg('m', 'צריך שורת כותרות ולפחות שורה אחת מתחתיה');
  IMPS.head = rows[0].map(function (h) { return String(h).trim(); });
  IMPS.rows = rows.slice(1);
  IMPS.map = impAutoMap();
  IMPS.step = 2; IMPS.name = name;
  importRender();
}
/* זיהוי אוטומטי לפי שם הכותרת — התאמה מלאה קודמת להתאמה חלקית */
function impAutoMap() {
  var C = IMP[IMPS.tk], map = {}, used = {};
  var norm = function (s) { return String(s).toLowerCase().replace(/["'׳״\s_-]/g, ''); };
  var heads = IMPS.head.map(norm);
  C.fields.forEach(function (f) {
    var al = [f.t].concat(f.alias || []).map(norm);
    var hit = -1;
    for (var a = 0; a < al.length && hit < 0; a++) {
      for (var i = 0; i < heads.length; i++) if (!used[i] && heads[i] === al[a]) { hit = i; break; }
    }
    for (var a2 = 0; a2 < al.length && hit < 0; a2++) {
      for (var j = 0; j < heads.length; j++) {
        if (!used[j] && heads[j] && (heads[j].indexOf(al[a2]) >= 0 || al[a2].indexOf(heads[j]) >= 0)) { hit = j; break; }
      }
    }
    if (hit >= 0) { map[f.k] = hit; used[hit] = 1; }
  });
  return map;
}
