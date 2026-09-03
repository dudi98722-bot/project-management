// ===== דוחות =====
// כאן נפגשות שתי המערכות: ס"ת (calc.js) ומוצרים (SQL כאן).
// דוחות הסופר והרוכש מאחדים את שתיהן — זו נקודת החיבור היחידה ביניהן.
const express = require('express');
const { pool } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const { getScrolls, n, r2 } = require('../calc');
const router = express.Router();

// דוח הסופר פתוח גם למי שיש לו scribeReport בלבד (תפקיד ניהול סופרים);
// כל שאר הדוחות דורשים viewReports.
router.use(authenticate);
router.use((req, res, next) => {
  const scribeOnly = /^\/scribe(-balances)?(\/|$)/.test(req.path);
  if (req.caps.viewReports) return next();
  if (scribeOnly && req.caps.scribeReport) return next();
  return res.status(403).json({ error: 'אין לך הרשאה לצפות בדוחות' });
});

// ביטויי הרווח של מכירת מוצר, לשימוש חוזר בשאילתות.
// COALESCE על כל רכיב — NULL אחד היה מעלים את השורה כולה מהסכומים.
//
// מטבע: כל סכום במערכת המוצרים שייך למטבע של השורה שלו, ואין שער המרה
// גלובלי. לכן כל ביטוי קיים בשתי גרסאות — ILS ו-USD — וכל אחת מאפסת את
// השורות של המטבע האחר. הגרסאות חסרות הסיומת נשארו שקליות, ולכן כל
// חישוב קיים ממשיך להחזיר בדיוק את אותו מספר כל עוד אין נתוני דולר.
const RAW_SALE_TOTAL = '(COALESCE(s.quantity,0) * COALESCE(s.price_per_unit,0))';
const RAW_SALE_COST  = '(COALESCE(s.quantity,0) * (COALESCE(pp.cost_per_unit,0) + COALESCE(pp.extra_cost_per_unit,0)))';
const RAW_SALE_3PCT  = `(CASE WHEN s.deduct_3pct THEN ${RAW_SALE_TOTAL} * 0.03 ELSE 0 END)`;
const CUR_S  = "COALESCE(s.currency,'ILS')";
const CUR_PP = "COALESCE(pp.currency,'ILS')";

// הכנסה ו-3% לפי מטבע המכירה; העלות לפי מטבע הרכישה — הן עצמאיות זו מזו
const SALE_TOTAL   = `(CASE WHEN ${CUR_S}='ILS'  THEN ${RAW_SALE_TOTAL} ELSE 0 END)`;
const SALE_TOTAL_U = `(CASE WHEN ${CUR_S}='USD'  THEN ${RAW_SALE_TOTAL} ELSE 0 END)`;
const SALE_COST    = `(CASE WHEN ${CUR_PP}='ILS' THEN ${RAW_SALE_COST}  ELSE 0 END)`;
const SALE_COST_U  = `(CASE WHEN ${CUR_PP}='USD' THEN ${RAW_SALE_COST}  ELSE 0 END)`;
const SALE_3PCT    = `(CASE WHEN ${CUR_S}='ILS'  THEN ${RAW_SALE_3PCT}  ELSE 0 END)`;
const SALE_3PCT_U  = `(CASE WHEN ${CUR_S}='USD'  THEN ${RAW_SALE_3PCT}  ELSE 0 END)`;

// תשלומי לקוחות של ס"ת — טבלה בלי עמודת מטבע, ההתנהגות לא השתנתה
const PERITAH    = '(CASE WHEN COALESCE(amount_usd,0) > 0 THEN COALESCE(amount_usd,0) * COALESCE(rate,0) - COALESCE(cash_in_hand,0) ELSE 0 END)';
const PAID_TOTAL = '(COALESCE(amount_ils,0) + COALESCE(amount_usd,0) * COALESCE(rate,0))';

