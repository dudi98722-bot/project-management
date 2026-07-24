const { Pool, types } = require('pg');

// BIGINT (int8) -> number (המזהים קטנים; משווים x.id === +val בצד הלקוח)
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
// DATE (1082) -> מחרוזת 'YYYY-MM-DD' גולמית, בלי המרת אזור-זמן שמזיזה תאריכים בדוחות
types.setTypeParser(1082, (v) => v);
// NUMERIC (1700) -> number (סכומים; כדי שחישובים בצד הלקוח יעבדו)
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '')
    ? { rejectUnauthorized: false } : false
});

// גיבוי לגוגל שיטס — נטען בעצלתיים. אם החבילה לא מותקנת, הכל ממשיך לעבוד בלעדיו.
let sheets = null;
try { sheets = require('./sheets'); } catch (e) { sheets = null; }

// ===== יומן פעולות =====
// נרשם במסד, ובמקביל נשלח לגיבוי בשיטס (אם מוגדר).
async function logAction(user, action, tableName, recordId, details, record) {
  try {
    await pool.query(
      'INSERT INTO audit_log (user_id, username, action, table_name, record_id, details) VALUES ($1,$2,$3,$4,$5,$6)',
      [user && user.id, user && user.username, action, tableName, recordId, JSON.stringify(details || {})]
    );
  } catch (e) { console.error('Audit log error:', e.message); }
  if (sheets) {
    // לא ממתינים — גיבוי איטי לא יעכב את התשובה למשתמש
    sheets.backup(user, action, tableName, recordId, record, details).catch(() => {});
  }
}

// ===== מחיקה רכה בלבד — לעולם לא מוחקים פיזית =====
const SOFT_TABLES = new Set([
  'contacts', 'products', 'parchment_sizes', 'list_items',
  'scrolls', 'pages_log', 'scribe_payments', 'customer_payments',
  'book_expenses', 'parchment_expenses', 'business_expenses',
  'prod_purchases', 'prod_scribe_payments', 'prod_sales', 'prod_customer_payments'
]);

// רשומות בן שנמחקות יחד עם הספר שלהן
const SCROLL_CHILDREN = ['pages_log', 'scribe_payments', 'customer_payments', 'book_expenses', 'parchment_expenses'];

function validId(id) { const n = Number(id); return (Number.isInteger(n) && n > 0) ? n : null; }

async function softDelete(table, id, user) {
  if (!SOFT_TABLES.has(table)) throw new Error('bad table');
  const nid = validId(id); if (nid === null) return false;
  const r = await pool.query(
    `UPDATE ${table} SET deleted=true, deleted_at=NOW(), deleted_by=$2 WHERE id=$1 AND deleted=false RETURNING *`,
    [nid, user && user.id]
  );
  if (r.rows.length) await logAction(user, 'delete', table, nid, {}, r.rows[0]);
  return r.rows.length > 0;
}

async function restore(table, id, user) {
  if (!SOFT_TABLES.has(table)) throw new Error('bad table');
  const nid = validId(id); if (nid === null) return false;
  const r = await pool.query(
    `UPDATE ${table} SET deleted=false, deleted_at=NULL, deleted_by=NULL WHERE id=$1 AND deleted=true RETURNING *`,
    [nid]
  );
  if (r.rows.length) await logAction(user, 'restore', table, nid, {}, r.rows[0]);
  return r.rows.length > 0;
}

// מחיקת ספר מדביקה לילדיו (עמודים/תשלומים/הוצאות) —
// אחרת נתונים יתומים ממשיכים להיספר בדוחות.
async function softDeleteScroll(id, user) {
  const nid = validId(id); if (nid === null) return false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE scrolls SET deleted=true, deleted_at=NOW(), deleted_by=$2 WHERE id=$1 AND deleted=false RETURNING *`,
      [nid, user && user.id]);
    if (!r.rows.length) { await client.query('ROLLBACK'); return false; }
    const ts = r.rows[0].deleted_at;
    for (const t of SCROLL_CHILDREN) {
      await client.query(`UPDATE ${t} SET deleted=true, deleted_at=$3, deleted_by=$2 WHERE scroll_id=$1 AND deleted=false`,
        [nid, user && user.id, ts]);
    }
    await client.query('COMMIT');
    await logAction(user, 'delete', 'scrolls', nid, { cascade: true }, r.rows[0]);
    return true;
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

// שחזור ספר מחזיר רק את הילדים שנמחקו *באותה* פעולה (לפי חותמת הזמן),
// כדי לא להחיות רשומות שנמחקו ידנית לפני כן.
async function restoreScroll(id, user) {
  const nid = validId(id); if (nid === null) return false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT deleted_at FROM scrolls WHERE id=$1 AND deleted=true', [nid]);
    if (!cur.rows.length) { await client.query('ROLLBACK'); return false; }
    const ts = cur.rows[0].deleted_at;
    const r = await client.query('UPDATE scrolls SET deleted=false, deleted_at=NULL, deleted_by=NULL WHERE id=$1 RETURNING *', [nid]);
    for (const t of SCROLL_CHILDREN) {
      await client.query(`UPDATE ${t} SET deleted=false, deleted_at=NULL, deleted_by=NULL WHERE scroll_id=$1 AND deleted=true AND deleted_at=$2`, [nid, ts]);
    }
    await client.query('COMMIT');
    await logAction(user, 'restore', 'scrolls', nid, { cascade: true }, r.rows[0]);
    return true;
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

// מחיקת רכישת מוצר מדביקה למכירות שנגזרו ממנה (אחרת המלאי והרווח יתבלבלו)
async function softDeletePurchase(id, user) {
  const nid = validId(id); if (nid === null) return false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE prod_purchases SET deleted=true, deleted_at=NOW(), deleted_by=$2 WHERE id=$1 AND deleted=false RETURNING *`,
      [nid, user && user.id]);
    if (!r.rows.length) { await client.query('ROLLBACK'); return false; }
    const ts = r.rows[0].deleted_at;
    await client.query(`UPDATE prod_sales SET deleted=true, deleted_at=$3, deleted_by=$2 WHERE purchase_id=$1 AND deleted=false`,
      [nid, user && user.id, ts]);
    await client.query('COMMIT');
    await logAction(user, 'delete', 'prod_purchases', nid, { cascade: true }, r.rows[0]);
    return true;
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

async function restorePurchase(id, user) {
  const nid = validId(id); if (nid === null) return false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT deleted_at FROM prod_purchases WHERE id=$1 AND deleted=true', [nid]);
    if (!cur.rows.length) { await client.query('ROLLBACK'); return false; }
    const ts = cur.rows[0].deleted_at;
    const r = await client.query('UPDATE prod_purchases SET deleted=false, deleted_at=NULL, deleted_by=NULL WHERE id=$1 RETURNING *', [nid]);
    await client.query(`UPDATE prod_sales SET deleted=false, deleted_at=NULL, deleted_by=NULL WHERE purchase_id=$1 AND deleted=true AND deleted_at=$2`, [nid, ts]);
    await client.query('COMMIT');
    await logAction(user, 'restore', 'prod_purchases', nid, { cascade: true }, r.rows[0]);
    return true;
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

module.exports = {
  pool, logAction, validId, SOFT_TABLES,
  softDelete, restore,
  softDeleteScroll, restoreScroll,
  softDeletePurchase, restorePurchase,
};
