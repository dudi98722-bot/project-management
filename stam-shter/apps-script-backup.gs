/**
 * ============================================================
 *  שטרנקוקר — גיבוי אוטומטי לגיליון גוגל
 *  ------------------------------------------------------------
 *  התקנה:
 *   1. בגיליון:  תוספים ← Apps Script
 *   2. מחק את מה שיש שם, הדבק את כל הקובץ הזה, ושמור
 *   3. הגדרות הפרויקט (⚙) ← מאפייני סקריפט ← הוספת מאפיין:
 *          שם:  BACKUP_SECRET
 *          ערך: הסוד שקיבלת (אותו ערך בדיוק כמו בשרת)
 *   4. הרץ פעם אחת את הפונקציה  setupTabs  (לאישור הרשאות ויצירת הלשוניות)
 *   5. פריסה ← פריסה חדשה ← סוג: אפליקציית אינטרנט
 *        "הפעל בתור":            אני
 *        "למי יש גישה":          כל אחד
 *   6. העתק את כתובת ה-/exec ותן אותה לשרת
 *
 *  הסוד לא נשמר בקובץ הזה בכוונה, כדי שהקובץ יהיה בטוח לשמירה בריפו ציבורי.
 * ============================================================
 */

function getSecret() {
  return PropertiesService.getScriptProperties().getProperty('BACKUP_SECRET') || '';
}

const ACTIONS = { title: 'פעולות', cols: ['זמן', 'משתמש', 'פעולה', 'טבלה', 'מזהה', 'פרטים'] };

// לכל טבלה במערכת — לשונית משלה והעמודות שישוקפו אליה.
// זהו מקור האמת היחיד לעמודות; השרת שולח את הרשומה המלאה והסקריפט בוחר מה לכתוב.
const TABS = {
  contacts:               { title: 'אנשי קשר',             cols: ['id', 'name', 'phone', 'deleted', 'updated_at'] },
  products:               { title: 'מוצרים',               cols: ['id', 'name', 'parchment_units', 'pages', 'fixed_expense', 'deleted', 'updated_at'] },
  parchment_sizes:        { title: 'גדלי קלף',             cols: ['id', 'name', 'cost_per_unit', 'deleted', 'updated_at'] },
  list_items:             { title: 'רשימות',               cols: ['id', 'list_name', 'value', 'sort', 'is_correction', 'deleted'] },
  scrolls:                { title: 'ספרי תורה',            cols: ['id', 'scribe_id', 'parchment_size_id', 'product_id', 'page_rate', 'sale_date', 'customer_id', 'buyer_total', 'buyer_currency', 'status', 'note', 'deleted', 'updated_at'] },
  pages_log:              { title: 'עמודים שנכתבו',        cols: ['id', 'scroll_id', 'date', 'pages', 'note', 'deleted', 'updated_at'] },
  scribe_payments:        { title: 'תשלומים לסופר',        cols: ['id', 'scroll_id', 'date', 'amount', 'note', 'deleted', 'updated_at'] },
  customer_payments:      { title: 'תשלומי לקוחות',        cols: ['id', 'scroll_id', 'customer_id', 'date', 'amount_ils', 'amount_usd', 'rate', 'cash_in_hand', 'note', 'deleted', 'updated_at'] },
  book_expenses:          { title: 'הוצאות לספר',          cols: ['id', 'scroll_id', 'type', 'date', 'amount', 'note', 'deleted', 'updated_at'] },
  parchment_expenses:     { title: 'הוצאות קלף',           cols: ['id', 'scroll_id', 'parchment_size_id', 'date', 'quantity', 'note', 'deleted', 'updated_at'] },
  business_expenses:      { title: 'הוצאות עסק',           cols: ['id', 'date', 'type', 'amount', 'note', 'deleted', 'updated_at'] },
  prod_purchases:         { title: 'רכישות מוצרים',        cols: ['id', 'date', 'scribe_id', 'product_id', 'quantity', 'cost_per_unit', 'extra_cost_per_unit', 'purchase_type', 'note', 'deleted', 'updated_at'] },
  prod_scribe_payments:   { title: 'תשלומי סופר מוצרים',   cols: ['id', 'date', 'scribe_id', 'amount', 'note', 'deleted', 'updated_at'] },
  prod_sales:             { title: 'מכירות מוצרים',        cols: ['id', 'date', 'customer_id', 'purchase_id', 'quantity', 'price_per_unit', 'sale_type', 'deduct_3pct', 'note', 'deleted', 'updated_at'] },
  prod_customer_payments: { title: 'תשלומי לקוחות מוצרים', cols: ['id', 'date', 'customer_id', 'amount_ils', 'amount_usd', 'rate', 'cash_in_hand', 'note', 'deleted', 'updated_at'] },
};

// ============ נקודות הכניסה ============

