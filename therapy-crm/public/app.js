// ===== therapy-crm — לוגיקת צד לקוח =====
'use strict';

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const ALL_HOURS = Array.from({ length: 14 }, (_, i) => i + 8); // 8..21
const URGENCY = { 1: ['דחוף', 'b-red'], 2: ['רגיל', 'b-amber'], 3: ['נמוך', 'b-gray'] };
const PSTATUS = { waiting: ['ממתין', 'b-amber'], assigned: ['משובץ', 'b-green'], done: ['הסתיים', 'b-gray'] };
const ASTATUS = { active: ['פעילה', 'b-green'], completed: ['הושלמה', 'b-blue'], cancelled: ['בוטלה', 'b-gray'] };
const SSTATUS = { scheduled: ['מתוזמנת', 'b-blue'], done: ['בוצעה', 'b-green'], cancelled: ['בוטלה', 'b-gray'], no_show: ['לא הגיע', 'b-red'] };

const S = {
  token: localStorage.getItem('therapy_token') || '',
  me: null,
  view: 'waiting',
  patients: [], therapists: [], groups: [], communities: [], assignments: [],
  meta: { hmos: [], client_types: [], all_hours: ALL_HOURS },
  filters: { q: '' },
  colFilters: null,          // מאותחל מ-freshColFilters אחרי הגדרת העמודות
  sort: { key: '', dir: 1 },
  page: 1, pageSize: 50,
  calTherapist: null, calStart: null,
  calMode: 'week', availWeeks: 4, availPatient: '',
};

// ===== עזרים =====
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function hourLabel(h) { return `${h}:00`; }
function hourRange(h) { return `${h}:00–${h + 1}:00`; }
function fmtDateHe(s) { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-'); return `${d}/${m}/${y}`; }
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function addDaysStr(s, n) { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function weekdayOf(s) { return new Date(s + 'T00:00:00Z').getUTCDay(); }
function calcAge(birth) {
  if (!birth) return null;
  const b = new Date(birth + 'T00:00:00'), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a >= 0 && a < 130 ? a : null;
}
function nextDateForWeekday(wd) {
  let d = todayStr();
  for (let i = 0; i < 7; i++) { if (weekdayOf(d) === wd) return d; d = addDaysStr(d, 1); }
  return d;
}
let toastTimer = null;
function toast(msg, isErr) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = (isErr ? 'err ' : '') + 'show';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, 3500);
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (S.token) headers.Authorization = 'Bearer ' + S.token;
  const res = await fetch('/api' + path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let data = null;
  try { data = await res.json(); } catch (e) { /* לא JSON */ }
  if (res.status === 401 && S.me) { logout(); throw new Error('פג תוקף החיבור'); }
  if (!res.ok) throw new Error((data && data.error) || 'שגיאת שרת');
  return data;
}

// ===== התחברות =====
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('login-err');
  errEl.style.display = 'none';
  try {
    const r = await api('/auth/login', { method: 'POST', body: { username: document.getElementById('login-user').value.trim(), password: document.getElementById('login-pass').value } });
    S.token = r.token; S.me = r.user;
    localStorage.setItem('therapy_token', r.token);
    enterApp();
  } catch (err) { errEl.textContent = err.message; errEl.style.display = 'block'; }
});

function logout() {
  localStorage.removeItem('therapy_token');
  S.token = ''; S.me = null;
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

async function boot() {
  if (!S.token) return;
  try {
    const r = await api('/auth/me');
    S.me = r.user;
    enterApp();
  } catch (e) { logout(); }
}

async function enterApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('user-name').textContent = S.me.full_name || S.me.username;
  await loadAll();
  renderNav();
  render();
}

async function loadAll() {
  const [patients, therapists, groups, communities, assignments, meta] = await Promise.all([
    api('/patients'), api('/therapists'), api('/groups'),
    api('/lists?name=community'), api('/assignments'), api('/patients/meta'),
  ]);
  S.patients = patients; S.therapists = therapists; S.groups = groups;
  S.communities = communities; S.assignments = assignments; S.meta = meta;
}

// ===== ניווט =====
const VIEWS = [
  ['waiting', 'רשימת ממתינים'],
  ['existing', 'מטופלים קיימים'],
  ['series', 'סדרות טיפול'],
  ['calendar', 'לוח שנה'],
  ['therapists', 'מטפלים'],
  ['users', 'משתמשים'],
];
function renderNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = VIEWS
    .filter(([k]) => k !== 'users' || S.me.caps.manageUsers)
    .map(([k, label]) => `<button class="${S.view === k ? 'active' : ''}" onclick="switchView('${k}')">${label}</button>`).join('');
}
function switchView(v) { S.view = v; renderNav(); render(); }

function render() {
  const m = document.getElementById('main');
  if (S.view === 'waiting') renderWaiting(m);
  else if (S.view === 'existing') renderExisting(m);
  else if (S.view === 'therapists') renderTherapists(m);
  else if (S.view === 'series') renderSeries(m);
  else if (S.view === 'calendar') renderCalendar(m);
  else if (S.view === 'users') renderUsers(m);
}

// =====================================================================
// רשימת ממתינים
// =====================================================================
function renderWaiting(m) {
  const f = S.filters;
  if (!S.colFilters) S.colFilters = freshColFilters();
  const nWait = S.patients.filter(p => p.status === 'waiting').length;
  const nAssigned = S.patients.filter(p => p.status === 'assigned').length;
  const nUrgent = S.patients.filter(p => p.status === 'waiting' && p.urgency === 1).length;

  m.innerHTML = `
  <div class="stat-cards">
    <div class="stat-card"><div class="num">${nWait}</div><div class="lbl">ממתינים לשיבוץ</div></div>
    <div class="stat-card"><div class="num">${nUrgent}</div><div class="lbl">דחופים ברשימה</div></div>
    <div class="stat-card"><div class="num">${nAssigned}</div><div class="lbl">משובצים לטיפול</div></div>
    <div class="stat-card"><div class="num">${S.therapists.filter(t => t.active).length}</div><div class="lbl">מטפלים פעילים</div></div>
  </div>
  <div class="card">
    <div class="toolbar">
      <div class="field"><label>חיפוש בכל השדות</label><input id="f-q" value="${esc(f.q)}" placeholder="שם / ת.ז / אבחנה / הערות" oninput="S.filters.q=this.value;S.page=1;applyWaitingFilters()"></div>
      <div class="field"><label>שורות בעמוד</label><select onchange="S.pageSize=this.value==='all'?'all':Number(this.value);S.page=1;applyWaitingFilters()">
        ${[25, 50, 100, 200].map(n => `<option value="${n}" ${S.pageSize === n ? 'selected' : ''}>${n}</option>`).join('')}
        <option value="all" ${S.pageSize === 'all' ? 'selected' : ''}>הכל</option>
      </select></div>
      <button class="btn sec" onclick="clearWaitingFilters()">נקה סינון</button>
      <div class="spacer"></div>
      ${S.me.caps.edit ? `<button class="btn sec" onclick="openImportModal('patients')">📄 ייבוא מאקסל</button>` : ''}
      ${S.me.caps.edit ? `<button class="btn" onclick="openPatientModal(null)">+ מטופל חדש</button>` : ''}
    </div>
    <div class="table-wrap" id="waiting-table"></div>
    <div id="waiting-pager" class="pager"></div>
  </div>`;
  renderWaitingTable();
}

// ===== סינון, מיון ועימוד של רשימת הממתינים =====
// העמודות מוגדרות פעם אחת: כותרת, איך מסננים, ואיך שולפים ערך למיון.
const WAIT_COLS = [
  { key: 'name',      label: 'שם',          type: 'text',   sort: p => `${p.last_name} ${p.first_name}`,
    match: (p, v) => `${p.last_name} ${p.first_name} ${p.diagnosis || ''}`.includes(v) },
  { key: 'national_id', label: 'ת.ז',       type: 'text',   sort: p => p.national_id || '',
    match: (p, v) => String(p.national_id || '').includes(v) },
  { key: 'age',       label: 'גיל',         type: 'range',  sort: p => calcAge(p.birth_date) ?? -1,
    match: (p, v) => { const a = calcAge(p.birth_date);
      if (v.from !== '' && (a == null || a < Number(v.from))) return false;
      if (v.to   !== '' && (a == null || a > Number(v.to))) return false; return true; } },
  { key: 'hmo',       label: 'קופה',        type: 'select', sort: p => p.hmo || '',
    options: () => S.meta.hmos, match: (p, v) => v.includes(p.hmo || '') },
  { key: 'client_type', label: 'סוג',       type: 'select', sort: p => p.client_type || '',
    options: () => S.meta.client_types, match: (p, v) => v.includes(p.client_type || '') },
  { key: 'community', label: 'קהילה',       type: 'select', sort: p => p.community || '',
    options: () => [...new Set(S.patients.map(x => x.community).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he')),
    match: (p, v) => v.includes(p.community || '') },
  { key: 'intake',    label: 'אינטייק',     type: 'daterange', sort: p => p.intake_date || '',
    match: (p, v) => { const d = p.intake_date || '';
      if (v.from && (!d || d < v.from)) return false;
      if (v.to   && (!d || d > v.to)) return false; return true; } },
  { key: 'urgency',   label: 'דחיפות',      type: 'select', sort: p => p.urgency,
    options: () => [['1', 'דחוף'], ['2', 'רגיל'], ['3', 'נמוך']],
    match: (p, v) => v.includes(String(p.urgency)) },
  { key: 'pref',      label: 'העדפת שיוך',  type: 'text',   sort: p => (p.preferred_therapists || []).length,
    match: (p, v) => (p.preferred_therapists || []).map(t => t.name).join(' ').includes(v)
                  || (p.preferred_groups || []).map(g => g.name).join(' ').includes(v) },
  { key: 'files',     label: 'קבצים',       type: 'select', sort: p => p.files_count || 0,
    options: () => [['yes', 'יש קבצים'], ['no', 'אין']],
    match: (p, v) => v.includes(p.files_count > 0 ? 'yes' : 'no') },
  { key: 'status',    label: 'סטטוס',       type: 'select', sort: p => p.status,
    options: () => [['waiting', 'ממתין'], ['assigned', 'משובץ'], ['done', 'הסתיים']],
    match: (p, v) => v.includes(p.status) },
];

function colFilterCell(c) {
  const v = S.colFilters[c.key];
  if (c.type === 'select') {
    // בחירה מרובה: כפתור שמסכם מה נבחר, ומתחתיו רשימת תיבות סימון
    const opts = c.options().map(o => Array.isArray(o) ? o : [o, o]);
    const chosen = opts.filter(([val]) => v.includes(val));
    const label = !chosen.length ? 'הכל'
      : chosen.length === 1 ? chosen[0][1]
      : `${chosen.length} נבחרו`;
    return `<div class="ms" data-col="${c.key}">
      <button type="button" class="ms-btn${chosen.length ? ' on' : ''}" onclick="toggleMulti(event,'${c.key}')">
        <span>${esc(label)}</span><span class="ms-caret">▾</span>
      </button>
      <div class="ms-pop">
        ${opts.map(([val, lbl]) => `<label><input type="checkbox" value="${esc(val)}" ${v.includes(val) ? 'checked' : ''}
          onchange="toggleMultiValue('${c.key}', this.value, this.checked)"> ${esc(lbl)}</label>`).join('')}
        ${chosen.length ? `<button type="button" class="ms-clear" onclick="setColFilter('${c.key}',[]);renderWaitingTable()">נקה</button>` : ''}
      </div>
    </div>`;
  }
  if (c.type === 'range') {
    return `<div class="f-range">
      <input type="number" min="0" placeholder="מ-" value="${esc(v.from)}" oninput="setColFilter('${c.key}',{from:this.value,to:S.colFilters.${c.key}.to})">
      <input type="number" min="0" placeholder="עד" value="${esc(v.to)}" oninput="setColFilter('${c.key}',{from:S.colFilters.${c.key}.from,to:this.value})">
    </div>`;
  }
  if (c.type === 'daterange') {
    return `<div class="f-range">
      <input type="date" value="${esc(v.from)}" oninput="setColFilter('${c.key}',{from:this.value,to:S.colFilters.${c.key}.to})">
      <input type="date" value="${esc(v.to)}" oninput="setColFilter('${c.key}',{from:S.colFilters.${c.key}.from,to:this.value})">
    </div>`;
  }
  return `<input placeholder="סנן..." value="${esc(v)}" oninput="setColFilter('${c.key}', this.value)">`;
}

function setColFilter(key, value) {
  S.colFilters[key] = value;
  S.page = 1;
  applyWaitingFilters();   // מרענן רק את גוף הטבלה, כדי שהמיקוד בשדה לא יאבד
}

// פתיחת/סגירת רשימת הבחירה המרובה. רק אחת פתוחה בכל רגע.
function toggleMulti(ev, key) {
  ev.stopPropagation();
  const box = ev.currentTarget.closest('.ms');
  const wasOpen = box.classList.contains('open');
  document.querySelectorAll('.ms.open').forEach(x => x.classList.remove('open'));
  if (!wasOpen) box.classList.add('open');
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.ms')) document.querySelectorAll('.ms.open').forEach(x => x.classList.remove('open'));
});

function toggleMultiValue(key, value, checked) {
  const cur = S.colFilters[key];
  S.colFilters[key] = checked ? [...cur, value] : cur.filter(x => x !== value);
  S.page = 1;
  applyWaitingFilters();
  // מעדכנים רק את תווית הכפתור — בנייה מחדש הייתה סוגרת את הרשימה הפתוחה
  const box = document.querySelector(`.ms[data-col="${key}"]`);
  if (box) {
    const c = WAIT_COLS.find(x => x.key === key);
    const opts = c.options().map(o => Array.isArray(o) ? o : [o, o]);
    const chosen = opts.filter(([val]) => S.colFilters[key].includes(val));
    box.querySelector('.ms-btn span').textContent =
      !chosen.length ? 'הכל' : chosen.length === 1 ? chosen[0][1] : `${chosen.length} נבחרו`;
    box.querySelector('.ms-btn').classList.toggle('on', chosen.length > 0);
  }
}

function clearWaitingFilters() {
  S.colFilters = freshColFilters();
  S.filters.q = '';
  S.page = 1;
  renderWaiting(document.getElementById('main'));
}

function freshColFilters() {
  const o = {};
  for (const c of WAIT_COLS) {
    o[c.key] = (c.type === 'range' || c.type === 'daterange') ? { from: '', to: '' }
             : c.type === 'select' ? [] : '';
  }
  return o;
}

function sortWaiting(key) {
  if (S.sort.key === key) S.sort.dir = -S.sort.dir;
  else { S.sort.key = key; S.sort.dir = 1; }
  applyWaitingFilters();
  // חצי המיון בכותרות מתעדכנים בלי לבנות מחדש את שורת הסינון
  document.querySelectorAll('#waiting-table th[data-col]').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (arrow) arrow.textContent = th.dataset.col === S.sort.key ? (S.sort.dir === 1 ? ' ▲' : ' ▼') : '';
  });
}

