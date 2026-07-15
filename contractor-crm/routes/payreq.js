const express = require('express');
const { pool, logAction, softDelete } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const router = express.Router();

// GET /api/payment-requests — כל הבקשות השמורות (לא מחוקות)
router.get('/', authenticate, can('viewBusiness'), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT id, project_id, stage_id, project_name, stage_name, sub_name,
             requested::float AS requested, sub_remaining::float AS sub_remaining,
             client_owes::float AS client_owes, created_at
      FROM payment_requests WHERE deleted=false
      ORDER BY created_at DESC, id DESC`);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// POST /api/payment-requests — הוספת שורת בקשה (snapshot מגיע מהלקוח, מחושב מהשלב)
router.post('/', authenticate, can('viewBusiness'), can('writeTx'), async (req, res) => {
  const b = req.body || {};
  const requested = parseFloat(b.requested);
  if (!(requested > 0)) return res.status(400).json({ error: 'סכום מבוקש חייב להיות גדול מ-0' });
  try {
    const r = await pool.query(`
      INSERT INTO payment_requests
        (project_id, stage_id, project_name, stage_name, sub_name, requested, sub_remaining, client_owes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id, project_id, stage_id, project_name, stage_name, sub_name,
                requested::float AS requested, sub_remaining::float AS sub_remaining,
                client_owes::float AS client_owes, created_at`,
      [
        b.project_id || null, b.stage_id || null,
        b.project_name || null, b.stage_name || null, b.sub_name || null,
        requested, parseFloat(b.sub_remaining) || 0, parseFloat(b.client_owes) || 0,
        req.user.id
      ]);
    await logAction(req.user, 'add', 'payment_requests', r.rows[0].id, { requested });
    res.status(201).json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// DELETE /api/payment-requests/:id — מחיקה רכה של שורה בודדת
router.delete('/:id', authenticate, can('viewBusiness'), can('writeTx'), async (req, res) => {
  try {
    const ok = await softDelete('payment_requests', req.params.id, req.user);
    if (!ok) return res.status(404).json({ error: 'שורה לא נמצאה' });
    res.json({ message: 'הבקשה הועברה לסל המחזור' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// POST /api/payment-requests/clear — מחיקה רכה של כל הבקשות
router.post('/clear', authenticate, can('viewBusiness'), can('writeTx'), async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE payment_requests SET deleted=true, deleted_at=NOW(), deleted_by=$1
       WHERE deleted=false RETURNING id`, [req.user.id]);
    await logAction(req.user, 'bulk_delete', 'payment_requests', 0, { count: r.rows.length });
    res.json({ count: r.rows.length });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
