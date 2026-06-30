/**
 * אופקים CRM — Backend סנכרון (Google Apps Script + Google Sheets)
 * ------------------------------------------------------------------
 * שומר את כל נתוני המערכת כ-JSON יחיד בגיליון Google, ומאפשר
 * סנכרון בזמן אמת בין כל המכשירים שפתוחים על אותו קישור.
 *
 * התקנה (פעם אחת):
 *   1. https://script.google.com  →  New project
 *   2. הדבק את כל הקובץ הזה במקום ברירת המחדל ושמור.
 *   3. Deploy  →  New deployment  →  סוג: Web app
 *        Execute as:        Me
 *        Who has access:    Anyone
 *   4. אשר הרשאות, העתק את כתובת ה-Web app (מסתיימת ב-/exec)
 *      והדבק אותה ב-CRM (כפתור "☁️ סנכרון").
 *
 * הגיליון "אופקים CRM — נתונים" נוצר אוטומטית בפעם הראשונה.
 */

var SS_NAME = 'אופקים CRM — נתונים';
var SHEET   = 'data';

function getSheet_() {
  var ss, files = DriveApp.getFilesByName(SS_NAME);
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create(SS_NAME);
  }
  var sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.getRange('A1').setValue('');                 // JSON blob
    sh.getRange('C1').setValue('עודכן לאחרונה');
  }
  return sh;
}

function jsonOut_(text) {
  return ContentService.createTextOutput(text)
    .setMimeType(ContentService.MimeType.JSON);
}

function ok_(obj)  { return jsonOut_(JSON.stringify(obj || { status: 'ok' })); }

function save_(data) {
  var sh = getSheet_();
  sh.getRange('A1').setValue(data || '');
  sh.getRange('B1').setValue(new Date());           // timestamp
  return ok_({ status: 'ok', saved: (data || '').length });
}

function load_() {
  var sh = getSheet_();
  var raw = sh.getRange('A1').getValue();
  if (!raw) return jsonOut_('{}');
  return jsonOut_(String(raw));                     // already JSON
}

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p.action === 'save') return save_(p.data);
    return load_();                                  // default = load
  } catch (err) {
    return ok_({ status: 'error', message: String(err) });
  }
}

function doPost(e) {
  try {
    var p = (e && e.parameter) || {};
    var data = p.data || (e && e.postData && e.postData.contents) || '';
    return save_(data);
  } catch (err) {
    return ok_({ status: 'error', message: String(err) });
  }
}
