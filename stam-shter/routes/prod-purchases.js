// רכישות מוצרים מסופר — כל רכישה היא "חבילה" שממנה מוכרים.
// הקריאה מחזירה גם את יתרת המלאי בחבילה ואת סך התשלום המגיע לסופר עליה.
const { crudRouter } = require('./_crud');
const { softDeletePurchase } = require('../db');

// ברכישת קומיסיון החוב לסופר נוצר רק על מה שהתממש בפועל; ברכישה רגילה
// על כל מה שנקנה פחות מה שהוחזר לו. אותו כלל בדיוק חי גם ב-reports.js.
const IS_CONSIGN = "COALESCE(t.purchase_type,'רגיל')='קומיסיון'";
const OWED_QTY = `(CASE WHEN ${IS_CONSIGN}
                     THEN COALESCE(sd.realized,0)
                     ELSE GREATEST(COALESCE(t.quantity,0) - COALESCE(rt.returned,0), 0) END)`;
const CONSIGN_OPEN = `(CASE WHEN ${IS_CONSIGN}
                         THEN GREATEST(COALESCE(t.quantity,0) - COALESCE(rt.returned,0) - COALESCE(sd.realized,0), 0)
                         ELSE 0 END)`;

module.exports = crudRouter('prod_purchases', [
  { key: 'date', type: 'date' },
  { key: 'scribe_id', type: 'int' },
  { key: 'product_id', type: 'int' },
  { key: 'quantity', type: 'int' },
  { key: 'cost_per_unit', type: 'num' },
  { key: 'extra_cost_per_unit', type: 'num' },
  { key: 'extra_cost_note', type: 'text' },
  { key: 'purchase_type', type: 'text' },
  { key: 'currency', type: 'text' },
  { key: 'note', type: 'text' },
], {
  orderBy: 't.date DESC NULLS LAST, t.id DESC',
  filterCols: ['scribe_id', 'product_id'],
  softDeleteFn: softDeletePurchase,   // מחיקה מדביקה למכירות שנגזרו מהחבילה
  approvable: true,
  viewSql: `SELECT t.*,
              p.name AS product_name,
              sc.name AS scribe_name,
              ua.full_name AS approved_by_name,
              COALESCE(sd.sold, 0)     AS sold_qty,
              COALESCE(sd.realized, 0) AS realized_qty,
              COALESCE(rt.returned, 0) AS returned_qty,
              GREATEST(COALESCE(t.quantity,0) - COALESCE(sd.sold,0) - COALESCE(rt.returned,0), 0) AS remaining_qty,
              ${CONSIGN_OPEN} AS consign_open_qty,
              ${OWED_QTY} AS owed_qty,
              (COALESCE(t.cost_per_unit,0) + COALESCE(t.extra_cost_per_unit,0)) AS unit_cost,
              (${OWED_QTY} * COALESCE(t.cost_per_unit,0)) AS owed_scribe
            FROM prod_purchases t
            LEFT JOIN products p  ON p.id  = t.product_id
            LEFT JOIN contacts sc ON sc.id = t.scribe_id
            LEFT JOIN users ua ON ua.id = t.approved_by
            LEFT JOIN (
              SELECT purchase_id, SUM(quantity) AS returned
              FROM prod_returns WHERE deleted=false GROUP BY purchase_id
            ) rt ON rt.purchase_id = t.id
            LEFT JOIN (
              SELECT s.purchase_id,
                     SUM(COALESCE(s.quantity,0)) AS sold,
                     SUM(CASE WHEN COALESCE(s.sale_type,'רגיל')='קומיסיון'
                           THEN LEAST(COALESCE(cr.reported,0), COALESCE(s.quantity,0))
                           ELSE COALESCE(s.quantity,0) END) AS realized
              FROM prod_sales s
              LEFT JOIN (SELECT sale_id, SUM(quantity) AS reported
                           FROM prod_consign_reports WHERE deleted=false GROUP BY sale_id) cr
                ON cr.sale_id = s.id
              WHERE s.deleted=false GROUP BY s.purchase_id
            ) sd ON sd.purchase_id = t.id`,
});
