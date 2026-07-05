// =============================================
//   Drive Folder → Google Sheets Automation
//   הוראות התקנה בתחתית הקובץ
// =============================================

// ── הגדרות ──────────────────────────────────
const FOLDER_ID   = "PASTE_YOUR_FOLDER_ID_HERE";   // ID של תיקיית הדרייב
const SHEET_ID    = "PASTE_YOUR_SHEET_ID_HERE";    // ID של קובץ Google Sheets
const SHEET_NAME  = "קבצים";                        // שם הגיליון בתוך הקובץ
const PROCESSED_PROP = "processedFiles";            // מפתח לשמירת קבצים מעובדים

// ── פונקציה ראשית – רץ אוטומטית כל X דקות ──
function scanFolderAndLog() {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const sheet  = getOrCreateSheet();
  const processed = getProcessedFiles();

  const files = folder.getFiles();

  while (files.hasNext()) {
    const file = files.next();
    const fileId = file.getId();

    // דלג על קבצים שכבר עובדו
    if (processed[fileId]) continue;

    try {
      const row = buildRow(file);
      appendRow(sheet, row);
      processed[fileId] = true;
      Logger.log("✅ עובד: " + file.getName());
    } catch (e) {
      Logger.log("❌ שגיאה בקובץ " + file.getName() + ": " + e.message);
    }
  }

  saveProcessedFiles(processed);
}

