const express = require('express');
const bcrypt = require('bcryptjs');
const { pool, logAction } = require('../db');
const { authenticate, can, ROLES } = require('../middleware/auth');
const router = express.Router();

// משתמש קומיסיון חייב להיות משויך לאיש קשר — זה כל מה שהוא רואה.
// שאר התפקידים אינם משויכים לאיש, ולכן השיוך מנוקה כשמשנים תפקיד.
function contactFor(role, contactId) {
  if (role !== 'customer') return null;
  const id = parseInt(contactId, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// uq_user_contact — אותו לקוח לא יכול להיות מקושר לשני משתמשים
const dupMsg = (e) => (/uq_user_contact/.test(e.constraint || '')
  ? 'ללקוח הזה כבר קיים משתמש קומיסיון'
  : 'שם המשתמש כבר קיים');

router.get('/', authenticate, can('manageUsers'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT u.id, u.username, u.role, u.full_name, u.active, u.last_login, u.created_at,
              u.contact_id, c.name AS contact_name
         FROM users u LEFT JOIN contacts c ON c.id = u.contact_id
        ORDER BY u.id`);
    res.json(r.rows.map(u => ({ ...u, role_label: (ROLES[u.role] || {}).label || u.role })));
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.get('/roles', authenticate, can('manageUsers'), (req, res) => {
  res.json(Object.entries(ROLES).map(([k, v]) => ({ role: k, label: v.label })));
});

router.post('/', authenticate, can('manageUsers'), async (req, res) => {
  const { username, password, role, full_name, contact_id } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'שם משתמש וסיסמא חובה' });
  if (!ROLES[role]) return res.status(400).json({ error: 'תפקיד לא תקין' });
  const contact = contactFor(role, contact_id);
  if (role === 'customer' && !contact) {
    return res.status(400).json({ error: 'למשתמש קומיסיון חובה לבחור את הלקוח שהוא רואה' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      `INSERT INTO users (username, password_hash, role, full_name, contact_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, username, role, full_name, active, contact_id`,
      [username, hash, role, full_name || null, contact]);
    await logAction(req.user, 'add', 'users', r.rows[0].id, { username });
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: dupMsg(e) });
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.put('/:id', authenticate, can('manageUsers'), async (req, res) => {
  const { role, full_name, active, password, username, contact_id } = req.body || {};
  if (role !== undefined && role !== null && !ROLES[role]) {
    return res.status(400).json({ error: 'תפקיד לא תקין' });
  }
  try {
    // לא נועלים את עצמנו החוצה: אסור לאדמין האחרון לאבד הרשאות או להיות מושבת
    if ((role && role !== 'admin') || active === false) {
      const cur = await pool.query('SELECT role FROM users WHERE id=$1', [req.params.id]);
      if (cur.rows.length && cur.rows[0].role === 'admin') {
        const n = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role='admin' AND active=true");
        if (n.rows[0].n <= 1) return res.status(400).json({ error: 'זהו המנהל הראשי היחיד — אי אפשר להשבית אותו או לשנות את תפקידו' });
      }
    }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.params.id]);
    }
    if (username && String(username).trim()) {
      await pool.query('UPDATE users SET username=$1 WHERE id=$2', [String(username).trim(), req.params.id]);
    }
    // השיוך ללקוח נקבע לפי התפקיד שיהיה אחרי העדכון. מעבר מקומיסיון
    // לתפקיד אחר מנקה את השיוך, אחרת נשאר קישור לא רלוונטי שרק מבלבל.
    let contactSet = '';
    const vals = [role || null, full_name || null, (active === undefined ? null : active)];
    if (role !== undefined && role !== null) {
      const cur2 = await pool.query('SELECT contact_id FROM users WHERE id=$1', [req.params.id]);
      const keep = cur2.rows.length ? cur2.rows[0].contact_id : null;
      const next = contactFor(role, contact_id === undefined ? keep : contact_id);
      if (role === 'customer' && !next) {
        return res.status(400).json({ error: 'למשתמש קומיסיון חובה לבחור את הלקוח שהוא רואה' });
      }
      vals.push(next);
      contactSet = `, contact_id=$${vals.length}`;
    } else if (contact_id !== undefined) {
      vals.push(contactFor('customer', contact_id));
      contactSet = `, contact_id=$${vals.length}`;
    }
    vals.push(req.params.id);
    const r = await pool.query(
      `UPDATE users SET role=COALESCE($1,role), full_name=COALESCE($2,full_name), active=COALESCE($3,active)${contactSet}
       WHERE id=$${vals.length} RETURNING id, username, role, full_name, active, contact_id`,
      vals);
    if (!r.rows.length) return res.status(404).json({ error: 'לא נמצא' });
    await logAction(req.user, 'edit', 'users', req.params.id, {});
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: dupMsg(e) });
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
