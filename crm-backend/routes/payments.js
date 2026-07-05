const express = require('express');
const { pool, logAction } = require('../db');
const { authenticate, requireWrite, requireDelete, requirePayments } = require('../middleware/auth');
const { syncPayment } = require('../sheets');
const router = express.Router();

// Unique id generator (avoids same-millisecond collisions on rapid submits)
let _seq = 0;
function genId() { return Date.now() * 1000 + (_seq++ % 1000); }

// GET /api/payments
router.get('/', authenticate, requirePayments, async (req, res) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    let conditions = [];
    let params = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(p.name ILIKE $${params.length} OR p.method ILIKE $${params.length} OR p.note ILIKE $${params.length})`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const query = `
      SELECT p.*, v.for_a, v.for_b, v.amount as vow_amount
      FROM payments p
      LEFT JOIN vows v ON v.id = p.vow_id
      ${where}
      ORDER BY p.date DESC
      LIMIT $${params.length+1} OFFSET $${params.length+2}
    `;
    params.push(parseInt(limit), (parseInt(page)-1)*parseInt(limit));

    const result = await pool.query(query, params);
    const countRes = await pool.query(`SELECT COUNT(*) FROM payments p ${where}`, params.slice(0, conditions.length));
    const summary = await pool.query('SELECT COALESCE(SUM(amount),0) as total FROM payments');

    res.json({
      data: result.rows,
      total: parseInt(countRes.rows[0].count),
      page: parseInt(page),
      summary: summary.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// GET /api/payments/all (all raw payments, for initial app load)
router.get('/all', authenticate, requirePayments, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM payments ORDER BY date DESC NULLS LAST');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// POST /api/payments
router.post('/', authenticate, requireWrite, requirePayments, async (req, res) => {
  const { id: bodyId, date, hebrew_date, name, vow_id, amount, method, num_payments, note } = req.body;
  if (!date || !name || !amount) return res.status(400).json({ error: 'תאריך, שם וסכום חובה' });
  try {
    const id = /^\d+$/.test(String(bodyId)) ? Number(bodyId) : genId();
    const result = await pool.query(
      `INSERT INTO payments (id,date,hebrew_date,name,vow_id,amount,method,num_payments,note,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
       ON CONFLICT (id) DO UPDATE SET date=$2,hebrew_date=$3,name=$4,vow_id=$5,amount=$6,method=$7,num_payments=$8,note=$9,updated_by=$10,updated_at=NOW()
       RETURNING *`,
      [id, date, hebrew_date, name, vow_id||null, amount, method, num_payments||1, note, req.user.id]
    );
    await logAction(req.user.id, req.user.username, 'add', 'payments', id, { name, amount });
    syncPayment('add', result.rows[0], req.user.username);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// PUT /api/payments/:id
router.put('/:id', authenticate, requireWrite, requirePayments, async (req, res) => {
  const { date, hebrew_date, name, vow_id, amount, method, num_payments, note } = req.body;
  try {
    const result = await pool.query(
      `UPDATE payments SET date=$1,hebrew_date=$2,name=$3,vow_id=$4,amount=$5,method=$6,num_payments=$7,note=$8,updated_by=$9,updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [date, hebrew_date, name, vow_id||null, amount, method, num_payments||1, note, req.user.id, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'תשלום לא נמצא' });
    await logAction(req.user.id, req.user.username, 'edit', 'payments', req.params.id, { name, amount });
    syncPayment('edit', result.rows[0], req.user.username);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// DELETE /api/payments/:id
router.delete('/:id', authenticate, requireDelete, requirePayments, async (req, res) => {
  try {
    await pool.query('DELETE FROM payments WHERE id = $1', [req.params.id]);
    await logAction(req.user.id, req.user.username, 'delete', 'payments', req.params.id, {});
    syncPayment('delete', { id: req.params.id }, req.user.username);
    res.json({ message: 'תשלום נמחק' });
  } catch (err) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
