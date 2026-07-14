const express = require('express');
const { pool, logAction, softDelete, validId } = require('../db');
const sheets = require('../sheets');
const { authenticate, can, canAny } = require('../middleware/auth');
const router = express.Router();

const TYPES = ['client_payment', 'sub_payment', 'project_expense', 'business_expense'];
const DIRECTION = { client_payment: 'in', sub_payment: 'out', project_expense: 'out', business_expense: 'out' };

// בדיקת תקינות לפי סוג התנועה
function validate(type, b) {
  if (!TYPES.includes(type)) return 'סוג תנועה לא תקין';
  const amt = parseFloat(b.amount);
  if (!(amt > 0)) return 'סכום חייב להיות גדול מ-0';
  if (type === 'client_payment' && (!b.project_id || !b.stage_id)) return 'תשלום לקוח חייב פרויקט ושלב';
  if (type === 'sub_payment' && (!b.project_id || !b.stage_id || !b.subcontractor_id)) return 'תשלום לקבלן משנה חייב פרויקט, שלב וקבלן';
  if (type === 'project_expense' && !b.project_id) return 'הוצאה לפרויקט חייבת פרויקט';
  return null;
}

// חסימת חריגה: תשלום לקוח/קבלן לא יעבור את סכום השלב.
// מחזיר {remaining, cap} אם יש חריגה, אחרת null.
async function stageCapError(stageId, type, amount, excludeId) {
  if (type !== 'client_payment' && type !== 'sub_payment') return null;
  if (!stageId) return null;
  const st = await pool.query('SELECT client_amount, sub_amount FROM stages WHERE id=$1 AND deleted=false', [stageId]);
  if (!st.rows.length) return null;
  const cap = parseFloat(type === 'client_payment' ? st.rows[0].client_amount : st.rows[0].sub_amount) || 0;
  const params = [stageId, type];
  let excl = '';
  if (excludeId) { params.push(excludeId); excl = ' AND id<>$3'; }
  const paid = await pool.query(
    `SELECT COALESCE(SUM(amount),0)::float AS s FROM transactions WHERE stage_id=$1 AND type=$2 AND deleted=false${excl}`, params);
  const remaining = cap - paid.rows[0].s;
  if (amount > remaining + 0.001) return { remaining, cap };
  return null;
}
function capMsg(info, type) {
  const rem = Math.max(0, Math.round(info.remaining)).toLocaleString('he-IL');
  return type === 'client_payment'
    ? `הסכום חורג מסכום השלב מול הלקוח. נותר לגבייה בשלב: ${rem} ₪`
    : `הסכום חורג מסכום השלב לקבלן המשנה. נותר לתשלום בשלב: ${rem} ₪`;
}

