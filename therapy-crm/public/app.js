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
  filters: { q: '', urgency: '', status: 'waiting', hmo: '' },
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
      <div class="field"><label>חיפוש</label><input id="f-q" value="${esc(f.q)}" placeholder="שם / ת.ז / אבחנה" oninput="S.filters.q=this.value;renderWaitingTable()"></div>
      <div class="field"><label>סטטוס</label><select onchange="S.filters.status=this.value;renderWaitingTable()">
        <option value="" ${f.status === '' ? 'selected' : ''}>הכל</option>
        <option value="waiting" ${f.status === 'waiting' ? 'selected' : ''}>ממתין</option>
        <option value="assigned" ${f.status === 'assigned' ? 'selected' : ''}>משובץ</option>
        <option value="done" ${f.status === 'done' ? 'selected' : ''}>הסתיים</option>
      </select></div>
      <div class="field"><label>דחיפות</label><select onchange="S.filters.urgency=this.value;renderWaitingTable()">
        <option value="">הכל</option>
        <option value="1" ${f.urgency === '1' ? 'selected' : ''}>1 — דחוף</option>
        <option value="2" ${f.urgency === '2' ? 'selected' : ''}>2 — רגיל</option>
        <option value="3" ${f.urgency === '3' ? 'selected' : ''}>3 — נמוך</option>
      </select></div>
      <div class="field"><label>קופה</label><select onchange="S.filters.hmo=this.value;renderWaitingTable()">
        <option value="">הכל</option>
        ${S.meta.hmos.map(h => `<option ${f.hmo === h ? 'selected' : ''}>${h}</option>`).join('')}
      </select></div>
      <div class="spacer"></div>
      ${S.me.caps.edit ? `<button class="btn" onclick="openPatientModal(null)">+ מטופל חדש</button>` : ''}
    </div>
    <div class="table-wrap" id="waiting-table"></div>
  </div>`;
  renderWaitingTable();
}

function renderWaitingTable() {
  const f = S.filters;
  const rows = S.patients.filter(p => {
    if (f.status && p.status !== f.status) return false;
    if (f.urgency && String(p.urgency) !== f.urgency) return false;
    if (f.hmo && p.hmo !== f.hmo) return false;
    if (f.q) {
      const t = `${p.last_name} ${p.first_name} ${p.national_id || ''} ${p.community || ''} ${p.diagnosis || ''}`;
      if (!t.includes(f.q)) return false;
    }
    return true;
  });
  const el = document.getElementById('waiting-table');
  if (!el) return;
  if (!rows.length) { el.innerHTML = `<div class="empty">אין מטופלים להצגה</div>`; return; }
  el.innerHTML = `<table><thead><tr>
    <th>שם</th><th>ת.ז</th><th>גיל</th><th>קופה</th><th>סוג</th><th>קהילה</th><th>אינטייק</th><th>דחיפות</th><th>העדפת שיוך</th><th>סטטוס</th><th></th>
  </tr></thead><tbody>
  ${rows.map(p => {
    const age = calcAge(p.birth_date);
    const [uLbl, uCls] = URGENCY[p.urgency] || URGENCY[2];
    const [sLbl, sCls] = PSTATUS[p.status] || PSTATUS.waiting;
    const pref = p.preferred_therapist_name ? '👤 ' + esc(p.preferred_therapist_name)
      : p.preferred_group_name ? '👥 ' + esc(p.preferred_group_name) : '—';
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
      <td><span class="badge ${sCls}">${sLbl}</span></td>
      <td style="white-space:nowrap">
        ${S.me.caps.edit && p.status === 'waiting' ? `<button class="btn sm green" onclick="openAssignModal(${p.id})">שבץ</button>` : ''}
        ${S.me.caps.edit ? `<button class="btn sm sec" onclick="openPatientModal(${p.id})">עריכה</button>` : ''}
        ${S.me.caps.del ? `<button class="btn sm sec" onclick="deletePatient(${p.id})">🗑</button>` : ''}
      </td>
    </tr>`;
  }).join('')}
  </tbody></table>`;
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
  const prefMode = p && p.preferred_therapist_id ? 'therapist' : p && p.preferred_group_id ? 'group' : 'none';
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
    <div class="field"><label>הערות</label><textarea name="notes" rows="2">${esc(p ? p.notes : '')}</textarea></div>

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
      <label>שיוך למטפל / קבוצת מטפלים</label>
      <div class="grid3">
        <div class="field"><select name="pref_mode" onchange="prefModeChanged(this.value)">
          <option value="none" ${prefMode === 'none' ? 'selected' : ''}>ללא העדפה</option>
          <option value="therapist" ${prefMode === 'therapist' ? 'selected' : ''}>מטפל ספציפי</option>
          <option value="group" ${prefMode === 'group' ? 'selected' : ''}>קבוצת מטפלים</option>
        </select></div>
        <div class="field" id="pref-therapist" style="display:${prefMode === 'therapist' ? 'block' : 'none'}">
          <select name="preferred_therapist_id">
            ${S.therapists.filter(t => t.active).map(t => `<option value="${t.id}" ${p && p.preferred_therapist_id === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field" id="pref-group" style="display:${prefMode === 'group' ? 'block' : 'none'}">
          <select name="preferred_group_id" onchange="showGroupMembersHint(this.value)">
            ${S.groups.map(g => `<option value="${g.id}" ${p && p.preferred_group_id === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="hint" id="group-members-hint"></div>
    </div>

    <div class="modal-actions">
      <button class="btn">${p ? 'שמירה' : 'הוספה'}</button>
      <button type="button" class="btn sec" onclick="closeModal()">ביטול</button>
    </div>
  </form>`);
  if (prefMode === 'group' && p) showGroupMembersHint(p.preferred_group_id);
  document.getElementById('patient-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const prefModeV = fd.get('pref_mode');
    const body = {
      last_name: fd.get('last_name'), first_name: fd.get('first_name'),
      national_id: fd.get('national_id'), intake_date: fd.get('intake_date') || null,
      birth_date: fd.get('birth_date') || null, hmo: fd.get('hmo') || null,
      client_type: fd.get('client_type') || null, community: fd.get('community') === '__new__' ? null : (fd.get('community') || null),
      diagnosis: fd.get('diagnosis'), notes: fd.get('notes'), urgency: Number(fd.get('urgency')),
      hours: [...document.querySelectorAll('#hours-grid .hour-chip.on')].map(c => Number(c.dataset.h)),
      preferred_therapist_id: prefModeV === 'therapist' ? Number(fd.get('preferred_therapist_id')) : null,
      preferred_group_id: prefModeV === 'group' ? Number(fd.get('preferred_group_id')) : null,
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
function prefModeChanged(v) {
  document.getElementById('pref-therapist').style.display = v === 'therapist' ? 'block' : 'none';
  document.getElementById('pref-group').style.display = v === 'group' ? 'block' : 'none';
  document.getElementById('group-members-hint').textContent = '';
  if (v === 'group') {
    const sel = document.querySelector('[name=preferred_group_id]');
    if (sel && sel.value) showGroupMembersHint(sel.value);
  }
}
function showGroupMembersHint(gid) {
  const g = S.groups.find(x => x.id === Number(gid));
  const el = document.getElementById('group-members-hint');
  if (g && el) el.textContent = g.members && g.members.length
    ? 'מטפלים תואמים בקבוצה: ' + g.members.map(m => m.name).join(', ')
    : 'אין עדיין מטפלים בקבוצה זו';
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
    ${p.preferred_therapist_name ? ' · העדפה: ' + esc(p.preferred_therapist_name) : ''}
    ${p.preferred_group_name ? ' · קבוצה מועדפת: ' + esc(p.preferred_group_name) : ''}
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
    try {
      const r = await api('/assignments', {
        method: 'POST', body: {
          patient_id: p.id, therapist_id: Number(fd.get('therapist_id')),
          total_sessions: Number(fd.get('total_sessions')), start_date: fd.get('start_date'),
          hour: Number(fd.get('hour')), notes: fd.get('notes'),
        }
      });
      let msg = `נוצרה סדרה של ${r.sessions.length} פגישות`;
      if (r.skipped.length) msg += ` (דילוג על ${r.skipped.length} שבועות תפוסים)`;
      if (r.warnings.length) msg += '. ' + r.warnings.join('. ');
      toast(msg);
      closeModal(); await loadAll(); render();
    } catch (err) { toast(err.message, true); }
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
      return `<tr>
        <td><b>${esc(a.patient_name)}</b></td>
        <td>${esc(a.therapist_name)}</td>
        <td>${WEEKDAYS[a.weekday]} ${hourLabel(a.hour)}</td>
        <td>${fmtDateHe(a.start_date)}</td>
        <td>${fmtDateHe(a.last_date)}</td>
        <td>${doneish} / ${a.total_sessions} ${a.cancelled_count ? `<span class="hint">(${a.cancelled_count} בוטלו)</span>` : ''}</td>
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
    await loadAll(); openSessionsModal(aid);
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
    </div>
    <div id="cal-body"></div>
  </div>`;
  if (S.calMode === 'week') renderWeekView();
  else renderAvailView();
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
    const days = Array.from({ length: 7 }, (_, i) => addDaysStr(r.week_start, i));
    const today = todayStr();

    document.getElementById('cal-grid').innerHTML = `<table class="cal-table">
      <thead><tr><th></th>${days.map((d, i) => `<th>${WEEKDAYS[i]}<br><small>${fmtDateHe(d)}</small></th>`).join('')}</tr></thead>
      <tbody>
      ${ALL_HOURS.map(h => `<tr>
        <td class="hlabel">${hourRange(h)}</td>
        ${days.map((d, i) => {
          const s = byKey.get(`${d}|${h}`);
          const working = (ws[String(i)] || []).includes(h);
          const pastCls = d < today ? ' cal-slot-past' : '';
          if (s) {
            const [lbl] = SSTATUS[s.status] || SSTATUS.scheduled;
            return `<td class="cal-slot-busy${pastCls}" onclick="openSessionsModal(${s.assignment_id})">${esc(s.patient_name)}<small>פגישה ${s.session_num}/${s.total_sessions}${s.status !== 'scheduled' ? ' · ' + lbl : ''}</small></td>`;
          }
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

// ===== מודאל גנרי =====
function showModal(html) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal">${html}</div></div>`;
}
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

boot();
