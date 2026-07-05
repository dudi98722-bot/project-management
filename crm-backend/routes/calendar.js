/**
 * לוח שנה עברי — פרשות שבוע וחגים דרך Hebcal (לוח ארץ ישראל).
 * השרת מתווך כדי לעקוף סינון בצד הלקוח, ושומר במטמון (הנתונים קבועים).
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

const cache = new Map();

// GET /api/calendar/events?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/events', authenticate, async (req, res) => {
  const { start, end } = req.query;
  const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  if (!ok(start) || !ok(end)) return res.status(400).json({ error: 'טווח תאריכים לא תקין' });

  const key = start + '_' + end;
  if (cache.has(key)) return res.json(cache.get(key));

  try {
    const url = 'https://www.hebcal.com/hebcal?v=1&cfg=json&start=' + start + '&end=' + end +
                '&s=on&maj=on&i=on&lg=he';
    const r = await fetch(url);
    if (!r.ok) throw new Error('hebcal ' + r.status);
    const data = await r.json();
    const items = (data.items || []).map(it => ({
      date: String(it.date).slice(0, 10),
      title: it.hebrew || it.title,
      category: it.category
    }));
    cache.set(key, items);
    res.json(items);
  } catch (e) {
    console.error('calendar error:', e.message);
    res.status(502).json({ error: 'שגיאה בטעינת לוח השנה' });
  }
});

module.exports = router;
