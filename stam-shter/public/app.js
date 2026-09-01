/* ===== שטרנקוקר — ממשק המשתמש ===== */
(function () {
'use strict';

// ============ מצב ============
let ME = null, TAB = 'dash';
const SUB = { prod: 'purchases', reports: 'overview', settings: 'contacts', system: 'recycle', track: 'summary', workspace: 'scribe' };
const C = { contacts: [], products: [], sizes: [], expBook: [], expBiz: [], scrolls: [], purchases: [], stations: [] };
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
// תווית הספר בכל מקום במערכת. המק"ט הידני מוצג ראשון — זה המזהה
// שהמשתמש מכיר; המספר הפנימי (#) נשאר בסוף לצורך התייחסות.
const scrollLabel = (s) => {
  const head = s.sku ? String(s.sku) : `#${s.id}`;
  const tail = s.sku ? ` (#${s.id})` : '';
  return `${head} · ${s.product_name || 'ללא מוצר'} · ${s.scribe_name || 'ללא סופר'}${tail}`;
};

// ---- רשימות ספרים שמצטמצמות לפי מי שנבחר בטופס ----
// הרשימה נבנית ברגע פתיחת השדה, ולכן היא משקפת את הבחירה הנוכחית.
// כשלא נבחר אף אחד — כל הספרים, כדי שאפשר יהיה לעבוד גם בלי לבחור קודם.
function scrollItemsBy(fieldKey, scrollField) {
  return () => {
    const el = $('f_' + fieldKey);
    const who = el ? +el.value : 0;
    const list = who ? C.scrolls.filter(s => +s[scrollField] === who) : C.scrolls;
    return sortHe(list.map(s => ({ v: s.id, t: scrollLabel(s) })));
  };
}
const itemsScrollsOfCustomer = scrollItemsBy('customer_id', 'customer_id');

// עמודת המק"ט הידני — אותה הגדרה בכל טבלה שמציגה ספרים
const skuCol = { label: 'מק"ט', render: r => r.sku ? `<b>${esc(r.sku)}</b>` : '<span class="muted">—</span>' };

const optScrolls = (sel) => C.scrolls.map(s =>
  `<option value="${s.id}" ${+sel === s.id ? 'selected' : ''}>${esc(scrollLabel(s))}</option>`).join('');
const purchaseLabel = (p) => `${p.product_name || 'מוצר'} · ${p.scribe_name || 'סופר'} (נשאר ${N(p.remaining_qty)})`;
const optPurchases = (sel) => C.purchases
  .filter(p => N(p.remaining_qty) > 0 || +sel === p.id)
  .map(p => `<option value="${p.id}" ${+sel === p.id ? 'selected' : ''}>${esc(purchaseLabel(p))}</option>`).join('');

// ===== שדה השלמה אוטומטית =====
// מחליף רשימה נפתחת ארוכה: מקלידים חלק מהשם והרשימה מצטמצמת.
// הערך הנבחר נשמר בשדה מוסתר בשם f_<key>, כך ש-readFields עובד כרגיל.
// כל רשימות הבחירה ממוינות א-ב לפי סדר האלפבית העברי
const byHe = (a, b) => String(a.t).localeCompare(String(b.t), 'he', { numeric: true });
const sortHe = (arr) => arr.sort(byHe);

const itemsContacts  = () => sortHe(C.contacts.map(c => ({ v: c.id, t: contactName(c) })));
const itemsProducts  = () => sortHe(C.products.map(p => ({ v: p.id, t: p.name })));
const itemsSizes     = () => sortHe(C.sizes.map(s => ({ v: s.id, t: `${s.name} (${money(s.cost_per_unit)}/יח')` })));
const itemsScrolls   = () => sortHe(C.scrolls.map(s => ({ v: s.id, t: scrollLabel(s) })));
const itemsPurchases = (sel) => sortHe(C.purchases.filter(p => N(p.remaining_qty) > 0 || +sel === p.id)
  .map(p => ({ v: p.id, t: `#${p.id} · ${purchaseLabel(p)}` })));
// למעקב צריך גם חבילות שכבר נמכרו — היחידות עדיין יכולות להיות בדרך
const itemsPurchasesAll = () => sortHe(C.purchases.map(p => ({ v: p.id,
  t: `#${p.id} · ${p.product_name || 'מוצר'} · ${p.scribe_name || 'סופר'} (${N(p.quantity)} יח')` })));
const itemsList = (arr) => sortHe(arr.map(x => ({ v: x.value, t: x.value + (x.is_correction ? '  ⟵ תיקונים' : '') })));

function comboHTML(f, val) {
  const items = f.items(val) || [];
  const cur = items.find(x => String(x.v) === String(val));
  return `<div class="field"><label>${esc(f.label)}</label>
    <div class="combo" data-combo="${f.k}">
      <input type="hidden" id="f_${f.k}" value="${esc(val == null ? '' : val)}">
      <input class="combo-inp${cur ? ' picked' : ''}" id="t_${f.k}" autocomplete="off"
        placeholder="${esc(f.placeholder || 'הקלד לחיפוש…')}" value="${esc(cur ? cur.t : '')}">
      <div class="combo-menu" style="display:none"></div>
    </div>
    ${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
}

function wireCombos(root, fields) {
  for (const f of fields.filter(x => x.type === 'combo')) {
    const box = root.querySelector(`[data-combo="${CSS.escape(f.k)}"]`);
    if (!box) continue;
    const hid = box.querySelector('input[type=hidden]');
    const inp = box.querySelector('.combo-inp');
    const menu = box.querySelector('.combo-menu');
    let items = f.items(hid.value) || [];
    let act = -1;

    const draw = (q) => {
      const s = String(q || '').trim().toLowerCase();
      // כל מילת חיפוש חייבת להופיע — כך "כהן אבר" מוצא "אברהם כהן"
      const words = s ? s.split(/\s+/) : [];
      const hit = items.filter(x => {
        const t = String(x.t).toLowerCase();
        return words.every(w => t.includes(w));
      }).slice(0, 60);
      menu.innerHTML = hit.length
        ? hit.map((x, i) => `<div data-v="${esc(x.v)}" class="${i === act ? 'act' : ''}">${esc(x.t)}</div>`).join('')
        : `<div class="none">אין תוצאות</div>`;
      menu.style.display = 'block';
      menu.querySelectorAll('[data-v]').forEach(d => {
        d.onmousedown = (e) => { e.preventDefault(); pick(d.dataset.v, d.textContent); };
      });
    };
    const pick = (v, t) => {
      hid.value = v; inp.value = t; inp.classList.add('picked');
      menu.style.display = 'none'; act = -1;
      hid.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const close = () => { menu.style.display = 'none'; act = -1; };

    inp.onfocus = () => { items = f.items(hid.value) || []; act = -1; draw(inp.value === (items.find(x => String(x.v) === String(hid.value)) || {}).t ? '' : inp.value); };
    inp.oninput = () => {
      // ריענון הרשימה לפני הניקוי — שדה תלוי (למשל ספרים לפי הסופר שנבחר)
      // עשוי להשתנות בין פתיחה לפתיחה, ואסור להסתמך רק על אירוע ה-focus.
      items = f.items(hid.value) || [];
      hid.value = ''; inp.classList.remove('picked');   // הקלדה מבטלת בחירה קודמת
      act = -1; draw(inp.value);
    };
    inp.onblur = () => {
      setTimeout(() => {
        close();
        // טקסט שלא נבחר מהרשימה — אם הוא תואם בדיוק פריט, נבחר אותו; אחרת מנוקה
        if (!hid.value) {
          const exact = items.find(x => String(x.t).toLowerCase() === inp.value.trim().toLowerCase());
          if (exact) pick(exact.v, exact.t);
          else if (inp.value.trim() !== '') { inp.value = ''; hid.dispatchEvent(new Event('change', { bubbles: true })); }
        }
      }, 150);
    };
    inp.onkeydown = (e) => {
      const opts = [...menu.querySelectorAll('[data-v]')];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (menu.style.display === 'none') return draw(inp.value);
        act = e.key === 'ArrowDown' ? Math.min(act + 1, opts.length - 1) : Math.max(act - 1, 0);
        opts.forEach((o, i) => o.classList.toggle('act', i === act));
        if (opts[act]) opts[act].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        if (menu.style.display !== 'none' && opts.length) {
          e.preventDefault();
          const o = opts[act >= 0 ? act : 0];
          pick(o.dataset.v, o.textContent);
        }
      } else if (e.key === 'Escape') { close(); }
    };
  }
}


// ---- בורר עצמאי עם חיפוש ----
// אותו רכיב השלמה של הטפסים, לשימוש מחוץ לטופס (מסננים, בוררי דוחות).
// pickerHTML מרנדר, wirePicker מחבר ומחזיר את הערך הנבחר ב-onChange.
function pickerHTML(key, label, items, value, placeholder) {
  const f = { k: key, label: label || '', items: () => items, placeholder: placeholder || 'הקלד לחיפוש…' };
  return comboHTML(f, value == null ? '' : value);
}
function wirePicker(key, items, onChange) {
  wireCombos(document, [{ k: key, type: 'combo', items: () => items }]);
  const hid = $('f_' + key);
  if (hid) hid.addEventListener('change', () => onChange(hid.value));
}

// ---- בונה שדות טופס ----
function fieldHTML(f, val) {
  if (f.type === 'combo') return comboHTML(f, val);
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
function openForm(cfg, row, prefill) {
  const isEdit = !!row;
  // שדה עם newOnly הוא עזר טופס שרלוונטי רק בהוספה (למשל הכנסה למעקב)
  const fields = cfg.fields.filter(f => !(f.newOnly && isEdit));
  const base = Object.assign({}, cfg.defaults ? cfg.defaults() : {}, prefill || {});
  const body = `<div class="row">${fields.map(f =>
    fieldHTML(f, row ? row[f.k] : base[f.k])).join('')}</div>`;
  const m = modal({
    title: (isEdit ? 'עריכה — ' : 'הוספה — ') + cfg.title,
    body, wide: cfg.wide,
    footer: `<button class="btn" data-save>שמירה</button><button class="btn ghost" data-cancel>ביטול</button>`,
  });
  m.el.querySelector('[data-cancel]').onclick = m.close;
  wireCombos(m.el, fields);
  const btn = m.el.querySelector('[data-save]');
  btn.onclick = async () => {
    const data = readFields(fields);
    if (cfg.validate) { const err = cfg.validate(data); if (err) return toast(err, 'err'); }
    btn.disabled = true;
    try {
      // מפתח שמתחיל בקו תחתון הוא עזר טופס בלבד ואינו נשלח לשרת
      const payload = {};
      for (const k of Object.keys(data)) if (k[0] !== '_') payload[k] = data[k];
      const saved = isEdit ? await cfg.store.update(row.id, payload) : await cfg.store.create(payload);
      m.close();
      // פעולת המשך (למשל יצירת מעקב) — כישלון שלה אינו מבטל את השמירה,
      // ולכן ההודעה חייבת להבחין בין השתיים.
      if (cfg.afterSave) {
        try { toast((await cfg.afterSave(saved, data, isEdit)) || 'נשמר בהצלחה', 'ok'); }
        catch (e) { toast('נשמר, אבל הפעולה הנלווית נכשלה: ' + e.message, 'err'); }
      } else toast('נשמר בהצלחה', 'ok');
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
// עמודה עם pin:true נדבקת לימין בגלילה לרוחב. ההצמדה עובדת רק על רצף
// העמודות הראשונות — עמודה מוצמדת באמצע הייתה קופצת מעל שכנותיה.
const colCls = (c) => `${c.cls || ''}${c.pin ? ' pin' : ''}`.trim();

function tableHTML(cols, rows, opts) {
  opts = opts || {};
  if (!rows.length) return `<div class="empty"><div class="big">📭</div>אין נתונים להצגה</div>`;
  // כותרת עם מסנן: כל עמודה בעלת תווית מקבלת כפתור סינון משלה,
  // והתפריט נבנה מהערכים המוצגים בפועל באותה עמודה.
  const fk = opts.fkey;
  const head = cols.map(c => {
    if (c.labelHtml) return `<th class="${colCls(c)}">${c.labelHtml}</th>`;
    if (!fk || !c.label || !c.render) return `<th class="${colCls(c)}">${esc(c.label || '')}</th>`;
    const picked = (filterState(fk).cols[c.label] || []);
    const uid = `${fk}|${c.label}`;
    return `<th class="${colCls(c)}"><span class="th-in">${esc(c.label)}
      <button class="th-filt${picked.length ? ' on' : ''}" data-filtbtn="${esc(uid)}"
        title="סינון">${picked.length ? `▼${picked.length}` : '▽'}</button></span></th>`;
  }).join('');
  const body = rows.map((r, i) => `<tr ${opts.rowAttr ? opts.rowAttr(r) : ''}>${
    cols.map(c => `<td class="${colCls(c)}">${c.render(r, i)}</td>`).join('')}</tr>`).join('');
  let foot = '';
  if (opts.totals) {
    foot = `<tfoot><tr>${cols.map(c =>
      `<td class="${colCls(c)}">${c.total ? c.total(rows) : (c.totalLabel || '')}</td>`).join('')}</tr></tfoot>`;
  }
  // כל טבלה מקבלת כפתור ייצוא. החיווט הוא בהאזנה גלובלית (wireExport),
  // כדי שגם טבלאות שנוצרות בתוך חלונות יעבדו בלי חיווט נוסף.
  const tools = opts.noExport ? '' :
    `<div class="tbl-tools"><button class="btn ghost xs" data-xls title="הורדה לאקסל">⤓ אקסל</button></div>`;
  return `<div class="tbl-box">${tools}<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table></div></div>`;
}

// ===== פריסת טבלאות =====
// שני דברים שאי אפשר לעשות ב-CSS בלבד:
//  1. גובה התיבה — כדי שהכותרת הדביקה תעבוד, התיבה עצמה חייבת להיות
//     אזור גלילה בגובה מוגבל. הגובה נקבע לפי המקום שנשאר עד תחתית המסך.
//  2. מרחק ההצמדה של העמודות מימין — תלוי ברוחב האמיתי של העמודות,
//     והוא ידוע רק אחרי שהדפדפן פרס את הטבלה.
const PIN_MIN_W = 820;          // מתחת לזה המסך צר מדי, ההצמדה מבוטלת ב-CSS
const _laidOut = new WeakSet();

function layoutTable(wrap) {
  const inModal = !!wrap.closest('#modalRoot');
  const top = wrap.getBoundingClientRect().top + (inModal ? 0 : window.scrollY);
  // רצפה של 360 פיקסלים: טבלה שמתחילה נמוך בדף עדיין מקבלת גובה שימושי,
  // בלי שהתיבה תגלוש הרבה מתחת לקצה המסך.
  wrap.style.maxHeight = Math.max(360, Math.round(window.innerHeight - top - 26)) + 'px';

  const table = wrap.querySelector('table');
  const head = table && table.tHead && table.tHead.rows[0];
  if (!table) return;
  table.querySelectorAll('.pin-edge').forEach(c => c.classList.remove('pin-edge'));
  const pinned = table.querySelectorAll('.pin');
  if (!head || !pinned.length) return;
  if (window.innerWidth < PIN_MIN_W) { pinned.forEach(c => { c.style.right = ''; }); return; }

  let n = 0;
  while (n < head.cells.length && head.cells[n].classList.contains('pin')) n++;
  if (!n) { pinned.forEach(c => { c.style.right = ''; }); return; }

  const offs = []; let acc = 0;
  for (let i = 0; i < n; i++) { offs.push(acc); acc += head.cells[i].getBoundingClientRect().width; }
  for (const row of table.rows) {
    if (row.cells.length !== head.cells.length) continue;   // שורה חריגה — לא נוגעים
    for (let i = 0; i < n; i++) {
      const c = row.cells[i];
      if (!c.classList.contains('pin')) continue;
      c.style.right = Math.round(offs[i]) + 'px';
      if (i === n - 1) c.classList.add('pin-edge');
    }
  }
}

function layoutTables(force) {
  document.querySelectorAll('.table-wrap').forEach(w => {
    if (!force && _laidOut.has(w)) return;
    _laidOut.add(w);
    layoutTable(w);
  });
}

let _layoutT = 0;
function scheduleLayout(force) {
  clearTimeout(_layoutT);
  _layoutT = setTimeout(() => layoutTables(force), 40);
}
// כל טבלה חדשה בדף או בחלון מקבלת פריסה, בלי לחווט כל מקום בנפרד.
// המשקיף עוקב אחרי הוספת אלמנטים בלבד; העדכונים שלנו הם מאפיינים, ולכן אין לולאה.
new MutationObserver(() => scheduleLayout(false)).observe(document.body, { childList: true, subtree: true });
window.addEventListener('resize', () => scheduleLayout(true));
// גופן שנטען מאוחר משנה את רוחב העמודות — מודדים שוב אחריו
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => scheduleLayout(true));

// ===== ייצוא טבלה לאקסל =====
// קורא את הטבלה כפי שהיא מוצגת, כך שהקובץ תואם בדיוק למה שרואים על המסך
// (כולל שורת סיכום). מספרים מומרים חזרה למספרים אמיתיים כדי שיהיה אפשר
// לסכם אותם באקסל — ₪, פסיקים ומינוס טיפוגרפי מנוקים.
function cellToValue(td) {
  let t = (td.innerText || td.textContent || '').replace(/\s+/g, ' ').trim();
  if (t === '') return '';
  const n = t.replace(/[₪$,\s]/g, '').replace(/[−–—]/g, '-');
  if (/^-?\d+(\.\d+)?$/.test(n)) return parseFloat(n);
  return t;
}

function tableToRows(table) {
  const out = [];
  for (const tr of table.querySelectorAll('thead tr, tbody tr, tfoot tr')) {
    const cells = [...tr.children];
    // מדלגים על עמודות תפעוליות (סימון / כפתורי פעולה) — אין להן ערך בקובץ
    const row = cells.filter(td => !td.querySelector('input[type="checkbox"], button'))
      .map(td => cellToValue(td));
    if (row.some(v => v !== '')) out.push(row);
  }
  return out;
}

async function exportTable(table, name) {
  try {
    await loadXLSX();
    const rows = tableToRows(table);
    if (!rows.length) return toast('אין נתונים לייצוא', 'err');
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!views'] = [{ RTL: true }];
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    // שם לשונית: אקסל אוסר : \ / ? * [ ] ומגביל ל-31 תווים
    const sheetName = String(name || 'נתונים').replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || 'נתונים';
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const d = new Date();
    const stamp = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
    XLSX.writeFile(wb, `${sheetName} ${stamp}.xlsx`);
    toast('הקובץ הורד', 'ok');
  } catch (e) { toast('ייצוא נכשל: ' + e.message, 'err'); }
}

// שם לקובץ: הכותרת הקרובה ביותר מעל הטבלה
function tableTitle(box) {
  const card = box.closest('.card') || box.parentElement;
  const h = card && card.querySelector('h2, h3');
  if (h) return h.textContent.trim();
  const modal = box.closest('.modal');
  if (modal) { const mh = modal.querySelector('.m-head h3'); if (mh) return mh.textContent.trim(); }
  const pageH = document.querySelector('#view h2');
  return pageH ? pageH.textContent.trim() : 'נתונים';
}

function wireExport() {
  if (wireExport._done) return;
  wireExport._done = true;
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('[data-xls]');
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    const box = btn.closest('.tbl-box');
    const table = box && box.querySelector('table');
    if (table) exportTable(table, tableTitle(box));
  });
}

const sumBy = (rows, k) => rows.reduce((a, r) => a + N(r[k]), 0);
// ===== סינון טבלאות =====
// לכל עמודה מסנן משלה בכותרת, ובנוסף חיפוש חופשי בכל הטבלה.
// הסינון עובד על הטקסט המוצג בפועל, ולכן הוא זהה למה שהמשתמש רואה
// ואינו תלוי בשמות השדות במסד. הסכומים בתחתית מחושבים על המסונן בלבד.
const FILTERS = {};
const stripHtml = (s) => String(s == null ? '' : s)
  .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/gi, ' ')
  .replace(/\s+/g, ' ').trim();

function filterState(key) {
  if (!FILTERS[key]) FILTERS[key] = { q: '', cols: {} };
  return FILTERS[key];
}

// עמודה ניתנת לסינון: יש לה תווית ותוכן (לא עמודת סימון/פעולות)
const filterableCols = (cols) => cols.filter(c => c.label && c.render && !c.labelHtml);

function colText(cols, label, r, i) {
  const c = cols.find(x => x.label === label);
  return c ? stripHtml(c.render(r, i)) : '';
}
function rowText(cols, r, i) {
  return filterableCols(cols).map(c => stripHtml(c.render(r, i))).join(' ');
}

function applyFilters(key, cols, rows) {
  const st = filterState(key);
  let out = rows;
  const q = st.q.trim().toLowerCase();
  if (q) {
    const words = q.split(/\s+/);
    out = out.filter((r, i) => {
      const t = rowText(cols, r, i).toLowerCase();
      return words.every(w => t.includes(w));
    });
  }
  for (const label of Object.keys(st.cols)) {
    const picked = st.cols[label];
    if (picked && picked.length) {
      out = out.filter((r, i) => picked.includes(colText(cols, label, r, i) || '—'));
    }
  }
  return out;
}

// סרגל עליון: חיפוש חופשי + מונה + ניקוי
function filterBarHTML(key, shownCount, totalCount) {
  const st = filterState(key);
  const active = st.q || Object.values(st.cols).some(v => v && v.length);
  return `<div class="toolbar filt-bar">
    <input id="fq_${key}" class="filt-q" placeholder="🔍 חיפוש בכל הטבלה…" value="${esc(st.q)}">
    ${active ? `<button class="btn ghost sm" id="fclear_${key}">✕ נקה סינון</button>
      <span class="mini">מוצגות <b>${shownCount}</b> מתוך ${totalCount}</span>` : ''}
  </div>`;
}

// תפריט הסינון של עמודה — נבנה בלחיצה, מהערכים שבטבלה המלאה
function openColFilter(btn, key, cols, allRows) {
  document.querySelectorAll('.filt-menu').forEach(m => m.remove());
  const label = btn.dataset.filtbtn.slice(key.length + 1);
  const st = filterState(key);
  const picked = st.cols[label] || [];
  const vals = [...new Set(allRows.map((r, i) => colText(cols, label, r, i) || '—'))]
    .sort((a, b) => a.localeCompare(b, 'he', { numeric: true }));

  const m = document.createElement('div');
  m.className = 'filt-menu';
  m.innerHTML = `
    <input class="filt-search" placeholder="חיפוש בערכים…">
    <div class="filt-actions"><span class="link" data-all>בחר הכל</span> ·
      <span class="link" data-none>נקה</span></div>
    <div class="filt-list">${vals.map((v, i) =>
      `<label><input type="checkbox" value="${esc(v)}" ${picked.includes(v) ? 'checked' : ''}> ${esc(v)}</label>`).join('')}</div>
    <div class="filt-foot"><button class="btn xs" data-ok>החל</button>
      <button class="btn ghost xs" data-clear>בטל סינון</button></div>`;
  document.body.appendChild(m);

  // מיקום מתחת לכפתור, בתוך גבולות המסך
  const b = btn.getBoundingClientRect();
  m.style.top = (b.bottom + window.scrollY + 4) + 'px';
  const left = Math.max(8, Math.min(b.left + window.scrollX, window.innerWidth - m.offsetWidth - 8));
  m.style.left = left + 'px';

  m.onclick = (e) => e.stopPropagation();
  const search = m.querySelector('.filt-search');
  search.oninput = () => {
    const v = search.value.toLowerCase();
    m.querySelectorAll('.filt-list label').forEach(l => {
      l.style.display = l.textContent.toLowerCase().includes(v) ? '' : 'none';
    });
  };
  const visibleBoxes = () => [...m.querySelectorAll('.filt-list label')]
    .filter(l => l.style.display !== 'none').map(l => l.querySelector('input'));
  m.querySelector('[data-all]').onclick = () => visibleBoxes().forEach(c => { c.checked = true; });
  m.querySelector('[data-none]').onclick = () => visibleBoxes().forEach(c => { c.checked = false; });
  m.querySelector('[data-ok]').onclick = () => {
    const sel = [...m.querySelectorAll('.filt-list input:checked')].map(c => c.value);
    // בחירת הכל שקולה לאין סינון
    if (!sel.length || sel.length === vals.length) delete st.cols[label];
    else st.cols[label] = sel;
    m.remove(); render();
  };
  m.querySelector('[data-clear]').onclick = () => { delete st.cols[label]; m.remove(); render(); };
  setTimeout(() => search.focus(), 30);
}

// חיווט הסינון לטבלה. allRows = לפני סינון, לבניית רשימות הערכים.
function wireFilters(key, cols, allRows) {
  const q = $('fq_' + key);
  if (q) {
    q.oninput = (e) => {
      filterState(key).q = e.target.value;
      const pos = e.target.selectionStart;
      clearTimeout(wireFilters['_t' + key]);
      wireFilters['_t' + key] = setTimeout(() => {
        render().then(() => {
          const el = $('fq_' + key);
          if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (err) {} }
        });
      }, 200);
    };
  }
  const clr = $('fclear_' + key);
  if (clr) clr.onclick = () => { FILTERS[key] = { q: '', cols: {} }; render(); };

  document.querySelectorAll(`[data-filtbtn^="${key}|"]`).forEach(b => {
    b.onclick = (e) => { e.stopPropagation(); openColFilter(b, key, cols, allRows); };
  });

  if (!wireFilters._doc) {
    wireFilters._doc = true;
    document.addEventListener('click', () => document.querySelectorAll('.filt-menu').forEach(m => m.remove()));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') document.querySelectorAll('.filt-menu').forEach(m => m.remove());
    });
  }
}

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
  // ביריעות מציעים קודם כל העברה — זו הפעולה השכיחה, לא מחיקה
  const isTrack = table === 'track_items';
  bar.innerHTML = `<span>נבחרו <b>${ids.length}</b></span>
    ${isTrack && ME.caps.edit ? `<button class="btn sm" id="moveSelBtn">➜ העבר לתחנה</button>` : ''}
    ${ME.caps.del ? `<button class="btn red sm" id="delSelBtn">🗑 מחק נבחרים</button>` : ''}
    <button class="btn ghost sm" id="clearSelBtn">ביטול</button>`;
  if ($('moveSelBtn')) $('moveSelBtn').onclick = () => openMove(ids);
  if ($('delSelBtn')) $('delSelBtn').onclick = async () => {
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
  // קפיצה משורת רכישה אל מסך המעקב של אותה חבילה
  document.querySelectorAll('[data-trk]').forEach(b => {
    b.onclick = (e) => {
      e.stopPropagation();
      PRODTRACK.purchaseId = +b.dataset.trk;
      TAB = 'track'; SUB.track = 'products'; render();
    };
  });
}

// ---- דף ישות גנרי ----
// מטמון שורות לדף — כדי שרינדור מחדש בעקבות סינון לא ייגש לשרת בכל הקלדה.
// מתאפס בכל שינוי נתונים (reloadCaches).
const ROWCACHE = {};
function invalidateRows() { for (const k in ROWCACHE) delete ROWCACHE[k]; }

async function entityPage(cfg) {
  const fkey = cfg.bulk || cfg.title.replace(/\W/g, '');
  const allRows = ROWCACHE[fkey] || (ROWCACHE[fkey] = await cfg.load());
  const cols = cfg.cols.concat([actionsCol(cfg)]);
  if ((ME.caps.del || ME.caps.edit) && cfg.bulk) cols.unshift(selCol(cfg.bulk));
  const rows = applyFilters(fkey, cols, allRows);
  $('view').innerHTML += `
    <div class="page-head">
      <h2>${esc(cfg.title)}</h2>
      ${cfg.subtitle ? `<span class="mini">${esc(cfg.subtitle)}</span>` : ''}
      <div class="spacer"></div>
      ${bulkBtn(cfg.bulk, cfg.title, cfg.bulkPreset)}
      ${ME.caps.edit ? `<button class="btn" id="addBtn">+ הוספה</button>` : ''}
    </div>
    ${cfg.note ? `<div class="card mini">${cfg.note}</div>` : ''}
    <div class="card">
      ${filterBarHTML(fkey, rows.length, allRows.length)}
      ${tableHTML(cols, rows, { totals: cfg.totals, fkey })}</div>`;
  if ($('addBtn')) $('addBtn').onclick = () => openForm(cfg, null);
  wireRowActions(cfg, rows);
  wireBulkBtns();
  wireSelection();
  wireFilters(fkey, cols, allRows);
}

// ============ טעינת מטמון ============
async function reloadCaches() {
  invalidateRows();
  const [contacts, products, sizes, lists, scrolls, purchases, stations] = await Promise.all([
    Store.contacts.list(), Store.products.list(), Store.sizes.list(),
    Store.lists.all(), Store.scrolls.list(), Store.prodPurchases.list(), Store.stations.list(),
  ]);
  C.contacts = contacts; C.products = products; C.sizes = sizes;
  C.expBook = lists.expense_book || []; C.expBiz = lists.expense_business || [];
  C.scrolls = scrolls; C.purchases = purchases; C.stations = stations;
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
      ${st('מלאי מוצרים', N(d.stock_units).toLocaleString('he-IL') + " יח'", '')}
      ${st('עלות פריטה', money(d.peritah_total), 'r', 'שתי המערכות')}
    </div>`;
}

// ============ ס"ת ============
async function pageScrolls() {
  const allRows = C.scrolls;
  const cfg = scrollCfg();
  // ארבע עמודות הזיהוי מוצמדות לימין (pin) ונשארות גלויות בגלילה לרוחב.
  // 'סופר' הועלה לכאן דווקא כדי שיוכל להיות חלק מהרצף המוצמד.
  const cols = [
    ...(ME.caps.del ? [{ ...selCol('scrolls'), pin: true }] : []),
    { label: '#', pin: true, render: r => r.id },
    { ...skuCol, pin: true },
    { label: 'סופר', pin: true, render: r => esc(r.scribe_name || '—') },
    { label: 'מוצר', render: r => esc(r.product_name || '—') },
    { label: 'רוכש', render: r => esc(r.customer_name || '—') },
    { label: 'תאריך', render: r => dt(r.sale_date) },
    { label: 'התקדמות', render: r => `<div class="bar ${r.progress_pct < 100 ? 'warn' : ''}"><span style="width:${Math.min(100, r.progress_pct)}%"></span></div>
        <span class="mini">${r.pages_written}/${r.product_pages}</span>` },
    { label: 'מחיר לרוכש', cls: 'num', render: r => mCell(r.buyer_total, r.buyer_currency),
      total: rows => mCell(sumBy(rows, 'buyer_total')) },
    // מחיר הספר לסופר = מחיר לעמוד × עמודי המוצר (מה שמגיע לו על ספר שלם)
    { label: 'מחיר לסופר', cls: 'num', render: r => mCell(r.scribe_book_price),
      total: rows => mCell(sumBy(rows, 'scribe_book_price')) },
    { label: 'הוצאה קבועה', cls: 'num',
      render: r => mCell(r.fixed_expense) + (r.fixed_expense_overridden
        ? ' <span class="pill a" title="נקבע ידנית לספר זה">ידני</span>' : ''),
      total: rows => mCell(sumBy(rows, 'fixed_expense')) },
    { label: 'יתרת רוכש', cls: 'num', render: r => mCell(r.buyer_balance_now),
      total: rows => mCell(sumBy(rows, 'buyer_balance_now')) },
    { label: 'יתרת סופר', cls: 'num', render: r => mCell(r.scribe_balance),
      total: rows => mCell(sumBy(rows, 'scribe_balance')) },
    { label: 'רווח צפוי', cls: 'num', render: r => mCell(r.expected_profit),
      total: rows => mCell(sumBy(rows, 'expected_profit')) },
    { label: 'סטטוס', render: r => `<span class="pill ${r.status === 'done' ? 'done' : 'active'}">${r.status === 'done' ? 'הושלם' : 'פעיל'}</span>` },
    { label: '', cls: 'center', render: r => `<button class="btn ghost xs" data-card="${r.id}">כרטיס</button>` },
    actionsCol(cfg),
  ];
  const rows = applyFilters('scrolls', cols, allRows);
  $('view').innerHTML += `
    <div class="page-head"><h2>ס"ת</h2><div class="spacer"></div>
      ${bulkBtn('scrolls', 'ס"ת')}
      ${ME.caps.edit ? `<button class="btn" id="addBtn">+ ספר חדש</button>` : ''}</div>
    <div class="card">
      ${filterBarHTML('scrolls', rows.length, allRows.length)}
      ${tableHTML(cols, rows, { totals: true, fkey: 'scrolls' })}</div>`;
  if ($('addBtn')) $('addBtn').onclick = () => openForm(cfg, null);
  wireRowActions(cfg, rows);
  wireBulkBtns();
  wireSelection();
  wireFilters('scrolls', cols, allRows);
  document.querySelectorAll('[data-card]').forEach(b => b.onclick = () => showScrollCard(+b.dataset.card));
}

function scrollCfg() {
  return {
    title: 'ספר', store: Store.scrolls, wide: true,
    labelOf: (r) => scrollLabel(r),
    defaults: () => ({ sale_date: today(), buyer_currency: 'ILS', status: 'active' }),
    fields: [
      { k: 'sku', label: 'מק"ט (המזהה שלך)', type: 'text',
        hint: 'יופיע לצד הספר בכל המסכים. אסור שיחזור עם אותו סופר ואותו מוצר' },
      { k: 'scribe_id', label: 'שם סופר', type: 'combo', items: itemsContacts },
      { k: 'product_id', label: 'מוצר', type: 'combo', items: itemsProducts },
      { k: 'parchment_size_id', label: 'גודל קלף', type: 'combo', items: itemsSizes },
      { k: 'page_rate', label: 'מחיר לעמוד (לסופר)', type: 'number' },
      { k: 'sale_date', label: 'תאריך מכירה', type: 'date' },
      { k: 'customer_id', label: 'שם רוכש', type: 'combo', items: itemsContacts },
      { k: 'buyer_total', label: 'מחיר לרוכש (סכום כולל)', type: 'number', hint: 'המחיר של הספר כולו, לא לעמוד' },
      { k: 'buyer_currency', label: 'מטבע רוכש', type: 'select', blank: false, options: (v) =>
          `<option value="ILS" ${v === 'ILS' ? 'selected' : ''}>₪ שקל</option><option value="USD" ${v === 'USD' ? 'selected' : ''}>$ דולר</option>` },
      { k: 'status', label: 'סטטוס', type: 'select', blank: false, options: (v) =>
          `<option value="active" ${v === 'active' ? 'selected' : ''}>פעיל</option><option value="done" ${v === 'done' ? 'selected' : ''}>הושלם</option>` },
      { k: 'sheets_count', label: 'מספר יריעות', type: 'number',
        hint: 'למעקב יריעות. ריק = לפי יחידות הקלף של המוצר' },
      { k: 'fixed_expense_override', label: 'הוצאה קבועה — עקיפה', type: 'number',
        hint: 'ריק = לפי המוצר · 0 = ללא הוצאה קבועה לספר זה' },
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
      ${s.sku ? kv('מק"ט', `<b>${esc(s.sku)}</b>`) : ''}
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
      ${kv('הוצאה קבועה לספר', money(s.fixed_expense) + (s.fixed_expense_overridden ? ' <span class="pill a">ידני</span>' : ''))}
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
            { label: "עלות ליח'", cls: 'num', render: r => mCell(r.cost_per_unit) },
            { label: 'סך עלות', cls: 'num', render: r => mCell(r.total_cost) }], d.parchment_expenses)}
  `;
  modal({ title: 'כרטיס ספר ' + scrollLabel(s), body, wide: true });
}

// ============ תשלום לסופר (שני חלקים) ============
// שתי ההגדרות של מסך תשלום לסופר — עצמאיות, כדי שגם ההוספה
// המהירה תשתמש בהן ולא ייווצרו שתי גרסאות של אותו טופס.
function scribePayCfg() {
  return {
    title: 'תשלום לסופר', store: Store.scribePayments,
    labelOf: (r) => `תשלום ${money(r.amount)}`,
    defaults: () => ({ date: today() }),
    fields: [
      { k: '_scribe', label: 'סופר (לצמצום הרשימה)', type: 'combo', items: itemsContacts,
        placeholder: 'כל הסופרים…' },
      { k: 'scroll_id', label: 'עבור איזה ספר', type: 'combo', items: scrollItemsBy('_scribe', 'scribe_id'), required: true,
        placeholder: 'הספרים של הסופר שנבחר…' },
      { k: 'date', label: 'תאריך', type: 'date' },
      { k: 'amount', label: 'סכום ששולם', type: 'number' },
      { k: 'note', label: 'הערה', type: 'textarea' },
    ],
  };
}

function pagesLogCfg() {
  return {
    title: 'עמודים שנכתבו', store: Store.pagesLog,
    labelOf: (r) => `${r.pages} עמודים`,
    defaults: () => ({ date: today() }),
    fields: [
      { k: '_scribe', label: 'סופר (לצמצום הרשימה)', type: 'combo', items: itemsContacts,
        placeholder: 'כל הסופרים…' },
      { k: 'scroll_id', label: 'עבור איזה ספר', type: 'combo', items: scrollItemsBy('_scribe', 'scribe_id'), required: true,
        placeholder: 'הספרים של הסופר שנבחר…' },
      { k: 'date', label: 'תאריך', type: 'date' },
      { k: 'pages', label: 'כמות עמודים שנכתבה', type: 'number' },
      { k: 'note', label: 'הערה', type: 'textarea' },
    ],
  };
}

async function pageScribePay(cfgOnly) {
  // cfgOnly מחזיר את שתי ההגדרות בלי לרנדר — לשימוש ההוספה המהירה
  if (cfgOnly) return { pay: scribePayCfg(), page: pagesLogCfg() };
  const [allPays, allPages] = await Promise.all([Store.scribePayments.list(), Store.pagesLog.list()]);
  const scrollById = (id) => C.scrolls.find(s => s.id === id);

  const payCfg = scribePayCfg();
  const pageCfg = pagesLogCfg();

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

  const pays  = applyFilters('scribe_payments', payCols, allPays);
  const pages = applyFilters('pages_log', pageCols, allPages);
  $('view').innerHTML += `
    <div class="page-head"><h2>תשלום לסופר</h2></div>
    <div class="card">
      <div class="page-head"><h3>תשלומים לסופר</h3><div class="spacer"></div>
        ${bulkBtn('scribe_payments', 'תשלומים לסופר')}
        ${ME.caps.edit ? `<button class="btn sm" id="addPay">+ תשלום</button>` : ''}</div>
      ${filterBarHTML('scribe_payments', pays.length, allPays.length)}
      ${tableHTML(payCols, pays, { totals: true, fkey: 'scribe_payments' })}
    </div>
    <div class="card">
      <div class="page-head"><h3>עמודים שנכתבו</h3><div class="spacer"></div>
        ${bulkBtn('pages_log', 'עמודים שנכתבו')}
        ${ME.caps.edit ? `<button class="btn sm gold" id="addPage">+ רישום עמודים</button>` : ''}</div>
      ${filterBarHTML('pages_log', pages.length, allPages.length)}
      ${tableHTML(pageCols, pages, { totals: true, fkey: 'pages_log' })}
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
  wireFilters('scribe_payments', payCols, allPays);
  wireFilters('pages_log', pageCols, allPages);
}

// ============ תשלומי לקוחות (ס"ת) ============
function pageCustPay(cfgOnly) {
  const scrollById = (id) => C.scrolls.find(s => s.id === id);
  const cfg = {
    title: 'תשלומי לקוחות', bulk: 'customer_payments', store: Store.customerPayments,
    load: () => Store.customerPayments.list(),
    labelOf: (r) => `תשלום ${money(r.paid_actual)}`,
    defaults: () => ({ date: today() }),
    totals: true,
    note: 'עלות פריטה = (סכום בדולר × שער יציג) − מזומן שהתקבל ביד. הרוכש מזוכה על הסכום המלא.',
    fields: [
      { k: 'customer_id', label: 'רוכש', type: 'combo', items: itemsContacts },
      { k: 'scroll_id', label: 'ספר שרכש', type: 'combo', items: itemsScrollsOfCustomer,
        placeholder: 'הספרים של הרוכש שנבחר…' },
      { k: 'date', label: 'תאריך', type: 'date' },
      { k: 'amount_ils', label: 'סכום ששילם בש"ח', type: 'number' },
      { k: 'amount_usd', label: 'סכום ששילם בדולר', type: 'number' },
      { k: 'rate', label: 'שער יציג של הדולר', type: 'number' },
      { k: 'cash_in_hand', label: 'מזומן בש"ח שהתקבל ביד', type: 'number', hint: 'רלוונטי למי ששילם בדולר' },
      { k: 'note', label: 'הערה', type: 'textarea' },
    ],
    cols: [
      { label: 'רוכש', render: r => esc(r.customer_name || '—') },
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
  };
  return cfgOnly ? cfg : entityPage(cfg);
}

// ============ הוצאות לספר ============
function pageBookExp(cfgOnly) {
  const scrollById = (id) => C.scrolls.find(s => s.id === id);
  const cfg = {
    title: 'הוצאות לספר', bulk: 'book_expenses', store: Store.bookExpenses,
    load: () => Store.bookExpenses.list(),
    labelOf: (r) => `${r.type || 'הוצאה'} ${money(r.amount)}`,
    defaults: () => ({ date: today() }),
    totals: true,
    note: 'סוג המסומן כ<b>תיקונים</b> נזקף לצד הסופר (מקוזז מהיתרה שלו). כל שאר הסוגים נחשבים הוצאות לספר ויורדים מהרווח.',
    fields: [
      { k: '_scribe', label: 'סופר (לצמצום הרשימה)', type: 'combo', items: itemsContacts,
        placeholder: 'כל הסופרים…' },
      { k: 'scroll_id', label: 'ספר', type: 'combo', items: scrollItemsBy('_scribe', 'scribe_id'), required: true,
        placeholder: 'הספרים של הסופר שנבחר…' },
      { k: 'type', label: 'סוג הוצאה', type: 'combo', items: () => itemsList(C.expBook) },
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
  };
  return cfgOnly ? cfg : entityPage(cfg);
}

// ============ הוצאות קלף ============
function pageParchExp(cfgOnly) {
  const scrollById = (id) => C.scrolls.find(s => s.id === id);
  const cfg = {
    title: 'הוצאות קלף', bulk: 'parchment_expenses', store: Store.parchmentExpenses,
    load: () => Store.parchmentExpenses.list(),
    labelOf: (r) => `${r.quantity} יחידות קלף`,
    defaults: () => ({ date: today() }),
    totals: true,
    note: 'סך העלות מחושב אוטומטית: כמות × עלות ליחידה של הגודל שנבחר. סכום זה הוא "עלות קלף בפועל" בכרטיס הספר.',
    fields: [
      { k: '_scribe', label: 'סופר (לצמצום הרשימה)', type: 'combo', items: itemsContacts,
        placeholder: 'כל הסופרים…' },
      { k: 'scroll_id', label: 'ספר', type: 'combo', items: scrollItemsBy('_scribe', 'scribe_id'), required: true,
        placeholder: 'הספרים של הסופר שנבחר…' },
      { k: 'date', label: 'תאריך', type: 'date' },
      { k: 'quantity', label: 'כמות קלף', type: 'number' },
      { k: 'parchment_size_id', label: 'גודל', type: 'combo', items: itemsSizes },
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
  };
  return cfgOnly ? cfg : entityPage(cfg);
}

// ============ הוצאות עסק ============
function pageBizExp(cfgOnly) {
  const cfg = {
    title: 'הוצאות עסק', bulk: 'business_expenses', store: Store.businessExpenses,
    load: () => Store.businessExpenses.list(),
    labelOf: (r) => `${r.type || 'הוצאה'} ${money(r.amount)}`,
    defaults: () => ({ date: today() }),
    totals: true,
    fields: [
      { k: 'date', label: 'תאריך', type: 'date' },
      { k: 'type', label: 'סוג הוצאה', type: 'combo', items: () => itemsList(C.expBiz) },
      { k: 'amount', label: 'סכום', type: 'number' },
      { k: 'note', label: 'הערה', type: 'textarea' },
    ],
    cols: [
      { label: 'תאריך', render: r => dt(r.date) },
      { label: 'סוג הוצאה', render: r => esc(r.type || '') },
      { label: 'סכום', cls: 'num', render: r => mCell(r.amount), total: rows => mCell(sumBy(rows, 'amount')) },
      { label: 'הערה', cls: 'wrap', render: r => esc(r.note || '') },
    ],
  };
  return cfgOnly ? cfg : entityPage(cfg);
}

// ============ מוצרים ============
function pageProd() {
  const subs = [
    { k: 'purchases', label: 'רכישות' },
    { k: 'sales', label: 'מכירות' },
    { k: 'scribepay', label: 'תשלומים לסופר' },
    ...(ME.caps.finance ? [{ k: 'custpay', label: 'תשלומי לקוחות' }] : []),
  ];
  if (!ME.caps.finance && SUB.prod === 'custpay') SUB.prod = 'purchases';
  renderSubtabs('prod', subs);
  const s = SUB.prod;
  if (s === 'purchases') return prodPurchases();
  if (s === 'sales') return prodSales();
  if (s === 'scribepay') return prodScribePay();
  return prodCustPay();
}

function prodPurchases(cfgOnly) {
  const cfg = {
    title: 'רכישות מוצרים', bulk: 'prod_purchases', store: Store.prodPurchases,
    load: () => Store.prodPurchases.list(),
    labelOf: (r) => `${r.product_name} מ${r.scribe_name}`,
    defaults: () => ({ date: today(), purchase_type: 'רגיל',
      _track: PURCH_TRACK.on, _station: PURCH_TRACK.station, _holder: PURCH_TRACK.holder }),
    totals: true,
    note: 'כל רכישה היא <b>חבילה</b> שממנה מוכרים. מחיקת רכישה מעבירה גם את המכירות שנגזרו ממנה לסל המחזור.'
      + ' בהוספת רכישה אפשר לסמן <b>להכניס את היחידות למעקב</b> ולבחור תחנה — היחידות ייווצרו ויוצבו שם מיד.',
    fields: [
      { k: 'date', label: 'תאריך', type: 'date' },
      { k: 'scribe_id', label: 'סופר (המוכר)', type: 'combo', items: itemsContacts },
      { k: 'product_id', label: 'מוצר', type: 'combo', items: itemsProducts },
      { k: 'quantity', label: 'כמות', type: 'number' },
      { k: 'cost_per_unit', label: 'עלות ליחידה', type: 'number', hint: 'מכאן נגזר הסכום לתשלום לסופר' },
      { k: 'extra_cost_per_unit', label: 'עלות נוספת ליחידה', type: 'number', hint: 'לחישוב הרווח בלבד' },
      { k: 'purchase_type', label: 'סוג רכישה', type: 'select', blank: false, options: (v) =>
          `<option value="רגיל" ${v === 'רגיל' ? 'selected' : ''}>רגיל</option><option value="קומיסיון" ${v === 'קומיסיון' ? 'selected' : ''}>קומיסיון</option>` },
      { k: 'note', label: 'הערה', type: 'textarea' },
      // עזרי טופס בלבד (קו תחתון) — נכנסים למעקב מיד עם שמירת הרכישה
      { k: '_track', label: 'להכניס את היחידות למעקב', type: 'checkbox', newOnly: true },
      { k: '_station', label: 'תחנה במעקב', type: 'combo', items: itemsStations, newOnly: true,
        placeholder: 'ללא תחנה — הקלד לחיפוש', hint: 'בחירת תחנה או מחזיק מכניסה למעקב גם בלי לסמן' },
      { k: '_holder', label: 'אצל מי', type: 'combo', items: itemsContacts, newOnly: true,
        placeholder: 'ללא מחזיק — הקלד שם' },
    ],
    afterSave: trackNewPurchase,
    cols: [
      // מספר החבילה — זה המזהה שמזינים בעמודת "מזהה רכישה" בייבוא מכירות
      { label: '#', render: r => `<b>${r.id}</b>` },
      { label: 'תאריך', render: r => dt(r.date) },
      { label: 'סופר', render: r => esc(r.scribe_name || '—') },
      { label: 'מוצר', render: r => esc(r.product_name || '—') },
      { label: 'כמות', cls: 'num', render: r => numCell(r.quantity), total: rows => numCell(sumBy(rows, 'quantity')) },
      { label: 'נמכר', cls: 'num', render: r => numCell(r.sold_qty) },
      { label: 'נשאר', cls: 'num', render: r => `<span class="pill ${N(r.remaining_qty) > 0 ? 'g' : 'n'}">${N(r.remaining_qty)}</span>` },
      { label: "עלות ליח'", cls: 'num', render: r => mCell(r.cost_per_unit) },
      { label: "נוספת ליח'", cls: 'num', render: r => mCell(r.extra_cost_per_unit) },
      { label: 'סוג', render: r => `<span class="pill n">${esc(r.purchase_type || '')}</span>` },
      { label: 'סה"כ לתשלום לסופר', cls: 'num', render: r => mCell(r.owed_scribe), total: rows => mCell(sumBy(rows, 'owed_scribe')) },
      { label: '', cls: 'center', render: r => `<button class="btn ghost xs" data-trk="${r.id}" title="מעקב היחידות של החבילה">📍 מעקב</button>` },
    ],
  };
  return cfgOnly ? cfg : entityPage(cfg);
}

// הכנסת רכישה חדשה למעקב מיד עם שמירתה. הבחירה נזכרת לרכישה הבאה,
// כי בהזנת סדרת רכישות היעד בדרך כלל זהה.
const PURCH_TRACK = { on: false, station: '', holder: '' };

async function trackNewPurchase(saved, data, isEdit) {
  // בחירת תחנה או מחזיק מספיקה כשלעצמה — אחרת שכחה לסמן את התיבה
  // הייתה מבטלת בשקט את כל מה שהמשתמש הזין.
  const want = !!data._track || !!data._station || !!data._holder;
  PURCH_TRACK.on = want;
  PURCH_TRACK.station = data._station || '';
  PURCH_TRACK.holder = data._holder || '';
  if (isEdit || !want) return null;
  const qty = Math.round(N(saved.quantity));
  if (!(qty > 0)) return 'הרכישה נשמרה. לא נוצר מעקב — הכמות אפס.';

  const g = await Store.track.generate({ purchase_id: saved.id, count: qty });
  if (!g.created) return 'הרכישה נשמרה. לא נוצרו יחידות מעקב חדשות.';
  if (!data._station && !data._holder) return `נשמר · ${g.created} יחידות נכנסו למעקב, ללא תחנה`;

  const mv = await Store.track.moveQty({
    purchase_id: saved.id, qty: g.created,
    from_station_id: 0, from_holder_id: 0,      // היחידות נוצרו זה עתה, ללא שיוך
    station_id: data._station, holder_id: data._holder,
    date: data.date || today(), note: 'נכנס עם הרכישה',
  });
  const st = (C.stations.find(x => x.id === +data._station) || {}).name;
  const who = C.contacts.find(x => x.id === +data._holder);
  const where = [st, who && contactName(who)].filter(Boolean).join(' · ');
  return `נשמר · ${mv.moved} יחידות נכנסו למעקב${where ? ' — ' + where : ''}`;
}

function prodSales(cfgOnly) {
  const cfg = {
    title: 'מכירות מוצרים', bulk: 'prod_sales', store: Store.prodSales,
    load: () => Store.prodSales.list(),
    labelOf: (r) => `${r.quantity} × ${r.product_name}`,
    defaults: () => ({ date: today(), sale_type: 'רגיל' }),
    totals: true,
    note: 'לא ניתן למכור יותר מיתרת המלאי בחבילה. רווח = מכירה − (עלות + עלות נוספת) − 3% אם סומן.',
    validate: (d) => (!d.purchase_id ? 'יש לבחור חבילת רכישה' : (N(d.quantity) <= 0 ? 'כמות חייבת להיות גדולה מאפס' : null)),
    fields: [
      { k: 'date', label: 'תאריך', type: 'date' },
      { k: 'customer_id', label: 'שם רוכש', type: 'combo', items: itemsContacts },
      { k: 'purchase_id', label: 'מוצר (חבילה)', type: 'combo', items: itemsPurchases, required: true },
      { k: 'quantity', label: 'כמות', type: 'number' },
      { k: 'price_per_unit', label: 'מחיר מכירה ליחידה', type: 'number' },
      { k: 'sale_type', label: 'סוג מכירה', type: 'select', blank: false, options: (v) =>
          `<option value="רגיל" ${v === 'רגיל' ? 'selected' : ''}>רגיל</option><option value="קומיסיון" ${v === 'קומיסיון' ? 'selected' : ''}>קומיסיון</option>` },
      { k: 'deduct_3pct', label: 'לנכות 3%', type: 'checkbox' },
      { k: 'note', label: 'הערה', type: 'textarea' },
    ],
    cols: [
      { label: '#', render: r => `<b>${r.id}</b>` },
      { label: 'תאריך', render: r => dt(r.date) },
      { label: 'רוכש', render: r => esc(r.customer_name || '—') },
      { label: 'מחבילה', render: r => r.purchase_id ? `<span class="pill n">#${r.purchase_id}</span>` : '—' },
      { label: 'מוצר', render: r => esc(r.product_name || '—') + (r.scribe_name ? ` <span class="mini">· ${esc(r.scribe_name)}</span>` : '') },
      { label: 'כמות', cls: 'num', render: r => numCell(r.quantity), total: rows => numCell(sumBy(rows, 'quantity')) },
      { label: "מחיר ליח'", cls: 'num', render: r => mCell(r.price_per_unit) },
      { label: "עלות ליח'", cls: 'num', render: r => mCell(r.unit_cost) },
      { label: 'סוג', render: r => `<span class="pill n">${esc(r.sale_type || '')}</span>` },
      { label: '3%', cls: 'center', render: r => r.deduct_3pct ? '<span class="pill a">כן</span>' : '' },
      { label: 'סך מכירה', cls: 'num', render: r => mCell(r.total_sale), total: rows => mCell(sumBy(rows, 'total_sale')) },
      { label: 'סך רווח', cls: 'num', render: r => mCell(r.total_profit), total: rows => mCell(sumBy(rows, 'total_profit')) },
    ],
  };
  return cfgOnly ? cfg : entityPage(cfg);
}

function prodScribePay(cfgOnly) {
  const cfg = {
    title: 'תשלומים לסופר (מוצרים)', bulk: 'prod_scribe_payments', store: Store.prodScribePayments,
    load: () => Store.prodScribePayments.list(),
    labelOf: (r) => `תשלום ${money(r.amount)}`,
    defaults: () => ({ date: today() }),
    totals: true,
    fields: [
      { k: 'date', label: 'תאריך', type: 'date' },
      { k: 'scribe_id', label: 'שם סופר', type: 'combo', items: itemsContacts },
      { k: 'amount', label: 'סך ששולם', type: 'number' },
      { k: 'note', label: 'הערה', type: 'textarea' },
    ],
    cols: [
      { label: 'תאריך', render: r => dt(r.date) },
      { label: 'סופר', render: r => esc(r.scribe_name || '—') },
      { label: 'סך ששולם', cls: 'num', render: r => mCell(r.amount), total: rows => mCell(sumBy(rows, 'amount')) },
      { label: 'הערה', cls: 'wrap', render: r => esc(r.note || '') },
    ],
  };
  return cfgOnly ? cfg : entityPage(cfg);
}

function prodCustPay(cfgOnly) {
  const cfg = {
    title: 'תשלומי לקוחות (מוצרים)', bulk: 'prod_customer_payments', store: Store.prodCustomerPayments,
    load: () => Store.prodCustomerPayments.list(),
    labelOf: (r) => `תשלום ${money(r.paid_actual)}`,
    defaults: () => ({ date: today() }),
    totals: true,
    fields: [
      { k: 'date', label: 'תאריך', type: 'date' },
      { k: 'customer_id', label: 'שם לקוח', type: 'combo', items: itemsContacts },
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
  };
  return cfgOnly ? cfg : entityPage(cfg);
}

// ============ דוחות ============
function pageReports() {
  destroyCharts();
  if (!ME.caps.viewReports) {
    // ניהול סופרים — רק דוח סופר
    renderSubtabs('reports', [{ k: 'scribecard', label: 'דוח סופר' }]);
    SUB.reports = 'scribecard';
    return repCard('scribe');
  }
  const subs = [
    { k: 'overview', label: '📊 רווח כולל' },
    { k: 'charts', label: '📈 גרפים' },
    { k: 'byscroll', label: 'רווח לפי ספר' },
    { k: 'bookcard', label: '📖 דוח לפי ספר' },
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
  if (s === 'charts') return repCharts();
  if (s === 'byscroll') return repByScroll();
  if (s === 'bookcard') return repBookCard();
  if (s === 'scribes') return repScribeBalances();
  if (s === 'customers') return repCustomerBalances();
  if (s === 'monthly') return repMonthly();
  if (s === 'inventory') return repInventory();
  if (s === 'scribecard') return repCard('scribe');
  return repCard('customer');
}

// ---------- דוח לפי ספר ----------
// בוחרים ספר ומקבלים את כל התמונה שלו: התקדמות, שני הצדדים, פירוט העלויות
// ומאזן הרווח — כולל גרף שמראה לאן הולך כל שקל מהמחיר לרוכש.
async function repBookCard() {
  const scrolls = C.scrolls;
  if (!repBookCard._id && scrolls.length) repBookCard._id = scrolls[0].id;
  $('view').innerHTML += `
    <div class="toolbar"><div style="min-width:380px">${pickerHTML('bcSel', 'בחר ספר', itemsScrolls(), repBookCard._id, 'הקלד מק"ט או שם…')}</div></div>
    <div id="bcBody"></div>`;
  wirePicker('bcSel', itemsScrolls(), (v) => { if (v) { repBookCard._id = +v; render(); } });
  if (!repBookCard._id) { $('bcBody').innerHTML = `<div class="card empty">אין ספרים במערכת</div>`; return; }

  let d;
  try { d = await Store.scrolls.get(repBookCard._id); }
  catch (e) { $('bcBody').innerHTML = `<div class="card" style="color:var(--red)">${esc(e.message)}</div>`; return; }
  const s = d.scroll;
  const kv = (k, v, b) => `<div class="k">${k}</div><div class="num">${b ? `<b>${v}</b>` : v}</div>`;

  // מאזן הרווח — כל שורה בשקלים, לפי הנוסחה שבאפיון
  const parts = [
    { t: 'עלות הסופר', v: s.scribe_book_price },
    { t: 'צפי קלף', v: s.parchment_expected },
    { t: 'הוצאה קבועה', v: s.fixed_expense },
    { t: 'הוצאות לספר', v: s.book_expenses },
    { t: 'עלות פריטה', v: s.peritah_cost },
  ].filter(x => N(x.v) > 0);
  const profit = N(s.expected_profit);

  $('bcBody').innerHTML = `
    <div class="grid stat-grid">
      <div class="stat"><div class="label">מחיר לרוכש</div><div class="value b">${money(s.buyer_total, s.buyer_currency)}</div>
        <div class="sub">${s.sold ? 'נמכר' : 'טרם נמכר'}</div></div>
      <div class="stat"><div class="label">רווח צפוי</div>
        <div class="value ${profit > 0 ? 'g' : (profit < 0 ? 'r' : '')}">${money(profit)}</div>
        <div class="sub">${s.buyer_total ? Math.round(profit / N(s.buyer_total) * 100) + '% מהמחיר' : ''}</div></div>
      <div class="stat"><div class="label">התקדמות</div><div class="value">${s.progress_pct}%</div>
        <div class="sub">${s.pages_written} מתוך ${s.product_pages} עמודים</div></div>
      <div class="stat"><div class="label">יתרת הרוכש</div><div class="value a">${money(s.buyer_balance_now)}</div>
        <div class="sub">כללית: ${money(s.buyer_balance_total)}</div></div>
      <div class="stat"><div class="label">יתרה לסופר</div><div class="value r">${money(s.scribe_balance)}</div>
        <div class="sub">עתידית: ${money(s.scribe_future_balance)}</div></div>
    </div>

    <div class="row" style="align-items:stretch">
      <div style="flex:1;min-width:300px">${chartBox('bcPie', 'לאן הולך הכסף', 280)}</div>
      <div style="flex:1;min-width:300px">${chartBox('bcProg', 'התקדמות ותשלומים', 280)}</div>
    </div>

    <div class="card"><h3>פירוט</h3>
      <div class="row">
        <div style="flex:1;min-width:250px">
          <div class="sec-title">צד סופר</div>
          <div class="kv">
            ${kv('סופר', esc(s.scribe_name || '—'))}
            ${kv('מחיר לעמוד', money(s.page_rate))}
            ${kv('שכר לספר מלא', money(s.scribe_book_price))}
            ${kv('מגיע לפי התקדמות', money(s.scribe_due_progress))}
            ${kv('שולם', money(s.scribe_paid))}
            ${kv('תיקונים', money(s.corrections_paid))}
            ${kv('יתרה', money(s.scribe_balance), 1)}
          </div>
        </div>
        <div style="flex:1;min-width:250px">
          <div class="sec-title">צד רוכש</div>
          <div class="kv">
            ${kv('רוכש', esc(s.customer_name || '—'))}
            ${kv('מחיר כולל', money(s.buyer_total, s.buyer_currency))}
            ${kv('מחיר לעמוד', money(s.buyer_page_rate))}
            ${kv('לתשלום לפי התקדמות', money(s.buyer_due_progress))}
            ${kv('שילם', money(s.customer_paid))}
            ${kv('עלות פריטה', money(s.peritah_cost))}
            ${kv('יתרה מיידית', money(s.buyer_balance_now), 1)}
          </div>
        </div>
        <div style="flex:1;min-width:250px">
          <div class="sec-title">עלויות ורווח</div>
          <div class="kv">
            ${kv('צפי קלף', money(s.parchment_expected))}
            ${kv('קלף בפועל', money(s.parchment_actual))}
            ${kv('הוצאה קבועה', money(s.fixed_expense) + (s.fixed_expense_overridden ? ' <span class="pill a">ידני</span>' : ''))}
            ${kv('הוצאות לספר', money(s.book_expenses))}
            ${kv('סה"כ עלויות', money(parts.reduce((a, x) => a + N(x.v), 0)), 1)}
            ${kv('רווח צפוי', money(profit), 1)}
          </div>
        </div>
      </div>
    </div>

    <div class="card"><h3>עמודים שנכתבו (${d.pages_log.length})</h3>
      ${tableHTML([{ label: 'תאריך', render: r => dt(r.date) },
                   { label: 'עמודים', cls: 'num', render: r => numCell(r.pages), total: rs => numCell(sumBy(rs, 'pages')) },
                   { label: 'הערה', cls: 'wrap', render: r => esc(r.note || '') }], d.pages_log, { totals: true })}</div>
    <div class="card"><h3>תשלומים לסופר (${d.scribe_payments.length})</h3>
      ${tableHTML([{ label: 'תאריך', render: r => dt(r.date) },
                   { label: 'סכום', cls: 'num', render: r => mCell(r.amount), total: rs => mCell(sumBy(rs, 'amount')) },
                   { label: 'הערה', cls: 'wrap', render: r => esc(r.note || '') }], d.scribe_payments, { totals: true })}</div>
    <div class="card"><h3>תשלומי הרוכש (${d.customer_payments.length})</h3>
      ${tableHTML([{ label: 'תאריך', render: r => dt(r.date) },
                   { label: '₪', cls: 'num', render: r => mCell(r.amount_ils) },
                   { label: '$', cls: 'num', render: r => numCell(r.amount_usd) },
                   { label: 'שער', cls: 'num', render: r => r.rate ? numCell(r.rate) : '' },
                   { label: 'פריטה', cls: 'num', render: r => mCell(r.peritah), total: rs => mCell(sumBy(rs, 'peritah')) },
                   { label: 'שולם בפועל', cls: 'num', render: r => mCell(r.paid_actual), total: rs => mCell(sumBy(rs, 'paid_actual')) }],
                  d.customer_payments, { totals: true })}</div>
    <div class="card"><h3>הוצאות (${d.book_expenses.length + d.parchment_expenses.length})</h3>
      ${tableHTML([{ label: 'תאריך', render: r => dt(r.date) },
                   { label: 'סוג', render: r => esc(r.type || ('קלף · ' + (r.size_name || ''))) + (r.is_correction ? ' <span class="pill a">תיקונים</span>' : '') },
                   { label: 'סכום', cls: 'num', render: r => mCell(r.amount !== undefined ? r.amount : r.total_cost),
                     total: rs => mCell(rs.reduce((a, x) => a + N(x.amount !== undefined ? x.amount : x.total_cost), 0)) }],
                  d.book_expenses.concat(d.parchment_expenses), { totals: true })}</div>`;

  // גרף עוגה — חלוקת המחיר לרוכש בין העלויות לרווח
  const pie = parts.slice();
  if (profit > 0) pie.push({ t: 'רווח', v: profit });
  drawChart('bcPie', {
    type: 'doughnut',
    data: { labels: pie.map(x => x.t), datasets: [{ data: pie.map(x => N(x.v)), backgroundColor: CH, borderWidth: 2, borderColor: '#fff' }] },
    options: { plugins: { legend: { position: 'left' } } },
  });
  // התקדמות מול תשלומים — כמה נכתב, כמה שולם משני הצדדים
  drawChart('bcProg', {
    type: 'bar',
    data: {
      labels: ['הרוכש', 'הסופר'],
      datasets: [
        { label: 'שולם', data: [N(s.customer_paid), N(s.scribe_paid)], backgroundColor: CH[3] },
        { label: 'נותר', data: [Math.max(0, N(s.buyer_balance_total)), Math.max(0, N(s.scribe_balance) + N(s.scribe_future_balance))], backgroundColor: '#e2e8f0' },
      ],
    },
    options: { scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: v => money(v) } } } },
  });
}

// ---------- גרפים ----------
async function repCharts() {
  const year = repCharts._y || new Date().getFullYear();
  const years = []; for (let y = new Date().getFullYear() + 1; y >= 2020; y--) years.push(y);
  $('view').innerHTML += `
    <div class="toolbar"><label class="mini">שנה:</label>
      <select id="chYear">${years.map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
    <div id="chBody"><div class="card muted">טוען גרפים…</div></div>`;
  $('chYear').onchange = (e) => { repCharts._y = +e.target.value; render(); };

  let scrolls, prof, mo, scribes, customers, inv;
  try {
    [scrolls, prof, mo, scribes, customers, inv] = await Promise.all([
      Store.reports.byScroll(), Store.reports.profit(), Store.reports.monthly(year),
      Store.reports.scribeBalances(), Store.reports.customerBalances(), Store.reports.inventory(),
    ]);
  } catch (e) { $('chBody').innerHTML = `<div class="card" style="color:var(--red)">${esc(e.message)}</div>`; return; }

  const sold = scrolls.filter(s => s.sold);
  const topProfit = sold.slice().sort((a, b) => N(b.expected_profit) - N(a.expected_profit)).slice(0, 12);
  const topScribes = scribes.filter(x => N(x.total_balance) > 0).slice(0, 12);
  const topCust = customers.filter(x => N(x.total_due_now) > 0).slice(0, 12);
  const names = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];

  $('chBody').innerHTML = `
    <div class="row" style="align-items:stretch">
      <div style="flex:1;min-width:340px">${chartBox('cMonthly', `רווח ומכירות לפי חודש · ${year}`, 320)}</div>
      <div style="flex:1;min-width:340px">${chartBox('cCash', `תקבולים מול תשלומים · ${year}`, 320)}</div>
    </div>
    <div class="row" style="align-items:stretch">
      <div style="flex:1;min-width:340px">${chartBox('cProfitSrc', 'מקורות הרווח', 300)}</div>
      <div style="flex:1;min-width:340px">${chartBox('cCosts', 'התפלגות העלויות', 300)}</div>
    </div>
    ${chartBox('cTopBooks', 'הספרים הרווחיים ביותר', 330)}
    <div class="row" style="align-items:stretch">
      <div style="flex:1;min-width:340px">${chartBox('cScribes', 'חוב לסופרים', 320)}</div>
      <div style="flex:1;min-width:340px">${chartBox('cCustomers', 'חוב הרוכשים', 320)}</div>
    </div>
    ${chartBox('cProgress', 'התקדמות כתיבה (ספרים פעילים)', 330)}`;

  drawChart('cMonthly', {
    type: 'bar',
    data: { labels: names, datasets: [
      { label: 'מכירות ס"ת', data: mo.months.map(m => N(m.scroll_sales)), backgroundColor: CH[2] },
      { label: 'מכירות מוצרים', data: mo.months.map(m => N(m.product_sales)), backgroundColor: CH[1] },
      { label: 'רווח', type: 'line', data: mo.months.map(m => N(m.profit)), borderColor: CH[0], backgroundColor: CH[0], tension: .3, borderWidth: 3, pointRadius: 4 },
    ] },
    options: { scales: { y: { ticks: { callback: v => money(v) } } } },
  });
  drawChart('cCash', {
    type: 'bar',
    data: { labels: names, datasets: [
      { label: 'תקבולים', data: mo.months.map(m => N(m.received)), backgroundColor: CH[3] },
      { label: 'שולם לסופרים', data: mo.months.map(m => -N(m.paid_scribes)), backgroundColor: CH[4] },
      { label: 'הוצאות', data: mo.months.map(m => -(N(m.book_expenses) + N(m.business_expenses))), backgroundColor: CH[6] },
    ] },
    options: { scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: v => money(v) } } } },
  });
  drawChart('cProfitSrc', {
    type: 'doughnut',
    data: { labels: ['רווח ס"ת', 'רווח מוצרים'], datasets: [{
      data: [Math.max(0, N(prof.scrolls.profit)), Math.max(0, N(prof.products.profit))],
      backgroundColor: [CH[0], CH[1]], borderWidth: 2, borderColor: '#fff' }] },
  });
  const costs = [
    { t: 'עלות סופרים', v: prof.scrolls.scribe_cost },
    { t: 'קלף (צפי)', v: prof.scrolls.parchment_expected },
    { t: 'הוצאות קבועות', v: prof.scrolls.fixed_expenses },
    { t: 'הוצאות לספר', v: prof.scrolls.book_expenses },
    { t: 'פריטה', v: N(prof.scrolls.peritah) + N(prof.products.peritah) },
    { t: 'עלות מוצרים', v: prof.products.cost },
    { t: 'הוצאות עסק', v: prof.business_expenses },
  ].filter(x => N(x.v) > 0);
  drawChart('cCosts', {
    type: 'doughnut',
    data: { labels: costs.map(x => x.t), datasets: [{ data: costs.map(x => N(x.v)), backgroundColor: CH, borderWidth: 2, borderColor: '#fff' }] },
    options: { plugins: { legend: { position: 'left' } } },
  });
  drawChart('cTopBooks', {
    type: 'bar',
    data: { labels: topProfit.map(s => `#${s.id} ${s.product_name || ''}`),
      datasets: [{ label: 'רווח צפוי', data: topProfit.map(s => N(s.expected_profit)),
        backgroundColor: topProfit.map(s => N(s.expected_profit) >= 0 ? CH[0] : CH[4]) }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: v => money(v) } } } },
  });
  drawChart('cScribes', {
    type: 'bar',
    data: { labels: topScribes.map(x => x.name), datasets: [{ label: 'חוב', data: topScribes.map(x => N(x.total_balance)), backgroundColor: CH[4] }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: v => money(v) } } } },
  });
  drawChart('cCustomers', {
    type: 'bar',
    data: { labels: topCust.map(x => x.name), datasets: [{ label: 'חוב מיידי', data: topCust.map(x => N(x.total_due_now)), backgroundColor: CH[1] }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: v => money(v) } } } },
  });
  const active = scrolls.filter(s => s.status !== 'done').sort((a, b) => b.progress_pct - a.progress_pct).slice(0, 15);
  drawChart('cProgress', {
    type: 'bar',
    data: { labels: active.map(s => `#${s.id} ${s.scribe_name || ''}`), datasets: [
      { label: 'נכתב', data: active.map(s => N(s.pages_written)), backgroundColor: CH[0] },
      { label: 'נותר', data: active.map(s => Math.max(0, N(s.product_pages) - N(s.pages_written))), backgroundColor: '#e2e8f0' },
    ] },
    options: { indexAxis: 'y', scales: { x: { stacked: true }, y: { stacked: true } },
      plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.x} עמודים` } } } },
  });
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
    skuCol,
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
      style="height:${Math.max(2, Math.abs(N(m.profit)) / max * 100)}%" title="${names[i]}: ${money(m.profit)}"></div>`).join('');
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
    { label: "עלות ליח'", cls: 'num', render: r => mCell(r.unit_cost) },
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
    <div class="toolbar"><div style="min-width:340px">${pickerHTML('cardSel', 'בחר ' + label, itemsContacts(), '', 'הקלד שם…')}</div></div>
    <div id="cardBody"></div>`;
  wirePicker('cardSel', itemsContacts(), async (v) => {
    if (!v) return ($('cardBody').innerHTML = '');
    $('cardBody').innerHTML = '<div class="card muted">טוען…</div>';
    try {
      const d = await Store.reports[kind](v);
      $('cardBody').innerHTML = kind === 'scribe' ? scribeCardHTML(d) : customerCardHTML(d);
    } catch (err) { $('cardBody').innerHTML = `<div class="card" style="color:var(--red)">${esc(err.message)}</div>`; }
  });
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
        skuCol,
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
        { label: "עלות ליח'", cls: 'num', render: r => mCell(r.cost_per_unit) },
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
        skuCol,
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
                   { label: "מחיר ליח'", cls: 'num', render: r => mCell(r.price_per_unit) },
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

function setContacts(cfgOnly) {
  const cfg = {
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
  };
  return cfgOnly ? cfg : entityPage(cfg);
}

function setProducts(cfgOnly) {
  const cfg = {
    title: 'מוצרים', bulk: 'products', store: Store.products,
    load: () => Store.products.list(),
    labelOf: (r) => r.name,
    note: 'מספר העמודים משמש לחישוב מחיר-לעמוד ולהתקדמות. יחידות הקלף מזינות את "צפי קלף".',
    fields: [
      { k: 'name', label: 'שם המוצר', type: 'text', required: true },
      { k: 'parchment_units', label: 'יחידות קלף', type: 'number' },
      { k: 'pages', label: 'מספר עמודים', type: 'number' },
      { k: 'fixed_expense', label: 'הוצאה קבועה', type: 'number' },
      { k: 'sheets_count', label: 'מכמה יריעות מורכב', type: 'number',
        hint: 'למעקב יריעות. ריק = לפי יחידות הקלף' },
    ],
    cols: [
      { label: 'שם המוצר', render: r => esc(r.name) },
      { label: 'יריעות', cls: 'num', render: r => r.sheets_count ? `<b>${r.sheets_count}</b>` : numCell(r.parchment_units) },
      { label: 'יחידות קלף', cls: 'num', render: r => numCell(r.parchment_units) },
      { label: 'עמודים', cls: 'num', render: r => numCell(r.pages) },
      { label: 'הוצאה קבועה', cls: 'num', render: r => mCell(r.fixed_expense) },
    ],
  };
  return cfgOnly ? cfg : entityPage(cfg);
}

function setSizes(cfgOnly) {
  const cfg = {
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
  };
  return cfgOnly ? cfg : entityPage(cfg);
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
        <input id="u_name" value="${esc(row ? row.username : '')}">
        ${row ? '<div class="hint">שינוי שם המשתמש משנה גם את שם ההתחברות</div>' : ''}</div>
      <div class="field"><label>שם מלא</label><input id="u_full" value="${esc(row ? row.full_name || '' : '')}"></div>
      <div class="field"><label>סיסמא ${row ? '(השאר ריק כדי לא לשנות)' : ''}</label><input id="u_pass" type="password"></div>
      <div class="field"><label>תפקיד</label><select id="u_role">
        ${roles.map(r => `<option value="${r.role}" ${row && row.role === r.role ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select></div>
      ${row ? `<div class="chk"><input type="checkbox" id="u_act" ${row.active ? 'checked' : ''}><label for="u_act">משתמש פעיל</label></div>` : ''}`;
    const m = modal({ title: row ? 'עריכת משתמש' : 'משתמש חדש', body,
      footer: `<button class="btn" data-ok>שמירה</button><button class="btn ghost" data-no>ביטול</button>` });
    m.el.querySelector('[data-no]').onclick = m.close;
    m.el.querySelector('[data-ok]').onclick = async () => {
      const d = { full_name: $('u_full').value, role: $('u_role').value, username: $('u_name').value };
      if ($('u_pass').value) d.password = $('u_pass').value;
      if (row) d.active = $('u_act').checked;
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

// ספריית הגרפים — נטענת רק כשנכנסים לדוח עם גרף
function loadChart() {
  if (window.Chart) return Promise.resolve();
  if (loadChart._p) return loadChart._p;
  loadChart._p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'chart.umd.min.js';
    s.onload = () => resolve();
    s.onerror = () => { loadChart._p = null; reject(new Error('טעינת ספריית הגרפים נכשלה')); };
    document.head.appendChild(s);
  });
  return loadChart._p;
}

// פלטת צבעים אחידה לכל הגרפים
const CH = ['#0f766e', '#c98a2e', '#0ea5e9', '#16a34a', '#dc2626', '#7c3aed',
            '#d97706', '#0891b2', '#65a30d', '#be123c', '#4f46e5', '#059669'];
const CHART_INSTANCES = [];
function destroyCharts() { while (CHART_INSTANCES.length) { try { CHART_INSTANCES.pop().destroy(); } catch (e) {} } }

// יוצר גרף בקנבס לפי מזהה. RTL, בלי אנימציה מיותרת.
async function drawChart(id, cfg) {
  await loadChart();
  const el = $(id);
  if (!el) return;
  cfg.options = Object.assign({
    responsive: true, maintainAspectRatio: false,
    animation: { duration: 400 },
    plugins: {
      legend: { rtl: true, textDirection: 'rtl', labels: { font: { family: 'Assistant, Arial' }, boxWidth: 14 } },
      tooltip: { rtl: true, textDirection: 'rtl', bodyFont: { family: 'Assistant, Arial' },
        callbacks: { label: (c) => ` ${c.dataset.label ? c.dataset.label + ': ' : ''}${money(c.parsed.y !== undefined && c.parsed.y !== null ? c.parsed.y : c.parsed)}` } },
    },
  }, cfg.options || {});
  CHART_INSTANCES.push(new Chart(el.getContext('2d'), cfg));
}

const chartBox = (id, title, h) =>
  `<div class="card"><h3>${esc(title)}</h3><div style="height:${h || 300}px"><canvas id="${id}"></canvas></div></div>`;

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
    mode: 'create', text: '', createContacts: false, dateFormat: 'auto',
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
          ${!isDel && cols.some(c => c.type === 'date') ? `
          <div class="field" style="max-width:300px"><label>פורמט תאריך</label>
            <select id="${P}dfmt">
              <option value="auto" ${st.dateFormat === 'auto' ? 'selected' : ''}>זיהוי אוטומטי</option>
              <option value="dmy" ${st.dateFormat === 'dmy' ? 'selected' : ''}>יום/חודש/שנה (ישראלי)</option>
              <option value="mdy" ${st.dateFormat === 'mdy' ? 'selected' : ''}>חודש/יום/שנה (אמריקאי)</option>
            </select></div>` : ''}
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
    if (q('dfmt')) q('dfmt').onchange = (e) => { st.dateFormat = e.target.value; q('run').disabled = true; };
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
    const runOpts = () => ({ createMissingContacts: st.createContacts, dateFormat: st.dateFormat });
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
      const df = r.date_format;
      const dfName = df && df.fmt === 'mdy' ? 'חודש/יום/שנה (אמריקאי)' : 'יום/חודש/שנה (ישראלי)';
      q('res').innerHTML = `
        ${parsed.dropped && parsed.dropped.length ? `
          <div class="card" style="margin-top:6px;border-color:var(--red)">
            <b style="color:var(--red)">⚠ עמודות שלא זוהו ויושלכו:</b> ${parsed.dropped.map(esc).join(' · ')}
            <div class="mini">אם הן חשובות — תקן את הכותרות (כפתור "העתק שורת כותרות") לפני הייבוא.</div>
          </div>` : ''}
        ${df ? `<div class="card mini" style="margin-top:6px${df.conflict ? ';border-color:var(--red)' : ''}">
            📅 תאריכים נקראים כ<b>${dfName}</b>${
              df.manual ? ' (נבחר ידנית)' :
              df.conflict ? ' — <span class="neg">⚠ בהדבקה יש גם תאריכים בפורמט השני. בדוק וקבע ידנית.</span>' :
              df.proof ? ` (זוהה אוטומטית לפי ${df.proof} תאריכים חד-משמעיים)` :
              ' — לא נמצאה הוכחה בהדבקה, זו ברירת המחדל. אם התאריכים אמריקאיים, קבע ידנית למעלה.'}
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


// ============ מעקב יריעות ============
// פריט מעקב = יריעה של ספר או יחידה של מוצר. אותו מסך לשניהם.
const itemsStations = () => C.stations.map(s => ({ v: s.id, t: s.name }));

function itemLabel(r) {
  if (r.scroll_id) return `ספר #${r.scroll_id} · ${r.product_name || ''}`;
  if (r.purchase_id) return `חבילה #${r.purchase_id} · ${r.purchase_product_name || ''}`;
  return '—';
}
const stationPill = (r) => r.station_name
  ? `<span class="pill" style="background:${esc(r.station_color || '#e0f2fe')};color:#075985">${esc(r.station_name)}</span>`
  : '<span class="pill n">לא שויך</span>';

function pageTrack() {
  const subs = [
    { k: 'summary', label: '📍 סקירה' },
    { k: 'sheets', label: '📄 יריעות לפי ספר' },
    { k: 'products', label: '📦 מוצרים לפי כמות' },
    { k: 'items', label: 'כל הפריטים' },
    { k: 'stations', label: 'תחנות' },
  ];
  renderSubtabs('track', subs);
  const s = SUB.track;
  if (s === 'stations') return trackStations();
  if (s === 'items') return trackItems();
  if (s === 'sheets') return trackSheets();
  if (s === 'products') return trackProducts();
  return trackSummary();
}

// ---------- סקירה: כמה יריעות בכל תחנה ואצל כל אדם ----------
async function trackSummary() {
  const d = await Store.track.summary();
  const st = (label, val, cls, sub) => `<div class="stat"><div class="label">${label}</div>
    <div class="value ${cls || ''}">${val}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;

  $('view').innerHTML += `
    <div class="grid stat-grid">
      ${st('סה"כ פריטים במעקב', d.total, '', 'יריעות ספרים + יחידות מוצרים')}
      ${st('לא שויכו לתחנה', d.unassigned, d.unassigned ? 'a' : '')}
      ${st('תחנות פעילות', d.by_station.filter(x => x.id).length)}
      ${st('אנשים שמחזיקים', d.by_holder.filter(x => x.id).length)}
    </div>

    <div class="row" style="align-items:stretch">
      <div style="flex:1;min-width:320px"><div class="card"><h3>לפי תחנה</h3>
        ${tableHTML([
          { label: 'תחנה', render: r => r.id
              ? `<span class="link" data-goto-station="${r.id}">${esc(r.name)}</span>`
              : `<span class="muted">${esc(r.name)}</span>` },
          { label: 'יריעות', cls: 'num', render: r => `<b>${r.items}</b>`, total: rs => `<b>${rs.reduce((a, x) => a + x.items, 0)}</b>` },
        ], d.by_station, { totals: true })}</div></div>

      <div style="flex:1;min-width:320px"><div class="card"><h3>אצל מי היריעות</h3>
        ${tableHTML([
          { label: 'שם', render: r => r.id
              ? `<span class="link" data-goto-holder="${r.id}">${esc(r.name)}</span>`
              : `<span class="muted">${esc(r.name)}</span>` },
          { label: 'יריעות', cls: 'num', render: r => `<b>${r.items}</b>`, total: rs => `<b>${rs.reduce((a, x) => a + x.items, 0)}</b>` },
          { label: 'ספרים', cls: 'num', render: r => r.scrolls || '' },
          { label: 'הישן ביותר', render: r => r.oldest ? dt(r.oldest) : '' },
        ], d.by_holder, { totals: true })}</div></div>
    </div>

    ${chartBox('trkChart', 'התפלגות היריעות לפי תחנה', 300)}

    ${(d.by_purchase && d.by_purchase.length) ? `<div class="card"><h3>לפי חבילת מוצרים</h3>
      ${tableHTML([
        { label: 'חבילה', render: r => `<span class="link" data-goto-pur="${r.id}">#${r.id} · ${esc(r.product_name || '')}</span>` },
        { label: 'סופר', render: r => esc(r.scribe_name || '—') },
        { label: 'יחידות במעקב', cls: 'num', render: r => r.items,
          total: rs => rs.reduce((a, x) => a + x.items, 0) },
        { label: 'בחבילה', cls: 'num', render: r => r.quantity },
        { label: 'מיקומים', cls: 'num', render: r => r.spots },
        { label: 'שויכו לתחנה', cls: 'num', render: r => `${r.placed} / ${r.items}` },
        { label: 'התקדמות', render: r => `<div class="bar ${r.placed < r.items ? 'warn' : ''}">
            <span style="width:${r.items ? Math.round(r.placed / r.items * 100) : 0}%"></span></div>` },
      ], d.by_purchase, { totals: true })}</div>` : ''}

    <div class="card"><h3>לפי ספר</h3>
      ${tableHTML([
        { label: 'ספר', render: r => `<span class="link" data-goto-scroll="${r.id}">#${r.id} · ${esc(r.product_name || '')}</span>` },
        { label: 'סופר', render: r => esc(r.scribe_name || '—') },
        { label: 'יריעות', cls: 'num', render: r => r.items },
        { label: 'שויכו לתחנה', cls: 'num', render: r => `${r.placed} / ${r.items}` },
        { label: 'התקדמות', render: r => `<div class="bar ${r.placed < r.items ? 'warn' : ''}">
            <span style="width:${r.items ? Math.round(r.placed / r.items * 100) : 0}%"></span></div>` },
      ], d.by_scroll)}</div>`;

  const withItems = d.by_station.filter(x => x.items > 0);
  drawChart('trkChart', {
    type: 'doughnut',
    data: { labels: withItems.map(x => x.name),
      datasets: [{ data: withItems.map(x => x.items), backgroundColor: CH, borderWidth: 2, borderColor: '#fff' }] },
    options: { plugins: { legend: { position: 'left' },
      tooltip: { callbacks: { label: (c) => ` ${c.label}: ${c.parsed} יריעות` } } } },
  });

  document.querySelectorAll('[data-goto-station]').forEach(b => b.onclick = () => {
    TRACK.station = +b.dataset.gotoStation; TRACK.holder = ''; TRACK.scroll = '';
    SUB.track = 'items'; render();
  });
  document.querySelectorAll('[data-goto-holder]').forEach(b => b.onclick = () => {
    TRACK.holder = +b.dataset.gotoHolder; TRACK.station = ''; TRACK.scroll = '';
    SUB.track = 'items'; render();
  });
  document.querySelectorAll('[data-goto-scroll]').forEach(b => b.onclick = () => {
    SHEETGRID.scrollId = +b.dataset.gotoScroll;
    SUB.track = 'sheets'; render();
  });
  document.querySelectorAll('[data-goto-pur]').forEach(b => b.onclick = () => {
    PRODTRACK.purchaseId = +b.dataset.gotoPur;
    SUB.track = 'products'; render();
  });
}

// ---------- כל היריעות: סינון, בחירה מרובה והעברה ----------
const TRACK = { scroll: '', purchase: '', station: '', holder: '' };

async function trackItems() {
  const filt = {};
  if (TRACK.scroll) filt.scroll_id = TRACK.scroll;
  if (TRACK.purchase) filt.purchase_id = TRACK.purchase;
  if (TRACK.station) filt.station_id = TRACK.station;
  if (TRACK.holder) filt.holder_id = TRACK.holder;
  const allRows = await Store.track.list(filt);

  const cols = [
    ...(ME.caps.edit ? [selCol('track_items')] : []),
    { label: 'שייך ל', render: r => esc(itemLabel(r)) },
    { label: 'יריעה / יחידה', cls: 'num', render: r => `<b>${r.seq}</b>${r.label ? ` · ${esc(r.label)}` : ''}` },
    { label: 'סופר', render: r => esc(r.scribe_name || r.purchase_scribe_name || '—') },
    { label: 'תחנה', render: r => stationPill(r) },
    { label: 'אצל מי', render: r => esc(r.holder_name || '—') },
    { label: 'מתאריך', render: r => r.since ? dt(r.since) : '' },
    { label: 'ימים', cls: 'num', render: r => r.days_at_station != null
        ? `<span class="${r.days_at_station > 60 ? 'neg' : ''}">${r.days_at_station}</span>` : '' },
    { label: 'הערה', cls: 'wrap', render: r => esc(r.note || '') },
    { label: '', cls: 'center', render: r => `<button class="btn ghost xs" data-hist="${r.id}">היסטוריה</button>` },
  ];
  const rows = applyFilters('track_items', cols, allRows);

  $('view').innerHTML += `
    <div class="card">
      <div class="row">
        <div style="flex:1;min-width:260px">${pickerHTML('tkScroll', 'ספר', itemsScrolls(), TRACK.scroll, 'כל הספרים — הקלד לחיפוש')}</div>
        <div style="flex:1;min-width:260px">${pickerHTML('tkPur', 'חבילת מוצרים', itemsPurchasesAll(), TRACK.purchase, 'כל החבילות')}</div>
        <div style="flex:1;min-width:200px">${pickerHTML('tkStation', 'תחנה', itemsStations(), TRACK.station, 'כל התחנות')}</div>
        <div style="flex:1;min-width:220px">${pickerHTML('tkHolder', 'אצל מי', itemsContacts(), TRACK.holder, 'כולם — הקלד שם')}</div>
      </div>
      ${ME.caps.edit ? `<div class="toolbar">
        <button class="btn" id="tkGen">+ צור יריעות לספר</button>
        <span class="mini">סמן יריעות בטבלה כדי להעביר אותן לתחנה אחרת</span></div>` : ''}
    </div>
    <div class="card">
      ${filterBarHTML('track_items', rows.length, allRows.length)}
      ${tableHTML(cols, rows, { fkey: 'track_items' })}
    </div>`;

  wirePicker('tkScroll',  itemsScrolls(),  (v) => { TRACK.scroll = v; if (v) TRACK.purchase = ''; render(); });
  wirePicker('tkPur',     itemsPurchasesAll(), (v) => { TRACK.purchase = v; if (v) TRACK.scroll = ''; render(); });
  wirePicker('tkStation', itemsStations(), (v) => { TRACK.station = v; render(); });
  wirePicker('tkHolder',  itemsContacts(), (v) => { TRACK.holder = v; render(); });
  if ($('tkGen')) $('tkGen').onclick = openGenerate;
  wireSelection();
  wireFilters('track_items', cols, allRows);
  document.querySelectorAll('[data-hist]').forEach(b => b.onclick = () => showHistory(+b.dataset.hist));
}

// יצירת יריעות לספר
function openGenerate() {
  const body = `
    ${pickerHTML('gnScroll', 'ספר', itemsScrolls(), '', 'הקלד מק"ט או שם…')}
    <div class="field"><label>מספר יריעות</label><input id="gnCount" type="number" min="1" max="2000">
      <div class="hint">ברירת המחדל מגיעה מהמוצר. בנביאים וכתובים הכמות משתנה — אפשר לשנות כאן.</div></div>
    <div class="mini">היריעות ייווצרו ממוספרות 1 עד N, ללא תחנה. יריעות שכבר קיימות לא ישוכפלו.</div>`;
  const m = modal({ title: 'יצירת יריעות למעקב', body,
    footer: `<button class="btn" data-ok>צור</button><button class="btn ghost" data-no>ביטול</button>` });
  m.el.querySelector('[data-no]').onclick = m.close;
  // בחירת ספר ממלאת אוטומטית את מספר היריעות המוגדר לו
  wirePicker('gnScroll', itemsScrolls(), (v) => {
    const s = C.scrolls.find(x => x.id === +v);
    if (s) $('gnCount').value = N(s.sheets_count) || N(s.product_sheets_count) || N(s.product_parchment_units) || '';
  });
  m.el.querySelector('[data-ok]').onclick = async () => {
    const scroll_id = $('f_gnScroll').value;
    if (!scroll_id) return toast('יש לבחור ספר', 'err');
    try {
      const r = await Store.track.generate({ scroll_id, count: $('gnCount').value || undefined });
      toast(r.created ? `נוצרו ${r.created} יריעות` : (r.message || 'לא נוצרו יריעות חדשות'), 'ok');
      m.close(); await reloadCaches(); render();
    } catch (e) { toast(e.message, 'err'); }
  };
}

// חלון העברה — נפתח מפס הבחירה
function openMove(ids) {
  const body = `
    <p class="mini">מעבירים <b>${ids.length}</b> יריעות. שדה שיישאר ריק לא ישתנה.</p>
    ${pickerHTML('mvStation', 'לתחנה', itemsStations(), '', 'לא לשנות')}
    <div class="field"><label>אצל מי</label>
      <div class="combo" data-combo="mvHolder">
        <input type="hidden" id="f_mvHolder" value="">
        <input class="combo-inp" id="t_mvHolder" autocomplete="off" placeholder="הקלד שם…">
        <div class="combo-menu" style="display:none"></div>
      </div></div>
    <div class="field"><label>תאריך</label><input id="mvDate" type="date" value="${today()}"></div>
    <div class="field"><label>הערה</label><input id="mvNote"></div>`;
  const m = modal({ title: 'העברת יריעות', body,
    footer: `<button class="btn" data-ok>העבר</button><button class="btn ghost" data-no>ביטול</button>` });
  m.el.querySelector('[data-no]').onclick = m.close;
  wireCombos(m.el, [{ k: 'mvHolder', type: 'combo', items: itemsContacts },
                    { k: 'mvStation', type: 'combo', items: itemsStations }]);
  m.el.querySelector('[data-ok]').onclick = async () => {
    const station_id = $('f_mvStation').value;
    const holder_id = $('f_mvHolder').value;
    if (!station_id && !holder_id) return toast('יש לבחור תחנה או מחזיק', 'err');
    try {
      const r = await Store.track.move({ ids, station_id, holder_id, date: $('mvDate').value, note: $('mvNote').value });
      toast(`הועברו ${r.moved} יריעות${r.skipped ? ` · ${r.skipped} כבר היו שם` : ''}`, 'ok');
      m.close(); await reloadCaches(); render();
    } catch (e) { toast(e.message, 'err'); }
  };
}

async function showHistory(id) {
  try {
    const h = await Store.track.history(id);
    const body = h.length ? tableHTML([
      { label: 'תאריך', render: r => dt(r.date) },
      { label: 'מ', render: r => esc([r.from_station, r.from_holder].filter(Boolean).join(' · ') || '—') },
      { label: 'אל', render: r => esc([r.to_station, r.to_holder].filter(Boolean).join(' · ') || '—') },
      { label: 'הערה', cls: 'wrap', render: r => esc(r.note || '') },
      { label: 'ע"י', render: r => esc(r.by_user || '') },
    ], h) : '<div class="empty">אין תנועות עדיין</div>';
    modal({ title: 'היסטוריית היריעה', body, wide: true });
  } catch (e) { toast(e.message, 'err'); }
}


// ---------- מוצרים לפי כמות ----------
// מזוזות, תפילין וכדומה אינם מתפצלים ליריעות ממוספרות אלא נספרים בכמות.
// המסך הזה מציג "כמה יחידות נמצאות איפה", ומאפשר להעביר חלק מהכמות בלבד:
// שולחים 20 למוחק, ואחר כך מעבירים מתוכן 5 בלבד לתופר — השאר נשארות אצלו.
// מתחת לפני השטח כל יחידה היא פריט מעקב נפרד, ולכן לכל אחת יש היסטוריה משלה.
const PRODTRACK = { purchaseId: '' };

async function trackProducts() {
  const list = itemsPurchasesAll();
  if (!PRODTRACK.purchaseId && C.purchases.length) PRODTRACK.purchaseId = C.purchases[0].id;

  $('view').innerHTML += `
    <div class="card">
      <div class="row" style="align-items:flex-end">
        <div style="max-width:560px;flex:1">${pickerHTML('ptPur', 'בחר חבילת מוצרים', list,
          PRODTRACK.purchaseId, 'הקלד שם מוצר או סופר…')}</div>
      </div>
    </div>
    <div id="ptBody"><div class="card muted">טוען…</div></div>`;
  wirePicker('ptPur', list, (v) => { if (v) { PRODTRACK.purchaseId = +v; render(); } });

  if (!PRODTRACK.purchaseId) {
    $('ptBody').innerHTML = `<div class="card"><div class="empty"><div class="big">\U0001f4e6</div>
      אין עדיין חבילות רכישה. פתח רכישה בלשונית "רכישות מוצרים" וחזור לכאן.</div></div>`;
    return;
  }
  await drawProdTrack();
}

async function drawProdTrack() {
  const pid = +PRODTRACK.purchaseId;
  const pur = C.purchases.find(p => p.id === pid) || {};
  let groups;
  try { groups = await Store.track.groups({ purchase_id: pid }); }
  catch (e) { $('ptBody').innerHTML = `<div class="card" style="color:var(--red)">${esc(e.message)}</div>`; return; }

  const tracked = groups.reduce((a, g) => a + g.qty, 0);
  const total   = N(pur.quantity);
  const loose   = groups.filter(g => !g.station_id && !g.holder_id).reduce((a, g) => a + g.qty, 0);
  const spots   = groups.filter(g => g.station_id || g.holder_id).length;
  const missing = Math.max(0, total - tracked);

  const st = (label, val, cls, sub) => `<div class="stat"><div class="label">${label}</div>
    <div class="value ${cls || ''}">${val}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;

  const cols = [
    { label: 'תחנה', render: g => g.station_id ? stationPill(g) : '<span class="pill n">לא שויך</span>' },
    { label: 'אצל מי', render: g => esc(g.holder_name || '—') },
    { label: 'כמות', cls: 'num', render: g => `<b>${g.qty}</b>`,
      total: rs => `<b>${rs.reduce((a, x) => a + x.qty, 0)}</b>` },
    { label: 'מהתאריך', render: g => g.since ? dt(g.since) : '' },
    { label: 'ימים', cls: 'num', render: g => g.days != null
        ? `<span class="${g.days > 60 ? 'neg' : ''}">${g.days}</span>` : '' },
    ...(ME.caps.edit ? [{ label: '', cls: 'center',
      render: (g, i) => `<button class="btn xs" data-mvq="${i}">↔ העבר כמות</button>` }] : []),
  ];

  const genBtn = (ME.caps.edit && missing > 0)
    ? `<button class="btn ${tracked ? 'ghost' : ''}" id="ptGen">+ הכנס ${missing} יחידות למעקב</button>` : '';

  $('ptBody').innerHTML = `
    <div class="grid stat-grid">
      ${st('יחידות במעקב', tracked, '', `בחבילה: ${total}`)}
      ${st('מיקומים', spots)}
      ${st('לא שויכו לתחנה', loose, loose ? 'a' : '')}
      ${st('עדיין לא במעקב', missing, missing ? 'a' : 'g')}
    </div>
    ${genBtn ? `<div class="card"><div class="toolbar">${genBtn}
      <span class="mini">היחידות נכנסות ללא תחנה, ומשם מעבירים אותן בכמויות.</span></div></div>` : ''}
    <div class="card"><h3>איפה נמצאות היחידות</h3>
      ${tableHTML(cols, groups, { totals: true })}</div>`;

  if ($('ptGen')) $('ptGen').onclick = async () => {
    try {
      const r = await Store.track.generate({ purchase_id: pid, count: total });
      toast(r.created ? `נכנסו ${r.created} יחידות למעקב` : (r.message || 'לא נוצרו יחידות'), 'ok');
      render();
    } catch (e) { toast(e.message, 'err'); }
  };
  document.querySelectorAll('[data-mvq]').forEach(b =>
    b.onclick = () => openMoveQty(groups[+b.dataset.mvq], pid));
}

