/**************************************************************************
 * מערכת ניהול דירות ושותפויות — צד שרת (Google Apps Script)
 * ------------------------------------------------------------------------
 *  - הנתונים נשמרים בגיליון (לשונית מוסתרת "_data" בפורמט JSON)
 *  - לשוניות קריאות לצפייה וביקורת (נדרסות בכל שמירה — אל תערוך ידנית)
 *  - אימות בצד השרת: בלי קוד כניסה תקף השרת לא מחזיר ולא שומר כלום
 *  - שחזור קוד כניסה במייל
 **************************************************************************/

var DATA_SHEET  = "_data";
/* מונה גרסה + טביעת אימות קלה, כדי שבדיקת "יש עדכון?" תהיה זולה
   ולא תדרוש קריאה וניתוח של כל מסד הנתונים בכל פעם */
var REV_PROP    = "crm_rev";
var AUTH_PROP   = "crm_auth";
var RESET_SHEET = "_reset";
var STAGING_SHEET = "_data_new";   // הנתונים נכתבים לכאן קודם, ורק אחרי אימות מוחלפים
var BAK_PREFIX  = "_bak_";         // גיבוי יומי מתגלגל בתוך הגיליון
var BAK_KEEP    = 3;
var INIT_PROP   = "crm_initialized";   // ננעל ברגע שיש משתמשים — ולעולם אינו מתאפס
var CHUNK       = 40000;

/* ⚠️ לכאן יישלח קוד השחזור. קבוע בשרת בכוונה — כך שאיש לא יכול להפנות שחזור לעצמו. */
var OWNER_EMAIL   = "dudi98722@gmail.com";
var RESET_MINUTES = 15;

