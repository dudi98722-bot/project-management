/* ===== שטרנקוקר — ממשק המשתמש ===== */
(function () {
'use strict';

// ============ מצב ============
let ME = null, TAB = 'dash';
const SUB = { prod: 'purchases', reports: 'overview', settings: 'contacts', system: 'recycle' };
const C = { contacts: [], products: [], sizes: [], expBook: [], expBiz: [], scrolls: [], purchases: [] };
const IMPORT = { spec: null, table: '', text: '', mode: 'create', opts: { createMissingContacts: false } };

// ============ עזרים ============
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const N = (v) => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };

function money(v, cur) {
  const x = N(v);
  const s = (cur === 'USD' ? '$' : '₪') + Math.abs(x).toLocaleString('he-IL', { maximumFractionDigits: 2 });
  return x < 0 ? '−' + s : s;
}
const mCell = (v, cur) => `<span class="num ${N(v) < 0 ? 'neg' : ''}">${money(v, cur)}</span>`;
const numCell = (v) => `<span class="num">${N(v).toLocaleString('he-IL', { maximumFractionDigits: 2 })}</span>`;
function dt(v) {
  if (!v) return '';
  const s = String(v).slice(0, 10).split('-');
  return s.length === 3 ? `${s[2]}/${s[1]}/${s[0]}` : String(v);
}
const today = () => new Date().toISOString().slice(0, 10);
const contactName = (c) => (c && c.name ? String(c.name).trim() : '') || '—';

function toast(msg, type) {
  const t = $('toast');
  t.textContent = msg; t.className = 'show ' + (type || '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = ''; }, 3200);
}

// ---- מודאל ----
function modal(opts) {
  const root = $('modalRoot');
  const wrap = document.createElement('div');
  wrap.className = 'modal-bg';
  wrap.innerHTML = `<div class="modal ${opts.wide ? 'lg' : ''}">
      <div class="m-head"><h3>${esc(opts.title || '')}</h3><button class="x">&times;</button></div>
      <div class="m-body">${opts.body || ''}</div>
      ${opts.footer ? `<div class="m-foot">${opts.footer}</div>` : ''}
    </div>`;
  root.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('.x').onclick = close;
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
  return { el: wrap, close };
}

function confirmBox(msg) {
  return new Promise((resolve) => {
    const m = modal({
      title: 'אישור', body: `<p>${esc(msg)}</p>`,
      footer: `<button class="btn red" data-yes>אישור</button><button class="btn ghost" data-no>ביטול</button>`,
    });
    m.el.querySelector('[data-yes]').onclick = () => { m.close(); resolve(true); };
    m.el.querySelector('[data-no]').onclick = () => { m.close(); resolve(false); };
  });
}

// ---- אפשרויות לרשימות נפתחות ----
const optBlank = (label) => `<option value="">${esc(label || '— בחר —')}</option>`;
const optContacts = (sel) => C.contacts.map(c =>
  `<option value="${c.id}" ${+sel === c.id ? 'selected' : ''}>${esc(contactName(c))}</option>`).join('');
const optProducts = (sel) => C.products.map(p =>
  `<option value="${p.id}" ${+sel === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
const optSizes = (sel) => C.sizes.map(s =>
  `<option value="${s.id}" ${+sel === s.id ? 'selected' : ''}>${esc(s.name)} (${money(s.cost_per_unit)}/יח')</option>`).join('');
const optListVals = (arr, sel) => arr.map(v =>
  `<option value="${esc(v.value)}" ${sel === v.value ? 'selected' : ''}>${esc(v.value)}${v.is_correction ? ' ⟵ תיקונים' : ''}</option>`).join('');
const scrollLabel = (s) => `#${s.id} · ${s.product_name || 'ללא מוצר'} · ${s.scribe_name || 'ללא סופר'}`;
const optScrolls = (sel) => C.scrolls.map(s =>
  `<option value="${s.id}" ${+sel === s.id ? 'selected' : ''}>${esc(scrollLabel(s))}</option>`).join('');
const purchaseLabel = (p) => `${p.product_name || 'מוצר'} · ${p.scribe_name || 'סופר'} (נשאר ${N(p.remaining_qty)})`;
const optPurchases = (sel) => C.purchases
  .filter(p => N(p.remaining_qty) > 0 || +sel === p.id)
  .map(p => `<option value="${p.id}" ${+sel === p.id ? 'selected' : ''}>${esc(purchaseLabel(p))}</option>`).join('');

// ---- בונה שדות טופס ----
function fieldHTML(f, val) {
  const v = (val === null || val === undefined) ? '' : val;
  const req = f.required ? 'required' : '';
  let inner;
  if (f.type === 'select') {
    inner = `<select id="f_${f.k}" ${req}>${f.blank === false ? '' : optBlank(f.blank)}${f.options(v)}</select>`;
  } else if (f.type === 'textarea') {
    inner = `<textarea id="f_${f.k}" rows="2">${esc(v)}</textarea>`;
  } else if (f.type === 'checkbox') {
    return `<div class="chk"><input type="checkbox" id="f_${f.k}" ${v ? 'checked' : ''}>
            <label for="f_${f.k}">${esc(f.label)}</label></div>`;
  } else {
    const step = f.type === 'number' ? 'step="any"' : '';
    inner = `<input id="f_${f.k}" type="${f.type || 'text'}" value="${esc(v)}" ${step} ${req}>`;
  }
  return `<div class="field"><label>${esc(f.label)}</label>${inner}
          ${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
}

function readFields(fields) {
  const out = {};
  for (const f of fields) {
    const el = $('f_' + f.k);
    if (!el) continue;
    out[f.k] = f.type === 'checkbox' ? el.checked : el.value;
  }
  return out;
}

// ---- טופס הוספה/עריכה גנרי ----
function openForm(cfg, row) {
  const isEdit = !!row;
  const body = `<div class="row">${cfg.fields.map(f =>
    fieldHTML(f, row ? row[f.k] : (cfg.defaults ? cfg.defaults()[f.k] : ''))).join('')}</div>`;
  const m = modal({
    title: (isEdit ? 'עריכה — ' : 'הוספה — ') + cfg.title,
    body, wide: cfg.wide,
    footer: `<button class="btn" data-save>שמירה</button><button class="btn ghost" data-cancel>ביטול</button>`,
  });
  m.el.querySelector('[data-cancel]').onclick = m.close;
  const btn = m.el.querySelector('[data-save]');
  btn.onclick = async () => {
    const data = readFields(cfg.fields);
    if (cfg.validate) { const err = cfg.validate(data); if (err) return toast(err, 'err'); }
    btn.disabled = true;
    try {
      if (isEdit) await cfg.store.update(row.id, data);
      else await cfg.store.create(data);
      toast('נשמר בהצלחה', 'ok');
      m.close();
      await reloadCaches();
      render();
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
  };
}

async function removeRow(store, id, label) {
  if (!(await confirmBox(`להעביר לסל המחזור: ${label}?`))) return;
  try {
    await store.remove(id);
    toast('הועבר לסל המחזור', 'ok');
    await reloadCaches();
    render();
  } catch (e) { toast(e.message, 'err'); }
}

// ---- טבלה גנרית ----
function tableHTML(cols, rows, opts) {
  opts = opts || {};
  if (!rows.length) return `<div class="empty"><div class="big">📭</div>אין נתונים להצגה</div>`;
  const head = cols.map(c => `<th class="${c.cls || ''}">${c.labelHtml || esc(c.label)}</th>`).join('');
  const body = rows.map((r, i) => `<tr ${opts.rowAttr ? opts.rowAttr(r) : ''}>${
    cols.map(c => `<td class="${c.cls || ''}">${c.render(r, i)}</td>`).join('')}</tr>`).join('');
  let foot = '';
  if (opts.totals) {
    foot = `<tfoot><tr>${cols.map(c =>
      `<td class="${c.cls || ''}">${c.total ? c.total(rows) : (c.totalLabel || '')}</td>`).join('')}</tr></tfoot>`;
  }
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table></div>`;
}

const sumBy = (rows, k) => rows.reduce((a, r) => a + N(r[k]), 0);

// ===== מחיקה מרוכזת בבחירה =====
// עמודת סימון בטבלה. הבחירה מוגבלת לטבלה אחת בכל רגע — כדי שפס הפעולה
// הצף תמיד ידע מאיזו טבלה מוחקים.
function selCol(table) {
  return {
    label: '', cls: 'center',
    labelHtml: `<input type="checkbox" data-selall="${esc(table)}" title="בחר הכל">`,
    render: (r) => `<input type="checkbox" data-sel="${esc(table)}" value="${r.id}">`,
  };
}

function updateSelBar() {
  let bar = $('selBar');
  const checked = [...document.querySelectorAll('input[data-sel]:checked')];
  if (!checked.length) { if (bar) bar.remove(); return; }
  const table = checked[0].dataset.sel;
  const ids = checked.map(c => +c.value);
  if (!bar) { bar = document.createElement('div'); bar.id = 'selBar'; document.body.appendChild(bar); }
  bar.innerHTML = `<span>נבחרו <b>${ids.length}</b></span>
    <button class="btn red sm" id="delSelBtn">🗑 מחק נבחרים</button>
    <button class="btn ghost sm" id="clearSelBtn">ביטול</button>`;
  $('delSelBtn').onclick = async () => {
    if (!(await confirmBox(`להעביר ${ids.length} שורות לסל המחזור? (ניתן לשחזר מלשונית מערכת)`))) return;
    try {
      const r = await Store.import.bulkDelete(table, ids);
      toast(`הועברו לסל המחזור: ${r.deleted}${r.failed.length ? ` · נכשלו: ${r.failed.length}` : ''}`, 'ok');
      await reloadCaches(); render();
    } catch (e) { toast(e.message, 'err'); }
  };
  $('clearSelBtn').onclick = () => {
    document.querySelectorAll('input[data-sel]:checked').forEach(c => { c.checked = false; });
    updateSelBar();
  };
}

function wireSelection() {
  document.querySelectorAll('input[data-selall]').forEach(h => {
    h.onchange = () => {
      const t = h.dataset.selall;
      document.querySelectorAll('input[data-sel]').forEach(c => {
        c.checked = (c.dataset.sel === t) ? h.checked : false;
      });
      document.querySelectorAll('input[data-selall]').forEach(o => { if (o !== h) o.checked = false; });
      updateSelBar();
    };
  });
  document.querySelectorAll('input[data-sel]').forEach(c => {
    c.onchange = () => {
      document.querySelectorAll('input[data-sel]:checked').forEach(o => {
        if (o.dataset.sel !== c.dataset.sel) o.checked = false;
      });
      updateSelBar();
    };
  });
}

// ---- עמודת פעולות ----
function actionsCol(cfg) {
  return {
    label: '', cls: 'center', render: (r) => {
      if (!ME.caps.edit && !ME.caps.del) return '';
      let h = '';
      if (ME.caps.edit) h += `<button class="btn ghost xs" data-edit="${r.id}">✎</button> `;
      if (ME.caps.del) h += `<button class="btn ghost xs" data-del="${r.id}">🗑</button>`;
      return h;
    }
  };
}

function wireRowActions(cfg, rows) {
  document.querySelectorAll('[data-edit]').forEach(b => {
    b.onclick = (e) => { e.stopPropagation(); openForm(cfg, rows.find(r => r.id === +b.dataset.edit)); };
  });
  document.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = (e) => {
      e.stopPropagation();
      const r = rows.find(x => x.id === +b.dataset.del);
      removeRow(cfg.store, r.id, cfg.labelOf ? cfg.labelOf(r) : ('#' + r.id));
    };
  });
}

// ---- דף ישות גנרי ----
async function entityPage(cfg) {
  const rows = await cfg.load();
  const cols = cfg.cols.concat([actionsCol(cfg)]);
  if (ME.caps.del && cfg.bulk) cols.unshift(selCol(cfg.bulk));
  $('view').innerHTML += `
    <div class="page-head">
      <h2>${esc(cfg.title)}</h2>
      ${cfg.subtitle ? `<span class="mini">${esc(cfg.subtitle)}</span>` : ''}
      <div class="spacer"></div>
      ${bulkBtn(cfg.bulk, cfg.title, cfg.bulkPreset)}
      ${ME.caps.edit ? `<button class="btn" id="addBtn">+ הוספה</button>` : ''}
    </div>
    ${cfg.note ? `<div class="card mini">${cfg.note}</div>` : ''}
    <div class="card">${tableHTML(cols, rows, { totals: cfg.totals })}</div>`;
  if ($('addBtn')) $('addBtn').onclick = () => openForm(cfg, null);
  wireRowActions(cfg, rows);
  wireBulkBtns();
  wireSelection();
}

// ============ טעינת מטמון ============
async function reloadCaches() {
  const [contacts, products, sizes, lists, scrolls, purchases] = await Promise.all([
    Store.contacts.list(), Store.products.list(), Store.sizes.list(),
    Store.lists.all(), Store.scrolls.list(), Store.prodPurchases.list(),
  ]);
  C.contacts = contacts; C.products = products; C.sizes = sizes;
  C.expBook = lists.expense_book || []; C.expBiz = lists.expense_business || [];
  C.scrolls = scrolls; C.purchases = purchases;
}

// ============ דשבורד ============
async function pageDash() {
  const d = await Store.reports.overview();
  const st = (label, val, cls, sub) => `<div class="stat"><div class="label">${label}</div>
    <div class="value ${cls || ''}">${val}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  $('view').innerHTML += `
    <div class="page-head"><h2>דשבורד</h2></div>
    <div class="grid stat-grid">
      ${st('רווח נקי', money(d.net_profit), d.net_profit >= 0 ? 'g' : 'r', 'ס"ת + מוצרים − פריטה − הוצאות עסק')}
      ${st('רווח ס"ת (צפוי)', money(d.scroll_profit), 'b', `${d.scrolls_count} ספרים, ${d.scrolls_active} פעילים`)}
      ${st('רווח מוצרים', money(d.product_profit), 'b')}
      ${st('הוצאות עסק', money(d.business_expenses), 'a')}
      ${st('חוב לסופרים', money(d.owed_to_scribes), 'r', 'שתי המערכות')}
      ${st('חוב הרוכשים (מיידי)', money(d.owed_by_customers), 'a', `כללי: ${money(d.owed_by_customers_total)}`)}
      ${st('מלאי מוצרים', N(d.stock_units).toLocaleString('he-IL') + ' יח\'', '')}
      ${st('עלות פריטה', money(d.peritah_total), 'r', 'שתי המערכות')}
    </div>`;
}

// ============ ס"ת ============
async function pageScrolls() {
  const rows = C.scrolls;
  const cfg = scrollCfg();
  const cols = [
    ...(ME.caps.del ? [selCol('scrolls')] : []),
    { label: '#', render: r => r.id },
    { label: 'מוצר', render: r => esc(r.product_name || '—') },
    { label: 'סופר', render: r => esc(r.scribe_name || '—') },
    { label: 'רוכש', render: r => esc(r.customer_name || '—') },
    { label: 'תאריך', render: r => dt(r.sale_date) },
    { label: 'התקדמות', render: r => `<div class="bar ${r.progress_pct < 100 ? 'warn' : ''}"><span style="width:${Math.min(100, r.progress_pct)}%"></span></div>
        <span class="mini">${r.pages_written}/${r.product_pages}</span>` },
    { label: 'מחיר לרוכש', cls: 'num', render: r => mCell(r.buyer_total, r.buyer_currency) },
    { label: 'יתרת רוכש', cls: 'num', render: r => mCell(r.buyer_balance_now) },
    { label: 'יתרת סופר', cls: 'num', render: r => mCell(r.scribe_balance) },
    { label: 'רווח צפוי', cls: 'num', render: r => mCell(r.expected_profit) },
    { label: 'סטטוס', render: r => `<span class="pill ${r.status === 'done' ? 'done' : 'active'}">${r.status === 'done' ? 'הושלם' : 'פעיל'}</span>` },
    { label: '', cls: 'center', render: r => `<button class="btn ghost xs" data-card="${r.id}">כרטיס</button>` },
    actionsCol(cfg),
  ];
  $('view').innerHTML += `
    <div class="page-head"><h2>ס"ת</h2><div class="spacer"></div>
      ${bulkBtn('scrolls', 'ס"ת')}
      ${ME.caps.edit ? `<button class="btn" id="addBtn">+ ספר חדש</button>` : ''}</div>
    <div class="card">${tableHTML(cols, rows, {
      totals: true,
      })}</div>`;
  if ($('addBtn')) $('addBtn').onclick = () => openForm(cfg, null);
  wireRowActions(cfg, rows);
  wireBulkBtns();
  wireSelection();
  document.querySelectorAll('[data-card]').forEach(b => b.onclick = () => showScrollCard(+b.dataset.card));
}

function scrollCfg() {
  return {
    title: 'ספר', store: Store.scrolls, wide: true,
    labelOf: (r) => scrollLabel(r),
    defaults: () => ({ sale_date: today(), buyer_currency: 'ILS', status: 'active' }),
    fields: [
      { k: 'scribe_id', label: 'שם סופר', type: 'select', options: optContacts },
      { k: 'product_id', label: 'מוצר', type: 'select', options: optProducts },
      { k: 'parchment_size_id', label: 'גודל קלף', type: 'select', options: optSizes },
      { k: 'page_rate', label: 'מחיר לעמוד (לסופר)', type: 'number' },
      { k: 'sale_date', label: 'תאריך מכירה', type: 'date' },
      { k: 'customer_id', label: 'שם רוכש', type: 'select', options: optContacts },
      { k: 'buyer_total', label: 'מחיר לרוכש (סכום כולל)', type: 'number', hint: 'המחיר של הספר כולו, לא לעמוד' },
      { k: 'buyer_currency', label: 'מטבע רוכש', type: 'select', blank: false, options: (v) =>
          `<option value="ILS" ${v === 'ILS' ? 'selected' : ''}>₪ שקל</option><option value="USD" ${v === 'USD' ? 'selected' : ''}>$ דולר</option>` },
      { k: 'status', label: 'סטטוס', type: 'select', blank: false, options: (v) =>
          `<option value="active" ${v === 'active' ? 'selected' : ''}>פעיל</option><option value="done" ${v === 'done' ? 'selected' : ''}>הושלם</option>` },
      { k: 'note', label: 'הערה', type: 'textarea' },
    ],
  };
}

async function showScrollCard(id) {
  let d;
  try { d = await Store.scrolls.get(id); } catch (e) { return toast(e.message, 'err'); }
  const s = d.scroll;
  const kv = (k, v, cls) => `<div class="k">${k}</div><div class="${cls || ''}">${v}</div>`;
  const mini = (cols, rows) => tableHTML(cols, rows);

  const body = `
    <div class="kv" style="margin-bottom:6px">
      ${kv('מוצר', esc(s.product_name || '—'))}
      ${kv('סופר', esc(s.scribe_name || '—'))}
      ${kv('רוכש', esc(s.customer_name || '—'))}
      ${kv('גודל קלף', esc(s.size_name || '—'))}
      ${kv('תאריך מכירה', dt(s.sale_date))}
      ${kv('עמודים', `${s.pages_written} / ${s.product_pages} (${s.progress_pct}%)`)}
    </div>

    <div class="sec-title">צד סופר</div>
    <div class="kv">
      ${kv('מחיר לעמוד', money(s.page_rate))}
      ${kv('שכר הסופר לספר מלא', money(s.scribe_book_price))}
      ${kv('סך לתשלום לפי התקדמות', money(s.scribe_due_progress))}
      ${kv('שולם לסופר', money(s.scribe_paid))}
      ${kv('תיקונים ששולמו', money(s.corrections_paid))}
      ${kv('<b>יתרה לתשלום</b>', `<b>${money(s.scribe_balance)}</b>`)}
      ${kv('יתרה עתידית', money(s.scribe_future_balance))}
    </div>

    <div class="sec-title">צד רוכש</div>
    <div class="kv">
      ${kv('מחיר לרוכש (כולל)', money(s.buyer_total, s.buyer_currency))}
      ${kv('מחיר לעמוד (מחושב)', money(s.buyer_page_rate))}
      ${kv('סך לתשלום לפי התקדמות', money(s.buyer_due_progress))}
      ${kv('שולם', money(s.customer_paid))}
      ${kv('<b>יתרה מיידית</b>', `<b>${money(s.buyer_balance_now)}</b>`)}
      ${kv('יתרה כללית', money(s.buyer_balance_total))}
    </div>

    <div class="sec-title">כללי ורווח</div>
    <div class="kv">
      ${kv('צפי קלף', money(s.parchment_expected))}
      ${kv('עלות קלף בפועל', money(s.parchment_actual))}
      ${kv('עלות פריטה', money(s.peritah_cost))}
      ${kv('הוצאה קבועה לספר', money(s.fixed_expense))}
      ${kv('הוצאות לספר', money(s.book_expenses))}
      ${kv('<b>רווח צפוי</b>', `<b class="${s.expected_profit >= 0 ? 'pos' : 'neg'}">${money(s.expected_profit)}</b>`)}
    </div>

    <div class="sec-title">עמודים שנכתבו (${d.pages_log.length})</div>
    ${mini([{ label: 'תאריך', render: r => dt(r.date) }, { label: 'עמודים', cls: 'num', render: r => numCell(r.pages) },
            { label: 'הערה', cls: 'wrap', render: r => esc(r.note || '') }], d.pages_log)}

    <div class="sec-title">תשלומים לסופר (${d.scribe_payments.length})</div>
    ${mini([{ label: 'תאריך', render: r => dt(r.date) }, { label: 'סכום', cls: 'num', render: r => mCell(r.amount) },
            { label: 'הערה', cls: 'wrap', render: r => esc(r.note || '') }], d.scribe_payments)}

    <div class="sec-title">תשלומי הרוכש (${d.customer_payments.length})</div>
    ${mini([{ label: 'תאריך', render: r => dt(r.date) }, { label: '₪', cls: 'num', render: r => mCell(r.amount_ils) },
            { label: '$', cls: 'num', render: r => numCell(r.amount_usd) }, { label: 'שער', cls: 'num', render: r => numCell(r.rate) },
            { label: 'מזומן ביד', cls: 'num', render: r => mCell(r.cash_in_hand) },
            { label: 'פריטה', cls: 'num', render: r => mCell(r.peritah) },
            { label: 'שולם בפועל', cls: 'num', render: r => mCell(r.paid_actual) }], d.customer_payments)}

    <div class="sec-title">הוצאות לספר (${d.book_expenses.length})</div>
    ${mini([{ label: 'תאריך', render: r => dt(r.date) }, { label: 'סוג', render: r => esc(r.type || '') + (r.is_correction ? ' <span class="pill a">תיקונים</span>' : '') },
            { label: 'סכום', cls: 'num', render: r => mCell(r.amount) }], d.book_expenses)}

    <div class="sec-title">הוצאות קלף (${d.parchment_expenses.length})</div>
    ${mini([{ label: 'תאריך', render: r => dt(r.date) }, { label: 'גודל', render: r => esc(r.size_name || '') },
            { label: 'כמות', cls: 'num', render: r => numCell(r.quantity) },
            { label: 'עלות ליח\'', cls: 'num', render: r => mCell(r.cost_per_unit) },
            { label: 'סך עלות', cls: 'num', render: r => mCell(r.total_cost) }], d.parchment_expenses)}
  `;
  modal({ title: 'כרטיס ספר ' + scrollLabel(s), body, wide: true });
}

// ============ תשלום לסופר (שני חלקים) ============
async function pageScribePay() {
  const [pays, pages] = await Promise.all([Store.scribePayments.list(), Store.pagesLog.list()]);
  const scrollById = (id) => C.scrolls.find(s => s.id === id);

  const payCfg = {
    title: 'תשלום לסופר', store: Store.scribePayments,
    labelOf: (r) => `תשלום ${money(r.amount)}`,
    defaults: () => ({ date: today() }),
    fields: [
      { k: 'scroll_id', label: 'עבור איזה ספר', type: 'select', options: optScrolls, required: true },
      { k: 'date', label: 'תאריך', type: 'date' },
      { k: 'amount', label: 'סכום ששולם', type: 'number' },
      { k: 'note', label: 'הערה', type: 'textarea' },
    ],
  };
  const pageCfg = {
    title: 'עמודים שנכתבו', store: Store.pagesLog,
    labelOf: (r) => `${r.pages} עמודים`,
    defaults: () => ({ date: today() }),
    fields: [
      { k: 'scroll_id', label: 'עבור איזה ספר', type: 'select', options: optScrolls, required: true },
      { k: 'date', label: 'תאריך', type: 'date' },
      { k: 'pages', label: 'כמות עמודים שנכתבה', type: 'number' },
      { k: 'note', label: 'הערה', type: 'textarea' },
    ],
  };

  const payCols = [
    ...(ME.caps.del ? [selCol('scribe_payments')] : []),
    { label: 'ספר', render: r => { const s = scrollById(r.scroll_id); return s ? esc(scrollLabel(s)) : '—'; } },
    { label: 'תאריך', render: r => dt(r.date) },
    { label: 'סכום ששולם', cls: 'num', render: r => mCell(r.amount), total: rows => mCell(sumBy(rows, 'amount')) },
    { label: 'הערה', cls: 'wrap', render: r => esc(r.note || '') },
    { label: 'יתרה לתשלום (הספר)', cls: 'num', render: r => { const s = scrollById(r.scroll_id); return s ? mCell(s.scribe_balance) : ''; } },
    actionsCol(payCfg),
  ];
  const pageCols = [
    ...(ME.caps.del ? [selCol('pages_log')] : []),
    { label: 'ספר', render: r => { const s = scrollById(r.scroll_id); return s ? esc(scrollLabel(s)) : '—'; } },
    { label: 'תאריך', render: r => dt(r.date) },
    { label: 'עמודים שנכתבו', cls: 'num', render: r => numCell(r.pages), total: rows => numCell(sumBy(rows, 'pages')) },
    { label: 'ס"ה עמודים בספר', cls: 'num', render: r => { const s = scrollById(r.scroll_id); return s ? `${s.pages_written} / ${s.product_pages}` : ''; } },
    { label: 'הערה', cls: 'wrap', render: r => esc(r.note || '') },
    actionsCol(pageCfg),
  ];

  $('view').innerHTML += `
    <div class="page-head"><h2>תשלום לסופר</h2></div>
    <div class="card">
      <div class="page-head"><h3>תשלומים לסופר</h3><div class="spacer"></div>
        ${bulkBtn('scribe_payments', 'תשלומים לסופר')}
        ${ME.caps.edit ? `<button class="btn sm" id="addPay">+ תשלום</button>` : ''}</div>
      ${tableHTML(payCols, pays, { totals: true })}
    </div>
    <div class="card">
      <div class="page-head"><h3>עמודים שנכתבו</h3><div class="spacer"></div>
        ${bulkBtn('pages_log', 'עמודים שנכתבו')}
        ${ME.caps.edit ? `<button class="btn sm gold" id="addPage">+ רישום עמודים</button>` : ''}</div>
      ${tableHTML(pageCols, pages, { totals: true })}
    </div>`;
  if ($('addPay')) $('addPay').onclick = () => openForm(payCfg, null);
  if ($('addPage')) $('addPage').onclick = () => openForm(pageCfg, null);
  wireBulkBtns();

  // חיווט ידני — שתי טבלאות באותו דף
  const wire = (sel, cfg, rows) => {
    document.querySelectorAll(sel).forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const r = rows.find(x => x.id === +(b.dataset.edit || b.dataset.del));
        if (!r) return;
        if (b.dataset.edit) openForm(cfg, r);
        else removeRow(cfg.store, r.id, cfg.labelOf(r));
      };
    });
  };
  const tables = document.querySelectorAll('.card table');
  if (tables[0]) { tables[0].querySelectorAll('[data-edit],[data-del]').forEach(b => b.dataset.grp = 'pay'); }
  if (tables[1]) { tables[1].querySelectorAll('[data-edit],[data-del]').forEach(b => b.dataset.grp = 'page'); }
  wire('[data-grp="pay"]', payCfg, pays);
  wire('[data-grp="page"]', pageCfg, pages);
  wireSelection();
}

// ============ תשלומי לקוחות (ס"ת) ============
function pageCustPay() {
  const scrollById = (id) => C.scrolls.find(s => s.id === id);
  return entityPage({
    title: 'תשלומי לקוחות', bulk: 'customer_payments', store: Store.customerPayments,
    load: () => Store.customerPayments.list(),
    labelOf: (r) => `תשלום ${money(r.paid_actual)}`,
    defaults: () => ({ date: today() }),
    totals: true,
    note: 'עלות פריטה = (סכום בדולר × שער יציג) − מזומן שהתקבל ביד. הרוכש מזוכה על הסכום המלא.',
    fields: [
      { k: 'customer_id', label: 'רוכש', type: 'select', options: optContacts },
      { k: 'scroll_id', label: 'ספר שרכש', type: 'select', options: optScrolls },
      { k: 'date', label: 'תאריך', type: 'date' },
      { k: 'amount_ils', label: 'סכום ששילם בש"ח', type: 'number' },
      { k: 'amount_usd', label: 'סכום ששילם בדולר', type: 'number' },
      { k: 'rate', label: 'שער יציג של הדולר', type: 'number' },
      { k: 'cash_in_hand', label: 'מזומן בש"ח שהתקבל ביד', type: 'number', hint: 'רלוונטי למי ששילם בדולר' },
      { k: 'note', label: 'הערה', type: 'textarea' },
    ],
    cols: [
      { label: 'רוכש', render: r => { const c = C.contacts.find(x => x.id === r.customer_id); return c ? esc(contactName(c)) : '—'; } },
      { label: 'ספר', render: r => { const s = scrollById(r.scroll_id); return s ? esc(scrollLabel(s)) : '—'; } },
      { label: 'תאריך', render: r => dt(r.date) },
      { label: 'ש"ח', cls: 'num', render: r => mCell(r.amount_ils), total: rows => mCell(sumBy(rows, 'amount_ils')) },
      { label: 'דולר', cls: 'num', render: r => numCell(r.amount_usd), total: rows => numCell(sumBy(rows, 'amount_usd')) },
      { label: 'שער', cls: 'num', render: r => r.rate ? numCell(r.rate) : '' },
      { label: 'מזומן ביד', cls: 'num', render: r => r.amount_usd ? mCell(r.cash_in_hand) : '' },
      { label: 'עלות פריטה', cls: 'num', render: r => r.amount_usd ? mCell(r.peritah) : '', total: rows => mCell(sumBy(rows, 'peritah')) },
      { label: 'שולם בפועל', cls: 'num', render: r => mCell(r.paid_actual), total: rows => mCell(sumBy(rows, 'paid_actual')) },
      { label: 'יתרת הרוכש', cls: 'num', render: r => { const s = scrollById(r.scroll_id); return s ? mCell(s.buyer_balance_now) : ''; } },
      { label: 'הערה', cls: 'wrap', render: r => esc(r.note || '') },
    ],
  });
}

// ============ הוצאות לספר ============
function pageBookExp() {
  const scrollById = (id) => C.scrolls.find(s => s.id === id);
  return entityPage({
    title: 'הוצאות לספר', bulk: 'book_expenses', store: Store.bookExpenses,
    load: () => Store.bookExpenses.list(),
    labelOf: (r) => `${r.type || 'הוצאה'} ${money(r.amount)}`,
    defaults: () => ({ date: today() }),
    totals: true,
    note: 'סוג המסומן כ<b>תיקונים</b> נזקף לצד הסופר (מקוזז מהיתרה שלו). כל שאר הסוגים נחשבים הוצאות לספר ויורדים מהרווח.',
    fields: [
      { k: 'scroll_id', label: 'ספר', type: 'select', options: optScrolls, required: true },
      { k: 'type', label: 'סוג הוצאה', type: 'select', options: (v) => optListVals(C.expBook, v) },
      { k: 'date', label: 'תאריך', type: 'date' },
      { k: 'amount', label: 'סכום', type: 'number' },
      { k: 'note', label: 'הערה', type: 'textarea' },
    ],
    cols: [
      { label: 'ספר', render: r => { const s = scrollById(r.scroll_id); return s ? esc(scrollLabel(s)) : '—'; } },
      { label: 'סוג הוצאה', render: r => esc(r.type || '') + (r.is_correction ? ' <span class="pill a">תיקונים</span>' : '') },
      { label: 'תאריך', render: r => dt(r.date) },
      { label: 'סכום', cls: 'num', render: r => mCell(r.amount), total: rows => mCell(sumBy(rows, 'amount')) },
      { label: 'הערה', cls: 'wrap', render: r => esc(r.note || '') },
    ],
  });
}

// ============ הוצאות קלף ============
function pageParchExp() {
  const scrollById = (id) => C.scrolls.find(s => s.id === id);
  return entityPage({
    title: 'הוצאות קלף', bulk: 'parchment_expenses', store: Store.parchmentExpenses,
    load: () => Store.parchmentExpenses.list(),
    labelOf: (r) => `${r.quantity} יחידות קלף`,
    defaults: () => ({ date: today() }),
    totals: true,
    note: 'סך העלות מחושב אוטומטית: כמות × עלות ליחידה של הגודל שנבחר. סכום זה הוא "עלות קלף בפועל" בכרטיס הספר.',
    fields: [
      { k: 'scroll_id', label: 'ספר', type: 'select', options: optScrolls, required: true },
      { k: 'date', label: 'תאריך', type: 'date' },
      { k: 'quantity', label: 'כמות קלף', type: 'number' },
      { k: 'parchment_size_id', label: 'גודל', type: 'select', options: optSizes },
      { k: 'note', label: 'הערה', type: 'textarea' },
    ],
    cols: [
      { label: 'ספר', render: r => { const s = scrollById(r.scroll_id); return s ? esc(scrollLabel(s)) : '—'; } },
      { label: 'תאריך', render: r => dt(r.date) },
      { label: 'כמות', cls: 'num', render: r => numCell(r.quantity), total: rows => numCell(sumBy(rows, 'quantity')) },
      { label: 'גודל', render: r => esc(r.size_name || '—') },
      { label: 'עלות ליחידה', cls: 'num', render: r => mCell(r.cost_per_unit) },
      { label: 'סך עלות', cls: 'num', render: r => mCell(r.total_cost), total: rows => mCell(sumBy(rows, 'total_cost')) },
      { label: 'הערה', cls: 'wrap', render: r => esc(r.note || '') },
    ],
  });
}

// ============ הוצאות עסק ============
function pageBizExp() {
  return entityPage({
    title: 'הוצאות עסק', bulk: 'business_expenses', store: Store.businessExpenses,
    load: () => Store.businessExpenses.list(),
    labelOf: (r) => `${r.type || 'הוצאה'} ${money(r.amount)}`,
    defaults: () => ({ date: today() }),
    totals: true,
    fields: [
      { k: 'date', label: 'תאריך', type: 'date' },
      { k: 'type', label: 'סוג הוצאה', type: 'select', options: (v) => optListVals(C.expBiz, v) },
      { k: 'amount', label: 'סכום', type: 'number' },
      { k: 'note', label: 'הערה', type: 'textarea' },
    ],
    cols: [
      { label: 'תאריך', render: r => dt(r.date) },
      { label: 'סוג הוצאה', render: r => esc(r.type || '') },
      { label: 'סכום', cls: 'num', render: r => mCell(r.amount), total: rows => mCell(sumBy(rows, 'amount')) },
      { label: 'הערה', cls: 'wrap', render: r => esc(r.note || '') },
    ],
  });
}

// ============ מוצרים ============
function pageProd() {
  const subs = [
    { k: 'purchases', label: 'רכישות' },
    { k: 'sales', label: 'מכירות' },
    { k: 'scribepay', label: 'תשלומים לסופר' },
    { k: 'custpay', label: 'תשלומי לקוחות' },
  ];
  renderSubtabs('prod', subs);
  const s = SUB.prod;
  if (s === 'purchases') return prodPurchases();
  if (s === 'sales') return prodSales();
  if (s === 'scribepay') return prodScribePay();
  return prodCustPay();
}

function prodPurchases() {
  return entityPage({
    title: 'רכישות מוצרים', bulk: 'prod_purchases', store: Store.prodPurchases,
    load: () => Store.prodPurchases.list(),
    labelOf: (r) => `${r.product_name} מ${r.scribe_name}`,
    defaults: () => ({ date: today(), purchase_type: 'רגיל' }),
    totals: true,
    note: 'כל רכישה היא <b>חבילה</b> שממנה מוכרים. מחיקת רכישה מעבירה גם את המכירות שנגזרו ממנה לסל המחזור.',
    fields: [
      { k: 'date', label: 'תאריך', type: 'date' },
      { k: 'scribe_id', label: 'סופר (המוכר)', type: 'select', options: optContacts },
      { k: 'product_id', label: 'מוצר', type: 'select', options: optProducts },
      { k: 'quantity', label: 'כמות', type: 'number' },
      { k: 'cost_per_unit', label: 'עלות ליחידה', type: 'number', hint: 'מכאן נגזר החוב לסופר' },
      { k: 'extra_cost_per_unit', label: 'עלות נוספת ליחידה', type: 'number', hint: 'לחישוב הרווח בלבד' },
      { k: 'purchase_type', label: 'סוג רכישה', type: 'select', blank: false, options: (v) =>
          `<option value="רגיל" ${v === 'רגיל' ? 'selected' : ''}>רגיל</option><option value="קומיסיון" ${v === 'קומיסיון' ? 'selected' : ''}>קומיסיון</option>` },
      { k: 'note', label: 'הערה', type: 'textarea' },
    ],
    cols: [
      { label: 'תאריך', render: r => dt(r.date) },
      { label: 'סופר', render: r => esc(r.scribe_name || '—') },
      { label: 'מוצר', render: r => esc(r.product_name || '—') },
      { label: 'כמות', cls: 'num', render: r => numCell(r.quantity), total: rows => numCell(sumBy(rows, 'quantity')) },
      { label: 'נמכר', cls: 'num', render: r => numCell(r.sold_qty) },
      { label: 'נשאר', cls: 'num', render: r => `<span class="pill ${N(r.remaining_qty) > 0 ? 'g' : 'n'}">${N(r.remaining_qty)}</span>` },
      { label: 'עלות ליח\'', cls: 'num', render: r => mCell(r.cost_per_unit) },
      { label: 'נוספת ליח\'', cls: 'num', render: r => mCell(r.extra_cost_per_unit) },
      { label: 'סוג', render: r => `<span class="pill n">${esc(r.purchase_type || '')}</span>` },
      { label: 'חוב לסופר', cls: 'num', render: r => mCell(r.owed_scribe), total: rows => mCell(sumBy(rows, 'owed_scribe')) },
    ],
  });
}

function prodSales() {
  return entityPage({
    title: 'מכירות מוצרים', bulk: 'prod_sales', store: Store.prodSales,
    load: () => Store.prodSales.list(),
    labelOf: (r) => `${r.quantity} × ${r.product_name}`,
    defaults: () => ({ date: today(), sale_type: 'רגיל' }),
    totals: true,
    note: 'לא ניתן למכור יותר מיתרת המלאי בחבילה. רווח = מכירה − (עלות + עלות נוספת) − 3% אם סומן.',
    validate: (d) => (!d.purchase_id ? 'יש לבחור חבילת רכישה' : (N(d.quantity) <= 0 ? 'כמות חייבת להיות גדולה מאפס' : null)),
    fields: [
      { k: 'date', label: 'תאריך', type: 'date' },
      { k: 'customer_id', label: 'שם רוכש', type: 'select', options: optContacts },
      { k: 'purchase_id', label: 'מוצר (חבילה)', type: 'select', options: optPurchases, required: true },
      { k: 'quantity', label: 'כמות', type: 'number' },
      { k: 'price_per_unit', label: 'מחיר מכירה ליחידה', type: 'number' },
      { k: 'sale_type', label: 'סוג מכירה', type: 'select', blank: false, options: (v) =>
          `<option value="רגיל" ${v === 'רגיל' ? 'selected' : ''}>רגיל</option><option value="קומיסיון" ${v === 'קומיסיון' ? 'selected' : ''}>קומיסיון</option>` },
      { k: 'deduct_3pct', label: 'לנכות 3%', type: 'checkbox' },
      { k: 'note', label: 'הערה', type: 'textarea' },
    ],
    cols: [
      { label: 'תאריך', render: r => dt(r.date) },
      { label: 'רוכש', render: r => esc(r.customer_name || '—') },
      { label: 'מוצר', render: r => esc(r.product_name || '—') + (r.scribe_name ? ` <span class="mini">· ${esc(r.scribe_name)}</span>` : '') },
      { label: 'כמות', cls: 'num', render: r => numCell(r.quantity), total: rows => numCell(sumBy(rows, 'quantity')) },
      { label: 'מחיר ליח\'', cls: 'num', render: r => mCell(r.price_per_unit) },
      { label: 'עלות ליח\'', cls: 'num', render: r => mCell(r.unit_cost) },
      { label: 'סוג', render: r => `<span class="pill n">${esc(r.sale_type || '')}</span>` },
      { label: '3%', cls: 'center', render: r => r.deduct_3pct ? '<span class="pill a">כן</span>' : '' },
      { label: 'סך מכירה', cls: 'num', render: r => mCell(r.total_sale), total: rows => mCell(sumBy(rows, 'total_sale')) },
      { label: 'סך רווח', cls: 'num', render: r => mCell(r.total_profit), total: rows => mCell(sumBy(rows, 'total_profit')) },
    ],
  });
}

function prodScribePay() {
  return entityPage({
    title: 'תשלומים לסופר (מוצרים)', bulk: 'prod_scribe_payments', store: Store.prodScribePayments,
    load: () => Store.prodScribePayments.list(),
    labelOf: (r) => `תשלום ${money(r.amount)}`,
    defaults: () => ({ date: today() }),
    totals: true,
    fields: [
      { k: 'date', label: 'תאריך', type: 'date' },
      { k: 'scribe_id', label: 'שם סופר', type: 'select', options: optContacts },
      { k: 'amount', label: 'סך ששולם', type: 'number' },
      { k: 'note', label: 'הערה', type: 'textarea' },
    ],
    cols: [
      { label: 'תאריך', render: r => dt(r.date) },
      { label: 'סופר', render: r => esc(r.scribe_name || '—') },
      { label: 'סך ששולם', cls: 'num', render: r => mCell(r.amount), total: rows => mCell(sumBy(rows, 'amount')) },
      { label: 'הערה', cls: 'wrap', render: r => esc(r.note || '') },
    ],
  });
}

function prodCustPay() {
  return entityPage({
    title: 'תשלומי לקוחות (מוצרים)', bulk: 'prod_customer_payments', store: Store.prodCustomerPayments,
    load: () => Store.prodCustomerPayments.list(),
    labelOf: (r) => `תשלום ${money(r.paid_actual)}`,
    defaults: () => ({ date: today() }),
    totals: true,
    fields: [
      { k: 'date', label: 'תאריך', type: 'date' },
      { k: 'customer_id', label: 'שם לקוח', type: 'select', options: optContacts },
      { k: 'amount_ils', label: 'סכום ששולם בש"ח', type: 'number' },
      { k: 'amount_usd', label: 'סכום ששולם בדולר', type: 'number' },
      { k: 'rate', label: 'שער יציג', type: 'number' },
      { k: 'cash_in_hand', label: 'מזומן בש"ח ביד בפועל', type: 'number' },
      { k: 'note', label: 'הערה', type: 'textarea' },
    ],
    cols: [
      { label: 'תאריך', render: r => dt(r.date) },
      { label: 'לקוח', render: r => esc(r.customer_name || '—') },
      { label: 'ש"ח', cls: 'num', render: r => mCell(r.amount_ils), total: rows => mCell(sumBy(rows, 'amount_ils')) },
      { label: 'דולר', cls: 'num', render: r => numCell(r.amount_usd), total: rows => numCell(sumBy(rows, 'amount_usd')) },
      { label: 'שער', cls: 'num', render: r => r.rate ? numCell(r.rate) : '' },
      { label: 'מזומן ביד', cls: 'num', render: r => r.amount_usd ? mCell(r.cash_in_hand) : '' },
      { label: 'עלות פריטה', cls: 'num', render: r => r.amount_usd ? mCell(r.peritah) : '', total: rows => mCell(sumBy(rows, 'peritah')) },
      { label: 'ס"ה שולם', cls: 'num', render: r => mCell(r.paid_actual), total: rows => mCell(sumBy(rows, 'paid_actual')) },
      { label: 'הערה', cls: 'wrap', render: r => esc(r.note || '') },
    ],
  });
}

// ============ דוחות ============
function pageReports() {
  const subs = [
    { k: 'overview', label: 'רווח כולל' },
    { k: 'byscroll', label: 'רווח לפי ספר' },
    { k: 'scribes', label: 'יתרות סופרים' },
    { k: 'customers', label: 'יתרות רוכשים' },
    { k: 'monthly', label: 'סיכום חודשי' },
    { k: 'inventory', label: 'מלאי מוצרים' },
    { k: 'scribecard', label: 'כרטיס סופר' },
    { k: 'custcard', label: 'כרטיס רוכש' },
  ];
  renderSubtabs('reports', subs);
  const s = SUB.reports;
  if (s === 'overview') return repProfit();
  if (s === 'byscroll') return repByScroll();
  if (s === 'scribes') return repScribeBalances();
  if (s === 'customers') return repCustomerBalances();
  if (s === 'monthly') return repMonthly();
  if (s === 'inventory') return repInventory();
  if (s === 'scribecard') return repCard('scribe');
  return repCard('customer');
}

async function repProfit() {
  const d = await Store.reports.profit();
  const line = (k, v, bold) => `<div class="k">${k}</div><div class="num ${bold ? 'b' : ''}">${bold ? `<b>${money(v)}</b>` : money(v)}</div>`;
  $('view').innerHTML += `
    <div class="grid stat-grid">
      <div class="stat"><div class="label">רווח נקי כולל</div>
        <div class="value ${d.net_profit >= 0 ? 'g' : 'r'}">${money(d.net_profit)}</div></div>
      <div class="stat"><div class="label">רווח ס"ת</div><div class="value b">${money(d.scrolls.profit)}</div></div>
      <div class="stat"><div class="label">רווח מוצרים</div><div class="value b">${money(d.products.profit)}</div></div>
      <div class="stat"><div class="label">הוצאות עסק</div><div class="value a">${money(d.business_expenses)}</div></div>
    </div>
    <div class="card"><h3>מערכת ס"ת</h3><div class="kv">
      ${line('הכנסות (מחיר לרוכשים)', d.scrolls.revenue)}
      ${line('עלות הסופרים', d.scrolls.scribe_cost)}
      ${line('עלות פריטה', d.scrolls.peritah)}
      ${line('הוצאות קבועות', d.scrolls.fixed_expenses)}
      ${line('הוצאות לספר', d.scrolls.book_expenses)}
      ${line('צפי קלף', d.scrolls.parchment_expected)}
      ${line('(עלות קלף בפועל)', d.scrolls.parchment_actual)}
      ${line('רווח ס"ת', d.scrolls.profit, true)}
    </div></div>
    <div class="card"><h3>מערכת מוצרים</h3><div class="kv">
      ${line('הכנסות ממכירות', d.products.revenue)}
      ${line('עלות המוצרים', d.products.cost)}
      ${line('ניכוי 3%', d.products.deduct_3pct)}
      ${line('רווח מוצרים', d.products.profit, true)}
      ${line('עלות פריטה (יורדת מהרווח הכולל)', d.products.peritah)}
      ${line('חוב לסופרים', d.products.owed_scribes)}
      ${line('חוב הלקוחות', d.products.customer_owes)}
    </div></div>
    <div class="card"><h3>הוצאות עסק לפי סוג</h3>
      ${tableHTML([{ label: 'סוג', render: r => esc(r.type || '—') },
                   { label: 'סכום', cls: 'num', render: r => mCell(r.total), total: rows => mCell(sumBy(rows, 'total')) }],
                  d.business_expenses_by_type, { totals: true })}</div>
    <div class="card"><h3>חישוב הרווח הנקי</h3><div class="kv">
      ${line('רווח ס"ת', d.scrolls.profit)}
      ${line('+ רווח מוצרים', d.products.profit)}
      ${line('− עלות פריטה (מוצרים)', d.products.peritah)}
      ${line('− הוצאות עסק', d.business_expenses)}
      ${line('= רווח נקי', d.net_profit, true)}
    </div></div>`;
}

async function repByScroll() {
  const rows = await Store.reports.byScroll();
  const cols = [
    { label: '#', render: r => r.id },
    { label: 'מוצר', render: r => esc(r.product_name || '—') },
    { label: 'סופר', render: r => esc(r.scribe_name || '—') },
    { label: 'רוכש', render: r => esc(r.customer_name || '—') },
    { label: 'מחיר לרוכש', cls: 'num', render: r => mCell(r.buyer_total), total: rows => mCell(sumBy(rows, 'buyer_total')) },
    { label: 'עלות סופר', cls: 'num', render: r => mCell(r.scribe_book_price), total: rows => mCell(sumBy(rows, 'scribe_book_price')) },
    { label: 'פריטה', cls: 'num', render: r => mCell(r.peritah_cost), total: rows => mCell(sumBy(rows, 'peritah_cost')) },
    { label: 'הוצ\' קבועה', cls: 'num', render: r => mCell(r.fixed_expense), total: rows => mCell(sumBy(rows, 'fixed_expense')) },
    { label: 'הוצ\' לספר', cls: 'num', render: r => mCell(r.book_expenses), total: rows => mCell(sumBy(rows, 'book_expenses')) },
    { label: 'צפי קלף', cls: 'num', render: r => mCell(r.parchment_expected), total: rows => mCell(sumBy(rows, 'parchment_expected')) },
    { label: 'קלף בפועל', cls: 'num', render: r => mCell(r.parchment_actual), total: rows => mCell(sumBy(rows, 'parchment_actual')) },
    { label: 'רווח צפוי', cls: 'num', render: r => mCell(r.expected_profit), total: rows => mCell(sumBy(rows, 'expected_profit')) },
  ];
  $('view').innerHTML += `<div class="card">${tableHTML(cols, rows, { totals: true })}</div>`;
}

async function repScribeBalances() {
  const rows = await Store.reports.scribeBalances();
  const cols = [
    { label: 'סופר', render: r => `<span class="link" data-card="${r.id}">${esc(r.name)}</span>` },
    { label: 'טלפון', render: r => esc(r.phone || '') },
    { label: 'ספרים', cls: 'num', render: r => r.scrolls_count || 0 },
    { label: 'יתרה ס"ת', cls: 'num', render: r => mCell(r.scroll_balance), total: rows => mCell(sumBy(rows, 'scroll_balance')) },
    { label: 'עתידי ס"ת', cls: 'num', render: r => mCell(r.scroll_future), total: rows => mCell(sumBy(rows, 'scroll_future')) },
    { label: 'חוב מוצרים', cls: 'num', render: r => mCell(r.product_owed), total: rows => mCell(sumBy(rows, 'product_owed')) },
    { label: 'שולם מוצרים', cls: 'num', render: r => mCell(r.product_paid), total: rows => mCell(sumBy(rows, 'product_paid')) },
    { label: 'יתרה מוצרים', cls: 'num', render: r => mCell(r.product_balance), total: rows => mCell(sumBy(rows, 'product_balance')) },
    { label: 'סה"כ חוב', cls: 'num', render: r => `<b>${mCell(r.total_balance)}</b>`, total: rows => `<b>${mCell(sumBy(rows, 'total_balance'))}</b>` },
  ];
  $('view').innerHTML += `<div class="card">${tableHTML(cols, rows, { totals: true })}</div>`;
  document.querySelectorAll('[data-card]').forEach(b => b.onclick = () => openCard('scribe', +b.dataset.card));
}

async function repCustomerBalances() {
  const rows = await Store.reports.customerBalances();
  const cols = [
    { label: 'רוכש', render: r => `<span class="link" data-card="${r.id}">${esc(r.name)}</span>` },
    { label: 'טלפון', render: r => esc(r.phone || '') },
    { label: 'ספרים', cls: 'num', render: r => r.scrolls_count || 0 },
    { label: 'יתרה מיידית ס"ת', cls: 'num', render: r => mCell(r.scroll_due_now), total: rows => mCell(sumBy(rows, 'scroll_due_now')) },
    { label: 'יתרה כללית ס"ת', cls: 'num', render: r => mCell(r.scroll_due_total), total: rows => mCell(sumBy(rows, 'scroll_due_total')) },
    { label: 'מכירות מוצרים', cls: 'num', render: r => mCell(r.product_revenue), total: rows => mCell(sumBy(rows, 'product_revenue')) },
    { label: 'שולם מוצרים', cls: 'num', render: r => mCell(r.product_paid), total: rows => mCell(sumBy(rows, 'product_paid')) },
    { label: 'יתרה מוצרים', cls: 'num', render: r => mCell(r.product_balance), total: rows => mCell(sumBy(rows, 'product_balance')) },
    { label: 'סה"כ מיידי', cls: 'num', render: r => `<b>${mCell(r.total_due_now)}</b>`, total: rows => `<b>${mCell(sumBy(rows, 'total_due_now'))}</b>` },
    { label: 'סה"כ כללי', cls: 'num', render: r => mCell(r.total_due_overall), total: rows => mCell(sumBy(rows, 'total_due_overall')) },
  ];
  $('view').innerHTML += `<div class="card">${tableHTML(cols, rows, { totals: true })}</div>`;
  document.querySelectorAll('[data-card]').forEach(b => b.onclick = () => openCard('customer', +b.dataset.card));
}

async function repMonthly() {
  const year = repMonthly._y || new Date().getFullYear();
  const d = await Store.reports.monthly(year);
  const names = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];
  const max = Math.max(1, ...d.months.map(m => Math.abs(m.profit)));
  const bars = d.months.map((m, i) => `<div class="b ${m.profit < 0 ? 'neg' : ''}"
      style="height:${Math.max(2, Math.abs(m.profit) / max * 100)}%" title="${names[i]}: ${money(m.profit)}"></div>`).join('');
  const cols = [
    { label: 'חודש', render: (r, i) => names[i] },
    { label: 'מכירות ס"ת', cls: 'num', render: r => mCell(r.scroll_sales), total: rows => mCell(sumBy(rows, 'scroll_sales')) },
    { label: 'רווח ס"ת', cls: 'num', render: r => mCell(r.scroll_profit), total: rows => mCell(sumBy(rows, 'scroll_profit')) },
    { label: 'מכירות מוצרים', cls: 'num', render: r => mCell(r.product_sales), total: rows => mCell(sumBy(rows, 'product_sales')) },
    { label: 'רווח מוצרים', cls: 'num', render: r => mCell(r.product_profit), total: rows => mCell(sumBy(rows, 'product_profit')) },
    { label: 'תקבולים', cls: 'num', render: r => mCell(r.received), total: rows => mCell(sumBy(rows, 'received')) },
    { label: 'שולם לסופרים', cls: 'num', render: r => mCell(r.paid_scribes), total: rows => mCell(sumBy(rows, 'paid_scribes')) },
    { label: 'הוצ\' לספר+קלף', cls: 'num', render: r => mCell(r.book_expenses), total: rows => mCell(sumBy(rows, 'book_expenses')) },
    { label: 'הוצ\' עסק', cls: 'num', render: r => mCell(r.business_expenses), total: rows => mCell(sumBy(rows, 'business_expenses')) },
    { label: 'רווח', cls: 'num', render: r => `<b>${mCell(r.profit)}</b>`, total: rows => `<b>${mCell(sumBy(rows, 'profit'))}</b>` },
  ];
  const years = [];
  for (let y = new Date().getFullYear() + 1; y >= 2020; y--) years.push(y);
  $('view').innerHTML += `
    <div class="toolbar"><label class="mini">שנה:</label>
      <select id="yearSel">${years.map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
    <div class="card"><h3>רווח חודשי ${year}</h3><div class="mbar">${bars}</div>
      <div style="display:flex;gap:4px;margin-top:6px">${names.map(nm => `<div style="flex:1;text-align:center" class="mini">${nm}</div>`).join('')}</div></div>
    <div class="card">${tableHTML(cols, d.months, { totals: true })}</div>`;
  $('yearSel').onchange = (e) => { repMonthly._y = +e.target.value; render(); };
}

async function repInventory() {
  const d = await Store.reports.inventory();
  const cols = [
    { label: 'מוצר', render: r => esc(r.product_name || '—') },
    { label: 'סופר', render: r => esc(r.scribe_name || '—') },
    { label: 'תאריך רכישה', render: r => dt(r.date) },
    { label: 'נקנה', cls: 'num', render: r => numCell(r.quantity) },
    { label: 'נמכר', cls: 'num', render: r => numCell(r.sold_qty) },
    { label: 'נשאר', cls: 'num', render: r => `<span class="pill ${N(r.remaining_qty) > 0 ? 'g' : 'n'}">${N(r.remaining_qty)}</span>` },
    { label: 'עלות ליח\'', cls: 'num', render: r => mCell(r.unit_cost) },
    { label: 'שווי מלאי', cls: 'num', render: r => mCell(r.stock_value), total: rows => mCell(sumBy(rows, 'stock_value')) },
  ];
  $('view').innerHTML += `
    <div class="grid stat-grid">
      <div class="stat"><div class="label">יחידות במלאי</div><div class="value b">${N(d.total_units).toLocaleString('he-IL')}</div></div>
      <div class="stat"><div class="label">שווי המלאי</div><div class="value a">${money(d.total_value)}</div></div>
    </div>
    <div class="card">${tableHTML(cols, d.rows, { totals: true })}</div>`;
}

function repCard(kind) {
  const label = kind === 'scribe' ? 'סופר' : 'רוכש';
  $('view').innerHTML += `
    <div class="toolbar"><label class="mini">בחר ${label}:</label>
      <select id="cardSel">${optBlank('— בחר —')}${optContacts('')}</select></div>
    <div id="cardBody"></div>`;
  $('cardSel').onchange = async (e) => {
    if (!e.target.value) return ($('cardBody').innerHTML = '');
    $('cardBody').innerHTML = '<div class="card muted">טוען…</div>';
    try {
      const d = await Store.reports[kind](e.target.value);
      $('cardBody').innerHTML = kind === 'scribe' ? scribeCardHTML(d) : customerCardHTML(d);
    } catch (err) { $('cardBody').innerHTML = `<div class="card" style="color:var(--red)">${esc(err.message)}</div>`; }
  };
}

async function openCard(kind, id) {
  try {
    const d = await Store.reports[kind](id);
    modal({ title: `כרטיס ${kind === 'scribe' ? 'סופר' : 'רוכש'} — ${esc(d.contact.name)}`, wide: true,
            body: kind === 'scribe' ? scribeCardHTML(d) : customerCardHTML(d) });
  } catch (e) { toast(e.message, 'err'); }
}

function scribeCardHTML(d) {
  const t = d.scroll_totals, p = d.product_totals;
  return `
    <div class="grid stat-grid">
      <div class="stat"><div class="label">סה"כ חוב לסופר</div><div class="value r">${money(d.total_balance)}</div>
        <div class="sub">ס"ת ${money(t.balance)} + מוצרים ${money(p.balance)}</div></div>
      <div class="stat"><div class="label">יתרה עתידית (ס"ת)</div><div class="value a">${money(t.future_balance)}</div></div>
      <div class="stat"><div class="label">ספרים</div><div class="value">${t.count}</div></div>
    </div>
    <div class="card"><h3>צד ס"ת</h3>
      ${tableHTML([
        { label: '#', render: r => r.id },
        { label: 'מוצר', render: r => esc(r.product_name || '—') },
        { label: 'עמודים', render: r => `${r.pages_written}/${r.product_pages}` },
        { label: 'מחיר לעמוד', cls: 'num', render: r => mCell(r.page_rate) },
        { label: 'מחיר לספר', cls: 'num', render: r => mCell(r.scribe_book_price) },
        { label: 'מגיע לפי התקדמות', cls: 'num', render: r => mCell(r.scribe_due_progress) },
        { label: 'שולם', cls: 'num', render: r => mCell(r.scribe_paid) },
        { label: 'תיקונים', cls: 'num', render: r => mCell(r.corrections_paid) },
        { label: 'יתרה', cls: 'num', render: r => `<b>${mCell(r.scribe_balance)}</b>` },
        { label: 'עתידי', cls: 'num', render: r => mCell(r.scribe_future_balance) },
      ], d.scrolls)}
    </div>
    <div class="card"><h3>צד מוצרים — רכישות ממנו</h3>
      ${tableHTML([
        { label: 'תאריך', render: r => dt(r.date) },
        { label: 'מוצר', render: r => esc(r.product_name || '—') },
        { label: 'כמות', cls: 'num', render: r => numCell(r.quantity) },
        { label: 'נשאר', cls: 'num', render: r => numCell(r.remaining_qty) },
        { label: 'עלות ליח\'', cls: 'num', render: r => mCell(r.cost_per_unit) },
        { label: 'חוב', cls: 'num', render: r => mCell(r.owed) },
      ], d.purchases)}
      <div class="kv" style="margin-top:10px">
        <div class="k">סה"כ חוב מוצרים</div><div class="num">${money(p.owed)}</div>
        <div class="k">שולם</div><div class="num">${money(p.paid)}</div>
        <div class="k"><b>יתרה</b></div><div class="num"><b>${money(p.balance)}</b></div>
      </div>
    </div>
    <div class="card"><h3>תשלומים ששולמו לו (מוצרים)</h3>
      ${tableHTML([{ label: 'תאריך', render: r => dt(r.date) },
                   { label: 'סכום', cls: 'num', render: r => mCell(r.amount) },
                   { label: 'הערה', cls: 'wrap', render: r => esc(r.note || '') }], d.product_payments)}
    </div>`;
}

function customerCardHTML(d) {
  const t = d.scroll_totals, p = d.product_totals;
  return `
    <div class="grid stat-grid">
      <div class="stat"><div class="label">חוב מיידי</div><div class="value r">${money(d.total_due_now)}</div></div>
      <div class="stat"><div class="label">חוב כללי</div><div class="value a">${money(d.total_due_overall)}</div></div>
      <div class="stat"><div class="label">עלות פריטה</div><div class="value">${money(N(t.peritah) + N(p.peritah))}</div></div>
    </div>
    <div class="card"><h3>צד ס"ת — ספרים שרכש</h3>
      ${tableHTML([
        { label: '#', render: r => r.id },
        { label: 'מוצר', render: r => esc(r.product_name || '—') },
        { label: 'עמודים', render: r => `${r.pages_written}/${r.product_pages}` },
        { label: 'מחיר', cls: 'num', render: r => mCell(r.buyer_total, r.buyer_currency) },
        { label: 'לפי התקדמות', cls: 'num', render: r => mCell(r.buyer_due_progress) },
        { label: 'שילם', cls: 'num', render: r => mCell(r.customer_paid) },
        { label: 'פריטה', cls: 'num', render: r => mCell(r.peritah_cost) },
        { label: 'יתרה מיידית', cls: 'num', render: r => `<b>${mCell(r.buyer_balance_now)}</b>` },
        { label: 'יתרה כללית', cls: 'num', render: r => mCell(r.buyer_balance_total) },
      ], d.scrolls)}
    </div>
    <div class="card"><h3>תשלומיו (ס"ת)</h3>
      ${tableHTML([{ label: 'תאריך', render: r => dt(r.date) },
                   { label: '₪', cls: 'num', render: r => mCell(r.amount_ils) },
                   { label: '$', cls: 'num', render: r => numCell(r.amount_usd) },
                   { label: 'שער', cls: 'num', render: r => r.rate ? numCell(r.rate) : '' },
                   { label: 'פריטה', cls: 'num', render: r => mCell(r.peritah) },
                   { label: 'שולם בפועל', cls: 'num', render: r => mCell(r.paid_actual) }], d.scroll_payments)}
    </div>
    <div class="card"><h3>צד מוצרים — מכירות לו</h3>
      ${tableHTML([{ label: 'תאריך', render: r => dt(r.date) },
                   { label: 'מוצר', render: r => esc(r.product_name || '—') },
                   { label: 'כמות', cls: 'num', render: r => numCell(r.quantity) },
                   { label: 'מחיר ליח\'', cls: 'num', render: r => mCell(r.price_per_unit) },
                   { label: 'סך מכירה', cls: 'num', render: r => mCell(r.total_sale) }], d.sales)}
      <div class="kv" style="margin-top:10px">
        <div class="k">סה"כ מכירות</div><div class="num">${money(p.revenue)}</div>
        <div class="k">שילם</div><div class="num">${money(p.paid)}</div>
        <div class="k"><b>יתרה</b></div><div class="num"><b>${money(p.balance)}</b></div>
      </div>
    </div>
    <div class="card"><h3>תשלומיו (מוצרים)</h3>
      ${tableHTML([{ label: 'תאריך', render: r => dt(r.date) },
                   { label: '₪', cls: 'num', render: r => mCell(r.amount_ils) },
                   { label: '$', cls: 'num', render: r => numCell(r.amount_usd) },
                   { label: 'פריטה', cls: 'num', render: r => mCell(r.peritah) },
                   { label: 'ס"ה שולם', cls: 'num', render: r => mCell(r.paid_actual) }], d.product_payments)}
    </div>`;
}

// ============ הגדרות ============
function pageSettings() {
  const subs = [
    { k: 'contacts', label: 'אנשי קשר' },
    { k: 'products', label: 'מוצרים' },
    { k: 'sizes', label: 'גדלי קלף' },
    { k: 'expbook', label: 'סוגי הוצאות לספר' },
    { k: 'expbiz', label: 'סוגי הוצאות עסק' },
  ];
  renderSubtabs('settings', subs);
  const s = SUB.settings;
  if (s === 'contacts') return setContacts();
  if (s === 'products') return setProducts();
  if (s === 'sizes') return setSizes();
  if (s === 'expbook') return setList('expense_book', 'סוגי הוצאות לספר', true);
  return setList('expense_business', 'סוגי הוצאות עסק', false);
}

function setContacts() {
  return entityPage({
    title: 'אנשי קשר', bulk: 'contacts', store: Store.contacts,
    load: () => Store.contacts.list(),
    labelOf: (r) => contactName(r),
    note: 'רשימה אחת — ממנה נבחרים גם הסופרים וגם הרוכשים. התפקיד נקבע בעסקה עצמה.',
    fields: [
      { k: 'name', label: 'שם', type: 'text', required: true },
      { k: 'phone', label: 'טלפון', type: 'text' },
    ],
    cols: [
      { label: 'שם', render: r => esc(r.name || '') },
      { label: 'טלפון', render: r => esc(r.phone || '') },
    ],
  });
}

function setProducts() {
  return entityPage({
    title: 'מוצרים', bulk: 'products', store: Store.products,
    load: () => Store.products.list(),
    labelOf: (r) => r.name,
    note: 'מספר העמודים משמש לחישוב מחיר-לעמוד ולהתקדמות. יחידות הקלף מזינות את "צפי קלף".',
    fields: [
      { k: 'name', label: 'שם המוצר', type: 'text', required: true },
      { k: 'parchment_units', label: 'יחידות קלף', type: 'number' },
      { k: 'pages', label: 'מספר עמודים', type: 'number' },
      { k: 'fixed_expense', label: 'הוצאה קבועה', type: 'number' },
    ],
    cols: [
      { label: 'שם המוצר', render: r => esc(r.name) },
      { label: 'יחידות קלף', cls: 'num', render: r => numCell(r.parchment_units) },
      { label: 'עמודים', cls: 'num', render: r => numCell(r.pages) },
      { label: 'הוצאה קבועה', cls: 'num', render: r => mCell(r.fixed_expense) },
    ],
  });
}

function setSizes() {
  return entityPage({
    title: 'גדלי קלף', bulk: 'parchment_sizes', store: Store.sizes,
    load: () => Store.sizes.list(),
    labelOf: (r) => r.name,
    fields: [
      { k: 'name', label: 'שם הגודל', type: 'text', required: true },
      { k: 'cost_per_unit', label: 'עלות ליחידת קלף', type: 'number' },
    ],
    cols: [
      { label: 'שם הגודל', render: r => esc(r.name) },
      { label: 'עלות ליחידה', cls: 'num', render: r => mCell(r.cost_per_unit) },
    ],
  });
}

async function setList(listName, title, withCorrection) {
  const rows = await Store.lists.one(listName);
  const cols = [
    ...(ME.caps.del ? [selCol('list_items')] : []),
    { label: 'ערך', render: r => esc(r.value) },
  ];
  if (withCorrection) cols.push({
    label: 'נחשב כתיקונים', cls: 'center',
    render: r => r.is_correction ? '<span class="pill a">כן</span>' : '<span class="pill n">לא</span>'
  });
  cols.push({
    label: '', cls: 'center', render: (r) => {
      let h = '';
      if (ME.caps.edit) h += `<button class="btn ghost xs" data-ed="${r.id}">✎</button> `;
      if (ME.caps.del) h += `<button class="btn ghost xs" data-rm="${r.id}">🗑</button>`;
      return h;
    }
  });
  $('view').innerHTML += `
    <div class="page-head"><h2>${esc(title)}</h2><div class="spacer"></div>
      ${bulkBtn('list_items', title, { list_name: listName })}
      ${ME.caps.edit ? `<button class="btn" id="addLi">+ הוספה</button>` : ''}</div>
    ${withCorrection ? `<div class="card mini">ערך המסומן כ<b>תיקונים</b> נזקף לצד הסופר במקום להיחשב הוצאה לספר. אפשר לסמן יותר מאחד.</div>` : ''}
    <div class="card">${tableHTML(cols, rows)}</div>`;

  const openLi = (row) => {
    const body = `<div class="field"><label>ערך</label><input id="li_v" value="${esc(row ? row.value : '')}"></div>
      ${withCorrection ? `<div class="chk"><input type="checkbox" id="li_c" ${row && row.is_correction ? 'checked' : ''}>
        <label for="li_c">נחשב כתיקונים (נזקף לצד הסופר)</label></div>` : ''}`;
    const m = modal({ title: row ? 'עריכת ערך' : 'ערך חדש', body,
      footer: `<button class="btn" data-ok>שמירה</button><button class="btn ghost" data-no>ביטול</button>` });
    m.el.querySelector('[data-no]').onclick = m.close;
    m.el.querySelector('[data-ok]').onclick = async () => {
      const v = $('li_v').value.trim();
      const c = withCorrection ? $('li_c').checked : false;
      if (!v) return toast('יש להזין ערך', 'err');
      try {
        if (row) await Store.lists.update(row.id, { value: v, is_correction: c });
        else await Store.lists.create(listName, v, c);
        toast('נשמר', 'ok'); m.close(); await reloadCaches(); render();
      } catch (e) { toast(e.message, 'err'); }
    };
  };
  if ($('addLi')) $('addLi').onclick = () => openLi(null);
  wireBulkBtns();
  wireSelection();
  document.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => openLi(rows.find(r => r.id === +b.dataset.ed)));
  document.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
    const r = rows.find(x => x.id === +b.dataset.rm);
    if (!(await confirmBox(`למחוק את "${r.value}"?`))) return;
    try { await Store.lists.remove(r.id); toast('נמחק', 'ok'); await reloadCaches(); render(); }
    catch (e) { toast(e.message, 'err'); }
  });
}

// ============ מערכת ============
function pageSystem() {
  const subs = [{ k: 'recycle', label: 'סל מחזור' }];
  if (ME.caps.manageUsers) subs.push({ k: 'users', label: 'משתמשים' });
  if (!subs.find(s => s.k === SUB.system)) SUB.system = 'recycle';
  renderSubtabs('system', subs);
  return SUB.system === 'users' ? pageUsers() : pageRecycle();
}

async function pageRecycle() {
  const summary = await Store.recycle.summary();
  if (!summary.length) {
    $('view').innerHTML += `<div class="card"><div class="empty"><div class="big">🗑</div>סל המחזור ריק</div></div>`;
    return;
  }
  $('view').innerHTML += `<div class="card mini">שום דבר לא נמחק פיזית מהמערכת — כל רשומה שנמחקה ניתנת לשחזור מכאן.</div>
    <div id="recWrap">${summary.map(s =>
      `<div class="card"><div class="page-head"><h3>${esc(s.label)}</h3>
        <span class="pill n">${s.count}</span><div class="spacer"></div>
        <button class="btn ghost sm" data-show="${s.table}">הצג</button></div>
        <div id="rec_${s.table}"></div></div>`).join('')}</div>`;
  document.querySelectorAll('[data-show]').forEach(b => b.onclick = async () => {
    const table = b.dataset.show;
    const rows = await Store.recycle.list(table);
    $('rec_' + table).innerHTML = tableHTML([
      { label: 'תיאור', cls: 'wrap', render: r => esc(r.description || ('#' + r.id)) },
      { label: 'נמחק בתאריך', render: r => r.deleted_at ? dt(r.deleted_at) : '' },
      { label: '', cls: 'center', render: r => ME.caps.del ? `<button class="btn green xs" data-res="${table}:${r.id}">שחזור</button>` : '' },
    ], rows);
    document.querySelectorAll('[data-res]').forEach(rb => rb.onclick = async () => {
      const [t, id] = rb.dataset.res.split(':');
      try { await Store.recycle.restore(t, id); toast('שוחזר בהצלחה', 'ok'); await reloadCaches(); render(); }
      catch (e) { toast(e.message, 'err'); }
    });
  });
}

async function pageUsers() {
  const [users, roles] = await Promise.all([Store.users.list(), Store.users.roles()]);
  const cols = [
    { label: 'שם משתמש', render: r => esc(r.username) },
    { label: 'שם מלא', render: r => esc(r.full_name || '') },
    { label: 'תפקיד', render: r => `<span class="pill n">${esc(r.role_label || r.role)}</span>` },
    { label: 'פעיל', render: r => r.active ? '<span class="pill g">כן</span>' : '<span class="pill r">לא</span>' },
    { label: 'כניסה אחרונה', render: r => r.last_login ? dt(r.last_login) : '—' },
    { label: '', cls: 'center', render: r => `<button class="btn ghost xs" data-eu="${r.id}">✎</button>` },
  ];
  $('view').innerHTML += `
    <div class="page-head"><h2>משתמשים</h2><div class="spacer"></div>
      <button class="btn" id="addU">+ משתמש</button></div>
    <div class="card">${tableHTML(cols, users)}</div>`;

  const openU = (row) => {
    const body = `
      <div class="field"><label>שם משתמש</label>
        <input id="u_name" value="${esc(row ? row.username : '')}" ${row ? 'disabled' : ''}></div>
      <div class="field"><label>שם מלא</label><input id="u_full" value="${esc(row ? row.full_name || '' : '')}"></div>
      <div class="field"><label>סיסמא ${row ? '(השאר ריק כדי לא לשנות)' : ''}</label><input id="u_pass" type="password"></div>
      <div class="field"><label>תפקיד</label><select id="u_role">
        ${roles.map(r => `<option value="${r.role}" ${row && row.role === r.role ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select></div>
      ${row ? `<div class="chk"><input type="checkbox" id="u_act" ${row.active ? 'checked' : ''}><label for="u_act">משתמש פעיל</label></div>` : ''}`;
    const m = modal({ title: row ? 'עריכת משתמש' : 'משתמש חדש', body,
      footer: `<button class="btn" data-ok>שמירה</button><button class="btn ghost" data-no>ביטול</button>` });
    m.el.querySelector('[data-no]').onclick = m.close;
    m.el.querySelector('[data-ok]').onclick = async () => {
      const d = { full_name: $('u_full').value, role: $('u_role').value };
      if ($('u_pass').value) d.password = $('u_pass').value;
      if (row) d.active = $('u_act').checked; else d.username = $('u_name').value;
      try {
        if (row) await Store.users.update(row.id, d);
        else {
          if (!d.username || !d.password) return toast('שם משתמש וסיסמא חובה', 'err');
          await Store.users.create(d);
        }
        toast('נשמר', 'ok'); m.close(); render();
      } catch (e) { toast(e.message, 'err'); }
    };
  };
  $('addU').onclick = () => openU(null);
  document.querySelectorAll('[data-eu]').forEach(b => b.onclick = () => openU(users.find(u => u.id === +b.dataset.eu)));
}

// ============ ייבוא ============
// פענוח הדבקה מגוגל שיטס/אקסל -> מערך אובייקטים לפי מיפוי עמודות.
function parseImportPaste(spec, text, mode) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter(l => l.trim() !== '');
  if (!lines.length) return { rows: [], mapping: [], hasHeader: false };
  const cells = lines.map(l => l.split('\t').map(c => c.trim()));

  // מילון: תווית או מפתח מנורמלים -> key.
  // מזהים גם וריאציות נפוצות: "שם סופר" במקום "סופר", "מטבע" בלי הסוגריים.
  const lookup = { 'מזהה': 'id', '#': 'id', 'id': 'id' };
  for (const c of spec.cols) {
    const L = c.label.replace(/\s+/g, ' ').trim();
    lookup[L] = c.key;
    lookup[c.key] = c.key;
    const short = L.split(' (')[0].trim();
    if (lookup[short] === undefined) lookup[short] = c.key;
  }
  const findKey = (cellRaw) => {
    const cell = String(cellRaw || '').replace(/\s+/g, ' ').trim();
    if (cell === '') return undefined;
    if (lookup[cell] !== undefined) return lookup[cell];
    const noParen = cell.split(' (')[0].trim();
    if (lookup[noParen] !== undefined) return lookup[noParen];
    const noShem = cell.replace(/^שם\s+/, '').trim();
    if (lookup[noShem] !== undefined) return lookup[noShem];
    return undefined;
  };
  const first = cells[0];
  let matched = 0;
  for (const cell of first) if (findKey(cell) !== undefined) matched++;
  const hasHeader = first.length > 1 && matched >= Math.max(2, Math.ceil(first.filter(Boolean).length / 2));

  let mapping, dropped = [];
  if (hasHeader) {
    mapping = first.map(cell => {
      const k = findKey(cell);
      if (k !== undefined) return k;
      const norm = String(cell || '').replace(/\s+/g, ' ').trim();
      if (norm !== '') dropped.push(norm);   // עמודה שכותרתה לא זוהתה — תושלך; חובה להראות למשתמש
      return null;
    });
  }
  else if (mode === 'update') mapping = ['id'].concat(spec.cols.map(c => c.key));   // עמודה ראשונה = מזהה
  else mapping = spec.cols.map(c => c.key);   // לפי סדר

  const dataRows = hasHeader ? cells.slice(1) : cells;
  const rows = dataRows.map(cs => {
    const o = {};
    for (let i = 0; i < mapping.length; i++) if (mapping[i]) o[mapping[i]] = cs[i];
    return o;
  });
  return { rows, mapping, hasHeader, dropped };
}

function importSpecFor(table) { return (IMPORT.spec || []).find(s => s.table === table); }

// ספריית האקסל נטענת בעצלתיים — רק כשמעלים קובץ בפעם הראשונה,
// כדי לא להכביד 900KB על כל טעינת דף.
function loadXLSX() {
  if (window.XLSX) return Promise.resolve();
  if (loadXLSX._p) return loadXLSX._p;
  loadXLSX._p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'xlsx.full.min.js';
    s.onload = () => resolve();
    s.onerror = () => { loadXLSX._p = null; reject(new Error('טעינת ספריית האקסל נכשלה')); };
    document.head.appendChild(s);
  });
  return loadXLSX._p;
}

// טעינת מפרט הייבוא פעם אחת
function ensureImportSpec() {
  if (IMPORT.spec) return Promise.resolve(IMPORT.spec);
  return Store.import.spec().then(s => { IMPORT.spec = s; return s; });
}

// ===== פאנל ייבוא/עדכון מרוכז =====
// אותו רכיב משמש גם כלשונית מלאה וגם כחלון שנפתח מתוך כל טבלה.
//   host             - האלמנט שאליו מרנדרים
//   opts.lockedTable - נעילה לטבלה אחת (מתוך לשונית) ; ריק = בורר טבלאות
//   opts.preset      - ערכים שמוצמדים לכל שורה ולא מודבקים (למשל שם הרשימה)
//   opts.onDone      - נקרא אחרי ייבוא מוצלח
let _impSeq = 0;
function importPanel(host, opts) {
  opts = opts || {};
  const P = 'ip' + (++_impSeq) + '_';
  const q = (id) => document.getElementById(P + id);
  const preset = opts.preset || {};
  const presetKeys = Object.keys(preset);
  const st = {
    table: opts.lockedTable || IMPORT.table || (IMPORT.spec[0] && IMPORT.spec[0].table),
    mode: 'create', text: '', createContacts: false,
  };

  const colChip = (c) => {
    let tag = '';
    if (c.ref) tag = ' <span class="mini">(לפי שם)</span>';
    else if (c.refId) tag = ' <span class="mini">(מס\' מזהה)</span>';
    else if (c.type === 'date') tag = ' <span class="mini">(תאריך)</span>';
    else if (c.type === 'num' || c.type === 'int') tag = ' <span class="mini">(מספר)</span>';
    return `<span class="pill n" style="margin:2px">${esc(c.label)}${c.required ? ' *' : ''}${tag}</span>`;
  };

  function draw() {
    const spec = importSpecFor(st.table) || IMPORT.spec[0];
    st.table = spec.table;
    // עמודות שהמשתמש מדביק בפועל (בלי אלו שמוצמדות מראש)
    const cols = spec.cols.filter(c => presetKeys.indexOf(c.key) < 0);
    const hasContactRef = cols.some(c => c.ref === 'contacts');
    const isUpd = st.mode === 'update';
    const isDel = st.mode === 'delete';

    host.innerHTML = `
      <div class="card">
        <div class="row">
          ${opts.lockedTable ? '' : `<div class="field" style="max-width:300px"><label>טבלה</label>
            <select id="${P}table">${IMPORT.spec.map(s =>
              `<option value="${s.table}" ${s.table === st.table ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></div>`}
          <div class="field" style="max-width:300px"><label>פעולה</label>
            <select id="${P}mode">
              <option value="create" ${st.mode === 'create' ? 'selected' : ''}>הוספת שורות חדשות</option>
              <option value="update" ${isUpd ? 'selected' : ''}>עדכון שורות קיימות (לפי מזהה)</option>
              ${ME.caps.del ? `<option value="delete" ${isDel ? 'selected' : ''}>מחיקת שורות (לפי מזהה)</option>` : ''}
            </select></div>
        </div>
        <div class="sec-title">עמודות ${isDel ? '— עמודה אחת: <b>מזהה</b>' : (isUpd ? '— עמודה ראשונה <b>מזהה</b>, ואחריה רק מה שרוצים לשנות' : '(בסדר הזה, או עם שורת כותרת תואמת)')}</div>
        <div>${isDel ? '<span class="pill r" style="margin:2px">מזהה *</span>'
                     : (isUpd ? '<span class="pill a" style="margin:2px">מזהה *</span>' : '') + cols.map(colChip).join('')}</div>
        <div class="mini" style="margin-top:8px">${isDel
          ? 'הדבק עמודת מזהים (המספר <b>#</b> מהטבלה). השורות יועברו ל<b>סל המחזור</b> — ניתן לשחזר מלשונית מערכת. מחיקת ספר מורידה איתו את היומנים שלו, ומחיקת רכישה את המכירות שנגזרו ממנה.'
          : (isUpd
            ? 'בעדכון מתעדכנות <b>רק העמודות שהדבקת</b> — שאר השדות נשארים כמו שהם. תא ריק = לא נוגעים בשדה.'
            : '* = חובה. עמודות הפניה (סופר/רוכש/מוצר/גודל) — כתוב את <b>השם</b> כפי שהוא רשום במערכת. עמודות "מס\' מזהה" (ספר/רכישה) — המספר <b>#</b> מהטבלה.')}</div>
        ${isDel ? '' : `<div style="margin-top:8px"><button class="btn ghost sm" id="${P}head">📋 העתק שורת כותרות</button></div>`}
      </div>

      <div class="card">
        <div class="toolbar" style="margin-bottom:6px">
          <button class="btn ghost sm" id="${P}file">📁 טעינה מקובץ אקסל</button>
          <input type="file" id="${P}fileInp" accept=".xlsx,.xls,.xlsm,.csv,.ods" style="display:none">
          <span class="mini" id="${P}fileInfo"></span>
        </div>
        <div class="field"><label>${isDel ? 'הדבק כאן את המזהים למחיקה — או טען קובץ' : 'הדבק כאן את השורות — או טען קובץ אקסל'}</label>
          <textarea id="${P}text" rows="8" placeholder="הדבק כאן ישירות מגוגל שיטס (Ctrl+V)…" style="width:100%;font-family:monospace;font-size:13px">${esc(st.text)}</textarea></div>
        <div id="${P}map"></div>
        ${hasContactRef && !isUpd && !isDel ? `<div class="chk"><input type="checkbox" id="${P}create" ${st.createContacts ? 'checked' : ''}>
          <label for="${P}create">צור אנשי קשר חסרים אוטומטית</label></div>` : ''}
        <div class="toolbar">
          <button class="btn ghost" id="${P}prev">🔎 בדיקה מקדימה</button>
          <button class="btn ${isDel ? 'red' : (isUpd ? 'gold' : 'green')}" id="${P}run" disabled>${isDel ? '🗑 מחק' : (isUpd ? '✎ עדכן' : '⬆ ייבא')}</button>
        </div>
        <div id="${P}res"></div>
      </div>`;

    // חיווט
    if (q('table')) q('table').onchange = (e) => { st.table = e.target.value; st.text = ''; st.map = null; draw(); };
    q('mode').onchange = (e) => { st.mode = e.target.value; st.text = ''; st.map = null; draw(); };
    q('text').oninput = (e) => { st.text = e.target.value; };
    if (q('create')) q('create').onchange = (e) => { st.createContacts = e.target.checked; };
    if (q('head')) q('head').onclick = () => {
      const hdr = (isUpd ? ['מזהה'] : []).concat(cols.map(c => c.label)).join('\t');
      navigator.clipboard.writeText(hdr).then(() => toast('הכותרות הועתקו — הדבק בשורה הראשונה בגיליון', 'ok'))
        .catch(() => toast('העתקה נכשלה', 'err'));
    };

    // העלאת קובץ אקסל -> ממלא את תיבת ההדבקה באותו פורמט (טאבים),
    // כך שכל שאר הצינור — זיהוי כותרות, בדיקה מקדימה, ייבוא — זהה להדבקה.
    q('file').onclick = () => q('fileInp').click();
    q('fileInp').onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';   // שאפשר יהיה לבחור את אותו קובץ שוב
      if (!f) return;
      try {
        await loadXLSX();
        const wb = XLSX.read(await f.arrayBuffer());
        if (!wb.SheetNames.length) return toast('הקובץ ריק', 'err');
        const fill = (name) => {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
          const text = rows
            .map(r => r.map(c => String(c == null ? '' : c).replace(/[\t\r\n]+/g, ' ').trim()).join('\t'))
            .filter(l => l.replace(/\t/g, '').trim() !== '')
            .join('\n');
          st.text = text;
          st.map = null;   // קובץ חדש = מבנה עמודות חדש
          q('text').value = text;
          const info = `${f.name} · גיליון "${name}" · ${text ? text.split('\n').length : 0} שורות`;
          const sel = q('fileInfo').querySelector('select');
          if (!sel) q('fileInfo').textContent = info;
          else q('fileInfo').querySelector('span').textContent = info;
          if (typeof renderMap === 'function') renderMap();
          toast('הקובץ נטען — בדוק את מיפוי העמודות ולחץ "בדיקה מקדימה"', 'ok');
        };
        if (wb.SheetNames.length > 1) {
          // כמה גיליונות — נותנים לבחור, וטוענים את הראשון כברירת מחדל
          q('fileInfo').innerHTML = `גיליון: <select id="${P}sheet">${wb.SheetNames.map(n =>
            `<option>${esc(n)}</option>`).join('')}</select> <span></span>`;
          q('sheet').onchange = (ev) => fill(ev.target.value);
        }
        fill(wb.SheetNames[0]);
      } catch (err) { toast('קריאת הקובץ נכשלה: ' + err.message, 'err'); }
    };

    // פענוח מזהים למחיקה: העמודה הראשונה בכל שורה, בלי שורת כותרת
    const parseIds = () => {
      const ids = [], bad = [];
      for (const line of String(st.text || '').replace(/\r/g, '').split('\n')) {
        const cell = (line.split('\t')[0] || '').trim();
        if (!cell || /^(מזהה|id|#)$/i.test(cell)) continue;
        if (/^\d+$/.test(cell)) ids.push(+cell); else bad.push(cell);
      }
      return { ids: [...new Set(ids)], bad };
    };

    // המפרט לפענוח כולל רק את העמודות שמדביקים
    const parseSpec = { cols };
    const runOpts = () => ({ createMissingContacts: st.createContacts });
    const withPreset = (rows) => presetKeys.length
      ? rows.map(r => Object.assign({}, preset, r)) : rows;

    const getCells = () => String(st.text || '').replace(/\r/g, '').split('\n')
      .filter(l => l.trim() !== '').map(l => l.split('\t').map(c => c.trim()));

    // בונה את השורות לפי המיפוי בתוקף: הזיהוי האוטומטי, או מה שהמשתמש
    // קבע ידנית בעורך המיפוי. זו ההגנה מפני עמודה שנוחתת בשדה הלא נכון —
    // המשתמש רואה בדיוק מה הולך לאן, ויכול לתקן.
    const buildRows = () => {
      const cells = getCells();
      if (!cells.length) return { rows: [], mapping: [], hasHeader: false, dropped: [], nCols: 0, headRow: null, sample: [] };
      const auto = parseImportPaste(parseSpec, st.text, st.mode);
      const nCols = Math.max(...cells.map(r => r.length));
      let mapping = auto.mapping.slice();
      while (mapping.length < nCols) mapping.push(null);
      mapping = mapping.slice(0, nCols);
      if (st.map && st.map.length === nCols) mapping = st.map;
      const dataRows = auto.hasHeader ? cells.slice(1) : cells;
      const rows = dataRows.map(cs => {
        const o = {};
        for (let i = 0; i < mapping.length; i++) if (mapping[i]) o[mapping[i]] = cs[i];
        return o;
      });
      const headRow = auto.hasHeader ? cells[0] : null;
      const dropped = [];
      mapping.forEach((m, i) => {
        if (!m) dropped.push(headRow ? ((headRow[i] || '').trim() || 'עמודה ' + (i + 1)) : 'עמודה ' + (i + 1));
      });
      return { rows, mapping, hasHeader: auto.hasHeader, dropped, nCols, headRow,
               sample: (auto.hasHeader ? cells[1] : cells[0]) || [] };
    };

    // עורך המיפוי — טבלה: עמודה בהדבקה / דוגמה / לאיזה שדה נכנסת
    const renderMap = () => {
      if (isDel || !q('map')) { if (q('map')) q('map').innerHTML = ''; return; }
      const b = buildRows();
      if (!b.nCols) { q('map').innerHTML = ''; return; }
      if (!st.map || st.map.length !== b.nCols) st.map = b.mapping.slice();
      const fieldOpts = (sel) => {
        let o = `<option value="">— התעלם —</option>`;
        if (isUpd) o += `<option value="id" ${sel === 'id' ? 'selected' : ''}>מזהה</option>`;
        o += cols.map(c => `<option value="${c.key}" ${sel === c.key ? 'selected' : ''}>${esc(c.label)}</option>`).join('');
        return o;
      };
      const used = {};
      st.map.forEach(m => { if (m) used[m] = (used[m] || 0) + 1; });
      q('map').innerHTML = `
        <div class="sec-title">מיפוי עמודות <span class="mini">${b.hasHeader ? '(זוהתה שורת כותרת)' : '(אין כותרת — לפי סדר)'} — בדוק שכל עמודה נכנסת לשדה הנכון</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>עמודה בהדבקה</th><th>דוגמה מהשורה הראשונה</th><th>נכנסת לשדה</th></tr></thead>
          <tbody>${st.map.map((m, i) => `<tr>
            <td>${b.headRow ? esc(b.headRow[i] || ('עמודה ' + (i + 1))) : 'עמודה ' + (i + 1)}</td>
            <td class="mini">${esc(String(b.sample[i] === undefined ? '' : b.sample[i]).slice(0, 30))}</td>
            <td><select data-mapi="${i}"${m && used[m] > 1 ? ' style="border-color:var(--red)"' : ''}>${fieldOpts(m)}</select></td>
          </tr>`).join('')}</tbody>
        </table></div>
        ${Object.values(used).some(v => v > 1) ? '<div class="mini neg">⚠ אותו שדה ממופה ליותר מעמודה אחת — תקן לפני ייבוא</div>' : ''}`;
      q('map').querySelectorAll('[data-mapi]').forEach(s => {
        s.onchange = () => {
          st.map[+s.dataset.mapi] = s.value || null;
          renderMap();
          q('run').disabled = true;   // מיפוי השתנה — חובה בדיקה מקדימה מחדש
        };
      });
    };

    const renderPreview = (parsed, r) => {
      const bad = r.rows.filter(x => !x.ok).slice(0, 200);
      q('res').innerHTML = `
        ${parsed.dropped && parsed.dropped.length ? `
          <div class="card" style="margin-top:6px;border-color:var(--red)">
            <b style="color:var(--red)">⚠ עמודות שלא זוהו ויושלכו:</b> ${parsed.dropped.map(esc).join(' · ')}
            <div class="mini">אם הן חשובות — תקן את הכותרות (כפתור "העתק שורת כותרות") לפני הייבוא.</div>
          </div>` : ''}
        <div class="grid stat-grid" style="margin-top:6px">
          <div class="stat"><div class="label">שורות שזוהו</div><div class="value">${r.total}</div>
            <div class="sub">${parsed.hasHeader ? 'עם שורת כותרת' : 'מופה לפי סדר העמודות'}</div></div>
          <div class="stat"><div class="label">תקינות</div><div class="value g">${r.valid}</div></div>
          <div class="stat"><div class="label">שגויות</div><div class="value ${r.invalid ? 'r' : ''}">${r.invalid}</div></div>
          ${r.new_contacts ? `<div class="stat"><div class="label">אנשי קשר חדשים</div><div class="value a">${r.new_contacts}</div></div>` : ''}
        </div>
        ${bad.length ? `<div class="card" style="margin-top:8px"><h3>שורות שיידלגו (${r.invalid})</h3>
          ${tableHTML([{ label: 'שורה', render: x => x.line }, { label: 'בעיה', cls: 'wrap', render: x => esc(x.error || '') }], bad)}
          ${r.invalid > bad.length ? `<div class="mini">…ועוד ${r.invalid - bad.length}</div>` : ''}</div>` : ''}
        ${r.valid ? `<div class="mini" style="margin-top:6px">✅ ${r.valid} שורות מוכנות. לחץ "${isUpd ? 'עדכן' : 'ייבא'}".</div>`
                  : `<div class="mini neg" style="margin-top:6px">אין שורות תקינות.</div>`}`;
    };

    q('prev').onclick = async () => {
      if (isDel) {
        const { ids, bad } = parseIds();
        if (!ids.length && !bad.length) return toast('אין מזהים להדבקה', 'err');
        q('res').innerHTML = `
          <div class="grid stat-grid" style="margin-top:6px">
            <div class="stat"><div class="label">מזהים למחיקה</div><div class="value r">${ids.length}</div></div>
            <div class="stat"><div class="label">ערכים לא תקינים</div><div class="value ${bad.length ? 'r' : ''}">${bad.length}</div></div>
          </div>
          ${bad.length ? `<div class="mini neg" style="margin-top:6px">לא מזהים: ${bad.slice(0, 20).map(esc).join(' · ')}${bad.length > 20 ? ' …' : ''}</div>` : ''}
          ${ids.length ? `<div class="mini" style="margin-top:6px">לחיצה על "מחק" תעביר את השורות לסל המחזור.</div>` : ''}`;
        q('run').disabled = ids.length === 0;
        return;
      }
      const parsed = buildRows();
      if (!parsed.rows.length) return toast('אין שורות להדבקה', 'err');
      renderMap();
      q('prev').disabled = true;
      try {
        const r = await Store.import.run(st.table, withPreset(parsed.rows), runOpts(), true, st.mode);
        renderPreview(parsed, r);
        q('run').disabled = r.valid === 0;
      } catch (e) { toast(e.message, 'err'); }
      finally { q('prev').disabled = false; }
    };

    q('run').onclick = async () => {
      const spec3 = importSpecFor(st.table);
      if (isDel) {
        const { ids } = parseIds();
        if (!ids.length) return toast('אין מזהים למחיקה', 'err');
        if (!(await confirmBox(`להעביר ${ids.length} שורות מ"${spec3.label}" לסל המחזור?`))) return;
        q('run').disabled = true;
        try {
          const r = await Store.import.bulkDelete(st.table, ids);
          q('res').innerHTML = `
            <div class="grid stat-grid" style="margin-top:6px">
              <div class="stat"><div class="label">הועברו לסל המחזור</div><div class="value g">${r.deleted}</div></div>
              <div class="stat"><div class="label">נכשלו</div><div class="value ${r.failed.length ? 'r' : ''}">${r.failed.length}</div></div>
            </div>
            ${r.failed.length ? `<div class="card" style="margin-top:8px"><h3>מזהים שנכשלו</h3>
              ${tableHTML([{ label: 'מזהה', render: x => x.id }, { label: 'סיבה', cls: 'wrap', render: x => esc(x.error || '') }], r.failed.slice(0, 200))}</div>` : ''}`;
          toast(`נמחקו ${r.deleted} שורות`, 'ok');
          st.text = '';
          if (q('text')) q('text').value = '';
          await reloadCaches();
          if (opts.onDone) opts.onDone();
        } catch (e) { toast(e.message, 'err'); q('run').disabled = false; }
        return;
      }
      const parsed = buildRows();
      if (!parsed.rows.length) return toast('אין שורות להדבקה', 'err');
      // מיפוי כפול = ערכים ידרסו זה את זה — לא ממשיכים
      const seen = {};
      for (const m of parsed.mapping) { if (m) { if (seen[m]) return toast('אותו שדה ממופה ליותר מעמודה אחת — תקן במיפוי העמודות', 'err'); seen[m] = 1; } }
      if (!(await confirmBox(`${isUpd ? 'לעדכן' : 'לייבא'} ${spec3.label} — כל השורות התקינות?`))) return;
      q('run').disabled = true;
      try {
        const r = await Store.import.run(st.table, withPreset(parsed.rows), runOpts(), false, st.mode);
        const skipped = (r.skipped || []).slice(0, 200);
        q('res').innerHTML = `
          <div class="grid stat-grid" style="margin-top:6px">
            <div class="stat"><div class="label">${isUpd ? 'עודכנו' : 'נוצרו'}</div><div class="value g">${r.created}</div></div>
            ${r.new_contacts_created ? `<div class="stat"><div class="label">אנשי קשר חדשים</div><div class="value a">${r.new_contacts_created}</div></div>` : ''}
            <div class="stat"><div class="label">דולגו</div><div class="value ${skipped.length ? 'r' : ''}">${(r.skipped || []).length}</div></div>
          </div>
          ${skipped.length ? `<div class="card" style="margin-top:8px"><h3>שורות שדולגו</h3>
            ${tableHTML([{ label: 'שורה', render: x => x.line }, { label: 'בעיה', cls: 'wrap', render: x => esc(x.error || '') }], skipped)}</div>` : ''}`;
        toast(`${isUpd ? 'עודכנו' : 'יובאו'} ${r.created} שורות`, 'ok');
        st.text = '';
        if (q('text')) q('text').value = '';   // שלא יישאר מה שכבר יובא — הדבקה כפולה בטעות
        await reloadCaches();
        if (opts.onDone) opts.onDone();
      } catch (e) { toast(e.message, 'err'); q('run').disabled = false; }
    };

    // הדבקה שכבר קיימת (חזרה לפאנל) — מציגים מיד את המיפוי
    if (st.text && !isDel) renderMap();
  }

  draw();
}

// חלון ייבוא/עדכון לטבלה מסוימת — נפתח מכל לשונית
function openImportModal(table, label, preset) {
  ensureImportSpec().then(() => {
    if (!importSpecFor(table)) return toast('הטבלה אינה נתמכת לייבוא', 'err');
    const m = modal({ title: `ייבוא / עדכון מרוכז — ${label || ''}`, wide: true, body: '<div id="impHost"></div>' });
    let changed = false;
    importPanel(m.el.querySelector('#impHost'), {
      lockedTable: table, preset: preset || null,
      onDone: () => { changed = true; },
    });
    // רענון הטבלה שמאחור רק אם באמת נכנסו נתונים
    const origClose = m.close;
    const closeAndRefresh = () => { origClose(); if (changed) render(); };
    m.el.querySelector('.x').onclick = closeAndRefresh;
    m.el.onclick = (e) => { if (e.target === m.el) closeAndRefresh(); };
  }).catch(e => toast(e.message, 'err'));
}

// כפתור "מרוכז" שמופיע בכותרת כל לשונית
function bulkBtn(table, label, preset) {
  if (!ME.caps.edit || !table) return '';
  const p = preset ? ` data-bulkpreset='${esc(JSON.stringify(preset))}'` : '';
  return `<button class="btn ghost" data-bulk="${esc(table)}" data-bulklabel="${esc(label || '')}"${p}>⇅ מרוכז</button>`;
}

function wireBulkBtns() {
  document.querySelectorAll('[data-bulk]').forEach(b => {
    b.onclick = () => {
      let preset = null;
      if (b.dataset.bulkpreset) { try { preset = JSON.parse(b.dataset.bulkpreset); } catch (e) {} }
      openImportModal(b.dataset.bulk, b.dataset.bulklabel, preset);
    };
  });
}

function pageImport() {
  if (!IMPORT.spec) {
    ensureImportSpec().then(() => render())
      .catch(e => { $('view').innerHTML = `<div class="card" style="color:var(--red)">${esc(e.message)}</div>`; });
    $('view').innerHTML = `<div class="card muted">טוען…</div>`;
    return;
  }
  $('view').innerHTML += `
    <div class="page-head"><h2>ייבוא ועדכון מרוכז</h2>
      <span class="mini">מדביקים שורות מגוגל שיטס / אקסל — המערכת מתאימה עמודות ומפענחת שמות</span></div>
    <div id="impHost"></div>`;
  importPanel($('impHost'), {});
}

// ============ ניווט ============
const TABS = [
  { k: 'dash', label: 'דשבורד', fn: pageDash },
  { k: 'scrolls', label: 'ס"ת', fn: pageScrolls },
  { k: 'scribepay', label: 'תשלום לסופר', fn: pageScribePay },
  { k: 'custpay', label: 'תשלומי לקוחות', fn: pageCustPay },
  { k: 'bookexp', label: 'הוצאות לספר', fn: pageBookExp },
  { k: 'parchexp', label: 'הוצאות קלף', fn: pageParchExp },
  { k: 'bizexp', label: 'הוצאות עסק', fn: pageBizExp },
  { k: 'prod', label: 'מוצרים', fn: pageProd },
  { k: 'reports', label: 'דוחות', fn: pageReports },
  { k: 'import', label: 'ייבוא', fn: pageImport, cap: 'edit' },
  { k: 'settings', label: 'הגדרות', fn: pageSettings },
  { k: 'system', label: 'מערכת', fn: pageSystem },
];

function visibleTabs() { return TABS.filter(t => !t.cap || (ME.caps && ME.caps[t.cap])); }

function renderTabs() {
  $('tabs').innerHTML = visibleTabs().map(t =>
    `<button data-tab="${t.k}" class="${TAB === t.k ? 'active' : ''}">${esc(t.label)}</button>`).join('');
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { TAB = b.dataset.tab; render(); });
}

function renderSubtabs(group, subs) {
  $('view').innerHTML += `<div class="subtabs">${subs.map(s =>
    `<button data-sub="${s.k}" class="${SUB[group] === s.k ? 'active' : ''}">${esc(s.label)}</button>`).join('')}</div>`;
  setTimeout(() => {
    document.querySelectorAll('[data-sub]').forEach(b =>
      b.onclick = () => { SUB[group] = b.dataset.sub; render(); });
  }, 0);
}

async function render() {
  renderTabs();
  const tab = TABS.find(t => t.k === TAB) || TABS[0];
  $('view').innerHTML = '';
  const sb = $('selBar'); if (sb) sb.remove();   // מעבר דף מבטל בחירה
  try {
    await tab.fn();
    // חיווט תתי-לשוניות אחרי שהדף התרנדר
    document.querySelectorAll('[data-sub]').forEach(b => {
      const grp = TAB;
      b.onclick = () => { SUB[grp] = b.dataset.sub; render(); };
    });
  } catch (e) {
    $('view').innerHTML = `<div class="card" style="color:var(--red)">שגיאה בטעינה: ${esc(e.message)}</div>`;
  }
}

// ============ כניסה ============
async function boot(user) {
  ME = user;
  $('userName').textContent = user.full_name || user.username;
  $('userRole').textContent = (user.caps && user.caps.label) || '';
  $('loginScreen').classList.add('hidden');
  $('app').classList.remove('hidden');
  await reloadCaches();
  render();
}

async function doLogin() {
  const u = $('loginUser').value.trim(), p = $('loginPass').value;
  if (!u || !p) { $('loginErr').textContent = 'יש למלא שם משתמש וסיסמא'; return; }
  $('loginBtn').disabled = true; $('loginErr').textContent = '';
  try {
    const r = await Store.auth.login(u, p);
    Store.setToken(r.token);
    await boot(r.user);
  } catch (e) {
    $('loginErr').textContent = e.message;
  } finally { $('loginBtn').disabled = false; }
}

$('loginForm').onsubmit = doLogin;
$('loginBtn').onclick = doLogin;
$('logoutBtn').onclick = () => { Store.setToken(''); location.reload(); };

// כניסה אוטומטית אם יש טוקן תקף
(async () => {
  if (!Store.token()) return;
  try { const r = await Store.auth.me(); await boot(r.user); }
  catch (e) { Store.setToken(''); }
})();

})();
