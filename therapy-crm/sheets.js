// גיבוי אוטומטי ל-Google Sheets דרך Apps Script Web App.
// אין חשבון שירות ואין מפתחות — הגיליון בבעלות המשתמש, והשרת רק שולח אליו
// בקשות POST לכתובת ה-/exec עם סיסמה משותפת.
// אם SHEETS_WEBHOOK_URL לא מוגדר — הכל הופך ל-no-op שקט.

const URL = () => process.env.SHEETS_WEBHOOK_URL || '';
const SECRET = () => process.env.SHEETS_SECRET || '';
function enabled() { return !!URL(); }

// סדר העמודות — חייב להתאים ללשוניות ב-Apps Script
const TABS = {
  patients:         ['id', 'last_name', 'first_name', 'national_id', 'intake_date', 'birth_date', 'hmo', 'client_type', 'community', 'diagnosis', 'notes', 'urgency', 'hours', 'preferred_therapist_ids', 'preferred_group_ids', 'status', 'deleted', 'updated_at'],
  therapists:       ['id', 'name', 'phone', 'email', 'notes', 'work_schedule', 'active', 'deleted', 'updated_at'],
  therapist_groups: ['id', 'name', 'notes', 'members', 'deleted', 'updated_at'],
  assignments:      ['id', 'patient_id', 'therapist_id', 'total_sessions', 'start_date', 'hour', 'weekday', 'status', 'notes', 'deleted', 'updated_at'],
  sessions:         ['id', 'assignment_id', 'patient_id', 'therapist_id', 'session_num', 'date', 'hour', 'status', 'notes', 'deleted', 'updated_at'],
};

function hasTab(table) { return !!TABS[table]; }

function fmt(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
  if (typeof v === 'boolean') return v ? 'כן' : '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

// תור סדרתי: Apps Script לא אוהב בקשות מקבילות, וגם ננעל בצד שלו
let _chain = Promise.resolve();
function queue(fn) {
  _chain = _chain.then(fn).catch(e => { console.error('Sheets:', e.message); });
  return _chain;
}

// Apps Script איטי — במיוחד בכתיבה הראשונה שיוצרת את הלשוניות. הכתיבה לא חוסמת
// את תגובת ה-API (הקריאות מ-routes אינן ממתינות), אז עדיף להיות סבלניים.
async function post(payload, timeoutMs = 60000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(URL(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: SECRET(), ...payload }),
      signal: ctrl.signal,
      redirect: 'follow',   // Apps Script מפנה ל-script.googleusercontent.com
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error('תשובה לא צפויה מהגיליון (בדוק שההרשאה היא Anyone ושהפריסה עדכנית)'); }
    if (!data.ok) throw new Error(data.error || 'שגיאה לא ידועה מהגיליון');
    return data;
  } finally { clearTimeout(timer); }
}

function rowFor(table, record) {
  return TABS[table].map(c => fmt(record[c]));
}

// נקודת כניסה ראשית: רושם פעולה ביומן + משקף את השורה
async function backup(user, action, table, id, record, details) {
  if (!enabled()) return;
  const actions = [{
    type: 'log',
    values: [new Date().toISOString().slice(0, 19).replace('T', ' '),
             (user && user.username) || '', action || '', table || '',
             String(id || ''), JSON.stringify(details || {})],
  }];
  if (record && hasTab(table)) {
    actions.push({ type: 'upsert', table, values: rowFor(table, record) });
  }
  return queue(() => post({ actions }));
}

// שיקוף מרוכז (יצירת סדרת פגישות, ביטול מרובה) — בקשה אחת לכל האצווה
async function mirrorMany(table, records) {
  if (!enabled() || !hasTab(table) || !Array.isArray(records) || !records.length) return;
  const actions = records.map(r => ({ type: 'upsert', table, values: rowFor(table, r) }));
  // פיצול לאצוות כדי לא לחרוג ממגבלת זמן הריצה של Apps Script
  const CHUNK = 50;
  for (let i = 0; i < actions.length; i += CHUNK) {
    const slice = actions.slice(i, i + CHUNK);
    await queue(() => post({ actions: slice }, 60000));
  }
}

// בדיקת חיבור — בניגוד ל-backup, זורק שגיאות כדי שהתקנה תוכל להסביר מה נכשל
async function verify() {
  if (!URL()) throw new Error('SHEETS_WEBHOOK_URL לא מוגדר בקובץ .env');
  const r = await post({ ping: true }, 30000);
  return { sheet: r.sheet || '' };
}

module.exports = { enabled, hasTab, backup, mirrorMany, verify };
