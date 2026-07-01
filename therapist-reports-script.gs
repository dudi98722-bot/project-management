/**
 * דיווח טיפולים חודשי - מטפלים / מזכירות / מנהל  ↔  Google Sheets
 * ------------------------------------------------------------
 * מבנה גישה: מטפל רואה רק את הרשומות שלו. מזכירה רואה את המטפלים
 * ששויכו אליה (גיליון "שיוכים"). מנהל רואה הכל + מסכי ניהול.
 * הסינון לפי הרשאה מתבצע כאן בשרת (לא רק הסתרה בצד לקוח), כי
 * מדובר בנתוני מטופלים.
 *
 * פעולות (doGet, ?action=...):
 *   loginList                         -> רשימת משתמשים לבחירה במסך הכניסה (id/שם/תפקיד/הצפנה)
 *   bootstrap&user=ID                 -> מטפלים+רשימות+(למנהל: משתמשים+שיוכים) בהיקף המורשה
 *   entries&user=ID&therapistId=&year=&month=  -> רשומות חודש למטפל מסוים (אם מורשה)
 *   monthSummary&user=ID&year=&month= -> סה"כ לכל מטפל מורשה (לתצוגת מזכירה/מנהל)
 *
 * פעולות (doGet/doPost עם action=save...):
 *   saveEntries&user=ID     data={therapistId,year,month,entries:[...]}
 *   saveTherapists&user=ID  data={therapists:[...]}                (מנהל)
 *   saveUsers&user=ID       data={users:[...]}                     (מנהל)
 *   saveAssignments&user=ID data={assignments:[...]}               (מנהל)
 *   saveLists&user=ID       data={lists:[...]}                     (מנהל)
 *   bulkImportSeed          data={...הכל...}   -- מותר רק כשגיליון המשתמשים ריק (הקמה ראשונית)
 *
 * הגדרה:
 *   1. script.google.com -> New project, הדבק את כל הקוד הזה.
 *   2. Deploy > New deployment > Web app
 *        Execute as: Me   |   Who has access: Anyone
 *   3. אשר הרשאות (Authorize / Allow).
 *   4. העתק את כתובת ה-/exec ושלח אותה למי שמגדיר את המערכת.
 *   הסקריפט יוצר לבד גיליון בשם "דיווח טיפולים - נתונים" בדרייב שלך.
 */

var SHEET_ID = '';

function getSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  if (SHEET_ID) return SpreadsheetApp.openById(SHEET_ID);
  var saved = props.getProperty('tr_sheet_id');
  if (saved) {
    try { return SpreadsheetApp.openById(saved); } catch (e) {}
  }
  var ss = SpreadsheetApp.create('דיווח טיפולים - נתונים');
  props.setProperty('tr_sheet_id', ss.getId());
  return ss;
}

var SHEETS = {
  therapists:  { name: 'מטפלים',
                 headers: ['id','שם','התמחות','פעיל'],
                 fields:  ['id','name','specialization','active'] },
  users:       { name: 'משתמשים',
                 headers: ['id','שם','תפקיד','סיסמה מוצפנת','מטפל מקושר'],
                 fields:  ['id','name','role','hash','therapistId'] },
  assignments: { name: 'שיוכים',
                 headers: ['id','מזכירה (מזהה משתמש)','מטפל (מזהה)'],
                 fields:  ['id','secretaryUserId','therapistId'] },
  entries:     { name: 'רשומות',
                 headers: ['id','מטפל','תאריך','סוג','מטופל','קופ"ח','שעות','סכום פרטי','פרוייקט','סיווג ביטול','סוג ביטול','סיבת ביטול','הערות'],
                 fields:  ['id','therapistId','date','type','patient','healthFund','hours','privateAmount','project','cancelClass','cancelPayment','cancelReason','notes'] },
  lists:       { name: 'רשימות בחירה',
                 headers: ['id','סוג רשימה','ערך'],
                 fields:  ['id','kind','value'] }
};

var NUM_FIELDS  = { hours:1, privateAmount:1 };

function doGet(e)  { return handle(e); }
function doPost(e) { return handle(e); }

