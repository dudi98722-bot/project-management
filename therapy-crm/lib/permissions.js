// ===== הרשאות: קטלוג הפעולות, ברירות המחדל לכל תפקיד, והשינויים שנקבעו במסך =====
// מנהל ראשי ומנהל מסמנים בלשונית "משתמשים" מה מותר לכל סוג משתמש. ברירות המחדל
// מוגדרות כאן, ובמסד (role_permissions) נשמרות רק ההרשאות ששונו מהן — כך הרשאה חדשה
// שנוספת בקוד מקבלת את ברירת המחדל שלה, בלי לדרוס את מה שכבר נקבע.
const { pool } = require('../db');

// איזו הרשאה פותחת כל שדה של מטופל לעריכה ולצפייה — משותף לשרת ולטופס
// (נשלח ב-/patients/meta, כך שהטופס נועל ומסתיר בדיוק מה שהשרת חוסם)
const FIELD_CAPS = {
  last_name: 'editName', first_name: 'editName',
  national_id: 'editNationalId', intake_date: 'editIntakeDate', birth_date: 'editBirthDate',
  hmo: 'editHmo', community: 'editCommunity', client_type: 'editClientType',
  urgency: 'editUrgency', hours: 'editHours',
  preferred_therapist_ids: 'editPref', preferred_group_ids: 'editPref',
  notes: 'editNotes', diagnosis: 'editDiagnosis', notes2: 'editNote2',
};
const FIELD_VIEW_CAPS = {
  last_name: 'viewName', first_name: 'viewName',
  national_id: 'viewNationalId', intake_date: 'viewIntakeDate', birth_date: 'viewBirthDate',
  hmo: 'viewHmo', community: 'viewCommunity', client_type: 'viewClientType',
  urgency: 'viewUrgency', hours: 'viewHours',
  preferred_therapist_ids: 'viewPref', preferred_group_ids: 'viewPref',
  notes: 'viewNotes', diagnosis: 'viewDiagnosis', notes2: 'viewNote2',
};

// טבלת ההרשאות שבמסך. שורת נושא = צפייה (view) + עריכה (edit);
// שורת פעולה (action) = פעולה אחת, עם תיבת סימון אחת.
const CATALOG = [
  { title: 'רשימת הממתינים', rows: [
    { label: 'רשימת הממתינים', hint: 'צפייה = הלשונית · עריכה = הוספת מטופל חדש וייבוא מאקסל', view: 'tabWaiting', edit: 'addPatient' },
    { label: 'מחיקת מטופל', action: 'deletePatient' },
  ]},
  { title: 'פרטי מטופל', rows: [
    { label: 'שם משפחה ושם פרטי', hint: 'בלי צפייה המטופל מוצג כ"מטופל #מספר"', view: 'viewName', edit: 'editName' },
    { label: 'מספר זהות', view: 'viewNationalId', edit: 'editNationalId' },
    { label: 'תאריך אינטייק', view: 'viewIntakeDate', edit: 'editIntakeDate' },
    { label: 'תאריך לידה וגיל', view: 'viewBirthDate', edit: 'editBirthDate' },
    { label: 'קופת חולים', view: 'viewHmo', edit: 'editHmo' },
    { label: 'השתייכות קהילתית', hint: 'עריכה כוללת הוספת קהילה חדשה לרשימה', view: 'viewCommunity', edit: 'editCommunity' },
    { label: 'בן / בת', view: 'viewClientType', edit: 'editClientType' },
    { label: 'רמת דחיפות', view: 'viewUrgency', edit: 'editUrgency' },
    { label: 'שעות מתאימות לטיפול', view: 'viewHours', edit: 'editHours' },
    { label: 'שיוך למטפלים', view: 'viewPref', edit: 'editPref' },
    { label: 'הערות', view: 'viewNotes', edit: 'editNotes' },
    { label: 'אבחנה', view: 'viewDiagnosis', edit: 'editDiagnosis' },
    { label: 'הערה מקצועית', view: 'viewNote2', edit: 'editNote2' },
  ]},
  { title: 'קבצים מצורפים', rows: [
    { label: 'קבצים מצורפים', hint: 'צפייה = רשימת הקבצים והורדה · עריכה = צירוף קבצים', view: 'viewFiles', edit: 'files' },
    { label: 'מחיקת קבצים מצורפים', action: 'deleteFiles' },
  ]},
  { title: 'השהיה ושיבוץ', rows: [
    { label: 'רשימת השהיה', hint: 'עריכה = העברה להשהיה והסרה ממנה', view: 'viewHolds', edit: 'holds' },
    { label: 'שיבוץ לטיפול', hint: 'צפייה = המטפלים הפנויים למטופל · עריכה = שיבוץ בפועל, פגישה בודדת ולשונית מטופלים קיימים', view: 'viewAssign', edit: 'assign' },
    { label: 'סדרות טיפול', hint: 'צפייה = הלשונית · עריכה = ביטול סדרה', view: 'tabSeries', edit: 'cancelSeries' },
    { label: 'פגישות', hint: 'צפייה = רשימת הפגישות בסדרה · עריכה = בוצעה / לא הגיע / בוטלה', view: 'viewSessions', edit: 'editSessions' },
  ]},
  { title: 'ממתינים לאינטייק', rows: [
    { label: 'ממתינים לאינטייק', hint: 'עריכה = הוספה, עריכה והסרה מהרשימה', view: 'viewIntake', edit: 'editIntake' },
  ]},
  { title: 'לשוניות והגדרות', rows: [
    { label: 'התאמות', hint: 'עריכה = הגדרת השעות של חלקי היום', view: 'tabMatches', edit: 'editHourParts' },
    { label: 'לוח שנה', hint: 'עריכה = ימי חופש וחג', view: 'tabCalendar', edit: 'editHolidays' },
    { label: 'מטפלים וקבוצות', hint: 'עריכה = הוספה ועריכה של מטפלים, לו"ז וקבוצות', view: 'tabTherapists', edit: 'editTherapists' },
    { label: 'מחיקת מטפלים וקבוצות', action: 'deleteTherapists' },
    { label: 'משתמשים', hint: 'צפייה = רשימת המשתמשים · עריכה = הוספה ועריכה של משתמשים', view: 'viewUsers', edit: 'manageUsers' },
  ]},
];

