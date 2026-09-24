/* =====================================================================
   BERRI — קריאת קובץ אקסל בדפדפן, בלי ספריות חיצוניות.
   קובץ xlsx הוא ZIP של קובצי XML. הפתיחה נעשית עם DecompressionStream
   שקיים בדפדפנים מודרניים; בדפדפן ישן נופלים להדבקה או ל-CSV.
   מחזיר { headers:[...], rows:[[...]] } מהגיליון הראשון.
   ===================================================================== */
'use strict';

function canReadXlsx() { return typeof DecompressionStream === 'function'; }

function inflateRaw(bytes) {
  var ds = new DecompressionStream('deflate-raw');
  return new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer()
    .then(function (b) { return new Uint8Array(b); });
}

/* קורא את הספרייה המרכזית של ה-ZIP ומחזיר { שם: Uint8Array } */
function unzip(b) {
  var dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  var eocd = b.length - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('הקובץ אינו קובץ אקסל תקין');
  var n = dv.getUint16(eocd + 10, true), off = dv.getUint32(eocd + 16, true);
  var jobs = [], out = {};
  for (var i = 0; i < n; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    var nameLen = dv.getUint16(off + 28, true), extraLen = dv.getUint16(off + 30, true),
        cmtLen = dv.getUint16(off + 32, true), lho = dv.getUint32(off + 42, true);
    var name = new TextDecoder('utf-8').decode(b.subarray(off + 46, off + 46 + nameLen));
    var method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
    var lNameLen = dv.getUint16(lho + 26, true), lExtraLen = dv.getUint16(lho + 28, true);
    var start = lho + 30 + lNameLen + lExtraLen;
    var raw = b.subarray(start, start + csize);
    jobs.push({ name: name, method: method, raw: raw });
    off += 46 + nameLen + extraLen + cmtLen;
  }
  return Promise.all(jobs.map(function (j) {
    if (j.method === 0) { out[j.name] = j.raw; return null; }
    return inflateRaw(j.raw).then(function (d) { out[j.name] = d; });
  })).then(function () { return out; });
}

