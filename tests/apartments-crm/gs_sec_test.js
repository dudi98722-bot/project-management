// בדיקות אבטחה ורגרסיה לסקריפט השרת — רץ מקומית עם חיקוי של Google Apps Script
// שימוש: node gs_sec_test.js <path-to-gs>
const fs = require('fs'), vm = require('vm'), crypto = require('crypto');
const src = fs.readFileSync(process.argv[2], 'utf8');

/* ---------- חיקוי גיליון ---------- */
function mkSheet(name) {
  const sh = { name, rows: [], hidden: false,
    getName() { return this.name; }, setName(n) { this.name = n; return this; }, hideSheet() { this.hidden = true; },
    clear() { this.rows = []; return this; }, getLastRow() { return this.rows.length; },
    appendRow(r) { this.rows.push(r.slice()); return this; },
    deleteRows(start, n) { this.rows.splice(start - 1, n); },
    getRange(r, c, nr, nc) { const s = this; nr = nr || 1; nc = nc || 1;
      return { setValues(v) { for (let i = 0; i < v.length; i++) { s.rows[r - 1 + i] = s.rows[r - 1 + i] || []; for (let j = 0; j < v[i].length; j++) s.rows[r - 1 + i][c - 1 + j] = v[i][j]; } },
        getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push((s.rows[r - 1 + i] || [])[c - 1 + j] === undefined ? '' : s.rows[r - 1 + i][c - 1 + j]); out.push(row); } return out; },
        setValue(v) { s.rows[r - 1] = s.rows[r - 1] || []; s.rows[r - 1][c - 1] = v; },
        getValue() { return ((s.rows[r - 1] || [])[c - 1]) === undefined ? '' : s.rows[r - 1][c - 1]; },
        setNumberFormat() { return this; }, setFontWeight() { return this; }, setBackground() { return this; } };
    }, setFrozenRows() {}, autoResizeColumns() {}, setColumnWidth() {}, getMaxRows() { return this.rows.length; } };
  return sh;
}
const book = { sheets: [],
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; },
  insertSheet(n) { const s = mkSheet(n); this.sheets.push(s); return s; },
  getSheets() { return this.sheets.slice(); }, deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); },
  getId() { return 'SS1'; } };
const props = {}; const mails = []; const sleeps = [];
const ctx = { console,
  SpreadsheetApp: { getActiveSpreadsheet: () => book, flush() {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, tryLock() { return true; }, releaseLock() {} }) },
  Utilities: {
    sleep(ms) { sleeps.push(ms); }, getUuid: () => crypto.randomUUID(),
    formatDate: () => '20260929', base64Decode: s => Array.from(Buffer.from(s, 'base64')),
    newBlob: (b, m, n) => ({ bytes: b, mime: m, name: n }),
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
    computeHmacSha256Signature: (s, k) => Array.from(crypto.createHmac('sha256', String(k)).update(String(s), 'utf8').digest()).map(b => b > 127 ? b - 256 : b) },
  MailApp: { sendEmail(to, subject, body) { mails.push({ to, subject, body }); } },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput(t) { return { t, setMimeType() { return JSON.parse(this.t); } }; } },
  DriveApp: { getRootFolder: () => ({ getId: () => 'root' }) },
  Logger: { log() {} } };
vm.createContext(ctx); vm.runInContext(src, ctx);