function filteredWaiting() {
  const f = S.filters;
  let rows = S.patients.filter(p => {
    for (const c of WAIT_COLS) {
      const v = S.colFilters[c.key];
      const empty = (c.type === 'range' || c.type === 'daterange') ? (!v.from && !v.to)
                  : c.type === 'select' ? !v.length : !v;
      if (!empty && !c.match(p, v)) return false;
    }
    if (f.q) {
      const t = `${p.last_name} ${p.first_name} ${p.national_id || ''} ${p.community || ''} ${p.diagnosis || ''} ${p.notes || ''} ${p.notes2 || ''}`;
      if (!t.includes(f.q)) return false;
    }
    return true;
  });
  if (S.sort.key) {
    const c = WAIT_COLS.find(x => x.key === S.sort.key);
    if (c) rows = rows.slice().sort((a, b) => {
      const x = c.sort(a), y = c.sort(b);
      const r = (typeof x === 'number' && typeof y === 'number') ? x - y : String(x).localeCompare(String(y), 'he');
      return r * S.sort.dir;
    });
  }
  return rows;
}

function renderWaitingTable() {
  const el = document.getElementById('waiting-table');
  if (!el) return;
  el.innerHTML = `<table><thead>
    <tr>
      ${WAIT_COLS.map(c => `<th data-col="${c.key}" class="sortable" onclick="sortWaiting('${c.key}')">${c.label}<span class="sort-arrow">${S.sort.key === c.key ? (S.sort.dir === 1 ? ' ▲' : ' ▼') : ''}</span></th>`).join('')}
      <th></th>
    </tr>
    <tr class="filter-row">
      ${WAIT_COLS.map(c => `<th>${colFilterCell(c)}</th>`).join('')}
      <th></th>
    </tr>
  </thead><tbody id="waiting-body"></tbody></table>`;
  applyWaitingFilters();
}

// מרענן רק את השורות ואת העימוד — שורת הסינון לא נבנית מחדש,
// אחרת המיקוד היה קופץ מהשדה אחרי כל תו שמקלידים
function applyWaitingFilters() {
  const body = document.getElementById('waiting-body');
  const pager = document.getElementById('waiting-pager');
  if (!body) return;
  const all = filteredWaiting();
  const size = S.pageSize === 'all' ? all.length : S.pageSize;
  const pages = Math.max(1, Math.ceil(all.length / (size || 1)));
  if (S.page > pages) S.page = pages;
  const from = (S.page - 1) * size;
  const rows = S.pageSize === 'all' ? all : all.slice(from, from + size);

  if (!all.length) {
    body.innerHTML = `<tr><td colspan="${WAIT_COLS.length + 1}"><div class="empty">אין מטופלים שתואמים לסינון</div></td></tr>`;
    if (pager) pager.innerHTML = '';
    return;
  }
  body.innerHTML = waitingRowsHtml(rows);
  if (pager) {
    pager.innerHTML = `
      <span class="hint">מציג ${from + 1}–${Math.min(from + rows.length, all.length)} מתוך ${all.length}${all.length !== S.patients.length ? ` (סוננו מ-${S.patients.length})` : ''}</span>
      ${pages > 1 ? `<span class="pager-btns">
        <button class="btn sm sec" ${S.page === 1 ? 'disabled' : ''} onclick="S.page=1;applyWaitingFilters()">⏮</button>
        <button class="btn sm sec" ${S.page === 1 ? 'disabled' : ''} onclick="S.page--;applyWaitingFilters()">◀</button>
        <span class="pager-num">עמוד ${S.page} מתוך ${pages}</span>
        <button class="btn sm sec" ${S.page === pages ? 'disabled' : ''} onclick="S.page++;applyWaitingFilters()">▶</button>
        <button class="btn sm sec" ${S.page === pages ? 'disabled' : ''} onclick="S.page=${pages};applyWaitingFilters()">⏭</button>
      </span>` : ''}`;
  }
}

