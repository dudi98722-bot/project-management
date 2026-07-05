const express = require('express');
const { authenticate, requireAdmin, requirePayments } = require('../middleware/auth');
const { getEmailSettings, saveEmailSettings, sendPersonalReport, buildPersonalReport } = require('../mailer');
const { logAction } = require('../db');
const router = express.Router();

// GET email settings (admin) — never returns the password itself
router.get('/settings', authenticate, requireAdmin, async (req, res) => {
  try {
    const s = await getEmailSettings();
    res.json({
      user: s ? s.user : '',
      fromName: s ? s.fromName : '',
      configured: !!(s && s.user && s.pass)
    });
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

// POST email settings (admin) — the admin enters their own credentials
router.post('/settings', authenticate, requireAdmin, async (req, res) => {
  const { user, pass, fromName, host, port } = req.body;
  if (!user) return res.status(400).json({ error: 'כתובת מייל חובה' });
  try {
    const existing = await getEmailSettings() || {};
    const obj = {
      user,
      pass: pass ? pass : existing.pass, // keep old password if not re-entered
      fromName: fromName || existing.fromName || 'בית המדרש אלכסנדר',
      host: host || existing.host || 'smtp.gmail.com',
      port: port || existing.port || 465
    };
    if (!obj.pass) return res.status(400).json({ error: 'סיסמת אפליקציה חובה' });
    await saveEmailSettings(obj);
    await logAction(req.user.id, req.user.username, 'edit', 'settings', 0, { what: 'email' });
    res.json({ message: 'הגדרות המייל נשמרו', configured: true });
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

// POST send a personal report by email (requires payments-level access)
router.post('/send-report', authenticate, requirePayments, async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'שם וכתובת מייל חובה' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'כתובת מייל לא תקינה' });
  try {
    await sendPersonalReport(name, email);
    await logAction(req.user.id, req.user.username, 'email', 'report', 0, { name, email });
    res.json({ message: 'הדוח נשלח בהצלחה אל ' + email });
  } catch (e) {
    if (e.message === 'email_not_configured')
      return res.status(400).json({ error: 'יש להגדיר חשבון מייל קודם (הגדרות מייל)' });
    console.error('send-report error:', e.message);
    res.status(500).json({ error: 'שליחת המייל נכשלה: ' + e.message });
  }
});

// GET preview of the report HTML (admin) — for design testing
router.get('/preview', authenticate, requireAdmin, async (req, res) => {
  try {
    const html = await buildPersonalReport(req.query.name || '');
    res.set('Content-Type', 'text/html; charset=utf-8').send(html);
  } catch (e) { res.status(500).send('שגיאה'); }
});

module.exports = router;
