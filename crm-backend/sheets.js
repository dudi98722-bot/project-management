/**
 * Server-side Google Sheets mirror.
 * After every DB write we also push the record to the existing Apps Script
 * Web App, which writes it into the same Google Sheet as before.
 * Fire-and-forget: never blocks or fails the API response.
 */
const SHEETS_URL = process.env.SHEETS_URL || '';

// Apps Script rejects concurrent calls ("Too many simultaneous invocations"),
// so every write goes through a serial queue with a short gap and retries.
const fs = require('fs');
const path = require('path');

const queue = [];
let draining = false;
let inFlight = null;   // השורה שנשלחת כרגע - כדי שגם היא תישמר בכיבוי
const GAP_MS = 120;
// גוגל מחזיר לפעמים דף שגיאה (HTML) כשהוא עמוס. קודם זה נחשב "לא לנסות
// שוב", והשורה פשוט לא הגיעה לגיליון (71 שורות ב-5.10). עכשיו מנסים שוב
// עם המתנות ארוכות, ואם בכל זאת נכשל - השורה נרשמת לקובץ לשליחה חוזרת.
const BACKOFF_MS = [2000, 5000, 15000, 30000, 60000];
const FAILED_LOG = process.env.SHEETS_FAILED_LOG || '/var/lib/crm-backend/sheets-failed.jsonl';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// true = נשמר | false = לנסות שוב | 'bad' = שגיאה קבועה (לא לנסות שוב)
async function sendOnce(payload) {
  const url = SHEETS_URL + '?p=' + encodeURIComponent(JSON.stringify(payload));
  const r = await fetch(url, { method: 'GET' });
  const t = await r.text();
  if (/"status"\s*:\s*"ok"/.test(t)) return true;
  // עומס/נעילה/זמן - זמני, גם כשהסקריפט עצמו מחזיר status:error
  if (/simultaneous invocations|too many|timed out|Service invoked too many|try again|lock/i.test(t)) return false;
  if (/"status"\s*:\s*"error"/.test(t)) {          // הסקריפט רץ ונכשל על השורה עצמה
    console.error('Sheets sync script error:', t.slice(0, 200));
    return 'bad';
  }
  // עומס, מכסה, או דף שגיאה של גוגל - זמני
  const title = (t.match(/<title>([^<]*)<\/title>/i) || [])[1];
  console.error('Sheets sync retryable:', r.status, title || t.slice(0, 120));
  return false;
}

function recordFailed(payload, reason) {
  try {
    fs.mkdirSync(path.dirname(FAILED_LOG), { recursive: true });
    fs.appendFileSync(FAILED_LOG, JSON.stringify({ at: new Date().toISOString(), reason, payload }) + '\n');
  } catch (e) {
    console.error('Sheets failed-log write error:', e.message);
  }
}

async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length) {
    const payload = queue.shift();
    inFlight = payload;
    let res = false;
    for (let attempt = 0; attempt <= BACKOFF_MS.length && res === false; attempt++) {
      try {
        res = await sendOnce(payload);
      } catch (e) {
        console.error('Sheets sync error:', e.message);
        res = false;
      }
      if (res === false && attempt < BACKOFF_MS.length) await sleep(BACKOFF_MS[attempt]);
    }
    if (res !== true) {
      console.error('Sheets sync gave up for', payload.type, payload.action, payload.data && payload.data.id);
      recordFailed(payload, res === 'bad' ? 'script-error' : 'retries-exhausted');
    }
    inFlight = null;
    await sleep(GAP_MS);
  }
  draining = false;
}

// ריסטארט/כיבוי של השרת: התור יושב בזיכרון, ובלי זה כל מה שעוד ממתין
// בו פשוט נעלם. נכתב לקובץ, ו-scripts/replay-sheets-failed.js שולח שוב.
let _flushed = false;
function flushQueueToFile(sig) {
  if (_flushed) return;
  _flushed = true;
  const pending = (inFlight ? [inFlight] : []).concat(queue.splice(0));
  pending.forEach(p => recordFailed(p, 'shutdown-' + sig));
  if (pending.length) console.error('Sheets queue saved on ' + sig + ': ' + pending.length + ' items -> ' + FAILED_LOG);
}
['SIGTERM', 'SIGINT'].forEach(sig => process.on(sig, () => { flushQueueToFile(sig); process.exit(0); }));

function postSheets(payload) {
  if (!SHEETS_URL) return Promise.resolve();
  queue.push(payload);
  drain();
  return Promise.resolve();
}

// --- Map DB rows (snake_case) -> the shape the existing sheet/Apps Script expects ---
function vowShape(v) {
  return {
    id: v.id, date: v.date ? String(v.date).slice(0, 10) : '',
    hebrewDate: v.hebrew_date || '', name: v.name || '',
    forA: v.for_a || '', forB: v.for_b || '',
    amount: Number(v.amount) || 0, note: v.note || '', place: v.place || ''
  };
}
function payShape(p) {
  return {
    id: p.id, date: p.date ? String(p.date).slice(0, 10) : '',
    hebrewDate: p.hebrew_date || '', name: p.name || '', vowId: p.vow_id,
    amount: Number(p.amount) || 0, method: p.method || '',
    numPayments: p.num_payments || 1, note: p.note || ''
  };
}

function syncContact(action, row, username) {
  const data = action === 'delete' ? { id: row.id } : Object.assign({}, row, { _user: username || '' });
  postSheets({ type: 'contact', action, data });
}
function syncVow(action, row, username) {
  const data = action === 'delete' ? { id: row.id } : Object.assign(vowShape(row), { _user: username || '' });
  postSheets({ type: 'vow', action, data });
}
function syncPayment(action, row, username) {
  const data = action === 'delete' ? { id: row.id } : Object.assign(payShape(row), { _user: username || '' });
  postSheets({ type: 'payment', action, data });
}
function creditShape(c) {
  return {
    id: c.id, date: c.date ? String(c.date).slice(0, 10) : '',
    hebrewDate: c.hebrew_date || '', name: c.person_name || '',
    amount: Number(c.amount) || 0, note: c.note || ''
  };
}
// אם ללשונית 'credit' אין הגדרה ב-Apps Script — הבקשה פשוט מתעלמת, בלי לשבור כלום
function syncCredit(action, row, username) {
  const data = action === 'delete' ? { id: row.id } : Object.assign(creditShape(row), { _user: username || '' });
  postSheets({ type: 'credit', action, data });
}

module.exports = { syncContact, syncVow, syncPayment, syncCredit, FAILED_LOG };
