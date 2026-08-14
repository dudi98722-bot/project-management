// תשלומי לקוחות (מערכת ס"ת).
// מחושב בקריאה: עלות פריטה = דולר*שער − מזומן ביד ; שולם בפועל = ש"ח + דולר*שער.
const { crudRouter } = require('./_crud');
module.exports = crudRouter('customer_payments', [
  { key: 'scroll_id', type: 'int' },
  { key: 'customer_id', type: 'int' },
  { key: 'date', type: 'date' },
  { key: 'amount_ils', type: 'num' },
  { key: 'amount_usd', type: 'num' },
  { key: 'rate', type: 'num' },
  { key: 'cash_in_hand', type: 'num' },
  { key: 'note', type: 'text' },
], {
  orderBy: 't.date DESC NULLS LAST, t.id DESC',
  filterCols: ['scroll_id', 'customer_id'],
  // אם לא נרשם רוכש — נגזר מהספר, כי תשלום על ספר הוא מבעליו
  viewSql: `SELECT t.*,
              COALESCE(t.customer_id, s.customer_id) AS customer_id,
              cu.name AS customer_name,
              (COALESCE(t.amount_ils,0) + COALESCE(t.amount_usd,0) * COALESCE(t.rate,0)) AS paid_actual,
              (CASE WHEN COALESCE(t.amount_usd,0) > 0
                THEN COALESCE(t.amount_usd,0) * COALESCE(t.rate,0) - COALESCE(t.cash_in_hand,0) ELSE 0 END) AS peritah
            FROM customer_payments t
            LEFT JOIN scrolls  s  ON s.id  = t.scroll_id
            LEFT JOIN contacts cu ON cu.id = COALESCE(t.customer_id, s.customer_id)`,
});
