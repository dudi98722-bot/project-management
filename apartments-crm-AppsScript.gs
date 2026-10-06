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
var BAK_KEEP    = 14;
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
    // guard = גרסת ההגנות, לאימות חיצוני שההדבקה נקלטה.
    return jsonOut({ ok: true, hasUsers: hasAnyUser(), guard: 8, files: 1 });
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
         authenticate מוסיף ויסות לפי הקוד שנוסה, השהיה בכישלון ורישום. */
      var au = authenticate(body.codeHash);
      if (!au.user) {
        if (au.error === "too-many") return jsonOut({ ok: false, error: "too-many", retryAfter: au.retryAfter });
        Utilities.sleep(400);
        return jsonOut({ ok: false, error: "bad-code" });
      }
      clearLoginFails(body.codeHash);
      noteGoodKey(body.codeHash);
      secLog("login", au.user.id, au.user.role);
      return jsonOut({ ok: true, user: publicUser(au.user) });
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
        if (!d.users[i].deleted && d.users[i].active && chk.userId && d.users[i].id === chk.userId) { target = d.users[i]; break; }
      }
      // אסימון שקושר למשתמש שנמחק בינתיים — נכשל, לא נופלים לחשבון המנהל
      if (!target && chk.userId) return jsonOut({ ok: false, error: "user-not-found" });
      if (!target) {                    // בקשה ישנה בלי מזהה (תאימות) — המנהל
        for (var j2 = 0; j2 < d.users.length; j2++) {
          if (!d.users[j2].deleted && d.users[j2].role === "admin") { target = d.users[j2]; break; }
        }
      }
      // הקוד הוא הזהות בכניסה — קוד שכבר תפוס אצל משתמש אחר היה ממזג חשבונות
      pepper(true);                     /* שחזור במייל הוא הדרך היחידה ליצור פלפל חדש אחרי אובדן */
      var newDerived = deriveCode(body.codeHash);
      for (var k = 0; k < d.users.length; k++) {
        var o = d.users[k];
        if (!o.deleted && o.active && o.code && codeMatches(o.code, body.codeHash, newDerived) &&
            (!target || o.id !== target.id)) {
          secLog("reset-code-taken", chk.userId || "", "");
          if (noteCodeTaken(body.resetToken)) return jsonOut({ ok: false, error: "too-many" });
          return jsonOut({ ok: false, error: "code-taken" });
        }
      }
      if (target) { target.code = newDerived; }
      else {
        d.users.push({ id: "u" + new Date().getTime(), name: "מנהל", code: newDerived,
          role: "admin", allowedApartments: [], partnerId: null, active: true, deleted: false });
      }
      saveData(d);
      clearReset(body.resetToken);      // האסימון חד-פעמי — נשרף רק אחרי שהשמירה הצליחה
      noteGoodKey(body.codeHash);       // המייל הוכיח זהות — הקוד החדש לא ייחסם בחסימה כללית
      secLog("code-reset", target ? target.id : "new-admin", "");
      alertOwner("קוד כניסה הוחלף דרך שחזור במייל", "קוד הכניסה של " + (target ? target.name : "מנהל חדש") + " הוחלף.");
      return jsonOut({ ok: true });
    }

    /* שחזור קוד — בגוף הבקשה ולא בכתובת (נתיב ה-GET נשאר ללקוחות ישנים) */
    if (action === "requestReset") return jsonOut(requestReset(body.user || ""));
    if (action === "verifyReset")  return jsonOut(verifyReset(body.code || ""));

    /* בדיקת גרסה בלבד: אימות מהיר מול טביעת הקודים שנשמרת בהגדרות
       הסקריפט, כדי שסקירה תקופתית לא תטען את כל מסד הנתונים.
       גם היא עוברת דרך השער — אחרת הייתה משמשת לניחוש קודים בלי הגבלה. */
    if (action === "rev") {
      var g0 = loginGate(body.codeHash);
      if (!g0.ok) return jsonOut({ ok: false, error: "too-many", retryAfter: g0.retryAfter });
      if (quickAuth(body.codeHash)) return jsonOut({ ok: true, rev: storedRev() });
    }

    // ---- מכאן והלאה חובה קוד כניסה תקף ----
    var auth = authenticate(body.codeHash);
    if (!auth.user) return jsonOut({ ok: false, error: auth.error, retryAfter: auth.retryAfter });
    var user = auth.user;

    if (action === "rev") {
      return jsonOut({ ok: true, rev: storedRev() });
    }
    /* שחזור טבלאות שנמחקו — מהגיבוי היומי שבתוך הקובץ. מנהל בלבד.
       משחזר רק טבלאות שריקות היום ומאוכלסות בגיבוי; לא נוגע בשאר. */
    if (action === "salvage") {
      if (user.role !== "admin") { secLog("forbidden", user.id, action); return jsonOut({ ok: false, error: "forbidden" }); }
      secLog("salvage", user.id, "");
      return jsonOut(salvageFromBackups());
    }
    if (action === "load") {
      // כל משתמש מקבל רק את מה ששויך לו, ולעולם לא את ה-hash של הקודים
      /* auth.data = המסד שהאימות כבר קרא באותה הרצה (קודם נקרא ופוענח פעמיים) */
      return jsonOut({ ok: true, data: scopeDataForUser(auth.data || loadData() || {}, user), user: publicUser(user) });
    }
    if (action === "save") {
      /* רשימת היתר: רק מנהל ועורך כותבים. תפקיד לא מוכר — לא. */
      if (user.role !== "admin" && user.role !== "editor") {
        secLog("forbidden", user.id, "save as " + user.role);
        return jsonOut({ ok: false, error: "forbidden" });
      }
      var sv = saveWithRevGuard(body.data, user);
      if (!sv.ok && sv.error !== "stale-rev" && sv.error !== "busy") secLog("save-rejected", user.id, sv.error + " " + (sv.detail || ""));
      return jsonOut(sv);
    }
    /* ---- קבצים מצורפים בדרייב — מנהל בלבד ---- */
    if (action === "fileUpload" || action === "fileTrash" || action === "filesInfo" ||
        action === "filesSetRoot" || action === "filesPrepare" || action === "fileCopy" ||
        action === "fileMove") {
      if (user.role !== "admin") { secLog("forbidden", user.id, action); return jsonOut({ ok: false, error: "forbidden" }); }
      if (action !== "filesInfo") secLog(action, user.id, String(body.name || body.fileId || body.folderId || ""));
      if (action === "fileUpload")   return jsonOut(fileUpload(body));
      if (action === "fileTrash")    return jsonOut(fileTrash(body));
      if (action === "filesInfo")    return jsonOut(filesInfo(body));
      if (action === "filesPrepare") return jsonOut(filesPrepare(body));
      if (action === "fileCopy")     return jsonOut(fileCopy(body));
      if (action === "fileMove")     return jsonOut(fileMove(body));
      return jsonOut(filesSetRoot(body));
    }
    return jsonOut({ ok: false, error: "unknown action" });
  } catch (err) {
    /* הטקסט של החריגה נשאר ביומן — לפונה חוזרת הודעה גנרית */
    secLog("server-error", "", String(err && err.message || err));
    return jsonOut({ ok: false, error: "server-error" });
  }
}

/* ============================================================
   קבצים מצורפים — נשמרים בדרייב של בעל הסקריפט
   מבנה: [תיקיית הקבצים] › [פרוייקט] › [חוזים / חשבוניות / תקבולים / תשלומים] › [שנה]
   מזהי התיקיות נשמרים בהגדרות הסקריפט: שינוי שם של פרוייקט משנה את
   שם התיקייה שלו ולא פותח תיקייה חדשה.
   הרשאה: בפעם הראשונה מריצים מהעורך את authorizeDrive ומאשרים.
   ============================================================ */
var FILES_ROOT_PROP  = "crm_files_root";
var FILES_OLD_ROOTS  = "crm_files_roots_old";   // תיקיות ראשיות קודמות — קבצים שם עדיין שלנו
var FILES_APT_PREFIX = "crm_files_apt_";
var FILES_ROOT_NAME  = "אלכסנדר-דירות — קבצים";
var FILE_KIND_FOLDERS = { contract: "חוזים", invoice: "חשבוניות", receipt: "תקבולים",
                          payment: "תשלומים", doc: "מסמכים" };
var FILE_MAX_BYTES = 25 * 1024 * 1024;
var FILES_MADE = 0;                  // כמה תיקיות נוצרו בהרצה הזאת

function authorizeDrive() {
  Logger.log("תיקיית הקבצים: " + filesRoot().getUrl());
}
function filesSafeName(v, max) {
  var t = String(v == null ? "" : v).replace(/[\\\/\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max).trim() : t;
}
function folderAlive(id) {
  if (!id) return null;
  try { var f = DriveApp.getFolderById(id); return f.isTrashed() ? null : f; } catch (e) { return null; }
}
function folderHasParent(folder, parentId) {
  var it = folder.getParents();
  while (it.hasNext()) if (it.next().getId() === parentId) return true;
  return false;
}
function filesChild(parent, name) {
  var it = parent.getFoldersByName(name);
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) return f; }
  FILES_MADE++;
  return parent.createFolder(name);
}
/* התיקייה הראשית — ליד קובץ הגיליון, או בשורש הדרייב */
function filesRoot() {
  var props = PropertiesService.getScriptProperties();
  var root = folderAlive(props.getProperty(FILES_ROOT_PROP));
  if (root) return root;
  var parent = null;
  try {
    var ps = DriveApp.getFileById(ss().getId()).getParents();
    if (ps.hasNext()) parent = ps.next();
  } catch (e) {}
  if (!parent) parent = DriveApp.getRootFolder();
  root = filesChild(parent, FILES_ROOT_NAME);
  props.setProperty(FILES_ROOT_PROP, root.getId());
  return root;
}
function filesProjectFolder(root, apt) {
  var props = PropertiesService.getScriptProperties();
  var key = FILES_APT_PREFIX + apt.id;
  var name = filesSafeName(apt.name, 90) || String(apt.id);
  var f = folderAlive(props.getProperty(key));
  if (f && folderHasParent(f, root.getId())) {
    if (f.getName() !== name) f.setName(name);          /* שם הפרוייקט השתנה */
    return f;
  }
  f = filesChild(root, name);
  props.setProperty(key, f.getId());
  return f;
}
function filesFindApt(aptId) {
  var d = loadData() || {};
  var list = d.apartments || [];
  for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === aptId) return list[i];
  return null;
}
/* התיקייה של פרוייקט / סוג / שנה — נוצרת לפי הצורך. בנעילה, כדי ששתי
   העלאות במקביל לא יפתחו את אותה תיקייה פעמיים. */
function filesFolderFor(apt, kind, year, sub) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var pf = filesProjectFolder(filesRoot(), apt);
    if (!kind) return pf;
    var kf = filesChild(pf, FILE_KIND_FOLDERS[kind]);
    if (sub) kf = filesChild(kf, sub);              /* מסמכים של דירה — תיקייה משלה */
    return year ? filesChild(kf, year) : kf;
  } finally {
    lock.releaseLock();
  }
}
/* תיקיית האסמכתאות של דפי הבנק — המקור של כל קובץ שצורף לשורת בנק.
   כשלשורה יש פרוייקט, עותק נשמר גם בתיקיית התקבולים שלו. */
var FILES_BANK_NAME = "דפי בנק";
function filesGeneralFolder(year) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var root = filesRoot(), gf = null;
    var it = root.getFoldersByName(FILES_BANK_NAME);
    while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) { gf = f; break; } }
    if (!gf) {
      /* השם הקודם — משנים לו שם במקום לפתוח תיקייה חדשה */
      var old = root.getFoldersByName("דפי בנק — ללא פרוייקט");
      while (old.hasNext()) { var o = old.next(); if (!o.isTrashed()) { o.setName(FILES_BANK_NAME); gf = o; break; } }
    }
    if (!gf) gf = filesChild(root, FILES_BANK_NAME);
    return year ? filesChild(gf, year) : gf;
  } finally {
    lock.releaseLock();
  }
}
function fileUpload(body) {
  var kind = String(body.kind || "");
  if (!FILE_KIND_FOLDERS[kind]) return { ok: false, error: "bad-kind" };
  if (!body.data) return { ok: false, error: "no-file" };
  /* בלי פרוייקט (שורת בנק שעוד לא הותאמה) — תיקייה כללית תחת השורש */
  var aptId = String(body.aptId || "");
  var apt = aptId ? filesFindApt(aptId) : null;
  if (aptId && !apt) return { ok: false, error: "project-not-found" };
  /* מסמכים כלליים לא מחולקים לשנים — אבל כן לתיקייה לפי דירה */
  var year = "", sub = "";
  if (kind === "doc") {
    sub = filesSafeName(body.sub, 60);
  } else {
    year = String(body.year || "");
    if (!/^(19|20)\d\d$/.test(year)) year = String(new Date().getFullYear());
  }
  var bytes = Utilities.base64Decode(String(body.data));
  if (!bytes.length) return { ok: false, error: "no-file" };
  if (bytes.length > FILE_MAX_BYTES) return { ok: false, error: "too-big" };
  var folder = apt ? filesFolderFor(apt, kind, year, sub) : filesGeneralFolder(year);
  var name = filesSafeName(body.name, 180) || "קובץ";
  var mime = String(body.mime || "") || "application/octet-stream";
  var file = folder.createFile(Utilities.newBlob(bytes, mime, name));
  if (body.desc) { try { file.setDescription(filesSafeName(body.desc, 500)); } catch (e) {} }
  return { ok: true, file: { id: file.getId(), name: file.getName(), url: file.getUrl(),
    mime: mime, size: bytes.length, kind: kind }, folderUrl: folder.getUrl() };
}
/* עותק של קובץ לתיקייה של פרוייקט — למשל אסמכתת בנק שהותאמה לפרוייקט.
   המקור נשאר במקומו (בתיקיית דפי הבנק), והעותק יושב אצל הפרוייקט —
   כך הוא נמצא בשני המקומות. מועתקים רק קבצים מתוך תיקיית הקבצים. */
