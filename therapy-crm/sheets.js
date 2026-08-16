// גיבוי אוטומטי ל-Google Sheets דרך Apps Script Web App.
// אין חשבון שירות ואין מפתחות — הגיליון בבעלות המשתמש, והשרת רק שולח אליו
// בקשות POST לכתובת ה-/exec עם סיסמה משותפת.
// אם SHEETS_WEBHOOK_URL לא מוגדר — הכל הופך ל-no-op שקט.

const URL = () => process.env.SHEETS_WEBHOOK_URL || '';
const SECRET = () => process.env.SHEETS_SECRET || '';
function enabled() { return !!URL(); }

// סדר העמודות — חייב להתאים ללשוניות ב-Apps Script
const TABS = {
  // notes2 בסוף במכוון — הוספה באמצע הייתה מזיזה עמודות קיימות בגיליון
  patients:         ['id', 'last_name', 'first_name', 'national_id', 'intake_date', 'birth_date', 'hmo', 'client_type', 'community', 'diagnosis', 'notes', 'urgency', 'hours', 'preferred_therapist_ids', 'preferred_group_ids', 'status', 'deleted', 'updated_at', 'notes2'],
  therapists:       ['id', 'name', 'phone', 'email', 'notes', 'work_schedule', 'active', 'deleted', 'updated_at'],
  therapist_groups: ['id', 'name', 'notes', 'members', 'deleted', 'updated_at'],
  assignments:      ['id', 'patient_id', 'therapist_id', 'total_sessions', 'start_date', 'hour', 'weekday', 'status', 'notes', 'deleted', 'updated_at', 'kind'],
  sessions:         ['id', 'assignment_id', 'patient_id', 'therapist_id', 'session_num', 'date', 'hour', 'status', 'notes', 'deleted', 'updated_at'],
};

function hasTab(table) { return !!TABS[table]; }

// מחרוזת שמתחילה ב-= / + / @ מתפרשת בגיליון כנוסחה חיה (formula injection) —
// גרש מוביל מכריח טקסט; Sheets לא מציג אותו.
function noFormula(s) {
  return /^[=+@]/.test(s) ? "'" + s : s;
}
function fmt(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
  if (typeof v === 'boolean') return v ? 'כן' : '';
  if (Array.isArray(v)) return noFormula(v.join(', '));
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string') return noFormula(v);
  return v;
}

// תור סדרתי: Apps Script לא אוהב בקשות מקבילות, וגם ננעל בצד שלו.
// התור ממשיך גם אחרי כישלון, אבל הקורא מקבל את התוצאה האמיתית ויכול להחליט
// אם לבלוע אותה (קריאה מ-routes) או להיכשל בקול (ייצוא יזום).
let _chain = Promise.resolve();
function enqueue(fn) {
  const result = _chain.then(() => fn());
  _chain = result.catch(() => {});
  return result;
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
             noFormula((user && user.username) || ''), noFormula(action || ''), table || '',
             String(id || ''), JSON.stringify(details || {})],
  }];
  if (record && hasTab(table)) {
    actions.push({ type: 'upsert', table, values: rowFor(table, record) });
  }
  // נקרא מ-routes בלי await — חייב לא לזרוק
  return enqueue(() => post({ actions })).catch(e => console.error('Sheets:', e.message));
}

// שיקוף מרוכז (יצירת סדרת פגישות, ביטול מרובה, ייצוא ראשוני).
// strict=true -> שגיאות עוברות לקורא (לשימוש סקריפט הייצוא, שרוצה לדעת)
async function mirrorMany(table, records, { strict = false } = {}) {
  if (!enabled() || !hasTab(table) || !Array.isArray(records) || !records.length) return;
  const actions = records.map(r => ({ type: 'upsert', table, values: rowFor(table, r) }));
  // פיצול לאצוות כדי לא לחרוג ממגבלת זמן הריצה של Apps Script
  const CHUNK = 50;
  for (let i = 0; i < actions.length; i += CHUNK) {
    const slice = actions.slice(i, i + CHUNK);
    const job = enqueue(() => post({ actions: slice }, 120000));
    if (strict) await job;
    else await job.catch(e => console.error('Sheets:', e.message));
  }
}

// העלאת קובץ לגיבוי ב-Drive. זורק שגיאות — הקורא מחליט אם להתעלם.
// timeout ארוך: קובץ של מגה-בייטים עובר ב-base64 ו-Apps Script איטי.
async function uploadFile({ name, mime, base64, patient, ref }) {
  if (!enabled()) return null;
  const r = await post({ file: { name, mime, data: base64, patient, ref } }, 180000);
  // גרסה ישנה של ה-Apps Script מתעלמת מ-file ומחזירה ok:true בלי קישור —
  // בלי הבדיקה הזו זה נראה כהצלחה והקובץ לא באמת מגובה.
  if (!r.url) throw new Error('קוד ה-Apps Script בגיליון ישן ולא תומך בקבצים — עדכן אותו ופרוס גרסה חדשה');
  return { id: r.id, url: r.url, folder: r.folder };
}

// בדיקת חיבור — בניגוד ל-backup, זורק שגיאות כדי שהתקנה תוכל להסביר מה נכשל
async function verify() {
  if (!URL()) throw new Error('SHEETS_WEBHOOK_URL לא מוגדר בקובץ .env');
  const r = await post({ ping: true }, 30000);
  return { sheet: r.sheet || '' };
}

module.exports = { enabled, hasTab, backup, mirrorMany, verify, uploadFile };
