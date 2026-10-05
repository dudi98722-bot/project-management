require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
// We authenticate via Bearer tokens (Authorization header), not cookies,
// so credentials:true is not needed and a wildcard origin is safe.
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*'
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// אף שדה טקסט במערכת (שמות, הערות, קטגוריות) לא צריך תגיות HTML.
// מנטרלים < ו-> בכל גוף בקשת כתיבה, כדי שתא מזויף באקסל או בטופס לא
// יוכל להפוך לקוד שרץ בדפדפן של מי שפותח את הטבלה. ‹ › נשארים קריאים.
// (לא חל על /api/auth, /api/users ו-/api/email - שם יש סיסמאות.)
function neutralizeTags(v) {
  if (typeof v === 'string') return v.replace(/</g, '\u2039').replace(/>/g, '\u203A');
  if (Array.isArray(v)) return v.map(neutralizeTags);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = neutralizeTags(v[k]);
    return o;
  }
  return v;
}
app.use(['/api/contacts', '/api/vows', '/api/payments', '/api/credits', '/api/settings'], (req, res, next) => {
  if (req.body && (req.method === 'POST' || req.method === 'PUT')) req.body = neutralizeTags(req.body);
  next();
});

// Routes
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/users',    require('./routes/users'));
app.use('/api/contacts', require('./routes/contacts'));
app.use('/api/vows',     require('./routes/vows'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/reports',  require('./routes/reports'));
app.use('/api/email',    require('./routes/email'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/reportlog', require('./routes/reportlog'));
app.use('/api/credits',   require('./routes/credits'));

// דיווח שגיאות מהדפדפן. בלי זה תקלה אצל משתמש נראית רק כ"מסך ריק",
// ואין דרך לדעת מה נפל. נכתב ליומן השרת (journalctl -u crm-backend).
const { authenticate } = require('./middleware/auth');
const _clientLogHits = new Map();   // משתמש -> [זמנים] - תקרה נגד הצפה
app.post('/api/clientlog', authenticate, (req, res) => {
  const now = Date.now(), key = req.user.username || String(req.user.id);
  const hits = (_clientLogHits.get(key) || []).filter(t => now - t < 60000);
  if (hits.length >= 20) return res.status(429).json({ ok: false });
  hits.push(now); _clientLogHits.set(key, hits);
  const b = req.body || {};
  const clip = (v, n) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' | ').slice(0, n);
  console.warn('[client-error] ' + JSON.stringify({
    user: req.user.username, role: req.user.role,
    where: clip(b.where, 80), msg: clip(b.msg, 500), stack: clip(b.stack, 1500),
    ua: clip(req.headers['user-agent'], 200)
  }));
  res.json({ ok: true });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Serve frontend (if built into public/)
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  const fs = require('fs');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// טיפול אחיד בשגיאות: JSON פגום מקבל 400 נקי, כל השאר 500 בלי דליפת פרטים
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'בקשה לא תקינה' });
  }
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'שגיאת שרת' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ CRM Server running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});
