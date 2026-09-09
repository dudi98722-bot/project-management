// דיווחי מכירה של לקוח קומיסיון — מה שהוא מכר הלאה מתוך מה שנמסר לו.
// כל דיווח מחייב אותו במחיר שנקבע לו במכירה, ובו-זמנית מחייב אותנו
// לסופר אם החבילה נרכשה בקומיסיון. עד הדיווח הסחורה מונחת אצלו ואינה חוב.
const express = require('express');
const { pool, logAction, softDelete } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const router = express.Router();

const VIEW = `
SELECT t.*,
  s.date         AS sale_date,
  s.quantity     AS sale_qty,
  s.price_per_unit,
  COALESCE(s.currency,'ILS') AS currency,
  s.customer_id,
  cu.name AS customer_name,
  p.name  AS product_name,
  sc.name AS scribe_name,
  s.purchase_id,
  (COALESCE(t.quantity,0) * COALESCE(s.price_per_unit,0)) AS value
FROM prod_consign_reports t
LEFT JOIN prod_sales s       ON s.id  = t.sale_id
LEFT JOIN contacts cu        ON cu.id = s.customer_id
LEFT JOIN prod_purchases pp  ON pp.id = s.purchase_id
LEFT JOIN products p         ON p.id  = pp.product_id
LEFT JOIN contacts sc        ON sc.id = pp.scribe_id`;

// כמה עוד מונח אצל הלקוח מהמכירה הזו וטרם דווח.
// excludeId — כדי שעריכת דיווח קיים לא תיחשב כתופסת את עצמה.
async function openFor(client, saleId, excludeId) {
  const s = await client.query(
    `SELECT quantity, sale_type FROM prod_sales WHERE id=$1 AND deleted=false FOR UPDATE`, [saleId]);
  if (!s.rows.length) return null;
  if (String(s.rows[0].sale_type) !== 'קומיסיון') return { notConsign: true };
  const r = await client.query(
    `SELECT COALESCE(SUM(quantity),0) AS reported FROM prod_consign_reports
      WHERE sale_id=$1 AND deleted=false AND ($2::bigint IS NULL OR id <> $2)`,
    [saleId, excludeId || null]);
  return { left: Number(s.rows[0].quantity) - Number(r.rows[0].reported) };
}

router.get('/', authenticate, can('view'), async (req, res) => {
  try {
    const where = ['t.deleted=false']; const vals = [];
    if (req.query.sale_id)     { vals.push(req.query.sale_id);     where.push(`t.sale_id=$${vals.length}`); }
    if (req.query.customer_id) { vals.push(req.query.customer_id); where.push(`s.customer_id=$${vals.length}`); }
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

// משמש גם את הפורטל של הלקוח, ולכן מקבל את מזהה המשתמש והדגל בנפרד
// ואינו סומך על גוף הבקשה לשיוך.
async function writeReport({ saleId, qty, date, note, user, byCustomer, id }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const st = await openFor(client, saleId, id);
    if (st === null) { await client.query('ROLLBACK'); return { code: 404, error: 'המכירה לא נמצאה' }; }
    if (st.notConsign) { await client.query('ROLLBACK'); return { code: 400, error: 'המכירה הזו אינה בקומיסיון' }; }
    if (!(qty > 0)) { await client.query('ROLLBACK'); return { code: 400, error: 'הכמות חייבת להיות גדולה מאפס' }; }
    if (qty > st.left) {
      await client.query('ROLLBACK');
      return { code: 400, error: st.left > 0
        ? `אפשר לדווח על עד ${st.left} יחידות — זה מה שנשאר מהמכירה הזו`
        : 'כל הכמות מהמכירה הזו כבר דווחה' };
    }
    const vals = [date || null, saleId, qty, note || null, !!byCustomer, user.id];
    const r = id
      ? await client.query(
          `UPDATE prod_consign_reports SET date=$1, sale_id=$2, quantity=$3, note=$4, by_customer=$5,
             updated_by=$6, updated_at=NOW() WHERE id=$7 AND deleted=false RETURNING *`, [...vals, id])
      : await client.query(
          `INSERT INTO prod_consign_reports (date, sale_id, quantity, note, by_customer, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING *`, vals);
    if (!r.rows.length) { await client.query('ROLLBACK'); return { code: 404, error: 'לא נמצא' }; }
    await client.query('COMMIT');
    await logAction(user, id ? 'edit' : 'add', 'prod_consign_reports', r.rows[0].id, { by_customer: !!byCustomer }, r.rows[0]);
    const full = await pool.query(`${VIEW} WHERE t.id=$1`, [r.rows[0].id]);
    return { code: id ? 200 : 201, row: full.rows[0] };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally { client.release(); }
}

const handler = (id) => async (req, res) => {
  try {
    const out = await writeReport({
      saleId: req.body.sale_id,
      qty: Math.round(Number(req.body.quantity) || 0),
      date: req.body.date, note: req.body.note,
      user: req.user, byCustomer: false,
      id: id ? req.params.id : null,
    });
    if (out.error) return res.status(out.code).json({ error: out.error });
    res.status(out.code).json(out.row);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
};

router.post('/', authenticate, can('edit'), handler(false));
router.put('/:id', authenticate, can('edit'), handler(true));

router.delete('/:id', authenticate, can('del'), async (req, res) => {
  try {
    const ok = await softDelete('prod_consign_reports', req.params.id, req.user);
    if (!ok) return res.status(404).json({ error: 'לא נמצא' });
    res.json({ message: 'הועבר לסל המחזור' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
module.exports.writeReport = writeReport;
