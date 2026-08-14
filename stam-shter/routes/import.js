// ===== מנוע ייבוא מרוכז =====
// מאפשר להדביק שורות מגוגל שיטס / אקסל לכל טבלה. מפענח הפניות לפי שם
// (סופר/רוכש/מוצר/גודל -> id), מנרמל תאריכים, מוודא כל שורה, ומכניס בטרנזקציה.
// dryRun מחזיר תצוגה מקדימה בלי לכתוב כלום.
const express = require('express');
const { pool, logAction, softDelete, softDeleteScroll, softDeletePurchase } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const router = express.Router();

let sheets = null;
try { sheets = require('../sheets'); } catch (e) { sheets = null; }

// ---------- הגדרת העמודות לכל טבלה ----------
// type: text|num|int|bool|date   ref: contacts|products|parchment_sizes
// refId: scrolls|prod_purchases  (הפניה לפי מספר מזהה, לא לפי שם)
const SPEC = {
  contacts: {
    label: 'אנשי קשר',
    cols: [
      { key: 'name', label: 'שם', required: true },
      { key: 'phone', label: 'טלפון' },
    ],
  },
  products: {
    label: 'מוצרים',
    cols: [
      { key: 'name', label: 'שם המוצר', required: true },
      { key: 'parchment_units', label: 'יחידות קלף', type: 'num' },
      { key: 'pages', label: 'עמודים', type: 'int' },
      { key: 'fixed_expense', label: 'הוצאה קבועה', type: 'num' },
    ],
  },
  parchment_sizes: {
    label: 'גדלי קלף',
    cols: [
      { key: 'name', label: 'שם הגודל', required: true },
      { key: 'cost_per_unit', label: 'עלות ליחידה', type: 'num' },
    ],
  },
  // ערכי רשימות. list_name מוצמד אוטומטית מהלשונית שממנה פותחים.
  list_items: {
    label: 'ערכי רשימות',
    noAudit: true,
    cols: [
      { key: 'value', label: 'ערך', required: true },
      { key: 'list_name', label: 'שם הרשימה', type: 'listname' },
      { key: 'is_correction', label: 'נחשב כתיקונים (כן/לא)', type: 'bool' },
    ],
  },
  scrolls: {
    label: 'ס"ת',
    cols: [
      { key: 'scribe_id', label: 'סופר', ref: 'contacts' },
      { key: 'product_id', label: 'מוצר', ref: 'products' },
      { key: 'parchment_size_id', label: 'גודל קלף', ref: 'parchment_sizes' },
      { key: 'page_rate', label: 'מחיר לעמוד', type: 'num' },
      { key: 'sale_date', label: 'תאריך מכירה', type: 'date' },
      { key: 'customer_id', label: 'רוכש', ref: 'contacts' },
      { key: 'buyer_total', label: 'מחיר לרוכש', type: 'num' },
      { key: 'buyer_currency', label: 'מטבע (ILS/USD)', type: 'currency' },
      { key: 'status', label: 'סטטוס (active/done)', type: 'status' },
      { key: 'note', label: 'הערה' },
    ],
  },
  pages_log: {
    label: 'עמודים שנכתבו',
    cols: [
      { key: 'scroll_id', label: 'מזהה ספר (#)', refId: 'scrolls', required: true },
      { key: 'date', label: 'תאריך', type: 'date' },
      { key: 'pages', label: 'עמודים', type: 'int' },
      { key: 'note', label: 'הערה' },
    ],
  },
  scribe_payments: {
    label: 'תשלומים לסופר',
    cols: [
      { key: 'scroll_id', label: 'מזהה ספר (#)', refId: 'scrolls', required: true },
      { key: 'date', label: 'תאריך', type: 'date' },
      { key: 'amount', label: 'סכום', type: 'num' },
      { key: 'note', label: 'הערה' },
    ],
  },
  customer_payments: {
    label: 'תשלומי לקוחות',
    cols: [
      { key: 'scroll_id', label: 'מזהה ספר (#)', refId: 'scrolls', required: true },
      { key: 'customer_id', label: 'רוכש', ref: 'contacts' },
      { key: 'date', label: 'תאריך', type: 'date' },
      { key: 'amount_ils', label: 'שולם בש"ח', type: 'num' },
      { key: 'amount_usd', label: 'שולם בדולר', type: 'num' },
      { key: 'rate', label: 'שער יציג', type: 'num' },
      { key: 'cash_in_hand', label: 'מזומן ביד', type: 'num' },
      { key: 'note', label: 'הערה' },
    ],
  },
  book_expenses: {
    label: 'הוצאות לספר',
    cols: [
      { key: 'scroll_id', label: 'מזהה ספר (#)', refId: 'scrolls', required: true },
      { key: 'type', label: 'סוג הוצאה', listRef: 'expense_book' },
      { key: 'date', label: 'תאריך', type: 'date' },
      { key: 'amount', label: 'סכום', type: 'num' },
      { key: 'note', label: 'הערה' },
    ],
  },
  parchment_expenses: {
    label: 'הוצאות קלף',
    cols: [
      { key: 'scroll_id', label: 'מזהה ספר (#)', refId: 'scrolls', required: true },
      { key: 'date', label: 'תאריך', type: 'date' },
      { key: 'quantity', label: 'כמות קלף', type: 'num' },
      { key: 'parchment_size_id', label: 'גודל', ref: 'parchment_sizes' },
      { key: 'note', label: 'הערה' },
    ],
  },
  business_expenses: {
    label: 'הוצאות עסק',
    cols: [
      { key: 'date', label: 'תאריך', type: 'date' },
      { key: 'type', label: 'סוג הוצאה', listRef: 'expense_business' },
      { key: 'amount', label: 'סכום', type: 'num' },
      { key: 'note', label: 'הערה' },
    ],
  },
  prod_purchases: {
    label: 'רכישות מוצרים',
    cols: [
      { key: 'date', label: 'תאריך', type: 'date' },
      { key: 'scribe_id', label: 'סופר (מוכר)', ref: 'contacts' },
      { key: 'product_id', label: 'מוצר', ref: 'products' },
      { key: 'quantity', label: 'כמות', type: 'int' },
      { key: 'cost_per_unit', label: 'עלות ליחידה', type: 'num' },
      { key: 'extra_cost_per_unit', label: 'עלות נוספת ליחידה', type: 'num' },
      { key: 'purchase_type', label: 'סוג (רגיל/קומיסיון)', type: 'ptype' },
      { key: 'note', label: 'הערה' },
    ],
  },
  prod_scribe_payments: {
    label: 'תשלומי סופר (מוצרים)',
    cols: [
      { key: 'date', label: 'תאריך', type: 'date' },
      { key: 'scribe_id', label: 'סופר', ref: 'contacts' },
      { key: 'amount', label: 'סכום', type: 'num' },
      { key: 'note', label: 'הערה' },
    ],
  },
  prod_sales: {
    label: 'מכירות מוצרים',
    cols: [
      { key: 'date', label: 'תאריך', type: 'date' },
      { key: 'customer_id', label: 'רוכש', ref: 'contacts' },
      { key: 'purchase_id', label: 'מזהה רכישה (#)', refId: 'prod_purchases', required: true },
      { key: 'quantity', label: 'כמות', type: 'int' },
      { key: 'price_per_unit', label: 'מחיר ליחידה', type: 'num' },
      { key: 'sale_type', label: 'סוג (רגיל/קומיסיון)', type: 'ptype' },
      { key: 'deduct_3pct', label: 'לנכות 3% (כן/לא)', type: 'bool' },
      { key: 'note', label: 'הערה' },
    ],
  },
  prod_customer_payments: {
    label: 'תשלומי לקוחות (מוצרים)',
    cols: [
      { key: 'date', label: 'תאריך', type: 'date' },
      { key: 'customer_id', label: 'לקוח', ref: 'contacts' },
      { key: 'amount_ils', label: 'שולם בש"ח', type: 'num' },
      { key: 'amount_usd', label: 'שולם בדולר', type: 'num' },
      { key: 'rate', label: 'שער יציג', type: 'num' },
      { key: 'cash_in_hand', label: 'מזומן ביד', type: 'num' },
      { key: 'note', label: 'הערה' },
    ],
  },
};

