// החזרת סחורה לסופר. חלה על כל רכישה — גם רגילה וגם קומיסיון.
// יחידה שהוחזרה יוצאת מהמלאי ואינה מחייבת תשלום לסופר.
// ההחזרה מוגבלת למה שבאמת נשאר בחבילה: אי אפשר להחזיר סחורה שכבר נמכרה.
const express = require('express');
const { pool, logAction, softDelete } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const router = express.Router();

const VIEW = `
SELECT t.*,
  pp.date        AS purchase_date,
  pp.quantity    AS purchase_qty,
  pp.purchase_type,
  COALESCE(pp.currency,'ILS') AS currency,
  pp.cost_per_unit,
  (COALESCE(t.quantity,0) * COALESCE(pp.cost_per_unit,0)) AS value,
  p.name  AS product_name,
  sc.name AS scribe_name
FROM prod_returns t
LEFT JOIN prod_purchases pp ON pp.id = t.purchase_id
LEFT JOIN products p        ON p.id  = pp.product_id
LEFT JOIN contacts sc       ON sc.id = pp.scribe_id`;

// כמה עוד אפשר להחזיר מהחבילה: מה שנקנה, פחות מה שנמכר ופחות מה שכבר הוחזר.
// excludeId — כדי שעריכת החזרה קיימת לא תיחשב כתופסת את עצמה.
async function returnableFor(client, purchaseId, excludeId) {
  const p = await client.query(
    'SELECT quantity FROM prod_purchases WHERE id=$1 AND deleted=false FOR UPDATE', [purchaseId]);
  if (!p.rows.length) return null;
  const s = await client.query(
    'SELECT COALESCE(SUM(quantity),0) AS sold FROM prod_sales WHERE purchase_id=$1 AND deleted=false',
    [purchaseId]);
  const r = await client.query(
    `SELECT COALESCE(SUM(quantity),0) AS returned FROM prod_returns
      WHERE purchase_id=$1 AND deleted=false AND ($2::bigint IS NULL OR id <> $2)`,
    [purchaseId, excludeId || null]);
  return Number(p.rows[0].quantity) - Number(s.rows[0].sold) - Number(r.rows[0].returned);
}

router.get('/', authenticate, can('view'), async (req, res) => {
  try {
    const where = ['t.deleted=false']; const vals = [];
    if (req.query.purchase_id) { vals.push(req.query.purchase_id); where.push(`t.purchase_id=$${vals.length}`); }
    if (req.query.scribe_id)   { vals.push(req.query.scribe_id);   where.push(`pp.scribe_id=$${vals.length}`); }
    const r = await pool.query(
      `${VIEW} WHERE ${where.join(' AND ')} ORDER BY t.date DESC NULLS LAST, t.id DESC`, vals);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.get('/:id', authenticate, can('view'), async (req, res) => {
  try {
    const r = await pool.query(`${VIEW} WHERE t.id=$1 AND t.deleted=false`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'לא נמצא' });
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// הבדיקה והכתיבה בטרנזקציה אחת עם נעילת שורת הרכישה — שתי החזרות
// במקביל היו יכולות יחד לחרוג ממה שבאמת נשאר.
async function write(req, res, id) {
  const purchaseId = req.body.purchase_id;
  const qty = Math.round(Number(req.body.quantity) || 0);
  if (!purchaseId) return res.status(400).json({ error: 'יש לבחור חבילת רכישה' });
  if (!(qty > 0)) return res.status(400).json({ error: 'כמות ההחזרה חייבת להיות גדולה מאפס' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const left = await returnableFor(client, purchaseId, id);
    if (left === null) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'חבילת הרכישה לא נמצאה' }); }
    if (qty > left) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: left > 0
          ? `אפשר להחזיר עד ${left} יחידות — השאר כבר נמכרו או הוחזרו`
          : 'אין מה להחזיר בחבילה הזו — הכל נמכר או כבר הוחזר',
      });
    }
    const vals = [req.body.date || null, purchaseId, qty, req.body.note || null, req.user.id];
    const r = id
      ? await client.query(
          `UPDATE prod_returns SET date=$1, purchase_id=$2, quantity=$3, note=$4, updated_by=$5, updated_at=NOW()
             WHERE id=$6 AND deleted=false RETURNING *`, [...vals, id])
      : await client.query(
          `INSERT INTO prod_returns (date, purchase_id, quantity, note, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$5) RETURNING *`, vals);
    if (!r.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'לא נמצא' }); }
    await client.query('COMMIT');
    await logAction(req.user, id ? 'edit' : 'add', 'prod_returns', r.rows[0].id, {}, r.rows[0]);
    const full = await pool.query(`${VIEW} WHERE t.id=$1`, [r.rows[0].id]);
    res.status(id ? 200 : 201).json(full.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  } finally { client.release(); }
}

router.post('/', authenticate, can('edit'), (req, res) => write(req, res, null));
router.put('/:id', authenticate, can('edit'), (req, res) => write(req, res, req.params.id));

router.delete('/:id', authenticate, can('del'), async (req, res) => {
  try {
    const ok = await softDelete('prod_returns', req.params.id, req.user);
    if (!ok) return res.status(404).json({ error: 'לא נמצא' });
    res.json({ message: 'הועבר לסל המחזור' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
