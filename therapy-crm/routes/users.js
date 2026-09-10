const express = require('express');
const bcrypt = require('bcryptjs');
const { pool, logAction } = require('../db');
const { authenticate, can, ROLES, forgetPassword } = require('../middleware/auth');
const { isCustomized, matrix, saveMatrix } = require('../lib/permissions');
const router = express.Router();

// מייל ריק נשמר כ-NULL, כדי שהאילוץ הייחודי לא ייתפס על מחרוזת ריקה
function cleanEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  return e || null;
}

// תווית ותיאור לכל תפקיד. תפקיד שההרשאות שלו שונו מסומן — התיאור הקבוע
// כבר לא מתאר אותו במדויק
async function roleInfo() {
  const out = {};
  for (const [k, v] of Object.entries(ROLES)) {
    out[k] = { label: v.label, desc: v.desc || '', custom: await isCustomized(k) };
  }
  return out;
}

router.get('/', authenticate, can('viewUsers'), async (req, res) => {
  try {
    const r = await pool.query('SELECT id, username, role, full_name, email, active, last_login, created_at FROM users ORDER BY id');
    const info = await roleInfo();
    res.json(r.rows.map(u => {
      const i = info[u.role] || {};
      return { ...u, role_label: i.label || u.role, role_desc: i.desc || '', role_custom: !!i.custom };
    }));
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.get('/roles', authenticate, can('viewUsers'), async (req, res) => {
  try {
    const info = await roleInfo();
    res.json(Object.entries(info).map(([k, v]) => ({ role: k, label: v.label, desc: v.desc, custom: v.custom })));
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

// ===== טבלת ההרשאות: מנהל ראשי ומנהל בלבד =====
router.get('/permissions', authenticate, can('managePermissions'), async (req, res) => {
  try { res.json(await matrix()); }
  catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// { roles: { guide: { editNotes: true, holds: false, ... }, ... } }
// מוגדר לפני PUT /:id — אחרת "permissions" היה נתפס כמזהה משתמש
router.put('/permissions', authenticate, can('managePermissions'), async (req, res) => {
  const roles = (req.body || {}).roles;
  if (!roles || typeof roles !== 'object' || Array.isArray(roles)) {
    return res.status(400).json({ error: 'בקשה לא תקינה' });
  }
  try {
    const changed = await saveMatrix(roles, req.user);
    await logAction(req.user, 'edit', 'role_permissions', '', { roles: changed });
    res.json(await matrix());
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// ניהול משתמשים ניתן לפתוח בטבלת ההרשאות לתפקידים נוספים, אבל מנהל ראשי נשאר
// בידי מנהל ראשי: אחרת מי שקיבל ניהול משתמשים היה יוצר לעצמו גישה מלאה
const ADMIN_ONLY_MSG = 'רק מנהל ראשי יכול ליצור או לערוך משתמש מסוג מנהל ראשי';

router.post('/', authenticate, can('manageUsers'), async (req, res) => {
  const { username, password, role, full_name, email } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'שם משתמש וסיסמא חובה' });
  if (!ROLES[role]) return res.status(400).json({ error: 'תפקיד לא תקין' });
  if (role === 'admin' && req.user.role !== 'admin') return res.status(403).json({ error: ADMIN_ONLY_MSG });
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
    if (req.user.role !== 'admin') {
      const cur = await pool.query('SELECT role FROM users WHERE id=$1', [req.params.id]);
      if (!cur.rows.length) return res.status(404).json({ error: 'לא נמצא' });
      if (cur.rows[0].role === 'admin' || role === 'admin') return res.status(403).json({ error: ADMIN_ONLY_MSG });
    }
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