function fileCopy(body) {
  var id = String(body.fileId || "");
  var kind = String(body.kind || "");
  if (!id) return { ok: false, error: "no-file" };
  if (!FILE_KIND_FOLDERS[kind]) return { ok: false, error: "bad-kind" };
  var apt = filesFindApt(String(body.aptId || ""));
  if (!apt) return { ok: false, error: "project-not-found" };
  var file;
  try { file = DriveApp.getFileById(id); } catch (e) { return { ok: false, error: "file-not-found" }; }
  var roots = [filesRoot().getId()];
  try { roots = roots.concat(JSON.parse(PropertiesService.getScriptProperties().getProperty(FILES_OLD_ROOTS) || "[]")); } catch (e) {}
  if (!fileUnderRoot(file, roots)) return { ok: false, error: "outside-root" };
  var year = String(body.year || "");
  if (!/^(19|20)\d\d$/.test(year)) year = String(new Date().getFullYear());
  var folder = filesFolderFor(apt, kind, kind === "doc" ? "" : year, kind === "doc" ? filesSafeName(body.sub, 60) : "");
  var copy = file.makeCopy(file.getName(), folder);
  var size = 0, mime = "";
  try { size = copy.getSize(); mime = copy.getMimeType(); } catch (e) {}
  return { ok: true, file: { id: copy.getId(), name: copy.getName(), url: copy.getUrl(),
    mime: mime, size: size }, folderUrl: folder.getUrl() };
}
/* העברת קובץ שכבר צורף לתיקייה של סוג אחר באותו פרוייקט — למשל חוזה
   שצורף להוצאה ונכנס ל"חשבוניות" במקום ל"חוזים". הקובץ זז בדרייב
   (אותו מזהה ואותו קישור), ואם נשלח שם — מקבל שם לפי הסוג החדש.
   רק קובץ מתוך תיקיית הקבצים, ולא אסמכתא שיושבת בתיקיית דפי הבנק. */
function fileMove(body) {
  var id = String(body.fileId || "");
  var kind = String(body.kind || "");
  if (!id) return { ok: false, error: "no-file" };
  if (!FILE_KIND_FOLDERS[kind]) return { ok: false, error: "bad-kind" };
  var apt = filesFindApt(String(body.aptId || ""));
  if (!apt) return { ok: false, error: "project-not-found" };
  var file;
  try { file = DriveApp.getFileById(id); } catch (e) { return { ok: false, error: "file-not-found" }; }
  if (file.isTrashed()) return { ok: false, error: "file-not-found" };
  var root = filesRoot(), roots = [root.getId()];
  try { roots = roots.concat(JSON.parse(PropertiesService.getScriptProperties().getProperty(FILES_OLD_ROOTS) || "[]")); } catch (e) {}
  if (!fileUnderRoot(file, roots)) return { ok: false, error: "outside-root" };
  var bank = [], bi = root.getFoldersByName(FILES_BANK_NAME);
  while (bi.hasNext()) bank.push(bi.next().getId());
  if (bank.length && fileUnderRoot(file, bank)) return { ok: false, error: "bank-file" };
  var year = String(body.year || "");
  if (!/^(19|20)\d\d$/.test(year)) year = String(new Date().getFullYear());
  var folder = filesFolderFor(apt, kind, kind === "doc" ? "" : year, kind === "doc" ? filesSafeName(body.sub, 60) : "");
  file.moveTo(folder);
  var name = filesSafeName(body.name, 180);
  if (name && name !== file.getName()) file.setName(name);
  return { ok: true, file: { id: file.getId(), name: file.getName(), url: file.getUrl(), kind: kind },
    folderUrl: folder.getUrl() };
}
/* הסרה — לפח של הדרייב (אפשר לשחזר משם), ורק קובץ שבתוך תיקיית הקבצים */
function fileTrash(body) {
  var id = String(body.fileId || "");
  if (!id) return { ok: false, error: "no-file" };
  var file;
  try { file = DriveApp.getFileById(id); }
  catch (e) { secLog("file-trash-missing", "", id + " " + String(e && e.message || e)); return { ok: true, missing: true }; }
  var roots = [filesRoot().getId()];
  try { roots = roots.concat(JSON.parse(PropertiesService.getScriptProperties().getProperty(FILES_OLD_ROOTS) || "[]")); } catch (e) {}
  if (!fileUnderRoot(file, roots)) return { ok: false, error: "outside-root" };
  file.setTrashed(true);
  return { ok: true };
}
function fileUnderRoot(file, rootIds) {
  var level = [file.getParents()];
  for (var depth = 0; depth < 6 && level.length; depth++) {
    var next = [];
    for (var i = 0; i < level.length; i++) {
      var it = level[i];
      while (it.hasNext()) {
        var f = it.next();
        if (rootIds.indexOf(f.getId()) >= 0) return true;
        next.push(f.getParents());
      }
    }
    level = next;
  }
  return false;
}
function filesInfo(body) {
  var root = filesRoot();
  var out = { ok: true, root: { id: root.getId(), name: root.getName(), url: root.getUrl() } };
  if (body.aptId) {
    var apt = filesFindApt(String(body.aptId));
    if (!apt) return { ok: false, error: "project-not-found" };
    var pf = filesFolderFor(apt, "", "", "");
    out.project = { id: pf.getId(), name: pf.getName(), url: pf.getUrl() };
  }
  return out;
}
/* פתיחת התיקיות מראש — לכל הפרוייקטים, כל הסוגים וכמה שנים אחורה, כדי
   שאפשר יהיה לגרור לשם קבצים ישנים ישר מהדרייב. הריצה מחולקת למנות:
   מחזירה "next" והדף קורא שוב, כדי לא להיתקע במגבלת הזמן של הסקריפט.
   הנעילה נלקחת לכל פרוייקט בנפרד — כדי שהשמירות הרגילות לא ייחסמו. */
function filesPrepare(body) {
  var years = Math.min(Math.max(Number(body.years) || 5, 1), 10);
  var from = Math.max(Number(body.from) || 0, 0);
  var d = loadData() || {};
  var apts = (d.apartments || []).filter(function (a) { return a && a.id && !a.deleted; });
  var nowY = new Date().getFullYear();
  var kinds = ["contract", "invoice", "receipt", "payment"];
  var t0 = new Date().getTime(), i = from;
  FILES_MADE = 0;
  for (; i < apts.length; i++) {
    if (i > from && new Date().getTime() - t0 > 60000) break;   /* המשך במנה הבאה */
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var pf = filesProjectFolder(filesRoot(), apts[i]);
      for (var k = 0; k < kinds.length; k++) {
        var kf = filesChild(pf, FILE_KIND_FOLDERS[kinds[k]]);
        for (var y = 0; y < years; y++) filesChild(kf, String(nowY - y));
      }
      /* מסמכים כלליים — תיקייה לפרוייקט, ובתוכה תיקייה לכל דירה להשכרה */
      var df = filesChild(pf, FILE_KIND_FOLDERS.doc);
      (d.rentals || []).forEach(function (r) {
        if (r && !r.deleted && r.apartmentId === apts[i].id) {
          var nm = filesSafeName(r.name, 60);
          if (nm) filesChild(df, nm);
        }
      });
    } finally {
      lock.releaseLock();
    }
  }
  return { ok: true, done: i >= apts.length, processed: i, projects: apts.length,
    created: FILES_MADE, years: years, root: filesRoot().getUrl() };
}
function filesSetRoot(body) {
  var raw = String(body.folder || "").trim();
  var m = raw.match(/folders\/([-\w]{10,})/) || raw.match(/[?&]id=([-\w]{10,})/) || raw.match(/^([-\w]{10,})$/);
  if (!m) return { ok: false, error: "bad-folder" };
  var f = folderAlive(m[1]);
  if (!f) return { ok: false, error: "folder-not-found" };
  var props = PropertiesService.getScriptProperties();
  var prev = props.getProperty(FILES_ROOT_PROP);
  if (prev && prev !== f.getId()) {
    var old = [];
    try { old = JSON.parse(props.getProperty(FILES_OLD_ROOTS) || "[]"); } catch (e) {}
    if (old.indexOf(prev) < 0) old.push(prev);
    props.setProperty(FILES_OLD_ROOTS, JSON.stringify(old.slice(-20)));
  }
  props.setProperty(FILES_ROOT_PROP, f.getId());
  return { ok: true, root: { id: f.getId(), name: f.getName(), url: f.getUrl() } };
}
/* ----- הקבצים אינם נשלחים למי שאינו מנהל, ונשמרים מהמאגר בשמירה שלו ----- */
function stripFiles(d) {
  ["apartments", "expenses", "payments", "income", "bankMoves"].forEach(function (T) {
    (d[T] || []).forEach(function (r) { if (r) delete r.files; });
  });
  (d.income || []).forEach(function (i) {
    ((i && i.payments) || []).forEach(function (g) { if (g) delete g.files; });
  });
}
function restoreFiles(stored, result) {
  function byId(arr) {
    var m = {};
    (arr || []).forEach(function (r) { if (r && r.id != null) m[r.id] = r; });
    return m;
  }
  ["apartments", "expenses", "payments", "income", "bankMoves"].forEach(function (T) {
    var S = byId(stored[T]);
    (result[T] || []).forEach(function (r) {
      if (!r) return;
      var sr = S[r.id];
      if (sr && sr.files && sr.files.length) r.files = sr.files; else delete r.files;
    });
  });
  var SI = byId(stored.income);
  (result.income || []).forEach(function (i) {
    if (!i) return;
    var gp = byId(SI[i.id] ? SI[i.id].payments : []);
    (i.payments || []).forEach(function (g) {
      if (!g) return;
      var sg = gp[g.id];
      if (sg && sg.files && sg.files.length) g.files = sg.files; else delete g.files;
    });
  });
}
/* ----- שדות שרק מנהל ועורך רואים, בתוך טבלאות שגם אחרים רואים -----
   קטגוריה ותת-קטגוריה של הכנסה (cat / subCat) — פתוחות למנהל ולעורך
   (החלטת דודי, 06/10/2026). לא נשלחות לצפייה/דמי-ניהול; ובשמירה של מי
   שאינו מנהל או עורך הן חוזרות מהמאגר. */
var ADMIN_ONLY_FIELDS = { income: ["cat", "subCat"] };
function stripAdminFields(d) {
  Object.keys(ADMIN_ONLY_FIELDS).forEach(function (T) {
    (d[T] || []).forEach(function (r) {
      if (r) ADMIN_ONLY_FIELDS[T].forEach(function (f) { delete r[f]; });
    });
  });
}
function restoreAdminFields(stored, result) {
  Object.keys(ADMIN_ONLY_FIELDS).forEach(function (T) {
    var S = Object.create(null);
    (stored[T] || []).forEach(function (r) { if (r && r.id != null) S[r.id] = r; });
    (result[T] || []).forEach(function (r) {
      if (!r) return;
      var sr = S[r.id];
      ADMIN_ONLY_FIELDS[T].forEach(function (f) {
        if (sr && sr[f] !== undefined) r[f] = sr[f]; else delete r[f];
      });
    });
  });
}
/* לשונית "קבצים" בגיליון — כל הקבצים עם קישור */
function filesReadableRows(d, aMap) {
  var KIND = { contract: "חוזה", invoice: "חשבונית", receipt: "תקבול",
               payment: "אישור תשלום", doc: "מסמך" };
  var rows = [];
  function add(aptId, kind, date, desc, files) {
    (files || []).forEach(function (f) {
      if (!f) return;
      rows.push([aMap[aptId] || "", KIND[f.kind || kind] || "", date || "", desc || "",
        f.name || "", f.url || "", String(f.at || "").slice(0, 10)]);
    });
  }
  (d.apartments || []).forEach(function (a) {
    if (!a.deleted) add(a.id, "doc", "", a.name || "", a.files);
  });
  var expById = {};
  (d.expenses || []).forEach(function (e) {
    expById[e.id] = e;
    if (!e.deleted) add(e.apartmentId, "invoice", e.date, e.description, e.files);
  });
  (d.payments || []).forEach(function (p) {
    var e = expById[p.expenseId];
    if (!p.deleted && e && !e.deleted) add(e.apartmentId, "payment", p.date, e.description, p.files);
  });
  (d.income || []).forEach(function (i) {
    if (i.deleted) return;
    add(i.apartmentId, "doc", i.date, i.description, i.files);
    (i.payments || []).forEach(function (g) {
      if (!g.deleted) add(i.apartmentId, "receipt", g.date, i.description, g.files);
    });
  });
  (d.bankMoves || []).forEach(function (m) {
    if (!m || m.deleted) return;
    add(m.apartmentId, "receipt", m.date, "בנק · " + (m.name || m.description || ""), m.files);
  });
  (d.rentals || []).forEach(function (r) {
    if (r.deleted) return;
    add(r.apartmentId, "doc", "", r.name || "", r.docs);
    [r].concat(r.history || []).forEach(function (c) {
      add(r.apartmentId, "contract", c.startDate, (r.name || "") + (c.tenant ? " · " + c.tenant : ""), c.files);
    });
  });
  rows.sort(function (a, b) { return a[2] < b[2] ? 1 : a[2] > b[2] ? -1 : 0; });
  return rows;
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

/* ==================== אימות ====================
   הדפדפן שולח SHA-256 של קוד הכניסה (codeHash). בשרת לא שומרים אותו
   כמו שהוא: הערך השמור הוא נגזרת שלו עם "פלפל" (סוד בהגדרות הסקריפט)
   ומאות סבבי HMAC. מי שמגיע לגיליון לא מקבל ערך שאפשר להיכנס איתו,
   ומי שמגיע לערך השמור לא יכול לגזור ממנו את מה שהדפדפן שולח.
   ערכים ישנים (hash גולמי) מזוהים לפי הצורה ומומרים בשמירה הבאה. */
var PEPPER_PROP = "crm_pepper";
var KDF_ITER    = 400;
function pepper(allowCreate) {
  var props = PropertiesService.getScriptProperties();
  var v = props.getProperty(PEPPER_PROP);
  if (!v) {
    if (!allowCreate) {
      /* הפלפל נעלם (הגדרות הסקריפט נמחקו / הקוד הודבק בפרוייקט אחר) אבל
         במאגר כבר יש קודים שנגזרו ממנו: פלפל חדש היה נועל את כולם בחוץ
         בלי שום סימן. עוצרים, מתריעים, ומשאירים את השחזור במייל כדרך חזרה. */
      var d = loadData(), has = false;
      ((d && d.users) || []).forEach(function (u) { if (u && String(u.code || "").indexOf("v2:") === 0) has = true; });
      if (has) {
        secLog("pepper-missing", "", "");
        alertOwner("מפתח האבטחה של קודי הכניסה חסר", "הגדרת הסקריפט " + PEPPER_PROP + " נעלמה, ולכן אי אפשר לאמת קודי כניסה. " +
          "כדי לחזור לפעילות: במסך הכניסה לחץ \"שכחתי את הקוד\", קבע קוד חדש דרך המייל, ואז קבע קודים חדשים לשאר המשתמשים.");
        throw new Error("pepper-missing");
      }
    }
    v = Utilities.getUuid() + "." + Utilities.getUuid() + "." + new Date().getTime();
    props.setProperty(PEPPER_PROP, v);
  }
  return v;
}
function bytesToHex(bytes) {
  var out = [];
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    out.push((b < 16 ? "0" : "") + b.toString(16));
  }
  return out.join("");
}
function isLegacyCode(c) { return /^[0-9a-f]{64}$/.test(String(c || "")); }
/* 400 סבבי HMAC רצים בכל פנייה מאומתת — כניסה, טעינה, שמירה, ובדיקת הגרסה
   שכל לשונית פתוחה שולחת כל 45 שניות. הנגזרת היא פונקציה קבועה של הקוד
   ושל הפלפל, ולכן:
   - בתוך אותה הרצה היא מחושבת פעם אחת (KDF_MEMO);
   - בין הרצות היא נשמרת במטמון הסקריפט — רק אחרי שהקוד התאים למשתמש
     (kdfRemember), ובמפתח שנגזר מהפלפל: בלי הפלפל אי אפשר לקשר מפתח לקוד,
     והערך עצמו זהה לנגזרת שכבר שמורה בגיליון. ניחוש שגוי לא נשמר ולא מתקצר.
   תקלה במטמון — פשוט מחשבים כרגיל. */
