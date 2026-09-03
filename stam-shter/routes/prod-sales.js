// מכירות מוצרים — כל מכירה נגזרת מחבילת רכישה, ולא ניתן למכור מעבר ליתרת המלאי בה.
const express = require('express');
const { pool, logAction, softDelete } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const { coerce } = require('./_crud');
const router = express.Router();

const FIELDS = [
  { key: 'date', type: 'date' },
  { key: 'customer_id', type: 'int' },
  { key: 'purchase_id', type: 'int' },
  { key: 'quantity', type: 'int' },
  { key: 'price_per_unit', type: 'num' },
  { key: 'sale_type', type: 'text' },
  { key: 'currency', type: 'text' },
  { key: 'deduct_3pct', type: 'bool' },
  { key: 'note', type: 'text' },
];
const COLS = FIELDS.map(f => f.key);

// עלות היחידה נלקחת מהחבילה (עלות + עלות נוספת), והרווח מנכה 3% אם סומן.
// כשמטבע המכירה שונה ממטבע הרכישה, הרווח הוא הפרש בין שני מטבעות ואי אפשר
// לבטא אותו במספר אחד — לכן NULL, והממשק מציג "—" במקום מספר שגוי.
const VIEW = `
SELECT t.*,
  pp.product_id,
  p.name AS product_name,
  sc.name AS scribe_name,
  cu.name AS customer_name,
  COALESCE(pp.currency,'ILS') AS purchase_currency,
  (COALESCE(pp.cost_per_unit,0) + COALESCE(pp.extra_cost_per_unit,0)) AS unit_cost,
  (COALESCE(t.quantity,0) * COALESCE(t.price_per_unit,0)) AS total_sale,
  (COALESCE(t.quantity,0) * (COALESCE(pp.cost_per_unit,0) + COALESCE(pp.extra_cost_per_unit,0))) AS total_cost,
  (CASE WHEN COALESCE(t.currency,'ILS') = COALESCE(pp.currency,'ILS') THEN
    ((COALESCE(t.quantity,0) * COALESCE(t.price_per_unit,0))
      - (COALESCE(t.quantity,0) * (COALESCE(pp.cost_per_unit,0) + COALESCE(pp.extra_cost_per_unit,0)))
      - (CASE WHEN t.deduct_3pct THEN COALESCE(t.quantity,0) * COALESCE(t.price_per_unit,0) * 0.03 ELSE 0 END))
  END) AS total_profit
FROM prod_sales t
LEFT JOIN prod_purchases pp ON pp.id = t.purchase_id
LEFT JOIN products  p  ON p.id  = pp.product_id
LEFT JOIN contacts  sc ON sc.id = pp.scribe_id
LEFT JOIN contacts  cu ON cu.id = t.customer_id`;

// יתרת המלאי בחבילה. excludeSaleId — כדי שעריכת מכירה לא תיחשב כמלאי תפוס על ידי עצמה.
// נקרא בתוך טרנזקציה עם נעילת שורת הרכישה, כדי ששתי מכירות במקביל לא יעברו את המלאי.
async function remainingFor(client, purchaseId, excludeSaleId) {
  const p = await client.query('SELECT quantity FROM prod_purchases WHERE id=$1 AND deleted=false FOR UPDATE', [purchaseId]);
  if (!p.rows.length) return null;
  const s = await client.query(
    `SELECT COALESCE(SUM(quantity),0) AS sold FROM prod_sales
     WHERE purchase_id=$1 AND deleted=false AND ($2::bigint IS NULL OR id <> $2)`,
    [purchaseId, excludeSaleId || null]);
  return Number(p.rows[0].quantity) - Number(s.rows[0].sold);
}

router.get('/', authenticate, can('view'), async (req, res) => {
  try {
    const where = ['t.deleted=false']; const vals = [];
    for (const c of ['customer_id', 'purchase_id']) {
      if (req.query[c]) { vals.push(req.query[c]); where.push(`t.${c}=$${vals.length}`); }
    }
    const r = await pool.query(`${VIEW} WHERE ${where.join(' AND ')} ORDER BY t.date DESC NULLS LAST, t.id DESC`, vals);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.get('/:id', authenticate, can('view'), async (req, res) => {
  try {
    const r = await pool.query(`${VIEW} WHERE t.id=$1 AND t.deleted=false`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'לא נמצא' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.post('/', authenticate, can('edit'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const vals = FIELDS.map(f => coerce(f, req.body[f.key]));
    const purchaseId = vals[COLS.indexOf('purchase_id')];
    const qty = vals[COLS.indexOf('quantity')] || 0;
    if (!purchaseId) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'יש לבחור חבילת רכישה' }); }
    if (qty <= 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'הכמות חייבת להיות גדולה מאפס' }); }

    const remaining = await remainingFor(client, purchaseId, null);
    if (remaining === null) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'חבילת הרכישה לא נמצאה' }); }
    if (qty > remaining) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `אין מספיק מלאי — נשארו ${remaining} יחידות בחבילה` });
    }

    const ph = COLS.map((_, i) => `$${i + 1}`).join(',');
    const r = await client.query(
      `INSERT INTO prod_sales (${COLS.join(',')}, created_by, updated_by)
       VALUES (${ph}, $${COLS.length + 1}, $${COLS.length + 1}) RETURNING *`,
      [...vals, req.user.id]);
    await client.query('COMMIT');
    await logAction(req.user, 'add', 'prod_sales', r.rows[0].id, {}, r.rows[0]);
    const full = await pool.query(`${VIEW} WHERE t.id=$1`, [r.rows[0].id]);
    res.status(201).json(full.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  } finally { client.release(); }
});

router.put('/:id', authenticate, can('edit'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const vals = FIELDS.map(f => coerce(f, req.body[f.key]));
    const purchaseId = vals[COLS.indexOf('purchase_id')];
    const qty = vals[COLS.indexOf('quantity')] || 0;
    if (!purchaseId) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'יש לבחור חבילת רכישה' }); }
    if (qty <= 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'הכמות חייבת להיות גדולה מאפס' }); }

    const remaining = await remainingFor(client, purchaseId, req.params.id);
    if (remaining === null) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'חבילת הרכישה לא נמצאה' }); }
    if (qty > remaining) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `אין מספיק מלאי — נשארו ${remaining} יחידות בחבילה` });
    }

    const set = COLS.map((c, i) => `${c}=$${i + 1}`).join(', ');
    const r = await client.query(
      `UPDATE prod_sales SET ${set}, updated_by=$${COLS.length + 1}, updated_at=NOW()
       WHERE id=$${COLS.length + 2} AND deleted=false RETURNING *`,
      [...vals, req.user.id, req.params.id]);
    if (!r.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'לא נמצא' }); }
    await client.query('COMMIT');
    await logAction(req.user, 'edit', 'prod_sales', req.params.id, {}, r.rows[0]);
    const full = await pool.query(`${VIEW} WHERE t.id=$1`, [req.params.id]);
    res.json(full.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  } finally { client.release(); }
});

router.delete('/:id', authenticate, can('del'), async (req, res) => {
  try {
    const ok = await softDelete('prod_sales', req.params.id, req.user);
    if (!ok) return res.status(404).json({ error: 'לא נמצא' });
    res.json({ message: 'הועבר לסל המחזור' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
