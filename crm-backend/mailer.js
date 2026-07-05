/**
 * שליחת מייל מהשרת + בניית דוח אישי מעוצב (לטרהד אלכסנדר).
 * פרטי המייל נשמרים בטבלת app_settings (המנהל מזין אותם דרך הממשק).
 */
const nodemailer = require('nodemailer');
const { pool } = require('./db');

const BASE_URL = process.env.PUBLIC_URL || 'https://alexander-aliyot.dudi-ananalytics.com';

async function getEmailSettings() {
  const r = await pool.query("SELECT value FROM app_settings WHERE key='email'");
  if (!r.rows.length) return null;
  try { return JSON.parse(r.rows[0].value); } catch { return null; }
}

async function saveEmailSettings(obj) {
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ('email', $1)
     ON CONFLICT (key) DO UPDATE SET value=$1`,
    [JSON.stringify(obj)]
  );
}

async function getTransporter() {
  const s = await getEmailSettings();
  if (!s || !s.user || !s.pass) throw new Error('email_not_configured');
  return nodemailer.createTransport({
    host: s.host || 'smtp.gmail.com',
    port: s.port || 465,
    secure: (s.port || 465) === 465,
    auth: { user: s.user, pass: s.pass }
  });
}

function ils(n) { return '₪' + (Number(n) || 0).toLocaleString('he-IL'); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function d10(d) { return d ? String(d).slice(0, 10) : ''; }

/** בונה HTML מעוצב של דוח אישי עבור שם נתון */
async function buildPersonalReport(name) {
  const vowsRes = await pool.query(`
    SELECT v.*, COALESCE(SUM(p.amount),0) AS paid
    FROM vows v LEFT JOIN payments p ON p.vow_id = v.id
    WHERE v.name = $1 GROUP BY v.id ORDER BY v.date`, [name]);
  const payRes = await pool.query('SELECT * FROM payments WHERE name=$1 ORDER BY date', [name]);

  const vows = vowsRes.rows, pays = payRes.rows;
  let totalVow = 0, totalPaid = 0;
  vows.forEach(v => { totalVow += Number(v.amount) || 0; totalPaid += Number(v.paid) || 0; });
  const balance = totalVow - totalPaid;

  const gold = '#b8902f', brown = '#5a3a22', cream = '#f7f0db', line = '#e0d3a8';
  const today = new Date().toLocaleDateString('he-IL');

  const vowRows = vows.length ? vows.map(v => {
    const bal = (Number(v.amount) || 0) - (Number(v.paid) || 0);
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid ${line}">${esc(v.hebrew_date) || d10(v.date)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid ${line}">${esc([v.for_a, v.for_b].filter(Boolean).join(' / ')) || '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid ${line};text-align:left">${ils(v.amount)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid ${line};text-align:left;color:#2e7d32">${ils(v.paid)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid ${line};text-align:left;color:${bal > 0 ? '#c62828' : '#2e7d32'};font-weight:bold">${ils(bal)}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="5" style="padding:12px;text-align:center;color:#888">אין התחייבויות</td></tr>`;

  const payRows = pays.length ? pays.map(p => `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid ${line}">${esc(p.hebrew_date) || d10(p.date)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid ${line}">${esc(p.method) || '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid ${line};text-align:left;color:#2e7d32">${ils(p.amount)}</td>
    </tr>`).join('') : `<tr><td colspan="3" style="padding:12px;text-align:center;color:#888">אין תשלומים</td></tr>`;

  return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"></head>
<body style="margin:0;background:#eee;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:660px;margin:0 auto;background:${cream}">
  <img src="${BASE_URL}/assets/letterhead_header.jpg" alt="בית המדרש הגדול אלכסנדר" style="width:100%;display:block">
  <div style="padding:24px 34px">
    <div style="text-align:center;margin-bottom:18px">
      <div style="font-size:24px;font-weight:bold;color:${brown}">דוח אישי</div>
      <div style="font-size:20px;color:${gold};margin-top:4px;font-weight:bold">${esc(name)}</div>
      <div style="font-size:13px;color:#777;margin-top:4px">נכון לתאריך ${today}</div>
    </div>

    <div style="font-size:16px;font-weight:bold;color:${brown};border-bottom:2px solid ${gold};padding-bottom:5px;margin:18px 0 8px">נדרים והתחייבויות</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#efe5c4;color:${brown}">
        <th style="padding:9px 10px;text-align:right">תאריך</th>
        <th style="padding:9px 10px;text-align:right">עבור</th>
        <th style="padding:9px 10px;text-align:left">סכום</th>
        <th style="padding:9px 10px;text-align:left">שולם</th>
        <th style="padding:9px 10px;text-align:left">יתרה</th>
      </tr></thead><tbody>${vowRows}</tbody>
    </table>

    <div style="font-size:16px;font-weight:bold;color:${brown};border-bottom:2px solid ${gold};padding-bottom:5px;margin:24px 0 8px">תשלומים</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#efe5c4;color:${brown}">
        <th style="padding:9px 10px;text-align:right">תאריך</th>
        <th style="padding:9px 10px;text-align:right">אופן תשלום</th>
        <th style="padding:9px 10px;text-align:left">סכום</th>
      </tr></thead><tbody>${payRows}</tbody>
    </table>

    <table style="width:100%;border-collapse:collapse;margin-top:24px;background:#fff;border:2px solid ${gold};border-radius:8px">
      <tr>
        <td style="padding:14px;text-align:center;border-left:1px solid ${line}"><div style="font-size:12px;color:#777">סך התחייבות</div><div style="font-size:19px;font-weight:bold;color:${brown}">${ils(totalVow)}</div></td>
        <td style="padding:14px;text-align:center;border-left:1px solid ${line}"><div style="font-size:12px;color:#777">סך ששולם</div><div style="font-size:19px;font-weight:bold;color:#2e7d32">${ils(totalPaid)}</div></td>
        <td style="padding:14px;text-align:center"><div style="font-size:12px;color:#777">יתרה לתשלום</div><div style="font-size:19px;font-weight:bold;color:${balance > 0 ? '#c62828' : '#2e7d32'}">${ils(balance)}</div></td>
      </tr>
    </table>

    <div style="text-align:center;margin-top:22px;font-size:14px;color:${brown}">תשואת חן וברכת ידידות<br>בית המדרש הגדול אלכסנדר</div>
  </div>
  <img src="${BASE_URL}/assets/letterhead_footer.jpg" alt="אלכסנדר" style="width:100%;display:block">
</div>
</body></html>`;
}

async function sendPersonalReport(name, toEmail) {
  const s = await getEmailSettings();
  if (!s || !s.user || !s.pass) throw new Error('email_not_configured');
  const transporter = await getTransporter();
  const html = await buildPersonalReport(name);
  await transporter.sendMail({
    from: `"${s.fromName || 'בית המדרש אלכסנדר'}" <${s.user}>`,
    to: toEmail,
    subject: `דוח אישי - ${name}`,
    html
  });
}

module.exports = { getEmailSettings, saveEmailSettings, sendPersonalReport, buildPersonalReport };
