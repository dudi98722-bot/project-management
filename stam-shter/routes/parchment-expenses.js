// הוצאות קלף — לשונית ייעודית. סך העלות מחושב מהגודל שנבחר ומזין את "עלות קלף בפועל".
const { crudRouter } = require('./_crud');
module.exports = crudRouter('parchment_expenses', [
  { key: 'scroll_id', type: 'int' },
  { key: 'date', type: 'date' },
  { key: 'quantity', type: 'num' },
  { key: 'parchment_size_id', type: 'int' },
  { key: 'note', type: 'text' },
], {
  orderBy: 't.date DESC NULLS LAST, t.id DESC',
  filterCols: ['scroll_id'],
  viewSql: `SELECT t.*, z.name AS size_name,
              COALESCE(z.cost_per_unit,0) AS cost_per_unit,
              (t.quantity * COALESCE(z.cost_per_unit,0)) AS total_cost
            FROM parchment_expenses t
            LEFT JOIN parchment_sizes z ON z.id = t.parchment_size_id`,
});
