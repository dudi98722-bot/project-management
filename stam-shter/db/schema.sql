-- ===== שטרנקוקר (stam-shter) — סכימת מסד נתונים (PostgreSQL) =====
-- ניהול רכישת ומכירת מוצרי סת"ם.
-- מחיקה רכה בלבד: כל טבלת נתונים כוללת deleted / deleted_at / deleted_by.
-- הקובץ idempotent ומוחל בכל עליית שרת (ensureSchema), כך שעמודות חדשות נוצרות אחרי עדכון.

-- ---------- משתמשים ----------
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('admin','manager','clerk','viewer')),
  full_name VARCHAR(200),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  last_login TIMESTAMP
);

-- ==================================================================
--  נתוני יסוד (הגדרות)
-- ==================================================================

-- אנשי קשר — רשימה אחת מאוחדת. מכאן נבחרים גם הסופרים וגם הרוכשים;
-- התפקיד נקבע בעסקה עצמה ולא באיש הקשר.
CREATE TABLE IF NOT EXISTS contacts (
  id BIGSERIAL PRIMARY KEY,
  first_name VARCHAR(120),
  last_name  VARCHAR(120),
  phone      VARCHAR(50),
  deleted BOOLEAN DEFAULT false, deleted_at TIMESTAMP, deleted_by INTEGER,
  created_by INTEGER, created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER, updated_at TIMESTAMP DEFAULT NOW()
);

-- רשימות ערכים: סוגי הוצאות לספר / סוגי הוצאות עסק
--   list_name IN ('expense_book','expense_business')
-- is_correction: מסמן סוג הוצאה שנחשב "תיקונים" — סכומו נזקף לצד הסופר
-- (מקוזז מהיתרה שלו) ואינו נספר ב"הוצאות לספר".
-- דגל ולא השוואת שם, כדי שאפשר יהיה לשנות את שם הסוג בלי לשבור את החישוב.
CREATE TABLE IF NOT EXISTS list_items (
  id BIGSERIAL PRIMARY KEY,
  list_name VARCHAR(40) NOT NULL,
  value VARCHAR(200) NOT NULL,
  sort INTEGER DEFAULT 0,
  is_correction BOOLEAN DEFAULT false,
  deleted BOOLEAN DEFAULT false, deleted_at TIMESTAMP, deleted_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_list_items ON list_items(list_name) WHERE deleted=false;

-- קטלוג מוצרים
CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(300) NOT NULL,
  parchment_units DECIMAL(10,2) DEFAULT 0,  -- יחידות קלף (יריעות) למוצר -> צפי קלף
  pages INTEGER DEFAULT 0,                  -- מספר עמודים -> בסיס לכל חישובי מחיר-לעמוד
  fixed_expense DECIMAL(12,2) DEFAULT 0,    -- הוצאה קבועה לספר מסוג זה
  deleted BOOLEAN DEFAULT false, deleted_at TIMESTAMP, deleted_by INTEGER,
  created_by INTEGER, created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER, updated_at TIMESTAMP DEFAULT NOW()
);

-- גדלי / סוגי קלפים
CREATE TABLE IF NOT EXISTS parchment_sizes (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  cost_per_unit DECIMAL(12,2) DEFAULT 0,
  deleted BOOLEAN DEFAULT false, deleted_at TIMESTAMP, deleted_by INTEGER,
  created_by INTEGER, created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER, updated_at TIMESTAMP DEFAULT NOW()
);

