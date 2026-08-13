// שיקוף אוטומטי ל-Google Sheets: כל פעולה נרשמת בלשונית "פעולות",
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

// throttle: פריסת הקריאות ל-Sheets כדי לא לחרוג ממכסת הבקשות לדקה (60/דקה)
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
  patients:         { title: 'ממתינים',       cols: ['id', 'last_name', 'first_name', 'national_id', 'intake_date', 'birth_date', 'hmo', 'client_type', 'community', 'diagnosis', 'notes', 'urgency', 'hours', 'preferred_therapist_ids', 'preferred_group_ids', 'status', 'deleted', 'updated_at'] },
  therapists:       { title: 'מטפלים',        cols: ['id', 'name', 'phone', 'email', 'notes', 'work_schedule', 'active', 'deleted', 'updated_at'] },
  therapist_groups: { title: 'קבוצות מטפלים', cols: ['id', 'name', 'notes', 'members', 'deleted', 'updated_at'] },
  assignments:      { title: 'סדרות טיפול',   cols: ['id', 'patient_id', 'therapist_id', 'total_sessions', 'start_date', 'hour', 'weekday', 'status', 'notes', 'deleted', 'updated_at'] },
  sessions:         { title: 'פגישות',        cols: ['id', 'assignment_id', 'patient_id', 'therapist_id', 'session_num', 'date', 'hour', 'status', 'notes', 'deleted', 'updated_at'] },
};

function hasTab(table) { return !!TABS[table]; }
function q(title) { return `'${String(title).replace(/'/g, "''")}'`; }
function fmt(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

// יצירת הלשוניות + כותרות (פעם אחת, בעצלתיים)
let _init = null;
function ensureTabs() {
  if (_init) return _init;
  _init = (async () => {
    const ss = SHEET_ID();
    const meta = await S.get({ spreadsheetId: ss, fields: 'sheets.properties.title' });
    const have = new Set((meta.data.sheets || []).map(s => s.properties.title));
    const wanted = [{ title: ACTIONS.title, header: ACTIONS.header }, ...Object.values(TABS).map(t => ({ title: t.title, header: t.cols }))];
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
  const row = [new Date().toISOString(), (user && user.username) || '', action || '', table || '', String(id || ''), JSON.stringify(details || {})];
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

// נקודת כניסה ראשית: רושם פעולה + משקף שורה (אם יש)
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

// שיקוף מרוכז (לפעולות אצווה: יצירת סדרת פגישות, ביטול מרובה)
async function mirrorMany(table, records) {
  if (!enabled() || !hasTab(table) || !Array.isArray(records)) return;
  try {
    await ensureTabs();
    for (const r of records) await mirrorRow(table, r);
  } catch (e) {
    console.error('Sheets mirrorMany failed:', e.message);
  }
}

// בדיקת חיבור: יוצר את הלשוניות ורושם שורת בדיקה. בניגוד ל-backup — זורק שגיאות,
// כדי שסקריפט ההתקנה יוכל להציג למשתמש מה בדיוק נכשל.
async function verify() {
  if (!SHEET_ID()) throw new Error('BACKUP_SHEET_ID לא מוגדר בקובץ .env');
  if (!loadServiceAccount()) throw new Error('קובץ חשבון השירות חסר או פגום');
  await ensureTabs();
  await appendAction({ username: 'setup' }, 'בדיקת חיבור', '', '', { ok: true });
  const meta = await S.get({ spreadsheetId: SHEET_ID(), fields: 'properties.title,sheets.properties.title' });
  return {
    title: meta.data.properties.title,
    tabs: (meta.data.sheets || []).map(s => s.properties.title),
  };
}

module.exports = { enabled, hasTab, backup, mirrorMany, verify };