// חלון העברת כמות — הכמות שלא מועברת נשארת בדיוק במקומה
function openMoveQty(g, purchaseId) {
  if (!g) return;
  const where = [g.station_name, g.holder_name].filter(Boolean).join(' · ') || 'לא שויך';
  const body = `
    <p class="mini">מתוך <b>${esc(where)}</b> — נמצאות שם <b>${g.qty}</b> יחידות.</p>
    <div class="field"><label>כמה להעביר</label>
      <input id="mqQty" type="number" min="1" max="${g.qty}" value="${g.qty}">
      <div class="hint">מה שלא מועבר נשאר בדיוק היכן שהוא נמצא היום.</div></div>
    ${pickerHTML('mqStation', 'לתחנה', itemsStations(), '', 'לא לשנות')}
    ${pickerHTML('mqHolder', 'אצל מי', itemsContacts(), '', 'לא לשנות — הקלד שם')}
    <div class="field"><label>תאריך</label><input id="mqDate" type="date" value="${today()}"></div>
    <div class="field"><label>הערה</label><input id="mqNote"></div>`;
  const m = modal({ title: 'העברת כמות', body,
    footer: `<button class="btn" data-ok>העבר</button><button class="btn ghost" data-no>ביטול</button>` });
  m.el.querySelector('[data-no]').onclick = m.close;
  wireCombos(m.el, [{ k: 'mqStation', type: 'combo', items: itemsStations },
                    { k: 'mqHolder',  type: 'combo', items: itemsContacts }]);
  m.el.querySelector('[data-ok]').onclick = async () => {
    const qty = Math.floor(N($('mqQty').value));
    if (!(qty > 0)) return toast('יש להזין כמות להעברה', 'err');
    if (qty > g.qty) return toast(`במיקום הזה יש ${g.qty} יחידות בלבד`, 'err');
    const station_id = $('f_mqStation').value;
    const holder_id  = $('f_mqHolder').value;
    if (!station_id && !holder_id) return toast('יש לבחור תחנה או מחזיק', 'err');
    try {
      const r = await Store.track.moveQty({
        purchase_id: purchaseId, qty,
        from_station_id: g.station_id, from_holder_id: g.holder_id,
        station_id, holder_id, date: $('mqDate').value, note: $('mqNote').value });
      if (!r.moved) return toast('היחידות כבר נמצאות בדיוק שם', 'err');
      toast(`הועברו ${r.moved} יחידות`, 'ok');
      m.close(); render();
    } catch (e) { toast(e.message, 'err'); }
  };
}

