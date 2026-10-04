const express = require('express');
const { pool, logAction } = require('../db');
const { authenticate, requireWrite, requireDelete } = require('../middleware/auth');
const { syncContact, syncVow, syncPayment, syncCredit } = require('../sheets');
const router = express.Router();

// אותה נוסחה כמו calcDisplayName בדפדפן - חייבות להישאר זהות
function calcDisplayName(ln, fn, fa, id) {
  let n = ((ln || '') + ' ' + (fn || '')).trim();
  if (fa) n += ' ב"ר ' + fa;
  if (id) n += ' - ' + id;
  return n;
}

// contacts.id הוא INTEGER - מעבר לזה ה-INSERT נכשל
const MAX_CONTACT_ID = 2147483647;
function validContactId(v) {
  const t = String(v == null ? '' : v).trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return (n > 0 && n <= MAX_CONTACT_ID) ? n : null;
}

/**
 * שינוי שם מדורג, בתוך טרנזקציה פתוחה. כל מה שמפתח לפי השם עובר יחד:
 * נדרים, תשלומים, זכויות ויומן הדוחות. מחזיר את השורות לסנכרון לגיליון,
 * שנעשה רק אחרי COMMIT.
 */
async function renameCascade(client, oldName, newName, userId) {
  const uv = await client.query('UPDATE vows SET name=$1, updated_by=$2, updated_at=NOW() WHERE name=$3 RETURNING *', [newName, userId, oldName]);
  const up = await client.query('UPDATE payments SET name=$1, updated_by=$2, updated_at=NOW() WHERE name=$3 RETURNING *', [newName, userId, oldName]);
  const uc = await client.query('UPDATE credits SET person_name=$1 WHERE person_name=$2 RETURNING *', [newName, oldName]);
  const ur = await client.query('UPDATE report_log SET person_name=$1 WHERE person_name=$2', [newName, oldName]);
  return {
    counts: { vows: uv.rowCount, payments: up.rowCount, credits: uc.rowCount, reports: ur.rowCount },
    rows: { vows: uv.rows, payments: up.rows, credits: uc.rows }
  };
}
function syncCascade(rows, username) {
  rows.vows.forEach(r => syncVow('edit', r, username));
  rows.payments.forEach(r => syncPayment('edit', r, username));
  rows.credits.forEach(r => syncCredit('edit', r, username));
}

