// ══════════════════════════════════════════════════════════════
//   סינומקס — בניית Google Sheets מסודר מתיקיית דרייב
//   הרץ: buildSinomaksSheet()
// ══════════════════════════════════════════════════════════════

const SINO_FOLDER_ID = "1joHlTQnktkvhxSDiISvnB4_A-IM9sxPV";
const SHEET_TITLE    = "סינומקס — ניהול מסמכים";

// ── סיווג קבצים ──────────────────────────────────────────────
function classifyFile(name) {
  const n = name.toLowerCase();

  if (/כרטסת/.test(name))                          return "כרטסות";
  if (/tax_invoice|חשבונית מס|חשבונית_מס/.test(n)) return "חשבוניות מס";
  if (/hashdoc/.test(n))                            return "חשבוניות מס";
  if (/חשבונית\s*5|חשבונית\s*6/.test(name))        return "חשבוניות מס";
  if (/^(50|60|61|70)\d+/.test(name.split(".")[0])) return "חשבוניות מס";
  if (/מס הקצאה|הקצאה/.test(name))                 return "מס הקצאה";
  if (/receipt|קבלה/.test(n))                       return "קבלות";
  if (/proforma/i.test(n))                          return "פרופורמות";
  if (/whatsapp image|img_|img-/.test(n))           return "תמונות וצ'קים";
  if (/camscanner|scanned|whatsapp scan/.test(n))   return "מסמכים סרוקים";
  if (/\.xlsx?$|\.csv$/.test(n))                    return "קבצי אקסל";
  if (/סינומקס/.test(name))                         return "חשבוניות מס";
  return "אחר";
}

function extractDocNumber(name) {
  const m = name.match(/\d{4,}/);
  return m ? m[0] : "";
}

// ── צבעי לשוניות ─────────────────────────────────────────────
const TAB_COLORS = {
  "סיכום":             { red: 0.13, green: 0.13, blue: 0.13 },
  "חשבוניות מס":      { red: 0.18, green: 0.46, blue: 0.78 },
  "קבלות":             { red: 0.18, green: 0.66, blue: 0.44 },
  "פרופורמות":         { red: 0.58, green: 0.28, blue: 0.73 },
  "מס הקצאה":         { red: 0.93, green: 0.60, blue: 0.15 },
  "כרטסות":            { red: 0.40, green: 0.40, blue: 0.40 },
  "תמונות וצ'קים":    { red: 0.82, green: 0.37, blue: 0.30 },
  "מסמכים סרוקים":    { red: 0.60, green: 0.45, blue: 0.20 },
  "קבצי אקסל":        { red: 0.20, green: 0.55, blue: 0.30 },
  "אחר":               { red: 0.60, green: 0.60, blue: 0.60 },
};

const HEADERS = ["#", "שם קובץ", "מספר מסמך", "תאריך קובץ", "פתח קובץ", "קטגוריה", "הערות"];

