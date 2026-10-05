/**
 * שליחה חוזרת לגוגל שיטס של שורות שלא הגיעו לגיליון.
 * קורא את קובץ הכשלונות (sheets.js -> FAILED_LOG), שולח אחת-אחת עם
 * ניסיונות חוזרים, ומשאיר בקובץ רק את מה שעדיין נכשל.
 *
 * הרצה:  cd /var/www/crm-backend && node scripts/replay-sheets-failed.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const URL = process.env.SHEETS_URL;
const FILE = process.env.SHEETS_FAILED_LOG || '/var/lib/crm-backend/sheets-failed.jsonl';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sendWithRetry(payload) {
  const waits = [2000, 5000, 15000, 30000];
  for (let i = 0; i <= waits.length; i++) {
    try {
      const t = await (await fetch(URL + '?p=' + encodeURIComponent(JSON.stringify(payload)))).text();
      if (/"status"\s*:\s*"ok"/.test(t)) return true;
    } catch (e) { /* רשת - ננסה שוב */ }
    if (i < waits.length) await sleep(waits[i]);
  }
  return false;
}

(async () => {
  if (!URL) { console.log('SHEETS_URL לא מוגדר'); return; }
  if (!fs.existsSync(FILE)) { console.log('אין קובץ כשלונות - אין מה לשלוח'); return; }
  // לוקחים את הקובץ ומתחילים חדש, כדי שכשלונות שנוספים בזמן הריצה לא יאבדו
  const work = FILE + '.replaying';
  fs.renameSync(FILE, work);
  const lines = fs.readFileSync(work, 'utf8').split('\n').filter(Boolean);
  // אותה שורה שנכשלה כמה פעמים - שולחים רק את הגרסה האחרונה שלה
  const latest = new Map();
  for (const l of lines) {
    try {
      const e = JSON.parse(l);
      const p = e.payload || {};
      latest.set(p.type + ':' + (p.data && p.data.id), e);
    } catch (_) {}
  }
  console.log('לשליחה:', latest.size, '(מתוך', lines.length, 'רשומות בקובץ)');
  let ok = 0, fail = 0;
  for (const e of latest.values()) {
    if (await sendWithRetry(e.payload)) ok++;
    else { fail++; fs.appendFileSync(FILE, JSON.stringify(e) + '\n'); }
    await sleep(150);
  }
  fs.unlinkSync(work);
  console.log('נשלחו:', ok, '| עדיין נכשלו:', fail, fail ? '(נשארו ב-' + FILE + ')' : '');
})().catch(e => { console.error('replay error:', e.message); process.exit(1); });
