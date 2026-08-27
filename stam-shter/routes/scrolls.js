// לשונית ס"ת — לב המערכת. הקריאות מחזירות את כל השדות המחושבים (calc.js).
const express = require('express');
const { pool, logAction, softDeleteScroll } = require('../db');
const { authenticate, can, scrubBuyer, scrubBuyerAll } = require('../middleware/auth');
const { coerce } = require('./_crud');
const { getScrolls, getScroll } = require('../calc');
const router = express.Router();

function dupError(e) {
  return e && e.code === '23505' && String(e.constraint || '').includes('scribe_product_sku');
}
const DUP_MSG = 'כבר קיים ספר עם אותו סופר, אותו מוצר ואותו מק"ט. שנה את המק"ט כדי להבחין ביניהם.';

const FIELDS = [
  { key: 'scribe_id', type: 'int' },
  { key: 'parchment_size_id', type: 'int' },
  { key: 'product_id', type: 'int' },
  { key: 'page_rate', type: 'num' },
  { key: 'sale_date', type: 'date' },
  { key: 'customer_id', type: 'int' },
  { key: 'buyer_total', type: 'num' },
  { key: 'buyer_currency', type: 'text' },
  { key: 'note', type: 'text' },
  { key: 'status', type: 'text' },
  { key: 'sheets_count', type: 'int' },
  { key: 'sku', type: 'text' },
  { key: 'fixed_expense_override', type: 'num' },
];
const COLS = FIELDS.map(f => f.key);

// רשימת הספרים — מחושבת במלואה
router.get('/', authenticate, can('view'), async (req, res) => {
  try {
    const rows = await getScrolls({
      scribe_id: req.query.scribe_id,
      customer_id: req.query.customer_id,
      status: req.query.status,
    });
    res.json(req.caps.finance ? rows : scrubBuyerAll(rows));
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// ספר בודד + כל היומנים שלו, לתצוגת כרטיס
router.get('/:id', authenticate, can('view'), async (req, res) => {
  try {
    const scroll = await getScroll(req.params.id);
    if (!scroll) return res.status(404).json({ error: 'לא נמצא' });
    const id = scroll.id;
    const [pages, scribePays, custPays, bookExp, parchExp] = await Promise.all([
      pool.query('SELECT * FROM pages_log WHERE scroll_id=$1 AND deleted=false ORDER BY date NULLS LAST, id', [id]),
      pool.query('SELECT * FROM scribe_payments WHERE scroll_id=$1 AND deleted=false ORDER BY date NULLS LAST, id', [id]),
      pool.query(`SELECT *, (amount_ils + amount_usd*rate) AS paid_actual,
                   (CASE WHEN amount_usd>0 THEN amount_usd*rate - cash_in_hand ELSE 0 END) AS peritah
                  FROM customer_payments WHERE scroll_id=$1 AND deleted=false ORDER BY date NULLS LAST, id`, [id]),
      pool.query(`SELECT b.*, COALESCE(li.is_correction,false) AS is_correction
                  FROM book_expenses b
                  LEFT JOIN list_items li ON li.list_name='expense_book' AND li.value=b.type AND li.deleted=false
                  WHERE b.scroll_id=$1 AND b.deleted=false ORDER BY b.date NULLS LAST, b.id`, [id]),
      pool.query(`SELECT e.*, z.name AS size_name, COALESCE(z.cost_per_unit,0) AS cost_per_unit,
                   (e.quantity * COALESCE(z.cost_per_unit,0)) AS total_cost
                  FROM parchment_expenses e
                  LEFT JOIN parchment_sizes z ON z.id=e.parchment_size_id
                  WHERE e.scroll_id=$1 AND e.deleted=false ORDER BY e.date NULLS LAST, e.id`, [id]),
    ]);
    res.json({
      scroll: req.caps.finance ? scroll : scrubBuyer(scroll),
      pages_log: pages.rows,
      scribe_payments: scribePays.rows,
      customer_payments: req.caps.finance ? custPays.rows : [],
      book_expenses: bookExp.rows,
      parchment_expenses: parchExp.rows,
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.post('/', authenticate, can('edit'), async (req, res) => {
  try {
    const vals = FIELDS.map(f => coerce(f, req.body[f.key]));
    const ph = COLS.map((_, i) => `$${i + 1}`).join(',');
    const r = await pool.query(
      `INSERT INTO scrolls (${COLS.join(',')}, created_by, updated_by)
       VALUES (${ph}, $${COLS.length + 1}, $${COLS.length + 1}) RETURNING *`,
      [...vals, req.user.id]);
    await logAction(req.user, 'add', 'scrolls', r.rows[0].id, {}, r.rows[0]);
    const created = await getScroll(r.rows[0].id);
    res.status(201).json(req.caps.finance ? created : scrubBuyer(created));
  } catch (e) {
    if (dupError(e)) return res.status(409).json({ error: DUP_MSG });
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.put('/:id', authenticate, can('edit'), async (req, res) => {
  try {
    const vals = FIELDS.map(f => coerce(f, req.body[f.key]));
    const set = COLS.map((c, i) => `${c}=$${i + 1}`).join(', ');
    const r = await pool.query(
      `UPDATE scrolls SET ${set}, updated_by=$${COLS.length + 1}, updated_at=NOW()
       WHERE id=$${COLS.length + 2} AND deleted=false RETURNING *`,
      [...vals, req.user.id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'לא נמצא' });
    await logAction(req.user, 'edit', 'scrolls', req.params.id, {}, r.rows[0]);
    const upd = await getScroll(req.params.id);
    res.json(req.caps.finance ? upd : scrubBuyer(upd));
  } catch (e) {
    if (dupError(e)) return res.status(409).json({ error: DUP_MSG });
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// מחיקה רכה — מדביקה לכל היומנים של הספר
router.delete('/:id', authenticate, can('del'), async (req, res) => {
  try {
    const ok = await softDeleteScroll(req.params.id, req.user);
    if (!ok) return res.status(404).json({ error: 'לא נמצא' });
    res.json({ message: 'הספר וכל רישומיו הועברו לסל המחזור' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
