const express = require('express');
const { pool, logAction, softDelete } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const router = express.Router();

// המודול פתוח למי שיש לו הרשאת debts (מנהל ראשי / מנהל / מדווח)
router.use(authenticate, can('debts'));

const COLS = `id, lender, phone, taken::float AS taken, repaid::float AS repaid,
  urgent::float AS urgent, taken_date, due_date, note, created_at`;

// GET /api/debts — כל החובות הפתוחים (לא מחוקים)
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(`SELECT ${COLS} FROM debts WHERE deleted=false
      ORDER BY (taken - repaid) DESC, id DESC`);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// POST /api/debts — חוב חדש
router.post('/', async (req, res) => {
  const b = req.body || {};
  const lender = String(b.lender || '').trim();
  if (!lender) return res.status(400).json({ error: 'שם המלווה חובה' });
  try {
    const r = await pool.query(
      `INSERT INTO debts (lender, phone, taken, repaid, urgent, taken_date, due_date, note, created_by, updated_by)
       VALUES ($1,$2,COALESCE($3::numeric,0),COALESCE($4::numeric,0),COALESCE($5::numeric,0),$6,$7,$8,$9,$9)
       RETURNING ${COLS}`,
      [lender, b.phone || null, b.taken, b.repaid, b.urgent, b.taken_date || null, b.due_date || null, b.note || null, req.user.id]
    );
    await logAction(req.user, 'add', 'debts', r.rows[0].id, { lender, taken: b.taken });
    res.status(201).json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// POST /api/debts/bulk — קליטה מרוכזת (הכל בטרנזקציה אחת)
router.post('/bulk', async (req, res) => {
  const list = Array.isArray((req.body || {}).debts) ? req.body.debts : [];
  if (!list.length) return res.status(400).json({ error: 'לא התקבלו שורות' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = [];
    for (const d of list) {
      const lender = String((d && d.lender) || '').trim();
      const taken = parseFloat(d && d.taken) || 0;
      if (!lender || !(taken > 0)) continue;
      const r = await client.query(
        `INSERT INTO debts (lender, phone, taken, repaid, urgent, taken_date, due_date, note, created_by, updated_by)
         VALUES ($1,$2,$3::numeric,COALESCE($4::numeric,0),COALESCE($5::numeric,0),$6,$7,$8,$9,$9) RETURNING ${COLS}`,
        [lender, d.phone || null, taken, d.repaid, d.urgent, d.taken_date || null, d.due_date || null, d.note || null, req.user.id]
      );
      created.push(r.rows[0]);
    }
    await client.query('COMMIT');
    await logAction(req.user, 'bulk_add', 'debts', 0, { count: created.length });
    res.status(201).json({ count: created.length, debts: created });
  } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
  finally { client.release(); }
});

// PUT /api/debts/:id — עדכון (כולל רישום החזר)
router.put('/:id', async (req, res) => {
  const b = req.body || {};
  const lender = String(b.lender || '').trim();
  if (!lender) return res.status(400).json({ error: 'שם המלווה חובה' });
  try {
    const r = await pool.query(
      `UPDATE debts SET lender=$1, phone=$2, taken=COALESCE($3::numeric,0), repaid=COALESCE($4::numeric,0),
         urgent=COALESCE($5::numeric,0), taken_date=$6, due_date=$7, note=$8, updated_by=$9, updated_at=NOW()
       WHERE id=$10 AND deleted=false RETURNING ${COLS}`,
      [lender, b.phone || null, b.taken, b.repaid, b.urgent, b.taken_date || null, b.due_date || null, b.note || null, req.user.id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'חוב לא נמצא' });
    await logAction(req.user, 'edit', 'debts', req.params.id, { lender });
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// POST /api/debts/:id/repay — רישום החזר מהיר (מוסיף לסכום שהוחזר)
router.post('/:id/repay', async (req, res) => {
  const amt = parseFloat((req.body || {}).amount);
  if (!(amt > 0)) return res.status(400).json({ error: 'סכום החזר חייב להיות גדול מ-0' });
  try {
    const r = await pool.query(
      `UPDATE debts SET repaid = repaid + $1::numeric,
         urgent = GREATEST(0, LEAST(urgent, taken - (repaid + $1::numeric))),
         updated_by=$2, updated_at=NOW()
       WHERE id=$3 AND deleted=false RETURNING ${COLS}`,
      [amt, req.user.id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'חוב לא נמצא' });
    await logAction(req.user, 'edit', 'debts', req.params.id, { repay: amt });
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// DELETE /api/debts/:id — מחיקה רכה (דורש הרשאת מחיקה — מנהל/מדווח לא מוחקים)
router.delete('/:id', can('del'), async (req, res) => {
  try {
    const ok = await softDelete('debts', req.params.id, req.user);
    if (!ok) return res.status(404).json({ error: 'חוב לא נמצא' });
    res.json({ message: 'החוב הועבר לסל המחזור' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
