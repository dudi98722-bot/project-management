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
};

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    // Add header row
    const headers = {
      users: ['id','name','username','password','role','isAdmin'],
      clients: ['id','name','info'],
      tasks: ['id','name','description','clientId','recur','slaDays','critical','startDate','onceDate','dayOfWeek','dayOfMonth','biDayOfMonth','assignedUsers'],
      instances: ['key','taskId','periodKey','dueDate','status','completedBy','completedByName','completedAt','completionNote','postponedTo','postponeReason','postponedBy','postponedAt'],
    };
    sheet.appendRow(headers[name] || ['id','data']);
    sheet.getRange(1,1,1,sheet.getLastColumn()).setFontWeight('bold').setBackground('#f3f4f6');
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
      if (h === 'assignedUsers' && val) {
        try { val = JSON.parse(val); } catch(e) { val = {}; }
      }
      if (h === 'isAdmin' || h === 'critical') val = val === true || val === 'true' || val === 1;
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
    if (h === 'assignedUsers' && val && typeof val === 'object') val = JSON.stringify(val);
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
      };
      return jsonResponse({ ok: true, data });
    }
  } catch(err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function doPost(e) {
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
