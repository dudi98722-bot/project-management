// הגדרות מערכת — זוגות מפתח/ערך בטבלת settings.
// כרגע רק שער ההמרה לדולר, שמשמש את שורת הרווח בס"ת.
const express = require('express');
const { pool, logAction } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const { invalidateRate, DEFAULT_USD_RATE } = require('../calc');
const router = express.Router();

// מפתחות מוכרים בלבד, כדי שהטבלה לא תהפוך למחסן חופשי
const KEYS = {
  usd_rate: { label: 'שער הדולר', type: 'num', def: DEFAULT_USD_RATE, min: 0.01, max: 100 },
};

router.get('/', authenticate, can('view'), async (req, res) => {
  try {
    const r = await pool.query('SELECT key, value FROM settings');
    const out = {};
    for (const k of Object.keys(KEYS)) out[k] = KEYS[k].def;
    for (const row of r.rows) if (KEYS[row.key]) out[row.key] = Number(row.value);
    res.json(out);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.put('/:key', authenticate, can('finance'), async (req, res) => {
  const spec = KEYS[req.params.key];
  if (!spec) return res.status(400).json({ error: 'הגדרה לא מוכרת' });
  const v = Number(req.body.value);
  if (!isFinite(v) || v < spec.min || v > spec.max) {
    return res.status(400).json({ error: `ערך לא תקין (${spec.min}–${spec.max})` });
  }
  try {
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, to_jsonb($2::numeric), NOW())
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
      [req.params.key, v]);
    invalidateRate();   // אחרת החישוב ימשיך עם השער הישן עד שהמטמון יפוג
    await logAction(req.user, 'edit', 'settings', null, { key: req.params.key, value: v });
    res.json({ key: req.params.key, value: v });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
