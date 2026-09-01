const jwt = require('jsonwebtoken');
const { pool } = require('../db');

// ===== מטריצת הרשאות =====
// ההרשאות מפורקות דק כדי לתמוך בתפקידים חלקיים (מזכירה שעורכת רק שם ושעות,
// מדריך שנוגע רק באבחנה ובהערה המקצועית).
//
//  manageUsers        ניהול משתמשים
//  addPatient         הוספת מטופל חדש
//  editPatient        עריכת כל פרטי המטופל
//  editPatientLimited עריכת שם המטופל והשעות המתאימות בלבד
//  viewDiagnosis      צפייה באבחנה
//  editDiagnosis      עריכת אבחנה
//  viewNote2          צפייה בהערה המקצועית
//  editNote2          עריכת ההערה המקצועית
//  editNotes          עריכת הערות כלליות (לא ההערה המקצועית)
//  editPref           עריכת השיוך למטפלים ולקבוצות
//  editUrgency        עריכת רמת הדחיפות
//  editClientType     עריכת השדה בן/בת
//  assign             שיבוץ לטיפול, פגישות וסדרות
//  viewAssign         צפייה במסך השיבוץ ובמשבצות הפנויות, בלי לשבץ בפועל
//  holds              ניהול רשימת ההשהיה (הוספה, הערה, הסרה)
//  viewHolds          צפייה ברשימת ההשהיה ובסימוני ההשהיה שברשימת הממתינים
//  files              צירוף קבצים למטופל
//  del                מחיקה רכה וביטול סדרות
//  view               צפייה בנתונים ובלוח השנה
//
// edit נשאר כשער כללי לעריכת ישויות שאינן מטופל (מטפלים, קבוצות, חגים, רשימות).
const R = (label, desc, c) => Object.assign({ label, desc,
  manageUsers: false, addPatient: false, editPatient: false, editPatientLimited: false,
  viewDiagnosis: false, editDiagnosis: false, viewNote2: false, editNote2: false,
  editNotes: false, editPref: false, editUrgency: false, editClientType: false,
  assign: false, viewAssign: false, holds: false, files: false,
  del: false, edit: false, view: true, viewHolds: true }, c);

const ROLES = {
  admin: R('מנהל ראשי',
    'הכל: מטופלים, שיבוץ, מחיקה, וניהול משתמשים.', {
    manageUsers: true, addPatient: true, editPatient: true, editPatientLimited: true,
    viewDiagnosis: true, editDiagnosis: true, viewNote2: true, editNote2: true,
    editNotes: true, editPref: true, editUrgency: true, editClientType: true,
    assign: true, viewAssign: true, holds: true, files: true, del: true, edit: true }),

  // מזכירה אחראית — הכל פתוח מלבד ניהול משתמשים
  head_secretary: R('מזכירה אחראית',
    'הכל מלבד ניהול משתמשים.', {
    addPatient: true, editPatient: true, editPatientLimited: true,
    viewDiagnosis: true, editDiagnosis: true, viewNote2: true, editNote2: true,
    editNotes: true, editPref: true, editUrgency: true, editClientType: true,
    assign: true, viewAssign: true, holds: true, files: true, del: true, edit: true }),

  // מזכירה כללית — מעדכנת שיוך למטפלים, דחיפות, בן/בת, הערות והערה
  // מקצועית; לא מוסיפה מטופלים, לא נוגעת בשם או בשעות, ולא רואה אבחנה
  secretary: R('מזכירה כללית',
    'מעדכנת שיוך למטפלים, רמת דחיפות, בן/בת, הערות והערה מקצועית, ומצרפת קבצים. לא מוסיפה מטופלים, לא עורכת שם או שעות טיפול, לא משבצת, לא מוחקת ולא רואה אבחנה.', {
    viewNote2: true, editNote2: true,
    editNotes: true, editPref: true, editUrgency: true, editClientType: true,
    files: true }),

  // מדריך — תוכן קליני, שיוך למטפלים ורמת דחיפות. לא עורך פרטים
  // אישיים, לא מוחק ולא קובע פגישות.
  guide: R('מדריך',
    'מעדכן אבחנה, הערה מקצועית, הערות רגילות, שיוך למטפלים, רמת דחיפות ובן/בת; מנהל רשימת השהיה, מצרף קבצים, ורואה אילו מטפלים פנויים למטופל. לא עורך שם או שעות, לא משבץ בפועל ולא מוחק.', {
    viewDiagnosis: true, editDiagnosis: true, viewNote2: true, editNote2: true,
    editNotes: true, editPref: true, editUrgency: true, editClientType: true,
    viewAssign: true, holds: true, files: true }),

  // פנינה — הכל פתוח מלבד ההערה המקצועית וניהול המשתמשים
  pnina: R('פנינה',
    'הכל מלבד ההערה המקצועית (לא רואה ולא עורכת) וניהול משתמשים.', {
    addPatient: true, editPatient: true, editPatientLimited: true,
    viewDiagnosis: true, editDiagnosis: true,
    editNotes: true, editPref: true, editUrgency: true, editClientType: true,
    assign: true, viewAssign: true, holds: true, files: true, del: true, edit: true }),

  viewer: R('צופה',
    'צפייה בלבד בכל הנתונים, בלי לערוך דבר.', { viewDiagnosis: true, viewNote2: true }),

  // ===== תפקידים ותיקים — נשמרים כדי שמשתמשים קיימים לא יאבדו גישה =====
  manager: R('מנהל',
    'תפקיד ותיק — כמו מזכירה אחראית.', {
    addPatient: true, editPatient: true, editPatientLimited: true,
    viewDiagnosis: true, editDiagnosis: true, viewNote2: true, editNote2: true,
    editNotes: true, editPref: true, editUrgency: true, editClientType: true,
    assign: true, viewAssign: true, holds: true, files: true, del: true, edit: true }),
  clerk: R('רכז/ת',
    'תפקיד ותיק — כמו מנהל, אבל בלי מחיקה.', {
    addPatient: true, editPatient: true, editPatientLimited: true,
    viewDiagnosis: true, editDiagnosis: true, viewNote2: true, editNote2: true,
    editNotes: true, editPref: true, editUrgency: true, editClientType: true,
    assign: true, viewAssign: true, holds: true, files: true, edit: true }),
};

