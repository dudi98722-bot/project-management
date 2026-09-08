// תזכורות. done נשמר עם מי סימן ומתי, כדי שהסימון יהיה מעקב ולא רק תצוגה.
const express = require('express');
const { pool, logAction } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const { crudRouter } = require('./_crud');

const router = crudRouter('reminders', [
  { key: 'contact_id', type: 'int' },
  { key: 'due_date', type: 'date' },
  { key: 'text', type: 'text' },
], {
  // פתוחות קודם, והמוקדמות ביותר בראש — זה הסדר שבו עובדים איתן
  orderBy: 't.done ASC, t.due_date ASC NULLS LAST, t.id DESC',
  filterCols: ['contact_id'],
  viewSql: `SELECT t.*, c.name AS contact_name,
              u.full_name AS created_by_name, ud.full_name AS done_by_name,
              (t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE AND t.done=false) AS overdue,
              (CURRENT_DATE - t.due_date) AS days_late
            FROM reminders t
            LEFT JOIN contacts c ON c.id = t.contact_id
            LEFT JOIN users u ON u.id = t.created_by
            LEFT JOIN users ud ON ud.id = t.done_by`,
});

// סימון ביצוע/ביטול — גם קבוצתי
router.post('/done', authenticate, can('edit'), async (req, res) => {
  const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : [])
    .map(Number).filter(n => Number.isInteger(n) && n > 0))];
  if (!ids.length) return res.status(400).json({ error: 'לא נבחרו תזכורות' });
  const done = req.body.done !== false;
  try {
    const r = await pool.query(
      `UPDATE reminders
          SET done=$1,
              done_by = CASE WHEN $1 THEN $2::int ELSE NULL END,
              done_at = CASE WHEN $1 THEN NOW() ELSE NULL END,
              updated_by=$2, updated_at=NOW()
        WHERE id = ANY($3::bigint[]) AND deleted=false
        RETURNING id`, [done, req.user.id, ids]);
    await logAction(req.user, done ? 'done' : 'undone', 'reminders', null, { count: r.rows.length });
    res.json({ changed: r.rows.length, done });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
