/**
 * זכויות (עודף תשלום ששמור לתורם).
 * כל רשומה היא תנועה: סכום חיובי = הפקדת זכות, שלילי = ניצול זכות.
 * יתרת הזכות של אדם = סכום התנועות שלו.
 */
const express = require('express');
const { pool, logAction } = require('../db');
const { authenticate, requireWrite, requireDelete, requirePayments } = require('../middleware/auth');
const { syncCredit } = require('../sheets');
const router = express.Router();

// תאריך חייב להיות YYYY-MM-DD אמיתי. בלי הבדיקה, תאריך הפוך מאקסל
// ("2026-28-08") נכשל במסד ב-500 בלי הסבר, והמשתמש לא ידע שלא נשמר.
function validISODate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s == null ? '' : s).slice(0, 10));
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

let _seq = 0;
function genId() { return Date.now() * 1000 + (_seq++ % 1000); }

// GET /api/credits — כל התנועות (אפשר לסנן לפי אדם)
router.get('/', authenticate, requirePayments, async (req, res) => {
  const { person } = req.query;
  try {
    const r = person
      ? await pool.query('SELECT * FROM credits WHERE person_name=$1 ORDER BY date DESC, id DESC', [person])
      : await pool.query('SELECT * FROM credits ORDER BY date DESC, id DESC LIMIT 2000');
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// GET /api/credits/balances — יתרת זכות לכל אדם (רק מי שיש לו יתרה)
router.get('/balances', authenticate, requirePayments, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT person_name, SUM(amount) AS balance
      FROM credits GROUP BY person_name
      HAVING SUM(amount) <> 0
      ORDER BY SUM(amount) DESC`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

// POST /api/credits — הוספת תנועה (חיובי = זכות, שלילי = ניצול)
router.post('/', authenticate, requireWrite, requirePayments, async (req, res) => {
  const { id: bodyId, person, amount, date, hebrew_date, note } = req.body;
  const amt = parseFloat(amount);
  if (!person || !Number.isFinite(amt) || amt === 0)
    return res.status(400).json({ error: 'שם וסכום שונה מאפס חובה' });
  if (date && !validISODate(date)) return res.status(400).json({ error: `תאריך לא תקין: ${date}` });
  try {
    const id = /^\d+$/.test(String(bodyId)) ? Number(bodyId) : genId();
    const r = await pool.query(
      `INSERT INTO credits (id, person_name, amount, date, hebrew_date, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET person_name=$2, amount=$3, date=$4, hebrew_date=$5, note=$6
       RETURNING *`,
      [id, person, amt, date || null, hebrew_date || null, note || null, req.user.id]
    );
    await logAction(req.user.id, req.user.username, amt > 0 ? 'credit_add' : 'credit_use', 'credits', id, { person, amount: amt });
    syncCredit('add', r.rows[0], req.user.username);
    res.status(201).json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// DELETE /api/credits/:id
router.delete('/:id', authenticate, requireDelete, requirePayments, async (req, res) => {
  try {
    await pool.query('DELETE FROM credits WHERE id=$1', [req.params.id]);
    await logAction(req.user.id, req.user.username, 'delete', 'credits', req.params.id, {});
    syncCredit('delete', { id: req.params.id }, req.user.username);
    res.json({ message: 'תנועת הזכות נמחקה' });
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
