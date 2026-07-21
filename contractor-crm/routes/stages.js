const express = require('express');
const { pool, logAction, softDeleteStage } = require('../db');
const { authenticate, can, canAny } = require('../middleware/auth');
const router = express.Router();

// POST /api/stages - הוספת שלב בודד (קבלן המשנה יורש מהפרויקט)
router.post('/', authenticate, canAny(['editProjects', 'addStages']), async (req, res) => {
  const { project_id, name, seq, client_amount, sub_amount, status } = req.body;
  if (!project_id || !name) return res.status(400).json({ error: 'פרויקט ושם שלב חובה' });
  try {
    const proj = await pool.query('SELECT subcontractor_id FROM projects WHERE id=$1 AND deleted=false', [project_id]);
    const subId = proj.rows.length ? proj.rows[0].subcontractor_id : null;
    const r = await pool.query(
      `INSERT INTO stages (project_id, name, seq, client_amount, sub_amount, subcontractor_id, status, created_by, updated_by)
       VALUES ($1,$2,COALESCE($3::int,0),COALESCE($4::numeric,0),COALESCE($5::numeric,0),$6,COALESCE($7,'pending'),$8,$8) RETURNING *`,
      [project_id, name, seq, client_amount, sub_amount, subId, status, req.user.id]
    );
    await logAction(req.user, 'add', 'stages', r.rows[0].id, { project_id, name });
    res.status(201).json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// PUT /api/stages/:id - עריכת שלב (רק מי שרשאי לערוך פרויקטים — לא מדווח)
router.put('/:id', authenticate, can('editProjects'), async (req, res) => {
  const { name, seq, client_amount, sub_amount, subcontractor_id, status, approved } = req.body;
  try {
    const r = await pool.query(
      `UPDATE stages SET name=$1, seq=COALESCE($2::int,seq), client_amount=COALESCE($3::numeric,0), sub_amount=COALESCE($4::numeric,0),
         subcontractor_id=COALESCE($5::bigint,subcontractor_id), status=COALESCE($6,status), approved=COALESCE($7::boolean,approved),
         updated_by=$8, updated_at=NOW()
       WHERE id=$9 AND deleted=false RETURNING *`,
      [name, seq, client_amount, sub_amount, subcontractor_id || null, status, approved, req.user.id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'שלב לא נמצא' });
    await logAction(req.user, 'edit', 'stages', req.params.id, { name });
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// DELETE /api/stages/:id - מחיקה רכה
router.delete('/:id', authenticate, can('viewBusiness'), can('del'), async (req, res) => {
  try {
    const ok = await softDeleteStage(req.params.id, req.user);
    if (!ok) return res.status(404).json({ error: 'שלב לא נמצא' });
    res.json({ message: 'השלב והתנועות שלו הועברו לסל המחזור' });
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
