// אבחון קבצים: מה רשום במסד, מה קיים בפועל על הדיסק, ומה מגובה לדרייב.
//   cd /opt/therapy-crm/app && node scripts/check_files.js
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { pool } = require('../db');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

(async () => {
  console.log('תיקיית הקבצים: ' + UPLOAD_DIR);
  console.log('קיימת: ' + (fs.existsSync(UPLOAD_DIR) ? 'כן' : '❌ לא!'));
  if (fs.existsSync(UPLOAD_DIR)) {
    console.log('קבצים בתיקייה: ' + fs.readdirSync(UPLOAD_DIR).length);
  }

  const r = await pool.query(`
    SELECT f.id, f.filename, f.stored_name, f.size_bytes, f.drive_url,
           p.last_name || ' ' || p.first_name AS patient
      FROM patient_files f JOIN patients p ON p.id=f.patient_id
     WHERE f.deleted=false ORDER BY f.id`);

  if (!r.rows.length) { console.log('\nאין קבצים רשומים.'); await pool.end(); process.exit(0); }

  console.log(`\n${r.rows.length} קבצים רשומים:\n`);
  let ok = 0, missing = 0;
  for (const f of r.rows) {
    const full = path.join(UPLOAD_DIR, path.basename(f.stored_name));
    const exists = fs.existsSync(full);
    const realSize = exists ? fs.statSync(full).size : 0;
    const sizeOk = exists && Number(realSize) === Number(f.size_bytes);
    console.log(`#${f.id} ${f.filename}  (${f.patient})`);
    console.log(`    בדיסק: ${exists ? '✔' : '❌ חסר'}${exists && !sizeOk ? ` ⚠️ גודל שונה (${realSize} מול ${f.size_bytes})` : ''}`);
    console.log(`    דרייב: ${f.drive_url ? '✔' : '—'}`);
    exists ? ok++ : missing++;
  }
  console.log(`\nסיכום: ${ok} תקינים${missing ? `, ${missing} חסרים מהדיסק` : ''}`);
  console.log('\nבדיקת הגשה מהשרת עצמו (עוקף nginx וחוסמי רשת):');
  console.log(`  curl -s -o /dev/null -w "%{http_code}\\n" http://127.0.0.1:${process.env.PORT || 3720}/api/health`);
  await pool.end();
  process.exit(0);
})().catch(e => { console.error('❌ ' + e.message); process.exit(1); });
