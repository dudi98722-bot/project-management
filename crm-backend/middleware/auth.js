const jwt = require('jsonwebtoken');

const ROLES = {
  admin:     { level: 4, canRead: true, canWrite: true, canDelete: true, canManageUsers: true, canPayments: true },
  editor:    { level: 3, canRead: true, canWrite: true, canDelete: false, canManageUsers: false, canPayments: true },
  treasurer: { level: 2, canRead: true, canWrite: false, canDelete: false, canManageUsers: false, canPayments: true },
  viewer:    { level: 1, canRead: true, canWrite: false, canDelete: false, canManageUsers: false, canPayments: false }
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
    req.userRole = ROLES[decoded.role] || ROLES.viewer;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'פג תוקף החיבור, יש להתחבר מחדש' });
  }
}

function requireWrite(req, res, next) {
  if (!req.userRole.canWrite) return res.status(403).json({ error: 'אין הרשאה לביצוע פעולה זו' });
  next();
}

function requireDelete(req, res, next) {
  if (!req.userRole.canDelete) return res.status(403).json({ error: 'אין הרשאת מחיקה' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.userRole.canManageUsers) return res.status(403).json({ error: 'נדרשות הרשאות מנהל' });
  next();
}

function requirePayments(req, res, next) {
  if (!req.userRole.canPayments) return res.status(403).json({ error: 'אין הרשאה לצפות בתשלומים' });
  next();
}

module.exports = { authenticate, requireWrite, requireDelete, requireAdmin, requirePayments, ROLES };
