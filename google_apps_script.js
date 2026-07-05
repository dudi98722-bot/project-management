// ════════════════════════════════════════════════════
// קוד לגוגל Apps Script — הדבק בגיליון שלך
// Extensions → Apps Script → מחק הכל → הדבק → שמור
// ════════════════════════════════════════════════════

function onEdit(e) {
  if (!e || !e.range) return; // הגנה מפני הרצה ידנית
  const sheet = e.source.getActiveSheet();
  if (sheet.getName() !== "משימות") return;

  const range = e.range;
  const col = range.getColumn();
  const row = range.getRow();
  if (row < 2) return; // דלג על שורת כותרת
  if (e.value !== "TRUE") return; // רק כשמסמנים V

  const doneSheet = e.source.getSheetByName("משימות שבוצעו");

  // ── קבוצה 1: עמודות B–C, צ'קבוקס D ──
  if (col === 4) {
    const taskValue = sheet.getRange(row, 3).getValue(); // עמודה C

    if (doneSheet) {
      const lastRow = doneSheet.getLastRow();
      doneSheet.getRange(lastRow + 1, 2).setValue(taskValue); // עמודה B
    }

    sheet.getRange(row, 2, 1, 2).clearContent(); // מחק B ו-C
    sheet.getRange(row, 4).setValue(false);       // בטל סימון D
  }

  // ── קבוצה 2: עמודות H–I, צ'קבוקס J ──
  if (col === 10) {
    const taskValue = sheet.getRange(row, 9).getValue(); // עמודה I

    if (doneSheet) {
      const lastRow = doneSheet.getLastRow();
      doneSheet.getRange(lastRow + 1, 6).setValue(taskValue); // עמודה F
    }

    sheet.getRange(row, 8, 1, 2).clearContent(); // מחק H ו-I
    sheet.getRange(row, 10).setValue(false);      // בטל סימון J
  }

  // ── קבוצה 3: עמודות N–O, צ'קבוקס P ──
  if (col === 16) {
    const taskValue = sheet.getRange(row, 15).getValue(); // עמודה O

    if (doneSheet) {
      const lastRow = doneSheet.getLastRow();
      doneSheet.getRange(lastRow + 1, 11).setValue(taskValue); // עמודה K
    }

    sheet.getRange(row, 14, 1, 2).clearContent(); // מחק N ו-O
    sheet.getRange(row, 16).setValue(false);       // בטל סימון P
  }
}
