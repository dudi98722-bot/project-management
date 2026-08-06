/**
 * מערכת שידוכים ↔ Google Sheets + Google Drive
 * ---------------------------------------------------------------
 * doGet  ?action=load                        -> כל הנתונים + rev
 * doGet  ?action=files&cid=<id>              -> רשימת הקבצים בתיקיית המועמד
 * doPost action=save&baseRev=<n>&data=...    -> נשמר רק אם baseRev == הגרסה בשרת
 * doPost action=folder&cid&gender&name       -> יוצר/מאתר תיקייה בדרייב למועמד
 * doPost action=upload&cid&gender&name&fname&mime&b64  -> מעלה קובץ לתיקייה
 *
 * הגנה: כל שמירה נושאת את מספר-הגרסה (rev) שהמכשיר טען. אם השרת התקדם
 * מאז — השמירה נדחית (conflict) והמכשיר ממזג ומנסה שוב. בנוסף שמירה
 * לעולם לא מקטינה אוסף לא-ריק (המחיקה במערכת היא רכה).
 *
 * ============ הגדרה חד-פעמית ============
 * 1. פותחים גיליון גוגל חדש (או משאירים ריק כדי שייווצר לבד).
 * 2. תפריט Extensions ← Apps Script, מדביקים את הקובץ הזה.
 * 3. ממלאים למטה SHEET_ID ו-ROOT_FOLDER_ID.
 * 4. Deploy ← New deployment ← Web app
 *    Execute as: Me     |     Who has access: Anyone
 * 5. מעתיקים את הכתובת (מסתיימת ב-/exec) ומדביקים באפליקציה ב"⚙ הגדר שרת".
 */

// מזהה הגיליון. אם משאירים ריק — ייווצר גיליון חדש בשם "מערכת שידוכים".
var SHEET_ID = '';

// תיקיית האב בדרייב שתחתיה ייפתחו תיקיות המועמדים (למשל התיקייה "שידוכים אמא").
// מעתיקים מהכתובת של התיקייה את מה שאחרי /folders/
// אם משאירים ריק — תיווצר תיקייה בשם "שידוכים" בדרייב הראשי.
var ROOT_FOLDER_ID = '';

// טוקן לפעולות ניהול חירום (כתיבה כפויה / שחזור). לא נשלח ללקוח לעולם.
// חשוב: הקובץ הזה יושב בריפו ציבורי — החלף כאן מחרוזת אקראית משלך
// לפני הפריסה, ואל תדחוף את הערך האמיתי ל-GitHub.
var ADMIN_TOKEN = 'שנה-אותי-למחרוזת-אקראית';

var SHEETS = {
  cands: {
    name: 'מועמדים',
    headers: ['id','מס\' כרטיס','מין','משפחה','שם פרטי','תאריך לידה','גיל ידני','מצב משפחתי','טלפון',
      'מס\' ילדים','פרטי ילדים','חסידות','מצב נפשי','תקשורת','עיר מגורים','כתובת','גובה','מבנה','לבוש',
      'שם אבא','עיסוק אבא','שם אמא','עיסוק אמא','מגורי ההורים','מחותנים','הערות מיוחדות','טלפונים לבירורים',
      'שם הגרוש/ה','חסידות הגרוש/ה','עיר הגרוש/ה','שנות נישואים','תאריך גירושים',
      'מחפש/ת גיל','מחפש/ת חסידות','מחפש/ת ערים','מחפש/ת לבוש','תכונות רצויות','יחס לילדים','בקשות מיוחדות',
      'קישור לתיקייה','רזומה','תמונה','סטטוס','דירוג','מקור','תאריך רישום','עודכן','נמחק','תאריך מחיקה'],
    fields:  ['id','seq','gender','family','first','birth','ageManual','marital','phone',
      'kidsCount','kidsDetails','hasidut','mental','comm','city','address','height','build','dress',
      'fatherName','fatherJob','motherName','motherJob','parentsLiving','inlawsTxt','specialNotes','refPhones',
      'exName','exHasidut','exCity','marriageYears','divorceDate',
      'wantAge','wantHasidut','wantCities','wantDress','wantTraits','wantKids','wantSpecial',
      'folderUrl','resumeUrl','photoUrl','status','rating','source','created','updated','deleted','deletedAt']
  },
  matches: {
    name: 'הצעות',
    headers: ['id','מס\'','מזהה בחור','מזהה בת','הבחור','הבת','תאריך הצעה','סטטוס','מי הציע',
      'בירורים','פגישות','המשך טיפול','תאריך המשך','סיבת סגירה','הערות','נוצר','נמחק','תאריך מחיקה'],
    fields:  ['id','seq','manId','womanId','manName','womanName','date','status','proposedBy',
      'inquiries','meetingsTxt','nextStep','nextDate','closeReason','note','created','deleted','deletedAt']
  },
  tasks: {
    name: 'משימות',
    headers: ['id','משימה','תאריך יעד','קשור ל','מזהה קשור','בוצע','הערה','נוצר','נמחק','תאריך מחיקה'],
    fields:  ['id','title','date','relLabel','relId','done','note','created','deleted','deletedAt']
  },
  lists: {
    name: 'רשימות',
    headers: ['id','סוג','ערך','נמחק','תאריך מחיקה'],
    fields:  ['id','type','value','deleted','deletedAt']
  }
};

