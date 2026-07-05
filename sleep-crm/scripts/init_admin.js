// Creates DB schema + the consultant admin user from .env values.
// Run once on the VPS:  node scripts/init_admin.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');

const USER = process.env.ADMIN_USER || 'admin';
const PASS = process.env.ADMIN_PASSWORD || 'changeme';

(async () => {
  try {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('✅ Schema applied');

    const hash = await bcrypt.hash(PASS, 10);
    await pool.query(
      `INSERT INTO users (username, password_hash, role) VALUES ($1,$2,'admin')
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [USER, hash]
    );
    console.log(`✅ Admin user ready: ${USER}`);
    process.exit(0);
  } catch (e) {
    console.error('❌ init failed:', e.message);
    process.exit(1);
  }
})();
