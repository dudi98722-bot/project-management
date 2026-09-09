// ===== פורטל לקוח הקומיסיון =====
// ממשק נפרד לחלוטין מה-API הרגיל, ולא סינון שלו. הלקוח רואה רק את
// עצמו, ומזהה הלקוח נגזר מהמשתמש המחובר בלבד — הפורטל לעולם אינו
// מקבל מזהה לקוח מהדפדפן, ולכן אין דרך לבקש נתונים של מישהו אחר.
//
// מה שהלקוח לעולם לא רואה: עלות היחידה, העלות הנוספת, שם הסופר שממנו
// נקנה, והרווח. השאילתות כאן פשוט אינן בוחרות את השדות האלה — אין
// מסתיר בממשק מה שהשרת שלח.
const express = require('express');
const { pool } = require('../db');
const { authenticate } = require('../middleware/auth');
const { writeReport } = require('./prod-consign');
const router = express.Router();

router.use(authenticate);

// השיוך נקרא מהמסד בכל בקשה ולא מהטוקן: ביטול משתמש או ניתוקו מהלקוח
// נכנס לתוקף מיד, ולא רק כשיפוג הטוקן שכבר בידיו.
router.use(async (req, res, next) => {
  if (!req.caps || !req.caps.portal) {
    return res.status(403).json({ error: 'הפורטל מיועד למשתמשי קומיסיון בלבד' });
  }
  try {
    const r = await pool.query('SELECT contact_id, active FROM users WHERE id=$1', [req.user.id]);
    if (!r.rows.length || r.rows[0].active === false) {
      return res.status(403).json({ error: 'המשתמש אינו פעיל' });
    }
    if (!r.rows[0].contact_id) {
      return res.status(403).json({ error: 'המשתמש אינו משויך ללקוח. פנה למשרד.' });
    }
    req.contactId = r.rows[0].contact_id;
    next();
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (v) => Math.round(n(v) * 100) / 100;

// שורות המכירה של הלקוח. בלי עלות, בלי סופר, בלי רווח.
const ITEMS_SQL = `
SELECT s.id, s.date, s.quantity, s.price_per_unit, s.sale_type, s.note,
  COALESCE(s.currency,'ILS') AS currency,
  p.name AS product_name,
  COALESCE(cr.reported,0) AS reported_qty,
  (CASE WHEN COALESCE(s.sale_type,'רגיל')='קומיסיון'
        THEN LEAST(COALESCE(cr.reported,0), COALESCE(s.quantity,0))
        ELSE COALESCE(s.quantity,0) END) AS billed_qty,
  (CASE WHEN COALESCE(s.sale_type,'רגיל')='קומיסיון'
        THEN GREATEST(COALESCE(s.quantity,0) - COALESCE(cr.reported,0), 0)
        ELSE 0 END) AS holding_qty
FROM prod_sales s
LEFT JOIN prod_purchases pp ON pp.id = s.purchase_id
LEFT JOIN products p        ON p.id  = pp.product_id
LEFT JOIN (SELECT sale_id, SUM(quantity) AS reported
             FROM prod_consign_reports WHERE deleted=false GROUP BY sale_id) cr
  ON cr.sale_id = s.id
WHERE s.deleted=false AND s.customer_id = $1`;

async function loadAll(contactId) {
  const [items, pays] = await Promise.all([
    pool.query(`${ITEMS_SQL} ORDER BY s.date DESC NULLS LAST, s.id DESC`, [contactId]),
    pool.query(`SELECT id, date, note, COALESCE(currency,'ILS') AS currency,
                  (CASE WHEN COALESCE(currency,'ILS')='USD' THEN COALESCE(amount_usd,0)
                        ELSE COALESCE(amount_ils,0) + COALESCE(amount_usd,0)*COALESCE(rate,0) END) AS amount
                FROM prod_customer_payments
                WHERE deleted=false AND customer_id=$1
                ORDER BY date DESC NULLS LAST, id DESC`, [contactId]),
  ]);
  const rows = items.rows.map(x => Object.assign({}, x, {
    holding_value: r2(n(x.holding_qty) * n(x.price_per_unit)),
    billed_value: r2(n(x.billed_qty) * n(x.price_per_unit)),
  }));
  // סכימה לפי מטבע השורה — ערבוב שקלים ודולרים נותן מספר חסר משמעות
  const by = (arr, key, cur) => r2(arr.reduce((a, x) =>
    a + ((x.currency || 'ILS') === cur ? n(x[key]) : 0), 0));
  const totals = {
    holding_units: rows.reduce((a, x) => a + n(x.holding_qty), 0),
    holding_value: by(rows, 'holding_value', 'ILS'),
    holding_value_usd: by(rows, 'holding_value', 'USD'),
    billed: by(rows, 'billed_value', 'ILS'),
    billed_usd: by(rows, 'billed_value', 'USD'),
    paid: by(pays.rows, 'amount', 'ILS'),
    paid_usd: by(pays.rows, 'amount', 'USD'),
  };
  totals.owed = r2(totals.billed - totals.paid);
  totals.owed_usd = r2(totals.billed_usd - totals.paid_usd);
  return { rows, payments: pays.rows, totals };
}

router.get('/me', async (req, res) => {
  try {
    const c = await pool.query('SELECT name, phone FROM contacts WHERE id=$1', [req.contactId]);
    const d = await loadAll(req.contactId);
    res.json({
      contact: { name: (c.rows[0] || {}).name || '', phone: (c.rows[0] || {}).phone || '' },
      items: d.rows, payments: d.payments, totals: d.totals,
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// דיווח על מכירה. הבעלות נבדקת כאן, לפני הכתיבה: מזהה מכירה שאינו
// שייך ללקוח המחובר מוחזר כ"לא נמצא" ולא כשגיאת הרשאה, כדי שלא יהיה
// אפשר ללמוד מהתשובה אילו מזהי מכירה קיימים במערכת.
router.post('/report', async (req, res) => {
  const saleId = req.body && req.body.sale_id;
  const qty = Math.round(Number(req.body && req.body.quantity) || 0);
  if (!saleId) return res.status(400).json({ error: 'לא נבחרה מכירה' });
  try {
    const own = await pool.query(
      `SELECT id FROM prod_sales WHERE id=$1 AND customer_id=$2 AND deleted=false AND sale_type='קומיסיון'`,
      [saleId, req.contactId]);
    if (!own.rows.length) return res.status(404).json({ error: 'המכירה לא נמצאה' });

    const out = await writeReport({
      saleId, qty,
      // דיווח בלי תאריך יקבל את היום — שורה בלי תאריך אי אפשר להתחשבן עליה
      date: req.body.date || new Date().toISOString().slice(0, 10),
      note: req.body.note || null,
      user: req.user,
      byCustomer: true,          // נרשם כדיווח של הלקוח עצמו, לא של המשרד
      id: null,
    });
    if (out.error) return res.status(out.code).json({ error: out.error });
    // התשובה נבנית מחדש מהפורטל, כדי ששורת הדיווח המלאה (שכוללת גם
    // שדות של המשרד) לא תדלוף החוצה
    const d = await loadAll(req.contactId);
    res.status(201).json({ message: 'הדיווח נקלט', items: d.rows, totals: d.totals });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