// ---------- גריד יריעות לספר, בסגנון אקסל ----------
// כל שינוי נשמר מיד ונרשם ביומן התנועות. הניווט במקלדת:
// Enter — שומר ויורד שורה · ↑/↓ — מעבר שורה באותה עמודה · ⇓ — העתקה למטה.
const SHEETGRID = { scrollId: '' };

async function trackSheets() {
  const scrolls = C.scrolls;
  if (!SHEETGRID.scrollId && scrolls.length) SHEETGRID.scrollId = scrolls[0].id;

  $('view').innerHTML += `
    <div class="card">
      <div class="row" style="align-items:flex-end">
        <div style="max-width:460px;flex:1">${pickerHTML('sgScroll', 'בחר ספר', itemsScrolls(), SHEETGRID.scrollId, 'הקלד מק"ט או שם…')}</div>
        <div id="sgInfo" class="mini" style="padding-bottom:10px"></div>
      </div>
    </div>
    <div id="sgBody"><div class="card muted">טוען…</div></div>`;
  wirePicker('sgScroll', itemsScrolls(), (v) => { if (v) { SHEETGRID.scrollId = +v; render(); } });
  if (!SHEETGRID.scrollId) { $('sgBody').innerHTML = '<div class="card empty">אין ספרים במערכת</div>'; return; }

  const scroll = scrolls.find(s => s.id === +SHEETGRID.scrollId) || {};
  const rows = await Store.track.list({ scroll_id: SHEETGRID.scrollId });
  const expected = N(scroll.sheets_count) || N(scroll.product_sheets_count) || N(scroll.product_parchment_units) || 0;

  $('sgInfo').innerHTML = rows.length
    ? `<span>${rows.length} יריעות${expected && expected !== rows.length
        ? ` · <b class="neg">מוגדרות ${expected} במוצר</b>` : ''}</span>
       ${ME.caps.edit ? `<button class="btn ghost sm" id="sgManage" style="margin-right:10px">⚙ מספר יריעות</button>` : ''}
       ${ME.caps.edit && expected > rows.length
         ? `<button class="btn sm" id="sgTopUp" style="margin-right:6px">➕ השלם ל-${expected}</button>` : ''}`
    : '';

  if (!rows.length) {
    $('sgBody').innerHTML = `
      <div class="card"><div class="empty">
        <div class="big">📄</div>
        עדיין לא נוצרו יריעות לספר הזה.
        <div style="margin-top:14px">
          <input id="sgCount" type="number" min="1" max="2000" value="${expected || ''}"
                 placeholder="מספר יריעות" style="width:130px;padding:9px;border:1px solid var(--line);border-radius:9px">
          <button class="btn" id="sgCreate">צור יריעות</button>
        </div>
        ${expected ? `<div class="mini" style="margin-top:8px">לפי המוצר: ${expected} יריעות</div>` : ''}
      </div></div>`;
    $('sgCreate').onclick = async () => {
      try {
        const r = await Store.track.generate({ scroll_id: SHEETGRID.scrollId, count: $('sgCount').value || undefined });
        toast(`נוצרו ${r.created} יריעות`, 'ok');
        await reloadCaches(); render();
      } catch (e) { toast(e.message, 'err'); }
    };
    return;
  }

  // רשימת מחזיקים לרשימת ההשלמה — תוויות ייחודיות, אחרת שני שמות זהים
  // היו ממופים לאותו אדם
  const seen = {};
  const holderOpts = C.contacts.map(c => {
    let label = contactName(c);
    if (seen[label]) label = `${label} (${c.id})`;
    seen[label] = true;
    return { id: c.id, label };
  });
  const labelById = new Map(holderOpts.map(h => [h.id, h.label]));
  const idByLabel = new Map(holderOpts.map(h => [h.label, h.id]));

  const stationSel = (r) => `<select class="g-cell" data-col="station" data-id="${r.id}">
      <option value="">—</option>
      ${C.stations.map(s => `<option value="${s.id}" ${+r.station_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
    </select>`;
  const holderInp = (r) => `<input class="g-cell g-holder" data-col="holder" data-id="${r.id}"
      list="sgHolders" autocomplete="off" placeholder="—"
      value="${esc(r.holder_id ? (labelById.get(r.holder_id) || r.holder_name || '') : '')}">`;

  $('sgBody').innerHTML = `
    <datalist id="sgHolders">${holderOpts.map(h => `<option value="${esc(h.label)}"></option>`).join('')}</datalist>
    <div class="card">
      <div class="mini" style="margin-bottom:8px">
        💡 <b>Enter</b> שומר ויורד שורה · <b>↑ ↓</b> מעבר בין שורות · <b>⇓</b> מעתיק את השורה לכל השורות שמתחת
      </div>
      <div class="table-wrap"><table class="grid-tbl"><thead><tr>
        <th style="width:60px">יריעה</th>
        <th style="width:180px">תחנה</th>
        <th style="width:220px">אצל מי</th>
        <th style="width:110px">מתאריך</th>
        <th style="width:60px">ימים</th>
        <th>הערה</th>
        <th style="width:90px"></th>
      </tr></thead><tbody>
        ${rows.map(r => `<tr data-row="${r.id}">
          <td><b>${r.seq}</b></td>
          <td>${stationSel(r)}</td>
          <td>${holderInp(r)}</td>
          <td class="mini" data-since="${r.id}">${r.since ? dt(r.since) : ''}</td>
          <td class="num mini" data-days="${r.id}">${r.days_at_station != null
              ? `<span class="${r.days_at_station > 60 ? 'neg' : ''}">${r.days_at_station}</span>` : ''}</td>
          <td><input class="g-cell g-note" data-col="note" data-id="${r.id}" value="${esc(r.note || '')}" placeholder="—"></td>
          <td class="center" style="white-space:nowrap">
            <button class="btn ghost xs" data-fill="${r.id}" title="העתק לכל השורות מתחת">⇓</button>
            <button class="btn ghost xs" data-reset="${r.id}" title="אפס שורה (מנקה תחנה ומחזיק)">↺</button>
            <button class="btn ghost xs" data-hist="${r.id}" title="היסטוריית תחנות">🕘</button>
            ${ME.caps.del ? `<button class="btn ghost xs" data-del="${r.id}" title="מחק יריעה">🗑</button>` : ''}
            <span class="g-status" data-st="${r.id}"></span>
          </td>
        </tr>`).join('')}
      </tbody></table></div>
    </div>`;

  const byId = new Map(rows.map(r => [r.id, r]));
  const status = (id, txt, cls) => {
    const el = document.querySelector(`[data-st="${id}"]`);
    if (!el) return;
    el.textContent = txt; el.className = 'g-status ' + (cls || '');
    if (txt === '✓') setTimeout(() => { if (el.textContent === '✓') el.textContent = ''; }, 1500);
  };

  // שמירת שורה — משדר רק את מה שהשתנה, כדי שיומן התנועות ישקף שינוי אמיתי
  async function saveRow(id) {
    const tr = document.querySelector(`[data-row="${id}"]`);
    if (!tr) return;
    const cur = byId.get(id) || {};
    const stationVal = tr.querySelector('[data-col="station"]').value;
    const holderText = tr.querySelector('[data-col="holder"]').value.trim();
    const noteVal = tr.querySelector('[data-col="note"]').value;

    const newStation = stationVal === '' ? null : +stationVal;
    let newHolder = null;
    if (holderText !== '') {
      if (idByLabel.has(holderText)) newHolder = idByLabel.get(holderText);
      else { status(id, '✗ שם לא מוכר', 'err'); return; }
    }
    const stationChanged = (cur.station_id || null) !== newStation;
    const holderChanged  = (cur.holder_id  || null) !== newHolder;
    const noteChanged    = (cur.note || '') !== noteVal;
    if (!stationChanged && !holderChanged && !noteChanged) return;

    status(id, '⏳');
    try {
      if (stationChanged || holderChanged) {
        await Store.track.move({ ids: [id], station_id: newStation, holder_id: newHolder });
        cur.station_id = newStation; cur.holder_id = newHolder;
        const t = today();
        cur.since = t; cur.days_at_station = 0;
        const sc = document.querySelector(`[data-since="${id}"]`); if (sc) sc.textContent = dt(t);
        const dc = document.querySelector(`[data-days="${id}"]`); if (dc) dc.textContent = '0';
      }
      if (noteChanged) { await Store.track.update(id, { note: noteVal }); cur.note = noteVal; }
      status(id, '✓', 'ok');
    } catch (e) { status(id, '✗', 'err'); toast(e.message, 'err'); }
  }

  // ניווט מקלדת בין שורות באותה עמודה
  const cells = () => [...document.querySelectorAll('.g-cell')];
  function moveFocus(from, dir) {
    const all = cells().filter(c => c.dataset.col === from.dataset.col);
    const i = all.indexOf(from);
    const next = all[i + dir];
    if (next) { next.focus(); if (next.select) next.select(); }
  }

  document.querySelectorAll('.g-cell').forEach(el => {
    el.addEventListener('change', () => saveRow(+el.dataset.id));
    el.addEventListener('blur', () => saveRow(+el.dataset.id));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveRow(+el.dataset.id); moveFocus(el, 1); }
      // בתיבת בחירה החצים משנים ערך — שם מנווטים עם Alt
      else if (e.key === 'ArrowDown' && (el.tagName !== 'SELECT' || e.altKey)) { e.preventDefault(); moveFocus(el, 1); }
      else if (e.key === 'ArrowUp' && (el.tagName !== 'SELECT' || e.altKey)) { e.preventDefault(); moveFocus(el, -1); }
      else if (e.key === 'Escape') el.blur();
    });
  });

  // מילוי מהיר כלפי מטה
  document.querySelectorAll('[data-fill]').forEach(b => b.onclick = async () => {
    const id = +b.dataset.fill;
    const tr = document.querySelector(`[data-row="${id}"]`);
    const st = tr.querySelector('[data-col="station"]').value;
    const ho = tr.querySelector('[data-col="holder"]').value.trim();
    const idx = rows.findIndex(r => r.id === id);
    const below = rows.slice(idx + 1);
    if (!below.length) return toast('אין שורות מתחת', 'err');
    if (!(await confirmBox(`להעתיק את התחנה והמחזיק ל-${below.length} השורות שמתחת?`))) return;
    const stationVal = st === '' ? null : +st;
    let holderVal = null;
    if (ho !== '') {
      if (!idByLabel.has(ho)) return toast('שם המחזיק לא מוכר', 'err');
      holderVal = idByLabel.get(ho);
    }
    try {
      const ids = below.map(r => r.id);
      const r = await Store.track.move({ ids, station_id: stationVal, holder_id: holderVal });
      toast(`עודכנו ${r.moved} יריעות`, 'ok');
      render();
    } catch (e) { toast(e.message, 'err'); }
  });

  document.querySelectorAll('[data-hist]').forEach(b => b.onclick = () => showHistory(+b.dataset.hist));

  // איפוס שורה — מנקה תחנה ומחזיק, ונרשם ביומן כמו כל שינוי אחר
  document.querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => {
    const id = +b.dataset.reset;
    const cur = byId.get(id) || {};
    if (!cur.station_id && !cur.holder_id) return toast('השורה כבר ריקה', 'err');
    if (!(await confirmBox(`לאפס את יריעה ${cur.seq}? התחנה והמחזיק ינוקו (ההיסטוריה נשמרת)`))) return;
    status(id, '⏳');
    try {
      await Store.track.move({ ids: [id], station_id: null, holder_id: null });
      toast('השורה אופסה', 'ok');
      render();
    } catch (e) { status(id, '✗', 'err'); toast(e.message, 'err'); }
  });

  // מחיקת יריעה — לסל המחזור
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const id = +b.dataset.del;
    const cur = byId.get(id) || {};
    if (!(await confirmBox(`למחוק את יריעה ${cur.seq}? (ניתן לשחזר מסל המחזור)`))) return;
    try {
      await Store.track.remove(id);
      toast('היריעה הועברה לסל המחזור', 'ok');
      render();
    } catch (e) { toast(e.message, 'err'); }
  });

  // השלמה מהירה למספר שמוגדר במוצר
  if ($('sgTopUp')) $('sgTopUp').onclick = () => setSheetCount(expected);
  if ($('sgManage')) $('sgManage').onclick = () => openSheetCount(rows.length, expected);
}

// שינוי מספר היריעות של ספר — הוספה או צמצום
function openSheetCount(current, expected) {
  const m = modal({
    title: 'מספר היריעות של הספר',
    body: `<div class="kv" style="margin-bottom:14px">
        <div class="k">כרגע במעקב</div><div><b>${current}</b> יריעות</div>
        ${expected ? `<div class="k">מוגדר במוצר</div><div>${expected} יריעות</div>` : ''}
      </div>
      <div class="field"><label>מספר יריעות רצוי</label>
        <input id="scCount" type="number" min="0" max="2000" value="${expected || current}">
        <div class="hint">הגדלה תוסיף את היריעות החסרות ותשמור את הקיימות.
          הקטנה תמחק את היריעות שמעל המספר (ניתן לשחזר מסל המחזור).</div></div>`,
    footer: `<button class="btn" data-ok>עדכן</button><button class="btn ghost" data-no>ביטול</button>`,
  });
  m.el.querySelector('[data-no]').onclick = m.close;
  m.el.querySelector('[data-ok]').onclick = async () => {
    const target = parseInt($('scCount').value, 10);
    if (!Number.isInteger(target) || target < 0) return toast('מספר לא תקין', 'err');
    m.close();
    setSheetCount(target);
  };
}

async function setSheetCount(target) {
  const scrollId = SHEETGRID.scrollId;
  const rows = await Store.track.list({ scroll_id: scrollId });
  if (target > rows.length) {
    try {
      const r = await Store.track.generate({ scroll_id: scrollId, count: target });
      toast(`נוספו ${r.created} יריעות · סה"כ ${r.total}`, 'ok');
      render();
    } catch (e) { toast(e.message, 'err'); }
    return;
  }
  const extra = rows.filter(r => N(r.seq) > target);
  if (!extra.length) return toast('אין מה לשנות', 'ok');
  if (!(await confirmBox(`למחוק ${extra.length} יריעות (מספר ${target + 1} ומעלה)? ניתן לשחזר מסל המחזור`))) return;
  let done = 0;
  try {
    // מוחקים בקבוצות קטנות כדי לא להציף את השרת
    for (let i = 0; i < extra.length; i += 5) {
      await Promise.all(extra.slice(i, i + 5).map(x => Store.track.remove(x.id).then(() => done++)));
    }
    toast(`נמחקו ${done} יריעות`, 'ok');
  } catch (e) { toast(`נמחקו ${done}, ואז שגיאה: ${e.message}`, 'err'); }
  render();
}

