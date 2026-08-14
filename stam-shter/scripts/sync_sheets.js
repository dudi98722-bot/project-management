// סנכרון מלא של כל הנתונים הקיימים לגיליון הגוגל.
// מיועד להרצה חד-פעמית אחרי חיבור הגיבוי, או בכל פעם שרוצים לרענן
// את הגיליון מהמסד (השיקוף הוא upsert לפי מזהה, אז אפשר להריץ שוב בבטחה).
//   הרצה:  node scripts/sync_sheets.js
require('dotenv').config();
const { pool } = require('../db');
const sheets = require('../sheets');

// כולל רשומות מחוקות — כדי שהגיליון ישקף גם את מה שבסל המחזור
const TABLES = [
  'contacts', 'products', 'parchment_sizes', 'list_items',
  'scrolls', 'pages_log', 'scribe_payments', 'customer_payments',
  'book_expenses', 'parchment_expenses', 'business_expenses',
  'prod_purchases', 'prod_scribe_payments', 'prod_sales', 'prod_customer_payments',
];

(async () => {
  if (!sheets.enabled()) {
    console.error('❌ הגיבוי לשיטס לא מוגדר (BACKUP_WEBHOOK_URL / BACKUP_SECRET)');
    process.exit(1);
  }
  let total = 0;
  try {
    for (const t of TABLES) {
      const r = await pool.query(`SELECT * FROM ${t} ORDER BY id`);
      if (!r.rows.length) { console.log(`• ${t}: ריק`); continue; }
      await sheets.mirrorMany(t, r.rows);
      total += r.rows.length;
      console.log(`▶ ${t}: ${r.rows.length} רשומות נשלחו לתור`);
    }
    console.log(`\n⏳ ${total} רשומות בתור — ממתין לסיום השליחה...`);
    await sheets.drain();
    console.log('✅ הסנכרון הושלם');
    process.exit(0);
  } catch (e) {
    console.error('❌ שגיאה:', e.message);
    process.exit(1);
  }
})();
