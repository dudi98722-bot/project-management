// שיוך בפועל למטפל — סדרות טיפול שבועיות, קליטה מהירה של מטופל קיים, ופגישות בודדות.
// יצירת פגישות מדלגת אוטומטית על שבועות תפוסים ועל ימי חופש/חג (הסדרה מתארכת).
const express = require('express');
const { pool, logAction, validId } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const sheets = require('../sheets');
const {
  parseDate, fmtDate, worksAt, weeklySlotOccupied, insertWeeklySessions,
  isSlotTaken, SLOT_TAKEN_MSG, WEEKLY_TAKEN_MSG,
} = require('../lib/scheduling');
const router = express.Router();

const LIST_SQL = `
  SELECT a.*,
         p.last_name || ' ' || p.first_name AS patient_name,
         t.name AS therapist_name,
         (SELECT COUNT(*)::int FROM sessions s WHERE s.assignment_id=a.id AND s.deleted=false AND s.status='done') AS done_count,
         (SELECT COUNT(*)::int FROM sessions s WHERE s.assignment_id=a.id AND s.deleted=false AND s.status='scheduled' AND s.date <  CURRENT_DATE) AS past_count,
         (SELECT COUNT(*)::int FROM sessions s WHERE s.assignment_id=a.id AND s.deleted=false AND s.status='scheduled' AND s.date >= CURRENT_DATE) AS upcoming_count,
         (SELECT COUNT(*)::int FROM sessions s WHERE s.assignment_id=a.id AND s.deleted=false AND s.status IN ('cancelled','no_show')) AS cancelled_count,
         (SELECT MAX(s.date) FROM sessions s WHERE s.assignment_id=a.id AND s.deleted=false AND s.status='scheduled') AS last_date
  FROM assignments a
  JOIN patients p ON p.id = a.patient_id
  JOIN therapists t ON t.id = a.therapist_id`;

