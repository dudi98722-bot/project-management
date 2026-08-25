// שליחת מייל דרך SMTP. אם לא הוגדרו פרטי SMTP — enabled() מחזיר false
// והקוד שקורא מחליט מה לעשות (בשחזור סיסמה: נכשל בשקט כלפי חוץ, ונרשם ללוג).
const nodemailer = require('nodemailer');

function cfg() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return {
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    from: SMTP_FROM || SMTP_USER,
  };
}
function enabled() { return !!cfg(); }

let _t = null;
function transport(c) {
  if (!_t) _t = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: c.auth });
  return _t;
}

async function send({ to, subject, html, text }) {
  const c = cfg();
  if (!c) throw new Error('SMTP לא מוגדר');
  await transport(c).sendMail({ from: c.from, to, subject, html, text });
}

async function verify() {
  const c = cfg();
  if (!c) throw new Error('SMTP לא מוגדר — חסרים SMTP_HOST / SMTP_USER / SMTP_PASS');
  await transport(c).verify();
  return { host: c.host, port: c.port, from: c.from };
}

module.exports = { enabled, send, verify };
