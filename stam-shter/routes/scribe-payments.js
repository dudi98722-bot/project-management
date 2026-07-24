// תשלומים לסופר (מערכת ס"ת) — "יתרה לתשלום" מחושבת ברמת הספר ב-calc.js
const { crudRouter } = require('./_crud');
module.exports = crudRouter('scribe_payments', [
  { key: 'scroll_id', type: 'int' },
  { key: 'date', type: 'date' },
  { key: 'amount', type: 'num' },
  { key: 'note', type: 'text' },
], { orderBy: 't.date DESC NULLS LAST, t.id DESC', filterCols: ['scroll_id'] });
