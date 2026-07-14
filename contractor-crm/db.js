const { Pool } = require('pg');
const sheets = require('./sheets');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ===== Audit log + גיבוי ל-Google Sheets =====
async function logAction(user, action, tableName, recordId, details) {
  try {
    await pool.query(
      'INSERT INTO audit_log (user_id, username, action, table_name, record_id, details) VALUES ($1,$2,$3,$4,$5,$6)',
      [user && user.id, user && user.username, action, tableName, recordId, JSON.stringify(details || {})]
    );
  } catch (e) {
    console.error('Audit log error:', e.message);
  }
  // גיבוי ל-Google Sheets - רקע בלבד, לעולם לא חוסם או מפיל את הבקשה
  try {
    if (sheets.enabled()) {
      // פעולות אצווה מקבלות recordId שאינו מזהה של שורה בטבלה (למשל מזהה פרויקט);
      // אותן משקפים במפורש ב-routes, כאן רק רושמים את הפעולה.
      const bulk = BULK_ACTIONS.has(action);
      let record = null;
      if (!bulk && sheets.hasTab(tableName) && recordId) {
        try { const r = await pool.query(`SELECT * FROM ${tableName} WHERE id=$1`, [recordId]); record = r.rows[0] || null; } catch (e) {}
      }
      sheets.backup(user, action, tableName, recordId, record, details).catch(() => {});
    }
  } catch (e) { /* גיבוי לא קריטי */ }
}
const BULK_ACTIONS = new Set(['bulk_add', 'bulk_delete', 'import']);

// שיקוף מרוכז של פרויקט + ילדיו ל-Sheets (אחרי מחיקה/שחזור מדביקים)
function mirrorProjectChildren(nid) {
  if (!sheets.enabled()) return;
  Promise.resolve().then(async () => {
    try {
      const st = await pool.query('SELECT * FROM stages WHERE project_id=$1', [nid]);
      const tx = await pool.query('SELECT * FROM transactions WHERE project_id=$1', [nid]);
      sheets.mirrorMany('stages', st.rows).catch(() => {});
      sheets.mirrorMany('transactions', tx.rows).catch(() => {});
    } catch (e) { /* ignore */ }
  });
}

// ===== מחיקה רכה בלבד - לעולם לא מוחקים פיזית =====
// כל הטבלאות של נתונים מכילות deleted / deleted_at / deleted_by
const SOFT_TABLES = new Set([
  'subcontractors', 'projects', 'stages', 'transactions', 'home_transactions'
]);

// מזהה חוקי (מספר שלם חיובי). מזהה לא תקין -> false (מתורגם ל-404 ולא ל-500)
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

// מחיקת פרויקט מדביקה (cascade) לשלבים ולתנועות שלו - אחרת נתונים "יתומים"
// ממשיכים להיספר בדוחות למרות שהפרויקט נמחק. כל הילדים מקבלים את אותו deleted_at
// כמו הפרויקט, כדי שהשחזור יחזיר בדיוק את אותה קבוצה.
async function softDeleteProject(id, user) {
  const nid = validId(id); if (nid === null) return false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE projects SET deleted=true, deleted_at=NOW(), deleted_by=$2 WHERE id=$1 AND deleted=false RETURNING deleted_at`,
      [nid, user && user.id]);
    if (!r.rows.length) { await client.query('ROLLBACK'); return false; }
    const ts = r.rows[0].deleted_at;
    await client.query(`UPDATE stages       SET deleted=true, deleted_at=$3, deleted_by=$2 WHERE project_id=$1 AND deleted=false`, [nid, user && user.id, ts]);
    await client.query(`UPDATE transactions SET deleted=true, deleted_at=$3, deleted_by=$2 WHERE project_id=$1 AND deleted=false`, [nid, user && user.id, ts]);
    await client.query('COMMIT');
    await logAction(user, 'delete', 'projects', nid, { cascade: true });
    mirrorProjectChildren(nid);
    return true;
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

async function restoreProject(id, user) {
  const nid = validId(id); if (nid === null) return false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT deleted_at FROM projects WHERE id=$1 AND deleted=true', [nid]);
    if (!cur.rows.length) { await client.query('ROLLBACK'); return false; }
    const ts = cur.rows[0].deleted_at;
    await client.query('UPDATE projects SET deleted=false, deleted_at=NULL, deleted_by=NULL WHERE id=$1', [nid]);
    // מחזירים רק ילדים שנמחקו יחד עם הפרויקט (אותו deleted_at), לא כאלה שנמחקו בנפרד
    await client.query(`UPDATE stages       SET deleted=false, deleted_at=NULL, deleted_by=NULL WHERE project_id=$1 AND deleted=true AND deleted_at=$2`, [nid, ts]);
    await client.query(`UPDATE transactions SET deleted=false, deleted_at=NULL, deleted_by=NULL WHERE project_id=$1 AND deleted=true AND deleted_at=$2`, [nid, ts]);
    await client.query('COMMIT');
    await logAction(user, 'restore', 'projects', nid, { cascade: true });
    mirrorProjectChildren(nid);
    return true;
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

module.exports = { pool, logAction, softDelete, restore, softDeleteProject, restoreProject, validId, SOFT_TABLES };
