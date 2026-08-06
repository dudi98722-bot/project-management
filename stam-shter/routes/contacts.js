// אנשי קשר — רשימה אחת שממנה נבחרים גם הסופרים וגם הרוכשים.
// השם שדה אחד (שם מלא), לא מפוצל לשם ומשפחה.
const { crudRouter } = require('./_crud');
module.exports = crudRouter('contacts', [
  { key: 'name', type: 'text' },
  { key: 'phone', type: 'text' },
], { orderBy: 't.name NULLS LAST' });