// ===== קטגוריות הוצאה (רשימה מנוהלת + הוספה אוטומטית) =====
const DEFAULT_CATEGORIES = ['חומרים', 'כלים', 'שכר עבודה', 'השכרת ציוד', 'הובלה', 'דלק', 'אגרות ורשויות', 'ביטוח', 'משרד', 'אחר'];
async function getExpenseCategories() {
  try {
    const r = await pool.query("SELECT value FROM settings WHERE key='expense_categories'");
    const stored = r.rows.length && Array.isArray(r.rows[0].value) ? r.rows[0].value : [];
    return [...new Set([...DEFAULT_CATEGORIES, ...stored])];
  } catch (e) { return DEFAULT_CATEGORIES.slice(); }
}
async function addExpenseCategory(name) {
  name = String(name || '').trim(); if (!name) return;
  try {
    const r = await pool.query("SELECT value FROM settings WHERE key='expense_categories'");
    const stored = r.rows.length && Array.isArray(r.rows[0].value) ? r.rows[0].value : [];
    if (DEFAULT_CATEGORIES.includes(name) || stored.includes(name)) return;
    stored.push(name);
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('expense_categories', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value=$1::jsonb, updated_at=NOW()`, [JSON.stringify(stored)]);
  } catch (e) { /* לא קריטי */ }
}

// GET /api/transactions/categories - רשימת קטגוריות ההוצאה
router.get('/categories', authenticate, can('viewBusiness'), async (req, res) => {
  res.json(await getExpenseCategories());
});
// POST /api/transactions/categories { name } - הוספת קטגוריה
router.post('/categories', authenticate, can('writeTx'), async (req, res) => {
  await addExpenseCategory(req.body && req.body.name);
  res.json(await getExpenseCategories());
});

// POST /api/transactions/bulk-expenses - הזנת כמה הוצאות בבת אחת
// body: { type: 'project_expense'|'business_expense', rows: [{ date, category, supplier, purpose, amount, project_id }] }
router.post('/bulk-expenses', authenticate, can('writeTx'), async (req, res) => {
  const type = req.body && req.body.type;
  if (type !== 'project_expense' && type !== 'business_expense') return res.status(400).json({ error: 'סוג הוצאה לא תקין' });
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'אין הוצאות להזנה' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = [], cats = new Set();
    for (const row of rows) {
      const amt = parseFloat(row.amount);
      if (!(amt > 0)) continue;
      if (type === 'project_expense' && !row.project_id) continue;   // חובה פרויקט
      const r = await client.query(
        `INSERT INTO transactions (type, direction, amount, date, project_id, supplier, category, purpose, created_by, updated_by)
         VALUES ($1,'out',$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,
        [type, amt, row.date || null, type === 'project_expense' ? (row.project_id || null) : null,
         row.supplier || null, row.category || null, row.purpose || null, req.user.id]);
      created.push(r.rows[0]);
      if (row.category) cats.add(String(row.category).trim());
    }
    await client.query('COMMIT');
    cats.forEach(c => addExpenseCategory(c).catch(() => {}));
    await logAction(req.user, 'bulk_add', 'transactions', 0, { type, count: created.length });
    sheets.mirrorMany('transactions', created).catch(() => {});
    res.status(201).json({ count: created.length });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'שגיאת שרת בהזנת ההוצאות' });
  } finally { client.release(); }
});

