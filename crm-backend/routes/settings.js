const express = require('express');
const { pool, logAction } = require('../db');
const { authenticate, requireWrite } = require('../middleware/auth');
const router = express.Router();

const DEFAULT_METHODS = ['מזומן', 'שיק', 'העברה בנקאית', 'כרטיס אשראי', 'פייבוקס', 'ביט'];

async function getSetting(key, fallback) {
  const r = await pool.query('SELECT value FROM app_settings WHERE key=$1', [key]);
  if (!r.rows.length) return fallback;
  try { return JSON.parse(r.rows[0].value); } catch { return fallback; }
}
async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value=$2`,
    [key, JSON.stringify(value)]
  );
}

// GET payment methods
router.get('/methods', authenticate, async (req, res) => {
  try { res.json(await getSetting('payment_methods', DEFAULT_METHODS)); }
  catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

// POST payment methods (write access)
router.post('/methods', authenticate, requireWrite, async (req, res) => {
  const { methods } = req.body;
  if (!Array.isArray(methods)) return res.status(400).json({ error: 'רשימה לא תקינה' });
  const clean = methods.map(m => String(m).trim()).filter(Boolean);
  try {
    await setSetting('payment_methods', clean);
    await logAction(req.user.id, req.user.username, 'edit', 'settings', 0, { what: 'payment_methods' });
    res.json({ message: 'נשמר', methods: clean });
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
