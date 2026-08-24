const jwt = require('jsonwebtoken');

// ===== מטריצת הרשאות =====
//  manageUsers  - ניהול משתמשים
//  edit         - יצירה/עריכה של רשומות
//  del          - מחיקה רכה ושחזור מסל המחזור
//  viewReports  - צפייה בדשבורד ובכל הדוחות
//  scribeReport - צפייה בדוח סופר בלבד (למי שאין לו viewReports)
//  finance      - צד הכסף של הלקוחות: תשלומי לקוחות, הוצאות עסק,
//                 ומחירי המכירה והרווח בלשונית ס"ת
//  view         - צפייה בנתונים
//
// scribeops (ניהול סופרים): רואה רק את מה שנוגע לעבודה מול הסופרים —
// הגדרות, דוח סופר, תשלום לסופר, הוצאות לספר, רכישות ומכירות.
// אין לו גישה לתשלומי לקוחות, להוצאות העסק, לדשבורד ולשאר הדוחות,
// ומחירי הרוכש והרווח נחסכים ממנו גם בנתונים שהשרת שולח.
const ROLES = {
  admin:     { label: 'מנהל ראשי',    manageUsers: true,  edit: true,  del: true,  viewReports: true,  scribeReport: true, finance: true,  view: true },
  manager:   { label: 'מנהל',         manageUsers: false, edit: true,  del: true,  viewReports: true,  scribeReport: true, finance: true,  view: true },
  clerk:     { label: 'פקיד',         manageUsers: false, edit: true,  del: false, viewReports: true,  scribeReport: true, finance: true,  view: true },
  scribeops: { label: 'ניהול סופרים', manageUsers: false, edit: true,  del: false, viewReports: false, scribeReport: true, finance: false, view: true },
  viewer:    { label: 'צופה',         manageUsers: false, edit: false, del: false, viewReports: true,  scribeReport: true, finance: true,  view: true }
};

function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'לא מחובר למערכת' });
  }
  try {
    const token = auth.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    req.caps = ROLES[decoded.role] || ROLES.viewer;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'פג תוקף החיבור, יש להתחבר מחדש' });
  }
}

function can(capability) {
  return (req, res, next) => {
    if (req.caps && req.caps[capability]) return next();
    return res.status(403).json({ error: 'אין לך הרשאה לפעולה זו' });
  };
}

// שדות כספיים של צד הרוכש — נחסכים ממי שאין לו הרשאת finance.
// החיסכון נעשה בשרת ולא בממשק, אחרת המידע היה נשלח ורק מוסתר.
const BUYER_FIELDS = [
  'buyer_total', 'buyer_currency', 'buyer_page_rate', 'buyer_due_progress',
  'customer_paid', 'buyer_balance_now', 'buyer_balance_total',
  'expected_profit', 'peritah_cost', 'customer_id', 'customer_name', 'sale_date',
];

function scrubBuyer(row) {
  if (!row) return row;
  const out = Object.assign({}, row);
  for (const f of BUYER_FIELDS) delete out[f];
  return out;
}
const scrubBuyerAll = (rows) => Array.isArray(rows) ? rows.map(scrubBuyer) : rows;

module.exports = { authenticate, can, ROLES, scrubBuyer, scrubBuyerAll };
