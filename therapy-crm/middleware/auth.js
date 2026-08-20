const jwt = require('jsonwebtoken');

// ===== מטריצת הרשאות =====
// ההרשאות מפורקות דק כדי לתמוך בתפקידים חלקיים (מזכירה שעורכת רק שם ושעות,
// מדריך שנוגע רק באבחנה ובהערה המקצועית).
//
//  manageUsers        ניהול משתמשים
//  addPatient         הוספת מטופל חדש
//  editPatient        עריכת כל פרטי המטופל
//  editPatientLimited עריכת שם המטופל והשעות המתאימות בלבד
//  viewClinical       צפייה באבחנה ובהערה המקצועית
//  editClinical       עריכת אבחנה והערה מקצועית
//  assign             שיבוץ לטיפול, פגישות, סדרות והשהיות
//  files              צירוף קבצים למטופל
//  del                מחיקה רכה וביטול סדרות
//  view               צפייה בנתונים ובלוח השנה
//
// edit נשאר כשער כללי לעריכת ישויות שאינן מטופל (מטפלים, קבוצות, חגים, רשימות).
const R = (label, c) => Object.assign({ label,
  manageUsers: false, addPatient: false, editPatient: false, editPatientLimited: false,
  viewClinical: false, editClinical: false, assign: false, files: false,
  del: false, edit: false, view: true }, c);

const ROLES = {
  admin: R('מנהל ראשי', {
    manageUsers: true, addPatient: true, editPatient: true, editPatientLimited: true,
    viewClinical: true, editClinical: true, assign: true, files: true, del: true, edit: true }),

  // מזכירה אחראית — הכל פתוח מלבד ניהול משתמשים
  head_secretary: R('מזכירה אחראית', {
    addPatient: true, editPatient: true, editPatientLimited: true,
    viewClinical: true, editClinical: true, assign: true, files: true, del: true, edit: true }),

  // מזכירה כללית — מוסיפה מטופלים ומצרפת קבצים; עורכת רק שם ושעות;
  // לא מוחקת, לא משבצת, ולא רואה אבחנה או הערה מקצועית
  secretary: R('מזכירה כללית', {
    addPatient: true, editPatientLimited: true, files: true }),

  // מדריך — נוגע רק בתוכן הקליני
  guide: R('מדריך', {
    viewClinical: true, editClinical: true, files: true }),

  viewer: R('צופה', { viewClinical: true }),

  // ===== תפקידים ותיקים — נשמרים כדי שמשתמשים קיימים לא יאבדו גישה =====
  manager: R('מנהל', {
    addPatient: true, editPatient: true, editPatientLimited: true,
    viewClinical: true, editClinical: true, assign: true, files: true, del: true, edit: true }),
  clerk: R('רכז/ת', {
    addPatient: true, editPatient: true, editPatientLimited: true,
    viewClinical: true, editClinical: true, assign: true, files: true, edit: true }),
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

// לפחות אחת מההרשאות — לנתיבים שכמה תפקידים ניגשים אליהם מסיבות שונות
function canAny(...caps) {
  return (req, res, next) => {
    if (req.caps && caps.some(c => req.caps[c])) return next();
    return res.status(403).json({ error: 'אין לך הרשאה לפעולה זו' });
  };
}

module.exports = { authenticate, can, canAny, ROLES };
