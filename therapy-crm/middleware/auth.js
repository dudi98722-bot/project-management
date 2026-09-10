const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { ROLES, capsFor } = require('../lib/permissions');

// ההרשאות עצמן — קטלוג הפעולות, ברירות המחדל לכל תפקיד והשינויים שהמנהל קבע
// במסך המשתמשים — מוגדרות ב-lib/permissions.js. כאן רק זיהוי המשתמש ובדיקת הרשאה.

// מתי שונתה הסיסמה לאחרונה — נשמר במטמון קצר כדי לא לפגוע בכל בקשה
const pwChanged = new Map();   // userId -> { at, until }
const PW_TTL = 60 * 1000;

async function passwordChangedAt(userId) {
  const c = pwChanged.get(userId);
  if (c && c.until > Date.now()) return c.at;
  let at = null;
  try {
    const r = await pool.query('SELECT password_changed_at FROM users WHERE id=$1', [userId]);
    if (r.rows[0] && r.rows[0].password_changed_at) at = new Date(r.rows[0].password_changed_at).getTime();
  } catch (e) { /* תקלת מסד לא תנתק משתמשים */ }
  pwChanged.set(userId, { at, until: Date.now() + PW_TTL });
  return at;
}
// נקרא מיד אחרי איפוס סיסמה, כדי שהביטול ייכנס לתוקף בלי להמתין למטמון
function forgetPassword(userId) { pwChanged.delete(userId); }

async function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'לא מחובר למערכת' });
  }
  let decoded;
  try {
    decoded = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'פג תוקף החיבור, יש להתחבר מחדש' });
  }
  // טוקן שהונפק לפני איפוס הסיסמה כבר לא תקף
  // iat של JWT הוא בשניות שלמות (מעוגל למטה), ולכן טוקן שהונפק מיד אחרי
  // איפוס הסיסמה עלול להיראות מוקדם ממנו בעד שנייה — שנייה של סבילות
  const changedAt = await passwordChangedAt(decoded.id);
  if (changedAt && decoded.iat && decoded.iat * 1000 + 1000 < changedAt) {
    return res.status(401).json({ error: 'הסיסמה שונתה, יש להתחבר מחדש' });
  }
  req.user = decoded;
  // בטוקן נשמר רק התפקיד; ההרשאות נקראות בכל בקשה, ולכן שינוי במסך
  // ההרשאות חל מיד גם על מי שכבר מחובר
  req.caps = await capsFor(decoded.role);
  next();
}

function can(capability) {
  return (req, res, next) => {
    if (req.caps && req.caps[capability]) return next();
    return res.status(403).json({ error: 'אין לך הרשאה לפעולה זו' });
  };
}

// לפחות אחת מההרשאות — לנתיבים שכמה תפקידים ניגשים אליהם מסיבות שונות
function canAny(...caps) {
  return (req, res, next) => {
    if (req.caps && caps.some(c => req.caps[c])) return next();
    return res.status(403).json({ error: 'אין לך הרשאה לפעולה זו' });
  };
}

module.exports = { authenticate, can, canAny, ROLES, forgetPassword };
