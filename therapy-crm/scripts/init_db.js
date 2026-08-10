// אתחול מסד: החלת סכימה, יצירת אדמין ראשוני, וזריעת רשימות ברירת מחדל.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');

const DEFAULT_LISTS = {
  community: ['חילוני', 'חסידי', 'ספרדי', 'גור', 'דתי לאומי', 'ליטאי'],
};

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
      for (const [list, vals] of Object.entries(DEFAULT_LISTS)) {
        for (let i = 0; i < vals.length; i++) {
          await pool.query('INSERT INTO list_items (list_name, value, sort) VALUES ($1,$2,$3)', [list, vals[i], i]);
        }
      }
      console.log('✔ נזרעו רשימות ברירת מחדל');
    }

    console.log('✅ אתחול הושלם');
    process.exit(0);
  } catch (e) { console.error('❌ שגיאת אתחול:', e); process.exit(1); }
})();
