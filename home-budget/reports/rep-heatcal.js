/* ============================================================
   rep-heatcal.js — "לוח החודש": מפת חום של ימי החודש, 🌱 על ימים שקטים.
   ברירת המחדל מסתירה חיובים קבועים (RK.recurring), כדי שהצבעים יראו הרגלים
   יומיים ולא את יום המשכנתא. זיכויים לא נספרים — הלוח מראה כסף שיצא.
   CSS: rep-heatcal.css (כל בורר מתחיל ב-.rep-heatcal).
   ============================================================ */
(function () {
  'use strict';
  var mode = 'var';   // המתג נשמר בזיכרון בין חודשים; 'var' רק כשיש מספיק היסטוריה לזהות קבועים
  var DOW = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  var DOW_LONG = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  var DET_MAX = 6;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function numSpan(s) { return '<span class="num">' + esc(s) + '</span>'; }

  /* ---------- חישוב לכל מצב (משתנות בלבד / הכול) ---------- */
  /* "יום שקט" נספר רק בימי חול: שבת בלי קניות היא לא החלטה, והייתה מנפחת את המספר ואת הרצף.
     רצף עובר דרך שבת שקטה בלי להישבר ובלי לגדול. שבת עם הוצאה כן נספרת כיום עם הוצאה. */
  function modeStats(sums, tops, days, N) {
    var vals = [], pastDays = 0, spendDays = 0, quietDays = 0, run = 0, longest = 0, heavy = null, total = 0;
    for (var d = 1; d <= N; d++) {
      if (days[d - 1].st !== 'past') { run = 0; continue; }
      pastDays++;
      var s = sums[d];
      if (s > 0) {
        spendDays++; vals.push(s); run = 0; total += s;
        if (!heavy || s > heavy.sum) heavy = { d: d, sum: s, topDesc: tops[d] ? tops[d].desc : '' };
      } else if (!days[d - 1].sat) {
        quietDays++; run++;
        if (run > longest) longest = run;
      }
    }
    vals.sort(function (a, b) { return a - b; });
    var cut = null, n = vals.length;
    if (n >= 4) cut = { q1: vals[Math.floor(0.25 * (n - 1))], q2: vals[Math.floor(0.5 * (n - 1))], q3: vals[Math.floor(0.75 * (n - 1))] };
    var sumArr = [], lv = [], counts = [0, 0, 0, 0, 0];
    for (d = 1; d <= N; d++) {
      var v = sums[d], l = 0;
      if (days[d - 1].st === 'past' && v > 0) l = !cut ? 2 : v <= cut.q1 ? 1 : v <= cut.q2 ? 2 : v <= cut.q3 ? 3 : 4;
      if (days[d - 1].st === 'past') counts[l]++;
      sumArr.push(v);
      lv.push(l);
    }
    return {
      sums: sumArr, lv: lv, cut: cut, counts: counts, total: total,
      pastDays: pastDays, spendDays: spendDays, quietDays: quietDays, longestQuiet: longest, heaviest: heavy
    };
  }

  function calc(rows, P) {
    rows = rows || [];
    var cur = monthOf(P.today), ym = P.ym;
    if (ym > cur) return { state: 'future', ym: ym };
    var first = RK.firstDate(rows);
    var lo = addMonths(ym, -12), hi = addMonths(ym, -1);
    var histM = new Set(), mine = [];
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i];
      if (t.kind !== 'expense') continue;
      var m = monthOf(t.date);
      if (m === ym) mine.push(t);
      else if (m >= lo && m <= hi && /^\d{4}-\d{2}$/.test(m)) histM.add(m);
    }
    var useFixed = histM.size >= 3;
    var rec = useFixed ? RK.recurring(rows, hi) : new Map();
    var N = RK.daysIn(ym);
    var all = [], vr = [], allTop = [], vrTop = [], det = {}, fixedN = 0, fixedSum = 0, used = 0;
    for (var d0 = 0; d0 <= N; d0++) { all.push(0); vr.push(0); allTop.push(null); vrTop.push(null); }
    for (i = 0; i < mine.length; i++) {
      t = mine[i];
      var d = Number(String(t.date).slice(8, 10));
      if (!(d >= 1 && d <= N) || d !== Math.floor(d)) continue;
      var a = num(t.amount), fixed = !!RK.recKey(rec, t);
      used++;
      all[d] += a;
      if (!allTop[d] || a > allTop[d].a) allTop[d] = { a: a, desc: normDesc(t.desc) };
      if (fixed) { if (String(t.date).slice(0, 10) <= P.today) { fixedN++; fixedSum += a; } }   // רק ימים שכבר עברו, כמו הלוח
      else {
        vr[d] += a;
        if (!vrTop[d] || a > vrTop[d].a) vrTop[d] = { a: a, desc: normDesc(t.desc) };
      }
      (det[d] = det[d] || []).push({ desc: normDesc(t.desc), amount: a, category: t.category || '', fixed: fixed });
    }
    if (!used) return { state: 'none', ym: ym };

    var firstDow = RK.wd(ym + '-01'), days = [];
    for (d = 1; d <= N; d++) {
      var ds = ym + '-' + pad2(d);
      days.push({ d: d, st: ds > P.today ? 'future' : (first && ds < first ? 'nodata' : 'past'), today: ds === P.today,
        sat: (firstDow + d - 1) % 7 === 6 });
    }
    var modes = { all: modeStats(all, allTop, days, N) };
    if (useFixed) {
      modes['var'] = modeStats(vr, vrTop, days, N);
      modes['var'].fixedN = fixedN;
      modes['var'].fixedSum = fixedSum;
    }
    var detOut = {};
    Object.keys(det).forEach(function (k) {
      var L = det[k].slice().sort(function (x, y) { return y.amount - x.amount; });
      var rest = L.slice(DET_MAX), dn = Number(k);
      detOut[k] = {
        sum: all[dn], vsum: useFixed ? vr[dn] : all[dn],
        items: L.slice(0, DET_MAX),
        restN: rest.length, restSum: rest.reduce(function (s, x) { return s + x.amount; }, 0)
      };
    });
    return {
      state: 'ok', ym: ym, partial: ym === cur, N: N, firstDow: firstDow, days: days,
      useFixed: useFixed, modes: modes, det: detOut
    };
  }

  /* ---------- HTML ---------- */
  function insightHtml(M, data) {
    var mon = RK.monName(data.ym), when = 'ב' + esc(mon) + (data.partial ? ' עד עכשיו' : ''), s;
    if (M.quietDays > 0) {
      s = when + (M.quietDays === 1 ? ' היה <strong>יום חול אחד</strong> בלי קניות 🌱' : ' היו <strong>' + M.quietDays + ' ימי חול</strong> בלי קניות 🌱') +
        (M.longestQuiet >= 2 ? ', והרצף הארוך ביותר: <strong>' + M.longestQuiet + ' ימים</strong> (בלי לספור שבת).' : '.');
    } else if (M.spendDays > 0) {
      s = when + ' יצא כסף כל יום 🙂';
    } else {
      s = when + ' עוד אין ימים להצגה.';
    }
    var h = M.heaviest;
    if (h) {
      s += ' היום הכבד: <strong>' + esc(RK.dayLabel(data.ym + '-' + pad2(h.d))) + '</strong> · ' + RK.money(h.sum) +
        (h.topDesc ? ' (' + esc(h.topDesc) + ')' : '') + '.';
    }
    return RK.insight(s);
  }

  function kpisHtml(M, data) {
    var h = M.heaviest;
    return RK.kpis([
      { lbl: 'ימים עם הוצאה', valHtml: numSpan(String(M.spendDays)),
        subHtml: esc('מתוך ' + M.pastDays + ' ימים') + (M.total > 0 ? ' · סה״כ ' + RK.money(M.total) : '') },
      { lbl: '🌱 ימים שקטים', val: M.quietDays, unit: '', sub: 'ימי חול בלי קניות' + (M.longestQuiet >= 2 ? ' · רצף: ' + M.longestQuiet : '') },
      h ? { lbl: '🔥 היום הכבד', valHtml: RK.money(h.sum), sub: RK.dayLabel(data.ym + '-' + pad2(h.d)) }
        : { lbl: '🔥 היום הכבד', valHtml: numSpan('—'), sub: '' }
    ]);
  }

  function gridHtml(M, data) {
    var g = '<div class="rep-heatcal-grid rk-enter"' + RK.stagger(2) + ' role="group" aria-label="' + esc('לוח ' + heMonth(data.ym)) + '">';
    for (var w = 0; w < 7; w++) {
      g += '<div class="rep-heatcal-h" aria-hidden="true"' + (w === 6 ? ' title="שבת"' : '') + '>' + DOW[w] + '</div>';
    }
    for (var i = 0; i < data.firstDow; i++) g += '<div class="rep-heatcal-sp" aria-hidden="true"></div>';
    for (var d = 1; d <= data.N; d++) {
      var day = data.days[d - 1], tcls = day.today ? ' today' : '';
      if (day.st === 'future') { g += '<div class="rep-heatcal-cell fut' + tcls + '"><span class="d">' + d + '</span></div>'; continue; }
      if (day.st === 'nodata') { g += '<div class="rep-heatcal-cell nd' + tcls + '"><span class="d">' + d + '</span><span class="q" aria-hidden="true">·</span></div>'; continue; }
      var s = M.sums[d - 1], lv = M.lv[d - 1];
      var open = '<button type="button" class="rep-heatcal-cell L' + lv + tcls + '"' + act('rep_heatcal_day', String(d)) +
        ' aria-pressed="false"' + (day.today ? ' aria-current="date"' : '');
      if (s > 0) {
        var lab = fmt(s);
        g += open + ' aria-label="' + esc('יום ' + d + ': ' + lab + ' ₪') + '"><span class="d">' + d + '</span>' +
          '<span class="num a' + (lab.length >= 7 ? ' xxs' : lab.length >= 6 ? ' xs' : '') + '">' + esc(lab) + '</span></button>';
      } else {
        g += open + ' aria-label="' + esc('יום ' + d + ': בלי קניות') + '"><span class="d">' + d + '</span>' +
          '<span class="q" aria-hidden="true">🌱</span></button>';
      }
    }
    return g + '</div>';
  }

  function legendHtml(M) {
    var chips = [], c = M.cut;
    function sw(l) { return '<i class="rep-heatcal-sw L' + l + '" aria-hidden="true"></i>'; }
    if (c) {
      var L = [
        [1, 'עד ' + numSpan(fmt(c.q1))],
        [2, numSpan(fmt(c.q1) + '–' + fmt(c.q2))],
        [3, numSpan(fmt(c.q2) + '–' + fmt(c.q3))],
        [4, 'מעל ' + RK.money(c.q3)]
      ];
      L.forEach(function (x) { if (M.counts[x[0]] > 0) chips.push(sw(x[0]) + x[1]); });
    } else if (M.spendDays > 0) chips.push(sw(2) + 'ימים עם הוצאה');
    if (M.quietDays > 0) chips.push('🌱 בלי קניות');
    return chips.length ? '<div class="rep-heatcal-leg">' + RK.chips(chips) + '</div>' : '';
  }

  function blockHtml(M, m, data, vis) {
    var foot = 'הקישו על יום כדי לראות מה יצא בו.';
    if (m === 'var' && M.fixedN > 0) {
      foot = '🔒 ' + (M.fixedN === 1 ? 'חיוב קבוע אחד' : M.fixedN + ' חיובים קבועים') + ' (' + RK.money(M.fixedSum) +
        ') לא נצבעים כאן — רואים אותם ב״הכול״. ' + foot;
    }
    return '<div class="rep-heatcal-mode" data-m="' + m + '"' + (m === vis ? '' : ' hidden') + '>' +
      insightHtml(M, data) + kpisHtml(M, data) +
      RK.card(gridHtml(M, data) + legendHtml(M) + '<div class="rk-foot rep-heatcal-foot">' + foot + '</div>', { cls: 'rep-heatcal-cal' }) +
      '</div>';
  }

  /* הסכום בכותרת הפירוט תואם למה שהתא מראה: במצב "בלי חיובים קבועים" — רק המשתנות, והקבועים בנפרד */
  function headVal(x, useFixed) {
    if (!x || !(x.sum > 0)) return '';
    var all = '<span class="v" data-m="all">' + RK.money(x.sum) + '</span>';
    if (!useFixed) return all;
    var fx = x.sum - x.vsum;
    return '<span class="v" data-m="var">' + (x.vsum > 0 ? RK.money(x.vsum) : '') +
      (fx > 0.005 ? '<small class="fx">' + (x.vsum > 0 ? '+ ' : '') + RK.money(fx) + ' קבועים</small>' : '') + '</span>' + all;
  }

  function detHtml(data) {
    var h = '<div class="rep-heatcal-dets">';
    for (var d = 1; d <= data.N; d++) {
      var day = data.days[d - 1];
      if (day.st !== 'past') continue;
      var x = data.det[d], date = data.ym + '-' + pad2(d), anyFixed = false;
      h += '<div class="rep-heatcal-det" data-d="' + d + '" hidden>' +
        '<div class="rep-heatcal-det-h"><span class="t">' + esc(RK.dayLabel(date)) +
        '<span class="w">· יום ' + esc(DOW_LONG[RK.wd(date)]) + '</span></span>' +
        headVal(x, data.useFixed) +
        '<button type="button" class="rep-heatcal-x"' + act('rep_heatcal_day', String(d)) + ' aria-label="סגירה">×</button></div>';
      if (!x || !(x.vsum > 0)) h += '<div class="rep-heatcal-q">🌱 יום בלי קניות' + (x && x.items.length ? ' — רק חיובים קבועים:' : '') + '</div>';
      if (x && x.items.length) {
        h += RK.legend(x.items.map(function (it) {
          if (it.fixed) anyFixed = true;
          return { color: catColor(it.category), iconHtml: catIcon(it.category), label: it.desc + (it.fixed ? ' 🔒' : ''), valueHtml: RK.money(it.amount) };
        }));
        if (x.restN > 0) {
          h += '<div class="rep-heatcal-more">+ ' + (x.restN === 1 ? 'עוד תנועה אחת' : 'עוד ' + x.restN + ' תנועות') +
            ' (' + RK.money(x.restSum) + ')</div>';
        }
        if (anyFixed) h += '<div class="rk-foot">🔒 = חיוב קבוע (חוזר כל חודש)</div>';
      }
      h += '</div>';
    }
    return h + '</div>';
  }

  function wrap(inner, m) { return '<div class="rep-heatcal"' + (m ? ' data-mode="' + m + '"' : '') + '>' + inner + '</div>'; }

  function html(data, P) {
    if (!data || data.state === 'future') return wrap(RK.card(RK.empty('🗓️', 'החודש הזה עוד לא התחיל', '')));
    if (data.state !== 'ok') return wrap(RK.card(RK.empty('🌱', 'אין הוצאות בחודש הזה', '')));
    var vis = mode === 'var' && data.useFixed && data.modes['var'] ? 'var' : 'all';
    var seg = data.useFixed ? RK.seg([
      { id: 'var', label: '🛒 בלי חיובים קבועים', on: vis === 'var' },
      { id: 'all', label: 'הכול', on: vis === 'all' }
    ], 'rep_heatcal_mode') : '';
    var part = RK.partial(P), h = '';
    if (seg || part) h += '<div class="rep-heatcal-top">' + seg + part + '</div>';
    ['var', 'all'].forEach(function (m) { if (data.modes[m]) h += blockHtml(data.modes[m], m, data, vis); });
    h += detHtml(data);
    return wrap(h, vis);
  }

  /* ---------- פעולות (בלי innerHTML — רק hidden / aria-pressed) ---------- */
  function each(list, fn) { for (var i = 0; i < list.length; i++) fn(list[i]); }

  ACTIONS.rep_heatcal_mode = function (id, el) {
    if (id !== 'var' && id !== 'all') return;
    var r = el && el.closest && el.closest('.rep-heatcal');
    if (!r) return;
    mode = id;
    r.setAttribute('data-mode', id);
    each(r.querySelectorAll('.rep-heatcal-mode'), function (b) { b.hidden = b.getAttribute('data-m') !== id; });
    each(r.querySelectorAll('[data-act="rep_heatcal_mode"]'), function (b) {
      var on = b.getAttribute('data-id') === id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  };

  ACTIONS.rep_heatcal_day = function (id, el) {
    var r = el && el.closest && el.closest('.rep-heatcal');
    if (!r) return;
    var target = null, dets = r.querySelectorAll('.rep-heatcal-det');
    var cells = r.querySelectorAll('.rep-heatcal-cell[data-act="rep_heatcal_day"]');
    each(dets, function (x) { if (x.getAttribute('data-d') === id) target = x; });
    if (target && !target.hidden) {
      target.hidden = true;
      each(cells, function (c) { c.setAttribute('aria-pressed', 'false'); });
      return;
    }
    each(dets, function (x) { x.hidden = true; });
    each(cells, function (c) { c.setAttribute('aria-pressed', c.getAttribute('data-id') === id ? 'true' : 'false'); });
    if (!target) return;
    target.hidden = false;
    try {
      target.scrollIntoView({ block: 'nearest', behavior: RK.reducedMotion() ? 'auto' : 'smooth' });
    } catch (e) { }
  };

  REP_DEFS.push({
    k: 'heatcal',
    t: 'לוח החודש',
    ic: '📅',
    d: 'החודש יום אחרי יום: איפה יצא כסף ואיפה היו ימים שקטים',
    g: 'מבט על החודש',
    period: 'month',
    calc: calc,
    html: html
  });
})();