// הרשאה משמאל גוררת את אלה שמימין. עריכה בלי צפייה מסוכנת: טופס שלא מציג שדה
// שולח אותו ריק, ומי שרשאי לערוך אותו היה מוחק את התוכן בכל שמירה.
const IMPLIES = {
  ...Object.fromEntries(Object.keys(FIELD_CAPS).map(f => [FIELD_CAPS[f], [FIELD_VIEW_CAPS[f]]])),
  addPatient: ['tabWaiting', 'viewName'], deletePatient: ['tabWaiting'],
  files: ['viewFiles'], deleteFiles: ['viewFiles'],
  holds: ['viewHolds'], assign: ['viewAssign'], cancelSeries: ['tabSeries'], editSessions: ['viewSessions'],
  editIntake: ['viewIntake'],
  editHourParts: ['tabMatches'], editHolidays: ['tabCalendar'],
  editTherapists: ['tabTherapists'], deleteTherapists: ['tabTherapists'],
  manageUsers: ['viewUsers'],
};

const CAP_KEYS = [...new Set(CATALOG.flatMap(s => s.rows.flatMap(r => [r.view, r.edit, r.action])))].filter(Boolean);
// נשמר למקרה שתתווסף הרשאה שאסור לשנות; היום אין כזו — כל תיבה בטבלה ניתנת לסימון
const LOCKED_CAPS = new Set();
const EDITABLE_CAPS = CAP_KEYS.filter(c => !LOCKED_CAPS.has(c));

function applyImplications(caps) {
  for (let pass = 0; pass < 3; pass++) {
    for (const [cap, needs] of Object.entries(IMPLIES)) {
      if (caps[cap]) needs.forEach(n => { caps[n] = true; });
    }
  }
  return caps;
}

// managePermissions — עריכת טבלת ההרשאות. קבוע לפי תפקיד (מנהל ראשי ומנהל) ולא מופיע
// בטבלה, כדי שאף אחד לא יוכל לנעול את עצמו או לפתוח אותו לתפקיד אחר.
const R = (label, desc, grants) => {
  const o = { label, desc, managePermissions: false };
  CAP_KEYS.forEach(k => { o[k] = false; });
  grants.forEach(k => { o[k] = true; });
  return applyImplications(o);
};

