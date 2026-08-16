// לוגיקת שיבוץ משותפת ל-routes/assignments.js ול-routes/import.js,
// כדי שכללי הדילוג וההתנגשות יהיו זהים בשיבוץ בודד ובייבוא מרוכז.

function parseDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return null;
  const d = new Date(s + 'T00:00:00Z');
  return isNaN(d.getTime()) ? null : d;
}
function fmtDate(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const x = new Date(d.getTime()); x.setUTCDate(x.getUTCDate() + n); return x; }

function worksAt(therapist, weekday, hour) {
  const schedule = (therapist && therapist.work_schedule) || {};
  const dayHours = schedule[String(weekday)] || schedule[weekday] || [];
  return dayHours.includes(hour);
}

// משבצת שבועית שתפוסה על ידי סדרה פעילה אחרת: בלי זה, לוגיקת הדילוג הייתה
// דוחפת את הסדרה החדשה שבועות רבים קדימה בשקט במקום להיכשל בקול.
async function weeklySlotOccupied(client, therapistId, weekday, hour, fromDate) {
  const r = await client.query(
    `SELECT 1 FROM assignments a
      WHERE a.therapist_id=$1 AND a.weekday=$2 AND a.hour=$3
        AND a.status='active' AND a.deleted=false
        AND EXISTS (SELECT 1 FROM sessions s
                     WHERE s.assignment_id=a.id AND s.status='scheduled'
                       AND s.deleted=false AND s.date >= $4)
      LIMIT 1`, [therapistId, weekday, hour, fromDate]);
  return r.rows.length > 0;
}

// יצירת פגישות שבועיות: מדלג על ימי חופש ועל שעות תפוסות (הסדרה נמשכת שבוע נוסף).
// "תפוס" = המטפל עסוק באותה שעה, או שלמטופל עצמו כבר יש פגישה אז (אצל כל מטפל).
async function insertWeeklySessions(client, a, startDate, count, startNum) {
  const created = [], skippedBusy = [], skippedHoliday = [];
  let date = startDate, num = startNum;
  const maxIter = count * 2 + 60; // מעצור בטיחות
  for (let iter = 0; num < startNum + count && iter < maxIter; iter++, date = addDays(date, 7)) {
    const ds = fmtDate(date);
    const hol = await client.query('SELECT name FROM holidays WHERE date=$1', [ds]);
    if (hol.rows.length) { skippedHoliday.push(ds); continue; }
    const busy = await client.query(
      `SELECT 1 FROM sessions
        WHERE date=$1 AND hour=$2 AND status='scheduled' AND deleted=false
          AND (therapist_id=$3 OR patient_id=$4) LIMIT 1`,
      [ds, a.hour, a.therapist_id, a.patient_id]);
    if (busy.rows.length) { skippedBusy.push(ds); continue; }
    const sr = await client.query(
      `INSERT INTO sessions (assignment_id, patient_id, therapist_id, session_num, date, hour)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [a.id, a.patient_id, a.therapist_id, num, ds, a.hour]);
    created.push(sr.rows[0]);
    num++;
  }
  return { created, skippedBusy, skippedHoliday };
}

// הפרת אילוץ הייחודיות uq_sessions_slot — מישהו תפס את המשבצת במקביל
function isSlotTaken(e) { return e && e.code === '23505'; }
const SLOT_TAKEN_MSG = 'המשבצת נתפסה הרגע על ידי משתמש אחר — רענן ונסה שוב';
const WEEKLY_TAKEN_MSG = 'המשבצת השבועית הזו תפוסה על ידי סדרה פעילה אחרת אצל המטפל';

module.exports = {
  parseDate, fmtDate, addDays, worksAt,
  weeklySlotOccupied, insertWeeklySessions,
  isSlotTaken, SLOT_TAKEN_MSG, WEEKLY_TAKEN_MSG,
};
