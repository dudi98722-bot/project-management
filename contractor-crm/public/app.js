/* ============================================================
   UI + ניתוב. עובד זהה מול השרת ומול מצב ההדגמה (window.Store).
   ============================================================ */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const view = () => $('#view');
  const caps = () => window.Auth.caps();

  // ---------- utils ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // מאשר רק http(s) או נתיב יחסי באתר (חוסם javascript:/data: בקישורי חשבונית)
  const safeUrl = (u) => { u = String(u == null ? '' : u).trim(); return (/^https?:\/\//i.test(u) || /^\/[^/]/.test(u)) ? u : ''; };
  const invoiceLink = (u) => { const s = safeUrl(u); return s ? `<a class="link" href="${esc(s)}" target="_blank" rel="noopener noreferrer">📎 צפה</a>` : (String(u || '').startsWith('#') ? '<span class="mini">📎 דמו</span>' : ''); };
  const money = (n) => (Math.round(+n || 0)).toLocaleString('he-IL') + ' ₪';
  const money0 = (n) => (Math.round(+n || 0)).toLocaleString('he-IL');
  const dfmt = (d) => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '';
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const TYPE_HE = { client_payment: 'תשלום מלקוח', sub_payment: 'תשלום לקבלן משנה', project_expense: 'הוצאה לפרויקט', business_expense: 'הוצאת עסק' };
  const STATUS_HE = { active: 'פעיל', paused: 'מושהה', done: 'הושלם', pending: 'ממתין', in_progress: 'בביצוע' };
  const SOURCE_HE = { form: 'טופס', bank: 'בנק', credit: 'אשראי', cash: 'מזומן', transfer: 'העברה' };
  const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  const monLabel = (ym) => { if (!ym) return ''; const p = String(ym).split('-'); return HE_MONTHS[+p[1] - 1] + ' ' + p[0]; };

  function toast(msg, type) {
    const t = $('#toast'); t.textContent = msg; t.className = 'show ' + (type || '');
    clearTimeout(t._t); t._t = setTimeout(() => { t.className = ''; }, 2600);
  }
  function loading() { view().innerHTML = '<div class="empty"><div class="big">⏳</div>טוען...</div>'; }
  async function guard(promise) { try { return await promise; } catch (e) { toast(e.message || 'שגיאה', 'err'); throw e; } }

  // ---------- modal ----------
  function openModal(title, bodyHtml, buttons) {
    const root = $('#modalRoot');
    const bs = (buttons || []).map((b, i) => `<button class="btn ${b.cls || ''}" data-mi="${i}">${esc(b.label)}</button>`).join('');
    root.innerHTML = `<div class="modal-bg"><div class="modal"><div class="m-head"><h3>${esc(title)}</h3><button class="x" data-close>&times;</button></div>
      <div class="m-body">${bodyHtml}</div>${bs ? `<div class="m-foot">${bs}</div>` : ''}</div></div>`;
    const bg = $('.modal-bg', root);
    const close = () => { root.innerHTML = ''; };
    $('[data-close]', root).onclick = close;
    bg.onclick = (e) => { if (e.target === bg) close(); };
    (buttons || []).forEach((b, i) => { const el = root.querySelector(`[data-mi="${i}"]`); if (el) el.onclick = () => b.onClick(close); });
    return { close, root };
  }
  function confirmDialog(msg, okLabel) {
    return new Promise(res => {
      openModal('אישור', `<p style="margin:0">${esc(msg)}</p>`, [
        { label: okLabel || 'אישור', cls: 'red', onClick: (c) => { c(); res(true); } },
        { label: 'ביטול', cls: 'ghost', onClick: (c) => { c(); res(false); } },
      ]);
    });
  }
  function fv(id) { const e = document.getElementById(id); return e ? e.value.trim() : ''; }

  // ============================================================
  //  BOOTSTRAP
  // ============================================================
  function wireLogin() {
    $('#loginBtn').onclick = doLogin;
    $('#loginForm').onsubmit = (e) => { e.preventDefault(); doLogin(); };
    $('#demoBtn').onclick = () => { window.__demo = true; window.Auth.demo(); enterApp(); };
    $('#logoutBtn').onclick = () => { window.Auth.logout(); location.reload(); };
  }
  async function doLogin() {
    const u = fv('loginUser'), p = fv('loginPass'), err = $('#loginErr');
    if (!u || !p) { err.textContent = 'יש למלא שם משתמש וסיסמא'; return; }
    err.textContent = 'מאמת...'; $('#loginBtn').disabled = true;
    try { await window.Auth.login(u, p); enterApp(); }
    catch (e) { err.textContent = e.message || 'התחברות נכשלה'; $('#loginPass').value = ''; }
    finally { $('#loginBtn').disabled = false; }
  }

  function enterApp() {
    $('#loginScreen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    const u = window.Auth.user;
    $('#userName').textContent = u.full_name || u.username;
    $('#userRole').textContent = ROLE_HE[u.role] || u.role;
    $('#demoBadge').classList.toggle('hidden', !window.Store.isDemo);
    buildTabs();
  }
  const ROLE_HE = { admin: 'מנהל', secretary: 'מזכירה', owner: 'בעל עסק', reporter: 'מדווח', field: 'עובד שטח', home: 'בית' };

  // ============================================================
  //  TABS / ROUTER
  // ============================================================
  const TABS = [
    { id: 'dashboard', label: '📊 לוח בקרה', show: c => c.viewReports, fn: scrDashboard },
    { id: 'projects', label: '🏗️ פרויקטים', show: c => c.viewBusiness, fn: scrProjects },
    { id: 'subs', label: '👷 קבלני משנה', show: c => c.viewBusiness, fn: scrSubs },
    { id: 'tx', label: '💰 תנועות', show: c => c.viewBusiness, fn: scrTx },
    { id: 'daily', label: '📅 דוח יומי', show: c => c.viewBusiness, fn: scrDaily },
    { id: 'projexp', label: '🧱 הוצאה לפרויקט', show: c => c.viewBusiness, fn: scrProjExp },
    { id: 'biz', label: '🧾 הוצאות עסק', show: c => c.viewBusiness, fn: scrBiz },
    { id: 'payreq', label: '🧮 בקשת תשלום', show: c => c.viewBusiness, fn: scrPayRequest },
    { id: 'reports', label: '📈 דוחות', show: c => c.viewReports, fn: scrReports },
    { id: 'field', label: '📥 הזנת הוצאה', show: c => c.projectExpenseOnly && !c.writeTx && !c.viewBusiness, fn: scrField },
    { id: 'home', label: '🏠 בית', show: c => c.home, fn: scrHome },
    { id: 'recycle', label: '♻️ סל מחזור', show: c => c.del || c.writeTx, fn: scrRecycle },
    { id: 'users', label: '👤 משתמשים', show: c => c.manageUsers, fn: scrUsers },
  ];
  let activeTab = null;
  function buildTabs() {
    const c = caps();
    const avail = TABS.filter(t => t.show(c));
    $('#tabs').innerHTML = avail.map(t => `<button data-tab="${t.id}">${t.label}</button>`).join('');
    $('#tabs').querySelectorAll('[data-tab]').forEach(b => b.onclick = () => go(b.dataset.tab));
    if (avail.length) go(avail[0].id);
    else view().innerHTML = '<div class="empty">אין לך הרשאות מוגדרות. פנה למנהל.</div>';
  }
  function go(id) {
    const t = TABS.find(x => x.id === id); if (!t) return;
    activeTab = id;
    $('#tabs').querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
    t.fn();
  }
  function refresh() { const t = TABS.find(x => x.id === activeTab); if (t) t.fn(); }

  // ============================================================
  //  DASHBOARD
  // ============================================================
  async function scrDashboard() {
    loading();
    const o = await guard(window.Store.reports.overview());
    view().innerHTML = `
      <div class="page-head"><h2>לוח בקרה</h2><div class="spacer"></div></div>
      <div class="grid stat-grid">
        ${stat('פרויקטים פעילים', o.projects_active + ' / ' + o.projects_total, '')}
        ${stat('צפוי להיכנס מלקוחות', money(o.total_open_client), 'g')}
        ${stat('יתרה לתשלום לקבלני משנה', money(o.total_open_sub), 'r')}
        ${stat('צפי רווח עתידי', money(o.future_profit), o.future_profit >= 0 ? 'g' : 'r', 'צפוי מלקוחות פחות צפוי לקבלנים')}
        ${stat('הוצאות עסק', money(o.total_business_expenses), 'r')}
      </div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px">
        <div class="card"><h3>גבייה מלקוחות</h3><div id="gaugeClient"></div></div>
        <div class="card"><h3>תשלום לקבלני משנה</h3><div id="gaugeSub"></div></div>
      </div>
      <div class="card"><h3>נגבה מהלקוח מול שולם לקבלן — לפי פרויקט</h3><div id="clientVsSub"></div></div>
      <div class="card"><h3>רווח שנמשך לפי פרויקט</h3><div id="barsDrawn"></div></div>
      <div class="card"><h3>פרויקטים</h3>${projectMiniTable(o.per_project)}</div>`;
    drawRing($('#gaugeClient'), o.total_income, o.total_planned_income, 'נגבה', '#16a34a');
    drawRing($('#gaugeSub'), o.total_sub_paid, o.total_planned_sub, 'שולם', '#0ea5e9');
    drawDrawnBars($('#barsDrawn'), o.per_project);
    drawClientVsSub($('#clientVsSub'), o.per_project);
    view().querySelectorAll('[data-openproj]').forEach(a => a.onclick = () => { go('projects'); setTimeout(() => openProject(+a.dataset.openproj), 30); });
  }
  function stat(label, value, cls, sub) {
    return `<div class="stat"><div class="label">${esc(label)}</div><div class="value ${cls || ''}">${value}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;
  }
  function gapText(gap) { if (Math.round(gap) === 0) return 'בדיוק ביעד'; return gap > 0 ? 'מעל היעד ב־' + money(gap) : 'מתחת ליעד ב־' + money(-gap); }
  function projectMiniTable(rows) {
    if (!rows.length) return '<div class="empty">אין פרויקטים עדיין</div>';
    const body = rows.map(p => {
      const clientRem = (p.planned_income || 0) - (p.income || 0);
      const subRem = (p.planned_sub || 0) - (p.sub_paid || 0);
      const drawn = p.actual_profit;
      const rem = (v) => `<td class="num" style="color:${v > 0.5 ? 'var(--brand-d)' : 'var(--muted)'}">${money0(v)}</td>`;
      return `<tr>
        <td><a class="link" data-openproj="${p.id}">${esc(p.name)}</a></td>
        <td class="num">${money0(p.planned_income)}</td>
        <td class="num" style="color:var(--green)">${money0(p.income)}</td>
        ${rem(clientRem)}
        <td class="num">${money0(p.planned_sub)}</td>
        <td class="num" style="color:var(--red)">${money0(p.sub_paid)}</td>
        ${rem(subRem)}
        <td class="num" style="color:var(--red)">${money0(p.project_expenses)}</td>
        <td class="num" style="font-weight:800;color:${drawn >= 0 ? 'var(--green)' : 'var(--red)'}">${money0(drawn)}</td>
      </tr>`;
    }).join('');
    return `<div style="overflow-x:auto"><table style="min-width:820px"><thead>
      <tr>
        <th rowspan="2">פרויקט</th>
        <th colspan="3" class="center" style="border-inline:1px solid var(--line)">לקוח</th>
        <th colspan="3" class="center" style="border-inline:1px solid var(--line)">קבלן משנה</th>
        <th rowspan="2">הוצאות</th>
        <th rowspan="2">רווח שנמשך</th>
      </tr>
      <tr>
        <th class="num">מחיר</th><th class="num">שילם</th><th class="num">יתרה</th>
        <th class="num">מחיר</th><th class="num">שולם</th><th class="num">יתרה</th>
      </tr>
    </thead><tbody>${body}</tbody></table></div>
    <div class="mini" style="margin-top:8px">"רווח שנמשך" = מה שנכנס מהלקוח, פחות מה ששולם לקבלן המשנה, פחות ההוצאות.</div>`;
  }
  // נגבה מהלקוח מול שולם לקבלן — לכל פרויקט, שני פסים אחד מתחת לשני להשוואה + אחוזים ופער
  function drawClientVsSub(box, rows) {
    if (!rows || !rows.length) { box.innerHTML = '<div class="empty">אין פרויקטים</div>'; return; }
    box.innerHTML = rows.map(p => {
      const cTot = +p.planned_income || 0, cGot = +p.income || 0;
      const sTot = +p.planned_sub || 0, sPaid = +p.sub_paid || 0;
      const cPct = cTot > 0 ? Math.round(cGot / cTot * 100) : 0;
      const sPct = sTot > 0 ? Math.round(sPaid / sTot * 100) : 0;
      const diff = cGot - sPaid;
      return `<div style="padding:12px 0;border-bottom:1px solid var(--line)">
        <a class="link" data-openproj="${p.id}" style="font-weight:700">${esc(p.name)}</a>
        <div style="margin-top:8px">
          <div style="margin-bottom:10px">
            <div class="mini" style="display:flex;justify-content:space-between;margin-bottom:3px"><span>🟢 נגבה מהלקוח</span><span><b>${money0(cGot)}</b> מתוך ${money0(cTot)} · <b style="color:var(--green)">${cPct}%</b></span></div>
            <div class="bar"><span style="width:${Math.min(100, cPct)}%;background:var(--green)"></span></div>
          </div>
          <div>
            <div class="mini" style="display:flex;justify-content:space-between;margin-bottom:3px"><span>🔵 שולם לקבלן</span><span><b>${money0(sPaid)}</b> מתוך ${money0(sTot)} · <b style="color:var(--accent)">${sPct}%</b></span></div>
            <div class="bar"><span style="width:${Math.min(100, sPct)}%;background:var(--accent)"></span></div>
          </div>
        </div>
        <div class="mini" style="margin-top:7px;color:${diff >= 0 ? 'var(--green)' : 'var(--red)'}">${diff >= 0 ? '↑ נכנס מהלקוח יותר ממה ששולם לקבלן ב-' : '↓ שולם לקבלן יותר ממה שנכנס ב-'}<b>${money(Math.abs(diff))}</b></div>
      </div>`;
    }).join('');
  }

  // ============================================================
  //  דוח יומי — לכל יום (30 יום אחורה): תקבולים/תשלומים/הוצאות + יתרה
  // ============================================================
  const ymd = (dt) => dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  async function scrDaily() {
    loading();
    const DAYS = 30;
    const toStr = today();
    const fromDt = new Date(); fromDt.setDate(fromDt.getDate() - (DAYS - 1));
    const rows = await guard(window.Store.tx.list({ from: ymd(fromDt), to: toStr }));

    // קיבוץ לפי יום
    const byDay = {};
    rows.forEach(t => {
      const d = t.date ? String(t.date).slice(0, 10) : null; if (!d) return;
      const g = byDay[d] || (byDay[d] = { date: d, income: 0, subPaid: 0, projExp: 0, bizExp: 0, txs: [] });
      const amt = +t.amount || 0;
      if (t.type === 'client_payment') g.income += amt;
      else if (t.type === 'sub_payment') g.subPaid += amt;
      else if (t.type === 'project_expense') g.projExp += amt;
      else if (t.type === 'business_expense') g.bizExp += amt;
      g.txs.push(t);
    });
    // רשימת כל הימים (היום למעלה, אחורה)
    const days = [];
    for (let i = 0; i < DAYS; i++) { const dt = new Date(); dt.setDate(dt.getDate() - i); const k = ymd(dt); days.push(byDay[k] || { date: k, income: 0, subPaid: 0, projExp: 0, bizExp: 0, txs: [] }); }
    const tot = days.reduce((a, g) => ({ income: a.income + g.income, subPaid: a.subPaid + g.subPaid, projExp: a.projExp + g.projExp, bizExp: a.bizExp + g.bizExp }), { income: 0, subPaid: 0, projExp: 0, bizExp: 0 });
    const totBal = tot.income - tot.subPaid - tot.projExp - tot.bizExp;
    const cell = (v, col) => `<td class="num" style="color:${col}">${v ? money0(v) : '—'}</td>`;

    view().innerHTML = `
      <div class="page-head"><h2>דוח יומי</h2><span class="mini">${DAYS} הימים האחרונים · לחץ על יום לפירוט</span></div>
      <div class="card" style="padding:6px;overflow-x:auto"><table style="min-width:780px"><thead><tr>
        <th>תאריך</th><th class="num">תקבול מלקוחות</th><th class="num">תשלום לקבלן משנה</th><th class="num">הוצאות לפרויקט</th><th class="num">הוצאות עסק</th><th class="num">יתרה יומית</th>
      </tr></thead><tbody>
      ${days.map(g => {
      const bal = g.income - g.subPaid - g.projExp - g.bizExp, isToday = g.date === toStr, empty = !g.txs.length;
      return `<tr data-day="${g.date}" style="cursor:pointer${isToday ? ';background:var(--soft);font-weight:700' : ''}">
        <td>${dfmt(g.date)}${isToday ? ' <span class="mini" style="color:var(--brand-d)">היום</span>' : ''}</td>
        ${cell(g.income, 'var(--green)')}${cell(g.subPaid, 'var(--red)')}${cell(g.projExp, 'var(--red)')}${cell(g.bizExp, 'var(--red)')}
        <td class="num" style="font-weight:800;color:${bal >= 0 ? 'var(--green)' : 'var(--red)'}">${empty ? '—' : money0(bal)}</td></tr>`;
    }).join('')}
      <tr style="border-top:2px solid var(--line);font-weight:800"><td>סה"כ ${DAYS} ימים</td>
        <td class="num" style="color:var(--green)">${money0(tot.income)}</td><td class="num" style="color:var(--red)">${money0(tot.subPaid)}</td>
        <td class="num" style="color:var(--red)">${money0(tot.projExp)}</td><td class="num" style="color:var(--red)">${money0(tot.bizExp)}</td>
        <td class="num" style="color:${totBal >= 0 ? 'var(--green)' : 'var(--red)'}">${money0(totBal)}</td></tr>
      </tbody></table></div>`;

    const dayMap = {}; days.forEach(g => dayMap[g.date] = g);
    view().querySelectorAll('[data-day]').forEach(tr => tr.onclick = () => dailyDetail(tr.dataset.day, dayMap[tr.dataset.day]));
  }
  function dailyDetail(date, g) {
    const txs = (g && g.txs) || [];
    const body = txs.length ? `<div style="overflow-x:auto"><table><thead><tr><th>סוג</th><th>פרטים</th><th>חשבונית</th><th class="num">סכום</th></tr></thead><tbody>${txs.map(t => {
      const isIn = t.type === 'client_payment';
      const detail = t.type === 'business_expense' ? [t.supplier, t.purpose].filter(Boolean).join(' · ')
        : t.type === 'project_expense' ? [t.project_name, t.supplier, t.purpose].filter(Boolean).join(' · ')
          : [t.project_name, t.stage_name, t.subcontractor_name].filter(Boolean).join(' · ');
      return `<tr><td>${esc(TYPE_HE[t.type] || t.type)}</td><td class="mini">${esc(detail) || '—'}</td><td>${invoiceLink(t.invoice_url)}</td>
        <td class="num" style="font-weight:700;color:${isIn ? 'var(--green)' : 'var(--red)'}">${isIn ? '+' : '−'}${money0(t.amount)}</td></tr>`;
    }).join('')}</tbody></table></div>` : '<div class="empty">אין תנועות ביום זה</div>';
    openModal('פירוט יום ' + dfmt(date), body, [{ label: 'סגירה', cls: 'ghost', onClick: (c) => c() }]);
  }

  // ============================================================
  //  PROJECTS
  // ============================================================
  async function scrProjects() {
    loading();
    const list = await guard(window.Store.projects.list());
    const canEdit = caps().editProjects;
    view().innerHTML = `
      <div class="page-head"><h2>פרויקטים</h2><div class="spacer"></div>
        ${canEdit ? '<button class="btn" id="newProj">➕ פרויקט חדש</button>' : ''}</div>
      <div id="projList"></div>`;
    if (canEdit) $('#newProj').onclick = () => projectForm();
    renderProjectCards(list);
  }
  function renderProjectCards(list) {
    const box = $('#projList');
    if (!list.length) { box.innerHTML = '<div class="empty"><div class="big">🏗️</div>אין פרויקטים. צור פרויקט חדש כדי להתחיל.</div>'; return; }
    box.innerHTML = `<div class="card" style="padding:6px;overflow-x:auto"><table style="min-width:720px"><thead><tr>
        <th>פרויקט</th><th class="num">נכנס מלקוח</th><th class="num">שולם לקבלן</th><th class="num">הוצאות</th><th class="num">רווח צפוי</th><th class="num">רווח שנמשך</th><th class="num">% מהיעד</th>
      </tr></thead><tbody>${list.map(p => {
        const pct = p.expected_profit > 0 ? Math.max(0, Math.min(100, Math.round(p.actual_profit / p.expected_profit * 100))) : 0;
        return `<tr data-proj="${p.id}" style="cursor:pointer">
          <td><b>${esc(p.name)}</b>${p.client_name ? `<div class="mini muted">${esc(p.client_name)}</div>` : ''}</td>
          <td class="num" style="color:var(--green)">${money0(p.income)}</td>
          <td class="num" style="color:var(--red)">${money0(p.sub_paid)}</td>
          <td class="num">${money0(p.project_expenses)}</td>
          <td class="num">${money0(p.expected_profit)}</td>
          <td class="num" style="font-weight:800;color:${p.actual_profit >= 0 ? 'var(--green)' : 'var(--red)'}">${money0(p.actual_profit)}</td>
          <td class="num">${pct}%</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
    box.querySelectorAll('[data-proj]').forEach(c => c.onclick = () => openProject(+c.dataset.proj));
  }

  async function openProject(id) {
    loading();
    const d = await guard(window.Store.projects.get(id));
    const p = d.project, stages = d.stages, c = caps();
    const barPct = p.expected_profit > 0 ? Math.max(0, Math.min(100, Math.round(p.actual_profit / p.expected_profit * 100))) : 0;
    view().innerHTML = `
      <div class="page-head">
        <button class="btn ghost sm" id="backBtn">→ חזרה</button>
        <h2>${esc(p.name)}</h2>
        <div class="spacer"></div>
        ${c.editProjects ? `<button class="btn ghost sm" id="editProj">✏️ עריכה</button>` : ''}
        ${c.del ? `<button class="btn red sm" id="delProj">🗑️ מחיקה</button>` : ''}
      </div>
      <div class="card" style="padding:12px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span>👷 <b>קבלן משנה:</b></span>
        ${p.subcontractor_name ? `<span class="tag-trade" style="font-size:14px">${esc(p.subcontractor_name)}</span>` : `<span class="mini">לא הוגדר${c.editProjects ? ' — לחץ "עריכה" כדי לבחור' : ''}</span>`}
        ${p.client_name ? `<div class="spacer" style="flex:1"></div><span class="mini">לקוח: ${esc(p.client_name)}${p.client_phone ? ' · ' + esc(p.client_phone) : ''}</span>` : ''}
      </div>
      <div class="grid stat-grid">
        ${stat('רווח צפוי', money(p.expected_profit), 'a')}
        ${stat('רווח שנמשך', money(p.actual_profit), p.actual_profit >= 0 ? 'g' : 'r', gapText(p.profit_gap))}
        ${stat('נכנס מלקוח', money(p.income), '', 'מתוך ' + money(p.planned_income) + ' מתוכנן')}
        ${stat('שולם לקבלני משנה', money(p.sub_paid), '', 'מתוך ' + money(p.planned_sub) + ' מתוכנן')}
        ${stat('הוצאות כלליות', money(p.project_expenses), 'r')}
      </div>
      <div class="card"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h3 style="margin:0;flex:1">שלבים</h3>
        ${(c.editProjects || c.addStages) ? `<button class="btn sm" id="bulkStages">➕ הזנת שלבים מרוכזת</button><button class="btn ghost sm" id="importTable">📥 ייבוא מטבלה</button><button class="btn ghost sm" id="addStage">שלב בודד</button>` : ''}</div>
        <div id="stagesBox" style="margin-top:12px"></div></div>
      <div class="card"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h3 style="margin:0;flex:1">תנועות בפרויקט</h3>
        ${c.writeTx ? `<button class="btn green sm" data-newtx="client_payment">➕ תשלום מלקוח</button>
          <button class="btn sm" data-newtx="sub_payment">➖ תשלום לקבלן משנה</button>` : ''}
        ${(c.writeTx || c.projectExpenseOnly) ? `<button class="btn ghost sm" data-newtx="project_expense">🧾 הוצאה לפרויקט</button>` : ''}
      </div><div id="projTx" style="margin-top:12px"></div></div>`;
    $('#backBtn').onclick = () => scrProjects();
    if (c.editProjects) $('#editProj').onclick = () => projectForm(p);
    if (c.editProjects || c.addStages) { $('#addStage').onclick = () => stageForm(null, p.id); $('#bulkStages').onclick = () => bulkStagesForm(p.id); $('#importTable').onclick = () => importTableForm(p.id); }
    if (c.del) $('#delProj').onclick = async () => { if (await confirmDialog('להעביר את הפרויקט לסל המחזור?', 'מחיקה')) { await guard(window.Store.projects.remove(p.id)); toast('הועבר לסל המחזור', 'ok'); scrProjects(); } };
    view().querySelectorAll('[data-newtx]').forEach(b => b.onclick = () => txForm(b.dataset.newtx, { project_id: p.id, stages }));
    renderStages(stages, p, c);
    renderProjTx(p.id);
  }
  function renderStages(stages, p, c) {
    const box = $('#stagesBox');
    if (!stages.length) { box.innerHTML = '<div class="empty">אין שלבים. הוסף שלבים כדי לחלק את הפרויקט.</div>'; return; }
    box.innerHTML = `<table><thead><tr><th>#</th><th>שלב</th><th>סכום לקוח</th><th>נכנס</th><th>סכום קבלן</th><th>שולם</th>${(c.editProjects || c.del) ? '<th></th>' : ''}</tr></thead><tbody>${stages.map(s => `
      <tr><td>${s.seq}</td><td>${esc(s.name)}</td>
        <td class="num">${money(s.client_amount)}</td>
        <td class="num" style="color:var(--green)">${money(s.paid_in)}</td>
        <td class="num">${money(s.sub_amount)}</td>
        <td class="num" style="color:var(--red)">${money(s.paid_sub)}</td>
        ${(c.editProjects || c.del) ? `<td>${c.editProjects ? `<button class="btn xs ghost" data-editstage="${s.id}">✏️</button>` : ''}${c.del ? `<button class="btn xs red" data-delstage="${s.id}">🗑️</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table>`;
    if (c.editProjects || c.del) {
      box.querySelectorAll('[data-editstage]').forEach(b => b.onclick = () => { const s = stages.find(x => x.id === +b.dataset.editstage); stageForm(s, p.id); });
      box.querySelectorAll('[data-delstage]').forEach(b => b.onclick = async () => { if (await confirmDialog('למחוק את השלב?', 'מחיקה')) { await guard(window.Store.stages.remove(+b.dataset.delstage)); toast('נמחק', 'ok'); openProject(p.id); } });
    }
  }
  async function renderProjTx(pid) {
    const rows = await guard(window.Store.tx.list({ project_id: pid }));
    const box = $('#projTx'), c = caps();
    if (!rows.length) { box.innerHTML = '<div class="empty">אין תנועות בפרויקט</div>'; return; }
    box.innerHTML = txTable(rows, c);
    wireTxTable(box, () => openProject(pid), rows);
  }

  // -- project create/edit form --
  async function projectForm(p) {
    p = p || {};
    const subs = await guard(window.Store.subs.list());
    const subOpts = '<option value="">— ללא קבלן משנה —</option>' + subs.map(x => `<option value="${x.id}" ${p.subcontractor_id === x.id ? 'selected' : ''}>${esc(x.name)}${x.trade ? ' · ' + esc(x.trade) : ''}</option>`).join('');
    const subHint = subs.length ? '' : '<div class="mini">אין קבלני משנה עדיין — אפשר להוסיף בלשונית "קבלני משנה" ולחזור.</div>';
    openModal(p.id ? 'עריכת פרויקט' : 'פרויקט חדש', `
      <div class="field"><label>שם הפרויקט *</label><input id="f_name" value="${esc(p.name || '')}"></div>
      <div class="row">
        <div class="field"><label>שם הלקוח</label><input id="f_client" value="${esc(p.client_name || '')}"></div>
        <div class="field"><label>טלפון לקוח</label><input id="f_phone" value="${esc(p.client_phone || '')}"></div>
      </div>
      <div class="field"><label>כתובת</label><input id="f_addr" value="${esc(p.address || '')}"></div>
      <div class="field"><label>קבלן המשנה של הפרויקט</label><select id="f_sub">${subOpts}</select>${subHint}</div>
      <div class="row">
        <div class="field"><label>רווח צפוי (₪)</label><input id="f_profit" type="number" value="${p.expected_profit != null ? p.expected_profit : ''}"></div>
        <div class="field"><label>תאריך התחלה</label><input id="f_start" type="date" value="${p.start_date ? String(p.start_date).slice(0, 10) : ''}"></div>
        <div class="field"><label>סטטוס</label><select id="f_status">
          <option value="active" ${p.status === 'active' ? 'selected' : ''}>פעיל</option>
          <option value="paused" ${p.status === 'paused' ? 'selected' : ''}>מושהה</option>
          <option value="done" ${p.status === 'done' ? 'selected' : ''}>הושלם</option></select></div>
      </div>
      <div class="field"><label>הערות</label><textarea id="f_notes" rows="2">${esc(p.notes || '')}</textarea></div>`,
      [{ label: 'שמירה', onClick: async (close) => {
        const name = fv('f_name'); if (!name) return toast('שם פרויקט חובה', 'err');
        const d = { name, client_name: fv('f_client'), client_phone: fv('f_phone'), address: fv('f_addr'), subcontractor_id: fv('f_sub') || null, expected_profit: fv('f_profit') || 0, start_date: fv('f_start') || null, status: fv('f_status'), notes: fv('f_notes') };
        await guard(p.id ? window.Store.projects.update(p.id, d) : window.Store.projects.create(d));
        close(); toast('נשמר', 'ok'); p.id ? openProject(p.id) : scrProjects();
      } }, { label: 'ביטול', cls: 'ghost', onClick: (c) => c() }]);
  }

  // -- single stage form -- (קבלן המשנה יורש מהפרויקט, לא נבחר כאן)
  function stageForm(s, pid) {
    s = s || {};
    openModal(s.id ? 'עריכת שלב' : 'שלב חדש', `
      <div class="field"><label>שם השלב *</label><input id="s_name" value="${esc(s.name || '')}"></div>
      <div class="row">
        <div class="field"><label>סכום מהלקוח (₪)</label><input id="s_ca" type="number" value="${s.client_amount != null ? s.client_amount : ''}"></div>
        <div class="field"><label>סכום לקבלן משנה (₪)</label><input id="s_sa" type="number" value="${s.sub_amount != null ? s.sub_amount : ''}"></div>
      </div>`,
      [{ label: 'שמירה', onClick: async (close) => {
        const name = fv('s_name'); if (!name) return toast('שם שלב חובה', 'err');
        const d = { project_id: pid, name, client_amount: fv('s_ca') || 0, sub_amount: fv('s_sa') || 0 };
        await guard(s.id ? window.Store.stages.update(s.id, d) : window.Store.stages.create(d));
        close(); toast('נשמר', 'ok'); openProject(pid);
      } }, { label: 'ביטול', cls: 'ghost', onClick: (c) => c() }]);
  }

  // -- bulk stages form -- (קבלן המשנה של הפרויקט מוחל על כל השלבים)
  function bulkStagesForm(pid) {
    const rowHtml = (i) => `<tr>
      <td><input class="bs-name" placeholder="שם השלב"></td>
      <td><input class="bs-ca" type="number" placeholder="לקוח" style="width:100px"></td>
      <td><input class="bs-sa" type="number" placeholder="קבלן" style="width:100px"></td>
      <td><button class="x bs-del">&times;</button></td></tr>`;
    openModal('הזנת שלבים מרוכזת', `
      <p class="mini">מלא שורה לכל שלב: שם, סכום מהלקוח, וסכום לקבלן המשנה. קבלן המשנה של הפרויקט חל אוטומטית על כל השלבים.</p>
      <table><thead><tr><th>שלב</th><th>לקוח ₪</th><th>קבלן ₪</th><th></th></tr></thead>
      <tbody id="bsBody">${rowHtml(0) + rowHtml(1) + rowHtml(2)}</tbody></table>
      <button class="btn ghost sm" id="bsAdd" style="margin-top:10px">➕ שורה</button>`,
      [{ label: 'שמירת כל השלבים', onClick: async (close) => {
        const rows = [...document.querySelectorAll('#bsBody tr')].map(tr => ({
          name: $('.bs-name', tr).value.trim(),
          client_amount: $('.bs-ca', tr).value || 0,
          sub_amount: $('.bs-sa', tr).value || 0,
        })).filter(r => r.name);
        if (!rows.length) return toast('הזן לפחות שלב אחד', 'err');
        await guard(window.Store.projects.bulkStages(pid, rows));
        close(); toast(rows.length + ' שלבים נוספו', 'ok'); openProject(pid);
      } }, { label: 'ביטול', cls: 'ghost', onClick: (c) => c() }]);
    const wireDel = () => document.querySelectorAll('#bsBody .bs-del').forEach(b => b.onclick = () => { if (document.querySelectorAll('#bsBody tr').length > 1) b.closest('tr').remove(); });
    $('#bsAdd').onclick = () => { const t = document.createElement('tbody'); t.innerHTML = rowHtml(); $('#bsBody').appendChild(t.firstChild); wireDel(); };
    wireDel();
  }

  // ============================================================
  //  IMPORT EXISTING PROJECT FROM PASTED TABLE
  // ============================================================
  let _imp2 = null;
  const impNum = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[₪,\s]/g, '')); return isNaN(n) ? null : n; };
  const fmtc = (v) => { const n = impNum(v); return n == null ? '' : money(n); };

  function importTableForm(pid) {
    _imp2 = null;
    openModal('ייבוא שלבים ותשלומים מטבלה', `
      <p class="mini">הדבק את טבלת הפרויקט מ-Excel/Sheets (כולל שורות הכותרת). המערכת תזהה את העמודות — אפשר לתקן את המיפוי — וייווצרו השלבים והתשלומים שכבר בוצעו. עמודות "יתרה" אינן נדרשות (מחושבות).</p>
      <div class="field"><label>הדבק כאן</label><textarea id="imp2_text" rows="6" placeholder="הדבק את הטבלה..."></textarea></div>
      <button class="btn ghost sm" id="imp2_parse">נתח טבלה ↓</button>
      <div id="imp2_map" style="margin-top:12px"></div>
      <div id="imp2_preview" style="margin-top:10px;overflow-x:auto"></div>`,
      [{ label: 'ייבא', cls: 'green', onClick: async (close) => {
        const rows = collectImportRows2();
        if (!rows.length) return toast('אין שורות. לחץ "נתח טבלה" ובדוק את המיפוי', 'err');
        const r = await guard(window.Store.projects.import(pid, rows));
        close(); toast(`יובאו ${r.stages} שלבים ו-${r.payments} תשלומים`, 'ok'); openProject(pid);
      } }, { label: 'ביטול', cls: 'ghost', onClick: (c) => c() }]);
    $('#imp2_parse').onclick = doParse2;
  }
  function doParse2() {
    const lines = (fv('imp2_text') || '').split(/\r?\n/).filter(l => l.trim() !== '');
    if (!lines.length) { $('#imp2_map').innerHTML = ''; $('#imp2_preview').innerHTML = '<div class="empty">אין נתונים להדבקה</div>'; return; }
    const grid = lines.map(l => l.split('\t'));
    const cols = Math.max(...grid.map(r => r.length));
    grid.forEach(r => { while (r.length < cols) r.push(''); });
    const isData = grid.map(r => r.filter(c => impNum(c) !== null).length >= 2);
    const headerRows = grid.filter((r, i) => !isData[i]);
    const dataRows = grid.filter((r, i) => isData[i]);
    if (!dataRows.length) { $('#imp2_map').innerHTML = ''; $('#imp2_preview').innerHTML = '<div class="empty">לא זוהו שורות נתונים — ודא שהעתקת כולל העמודות עם המספרים</div>'; return; }
    const colLabel = [];
    for (let j = 0; j < cols; j++) colLabel[j] = headerRows.map(r => String(r[j] || '').trim()).filter(Boolean).join(' ') || ('עמודה ' + (j + 1));
    // עמודת שם = הכי הרבה טקסט לא-מספרי
    let nameCol = 0, best = -1;
    for (let j = 0; j < cols; j++) { const t = dataRows.filter(r => r[j] && impNum(r[j]) === null).length; if (t > best) { best = t; nameCol = j; } }
    const findMarker = (kw) => { for (const r of headerRows) for (let j = 0; j < cols; j++) if (String(r[j] || '').includes(kw)) return j; return -1; };
    const colClient = findMarker('לקוח'), colSub = findMarker('קבלן');
    // תווית קבוצה ממוזגת יושבת בעמודה הראשונה של הקבוצה -> עמודה שייכת לתווית האחרונה שלפניה
    const markers = [];
    if (colClient >= 0) markers.push({ col: colClient, type: 'client' });
    if (colSub >= 0) markers.push({ col: colSub, type: 'sub' });
    markers.sort((a, b) => a.col - b.col);
    const grp = (j) => { if (!markers.length) return null; let g = markers[0].type; for (const mk of markers) if (mk.col <= j) g = mk.type; return g; };
    const totals = [], paids = [];
    for (let j = 0; j < cols; j++) { if (j === nameCol) continue; if (colLabel[j].indexOf('סך') >= 0 && colLabel[j].indexOf('ששולם') < 0 && colLabel[j].indexOf('שולם') < 0) totals.push(j); else if (colLabel[j].indexOf('שולם') >= 0) paids.push(j); }
    const pick = (arr, want) => { const g = arr.find(j => grp(j) === want); if (g != null) return g; return want === 'client' ? (arr.length ? arr[0] : -1) : (arr.length > 1 ? arr[1] : (arr.length ? arr[0] : -1)); };
    const map = { name: nameCol, client_amount: pick(totals, 'client'), client_paid: pick(paids, 'client'), sub_amount: pick(totals, 'sub'), sub_paid: pick(paids, 'sub') };
    _imp2 = { cols, colLabel, dataRows };
    const optHtml = (sel) => '<option value="-1">— (ללא) —</option>' + Array.from({ length: cols }, (_, j) => `<option value="${j}" ${j === sel ? 'selected' : ''}>${esc((colLabel[j] || '').slice(0, 20))} · עמ' ${j + 1}</option>`).join('');
    const field = (id, label, sel) => `<div class="field" style="min-width:150px"><label>${label}</label><select class="imp2sel" data-key="${id}">${optHtml(sel)}</select></div>`;
    $('#imp2_map').innerHTML = `<div class="mini" style="margin-bottom:6px">זוהו ${dataRows.length} שורות. בדוק שהעמודות ממופות נכון:</div>
      <div class="row">${field('name', 'שם השלב', map.name)}${field('client_amount', 'סכום ללקוח', map.client_amount)}${field('client_paid', 'שולם ע"י לקוח', map.client_paid)}${field('sub_amount', 'סכום לקבלן', map.sub_amount)}${field('sub_paid', 'שולם לקבלן', map.sub_paid)}</div>`;
    document.querySelectorAll('.imp2sel').forEach(s => s.onchange = renderPrev2);
    renderPrev2();
  }
  function curMap2() { const m = {}; document.querySelectorAll('.imp2sel').forEach(s => m[s.dataset.key] = parseInt(s.value)); return m; }
  function renderPrev2() {
    if (!_imp2) return;
    const m = curMap2();
    const rows = _imp2.dataRows.slice(0, 10).map(r => `<tr><td>${esc(r[m.name] || '')}</td><td class="num">${fmtc(r[m.client_amount])}</td><td class="num">${fmtc(r[m.client_paid])}</td><td class="num">${fmtc(r[m.sub_amount])}</td><td class="num">${fmtc(r[m.sub_paid])}</td></tr>`).join('');
    $('#imp2_preview').innerHTML = `<div class="mini" style="margin-bottom:4px">תצוגה מקדימה:</div><table><thead><tr><th>שלב</th><th>סכום לקוח</th><th>שולם לקוח</th><th>סכום קבלן</th><th>שולם קבלן</th></tr></thead><tbody>${rows}</tbody></table>${_imp2.dataRows.length > 10 ? `<div class="mini">...ועוד ${_imp2.dataRows.length - 10} שורות</div>` : ''}`;
  }
  function collectImportRows2() {
    if (!_imp2) return [];
    const m = curMap2();
    return _imp2.dataRows.map(r => ({
      name: String(r[m.name] || '').trim(),
      client_amount: impNum(r[m.client_amount]) || 0,
      client_paid: impNum(r[m.client_paid]) || 0,
      sub_amount: impNum(r[m.sub_amount]) || 0,
      sub_paid: impNum(r[m.sub_paid]) || 0,
    })).filter(x => x.name);
  }

  // ============================================================
  //  TRANSACTIONS (shared table + form)
  // ============================================================
  function txTable(rows, c) {
    const canMulti = c.multiDelete;
    const canAct = c.writeTx || c.del;
    return `<table><thead><tr>${canMulti ? '<th><input type="checkbox" id="txAll"></th>' : ''}<th>תאריך</th><th>סוג</th><th>פרויקט</th><th>שלב / קבלן</th><th>ספק / מהות</th><th>סכום</th><th>חשבונית</th>${canAct ? '<th></th>' : ''}</tr></thead><tbody>${rows.map(t => `
      <tr>${canMulti ? `<td><input type="checkbox" class="txck" value="${t.id}"></td>` : ''}
        <td>${dfmt(t.date)}</td>
        <td>${TYPE_HE[t.type] || t.type}</td>
        <td>${esc(t.project_name || '')}</td>
        <td>${esc(t.stage_name || t.subcontractor_name || '')}</td>
        <td>${esc(t.supplier ? t.supplier + (t.purpose ? ' · ' + t.purpose : '') : (t.purpose || t.note || ''))}</td>
        <td class="num"><span class="pill ${t.direction}">${t.direction === 'in' ? '+' : '−'}${money0(t.amount)}</span></td>
        <td>${invoiceLink(t.invoice_url)}</td>
        ${canAct ? `<td>${c.writeTx ? `<button class="btn xs ghost" data-edittx="${t.id}">✏️</button>` : ''}${c.del ? `<button class="btn xs red" data-deltx="${t.id}">🗑️</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table>
      ${canMulti ? '<div style="margin-top:10px"><button class="btn red sm hidden" id="txBulkDel">מחיקת הנבחרים</button></div>' : ''}`;
  }
  function wireTxTable(box, reload, rows) {
    const c = caps();
    box.querySelectorAll('[data-edittx]').forEach(b => b.onclick = () => { const t = (rows || []).find(x => x.id === +b.dataset.edittx); if (t) txForm(t.type, { onDone: reload }, t); });
    box.querySelectorAll('[data-deltx]').forEach(b => b.onclick = async () => { if (await confirmDialog('להעביר את התנועה לסל המחזור?', 'מחיקה')) { await guard(window.Store.tx.remove(+b.dataset.deltx)); toast('נמחק', 'ok'); reload(); } });
    if (c.multiDelete) {
      const all = $('#txAll', box), del = $('#txBulkDel', box);
      const cks = () => [...box.querySelectorAll('.txck')];
      const upd = () => { const sel = cks().filter(x => x.checked); if (del) del.classList.toggle('hidden', sel.length === 0); };
      if (all) all.onchange = () => { cks().forEach(x => x.checked = all.checked); upd(); };
      cks().forEach(x => x.onchange = upd);
      if (del) del.onclick = async () => { const ids = cks().filter(x => x.checked).map(x => +x.value); if (!ids.length) return; if (await confirmDialog(`למחוק ${ids.length} תנועות?`, 'מחיקה')) { await guard(window.Store.tx.bulkRemove(ids)); toast('נמחקו', 'ok'); reload(); } };
    }
  }

  // transaction create/edit modal. type fixed; ctx may include project_id + stages
  async function txForm(type, ctx, tx) {
    ctx = ctx || {};
    const editing = !!(tx && tx.id);
    if (editing) type = tx.type;
    const V = editing ? tx : {};
    const isSub = type === 'sub_payment', isClient = type === 'client_payment', isProjExp = type === 'project_expense', isBiz = type === 'business_expense';
    // projects for picker (unless business expense)
    let projects = [], stages = ctx.stages || null;
    if (!isBiz) projects = await guard(caps().viewBusiness ? window.Store.projects.list() : window.Store.projects.pick());
    let categories = [];
    if (isProjExp || isBiz) { try { categories = await window.Store.tx.categories(); } catch (e) { categories = []; } }
    const projOpts = (sel) => '<option value="">— בחר פרויקט —</option>' + projects.map(p => `<option value="${p.id}" ${+sel === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    const needStage = isSub || isClient;
    openModal((editing ? 'עריכת ' : 'הוספת ') + (TYPE_HE[type] || ''), `
      ${!isBiz ? `<div class="field"><label>פרויקט *</label><select id="t_proj">${projOpts(editing ? tx.project_id : ctx.project_id)}</select></div>` : ''}
      ${needStage ? `<div class="field"><label>שלב *</label><select id="t_stage"><option value="">— בחר שלב —</option></select><div class="mini" id="t_stageRem" style="margin-top:5px"></div></div>` : ''}
      <div class="row">
        <div class="field"><label>סכום (₪) *</label><input id="t_amount" type="number" value="${V.amount != null ? V.amount : ''}" autofocus></div>
        <div class="field"><label>תאריך</label><input id="t_date" type="date" value="${V.date ? String(V.date).slice(0, 10) : today()}"></div>
      </div>
      ${(isProjExp || isBiz) ? `<div class="row">
        <div class="field"><label>קטגוריה</label><input id="t_category" list="t_catList" value="${esc(V.category || '')}" placeholder="בחר מהרשימה או הקלד חדשה"><datalist id="t_catList">${categories.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist></div>
        <div class="field"><label>ספק</label><input id="t_supplier" value="${esc(V.supplier || '')}"></div>
      </div>
      <div class="field"><label>מהות ההוצאה</label><input id="t_purpose" value="${esc(V.purpose || '')}"></div>` : ''}
      <div class="field"><label>אמצעי תשלום</label><input id="t_method" value="${esc(V.method || '')}" placeholder="מזומן / העברה / צ׳ק / אשראי"></div>
      ${(isProjExp || isBiz) ? `<div class="field"><label>חשבונית</label>
        ${editing && tx.invoice_url ? `<div class="mini" style="margin-bottom:4px">נוכחית: ${invoiceLink(tx.invoice_url)}</div>` : ''}
        <input id="t_file" type="file" accept="image/*,.pdf" style="display:none">
        <input id="t_cam" type="file" accept="image/*" capture="environment" style="display:none">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button type="button" class="btn ghost sm" id="t_fileBtn">📎 העלה קובץ</button>
          <button type="button" class="btn ghost sm" id="t_camBtn">📷 צלם חשבונית</button>
          <span class="mini" id="t_fileName" style="color:var(--muted)"></span>
        </div>
        <div class="mini" id="t_fileNote"></div></div>` : ''}
      <div class="field"><label>הערה</label><input id="t_note" value="${esc(V.note || '')}"></div>`,
      [{ label: 'שמירה', onClick: async (close) => {
        const amount = parseFloat(fv('t_amount')); if (!(amount > 0)) return toast('הזן סכום תקין', 'err');
        const d = { type, amount, date: fv('t_date') || null, method: fv('t_method'), note: fv('t_note') };
        if (editing) d.invoice_url = tx.invoice_url;   // שמירת החשבונית הקיימת אם לא הוחלפה
        if (!isBiz) { d.project_id = fv('t_proj'); if (!d.project_id) return toast('בחר פרויקט', 'err'); }
        if (needStage) {
          d.stage_id = fv('t_stage'); if (!d.stage_id) return toast('בחר שלב', 'err');
          const st = (stages || []).find(x => x.id === +d.stage_id);
          if (isSub) { d.subcontractor_id = st ? st.subcontractor_id : (editing ? tx.subcontractor_id : null); if (!d.subcontractor_id) return toast('לא הוגדר קבלן משנה לפרויקט — הגדר אותו בעריכת הפרויקט', 'err'); }
          // חסימת חריגה מסכום השלב (בעריכה השרת בודק ומחריג את התנועה הנוכחית)
          if (!editing && st) {
            const cap = isClient ? (+st.client_amount || 0) : (+st.sub_amount || 0);
            const paid = isClient ? (+st.paid_in || 0) : (+st.paid_sub || 0);
            const remaining = cap - paid;
            if (amount > remaining + 0.001) return toast(`הסכום חורג מסכום השלב. נותר: ${money(Math.max(0, remaining))}`, 'err');
          }
        }
        if (isProjExp || isBiz) { d.category = fv('t_category'); d.supplier = fv('t_supplier'); d.purpose = fv('t_purpose'); }
        // invoice upload — מקובץ שהועלה או מצילום
        const camEl = document.getElementById('t_cam');
        const fileEl = document.getElementById('t_file');
        const invFile = (camEl && camEl.files && camEl.files[0]) || (fileEl && fileEl.files && fileEl.files[0]);
        if (invFile) {
          $('#t_fileNote') && ($('#t_fileNote').textContent = 'מעלה חשבונית...');
          const up = await guard(window.Store.uploads.invoice(invFile));
          d.invoice_url = up.url;
          if (up.storage === 'local') toast('⚠️ החשבונית נשמרה על השרת בלבד — הדרייב אינו מחובר', 'err');
        }
        await guard(editing ? window.Store.tx.update(tx.id, d) : window.Store.tx.create(d));
        close(); toast('נשמר', 'ok');
        if (ctx.onDone) ctx.onDone(); else if (ctx.project_id) openProject(ctx.project_id); else refresh();
      } }, { label: 'ביטול', cls: 'ghost', onClick: (c) => c() }]);
    // כפתורי חשבונית: העלאת קובץ / צילום (capture פותח את המצלמה במובייל)
    if (isProjExp || isBiz) {
      const fBtn = $('#t_fileBtn'), cBtn = $('#t_camBtn'), fIn = $('#t_file'), cIn = $('#t_cam'), nm = $('#t_fileName');
      const showName = (el) => { const f = el.files && el.files[0]; if (f && nm) nm.textContent = '✓ ' + f.name; };
      if (fBtn) fBtn.onclick = () => fIn.click();
      if (cBtn) cBtn.onclick = () => cIn.click();
      if (fIn) fIn.onchange = () => { if (fIn.files[0] && cIn) cIn.value = ''; showName(fIn); };
      if (cIn) cIn.onchange = () => { if (cIn.files[0] && fIn) fIn.value = ''; showName(cIn); };
    }
    // populate stages on project change - רק שלבים שעדיין לא שולמו במלואם, עם הצגת יתרה
    if (needStage) {
      const stageSel = $('#t_stage');
      const remEl = $('#t_stageRem');
      const remOf = (s) => isClient ? ((+s.client_amount || 0) - (+s.paid_in || 0)) : ((+s.sub_amount || 0) - (+s.paid_sub || 0));
      const updateRem = () => {
        const st = (stages || []).find(x => x.id === +stageSel.value);
        if (st) { const r = remOf(st); remEl.innerHTML = `יתרה לשלב זה: <b style="color:var(--brand-d)">${money(Math.max(0, r))}</b>`; }
        else remEl.textContent = '';
      };
      const fill = (raw, keepId) => {
        stages = (raw || []).filter(s => remOf(s) > 0.5 || s.id === keepId);   // מסתירים שלבים ששולמו — פרט לשלב הנערך
        stageSel.innerHTML = '<option value="">— בחר שלב —</option>' + stages.map(s => `<option value="${s.id}" ${s.id === keepId ? 'selected' : ''}>${esc(s.name)} · נותר ${money0(remOf(s))} ₪</option>`).join('');
        remEl.innerHTML = stages.length ? '' : '<span style="color:var(--muted)">כל השלבים שולמו במלואם 🎉</span>';
        updateRem();
      };
      stageSel.onchange = updateRem;
      if (editing && tx.project_id) { const d = await guard(window.Store.projects.get(tx.project_id)); fill(d.stages, tx.stage_id); }
      else if (stages) fill(stages);
      const projSel = $('#t_proj');
      if (projSel) projSel.onchange = async () => { if (!projSel.value) { stageSel.innerHTML = '<option value="">— בחר שלב —</option>'; remEl.textContent = ''; stages = []; return; } const d = await guard(window.Store.projects.get(projSel.value)); fill(d.stages); };
    }
  }

  async function scrTx() {
    loading();
    view().innerHTML = `
      <div class="page-head"><h2>תנועות כספיות</h2><div class="spacer"></div>
        ${caps().writeTx ? `<button class="btn green sm" data-newtx="client_payment">תשלום מלקוח</button>
        <button class="btn sm" data-newtx="sub_payment">תשלום לקבלן</button>
        <button class="btn ghost sm" data-newtx="project_expense">הוצאה לפרויקט</button>
        <button class="btn ghost sm" data-newtx="business_expense">הוצאת עסק</button>` : ''}</div>
      <div class="toolbar">
        <div class="field"><label class="mini">סוג</label><select id="fType">
          <option value="">הכל</option>${Object.entries(TYPE_HE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="field"><label class="mini">מתאריך</label><input id="fFrom" type="date"></div>
        <div class="field"><label class="mini">עד תאריך</label><input id="fTo" type="date"></div>
        <button class="btn ghost sm" id="fApply" style="align-self:flex-end">סינון</button>
      </div>
      <div class="card" id="txBox"></div>`;
    view().querySelectorAll('[data-newtx]').forEach(b => b.onclick = () => txForm(b.dataset.newtx, {}));
    const load = async () => {
      const f = { type: fv('fType'), from: fv('fFrom'), to: fv('fTo') };
      const rows = await guard(window.Store.tx.list(f));
      const box = $('#txBox');
      box.innerHTML = rows.length ? txTable(rows, caps()) : '<div class="empty">אין תנועות</div>';
      wireTxTable(box, load, rows);
    };
    $('#fApply').onclick = load;
    load();
  }

  // ============================================================
  //  BUSINESS EXPENSES
  // ============================================================
  async function scrBiz() {
    loading();
    const rows = await guard(window.Store.tx.list({ type: 'business_expense' }));
    const total = rows.reduce((s, r) => s + (+r.amount || 0), 0);
    view().innerHTML = `
      <div class="page-head"><h2>הוצאות עסק</h2><span class="mini">(ללא שיוך לפרויקט)</span><div class="spacer"></div>
        ${caps().writeTx ? '<button class="btn ghost" id="bizBulk">📋 הזנה מרוכזת</button>' : ''}
        ${caps().writeTx ? '<button class="btn" data-newtx="business_expense">➕ הוצאת עסק</button>' : ''}</div>
      <div class="grid stat-grid">${stat('סה"כ הוצאות עסק', money(total), 'r')}${stat('מספר הוצאות', String(rows.length))}</div>
      <div class="card" id="bizBox"></div>`;
    view().querySelectorAll('[data-newtx]').forEach(b => b.onclick = () => txForm('business_expense', {}));
    if ($('#bizBulk')) $('#bizBulk').onclick = () => bulkExpenseForm('business_expense');
    const box = $('#bizBox');
    if (!rows.length) box.innerHTML = '<div class="empty"><div class="big">🧾</div>אין הוצאות עסק</div>';
    else {
      const cB = caps();
      box.innerHTML = `<table><thead><tr><th>תאריך</th><th>קטגוריה</th><th>ספק</th><th>מהות</th><th>אמצעי</th><th>סכום</th><th>חשבונית</th>${(cB.writeTx || cB.del) ? '<th></th>' : ''}</tr></thead><tbody>${rows.map(t => `
        <tr><td>${dfmt(t.date)}</td><td>${t.category ? `<span class="tag-trade">${esc(t.category)}</span>` : ''}</td><td>${esc(t.supplier || '')}</td><td>${esc(t.purpose || '')}</td><td>${esc(t.method || '')}</td>
        <td class="num" style="color:var(--red)">${money(t.amount)}</td>
        <td>${invoiceLink(t.invoice_url)}</td>
        ${(cB.writeTx || cB.del) ? `<td>${cB.writeTx ? `<button class="btn xs ghost" data-edittx="${t.id}">✏️</button>` : ''}${cB.del ? `<button class="btn xs red" data-deltx="${t.id}">🗑️</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table>`;
      wireTxTable(box, scrBiz, rows);
    }
  }

  // ============================================================
  //  PROJECT EXPENSES (הוצאה לפרויקט - חובה פרויקט + חשבונית)
  // ============================================================
  async function scrProjExp() {
    loading();
    const rows = await guard(window.Store.tx.list({ type: 'project_expense' }));
    const total = rows.reduce((s, r) => s + (+r.amount || 0), 0);
    view().innerHTML = `
      <div class="page-head"><h2>הוצאה לפרויקט</h2><span class="mini">(משויכת לפרויקט · אפשר לצרף חשבונית)</span><div class="spacer"></div>
        ${caps().writeTx ? '<button class="btn ghost" id="peBulk">📋 הזנה מרוכזת</button>' : ''}
        ${(caps().writeTx || caps().projectExpenseOnly) ? '<button class="btn" data-newtx="project_expense">➕ הוצאה לפרויקט</button>' : ''}</div>
      <div class="grid stat-grid">${stat('סה"כ הוצאות לפרויקטים', money(total), 'r')}${stat('מספר הוצאות', String(rows.length))}</div>
      <div class="card" id="peBox"></div>`;
    view().querySelectorAll('[data-newtx]').forEach(b => b.onclick = () => txForm('project_expense', {}));
    if ($('#peBulk')) $('#peBulk').onclick = () => bulkExpenseForm('project_expense');
    const box = $('#peBox');
    if (!rows.length) box.innerHTML = '<div class="empty"><div class="big">🧱</div>אין הוצאות לפרויקטים</div>';
    else {
      const cPE = caps();
      box.innerHTML = `<table><thead><tr><th>תאריך</th><th>פרויקט</th><th>קטגוריה</th><th>ספק</th><th>מהות</th><th>סכום</th><th>חשבונית</th>${(cPE.writeTx || cPE.del) ? '<th></th>' : ''}</tr></thead><tbody>${rows.map(t => `
        <tr><td>${dfmt(t.date)}</td><td>${esc(t.project_name || '')}</td><td>${t.category ? `<span class="tag-trade">${esc(t.category)}</span>` : ''}</td><td>${esc(t.supplier || '')}</td><td>${esc(t.purpose || '')}</td>
        <td class="num" style="color:var(--red)">${money(t.amount)}</td>
        <td>${invoiceLink(t.invoice_url)}</td>
        ${(cPE.writeTx || cPE.del) ? `<td>${cPE.writeTx ? `<button class="btn xs ghost" data-edittx="${t.id}">✏️</button>` : ''}${cPE.del ? `<button class="btn xs red" data-deltx="${t.id}">🗑️</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table>`;
      wireTxTable(box, scrProjExp, rows);
    }
  }

  // -- bulk expense entry (הזנה מרוכזת - בעיקר ע"י הדבקה מאקסל/שיטס) --
  async function bulkExpenseForm(type) {
    const isProj = type === 'project_expense';
    let projects = [], categories = [];
    if (isProj) projects = await guard(window.Store.projects.list());
    try { categories = await window.Store.tx.categories(); } catch (e) { categories = []; }
    const projOpts = '<option value="">— בחר פרויקט —</option>' + projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    const rowHtml = (o) => { o = o || {}; return `<tr>
      <td><input class="be-date" type="date" value="${o.date || today()}" style="width:140px"></td>
      <td><input class="be-cat" list="be_catList" value="${esc(o.category || '')}" placeholder="קטגוריה" style="width:115px"></td>
      <td><input class="be-sup" value="${esc(o.supplier || '')}" placeholder="ספק" style="width:110px"></td>
      <td><input class="be-pur" value="${esc(o.purpose || '')}" placeholder="מהות" style="width:120px"></td>
      <td><input class="be-amt" type="number" value="${o.amount || ''}" placeholder="סכום" style="width:95px"></td>
      <td><button class="x be-del">&times;</button></td></tr>`; };
    openModal('הזנה מרוכזת — ' + (isProj ? 'הוצאות לפרויקט' : 'הוצאות עסק'), `
      <datalist id="be_catList">${categories.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist>
      ${isProj ? `<div class="field"><label>פרויקט (לכל השורות) *</label><select id="be_proj">${projOpts}</select></div>` : ''}
      <div class="field"><label>הדבקה מאקסל / שיטס</label><textarea id="be_paste" rows="4" placeholder="הדבק כאן את השורות (תאריך, קטגוריה, ספק, מהות, סכום) ולחץ 'נתח'"></textarea></div>
      <button class="btn ghost sm" id="be_parse">נתח והמלא טבלה ↓</button>
      <p class="mini" style="margin-top:8px">אחרי הניתוח אפשר לתקן ידנית בטבלה. (לצירוף חשבונית — "➕ הוצאה" הבודדת.)</p>
      <div style="overflow-x:auto"><table><thead><tr><th>תאריך</th><th>קטגוריה</th><th>ספק</th><th>מהות</th><th>סכום ₪</th><th></th></tr></thead>
      <tbody id="beBody">${rowHtml() + rowHtml() + rowHtml()}</tbody></table></div>
      <button class="btn ghost sm" id="beAdd" style="margin-top:10px">➕ שורה</button>`,
      [{ label: 'שמירת הכל', cls: 'green', onClick: async (close) => {
        let project_id = '';
        if (isProj) { project_id = fv('be_proj'); if (!project_id) return toast('בחר פרויקט', 'err'); }
        const rows = [...document.querySelectorAll('#beBody tr')].map(tr => {
          const g = (sel) => { const el = $(sel, tr); return el ? el.value.trim() : ''; };
          const o = { date: g('.be-date') || null, category: g('.be-cat'), supplier: g('.be-sup'), purpose: g('.be-pur'), amount: parseFloat(g('.be-amt')) || 0 };
          if (isProj) o.project_id = project_id;
          return o;
        }).filter(r => r.amount > 0);
        if (!rows.length) return toast('אין שורות עם סכום', 'err');
        const res = await guard(window.Store.tx.bulkExpenses(type, rows));
        close(); toast('נשמרו ' + res.count + ' הוצאות', 'ok'); refresh();
      } }, { label: 'ביטול', cls: 'ghost', onClick: (c) => c() }]);
    const wireDel = () => document.querySelectorAll('#beBody .be-del').forEach(b => b.onclick = () => { if (document.querySelectorAll('#beBody tr').length > 1) b.closest('tr').remove(); });
    $('#be_parse').onclick = () => {
      const parsed = parseExpensePaste(fv('be_paste'));
      if (!parsed.length) return toast('לא זוהו שורות עם סכום — בדוק את ההדבקה', 'err');
      $('#beBody').innerHTML = parsed.map(o => rowHtml(o)).join('');
      wireDel();
      toast('זוהו ' + parsed.length + ' שורות — בדוק ותקן במידת הצורך', 'ok');
    };
    $('#beAdd').onclick = () => { const t = document.createElement('tbody'); t.innerHTML = rowHtml(); $('#beBody').appendChild(t.firstChild); wireDel(); };
    wireDel();
  }
  // ניתוח הדבקה של הוצאות -> [{date, category, supplier, purpose, amount}]
  function parseExpensePaste(text) {
    const lines = (text || '').split(/\r?\n/).filter(l => l.trim() !== '');
    if (!lines.length) return [];
    const grid = lines.map(l => (l.indexOf('\t') >= 0 ? l.split('\t') : l.split(/ {2,}|,|;/)).map(c => c.trim()));
    const cols = Math.max(...grid.map(r => r.length));
    grid.forEach(r => { while (r.length < cols) r.push(''); });
    const dateRe = /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/;
    const isData = grid.map(r => r.some(c => impNum(c) !== null));
    const headerRows = grid.filter((r, i) => !isData[i]);
    const dataRows = grid.filter((r, i) => isData[i]);
    if (!dataRows.length) return [];
    const label = []; for (let j = 0; j < cols; j++) label[j] = headerRows.map(r => String(r[j] || '')).join(' ');
    const byLabel = (kw) => { for (let j = 0; j < cols; j++) if (label[j].indexOf(kw) >= 0) return j; return -1; };
    let dateCol = byLabel('תאריך'); if (dateCol < 0) for (let j = 0; j < cols; j++) if (dataRows.some(r => dateRe.test(r[j]))) { dateCol = j; break; }
    let amtCol = byLabel('סכום'); if (amtCol < 0) { let best = -1, bestN = 0; for (let j = 0; j < cols; j++) { if (j === dateCol) continue; const n = dataRows.filter(r => impNum(r[j]) !== null).length; if (n > bestN) { bestN = n; best = j; } } amtCol = best; }
    const catCol = byLabel('קטגוריה'), supCol = byLabel('ספק');
    let purCol = byLabel('מהות'); if (purCol < 0) purCol = byLabel('תיאור'); if (purCol < 0) purCol = byLabel('פירוט');
    const used = new Set([dateCol, amtCol, catCol, supCol, purCol].filter(x => x >= 0));
    const textCols = []; for (let j = 0; j < cols; j++) if (!used.has(j) && dataRows.some(r => r[j] && impNum(r[j]) === null)) textCols.push(j);
    const sup = supCol >= 0 ? supCol : (textCols.length ? textCols[0] : -1);
    const pur = purCol >= 0 ? purCol : (textCols.length > 1 ? textCols[1] : -1);
    return dataRows.map(r => ({
      date: dateCol >= 0 ? normDate(r[dateCol]) : '',
      category: catCol >= 0 ? r[catCol] : '',
      supplier: sup >= 0 ? r[sup] : '',
      purpose: pur >= 0 ? r[pur] : '',
      amount: amtCol >= 0 ? (impNum(r[amtCol]) || 0) : 0,
    })).filter(o => o.amount > 0);
  }

  // ============================================================
  //  SUBCONTRACTORS
  // ============================================================
  async function scrSubs() {
    loading();
    const rows = await guard(window.Store.subs.list());
    const c = caps();
    view().innerHTML = `
      <div class="page-head"><h2>קבלני משנה</h2><div class="spacer"></div>
        ${c.editProjects ? '<button class="btn" id="newSub">➕ קבלן חדש</button>' : ''}</div>
      <div class="card">${rows.length ? `<table><thead><tr><th>שם</th><th>תחום</th><th>טלפון</th><th>ח.פ/ת.ז</th>${c.editProjects ? '<th></th>' : ''}</tr></thead><tbody>${rows.map(s => `
        <tr><td>${esc(s.name)}</td><td>${s.trade ? `<span class="tag-trade">${esc(s.trade)}</span>` : ''}</td>
        <td>${esc(s.phone || '')}</td><td>${esc(s.tax_id || '')}</td>
        ${c.editProjects ? `<td><button class="btn xs ghost" data-editsub="${s.id}">✏️</button>${c.del ? `<button class="btn xs red" data-delsub="${s.id}">🗑️</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table>` : '<div class="empty"><div class="big">👷</div>אין קבלני משנה</div>'}</div>`;
    if (c.editProjects) {
      $('#newSub') && ($('#newSub').onclick = () => subForm());
      view().querySelectorAll('[data-editsub]').forEach(b => b.onclick = () => subForm(rows.find(x => x.id === +b.dataset.editsub)));
      view().querySelectorAll('[data-delsub]').forEach(b => b.onclick = async () => { if (await confirmDialog('להעביר את הקבלן לסל המחזור?', 'מחיקה')) { await guard(window.Store.subs.remove(+b.dataset.delsub)); toast('נמחק', 'ok'); scrSubs(); } });
    }
  }
  function subForm(s) {
    s = s || {};
    openModal(s.id ? 'עריכת קבלן משנה' : 'קבלן משנה חדש', `
      <div class="field"><label>שם *</label><input id="c_name" value="${esc(s.name || '')}"></div>
      <div class="row"><div class="field"><label>תחום</label><input id="c_trade" value="${esc(s.trade || '')}" placeholder="חשמל / אינסטלציה / גבס"></div>
        <div class="field"><label>טלפון</label><input id="c_phone" value="${esc(s.phone || '')}"></div></div>
      <div class="row"><div class="field"><label>אימייל</label><input id="c_email" value="${esc(s.email || '')}"></div>
        <div class="field"><label>ח.פ / ת.ז</label><input id="c_tax" value="${esc(s.tax_id || '')}"></div></div>
      <div class="field"><label>הערות</label><textarea id="c_notes" rows="2">${esc(s.notes || '')}</textarea></div>`,
      [{ label: 'שמירה', onClick: async (close) => {
        const name = fv('c_name'); if (!name) return toast('שם חובה', 'err');
        const d = { name, trade: fv('c_trade'), phone: fv('c_phone'), email: fv('c_email'), tax_id: fv('c_tax'), notes: fv('c_notes') };
        await guard(s.id ? window.Store.subs.update(s.id, d) : window.Store.subs.create(d));
        close(); toast('נשמר', 'ok'); scrSubs();
      } }, { label: 'ביטול', cls: 'ghost', onClick: (c) => c() }]);
  }

  // ============================================================
  //  FIELD WORKER (simplified expense entry)
  // ============================================================
  async function scrField() {
    loading();
    view().innerHTML = `
      <div class="page-head"><h2>הזנת הוצאה לפרויקט</h2></div>
      <div class="card" style="max-width:520px">
        <p class="muted">בחר פרויקט, הזן את ההוצאה וצרף חשבונית.</p>
        <button class="btn full" id="fieldNew">🧾 הזנת הוצאה חדשה</button>
      </div>`;
    $('#fieldNew').onclick = () => txForm('project_expense', {});
  }

  // ============================================================
  //  REPORTS
  // ============================================================
  async function scrReports() {
    loading();
    view().innerHTML = `
      <div class="page-head"><h2>דוחות</h2></div>
      <div class="card">
        <div class="toolbar">
          <div class="field"><label class="mini">סוג דוח</label><select id="rKind">
            <option value="monthly">דוח עסק חודשי</option>
            <option value="project">דוח פרויקט</option>
          </select></div>
          <div class="field" id="rProjWrap" style="display:none"><label class="mini">פרויקט</label><select id="rProj"></select></div>
          <div class="field"><label class="mini">מתאריך</label><input id="rFrom" type="date"></div>
          <div class="field"><label class="mini">עד תאריך</label><input id="rTo" type="date"></div>
          <button class="btn sm" id="rRun" style="align-self:flex-end">הצג דוח</button>
        </div>
      </div>
      <div id="rOut"></div>`;
    const projects = await guard(window.Store.projects.list());
    $('#rProj').innerHTML = projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    $('#rKind').onchange = () => { $('#rProjWrap').style.display = $('#rKind').value === 'project' ? '' : 'none'; };
    $('#rRun').onclick = runReport;
    runReport();
  }
  async function runReport() {
    const kind = $('#rKind').value, out = $('#rOut');
    out.innerHTML = '<div class="empty">⏳ מפיק דוח...</div>';
    if (kind === 'monthly') {
      const f = { from: fv('rFrom'), to: fv('rTo') };
      const r = await guard(window.Store.reports.monthly(f));
      const t = r.totals;
      out.innerHTML = `
        <div class="grid stat-grid">
          ${stat('הכנסות (מלקוחות)', money(t.income), 'g')}
          ${stat('תשלומים לקבלני משנה', money(t.sub_paid), 'r')}
          ${stat('הוצאות פרויקטים', money(t.project_expenses), 'r')}
          ${stat('הוצאות עסק', money(t.business_expenses), 'r')}
          ${stat('רווח נקי', money(t.net), t.net >= 0 ? 'g' : 'r')}
        </div>
        <div class="card"><h3>לפי חודש</h3><div id="rmChart"></div></div>
        <div class="card"><h3>לפי פרויקט</h3>${r.by_project.length ? `<table><thead><tr><th>פרויקט</th><th>הכנסות</th><th>עלויות</th><th>רווח</th></tr></thead><tbody>${r.by_project.map(p => `<tr><td>${esc(p.project_name)}</td><td class="num">${money(p.income)}</td><td class="num">${money(p.cost)}</td><td class="num" style="color:${p.income - p.cost >= 0 ? 'var(--green)' : 'var(--red)'}">${money(p.income - p.cost)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">אין נתונים</div>'}</div>`;
      drawMonthlyChart($('#rmChart'), r.by_month);
    } else {
      const id = $('#rProj').value; if (!id) { out.innerHTML = '<div class="empty">בחר פרויקט</div>'; return; }
      const r = await guard(window.Store.reports.project(id));
      const t = r.totals;
      out.innerHTML = `
        <div class="page-head"><h2 style="font-size:19px">${esc(r.project.name)}</h2></div>
        <div class="grid stat-grid">
          ${stat('רווח צפוי', money(t.expected_profit), 'a')}
          ${stat('רווח בפועל', money(t.actual_profit), t.actual_profit >= 0 ? 'g' : 'r', gapText(t.profit_gap))}
          ${stat('נכנס מלקוח', money(t.income), 'g')}
          ${stat('שולם לקבלני משנה', money(t.sub_paid), 'r')}
          ${stat('הוצאות כלליות', money(t.project_expenses), 'r')}
        </div>
        <div class="card"><h3>שלבים</h3>${r.stages.length ? `<table><thead><tr><th>#</th><th>שלב</th><th>קבלן משנה</th><th>לקוח</th><th>נכנס</th><th>קבלן</th><th>שולם</th></tr></thead><tbody>${r.stages.map(s => `<tr><td>${s.seq}</td><td>${esc(s.name)}</td><td>${esc(s.subcontractor_name || '—')}</td><td class="num">${money(s.client_amount)}</td><td class="num">${money(s.paid_in)}</td><td class="num">${money(s.sub_amount)}</td><td class="num">${money(s.paid_sub)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">אין שלבים</div>'}</div>
        <div class="card"><h3>הוצאות כלליות בפרויקט</h3>${r.project_expenses.length ? `<table><thead><tr><th>תאריך</th><th>ספק</th><th>מהות</th><th>סכום</th><th>חשבונית</th></tr></thead><tbody>${r.project_expenses.map(e => `<tr><td>${dfmt(e.date)}</td><td>${esc(e.supplier || '')}</td><td>${esc(e.purpose || '')}</td><td class="num">${money(e.amount)}</td><td>${invoiceLink(e.invoice_url)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">אין הוצאות כלליות</div>'}</div>`;
    }
  }

  // ============================================================
  //  HOME MODULE
  // ============================================================
  async function scrHome() {
    loading();
    const rep = await guard(window.Store.reports.home({}));
    const rows = await guard(window.Store.home.list({}));
    const uncat = rows.filter(r => !r.category || !String(r.category).trim());   // ממתינים לסיווג
    view().innerHTML = `
      <div class="page-head"><h2>ניהול הבית</h2><div class="spacer"></div>
        <button class="btn sm" id="homeReport">📊 דוח חודשי</button>
        <button class="btn green sm" id="homeAdd">➕ הוצאה/הכנסה</button>
        <button class="btn ghost sm" id="homeImport">📋 ייבוא מבנק/אשראי</button></div>
      <div class="grid stat-grid">
        ${stat('הכנסות', money(rep.totals.income), 'g')}
        ${stat('הוצאות', money(rep.totals.expenses), 'r')}
        ${stat('מאזן', money(rep.totals.balance), rep.totals.balance >= 0 ? 'g' : 'r')}
      </div>
      <div id="homeUncat"></div>
      <div class="card"><h3>הוצאות לפי קטגוריה</h3><div id="homeCat"></div></div>
      <div class="card"><h3 id="homeRowsTitle">תנועות אחרונות</h3><div id="homeRows"></div></div>`;
    $('#homeReport').onclick = () => scrHomeReport();
    $('#homeAdd').onclick = () => homeForm();
    $('#homeImport').onclick = () => homeImport();
    drawDonut($('#homeCat'), rep.by_category.map(x => ({ label: x.category, value: x.total })));

    if (uncat.length) {
      $('#homeUncat').innerHTML = `<div class="card" style="background:#fffbeb;border:1px solid var(--amber);display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px">
        <span style="font-size:22px">🏷️</span>
        <div style="flex:1;min-width:160px"><b>${uncat.length} תנועות ללא קטגוריה</b> <span class="mini muted">ממתינות לסיווג שלך</span></div>
        <button class="btn sm" id="homeUncatBtn">סווג עכשיו ←</button></div>`;
      $('#homeUncatBtn').onclick = () => scrCategorize();
    }
    const box = $('#homeRows'), cDel = caps().del;
    box.innerHTML = rows.length ? `<table><thead><tr><th>תאריך</th><th>קטגוריה</th><th>ספק</th><th>סכום</th><th>מקור</th><th></th></tr></thead><tbody>${rows.map(r => `
      <tr><td>${dfmt(r.date)}</td><td>${r.category && String(r.category).trim() ? esc(r.category) : '<span style="color:var(--brand-d);font-weight:600">— ללא —</span>'}</td><td>${esc(r.payee || '')}</td>
      <td class="num"><span class="pill ${r.direction}">${r.direction === 'in' ? '+' : '−'}${money0(r.amount)}</span></td>
      <td class="mini">${SOURCE_HE[r.source] || r.source || ''}</td>
      <td><button class="btn xs ghost" data-edithome="${r.id}">✏️</button>${cDel ? `<button class="btn xs red" data-delhome="${r.id}">🗑️</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">אין תנועות בית</div>';
    box.querySelectorAll('[data-edithome]').forEach(b => b.onclick = () => homeForm(rows.find(x => x.id === +b.dataset.edithome)));
    box.querySelectorAll('[data-delhome]').forEach(b => b.onclick = async () => { if (await confirmDialog('להעביר לסל המחזור?', 'מחיקה')) { await guard(window.Store.home.remove(+b.dataset.delhome)); toast('נמחק', 'ok'); scrHome(); } });
  }

  // מסך סיווג מרוכז — עוברים על כל התנועות הלא-מסווגות ומסווגים במהירות
  async function scrCategorize() {
    loading();
    const rows = await guard(window.Store.home.list({}));
    const pending = rows.filter(r => !r.category || !String(r.category).trim());
    const cats = await guard(window.Store.home.categories());
    const rules = await guard(window.Store.home.rules());
    const suggest = (payee) => {
      const p = String(payee || '').trim(); if (!p) return '';
      const hit = (rules || []).find(rr => rr.match_text && (p.includes(rr.match_text) || rr.match_text.includes(p)));
      return hit ? hit.category : '';
    };
    view().innerHTML = `
      <div class="page-head"><h2>סיווג תנועות ממתינות</h2><div class="spacer"></div>
        <button class="btn ghost sm" id="catBack">→ חזרה לניהול הבית</button></div>
      <datalist id="catlist">${(cats || []).map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist>
      <div class="card">
        <p class="mini muted" style="margin-top:0">הקלד קטגוריה לכל תנועה ולחץ Enter (או "שמור"). נותרו <b id="catLeft">${pending.length}</b>.</p>
        <div id="catWrap"></div>
        <div id="catAllWrap"></div>
      </div>`;
    $('#catBack').onclick = () => scrHome();
    const wrap = $('#catWrap');
    if (!pending.length) { wrap.innerHTML = '<div class="empty"><div class="big">🎉</div>הכול מסווג! אין תנועות שממתינות.</div>'; return; }
    wrap.innerHTML = `<div style="overflow-x:auto"><table><thead><tr><th>תאריך</th><th>ספק / למי</th><th>סכום</th><th>קטגוריה</th><th></th></tr></thead><tbody>
      ${pending.map(r => `<tr data-id="${r.id}">
        <td>${dfmt(r.date)}</td>
        <td>${esc(r.payee || '—')}</td>
        <td class="num"><span class="pill ${r.direction}">${r.direction === 'in' ? '+' : '−'}${money0(r.amount)}</span></td>
        <td><input class="cat-in" list="catlist" value="${esc(suggest(r.payee))}" placeholder="הקלד קטגוריה..." autocomplete="off" style="width:100%;min-width:140px;padding:8px 10px;border:1px solid var(--line);border-radius:8px"></td>
        <td><button class="btn xs green" data-save>שמור</button></td></tr>`).join('')}
      </tbody></table></div>`;
    $('#catAllWrap').innerHTML = `<button class="btn green" id="catSaveAll" style="margin-top:14px">💾 שמור הכל</button>`;

    function updateLeft() {
      const n = wrap.querySelectorAll('tr[data-id]').length;
      const left = $('#catLeft'); if (left) left.textContent = n;
      if (n === 0) { wrap.innerHTML = '<div class="empty"><div class="big">🎉</div>הכול סווג! כל הכבוד.</div>'; $('#catAllWrap').innerHTML = ''; }
    }
    async function saveTr(tr, quiet) {
      const id = +tr.dataset.id, cat = tr.querySelector('.cat-in').value.trim();
      if (!cat) { if (!quiet) { toast('הקלד קטגוריה', 'err'); tr.querySelector('.cat-in').focus(); } return false; }
      const r = pending.find(x => x.id === id);
      await guard(window.Store.home.update(id, { direction: r.direction, amount: r.amount, date: r.date, category: cat, payee: r.payee, note: r.note, source: r.source }));
      tr.remove(); updateLeft();
      return true;
    }
    wrap.querySelectorAll('tr[data-id]').forEach(tr => {
      const inp = tr.querySelector('.cat-in');
      tr.querySelector('[data-save]').onclick = async () => { if (await saveTr(tr, false)) { toast('סווג', 'ok'); const nx = wrap.querySelector('.cat-in'); if (nx) nx.focus(); } };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); tr.querySelector('[data-save]').onclick(); } });
    });
    $('#catSaveAll').onclick = async () => {
      const trs = [...wrap.querySelectorAll('tr[data-id]')].filter(tr => tr.querySelector('.cat-in').value.trim());
      if (!trs.length) { toast('לא הוזנו קטגוריות', 'err'); return; }
      let n = 0;
      for (const tr of trs) { if (await saveTr(tr, true)) n++; }
      toast(`${n} תנועות סווגו`, 'ok');
    };
  }
  // ============================================================
  //  דוח בית חודשי — פילוח לפי קטגוריה + גרפים
  // ============================================================
  async function scrHomeReport() {
    loading();
    const rows = await guard(window.Store.home.list({}));
    const dated = rows.filter(r => r.date);

    // סדרה חודשית (הכנסות/הוצאות לכל חודש) + רשימת חודשים
    const monMap = {};
    dated.forEach(r => {
      const m = String(r.date).slice(0, 7);
      const g = monMap[m] || (monMap[m] = { month: m, income: 0, expenses: 0, count: 0 });
      g[r.direction === 'in' ? 'income' : 'expenses'] += +r.amount || 0;
      if (r.direction !== 'in') g.count++;
    });
    const series = Object.values(monMap).sort((a, b) => a.month.localeCompare(b.month)); // ישן→חדש
    const monthsDesc = series.map(s => s.month).slice().reverse();                       // חדש→ישן (לבורר)

    if (!series.length) {
      view().innerHTML = `
        <div class="page-head"><h2>דוח בית — חודשי</h2><div class="spacer"></div>
          <button class="btn ghost sm" id="hrBack">→ חזרה לניהול הבית</button></div>
        <div class="card"><div class="empty"><div class="big">📊</div>אין עדיין תנועות עם תאריך להצגת דוח חודשי</div></div>`;
      $('#hrBack').onclick = () => scrHome();
      return;
    }

    // מפת קטגוריה→סכום הוצאות לחודש נתון
    const catMapOf = (m) => {
      const map = {};
      dated.filter(r => r.direction === 'out' && String(r.date).slice(0, 7) === m).forEach(r => {
        const c = r.category || 'ללא קטגוריה'; map[c] = (map[c] || 0) + (+r.amount || 0);
      });
      return map;
    };
    // חודש סמוך להשוואה: קודם אם קיים, אחרת הבא
    const adjOf = (m) => { const i = series.findIndex(s => s.month === m); if (i > 0) return series[i - 1].month; if (i < series.length - 1) return series[i + 1].month; return null; };

    let sel = monthsDesc[0];   // חודש אחרון עם נתונים
    let cmp = adjOf(sel);       // חודש להשוואה (ברירת מחדל: הסמוך)

    function render() {
      if (cmp === sel) cmp = adjOf(sel);
      const monthRows = dated.filter(r => String(r.date).slice(0, 7) === sel);
      const expRows = monthRows.filter(r => r.direction === 'out');
      const expTotal = expRows.reduce((s, r) => s + (+r.amount || 0), 0);
      const incTotal = monthRows.filter(r => r.direction === 'in').reduce((s, r) => s + (+r.amount || 0), 0);
      const balance = incTotal - expTotal;

      // פילוח לפי קטגוריה (הוצאות בלבד)
      const catMap = {};
      expRows.forEach(r => {
        const c = r.category || 'ללא קטגוריה';
        const g = catMap[c] || (catMap[c] = { category: c, total: 0, count: 0 });
        g.total += +r.amount || 0; g.count++;
      });
      const cats = Object.values(catMap).sort((a, b) => b.total - a.total);

      // השוואה לחודש קודם (לפי הסדרה הכרונולוגית)
      const idx = series.findIndex(s => s.month === sel);
      const prev = idx > 0 ? series[idx - 1] : null;
      const delta = prev ? expTotal - prev.expenses : null;
      let deltaSub = '';
      if (prev) {
        const pct = prev.expenses > 0 ? Math.round(Math.abs(delta) / prev.expenses * 100) : null;
        deltaSub = delta === 0 ? 'ללא שינוי מהחודש הקודם'
          : (delta > 0 ? '▲ ' : '▼ ') + money0(Math.abs(delta)) + ' מ' + monLabel(prev.month) + (pct != null ? ` (${pct}%)` : '');
      }
      const avgDay = expTotal / new Date(+sel.slice(0, 4), +sel.slice(5, 7), 0).getDate();

      // השוואת קטגוריות — תמיד לפי סדר כרונולוגי (מוקדם→מאוחר) כדי ש-▲=עלה, ▼=ירד יהיו נכונים
      // גם כשחודש ההשוואה מאוחר יותר מהנבחר. delta = מאוחר − מוקדם.
      const olderM = cmp ? (cmp < sel ? cmp : sel) : null;
      const newerM = cmp ? (cmp < sel ? sel : cmp) : null;
      const olderMap = olderM ? catMapOf(olderM) : {}, newerMap = newerM ? catMapOf(newerM) : {};
      const olderTotal = Object.values(olderMap).reduce((s, v) => s + v, 0);
      const newerTotal = Object.values(newerMap).reduce((s, v) => s + v, 0);
      const allCats = [...new Set([...Object.keys(olderMap), ...Object.keys(newerMap)])];
      const compRows = allCats.map(c => { const a = olderMap[c] || 0, b = newerMap[c] || 0; return { cat: c, a, b, delta: b - a }; })
        .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
      let topUp = null, topDown = null;
      compRows.forEach(r => {
        if (r.delta > 0 && (!topUp || r.delta > topUp.delta)) topUp = r;
        if (r.delta < 0 && (!topDown || r.delta < topDown.delta)) topDown = r;
      });
      const totalDelta = newerTotal - olderTotal;
      const dCol = (d) => d > 0 ? 'var(--red)' : (d < 0 ? 'var(--green)' : 'var(--muted)');
      const dCell = (d, base) => { if (d === 0) return '—'; const pct = base > 0 ? ' (' + Math.round(Math.abs(d) / base * 100) + '%)' : (base === 0 ? ' (חדש)' : ''); return (d > 0 ? '▲ ' : '▼ ') + money0(Math.abs(d)) + pct; };

      // סיכום כולל לכל החודשים
      const grandExp = series.reduce((s, m) => s + m.expenses, 0);
      const grandInc = series.reduce((s, m) => s + m.income, 0);

      view().innerHTML = `
        <div class="page-head"><h2>דוח בית — ${monLabel(sel)}</h2><div class="spacer"></div>
          <button class="btn ghost sm" id="hrPrint">🖨️ הדפסה</button>
          <button class="btn ghost sm" id="hrBack">→ חזרה לניהול הבית</button></div>

        <div class="card" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <label style="font-weight:600">חודש:</label>
          <button class="btn xs ghost" id="hrPrev" ${idx <= 0 ? 'disabled' : ''}>◀ קודם</button>
          <select id="hrMonth" style="min-width:160px">${monthsDesc.map(m => `<option value="${m}" ${m === sel ? 'selected' : ''}>${monLabel(m)}</option>`).join('')}</select>
          <button class="btn xs ghost" id="hrNext" ${idx >= series.length - 1 ? 'disabled' : ''}>הבא ▶</button>
        </div>

        <div class="grid stat-grid">
          ${stat('הוצאות החודש', money(expTotal), 'r', deltaSub || null)}
          ${stat('הכנסות החודש', money(incTotal), 'g')}
          ${stat('מאזן', money(balance), balance >= 0 ? 'g' : 'r')}
          ${stat('מס\' הוצאות', money0(expRows.length), '', 'ממוצע ' + money(avgDay) + ' ליום')}
        </div>

        <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
          <div class="card" style="flex:1 1 320px;min-width:300px">
            <h3 style="margin-top:0">התפלגות הוצאות לפי קטגוריה</h3>
            <div id="hrDonut"></div>
          </div>
          <div class="card" style="flex:1 1 340px;min-width:300px">
            <h3 style="margin-top:0">פילוח קטגוריות</h3>
            <div id="hrBars"></div>
            <div id="hrTable" style="margin-top:12px"></div>
          </div>
        </div>

        <div class="card">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
            <h3 style="margin:0">השוואת קטגוריות — ${monLabel(sel)} מול</h3>
            <select id="hrCmp" style="min-width:150px">${monthsDesc.filter(m => m !== sel).map(m => `<option value="${m}" ${m === cmp ? 'selected' : ''}>${monLabel(m)}</option>`).join('')}</select>
          </div>
          ${!cmp ? '<div class="muted">אין חודש נוסף להשוואה</div>' : `
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
            ${topUp ? `<span class="pill" style="background:#fef2f2;color:var(--red);border:1px solid #fecaca;padding:5px 10px;border-radius:20px;font-size:13px;font-weight:600">▲ הכי עלתה: ${esc(topUp.cat)} +${money0(topUp.delta)}</span>` : ''}
            ${topDown ? `<span class="pill" style="background:#f0fdf4;color:var(--green);border:1px solid #bbf7d0;padding:5px 10px;border-radius:20px;font-size:13px;font-weight:600">▼ הכי ירדה: ${esc(topDown.cat)} −${money0(-topDown.delta)}</span>` : ''}
          </div>
          <div style="overflow-x:auto"><table><thead><tr><th>קטגוריה</th><th>${esc(monLabel(olderM))}</th><th>${esc(monLabel(newerM))}</th><th>שינוי</th></tr></thead><tbody>
            ${compRows.map(r => `<tr>
              <td>${esc(r.cat)}</td>
              <td class="num">${money(r.a)}</td>
              <td class="num">${money(r.b)}</td>
              <td class="num" style="color:${dCol(r.delta)};font-weight:700">${dCell(r.delta, r.a)}</td></tr>`).join('')}
            <tr style="border-top:2px solid var(--line);font-weight:800"><td>סה"כ הוצאות</td><td class="num">${money(olderTotal)}</td><td class="num">${money(newerTotal)}</td><td class="num" style="color:${dCol(totalDelta)}">${dCell(totalDelta, olderTotal)}</td></tr>
          </tbody></table></div>`}
        </div>

        <div class="card">
          <h3 style="margin-top:0">מגמת הוצאות חודשית</h3>
          <p class="mini muted" style="margin-top:0">לחץ על עמודה כדי לעבור לחודש. החודש הנבחר מודגש.</p>
          <div id="hrTrend"></div>
        </div>

        <div class="card">
          <h3 style="margin-top:0">סיכום הוצאות לפי חודש</h3>
          <div style="overflow-x:auto"><table><thead><tr><th>חודש</th><th>הוצאות</th><th>הכנסות</th><th>מאזן</th></tr></thead><tbody>
            ${series.slice().reverse().map(m => { const bal = m.income - m.expenses, on = m.month === sel; return `<tr class="hr-mrow" data-month="${m.month}" style="cursor:pointer${on ? ';background:var(--soft);font-weight:700' : ''}">
              <td>${monLabel(m.month)}${on ? ' •' : ''}</td>
              <td class="num" style="font-weight:700;color:var(--red)">${money(m.expenses)}</td>
              <td class="num" style="color:var(--green)">${money(m.income)}</td>
              <td class="num" style="color:${bal >= 0 ? 'var(--green)' : 'var(--red)'}">${money(bal)}</td></tr>`; }).join('')}
            <tr style="border-top:2px solid var(--line);font-weight:800"><td>סה"כ · ${series.length} חודשים</td><td class="num" style="color:var(--red)">${money(grandExp)}</td><td class="num" style="color:var(--green)">${money(grandInc)}</td><td class="num" style="color:${grandInc - grandExp >= 0 ? 'var(--green)' : 'var(--red)'}">${money(grandInc - grandExp)}</td></tr>
          </tbody></table></div>
        </div>`;

      $('#hrBack').onclick = () => scrHome();
      $('#hrPrint').onclick = () => window.print();
      $('#hrMonth').onchange = (e) => { sel = e.target.value; cmp = adjOf(sel); render(); };
      $('#hrPrev').onclick = () => { if (idx > 0) { sel = series[idx - 1].month; cmp = adjOf(sel); render(); } };
      $('#hrNext').onclick = () => { if (idx < series.length - 1) { sel = series[idx + 1].month; cmp = adjOf(sel); render(); } };
      const cmpSel = $('#hrCmp'); if (cmpSel) cmpSel.onchange = (e) => { cmp = e.target.value || null; render(); };

      drawDonut($('#hrDonut'), cats.map(c => ({ label: c.category, value: c.total })));
      drawCatBars($('#hrBars'), cats);
      $('#hrTable').innerHTML = cats.length ? `<table><thead><tr><th>קטגוריה</th><th>סכום</th><th>%</th><th>תנועות</th></tr></thead><tbody>${cats.map((c, i) => `
        <tr><td><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${PALETTE[i % PALETTE.length]};margin-left:6px"></i>${esc(c.category)}</td>
        <td class="num" style="font-weight:700">${money(c.total)}</td>
        <td class="num">${expTotal > 0 ? Math.round(c.total / expTotal * 100) : 0}%</td>
        <td class="num">${c.count}</td></tr>`).join('')}
        <tr style="border-top:2px solid var(--line);font-weight:800"><td>סה"כ</td><td class="num">${money(expTotal)}</td><td class="num">100%</td><td class="num">${expRows.length}</td></tr>
        </tbody></table>` : '<div class="empty">אין הוצאות בחודש זה</div>';
      drawMonthExpenseBars($('#hrTrend'), series, sel);
      $('#hrTrend').querySelectorAll('.mbar').forEach(b => b.onclick = () => { sel = b.dataset.month; cmp = adjOf(sel); render(); });
      view().querySelectorAll('.hr-mrow').forEach(tr => tr.onclick = () => { sel = tr.dataset.month; cmp = adjOf(sel); render(); });
    }
    render();
  }
  function drawCatBars(box, data) {
    if (!data || !data.length) { box.innerHTML = '<div class="empty">אין הוצאות בחודש זה</div>'; return; }
    const max = Math.max(1, ...data.map(d => d.total));
    box.innerHTML = data.map((d, i) => {
      const pct = Math.max(2, Math.round(d.total / max * 100)), col = PALETTE[i % PALETTE.length];
      return `<div style="display:flex;align-items:center;gap:10px;margin:7px 0">
        <div style="width:120px;flex:none;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(d.category)}">${esc(d.category)}</div>
        <div style="flex:1;background:var(--soft);border-radius:6px;height:18px;min-width:50px"><div style="width:${pct}%;background:${col};height:100%;border-radius:6px"></div></div>
        <div style="width:84px;flex:none;text-align:left;font-weight:700;font-size:13px">${money0(d.total)}</div>
      </div>`;
    }).join('');
  }
  function drawMonthExpenseBars(box, series, sel) {
    if (!series || !series.length) { box.innerHTML = '<div class="empty">אין נתונים</div>'; return; }
    const W = 720, H = 220, pad = 34;
    const max = Math.max(1, ...series.map(r => r.expenses));
    const step = (W - 40) / series.length, bw = Math.min(46, step * 0.55);
    let g = '';
    series.forEach((r, i) => {
      const cx = 20 + step * i + step / 2, h = (H - pad - 24) * (r.expenses / max), y = H - pad - h, on = r.month === sel;
      g += `<rect class="mbar" data-month="${r.month}" x="${cx - bw / 2}" y="${y}" width="${bw}" height="${Math.max(0, h)}" rx="3" fill="${on ? '#dc2626' : '#fca5a5'}" style="cursor:pointer"><title>${monLabel(r.month)}: ${money(r.expenses)}</title></rect>`;
      g += `<text x="${cx}" y="${H - pad + 15}" text-anchor="middle" font-size="11" fill="${on ? '#0f172a' : '#64748b'}" font-weight="${on ? '700' : '400'}">${r.month.slice(5)}/${r.month.slice(2, 4)}</text>`;
    });
    box.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}">${g}<line x1="20" y1="${H - pad}" x2="${W - 20}" y2="${H - pad}" stroke="#e2e8f0"/></svg>`;
  }
  function homeForm(r) {
    r = r || {};
    openModal(r.id ? 'עריכת תנועת בית' : 'תנועת בית חדשה', `
      <div class="row">
        <div class="field"><label>סוג</label><select id="h_dir"><option value="out" ${r.direction === 'out' ? 'selected' : ''}>הוצאה</option><option value="in" ${r.direction === 'in' ? 'selected' : ''}>הכנסה</option></select></div>
        <div class="field"><label>סכום (₪) *</label><input id="h_amount" type="number" value="${r.amount != null ? r.amount : ''}"></div>
        <div class="field"><label>תאריך</label><input id="h_date" type="date" value="${r.date ? String(r.date).slice(0, 10) : today()}"></div>
      </div>
      <div class="row">
        <div class="field"><label>קטגוריה</label><input id="h_cat" value="${esc(r.category || '')}" placeholder="מזון / חשמל / דלק"></div>
        <div class="field"><label>ספק / למי</label><input id="h_payee" value="${esc(r.payee || '')}"></div>
        <div class="field"><label>אמצעי</label><select id="h_src">
          <option value="cash" ${(r.source || 'cash') === 'cash' ? 'selected' : ''}>מזומן</option>
          <option value="credit" ${r.source === 'credit' ? 'selected' : ''}>אשראי</option>
          <option value="transfer" ${r.source === 'transfer' ? 'selected' : ''}>העברה</option>
          <option value="bank" ${r.source === 'bank' ? 'selected' : ''}>בנק</option>
          <option value="form" ${r.source === 'form' ? 'selected' : ''}>אחר</option></select></div>
      </div>
      <div class="field"><label>הערה</label><input id="h_note" value="${esc(r.note || '')}"></div>`,
      [{ label: 'שמירה', onClick: async (close) => {
        const amount = parseFloat(fv('h_amount')); if (!(amount > 0)) return toast('הזן סכום', 'err');
        const d = { direction: fv('h_dir'), amount, date: fv('h_date') || null, category: fv('h_cat'), payee: fv('h_payee'), note: fv('h_note'), source: fv('h_src') || 'cash' };
        await guard(r.id ? window.Store.home.update(r.id, d) : window.Store.home.create(d));
        close(); toast('נשמר', 'ok'); scrHome();
      } }, { label: 'ביטול', cls: 'ghost', onClick: (c) => c() }]);
  }
  let _homeImp = null;
  async function homeImport() {
    const rules = await guard(window.Store.home.rules());
    const cats = [...new Set((rules || []).map(r => r.category))];
    openModal('ייבוא מבנק / אשראי / מזומן', `
      <p class="mini">הדבק שורות מהבנק/אשראי (כדאי לכלול שורת כותרת). לחץ "נתח" ובדוק שהעמודות ממופות נכון — אפשר לתקן.</p>
      <div class="field"><label>הדבקה</label><textarea id="imp_text" rows="6" placeholder="הדבק כאן..."></textarea></div>
      <div class="field"><label>מקור</label><select id="imp_src"><option value="bank">בנק</option><option value="credit">אשראי</option><option value="cash">מזומן</option></select></div>
      <button class="btn ghost sm" id="imp_parse">נתח ↓</button>
      <div id="imp_map" style="margin-top:10px"></div>
      <div id="imp_preview" style="margin-top:10px;overflow-x:auto"></div>
      <datalist id="catlist">${cats.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist>`,
      [{ label: 'ייבוא', cls: 'green', onClick: async (close) => {
        const rows = collectImportRows();
        if (!rows.length) return toast('אין שורות. לחץ "נתח" קודם', 'err');
        await guard(window.Store.home.import(rows));
        close(); toast(rows.length + ' שורות יובאו', 'ok'); scrHome();
      } }, { label: 'ביטול', cls: 'ghost', onClick: (c) => c() }]);
    $('#imp_parse').onclick = () => {
      _homeImp = parseHomeGrid(fv('imp_text'), rules);
      if (!_homeImp) { $('#imp_map').innerHTML = ''; $('#imp_preview').innerHTML = '<div class="empty">לא זוהו שורות עם סכום</div>'; return; }
      const { cols, colLabel, auto } = _homeImp;
      const opt = (sel) => '<option value="-1">— (ללא) —</option>' + Array.from({ length: cols }, (_, j) => `<option value="${j}" ${j === sel ? 'selected' : ''}>${esc((colLabel[j] || '').slice(0, 18))} · עמ' ${j + 1}</option>`).join('');
      const fld = (k, label, sel) => `<div class="field" style="min-width:140px"><label>${label}</label><select class="hmpsel" data-key="${k}">${opt(sel)}</select></div>`;
      $('#imp_map').innerHTML = `<div class="mini" style="margin-bottom:6px">זוהו ${_homeImp.dataRows.length} שורות. מיפוי עמודות (תקן אם צריך):</div><div class="row">${fld('date', 'תאריך', auto.date)}${fld('payee', 'תיאור/עסק', auto.payee)}${fld('amount', 'סכום', auto.amount)}${fld('category', 'קטגוריה', auto.category)}</div>`;
      document.querySelectorAll('.hmpsel').forEach(s => s.onchange = renderHomePrev);
      renderHomePrev();
    };
  }
  function homeMap() { const m = {}; document.querySelectorAll('.hmpsel').forEach(s => m[s.dataset.key] = parseInt(s.value)); return m; }
  function renderHomePrev() {
    if (!_homeImp) return;
    const m = homeMap();
    const rowsHtml = _homeImp.dataRows.map((r, i) => {
      const payee = m.payee >= 0 ? String(r[m.payee] || '') : '';
      let cat = m.category >= 0 ? String(r[m.category] || '') : '';
      if (!cat) for (const rl of (_homeImp.rules || [])) { if (payee && payee.includes(rl.match_text)) { cat = rl.category; break; } }
      return `<tr data-imp="${i}">
        <td><input class="ip-date" value="${esc(m.date >= 0 ? normDate(r[m.date]) : '')}" style="width:110px"></td>
        <td><input class="ip-payee" value="${esc(payee)}" style="width:150px"></td>
        <td><input class="ip-amount" type="number" value="${m.amount >= 0 ? (impNum(r[m.amount]) || '') : ''}" style="width:90px"></td>
        <td><input class="ip-cat" value="${esc(cat)}" list="catlist" style="width:120px"></td></tr>`;
    }).join('');
    $('#imp_preview').innerHTML = `<table><thead><tr><th>תאריך</th><th>תיאור/עסק</th><th>סכום</th><th>קטגוריה</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
  }
  function parseHomeGrid(text, rules) {
    const lines = (text || '').split(/\r?\n/).filter(l => l.trim() !== '');
    if (!lines.length) return null;
    const grid = lines.map(l => (l.indexOf('\t') >= 0 ? l.split('\t') : l.split(/ {2,}|,|;/)).map(c => c.trim()));
    const cols = Math.max(...grid.map(r => r.length)); grid.forEach(r => { while (r.length < cols) r.push(''); });
    const dateRe = /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/;
    const isData = grid.map(r => r.some(c => impNum(c) !== null));
    const headerRows = grid.filter((r, i) => !isData[i]);
    const dataRows = grid.filter((r, i) => isData[i]);
    if (!dataRows.length) return null;
    const colLabel = []; for (let j = 0; j < cols; j++) colLabel[j] = headerRows.map(r => String(r[j] || '').trim()).filter(Boolean).join(' ') || ('עמודה ' + (j + 1));
    const byLabel = (kw) => { for (let j = 0; j < cols; j++) if (colLabel[j].indexOf(kw) >= 0) return j; return -1; };
    let dateCol = byLabel('תאריך'); if (dateCol < 0) for (let j = 0; j < cols; j++) if (dataRows.some(r => dateRe.test(r[j]))) { dateCol = j; break; }
    let amtCol = byLabel('סכום'); if (amtCol < 0) amtCol = byLabel('חיוב'); if (amtCol < 0) amtCol = byLabel('חובה'); if (amtCol < 0) amtCol = byLabel('זכות');
    if (amtCol < 0) { const cand = []; for (let j = 0; j < cols; j++) { if (j === dateCol) continue; if (dataRows.filter(r => impNum(r[j]) !== null).length > dataRows.length / 2) cand.push(j); } amtCol = cand.find(j => colLabel[j].indexOf('יתרה') < 0); if (amtCol == null) amtCol = cand.length ? cand[0] : -1; }
    let catCol = byLabel('קטגוריה');
    let payCol = byLabel('סוג תנועה'); if (payCol < 0) payCol = byLabel('בית עסק'); if (payCol < 0) payCol = byLabel('תיאור'); if (payCol < 0) payCol = byLabel('ספק'); if (payCol < 0) payCol = byLabel('שם');
    const textCols = []; for (let j = 0; j < cols; j++) if (j !== dateCol && j !== amtCol && dataRows.some(r => r[j] && impNum(r[j]) === null)) textCols.push(j);
    if (payCol < 0) { const c = textCols.find(j => j !== catCol); if (c != null) payCol = c; }
    if (catCol < 0) { const c = textCols.find(j => j !== payCol); if (c != null) catCol = c; }
    return { dataRows, cols, colLabel, rules: rules || [], auto: { date: dateCol, payee: payCol == null ? -1 : payCol, amount: amtCol, category: catCol == null ? -1 : catCol } };
  }
  function collectImportRows() {
    return [...document.querySelectorAll('#imp_preview tr[data-imp]')].map(tr => ({
      date: normDate($('.ip-date', tr).value.trim()),
      payee: $('.ip-payee', tr).value.trim(),
      amount: parseFloat($('.ip-amount', tr).value) || 0,
      category: $('.ip-cat', tr).value.trim(),
      direction: 'out',
      source: fv('imp_src') || 'bank',
    })).filter(r => r.amount > 0);
  }
  function isValidYMD(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [Y, M, D] = s.split('-').map(Number);
    if (M < 1 || M > 12 || D < 1 || D > 31) return false;
    const dt = new Date(Y, M - 1, D);
    return dt.getFullYear() === Y && dt.getMonth() === M - 1 && dt.getDate() === D;
  }
  function normDate(d) {
    if (!d) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return isValidYMD(d) ? d : '';
    const m = d.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    if (!m) return '';
    let [, dd, mm, yy] = m; if (yy.length === 2) yy = '20' + yy;
    const iso = yy + '-' + mm.padStart(2, '0') + '-' + dd.padStart(2, '0');
    return isValidYMD(iso) ? iso : '';
  }

  // ============================================================
  //  RECYCLE BIN
  // ============================================================
  async function scrRecycle() {
    loading();
    const rows = await guard(window.Store.recycle.list());
    view().innerHTML = `
      <div class="page-head"><h2>סל מחזור</h2><span class="mini">פריטים שנמחקו — ניתן לשחזר</span></div>
      <div class="card">${rows.length ? `<table><thead><tr><th>סוג</th><th>פריט</th><th>פרטים</th><th>סכום</th><th></th></tr></thead><tbody>${rows.map(r => `
        <tr><td><span class="tag-trade">${esc(r._label)}</span></td><td>${esc(r.title || '')}</td><td class="mini">${esc(r.subtitle || '')}</td>
        <td class="num">${r.amount ? money(r.amount) : ''}</td>
        <td><button class="btn xs green" data-restore="${r._table}:${r.id}">↩️ שחזר</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty"><div class="big">♻️</div>סל המחזור ריק</div>'}</div>`;
    view().querySelectorAll('[data-restore]').forEach(b => b.onclick = async () => { const [table, id] = b.dataset.restore.split(':'); await guard(window.Store.recycle.restore(table, +id)); toast('שוחזר', 'ok'); scrRecycle(); });
  }

  // ============================================================
  //  USERS
  // ============================================================
  async function scrUsers() {
    loading();
    const [users, roles] = await Promise.all([guard(window.Store.users.list()), guard(window.Store.users.roles())]);
    const roleLabel = (k) => (roles.find(r => r.key === k) || {}).label || k;
    const myId = (window.Auth.user || {}).id;
    view().innerHTML = `
      <div class="page-head"><h2>משתמשים</h2><div class="spacer"></div><button class="btn" id="newUser">➕ משתמש חדש</button></div>
      <div class="card"><table><thead><tr><th>שם משתמש</th><th>שם מלא</th><th>תפקיד</th><th>סטטוס</th><th></th></tr></thead><tbody>${users.map(u => `
        <tr${u.active === false ? ' style="opacity:.55"' : ''}><td>${esc(u.username)}</td><td>${esc(u.full_name || '')}</td><td>${esc(roleLabel(u.role))}</td>
        <td>${u.active === false ? '<span class="pill out">מושבת</span>' : '<span class="pill in">פעיל</span>'}</td>
        <td><button class="btn xs ghost" data-edituser="${u.id}">✏️</button><button class="btn xs" data-linkuser="${u.id}" title="קישור גישה ללא סיסמא">🔗</button>${u.id !== myId ? `<button class="btn xs red" data-deluser="${u.id}" title="השבתת משתמש">🗑️</button>` : ''}</td></tr>`).join('')}</tbody></table>
      <div class="mini" style="margin-top:8px">🔗 = קישור כניסה ללא סיסמא · 🗑️ = השבתת משתמש (ניתן להחזרה דרך ✏️).</div></div>`;
    $('#newUser').onclick = () => userForm(null, roles);
    view().querySelectorAll('[data-edituser]').forEach(b => b.onclick = () => userForm(users.find(x => x.id === +b.dataset.edituser), roles));
    view().querySelectorAll('[data-linkuser]').forEach(b => b.onclick = () => accessLinkModal(users.find(x => x.id === +b.dataset.linkuser)));
    view().querySelectorAll('[data-deluser]').forEach(b => b.onclick = async () => {
      const uu = users.find(x => x.id === +b.dataset.deluser);
      if (await confirmDialog(`להשבית את "${uu.username}"? הוא לא יוכל להתחבר (אפשר להחזיר בעריכה).`, 'השבתה')) {
        await guard(window.Store.users.remove(uu.id)); toast('המשתמש הושבת', 'ok'); scrUsers();
      }
    });
  }
  async function accessLinkModal(u) {
    const res = await guard(window.Store.users.link(u.id));
    const url = location.origin + '/?k=' + res.token;
    openModal('קישור גישה — ' + (u.full_name || u.username), `
      <p class="mini">שלח את הקישור למשתמש. לחיצה עליו מכניסה אותו אוטומטית (בלי סיסמא) לתפקידו, ותקף ל-180 יום. אל תשתף בפומבי — מי שיש לו את הקישור נכנס.</p>
      <div class="field"><label>הקישור</label><textarea id="lk_url" rows="3" readonly style="direction:ltr;font-size:12px">${esc(url)}</textarea></div>`,
      [{ label: '📋 העתק קישור', cls: 'green', onClick: () => {
        const t = document.getElementById('lk_url'); if (t) { t.select(); try { document.execCommand('copy'); } catch (e) {} }
        if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {});
        toast('הקישור הועתק', 'ok');
      } }, { label: 'סגור', cls: 'ghost', onClick: (c) => c() }]);
  }
  function userForm(u, roles) {
    u = u || {};
    openModal(u.id ? 'עריכת משתמש' : 'משתמש חדש', `
      <div class="field"><label>שם משתמש *</label><input id="u_name" value="${esc(u.username || '')}"></div>
      <div class="field"><label>שם מלא</label><input id="u_full" value="${esc(u.full_name || '')}"></div>
      <div class="field"><label>תפקיד *</label><select id="u_role">${roles.map(r => `<option value="${r.key}" ${u.role === r.key ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select></div>
      <div class="field"><label>סיסמא ${u.id ? '(השאר ריק כדי לא לשנות)' : '*'}</label><input id="u_pass" type="password"></div>
      ${u.id ? `<div class="field"><label>סטטוס</label><select id="u_active"><option value="1" ${u.active !== false ? 'selected' : ''}>פעיל</option><option value="0" ${u.active === false ? 'selected' : ''}>מושבת</option></select></div>` : ''}`,
      [{ label: 'שמירה', onClick: async (close) => {
        const username = fv('u_name'); if (!username) return toast('שם משתמש חובה', 'err');
        const d = { username, full_name: fv('u_full'), role: fv('u_role') };
        const pass = fv('u_pass'); if (pass) d.password = pass;
        if (u.id) d.active = fv('u_active') === '1';
        if (!u.id && !pass) return toast('סיסמא חובה', 'err');
        await guard(u.id ? window.Store.users.update(u.id, d) : window.Store.users.create(d));
        close(); toast('נשמר', 'ok'); scrUsers();
      } }, { label: 'ביטול', cls: 'ghost', onClick: (c) => c() }]);
  }

  // ============================================================
  //  PAYMENT REQUEST CALCULATOR (חישוב בלבד - לא נשמר)
  // ============================================================
  // רכיב חיפוש לחיץ (typeahead): הקלדה → תוצאות תואמות קופצות → בחירה בעכבר/מקלדת.
  // getItems() מחזיר [{id,label,sub?}] (דינמי). onPick(item|null) נקרא בבחירה/ניקוי.
  function makeTypeahead(input, list, getItems, onPick) {
    let picked = null, filtered = [], active = -1;
    const norm = (s) => String(s == null ? '' : s).toLowerCase();
    function hi(label, qn) {
      const s = String(label == null ? '' : label);
      const i = qn ? norm(s).indexOf(qn) : -1;
      if (i < 0) return esc(s);
      return esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + qn.length)) + '</mark>' + esc(s.slice(i + qn.length));
    }
    function open(q) {
      const qn = norm(q).trim();
      const items = getItems() || [];
      filtered = (qn ? items.filter(it => norm(it.label).includes(qn) || norm(it.sub).includes(qn)) : items).slice(0, 40);
      active = -1;
      if (!filtered.length) { list.innerHTML = '<div class="ta-empty">אין תוצאות</div>'; list.classList.add('open'); return; }
      list.innerHTML = filtered.map((it, i) => `<div class="ta-item" data-i="${i}">${hi(it.label, qn)}${it.sub ? `<span class="ta-sub">${esc(it.sub)}</span>` : ''}</div>`).join('');
      list.classList.add('open');
      list.querySelectorAll('.ta-item').forEach(el => { el.onmousedown = (e) => { e.preventDefault(); choose(filtered[+el.dataset.i]); }; });
    }
    function close() { list.classList.remove('open'); active = -1; }
    function paint() {
      list.querySelectorAll('.ta-item').forEach((el, i) => el.classList.toggle('active', i === active));
      const el = list.querySelector('.ta-item.active'); if (el) el.scrollIntoView({ block: 'nearest' });
    }
    function choose(it) { if (!it) return; picked = it; input.value = it.label; close(); onPick(it); }
    input.addEventListener('focus', () => open(input.value));
    input.addEventListener('input', () => { if (picked && input.value !== picked.label) { picked = null; onPick(null); } open(input.value); });
    input.addEventListener('keydown', (e) => {
      if (!list.classList.contains('open')) { if (e.key === 'ArrowDown') open(input.value); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, filtered.length - 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); paint(); }
      else if (e.key === 'Enter') { if (active >= 0 && filtered[active]) { e.preventDefault(); choose(filtered[active]); } }
      else if (e.key === 'Escape') { close(); }
    });
    input.addEventListener('blur', () => setTimeout(close, 120));  // דיליי כדי לאפשר לחיצה על פריט
    return { reset() { picked = null; input.value = ''; close(); }, value() { return picked; } };
  }

  async function scrPayRequest() {
    loading();
    const projects = await guard(window.Store.projects.list());
    let lines = await guard(window.Store.payreq.list());   // רשומות מהשרת (נשמרות עד מחיקה)
    const stageCache = {};       // projId -> stages[]
    let selProj = null;

    view().innerHTML = `
      <div class="page-head"><h2>בונה בקשת תשלום</h2><span class="mini">בחר פרויקט, הזן כמה הקבלן מבקש בכל שלב, והוסף לבקשה</span></div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
        <div class="card" style="flex:1 1 380px;min-width:300px">
          <div class="field"><label>פרויקט</label><div class="ta"><input id="pr_proj_in" placeholder="הקלד לחיפוש פרויקט..." autocomplete="off"><div class="ta-list" id="pr_proj_list"></div></div></div>
          <div id="pr_stagesForm" style="margin-top:12px"></div>
        </div>
        <div class="card" id="pr_report" style="flex:2 1 520px;min-width:320px;background:var(--soft)"></div>
      </div>`;

    // בחירת פרויקט → טוענת ומציגה את שלביו הפתוחים לקבלן
    makeTypeahead($('#pr_proj_in'), $('#pr_proj_list'),
      () => projects.map(p => ({ id: p.id, label: p.name })),
      async (pick) => {
        selProj = pick;
        if (!pick) { $('#pr_stagesForm').innerHTML = ''; return; }
        if (!stageCache[pick.id]) { const d = await guard(window.Store.projects.get(pick.id)); stageCache[pick.id] = d.stages || []; }
        renderStagesForm();
      });

    const existingReq = (projId, stageId) => { const l = lines.find(x => x.project_id === projId && x.stage_id === stageId); return l ? l.requested : null; };

    // טופס הזנה: כל השלבים הפתוחים לקבלן בפרויקט + שדה סכום לכל שלב
    function renderStagesForm() {
      const box = $('#pr_stagesForm');
      if (!selProj) { box.innerHTML = ''; return; }
      const open = (stageCache[selProj.id] || []).filter(s => ((+s.sub_amount || 0) - (+s.paid_sub || 0)) > 0.5);
      if (!open.length) { box.innerHTML = '<div class="empty" style="padding:18px">כל השלבים בפרויקט זה שולמו במלואם לקבלן 🎉</div>'; return; }
      box.innerHTML = `<div class="mini muted" style="margin-bottom:6px">שלבים פתוחים לקבלן — הזן כמה הוא מבקש בכל שלב:</div>
        <div style="overflow-x:auto"><table><thead><tr><th>שלב</th><th class="num">סכום לקבלן</th><th class="num">נותר</th><th class="num">כמה מבקש</th></tr></thead><tbody>
        ${open.map(s => { const rem = (+s.sub_amount || 0) - (+s.paid_sub || 0), ex = existingReq(selProj.id, s.id); return `<tr>
          <td>${esc(s.name)}</td>
          <td class="num">${money0(s.sub_amount)}</td>
          <td class="num" style="color:var(--brand-d)">${money0(rem)}</td>
          <td><input class="pr_amt" data-stage="${s.id}" type="number" placeholder="0" value="${ex != null ? ex : ''}" style="width:110px;padding:7px;border:1px solid var(--line);border-radius:8px"></td></tr>`; }).join('')}
        </tbody></table></div>
        <button class="btn green" id="pr_addAll" style="margin-top:12px">➕ הוסף לבקשה</button>`;
      $('#pr_addAll').onclick = addAll;
    }

    // הוספת כל השלבים שהוזן בהם סכום (שלב שכבר בבקשה — מוחלף בערך החדש)
    async function addAll() {
      const stages = stageCache[selProj.id] || [];
      const toSet = [];
      $('#pr_stagesForm').querySelectorAll('.pr_amt').forEach(inp => {
        const v = inp.value.trim(); if (v === '') return;
        const amt = parseFloat(v); if (isNaN(amt) || amt < 0) return;
        toSet.push({ stageId: +inp.dataset.stage, amt });
      });
      if (!toSet.length) { toast('הזן סכום בשלב אחד לפחות', 'err'); return; }
      for (const it of toSet) {
        const s = stages.find(x => x.id === it.stageId); if (!s) continue;
        const exist = lines.find(x => x.project_id === selProj.id && x.stage_id === it.stageId);
        if (exist) { await guard(window.Store.payreq.remove(exist.id)); lines = lines.filter(x => x.id !== exist.id); }
        const saved = await guard(window.Store.payreq.create({
          project_id: selProj.id, project_name: selProj.label,
          stage_id: s.id, stage_name: s.name, sub_name: s.subcontractor_name || '',
          requested: it.amt,
          sub_remaining: (+s.sub_amount || 0) - (+s.paid_sub || 0),
          client_owes: (+s.client_amount || 0) - (+s.paid_in || 0)
        }));
        lines.unshift(saved);
      }
      toast(`${toSet.length} שלבים נוספו לבקשה`, 'ok');
      renderStagesForm(); renderReport();
    }

    const stageLinesArr = () => lines.filter(l => l.stage_id != null);
    const manualLinesArr = () => lines.filter(l => l.stage_id == null);

    // קיבוץ שלבים לפי פרויקט + סיכומי טורים (מבוקש / נשאר לקבלן אחרי / יתרה ללקוח)
    function groupByProject() {
      const groups = [], byKey = {};
      stageLinesArr().forEach(l => {
        const key = l.project_id == null ? 'p_null_' + l.id : 'p' + l.project_id;
        let g = byKey[key];
        if (!g) { g = byKey[key] = { name: l.project_name || '—', requested: 0, owes: 0, items: [], seen: {} }; groups.push(g); }
        g.requested += +l.requested || 0; g.items.push(l);
        const sk = 's' + l.stage_id;
        if (!g.seen[sk]) { g.seen[sk] = 1; g.owes += +l.client_owes || 0; }
      });
      return groups;
    }

    // דוח הבקשה בטבלה: פרויקט (פעם אחת) · שלב · מבוקש · נשאר לקבלן אחרי · יתרה ללקוח + סיכום לכל פרויקט + סיכום כללי + תוספות ידניות
    function renderReport() {
      const box = $('#pr_report');
      const groups = groupByProject();
      const manual = manualLinesArr();
      const manualSum = manual.reduce((s, m) => s + (+m.requested || 0), 0);
      const grandReq = groups.reduce((s, g) => s + g.requested, 0) + manualSum;
      const grandOwes = groups.reduce((s, g) => s + g.owes, 0);
      const empty = !lines.length;
      const LIGHT = ['#fef9c3', '#dcfce7', '#dbeafe', '#fce7f3', '#f3e8ff', '#ffedd5', '#ccfbf1'];   // רקעים בהירים לכל פרויקט

      const projRows = groups.map((g, gi) => { const bg = LIGHT[gi % LIGHT.length]; return g.items.map((l, i) => {
        const after = (+l.sub_remaining || 0) - (+l.requested || 0);
        return `<tr style="background:${bg}">
          <td>${i === 0 ? `<b>${esc(g.name)}</b>` : ''}</td>
          <td>${esc(l.stage_name || '')}</td>
          <td class="num" style="font-weight:700">${money0(l.requested)}</td>
          <td class="num" style="color:${after >= 0 ? 'var(--green)' : 'var(--red)'}">${money0(after)}</td>
          <td class="num" style="color:var(--brand-d)">${money0(l.client_owes)}</td>
          <td style="width:24px;text-align:left"><button class="btn xs red" data-delline="${l.id}">✕</button></td></tr>`;
      }).join('') + `<tr style="background:${bg};font-weight:700;border-top:1px solid rgba(15,23,42,.18)">
          <td></td><td class="mini">סה"כ ${esc(g.name)}</td>
          <td class="num">${money0(g.requested)}</td><td></td>
          <td class="num" style="color:var(--brand-d)">${money0(g.owes)}</td><td></td></tr>`; }).join('');

      const manualRows = manual.map(m => `<tr>
          <td class="mini muted">תוספת</td><td>${esc(m.stage_name || '')}</td>
          <td class="num" style="font-weight:700">${money0(m.requested)}</td><td></td><td></td>
          <td style="width:24px;text-align:left"><button class="btn xs red" data-delline="${m.id}">✕</button></td></tr>`).join('');

      box.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><h3 style="margin:0">הבקשה</h3><div class="spacer" style="flex:1"></div>${!empty ? '<button class="btn xs red" id="pr_clear">🗑️ מחק הכל</button>' : ''}</div>
        ${empty ? '<div class="muted" style="margin-bottom:12px">בחר פרויקט והזן סכומים לשלבים כדי לבנות את הבקשה.</div>' : `
        <div style="overflow-x:auto"><table><thead><tr>
          <th>פרויקט</th><th>שלב</th><th class="num">מבוקש עכשיו</th><th class="num">נשאר לקבלן אחרי</th><th class="num">יתרה ללקוח</th><th></th>
        </tr></thead><tbody>
          ${projRows}${manualRows}
          <tr style="border-top:2px solid var(--ink);font-weight:800">
            <td></td><td>סה"כ הכל</td>
            <td class="num" style="color:var(--green)">${money0(grandReq)}</td>
            <td></td>
            <td class="num" style="color:var(--brand-d)">${money0(grandOwes)}</td><td></td></tr>
        </tbody></table></div>`}
        <div style="margin-top:14px;border-top:1px dashed var(--line);padding-top:10px">
          <div class="mini muted" style="margin-bottom:6px">➕ תוספת ידנית (סכום ללא שיוך לשלב):</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
            <div class="field" style="flex:2;min-width:140px;margin:0"><input id="pr_mtext" placeholder="תיאור (למשל: חומרים)"></div>
            <div class="field" style="flex:1;min-width:90px;margin:0"><input id="pr_mamt" type="number" placeholder="סכום"></div>
            <button class="btn sm" id="pr_maddBtn" style="flex:none">הוסף</button>
          </div>
        </div>
        ${!empty ? '<button class="btn ghost" id="pr_copy" style="width:100%;margin-top:14px">📋 העתק לוואטסאפ</button>' : ''}`;

      box.querySelectorAll('[data-delline]').forEach(b => b.onclick = async () => {
        const id = +b.dataset.delline; await guard(window.Store.payreq.remove(id));
        lines = lines.filter(l => l.id !== id); renderReport(); renderStagesForm(); toast('נמחק', 'ok');
      });
      $('#pr_maddBtn').onclick = async () => {
        const text = $('#pr_mtext').value.trim(), amt = parseFloat($('#pr_mamt').value) || 0;
        if (!text) return toast('הזן תיאור', 'err');
        if (!(amt > 0)) return toast('הזן סכום', 'err');
        const saved = await guard(window.Store.payreq.create({ project_id: null, project_name: null, stage_id: null, stage_name: text, sub_name: '', requested: amt, sub_remaining: 0, client_owes: 0 }));
        lines.unshift(saved); renderReport(); toast('נוסף', 'ok');
      };
      const clr = $('#pr_clear'); if (clr) clr.onclick = async () => {
        if (!await confirmDialog('למחוק את כל הבקשה? ניתן לשחזר מסל המחזור.', 'מחיקת הכל')) return;
        await guard(window.Store.payreq.clear()); lines = []; renderReport(); renderStagesForm(); toast('כל הבקשה נמחקה', 'ok');
      };
      const cp = $('#pr_copy'); if (cp) cp.onclick = () => copyRequestText(groups, manual, grandReq, grandOwes);
    }

    function copyRequestText(groups, manual, grandReq, grandOwes) {
      const d = new Date().toLocaleDateString('he-IL');
      let txt = `בקשת תשלום — ${d}\n`;
      groups.forEach(g => {
        txt += `\n📁 ${g.name}\n`;
        g.items.forEach(l => { const after = (+l.sub_remaining || 0) - (+l.requested || 0); txt += `  • ${l.stage_name || ''}: מבוקש ${money(l.requested)} · נשאר לקבלן ${money(after)} · ללקוח ${money(l.client_owes)}\n`; });
        txt += `  סה"כ: מבוקש ${money(g.requested)} · ללקוח ${money(g.owes)}\n`;
      });
      if (manual.length) { txt += `\n➕ תוספות:\n`; manual.forEach(m => { txt += `  • ${m.stage_name || ''}: ${money(m.requested)}\n`; }); }
      txt += `\n💰 סה"כ מבוקש: ${money(grandReq)}\n🟢 סה"כ ללקוח: ${money(grandOwes)}`;
      navigator.clipboard.writeText(txt).then(() => toast('הבקשה הועתקה', 'ok'), () => toast('ההעתקה נכשלה', 'err'));
    }

    renderReport();
  }

  // ============================================================
  //  CHARTS (inline SVG, no dependencies)
  // ============================================================
  const PALETTE = ['#0ea5e9', '#f59e0b', '#16a34a', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#64748b'];
  // טבעת התקדמות (כמה שולם/נגבה מתוך המתוכנן)
  function drawRing(box, done, total, label, color) {
    done = +done || 0; total = +total || 0;
    const pct = total > 0 ? Math.min(100, Math.round(done / total * 100)) : 0;
    const mid = 46, circ = 2 * Math.PI * mid, dash = circ * pct / 100;
    box.innerHTML = `<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
      <svg width="118" height="118" viewBox="0 0 120 120" style="flex:none">
        <circle cx="60" cy="60" r="${mid}" fill="none" stroke="#eef2f7" stroke-width="14"/>
        <circle cx="60" cy="60" r="${mid}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${dash} ${circ}" transform="rotate(-90 60 60)"/>
        <text x="60" y="67" text-anchor="middle" font-size="25" font-weight="800" fill="#0f172a">${pct}%</text>
      </svg>
      <div><div class="mini">${esc(label)} עד כה</div>
        <div style="font-size:20px;font-weight:800;color:${color}">${money(done)}</div>
        <div class="mini" style="margin-top:6px">מתוך ${money(total)}</div></div>
    </div>`;
  }
  // רווח שנמשך לפי פרויקט (עמודות אופקיות ב-HTML - תומך בעברית RTL)
  function drawDrawnBars(box, rows) {
    rows = (rows || []).slice().sort((a, b) => (b.actual_profit || 0) - (a.actual_profit || 0)).slice(0, 12);
    if (!rows.length) { box.innerHTML = '<div class="empty">אין נתונים</div>'; return; }
    const max = Math.max(1, ...rows.map(r => Math.abs(r.actual_profit || 0)));
    box.innerHTML = rows.map(r => {
      const v = r.actual_profit || 0, pct = Math.max(2, Math.round(Math.abs(v) / max * 100)), col = v >= 0 ? 'var(--green)' : 'var(--red)';
      return `<div style="display:flex;align-items:center;gap:12px;margin:8px 0">
        <div style="width:150px;flex:none;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(r.name)}">${esc(r.name)}</div>
        <div style="flex:1;background:#eef2f7;border-radius:6px;height:20px;min-width:60px"><div style="width:${pct}%;background:${col};height:100%;border-radius:6px"></div></div>
        <div style="width:90px;flex:none;text-align:left;font-weight:700;font-size:13px;color:${col}">${money0(v)}</div>
      </div>`;
    }).join('');
  }
  function drawMonthlyChart(box, rows) {
    if (!rows || !rows.length) { box.innerHTML = '<div class="empty">אין נתונים לתצוגה</div>'; return; }
    const W = 720, H = 240, pad = 34, bw = Math.min(60, (W - 60) / rows.length / 2.4);
    const max = Math.max(1, ...rows.map(r => Math.max(r.income, r.expenses)));
    const bh = (v) => (H - pad - 24) * (v / max);
    const step = (W - 40) / rows.length;
    let g = '';
    rows.forEach((r, i) => {
      const cx = 20 + step * i + step / 2;
      const yi = H - pad - bh(r.income), ye = H - pad - bh(r.expenses);
      g += `<rect x="${cx - bw - 2}" y="${yi}" width="${bw}" height="${bh(r.income)}" rx="3" fill="#16a34a"><title>הכנסות ${money(r.income)}</title></rect>`;
      g += `<rect x="${cx + 2}" y="${ye}" width="${bw}" height="${bh(r.expenses)}" rx="3" fill="#dc2626"><title>הוצאות ${money(r.expenses)}</title></rect>`;
      g += `<text x="${cx}" y="${H - pad + 15}" text-anchor="middle" font-size="12" fill="#64748b">${esc(r.month)}</text>`;
    });
    box.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}">${g}<line x1="20" y1="${H - pad}" x2="${W - 20}" y2="${H - pad}" stroke="#e2e8f0"/></svg>
      <div class="legend"><span><i style="background:#16a34a"></i>הכנסות</span><span><i style="background:#dc2626"></i>הוצאות</span></div>`;
  }
  function drawDonut(box, data) {
    data = (data || []).filter(d => d.value > 0);
    if (!data.length) { box.innerHTML = '<div class="empty">אין נתונים</div>'; return; }
    const total = data.reduce((s, d) => s + d.value, 0);
    const R = 70, r = 42, cx = 90, cy = 90; let a0 = -Math.PI / 2, paths = '';
    data.forEach((d, i) => {
      const a1 = a0 + (d.value / total) * Math.PI * 2;
      const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0), x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
      const xi0 = cx + r * Math.cos(a1), yi0 = cy + r * Math.sin(a1), xi1 = cx + r * Math.cos(a0), yi1 = cy + r * Math.sin(a0);
      const large = (a1 - a0) > Math.PI ? 1 : 0;
      paths += `<path d="M${x0} ${y0} A${R} ${R} 0 ${large} 1 ${x1} ${y1} L${xi0} ${yi0} A${r} ${r} 0 ${large} 0 ${xi1} ${yi1} Z" fill="${PALETTE[i % PALETTE.length]}"><title>${esc(d.label)}: ${money(d.value)}</title></path>`;
      a0 = a1;
    });
    const legend = data.map((d, i) => `<span><i style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(d.label)} · ${money(d.value)} (${Math.round(d.value / total * 100)}%)</span>`).join('');
    box.innerHTML = `<div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap"><svg width="180" height="180" viewBox="0 0 180 180">${paths}<text x="90" y="95" text-anchor="middle" font-size="15" font-weight="700" fill="#0f172a">${money0(total)}</text></svg><div class="legend" style="flex-direction:column;gap:6px">${legend}</div></div>`;
  }

  // ============================================================
  //  START
  // ============================================================
  wireLogin();
  (async function init() {
    // קישור גישה ללא סיסמא: ?k=<token> -> כניסה אוטומטית (נשמר להמשך)
    const k = new URLSearchParams(location.search).get('k');
    if (k) {
      localStorage.setItem('cc_link', k);
      sessionStorage.setItem('cc_token', k);
      history.replaceState(null, '', location.pathname);
    } else if (!sessionStorage.getItem('cc_token') && localStorage.getItem('cc_link')) {
      sessionStorage.setItem('cc_token', localStorage.getItem('cc_link'));
    }
    const u = await window.Auth.restore();
    if (u) enterApp();
  })();
})();
