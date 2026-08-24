// תשלומי לקוחות (מערכת המוצרים) — אותה לוגיקת מט"ח כמו במערכת ס"ת
const { crudRouter } = require('./_crud');
module.exports = crudRouter('prod_customer_payments', [
  { key: 'date', type: 'date' },
  { key: 'customer_id', type: 'int' },
  { key: 'amount_ils', type: 'num' },
  { key: 'amount_usd', type: 'num' },
  { key: 'rate', type: 'num' },
  { key: 'cash_in_hand', type: 'num' },
  { key: 'note', type: 'text' },
], {
  cap: 'finance',
  orderBy: 't.date DESC NULLS LAST, t.id DESC',
  filterCols: ['customer_id'],
  viewSql: `SELECT t.*,
              cu.name AS customer_name,
              (COALESCE(t.amount_ils,0) + COALESCE(t.amount_usd,0) * COALESCE(t.rate,0)) AS paid_actual,
              (CASE WHEN COALESCE(t.amount_usd,0) > 0
                THEN COALESCE(t.amount_usd,0) * COALESCE(t.rate,0) - COALESCE(t.cash_in_hand,0) ELSE 0 END) AS peritah
            FROM prod_customer_payments t
            LEFT JOIN contacts cu ON cu.id = t.customer_id`,
});
