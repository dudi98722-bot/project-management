// אנשי קשר — רשימה אחת שממנה נבחרים גם הסופרים וגם הרוכשים.
// השם שדה אחד (שם מלא), לא מפוצל לשם ומשפחה.
const { crudRouter } = require('./_crud');
const { pool, logAction } = require('../db');
const { authenticate, can } = require('../middleware/auth');
let sheets = null;
try { sheets = require('../sheets'); } catch (e) { sheets = null; }
const router = crudRouter('contacts', [
  { key: 'name', type: 'text' },
  { key: 'phone', type: 'text' },
  // סיווג: ערכים מופרדים בפסיק, כי אדם יכול להיות סופר וגם רוכש
  { key: 'kinds', type: 'text' },
  { key: 'address', type: 'text' },
  { key: 'bank', type: 'text' },
  { key: 'bank_branch', type: 'text' },
  { key: 'bank_account', type: 'text' },
  // הקישור נכתב רק דרך מסלול ההעלאה, לא בעריכה ידנית
], { orderBy: 't.name NULLS LAST' });

// ---------- צילומים מצורפים ----------
// הקובץ עולה לתיקייה פרטית בדרייב ולא מקבל שיתוף ציבורי; הקישור נפתח
// רק למי שמחובר לחשבון גוגל עם גישה לתיקייה. במסד נשמר הקישור בלבד.
// שני הסוגים חולקים מסלול אחד, כדי שלא ייווצרו שתי לוגיקות העלאה שונות.
const MAX_BYTES = 8 * 1024 * 1024;
const OK_MIME = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/i;
const PHOTOS = {
  id:   { col: 'id_photo',   label: 'תז',          folder: 'id-photos' },
  cert: { col: 'cert_photo', label: 'תעודת סופר',  folder: 'id-photos' },
};

router.post('/:id/photo/:kind', authenticate, can('edit'), async (req, res) => {
  const spec = PHOTOS[req.params.kind];
  if (!spec) return res.status(400).json({ error: 'סוג צילום לא מוכר' });
  try {
    const { name, mime, data } = req.body || {};
    if (!data) return res.status(400).json({ error: 'לא התקבל קובץ' });
    if (!OK_MIME.test(String(mime || ''))) {
      return res.status(400).json({ error: 'סוג קובץ לא נתמך — תמונה או PDF בלבד' });
    }
    // base64 מנפח בכשליש; הבדיקה היא על הגודל האמיתי
    const bytes = Math.floor(String(data).length * 3 / 4);
    if (bytes > MAX_BYTES) {
      return res.status(413).json({ error: `הקובץ גדול מדי (${Math.round(bytes / 1048576)}MB). המקסימום 8MB` });
    }
    const cur = await pool.query('SELECT id, name FROM contacts WHERE id=$1 AND deleted=false', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'איש הקשר לא נמצא' });

    if (!sheets || !sheets.enabled()) {
      return res.status(503).json({ error: 'החיבור לדרייב אינו מוגדר. הגדר BACKUP_WEBHOOK_URL ו-BACKUP_SECRET' });
    }
    const ext = String(name || '').match(/\.[a-z0-9]+$/i);
    const fileName = `${spec.label} - ${cur.rows[0].name || cur.rows[0].id}${ext ? ext[0] : ''}`;
    const up = await sheets.uploadFile({ name: fileName, mime, data, folder: spec.folder });

    const r = await pool.query(
      `UPDATE contacts SET ${spec.col}_url=$1, ${spec.col}_name=$2, updated_by=$3, updated_at=NOW()
       WHERE id=$4 RETURNING id, ${spec.col}_url, ${spec.col}_name`,
      [up.url, fileName, req.user.id, req.params.id]);
    // בלוג נרשם רק שהועלה צילום — לא הקישור, שלא יישמר בגיליון הפעולות
    await logAction(req.user, 'photo', 'contacts', req.params.id, { kind: req.params.kind, uploaded: true });
    res.json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'ההעלאה נכשלה: ' + e.message });
  }
});

// הסרת הקישור. הקובץ נשאר בדרייב — מחיקה משם היא פעולה בלתי הפיכה
// שראוי שתיעשה במודע בדרייב עצמו.
router.delete('/:id/photo/:kind', authenticate, can('edit'), async (req, res) => {
  const spec = PHOTOS[req.params.kind];
  if (!spec) return res.status(400).json({ error: 'סוג צילום לא מוכר' });
  try {
    const r = await pool.query(
      `UPDATE contacts SET ${spec.col}_url=NULL, ${spec.col}_name=NULL, updated_by=$1, updated_at=NOW()
       WHERE id=$2 AND deleted=false RETURNING id`, [req.user.id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'לא נמצא' });
    await logAction(req.user, 'photo-remove', 'contacts', req.params.id, { kind: req.params.kind });
    res.json({ message: 'הקישור הוסר. הקובץ עצמו נשאר בדרייב' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
