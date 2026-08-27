const express = require('express');
const bcrypt = require('bcryptjs');
const { pool, logAction } = require('../db');
const { authenticate, can, ROLES, forgetPassword } = require('../middleware/auth');
const router = express.Router();

// מייל ריק נשמר כ-NULL, כדי שהאילוץ הייחודי לא ייתפס על מחרוזת ריקה
function cleanEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  return e || null;
}

router.get('/', authenticate, can('manageUsers'), async (req, res) => {
  try {
    const r = await pool.query('SELECT id, username, role, full_name, email, active, last_login, created_at FROM users ORDER BY id');
    res.json(r.rows.map(u => ({ ...u, role_label: (ROLES[u.role] || {}).label || u.role, role_desc: (ROLES[u.role] || {}).desc || '' })));
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.get('/roles', authenticate, can('manageUsers'), (req, res) => {
  res.json(Object.entries(ROLES).map(([k, v]) => ({ role: k, label: v.label, desc: v.desc || '' })));
});

router.post('/', authenticate, can('manageUsers'), async (req, res) => {
  const { username, password, role, full_name, email } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'שם משתמש וסיסמא חובה' });
  if (!ROLES[role]) return res.status(400).json({ error: 'תפקיד לא תקין' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      'INSERT INTO users (username, password_hash, role, full_name, email) VALUES ($1,$2,$3,$4,$5) RETURNING id, username, role, full_name, email, active',
      [username, hash, role, full_name || null, cleanEmail(email)]);
    await logAction(req.user, 'add', 'users', r.rows[0].id, { username });
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: /email/.test(e.constraint || '') ? 'כתובת המייל כבר רשומה למשתמש אחר' : 'שם המשתמש כבר קיים' });
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.put('/:id', authenticate, can('manageUsers'), async (req, res) => {
  const { username, role, full_name, active, password, email } = req.body || {};
  if (role !== undefined && !ROLES[role]) return res.status(400).json({ error: 'תפקיד לא תקין' });

  // שם משתמש נשלח רק כשבאמת משנים אותו; ריק/undefined = משאירים כמו שהוא
  let newUsername = null;
  if (username !== undefined && username !== null && String(username).trim() !== '') {
    newUsername = String(username).trim();
    if (newUsername.length < 3) return res.status(400).json({ error: 'שם משתמש חייב להיות באורך 3 תווים לפחות' });
    if (/\s/.test(newUsername)) return res.status(400).json({ error: 'שם משתמש לא יכול להכיל רווחים' });
  }

  try {
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE users SET password_hash=$1, password_changed_at=NOW() WHERE id=$2', [hash, req.params.id]);
      forgetPassword(Number(req.params.id));
    }
    const r = await pool.query(
      `UPDATE users SET username=COALESCE($1,username), role=COALESCE($2,role),
              full_name=COALESCE($3,full_name), active=COALESCE($4,active),
              email=CASE WHEN $5::text IS NULL THEN email ELSE NULLIF($5,'') END
       WHERE id=$6 RETURNING id, username, role, full_name, email, active`,
      [newUsername, role || null, full_name || null, (active === undefined ? null : active),
       email === undefined ? null : String(email).trim().toLowerCase(), req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'לא נמצא' });
    await logAction(req.user, 'edit', 'users', req.params.id, newUsername ? { username: newUsername } : {});
    // שינוי שם המשתמש של עצמך -> הטוקן הנוכחי מחזיק שם ישן, צריך להתחבר מחדש
    const selfRenamed = newUsername && String(req.user.id) === String(req.params.id);
    res.json({ ...r.rows[0], self_renamed: !!selfRenamed });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: /email/.test(e.constraint || '') ? 'כתובת המייל כבר רשומה למשתמש אחר' : 'שם המשתמש כבר תפוס' });
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
