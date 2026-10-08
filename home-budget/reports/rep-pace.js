/* ============================================================
   rep-pace.js — "קצב החודש": עד היום, יותר או פחות מחודש רגיל באותו יום?
   ההשוואה היא לאותו יום בחודש (לא לחודש מלא), מול חציון של עד 6 החודשים
   המלאים הקודמים. הצפי לא לינארי: מה שנשאר "לחודש רגיל" אחרי היום נוסף
   למה שכבר הוצא, כך שחיוב קבוע ב-10 לחודש לא נספר פעמיים.
   ============================================================ */
(function () {
  'use strict';

  var C_CUR = '#5145cd', C_NORM = '#6b7280', C_BAND = 'rgba(81,69,205,.10)', C_BAND_LEG = 'rgba(81,69,205,.15)';
  var BAND = 'טווח רגיל';

  function zeros(n) { var a = new Array(n); for (var i = 0; i < n; i++) a[i] = 0; return a; }
  /* cum[0]=0, cum[d]=cum[d-1]+arr[d] עבור d=1..31 */
  function cum(arr) { var c = zeros(32); for (var d = 1; d <= 31; d++) c[d] = c[d - 1] + arr[d]; return c; }

  function calc(rows, P) {
    rows = rows || [];
    var kinds = RK.catKinds(P.cats), cur = monthOf(P.today), ym = P.ym;
    if (ym > cur) return { state: 'future' };
    var N = RK.daysIn(ym), partial = ym === cur;
    var D = partial ? Number(String(P.today).slice(8, 10)) : N;
    if (!(D >= 1 && D <= N)) D = partial ? Math.min(N, Math.max(1, D | 0)) : N;

    var cand = [];
    for (var k = 1; k <= 6; k++) { var m = addMonths(ym, -k); if (m < cur) cand.push(m); }
    var ly = addMonths(ym, -12);
    var slot = Object.create(null);
    [ym, ly].concat(cand).forEach(function (mm) { slot[mm] = { days: zeros(32), exp: false }; });

    /* מעבר אחד: סכום לפי יום לחודשים הרלוונטיים + התאריך הראשון בנתונים */
    var first = '';
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i], s = String(t.date || '');
      if (s && (!first || s < first)) first = s;
      var sl = slot[s.slice(0, 7)];
      if (!sl) continue;
      var day = Number(s.slice(8, 10));
      if (!(day >= 1 && day <= 31)) continue;
      var v = RK.amt(t, kinds);
      if (!v) continue;
      sl.days[day] += v;
      if (t.kind === 'expense') sl.exp = true;
    }

    /* חודש שבו הנתונים מתחילים באמצע (ייבוא ראשון מה-15) הוא לא "חודש מלא" */
    var firstM = first.slice(0, 7), firstDay = Number(first.slice(8, 10));
    var base = cand.filter(function (mm) { return slot[mm].exp && !(mm === firstM && firstDay > 3); });
    var baseN = base.length;
    /* חודש שעבר בלי הוצאות (למשל לפני תחילת הנתונים) — "אין הוצאות", לא "עוד אין חודש מלא" */
    if (!partial && !slot[ym].exp) return { state: 'none' };
    if (!baseN) return { state: 'nobase' };

    var cumB = base.map(function (mm) { return cum(slot[mm].days); });
    var tot = cumB.map(function (c) { return c[31]; });
    var cc = cum(slot[ym].days);
    var normalFull = RK.median(tot);
    var spentTo = cc[partial ? D : 31];
    /* ביום האחרון של חודש קצר משווים לחודש רגיל מלא (כמו normal[N] בגרף), לא ל"עד ה-30" של חודשים בני 31 */
    var normalTo = partial && D < N ? RK.median(cumB.map(function (c) { return c[D]; })) : normalFull;

    var normal = [], p25 = baseN >= 3 ? [] : null, p75 = baseN >= 3 ? [] : null;
    for (var d = 1; d <= N; d++) {
      var vals = d < N ? cumB.map(function (c) { return c[d]; }) : tot;
      normal.push(d < N ? RK.median(vals) : normalFull);
      if (p25) { p25.push(RK.quantile(vals, 0.25)); p75.push(RK.quantile(vals, 0.75)); }
    }

    var diff = spentTo - normalTo;
    var pct = normalTo > 0 ? Math.round(diff / normalTo * 100) : null;
    if (pct === 0) pct = 0;   // בלי ‎-0
    var status = pct === null ? 'na' : pct <= -5 ? 'slow' : pct < 5 ? 'even' : pct <= 20 ? 'fast' : 'vfast';
    var projected = partial ? spentTo + Math.max(0, normalFull - normalTo) : spentTo;
    var daysLeft = N - D, allowance = normalFull - spentTo;
    /* חיובים קבועים שעוד לא ירדו החודש (משכנתא, הלוואה, גן...) הם לא "כסף ליום" — מורידים אותם לפני החלוקה */
    var expFixed = 0, expN = 0, expNames = [];
    if (partial && daysLeft > 0) {
      var ef = RK.expectedFixed(rows, ym, D);
      expFixed = ef.sum; expN = ef.list.length;
      expNames = ef.list.slice(0, 3).map(function (e) { return e.desc; });
    }
    var freeLeft = allowance - expFixed;
    var perDay = (partial && daysLeft > 0 && freeLeft > 0) ? freeLeft / daysLeft : 0;

    var lyTo = null, lyFull = null;
    if (slot[ly].exp) { var lc = cum(slot[ly].days); lyTo = lc[partial ? D : 31]; lyFull = lc[31]; }

    return {
      state: 'ok', ym: ym, partial: partial, D: D, N: N, baseN: baseN,
      spentTo: spentTo, normalTo: normalTo, normalFull: normalFull, diff: diff, pct: pct, status: status,
      projected: projected, daysLeft: daysLeft, allowance: allowance, perDay: perDay, early: partial && D < 5,
      expFixed: expFixed, expN: expN, expNames: expNames, freeLeft: freeLeft,
      lyTo: lyTo, lyFull: lyFull,
      frac: normalFull > 0 ? spentTo / normalFull : 0,
      marker: partial && normalFull > 0 ? Math.min(1, normalTo / normalFull) : null,
      curCum: cc.slice(1, D + 1), normal: normal, p25: p25, p75: p75
    };
  }

  /* ---------- טקסטים ---------- */
  var PILL = {
    slow: ['🐢 לאט מהרגיל', 'ok'], even: ['🚶 בדיוק בקצב', 'brand'],
    fast: ['🏃 מהר מהרגיל', 'warn'], vfast: ['🚀 הרבה יותר מהר', 'bad']
  };
  var TONE = { slow: 'ok', even: 'brand', fast: 'warn', vfast: 'warn', na: 'brand' };
  function b(h) { return '<strong>' + h + '</strong>'; }
  function baseTxt(n) { return n === 1 ? 'לפי חודש אחד' : 'חציון של ' + n + ' חודשים'; }

  function headline(x) {
    var mon = esc(RK.monName(x.ym)), money = b(RK.money(x.spentTo)), ap = Math.abs(x.pct);
    if (x.partial) {
      var pre = 'עד ה-' + x.D + ' ב' + mon + ' הוצאתם ' + money;
      if (x.pct === null) return pre + '.';
      if (ap < 5) return pre + ', בדיוק כמו בחודש רגיל באותו יום 👌';
      return pre + ', ' + b(ap + '% ' + (x.pct > 0 ? 'יותר' : 'פחות')) + ' מחודש רגיל באותו יום.';
    }
    var pre2 = mon + ' נסגר ב-' + money;
    if (x.pct === null) return pre2 + '.';
    if (ap < 5) return pre2 + ', בדיוק כמו חודש רגיל 👌';
    return pre2 + ', ' + b(ap + '% ' + (x.pct > 0 ? 'מעל' : 'מתחת')) + (x.pct > 0 ? ' חודש רגיל.' : ' לחודש רגיל.');
  }

  function closing(x) {
    var txt = '', tone = 'brand', mon = esc(RK.monName(x.ym));
    if (x.partial) {
      if (x.normalFull <= 0) return null;
      var fx = x.expFixed > 0
        ? ' מתוכם כ-' + b(RK.money(x.expFixed)) + ' ' + (x.expN === 1 ? 'חיוב קבוע שעוד יירד' : 'חיובים קבועים שעוד יירדו') +
          (x.expNames && x.expNames.length ? ' (' + esc(x.expNames.join(', ')) + (x.expN > x.expNames.length ? ' ועוד' : '') + ')' : '') + '.'
        : '';
      if (x.allowance > 0 && x.daysLeft >= 1 && x.expFixed > 0 && x.freeLeft <= 0) {
        txt = 'כדי לסיים כמו חודש רגיל, נשארו לכם כ-' + b(RK.money(x.allowance)) + '.' + fx +
          ' כלומר החיובים הקבועים שעוד לפניכם כבר ממלאים את מה שנשאר מחודש רגיל.';
        tone = 'warn';
      } else if (x.allowance > 0 && x.daysLeft > 1) {
        txt = 'כדי לסיים כמו חודש רגיל, נשארו לכם כ-' + b(RK.money(x.allowance)) + ' ל-' + x.daysLeft + '&nbsp;הימים הבאים.' + fx +
          ' ' + (x.expFixed > 0 ? 'לשאר ההוצאות נשארו כ-' + b(RK.money(x.freeLeft)) + ', ' : '') +
          'בערך ' + b(RK.money(x.perDay)) + ' ליום.';
      } else if (x.allowance > 0 && x.daysLeft === 1) {
        txt = 'כדי לסיים כמו חודש רגיל, נשארו לכם כ-' + b(RK.money(x.allowance)) + ' ליום האחרון.' + fx;
      } else if (x.allowance > 0) {
        txt = 'היום האחרון של החודש, ואתם עדיין ' + b(RK.money(x.allowance)) + ' מתחת לחודש רגיל 🎉';
        tone = 'ok';
      } else {
        txt = 'כבר עברתם את הסכום של חודש רגיל (' + b(RK.money(x.normalFull)) + '). מכאן כל הוצאה נוספת היא מעבר לחודש רגיל.';
        tone = 'warn';
      }
      if (x.early) txt += ' עוד מוקדם לשפוט: חיוב גדול אחד מזיז הכול.';
      if (x.lyFull && x.lyFull > x.normalFull * 1.15)
        txt += ' בשנה שעברה ' + mon + ' היה יקר ב-' + Math.round((x.lyFull / x.normalFull - 1) * 100) + '% מחודש רגיל, אולי כדאי להיערך.';
      return { txt: txt, tone: tone };
    }
    if (x.status === 'slow') {
      txt = 'נשארו בצד ' + b(RK.money(-x.diff)) + ' לעומת חודש רגיל 🎉 שווה להעביר אותם לחיסכון.'; tone = 'ok';
    } else if (x.status === 'fast' || x.status === 'vfast') {
      txt = 'החודש עלה ' + b(RK.money(x.diff)) + ' יותר מחודש רגיל. אם זה בגלל חג או קנייה גדולה, זה בסדר, רק כדאי לדעת.'; tone = 'warn';
      /* בחודש שנסגר "להיערך" כבר מאוחר; אבל אם גם בשנה שעברה הוא היה יקר — זה מסביר את החריגה */
      if (x.lyFull && x.normalFull > 0 && x.lyFull > x.normalFull * 1.15)
        txt += ' גם בשנה שעברה ' + mon + ' היה יקר ב-' + Math.round((x.lyFull / x.normalFull - 1) * 100) + '% מחודש רגיל, כנראה עונה יקרה.';
    } else if (x.status === 'even') {
      txt = 'חודש רגיל לגמרי 👌';
    }
    return txt ? { txt: txt, tone: tone } : null;
  }

  function html(x, P) {
    if (!x || x.state !== 'ok') {
      if (x && x.state === 'future') return RK.card(RK.empty('🗓️', 'החודש הזה עוד לא התחיל', ''));
      if (x && x.state === 'none') return RK.card(RK.empty('🙂', 'אין הוצאות בחודש הזה', ''));
      return RK.card(RK.empty('🌱', 'עוד אין חודש מלא להשוואה', 'הדוח יתמלא אחרי החודש המלא הראשון'));
    }
    var h = '';

    /* 1) שורת התובנה */
    var pill = PILL[x.status], tags = (pill ? RK.pill(pill[0], pill[1]) : '') + RK.partial(P);
    h += RK.insight((tags ? '<div class="rep-pace-tags" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">' + tags + '</div>' : '') +
      headline(x), { tone: TONE[x.status] || 'brand' });

    /* 2) טבעת + מספרים */
    var ring = RK.ring({
      frac: x.frac, size: 168, stroke: 14,
      color: x.pct !== null && x.pct > 5 ? 'var(--warn)' : 'var(--brand)',
      over: Math.max(0, x.frac - 1), overColor: 'var(--bad)', marker: x.marker,
      centerHtml: '<span class="rep-pace-big" style="font-size:20px;font-weight:800;letter-spacing:-.02em;color:var(--ink)">' +
        RK.money(x.spentTo) + '</span><small style="display:block;font-size:11.5px;color:var(--dim);font-weight:500;margin-top:3px">' +
        'מתוך כ-' + RK.money(x.normalFull) + '</small>',
      aria: 'הוצאתם ' + fmt(x.spentTo) + ' ₪ מתוך חודש רגיל של ' + fmt(x.normalFull) + ' ₪'
    });
    var cap = x.marker != null
      ? '<div class="rep-pace-cap" style="font-size:11.5px;color:var(--dim);text-align:center"><span aria-hidden="true" style="color:var(--ink2)">●</span> הנקודה = כאן הייתם בחודש רגיל</div>'
      : '';
    var kp = x.partial ? [
      { lbl: 'עד היום', val: x.spentTo, unit: '₪' },
      { lbl: 'חודש רגיל עד ה-' + x.D, val: x.normalTo, unit: '₪', sub: baseTxt(x.baseN) },
      { lbl: 'אם תמשיכו כרגיל', val: x.projected, unit: '₪', sub: 'צפי לסוף החודש' }
    ] : [
      { lbl: 'סה״כ החודש', val: x.spentTo },
      { lbl: 'חודש רגיל', val: x.normalFull, sub: baseTxt(x.baseN) },
      { lbl: 'הפרש', valHtml: RK.money(x.diff, { sign: true }), tone: x.status === 'even' ? '' : x.diff > 0 ? 'up' : 'down' }
    ];
    h += RK.card(
      '<div class="rep-pace-hero" style="display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:16px 24px">' +
      '<div class="rep-pace-ringbox" style="display:flex;flex-direction:column;align-items:center;gap:8px;flex:0 0 auto">' + ring + cap + '</div>' +
      '<div class="rep-pace-kp" style="flex:1 1 440px;min-width:0">' + RK.kpis(kp) + '</div></div>',
      { cls: 'rep-pace' });

    /* 3) גרף מצטבר */
    var leg = [{ color: C_CUR, label: 'החודש' }, { color: C_NORM, label: 'חודש רגיל', dashed: true }];
    if (x.p25) leg.push({ color: C_BAND_LEG, label: BAND });
    var lyLine = '';
    if (x.lyTo != null) {
      lyLine = '<div class="rep-pace-ly" style="font-size:12.5px;color:var(--dim);margin-top:8px">' +
        (x.partial ? 'באותו חודש בשנה שעברה, עד ה-' + x.D + ': ' + RK.money(x.lyTo)
                   : 'באותו חודש בשנה שעברה: ' + RK.money(x.lyFull)) + '</div>';
    }
    h += RK.card(
      '<div class="rk-chart" style="height:220px"><canvas role="img" aria-label="הוצאות מצטברות לפי יום בחודש, מול חודש רגיל"></canvas></div>' +
      '<div style="margin-top:10px">' + RK.legend(leg) + '</div>' + lyLine,
      { title: 'איך החודש מתקדם', sub: 'הוצאות מצטברות, יום אחרי יום', cls: 'rep-pace' });

    /* 4) מה עושים עם זה */
    var cl = closing(x);
    if (cl) h += RK.insight(cl.txt, { tone: cl.tone });
    h += '<div class="rk-foot">' + (x.baseN === 1 ? 'חודש רגיל = החודש המלא האחרון שיש בו נתונים.'
      : 'חודש רגיל = חציון של ' + x.baseN + ' החודשים המלאים האחרונים.') +
      (x.expFixed > 0 ? ' חיובים קבועים צפויים = מה שחזר כל חודש (או חודשיים) ועוד לא ירד החודש.' : '') +
      ' זיכוי שסווג לקטגוריית הוצאה מקוזז; תנועות שממתינות לסיווג לא נכללות.</div>';
    return h;
  }

  function mount(root, x) {
    if (!x || x.state !== 'ok' || !root) return;
    var cv = root.querySelector('.rk-chart canvas');
    if (!cv) return;
    var N = x.N, D = x.D, labels = [], cur = [];
    for (var d = 1; d <= N; d++) { labels.push(d); cur.push(d <= x.curCum.length ? x.curCum[d - 1] : null); }
    var ds = [];
    if (x.p75) {
      ds.push({ label: BAND, data: x.p75, borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, fill: false, order: 2 });
      ds.push({ label: BAND, data: x.p25, borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, fill: '-1', backgroundColor: C_BAND, order: 2 });
    }
    ds.push({ label: 'חודש רגיל', data: x.normal, borderColor: C_NORM, borderDash: [5, 4], borderWidth: 1.5,
      pointRadius: 0, pointHoverRadius: 3, pointBackgroundColor: C_NORM, order: 1 });
    ds.push({ label: 'החודש', data: cur, borderColor: C_CUR, borderWidth: 2.5, backgroundColor: C_CUR,
      pointRadius: function (c) { return c.dataIndex === D - 1 ? 4 : 0; }, pointHoverRadius: 4,
      pointBackgroundColor: C_CUR, order: 0 });
    repChart(cv, {
      type: 'line',
      data: { labels: labels, datasets: ds },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index', intersect: false,
            filter: function (it) { return it.dataset.label !== BAND; },
            callbacks: {
              title: function (items) { return items && items.length ? 'יום ' + items[0].label : ''; },
              label: function (c) { return c.dataset.label + ': ' + fmt(c.parsed && c.parsed.y) + ' ₪'; }
            }
          }
        },
        scales: {
          x: { ticks: { maxTicksLimit: 8, maxRotation: 0 } },
          y: { beginAtZero: true, ticks: { callback: RK.axisMoney } }
        }
      }
    });
  }

  REP_DEFS.push({
    k: 'pace', t: 'קצב החודש', ic: '🏃',
    d: 'עד היום: יותר או פחות מחודש רגיל, וכמה נשאר ליום',
    g: 'מבט על החודש', period: 'month',
    calc: calc, html: html, mount: mount
  });
})();
