const express = require('express');
const { pool, logAction } = require('../db');
const { authenticate, requireWrite, requireDelete } = require('../middleware/auth');
const { syncContact, syncVow, syncPayment } = require('../sheets');
const router = express.Router();

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
    let uvRows = [], upRows = [];
    if (oldName && display_name && oldName !== display_name) {
      const uv = await client.query('UPDATE vows SET name=$1, updated_by=$2, updated_at=NOW() WHERE name=$3 RETURNING *', [display_name, req.user.id, oldName]);
      const up = await client.query('UPDATE payments SET name=$1, updated_by=$2, updated_at=NOW() WHERE name=$3 RETURNING *', [display_name, req.user.id, oldName]);
      const uc = await client.query('UPDATE credits SET person_name=$1 WHERE person_name=$2', [display_name, oldName]);
      const ur = await client.query('UPDATE report_log SET person_name=$1 WHERE person_name=$2', [display_name, oldName]);
      renamed = { vows: uv.rowCount, payments: up.rowCount, credits: uc.rowCount, reports: ur.rowCount };
      uvRows = uv.rows; upRows = up.rows;
    }
    await client.query('COMMIT');

    // סנכרון לגיליון רק אחרי שהטרנזקציה נסגרה בהצלחה
    if (oldName && display_name && oldName !== display_name) {
      uvRows.forEach(r => syncVow('edit', r, req.user.username));
      upRows.forEach(r => syncPayment('edit', r, req.user.username));
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
