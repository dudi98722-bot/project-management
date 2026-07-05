const express = require('express');
const bcrypt = require('bcryptjs');
const { pool, logAction } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const router = express.Router();

// GET /api/users - list all users (admin only)
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, role, full_name, created_at, last_login FROM users ORDER BY id'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// POST /api/users - add user (admin only)
router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { username, password, role, full_name } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: 'שם משתמש, סיסמא ותפקיד חובה' });
  if (!['admin','editor','treasurer','viewer'].includes(role)) return res.status(400).json({ error: 'תפקיד לא תקין' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password_hash, role, full_name) VALUES ($1,$2,$3,$4) RETURNING id, username, role, full_name',
      [username, hash, role, full_name || username]
    );
    await logAction(req.user.id, req.user.username, 'add', 'users', result.rows[0].id, { username, role });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'שם משתמש כבר קיים' });
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// PUT /api/users/:id - edit user (admin only)
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  const { username, password, role, full_name } = req.body;
  try {
    let query, params;
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      query = 'UPDATE users SET username=$1, password_hash=$2, role=$3, full_name=$4 WHERE id=$5 RETURNING id, username, role, full_name';
      params = [username, hash, role, full_name, req.params.id];
    } else {
      query = 'UPDATE users SET username=$1, role=$2, full_name=$3 WHERE id=$4 RETURNING id, username, role, full_name';
      params = [username, role, full_name, req.params.id];
    }
    const result = await pool.query(query, params);
    if (!result.rows.length) return res.status(404).json({ error: 'משתמש לא נמצא' });
    await logAction(req.user.id, req.user.username, 'edit', 'users', req.params.id, { username, role });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// DELETE /api/users/:id (admin only)
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'לא ניתן למחוק את עצמך' });
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    await logAction(req.user.id, req.user.username, 'delete', 'users', req.params.id, {});
    res.json({ message: 'משתמש נמחק' });
  } catch (err) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
