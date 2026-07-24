// גדלי / סוגי קלפים — העלות ליחידה מזינה את צפי הקלף ואת הוצאות הקלף
const { crudRouter } = require('./_crud');
module.exports = crudRouter('parchment_sizes', [
  { key: 'name', type: 'text' },
  { key: 'cost_per_unit', type: 'num' },
], { orderBy: 't.name' });
