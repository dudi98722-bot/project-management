const express = require('express');
const { pool, logAction } = require('../db');
const { authenticate, requireWrite } = require('../middleware/auth');
const router = express.Router();

const DEFAULT_METHODS = ['מזומן', 'שיק', 'העברה בנקאית', 'כרטיס אשראי', 'פייבוקס', 'ביט'];
const DEFAULT_TITLES = ['הרב', 'הר"ר', "ר'", 'מר', 'גב\'', 'משפ\''];

async function getSetting(key, fallback) {
  const r = await pool.query('SELECT value FROM app_settings WHERE key=$1', [key]);
  if (!r.rows.length) return fallback;
  try { return JSON.parse(r.rows[0].value); } catch { return fallback; }
}
async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value=$2`,
    [key, JSON.stringify(value)]
  );
}

// GET payment methods
router.get('/methods', authenticate, async (req, res) => {
  try { res.json(await getSetting('payment_methods', DEFAULT_METHODS)); }
  catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

// POST payment methods (write access)
router.post('/methods', authenticate, requireWrite, async (req, res) => {
  const { methods } = req.body;
  if (!Array.isArray(methods)) return res.status(400).json({ error: 'רשימה לא תקינה' });
  const clean = methods.map(m => String(m).trim()).filter(Boolean);
  try {
    await setSetting('payment_methods', clean);
    await logAction(req.user.id, req.user.username, 'edit', 'settings', 0, { what: 'payment_methods' });
    res.json({ message: 'נשמר', methods: clean });
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

const DEFAULT_BLESSING = 'יהי רצון שיקוים בו מקרא שכתוב: "וּבָחַנוּנִי נָא בָּזֹאת" —\nויתברך בכל מילי דמיטב, בבריאות איתנה ונחת מכל יוצאי חלציו,\nמתוך הרחבת הדעת ושפע ברכה והצלחה.';

// GET / POST נוסח הברכה הקבועה בקבלה
router.get('/blessing', authenticate, async (req, res) => {
  try { res.json({ text: await getSetting('receipt_blessing', DEFAULT_BLESSING) }); }
  catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});
router.post('/blessing', authenticate, requireWrite, async (req, res) => {
  const { text } = req.body;
  if (typeof text !== 'string') return res.status(400).json({ error: 'נוסח לא תקין' });
  try {
    await setSetting('receipt_blessing', text);
    await logAction(req.user.id, req.user.username, 'edit', 'settings', 0, { what: 'receipt_blessing' });
    res.json({ message: 'נשמר', text });
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

// GET lists (עבור א / עבור ב) — null אם עוד לא נשמרו (הלקוח ייפול חזרה לרשימת הבסיס)
router.get('/lists', authenticate, async (req, res) => {
  try { res.json(await getSetting('lists', null)); }
  catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

/**
 * POST lists — מיזוג, לא דריסה.
 *
 * רקע: בעבר הלקוח שלח את כל הרשימה והשרת דרס. דפדפן שנשאר פתוח מהבוקר
 * החזיק עותק ישן, וברגע שנסגר בו חלון הרשימות הוא החזיר את המצב הישן
 * ומחק קטגוריות שעובד אחר הוסיף בינתיים (נצפה בלוג: 165 -> 142 פריטים).
 *
 * עכשיו הלקוח שולח רק את מה שהשתנה — {addA, delA, addB, delB} — והשרת
 * מחיל את זה על המצב העדכני, תחת נעילה. לקוח ישן ששולח {table1, table2}
 * מלאים מטופל כאיחוד בלבד: הוא יכול להוסיף, לעולם לא למחוק.
 */
router.post('/lists', authenticate, requireWrite, async (req, res) => {
  const { addA, delA, addB, delB, table1, table2 } = req.body;
  const arr = v => Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : [];
  const isDelta = [addA, delA, addB, delB].some(Array.isArray);
  if (!isDelta && !Array.isArray(table1) && !Array.isArray(table2))
    return res.status(400).json({ error: 'רשימות לא תקינות' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // נעילה לאורך הטרנזקציה — שתי שמירות במקביל לא ידרסו זו את זו
    await client.query("SELECT pg_advisory_xact_lock(hashtext('crm_lists'))");
    const cur = await client.query("SELECT value FROM app_settings WHERE key='lists' FOR UPDATE");
    let base = { table1: [], table2: [] };
    if (cur.rows.length) {
      try {
        const prev = JSON.parse(cur.rows[0].value);
        base = { table1: arr(prev.table1), table2: arr(prev.table2) };
      } catch { /* ערך פגום — מתחילים מריק ומוסיפים עליו */ }
    }

    const applied = { added: [], removed: [] };
    const apply = (list, add, del) => {
      const seen = new Set(list);
      const out = list.slice();
      add.forEach(x => { if (!seen.has(x)) { seen.add(x); out.push(x); applied.added.push(x); } });
      if (!del.length) return out;
      const kill = new Set(del);
      return out.filter(x => {
        if (!kill.has(x)) return true;
        applied.removed.push(x);
        return false;
      });
    };

    const next = isDelta
      ? { table1: apply(base.table1, arr(addA), arr(delA)),
          table2: apply(base.table2, arr(addB), arr(delB)) }
      // תאימות לאחור: לקוח ישן -> איחוד בלבד, בלי מחיקות
      : { table1: apply(base.table1, arr(table1), []),
          table2: apply(base.table2, arr(table2), []) };

    next.table1.sort((a, b) => a.localeCompare(b, 'he'));
    next.table2.sort((a, b) => a.localeCompare(b, 'he'));

    await client.query(
      `INSERT INTO app_settings (key, value) VALUES ('lists', $1)
       ON CONFLICT (key) DO UPDATE SET value=$1`,
      [JSON.stringify(next)]
    );
    await client.query('COMMIT');

    // רושמים מה באמת השתנה, כדי שתמיד יהיה אפשר לדעת מי הוסיף/מחק מה
    await logAction(req.user.id, req.user.username, 'edit', 'settings', 0, {
      what: 'lists', mode: isDelta ? 'delta' : 'legacy-merge',
      added: applied.added, removed: applied.removed,
      table1: next.table1.length, table2: next.table2.length
    });
    res.json({ message: 'נשמר', ...next, added: applied.added, removed: applied.removed });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('lists save error:', e.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  } finally {
    client.release();
  }
});

// GET contact titles
router.get('/titles', authenticate, async (req, res) => {
  try { res.json(await getSetting('contact_titles', DEFAULT_TITLES)); }
  catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

// POST contact titles (write access)
router.post('/titles', authenticate, requireWrite, async (req, res) => {
  const { titles } = req.body;
  if (!Array.isArray(titles)) return res.status(400).json({ error: 'רשימה לא תקינה' });
  const clean = titles.map(t => String(t).trim()).filter(Boolean);
  try {
    await setSetting('contact_titles', clean);
    await logAction(req.user.id, req.user.username, 'edit', 'settings', 0, { what: 'contact_titles' });
    res.json({ message: 'נשמר', titles: clean });
  } catch (e) { res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = router;
