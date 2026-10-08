/* ============================================================
   rep-kit.js — ערכת הדוחות המשותפת (RK + repChart)
   כל מה שכאן הוא בניית מחרוזות או חישוב טהור, חוץ מ-repChart.
   כל פרמטר טקסט מוברח כאן; פרמטר ששמו מסתיים ב-Html נחשב בטוח (הקורא הבריח).
   ============================================================ */
var REP_DEFS = (typeof REP_DEFS !== 'undefined' && REP_DEFS) || [];
(function (root) {
  'use strict';
  var RK = {};
  RK.entering = false;           // הנתב מדליק רק במעבר לדוח אחר (גרפים מונפשים רק אז)
  RK._charts = [];               // כל הגרפים החיים, כדי שהנתב יהרוס אותם לפני רינדור

  /* ---------- עזרים פנימיים ---------- */
  var E = function (s) { return esc(s); };
  var N = function (v) { v = Number(v); return isFinite(v) ? v : 0; };
  var NBSP = ' ';
  /* צבע בטוח ל-style: #hex, var(--token), rgb()/rgba() — אחרת ברירת מחדל */
  function color(c, fb) {
    c = String(c == null ? '' : c).trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(c) || /^var\(--[a-zA-Z0-9-]+\)$/.test(c) ||
        /^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\)$/.test(c)) return c;
    return fb || 'var(--brand)';
  }
  RK.color = color;
  function cls(s) { return String(s == null ? '' : s).replace(/[^a-zA-Z0-9_\- ]/g, '').trim(); }

  /* ============================================================
     A) חישובים טהורים
     ============================================================ */
  RK.quantile = function (arr, p) {
    if (!arr || !arr.length) return 0;
    var a = arr.map(N).sort(function (x, y) { return x - y; });
    p = Math.min(1, Math.max(0, N(p)));
    var pos = (a.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
    return a[lo] + (a[hi] - a[lo]) * (pos - lo);
  };
  RK.median = function (arr) { return RK.quantile(arr, 0.5); };

  RK.monthsBetween = function (a, b) {
    a = String(a || ''); b = String(b || '');
    return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7))) || 0;
  };
  var DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  RK.daysIn = function (ym) {
    var y = Number(String(ym).slice(0, 4)), m = Number(String(ym).slice(5, 7));
    if (!(m >= 1 && m <= 12)) return 30;
    if (m === 2 && ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) return 29;
    return DIM[m - 1];
  };
  RK.wd = function (d) {
    d = String(d || '');
    var r = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))).getUTCDay();
    return isFinite(r) ? r : 0;
  };
  RK.catKinds = function (cats) {
    var m = new Map();
    (cats || []).forEach(function (c) { if (c && !c.deleted) m.set(c.name, c.kind); });
    /* קטגוריה שנמחקה עדיין קובעת את סוג התנועות הישנות שלה (זיכוי בקטגוריית הוצאה שנמחקה הוא עדיין זיכוי) */
    try {
      var all = (typeof DB !== 'undefined' && DB && DB.cats) || [];
      all.forEach(function (c) { if (c && c.name && !m.has(c.name)) m.set(c.name, c.kind); });
    } catch (e) { }
    return m;
  };
  /* סכום הוצאה: הוצאה = +, זיכוי (הכנסה בקטגוריית הוצאה) = −, אחרת 0 */
  RK.amt = function (t, kinds) {
    if (t.kind === 'expense') return num(t.amount);
    if (t.kind === 'income' && kinds && kinds.get(t.category) === 'expense') return -num(t.amount);
    return 0;
  };
  RK.isIncome = function (t, kinds) { return t.kind === 'income' && !(kinds && kinds.get(t.category) === 'expense'); };
  RK.key = function (desc) { return normDesc(desc).toLowerCase(); };
  /* מפתח לזיהוי חיובים חוזרים: מספרים מתחלפים (חשבון 3/26, תשלום 2 מ-6, תקופה 5) מתאחדים ל-# */
  RK.rkey = function (desc) {
    return normDesc(desc).toLowerCase().replace(/\d+([\/.\-]\d+)*/g, '#').replace(/\s+/g, ' ').trim();
  };
  RK.firstDate = function (rows) {
    var m = '';
    for (var i = 0; i < (rows || []).length; i++) { var d = rows[i].date; if (d && (!m || d < m)) m = d; }
    return m;
  };
  /* החודש הראשון בנתונים הוא "חלקי" כשהנתונים מתחילים אחרי ה-3 בו (ייבוא ראשון מאמצע החודש):
     יש בו הוצאות אבל לרוב בלי משכורת, ולכן הוא לא נכנס לסכומים שנתיים / חודש רגיל.
     מחזיר {first, firstM, headPartial: 'YYYY-MM' או '', fullFrom: החודש המלא הראשון} */
  RK.firstFullMonth = function (rows) {
    var first = '';
    for (var i = 0; i < (rows || []).length; i++) {
      var d = String(rows[i].date || '');
      if (/^\d{4}-\d{2}-\d{2}/.test(d) && (!first || d < first)) first = d;
    }
    if (!first) return { first: '', firstM: '', headPartial: '', fullFrom: '' };
    var fm = first.slice(0, 7), late = Number(first.slice(8, 10)) > 3;
    return { first: first, firstM: fm, headPartial: late ? fm : '', fullFrom: late ? addMonths(fm, 1) : fm };
  };
  /* מספרים שלמים שסכומם בדיוק 100 (שארית גדולה) */
  RK.shares100 = function (values) {
    var v = (values || []).map(function (x) { return Math.max(0, N(x)); });
    var s = v.reduce(function (a, b) { return a + b; }, 0);
    if (!s) return v.map(function () { return 0; });
    var raw = v.map(function (x) { return x / s * 100; });
    var out = raw.map(Math.floor);
    var left = 100 - out.reduce(function (a, b) { return a + b; }, 0);
    var ord = raw.map(function (r, i) { return { i: i, f: r - Math.floor(r) }; })
      .sort(function (a, b) { return b.f - a.f || a.i - b.i; });
    for (var k = 0; k < left && k < ord.length; k++) out[ord[k].i]++;
    return out;
  };

  /* ---------- זיהוי חיובים חוזרים (מנויים / הוראות קבע) ---------- */
  /* דלק / סופר בסכום משתנה הם הרגל, לא חיוב קבוע (מילוי חודשי באותה תחנה עובר את כל הכללים) */
  var HABIT_RE = /דלק|תדלוק|סופר|מזון|מכולת|סונול|דור אלון|(^|\s)פז(\s|$|\s*-)|yellow|(^|\s)ten(\s|$)/i;
  function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }
  function evalGroup(g, endYm) {
    var months = new Map();
    g.forEach(function (t) { var m = monthOf(t.date); months.set(m, (months.get(m) || 0) + 1); });
    var ms = Array.from(months.keys()).sort();
    if (ms.length < 3) return null;                                   // (1)
    if (g.length / ms.length > 1.3) return null;                      // (2)
    var gaps = [];
    for (var j = 1; j < ms.length; j++) gaps.push(RK.monthsBetween(ms[j - 1], ms[j]));
    var cad = Math.round(RK.median(gaps));
    if (cad !== 1 && cad !== 2) return null;                          // (3)
    if (gaps.filter(function (x) { return x === cad; }).length / gaps.length < 0.75) return null; // (4)
    var span = RK.monthsBetween(ms[0], ms[ms.length - 1]);
    if (ms.length / (Math.floor(span / cad) + 1) < 0.75) return null; // (5)
    var amts = g.map(function (t) { return num(t.amount); });
    var med = RK.median(amts);
    var near = amts.filter(function (a) { return Math.abs(a - med) <= Math.abs(med) * 0.2; }).length;
    if (near / amts.length < 0.67) return null;                       // (6)
    var last = g[g.length - 1], lastM = ms[ms.length - 1];
    var near5 = amts.filter(function (a) { return Math.abs(a - med) <= Math.abs(med) * 0.05; }).length;
    if (near5 / amts.length < 0.67 && HABIT_RE.test(normDesc(last.desc) + ' ' + (last.category || ''))) return null; // (7)
    return {
      cad: cad, median: med, months: ms, amts: amts, n: g.length,
      active: RK.monthsBetween(lastM, endYm) <= cad,
      desc: normDesc(last.desc), cat: last.category || '', payment: last.payment || '',
      monthly: med / cad
    };
  }
  var recurMemo = new WeakMap();
  /* Map: מפתח → חיוב חוזר. כמה חיובים תחת אותו תיאור (APPLE.COM/BILL, "הוראת קבע") מפוצלים לפי סכום,
     והמפתח שלהם הוא "תיאור|סכום". לבדיקה אם תנועה היא חיוב קבוע — RK.recKey(rec, t), לא rec.has(...) */
  RK.recurring = function (rows, endYm) {
    rows = rows || [];
    var byEnd = recurMemo.get(rows);
    if (!byEnd) { byEnd = new Map(); recurMemo.set(rows, byEnd); }
    if (byEnd.has(endYm)) return byEnd.get(endYm);
    var start = addMonths(endYm, -11), groups = new Map();
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i];
      if (t.kind !== 'expense') continue;
      var ym = monthOf(t.date);
      if (ym < start || ym > endYm) continue;
      var k = RK.rkey(t.desc);
      if (!k) continue;
      var g = groups.get(k);
      if (!g) { g = []; groups.set(k, g); }
      g.push(t);
    }
    var res = new Map(), clMap = new Map();
    groups.forEach(function (g, k) {
      g.sort(byDate);
      var e = evalGroup(g, endYm);
      if (e) { res.set(k, e); return; }
      /* פיצול לפי סכום — רק כשיש כמה חיובים בחודש תחת אותו תיאור (כלל 2 נכשל), ולא לסופר/דלק.
         אשכול חדש רק בקפיצה אמיתית בין סכומים סמוכים (8%+), כך שטווח רציף נשאר אשכול אחד ונפסל */
      var gm = new Set();
      g.forEach(function (t) { gm.add(monthOf(t.date)); });
      if (g.length < 6 || g.length / gm.size <= 1.3) return;
      var lt = g[g.length - 1];
      if (HABIT_RE.test(normDesc(lt.desc) + ' ' + (lt.category || ''))) return;
      var srt = g.slice().sort(function (a, b) { return num(a.amount) - num(b.amount); });
      var cls = [], cur = [srt[0]];
      for (var j = 1; j < srt.length; j++) {
        if (num(srt[j].amount) > num(srt[j - 1].amount) * 1.08 + 0.5) { cls.push(cur); cur = []; }
        cur.push(srt[j]);
      }
      cls.push(cur);
      if (cls.length < 2) return;
      var list = [];
      cls.forEach(function (c) {
        if (c.length < 4) return;
        c.sort(byDate);
        var e2 = evalGroup(c, endYm);
        if (!e2) return;
        /* אשכול = מנוי אמיתי: כמעט אותו סכום בכל פעם (±3%), לא צירוף מקרי של קניות */
        var tight = e2.amts.filter(function (a) { return Math.abs(a - e2.median) <= Math.abs(e2.median) * 0.03; }).length;
        if (tight / e2.amts.length < 0.8) return;
        var ck = k + '|' + Math.round(e2.median);
        res.set(ck, e2);
        list.push({ key: ck, med: e2.median });
      });
      if (list.length) clMap.set(k, list);
    });
    res._cl = clMap;
    byEnd.set(endYm, res);
    return res;
  };
  /* המפתח של החיוב החוזר שהתנועה שייכת אליו, או '' */
  RK.recKey = function (rec, t) {
    if (!rec || !t) return '';
    var k = RK.rkey(t.desc);
    if (!k) return '';
    if (rec.has(k)) return k;
    var L = rec._cl && rec._cl.get(k);
    if (!L) return '';
    var a = num(t.amount), best = '', bd = Infinity;
    for (var i = 0; i < L.length; i++) {
      var m = Math.abs(L[i].med) || 1, d = Math.abs(a - L[i].med) / m;
      if (d <= 0.2 && d < bd) { bd = d; best = L[i].key; }
    }
    return best;
  };
  /* חיובים קבועים שצפויים החודש ועוד לא ירדו עד יום D (לפי 12 החודשים שלפני) — משותף לקצב ולקבוע/שוטף */
  RK.expectedFixed = function (rows, ym, D) {
    rows = rows || [];
    var rec = RK.recurring(rows, addMonths(ym, -1)), seen = new Set();
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i];
      if (t.kind !== 'expense' || monthOf(t.date) !== ym) continue;
      if ((Number(String(t.date).slice(8, 10)) || 0) > D) continue;
      var k = RK.recKey(rec, t);
      if (k) seen.add(k);
    }
    var list = [];
    rec.forEach(function (r, k) {
      if (r.active && !seen.has(k) && RK.monthsBetween(r.months[r.months.length - 1], ym) === r.cad)
        list.push({ key: k, desc: r.desc, amount: Math.round(r.median * 100) / 100, cat: r.cat, cad: r.cad });
    });
    list.sort(function (a, b) { return b.amount - a.amount; });
    var sum = 0;
    list.forEach(function (e) { sum += e.amount; });
    return { sum: Math.round(sum * 100) / 100, list: list, rec: rec, seen: seen };
  };

  /* ---------- שמות חודשים ותאריכים ---------- */
  var MON = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  var MONS = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
  function mi(ym) { var m = Number(String(ym || '').slice(5, 7)); return m >= 1 && m <= 12 ? m - 1 : -1; }
  RK.monName = function (ym) { var i = mi(ym); return i < 0 ? '' : MON[i]; };
  RK.monShort = function (ym) { var i = mi(ym); return i < 0 ? '' : MONS[i]; };
  RK.dayLabel = function (d) {
    d = String(d || ''); var i = mi(d.slice(0, 7)), day = Number(d.slice(8, 10));
    return i < 0 || !day ? '' : day + ' ב' + MON[i];
  };
  var hebFmt = null;
  RK.hebDate = function (d) {
    try {
      if (!hebFmt) hebFmt = new Intl.DateTimeFormat('en-u-ca-hebrew', { timeZone: 'UTC', month: 'long', day: 'numeric' });
      if (hebFmt.resolvedOptions().calendar !== 'hebrew') return null;
      d = String(d || '');
      var dt = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))));
      if (!isFinite(dt.getTime())) return null;
      var o = {};
      hebFmt.formatToParts(dt).forEach(function (p) { o[p.type] = p.value; });
      if (!o.month || !o.day) return null;
      return { month: o.month, day: Number(o.day) };
    } catch (e) { return null; }
  };

  /* ============================================================
     B) בוני HTML
     ============================================================ */
  RK.money = function (v, o) {
    v = N(v); o = o || {};
    var r = Math.round(v), s = r < 0 ? '−' : (o.sign && r > 0 ? '+' : '');
    return '<span class="num">' + s + fmt(Math.abs(v)) + ' ₪</span>';
  };

  RK.card = function (innerHtml, o) {
    o = o || {};
    var enter = typeof o.i === 'number' && o.i >= 0;
    return '<div class="rk-card' + (o.cls ? ' ' + cls(o.cls) : '') + (enter ? ' rk-enter' : '') + '"' +
      (enter ? RK.stagger(o.i) : '') + '>' +
      (o.title ? '<h3 class="rk-card-t">' + E(o.title) + '</h3>' : '') +
      (o.sub ? '<div class="rk-card-s">' + E(o.sub) + '</div>' : '') +
      (innerHtml || '') + '</div>';
  };

  RK.insight = function (html, o) {
    var tone = (o && o.tone) || 'brand';
    return '<div class="insight rk-ins rk-ins-' + cls(tone) + '">' + (html || '') + '</div>';
  };

  RK.kpis = function (items) {
    return '<div class="rk-kpis">' + (items || []).map(function (it) {
      it = it || {};
      var unit = it.unit == null ? '₪' : it.unit, v;
      if (it.valHtml != null) v = it.valHtml;
      else {
        var x = N(it.val), sgn = Math.round(x) < 0 ? '−' : '';
        v = '<span class="num">' + sgn + fmt(Math.abs(x)) + (unit === '₪' ? ' ₪' : unit === '%' ? '%' : '') + '</span>';
      }
      return '<div class="rk-kpi"><div class="rk-kpi-l">' + E(it.lbl) + '</div>' +
        '<div class="rk-kpi-v' + (it.tone ? ' ' + cls(it.tone) : '') + '">' + v + '</div>' +
        (it.subHtml ? '<div class="rk-kpi-s">' + it.subHtml + '</div>' : it.sub ? '<div class="rk-kpi-s">' + E(it.sub) + '</div>' : '') +
        '</div>';
    }).join('') + '</div>';
  };

  function pillHtml(html, tone) { return '<span class="rk-pill' + (tone ? ' ' + cls(tone) : '') + '">' + html + '</span>'; }
  RK.pill = function (text, tone) { return pillHtml(E(text), tone); };

  RK.delta = function (v, o) {
    v = N(v); o = o || {};
    var r = Math.round(v), flat = o.flat || r === 0;
    var val = o.pct ? '<span class="num">' + fmt(Math.abs(v)) + '%</span>'
      : o.money ? RK.money(Math.abs(v)) : '<span class="num">' + fmt(Math.abs(v)) + '</span>';
    if (flat) return pillHtml('≈ ' + val, 'dim');
    return pillHtml((r > 0 ? '▲ ' : '▼ ') + val, r > 0 ? 'up' : 'down');
  };

  RK.partial = function (P) {
    if (!P || !P.today || P.ym !== monthOf(P.today)) return '';
    return RK.pill('חודש חלקי · עד ' + RK.dayLabel(P.today), 'warn');
  };

  RK.empty = function (icon, title, sub) {
    return '<div class="rk-empty"><div class="rk-empty-i" aria-hidden="true">' + E(icon || '🌱') + '</div>' +
      (title ? '<div class="rk-empty-t">' + E(title) + '</div>' : '') +
      (sub ? '<div class="rk-empty-s">' + E(sub) + '</div>' : '') + '</div>';
  };

  function iconSpan(it) {
    var h = it.iconHtml != null && it.iconHtml !== '' ? it.iconHtml : it.icon ? E(it.icon) : '';
    return h ? '<span class="rk-row-i" aria-hidden="true">' + h + '</span>' : '';
  }
  /* שם פעולה ל-act(): רק rep_<מפתח>_... — כך שלא יוזרק לשם הזה שום ערך מהנתונים */
  function actOk(n) { return /^rep_[a-z0-9_]{1,60}$/.test(String(n || '')); }
  RK.actOk = actOk;
  function pctW(v, max) { if (!(v > 0) || !(max > 0)) return 0; return Math.max(2, Math.min(100, v / max * 100)); }
  RK.rows = function (items, o) {
    items = items || []; o = o || {};
    var max = N(o.max);
    if (!(max > 0)) items.forEach(function (it) { max = Math.max(max, N(it.value), N(it.ghost)); });
    return '<div class="rk-rows">' + items.map(function (it) {
      var w = pctW(N(it.value), max), gw = pctW(N(it.ghost), max);
      return '<div class="rk-row' + (it.tone ? ' ' + cls(it.tone) : '') + '">' +
        '<div class="rk-row-h">' + iconSpan(it) +
        '<span class="rk-row-l">' + E(it.label) + (it.sub ? '<span class="rk-row-s">' + E(it.sub) + '</span>' : '') + '</span>' +
        '<span class="rk-row-v">' + (it.valueHtml || '') + '</span></div>' +
        '<div class="rk-track"><i style="width:' + w.toFixed(2) + '%;background:' + color(it.color) + '"></i></div>' +
        (it.ghost != null && gw > 0 ? '<div class="rk-ghost"><i style="width:' + gw.toFixed(2) + '%"></i></div>' : '') +
        '</div>';
    }).join('') + '</div>';
  };

  RK.diverge = function (items) {
    items = items || [];
    var max = 0;
    items.forEach(function (it) { max = Math.max(max, Math.abs(N(it.d))); });
    return '<div class="rk-div">' + items.map(function (it) {
      var d = N(it.d), half = max > 0 ? Math.abs(d) / max * 50 : 0;
      if (d !== 0) half = Math.max(1, half);
      var side = d > 0 ? 'inset-inline-start:50%' : 'inset-inline-end:50%';
      return '<div class="rk-div-r">' +
        '<div class="rk-row-h">' + iconSpan(it) +
        '<span class="rk-row-l">' + E(it.label) + '</span>' +
        '<span class="rk-row-v ' + (d > 0 ? 'up' : d < 0 ? 'down' : '') + '">' + RK.money(d, { sign: true }) + '</span></div>' +
        '<div class="rk-div-t">' + (d !== 0 ? '<i class="' + (d > 0 ? 'inc' : 'dec') + '" style="' + side + ';width:' + half.toFixed(2) + '%"></i>' : '') + '</div>' +
        '</div>';
    }).join('') + '</div>';
  };

  RK.stack = function (segs, o) {
    o = o || {};
    var h = Math.max(4, Math.min(40, N(o.h) || 14));
    var list = (segs || []).filter(function (s) { return N(s.value) > 0; });
    var tot = list.reduce(function (a, s) { return a + N(s.value); }, 0);
    if (!tot) return '<div class="rk-stack" style="height:' + h + 'px"></div>';
    return '<div class="rk-stack" style="height:' + h + 'px">' + list.map(function (s) {
      var w = Math.max(2, N(s.value) / tot * 100), lab = E((s.label || '') + ': ' + fmt(N(s.value)) + ' ₪');
      return '<span role="img" title="' + lab + '" aria-label="' + lab + '" style="flex:' + w.toFixed(3) + ' 1 0%;background:' + color(s.color) + '"></span>';
    }).join('') + '</div>';
  };

  RK.ring = function (o) {
    o = o || {};
    var size = Math.max(40, Math.min(400, N(o.size) || 140)), sw = Math.max(2, Math.min(size / 3, N(o.stroke) || 12));
    var c = size / 2, r = (size - sw) / 2 - 1, C = 2 * Math.PI * r;
    var f = Math.min(1, Math.max(0, N(o.frac))), ov = Math.min(1, Math.max(0, N(o.over)));
    var col = color(o.color, 'var(--brand)'), trk = color(o.track, 'var(--line2)'), ovc = color(o.overColor, 'var(--bad)');
    var s = '<svg class="rk-ring-svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="' + E(o.aria || '') + '">' +
      '<circle cx="' + c + '" cy="' + c + '" r="' + r.toFixed(2) + '" fill="none" stroke="' + trk + '" stroke-width="' + sw + '"/>';
    if (f > 0) s += '<circle cx="' + c + '" cy="' + c + '" r="' + r.toFixed(2) + '" fill="none" stroke="' + col + '" stroke-width="' + sw +
      '" stroke-linecap="round" stroke-dasharray="' + (C * f).toFixed(2) + ' ' + C.toFixed(2) + '"/>';
    if (ov > 0) {
      var osw = Math.max(3, sw / 2.4), r2 = r - sw / 2 - osw / 2 - 3, C2 = 2 * Math.PI * r2;
      if (r2 > 2) s += '<circle cx="' + c + '" cy="' + c + '" r="' + r2.toFixed(2) + '" fill="none" stroke="' + ovc + '" stroke-width="' + osw.toFixed(2) +
        '" stroke-linecap="round" stroke-dasharray="' + (C2 * ov).toFixed(2) + ' ' + C2.toFixed(2) + '"/>';
    }
    if (o.marker != null && isFinite(Number(o.marker))) {
      var mf = Math.min(1, Math.max(0, Number(o.marker))), a = mf * 2 * Math.PI;
      s += '<circle cx="' + (c + r * Math.cos(a)).toFixed(2) + '" cy="' + (c + r * Math.sin(a)).toFixed(2) + '" r="3.5" fill="var(--ink2)" stroke="#fff" stroke-width="2"/>';
    }
    s += '</svg>';
    return '<div class="rk-ring" style="width:' + size + 'px;height:' + size + 'px">' + s +
      (o.centerHtml ? '<div class="rk-ring-c">' + o.centerHtml + '</div>' : '') + '</div>';
  };

  RK.legend = function (items) {
    return '<div class="rk-leg">' + (items || []).map(function (it) {
      var sw = '<span class="rk-sw' + (it.dashed ? ' dashed' : '') + '" style="' + (it.dashed ? 'border-color:' : 'background:') + color(it.color, 'var(--faint)') + '" aria-hidden="true"></span>';
      var body = sw + (it.iconHtml ? '<span class="rk-leg-i" aria-hidden="true">' + it.iconHtml + '</span>' : '') +
        '<span class="rk-leg-l">' + E(it.label) + (it.sub ? '<span class="rk-leg-s">' + E(it.sub) + '</span>' : '') + '</span>' +
        (it.valueHtml ? '<span class="rk-leg-v">' + it.valueHtml + '</span>' : '');
      return it.actName && actOk(it.actName)
        ? '<button type="button" class="rk-leg-row"' + act(it.actName, it.actId == null ? '' : it.actId) + ' aria-pressed="false">' + body + '</button>'
        : '<div class="rk-leg-row">' + body + '</div>';
    }).join('') + '</div>';
  };

  RK.chips = function (htmlArr) {
    return '<div class="rk-chips">' + (htmlArr || []).map(function (h) { return '<span class="rk-chip">' + h + '</span>'; }).join('') + '</div>';
  };

  RK.seg = function (options, actName) {
    if (!actOk(actName)) actName = 'rep_noop';
    return '<div class="rk-seg" role="group">' + (options || []).map(function (op) {
      return '<button type="button" class="rk-seg-b' + (op.on ? ' on' : '') + '"' + act(actName, op.id) +
        ' aria-pressed="' + (op.on ? 'true' : 'false') + '">' + E(op.label) + '</button>';
    }).join('') + '</div>';
  };

  RK.details = function (summaryText, innerHtml) {
    return '<details class="rk-details"><summary><span class="rk-det-a" aria-hidden="true">▸</span>' + E(summaryText) + '</summary>' +
      '<div class="rk-det-b">' + (innerHtml || '') + '</div></details>';
  };

  /* headers ותאים: מחרוזת/מספר (מוברחים) או {html, cls} — HTML נכנס רק דרך {html} */
  RK.table = function (headers, rows) {
    function cell(tag, c, escape) {
      if (c && typeof c === 'object') return '<' + tag + (c.cls ? ' class="' + cls(c.cls) + '"' : '') + '>' + (c.html == null ? '' : c.html) + '</' + tag + '>';
      return '<' + tag + '>' + (escape ? E(c) : (c == null ? '' : c)) + '</' + tag + '>';
    }
    return '<div class="table-wrap report"><table><thead><tr>' + (headers || []).map(function (h) { return cell('th', h, true); }).join('') +
      '</tr></thead><tbody>' + (rows || []).map(function (r) {
        return '<tr>' + (r || []).map(function (c) { return cell('td', c, true); }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  };

  RK.stagger = function (i) { return " style='--i:" + Math.max(0, Math.min(N(i) | 0, 5)) + "'"; };

  /* ============================================================
     C) גרפים
     ============================================================ */
  function isObj(x) { if (!x || typeof x !== 'object' || Object.prototype.toString.call(x) !== '[object Object]') return false; var p = Object.getPrototypeOf(x); return p === null || !Object.getPrototypeOf(p); }
  function merge(base, over) {   // over מנצח; אובייקטים פשוטים ממוזגים לעומק
    var out = {}, k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    for (k in over) if (Object.prototype.hasOwnProperty.call(over, k)) {
      out[k] = isObj(out[k]) && isObj(over[k]) ? merge(out[k], over[k]) : over[k];
    }
    return out;
  }
  function reducedMotion() {
    try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  RK.reducedMotion = reducedMotion;
  RK.axisMoney = function (v) { return fmt(v); };   // callback לציר ערכים מספרי
  var FONT = 'Assistant, "Segoe UI", system-ui, sans-serif';
  var NO_AXES = { pie: 1, doughnut: 1, polarArea: 1, radar: 1 };

  function tipLabel(c) {
    var v = c.parsed;
    if (v && typeof v === 'object') v = (c.chart && c.chart.options && c.chart.options.indexAxis === 'y') ? v.x : v.y;
    if (typeof v !== 'number') v = Number(c.raw);
    var lab = (c.dataset && c.dataset.label) || c.label || '';
    return (lab ? lab + ': ' : '') + fmt(isFinite(v) ? v : 0) + ' ₪';
  }

  function chartMissing(canvas) {
    try {
      var box = canvas.parentNode;
      if (!box || box._rkMissing) return;
      box._rkMissing = true;
      box.innerHTML = RK.empty('📉', 'הגרף לא נטען', 'שאר הדוח תקין');
      box.style.height = 'auto';
      var card = box.closest && box.closest('.rk-card');
      if (card) { var L = card.querySelectorAll('.rk-leg'); for (var i = 0; i < L.length; i++) L[i].hidden = true; }
    } catch (e) { }
  }
  function repChart(canvas, config) {
    if (!canvas || !config) return null;
    if (typeof Chart === 'undefined') { chartMissing(canvas); return null; }
    try { if (canvas._rk) canvas._rk.destroy(); } catch (e) { }
    canvas._rk = null;
    var animate = RK.entering === true && !reducedMotion();
    var userOpts = config.options || {};
    var defs = {
      responsive: true, maintainAspectRatio: false,
      color: '#6b7280', font: { family: FONT },
      animation: animate ? { duration: 350, easing: 'easeOutQuart' } : false,
      plugins: {
        legend: { rtl: true, textDirection: 'rtl', labels: { color: '#6b7280', font: { family: FONT, size: 12 }, boxWidth: 10, boxHeight: 10, usePointStyle: true } },
        tooltip: {
          rtl: true, textDirection: 'rtl', backgroundColor: '#111827', padding: 10, cornerRadius: 8, boxPadding: 4,
          titleFont: { family: FONT, weight: '700' }, bodyFont: { family: FONT }, footerFont: { family: FONT },
          callbacks: {}
        }
      }
    };
    var opts = merge(defs, userOpts);
    if (!animate) opts.animation = false;
    var tcb = opts.plugins.tooltip.callbacks || {};
    if (typeof tcb.label !== 'function') opts.plugins.tooltip.callbacks = merge(tcb, { label: tipLabel });
    var axisDef = { grid: { color: '#eef0f3' }, border: { color: '#e6e8ec' }, ticks: { color: '#6b7280', font: { family: FONT, size: 11.5 } } };
    if (!NO_AXES[config.type] || opts.scales) {
      var sc = NO_AXES[config.type] ? (opts.scales || {}) : merge({ x: {}, y: {} }, opts.scales || {});
      var out = {};
      Object.keys(sc).forEach(function (k) { out[k] = merge(axisDef, sc[k] || {}); });
      if (Object.keys(out).length) opts.scales = out;
    }
    var cfg = merge(config, { options: opts });
    cfg.options = opts;   // לא לבלוע מערכים/פונקציות של המשתמש
    var ch = null;
    try { ch = new Chart(canvas, cfg); } catch (e) { if (typeof console !== 'undefined') console.error('repChart', e); return null; }
    canvas._rk = ch;
    RK._charts.push(ch);
    return ch;
  }
  RK.destroyCharts = function () {
    var L = RK._charts; RK._charts = [];
    L.forEach(function (c) { try { c.destroy(); } catch (e) { } });
  };

  root.RK = RK;
  root.repChart = repChart;
})(typeof window !== 'undefined' ? window : globalThis);