// מתי שונתה הסיסמה לאחרונה — נשמר במטמון קצר כדי לא לפגוע בכל בקשה
const pwChanged = new Map();   // userId -> { at, until }
const PW_TTL = 60 * 1000;

async function passwordChangedAt(userId) {
  const c = pwChanged.get(userId);
  if (c && c.until > Date.now()) return c.at;
  let at = null;
  try {
    const r = await pool.query('SELECT password_changed_at FROM users WHERE id=$1', [userId]);
    if (r.rows[0] && r.rows[0].password_changed_at) at = new Date(r.rows[0].password_changed_at).getTime();
  } catch (e) { /* תקלת מסד לא תנתק משתמשים */ }
  pwChanged.set(userId, { at, until: Date.now() + PW_TTL });
  return at;
}
// נקרא מיד אחרי איפוס סיסמה, כדי שהביטול ייכנס לתוקף בלי להמתין למטמון
function forgetPassword(userId) { pwChanged.delete(userId); }

async function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'לא מחובר למערכת' });
  }
  let decoded;
  try {
    decoded = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'פג תוקף החיבור, יש להתחבר מחדש' });
  }
  // טוקן שהונפק לפני איפוס הסיסמה כבר לא תקף
  // iat של JWT הוא בשניות שלמות (מעוגל למטה), ולכן טוקן שהונפק מיד אחרי
  // איפוס הסיסמה עלול להיראות מוקדם ממנו בעד שנייה — שנייה של סבילות
  const changedAt = await passwordChangedAt(decoded.id);
  if (changedAt && decoded.iat && decoded.iat * 1000 + 1000 < changedAt) {
    return res.status(401).json({ error: 'הסיסמה שונתה, יש להתחבר מחדש' });
  }
  req.user = decoded;
  req.caps = ROLES[decoded.role] || ROLES.viewer;
  next();
}

function can(capability) {
  return (req, res, next) => {
    if (req.caps && req.caps[capability]) return next();
    return res.status(403).json({ error: 'אין לך הרשאה לפעולה זו' });
  };
}

// לפחות אחת מההרשאות — לנתיבים שכמה תפקידים ניגשים אליהם מסיבות שונות
function canAny(...caps) {
  return (req, res, next) => {
    if (req.caps && caps.some(c => req.caps[c])) return next();
    return res.status(403).json({ error: 'אין לך הרשאה לפעולה זו' });
  };
}

module.exports = { authenticate, can, canAny, ROLES, forgetPassword };