// ── פונקציה ראשית ─────────────────────────────────────────────
function buildSinomaksSheet() {
  const folder = DriveApp.getFolderById(SINO_FOLDER_ID);

  // ── איסוף וסיווג קבצים ──
  const categorized = {};
  const allFiles    = [];
  const fileIter    = folder.getFiles();

  while (fileIter.hasNext()) {
    const f    = fileIter.next();
    const name = f.getName();
    const cat  = classifyFile(name);
    if (!categorized[cat]) categorized[cat] = [];
    const row = {
      name:    name,
      docNum:  extractDocNumber(name),
      date:    Utilities.formatDate(f.getDateCreated(), "Asia/Jerusalem", "dd/MM/yyyy"),
      url:     f.getUrl(),
      cat:     cat,
    };
    categorized[cat].push(row);
    allFiles.push(row);
  }

  // ── גם תת-תיקיות ──
  const subIter = folder.getFolders();
  while (subIter.hasNext()) {
    const sub     = subIter.next();
    const subFiles = sub.getFiles();
    while (subFiles.hasNext()) {
      const f    = subFiles.next();
      const name = f.getName();
      const cat  = classifyFile(name);
      if (!categorized[cat]) categorized[cat] = [];
      const row = {
        name:   name,
        docNum: extractDocNumber(name),
        date:   Utilities.formatDate(f.getDateCreated(), "Asia/Jerusalem", "dd/MM/yyyy"),
        url:    f.getUrl(),
        cat:    cat,
      };
      categorized[cat].push(row);
      allFiles.push(row);
    }
  }

  // ── יצירת Spreadsheet ──
  const ss = SpreadsheetApp.create(SHEET_TITLE);
  const ssUrl = ss.getUrl();

  // ── גיליון סיכום ──
  const summarySheet = ss.getActiveSheet();
  summarySheet.setName("סיכום");
  summarySheet.setTabColor && summarySheet.setTabColor("#212121");
  summarySheet.setRightToLeft(true);

  const now = Utilities.formatDate(new Date(), "Asia/Jerusalem", "dd/MM/yyyy HH:mm");
  const summaryData = [
    ["סינומקס — ניהול מסמכים", "", ""],
    ["תאריך עדכון:", now, ""],
    ["סה״כ קבצים:", allFiles.length, ""],
    ["", "", ""],
    ["קטגוריה", "מספר קבצים", "קישור ללשונית"],
  ];

  const catOrder = [
    "חשבוניות מס", "קבלות", "פרופורמות", "מס הקצאה",
    "כרטסות", "תמונות וצ'קים", "מסמכים סרוקים", "קבצי אקסל", "אחר"
  ];

  for (const cat of catOrder) {
    if (categorized[cat] && categorized[cat].length > 0) {
      summaryData.push([cat, categorized[cat].length, `ראה לשונית "${cat}"`]);
    }
  }

  summarySheet.getRange(1, 1, summaryData.length, 3).setValues(summaryData);

  // עיצוב כותרת סיכום
  const titleRange = summarySheet.getRange(1, 1, 1, 3);
  titleRange.merge();
  titleRange.setValue("סינומקס — ניהול מסמכים");
  titleRange.setBackground("#212121").setFontColor("#ffffff")
    .setFontSize(16).setFontWeight("bold").setHorizontalAlignment("center");

  summarySheet.getRange(5, 1, 1, 3)
    .setBackground("#cccccc").setFontWeight("bold");

  summarySheet.setColumnWidth(1, 200);
  summarySheet.setColumnWidth(2, 120);
  summarySheet.setColumnWidth(3, 200);
  summarySheet.setFrozenRows(1);

  // ── גיליון לכל קטגוריה ──
  for (const cat of catOrder) {
    const rows = categorized[cat];
    if (!rows || rows.length === 0) continue;

    const sheet = ss.insertSheet(cat);
    sheet.setRightToLeft(true);

    const color = TAB_COLORS[cat] || TAB_COLORS["אחר"];
    const hex   = rgbToHex(color);
    try { sheet.setTabColor(hex); } catch(e) {}

    // כותרות
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    styleHeader(sheet, color, HEADERS.length);

    // שורות נתונים
    rows.sort((a, b) => a.name.localeCompare(b.name, "he"));
    const dataRows = rows.map((r, i) => [
      i + 1,
      r.name,
      r.docNum,
      r.date,
      `=HYPERLINK("${r.url}","📂 פתח")`,
      r.cat,
      "",
    ]);

    sheet.getRange(2, 1, dataRows.length, HEADERS.length).setValues(dataRows);

    // עיצוב עמודות
    sheet.setColumnWidth(1, 45);   // #
    sheet.setColumnWidth(2, 300);  // שם קובץ
    sheet.setColumnWidth(3, 110);  // מספר מסמך
    sheet.setColumnWidth(4, 110);  // תאריך
    sheet.setColumnWidth(5, 90);   // קישור
    sheet.setColumnWidth(6, 130);  // קטגוריה
    sheet.setColumnWidth(7, 150);  // הערות
    sheet.setFrozenRows(1);

    Logger.log(`✅ ${cat}: ${rows.length} שורות`);
  }

  // ── הדפס קישורים ──
  Logger.log("══════════════════════════════════");
  Logger.log("✅ הושלם! קישור לגיליון:");
  Logger.log(ssUrl);
  Logger.log("══════════════════════════════════");

  // הצג הודעה למשתמש
  SpreadsheetApp.getUi && SpreadsheetApp.getUi().alert(
    "✅ הושלם!\n\nהגיליון נוצר בהצלחה.\nקישור:\n" + ssUrl
  );

  return ssUrl;
}

// ── עזר: עיצוב כותרת ────────────────────────────────────────
function styleHeader(sheet, colorRgb, numCols) {
  const range = sheet.getRange(1, 1, 1, numCols);
  range.setBackground(rgbToHex(colorRgb))
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setFontSize(11)
    .setHorizontalAlignment("center");
  sheet.setFrozenRows(1);
}

function rgbToHex(rgb) {
  const r = Math.round((rgb.red   || 0) * 255).toString(16).padStart(2, "0");
  const g = Math.round((rgb.green || 0) * 255).toString(16).padStart(2, "0");
  const b = Math.round((rgb.blue  || 0) * 255).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}
