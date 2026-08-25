// ייבוא מרוכז מאקסל — מטופלים או מטפלים.
// הקובץ מפוענח בדפדפן; לכאן מגיעות שורות מוכנות כ-JSON.
const express = require('express');
const { pool, logAction } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const sheets = require('../sheets');
const {
  parseDate: parseIsoDate, fmtDate, worksAt, weeklySlotOccupied, insertWeeklySessions,
} = require('../lib/scheduling');
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
router.post('/patients', authenticate, can('addPatient'), async (req, res) => {
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
         req.caps.editDiagnosis && r.diagnosis ? String(r.diagnosis).trim() : null,
         r.notes ? String(r.notes).trim() : null,
         req.caps.editNote2 && r.notes2 ? String(r.notes2).trim() : null,
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

// ===== ייבוא מטופלים קיימים (שם + מטפל + שעה + סדרה) =====
// כל שורה נוצרת בטרנזקציה משלה: שורה שנכשלת לא מפילה את כל הייבוא,
// ומוחזר דיווח מפורט מה נכנס ומה לא ולמה.
router.post('/existing', authenticate, can('assign'), async (req, res) => {
  const rows = Array.isArray((req.body || {}).rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'לא התקבלו שורות' });
  const defaultTotal = Number((req.body || {}).default_total) || 12;

  const tr = await pool.query('SELECT id, name, work_schedule FROM therapists WHERE deleted=false');
  const byName = new Map(tr.rows.map(t => [norm(t.name), t]));

  const added = [], failed = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], line = i + 2;   // +2 = שורת הכותרת באקסל
    const last = String(r.last_name || '').trim();
    const first = String(r.first_name || '').trim();
    const label = `${last} ${first}`.trim() || '(ללא שם)';

    if (!last && !first) { failed.push({ line, label, reason: 'אין שם' }); continue; }

    const tName = String(r.therapist_name || '').trim();
    const therapist = byName.get(norm(tName));
    if (!therapist) { failed.push({ line, label, reason: tName ? `מטפל לא נמצא: ${tName}` : 'אין מטפל' }); continue; }

    const hour = parseHour(r.hour);
    if (hour === null) { failed.push({ line, label, reason: `שעה לא תקינה: ${r.hour || '(ריק)'}` }); continue; }

    const ds = parseDate(r.start_date);
    const start = ds ? parseIsoDate(ds) : null;
    if (!start) { failed.push({ line, label, reason: `תאריך התחלה לא תקין: ${r.start_date || '(ריק)'}` }); continue; }

    let total = Number(String(r.total_sessions || '').replace(/[^\d]/g, ''));
    if (!Number.isInteger(total) || total < 1 || total > 200) total = defaultTotal;

    const weekday = start.getUTCDay();
    if (!worksAt(therapist, weekday, hour)) {
      failed.push({ line, label, reason: `${therapist.name} לא עובד ביום ${WEEKDAYS[weekday]} בשעה ${hour}:00` });
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (await weeklySlotOccupied(client, therapist.id, weekday, hour, fmtDate(start))) {
        await client.query('ROLLBACK');
        failed.push({ line, label, reason: `המשבצת ${WEEKDAYS[weekday]} ${hour}:00 תפוסה אצל ${therapist.name}` });
        continue;
      }
      const pr = await client.query(
        `INSERT INTO patients (last_name, first_name, national_id, notes, notes2, status, preferred_therapist_ids)
         VALUES ($1,$2,$3,$4,$5,'assigned',$6) RETURNING *`,
        [last || '—', first || '—', r.national_id ? String(r.national_id).trim() : null,
         r.notes ? String(r.notes).trim() : null,
         req.caps.editNote2 && r.notes2 ? String(r.notes2).trim() : null,
         JSON.stringify([therapist.id])]);
      const patient = pr.rows[0];

      const ar = await client.query(
        `INSERT INTO assignments (patient_id, therapist_id, total_sessions, start_date, hour, weekday, kind)
         VALUES ($1,$2,$3,$4,$5,$6,'series') RETURNING *`,
        [patient.id, therapist.id, total, fmtDate(start), hour, weekday]);
      const assignment = ar.rows[0];

      const { created } = await insertWeeklySessions(client, assignment, start, total, 1);
      if (created.length < total) {
        await client.query('ROLLBACK');
        failed.push({ line, label, reason: 'לא ניתן לשבץ את כל הפגישות (התנגשויות או ימי חופש)' });
        continue;
      }
      await client.query('COMMIT');
      added.push({ patient, assignment, sessions: created.length, therapist: therapist.name });
      sheets.backup(req.user, 'add', 'patients', patient.id, patient, { import: true });
      sheets.backup(req.user, 'add', 'assignments', assignment.id, assignment, { import: true });
      sheets.mirrorMany('sessions', created);
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      failed.push({ line, label, reason: e.code === '23505' ? 'המשבצת נתפסה' : 'שגיאת שרת' });
      if (e.code !== '23505') console.error('import/existing line', line, e.message);
    } finally { client.release(); }
  }

  await logAction(req.user, 'import', 'assignments', '', { added: added.length, failed: failed.length });
  res.json({
    added: added.length,
    total_sessions: added.reduce((n, a) => n + a.sessions, 0),
    failed,
  });
});

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

// שעה מהאקסל: 9 / "9" / "9:00" / "09:00" / תא-זמן של אקסל (שבר מהיממה)
function parseHour(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  let h = null;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (m) h = Number(m[1]);
  else if (/^0?\.\d+$/.test(s)) h = Math.round(Number(s) * 24);   // אקסל שומר שעה כשבר
  else {
    const d = new Date(s);
    if (!isNaN(d.getTime())) h = d.getHours();
  }
  return Number.isInteger(h) && h >= 8 && h <= 21 ? h : null;
}

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