// ---------- תחנות ----------
function trackStations(cfgOnly) {
  const cfg = {
    title: 'תחנות', bulk: 'stations', store: Store.stations,
    load: () => Store.stations.list(),
    labelOf: (r) => r.name,
    note: 'התחנות הן השלבים שיריעה עוברת ביניהם. אפשר להוסיף, לשנות שם, ולקבוע סדר תצוגה.',
    defaults: () => ({ sort: (C.stations.length || 0) * 10 }),
    fields: [
      { k: 'name', label: 'שם התחנה', type: 'text', required: true },
      { k: 'sort', label: 'סדר תצוגה', type: 'number' },
      { k: 'color', label: 'צבע (אופציונלי)', type: 'text', hint: 'למשל #e0f2fe' },
    ],
    cols: [
      { label: 'שם התחנה', render: r => stationPill({ station_name: r.name, station_color: r.color }) },
      { label: 'סדר', cls: 'num', render: r => numCell(r.sort) },
    ],
  };
  return cfgOnly ? cfg : entityPage(cfg);
}



// ============ מרחב עבודה לאיש קשר ============
// כל מה שקשור לאדם אחד במסך אחד — כסופר וכרוכש — עם פעולות שנפתחות
// כשהוא כבר משובץ בטופס. המטרה: לשבת על לקוח אחד ולעדכן הכל בלי
// לקפוץ בין לשוניות.
const WS = { id: '', open: {} };