var KDF_CACHE_SEC = 3600;
var KDF_MEMO = null;
function kdfCacheKey(key, codeHash) {
  return "kdf2:" + bytesToHex(Utilities.computeHmacSha256Signature("kdf-cache:" + codeHash, key)).slice(0, 40);
}
function deriveCode(codeHash) {
  var key = pepper(), h = String(codeHash || "");
  if (KDF_MEMO && KDF_MEMO.k === key && KDF_MEMO.h === h) return KDF_MEMO.v;
  var ck = kdfCacheKey(key, h), v = "";
  try { v = String(CacheService.getScriptCache().get(ck) || ""); } catch (err) { v = ""; }
  var hit = /^v2:[0-9a-f]{64}$/.test(v);
  if (!hit) {
    var cur = h;
    for (var i = 0; i < KDF_ITER; i++) {
      cur = bytesToHex(Utilities.computeHmacSha256Signature(cur + ":" + i, key));
    }
    v = "v2:" + cur;
  }
  KDF_MEMO = { k: key, h: h, v: v, ck: ck, cached: hit };
  return v;
}
/* נקרא רק אחרי שהקוד התאים למשתמש פעיל — רק אז הנגזרת נכנסת למטמון */
function kdfRemember(codeHash) {
  var m = KDF_MEMO;
  if (!m || m.cached || m.h !== String(codeHash || "")) return;
  try { CacheService.getScriptCache().put(m.ck, m.v, KDF_CACHE_SEC); m.cached = true; } catch (err) {}
}
/* השוואה בזמן קבוע — לא מסגירה כמה תווים תאמו */
function constEq(a, b) {
  a = String(a || ""); b = String(b || "");
  var diff = a.length === b.length ? 0 : 1, n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
/* "plain:<קוד>" נשמר בעבר כשהדפדפן לא יכול היה להצפין. היום הדפדפן
   שולח תמיד SHA-256, ולכן מחשבים את ה-hash של הקוד הגלוי ומשווים אליו. */
function plainToHash(c) {
  return bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(c).slice(6)));
}
function isPlainCode(c) { return String(c || "").indexOf("plain:") === 0; }
function codeMatches(stored, codeHash, derived) {
  if (isLegacyCode(stored)) return constEq(stored, codeHash);
  if (isPlainCode(stored)) return constEq(plainToHash(stored), codeHash);
  return constEq(stored, derived);
}
/* ערך שמגיע מהדפדפן (hash גולמי) -> הצורה שנשמרת */
function storableCode(c) {
  if (isLegacyCode(c)) return deriveCode(c);
  if (isPlainCode(c)) return deriveCode(plainToHash(c));
  return String(c || "");
}
/* קודים ישנים בטבלת המשתמשים מומרים בכל שמירה */
function migrateUserCodes(data) {
  var n = 0;
  ((data && data.users) || []).forEach(function (u) {
    if (u && (isLegacyCode(u.code) || isPlainCode(u.code))) { u.code = storableCode(u.code); n++; }
  });
  return n;
}

/* ---------- ויסות ניסיונות ----------
   ב-Apps Script אין כתובת IP, ולכן המונה הוא לפי הקוד שנוסה (12 התווים
   הראשונים של ה-hash): ניחוש חוזר של אותו קוד ננעל, ואילו כניסה
   מוצלחת מנקה רק את המפתח שלה — לא את כולם. בנוסף תקרה כללית,
   שנועדה לעצור סריקה שיטתית, ומייצרת התראה במייל לבעלים. */
var LOGIN_PROP       = "crm_login_fails";
var LOGIN_MAX        = 12;      // כישלונות לאותו מפתח בחלון (ניסיון אחד מהמסך = 2, כי כניסה וטעינה יוצאות יחד)
var LOGIN_WINDOW_M   = 5;
var LOGIN_COOL_M     = 2;
var LOGIN_GLOBAL_MAX = 40;      // כישלונות מכל המקורות בחלון
var LOGIN_GLOBAL_COOL_M = 5;
function loginKey(codeHash) { return String(codeHash || "").slice(0, 12) || "-"; }
function loginState() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(LOGIN_PROP);
    var st = raw ? JSON.parse(raw) : {};
    if (!st || typeof st !== "object") st = {};
    if (!st.keys || typeof st.keys !== "object") st.keys = {};
    if (!st.g) st.g = { n: 0, first: 0, until: 0 };
    return st;
  } catch (err) {
    secLog("throttle-state-error", "", "read: " + String(err && err.message || err));
    return { keys: {}, g: { n: 0, first: 0, until: 0 } };
  }
}
function saveLoginState(st) {
  try { PropertiesService.getScriptProperties().setProperty(LOGIN_PROP, JSON.stringify(st)); }
  catch (err) { secLog("throttle-state-error", "", "write: " + String(err && err.message || err)); }
}
function withLock(fn) {
  var lock = LockService.getScriptLock(), got = false;
  for (var i = 0; i < 2 && !got; i++) { try { lock.waitLock(5000); got = true; } catch (err) {} }
  if (!got) return undefined;                 /* עדיף לפספס ספירה אחת מאשר לדרוס מונה */
  try { return fn(); } finally { lock.releaseLock(); }
}
function loginGate(codeHash) {
  var st = loginState(), now = new Date().getTime();
  var e = st.keys[loginKey(codeHash)];
  if (e && e.until && now < e.until) return { ok: false, retryAfter: Math.ceil((e.until - now) / 1000) };
  if (st.g.until && now < st.g.until && !isGoodKey(codeHash)) return { ok: false, retryAfter: Math.ceil((st.g.until - now) / 1000) };
  return { ok: true };
}
/* קודים שנכנסו בהצלחה ב-30 הימים האחרונים. בזמן חסימה כללית (סריקה של
   קודים זרים) הם ממשיכים לעבור; הוויסות לפי קוד ממשיך לחול גם עליהם. */
var GOOD_PROP = "crm_good_keys", GOOD_DAYS = 30;
function goodKeys() {
  try { var m = JSON.parse(PropertiesService.getScriptProperties().getProperty(GOOD_PROP) || "{}"); return (m && typeof m === "object") ? m : {}; }
  catch (err) { return {}; }
}
function isGoodKey(codeHash) {
  var t = goodKeys()[loginKey(codeHash)];
  return !!t && new Date().getTime() - t < GOOD_DAYS * 86400000;
}
function noteGoodKey(codeHash) {
  try {
    var m = goodKeys(), now = new Date().getTime(), k = loginKey(codeHash);
    if (m[k] && now - m[k] < 86400000) return;            /* מתעדכן לכל היותר פעם ביום */
    m[k] = now;
    var keys = Object.keys(m).filter(function (x) { return now - m[x] < GOOD_DAYS * 86400000; })
      .sort(function (a, b) { return m[b] - m[a]; }).slice(0, 100);
    var out = {}; keys.forEach(function (x) { out[x] = m[x]; });
    PropertiesService.getScriptProperties().setProperty(GOOD_PROP, JSON.stringify(out));
  } catch (err) {}
}
function noteLoginFail(codeHash) {
  withLock(function () {
    var st = loginState(), now = new Date().getTime(), win = LOGIN_WINDOW_M * 60000;
    Object.keys(st.keys).forEach(function (k) {
      var x = st.keys[k];
      if ((!x.until || now > x.until) && (!x.first || now - x.first > win)) delete st.keys[k];
    });
    var k = loginKey(codeHash), e = st.keys[k] || { n: 0, first: 0, until: 0 };
    if (!e.first || now - e.first > win) { e.n = 0; e.first = now; }
    e.n++;
    if (e.n >= LOGIN_MAX) { e.until = now + LOGIN_COOL_M * 60000; e.n = 0; e.first = now; }
    st.keys[k] = e;
    if (!st.g.first || now - st.g.first > win) { st.g.n = 0; st.g.first = now; }
    st.g.n++;
    if (st.g.n >= LOGIN_GLOBAL_MAX) {
      st.g.until = now + LOGIN_GLOBAL_COOL_M * 60000; st.g.n = 0; st.g.first = now;
      alertOwner("חסימת כניסה זמנית", "נרשמו " + LOGIN_GLOBAL_MAX + " ניסיונות כניסה כושלים בתוך " +
        LOGIN_WINDOW_M + " דקות. הכניסה נחסמה ל-" + LOGIN_GLOBAL_COOL_M + " דקות.");
    }
    saveLoginState(st);
  });
}
function clearLoginFails(codeHash) {
  /* רוב הכניסות אין להן מה לנקות — לא תופסים את נעילת השמירה סתם */
  if (!loginState().keys[loginKey(codeHash)]) return;
  withLock(function () { var st = loginState(); delete st.keys[loginKey(codeHash)]; saveLoginState(st); });
}
/* שער אחד לכל פעולה מאומתת: ויסות, זיהוי, ורישום כישלון */
function authenticate(codeHash) {
  if (!codeHash) return { user: null, error: "unauthorized" };
  var gate = loginGate(codeHash);
  if (!gate.ok) { secLog("too-many", loginKey(codeHash)); return { user: null, error: "too-many", retryAfter: gate.retryAfter }; }
  var d0 = loadData();
  if (!d0 && everInit()) {
    secLog("storage-error", "", "authenticate");
    alertOwner("מסד הנתונים אינו קריא", "המערכת אותחלה אבל לשונית הנתונים ועותקי הגיבוי אינם קריאים. כניסה ושמירה חסומות עד לשחזור.");
    return { user: null, error: "storage-error" };
  }
  var u = findUserIn(d0, codeHash);
  if (!u) {
    noteLoginFail(codeHash);
    secLog("auth-fail", loginKey(codeHash));
    Utilities.sleep(800);
    return { user: null, error: "unauthorized" };
  }
  /* המסד שכבר נקרא כאן חוזר לקורא — "load" לא קורא ומפענח אותו פעם שנייה */
  return { user: u, error: "", data: d0 };
}

/* ---------- יומן אבטחה והתראות ----------
   לשונית מוסתרת בגיליון: זמן, אירוע, מי, פרטים. אירועים שקטים
   (כישלון כניסה, חסימה, שמירה שנדחתה, שינוי משתמשים) הופכים לנראים. */
var SECLOG_SHEET = "_seclog";
var SECLOG_MAX   = 3000;
function secLog(event, who, detail) {
  try {
    var sh = ss().getSheetByName(SECLOG_SHEET);
    if (!sh) { sh = ss().insertSheet(SECLOG_SHEET); sh.appendRow(["זמן", "אירוע", "מי", "פרטים"]); try { sh.hideSheet(); } catch (e) {} }
    sh.appendRow([new Date().toISOString(), sheetSafe(String(event || "")), sheetSafe(String(who || "")),
      sheetSafe(String(detail || "").slice(0, 300))]);
    var n = sh.getLastRow();
    if (n > SECLOG_MAX) sh.deleteRows(2, n - SECLOG_MAX);
  } catch (err) {}
}
var ALERT_PROP = "crm_alert_last";
function alertOwner(subject, text) {
  try {
    var props = PropertiesService.getScriptProperties();
    var last = JSON.parse(props.getProperty(ALERT_PROP) || "{}"), now = new Date().getTime();
    /* אותו נושא עם אותו תוכן — לא יותר ממייל אחד ל-10 דקות; תוכן שונה תמיד נשלח */
    var key = subject + "|" + bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text || ""))).slice(0, 16);
    if (last[key] && now - last[key] < 10 * 60000) return;
    Object.keys(last).forEach(function (k) { if (now - last[k] > 60 * 60000) delete last[k]; });
    last[key] = now;
    props.setProperty(ALERT_PROP, JSON.stringify(last));
    MailApp.sendEmail(OWNER_EMAIL, "אלכסנדר-דירות · " + subject, text + "\n\n(הודעה אוטומטית ממערכת האבטחה של האפליקציה)");
  } catch (err) {}
}

