const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { authenticate, ROLES } = require('../middleware/auth');
const router = express.Router();

// הגנת brute-force: חסימת IP אחרי 8 ניסיונות כושלים ב-15 דקות
const ATTEMPT_LIMIT = 8, WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map();
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}
function isBlocked(ip) {
  const a = attempts.get(ip);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW_MS) { attempts.delete(ip); return false; }
  return a.count >= ATTEMPT_LIMIT;
}
function registerFail(ip) {
  const a = attempts.get(ip) || { count: 0, first: Date.now() };
  if (Date.now() - a.first > WINDOW_MS) { a.count = 0; a.first = Date.now(); }
  a.count++;
  attempts.set(ip, a);
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const ip = clientIp(req);
  if (isBlocked(ip)) return res.status(429).json({ error: 'יותר מדי ניסיונות התחברות. נסה שוב בעוד 15 דקות' });
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'שם משתמש וסיסמא חובה' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) { registerFail(ip); return res.status(401).json({ error: 'שם משתמש או סיסמא שגויים' }); }

    const user = result.rows[0];
    if (user.active === false) return res.status(403).json({ error: 'המשתמש מושבת' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) { registerFail(ip); return res.status(401).json({ error: 'שם משתמש או סיסמא שגויים' }); }
    attempts.delete(ip);

    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, full_name: user.full_name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
    );

    const caps = ROLES[user.role] || ROLES.field;
    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name, caps }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// GET /api/auth/me - מחזיר את המשתמש והיכולות שלו
router.get('/me', authenticate, (req, res) => {
  res.json({ user: Object.assign({}, req.user, { caps: req.caps }) });
});

router.post('/logout', authenticate, (req, res) => res.json({ message: 'התנתקת בהצלחה' }));

module.exports = router;
