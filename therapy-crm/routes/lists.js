// רשימות ניתנות לעריכה (השתייכות קהילתית וכו') — עם אפשרות הוספה ידנית מהטופס
const express = require('express');
const { pool, logAction } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const name = req.query.name;
    const r = name
      ? await pool.query('SELECT * FROM list_items WHERE list_name=$1 ORDER BY sort, id', [name])
      : await pool.query('SELECT * FROM list_items ORDER BY list_name, sort, id');
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.post('/', authenticate, can('edit'), async (req, res) => {
  const { list_name, value } = req.body || {};
  if (!list_name || !value || !String(value).trim()) return res.status(400).json({ error: 'שם רשימה וערך חובה' });
  try {
    const r = await pool.query(
      'INSERT INTO list_items (list_name, value, sort) VALUES ($1,$2,(SELECT COALESCE(MAX(sort),0)+1 FROM list_items WHERE list_name=$1)) ON CONFLICT (list_name, value) DO UPDATE SET value=EXCLUDED.value RETURNING *',
      [String(list_name).trim(), String(value).trim()]);
    await logAction(req.user, 'add', 'list_items', r.rows[0].id, { list_name, value });
    res.status(201).json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.delete('/:id', authenticate, can('del'), async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM list_items WHERE id=$1 RETURNING id, list_name, value', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'לא נמצא' });
    await logAction(req.user, 'delete', 'list_items', req.params.id, r.rows[0]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
