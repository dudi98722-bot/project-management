// קבוצות מטפלים (למשל "מטפלים חרדים") — לבחירה בהעדפת שיוך של מטופל
const express = require('express');
const { pool, logAction, softDelete, validId } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const sheets = require('../sheets');
const router = express.Router();

async function groupWithMembers(id) {
  const r = await pool.query(`
    SELECT g.*,
           COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name, 'active', t.active))
                    FILTER (WHERE t.id IS NOT NULL AND t.deleted = false), '[]') AS members
    FROM therapist_groups g
    LEFT JOIN group_members gm ON gm.group_id = g.id
    LEFT JOIN therapists t ON t.id = gm.therapist_id
    WHERE g.id=$1
    GROUP BY g.id`, [id]);
  return r.rows[0];
}

router.get('/', authenticate, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT g.*,
             COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name, 'active', t.active))
                      FILTER (WHERE t.id IS NOT NULL AND t.deleted = false), '[]') AS members
      FROM therapist_groups g
      LEFT JOIN group_members gm ON gm.group_id = g.id
      LEFT JOIN therapists t ON t.id = gm.therapist_id
      WHERE g.deleted=false
      GROUP BY g.id
      ORDER BY g.name`);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.post('/', authenticate, can('edit'), async (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name) return res.status(400).json({ error: 'שם קבוצה חובה' });
  try {
    const r = await pool.query('INSERT INTO therapist_groups (name, notes) VALUES ($1,$2) RETURNING *',
      [name, (req.body || {}).notes || null]);
    await logAction(req.user, 'add', 'therapist_groups', r.rows[0].id, { name });
    sheets.backup(req.user, 'add', 'therapist_groups', r.rows[0].id, { ...r.rows[0], members: '' }, { name });
    res.status(201).json({ ...r.rows[0], members: [] });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.put('/:id', authenticate, can('edit'), async (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name) return res.status(400).json({ error: 'שם קבוצה חובה' });
  try {
    const r = await pool.query('UPDATE therapist_groups SET name=$1, notes=$2, updated_at=NOW() WHERE id=$3 AND deleted=false RETURNING id',
      [name, (req.body || {}).notes || null, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'לא נמצא' });
    await logAction(req.user, 'edit', 'therapist_groups', req.params.id, { name });
    const g = await groupWithMembers(req.params.id);
    sheets.backup(req.user, 'edit', 'therapist_groups', req.params.id,
      { ...g, members: (g.members || []).map(m => m.name).join(', ') }, {});
    res.json(g);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// עדכון חברי קבוצה בבת אחת: { therapist_ids: [1,2,3] }
router.put('/:id/members', authenticate, can('edit'), async (req, res) => {
  const ids = Array.isArray((req.body || {}).therapist_ids)
    ? (req.body).therapist_ids.map(validId).filter(Boolean) : [];
  const gid = validId(req.params.id);
  if (!gid) return res.status(400).json({ error: 'מזהה לא תקין' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const g = await client.query('SELECT id FROM therapist_groups WHERE id=$1 AND deleted=false', [gid]);
    if (!g.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'לא נמצא' }); }
    await client.query('DELETE FROM group_members WHERE group_id=$1', [gid]);
    for (const tid of ids) {
      await client.query('INSERT INTO group_members (group_id, therapist_id) SELECT $1, id FROM therapists WHERE id=$2 AND deleted=false ON CONFLICT DO NOTHING', [gid, tid]);
    }
    await client.query('COMMIT');
    await logAction(req.user, 'edit', 'therapist_groups', gid, { members: ids });
    const full = await groupWithMembers(gid);
    sheets.backup(req.user, 'edit', 'therapist_groups', gid,
      { ...full, members: (full.members || []).map(m => m.name).join(', ') }, { members: ids });
    res.json(full);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  } finally { client.release(); }
});

router.delete('/:id', authenticate, can('del'), async (req, res) => {
  try {
    const ok = await softDelete('therapist_groups', req.params.id, req.user);
    if (!ok) return res.status(404).json({ error: 'לא נמצא' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
