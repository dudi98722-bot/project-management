-- ===== שטרנקוקר (stam-shter) — סכימת מסד נתונים (PostgreSQL) =====
-- ניהול רכישת ומכירת מוצרי סת"ם.
-- מחיקה רכה בלבד: כל טבלת נתונים כוללת deleted / deleted_at / deleted_by.
-- הקובץ idempotent ומוחל בכל עליית שרת (ensureSchema), כך שעמודות חדשות נוצרות אחרי עדכון.

-- ---------- משתמשים ----------
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'viewer',
  full_name VARCHAR(200),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  last_login TIMESTAMP
);

-- אילוץ התפקידים מוגדר בנפרד כדי שאפשר יהיה להוסיף תפקידים בעדכון
-- בלי לשבור מסדים קיימים (CREATE TABLE IF NOT EXISTS לא מעדכן אילוצים).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin','manager','clerk','scribeops','viewer'));

-- ==================================================================
--  נתוני יסוד (הגדרות)
-- ==================================================================

-- אנשי קשר — רשימה אחת מאוחדת. מכאן נבחרים גם הסופרים וגם הרוכשים;
-- התפקיד נקבע בעסקה עצמה ולא באיש הקשר.
CREATE TABLE IF NOT EXISTS contacts (
  id BIGSERIAL PRIMARY KEY,
  name       VARCHAR(300),   -- שם מלא, שדה אחד
  phone      VARCHAR(50),
  deleted BOOLEAN DEFAULT false, deleted_at TIMESTAMP, deleted_by INTEGER,
  created_by INTEGER, created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER, updated_at TIMESTAMP DEFAULT NOW()
);
-- מיגרציה: פיצול שם/משפחה אוחד לשדה name יחיד.
-- העמודות הישנות נשארות (מסדים קיימים), אך אינן בשימוש.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS name VARCHAR(300);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='contacts' AND column_name='first_name') THEN
    UPDATE contacts
       SET name = NULLIF(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')), '')
     WHERE name IS NULL OR name = '';
    ALTER TABLE contacts ALTER COLUMN first_name DROP NOT NULL;
    ALTER TABLE contacts ALTER COLUMN last_name  DROP NOT NULL;
  END IF;
END $$;

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

-- תשלום המשויך לספר — הרוכש הוא בעליו של אותו ספר. שורות שיובאו בלי
-- עמודת רוכש נשארו בלי שיוך, והוא נגזר כאן מהספר. idempotent.
UPDATE customer_payments cp SET customer_id = s.customer_id
  FROM scrolls s WHERE s.id = cp.scroll_id
    AND cp.customer_id IS NULL AND s.customer_id IS NOT NULL;

-- ניקוי נתונים: המרת NULL ל-0 בעמודות כספיות/כמותיות.
-- NULL בעמודה אחת מרעיל ביטויים כמו amount_ils + amount_usd*rate (התוצאה NULL,
-- ו-SUM מדלג עליה) — התשלום היה נעלם מהיתרות. idempotent וזול אחרי הריצה הראשונה.
UPDATE customer_payments SET amount_ils=COALESCE(amount_ils,0), amount_usd=COALESCE(amount_usd,0),
  rate=COALESCE(rate,0), cash_in_hand=COALESCE(cash_in_hand,0)
  WHERE amount_ils IS NULL OR amount_usd IS NULL OR rate IS NULL OR cash_in_hand IS NULL;
UPDATE prod_customer_payments SET amount_ils=COALESCE(amount_ils,0), amount_usd=COALESCE(amount_usd,0),
  rate=COALESCE(rate,0), cash_in_hand=COALESCE(cash_in_hand,0)
  WHERE amount_ils IS NULL OR amount_usd IS NULL OR rate IS NULL OR cash_in_hand IS NULL;
UPDATE scribe_payments SET amount=0 WHERE amount IS NULL;
UPDATE prod_scribe_payments SET amount=0 WHERE amount IS NULL;
UPDATE book_expenses SET amount=0 WHERE amount IS NULL;
UPDATE business_expenses SET amount=0 WHERE amount IS NULL;
UPDATE pages_log SET pages=0 WHERE pages IS NULL;
UPDATE parchment_expenses SET quantity=0 WHERE quantity IS NULL;
UPDATE scrolls SET page_rate=COALESCE(page_rate,0), buyer_total=COALESCE(buyer_total,0)
  WHERE page_rate IS NULL OR buyer_total IS NULL;
UPDATE prod_purchases SET quantity=COALESCE(quantity,0), cost_per_unit=COALESCE(cost_per_unit,0),
  extra_cost_per_unit=COALESCE(extra_cost_per_unit,0)
  WHERE quantity IS NULL OR cost_per_unit IS NULL OR extra_cost_per_unit IS NULL;
UPDATE prod_sales SET quantity=COALESCE(quantity,0), price_per_unit=COALESCE(price_per_unit,0)
  WHERE quantity IS NULL OR price_per_unit IS NULL;

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER, username VARCHAR(100),
  action VARCHAR(50), table_name VARCHAR(50), record_id BIGINT,
  details JSONB, created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- ==================================================================
--  מעקב יריעות ופריטים — איפה כל יריעה נמצאת ואצל מי
-- ==================================================================

-- תחנות במסלול הייצור (משרד / מוחק / מגיה / תופר ...)
CREATE TABLE IF NOT EXISTS stations (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  sort INTEGER DEFAULT 0,
  color VARCHAR(20),
  deleted BOOLEAN DEFAULT false, deleted_at TIMESTAMP, deleted_by INTEGER,
  created_by INTEGER, created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER, updated_at TIMESTAMP DEFAULT NOW()
);

-- פריט מעקב: יריעה בודדת של ספר, או יחידה בודדת של מוצר.
-- אותו מודל לשניהם, כדי שההעברות והדוחות יהיו זהים —
-- ספר תורה מתפצל ל-62 יריעות, ומזוזה היא פריט אחד.
CREATE TABLE IF NOT EXISTS track_items (
  id BIGSERIAL PRIMARY KEY,
  scroll_id   BIGINT REFERENCES scrolls(id) ON DELETE SET NULL,
  purchase_id BIGINT REFERENCES prod_purchases(id) ON DELETE SET NULL,
  seq INTEGER DEFAULT 1,                 -- מספר היריעה / היחידה
  label VARCHAR(200),                    -- כינוי חופשי (למשל "בראשית" בנביאים)
  station_id BIGINT REFERENCES stations(id) ON DELETE SET NULL,
  holder_id  BIGINT REFERENCES contacts(id) ON DELETE SET NULL,  -- אצל מי הפריט
  since DATE,                            -- מאיזה תאריך הוא בתחנה הנוכחית
  note TEXT,
  deleted BOOLEAN DEFAULT false, deleted_at TIMESTAMP, deleted_by INTEGER,
  created_by INTEGER, created_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER, updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_track_scroll   ON track_items(scroll_id)   WHERE deleted=false;
CREATE INDEX IF NOT EXISTS idx_track_purchase ON track_items(purchase_id) WHERE deleted=false;
CREATE INDEX IF NOT EXISTS idx_track_station  ON track_items(station_id)  WHERE deleted=false;
CREATE INDEX IF NOT EXISTS idx_track_holder   ON track_items(holder_id)   WHERE deleted=false;

-- יומן תנועות — כל העברה נשמרת, כך שאפשר לראות היסטוריה מלאה לכל יריעה
CREATE TABLE IF NOT EXISTS track_moves (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT REFERENCES track_items(id) ON DELETE CASCADE,
  date DATE,
  from_station_id BIGINT, from_holder_id BIGINT,
  to_station_id   BIGINT, to_holder_id   BIGINT,
  note TEXT,
  created_by INTEGER, created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_moves_item ON track_moves(item_id);

-- מספר יריעות לספר: ברירת המחדל מגיעה מהמוצר, אך בנביאים וכתובים
-- הכמות משתנה מספר לספר ולכן אפשר לקבוע אותה ידנית לכל ספר.
ALTER TABLE scrolls ADD COLUMN IF NOT EXISTS sheets_count INTEGER;
-- מכמה יריעות מורכב המוצר. ברירת המחדל לכל ספר מסוג זה; ספר בודד
-- (למשל נביא מסוים) יכול לעקוף בעזרת scrolls.sheets_count.
ALTER TABLE products ADD COLUMN IF NOT EXISTS sheets_count INTEGER;

-- מק"ט ידני לספר — המזהה שהמשתמש מכיר, בנוסף למספר הפנימי (#).
ALTER TABLE scrolls ADD COLUMN IF NOT EXISTS sku VARCHAR(100);
-- אסור ששני ספרים יחלקו את *כל* השלושה יחד: סופר + מוצר + מק"ט.
-- חפיפה חלקית מותרת. האילוץ חל רק כשיש מק"ט — בלעדיו אין מה להבחין,
-- ומספר הספר הפנימי משמש כמזהה.
CREATE UNIQUE INDEX IF NOT EXISTS uq_scroll_scribe_product_sku
  ON scrolls (scribe_id, product_id, sku)
  WHERE deleted = false AND sku IS NOT NULL;
