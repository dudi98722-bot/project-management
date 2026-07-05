// ── Storage ──────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'fashionstock_products';
const ACTIVITY_KEY = 'fashionstock_activity';

function loadProducts() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveProducts(products) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
}

function loadActivity() {
  try { return JSON.parse(localStorage.getItem(ACTIVITY_KEY)) || []; }
  catch { return []; }
}

function logActivity(msg, icon = '📝') {
  const log = loadActivity();
  log.unshift({ msg, icon, time: new Date().toLocaleTimeString('he-IL') });
  if (log.length > 20) log.pop();
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(log));
}

// ── Seed Data ─────────────────────────────────────────────────────────────────
function seedIfEmpty() {
  if (loadProducts().length > 0) return;
  const demo = [
    { id: 1, name: 'חולצת פולו לבנה', category: 'חולצות', price: 89, stock: 23, size: 'M', color: 'לבן', supplier: 'טקסטיל ישראל', threshold: 5 },
    { id: 2, name: 'ג\'ינס סקיני כחול', category: 'מכנסיים', price: 199, stock: 4, size: '32', color: 'כחול', supplier: 'דנים פרו', threshold: 5 },
    { id: 3, name: 'שמלת קיץ פרחונית', category: 'שמלות', price: 149, stock: 0, size: 'S', color: 'ורוד', supplier: 'סאמר קולקשן', threshold: 5 },
    { id: 4, name: 'מעיל חורף אפור', category: 'עליוניות', price: 349, stock: 12, size: 'L', color: 'אפור', supplier: 'ווינטר ווור', threshold: 3 },
    { id: 5, name: 'נעלי ספורט לבנות', category: 'הנעלה', price: 259, stock: 8, size: '42', color: 'לבן', supplier: 'ספורטליין', threshold: 5 },
    { id: 6, name: 'חגורת עור שחורה', category: 'אביזרים', price: 79, stock: 3, size: '', color: 'שחור', supplier: 'לדר האוס', threshold: 5 },
    { id: 7, name: 'טישרט שחור בייסיק', category: 'חולצות', price: 59, stock: 45, size: 'XL', color: 'שחור', supplier: 'טקסטיל ישראל', threshold: 8 },
    { id: 8, name: 'מכנסי טרנינג כחול', category: 'מכנסיים', price: 119, stock: 2, size: 'M', color: 'כחול כהה', supplier: 'ספורטליין', threshold: 5 },
  ];
  saveProducts(demo);
  logActivity('מערכת אותחלה עם נתוני דוגמה', '🚀');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getStatus(product) {
  if (product.stock === 0) return 'out';
  if (product.stock <= product.threshold) return 'low';
  return 'ok';
}

function statusLabel(s) {
  return { ok: 'תקין', low: 'מלאי נמוך', out: 'אזל' }[s];
}

function statusClass(s) {
  return 'status-badge status-' + s;
}

let nextId = () => Date.now();

// ── Navigation ────────────────────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById('page-' + name);
  if (page) page.classList.add('active');
  const navItem = document.querySelector(`.nav-item[data-page="${name}"]`);
  if (navItem) navItem.classList.add('active');
  const titles = {
    dashboard: 'לוח בקרה', products: 'מוצרים',
    'add-product': 'הוספת מוצר', categories: 'קטגוריות', alerts: 'התראות'
  };
  document.getElementById('page-title').textContent = titles[name] || '';
  if (name === 'dashboard') renderDashboard();
  if (name === 'products') renderProducts();
  if (name === 'categories') renderCategories();
  if (name === 'alerts') renderAlerts();
  if (name === 'add-product' && !document.getElementById('edit-id').value) resetForm();
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    showPage(item.dataset.page);
  });
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
function renderDashboard() {
  const products = loadProducts();
  const total = products.length;
  const value = products.reduce((s, p) => s + p.price * p.stock, 0);
  const low   = products.filter(p => getStatus(p) === 'low').length;
  const out   = products.filter(p => getStatus(p) === 'out').length;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-value').textContent = '₪' + value.toLocaleString('he-IL');
  document.getElementById('stat-low').textContent = low;
  document.getElementById('stat-out').textContent = out;

  // Low stock table
  const lowItems = products.filter(p => getStatus(p) !== 'ok');
  const tbody = document.getElementById('low-stock-table');
  tbody.innerHTML = lowItems.length
    ? lowItems.map(p => `
        <tr>
          <td>${p.name}</td>
          <td>${p.category}</td>
          <td>${p.stock}</td>
          <td><span class="${statusClass(getStatus(p))}">${statusLabel(getStatus(p))}</span></td>
        </tr>`).join('')
    : '<tr><td colspan="4" style="text-align:center;color:#aaa;padding:20px">אין מוצרים עם מלאי נמוך 🎉</td></tr>';

  // Category chart
  const cats = {};
  const catColors = { חולצות:'#5b6af7', מכנסיים:'#27ae60', שמלות:'#e91e8c', עליוניות:'#e67e22', הנעלה:'#16a085', אביזרים:'#8e44ad' };
  products.forEach(p => { cats[p.category] = (cats[p.category] || 0) + 1; });
  const maxCat = Math.max(...Object.values(cats), 1);
  document.getElementById('category-chart').innerHTML = Object.entries(cats).map(([cat, cnt]) => `
    <div class="chart-bar-row">
      <div class="chart-label">${cat}</div>
      <div class="chart-bar-bg">
        <div class="chart-bar-fill" style="width:${(cnt/maxCat)*100}%;background:${catColors[cat]||'#5b6af7'}"></div>
      </div>
      <div class="chart-count">${cnt}</div>
    </div>`).join('') || '<p style="color:#aaa;text-align:center;padding:20px">אין נתונים</p>';

  // Activity
  const activity = loadActivity();
  document.getElementById('activity-log').innerHTML = activity.length
    ? activity.map(a => `
        <li>${a.icon} ${a.msg}<span class="activity-time">${a.time}</span></li>`).join('')
    : '<li style="color:#aaa">אין פעילות עדיין</li>';

  // Alert badge
  updateAlertBadge();
}

