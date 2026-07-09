/**
 * ניהול מזוזות ↔ Google Sheets  —  גרסה מוגנת (revision-based)
 * ------------------------------------------------------------
 * doGet  ?action=load                      -> מחזיר את כל הנתונים + rev
 * doPost action=save&baseRev=<n>&data=...   -> נשמר רק אם baseRev == הגרסה הנוכחית
 *
 * הגנה קריטית: כל שמירה חייבת לשאת את מספר-הגרסה (rev) שהמכשיר טען.
 * אם השרת התקדם מאז (מכשיר אחר שמר, או שהמכשיר מחזיק עותק ישן) — השמירה
 * נדחית (status:conflict) והמכשיר חייב לרענן. זה חוסם לחלוטין דריסה ע"י
 * מכשיר עם נתונים ישנים, כולל מכשירים עם גרסת קוד ישנה (שלא שולחים baseRev).
 */

var SHEET_ID = '1Rm7_Kl01QQN63uZM4bS-qDxJIFhcuzXt8au8gWZLdM8';
// טוקן סודי לפעולות ניהול (שחזור/כתיבה כפויה). לא נשלח ללקוח לעולם.
var ADMIN_TOKEN = 'mzx_r3store_9f3k2p7q_2026';

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
  mezuzot:  { name: 'מזוזות', headers: ['id','מק"ט','סופר','מוצר','תאריך','מחיר ליחי','הגהת מחשב','גברא 1','גברא 2','אישור הרב','מחיר מופחת','לקוח (כשר)','מחיר מכירה','הולוגרמה בד"ץ','נשלח לכתר','תמונה','נמחק','תאריך מחיקה'], fields: ['id','sku','scribe','product','date','price','comp','g1','g2','approve','adj','buyer','salePrice','holo','keter','img','deleted','deletedAt'] },
  payments: { name: 'תשלומים', headers: ['id','שם','תאריך','סכום','הערה','נמחק','תאריך מחיקה'], fields: ['id','name','date','amount','note','deleted','deletedAt'] },
  expenses: { name: 'הוצאות', headers: ['id','תאריך','קטגוריה','סכום','הערה','נמחק','תאריך מחיקה'], fields: ['id','date','category','amount','note','deleted','deletedAt'] },
  income:   { name: 'הכנסות', headers: ['id','תאריך','מקור','סכום','הערה','נמחק','תאריך מחיקה'], fields: ['id','date','source','amount','note','deleted','deletedAt'] },
  keterReceipts: { name: 'תקבולים מכתר', headers: ['id','תאריך','סכום','הערה','נמחק','תאריך מחיקה'], fields: ['id','date','amount','note','deleted','deletedAt'] },
  customerReceipts: { name: 'תקבולים מלקוחות', headers: ['id','תאריך','לקוח','סכום','הערה','נמחק','תאריך מחיקה'], fields: ['id','date','customer','amount','note','deleted','deletedAt'] },
  users:    { name: 'משתמשים', headers: ['id','שם','תפקיד','סיסמה מוצפנת','נמחק','תאריך מחיקה'], fields: ['id','name','role','hash','deleted','deletedAt'] }
};

var TEXT_FIELDS = { sku:1, holo:1, name:1, scribe:1, product:1, comp:1, g1:1, g2:1, approve:1, keter:1, note:1, date:1, img:1, role:1, hash:1, category:1, source:1, grade:1, buyer:1, customer:1, deletedAt:1 };
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

      saveAllAtomic(payload);
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
function saveAllAtomic(data) {
  Object.keys(SHEETS).forEach(function (key) {
    var cfg = SHEETS[key], s = getSheet(cfg), lastRow = s.getLastRow();
    var arr = data[key] || [];
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
