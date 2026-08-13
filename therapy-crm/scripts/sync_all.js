// ייצוא מלא של כל מה שכבר במערכת אל הגיליון.
// רץ אוטומטית בסוף ההתחברות לגיליון, ואפשר להריץ שוב מתי שרוצים:
//   cd /opt/therapy-crm/app && node scripts/sync_all.js
// אידמפוטנטי — שורה קיימת מתעדכנת לפי המזהה, לא נוצרת פעמיים.
require('dotenv').config();
const { pool } = require('../db');
const sheets = require('../sheets');

const TABLES = [
  { table: 'therapists',       label: 'מטפלים',        sql: 'SELECT * FROM therapists ORDER BY id' },
  { table: 'therapist_groups', label: 'קבוצות מטפלים', sql: `
      SELECT g.*, COALESCE(string_agg(t.name, ', ' ORDER BY t.name), '') AS members
        FROM therapist_groups g
        LEFT JOIN group_members gm ON gm.group_id = g.id
        LEFT JOIN therapists t ON t.id = gm.therapist_id AND t.deleted = false
       GROUP BY g.id ORDER BY g.id` },
  { table: 'patients',         label: 'ממתינים',       sql: 'SELECT * FROM patients ORDER BY id' },
  { table: 'assignments',      label: 'סדרות טיפול',   sql: 'SELECT * FROM assignments ORDER BY id' },
  { table: 'sessions',         label: 'פגישות',        sql: 'SELECT * FROM sessions ORDER BY id' },
];

(async () => {
  if (!sheets.enabled()) {
    console.error('❌ הגיליון לא מחובר (SHEETS_WEBHOOK_URL ריק) — הרץ קודם את setup-sheets-therapy.sh');
    process.exit(1);
  }
  try {
    await sheets.verify();
  } catch (e) {
    console.error('❌ אין חיבור לגיליון: ' + e.message);
    process.exit(1);
  }

  let total = 0;
  for (const t of TABLES) {
    const r = await pool.query(t.sql);
    if (!r.rows.length) { console.log(`• ${t.label}: אין נתונים`); continue; }
    process.stdout.write(`• ${t.label}: שולח ${r.rows.length} שורות... `);
    await sheets.mirrorMany(t.table, r.rows, { strict: true });
    console.log('✔');
    total += r.rows.length;
  }
  console.log(`\n✅ הועברו ${total} שורות לגיליון`);
  await pool.end();
  process.exit(0);
})().catch(e => { console.error('❌ ' + e.message); process.exit(1); });
