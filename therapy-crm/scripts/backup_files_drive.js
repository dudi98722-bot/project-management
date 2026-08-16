// גיבוי ל-Google Drive של קבצים שטרם גובו (או שהגיבוי שלהם נכשל).
// רץ אוטומטית על כל העלאה חדשה; זה להשלמת מה שנשאר מאחור.
//   cd /opt/therapy-crm/app && node scripts/backup_files_drive.js
//
// ניקוי רשומות של קבצים שהקובץ שלהם כבר לא על הדיסק (ולכן אין מה לגבות):
//   node scripts/backup_files_drive.js --prune-missing
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { pool } = require('../db');
const sheets = require('../sheets');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

const PRUNE = process.argv.includes('--prune-missing');

(async () => {
  // ניקוי בלבד — לא נוגע בגיליון, ולכן לא דורש חיבור
  if (PRUNE) {
    const r = await pool.query(
      `SELECT f.id, f.filename, f.stored_name, p.last_name || ' ' || p.first_name AS patient_name
         FROM patient_files f JOIN patients p ON p.id=f.patient_id
        WHERE f.deleted=false AND f.drive_url IS NULL ORDER BY f.id`);
    const gone = r.rows.filter(f => !fs.existsSync(path.join(UPLOAD_DIR, path.basename(f.stored_name))));
    if (!gone.length) { console.log('✔ אין רשומות של קבצים חסרים'); await pool.end(); process.exit(0); }
    console.log(`נמצאו ${gone.length} רשומות שהקובץ שלהן חסר מהדיסק:`);
    gone.forEach(f => console.log(`   • ${f.filename}  (${f.patient_name})`));
    for (const f of gone) {
      await pool.query(
        `UPDATE patient_files SET deleted=true, deleted_at=NOW(), drive_error='הקובץ אבד מהדיסק' WHERE id=$1`, [f.id]);
    }
    console.log(`\n✅ ${gone.length} רשומות סומנו כמחוקות. צריך להעלות את הקבצים מחדש.`);
    await pool.end();
    process.exit(0);
  }

  if (!sheets.enabled()) {
    console.error('❌ הגיליון לא מחובר (SHEETS_WEBHOOK_URL ריק) — הרץ קודם את setup-sheets-therapy.sh');
    process.exit(1);
  }
  try { await sheets.verify(); }
  catch (e) { console.error('❌ אין חיבור: ' + e.message); process.exit(1); }

  const r = await pool.query(`
    SELECT f.id, f.filename, f.stored_name, f.mime,
           p.last_name || ' ' || p.first_name AS patient_name
      FROM patient_files f
      JOIN patients p ON p.id = f.patient_id
     WHERE f.deleted = false AND f.drive_url IS NULL
     ORDER BY f.id`);

  if (!r.rows.length) { console.log('✔ כל הקבצים כבר מגובים'); await pool.end(); process.exit(0); }
  console.log(`נמצאו ${r.rows.length} קבצים לגיבוי\n`);

  let ok = 0, failed = 0, missing = 0;
  for (const f of r.rows) {
    const full = path.join(UPLOAD_DIR, path.basename(f.stored_name));
    if (!fs.existsSync(full)) {
      console.log(`• ${f.filename}: ⚠️  חסר מהדיסק — מדלג`);
      await pool.query('UPDATE patient_files SET drive_error=$1 WHERE id=$2', ['הקובץ חסר מהדיסק', f.id]);
      missing++; continue;
    }
    process.stdout.write(`• ${f.filename} (${f.patient_name})... `);
    try {
      const up = await sheets.uploadFile({
        name: f.filename, mime: f.mime, base64: fs.readFileSync(full).toString('base64'),
        patient: f.patient_name, ref: String(f.id),
      });
      await pool.query('UPDATE patient_files SET drive_url=$1, drive_id=$2, drive_error=NULL WHERE id=$3',
        [up.url, up.id, f.id]);
      console.log('✔');
      ok++;
    } catch (e) {
      console.log('❌ ' + e.message);
      await pool.query('UPDATE patient_files SET drive_error=$1 WHERE id=$2', [String(e.message).slice(0, 300), f.id]);
      failed++;
    }
  }
  console.log(`\n✅ גובו ${ok}${failed ? `, נכשלו ${failed}` : ''}${missing ? `, חסרים ${missing}` : ''}`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('❌ ' + e.message); process.exit(1); });
