#!/usr/bin/env node
/* בדיקת הדוחות בלי דפדפן + בניית עמוד תצוגה מקדימה.
   שימוש:
     node harness.js                  — כל הדוחות × כל מערכי הנתונים × כל התקופות
     node harness.js --only pace      — דוח אחד
     node harness.js --dump pace [ym] — מדפיס את תוצאת calc (נתוני ההדגמה המלאים)
     node harness.js --preview        — כותב preview.html בתיקייה הזו (לפתוח דרך שרת)
   קבצים נטענים: hb-helpers.js, hb-data.js, rep-kit.js, rep-router.js (אם קיים), וכל rep-*.js אחרים לפי סדר שם. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const DIR = __dirname;
const INDEX = process.env.HB_INDEX || path.resolve(DIR, '..', 'index.html');
const args = process.argv.slice(2);
const flag = k => { const i = args.indexOf(k); return i < 0 ? null : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const TODAY = '2026-10-08';

const ORDER = ['pace', 'heatcal', 'fixflex', 'lastyear', 'savings', 'maaser', 'subs', 'sinking'];
const rank = f => { const i = ORDER.indexOf(f.replace(/^rep-|\.(js|css)$/g, '')); return i < 0 ? 99 : i; };
function repFiles() {
  return fs.readdirSync(DIR).filter(f => /^rep-.+\.js$/.test(f) && f !== 'rep-kit.js' && f !== 'rep-router.js')
    .sort((x, y) => rank(x) - rank(y) || x.localeCompare(y));
}
function repCss() {
  return fs.readdirSync(DIR).filter(f => /^rep-.+\.css$/.test(f) && f !== 'rep-kit.css')
    .sort((x, y) => rank(x) - rank(y) || x.localeCompare(y));
}
function loadOrder() {
  const L = ['hb-helpers.js', 'hb-data.js'];
  if (fs.existsSync(path.join(DIR, 'rep-kit.js'))) L.push('rep-kit.js');
  L.push(...repFiles());
  if (fs.existsSync(path.join(DIR, 'rep-router.js'))) L.push('rep-router.js');
  return L;
}

function makeCtx() {
  const noop = () => {};
  const fakeEl = () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, setAttribute: noop, appendChild: noop, addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], innerHTML: '', dataset: {} });
  const ctx = {
    console, Math, JSON, Date, Intl, Number, String, Array, Object, isFinite, parseFloat, parseInt, Set, Map,
    window: null, document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: fakeEl, addEventListener: noop, documentElement: fakeEl(), body: fakeEl() },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    requestAnimationFrame: f => 0, setTimeout: () => 0, clearTimeout: noop,
    Chart: function () { return { destroy: noop, update: noop }; },
    DB: { tx: [], cats: [], settings: {} },
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  // REP_DEFS חייב להתקיים גם אם הערכה עוד לא נכתבה
  vm.runInContext('var REP_DEFS = (typeof REP_DEFS!=="undefined" && REP_DEFS) || [];', ctx);
  for (const f of loadOrder()) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    try { vm.runInContext(src, ctx, { filename: f }); }
    catch (e) { console.log('✗ טעינה נכשלה: ' + f + ' — ' + e.message); process.exitCode = 1; }
  }
  return ctx;
}

function periods() {
  return [
    { ym: '2026-10', year: '2026', label: 'חודש נוכחי (חלקי)' },
    { ym: '2026-09', year: '2026', label: 'חודש שהסתיים' },
    { ym: '2025-08', year: '2025', label: 'החודש הראשון בנתונים' },
    { ym: '2024-01', year: '2024', label: 'חודש בלי נתונים' },
  ];
}
const BAD_TEXT = ['NaN', 'undefined', 'Infinity', '[object Object]', 'null ₪'];
const XSS_BAD = ['<img', 'onerror=', 'onload=', 'url(x)', '<b>', 'javascript:', '<svg/'];

function run() {
  const ctx = makeCtx();
  const defs = vm.runInContext('REP_DEFS', ctx);
  const only = flag('--only');
  let fails = 0, checks = 0;
  if (!defs.length) { console.log('אין דוחות רשומים ב-REP_DEFS'); return 1; }
  const keys = {};
  for (const def of defs) {
    if (only && def.k !== only) continue;
    const errs = [];
    if (!def.k || !/^[a-z][a-z0-9_]{1,24}$/.test(def.k)) errs.push('מפתח k לא תקין');
    if (keys[def.k]) errs.push('מפתח כפול'); keys[def.k] = 1;
    for (const f of ['t', 'ic', 'd', 'g']) if (!def[f]) errs.push('חסר שדה ' + f);
    if (!['month', 'year', 'all'].includes(def.period)) errs.push('period לא תקין');
    if (typeof def.calc !== 'function' || typeof def.html !== 'function') errs.push('חסר calc/html');
    let worstMs = 0;
    for (const kind of ['full', 'empty', 'one', 'sparse', 'income', 'xss']) {
      const db = vm.runInContext('HBDATA', ctx).makeDB(kind, { today: TODAY });
      ctx.DB = { tx: db.tx, cats: db.cats, settings: {} };
      vm.runInContext('DB = globalThis.DB', ctx);
      for (const P0 of periods()) {
        const P = { ym: P0.ym, year: P0.year, today: TODAY, cats: db.cats.filter(c => !c.deleted) };
        checks++;
        try {
          const rows = vm.runInContext('counted()', ctx);
          const t0 = process.hrtime.bigint();
          const data = def.calc(rows, P);
          const html = def.html(data, P);
          const ms = Number(process.hrtime.bigint() - t0) / 1e6;
          if (kind === 'full') worstMs = Math.max(worstMs, ms);
          if (typeof html !== 'string' || !html.length) { errs.push(`${kind}/${P0.label}: html ריק`); continue; }
          for (const b of BAD_TEXT) if (html.includes(b)) errs.push(`${kind}/${P0.label}: מופיע "${b}"`);
          if (/\sonclick\s*=/.test(html)) errs.push(`${kind}/${P0.label}: onclick בתוך ה-html (להשתמש ב-data-act)`);
          /* onerror=/onload= נשארים גם בטקסט מוברח (&lt;svg/onload=…) — נחשבים רק בתוך תגית אמיתית */
          if (kind === 'xss') for (const b of XSS_BAD) {
            const hit = /^on(error|load)=$/.test(b)
              ? (b === 'onerror=' ? /<[a-zA-Z][^>]*\sonerror\s*=/i : /<[a-zA-Z][^>]*\sonload\s*=/i).test(html.replace(/=\s*("[^"]*"|'[^']*')/g, '=""'))
              : html.includes(b);
            if (hit) errs.push(`xss/${P0.label}: לא מוברח — "${b}"`);
          }
        } catch (e) {
          errs.push(`${kind}/${P0.label}: חריגה — ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`);
        }
      }
    }
    if (worstMs > 60) errs.push('איטי: ' + worstMs.toFixed(1) + 'ms על הנתונים המלאים');
    const uniq = [...new Set(errs)];
    if (uniq.length) { fails++; console.log('✗ ' + def.k + ' (' + def.t + ')'); uniq.slice(0, 12).forEach(e => console.log('    ' + e)); }
    else console.log('✓ ' + def.k + ' (' + def.t + ') — ' + worstMs.toFixed(1) + 'ms');
  }
  /* בוני הערכה: ערך מהנתונים שמגיע לשדה טקסט (לא ...Html) חייב לצאת מוברח */
  if (!only) {
    const P = '<img src=x onerror=alert(1)>';
    const kitErrs = [];
    const probe = {
      'RK.table td': `RK.table(['a'],[[${JSON.stringify(P)}]])`,
      'RK.table th': `RK.table([${JSON.stringify(P)}],[])`,
      'RK.rows icon': `RK.rows([{icon:${JSON.stringify(P)},label:'x',value:1}])`,
      'RK.diverge icon': `RK.diverge([{icon:${JSON.stringify(P)},label:'x',d:1}])`,
      'RK.legend actName': `RK.legend([{label:'x',actName:${JSON.stringify('x" onclick="alert(1)')}}])`,
      'RK.seg actName': `RK.seg([{id:'a',label:'a'}],${JSON.stringify('x" onclick="alert(1)')})`,
      'RK.empty': `RK.empty(${JSON.stringify(P)},${JSON.stringify(P)},${JSON.stringify(P)})`,
    };
    for (const [name, code] of Object.entries(probe)) {
      let h = '';
      try { h = String(vm.runInContext(code, ctx)); } catch (e) { kitErrs.push(name + ': חריגה ' + e.message); continue; }
      if (h.includes('<img') || /\sonclick\s*=/.test(h)) kitErrs.push(name + ': לא מוברח');
    }
    checks += Object.keys(probe).length;
    if (kitErrs.length) { fails++; console.log('✗ ערכת הדוחות (RK)'); kitErrs.forEach(e => console.log('    ' + e)); }
    else console.log('✓ ערכת הדוחות (RK) — שדות טקסט מוברחים');
  }
  console.log(`\n${defs.length} דוחות, ${checks} הרצות, ${fails} נכשלו`);
  return fails ? 1 : 0;
}

