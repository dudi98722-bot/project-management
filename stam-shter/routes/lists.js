// רשימות ערכים: סוגי הוצאות לספר ('expense_book') וסוגי הוצאות עסק ('expense_business').
// ל-list_items אין עמודות created_by/updated_by, ולכן ראוטר ייעודי ולא המפעל הגנרי.
const express = require('express');
const { pool, logAction, softDelete, restore } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const router = express.Router();

const VALID_LISTS = new Set(['expense_book', 'expense_business']);

// רשימה אחת (?name=) או כל הרשימות מקובצות
router.get('/', authenticate, can('view'), async (req, res) => {
  try {
    const name = req.query.name;
    if (name) {
      if (!VALID_LISTS.has(name)) return res.status(400).json({ error: 'רשימה לא מוכרת' });
      const r = await pool.query(
        'SELECT * FROM list_items WHERE list_name=$1 AND deleted=false ORDER BY sort, value', [name]);
      return res.json(r.rows);
    }
    const r = await pool.query('SELECT * FROM list_items WHERE deleted=false ORDER BY list_name, sort, value');
    const out = {};
    for (const k of VALID_LISTS) out[k] = [];
    for (const row of r.rows) { (out[row.list_name] = out[row.list_name] || []).push(row); }
    res.json(out);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.post('/', authenticate, can('edit'), async (req, res) => {
  const { list_name, value, sort, is_correction } = req.body || {};
  if (!VALID_LISTS.has(list_name)) return res.status(400).json({ error: 'רשימה לא מוכרת' });
  if (!value || !String(value).trim()) return res.status(400).json({ error: 'ערך חובה' });
  try {
    const r = await pool.query(
      'INSERT INTO list_items (list_name, value, sort, is_correction) VALUES ($1,$2,$3,$4) RETURNING *',
      [list_name, String(value).trim(), Number(sort) || 0,
       list_name === 'expense_book' ? !!is_correction : false]);
    await logAction(req.user, 'add', 'list_items', r.rows[0].id, { list_name }, r.rows[0]);
    res.status(201).json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.put('/:id', authenticate, can('edit'), async (req, res) => {
  const { value, sort, is_correction } = req.body || {};
  try {
    const cur = await pool.query('SELECT * FROM list_items WHERE id=$1 AND deleted=false', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'לא נמצא' });
    // דגל "תיקונים" רלוונטי רק לסוגי הוצאות לספר
    const corr = cur.rows[0].list_name === 'expense_book'
      ? (is_correction === undefined ? cur.rows[0].is_correction : !!is_correction)
      : false;
    const r = await pool.query(
      'UPDATE list_items SET value=COALESCE($1,value), sort=COALESCE($2,sort), is_correction=$3 WHERE id=$4 RETURNING *',
      [value ? String(value).trim() : null, (sort === undefined ? null : Number(sort) || 0), corr, req.params.id]);
    await logAction(req.user, 'edit', 'list_items', req.params.id, {}, r.rows[0]);
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.delete('/:id', authenticate, can('del'), async (req, res) => {
  try {
    const ok = await softDelete('list_items', req.params.id, req.user);
    if (!ok) return res.status(404).json({ error: 'לא נמצא' });
    res.json({ message: 'הועבר לסל המחזור' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
