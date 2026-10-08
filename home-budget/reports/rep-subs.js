/* ============================================================
   rep-subs.js — "מנויים וחיובים קבועים"
   מה יורד מאיתנו לבד כל חודש (או כל חודשיים), כמה זה בשנה, ומה התייקר או הפסיק.
   הזיהוי: RK.recurring על 12 החודשים המלאים האחרונים (בלי החודש הנוכחי החלקי).
   ============================================================ */
(function () {
  'use strict';
  var BIG = 300;          // מ-300 ₪ לחודש ומעלה = "הגדולים"
  var PAY_LEN = 22;       // קיצור אמצעי תשלום ארוך בתגית (לפני הברחה)
  var STAGGER_N = 6;      // רק 6 השורות הראשונות נכנסות במדורג

  function r2(v) { return Math.round(v * 100) / 100; }
  function short(s, n) {
    var a = Array.from(String(s == null ? '' : s));
    return a.length > n ? a.slice(0, n - 1).join('').trim() + '…' : a.join('');
  }

  /* ---------------- חישוב ---------------- */
  function calc(rows, P) {
    rows = rows || [];
    var kinds = RK.catKinds(P.cats);
    var endYm = addMonths(monthOf(P.today), -1), start = addMonths(endYm, -11);

    /* מעבר אחד: חודשים עם הוצאות בחלון + הכנסה לכל חודש */
    var win = new Set(), inc = new Map();
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i], m = monthOf(t.date);
      if (m < start || m > endYm) continue;
      if (t.kind === 'expense') win.add(m);
      else if (RK.isIncome(t, kinds)) inc.set(m, (inc.get(m) || 0) + num(t.amount));
    }
    if (win.size < 3) return { state: 'short', winN: win.size };

    var months = [];
    for (var j = 0; j < 12; j++) months.push(addMonths(start, j));

    var rec = RK.recurring(rows, endYm), items = [];
    rec.forEach(function (r, k) {
      if (!(r.median > 0)) return;
      var amts = r.amts || [], med = r.median;
      var near = 0;
      for (var a = 0; a < amts.length; a++) if (Math.abs(amts[a] - med) <= Math.abs(med) * 0.05) near++;
      var variableAmt = amts.length ? near / amts.length < 0.67 : false;
      /* התייקרות: התשלום האחרון מול החציון של הקודמים. בחשבון משתנה (חשמל, מים) זו עונה ולא מחיר — לא מסמנים */
      var last = amts.length ? amts[amts.length - 1] : 0, prevMed = RK.median(amts.slice(0, -1));
      var up = !variableAmt && amts.length >= 3 && prevMed > 0 && last >= prevMed * 1.05 && last - prevMed >= 3;
      var has = new Set(r.months);
      items.push({
        key: k, desc: r.desc, cat: r.cat, payment: r.payment, cad: r.cad,
        median: r2(med), monthly: r2(med / r.cad), yearly: r2(med * 12 / r.cad),
        variableAmt: variableAmt, up: up, upPct: up ? Math.round((last / prevMed - 1) * 100) : 0, lastAmt: r2(last),
        dots: months.map(function (mm) { return has.has(mm); }),
        lastM: r.months[r.months.length - 1] || '', active: !!r.active
      });
    });

    var byYear = function (a, b) { return b.yearly - a.yearly || (a.desc < b.desc ? -1 : 1); };
    var active = items.filter(function (x) { return x.active; }).sort(byYear);
    var gone = items.filter(function (x) { return !x.active; })
      .sort(function (a, b) { return a.lastM < b.lastM ? 1 : a.lastM > b.lastM ? -1 : b.yearly - a.yearly; });
    if (!active.length && !gone.length) return { state: 'none', start: start, endYm: endYm };

    var big = active.filter(function (x) { return x.monthly >= BIG; });
    var small = active.filter(function (x) { return x.monthly < BIG; });
    var sum = function (L, f) { return L.reduce(function (s, x) { return s + x[f]; }, 0); };

    var incN = 0, incSum = 0;
    win.forEach(function (m) { var v = inc.get(m) || 0; if (v > 0) { incN++; incSum += v; } });
    var incomeAvg = incN ? incSum / incN : 0;
    var monthlyAll = sum(active, 'monthly');

    return {
      state: 'ok', start: start, endYm: endYm, winN: win.size, months: months,
      big: big, small: small, gone: gone, activeN: active.length,
      monthlyAll: r2(monthlyAll), yearlyAll: r2(sum(active, 'yearly')),
      yearlyBig: r2(sum(big, 'yearly')), yearlySmall: r2(sum(small, 'yearly')),
      smallTop3: small.slice(0, 3).map(function (x) { return x.desc; }),
      incomeAvg: r2(incomeAvg), share: incomeAvg > 0 ? monthlyAll / incomeAvg : null,
      upN: active.filter(function (x) { return x.up; }).length
    };
  }

  /* ---------------- תצוגה ---------------- */
  function dotsHtml(it, months) {
    var n = 0, h = '';
    for (var i = 0; i < 12; i++) {
      var on = !!(it.dots && it.dots[i]);
      if (on) n++;
      h += '<i' + (on ? ' class="on" style="background:' + catColor(it.cat) + '"' : '') +
        ' title="' + esc(heMonth(months[i]) + (on ? ' · חויב' : '')) + '"></i>';
    }
    return '<div class="rep-subs-l3"><span class="rep-subs-dots" role="img" aria-label="' +
      esc('חויב ב-' + n + ' מתוך 12 החודשים האחרונים') + '">' + h + '</span></div>';
  }

  function rowHtml(it, idx, isSmall, months) {
    var l1 = '<div class="rep-subs-l1"><span class="rep-subs-ic" aria-hidden="true">' + catIcon(it.cat) + '</span>' +
      '<span class="rep-subs-name" title="' + esc(it.desc) + '">' + esc(it.desc) + '</span>' +
      '<span class="rep-subs-yv"><b>' + RK.money(it.yearly) + '</b><small> בשנה</small></span></div>';

    var tags = RK.pill(it.cad === 1 ? '🔁 כל חודש' : '🗓️ כל חודשיים', 'dim');
    if (it.payment) tags += RK.pill(short(it.payment, PAY_LEN), 'dim');
    if (it.variableAmt) tags += RK.pill('סכום משתנה', 'dim');
    /* "+12%" בתוך .num — אחרת בתוך משפט עברי הפלוס קופץ לצד השני */
    if (it.up) tags += '<span class="rk-pill warn">התייקר <span class="num">+' + fmt(it.upPct) + '%</span></span>';
    /* הסכום לשנה כבר בשורה הראשונה; כאן רק מה שרואים בחיוב עצמו. אצל הקטנים: "רק X בחודש" מול "Y בשנה" */
    /* חיוב שהתייקר: מציגים את המחיר החדש, אחרת "התייקר +27%" ליד "רק 55 ₪" (החציון הישן) מבלבל */
    var amt = it.up
      ? 'עכשיו ' + RK.money(it.lastAmt) + (it.cad === 1 ? ' בחודש' : ' כל חודשיים')
      : (isSmall ? 'רק ' : '') + (it.cad === 1
        ? RK.money(it.monthly) + (isSmall ? ' בחודש' : ' לחודש')
        : RK.money(it.median) + ' כל חודשיים');
    var l2 = '<div class="rep-subs-l2">' + tags + '<span class="rep-subs-amt">' + amt + '</span></div>';

    var enter = idx < STAGGER_N;
    return '<div class="rep-subs-row' + (enter ? ' rk-enter' : '') + '"' + (enter ? RK.stagger(idx) : '') + '>' +
      l1 + l2 + dotsHtml(it, months) + '</div>';
  }

  function listCard(title, sub, list, yearly, offset, isSmall, months) {
    var hd = '<div class="rep-subs-hd"><h3 class="rk-card-t">' + esc(title) + '</h3>' +
      '<span class="rep-subs-hd-v">' + RK.money(yearly) + ' בשנה</span></div>' +
      '<div class="rk-card-s">' + esc(sub) + '</div>';
    return RK.card(hd + '<div class="rep-subs-rows">' + list.map(function (it, i) {
      return rowHtml(it, offset + i, isSmall, months);
    }).join('') + '</div>', { cls: 'rep-subs rep-subs-list' });
  }

  function goneHtml(d) {
    var rows = d.gone.map(function (it) {
      return '<div class="rep-subs-row gone">' +
        '<div class="rep-subs-l1"><span class="rep-subs-ic" aria-hidden="true">' + catIcon(it.cat) + '</span>' +
        '<span class="rep-subs-name" title="' + esc(it.desc) + '">' + esc(it.desc) + '</span>' +
        '<span class="rep-subs-yv">' + RK.money(it.median) + '<small>' + (it.cad === 2 ? ' כל חודשיים' : ' בחודש') + '</small></span></div>' +
        /* הסכום כבר בשורה הראשונה — כאן רק מתי חויב לאחרונה (בלי לחזור על הסכום) */
        '<div class="rep-subs-l2"><span class="rep-subs-last">' + esc('חויב לאחרונה ב' + heMonth(it.lastM)) + '</span></div>' +
        dotsHtml(it, d.months) + '</div>';
    }).join('');
    return '<div class="rep-subs rep-subs-gone">' +
      RK.details('הפסיקו (' + d.gone.length + ') — בוטלו או שהתשלומים הסתיימו', '<div class="rep-subs-rows">' + rows + '</div>') + '</div>';
  }

  function html(d, P) {
    if (!d || d.state === 'short') return RK.card(RK.empty('🔍', 'צריך לפחות 3 חודשים של נתונים', 'כך אפשר לזהות חיובים שחוזרים'));
    if (d.state === 'none') return RK.card(RK.empty('🙂', 'לא נמצאו חיובים שחוזרים כל חודש', ''));

    var h = '';

    /* 1) כמה יוצא לבד */
    if (d.activeN) {
      var pct = d.share != null ? Math.round(d.share * 100) : null;
      var pill = pct == null ? '' : RK.pill(pct >= 1 ? 'כ-' + pct + '% מההכנסה החודשית' : 'פחות מ-1% מההכנסה החודשית', 'brand');
      h += RK.card(
        '<div class="rep-subs-big">' + RK.money(d.monthlyAll) + '<span class="rep-subs-unit"> בחודש</span></div>' +
        '<div class="rep-subs-meta"><span class="rep-subs-yr">' + RK.money(d.yearlyAll) + ' בשנה · ' +
        esc(d.activeN === 1 ? 'חיוב קבוע אחד' : d.activeN + ' חיובים קבועים') + '</span>' + pill + '</div>' +
        '<p class="rep-subs-lead">עוד לפני שקניתם לחם, ' + RK.money(d.monthlyAll) + ' יוצאים לבד כל חודש 🔁</p>',
        { cls: 'rep-subs rep-subs-hero' });
    } else {
      h += RK.card(RK.empty('🙂', 'אין כרגע חיובים קבועים פעילים', 'כל החיובים שחזרו בעבר הפסיקו'), { cls: 'rep-subs' });
    }

    /* 2) הגדולים, ואז הקטנים שמצטברים (במסך רחב — זה לצד זה) */
    var lists = '';
    if (d.big.length) lists += listCard('הגדולים', 'מ-' + BIG + ' ₪ בחודש ומעלה', d.big, d.yearlyBig, 0, false, d.months);
    if (d.small.length) lists += listCard('קטנים שמצטברים', 'פחות מ-' + BIG + ' ₪ בחודש כל אחד, אבל בשנה זה כבר סכום', d.small, d.yearlySmall, d.big.length, true, d.months);
    h += d.big.length && d.small.length ? '<div class="rep-subs rep-subs-cols">' + lists + '</div>' : lists;

    /* 3) מה הפסיק */
    if (d.gone.length) h += goneHtml(d);

    /* 4) המשפט הסוגר */
    var s = '';
    if (d.small.length) {
      s += 'החיובים הקטנים (' + d.smallTop3.map(esc).join(', ') + (d.small.length > 3 ? '…' : '') + ') עולים יחד <strong>' +
        RK.money(d.yearlySmall) + '</strong> בשנה. פעם בשנה כדאי לעבור עליהם, לבטל מה שלא בשימוש ולהשוות מחיר בביטוח ובתקשורת.';
    } else if (d.activeN) {
      s += 'פעם בשנה כדאי לעבור על החיובים הקבועים, לבטל מה שלא בשימוש ולהשוות מחיר בביטוח ובתקשורת.';
    }
    if (d.upN) {
      var up1 = d.upN === 1 ? d.big.concat(d.small).filter(function (x) { return x.up; })[0] : null;
      s += (s ? ' ' : '') + (up1 ? 'החיוב של ' + esc(up1.desc) + ' התייקר ב-<span class="num">' + fmt(up1.upPct) + '%</span>' : '<strong>' + d.upN + '</strong> חיובים התייקרו') +
        ', שווה להתקשר ולבקש את המחיר הקודם.';
    }
    if (d.gone.length) s += (s ? ' ' : '') + (d.gone.length === 1
      ? (s ? 'בנוסף, חיוב' : 'חיוב') + ' אחד הפסיק. אם לא ביטלתם אותו בכוונה ואלה לא תשלומים שהסתיימו, כדאי לבדוק למה.'
      : (s ? 'בנוסף, ' : '') + d.gone.length + ' חיובים הפסיקו. אם לא ביטלתם אותם בכוונה ואלה לא תשלומים שהסתיימו, כדאי לבדוק למה.');
    if (s) h += RK.insight(s, { tone: d.upN ? 'warn' : 'brand' });

    h += '<div class="rk-foot">' + esc('לפי 12 החודשים המלאים האחרונים (' + heMonth(d.start) + '–' + heMonth(d.endYm) + '). ' +
      'חיוב נחשב קבוע כשהוא חוזר כל חודש או כל חודשיים בסכום דומה. כל נקודה בשורה היא חודש: הישן משמאל, האחרון מימין.') + '</div>';
    return h;
  }

  REP_DEFS.push({
    k: 'subs',
    t: 'מנויים וחיובים קבועים',
    ic: '🔁',
    d: 'מה יורד מאיתנו לבד כל חודש, וכמה זה בשנה',
    g: 'תכנון קדימה',
    period: 'all',
    calc: calc,
    html: html
  });
})();
