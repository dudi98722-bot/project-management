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

// דוחות + סל מחזור
app.use('/api/reports', require('./routes/reports'));
app.use('/api/recycle', require('./routes/recycle'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ===== Frontend =====
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else res.status(404).json({ error: 'Not found' });
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
