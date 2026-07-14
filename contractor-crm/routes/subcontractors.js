const express = require('express');
const { pool, logAction, softDelete } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const router = express.Router();

// GET /api/subcontractors - כל הפעילים
router.get('/', authenticate, can('viewBusiness'), async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM subcontractors WHERE deleted=false ORDER BY name');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

// POST /api/subcontractors
router.post('/', authenticate, can('editProjects'), async (req, res) => {
  const { name, trade, phone, email, tax_id, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'שם קבלן חובה' });
  try {
    const r = await pool.query(
      `INSERT INTO subcontractors (name, trade, phone, email, tax_id, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`,
      [name, trade, phone, email, tax_id, notes, req.user.id]
    );
    await logAction(req.user, 'add', 'subcontractors', r.rows[0].id, { name });
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

// PUT /api/subcontractors/:id
router.put('/:id', authenticate, can('editProjects'), async (req, res) => {
  const { name, trade, phone, email, tax_id, notes } = req.body;
  try {
    const r = await pool.query(
      `UPDATE subcontractors SET name=$1, trade=$2, phone=$3, email=$4, tax_id=$5, notes=$6,
       updated_by=$7, updated_at=NOW() WHERE id=$8 AND deleted=false RETURNING *`,
      [name, trade, phone, email, tax_id, notes, req.user.id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'קבלן לא נמצא' });
    await logAction(req.user, 'edit', 'subcontractors', req.params.id, { name });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

// DELETE /api/subcontractors/:id - מחיקה רכה
router.delete('/:id', authenticate, can('viewBusiness'), can('del'), async (req, res) => {
  try {
    const ok = await softDelete('subcontractors', req.params.id, req.user);
    if (!ok) return res.status(404).json({ error: 'קבלן לא נמצא' });
    res.json({ message: 'הקבלן הועבר לסל המחזור' });
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
