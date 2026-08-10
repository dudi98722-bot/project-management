const { Pool, types } = require('pg');

// BIGINT (int8) -> number (המזהים קטנים; משווים x.id === +val בצד הלקוח)
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
// DATE (1082) -> מחרוזת 'YYYY-MM-DD' גולמית, בלי המרת אזור-זמן שמזיזה תאריכים
types.setTypeParser(1082, (v) => v);
// NUMERIC (1700) -> number
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '')
    ? { rejectUnauthorized: false } : false
});

// ===== יומן פעולות =====
async function logAction(user, action, tableName, recordId, details) {
  try {
    await pool.query(
      'INSERT INTO audit_log (user_id, username, action, table_name, record_id, details) VALUES ($1,$2,$3,$4,$5,$6)',
      [user && user.id, user && user.username, action, tableName, String(recordId || ''), JSON.stringify(details || {})]
    );
  } catch (e) { console.error('Audit log error:', e.message); }
}

// ===== מחיקה רכה בלבד — לעולם לא מוחקים פיזית =====
const SOFT_TABLES = new Set(['patients', 'therapists', 'therapist_groups', 'assignments', 'sessions']);

function validId(id) { const n = Number(id); return (Number.isInteger(n) && n > 0) ? n : null; }

async function softDelete(table, id, user) {
  if (!SOFT_TABLES.has(table)) throw new Error('bad table');
  const nid = validId(id); if (nid === null) return false;
  const r = await pool.query(
    `UPDATE ${table} SET deleted=true, deleted_at=NOW(), deleted_by=$2 WHERE id=$1 AND deleted=false RETURNING id`,
    [nid, user && user.id]
  );
  if (r.rows.length) await logAction(user, 'delete', table, nid, {});
  return r.rows.length > 0;
}

async function restore(table, id, user) {
  if (!SOFT_TABLES.has(table)) throw new Error('bad table');
  const nid = validId(id); if (nid === null) return false;
  const r = await pool.query(
    `UPDATE ${table} SET deleted=false, deleted_at=NULL, deleted_by=NULL WHERE id=$1 AND deleted=true RETURNING id`,
    [nid]
  );
  if (r.rows.length) await logAction(user, 'restore', table, nid, {});
  return r.rows.length > 0;
}

module.exports = { pool, logAction, softDelete, restore, validId, SOFT_TABLES };
