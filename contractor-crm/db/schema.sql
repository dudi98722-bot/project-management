-- ===== Contractor CRM - Database Schema (PostgreSQL) =====
-- מחיקה רכה בלבד: כל טבלת נתונים כוללת deleted / deleted_at / deleted_by

-- משתמשים
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'field'
    CHECK (role IN ('admin','secretary','owner','reporter','field','home')),
  full_name VARCHAR(200),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  last_login TIMESTAMP
);

-- קבלני משנה
CREATE TABLE IF NOT EXISTS subcontractors (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  trade VARCHAR(100),            -- תחום (חשמל/אינסטלציה/גבס...)
  phone VARCHAR(50),
  email VARCHAR(200),
  tax_id VARCHAR(50),            -- ח.פ / ת.ז
  notes TEXT,
  deleted BOOLEAN DEFAULT false, deleted_at TIMESTAMP, deleted_by INTEGER,
  created_by INTEGER, created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER, updated_at TIMESTAMP DEFAULT NOW()
);

-- פרויקטים
CREATE TABLE IF NOT EXISTS projects (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(300) NOT NULL,
  client_name VARCHAR(200),
  client_phone VARCHAR(50),
  address VARCHAR(300),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','paused','done')),
  expected_profit DECIMAL(14,2) DEFAULT 0,  -- רווח צפוי (ידני)
  start_date DATE,
  notes TEXT,
  deleted BOOLEAN DEFAULT false, deleted_at TIMESTAMP, deleted_by INTEGER,
  created_by INTEGER, created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER, updated_at TIMESTAMP DEFAULT NOW()
);

-- שלבים בפרויקט
CREATE TABLE IF NOT EXISTS stages (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(300) NOT NULL,
  seq INTEGER DEFAULT 0,
  client_amount DECIMAL(14,2) DEFAULT 0,   -- סכום שסגרנו מול הלקוח לשלב זה
  sub_amount DECIMAL(14,2) DEFAULT 0,      -- סכום שמשלמים לקבלן המשנה לשלב זה
  subcontractor_id BIGINT REFERENCES subcontractors(id) ON DELETE SET NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done')),
  approved BOOLEAN DEFAULT false,          -- אושר שהעבודה בוצעה (לפני תשלום)
  deleted BOOLEAN DEFAULT false, deleted_at TIMESTAMP, deleted_by INTEGER,
  created_by INTEGER, created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER, updated_at TIMESTAMP DEFAULT NOW()
);

-- תנועות כספיות (העסק)
--  client_payment   = הלקוח שילם לך (נכנס, משויך לפרויקט+שלב)
--  sub_payment      = שילמת לקבלן משנה (יוצא, משויך לפרויקט+שלב+קבלן)
--  project_expense  = הוצאה כללית לפרויקט (יוצא, לא יורד מקבלן משנה, עם חשבונית)
--  business_expense = הוצאת עסק כללית (יוצא, ללא פרויקט, ספק+מהות)
CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL
    CHECK (type IN ('client_payment','sub_payment','project_expense','business_expense')),
  direction VARCHAR(3) NOT NULL CHECK (direction IN ('in','out')),
  amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  date DATE,
  project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  stage_id BIGINT REFERENCES stages(id) ON DELETE SET NULL,
  subcontractor_id BIGINT REFERENCES subcontractors(id) ON DELETE SET NULL,
  supplier VARCHAR(200),     -- ספק (בהוצאה)
  purpose VARCHAR(300),      -- מהות ההוצאה
  method VARCHAR(100),       -- אמצעי תשלום
  invoice_url VARCHAR(500),  -- קישור לחשבונית (דרייב/מקומי)
  note TEXT,
  deleted BOOLEAN DEFAULT false, deleted_at TIMESTAMP, deleted_by INTEGER,
  created_by INTEGER, created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER, updated_at TIMESTAMP DEFAULT NOW()
);

-- מודול הבית (נפרד ומחובר)
CREATE TABLE IF NOT EXISTS home_transactions (
  id BIGSERIAL PRIMARY KEY,
  date DATE,
  direction VARCHAR(3) NOT NULL DEFAULT 'out' CHECK (direction IN ('in','out')),
  amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  category VARCHAR(100),
  payee VARCHAR(200),        -- ספק/למי שולם
  source VARCHAR(20) DEFAULT 'form' CHECK (source IN ('form','bank','credit')),
  note TEXT,
  deleted BOOLEAN DEFAULT false, deleted_at TIMESTAMP, deleted_by INTEGER,
  created_by INTEGER, created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER, updated_at TIMESTAMP DEFAULT NOW()
);

-- כללי סיווג נלמדים לבית (טקסט -> קטגוריה)
CREATE TABLE IF NOT EXISTS home_rules (
  id SERIAL PRIMARY KEY,
  match_text VARCHAR(200) NOT NULL,
  category VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- הגדרות מערכת (key/value)
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- יומן פעולות
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER, username VARCHAR(100),
  action VARCHAR(50), table_name VARCHAR(50), record_id BIGINT,
  details JSONB, created_at TIMESTAMP DEFAULT NOW()
);

-- אינדקסים
CREATE INDEX IF NOT EXISTS idx_stages_project     ON stages(project_id) WHERE deleted=false;
CREATE INDEX IF NOT EXISTS idx_tx_project          ON transactions(project_id) WHERE deleted=false;
CREATE INDEX IF NOT EXISTS idx_tx_stage            ON transactions(stage_id) WHERE deleted=false;
CREATE INDEX IF NOT EXISTS idx_tx_type             ON transactions(type) WHERE deleted=false;
CREATE INDEX IF NOT EXISTS idx_tx_date             ON transactions(date) WHERE deleted=false;
CREATE INDEX IF NOT EXISTS idx_home_date           ON home_transactions(date) WHERE deleted=false;
CREATE INDEX IF NOT EXISTS idx_audit_created       ON audit_log(created_at);
