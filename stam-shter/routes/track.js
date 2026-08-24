// ===== מעקב יריעות ופריטים =====
// פריט מעקב הוא יריעה של ספר (1..N) או יחידה של מוצר. אותו מודל לשניהם,
// כדי שההעברות, הסינון והדוחות יעבדו זהה בכל סוגי המוצרים.
const express = require('express');
const { pool, logAction, softDelete } = require('../db');
const { authenticate, can } = require('../middleware/auth');
const router = express.Router();

// תצוגה מועשרת: שם התחנה, שם המחזיק, ופרטי הספר/החבילה שאליהם שייך הפריט
const VIEW = `
SELECT t.*,
  st.name AS station_name, st.color AS station_color,
  h.name  AS holder_name,
  p.name  AS product_name,
  sc.name AS scribe_name,
  cu.name AS customer_name,
  pprod.name AS purchase_product_name,
  ppsc.name  AS purchase_scribe_name,
  (CURRENT_DATE - t.since) AS days_at_station
FROM track_items t
LEFT JOIN stations st ON st.id = t.station_id
LEFT JOIN contacts h  ON h.id  = t.holder_id
LEFT JOIN scrolls  s  ON s.id  = t.scroll_id
LEFT JOIN products p  ON p.id  = s.product_id
LEFT JOIN contacts sc ON sc.id = s.scribe_id
LEFT JOIN contacts cu ON cu.id = s.customer_id
LEFT JOIN prod_purchases pp ON pp.id = t.purchase_id
LEFT JOIN products pprod    ON pprod.id = pp.product_id
LEFT JOIN contacts ppsc     ON ppsc.id  = pp.scribe_id`;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// ---------- רשימת פריטים ----------
router.get('/', authenticate, can('view'), async (req, res) => {
  try {
    const where = ['t.deleted=false']; const vals = [];
    const add = (col, q) => { if (q !== undefined && q !== '') { vals.push(q); where.push(`${col}=$${vals.length}`); } };
    add('t.scroll_id', req.query.scroll_id);
    add('t.purchase_id', req.query.purchase_id);
    add('t.station_id', req.query.station_id);
    add('t.holder_id', req.query.holder_id);
    const r = await pool.query(
      `${VIEW} WHERE ${where.join(' AND ')}
       ORDER BY t.scroll_id NULLS LAST, t.purchase_id NULLS LAST, t.seq`, vals);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// ---------- סיכום: כמה פריטים בכל תחנה ואצל כל אדם ----------
router.get('/summary', authenticate, can('view'), async (req, res) => {
  try {
    const [byStation, byHolder, byScroll, unassigned] = await Promise.all([
      pool.query(`SELECT COALESCE(st.id,0) AS id, COALESCE(st.name,'ללא תחנה') AS name, st.color,
                    COUNT(*)::int AS items
                  FROM track_items t LEFT JOIN stations st ON st.id=t.station_id
                  WHERE t.deleted=false GROUP BY st.id, st.name, st.color
                  ORDER BY items DESC`),
      pool.query(`SELECT COALESCE(h.id,0) AS id, COALESCE(h.name,'ללא מחזיק') AS name,
                    COUNT(*)::int AS items,
                    COUNT(DISTINCT t.scroll_id)::int AS scrolls,
                    MIN(t.since) AS oldest
                  FROM track_items t LEFT JOIN contacts h ON h.id=t.holder_id
                  WHERE t.deleted=false GROUP BY h.id, h.name
                  ORDER BY items DESC`),
      pool.query(`SELECT s.id, p.name AS product_name, sc.name AS scribe_name,
                    COUNT(t.id)::int AS items,
                    COUNT(*) FILTER (WHERE t.station_id IS NOT NULL)::int AS placed
                  FROM scrolls s
                  JOIN track_items t ON t.scroll_id=s.id AND t.deleted=false
                  LEFT JOIN products p ON p.id=s.product_id
                  LEFT JOIN contacts sc ON sc.id=s.scribe_id
                  WHERE s.deleted=false GROUP BY s.id, p.name, sc.name ORDER BY s.id DESC`),
      pool.query(`SELECT COUNT(*)::int AS n FROM track_items
                  WHERE deleted=false AND station_id IS NULL AND holder_id IS NULL`),
    ]);
    res.json({
      by_station: byStation.rows, by_holder: byHolder.rows,
      by_scroll: byScroll.rows, unassigned: unassigned.rows[0].n,
      total: byStation.rows.reduce((a, x) => a + x.items, 0),
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// ---------- יצירת יריעות לספר / יחידות לחבילה ----------
// idempotent: יוצר רק את המספרים החסרים, כך שאפשר להריץ שוב אחרי הגדלת הכמות.
router.post('/generate', authenticate, can('edit'), async (req, res) => {
  const scrollId = num(req.body.scroll_id);
  const purchaseId = num(req.body.purchase_id);
  let count = num(req.body.count);
  if (!scrollId && !purchaseId) return res.status(400).json({ error: 'יש לציין ספר או חבילת רכישה' });
  if (scrollId && purchaseId) return res.status(400).json({ error: 'ספר או חבילה — לא שניהם' });
  try {
    // אם לא נמסרה כמות, נגזרת מהמוצר (יריעות) או מכמות הרכישה
    if (!count) {
      if (scrollId) {
        const r = await pool.query(
          `SELECT COALESCE(s.sheets_count, ROUND(COALESCE(p.parchment_units,0))) AS n
           FROM scrolls s LEFT JOIN products p ON p.id=s.product_id
           WHERE s.id=$1 AND s.deleted=false`, [scrollId]);
        if (!r.rows.length) return res.status(404).json({ error: 'הספר לא נמצא' });
        count = Number(r.rows[0].n) || 0;
      } else {
        const r = await pool.query('SELECT quantity FROM prod_purchases WHERE id=$1 AND deleted=false', [purchaseId]);
        if (!r.rows.length) return res.status(404).json({ error: 'הרכישה לא נמצאה' });
        count = Number(r.rows[0].quantity) || 0;
      }
    }
    if (!(count > 0)) return res.status(400).json({ error: 'לא הוגדרה כמות. קבע "מספר יריעות" בספר, או יחידות קלף במוצר' });
    if (count > 2000) return res.status(400).json({ error: 'כמות גדולה מדי (מקסימום 2000)' });

    const col = scrollId ? 'scroll_id' : 'purchase_id';
    const val = scrollId || purchaseId;
    const have = await pool.query(`SELECT seq FROM track_items WHERE ${col}=$1 AND deleted=false`, [val]);
    const exists = new Set(have.rows.map(r => Number(r.seq)));
    const missing = [];
    for (let i = 1; i <= count; i++) if (!exists.has(i)) missing.push(i);
    if (!missing.length) return res.json({ created: 0, total: exists.size, message: 'כל היריעות כבר קיימות' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const seq of missing) {
        await client.query(
          `INSERT INTO track_items (${col}, seq, since, created_by, updated_by)
           VALUES ($1,$2,CURRENT_DATE,$3,$3)`, [val, seq, req.user.id]);
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }

    await logAction(req.user, 'generate', 'track_items', val, { count: missing.length, scope: col });
    res.json({ created: missing.length, total: exists.size + missing.length });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// ---------- העברה בין תחנות ----------
// מעביר רשימת פריטים יחד, ורושם כל מעבר ביומן התנועות.
// שדה שלא נשלח נשאר כפי שהוא, כך שאפשר להעביר תחנה בלי לשנות מחזיק ולהפך.
router.post('/move', authenticate, can('edit'), async (req, res) => {
  const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : [])
    .map(Number).filter(n => Number.isInteger(n) && n > 0))];
  if (!ids.length) return res.status(400).json({ error: 'לא נבחרו פריטים' });
  const hasStation = req.body.station_id !== undefined && req.body.station_id !== '';
  const hasHolder  = req.body.holder_id  !== undefined && req.body.holder_id  !== '';
  if (!hasStation && !hasHolder) return res.status(400).json({ error: 'יש לבחור תחנה או מחזיק' });
  const stationId = hasStation ? num(req.body.station_id) : undefined;
  const holderId  = hasHolder  ? num(req.body.holder_id)  : undefined;
  const date = req.body.date || null;
  const note = req.body.note || null;

  const client = await pool.connect();
  let moved = 0;
  const records = [];
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      'SELECT id, station_id, holder_id FROM track_items WHERE id = ANY($1::bigint[]) AND deleted=false FOR UPDATE', [ids]);
    for (const it of cur.rows) {
      const toStation = hasStation ? stationId : it.station_id;
      const toHolder  = hasHolder  ? holderId  : it.holder_id;
      // דילוג על פריט שכבר נמצא בדיוק שם — שלא ייווצר רישום ריק ביומן
      if (Number(it.station_id || 0) === Number(toStation || 0) &&
          Number(it.holder_id || 0) === Number(toHolder || 0)) continue;
      const upd = await client.query(
        `UPDATE track_items SET station_id=$1, holder_id=$2, since=COALESCE($3::date,CURRENT_DATE),
           updated_by=$4, updated_at=NOW() WHERE id=$5 RETURNING *`,
        [toStation, toHolder, date, req.user.id, it.id]);
      await client.query(
        `INSERT INTO track_moves (item_id, date, from_station_id, from_holder_id, to_station_id, to_holder_id, note, created_by)
         VALUES ($1, COALESCE($2::date,CURRENT_DATE), $3,$4,$5,$6,$7,$8)`,
        [it.id, date, it.station_id, it.holder_id, toStation, toHolder, note, req.user.id]);
      moved++;
      if (upd.rows.length) records.push(upd.rows[0]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e); client.release();
    return res.status(500).json({ error: 'ההעברה נכשלה: ' + e.message });
  }
  client.release();
  await logAction(req.user, 'move', 'track_items', null, { moved, station_id: stationId, holder_id: holderId });
  res.json({ moved, skipped: ids.length - moved });
});

// ---------- היסטוריה של פריט ----------
router.get('/:id/history', authenticate, can('view'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT m.*, fs.name AS from_station, ts.name AS to_station,
              fh.name AS from_holder, th.name AS to_holder, u.full_name AS by_user
       FROM track_moves m
       LEFT JOIN stations fs ON fs.id=m.from_station_id
       LEFT JOIN stations ts ON ts.id=m.to_station_id
       LEFT JOIN contacts fh ON fh.id=m.from_holder_id
       LEFT JOIN contacts th ON th.id=m.to_holder_id
       LEFT JOIN users u ON u.id=m.created_by
       WHERE m.item_id=$1 ORDER BY m.date DESC, m.id DESC`, [req.params.id]);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// ---------- עריכה ומחיקה של פריט בודד ----------
router.put('/:id', authenticate, can('edit'), async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE track_items SET label=$1, note=$2, updated_by=$3, updated_at=NOW()
       WHERE id=$4 AND deleted=false RETURNING *`,
      [req.body.label || null, req.body.note || null, req.user.id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'לא נמצא' });
    await logAction(req.user, 'edit', 'track_items', req.params.id, {}, r.rows[0]);
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

router.delete('/:id', authenticate, can('del'), async (req, res) => {
  try {
    const ok = await softDelete('track_items', req.params.id, req.user);
    if (!ok) return res.status(404).json({ error: 'לא נמצא' });
    res.json({ message: 'הועבר לסל המחזור' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