-- ==================================================================
--  מערכת א' — ס"ת
-- ==================================================================
-- לכל ספר שני צדדים: צד סופר (מה שמשלמים) וצד רוכש (מה שגובים).
-- כל השדות המחושבים מחושבים ב-routes/scrolls.js מהיומנים ומהנוסחאות שבאפיון.
CREATE TABLE IF NOT EXISTS scrolls (
  id BIGSERIAL PRIMARY KEY,
  scribe_id         BIGINT REFERENCES contacts(id) ON DELETE SET NULL,        -- הסופר שכותב
  parchment_size_id BIGINT REFERENCES parchment_sizes(id) ON DELETE SET NULL, -- גודל קלף
  product_id        BIGINT REFERENCES products(id) ON DELETE SET NULL,        -- מוצר (ממנו: עמודים, יחי' קלף, הוצ' קבועה)
  page_rate      DECIMAL(12,4) DEFAULT 0,   -- מחיר לעמוד לסופר
  sale_date      DATE,                       -- תאריך מכירה
  customer_id    BIGINT REFERENCES contacts(id) ON DELETE SET NULL,           -- הרוכש
  buyer_total    DECIMAL(14,2) DEFAULT 0,    -- מחיר לרוכש — הסכום הכולל לכל הספר
  buyer_currency VARCHAR(8) DEFAULT 'ILS',   -- ILS / USD
  note TEXT,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','done')),
  deleted BOOLEAN DEFAULT false, deleted_at TIMESTAMP, deleted_by INTEGER,
  created_by INTEGER, created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER, updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scrolls_scribe   ON scrolls(scribe_id)   WHERE deleted=false;
CREATE INDEX IF NOT EXISTS idx_scrolls_customer ON scrolls(customer_id) WHERE deleted=false;

-- יומן עמודים שנכתבו — כל רישום מוסיף עמודים; הסכום המצטבר לכל ספר
-- מזין את ההתקדמות של *שני* הצדדים (סופר ורוכש).
CREATE TABLE IF NOT EXISTS pages_log (
  id BIGSERIAL PRIMARY KEY,
  scroll_id BIGINT REFERENCES scrolls(id) ON DELETE SET NULL,
  date DATE,
  pages INTEGER DEFAULT 0,
  note TEXT,
  deleted BOOLEAN DEFAULT false, deleted_at TIMESTAMP, deleted_by INTEGER,
  created_by INTEGER, created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER, updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pageslog_scroll ON pages_log(scroll_id) WHERE deleted=false;

-- תשלומים לסופר (מערכת ס"ת)
CREATE TABLE IF NOT EXISTS scribe_payments (
  id BIGSERIAL PRIMARY KEY,
  scroll_id BIGINT REFERENCES scrolls(id) ON DELETE SET NULL,
  date DATE,
  amount DECIMAL(14,2) DEFAULT 0,
  note TEXT,
  deleted BOOLEAN DEFAULT false, deleted_at TIMESTAMP, deleted_by INTEGER,
  created_by INTEGER, created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER, updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scribepay_scroll ON scribe_payments(scroll_id) WHERE deleted=false;

-- תשלומי לקוחות (מערכת ס"ת)
-- מחושב: עלות פריטה = amount_usd*rate - cash_in_hand ; שולם בפועל = amount_ils + amount_usd*rate
CREATE TABLE IF NOT EXISTS customer_payments (
  id BIGSERIAL PRIMARY KEY,
  scroll_id   BIGINT REFERENCES scrolls(id) ON DELETE SET NULL,
  customer_id BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
  date DATE,
  amount_ils   DECIMAL(14,2) DEFAULT 0,   -- סכום ששולם בש"ח
  amount_usd   DECIMAL(14,2) DEFAULT 0,   -- סכום ששולם בדולר
  rate         DECIMAL(10,4) DEFAULT 0,   -- שער יציג (מוזן ידנית)
  cash_in_hand DECIMAL(14,2) DEFAULT 0,   -- מזומן בש"ח שהתקבל בפועל (לתשלום בדולר)
  note TEXT,
  deleted BOOLEAN DEFAULT false, deleted_at TIMESTAMP, deleted_by INTEGER,
  created_by INTEGER, created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER, updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_custpay_scroll   ON customer_payments(scroll_id)   WHERE deleted=false;
CREATE INDEX IF NOT EXISTS idx_custpay_customer ON customer_payments(customer_id) WHERE deleted=false;

-- הוצאות לספר — הסוג קובע ניתוב: "תיקונים" (is_correction) -> צד סופר, השאר -> הוצאות לספר
CREATE TABLE IF NOT EXISTS book_expenses (
  id BIGSERIAL PRIMARY KEY,
  scroll_id BIGINT REFERENCES scrolls(id) ON DELETE SET NULL,
  type VARCHAR(200),
  date DATE,
  amount DECIMAL(14,2) DEFAULT 0,
  note TEXT,
  deleted BOOLEAN DEFAULT false, deleted_at TIMESTAMP, deleted_by INTEGER,
  created_by INTEGER, created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER, updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bookexp_scroll ON book_expenses(scroll_id) WHERE deleted=false;

-- הוצאות קלף — לשונית ייעודית. סך עלות = כמות * עלות ליחידה של הגודל שנבחר.
-- מזין את "עלות קלף בפועל" (להבדיל מ"צפי קלף" שנגזר מהמוצר).
CREATE TABLE IF NOT EXISTS parchment_expenses (
  id BIGSERIAL PRIMARY KEY,
  scroll_id         BIGINT REFERENCES scrolls(id) ON DELETE SET NULL,
  parchment_size_id BIGINT REFERENCES parchment_sizes(id) ON DELETE SET NULL,
  date DATE,
  quantity DECIMAL(10,2) DEFAULT 0,
  note TEXT,
  deleted BOOLEAN DEFAULT false, deleted_at TIMESTAMP, deleted_by INTEGER,
  created_by INTEGER, created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER, updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_parchexp_scroll ON parchment_expenses(scroll_id) WHERE deleted=false;

-- הוצאות עסק כלליות (לא משויכות לספר)
CREATE TABLE IF NOT EXISTS business_expenses (
  id BIGSERIAL PRIMARY KEY,
  date DATE,
  type VARCHAR(200),
  amount DECIMAL(14,2) DEFAULT 0,
  note TEXT,
  deleted BOOLEAN DEFAULT false, deleted_at TIMESTAMP, deleted_by INTEGER,
  created_by INTEGER, created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER, updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bizexp_date ON business_expenses(date) WHERE deleted=false;

-- ==================================================================
--  מערכת ב' — מוצרים (רכש, מלאי, מכירות)
--  נפרדת לחלוטין בהזנה; מתחברת לראשית רק בדוחות.
-- ==================================================================

-- רכישות מסופר -> נכנס למלאי. כל רכישה היא "חבילה" שממנה מוכרים.
CREATE TABLE IF NOT EXISTS prod_purchases (
  id BIGSERIAL PRIMARY KEY,
  date DATE,
  scribe_id  BIGINT REFERENCES contacts(id) ON DELETE SET NULL,  -- הסופר (המוכר)
  product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  quantity INTEGER DEFAULT 0,
  cost_per_unit       DECIMAL(12,2) DEFAULT 0,  -- עלות ליחי' -> מזין את החוב לסופר
  extra_cost_per_unit DECIMAL(12,2) DEFAULT 0,  -- עלות נוספת ליחי' -> לרווח בלבד
  purchase_type VARCHAR(20) DEFAULT 'רגיל' CHECK (purchase_type IN ('רגיל','קומיסיון')),
  note TEXT,
  deleted BOOLEAN DEFAULT false, deleted_at TIMESTAMP, deleted_by INTEGER,
  created_by INTEGER, created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER, updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prodpur_scribe ON prod_purchases(scribe_id) WHERE deleted=false;

-- תשלומים לסופר (מערכת המוצרים) — מצטבר ברמת הסופר, לא לפי רכישה בודדת
CREATE TABLE IF NOT EXISTS prod_scribe_payments (
  id BIGSERIAL PRIMARY KEY,
  date DATE,
  scribe_id BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
  amount DECIMAL(14,2) DEFAULT 0,
  note TEXT,
  deleted BOOLEAN DEFAULT false, deleted_at TIMESTAMP, deleted_by INTEGER,
  created_by INTEGER, created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER, updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prodscribepay ON prod_scribe_payments(scribe_id) WHERE deleted=false;

-- מכירות -> יוצא מהמלאי. כל מכירה נגזרת מחבילת רכישה ספציפית.
CREATE TABLE IF NOT EXISTS prod_sales (
  id BIGSERIAL PRIMARY KEY,
  date DATE,
  customer_id BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
  purchase_id BIGINT REFERENCES prod_purchases(id) ON DELETE SET NULL,
  quantity INTEGER DEFAULT 0,
  price_per_unit DECIMAL(12,2) DEFAULT 0,
  sale_type VARCHAR(20) DEFAULT 'רגיל' CHECK (sale_type IN ('רגיל','קומיסיון')),
  deduct_3pct BOOLEAN DEFAULT false,   -- לנכות 3% מסך המכירה
  note TEXT,
  deleted BOOLEAN DEFAULT false, deleted_at TIMESTAMP, deleted_by INTEGER,
  created_by INTEGER, created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER, updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prodsale_purchase ON prod_sales(purchase_id) WHERE deleted=false;
CREATE INDEX IF NOT EXISTS idx_prodsale_customer ON prod_sales(customer_id) WHERE deleted=false;

-- תשלומי לקוחות (מערכת המוצרים)
CREATE TABLE IF NOT EXISTS prod_customer_payments (
  id BIGSERIAL PRIMARY KEY,
  date DATE,
  customer_id BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
  amount_ils   DECIMAL(14,2) DEFAULT 0,
  amount_usd   DECIMAL(14,2) DEFAULT 0,
  rate         DECIMAL(10,4) DEFAULT 0,
  cash_in_hand DECIMAL(14,2) DEFAULT 0,
  note TEXT,
  deleted BOOLEAN DEFAULT false, deleted_at TIMESTAMP, deleted_by INTEGER,
  created_by INTEGER, created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER, updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prodcustpay ON prod_customer_payments(customer_id) WHERE deleted=false;

-- ==================================================================
--  כללי
-- ==================================================================
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER, username VARCHAR(100),
  action VARCHAR(50), table_name VARCHAR(50), record_id BIGINT,
  details JSONB, created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