/* ============================ נתיבים ============================ */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = p.action || "";

  if (action === "status") {
    // מידע ציבורי מינימלי בלבד — האם כבר קיים משתמש. בלי נתונים.
    return jsonOut({ ok: true, hasUsers: hasAnyUser() });
  }
  if (action === "requestReset") {
    return jsonOut(requestReset(p.user || ""));
  }
  if (action === "verifyReset") {
    return jsonOut(verifyReset(p.code || ""));
  }
  return jsonOut({ ok: true, status: "apartments-crm backend ready" });
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents) || {};
    var action = body.action || "";

    // ---- הקמה ראשונית: מותרת רק כשאין עדיין אף משתמש ----
    if (action === "bootstrap") {
      /* הנעילה על "אי-פעם אותחל", לא על "יש משתמשים עכשיו": אחרת מחיקת
         המשתמשים הייתה פותחת מחדש את הדלת לכל האינטרנט להשתלט על
         המסד. שחזור אחרי מחיקה — רק דרך המייל של הבעלים. */
      if (everInit() || hasAnyUser()) return jsonOut({ ok: false, error: "already-initialized" });
      if (!body.data) return jsonOut({ ok: false, error: "no-data" });
      saveData(body.data);
      return jsonOut({ ok: true });
    }

    // ---- כניסה: מאמת קוד מול המשתמשים ששמורים בגיליון ----
    if (action === "login") {
      /* כתובת ה-Apps Script גלויה בקוד הדף, ולכן הקוד הוא ההגנה היחידה.
         בלי ויסות אפשר לנסות מיליוני קודים. כאן: השהיה קבועה בכל כישלון
         + תקרת ניסיונות בחלון זמן. משתמש אמיתי שטועה פעם-פעמיים לא מרגיש. */
      var gate = loginGate();
      if (!gate.ok) return jsonOut({ ok: false, error: "too-many", retryAfter: gate.retryAfter });
      var u = findUser(body.codeHash);
      if (!u) {
        noteLoginFail();
        Utilities.sleep(1200);          // מאט ניסיון-בכוח-גס בלי לפגוע במשתמש
        return jsonOut({ ok: false, error: "bad-code" });
      }
      clearLoginFails();
      return jsonOut({ ok: true, user: publicUser(u) });
    }

    // ---- קביעת קוד חדש אחרי שחזור במייל ----
    if (action === "setCode") {
      var chk = peekResetToken(body.resetToken);
      if (!chk.ok) return jsonOut(chk);
      var d = loadData();
      if (!d) return jsonOut({ ok: false, error: "no-data" });
      d.users = d.users || [];
      // המשתמש שביקש את השחזור (נשמר עם הבקשה). בקשה ישנה בלי מזהה — המנהל.
      var target = null;
      for (var i = 0; i < d.users.length; i++) {
        if (!d.users[i].deleted && chk.userId && d.users[i].id === chk.userId) { target = d.users[i]; break; }
      }
      // אסימון שקושר למשתמש שנמחק בינתיים — נכשל, לא נופלים לחשבון המנהל
      if (!target && chk.userId) return jsonOut({ ok: false, error: "user-not-found" });
      if (!target) {                    // בקשה ישנה בלי מזהה (תאימות) — המנהל
        for (var j2 = 0; j2 < d.users.length; j2++) {
          if (!d.users[j2].deleted && d.users[j2].role === "admin") { target = d.users[j2]; break; }
        }
      }
      // הקוד הוא הזהות בכניסה — קוד שכבר תפוס אצל משתמש אחר היה ממזג חשבונות
      for (var k = 0; k < d.users.length; k++) {
        var o = d.users[k];
        if (!o.deleted && o.active && o.code === body.codeHash && (!target || o.id !== target.id)) {
          return jsonOut({ ok: false, error: "code-taken" });
        }
      }
      if (target) { target.code = body.codeHash; target.active = true; }
      else {
        d.users.push({ id: "u" + new Date().getTime(), name: "מנהל", code: body.codeHash,
          role: "admin", allowedApartments: [], partnerId: null, active: true, deleted: false });
      }
      clearReset();                     // האסימון חד-פעמי — נשרף רק אחרי הצלחה
      saveData(d);
      return jsonOut({ ok: true });
    }

    /* בדיקת גרסה בלבד: אימות מהיר מול טביעת הקודים שנשמרת בהגדרות
       הסקריפט, כדי שסקירה תקופתית לא תטען את כל מסד הנתונים. */
    if (action === "rev" && quickAuth(body.codeHash)) {
      return jsonOut({ ok: true, rev: storedRev() });
    }

    // ---- מכאן והלאה חובה קוד כניסה תקף ----
    var user = findUser(body.codeHash);
    if (!user) return jsonOut({ ok: false, error: "unauthorized" });

    if (action === "rev") {
      return jsonOut({ ok: true, rev: storedRev() });
    }
    if (action === "load") {
      // כל משתמש מקבל רק את מה ששויך לו, ולעולם לא את ה-hash של הקודים
      return jsonOut({ ok: true, data: scopeDataForUser(loadData() || {}, user), user: publicUser(user) });
    }
    if (action === "save") {
      if (user.role === "viewer" || user.role === "partner" || user.role === "mgmt") {
        return jsonOut({ ok: false, error: "forbidden" });
      }
      return jsonOut(saveWithRevGuard(body.data, user));
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

/* ==================== ויסות ניסיונות כניסה ====================
   נשמר בהגדרות הסקריפט (זול ומהיר). המגבלה גלובלית — ב-Apps Script
   אין כתובת IP של הפונה — ולכן היא רחבה מספיק כדי שמשתמש אמיתי
   לא ייחסם, וצרה מספיק כדי שסריקה שיטתית תיקח שנים. */
var LOGIN_PROP     = "crm_login_fails";
var LOGIN_MAX      = 20;            // כישלונות מותרים בחלון
var LOGIN_WINDOW_M = 5;             // אורך החלון בדקות
var LOGIN_COOL_M   = 2;             // צינון אחרי חריגה
function loginState() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(LOGIN_PROP);
    return raw ? JSON.parse(raw) : { n: 0, first: 0, until: 0 };
  } catch (err) { return { n: 0, first: 0, until: 0 }; }
}
function saveLoginState(s) {
  try { PropertiesService.getScriptProperties().setProperty(LOGIN_PROP, JSON.stringify(s)); } catch (err) {}
}
function loginGate() {
  var s = loginState(), now = new Date().getTime();
  if (s.until && now < s.until) {
    return { ok: false, retryAfter: Math.ceil((s.until - now) / 1000) };
  }
  return { ok: true };
}
function noteLoginFail() {
  var s = loginState(), now = new Date().getTime();
  if (!s.first || now - s.first > LOGIN_WINDOW_M * 60000) { s.n = 0; s.first = now; }
  s.n++;
  if (s.n >= LOGIN_MAX) { s.until = now + LOGIN_COOL_M * 60000; s.n = 0; s.first = now; }
  saveLoginState(s);
}
function clearLoginFails() { saveLoginState({ n: 0, first: 0, until: 0 }); }