function dump(k, ym) {
  const ctx = makeCtx();
  const def = vm.runInContext('REP_DEFS', ctx).find(d => d.k === k);
  if (!def) { console.log('לא נמצא ' + k); return 1; }
  const db = vm.runInContext('HBDATA', ctx).makeDB('full', { today: TODAY });
  ctx.DB = { tx: db.tx, cats: db.cats, settings: {} }; vm.runInContext('DB = globalThis.DB', ctx);
  const P = { ym: ym || '2026-09', year: (ym || '2026-09').slice(0, 4), today: TODAY, cats: db.cats };
  console.log(JSON.stringify(def.calc(vm.runInContext('counted()', ctx), P), null, 1).slice(0, 6000));
  return 0;
}

function preview() {
  const idx = fs.readFileSync(INDEX, 'utf8');
  const style = (idx.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
  const kitCss = ['rep-kit.css', ...repCss()].filter(f => fs.existsSync(path.join(DIR, f))).map(f => '/* ' + f + ' */\n' + fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');
  const chartSrc = path.resolve(path.dirname(INDEX), 'chart.umd.min.js');
  if (fs.existsSync(chartSrc)) fs.copyFileSync(chartSrc, path.join(DIR, 'chart.umd.min.js'));
  const scripts = loadOrder().map(f => `<script src="${f}?v=${Date.now()}"></script>`).join('\n');
  const kind = flag('--kind') || 'full';
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>דוחות — תצוגה מקדימה</title>
<link href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${style}\n/* rep-kit.css */\n${kitCss}</style>
<script src="chart.umd.min.js"></script></head><body>
<header><div class="hbar"><h1>ניהול הוצאות בית — דוחות (תצוגה מקדימה, נתוני הדגמה)</h1></div></header>
<main><section id="tab-reports" class="on"><div id="repRoot"></div></section></main>
<div id="toast"></div>
<script>var DB={tx:[],cats:[],settings:{}}; var REP_DEFS=[];</script>
${scripts}
<script>
  (function(){ const db=HBDATA.makeDB(${JSON.stringify(kind)}, {today:'${TODAY}'}); DB.tx=db.tx; DB.cats=db.cats; })();
  /* בדפדפן האמיתי runAct מחובר כבר ב-index.html; כאן מחברים עותק זהה */
  function runAct(e){ const el=e.target.closest('[data-act]'); if(!el) return; const fn=ACTIONS[el.dataset.act]; if(!fn) return;
    const isField=/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName); if(e.type==='click'&&isField) return; if(e.type==='change'&&!isField) return;
    if(e.type==='click'&&el.tagName==='A') e.preventDefault(); fn(el.dataset.id, el); }
  document.addEventListener('click', runAct); document.addEventListener('change', runAct);
  window.REP_TODAY='${TODAY}';
  if(typeof renderReports==='function') renderReports(); else document.getElementById('repRoot').textContent='rep-router.js עוד לא נכתב';
</script></body></html>`;
  fs.writeFileSync(path.join(DIR, 'preview.html'), html);
  console.log('נכתב preview.html (' + kind + ')');
  return 0;
}

let code;
if (flag('--preview')) code = preview();
else if (flag('--dump')) code = dump(flag('--dump'), args[args.indexOf('--dump') + 2]);
else code = run();
process.exitCode = code || process.exitCode || 0;
