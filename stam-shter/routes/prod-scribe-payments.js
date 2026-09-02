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
  approvable: true,
  viewSql: `SELECT t.*,
              sc.name AS scribe_name,
              ua.full_name AS approved_by_name
            FROM prod_scribe_payments t
            LEFT JOIN contacts sc ON sc.id = t.scribe_id
            LEFT JOIN users ua ON ua.id = t.approved_by`,
});
