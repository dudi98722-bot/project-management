// קטלוג מוצרים — עמודים, יחידות קלף והוצאה קבועה מזינים את חישובי הס"ת
const { crudRouter } = require('./_crud');
module.exports = crudRouter('products', [
  { key: 'name', type: 'text' },
  { key: 'parchment_units', type: 'num' },
  { key: 'pages', type: 'int' },
  { key: 'fixed_expense', type: 'num' },
], { orderBy: 't.name' });
