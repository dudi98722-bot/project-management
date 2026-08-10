// לוח שנה וזמינות: תצוגת שבוע למטפל + חיפוש משבצות פנויות קבועות בשבועות הקרובים
const express = require('express');
const { pool, validId } = require('../db');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

function parseDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return null;
  const d = new Date(s + 'T00:00:00Z');
  return isNaN(d.getTime()) ? null : d;
}
function fmtDate(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const x = new Date(d.getTime()); x.setUTCDate(x.getUTCDate() + n); return x; }

// תצוגת שבוע למטפל: ?therapist_id=&start=YYYY-MM-DD (יום ראשון של השבוע)
router.get('/week', authenticate, async (req, res) => {
  const tid = validId(req.query.therapist_id);
  let start = parseDate(req.query.start);
  if (!tid) return res.status(400).json({ error: 'חובה לבחור מטפל' });
  if (!start) {
    const now = new Date();
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    start = addDays(today, -today.getUTCDay()); // יום ראשון של השבוע הנוכחי
  } else {
    start = addDays(start, -start.getUTCDay());
  }
  const end = addDays(start, 6);
  try {
    const tr = await pool.query('SELECT id, name, work_schedule, active FROM therapists WHERE id=$1 AND deleted=false', [tid]);
    if (!tr.rows.length) return res.status(404).json({ error: 'מטפל לא נמצא' });
    const sr = await pool.query(
      `SELECT s.id, s.assignment_id, s.session_num, s.date, s.hour, s.status,
              s.patient_id, p.last_name || ' ' || p.first_name AS patient_name,
              a.total_sessions
       FROM sessions s
       JOIN patients p ON p.id = s.patient_id
       JOIN assignments a ON a.id = s.assignment_id
       WHERE s.therapist_id=$1 AND s.date BETWEEN $2 AND $3 AND s.deleted=false AND s.status <> 'cancelled'
       ORDER BY s.date, s.hour`, [tid, fmtDate(start), fmtDate(end)]);
    res.json({ therapist: tr.rows[0], week_start: fmtDate(start), week_end: fmtDate(end), sessions: sr.rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// משבצות פנויות קבועות (יום+שעה שאין בהם אף פגישה מתוזמנת ב-N השבועות הקרובים):
// ?weeks=4 & patient_id= (מסנן לפי שעות המטופל והעדפת שיוך) & therapist_id= & group_id=
router.get('/availability', authenticate, async (req, res) => {
  const weeks = Math.min(Math.max(Number(req.query.weeks) || 4, 1), 12);
  try {
    let therapistFilterIds = null;   // null = כולם
    let patientHours = null;

    if (req.query.patient_id) {
      const pr = await pool.query('SELECT * FROM patients WHERE id=$1 AND deleted=false', [validId(req.query.patient_id)]);
      if (pr.rows.length) {
        const p = pr.rows[0];
        if (Array.isArray(p.hours) && p.hours.length) patientHours = new Set(p.hours.map(Number));
        if (p.preferred_therapist_id) therapistFilterIds = [p.preferred_therapist_id];
        else if (p.preferred_group_id) {
          const gm = await pool.query('SELECT therapist_id FROM group_members WHERE group_id=$1', [p.preferred_group_id]);
          therapistFilterIds = gm.rows.map(r => r.therapist_id);
        }
      }
    }
    if (req.query.therapist_id) therapistFilterIds = [validId(req.query.therapist_id)].filter(Boolean);
    else if (req.query.group_id) {
      const gm = await pool.query('SELECT therapist_id FROM group_members WHERE group_id=$1', [validId(req.query.group_id)]);
      therapistFilterIds = gm.rows.map(r => r.therapist_id);
    }

    const params = [];
    let where = 'deleted=false AND active=true';
    if (therapistFilterIds) {
      if (!therapistFilterIds.length) return res.json({ weeks, therapists: [] });
      params.push(therapistFilterIds);
      where += ` AND id = ANY($${params.length})`;
    }
    const tr = await pool.query(`SELECT id, name, work_schedule FROM therapists WHERE ${where} ORDER BY name`, params);

    // כל המשבצות התפוסות (פגישות מתוזמנות) ב-N השבועות הקרובים, לפי מטפל+יום+שעה
    const br = await pool.query(
      `SELECT therapist_id, EXTRACT(DOW FROM date)::int AS weekday, hour, COUNT(*)::int AS booked
       FROM sessions
       WHERE deleted=false AND status='scheduled' AND date >= CURRENT_DATE AND date < CURRENT_DATE + ($1 * 7)::int
       GROUP BY therapist_id, weekday, hour`, [weeks]);
    const busy = new Map();
    for (const row of br.rows) busy.set(`${row.therapist_id}|${row.weekday}|${row.hour}`, row.booked);

    const out = tr.rows.map(t => {
      const slots = [];
      const ws = t.work_schedule || {};
      for (const [dayKey, hours] of Object.entries(ws)) {
        const weekday = Number(dayKey);
        if (!Array.isArray(hours)) continue;
        for (const hour of hours) {
          if (patientHours && !patientHours.has(Number(hour))) continue;
          const booked = busy.get(`${t.id}|${weekday}|${hour}`) || 0;
          if (booked === 0) slots.push({ weekday, hour: Number(hour) });
        }
      }
      slots.sort((a, b) => a.weekday - b.weekday || a.hour - b.hour);
      return { therapist_id: t.id, name: t.name, free_slots: slots, total_free: slots.length };
    });
    res.json({ weeks, therapists: out });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