function hasAnyUser() {
  /* נענה מהגדרת סקריפט שנכתבת בכל שמירה — בלי לקרוא את כל המסד */
  try {
    var v = PropertiesService.getScriptProperties().getProperty("crm_has_users");
    if (v === "1") return true;
    if (v === "0") return false;
  } catch (err) {}
  var d = loadData(), any = false;
  if (d && d.users) for (var i = 0; i < d.users.length; i++) {
    if (!d.users[i].deleted && d.users[i].active) { any = true; break; }
  }
  try { PropertiesService.getScriptProperties().setProperty("crm_has_users", any ? "1" : "0"); } catch (err2) {}
  return any;
}

function findUser(codeHash) { return findUserIn(loadData(), codeHash); }
function findUserIn(d, codeHash) {
  if (!codeHash) return null;
  if (!d || !d.users) return null;
  var derived = deriveCode(codeHash);
  for (var i = 0; i < d.users.length; i++) {
    var u = d.users[i];
    if (!u.deleted && u.active && u.code && codeMatches(u.code, codeHash, derived)) { kdfRemember(codeHash); return u; }
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
var RESET_REQ_PER_NAME = 3;         // בקשות שחזור לאותו שם בשעה
var RESET_REQ_GLOBAL   = 20;        // בקשות שחזור מכל השמות בשעה
/* בלי ויסות אפשר להציף את תיבת המייל של הבעלים, וגם לדרוס שוב ושוב
   בקשת שחזור לגיטימית שנמצאת באמצע. */
/* nameKey ריק = בדיקת התקרה הכללית בלבד; אחרת — המכסה של השם בלבד */
function resetReqGate(nameKey) {
  try {
    var props = PropertiesService.getScriptProperties();
    var s = null;
    try { s = JSON.parse(props.getProperty(RESET_REQ_PROP) || "null"); } catch (e) { s = null; }   /* ערך פגום מתוקן, לא פותח את השער */
    if (!s || typeof s !== "object" || !s.g || typeof s.k !== "object" || !s.k) s = { g: { n: 0, first: 0 }, k: {} };
    var now = new Date().getTime();
    if (!s.g.first || now - s.g.first > 3600000) { s.g = { n: 0, first: now }; }
    Object.keys(s.k).forEach(function (k) { if (!s.k[k] || now - s.k[k].first > 3600000) delete s.k[k]; });
    if (nameKey) {
      var e = s.k[nameKey] || { n: 0, first: now };
      e.n = (Number(e.n) || 0) + 1; s.k[nameKey] = e;
      props.setProperty(RESET_REQ_PROP, JSON.stringify(s));
      return e.n <= RESET_REQ_PER_NAME;
    }
    s.g.n = (Number(s.g.n) || 0) + 1;
    props.setProperty(RESET_REQ_PROP, JSON.stringify(s));
    if (s.g.n > RESET_REQ_GLOBAL) {
      alertOwner("הרבה בקשות שחזור קוד", "התקבלו יותר מ-" + RESET_REQ_GLOBAL + " בקשות שחזור בשעה האחרונה. בקשות נוספות נחסמות עד סוף השעה.");
      return false;
    }
    return true;
  } catch (err) {
    secLog("throttle-state-error", "", "reset: " + String(err && err.message || err));
    return false;                         /* אחסון תקול — לא שולחים מיילי שחזור בלי מונה */
  }
}
function requestReset(userName) {
  if (!resetReqGate("")) return { ok: false, error: "too-many" };
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
    /* תשובה אחידה בכל מקרה — שם משתמש לא נכון, או בלי מייל — כדי שאי
       אפשר יהיה לגלות אילו שמות קיימים במערכת */
    var generic = { ok: true, sentTo: "***" };
    /* מכסה לכל שם — לפי המשתמש שנמצא (שם ריק = המנהל), כדי שאין שתי "דלתות" לאותו חשבון */
    if (!resetReqGate("n:" + (user ? normName(user.name) : (want || "-")))) return { ok: false, error: "too-many" };
    if (!user) {
      /* אין אף משתמש פעיל במסד (אחרי מחיקה/שחזור)? דלת מילוט אחת:
         קוד שחזור למייל הבעלים הקבוע בקוד. setCode ייצור מנהל חדש. */
      var anyActive = false;
      if (d && d.users) for (var q = 0; q < d.users.length; q++)
        if (!d.users[q].deleted && d.users[q].active) { anyActive = true; break; }
      if (!anyActive) user = { id: "", name: "בעל המערכת", role: "admin", email: OWNER_EMAIL };
      else { secLog("reset-unknown-user", "", want); return generic; }
    }
    var email = String(user.email || "").trim();
    if (!email && user.role === "admin") email = OWNER_EMAIL;
    if (!email) {
      secLog("reset-no-email", user.id, "");
      alertOwner("בקשת שחזור קוד למשתמש ללא מייל", "המשתמש \"" + user.name + "\" ביקש קוד שחזור, אבל לא מוגדר לו מייל. " +
        "אפשר לקבוע לו קוד חדש בהגדרות ← משתמשים.");
      return generic;
    }
    /* לכל משתמש חלון שחזור משלו. בקשה של מישהו אחר לא מבטלת קוד שבדרך.
       בקשה חוזרת של אותו משתמש בזמן שהקוד בתוקף — אותו קוד נשלח שוב. */
    var uid0 = String(user.id || ""), pend = null;
    readResetRows().forEach(function (r) { if (String(r[3] || "") === uid0 && String(r[0] || "")) pend = r; });
    /* קוד אקראי-קריפטוגרפי, לא Math.random */
    var rnd = bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + ":" + new Date().getTime() + ":" + Utilities.getUuid()));
    var code = pend ? String(pend[0]) : String(100000 + (parseInt(rnd.slice(0, 12), 16) % 900000));
    var exp  = new Date().getTime() + RESET_MINUTES * 60 * 1000;     /* גם קוד שנשלח שוב — תקף 15 דקות מעכשיו */
    MailApp.sendEmail(email,
      "קוד שחזור — מערכת ניהול דירות",
      "שלום " + user.name + ",\n\n" +
      "קוד השחזור שלך הוא: " + code + "\n\n" +
      "הקוד תקף ל-" + RESET_MINUTES + " דקות וניתן לשימוש חד-פעמי.\n" +
      "אם לא ביקשת שחזור — התעלם מהודעה זו ושקול להחליף את קוד הכניסה.");
    /* נכתב רק אחרי שהמייל יצא — כישלון בשליחה לא מוחק קוד קודם שבדרך */
    /* חלון אחד למשתמש: בקשה חדשה מחליפה גם אסימון שלא נוצל (המבקש הוכיח
       שוב גישה למייל) */
    lockedReset(function () {
      var rows = readResetRows().filter(function (r) { return String(r[3] || "") !== uid0; });
      rows.push([code, exp, "", uid0, 0, 0]);
      writeResetRows(rows);
    });
    secLog("reset-sent", user.id, email.replace(/^(.{2}).*(@.*)$/, "$1***$2"));
    return generic;
  } catch (err) {
    secLog("server-error", "", "requestReset: " + String(err && err.message || err));
    return { ok: false, error: "server-error" };
  }
}

var RESET_MAX_TRIES = 8;           /* ניחושים שגויים מכל המקורות ב-15 דקות, ואז כל הקודים נשרפים */
var RESET_BAD_PROP  = "crm_reset_bad";
var RESET_COLS      = 6;           /* קוד, תוקף, אסימון, משתמש, (שמור), "קוד תפוס" */
function readResetRows(includeExpired) {
  var sh = ss().getSheetByName(RESET_SHEET);
  if (!sh || sh.getLastRow() === 0) return [];
  var now = new Date().getTime();
  return sh.getRange(1, 1, sh.getLastRow(), RESET_COLS).getValues().filter(function (r) {
    return (String(r[0] || "") || String(r[2] || "")) && (includeExpired || Number(r[1] || 0) > now);
  });
}
/* מוחק חלונות שחזור של משתמשים שהושבתו/נמחקו או שהקוד/התפקיד/המייל שלהם שונה */
function clearResetFor(ids) {
  if (!ids || !ids.length) return;
  var drop = Object.create(null); ids.forEach(function (x) { drop[String(x)] = 1; });
  lockedReset(function () {
    var rows = readResetRows();
    var keep = rows.filter(function (r) { return !drop[String(r[3] || "")]; });
    if (keep.length !== rows.length) writeResetRows(keep);
  });
}
function writeResetRows(rows) {
  var sh = ss().getSheetByName(RESET_SHEET) || ss().insertSheet(RESET_SHEET);
  sh.clear();
  if (rows.length) sh.getRange(1, 1, rows.length, RESET_COLS).setValues(rows);
  try { sh.hideSheet(); } catch (err) {}
}
function lockedReset(fn) {
  var lock = LockService.getScriptLock(), got = false;
  try { lock.waitLock(10000); got = true; } catch (e) {}
  try { return fn(); } finally { if (got) lock.releaseLock(); }
}
/* מאמת את הקוד מהמייל ומחזיר אסימון קצר-מועד שמתיר קביעת קוד חדש.
   ניחושים שגויים נספרים בכלל המערכת; אחרי RESET_MAX_TRIES בחלון כל
   הקודים שבדרך נשרפים — כך שקוד בן 6 ספרות אינו ניתן לניחוש. */
function verifyReset(code) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { ok: false, error: "busy" }; }
  try {
    var props = PropertiesService.getScriptProperties(), now = new Date().getTime(), b = null;
    try { b = JSON.parse(props.getProperty(RESET_BAD_PROP) || "null"); } catch (e) { b = null; }
    if (!b || typeof b !== "object" || !b.first || now - b.first > RESET_MINUTES * 60000) b = { n: 0, first: now };
    /* מכסת הניחושים לא מתאפסת עם שריפת הקודים: עד סוף החלון לא בודקים כלום */
    if (b.n >= RESET_MAX_TRIES) return { ok: false, error: "too-many" };
    var rows = readResetRows(), want = String(code || "").trim(), idx = -1;
    /* חלונות של משתמשים שהושבתו או נמחקו — לא מתקבלים */
    var d0 = loadData(), live = Object.create(null);
    ((d0 && d0.users) || []).forEach(function (u) { if (u && !u.deleted && u.active) live[String(u.id)] = 1; });
    var anyLive = Object.keys(live).length > 0;
    rows = rows.filter(function (r) { var id = String(r[3] || ""); return id ? !!live[id] : !anyLive; });
    for (var i = 0; i < rows.length; i++) if (want && String(rows[i][0] || "") === want) { idx = i; break; }
    if (idx < 0) {
      /* קוד שפג — "פג תוקף", בלי להיחשב ניחוש */
      var expired = readResetRows(true).some(function (r) { return want && String(r[0] || "") === want && Number(r[1] || 0) <= now; });
      if (expired) return { ok: false, error: "expired" };
      b.n = (Number(b.n) || 0) + 1;
      props.setProperty(RESET_BAD_PROP, JSON.stringify(b));
      if (b.n >= RESET_MAX_TRIES) {
        writeResetRows(rows.filter(function (r) { return !String(r[0] || ""); }));
        secLog("reset-burned", "", "too many wrong codes");
        alertOwner("ניחוש קודי שחזור", "נרשמו " + RESET_MAX_TRIES + " קודי שחזור שגויים. כל קודי השחזור שבדרך בוטלו, ושחזור חסום ל-" + RESET_MINUTES + " דקות.");
        return { ok: false, error: "too-many" };
      }
      return { ok: false, error: "bad-code" };
    }
    var token = Utilities.getUuid();
    // שומרים את מזהה המשתמש — כדי שהקוד החדש ייקבע לו ולא למנהל
    rows[idx] = ["", new Date().getTime() + 10 * 60 * 1000, token, String(rows[idx][3] || ""), 0, 0];
    writeResetRows(rows);
    return { ok: true, resetToken: token };
  } catch (err) {
    secLog("server-error", "", "verifyReset: " + String(err && err.message || err));
    return { ok: false, error: "server-error" };
  } finally { lock.releaseLock(); }
}

/* בודק את האסימון בלי לשרוף אותו — כך כשל "קוד תפוס" לא מאלץ
   להתחיל את כל השחזור מחדש. הניקוי נעשה רק אחרי הצלחה. */
function peekResetToken(token) {
  if (!token) return { ok: false, error: "no-token" };
  var rows = readResetRows();
  if (!rows.length) return { ok: false, error: "no-request" };
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][2] || "") === String(token)) return { ok: true, userId: String(rows[i][3] || "") };
  }
  return { ok: false, error: "bad-token" };
}
/* "קוד תפוס" נספר לכל אסימון; אחרי 3 — האסימון נשרף */
function noteCodeTaken(token) {
  return lockedReset(function () {
    var rows = readResetRows(), burned = false;
    rows = rows.filter(function (r) {
      if (String(r[2] || "") !== String(token)) return true;
      r[5] = (Number(r[5]) || 0) + 1;
      if (r[5] >= 3) { burned = true; return false; }
      return true;
    });
    writeResetRows(rows);
    return burned;
  });
}
function clearReset(token) {
  lockedReset(function () {
    writeResetRows(readResetRows().filter(function (r) { return String(r[2] || "") !== String(token); }));
  });
}

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
function restoreMissingTables(stored, incoming) {
  var restored = [];
  if (!stored || !incoming) return restored;
  for (var k in stored) {
    if (!stored.hasOwnProperty(k)) continue;
    if (k === "users" || k === "settings" || k === "meta") continue;
    if (!Array.isArray(stored[k]) || !stored[k].length) continue;
    var inc = incoming[k];
    if (!Array.isArray(inc) || inc.length === 0) {
      incoming[k] = stored[k];
      restored.push(k + " (" + stored[k].length + ")");
    }
  }
  return restored;
}
/* ============================================================
   מחיקה המונית בשמירה אחת
   ------------------------------------------------------------
   מחיקה במערכת היא רכה: השורה נשארת ומסומנת deleted:true. לכן
   restoreMissingTables (שבודק "טבלה ריקה") ו-shrinkGuard (שסופר
   שורות) עיוורים למצב שבו טבלה שלמה מסומנת כמחוקה — מספר השורות
   זהה, הטבלה אינה ריקה, והנתונים נעלמים. כך נמחקו כל הגיליונות.

   מחיקה בודדת תמיד עוברת, גם של הפריט האחרון. מה שנחסם: קפיצה
   מכמה פריטים חיים לאפס בשמירה אחת, או מחיקת רוב טבלה גדולה.
   השורות משוחזרות מהשמור ומדווחות ללקוח.
   ============================================================ */
