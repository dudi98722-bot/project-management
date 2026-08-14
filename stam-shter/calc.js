// ===== מנוע החישובים של מערכת ס"ת =====
// מרכז את כל הנוסחאות שבאפיון במקום אחד, כדי שהלשונית והדוחות
// ישתמשו באותו חישוב בדיוק ולא ייווצרו שתי אמיתות.

const { pool } = require('./db');

// שאילתה אחת שמושכת כל ספר יחד עם הסכומים מכל היומנים.
// כל תת-שאילתה מסכמת טבלת בן אחת, כדי שלא ייווצר כפל שורות בצירוף.
const SCROLL_SQL = `
SELECT s.*,
  p.name  AS product_name,
  COALESCE(p.pages,0)           AS product_pages,
  COALESCE(p.parchment_units,0) AS product_parchment_units,
  COALESCE(p.fixed_expense,0)   AS product_fixed_expense,
  ps.name AS size_name,
  COALESCE(ps.cost_per_unit,0)  AS size_cost_per_unit,
  sc.name AS scribe_name,
  cu.name AS customer_name,
  COALESCE(pg.pages_written, 0)  AS pages_written,
  COALESCE(sp.paid, 0)           AS scribe_paid,
  COALESCE(be.corrections, 0)    AS corrections_paid,
  COALESCE(be.other_expenses, 0) AS book_expenses,
  COALESCE(pe.parchment_actual,0) AS parchment_actual,
  COALESCE(cp.paid, 0)           AS customer_paid,
  COALESCE(cp.peritah, 0)        AS peritah_cost
FROM scrolls s
LEFT JOIN products        p  ON p.id  = s.product_id
LEFT JOIN parchment_sizes ps ON ps.id = s.parchment_size_id
LEFT JOIN contacts        sc ON sc.id = s.scribe_id
LEFT JOIN contacts        cu ON cu.id = s.customer_id
LEFT JOIN (
  SELECT scroll_id, SUM(pages) AS pages_written
  FROM pages_log WHERE deleted=false GROUP BY scroll_id
) pg ON pg.scroll_id = s.id
LEFT JOIN (
  SELECT scroll_id, SUM(amount) AS paid
  FROM scribe_payments WHERE deleted=false GROUP BY scroll_id
) sp ON sp.scroll_id = s.id
LEFT JOIN (
  -- סוג ההוצאה מנתב: המסומן כ"תיקונים" נזקף לצד הסופר, השאר הוצאות לספר
  SELECT b.scroll_id,
    SUM(CASE WHEN li.is_correction THEN b.amount ELSE 0 END) AS corrections,
    SUM(CASE WHEN li.is_correction THEN 0 ELSE b.amount END) AS other_expenses
  FROM book_expenses b
  LEFT JOIN list_items li
    ON li.list_name='expense_book' AND li.value = b.type AND li.deleted=false
  WHERE b.deleted=false GROUP BY b.scroll_id
) be ON be.scroll_id = s.id
LEFT JOIN (
  SELECT e.scroll_id, SUM(e.quantity * COALESCE(z.cost_per_unit,0)) AS parchment_actual
  FROM parchment_expenses e
  LEFT JOIN parchment_sizes z ON z.id = e.parchment_size_id
  WHERE e.deleted=false GROUP BY e.scroll_id
) pe ON pe.scroll_id = s.id
LEFT JOIN (
  -- COALESCE על כל רכיב: NULL באחד השדות היה מעלים את התשלום כולו מהסכום
  SELECT scroll_id,
    SUM(COALESCE(amount_ils,0) + COALESCE(amount_usd,0) * COALESCE(rate,0)) AS paid,
    SUM(CASE WHEN COALESCE(amount_usd,0) > 0
        THEN COALESCE(amount_usd,0) * COALESCE(rate,0) - COALESCE(cash_in_hand,0) ELSE 0 END) AS peritah
  FROM customer_payments WHERE deleted=false GROUP BY scroll_id
) cp ON cp.scroll_id = s.id
WHERE s.deleted = false`;

const n = (v) => (v === null || v === undefined || isNaN(v)) ? 0 : Number(v);
const r2 = (v) => Math.round(n(v) * 100) / 100;

