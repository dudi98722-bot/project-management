const express = require('express');
const { pool, logAction } = require('../db');
const { authenticate, requireWrite, requireDelete } = require('../middleware/auth');
const { syncVow } = require('../sheets');
const router = express.Router();

// Unique id generator (avoids same-millisecond collisions on rapid submits)
let _seq = 0;
function genId() { return Date.now() * 1000 + (_seq++ % 1000); }

// GET /api/vows
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, filter, page = 1, limit = 50 } = req.query;
    let conditions = [];
    let params = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(v.name ILIKE $${params.length} OR v.for_a ILIKE $${params.length} OR v.for_b ILIKE $${params.length} OR v.note ILIKE $${params.length})`);
    }

    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    // debt filter handled post-query for simplicity
    const query = `
      SELECT v.*,
        COALESCE(SUM(p.amount),0) as paid,
        (v.amount - COALESCE(SUM(p.amount),0)) as balance
      FROM vows v
      LEFT JOIN payments p ON p.vow_id = v.id
      ${whereClause}
      GROUP BY v.id
      ORDER BY v.date DESC
      LIMIT $${params.length+1} OFFSET $${params.length+2}
    `;
    params.push(parseInt(limit), (parseInt(page)-1)*parseInt(limit));

    const result = await pool.query(query, params);
    const countRes = await pool.query(`SELECT COUNT(*) FROM vows v ${whereClause}`, params.slice(0, conditions.length));

    // Summary
    const summary = await pool.query(`
      SELECT COALESCE(SUM(v.amount),0) as total_vows,
             COALESCE(SUM(p.amount),0) as total_paid
      FROM vows v LEFT JOIN payments p ON p.vow_id = v.id
    `);

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

// GET /api/vows/all (all raw vows, for initial app load)
router.get('/all', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM vows ORDER BY date DESC NULLS LAST');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// POST /api/vows
router.post('/', authenticate, requireWrite, async (req, res) => {
  const { id: bodyId, date, hebrew_date, name, for_a, for_b, amount, note, place } = req.body;
  if (!date || !name) return res.status(400).json({ error: 'תאריך ושם חובה' });
  try {
    const id = /^\d+$/.test(String(bodyId)) ? Number(bodyId) : genId();
    const result = await pool.query(
      `INSERT INTO vows (id,date,hebrew_date,name,for_a,for_b,amount,note,place,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
       ON CONFLICT (id) DO UPDATE SET date=$2,hebrew_date=$3,name=$4,for_a=$5,for_b=$6,amount=$7,note=$8,place=$9,updated_by=$10,updated_at=NOW()
       RETURNING *`,
      [id, date, hebrew_date, name, for_a, for_b, amount||0, note, place, req.user.id]
    );
    await logAction(req.user.id, req.user.username, 'add', 'vows', id, { name, amount });
    syncVow('add', result.rows[0], req.user.username);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// PUT /api/vows/:id
router.put('/:id', authenticate, requireWrite, async (req, res) => {
  const { date, hebrew_date, name, for_a, for_b, amount, note, place } = req.body;
  try {
    const result = await pool.query(
      `UPDATE vows SET date=$1,hebrew_date=$2,name=$3,for_a=$4,for_b=$5,amount=$6,note=$7,place=$8,updated_by=$9,updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [date, hebrew_date, name, for_a, for_b, amount||0, note, place, req.user.id, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'נדר לא נמצא' });
    await logAction(req.user.id, req.user.username, 'edit', 'vows', req.params.id, { name, amount });
    syncVow('edit', result.rows[0], req.user.username);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// DELETE /api/vows/:id
router.delete('/:id', authenticate, requireDelete, async (req, res) => {
  try {
    await pool.query('DELETE FROM vows WHERE id = $1', [req.params.id]);
    await logAction(req.user.id, req.user.username, 'delete', 'vows', req.params.id, {});
    syncVow('delete', { id: req.params.id }, req.user.username);
    res.json({ message: 'נדר נמחק' });
  } catch (err) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