function pageWorkspace() {
  const subs = [{ k: 'scribe', label: '🖊️ מרחב סופר' }];
  if (ME.caps.finance) subs.push({ k: 'customer', label: '🛒 מרחב לקוח' });
  if (!subs.find(s => s.k === SUB.workspace)) SUB.workspace = 'scribe';
  renderSubtabs('workspace', subs);
  const mode = SUB.workspace;
  const isScribe = mode === 'scribe';

  $('view').innerHTML += `
    <div class="card">
      <div style="max-width:460px">${pickerHTML('wsPerson',
        isScribe ? 'בחר סופר' : 'בחר לקוח', itemsContacts(), WS.id, 'הקלד שם…')}</div>
      <div class="mini" style="margin-top:8px">${isScribe
        ? 'כל מה שקשור לסופר: הספרים שהוא כותב, התשלומים אליו, ההתקדמות, ההוצאות והיריעות שאצלו.'
        : 'כל מה שקשור ללקוח: הספרים שרכש, תשלומיו, והמכירות אליו.'}</div>
    </div>
    <div id="wsBody"></div>`;
  wirePicker('wsPerson', itemsContacts(), (v) => { WS.id = v; render(); });
  if (!WS.id) {
    $('wsBody').innerHTML = `<div class="card"><div class="empty">
      <div class="big">${isScribe ? '🖊️' : '🛒'}</div>
      בחר ${isScribe ? 'סופר' : 'לקוח'} כדי לראות ולעדכן את כל מה שקשור אליו</div></div>`;
    return;
  }
  return isScribe ? loadScribeSpace(+WS.id) : loadCustomerSpace(+WS.id);
}

