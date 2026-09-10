// ממתינים לאינטייק — פונים שממתינים לשיחת אינטייק.
// רשימה נפרדת לגמרי מרשימת הממתינים לשיבוץ (patients): בלי שעות, שיוך או סטטוס.
const express = require('express');
const { pool, logAction, softDelete, validId } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const router = express.Router();

const HMOS = ['מכבי', 'כללית', 'לאומית', 'מאוחדת'];

function cleanBody(b) {
  const out = {
    last_name: String(b.last_name || '').trim().slice(0, 100),
    first_name: String(b.first_name || '').trim().slice(0, 100),
    national_id: String(b.national_id || '').trim().slice(0, 20) || null,
    hmo: b.hmo ? String(b.hmo).trim() : null,
    urgency_reason: String(b.urgency_reason || '').trim().slice(0, 2000) || null,
  };
  const errors = [];
  if (!out.last_name || !out.first_name) errors.push('שם משפחה ושם פרטי חובה');
  if (out.hmo && !HMOS.includes(out.hmo)) errors.push('קופת חולים לא תקינה');
  return { out, errors };
}

// הודעה ברורה במקום שגיאת אילוץ: מי כבר רשום עם אותה ת.ז
async function duplicateMsg(nationalId, exceptId) {
  if (!nationalId) return null;
  const r = await pool.query(
    `SELECT last_name, first_name FROM intake_waiting
      WHERE national_id=$1 AND deleted=false AND id<>$2 LIMIT 1`, [nationalId, exceptId || 0]);
  return r.rows.length ? `ת.ז ${nationalId} כבר ברשימה (${r.rows[0].last_name} ${r.rows[0].first_name})` : null;
}
const DUP_MSG = 'מספר הזהות הזה כבר ברשימת הממתינים לאינטייק';

router.get('/', authenticate, can('viewIntake'), async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM intake_waiting WHERE deleted=false ORDER BY created_at, id');
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.post('/', authenticate, can('editIntake'), async (req, res) => {
  const { out, errors } = cleanBody(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join(', ') });
  try {
    const dup = await duplicateMsg(out.national_id);
    if (dup) return res.status(409).json({ error: dup });
    const r = await pool.query(
      `INSERT INTO intake_waiting (last_name, first_name, national_id, hmo, urgency_reason, created_by, created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [out.last_name, out.first_name, out.national_id, out.hmo, out.urgency_reason,
       req.user.id, req.user.full_name || req.user.username]);
    await logAction(req.user, 'add', 'intake_waiting', r.rows[0].id, { name: `${out.last_name} ${out.first_name}` });
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: DUP_MSG });
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.put('/:id', authenticate, can('editIntake'), async (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: 'מזהה לא תקין' });
  const { out, errors } = cleanBody(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join(', ') });
  try {
    const dup = await duplicateMsg(out.national_id, id);
    if (dup) return res.status(409).json({ error: dup });
    const r = await pool.query(
      `UPDATE intake_waiting SET last_name=$1, first_name=$2, national_id=$3, hmo=$4, urgency_reason=$5,
              updated_by=$6, updated_by_name=$7, updated_at=NOW()
        WHERE id=$8 AND deleted=false RETURNING *`,
      [out.last_name, out.first_name, out.national_id, out.hmo, out.urgency_reason,
       req.user.id, req.user.full_name || req.user.username, id]);
    if (!r.rows.length) return res.status(404).json({ error: 'לא נמצא' });
    await logAction(req.user, 'edit', 'intake_waiting', id, {});
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: DUP_MSG });
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// הסרה מהרשימה (אחרי האינטייק) — מחיקה רכה, הרשומה נשמרת במסד
router.delete('/:id', authenticate, can('editIntake'), async (req, res) => {
  try {
    const ok = await softDelete('intake_waiting', req.params.id, req.user);
    if (!ok) return res.status(404).json({ error: 'לא נמצא' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
