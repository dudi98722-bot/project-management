const express = require('express');
const { pool, logAction, softDelete } = require('../db');
const sheets = require('../sheets');
const { authenticate, can } = require('../middleware/auth');
const router = express.Router();

// כל המודול דורש הרשאת בית
router.use(authenticate, can('home'));

// GET /api/home/transactions?from=&to=
router.get('/transactions', async (req, res) => {
  const { from, to } = req.query;
  const where = ['deleted=false']; const params = [];
  if (from) { params.push(from); where.push(`date>=$${params.length}`); }
  if (to)   { params.push(to);   where.push(`date<=$${params.length}`); }
  try {
    const r = await pool.query(`SELECT * FROM home_transactions WHERE ${where.join(' AND ')} ORDER BY date DESC NULLS LAST, id DESC`, params);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

// POST /api/home/transactions - הזנה ידנית דרך טופס
router.post('/transactions', async (req, res) => {
  const { date, direction, amount, category, payee, source, note } = req.body || {};
  if (!(parseFloat(amount) > 0)) return res.status(400).json({ error: 'סכום חייב להיות גדול מ-0' });
  try {
    const r = await pool.query(
      `INSERT INTO home_transactions (date, direction, amount, category, payee, source, note, created_by, updated_by)
       VALUES ($1,COALESCE($2,'out'),$3,$4,$5,COALESCE($6,'form'),$7,$8,$8) RETURNING *`,
      [date || null, direction, amount, category || null, payee || null, source, note || null, req.user.id]
    );
    if (category && payee) await learnRule(payee, category);
    await logAction(req.user, 'add', 'home_transactions', r.rows[0].id, { amount });
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

// PUT /api/home/transactions/:id
router.put('/transactions/:id', async (req, res) => {
  const { date, direction, amount, category, payee, note, source } = req.body || {};
  if (!(parseFloat(amount) > 0)) return res.status(400).json({ error: 'סכום חייב להיות גדול מ-0' });
  try {
    const r = await pool.query(
      `UPDATE home_transactions SET date=$1, direction=COALESCE($2,'out'), amount=$3, category=$4, payee=$5,
        note=$6, source=COALESCE($7,source), updated_by=$8, updated_at=NOW() WHERE id=$9 AND deleted=false RETURNING *`,
      [date || null, direction, amount, category || null, payee || null, note || null, source || null, req.user.id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'רשומה לא נמצאה' });
    if (category && payee) await learnRule(payee, category);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

// DELETE /api/home/transactions/:id - מחיקה רכה
router.delete('/transactions/:id', async (req, res) => {
  try {
    const ok = await softDelete('home_transactions', req.params.id, req.user);
    if (!ok) return res.status(404).json({ error: 'רשומה לא נמצאה' });
    res.json({ message: 'הרשומה הועברה לסל המחזור' });
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

// POST /api/home/import - ייבוא שורות מבנק/אשראי (לאחר סיווג בצד לקוח)
// body: { rows:[{date, amount, payee, category, direction, source}] }
router.post('/import', async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'אין שורות לייבוא' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let n = 0; const inserted = [];
    for (const row of rows) {
      const amt = parseFloat(row.amount);
      if (!(amt > 0)) continue;
      const ins = await client.query(
        `INSERT INTO home_transactions (date, direction, amount, category, payee, source, note, created_by, updated_by)
         VALUES ($1,COALESCE($2,'out'),$3,$4,$5,COALESCE($6,'bank'),$7,$8,$8) RETURNING *`,
        [row.date || null, row.direction, amt, row.category || null, row.payee || null, row.source, row.note || null, req.user.id]
      );
      inserted.push(ins.rows[0]);
      if (row.category && row.payee) await learnRuleClient(client, row.payee, row.category);
      n++;
    }
    await client.query('COMMIT');
    await logAction(req.user, 'import', 'home_transactions', 0, { count: n });
    sheets.mirrorMany('home_transactions', inserted).catch(() => {});   // גיבוי הייבוא ל-Sheets
    res.status(201).json({ message: `יובאו ${n} שורות`, count: n });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'שגיאת שרת בייבוא' });
  } finally { client.release(); }
});

// GET /api/home/rules - כללי סיווג נלמדים (לסיווג אוטומטי בצד לקוח)
router.get('/rules', async (req, res) => {
  try {
    const r = await pool.query('SELECT match_text, category FROM home_rules ORDER BY LENGTH(match_text) DESC');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

// GET /api/home/categories - קטגוריות קיימות
router.get('/categories', async (req, res) => {
  try {
    const r = await pool.query(`SELECT DISTINCT category FROM home_transactions WHERE category IS NOT NULL AND category<>'' AND deleted=false ORDER BY category`);
    res.json(r.rows.map(x => x.category));
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

// ===== helpers =====
async function learnRule(payee, category) {
  const key = (payee || '').trim().slice(0, 200);
  if (!key || !category) return;
  try { await learnRuleClient(pool, key, category); } catch (e) { /* לא קריטי */ }
}
async function learnRuleClient(client, payee, category) {
  const key = (payee || '').trim().slice(0, 200);
  if (!key || !category) return;
  const ex = await client.query('SELECT id FROM home_rules WHERE match_text=$1 LIMIT 1', [key]);
  if (ex.rows.length) await client.query('UPDATE home_rules SET category=$2 WHERE match_text=$1', [key, category]);
  else await client.query('INSERT INTO home_rules (match_text, category) VALUES ($1,$2)', [key, category]);
}

module.exports = router;
