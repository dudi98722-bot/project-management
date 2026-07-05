// ============================================================
// CRM Tasks - Google Apps Script Backend
// ============================================================
// הוראות:
// 1. פתח Google Sheet חדש
// 2. לך ל-Extensions → Apps Script
// 3. מחק את כל הקוד הקיים והדבק את הקוד הזה
// 4. לחץ Deploy → New deployment → Web app
//    - Execute as: Me
//    - Who has access: Anyone
// 5. לחץ Deploy, העתק את ה-URL ושמור אותו
// ============================================================

const SHEET_NAMES = {
  users: 'users',
  clients: 'clients',
  tasks: 'tasks',
  instances: 'instances',
  notifications: 'notifications',
  attendance: 'attendance',
  timelogs: 'timelogs',
};

const REQUIRED_HEADERS = {
  users: ['id','name','username','password','role','isAdmin','email'],
  clients: ['id','name','info'],
  tasks: ['id','name','description','clientId','recur','slaDays','critical','priority','startDate','onceDate','dayOfWeek','dayOfMonth','biDayOfMonth','assignedUsers','note','link','linkLabel','link2','link2Label','email','subtasks','deleted','deletedAt','deletedBy'],
  instances: ['key','taskId','periodKey','dueDate','status','completedBy','completedByName','completedAt','completionNote','postponedTo','postponeReason','postponedBy','postponedAt','subtaskState','comments'],
  notifications: ['id','userId','type','text','taskKey','read','at'],
  attendance: ['id','userId','userName','start','end','date'],
  timelogs: ['id','userId','userName','taskKey','taskId','taskName','clientId','clientName','start','end','date'],
};

// Fields stored as JSON strings in the sheet
const JSON_FIELDS = ['assignedUsers','subtasks','subtaskState','comments'];

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(REQUIRED_HEADERS[name] || ['id','data']);
    sheet.getRange(1,1,1,sheet.getLastColumn()).setFontWeight('bold').setBackground('#f3f4f6');
  } else {
    // Add any missing columns automatically
    const required = REQUIRED_HEADERS[name];
    if (required) {
      const existing = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(),1)).getValues()[0];
      required.forEach(col => {
        if (!existing.includes(col)) {
          const newCol = sheet.getLastColumn() + 1;
          sheet.getRange(1, newCol).setValue(col).setFontWeight('bold').setBackground('#f3f4f6');
        }
      });
    }
  }
  return sheet;
}

function sheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return {};
  const headers = data[0];
  const result = {};
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue; // skip empty rows
    const obj = {};
    headers.forEach((h, idx) => {
      let val = row[idx];
      // Parse JSON fields
      if (JSON_FIELDS.indexOf(h) !== -1 && val) {
        try { val = JSON.parse(val); } catch(e) { val = (h === 'subtasks' ? [] : {}); }
      }
      if (h === 'isAdmin' || h === 'critical' || h === 'read' || h === 'deleted') val = val === true || val === 'true' || val === 1;
      if ((h === 'slaDays' || h === 'dayOfWeek' || h === 'dayOfMonth' || h === 'biDayOfMonth') && val !== '') {
        val = val === '' ? null : Number(val);
      }
      obj[h] = val === '' ? null : val;
    });
    result[row[0]] = obj;
  }
  return result;
}

function findRowById(sheet, id) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) return i + 1; // 1-indexed
  }
  return -1;
}

function generateId() {
  return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function objToRow(headers, obj) {
  return headers.map(h => {
    let val = obj[h];
    if (JSON_FIELDS.indexOf(h) !== -1 && val && typeof val === 'object') val = JSON.stringify(val);
    // Store username/password always as string (prevent numeric passwords from becoming numbers)
    if ((h === 'username' || h === 'password') && val !== undefined && val !== null) val = String(val);
    return val !== undefined && val !== null ? val : '';
  });
}

// ============================================================
// HTTP HANDLERS
// ============================================================
function doGet(e) {
  try {
    const action = e.parameter.action || 'getAll';
    if (action === 'getAll') {
      const data = {
        users: sheetToObjects(getSheet('users')),
        clients: sheetToObjects(getSheet('clients')),
        tasks: sheetToObjects(getSheet('tasks')),
        instances: sheetToObjects(getSheet('instances')),
        notifications: sheetToObjects(getSheet('notifications')),
        attendance: sheetToObjects(getSheet('attendance')),
        timelogs: sheetToObjects(getSheet('timelogs')),
      };
      return jsonResponse({ ok: true, data });
    }
  } catch(err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function doPost(e) {
  // LockService: serialize all writes so two simultaneous saves never corrupt a row
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // wait up to 30s for other writes to finish
  } catch (lockErr) {
    return jsonResponse({ ok: false, error: 'המערכת עסוקה, נסה שוב' });
  }
  try {
    const body = JSON.parse(e.postData.contents);
    const { action, collection, id, data } = body;

    if (action === 'set') {
      return jsonResponse({ ok: true, result: setItem(collection, id, data) });
    }
    if (action === 'push') {
      return jsonResponse({ ok: true, result: pushItem(collection, data) });
    }
    if (action === 'remove') {
      return jsonResponse({ ok: true, result: removeItem(collection, id) });
    }
    return jsonResponse({ ok: false, error: 'Unknown action' });
  } catch(err) {
    return jsonResponse({ ok: false, error: err.message });
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// DAILY BACKUP  (set a daily time-trigger on this function)
// ============================================================
function dailyBackup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const folderName = 'גיבויי מערכת משימות';
  const folders = DriveApp.getFoldersByName(folderName);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm');
  DriveApp.getFileById(ss.getId()).makeCopy('משימות_גיבוי_' + stamp, folder);
  // Keep only last 30 days of backups
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    if (f.getDateCreated() < cutoff) f.setTrashed(true);
  }
}

function setItem(collection, id, data) {
  const sheet = getSheet(collection);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  data.id = id;
  // Handle instances: key is used as id
  if (collection === 'instances') data.key = id;
  const row = objToRow(headers, data);
  const rowIdx = findRowById(sheet, id);
  if (rowIdx > 0) {
    sheet.getRange(rowIdx, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
  return id;
}

function pushItem(collection, data) {
  const id = generateId();
  setItem(collection, id, data);
  return id;
}

function removeItem(collection, id) {
  const sheet = getSheet(collection);
  const rowIdx = findRowById(sheet, id);
  if (rowIdx > 0) sheet.deleteRow(rowIdx);
  return true;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