// GET /api/contacts
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    let query = 'SELECT * FROM contacts';
    let params = [];
    if (search) {
      query += ` WHERE display_name ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1 OR phone_mobile ILIKE $1 OR phone_home ILIKE $1`;
      params.push(`%${search}%`);
    }
    query += ` ORDER BY last_name, first_name LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(parseInt(limit), (parseInt(page)-1)*parseInt(limit));

    const result = await pool.query(query, params);
    const countRes = await pool.query(
      search ? `SELECT COUNT(*) FROM contacts WHERE display_name ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1 OR phone_mobile ILIKE $1 OR phone_home ILIKE $1` : 'SELECT COUNT(*) FROM contacts',
      search ? [`%${search}%`] : []
    );
    res.json({ data: result.rows, total: parseInt(countRes.rows[0].count), page: parseInt(page) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// GET /api/contacts/all (full rows, for initial app load)
router.get('/all', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM contacts ORDER BY display_name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// GET /api/contacts/next-id - המזהה הפנוי הבא, מחושב בשרת.
// הלקוח חישב את זה מרשימה שנטענה פעם אחת בכניסה, ולכן שני משתמשים
// יכלו להגיע לאותו מזהה.
router.get('/next-id', authenticate, async (req, res) => {
  try {
    const r = await pool.query('SELECT COALESCE(MAX(id), 100000) AS m FROM contacts');
    res.json({ id: Number(r.rows[0].m) + 1 });
  } catch (err) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// POST /api/contacts/import  { rows:[...], update_existing:bool }
// ייבוא מאקסל. הכל בטרנזקציה אחת - או שכל הקובץ נכנס, או ששום דבר לא.
// "עדכון קיימים" נוגע רק בפרטי קשר (טלפון, כתובת, מייל, תואר, דירה) ולעולם
// לא בשם: איות קצת שונה בקובץ היה משנה שם לתורם בכל הנדרים והתשלומים.
// שדה ריק בקובץ לא מוחק נתון קיים.
router.post('/import', authenticate, requireWrite, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'ייבוא אנשי קשר מותר למנהל בלבד' });
  const rows = Array.isArray(req.body.rows) ? req.body.rows : null;
  if (!rows || !rows.length) return res.status(400).json({ error: 'אין שורות לייבוא' });
  if (rows.length > 5000) return res.status(400).json({ error: 'עד 5,000 שורות בייבוא אחד' });
  const updateExisting = !!req.body.update_existing;

  const LIM = { apt: 50, title: 50, first_name: 100, last_name: 100, father_name: 100,
                phone_home: 50, phone_mobile: 50, street: 200, house_num: 20, city: 100, zip: 20, email: 200 };
  const F = Object.keys(LIM);
  const DETAILS = ['apt', 'title', 'phone_home', 'phone_mobile', 'street', 'house_num', 'city', 'zip', 'email'];
  const clean = v => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();

  const errors = [];
  const seenIds = new Set();
  const items = rows.map((r, i) => {
    const o = { line: Number(r.line) || (i + 2) };
    F.forEach(f => { o[f] = clean(r[f]); });
    const rawId = clean(r.id);
    o.id = rawId ? validContactId(rawId) : null;
    if (rawId && o.id === null) errors.push(`שורה ${o.line}: מזהה לא תקין (${rawId})`);
    if (!o.first_name || !o.last_name) errors.push(`שורה ${o.line}: חסר שם פרטי או שם משפחה`);
    F.forEach(f => { if (o[f].length > LIM[f]) errors.push(`שורה ${o.line}: הערך בשדה ${f} ארוך מדי`); });
    if (o.id) {
      if (seenIds.has(o.id)) errors.push(`שורה ${o.line}: המזהה ${o.id} מופיע בקובץ יותר מפעם אחת`);
      seenIds.add(o.id);
    }
    return o;
  });
  if (errors.length) return res.status(400).json({ error: 'יש שורות לא תקינות - לא יובא כלום', details: errors.slice(0, 50) });

  const client = await pool.connect();
  const created = [], updated = [], skipped = [];
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('crm_contact_id'))");

    const fileIds = items.filter(o => o.id).map(o => o.id);
    const ex = fileIds.length
      ? await client.query('SELECT * FROM contacts WHERE id = ANY($1::int[]) FOR UPDATE', [fileIds])
      : { rows: [] };
    const existing = new Map(ex.rows.map(c => [Number(c.id), c]));
    const mx = await client.query('SELECT COALESCE(MAX(id), 100000) AS m FROM contacts');
    let next = Number(mx.rows[0].m) + 1;
    const reserved = new Set(fileIds);

    for (const o of items) {
      const cur = o.id ? existing.get(o.id) : null;
      if (cur) {
        if (!updateExisting) { skipped.push({ line: o.line, id: o.id, name: cur.display_name }); continue; }
        const m = {};
        DETAILS.forEach(f => { m[f] = o[f] !== '' ? o[f] : (cur[f] || null); });
        const changed = DETAILS.some(f => String(m[f] || '') !== String(cur[f] || ''));
        if (!changed) { skipped.push({ line: o.line, id: o.id, name: cur.display_name, same: true }); continue; }
        const r = await client.query(
          `UPDATE contacts SET apt=$1,title=$2,phone_home=$3,phone_mobile=$4,street=$5,house_num=$6,city=$7,zip=$8,email=$9,
             updated_by=$10,updated_at=NOW() WHERE id=$11 RETURNING *`,
          [m.apt, m.title, m.phone_home, m.phone_mobile, m.street, m.house_num, m.city, m.zip, m.email, req.user.id, o.id]);
        updated.push(r.rows[0]);
        continue;
      }
      let id = o.id;
      if (!id) {
        while (reserved.has(next)) next++;
        id = next++;
        reserved.add(id);
      }
      const dn = calcDisplayName(o.last_name, o.first_name, o.father_name, id);
      const r = await client.query(
        `INSERT INTO contacts (id,apt,title,first_name,last_name,father_name,phone_home,phone_mobile,street,house_num,city,zip,email,display_name,created_by,updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) RETURNING *`,
        [id, o.apt || null, o.title || null, o.first_name, o.last_name, o.father_name || null, o.phone_home || null,
         o.phone_mobile || null, o.street || null, o.house_num || null, o.city || null, o.zip || null, o.email || null,
         dn, req.user.id]);
      created.push(r.rows[0]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('contacts import error:', err.message);
    return res.status(500).json({ error: 'שגיאת שרת - לא יובא כלום' });
  } finally {
    client.release();
  }

  for (const c of created) {
    await logAction(req.user.id, req.user.username, 'add', 'contacts', c.id, { display_name: c.display_name, source: 'import' });
    syncContact('add', c, req.user.username);
  }
  for (const c of updated) {
    await logAction(req.user.id, req.user.username, 'edit', 'contacts', c.id, { display_name: c.display_name, source: 'import' });
    syncContact('edit', c, req.user.username);
  }
  res.json({ created: created.length, updated: updated.length, skipped: skipped.length,
             created_rows: created, updated_rows: updated, skipped_rows: skipped });
});

// POST /api/contacts/:id/change-id  { new_id }
// המספר הוא חלק מהשם ("כהן משה - 100483"), והשם הוא מה שמקשר נדרים,
// תשלומים וזכויות לתורם - לכן השינוי עובר בטרנזקציה אחת על כולם.
router.post('/:id/change-id', authenticate, requireWrite, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'שינוי מספר איש קשר מותר למנהל בלבד' });
  const oldId = validContactId(req.params.id);
  const newId = validContactId(req.body.new_id);
  if (!oldId) return res.status(400).json({ error: 'מספר נוכחי לא תקין' });
  if (!newId) return res.status(400).json({ error: 'המספר החדש חייב להיות מספר שלם וחיובי' });
  if (newId === oldId) return res.status(400).json({ error: 'זה אותו מספר' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('crm_contact_id'))");
    const cur = await client.query('SELECT * FROM contacts WHERE id=$1 FOR UPDATE', [oldId]);
    if (!cur.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'איש קשר לא נמצא' }); }
    const taken = await client.query('SELECT display_name FROM contacts WHERE id=$1', [newId]);
    if (taken.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `המספר ${newId} כבר שייך ל: ${taken.rows[0].display_name}` });
    }

    const c = cur.rows[0];
    const oldName = c.display_name || '';
    // השם נשאר כמו שהוא, ורק המספר שבסופו מתחלף
    let base = oldName.replace(/\s*-\s*\d+\s*$/, '').trim();
    if (!base) base = calcDisplayName(c.last_name, c.first_name, c.father_name, '');
    const newName = base + ' - ' + newId;

    // אם כבר קיימות רשומות תחת השם החדש (למשל של מי שהחזיק פעם את המספר),
    // השינוי היה מערבב את הכסף של שני אנשים - חוסמים.
    const clash = await client.query(
      `SELECT (SELECT count(*) FROM vows WHERE name=$1)
            + (SELECT count(*) FROM payments WHERE name=$1)
            + (SELECT count(*) FROM credits WHERE person_name=$1) AS n`, [newName]);
    if (Number(clash.rows[0].n) > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `כבר קיימים נדרים/תשלומים תחת "${newName}". שינוי המספר היה מערבב אותם עם הרשומות של איש הקשר הזה, ולכן לא בוצע.` });
    }

    const upd = await client.query(
      'UPDATE contacts SET id=$1, display_name=$2, updated_by=$3, updated_at=NOW() WHERE id=$4 RETURNING *',
      [newId, newName, req.user.id, oldId]);
    const cascade = oldName ? await renameCascade(client, oldName, newName, req.user.id)
                            : { counts: { vows: 0, payments: 0, credits: 0, reports: 0 }, rows: { vows: [], payments: [], credits: [] } };
    await client.query('COMMIT');

    await logAction(req.user.id, req.user.username, 'change_id', 'contacts', newId,
      { from_id: oldId, to_id: newId, from: oldName, to: newName, ...cascade.counts });
    // בגיליון השורה מזוהה לפי המספר - מוחקים את הישנה ומוסיפים חדשה
    syncContact('delete', { id: oldId }, req.user.username);
    syncContact('add', upd.rows[0], req.user.username);
    syncCascade(cascade.rows, req.user.username);
    res.json({ contact: upd.rows[0], old_id: oldId, old_name: oldName, renamed: cascade.counts });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('change-id error:', err.message);
    res.status(500).json({ error: 'שגיאת שרת - המספר לא שונה' });
  } finally {
    client.release();
  }
});

// GET /api/contacts/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM contacts WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'איש קשר לא נמצא' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// POST /api/contacts
// לעולם לא דורס איש קשר קיים. אם המזהה שהלקוח ביקש כבר תפוס - מוקצה
// המזהה הפנוי הבא, ה-display_name מתוקן בהתאם, והתשובה מסמנת reassigned
// כדי שהלקוח יציג את המזהה שנשמר בפועל.
router.post('/', authenticate, requireWrite, async (req, res) => {
  const { id, apt, title, first_name, last_name, father_name, phone_home, phone_mobile, street, house_num, city, zip, email, display_name } = req.body;
  if (!first_name || !last_name) return res.status(400).json({ error: 'שם פרטי ושם משפחה חובה' });
  const cid = /^\d+$/.test(String(id)) ? Number(id) : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // נעילה על הקצאת המזהים - שתי הוספות במקביל לא יקבלו אותו מספר
    await client.query("SELECT pg_advisory_xact_lock(hashtext('crm_contact_id'))");

    let useId = cid, reassigned = false;
    if (useId !== null) {
      const taken = await client.query('SELECT 1 FROM contacts WHERE id=$1', [useId]);
      if (taken.rows.length) { useId = null; reassigned = true; }
    }
    if (useId === null) {
      const mx = await client.query('SELECT COALESCE(MAX(id), 100000) AS m FROM contacts');
      useId = Number(mx.rows[0].m) + 1;
    }

    // display_name מכיל את המזהה בסופו - להתאים אותו למזהה שהוקצה בפועל
    let dn = display_name;
    if (reassigned && dn) {
      const fixed = String(dn).replace(/\s*-\s*\d+\s*$/, ' - ' + useId);
      dn = (fixed === String(dn)) ? (String(dn) + ' - ' + useId) : fixed;
    }

    const result = await client.query(
      `INSERT INTO contacts (id,apt,title,first_name,last_name,father_name,phone_home,phone_mobile,street,house_num,city,zip,email,display_name,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
       RETURNING *`,
      [useId,apt,title,first_name,last_name,father_name,phone_home,phone_mobile,street,house_num,city,zip,email,dn,req.user.id]
    );
    await client.query('COMMIT');

    await logAction(req.user.id, req.user.username, 'add', 'contacts', result.rows[0].id,
      reassigned ? { display_name: dn, requested_id: cid, reassigned_to: useId } : { display_name: dn });
    syncContact('add', result.rows[0], req.user.username);
    res.status(201).json(Object.assign({}, result.rows[0], { reassigned, requested_id: cid }));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('contact add error:', err.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  } finally {
    client.release();
  }
});

// PUT /api/contacts/:id
router.put('/:id', authenticate, requireWrite, async (req, res) => {
  const { apt, title, first_name, last_name, father_name, phone_home, phone_mobile, street, house_num, city, zip, email, display_name } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // שם קודם - כדי לזהות שינוי שם ולעדכן בהתאם את כל הרשומות התלויות
    const prev = await client.query('SELECT display_name FROM contacts WHERE id=$1 FOR UPDATE', [req.params.id]);
    const oldName = prev.rows.length ? prev.rows[0].display_name : null;

    const result = await client.query(
      `UPDATE contacts SET apt=$1,title=$2,first_name=$3,last_name=$4,father_name=$5,phone_home=$6,phone_mobile=$7,
       street=$8,house_num=$9,city=$10,zip=$11,email=$12,display_name=$13,updated_by=$14,updated_at=NOW()
       WHERE id=$15 RETURNING *`,
      [apt,title,first_name,last_name,father_name,phone_home,phone_mobile,street,house_num,city,zip,email,display_name,req.user.id,req.params.id]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'איש קשר לא נמצא' });
    }

    // שינוי שם -> עדכון מדורג של כל מה שמפתח לפי השם.
    // הכל בטרנזקציה אחת: או שהכל מתעדכן, או ששום דבר לא - אחרת נשארות
    // רשומות שמצביעות לשם שכבר לא קיים (הזכויות והיומן נשכחו קודם).
    let renamed = { vows: 0, payments: 0, credits: 0, reports: 0 };
    let cascade = null;
    if (oldName && display_name && oldName !== display_name) {
      cascade = await renameCascade(client, oldName, display_name, req.user.id);
      renamed = cascade.counts;
    }
    await client.query('COMMIT');

    // סנכרון לגיליון רק אחרי שהטרנזקציה נסגרה בהצלחה
    if (cascade) {
      syncCascade(cascade.rows, req.user.username);
      await logAction(req.user.id, req.user.username, 'rename', 'contacts', req.params.id, { from: oldName, to: display_name, ...renamed });
    }
    await logAction(req.user.id, req.user.username, 'edit', 'contacts', req.params.id, { display_name });
    syncContact('edit', result.rows[0], req.user.username);
    res.json(Object.assign({}, result.rows[0], { renamed }));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('contact update error:', err.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  } finally {
    client.release();
  }
});

// DELETE /api/contacts/:id
router.delete('/:id', authenticate, requireDelete, async (req, res) => {
  try {
    await pool.query('DELETE FROM contacts WHERE id = $1', [req.params.id]);
    await logAction(req.user.id, req.user.username, 'delete', 'contacts', req.params.id, {});
    syncContact('delete', { id: req.params.id }, req.user.username);
    res.json({ message: 'איש קשר נמחק' });
  } catch (err) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