// תשלומי לקוחות של מוצרים — שורת USD נשארת דולרית, בלי המרה ובלי פריטה
const CUR_ROW      = "COALESCE(currency,'ILS')";
const PPAID_ILS    = `(CASE WHEN ${CUR_ROW}='ILS' THEN (COALESCE(amount_ils,0) + COALESCE(amount_usd,0) * COALESCE(rate,0)) ELSE 0 END)`;
const PPAID_USD    = `(CASE WHEN ${CUR_ROW}='USD' THEN COALESCE(amount_usd,0) ELSE 0 END)`;
const PPERITAH     = `(CASE WHEN ${CUR_ROW}='ILS' AND COALESCE(amount_usd,0) > 0 THEN COALESCE(amount_usd,0) * COALESCE(rate,0) - COALESCE(cash_in_hand,0) ELSE 0 END)`;
// תשלומים לסופר ורכישות — הסכום נקוב במטבע השורה
const SPAID_ILS    = `(CASE WHEN ${CUR_ROW}='ILS' THEN COALESCE(amount,0) ELSE 0 END)`;
const SPAID_USD    = `(CASE WHEN ${CUR_ROW}='USD' THEN COALESCE(amount,0) ELSE 0 END)`;
const POWED_ILS    = `(CASE WHEN ${CUR_ROW}='ILS' THEN COALESCE(quantity,0)*COALESCE(cost_per_unit,0) ELSE 0 END)`;
const POWED_USD    = `(CASE WHEN ${CUR_ROW}='USD' THEN COALESCE(quantity,0)*COALESCE(cost_per_unit,0) ELSE 0 END)`;

const sum = (rows, key) => r2(rows.reduce((a, x) => a + n(x[key]), 0));