function doPost(e) {
  try {
    var secret = getSecret();
    if (!secret) return out({ ok: false, error: 'BACKUP_SECRET לא הוגדר במאפייני הסקריפט' });
    if (!e || !e.postData || !e.postData.contents) return out({ ok: false, error: 'no body' });

    var body = JSON.parse(e.postData.contents);
    if (!body || body.secret !== secret) return out({ ok: false, error: 'unauthorized' });

    var items = (body.items && body.items.length) ? body.items : [];
    if (!items.length) return out({ ok: true, written: 0 });

    // נעילה — כדי ששתי בקשות במקביל לא ידרסו זו את שורות זו
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return out({ ok: false, error: 'busy' });
    try {
      writeBatch(items);
    } finally {
      lock.releaseLock();
    }
    return out({ ok: true, written: items.length });
  } catch (err) {
    return out({ ok: false, error: String((err && err.message) || err) });
  }
}

// בדיקת חיים מהדפדפן
function doGet() {
  return out({ ok: true, service: 'stam-shter backup', configured: !!getSecret(), tabs: Object.keys(TABS).length });
}

// הרץ ידנית פעם אחת — מאשר הרשאות ויוצר את כל הלשוניות מראש
function setupTabs() {
  var ss = SpreadsheetApp.getActive();
  ensureTab(ss, ACTIONS);
  for (var k in TABS) ensureTab(ss, TABS[k]);
  var msg = getSecret() ? 'הלשוניות נוצרו בהצלחה' : 'הלשוניות נוצרו — אך חסר המאפיין BACKUP_SECRET';
  ss.toast(msg, 'שטרנקוקר', 6);
}

// ============ הלוגיקה ============

function writeBatch(items) {
  var ss = SpreadsheetApp.getActive();
  var cache = {};
  var actionRows = [];

  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    // silent — שורות בן שנמחקו בעקבות מחיקת האב. משקפים אותן, אבל בלי
    // להציף את יומן הפעולות בעשרות שורות על מחיקה אחת.
    if (!it.silent) {
      actionRows.push([
        it.time || new Date().toISOString(),
        it.user || '',
        it.action || '',
        it.table || '',
        String(it.id == null ? '' : it.id),
        typeof it.details === 'string' ? it.details : JSON.stringify(it.details || {}),
      ]);
    }
    if (it.record && TABS[it.table]) mirrorRow(ss, cache, it.table, it.record);
  }

  if (actionRows.length) {
    var sh = ensureTab(ss, ACTIONS);
    var start = sh.getLastRow() + 1;
    ensureRows(sh, start + actionRows.length - 1);
    sh.getRange(start, 1, actionRows.length, ACTIONS.cols.length)
      .setValues(actionRows.map(function (r) { return r.map(safe); }));
  }
}

// עדכון-או-הוספה של שורה לפי מזהה.
// מפת המזהים נבנית פעם אחת לכל לשונית בכל בקשה, כדי לא לקרוא את העמודה שוב ושוב.
function mirrorRow(ss, cache, table, rec) {
  var def = TABS[table];
  if (rec.id === null || rec.id === undefined || rec.id === '') return;

  var c = cache[table];
  if (!c) {
    var sh = ensureTab(ss, def);
    var last = sh.getLastRow();
    var map = {};
    if (last > 1) {
      var ids = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
      for (var i = 0; i < ids.length; i++) {
        var v = String(ids[i][0]).trim();
        if (v !== '') map[v] = i + 2;
      }
    }
    c = cache[table] = { sheet: sh, map: map, nextRow: Math.max(2, last + 1) };
  }

  var row = def.cols.map(function (k) { return safe(rec[k]); });
  var key = String(rec.id).trim();
  var at = c.map[key];
  if (!at) {
    at = c.nextRow;
    c.map[key] = at;   // אם אותו מזהה חוזר באותה אצווה — יעודכן ולא יתווסף פעמיים
    c.nextRow++;
  }
  ensureRows(c.sheet, at);
  c.sheet.getRange(at, 1, 1, row.length).setValues([row]);
}

function ensureTab(ss, def) {
  var sh = ss.getSheetByName(def.title);
  if (!sh) {
    sh = ss.insertSheet(def.title);
    sh.getRange(1, 1, 1, def.cols.length).setValues([def.cols]);
    sh.getRange(1, 1, 1, def.cols.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// גיליון חדש מגיע עם 1000 שורות בלבד, ו-getRange מעבר לגבול זורק חריגה.
// בלי ההרחבה הזו הגיבוי היה מת לצמיתות אחרי כ-1000 פעולות.
function ensureRows(sh, needRow) {
  var max = sh.getMaxRows();
  if (needRow > max) sh.insertRowsAfter(max, needRow - max + 500);
}

// המרה לערך בטוח לכתיבה:
//  - טקסט שמתחיל ב- = + - @ | או תו בקרה מקבל גרש מוביל, אחרת גיליונות
//    יפרש הערה שהוזנה במערכת כנוסחה (כולל IMPORTDATA שמדליף נתונים החוצה)
//  - מחרוזת עם אפס מוביל (טלפון) מקבלת גרש, אחרת האפס נבלע
function safe(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string' && v !== '' && (/^[=+\-@|\t\r\n]/.test(v) || /^0\d/.test(v))) return "'" + v;
  return v;
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
