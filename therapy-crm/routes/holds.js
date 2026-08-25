// רשימת השהיה — מטופלים שממתינים למטפל מסוים עד שתתפנה לו משבצת.
// מטופל יכול להיות בהשהיה אצל כמה מטפלים במקביל.
const express = require('express');
const { pool, logAction, validId } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const router = express.Router();

const LIST_SQL = `
  SELECT h.*,
         p.last_name || ' ' || p.first_name AS patient_name,
         p.urgency, p.status AS patient_status,
         t.name AS therapist_name
    FROM holds h
    JOIN patients p ON p.id = h.patient_id
    JOIN therapists t ON t.id = h.therapist_id`;

// כל ההשהיות הפעילות (אפשר לסנן לפי מטפל)
router.get('/', authenticate, async (req, res) => {
  try {
    const params = [];
    let where = 'h.released = false AND p.deleted = false';
    if (req.query.therapist_id) { params.push(validId(req.query.therapist_id)); where += ` AND h.therapist_id=$${params.length}`; }
    const r = await pool.query(`${LIST_SQL} WHERE ${where} ORDER BY t.name, p.urgency, h.created_at`, params);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// הוספת מטופלים להשהיה אצל מטפל — אפשר כמה בבת אחת
// { therapist_id, patient_ids: [...], note }
router.post('/', authenticate, can('holds'), async (req, res) => {
  const b = req.body || {};
  const tid = validId(b.therapist_id);
  const ids = Array.isArray(b.patient_ids) ? [...new Set(b.patient_ids.map(validId).filter(Boolean))] : [];
  if (!tid) return res.status(400).json({ error: 'חובה לבחור מטפל' });
  if (!ids.length) return res.status(400).json({ error: 'חובה לבחור לפחות מטופל אחד' });

  try {
    const tr = await pool.query('SELECT name FROM therapists WHERE id=$1 AND deleted=false', [tid]);
    if (!tr.rows.length) return res.status(404).json({ error: 'מטפל לא נמצא' });

    const added = [], skipped = [];
    for (const pid of ids) {
      const pr = await pool.query('SELECT last_name, first_name FROM patients WHERE id=$1 AND deleted=false', [pid]);
      if (!pr.rows.length) { skipped.push({ id: pid, reason: 'מטופל לא נמצא' }); continue; }
      const name = `${pr.rows[0].last_name} ${pr.rows[0].first_name}`;
      // ON CONFLICT מול האינדקס הייחודי — מטופל שכבר בהשהיה אצל המטפל הזה לא נכפל
      const r = await pool.query(
        `INSERT INTO holds (therapist_id, patient_id, note, created_by, created_by_name)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (therapist_id, patient_id) WHERE released = false DO NOTHING
         RETURNING *`,
        [tid, pid, b.note || null, req.user.id, req.user.full_name || req.user.username]);
      if (r.rows.length) added.push({ ...r.rows[0], patient_name: name });
      else skipped.push({ id: pid, name, reason: 'כבר בהשהיה אצל מטפל זה' });
    }
    await logAction(req.user, 'add', 'holds', tid, { therapist: tr.rows[0].name, added: added.length });
    res.status(201).json({ added: added.length, skipped, therapist: tr.rows[0].name });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// שחרור מהשהיה
router.put('/:id/release', authenticate, can('holds'), async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE holds SET released=true, released_at=NOW(), released_by_name=$2
        WHERE id=$1 AND released=false RETURNING *`,
      [req.params.id, req.user.full_name || req.user.username]);
    if (!r.rows.length) return res.status(404).json({ error: 'לא נמצא' });
    await logAction(req.user, 'release', 'holds', req.params.id, {});
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