function xtext(u8) { return u8 ? new TextDecoder('utf-8').decode(u8) : ''; }
function xunesc(s) {
  return String(s).replace(/&#x([0-9a-f]+);/gi, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(+d); })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
/* כל <t> בתוך <si> מצטרף למחרוזת אחת — טקסט מעוצב מפוצל לכמה <t>.
   <rPh> הוא הגייה נלווית (יפנית) ולא חלק מהתא — מסירים אותו */
function sharedStrings(xml) {
  if (!xml) return [];
  return (xml.match(/<si\b[^>]*>[\s\S]*?<\/si>|<si\b[^>]*\/>/g) || []).map(function (si) {
    si = si.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    var t = '';
    var re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, m;
    while ((m = re.exec(si))) t += xunesc(m[1]);
    return t;
  });
}
/* אילו סגנונות הם תאריך — כדי לא להחזיר 46000 במקום 24/09/2026 */
function dateStyles(xml) {
  var out = {};
  if (!xml) return out;
  var custom = {};
  var re = /<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g, m;
  while ((m = re.exec(xml))) {
    if (/[dmyh]/i.test(xunesc(m[2]).replace(/\[[^\]]*\]|"[^"]*"/g, ''))) custom[m[1]] = 1;
  }
  var body = (xml.match(/<cellXfs[\s\S]*?<\/cellXfs>/) || [''])[0];
  var xfs = body.match(/<xf[^>]*\/?>/g) || [];
  xfs.forEach(function (xf, i) {
    var id = (xf.match(/numFmtId="(\d+)"/) || [])[1];
    if (!id) return;
    var n = +id;
    if ((n >= 14 && n <= 22) || (n >= 45 && n <= 47) || custom[id]) out[i] = 1;
  });
  return out;
}
function colIdx(ref) {
  var s = String(ref).match(/^[A-Z]+/);
  if (!s) return 0;
  var n = 0;
  for (var i = 0; i < s[0].length; i++) n = n * 26 + (s[0].charCodeAt(i) - 64);
  return n - 1;
}
/* מספר סידורי של אקסל -> yyyy-mm-dd. ברירת המחדל: 1899-12-30 הוא היום ה-0.
   קבצי מק ישנים (date1904) סופרים מ-1904-01-01 — אחרת התאריך יוצא 4 שנים מוקדם */
function serialToISO(n, d1904) {
  n = Math.floor(Number(n));
  if (!isFinite(n) || n < 1 || n > 80000) return null;
  var d = new Date((d1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)) + n * 86400000);
  var p = function (x) { return ('0' + x).slice(-2); };
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}

/* תגית שנסגרת בעצמה (<c r="B2" s="1"/>) היא תא ריק. ביטוי שבולע את ה-"/"
   היה מדלג לתא הבא ומעביר סכומים לעמודה הלא נכונה — לכן [^>/] ולא [^>] */
var TAG_ATTRS = '((?:[^>\\/]|\\/(?!>))*)';
function parseSheet(xml, shared, dstyles, d1904) {
  var rows = [], width = 0;
  var rowRe = new RegExp('<row\\b' + TAG_ATTRS + '(?:\\/>|>([\\s\\S]*?)<\\/row>)', 'g'), rm;
  while ((rm = rowRe.exec(xml))) {
    var body = rm[2] || '', cells = [], next = 0;
    var cRe = new RegExp('<c\\b' + TAG_ATTRS + '(?:\\/>|>([\\s\\S]*?)<\\/c>)', 'g'), cm;
    while ((cm = cRe.exec(body))) {
      var attrs = cm[1], inner = cm[2] || '';
      var ref = (attrs.match(/\br="([A-Z]+)\d+"/) || [])[1];
      var idx = ref ? colIdx(ref) : next;          // תא בלי r= — העמודה שאחרי הקודם
      next = idx + 1;
      var t = (attrs.match(/t="([^"]+)"/) || [])[1] || 'n';
      var s = (attrs.match(/s="(\d+)"/) || [])[1];
      var v = '';
      if (t === 'inlineStr') {
        var re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, im;
        while ((im = re.exec(inner))) v += xunesc(im[1]);
      } else {
        var raw = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (raw != null) {
          raw = xunesc(raw);
          if (t === 's') v = shared[+raw] != null ? shared[+raw] : '';
          else if (t === 'b') v = raw === '1' ? 'TRUE' : 'FALSE';
          else if (s != null && dstyles[+s] && /^\d+(\.\d+)?$/.test(raw)) v = serialToISO(raw, d1904) || raw;
          else v = raw;
        }
      }
      cells[idx] = v;
      if (idx + 1 > width) width = idx + 1;
    }
    rows.push(cells);
  }
  return rows.map(function (r) {
    var o = [];
    for (var i = 0; i < width; i++) o.push(r[i] == null ? '' : String(r[i]));
    return o;
  });
}

function readXlsxFile(file) {
  return file.arrayBuffer().then(function (ab) { return unzip(new Uint8Array(ab)); }).then(function (z) {
    /* חלק מהתוכנות כותבות <x:sheet> במקום <sheet> — מסירים את הקידומת */
    var x = function (name) { return xtext(z[name]).replace(/<(\/?)[A-Za-z][\w.-]*:(?=[A-Za-z])/g, '<$1'); };
    var wb = x('xl/workbook.xml'), rels = x('xl/_rels/workbook.xml.rels');
    var d1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(wb);
    var first = (wb.match(/<sheet\b[^>]*\/?>/) || [''])[0];         // \b: לא לתפוס את <sheets>
    var rid = (first.match(/\bid="([^"]+)"/) || [])[1];
    var target = rid && (rels.match(new RegExp('Id="' + rid + '"[^>]*Target="([^"]+)"')) || [])[1];
    var path = target ? ('xl/' + String(target).replace(/^\/?xl\//, '').replace(/^\//, '')) : 'xl/worksheets/sheet1.xml';
    var sheetName = z[path] ? path : 'xl/worksheets/sheet1.xml';
    if (!z[sheetName]) throw new Error('לא נמצא גיליון בקובץ');
    return parseSheet(x(sheetName), sharedStrings(x('xl/sharedStrings.xml')), dateStyles(x('xl/styles.xml')), d1904);
  });
}

/* CSV / הדבקה מאקסל. מפריד: טאב (הדבקה), אחרת פסיק או נקודה-פסיק — מה
   שמופיע יותר בשורה הראשונה (אקסל באזורים מסוימים שומר עם ";").
   מרכאות פותחות "שדה מצוטט" רק בתחילת התא: הגרשיים ב-בע"מ / מע"מ / סה"כ
   הם חלק מהטקסט, ואם היו פותחים ציטוט הם היו בולעים את השורות שאחריהם. */
function parseDelimited(text) {
  text = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  var head = text.split('\n')[0];
  var sep = head.indexOf('\t') >= 0 ? '\t'
    : ((head.match(/;/g) || []).length > (head.match(/,/g) || []).length ? ';' : ',');
  var rows = [], row = [], cell = '', q = false, fresh = true;
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && fresh) { q = true; fresh = false; }
    else if (c === sep) { row.push(cell); cell = ''; fresh = true; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; fresh = true; }
    else { cell += c; fresh = false; }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  var w = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
  return rows.map(function (r) {
    var o = [];
    for (var i = 0; i < w; i++) o.push((r[i] == null ? '' : String(r[i])).trim());
    return o;
  });
}

/* CSV שנשמר מאקסל בעברית מקודד לרוב ב-windows-1255 ולא ב-UTF-8.
   קודם מנסים UTF-8 בקפדנות; אם הבתים לא תקינים — מפענחים כעברית של חלונות */
function decodeText(ab) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(ab); }
  catch (e) {
    try { return new TextDecoder('windows-1255').decode(ab); }
    catch (e2) { return new TextDecoder('utf-8').decode(ab); }
  }
}

/* נקודת הכניסה: קובץ -> מערך שורות */
function readSpreadsheet(file) {
  var n = String(file.name || '').toLowerCase();
  if (/\.(csv|txt|tsv)$/.test(n)) return file.arrayBuffer().then(function (ab) { return parseDelimited(decodeText(ab)); });
  if (!canReadXlsx()) return Promise.reject(new Error('הדפדפן הזה לא יודע לפתוח xlsx — שמור באקסל כ-CSV, או השתמש בהדבקה'));
  if (/\.xls$/.test(n)) return Promise.reject(new Error('פורמט xls ישן אינו נתמך — באקסל: שמירה בשם ← xlsx'));
  return readXlsxFile(file);
}
