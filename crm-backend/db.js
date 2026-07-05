const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function logAction(userId, username, action, tableName, recordId, details) {
  try {
    await pool.query(
      'INSERT INTO audit_log (user_id, username, action, table_name, record_id, details) VALUES ($1,$2,$3,$4,$5,$6)',
      [userId, username, action, tableName, recordId, JSON.stringify(details)]
    );
  } catch(e) {
    console.error('Audit log error:', e.message);
  }
}

module.exports = { pool, logAction };