function liveCount(arr) {
  var n = 0;
  for (var i = 0; i < (arr || []).length; i++) if (arr[i] && !arr[i].deleted) n++;
  return n;
}
function restoreMassDeleted(stored, incoming) {
  var restored = [];
  if (!stored || !incoming) return restored;
  for (var k in stored) {
    if (!stored.hasOwnProperty(k)) continue;
    if (k === "settings" || k === "meta") continue;
    if (!Array.isArray(stored[k]) || !Array.isArray(incoming[k])) continue;
    var aliveBefore = Object.create(null);
    stored[k].forEach(function (r) { if (r && !r.deleted && r.id != null) aliveBefore[r.id] = 1; });
    var before = liveCount(stored[k]), after = 0;
    incoming[k].forEach(function (r) { if (r && !r.deleted && aliveBefore[r.id]) after++; });
    if (after >= before) continue;
    var mass = (before >= 2 && after === 0) || (before >= 8 && after < before * 0.3);
    if (!mass) continue;
    /* מחזירים לחיים רק שורות שהיו חיות בשמור ונמחקו בשמירה הזו */
    var alive = {};
    for (var i = 0; i < stored[k].length; i++) {
      var r = stored[k][i];
      if (r && !r.deleted && r.id != null) alive[r.id] = 1;
    }
    var n = 0;
    for (var j = 0; j < incoming[k].length; j++) {
      var x = incoming[k][j];
      if (x && x.deleted && alive[x.id]) {
        x.deleted = false;
        delete x.deletedAt; delete x.deletedByUser;
        n++;
      }
    }
    if (n) restored.push(k + " (" + n + " שורות)");
  }
  return restored;
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

/* טבלה שראויה לשחזור מגיבוי: ריקה או שכולה מסומנת מחוקה היום,
   ומאוכלסת בגיבוי. הבדיקה הישנה הסתכלה רק על "ריקה". */
function tableNeedsSalvage(cur, bak) {
  if (!Array.isArray(bak) || liveCount(bak) === 0) return false;
  if (!Array.isArray(cur)) return true;
  return liveCount(cur) === 0;
}
function salvageFromBackups() {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { ok: false, error: "busy" }; }
  try {
    var cur = loadData();
    if (!cur) return { ok: false, error: "no-data" };
    var sheets = ss().getSheets(), names = [];
    for (var i = 0; i < sheets.length; i++) {
      var n = sheets[i].getName();
      if (n.indexOf(BAK_PREFIX) === 0) names.push(n);
    }
    names.sort().reverse();                     /* החדש ביותר קודם */
    if (!names.length) return { ok: false, error: "no-backups" };
    var restored = [];
    for (var j = 0; j < names.length; j++) {
      var bak = readSheetJson(names[j]);
      if (!bak) continue;
      for (var k in bak) {
        if (!bak.hasOwnProperty(k)) continue;
        if (k === "users" || k === "settings" || k === "meta") continue;
        /* גם טבלה שכולה מסומנת מחוקה ראויה לשחזור — לא רק ריקה */
        if (!tableNeedsSalvage(cur[k], bak[k])) continue;
        cur[k] = bak[k];
        restored.push(k + " (" + liveCount(bak[k]) + " מ-" + names[j].slice(BAK_PREFIX.length) + ")");
      }
    }
    if (!restored.length) return { ok: true, restored: [] };
    cur.meta = cur.meta || { version: 1 };
    cur.meta.rev = (Number(cur.meta.rev) || 0) + 1;
    saveData(cur);
    return { ok: true, restored: restored, rev: cur.meta.rev };
  } finally {
    lock.releaseLock();
  }
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
    /* מזהים: כל תו שיכול לשבור HTML או JavaScript בדפדפן של משתמש אחר
       נדחה כאן, פעם אחת, לכל הטבלאות — במקום להסתמך על 200 מקומות בלקוח */
    /* שורה שאינה אובייקט (null וכד') לא נכנסת למאגר — היא שוברת את הסינון לכולם */
    Object.keys(data || {}).forEach(function (T) {
      if (Array.isArray(data[T])) data[T] = data[T].filter(function (r) { return r && typeof r === "object" && !Array.isArray(r); });
    });
    var badId = findBadId(data, stored);
    if (badId) return { ok: false, error: "bad-id", detail: badId };
    // מיזוג לפי המשתמש: מה שלא שויך לו לא נדרס, וקודי כניסה נשמרים
    var toSave = stored ? mergeSaveForUser(stored, data, user || {}) : data;
    if (toSave && toSave.error) return { ok: false, error: toSave.error, detail: toSave.detail || "" };
    /* חוט-מכשול נגד מחיקה המונית: שמירה שמרוקנת מסד גדול נחסמת.
       מסד ריק/כמעט-ריק שנשלח מדפדפן עם מטמון ריק היה דורס עשרות שעות
       עבודה בלחיצה אחת. מחיקות במערכת הן ממילא רכות (deleted:true),
       ולכן שמירה לגיטימית לעולם לא מקטינה את מספר השורות בעשרות אחוזים. */
    /* לקוח שקובץ ה-HTML שלו ישן אינו מכיר טבלאות חדשות (שכירויות,
       גיליונות): המיזוג שלו משמיט אותן, ושמירה — גם של מנהל — הייתה
       מוחקת אותן כליל. כך נמחקו הנתונים בפעם השלישית. מחיקות אמיתיות
       במערכת הן רכות (deleted:true), ולכן היעדר מוחלט או ריקון מוחלט
       של טבלה מאוכלסת לעולם אינו לגיטימי — משחזרים מהשמור. */
    var restoredTables = restoreMissingTables(stored, toSave);
    /* שורה חיה שחסרה בשמירה נרשמת כמחיקה רכה (ראה softDeleteOmitted) */
    var purged = countPurged(stored, toSave);
    if (purged) secLog("purged-rows", (user && user.id) || "", purged);
    var omitted = softDeleteOmitted(stored, toSave, user || {});
    if (omitted.length) secLog("omitted-rows-soft-deleted", (user && user.id) || "", omitted.join(" "));
    /* גם מחיקה רכה של טבלה שלמה מוחזרת — ההגנות האחרות עיוורות לה */
    restoredTables = restoredTables.concat(restoreMassDeleted(stored, toSave));
    if (restoredTables.length) {
      secLog("mass-delete-restored", (user && user.id) || "", restoredTables.join(" "));
      alertOwner("שמירה שניסתה למחוק נתונים — שוחזר", "בוצע על ידי: " + ((user && user.name) || "?") + "\nשוחזרו: " + restoredTables.join(", "));
    }
    var guard = shrinkGuard(stored, toSave);
    if (guard) {
      alertOwner("נחסמה שמירה שמרוקנת את המסד", "בוצע על ידי: " + ((user && user.name) || "?") + "\n" + guard);
      return { ok: false, error: "shrink-guard", detail: guard };
    }
    /* מחיקת כל המשתמשים בשמירה אחת = נעילת כולם בחוץ. לא קורה בעריכה
       לגיטימית — מנהל תמיד שולח את רשימת המשתמשים המלאה. */
    if (activeUserCount(stored) > 0 && activeUserCount(toSave) === 0) {
      alertOwner("נחסמה שמירה שמוחקת את כל המשתמשים", "בוצע על ידי: " + ((user && user.name) || "?"));
      return { ok: false, error: "users-wipe" };
    }
    /* מונה הגרסה בבעלות השרת: תמיד השמור + 1. ערך מופרז מהלקוח (למשל
       1e308) היה נועל את כל השמירות של כולם לתמיד. */
    /* שורת בנק שנשמרה בלי פרוייקט מסומנת כשורה מהמאגר המשותף: פרטי התנועה
       שלה נשארים מוגנים מעורך מוגבל גם אחרי שיוך */
    (toSave.bankMoves || []).forEach(function (m) { if (m && !m.apartmentId) m.pool = true; });
    var newRev = storedRev + 1;
    toSave.meta = toSave.meta || {};
    toSave.meta.rev = newRev;
    stampDeletions(stored, toSave, user || {});
    noteUserChanges(stored, toSave, user || {});
    var resetDrop = [];
    var before0 = Object.create(null);
    ((stored && stored.users) || []).forEach(function (u) { if (u) before0[u.id] = u; });
    ((toSave && toSave.users) || []).forEach(function (u) {
      var b0 = u && before0[u.id];
      if (b0 && (u.deleted || !u.active || b0.role !== u.role || String(b0.email || "") !== String(u.email || "") ||
          storableCode(b0.code) !== storableCode(u.code))) resetDrop.push(u.id);
    });
    saveData(toSave);
    clearResetFor(resetDrop);
    secLog("save", (user && user.id) || "", "rev " + newRev + (MERGE_INFO.dropped.length ? " dropped " + MERGE_INFO.dropped.length : ""));
    return { ok: true, savedAt: new Date().toISOString(), rev: newRev,
      restoredTables: restoredTables, dropped: MERGE_INFO.dropped.slice(0, 20) };
  } finally {
    lock.releaseLock();
  }
}
/* ---------- השמטה שקטה ----------
   מחיקה במערכת היא בדגל deleted. שורה חיה שפשוט חסרה בשמירה (ביטול של
   יצירה, לקוח חלקי, או ניסיון למחוק בלי להשאיר עקבות) נרשמת כמחיקה
   רכה עם שם המשתמש שהשרת אימת — נשארת בסל המחזור וניתנת לשחזור.
   רץ לפני restoreMassDeleted, כך שהשמטה המונית מטופלת כמחיקה המונית. */
/* שורות מחוקות (סל המחזור) שהושמטו — כלומר נמחקו לצמיתות */
function countPurged(stored, next) {
  var out = [];
  if (!stored || !next) return "";
  Object.keys(stored).forEach(function (T) {
    if (T === "users" || T === "settings" || T === "meta") return;
    if (!Array.isArray(stored[T]) || !Array.isArray(next[T])) return;
    var have = Object.create(null);
    next[T].forEach(function (r) { if (r && r.id != null) have[r.id] = 1; });
    var n = 0;
    stored[T].forEach(function (r) { if (r && r.id != null && r.deleted && !have[r.id]) n++; });
    if (n) out.push(T + " (" + n + ")");
  });
  return out.join(" ");
}
function softDeleteOmitted(stored, next, user) {
  var out = [], who = (user && user.name) || "", now = new Date().toISOString();
  if (!stored || !next) return out;
  Object.keys(stored).forEach(function (T) {
    if (T === "users" || T === "settings" || T === "meta") return;
    if (!Array.isArray(stored[T]) || !Array.isArray(next[T])) return;
    var have = Object.create(null);
    next[T].forEach(function (r) { if (r && r.id != null) have[r.id] = 1; });
    var n = 0;
    stored[T].forEach(function (r) {
      if (!r || r.id == null || r.deleted || have[r.id]) return;
      var c = JSON.parse(JSON.stringify(r));
      c.deleted = true; c.deletedAt = now; c.deletedByUser = who;
      next[T].push(c); n++;
    });
    if (n) out.push(T + " (" + n + ")");
  });
  return out;
}
/* ---------- מזהים ----------
   מזהה תקין: בלי גרשיים, סוגריים משולשים, לוכסן אחורי או תווי בקרה —
   התווים שהופכים מזהה שמוזרק ל-onclick או ל-HTML לקוד. */
