// גיבוי אוטומטי ל-Google Sheets: כל פעולה נרשמת בלשונית "פעולות",
// וכל טבלה משוקפת בלשונית משלה (הוספה/עריכה/מחיקה -> עדכון השורה לפי מזהה).
// אם BACKUP_SHEET_ID לא מוגדר או אין חשבון שירות — הכל הופך ל-no-op שקט,
// והמערכת ממשיכה לעבוד רגיל.
let google = null;
try { ({ google } = require('googleapis')); } catch (e) { google = null; }
const { loadServiceAccount } = require('./gauth');

const SHEET_ID = () => process.env.BACKUP_SHEET_ID || '';
function enabled() { return !!(google && SHEET_ID() && loadServiceAccount()); }

let _api = null;
function api() {
  if (_api) return _api;
  const auth = new google.auth.GoogleAuth({
    credentials: loadServiceAccount(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  _api = google.sheets({ version: 'v4', auth });
  return _api;
}

// throttle: פריסת הקריאות כדי לא לחרוג ממכסת ה-API (כ-60 לדקה)
let _last = 0; const _queue = []; let _running = false;
function throttle(fn) {
  return new Promise((resolve, reject) => { _queue.push({ fn, resolve, reject }); pump(); });
}
async function pump() {
  if (_running) return; _running = true;
  while (_queue.length) {
    const job = _queue.shift();
    const wait = 1200 - (Date.now() - _last);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    _last = Date.now();
    try { job.resolve(await job.fn()); } catch (e) { job.reject(e); }
  }
  _running = false;
}
function _sp() { return api().spreadsheets; }
const S = {
  get: (p) => throttle(() => _sp().get(p)),
  batchUpdate: (p) => throttle(() => _sp().batchUpdate(p)),
  vGet: (p) => throttle(() => _sp().values.get(p)),
  vUpdate: (p) => throttle(() => _sp().values.update(p)),
  vAppend: (p) => throttle(() => _sp().values.append(p)),
};

const ACTIONS = { title: 'פעולות', header: ['זמן', 'משתמש', 'פעולה', 'טבלה', 'מזהה', 'פרטים'] };

const TABS = {
  contacts:           { title: 'אנשי קשר', cols: ['id', 'first_name', 'last_name', 'phone', 'deleted', 'updated_at'] },
  products:           { title: 'מוצרים', cols: ['id', 'name', 'parchment_units', 'pages', 'fixed_expense', 'deleted', 'updated_at'] },
  parchment_sizes:    { title: 'גדלי קלף', cols: ['id', 'name', 'cost_per_unit', 'deleted', 'updated_at'] },
  list_items:         { title: 'רשימות', cols: ['id', 'list_name', 'value', 'sort', 'is_correction', 'deleted'] },
  scrolls:            { title: 'ספרי תורה', cols: ['id', 'scribe_id', 'parchment_size_id', 'product_id', 'page_rate', 'sale_date', 'customer_id', 'buyer_total', 'buyer_currency', 'status', 'note', 'deleted', 'updated_at'] },
  pages_log:          { title: 'עמודים שנכתבו', cols: ['id', 'scroll_id', 'date', 'pages', 'note', 'deleted', 'updated_at'] },
  scribe_payments:    { title: 'תשלומים לסופר', cols: ['id', 'scroll_id', 'date', 'amount', 'note', 'deleted', 'updated_at'] },
  customer_payments:  { title: 'תשלומי לקוחות', cols: ['id', 'scroll_id', 'customer_id', 'date', 'amount_ils', 'amount_usd', 'rate', 'cash_in_hand', 'note', 'deleted', 'updated_at'] },
  book_expenses:      { title: 'הוצאות לספר', cols: ['id', 'scroll_id', 'type', 'date', 'amount', 'note', 'deleted', 'updated_at'] },
  parchment_expenses: { title: 'הוצאות קלף', cols: ['id', 'scroll_id', 'parchment_size_id', 'date', 'quantity', 'note', 'deleted', 'updated_at'] },
  business_expenses:  { title: 'הוצאות עסק', cols: ['id', 'date', 'type', 'amount', 'note', 'deleted', 'updated_at'] },
  prod_purchases:         { title: 'רכישות מוצרים', cols: ['id', 'date', 'scribe_id', 'product_id', 'quantity', 'cost_per_unit', 'extra_cost_per_unit', 'purchase_type', 'note', 'deleted', 'updated_at'] },
  prod_scribe_payments:   { title: 'תשלומי סופר מוצרים', cols: ['id', 'date', 'scribe_id', 'amount', 'note', 'deleted', 'updated_at'] },
  prod_sales:             { title: 'מכירות מוצרים', cols: ['id', 'date', 'customer_id', 'purchase_id', 'quantity', 'price_per_unit', 'sale_type', 'deduct_3pct', 'note', 'deleted', 'updated_at'] },
  prod_customer_payments: { title: 'תשלומי לקוחות מוצרים', cols: ['id', 'date', 'customer_id', 'amount_ils', 'amount_usd', 'rate', 'cash_in_hand', 'note', 'deleted', 'updated_at'] },
};

function hasTab(table) { return !!TABS[table]; }
function q(title) { return `'${String(title).replace(/'/g, "''")}'`; }
function fmt(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return v;
}

// יצירת הלשוניות + הכותרות (פעם אחת, בעצלתיים)
let _init = null;
function ensureTabs() {
  if (_init) return _init;
  _init = (async () => {
    const ss = SHEET_ID();
    const meta = await S.get({ spreadsheetId: ss, fields: 'sheets.properties.title' });
    const have = new Set((meta.data.sheets || []).map(s => s.properties.title));
    const wanted = [{ title: ACTIONS.title, header: ACTIONS.header },
                    ...Object.values(TABS).map(t => ({ title: t.title, header: t.cols }))];
    const toAdd = wanted.filter(w => !have.has(w.title));
    if (toAdd.length) {
      await S.batchUpdate({
        spreadsheetId: ss,
        requestBody: { requests: toAdd.map(w => ({ addSheet: { properties: { title: w.title } } })) },
      });
      for (const w of toAdd) {
        await S.vUpdate({
          spreadsheetId: ss, range: `${q(w.title)}!A1`, valueInputOption: 'RAW',
          requestBody: { values: [w.header] },
        });
      }
    }
  })().catch(e => { _init = null; throw e; });
  return _init;
}

async function appendAction(user, action, table, id, details) {
  const row = [new Date().toISOString(), (user && user.username) || '', action || '',
               table || '', String(id || ''), JSON.stringify(details || {})];
  await S.vAppend({
    spreadsheetId: SHEET_ID(), range: `${q(ACTIONS.title)}!A1`,
    valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

// עדכון-או-הוספה של שורת נתונים לפי מזהה
async function mirrorRow(table, record) {
  const def = TABS[table];
  if (!def || !record || record.id == null) return;
  const ss = SHEET_ID(), idStr = String(record.id);
  const got = await S.vGet({ spreadsheetId: ss, range: `${q(def.title)}!A:A` });
  const colA = got.data.values || [];
  let rowNum = 0;
  for (let i = 1; i < colA.length; i++) { if (String((colA[i] || [])[0]) === idStr) { rowNum = i + 1; break; } }
  const values = [def.cols.map(c => fmt(record[c]))];
  if (rowNum) {
    await S.vUpdate({ spreadsheetId: ss, range: `${q(def.title)}!A${rowNum}`, valueInputOption: 'RAW', requestBody: { values } });
  } else {
    await S.vAppend({ spreadsheetId: ss, range: `${q(def.title)}!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values } });
  }
}

// נקודת הכניסה מ-logAction: רושם פעולה + משקף את השורה (אם יש לה לשונית)
async function backup(user, action, table, id, record, details) {
  if (!enabled()) return;
  try {
    await ensureTabs();
    await appendAction(user, action, table, id, details);
    if (record && hasTab(table)) await mirrorRow(table, record);
  } catch (e) {
    console.error('Sheets backup failed:', e.message);
  }
}

module.exports = { enabled, hasTab, backup };
