// גיבוי אוטומטי ל-Google Sheets: כל פעולה נרשמת בלשונית "פעולות",
// וכל טבלה משוקפת בלשונית משלה (הוספה/עריכה/מחיקה -> עדכון השורה).
// אם BACKUP_SHEET_ID לא מוגדר או אין חשבון שירות - הכל הופך ל-no-op שקט.
const { google } = require('googleapis');
const { loadServiceAccount } = require('./gauth');

const SHEET_ID = () => process.env.BACKUP_SHEET_ID || '';
function enabled() { return !!(SHEET_ID() && loadServiceAccount()); }

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

const ACTIONS = { title: 'פעולות', header: ['זמן', 'משתמש', 'פעולה', 'טבלה', 'מזהה', 'פרטים'] };
const TABS = {
  projects:          { title: 'פרויקטים',   cols: ['id', 'name', 'client_name', 'client_phone', 'address', 'status', 'expected_profit', 'start_date', 'notes', 'deleted', 'updated_at'] },
  stages:            { title: 'שלבים',       cols: ['id', 'project_id', 'name', 'seq', 'client_amount', 'sub_amount', 'subcontractor_id', 'status', 'approved', 'deleted', 'updated_at'] },
  subcontractors:    { title: 'קבלני משנה',  cols: ['id', 'name', 'trade', 'phone', 'email', 'tax_id', 'notes', 'deleted', 'updated_at'] },
  transactions:      { title: 'תנועות',      cols: ['id', 'type', 'direction', 'amount', 'date', 'project_id', 'stage_id', 'subcontractor_id', 'supplier', 'purpose', 'method', 'invoice_url', 'note', 'deleted', 'updated_at'] },
  home_transactions: { title: 'בית',         cols: ['id', 'date', 'direction', 'amount', 'category', 'payee', 'source', 'note', 'deleted', 'updated_at'] },
};

function hasTab(table) { return !!TABS[table]; }
function q(title) { return `'${String(title).replace(/'/g, "''")}'`; }
function fmt(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return v;
}

// יצירת הלשוניות + כותרות (פעם אחת, בעצלתיים)
let _init = null;
function ensureTabs() {
  if (_init) return _init;
  _init = (async () => {
    const ss = SHEET_ID();
    const meta = await api().spreadsheets.get({ spreadsheetId: ss, fields: 'sheets.properties.title' });
    const have = new Set((meta.data.sheets || []).map(s => s.properties.title));
    const wanted = [{ title: ACTIONS.title, header: ACTIONS.header }, ...Object.values(TABS).map(t => ({ title: t.title, header: t.cols }))];
    const toAdd = wanted.filter(w => !have.has(w.title));
    if (toAdd.length) {
      await api().spreadsheets.batchUpdate({
        spreadsheetId: ss,
        requestBody: { requests: toAdd.map(w => ({ addSheet: { properties: { title: w.title } } })) },
      });
      for (const w of toAdd) {
        await api().spreadsheets.values.update({
          spreadsheetId: ss, range: `${q(w.title)}!A1`, valueInputOption: 'RAW',
          requestBody: { values: [w.header] },
        });
      }
    }
  })().catch(e => { _init = null; throw e; });
  return _init;
}

async function appendAction(user, action, table, id, details) {
  const row = [new Date().toISOString(), (user && user.username) || '', action || '', table || '', String(id || ''), JSON.stringify(details || {})];
  await api().spreadsheets.values.append({
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
  const got = await api().spreadsheets.values.get({ spreadsheetId: ss, range: `${q(def.title)}!A:A` });
  const colA = got.data.values || [];
  let rowNum = 0;
  for (let i = 1; i < colA.length; i++) { if (String((colA[i] || [])[0]) === idStr) { rowNum = i + 1; break; } }
  const values = [def.cols.map(c => fmt(record[c]))];
  if (rowNum) {
    await api().spreadsheets.values.update({ spreadsheetId: ss, range: `${q(def.title)}!A${rowNum}`, valueInputOption: 'RAW', requestBody: { values } });
  } else {
    await api().spreadsheets.values.append({ spreadsheetId: ss, range: `${q(def.title)}!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values } });
  }
}

// נקודת כניסה ראשית מ-logAction: רושם פעולה + משקף שורה (אם יש)
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

// שיקוף מרוכז (לפעולות אצווה: שלבים, ייבוא בית, מחיקה מרובה)
async function mirrorMany(table, records) {
  if (!enabled() || !hasTab(table) || !Array.isArray(records)) return;
  try {
    await ensureTabs();
    for (const r of records) await mirrorRow(table, r);
  } catch (e) {
    console.error('Sheets mirrorMany failed:', e.message);
  }
}

module.exports = { enabled, hasTab, backup, mirrorMany };