function updateAlertBadge() {
  const products = loadProducts();
  const count = products.filter(p => getStatus(p) !== 'ok').length;
  const badge = document.getElementById('alert-badge');
  badge.textContent = count;
  badge.style.display = count > 0 ? '' : 'none';
}

// ── Products ──────────────────────────────────────────────────────────────────
function renderProducts(filterCat = '', filterStatus = '') {
  let products = loadProducts();
  if (filterCat)    products = products.filter(p => p.category === filterCat);
  if (filterStatus) products = products.filter(p => getStatus(p) === filterStatus);

  const query = document.getElementById('global-search').value.trim().toLowerCase();
  if (query) products = products.filter(p => p.name.toLowerCase().includes(query) || p.category.toLowerCase().includes(query));

  const tbody = document.getElementById('products-table');
  tbody.innerHTML = products.length
    ? products.map(p => `
        <tr>
          <td><strong>${p.name}</strong>${p.color ? `<br><small style="color:#aaa">${p.color}</small>` : ''}</td>
          <td>${p.category}</td>
          <td>₪${p.price.toLocaleString()}</td>
          <td>${p.stock}</td>
          <td>${p.size || '—'}</td>
          <td><span class="${statusClass(getStatus(p))}">${statusLabel(getStatus(p))}</span></td>
          <td>
            <button class="btn btn-sm btn-secondary" onclick="editProduct(${p.id})">✏️</button>
            <button class="btn btn-sm btn-secondary" onclick="openStockModal(${p.id})">📦</button>
            <button class="btn btn-sm btn-danger" onclick="deleteProduct(${p.id})">🗑️</button>
          </td>
        </tr>`).join('')
    : '<tr><td colspan="7" style="text-align:center;color:#aaa;padding:20px">לא נמצאו מוצרים</td></tr>';

  // Populate category filter
  const allProducts = loadProducts();
  const cats = [...new Set(allProducts.map(p => p.category))];
  const sel = document.getElementById('filter-category');
  const current = sel.value;
  sel.innerHTML = '<option value="">כל הקטגוריות</option>' + cats.map(c => `<option ${c===current?'selected':''}>${c}</option>`).join('');
}

document.getElementById('filter-category').addEventListener('change', () => {
  renderProducts(document.getElementById('filter-category').value, document.getElementById('filter-status').value);
});
document.getElementById('filter-status').addEventListener('change', () => {
  renderProducts(document.getElementById('filter-category').value, document.getElementById('filter-status').value);
});
document.getElementById('global-search').addEventListener('input', () => {
  const activePage = document.querySelector('.page.active')?.id;
  if (activePage === 'page-products') renderProducts();
});

