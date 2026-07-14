// אתחול מסד הנתונים: יצירת סכימה + משתמש מנהל + נתוני דמו (אם ריק)
// הרצה:  node scripts/init_db.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');

async function main() {
  console.log('▶ יוצר סכימה...');
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);

  // ----- משתמש מנהל -----
  // אין סיסמת ברירת-מחדל ידועה: אם ADMIN_PASSWORD ריק - מייצרים אקראית ומדפיסים פעם אחת
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  let adminPass = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!adminPass) { adminPass = crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12); generated = true; }
  const existing = await pool.query('SELECT id FROM users WHERE username=$1', [adminUser]);
  if (!existing.rows.length) {
    const hash = await bcrypt.hash(adminPass, 10);
    await pool.query('INSERT INTO users (username, password_hash, role, full_name) VALUES ($1,$2,$3,$4)',
      [adminUser, hash, 'admin', 'מנהל']);
    console.log(`✔ נוצר מנהל: ${adminUser} / ${adminPass}`);
    if (generated) console.log('  ⚠️  סיסמא אקראית נוצרה (ADMIN_PASSWORD היה ריק) — שמור אותה עכשיו!');
  } else {
    console.log(`• מנהל ${adminUser} כבר קיים`);
  }

  // ----- משתמשי דמו לכל תפקיד - לא נוצרים בפרודקשן -----
  // ברירת מחדל: נוצרים רק בפיתוח. להפעלה מפורשת: SEED_DEMO=true
  const seedDemo = process.env.SEED_DEMO === 'true' || process.env.NODE_ENV !== 'production';
  if (!seedDemo) {
    console.log('• דילוג על משתמשי דמו (NODE_ENV=production). להפעלה: SEED_DEMO=true');
  } else {
    const demoPass = process.env.DEMO_PASSWORD || crypto.randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
    const demoUsers = [
      ['secretary', 'secretary', 'מזכירה'],
      ['owner',     'owner',     'בעל עסק'],
      ['reporter',  'reporter',  'אמיתי (מדווח)'],
      ['field',     'field',     'עובד שטח'],
      ['home',      'home',      'בית'],
    ];
    let createdDemo = false;
    for (const [username, role, full] of demoUsers) {
      const ex = await pool.query('SELECT id FROM users WHERE username=$1', [username]);
      if (!ex.rows.length) {
        const hash = await bcrypt.hash(demoPass, 10);
        await pool.query('INSERT INTO users (username, password_hash, role, full_name) VALUES ($1,$2,$3,$4)',
          [username, hash, role, full]);
        createdDemo = true;
      }
    }
    if (createdDemo) console.log(`✔ נוצרו משתמשי דמו (secretary/owner/reporter/field/home) עם סיסמא: ${demoPass}`);
  }

  // ----- נתוני דמו (רק אם אין פרויקטים) -----
  const hasProjects = await pool.query('SELECT 1 FROM projects LIMIT 1');
  if (!hasProjects.rows.length) {
    console.log('▶ מזין נתוני דמו...');
    const admin = await pool.query('SELECT id FROM users WHERE role=$1 LIMIT 1', ['admin']);
    const uid = admin.rows[0].id;

    // קבלני משנה
    const subs = {};
    for (const [name, trade, phone] of [
      ['אבי שרברב', 'אינסטלציה', '050-1111111'],
      ['משה חשמלאי', 'חשמל', '050-2222222'],
      ['יוסי רצף', 'ריצוף', '050-3333333'],
      ['דוד צבעי', 'צבע וגמר', '050-4444444'],
    ]) {
      const r = await pool.query('INSERT INTO subcontractors (name, trade, phone, created_by, updated_by) VALUES ($1,$2,$3,$4,$4) RETURNING id', [name, trade, phone, uid]);
      subs[trade] = r.rows[0].id;
    }

    // פרויקט לדוגמה - שיפוץ דירה 100,000, רווח צפוי 40,000
    const proj = await pool.query(
      `INSERT INTO projects (name, client_name, client_phone, address, expected_profit, start_date, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
      ['שיפוץ דירה - רחוב הרצל 5', 'ישראל כהן', '052-9999999', 'רחוב הרצל 5, בני ברק', 40000, '2026-06-01', uid]);
    const pid = proj.rows[0].id;

    const stageDefs = [
      ['הריסה + אינסטלציה', 30000, 18000, 'אינסטלציה'],
      ['ריצוף',            40000, 25000, 'ריצוף'],
      ['גמר + צבע',        30000, 15000, 'צבע וגמר'],
    ];
    const stageIds = [];
    let seq = 0;
    for (const [name, ca, sa, trade] of stageDefs) {
      seq++;
      const s = await pool.query(
        `INSERT INTO stages (project_id, name, seq, client_amount, sub_amount, subcontractor_id, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
        [pid, name, seq, ca, sa, subs[trade], uid]);
      stageIds.push({ id: s.rows[0].id, sub: subs[trade] });
    }

    // תנועות: מקדמה מהלקוח לשלב 1, ותשלום חלקי לשרברב
    await pool.query(
      `INSERT INTO transactions (type, direction, amount, date, project_id, stage_id, created_by, updated_by)
       VALUES ('client_payment','in',15000,'2026-06-05',$1,$2,$3,$3)`, [pid, stageIds[0].id, uid]);
    await pool.query(
      `INSERT INTO transactions (type, direction, amount, date, project_id, stage_id, subcontractor_id, created_by, updated_by)
       VALUES ('sub_payment','out',9000,'2026-06-10',$1,$2,$3,$4,$4)`, [pid, stageIds[0].id, stageIds[0].sub, uid]);
    // הוצאה כללית לפרויקט (כלי מטמבור)
    await pool.query(
      `INSERT INTO transactions (type, direction, amount, date, project_id, supplier, purpose, created_by, updated_by)
       VALUES ('project_expense','out',2000,'2026-06-08',$1,'טמבור','כלי עבודה לפרויקט',$2,$2)`, [pid, uid]);
    // הוצאת עסק כללית (משכורת)
    await pool.query(
      `INSERT INTO transactions (type, direction, amount, date, supplier, purpose, created_by, updated_by)
       VALUES ('business_expense','out',10000,'2026-06-30','—','משכורת עובד',$1,$1)`, [uid]);

    // בית
    const home = await pool.query('SELECT id FROM users WHERE username=$1', ['home']);
    const hid = home.rows.length ? home.rows[0].id : uid;
    for (const [date, amount, category, payee] of [
      ['2026-06-03', 450, 'מזון', 'סופר'],
      ['2026-06-07', 320, 'חשמל', 'חברת חשמל'],
      ['2026-06-12', 200, 'דלק', 'פז'],
    ]) {
      await pool.query(
        `INSERT INTO home_transactions (date, direction, amount, category, payee, source, created_by, updated_by)
         VALUES ($1,'out',$2,$3,$4,'form',$5,$5)`, [date, amount, category, payee, hid]);
    }
    console.log('✔ נתוני דמו הוזנו');
  } else {
    console.log('• כבר קיימים פרויקטים - מדלג על נתוני דמו');
  }

  console.log('✅ סיום אתחול');
  await pool.end();
}

main().catch(e => { console.error('❌ שגיאה:', e); process.exit(1); });
