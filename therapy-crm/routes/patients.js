// רשימת ממתינים — ניהול מטופלים
const express = require('express');
const { pool, logAction, softDelete, restore, validId } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const sheets = require('../sheets');
const router = express.Router();

const HMOS = ['מכבי', 'כללית', 'לאומית', 'מאוחדת'];
const CLIENT_TYPES = ['בן', 'בת', 'הורים', 'מבוגר', 'מבוגרת'];
const ALL_HOURS = Array.from({ length: 14 }, (_, i) => i + 8); // 8..21 = 8:00 עד 22:00

// ניקוי ואימות שדות (משותף להוספה ועריכה)
function cleanBody(b) {
  const errors = [];
  const out = {};
  out.last_name = String(b.last_name || '').trim();
  out.first_name = String(b.first_name || '').trim();
  if (!out.last_name || !out.first_name) errors.push('שם פרטי ושם משפחה חובה');
  out.national_id = b.national_id ? String(b.national_id).trim() : null;
  out.intake_date = b.intake_date || null;
  out.birth_date = b.birth_date || null;
  out.hmo = b.hmo && HMOS.includes(b.hmo) ? b.hmo : (b.hmo ? null : null);
  if (b.hmo && !HMOS.includes(b.hmo)) errors.push('קופת חולים לא תקינה');
  out.client_type = b.client_type || null;
  if (b.client_type && !CLIENT_TYPES.includes(b.client_type)) errors.push('סוג מטופל לא תקין');
  out.community = b.community ? String(b.community).trim() : null;
  out.diagnosis = b.diagnosis ? String(b.diagnosis).trim() : null;
  out.notes = b.notes ? String(b.notes).trim() : null;
  out.notes2 = b.notes2 ? String(b.notes2).trim() : null;
  const urg = Number(b.urgency);
  out.urgency = [1, 2, 3].includes(urg) ? urg : 2;
  let hours = Array.isArray(b.hours) ? b.hours.map(Number).filter(h => Number.isInteger(h) && h >= 8 && h <= 21) : ALL_HOURS;
  hours = [...new Set(hours)].sort((a, c) => a - c);
  if (!hours.length) errors.push('חובה לבחור לפחות שעה אחת מתאימה לטיפול');
  out.hours = JSON.stringify(hours);
  out.preferred_therapist_ids = JSON.stringify(idList(b.preferred_therapist_ids));
  out.preferred_group_ids = JSON.stringify(idList(b.preferred_group_ids));
  return { out, errors };
}

// רשימת מזהים ייחודיים ותקינים, בלי כפילויות
function idList(v) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(validId).filter(Boolean))];
}

const SELECT = `
  SELECT p.*,
         (SELECT COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name) ORDER BY t.name), '[]'::json)
            FROM therapists t
           WHERE t.deleted = false
             AND t.id IN (SELECT x::bigint FROM jsonb_array_elements_text(p.preferred_therapist_ids) AS x)
         ) AS preferred_therapists,
         (SELECT COALESCE(json_agg(json_build_object('id', g.id, 'name', g.name) ORDER BY g.name), '[]'::json)
            FROM therapist_groups g
           WHERE g.deleted = false
             AND g.id IN (SELECT x::bigint FROM jsonb_array_elements_text(p.preferred_group_ids) AS x)
         ) AS preferred_groups,
         (SELECT COUNT(*)::int FROM patient_files pf
           WHERE pf.patient_id = p.id AND pf.deleted = false) AS files_count
  FROM patients p`;

router.get('/', authenticate, async (req, res) => {
  try {
    const showDeleted = req.query.deleted === '1';
    const r = await pool.query(`${SELECT} WHERE p.deleted=$1 ORDER BY p.urgency ASC, p.intake_date ASC NULLS LAST, p.id`, [showDeleted]);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.get('/meta', authenticate, (req, res) => {
  res.json({ hmos: HMOS, client_types: CLIENT_TYPES, all_hours: ALL_HOURS });
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const r = await pool.query(`${SELECT} WHERE p.id=$1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'לא נמצא' });
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.post('/', authenticate, can('edit'), async (req, res) => {
  const { out, errors } = cleanBody(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join(', ') });
  try {
    const r = await pool.query(
      `INSERT INTO patients (last_name, first_name, national_id, intake_date, birth_date, hmo, client_type, community,
                             diagnosis, notes, urgency, hours, preferred_therapist_ids, preferred_group_ids, notes2)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [out.last_name, out.first_name, out.national_id, out.intake_date, out.birth_date, out.hmo, out.client_type,
       out.community, out.diagnosis, out.notes, out.urgency, out.hours, out.preferred_therapist_ids, out.preferred_group_ids,
       out.notes2]);
    await logAction(req.user, 'add', 'patients', r.rows[0].id, { name: `${out.last_name} ${out.first_name}` });
    sheets.backup(req.user, 'add', 'patients', r.rows[0].id, r.rows[0], { name: `${out.last_name} ${out.first_name}` });
    res.status(201).json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.put('/:id', authenticate, can('edit'), async (req, res) => {
  const { out, errors } = cleanBody(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join(', ') });
  try {
    const r = await pool.query(
      `UPDATE patients SET last_name=$1, first_name=$2, national_id=$3, intake_date=$4, birth_date=$5, hmo=$6,
              client_type=$7, community=$8, diagnosis=$9, notes=$10, urgency=$11, hours=$12,
              preferred_therapist_ids=$13, preferred_group_ids=$14, notes2=$15, updated_at=NOW()
       WHERE id=$16 AND deleted=false RETURNING *`,
      [out.last_name, out.first_name, out.national_id, out.intake_date, out.birth_date, out.hmo, out.client_type,
       out.community, out.diagnosis, out.notes, out.urgency, out.hours, out.preferred_therapist_ids, out.preferred_group_ids,
       out.notes2, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'לא נמצא' });
    await logAction(req.user, 'edit', 'patients', req.params.id, {});
    sheets.backup(req.user, 'edit', 'patients', req.params.id, r.rows[0], {});
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// שינוי סטטוס בלבד (waiting / assigned / done)
router.put('/:id/status', authenticate, can('edit'), async (req, res) => {
  const status = String((req.body || {}).status || '');
  if (!['waiting', 'assigned', 'done'].includes(status)) return res.status(400).json({ error: 'סטטוס לא תקין' });
  try {
    const r = await pool.query('UPDATE patients SET status=$1, updated_at=NOW() WHERE id=$2 AND deleted=false RETURNING *', [status, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'לא נמצא' });
    await logAction(req.user, 'edit', 'patients', req.params.id, { status });
    sheets.backup(req.user, 'edit', 'patients', req.params.id, r.rows[0], { status });
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.delete('/:id', authenticate, can('del'), async (req, res) => {
  try {
    const ok = await softDelete('patients', req.params.id, req.user);
    if (!ok) return res.status(404).json({ error: 'לא נמצא' });
    const r = await pool.query('SELECT * FROM patients WHERE id=$1', [req.params.id]);
    sheets.backup(req.user, 'delete', 'patients', req.params.id, r.rows[0], {});
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.post('/:id/restore', authenticate, can('del'), async (req, res) => {
  try {
    const ok = await restore('patients', req.params.id, req.user);
    if (!ok) return res.status(404).json({ error: 'לא נמצא' });
    const r = await pool.query('SELECT * FROM patients WHERE id=$1', [req.params.id]);
    sheets.backup(req.user, 'restore', 'patients', req.params.id, r.rows[0], {});
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
