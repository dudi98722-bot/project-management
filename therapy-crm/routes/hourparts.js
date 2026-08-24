// חלקי יום — מיפוי של כל שעה לבוקר / צהריים / אחה"צ / ערב.
// משמש לדוח "ממתינים לפי חלק יום" ולסינון ברשימת הממתינים.
const express = require('express');
const { pool, logAction } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const router = express.Router();

const PARTS = [
  { key: 'morning',   label: 'בוקר' },
  { key: 'noon',      label: 'צהריים' },
  { key: 'afternoon', label: 'אחה"צ' },
  { key: 'evening',   label: 'ערב' },
];
const VALID = new Set(PARTS.map(p => p.key));

router.get('/', authenticate, async (req, res) => {
  try {
    const r = await pool.query('SELECT hour, part FROM hour_parts ORDER BY hour');
    const map = {};
    r.rows.forEach(x => { map[x.hour] = x.part; });
    res.json({ parts: PARTS, map });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// שמירת המיפוי כולו: { map: { "8": "morning", ... } }
router.put('/', authenticate, can('edit'), async (req, res) => {
  const map = (req.body || {}).map || {};
  const rows = Object.entries(map)
    .map(([h, p]) => [Number(h), String(p)])
    .filter(([h, p]) => Number.isInteger(h) && h >= 8 && h <= 21 && VALID.has(p));
  if (!rows.length) return res.status(400).json({ error: 'לא התקבל מיפוי תקין' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [h, p] of rows) {
      await client.query(
        'INSERT INTO hour_parts (hour, part) VALUES ($1,$2) ON CONFLICT (hour) DO UPDATE SET part=EXCLUDED.part',
        [h, p]);
    }
    await client.query('COMMIT');
    await logAction(req.user, 'edit', 'hour_parts', '', { hours: rows.length });
    res.json({ ok: true, saved: rows.length });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  } finally { client.release(); }
});

module.exports = router;
