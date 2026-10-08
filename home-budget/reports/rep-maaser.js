/* ============================================================
   rep-maaser.js — "מעשרות וצדקה": כמה נתנו השנה, מול קו ייחוס של 10% מההכנסות.
   קו ייחוס בלבד, לא המלצה: הניסוח לא אומר מה "צריך" לתת.
   תקופה: חודשי השנה מהחודש הראשון בנתונים ועד החודש המלא האחרון (כמו "חיסכון").
   רק כשאין בשנה הנוכחית אף חודש מלא עם תנועות — החודש החלקי הנוכחי (partialOnly).
   חודש ראשון שהנתונים בו מתחילים באמצע (RK.firstFullMonth) לא נספר: יש בו תרומות בלי המשכורת.
   נתינה = הוצאות בקטגוריה ששמה מכיל צדק/מעשר/תרומ; תרומה שהוחזרה (הכנסה באותה קטגוריה) מקוזזת.
   הכנסות = הכנסות אמיתיות (לא זיכויים בקטגוריית הוצאה), בלי החזרי תרומות.
   ============================================================ */
(function () {
  'use strict';

  var C_LINE = '#6b7280', C_FALLBACK = '#5145cd';
  var L_GIVEN = 'ניתן (מצטבר)', L_TARGET = '10% מההכנסות (מצטבר)';
  var FOOT = 'קו ייחוס בלבד: 10% מההכנסות שנרשמו כאן (כולל קצבאות ומתנות; זיכוי נספר כהכנסה אם סווג לקטגוריית הכנסה). ' +
    'חשבון מעשרות בפועל תלוי בהלכה ובנסיבות, ולשאלה כדאי לפנות לרב.';
  var TZ_RE = /צדק|מעשר|תרומ/;

  function F(v) { v = Number(v); return isFinite(v) ? v : 0; }
  function bucket() {
    return { rows: 0, tzExp: false, given: 0, income: 0, rec: new Map(), last: new Map(), tzCat: new Map() };
  }
  function addTo(map, k, v) { map.set(k, (map.get(k) || 0) + v); }

  function calc(rows, P) {
    rows = rows || [];
    P = P || {};
    var kinds = RK.catKinds(P.cats);
    function isTz(name) { return !!name && TZ_RE.test(name) && kinds.get(name) !== 'income'; }

    var Y = String(P.year || ''), cur = monthOf(P.today), curY = cur.slice(0, 4);
    if (!/^\d{4}$/.test(Y) || !/^\d{4}-\d{2}$/.test(cur)) return { state: 'empty', Y: Y };
    if (Y > curY) return { state: 'future', Y: Y };

    /* מעבר אחד: החודשים המלאים של השנה (m<cur) בדלי אחד, החודש הנוכחי בדלי נפרד.
       בסוף מחליטים אם יש חודש מלא — ואם לא, משתמשים בחודש החלקי. */
    var full = bucket(), part = bucket(), headB = bucket(), gm = Object.create(null), im = Object.create(null);
    var head = RK.firstFullMonth(rows).headPartial;
    var firstM = '', tzRow = false;
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i], d = String(t.date || ''), m = d.slice(0, 7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) continue;
      if (m.slice(0, 4) !== Y || m > cur) continue;      // שנה אחרת / תאריך עתידי
      if (!firstM || m < firstM) firstM = m;             // החודש הראשון עם נתונים בשנה הזו (כמו "חיסכון")
      var B = m === head && m < cur ? headB : m < cur ? full : part;
      B.rows++;
      var cat = t.category || '', tz = isTz(cat), a = F(num(t.amount));
      if (tz) tzRow = true;
      if (t.kind === 'expense' && tz) {
        B.given += a; gm[m] = F(gm[m]) + a; B.tzExp = true;
        var key = normDesc(t.desc).replace(/\d+/g, '').trim() || '—';
        addTo(B.rec, key, a);
        var prev = B.last.get(key);
        if (!prev || d >= prev.d) B.last.set(key, { d: d, desc: normDesc(t.desc) || '—' });
        addTo(B.tzCat, cat, a);
      } else if (t.kind === 'income' && tz) {
        B.given -= a; gm[m] = F(gm[m]) - a;              // תרומה שהוחזרה
      } else if (RK.isIncome(t, kinds) && !tz) {
        B.income += a; im[m] = F(im[m]) + a;
      }
    }

    var partialOnly = Y === curY && !full.rows;
    var headOnly = !partialOnly && !full.rows && headB.rows > 0;   // שנה קודמת שיש בה רק את החודש הראשון החלקי
    var X = partialOnly ? part : headOnly ? headB : full;
    if (!X.rows) return { state: 'empty', Y: Y };
    var hasTzCat = (P.cats || []).some(function (c) { return c && isTz(c.name); }) || tzRow;
    if (!hasTzCat) return { state: 'noTz', Y: Y };

    /* חודשי התקופה */
    var S = [];
    if (partialOnly) S.push(cur);
    else {
      var start = firstM > Y + '-01' ? firstM : Y + '-01';
      if (head && start === head && !headOnly) start = addMonths(head, 1);
      var end = Y === curY ? addMonths(cur, -1) : Y + '-12';
      for (var mm = start, g = 0; mm <= end && g < 24; mm = addMonths(mm, 1), g++) S.push(mm);
    }
    var last = S[S.length - 1] || cur;
    var from = !partialOnly && S.length && S[0] > Y + '-01' ? 'מ' + RK.monName(S[0]) : '';
    var label = Y === curY
      ? (partialOnly ? 'עד היום' : (from ? from + ' ' : '') + 'עד סוף ' + RK.monName(last))
      : headOnly ? 'רק חלק מ' + RK.monName(head)
      : (from ? from + ' עד סוף השנה' : '');

    var income = F(X.income), given = Math.max(0, F(X.given));
    var target = F(income * 0.1);
    var pct = target > 0 ? Math.round(given / target * 100) : null;
    if (pct !== null && !isFinite(pct)) pct = null;
    if (pct !== null && given < target && pct >= 100) pct = 99;   // לא "100%" כשעוד לא הגעתם לקו
    var toLine = Math.max(0, target - given), over = Math.max(0, given - target);

    var mainCat = '', mainV = -Infinity;
    X.tzCat.forEach(function (v, k) { if (v > mainV) { mainV = v; mainCat = k; } });
    var color = mainCat ? catColor(mainCat) : C_FALLBACK;

    var cumGiven = [], cumTarget = [], labels = [], cg = 0, ci = 0;
    S.forEach(function (mo) {
      cg += F(gm[mo]); ci += F(im[mo]);
      cumGiven.push(Math.max(0, Math.round(cg))); cumTarget.push(Math.round(ci * 0.1));
      labels.push(RK.monShort(mo));
    });

    var recipients = [];
    X.rec.forEach(function (v, k) { if (F(v) > 0) recipients.push({ key: k, sum: F(v) }); });
    recipients.sort(function (a, b) { return b.sum - a.sum; });
    recipients = recipients.slice(0, 4).map(function (r) {
      var l = X.last.get(r.key);
      return { desc: (l && l.desc) || r.key, sum: r.sum };
    });

    return {
      state: income > 0 ? 'ok' : 'noIncome',
      Y: Y, label: label, partialOnly: partialOnly, headOnly: headOnly, months: S, labels: labels, anyGiving: !!X.tzExp,
      headSkipped: head && head.slice(0, 4) === Y && !headOnly && !partialOnly ? head : '',
      income: income, given: given, target: target, pct: pct, toLine: toLine, over: over,
      mainCat: mainCat, color: color, cumGiven: cumGiven, cumTarget: cumTarget, recipients: recipients
    };
  }

  /* ---------- HTML ---------- */
  function b(h) { return '<strong>' + h + '</strong>'; }
  function foot() { return '<div class="rk-foot rep-maaser-foot">' + esc(FOOT) + '</div>'; }

  function recipientsHtml(x) {
    if (!x.recipients || !x.recipients.length) return '';
    return RK.card(RK.chips(x.recipients.map(function (r) {
      return '<span class="rep-maaser-cd" style="overflow:hidden;text-overflow:ellipsis;min-width:0">' + esc(r.desc) + '</span> ' + RK.money(r.sum);
    })), { title: 'לאן נתנו', cls: 'rep-maaser' });
  }

  function html(x, P) {
    if (!x || x.state === 'empty') return RK.card(RK.empty('🌱', 'אין תנועות בשנה הזו', ''));
    if (x.state === 'future') return RK.card(RK.empty('🗓️', 'השנה הזו עוד לא התחילה', ''));
    if (x.state === 'noTz') return RK.card(RK.empty('🤲', 'לא נמצאה קטגוריה של צדקה או מעשרות',
      'אפשר להוסיף קטגוריה בשם ״צדקה ומעשרות״ ולסווג אליה את התרומות'));

    var when = 'ב-' + esc(x.Y) + (x.label ? ' (' + esc(x.label) + ')' : '');
    var h = '';

    if (x.state === 'noIncome') {
      h += RK.insight(x.given > 0 || x.anyGiving ? '🤲 ' + when + ' נתתם ' + b(RK.money(x.given)) + '.'
        : '🤲 ' + when + ' עוד לא נרשמו כאן תרומות.');
      h += RK.kpis([{ lbl: 'ניתן בפועל', val: x.given }]);
      h += '<div class="rep-maaser-note" style="font-size:13px;color:var(--dim);margin:-4px 2px 10px;line-height:1.5">' +
        'כשיירשמו הכנסות, יופיע כאן גם האחוז מקו ה-10%.</div>';
      return h + foot();
    }

    var pct = x.pct == null ? 0 : x.pct;

    /* 1) שורת התובנה — קו ייחוס, לא עצה */
    var line, tone = 'brand';
    if (x.given <= 0 && !x.anyGiving) {
      line = '🤲 ' + when + ' עוד לא נרשמו כאן תרומות. קו ה-10% מההכנסות שנרשמו: ' + b(RK.money(x.target)) + '.';
    } else if (x.given >= x.target) {
      tone = 'ok';
      line = Math.round(x.over) >= 1
        ? '✨ ' + when + ' נתתם ' + b(RK.money(x.given)) + ', ' + b(RK.money(x.over)) + ' מעבר לקו&nbsp;ה-10%.'
        : '✨ ' + when + ' נתתם ' + b(RK.money(x.given)) + ', בדיוק על קו&nbsp;ה-10%.';
    } else {
      line = '🤲 ' + when + ' נתתם ' + b(RK.money(x.given)) + ', ' + b(pct + '%') + ' מקו&nbsp;ה-10%.';
    }
    h += RK.insight(line, { tone: tone });

    /* 2) טבעת + מספרים */
    var ring = RK.ring({
      frac: Math.min(pct, 100) / 100, size: 132, stroke: 12, color: x.color,
      centerHtml: '<b class="num" style="display:block;font-size:24px;font-weight:800;letter-spacing:-.02em;color:var(--ink)">' +
        pct + '%</b><small style="display:block;font-size:11.5px;color:var(--dim);font-weight:500;margin-top:2px">מקו ה-10%</small>',
      aria: 'ניתנו ' + pct + ' אחוז מקו העשרה אחוזים'
    });
    var kp = RK.kpis([
      { lbl: 'הכנסות שנרשמו', val: x.income },
      { lbl: 'קו ה-10%', val: x.target },
      { lbl: 'ניתן בפועל', val: x.given, tone: 'brand',
        subHtml: Math.round(x.over) >= 1 ? 'מעבר לקו: ' + RK.money(x.over) : '' }
    ]);
    h += RK.card(
      '<div class="rep-maaser-hero" style="display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:16px 24px">' +
      ring + '<div class="rep-maaser-kp" style="flex:1 1 440px;min-width:0">' + kp + '</div></div>',
      { cls: 'rep-maaser rep-maaser-ring', i: 1 });

    /* 3) לאורך השנה */
    if (x.months.length >= 2) {
      h += RK.card(
        '<div class="rk-chart rep-maaser-chart" style="height:180px"><canvas role="img" aria-label="נתינה מצטברת לאורך השנה, מול 10% מההכנסות המצטברות"></canvas></div>' +
        '<div style="margin-top:10px">' + RK.legend([
          { color: x.color, label: L_GIVEN },
          { color: C_LINE, label: L_TARGET, dashed: true }
        ]) + '</div>',
        { title: 'לאורך השנה', sub: 'סכום מצטבר, חודש אחרי חודש', cls: 'rep-maaser' });
    }

    /* 4) לאן נתנו */
    h += recipientsHtml(x);

    /* 5) הערה */
    if (x.headSkipped) h += '<div class="rk-foot">' + esc(RK.monName(x.headSkipped) + ' לא נכלל כי הנתונים בו מתחילים באמצע החודש.') + '</div>';
    return h + foot();
  }

  function mount(root, x) {
    if (!root || !x || x.state !== 'ok' || !x.months || x.months.length < 2) return;
    var cv = root.querySelector('.rep-maaser-chart canvas');
    if (!cv) return;
    var months = x.months;
    repChart(cv, {
      type: 'line',
      data: {
        labels: x.labels,
        datasets: [
          { label: L_GIVEN, data: x.cumGiven, borderColor: x.color, backgroundColor: x.color, borderWidth: 2,
            pointRadius: 0, pointHoverRadius: 4, pointBackgroundColor: x.color, order: 0 },
          { label: L_TARGET, data: x.cumTarget, borderColor: C_LINE, backgroundColor: C_LINE, borderDash: [5, 4], borderWidth: 1.5,
            pointRadius: 0, pointHoverRadius: 3, pointBackgroundColor: C_LINE, order: 1 }
        ]
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index', intersect: false,
            callbacks: {
              title: function (items) {
                var it = items && items[0];
                return it && months[it.dataIndex] ? heMonth(months[it.dataIndex]) : '';
              },
              label: function (c) {
                var v = c.parsed && c.parsed.y;
                return c.dataset.label + ': ' + fmt(isFinite(v) ? v : 0) + ' ₪';
              }
            }
          }
        },
        scales: {
          x: { ticks: { maxRotation: 0, autoSkip: true } },
          y: { beginAtZero: true, ticks: { callback: RK.axisMoney, maxTicksLimit: 5 } }
        }
      }
    });
  }

  REP_DEFS.push({
    k: 'maaser', t: 'מעשרות וצדקה', ic: '🤲',
    d: 'כמה נתנו השנה, מול קו ייחוס של 10% מההכנסות',
    g: 'השנה שלנו', period: 'year',
    calc: calc, html: html, mount: mount
  });
})();
