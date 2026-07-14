const express = require('express');
const bcrypt = require('bcryptjs');
const { pool, logAction } = require('../db');
const { authenticate, can, ROLES } = require('../middleware/auth');
const router = express.Router();

const VALID_ROLES = Object.keys(ROLES);

// GET /api/users
router.get('/', authenticate, can('manageUsers'), async (req, res) => {
  try {
    const r = await pool.query('SELECT id, username, role, full_name, active, created_at, last_login FROM users ORDER BY id');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

// GET /api/users/roles - רשימת התפקידים והתוויות (לכל משתמש מחובר)
router.get('/roles', authenticate, (req, res) => {
  res.json(Object.entries(ROLES).map(([key, v]) => ({ key, label: v.label })));
});

// POST /api/users
router.post('/', authenticate, can('manageUsers'), async (req, res) => {
  const { username, password, role, full_name } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: 'שם משתמש, סיסמא ותפקיד חובה' });
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'תפקיד לא תקין' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      'INSERT INTO users (username, password_hash, role, full_name) VALUES ($1,$2,$3,$4) RETURNING id, username, role, full_name, active',
      [username, hash, role, full_name || username]
    );
    await logAction(req.user, 'add', 'users', r.rows[0].id, { username, role });
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'שם משתמש כבר קיים' });
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// PUT /api/users/:id
router.put('/:id', authenticate, can('manageUsers'), async (req, res) => {
  const { username, password, role, full_name, active } = req.body;
  if (role && !VALID_ROLES.includes(role)) return res.status(400).json({ error: 'תפקיד לא תקין' });
  try {
    let query, qparams;
    if (password) {
      query = 'UPDATE users SET username=$1, role=$2, full_name=$3, active=$4, password_hash=$5 WHERE id=$6 RETURNING id, username, role, full_name, active';
      qparams = [username, role, full_name, active !== false, await bcrypt.hash(password, 10), req.params.id];
    } else {
      query = 'UPDATE users SET username=$1, role=$2, full_name=$3, active=$4 WHERE id=$5 RETURNING id, username, role, full_name, active';
      qparams = [username, role, full_name, active !== false, req.params.id];
    }
    const r = await pool.query(query, qparams);
    if (!r.rows.length) return res.status(404).json({ error: 'משתמש לא נמצא' });
    await logAction(req.user, 'edit', 'users', req.params.id, { username, role });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'שם משתמש כבר קיים' });
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// DELETE /api/users/:id - השבתה (לא מוחקים משתמש פיזית)
router.delete('/:id', authenticate, can('manageUsers'), async (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'לא ניתן להשבית את עצמך' });
  try {
    const r = await pool.query('UPDATE users SET active=false WHERE id=$1 RETURNING id', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'משתמש לא נמצא' });
    await logAction(req.user, 'disable', 'users', req.params.id, {});
    res.json({ message: 'המשתמש הושבת' });
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
