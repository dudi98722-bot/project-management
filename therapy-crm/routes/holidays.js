// ימי חופש וחג — תאריכים שבהם אין טיפולים. יצירת סדרות מדלגת עליהם אוטומטית.
const express = require('express');
const { pool, logAction } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const router = express.Router();

function parseDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return null;
  const d = new Date(s + 'T00:00:00Z');
  return isNaN(d.getTime()) ? null : d;
}
function fmtDate(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const x = new Date(d.getTime()); x.setUTCDate(x.getUTCDate() + n); return x; }

router.get('/', authenticate, async (req, res) => {
  try {
    const parts = [], params = [];
    if (parseDate(req.query.from)) { params.push(req.query.from); parts.push(`date >= $${params.length}`); }
    if (parseDate(req.query.to)) { params.push(req.query.to); parts.push(`date <= $${params.length}`); }
    const where = parts.length ? 'WHERE ' + parts.join(' AND ') : '';
    const r = await pool.query(`SELECT * FROM holidays ${where} ORDER BY date`, params);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// הוספה: תאריך בודד { date, name } או טווח { from, to, name } (כולל, עד שנה)
router.post('/', authenticate, can('edit'), async (req, res) => {
  const b = req.body || {};
  const name = b.name ? String(b.name).trim() : null;
  const from = parseDate(b.from || b.date);
  const to = parseDate(b.to || b.date);
  if (!from || !to) return res.status(400).json({ error: 'תאריך לא תקין' });
  if (to < from) return res.status(400).json({ error: 'תאריך הסיום לפני ההתחלה' });
  const days = Math.round((to - from) / 86400000) + 1;
  if (days > 366) return res.status(400).json({ error: 'טווח ארוך מדי (עד שנה)' });
  try {
    const added = [];
    for (let d = from, i = 0; i < days; i++, d = addDays(d, 1)) {
      const r = await pool.query(
        `INSERT INTO holidays (date, name) VALUES ($1,$2)
         ON CONFLICT (date) DO UPDATE SET name = COALESCE(EXCLUDED.name, holidays.name)
         RETURNING *`, [fmtDate(d), name]);
      added.push(r.rows[0]);
    }
    await logAction(req.user, 'add', 'holidays', added[0].id, { from: fmtDate(from), to: fmtDate(to), name, days });
    res.status(201).json({ added: added.length, holidays: added });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.delete('/:id', authenticate, can('edit'), async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM holidays WHERE id=$1 RETURNING id, date, name', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'לא נמצא' });
    await logAction(req.user, 'delete', 'holidays', req.params.id, r.rows[0]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
