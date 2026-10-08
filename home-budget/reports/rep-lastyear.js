/* ============================================================
   rep-lastyear.js — "אותו חודש, לפני שנה"
   החודש הנבחר מול אותו חודש בשנה שעברה: כמה, מה זז ולמה.
   חודש חלקי: שני החודשים נספרים רק עד אותו יום בחודש, כדי שההשוואה תהיה הוגנת.
   חגים: אם ראש השנה / סוכות / פסח נפל רק באחד משני החודשים — הערה שחלק מההפרש הוא תזמון.
   ============================================================ */
(function () {
  'use strict';
  var NOCAT = 'ללא קטגוריה', REST = 'שאר הקטגוריות';
  /* w = ימי ההכנות לפני החג (הקניות לפסח מתחילות ~3 שבועות לפני, לתשרי ~שבועיים) */
  var HOLIDAYS = [
    { m: 'Tishri', d: 1, name: 'ראש השנה', w: 14 },
    { m: 'Tishri', d: 15, name: 'סוכות', w: 14 },
    { m: 'Nisan', d: 15, name: 'פסח', w: 21 }
  ];
  /* חודשים שחלון ההכנות יכול לגעת בהם: פסח 26/3–25/4 (חלון מ-5/3), ראש השנה 5/9–5/10 (חלון מ-22/8), סוכות עד 19/10 */
  var HOL_MONTHS = { 3: 1, 4: 1, 8: 1, 9: 1, 10: 1 };
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function r2(v) { v = Number(v); return isFinite(v) ? Math.round(v * 100) / 100 : 0; }
  function byName(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function dayNo(ds) { return Math.floor(Date.UTC(Number(ds.slice(0, 4)), Number(ds.slice(5, 7)) - 1, Number(ds.slice(8, 10))) / 864e5); }

  /* תאריכי החגים בשנה לועזית y → {שם: 'YYYY-MM-DD'}; null = אין לוח עברי בדפדפן. נשמר בזיכרון לכל שנה */
  var holCache = Object.create(null);
  function holidayDates(y) {
    if (y in holCache) return holCache[y];
    var out = {}, ranges = [[3, 20, 4, 30], [9, 1, 10, 25]];
    for (var r = 0; r < ranges.length; r++) {
      var R = ranges[r];
      for (var mo = R[0]; mo <= R[2]; mo++) {
        var from = mo === R[0] ? R[1] : 1, to = mo === R[2] ? R[3] : RK.daysIn(y + '-' + pad(mo));
        for (var day = from; day <= to; day++) {
          var ds = y + '-' + pad(mo) + '-' + pad(day), h = RK.hebDate(ds);
          if (!h) { holCache[y] = null; return null; }
          for (var i = 0; i < HOLIDAYS.length; i++) {
            if (h.month === HOLIDAYS[i].m && h.day === HOLIDAYS[i].d) out[HOLIDAYS[i].name] = ds;
          }
        }
      }
    }
    holCache[y] = out;
    return out;
  }
  /* איזה חלק מחלון ההכנות (w ימים לפני החג + יום החג) נופל בימים 1..cut של החודש ym */
  function prepFrac(ym, cut, date, w) {
    if (!date) return 0;
    var he = dayNo(date), hs = he - w, ms = dayNo(ym + '-01'), me = ms + Math.min(cut, RK.daysIn(ym)) - 1;
    var ov = Math.min(he, me) - Math.max(hs, ms) + 1;
    return ov > 0 ? ov / (w + 1) : 0;
  }

  /* חג שההכנות אליו נפלו בחלון ההשוואה הרבה יותר באחד משני החודשים (פסח 2/4 מול 13/4 מזיז את הקניות ממרץ לאפריל) */
  function holidayNote(cur, prev, cut, today) {
    if (!HOL_MONTHS[Number(cur.slice(5, 7))]) return null;
    var A = holidayDates(cur.slice(0, 4)), B = holidayDates(prev.slice(0, 4));
    if (!A || !B) return null;
    for (var i = 0; i < HOLIDAYS.length; i++) {
      var H = HOLIDAYS[i], da = A[H.name], db = B[H.name];
      if (!da || !db) continue;
      var fa = prepFrac(cur, cut, da, H.w), fb = prepFrac(prev, cut, db, H.w);
      if (Math.abs(fa - fb) < 0.35) continue;
      return { name: H.name, more: fa > fb, curDate: da, prevDate: db, future: da > today };
    }
    return null;
  }

  function calc(rows, P) {
    rows = rows || [];
    var kinds = RK.catKinds(P.cats), cur = P.ym, prev = addMonths(cur, -12);
    var todayYm = monthOf(P.today);
    if (cur > todayYm) return { state: 'future', cur: cur, prev: prev };
    var partial = cur === todayYm;
    var cut = partial ? (Number(String(P.today).slice(8, 10)) || 31) : 31;

    var ff = RK.firstFullMonth(rows), first = ff.first;
    if (!first) return { state: 'none', cur: cur, prev: prev };
    var firstYm = ff.firstM;
    if (prev < firstYm) {
      var opensYm = addMonths(firstYm, 12);
      return { state: 'noHistory', cur: cur, prev: prev, firstYm: firstYm, opensYm: opensYm,
        opensAt: heMonth(opensYm), opensPast: opensYm <= todayYm };
    }

    /* החודש של שנה שעברה הוא החודש הראשון בנתונים, והם מתחילים באמצעו: משווים בשני החודשים
       רק מאותו יום — אחרת חודש בלי משכורת ובלי השבוע הראשון נראה "זול ב-60%" */
    var lo = prev === ff.headPartial ? Number(first.slice(8, 10)) : 1;
    if (lo > cut) return { state: 'lateStart', cur: cur, prev: prev, lo: lo, first: first };

    /* מעבר אחד על השורות: רק שני החודשים, רק בימים lo..cut */
    var A = new Map(), B = new Map(), curT = 0, prevT = 0;
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i], m = monthOf(t.date);
      if (m !== cur && m !== prev) continue;
      var dd = Number(String(t.date).slice(8, 10));
      if (dd > cut || dd < lo) continue;
      var v = RK.amt(t, kinds);
      if (!v) continue;
      var k = t.category || NOCAT;
      if (m === cur) { A.set(k, (A.get(k) || 0) + v); curT += v; }
      else { B.set(k, (B.get(k) || 0) + v); prevT += v; }
    }
    curT = r2(Math.max(0, curT)); prevT = r2(Math.max(0, prevT));
    if (curT === 0 && prevT === 0) return { state: 'none', cur: cur, prev: prev, partial: partial, cut: cut };

    var prevPartialData = lo > 1;
    var diff = r2(curT - prevT);
    var pct = prevT > 0 ? Math.round(diff / prevT * 100) : null;

    var keys = new Set();
    A.forEach(function (_, key) { keys.add(key); });
    B.forEach(function (_, key) { keys.add(key); });
    var all = [];
    keys.forEach(function (key) {
      var a = r2(A.get(key) || 0), b = r2(B.get(key) || 0);
      all.push({ k: key, cur: a, prev: b, d: r2(a - b) });
    });

    /* מה זז: לפי גודל השינוי, כל עוד הוא לפחות 50 ₪ ו-1% מהחודש של שנה שעברה, עד 6 */
    var th = Math.max(50, prevT * 0.01);
    var byAbs = all.slice().sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d) || byName(a.k, b.k); });
    var movers = [], restD = 0, restN = 0;
    for (var j = 0; j < byAbs.length; j++) {
      var r = byAbs[j];
      if (movers.length === j && j < 6 && Math.abs(r.d) >= th) movers.push({ k: r.k, d: r.d });
      else { restD += r.d; if (Math.round(r.d) !== 0) restN++; }
    }
    restD = r2(restD);
    if (Math.abs(restD) >= 50) movers.push({ k: REST, d: restD, rest: true, n: restN });

    all.sort(function (a, b) { return b.cur - a.cur || b.prev - a.prev || byName(a.k, b.k); });

    var note = null;
    try { note = holidayNote(cur, prev, cut, String(P.today || '')); } catch (e) { note = null; }

    return { state: 'ok', cur: cur, prev: prev, partial: partial, cut: cut, lo: lo, curT: curT, prevT: prevT,
      diff: diff, pct: pct, movers: movers, all: all, prevPartialData: prevPartialData, note: note, first: first };
  }

  /* ---------- HTML ---------- */
  function signedPct(p) {
    return '<span class="num">' + (p > 0 ? '+' : p < 0 ? '−' : '') + fmt(Math.abs(p)) + '%</span>';
  }

  function headline(D) {
    var mon = esc(RK.monName(D.prev)), h, tone = 'brand', lead = '';
    if (D.curT === 0) {
      h = 'ב<strong>' + esc(heMonth(D.cur)) + '</strong> עוד לא נרשמו הוצאות' +
        (D.partial ? '.' : ' — אולי עוד לא ייבאתם את התנועות של החודש הזה?');
    } else if (D.pct === null) {
      h = 'ב<strong>' + esc(heMonth(D.prev)) + '</strong> לא נרשמו הוצאות להשוואה.';
    } else if (Math.abs(D.pct) < 5) {
      lead = '🔄 ';
      h = 'כמעט בדיוק כמו ב' + mon + ' שעבר (' + signedPct(D.pct) + ') 🙂';
    } else if (D.pct <= -5) {
      h = 'הוצאתם <strong>' + fmt(Math.abs(D.pct)) + '%</strong> פחות מאשר ב' + mon + ' שעבר 🎉';
      tone = 'ok';
    } else {
      h = 'הוצאתם <strong>' + fmt(D.pct) + '%</strong> יותר מאשר ב' + mon + ' שעבר. הנה מה שזז:';
    }
    h = lead + (D.lo > 1 ? 'מה-' + fmt(D.lo) + (D.partial ? ' עד ה-' + fmt(D.cut) : '') + ' בחודש: '
      : D.partial ? 'עד ה-' + fmt(D.cut) + ' בחודש: ' : '') + h;
    if (D.prevPartialData) {
      h += '<div class="rk-foot">' + esc('הנתונים של ' + heMonth(D.prev) + ' מתחילים רק ב-' + RK.dayLabel(D.first) +
        ', ולכן בשני החודשים נספרו רק הימים מה-' + D.lo + ' בחודש.') + '</div>';
    }
    return RK.insight(h, { tone: tone });
  }

  function noteHtml(D) {
    var n = D.note;
    if (!n || !(D.curT > 0) || D.pct == null) return '';   /* בלי השוואה אין "הפרש" להסביר */
    var s = '<strong>' + esc(n.name) + '</strong> ' + (n.future ? 'יחול' : 'חל') + ' השנה ב-' + esc(RK.dayLabel(n.curDate)) +
      ' ובשנה שעברה ב-' + esc(RK.dayLabel(n.prevDate)) + ', ולכן השנה ' + (n.more ? 'יותר' : 'פחות') +
      ' מהקניות לקראת החג נפלו ' + (D.partial || D.lo > 1 ? 'בימים האלה' : 'בחודש הזה');
    return RK.insight('🗓️ ' + s + '. חלק מההפרש הוא תזמון החגים, לא שינוי בהרגלים.', { tone: 'warn' });
  }

  /* תאי הטבלה בלי ₪ (כמו טבלת הקטגוריות בדשבורד) — אחרת 4 עמודות לא נכנסות ב-375px
     ועמודת ההפרש, החשובה מכולן, נחתכת. היחידה כתובה מתחת לטבלה. */
  var DASH = '<span style="color:var(--faint)">–</span>';
  function amtCell(v) {
    var r = Math.round(v);
    return r === 0 ? DASH : '<span class="num">' + (r < 0 ? '−' : '') + fmt(Math.abs(v)) + '</span>';
  }
  function diffCell(d) {
    var r = Math.round(d);
    if (r === 0) return DASH;
    return '<span class="num ' + (r > 0 ? 'up' : 'down') + '">' + (r > 0 ? '+' : '−') + fmt(Math.abs(d)) + '</span>';
  }

  function moversCard(D) {
    var body, cmp = D.curT > 0 && D.pct !== null;
    /* בלי צד אחד להשוואה (תחילת חודש בלי הוצאות / חודש ריק בשנה שעברה) כל הפסים היו
       ירוקים "ירדנו" או אדומים "עלינו" — מטעה. במקום זה שורה אחת, והפירוט נשאר בטבלה */
    if (!cmp) {
      body = '<div class="rk-foot" style="margin-top:0">' + esc(D.curT > 0
        ? 'אין מול מה להשוות. בטבלה למטה: ההוצאות של ' + heMonth(D.cur) + ' לפי קטגוריה.'
        : 'עוד אין הוצאות להשוות. בטבלה למטה: ההוצאות של ' + heMonth(D.prev) + ' לפי קטגוריה.') + '</div>';
    } else if (D.movers.length) {
      body = RK.diverge(D.movers.map(function (m) {
        return {
          iconHtml: m.rest ? '➕' : catIcon(m.k),
          label: m.rest ? REST + (m.n > 1 ? ' (' + m.n + ')' : '') : m.k,
          d: m.d
        };
      }));
      /* כניסה מדורגת לפסים — רק במעבר לדוח (הכיתה rk-enter פעילה רק תחת rk-entering) */
      var i = 0;
      body = body.replace(/<div class="rk-div-r">/g, function () { return '<div class="rk-div-r rk-enter"' + RK.stagger(1 + i++) + '>'; });
    } else {
      body = '<div class="rk-foot" style="margin-top:0">אף קטגוריה לא זזה באופן שמורגש — כמעט אותו חודש בדיוק 🙂</div>';
    }
    var rows = D.all.map(function (r) {
      return [{ html: catIcon(r.k) + ' ' + esc(r.k) },
        { html: amtCell(r.prev), cls: 'num' },
        { html: amtCell(r.cur), cls: 'num' },
        { html: diffCell(r.d), cls: 'num' }];
    });
    rows.push([{ html: '<strong>' + esc('סה"כ') + '</strong>' },
      { html: '<strong>' + amtCell(D.prevT) + '</strong>', cls: 'num' },
      { html: '<strong>' + amtCell(D.curT) + '</strong>', cls: 'num' },
      { html: '<strong>' + diffCell(D.diff) + '</strong>', cls: 'num' }]);
    /* כותרות: רק השנה — החודש כבר ידוע מהדוח, ושם חודש מלא מרחיב את העמודה */
    var table = RK.table(['קטגוריה',
      { html: esc(D.prev.slice(0, 4)), cls: 'num' },
      { html: esc(D.cur.slice(0, 4)), cls: 'num' },
      { html: 'הפרש', cls: 'num' }], rows);
    table += '<div class="rk-foot">' + esc('הסכומים ב-₪, ' + RK.monName(D.cur) + ' ' + D.prev.slice(0, 4) + ' מול ' +
      RK.monName(D.cur) + ' ' + D.cur.slice(0, 4) +
      (D.lo > 1 ? '. בשני החודשים נספרו רק הימים מה-' + D.lo + (D.partial ? ' עד ה-' + D.cut : '') + ' בחודש, כדי שההשוואה תהיה הוגנת.'
        : D.partial ? '. בשני החודשים נספרו רק הימים עד ה-' + D.cut + ' בחודש, כדי שההשוואה תהיה הוגנת.' : '.')) + '</div>';
    return RK.card(body + RK.details('כל הקטגוריות', table), cmp
      ? { title: 'מה זז', sub: 'מול ' + heMonth(D.prev) + ' · אדום = יותר, ירוק = פחות' }
      : { title: 'לפי קטגוריה' });
  }

  function html(D, P) {
    if (!D || D.state === 'future') return RK.card(RK.empty('🗓️', 'החודש הזה עוד לא התחיל', ''));
    if (D.state === 'noHistory') {
      return RK.card(D.opensPast
        ? RK.empty('🌱', 'אין נתונים מ' + heMonth(D.prev) + ' להשוואה',
          'הנתונים מתחילים ב' + heMonth(D.firstYm) + ', אז אפשר להשוות כל חודש מ' + D.opensAt + ' והלאה')
        : RK.empty('🌱', 'הדוח הזה ייפתח ב' + D.opensAt, 'כשתהיה שנה של נתונים להשוות אליה'));
    }
    if (D.state === 'lateStart') return RK.card(RK.empty('🌱', 'עוד אין ימים להשוות',
      'הנתונים של ' + heMonth(D.prev) + ' מתחילים רק ב-' + RK.dayLabel(D.first) + ', וההשוואה תיפתח מה-' + D.lo + ' בחודש'));
    if (D.state !== 'ok') return RK.card(RK.empty('🙂', 'אין הוצאות בחודשים האלה', heMonth(D.prev) + ' מול ' + heMonth(D.cur)));

    /* "1–8" בתוך טקסט עברי מתהפך ל-"8–1" — בידוד LTR דרך .num */
    var span = D.partial || D.lo > 1 ? '<span class="num">' + fmt(D.lo) + '–' + fmt(D.partial ? D.cut : RK.daysIn(D.cur)) + '</span> בחודש' : '';
    var deltaLine = '';
    if (D.curT > 0 && D.pct != null) {   /* מול חודש ריק, "▲ כל הסכום" לא אומר כלום */
      var flat = D.pct != null && Math.abs(D.pct) < 5;
      deltaLine = '<div style="display:flex;justify-content:center;align-items:center;gap:8px;flex-wrap:wrap;margin-top:-4px">' +
        RK.delta(D.diff, { money: true, flat: flat }) +
        (D.pct == null ? '' : '<span style="font-size:13px;font-weight:600;color:var(--dim)">' + signedPct(D.pct) + '</span>') +
        '</div>';
    }
    var top = '<div style="margin-bottom:14px"><div class="rk-g2">' +
      RK.kpis([{ lbl: heMonth(D.cur), val: D.curT, subHtml: span, tone: 'brand' }]) +
      RK.kpis([{ lbl: heMonth(D.prev), val: D.prevT, subHtml: span }]) +
      '</div>' + deltaLine + '</div>';

    return top + headline(D) + moversCard(D) + noteHtml(D);
  }

  REP_DEFS.push({
    k: 'lastyear',
    t: 'אותו חודש, לפני שנה',
    ic: '🔄',
    d: 'החודש מול אותו חודש בשנה שעברה: מה זז ולמה',
    g: 'מבט על החודש',
    period: 'month',
    calc: calc,
    html: html
  });
})();
