// מטפלים — כולל לו"ז עבודה שבועי (ימים + שעות)
const express = require('express');
const { pool, logAction, softDelete, restore } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const sheets = require('../sheets');
const router = express.Router();

// אימות לו"ז עבודה: {"0":[8,9], ...} — מפתחות 0..6, שעות 8..21
function cleanSchedule(ws) {
  const out = {};
  if (ws && typeof ws === 'object' && !Array.isArray(ws)) {
    for (const [day, hours] of Object.entries(ws)) {
      const d = Number(day);
      if (!Number.isInteger(d) || d < 0 || d > 6 || !Array.isArray(hours)) continue;
      const hs = [...new Set(hours.map(Number).filter(h => Number.isInteger(h) && h >= 8 && h <= 21))].sort((a, b) => a - b);
      if (hs.length) out[d] = hs;
    }
  }
  return out;
}

router.get('/', authenticate, async (req, res) => {
  try {
    const showDeleted = req.query.deleted === '1';
    const r = await pool.query(`
      SELECT t.*,
             COALESCE(json_agg(json_build_object('id', g.id, 'name', g.name)) FILTER (WHERE g.id IS NOT NULL), '[]') AS groups
      FROM therapists t
      LEFT JOIN group_members gm ON gm.therapist_id = t.id
      LEFT JOIN therapist_groups g ON g.id = gm.group_id AND g.deleted = false
      WHERE t.deleted=$1
      GROUP BY t.id
      ORDER BY t.name`, [showDeleted]);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.post('/', authenticate, can('edit'), async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'שם מטפל חובה' });
  try {
    const r = await pool.query(
      `INSERT INTO therapists (name, phone, email, notes, work_schedule, active)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, b.phone || null, b.email || null, b.notes || null, JSON.stringify(cleanSchedule(b.work_schedule)),
       b.active === undefined ? true : !!b.active]);
    await logAction(req.user, 'add', 'therapists', r.rows[0].id, { name });
    sheets.backup(req.user, 'add', 'therapists', r.rows[0].id, r.rows[0], { name });
    res.status(201).json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.put('/:id', authenticate, can('edit'), async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'שם מטפל חובה' });
  try {
    const r = await pool.query(
      `UPDATE therapists SET name=$1, phone=$2, email=$3, notes=$4, work_schedule=$5, active=$6, updated_at=NOW()
       WHERE id=$7 AND deleted=false RETURNING *`,
      [name, b.phone || null, b.email || null, b.notes || null, JSON.stringify(cleanSchedule(b.work_schedule)),
       b.active === undefined ? true : !!b.active, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'לא נמצא' });
    await logAction(req.user, 'edit', 'therapists', req.params.id, { name });
    sheets.backup(req.user, 'edit', 'therapists', req.params.id, r.rows[0], {});
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.delete('/:id', authenticate, can('del'), async (req, res) => {
  try {
    // חסימה אם יש סדרות פעילות
    const act = await pool.query(
      "SELECT COUNT(*)::int AS n FROM assignments WHERE therapist_id=$1 AND status='active' AND deleted=false", [req.params.id]);
    if (act.rows[0].n > 0) return res.status(409).json({ error: 'לא ניתן למחוק מטפל עם סדרות טיפול פעילות. בטל קודם את הסדרות.' });
    const ok = await softDelete('therapists', req.params.id, req.user);
    if (!ok) return res.status(404).json({ error: 'לא נמצא' });
    const r = await pool.query('SELECT * FROM therapists WHERE id=$1', [req.params.id]);
    sheets.backup(req.user, 'delete', 'therapists', req.params.id, r.rows[0], {});
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.post('/:id/restore', authenticate, can('del'), async (req, res) => {
  try {
    const ok = await restore('therapists', req.params.id, req.user);
    if (!ok) return res.status(404).json({ error: 'לא נמצא' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