function handle(e) {
  var lock = LockService.getScriptLock();
  try {
    var p = (e && e.parameter) ? e.parameter : {};
    var action = p.action || '';

    if (action === 'loginList')   return json(loginList());
    if (action === 'bootstrap')   return json(bootstrap(p.user));
    if (action === 'entries')     return json(getEntries(p.user, p.therapistId, p.year, p.month));
    if (action === 'monthSummary')return json(monthSummary(p.user, p.year, p.month));

    if (action && action.indexOf('save') === 0) {
      lock.waitLock(20000);
      var payload = JSON.parse(p.data || p.p || '{}');
      return json(saveAction(action, p.user, payload));
    }
    if (action === 'bulkImportSeed') {
      lock.waitLock(20000);
      var seed = JSON.parse(p.data || p.p || '{}');
      return json(bulkImportSeed(seed));
    }
    return json({ status: 'idle' });
  } catch (err) {
    return json({ status: 'error', message: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function ss() { return getSpreadsheet(); }

function getSheet(cfg) {
  var s = ss().getSheetByName(cfg.name);
  if (!s) s = ss().insertSheet(cfg.name);
  if (s.getLastRow() === 0) {
    s.appendRow(cfg.headers);
    s.getRange(1, 1, 1, cfg.headers.length).setFontWeight('bold').setBackground('#edf2f7');
    s.setFrozenRows(1);
    if (cfg === SHEETS.entries) s.getRange('C:C').setNumberFormat('@'); // תאריך כטקסט
  }
  return s;
}

function readAll(key) {
  var cfg = SHEETS[key];
  var s = getSheet(cfg);
  var last = s.getLastRow();
  var out = [];
  if (last < 2) return out;
  var values = s.getRange(2, 1, last - 1, cfg.fields.length).getValues();
  values.forEach(function (row) {
    if (String(row[0]) === '') return;
    var obj = {};
    cfg.fields.forEach(function (f, i) {
      var v = row[i];
      if (NUM_FIELDS[f]) v = (v === '' || v === null || v === undefined) ? null : Number(v);
      else v = (v === null || v === undefined) ? '' : String(v);
      obj[f] = v;
    });
    out.push(obj);
  });
  return out;
}

function writeAll(key, arr) {
  var cfg = SHEETS[key];
  var s = getSheet(cfg);
  var last = s.getLastRow();
  if (last > 1) s.getRange(2, 1, last - 1, cfg.headers.length).clearContent();
  if (!arr || !arr.length) return;
  var rows = arr.map(function (item) {
    return cfg.fields.map(function (f) {
      var v = item[f];
      return (v === undefined || v === null) ? '' : v;
    });
  });
  s.getRange(2, 1, rows.length, cfg.fields.length).setValues(rows);
}

// ---------------- permissions ----------------

function getUser(userId) {
  var users = readAll('users');
  for (var i = 0; i < users.length; i++) if (users[i].id === userId) return users[i];
  return null;
}

// מחזיר את רשימת מזהי המטפלים שמשתמש נתון מורשה לצפות/לערוך בהם
function scopeForUser(user) {
  if (!user) return [];
  if (user.role === 'manager') {
    return readAll('therapists').map(function (t) { return t.id; });
  }
  if (user.role === 'therapist') {
    return user.therapistId ? [user.therapistId] : [];
  }
  if (user.role === 'secretary') {
    return readAll('assignments')
      .filter(function (a) { return a.secretaryUserId === user.id; })
      .map(function (a) { return a.therapistId; });
  }
  return [];
}

function canWriteUsers(user) { return !!user && user.role === 'manager'; }

// ---------------- read actions ----------------

function loginList() {
  return readAll('users').map(function (u) {
    return { id: u.id, name: u.name, role: u.role, hash: u.hash };
  });
}

function bootstrap(userId) {
  var user = getUser(userId);
  if (!user) return { status: 'error', message: 'משתמש לא נמצא' };
  var scopeIds = scopeForUser(user);
  var allTherapists = readAll('therapists');
  var therapists = allTherapists.filter(function (t) { return scopeIds.indexOf(t.id) !== -1; });
  var out = {
    status: 'ok',
    role: user.role,
    me: { id: user.id, name: user.name, role: user.role, therapistId: user.therapistId },
    therapists: therapists,
    lists: readAll('lists')
  };
  if (user.role === 'manager') {
    out.users = readAll('users');
    out.assignments = readAll('assignments');
  } else if (user.role === 'secretary') {
    out.assignments = readAll('assignments').filter(function (a) { return a.secretaryUserId === user.id; });
  }
  return out;
}

function getEntries(userId, therapistId, year, month) {
  var user = getUser(userId);
  if (!user) return { status: 'error', message: 'משתמש לא נמצא' };
  var scopeIds = scopeForUser(user);
  if (scopeIds.indexOf(therapistId) === -1) return { status: 'error', message: 'אין הרשאה' };
  var prefix = Number(year) + '-' + ('0' + Number(month)).slice(-2);
  var rows = readAll('entries').filter(function (r) {
    return r.therapistId === therapistId && String(r.date).indexOf(prefix) === 0;
  });
  return { status: 'ok', entries: rows };
}

function monthSummary(userId, year, month) {
  var user = getUser(userId);
  if (!user) return { status: 'error', message: 'משתמש לא נמצא' };
  var scopeIds = scopeForUser(user);
  var prefix = Number(year) + '-' + ('0' + Number(month)).slice(-2);
  var rows = readAll('entries').filter(function (r) {
    return scopeIds.indexOf(r.therapistId) !== -1 && String(r.date).indexOf(prefix) === 0;
  });
  var byTherapist = {};
  rows.forEach(function (r) {
    if (!byTherapist[r.therapistId]) byTherapist[r.therapistId] = { therapistId: r.therapistId, sessions: 0, hours: 0, cancellations: 0 };
    var b = byTherapist[r.therapistId];
    if (r.type === 'ביטול תור') b.cancellations++; else b.sessions++;
    b.hours += (r.hours || 0);
  });
  return { status: 'ok', summary: Object.keys(byTherapist).map(function (k) { return byTherapist[k]; }) };
}

// ---------------- write actions ----------------

function saveAction(action, userId, payload) {
  var user = getUser(userId);
  if (!user) return { status: 'error', message: 'משתמש לא נמצא' };

  if (action === 'saveEntries') {
    var scopeIds = scopeForUser(user);
    var tid = payload.therapistId;
    if (scopeIds.indexOf(tid) === -1) return { status: 'error', message: 'אין הרשאה' };
    var prefix = Number(payload.year) + '-' + ('0' + Number(payload.month)).slice(-2);
    var all = readAll('entries');
    var kept = all.filter(function (r) {
      return !(r.therapistId === tid && String(r.date).indexOf(prefix) === 0);
    });
    var incoming = (payload.entries || []).map(function (r) { r.therapistId = tid; return r; });
    writeAll('entries', kept.concat(incoming));
    return { status: 'ok' };
  }

  if (!canWriteUsers(user)) return { status: 'error', message: 'אין הרשאה - פעולת ניהול' };

  if (action === 'saveTherapists')  { writeAll('therapists', payload.therapists || []); return { status: 'ok' }; }
  if (action === 'saveUsers')       { writeAll('users', payload.users || []); return { status: 'ok' }; }
  if (action === 'saveAssignments') { writeAll('assignments', payload.assignments || []); return { status: 'ok' }; }
  if (action === 'saveLists')       { writeAll('lists', payload.lists || []); return { status: 'ok' }; }

  return { status: 'error', message: 'פעולה לא מוכרת' };
}

// הקמה ראשונית בלבד: מותר רק כשאין עדיין משתמשים בגיליון
function bulkImportSeed(seed) {
  var existingUsers = readAll('users');
  if (existingUsers.length > 0) return { status: 'error', message: 'כבר קיימים משתמשים - ייבוא ראשוני חסום' };
  writeAll('therapists', seed.therapists || []);
  writeAll('users', seed.users || []);
  writeAll('assignments', seed.assignments || []);
  writeAll('lists', seed.lists || []);
  writeAll('entries', seed.entries || []);
  return { status: 'ok', counts: {
    therapists: (seed.therapists||[]).length,
    users: (seed.users||[]).length,
    assignments: (seed.assignments||[]).length,
    lists: (seed.lists||[]).length,
    entries: (seed.entries||[]).length
  }};
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
