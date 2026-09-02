// מפעל ראוטרים גנרי לישויות פשוטות — CRUD מלא + מחיקה רכה.
// טבלאות עם לוגיקה מיוחדת (ס"ת, מכירות) מגדירות ראוטר משלהן.
const express = require('express');
const { pool, logAction, softDelete } = require('../db');
const { authenticate, can } = require('../middleware/auth');

// הטבלאות שדורשות אישור מנהל. מתמלא בזמן טעינת הראוטרים ונקרא ע"י הייבוא,
// כדי שכלל האישור יהיה מוגדר במקום אחד ולא ישוכפל.
const APPROVABLE = new Set();

// num — ניקוי מספר ממחרוזת (₪, פסיקים, רווחים)
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/[₪$,\s]/g, ''));
  return isNaN(n) ? null : n;
}

function coerce(f, v) {
  if (v === undefined) return null;
  if (f.type === 'num') return num(v);
  if (f.type === 'int') { const n = num(v); return n === null ? null : Math.round(n); }
  if (f.type === 'bool') return v === true || v === 'true' || v === 1 || v === '1';
  if (f.type === 'date') return v || null;
  return (v === '' ? null : v);
}

// יוצר ראוטר CRUD.
//   table   - שם הטבלה
//   fields  - [{ key, type }]  type: 'text' | 'num' | 'int' | 'bool' | 'date'
//   opts    - { orderBy, filterCols, softDeleteFn, viewSql, cap, approvable }
// viewSql מאפשר שדות מחושבים/צירופים בקריאה; הטבלה תמיד בכינוי t.
function crudRouter(table, fields, opts = {}) {
  const router = express.Router();
  const orderBy = opts.orderBy || 't.id';
  const cols = fields.map(f => f.key);
  const filterCols = opts.filterCols || [];   // עמודות שמותר לסנן לפיהן דרך query
  const del = opts.softDeleteFn || ((id, user) => softDelete(table, id, user));
  const base = opts.viewSql || `SELECT t.* FROM ${table} t`;
  // הרשאה נוספת שנדרשת לכל הפעולות בטבלה (למשל finance לתשלומי לקוחות)
  const gate = opts.cap ? [can(opts.cap)] : [];
  if (opts.approvable) APPROVABLE.add(table);

  // רשימה (עם סינון אופציונלי)
  router.get('/', authenticate, ...gate, can('view'), async (req, res) => {
    try {
      const where = ['t.deleted=false']; const vals = [];
      for (const c of filterCols) {
        if (req.query[c] !== undefined && req.query[c] !== '') { vals.push(req.query[c]); where.push(`t.${c}=$${vals.length}`); }
      }
      const r = await pool.query(`${base} WHERE ${where.join(' AND ')} ORDER BY ${orderBy}`, vals);
      res.json(r.rows);
    } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
  });

  // רשומה בודדת
  router.get('/:id', authenticate, ...gate, can('view'), async (req, res) => {
    try {
      const r = await pool.query(`${base} WHERE t.id=$1 AND t.deleted=false`, [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'לא נמצא' });
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
  });

  // יצירה
  router.post('/', authenticate, ...gate, can('edit'), async (req, res) => {
    try {
      const vals = fields.map(f => coerce(f, req.body[f.key]));
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
      // מנהל שמזין בעצמו אינו צריך לאשר את עצמו — רק מה שהמזכיר מכניס ממתין
      const selfOk = !!(opts.approvable && req.caps && req.caps.approve);
      const extraCols = selfOk ? ', approved, approved_by, approved_at' : '';
      const extraVals = selfOk ? `, true, $${cols.length + 1}, NOW()` : '';
      const r = await pool.query(
        `INSERT INTO ${table} (${cols.join(',')}, created_by, updated_by${extraCols})
         VALUES (${placeholders}, $${cols.length + 1}, $${cols.length + 1}${extraVals}) RETURNING *`,
        [...vals, req.user.id]
      );
      await logAction(req.user, 'add', table, r.rows[0].id, {}, r.rows[0]);
      res.status(201).json(r.rows[0]);
    } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
  });

  // עדכון
  router.put('/:id', authenticate, ...gate, can('edit'), async (req, res) => {
    try {
      const vals = fields.map(f => coerce(f, req.body[f.key]));
      const set = cols.map((c, i) => `${c}=$${i + 1}`).join(', ');
      const r = await pool.query(
        `UPDATE ${table} SET ${set}, updated_by=$${cols.length + 1}, updated_at=NOW()
         WHERE id=$${cols.length + 2} AND deleted=false RETURNING *`,
        [...vals, req.user.id, req.params.id]
      );
      if (!r.rows.length) return res.status(404).json({ error: 'לא נמצא' });
      await logAction(req.user, 'edit', table, req.params.id, {}, r.rows[0]);
      res.json(r.rows[0]);
    } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
  });

  // אישור מנהל — סימון קבוצתי של שורות שהעובד הזין.
  // נרשם גם מי אישר ומתי, אחרת הסימון לא שווה הרבה כמעקב.
  if (opts.approvable) {
    router.post('/approve', authenticate, ...gate, can('approve'), async (req, res) => {
      const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : [])
        .map(Number).filter(n => Number.isInteger(n) && n > 0))];
      if (!ids.length) return res.status(400).json({ error: 'לא נבחרו שורות' });
      const approved = req.body.approved !== false;
      try {
        const r = await pool.query(
          `UPDATE ${table}
              SET approved=$1,
                  approved_by = CASE WHEN $1 THEN $2::int ELSE NULL END,
                  approved_at = CASE WHEN $1 THEN NOW() ELSE NULL END
            WHERE id = ANY($3::bigint[]) AND deleted=false
            RETURNING id`, [approved, req.user.id, ids]);
        await logAction(req.user, approved ? 'approve' : 'unapprove', table, null,
          { count: r.rows.length, ids });
        res.json({ changed: r.rows.length, approved });
      } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
    });
  }

  // מחיקה רכה
  router.delete('/:id', authenticate, ...gate, can('del'), async (req, res) => {
    try {
      const ok = await del(req.params.id, req.user);
      if (!ok) return res.status(404).json({ error: 'לא נמצא' });
      res.json({ message: 'הועבר לסל המחזור' });
    } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
  });

  return router;
}

module.exports = { crudRouter, num, coerce, APPROVABLE };
