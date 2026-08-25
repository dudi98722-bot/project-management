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

-- שדה הערות שני (נוסף בנפרד מ-notes כדי לא לדרוס תוכן קיים)
ALTER TABLE patients ADD COLUMN IF NOT EXISTS notes2 TEXT;

-- ===== העדפת שיוך: מקבוצה/מטפל בודד -> רשימת מטפלים מרובה =====
-- הרשימה היא מקור האמת לשיבוץ. הקבוצות נשמרות כדי להראות מאיפה הרשימה נזרעה.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS preferred_therapist_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS preferred_group_ids     JSONB NOT NULL DEFAULT '[]'::jsonb;

-- העברה חד-פעמית מהעמודות הבודדות הישנות. אחרי שהן מתאפסות זה הופך ל-no-op.
-- מטופל שהייתה לו קבוצה בלבד מקבל את חברי הקבוצה כרשימה — אחרת ההעדפה שלו
-- הייתה נעלמת, כי השיבוץ מסתמך מעכשיו על רשימת המטפלים ולא על הקבוצה.
UPDATE patients p
   SET preferred_therapist_ids =
         CASE WHEN p.preferred_therapist_id IS NOT NULL
                   THEN to_jsonb(ARRAY[p.preferred_therapist_id])
              WHEN p.preferred_group_id IS NOT NULL
                   THEN COALESCE((SELECT jsonb_agg(gm.therapist_id)
                                    FROM group_members gm
                                   WHERE gm.group_id = p.preferred_group_id), '[]'::jsonb)
              ELSE p.preferred_therapist_ids END,
       preferred_group_ids =
         CASE WHEN p.preferred_group_id IS NOT NULL
                   THEN to_jsonb(ARRAY[p.preferred_group_id])
              ELSE p.preferred_group_ids END,
       preferred_therapist_id = NULL,
       preferred_group_id     = NULL
 WHERE p.preferred_therapist_id IS NOT NULL OR p.preferred_group_id IS NOT NULL;

-- ===== סוגי שיבוץ =====
--  series  = סדרה רגילה עם כמות טיפולים
--  ongoing = שיבוץ קבוע (מטופלים קיימים) — בלי כמות, מתחדש שבוע אחר שבוע
--  single  = פגישה בודדת
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'series';
ALTER TABLE assignments ALTER COLUMN total_sessions DROP NOT NULL;

-- ===== ימי חופש וחג (כלל-מערכתיים) — יצירת סדרות מדלגת עליהם =====
CREATE TABLE IF NOT EXISTS holidays (
  id BIGSERIAL PRIMARY KEY,
  date DATE UNIQUE NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_therapist_date ON sessions (therapist_id, date, hour);

-- ===== קבצים מצורפים למטופל =====
-- הקובץ עצמו יושב בדיסק (UPLOAD_DIR); כאן רק המטא-דאטה.
CREATE TABLE IF NOT EXISTS patient_files (
  id BIGSERIAL PRIMARY KEY,
  patient_id BIGINT NOT NULL REFERENCES patients(id),
  filename TEXT NOT NULL,        -- השם המקורי, לתצוגה ולהורדה
  stored_name TEXT NOT NULL,     -- השם על הדיסק (נוצר אקראית)
  mime TEXT,
  size_bytes BIGINT,
  notes TEXT,
  uploaded_by BIGINT,
  uploaded_by_name TEXT,
  deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  deleted_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_patient_files_patient ON patient_files (patient_id) WHERE deleted = false;
-- גיבוי ל-Google Drive (ריק = טרם גובה)
ALTER TABLE patient_files ADD COLUMN IF NOT EXISTS drive_url TEXT;
ALTER TABLE patient_files ADD COLUMN IF NOT EXISTS drive_id TEXT;
ALTER TABLE patient_files ADD COLUMN IF NOT EXISTS drive_error TEXT;

-- ===== מניעת שיבוץ כפול ברמת המסד =====
-- שתי בקשות מקבילות לאותה משבצת עוברות שתיהן את בדיקת ה-SELECT (READ COMMITTED),
-- ולכן חייבים אילוץ ייחודיות. ניקוי חד-פעמי של כפילויות קודם (נשארת הפגישה הוותיקה):
UPDATE sessions s SET status='cancelled', updated_at=NOW()
 WHERE s.status='scheduled' AND s.deleted=false
   AND EXISTS (SELECT 1 FROM sessions s2
                WHERE s2.therapist_id=s.therapist_id AND s2.date=s.date AND s2.hour=s.hour
                  AND s2.status='scheduled' AND s2.deleted=false AND s2.id < s.id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_slot
  ON sessions (therapist_id, date, hour) WHERE status='scheduled' AND deleted=false;
CREATE INDEX IF NOT EXISTS idx_sessions_assignment ON sessions (assignment_id);
CREATE INDEX IF NOT EXISTS idx_patients_status ON patients (status) WHERE deleted = false;
CREATE INDEX IF NOT EXISTS idx_assignments_therapist ON assignments (therapist_id) WHERE deleted = false;

-- ===== מי הזין כל רשומה =====
ALTER TABLE patients   ADD COLUMN IF NOT EXISTS created_by BIGINT;
ALTER TABLE patients   ADD COLUMN IF NOT EXISTS created_by_name TEXT;
ALTER TABLE patients   ADD COLUMN IF NOT EXISTS updated_by BIGINT;
ALTER TABLE patients   ADD COLUMN IF NOT EXISTS updated_by_name TEXT;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS created_by_name TEXT;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS created_by BIGINT;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS created_by_name TEXT;

-- ===== רשימת השהיה: מטופלים שממתינים למטפל מסוים =====
-- מטופל יכול להיות בהשהיה אצל כמה מטפלים במקביל (עד שאחד מהם מתפנה).
CREATE TABLE IF NOT EXISTS holds (
  id BIGSERIAL PRIMARY KEY,
  therapist_id BIGINT NOT NULL REFERENCES therapists(id),
  patient_id BIGINT NOT NULL REFERENCES patients(id),
  note TEXT,
  created_by BIGINT,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released BOOLEAN NOT NULL DEFAULT false,
  released_at TIMESTAMPTZ,
  released_by_name TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_holds_active
  ON holds (therapist_id, patient_id) WHERE released = false;
CREATE INDEX IF NOT EXISTS idx_holds_patient ON holds (patient_id) WHERE released = false;

-- ===== חלקי יום: כל שעה משויכת לבוקר / צהריים / אחה"צ / ערב =====
CREATE TABLE IF NOT EXISTS hour_parts (
  hour INT PRIMARY KEY,
  part TEXT NOT NULL
);
-- ברירת מחדל בפעם הראשונה בלבד; שינויים של המשתמש נשמרים
INSERT INTO hour_parts (hour, part)
SELECT h, CASE WHEN h <= 11 THEN 'morning'
               WHEN h <= 15 THEN 'noon'
               WHEN h <= 18 THEN 'afternoon'
               ELSE 'evening' END
  FROM generate_series(8, 21) AS h
ON CONFLICT (hour) DO NOTHING;

-- ===== מייל למשתמש + שחזור סיסמה =====
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS password_resets (
  token TEXT PRIMARY KEY,          -- נשמר כ-hash, לא כטוקן עצמו
  user_id BIGINT NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets (user_id) WHERE used_at IS NULL;

-- איפוס סיסמה מבטל טוקנים שהונפקו לפניו
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
