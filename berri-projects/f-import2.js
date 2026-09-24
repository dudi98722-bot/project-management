/* BERRI — ייבוא מאקסל, שלב 2: המרה, בדיקה וייבוא */
'use strict';

function impNorm(s) { return String(s == null ? '' : s).toLowerCase().replace(/["'׳״\s_-]/g, ''); }
/* קידומת המזהה של כל טבלה — חייבת להתאים לבדיקת המזהים בשרת */
var IMP_PREFIX = { clientPayments: 'cp', subPayments: 'sp', projectExpenses: 'pe',
                   businessExpenses: 'be', homeExpenses: 'he', additions: 'ad' };

/* התאמת שם מהאקסל לפרוייקט/קופה קיימים: שם מלא, ואם אין — הכלה */
function impMatch(list, raw) {
  var q = impNorm(raw);
  if (!q) return null;
  var exact = list.filter(function (x) { return impNorm(x.name) === q; });
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  var part = list.filter(function (x) {
    var n = impNorm(x.name);
    return n && (n.indexOf(q) >= 0 || q.indexOf(n) >= 0);
  });
  return part.length === 1 ? part[0] : null;
}
/* תאריך: yyyy-mm-dd, dd/mm/yyyy, dd.mm.yy, או מספר סידורי של אקסל */
function impDate(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/.exec(s);
  if (m) {
    var y = +m[3]; if (y < 100) y += y < 70 ? 2000 : 1900;
    return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  }
  if (/^\d+(\.\d+)?$/.test(s)) { var iso = serialToISO(s); if (iso) return iso; }
  return null;
}
function impBool(v) {
  var s = impNorm(v);
  return ['כן', 'true', '1', 'v', 'x', 'מקוזז', 'קיזוז', 'yes'].indexOf(s) >= 0;
}

/* ממיר את כל השורות ומחזיר לכל אחת: הערכים, ושגיאה אם יש */
function impParse() {
  var C = IMP[IMPS.tk], projs = sortedProjects(), regs = sortedRegisters();
  if (!IMPS.defReg || !findRow('registers', IMPS.defReg)) IMPS.defReg = regs[0] ? regs[0].id : '';
  var seen = {};
  return IMPS.rows.map(function (raw) {
    var o = { id: newId(IMP_PREFIX[IMPS.tk]) }, errs = [], warn = '';
    var cell = function (f) { return IMPS.map[f.k] === undefined ? '' : (raw[IMPS.map[f.k]] || ''); };
    C.fields.forEach(function (f) {
      var v = String(cell(f)).trim();
      if (f.type === 'date') {
        var d = v ? impDate(v) : '';
        if (!d && v) errs.push('תאריך לא מובן: ' + v);
        else if (!d && f.req) errs.push('חסר תאריך');
        else o.date = d;
      } else if (f.type === 'money') {
        if (!v) { o[f.k] = 0; if (f.req) errs.push('חסר סכום'); return; }
        var n = parseAmount(v);
        if (!isFinite(n)) errs.push('סכום לא מובן: ' + v);
        else if (n <= 0 && !f.neg) errs.push('סכום חייב להיות גדול מאפס');
        else o[f.k] = n;
      } else if (f.type === 'project') {
        if (IMPS.ctx) { o.projectId = IMPS.ctx; return; }
        var p = impMatch(projs, v);
        if (p) o.projectId = p.id;
        else errs.push(v ? 'לא נמצא פרוייקט "' + v + '"' : 'חסר פרוייקט');
      } else if (f.type === 'register') {
        /* תא ריק = הקופה שנבחרה לייבוא. שם שלא נמצא = שגיאה: כסף שנכנס
           בשקט לקופה הלא נכונה משבש את היתרה בלי שאיש ישים לב */
        if (!v) { o.registerId = IMPS.defReg; return; }
        var r = impMatch(regs, v);
        if (r) o.registerId = r.id;
        else errs.push('לא נמצאה קופה "' + v + '"');
      } else if (f.type === 'bool') {
        o[f.k] = impBool(v);
      } else {
        o[f.k] = v;
      }
    });
    if (IMPS.tk === 'additions' && !o.clientAmount && !o.subAmount) errs.push('חסר סכום — ללקוח או לקבלן');
    if (!regs.length) errs.push('אין קופה מוגדרת במערכת');
    /* כפילות בתוך הקובץ, ומול מה שכבר קיים במערכת */
    var sig = [o.date, o.projectId || '', o.amount || o.clientAmount || 0, o.supplier || o.description || o.reference || ''].join('|');
    var dup = false;
    if (seen[sig]) { warn = 'שורה זהה מופיעה כבר בקובץ'; dup = true; }
    seen[sig] = 1;
    if (!errs.length && impExists(o)) { warn = 'כבר קיימת במערכת'; dup = true; }
    return { o: o, errs: errs, warn: warn, dup: dup, raw: raw };
  });
}
function impExists(o) {
  return (S.d[IMPS.tk] || []).some(function (x) {
    return x.date === o.date && Number(x.amount || x.clientAmount || 0) === Number(o.amount || o.clientAmount || 0) &&
      (x.projectId || '') === (o.projectId || '');
  });
}
/* כפילויות מדולגות אלא אם ביקשו במפורש — קובץ שמועלה פעמיים בטעות
   היה מכפיל את כל הסכומים ומשבש את יתרות הקופות */
function impValid() {
  return IMPS.parsed.filter(function (r) { return !r.errs.length && (!r.dup || IMPS.withDups); });
}

/* --- שלב 2: מיפוי + בדיקה --- */
function impStep2() {
  var C = IMP[IMPS.tk];
  IMPS.parsed = impParse();
  var bad = IMPS.parsed.filter(function (r) { return r.errs.length; });
  var dups = IMPS.parsed.filter(function (r) { return !r.errs.length && r.dup; });
  var good = impValid();
  var opts = '<option value="">— לא בשימוש —</option>' + IMPS.head.map(function (h, i) {
    return '<option value="' + i + '">' + esc(h || ('עמודה ' + (i + 1))) + '</option>';
  }).join('');

  return '<div class="card" style="margin-bottom:12px"><div class="card-head"><h3>1 · התאמת העמודות</h3>' +
      '<div class="sp"></div><span class="muted" style="font-size:12.5px">' + esc(IMPS.name || '') + ' · ' + IMPS.rows.length + ' שורות</span></div>' +
    '<div class="card-body"><div class="grid3">' + C.fields.map(function (f) {
      if (f.type === 'project' && IMPS.ctx) return '';
      var cur = IMPS.map[f.k];
      return '<div class="field"><label>' + esc(f.t) + (f.req ? ' <span class="req">*</span>' : '') + '</label>' +
        '<select class="inp" onchange="impSetMap(\'' + f.k + '\',this.value)">' +
        opts.replace('value="' + cur + '"', 'value="' + cur + '" selected') + '</select></div>';
    }).join('') + '</div>' +
    (IMPS.ctx ? '<div class="hint">כל השורות ייכנסו לפרוייקט <b>' + esc(projName(IMPS.ctx)) + '</b>.</div>' : '') +
    (C.fields.some(function (f) { return f.type === 'register'; })
      ? '<div class="field" style="max-width:320px;margin:10px 0 0"><label>שורות בלי קופה ייכנסו ל</label>' +
        '<select class="inp" onchange="IMPS.defReg=this.value;importRender()">' +
        selOpts(sortedRegisters(), IMPS.defReg, 'id', 'name') + '</select></div>' : '') +
    '</div></div>' +

    '<div class="kpis" style="margin-bottom:10px">' +
      '<div class="kpi green"><div class="k">✔ ייובאו</div><div class="v">' + good.length + '</div></div>' +
      (dups.length ? '<div class="kpi amber"><div class="k">⚠ כפולות</div><div class="v">' + dups.length + '</div>' +
        '<div class="s">' + (IMPS.withDups ? 'ייובאו בכל זאת' : 'מדולגות') + '</div></div>' : '') +
      (bad.length ? '<div class="kpi red"><div class="k">✕ לא ייובאו</div><div class="v">' + bad.length + '</div><div class="s">יש לתקן באקסל</div></div>' : '') +
    '</div>' +
    (dups.length ? '<label class="check' + (IMPS.withDups ? ' on' : '') + '" style="margin-bottom:12px">' +
      '<input type="checkbox"' + (IMPS.withDups ? ' checked' : '') + ' onchange="IMPS.withDups=this.checked;importRender()">' +
      '<span><b>לייבא גם את השורות הכפולות</b><small>רק אם אלה באמת תשלומים נפרדים — למשל שני תשלומים זהים באותו יום. ' +
      'אם הקובץ כבר יובא פעם — להשאיר לא מסומן.</small></span></label>' : '') +

    '<div class="card"><div class="card-head"><h3>2 · בדיקה לפני ייבוא</h3></div>' +
    '<div class="tbl-scroll" style="max-height:38vh"><table class="tbl"><thead><tr><th class="nosort"></th>' +
      C.fields.filter(function (f) { return !(f.type === 'project' && IMPS.ctx); }).map(function (f) {
        return '<th class="nosort">' + esc(f.t) + '</th>';
      }).join('') + '<th class="nosort">מצב</th></tr></thead><tbody>' +
      IMPS.parsed.slice(0, 200).map(function (r, i) {
        var skip = r.dup && !IMPS.withDups;
        var st = r.errs.length ? '<span class="badge r">' + esc(r.errs[0]) + '</span>'
          : r.warn ? '<span class="badge a">' + (skip ? 'מדולגת — ' : '') + esc(r.warn) + '</span>' : '<span class="badge g">תקין</span>';
        return '<tr' + (r.errs.length || skip ? ' class="dim"' : '') + '><td class="muted">' + (i + 1) + '</td>' +
          C.fields.filter(function (f) { return !(f.type === 'project' && IMPS.ctx); }).map(function (f) {
            var v = r.o[f.k];
            if (f.type === 'date') v = fmtDate(r.o.date);
            else if (f.type === 'project') v = r.o.projectId ? projName(r.o.projectId) : '';
            else if (f.type === 'register') v = r.o.registerId ? regName(r.o.registerId) : '';
            else if (f.type === 'money') v = v ? money(v) : '';
            else if (f.type === 'bool') v = v ? 'כן' : '';
            return '<td' + (f.type === 'money' ? ' class="num"' : '') + '>' + esc(v == null ? '' : v) + '</td>';
          }).join('') + '<td>' + st + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (IMPS.parsed.length > 200 ? '<div class="count-line">מוצגות 200 השורות הראשונות · ייובאו כל השורות התקינות</div>' : '') +
    '</div>';
}
function impSetMap(k, v) {
  if (v === '') delete IMPS.map[k]; else IMPS.map[k] = +v;
  importRender();
}

/* --- ייבוא בפועל, במנות כדי לא לחרוג ממגבלת Apps Script --- */
function importRun(btn) {
  if (IMPS.busy) return;
  var list = impValid().map(function (r) { return r.o; });
  if (!list.length) return setMsg('m', 'אין שורות תקינות לייבוא');
  IMPS.busy = true; busy(btn, true, 'מייבא…');
  var table = IMPS.tk, done = 0, failed = [], chunks = [];
  for (var i = 0; i < list.length; i += 100) chunks.push(list.slice(i, i + 100));

  var run = function (n) {
    if (n >= chunks.length) {
      IMPS.busy = false; busy(btn, false);
      rerender();
      if (IMPS.skippedAny) loadAll(true);      // שורות שנשמרו בניסיון שתשובתו אבדה — מביאים אותן מהגיליון
      if (!failed.length) { closeModal(); toast('יובאו ' + done + ' שורות', 'ok'); return; }
      /* נשארים בחלון ומראים למה נפלו — כדי שאפשר יהיה לתקן באקסל */
      var why = {};
      failed.forEach(function (f) { why[f.error] = (why[f.error] || 0) + 1; });
      setMsg('m', 'יובאו ' + done + ' שורות. ' + failed.length + ' לא נקלטו בשרת: ' +
        Object.keys(why).map(function (k) { return k + (why[k] > 1 ? ' (' + why[k] + ')' : ''); }).join(' · '));
      byId('imp-go').classList.add('hide');
      return;
    }
    busy(btn, true, 'מייבא… ' + done + '/' + list.length);
    api('saveBulk', { table: table, rows: chunks[n] }, 90000).then(function (r) {
      /* לא הגיעה תשובה: ייתכן שהמנה כבר נשמרה. שולחים שוב — השרת מדלג
         על מזהים שכבר קיימים, כך שאין כפילות */
      if (r.net && (IMPS.retry = (IMPS.retry || 0) + 1) <= 4) {
        busy(btn, true, 'אין תשובה — מנסה שוב…');
        return setTimeout(function () { run(n); }, 2000 * IMPS.retry);
      }
      IMPS.retry = 0;
      if (r.ok && r.skipped) { done += r.skipped; IMPS.skippedAny = true; }   // נשמרו בניסיון הקודם
      if (!r.ok) {
        IMPS.busy = false; busy(btn, false);
        if (!handleExpired(r)) setMsg('m', r.error);
        if (done) { rerender(); toast('יובאו ' + done + ' שורות לפני התקלה', 'err'); }
        return;
      }
      (r.added || []).forEach(function (row) { upsertLocal(table, row); });
      (r.categories || []).forEach(function (c) { S.d.categories.push(c); });
      done += (r.added || []).length;
      failed = failed.concat(r.failed || []);
      run(n + 1);
    });
  };
  run(0);
}