/* ---------- עזרים ---------- */
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const H = { admin: sha('admin-code-1'), editor: sha('editor-code-2'), viewer: sha('viewer-code-3'), mgmt: sha('mgmt-code-4'), bad: sha('nope') };
const post = b => ctx.doPost({ postData: { contents: JSON.stringify(b) } });
const get = q => { const e = { parameter: {} }; q.split('&').forEach(kv => { const [k, v] = kv.split('='); e.parameter[k] = decodeURIComponent(v); }); return ctx.doGet(e); };
function seedDB() {
  return { meta: { version: 1, rev: 5 },
    users: [
      { id: 'u1', name: 'דודי', code: H.admin, role: 'admin', allowedApartments: [], partnerId: null, active: true, deleted: false, email: 'x@y.z' },
      { id: 'u2', name: 'עורך', code: H.editor, role: 'editor', allowedApartments: ['a1'], partnerId: null, active: true, deleted: false, email: 'e@y.z' },
      { id: 'u3', name: 'צופה', code: H.viewer, role: 'viewer', allowedApartments: ['a1'], partnerId: null, active: true, deleted: false },
      { id: 'u4', name: 'דמי ניהול', code: H.mgmt, role: 'mgmt', allowedApartments: ['a1', 'a2'], partnerId: null, active: true, deleted: false }],
    apartments: [{ id: 'a1', name: 'יוספטל', deleted: false, files: [{ id: 'F1', name: 'a.pdf' }] }, { id: 'a2', name: 'חנקין', deleted: false }],
    partners: [{ id: 'p1', name: 'שותף א', phone: '050', deleted: false }, { id: 'p2', name: 'שותף סודי', phone: '052', note: 'סודי', deleted: false }],
    apartmentPartners: [{ id: 'ap1', apartmentId: 'a1', partnerId: 'p1', pct: 100, deleted: false }, { id: 'ap2', apartmentId: 'a2', partnerId: 'p2', pct: 100, deleted: false }],
    managers: [], accounts: [], deposits: [], income: [{ id: 'i1', apartmentId: 'a1', amount: 10, deleted: false }, { id: 'i2', apartmentId: 'a2', amount: 20, deleted: false }],
    categories: [{ id: 'c1', name: 'כללי', deleted: false }],
    expenses: [{ id: 'e1', apartmentId: 'a1', name: 'הוצאה 1', amount: 100, deleted: false, mgmtEnabled: true },
               { id: 'e2', apartmentId: 'a2', name: 'הוצאה סודית', amount: 999, deleted: false, hidden: true },
               { id: 'e3', apartmentId: 'a1', name: 'הוצאה מוסתרת', amount: 5, deleted: false, hidden: true }],
    expenseSplits: [], expenseManagerFees: [],
    payments: [{ id: 'py1', expenseId: 'e1', amount: 100, recipientType: 'manager', deleted: false }, { id: 'py2', expenseId: 'e2', amount: 999, deleted: false }],
    bankMoves: [{ id: 'bm1', apartmentId: 'a2', amount: 5000, desc: 'בנק פרוייקט 2', deleted: false, matches: [{ incomeId: 'i2', amount: 5000 }] },
                { id: 'bm2', apartmentId: '', amount: 7, desc: 'לא משויך', deleted: false }],
    stmtBanks: [{ id: 'sb1', name: 'בנק', deleted: false }],
    withdrawals: [{ id: 'w1', apartmentId: 'a2', amount: 300, deleted: false }],
    incMgmtPays: [{ id: 'im1', apartmentId: 'a2', amount: 30, deleted: false }],
    recurring: [{ id: 'rc1', apartmentIds: ['a2'], amount: 1, deleted: false }],
    rentals: [{ id: 'r1', apartmentId: 'a1', tenant: 'שוכר', deleted: false, docs: [{ id: 'D1' }] }],
    sheets: [{ id: 's1', name: 'גיליון' }], settings: { aptCats: { a1: ['c1'] } } };
}
function writeDB(d) { const s = book.getSheetByName('_data') || book.insertSheet('_data'); s.clear(); const str = JSON.stringify(d); const CH = 40000; const rows = []; for (let i = 0; i < str.length; i += CH) rows.push([str.substr(i, CH)]); s.getRange(1, 1, rows.length, 1).setValues(rows); ctx.rememberMeta(d); props.crm_initialized = '1'; }
function readDB() { return ctx.loadData(); }
function reset() { book.sheets = []; for (const k in props) delete props[k]; mails.length = 0; sleeps.length = 0; writeDB(seedDB()); }
const R = []; let fails = 0;
process.on('uncaughtException', e => { console.log(R.join(String.fromCharCode(10))); console.log('CRASH: ' + e.stack); process.exit(2); });
function t(name, cond, info) { R.push((cond ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  → ' + JSON.stringify(info).slice(0, 220) : '')); if (!cond) fails++; }
const clone = o => JSON.parse(JSON.stringify(o));
/* שמירה מטעם משתמש: טוען את ההיקף שלו, מפעיל mutate, ושולח save */
function saveAs(hash, mutate, revBump) {
  const ld = post({ action: 'load', codeHash: hash });
  if (!ld.ok) return { load: ld };
  const d = ld.data; mutate(d);
  d.meta = d.meta || {}; d.meta.rev = (Number(ctx.storedRev()) || 0) + (revBump || 1);
  return post({ action: 'save', codeHash: hash, data: d });
}

/* ======================= 1. אימות ======================= */
reset();
t('login admin ok (legacy hex stored)', post({ action: 'login', codeHash: H.admin }).ok);
t('login wrong → bad-code', post({ action: 'login', codeHash: H.bad }).error === 'bad-code');
t('login response has no code/email', !JSON.stringify(post({ action: 'login', codeHash: H.admin }).user).includes(H.admin));
// A07-01: rev is gated
for (let i = 0; i < 40; i++) post({ action: 'rev', codeHash: sha('guess-same') });
const revBlocked = post({ action: 'rev', codeHash: sha('guess-same') });
t('A07-01 rev oracle throttled per key', revBlocked.error === 'too-many' && revBlocked.retryAfter > 0, revBlocked);
t('A07-03 other user still logs in during a key lock', post({ action: 'login', codeHash: H.admin }).ok);
t('rev with valid code still works', post({ action: 'rev', codeHash: H.admin }).ok);
// global cap → email alert
reset();
for (let i = 0; i < 200; i++) post({ action: 'login', codeHash: sha('g' + i) });
const gl = post({ action: 'login', codeHash: H.admin });
t('global cap blocks after scan (even valid code)', gl.error === 'too-many', gl);
t('alert mail sent to owner on global block', mails.some(m => /חסימת כניסה/.test(m.subject)), mails.map(m => m.subject));
t('seclog has auth-fail rows', (book.getSheetByName('_seclog') || { rows: [] }).rows.filter(r => r[1] === 'auth-fail').length >= 30);
// unauthenticated status is cheap after a save
reset();
t('status ok', get('action=status').ok && get('action=status').hasUsers === true);
t('status does not parse DB when property set', props.crm_has_users === '1');

/* ======================= 2. הצפנת קודים (A04-1) ======================= */
reset();
let sv = saveAs(H.admin, d => { d.apartments[0].name = 'יוספטל 2'; });
t('admin save ok', sv.ok, sv);
let stored = readDB();
t('A04-1 stored codes are derived (v2:), not raw hash', stored.users.every(u => /^v2:[0-9a-f]{64}$/.test(u.code)), stored.users.map(u => u.code.slice(0, 8)));
t('A04-1 stored code != client hash', !stored.users.some(u => u.code === H.admin));
t('login still works after migration', post({ action: 'login', codeHash: H.admin }).ok && post({ action: 'login', codeHash: H.editor }).ok);
t('rev quickAuth works after migration', post({ action: 'rev', codeHash: H.editor }).ok);
t('admin load masks codes ***', post({ action: 'load', codeHash: H.admin }).data.users.every(u => u.code === '***'));
// admin sets a new code for a user
sv = saveAs(H.admin, d => { d.users[1].code = sha('new-editor-code'); });
stored = readDB();
t('new code set by admin stored derived', /^v2:/.test(stored.users[1].code) && stored.users[1].code !== sha('new-editor-code'));
t('new code logs in; old does not', post({ action: 'login', codeHash: sha('new-editor-code') }).ok && !post({ action: 'login', codeHash: H.editor }).ok);
t('users-changed alert mailed', mails.some(m => /שינוי במשתמשים/.test(m.subject)));
H.editor = sha('new-editor-code');

/* ======================= 3. סינון קריאה (A01-1) ======================= */
reset();
const ldE = post({ action: 'load', codeHash: H.editor }).data;
t('A01-1 editor: bankMoves of other project hidden, unassigned kept', ldE.bankMoves.map(b => b.id).join() === 'bm2', ldE.bankMoves.map(b => b.id));
t('A01-1 editor: withdrawals/incMgmtPays/recurring of other project hidden', ldE.withdrawals.length === 0 && ldE.incMgmtPays.length === 0 && ldE.recurring.length === 0);
t('editor: own expenses visible, hidden ones not, other project not', ldE.expenses.map(e => e.id).join() === 'e1', ldE.expenses.map(e => e.id));
t('editor: partner PII of other project not sent', !ldE.partners.some(p => p.id === 'p2'), ldE.partners);
t('editor: no rentals/sheets/users/files', ldE.rentals.length === 0 && ldE.sheets.length === 0 && ldE.users.length === 0 && !ldE.apartments[0].files);
t('editor: categories & stmtBanks still delivered (needed for UI)', ldE.categories.length === 1 && ldE.stmtBanks.length === 1);
const ldM = post({ action: 'load', codeHash: H.mgmt }).data;
t('A01-1 mgmt: bank/withdrawals/recurring/incMgmtPays empty', ldM.bankMoves.length === 0 && ldM.withdrawals.length === 0 && ldM.recurring.length === 0 && ldM.incMgmtPays.length === 0 && ldM.stmtBanks.length === 0);
t('mgmt: only mgmt-enabled expenses + manager payments', ldM.expenses.map(e => e.id).join() === 'e1' && ldM.payments.map(p => p.id).join() === 'py1');
const ldV = post({ action: 'load', codeHash: H.viewer }).data;
t('viewer scoped: own expenses only, no unassigned bank lines', ldV.bankMoves.length === 0 && ldV.expenses.length === 1, ldV.bankMoves);

/* ======================= 4. הרשאות כתיבה (A01-2/3/5/6, A06-03) ======================= */
reset();
sv = saveAs(H.viewer, d => { d.apartments[0].name = 'x'; });
t('viewer save forbidden', sv.error === 'forbidden');
sv = saveAs(H.mgmt, d => { d.expenses[0].name = 'x'; });
t('mgmt save forbidden', sv.error === 'forbidden');
// editor: legit edit in own scope
sv = saveAs(H.editor, d => { d.expenses[0].name = 'הוצאה 1 מעודכנת'; d.expenses.push({ id: 'e9', apartmentId: 'a1', name: 'חדשה', amount: 1, deleted: false }); });
t('editor legit edit + new row in scope ok', sv.ok, sv);
stored = readDB();
t('editor edit applied; hidden/out-of-scope rows preserved', stored.expenses.find(e => e.id === 'e1').name === 'הוצאה 1 מעודכנת' && stored.expenses.find(e => e.id === 'e2').amount === 999 && stored.expenses.find(e => e.id === 'e3').hidden === true && stored.expenses.some(e => e.id === 'e9'));
t('rentals/sheets/settings/files survive editor save', stored.rentals.length === 1 && stored.sheets.length === 1 && stored.settings.aptCats.a1[0] === 'c1' && stored.apartments[0].files.length === 1 && stored.rentals[0].docs.length === 1);
t('server rev advanced by one', stored.meta.rev === 6 && sv.rev === 6, [stored.meta.rev, sv.rev]);
// A01-2: modify an existing out-of-scope row by id (injected into own payload)
sv = saveAs(H.editor, d => { d.expenses.push({ id: 'e2', apartmentId: 'a1', name: 'נגנבה', amount: 1, deleted: false }); });
stored = readDB();
t('A01-2/3 rewriting hidden row by id rejected', sv.error === 'scope-violation' || stored.expenses.find(e => e.id === 'e2').name === 'הוצאה סודית', { res: sv, e2: stored.expenses.find(e => e.id === 'e2') });
sv = saveAs(H.editor, d => { d.expenses.push({ id: 'e2', apartmentId: 'a2', name: 'x', amount: 1, deleted: true }); });
stored = readDB();
t('A01-2 soft-deleting foreign row: stored row kept + logged', stored.expenses.find(e => e.id === 'e2').deleted === false && stored.expenses.find(e => e.id === 'e2').name === 'הוצאה סודית' && (book.getSheetByName('_seclog') || { rows: [] }).rows.some(r => r[1] === 'restored-foreign-rows' && /expenses:e2/.test(r[3])), sv);
// A01-5: bankMoves/withdrawals/recurring tamper
sv = saveAs(H.editor, d => { d.bankMoves.push({ id: 'bm1', apartmentId: 'a2', amount: 1, deleted: false }); });
stored = readDB();
t('A01-5 foreign bank row untouched + logged', stored.bankMoves.find(b => b.id === 'bm1').amount === 5000 && (book.getSheetByName('_seclog') || { rows: [] }).rows.some(r => /bankMoves:bm1/.test(r[3])), sv);
sv = saveAs(H.editor, d => { d.recurring.push({ id: 'rcX', apartmentIds: ['a1', 'a2'], amount: 1, deleted: false }); });
t('A01-5 recurring rule into foreign project dropped+reported', sv.ok && sv.dropped.join().includes('recurring:rcX') && !readDB().recurring.some(r => r.id === 'rcX'), sv);
sv = saveAs(H.editor, d => { d.withdrawals.push({ id: 'wX', apartmentId: 'a2', amount: 1, deleted: false }); });
t('A01-5 withdrawal in foreign project dropped+reported', sv.ok && sv.dropped.join().includes('withdrawals:wX') && !readDB().withdrawals.some(w => w.id === 'wX'), sv);
sv = saveAs(H.editor, d => { d.bankMoves.push({ id: 'bmN', apartmentId: '', amount: 3, deleted: false }); d.bankMoves[0].apartmentId = 'a1'; });
t('editor: new unassigned bank row + assigning to own project ok', sv.ok && readDB().bankMoves.find(b => b.id === 'bm2').apartmentId === 'a1', sv);
// move own row to a foreign project
sv = saveAs(H.editor, d => { d.expenses[0].apartmentId = 'a2'; });
t('A01-3 moving own expense into foreign project: restored+reported', sv.ok && sv.dropped.join().includes('expenses:e1') && readDB().expenses.find(e => e.id === 'e1').apartmentId === 'a1', sv);
// A01-4 partner PII via foreign partnerId
sv = saveAs(H.editor, d => { d.apartmentPartners.push({ id: 'apX', apartmentId: 'a1', partnerId: 'p2', pct: 10, deleted: false }); });
t('A01-4 linking foreign partner dropped; PII not sent', sv.ok && sv.dropped.join().includes('apX') && !readDB().apartmentPartners.some(x => x.id === 'apX') && !post({ action: 'load', codeHash: H.editor }).data.partners.some(p => p.id === 'p2'), sv);
sv = saveAs(H.editor, d => { d.partners.push({ id: 'pN', name: 'שותף חדש', deleted: false }); d.apartmentPartners.push({ id: 'apY', apartmentId: 'a1', partnerId: 'pN', pct: 10, deleted: false }); });
t('editor: creating a new partner and linking it ok', sv.ok && readDB().partners.some(p => p.id === 'pN'), sv);
sv = saveAs(H.editor, d => { d.income.push({ id: 'iN', apartmentId: 'a1', amount: 1, receivedBy: 'acc-xyz', deleted: false }); d.income.push({ id: 'iN2', apartmentId: 'a1', amount: 1, receivedBy: 'p2', deleted: false }); });
t('receivedBy = non-partner id accepted; foreign partner id dropped', sv.ok && sv.dropped.join() === 'income:iN2 partner' && readDB().income.some(i => i.id === 'iN') && !readDB().income.some(i => i.id === 'iN2'), sv);
sv = saveAs(H.editor, d => { d.income.push({ id: 'iN', apartmentId: 'a1', amount: 1, receivedBy: 'acc-xyz', deleted: false }); });
t('receivedBy = non-partner id alone accepted', sv.ok, sv);
// A01-6 hidden flag
sv = saveAs(H.editor, d => { d.expenses.push({ id: 'e3', apartmentId: 'a1', name: 'הוצאה מוסתרת', amount: 5, deleted: false }); });
t('A01-6 un-hiding by re-sending id without flag: flag restored', readDB().expenses.find(e => e.id === 'e3').hidden === true, sv);
// admin can do everything
sv = saveAs(H.admin, d => { d.expenses.find(e => e.id === 'e2').name = 'ok'; d.recurring.push({ id: 'rcA', apartmentIds: ['a1', 'a2'], amount: 1, deleted: false }); });
t('admin unrestricted save ok', sv.ok && readDB().recurring.some(r => r.id === 'rcA'), sv);
// unlimited editor (no allowedApartments) — behaves like before
reset();
sv = saveAs(H.admin, d => { d.users[1].allowedApartments = []; });
sv = saveAs(H.editor, d => { d.income.find(e => e.id === 'i2').amount = 21; d.bankMoves.find(b => b.id === 'bm1').amount = 5001; });
t('unlimited editor edits any project (unchanged behaviour)', sv.ok && readDB().income.find(e => e.id === 'i2').amount === 21 && readDB().bankMoves.find(b => b.id === 'bm1').amount === 5001, sv);

/* ======================= 5. מזהים (INJ-01/03) ======================= */
reset();
sv = saveAs(H.admin, d => { d.categories.push({ id: "c'\"><img src=x onerror=alert(1)>", name: 'רעה', deleted: false }); });
t('INJ-01 malicious id rejected', sv.error === 'bad-id' && /categories\.id/.test(sv.detail), sv);
sv = saveAs(H.admin, d => { d.expenses.push({ id: 'ok1', apartmentId: "a1');alert(1);//", name: 'x', amount: 1, deleted: false }); });
t('INJ-03 malicious reference field rejected', sv.error === 'bad-id', sv);
sv = saveAs(H.admin, d => { d.recurring.push({ id: 'rc2', apartmentIds: ['a1', '<svg onload=1>'], amount: 1, deleted: false }); });
t('malicious id inside apartmentIds rejected', sv.error === 'bad-id', sv);
sv = saveAs(H.admin, d => { d.expenses.push({ id: 'idm1abc-XYZ_09', apartmentId: 'a1', name: 'שם עם <b>תגים</b> "וגרשיים"', amount: 1, deleted: false, payments: [{ id: 'pp1', amount: 1 }] }); });
t('normal ids and free text names accepted', sv.ok, sv);

/* ======================= 6. מונה גרסה (A06-01) ======================= */
reset();
sv = saveAs(H.editor, d => { d.expenses[0].note = 'x'; }, 1e300);
stored = readDB();
t('A06-01 huge client rev not stored', sv.ok && stored.meta.rev < 1e6 && ctx.storedRev() < 1e6, [sv.rev, stored.meta.rev]);
sv = saveAs(H.admin, d => { d.expenses[0].note = 'y'; });
t('others can still save afterwards', sv.ok, sv);
sv = post({ action: 'save', codeHash: H.admin, data: Object.assign(post({ action: 'load', codeHash: H.admin }).data, { meta: { rev: 1 } }) });
t('stale rev still rejected', sv.error === 'stale-rev');

/* ======================= 7. שחזור קוד (A06-06 / A07-08) ======================= */
reset();
const r1 = get('action=requestReset&user=' + encodeURIComponent('דודי'));
const r2 = get('action=requestReset&user=' + encodeURIComponent('לא קיים'));
t('A07-08 same response for existing and unknown user', r1.ok && r2.ok && JSON.stringify(r1) === JSON.stringify(r2), [r1, r2]);
t('reset mail sent only for real user', mails.filter(m => /קוד שחזור/.test(m.subject)).length === 1);
const code = (mails.find(m => /קוד שחזור/.test(m.subject)).body.match(/(\d{6})/) || [])[1];
t('code is 6 digits', /^\d{6}$/.test(code || ''));
const vr = get('action=verifyReset&code=' + code);
t('verifyReset ok', vr.ok && vr.resetToken, vr);
const sc = post({ action: 'setCode', resetToken: vr.resetToken, codeHash: sha('brand-new') });
t('setCode ok', sc.ok, sc);
t('new code stored derived', /^v2:/.test(readDB().users[0].code));
t('login with new code works', post({ action: 'login', codeHash: sha('brand-new') }).ok);
t('reset alert mailed', mails.some(m => /קוד כניסה הוחלף/.test(m.subject)));
// duplicate check on setCode
const vr2 = (get('action=requestReset&user=' + encodeURIComponent('עורך')), get('action=verifyReset&code=' + (mails[mails.length - 1].body.match(/(\d{6})/) || [])[1]));
const sc2 = post({ action: 'setCode', resetToken: vr2.resetToken, codeHash: sha('brand-new') });
t('setCode with code of another user → code-taken', sc2.error === 'code-taken', sc2);

/* ======================= 8. שגיאות (A10) ======================= */
reset();
const bad = ctx.doPost({ postData: { contents: '{not json' } });
t('malformed JSON → generic error, no stack', bad.ok === false && !/SyntaxError|at /.test(JSON.stringify(bad)), bad);
t('unknown action w/o auth → unauthorized', post({ action: 'nope', codeHash: H.bad }).error === 'unauthorized');
t('admin-only file action as editor → forbidden + logged', post({ action: 'filesInfo', codeHash: H.editor }).error === 'forbidden' && (book.getSheetByName('_seclog') || { rows: [] }).rows.some(r => r[1] === 'forbidden'));
t('fileMove as editor → forbidden', post({ action: 'fileMove', codeHash: H.editor, fileId: 'F1', aptId: 'a1', kind: 'contract' }).error === 'forbidden');

/* ======================= 9. נוסחאות בגיליון (A05) ======================= */
t('sheetSafe neutralises formula prefix', ctx.sheetSafe('=HYPERLINK("x")') === "'=HYPERLINK(\"x\")" && ctx.sheetSafe('רגיל') === 'רגיל' && ctx.sheetSafe(5) === 5);

/* ======================= 10. ייחוס מחיקה (A08/A06-09) ======================= */
reset();
sv = saveAs(H.editor, d => { d.expenses[0].deleted = true; d.expenses[0].deletedByUser = 'המנהל'; });
t('deletion attributed by server, not client', sv.ok && readDB().expenses[0].deletedByUser === 'עורך', readDB().expenses[0].deletedByUser);


/* ======================= 11. סבב 2 — ממצאי הסקירה האדוורסרית ======================= */
reset();
sv = saveAs(H.editor, d => { d.income.push({ id: "a1&#39;);alert(1);(&#39;", apartmentId: 'a1', amount: 5, deleted: false }); });
t('INJ-AMP-01 entity-encoded quote in id rejected', sv.error === 'bad-id', sv);
sv = saveAs(H.editor, d => { d.income.push({ id: 'a1\u0000x', apartmentId: 'a1', amount: 5, deleted: false }); });
t('NUL in id rejected', sv.error === 'bad-id', sv);
sv = saveAs(H.editor, d => { d.income.push({ id: 'a1 x', apartmentId: 'a1', amount: 5, deleted: false }); });
t('U+2028 in id rejected', sv.error === 'bad-id', sv);
sv = saveAs(H.editor, d => { d.income.push({ id: 'idm2abc-XYZ_09.7 x', apartmentId: 'a1', amount: 5, deleted: false }); });
t('ids with dot/space/dash still accepted', sv.ok && !sv.dropped.length, sv);
// REG-01: הוראת קבע משותפת
reset();
sv = saveAs(H.admin, d => { d.recurring.push({ id: 'rcMix', apartmentIds: ['a1', 'a2'], amount: 9, deleted: false }); });
let ldR = post({ action: 'load', codeHash: H.editor }).data;
t('REG-01 shared recurring rule visible to editor', ldR.recurring.some(r => r.id === 'rcMix'));
sv = saveAs(H.editor, d => { d.expenses[0].note = 'x'; d.recurring.find(r => r.id === 'rcMix').lastRun = '2026-09-30'; });
t('REG-01/ED-01 editor save with shared rule: save ok, shared rule kept as stored', sv.ok && sv.dropped.join() === 'recurring:rcMix shared' && readDB().recurring.find(r => r.id === 'rcMix').lastRun === undefined && readDB().recurring.find(r => r.id === 'rcMix').apartmentIds.join() === 'a1,a2' && readDB().expenses[0].note === 'x', sv);
sv = saveAs(H.editor, d => { d.recurring.find(r => r.id === 'rcMix').apartmentIds = ['a1']; });
t('REG-01 editor removing foreign apt from shared rule: restored', sv.ok && sv.dropped.join().includes('rcMix') && readDB().recurring.find(r => r.id === 'rcMix').apartmentIds.join() === 'a1,a2', sv);
sv = saveAs(H.editor, d => { d.recurring.push({ id: 'rcOwn', apartmentIds: ['a1'], amount: 1, deleted: false }); });
t('REG-01 editor creates own-project rule ok', sv.ok && readDB().recurring.some(r => r.id === 'rcOwn'), sv);
// REG-02: התאמות בנק להכנסות זרות
reset();
sv = saveAs(H.admin, d => { d.bankMoves.push({ id: 'bmMix', apartmentId: 'a1', amount: 30, deleted: false, matches: [{ id: 'x1', incomeId: 'i1', amount: 10 }, { id: 'x2', incomeId: 'i2', amount: 20 }] }); });
ldR = post({ action: 'load', codeHash: H.editor }).data;
t('REG-02 editor sees only own match', ldR.bankMoves.find(b => b.id === 'bmMix').matches.map(m => m.id).join() === 'x1');
sv = saveAs(H.editor, d => { d.bankMoves.find(b => b.id === 'bmMix').note = 'edited'; });
const bmM = readDB().bankMoves.find(b => b.id === 'bmMix');
t('REG-02 foreign match survives editor save', sv.ok && bmM.note === 'edited' && bmM.matches.map(m => m.id).sort().join() === 'x1,x2', bmM.matches);
// REG-03: עורך יוצר פרוייקט — הפרוייקט נופל, שאר השינויים נשמרים, אין נעילה
reset();
sv = saveAs(H.editor, d => { d.apartments.push({ id: 'aNew', name: 'חדש', deleted: false }); d.accounts.push({ id: 'accN', apartmentId: 'aNew', deleted: false }); d.expenses[0].note = 'saved anyway'; });
t('REG-03 new apartment dropped, other edits saved, save ok', sv.ok && sv.dropped.join().includes('apartments:aNew') && !readDB().apartments.some(a => a.id === 'aNew') && !readDB().accounts.some(a => a.id === 'accN') && readDB().expenses[0].note === 'saved anyway', sv);
sv = saveAs(H.editor, d => { d.expenses[0].note = 'next save'; });
t('REG-03 editor not locked out afterwards', sv.ok && readDB().expenses[0].note === 'next save', sv);
// C: הרעלת allowedExp
reset();
sv = saveAs(H.editor, d => { d.expenses.push({ id: 'e2', apartmentId: 'a1', name: 'x', amount: 1, deleted: false }); d.payments.push({ id: 'pyEVIL', expenseId: 'e2', amount: 7, deleted: false }); });
t('C payment attached to foreign hidden expense via remapped id: dropped', !readDB().payments.some(p => p.id === 'pyEVIL') && readDB().expenses.find(e => e.id === 'e2').apartmentId === 'a2', sv);
// D: דריסת שותף זר
sv = saveAs(H.editor, d => { d.partners.push({ id: 'p2', name: 'HACKED', deleted: true }); d.partners[0].name = 'שותף א (ערוך)'; });
t('D foreign partner untouched, own partner edited, reported', sv.ok && readDB().partners.find(p => p.id === 'p2').name === 'שותף סודי' && readDB().partners.find(p => p.id === 'p2').deleted === false && readDB().partners.find(p => p.id === 'p1').name === 'שותף א (ערוך)' && sv.dropped.join().includes('partners:p2'), sv);
// F: חשבון כללי שמפנה לשותף זר
reset();
sv = saveAs(H.admin, d => { d.accounts.push({ id: 'accG', apartmentId: '', partnerId: 'p2', name: 'כללי', deleted: false }); });
ldR = post({ action: 'load', codeHash: H.editor }).data;
t('F global account does not leak foreign partner', ldR.accounts.some(a => a.id === 'accG') && !ldR.partners.some(p => p.id === 'p2'), ldR.partners.map(p => p.id));
// A08-04: השמטת שורות חיות
reset();
sv = saveAs(H.editor, d => { d.income = []; d.expenses[0].note = 'omit test'; });
t('A08-04 editor omitting live rows: kept as soft-deleted (recoverable), attributed', sv.ok && readDB().income.find(i => i.id === 'i1').deleted === true && readDB().income.find(i => i.id === 'i1').deletedByUser === 'עורך' && readDB().income.find(i => i.id === 'i2').deleted === false, readDB().income);
sv = saveAs(H.admin, d => { d.bankMoves = d.bankMoves.filter(b => b.id !== 'bm1'); });
t('A08-04 admin omitting a live row: kept as soft-deleted, attributed', sv.ok && readDB().bankMoves.find(b => b.id === 'bm1').deleted === true && readDB().bankMoves.find(b => b.id === 'bm1').deletedByUser === 'דודי', readDB().bankMoves);
sv = saveAs(H.admin, d => { d.bankMoves.find(b => b.id === 'bm1').deleted = false; });
sv = saveAs(H.admin, d => { d.bankMoves.find(b => b.id === 'bm1').deleted = true; });
t('explicit soft delete still works', sv.ok && readDB().bankMoves.find(b => b.id === 'bm1').deleted === true, sv);
sv = saveAs(H.admin, d => { d.bankMoves = d.bankMoves.filter(b => b.id !== 'bm1'); });
t('purging a deleted row (omission) allowed', sv.ok && !readDB().bankMoves.some(b => b.id === 'bm1'), sv);
// LOG-01: הזרקת נוסחה ליומן דרך שם משתמש
reset();
get('action=requestReset&user=' + encodeURIComponent('=HYPERLINK("https://evil","x")'));
const lg = (book.getSheetByName('_seclog') || { rows: [] }).rows.find(r => r[1] === 'reset-unknown-user');
t('LOG-01 formula in seclog neutralised', !!lg && String(lg[3]).charAt(0) === "'", lg);
// REG-05: מיגרציה לא מייצרת התראת "החלפת קוד"
reset();
sv = saveAs(H.admin, d => { d.expenses[0].note = 'first save after deploy'; });
t('REG-05 no false users-changed alert on code migration', sv.ok && !mails.some(m => /שינוי במשתמשים/.test(m.subject)) && /^v2:/.test(readDB().users[0].code), mails.map(m => m.subject));
// LOG-02: שני שינויים שונים במשתמשים בתוך 10 דקות — שני מיילים
sv = saveAs(H.admin, d => { d.users[1].allowedApartments = ['a1', 'a2']; });
sv = saveAs(H.admin, d => { d.users[2].role = 'admin'; });
t('LOG-02 distinct user changes both mailed', mails.filter(m => /שינוי במשתמשים/.test(m.subject)).length === 2, mails.map(m => m.subject));
// LOG-04: שמירה מוצלחת נרשמת
t('LOG-04 successful saves logged', (book.getSheetByName('_seclog') || { rows: [] }).rows.filter(r => r[1] === 'save').length >= 3);
// REG-06: שחזור למשתמש בלי מייל — הבעלים מקבל מייל
reset();
get('action=requestReset&user=' + encodeURIComponent('צופה'));
t('REG-06 owner alerted about reset request for user without email', mails.some(m => /ללא מייל/.test(m.subject)), mails.map(m => m.subject));


/* ======================= 12. סבב 3 — תקיפה חוזרת ======================= */
reset();
sv = saveAs(H.editor, d => { d.expenses.push({ id: 'constructor', apartmentId: 'a1', name: 'x', amount: 1, deleted: false }); });
t('R2-01 prototype-key id rejected', sv.error === 'bad-id', sv);
sv = saveAs(H.editor, d => { d.expenses.push({ id: '__proto__', apartmentId: 'a1', name: 'x', amount: 1, deleted: false }); });
t('R2-01 __proto__ id rejected', sv.error === 'bad-id', sv);
t('R2-01 loads still work after attempts', post({ action: 'load', codeHash: H.editor }).ok && post({ action: 'load', codeHash: H.viewer }).ok);
sv = saveAs(H.editor, d => { d.expenses.push(null); d.expenses[0].note = 'null row'; });
t('null row filtered, save ok, loads ok', sv.ok && readDB().expenses.every(e => e && typeof e === 'object') && post({ action: 'load', codeHash: H.viewer }).ok, sv);
sv = saveAs(H.editor, d => { d.apartments[0].splitPresets = [{ id: 'sp"><img src=x onerror=1>', name: 'p', rows: [] }]; });
t('R2-INJ-NEST-01 nested splitPresets id rejected', sv.error === 'bad-id' && /splitPresets/.test(sv.detail), sv);
sv = saveAs(H.editor, d => { d.apartments[0].reviews = [{ id: "rv');alert(1);('", note: 'n' }]; });
t('R2-INJ-NEST-02 nested reviews id rejected', sv.error === 'bad-id' && /reviews/.test(sv.detail), sv);
sv = saveAs(H.editor, d => { d.income[0].split = [{ partnerId: 'p1" onfocus="x', percent: 100 }]; });
t('R2-INJ-NEST-03 nested split partnerId rejected', sv.error === 'bad-id' && /split/.test(sv.detail), sv);
sv = saveAs(H.editor, d => { d.recurring.push({ id: 'rcS', apartmentIds: 'a2', amount: 1, deleted: false }); });
t('R2-09 apartmentIds not array rejected (not server-error)', sv.error === 'bad-id', sv);
sv = saveAs(H.editor, d => { d.apartments[0].splitPresets = [{ id: 'idgood1', name: 'p', rows: [] }]; d.apartments[0].reviews = [{ id: 'idgood2', note: 'ok' }]; });
t('valid nested ids accepted', sv.ok, sv);
// ערך לא תקין ישן שכבר במאגר — לא נועל שמירה
reset();
(function () { const d = readDB(); d.categories.push({ id: 'legacy&id', name: 'ישן', deleted: false }); writeDB(d); })();
sv = saveAs(H.admin, d => { d.expenses[0].note = 'with legacy id'; });
t('stored legacy bad id tolerated', sv.ok, sv);
sv = saveAs(H.admin, d => { d.categories.push({ id: 'new&id', name: 'חדש', deleted: false }); });
t('new bad id still rejected next to legacy one', sv.error === 'bad-id', sv);
// R2-02: התאמת בנק להכנסה זרה
reset();
sv = saveAs(H.editor, d => { d.bankMoves.find(b => b.id === 'bm2').matches = [{ id: 'mEVIL', incomeId: 'i2', amount: 7 }, { id: 'mOK', incomeId: 'i1', amount: 1 }]; });
let bm2 = readDB().bankMoves.find(b => b.id === 'bm2');
t('R2-02 match to foreign income dropped, own match kept', sv.ok && bm2.matches.map(m => m.id).join() === 'mOK' && sv.dropped.join().includes('bankMoves:bm2 match'), [sv.dropped, bm2.matches]);
reset();
sv = saveAs(H.admin, d => { d.bankMoves.push({ id: 'bmH', apartmentId: 'a1', amount: 30, deleted: false, matches: [{ id: 'x1', incomeId: 'i1', amount: 10 }, { id: 'x2', incomeId: 'i2', amount: 20 }] }); });
sv = saveAs(H.editor, d => { d.bankMoves.find(b => b.id === 'bmH').matches.push({ id: 'x2', incomeId: 'i1', amount: 999 }); });
const bmH = readDB().bankMoves.find(b => b.id === 'bmH');
t('R2-02 hidden foreign match cannot be replaced by id', bmH.matches.find(m => m.id === 'x2').incomeId === 'i2' && bmH.matches.find(m => m.id === 'x2').amount === 20, bmH.matches);
// R2-03: הפניה מקוננת לשותף זר
reset();
sv = saveAs(H.editor, d => { d.income[0].payments = [{ id: 'g1', amount: 10, receivedBy: 'p2' }]; });
t('R2-03 nested payments receivedBy foreign partner dropped', sv.ok && sv.dropped.join().includes('income:i1 partner') && !(readDB().income.find(i => i.id === 'i1').payments || []).length, sv);
sv = saveAs(H.editor, d => { d.income[0].split = [{ partnerId: 'p2', percent: 100 }]; });
t('R2-03 nested split foreign partner dropped', sv.ok && sv.dropped.join().includes('income:i1 partner'), sv);
// R2-08/REG2-02: הפניה שלא השתנתה מותרת
reset();
sv = saveAs(H.admin, d => { d.accounts.push({ id: 'accG', apartmentId: '', partnerId: 'p2', name: 'כללי', deleted: false }); });
sv = saveAs(H.editor, d => { d.accounts.find(a => a.id === 'accG').name = 'כללי (שונה)'; });
t('R2-08/CG-01 editor rename of global account: kept, reported', sv.ok && sv.dropped.join() === 'accounts:accG shared' && readDB().accounts.find(a => a.id === 'accG').name === 'כללי', sv);
sv = saveAs(H.editor, d => { d.expenses[0].note = 'unrelated'; });
t('REG2-02 unrelated save has no dropped noise', sv.ok && !sv.dropped.length, sv);
// R2-07: שותף משותף לפרוייקט זר
reset();
sv = saveAs(H.admin, d => { d.apartmentPartners.push({ id: 'apS', apartmentId: 'a2', partnerId: 'p1', pct: 10, deleted: false }); });
sv = saveAs(H.editor, d => { const p = d.partners.find(x => x.id === 'p1'); p.deleted = true; p.phone = '000'; });
const p1 = readDB().partners.find(x => x.id === 'p1');
t('R2-07 shared partner: delete blocked, field edit kept', sv.ok && p1.deleted === false && p1.phone === '000' && sv.dropped.join().includes('partners:p1 shared'), [sv.dropped, p1]);
// R2-06: ילדים של הוצאה שנפלה
reset();
sv = saveAs(H.editor, d => { d.expenses.push({ id: 'eOrph', apartmentId: 'a1', partnerId: 'p2', name: 'x', amount: 1, deleted: false }); d.payments.push({ id: 'pOrph', expenseId: 'eOrph', amount: 1, deleted: false }); });
t('R2-06 children of dropped expense dropped too', sv.ok && !readDB().expenses.some(e => e.id === 'eOrph') && !readDB().payments.some(p => p.id === 'pOrph'), sv);
// R2-05: מפתחות לא מוכרים ו-meta
reset();
(function () { const d = readDB(); d.secretNotes = [{ id: 'sn1', apartmentId: 'a2', text: 'סוד' }]; writeDB(d); })();
const ldX = post({ action: 'load', codeHash: H.editor }).data;
t('R2-05 unknown table not sent to non-admin', !('secretNotes' in ldX), Object.keys(ldX));
sv = saveAs(H.editor, d => { d.planted = { x: 1 }; d.secretNotes = []; d.meta.version = 77; });
const stX = readDB();
t('R2-05 non-admin cannot plant/overwrite unknown keys or meta', sv.ok && !('planted' in stX) && stX.secretNotes.length === 1 && stX.meta.version === 1, [Object.keys(stX), stX.meta]);
// REG2-01/R2-04: ביטול יצירה
reset();
sv = saveAs(H.admin, d => { d.expenses.push({ id: 'eUndo', apartmentId: 'a1', name: 'נוצר', amount: 1, deleted: false }); });
sv = saveAs(H.admin, d => { d.expenses = d.expenses.filter(e => e.id !== 'eUndo'); });
const eU = readDB().expenses.find(e => e.id === 'eUndo');
t('REG2-01 undo of create: row ends soft-deleted, no restored-tables reload', sv.ok && !sv.restoredTables.length && eU && eU.deleted === true, [sv, eU]);
// השמטה המונית עדיין נחסמת
reset();
(function () { const d = readDB(); for (let i = 0; i < 10; i++) d.bankMoves.push({ id: 'bmM' + i, apartmentId: 'a1', amount: i, deleted: false }); writeDB(d); })();
sv = saveAs(H.admin, d => { d.bankMoves = []; });
t('mass omission still restored', sv.ok && readDB().bankMoves.filter(b => !b.deleted).length >= 10, sv);
sv = saveAs(H.admin, d => { d.bankMoves = d.bankMoves.slice(0, 1); });
t('mass omission (90%) restored as live rows + owner alerted', sv.ok && readDB().bankMoves.filter(b => !b.deleted).length >= 10 && mails.some(m => /ניסתה למחוק/.test(m.subject)), [sv, mails.map(m => m.subject)]);
// REG2-03: פלפל חסר
reset();
sv = saveAs(H.admin, d => { d.expenses[0].note = 'migrate'; });
delete props.crm_pepper;
const lp = post({ action: 'login', codeHash: H.admin });
t('REG2-03 missing pepper: server-error (no silent new pepper), owner alerted', lp.error === 'server-error' && !props.crm_pepper && mails.some(m => /מפתח האבטחה/.test(m.subject)), [lp, mails.map(m => m.subject)]);
t('REG2-03 poll gets server-error (client does not log out)', post({ action: 'rev', codeHash: H.editor }).error === 'server-error');
const rr = post({ action: 'requestReset', user: 'דודי' });
const rcode = ((mails.filter(m => /קוד שחזור/.test(m.subject)).pop() || {}).body || '').match(/(\d{6})/);
const rv = post({ action: 'verifyReset', code: rcode && rcode[1] });
const rs = post({ action: 'setCode', resetToken: rv.resetToken, codeHash: sha('after-pepper-loss') });
t('REG2-03 recovery via e-mail reset works (POST routes)', rr.ok && rv.ok && rs.ok && post({ action: 'login', codeHash: sha('after-pepper-loss') }).ok, [rr, rv, rs]);
// A10-04: מונה שחזור פגום — לא פותח את השער
reset();
props.crm_reset_reqs = '{bad json';
for (let i = 0; i < 8; i++) get('action=requestReset&user=' + encodeURIComponent('דודי'));
t('A10-04 corrupt reset counter repaired, gate holds', mails.filter(m => /קוד שחזור/.test(m.subject)).length <= 4, mails.length);


// R5: קוד ישן "plain:" ממשיך לעבוד (הדפדפן שולח SHA-256 של הקוד) ומומר
reset();
(function () { const d = readDB(); d.users[2].code = 'plain:viewer-old'; writeDB(d); })();
t('legacy plain: code logs in with client SHA-256', post({ action: 'login', codeHash: sha('viewer-old') }).ok);
t('raw plain: credential is not accepted', !post({ action: 'login', codeHash: 'plain:viewer-old' }).ok);
sv = saveAs(H.admin, d => { d.expenses[0].note = 'migrate plain'; });
t('legacy plain: code migrated to v2 and still works', /^v2:/.test(readDB().users[2].code) && post({ action: 'login', codeHash: sha('viewer-old') }).ok);
// R8: מסד לא קריא — storage-error, לא unauthorized
reset();
book.sheets = book.sheets.filter(s => !/^_data|^_bak_/.test(s.name));
const sl = post({ action: 'load', codeHash: H.editor });
t('R8 unreadable DB -> storage-error (client does not log out)', sl.error === 'storage-error', sl);
// P3c: split כאובייקט עם שותף זר
reset();
sv = saveAs(H.editor, d => { d.income[0].split = { p2: 100 }; });
t('P3c object-shaped split with foreign partner dropped', sv.ok && sv.dropped.join().includes('income:i1 partner'), sv);


/* ======================= 13. סבב 4 — בדיקת הרשאות לפי תפקיד ======================= */
reset();
(function () {
  const d = readDB();
  d.expenses.push({ id: 'eP', apartmentId: 'a1', name: 'מכל', amount: 105, deleted: false });
  d.expenses.push({ id: 'eK1', apartmentId: 'a1', name: 'גלוי', amount: 100, parentId: 'eP', deleted: false });
  d.expenses.push({ id: 'eK2', apartmentId: 'a1', name: 'מוסתר', amount: 5, parentId: 'eP', hidden: true, deleted: false });
  d.expenses.push({ id: 'eHP', apartmentId: 'a1', name: 'אב מוסתר', amount: 500, hidden: true, deleted: false });
  d.expenses.push({ id: 'eHC', apartmentId: 'a1', name: 'ילד של מוסתר', amount: 500, parentId: 'eHP', deleted: false });
  d.payments.push({ id: 'pyHC', expenseId: 'eHC', amount: 500, deleted: false });
  d.expenses.push({ id: 'eDel', apartmentId: 'a1', name: 'נמחקה', amount: 9, deleted: true, deletedByUser: 'דודי', deletedAt: '2026-09-01' });
  d.partners[0].phone = '050-1111111'; d.partners[0].note = 'הערה';
  d.recurring.push({ id: 'rcOwn', apartmentIds: ['a1'], amount: 3, deleted: false });
  d.accounts.push({ id: 'accG', apartmentId: '', partnerId: 'p2', name: 'כללי', deleted: false });
  d.categories.push({ id: 'cX', name: 'של חנקין בלבד', deleted: false });
  d.stmtBanks.push({ id: 'sb2', name: 'בנק של חנקין', deleted: false });
  d.bankMoves.find(b => b.id === 'bm2').stmtBankId = 'sb1';
  d.settings.futureAdminOnly = { secret: 1 }; d.settings.currency = '₪'; d.settings.paymentMethods = { x: 'ביט' };
  writeDB(d);
})();
let LV = post({ action: 'load', codeHash: H.viewer }).data;
t('V-01 viewer: no unassigned bank lines / withdrawals', LV.bankMoves.length === 0 && LV.withdrawals.length === 0 && LV.incMgmtPays.length === 0, LV.bankMoves);
t('V-02/MGMT-01 viewer: children of hidden stage hidden, with their payments', !LV.expenses.some(e => e.id === 'eHC') && !LV.payments.some(p => p.id === 'pyHC'));
t('V-03 viewer: container amount = visible children only', LV.expenses.find(e => e.id === 'eP').amount === 100, LV.expenses.find(e => e.id === 'eP'));
t('V-04 viewer: no recycle-bin rows', !LV.expenses.some(e => e.deleted));
t('V-05 viewer: partner name only, no phone/notes', LV.partners.length === 1 && LV.partners[0].name && !('phone' in LV.partners[0]) && !('note' in LV.partners[0]), LV.partners);
t('V-06 viewer: no recurring, no unused banks/accounts/categories', LV.recurring.length === 0 && LV.stmtBanks.length === 0 && !LV.accounts.some(a => a.id === 'accG') && !LV.categories.some(c => c.id === 'cX'), [LV.stmtBanks, LV.accounts.map(a => a.id), LV.categories.map(c => c.id)]);
t('V-07 settings allowlist for non-admin', JSON.stringify(Object.keys(LV.settings).sort()) === JSON.stringify(['currency', 'paymentMethods']), LV.settings);
let LE = post({ action: 'load', codeHash: H.editor }).data;
t('editor keeps what its screens need (unassigned lines, recycle bin, partner phone, rules)', LE.bankMoves.some(b => b.id === 'bm2') && LE.expenses.some(e => e.id === 'eDel') && LE.partners[0].phone === '050-1111111' && LE.recurring.some(r => r.id === 'rcOwn'));
t('editor: hidden-stage children hidden too', !LE.expenses.some(e => e.id === 'eHC') && !LE.payments.some(p => p.id === 'pyHC'));
t('editor: settings allowlist', !('futureAdminOnly' in LE.settings));
let LM = post({ action: 'load', codeHash: H.mgmt }).data;
t('MGMT-02/03 mgmt: no project notes/splits, no supplier notes/links, no categories', LM.categories.length === 0 && LM.apartments.every(a => !('notes' in a) && !('splitPresets' in a)) && LM.expenses.every(e => !('note' in e) && !('invoiceLink' in e)) && LM.payments.every(p => !('accountId' in p)), [LM.apartments, LM.expenses]);
// כתיבה
sv = saveAs(H.editor, d => { d.expenses.find(e => e.id === 'eP').amount = 100; d.expenses[0].note = 'ok'; });
t('V-03/ED-08 editor save keeps stored container amount', sv.ok && readDB().expenses.find(e => e.id === 'eP').amount === 105 && readDB().expenses[0].note === 'ok', readDB().expenses.find(e => e.id === 'eP'));
sv = saveAs(H.editor, d => { d.expenses = d.expenses.filter(e => e.id !== 'eDel'); });
t('ED-02 editor cannot purge recycle-bin rows by omission', sv.ok && readDB().expenses.some(e => e.id === 'eDel' && e.deleted), sv);
sv = saveAs(H.admin, d => { d.expenses = d.expenses.filter(e => e.id !== 'eDel'); });
t('admin purge still possible, and logged', sv.ok && !readDB().expenses.some(e => e.id === 'eDel') && (book.getSheetByName('_seclog') || { rows: [] }).rows.some(r => r[1] === 'purged-rows'), sv);
sv = saveAs(H.editor, d => { d.categories.find(c => c.id === 'cX').name = 'PWNED'; d.stmtBanks.find(b => b.id === 'sb1').deleted = true; d.categories.push({ id: 'cNew', name: 'חדשה', deleted: false }); });
t('CG-02/03 editor: global categories/banks kept, new category allowed', sv.ok && readDB().categories.find(c => c.id === 'cX').name === 'של חנקין בלבד' && !readDB().stmtBanks.find(b => b.id === 'sb1').deleted && readDB().categories.some(c => c.id === 'cNew') && /categories:cX shared/.test(sv.dropped.join()), sv);
sv = saveAs(H.editor, d => { const g = d.accounts.find(a => a.id === 'accG'); g.apartmentId = 'a1'; });
t('CG-01 editor cannot take over a global account', readDB().accounts.find(a => a.id === 'accG').apartmentId === '', sv);
sv = saveAs(H.editor, d => { const b = d.bankMoves.find(x => x.id === 'bm2'); b.amount = 1; b.name = 'HACKED'; b.deleted = true; });
const bm2b = readDB().bankMoves.find(x => x.id === 'bm2');
t('ED-03 limited editor cannot alter/delete an unassigned bank line', bm2b.amount === 7 && bm2b.deleted === false && /bankline/.test(sv.dropped.join()), [sv.dropped, bm2b]);
sv = saveAs(H.editor, d => { d.bankMoves.find(x => x.id === 'bm2').apartmentId = 'a1'; });
t('ED-03 limited editor can still assign an unassigned line to own project', sv.ok && readDB().bankMoves.find(x => x.id === 'bm2').apartmentId === 'a1', sv);
sv = saveAs(H.editor, d => { d.expenses.push({ id: 'eNP', apartmentId: 'a1', name: 'x', amount: 1, parentId: 'e2', deleted: false }); });
t('ED-06 new expense under foreign/hidden parent dropped', !readDB().expenses.some(e => e.id === 'eNP') && /eNP parent/.test(sv.dropped.join()), sv);
sv = saveAs(H.editor, d => { d.expenses.push({ id: 'eNP2', apartmentId: 'a1', name: 'x', amount: 1, parentId: 'eP', deleted: false }); });
t('ED-06 new expense under own visible parent ok', sv.ok && readDB().expenses.some(e => e.id === 'eNP2'), sv);
// ED-07: עורך לא מוגבל מצמיד תשלום להוצאה מוסתרת
sv = saveAs(H.admin, d => { d.users[1].allowedApartments = []; });
sv = saveAs(H.editor, d => { d.payments.push({ id: 'pyU', expenseId: 'e2', amount: 1, deleted: false }); });
t('ED-07 unlimited editor cannot attach payment to hidden expense', !readDB().payments.some(p => p.id === 'pyU') && /pyU new/.test(sv.dropped.join()), sv);
// ED-09: ייחוס מחיקה ישן לא ניתן לזיוף
reset();
(function () { const d = readDB(); d.expenses.push({ id: 'eD2', apartmentId: 'a1', name: 'x', amount: 1, deleted: true, deletedByUser: 'דודי', deletedAt: '2026-09-01' }); writeDB(d); })();
sv = saveAs(H.editor, d => { const e = d.expenses.find(x => x.id === 'eD2'); e.deletedByUser = 'מישהו אחר'; e.deletedAt = '2020-01-01'; });
t('ED-09 deletedBy of already-deleted row cannot be forged', readDB().expenses.find(x => x.id === 'eD2').deletedByUser === 'דודי' && readDB().expenses.find(x => x.id === 'eD2').deletedAt === '2026-09-01');
// V-10: בקשת שחזור של אחר לא מבטלת קוד שבדרך
reset();
get('action=requestReset&user=' + encodeURIComponent('דודי'));
const adminCode = (mails.filter(m => /קוד שחזור/.test(m.subject)).pop().body.match(/(\d{6})/) || [])[1];
get('action=requestReset&user=' + encodeURIComponent('עורך'));
get('action=requestReset&user=' + encodeURIComponent('דודי'));
const resent = (mails.filter(m => /קוד שחזור/.test(m.subject)).pop().body.match(/(\d{6})/) || [])[1];
t('V-10 repeat request re-sends the same code', resent === adminCode, [adminCode, resent]);
const vA = get('action=verifyReset&code=' + adminCode);
t('V-10 admin code still valid after another user requested a reset', vA.ok, vA);
t('V-10 admin reset completes', post({ action: 'setCode', resetToken: vA.resetToken, codeHash: sha('admin-new-v10') }).ok && post({ action: 'login', codeHash: sha('admin-new-v10') }).ok);
for (let i = 0; i < 5; i++) get('action=requestReset&user=' + encodeURIComponent('לא קיים ' + i));
get('action=requestReset&user=' + encodeURIComponent('עורך'));
t('V-10 requests for other names do not exhaust a user budget', mails.filter(m => /קוד שחזור/.test(m.subject)).length >= 3);
// MGMT-09: "קוד תפוס" שוב ושוב שורף את האסימון
reset();
get('action=requestReset&user=' + encodeURIComponent('עורך'));
const ec = (mails.filter(m => /קוד שחזור/.test(m.subject)).pop().body.match(/(\d{6})/) || [])[1];
const vt = get('action=verifyReset&code=' + ec);
const taken = [1, 2, 3].map(() => post({ action: 'setCode', resetToken: vt.resetToken, codeHash: H.admin }).error);
t('MGMT-09 code-taken probes burn the token after 3', taken.join() === 'code-taken,code-taken,too-many' && post({ action: 'setCode', resetToken: vt.resetToken, codeHash: sha('free') }).ok === false, taken);
// V-11: מי שנכנס בעבר לא ננעל בחסימה הכללית
reset();
post({ action: 'login', codeHash: H.admin });
for (let i = 0; i < 60; i++) post({ action: 'login', codeHash: sha('scan' + i) });
t('V-11 known user passes global block', post({ action: 'login', codeHash: H.admin }).ok);
t('V-11 never-logged-in user still blocked during global block', post({ action: 'login', codeHash: H.viewer }).error === 'too-many');


/* ======================= 14. סבב 5 — אחרי בדיקת התקיפה של סבב 4 ======================= */
// RB-01: מכל שנמחק עם תת-שלב מוסתר
reset();
(function () {
  const d = readDB();
  d.expenses.push({ id: 'eC', apartmentId: 'a1', name: 'מכל', amount: 800, deleted: true, deletedBy: 'manual' });
  d.expenses.push({ id: 'eCV', apartmentId: 'a1', name: 'גלוי', amount: 100, parentId: 'eC', deleted: true, deletedBy: 'expense:eC' });
  d.expenses.push({ id: 'eCH', apartmentId: 'a1', name: 'מוסתר', amount: 700, parentId: 'eC', hidden: true, deleted: true, deletedBy: 'expense:eC' });
  writeDB(d);
})();
let L5 = post({ action: 'load', codeHash: H.editor }).data;
t('RB-01 deleted container shows visible-children amount only', L5.expenses.find(e => e.id === 'eC').amount === 100, L5.expenses.find(e => e.id === 'eC'));
// RB-02: סבא של שלב מוסתר
reset();
(function () {
  const d = readDB();
  d.expenses.push({ id: 'eG', apartmentId: 'a1', name: 'סבא', amount: 850, deleted: false });
  d.expenses.push({ id: 'eP2', apartmentId: 'a1', name: 'אב', amount: 800, parentId: 'eG', deleted: false });
  d.expenses.push({ id: 'eV2', apartmentId: 'a1', name: 'גלוי', amount: 100, parentId: 'eP2', deleted: false });
  d.expenses.push({ id: 'eH2', apartmentId: 'a1', name: 'מוסתר', amount: 700, parentId: 'eP2', hidden: true, deleted: false });
  d.expenses.push({ id: 'eS2', apartmentId: 'a1', name: 'אח', amount: 50, parentId: 'eG', deleted: false });
  writeDB(d);
})();
L5 = post({ action: 'load', codeHash: H.viewer }).data;
t('RB-02 every ancestor of a hidden stage rewritten', L5.expenses.find(e => e.id === 'eP2').amount === 100 && L5.expenses.find(e => e.id === 'eG').amount === 150, [L5.expenses.find(e => e.id === 'eP2').amount, L5.expenses.find(e => e.id === 'eG').amount]);
reset();
(function () { const d = readDB(); d.expenses.push({ id: 'eTop', apartmentId: 'a1', name: 'אב', amount: 1, deleted: false }); d.expenses.push({ id: 'eMid', apartmentId: 'a1', name: 'תת', amount: 1, parentId: 'eTop', deleted: false }); writeDB(d); })();
sv = saveAs(H.editor, d => { d.expenses.push({ id: 'eLow', apartmentId: 'a1', name: 'נכד', amount: 1, parentId: 'eMid', deleted: false }); });
t('RB-02 one nesting level only (new grandchild dropped)', !readDB().expenses.some(e => e.id === 'eLow') && /eLow parent/.test(sv.dropped.join()), sv);
sv = saveAs(H.editor, d => { d.expenses.find(e => e.id === 'eTop').parentId = 'e1'; });
t('RB-02 a stage with children cannot get a parent', readDB().expenses.find(e => e.id === 'eTop').parentId === undefined && /eTop parent/.test(sv.dropped.join()), sv);
// RB-04/05 + R4-REG-01
reset();
(function () {
  const d = readDB();
  d.apartments[0].note = 'הערה מייבוא'; d.apartments[0].reviews = [{ id: 'rv1', note: 'ok' }, { id: 'rv2', note: 'נמחקה', deleted: true }];
  d.income[0].payments = [{ id: 'g1', amount: 10 }, { id: 'g2', amount: 4321, deleted: true, receivedBy: 'bank:accSecret' }];
  d.accounts.push({ id: 'accSecret', apartmentId: '', name: 'חשבון פרטי', deleted: false });
  d.accounts.push({ id: 'accOld', apartmentId: 'a1', name: 'חשבון שנמחק', isBank: true, deleted: true });
  d.withdrawals.push({ id: 'wOld', apartmentId: 'a1', amount: 50, accountId: 'accOld', deleted: false });
  d.managers.push({ id: 'mOld', apartmentId: 'a1', name: 'מנהל לשעבר', deleted: true });
  d.payments.push({ id: 'pyM', expenseId: 'e1', amount: 5, recipientType: 'manager', recipientManagerId: 'mOld', deleted: false });
  d.apartments.push({ id: 'aD', name: 'פרוייקט שנמחק', deleted: true });
  d.users[2].allowedApartments = ['a1', 'aD'];
  d.bankMoves.push({ id: 'bmD', apartmentId: 'aD', amount: 9999, deleted: false });
  writeDB(d);
})();
L5 = post({ action: 'load', codeHash: H.mgmt }).data;
t('RB-04 mgmt does not get project note', L5.apartments.every(a => !('note' in a)), L5.apartments);
L5 = post({ action: 'load', codeHash: H.viewer }).data;
t('RB-05 viewer: no deleted nested entries', L5.apartments[0].reviews.length === 1 && L5.income[0].payments.length === 1, [L5.apartments[0].reviews, L5.income[0].payments]);
t('RB-05 viewer: account used only by a deleted nested entry not sent', !L5.accounts.some(a => a.id === 'accSecret'));
t('R4-REG-01 viewer keeps deleted account / manager still referenced', L5.accounts.some(a => a.id === 'accOld') && L5.managers.some(m => m.id === 'mOld'), [L5.accounts.map(a => a.id), L5.managers.map(m => m.id)]);
t('RB-03 viewer: rows of a deleted project not sent', !L5.bankMoves.some(b => b.id === 'bmD'), L5.bankMoves);
// WB-01 / R4-BYP-01: השמטה של שורות מוגנות
reset();
(function () { const d = readDB(); d.recurring.push({ id: 'rcS', apartmentIds: ['a1', 'a2'], amount: 1, deleted: false }); writeDB(d); })();
sv = saveAs(H.editor, d => {
  d.categories = d.categories.filter(c => c.id !== 'c1');
  d.stmtBanks = d.stmtBanks.filter(b => b.id !== 'sb1');
  d.bankMoves = d.bankMoves.filter(b => b.id !== 'bm2');
  d.recurring = d.recurring.filter(r => r.id !== 'rcS');
});
const S5 = readDB();
t('WB-01 omitting protected rows does not delete them', !S5.categories.find(c => c.id === 'c1').deleted && !S5.stmtBanks.find(b => b.id === 'sb1').deleted && !S5.bankMoves.find(b => b.id === 'bm2').deleted && !S5.recurring.find(r => r.id === 'rcS').deleted && sv.dropped.length === 4, sv);
// mass delete cannot be hidden by new rows
reset();
(function () { const d = readDB(); for (let i = 0; i < 10; i++) d.withdrawals.push({ id: 'wm' + i, apartmentId: 'a1', amount: i, deleted: false }); writeDB(d); })();
sv = saveAs(H.admin, d => { d.withdrawals.forEach(w => { if (/^wm/.test(w.id)) w.deleted = true; }); for (let i = 0; i < 10; i++) d.withdrawals.push({ id: 'wn' + i, apartmentId: 'a1', amount: i, deleted: false }); });
t('mass delete not masked by new rows', readDB().withdrawals.filter(w => /^wm/.test(w.id) && !w.deleted).length === 10, sv);
// WB-02: שיוך → עריכה → ביטול שיוך
reset();
sv = saveAs(H.admin, d => { d.expenses[0].note = 'stamp pool'; });
t('pool stamped on unassigned lines at save', readDB().bankMoves.find(b => b.id === 'bm2').pool === true);
reset();
const s1 = saveAs(H.editor, d => { d.bankMoves.find(b => b.id === 'bm2').apartmentId = 'a1'; });
const s2 = saveAs(H.editor, d => { const b = d.bankMoves.find(x => x.id === 'bm2'); b.amount = 1; b.name = 'HACKED'; b.deleted = true; });
const s3 = saveAs(H.editor, d => { d.bankMoves.find(b => b.id === 'bm2').apartmentId = ''; });
const b5 = readDB().bankMoves.find(b => b.id === 'bm2');
t('WB-02 assign-edit-unassign cannot rewrite a pool line', s1.ok && b5.amount === 7 && !b5.deleted && b5.apartmentId === 'a1' && b5.pool === true && /bankline/.test(s2.dropped.join()) && /bankline/.test(s3.dropped.join()), [b5, s2.dropped, s3.dropped]);
// R4-REG-02 / AR-03: אחרי "קוד תפוס" — הלקוח ממשיך עם האסימון; בקשה חדשה שולחת מייל
reset();
get('action=requestReset&user=' + encodeURIComponent('עורך'));
let c5 = (mails.filter(m => /קוד שחזור/.test(m.subject)).pop().body.match(/(\d{6})/) || [])[1];
let v5 = get('action=verifyReset&code=' + c5);
let st5 = post({ action: 'setCode', resetToken: v5.resetToken, codeHash: H.admin });
t('code-taken then retry with same token works', st5.error === 'code-taken' && post({ action: 'setCode', resetToken: v5.resetToken, codeHash: sha('editor-free-1') }).ok);
reset();
get('action=requestReset&user=' + encodeURIComponent('עורך'));
c5 = (mails.filter(m => /קוד שחזור/.test(m.subject)).pop().body.match(/(\d{6})/) || [])[1];
v5 = get('action=verifyReset&code=' + c5);
const mBefore = mails.filter(m => /קוד שחזור/.test(m.subject)).length;
get('action=requestReset&user=' + encodeURIComponent('עורך'));
t('R4-REG-02 new request after a verified token mails a fresh code', mails.filter(m => /קוד שחזור/.test(m.subject)).length === mBefore + 1);
// R4-REG-05: קוד שפג — "expired" ולא נספר
reset();
get('action=requestReset&user=' + encodeURIComponent('עורך'));
c5 = (mails.filter(m => /קוד שחזור/.test(m.subject)).pop().body.match(/(\d{6})/) || [])[1];
(function () { const sh = book.getSheetByName('_reset'); sh.rows[0][1] = Date.now() - 1000; })();
t('R4-REG-05 expired code reported as expired', get('action=verifyReset&code=' + c5).error === 'expired' && !props.crm_reset_bad);
// AR-01: מכסת ניחושים לא מתאפסת בשריפה
reset();
for (let i = 0; i < 8; i++) get('action=verifyReset&code=00000' + i);
get('action=requestReset&user=' + encodeURIComponent('דודי'));
c5 = (mails.filter(m => /קוד שחזור/.test(m.subject)).pop().body.match(/(\d{6})/) || [])[1];
t('AR-01 after the guess cap even the right code waits for the window', get('action=verifyReset&code=' + c5).error === 'too-many');
// AR-02: משתמש שהושבת לא חוזר דרך שחזור
reset();
get('action=requestReset&user=' + encodeURIComponent('עורך'));
c5 = (mails.filter(m => /קוד שחזור/.test(m.subject)).pop().body.match(/(\d{6})/) || [])[1];
v5 = get('action=verifyReset&code=' + c5);
sv = saveAs(H.admin, d => { d.users[1].active = false; });
const st6 = post({ action: 'setCode', resetToken: v5.resetToken, codeHash: sha('back-door') });
t('AR-02 deactivated user cannot finish a pending reset', !st6.ok && !post({ action: 'login', codeHash: sha('back-door') }).ok && readDB().users[1].active === false, st6);
// AR-05: קוד שנקבע בשחזור עובר חסימה כללית
reset();
get('action=requestReset&user=' + encodeURIComponent('דודי'));
c5 = (mails.filter(m => /קוד שחזור/.test(m.subject)).pop().body.match(/(\d{6})/) || [])[1];
v5 = get('action=verifyReset&code=' + c5);
post({ action: 'setCode', resetToken: v5.resetToken, codeHash: sha('new-after-reset') });
for (let i = 0; i < 60; i++) post({ action: 'login', codeHash: sha('scan2-' + i) });
t('AR-05 code set via e-mail reset passes the global block', post({ action: 'login', codeHash: sha('new-after-reset') }).ok);
// AR-06: תשובה אחידה כשאין חלון פתוח
reset();
t('AR-06 verify with no pending reset answers bad-code (no user enumeration)', get('action=verifyReset&code=123456').error === 'bad-code');

/* ======================= קטגוריית הכנסה — מנהלים בלבד ======================= */
reset();
sv = saveAs(H.admin, d => { const i = d.income.find(x => x.id === 'i1'); i.cat = 'משכורת'; i.subCat = 'חודשית'; });
t('IC-01 admin sets income category', sv.ok && readDB().income.find(i => i.id === 'i1').cat === 'משכורת', sv);
t('IC-02 admin load includes income category', post({ action: 'load', codeHash: H.admin }).data.income.find(i => i.id === 'i1').subCat === 'חודשית');
const ldIC = post({ action: 'load', codeHash: H.editor }).data;
t('IC-03 editor load: income category sent (open to editors, 06/10)', ldIC.income.some(i => i.cat === 'משכורת' && i.subCat === 'חודשית'), ldIC.income);
sv = saveAs(H.editor, d => { d.income.find(i => i.id === 'i1').amount = 11; });
const i1IC = readDB().income.find(i => i.id === 'i1');
t('IC-04 editor save keeps stored income category', sv.ok && i1IC.amount === 11 && i1IC.cat === 'משכורת' && i1IC.subCat === 'חודשית', i1IC);
sv = saveAs(H.editor, d => { d.income.find(i => i.id === 'i1').cat = 'זיוף'; d.income.push({ id: 'iC', apartmentId: 'a1', amount: 1, cat: 'חדש', deleted: false }); });
const dbIC = readDB();
t('IC-05 editor can set and add income category', sv.ok && dbIC.income.find(i => i.id === 'i1').cat === 'זיוף' && dbIC.income.find(i => i.id === 'iC').cat === 'חדש', dbIC.income);
t('IC-06 viewer load: income category not sent', !post({ action: 'load', codeHash: H.viewer }).data.income.some(i => 'cat' in i));

console.log(R.join('\n'));
console.log('\n' + (fails ? fails + ' FAILED' : 'ALL PASSED') + ' / ' + R.length);
process.exit(fails ? 1 : 0);