var NUM_FIELDS  = { seq: 1, deleted: 1, done: 1, rating: 1 };
var DATE_FIELDS = { birth: 1, divorceDate: 1, date: 1, nextDate: 1, created: 1, updated: 1, deletedAt: 1 };

/* ===================== נתב ===================== */

function doGet(e)  { return handle(e); }
function doPost(e) { return handle(e); }

function handle(e) {
  var lock = LockService.getScriptLock();
  try {
    var p = (e && e.parameter) ? e.parameter : {};

    if (p.action === 'load') {
      // אין נעילה על קריאה: הכתיבה אטומית (עדכון-במקום), אז קריאה מקבילה
      // לעולם לא רואה גיליון ריק. נעילה על קריאה גרמה ל-timeout בעומס.
      var out = loadAll();
      out.rev = getRev();
      return json(out);
    }

    if (p.action === 'files') {
      return json(listFiles(p.cid));
    }

    if (p.action === 'folder') {
      var f = ensureCandFolder(p.cid, p.gender, p.name);
      return json({ status: 'ok', id: f.getId(), url: f.getUrl() });
    }

    if (p.action === 'upload') {
      return json(uploadFile(p));
    }

    if (p.action === 'save' || p.p) {
      lock.waitLock(20000);
      var payload = JSON.parse(p.data || p.p || '{}');
      var isAdmin = (p.token && p.token === ADMIN_TOKEN);
      var cur = getRev();

      if (!isAdmin) {
        // 1) בדיקת גרסה — חוסמת מכשיר עם נתונים ישנים (וגם קוד ישן בלי baseRev)
        if (p.baseRev === undefined || p.baseRev === '' || Number(p.baseRev) !== cur) {
          return json({ status: 'conflict', rev: cur, message: 'הנתונים בשרת עודכנו בינתיים — מרענן וממזג' });
        }
        // 2) שכבת גיבוי: שמירה לא מקטינה אוסף לא-ריק (המחיקה במערכת רכה)
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

      saveAllAtomic(payload);
      return json({ status: 'ok', rev: bumpRev() });
    }

    return json({ status: 'idle' });
  } catch (err) {
    return json({ status: 'error', message: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

/* ===================== גיליון ===================== */

function props() { return PropertiesService.getScriptProperties(); }
function getRev() { var v = props().getProperty('shd_rev'); return v ? Number(v) : 0; }
function bumpRev() { var r = getRev() + 1; props().setProperty('shd_rev', String(r)); return r; }

function ss() { return getSpreadsheet(); }
function getSpreadsheet() {
  if (SHEET_ID) return SpreadsheetApp.openById(SHEET_ID);
  var saved = props().getProperty('shd_sheet_id');
  if (saved) { try { return SpreadsheetApp.openById(saved); } catch (e) {} }
  var s = SpreadsheetApp.create('מערכת שידוכים');
  props().setProperty('shd_sheet_id', s.getId());
  return s;
}

function getSheet(cfg) {
  var s = ss().getSheetByName(cfg.name);
  if (!s) s = ss().insertSheet(cfg.name);
  if (s.getLastRow() === 0) {
    s.appendRow(cfg.headers);
    s.getRange(1, 1, 1, cfg.headers.length).setFontWeight('bold').setBackground('#f6ecf1');
    s.setFrozenRows(1);
  } else {
    var cur = s.getRange(1, 1, 1, cfg.headers.length).getValues()[0];
    for (var i = 0; i < cfg.headers.length; i++) {
      if (String(cur[i]) !== cfg.headers[i]) {
        s.getRange(1, 1, 1, cfg.headers.length).setValues([cfg.headers]).setFontWeight('bold').setBackground('#f6ecf1');
        s.setFrozenRows(1);
        break;
      }
    }
  }
  return s;
}

function loadAll() {
  var out = { cands: [], matches: [], tasks: [], lists: [], seq: 1, mseq: 1 };
  Object.keys(SHEETS).forEach(function (key) {
    var cfg = SHEETS[key], s = getSheet(cfg), last = s.getLastRow();
    if (last < 2) return;
    s.getRange(2, 1, last - 1, cfg.fields.length).getValues().forEach(function (row) {
      if (String(row[0]) === '') return;
      var obj = {};
      cfg.fields.forEach(function (f, i) {
        var v = row[i];
        if (NUM_FIELDS[f]) v = Number(v) || 0;
        else if (DATE_FIELDS[f]) v = fmtDate(v);
        else v = (v === null || v === undefined) ? '' : String(v);
        obj[f] = v;
      });
      out[key].push(obj);
    });
  });
  var sp = props().getProperty('shd_seq');
  var mp = props().getProperty('shd_mseq');
  out.seq  = sp ? Number(sp) : (out.cands.length + 1);
  out.mseq = mp ? Number(mp) : (out.matches.length + 1);
  return out;
}

// כתיבה אטומית: מעדכנים שורות במקום ומנקים רק את הזנב — אין רגע שהגיליון ריק.
function saveAllAtomic(data) {
  Object.keys(SHEETS).forEach(function (key) {
    var cfg = SHEETS[key], s = getSheet(cfg), lastRow = s.getLastRow();
    var arr = data[key] || [];
    var rows = arr.map(function (item) {
      return cfg.fields.map(function (f) {
        var v = item[f];
        if (v === undefined || v === null) v = '';
        if (typeof v === 'string') {
          if (v.length > 45000) v = v.slice(0, 45000);   // תא מוגבל ל-50K תווים
          if (v.charAt(0) === '=') v = "'" + v;           // לא לתת לטקסט להפוך לנוסחה
        }
        return v;
      });
    });
    if (rows.length) s.getRange(2, 1, rows.length, cfg.fields.length).setValues(rows);
    var extra = lastRow - (rows.length + 1);
    if (extra > 0) s.getRange(rows.length + 2, 1, extra, cfg.headers.length).clearContent();
  });
  ['seq', 'mseq'].forEach(function (k) {
    if (!data[k]) return;
    var key = 'shd_' + k;
    var cur = Number(props().getProperty(key) || 0);
    if (Number(data[k]) > cur) props().setProperty(key, String(data[k]));
  });
}

function fmtDate(v) {
  if (v instanceof Date) {
    var y = v.getFullYear(),
        m = ('0' + (v.getMonth() + 1)).slice(-2),
        d = ('0' + v.getDate()).slice(-2);
    return y + '-' + m + '-' + d;
  }
  return (v === null || v === undefined) ? '' : String(v);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ===================== דרייב — תיקייה לכל מועמד ===================== */

function getRootFolder() {
  if (ROOT_FOLDER_ID) {
    try { return DriveApp.getFolderById(ROOT_FOLDER_ID); }
    catch (e) { throw new Error('תיקיית האב לא נמצאה — בדוק את ROOT_FOLDER_ID'); }
  }
  var saved = props().getProperty('shd_root_folder');
  if (saved) { try { return DriveApp.getFolderById(saved); } catch (e) {} }
  var f = DriveApp.createFolder('שידוכים');
  props().setProperty('shd_root_folder', f.getId());
  return f;
}

function childFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

// מאתר את תיקיית המועמד לפי המזהה שלו (נשמר ב-ScriptProperties),
// ואם השם השתנה — משנה גם את שם התיקייה. אין כפילויות.
function ensureCandFolder(cid, gender, name) {
  if (!cid) throw new Error('חסר מזהה מועמד');
  var clean = String(name || cid).replace(/[\\\/:*?"<>|]/g, ' ').trim() || String(cid);
  var key = 'shd_fld_' + cid;
  var saved = props().getProperty(key);
  if (saved) {
    try {
      var f = DriveApp.getFolderById(saved);
      if (!f.isTrashed()) {
        if (f.getName() !== clean) f.setName(clean);
        return f;
      }
    } catch (e) { /* נמחקה — ניצור מחדש */ }
  }
  var side = childFolder(getRootFolder(), gender === 'w' ? 'נשים' : 'גברים');
  var folder = childFolder(side, clean);
  props().setProperty(key, folder.getId());
  return folder;
}

function uploadFile(p) {
  if (!p.b64) return { status: 'error', message: 'אין תוכן קובץ' };
  var folder = ensureCandFolder(p.cid, p.gender, p.name);
  var blob = Utilities.newBlob(Utilities.base64Decode(p.b64), p.mime || 'application/octet-stream', p.fname || 'file');
  var file = folder.createFile(blob);
  return { status: 'ok', name: file.getName(), url: file.getUrl(), folderUrl: folder.getUrl() };
}

function listFiles(cid) {
  if (!cid) return { status: 'error', message: 'חסר מזהה' };
  var saved = props().getProperty('shd_fld_' + cid);
  if (!saved) return { status: 'error', message: 'אין עדיין תיקייה' };
  var folder;
  try { folder = DriveApp.getFolderById(saved); }
  catch (e) { return { status: 'error', message: 'התיקייה לא נמצאה' }; }
  var out = [], it = folder.getFiles(), n = 0;
  while (it.hasNext() && n < 200) {
    var f = it.next(); n++;
    out.push({ name: f.getName(), url: f.getUrl(), size: f.getSize(), mime: f.getMimeType() });
  }
  out.sort(function (a, b) { return a.name.localeCompare(b.name, 'he'); });
  return { status: 'ok', files: out, folderUrl: folder.getUrl() };
}
