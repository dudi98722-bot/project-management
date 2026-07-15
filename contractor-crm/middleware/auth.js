const jwt = require('jsonwebtoken');

// ===== מטריצת הרשאות =====
// caps = יכולות. כל route בודק את היכולת הרלוונטית.
//  manageUsers   - ניהול משתמשים
//  viewBusiness  - צפייה בצד העסקי (פרויקטים/תנועות)
//  editProjects  - יצירה/עריכה של פרויקטים, שלבים, קבלני משנה
//  writeTx       - הזנת תנועות (הכנסות/הוצאות)
//  projectExpenseOnly - רק הזנת הוצאה לפרויקט + העלאת חשבונית (עובד שטח)
//  del           - מחיקה רכה בודדת
//  multiDelete   - מחיקה מרובה
//  viewReports   - צפייה בדוחות
//  home          - מודול הבית
const ROLES = {
  // מנהל ראשי - הכל (כולל ניהול משתמשים)
  admin:     { label:'מנהל ראשי', manageUsers:true,  viewBusiness:true,  editProjects:true,  writeTx:true,  projectExpenseOnly:true,  del:true,  multiDelete:true,  viewReports:true,  home:true  },
  // מזכירה - הכל חוץ ממחיקה מרובה וניהול משתמשים
  secretary: { label:'מזכירה',    manageUsers:false, viewBusiness:true,  editProjects:true,  writeTx:true,  projectExpenseOnly:true,  del:true,  multiDelete:false, viewReports:true,  home:false },
  // מנהל - כל ההזנות (פרויקט/עסק/לקוחות/קבלן) + בית + כל הדוחות, בלי ניהול משתמשים
  owner:     { label:'מנהל',      manageUsers:false, viewBusiness:true,  editProjects:true,  writeTx:true,  projectExpenseOnly:true,  del:false, multiDelete:false, viewReports:true,  home:true  },
  // מדווח - כל ההזנות (פרויקט/עסק/לקוחות/קבלן) + צפייה בדוחות העסק, בלי בית
  reporter:  { label:'מדווח',     manageUsers:false, viewBusiness:true,  editProjects:false, writeTx:true,  projectExpenseOnly:true,  del:false, multiDelete:false, viewReports:true,  home:false },
  // עובד שטח - רק הזנת הוצאה לפרויקט + חשבוניות
  field:     { label:'עובד שטח',  manageUsers:false, viewBusiness:false, editProjects:false, writeTx:false, projectExpenseOnly:true,  del:false, multiDelete:false, viewReports:false, home:false },
  // אשה - רק מודול הבית
  home:      { label:'בית',       manageUsers:false, viewBusiness:false, editProjects:false, writeTx:false, projectExpenseOnly:false, del:true,  multiDelete:false, viewReports:false, home:true  }
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
    req.caps = ROLES[decoded.role] || ROLES.field;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'פג תוקף החיבור, יש להתחבר מחדש' });
  }
}

// בודק יכולת מסוימת
function can(capability) {
  return (req, res, next) => {
    if (req.caps && req.caps[capability]) return next();
    return res.status(403).json({ error: 'אין לך הרשאה לפעולה זו' });
  };
}

// מאשר אם יש למשתמש לפחות אחת מהיכולות ברשימה
function canAny(caps) {
  return (req, res, next) => {
    if (req.caps && caps.some(c => req.caps[c])) return next();
    return res.status(403).json({ error: 'אין לך הרשאה לפעולה זו' });
  };
}

module.exports = { authenticate, can, canAny, ROLES };
