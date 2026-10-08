/* ============================================================
   rep-savings.js — "מכל 100 ₪ שנכנסו": לאן הלך כל שקל השנה, וכמה נשאר.
   וופל 10×10 (כל ריבוע = שקל מתוך 100 שנכנסו) + עמודות "נשאר" לכל חודש,
   קו מצטבר, והחודש הכי טוב/חלש. מתארים מה קרה — בלי יעד שהמשפחה לא בחרה.
   הסכומים נספרים רק על חודשים שלמים: לא החודש הנוכחי, ולא חודש ראשון שהנתונים בו מתחילים
   באמצע (RK.firstFullMonth) — בשניהם יש הוצאות בלי המשכורת, והם היו נראים כ"הפסד".
   ============================================================ */
(function () {
  'use strict';

  var NOCAT = 'ללא קטגוריה', REST = 'שאר', C_REST = '#cbd5e1', C_LEFT = '#047857', C_LINE = '#5145cd';
  var C_POS = '#047857', C_NEG = '#be123c', C_POS_P = 'rgba(4,120,87,.35)', C_NEG_P = 'rgba(190,18,60,.35)';
  var TOP = 7;

  function pctTxt(r) { var v = Math.round(r * 100); return (v < 0 ? '−' : '') + Math.abs(v) + '%'; }
  function b(h) { return '<strong>' + h + '</strong>'; }
  /* טקסט פשוט (sub של המקרא מוברח) — בידוד LTR כדי ש"43,380 ₪" לא יתהפך ל"₪ 43,380" */
  function ltr(s) { return '\u2066' + s + '\u2069'; }

  /* מספרים שלמים שסכומם בדיוק total (שארית גדולה) — כמו RK.shares100, ליעד אחר */
  function sharesTo(values, total) {
    var v = values.map(function (x) { x = Number(x); return isFinite(x) && x > 0 ? x : 0; });
    var s = v.reduce(function (a, c) { return a + c; }, 0);
    total = Math.max(0, Math.round(total));
    if (!s || !total) return v.map(function () { return 0; });
    var raw = v.map(function (x) { return x / s * total; }), out = raw.map(Math.floor);
    var left = total - out.reduce(function (a, c) { return a + c; }, 0);
    var ord = raw.map(function (r, i) { return { i: i, f: r - Math.floor(r) }; })
      .sort(function (a, c) { return c.f - a.f || a.i - c.i; });
    for (var k = 0; k < left && k < ord.length; k++) out[ord[k].i]++;
    return out;
  }

  function calc(rows, P) {
    rows = rows || [];
    var kinds = RK.catKinds(P.cats), Y = String(P.year || ''), cur = monthOf(P.today), curY = cur.slice(0, 4);
    var head = RK.firstFullMonth(rows).headPartial;
    if (!/^\d{4}$/.test(Y)) return { state: 'empty' };
    if (Y > curY) return { state: 'future' };

    /* מעבר אחד על השורות של השנה */
    var inc = Object.create(null), exp = Object.create(null), catExp = Object.create(null), firstM = '';
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i], d = String(t.date || '');
      if (d.slice(0, 4) !== Y) continue;
      var m = d.slice(0, 7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) continue;
      if (!firstM || m < firstM) firstM = m;
      if (RK.isIncome(t, kinds)) { inc[m] = (inc[m] || 0) + num(t.amount); continue; }
      var v = RK.amt(t, kinds);
      if (!v) continue;
      exp[m] = (exp[m] || 0) + v;
      var ce = catExp[m] || (catExp[m] = Object.create(null)), cn = t.category || NOCAT;
      ce[cn] = (ce[cn] || 0) + v;
    }
    if (!firstM) return { state: 'empty' };

    var startM = firstM > Y + '-01' ? firstM : Y + '-01', endM = cur < Y + '-12' ? cur : Y + '-12';
    var monthsList = [];
    for (var mm = startM, g = 0; mm <= endM && g < 12; mm = addMonths(mm, 1), g++) monthsList.push(mm);
    var complete = monthsList.filter(function (x) { return x < cur && x !== head; });
    /* אין אף חודש שלם: בשנה הנוכחית — החודש הנוכחי עד היום; בשנה קודמת — מה שיש (החודש הראשון החלקי) */
    var partialOnly = !complete.length && Y === curY;
    var headOnly = !complete.length && !partialOnly;
    var S = partialOnly ? [cur] : headOnly ? monthsList.slice() : complete;
    var headSkipped = !!head && monthsList.indexOf(head) >= 0 && S.indexOf(head) < 0;
    var lastM = S[S.length - 1], late = S[0] > Y + '-01';

    var totInc = 0, sumExp = 0;
    S.forEach(function (x) { totInc += inc[x] || 0; sumExp += exp[x] || 0; });
    var totExp = Math.max(0, sumExp), saved = totInc - totExp;

    var label = (Y === curY && !partialOnly) ? 'עד סוף ' + RK.monName(lastM) : (partialOnly ? 'עד היום' : Y);
    /* חלק הסוגריים במשפטים: בשנה הנוכחית תמיד, ובשנה קודמת רק אם הנתונים התחילו באמצעה */
    var labelPart = Y === curY
      ? (partialOnly ? 'עד היום' : (late ? 'מ' + RK.monName(S[0]) + ' ' : '') + 'עד סוף ' + RK.monName(lastM))
      : headOnly ? 'רק חלק מ' + RK.monName(S[0])
      : (late ? 'מ' + RK.monName(S[0]) + ' עד סוף השנה' : '');
    if (totInc <= 0) return { state: 'noIncome', totExp: totExp, label: label, Y: Y, labelPart: labelPart };
    var rate = saved / totInc;

    /* קטגוריות על חודשי הסיכום בלבד */
    var catSum = Object.create(null);
    S.forEach(function (x) {
      var ce = catExp[x];
      if (!ce) return;
      for (var k in ce) catSum[k] = (catSum[k] || 0) + ce[k];
    });
    var all = [];
    for (var cn2 in catSum) if (catSum[cn2] > 0) all.push({ name: cn2, v: catSum[cn2] });
    all.sort(function (a, c) { return c.v - a.v || (a.name < c.name ? -1 : a.name > c.name ? 1 : 0); });
    var per100 = Object.create(null);
    all.forEach(function (c) { per100[c.name] = Math.round(c.v / totInc * 100); });
    var cats = (all.length <= TOP + 1 ? all : all.slice(0, TOP)).map(function (c) {
      return { name: c.name, v: c.v, color: catColor(c.name), rest: false };
    });
    if (all.length > TOP + 1) {
      var rv = 0;
      all.slice(TOP).forEach(function (c) { rv += c.v; });
      cats.push({ name: REST, v: rv, color: C_REST, rest: true, n: all.length - TOP });
    }

    var leftover = Math.max(0, saved), over = Math.max(0, -saved), base = Math.max(totInc, totExp);
    var per100Left = Math.max(-100, Math.min(100, Math.round(rate * 100)));
    var expPer100 = Math.round(totExp / totInc * 100);
    var catVals = cats.map(function (c) { return c.v; });

    /* ריבועים: כשנשאר משהו — הירוקים הם בדיוק per100Left (אותו מספר כמו במשפט וב-KPI),
       והקטגוריות מתחלקות בשאר. כשיצא יותר — 100 הריבועים הם ההוצאות, והאחרונים מקווקווים. */
    var catSq, leftSq, legN, overN = 0;
    if (saved >= 0) {
      leftSq = Math.max(0, Math.min(100, per100Left));
      catSq = sharesTo(catVals, 100 - leftSq);
      legN = catSq.slice();
    } else {
      leftSq = 0;
      catSq = RK.shares100(catVals.map(function (v) { return v / base; }));
      legN = catSq.slice();   // כל ריבוע = 1% מההוצאות — המספר בשורה = מספר הריבועים שהיא מדגישה
      overN = totExp > totInc ? Math.round(over / totExp * 100) : 0;
    }
    var squares = [];
    cats.forEach(function (c, ci) { for (var q = 0; q < catSq[ci]; q++) squares.push({ c: ci, color: c.color }); });
    for (var q2 = 0; q2 < leftSq; q2++) squares.push({ c: cats.length, color: C_LEFT, left: true });
    while (squares.length < 100) squares.push({ c: -1, color: '#eef0f3' });
    squares.length = 100;
    for (var o = 0; o < overN; o++) squares[99 - o].over = true;
    for (var pi = 99; pi >= 0; pi--) if (squares[pi].left) { squares[pi].pig = true; break; }

    /* חודש אחרי חודש */
    /* הגרף מראה רק חודשים שלמים: חודש חלקי בלי משכורת היה עמודה אדומה ענקית שקובעת את הציר */
    var monthly = complete.map(function (x) {
      var a = inc[x] || 0, e = exp[x] || 0;
      return { ym: x, inc: a, exp: e, saved: a - e, rate: a > 0 ? (a - e) / a : null, partial: false };
    });
    var run = 0, cum = monthly.map(function (r) { run += r.saved; return run; });
    var completeN = complete.length, best = null, worst = null;
    var withInc = monthly.filter(function (r) { return r.inc > 0; });
    if (withInc.length >= 2) {
      withInc.forEach(function (r) {
        if (!best || r.rate > best.rate) best = r;
        if (!worst || r.rate < worst.rate) worst = r;
      });
      /* כל החודשים באותו שיעור (במספר שמוצג) — אין "הכי טוב" ו"הכי חלש" */
      if (worst === best || Math.round(best.rate * 100) === Math.round(worst.rate * 100)) { best = null; worst = null; }
    }

    return {
      state: 'ok', Y: Y, curY: curY, cur: cur, label: label, labelPart: labelPart, partialOnly: partialOnly, headOnly: headOnly,
      months: S.length, completeN: completeN, hasPartial: Y === curY && !partialOnly && monthsList.indexOf(cur) >= 0,
      headSkipped: headSkipped ? head : '', legUnit: saved >= 0 ? '₪' : '%',
      totInc: totInc, totExp: totExp, saved: saved, rate: rate, leftover: leftover, over: over,
      per100: per100, per100Left: per100Left, expPer100: expPer100, overN: overN,
      cats: cats, legN: legN, leftSq: leftSq, squares: squares,
      monthly: monthly, cum: cum, best: best, worst: worst
    };
  }

  /* ---------- HTML ---------- */
  function where(x) { return 'ב-' + x.Y + (x.labelPart ? ' (' + x.labelPart + ')' : ''); }

  function legendItems(x) {
    var items = x.cats.map(function (c, i) {
      return {
        color: c.color, iconHtml: c.rest ? esc('🏷️') : catIcon(c.name),
        label: c.rest ? REST + ' (' + c.n + ' קטגוריות)' : c.name,
        valueHtml: '<b class="num">' + fmt(x.legN[i]) + (x.legUnit === '%' ? '%' : ' ₪') + '</b>', sub: ltr(fmt(c.v) + ' ₪'),
        actName: 'rep_savings_pick', actId: i
      };
    });
    if (x.saved >= 0) {
      items.push({ color: C_LEFT, iconHtml: esc('🐷'), label: 'נשאר', valueHtml: '<b class="num">' + fmt(x.leftSq) + ' ₪</b>',
        sub: ltr(fmt(x.saved) + ' ₪'), actName: 'rep_savings_pick', actId: x.cats.length });
    } else {
      items.push({ color: 'var(--bad)', iconHtml: esc('⚠️'), label: 'מעבר להכנסות',
        valueHtml: '<b class="num">' + fmt(x.overN) + '%</b>',
        sub: ltr(fmt(x.over) + ' ₪'), actName: 'rep_savings_pick', actId: x.cats.length + 1 });
    }
    return items;
  }

  function waffle(x) {
    var parts = x.cats.map(function (c, i) { return (c.rest ? REST : c.name) + ' ' + fmt(x.legN[i]) + (x.legUnit === '%' ? '%' : ' ₪'); });
    var aria = x.saved >= 0
      ? 'מכל 100 ₪ שנכנסו: ' + parts.join(', ') + (parts.length ? ', ' : '') + 'נשארו ' + fmt(x.leftSq) + ' ₪'
      : 'ההוצאות לפי קטגוריה: ' + parts.join(', ') + '. ' + fmt(x.overN) + '% מההוצאות היו מעבר להכנסות';
    var h = '<div class="rep-savings-waffle rk-enter"' + RK.stagger(1) + ' role="img" aria-label="' + esc(aria) + '"' +
      (x.saved < 0 ? ' data-over="' + (x.cats.length + 1) + '"' : '') + '>';
    x.squares.forEach(function (s) {
      h += '<i data-c="' + s.c + '"' + (s.over ? ' class="over"' : '') + ' style="background-color:' + RK.color(s.color, '#94a3b8') + '">' +
        (s.pig ? '<span aria-hidden="true">🐷</span>' : '') + '</i>';
    });
    return h + '</div>';
  }

  function html(x, P) {
    if (!x || x.state === 'future') return RK.card(RK.empty('🗓️', 'השנה הזו עוד לא התחילה', ''));
    if (x.state === 'empty') return RK.card(RK.empty('🌱', 'אין תנועות בשנה הזו', ''));
    if (x.state === 'noIncome') {
      return RK.kpis([{ lbl: 'יצא', val: x.totExp }]) +
        RK.card(RK.empty('💼', 'אין הכנסות רשומות בשנה הזו', 'הוסיפו את המשכורות כדי לראות כמה נשאר'));
    }
    var h = '', neg = x.saved < 0, rp = Math.round(x.rate * 100);

    /* 1) תובנה ראשית */
    h += neg
      ? RK.insight(where(x) + ' יצא יותר ממה שנכנס: על כל 100 ₪ הכנסה יצאו ' + b(RK.money(x.expPer100)) + '.', { tone: 'warn' })
      : RK.insight('מכל 100 ₪ שנכנסו ' + where(x) + ' נשארו לכם ' + b(RK.money(x.per100Left)) + ' 🐷',
        { tone: x.per100Left >= 20 ? 'ok' : 'brand' });

    /* 2) וופל + מקרא */
    h += RK.card(
      '<div class="rep-savings-hero"><div class="rep-savings-wbox">' + waffle(x) +
      '<div class="rep-savings-cap">' + (neg ? 'כל ריבוע = 1% מההוצאות · המקווקווים = החלק שמעבר להכנסות' : 'כל ריבוע = 1 ₪ מתוך 100 שנכנסו') + '</div></div>' +
      '<div class="rep-savings-leg">' + RK.legend(legendItems(x)) + '</div></div>',
      { title: neg ? 'לאן הלך הכסף' : 'לאן הלך כל 100 ₪', sub: 'לחיצה על שורה מדגישה אותה', cls: 'rep-savings' });

    /* 3) מספרים */
    var avg = x.partialOnly ? '' : 'בממוצע ' + RK.money(x.saved / x.months, {}) + ' לחודש';
    h += RK.kpis([
      { lbl: 'נכנס', val: x.totInc },
      { lbl: 'יצא', val: x.totExp },
      { lbl: 'נשאר', val: x.saved, tone: x.saved >= 0 ? 'down' : 'up', subHtml: avg },
      { lbl: 'שיעור חיסכון', valHtml: '<span class="num">' + pctTxt(x.rate) + '</span>', sub: 'מכל ההכנסות' }
    ]);

    /* 4) חודש אחרי חודש */
    var chips = '';
    if (x.best) {
      chips = '<div class="rep-savings-tags">' +
        RK.pill('החודש הכי טוב: ' + RK.monName(x.best.ym) + ' · ' + ltr(pctTxt(x.best.rate)), 'ok') +
        (x.worst ? RK.pill('הכי חלש: ' + RK.monName(x.worst.ym) + ' · ' + ltr(pctTxt(x.worst.rate)), 'warn') : '') + '</div>';
    }
    var chLeg = [{ color: C_POS, label: 'נשאר בחודש' }];
    if (x.monthly.some(function (m) { return m.saved < 0; })) chLeg.push({ color: C_NEG, label: 'יצא יותר מנכנס' });
    chLeg.push({ color: C_LINE, label: 'מצטבר מתחילת השנה' });
    if (x.monthly.length) h += RK.card(
      '<div class="rk-chart" style="height:220px"><canvas role="img" aria-label="כמה נשאר בכל חודש, וכמה הצטבר מתחילת השנה"></canvas></div>' +
      '<div class="rep-savings-chleg">' + RK.legend(chLeg) + '</div>' + chips,
      { title: 'חודש אחרי חודש', sub: 'כמה נשאר בכל חודש שהסתיים (הכנסות פחות הוצאות)', cls: 'rep-savings' });

    /* 5) מה עושים עם זה */
    if (x.per100Left >= 20) {
      h += RK.insight('יפה מאוד 🎉 נשארו לכם ' + b(RK.money(x.saved)) +
        '. כדי שזה לא יתפזר, אפשר להעביר סכום קבוע לחיסכון מיד כשהמשכורת נכנסת.', { tone: 'ok' });
    } else if (x.rate >= 0) {
      var tail = x.partialOnly || x.headOnly ? '' : ' בממוצע ' + b(RK.money(x.saved / x.months)) + ' בחודש.';
      h += RK.insight('נשארו לכם ' + b(RK.money(x.per100Left)) + ' מכל 100.' + tail, { tone: 'brand' });
    } else {
      h += RK.insight((x.Y === x.curY ? 'השנה' : 'ב-' + x.Y) + ' יצא ' + b(RK.money(-x.saved)) +
        ' יותר ממה שנכנס. כדאי להציץ בדוחות ״קבוע, שוטף וחד-פעמי״ ו״מנויים וחיובים קבועים״.', { tone: 'warn' });
    }
    var foot = 'נשאר = הכנסות פחות הוצאות. זיכוי שסווג לקטגוריית הוצאה מקוזז ממנה (זיכוי שסווג כהכנסה נספר כהכנסה); העברה לחיסכון שנרשמה כהוצאה נספרת כאן כהוצאה.';
    if (x.headSkipped) foot += ' ' + RK.monName(x.headSkipped) + ' לא נכלל כי הנתונים בו מתחילים באמצע החודש.';
    else if (x.headOnly) foot += ' הנתונים בשנה הזו מתחילים באמצע החודש, אז המספרים חלקיים.';
    if (x.hasPartial) foot += ' ' + RK.monName(x.cur) + ' לא נכלל כי הוא עוד לא נגמר.';
    else if (x.partialOnly) foot += ' ' + RK.monName(x.cur) + ' עוד לא נגמר, אז המספרים הם עד היום.';
    h += '<div class="rk-foot">' + esc(foot) + '</div>';
    return h;
  }

  /* ---------- גרף ---------- */
  function mount(root, x) {
    if (!x || x.state !== 'ok' || !root) return;
    var cvs = root.querySelectorAll('.rk-chart canvas'), cv = cvs && cvs[0];
    if (!cv) return;
    var M = x.monthly;
    var labels = M.map(function (m) { return RK.monShort(m.ym) + (m.partial ? ' (חלקי)' : ''); });
    var colors = M.map(function (m) { return m.saved >= 0 ? (m.partial ? C_POS_P : C_POS) : (m.partial ? C_NEG_P : C_NEG); });
    repChart(cv, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { type: 'bar', label: 'נשאר', data: M.map(function (m) { return m.saved; }), backgroundColor: colors,
            hoverBackgroundColor: colors, borderRadius: 6, maxBarThickness: 28, order: 1 },
          { type: 'line', label: 'מצטבר מתחילת השנה', data: x.cum, borderColor: C_LINE, backgroundColor: C_LINE,
            pointBackgroundColor: C_LINE, borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, spanGaps: false, tension: 0, order: 0 }
        ]
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index', intersect: false,
            filter: function (it) { return it.parsed && it.parsed.y != null; },
            itemSort: function (a, c) { return a.datasetIndex - c.datasetIndex; },
            callbacks: {
              title: function (items) {
                var m = items && items.length ? M[items[0].dataIndex] : null;
                return m ? heMonth(m.ym) + (m.partial ? ' (חלקי)' : '') : '';
              },
              label: function (c) { return c.dataset.label + ': ' + fmt(c.parsed && c.parsed.y) + ' ₪'; },
              afterLabel: function (c) {
                var m = M[c.dataIndex];
                if (c.datasetIndex !== 0 || !m) return '';
                if (m.partial) return 'החודש עוד לא נגמר';
                if (m.rate == null) return '';
                var r = Math.round(m.rate * 100);
                return r >= 0 ? 'מכל 100 ₪ נשארו ' + r + ' ₪' : 'על כל 100 ₪ שנכנסו יצאו ' + (100 - r) + ' ₪';
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } },
          y: { ticks: { callback: RK.axisMoney, maxTicksLimit: 6 } }
        }
      }
    });
  }

  /* ---------- לחיצה על שורה במקרא: הדגשת הריבועים שלה ---------- */
  ACTIONS.rep_savings_pick = function (id, el) {
    var r = el && el.closest && el.closest('.rep-savings');
    var g = r && r.querySelector('.rep-savings-waffle');
    if (!g) return;
    id = String(id == null ? '' : id);
    var off = g.dataset.pick === id;
    if (off) { delete g.dataset.pick; g.classList.remove('dim'); }
    else { g.dataset.pick = id; g.classList.add('dim'); }
    var overId = g.getAttribute('data-over');
    var sq = g.querySelectorAll('i');
    for (var i = 0; i < sq.length; i++) {
      var on = !off && (sq[i].getAttribute('data-c') === id || (overId != null && id === overId && sq[i].classList.contains('over')));
      sq[i].classList.toggle('is-pick', on);
    }
    var bt = r.querySelectorAll('[data-act="rep_savings_pick"]');
    for (var j = 0; j < bt.length; j++) bt[j].setAttribute('aria-pressed', !off && bt[j].getAttribute('data-id') === id ? 'true' : 'false');
  };

  REP_DEFS.push({
    k: 'savings', t: 'מכל 100 ₪ שנכנסו', ic: '🐷',
    d: 'לאן הלך כל שקל השנה, וכמה נשאר לנו',
    g: 'השנה שלנו', period: 'year',
    calc: calc, html: html, mount: mount
  });
})();
