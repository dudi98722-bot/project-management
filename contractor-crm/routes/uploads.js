const express = require('express');
const multer = require('multer');
const { authenticate, canAny } = require('../middleware/auth');
const { saveInvoice, driveConfigured, storageMode } = require('../drive');
const router = express.Router();

// מגבילים לסוגי חשבונית בטוחים בלבד (חוסם HTML/SVG/JS שעלולים לרוץ כקוד מהאתר)
const ALLOWED = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.has((file.mimetype || '').toLowerCase())) return cb(null, true);
    cb(new Error('סוג קובץ לא נתמך. יש להעלות PDF או תמונה'));
  },
});

// עוטף את multer כדי להחזיר 400 נקי (במקום 500) על קובץ פסול/גדול מדי
function uploadInvoice(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'העלאת הקובץ נכשלה' });
    next();
  });
}

// POST /api/uploads/invoice - העלאת חשבונית (עובד שטח / מדווח / כל מי שמזין תנועות)
// מחזיר { url } לשמירה בשדה invoice_url של התנועה
router.post('/invoice', authenticate, canAny(['writeTx', 'projectExpenseOnly']), uploadInvoice, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'לא צורף קובץ' });
  try {
    const { url, storage } = await saveInvoice(req.file.buffer, req.file.originalname, req.file.mimetype);
    res.json({ url, storage });
  } catch (e) {
    console.error('upload error:', e.message);
    res.status(500).json({ error: 'שמירת החשבונית נכשלה' });
  }
});

// GET /api/uploads/status - מצב אחסון החשבוניות (appsscript / drive / local)
router.get('/status', authenticate, (req, res) => {
  res.json({ storage: storageMode() });
});

module.exports = router;
