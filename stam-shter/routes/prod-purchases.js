// רכישות מוצרים מסופר — כל רכישה היא "חבילה" שממנה מוכרים.
// הקריאה מחזירה גם את יתרת המלאי בחבילה ואת החוב לסופר.
const { crudRouter } = require('./_crud');
const { softDeletePurchase } = require('../db');

module.exports = crudRouter('prod_purchases', [
  { key: 'date', type: 'date' },
  { key: 'scribe_id', type: 'int' },
  { key: 'product_id', type: 'int' },
  { key: 'quantity', type: 'int' },
  { key: 'cost_per_unit', type: 'num' },
  { key: 'extra_cost_per_unit', type: 'num' },
  { key: 'purchase_type', type: 'text' },
  { key: 'note', type: 'text' },
], {
  orderBy: 't.date DESC NULLS LAST, t.id DESC',
  filterCols: ['scribe_id', 'product_id'],
  softDeleteFn: softDeletePurchase,   // מחיקה מדביקה למכירות שנגזרו מהחבילה
  viewSql: `SELECT t.*,
              p.name AS product_name,
              TRIM(COALESCE(sc.first_name,'') || ' ' || COALESCE(sc.last_name,'')) AS scribe_name,
              COALESCE(sd.sold, 0) AS sold_qty,
              (t.quantity - COALESCE(sd.sold, 0)) AS remaining_qty,
              (t.cost_per_unit + t.extra_cost_per_unit) AS unit_cost,
              (t.quantity * t.cost_per_unit) AS owed_scribe
            FROM prod_purchases t
            LEFT JOIN products p  ON p.id  = t.product_id
            LEFT JOIN contacts sc ON sc.id = t.scribe_id
            LEFT JOIN (
              SELECT purchase_id, SUM(quantity) AS sold
              FROM prod_sales WHERE deleted=false GROUP BY purchase_id
            ) sd ON sd.purchase_id = t.id`,
});
