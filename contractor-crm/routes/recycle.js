const express = require('express');
const { pool, restore, restoreProject, restoreStage, SOFT_TABLES } = require('../db');
const { authenticate, canAny } = require('../middleware/auth');
const router = express.Router();

// תיאור טבלאות סל המחזור: עברית + עמודות מפורשות לתצוגה אחידה
// כל שאילתה מחזירה: id, deleted_at, title, subtitle, amount
const RECYCLE = {
  subcontractors:    { he: 'קבלני משנה',   sql: `SELECT id, deleted_at, name AS title, COALESCE(trade,'') AS subtitle, NULL::float AS amount` },
  projects:          { he: 'פרויקטים',     sql: `SELECT id, deleted_at, name AS title, COALESCE(client_name,'') AS subtitle, NULL::float AS amount` },
  stages:            { he: 'שלבים',         sql: `SELECT id, deleted_at, name AS title, '' AS subtitle, client_amount::float AS amount` },
  transactions:      { he: 'תנועות כספיות', sql: `SELECT id, deleted_at, COALESCE(purpose, type) AS title, type AS subtitle, amount::float AS amount` },
  home_transactions: { he: 'הוצאות בית',    sql: `SELECT id, deleted_at, COALESCE(payee,'הוצאה') AS title, COALESCE(category,'') AS subtitle, amount::float AS amount` },
  payment_requests:  { he: 'בקשות תשלום',   sql: `SELECT id, deleted_at, COALESCE(stage_name,'בקשה') AS title, COALESCE(project_name,'') AS subtitle, requested::float AS amount` },
  debts:             { he: 'חובות',          sql: `SELECT id, deleted_at, lender AS title, COALESCE(note,'') AS subtitle, taken::float AS amount` }
};

// הרשאה לטבלה בסל המחזור: הבית לפי caps.home; בקשות תשלום גם למי שרשאי למחוק
// אותן (writeTx) כדי שההבטחה "ניתן לשחזר" תהיה נכונה; שאר העסקי — רק del.
function tableAllowed(caps, table) {
  if (table === 'home_transactions') return !!caps.home;
  if (table === 'payment_requests') return !!caps.viewBusiness && (!!caps.del || !!caps.writeTx);
  if (table === 'debts') return !!caps.debts && !!caps.del;
  return !!caps.viewBusiness && !!caps.del;
}

// GET /api/recycle - כל הרשומות שנמחקו (רכות)
router.get('/', authenticate, canAny(['del', 'writeTx']), async (req, res) => {
  try {
    const out = [];
    for (const table of SOFT_TABLES) {
      const meta = RECYCLE[table];
      if (!meta || !tableAllowed(req.caps, table)) continue;
      // מסתירים "ילדים" שנמחקו יחד עם הורה שעדיין מחוק — משוחזרים רק דרך ההורה
      let extra = '';
      if (table === 'stages' || table === 'transactions') extra += ' AND (project_id IS NULL OR project_id NOT IN (SELECT id FROM projects WHERE deleted=true))';
      if (table === 'transactions') extra += ' AND (stage_id IS NULL OR stage_id NOT IN (SELECT id FROM stages WHERE deleted=true))';
      const r = await pool.query(`${meta.sql} FROM ${table} WHERE deleted=true${extra} ORDER BY deleted_at DESC LIMIT 200`);
      r.rows.forEach(row => out.push(Object.assign({ _table: table, _label: meta.he }, row)));
    }
    out.sort((a, b) => new Date(b.deleted_at || 0) - new Date(a.deleted_at || 0));
    res.json(out);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// POST /api/recycle/restore - שחזור { table, id }
router.post('/restore', authenticate, canAny(['del', 'writeTx']), async (req, res) => {
  const { table, id } = req.body || {};
  if (!SOFT_TABLES.has(table)) return res.status(400).json({ error: 'טבלה לא תקינה' });
  if (!tableAllowed(req.caps, table)) return res.status(403).json({ error: 'אין הרשאה' });
  try {
    // פרויקט/שלב משחזרים גם את הילדים שנמחקו יחד איתם
    const ok = table === 'projects' ? await restoreProject(id, req.user)
      : table === 'stages' ? await restoreStage(id, req.user)
      : await restore(table, id, req.user);
    if (!ok) return res.status(404).json({ error: 'רשומה לא נמצאה בסל המחזור' });
    res.json({ message: 'הרשומה שוחזרה' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