function waitingRowsHtml(rows) {
  return rows.map(p => {
    const age = calcAge(p.birth_date);
    const [uLbl, uCls] = URGENCY[p.urgency] || URGENCY[2];
    const [sLbl, sCls] = PSTATUS[p.status] || PSTATUS.waiting;
    const pref = prefSummary(p);
    return `<tr>
      <td><b>${esc(p.last_name)} ${esc(p.first_name)}</b>${p.diagnosis ? `<div class="hint">${esc(p.diagnosis)}</div>` : ''}</td>
      <td>${esc(p.national_id || '')}</td>
      <td>${age != null ? `<span class="age-view">${age}</span>` : ''}</td>
      <td>${esc(p.hmo || '')}</td>
      <td>${esc(p.client_type || '')}</td>
      <td>${esc(p.community || '')}</td>
      <td>${fmtDateHe(p.intake_date)}</td>
      <td><span class="badge ${uCls}">${uLbl}</span></td>
      <td style="font-size:13px">${pref}</td>
      <td>${p.files_count ? `<span class="clip" onclick="openFilesModal(${p.id})" title="${p.files_count} קבצים מצורפים">📎 ${p.files_count}</span>` : ''}</td>
      <td><span class="badge ${sCls}">${sLbl}</span></td>
      <td style="white-space:nowrap">
        ${S.me.caps.edit && p.status === 'waiting' ? `<button class="btn sm green" onclick="openAssignModal(${p.id})">שבץ</button>` : ''}
        <button class="btn sm sec" onclick="openFilesModal(${p.id})" title="קבצים מצורפים">📎</button>
        ${S.me.caps.edit ? `<button class="btn sm sec" onclick="openPatientModal(${p.id})">עריכה</button>` : ''}
        ${S.me.caps.del ? `<button class="btn sm sec" onclick="deletePatient(${p.id})">🗑</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

async function deletePatient(id) {
  if (!confirm('להעביר את המטופל לסל המחיקה?')) return;
  try { await api('/patients/' + id, { method: 'DELETE' }); toast('נמחק'); await loadAll(); render(); }
  catch (e) { toast(e.message, true); }
}

// ----- טופס מטופל -----
function openPatientModal(id) {
  const p = id ? S.patients.find(x => x.id === id) : null;
  const hours = p ? (p.hours || ALL_HOURS) : ALL_HOURS.slice();
  showModal(`
  <h2>${p ? 'עריכת מטופל' : 'מטופל חדש'} <button class="x" onclick="closeModal()">✕</button></h2>
  <form id="patient-form">
    <div class="grid2">
      <div class="field"><label>שם משפחה *</label><input name="last_name" value="${esc(p ? p.last_name : '')}" required></div>
      <div class="field"><label>שם פרטי *</label><input name="first_name" value="${esc(p ? p.first_name : '')}" required></div>
      <div class="field"><label>מספר זהות</label><input name="national_id" value="${esc(p ? p.national_id : '')}" maxlength="10"></div>
      <div class="field"><label>תאריך אינטייק</label><input name="intake_date" type="date" value="${p && p.intake_date ? p.intake_date : todayStr()}"></div>
      <div class="field"><label>תאריך לידה</label><input name="birth_date" type="date" value="${p && p.birth_date ? p.birth_date : ''}" oninput="updateAgeView(this.value)"></div>
      <div class="field"><label>גיל (אוטומטי)</label><div id="age-view" class="age-view" style="padding:8px 2px">${(() => { const a = p ? calcAge(p.birth_date) : null; return a != null ? a + ' שנים' : '—'; })()}</div></div>
      <div class="field"><label>קופת חולים</label><select name="hmo">
        <option value="">—</option>
        ${S.meta.hmos.map(h => `<option ${p && p.hmo === h ? 'selected' : ''}>${h}</option>`).join('')}
      </select></div>
      <div class="field"><label>בן / בת</label><select name="client_type">
        <option value="">—</option>
        ${S.meta.client_types.map(t => `<option ${p && p.client_type === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select></div>
      <div class="field"><label>השתייכות קהילתית</label><select name="community" onchange="communityChanged(this)">
        <option value="">—</option>
        ${S.communities.map(c => `<option value="${esc(c.value)}" ${p && p.community === c.value ? 'selected' : ''}>${esc(c.value)}</option>`).join('')}
        ${p && p.community && !S.communities.some(c => c.value === p.community) ? `<option selected value="${esc(p.community)}">${esc(p.community)}</option>` : ''}
        <option value="__new__">+ הוספה חדשה...</option>
      </select></div>
      <div class="field"><label>רמת דחיפות</label><select name="urgency">
        <option value="1" ${p && p.urgency === 1 ? 'selected' : ''}>1 — דחוף</option>
        <option value="2" ${!p || p.urgency === 2 ? 'selected' : ''}>2 — רגיל</option>
        <option value="3" ${p && p.urgency === 3 ? 'selected' : ''}>3 — נמוך</option>
      </select></div>
    </div>
    <div class="field"><label>אבחנה</label><input name="diagnosis" value="${esc(p ? p.diagnosis : '')}"></div>
    <div class="grid2">
      <div class="field"><label>הערות</label><textarea name="notes" rows="2">${esc(p ? p.notes : '')}</textarea></div>
      <div class="field"><label>הערות נוספות</label><textarea name="notes2" rows="2">${esc(p ? p.notes2 : '')}</textarea></div>
    </div>

    <div class="field">
      <label>שעות מתאימות לטיפול (לחץ להסרת שעה שלא מתאימה)</label>
      <div class="hours-tools">
        <button type="button" class="btn sec sm" onclick="setAllHours(true)">בחר הכל</button>
        <button type="button" class="btn sec sm" onclick="setAllHours(false)">נקה הכל</button>
      </div>
      <div class="hours-grid" id="hours-grid">
        ${ALL_HOURS.map(h => `<div class="hour-chip ${hours.includes(h) ? 'on' : ''}" data-h="${h}" onclick="this.classList.toggle('on')">${hourRange(h)}</div>`).join('')}
      </div>
    </div>

    <div class="field">
      <label>שיוך למטפלים</label>
      <div class="hint" style="margin-bottom:8px">
        סימון קבוצה ממלא אוטומטית את המטפלים שבה. אפשר לסמן כמה קבוצות, להוסיף מטפלים בודדים,
        ולהוריד מהרשימה כל שם שלא מתאים.
      </div>
      <div class="pref-box">
        <div class="pref-groups" id="pref-groups">
          ${S.groups.length ? S.groups.map(g => `
            <label class="group-check"><input type="checkbox" value="${g.id}" onchange="prefToggleGroup(${g.id}, this.checked)"> ${esc(g.name)}
              <span class="hint">(${(g.members || []).length})</span></label>`).join('')
            : '<span class="hint">אין קבוצות מטפלים. אפשר להקים בלשונית "מטפלים".</span>'}
        </div>
        <div class="pref-add">
          <select id="pref-add-select">
            <option value="">+ הוסף מטפל לרשימה...</option>
            ${S.therapists.filter(t => t.active).map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
          </select>
          <button type="button" class="btn sec sm" onclick="prefAddSelected()">הוסף</button>
        </div>
        <div id="pref-list" class="pref-list"></div>
      </div>
    </div>

    <div class="modal-actions">
      <button class="btn">${p ? 'שמירה' : 'הוספה'}</button>
      <button type="button" class="btn sec" onclick="closeModal()">ביטול</button>
    </div>
  </form>`);
  prefInit(p);
  document.getElementById('patient-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      last_name: fd.get('last_name'), first_name: fd.get('first_name'),
      national_id: fd.get('national_id'), intake_date: fd.get('intake_date') || null,
      birth_date: fd.get('birth_date') || null, hmo: fd.get('hmo') || null,
      client_type: fd.get('client_type') || null, community: fd.get('community') === '__new__' ? null : (fd.get('community') || null),
      diagnosis: fd.get('diagnosis'), notes: fd.get('notes'), notes2: fd.get('notes2'),
      urgency: Number(fd.get('urgency')),
      hours: [...document.querySelectorAll('#hours-grid .hour-chip.on')].map(c => Number(c.dataset.h)),
      preferred_therapist_ids: [..._pref.therapists],
      preferred_group_ids: [..._pref.groups],
    };
    try {
      if (p) await api('/patients/' + p.id, { method: 'PUT', body });
      else await api('/patients', { method: 'POST', body });
      toast(p ? 'נשמר' : 'נוסף לרשימת ההמתנה');
      closeModal(); await loadAll(); render();
    } catch (err) { toast(err.message, true); }
  });
}

function updateAgeView(birth) {
  const a = calcAge(birth);
  document.getElementById('age-view').textContent = a != null ? a + ' שנים' : '—';
}
function setAllHours(on) {
  document.querySelectorAll('#hours-grid .hour-chip').forEach(c => c.classList.toggle('on', on));
}
// תקציר ההעדפה לתצוגה בטבלה: שם אחד במלואו, יותר מזה — מספר + הקבוצות שמאחוריו
function prefSummary(p) {
  const ts = p.preferred_therapists || [], gs = p.preferred_groups || [];
  if (!ts.length) return '—';
  const label = ts.length === 1 ? '👤 ' + esc(ts[0].name) : `👥 ${ts.length} מטפלים`;
  const from = gs.length ? ` <span class="hint">(${gs.map(g => esc(g.name)).join(', ')})</span>` : '';
  return `<span title="${esc(ts.map(t => t.name).join(', '))}">${label}${from}</span>`;
}

// ===== עורך המטפלים המועדפים =====
// therapists = הרשימה בפועל (מקור האמת לשיבוץ)
// groups     = הקבוצות המסומנות, לזריעת הרשימה ולתיעוד
// manual     = מי שנוסף/נשמר ידנית — לא יוסר כשמבטלים סימון קבוצה
let _pref = { therapists: new Set(), groups: new Set(), manual: new Set() };

function prefInit(p) {
  const tIds = (p && p.preferred_therapists ? p.preferred_therapists.map(t => t.id) : []);
  const gIds = (p && p.preferred_groups ? p.preferred_groups.map(g => g.id) : []);
  _pref = { therapists: new Set(tIds), groups: new Set(gIds), manual: new Set(tIds) };
  document.querySelectorAll('#pref-groups input[type=checkbox]').forEach(c => {
    c.checked = _pref.groups.has(Number(c.value));
  });
  prefRender();
}

function groupMemberIds(gid) {
  const g = S.groups.find(x => x.id === Number(gid));
  return g && Array.isArray(g.members) ? g.members.map(m => m.id) : [];
}

function prefToggleGroup(gid, checked) {
  gid = Number(gid);
  if (checked) {
    _pref.groups.add(gid);
    groupMemberIds(gid).forEach(id => _pref.therapists.add(id));
  } else {
    _pref.groups.delete(gid);
    // מסירים רק מי שהגיע מהקבוצה הזו בלבד — לא ידניים ולא חברי קבוצה אחרת שמסומנת
    const keep = new Set();
    _pref.groups.forEach(g => groupMemberIds(g).forEach(id => keep.add(id)));
    groupMemberIds(gid).forEach(id => {
      if (!keep.has(id) && !_pref.manual.has(id)) _pref.therapists.delete(id);
    });
  }
  prefRender();
}

function prefAddSelected() {
  const sel = document.getElementById('pref-add-select');
  const id = Number(sel.value);
  if (!id) return;
  _pref.therapists.add(id);
  _pref.manual.add(id);
  sel.value = '';
  prefRender();
}

function prefRemove(id) {
  id = Number(id);
  _pref.therapists.delete(id);
  _pref.manual.delete(id);
  prefRender();
}

function prefRender() {
  const el = document.getElementById('pref-list');
  if (!el) return;
  if (!_pref.therapists.size) {
    el.innerHTML = '<span class="hint">לא נבחרו מטפלים — המערכת תציע את כל המטפלים הזמינים</span>';
    return;
  }
  const names = [..._pref.therapists].map(id => {
    const t = S.therapists.find(x => x.id === id);
    return { id, name: t ? t.name : 'מטפל #' + id, manual: _pref.manual.has(id) };
  }).sort((a, b) => a.name.localeCompare(b.name, 'he'));
  el.innerHTML = `<div class="pref-count">${names.length} מטפלים ברשימה:</div>` + names.map(n => `
    <span class="pref-chip${n.manual ? ' manual' : ''}">${esc(n.name)}
      <button type="button" onclick="prefRemove(${n.id})" title="הסר מהרשימה">✕</button>
    </span>`).join('');
}
async function communityChanged(sel) {
  if (sel.value !== '__new__') return;
  const val = prompt('שם ההשתייכות הקהילתית החדשה:');
  if (val && val.trim()) {
    try {
      const item = await api('/lists', { method: 'POST', body: { list_name: 'community', value: val.trim() } });
      S.communities = await api('/lists?name=community');
      const opt = document.createElement('option');
      opt.value = item.value; opt.textContent = item.value; opt.selected = true;
      sel.insertBefore(opt, sel.querySelector('option[value="__new__"]'));
      sel.value = item.value;
    } catch (e) { toast(e.message, true); sel.value = ''; }
  } else sel.value = '';
}

// =====================================================================
// שיבוץ לטיפול (יצירת סדרה)
// =====================================================================
async function openAssignModal(patientId) {
  const p = S.patients.find(x => x.id === patientId);
  if (!p) return;
  showModal(`
  <h2>שיבוץ לטיפול — ${esc(p.last_name)} ${esc(p.first_name)} <button class="x" onclick="closeModal()">✕</button></h2>
  <div class="hint" style="margin-bottom:10px">
    שעות מתאימות למטופל: ${(p.hours || []).map(hourRange).join(' · ') || 'כולן'}
    ${(p.preferred_therapists || []).length ? '<br>מטפלים מועדפים: ' + p.preferred_therapists.map(t => esc(t.name)).join(' · ') : ''}
    ${(p.preferred_groups || []).length ? ' <span class="hint">(מקבוצות: ' + p.preferred_groups.map(g => esc(g.name)).join(', ') + ')</span>' : ''}
  </div>
  <div class="card" style="box-shadow:none;border:1px solid var(--line);padding:12px" id="assign-avail">
    <b style="font-size:13.5px">משבצות שבועיות פנויות (לפי שעות המטופל והעדפתו) — לחץ לבחירה:</b>
    <div id="avail-slots" style="margin-top:8px"><span class="hint">טוען זמינות...</span></div>
  </div>
  <form id="assign-form">
    <div class="grid3">
      <div class="field"><label>מטפל *</label><select name="therapist_id" id="as-therapist" required>
        <option value="">בחר...</option>
        ${S.therapists.filter(t => t.active).map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
      </select></div>
      <div class="field"><label>כמות טיפולים בסדרה *</label><input name="total_sessions" id="as-total" type="number" min="1" max="200" value="12" required></div>
      <div class="field"><label>שעה *</label><select name="hour" id="as-hour" required>
        ${ALL_HOURS.map(h => `<option value="${h}">${hourRange(h)}</option>`).join('')}
      </select></div>
      <div class="field"><label>תאריך התחלה *</label><input name="start_date" id="as-date" type="date" value="${todayStr()}" required onchange="assignDateHint()"></div>
      <div class="field" style="grid-column:span 2"><label>הערות</label><input name="notes"></div>
    </div>
    <div class="hint" id="as-hint"></div>
    <div class="modal-actions">
      <button class="btn green">צור סדרת טיפולים</button>
      <button type="button" class="btn sec" onclick="closeModal()">ביטול</button>
    </div>
  </form>`);
  assignDateHint();

  document.getElementById('assign-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button.btn');
    btn.disabled = true; // מניעת לחיצה כפולה
    try {
      const r = await api('/assignments', {
        method: 'POST', body: {
          patient_id: p.id, therapist_id: Number(fd.get('therapist_id')),
          total_sessions: Number(fd.get('total_sessions')), start_date: fd.get('start_date'),
          hour: Number(fd.get('hour')), notes: fd.get('notes'),
        }
      });
      toast(seriesCreatedMsg(r));
      closeModal(); await loadAll(); render();
    } catch (err) { btn.disabled = false; toast(err.message, true); }
  });

  // טעינת זמינות מסוננת לפי המטופל
  try {
    const av = await api(`/calendar/availability?weeks=${S.availWeeks}&patient_id=${p.id}`);
    const el = document.getElementById('avail-slots');
    const withSlots = av.therapists.filter(t => t.free_slots.length);
    if (!withSlots.length) { el.innerHTML = '<span class="hint">לא נמצאו משבצות פנויות מתאימות — ניתן לבחור ידנית למטה</span>'; return; }
    el.innerHTML = withSlots.map(t => `
      <div style="margin-bottom:8px"><b>${esc(t.name)}:</b>
        <span class="slot-chips" style="display:inline-flex">
        ${t.free_slots.map(s => `<span class="slot-chip" onclick="pickSlot(${t.therapist_id},${s.weekday},${s.hour})">${WEEKDAYS[s.weekday]} ${hourLabel(s.hour)}</span>`).join('')}
        </span>
      </div>`).join('');
  } catch (e) {
    const el = document.getElementById('avail-slots');
    if (el) el.innerHTML = '<span class="hint">שגיאה בטעינת זמינות</span>';
  }
}

function pickSlot(tid, weekday, hour) {
  document.getElementById('as-therapist').value = String(tid);
  document.getElementById('as-hour').value = String(hour);
  document.getElementById('as-date').value = nextDateForWeekday(weekday);
  assignDateHint();
}
function assignDateHint() {
  const d = document.getElementById('as-date');
  const el = document.getElementById('as-hint');
  if (d && d.value && el) el.textContent = 'הפגישות ייקבעו בכל יום ' + WEEKDAYS[weekdayOf(d.value)] + ' באותה שעה, עד השלמת הסדרה';
}

// =====================================================================
// מטופלים קיימים — קליטה מהירה: שם + מטפל + שעה + סדרת פגישות
// =====================================================================
function renderExisting(m) {
  const active = S.assignments.filter(a => a.status === 'active' && a.kind !== 'single');
  m.innerHTML = `
  <div class="card">
    <div class="toolbar">
      <h2 style="margin:0">קליטת מטופל קיים</h2>
      <div class="spacer"></div>
      ${S.me.caps.edit ? `<button class="btn sec" onclick="openImportModal('existing')">📄 ייבוא רשימה מאקסל</button>` : ''}
    </div>
    <div class="hint" style="margin-bottom:12px">
      למטופלים שכבר בטיפול — רק שם, מטפל, שעה וכמות פגישות. בלי שאר הפרטים (אפשר להשלים אחר-כך בעריכה).
    </div>
    <form id="quick-form">
      <div class="grid3">
        <div class="field"><label>שם משפחה *</label><input name="last_name" required></div>
        <div class="field"><label>שם פרטי *</label><input name="first_name" required></div>
        <div class="field"><label>מטפל *</label><select name="therapist_id" id="qk-therapist" required onchange="quickLoadSlots()">
          <option value="">בחר...</option>
          ${S.therapists.filter(t => t.active).map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
        </select></div>
        <div class="field"><label>כמות פגישות *</label><input name="total_sessions" type="number" min="1" max="200" value="12" required></div>
        <div class="field"><label>שעה *</label><select name="hour" id="qk-hour" required>
          ${ALL_HOURS.map(h => `<option value="${h}">${hourRange(h)}</option>`).join('')}
        </select></div>
        <div class="field"><label>תאריך התחלה *</label><input name="start_date" id="qk-date" type="date" value="${todayStr()}" required onchange="quickDateHint()"></div>
      </div>
      <div class="field"><label>הערות</label><input name="notes"></div>
      <div id="qk-slots" class="hint" style="margin-bottom:10px"></div>
      <div class="hint" id="qk-hint" style="margin-bottom:10px"></div>
      <button class="btn green">קלוט ושבץ</button>
    </form>
  </div>

  <div class="card">
    <h2>סדרות פעילות</h2>
    <div class="table-wrap">
    ${!active.length ? '<div class="empty">אין סדרות פעילות</div>' : `
    <table><thead><tr><th>מטופל</th><th>מטפל</th><th>יום ושעה</th><th>התחלה</th><th>התקדמות</th><th></th></tr></thead><tbody>
    ${active.map(a => `<tr>
      <td><b>${esc(a.patient_name)}</b></td>
      <td>${esc(a.therapist_name)}</td>
      <td>${WEEKDAYS[a.weekday]} ${hourLabel(a.hour)}</td>
      <td>${fmtDateHe(a.start_date)}</td>
      <td>${(a.done_count || 0) + (a.past_count || 0)} / ${a.total_sessions}</td>
      <td style="white-space:nowrap">
        <button class="btn sm sec" onclick="openSessionsModal(${a.id})">פגישות</button>
        ${S.me.caps.edit ? `<button class="btn sm sec" onclick="openSingleModal(${a.patient_id})">+ פגישה</button>` : ''}
      </td>
    </tr>`).join('')}
    </tbody></table>`}
    </div>
  </div>`;
  quickDateHint();

  document.getElementById('quick-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button.btn');
    btn.disabled = true; // מניעת לחיצה כפולה שיוצרת שיבוץ כפול
    try {
      const r = await api('/assignments/quick', { method: 'POST', body: {
        last_name: fd.get('last_name'), first_name: fd.get('first_name'),
        therapist_id: Number(fd.get('therapist_id')), total_sessions: Number(fd.get('total_sessions')),
        start_date: fd.get('start_date'), hour: Number(fd.get('hour')), notes: fd.get('notes'),
      }});
      toast(seriesCreatedMsg(r));
      await loadAll(); render();
    } catch (err) { btn.disabled = false; toast(err.message, true); }
  });
}

// הודעת סיכום ליצירת סדרה, כולל פירוט דילוגים
function seriesCreatedMsg(r) {
  let msg = `נוצרה סדרה של ${r.sessions.length} פגישות`;
  const parts = [];
  if ((r.skipped_busy || []).length) parts.push(`${r.skipped_busy.length} שבועות תפוסים`);
  if ((r.skipped_holidays || []).length) parts.push(`${r.skipped_holidays.length} ימי חופש`);
  if (parts.length) msg += ` (דילוג על ${parts.join(' + ')})`;
  if ((r.warnings || []).length) msg += '. ' + r.warnings.join('. ');
  return msg;
}

// משבצות פנויות של המטפל שנבחר — לחיצה ממלאת שעה ותאריך
async function quickLoadSlots() {
  const tid = document.getElementById('qk-therapist').value;
  const el = document.getElementById('qk-slots');
  if (!tid) { el.innerHTML = ''; return; }
  el.innerHTML = 'טוען משבצות פנויות...';
  try {
    const av = await api(`/calendar/availability?weeks=4&therapist_id=${tid}`);
    const t = av.therapists[0];
    if (!t || !t.free_slots.length) { el.innerHTML = 'אין משבצות שבועיות פנויות אצל מטפל זה בשבועות הקרובים'; return; }
    el.innerHTML = 'משבצות פנויות (לחץ לבחירה): ' + t.free_slots.map(s =>
      `<span class="slot-chip" onclick="quickPickSlot(${s.weekday},${s.hour})">${WEEKDAYS[s.weekday]} ${hourLabel(s.hour)}</span>`).join(' ');
  } catch (e) { el.innerHTML = ''; }
}
function quickPickSlot(weekday, hour) {
  document.getElementById('qk-hour').value = String(hour);
  document.getElementById('qk-date').value = nextDateForWeekday(weekday);
  quickDateHint();
}
function quickDateHint() {
  const d = document.getElementById('qk-date');
  const el = document.getElementById('qk-hint');
  if (d && d.value && el) el.textContent = 'הפגישות ייקבעו בכל יום ' + WEEKDAYS[weekdayOf(d.value)] + ' באותה שעה (דילוג אוטומטי על ימי חופש)';
}

// =====================================================================
// פגישה בודדת למטופל
// =====================================================================
function openSingleModal(patientId) {
  const p = S.patients.find(x => x.id === patientId);
  if (!p) return;
  showModal(`
  <h2>פגישה בודדת — ${esc(p.last_name)} ${esc(p.first_name)} <button class="x" onclick="closeModal()">✕</button></h2>
  <form id="single-form">
    <div class="grid3">
      <div class="field"><label>מטפל *</label><select name="therapist_id" id="sg-therapist" required onchange="singleUpdateHours()">
        <option value="">בחר...</option>
        ${S.therapists.filter(t => t.active).map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
      </select></div>
      <div class="field"><label>תאריך *</label><input name="date" id="sg-date" type="date" value="${todayStr()}" required onchange="singleUpdateHours()"></div>
      <div class="field"><label>שעה *</label><select name="hour" id="sg-hour" required></select></div>
    </div>
    <div class="field"><label>הערות</label><input name="notes"></div>
    <div class="hint" id="sg-hint"></div>
    <div class="modal-actions">
      <button class="btn green">קבע פגישה</button>
      <button type="button" class="btn sec" onclick="closeModal()">ביטול</button>
    </div>
  </form>`);
  singleUpdateHours();
  document.getElementById('single-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button.btn');
    btn.disabled = true; // מניעת לחיצה כפולה
    try {
      await api('/assignments/single', { method: 'POST', body: {
        patient_id: p.id, therapist_id: Number(fd.get('therapist_id')),
        date: fd.get('date'), hour: Number(fd.get('hour')), notes: fd.get('notes'),
      }});
      toast('הפגישה נקבעה');
      closeModal(); await loadAll(); render();
    } catch (err) { btn.disabled = false; toast(err.message, true); }
  });
}

// שעות אפשריות לפגישה בודדת: לפי לו"ז המטפל ביום שנבחר (תפוס/חופש נבדק בשרת)
function singleUpdateHours() {
  const tid = Number(document.getElementById('sg-therapist').value);
  const date = document.getElementById('sg-date').value;
  const hourSel = document.getElementById('sg-hour');
  const hint = document.getElementById('sg-hint');
  const t = S.therapists.find(x => x.id === tid);
  if (!t || !date) { hourSel.innerHTML = ALL_HOURS.map(h => `<option value="${h}">${hourRange(h)}</option>`).join(''); hint.textContent = ''; return; }
  const wd = weekdayOf(date);
  const ws = t.work_schedule || {};
  const hours = (ws[String(wd)] || []);
  if (!hours.length) {
    hourSel.innerHTML = '<option value="">—</option>';
    hint.textContent = `${esc(t.name)} לא עובד ביום ${WEEKDAYS[wd]} — בחר תאריך אחר`;
    return;
  }
  hourSel.innerHTML = hours.map(h => `<option value="${h}">${hourRange(h)}</option>`).join('');
  hint.textContent = `שעות העבודה של ${t.name} ביום ${WEEKDAYS[wd]}`;
}

// =====================================================================
// סדרות טיפול
// =====================================================================
function renderSeries(m) {
  const rows = S.assignments;
  m.innerHTML = `<div class="card">
    <h2>סדרות טיפול</h2>
    <div class="table-wrap">
    ${!rows.length ? '<div class="empty">אין סדרות. שבץ מטופל מתוך רשימת הממתינים.</div>' : `
    <table><thead><tr>
      <th>מטופל</th><th>מטפל</th><th>יום ושעה</th><th>התחלה</th><th>סיום צפוי</th><th>התקדמות</th><th>סטטוס</th><th></th>
    </tr></thead><tbody>
    ${rows.map(a => {
      const doneish = (a.done_count || 0) + (a.past_count || 0);
      const [sLbl, sCls] = ASTATUS[a.status] || ASTATUS.active;
      const single = a.kind === 'single';
      return `<tr>
        <td><b>${esc(a.patient_name)}</b>${single ? ' <span class="badge b-blue">פגישה בודדת</span>' : ''}</td>
        <td>${esc(a.therapist_name)}</td>
        <td>${single ? fmtDateHe(a.start_date) + ' ' : WEEKDAYS[a.weekday] + ' '}${hourLabel(a.hour)}</td>
        <td>${fmtDateHe(a.start_date)}</td>
        <td>${fmtDateHe(a.last_date)}</td>
        <td>${single ? '—' : `${doneish} / ${a.total_sessions} ${a.cancelled_count ? `<span class="hint">(${a.cancelled_count} בוטלו)</span>` : ''}`}</td>
        <td><span class="badge ${sCls}">${sLbl}</span></td>
        <td style="white-space:nowrap">
          <button class="btn sm sec" onclick="openSessionsModal(${a.id})">פגישות</button>
          ${S.me.caps.del && a.status === 'active' ? `<button class="btn sm danger" onclick="cancelAssignment(${a.id})">בטל סדרה</button>` : ''}
        </td>
      </tr>`;
    }).join('')}
    </tbody></table>`}
    </div>
  </div>`;
}

async function cancelAssignment(id) {
  if (!confirm('לבטל את הסדרה? כל הפגישות העתידיות יבוטלו והמטופל יחזור לרשימת ההמתנה (אם אין לו סדרה נוספת).')) return;
  try {
    const r = await api('/assignments/' + id + '/cancel', { method: 'PUT' });
    toast(`הסדרה בוטלה (${r.cancelled_sessions} פגישות עתידיות)`);
    await loadAll(); render();
  } catch (e) { toast(e.message, true); }
}

async function openSessionsModal(aid) {
  const a = S.assignments.find(x => x.id === aid);
  let sessions = [];
  try { sessions = await api('/assignments/' + aid + '/sessions'); } catch (e) { toast(e.message, true); return; }
  showModal(`
  <h2>פגישות — ${esc(a.patient_name)} אצל ${esc(a.therapist_name)} <button class="x" onclick="closeModal()">✕</button></h2>
  <div class="table-wrap"><table><thead><tr><th>#</th><th>תאריך</th><th>יום</th><th>שעה</th><th>סטטוס</th><th></th></tr></thead><tbody>
  ${sessions.map(s => {
    const [lbl, cls] = SSTATUS[s.status] || SSTATUS.scheduled;
    return `<tr>
      <td>${s.session_num}</td><td>${fmtDateHe(s.date)}</td><td>${WEEKDAYS[weekdayOf(s.date)]}</td><td>${hourRange(s.hour)}</td>
      <td><span class="badge ${cls}">${lbl}</span></td>
      <td style="white-space:nowrap">
      ${S.me.caps.edit && s.status === 'scheduled' ? `
        <button class="btn sm green" onclick="setSessionStatus(${s.id},'done',${aid})">בוצעה</button>
        <button class="btn sm sec" onclick="setSessionStatus(${s.id},'no_show',${aid})">לא הגיע</button>
        <button class="btn sm sec" onclick="setSessionStatus(${s.id},'cancelled',${aid})">בטל</button>` : ''}
      ${S.me.caps.edit && s.status !== 'scheduled' ? `<button class="btn sm sec" onclick="setSessionStatus(${s.id},'scheduled',${aid})">החזר לתזמון</button>` : ''}
      </td>
    </tr>`;
  }).join('')}
  </tbody></table></div>`);
}

async function setSessionStatus(sid, status, aid) {
  try {
    await api('/assignments/sessions/' + sid, { method: 'PUT', body: { status } });
    await loadAll();
    render();               // רענון הטבלאות/הלוח שמאחורי המודאל (התקדמות, סטטוס "הושלמה")
    openSessionsModal(aid); // והמודאל עצמו נפתח מחדש מעל
  } catch (e) { toast(e.message, true); }
}

// =====================================================================
// לוח שנה + זמינות
// =====================================================================
function renderCalendar(m) {
  m.innerHTML = `<div class="card">
    <div class="toolbar">
      <button class="btn ${S.calMode === 'week' ? '' : 'sec'}" onclick="S.calMode='week';render()">לוח שבועי למטפל</button>
      <button class="btn ${S.calMode === 'avail' ? '' : 'sec'}" onclick="S.calMode='avail';render()">שעות פנויות</button>
      <button class="btn ${S.calMode === 'holidays' ? '' : 'sec'}" onclick="S.calMode='holidays';render()">ימי חופש וחג</button>
    </div>
    <div id="cal-body"></div>
  </div>`;
  if (S.calMode === 'week') renderWeekView();
  else if (S.calMode === 'holidays') renderHolidaysView();
  else renderAvailView();
}

// ===== ניהול ימי חופש וחג =====
async function renderHolidaysView() {
  const body = document.getElementById('cal-body');
  body.innerHTML = `
  <div class="hint" style="margin-bottom:12px">
    בתאריכים שמוגדרים כאן לא נקבעות פגישות: יצירת סדרה מדלגת עליהם אוטומטית לשבוע הבא,
    ופגישה בודדת נחסמת. אפשר להוסיף יום בודד או טווח (למשל כל חול המועד).
  </div>
  ${S.me.caps.edit ? `
  <form id="hol-form" class="toolbar" style="align-items:end">
    <div class="field"><label>מתאריך *</label><input type="date" name="from" required></div>
    <div class="field"><label>עד תאריך (ריק = יום בודד)</label><input type="date" name="to"></div>
    <div class="field"><label>שם (למשל: פסח)</label><input name="name" style="min-width:160px"></div>
    <button class="btn">הוסף</button>
  </form>` : ''}
  <div id="hol-list"><div class="empty">טוען...</div></div>`;

  if (S.me.caps.edit) {
    document.getElementById('hol-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const r = await api('/holidays', { method: 'POST', body: {
          from: fd.get('from'), to: fd.get('to') || fd.get('from'), name: fd.get('name') } });
        toast(`נוספו ${r.added} ימי חופש`);
        renderHolidaysView();
      } catch (err) { toast(err.message, true); }
    });
  }
  loadHolidaysList();
}

async function loadHolidaysList() {
  const el = document.getElementById('hol-list');
  try {
    const from = addDaysStr(todayStr(), -30);
    const rows = await api(`/holidays?from=${from}`);
    if (!rows.length) { el.innerHTML = '<div class="empty">אין ימי חופש מוגדרים</div>'; return; }
    el.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>תאריך</th><th>יום</th><th>שם</th><th></th></tr></thead><tbody>
      ${rows.map(h => `<tr ${h.date < todayStr() ? 'style="opacity:.5"' : ''}>
        <td>${fmtDateHe(h.date)}</td>
        <td>${WEEKDAYS[weekdayOf(h.date)]}</td>
        <td>${esc(h.name || '')}</td>
        <td>${S.me.caps.edit ? `<button class="btn sm sec" onclick="deleteHoliday(${h.id})">🗑</button>` : ''}</td>
      </tr>`).join('')}
      </tbody></table></div>
      <div class="hint" style="margin-top:8px">מוצגים ימים מ-30 הימים האחרונים והלאה</div>`;
  } catch (e) { el.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

async function deleteHoliday(id) {
  try { await api('/holidays/' + id, { method: 'DELETE' }); loadHolidaysList(); }
  catch (e) { toast(e.message, true); }
}

async function renderWeekView() {
  const body = document.getElementById('cal-body');
  const active = S.therapists.filter(t => !t.deleted);
  if (!active.length) { body.innerHTML = '<div class="empty">אין מטפלים במערכת — הוסף בלשונית מטפלים</div>'; return; }
  if (!S.calTherapist || !active.some(t => t.id === S.calTherapist)) S.calTherapist = active[0].id;
  if (!S.calStart) S.calStart = addDaysStr(todayStr(), -weekdayOf(todayStr()));

  body.innerHTML = `
  <div class="cal-nav">
    <div class="field" style="margin:0"><select onchange="S.calTherapist=Number(this.value);renderWeekView()" style="min-width:170px">
      ${active.map(t => `<option value="${t.id}" ${t.id === S.calTherapist ? 'selected' : ''}>${esc(t.name)}${t.active ? '' : ' (לא פעיל)'}</option>`).join('')}
    </select></div>
    <button class="btn sec sm" onclick="S.calStart=addDaysStr(S.calStart,-7);renderWeekView()">◀ שבוע קודם</button>
    <div class="title" id="cal-title"></div>
    <button class="btn sec sm" onclick="S.calStart=addDaysStr(S.calStart,7);renderWeekView()">שבוע הבא ▶</button>
    <button class="btn sec sm" onclick="S.calStart=addDaysStr(todayStr(),-weekdayOf(todayStr()));renderWeekView()">היום</button>
  </div>
  <div class="table-wrap" id="cal-grid"><div class="empty">טוען...</div></div>`;

  try {
    const r = await api(`/calendar/week?therapist_id=${S.calTherapist}&start=${S.calStart}`);
    S.calStart = r.week_start;
    document.getElementById('cal-title').textContent = `${fmtDateHe(r.week_start)} — ${fmtDateHe(r.week_end)}`;
    const ws = r.therapist.work_schedule || {};
    const byKey = new Map();
    for (const s of r.sessions) byKey.set(`${s.date}|${s.hour}`, s);
    const holByDate = new Map();
    for (const h of (r.holidays || [])) holByDate.set(h.date, h.name || 'חופש');
    const days = Array.from({ length: 7 }, (_, i) => addDaysStr(r.week_start, i));
    const today = todayStr();

    document.getElementById('cal-grid').innerHTML = `<table class="cal-table">
      <thead><tr><th></th>${days.map((d, i) => `<th${holByDate.has(d) ? ' class="cal-th-holiday"' : ''}>${WEEKDAYS[i]}<br><small>${fmtDateHe(d)}</small>${holByDate.has(d) ? `<br><small class="cal-holiday-name">🏖 ${esc(holByDate.get(d))}</small>` : ''}</th>`).join('')}</tr></thead>
      <tbody>
      ${ALL_HOURS.map(h => `<tr>
        <td class="hlabel">${hourRange(h)}</td>
        ${days.map((d, i) => {
          const s = byKey.get(`${d}|${h}`);
          const working = (ws[String(i)] || []).includes(h);
          const pastCls = d < today ? ' cal-slot-past' : '';
          if (s) {
            const [lbl] = SSTATUS[s.status] || SSTATUS.scheduled;
            const numTxt = s.kind === 'single' ? 'פגישה בודדת' : `פגישה ${s.session_num}/${s.total_sessions}`;
            return `<td class="cal-slot-busy${pastCls}" onclick="openSessionsModal(${s.assignment_id})">${esc(s.patient_name)}<small>${numTxt}${s.status !== 'scheduled' ? ' · ' + lbl : ''}</small></td>`;
          }
          if (holByDate.has(d)) return `<td class="cal-slot-holiday" title="${esc(holByDate.get(d))}"></td>`;
          if (working) return `<td class="cal-slot-free${pastCls}">פנוי</td>`;
          return `<td class="cal-slot-off"></td>`;
        }).join('')}
      </tr>`).join('')}
      </tbody></table>`;
  } catch (e) {
    document.getElementById('cal-grid').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

async function renderAvailView() {
  const body = document.getElementById('cal-body');
  body.innerHTML = `
  <div class="toolbar">
    <div class="field"><label>טווח שבועות קדימה</label><select onchange="S.availWeeks=Number(this.value);renderAvailView()">
      ${[2, 4, 6, 8, 12].map(w => `<option value="${w}" ${S.availWeeks === w ? 'selected' : ''}>${w} שבועות</option>`).join('')}
    </select></div>
    <div class="field"><label>סינון לפי מטופל (שעות + העדפה)</label><select onchange="S.availPatient=this.value;renderAvailView()">
      <option value="">— כל המטפלים —</option>
      ${S.patients.filter(p => p.status === 'waiting').map(p => `<option value="${p.id}" ${S.availPatient == p.id ? 'selected' : ''}>${esc(p.last_name)} ${esc(p.first_name)}</option>`).join('')}
    </select></div>
  </div>
  <div id="avail-list"><div class="empty">טוען...</div></div>`;

  try {
    const q = S.availPatient ? `&patient_id=${S.availPatient}` : '';
    const r = await api(`/calendar/availability?weeks=${S.availWeeks}${q}`);
    const el = document.getElementById('avail-list');
    if (!r.therapists.length) { el.innerHTML = '<div class="empty">אין מטפלים תואמים</div>'; return; }
    el.innerHTML = `<div class="hint" style="margin-bottom:10px">משבצת "פנויה" = יום ושעה שהמטפל עובד בהם ואין בהם אף פגישה מתוזמנת ב-${r.weeks} השבועות הקרובים</div>` +
      r.therapists.map(t => `
      <div class="avail-therapist">
        <div class="head"><b>${esc(t.name)}</b>
          <span class="badge ${t.total_free ? 'b-green' : 'b-gray'}">${t.total_free ? t.total_free + ' משבצות פנויות' : 'אין משבצות פנויות'}</span>
        </div>
        <div class="slot-chips">
          ${t.free_slots.map(s => {
            const click = S.availPatient ? `onclick="pickSlotFromAvail(${S.availPatient},${t.therapist_id},${s.weekday},${s.hour})"` : '';
            return `<span class="slot-chip" ${click}>${WEEKDAYS[s.weekday]} ${hourLabel(s.hour)}</span>`;
          }).join('') || '<span class="hint">—</span>'}
        </div>
      </div>`).join('');
  } catch (e) {
    document.getElementById('avail-list').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

function pickSlotFromAvail(pid, tid, weekday, hour) {
  openAssignModal(Number(pid)).then(() => {
    pickSlot(tid, weekday, hour);
  });
}

// =====================================================================
// מטפלים + קבוצות
// =====================================================================
function renderTherapists(m) {
  m.innerHTML = `
  <div class="card">
    <div class="toolbar">
      <h2 style="margin:0">מטפלים</h2>
      <div class="spacer"></div>
      ${S.me.caps.edit ? `<button class="btn sec" onclick="openImportModal('therapists')">📄 ייבוא מאקסל</button>` : ''}
      ${S.me.caps.edit ? `<button class="btn" onclick="openTherapistModal(null)">+ מטפל חדש</button>` : ''}
    </div>
    <div class="table-wrap">
    ${!S.therapists.length ? '<div class="empty">אין מטפלים</div>' : `
    <table><thead><tr><th>שם</th><th>טלפון</th><th>ימי עבודה</th><th>שעות שבועיות</th><th>קבוצות</th><th>פעיל</th><th></th></tr></thead><tbody>
    ${S.therapists.map(t => {
      const ws = t.work_schedule || {};
      const days = Object.keys(ws).map(Number).sort().map(d => WEEKDAYS[d]).join(', ') || '—';
      const totalH = Object.values(ws).reduce((n, arr) => n + (arr ? arr.length : 0), 0);
      return `<tr>
        <td><b>${esc(t.name)}</b>${t.notes ? `<div class="hint">${esc(t.notes)}</div>` : ''}</td>
        <td>${esc(t.phone || '')}</td>
        <td style="font-size:13px">${days}</td>
        <td>${totalH}</td>
        <td>${(t.groups || []).map(g => `<span class="member-chip">${esc(g.name)}</span>`).join(' ')}</td>
        <td>${t.active ? '<span class="badge b-green">פעיל</span>' : '<span class="badge b-gray">לא פעיל</span>'}</td>
        <td style="white-space:nowrap">
          ${S.me.caps.edit ? `<button class="btn sm sec" onclick="openTherapistModal(${t.id})">עריכה</button>` : ''}
          ${S.me.caps.del ? `<button class="btn sm sec" onclick="deleteTherapist(${t.id})">🗑</button>` : ''}
        </td>
      </tr>`;
    }).join('')}
    </tbody></table>`}
    </div>
  </div>

  <div class="card">
    <div class="toolbar">
      <h2 style="margin:0">קבוצות מטפלים</h2>
      <div class="spacer"></div>
      ${S.me.caps.edit ? `<button class="btn sec" onclick="createGroup()">+ קבוצה חדשה</button>` : ''}
    </div>
    <div class="hint" style="margin-bottom:10px">קבוצה (למשל "מטפלים חרדים") משמשת להעדפת שיוך של מטופל — בבחירתה יוצגו כל המטפלים התואמים שבה</div>
    ${!S.groups.length ? '<div class="empty">אין קבוצות</div>' : S.groups.map(g => `
      <div class="group-row">
        <b>${esc(g.name)}</b>
        <span>${(g.members || []).map(mm => `<span class="member-chip">${esc(mm.name)}</span>`).join(' ') || '<span class="hint">אין מטפלים בקבוצה</span>'}</span>
        <div class="spacer"></div>
        ${S.me.caps.edit ? `<button class="btn sm sec" onclick="openGroupMembers(${g.id})">עריכת חברים</button>` : ''}
        ${S.me.caps.del ? `<button class="btn sm sec" onclick="deleteGroup(${g.id})">🗑</button>` : ''}
      </div>`).join('')}
  </div>`;
}

function openTherapistModal(id) {
  const t = id ? S.therapists.find(x => x.id === id) : null;
  const ws = t ? (t.work_schedule || {}) : {};
  showModal(`
  <h2>${t ? 'עריכת מטפל' : 'מטפל חדש'} <button class="x" onclick="closeModal()">✕</button></h2>
  <form id="therapist-form">
    <div class="grid3">
      <div class="field"><label>שם *</label><input name="name" value="${esc(t ? t.name : '')}" required></div>
      <div class="field"><label>טלפון</label><input name="phone" value="${esc(t ? t.phone : '')}"></div>
      <div class="field"><label>אימייל</label><input name="email" value="${esc(t ? t.email : '')}"></div>
    </div>
    <div class="field"><label>הערות</label><input name="notes" value="${esc(t ? t.notes : '')}"></div>
    <div class="field"><label><input type="checkbox" name="active" style="width:auto" ${!t || t.active ? 'checked' : ''}> מטפל פעיל</label></div>
    <div class="field">
      <label>לו"ז עבודה שבועי — לחץ על משבצת להפעלה/כיבוי (בכל יום: לחיצה על שם היום מסמנת/מנקה את כולו)</label>
      <div class="table-wrap"><table class="sched-table">
        <thead><tr><th class="hcol">שעה</th>${WEEKDAYS.map((d, i) => `<th>${d}<button type="button" class="sched-day-toggle" onclick="toggleSchedDay(${i})">הכל</button></th>`).join('')}</tr></thead>
        <tbody>
        ${ALL_HOURS.map(h => `<tr>
          <th class="hcol">${hourRange(h)}</th>
          ${WEEKDAYS.map((_, d) => `<td><button type="button" class="sched-cell ${(ws[String(d)] || []).includes(h) ? 'on' : ''}" data-d="${d}" data-h="${h}" onclick="this.classList.toggle('on')"></button></td>`).join('')}
        </tr>`).join('')}
        </tbody>
      </table></div>
    </div>
    <div class="modal-actions">
      <button class="btn">${t ? 'שמירה' : 'הוספה'}</button>
      <button type="button" class="btn sec" onclick="closeModal()">ביטול</button>
    </div>
  </form>`);
  document.getElementById('therapist-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const schedule = {};
    document.querySelectorAll('.sched-cell.on').forEach(c => {
      const d = c.dataset.d;
      (schedule[d] = schedule[d] || []).push(Number(c.dataset.h));
    });
    const body = {
      name: fd.get('name'), phone: fd.get('phone'), email: fd.get('email'), notes: fd.get('notes'),
      active: fd.get('active') === 'on', work_schedule: schedule,
    };
    try {
      if (t) await api('/therapists/' + t.id, { method: 'PUT', body });
      else await api('/therapists', { method: 'POST', body });
      toast('נשמר'); closeModal(); await loadAll(); render();
    } catch (err) { toast(err.message, true); }
  });
}

function toggleSchedDay(d) {
  const cells = [...document.querySelectorAll(`.sched-cell[data-d="${d}"]`)];
  const allOn = cells.every(c => c.classList.contains('on'));
  cells.forEach(c => c.classList.toggle('on', !allOn));
}

async function deleteTherapist(id) {
  if (!confirm('למחוק את המטפל?')) return;
  try { await api('/therapists/' + id, { method: 'DELETE' }); toast('נמחק'); await loadAll(); render(); }
  catch (e) { toast(e.message, true); }
}

async function createGroup() {
  const name = prompt('שם הקבוצה (למשל: מטפלים חרדים):');
  if (!name || !name.trim()) return;
  try {
    const g = await api('/groups', { method: 'POST', body: { name: name.trim() } });
    await loadAll(); render();
    openGroupMembers(g.id);
  } catch (e) { toast(e.message, true); }
}

function openGroupMembers(gid) {
  const g = S.groups.find(x => x.id === gid);
  if (!g) return;
  const memberIds = new Set((g.members || []).map(m => m.id));
  showModal(`
  <h2>חברי הקבוצה — ${esc(g.name)} <button class="x" onclick="closeModal()">✕</button></h2>
  <div class="field"><label>שם הקבוצה</label><input id="group-name" value="${esc(g.name)}"></div>
  <div class="field"><label>סמן את המטפלים התואמים לקבוצה זו</label>
    <div class="checkbox-list" id="group-members-list">
      ${S.therapists.filter(t => t.active).map(t => `<label><input type="checkbox" value="${t.id}" ${memberIds.has(t.id) ? 'checked' : ''}> ${esc(t.name)}</label>`).join('') || '<span class="hint">אין מטפלים פעילים</span>'}
    </div>
  </div>
  <div class="modal-actions">
    <button class="btn" onclick="saveGroupMembers(${g.id})">שמירה</button>
    <button type="button" class="btn sec" onclick="closeModal()">ביטול</button>
  </div>`);
}

async function saveGroupMembers(gid) {
  const name = document.getElementById('group-name').value.trim();
  const ids = [...document.querySelectorAll('#group-members-list input:checked')].map(c => Number(c.value));
  try {
    if (name) await api('/groups/' + gid, { method: 'PUT', body: { name } });
    await api('/groups/' + gid + '/members', { method: 'PUT', body: { therapist_ids: ids } });
    toast('הקבוצה נשמרה'); closeModal(); await loadAll(); render();
  } catch (e) { toast(e.message, true); }
}

async function deleteGroup(id) {
  if (!confirm('למחוק את הקבוצה? (המטפלים עצמם לא יימחקו)')) return;
  try { await api('/groups/' + id, { method: 'DELETE' }); toast('נמחקה'); await loadAll(); render(); }
  catch (e) { toast(e.message, true); }
}

// =====================================================================
// משתמשים
// =====================================================================
let _users = [], _roles = [];
async function renderUsers(m) {
  m.innerHTML = '<div class="card"><div class="empty">טוען...</div></div>';
  try {
    const [users, roles] = await Promise.all([api('/users'), api('/users/roles')]);
    _users = users; _roles = roles;
    m.innerHTML = `<div class="card">
      <div class="toolbar">
        <h2 style="margin:0">משתמשים והרשאות</h2>
        <div class="spacer"></div>
        <button class="btn" onclick="openUserModal(null)">+ משתמש חדש</button>
      </div>
      <div class="table-wrap"><table><thead><tr><th>שם משתמש</th><th>שם מלא</th><th>תפקיד</th><th>פעיל</th><th>כניסה אחרונה</th><th></th></tr></thead><tbody>
      ${users.map(u => `<tr>
        <td><b>${esc(u.username)}</b></td>
        <td>${esc(u.full_name || '')}</td>
        <td>${esc(u.role_label)}</td>
        <td>${u.active ? '<span class="badge b-green">פעיל</span>' : '<span class="badge b-gray">מושבת</span>'}</td>
        <td>${u.last_login ? fmtDateHe(u.last_login.slice(0, 10)) : '—'}</td>
        <td><button class="btn sm sec" onclick="openUserModal(${u.id})">עריכה</button></td>
      </tr>`).join('')}
      </tbody></table></div>
      <div class="hint" style="margin-top:10px">
        מנהל ראשי — הכל כולל ניהול משתמשים · מנהל — עריכה ומחיקה · רכז/ת — עריכה בלבד (ללא מחיקה) · צופה — צפייה בלבד
      </div>
    </div>`;
  } catch (e) { m.innerHTML = `<div class="card"><div class="empty">${esc(e.message)}</div></div>`; }
}

function openUserModal(userId) {
  const u = userId ? _users.find(x => x.id === userId) : null;
  const roles = _roles;
  showModal(`
  <h2>${u ? 'עריכת משתמש — ' + esc(u.username) : 'משתמש חדש'} <button class="x" onclick="closeModal()">✕</button></h2>
  <form id="user-form">
    <div class="grid2">
      <div class="field"><label>שם משתמש *</label><input name="username" value="${esc(u ? u.username : '')}" required autocomplete="off" minlength="3"></div>
      <div class="field"><label>שם מלא</label><input name="full_name" value="${esc(u ? u.full_name : '')}"></div>
      <div class="field"><label>תפקיד</label><select name="role">
        ${roles.map(r => `<option value="${r.role}" ${u && u.role === r.role ? 'selected' : ''}>${r.label}</option>`).join('')}
      </select></div>
      <div class="field"><label>${u ? 'סיסמא חדשה (ריק = ללא שינוי)' : 'סיסמא *'}</label><input name="password" type="password" autocomplete="new-password" ${u ? '' : 'required'}></div>
      ${u ? `<div class="field"><label><input type="checkbox" name="active" style="width:auto" ${u.active ? 'checked' : ''}> משתמש פעיל</label></div>` : ''}
    </div>
    <div class="modal-actions">
      <button class="btn">${u ? 'שמירה' : 'יצירה'}</button>
      <button type="button" class="btn sec" onclick="closeModal()">ביטול</button>
    </div>
  </form>`);
  document.getElementById('user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      if (u) {
        const r = await api('/users/' + u.id, { method: 'PUT', body: {
          username: fd.get('username'), full_name: fd.get('full_name'), role: fd.get('role'),
          active: fd.get('active') === 'on', password: fd.get('password') || undefined } });
        if (r.self_renamed) {
          alert('שם המשתמש שלך שונה ל-"' + r.username + '". יש להתחבר מחדש.');
          logout(); return;
        }
      } else {
        await api('/users', { method: 'POST', body: {
          username: fd.get('username'), password: fd.get('password'),
          role: fd.get('role'), full_name: fd.get('full_name') } });
      }
      toast('נשמר'); closeModal(); render();
    } catch (err) { toast(err.message, true); }
  });
}

// =====================================================================
// קבצים מצורפים למטופל
// =====================================================================
function fileSize(n) {
  if (!n) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
function fileIcon(name, mime) {
  const e = String(name || '').split('.').pop().toLowerCase();
  if (/^image\//.test(mime || '') || ['jpg','jpeg','png','gif','webp','bmp','heic'].includes(e)) return '🖼';
  if (e === 'pdf') return '📕';
  if (['doc','docx','rtf','odt'].includes(e)) return '📘';
  if (['xls','xlsx','csv'].includes(e)) return '📗';
  if (['zip','rar','7z'].includes(e)) return '🗜';
  return '📄';
}

async function openFilesModal(patientId) {
  const p = S.patients.find(x => x.id === patientId);
  if (!p) return;
  showModal(`
  <h2>קבצים — ${esc(p.last_name)} ${esc(p.first_name)} <button class="x" onclick="closeModal()">✕</button></h2>
  ${S.me.caps.edit ? `
    <div class="imp-drop" id="fl-drop">
      <div style="font-size:30px">📎</div>
      <div style="margin:6px 0 2px"><b>גרור לכאן קבצים</b> או לחץ לבחירה</div>
      <div class="hint">אפשר לבחור כמה קבצים יחד · עד <span id="fl-max">15</span>MB לקובץ</div>
      <input type="file" id="fl-input" multiple style="display:none">
    </div>
    <div id="fl-progress" class="hint" style="margin-top:8px"></div>` : ''}
  <div style="margin-top:14px"><div id="fl-list"><div class="hint">טוען...</div></div></div>
  <div class="modal-actions"><button type="button" class="btn sec" onclick="closeModal()">סגירה</button></div>`);

  if (S.me.caps.edit) {
    // המגבלה נקראת מהשרת כדי שהטקסט לא ייפרד מההגדרה בפועל
    api('/files/limits').then(l => {
      const el = document.getElementById('fl-max');
      if (el && l && l.max_mb) el.textContent = l.max_mb;
    }).catch(() => {});
    const drop = document.getElementById('fl-drop');
    const input = document.getElementById('fl-input');
    drop.onclick = () => input.click();
    input.onchange = () => input.files.length && uploadFiles(patientId, input.files);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('on'); };
    drop.ondragleave = () => drop.classList.remove('on');
    drop.ondrop = (e) => {
      e.preventDefault(); drop.classList.remove('on');
      if (e.dataTransfer.files.length) uploadFiles(patientId, e.dataTransfer.files);
    };
  }
  loadFilesList(patientId);
}

let _filesPoll = null;
async function loadFilesList(patientId) {
  const el = document.getElementById('fl-list');
  if (!el) { clearTimeout(_filesPoll); return; }
  try {
    const files = await api('/files/patient/' + patientId);
    if (!files.length) { el.innerHTML = '<div class="hint">אין קבצים מצורפים</div>'; return; }
    el.innerHTML = `<div class="pref-count">${files.length} קבצים:</div>` + files.map(f => {
      const drive = f.drive_url
        ? `<a class="drive-ok" href="${esc(f.drive_url)}" target="_blank" rel="noopener" title="מגובה ב-Drive — פתח">☁ Drive</a>`
        : f.drive_error ? `<span class="drive-err" title="${esc(f.drive_error)}">⚠ גיבוי נכשל</span>`
        : `<span class="hint">⏳ מגבה...</span>`;
      return `<div class="file-row">
        <span class="file-ico">${fileIcon(f.filename, f.mime)}</span>
        <div class="file-main">
          <a href="#" onclick="downloadFile(${f.id});return false">${esc(f.filename)}</a>
          <div class="hint">${fileSize(f.size_bytes)} · ${esc(f.uploaded_by_name || '')} · ${fmtDateHe(String(f.created_at).slice(0,10))}</div>
        </div>
        ${drive}
        ${S.me.caps.del ? `<button class="btn sm sec" onclick="deleteFile(${f.id},${patientId})">🗑</button>` : ''}
      </div>`;
    }).join('');
    // הגיבוי רץ ברקע — רענון קצר כדי שהסטטוס יתעדכן מעצמו
    if (files.some(f => !f.drive_url && !f.drive_error) && document.getElementById('fl-list')) {
      clearTimeout(_filesPoll);
      _filesPoll = setTimeout(() => loadFilesList(patientId), 5000);
    }
  } catch (e) { el.innerHTML = `<div class="hint">${esc(e.message)}</div>`; }
}

// הורדה מאומתת: הטוקן נשלח בכותרת, לא ב-URL
async function downloadFile(id) {
  try {
    const res = await fetch('/api/files/' + id + '/download', { headers: { Authorization: 'Bearer ' + S.token } });
    if (!res.ok) {
      // התשובה לא בהכרח JSON: חוסם רשת או שגיאת nginx מחזירים HTML,
      // ובלי הפירוט הזה כל תקלה נראית אותו דבר
      const raw = await res.text().catch(() => '');
      let err = null;
      try { err = JSON.parse(raw).error; } catch (e) { /* לא JSON */ }
      if (err) throw new Error(err);
      const kind = /netfree/i.test(raw) ? 'החסימה של נטפרי חסמה את ההורדה'
        : /<html/i.test(raw) ? 'התקבל דף HTML במקום הקובץ (חוסם רשת או שרת proxy)'
        : `שגיאה ${res.status}`;
      throw new Error(`ההורדה נכשלה — ${kind}`);
    }
    const cd = res.headers.get('Content-Disposition') || '';
    const m = /filename\*=UTF-8''([^;]+)/.exec(cd) || /filename="([^"]+)"/.exec(cd);
    const name = m ? decodeURIComponent(m[1]) : 'file';
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) { toast(e.message, true); }
}

async function uploadFiles(patientId, fileList) {
  const prog = document.getElementById('fl-progress');
  const fd = new FormData();
  [...fileList].forEach(f => fd.append('files', f));
  prog.textContent = `מעלה ${fileList.length} קבצים...`;
  try {
    const res = await fetch('/api/files/patient/' + patientId, {
      method: 'POST', headers: { Authorization: 'Bearer ' + S.token }, body: fd,
    });
    const d = await res.json().catch(() => null);
    if (!res.ok) throw new Error((d && d.error) || 'ההעלאה נכשלה');
    prog.textContent = '';
    toast(`הועלו ${d.length} קבצים`);
    loadFilesList(patientId);
    await loadAll();
    renderWaitingTable();   // רענון מונה האטבים בטבלה שמאחורי המודאל
  } catch (e) { prog.textContent = ''; toast(e.message, true); }
}

async function deleteFile(id, patientId) {
  if (!confirm('למחוק את הקובץ?')) return;
  try {
    await api('/files/' + id, { method: 'DELETE' });
    loadFilesList(patientId);
    await loadAll();
    renderWaitingTable();
  } catch (e) { toast(e.message, true); }
}

// =====================================================================
// ייבוא מאקסל
// =====================================================================
// שדות היעד לכל סוג ייבוא. keys = מה שהשרת מצפה לקבל.
const IMPORT_FIELDS = {
  patients: [
    { key: 'last_name', label: 'שם משפחה', hints: ['משפחה', 'שם משפחה'] },
    { key: 'first_name', label: 'שם פרטי', hints: ['פרטי', 'שם פרטי'] },
    { key: 'therapist_names', label: 'מטפלים מותאמים', hints: ['מטפל', 'מטפלים', 'שיוך', 'התאמה'] },
    { key: 'national_id', label: 'מספר זהות', hints: ['זהות', 'ת.ז', 'תז', 'ת"ז'] },
    { key: 'intake_date', label: 'תאריך אינטייק', hints: ['אינטייק', 'קליטה'] },
    { key: 'birth_date', label: 'תאריך לידה', hints: ['לידה'] },
    { key: 'hmo', label: 'קופת חולים', hints: ['קופה', 'קופת'] },
    { key: 'client_type', label: 'בן / בת', hints: ['בן/בת', 'מין', 'סוג'] },
    { key: 'community', label: 'השתייכות קהילתית', hints: ['קהיל', 'השתייכות', 'מגזר'] },
    { key: 'diagnosis', label: 'אבחנה', hints: ['אבחנ'] },
    { key: 'urgency', label: 'רמת דחיפות', hints: ['דחיפ'] },
    { key: 'notes', label: 'הערות', hints: ['הערות'] },
    { key: 'notes2', label: 'הערות נוספות', hints: ['הערות נוספות', 'הערה 2'] },
  ],
  therapists: [
    { key: 'name', label: 'שם המטפל', hints: ['שם', 'מטפל'] },
    { key: 'phone', label: 'טלפון', hints: ['טלפון', 'נייד', 'פלאפון'] },
    { key: 'email', label: 'אימייל', hints: ['מייל', 'דוא'] },
    { key: 'notes', label: 'הערות', hints: ['הערות'] },
  ],
  existing: [
    { key: 'last_name', label: 'שם משפחה', hints: ['משפחה', 'שם משפחה'] },
    { key: 'first_name', label: 'שם פרטי', hints: ['פרטי', 'שם פרטי'] },
    { key: 'therapist_name', label: 'שם המטפל', hints: ['מטפל', 'שם מטפל'] },
    { key: 'start_date', label: 'תאריך התחלה', hints: ['התחלה', 'תאריך'] },
    { key: 'hour', label: 'שעה', hints: ['שעה'] },
    { key: 'total_sessions', label: 'כמות פגישות', hints: ['כמות', 'פגישות', 'טיפולים'] },
    { key: 'national_id', label: 'מספר זהות', hints: ['זהות', 'ת.ז', 'תז', 'ת"ז'] },
    { key: 'notes', label: 'הערות', hints: ['הערות'] },
  ],
};

let _imp = { target: 'patients', headers: [], rows: [], map: {}, fileName: '' };

function openImportModal(target) {
  _imp = { target, headers: [], rows: [], map: {}, fileName: '' };
  const title = target === 'patients' ? 'ייבוא מטופלים מאקסל'
    : target === 'existing' ? 'ייבוא מטופלים קיימים מאקסל' : 'ייבוא מטפלים מאקסל';
  showModal(`
  <h2>${title} <button class="x" onclick="closeModal()">✕</button></h2>
  <div class="step"><div class="on" id="st1"></div><div id="st2"></div><div id="st3"></div></div>
  <div id="imp-body">
    <div class="imp-drop" id="imp-drop">
      <div style="font-size:34px">📄</div>
      <div style="margin:8px 0 4px"><b>גרור לכאן קובץ אקסל</b> או לחץ לבחירה</div>
      <div class="hint">נתמכים: .xlsx · .xls · .csv — הקובץ נקרא בדפדפן ולא נשלח לשום מקום</div>
      <input type="file" id="imp-file" accept=".xlsx,.xls,.csv" style="display:none">
    </div>
    ${target === 'patients' ? `<div class="hint" style="margin-top:10px">
      אם יש בקובץ עמודה עם שמות המטפלים שהתאמת למטופל — סמן אותה כ״מטפלים מותאמים״ בשלב הבא.
      אפשר שיהיו כמה שמות באותו תא, מופרדים בפסיק, נקודה-פסיק, קו נטוי או שורה חדשה.</div>` : ''}
    ${target === 'existing' ? `<div class="hint" style="margin-top:10px">
      הקובץ צריך להכיל לכל מטופל: <b>שם, שם המטפל, תאריך התחלה ושעה</b>. לכל אחד תיווצר סדרת
      פגישות שבועית (דילוג אוטומטי על ימי חופש). שם המטפל חייב להתאים למטפל שקיים במערכת.</div>` : ''}
  </div>`);

  const drop = document.getElementById('imp-drop');
  const input = document.getElementById('imp-file');
  drop.onclick = () => input.click();
  input.onchange = () => input.files[0] && readImportFile(input.files[0]);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('on'); };
  drop.ondragleave = () => drop.classList.remove('on');
  drop.ondrop = (e) => {
    e.preventDefault(); drop.classList.remove('on');
    if (e.dataTransfer.files[0]) readImportFile(e.dataTransfer.files[0]);
  };
}

function readImportFile(file) {
  _imp.fileName = file.name;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
      if (raw.length < 2) return toast('הקובץ ריק או שיש בו רק שורת כותרות', true);
      _imp.headers = raw[0].map((h, i) => String(h || '').trim() || `עמודה ${i + 1}`);
      _imp.rows = raw.slice(1).filter(r => r.some(c => String(c || '').trim() !== ''));
      autoMapColumns();
      renderImportMapping();
    } catch (err) {
      toast('לא הצלחתי לקרוא את הקובץ: ' + err.message, true);
    }
  };
  reader.readAsArrayBuffer(file);
}

// ניחוש ראשוני של העמודות לפי מילות מפתח בכותרת
function autoMapColumns() {
  _imp.map = {};
  const used = new Set();
  for (const f of IMPORT_FIELDS[_imp.target]) {
    let best = -1, bestLen = 0;
    _imp.headers.forEach((h, i) => {
      if (used.has(i)) return;
      const hn = h.replace(/["'׳״]/g, '').toLowerCase();
      for (const hint of f.hints) {
        if (hn.includes(hint.toLowerCase()) && hint.length > bestLen) { best = i; bestLen = hint.length; }
      }
    });
    if (best >= 0) { _imp.map[f.key] = best; used.add(best); }
  }
}

function renderImportMapping() {
  document.getElementById('st2').classList.add('on');
  const fields = IMPORT_FIELDS[_imp.target];
  const cols = _imp.headers.map((h, i) => `<option value="${i}">${esc(h)}</option>`).join('');
  document.getElementById('imp-body').innerHTML = `
    <div class="imp-summary">
      📄 <b>${esc(_imp.fileName)}</b> — נמצאו <b>${_imp.rows.length}</b> שורות ו-<b>${_imp.headers.length}</b> עמודות
    </div>
    <label>התאמת עמודות — ודא שכל שדה מצביע לעמודה הנכונה</label>
    <div class="imp-map">
      ${fields.map(f => `
        <div class="row">
          <span>${f.label}</span>
          <select onchange="_imp.map['${f.key}']=this.value===''?undefined:Number(this.value);renderImportPreview()">
            <option value="">— ללא —</option>${cols}
          </select>
        </div>`).join('')}
    </div>
    <div style="margin-top:12px"><label>תצוגה מקדימה (5 שורות ראשונות)</label><div id="imp-preview"></div></div>
    <div class="modal-actions">
      <button class="btn" onclick="runImport()">ייבא</button>
      <button type="button" class="btn sec" onclick="closeModal()">ביטול</button>
    </div>`;
  // בחירת ערכי ברירת המחדל שנוחשו
  const sels = document.querySelectorAll('.imp-map select');
  fields.forEach((f, i) => { if (_imp.map[f.key] !== undefined) sels[i].value = String(_imp.map[f.key]); });
  renderImportPreview();
}

function renderImportPreview() {
  const fields = IMPORT_FIELDS[_imp.target].filter(f => _imp.map[f.key] !== undefined);
  const el = document.getElementById('imp-preview');
  if (!fields.length) { el.innerHTML = '<div class="hint">לא נבחרה אף עמודה</div>'; return; }
  el.innerHTML = `<div class="imp-prev"><table><thead><tr>${fields.map(f => `<th>${f.label}</th>`).join('')}</tr></thead><tbody>
    ${_imp.rows.slice(0, 5).map(r => `<tr>${fields.map(f => `<td>${esc(r[_imp.map[f.key]] || '')}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div>`;
}

// בונה את השורות לשליחה לפי מיפוי העמודות
function buildImportRows() {
  const fields = IMPORT_FIELDS[_imp.target];
  return _imp.rows.map(r => {
    const o = {};
    for (const f of fields) {
      if (_imp.map[f.key] === undefined) continue;
      let v = r[_imp.map[f.key]];
      if (v instanceof Date) v = v.toISOString().slice(0, 10);
      o[f.key] = String(v == null ? '' : v).trim();
    }
    return o;
  });
}

async function runImport() {
  const rows = buildImportRows();
  if (!rows.length) return toast('אין שורות לייבוא', true);

  if (_imp.target === 'therapists') {
    if (_imp.map.name === undefined) return toast('חובה לבחור עמודת שם', true);
    return sendImport('/import/therapists', { rows });
  }

  if (_imp.target === 'existing') {
    for (const [k, label] of [['therapist_name', 'שם המטפל'], ['start_date', 'תאריך התחלה'], ['hour', 'שעה']]) {
      if (_imp.map[k] === undefined) return toast(`חובה לבחור עמודת ${label}`, true);
    }
    if (_imp.map.last_name === undefined && _imp.map.first_name === undefined) {
      return toast('חובה לבחור לפחות עמודת שם משפחה או שם פרטי', true);
    }
    // בדיקת שמות המטפלים לפני שנוצרת ולו סדרה אחת
    const names = rows.map(r => r.therapist_name).filter(Boolean);
    let check;
    try { check = await api('/import/check-therapists', { method: 'POST', body: { names } }); }
    catch (e) { return toast(e.message, true); }
    if (check.missing.length) return showExistingMissingStep(rows, check);
    return sendImport('/import/existing', { rows });
  }

  if (_imp.map.last_name === undefined && _imp.map.first_name === undefined) {
    return toast('חובה לבחור לפחות עמודת שם משפחה או שם פרטי', true);
  }
  // אין עמודת מטפלים — אין מה לבדוק, מייבאים ישר
  if (_imp.map.therapist_names === undefined) return sendImport('/import/patients', { rows });

  // יש עמודת מטפלים: בודקים אילו שמות מוכרים לפני שכותבים משהו
  const names = [];
  rows.forEach(r => String(r.therapist_names || '').split(/[,;\/|\n\r]+/)
    .map(s => s.trim()).filter(Boolean).forEach(n => names.push(n)));
  let check;
  try { check = await api('/import/check-therapists', { method: 'POST', body: { names } }); }
  catch (e) { return toast(e.message, true); }
  showTherapistMatchStep(rows, check);
}

function showTherapistMatchStep(rows, check) {
  document.getElementById('st3').classList.add('on');
  document.getElementById('imp-body').innerHTML = `
    <div class="imp-summary">
      נמצאו <b>${check.matched.length}</b> שמות מטפלים שכבר במערכת
      ${check.missing.length ? ` ו-<b style="color:var(--red)">${check.missing.length}</b> שמות שלא מוכרים` : ''}
    </div>
    ${check.matched.length ? `<label>יזוהו ויקושרו אוטומטית</label>
      <div class="name-list">${check.matched.map(m => `<span class="name-ok">${esc(m.input)}${norm2(m.input) !== norm2(m.existing) ? ' → ' + esc(m.existing) : ''}</span>`).join('')}</div>` : ''}
    ${check.missing.length ? `
      <label style="margin-top:14px">שמות שלא נמצאו במערכת</label>
      <div class="name-list">${check.missing.map(n => `<span class="name-miss">${esc(n)}</span>`).join('')}</div>
      <div class="field" style="margin-top:12px">
        <label><input type="checkbox" id="imp-create" style="width:auto" checked> ליצור אותם כמטפלים חדשים</label>
        <div class="hint">אם לא תסמן — השמות האלה פשוט לא ישויכו, והמטופלים ייובאו בלעדיהם.
        אפשר להשלים ידנית אחר כך בטופס המטופל.</div>
      </div>` : ''}
    <div class="modal-actions">
      <button class="btn" onclick="finishPatientImport()">ייבא ${rows.length} מטופלים</button>
      <button type="button" class="btn sec" onclick="renderImportMapping()">חזרה</button>
    </div>`;
  _imp.pending = rows;
}

function norm2(s) { return String(s || '').replace(/["'׳״]/g, '').replace(/\s+/g, ' ').trim().toLowerCase(); }

// ייבוא מטופלים קיימים: שם מטפל שלא קיים במערכת = שורה שתיכשל.
// עוצרים ומראים לפני, כדי שלא יתגלה רק בדוח בסוף.
function showExistingMissingStep(rows, check) {
  document.getElementById('st3').classList.add('on');
  const affected = rows.filter(r => check.missing.some(m => norm2(m) === norm2(r.therapist_name))).length;
  document.getElementById('imp-body').innerHTML = `
    <div class="imp-summary">
      <b style="color:var(--red)">${check.missing.length}</b> שמות מטפלים בקובץ לא קיימים במערכת,
      ולכן <b>${affected}</b> שורות לא ייובאו.
    </div>
    <label>שמות שלא נמצאו</label>
    <div class="name-list">${check.missing.map(n => `<span class="name-miss">${esc(n)}</span>`).join('')}</div>
    <div class="hint" style="margin-top:10px">
      בדוק אם מדובר בשגיאת כתיב בקובץ, או הוסף את המטפלים בלשונית ״מטפלים״ (כולל לו״ז עבודה) והרץ שוב.
      אפשר גם להמשיך — שאר ${rows.length - affected} השורות ייובאו והשאר יופיעו בדוח.
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="sendImport('/import/existing', { rows: _imp.pending })">ייבא בכל זאת ${rows.length - affected} שורות</button>
      <button type="button" class="btn sec" onclick="renderImportMapping()">חזרה</button>
    </div>`;
  _imp.pending = rows;
}

function finishPatientImport() {
  const cb = document.getElementById('imp-create');
  sendImport('/import/patients', {
    rows: _imp.pending,
    create_missing_therapists: cb ? cb.checked : false,
  });
}

async function sendImport(path, body) {
  const btns = document.querySelectorAll('#modal-root .btn');
  btns.forEach(b => b.disabled = true);
  const body2 = document.getElementById('imp-body');
  if (body2) body2.insertAdjacentHTML('afterbegin', '<div class="hint" id="imp-wait">מייבא, זה עשוי לקחת כמה שניות...</div>');
  try {
    const r = await api(path, { method: 'POST', body });
    // ייבוא מטופלים קיימים מחזיר דוח מפורט — מציגים אותו במקום להיעלם
    if (r.failed && r.failed.length) return showImportReport(r);
    closeModal();
    await loadAll(); render();
    let msg = `יובאו ${r.added} רשומות`;
    if (r.total_sessions) msg += ` (${r.total_sessions} פגישות)`;
    if (r.created_therapists && r.created_therapists.length) msg += `, נוצרו ${r.created_therapists.length} מטפלים חדשים`;
    if (r.skipped && r.skipped.length) msg += `, ${r.skipped.length} דולגו`;
    if (r.unmatched && r.unmatched.length) msg += `, ${r.unmatched.length} שמות לא שויכו`;
    toast(msg);
  } catch (e) {
    btns.forEach(b => b.disabled = false);
    const w = document.getElementById('imp-wait'); if (w) w.remove();
    toast(e.message, true);
  }
}

// דוח סיום לייבוא מטופלים קיימים: מה נכנס, ומה נכשל ולמה — שורה-שורה
function showImportReport(r) {
  showModal(`
  <h2>דוח ייבוא <button class="x" onclick="closeModalAndRefresh()">✕</button></h2>
  <div class="imp-summary">
    ✅ יובאו <b>${r.added}</b> מטופלים${r.total_sessions ? ` עם <b>${r.total_sessions}</b> פגישות` : ''}
    ${r.failed.length ? ` · ❌ <b style="color:var(--red)">${r.failed.length}</b> שורות נכשלו` : ''}
  </div>
  <label>שורות שלא נכנסו</label>
  <div class="table-wrap" style="max-height:320px;overflow:auto">
    <table><thead><tr><th>שורה באקסל</th><th>שם</th><th>סיבה</th></tr></thead><tbody>
    ${r.failed.map(f => `<tr><td>${f.line}</td><td>${esc(f.label)}</td><td style="color:var(--red)">${esc(f.reason)}</td></tr>`).join('')}
    </tbody></table>
  </div>
  <div class="hint" style="margin-top:8px">תקן את השורות האלה בקובץ והרץ ייבוא נוסף — מה שכבר נכנס לא ייווצר שוב בכפילות אם תשמיט אותן.</div>
  <div class="modal-actions"><button class="btn" onclick="closeModalAndRefresh()">סגירה</button></div>`);
}
async function closeModalAndRefresh() { closeModal(); await loadAll(); render(); }

// ===== מודאל גנרי =====
function showModal(html) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal">${html}</div></div>`;
}
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

boot();
