// סל מחזור — שום דבר לא נמחק פיזית, ולכן הכל ניתן לשחזור מכאן.
const express = require('express');
const { pool, restore, restoreScroll, restorePurchase } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const router = express.Router();

// טבלה -> תווית בעברית + ביטוי לתיאור השורה בתצוגה
const TABLES = {
  contacts:               { label: 'אנשי קשר',              desc: `TRIM(COALESCE(first_name,'')||' '||COALESCE(last_name,''))` },
  products:               { label: 'מוצרים',                desc: 'name' },
  parchment_sizes:        { label: 'גדלי קלף',              desc: 'name' },
  list_items:             { label: 'ערכי רשימות',           desc: 'value' },
  scrolls:                { label: 'ספרים (ס"ת)',           desc: `'ספר #'||id` },
  pages_log:              { label: 'עמודים שנכתבו',         desc: `pages||' עמודים'` },
  scribe_payments:        { label: 'תשלומים לסופר',         desc: `'₪'||amount` },
  customer_payments:      { label: 'תשלומי לקוחות',         desc: `'₪'||amount_ils||' / $'||amount_usd` },
  book_expenses:          { label: 'הוצאות לספר',           desc: `COALESCE(type,'')||' ₪'||amount` },
  parchment_expenses:     { label: 'הוצאות קלף',            desc: `quantity||' יחידות'` },
  business_expenses:      { label: 'הוצאות עסק',            desc: `COALESCE(type,'')||' ₪'||amount` },
  prod_purchases:         { label: 'רכישות מוצרים',         desc: `quantity||' יח\\''` },
  prod_scribe_payments:   { label: 'תשלומי סופר (מוצרים)',  desc: `'₪'||amount` },
  prod_sales:             { label: 'מכירות מוצרים',         desc: `quantity||' יח\\''` },
  prod_customer_payments: { label: 'תשלומי לקוחות (מוצרים)', desc: `'₪'||amount_ils||' / $'||amount_usd` },
};

// סיכום: כמה רשומות מחוקות יש בכל טבלה
router.get('/', authenticate, can('view'), async (req, res) => {
  try {
    const out = [];
    for (const [table, def] of Object.entries(TABLES)) {
      const r = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE deleted=true`);
      if (r.rows[0].n > 0) out.push({ table, label: def.label, count: r.rows[0].n });
    }
    res.json(out);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// הרשומות המחוקות בטבלה מסוימת
router.get('/:table', authenticate, can('view'), async (req, res) => {
  const def = TABLES[req.params.table];
  if (!def) return res.status(400).json({ error: 'טבלה לא מוכרת' });
  try {
    const r = await pool.query(
      `SELECT id, ${def.desc} AS description, deleted_at, deleted_by
       FROM ${req.params.table} WHERE deleted=true ORDER BY deleted_at DESC NULLS LAST LIMIT 500`);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// שחזור — ספר ורכישת מוצר מחזירים גם את רשומות הבן שנמחקו איתם
router.post('/:table/:id/restore', authenticate, can('del'), async (req, res) => {
  const { table, id } = req.params;
  if (!TABLES[table]) return res.status(400).json({ error: 'טבלה לא מוכרת' });
  try {
    let ok;
    if (table === 'scrolls') ok = await restoreScroll(id, req.user);
    else if (table === 'prod_purchases') ok = await restorePurchase(id, req.user);
    else ok = await restore(table, id, req.user);
    if (!ok) return res.status(404).json({ error: 'לא נמצא' });
    res.json({ message: 'שוחזר בהצלחה' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
