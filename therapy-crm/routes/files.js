// קבצים מצורפים למטופל. הקבצים נשמרים בדיסק מחוץ לתיקייה הציבורית,
// עם שם אקראי, ומוגשים רק למשתמש מחובר — תמיד כהורדה ולא כתצוגה בדפדפן
// (קובץ HTML/SVG שמוגש inline יכול להריץ סקריפט בהקשר של המערכת).
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pool, logAction, validId } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const sheets = require('../sheets');
const router = express.Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// נמוך מ-client_max_body_size של nginx (20M), אחרת nginx חוסם קודם
// והמשתמש מקבל שגיאת HTML במקום הודעה ברורה.
const MAX_MB = Number(process.env.UPLOAD_MAX_MB || 15);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  // שם אקראי לחלוטין — שם מהמשתמש לעולם לא נוגע במערכת הקבצים
  filename: (req, file, cb) => cb(null, crypto.randomBytes(20).toString('hex')),
});
const upload = multer({ storage, limits: { fileSize: MAX_MB * 1024 * 1024, files: 10 } });

// שם הקובץ המקורי מגיע מהדפדפן ב-latin1; מחזירים אותו ל-UTF-8 כדי שעברית תישמר
function originalName(file) {
  const raw = Buffer.from(file.originalname, 'latin1').toString('utf8');
  return raw.replace(/[\r\n\t]/g, ' ').slice(0, 200) || 'קובץ';
}

router.get('/limits', authenticate, (req, res) => res.json({ max_mb: MAX_MB, drive: sheets.enabled() }));

// ===== גיבוי ל-Google Drive =====
// רץ ברקע אחרי שהקובץ כבר נשמר בדיסק ובמסד — כישלון גיבוי לא מפיל העלאה.
// ניתן להריץ שוב על מה שלא גובה: node scripts/backup_files_drive.js
async function backupToDrive(fileRow, patientName) {
  if (!sheets.enabled()) return;
  const full = path.join(UPLOAD_DIR, path.basename(fileRow.stored_name));
  try {
    const base64 = fs.readFileSync(full).toString('base64');
    const r = await sheets.uploadFile({
      name: fileRow.filename, mime: fileRow.mime, base64,
      patient: patientName, ref: String(fileRow.id),
    });
    await pool.query('UPDATE patient_files SET drive_url=$1, drive_id=$2, drive_error=NULL WHERE id=$3',
      [r.url, r.id, fileRow.id]);
    return r;
  } catch (e) {
    await pool.query('UPDATE patient_files SET drive_error=$1 WHERE id=$2',
      [String(e.message).slice(0, 300), fileRow.id]).catch(() => {});
    console.error('Drive backup failed for file', fileRow.id, e.message);
  }
}

router.get('/patient/:id', authenticate, async (req, res) => {
  const pid = validId(req.params.id);
  if (!pid) return res.status(400).json({ error: 'מזהה לא תקין' });
  try {
    const r = await pool.query(
      `SELECT id, patient_id, filename, mime, size_bytes, notes, uploaded_by_name, created_at,
              drive_url, drive_error
         FROM patient_files WHERE patient_id=$1 AND deleted=false ORDER BY created_at DESC`, [pid]);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.post('/patient/:id', authenticate, can('edit'), (req, res) => {
  upload.array('files', 10)(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `הקובץ גדול מדי (מקסימום ${MAX_MB}MB)` });
      console.error(err); return res.status(400).json({ error: 'העלאה נכשלה' });
    }
    const pid = validId(req.params.id);
    const files = req.files || [];
    if (!pid) return res.status(400).json({ error: 'מזהה לא תקין' });
    if (!files.length) return res.status(400).json({ error: 'לא נבחר קובץ' });

    const cleanup = () => files.forEach(f => { try { fs.unlinkSync(f.path); } catch (_) {} });
    try {
      const pr = await pool.query(
        `SELECT id, last_name || ' ' || first_name AS name FROM patients WHERE id=$1 AND deleted=false`, [pid]);
      if (!pr.rows.length) { cleanup(); return res.status(404).json({ error: 'מטופל לא נמצא' }); }
      const patientName = pr.rows[0].name;

      const saved = [];
      for (const f of files) {
        const r = await pool.query(
          `INSERT INTO patient_files (patient_id, filename, stored_name, mime, size_bytes, notes, uploaded_by, uploaded_by_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id, patient_id, filename, stored_name, mime, size_bytes, notes, uploaded_by_name, created_at`,
          [pid, originalName(f), path.basename(f.filename), f.mimetype, f.size,
           req.body.notes || null, req.user.id, req.user.full_name || req.user.username]);
        saved.push(r.rows[0]);
      }
      await logAction(req.user, 'add', 'patient_files', pid, { files: saved.map(s => s.filename) });
      // התשובה חוזרת מיד; הגיבוי ל-Drive ממשיך ברקע
      res.status(201).json(saved.map(({ stored_name, ...rest }) => rest));
      for (const s of saved) backupToDrive(s, patientName);
    } catch (e) {
      cleanup();
      console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
    }
  });
});

router.get('/:id/download', authenticate, async (req, res) => {
  const fid = validId(req.params.id);
  if (!fid) return res.status(400).json({ error: 'מזהה לא תקין' });
  try {
    const r = await pool.query('SELECT * FROM patient_files WHERE id=$1 AND deleted=false', [fid]);
    if (!r.rows.length) return res.status(404).json({ error: 'הקובץ לא נמצא' });
    const f = r.rows[0];
    // basename מגן מפני stored_name שהושחת איכשהו למחרוזת עם נתיב
    const full = path.join(UPLOAD_DIR, path.basename(f.stored_name));
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'הקובץ חסר מהשרת' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.download(full, f.filename);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.delete('/:id', authenticate, can('del'), async (req, res) => {
  const fid = validId(req.params.id);
  if (!fid) return res.status(400).json({ error: 'מזהה לא תקין' });
  try {
    const r = await pool.query(
      `UPDATE patient_files SET deleted=true, deleted_at=NOW(), deleted_by=$2
        WHERE id=$1 AND deleted=false RETURNING patient_id, filename`, [fid, req.user.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'לא נמצא' });
    await logAction(req.user, 'delete', 'patient_files', fid, r.rows[0]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
