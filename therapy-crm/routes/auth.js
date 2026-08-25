const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('../db');
const mailer = require('../lib/mailer');
const { authenticate, ROLES, forgetPassword } = require('../middleware/auth');
const router = express.Router();

// הגנת brute-force: חסימה אחרי 8 ניסיונות כושלים ב-15 דקות לפי שם המשתמש
const ATTEMPT_LIMIT = 8, WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map();
function isBlocked(key) {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW_MS) { attempts.delete(key); return false; }
  return a.count >= ATTEMPT_LIMIT;
}
function registerFail(key) {
  const a = attempts.get(key) || { count: 0, first: Date.now() };
  if (Date.now() - a.first > WINDOW_MS) { a.count = 0; a.first = Date.now(); }
  a.count++; attempts.set(key, a);
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'שם משתמש וסיסמא חובה' });
  const key = String(username).toLowerCase().trim();
  if (isBlocked(key)) return res.status(429).json({ error: 'יותר מדי ניסיונות התחברות. נסה שוב בעוד 15 דקות' });
  try {
    const result = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
    if (result.rows.length === 0) { registerFail(key); return res.status(401).json({ error: 'שם משתמש או סיסמא שגויים' }); }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) { registerFail(key); return res.status(401).json({ error: 'שם משתמש או סיסמא שגויים' }); }
    if (user.active === false) return res.status(403).json({ error: 'המשתמש מושבת' });
    attempts.delete(key);
    await pool.query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, full_name: user.full_name },
      process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '12h' });
    const caps = ROLES[user.role] || ROLES.viewer;
    res.json({ token, user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name, caps } });
  } catch (err) { console.error(err); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: Object.assign({}, req.user, { caps: req.caps }) });
});

router.post('/logout', authenticate, (req, res) => res.json({ message: 'התנתקת בהצלחה' }));

// ===== שחזור סיסמה במייל =====
// התשובה תמיד זהה, גם כשהמייל לא קיים — אחרת אפשר לגלות מי רשום במערכת.
const RESET_TTL_MIN = 60;
// שם משתמש/שם מלא נכנסים ל-HTML של המייל
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const resetAttempts = new Map();

// הגבלה גם לפי כתובת המייל וגם לפי כתובת ה-IP, עם תקרה לגודל המפה
// כדי שלא תתנפח מבקשות עם כתובות מומצאות.
const MAX_KEYS = 5000;
function resetBlocked(key, limit) {
  const a = resetAttempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW_MS) { resetAttempts.delete(key); return false; }
  return a.count >= limit;
}
function resetHit(key) {
  if (resetAttempts.size > MAX_KEYS) {
    const cutoff = Date.now() - WINDOW_MS;
    for (const [k, v] of resetAttempts) if (v.first < cutoff) resetAttempts.delete(k);
    if (resetAttempts.size > MAX_KEYS) resetAttempts.clear();
  }
  const a = resetAttempts.get(key) || { count: 0, first: Date.now() };
  if (Date.now() - a.first > WINDOW_MS) { a.count = 0; a.first = Date.now(); }
  a.count++; resetAttempts.set(key, a);
}

router.post('/forgot', async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const generic = { ok: true, message: 'אם הכתובת רשומה במערכת, נשלח אליה מייל עם שם המשתמש וקישור לאיפוס' };
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'כתובת מייל לא תקינה' });
  }
  const ip = 'ip:' + (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (resetBlocked(email, 5) || resetBlocked(ip, 20)) {
    return res.status(429).json({ error: 'יותר מדי בקשות. נסה שוב בעוד 15 דקות' });
  }
  resetHit(email); resetHit(ip);

  // התשובה נשלחת מיד, והעבודה נמשכת ברקע — אחרת זמן התגובה היה מסגיר
  // אילו כתובות רשומות במערכת (מייל קיים = שליחת מייל = תשובה איטית).
  res.json(generic);
  try {
    const r = await pool.query('SELECT id, username, full_name, active FROM users WHERE lower(email)=$1', [email]);
    const user = r.rows[0];
    if (!user || user.active === false) return;
    if (!mailer.enabled()) {
      console.error('בקשת שחזור סיסמה אך SMTP לא מוגדר — המשתמש לא יקבל מייל:', user.username);
      return;
    }

    // הטוקן נשלח במייל, ובמסד נשמר רק ה-hash שלו
    const token = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    await pool.query('UPDATE password_resets SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL', [user.id]);
    await pool.query(
      "INSERT INTO password_resets (token, user_id, expires_at) VALUES ($1,$2, NOW() + ($3 || ' minutes')::interval)",
      [hash, user.id, String(RESET_TTL_MIN)]);

    const base = (process.env.APP_URL || '').replace(/\/+$/, '');
    const link = base + '/?reset=' + token;
    await mailer.send({
      to: email,
      subject: 'פסיכולוגיה מסילות — שחזור גישה למערכת',
      text: `שם המשתמש שלך: ${user.username}\nלאיפוס הסיסמה: ${link}\nהקישור תקף ${RESET_TTL_MIN} דקות.`,
      html: `<div style="font-family:Arial;direction:rtl;text-align:right">
        <h2 style="color:#2856a8">פסיכולוגיה מסילות</h2>
        <p>שלום${user.full_name ? ' ' + esc(user.full_name) : ''},</p>
        <p>שם המשתמש שלך במערכת הוא: <b>${esc(user.username)}</b></p>
        <p>לבחירת סיסמה חדשה:</p>
        <p><a href="${link}" style="background:#2856a8;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">איפוס סיסמה</a></p>
        <p style="color:#66738a;font-size:13px">הקישור תקף ${RESET_TTL_MIN} דקות ולשימוש חד-פעמי.
        אם לא ביקשת זאת, אפשר להתעלם מהמייל — הסיסמה לא תשתנה.</p>
      </div>`,
    });
  } catch (e) {
    console.error('שחזור סיסמה נכשל:', e.message);   // התשובה כבר נשלחה
  }
});

router.post('/reset', async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'חסר טוקן או סיסמה' });
  if (String(password).length < 8) return res.status(400).json({ error: 'הסיסמה חייבת להיות באורך 8 תווים לפחות' });
  try {
    const hash = crypto.createHash('sha256').update(String(token)).digest('hex');
    const r = await pool.query(
      `SELECT pr.user_id, u.username FROM password_resets pr JOIN users u ON u.id = pr.user_id
        WHERE pr.token=$1 AND pr.used_at IS NULL AND pr.expires_at > NOW()`, [hash]);
    if (!r.rows.length) return res.status(400).json({ error: 'הקישור פג תוקף או כבר נוצל. בקש קישור חדש' });

    const pw = await bcrypt.hash(String(password), 10);
    // password_changed_at מבטל טוקנים שהונפקו לפני האיפוס
    await pool.query('UPDATE users SET password_hash=$1, password_changed_at=NOW() WHERE id=$2', [pw, r.rows[0].user_id]);
    await pool.query('UPDATE password_resets SET used_at=NOW() WHERE token=$1', [hash]);
    forgetPassword(r.rows[0].user_id);
    res.json({ ok: true, username: r.rows[0].username });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
