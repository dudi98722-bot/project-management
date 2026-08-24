// תחנות במסלול הייצור — משרד, מוחק, מגיה, תופר וכו'
const { crudRouter } = require('./_crud');
module.exports = crudRouter('stations', [
  { key: 'name', type: 'text' },
  { key: 'sort', type: 'int' },
  { key: 'color', type: 'text' },
], { orderBy: 't.sort, t.name' });
