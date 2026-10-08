/* ============================================================
   rep-router.js — לשונית "📈 דוחות": גלריה, בחירת תקופה, והדוח הנבחר.
   renderReports(opts?) מרנדר לתוך #repRoot. opts.enter=true מכריח אנימציית כניסה.
   הנתב לא משנה את סדר REP_DEFS; קבוצות לפי def.g. דוח חדש = קובץ + REP_DEFS.push.
   ============================================================ */
var REP_DEFS = (typeof REP_DEFS !== 'undefined' && REP_DEFS) || [];
(function (root) {
  'use strict';
  var GROUP_ORDER = ['מבט על החודש', 'השנה שלנו', 'תכנון קדימה'];
  var LS_K = 'hb_rep_k', LS_YM = 'hb_rep_ym', LS_Y = 'hb_rep_y';
  var ENTER_MS = 520;   // 240ms + 5×45ms עיכוב מדורג + מרווח קטן

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }

  var S = {
    k: null, ym: null, y: null,
    gallery: null,        // null = עוד לא הוחלט (ביקור ראשון → פתוח)
    entered: false,       // האם כבר הייתה כניסה גלויה ללשונית
    enterNext: false,     // מעבר דוח → אנימציה ברינדור הבא
    enterTimer: 0, token: 0,
    ctx: null             // {rows, months, years, today, curYm, curY}
  };

  /* REP_TODAY (קיבוע "היום" לתצוגה מקדימה / בדיקות) עובד רק בשרת מקומי — לא באתר האמיתי */
  function isLocal() {
    try { var h = root.location && root.location.hostname; return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1'; }
    catch (e) { return false; }
  }
  function todayStr() {
    if (root.REP_TODAY && isLocal() && /^\d{4}-\d{2}-\d{2}$/.test(root.REP_TODAY)) return root.REP_TODAY;
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function defs() { return (typeof REP_DEFS !== 'undefined' && REP_DEFS) || []; }
  function defOf(k) { var L = defs(); for (var i = 0; i < L.length; i++) if (L[i] && L[i].k === k) return L[i]; return null; }
  function defaultKey() { return defOf('pace') ? 'pace' : (defs()[0] && defs()[0].k) || null; }

  function groups() {
    var order = GROUP_ORDER.slice(), by = {};
    defs().forEach(function (d) {
      if (!d || !d.k) return;
      var g = d.g || 'עוד';
      if (order.indexOf(g) < 0) order.push(g);
      (by[g] = by[g] || []).push(d);
    });
    return order.filter(function (g) { return by[g]; }).map(function (g) { return { g: g, list: by[g] }; });
  }

  /* הקשר הנתונים — מחושב פעם אחת לכל רינדור מלא */
  function buildCtx() {
    var today = todayStr(), curYm = today.slice(0, 7), curY = today.slice(0, 4);
    var rows = [];
    try { rows = counted(); } catch (e) { console.error('reports: counted()', e); }
    var minM = '', maxM = '', ys = {};
    for (var i = 0; i < rows.length; i++) {
      var m = monthOf(rows[i].date);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) continue;
      if (m > curYm || m < '2000-01') continue;   // תשלום עתידי / שנה שגויה (0202) לא מנפחים את הבוררים
      if (!minM || m < minM) minM = m;
      if (!maxM || m > maxM) maxM = m;
      ys[m.slice(0, 4)] = 1;
    }
    var months = [], start = minM && minM < curYm ? minM : curYm, guard = 0;
    for (var cur = curYm; cur >= start && guard < 600; cur = addMonths(cur, -1), guard++) months.push(cur);
    ys[curY] = 1;
    var years = Object.keys(ys).sort().reverse();
    return { rows: rows, months: months, years: years, today: today, curYm: curYm, curY: curY };
  }

  /* חודש/שנה שנבחרו נשמרים יחד עם החודש שבו נבחרו. בחודש חדש הדוחות נפתחים שוב על "עכשיו",
     אחרת "קצב החודש" ייפתח בנובמבר על ספטמבר בלי שישימו לב */
  function lsPeriod(k) {
    var v = lsGet(k);
    if (!v) return null;
    try { var o = JSON.parse(v); return o && o.at === S.ctx.curYm && typeof o.v === 'string' ? o.v : null; } catch (e) { return null; }
  }
  function lsSetPeriod(k, v) { lsSet(k, JSON.stringify({ v: v, at: S.ctx ? S.ctx.curYm : '' })); }
  function syncState() {
    var c = S.ctx;
    if (S.k == null) S.k = lsGet(LS_K);
    if (!defOf(S.k)) S.k = defaultKey();
    if (S.ym == null) S.ym = lsPeriod(LS_YM);
    if (c.months.indexOf(S.ym) < 0) S.ym = c.curYm;
    if (S.y == null) S.y = lsPeriod(LS_Y);
    if (c.years.indexOf(S.y) < 0) S.y = c.curY;
    if (S.gallery == null) S.gallery = !lsGet(LS_K);
  }

  /* ---------- חלק עליון: כותרת + גלריה + תקופה ---------- */
  function topHtml() {
    var c = S.ctx, def = defOf(S.k), h = '';
    h += '<div class="rk-head"><div><h2 class="rk-h">📈 דוחות</h2>' +
      '<div class="rk-hs">תמונות קטנות וברורות של הכסף של הבית</div></div></div>';
    if (S.gallery || !def) {
      h += '<div class="rk-gal">';
      if (def) h += '<div class="rk-gal-top"><span class="rk-gal-tt">בחרו דוח</span>' +
        '<button type="button" class="rk-more"' + act('rep_gallery', '') + ' aria-expanded="true">סגירה ▴</button></div>';
      groups().forEach(function (gr) {
        h += '<div class="rk-grp"><div class="rk-grp-t">' + esc(gr.g) + '</div><div class="rk-tiles">' +
          gr.list.map(function (d) {
            var on = d.k === S.k;
            return '<button type="button" class="rk-tile' + (on ? ' on' : '') + '"' + act('rep_pick', d.k) +
              ' aria-pressed="' + (on ? 'true' : 'false') + '">' +
              '<span class="rk-tile-ic" aria-hidden="true">' + esc(d.ic) + '</span>' +
              '<span class="rk-tile-t">' + esc(d.t) + '</span>' +
              '<span class="rk-tile-d">' + esc(d.d) + '</span></button>';
          }).join('') + '</div></div>';
      });
      h += '</div>';
    } else {
      h += '<div class="rk-cur"><span class="rk-cur-ic" aria-hidden="true">' + esc(def.ic) + '</span>' +
        '<span class="rk-cur-t">' + esc(def.t) + '</span>' +
        '<button type="button" class="rk-more"' + act('rep_gallery', '') + ' aria-expanded="false">כל הדוחות ▾</button></div>';
    }
    if (def && c.rows.length) h += periodHtml(def);
    return h;
  }

  function periodHtml(def) {
    var c = S.ctx;
    if (def.period === 'month') {
      var i = c.months.indexOf(S.ym);
      return '<div class="rk-period">' +
        '<button type="button" class="rk-step"' + act('rep_ym_step', '-1') + ' aria-label="חודש קודם"' +
        (i >= c.months.length - 1 ? ' disabled' : '') + '>›</button>' +
        '<select class="rk-sel"' + act('rep_ym', '') + ' aria-label="חודש">' +
        c.months.map(function (m) {
          return '<option value="' + esc(m) + '"' + (m === S.ym ? ' selected' : '') + '>' +
            esc(heMonth(m) + (m === c.curYm ? ' (חלקי)' : '')) + '</option>';
        }).join('') + '</select>' +
        '<button type="button" class="rk-step"' + act('rep_ym_step', '1') + ' aria-label="חודש הבא"' +
        (i <= 0 ? ' disabled' : '') + '>‹</button></div>';
    }
    if (def.period === 'year') {
      return '<div class="rk-period"><select class="rk-sel"' + act('rep_y', '') + ' aria-label="שנה">' +
        c.years.map(function (y) {
          return '<option value="' + esc(y) + '"' + (y === S.y ? ' selected' : '') + '>' +
            esc(y + (y === c.curY ? ' (עד היום)' : '')) + '</option>';
        }).join('') + '</select></div>';
    }
    return '<div class="rk-period">' + RK.pill('12 החודשים האחרונים', 'dim') + '</div>';
  }

  /* ---------- גוף הדוח ---------- */
  function destroyCharts(el) {
    try { RK.destroyCharts(); } catch (e) { }
    if (!el || !el.querySelectorAll) return;
    var cv = el.querySelectorAll('canvas');
    for (var i = 0; i < cv.length; i++) { try { if (cv[i]._rk) { cv[i]._rk.destroy(); cv[i]._rk = null; } } catch (e) { } }
  }
  function errorHtml() { return RK.card(RK.empty('🛠️', 'הדוח לא הצליח להיטען', 'אפשר לבחור חודש או דוח אחר — שאר הלשונית עובדת כרגיל')); }

  function renderBody(enter) {
    var rootEl = document.getElementById('repRoot');
    var body = rootEl && rootEl.querySelector('.rk-report');
    if (!body) return;
    var c = S.ctx, def = defOf(S.k);
    S.token++;
    var tok = S.token;
    clearTimeout(S.enterTimer);
    RK.entering = false;
    destroyCharts(rootEl);
    body.classList.remove('rk-entering');

    if (!defs().length) { body.innerHTML = RK.card(RK.empty('🧩', 'עוד אין דוחות', '')); return; }
    if (!c.rows.length) {
      body.innerHTML = RK.card(RK.empty('🌱', 'עוד אין תנועות', 'אחרי שתוסיפו או תייבאו תנועות, הדוחות יתמלאו כאן'));
      return;
    }
    var P = {
      ym: def.period === 'all' ? c.curYm : S.ym,
      year: def.period === 'all' ? c.curY : (def.period === 'year' ? S.y : S.ym.slice(0, 4)),
      today: c.today,
      cats: ((typeof DB !== 'undefined' && DB && DB.cats) || []).filter(function (x) { return x && !x.deleted; })
    };
    if (def.period === 'year') P.ym = S.y === c.curY ? c.curYm : S.y + '-12';
    S.sig = S.k + '|' + S.ym + '|' + S.y;   // מה מוצג עכשיו — לשמירת פרטים פתוחים ברינדור מחדש
    var data, html;
    try { data = def.calc(c.rows, P); html = def.html(data, P); }
    catch (e) { console.error('report ' + def.k + ' failed', e); body.innerHTML = errorHtml(); return; }
    if (enter) { body.classList.add('rk-entering'); RK.entering = true; }
    body.setAttribute('data-k', def.k);
    body.innerHTML = typeof html === 'string' && html ? html : errorHtml();
    if (typeof def.mount === 'function') {
      try { def.mount(body, data, P); }
      catch (e) {
        console.error('report ' + def.k + ' mount failed', e);
        destroyCharts(rootEl); body.innerHTML = errorHtml();
      }
    }
    if (enter) {
      S.enterTimer = setTimeout(function () {
        if (tok !== S.token) return;
        body.classList.remove('rk-entering');
        RK.entering = false;
      }, ENTER_MS);
    }
  }

  /* החלק העליון נבנה מחדש בכל שינוי; הפוקוס חוזר לאותו כפתור/בורר (אחרת הוא נופל ל-body,
     ומשתמש מקלדת חוזר לראש הדף בכל צעד חודש). fallback: כפתור שנעלם (גלריה נסגרה) → "כל הדוחות" */
  function renderTop(fallbackSel) {
    var el = document.getElementById('repRoot');
    var top = el && el.querySelector('.rk-top');
    if (!top) return;
    var ae = document.activeElement, fa = null, fid = null;
    if (ae && ae !== document.body && top.contains(ae)) { fa = ae.getAttribute('data-act'); fid = ae.getAttribute('data-id'); }
    top.innerHTML = topHtml();
    if (!fa) return;
    var L = top.querySelectorAll('[data-act]'), t = null;
    for (var i = 0; i < L.length; i++) if (L[i].getAttribute('data-act') === fa && L[i].getAttribute('data-id') === fid) { t = L[i]; break; }
    if (!t || t.disabled) t = top.querySelector(fallbackSel || '.rk-sel') || top.querySelector('.rk-more');
    try { if (t) t.focus({ preventScroll: true }); } catch (e) { }
  }

  /* הודעה קצרה לקורא מסך אחרי שינוי דוח/תקופה (במקום להקריא את כל הדוח) */
  function announce() {
    var el = document.getElementById('repRoot'), st = el && el.querySelector('.rk-status'), def = defOf(S.k);
    if (!st || !def || !S.ctx) return;
    var per = def.period === 'month' ? heMonth(S.ym) : def.period === 'year' ? S.y : '12 החודשים האחרונים';
    st.textContent = 'מוצג: ' + def.t + ' · ' + per;
  }

  function isVisible(el) {
    try { return !!(el.offsetParent || (el.getClientRects && el.getClientRects().length)); } catch (e) { return true; }
  }

  function renderReports(opts) {
    var el = document.getElementById('repRoot');
    if (!el) return;
    opts = opts || {};
    S.ctx = buildCtx();
    syncState();
    var visible = isVisible(el);
    var enter = !!opts.enter || S.enterNext || (!S.entered && visible);
    if (visible) S.entered = true;
    S.enterNext = false;
    /* רינדור מחדש של אותו דוח ואותה תקופה (סנכרון ברקע): פרטים שהיו פתוחים נשארים פתוחים */
    var sig = S.k + '|' + S.ym + '|' + S.y, open = [];
    if (S.sig === sig) {
      var od = el.querySelectorAll('.rk-report details');
      for (var i = 0; i < od.length; i++) if (od[i].open) open.push(i);
    }
    destroyCharts(el);
    el.innerHTML = '<div class="rk-top"></div><div class="rk-sr rk-status" role="status"></div><div class="rk-report"></div>';
    renderTop();
    renderBody(enter && visible);
    if (open.length) {
      var nd = el.querySelectorAll('.rk-report details');
      open.forEach(function (j) { if (nd[j]) nd[j].open = true; });
    }
  }

  /* ---------- פעולות ---------- */
  ACTIONS.rep_pick = function (k) {
    if (!defOf(k)) return;
    var changed = k !== S.k;
    S.k = k; S.gallery = false;
    lsSet(LS_K, k);
    if (!S.ctx) return renderReports();
    renderTop('.rk-more');
    if (changed) {
      S.enterNext = false;
      renderBody(true);
      announce();
      try { var el = document.getElementById('repRoot'); if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' }); } catch (e) { }
    }
  };
  ACTIONS.rep_gallery = function () {
    S.gallery = !S.gallery;
    if (!S.ctx) return renderReports();
    renderTop(S.gallery ? '.rk-tile.on' : '.rk-more');
  };
  function setYm(ym) {
    if (!S.ctx || S.ctx.months.indexOf(ym) < 0) return;
    S.ym = ym; lsSetPeriod(LS_YM, ym);
    renderTop(); renderBody(false); announce();
  }
  ACTIONS.rep_ym = function (id, el) { if (el) setYm(el.value); };
  ACTIONS.rep_ym_step = function (id) {
    if (!S.ctx) return;
    var i = S.ctx.months.indexOf(S.ym), j = i - Number(id || 0);   // months: החדש ראשון
    if (j >= 0 && j < S.ctx.months.length) setYm(S.ctx.months[j]);
  };
  ACTIONS.rep_y = function (id, el) {
    if (!el || !S.ctx || S.ctx.years.indexOf(el.value) < 0) return;
    S.y = el.value; lsSetPeriod(LS_Y, S.y);
    renderTop(); renderBody(false); announce();
  };

  root.renderReports = renderReports;
})(typeof window !== 'undefined' ? window : globalThis);
