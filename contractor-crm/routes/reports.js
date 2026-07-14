const express = require('express');
const { pool } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const router = express.Router();

// GET /api/reports/overview - סיכום ראשי לדשבורד
router.get('/overview', authenticate, can('viewReports'), async (req, res) => {
  try {
    const projects = await pool.query(`
      SELECT p.id, p.name, p.status, p.expected_profit::float AS expected_profit,
        COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.project_id=p.id AND t.type='client_payment'  AND t.deleted=false),0)::float AS income,
        COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.project_id=p.id AND t.type='sub_payment'     AND t.deleted=false),0)::float AS sub_paid,
        COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.project_id=p.id AND t.type='project_expense' AND t.deleted=false),0)::float AS project_expenses,
        COALESCE((SELECT SUM(client_amount) FROM stages s WHERE s.project_id=p.id AND s.deleted=false),0)::float AS planned_income,
        COALESCE((SELECT SUM(sub_amount)    FROM stages s WHERE s.project_id=p.id AND s.deleted=false),0)::float AS planned_sub
      FROM projects p WHERE p.deleted=false ORDER BY p.created_at DESC`);

    let totExpected = 0, totActual = 0, totIncome = 0, totOpen = 0, active = 0;
    let totPlannedIncome = 0, totSubPaid = 0, totPlannedSub = 0, totOpenSub = 0;
    const rows = projects.rows.map(p => {
      const actual = p.income - p.sub_paid - p.project_expenses;
      const open = Math.max(0, p.planned_income - p.income);       // עוד צפוי להיכנס מהלקוח
      const openSub = Math.max(0, p.planned_sub - p.sub_paid);     // עוד צריך לשלם לקבלן
      totExpected += p.expected_profit; totActual += actual; totIncome += p.income; totOpen += open;
      totPlannedIncome += p.planned_income; totSubPaid += p.sub_paid; totPlannedSub += p.planned_sub; totOpenSub += openSub;
      if (p.status === 'active') active++;
      return {
        id: p.id, name: p.name, status: p.status,
        planned_income: p.planned_income, income: p.income,               // מחיר ללקוח, שילם
        planned_sub: p.planned_sub, sub_paid: p.sub_paid,                 // מחיר לקבלן, שולם
        project_expenses: p.project_expenses,                             // הוצאות לפרויקט
        expected_profit: p.expected_profit, actual_profit: actual, profit_gap: actual - p.expected_profit
      };
    });

    const bizExp = await pool.query(`SELECT COALESCE(SUM(amount),0)::float AS s FROM transactions WHERE type='business_expense' AND deleted=false`);
    res.json({
      projects_total: projects.rows.length,
      projects_active: active,
      total_expected_profit: totExpected,
      total_actual_profit: totActual,
      total_income: totIncome,
      total_planned_income: totPlannedIncome,
      total_sub_paid: totSubPaid,
      total_planned_sub: totPlannedSub,
      total_open_client: totOpen,
      total_open_sub: totOpenSub,
      future_profit: totOpen - totOpenSub,
      total_business_expenses: bizExp.rows[0].s,
      net_business: totActual - bizExp.rows[0].s,
      per_project: rows
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// GET /api/reports/project/:id - דוח פרויקט מלא
router.get('/project/:id', authenticate, can('viewReports'), async (req, res) => {
  try {
    const pr = await pool.query('SELECT * FROM projects WHERE id=$1 AND deleted=false', [req.params.id]);
    if (!pr.rows.length) return res.status(404).json({ error: 'פרויקט לא נמצא' });
    const p = pr.rows[0];

    const stages = await pool.query(`
      SELECT s.id, s.name, s.seq, s.client_amount::float, s.sub_amount::float, s.status, s.approved,
        sc.name AS subcontractor_name,
        COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.stage_id=s.id AND t.type='client_payment' AND t.deleted=false),0)::float AS paid_in,
        COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.stage_id=s.id AND t.type='sub_payment'    AND t.deleted=false),0)::float AS paid_sub
      FROM stages s LEFT JOIN subcontractors sc ON sc.id=s.subcontractor_id AND sc.deleted=false
      WHERE s.project_id=$1 AND s.deleted=false ORDER BY s.seq, s.id`, [req.params.id]);

    const agg = await pool.query(`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE type='client_payment'),0)::float  AS income,
        COALESCE(SUM(amount) FILTER (WHERE type='sub_payment'),0)::float      AS sub_paid,
        COALESCE(SUM(amount) FILTER (WHERE type='project_expense'),0)::float  AS project_expenses
      FROM transactions WHERE project_id=$1 AND deleted=false`, [req.params.id]);
    const a = agg.rows[0];

    const projExpenses = await pool.query(`
      SELECT id, date, amount::float, supplier, purpose, invoice_url, note
      FROM transactions WHERE project_id=$1 AND type='project_expense' AND deleted=false ORDER BY date DESC NULLS LAST, id DESC`, [req.params.id]);

    const actual_profit = a.income - a.sub_paid - a.project_expenses;
    res.json({
      project: p,
      stages: stages.rows,
      totals: {
        income: a.income, sub_paid: a.sub_paid, project_expenses: a.project_expenses,
        expected_profit: parseFloat(p.expected_profit) || 0,
        actual_profit,
        profit_gap: actual_profit - (parseFloat(p.expected_profit) || 0),
        planned_income: stages.rows.reduce((s, r) => s + r.client_amount, 0),
        planned_sub: stages.rows.reduce((s, r) => s + r.sub_amount, 0)
      },
      project_expenses: projExpenses.rows
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// GET /api/reports/monthly?from=&to= - דוח עסק חודשי
router.get('/monthly', authenticate, can('viewReports'), async (req, res) => {
  const { from, to } = req.query;
  const where = ['deleted=false'];       // ללא alias (טבלה בודדת)
  const whereT = ['t.deleted=false'];    // עם alias t (ל-JOIN)
  const params = [];
  if (from) { params.push(from); where.push(`date>=$${params.length}`); whereT.push(`t.date>=$${params.length}`); }
  if (to)   { params.push(to);   where.push(`date<=$${params.length}`); whereT.push(`t.date<=$${params.length}`); }
  const w = where.join(' AND ');
  const wt = whereT.join(' AND ');
  try {
    const totals = await pool.query(`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE type='client_payment'),0)::float  AS income,
        COALESCE(SUM(amount) FILTER (WHERE type='sub_payment'),0)::float      AS sub_paid,
        COALESCE(SUM(amount) FILTER (WHERE type='project_expense'),0)::float  AS project_expenses,
        COALESCE(SUM(amount) FILTER (WHERE type='business_expense'),0)::float AS business_expenses
      FROM transactions WHERE ${w}`, params);
    const t = totals.rows[0];
    t.net = t.income - t.sub_paid - t.project_expenses - t.business_expenses;

    const byMonth = await pool.query(`
      SELECT to_char(date_trunc('month', date),'YYYY-MM') AS month,
        COALESCE(SUM(amount) FILTER (WHERE type='client_payment'),0)::float  AS income,
        COALESCE(SUM(amount) FILTER (WHERE type IN ('sub_payment','project_expense','business_expense')),0)::float AS expenses
      FROM transactions WHERE ${w} AND date IS NOT NULL
      GROUP BY 1 ORDER BY 1`, params);

    const byProject = await pool.query(`
      SELECT p.id AS project_id, p.name AS project_name,
        COALESCE(SUM(t.amount) FILTER (WHERE t.type='client_payment'),0)::float AS income,
        COALESCE(SUM(t.amount) FILTER (WHERE t.type IN ('sub_payment','project_expense')),0)::float AS cost
      FROM transactions t JOIN projects p ON p.id=t.project_id AND p.deleted=false
      WHERE ${wt} AND t.project_id IS NOT NULL
      GROUP BY p.id, p.name ORDER BY income DESC`, params);

    const bizList = await pool.query(`
      SELECT id, date, amount::float, supplier, purpose, note
      FROM transactions WHERE type='business_expense' AND ${w} ORDER BY date DESC NULLS LAST, id DESC`, params);

    res.json({ totals: t, by_month: byMonth.rows, by_project: byProject.rows, business_expenses: bizList.rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// GET /api/reports/home?from=&to= - דוח בית
router.get('/home', authenticate, can('home'), async (req, res) => {
  const { from, to } = req.query;
  const where = ['deleted=false']; const params = [];
  if (from) { params.push(from); where.push(`date>=$${params.length}`); }
  if (to)   { params.push(to);   where.push(`date<=$${params.length}`); }
  const w = where.join(' AND ');
  try {
    const totals = await pool.query(`
      SELECT COALESCE(SUM(amount) FILTER (WHERE direction='in'),0)::float AS income,
             COALESCE(SUM(amount) FILTER (WHERE direction='out'),0)::float AS expenses
      FROM home_transactions WHERE ${w}`, params);
    const t = totals.rows[0]; t.balance = t.income - t.expenses;

    const byCategory = await pool.query(`
      SELECT COALESCE(category,'ללא קטגוריה') AS category, COALESCE(SUM(amount),0)::float AS total
      FROM home_transactions WHERE ${w} AND direction='out'
      GROUP BY 1 ORDER BY total DESC`, params);

    const byMonth = await pool.query(`
      SELECT to_char(date_trunc('month', date),'YYYY-MM') AS month,
        COALESCE(SUM(amount) FILTER (WHERE direction='in'),0)::float AS income,
        COALESCE(SUM(amount) FILTER (WHERE direction='out'),0)::float AS expenses
      FROM home_transactions WHERE ${w} AND date IS NOT NULL GROUP BY 1 ORDER BY 1`, params);

    res.json({ totals: t, by_category: byCategory.rows, by_month: byMonth.rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
