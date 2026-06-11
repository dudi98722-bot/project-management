// ============================================================
// CRM מסגריה - Google Apps Script Backend
// ============================================================
// הוראות התקנה:
// 1. פתח Google Sheet חדש (שם לדוגמה: "CRM מסגריה")
// 2. לך ל-Extensions → Apps Script
// 3. מחק את כל הקוד הקיים והדבק את הקוד הזה
// 4. לחץ Deploy → New deployment → Web app
//    - Execute as: Me
//    - Who has access: Anyone
// 5. לחץ Deploy → העתק את ה-Web App URL
// 6. הדבק את ה-URL בהגדרות של ה-CRM
// ============================================================

function getSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers) {
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length)
           .setFontWeight('bold')
           .setBackground('#1a365d')
           .setFontColor('white');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

const PROJECT_HEADERS = ['id','name','phone','address','price','cost','status','source','notes','created','calls'];
const STATUS_HEADERS  = ['id','name','emoji','color','builtin'];

// ─── SERIALIZE / DESERIALIZE ────────────────────────────────
function sheetToArray(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  const result = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      let val = row[idx];
      if (h === 'calls' && val) {
        try { val = JSON.parse(val); } catch(e) { val = []; }
      } else if (h === 'builtin') {
        val = val === true || val === 'true' || val === 1 || val === 'TRUE';
      }
      obj[h] = val === '' ? (h === 'calls' ? [] : '') : val;
    });
    result.push(obj);
  }
  return result;
}

function objToRow(headers, obj) {
  return headers.map(h => {
    let val = obj[h];
    if (h === 'calls' && Array.isArray(val)) val = JSON.stringify(val);
    return (val !== undefined && val !== null) ? val : '';
  });
}

function findRowById(sheet, id) {
  const col = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  for (let i = 1; i < col.length; i++) {
    if (String(col[i][0]) === String(id)) return i + 1;
  }
  return -1;
}

// ─── doGet ──────────────────────────────────────────────────
function doGet(e) {
  try {
    const projects = sheetToArray(getSheet('projects', PROJECT_HEADERS));
    const statuses  = sheetToArray(getSheet('statuses',  STATUS_HEADERS));
    return jsonOk({ projects, statuses });
  } catch(err) {
    return jsonErr(err.message);
  }
}

// ─── doPost ─────────────────────────────────────────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const { action, collection, id, data } = body;

    if (action === 'upsert') return jsonOk(upsert(collection, id, data));
    if (action === 'delete') return jsonOk(remove(collection, id));

    return jsonErr('Unknown action: ' + action);
  } catch(err) {
    return jsonErr(err.message);
  }
}

// ─── CRUD ────────────────────────────────────────────────────
function upsert(collection, id, data) {
  const headers = collection === 'projects' ? PROJECT_HEADERS : STATUS_HEADERS;
  const sheet   = getSheet(collection, headers);
  data.id = id;
  const row = objToRow(headers, data);
  const rowIdx = findRowById(sheet, id);
  if (rowIdx > 0) {
    sheet.getRange(rowIdx, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
    // Alternate row colors
    const last = sheet.getLastRow();
    if (last % 2 === 0) sheet.getRange(last, 1, 1, headers.length).setBackground('#f7fafc');
  }
  return { id };
}

function remove(collection, id) {
  const headers = collection === 'projects' ? PROJECT_HEADERS : STATUS_HEADERS;
  const sheet   = getSheet(collection, headers);
  const rowIdx  = findRowById(sheet, id);
  if (rowIdx > 0) sheet.deleteRow(rowIdx);
  return { deleted: id };
}

// ─── HELPERS ────────────────────────────────────────────────
function jsonOk(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, data }))
    .setMimeType(ContentService.MimeType.JSON);
}
function jsonErr(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}
