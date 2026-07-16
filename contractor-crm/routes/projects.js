const express = require('express');
const { pool, logAction, softDeleteProject } = require('../db');
const sheets = require('../sheets');
const { authenticate, can, canAny } = require('../middleware/auth');
const router = express.Router();

// חישוב סיכום כספי לפרויקט (בתוך שאילתה)
const SUMMARY_COLS = `
  COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.project_id=p.id AND t.type='client_payment'   AND t.deleted=false),0)::float AS income,
  COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.project_id=p.id AND t.type='sub_payment'      AND t.deleted=false),0)::float AS sub_paid,
  COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.project_id=p.id AND t.type='project_expense'  AND t.deleted=false),0)::float AS project_expenses,
  COALESCE((SELECT SUM(client_amount) FROM stages s WHERE s.project_id=p.id AND s.deleted=false),0)::float AS planned_income,
  COALESCE((SELECT SUM(sub_amount)    FROM stages s WHERE s.project_id=p.id AND s.deleted=false),0)::float AS planned_sub,
  (SELECT name FROM subcontractors sc WHERE sc.id=p.subcontractor_id AND sc.deleted=false) AS subcontractor_name
`;

function withProfit(row) {
  row.expected_profit = parseFloat(row.expected_profit) || 0;
  row.actual_profit = (row.income || 0) - (row.sub_paid || 0) - (row.project_expenses || 0);
  row.profit_gap = row.actual_profit - row.expected_profit;      // חריגה/עודף מול היעד
  row.planned_profit = (row.planned_income || 0) - (row.planned_sub || 0);
  return row;
}

