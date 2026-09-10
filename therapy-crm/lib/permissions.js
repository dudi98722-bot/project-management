// ===== הרשאות: קטלוג הפעולות, ברירות המחדל לכל תפקיד, והשינויים שהמנהל קבע =====
// המנהל מסמן בלשונית "משתמשים" מה מותר לכל סוג משתמש. ברירות המחדל מוגדרות כאן,
// ובמסד (role_permissions) נשמרות רק ההרשאות שהמנהל שינה מהן — כך הרשאה חדשה
// שנוספת בקוד מקבלת את ברירת המחדל שלה, בלי לדרוס את מה שהמנהל כבר קבע.
const { pool } = require('../db');

// איזו הרשאה פותחת לעריכה כל שדה של מטופל — משותף לשרת ולטופס (נשלח ב-/patients/meta)
const FIELD_CAPS = {
  last_name: 'editName', first_name: 'editName',
  national_id: 'editNationalId', intake_date: 'editIntakeDate', birth_date: 'editBirthDate',
  hmo: 'editHmo', community: 'editCommunity', client_type: 'editClientType',
  urgency: 'editUrgency', hours: 'editHours',
  preferred_therapist_ids: 'editPref', preferred_group_ids: 'editPref',
  notes: 'editNotes', diagnosis: 'editDiagnosis', notes2: 'editNote2',
};

// טבלת ההרשאות שבמסך: כל שורה היא נושא, עם הרשאת צפייה (view) ו/או עריכה (edit).
// 'always' = פתוח לכל מי שנכנס למערכת.
const CATALOG = [
  { title: 'פרטי מטופל', rows: [
    { label: 'שם משפחה ושם פרטי', view: 'always', edit: 'editName' },
    { label: 'מספר זהות', view: 'always', edit: 'editNationalId' },
    { label: 'תאריך אינטייק', view: 'always', edit: 'editIntakeDate' },
    { label: 'תאריך לידה', view: 'always', edit: 'editBirthDate' },
    { label: 'קופת חולים', view: 'always', edit: 'editHmo' },
    { label: 'השתייכות קהילתית', view: 'always', edit: 'editCommunity' },
    { label: 'בן / בת', view: 'always', edit: 'editClientType' },
    { label: 'רמת דחיפות', view: 'always', edit: 'editUrgency' },
    { label: 'שעות מתאימות לטיפול', view: 'always', edit: 'editHours' },
    { label: 'שיוך למטפלים', view: 'always', edit: 'editPref' },
    { label: 'הערות', view: 'always', edit: 'editNotes' },
    { label: 'אבחנה', view: 'viewDiagnosis', edit: 'editDiagnosis' },
    { label: 'הערה מקצועית', view: 'viewNote2', edit: 'editNote2' },
  ]},
  { title: 'מטופלים', rows: [
    { label: 'הוספת מטופל חדש', hint: 'כולל ייבוא מאקסל', edit: 'addPatient' },
    { label: 'מחיקת מטופל', edit: 'deletePatient' },
    { label: 'קבצים מצורפים', hint: 'צפייה = הורדה · עריכה = צירוף קבצים', view: 'always', edit: 'files' },
    { label: 'מחיקת קבצים מצורפים', edit: 'deleteFiles' },
    { label: 'הוספת קהילה חדשה לרשימה', edit: 'editLists' },
  ]},
  { title: 'השהיה ושיבוץ', rows: [
    { label: 'רשימת השהיה', hint: 'עריכה = העברה להשהיה והסרה ממנה', view: 'viewHolds', edit: 'holds' },
    { label: 'שיבוץ לטיפול', hint: 'צפייה = המטפלים הפנויים למטופל · עריכה = שיבוץ בפועל, פגישה בודדת ולשונית מטופלים קיימים', view: 'viewAssign', edit: 'assign' },
    { label: 'עדכון פגישה', hint: 'בוצעה / לא הגיע / בוטלה', edit: 'editSessions' },
    { label: 'ביטול סדרת טיפולים', edit: 'cancelSeries' },
  ]},
  { title: 'ממתינים לאינטייק', rows: [
    { label: 'ממתינים לאינטייק', hint: 'עריכה = הוספה, עריכה והסרה מהרשימה', view: 'viewIntake', edit: 'editIntake' },
  ]},
  { title: 'לשוניות והגדרות', rows: [
    { label: 'התאמות', hint: 'עריכה = הגדרת השעות של חלקי היום', view: 'tabMatches', edit: 'editHourParts' },
    { label: 'סדרות טיפול', view: 'tabSeries' },
    { label: 'לוח שנה', hint: 'עריכה = ימי חופש וחג', view: 'tabCalendar', edit: 'editHolidays' },
    { label: 'מטפלים וקבוצות', hint: 'עריכה = הוספה ועריכה של מטפלים, לו"ז וקבוצות', view: 'tabTherapists', edit: 'editTherapists' },
    { label: 'מחיקת מטפלים וקבוצות', edit: 'deleteTherapists' },
    { label: 'משתמשים והרשאות', hint: 'מנהל ראשי בלבד', edit: 'manageUsers' },
  ]},
];

