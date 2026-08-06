/* שכבת נתונים — כל קריאות ה-API לשרת שטרנקוקר. */
(function () {
  'use strict';
  const API = location.origin + '/api';
  function token() { return sessionStorage.getItem('shter_token') || ''; }
  function setToken(t) { t ? sessionStorage.setItem('shter_token', t) : sessionStorage.removeItem('shter_token'); }

  async function apiFetch(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    if (token()) opts.headers['Authorization'] = 'Bearer ' + token();
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const r = await fetch(API + path, opts);
    if (r.status === 401 && token()) { setToken(''); location.reload(); throw new Error('פג תוקף'); }
    let data = null; try { data = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error((data && data.error) || ('שגיאה ' + r.status));
    return data;
  }

  function qs(f) {
    if (!f) return '';
    const p = Object.entries(f)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
    return p.length ? '?' + p.join('&') : '';
  }

  // מפעל CRUD ללקוח
  function res(base) {
    return {
      list: (f) => apiFetch(base + qs(f)),
      get: (id) => apiFetch(base + '/' + id),
      create: (d) => apiFetch(base, { method: 'POST', body: d }),
      update: (id, d) => apiFetch(base + '/' + id, { method: 'PUT', body: d }),
      remove: (id) => apiFetch(base + '/' + id, { method: 'DELETE' }),
    };
  }

  window.Store = {
    setToken, token,
    auth: {
      login: (username, password) => apiFetch('/auth/login', { method: 'POST', body: { username, password } }),
      me: () => apiFetch('/auth/me'),
    },
    // נתוני יסוד
    contacts: res('/contacts'),
    products: res('/products'),
    sizes: res('/parchment-sizes'),
    lists: {
      all: () => apiFetch('/lists'),
      one: (name) => apiFetch('/lists?name=' + encodeURIComponent(name)),
      create: (list_name, value, is_correction) => apiFetch('/lists', { method: 'POST', body: { list_name, value, is_correction } }),
      update: (id, d) => apiFetch('/lists/' + id, { method: 'PUT', body: d }),
      remove: (id) => apiFetch('/lists/' + id, { method: 'DELETE' }),
    },
    // מערכת ס"ת
    scrolls: res('/scrolls'),
    pagesLog: res('/pages-log'),
    scribePayments: res('/scribe-payments'),
    customerPayments: res('/customer-payments'),
    bookExpenses: res('/book-expenses'),
    parchmentExpenses: res('/parchment-expenses'),
    businessExpenses: res('/business-expenses'),
    // מערכת מוצרים
    prodPurchases: res('/prod/purchases'),
    prodScribePayments: res('/prod/scribe-payments'),
    prodSales: res('/prod/sales'),
    prodCustomerPayments: res('/prod/customer-payments'),
    // דוחות
    reports: {
      overview: () => apiFetch('/reports/overview'),
      profit: () => apiFetch('/reports/profit'),
      byScroll: () => apiFetch('/reports/by-scroll'),
      scribeBalances: () => apiFetch('/reports/scribe-balances'),
      customerBalances: () => apiFetch('/reports/customer-balances'),
      monthly: (year) => apiFetch('/reports/monthly?year=' + year),
      inventory: () => apiFetch('/reports/inventory'),
      scribe: (id) => apiFetch('/reports/scribe/' + id),
      customer: (id) => apiFetch('/reports/customer/' + id),
    },
    users: Object.assign(res('/users'), { roles: () => apiFetch('/users/roles') }),
    recycle: {
      summary: () => apiFetch('/recycle'),
      list: (table) => apiFetch('/recycle/' + table),
      restore: (table, id) => apiFetch('/recycle/' + table + '/' + id + '/restore', { method: 'POST' }),
    },
    import: {
      spec: () => apiFetch('/import/spec'),
      run: (table, rows, options, dryRun) => apiFetch('/import/' + table, { method: 'POST', body: { rows, options, dryRun } }),
    },
  };
})();
