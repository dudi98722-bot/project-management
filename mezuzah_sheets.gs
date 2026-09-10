/**
 * ניהול מזוזות ↔ Google Sheets  —  גרסה מוגנת (revision-based)
 * ------------------------------------------------------------
 * doGet  ?action=load                         -> מחזיר את כל הנתונים + rev
 * doPost action=save&baseRev=<n>&data=...      -> נשמר רק אם baseRev == הגרסה הנוכחית
 * doPost action=uploadImg&id=&sku=&data=...    -> שומר תמונת מזוזה באיכות מלאה בדרייב, מחזיר fileId
 * doGet  ?action=img&file=<fileId>             -> מחזיר תמונה מתיקיית התמונות של המערכת (base64)
 *
 * הגנה קריטית: כל שמירה חייבת לשאת את מספר-הגרסה (rev) שהמכשיר טען.
 * אם השרת התקדם מאז (מכשיר אחר שמר, או שהמכשיר מחזיק עותק ישן) — השמירה
 * נדחית (status:conflict) והמכשיר חייב לרענן. זה חוסם לחלוטין דריסה ע"י
 * מכשיר עם נתונים ישנים, כולל מכשירים עם גרסת קוד ישנה (שלא שולחים baseRev).
 *
 * תמונות: התמונה המלאה נשמרת בתיקייה "תמונות מזוזות" בדרייב. בגיליון נשמרות רק
 * תמונה ממוזערת (img) ומזהה הקובץ (imgFile). שמירה רגילה מחליפה תמונה שמורה רק
 * כשהיא מביאה קובץ חדש יותר מתיקיית התמונות — כך מכשיר עם עותק ישן, או מכשיר
 * שקיבל את התמונה משובשת בדרך, לא דורס את התמונה האמיתית.
 *
 * ⚠ לפני פריסת גרסה חדשה של הקובץ הזה: להריץ פעם אחת מתוך העורך את הפונקציה
 *   authorizeDrive ולאשר את הגישה לדרייב. רק אחר כך: פריסה ← ניהול פריסות ← גרסה חדשה.
 */

var SHEET_ID = '1Rm7_Kl01QQN63uZM4bS-qDxJIFhcuzXt8au8gWZLdM8';
// טוקן סודי לפעולות ניהול (שחזור/כתיבה כפויה). לא נשלח ללקוח לעולם.
var ADMIN_TOKEN = 'mzx_r3store_9f3k2p7q_2026';

var IMG_FOLDER_NAME = 'תמונות מזוזות';
var IMG_MAX_B64 = 4 * 1024 * 1024;   // ~3MB תמונה — הרבה מעבר לתמונה של 2400 פיקסלים
var IMG_DAILY_LIMIT = 300;           // מקסימום העלאות תמונה ביום — חסם נגד מילוי הדרייב

function getRev() { var p = PropertiesService.getScriptProperties().getProperty('mz_rev'); return p ? Number(p) : 0; }
function bumpRev() { var r = getRev() + 1; PropertiesService.getScriptProperties().setProperty('mz_rev', String(r)); return r; }

function getSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  if (SHEET_ID) return SpreadsheetApp.openById(SHEET_ID);
  var saved = props.getProperty('mz_sheet_id');
  if (saved) { try { return SpreadsheetApp.openById(saved); } catch (e) {} }
  var ss = SpreadsheetApp.create('ניהול מזוזות');
  props.setProperty('mz_sheet_id', ss.getId());
  return ss;
}

