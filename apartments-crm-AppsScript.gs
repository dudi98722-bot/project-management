/**************************************************************************
 * מערכת ניהול דירות ושותפויות — צד שרת (Google Apps Script)
 * ------------------------------------------------------------------------
 * מה זה עושה:
 *   - שומר את כל הנתונים מהמערכת בגיליון גוגל (מקור גיבוי מלא, כולל מחיקה רכה)
 *   - מייצר לשוניות קריאות (דירות/שותפים/הוצאות/תשלומים/הפקדות/הכנסות...)
 *   - מאפשר טעינה חזרה למערכת
 *
 * הוראות התקנה (פעם אחת):
 *   1. היכנס ל- https://sheets.google.com  וצור גיליון חדש (ריק).
 *   2. תפריט: הרחבות (Extensions) → Apps Script.
 *   3. מחק את הקוד הקיים, הדבק את כל הקובץ הזה, ושמור (💾).
 *   4. לחץ "פריסה" (Deploy) → "פריסה חדשה" (New deployment).
 *   5. בגלגל השיניים בחר סוג: "אפליקציית אינטרנט" (Web app).
 *   6. "בצע בתור" (Execute as): אני / Me.
 *      "מי בעל גישה" (Who has access): כל אחד / Anyone.
 *   7. לחץ "פרוס" (Deploy), אשר הרשאות, והעתק את כתובת ה-Web app (מסתיימת ב-/exec).
 *   8. במערכת: הגדרות → גוגל שיטס → הדבק את הכתובת → שמור.
 *
 * הערה: הנתונים הקנוניים נשמרים בלשונית מוסתרת "_data" (בפורמט JSON).
 *       הלשוניות הקריאות הן לצפייה/גיבוי בלבד — אל תערוך אותן ידנית.
 **************************************************************************/

var DATA_SHEET = "_data";
var CHUNK = 40000;

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "";
  if (action === "load") {
    return jsonOut({ ok: true, data: loadData() });
  }
  return jsonOut({ ok: true, status: "apartments-crm backend ready" });
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.action === "save") {
      saveData(body.data);
      return jsonOut({ ok: true, savedAt: new Date().toISOString() });
    }
    return jsonOut({ ok: false, error: "unknown action" });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

/* ---------- שמירה ---------- */
function saveData(data) {
  var str = JSON.stringify(data);
  var sh = ss().getSheetByName(DATA_SHEET) || ss().insertSheet(DATA_SHEET);
  sh.clear();
  var chunks = [];
  for (var i = 0; i < str.length; i += CHUNK) chunks.push([str.substr(i, CHUNK)]);
  if (chunks.length) sh.getRange(1, 1, chunks.length, 1).setValues(chunks);
  try { renderReadable(data); } catch (err) { /* אל תיכשל את השמירה בגלל תצוגה */ }
  try { sh.hideSheet(); } catch (err) {}
}

/* ---------- טעינה ---------- */
function loadData() {
  var sh = ss().getSheetByName(DATA_SHEET);
  if (!sh || sh.getLastRow() === 0) return null;
  var vals = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  var str = vals.map(function (r) { return r[0]; }).join("");
  if (!str) return null;
  return JSON.parse(str);
}

