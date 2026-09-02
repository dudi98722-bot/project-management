// רכישות מוצרים מסופר — כל רכישה היא "חבילה" שממנה מוכרים.
// הקריאה מחזירה גם את יתרת המלאי בחבילה ואת סך התשלום המגיע לסופר עליה.
const { crudRouter } = require('./_crud');
const { softDeletePurchase } = require('../db');

module.exports = crudRouter('prod_purchases', [
  { key: 'date', type: 'date' },
  { key: 'scribe_id', type: 'int' },
  { key: 'product_id', type: 'int' },
  { key: 'quantity', type: 'int' },
  { key: 'cost_per_unit', type: 'num' },
  { key: 'extra_cost_per_unit', type: 'num' },
  { key: 'extra_cost_note', type: 'text' },
  { key: 'purchase_type', type: 'text' },
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
              COALESCE(sd.sold, 0) AS sold_qty,
              (COALESCE(t.quantity,0) - COALESCE(sd.sold, 0)) AS remaining_qty,
              (COALESCE(t.cost_per_unit,0) + COALESCE(t.extra_cost_per_unit,0)) AS unit_cost,
              (COALESCE(t.quantity,0) * COALESCE(t.cost_per_unit,0)) AS owed_scribe
            FROM prod_purchases t
            LEFT JOIN products p  ON p.id  = t.product_id
            LEFT JOIN contacts sc ON sc.id = t.scribe_id
            LEFT JOIN users ua ON ua.id = t.approved_by
            LEFT JOIN (
              SELECT purchase_id, SUM(quantity) AS sold
              FROM prod_sales WHERE deleted=false GROUP BY purchase_id
            ) sd ON sd.purchase_id = t.id`,
});