var SHEETS = {
  scribes:  { name: 'סופרים', headers: ['id','שם הסופר','דרגה','מחיר בית יוסף','מחיר ארי','לכתר - בית יוסף','לכתר - ארי','נמחק','תאריך מחיקה'], fields: ['id','name','grade','by','ari','kby','kari','deleted','deletedAt'] },
  computer: { name: 'מגיהי מחשב', headers: ['id','שם המגיה','מחיר ליחי','נמחק','תאריך מחיקה'], fields: ['id','name','price','deleted','deletedAt'] },
  gavra:    { name: 'מגיהי גברא', headers: ['id','שם המגיה','מחיר ליחי','נמחק','תאריך מחיקה'], fields: ['id','name','price','deleted','deletedAt'] },
  // imgFile נוסף בסוף הרשימה בכוונה: עמודה חדשה באמצע הייתה מזיזה את הנתונים הקיימים
  mezuzot:  { name: 'מזוזות', headers: ['id','מק"ט','סופר','מוצר','תאריך','מחיר ליחי','הגהת מחשב','גברא 1','גברא 2','אישור הרב','מחיר מופחת','לקוח (כשר)','מחיר מכירה','הולוגרמה בד"ץ','נשלח לכתר','תמונה','נמחק','תאריך מחיקה','קובץ תמונה בדרייב'], fields: ['id','sku','scribe','product','date','price','comp','g1','g2','approve','adj','buyer','salePrice','holo','keter','img','deleted','deletedAt','imgFile'] },
  payments: { name: 'תשלומים', headers: ['id','שם','תאריך','סכום','הערה','נמחק','תאריך מחיקה'], fields: ['id','name','date','amount','note','deleted','deletedAt'] },
  expenses: { name: 'הוצאות', headers: ['id','תאריך','קטגוריה','סכום','הערה','נמחק','תאריך מחיקה'], fields: ['id','date','category','amount','note','deleted','deletedAt'] },
  income:   { name: 'הכנסות', headers: ['id','תאריך','מקור','סכום','הערה','נמחק','תאריך מחיקה'], fields: ['id','date','source','amount','note','deleted','deletedAt'] },
  keterReceipts: { name: 'תקבולים מכתר', headers: ['id','תאריך','סכום','הערה','נמחק','תאריך מחיקה'], fields: ['id','date','amount','note','deleted','deletedAt'] },
  customerReceipts: { name: 'תקבולים מלקוחות', headers: ['id','תאריך','לקוח','סכום','הערה','נמחק','תאריך מחיקה'], fields: ['id','date','customer','amount','note','deleted','deletedAt'] },
  users:    { name: 'משתמשים', headers: ['id','שם','תפקיד','סיסמה מוצפנת','נמחק','תאריך מחיקה'], fields: ['id','name','role','hash','deleted','deletedAt'] }
};

var TEXT_FIELDS = { sku:1, holo:1, name:1, scribe:1, product:1, comp:1, g1:1, g2:1, approve:1, keter:1, note:1, date:1, img:1, imgFile:1, role:1, hash:1, category:1, source:1, grade:1, buyer:1, customer:1, deletedAt:1 };
var NUM_FIELDS  = { by:1, ari:1, price:1, adj:1, amount:1, kby:1, kari:1, salePrice:1, deleted:1 };

function doGet(e)  { return handle(e); }
function doPost(e) { return handle(e); }