// הצפייה שכל התפקידים קיבלו עד היום: הלשוניות, פרטי המטופל, קבצים, פגישות, השהיה ואינטייק
const BASE_VIEW = ['tabWaiting', 'tabMatches', 'tabSeries', 'tabCalendar', 'tabTherapists',
  'viewIntake', 'viewHolds', 'viewFiles', 'viewSessions',
  'viewName', 'viewNationalId', 'viewIntakeDate', 'viewBirthDate', 'viewHmo', 'viewCommunity',
  'viewClientType', 'viewUrgency', 'viewHours', 'viewPref', 'viewNotes'];
const EDIT_FIELDS = ['editName', 'editNationalId', 'editIntakeDate', 'editBirthDate', 'editHmo',
  'editCommunity', 'editClientType', 'editUrgency', 'editHours', 'editPref', 'editNotes'];
// כל מה שמזכירה אחראית מקבלת — הבסיס לתפקידים עם גישה רחבה
const FULL = [...BASE_VIEW, ...EDIT_FIELDS,
  'viewDiagnosis', 'editDiagnosis', 'viewNote2', 'editNote2',
  'addPatient', 'deletePatient', 'files', 'deleteFiles',
  'holds', 'viewAssign', 'assign', 'cancelSeries', 'editSessions',
  'editIntake', 'editHourParts', 'editHolidays', 'editTherapists', 'deleteTherapists'];
const without = (list, ...drop) => list.filter(c => !drop.includes(c));

const ROLES = {
  // כל ההרשאות, תמיד — כולל כל הרשאה שתתווסף לקטלוג בעתיד
  admin: R('מנהל ראשי',
    'כל ההרשאות במערכת, תמיד — כולל ניהול משתמשים ועריכת טבלת ההרשאות.', [...CAP_KEYS, 'managePermissions']),

  manager: R('מנהל',
    'כמו מזכירה אחראית, ובנוסף עורך את טבלת ההרשאות.', [...FULL, 'managePermissions']),

  head_secretary: R('מזכירה אחראית', 'הכל מלבד ניהול משתמשים והרשאות.', FULL),

  secretary: R('מזכירה כללית',
    'מעדכנת שיוך למטפלים, רמת דחיפות, בן/בת, הערות והערה מקצועית, ומצרפת קבצים. לא מוסיפה מטופלים, לא עורכת שם או שעות טיפול, לא משבצת, לא מוחקת ולא רואה אבחנה.',
    [...BASE_VIEW, 'viewNote2', 'editNote2', 'editNotes', 'editPref', 'editUrgency', 'editClientType', 'files']),

  guide: R('מדריך',
    'מעדכן אבחנה, הערה מקצועית, הערות רגילות, שיוך למטפלים, רמת דחיפות ובן/בת; מנהל רשימת השהיה, מצרף קבצים, ורואה אילו מטפלים פנויים למטופל. לא עורך שם או שעות, לא משבץ בפועל ולא מוחק.',
    [...BASE_VIEW, 'viewDiagnosis', 'editDiagnosis', 'viewNote2', 'editNote2', 'editNotes', 'editPref',
     'editUrgency', 'editClientType', 'holds', 'viewAssign', 'files']),

  pnina: R('פנינה',
    'הכל מלבד ההערה המקצועית (לא רואה ולא עורכת) וניהול משתמשים.', without(FULL, 'viewNote2', 'editNote2')),

  viewer: R('צופה', 'צפייה בלבד בכל הנתונים, בלי לערוך דבר.', [...BASE_VIEW, 'viewDiagnosis', 'viewNote2']),

  // ===== תפקיד ותיק — נשמר כדי שמשתמשים קיימים לא יאבדו גישה =====
  clerk: R('רכז/ת', 'תפקיד ותיק — כמו מזכירה אחראית, אבל בלי מחיקה.',
    without(FULL, 'deletePatient', 'deleteFiles', 'cancelSeries', 'deleteTherapists')),
};
const LEGACY_ROLES = new Set(['clerk']);

