const express = require('express');
const { pool, logAction } = require('../db');
const { authenticate, requireWrite, requireDelete } = require('../middleware/auth');
const { syncContact } = require('../sheets');
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
router.post('/', authenticate, requireWrite, async (req, res) => {
  const { id, apt, title, first_name, last_name, father_name, phone_home, phone_mobile, street, house_num, city, zip, email, display_name } = req.body;
  if (!first_name || !last_name) return res.status(400).json({ error: 'שם פרטי ושם משפחה חובה' });
  const cid = /^\d+$/.test(String(id)) ? Number(id) : null;
  try {
    let result;
    if (cid !== null) {
      result = await pool.query(
        `INSERT INTO contacts (id,apt,title,first_name,last_name,father_name,phone_home,phone_mobile,street,house_num,city,zip,email,display_name,created_by,updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
         ON CONFLICT (id) DO UPDATE SET apt=$2,title=$3,first_name=$4,last_name=$5,father_name=$6,phone_home=$7,phone_mobile=$8,street=$9,house_num=$10,city=$11,zip=$12,email=$13,display_name=$14,updated_by=$15,updated_at=NOW()
         RETURNING *`,
        [cid,apt,title,first_name,last_name,father_name,phone_home,phone_mobile,street,house_num,city,zip,email,display_name,req.user.id]
      );
    } else {
      result = await pool.query(
        `INSERT INTO contacts (apt,title,first_name,last_name,father_name,phone_home,phone_mobile,street,house_num,city,zip,email,display_name,created_by,updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING *`,
        [apt,title,first_name,last_name,father_name,phone_home,phone_mobile,street,house_num,city,zip,email,display_name,req.user.id]
      );
    }
    await logAction(req.user.id, req.user.username, 'add', 'contacts', result.rows[0].id, { display_name });
    syncContact('add', result.rows[0], req.user.username);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// PUT /api/contacts/:id
router.put('/:id', authenticate, requireWrite, async (req, res) => {
  const { apt, title, first_name, last_name, father_name, phone_home, phone_mobile, street, house_num, city, zip, email, display_name } = req.body;
  try {
    const result = await pool.query(
      `UPDATE contacts SET apt=$1,title=$2,first_name=$3,last_name=$4,father_name=$5,phone_home=$6,phone_mobile=$7,
       street=$8,house_num=$9,city=$10,zip=$11,email=$12,display_name=$13,updated_by=$14,updated_at=NOW()
       WHERE id=$15 RETURNING *`,
      [apt,title,first_name,last_name,father_name,phone_home,phone_mobile,street,house_num,city,zip,email,display_name,req.user.id,req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'איש קשר לא נמצא' });
    await logAction(req.user.id, req.user.username, 'edit', 'contacts', req.params.id, { display_name });
    syncContact('edit', result.rows[0], req.user.username);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'שגיאת שרת' });
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
