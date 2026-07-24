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
  orderBy: 't.date DESC NULLS LAST, t.id DESC',
  filterCols: ['customer_id'],
  viewSql: `SELECT t.*,
              TRIM(COALESCE(cu.first_name,'') || ' ' || COALESCE(cu.last_name,'')) AS customer_name,
              (t.amount_ils + t.amount_usd * t.rate) AS paid_actual,
              (CASE WHEN t.amount_usd > 0 THEN t.amount_usd * t.rate - t.cash_in_hand ELSE 0 END) AS peritah
            FROM prod_customer_payments t
            LEFT JOIN contacts cu ON cu.id = t.customer_id`,
});
