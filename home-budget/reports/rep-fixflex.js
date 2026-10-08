/* ============================================================
   rep-fixflex.js — "קבוע, שוטף וחד-פעמי"
   כמה מההוצאות של החודש יוצאות לבד (חיובים חוזרים), כמה הן החלטות יומיומיות (שוטף),
   וכמה הן הוצאה גדולה חד-פעמית. השוטף מושווה לחודש רגיל עד אותו יום בחודש.
   קבוע = לפי RK.recurring על 12 החודשים שלפני החודש הנבחר (סוחר חדש החודש לא נחשב קבוע).
   ============================================================ */
(function () {
  'use strict';
  var NOCAT = 'ללא קטגוריה', NODESC = 'ללא תיאור';
  var COL = { fixed: '#64748b', flex: '#5145cd', big: '#f59e0b' };
  var BIG = 1000;        // הוצאה לא-חוזרת מהסכום הזה ומעלה = חד-פעמי גדול
  var BASE_N = 6;        // חודשי ההשוואה לשוטף
  var CHIP_LEN = 22;     // קיצור תיאור בצ'יפ (גם בלי CSS הסכום לא נחתך)

  function r2(v) { return Math.round(v * 100) / 100; }
  function addTo(map, k, v) { map.set(k, (map.get(k) || 0) + v); }
  function bySumDesc(a, b) { return b.sum - a.sum; }

  /* ---------------- חישוב ---------------- */
  function calc(rows, P) {
    rows = rows || [];
    var kinds = RK.catKinds(P.cats), ym = P.ym, cur = monthOf(P.today);
    if (ym > cur) return { state: 'future' };
    var partial = ym === cur;
    var D = partial ? (Number(String(P.today).slice(8, 10)) || 31) : 31;
    /* היסטוריה בלבד: מי שמופיע לראשונה החודש נספר כשוטף/חד-פעמי, לא כקבוע */
    var rec = RK.recurring(rows, addMonths(ym, -1));

    var hist = new Set(), base = new Map(), curHas = false;
    var fixed = 0, flex = 0, big = 0, fn = 0, bn = 0, flexN = 0;
    var flexByCat = new Map(), seenFixed = new Set(), fixedBy = new Map(), flexBy = new Map(), bigItems = [];

    for (var i = 0; i < rows.length; i++) {
      var t = rows[i], m = monthOf(t.date), isCur = m === ym;
      var back = isCur ? 0 : RK.monthsBetween(m, ym);
      if (!isCur && !(back >= 1 && back <= 12)) continue;
      if (!isCur && t.kind === 'expense') hist.add(m);
      if (!isCur && (back > BASE_N || !(m < cur))) continue;
      var day = Number(String(t.date).slice(8, 10)) || 0, inTo = day <= D;
      if (isCur && !inTo) continue;

      var b = null;
      if (isCur) { if (t.kind === 'expense') curHas = true; }
      else {
        b = base.get(m);
        if (!b) { b = { m: m, to: 0, full: 0, cat: new Map(), has: false }; base.set(m, b); }
        if (t.kind === 'expense') b.has = true;
      }

      var v = RK.amt(t, kinds);
      if (!v) continue;
      var key = RK.key(t.desc), cat = t.category || NOCAT, isExp = t.kind === 'expense';
      var rk = isExp ? RK.recKey(rec, t) : '';
      var bucket = rk ? 'fixed' : isExp && num(t.amount) >= BIG ? 'big' : 'flex';

      if (!isCur) {
        if (bucket === 'flex') {
          b.full += v;
          if (inTo) { b.to += v; addTo(b.cat, cat, v); }
        }
        continue;
      }

      if (bucket === 'fixed') {
        fixed += v; fn++; seenFixed.add(rk);
        var f = fixedBy.get(rk);
        if (!f) { f = { key: rk, desc: '', date: '', sum: 0, cat: '' }; fixedBy.set(rk, f); }
        f.sum += v;
        if (String(t.date) >= f.date) { f.date = String(t.date); f.desc = normDesc(t.desc); f.cat = t.category || ''; }
      } else if (bucket === 'big') {
        big += v; bn++;
        bigItems.push({ desc: normDesc(t.desc), amount: r2(v), cat: t.category || '' });
      } else {
        flex += v;
        addTo(flexByCat, cat, v);
        if (isExp) {
          flexN++;
          var g = flexBy.get(key);
          if (!g) { g = { desc: '', date: '', sum: 0, n: 0 }; flexBy.set(key, g); }
          g.sum += v; g.n++;
          if (String(t.date) >= g.date) { g.date = String(t.date); g.desc = normDesc(t.desc); }
        }
      }
    }

    if (hist.size < 3) return { state: 'short', hist: hist.size };
    if (!curHas) return { state: 'none' };

    /* חודש רגיל = חציון חודשי ההשוואה שיש בהם הוצאות */
    var bm = Array.from(base.values()).filter(function (x) { return x.has; })
      .sort(function (a, c) { return a.m < c.m ? -1 : 1; });
    var baseN = bm.length;
    var normFlexTo = baseN ? RK.median(bm.map(function (x) { return x.to; })) : 0;
    var normFlexFull = baseN ? RK.median(bm.map(function (x) { return x.full; })) : 0;
    var flexDiff = flex - normFlexTo;
    /* זיכוי גדול יכול להפוך את השוטף לשלילי; מוצג 0, ולכן האחוז לא יורד מתחת ל-100%−.
       בתחילת החודש (עד ה-4, או כשבחודש רגיל עד היום יצא פחות מ-15% מהשוטף) קנייה אחת היא "מאות אחוזים" —
       אז אין אחוז, רק ההפרש בשקלים ו"עוד מוקדם לשפוט" */
    var early = partial && baseN > 0 && (D < 5 || normFlexTo < 0.15 * normFlexFull);
    var flexPct = !early && baseN && normFlexTo > 0 ? Math.max(-100, Math.round(flexDiff / normFlexTo * 100)) : null;

    var fixedD = Math.max(0, fixed), flexD = Math.max(0, flex), bigD = Math.max(0, big);
    var total = fixedD + flexD + bigD;
    var shares = RK.shares100([fixedD, flexD, bigD]);

    /* מה הזיז את השוטף: קטגוריה מול החציון שלה באותם חודשים */
    var movers = [];
    if (baseN) {
      var all = new Set(flexByCat.keys());
      bm.forEach(function (x) { x.cat.forEach(function (_, c) { all.add(c); }); });
      var thr = Math.max(100, 0.05 * normFlexTo);
      all.forEach(function (c) {
        var cu = flexByCat.get(c) || 0;
        var no = RK.median(bm.map(function (x) { return x.cat.get(c) || 0; }));
        var dl = cu - no;
        if (Math.abs(dl) >= thr) movers.push({ cat: c, cur: r2(cu), norm: r2(no), delta: r2(dl) });
      });
      movers.sort(function (a, c) { return Math.abs(c.delta) - Math.abs(a.delta); });
      movers = movers.slice(0, 5);
    }

    /* קבועים שעוד צפויים לרדת החודש (אותו חישוב כמו ב"קצב החודש") */
    var expList = partial ? RK.expectedFixed(rows, ym, D).list : [];
    var expSum = r2(expList.reduce(function (s, e) { return s + e.amount; }, 0));

    var topFlexCat = null, topV = 0;
    flexByCat.forEach(function (v, c) { if (v > topV) { topV = v; topFlexCat = c; } });

    var fixedList = Array.from(fixedBy.values()).sort(bySumDesc).map(function (f) {
      var r = rec.get(f.key);
      return { desc: f.desc, sum: r2(f.sum), cat: f.cat, cad: r ? r.cad : 1 };
    });
    var flexTop = Array.from(flexBy.values()).filter(function (g) { return g.sum > 0; })
      .sort(bySumDesc).slice(0, 3).map(function (g) { return { desc: g.desc, sum: r2(g.sum), n: g.n }; });
    var bigTop = bigItems.slice().sort(function (a, c) { return c.amount - a.amount; }).slice(0, 3);

    return {
      state: 'ok', ym: ym, partial: partial, D: D,
      fixed: r2(fixed), flex: r2(flex), big: r2(big), fn: fn, bn: bn, flexN: flexN,
      fixedD: r2(fixedD), flexD: r2(flexD), bigD: r2(bigD), total: r2(total), shares: shares,
      recN: rec.size, baseN: baseN, baseMonths: bm.map(function (x) { return x.m; }),
      normFlexTo: r2(normFlexTo), normFlexFull: r2(normFlexFull), flexDiff: r2(flexDiff), flexPct: flexPct, early: early,
      movers: movers,
      expSum: expSum, expN: expList.length, expNames: expList.slice(0, 3).map(function (e) { return e.desc; }), expList: expList,
      remainFlex: partial ? r2(normFlexFull - flex) : null,
      topFlexCat: topFlexCat,
      fixedList: fixedList, fixedTop: fixedList.slice(0, 3), flexTop: flexTop, bigTop: bigTop
    };
  }

  /* ---------------- תצוגה ---------------- */
  function shortText(s) {
    var a = Array.from(String(s || ''));
    return a.length > CHIP_LEN ? a.slice(0, CHIP_LEN - 1).join('').trim() + '…' : a.join('');
  }
  function chip(desc, v) {
    var full = desc || NODESC;
    return '<span class="rep-fixflex-cd" title="' + esc(full) + '">' + esc(shortText(full)) + '</span>' + RK.money(v);
  }
  /* "ב" / "מ" לפני שם קטגוריה: מקף לפני שם שלא מתחיל באות עברית, ו"ללא קטגוריה" בצורה קריאה */
  function pre(p, c) {
    if (c === NOCAT) return p + 'הוצאות בלי קטגוריה';
    return /^[א-ת]/.test(c) ? p + esc(c) : p + '-' + esc(c);
  }
  function count(n, one, many) { return n === 1 ? one : n + ' ' + many; }

  function tile(i, title, color, valueHtml, subHtml, caption, chipsHtml, extraHtml) {
    var inner = '<h3 class="rk-card-t"><span class="rk-sw" style="display:inline-block;vertical-align:middle;margin-inline-end:7px;background:' +
      color + '" aria-hidden="true"></span>' + esc(title) + '</h3>' +
      '<div class="rk-kpi-v">' + valueHtml + '</div>' +
      (subHtml ? '<div class="rk-kpi-s">' + subHtml + '</div>' : '') +
      '<div class="rk-card-s" style="margin:8px 0 10px">' + esc(caption) + '</div>' +
      (chipsHtml.length ? RK.chips(chipsHtml) : '') + (extraHtml || '');
    return RK.card(inner, { i: i, cls: 'rep-fixflex-tile' });
  }

  function html(d, P) {
    if (!d || d.state === 'future') return RK.card(RK.empty('🗓️', 'החודש הזה עוד לא התחיל', ''));
    if (d.state === 'short') return RK.card(RK.empty('🔍', 'צריך לפחות 3 חודשי היסטוריה', 'כך אפשר לזהות מה קבוע'));
    if (d.state === 'none') return RK.card(RK.empty('🙂', 'אין הוצאות בחודש הזה', ''));

    var M = RK.monName(P.ym), h = '', nTop = 0;

    /* 1) חודש חלקי */
    var pill = RK.partial(P);
    if (pill) { h += '<div style="margin:0 0 10px">' + pill + '</div>'; nTop++; }

    /* 2) המשפט הראשי */
    var lead = d.partial ? 'עד ה-' + d.D + ' ב' + esc(M) + ': ' : 'ב' + esc(M) + ' ';
    h += RK.insight(lead + (d.fn
      ? '<strong>' + d.shares[0] + '%</strong> מההוצאות הן חיובים קבועים שיוצאים לבד. '
      : d.recN ? 'עוד לא ירדו חיובים קבועים. ' : 'עוד לא זוהו חיובים קבועים. ') +
      'על השוטף (<strong>' + RK.money(d.flexD) + '</strong>) יש לכם השפעה יומיומית.');
    nTop++;

    /* 3) פס 100% ומקרא */
    var parts = [
      { k: 'fixed', ic: '🔒', l: 'קבוע', v: d.fixedD, s: d.shares[0] },
      { k: 'flex', ic: '🛒', l: 'שוטף', v: d.flexD, s: d.shares[1] },
      { k: 'big', ic: '🎈', l: 'חד-פעמי גדול', v: d.bigD, s: d.shares[2] }
    ];
    h += RK.card(
      RK.stack(parts.map(function (p) { return { value: p.v, color: COL[p.k], label: p.ic + ' ' + p.l }; }), { h: 28 }) +
      '<div style="margin-top:10px">' + RK.legend(parts.map(function (p) {
        return { color: COL[p.k], iconHtml: p.ic, label: p.l, sub: p.s + '%', valueHtml: RK.money(p.v) };
      })) + '</div>' +
      '<div class="rk-foot">סה"כ ' + RK.money(d.total) + (d.partial ? ' עד היום' : '') + '</div>',
      { title: 'לאן הלכו ההוצאות' });
    nTop++;

    /* 4) שלושת הדליים — כל אחד נכנס במדורג אחרי מה שמעליו */
    var fixedChips = d.fixedTop.map(function (f) { return chip(f.desc, f.sum); });
    var flexChips = d.flexTop.map(function (g) { return chip(g.desc, g.sum); });
    var bigChips = d.bigTop.map(function (x) { return chip(x.desc, x.amount); });

    var fixedExtra = '';
    if (d.partial && d.expSum > 0) {
      var names = d.expNames.join(', ') + (d.expN > d.expNames.length ? ' ועוד ' + (d.expN - d.expNames.length) : '');
      fixedExtra += '<div class="rk-foot">עוד צפויים החודש: כ-' + RK.money(d.expSum) + ' ' +
        esc(d.expN === 1 ? 'בחיוב אחד' : 'ב-' + d.expN + ' חיובים') + ' (' + esc(names) + ')</div>';
    }
    var exp = d.partial ? d.expList : [];
    if (d.fixedList.length || exp.length) {
      var n = d.fixedList.length;
      var summ = n === 0 ? (exp.length === 1 ? 'החיוב הקבוע הצפוי' : exp.length + ' החיובים הקבועים הצפויים')
        : (n === 1 ? 'החיוב הקבוע' : 'כל ' + n + ' החיובים הקבועים') + (exp.length ? ' (ועוד ' + exp.length + ' צפויים)' : '');
      var items = d.fixedList.map(function (f) {
        return { color: catColor(f.cat), iconHtml: catIcon(f.cat), label: f.desc || NODESC,
          sub: f.cad === 2 ? 'כל חודשיים' : '', valueHtml: RK.money(f.sum) };
      }).concat(exp.map(function (e) {
        return { color: catColor(e.cat), iconHtml: catIcon(e.cat), label: e.desc || NODESC, sub: 'צפוי', dashed: true,
          valueHtml: '<span style="color:var(--dim)">' + RK.money(e.amount) + '</span>' };
      }));
      fixedExtra += RK.details(summ, RK.legend(items));
    }

    var flexSub = '';
    if (d.flexPct != null) {
      flexSub = esc(d.partial ? 'רגיל עד ה-' + d.D + ': ' : 'רגיל: ') + RK.money(d.normFlexTo) + ' ' +
        RK.delta(d.flexPct, { pct: true, flat: Math.abs(d.flexPct) < 5 });
    } else if (d.early && d.baseN) {
      flexSub = esc('רגיל עד ה-' + d.D + ': ') + RK.money(d.normFlexTo) + ' ' +
        RK.delta(d.flexDiff, { money: true, flat: Math.abs(d.flexDiff) < 50 });
    } else if (d.flexN) flexSub = esc(count(d.flexN, 'תנועה אחת', 'תנועות'));

    h += '<div class="rk-g3 rep-fixflex">' +
      tile(nTop, '🔒 קבוע', COL.fixed, RK.money(d.fixedD),
        esc(d.fn ? count(d.fn, 'חיוב אחד', 'חיובים') : d.recN ? 'עוד לא ירדו החודש' : 'לא זוהו חיובים קבועים'),
        'משתנה רק כשמחליטים לשנות אותו', fixedChips, fixedExtra) +
      tile(nTop + 1, '🛒 שוטף', COL.flex, RK.money(d.flexD), flexSub,
        'כאן גרות ההחלטות היומיות', flexChips, '') +
      tile(nTop + 2, '🎈 חד-פעמי גדול', COL.big, RK.money(d.bigD),
        esc(d.bn === 0 ? 'אין החודש 👍' : count(d.bn, 'הוצאה אחת', 'הוצאות')),
        'מעל 1,000 ₪, לא חוזר כל חודש', bigChips, '') +
      '</div>';

    /* 5) מה הזיז את השוטף */
    if (d.baseN > 0 && d.movers.length) {
      var mx = 0;
      d.movers.forEach(function (m) { mx = Math.max(mx, m.cur, m.norm); });
      h += RK.card(RK.rows(d.movers.map(function (m) {
        return {
          iconHtml: m.cat === NOCAT ? '🏷️' : catIcon(m.cat), label: m.cat,
          valueHtml: RK.money(m.delta, { sign: true }), tone: m.delta > 0 ? 'up' : 'down',
          value: Math.max(m.cur, 0), ghost: Math.max(m.norm, 0), color: catColor(m.cat),
          sub: 'רגיל: ' + fmt(m.norm) + ' ₪'
        };
      }), { max: mx }), {
        title: 'מה הזיז את השוטף',
        sub: (d.partial ? 'עד ה-' + d.D + ' בחודש, ' : '') + 'מול חודש רגיל (חציון ' +
          (d.baseN === 1 ? 'החודש שלפני' : d.baseN + ' החודשים שלפני') + '). הקו הדק = הרגיל.',
        i: nTop + 3   /* נכנס אחרי שלושת הדליים, לא באמצע */
      });
    }

    /* 6) המשפט הסוגר */
    var p = d.flexPct, s, tone = 'brand';
    if (p === null && d.early) {
      var ad = Math.abs(d.flexDiff);
      s = 'עוד מוקדם לשפוט: עד ה-' + d.D + ' יצאו על השוטף ' + RK.money(d.flexD) + ', ובחודש רגיל עד אותו יום ' +
        RK.money(d.normFlexTo) + (Math.round(ad) >= 50 ? ' (' + RK.money(ad) + (d.flexDiff > 0 ? ' יותר' : ' פחות') + ')' : '') +
        '. קנייה גדולה אחת בתחילת החודש מזיזה הכול.';
    } else if (p === null) s = d.baseN && d.partial
      ? 'עוד מוקדם בחודש: בחודש רגיל עד ה-' + d.D + ' כמעט לא יוצא שוטף, אז עוד אין למה להשוות.'
      : d.baseN ? 'בחודשים הקודמים כמעט לא היה שוטף, אז אין למה להשוות.'
      : 'אין עדיין חודשים קודמים להשוות אליהם את השוטף.';
    else if (d.partial && p >= 5) {
      tone = 'warn';
      s = 'הקבועות (' + RK.money(d.fixedD) + ') כבר בחשבון. השוטף <strong>' + p + '%</strong> מעל הרגיל עד עכשיו' +
        (d.remainFlex > 0 ? ', וכדי לסיים כרגיל נשארו לשוטף כ-<strong>' + RK.money(d.remainFlex) + '</strong> עד סוף החודש.'
          : ', וכבר עבר את מה שיוצא בחודש רגיל שלם.');
    } else if (p <= -5) {
      tone = 'ok';
      var saved = Math.min(-d.flexDiff, d.normFlexTo);   // זיכוי גדול לא "חוסך" יותר מכל השוטף הרגיל
      s = d.partial
        ? 'השוטף <strong>' + Math.abs(p) + '%</strong> מתחת לרגיל עד עכשיו 🎉 (' + RK.money(saved) + ' פחות). אם הקצב יישמר, את ההפרש שווה להעביר לחיסכון.'
        : 'השוטף <strong>' + Math.abs(p) + '%</strong> מתחת לרגיל 🎉 את ה-' + RK.money(saved) + ' שנחסכו שווה להעביר לחיסכון.';
    } else if (Math.abs(p) < 5) {
      s = 'השוטף בדיוק ברגיל 👌' + (d.topFlexCat ? ' אם רוצים לחסוך יותר, הכי קל להתחיל ' + pre('מ', d.topFlexCat) + '.' : '');
    } else {
      tone = 'warn';
      var up = null;
      for (var j = 0; j < d.movers.length; j++) if (d.movers[j].delta > 0) { up = d.movers[j]; break; }
      s = 'השוטף היה <strong>' + p + '%</strong> מעל הרגיל' +
        (up ? ', בעיקר ' + pre('ב', up.cat) + '. בחודש הבא שווה לשים עליו עין.' : '.');
    }
    if (d.bigD > 0 && d.bigTop.length) {
      s += ' ההוצאה הגדולה ' + (d.partial ? 'החודש' : 'ב' + esc(M)) + ': ' + esc(d.bigTop[0].desc || NODESC) +
        ' (' + RK.money(d.bigTop[0].amount) + ').';
    }
    /* המשפט הסוגר והערת השוליים נכנסים אחרונים (אחרת סדר ה-nth-child של הנתב מקדים אותם לדליים) */
    h += '<div' + RK.stagger(5) + '>' + RK.insight(s, { tone: tone }) +
      '<div class="rk-foot">קבוע = חיוב שחוזר כל חודש או כל חודשיים בסכום דומה (לפי 12 החודשים שלפני). ' +
      'חד-פעמי גדול = מעל 1,000 ₪ שלא חוזר. זיכוי שסווג לקטגוריית הוצאה מקוזז מהשוטף.</div></div>';
    return h;
  }

  REP_DEFS.push({
    k: 'fixflex',
    t: 'קבוע, שוטף וחד-פעמי',
    ic: '🎛️',
    d: 'כמה מההוצאות יוצאות לבד, ועל כמה יש לנו השפעה',
    g: 'מבט על החודש',
    period: 'month',
    calc: calc,
    html: html
  });
})();
