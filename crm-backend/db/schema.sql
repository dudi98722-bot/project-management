-- ===== CRM מוסדות אלכסנדר - Database Schema =====

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('admin','editor','treasurer','viewer')),
  full_name VARCHAR(200),
  created_at TIMESTAMP DEFAULT NOW(),
  last_login TIMESTAMP
);

-- Contacts table
CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  apt VARCHAR(50),
  title VARCHAR(50),
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  father_name VARCHAR(100),
  phone_home VARCHAR(50),
  phone_mobile VARCHAR(50),
  street VARCHAR(200),
  house_num VARCHAR(20),
  city VARCHAR(100),
  zip VARCHAR(20),
  email VARCHAR(200),
  display_name VARCHAR(300),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Vows table
CREATE TABLE IF NOT EXISTS vows (
  id BIGINT PRIMARY KEY,
  date DATE,
  hebrew_date VARCHAR(100),
  name VARCHAR(300),
  for_a VARCHAR(300),
  for_b VARCHAR(300),
  amount DECIMAL(12,2) DEFAULT 0,
  note TEXT,
  place VARCHAR(300),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
  id BIGINT PRIMARY KEY,
  date DATE,
  hebrew_date VARCHAR(100),
  name VARCHAR(300),
  vow_id BIGINT REFERENCES vows(id) ON DELETE SET NULL,
  amount DECIMAL(12,2) DEFAULT 0,
  method VARCHAR(100),
  num_payments INTEGER DEFAULT 1,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  username VARCHAR(100),
  action VARCHAR(50),
  table_name VARCHAR(50),
  record_id BIGINT,
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contacts_display_name ON contacts(display_name);
CREATE INDEX IF NOT EXISTS idx_vows_name ON vows(name);
CREATE INDEX IF NOT EXISTS idx_payments_name ON payments(name);
CREATE INDEX IF NOT EXISTS idx_payments_vow_id ON payments(vow_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);

-- NOTE: Admin user is created by running: node scripts/import_data.js
-- That script reads ADMIN_PASSWORD from .env and creates a properly hashed user.
