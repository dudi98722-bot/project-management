// אנשי קשר — רשימה אחת שממנה נבחרים גם הסופרים וגם הרוכשים
const { crudRouter } = require('./_crud');
module.exports = crudRouter('contacts', [
  { key: 'first_name', type: 'text' },
  { key: 'last_name', type: 'text' },
  { key: 'phone', type: 'text' },
], { orderBy: 't.last_name NULLS LAST, t.first_name NULLS LAST' });
