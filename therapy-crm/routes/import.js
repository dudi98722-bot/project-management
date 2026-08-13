// ייבוא מרוכז מאקסל — מטופלים או מטפלים.
// הקובץ מפוענח בדפדפן; לכאן מגיעות שורות מוכנות כ-JSON.
const express = require('express');
const { pool, logAction } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const sheets = require('../sheets');
const router = express.Router();

const HMOS = ['מכבי', 'כללית', 'לאומית', 'מאוחדת'];
const CLIENT_TYPES = ['בן', 'בת', 'הורים', 'מבוגר', 'מבוגרת'];
const ALL_HOURS = Array.from({ length: 14 }, (_, i) => i + 8);

// נרמול שם להשוואה: רווחים כפולים, גרשיים/אפוסטרופים בכתיבים שונים, ותווי כיווניות
function norm(s) {
  return String(s || '')
    .replace(/[‎‏‪-‮]/g, '')
    .replace(/["'`´’”״׳]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// פיצול עמודת "מטפלים מותאמים" — פסיק / נקודה-פסיק / קו נטוי / שורה חדשה
function splitNames(v) {
  return String(v || '')
    .split(/[,;\/|\n\r]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // dd/mm/yyyy או dd.mm.yyyy
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = (Number(y) > 50 ? '19' : '20') + y;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

// ===== ייבוא מטפלים =====
router.post('/therapists', authenticate, can('edit'), async (req, res) => {
  const rows = Array.isArray((req.body || {}).rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'לא התקבלו שורות' });

  const client = await pool.connect();
  try {
    const ex = await client.query('SELECT id, name FROM therapists WHERE deleted=false');
    const byName = new Map(ex.rows.map(t => [norm(t.name), t.id]));
    const added = [], skipped = [];

    await client.query('BEGIN');
    for (const r of rows) {
      const name = String(r.name || '').trim();
      if (!name) { skipped.push({ name: '(ריק)', reason: 'אין שם' }); continue; }
      if (byName.has(norm(name))) { skipped.push({ name, reason: 'כבר קיים' }); continue; }
      const ins = await client.query(
        `INSERT INTO therapists (name, phone, email, notes) VALUES ($1,$2,$3,$4) RETURNING *`,
        [name, r.phone || null, r.email || null, r.notes || null]);
      byName.set(norm(name), ins.rows[0].id);
      added.push(ins.rows[0]);
    }
    await client.query('COMMIT');

    await logAction(req.user, 'import', 'therapists', '', { added: added.length, skipped: skipped.length });
    sheets.mirrorMany('therapists', added);
    res.json({ added: added.length, skipped });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error(e); res.status(500).json({ error: 'שגיאת שרת בייבוא' });
  } finally { client.release(); }
});

// ===== ייבוא מטופלים (כולל עמודת שמות מטפלים) =====
// create_missing_therapists=true -> שם שלא נמצא במערכת ייווצר כמטפל חדש
router.post('/patients', authenticate, can('edit'), async (req, res) => {
  const body = req.body || {};
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'לא התקבלו שורות' });
  const createMissing = !!body.create_missing_therapists;

  const client = await pool.connect();
  try {
    const ex = await client.query('SELECT id, name FROM therapists WHERE deleted=false');
    const byName = new Map(ex.rows.map(t => [norm(t.name), t.id]));

    const added = [], skipped = [], createdTherapists = [];
    const unmatched = new Map();   // שם -> כמה פעמים הופיע

    await client.query('BEGIN');
    for (const r of rows) {
      const last = String(r.last_name || '').trim();
      const first = String(r.first_name || '').trim();
      if (!last && !first) { skipped.push({ name: '(ריק)', reason: 'אין שם' }); continue; }

      // התאמת שמות המטפלים מהעמודה
      const ids = [];
      for (const nm of splitNames(r.therapist_names)) {
        const key = norm(nm);
        let id = byName.get(key);
        if (!id && createMissing) {
          const ins = await client.query('INSERT INTO therapists (name) VALUES ($1) RETURNING *', [nm]);
          id = ins.rows[0].id;
          byName.set(key, id);
          createdTherapists.push(ins.rows[0]);
        }
        if (id) { if (!ids.includes(id)) ids.push(id); }
        else unmatched.set(nm, (unmatched.get(nm) || 0) + 1);
      }

      const urg = Number(r.urgency);
      const hmo = HMOS.includes(String(r.hmo || '').trim()) ? String(r.hmo).trim() : null;
      const ct = CLIENT_TYPES.includes(String(r.client_type || '').trim()) ? String(r.client_type).trim() : null;

      const ins = await client.query(
        `INSERT INTO patients (last_name, first_name, national_id, intake_date, birth_date, hmo, client_type,
                               community, diagnosis, notes, notes2, urgency, hours, preferred_therapist_ids)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [last || '—', first || '—', r.national_id ? String(r.national_id).trim() : null,
         parseDate(r.intake_date), parseDate(r.birth_date), hmo, ct,
         r.community ? String(r.community).trim() : null,
         r.diagnosis ? String(r.diagnosis).trim() : null,
         r.notes ? String(r.notes).trim() : null,
         r.notes2 ? String(r.notes2).trim() : null,
         [1, 2, 3].includes(urg) ? urg : 2,
         JSON.stringify(ALL_HOURS), JSON.stringify(ids)]);
      added.push(ins.rows[0]);
    }
    await client.query('COMMIT');

    await logAction(req.user, 'import', 'patients', '', {
      added: added.length, skipped: skipped.length, created_therapists: createdTherapists.length });
    sheets.mirrorMany('patients', added);
    if (createdTherapists.length) sheets.mirrorMany('therapists', createdTherapists);

    res.json({
      added: added.length,
      skipped,
      created_therapists: createdTherapists.map(t => t.name),
      unmatched: [...unmatched.entries()].map(([name, count]) => ({ name, count })),
    });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error(e); res.status(500).json({ error: 'שגיאת שרת בייבוא' });
  } finally { client.release(); }
});

// בדיקה מקדימה: אילו שמות מטפלים מהעמודה קיימים ואילו לא — בלי לכתוב כלום
router.post('/check-therapists', authenticate, async (req, res) => {
  const names = Array.isArray((req.body || {}).names) ? req.body.names : [];
  try {
    const ex = await pool.query('SELECT id, name FROM therapists WHERE deleted=false');
    const byName = new Map(ex.rows.map(t => [norm(t.name), t.name]));
    const matched = [], missing = [];
    for (const n of [...new Set(names.map(x => String(x).trim()).filter(Boolean))]) {
      if (byName.has(norm(n))) matched.push({ input: n, existing: byName.get(norm(n)) });
      else missing.push(n);
    }
    res.json({ matched, missing });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