/* ============================ אימות ============================ */
function hasAnyUser() {
  var d = loadData();
  if (!d || !d.users) return false;
  for (var i = 0; i < d.users.length; i++) {
    if (!d.users[i].deleted && d.users[i].active) return true;
  }
  return false;
}

function findUser(codeHash) {
  if (!codeHash) return null;
  var d = loadData();
  if (!d || !d.users) return null;
  for (var i = 0; i < d.users.length; i++) {
    var u = d.users[i];
    if (!u.deleted && u.active && u.code === codeHash) return u;
  }
  return null;
}

function publicUser(u) {
  return { id: u.id, name: u.name, role: u.role,
    allowedApartments: u.allowedApartments || [], partnerId: u.partnerId || null };
}

/* ==================== שחזור קוד כניסה במייל ==================== */
/* הקוד נשלח למייל שמשויך למשתמש שביקש. מנהל בלי מייל משויך ממשיך
   לקבל ל-OWNER_EMAIL (תאימות לאחור); משתמש אחר בלי מייל מקבל שגיאה. */
function normName(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
var RESET_REQ_PROP = "crm_reset_reqs";
var RESET_REQ_MAX  = 4;             // בקשות שחזור מותרות בשעה
/* בלי ויסות אפשר להציף את תיבת המייל של הבעלים, וגם לדרוס שוב ושוב
   בקשת שחזור לגיטימית שנמצאת באמצע. */
function resetReqGate() {
  try {
    var props = PropertiesService.getScriptProperties();
    var s = JSON.parse(props.getProperty(RESET_REQ_PROP) || '{"n":0,"first":0}');
    var now = new Date().getTime();
    if (!s.first || now - s.first > 3600000) { s.n = 0; s.first = now; }
    s.n++;
    props.setProperty(RESET_REQ_PROP, JSON.stringify(s));
    return s.n <= RESET_REQ_MAX;
  } catch (err) { return true; }
}
function requestReset(userName) {
  if (!resetReqGate()) return { ok: false, error: "too-many" };
  try {
    var d = loadData();
    var want = normName(userName);
    var user = null;
    if (d && d.users) {
      for (var i = 0; i < d.users.length; i++) {
        var u = d.users[i];
        if (u.deleted || !u.active) continue;
        if (want ? normName(u.name) === want : u.role === "admin") { user = u; break; }
      }
    }
    if (!user) {
      /* אין אף משתמש פעיל במסד (אחרי מחיקה/שחזור)? דלת מילוט אחת:
         קוד שחזור למייל הבעלים הקבוע בקוד. setCode ייצור מנהל חדש. */
      var anyActive = false;
      if (d && d.users) for (var q = 0; q < d.users.length; q++)
        if (!d.users[q].deleted && d.users[q].active) { anyActive = true; break; }
      if (!anyActive) user = { id: "", name: "בעל המערכת", role: "admin", email: OWNER_EMAIL };
      else return { ok: false, error: "user-not-found" };
    }
    var email = String(user.email || "").trim();
    if (!email && user.role === "admin") email = OWNER_EMAIL;
    if (!email) return { ok: false, error: "no-email" };
    var code = String(Math.floor(100000 + Math.random() * 900000));
    var exp  = new Date().getTime() + RESET_MINUTES * 60 * 1000;
    var sh = ss().getSheetByName(RESET_SHEET) || ss().insertSheet(RESET_SHEET);
    sh.clear();
    // עמודה 5 = מונה ניסיונות כושלים (נגד ניחוש בכוח גס)
    sh.getRange(1, 1, 1, 5).setValues([[code, exp, "", user.id, 0]]);
    try { sh.hideSheet(); } catch (err) {}
    MailApp.sendEmail(email,
      "קוד שחזור — מערכת ניהול דירות",
      "שלום " + user.name + ",\n\n" +
      "קוד השחזור שלך הוא: " + code + "\n\n" +
      "הקוד תקף ל-" + RESET_MINUTES + " דקות וניתן לשימוש חד-פעמי.\n" +
      "אם לא ביקשת שחזור — התעלם מהודעה זו ושקול להחליף את קוד הכניסה.");
    return { ok: true, sentTo: email.replace(/^(.{2}).*(@.*)$/, "$1***$2") };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

var RESET_MAX_TRIES = 5;
/* מאמת את הקוד מהמייל ומחזיר אסימון קצר-מועד שמתיר קביעת קוד חדש.
   נעילה: אחרי RESET_MAX_TRIES ניחושים כושלים הקוד נשרף — כך שקוד בן
   6 ספרות אינו ניתן לניחוש בכוח גס בחלון תוקפו. */
function verifyReset(code) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { ok: false, error: "busy" }; }
  try {
    var sh = ss().getSheetByName(RESET_SHEET);
    if (!sh || sh.getLastRow() === 0) return { ok: false, error: "no-request" };
    var v = sh.getRange(1, 1, 1, 5).getValues()[0];
    var stored = String(v[0] || "");
    var exp    = Number(v[1] || 0);
    var tries  = Number(v[4] || 0);
    if (!stored) return { ok: false, error: "no-request" };
    if (new Date().getTime() > exp) { sh.clear(); return { ok: false, error: "expired" }; }
    if (String(code).trim() !== stored) {
      tries++;
      if (tries >= RESET_MAX_TRIES) { sh.clear(); return { ok: false, error: "too-many" }; }
      sh.getRange(1, 5).setValue(tries);
      return { ok: false, error: "bad-code" };
    }
    var token = Utilities.getUuid();
    // שומרים את מזהה המשתמש — כדי שהקוד החדש ייקבע לו ולא למנהל
    sh.getRange(1, 1, 1, 5).setValues([["", new Date().getTime() + 10 * 60 * 1000, token, String(v[3] || ""), 0]]);
    return { ok: true, resetToken: token };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally { lock.releaseLock(); }
}

/* בודק את האסימון בלי לשרוף אותו — כך כשל "קוד תפוס" לא מאלץ
   להתחיל את כל השחזור מחדש. הניקוי נעשה רק אחרי הצלחה. */
function peekResetToken(token) {
  if (!token) return { ok: false, error: "no-token" };
  var sh = ss().getSheetByName(RESET_SHEET);
  if (!sh || sh.getLastRow() === 0) return { ok: false, error: "no-request" };
  var v = sh.getRange(1, 1, 1, 4).getValues()[0];
  var exp = Number(v[1] || 0);
  var stored = String(v[2] || "");
  if (!stored || stored !== token) return { ok: false, error: "bad-token" };
  if (new Date().getTime() > exp) { sh.clear(); return { ok: false, error: "expired" }; }
  return { ok: true, userId: String(v[3] || "") };
}
function clearReset() { var sh = ss().getSheetByName(RESET_SHEET); if (sh) sh.clear(); }

/* ========================= שמירה וטעינה ========================= */
/* שומר רק אם מונה הגרסה של הנשלח אינו נמוך מהשמור — עותק ישן ממכשיר
   אחר לא יכול לדרוס עבודה חדשה. נעילה מונעת מרוץ בין שמירות מקבילות. */
/* סופר את השורות בטבלאות המרכזיות — כולל שורות שנמחקו רכות, כי גם הן
   חלק מהמסד. ירידה חדה במספרן פירושה דריסה, לא עריכה. */
function dbRowCount(d) {
  var tables = ["apartments","partners","expenses","payments","income","deposits",
    "accounts","users","bankMoves","rentals","recurring","sheets","withdrawals",
    "expenseSplits","expenseManagerFees","categories","managers","apartmentPartners",
    "incMgmtPays","stmtBanks"];
  var n = 0;
  tables.forEach(function (t) { n += ((d && d[t]) || []).length; });
  return n;
}
function activeUserCount(d) {
  var n = 0, us = (d && d.users) || [];
  for (var i = 0; i < us.length; i++) if (!us[i].deleted && us[i].active) n++;
  return n;
}
function shrinkGuard(stored, incoming) {
  if (!stored) return null;
  var before = dbRowCount(stored), after = dbRowCount(incoming);
  if (before < 30) return null;                 // מסד קטן/חדש — אין מה להגן
  if (after >= before * 0.5) return null;       // ירידה מתונה — עריכה לגיטימית
  return "rows " + before + " -> " + after;     // נחסם ומדווח
}

function saveWithRevGuard(data, user) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { ok: false, error: "busy" }; }
  try {
    var stored = loadData();
    /* המערכת אותחלה בעבר אבל המסד לא נקרא? תקלה או מחיקה — שום שמירה
       לא עוברת עד שהבעלים משחזר. שמירה "ראשונה" על מסד כזה הייתה
       דורסת את מה שעוד ניתן לשחזר. */
    if (!stored && everInit()) return { ok: false, error: "storage-error" };
    var storedRev = (stored && stored.meta && Number(stored.meta.rev)) || 0;
    var incomingRev = (data && data.meta && Number(data.meta.rev)) || 0;
    /* דחייה גם על מונה שווה: שני משתמשים שיצאו מאותה גרסה מגיעים לאותו
       מונה, והמאחר היה דורס בשקט את הראשון. הלקוח מטפל ב-stale-rev
       במיזוג תלת-כיווני, כך ששני הצדדים נשמרים. */
    if (storedRev > 0 && incomingRev <= storedRev) {
      return { ok: false, error: "stale-rev", serverRev: storedRev };
    }
    // מיזוג לפי המשתמש: מה שלא שויך לו לא נדרס, וקודי כניסה נשמרים
    var toSave = stored ? mergeSaveForUser(stored, data, user || {}) : data;
    /* חוט-מכשול נגד מחיקה המונית: שמירה שמרוקנת מסד גדול נחסמת.
       מסד ריק/כמעט-ריק שנשלח מדפדפן עם מטמון ריק היה דורס עשרות שעות
       עבודה בלחיצה אחת. מחיקות במערכת הן ממילא רכות (deleted:true),
       ולכן שמירה לגיטימית לעולם לא מקטינה את מספר השורות בעשרות אחוזים. */
    var guard = shrinkGuard(stored, toSave);
    if (guard) return { ok: false, error: "shrink-guard", detail: guard };
    /* מחיקת כל המשתמשים בשמירה אחת = נעילת כולם בחוץ. לא קורה בעריכה
       לגיטימית — מנהל תמיד שולח את רשימת המשתמשים המלאה. */
    if (activeUserCount(stored) > 0 && activeUserCount(toSave) === 0)
      return { ok: false, error: "users-wipe" };
    saveData(toSave);
    return { ok: true, savedAt: new Date().toISOString(), rev: incomingRev };
  } finally {
    lock.releaseLock();
  }
}
/* מונה הגרסה השמור. נכתב בכל שמירה כדי שאפשר יהיה לענות על
   "יש עדכון?" בלי לקרוא את כל הגיליון. */
