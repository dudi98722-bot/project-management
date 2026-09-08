// יומן שיחות — מתי דיברנו עם איש הקשר ומה נאמר
const { crudRouter } = require('./_crud');
module.exports = crudRouter('contact_calls', [
  { key: 'contact_id', type: 'int' },
  { key: 'date', type: 'date' },
  { key: 'summary', type: 'text' },
], {
  orderBy: 't.date DESC NULLS LAST, t.id DESC',
  filterCols: ['contact_id'],
  viewSql: `SELECT t.*, c.name AS contact_name, u.full_name AS created_by_name
            FROM contact_calls t
            LEFT JOIN contacts c ON c.id = t.contact_id
            LEFT JOIN users u ON u.id = t.created_by`,
});
