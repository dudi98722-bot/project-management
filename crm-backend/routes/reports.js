const express = require('express');
const { pool } = require('../db');
const { authenticate, requirePayments } = require('../middleware/auth');
const router = express.Router();

// GET /api/reports/summary - סיכום כללי
router.get('/summary', authenticate, async (req, res) => {
  try {
    const [contacts, vows, payments, topDonors] = await Promise.all([
      pool.query('SELECT COUNT(*) as total FROM contacts'),
      pool.query(`
        SELECT COUNT(*) as total, COALESCE(SUM(amount),0) as total_amount,
               COALESCE(SUM(CASE WHEN amount > 0 THEN 1 ELSE 0 END),0) as with_amount
        FROM vows
      `),
      pool.query('SELECT COUNT(*) as total, COALESCE(SUM(amount),0) as total_paid FROM payments'),
      pool.query(`
        SELECT v.name, COALESCE(SUM(p.amount),0) as total_paid
        FROM vows v
        LEFT JOIN payments p ON p.vow_id = v.id
        GROUP BY v.name
        ORDER BY total_paid DESC
        LIMIT 10
      `)
    ]);

    const vowData = vows.rows[0];
    const payData = payments.rows[0];

    res.json({
      contacts: parseInt(contacts.rows[0].total),
      vows: {
        total: parseInt(vowData.total),
        total_amount: parseFloat(vowData.total_amount),
      },
      payments: {
        total: parseInt(payData.total),
        total_paid: parseFloat(payData.total_paid),
      },
      balance: parseFloat(vowData.total_amount) - parseFloat(payData.total_paid),
      top_donors: topDonors.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// GET /api/reports/debts - נדרים עם יתרה פתוחה
router.get('/debts', authenticate, requirePayments, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT v.id, v.date, v.name, v.for_a, v.for_b, v.amount, v.note,
             COALESCE(SUM(p.amount),0) as paid,
             (v.amount - COALESCE(SUM(p.amount),0)) as balance
      FROM vows v
      LEFT JOIN payments p ON p.vow_id = v.id
      GROUP BY v.id
      HAVING (v.amount - COALESCE(SUM(p.amount),0)) > 0
      ORDER BY balance DESC
    `);
    res.json({ data: result.rows, total: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// GET /api/reports/by-month - סיכום לפי חודש
router.get('/by-month', authenticate, requirePayments, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        TO_CHAR(date::date, 'YYYY-MM') as month,
        COUNT(*) as payment_count,
        COALESCE(SUM(amount),0) as total
      FROM payments
      WHERE date IS NOT NULL
      GROUP BY month
      ORDER BY month DESC
      LIMIT 24
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// GET /api/reports/audit - יומן פעולות
router.get('/audit', authenticate, async (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  try {
    const result = await pool.query(
      `SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [parseInt(limit), (parseInt(page)-1)*parseInt(limit)]
    );
    const count = await pool.query('SELECT COUNT(*) FROM audit_log');
    res.json({ data: result.rows, total: parseInt(count.rows[0].count), page: parseInt(page) });
  } catch (err) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