// GET /api/projects - רשימה עם סיכום כספי חי
router.get('/', authenticate, can('viewBusiness'), async (req, res) => {
  try {
    const r = await pool.query(`SELECT p.*, ${SUMMARY_COLS} FROM projects p WHERE p.deleted=false ORDER BY p.created_at DESC`);
    res.json(r.rows.map(withProfit));
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// GET /api/projects/list - שמות פרויקטים בלבד (לבחירה ע"י עובד שטח / מדווח)
router.get('/list', authenticate, canAny(['viewBusiness', 'writeTx', 'projectExpenseOnly']), async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, name, client_name FROM projects WHERE deleted=false AND status<>'done' ORDER BY name`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

// GET /api/projects/:id - פרויקט + שלבים + סיכום
router.get('/:id', authenticate, can('viewBusiness'), async (req, res) => {
  try {
    const pr = await pool.query(`SELECT p.*, ${SUMMARY_COLS} FROM projects p WHERE p.id=$1 AND p.deleted=false`, [req.params.id]);
    if (!pr.rows.length) return res.status(404).json({ error: 'פרויקט לא נמצא' });
    const stages = await pool.query(
      `SELECT s.*, sc.name AS subcontractor_name,
         COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.stage_id=s.id AND t.type='client_payment' AND t.deleted=false),0)::float AS paid_in,
         COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.stage_id=s.id AND t.type='sub_payment'    AND t.deleted=false),0)::float AS paid_sub
       FROM stages s LEFT JOIN subcontractors sc ON sc.id=s.subcontractor_id AND sc.deleted=false
       WHERE s.project_id=$1 AND s.deleted=false ORDER BY s.seq, s.id`, [req.params.id]);
    res.json({ project: withProfit(pr.rows[0]), stages: stages.rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// POST /api/projects
router.post('/', authenticate, can('editProjects'), async (req, res) => {
  const { name, client_name, client_phone, address, status, expected_profit, start_date, notes, subcontractor_id } = req.body;
  if (!name) return res.status(400).json({ error: 'שם פרויקט חובה' });
  try {
    const r = await pool.query(
      `INSERT INTO projects (name, client_name, client_phone, address, status, expected_profit, subcontractor_id, start_date, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,COALESCE($5,'active'),COALESCE($6,0),$7,$8,$9,$10,$10) RETURNING *`,
      [name, client_name, client_phone, address, status, expected_profit, subcontractor_id || null, start_date || null, notes, req.user.id]
    );
    await logAction(req.user, 'add', 'projects', r.rows[0].id, { name });
    res.status(201).json(withProfit(Object.assign({ income:0, sub_paid:0, project_expenses:0, planned_income:0, planned_sub:0 }, r.rows[0])));
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// PUT /api/projects/:id
router.put('/:id', authenticate, can('editProjects'), async (req, res) => {
  const { name, client_name, client_phone, address, status, expected_profit, start_date, notes, subcontractor_id } = req.body;
  try {
    const r = await pool.query(
      `UPDATE projects SET name=$1, client_name=$2, client_phone=$3, address=$4, status=$5,
         expected_profit=COALESCE($6,0), subcontractor_id=$7, start_date=$8, notes=$9, updated_by=$10, updated_at=NOW()
       WHERE id=$11 AND deleted=false RETURNING *`,
      [name, client_name, client_phone, address, status, expected_profit, subcontractor_id || null, start_date || null, notes, req.user.id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'פרויקט לא נמצא' });
    // קבלן המשנה הוא ברמת הפרויקט - מסנכרנים את כל השלבים אליו
    await pool.query('UPDATE stages SET subcontractor_id=$1, updated_at=NOW() WHERE project_id=$2 AND deleted=false',
      [subcontractor_id || null, req.params.id]);
    await logAction(req.user, 'edit', 'projects', req.params.id, { name });
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// DELETE /api/projects/:id - מחיקה רכה מדביקה (כולל שלבים ותנועות)
router.delete('/:id', authenticate, can('viewBusiness'), can('del'), async (req, res) => {
  try {
    const ok = await softDeleteProject(req.params.id, req.user);
    if (!ok) return res.status(404).json({ error: 'פרויקט לא נמצא' });
    res.json({ message: 'הפרויקט (ושלביו) הועברו לסל המחזור' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// POST /api/projects/:id/stages/bulk - הזנת שלבים במרוכז (קבלן המשנה יורש מהפרויקט)
// body: { stages: [{ name, client_amount, sub_amount }] }
router.post('/:id/stages/bulk', authenticate, canAny(['editProjects', 'editStages']), async (req, res) => {
  const projectId = req.params.id;
  const list = Array.isArray(req.body.stages) ? req.body.stages : [];
  if (!list.length) return res.status(400).json({ error: 'אין שלבים להוספה' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const proj = await client.query('SELECT id, subcontractor_id FROM projects WHERE id=$1 AND deleted=false', [projectId]);
    if (!proj.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'פרויקט לא נמצא' }); }
    const projSub = proj.rows[0].subcontractor_id || null;   // קבלן המשנה של הפרויקט

    // מיקום התחלתי לרצף
    const seqRow = await client.query('SELECT COALESCE(MAX(seq),0) AS m FROM stages WHERE project_id=$1', [projectId]);
    let seq = parseInt(seqRow.rows[0].m) || 0;
    const created = [];

    for (const st of list) {
      if (!st || !st.name) continue;
      seq++;
      const r = await client.query(
        `INSERT INTO stages (project_id, name, seq, client_amount, sub_amount, subcontractor_id, created_by, updated_by)
         VALUES ($1,$2,$3,COALESCE($4,0),COALESCE($5,0),$6,$7,$7) RETURNING *`,
        [projectId, st.name, seq, st.client_amount, st.sub_amount, projSub, req.user.id]
      );
      created.push(r.rows[0]);
    }
    await client.query('COMMIT');
    await logAction(req.user, 'bulk_add', 'stages', projectId, { count: created.length });
    sheets.mirrorMany('stages', created).catch(() => {});   // גיבוי השלבים ל-Sheets
    res.status(201).json(created);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'שגיאת שרת בהזנת השלבים' });
  } finally {
    client.release();
  }
});

// POST /api/projects/:id/import - ייבוא מצב פתיחה של פרויקט קיים:
// לכל שורה נוצר שלב + התשלומים שכבר בוצעו (ללקוח ולקבלן).
// body: { rows: [{ name, client_amount, client_paid, sub_amount, sub_paid }] }
router.post('/:id/import', authenticate, canAny(['editProjects', 'editStages']), async (req, res) => {
  const projectId = req.params.id;
  const list = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!list.length) return res.status(400).json({ error: 'אין שורות לייבוא' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const proj = await client.query('SELECT id, subcontractor_id FROM projects WHERE id=$1 AND deleted=false', [projectId]);
    if (!proj.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'פרויקט לא נמצא' }); }
    const projSub = proj.rows[0].subcontractor_id || null;
    const seqRow = await client.query('SELECT COALESCE(MAX(seq),0) AS m FROM stages WHERE project_id=$1', [projectId]);
    let seq = parseInt(seqRow.rows[0].m) || 0;
    const stages = [], txs = [];
    const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[₪,\s]/g, '')); return isNaN(n) ? 0 : n; };

    for (const row of list) {
      if (!row || !row.name || !String(row.name).trim()) continue;
      const ca = num(row.client_amount), sa = num(row.sub_amount), cp = num(row.client_paid), sp = num(row.sub_paid);
      seq++;
      const st = await client.query(
        `INSERT INTO stages (project_id, name, seq, client_amount, sub_amount, subcontractor_id, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`,
        [projectId, String(row.name).trim(), seq, ca, sa, projSub, req.user.id]);
      const stage = st.rows[0]; stages.push(stage);
      if (cp > 0) {
        const t = await client.query(
          `INSERT INTO transactions (type, direction, amount, project_id, stage_id, note, created_by, updated_by)
           VALUES ('client_payment','in',$1,$2,$3,'ייבוא מצב פתיחה',$4,$4) RETURNING *`,
          [cp, projectId, stage.id, req.user.id]); txs.push(t.rows[0]);
      }
      if (sp > 0) {
        const t = await client.query(
          `INSERT INTO transactions (type, direction, amount, project_id, stage_id, subcontractor_id, note, created_by, updated_by)
           VALUES ('sub_payment','out',$1,$2,$3,$4,'ייבוא מצב פתיחה',$5,$5) RETURNING *`,
          [sp, projectId, stage.id, projSub, req.user.id]); txs.push(t.rows[0]);
      }
    }
    await client.query('COMMIT');
    await logAction(req.user, 'import', 'stages', projectId, { stages: stages.length, payments: txs.length });
    sheets.mirrorMany('stages', stages).catch(() => {});
    sheets.mirrorMany('transactions', txs).catch(() => {});
    res.status(201).json({ stages: stages.length, payments: txs.length });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'שגיאת שרת בייבוא' });
  } finally {
    client.release();
  }
});

module.exports = router;