function storedRev() {
  try {
    var v = PropertiesService.getScriptProperties().getProperty(REV_PROP);
    if (v !== null && v !== "") return Number(v) || 0;
  } catch (err) {}
  var d = loadData();
  return (d && d.meta && Number(d.meta.rev)) || 0;
}
/* אימות קל לבדיקת גרסה בלבד — משווה מול רשימת ה-hash-ים השמורה
   בהגדרות הסקריפט. פעולות שמחזירות נתונים ממשיכות דרך findUser. */
function quickAuth(codeHash) {
  if (!codeHash) return false;
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(AUTH_PROP);
    if (!raw) return false;
    var list = JSON.parse(raw);
    for (var i = 0; i < list.length; i++) if (list[i] === codeHash) return true;
    return false;
  } catch (err) { return false; }
}
function rememberMeta(data) {
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty(REV_PROP, String((data && data.meta && Number(data.meta.rev)) || 0));
    var hashes = [];
    var users = (data && data.users) || [];
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      if (!u.deleted && u.active && u.code) hashes.push(u.code);
    }
    props.setProperty(AUTH_PROP, JSON.stringify(hashes));
  } catch (err) { /* לא מכשילים שמירה בגלל מטמון */ }
}

function saveData(data) {
  /* כתיבה אטומית: הגרסה הקודמת מחקה את הגיליון לפני שכתבה את החדש —
     כשל באמצע (מכסה, תקלה) השאיר מסד ריק. עכשיו הנתונים נכתבים
     לגיליון הכנה, מאומתים בקריאה חוזרת, ורק אז מוחלפים בשינוי שם.
     בכל שלב שנכשל — הנתונים הקיימים לא נפגעו.
     בנוסף: פעם ביום הגרסה הקודמת נשמרת כגיבוי מתגלגל בתוך הקובץ. */
  var str = JSON.stringify(data);
  var book = ss();
  var stage = book.getSheetByName(STAGING_SHEET) || book.insertSheet(STAGING_SHEET);
  stage.clear();
  var chunks = [];
  for (var i = 0; i < str.length; i += CHUNK) chunks.push([str.substr(i, CHUNK)]);
  if (chunks.length) stage.getRange(1, 1, chunks.length, 1).setValues(chunks);
  SpreadsheetApp.flush();
  /* אימות: מה שנקרא חזרה חייב להיות זהה למה שנשלח */
  var back = stage.getRange(1, 1, Math.max(stage.getLastRow(), 1), 1).getValues()
    .map(function (r) { return r[0]; }).join("");
  if (back !== str) throw new Error("storage-verify-failed");

  var old = book.getSheetByName(DATA_SHEET);
  var today = Utilities.formatDate(new Date(), "Etc/UTC", "yyyyMMdd");
  var bakName = BAK_PREFIX + today;
  if (old) {
    if (!book.getSheetByName(bakName)) {
      /* אין עדיין גיבוי להיום — הישן הופך לגיבוי (שינוי שם, בלי העתקה) */
      old.setName(bakName);
      try { old.hideSheet(); } catch (err) {}
    } else {
      book.deleteSheet(old);
    }
  }
  stage.setName(DATA_SHEET);
  /* מוחקים גיבויים ישנים — נשארים BAK_KEEP הימים האחרונים */
  var sheets = book.getSheets(), baks = [];
  for (var k = 0; k < sheets.length; k++) {
    var nm = sheets[k].getName();
    if (nm.indexOf(BAK_PREFIX) === 0) baks.push(nm);
  }
  baks.sort();                          // ישן -> חדש
  while (baks.length > BAK_KEEP) {
    try { book.deleteSheet(book.getSheetByName(baks.shift())); } catch (err) { break; }
  }
  SpreadsheetApp.flush();
  rememberMeta(data);
  /* יש משתמשים? המערכת מאותחלת — לצמיתות. גם אם המסד יימחק, אתחול
     מחדש יישאר נעול והשחזור יעבור דרך המייל של הבעלים. */
  try {
    var us = (data && data.users) || [];
    for (var m = 0; m < us.length; m++) {
      if (!us[m].deleted && us[m].active) {
        PropertiesService.getScriptProperties().setProperty(INIT_PROP, "1");
        break;
      }
    }
  } catch (err) {}
  try { renderReadable(data); } catch (err) { /* אל תיכשל את השמירה בגלל תצוגה */ }
  try { book.getSheetByName(DATA_SHEET).hideSheet(); } catch (err) {}
}

