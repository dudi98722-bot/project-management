-- ===== CRM ייעוץ שינה היקשרותי - Database Schema =====

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'admin',
  created_at TIMESTAMP DEFAULT NOW(),
  last_login TIMESTAMP
);

-- Each row = one intake questionnaire submitted by a family
CREATE TABLE IF NOT EXISTS submissions (
  id SERIAL PRIMARY KEY,
  parents_names   TEXT,
  child_name      TEXT,
  phone           TEXT,
  main_difficulty TEXT,
  status   VARCHAR(20) NOT NULL DEFAULT 'new'
           CHECK (status IN ('new','in_progress','done')),
  notes    TEXT DEFAULT '',
  answers  JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_submissions_status  ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions(created_at DESC);

-- NOTE: the admin user is created by running: node scripts/init_admin.js