function handle(e) {
  var lock = LockService.getScriptLock();
  try {
    var p = (e && e.parameter) ? e.parameter : {};

    if (p.action === 'load') {
      // אין נעילה על קריאה: הכתיבה אטומית (עדכון-במקום ללא רגע ריק), אז קריאה
      // מקבילה לעולם לא רואה גיליון ריק. נעילה על קריאה גרמה ל-timeout בעומס.
      var out = loadAll();
      out.rev = getRev();
      return json(out);
    }

    // תמונות: לא נוגעות בגיליון ולא בגרסה — אין צורך בנעילה
    if (p.action === 'img') return json(readImage(p.file));
    if (p.action === 'uploadImg') return json(uploadImage(p));

    if (p.action === 'save' || p.p) {
      lock.waitLock(20000);
      var payload = JSON.parse(p.data || p.p || '{}');
      var isAdmin = (p.token && p.token === ADMIN_TOKEN);
      var cur = getRev();

      if (!isAdmin) {
        // 1) בדיקת גרסה — חוסמת מכשירים עם נתונים ישנים ומכשירים עם קוד ישן (בלי baseRev)
        if (p.baseRev === undefined || p.baseRev === '' || Number(p.baseRev) !== cur) {
          return json({ status: 'conflict', rev: cur, message: 'הנתונים בשרת עודכנו בינתיים — רענן את הדף ונסה שוב' });
        }
        // 2) שכבת גיבוי: שמירה לעולם לא מקטינה אוסף לא-ריק (בזכות מחיקה רכה)
        var blocked = [];
        Object.keys(SHEETS).forEach(function (key) {
          var s = ss().getSheetByName(SHEETS[key].name); if (!s) return;
          var existing = Math.max(0, s.getLastRow() - 1);
          var incoming = (payload[key] || []).length;
          if (existing > 0 && incoming < existing) blocked.push(SHEETS[key].name + ' (' + incoming + '<' + existing + ')');
        });
        if (blocked.length) {
          return json({ status: 'error', message: 'השמירה נחסמה — ניסיון להקטין נתונים: ' + blocked.join(' | ') });
        }
      }

      saveAllAtomic(payload, isAdmin);
      var newRev = bumpRev();
      return json({ status: 'ok', rev: newRev });
    }

    return json({ status: 'idle' });
  } catch (err) {
    return json({ status: 'error', message: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function ss() { return getSpreadsheet(); }

function getSheet(cfg) {
  var s = ss().getSheetByName(cfg.name);
  if (!s) s = ss().insertSheet(cfg.name);
  // לוודא שיש מספיק עמודות בגיליון לכל השדות (למשל אחרי הוספת imgFile)
  if (s.getMaxColumns() < cfg.headers.length) s.insertColumnsAfter(s.getMaxColumns(), cfg.headers.length - s.getMaxColumns());
  if (s.getLastRow() === 0) {
    s.appendRow(cfg.headers);
    s.getRange(1, 1, 1, cfg.headers.length).setFontWeight('bold').setBackground('#edf2f7');
    s.setFrozenRows(1);
  } else {
    var cur = s.getRange(1, 1, 1, cfg.headers.length).getValues()[0];
    for (var i = 0; i < cfg.headers.length; i++) {
      if (String(cur[i]) !== cfg.headers[i]) {
        s.getRange(1, 1, 1, cfg.headers.length).setValues([cfg.headers]).setFontWeight('bold').setBackground('#edf2f7');
        s.setFrozenRows(1);
        break;
      }
    }
  }
  return s;
}

function loadAll() {
  var out = { scribes: [], computer: [], gavra: [], mezuzot: [], payments: [], expenses: [], income: [], keterReceipts: [], customerReceipts: [], users: [], seq: 1 };
  Object.keys(SHEETS).forEach(function (key) {
    var cfg = SHEETS[key], s = getSheet(cfg), last = s.getLastRow();
    if (last < 2) return;
    s.getRange(2, 1, last - 1, cfg.fields.length).getValues().forEach(function (row) {
      if (String(row[0]) === '') return;
      var obj = {};
      cfg.fields.forEach(function (f, i) {
        var v = row[i];
        if (NUM_FIELDS[f]) v = Number(v) || 0;
        else if (f === 'date') v = fmtDate(v);
        else if (TEXT_FIELDS[f]) v = (v === null || v === undefined) ? '' : String(v);
        obj[f] = v;
      });
      out[key].push(obj);
    });
  });
  var sp = PropertiesService.getScriptProperties().getProperty('mz_seq');
  out.seq = sp ? Number(sp) : (out.mezuzot.length + 1);
  return out;
}

// כתיבה אטומית: מעדכנים את השורות במקום ומנקים רק את "הזנב" — אין רגע שבו הגיליון ריק.
function saveAllAtomic(data, isAdmin) {
  Object.keys(SHEETS).forEach(function (key) {
    var cfg = SHEETS[key], s = getSheet(cfg), lastRow = s.getLastRow();
    var arr = data[key] || [];
    if (key === 'mezuzot' && !isAdmin) arr = keepStoredImages(s, cfg, lastRow, arr);
    var rows = arr.map(function (item) {
      return cfg.fields.map(function (f) {
        var v = item[f];
        if (v === undefined || v === null) v = '';
        if (typeof v === 'string' && v.length > 45000) v = '';   // תא מוגבל ל-50K תווים
        return v;
      });
    });
    if (rows.length) s.getRange(2, 1, rows.length, cfg.fields.length).setValues(rows);
    var extra = lastRow - (rows.length + 1);
    if (extra > 0) s.getRange(rows.length + 2, 1, extra, cfg.headers.length).clearContent();
  });
  if (data.seq) {
    var cur = Number(PropertiesService.getScriptProperties().getProperty('mz_seq') || 0);
    if (Number(data.seq) > cur) PropertiesService.getScriptProperties().setProperty('mz_seq', String(data.seq));
  }
}

// הגנה על תמונות: תמונה שמורה מוחלפת רק כשהמכשיר מביא קובץ חדש יותר מתיקיית התמונות.
// אחרת נשארים התמונה ומזהה הקובץ שבגיליון — כך מכשיר עם עותק ישן של הרשומה,
// או מכשיר שקיבל את התמונה משובשת בדרך, לא דורס תמונה אמיתית או העלאה חדשה.
function keepStoredImages(s, cfg, lastRow, arr) {
  if (lastRow < 2) return arr;
  var idI = cfg.fields.indexOf('id'), imgI = cfg.fields.indexOf('img'), fileI = cfg.fields.indexOf('imgFile');
  var stored = {};
  s.getRange(2, 1, lastRow - 1, cfg.fields.length).getValues().forEach(function (r) {
    var id = String(r[idI]);
    if (id) stored[id] = { img: String(r[imgI] || ''), file: String(r[fileI] || '') };
  });
  return arr.map(function (item) {
    var st = stored[String(item.id)];
    if (!st) return item;                                            // מזוזה חדשה
    var inFile = String(item.imgFile || '');
    if (inFile !== st.file) {
      if (inFile && isNewerImageFile(inFile, st.file)) return item;  // העלאה חדשה אמיתית
      return withStoredImage(item, st);                              // מזהה ישן, ריק או לא תקין
    }
    if (!st.img || item.img === st.img) return item;                 // אין תמונה שמורה, או שלא השתנתה
    return withStoredImage(item, st);
  });
}

function withStoredImage(item, st) {
  var copy = {};
  for (var k in item) copy[k] = item[k];
  copy.img = st.img;
  copy.imgFile = st.file;
  return copy;
}

function isNewerImageFile(fileId, thanFileId) {
  var f;
  try { f = DriveApp.getFileById(fileId); } catch (x) { return false; }
  if (!inImgFolder(f)) return false;
  if (!thanFileId) return true;
  try { return f.getDateCreated().getTime() > DriveApp.getFileById(thanFileId).getDateCreated().getTime(); }
  catch (x) { return true; }   // הקובץ הקודם כבר לא קיים
}

// ---------- תמונות בדרייב ----------
function getImgFolder() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('mz_img_folder');
  if (id) {
    try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (x) {}
  }
  var folder = null, it = DriveApp.getFoldersByName(IMG_FOLDER_NAME);
  while (it.hasNext()) { var c = it.next(); if (!c.isTrashed()) { folder = c; break; } }   // לא להשתמש בתיקייה שבאשפה
  if (!folder) folder = DriveApp.createFolder(IMG_FOLDER_NAME);
  props.setProperty('mz_img_folder', folder.getId());
  return folder;
}

function inImgFolder(file) {
  var folderId = getImgFolder().getId(), parents = file.getParents();
  while (parents.hasNext()) { if (parents.next().getId() === folderId) return true; }
  return false;
}

// להרצה ידנית פעם אחת מתוך העורך, לפני פריסת הגרסה: מאשר גישה לדרייב ויוצר את התיקייה
function authorizeDrive() {
  var f = getImgFolder();
  Logger.log('תיקיית התמונות מוכנה: ' + f.getName() + ' — ' + f.getUrl());
}

function takeDailyUploadSlot() {
  var props = PropertiesService.getScriptProperties();
  var day = Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyyMMdd');
  var cur = String(props.getProperty('mz_img_day') || '').split(':');
  var count = cur[0] === day ? (Number(cur[1]) || 0) : 0;
  if (count >= IMG_DAILY_LIMIT) return false;
  props.setProperty('mz_img_day', day + ':' + (count + 1));
  return true;
}

function uploadImage(p) {
  if (!p.id) return { status: 'error', message: 'חסר מזהה מזוזה' };
  var b64 = String(p.data || '');
  var comma = b64.indexOf(',');
  if (b64.slice(0, 5) === 'data:' && comma > 0) b64 = b64.slice(comma + 1);   // אם נשלח עם הקידומת
  b64 = b64.replace(/ /g, '+').replace(/\s/g, '');
  while (b64.length % 4) b64 += '=';
  if (!b64) return { status: 'error', message: 'לא התקבלה תמונה' };
  if (b64.length > IMG_MAX_B64) return { status: 'error', message: 'התמונה גדולה מדי' };
  var bytes = Utilities.base64Decode(b64), n = bytes.length;
  // JPEG שלם בלבד: מתחיל ב-FF D8 ומסתיים ב-FF D9 (מזהה גם העלאה שנקטעה באמצע)
  if (n < 4 || (bytes[0] & 0xFF) !== 0xFF || (bytes[1] & 0xFF) !== 0xD8 ||
      (bytes[n - 2] & 0xFF) !== 0xFF || (bytes[n - 1] & 0xFF) !== 0xD9) {
    return { status: 'error', message: 'פורמט תמונה לא נתמך' };
  }
  if (!takeDailyUploadSlot()) return { status: 'error', message: 'הגעת למכסת העלאות התמונה היומית' };
  var sku = String(p.sku || '').replace(/[^A-Za-z0-9א-ת_-]/g, '');
  var name = (sku || 'mezuza') + '_' + String(p.id).replace(/[^A-Za-z0-9_-]/g, '') + '_' +
             Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyyMMdd-HHmmss') + '.jpg';
  var file = getImgFolder().createFile(Utilities.newBlob(bytes, 'image/jpeg', name));
  return { status: 'ok', fileId: file.getId() };
}

function readImage(fileId) {
  if (!fileId) return { status: 'error', message: 'חסר מזהה קובץ' };
  var file;
  try { file = DriveApp.getFileById(String(fileId)); } catch (x) { return { status: 'error', message: 'הקובץ לא נמצא' }; }
  // אבטחה: מגישים רק קבצים שנמצאים בתיקיית התמונות של המערכת
  if (!inImgFolder(file)) return { status: 'error', message: 'אין גישה לקובץ' };
  var blob = file.getBlob();
  return { status: 'ok', mime: blob.getContentType() || 'image/jpeg', data: Utilities.base64Encode(blob.getBytes()) };
}

function fmtDate(v) {
  if (v instanceof Date) {
    var y = v.getFullYear(), m = ('0' + (v.getMonth() + 1)).slice(-2), d = ('0' + v.getDate()).slice(-2);
    return y + '-' + m + '-' + d;
  }
  return v ? String(v) : '';
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
