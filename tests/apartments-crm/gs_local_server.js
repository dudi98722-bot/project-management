// שרת מקומי שמריץ את סקריפט השרת המוקשח (Apps Script) בתוך node עם חיקוי של
// Google Sheets בזיכרון — כדי לבדוק את האפליקציה האמיתית מקצה לקצה בלי לגעת בייצור.
// GET /exec?action=...  → doGet ;  POST /exec → doPost ;  /state /mails /seclog /log לבדיקה
const fs = require('fs'), vm = require('vm'), crypto = require('crypto'), http = require('http');
const src = fs.readFileSync(process.argv[2] || 'apartments-crm-AppsScript.gs', 'utf8');
function mkSheet(name) {
  return { name, rows: [], hidden: false,
    getName() { return this.name; }, setName(n) { this.name = n; return this; }, hideSheet() { this.hidden = true; },
    clear() { this.rows = []; return this; }, getLastRow() { return this.rows.length; },
    appendRow(r) { this.rows.push(r.slice()); return this; }, deleteRows(s, n) { this.rows.splice(s - 1, n); },
    getRange(r, c, nr, nc) { const s = this; nr = nr || 1; nc = nc || 1;
      return { setValues(v) { for (let i = 0; i < v.length; i++) { s.rows[r - 1 + i] = s.rows[r - 1 + i] || []; for (let j = 0; j < v[i].length; j++) s.rows[r - 1 + i][c - 1 + j] = v[i][j]; } },
        getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = (s.rows[r - 1 + i] || [])[c - 1 + j]; row.push(v === undefined ? '' : v); } out.push(row); } return out; },
        setValue(v) { s.rows[r - 1] = s.rows[r - 1] || []; s.rows[r - 1][c - 1] = v; },
        getValue() { const v = (s.rows[r - 1] || [])[c - 1]; return v === undefined ? '' : v; },
        setNumberFormat() { return this; }, setFontWeight() { return this; }, setBackground() { return this; } }; },
    setFrozenRows() {}, autoResizeColumns() {}, setColumnWidth() {}, getMaxRows() { return this.rows.length; } };
}
const book = { sheets: [], getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; },
  insertSheet(n) { const s = mkSheet(n); this.sheets.push(s); return s; }, getSheets() { return this.sheets.slice(); },
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }, getId() { return 'SS1'; } };
const props = {}, mails = [];
const sgn = b => b > 127 ? b - 256 : b;
const ctx = { console,
  SpreadsheetApp: { getActiveSpreadsheet: () => book, flush() {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, tryLock() { return true; }, releaseLock() {} }) },
  Utilities: { sleep() {}, getUuid: () => crypto.randomUUID(), formatDate: () => '20260929',
    base64Decode: s => Array.from(Buffer.from(s, 'base64')), newBlob: (b, m, n) => ({ bytes: b, mime: m, name: n }),
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (a, s) => Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest()).map(sgn),
    computeHmacSha256Signature: (s, k) => Array.from(crypto.createHmac('sha256', String(k)).update(String(s), 'utf8').digest()).map(sgn) },
  MailApp: { sendEmail(to, subject, body) { mails.push({ to, subject, body }); console.log('MAIL:', subject); } },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput(t) { return { t, setMimeType() { return this.t; } }; } },
  DriveApp: { getRootFolder: () => ({ getId: () => 'root' }), getFolderById() { throw new Error('no drive'); }, getFileById() { throw new Error('no drive'); } },
  Logger: { log() {} } };
vm.createContext(ctx); vm.runInContext(src, ctx);
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
/* קודים לבדיקה: מנהל 123456 · עורך מוגבל לפרוייקט הראשון editor1 · צופה viewer1 */
const seed = { meta: { version: 1, rev: 3 },
  users: [{ id: 'u1', name: 'דודי', code: sha('123456'), role: 'admin', allowedApartments: [], partnerId: null, active: true, deleted: false, email: 'x@y.z' },
          { id: 'u2', name: 'עורך', code: sha('editor1'), role: 'editor', allowedApartments: ['a1'], partnerId: null, active: true, deleted: false },
          { id: 'u3', name: 'צופה', code: sha('viewer1'), role: 'viewer', allowedApartments: ['a1'], partnerId: null, active: true, deleted: false }],
  apartments: [{ id: 'a1', name: 'יוספטל 5', deleted: false }, { id: 'a2', name: 'חנקין 8', deleted: false }],
  partners: [{ id: 'p1', name: 'שותף א', phone: '050', deleted: false }, { id: 'p2', name: 'שותף ב', phone: '052', deleted: false }],
  apartmentPartners: [{ id: 'ap1', apartmentId: 'a1', partnerId: 'p1', pct: 100, deleted: false }, { id: 'ap2', apartmentId: 'a2', partnerId: 'p2', pct: 100, deleted: false }],
  managers: [], accounts: [], deposits: [], income: [{ id: 'i1', apartmentId: 'a1', amount: 1000, date: '2026-01-01', deleted: false }, { id: 'i2', apartmentId: 'a2', amount: 2000, date: '2026-01-01', deleted: false }],
  categories: [{ id: 'c1', name: 'כללי', deleted: false }],
  expenses: [{ id: 'e1', apartmentId: 'a1', name: 'ריצוף', amount: 100, date: '2026-01-02', deleted: false },
             { id: 'e2', apartmentId: 'a2', name: 'חשמל', amount: 200, date: '2026-01-02', deleted: false }],
  expenseSplits: [], expenseManagerFees: [], payments: [],
  bankMoves: [{ id: 'bm1', apartmentId: 'a2', amount: 5000, desc: 'בנק חנקין', date: '2026-01-03', deleted: false }],
  stmtBanks: [], withdrawals: [], incMgmtPays: [], recurring: [], rentals: [], sheets: [], settings: {} };
(function writeDB(d) { const s = book.insertSheet('_data'); const str = JSON.stringify(d); const CH = 40000; const rows = []; for (let i = 0; i < str.length; i += CH) rows.push([str.substr(i, CH)]); s.getRange(1, 1, rows.length, 1).setValues(rows); ctx.rememberMeta(d); props.crm_initialized = '1'; })(seed);
const LOG = [];
function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
  res.end(body);
}
http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 200, '{}');
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/state') return send(res, 200, JSON.stringify({ db: ctx.loadData(), props }, null, 1));
    if (url.pathname === '/mails') return send(res, 200, JSON.stringify(mails, null, 1));
    if (url.pathname === '/seclog') return send(res, 200, JSON.stringify((book.getSheetByName('_seclog') || { rows: [] }).rows, null, 1));
    if (url.pathname === '/log') return send(res, 200, JSON.stringify(LOG, null, 1));
    let out;
    try {
      if (req.method === 'GET') { const p = {}; url.searchParams.forEach((v, k) => p[k] = v); out = ctx.doGet({ parameter: p }); LOG.push({ get: p.action }); }
      else { let a = ''; try { a = JSON.parse(body).action; } catch (e) {} out = ctx.doPost({ postData: { contents: body } }); LOG.push({ post: a, res: String(out).slice(0, 80) }); }
    } catch (e) { out = JSON.stringify({ ok: false, error: 'crash', detail: String(e) }); console.log('CRASH', e); }
    send(res, 200, String(out));
  });
}).listen(8798, '127.0.0.1', () => console.log('gs-local on 8798'));
