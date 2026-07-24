// אתחול מסד: החלת סכימה, יצירת אדמין ראשוני, וזריעת רשימות ברירת מחדל.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');

// סוגי הוצאות לספר. "תיקונים" מסומן כדגל — סכומו נזקף לצד הסופר.
const EXPENSE_BOOK = [
  { value: 'תיקונים', is_correction: true },
  { value: 'הגהה ידנית' },
  { value: 'הגהת מחשב' },
  { value: 'תפירה' },
  { value: 'תגים' },
  { value: 'תיווך' },
  { value: 'מלמד' },
  { value: 'משלוחים' },
];

const EXPENSE_BUSINESS = ['שכר', 'שכ"ד', 'מימון', 'רכב', 'דלק', 'אינטרנט', 'משלוחים', 'רואה חשבון', 'מע"מ'];

(async () => {
  try {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('✔ סכימה הוחלה');

    // אדמין ראשוני
    const admins = await pool.query('SELECT COUNT(*)::int AS n FROM users');
    if (admins.rows[0].n === 0) {
      const u = process.env.ADMIN_USERNAME || 'admin';
      const p = process.env.ADMIN_PASSWORD || 'admin1234';
      const hash = await bcrypt.hash(p, 10);
      await pool.query('INSERT INTO users (username, password_hash, role, full_name) VALUES ($1,$2,$3,$4)',
        [u, hash, 'admin', 'מנהל ראשי']);
      console.log(`✔ נוצר משתמש אדמין: ${u}`);
    }

    // רשימות ברירת מחדל (רק אם ריק)
    const lc = await pool.query('SELECT COUNT(*)::int AS n FROM list_items');
    if (lc.rows[0].n === 0) {
      let i = 0;
      for (const item of EXPENSE_BOOK) {
        await pool.query('INSERT INTO list_items (list_name, value, sort, is_correction) VALUES ($1,$2,$3,$4)',
          ['expense_book', item.value, i++, !!item.is_correction]);
      }
      i = 0;
      for (const v of EXPENSE_BUSINESS) {
        await pool.query('INSERT INTO list_items (list_name, value, sort) VALUES ($1,$2,$3)',
          ['expense_business', v, i++]);
      }
      console.log('✔ נזרעו רשימות ברירת מחדל');
    }

    console.log('✅ אתחול הושלם');
    process.exit(0);
  } catch (e) { console.error('❌ שגיאת אתחול:', e); process.exit(1); }
})();
