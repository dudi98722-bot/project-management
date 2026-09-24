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
    // guard = גרסת ההגנות, לאימות חיצוני שההדבקה נקלטה.
    return jsonOut({ ok: true, hasUsers: hasAnyUser(), guard: 2, files: 1 });
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
    /* שחזור טבלאות שנמחקו — מהגיבוי היומי שבתוך הקובץ. מנהל בלבד.
       משחזר רק טבלאות שריקות היום ומאוכלסות בגיבוי; לא נוגע בשאר. */
    if (action === "salvage") {
      if (user.role !== "admin") return jsonOut({ ok: false, error: "forbidden" });
      return jsonOut(salvageFromBackups());
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
    /* ---- קבצים מצורפים בדרייב — מנהל בלבד ---- */
    if (action === "fileUpload" || action === "fileTrash" || action === "filesInfo" ||
        action === "filesSetRoot" || action === "filesPrepare" || action === "fileCopy") {
      if (user.role !== "admin") return jsonOut({ ok: false, error: "forbidden" });
      if (action === "fileUpload")   return jsonOut(fileUpload(body));
      if (action === "fileTrash")    return jsonOut(fileTrash(body));
      if (action === "filesInfo")    return jsonOut(filesInfo(body));
      if (action === "filesPrepare") return jsonOut(filesPrepare(body));
      if (action === "fileCopy")     return jsonOut(fileCopy(body));
      return jsonOut(filesSetRoot(body));
    }
    return jsonOut({ ok: false, error: "unknown action" });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
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
/* הסרה — לפח של הדרייב (אפשר לשחזר משם), ורק קובץ שבתוך תיקיית הקבצים */
function fileTrash(body) {
  var id = String(body.fileId || "");
  if (!id) return { ok: false, error: "no-file" };
  var file;
  try { file = DriveApp.getFileById(id); } catch (e) { return { ok: true, missing: true }; }
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
    var before = liveCount(stored[k]), after = liveCount(incoming[k]);
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
    // מיזוג לפי המשתמש: מה שלא שויך לו לא נדרס, וקודי כניסה נשמרים
    var toSave = stored ? mergeSaveForUser(stored, data, user || {}) : data;
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
    /* גם מחיקה רכה של טבלה שלמה מוחזרת — ההגנות האחרות עיוורות לה */
    restoredTables = restoredTables.concat(restoreMassDeleted(stored, toSave));
    var guard = shrinkGuard(stored, toSave);
    if (guard) return { ok: false, error: "shrink-guard", detail: guard };
    /* מחיקת כל המשתמשים בשמירה אחת = נעילת כולם בחוץ. לא קורה בעריכה
       לגיטימית — מנהל תמיד שולח את רשימת המשתמשים המלאה. */
    if (activeUserCount(stored) > 0 && activeUserCount(toSave) === 0)
      return { ok: false, error: "users-wipe" };
    saveData(toSave);
    return { ok: true, savedAt: new Date().toISOString(), rev: incomingRev,
      restoredTables: restoredTables };
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

  writeTab("קבצים", ["פרוייקט", "סוג", "תאריך", "שייך ל", "שם הקובץ", "קישור", "הועלה"],
    filesReadableRows(d, aMap));
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
  /* פיצ'רים של מנהלים בלבד — הנתונים לא נשלחים לדפדפן של אחרים */
  d.rentals = []; d.sheets = [];
  /* קטגוריות לפי פרוייקט — הגדרת מנהל. mergeSaveForUser ממילא שומר את
     ההגדרות מהמאגר, כך ששמירה של משתמש כזה לא מוחקת אותן. */
  if (d.settings) {
    delete d.settings.aptCats;      // קטגוריות לפי פרוייקט
    delete d.settings.aptAccs;      // חשבונות לפי פרוייקט
    delete d.settings.aptPayers;    // משלמים לפי פרוייקט
    delete d.settings.contractTpl;  // תבנית סקיצת החוזה
    delete d.settings.landlord;     // פרטי המשכיר
  }
  stripFiles(d);                    // קבצים מצורפים — מנהלים בלבד
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
  /* טבלאות שמוסתרות ממי שאינו מנהל — נשמרות מהמאגר, לא ממה שנשלח */
  result.rentals = stored.rentals || [];
  result.sheets  = stored.sheets  || [];
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
  /* הקבצים המצורפים לא נשלחו אליו — חוזרים מהמאגר, והוא לא יכול להוסיף */
  restoreFiles(stored, result);
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

/* ============================================================
   ✂ סוף הקובץ — אחרי השורה הזאת לא אמור להיות כלום.
   אם בעורך מופיע כאן עוד טקסט (למשל שארית מהקוד הקודם) — למחוק אותו.
   ============================================================ */
