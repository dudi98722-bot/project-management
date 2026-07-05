const express = require('express');
const { pool } = require('../db');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

// Pull a few searchable/list fields out of the full answers object
function summarize(answers) {
  answers = answers || {};
  return {
    parents_names:   (answers.parents || '').toString().slice(0, 300),
    child_name:      (answers.child || '').toString().slice(0, 300),
    phone:           (answers.parents || '').toString().slice(0, 300), // phones live inside "parents"
    main_difficulty: (answers.why_now || '').toString().slice(0, 500),
  };
}

// ---- PUBLIC: a family submits the questionnaire ----
router.post('/', async (req, res) => {
  const answers = req.body && req.body.answers;
  if (!answers || typeof answers !== 'object') return res.status(400).json({ error: 'נתונים חסרים' });
  const s = summarize(answers);
  try {
    const r = await pool.query(
      `INSERT INTO submissions (parents_names, child_name, phone, main_difficulty, answers)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [s.parents_names, s.child_name, s.phone, s.main_difficulty, answers]
    );
    res.status(201).json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ---- everything below requires login (the consultant) ----

// GET /api/submissions  (list, no heavy answers blob)
router.get('/', authenticate, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, parents_names, child_name, phone, main_difficulty, status, created_at
       FROM submissions ORDER BY created_at DESC`
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// GET /api/submissions/:id  (full record)
router.get('/:id', authenticate, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM submissions WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'הפנייה לא נמצאה' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// PUT /api/submissions/:id  (consultant updates status / private notes)
router.put('/:id', authenticate, async (req, res) => {
  const { status, notes } = req.body || {};
  const sets = [], vals = [];
  if (status !== undefined) {
    if (!['new', 'in_progress', 'done'].includes(status)) return res.status(400).json({ error: 'סטטוס לא תקין' });
    vals.push(status); sets.push(`status = $${vals.length}`);
  }
  if (notes !== undefined) { vals.push(notes); sets.push(`notes = $${vals.length}`); }
  if (!sets.length) return res.status(400).json({ error: 'אין מה לעדכן' });
  vals.push(req.params.id);
  try {
    const r = await pool.query(
      `UPDATE submissions SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    if (!r.rows.length) return res.status(404).json({ error: 'הפנייה לא נמצאה' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// DELETE /api/submissions/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM submissions WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