// מחיל את נוסחאות האפיון על שורה גולמית מהשאילתה למעלה
function computeScroll(row) {
  const pages      = n(row.product_pages);
  const pageRate   = n(row.page_rate);
  const written    = n(row.pages_written);
  const buyerTotal = n(row.buyer_total);

  // --- צד סופר ---
  const scribeBookPrice   = r2(pageRate * pages);            // מחיר לספר (מלא)
  const scribeDueProgress = r2(written * pageRate);          // סך לתשלום לפי התקדמות
  const scribePaid        = r2(row.scribe_paid);
  const corrections       = r2(row.corrections_paid);
  const scribeBalance     = r2(scribeDueProgress - scribePaid - corrections);
  const pagesOpen         = Math.max(0, pages - written);
  const scribeFuture      = r2(pagesOpen * pageRate);        // יתרה עתידית לפי עמודים פתוחים

  // --- צד רוכש ---
  const buyerPageRate     = pages > 0 ? buyerTotal / pages : 0;
  const buyerDueProgress  = r2(written * buyerPageRate);
  const customerPaid      = r2(row.customer_paid);
  const buyerBalanceNow   = r2(buyerDueProgress - customerPaid);
  const buyerBalanceTotal = r2(buyerTotal - customerPaid);

  // --- כללי ---
  const parchmentExpected = r2(n(row.product_parchment_units) * n(row.size_cost_per_unit));
  const parchmentActual   = r2(row.parchment_actual);
  const peritah           = r2(row.peritah_cost);
  const fixedExpense      = r2(row.product_fixed_expense);
  const bookExpenses      = r2(row.book_expenses);

  // רווח צפוי — משתמש בצפי הקלף (לא בעלות בפועל), לפי האפיון.
  // ספר שטרם נמכר (אין רוכש או שלא נקבע מחיר) אינו מציג הפסד על העלויות
  // שנצברו: זה ייראה כהפסד אמיתי ויעוות גם את הסיכומים. הרווח שלו 0
  // עד שייקבע רוכש ומחיר.
  const sold = !!row.customer_id && buyerTotal > 0;
  const expectedProfit = sold ? r2(
    buyerTotal - scribeBookPrice - peritah - fixedExpense - bookExpenses - parchmentExpected
  ) : 0;

  return Object.assign({}, row, {
    pages_written: written,
    pages_open: pagesOpen,
    progress_pct: pages > 0 ? Math.round((written / pages) * 100) : 0,
    // צד סופר
    scribe_book_price: scribeBookPrice,
    scribe_due_progress: scribeDueProgress,
    scribe_paid: scribePaid,
    corrections_paid: corrections,
    scribe_balance: scribeBalance,
    scribe_future_balance: scribeFuture,
    // צד רוכש
    buyer_page_rate: r2(buyerPageRate),
    buyer_due_progress: buyerDueProgress,
    customer_paid: customerPaid,
    buyer_balance_now: buyerBalanceNow,
    buyer_balance_total: buyerBalanceTotal,
    // כללי
    parchment_expected: parchmentExpected,
    parchment_actual: parchmentActual,
    peritah_cost: peritah,
    fixed_expense: fixedExpense,
    book_expenses: bookExpenses,
    expected_profit: expectedProfit,
    sold,
  });
}

// כל הספרים המחושבים (עם סינון אופציונלי)
async function getScrolls(filter = {}) {
  const where = []; const vals = [];
  if (filter.scribe_id)   { vals.push(filter.scribe_id);   where.push(`s.scribe_id   = $${vals.length}`); }
  if (filter.customer_id) { vals.push(filter.customer_id); where.push(`s.customer_id = $${vals.length}`); }
  if (filter.id)          { vals.push(filter.id);          where.push(`s.id          = $${vals.length}`); }
  if (filter.status)      { vals.push(filter.status);      where.push(`s.status      = $${vals.length}`); }
  const sql = SCROLL_SQL + (where.length ? ' AND ' + where.join(' AND ') : '') +
              ' ORDER BY s.sale_date DESC NULLS LAST, s.id DESC';
  const res = await pool.query(sql, vals);
  return res.rows.map(computeScroll);
}

async function getScroll(id) {
  const rows = await getScrolls({ id });
  return rows[0] || null;
}

module.exports = { getScrolls, getScroll, computeScroll, n, r2 };