const VALID_LISTS = new Set(['expense_book', 'expense_business']);

// ---------- המרות ----------
// פרסר מספרים קפדני. עקרונות:
//   תא ריק בשדה מספרי -> 0 (לא NULL! NULL מרעיל את חישובי הסכומים ב-SQL:
//     amount_ils + amount_usd*rate מחזיר NULL אם רכיב אחד NULL, והתשלום
//     נעלם מהיתרות בלי שום סימן).
//   ערך שאינו מספר נקי -> undefined (שגיאה שמוצגת למשתמש), ולא "ניקוי"
//     אגרסיבי שהופך תאריך שנחת בעמודת סכום ל-12,052,026 ש"ח.
//   "500-" ו-"(500)" (פורמט חשבונאי) -> ‎-500, לא ‎+500.
function toNum(v) {
  if (v === null || v === undefined) return 0;
  let s = String(v).trim();
  if (s === '') return 0;
  let neg = false;
  const paren = s.match(/^\((.*)\)$/);                       // (500)
  if (paren) { neg = true; s = paren[1].trim(); }
  if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1).trim(); }  // 500-
  if (/^-/.test(s)) { neg = !neg; s = s.slice(1).trim(); }
  s = s.replace(/[₪$\s]/g, '');
  s = s.replace(/,(?=\d{3}(\D|$))/g, '');                    // פסיקי אלפים בלבד
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;            // כל השאר — שגיאה
  const n = parseFloat(s);
  return neg ? -n : n;
}
// fmt: 'dmy' (ישראלי, ברירת מחדל) או 'mdy' (אמריקאי — 11/18/25 = 18 בנובמבר)
function normDate(v, fmt) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (!m) return undefined;   // פורמט לא מזוהה
  let a = +m[1], b = +m[2], y = m[3];
  if (y.length === 2) y = '20' + y;
  let d, mo;
  if (fmt === 'mdy') { mo = a; d = b; } else { d = a; mo = b; }
  // אם החלק שנבחר כחודש גדול מ-12, הפירוש ההפוך הוא היחיד האפשרי
  if (mo > 12 && d <= 12) { const t = mo; mo = d; d = t; }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// מזהה את פורמט התאריך של ההדבקה כולה לפי ערכים חד-משמעיים:
// ערך שבו החלק הראשון > 12 מוכיח dd/mm, וערך שבו השני > 12 מוכיח mm/dd.
// כך שורה אחת ברורה קובעת את כל העמודה, ואין ניחוש לפי שורה בודדת.
function detectDateFormat(rows, keys) {
  let dmy = 0, mdy = 0;
  for (const raw of rows) {
    for (const k of keys) {
      const v = raw[k];
      if (v === undefined || v === null) continue;
      const m = String(v).trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
      if (!m) continue;
      const a = +m[1], b = +m[2];
      if (a > 12 && b <= 12) dmy++;
      else if (b > 12 && a <= 12) mdy++;
    }
  }
  if (mdy && !dmy) return { fmt: 'mdy', proof: mdy };
  if (dmy && !mdy) return { fmt: 'dmy', proof: dmy };
  if (dmy && mdy) return { fmt: 'dmy', conflict: true };   // שני הפורמטים באותה הדבקה
  return { fmt: 'dmy', ambiguous: true };                  // אין הוכחה — ברירת מחדל ישראלית
}
// נרמול שמות להשוואה: מסיר תווי כיווניות נסתרים (שמגיעים מהעתקה מגיליונות),
// ניקוד, ומאחד גרש/גרשיים — אחרת "ישראל" ו"ישראל‏" נחשבים שני אנשים.
const norm = (s) => String(s == null ? '' : s)
  .replace(/[‎‏‪-‮﻿]/g, '')
  .replace(/[֑-ׇ]/g, '')
  .replace(/[׳״'"`´]/g, '')
  .trim().replace(/\s+/g, ' ').toLowerCase();

// בונה את מפות ההפניה מהמסד
async function loadContext() {
  const [contacts, products, sizes, scrolls, purchases, sold, lists] = await Promise.all([
    pool.query('SELECT id, name FROM contacts WHERE deleted=false'),
    pool.query('SELECT id, name FROM products WHERE deleted=false'),
    pool.query('SELECT id, name FROM parchment_sizes WHERE deleted=false'),
    pool.query('SELECT id FROM scrolls WHERE deleted=false'),
    pool.query('SELECT id, quantity FROM prod_purchases WHERE deleted=false'),
    pool.query('SELECT purchase_id, COALESCE(SUM(quantity),0) AS s FROM prod_sales WHERE deleted=false GROUP BY purchase_id'),
    pool.query('SELECT list_name, value FROM list_items WHERE deleted=false'),
  ]);
  // ערכי הרשימות: norm(ערך) -> הערך הקנוני כפי שהוא שמור
  const listVals = {};
  for (const r of lists.rows) {
    (listVals[r.list_name] = listVals[r.list_name] || new Map()).set(norm(r.value), r.value);
  }
  const contactMap = new Map();   // name(lower) -> [ids]
  for (const c of contacts.rows) {
    const nm = norm(c.name);
    if (!contactMap.has(nm)) contactMap.set(nm, []);
    contactMap.get(nm).push(c.id);
  }
  const byName = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const nm = norm(r.name);
      if (!m.has(nm)) m.set(nm, []);
      m.get(nm).push(r.id);
    }
    return m;
  };
  const remaining = new Map();
  for (const p of purchases.rows) remaining.set(p.id, Number(p.quantity));
  for (const s of sold.rows) remaining.set(s.purchase_id, (remaining.get(s.purchase_id) || 0) - Number(s.s));
  return {
    contactMap,
    productMap: byName(products.rows),
    sizeMap: byName(sizes.rows),
    contactIds: new Set(contacts.rows.map(c => c.id)),
    productIds: new Set(products.rows.map(p => p.id)),
    sizeIds: new Set(sizes.rows.map(s => s.id)),
    scrollIds: new Set(scrolls.rows.map(s => s.id)),
    purchaseIds: new Set(purchases.rows.map(p => p.id)),
    remaining,
    listVals,
  };
}