// הרשאה משמאל גוררת את אלה שמימין. עריכה בלי צפייה מסוכנת: טופס שלא מציג שדה
// שולח אותו ריק, ומי שרשאי לערוך אותו היה מוחק את התוכן בכל שמירה.
const IMPLIES = {
  editDiagnosis: ['viewDiagnosis'], editNote2: ['viewNote2'],
  holds: ['viewHolds'], assign: ['viewAssign'], editIntake: ['viewIntake'],
  editHourParts: ['tabMatches'], editHolidays: ['tabCalendar'], cancelSeries: ['tabSeries'],
  editTherapists: ['tabTherapists'], deleteTherapists: ['tabTherapists'],
};

const CAP_KEYS = [...new Set(CATALOG.flatMap(s => s.rows.flatMap(r => [r.view, r.edit])))]
  .filter(c => c && c !== 'always');
// ניהול משתמשים נשאר של מנהל ראשי בלבד — מי שמקבל אותו יכול לשנות לעצמו את כל השאר
const LOCKED_CAPS = new Set(['manageUsers']);
const EDITABLE_CAPS = CAP_KEYS.filter(c => !LOCKED_CAPS.has(c));

function applyImplications(caps) {
  for (const [cap, needs] of Object.entries(IMPLIES)) {
    if (caps[cap]) needs.forEach(n => { caps[n] = true; });
  }
  return caps;
}

const R = (label, desc, grants) => {
  const o = { label, desc };
  CAP_KEYS.forEach(k => { o[k] = false; });
  grants.forEach(k => { o[k] = true; });
  return applyImplications(o);
};

const PATIENT_FIELDS = ['editName', 'editNationalId', 'editIntakeDate', 'editBirthDate', 'editHmo',
  'editCommunity', 'editClientType', 'editUrgency', 'editHours', 'editPref', 'editNotes'];
const TABS = ['tabMatches', 'tabSeries', 'tabCalendar', 'tabTherapists', 'viewIntake'];
// כל מה שמזכירה אחראית מקבלת — הבסיס לתפקידים עם גישה רחבה
const FULL = [...PATIENT_FIELDS, ...TABS,
  'viewDiagnosis', 'editDiagnosis', 'viewNote2', 'editNote2',
  'addPatient', 'deletePatient', 'files', 'deleteFiles', 'editLists',
  'viewHolds', 'holds', 'viewAssign', 'assign', 'editSessions', 'cancelSeries',
  'editIntake', 'editHourParts', 'editHolidays', 'editTherapists', 'deleteTherapists'];
const without = (list, ...drop) => list.filter(c => !drop.includes(c));

const ROLES = {
  admin: R('מנהל ראשי',
    'הכל: מטופלים, שיבוץ, מחיקה, וניהול משתמשים והרשאות.', [...FULL, 'manageUsers']),

  head_secretary: R('מזכירה אחראית', 'הכל מלבד ניהול משתמשים.', FULL),

  secretary: R('מזכירה כללית',
    'מעדכנת שיוך למטפלים, רמת דחיפות, בן/בת, הערות והערה מקצועית, ומצרפת קבצים. לא מוסיפה מטופלים, לא עורכת שם או שעות טיפול, לא משבצת, לא מוחקת ולא רואה אבחנה.',
    [...TABS, 'viewHolds', 'viewNote2', 'editNote2', 'editNotes', 'editPref', 'editUrgency', 'editClientType', 'files']),

  guide: R('מדריך',
    'מעדכן אבחנה, הערה מקצועית, הערות רגילות, שיוך למטפלים, רמת דחיפות ובן/בת; מנהל רשימת השהיה, מצרף קבצים, ורואה אילו מטפלים פנויים למטופל. לא עורך שם או שעות, לא משבץ בפועל ולא מוחק.',
    [...TABS, 'viewDiagnosis', 'editDiagnosis', 'viewNote2', 'editNote2', 'editNotes', 'editPref',
     'editUrgency', 'editClientType', 'viewHolds', 'holds', 'viewAssign', 'files']),

  pnina: R('פנינה',
    'הכל מלבד ההערה המקצועית (לא רואה ולא עורכת) וניהול משתמשים.', without(FULL, 'viewNote2', 'editNote2')),

  viewer: R('צופה', 'צפייה בלבד בכל הנתונים, בלי לערוך דבר.',
    [...TABS, 'viewHolds', 'viewDiagnosis', 'viewNote2']),

  // ===== תפקידים ותיקים — נשמרים כדי שמשתמשים קיימים לא יאבדו גישה =====
  manager: R('מנהל', 'תפקיד ותיק — כמו מזכירה אחראית.', FULL),
  clerk: R('רכז/ת', 'תפקיד ותיק — כמו מנהל, אבל בלי מחיקה.',
    without(FULL, 'deletePatient', 'deleteFiles', 'cancelSeries', 'deleteTherapists')),
};
const LEGACY_ROLES = new Set(['manager', 'clerk']);

// השינויים שהמנהל קבע נקראים מהמסד ונשמרים במטמון קצר, כדי לא לשאול בכל בקשה
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

// ההרשאות בפועל של תפקיד: ברירת המחדל + מה שהמנהל שינה
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
// מה ששונה מברירת המחדל. מנהל ראשי והרשאות נעולות אינם ניתנים לשינוי.
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
  FIELD_CAPS, CATALOG, IMPLIES, CAP_KEYS, EDITABLE_CAPS, ROLES,
  capsFor, isCustomized, matrix, saveMatrix,
};