var ID_RE = /^[^'"<>`\\&\u0000-\u001f\u007f\u2028\u2029]{1,120}$/;
var ID_FIELDS = ["id", "apartmentId", "expenseId", "partnerId", "categoryId", "accountId", "incomeId",
  "payId", "stmtBankId", "recipientManagerId", "payerPartnerId", "parentId", "managerId", "rentalId",
  "receivedBy", "userId", "moveId", "incMgmtManagerId", "bankId", "sheetId", "unitId", "depositId",
  "bankMoveId", "splitId", "recurId", "fileId"];
function idOk(v) {
  if (typeof v !== "string" && typeof v !== "number") return false;
  var s = String(v);
  /* שם של תכונה מובנית (constructor, __proto__...) שובר מפות לפי מזהה */
  return ID_RE.test(s) && !(s in Object.prototype);
}
/* עובר על כל העץ של כל טבלה — גם מערכים מקוננים (תשלומים, התאמות, קבצים,
   חלוקות, תבניות חלוקה, ביקורות) — ואוסף שדות מזהה לא תקינים.
   settings לא נבדק כאן: רק מנהל כותב אותו, והמפתחות שלו מקודדים בלקוח. */
function collectBadIds(d, limit) {
  var out = [];
  function walk(node, where, depth) {
    if (out.length >= limit || depth > 8 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (var i = 0; i < node.length; i++) walk(node[i], where, depth + 1); return; }
    for (var k = 0; k < ID_FIELDS.length; k++) {
      var f = ID_FIELDS[k], v = node[f];
      if (v == null || v === "") continue;
      if (!idOk(v)) out.push({ path: where + "." + f, val: (typeof v === "string" || typeof v === "number") ? String(v) : "" });
    }
    if (node.apartmentIds != null) {
      if (!Array.isArray(node.apartmentIds)) out.push({ path: where + ".apartmentIds", val: "" });
      else node.apartmentIds.forEach(function (a) {
        if (!idOk(a)) out.push({ path: where + ".apartmentIds", val: (typeof a === "string" || typeof a === "number") ? String(a) : "" });
      });
    }
    Object.keys(node).forEach(function (key) {
      var c = node[key];
      if (c && typeof c === "object") walk(c, where + "." + key, depth + 1);
    });
  }
  Object.keys(d || {}).forEach(function (T) {
    if (T === "settings" || T === "meta") return;
    if (Array.isArray(d[T])) walk(d[T], T, 0);
  });
  return out;
}
function findBadId(d, stored) {
  if (!d || typeof d !== "object") return "";
  var bad = collectBadIds(d, 50);
  if (!bad.length) return "";
  /* ערך לא תקין שכבר שמור במאגר (נתונים ישנים) לא נועל את השמירה —
     נדחה רק ערך חדש. שם תכונה מובנית וערך שאינו מחרוזת נדחים תמיד. */
  var old = Object.create(null);
  if (stored) collectBadIds(stored, 2000).forEach(function (b) { if (b.val) old[b.val] = 1; });
  for (var i = 0; i < bad.length; i++) {
    var b = bad[i];
    if (!b.val || (b.val in Object.prototype) || !old[b.val]) return b.path;
  }
  return "";
}
/* ---------- ייחוס בשרת ----------
   מי מחק נקבע לפי מי שהשרת אימת — לא לפי מה שהדפדפן כתב */
function stampDeletions(stored, next, user) {
  var who = (user && user.name) || "", now = new Date().toISOString();
  if (!stored || !next) return;
  Object.keys(next).forEach(function (T) {
    var arr = next[T];
    if (!Array.isArray(arr) || !Array.isArray(stored[T])) return;
    var was = Object.create(null);
    stored[T].forEach(function (r) { if (r && r.id != null) was[r.id] = r; });
    arr.forEach(function (r) {
      if (!r || r.id == null) return;
      var p0 = was[r.id];
      if (r.deleted && !(p0 && p0.deleted)) { r.deletedByUser = who; r.deletedAt = now; }
      else if (r.deleted && p0 && p0.deleted) {
        if (p0.deletedByUser === undefined) delete r.deletedByUser; else r.deletedByUser = p0.deletedByUser;
        if (p0.deletedAt === undefined) delete r.deletedAt; else r.deletedAt = p0.deletedAt;
      }
    });
  });
}
/* שינוי בטבלת המשתמשים — נרשם ביומן ונשלח לבעלים */
function noteUserChanges(stored, next, user) {
  try {
    var before = {}, lines = [];
    ((stored && stored.users) || []).forEach(function (u) { if (u) before[u.id] = u; });
    ((next && next.users) || []).forEach(function (u) {
      if (!u) return;
      var b = before[u.id];
      if (!b) { lines.push("משתמש חדש: " + u.name + " (" + u.role + ")"); return; }
      if (b.role !== u.role) lines.push("שינוי תפקיד: " + u.name + " " + b.role + " → " + u.role);
      if (!!b.deleted !== !!u.deleted || !!b.active !== !!u.active)
        lines.push((u.deleted || !u.active ? "השבתה: " : "הפעלה: ") + u.name);
      if (storableCode(b.code) !== storableCode(u.code)) lines.push("החלפת קוד כניסה: " + u.name);
      var ba = JSON.stringify(b.allowedApartments || []), na = JSON.stringify(u.allowedApartments || []);
      if (ba !== na) lines.push("שינוי הרשאות פרוייקטים: " + u.name);
    });
    if (!lines.length) return;
    secLog("users-changed", (user && user.id) || "", lines.join(" | "));
    alertOwner("שינוי במשתמשים", "בוצע על ידי: " + ((user && user.name) || "?") + "\n\n" + lines.join("\n"));
  } catch (err) {}
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
    var list = JSON.parse(raw), derived = deriveCode(codeHash);
    for (var i = 0; i < list.length; i++) if (constEq(list[i], derived)) { kdfRemember(codeHash); return true; }
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
      if (!u.deleted && u.active && u.code) hashes.push(storableCode(u.code));
    }
    props.setProperty(AUTH_PROP, JSON.stringify(hashes));
  } catch (err) { /* לא מכשילים שמירה בגלל מטמון */ }
}

function saveData(data) {
  migrateUserCodes(data);
  try {
    var anyUser = false;
    ((data && data.users) || []).forEach(function (u) { if (u && !u.deleted && u.active) anyUser = true; });
    PropertiesService.getScriptProperties().setProperty("crm_has_users", anyUser ? "1" : "0");
  } catch (err) {}
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
  if (d) { noteFallbackLoad(STAGING_SHEET); return d; }
  var sheets = ss().getSheets();
  var baks = [];
  for (var i = 0; i < sheets.length; i++) {
    var n = sheets[i].getName();
    if (n.indexOf(BAK_PREFIX) === 0) baks.push(n);
  }
  baks.sort().reverse();               // החדש ביותר קודם
  for (var j = 0; j < baks.length; j++) {
    d = readSheetJson(baks[j]);
    if (d) { noteFallbackLoad(baks[j]); return d; }
  }
  return null;
}
function noteFallbackLoad(name) {
  alertOwner("המסד נטען מעותק חלופי", "לשונית הנתונים הראשית (" + DATA_SHEET + ") חסרה או לא קריאה, והמערכת עובדת כרגע מהעותק \"" +
    name + "\". שינויים שנעשו אחרי העותק הזה אינם מוצגים. כדאי לבדוק את הגיליון.");
}
/* מדידת זמני הכניסה בשרת — להרצה ידנית מהעורך: בוחרים measureLoginSpeed
   בתפריט שליד "הפעלה", מריצים, ופותחים את "יומן ביצוע". לא נגיש מהאינטרנט
   (רק doGet/doPost נגישים), לא נוגע בפלפל ולא מדפיס קודים או נתונים — רק זמנים. */
function measureLoginSpeed() {
  var t0 = new Date().getTime(), out = [];
  function lap(name) { var t = new Date().getTime(); out.push(name + ": " + (t - t0) + "ms"); t0 = t; }
  var sh = ss().getSheetByName(DATA_SHEET), n = sh ? sh.getLastRow() : 0;
  lap("פתיחת לשונית הנתונים (" + n + " שורות)");
  var str = n ? sh.getRange(1, 1, n, 1).getValues().map(function (r) { return r[0]; }).join("") : "";
  lap("קריאת הנתונים (" + Math.round(str.length / 1024) + " KB)");
  var d = str ? JSON.parse(str) : {};
  lap("פענוח JSON");
  JSON.parse(JSON.stringify(d));
  lap("העתק עמוק (מה שנחסך בטעינת מנהל)");
  JSON.stringify({ ok: true, data: d });
  lap("הכנת התשובה");
  var cur = "measure";
  for (var i = 0; i < KDF_ITER; i++) cur = bytesToHex(Utilities.computeHmacSha256Signature(cur + ":" + i, "measure-key"));
  lap(KDF_ITER + " סבבי HMAC (נגזרת קוד אחת)");
  loginState();
  lap("קריאת מונה הכניסות");
  try { CacheService.getScriptCache().get("kdf2:measure"); } catch (err) {}
  lap("קריאה ממטמון הסקריפט");
  Logger.log(out.join("\n"));
  return out.join("\n");
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

  writeTab("קבצים", ["פרוייקט", "סוג", "תאריך", "שייך ל", "שם הקובץ", "קישור", "הועלה"],
    filesReadableRows(d, aMap));
}