function readSheetJson(name) {
  var sh = ss().getSheetByName(name);
  if (!sh || sh.getLastRow() === 0) return null;
  var vals = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  var str = vals.map(function (r) { return r[0]; }).join("");
  if (!str) return null;
  try { return JSON.parse(str); } catch (err) { return null; }
}
function loadData() {
  /* _data חסר או פגום? לפני שמוותרים בודקים את אזור ההכנה ואת הגיבויים
     היומיים — קריסה באמצע החלפה אסור שתיראה כמו מסד ריק, כי מסד "ריק"
     פותח את הדלת לאתחול מחדש. */
  var d = readSheetJson(DATA_SHEET);
  if (d) return d;
  d = readSheetJson(STAGING_SHEET);
  if (d) return d;
  var sheets = ss().getSheets();
  var baks = [];
  for (var i = 0; i < sheets.length; i++) {
    var n = sheets[i].getName();
    if (n.indexOf(BAK_PREFIX) === 0) baks.push(n);
  }
  baks.sort().reverse();               // החדש ביותר קודם
  for (var j = 0; j < baks.length; j++) {
    d = readSheetJson(baks[j]);
    if (d) return d;
  }
  return null;
}
function everInit() {
  try { return PropertiesService.getScriptProperties().getProperty(INIT_PROP) === "1"; }
  catch (err) { return false; }
}