// סיכומי מערכת המוצרים
async function prodTotals() {
  const [sales, purch, scribePaid, custPaid] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(${SALE_TOTAL}),0)   AS revenue,
                       COALESCE(SUM(${SALE_COST}),0)    AS cost,
                       COALESCE(SUM(${SALE_3PCT}),0)    AS deduct,
                       COALESCE(SUM(${SALE_TOTAL_U}),0) AS revenue_usd,
                       COALESCE(SUM(${SALE_COST_U}),0)  AS cost_usd,
                       COALESCE(SUM(${SALE_3PCT_U}),0)  AS deduct_usd
                FROM prod_sales s
                LEFT JOIN prod_purchases pp ON pp.id = s.purchase_id
                WHERE s.deleted=false`),
    pool.query(`SELECT COALESCE(SUM(${POWED_ILS}),0) AS owed, COALESCE(SUM(${POWED_USD}),0) AS owed_usd
                FROM prod_purchases WHERE deleted=false`),
    pool.query(`SELECT COALESCE(SUM(${SPAID_ILS}),0) AS paid, COALESCE(SUM(${SPAID_USD}),0) AS paid_usd
                FROM prod_scribe_payments WHERE deleted=false`),
    pool.query(`SELECT COALESCE(SUM(${PPAID_ILS}),0) AS paid, COALESCE(SUM(${PPAID_USD}),0) AS paid_usd,
                       COALESCE(SUM(${PPERITAH}),0) AS peritah
                FROM prod_customer_payments WHERE deleted=false`),
  ]);
  const q = sales.rows[0], pu = purch.rows[0], sp = scribePaid.rows[0], cp = custPaid.rows[0];
  const revenue = n(q.revenue), cost = n(q.cost), deduct = n(q.deduct);
  const revenueU = n(q.revenue_usd), costU = n(q.cost_usd), deductU = n(q.deduct_usd);
  return {
    revenue: r2(revenue), cost: r2(cost), deduct_3pct: r2(deduct),
    profit: r2(revenue - cost - deduct),
    owed_scribes: r2(n(pu.owed) - n(sp.paid)),
    customer_paid: r2(n(cp.paid)),
    customer_owes: r2(revenue - n(cp.paid)),
    peritah: r2(n(cp.peritah)),
    // צד הדולר — אותם מדדים בדיוק, בלי שום המרה
    revenue_usd: r2(revenueU), cost_usd: r2(costU), deduct_3pct_usd: r2(deductU),
    profit_usd: r2(revenueU - costU - deductU),
    owed_scribes_usd: r2(n(pu.owed_usd) - n(sp.paid_usd)),
    customer_paid_usd: r2(n(cp.paid_usd)),
    customer_owes_usd: r2(revenueU - n(cp.paid_usd)),
  };
}

// ---------- דשבורד ----------
router.get('/overview', async (req, res) => {
  try {
    const [scrolls, prod, biz, stock] = await Promise.all([
      getScrolls(),
      prodTotals(),
      pool.query('SELECT COALESCE(SUM(amount),0) AS total FROM business_expenses WHERE deleted=false'),
      pool.query(`SELECT COALESCE(SUM(pp.quantity - COALESCE(sd.sold,0)),0) AS units
                  FROM prod_purchases pp
                  LEFT JOIN (SELECT purchase_id, SUM(quantity) sold FROM prod_sales WHERE deleted=false GROUP BY purchase_id) sd
                    ON sd.purchase_id = pp.id
                  WHERE pp.deleted=false`),
    ]);
    const bizExp = n(biz.rows[0].total);
    const scrollProfit = sum(scrolls, 'expected_profit');
    res.json({
      scrolls_count: scrolls.length,
      scrolls_active: scrolls.filter(s => s.status !== 'done').length,
      scroll_profit: scrollProfit,
      product_profit: prod.profit,
      business_expenses: r2(bizExp),
      // רווח נקי: פריטת ס"ת כבר בתוך הרווח לספר; פריטת המוצרים יורדת כאן
      net_profit: r2(scrollProfit + prod.profit - prod.peritah - bizExp),
      owed_to_scribes: r2(sum(scrolls, 'scribe_balance') + prod.owed_scribes),
      owed_by_customers: r2(sum(scrolls, 'buyer_balance_now') + prod.customer_owes),
      owed_by_customers_total: r2(sum(scrolls, 'buyer_balance_total') + prod.customer_owes),
      stock_units: n(stock.rows[0].units),
      peritah_total: r2(sum(scrolls, 'peritah_cost') + prod.peritah),
      // דולר — מוצג בנפרד ולעולם לא מחובר לשקלים
      product_profit_usd: prod.profit_usd,
      owed_to_scribes_usd: prod.owed_scribes_usd,
      owed_by_customers_usd: prod.customer_owes_usd,
      has_usd: !!(prod.revenue_usd || prod.cost_usd || prod.owed_scribes_usd
                  || prod.customer_paid_usd || prod.customer_owes_usd),
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// ---------- רווח כולל ----------
router.get('/profit', async (req, res) => {
  try {
    const [scrolls, prod, biz] = await Promise.all([
      getScrolls(),
      prodTotals(),
      pool.query(`SELECT type, COALESCE(SUM(amount),0) AS total FROM business_expenses
                  WHERE deleted=false GROUP BY type ORDER BY total DESC`),
    ]);
    const bizExp = r2(biz.rows.reduce((a, x) => a + n(x.total), 0));
    const scrollProfit = sum(scrolls, 'expected_profit');
    res.json({
      scrolls: {
        revenue: sum(scrolls, 'buyer_total'),
        scribe_cost: sum(scrolls, 'scribe_book_price'),
        peritah: sum(scrolls, 'peritah_cost'),
        fixed_expenses: sum(scrolls, 'fixed_expense'),
        book_expenses: sum(scrolls, 'book_expenses'),
        parchment_expected: sum(scrolls, 'parchment_expected'),
        parchment_actual: sum(scrolls, 'parchment_actual'),
        profit: scrollProfit,
      },
      products: prod,
      business_expenses: bizExp,
      business_expenses_by_type: biz.rows.map(r => ({ type: r.type, total: r2(r.total) })),
      net_profit: r2(scrollProfit + prod.profit - prod.peritah - bizExp),
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// ---------- רווח לפי ספר ----------
router.get('/by-scroll', async (req, res) => {
  try { res.json(await getScrolls()); }
  catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// ---------- יתרות סופרים (מאוחד) ----------
router.get('/scribe-balances', async (req, res) => {
  try {
    const [scrolls, prodRows, contacts] = await Promise.all([
      getScrolls(),
      pool.query(`
        SELECT c.id,
          COALESCE(pu.owed,0) AS owed,
          COALESCE(pa.paid,0) AS paid,
          COALESCE(pu.owed_usd,0) AS owed_usd,
          COALESCE(pa.paid_usd,0) AS paid_usd
        FROM contacts c
        LEFT JOIN (SELECT scribe_id, SUM(${POWED_ILS}) owed, SUM(${POWED_USD}) owed_usd FROM prod_purchases WHERE deleted=false GROUP BY scribe_id) pu ON pu.scribe_id=c.id
        LEFT JOIN (SELECT scribe_id, SUM(${SPAID_ILS}) paid, SUM(${SPAID_USD}) paid_usd FROM prod_scribe_payments WHERE deleted=false GROUP BY scribe_id) pa ON pa.scribe_id=c.id
        WHERE c.deleted=false AND (pu.owed IS NOT NULL OR pa.paid IS NOT NULL)`),
      pool.query('SELECT id, name, phone FROM contacts WHERE deleted=false'),
    ]);
    const byId = new Map(contacts.rows.map(c => [c.id, c]));
    const acc = new Map();
    const bucket = (id) => {
      if (!acc.has(id)) {
        const c = byId.get(id) || {};
        acc.set(id, {
          id, name: c.name || '', phone: c.phone || '',
          scroll_balance: 0, scroll_future: 0, scrolls_count: 0,
          product_owed: 0, product_paid: 0, product_balance: 0, total_balance: 0,
          product_owed_usd: 0, product_paid_usd: 0, product_balance_usd: 0,
        });
      }
      return acc.get(id);
    };
    for (const s of scrolls) {
      if (!s.scribe_id) continue;
      const b = bucket(s.scribe_id);
      b.scroll_balance += n(s.scribe_balance);
      b.scroll_future  += n(s.scribe_future_balance);
      b.scrolls_count++;
    }
    for (const p of prodRows.rows) {
      const b = bucket(p.id);
      b.product_owed = n(p.owed); b.product_paid = n(p.paid);
      b.product_balance = n(p.owed) - n(p.paid);
      b.product_owed_usd = n(p.owed_usd); b.product_paid_usd = n(p.paid_usd);
      b.product_balance_usd = n(p.owed_usd) - n(p.paid_usd);
    }
    const out = [...acc.values()].map(b => ({
      ...b,
      scroll_balance: r2(b.scroll_balance), scroll_future: r2(b.scroll_future),
      product_owed: r2(b.product_owed), product_paid: r2(b.product_paid),
      product_balance: r2(b.product_balance),
      product_owed_usd: r2(b.product_owed_usd), product_paid_usd: r2(b.product_paid_usd),
      product_balance_usd: r2(b.product_balance_usd),
      total_balance: r2(b.scroll_balance + b.product_balance),
    })).sort((a, b) => b.total_balance - a.total_balance);
    res.json(out);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// ---------- יתרות רוכשים (מאוחד) ----------
router.get('/customer-balances', async (req, res) => {
  try {
    const [scrolls, prodRows, contacts] = await Promise.all([
      getScrolls(),
      pool.query(`
        SELECT c.id, COALESCE(sl.revenue,0) AS revenue, COALESCE(pm.paid,0) AS paid,
               COALESCE(sl.revenue_usd,0) AS revenue_usd, COALESCE(pm.paid_usd,0) AS paid_usd
        FROM contacts c
        LEFT JOIN (SELECT s.customer_id, SUM(${SALE_TOTAL}) revenue, SUM(${SALE_TOTAL_U}) revenue_usd
                   FROM prod_sales s LEFT JOIN prod_purchases pp ON pp.id=s.purchase_id
                   WHERE s.deleted=false GROUP BY s.customer_id) sl ON sl.customer_id=c.id
        LEFT JOIN (SELECT customer_id, SUM(${PPAID_ILS}) paid, SUM(${PPAID_USD}) paid_usd
                   FROM prod_customer_payments WHERE deleted=false GROUP BY customer_id) pm ON pm.customer_id=c.id
        WHERE c.deleted=false AND (sl.revenue IS NOT NULL OR pm.paid IS NOT NULL)`),
      pool.query('SELECT id, name, phone FROM contacts WHERE deleted=false'),
    ]);
    const byId = new Map(contacts.rows.map(c => [c.id, c]));
    const acc = new Map();
    const bucket = (id) => {
      if (!acc.has(id)) {
        const c = byId.get(id) || {};
        acc.set(id, {
          id, name: c.name || '', phone: c.phone || '',
          scroll_due_now: 0, scroll_due_total: 0, scrolls_count: 0,
          product_revenue: 0, product_paid: 0, product_balance: 0,
          product_revenue_usd: 0, product_paid_usd: 0, product_balance_usd: 0,
        });
      }
      return acc.get(id);
    };
    for (const s of scrolls) {
      if (!s.customer_id) continue;
      const b = bucket(s.customer_id);
      b.scroll_due_now   += n(s.buyer_balance_now);
      b.scroll_due_total += n(s.buyer_balance_total);
      b.scrolls_count++;
    }
    for (const p of prodRows.rows) {
      const b = bucket(p.id);
      b.product_revenue = n(p.revenue); b.product_paid = n(p.paid);
      b.product_balance = n(p.revenue) - n(p.paid);
      b.product_revenue_usd = n(p.revenue_usd); b.product_paid_usd = n(p.paid_usd);
      b.product_balance_usd = n(p.revenue_usd) - n(p.paid_usd);
    }
    const out = [...acc.values()].map(b => ({
      ...b,
      scroll_due_now: r2(b.scroll_due_now), scroll_due_total: r2(b.scroll_due_total),
      product_revenue: r2(b.product_revenue), product_paid: r2(b.product_paid),
      product_balance: r2(b.product_balance),
      product_revenue_usd: r2(b.product_revenue_usd), product_paid_usd: r2(b.product_paid_usd),
      product_balance_usd: r2(b.product_balance_usd),
      total_due_now: r2(b.scroll_due_now + b.product_balance),
      total_due_overall: r2(b.scroll_due_total + b.product_balance),
    })).sort((a, b) => b.total_due_now - a.total_due_now);
    res.json(out);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// ---------- סיכום חודשי ----------
router.get('/monthly', async (req, res) => {
  const year = parseInt(req.query.year, 10) || new Date().getFullYear();
  try {
    const q = (sql) => pool.query(sql, [year]);
    const [scrolls, prodSales, custPay, prodCustPay, scribePay, prodScribePay, bookExp, parchExp, bizExp] = await Promise.all([
      getScrolls(),
      q(`SELECT EXTRACT(MONTH FROM s.date)::int m, SUM(${SALE_TOTAL}) v, SUM(${SALE_TOTAL} - ${SALE_COST} - ${SALE_3PCT}) p,
                SUM(${SALE_TOTAL_U}) vu, SUM(${SALE_TOTAL_U} - ${SALE_COST_U} - ${SALE_3PCT_U}) pu
          FROM prod_sales s LEFT JOIN prod_purchases pp ON pp.id=s.purchase_id
          WHERE s.deleted=false AND EXTRACT(YEAR FROM s.date)=$1 GROUP BY 1`),
      q(`SELECT EXTRACT(MONTH FROM date)::int m, SUM(${PAID_TOTAL}) v FROM customer_payments WHERE deleted=false AND EXTRACT(YEAR FROM date)=$1 GROUP BY 1`),
      q(`SELECT EXTRACT(MONTH FROM date)::int m, SUM(${PPAID_ILS}) v, SUM(${PPAID_USD}) vu FROM prod_customer_payments WHERE deleted=false AND EXTRACT(YEAR FROM date)=$1 GROUP BY 1`),
      q('SELECT EXTRACT(MONTH FROM date)::int m, SUM(amount) v FROM scribe_payments WHERE deleted=false AND EXTRACT(YEAR FROM date)=$1 GROUP BY 1'),
      q(`SELECT EXTRACT(MONTH FROM date)::int m, SUM(${SPAID_ILS}) v, SUM(${SPAID_USD}) vu FROM prod_scribe_payments WHERE deleted=false AND EXTRACT(YEAR FROM date)=$1 GROUP BY 1`),
      q('SELECT EXTRACT(MONTH FROM date)::int m, SUM(amount) v FROM book_expenses WHERE deleted=false AND EXTRACT(YEAR FROM date)=$1 GROUP BY 1'),
      q(`SELECT EXTRACT(MONTH FROM e.date)::int m, SUM(e.quantity*COALESCE(z.cost_per_unit,0)) v
          FROM parchment_expenses e LEFT JOIN parchment_sizes z ON z.id=e.parchment_size_id
          WHERE e.deleted=false AND EXTRACT(YEAR FROM e.date)=$1 GROUP BY 1`),
      q('SELECT EXTRACT(MONTH FROM date)::int m, SUM(amount) v FROM business_expenses WHERE deleted=false AND EXTRACT(YEAR FROM date)=$1 GROUP BY 1'),
    ]);
    const pick = (rows, key = 'v') => { const m = {}; for (const r of rows.rows) m[r.m] = n(r[key]); return m; };
    const pSalesV = pick(prodSales), pSalesP = pick(prodSales, 'p');
    const pSalesVU = pick(prodSales, 'vu'), pSalesPU = pick(prodSales, 'pu');
    const cp = pick(custPay), pcp = pick(prodCustPay), sp = pick(scribePay), psp = pick(prodScribePay);
    const pcpU = pick(prodCustPay, 'vu'), pspU = pick(prodScribePay, 'vu');
    const be = pick(bookExp), pe = pick(parchExp), bz = pick(bizExp);

    // ס"ת: המכירה והרווח הצפוי נזקפים לחודש תאריך המכירה
    const scrollSales = {}, scrollProfit = {};
    for (const s of scrolls) {
      if (!s.sale_date) continue;
      const d = new Date(s.sale_date);
      if (d.getFullYear() !== year) continue;
      const m = d.getMonth() + 1;
      scrollSales[m] = (scrollSales[m] || 0) + n(s.buyer_total);
      scrollProfit[m] = (scrollProfit[m] || 0) + n(s.expected_profit);
    }

    const months = [];
    for (let m = 1; m <= 12; m++) {
      months.push({
        month: m,
        scroll_sales: r2(scrollSales[m] || 0),
        scroll_profit: r2(scrollProfit[m] || 0),
        product_sales: r2(pSalesV[m] || 0),
        product_profit: r2(pSalesP[m] || 0),
        received: r2((cp[m] || 0) + (pcp[m] || 0)),
        paid_scribes: r2((sp[m] || 0) + (psp[m] || 0)),
        book_expenses: r2((be[m] || 0) + (pe[m] || 0)),
        business_expenses: r2(bz[m] || 0),
        profit: r2((scrollProfit[m] || 0) + (pSalesP[m] || 0) - (bz[m] || 0)),
        // דולר בעמודות נפרדות — לעולם לא מחובר לשקלים
        product_sales_usd: r2(pSalesVU[m] || 0),
        product_profit_usd: r2(pSalesPU[m] || 0),
        received_usd: r2(pcpU[m] || 0),
        paid_scribes_usd: r2(pspU[m] || 0),
      });
    }
    const anyUsd = months.some(x => x.product_sales_usd || x.product_profit_usd
      || x.received_usd || x.paid_scribes_usd);
    res.json({ year, months, has_usd: anyUsd });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// ---------- מלאי מוצרים ----------
router.get('/inventory', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT pp.*, p.name AS product_name,
        sc.name AS scribe_name,
        COALESCE(sd.sold,0) AS sold_qty,
        (pp.quantity - COALESCE(sd.sold,0)) AS remaining_qty,
        COALESCE(pp.currency,'ILS') AS currency,
        (pp.cost_per_unit + pp.extra_cost_per_unit) AS unit_cost,
        ((pp.quantity - COALESCE(sd.sold,0)) * (pp.cost_per_unit + pp.extra_cost_per_unit)) AS stock_value
      FROM prod_purchases pp
      LEFT JOIN products p  ON p.id  = pp.product_id
      LEFT JOIN contacts sc ON sc.id = pp.scribe_id
      LEFT JOIN (SELECT purchase_id, SUM(quantity) sold FROM prod_sales WHERE deleted=false GROUP BY purchase_id) sd
        ON sd.purchase_id = pp.id
      WHERE pp.deleted=false
      ORDER BY remaining_qty DESC, pp.date DESC NULLS LAST`);
    const val = (cur) => r2(r.rows.reduce((a, x) =>
      a + ((x.currency || 'ILS') === cur ? n(x.stock_value) : 0), 0));
    res.json({
      rows: r.rows,
      total_units: r.rows.reduce((a, x) => a + n(x.remaining_qty), 0),
      total_value: val('ILS'),
      total_value_usd: val('USD'),
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// ---------- כרטיס סופר (מאוחד) ----------
router.get('/scribe/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const [contact, scrolls, purchases, payments] = await Promise.all([
      pool.query('SELECT * FROM contacts WHERE id=$1', [id]),
      getScrolls({ scribe_id: id }),
      pool.query(`SELECT pp.*, p.name AS product_name,
                    COALESCE(sd.sold,0) AS sold_qty,
                    (pp.quantity - COALESCE(sd.sold,0)) AS remaining_qty,
                    COALESCE(pp.currency,'ILS') AS currency,
                    (pp.quantity * pp.cost_per_unit) AS owed
                  FROM prod_purchases pp
                  LEFT JOIN products p ON p.id=pp.product_id
                  LEFT JOIN (SELECT purchase_id, SUM(quantity) sold FROM prod_sales WHERE deleted=false GROUP BY purchase_id) sd
                    ON sd.purchase_id=pp.id
                  WHERE pp.scribe_id=$1 AND pp.deleted=false ORDER BY pp.date DESC NULLS LAST`, [id]),
      pool.query('SELECT * FROM prod_scribe_payments WHERE scribe_id=$1 AND deleted=false ORDER BY date DESC NULLS LAST', [id]),
    ]);
    if (!contact.rows.length) return res.status(404).json({ error: 'איש הקשר לא נמצא' });
    const c = contact.rows[0];
    // סכימה לפי מטבע — סכום אחד לשני מטבעות היה מספר חסר משמעות
    const byCur = (rows, key, cur) => r2(rows.reduce((a, x) =>
      a + ((x.currency || 'ILS') === cur ? n(x[key]) : 0), 0));
    const prodOwed = byCur(purchases.rows, 'owed', 'ILS');
    const prodPaid = byCur(payments.rows, 'amount', 'ILS');
    const prodOwedU = byCur(purchases.rows, 'owed', 'USD');
    const prodPaidU = byCur(payments.rows, 'amount', 'USD');
    const scrollBalance = sum(scrolls, 'scribe_balance');
    res.json({
      contact: c,
      scrolls,
      scroll_totals: {
        count: scrolls.length,
        book_price: sum(scrolls, 'scribe_book_price'),
        due_progress: sum(scrolls, 'scribe_due_progress'),
        paid: sum(scrolls, 'scribe_paid'),
        corrections: sum(scrolls, 'corrections_paid'),
        balance: scrollBalance,
        future_balance: sum(scrolls, 'scribe_future_balance'),
      },
      purchases: purchases.rows,
      product_payments: payments.rows,
      product_totals: {
        owed: prodOwed, paid: prodPaid, balance: r2(prodOwed - prodPaid),
        owed_usd: prodOwedU, paid_usd: prodPaidU, balance_usd: r2(prodOwedU - prodPaidU),
      },
      total_balance: r2(scrollBalance + prodOwed - prodPaid),
      total_balance_usd: r2(prodOwedU - prodPaidU),
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// ---------- כרטיס רוכש (מאוחד) ----------
router.get('/customer/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const [contact, scrolls, scrollPays, sales, prodPays] = await Promise.all([
      pool.query('SELECT * FROM contacts WHERE id=$1', [id]),
      getScrolls({ customer_id: id }),
      pool.query(`SELECT cp.*, ${PAID_TOTAL} AS paid_actual, ${PERITAH} AS peritah
                  FROM customer_payments cp WHERE customer_id=$1 AND deleted=false
                  ORDER BY date DESC NULLS LAST`, [id]),
      pool.query(`SELECT s.*, p.name AS product_name,
                    sc.name AS scribe_name,
                    COALESCE(s.currency,'ILS') AS currency,
                    COALESCE(pp.currency,'ILS') AS purchase_currency,
                    ${RAW_SALE_TOTAL} AS total_sale,
                    (CASE WHEN ${CUR_S} = ${CUR_PP}
                          THEN ${RAW_SALE_TOTAL} - ${RAW_SALE_COST} - ${RAW_SALE_3PCT} END) AS total_profit
                  FROM prod_sales s
                  LEFT JOIN prod_purchases pp ON pp.id=s.purchase_id
                  LEFT JOIN products p ON p.id=pp.product_id
                  LEFT JOIN contacts sc ON sc.id=pp.scribe_id
                  WHERE s.customer_id=$1 AND s.deleted=false ORDER BY s.date DESC NULLS LAST`, [id]),
      pool.query(`SELECT *, COALESCE(currency,'ILS') AS currency,
                    (CASE WHEN ${CUR_ROW}='USD' THEN COALESCE(amount_usd,0)
                          ELSE COALESCE(amount_ils,0) + COALESCE(amount_usd,0)*COALESCE(rate,0) END) AS paid_actual,
                    ${PPERITAH} AS peritah
                  FROM prod_customer_payments WHERE customer_id=$1 AND deleted=false
                  ORDER BY date DESC NULLS LAST`, [id]),
    ]);
    if (!contact.rows.length) return res.status(404).json({ error: 'איש הקשר לא נמצא' });
    const c = contact.rows[0];
    // סכימה לפי מטבע השורה — ערבוב שקלים ודולרים היה נותן מספר חסר משמעות
    const byCur = (rows, key, cur) => r2(rows.reduce((a, x) =>
      a + ((x.currency || 'ILS') === cur ? n(x[key]) : 0), 0));
    const prodRevenue = byCur(sales.rows, 'total_sale', 'ILS');
    const prodPaid = byCur(prodPays.rows, 'paid_actual', 'ILS');
    const prodRevenueU = byCur(sales.rows, 'total_sale', 'USD');
    const prodPaidU = byCur(prodPays.rows, 'paid_actual', 'USD');
    res.json({
      contact: c,
      scrolls,
      scroll_payments: scrollPays.rows,
      scroll_totals: {
        count: scrolls.length,
        total_price: sum(scrolls, 'buyer_total'),
        due_progress: sum(scrolls, 'buyer_due_progress'),
        paid: sum(scrolls, 'customer_paid'),
        peritah: sum(scrolls, 'peritah_cost'),
        balance_now: sum(scrolls, 'buyer_balance_now'),
        balance_total: sum(scrolls, 'buyer_balance_total'),
      },
      sales: sales.rows,
      product_payments: prodPays.rows,
      product_totals: {
        revenue: prodRevenue, paid: prodPaid,
        balance: r2(prodRevenue - prodPaid),
        peritah: sum(prodPays.rows, 'peritah'),
        revenue_usd: prodRevenueU, paid_usd: prodPaidU,
        balance_usd: r2(prodRevenueU - prodPaidU),
      },
      total_due_now: r2(sum(scrolls, 'buyer_balance_now') + prodRevenue - prodPaid),
      total_due_overall: r2(sum(scrolls, 'buyer_balance_total') + prodRevenue - prodPaid),
      total_due_usd: r2(prodRevenueU - prodPaidU),
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