router.get('/', authenticate, async (req, res) => {
  try {
    const parts = ['a.deleted=false'];
    const params = [];
    if (req.query.patient_id) { params.push(req.query.patient_id); parts.push(`a.patient_id=$${params.length}`); }
    if (req.query.therapist_id) { params.push(req.query.therapist_id); parts.push(`a.therapist_id=$${params.length}`); }
    if (req.query.status) { params.push(req.query.status); parts.push(`a.status=$${params.length}`); }
    const r = await pool.query(`${LIST_SQL} WHERE ${parts.join(' AND ')} ORDER BY a.created_at DESC`, params);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.get('/:id/sessions', authenticate, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT s.*, t.name AS therapist_name, p.last_name || ' ' || p.first_name AS patient_name
       FROM sessions s
       JOIN therapists t ON t.id=s.therapist_id
       JOIN patients p ON p.id=s.patient_id
       WHERE s.assignment_id=$1 AND s.deleted=false ORDER BY s.session_num`, [req.params.id]);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// ===== עזרי אימות משותפים =====
async function loadPatientTherapist(client, patientId, therapistId) {
  const pr = await client.query('SELECT * FROM patients WHERE id=$1 AND deleted=false', [patientId]);
  if (!pr.rows.length) return { error: 'מטופל לא נמצא' };
  const tr = await client.query('SELECT * FROM therapists WHERE id=$1 AND deleted=false', [therapistId]);
  if (!tr.rows.length) return { error: 'מטפל לא נמצא' };
  return { patient: pr.rows[0], therapist: tr.rows[0] };
}

// ===== יצירת סדרה למטופל מרשימת ההמתנה =====
// { patient_id, therapist_id, total_sessions, start_date, hour, notes }
router.post('/', authenticate, can('edit'), async (req, res) => {
  const b = req.body || {};
  const patientId = validId(b.patient_id), therapistId = validId(b.therapist_id);
  const total = Number(b.total_sessions);
  const hour = Number(b.hour);
  const start = parseDate(b.start_date);
  if (!patientId || !therapistId) return res.status(400).json({ error: 'חובה לבחור מטופל ומטפל' });
  if (!Number.isInteger(total) || total < 1 || total > 200) return res.status(400).json({ error: 'כמות טיפולים חייבת להיות בין 1 ל-200' });
  if (!Number.isInteger(hour) || hour < 8 || hour > 21) return res.status(400).json({ error: 'שעה לא תקינה (8:00–22:00)' });
  if (!start) return res.status(400).json({ error: 'תאריך התחלה לא תקין' });

  const weekday = start.getUTCDay();
  const client = await pool.connect();
  try {
    const ctx = await loadPatientTherapist(client, patientId, therapistId);
    if (ctx.error) return res.status(404).json({ error: ctx.error });
    const { patient, therapist } = ctx;

    if (!worksAt(therapist, weekday, hour)) {
      return res.status(400).json({ error: 'המטפל לא עובד ביום ובשעה שנבחרו (בדוק את לו"ז העבודה שלו)' });
    }
    const warnings = [];
    const patientHours = Array.isArray(patient.hours) ? patient.hours : [];
    if (patientHours.length && !patientHours.includes(hour)) {
      warnings.push('שים לב: השעה שנבחרה אינה מסומנת כמתאימה אצל המטופל');
    }

    await client.query('BEGIN');
    if (await weeklySlotOccupied(client, therapistId, weekday, hour, fmtDate(start))) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: WEEKLY_TAKEN_MSG });
    }
    const ar = await client.query(
      `INSERT INTO assignments (patient_id, therapist_id, total_sessions, start_date, hour, weekday, notes, kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'series') RETURNING *`,
      [patientId, therapistId, total, fmtDate(start), hour, weekday, b.notes || null]);
    const assignment = ar.rows[0];

    const { created, skippedBusy, skippedHoliday } = await insertWeeklySessions(client, assignment, start, total, 1);
    if (created.length < total) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'לא ניתן לשבץ את כל הפגישות — יותר מדי התנגשויות או ימי חופש בשעה זו' });
    }
    await client.query(`UPDATE patients SET status='assigned', updated_at=NOW() WHERE id=$1`, [patientId]);
    await client.query('COMMIT');

    await logAction(req.user, 'add', 'assignments', assignment.id, {
      patient: `${patient.last_name} ${patient.first_name}`, therapist: therapist.name,
      total, start_date: fmtDate(start), hour, skipped_busy: skippedBusy.length, skipped_holidays: skippedHoliday.length });
    sheets.backup(req.user, 'add', 'assignments', assignment.id, assignment, {
      patient: `${patient.last_name} ${patient.first_name}`, therapist: therapist.name });
    sheets.mirrorMany('sessions', created);

    res.status(201).json({ assignment, sessions: created, skipped_busy: skippedBusy, skipped_holidays: skippedHoliday, warnings });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    if (isSlotTaken(e)) return res.status(409).json({ error: SLOT_TAKEN_MSG });
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  } finally { client.release(); }
});

// ===== קליטה מהירה של מטופל קיים =====
// יוצר מטופל עם שם בלבד + סדרת טיפולים, בפעולה אחת.
// { last_name, first_name, therapist_id, total_sessions, start_date, hour, notes }
router.post('/quick', authenticate, can('edit'), async (req, res) => {
  const b = req.body || {};
  const last = String(b.last_name || '').trim();
  const first = String(b.first_name || '').trim();
  const therapistId = validId(b.therapist_id);
  const total = Number(b.total_sessions);
  const hour = Number(b.hour);
  const start = parseDate(b.start_date);
  if (!last || !first) return res.status(400).json({ error: 'שם משפחה ושם פרטי חובה' });
  if (!therapistId) return res.status(400).json({ error: 'חובה לבחור מטפל' });
  if (!Number.isInteger(total) || total < 1 || total > 200) return res.status(400).json({ error: 'כמות טיפולים חייבת להיות בין 1 ל-200' });
  if (!Number.isInteger(hour) || hour < 8 || hour > 21) return res.status(400).json({ error: 'שעה לא תקינה (8:00–22:00)' });
  if (!start) return res.status(400).json({ error: 'תאריך התחלה לא תקין' });

  const weekday = start.getUTCDay();
  const client = await pool.connect();
  try {
    const tr = await client.query('SELECT * FROM therapists WHERE id=$1 AND deleted=false', [therapistId]);
    if (!tr.rows.length) return res.status(404).json({ error: 'מטפל לא נמצא' });
    const therapist = tr.rows[0];
    if (!worksAt(therapist, weekday, hour)) {
      return res.status(400).json({ error: 'המטפל לא עובד ביום ובשעה שנבחרו (בדוק את לו"ז העבודה שלו)' });
    }

    await client.query('BEGIN');
    if (await weeklySlotOccupied(client, therapistId, weekday, hour, fmtDate(start))) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: WEEKLY_TAKEN_MSG });
    }
    const pr = await client.query(
      `INSERT INTO patients (last_name, first_name, status, preferred_therapist_ids)
       VALUES ($1,$2,'assigned',$3) RETURNING *`,
      [last, first, JSON.stringify([therapistId])]);
    const patient = pr.rows[0];

    const ar = await client.query(
      `INSERT INTO assignments (patient_id, therapist_id, total_sessions, start_date, hour, weekday, notes, kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'series') RETURNING *`,
      [patient.id, therapistId, total, fmtDate(start), hour, weekday, b.notes || null]);
    const assignment = ar.rows[0];

    const { created, skippedBusy, skippedHoliday } = await insertWeeklySessions(client, assignment, start, total, 1);
    if (created.length < total) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'לא ניתן לשבץ את כל הפגישות — יותר מדי התנגשויות או ימי חופש בשעה זו' });
    }
    await client.query('COMMIT');

    await logAction(req.user, 'add', 'assignments', assignment.id, {
      quick: true, patient: `${last} ${first}`, therapist: therapist.name, total, start_date: fmtDate(start), hour });
    sheets.backup(req.user, 'add', 'patients', patient.id, patient, { quick: true });
    sheets.backup(req.user, 'add', 'assignments', assignment.id, assignment, {
      patient: `${last} ${first}`, therapist: therapist.name });
    sheets.mirrorMany('sessions', created);

    res.status(201).json({ patient, assignment, sessions: created, skipped_busy: skippedBusy, skipped_holidays: skippedHoliday });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    if (isSlotTaken(e)) return res.status(409).json({ error: SLOT_TAKEN_MSG });
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  } finally { client.release(); }
});

// ===== פגישה בודדת =====
// { patient_id, therapist_id, date, hour, notes }
router.post('/single', authenticate, can('edit'), async (req, res) => {
  const b = req.body || {};
  const patientId = validId(b.patient_id), therapistId = validId(b.therapist_id);
  const hour = Number(b.hour);
  const date = parseDate(b.date);
  if (!patientId || !therapistId) return res.status(400).json({ error: 'חובה לבחור מטופל ומטפל' });
  if (!Number.isInteger(hour) || hour < 8 || hour > 21) return res.status(400).json({ error: 'שעה לא תקינה (8:00–22:00)' });
  if (!date) return res.status(400).json({ error: 'תאריך לא תקין' });

  const weekday = date.getUTCDay();
  const ds = fmtDate(date);
  const client = await pool.connect();
  try {
    const ctx = await loadPatientTherapist(client, patientId, therapistId);
    if (ctx.error) return res.status(404).json({ error: ctx.error });
    const { patient, therapist } = ctx;

    if (!worksAt(therapist, weekday, hour)) {
      return res.status(400).json({ error: 'המטפל לא עובד ביום ובשעה שנבחרו' });
    }

    // הבדיקות בתוך הטרנזקציה, והאילוץ uq_sessions_slot מגבה מפני מרוץ מקבילי
    await client.query('BEGIN');
    const hol = await client.query('SELECT name FROM holidays WHERE date=$1', [ds]);
    if (hol.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `התאריך מוגדר כיום חופש${hol.rows[0].name ? ' (' + hol.rows[0].name + ')' : ''}` });
    }
    const tBusy = await client.query(
      `SELECT 1 FROM sessions WHERE therapist_id=$1 AND date=$2 AND hour=$3 AND status='scheduled' AND deleted=false LIMIT 1`,
      [therapistId, ds, hour]);
    if (tBusy.rows.length) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'השעה הזו כבר תפוסה אצל המטפל' }); }
    const pBusy = await client.query(
      `SELECT 1 FROM sessions WHERE patient_id=$1 AND date=$2 AND hour=$3 AND status='scheduled' AND deleted=false LIMIT 1`,
      [patientId, ds, hour]);
    if (pBusy.rows.length) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'למטופל כבר יש פגישה בשעה זו' }); }

    const ar = await client.query(
      `INSERT INTO assignments (patient_id, therapist_id, total_sessions, start_date, hour, weekday, notes, kind)
       VALUES ($1,$2,1,$3,$4,$5,$6,'single') RETURNING *`,
      [patientId, therapistId, ds, hour, weekday, b.notes || null]);
    const assignment = ar.rows[0];
    const sr = await client.query(
      `INSERT INTO sessions (assignment_id, patient_id, therapist_id, session_num, date, hour)
       VALUES ($1,$2,$3,1,$4,$5) RETURNING *`,
      [assignment.id, patientId, therapistId, ds, hour]);
    await client.query('COMMIT');

    await logAction(req.user, 'add', 'assignments', assignment.id, {
      single: true, patient: `${patient.last_name} ${patient.first_name}`, therapist: therapist.name, date: ds, hour });
    sheets.backup(req.user, 'add', 'assignments', assignment.id, assignment, { single: true });
    sheets.mirrorMany('sessions', sr.rows);

    res.status(201).json({ assignment, session: sr.rows[0] });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    if (isSlotTaken(e)) return res.status(409).json({ error: SLOT_TAKEN_MSG });
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  } finally { client.release(); }
});

// ביטול סדרה: פגישות עתידיות מבוטלות; אם למטופל אין סדרה פעילה אחרת — חוזר לרשימת ההמתנה
router.put('/:id/cancel', authenticate, can('del'), async (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: 'מזהה לא תקין' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ar = await client.query(`UPDATE assignments SET status='cancelled', updated_at=NOW() WHERE id=$1 AND deleted=false RETURNING *`, [id]);
    if (!ar.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'לא נמצא' }); }
    const assignment = ar.rows[0];
    const sr = await client.query(
      `UPDATE sessions SET status='cancelled', updated_at=NOW()
       WHERE assignment_id=$1 AND status='scheduled' AND date >= CURRENT_DATE AND deleted=false RETURNING *`, [id]);
    const other = await client.query(
      `SELECT 1 FROM assignments WHERE patient_id=$1 AND id<>$2 AND status='active' AND deleted=false LIMIT 1`,
      [assignment.patient_id, id]);
    if (!other.rows.length) {
      await client.query(`UPDATE patients SET status='waiting', updated_at=NOW() WHERE id=$1 AND status='assigned'`, [assignment.patient_id]);
    }
    await client.query('COMMIT');
    await logAction(req.user, 'cancel', 'assignments', id, { cancelled_sessions: sr.rows.length });
    sheets.backup(req.user, 'cancel', 'assignments', id, assignment, { cancelled_sessions: sr.rows.length });
    sheets.mirrorMany('sessions', sr.rows);
    res.json({ assignment, cancelled_sessions: sr.rows.length });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  } finally { client.release(); }
});

// עדכון סטטוס פגישה בודדת: scheduled / done / cancelled / no_show
router.put('/sessions/:id', authenticate, can('edit'), async (req, res) => {
  const status = String((req.body || {}).status || '');
  if (!['scheduled', 'done', 'cancelled', 'no_show'].includes(status)) return res.status(400).json({ error: 'סטטוס לא תקין' });
  try {
    const r = await pool.query(`UPDATE sessions SET status=$1, notes=COALESCE($2, notes), updated_at=NOW() WHERE id=$3 AND deleted=false RETURNING *`,
      [status, (req.body || {}).notes || null, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'לא נמצא' });
    const s = r.rows[0];
    // אם כל פגישות הסדרה הסתיימו — סימון הסדרה כהושלמה
    const left = await pool.query(
      `SELECT COUNT(*)::int AS n FROM sessions WHERE assignment_id=$1 AND status='scheduled' AND deleted=false`, [s.assignment_id]);
    if (left.rows[0].n === 0) {
      await pool.query(`UPDATE assignments SET status='completed', updated_at=NOW() WHERE id=$1 AND status='active'`, [s.assignment_id]);
    }
    await logAction(req.user, 'edit', 'sessions', s.id, { status });
    sheets.backup(req.user, 'edit', 'sessions', s.id, s, { status });
    res.json(s);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