// ── בניית שורה לגיליון ──────────────────────
function buildRow(file) {
  const name        = file.getName();
  const uploadDate  = Utilities.formatDate(file.getDateCreated(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");
  const modDate     = Utilities.formatDate(file.getLastUpdated(),  Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");
  const mimeType    = file.getMimeType();
  const url         = file.getUrl();
  const size        = Math.round(file.getSize() / 1024) + " KB";

  // חילוץ טקסט (OCR) — עובד על PDF ותמונות
  let ocrText = "";
  try {
    ocrText = extractTextOCR(file);
  } catch (e) {
    ocrText = "(לא ניתן לחלץ טקסט)";
  }

  // ── שדות חשבונית ───────────────────────────
  const invoiceDate   = extractInvoiceDate(ocrText);
  const issuerName    = extractIssuerName(ocrText);
  const amountNoVat   = extractAmountNoVat(ocrText);
  const amountWithVat = extractAmountWithVat(ocrText);
  const allocationNum = extractAllocationNumber(ocrText);

  return [name, uploadDate, invoiceDate, issuerName, amountNoVat, amountWithVat, allocationNum, url, ocrText];
}

// ── OCR: המרת PDF / תמונה לטקסט ────────────
function extractTextOCR(file) {
  const mime = file.getMimeType();
  const isImage = mime.startsWith("image/");
  const isPDF   = mime === "application/pdf";

  if (!isImage && !isPDF) return "(סוג קובץ לא נתמך ל-OCR)";

  // העתק את הקובץ ל-Google Drive ופתח אותו כ-Google Doc (OCR אוטומטי)
  const blob    = file.getBlob();
  const resource = { title: "__ocr_temp__", mimeType: "application/vnd.google-apps.document" };
  const options  = { ocr: true, ocrLanguage: "iw" };  // "iw" = עברית, שנה ל-"en" לאנגלית

  const docFile = Drive.Files.insert(resource, blob, options);
  const docId   = docFile.id;

  // קרא את הטקסט
  const doc  = DocumentApp.openById(docId);
  const text = doc.getBody().getText();

  // מחק את הקובץ הזמני
  DriveApp.getFileById(docId).setTrashed(true);

  return text.trim();
}

// ── חילוץ שדות חשבונית ──────────────────────

function extractInvoiceDate(text) {
  // מחפש תאריך ליד המילים: תאריך, חשבונית, מיום
  const patterns = [
    /תאריך\s*(?:חשבונית|מסמך|הפקה)?[:\s]+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/,
    /(?:מיום|ל-?תאריך)[:\s]+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/,
    /(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})/   // fallback — תאריך ראשון בטקסט
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return "";
}

function extractIssuerName(text) {
  // שם העסק בדרך כלל בשורה הראשונה / ליד "שם העוסק" / "הוצא על ידי"
  const patterns = [
    /(?:שם\s*(?:העוסק|המוציא|החברה|העסק))[:\s]+(.+)/,
    /(?:הוצא\s*(?:על\s*ידי|ע"י))[:\s]+(.+)/,
    /(?:לכבוד|from)[:\s]+(.+)/i
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].split('\n')[0].trim();
  }
  // fallback — שורה ראשונה לא ריקה
  const firstLine = text.split('\n').find(l => l.trim().length > 2);
  return firstLine ? firstLine.trim() : "";
}

function extractAmountNoVat(text) {
  const patterns = [
    /(?:סכום\s*)?(?:לפני|ללא|טרם)\s*מע"?מ[:\s]+([\d,]+(?:\.\d{1,2})?)/,
    /(?:מחיר|סכום)\s*(?:נטו|לפני\s*מס)[:\s]+([\d,]+(?:\.\d{1,2})?)/,
    /(?:base|subtotal|before\s*vat)[:\s]+([\d,]+(?:\.\d{1,2})?)/i
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].replace(/,/g, "");
  }
  return "";
}

function extractAmountWithVat(text) {
  const patterns = [
    /(?:סה"?כ|סכום\s*(?:כולל|סופי|לתשלום))\s*(?:כולל\s*מע"?מ)?[:\s]+([\d,]+(?:\.\d{1,2})?)/,
    /(?:לתשלום|total|grand\s*total)[:\s]+([\d,]+(?:\.\d{1,2})?)/i,
    /(?:כולל\s*מע"?מ)[:\s]+([\d,]+(?:\.\d{1,2})?)/
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].replace(/,/g, "");
  }
  return "";
}

function extractAllocationNumber(text) {
  // מספר הקצאה / אסמכתא / מספר אישור
  const patterns = [
    /(?:מספר\s*הקצאה|מס'?\s*הקצאה)[:\s]+(\w+)/,
    /(?:הקצאה)[:\s#]+(\w+)/,
    /(?:אסמכתא|אישור)[:\s#]+(\w+)/,
    /(?:confirmation|reference|ref)\s*(?:no\.?|number|#)?[:\s]+(\w+)/i
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return "";
}

// ── עזר כללי ─────────────────────────────────
function extractField(text, regex) {
  const match = text.match(regex);
  return match ? match[1].trim() : "";
}

// ── ניהול גיליון ────────────────────────────
function getOrCreateSheet() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  let sheet   = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    const headers = ["שם קובץ", "תאריך העלאה", "תאריך חשבונית", "שם מוציא", "סכום ללא מעמ", "סכום כולל מעמ", "מספר הקצאה", "קישור", "תוכן OCR"];
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#4a86e8").setFontColor("#ffffff");
  }

  return sheet;
}

function appendRow(sheet, row) {
  sheet.appendRow(row);
}

// ── שמירת מצב קבצים מעובדים ─────────────────
function getProcessedFiles() {
  const raw = PropertiesService.getScriptProperties().getProperty(PROCESSED_PROP);
  return raw ? JSON.parse(raw) : {};
}

function saveProcessedFiles(data) {
  PropertiesService.getScriptProperties().setProperty(PROCESSED_PROP, JSON.stringify(data));
}

// ── איפוס (לשימוש ידני אם צריך) ─────────────
function resetProcessed() {
  PropertiesService.getScriptProperties().deleteProperty(PROCESSED_PROP);
  Logger.log("אופס — כל הקבצים יסרקו מחדש בפעם הבאה");
}

// ── הגדרת טריגר אוטומטי ─────────────────────
function createTrigger() {
  // מחק טריגרים קיימים
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  // צור טריגר חדש כל 5 דקות
  ScriptApp.newTrigger("scanFolderAndLog")
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log("✅ טריגר נוצר — הסקריפט ירוץ כל 5 דקות");
}

/*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  הוראות התקנה
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. פתח את script.google.com (חשבון Google שלך)
2. צור פרויקט חדש → העתק את כל הקוד הזה

3. מצא את ה-FOLDER_ID:
   - פתח את תיקיית הדרייב
   - ה-ID הוא החלק האחרון ב-URL:
     drive.google.com/drive/folders/[זה-ה-ID]

4. מצא את ה-SHEET_ID:
   - פתח את קובץ Google Sheets
   - ה-ID הוא ב-URL:
     docs.google.com/spreadsheets/d/[זה-ה-ID]/edit

5. הכנס את ה-IDs בשורות FOLDER_ID ו-SHEET_ID למעלה

6. הפעל את Drive API:
   Services → הוסף → "Google Drive API" (לא Drive Service)

7. הרץ את הפונקציה createTrigger() פעם אחת
   (ייבקש ממך אישורי הרשאה — אשר הכל)

8. זהו! הסקריפט יבדוק כל 5 דקות קבצים חדשים

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
*/
