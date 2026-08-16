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
app.use('/api/lists', require('./routes/lists'));
app.use('/api/patients', require('./routes/patients'));
app.use('/api/therapists', require('./routes/therapists'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/assignments', require('./routes/assignments'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/import', require('./routes/import'));
app.use('/api/holidays', require('./routes/holidays'));
app.use('/api/files', require('./routes/files'));

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

// החלת סכימה על העלייה (idempotent) — טבלאות/עמודות חדשות נוצרות אחרי git pull + restart
async function ensureSchema() {
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('✔ סכימה מעודכנת');
  } catch (e) { console.error('⚠️ החלת סכימה נכשלה:', e.message); }
}

const PORT = process.env.PORT || 3720;
ensureSchema().finally(() => {
  app.listen(PORT, () => console.log(`✅ therapy-crm running on port ${PORT} (${process.env.NODE_ENV || 'development'})`));
});
