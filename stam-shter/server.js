require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { pool } = require('./db');

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ===== API =====
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));

// נתוני יסוד
app.use('/api/contacts', require('./routes/contacts'));
app.use('/api/lists', require('./routes/lists'));
app.use('/api/products', require('./routes/products'));
app.use('/api/parchment-sizes', require('./routes/parchment-sizes'));
app.use('/api/stations', require('./routes/stations'));

// מערכת א' — ס"ת
app.use('/api/scrolls', require('./routes/scrolls'));
app.use('/api/pages-log', require('./routes/pages-log'));
app.use('/api/scribe-payments', require('./routes/scribe-payments'));
app.use('/api/customer-payments', require('./routes/customer-payments'));
app.use('/api/book-expenses', require('./routes/book-expenses'));
app.use('/api/parchment-expenses', require('./routes/parchment-expenses'));
app.use('/api/business-expenses', require('./routes/business-expenses'));

// מערכת ב' — מוצרים
app.use('/api/prod/purchases', require('./routes/prod-purchases'));
app.use('/api/prod/scribe-payments', require('./routes/prod-scribe-payments'));
app.use('/api/prod/sales', require('./routes/prod-sales'));
app.use('/api/prod/customer-payments', require('./routes/prod-customer-payments'));

// דוחות + סל מחזור + ייבוא
app.use('/api/reports', require('./routes/reports'));
app.use('/api/recycle', require('./routes/recycle'));
app.use('/api/import', require('./routes/import'));
app.use('/api/track', require('./routes/track'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ===== Frontend =====
const PUB = path.join(__dirname, 'public');
// index:false — כדי ש-'/' יגיע למטפל שלנו שמזריק את חותמת הגרסה,
// ולא ייתפס כאן ויוגש כקובץ סטטי עם ?v=1 קפוא.
app.use(express.static(PUB, { index: false }));

// חותמת גרסה לפי זמן העדכון של קבצי הקוד. index.html מוגש עם no-cache
// והפניות ל-app.js/store.js מקבלות ?v=<חותמת>, כך שאחרי כל פריסה הדפדפן
// מוריד את הקוד החדש מעצמו — בלי שהמשתמש יצטרך לרענן בכוח.
function assetStamp() {
  let s = 0;
  for (const f of ['app.js', 'store.js', 'index.html']) {
    try { s = Math.max(s, fs.statSync(path.join(PUB, f)).mtimeMs); } catch (e) {}
  }
  return String(Math.floor(s));
}
app.get('*', (req, res) => {
  const indexPath = path.join(PUB, 'index.html');
  if (!fs.existsSync(indexPath)) return res.status(404).json({ error: 'Not found' });
  try {
    const html = fs.readFileSync(indexPath, 'utf8').replace(/\?v=[^"']*/g, '?v=' + assetStamp());
    res.set('Cache-Control', 'no-cache, must-revalidate');
    res.type('html').send(html);
  } catch (e) { res.sendFile(indexPath); }
});

// טיפול אחיד בשגיאות
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'בקשה לא תקינה' });
  }
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'שגיאת שרת' });
});

// החלת הסכימה בכל עלייה (idempotent) — טבלאות/עמודות חדשות נוצרות אחרי עדכון קוד
async function ensureSchema() {
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('✔ סכימה מעודכנת');
  } catch (e) { console.error('⚠️ החלת סכימה נכשלה:', e.message); }
}

const PORT = process.env.PORT || 3620;
ensureSchema().finally(() => {
  app.listen(PORT, () => console.log(`✅ stam-shter running on port ${PORT} (${process.env.NODE_ENV || 'development'})`));
});
