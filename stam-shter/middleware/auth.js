const jwt = require('jsonwebtoken');

// ===== מטריצת הרשאות =====
//  manageUsers - ניהול משתמשים
//  edit        - יצירה/עריכה של רשומות
//  del         - מחיקה רכה ושחזור מסל המחזור
//  viewReports - צפייה בדוחות ובדשבורד
//  view        - צפייה בנתונים
const ROLES = {
  admin:   { label: 'מנהל ראשי', manageUsers: true,  edit: true,  del: true,  viewReports: true, view: true },
  manager: { label: 'מנהל',      manageUsers: false, edit: true,  del: true,  viewReports: true, view: true },
  clerk:   { label: 'פקיד',      manageUsers: false, edit: true,  del: false, viewReports: true, view: true },
  viewer:  { label: 'צופה',      manageUsers: false, edit: false, del: false, viewReports: true, view: true }
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

module.exports = { authenticate, can, ROLES };
