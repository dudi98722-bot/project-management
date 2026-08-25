const express = require('express');
const bcrypt = require('bcryptjs');
const { pool, logAction } = require('../db');
const { authenticate, can, ROLES } = require('../middleware/auth');
const router = express.Router();

router.get('/', authenticate, can('manageUsers'), async (req, res) => {
  try {
    const r = await pool.query('SELECT id, username, role, full_name, active, last_login, created_at FROM users ORDER BY id');
    res.json(r.rows.map(u => ({ ...u, role_label: (ROLES[u.role] || {}).label || u.role })));
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.get('/roles', authenticate, can('manageUsers'), (req, res) => {
  res.json(Object.entries(ROLES).map(([k, v]) => ({ role: k, label: v.label })));
});

router.post('/', authenticate, can('manageUsers'), async (req, res) => {
  const { username, password, role, full_name } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'שם משתמש וסיסמא חובה' });
  if (!ROLES[role]) return res.status(400).json({ error: 'תפקיד לא תקין' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      'INSERT INTO users (username, password_hash, role, full_name) VALUES ($1,$2,$3,$4) RETURNING id, username, role, full_name, active',
      [username, hash, role, full_name || null]);
    await logAction(req.user, 'add', 'users', r.rows[0].id, { username });
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'שם המשתמש כבר קיים' });
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.put('/:id', authenticate, can('manageUsers'), async (req, res) => {
  const { role, full_name, active, password, username } = req.body || {};
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
    const r = await pool.query(
      'UPDATE users SET role=COALESCE($1,role), full_name=COALESCE($2,full_name), active=COALESCE($3,active) WHERE id=$4 RETURNING id, username, role, full_name, active',
      [role || null, full_name || null, (active === undefined ? null : active), req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'לא נמצא' });
    await logAction(req.user, 'edit', 'users', req.params.id, {});
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'שם המשתמש כבר קיים' });
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