// ── Add / Edit Product ────────────────────────────────────────────────────────
function resetForm() {
  document.getElementById('edit-id').value = '';
  document.getElementById('product-form').reset();
  document.getElementById('form-title').textContent = 'הוספת מוצר חדש';
  document.getElementById('form-submit-btn').textContent = 'שמור מוצר';
}

function editProduct(id) {
  const p = loadProducts().find(p => p.id === id);
  if (!p) return;
  document.getElementById('edit-id').value = id;
  document.getElementById('f-name').value = p.name;
  document.getElementById('f-category').value = p.category;
  document.getElementById('f-price').value = p.price;
  document.getElementById('f-stock').value = p.stock;
  document.getElementById('f-size').value = p.size || '';
  document.getElementById('f-color').value = p.color || '';
  document.getElementById('f-supplier').value = p.supplier || '';
  document.getElementById('f-threshold').value = p.threshold ?? 5;
  document.getElementById('form-title').textContent = 'עריכת מוצר';
  document.getElementById('form-submit-btn').textContent = 'עדכן מוצר';
  showPage('add-product');
}

document.getElementById('product-form').addEventListener('submit', e => {
  e.preventDefault();
  const products = loadProducts();
  const editId = document.getElementById('edit-id').value;
  const data = {
    name: document.getElementById('f-name').value.trim(),
    category: document.getElementById('f-category').value,
    price: parseFloat(document.getElementById('f-price').value),
    stock: parseInt(document.getElementById('f-stock').value),
    size: document.getElementById('f-size').value,
    color: document.getElementById('f-color').value.trim(),
    supplier: document.getElementById('f-supplier').value.trim(),
    threshold: parseInt(document.getElementById('f-threshold').value) || 5,
  };

  if (editId) {
    const idx = products.findIndex(p => p.id == editId);
    if (idx !== -1) { products[idx] = { ...products[idx], ...data }; }
    logActivity(`מוצר עודכן: ${data.name}`, '✏️');
    showToast('המוצר עודכן בהצלחה ✅');
  } else {
    products.push({ ...data, id: nextId() });
    logActivity(`מוצר חדש נוסף: ${data.name}`, '➕');
    showToast('המוצר נוסף בהצלחה ✅');
  }

  saveProducts(products);
  resetForm();
  showPage('products');
});

function deleteProduct(id) {
  const products = loadProducts();
  const p = products.find(p => p.id === id);
  if (!p) return;
  if (!confirm(`למחוק את "${p.name}"?`)) return;
  saveProducts(products.filter(p => p.id !== id));
  logActivity(`מוצר נמחק: ${p.name}`, '🗑️');
  showToast('המוצר נמחק');
  renderProducts();
  updateAlertBadge();
}

// ── Stock Modal ───────────────────────────────────────────────────────────────
function openStockModal(id) {
  const p = loadProducts().find(p => p.id === id);
  if (!p) return;
  document.getElementById('modal-product-id').value = id;
  document.getElementById('modal-stock').value = p.stock;
  document.getElementById('modal-title').textContent = `עדכון מלאי — ${p.name}`;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

function saveStockUpdate() {
  const id = parseInt(document.getElementById('modal-product-id').value);
  const newStock = parseInt(document.getElementById('modal-stock').value);
  if (isNaN(newStock) || newStock < 0) return;
  const products = loadProducts();
  const p = products.find(p => p.id === id);
  if (!p) return;
  const old = p.stock;
  p.stock = newStock;
  saveProducts(products);
  logActivity(`מלאי עודכן: ${p.name} (${old} → ${newStock})`, '📦');
  showToast(`מלאי עודכן ל-${newStock} יחידות`);
  closeModal();
  renderProducts();
  updateAlertBadge();
}

document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});

// ── Categories ────────────────────────────────────────────────────────────────
const CAT_ICONS = { חולצות:'👕', מכנסיים:'👖', שמלות:'👗', עליוניות:'🧥', הנעלה:'👟', אביזרים:'👜' };

function renderCategories() {
  const products = loadProducts();
  const cats = {};
  products.forEach(p => {
    if (!cats[p.category]) cats[p.category] = { count: 0, value: 0 };
    cats[p.category].count += p.stock;
    cats[p.category].value += p.price * p.stock;
  });

  document.getElementById('categories-grid').innerHTML = Object.entries(cats).map(([cat, info]) => `
    <div class="category-card">
      <div class="cat-icon">${CAT_ICONS[cat] || '📦'}</div>
      <div class="cat-name">${cat}</div>
      <div class="cat-count">${info.count} יחידות • ₪${info.value.toLocaleString('he-IL')}</div>
    </div>`).join('') || '<p style="color:#aaa;text-align:center;padding:30px">אין קטגוריות</p>';
}

