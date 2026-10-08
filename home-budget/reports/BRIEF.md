# New reports for "ניהול הוצאות בית" (home-budget) — brief for every agent

Working dir for all report files: this folder (`home-budget/reports/`). Do NOT edit the real app
(`C:/Users/בונים ומוגנים/OneDrive/שולחן העבודה/קלוד/home-budget/index.html`) — read it only. The main
session integrates the files afterwards.

## The app
- Hebrew, RTL (`<html dir="rtl">`), single-file SPA for a family's household expenses. Font: Assistant.
- Owner asked (Hebrew): "add, besides the existing reports, more reports that are clear and cute (ברורים
  וחמודים), and apply the design skill (emil-design-eng — Emil Kowalski's design-engineering rules)".
- Users: an admin and a regular user (spouse). Both will see the new "📈 דוחות" tab. Many views are on phones (375px).
- Existing reports (on the dashboard — do NOT duplicate them as-is): monthly insight line (vs 3-month avg),
  4 KPIs (expenses, income, net, daily avg + forecast), category breakdown bars for a month, top-10 merchants
  table, outlier transactions table, 12-month income/expense bar+line chart (Chart.js), category×6-months
  table with trend arrows. New reports must add NEW insight or a much friendlier visual form.

## Data model (read-only)
`DB.tx` rows: `{id, date:'YYYY-MM-DD', desc, amount:'1234.5' (string, ALWAYS positive), kind:'expense'|'income',
category:'<category name>', status:'ok'|'pending'|'review'|'irrelevant', payment:'<payment method text>',
note, src:'<import source name, '' for manual>', srcFile, importedAt, deleted:''|'1'}`.
- Money reports use `counted()` = live rows with status ok|review (pending & irrelevant are excluded;
  irrelevant = e.g. the credit-card lump charge in the bank account, which would double count).
- `amount` is positive; direction is `kind`. A refund appears as kind 'income' with an expense category
  (e.g. 'ביגוד והנעלה') — reports that sum "income" should consider that; at minimum don't crash.
- `DB.cats`: `{name, kind:'expense'|'income', color:'#rrggbb', icon:'<emoji>', deleted}`. Category of a tx is
  matched by NAME. A tx category may be '' or a name not in DB.cats.
- Dates: the current month is usually partial. Data can start mid-history; months can be empty.

## Globals you may use (already defined in the app; copies in hb-helpers.js)
`esc(s)` HTML-escape · `fmt(n)` integer he-IL with thousands sep · `fmt2(n)` · `num(v)` parse amount ·
`monthOf(date)` → 'YYYY-MM' · `heMonth('2026-09')` → 'ספטמבר 2026' · `addMonths(ym,k)` · `normDesc(s)` ·
`counted()` · `live()` · `catByName(n)` · `catColor(n)` → validated '#rrggbb' (fallback '#94a3b8') ·
`catIcon(n)` → ALREADY-ESCAPED emoji · `kpi(lbl,valHtml,sub,cls)` (val is NOT escaped — caller escapes) ·
`act(name,id)` → ` data-act=".." data-id=".."` and `ACTIONS[name]=(id,el)=>{}` registry for clicks/changes
(document-level delegation already exists) · `Chart` (Chart.js 4.4.1 UMD global) · `toast(msg)`.
Never call `new Date()` for "today" inside calc — use `P.today` ('YYYY-MM-DD'). (thisMonth() exists but don't use it in calc.)

## Report contract (one file per report: `rep-<key>.js`)
```js
REP_DEFS.push({
  k:'pace',                 // [a-z][a-z0-9_]{1,24}, unique
  t:'קצב ההוצאות החודש',     // title (Hebrew)
  ic:'🏃',                   // one emoji
  d:'האם אנחנו בקצב של חודש רגיל?', // one short line for the gallery tile
  g:'חודשי',                 // gallery group label (Hebrew) — use the group given in the spec
  period:'month',            // 'month' | 'year' | 'all' — which selector the router shows
  calc(rows, P){ ... return data },   // PURE: no DOM, no globals except helpers above. rows = counted() array.
  html(data, P){ ... return '...' },  // returns an HTML string; everything from data is escaped
  mount(root, data, P){ ... }         // OPTIONAL: Chart.js or interactions after html is in the DOM
});
```
`P = {ym:'2026-09', year:'2026', today:'2026-10-08', cats:[live cats]}`.
Wrap the file in an IIFE; only touch globals via `REP_DEFS.push`, `ACTIONS[...]`, and the kit (`RK.*`, `repChart`).
Prefix any ACTIONS key with `rep_<key>_`.

## Shared kit (rep-kit.js + rep-kit.css, written first by the kit agent)
Exposes `RK` (HTML builders) and `repChart(canvas, config)`. Report builders MUST use the kit for cards, KPI
tiles, legends, empty states, bars, etc. so all reports look like one family. Read rep-kit.js before writing.

## Hard rules
1. Security: every value that came from data (desc, category, payment, src, note, icon, color, any number
   turned to text) goes through `esc()` or is a number formatted by fmt. Colors only via `catColor()` or
   constants. No inline `onclick=`/`onchange=` in generated HTML — use `act()` + `ACTIONS`. No `innerHTML`
   with unescaped data in mount(). No external resources (CSP allows only the app's own scripts + Google Fonts).
2. RTL + Hebrew copy. Money: `fmt(v)+' ₪'` inside an element with class `num` (it's `direction:ltr`).
   Charts: Hebrew labels, x-axis in RTL order where it matters (time can stay left→right like the existing chart).
3. Mobile 375px: no horizontal page scroll; tables go inside `.table-wrap.report`; charts have fixed heights.
4. Empty / sparse data: a friendly empty state (kit), never NaN/undefined/Infinity, never divide by zero.
   Current partial month must be labeled as partial where comparisons would mislead.
5. Performance: calc on ~2,000 rows < 20ms. Precompute in one pass; avoid O(n²).
6. Design (emil-design-eng) — the essentials:
   - Animations only on transform/opacity; durations ≤ 300ms for UI, custom curve `var(--ease-out)`
     (cubic-bezier(0.23,1,0.32,1)). Never `transition: all`. Never animate from scale(0) — use scale(.96)+opacity.
   - Entering a report (an occasional action) may use a short stagger (30–60ms between items, ≤ 6 items
     staggered). Changing the month selector (frequent) must NOT replay big entrance animations.
   - Pressables: `:active{transform:scale(.97)}` with 160ms ease-out. Hover effects only inside
     `@media (hover:hover) and (pointer:fine)`.
   - `@media (prefers-reduced-motion:reduce)`: no movement, keep only opacity; Chart.js animation off
     (the kit's repChart handles this).
   - Chart.js animation: ~350ms easeOutQuart max; tooltips Hebrew with ₪; RTL tooltip (`rtl:true`).
   - Cute ≠ noisy: soft colors from the existing tokens, emoji as accents, rounded shapes, clear Hebrew
     sentences that say what the number MEANS ("החודש הוצאתם 12% פחות מהרגיל 🎉").
7. CSS: tokens from the app's `:root` (--bg --card --card2 --line --line2 --ink --ink2 --dim --faint --brand
   --brand-h --brand-soft --brand-line --ok --ok-soft --bad --bad-soft --warn --warn-soft --shadow-sm --shadow
   --r --r-lg --ease-out --ease-in-out --dur-press --dur-fast --dur-ui). Existing classes you can reuse:
   .card .grid .g2 .g4 .kpi .insight .bar>i .empty .table-wrap.report table .num .pill .chip .up(red=more
   spending) .down(green). New report-only CSS goes in rep-kit.css (kit agent) or, if truly report-specific,
   in a `rep-<key>.css` file with every selector prefixed `.rep-<key>`.

## Testing (mandatory before you finish)
- `node harness.js --only <key>` must print ✓ (runs 6 datasets × 4 periods incl. empty data and an XSS dataset).
- `node harness.js --dump <key> 2026-09` — eyeball that the numbers make sense against the demo data
  (hb-data.js: ~20k ₪ expenses / ~24.5k ₪ income per month, Aug-2025…Oct-8-2026, Oct partial with no salary yet).
- `node harness.js --preview` regenerates preview.html (served by the main session for visual checks).
