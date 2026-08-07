// גיבוי אוטומטי לגיליון גוגל דרך Apps Script Web App.
//
// כל פעולה נשלחת ל-Web App שמדביק אותה ללשונית "פעולות" ומשקף את הרשומה
// ללשונית הטבלה. הפעולות נצברות ונשלחות באצווה, כדי לא להציף את מכסת
// הקריאות של Apps Script וכדי שהמשתמש לא ימתין לגיבוי.
//
// אם BACKUP_WEBHOOK_URL לא מוגדר — הכל הופך ל-no-op שקט והמערכת עובדת רגיל.

const WEBHOOK = () => process.env.BACKUP_WEBHOOK_URL || '';
const SECRET = () => process.env.BACKUP_SECRET || '';
function enabled() { return !!(WEBHOOK() && SECRET()); }

const FLUSH_DELAY_MS = 1500;   // המתנה קצרה לצבירת פעולות לאצווה
const MAX_BATCH = 100;         // גג לגודל אצווה
const MAX_QUEUE = 5000;        // גג לתור, שלא ינפח זיכרון אם השליחה תקועה
const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 30000;

let queue = [];
let timer = null;
let sending = false;

// נקודת הכניסה מ-logAction
function backup(user, action, table, id, record, details) {
  if (!enabled()) return Promise.resolve();
  if (queue.length >= MAX_QUEUE) {
    console.error('Sheets backup: התור מלא, פעולה נזרקה');
    return Promise.resolve();
  }
  queue.push({
    time: new Date().toISOString(),
    user: (user && user.username) || '',
    action: action || '',
    table: table || '',
    id: id == null ? '' : String(id),
    details: details || {},
    record: record || null,   // הסקריפט בוחר מהרשומה את העמודות שהוא מכיר
  });
  schedule();
  return Promise.resolve();
}

function schedule() {
  if (timer || sending || !queue.length) return;
  timer = setTimeout(() => { timer = null; flush(); }, FLUSH_DELAY_MS);
  if (timer.unref) timer.unref();   // שלא יחזיק את התהליך בחיים
}

async function flush() {
  if (sending || !queue.length) return;
  sending = true;
  const batch = queue.splice(0, MAX_BATCH);
  try {
    await post(batch);
  } catch (e) {
    console.error('Sheets backup failed:', e.message);
    // מחזירים לראש התור לניסיון נוסף, עד MAX_ATTEMPTS
    const retry = batch.filter(it => (it._attempts || 0) + 1 < MAX_ATTEMPTS);
    for (const it of retry) it._attempts = (it._attempts || 0) + 1;
    const dropped = batch.length - retry.length;
    if (dropped) console.error(`Sheets backup: ${dropped} פעולות נזנחו אחרי ${MAX_ATTEMPTS} ניסיונות`);
    queue.unshift(...retry);
  } finally {
    sending = false;
    if (queue.length) setTimeout(schedule, FLUSH_DELAY_MS);
  }
}

async function post(items) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(WEBHOOK(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: SECRET(), items: items.map(strip) }),
      redirect: 'follow',       // Apps Script מפנה ל-script.googleusercontent.com
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    // חובה אישור חיובי. תשובה שאינה JSON פירושה שגוגל ענתה במקום הסקריפט
    // (פריסה סגורה, דף התחברות, חריגת מכסה) — כלומר שום דבר לא נכתב.
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* נטפל למטה */ }
    if (!data) {
      throw new Error('תשובה שאינה JSON מה-Web App — ודא שהפריסה פתוחה ל"כל אחד" ושהכתובת מסתיימת ב-/exec: ' + text.slice(0, 200));
    }
    if (data.ok !== true) throw new Error(data.error || 'שגיאה מהסקריפט');
  } finally { clearTimeout(t); }
}

// שיקוף רשומות בלי לרשום שורה ביומן הפעולות.
// משמש למחיקה/שחזור מדביקים: שורת האב כבר נרשמה ביומן, ואין טעם להציף
// אותו בעשרות שורות בן — אבל הן חייבות להתעדכן בגיליון, אחרת הן יישארו
// שם deleted=FALSE וכל דוח שייבנה מעל הגיליון יספור רשומות מחוקות כחיות.
function mirrorMany(table, records) {
  if (!enabled() || !Array.isArray(records) || !records.length) return Promise.resolve();
  let dropped = 0;
  for (const rec of records) {
    if (!rec || rec.id == null) continue;
    if (queue.length >= MAX_QUEUE) { dropped++; continue; }
    queue.push({ time: new Date().toISOString(), table: table || '', id: String(rec.id), record: rec, silent: true });
  }
  if (dropped) console.error(`Sheets backup: התור מלא — ${dropped} רשומות של ${table} לא גובו לשיטס`);
  schedule();
  return Promise.resolve();
}

// מסירים שדות פנימיים לפני השליחה
function strip(it) {
  const { _attempts, ...rest } = it;
  return rest;
}

module.exports = { enabled, backup, mirrorMany };