/* ======================= לשוניות קריאות ======================= */
function renderReadable(d) {
  var pMap   = mapBy(d.partners, "name");
  var aMap   = mapBy(d.apartments, "name");
  var mMap   = mapBy(d.managers, "name");
  var cMap   = mapBy(d.categories, "name");
  var accMap = mapBy(d.accounts, "name");
  var CLS = { investment: "השקעה", ongoing: "שוטף", private: "פרטי" };
  var yn  = function (b) { return b ? "כן" : ""; };
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

/* ============================================================
   סינון ומיזוג לפי משתמש — רץ בשרת (Apps Script), ES5 בלבד.
   מקור האמת הוא הבלוב המלא בשרת. כל משתמש מקבל רק את מה ששויך לו,
   וכששומר — השרת ממזג בחזרה כך ששום דבר שהוא לא ראה לא נדרס.
   ============================================================ */

function userCtx(user) {
  var isAdmin = user && user.role === "admin";
  var allowed = (user && user.allowedApartments) || [];
  /* משתמש מדור קודם ששויך לשותף (partnerId) אך בלי דירות מפורשות —
     נעול לכלום עד שמנהל יקצה לו דירות. fail-closed: לא "כל הדירות". */
  var legacyPartner = !isAdmin && !!(user && user.partnerId) && allowed.length === 0;
  return { isAdmin: isAdmin, nonAdmin: !isAdmin,
           limited: !isAdmin && (allowed.length > 0 || legacyPartner), allowed: allowed };
}
function aptSetFor(data, ctx) {
  var set = {};
  (data.apartments || []).forEach(function (a) {
    if (ctx.isAdmin || !ctx.limited || ctx.allowed.indexOf(a.id) >= 0) set[a.id] = 1;
  });
  return set;
}
function expSetFor(data, ctx, aptSet) {
  var set = {};
  (data.expenses || []).forEach(function (e) {
    if (!aptSet[e.apartmentId]) return;
    if (ctx.nonAdmin && e.hidden) return;
    set[e.id] = 1;
  });
  return set;
}
function rowVisible(table, row, ctx, aptSet, expSet) {
  switch (table) {
    case "apartments":          return !!aptSet[row.id];
    case "apartmentPartners":
    case "managers":
    case "deposits":
    case "income":              return !!aptSet[row.apartmentId];
    case "accounts":            return !row.apartmentId || !!aptSet[row.apartmentId];
    case "expenses":            return !!expSet[row.id];
    case "expenseSplits":
    case "expenseManagerFees":  return !!expSet[row.expenseId];
    case "payments":            return !!expSet[row.expenseId] && !(ctx.nonAdmin && row.hidden);
    default:                    return true;
  }
}
var SCOPED_TABLES = ["apartments","apartmentPartners","managers","accounts",
  "deposits","income","expenses","expenseSplits","expenseManagerFees","payments"];

/* ----- סינון בטעינה ----- */
function scopeDataForUser(data, user) {
  var ctx = userCtx(user);
  var d = JSON.parse(JSON.stringify(data));
  if (ctx.isAdmin) {
    d.users = (d.users || []).map(function (u) {
      var c = {}; for (var k in u) if (u.hasOwnProperty(k)) c[k] = u[k];
      c.code = "***"; return c;
    });
    return d;
  }
  d.users = [];
  var aptSet = aptSetFor(d, ctx), expSet = expSetFor(d, ctx, aptSet);
  SCOPED_TABLES.forEach(function (T) {
    d[T] = (d[T] || []).filter(function (r) { return rowVisible(T, r, ctx, aptSet, expSet); });
  });
  /* תפקיד "דמי ניהול": מנהל שמקבל דמי ניהול. מקבל אך ורק את השלבים
     שיש בהם דמי ניהול ואת התשלומים למנהלים — בלי חלוקת שותפים,
     תשלומי ספקים, הפקדות, הכנסות וחשבונות. */
  if (user.role === "mgmt") {
    var mgOk = {};
    (d.expenses || []).forEach(function (e) { if (e.mgmtEnabled) mgOk[e.id] = 1; });
    d.expenses = (d.expenses || []).filter(function (e) { return mgOk[e.id]; });
    d.payments = (d.payments || []).filter(function (p) { return mgOk[p.expenseId] && p.recipientType === "manager"; });
    d.expenseManagerFees = (d.expenseManagerFees || []).filter(function (f) { return mgOk[f.expenseId]; });
    d.expenseSplits = []; d.deposits = []; d.income = [];
    d.partners = []; d.apartmentPartners = []; d.accounts = [];
    return d;
  }
  /* שותפים: רק אלה שקשורים לדירות/לתנועות שכבר סוננו למשתמש. כך גם
     שם, וגם טלפון/הערות של שותפים מדירות אחרות — לא נשלחים כלל. */
  d.partners = scopePartnersFor(d);
  return d;
}
/* קבוצת מזהי-השותפים המוזכרים בנתונים שכבר סוננו למשתמש */
function referencedPartnerIds(d) {
  var s = {};
  (d.apartmentPartners || []).forEach(function (x) { if (x.partnerId) s[x.partnerId] = 1; });
  (d.expenseSplits || []).forEach(function (x) { if (x.partnerId) s[x.partnerId] = 1; });
  (d.deposits || []).forEach(function (x) { if (x.partnerId) s[x.partnerId] = 1; });
  (d.accounts || []).forEach(function (x) { if (x.partnerId) s[x.partnerId] = 1; });
  (d.payments || []).forEach(function (x) { if (x.payerPartnerId) s[x.payerPartnerId] = 1; });
  (d.income || []).forEach(function (x) { if (x.receivedBy && x.receivedBy !== "bank") s[x.receivedBy] = 1; });
  return s;
}
function scopePartnersFor(d) {
  var ref = referencedPartnerIds(d);
  return (d.partners || []).filter(function (p) { return ref[p.id]; });
}

/* ----- מיזוג בשמירה ----- */
function reconcileUserCodes(incoming, stored) {
  var storedById = {};
  (stored.users || []).forEach(function (u) { storedById[u.id] = u; });
  (incoming.users || []).forEach(function (u) {
    if (!u.code || u.code === "***") u.code = storedById[u.id] ? storedById[u.id].code : "";
  });
  var seen = {};
  (incoming.users || []).forEach(function (u) {
    if (u.deleted || !u.active || !u.code) return;
    if (seen[u.code]) { if (storedById[u.id]) u.code = storedById[u.id].code; }   /* קוד כפול — משאירים ישן */
    else seen[u.code] = 1;
  });
}
function mergeSaveForUser(stored, incoming, user) {
  var ctx = userCtx(user);
  if (ctx.isAdmin) { reconcileUserCodes(incoming, stored); return incoming; }

  var result = JSON.parse(JSON.stringify(incoming));
  result.users = stored.users || [];
  result.settings = stored.settings || result.settings;
  /* השרת שולח למשתמש מוגבל רק חלק מהשותפים — כדי לא לאבד את השאר
     בשמירה, ממזגים לפי id: מתחילים מהמאגר המלא השמור, ומעדכנים/מוסיפים
     את מה שהמשתמש שלח (עריכות ושותפים חדשים גוברים). */
  var pById = {};
  (stored.partners || []).forEach(function (p) { pById[p.id] = p; });
  (incoming.partners || []).forEach(function (p) { pById[p.id] = p; });
  result.partners = Object.keys(pById).map(function (k) { return pById[k]; });

  var aptSet = aptSetFor(stored, ctx), expSet = expSetFor(stored, ctx, aptSet);
  /* קבוצת הוצאות בהיקף המורשה — משורות ישנות וגם חדשות שנשלחו — כדי
     לאמת שילדים (חלוקות/תשלומים) מצביעים להוצאה בהיקף המותר */
  var allowedExp = {};
  (stored.expenses || []).forEach(function (e) { if (aptSet[e.apartmentId]) allowedExp[e.id] = 1; });
  (incoming.expenses || []).forEach(function (e) { if (aptSet[e.apartmentId]) allowedExp[e.id] = 1; });

  SCOPED_TABLES.forEach(function (T) {
    result[T] = result[T] || [];
    var fromIncoming = {}; result[T].forEach(function (r) { fromIncoming[r.id] = 1; });
    var storedIds = {}; (stored[T] || []).forEach(function (r) { storedIds[r.id] = 1; });

    /* 1. שחזור כל שורה שהוסתרה מהמשתמש ואינה במה ששלח — לא נאבד דבר */
    (stored[T] || []).forEach(function (row) {
      if (!rowVisible(T, row, ctx, aptSet, expSet) && !fromIncoming[row.id]) result[T].push(row);
    });
    /* 2. חיטוי לשורות שהמשתמש שלח */
    result[T] = result[T].filter(function (r) {
      if (fromIncoming[r.id] && !storedIds[r.id] && !newRowAllowed(T, r, ctx, aptSet, allowedExp))
        return false;                          /* הזרקה מחוץ להיקף — נזרק */
      return true;
    });
    if (T === "expenses" || T === "payments") {
      result[T].forEach(function (r) { if (fromIncoming[r.id]) delete r.hidden; }); /* רק מנהל מסתיר */
    }
  });
  return result;
}
function newRowAllowed(table, row, ctx, aptSet, allowedExp) {
  if (!ctx.limited) return true;
  switch (table) {
    case "apartments":          return false;
    case "apartmentPartners":
    case "managers":
    case "deposits":
    case "income":              return !!aptSet[row.apartmentId];
    case "accounts":            return !row.apartmentId || !!aptSet[row.apartmentId];
    case "expenses":            return !!aptSet[row.apartmentId];
    case "expenseSplits":
    case "expenseManagerFees":
    case "payments":            return !!allowedExp[row.expenseId];
    default:                    return true;
  }
}

