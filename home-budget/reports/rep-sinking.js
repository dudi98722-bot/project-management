/* ============================================================
   rep-sinking.js — "קופה להוצאות הלא-חודשיות"
   משלים את "מנויים" (subs): שם מה שחוזר כל חודש, כאן הדברים הגדולים שלא.
   הוצאה לא-חודשית = 300 ₪ ומעלה, לא חיוב חוזר (RK.recurring), ותיאור
   שהופיע לכל היותר ב-5 מהחודשים המלאים בחלון (עד 12 האחרונים).
   הסכום החודשי להפרשה = סה"כ / מספר החודשים, מעוגל למעלה לעשרות.
   זיכויים לא מקוזזים כאן (קטנים מדי כדי לשנות את התמונה).
   ============================================================ */
(function () {
  'use strict';

  var MIN_AMT = 300, MAX_MONTHS = 5, NO_CAT = 'ללא קטגוריה';

  function byAmtDesc(a, b) { return b.amount - a.amount || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0); }

  function calc(rows, P) {
    rows = rows || [];
    var cur = monthOf(P.today), endYm = addMonths(cur, -1);
    var first = RK.firstDate(rows);
    if (!first) return { state: 'short' };
    var start = addMonths(endYm, -11), fm = monthOf(first);
    if (!/^\d{4}-\d{2}$/.test(fm)) {          /* תאריך פגום בראש הרשימה — החודש התקין הראשון */
      fm = '';
      for (var f = 0; f < rows.length; f++) { var fx = monthOf(rows[f].date); if (/^\d{4}-\d{2}$/.test(fx) && (!fm || fx < fm)) fm = fx; }
      if (!fm) return { state: 'short' };
    }
    if (fm > start) start = fm;
    var monthsCovered = RK.monthsBetween(start, endYm) + 1;
    if (!(monthsCovered >= 3)) return { state: 'short' };

    var rec = RK.recurring(rows, endYm);

    /* מעבר 1: באילו חודשים הופיע כל תיאור (מספרים מתחלפים מאוחדים — "חשבון 3/26") + סכומים לכל תיאור
       + סך ההוצאות בחלון ולכל חודש */
    var ms = new Map(), amtsBy = new Map(), monTot = new Map(), allExp = 0, inWin = [];
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i];
      if (t.kind !== 'expense') continue;
      var m = monthOf(t.date);
      if (m < start || m > endYm) continue;
      var a = num(t.amount);
      if (!(a > 0)) continue;
      var k = RK.rkey(t.desc);
      var set = ms.get(k);
      if (!set) { set = new Set(); ms.set(k, set); amtsBy.set(k, []); }
      set.add(m);
      amtsBy.get(k).push(a);
      allExp += a;
      monTot.set(m, (monTot.get(m) || 0) + a);
      inWin.push({ t: t, m: m, a: a, k: k });
    }
    /* "חד-פעמי גדול מאוד" (רכב, שיפוץ, חתונה): פריט אחד מעל פי 1.5 מחודש הוצאות רגיל (חציון) —
       לא נכנס להפרשה החודשית, אחרת קנייה אחת קובעת את ההמלצה לכל השנה */
    var huge = Math.max(5000, 1.5 * RK.median(Array.from(monTot.values())));
    var medBy = new Map();
    amtsBy.forEach(function (L, k) { medBy.set(k, RK.median(L)); });

    /* מעבר 2: מה לא-חודשי. "עד 5 חודשים" נקבע לחלון של 12; בחלון קצר יותר הסף יורד באותו יחס
       (3→1, 4→2, 6→3, 9→4, 11→5), אחרת קניות סופר גדולות שמופיעות בכל חודש נספרות כלא-חודשיות.
       עיגול ולא floor: עם floor חלון של 4 חודשים זרק את קניות החג של תשרי (ספטמבר+אוקטובר) ונתן 90 ₪ */
    var maxM = Math.max(1, Math.round(monthsCovered * MAX_MONTHS / 12));
    var total = 0, n = 0, byCat = new Map(), byMonth = new Map(), irr = [], hugeList = [], hugeSum = 0;
    for (var j = 0; j < inWin.length; j++) {
      var r = inWin[j];
      if (r.a < MIN_AMT || RK.recKey(rec, r.t)) continue;
      /* תיאור שחוזר כמעט כל חודש (העברה בביט, חנות קבועה) — נספר רק פריט חריג בו: פי 3 מהרגיל שלו */
      if (ms.get(r.k).size > maxM && !(r.a > 3 * medBy.get(r.k))) continue;
      var cat = r.t.category || NO_CAT;
      var it = { date: String(r.t.date || ''), desc: normDesc(r.t.desc) || 'ללא תיאור', amount: r.a, ym: r.m, cat: cat };
      if (r.a > huge) { hugeList.push(it); hugeSum += r.a; continue; }
      total += r.a; n++;
      irr.push(it);
      var c = byCat.get(cat);
      if (!c) { c = { cat: cat, sum: 0, n: 0, items: [] }; byCat.set(cat, c); }
      c.sum += r.a; c.n++; c.items.push(it);
      var bm = byMonth.get(r.m);
      if (!bm) { bm = new Map(); byMonth.set(r.m, bm); }
      bm.set(cat, (bm.get(cat) || 0) + r.a);
    }
    hugeList.sort(byAmtDesc);
    var hugeOut = hugeList.slice(0, 4).map(function (x) { return { date: x.date, desc: x.desc, amount: x.amount }; });
    if (!(total > 0)) return { state: 'none', monthsCovered: monthsCovered, huge: hugeOut, hugeSum: hugeSum, hugeN: hugeList.length };

    var cats = Array.from(byCat.values()).sort(function (x, y) { return y.sum - x.sum || (x.cat < y.cat ? -1 : 1); });
    cats.forEach(function (c) {
      c.items = c.items.sort(byAmtDesc).slice(0, 4).map(function (x) { return { date: x.date, desc: x.desc, amount: x.amount }; });
    });

    var perMonth = Math.ceil(total / monthsCovered / 10) * 10;
    var share = allExp > 0 ? total / allExp : 0;

    var strip = [], heaviest = null;
    for (var mm = start, g = 0; mm <= endYm && g < 24; mm = addMonths(mm, 1), g++) {
      var bmm = byMonth.get(mm), segs = [], tot = 0;
      if (bmm) cats.forEach(function (c) { var v = bmm.get(c.cat); if (v > 0) { segs.push({ cat: c.cat, v: v }); tot += v; } });
      var col = { ym: mm, total: tot, segs: segs };
      strip.push(col);
      if (!heaviest || tot > heaviest.total) heaviest = col;
    }

    /* מה היה בשלושת החודשים הקרובים — לפני שנה */
    var aheadMonths = [];
    for (var q = 0; q <= 2; q++) {
      var tw = addMonths(cur, q - 12);
      if (tw >= start && tw <= endYm) aheadMonths.push(tw);
    }
    var aheadTotal = 0, aheadAll = [];
    irr.forEach(function (x) { if (aheadMonths.indexOf(x.ym) >= 0) { aheadTotal += x.amount; aheadAll.push(x); } });
    var aheadItems = aheadAll.sort(byAmtDesc).slice(0, 6).map(function (x) { return { desc: x.desc, amount: x.amount, ym: x.ym }; });

    return {
      state: 'ok', start: start, endYm: endYm, monthsCovered: monthsCovered, estimated: monthsCovered < 12,
      total: total, n: n, perMonth: perMonth, share: share, cats: cats, strip: strip,
      heaviest: { ym: heaviest.ym, total: heaviest.total },
      aheadTotal: aheadTotal, aheadItems: aheadItems,
      aheadFrom: aheadMonths[0] || '', aheadTo: aheadMonths[aheadMonths.length - 1] || '',
      huge: hugeOut, hugeSum: hugeSum, hugeN: hugeList.length
    };
  }

  /* ---------- HTML ---------- */
  function b(h) { return '<strong>' + h + '</strong>'; }
  function pct(v, max) { return max > 0 && v > 0 ? Math.max(0, Math.min(100, v / max * 100)) : 0; }

  function heroHtml(x) {
    return RK.card(
      '<div class="rep-sinking-hero">' +
      '<div class="rep-sinking-k" style="font-size:12.5px;font-weight:600;color:var(--dim)">כדאי להפריש</div>' +
      '<div class="rep-sinking-big" style="font-size:26px;font-weight:800;letter-spacing:-.02em;line-height:1.25;color:var(--ink);margin:2px 0 6px">' +
      'כ-' + RK.money(x.perMonth) + ' בחודש</div>' +
      '<div class="rep-sinking-sub" style="font-size:13px;color:var(--ink2);line-height:1.6">לקופה נפרדת. ב-' + x.monthsCovered +
      ' החודשים האחרונים: ' + RK.money(x.total) + ' ב-' + x.n + ' הוצאות לא-חודשיות (' + Math.round(x.share * 100) + '% מכל ההוצאות)' +
      (x.estimated ? ' ' + RK.pill('הערכה לפי ' + x.monthsCovered + ' חודשים', 'dim') : '') + '</div>' +
      '<div class="rep-sinking-copy" style="font-size:12.5px;color:var(--dim);margin-top:8px">הוצאות שלא באות כל חודש הן לא הפתעה, הן פשוט שנתיות 💰</div>' +
      '</div>', { cls: 'rep-sinking' });
  }

  function stripHtml(x) {
    var max = x.heaviest.total, cols = x.strip.map(function (s) {
      var lab = esc(heMonth(s.ym) + ': ' + fmt(s.total) + ' ₪'), h = pct(s.total, max), bar;
      if (s.total > 0) {
        bar = '<div class="rep-sinking-bar" style="position:absolute;left:0;right:0;bottom:0;height:' + h.toFixed(2) +
          '%;min-height:2px;display:flex;flex-direction:column-reverse">' +
          s.segs.map(function (g, i) {
            var top = i === s.segs.length - 1;
            return '<i style="display:block;flex:' + (g.v / s.total).toFixed(4) + ' 1 0;min-height:0;background:' + catColor(g.cat) +
              (top ? ';border-radius:3px 3px 0 0' : '') + '"></i>';
          }).join('') + '</div>';
      } else {
        bar = '<div class="rep-sinking-bar rep-sinking-zero" style="position:absolute;left:0;right:0;bottom:0;height:2px;background:var(--line2);border-radius:1px"></div>';
      }
      var top = s.ym === x.heaviest.ym && s.total > 0;
      return '<div class="rep-sinking-col' + (top ? ' top' : '') + '" role="img" aria-label="' + lab + '" title="' + lab + '"' +
        ' style="flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:stretch">' +
        '<div class="rep-sinking-plot" style="position:relative;height:120px">' + bar +
        (top ? '<span class="rep-sinking-dot" aria-hidden="true" style="position:absolute;left:50%;bottom:calc(' + h.toFixed(2) +
          '% + 5px);width:6px;height:6px;margin-left:-3px;border-radius:50%;background:var(--ink2)"></span>' : '') +
        '</div>' +
        '<div class="rep-sinking-ml" style="font-size:11px;color:var(--dim);text-align:center;margin-top:4px;white-space:nowrap;line-height:1.2">' +
        esc(RK.monShort(s.ym)) + '</div></div>';
    }).join('');

    var leg = RK.legend(x.cats.map(function (c) { return { color: catColor(c.cat), iconHtml: catIcon(c.cat), label: c.cat }; }));
    return RK.card(
      /* --i ידני (לא RK.stagger): ל-div הזה כבר יש style, ותכונת style שנייה נבלעת */
      '<div class="rep-sinking-strip rk-enter" role="group" aria-label="הוצאות לא-חודשיות לפי חודש"' +
      ' style="--i:2;direction:ltr;display:flex;gap:4px;align-items:flex-end;padding-top:12px">' + cols + '</div>' +
      '<div class="rep-sinking-heavy" style="font-size:12.5px;color:var(--dim);margin-top:10px">' +
      '<span aria-hidden="true" style="color:var(--ink2)">●</span> החודש הכבד ביותר: ' + esc(heMonth(x.heaviest.ym)) + ', ' + RK.money(x.heaviest.total) + '</div>' +
      '<div class="rep-sinking-leg" style="margin-top:8px">' + leg + '</div>',
      { title: 'מתי זה קרה', cls: 'rep-sinking' });
  }

  function catsHtml(x) {
    var body = x.cats.map(function (c) {
      var w = pct(c.sum, x.total), more = c.n - c.items.length;
      var items = c.items.map(function (it) {
        return '<div class="rep-sinking-it" style="display:flex;align-items:baseline;gap:8px;font-size:13px;padding:5px 0;border-top:1px solid var(--line2);min-width:0">' +
          '<span class="rep-sinking-d" style="flex:0 0 auto;color:var(--dim);font-size:12px;min-width:76px">' + esc(RK.dayLabel(it.date)) + '</span>' +
          '<span class="rep-sinking-ds" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)">' + esc(it.desc) + '</span>' +
          '<span style="flex:0 0 auto;font-weight:600">' + RK.money(it.amount) + '</span></div>';
      }).join('') + (more > 0 ? '<div class="rep-sinking-more" style="font-size:12px;color:var(--dim);padding-top:5px;border-top:1px solid var(--line2)">ועוד ' +
        (more === 1 ? 'הוצאה אחת קטנה יותר' : more + ' הוצאות קטנות יותר') + '</div>' : '');
      return '<details class="rk-details rep-sinking-det" style="margin-top:0">' +
        '<summary style="display:block;width:100%;color:var(--ink);padding:8px 4px">' +
        '<span class="rep-sinking-sh" style="display:flex;align-items:baseline;gap:7px;min-width:0">' +
        '<span class="rk-det-a" aria-hidden="true" style="color:var(--faint)">▸</span>' +
        '<span aria-hidden="true" style="flex:0 0 auto;font-size:15px;line-height:1">' + catIcon(c.cat) + '</span>' +
        '<span class="rep-sinking-cn" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(c.cat) +
        '<span style="color:var(--dim);font-size:11.5px;font-weight:500;margin-inline-start:6px">' + (c.n === 1 ? 'הוצאה אחת' : c.n + ' הוצאות') + '</span></span>' +
        '<span style="flex:0 0 auto;font-weight:700">' + RK.money(c.sum) + '</span></span>' +
        '<span class="rep-sinking-share" aria-hidden="true" style="display:block;height:4px;margin:6px 0 0;margin-inline-start:18px;background:var(--line2);border-radius:999px;overflow:hidden">' +
        '<i style="display:block;height:100%;width:' + w.toFixed(2) + '%;min-width:2px;background:' + catColor(c.cat) + ';border-radius:999px"></i></span>' +
        '</summary>' +
        '<div class="rk-det-b" style="margin:4px 0 6px;padding-inline:18px 4px">' + items + '</div></details>';
    }).join('');
    return RK.card('<div class="rep-sinking-cats">' + body + '</div>', { title: 'לפי נושא', cls: 'rep-sinking' });
  }

  function aheadHtml(x) {
    if (!x.aheadItems.length) return '';
    var range = x.aheadFrom === x.aheadTo ? heMonth(x.aheadFrom)
      : (x.aheadFrom.slice(0, 4) === x.aheadTo.slice(0, 4) ? RK.monName(x.aheadFrom) : heMonth(x.aheadFrom)) + '–' + heMonth(x.aheadTo);
    return RK.card(
      RK.chips(x.aheadItems.map(function (i) { return esc(i.desc) + ' ' + RK.money(i.amount); })) +
      '<div class="rep-sinking-once" style="font-size:12px;color:var(--dim);margin-top:10px">חלק מזה היה חד-פעמי.</div>',
      { title: 'מה חיכה לנו בתקופה הזו בשנה שעברה', sub: range, cls: 'rep-sinking' });
  }

  function hugeHtml(x) {
    if (!x.huge || !x.huge.length) return '';
    var more = x.hugeN - x.huge.length;
    return RK.card(
      RK.chips(x.huge.map(function (i) { return esc(i.desc) + ' ' + RK.money(i.amount); })) +
      '<div class="rep-sinking-once" style="font-size:12px;color:var(--dim);margin-top:10px">' +
      (more > 0 ? esc('ועוד ' + more + '. ') : '') +
      'קנייה כזו מתכננים בנפרד, ולכן היא לא נכנסה לסכום החודשי למעלה.</div>',
      { title: 'חד-פעמי גדול מאוד — לא נכלל בהפרשה', sub: 'סה"כ ' + fmt(x.hugeSum) + ' ₪', cls: 'rep-sinking' });
  }

  function html(x, P) {
    if (!x || x.state === 'short') return RK.card(RK.empty('🔍', 'צריך לפחות 3 חודשים מלאים של נתונים', ''));
    if (x.state !== 'ok') return RK.card(RK.empty('👍', 'אין הוצאות גדולות לא-חודשיות', '')) + (x.huge ? hugeHtml(x) : '');
    var ins = 'ב-' + x.monthsCovered + ' החודשים האחרונים חגים, מתנות, תיקונים וטיולים עלו ' + b(RK.money(x.total)) +
      '. אם תפרישו כ-' + b(RK.money(x.perMonth)) + ' בכל חודש לקופה נפרדת, הם לא יפילו אף חודש.';
    if (x.aheadTotal > 0) ins += ' בשנה שעברה, בחודשים הקרובים, היו כאן ' + b(RK.money(x.aheadTotal)) + ', כדאי שהקופה תהיה מוכנה.';
    if (x.estimated) ins += ' החישוב יתחדד כשיצטברו 12 חודשים.';
    return heroHtml(x) + stripHtml(x) + catsHtml(x) + hugeHtml(x) + aheadHtml(x) + RK.insight(ins) +
      '<div class="rk-foot">נספרות הוצאות מ-300 ₪ ומעלה שלא חוזרות כל חודש (בלי משכנתא, מנויים, סופר ודלק).</div>';
  }

  REP_DEFS.push({
    k: 'sinking', t: 'קופה להוצאות הלא-חודשיות', ic: '💰',
    d: 'כמה להפריש כל חודש לחגים, מתנות, תיקונים וטיולים',
    g: 'תכנון קדימה', period: 'all',
    calc: calc, html: html
  });
})();
