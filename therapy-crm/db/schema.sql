-- ===== therapy-crm — סכימת מסד נתונים =====
-- אידמפוטנטית: מורצת בכל עליית שרת (ensureSchema) — בטוח להריץ שוב ושוב.

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  full_name TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT,
  username TEXT,
  action TEXT,
  table_name TEXT,
  record_id TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- רשימות ניתנות לעריכה (השתייכות קהילתית וכו')
CREATE TABLE IF NOT EXISTS list_items (
  id BIGSERIAL PRIMARY KEY,
  list_name TEXT NOT NULL,
  value TEXT NOT NULL,
  sort INT DEFAULT 0,
  UNIQUE (list_name, value)
);

CREATE TABLE IF NOT EXISTS therapists (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  -- לו"ז עבודה שבועי: {"0":[8,9,10], "1":[14,15], ...} — מפתח = יום בשבוע (0=ראשון), ערך = שעות עגולות 8..21
  work_schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  deleted_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS therapist_groups (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  notes TEXT,
  deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  deleted_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id BIGINT NOT NULL REFERENCES therapist_groups(id) ON DELETE CASCADE,
  therapist_id BIGINT NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, therapist_id)
);

CREATE TABLE IF NOT EXISTS patients (
  id BIGSERIAL PRIMARY KEY,
  last_name TEXT NOT NULL,
  first_name TEXT NOT NULL,
  national_id TEXT,
  intake_date DATE,
  birth_date DATE,
  hmo TEXT,               -- קופת חולים
  client_type TEXT,       -- בן / בת / הורים / מבוגר / מבוגרת
  community TEXT,         -- השתייכות קהילתית (מרשימה ניתנת להרחבה)
  diagnosis TEXT,
  notes TEXT,
  urgency INT NOT NULL DEFAULT 2,   -- 1..3
  -- שעות מתאימות לטיפול: מערך שעות עגולות 8..21 (8:00 עד 22:00). ברירת מחדל: כולן.
  hours JSONB NOT NULL DEFAULT '[8,9,10,11,12,13,14,15,16,17,18,19,20,21]'::jsonb,
  preferred_therapist_id BIGINT REFERENCES therapists(id),
  preferred_group_id BIGINT REFERENCES therapist_groups(id),
  status TEXT NOT NULL DEFAULT 'waiting',   -- waiting / assigned / done
  deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  deleted_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- סדרת טיפולים: N פגישות שבועיות באותו יום ושעה
CREATE TABLE IF NOT EXISTS assignments (
  id BIGSERIAL PRIMARY KEY,
  patient_id BIGINT NOT NULL REFERENCES patients(id),
  therapist_id BIGINT NOT NULL REFERENCES therapists(id),
  total_sessions INT NOT NULL,
  start_date DATE NOT NULL,
  hour INT NOT NULL,
  weekday INT NOT NULL,             -- 0=ראשון .. 6=שבת (נגזר מתאריך ההתחלה)
  status TEXT NOT NULL DEFAULT 'active',   -- active / completed / cancelled
  notes TEXT,
  deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  deleted_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- פגישה בודדת בסדרה
CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY,
  assignment_id BIGINT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL,
  therapist_id BIGINT NOT NULL,
  session_num INT NOT NULL,
  date DATE NOT NULL,
  hour INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',   -- scheduled / done / cancelled / no_show
  notes TEXT,
  deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  deleted_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_therapist_date ON sessions (therapist_id, date, hour);
CREATE INDEX IF NOT EXISTS idx_sessions_assignment ON sessions (assignment_id);
CREATE INDEX IF NOT EXISTS idx_patients_status ON patients (status) WHERE deleted = false;
CREATE INDEX IF NOT EXISTS idx_assignments_therapist ON assignments (therapist_id) WHERE deleted = false;
