// תשלומים לסופר (מערכת המוצרים) — מצטבר ברמת הסופר, לא לפי רכישה בודדת
const { crudRouter } = require('./_crud');
module.exports = crudRouter('prod_scribe_payments', [
  { key: 'date', type: 'date' },
  { key: 'scribe_id', type: 'int' },
  { key: 'amount', type: 'num' },
  { key: 'note', type: 'text' },
], {
  orderBy: 't.date DESC NULLS LAST, t.id DESC',
  filterCols: ['scribe_id'],
  viewSql: `SELECT t.*,
              TRIM(COALESCE(sc.first_name,'') || ' ' || COALESCE(sc.last_name,'')) AS scribe_name
            FROM prod_scribe_payments t
            LEFT JOIN contacts sc ON sc.id = t.scribe_id`,
});