const REF_MAP = { contacts: 'contactMap', products: 'productMap', parchment_sizes: 'sizeMap' };
const REF_IDSET = { contacts: 'contactIds', products: 'productIds', parchment_sizes: 'sizeIds' };
const REFID_IDSET = { scrolls: 'scrollIds', prod_purchases: 'purchaseIds' };

// מפענח שורה אחת -> { ok, error, data:{col:val}, newContacts:[{name,nameKey}] }
// partial=true (מצב עדכון): עמודה ריקה נחשבת "לא נגעו בה" ולכן שדה חובה ריק אינו שגיאה.
function resolveRow(table, raw, ctx, opts, partial) {
  const spec = SPEC[table];
  const data = {};
  // מערך ולא משתנה יחיד — בשורת ס"ת יש גם סופר וגם רוכש, ואם שניהם
  // חדשים חייבים לזכור את שניהם, אחרת אחד מהם נכנס NULL בשקט.
  const newContacts = [];

  for (const col of spec.cols) {
    let val = raw[col.key];
    if (val !== undefined && val !== null) val = String(val).trim();
    if (partial && (val === undefined || val === '')) { continue; }

    // --- הפניה לפי שם ---
    if (col.ref) {
      if (!val) {
        if (col.required) return { ok: false, error: `חסר ערך בעמודה "${col.label}"` };
        data[col.key] = null; continue;
      }
      // ערך שכולו ספרות בעמודת שם הוא כמעט תמיד קוד מהמערכת הישנה —
      // התאמה שלו למזהה פנימי הייתה משייכת את השורה לאדם אקראי.
      if (/^\d+$/.test(val)) {
        return { ok: false, error: `"${val}" בעמודת "${col.label}" נראה כמו קוד — יש לכתוב את השם עצמו` };
      }
      const map = ctx[REF_MAP[col.ref]];
      const hits = map.get(norm(val));
      if (hits && hits.length === 1) { data[col.key] = hits[0]; continue; }
      if (hits && hits.length > 1) return { ok: false, error: `"${val}" מופיע יותר מפעם אחת ב${col.ref === 'contacts' ? 'אנשי הקשר' : 'רשימה'} — לא ניתן להכריע` };
      // לא נמצא
      if (col.ref === 'contacts' && opts.createMissingContacts) {
        const nameKey = norm(val);
        newContacts.push({ name: val, nameKey });
        data[col.key] = { __newContact: nameKey };   // ייושב בהכנסה
        continue;
      }
      const what = col.ref === 'contacts' ? 'איש קשר' : (col.ref === 'products' ? 'מוצר' : 'גודל קלף');
      return { ok: false, error: `${what} לא נמצא: "${val}"${col.ref === 'contacts' ? ' (סמן "צור אנשי קשר חסרים" או הוסף מראש)' : ' (הוסף אותו בהגדרות תחילה)'}` };
    }

    // --- הפניה לפי מזהה מספרי ---
    if (col.refId) {
      if (!val) {
        if (col.required) return { ok: false, error: `חסר ${col.label}` };
        data[col.key] = null; continue;
      }
      if (!/^\d+$/.test(val)) return { ok: false, error: `${col.label} חייב להיות מספר` };
      if (!ctx[REFID_IDSET[col.refId]].has(+val)) return { ok: false, error: `${col.label} ${val} לא קיים` };
      data[col.key] = +val; continue;
    }

    // --- שדות רגילים ---
    if (col.required && !val) return { ok: false, error: `חסר ערך בעמודה "${col.label}"` };
    if (col.type === 'num') {
      const n = toNum(val); if (n === undefined) return { ok: false, error: `"${val}" אינו מספר תקין (${col.label})` };
      data[col.key] = n;
    } else if (col.type === 'int') {
      const n = toNum(val); if (n === undefined) return { ok: false, error: `"${val}" אינו מספר תקין (${col.label})` };
      data[col.key] = n === null ? null : Math.round(n);
    } else if (col.type === 'bool') {
      data[col.key] = /^(true|1|כן|yes|v|✓)$/i.test(String(val || '').trim());
    } else if (col.type === 'date') {
      const d = normDate(val, opts.dateFmt);
      if (d === undefined) return { ok: false, error: `תאריך לא תקין "${val}" (${col.label}) — נסה dd/mm/yyyy` };
      data[col.key] = d;
    } else if (col.type === 'currency') {
      data[col.key] = /usd|\$|דולר/i.test(val || '') ? 'USD' : 'ILS';
    } else if (col.type === 'status') {
      data[col.key] = /done|הושלם|סיום|גמור/i.test(val || '') ? 'done' : 'active';
    } else if (col.type === 'ptype') {
      data[col.key] = /קומיסיון|commission/i.test(val || '') ? 'קומיסיון' : 'רגיל';
    } else if (col.type === 'listname') {
      if (!VALID_LISTS.has(val)) return { ok: false, error: `שם רשימה לא מוכר: "${val}"` };
      data[col.key] = val;
    } else if (col.listRef) {
      // סוג הוצאה חייב להתאים לערך ברשימה — אחרת ניתוב "תיקונים" נשבר בשקט
      if (!val) { data[col.key] = null; continue; }
      const canonical = (ctx.listVals[col.listRef] || new Map()).get(norm(val));
      if (canonical === undefined) {
        return { ok: false, error: `סוג הוצאה לא מוכר: "${val}" — הוסף אותו קודם בהגדרות` };
      }
      data[col.key] = canonical;
    } else {
      data[col.key] = (val === '' || val === undefined) ? null : val;
    }
  }
  return { ok: true, data, newContacts };
}

