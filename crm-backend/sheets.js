/**
 * Server-side Google Sheets mirror.
 * After every DB write we also push the record to the existing Apps Script
 * Web App, which writes it into the same Google Sheet as before.
 * Fire-and-forget: never blocks or fails the API response.
 */
const SHEETS_URL = process.env.SHEETS_URL || '';

function postSheets(payload) {
  if (!SHEETS_URL) return Promise.resolve();
  // GET is the reliable transport for Apps Script web apps (no 302/CORS issues).
  const url = SHEETS_URL + '?p=' + encodeURIComponent(JSON.stringify(payload));
  return fetch(url, { method: 'GET' })
    .then(r => r.text())
    .then(t => { if (!/ok/i.test(t)) console.error('Sheets sync unexpected:', t.slice(0, 120)); })
    .catch(e => console.error('Sheets sync error:', e.message));
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

module.exports = { syncContact, syncVow, syncPayment };
