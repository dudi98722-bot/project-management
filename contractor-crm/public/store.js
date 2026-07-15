/* ============================================================
   שכבת נתונים: ApiStore (שרת אמיתי) + DemoStore (בזיכרון).
   שתיהן חושפות את אותו ממשק, כך שקוד ה-UI זהה בשני המצבים.
   ============================================================ */
(function () {
  'use strict';
  const API = location.origin + '/api';

  // ---------- Auth / token ----------
  function token() { return sessionStorage.getItem('cc_token') || ''; }
  function setToken(t) { t ? sessionStorage.setItem('cc_token', t) : sessionStorage.removeItem('cc_token'); }

  async function apiFetch(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    if (token()) opts.headers['Authorization'] = 'Bearer ' + token();
    if (opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData)) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const r = await fetch(API + path, opts);
    if (r.status === 401 && token()) { setToken(''); location.reload(); throw new Error('פג תוקף'); }
    let data = null;
    try { data = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error((data && data.error) || ('שגיאה ' + r.status));
    return data;
  }

  // =====================================================================
  //  API STORE
  // =====================================================================
  const ApiStore = {
    isDemo: false,
    projects: {
      list: () => apiFetch('/projects'),
      pick: () => apiFetch('/projects/list'),
      get: (id) => apiFetch('/projects/' + id),
      create: (d) => apiFetch('/projects', { method: 'POST', body: d }),
      update: (id, d) => apiFetch('/projects/' + id, { method: 'PUT', body: d }),
      remove: (id) => apiFetch('/projects/' + id, { method: 'DELETE' }),
      bulkStages: (id, stages) => apiFetch('/projects/' + id + '/stages/bulk', { method: 'POST', body: { stages } }),
      import: (id, rows) => apiFetch('/projects/' + id + '/import', { method: 'POST', body: { rows } }),
    },
    stages: {
      create: (d) => apiFetch('/stages', { method: 'POST', body: d }),
      update: (id, d) => apiFetch('/stages/' + id, { method: 'PUT', body: d }),
      remove: (id) => apiFetch('/stages/' + id, { method: 'DELETE' }),
    },
    subs: {
      list: () => apiFetch('/subcontractors'),
      create: (d) => apiFetch('/subcontractors', { method: 'POST', body: d }),
      update: (id, d) => apiFetch('/subcontractors/' + id, { method: 'PUT', body: d }),
      remove: (id) => apiFetch('/subcontractors/' + id, { method: 'DELETE' }),
    },
    tx: {
      list: (f) => apiFetch('/transactions' + qs(f)),
      create: (d) => apiFetch('/transactions', { method: 'POST', body: d }),
      update: (id, d) => apiFetch('/transactions/' + id, { method: 'PUT', body: d }),
      remove: (id) => apiFetch('/transactions/' + id, { method: 'DELETE' }),
      bulkRemove: (ids) => apiFetch('/transactions/bulk-delete', { method: 'POST', body: { ids } }),
      categories: () => apiFetch('/transactions/categories'),
      bulkExpenses: (type, rows) => apiFetch('/transactions/bulk-expenses', { method: 'POST', body: { type, rows } }),
    },
    home: {
      list: (f) => apiFetch('/home/transactions' + qs(f)),
      create: (d) => apiFetch('/home/transactions', { method: 'POST', body: d }),
      update: (id, d) => apiFetch('/home/transactions/' + id, { method: 'PUT', body: d }),
      remove: (id) => apiFetch('/home/transactions/' + id, { method: 'DELETE' }),
      import: (rows) => apiFetch('/home/import', { method: 'POST', body: { rows } }),
      rules: () => apiFetch('/home/rules'),
      categories: () => apiFetch('/home/categories'),
    },
    reports: {
      overview: () => apiFetch('/reports/overview'),
      project: (id) => apiFetch('/reports/project/' + id),
      monthly: (f) => apiFetch('/reports/monthly' + qs(f)),
      home: (f) => apiFetch('/reports/home' + qs(f)),
    },
    uploads: {
      invoice: (file) => { const fd = new FormData(); fd.append('file', file); return apiFetch('/uploads/invoice', { method: 'POST', body: fd }); },
      status: () => apiFetch('/uploads/status'),
    },
    recycle: {
      list: () => apiFetch('/recycle'),
      restore: (table, id) => apiFetch('/recycle/restore', { method: 'POST', body: { table, id } }),
    },
    users: {
      list: () => apiFetch('/users'),
      roles: () => apiFetch('/users/roles'),
      create: (d) => apiFetch('/users', { method: 'POST', body: d }),
      update: (id, d) => apiFetch('/users/' + id, { method: 'PUT', body: d }),
      remove: (id) => apiFetch('/users/' + id, { method: 'DELETE' }),
      link: (id) => apiFetch('/users/' + id + '/link', { method: 'POST' }),
    },
  };
  function qs(f) {
    if (!f) return '';
    const p = Object.entries(f).filter(([, v]) => v !== undefined && v !== null && v !== '');
    return p.length ? '?' + p.map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&') : '';
  }

  // =====================================================================
  //  DEMO STORE (in-memory)
  // =====================================================================
  let _id = 1000;
  const nid = () => ++_id;
  const DEFAULT_EXPENSE_CATS = ['חומרים', 'כלים', 'שכר עבודה', 'השכרת ציוד', 'הובלה', 'דלק', 'אגרות ורשויות', 'ביטוח', 'משרד', 'אחר'];
  const D = { subs: [], projects: [], stages: [], tx: [], home: [], homeRules: [], users: [], expenseCats: [] };

  function seedDemo() {
    _id = 1000;
    D.subs = [
      { id: nid(), name: 'אבי שרברב', trade: 'אינסטלציה', phone: '050-1111111', email: '', tax_id: '', notes: '', deleted: false },
      { id: nid(), name: 'משה חשמלאי', trade: 'חשמל', phone: '050-2222222', email: '', tax_id: '', notes: '', deleted: false },
      { id: nid(), name: 'יוסי רצף', trade: 'ריצוף', phone: '050-3333333', email: '', tax_id: '', notes: '', deleted: false },
      { id: nid(), name: 'דוד צבעי', trade: 'צבע וגמר', phone: '050-4444444', email: '', tax_id: '', notes: '', deleted: false },
    ];
    const sPlumb = D.subs[0].id, sTile = D.subs[2].id, sPaint = D.subs[3].id;

    const p1 = { id: nid(), name: 'שיפוץ דירה - הרצל 5', client_name: 'ישראל כהן', client_phone: '052-9999999', address: 'הרצל 5, בני ברק', status: 'active', expected_profit: 40000, subcontractor_id: sPlumb, start_date: '2026-06-01', notes: '', deleted: false };
    const p2 = { id: nid(), name: 'בניית פרגולה - וילה שוהם', client_name: 'רונן לוי', client_phone: '054-8888888', address: 'שוהם', status: 'active', expected_profit: 12000, subcontractor_id: sTile, start_date: '2026-06-20', notes: '', deleted: false };
    D.projects = [p1, p2];

    const st = (pid, name, seq, ca, sa, sub) => ({ id: nid(), project_id: pid, name, seq, client_amount: ca, sub_amount: sa, subcontractor_id: sub, status: 'pending', approved: false, deleted: false });
    D.stages = [
      st(p1.id, 'הריסה + אינסטלציה', 1, 30000, 18000, sPlumb),
      st(p1.id, 'ריצוף', 2, 40000, 25000, sPlumb),
      st(p1.id, 'גמר + צבע', 3, 30000, 15000, sPlumb),
      st(p2.id, 'יסודות', 1, 8000, 4000, sTile),
      st(p2.id, 'הרכבה', 2, 12000, 6000, sTile),
    ];
    const stg = D.stages;

    const tx = (o) => Object.assign({ id: nid(), direction: 'out', amount: 0, date: null, project_id: null, stage_id: null, subcontractor_id: null, supplier: '', purpose: '', method: '', invoice_url: '', note: '', deleted: false }, o);
    D.tx = [
      tx({ type: 'client_payment', direction: 'in', amount: 15000, date: '2026-06-05', project_id: p1.id, stage_id: stg[0].id }),
      tx({ type: 'sub_payment', direction: 'out', amount: 9000, date: '2026-06-10', project_id: p1.id, stage_id: stg[0].id, subcontractor_id: sPlumb }),
      tx({ type: 'project_expense', direction: 'out', amount: 2000, date: '2026-06-08', project_id: p1.id, supplier: 'טמבור', purpose: 'כלי עבודה לפרויקט' }),
      tx({ type: 'business_expense', direction: 'out', amount: 10000, date: '2026-06-30', supplier: '—', purpose: 'משכורת עובד' }),
    ];
    D.home = [
      // מאי 2026
      { id: nid(), date: '2026-05-01', direction: 'in',  amount: 14000, category: 'משכורת', payee: 'מקום עבודה', source: 'transfer', note: '', deleted: false },
      { id: nid(), date: '2026-05-02', direction: 'out', amount: 4200,  category: 'שכר דירה', payee: 'בעל הבית', source: 'transfer', note: '', deleted: false },
      { id: nid(), date: '2026-05-05', direction: 'out', amount: 1650,  category: 'מזון', payee: 'סופר', source: 'credit', note: '', deleted: false },
      { id: nid(), date: '2026-05-09', direction: 'out', amount: 320,   category: 'חשמל', payee: 'חברת חשמל', source: 'bank', note: '', deleted: false },
      { id: nid(), date: '2026-05-14', direction: 'out', amount: 540,   category: 'דלק', payee: 'פז', source: 'credit', note: '', deleted: false },
      { id: nid(), date: '2026-05-20', direction: 'out', amount: 900,   category: 'חינוך', payee: 'גן', source: 'transfer', note: '', deleted: false },
      { id: nid(), date: '2026-05-27', direction: 'out', amount: 380,   category: 'בריאות', payee: 'קופת חולים', source: 'credit', note: '', deleted: false },
      // יוני 2026
      { id: nid(), date: '2026-06-01', direction: 'in',  amount: 14000, category: 'משכורת', payee: 'מקום עבודה', source: 'transfer', note: '', deleted: false },
      { id: nid(), date: '2026-06-02', direction: 'out', amount: 4200,  category: 'שכר דירה', payee: 'בעל הבית', source: 'transfer', note: '', deleted: false },
      { id: nid(), date: '2026-06-03', direction: 'out', amount: 1980,  category: 'מזון', payee: 'סופר', source: 'credit', note: '', deleted: false },
      { id: nid(), date: '2026-06-07', direction: 'out', amount: 410,   category: 'חשמל', payee: 'חברת חשמל', source: 'bank', note: '', deleted: false },
      { id: nid(), date: '2026-06-12', direction: 'out', amount: 620,   category: 'דלק', payee: 'פז', source: 'credit', note: '', deleted: false },
      { id: nid(), date: '2026-06-18', direction: 'out', amount: 900,   category: 'חינוך', payee: 'גן', source: 'transfer', note: '', deleted: false },
      { id: nid(), date: '2026-06-22', direction: 'out', amount: 1250,  category: 'פנאי', payee: 'מסעדה + בילוי', source: 'credit', note: '', deleted: false },
      // יולי 2026
      { id: nid(), date: '2026-07-01', direction: 'in',  amount: 14000, category: 'משכורת', payee: 'מקום עבודה', source: 'transfer', note: '', deleted: false },
      { id: nid(), date: '2026-07-02', direction: 'out', amount: 4200,  category: 'שכר דירה', payee: 'בעל הבית', source: 'transfer', note: '', deleted: false },
      { id: nid(), date: '2026-07-05', direction: 'out', amount: 1720,  category: 'מזון', payee: 'סופר', source: 'credit', note: '', deleted: false },
      { id: nid(), date: '2026-07-08', direction: 'out', amount: 360,   category: 'חשמל', payee: 'חברת חשמל', source: 'bank', note: '', deleted: false },
      { id: nid(), date: '2026-07-11', direction: 'out', amount: 480,   category: 'דלק', payee: 'פז', source: 'credit', note: '', deleted: false },
    ];
    D.homeRules = [];
    D.expenseCats = [];
  }

  // -- computation helpers (mirror server) --
  const A = (arr) => arr.filter(x => !x.deleted);
  const sum = (arr) => arr.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0);
  const numify = (v) => (v === '' || v == null) ? null : (Number(v) || null); // מזהים מגיעים כמחרוזת מ-select
  const learnCat = (c) => { c = String(c || '').trim(); if (c && !DEFAULT_EXPENSE_CATS.includes(c) && !D.expenseCats.includes(c)) D.expenseCats.push(c); };

  function projSummary(p) {
    const txs = A(D.tx).filter(t => t.project_id === p.id);
    const stgs = A(D.stages).filter(s => s.project_id === p.id);
    const income = sum(txs.filter(t => t.type === 'client_payment'));
    const sub_paid = sum(txs.filter(t => t.type === 'sub_payment'));
    const project_expenses = sum(txs.filter(t => t.type === 'project_expense'));
    const planned_income = stgs.reduce((s, x) => s + (+x.client_amount || 0), 0);
    const planned_sub = stgs.reduce((s, x) => s + (+x.sub_amount || 0), 0);
    const expected_profit = +p.expected_profit || 0;
    const actual_profit = income - sub_paid - project_expenses;
    return Object.assign({}, p, {
      income, sub_paid, project_expenses, planned_income, planned_sub, expected_profit,
      actual_profit, profit_gap: actual_profit - expected_profit, planned_profit: planned_income - planned_sub,
      subcontractor_name: subName(p.subcontractor_id)
    });
  }
  const subName = (id) => { const s = D.subs.find(x => x.id === id); return (s && !s.deleted) ? s.name : null; };
  const projName = (id) => { const s = D.projects.find(x => x.id === id); return (s && !s.deleted) ? s.name : null; };
  const stageName = (id) => { const s = D.stages.find(x => x.id === id); return (s && !s.deleted) ? s.name : null; };

  function stageWithPaid(s) {
    const txs = A(D.tx).filter(t => t.stage_id === s.id);
    return Object.assign({}, s, {
      subcontractor_name: subName(s.subcontractor_id),
      paid_in: sum(txs.filter(t => t.type === 'client_payment')),
      paid_sub: sum(txs.filter(t => t.type === 'sub_payment')),
    });
  }
  function inRange(d, f, t) { if (!d) return false; if (f && d < f) return false; if (t && d > t) return false; return true; }
  const delay = (v) => new Promise(r => setTimeout(() => r(v), 60)); // תחושת רשת קלה

  // חסימת חריגה מסכום השלב (תשלום לקוח/קבלן) - מקביל לשרת
  function txCapError(type, stageId, amount, excludeId) {
    if (type !== 'client_payment' && type !== 'sub_payment') return null;
    if (!stageId) return null;
    const st = D.stages.find(s => s.id === stageId && !s.deleted); if (!st) return null;
    const cap = +(type === 'client_payment' ? st.client_amount : st.sub_amount) || 0;
    const paid = A(D.tx).filter(t => t.stage_id === stageId && t.type === type && t.id !== excludeId).reduce((s, t) => s + (+t.amount || 0), 0);
    const remaining = cap - paid;
    if (amount > remaining + 0.001) {
      const rem = Math.max(0, Math.round(remaining)).toLocaleString('he-IL');
      return type === 'client_payment'
        ? `הסכום חורג מסכום השלב מול הלקוח. נותר לגבייה בשלב: ${rem} ₪`
        : `הסכום חורג מסכום השלב לקבלן המשנה. נותר לתשלום בשלב: ${rem} ₪`;
    }
    return null;
  }

  const DemoStore = {
    isDemo: true,
    projects: {
      list: () => delay(A(D.projects).map(projSummary).sort((a, b) => b.id - a.id)),
      pick: () => delay(A(D.projects).filter(p => p.status !== 'done').map(p => ({ id: p.id, name: p.name, client_name: p.client_name }))),
      get: (id) => { id = +id; const p = A(D.projects).find(x => x.id === id); if (!p) throw new Error('לא נמצא'); return delay({ project: projSummary(p), stages: A(D.stages).filter(s => s.project_id === id).sort((a, b) => a.seq - b.seq).map(stageWithPaid) }); },
      create: (d) => { const p = Object.assign({ id: nid(), status: 'active', expected_profit: 0, deleted: false }, d); p.expected_profit = +p.expected_profit || 0; p.subcontractor_id = numify(d.subcontractor_id); D.projects.push(p); return delay(projSummary(p)); },
      update: (id, d) => { id = +id; const p = D.projects.find(x => x.id === id); Object.assign(p, d); p.expected_profit = +p.expected_profit || 0; p.subcontractor_id = numify(d.subcontractor_id); A(D.stages).filter(s => s.project_id === id).forEach(s => s.subcontractor_id = p.subcontractor_id); return delay(projSummary(p)); },
      remove: (id) => { id = +id; const p = D.projects.find(x => x.id === id); if (p && !p.deleted) { p.deleted = true; A(D.stages).filter(s => s.project_id === id).forEach(s => { s.deleted = true; s._cascadeOf = id; }); A(D.tx).filter(t => t.project_id === id).forEach(t => { t.deleted = true; t._cascadeOf = id; }); } return delay({ ok: true }); },
      bulkStages: (id, stages) => {
        id = +id;
        const proj = D.projects.find(p => p.id === id);
        const projSub = proj ? (proj.subcontractor_id || null) : null;   // קבלן המשנה של הפרויקט
        let seq = Math.max(0, ...A(D.stages).filter(s => s.project_id === id).map(s => s.seq));
        const out = [];
        stages.forEach(st => {
          if (!st.name) return;
          const s = { id: nid(), project_id: id, name: st.name, seq: ++seq, client_amount: +st.client_amount || 0, sub_amount: +st.sub_amount || 0, subcontractor_id: projSub, status: 'pending', approved: false, deleted: false };
          D.stages.push(s); out.push(s);
        });
        return delay(out);
      },
      import: (id, rows) => {
        id = +id;
        const proj = D.projects.find(p => p.id === id);
        const projSub = proj ? (proj.subcontractor_id || null) : null;
        let seq = Math.max(0, ...A(D.stages).filter(s => s.project_id === id).map(s => s.seq));
        const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[₪,\s]/g, '')); return isNaN(n) ? 0 : n; };
        let ns = 0, np = 0;
        rows.forEach(row => {
          if (!row || !row.name || !String(row.name).trim()) return;
          const ca = num(row.client_amount), sa = num(row.sub_amount), cp = num(row.client_paid), sp = num(row.sub_paid);
          const stage = { id: nid(), project_id: id, name: String(row.name).trim(), seq: ++seq, client_amount: ca, sub_amount: sa, subcontractor_id: projSub, status: 'pending', approved: false, deleted: false };
          D.stages.push(stage); ns++;
          if (cp > 0) { D.tx.push({ id: nid(), type: 'client_payment', direction: 'in', amount: cp, date: null, project_id: id, stage_id: stage.id, subcontractor_id: null, supplier: '', purpose: '', method: '', invoice_url: '', note: 'ייבוא מצב פתיחה', deleted: false }); np++; }
          if (sp > 0) { D.tx.push({ id: nid(), type: 'sub_payment', direction: 'out', amount: sp, date: null, project_id: id, stage_id: stage.id, subcontractor_id: projSub, supplier: '', purpose: '', method: '', invoice_url: '', note: 'ייבוא מצב פתיחה', deleted: false }); np++; }
        });
        return delay({ stages: ns, payments: np });
      },
    },
    stages: {
      create: (d) => { const s = Object.assign({ id: nid(), seq: 0, client_amount: 0, sub_amount: 0, status: 'pending', approved: false, deleted: false }, d); s.project_id = +s.project_id; s.subcontractor_id = numify(d.subcontractor_id); s.client_amount = +s.client_amount || 0; s.sub_amount = +s.sub_amount || 0; D.stages.push(s); return delay(s); },
      update: (id, d) => { id = +id; const s = D.stages.find(x => x.id === id); Object.assign(s, d, { subcontractor_id: numify(d.subcontractor_id), client_amount: +d.client_amount || 0, sub_amount: +d.sub_amount || 0 }); return delay(s); },
      remove: (id) => { id = +id; const s = D.stages.find(x => x.id === id); if (s) s.deleted = true; return delay({ ok: true }); },
    },
    subs: {
      list: () => delay(A(D.subs).slice().sort((a, b) => a.name.localeCompare(b.name, 'he'))),
      create: (d) => { const s = Object.assign({ id: nid(), deleted: false }, d); D.subs.push(s); return delay(s); },
      update: (id, d) => { id = +id; const s = D.subs.find(x => x.id === id); Object.assign(s, d); return delay(s); },
      remove: (id) => { id = +id; const s = D.subs.find(x => x.id === id); if (s) s.deleted = true; return delay({ ok: true }); },
    },
    tx: {
      list: (f) => {
        f = f || {}; let rows = A(D.tx);
        if (f.project_id) rows = rows.filter(t => t.project_id === +f.project_id);
        if (f.stage_id) rows = rows.filter(t => t.stage_id === +f.stage_id);
        if (f.type) rows = rows.filter(t => t.type === f.type);
        if (f.from) rows = rows.filter(t => t.date && t.date >= f.from);
        if (f.to) rows = rows.filter(t => t.date && t.date <= f.to);
        rows = rows.map(t => Object.assign({}, t, { project_name: projName(t.project_id), stage_name: stageName(t.stage_id), subcontractor_name: subName(t.subcontractor_id) }));
        rows.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id);
        return delay(rows);
      },
      create: (d) => { const sid = numify(d.stage_id); const capErr = txCapError(d.type, sid, +d.amount || 0, null); if (capErr) return Promise.reject(new Error(capErr)); learnCat(d.category); const dir = d.type === 'client_payment' ? 'in' : 'out'; const t = Object.assign({ id: nid(), deleted: false }, d, { direction: dir, amount: +d.amount || 0, project_id: numify(d.project_id), stage_id: sid, subcontractor_id: numify(d.subcontractor_id) }); D.tx.push(t); return delay(t); },
      update: (id, d) => { id = +id; const sid = numify(d.stage_id); const capErr = txCapError(d.type, sid, +d.amount || 0, id); if (capErr) return Promise.reject(new Error(capErr)); learnCat(d.category); const t = D.tx.find(x => x.id === id); Object.assign(t, d, { amount: +d.amount || 0, project_id: numify(d.project_id), stage_id: sid, subcontractor_id: numify(d.subcontractor_id) }); return delay(t); },
      remove: (id) => { id = +id; const t = D.tx.find(x => x.id === id); if (t) t.deleted = true; return delay({ ok: true }); },
      bulkRemove: (ids) => { let n = 0; ids.forEach(id => { const t = D.tx.find(x => x.id === +id); if (t && !t.deleted) { t.deleted = true; n++; } }); return delay({ count: n }); },
      categories: () => delay([...new Set([...DEFAULT_EXPENSE_CATS, ...D.expenseCats, ...A(D.tx).map(t => t.category).filter(Boolean)])]),
      bulkExpenses: (type, rows) => {
        let n = 0;
        rows.forEach(row => {
          const amt = +row.amount || 0;
          if (!(amt > 0)) return;
          if (type === 'project_expense' && !row.project_id) return;
          learnCat(row.category);
          D.tx.push({ id: nid(), type, direction: 'out', amount: amt, date: row.date || null, project_id: type === 'project_expense' ? numify(row.project_id) : null, stage_id: null, subcontractor_id: null, supplier: row.supplier || '', category: row.category || '', purpose: row.purpose || '', method: '', invoice_url: '', note: '', deleted: false });
          n++;
        });
        return delay({ count: n });
      },
    },
    home: {
      list: (f) => { f = f || {}; let rows = A(D.home); if (f.from) rows = rows.filter(r => r.date && r.date >= f.from); if (f.to) rows = rows.filter(r => r.date && r.date <= f.to); rows.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id); return delay(rows); },
      create: (d) => { const r = Object.assign({ id: nid(), direction: 'out', source: 'form', deleted: false }, d, { amount: +d.amount || 0 }); D.home.push(r); if (r.category && r.payee) learn(r.payee, r.category); return delay(r); },
      update: (id, d) => { id = +id; const r = D.home.find(x => x.id === id); Object.assign(r, d, { amount: +d.amount || 0 }); if (r.category && r.payee) learn(r.payee, r.category); return delay(r); },
      remove: (id) => { id = +id; const r = D.home.find(x => x.id === id); if (r) r.deleted = true; return delay({ ok: true }); },
      import: (rows) => { let n = 0; rows.forEach(row => { if (!(+row.amount > 0)) return; D.home.push(Object.assign({ id: nid(), direction: 'out', source: 'bank', deleted: false }, row, { amount: +row.amount })); if (row.category && row.payee) learn(row.payee, row.category); n++; }); return delay({ count: n }); },
      rules: () => delay(D.homeRules.slice().sort((a, b) => b.match_text.length - a.match_text.length)),
      categories: () => delay([...new Set(A(D.home).map(r => r.category).filter(Boolean))].sort()),
    },
    reports: {
      overview: () => {
        const rows = A(D.projects).map(projSummary);
        let te = 0, ta = 0, ti = 0, to = 0, active = 0, tpi = 0, tsp = 0, tps = 0, tos = 0;
        rows.forEach(p => {
          te += p.expected_profit; ta += p.actual_profit; ti += p.income; to += Math.max(0, p.planned_income - p.income);
          tpi += p.planned_income; tsp += p.sub_paid; tps += p.planned_sub; tos += Math.max(0, p.planned_sub - p.sub_paid);
          if (p.status === 'active') active++;
        });
        const biz = sum(A(D.tx).filter(t => t.type === 'business_expense'));
        return delay({
          projects_total: rows.length, projects_active: active,
          total_expected_profit: te, total_actual_profit: ta, total_income: ti, total_open_client: to,
          total_planned_income: tpi, total_sub_paid: tsp, total_planned_sub: tps, total_open_sub: tos, future_profit: to - tos,
          total_business_expenses: biz, net_business: ta - biz,
          per_project: rows.map(p => ({ id: p.id, name: p.name, status: p.status, planned_income: p.planned_income, income: p.income, planned_sub: p.planned_sub, sub_paid: p.sub_paid, project_expenses: p.project_expenses, expected_profit: p.expected_profit, actual_profit: p.actual_profit, profit_gap: p.profit_gap }))
        });
      },
      project: (id) => {
        id = +id; const p = A(D.projects).find(x => x.id === id); if (!p) throw new Error('לא נמצא');
        const s = projSummary(p);
        const stages = A(D.stages).filter(x => x.project_id === id).sort((a, b) => a.seq - b.seq).map(stageWithPaid);
        const pe = A(D.tx).filter(t => t.project_id === id && t.type === 'project_expense');
        return delay({
          project: p, stages,
          totals: { income: s.income, sub_paid: s.sub_paid, project_expenses: s.project_expenses, expected_profit: s.expected_profit, actual_profit: s.actual_profit, profit_gap: s.profit_gap, planned_income: s.planned_income, planned_sub: s.planned_sub },
          project_expenses: pe
        });
      },
      monthly: (f) => {
        f = f || {}; const rows = A(D.tx).filter(t => (!f.from || (t.date && t.date >= f.from)) && (!f.to || (t.date && t.date <= f.to)));
        const S = (ty) => sum(rows.filter(t => t.type === ty));
        const t = { income: S('client_payment'), sub_paid: S('sub_payment'), project_expenses: S('project_expense'), business_expenses: S('business_expense') };
        t.net = t.income - t.sub_paid - t.project_expenses - t.business_expenses;
        const byMonthMap = {};
        rows.filter(r => r.date).forEach(r => { const m = r.date.slice(0, 7); byMonthMap[m] = byMonthMap[m] || { month: m, income: 0, expenses: 0 }; if (r.type === 'client_payment') byMonthMap[m].income += +r.amount; else byMonthMap[m].expenses += +r.amount; });
        const byProjMap = {};
        rows.filter(r => r.project_id).forEach(r => { const nm = projName(r.project_id) || '—'; byProjMap[nm] = byProjMap[nm] || { project_name: nm, income: 0, cost: 0 }; if (r.type === 'client_payment') byProjMap[nm].income += +r.amount; else if (r.type === 'sub_payment' || r.type === 'project_expense') byProjMap[nm].cost += +r.amount; });
        return delay({ totals: t, by_month: Object.values(byMonthMap).sort((a, b) => a.month.localeCompare(b.month)), by_project: Object.values(byProjMap).sort((a, b) => b.income - a.income), business_expenses: rows.filter(r => r.type === 'business_expense') });
      },
      home: (f) => {
        f = f || {}; const rows = A(D.home).filter(r => (!f.from || (r.date && r.date >= f.from)) && (!f.to || (r.date && r.date <= f.to)));
        const income = sum(rows.filter(r => r.direction === 'in')), expenses = sum(rows.filter(r => r.direction === 'out'));
        const catMap = {}; rows.filter(r => r.direction === 'out').forEach(r => { const c = r.category || 'ללא קטגוריה'; catMap[c] = (catMap[c] || 0) + (+r.amount || 0); });
        const monMap = {}; rows.filter(r => r.date).forEach(r => { const m = r.date.slice(0, 7); monMap[m] = monMap[m] || { month: m, income: 0, expenses: 0 }; monMap[m][r.direction === 'in' ? 'income' : 'expenses'] += +r.amount; });
        return delay({ totals: { income, expenses, balance: income - expenses }, by_category: Object.entries(catMap).map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total), by_month: Object.values(monMap).sort((a, b) => a.month.localeCompare(b.month)) });
      },
    },
    uploads: {
      invoice: (file) => delay({ url: '#demo-' + encodeURIComponent(file.name), storage: 'demo' }),
      status: () => delay({ drive: false }),
    },
    recycle: {
      list: () => {
        const out = [];
        const push = (table, label, arr, title, subtitle) => arr.filter(x => x.deleted).forEach(x => out.push({ _table: table, _label: label, id: x.id, title: title(x), subtitle: subtitle(x), amount: x.amount || null }));
        push('subcontractors', 'קבלני משנה', D.subs, x => x.name, x => x.trade || '');
        push('projects', 'פרויקטים', D.projects, x => x.name, x => x.client_name || '');
        push('stages', 'שלבים', D.stages, x => x.name, () => '');
        push('transactions', 'תנועות כספיות', D.tx, x => x.purpose || x.type, x => x.type);
        push('home_transactions', 'הוצאות בית', D.home, x => x.payee || 'הוצאה', x => x.category || '');
        return delay(out);
      },
      restore: (table, id) => {
        const map = { subcontractors: D.subs, projects: D.projects, stages: D.stages, transactions: D.tx, home_transactions: D.home };
        const pid = +id; const r = (map[table] || []).find(x => x.id === pid);
        if (r) {
          r.deleted = false;
          if (table === 'projects') { // שחזור מדביק: מחזיר את מה שנמחק יחד עם הפרויקט
            D.stages.forEach(s => { if (s._cascadeOf === pid) { s.deleted = false; delete s._cascadeOf; } });
            D.tx.forEach(t => { if (t._cascadeOf === pid) { t.deleted = false; delete t._cascadeOf; } });
          }
        }
        return delay({ ok: true });
      },
    },
    users: {
      list: () => delay(D.users.length ? D.users : [{ id: 1, username: 'admin', role: 'admin', full_name: 'מנהל (הדגמה)', active: true }]),
      roles: () => delay([['admin', 'מנהל ראשי'], ['secretary', 'מזכירה'], ['owner', 'מנהל'], ['reporter', 'מדווח'], ['field', 'עובד שטח'], ['home', 'בית']].map(([key, label]) => ({ key, label }))),
      create: (d) => { const u = Object.assign({ id: nid(), active: true }, d); D.users.push(u); return delay(u); },
      update: (id, d) => { const u = D.users.find(x => x.id === +id) || {}; Object.assign(u, d); return delay(u); },
      remove: (id) => { const u = D.users.find(x => x.id === +id); if (u) u.active = false; return delay({ ok: true }); },
      link: (id) => delay({ token: 'demo-link-token-' + id }),
    },
  };
  function learn(payee, category) {
    const key = (payee || '').trim(); if (!key || !category) return;
    const ex = D.homeRules.find(r => r.match_text === key);
    if (ex) ex.category = category; else D.homeRules.push({ match_text: key, category });
  }

  // =====================================================================
  //  AUTH
  // =====================================================================
  const ADMIN_CAPS = { manageUsers: true, viewBusiness: true, editProjects: true, writeTx: true, projectExpenseOnly: true, del: true, multiDelete: true, viewReports: true, home: true };
  window.Auth = {
    user: null,
    async login(username, password) {
      const d = await apiFetch('/auth/login', { method: 'POST', body: { username, password } });
      setToken(d.token);
      this.user = d.user;
      window.Store = ApiStore;
      sessionStorage.setItem('cc_user', JSON.stringify(d.user));
      return d.user;
    },
    demo() {
      seedDemo();
      this.user = { id: 1, username: 'demo', role: 'admin', full_name: 'מנהל (הדגמה)', caps: ADMIN_CAPS };
      window.Store = DemoStore;
      return this.user;
    },
    async restore() {
      if (window.__demo) return null;
      if (!token()) return null;
      const cached = sessionStorage.getItem('cc_user');
      try {
        const d = await apiFetch('/auth/me');
        this.user = d.user; window.Store = ApiStore; return d.user;
      } catch (e) {
        if (cached) { try { this.user = JSON.parse(cached); window.Store = ApiStore; return this.user; } catch (_) {} }
        return null;
      }
    },
    logout() { setToken(''); sessionStorage.removeItem('cc_user'); localStorage.removeItem('cc_link'); this.user = null; window.Store = null; },
    caps() { return (this.user && this.user.caps) || {}; },
  };
})();
