// הוצאות עסק כלליות — לא משויכות לספר
const { crudRouter } = require('./_crud');
module.exports = crudRouter('business_expenses', [
  { key: 'date', type: 'date' },
  { key: 'type', type: 'text' },
  { key: 'amount', type: 'num' },
  { key: 'note', type: 'text' },
], { orderBy: 't.date DESC NULLS LAST, t.id DESC' });
