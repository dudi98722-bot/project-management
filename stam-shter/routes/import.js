// ===== מנוע ייבוא מרוכז =====
// מאפשר להדביק שורות מגוגל שיטס / אקסל לכל טבלה. מפענח הפניות לפי שם
// (סופר/רוכש/מוצר/גודל -> id), מנרמל תאריכים, מוודא כל שורה, ומכניס בטרנזקציה.
// dryRun מחזיר תצוגה מקדימה בלי לכתוב כלום.
const express = require('express');
const { pool, logAction } = require('../db');
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
      { key: 'type', label: 'סוג הוצאה' },
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
      { key: 'type', label: 'סוג הוצאה' },
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

// ---------- המרות ----------
function toNum(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = parseFloat(String(v).replace(/[₪$,\s]/g, '').replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? undefined : n;   // undefined = שגיאת פענוח
}
function normDate(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  let m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);   // dd/mm/yyyy
  if (m) {
    let d = m[1].padStart(2, '0'), mo = m[2].padStart(2, '0'), y = m[3];
    if (y.length === 2) y = '20' + y;
    const dn = +d, mn = +mo;
    if (mn < 1 || mn > 12 || dn < 1 || dn > 31) return undefined;
    return `${y}-${mo}-${d}`;
  }
  return undefined;   // פורמט לא מזוהה
}
const norm = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();

// בונה את מפות ההפניה מהמסד
async function loadContext() {
  const [contacts, products, sizes, scrolls, purchases, sold] = await Promise.all([
    pool.query('SELECT id, name FROM contacts WHERE deleted=false'),
    pool.query('SELECT id, name FROM products WHERE deleted=false'),
    pool.query('SELECT id, name FROM parchment_sizes WHERE deleted=false'),
    pool.query('SELECT id FROM scrolls WHERE deleted=false'),
    pool.query('SELECT id, quantity FROM prod_purchases WHERE deleted=false'),
    pool.query('SELECT purchase_id, COALESCE(SUM(quantity),0) AS s FROM prod_sales WHERE deleted=false GROUP BY purchase_id'),
  ]);
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
  };
}

const REF_MAP = { contacts: 'contactMap', products: 'productMap', parchment_sizes: 'sizeMap' };
const REF_IDSET = { contacts: 'contactIds', products: 'productIds', parchment_sizes: 'sizeIds' };
const REFID_IDSET = { scrolls: 'scrollIds', prod_purchases: 'purchaseIds' };

// מפענח שורה אחת -> { ok, error, data:{col:val}, newContact:{first,last}|null }
// partial=true (מצב עדכון): עמודה ריקה נחשבת "לא נגעו בה" ולכן שדה חובה ריק אינו שגיאה.
function resolveRow(table, raw, ctx, opts, partial) {
  const spec = SPEC[table];
  const data = {};
  let newContact = null;

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
      // מספר שהוא id קיים -> קבל כמות שהוא
      if (/^\d+$/.test(val) && ctx[REF_IDSET[col.ref]].has(+val)) { data[col.key] = +val; continue; }
      const map = ctx[REF_MAP[col.ref]];
      const hits = map.get(norm(val));
      if (hits && hits.length === 1) { data[col.key] = hits[0]; continue; }
      if (hits && hits.length > 1) return { ok: false, error: `"${val}" מופיע יותר מפעם אחת ב${col.ref === 'contacts' ? 'אנשי הקשר' : 'רשימה'} — לא ניתן להכריע` };
      // לא נמצא
      if (col.ref === 'contacts' && opts.createMissingContacts) {
        newContact = { name: val, nameKey: norm(val) };
        data[col.key] = { __newContact: newContact.nameKey };   // ייושב בהכנסה
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
      const d = normDate(val); if (d === undefined) return { ok: false, error: `תאריך לא תקין "${val}" (${col.label}) — נסה dd/mm/yyyy` };
      data[col.key] = d;
    } else if (col.type === 'currency') {
      data[col.key] = /usd|\$|דולר/i.test(val || '') ? 'USD' : 'ILS';
    } else if (col.type === 'status') {
      data[col.key] = /done|הושלם|סיום|גמור/i.test(val || '') ? 'done' : 'active';
    } else if (col.type === 'ptype') {
      data[col.key] = /קומיסיון|commission/i.test(val || '') ? 'קומיסיון' : 'רגיל';
    } else {
      data[col.key] = (val === '' || val === undefined) ? null : val;
    }
  }
  return { ok: true, data, newContact };
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
    const newContactNames = [...new Set(valid.filter(r => r.newContact).map(r => r.newContact.nameKey))];

    // בדיקת מלאי מקדימה למכירות מוצרים (על עותק של היתרות).
    // רלוונטית ליצירה בלבד; בעדכון היתרה כבר משקפת את השורה עצמה.
    if (table === 'prod_sales' && mode === 'create') {
      const rem = new Map(ctx.remaining);
      for (const r of valid) {
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
        rows: resolved.map(r => ({
          line: r.line, ok: r.ok, error: r.error || null,
          willCreateContact: !!r.newContact,
          fields: r.touched ? r.touched.length : undefined,
        })),
      });
    }

    // --- הכנסה אמיתית ---
    const cols = spec.cols.map(c => c.key);
    const client = await pool.connect();
    const skipped = [];
    let created = 0;
    const insertedRecords = [];
    try {
      await client.query('BEGIN');

      // יצירת אנשי קשר חסרים (פעם אחת לכל שם)
      const createdContacts = new Map();   // nameKey -> id
      if (opts.createMissingContacts) {
        const byKey = new Map();
        for (const r of valid2) if (r.newContact) byKey.set(r.newContact.nameKey, r.newContact);
        for (const nc of byKey.values()) {
          const ins = await client.query(
            'INSERT INTO contacts (name, created_by, updated_by) VALUES ($1,$2,$2) RETURNING *',
            [nc.name, req.user.id]);
          createdContacts.set(nc.nameKey, ins.rows[0].id);
          insertedRecords.push({ __table: 'contacts', rec: ins.rows[0] });
        }
      }

      const resolveVal = (v) => {
        if (v && typeof v === 'object' && v.__newContact) return createdContacts.get(v.__newContact) || null;
        return v === undefined ? null : v;
      };

      for (const r of valid2) {
        await client.query('SAVEPOINT s');
        try {
          let out;
          if (mode === 'update') {
            // רק העמודות שהודבקו בפועל
            const upCols = r.touched;
            const vals = upCols.map(k => resolveVal(r.data[k]));
            const set = upCols.map((c, i) => `${c}=$${i + 1}`).join(', ');
            out = await client.query(
              `UPDATE ${table} SET ${set}, updated_by=$${upCols.length + 1}, updated_at=NOW()
               WHERE id=$${upCols.length + 2} AND deleted=false RETURNING *`,
              [...vals, req.user.id, r.id]);
            if (!out.rows.length) throw new Error('השורה לא נמצאה או נמחקה');
          } else {
            const vals = cols.map(k => resolveVal(r.data[k]));
            const ph = cols.map((_, i) => `$${i + 1}`).join(',');
            out = await client.query(
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
      new_contacts_created: [...new Set(valid2.filter(r => r.newContact).map(r => r.newContact.nameKey))].length,
    });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