// מי שאין לו צפייה בשם המטופל רואה "מטופל #מספר" — בכל מקום שבו השרת מחזיר שם
const hiddenName = (id) => `מטופל #${id}`;
function maskPatientNames(rows, caps, idKey = 'patient_id', nameKey = 'patient_name') {
  if (!Array.isArray(rows) || (caps && caps.viewName)) return rows;
  return rows.map(r => ({ ...r, [nameKey]: hiddenName(r[idKey]) }));
}

// השינויים שנקבעו במסך נקראים מהמסד ונשמרים במטמון קצר, כדי לא לשאול בכל בקשה
let _ovr = { at: 0, map: null };
const OVR_TTL = 30 * 1000;

async function overrides() {
  if (_ovr.map && Date.now() - _ovr.at < OVR_TTL) return _ovr.map;
  try {
    const r = await pool.query('SELECT role, cap, allowed FROM role_permissions');
    const map = {};
    r.rows.forEach(x => { (map[x.role] = map[x.role] || {})[x.cap] = x.allowed; });
    _ovr = { at: Date.now(), map };
  } catch (e) {
    console.error('טעינת הרשאות נכשלה:', e.message);
    if (!_ovr.map) return {};
  }
  return _ovr.map;
}
function forgetOverrides() { _ovr = { at: 0, map: null }; }

// ההרשאות בפועל של תפקיד: ברירת המחדל + מה שנקבע במסך
async function capsFor(role) {
  const key = ROLES[role] ? role : 'viewer';
  const caps = { ...ROLES[key] };
  if (key !== 'admin') {
    const o = (await overrides())[key] || {};
    EDITABLE_CAPS.forEach(k => { if (typeof o[k] === 'boolean') caps[k] = o[k]; });
  }
  return applyImplications(caps);
}

const pick = (caps) => Object.fromEntries(CAP_KEYS.map(k => [k, !!caps[k]]));

// האם ההרשאות של התפקיד שונות מברירת המחדל שלו (התיאור הקבוע כבר לא מדויק)
async function isCustomized(role) {
  if (!ROLES[role] || role === 'admin') return false;
  const caps = await capsFor(role);
  return CAP_KEYS.some(k => !!caps[k] !== !!ROLES[role][k]);
}

// הנתונים למסך ההרשאות
async function matrix() {
  const counts = await pool.query('SELECT role, COUNT(*)::int AS n FROM users GROUP BY role');
  const users = Object.fromEntries(counts.rows.map(r => [r.role, r.n]));
  const roles = [];
  for (const [key, def] of Object.entries(ROLES)) {
    roles.push({
      role: key, label: def.label, desc: def.desc, users: users[key] || 0,
      locked: key === 'admin', legacy: LEGACY_ROLES.has(key),
      defaults: pick(def), caps: pick(await capsFor(key)),
    });
  }
  return { sections: CATALOG, implies: IMPLIES, locked: [...LOCKED_CAPS], roles };
}

// שמירה: { role: { cap: true/false } }. כל תפקיד שנשלח נשמר במלואו, ובמסד נרשם רק
// מה ששונה מברירת המחדל. מנהל ראשי אינו ניתן לשינוי.
async function saveMatrix(input, user) {
  const client = await pool.connect();
  const changed = [];
  try {
    await client.query('BEGIN');
    for (const [role, capsIn] of Object.entries(input || {})) {
      if (!ROLES[role] || role === 'admin' || !capsIn || typeof capsIn !== 'object') continue;
      const next = { ...ROLES[role] };
      EDITABLE_CAPS.forEach(k => { if (typeof capsIn[k] === 'boolean') next[k] = capsIn[k]; });
      applyImplications(next);
      await client.query('DELETE FROM role_permissions WHERE role=$1', [role]);
      for (const k of EDITABLE_CAPS) {
        if (next[k] === ROLES[role][k]) continue;
        await client.query(
          'INSERT INTO role_permissions (role, cap, allowed, updated_by_name) VALUES ($1,$2,$3,$4)',
          [role, k, next[k], (user && (user.full_name || user.username)) || null]);
      }
      changed.push(role);
    }
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
    forgetOverrides();
  }
  return changed;
}

module.exports = {
  FIELD_CAPS, FIELD_VIEW_CAPS, CATALOG, IMPLIES, CAP_KEYS, EDITABLE_CAPS, ROLES,
  capsFor, isCustomized, matrix, saveMatrix, hiddenName, maskPatientNames,
};