/* טקסט שמתחיל ב-= + - @ היה הופך לנוסחה בגיליון — מקבל גרש בהתחלה */
function sheetSafe(v) {
  if (typeof v === "string" && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}
function writeTab(name, headers, rows) {
  var sh = ss().getSheetByName(name) || ss().insertSheet(name);
  sh.clear();
  rows = rows.map(function (r) { return r.map(sheetSafe); });
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
/* כל האבות (בכל עומק) של שלב מוסתר — מחוק או חי. סכום של אב כזה חושף
   את הסכום המוסתר, ולכן נשלח למי שאינו מנהל מחושב מהגלויים בלבד */
function hiddenAncestorsOf(exps) {
  var by = Object.create(null), out = Object.create(null), hid = hiddenIdsOf(exps);
  (exps || []).forEach(function (e) { if (e && e.id != null) by[e.id] = e; });
  Object.keys(hid).forEach(function (id) {
    var e = by[id], seen = Object.create(null);
    while (e && e.parentId && !seen[e.id]) { seen[e.id] = 1; out[e.parentId] = 1; e = by[e.parentId]; }
  });
  return out;
}
/* שלב מוסתר מסתיר גם את כל תתי-השלבים שלו (בכל עומק) */
function hiddenIdsOf(exps) {
  var by = Object.create(null), out = Object.create(null);
  (exps || []).forEach(function (e) { if (e && e.id != null) by[e.id] = e; });
  Object.keys(by).forEach(function (id) {
    var e = by[id], seen = Object.create(null);
    while (e && !seen[e.id]) {
      if (e.hidden) { out[id] = 1; break; }
      seen[e.id] = 1;
      e = e.parentId ? by[e.parentId] : null;
    }
  });
  return out;
}
function expSetFor(data, ctx, aptSet) {
  var set = Object.create(null), hid = ctx.nonAdmin ? hiddenIdsOf(data.expenses) : Object.create(null);
  (data.expenses || []).forEach(function (e) {
    if (!aptSet[e.apartmentId]) return;
    if (hid[e.id]) return;
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
    /* שורת בנק שעוד לא שויכה לפרוייקט נחוצה להתאמה; משויכת — רק בהיקף */
    case "bankMoves":
    case "withdrawals":
    case "incMgmtPays":         return !row.apartmentId || !!aptSet[row.apartmentId];
    case "recurring":           return (row.apartmentIds || []).some(function (a) { return !!aptSet[a]; });
    case "categories":
    case "stmtBanks":           return true;      /* רשימות עזר כלליות */
    default:                    return false;     /* טבלה שלא הוגדרה — חסומה, לא פתוחה */
  }
}
function knownKey(k) {
  return SCOPED_TABLES.indexOf(k) >= 0 ||
    ["partners", "rentals", "sheets", "users", "settings", "meta"].indexOf(k) >= 0;
}
var SCOPED_TABLES = ["apartments","apartmentPartners","managers","accounts",
  "deposits","income","expenses","expenseSplits","expenseManagerFees","payments",
  "bankMoves","withdrawals","incMgmtPays","recurring","categories","stmtBanks"];
/* השדה שקובע לאיזה היקף שייכת השורה — עובר אימות גם בעדכון, לא רק ביצירה */
function scopeFieldOf(table) {
  switch (table) {
    case "apartments": return "id";
    case "expenseSplits": case "expenseManagerFees": case "payments": return "expenseId";
    case "categories": case "stmtBanks": return "";
    default: return "apartmentId";
  }
}

/* ----- סינון בטעינה ----- */
function scopeDataForUser(data, user) {
  var ctx = userCtx(user);
  if (ctx.isAdmin) {
    /* מנהל מקבל הכל חוץ מהקודים. קודם כל המסד הועתק עמוק (מחרוזת ופענוח של
       כל הנתונים) רק כדי להחליף שדה אחד בטבלת המשתמשים. עכשיו העתק רדוד:
       טבלת המשתמשים מועתקת שורה-שורה, כך שהמסד המקורי לא משתנה — ושאר
       הטבלאות משותפות עם data, ולכן אסור לשנות את התוצאה (היא נשלחת כמו שהיא). */
    var a = {};
    Object.keys(data || {}).forEach(function (k0) { a[k0] = data[k0]; });
    a.users = ((data && data.users) || []).map(function (u) {
      var c = {}; for (var k in u) if (u.hasOwnProperty(k)) c[k] = u[k];
      c.code = "***"; return c;
    });
    return a;
  }
  var d = JSON.parse(JSON.stringify(data));
  d.users = [];
  /* פיצ'רים של מנהלים בלבד — הנתונים לא נשלחים לדפדפן של אחרים */
  d.rentals = []; d.sheets = [];
  Object.keys(d).forEach(function (k) { if (!knownKey(k)) delete d[k]; });
  /* קטגוריות לפי פרוייקט — הגדרת מנהל. mergeSaveForUser ממילא שומר את
     ההגדרות מהמאגר, כך ששמירה של משתמש כזה לא מוחקת אותן. */
  /* הגדרות: רשימת היתר — רק מה שמסכי המשתמשים האחרים צריכים. הגדרה חדשה
     של מנהל לא נשלחת לאחרים כברירת מחדל. mergeSaveForUser לוקח את ההגדרות
     מהמאגר, כך ששמירה של משתמש כזה לא מוחקת אף אחת מהן. */
  var st0 = d.settings || {};
  d.settings = { paymentMethods: st0.paymentMethods || {} };
  if (st0.currency != null) d.settings.currency = st0.currency;
  stripFiles(d);                    // קבצים מצורפים — מנהלים בלבד
  if (user.role !== "editor") stripAdminFields(d);   // קטגוריית הכנסה — מנהל ועורך בלבד
  var aptSet = aptSetFor(d, ctx), expSet = expSetFor(d, ctx, aptSet);
  SCOPED_TABLES.forEach(function (T) {
    d[T] = (d[T] || []).filter(function (r) { return rowVisible(T, r, ctx, aptSet, expSet); });
  });
  /* מכל שיש לו תת-שלב מוסתר: הסכום נשלח כסכום תתי-השלבים הגלויים בלבד,
     כדי שאי אפשר יהיה לחשב ממנו את הסכום המוסתר */
  var hidKids = hiddenAncestorsOf(data.expenses);
  if (Object.keys(hidKids).length) {
    /* מלמטה למעלה: סכום הילדים הגלויים באותו מצב (חי/מחוק) כמו האב */
    var kidsOf = Object.create(null), byId0 = Object.create(null);
    (d.expenses || []).forEach(function (e) {
      if (!e) return;
      byId0[e.id] = e;
      if (e.parentId) (kidsOf[e.parentId] = kidsOf[e.parentId] || []).push(e);
    });
    var done = Object.create(null);
    var calc = function (e, depth) {
      if (!hidKids[e.id] || done[e.id] || depth > 10) return Number(e.amount) || 0;
      done[e.id] = 1;
      var sum = 0;
      (kidsOf[e.id] || []).forEach(function (k) { if (!!k.deleted === !!e.deleted) sum += calc(k, depth + 1); });
      e.amount = Math.round(sum * 100) / 100;
      return e.amount;
    };
    Object.keys(hidKids).forEach(function (id) { if (byId0[id]) calc(byId0[id], 0); });
  }
  /* צפייה ודמי ניהול לא כותבים: אין להם צורך בשורות בנק שלא שויכו,
     בסל המחזור, בהוראות קבע, ובפרטי קשר של שותפים */
  if (user.role !== "editor") {
    ["bankMoves", "withdrawals", "incMgmtPays"].forEach(function (T) {
      d[T] = (d[T] || []).filter(function (r) { return r && r.apartmentId && aptSet[r.apartmentId]; });
    });
    d.recurring = [];
    /* סל המחזור לא נשלח: שורות מחוקות — וגם פריטים מחוקים בתוך שורות
       (תשלומי אורח, ביקורות, התאמות). טבלאות עזר (חשבונות, מנהלים,
       קטגוריות, בנקים) נשארות אם שורה חיה עדיין מצביעה עליהן. */
    var REF_T = { accounts: 1, managers: 1, categories: 1, stmtBanks: 1 };
    /* שורות של פרוייקט שנמחק (נמצא בסל המחזור) — גם הן לא נשלחות */
    var delApt = Object.create(null);
    (data.apartments || []).forEach(function (a) { if (a && a.deleted) delApt[a.id] = 1; });
    SCOPED_TABLES.forEach(function (T) {
      if (REF_T[T] || T === "apartments") return;
      d[T] = (d[T] || []).filter(function (r) { return !(r && r.apartmentId && delApt[r.apartmentId]); });
    });
    SCOPED_TABLES.forEach(function (T) {
      if (REF_T[T]) return;
      d[T] = (d[T] || []).filter(function (r) { return r && !r.deleted; });
    });
    SCOPED_TABLES.forEach(function (T) {
      (d[T] || []).forEach(function (r) {
        Object.keys(r).forEach(function (f) {
          if (Array.isArray(r[f])) r[f] = r[f].filter(function (x) { return !(x && typeof x === "object" && x.deleted); });
        });
      });
    });
    (d.apartments || []).forEach(function (a) {
      Object.keys(a).forEach(function (f) {
        if (Array.isArray(a[f])) a[f] = a[f].filter(function (x) { return !(x && typeof x === "object" && x.deleted); });
      });
    });
    var usedMgr = Object.create(null);
    (d.payments || []).forEach(function (x) { if (x.recipientManagerId) usedMgr[x.recipientManagerId] = 1; });
    (d.expenseManagerFees || []).forEach(function (x) { if (x.managerId) usedMgr[x.managerId] = 1; });
    (d.incMgmtPays || []).forEach(function (x) { if (x.incMgmtManagerId) usedMgr[x.incMgmtManagerId] = 1; });
    d.managers = (d.managers || []).filter(function (m) { return m && (!m.deleted || usedMgr[m.id]); });
    var usedBank = Object.create(null), usedAcc = Object.create(null), usedCat = Object.create(null);
    (d.bankMoves || []).forEach(function (m) { if (m.stmtBankId) usedBank[m.stmtBankId] = 1; });
    ["payments", "deposits", "withdrawals", "income", "incMgmtPays", "bankMoves"].forEach(function (T) {
      (d[T] || []).forEach(function (r) {
        ["accountId", "fromAccount", "bankId"].forEach(function (f) { if (r[f]) usedAcc[r[f]] = 1; });
        if (r.receivedBy) usedAcc[String(r.receivedBy).replace(/^bank:/, "")] = 1;
        (Array.isArray(r.payments) ? r.payments : []).forEach(function (g) {
          if (g && g.receivedBy) usedAcc[String(g.receivedBy).replace(/^bank:/, "")] = 1;
          if (g && g.accountId) usedAcc[g.accountId] = 1;
        });
      });
    });
    (d.expenses || []).forEach(function (e) { if (e.categoryId) usedCat[e.categoryId] = 1; });
    d.stmtBanks = (d.stmtBanks || []).filter(function (b) { return usedBank[b.id]; });
    d.accounts = (d.accounts || []).filter(function (a) { return (!a.deleted && a.apartmentId) || usedAcc[a.id]; })
      .map(function (a) { if (!a.apartmentId) { a = JSON.parse(JSON.stringify(a)); delete a.partnerId; } return a; });
    d.categories = (d.categories || []).filter(function (c) { return usedCat[c.id]; });
  }
  /* התאמות של שורת בנק להזמנות שאינן בהיקף — לא נשלחות */
  var incOk = {};
  (d.income || []).forEach(function (i) { if (i && i.id != null) incOk[i.id] = 1; });
  (d.bankMoves || []).forEach(function (m) {
    if (m && Array.isArray(m.matches)) m.matches = m.matches.filter(function (x) { return x && incOk[x.incomeId]; });
  });
  /* תפקיד "דמי ניהול": מנהל שמקבל דמי ניהול. מקבל אך ורק את השלבים
     שיש בהם דמי ניהול ואת התשלומים למנהלים — בלי חלוקת שותפים,
     תשלומי ספקים, הפקדות, הכנסות, חשבונות, בנק, משיכות והוראות קבע. */
  if (user.role === "mgmt") {
    var mgOk = {};
    (d.expenses || []).forEach(function (e) { if (e.mgmtEnabled) mgOk[e.id] = 1; });
    d.expenses = (d.expenses || []).filter(function (e) { return mgOk[e.id]; });
    d.payments = (d.payments || []).filter(function (p) { return mgOk[p.expenseId] && p.recipientType === "manager"; });
    d.expenseManagerFees = (d.expenseManagerFees || []).filter(function (f) { return mgOk[f.expenseId]; });
    d.expenseSplits = []; d.deposits = []; d.income = [];
    d.partners = []; d.apartmentPartners = []; d.accounts = [];
    d.bankMoves = []; d.stmtBanks = []; d.withdrawals = []; d.incMgmtPays = []; d.recurring = [];
    d.categories = [];
    /* שדות שהדוח שלו לא צריך: הערות פרוייקט, חלוקות שותפים, ביקורות,
       יחידות להשכרה, הערות וקישורי חשבונית של ספקים, חשבונות ומשלמים */
    (d.apartments || []).forEach(function (a) {
      ["notes", "note", "splitPresets", "incomeSplit", "reviews", "rentalUnits", "bankAcctInit", "bookingMode", "docs"]
        .forEach(function (f) { delete a[f]; });
      if (a.autoMgmt && typeof a.autoMgmt === "object") delete a.autoMgmt.partnerId;
    });
    (d.expenses || []).forEach(function (e) {
      ["note", "invoiceLink", "invoices", "categoryId", "sentToCpa"].forEach(function (f) { delete e[f]; });
    });
    (d.payments || []).forEach(function (x) {
      ["payerPartnerId", "accountId", "invoiceLink", "fromAccount", "receivedBy"].forEach(function (f) { delete x[f]; });
    });
    return d;
  }
  /* שותפים: רק אלה שקשורים לדירות/לתנועות שכבר סוננו למשתמש. כך גם
     שם, וגם טלפון/הערות של שותפים מדירות אחרות — לא נשלחים כלל. */
  d.partners = scopePartnersFor(d, true);
  /* צפייה: שם השותף בלבד — בלי טלפון והערות (רק ספר השותפים של המנהל מציג אותם) */
  if (user.role !== "editor") {
    d.partners = d.partners.map(function (p) { return { id: p.id, name: p.name, deleted: !!p.deleted }; });
  }
  return d;
}
/* קבוצת מזהי-השותפים המוזכרים בנתונים שכבר סוננו למשתמש */
function referencedPartnerIds(d, strict) {
  var s = Object.create(null);
  (d.apartmentPartners || []).forEach(function (x) { if (x.partnerId) s[x.partnerId] = 1; });
  (d.expenseSplits || []).forEach(function (x) { if (x.partnerId) s[x.partnerId] = 1; });
  (d.deposits || []).forEach(function (x) { if (x.partnerId) s[x.partnerId] = 1; });
  /* strict (משתמש מוגבל): חשבון כללי בלי פרוייקט לא מושך שותף זר */
  (d.accounts || []).forEach(function (x) { if (x.partnerId && !(strict && !x.apartmentId)) s[x.partnerId] = 1; });
  (d.payments || []).forEach(function (x) { if (x.payerPartnerId) s[x.payerPartnerId] = 1; });
  (d.withdrawals || []).forEach(function (x) { if (x.partnerId) s[x.partnerId] = 1; });
  (d.income || []).forEach(function (x) { if (x.receivedBy && x.receivedBy !== "bank") s[x.receivedBy] = 1; });
  return s;
}
function scopePartnersFor(d, strict) {
  var ref = referencedPartnerIds(d, strict);
  return (d.partners || []).filter(function (p) { return ref[p.id]; });
}

/* ----- מיזוג בשמירה ----- */
function reconcileUserCodes(incoming, stored) {
  var storedById = {};
  (stored.users || []).forEach(function (u) { storedById[u.id] = u; });
  (incoming.users || []).forEach(function (u) {
    if (!u.code || u.code === "***") u.code = storableCode(storedById[u.id] ? storedById[u.id].code : "");
    else u.code = storableCode(u.code);        /* קוד חדש מהדפדפן — נשמר כנגזרת */
  });
  var seen = {};
  (incoming.users || []).forEach(function (u) {
    if (u.deleted || !u.active || !u.code) return;
    if (seen[u.code]) { if (storedById[u.id]) u.code = storedById[u.id].code; }   /* קוד כפול — משאירים ישן */
    else seen[u.code] = 1;
  });
}
var MERGE_INFO = { dropped: [] };
function mergeSaveForUser(stored, incoming, user) {
  var ctx = userCtx(user);
  MERGE_INFO.dropped = [];
  if (ctx.isAdmin) { reconcileUserCodes(incoming, stored); return incoming; }

  var result = JSON.parse(JSON.stringify(incoming));
  result.users = stored.users || [];
  result.settings = stored.settings || result.settings;
  /* טבלאות שמוסתרות ממי שאינו מנהל — נשמרות מהמאגר, לא ממה שנשלח */
  result.rentals = stored.rentals || [];
  result.sheets  = stored.sheets  || [];
  /* מפתחות שאינם טבלה מוכרת, ו-meta, באים מהמאגר — לא ממה שנשלח */
  Object.keys(result).forEach(function (k) { if (!knownKey(k)) delete result[k]; });
  Object.keys(stored).forEach(function (k) { if (!knownKey(k)) result[k] = stored[k]; });
  result.meta = JSON.parse(JSON.stringify(stored.meta || { version: 1 }));
  /* השרת שולח למשתמש מוגבל רק חלק מהשותפים — כדי לא לאבד את השאר
     בשמירה, ממזגים לפי id: מתחילים מהמאגר המלא השמור, ומעדכנים/מוסיפים
     את מה שהמשתמש שלח (עריכות ושותפים חדשים גוברים). */
  var aptSet = aptSetFor(stored, ctx), expSet = expSetFor(stored, ctx, aptSet);
  var dropped = [];                       /* שינויים שהושמטו/שוחזרו — מדווחים ללקוח וליומן */

  /* שותפים שהמשתמש רשאי להפנות אליהם ולערוך: אלה שכבר מופיעים בהיקף
     שלו במאגר, ואלה שהוא יצר בשמירה הזאת. הפניה לשותף זר הייתה גורמת
     לשרת לשלוח לו את הטלפון וההערות של אותו שותף בטעינה הבאה. */
  var scopedStored = scopeDataForUser(stored, user);
  var knownPartners = referencedPartnerIds(scopedStored, true);
  (scopedStored.partners || []).forEach(function (p) { if (p && p.id != null) knownPartners[p.id] = 1; });
  var storedPartnerById = Object.create(null);
  (stored.partners || []).forEach(function (p) { if (p && p.id != null) storedPartnerById[p.id] = p; });
  var storedPartnerIds = Object.create(null);
  (stored.partners || []).forEach(function (p) { if (p && p.id != null) storedPartnerIds[p.id] = 1; });
  (incoming.partners || []).forEach(function (p) { if (p && p.id != null && !storedPartnerIds[p.id]) knownPartners[p.id] = 1; });
  /* השרת שולח למשתמש מוגבל רק חלק מהשותפים — מתחילים מהמאגר המלא,
     ומקבלים ממנו רק עריכה של שותף בהיקף שלו או שותף חדש */
  /* שותפים שמופיעים גם בשורות שהמשתמש לא רואה (פרוייקטים אחרים) */
  var hiddenRefs = Object.create(null);
  if (ctx.limited) {
    ["apartmentPartners", "expenseSplits", "deposits", "accounts", "payments", "income", "withdrawals"].forEach(function (T) {
      var seen = Object.create(null);
      (scopedStored[T] || []).forEach(function (r) { if (r && r.id != null) seen[r.id] = 1; });
      var o = {}; o[T] = (stored[T] || []).filter(function (r) { return r && !seen[r.id]; });
      var refs = referencedPartnerIds(o, false);
      Object.keys(refs).forEach(function (k) { hiddenRefs[k] = 1; });
    });
  }
  var pById = Object.create(null);
  (stored.partners || []).forEach(function (p) { if (p && p.id != null) pById[p.id] = p; });
  (incoming.partners || []).forEach(function (p) {
    if (!p || p.id == null) return;
    var sp = storedPartnerById[p.id];
    if (sp && ctx.limited && !knownPartners[p.id]) { dropped.push("partners:" + p.id + " scope"); return; }
    if (sp && ctx.limited && hiddenRefs[p.id] && !!p.deleted !== !!sp.deleted) {
      /* שותף משותף: עריכת פרטים מותרת, מחיקה/שחזור — לא */
      if (sp.deleted) p.deleted = true; else { p.deleted = false; delete p.deletedAt; delete p.deletedByUser; }
      dropped.push("partners:" + p.id + " shared");
    }
    pById[p.id] = p;
  });
  result.partners = Object.keys(pById).map(function (k) { return pById[k]; });

  /* קבוצת הוצאות בהיקף המורשה — משורות ישנות וגם חדשות שנשלחו — כדי
     לאמת שילדים (חלוקות/תשלומים) מצביעים להוצאה בהיקף המותר.
     הוצאה מוסתרת (hidden) אינה בהיקף של מי שאינו מנהל; מזהה שנשלח
     מחדש עם פרוייקט אחר לא "מלבין" הוצאה זרה. */
  var storedExpById = Object.create(null);
  (stored.expenses || []).forEach(function (e) { if (e && e.id != null) storedExpById[e.id] = e; });
  var storedHid = hiddenIdsOf(stored.expenses);
  /* מכלים שיש להם תת-שלב מוסתר — הסכום שלהם נשמר מהמאגר */
  var storedHidKids = hiddenAncestorsOf(stored.expenses);
  var allowedExp = Object.create(null);
  (stored.expenses || []).forEach(function (e) { if (aptSet[e.apartmentId] && !storedHid[e.id]) allowedExp[e.id] = 1; });
  (incoming.expenses || []).forEach(function (e) {
    if (!e || !aptSet[e.apartmentId]) return;
    var se = storedExpById[e.id];
    if (!se || rowVisible("expenses", se, ctx, aptSet, expSet)) allowedExp[e.id] = 1;
  });
  /* הכנסות שהמשתמש רואה — להשלמת התאמות בנק שהוסתרו ממנו */
  var visInc = Object.create(null);
  (scopedStored.income || []).forEach(function (i) { if (i && i.id != null) visInc[i.id] = 1; });

  /* שורה קיימת שעודכנה: הגרסה החדשה חייבת להישאר בהיקף. דירה — מותר
     לעדכן (לא ליצור) אם היא בהיקף. הוראת קבע שמשותפת לפרוייקט זר —
     מותר לערוך כל עוד החלק הזר לא השתנה. */
  function foreignApts(a) { return (a || []).filter(function (x) { return !aptSet[x]; }).sort().join(); }
  function nv(v) { return (v == null || v === false || v === "") ? "" : (Array.isArray(v) ? v.slice().sort().join() : String(v)); }
  function keyChanged(a, b, fields) {
    for (var i = 0; i < fields.length; i++) if (nv(a[fields[i]]) !== nv(b[fields[i]])) return true;
    return false;
  }
  /* קטגוריות, בנקים וחשבונות כלליים — טבלאות עזר של כל העסק. מי שאינו
     מנהל יכול להוסיף שורה חדשה, לא לשנות או למחוק קיימת */
  function isGlobalRef(T, sr) {
    return T === "categories" || T === "stmtBanks" || (T === "accounts" && !sr.apartmentId);
  }
  /* אב תקין לתת-שלב: גלוי למשתמש, אינו בעצמו תת-שלב, והשורה אינה אב */
  var allExpById = Object.create(null), hasKids = Object.create(null);
  (stored.expenses || []).concat(incoming.expenses || []).forEach(function (e) {
    if (!e || e.id == null) return;
    allExpById[e.id] = e;
  });
  (stored.expenses || []).forEach(function (e) { if (e && e.parentId && !e.deleted) hasKids[e.parentId] = 1; });
  function parentOk(r) {
    if (!allowedExp[r.parentId]) return false;
    var par = allExpById[r.parentId];
    if (par && par.parentId) return false;
    if (hasKids[r.id]) return false;
    return true;
  }
  var REF_FIELDS = ["name", "deleted", "isBank", "apartmentId", "partnerId"];
  var REC_FIELDS = ["apartmentIds", "amount", "description", "every", "nextDate", "lastRun", "paused", "deleted", "categoryId", "note"];
  var BANK_FIELDS = ["amount", "date", "name", "details", "ref", "stmtBankId", "kind", "deleted"];
  function updOk(T, r, sr) {
    if (!ctx.limited) {
      if (T === "payments" || T === "expenseSplits" || T === "expenseManagerFees") return !!allowedExp[r.expenseId];
      return true;
    }
    if (T === "apartments") return !!aptSet[r.id];
    if (T === "recurring" && sr) {
      return (r.apartmentIds || []).some(function (a) { return !!aptSet[a]; }) &&
             foreignApts(r.apartmentIds) === foreignApts(sr.apartmentIds);
    }
    return newRowAllowed(T, r, ctx, aptSet, allowedExp);
  }
  /* נדחית רק הפניה לשותף שקיים במאגר ואינו בהיקף המשתמש. ערכים שאינם
     שותף (חשבון, "bank", מנהל) לא נבדקים כאן. */
  function partnerRefsOf(r) {
    var refs = [r.partnerId, r.payerPartnerId, r.receivedBy];
    (Array.isArray(r.payments) ? r.payments : []).forEach(function (g) { if (g) refs.push(g.receivedBy, g.partnerId, g.payerPartnerId); });
    if (Array.isArray(r.split)) r.split.forEach(function (x) { if (x) refs.push(x.partnerId); });
    else if (r.split && typeof r.split === "object") Object.keys(r.split).forEach(function (k) { refs.push(k); });
    return refs;
  }
  function partnerRefOk(r, sr) {
    if (!ctx.limited) return true;
    var was = Object.create(null);
    if (sr) partnerRefsOf(sr).forEach(function (v) { if (v != null && v !== "") was[v] = 1; });
    var refs = partnerRefsOf(r);
    for (var i = 0; i < refs.length; i++) {
      var v = refs[i];
      if (v == null || v === "" || was[v]) continue;          /* הפניה שלא השתנתה מהשמור — מותרת */
      if (storedPartnerIds[v] && !knownPartners[v]) return false;
    }
    return true;
  }
  /* התאמות בנק: משתמש מוגבל מתאים רק להכנסות שהוא רואה (או שיצר בשמירה
     הזאת); התאמות שמורות להכנסות שהוסתרו ממנו תמיד חוזרות מהמאגר */
  var okInc = Object.create(null);
  Object.keys(visInc).forEach(function (k) { okInc[k] = 1; });
  var storedIncIds = Object.create(null);
  (stored.income || []).forEach(function (i) { if (i && i.id != null) storedIncIds[i.id] = 1; });
  (incoming.income || []).forEach(function (i) {
    if (i && i.id != null && !storedIncIds[i.id] && aptSet[i.apartmentId]) okInc[i.id] = 1;
  });
  function fixMatches(r, sr) {
    if (!ctx.limited) return;
    var hidden = (sr && Array.isArray(sr.matches)) ? sr.matches.filter(function (m) { return m && !visInc[m.incomeId]; }) : [];
    var hiddenIds = Object.create(null);
    hidden.forEach(function (m) { if (m.id != null) hiddenIds[m.id] = 1; });
    if (!Array.isArray(r.matches)) { if (hidden.length) r.matches = hidden; return; }
    var kept = r.matches.filter(function (m) {
      if (!m || typeof m !== "object") return false;
      if (m.id != null && hiddenIds[m.id]) return false;                    /* השמורה גוברת */
      if (m.incomeId != null && m.incomeId !== "" && !okInc[m.incomeId]) { dropped.push("bankMoves:" + r.id + " match"); return false; }
      return true;
    });
    r.matches = kept.concat(hidden);
  }

  var tampered = [];
  SCOPED_TABLES.forEach(function (T) {
    result[T] = result[T] || [];
    var fromIncoming = Object.create(null); result[T].forEach(function (r) { if (r) fromIncoming[r.id] = 1; });
    var storedById = Object.create(null); (stored[T] || []).forEach(function (r) { if (r) storedById[r.id] = r; });
    var scopeF = scopeFieldOf(T);

    /* 1. שחזור כל שורה שהוסתרה מהמשתמש ואינה במה ששלח — לא נאבד דבר.
          גם שורה מחוקה (בסל המחזור) שהושמטה חוזרת: רק מנהל מוחק לצמיתות. */
    var purgeTry = 0;
    (stored[T] || []).forEach(function (row) {
      if (fromIncoming[row.id]) return;
      if (!rowVisible(T, row, ctx, aptSet, expSet)) result[T].push(row);
      else if (row.deleted) { result[T].push(row); purgeTry++; }
      else if (isGlobalRef(T, row) ||
               (T === "recurring" && ctx.limited && foreignApts(row.apartmentIds)) ||
               (T === "bankMoves" && ctx.limited && (row.pool || !row.apartmentId))) {
        /* שורה שהמשתמש לא רשאי למחוק — השמטה שלה לא נחשבת מחיקה */
        result[T].push(row); dropped.push(T + ":" + row.id + (T === "bankMoves" ? " bankline" : " shared"));
      }
    });
    if (purgeTry) tampered.push(T + ":purge(" + purgeTry + ")");
    /* 2. כל שורה שהמשתמש שלח: יצירה — רק בהיקף; עדכון — רק אם השורה
          השמורה הייתה גלויה לו, והגרסה החדשה עדיין בהיקף */
    var out = [];
    for (var i = 0; i < result[T].length; i++) {
      var r = result[T][i];
      if (!r) continue;
      if (!fromIncoming[r.id]) { out.push(r); continue; }             /* שוחזר מהמאגר */
      var sr = storedById[r.id];
      if (sr) {
        if (!rowVisible(T, sr, ctx, aptSet, expSet)) {
          /* שורה שלא נשלחה אליו חזרה ממנו — נשמרת כפי שהייתה, והמקרה נרשם */
          tampered.push(T + ":" + r.id); out.push(sr); continue;
        }
        if (isGlobalRef(T, sr)) {
          if (keyChanged(r, sr, REF_FIELDS)) dropped.push(T + ":" + r.id + " shared");
          out.push(sr); continue;
        }
        if (T === "recurring" && ctx.limited && foreignApts(sr.apartmentIds)) {
          /* הוראת קבע שמשותפת לפרוייקט שהמשתמש לא רואה — נשארת כפי שהיא */
          if (keyChanged(r, sr, REC_FIELDS)) dropped.push(T + ":" + r.id + " shared");
          out.push(sr); continue;
        }
        if (T === "bankMoves" && sr.pool) r.pool = true;           /* הסימון דביק */
        if (T === "bankMoves" && ctx.limited && sr.apartmentId && !r.apartmentId) {
          /* החזרת שורה למאגר המשותף אחרי שיוך — רק מנהל */
          dropped.push(T + ":" + r.id + " bankline"); r.apartmentId = sr.apartmentId;
        }
        if (T === "bankMoves" && ctx.limited && (sr.pool || !sr.apartmentId)) {
          r.pool = true;                                         /* שויכה מהמאגר המשותף — נשארת מוגנת */
          /* שורת בנק שעוד לא שויכה: מותר לשייך לפרוייקט שלו ולהתאים — לא
             לשנות את פרטי התנועה עצמה או למחוק אותה */
          if (keyChanged(r, sr, BANK_FIELDS)) dropped.push(T + ":" + r.id + " bankline");
          BANK_FIELDS.forEach(function (f) { if (sr[f] === undefined) delete r[f]; else r[f] = sr[f]; });
        }
        /* גרסה חדשה מחוץ להיקף, או העברה לפרוייקט זר — השורה נשארת כפי
           שהייתה, והשינוי מדווח. השמירה עצמה לא נכשלת. */
        if (!updOk(T, r, sr)) { dropped.push(T + ":" + r.id + " scope"); out.push(sr); continue; }
        if (ctx.limited && scopeF && T !== "apartments" && sr[scopeF] !== r[scopeF] && !(updOk(T, sr, sr) && updOk(T, r, sr))) {
          dropped.push(T + ":" + r.id + " move"); out.push(sr); continue;
        }
        if (!partnerRefOk(r, sr)) { dropped.push(T + ":" + r.id + " partner"); out.push(sr); continue; }
        if (T === "expenses" && nv(r.parentId) !== nv(sr.parentId) && r.parentId && !parentOk(r)) {
          dropped.push(T + ":" + r.id + " parent"); out.push(sr); continue;
        }
        /* רק מנהל מסתיר — הדגל חוזר מהמאגר */
        if (T === "expenses" || T === "payments") { if (sr.hidden) r.hidden = true; else delete r.hidden; }
        if (T === "expenses" && storedHidKids[sr.id]) r.amount = sr.amount;
        if (T === "bankMoves") fixMatches(r, sr);
      } else {
        if (!newRowAllowed(T, r, ctx, aptSet, allowedExp)) { dropped.push(T + ":" + r.id + " new"); continue; }
        if (T === "expenses" && r.parentId && !parentOk(r)) {
          delete allowedExp[r.id]; dropped.push(T + ":" + r.id + " parent"); continue;
        }
        if (!partnerRefOk(r, null)) {
          if (T === "expenses") delete allowedExp[r.id];      /* הוצאה שנפלה — גם הילדים שלה לא נכנסים */
          dropped.push(T + ":" + r.id + " partner"); continue;
        }
        if (T === "expenses" || T === "payments") delete r.hidden;
        if (T === "bankMoves") fixMatches(r, null);
      }
      out.push(r);
    }
    result[T] = out;
  });
  if (tampered.length) secLog("restored-foreign-rows", user.id, tampered.slice(0, 20).join(" "));
  if (dropped.length) secLog("dropped-out-of-scope", user.id, dropped.slice(0, 20).join(" "));
  MERGE_INFO.dropped = dropped;
  /* הקבצים המצורפים לא נשלחו אליו — חוזרים מהמאגר, והוא לא יכול להוסיף */
  restoreFiles(stored, result);
  /* גם קטגוריית ההכנסה — לא נשלחה אליו, חוזרת מהמאגר */
  if (user.role !== "editor") restoreAdminFields(stored, result);
  return result;
}
function newRowAllowed(table, row, ctx, aptSet, allowedExp) {
  if (ctx.isAdmin) return true;
  if (table === "payments" || table === "expenseSplits" || table === "expenseManagerFees")
    return !!allowedExp[row.expenseId];
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
    case "bankMoves":
    case "withdrawals":
    case "incMgmtPays":         return !row.apartmentId || !!aptSet[row.apartmentId];
    case "recurring":           return (row.apartmentIds || []).length > 0 &&
                                       (row.apartmentIds || []).every(function (a) { return !!aptSet[a]; });
    case "categories":
    case "stmtBanks":           return true;
    default:                    return false;
  }
}

/* ============================================================
   ✂ סוף הקובץ — אחרי השורה הזאת לא אמור להיות כלום.
   אם בעורך מופיע כאן עוד טקסט (למשל שארית מהקוד הקודם) — למחוק אותו.
   ============================================================ */
