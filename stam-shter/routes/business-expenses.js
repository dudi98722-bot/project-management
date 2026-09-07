// הוצאות עסק כלליות — לא משויכות לספר.
// scribe_id: הוצאת תיקונים שמקוזזת מהחוב לסופר. שורה כזו אינה נספרת
// כהוצאת עסק בדוחות (ראה reports.js).
const { crudRouter } = require('./_crud');
module.exports = crudRouter('business_expenses', [
  { key: 'date', type: 'date' },
  { key: 'type', type: 'text' },
  { key: 'amount', type: 'num' },
  { key: 'scribe_id', type: 'int' },
  { key: 'note', type: 'text' },
], {
  cap: 'finance',
  orderBy: 't.date DESC NULLS LAST, t.id DESC',
  filterCols: ['scribe_id'],
  viewSql: `SELECT t.*, sc.name AS scribe_name
            FROM business_expenses t
            LEFT JOIN contacts sc ON sc.id = t.scribe_id`,
});