// ---------- מסלולים ----------
router.get('/spec', authenticate, can('view'), (req, res) => {
  res.json(Object.entries(SPEC).map(([table, s]) => ({
    table, label: s.label,
    cols: s.cols.map(c => ({
      key: c.key, label: c.label, required: !!c.required,
      ref: c.ref || null, refId: c.refId || null, type: c.type || 'text',
    })),
  })));
});

// ---------- מחיקה מרוכזת ----------
// מחיקה רכה לפי רשימת מזהים — לסל המחזור, עם אותן הדבקות כמו במסכים:
// ספר מוריד איתו את היומנים שלו, רכישה מורידה את המכירות שנגזרו ממנה.
router.post('/:table/delete', authenticate, can('del'), async (req, res) => {
  const table = req.params.table;
  if (!SPEC[table]) return res.status(400).json({ error: 'טבלה לא נתמכת' });
  const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : [])
    .map(Number).filter(n => Number.isInteger(n) && n > 0))];
  if (!ids.length) return res.status(400).json({ error: 'לא התקבלו מזהים' });
  if (ids.length > 5000) return res.status(400).json({ error: 'מקסימום 5000 מזהים במחיקה אחת' });
  const fn = table === 'scrolls' ? (id) => softDeleteScroll(id, req.user)
           : table === 'prod_purchases' ? (id) => softDeletePurchase(id, req.user)
           : (id) => softDelete(table, id, req.user);
  let deleted = 0; const failed = [];
  try {
    for (const id of ids) {
      try {
        if (await fn(id)) deleted++;
        else failed.push({ id, error: 'לא נמצא (או שכבר נמחק)' });
      } catch (e) { failed.push({ id, error: e.message }); }
    }
    await logAction(req.user, 'bulk-delete', table, null, { deleted, failed: failed.length });
    res.json({ deleted, failed });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// POST /:table
//   body: { rows:[{key:val}], options:{createMissingContacts}, dryRun, mode:'create'|'update' }
// mode='update' — כל שורה חייבת לכלול id, ורק העמודות שהופיעו בהדבקה מתעדכנות.
// זה מאפשר לתקן המונית עמודה אחת (למשל מחיר) בלי לדרוס את שאר השדות.
router.post('/:table', authenticate, can('edit'), async (req, res) => {
  const table = req.params.table;
  const spec = SPEC[table];
  if (!spec) return res.status(400).json({ error: 'טבלה לא נתמכת לייבוא' });

  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const opts = req.body.options || {};
  const dryRun = !!req.body.dryRun;
  const mode = req.body.mode === 'update' ? 'update' : 'create';
  if (!rows.length) return res.status(400).json({ error: 'לא התקבלו שורות' });
  if (rows.length > 5000) return res.status(400).json({ error: 'מקסימום 5000 שורות בייבוא אחד — חלק לחלקים' });

  try {
    const ctx = await loadContext();

    // פורמט התאריכים: לפי בחירת המשתמש, או זיהוי אוטומטי מכלל ההדבקה
    const dateKeys = spec.cols.filter(c => c.type === 'date').map(c => c.key);
    let dateInfo = { fmt: 'dmy' };
    if (dateKeys.length) {
      dateInfo = (opts.dateFormat === 'dmy' || opts.dateFormat === 'mdy')
        ? { fmt: opts.dateFormat, manual: true }
        : detectDateFormat(rows, dateKeys);
    }
    opts.dateFmt = dateInfo.fmt;

    // במצב עדכון — מזהי השורות הקיימות בטבלה, לאימות שכל id באמת קיים
    let existingIds = null;
    if (mode === 'update') {
      const r = await pool.query(`SELECT id FROM ${table} WHERE deleted=false`);
      existingIds = new Set(r.rows.map(x => x.id));
    }

    // שלב פענוח (שני המצבים)
    const resolved = rows.map((raw, i) => {
      const base = { line: i + 1 };
      if (mode === 'update') {
        const rawId = raw.id === undefined ? raw['id'] : raw.id;
        const idStr = String(rawId == null ? '' : rawId).trim();
        if (!idStr) return { ...base, ok: false, error: 'חסר מזהה (id) — בעדכון חייבים לכלול עמודת מזהה' };
        if (!/^\d+$/.test(idStr)) return { ...base, ok: false, error: `מזהה לא תקין "${idStr}"` };
        if (!existingIds.has(+idStr)) return { ...base, ok: false, error: `מזהה ${idStr} לא קיים בטבלה` };
        const rr = resolveRow(table, raw, ctx, opts, true);
        if (!rr.ok) return { ...base, ...rr };
        // רק העמודות שהמשתמש באמת הדביק מתעדכנות
        const touched = spec.cols.map(c => c.key).filter(k => raw[k] !== undefined && String(raw[k]).trim() !== '');
        if (!touched.length) return { ...base, ok: false, error: 'לא הודבקה אף עמודה לעדכון' };
        return { ...base, ...rr, id: +idStr, touched };
      }
      return { ...base, ...resolveRow(table, raw, ctx, opts, false) };
    });
    const valid = resolved.filter(r => r.ok);
    const newContactNames = [...new Set(valid.flatMap(r => r.newContacts || []).map(nc => nc.nameKey))];

    // כמות חייבת להיות חיובית ברכש ובמכירות — אחרת נוצר מלאי פנטום,
    // וכמות שלילית במכירה הייתה עוקפת את בדיקת המלאי.
    if (table === 'prod_sales' || table === 'prod_purchases') {
      for (const r of valid) {
        if (!r.ok) continue;
        const touchedQty = mode === 'create' || (r.touched && r.touched.includes('quantity'));
        if (touchedQty && !(Number(r.data.quantity) > 0)) {
          r.ok = false; r.error = 'הכמות חייבת להיות מספר גדול מאפס';
        }
      }
    }

    // בדיקת מלאי מקדימה למכירות מוצרים (על עותק של היתרות) — לתצוגה
    // המקדימה. הבדיקה המחייבת נעשית שוב בתוך הטרנזקציה, עם נעילה.
    if (table === 'prod_sales' && mode === 'create') {
      const rem = new Map(ctx.remaining);
      for (const r of valid) {
        if (!r.ok) continue;
        const pid = r.data.purchase_id, q = Number(r.data.quantity) || 0;
        const left = rem.has(pid) ? rem.get(pid) : 0;
        if (q > left) { r.ok = false; r.error = `אין מספיק מלאי בחבילה ${pid} — נשארו ${left}`; }
        else rem.set(pid, left - q);
      }
    }
    const valid2 = resolved.filter(r => r.ok);
    const invalid2 = resolved.filter(r => !r.ok);

    if (dryRun) {
      return res.json({
        table, mode, total: rows.length, valid: valid2.length, invalid: invalid2.length,
        new_contacts: newContactNames.length,
        date_format: dateKeys.length ? dateInfo : null,
        rows: resolved.map(r => ({
          line: r.line, ok: r.ok, error: r.error || null,
          willCreateContact: !!(r.newContacts && r.newContacts.length),
          fields: r.touched ? r.touched.length : undefined,
        })),
      });
    }

    // --- הכנסה אמיתית ---
    const cols = spec.cols.map(c => c.key);
    const noAudit = !!spec.noAudit;   // טבלאות בלי created_by/updated_by (list_items)
    const client = await pool.connect();
    const skipped = [];
    let created = 0;
    const insertedRecords = [];
    try {
      await client.query('BEGIN');

      // בדיקת המלאי המחייבת — בתוך הטרנזקציה, עם נעילת שורות הרכישה.
      // הבדיקה המקדימה שלמעלה נעשתה על נתונים ישנים; בלי הנעילה שתי
      // בקשות מקבילות היו יכולות לחרוג יחד מהמלאי.
      let txnRemaining = null;
      if (table === 'prod_sales' && mode === 'create') {
        const pids = [...new Set(valid2.map(r => Number(r.data.purchase_id)).filter(Boolean))];
        txnRemaining = new Map();
        if (pids.length) {
          const remRes = await client.query(
            `SELECT pp.id, pp.quantity - COALESCE((SELECT SUM(s.quantity) FROM prod_sales s
               WHERE s.purchase_id = pp.id AND s.deleted=false), 0) AS rem
             FROM prod_purchases pp
             WHERE pp.id = ANY($1::bigint[]) AND pp.deleted=false
             FOR UPDATE OF pp`,
            [pids]);
          for (const x of remRes.rows) txnRemaining.set(Number(x.id), Number(x.rem));
        }
      }

      // יצירת אנשי קשר חסרים (פעם אחת לכל שם — כולל כששניים באותה שורה)
      const createdContacts = new Map();   // nameKey -> id
      if (opts.createMissingContacts) {
        const byKey = new Map();
        for (const r of valid2) for (const nc of (r.newContacts || [])) byKey.set(nc.nameKey, nc);
        for (const nc of byKey.values()) {
          const ins = await client.query(
            'INSERT INTO contacts (name, created_by, updated_by) VALUES ($1,$2,$2) RETURNING *',
            [nc.name, req.user.id]);
          createdContacts.set(nc.nameKey, ins.rows[0].id);
          insertedRecords.push({ __table: 'contacts', rec: ins.rows[0] });
        }
      }

      // ציין איש-קשר-חדש שלא נוצר הוא באג — עדיף שהשורה תיכשל בקול
      // מאשר שתיכנס עם NULL בשקט.
      const resolveVal = (v) => {
        if (v && typeof v === 'object' && v.__newContact) {
          const id = createdContacts.get(v.__newContact);
          if (!id) throw new Error(`איש הקשר "${v.__newContact}" לא נוצר — השורה דולגה`);
          return id;
        }
        return v === undefined ? null : v;
      };

      for (const r of valid2) {
        await client.query('SAVEPOINT s');
        try {
          // מלאי במכירות: יצירה — מול היתרות הנעולות; עדכון של כמות/חבילה —
          // בדיקה פרטנית עם נעילה, בניכוי המכירה עצמה.
          if (table === 'prod_sales' && mode === 'create' && txnRemaining) {
            const pid = Number(r.data.purchase_id), q = Number(r.data.quantity) || 0;
            const left = txnRemaining.has(pid) ? txnRemaining.get(pid) : 0;
            if (q > left) throw new Error(`אין מספיק מלאי בחבילה ${pid} — נשארו ${left}`);
            txnRemaining.set(pid, left - q);
          }
          if (table === 'prod_sales' && mode === 'update' &&
              (r.touched.includes('quantity') || r.touched.includes('purchase_id'))) {
            const cur = await client.query('SELECT purchase_id, quantity FROM prod_sales WHERE id=$1 AND deleted=false', [r.id]);
            if (!cur.rows.length) throw new Error('השורה לא נמצאה או נמחקה');
            const pid = r.touched.includes('purchase_id') ? Number(r.data.purchase_id) : Number(cur.rows[0].purchase_id);
            const q = r.touched.includes('quantity') ? Number(r.data.quantity) : Number(cur.rows[0].quantity);
            const pr = await client.query('SELECT quantity FROM prod_purchases WHERE id=$1 AND deleted=false FOR UPDATE', [pid]);
            if (!pr.rows.length) throw new Error('חבילת הרכישה לא נמצאה');
            const sold = await client.query(
              'SELECT COALESCE(SUM(quantity),0) AS s FROM prod_sales WHERE purchase_id=$1 AND deleted=false AND id<>$2', [pid, r.id]);
            const left = Number(pr.rows[0].quantity) - Number(sold.rows[0].s);
            if (q > left) throw new Error(`אין מספיק מלאי — נשארו ${left} יחידות בחבילה`);
          }

          let out;
          if (mode === 'update') {
            // רק העמודות שהודבקו בפועל
            const upCols = r.touched;
            const vals = upCols.map(k => resolveVal(r.data[k]));
            const set = upCols.map((c, i) => `${c}=$${i + 1}`).join(', ');
            out = noAudit
              ? await client.query(
                  `UPDATE ${table} SET ${set} WHERE id=$${upCols.length + 1} AND deleted=false RETURNING *`,
                  [...vals, r.id])
              : await client.query(
                  `UPDATE ${table} SET ${set}, updated_by=$${upCols.length + 1}, updated_at=NOW()
                   WHERE id=$${upCols.length + 2} AND deleted=false RETURNING *`,
                  [...vals, req.user.id, r.id]);
            if (!out.rows.length) throw new Error('השורה לא נמצאה או נמחקה');
          } else {
            const vals = cols.map(k => resolveVal(r.data[k]));
            const ph = cols.map((_, i) => `$${i + 1}`).join(',');
            out = noAudit
              ? await client.query(
                  `INSERT INTO ${table} (${cols.join(',')}) VALUES (${ph}) RETURNING *`, vals)
              : await client.query(
                  `INSERT INTO ${table} (${cols.join(',')}, created_by, updated_by)
                   VALUES (${ph}, $${cols.length + 1}, $${cols.length + 1}) RETURNING *`,
                  [...vals, req.user.id]);
          }
          await client.query('RELEASE SAVEPOINT s');
          created++;
          insertedRecords.push({ __table: table, rec: out.rows[0] });
        } catch (e) {
          await client.query('ROLLBACK TO SAVEPOINT s');
          await client.query('RELEASE SAVEPOINT s');
          skipped.push({ line: r.line, error: e.message });
        }
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      console.error('Import failed:', e);
      return res.status(500).json({ error: 'הייבוא נכשל: ' + e.message });
    }
    client.release();

    // רישום פעולה בודד + שיקוף מרוכז לשיטס (בלי להציף את יומן הפעולות)
    await logAction(req.user, 'import', table, null, { created, skipped: skipped.length });
    if (sheets && sheets.enabled && sheets.enabled() && sheets.mirrorMany) {
      const byTbl = {};
      for (const it of insertedRecords) (byTbl[it.__table] = byTbl[it.__table] || []).push(it.rec);
      for (const t of Object.keys(byTbl)) sheets.mirrorMany(t, byTbl[t]).catch(() => {});
    }

    res.json({
      table, created,
      skipped: invalid2.map(r => ({ line: r.line, error: r.error })).concat(skipped),
      new_contacts_created: [...new Set(valid2.flatMap(r => r.newContacts || []).map(nc => nc.nameKey))].length,
    });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