// GET /api/transactions?project_id=&stage_id=&type=&from=&to=
router.get('/', authenticate, can('viewBusiness'), async (req, res) => {
  const { project_id, stage_id, type, from, to } = req.query;
  const where = ['t.deleted=false'];
  const params = [];
  if (project_id) { params.push(project_id); where.push(`t.project_id=$${params.length}`); }
  if (stage_id)   { params.push(stage_id);   where.push(`t.stage_id=$${params.length}`); }
  if (type)       { params.push(type);       where.push(`t.type=$${params.length}`); }
  if (from)       { params.push(from);       where.push(`t.date>=$${params.length}`); }
  if (to)         { params.push(to);         where.push(`t.date<=$${params.length}`); }
  try {
    const r = await pool.query(
      `SELECT t.*, p.name AS project_name, s.name AS stage_name, sc.name AS subcontractor_name
       FROM transactions t
       LEFT JOIN projects p ON p.id=t.project_id AND p.deleted=false
       LEFT JOIN stages s ON s.id=t.stage_id AND s.deleted=false
       LEFT JOIN subcontractors sc ON sc.id=t.subcontractor_id AND sc.deleted=false
       WHERE ${where.join(' AND ')} ORDER BY t.date DESC NULLS LAST, t.id DESC`,
      params
    );
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// POST /api/transactions
router.post('/', authenticate, canAny(['writeTx', 'projectExpenseOnly']), async (req, res) => {
  const b = req.body || {};
  const type = b.type;
  // מי שיש לו רק projectExpenseOnly (עובד שטח) - רשאי אך ורק להזין הוצאה לפרויקט
  if (!req.caps.writeTx && type !== 'project_expense') {
    return res.status(403).json({ error: 'אתה רשאי להזין רק הוצאה לפרויקט' });
  }
  const err = validate(type, b);
  if (err) return res.status(400).json({ error: err });
  try {
    const capErr = await stageCapError(b.stage_id, type, parseFloat(b.amount), null);
    if (capErr) return res.status(400).json({ error: capMsg(capErr, type) });
    const r = await pool.query(
      `INSERT INTO transactions
        (type, direction, amount, date, project_id, stage_id, subcontractor_id, supplier, category, purpose, method, invoice_url, note, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING *`,
      [type, DIRECTION[type], b.amount, b.date || null, b.project_id || null, b.stage_id || null,
       b.subcontractor_id || null, b.supplier || null, b.category || null, b.purpose || null, b.method || null,
       b.invoice_url || null, b.note || null, req.user.id]
    );
    if (b.category) addExpenseCategory(b.category).catch(() => {});
    await logAction(req.user, 'add', 'transactions', r.rows[0].id, { type, amount: b.amount });
    res.status(201).json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// PUT /api/transactions/:id
router.put('/:id', authenticate, can('writeTx'), async (req, res) => {
  const b = req.body || {};
  try {
    // שומרים על הסוג המקורי; מעדכנים שדות ניתנים לעריכה
    const cur = await pool.query('SELECT type FROM transactions WHERE id=$1 AND deleted=false', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'תנועה לא נמצאה' });
    const err = validate(cur.rows[0].type, b);
    if (err) return res.status(400).json({ error: err });
    const capErr = await stageCapError(b.stage_id, cur.rows[0].type, parseFloat(b.amount), req.params.id);
    if (capErr) return res.status(400).json({ error: capMsg(capErr, cur.rows[0].type) });
    const r = await pool.query(
      `UPDATE transactions SET amount=$1, date=$2, project_id=$3, stage_id=$4, subcontractor_id=$5,
         supplier=$6, category=$7, purpose=$8, method=$9, invoice_url=$10, note=$11, updated_by=$12, updated_at=NOW()
       WHERE id=$13 AND deleted=false RETURNING *`,
      [b.amount, b.date || null, b.project_id || null, b.stage_id || null, b.subcontractor_id || null,
       b.supplier || null, b.category || null, b.purpose || null, b.method || null, b.invoice_url || null, b.note || null,
       req.user.id, req.params.id]
    );
    if (b.category) addExpenseCategory(b.category).catch(() => {});
    await logAction(req.user, 'edit', 'transactions', req.params.id, { amount: b.amount });
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// DELETE /api/transactions/:id - מחיקה רכה
router.delete('/:id', authenticate, can('viewBusiness'), can('del'), async (req, res) => {
  try {
    const ok = await softDelete('transactions', req.params.id, req.user);
    if (!ok) return res.status(404).json({ error: 'תנועה לא נמצאה' });
    res.json({ message: 'התנועה הועברה לסל המחזור' });
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

// POST /api/transactions/bulk-delete - מחיקה מרובה (מנהל בלבד). אטומי: הכל או כלום.
router.post('/bulk-delete', authenticate, can('viewBusiness'), can('multiDelete'), async (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(validId).filter(v => v !== null);
  if (!ids.length) return res.status(400).json({ error: 'לא נבחרו תנועות תקינות' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let n = 0;
    for (const id of ids) {
      const r = await client.query(
        'UPDATE transactions SET deleted=true, deleted_at=NOW(), deleted_by=$2 WHERE id=$1 AND deleted=false RETURNING id',
        [id, req.user.id]);
      if (r.rows.length) n++;
    }
    await client.query('COMMIT');
    await logAction(req.user, 'bulk_delete', 'transactions', 0, { count: n });
    pool.query('SELECT * FROM transactions WHERE id = ANY($1)', [ids])   // גיבוי המחיקה ל-Sheets
      .then(r => sheets.mirrorMany('transactions', r.rows)).catch(() => {});
    res.json({ message: `${n} תנועות הועברו לסל המחזור`, count: n });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'שגיאת שרת' });
  } finally { client.release(); }
});

module.exports = router;
