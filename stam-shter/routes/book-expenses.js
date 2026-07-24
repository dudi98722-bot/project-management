// הוצאות לספר — הסוג קובע ניתוב: המסומן כ"תיקונים" נזקף לצד הסופר, השאר הוצאות לספר
const { crudRouter } = require('./_crud');
module.exports = crudRouter('book_expenses', [
  { key: 'scroll_id', type: 'int' },
  { key: 'type', type: 'text' },
  { key: 'date', type: 'date' },
  { key: 'amount', type: 'num' },
  { key: 'note', type: 'text' },
], {
  orderBy: 't.date DESC NULLS LAST, t.id DESC',
  filterCols: ['scroll_id'],
  viewSql: `SELECT t.*, COALESCE(li.is_correction,false) AS is_correction
            FROM book_expenses t
            LEFT JOIN list_items li
              ON li.list_name='expense_book' AND li.value = t.type AND li.deleted=false`,
});
