// ===== דוחות =====
// כאן נפגשות שתי המערכות: ס"ת (calc.js) ומוצרים (SQL כאן).
// דוחות הסופר והרוכש מאחדים את שתיהן — זו נקודת החיבור היחידה ביניהן.
const express = require('express');
const { pool } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const { getScrolls, n, r2 } = require('../calc');
const router = express.Router();

router.use(authenticate, can('viewReports'));

// ביטויי הרווח של מכירת מוצר, לשימוש חוזר בשאילתות
const SALE_TOTAL = '(s.quantity * s.price_per_unit)';
const SALE_COST  = '(s.quantity * (COALESCE(pp.cost_per_unit,0) + COALESCE(pp.extra_cost_per_unit,0)))';
const SALE_3PCT  = '(CASE WHEN s.deduct_3pct THEN s.quantity * s.price_per_unit * 0.03 ELSE 0 END)';
const PERITAH    = '(CASE WHEN amount_usd > 0 THEN amount_usd * rate - cash_in_hand ELSE 0 END)';
const PAID_TOTAL = '(amount_ils + amount_usd * rate)';

const sum = (rows, key) => r2(rows.reduce((a, x) => a + n(x[key]), 0));

// סיכומי מערכת המוצרים
async function prodTotals() {
  const [sales, purch, scribePaid, custPaid] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(${SALE_TOTAL}),0) AS revenue,
                       COALESCE(SUM(${SALE_COST}),0)  AS cost,
                       COALESCE(SUM(${SALE_3PCT}),0)  AS deduct
                FROM prod_sales s
                LEFT JOIN prod_purchases pp ON pp.id = s.purchase_id
                WHERE s.deleted=false`),
    pool.query(`SELECT COALESCE(SUM(quantity * cost_per_unit),0) AS owed
                FROM prod_purchases WHERE deleted=false`),
    pool.query('SELECT COALESCE(SUM(amount),0) AS paid FROM prod_scribe_payments WHERE deleted=false'),
    pool.query(`SELECT COALESCE(SUM(${PAID_TOTAL}),0) AS paid, COALESCE(SUM(${PERITAH}),0) AS peritah
                FROM prod_customer_payments WHERE deleted=false`),
  ]);
  const revenue = n(sales.rows[0].revenue), cost = n(sales.rows[0].cost), deduct = n(sales.rows[0].deduct);
  return {
    revenue: r2(revenue),
    cost: r2(cost),
    deduct_3pct: r2(deduct),
    profit: r2(revenue - cost - deduct),
    owed_scribes: r2(n(purch.rows[0].owed) - n(scribePaid.rows[0].paid)),
    customer_paid: r2(n(custPaid.rows[0].paid)),
    customer_owes: r2(revenue - n(custPaid.rows[0].paid)),
    peritah: r2(n(custPaid.rows[0].peritah)),
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
          COALESCE(pa.paid,0) AS paid
        FROM contacts c
        LEFT JOIN (SELECT scribe_id, SUM(quantity*cost_per_unit) owed FROM prod_purchases WHERE deleted=false GROUP BY scribe_id) pu ON pu.scribe_id=c.id
        LEFT JOIN (SELECT scribe_id, SUM(amount) paid FROM prod_scribe_payments WHERE deleted=false GROUP BY scribe_id) pa ON pa.scribe_id=c.id
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
    }
    const out = [...acc.values()].map(b => ({
      ...b,
      scroll_balance: r2(b.scroll_balance), scroll_future: r2(b.scroll_future),
      product_owed: r2(b.product_owed), product_paid: r2(b.product_paid),
      product_balance: r2(b.product_balance),
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
        SELECT c.id, COALESCE(sl.revenue,0) AS revenue, COALESCE(pm.paid,0) AS paid
        FROM contacts c
        LEFT JOIN (SELECT s.customer_id, SUM(${SALE_TOTAL}) revenue
                   FROM prod_sales s LEFT JOIN prod_purchases pp ON pp.id=s.purchase_id
                   WHERE s.deleted=false GROUP BY s.customer_id) sl ON sl.customer_id=c.id
        LEFT JOIN (SELECT customer_id, SUM(${PAID_TOTAL}) paid FROM prod_customer_payments WHERE deleted=false GROUP BY customer_id) pm ON pm.customer_id=c.id
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
    }
    const out = [...acc.values()].map(b => ({
      ...b,
      scroll_due_now: r2(b.scroll_due_now), scroll_due_total: r2(b.scroll_due_total),
      product_revenue: r2(b.product_revenue), product_paid: r2(b.product_paid),
      product_balance: r2(b.product_balance),
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
      q(`SELECT EXTRACT(MONTH FROM s.date)::int m, SUM(${SALE_TOTAL}) v, SUM(${SALE_TOTAL} - ${SALE_COST} - ${SALE_3PCT}) p
          FROM prod_sales s LEFT JOIN prod_purchases pp ON pp.id=s.purchase_id
          WHERE s.deleted=false AND EXTRACT(YEAR FROM s.date)=$1 GROUP BY 1`),
      q(`SELECT EXTRACT(MONTH FROM date)::int m, SUM(${PAID_TOTAL}) v FROM customer_payments WHERE deleted=false AND EXTRACT(YEAR FROM date)=$1 GROUP BY 1`),
      q(`SELECT EXTRACT(MONTH FROM date)::int m, SUM(${PAID_TOTAL}) v FROM prod_customer_payments WHERE deleted=false AND EXTRACT(YEAR FROM date)=$1 GROUP BY 1`),
      q('SELECT EXTRACT(MONTH FROM date)::int m, SUM(amount) v FROM scribe_payments WHERE deleted=false AND EXTRACT(YEAR FROM date)=$1 GROUP BY 1'),
      q('SELECT EXTRACT(MONTH FROM date)::int m, SUM(amount) v FROM prod_scribe_payments WHERE deleted=false AND EXTRACT(YEAR FROM date)=$1 GROUP BY 1'),
      q('SELECT EXTRACT(MONTH FROM date)::int m, SUM(amount) v FROM book_expenses WHERE deleted=false AND EXTRACT(YEAR FROM date)=$1 GROUP BY 1'),
      q(`SELECT EXTRACT(MONTH FROM e.date)::int m, SUM(e.quantity*COALESCE(z.cost_per_unit,0)) v
          FROM parchment_expenses e LEFT JOIN parchment_sizes z ON z.id=e.parchment_size_id
          WHERE e.deleted=false AND EXTRACT(YEAR FROM e.date)=$1 GROUP BY 1`),
      q('SELECT EXTRACT(MONTH FROM date)::int m, SUM(amount) v FROM business_expenses WHERE deleted=false AND EXTRACT(YEAR FROM date)=$1 GROUP BY 1'),
    ]);
    const pick = (rows, key = 'v') => { const m = {}; for (const r of rows.rows) m[r.m] = n(r[key]); return m; };
    const pSalesV = pick(prodSales), pSalesP = pick(prodSales, 'p');
    const cp = pick(custPay), pcp = pick(prodCustPay), sp = pick(scribePay), psp = pick(prodScribePay);
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
      });
    }
    res.json({ year, months });
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
        (pp.cost_per_unit + pp.extra_cost_per_unit) AS unit_cost,
        ((pp.quantity - COALESCE(sd.sold,0)) * (pp.cost_per_unit + pp.extra_cost_per_unit)) AS stock_value
      FROM prod_purchases pp
      LEFT JOIN products p  ON p.id  = pp.product_id
      LEFT JOIN contacts sc ON sc.id = pp.scribe_id
      LEFT JOIN (SELECT purchase_id, SUM(quantity) sold FROM prod_sales WHERE deleted=false GROUP BY purchase_id) sd
        ON sd.purchase_id = pp.id
      WHERE pp.deleted=false
      ORDER BY remaining_qty DESC, pp.date DESC NULLS LAST`);
    res.json({
      rows: r.rows,
      total_units: r.rows.reduce((a, x) => a + n(x.remaining_qty), 0),
      total_value: r2(r.rows.reduce((a, x) => a + n(x.stock_value), 0)),
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
    const prodOwed = sum(purchases.rows, 'owed');
    const prodPaid = sum(payments.rows, 'amount');
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
      product_totals: { owed: prodOwed, paid: prodPaid, balance: r2(prodOwed - prodPaid) },
      total_balance: r2(scrollBalance + prodOwed - prodPaid),
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
                    ${SALE_TOTAL} AS total_sale,
                    (${SALE_TOTAL} - ${SALE_COST} - ${SALE_3PCT}) AS total_profit
                  FROM prod_sales s
                  LEFT JOIN prod_purchases pp ON pp.id=s.purchase_id
                  LEFT JOIN products p ON p.id=pp.product_id
                  WHERE s.customer_id=$1 AND s.deleted=false ORDER BY s.date DESC NULLS LAST`, [id]),
      pool.query(`SELECT *, ${PAID_TOTAL} AS paid_actual, ${PERITAH} AS peritah
                  FROM prod_customer_payments WHERE customer_id=$1 AND deleted=false
                  ORDER BY date DESC NULLS LAST`, [id]),
    ]);
    if (!contact.rows.length) return res.status(404).json({ error: 'איש הקשר לא נמצא' });
    const c = contact.rows[0];
    const prodRevenue = sum(sales.rows, 'total_sale');
    const prodPaid = sum(prodPays.rows, 'paid_actual');
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
      },
      total_due_now: r2(sum(scrolls, 'buyer_balance_now') + prodRevenue - prodPaid),
      total_due_overall: r2(sum(scrolls, 'buyer_balance_total') + prodRevenue - prodPaid),
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