// ── Alerts ────────────────────────────────────────────────────────────────────
function renderAlerts() {
  const products = loadProducts().filter(p => getStatus(p) !== 'ok');
  const el = document.getElementById('alerts-list');
  el.innerHTML = products.length
    ? products.map(p => {
        const s = getStatus(p);
        const icon = s === 'out' ? '❌' : '⚠️';
        const msg  = s === 'out' ? 'אזל מהמלאי לחלוטין' : `נותרו רק ${p.stock} יחידות (סף: ${p.threshold})`;
        return `
          <div class="alert-item">
            <div class="alert-icon">${icon}</div>
            <div class="alert-info">
              <strong>${p.name}</strong>
              <p>${msg} • ${p.category}</p>
            </div>
            <button class="btn btn-sm btn-primary" onclick="openStockModal(${p.id})">עדכן מלאי</button>
          </div>`;
      }).join('')
    : '<div style="text-align:center;padding:40px;color:#aaa;font-size:16px">🎉 אין התראות פעילות — המלאי תקין!</div>';
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ── Excel Import ──────────────────────────────────────────────────────────────

// Maps common Hebrew/English column names → internal field names
const COL_ALIASES = {
  name:      ['שם','שם מוצר','מוצר','name','product','item'],
  category:  ['קטגוריה','category','cat','סוג'],
  price:     ['מחיר','price','cost','עלות'],
  stock:     ['מלאי','כמות','qty','quantity','stock','amount'],
  size:      ['מידה','size','מד'],
  color:     ['צבע','color','colour'],
  supplier:  ['ספק','supplier','vendor','מוביל'],
  threshold: ['סף','threshold','minimum','מינימום','סף מלאי'],
};

let importedRows = [];
let detectedHeaders = [];
let columnMapping = {};

function openImportModal() {
  resetImport();
  document.getElementById('import-modal-overlay').classList.remove('hidden');
}

function closeImportModal() {
  document.getElementById('import-modal-overlay').classList.add('hidden');
}

function resetImport() {
  importedRows = [];
  detectedHeaders = [];
  columnMapping = {};
  document.getElementById('import-step-1').style.display = '';
  document.getElementById('import-step-2').style.display = 'none';
  document.getElementById('excel-file-input').value = '';
}

// Drop zone setup
document.addEventListener('DOMContentLoaded', () => {
  const zone = document.getElementById('excel-drop-zone');
  const fileInput = document.getElementById('excel-file-input');

  zone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => { if (e.target.files[0]) handleExcelFile(e.target.files[0]); });

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleExcelFile(file);
  });

  document.getElementById('import-modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeImportModal();
  });
});

function handleExcelFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (!data || data.length < 2) { showToast('הקובץ ריק או לא תקין ❌'); return; }

      detectedHeaders = data[0].map(String);
      importedRows = data.slice(1).filter(r => r.some(c => c !== ''));

      // Auto-detect column mapping
      columnMapping = {};
      detectedHeaders.forEach((h, i) => {
        const lower = h.toLowerCase().trim();
        for (const [field, aliases] of Object.entries(COL_ALIASES)) {
          if (aliases.some(a => lower === a.toLowerCase() || lower.includes(a.toLowerCase()))) {
            if (!columnMapping[field]) columnMapping[field] = i;
          }
        }
      });

      document.getElementById('import-step-1').style.display = 'none';
      document.getElementById('import-step-2').style.display = '';
      renderMappingUI();
    } catch (err) {
      showToast('שגיאה בקריאת הקובץ ❌');
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderMappingUI() {
  const FIELDS = [
    { key: 'name',      label: 'שם מוצר',       required: true },
    { key: 'category',  label: 'קטגוריה',        required: false },
    { key: 'price',     label: 'מחיר (₪)',       required: false },
    { key: 'stock',     label: 'כמות במלאי',     required: false },
    { key: 'size',      label: 'מידה',            required: false },
    { key: 'color',     label: 'צבע',             required: false },
    { key: 'supplier',  label: 'ספק',             required: false },
    { key: 'threshold', label: 'סף התראה',        required: false },
  ];

  const opts = ['<option value="">— לא ממופה —</option>',
    ...detectedHeaders.map((h,i) => `<option value="${i}">${h}</option>`)].join('');

  const rows = FIELDS.map(f => {
    const sel = columnMapping[f.key] !== undefined ? columnMapping[f.key] : '';
    return `<tr>
      <td>${f.label}${f.required ? ' <span style="color:#e74c3c">*</span>' : ''}</td>
      <td><select data-field="${f.key}" onchange="updateMapping(this)">${
        opts.replace(`value="${sel}"`, `value="${sel}" selected`)
      }</select></td>
    </tr>`;
  }).join('');

  document.getElementById('import-mapping-area').innerHTML = `
    <p style="font-size:13px;color:#555;margin-bottom:10px;">
      זיהינו <strong>${detectedHeaders.length}</strong> עמודות ו-<strong>${importedRows.length}</strong> שורות.
      בדוק שהמיפוי נכון:
    </p>
    <table class="mapping-table"><thead><tr><th>שדה במערכת</th><th>עמודה בקובץ</th></tr></thead>
    <tbody>${rows}</tbody></table>`;

  renderImportPreview();
}

function updateMapping(sel) {
  const field = sel.dataset.field;
  const val = sel.value;
  if (val === '') delete columnMapping[field];
  else columnMapping[field] = parseInt(val);
  renderImportPreview();
}

function renderImportPreview() {
  const parsed = importedRows.map(row => parseRow(row));
  const valid = parsed.filter(r => !r._error).length;
  const invalid = parsed.length - valid;

  const previewRows = parsed.slice(0, 8).map(r => `
    <tr class="${r._error ? 'row-error' : ''}">
      <td>${r.name || '<em style="color:#aaa">—</em>'}</td>
      <td>${r.category || '—'}</td>
      <td>${r.price ? '₪' + r.price : '—'}</td>
      <td>${r.stock ?? '—'}</td>
      ${r._error ? `<td colspan="2" style="color:#e74c3c">${r._error}</td>` : `<td>${r.size||'—'}</td><td>${r.color||'—'}</td>`}
    </tr>`).join('');

  document.getElementById('import-preview-area').innerHTML = `
    <p class="import-summary">
      תצוגה מקדימה (8 ראשונים): <strong>${valid} שורות תקינות</strong>
      ${invalid ? `<span class="err-count"> · ${invalid} שורות עם שגיאות (ידלגו)</span>` : ''}
    </p>
    <div class="preview-table-wrap">
      <table class="preview-table">
        <thead><tr><th>שם</th><th>קטגוריה</th><th>מחיר</th><th>מלאי</th><th>מידה</th><th>צבע</th></tr></thead>
        <tbody>${previewRows}</tbody>
      </table>
    </div>`;
}

function parseRow(row) {
  const get = field => {
    const idx = columnMapping[field];
    return idx !== undefined ? row[idx] : undefined;
  };

  const name = String(get('name') || '').trim();
  if (!name) return { _error: 'חסר שם מוצר' };

  const price     = parseFloat(get('price'))   || 0;
  const stock     = parseInt(get('stock'))     ?? 0;
  const threshold = parseInt(get('threshold')) || 5;

  return {
    name,
    category:  String(get('category')  || 'כללי').trim(),
    price:     isNaN(price)  ? 0 : price,
    stock:     isNaN(stock)  ? 0 : stock,
    size:      String(get('size')      || '').trim(),
    color:     String(get('color')     || '').trim(),
    supplier:  String(get('supplier')  || '').trim(),
    threshold: isNaN(threshold) ? 5 : threshold,
  };
}

function confirmImport() {
  const parsed = importedRows.map(row => parseRow(row)).filter(r => !r._error);
  if (!parsed.length) { showToast('אין שורות תקינות לייבוא ❌'); return; }

  const existing = loadProducts();
  const newProducts = parsed.map(p => ({ ...p, id: nextId() + Math.random() }));
  saveProducts([...existing, ...newProducts]);
  logActivity(`יובאו ${newProducts.length} מוצרים מ-Excel`, '📥');
  showToast(`✅ יובאו ${newProducts.length} מוצרים בהצלחה`);
  closeImportModal();
  updateAlertBadge();
  showPage('products');
}

// ── Init ──────────────────────────────────────────────────────────────────────
seedIfEmpty();
renderDashboard();
