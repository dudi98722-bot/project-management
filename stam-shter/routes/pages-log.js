// יומן עמודים שנכתבו — הסכום המצטבר לכל ספר מזין את ההתקדמות של שני הצדדים
const { crudRouter } = require('./_crud');
module.exports = crudRouter('pages_log', [
  { key: 'scroll_id', type: 'int' },
  { key: 'date', type: 'date' },
  { key: 'pages', type: 'int' },
  { key: 'note', type: 'text' },
], { orderBy: 't.date DESC NULLS LAST, t.id DESC', filterCols: ['scroll_id'] });