/* ---------- לשוניות קריאות ---------- */
function renderReadable(d) {
  var pMap = mapBy(d.partners, "name");
  var aMap = mapBy(d.apartments, "name");
  var mMap = mapBy(d.managers, "name");
  var cMap = mapBy(d.categories, "name");
  var accMap = mapBy(d.accounts, "name");
  var CLS = { investment: "השקעה", ongoing: "שוטף", private: "פרטי" };
  var yn = function (b) { return b ? "כן" : ""; };
  var del = function (x) { return x.deleted ? "נמחק" : "פעיל"; };

  writeTab("דירות", ["שם", "הערות", "דמי ניהול", "בנק", "סטטוס"],
    (d.apartments || []).map(function (a) { return [a.name, a.notes, yn(a.hasManagement), yn(a.hasBank), del(a)]; }));

  writeTab("שותפים", ["שם", "טלפון", "הערות", "סטטוס"],
    (d.partners || []).map(function (p) { return [p.name, p.phone, p.notes, del(p)]; }));

  writeTab("שותפי_דירה", ["דירה", "שותף", "% ברירת מחדל", "סטטוס"],
    (d.apartmentPartners || []).map(function (x) { return [aMap[x.apartmentId], pMap[x.partnerId], x.defaultPercent, del(x)]; }));

  writeTab("מנהלים", ["דירה", "שם", "% ברירת מחדל", "סטטוס"],
    (d.managers || []).map(function (m) { return [aMap[m.apartmentId], m.name, m.defaultFeePercent, del(m)]; }));

  writeTab("הוצאות", ["דירה", "תאריך", "תיאור", "סוג", "סיווג", "סכום", "דמי ניהול?", "בסיס", "מע\"מ", "חשבונית", "הערה", "סטטוס"],
    (d.expenses || []).map(function (e) {
      return [aMap[e.apartmentId], e.date, e.description, cMap[e.categoryId] || "", CLS[e.classification] || "",
        e.amount, yn(e.mgmtEnabled), e.mgmtBaseType, e.mgmtVatRate, yn(e.hasInvoice), e.note, del(e)];
    }));

  var eDesc = mapBy(d.expenses, "description");
  writeTab("חלוקת_הוצאה", ["הוצאה", "שותף", "%", "סטטוס"],
    (d.expenseSplits || []).map(function (s) { return [eDesc[s.expenseId], pMap[s.partnerId], s.percent, del(s)]; }));

  writeTab("דמי_ניהול", ["הוצאה", "מנהל", "% נוכחי", "% דחוי", "תווית דחוי", "שוחרר", "סטטוס"],
    (d.expenseManagerFees || []).map(function (f) {
      return [eDesc[f.expenseId], mMap[f.managerId], f.pctCurrent, f.pctDeferred, f.deferredLabel, yn(f.deferredReleased), del(f)];
    }));

  var METH = { transfer: "העברה", check: "צ׳ק", cash: "מזומן", other: "אחר" };
  writeTab("תשלומים", ["עבור (הוצאה)", "תאריך", "סכום", "חשבון", "מי שילם", "מוטב", "אמצעי", "חשבונית", "הערה", "סטטוס"],
    (d.payments || []).map(function (p) {
      var recip = p.recipientType === "manager" ? ("מנהל: " + (mMap[p.recipientManagerId] || "")) : "ספק";
      return [eDesc[p.expenseId], p.date, p.amount, accMap[p.accountId] || "ידני",
        pMap[p.payerPartnerId] || "", recip, METH[p.method] || "", yn(p.hasInvoice), p.note, del(p)];
    }));

  writeTab("הפקדות_לבנק", ["דירה", "תאריך", "שותף", "סכום", "הערה", "סטטוס"],
    (d.deposits || []).map(function (x) { return [aMap[x.apartmentId], x.date, pMap[x.partnerId], x.amount, x.note, del(x)]; }));

  writeTab("הכנסות", ["דירה", "תאריך", "תיאור", "סכום", "הערה", "סטטוס"],
    (d.income || []).map(function (i) { return [aMap[i.apartmentId], i.date, i.description, i.amount, i.note, del(i)]; }));

  writeTab("חשבונות", ["דירה", "שם", "בנק?", "שייך לשותף", "סטטוס"],
    (d.accounts || []).map(function (ac) { return [aMap[ac.apartmentId], ac.name, yn(ac.isBank), pMap[ac.partnerId] || "", del(ac)]; }));
}

function writeTab(name, headers, rows) {
  var sh = ss().getSheetByName(name) || ss().insertSheet(name);
  sh.clear();
  var all = [headers].concat(rows.length ? rows : [headers.map(function () { return ""; })]);
  sh.getRange(1, 1, all.length, headers.length).setValues(all);
  sh.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#e8eefc");
  sh.setFrozenRows(1);
  sh.setRightToLeft(true);
}

function mapBy(arr, field) {
  var m = {};
  (arr || []).forEach(function (x) { m[x.id] = x[field]; });
  return m;
}
