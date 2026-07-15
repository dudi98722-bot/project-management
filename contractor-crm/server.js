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

// API routes
app.use('/api/auth',           require('./routes/auth'));
app.use('/api/users',          require('./routes/users'));
app.use('/api/subcontractors', require('./routes/subcontractors'));
app.use('/api/projects',       require('./routes/projects'));
app.use('/api/stages',         require('./routes/stages'));
app.use('/api/transactions',   require('./routes/transactions'));
app.use('/api/home',           require('./routes/home'));
app.use('/api/payment-requests', require('./routes/payreq'));
app.use('/api/reports',        require('./routes/reports'));
app.use('/api/uploads',        require('./routes/uploads'));
app.use('/api/recycle',        require('./routes/recycle'));

// חשבוניות שנשמרו מקומית - מוגשות כהורדה בלבד, לעולם לא נרנדרות כקוד מהאתר
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  index: false,
  setHeaders(res) {
    res.setHeader('Content-Disposition', 'attachment');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  }
}));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Frontend
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

// החלת סכימה על העלייה (idempotent — CREATE TABLE IF NOT EXISTS בלבד).
// מבטיח שטבלאות/עמודות חדשות נוצרות גם אחרי עדכון רגיל (git pull + restart)
// בלי צורך להריץ scripts/init_db.js ידנית. לעולם לא נוגע בנתונים קיימים.
async function ensureSchema() {
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('✔ סכימה מעודכנת (migrations הוחלו)');
  } catch (e) {
    console.error('⚠️ החלת סכימה נכשלה:', e.message);
  }
}

const PORT = process.env.PORT || 3000;
ensureSchema().finally(() => {
  app.listen(PORT, () => {
    console.log(`✅ Contractor CRM running on port ${PORT}  (${process.env.NODE_ENV || 'development'})`);
  });
});