// כותרת אישית משותפת לשני המרחבים, עם מעבר מהיר לצד השני כשיש בו פעילות
function wsHeader(person, color, badge, otherMode, otherHasData) {
  return `
    <div class="card" style="background:linear-gradient(135deg,${color});color:#fff;border:none">
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <div style="font-size:24px;font-weight:800">${esc(person.name || '')}</div>
        ${person.phone ? `<a href="tel:${esc(person.phone)}" style="color:#e6fffa">${esc(person.phone)}</a>` : ''}
        <span class="pill" style="background:#fff;color:#0f172a">${badge}</span>
        <div style="flex:1"></div>
        ${otherHasData ? `<button class="btn ghost sm" id="wsSwitch">
          ${otherMode === 'customer' ? '🛒 יש לו גם פעילות כלקוח' : '🖊️ הוא גם סופר'} ←</button>` : ''}
      </div>
    </div>`;
}

const wsCard = (label, val, cls, sub) => `<div class="stat"><div class="label">${label}</div>
  <div class="value ${cls || ''}">${val}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;

// כפתור פעולה שפותח טופס כשהאדם כבר משובץ בו
const wsAct = (label, icon, cfgKey, prefill) =>
  `<button class="btn ghost sm" data-wsact='${esc(JSON.stringify(prefill))}' data-cfg="${cfgKey}">${icon} ${esc(label)}</button>`;

const WS_CFGS = () => ({
  scribePayCfg, pagesLogCfg, scrollCfg,
  bookExpCfg: () => pageBookExp(true),
  parchExpCfg: () => pageParchExp(true),
  custPayCfg: () => pageCustPay(true),
  prodPurchaseCfg: () => prodPurchases(true),
  prodSaleCfg: () => prodSales(true),
  prodScribePayCfg: () => prodScribePay(true),
  prodCustPayCfg: () => prodCustPay(true),
});

// סעיף מתקפל
function wsSec(key, title, count, html) {
  return `<div class="card">
    <div class="page-head" style="margin-bottom:0;cursor:pointer" data-sec="${key}">
      <h3 style="margin:0">${title} ${count ? `<span class="pill n">${count}</span>` : '<span class="mini">ריק</span>'}</h3>
      <div class="spacer"></div><span class="mini">${WS.open[key] === false ? '▸ הצג' : '▾ הסתר'}</span>
    </div>
    <div ${WS.open[key] === false ? 'class="hidden"' : ''} style="margin-top:12px">${html}</div>
  </div>`;
}

function wsWire(otherMode) {
  const CFGS = WS_CFGS();
  document.querySelectorAll('[data-wsact]').forEach(b => b.onclick = () => {
    const fn = CFGS[b.dataset.cfg];
    if (!fn) return toast('טופס לא נמצא', 'err');
    openForm(fn(), null, JSON.parse(b.dataset.wsact));
  });
  document.querySelectorAll('[data-sec]').forEach(h => h.onclick = () => {
    const k = h.dataset.sec; WS.open[k] = WS.open[k] === false; render();
  });
  document.querySelectorAll('[data-book]').forEach(b => b.onclick = () => showScrollCard(+b.dataset.book));
  document.querySelectorAll('[data-hist]').forEach(b => b.onclick = () => showHistory(+b.dataset.hist));
  if ($('wsSwitch')) $('wsSwitch').onclick = () => { SUB.workspace = otherMode; render(); };
}

const wsScrollCol = { label: 'ספר', render: r => { const s = C.scrolls.find(x => x.id === +r.scroll_id); return s ? esc(scrollLabel(s)) : '—'; } };

// ---------- מרחב סופר ----------
async function loadScribeSpace(id) {
  $('wsBody').innerHTML = '<div class="card muted">טוען…</div>';
  let d, sheets, pays, pages, bookExp, parchExp, alsoCustomer = false;
  try {
    const [rep, sh, p1, p2, p3, p4] = await Promise.all([
      Store.reports.scribe(id),
      Store.track.list({ holder_id: id }).catch(() => []),
      Store.scribePayments.list(), Store.pagesLog.list(),
      Store.bookExpenses.list(), Store.parchmentExpenses.list(),
    ]);
    d = rep; sheets = sh;
    const mine = new Set(d.scrolls.map(s => s.id));
    const only = (arr) => arr.filter(r => mine.has(+r.scroll_id));
    pays = only(p1); pages = only(p2); bookExp = only(p3); parchExp = only(p4);
    if (ME.caps.finance) {
      const c = await Store.reports.customer(id).catch(() => null);
      alsoCustomer = !!(c && (c.scrolls.length || c.sales.length));
    }
  } catch (e) {
    $('wsBody').innerHTML = `<div class="card" style="color:var(--red)">${esc(e.message)}</div>`;
    return;
  }
  const st = d.scroll_totals, pt = d.product_totals;
  const openBooks = d.scrolls.filter(s => s.status !== 'done').length;

  $('wsBody').innerHTML = `
    ${wsHeader(d.contact, '#0f766e,#115e59', 'סופר', 'customer', alsoCustomer)}

    <div class="grid stat-grid">
      ${wsCard('סה"כ חוב לסופר', money(d.total_balance), d.total_balance > 0 ? 'r' : '',
        `ס"ת ${money(st.balance)} · מוצרים ${money(pt.balance)}`)}
      ${wsCard('יתרה עתידית (ס"ת)', money(st.future_balance), 'a', 'על מה שטרם נכתב')}
      ${wsCard('ספרים', st.count, 'b', `${openBooks} פעילים`)}
      ${wsCard('שולם לו', money(N(st.paid) + N(pt.paid)), 'g', `תיקונים ${money(st.corrections)}`)}
      ${wsCard('יריעות אצלו', sheets.length, sheets.length ? 'b' : '')}
    </div>

    <div class="card"><h3>פעולות</h3><div class="toolbar">
      ${wsAct('תשלום לסופר', '💰', 'scribePayCfg', { _scribe: id })}
      ${wsAct('רישום עמודים', '✍️', 'pagesLogCfg', { _scribe: id })}
      ${wsAct('הוצאה לספר', '🧾', 'bookExpCfg', { _scribe: id })}
      ${wsAct('הוצאת קלף', '📜', 'parchExpCfg', { _scribe: id })}
      ${ME.caps.finance ? wsAct('ספר חדש', '📖', 'scrollCfg', { scribe_id: id }) : ''}
      ${wsAct('רכישה ממנו', '📦', 'prodPurchaseCfg', { scribe_id: id })}
      ${wsAct('תשלום (מוצרים)', '💰', 'prodScribePayCfg', { scribe_id: id })}
    </div></div>

    ${d.scrolls.length ? wsSec('books', 'הספרים שהוא כותב', d.scrolls.length, tableHTML([
      skuCol,
      { label: 'מוצר', render: r => esc(r.product_name || '—') },
      { label: 'התקדמות', render: r => `<div class="bar ${r.progress_pct < 100 ? 'warn' : ''}"><span style="width:${Math.min(100, r.progress_pct)}%"></span></div>
          <span class="mini">${r.pages_written}/${r.product_pages}</span>` },
      { label: 'מחיר לעמוד', cls: 'num', render: r => mCell(r.page_rate) },
      { label: 'מגיע לפי התקדמות', cls: 'num', render: r => mCell(r.scribe_due_progress), total: rs => mCell(sumBy(rs, 'scribe_due_progress')) },
      { label: 'שולם', cls: 'num', render: r => mCell(r.scribe_paid), total: rs => mCell(sumBy(rs, 'scribe_paid')) },
      { label: 'תיקונים', cls: 'num', render: r => mCell(r.corrections_paid), total: rs => mCell(sumBy(rs, 'corrections_paid')) },
      { label: 'יתרה', cls: 'num', render: r => `<b>${mCell(r.scribe_balance)}</b>`, total: rs => `<b>${mCell(sumBy(rs, 'scribe_balance'))}</b>` },
      { label: 'עתידי', cls: 'num', render: r => mCell(r.scribe_future_balance), total: rs => mCell(sumBy(rs, 'scribe_future_balance')) },
      { label: '', cls: 'center', render: r => `<button class="btn ghost xs" data-book="${r.id}">כרטיס</button>` },
    ], d.scrolls, { totals: true })) : ''}

    ${wsSec('pays', 'תשלומים ששולמו לו (ס"ת)', pays.length, tableHTML([
      wsScrollCol,
      { label: 'תאריך', render: r => dt(r.date) },
      { label: 'סכום', cls: 'num', render: r => mCell(r.amount), total: rs => mCell(sumBy(rs, 'amount')) },
      { label: 'הערה', cls: 'wrap', render: r => esc(r.note || '') },
    ], pays, { totals: true }))}

    ${wsSec('pages', 'עמודים שכתב', pages.length, tableHTML([
      wsScrollCol,
      { label: 'תאריך', render: r => dt(r.date) },
      { label: 'עמודים', cls: 'num', render: r => numCell(r.pages), total: rs => numCell(sumBy(rs, 'pages')) },
      { label: 'הערה', cls: 'wrap', render: r => esc(r.note || '') },
    ], pages, { totals: true }))}

    ${wsSec('exp', 'הוצאות על הספרים שלו', bookExp.length + parchExp.length, tableHTML([
      wsScrollCol,
      { label: 'תאריך', render: r => dt(r.date) },
      { label: 'סוג', render: r => esc(r.type || ('קלף · ' + (r.size_name || ''))) + (r.is_correction ? ' <span class="pill a">תיקונים</span>' : '') },
      { label: 'סכום', cls: 'num', render: r => mCell(r.amount !== undefined ? r.amount : r.total_cost),
        total: rs => mCell(rs.reduce((a, x) => a + N(x.amount !== undefined ? x.amount : x.total_cost), 0)) },
    ], bookExp.concat(parchExp), { totals: true }))}

    ${sheets.length ? wsSec('sheets', 'יריעות שנמצאות אצלו', sheets.length, tableHTML([
      { label: 'שייך ל', render: r => esc(itemLabel(r)) },
      { label: 'יריעה', cls: 'num', render: r => `<b>${r.seq}</b>` },
      { label: 'תחנה', render: r => stationPill(r) },
      { label: 'מתאריך', render: r => r.since ? dt(r.since) : '' },
      { label: 'ימים', cls: 'num', render: r => r.days_at_station != null
          ? `<span class="${r.days_at_station > 60 ? 'neg' : ''}">${r.days_at_station}</span>` : '' },
      { label: '', cls: 'center', render: r => `<button class="btn ghost xs" data-hist="${r.id}">🕘</button>` },
    ], sheets)) : ''}

    ${d.purchases.length ? wsSec('purch', 'רכישות מוצרים ממנו', d.purchases.length, tableHTML([
      { label: 'תאריך', render: r => dt(r.date) },
      { label: 'מוצר', render: r => esc(r.product_name || '—') },
      { label: 'כמות', cls: 'num', render: r => numCell(r.quantity) },
      { label: 'נשאר', cls: 'num', render: r => numCell(r.remaining_qty) },
      { label: "עלות ליח'", cls: 'num', render: r => mCell(r.cost_per_unit) },
      { label: 'חוב', cls: 'num', render: r => mCell(r.owed), total: rs => mCell(sumBy(rs, 'owed')) },
    ], d.purchases, { totals: true })) : ''}

    ${d.product_payments.length ? wsSec('ppay', 'תשלומים לו (מוצרים)', d.product_payments.length, tableHTML([
      { label: 'תאריך', render: r => dt(r.date) },
      { label: 'סכום', cls: 'num', render: r => mCell(r.amount), total: rs => mCell(sumBy(rs, 'amount')) },
      { label: 'הערה', cls: 'wrap', render: r => esc(r.note || '') },
    ], d.product_payments, { totals: true })) : ''}`;

  wsWire('customer');
}

// ---------- מרחב לקוח ----------
async function loadCustomerSpace(id) {
  $('wsBody').innerHTML = '<div class="card muted">טוען…</div>';
  let d, alsoScribe = false;
  try {
    const [rep, sc] = await Promise.all([
      Store.reports.customer(id),
      Store.reports.scribe(id).catch(() => null),
    ]);
    d = rep;
    alsoScribe = !!(sc && (sc.scrolls.length || sc.purchases.length));
  } catch (e) {
    $('wsBody').innerHTML = `<div class="card" style="color:var(--red)">${esc(e.message)}</div>`;
    return;
  }
  const ct = d.scroll_totals, pt = d.product_totals;

  $('wsBody').innerHTML = `
    ${wsHeader(d.contact, '#c98a2e,#a1701f', 'לקוח', 'scribe', alsoScribe)}

    <div class="grid stat-grid">
      ${wsCard('חוב מיידי', money(d.total_due_now), d.total_due_now > 0 ? 'r' : 'g', 'לפי התקדמות הכתיבה')}
      ${wsCard('חוב כללי', money(d.total_due_overall), 'a', 'כולל מה שטרם נכתב')}
      ${wsCard('שילם', money(N(ct.paid) + N(pt.paid)), 'g')}
      ${wsCard('ספרים שרכש', ct.count, 'b', `שווי ${money(ct.total_price)}`)}
      ${wsCard('עלות פריטה', money(N(ct.peritah) + N(pt.peritah)))}
    </div>

    <div class="card"><h3>פעולות</h3><div class="toolbar">
      ${wsAct('תשלום לקוח', '💵', 'custPayCfg', { customer_id: id })}
      ${wsAct('מכירה לו', '🛒', 'prodSaleCfg', { customer_id: id })}
      ${wsAct('תשלום לקוח (מוצרים)', '💵', 'prodCustPayCfg', { customer_id: id })}
      ${wsAct('ספר חדש עבורו', '📖', 'scrollCfg', { customer_id: id })}
    </div></div>

    ${d.scrolls.length ? wsSec('cbooks', 'ספרים שרכש', d.scrolls.length, tableHTML([
      skuCol,
      { label: 'מוצר', render: r => esc(r.product_name || '—') },
      { label: 'סופר', render: r => esc(r.scribe_name || '—') },
      { label: 'התקדמות', render: r => `<div class="bar ${r.progress_pct < 100 ? 'warn' : ''}"><span style="width:${Math.min(100, r.progress_pct)}%"></span></div>
          <span class="mini">${r.pages_written}/${r.product_pages}</span>` },
      { label: 'מחיר', cls: 'num', render: r => mCell(r.buyer_total, r.buyer_currency), total: rs => mCell(sumBy(rs, 'buyer_total')) },
      { label: 'לפי התקדמות', cls: 'num', render: r => mCell(r.buyer_due_progress), total: rs => mCell(sumBy(rs, 'buyer_due_progress')) },
      { label: 'שילם', cls: 'num', render: r => mCell(r.customer_paid), total: rs => mCell(sumBy(rs, 'customer_paid')) },
      { label: 'יתרה מיידית', cls: 'num', render: r => `<b>${mCell(r.buyer_balance_now)}</b>`, total: rs => `<b>${mCell(sumBy(rs, 'buyer_balance_now'))}</b>` },
      { label: 'יתרה כללית', cls: 'num', render: r => mCell(r.buyer_balance_total), total: rs => mCell(sumBy(rs, 'buyer_balance_total')) },
      { label: '', cls: 'center', render: r => `<button class="btn ghost xs" data-book="${r.id}">כרטיס</button>` },
    ], d.scrolls, { totals: true })) : ''}

    ${wsSec('cpays', 'תשלומיו (ס"ת)', d.scroll_payments.length, tableHTML([
      wsScrollCol,
      { label: 'תאריך', render: r => dt(r.date) },
      { label: '₪', cls: 'num', render: r => mCell(r.amount_ils), total: rs => mCell(sumBy(rs, 'amount_ils')) },
      { label: '$', cls: 'num', render: r => numCell(r.amount_usd) },
      { label: 'שער', cls: 'num', render: r => r.rate ? numCell(r.rate) : '' },
      { label: 'פריטה', cls: 'num', render: r => mCell(r.peritah), total: rs => mCell(sumBy(rs, 'peritah')) },
      { label: 'שולם בפועל', cls: 'num', render: r => mCell(r.paid_actual), total: rs => mCell(sumBy(rs, 'paid_actual')) },
    ], d.scroll_payments, { totals: true }))}

    ${wsSec('sales', 'מכירות מוצרים לו', d.sales.length, tableHTML([
      { label: 'תאריך', render: r => dt(r.date) },
      { label: 'מוצר', render: r => esc(r.product_name || '—') },
      { label: 'כמות', cls: 'num', render: r => numCell(r.quantity), total: rs => numCell(sumBy(rs, 'quantity')) },
      { label: "מחיר ליח'", cls: 'num', render: r => mCell(r.price_per_unit) },
      { label: 'סך מכירה', cls: 'num', render: r => mCell(r.total_sale), total: rs => mCell(sumBy(rs, 'total_sale')) },
    ], d.sales, { totals: true }))}

    ${wsSec('cppays', 'תשלומיו (מוצרים)', d.product_payments.length, tableHTML([
      { label: 'תאריך', render: r => dt(r.date) },
      { label: '₪', cls: 'num', render: r => mCell(r.amount_ils), total: rs => mCell(sumBy(rs, 'amount_ils')) },
      { label: '$', cls: 'num', render: r => numCell(r.amount_usd) },
      { label: 'פריטה', cls: 'num', render: r => mCell(r.peritah), total: rs => mCell(sumBy(rs, 'peritah')) },
      { label: 'ס"ה שולם', cls: 'num', render: r => mCell(r.paid_actual), total: rs => mCell(sumBy(rs, 'paid_actual')) },
    ], d.product_payments, { totals: true }))}`;

  wsWire('scribe');
}


// ============ הוספה מהירה ============
// כפתור צף שפותח כל טופס הזנה מכל מסך במערכת, בלי לנווט ללשונית.
// ההגדרות נלקחות מאותן פונקציות שמזינות את המסכים עצמם, כדי שלא
// ייווצרו שני טפסים שונים לאותה רשומה.
const QUICK_ADD = [
  { icon: '📖', label: 'ספר חדש (ס"ת)',      cap: 'finance', cfg: () => scrollCfg() },
  { icon: '💰', label: 'תשלום לסופר',        cfg: () => scribePayCfg() },
  { icon: '✍️', label: 'רישום עמודים',       cfg: () => pagesLogCfg() },
  { icon: '💵', label: 'תשלום לקוח',         cap: 'finance', cfg: () => pageCustPay(true) },
  { icon: '🧾', label: 'הוצאה לספר',         cfg: () => pageBookExp(true) },
  { icon: '📜', label: 'הוצאת קלף',          cfg: () => pageParchExp(true) },
  { icon: '🏢', label: 'הוצאת עסק',          cap: 'finance', cfg: () => pageBizExp(true) },
  { sep: true },
  { icon: '📦', label: 'רכישת מוצרים',       cfg: () => prodPurchases(true) },
  { icon: '🛒', label: 'מכירת מוצרים',       cfg: () => prodSales(true) },
  { icon: '💰', label: 'תשלום לסופר (מוצרים)', cfg: () => prodScribePay(true) },
  { icon: '💵', label: 'תשלום לקוח (מוצרים)',  cap: 'finance', cfg: () => prodCustPay(true) },
  { sep: true },
  { icon: '👤', label: 'איש קשר',            cfg: () => setContacts(true) },
  { icon: '🏷️', label: 'מוצר',               cfg: () => setProducts(true) },
  { icon: '📐', label: 'גודל קלף',           cfg: () => setSizes(true) },
  { icon: '📍', label: 'תחנה',               cfg: () => trackStations(true) },
];

function quickAddItems() {
  return QUICK_ADD.filter(x => x.sep || !x.cap || (ME.caps && ME.caps[x.cap]));
}

function renderQuickAdd() {
  const old = $('quickAdd'); if (old) old.remove();
  if (!ME.caps.edit) return;
  const items = quickAddItems();
  const el = document.createElement('div');
  el.id = 'quickAdd';
  el.innerHTML = `
    <div class="qa-menu hidden" id="qaMenu">
      <div class="qa-head">הוספה מהירה</div>
      ${items.map((x, i) => x.sep ? '<div class="qa-sep"></div>'
        : `<button data-qa="${i}"><span class="qa-ico">${x.icon}</span>${esc(x.label)}</button>`).join('')}
    </div>
    <button class="qa-fab" id="qaFab" title="הוספה מהירה">+</button>`;
  document.body.appendChild(el);

  const menu = $('qaMenu');
  $('qaFab').onclick = (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); };
  el.querySelectorAll('[data-qa]').forEach(b => {
    b.onclick = (e) => {
      e.stopPropagation();
      menu.classList.add('hidden');
      const item = items[+b.dataset.qa];
      try {
        const cfg = item.cfg();
        openForm(cfg, null);
      } catch (err) { toast('פתיחת הטופס נכשלה: ' + err.message, 'err'); }
    };
  });
  document.addEventListener('click', () => menu.classList.add('hidden'));
}

// ============ ניווט ============
const TABS = [
  { k: 'dash', label: 'דשבורד', fn: pageDash, cap: 'viewReports' },
  { k: 'workspace', label: '🧑 מרחב עבודה', fn: pageWorkspace },
  { k: 'scrolls', label: 'ס"ת', fn: pageScrolls, cap: 'finance' },
  { k: 'scribepay', label: 'תשלום לסופר', fn: pageScribePay },
  { k: 'custpay', label: 'תשלומי לקוחות', fn: pageCustPay, cap: 'finance' },
  { k: 'bookexp', label: 'הוצאות לספר', fn: pageBookExp },
  { k: 'parchexp', label: 'הוצאות קלף', fn: pageParchExp },
  { k: 'bizexp', label: 'הוצאות עסק', fn: pageBizExp, cap: 'finance' },
  { k: 'prod', label: 'מוצרים', fn: pageProd },
  { k: 'track', label: '📍 מעקב יריעות ומוצרים', fn: pageTrack },
  { k: 'reports', label: 'דוחות', fn: pageReports, cap: 'scribeReport' },
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
  const allowed = visibleTabs();
  let tab = allowed.find(t => t.k === TAB);
  if (!tab) { tab = allowed[0]; TAB = tab.k; renderTabs(); }
  destroyCharts();          // גרפים ישנים מחזיקים קנבס שנמחק — חובה לשחרר
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
  wireExport();
  // מי שאין לו דשבורד ייפתח על הלשונית הראשונה שמותרת לו
  if (!(user.caps && user.caps.viewReports)) TAB = 'scribepay';
  $('userName').textContent = user.full_name || user.username;
  $('userRole').textContent = (user.caps && user.caps.label) || '';
  $('loginScreen').classList.add('hidden');
  $('app').classList.remove('hidden');
  await reloadCaches();
  renderQuickAdd();
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
