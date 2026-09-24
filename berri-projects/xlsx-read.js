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
  return String(s).replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(+d); })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
/* כל <t> בתוך <si> מצטרף למחרוזת אחת — טקסט מעוצב מפוצל לכמה <t> */
function sharedStrings(xml) {
  if (!xml) return [];
  return (xml.match(/<si>[\s\S]*?<\/si>/g) || []).map(function (si) {
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
/* מספר סידורי של אקסל -> yyyy-mm-dd (1899-12-30 הוא היום ה-0) */
function serialToISO(n) {
  n = Math.floor(Number(n));
  if (!isFinite(n) || n < 1 || n > 80000) return null;
  var d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  var p = function (x) { return ('0' + x).slice(-2); };
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}

function parseSheet(xml, shared, dstyles) {
  var rows = [], width = 0;
  var rowRe = /<row[^>]*>([\s\S]*?)<\/row>|<row[^>]*\/>/g, rm;
  while ((rm = rowRe.exec(xml))) {
    var body = rm[1] || '', cells = [];
    var cRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g, cm;
    while ((cm = cRe.exec(body))) {
      var attrs = cm[1], inner = cm[2] || '';
      var idx = colIdx((attrs.match(/r="([A-Z]+\d+)"/) || [])[1] || 'A1');
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
          else if (s != null && dstyles[+s] && /^\d+(\.\d+)?$/.test(raw)) v = serialToISO(raw) || raw;
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
    var wb = xtext(z['xl/workbook.xml']);
    var rels = xtext(z['xl/_rels/workbook.xml.rels']);
    var first = (wb.match(/<sheet[^>]*\/?>/) || [''])[0];
    var rid = (first.match(/r:id="([^"]+)"/) || [])[1];
    var target = rid && (rels.match(new RegExp('Id="' + rid + '"[^>]*Target="([^"]+)"')) || [])[1];
    var path = target ? ('xl/' + String(target).replace(/^\/?xl\//, '').replace(/^\//, '')) : 'xl/worksheets/sheet1.xml';
    var sheet = z[path] || z['xl/worksheets/sheet1.xml'];
    if (!sheet) throw new Error('לא נמצא גיליון בקובץ');
    return parseSheet(xtext(sheet), sharedStrings(xtext(z['xl/sharedStrings.xml'])),
                      dateStyles(xtext(z['xl/styles.xml'])));
  });
}

/* CSV / הדבקה מאקסל. מפריד = טאב אם יש, אחרת פסיק */
function parseDelimited(text) {
  text = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  var sep = (text.split('\n')[0].indexOf('\t') >= 0) ? '\t' : ',';
  var rows = [], row = [], cell = '', q = false;
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  var w = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
  return rows.map(function (r) {
    var o = [];
    for (var i = 0; i < w; i++) o.push((r[i] == null ? '' : String(r[i])).trim());
    return o;
  });
}

/* נקודת הכניסה: קובץ -> מערך שורות */
function readSpreadsheet(file) {
  var n = String(file.name || '').toLowerCase();
  if (/\.(csv|txt|tsv)$/.test(n)) return file.text().then(parseDelimited);
  if (!canReadXlsx()) return Promise.reject(new Error('הדפדפן הזה לא יודע לפתוח xlsx — שמור באקסל כ-CSV, או השתמש בהדבקה'));
  if (/\.xls$/.test(n)) return Promise.reject(new Error('פורמט xls ישן אינו נתמך — באקסל: שמירה בשם ← xlsx'));
  return readXlsxFile(file);
}
