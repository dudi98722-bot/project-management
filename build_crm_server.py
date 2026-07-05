# -*- coding: utf-8 -*-
"""
Build the API-connected CRM frontend (served from the VPS).
Produces: crm-backend/public/index.html
- Keeps TABLE1/TABLE2 static reference data (from xlsx)
- contacts/vows/payments load live from the REST API
- login authenticates against /api/auth/login (JWT)
- writes (add/edit/delete) go to the REST API
"""
import json, sys, io, re, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
import pandas as pd

BASE = 'C:/Users/בונים ומוגנים/OneDrive/שולחן העבודה/קלוד'

# --- Static reference tables (forA / forB dropdowns) ---
df = pd.read_excel('C:/Users/בונים ומוגנים/OneDrive/מסמכים/חוברת1.xlsx', header=None, sheet_name=0)
table1 = [str(v).strip() for v in df.iloc[1:, 2] if str(v).strip() not in ['nan','NaN','']]
table2 = [str(v).strip() for v in df.iloc[1:, 6] if str(v).strip() not in ['nan','NaN','']]

template = open(BASE + '/crm_template.html', 'r', encoding='utf-8').read()

# 1) Data placeholders: empty at parse time, loaded from API at runtime
template = template.replace('/*USERS_DATA*/', '')
template = template.replace('/*CONTACTS_DATA*/', 'var CONTACTS_DATA = [];')
template = template.replace('/*TABLE1_DATA*/', 'const TABLE1 = ' + json.dumps(table1, ensure_ascii=False) + ';')
template = template.replace('/*TABLE2_DATA*/', 'const TABLE2 = ' + json.dumps(table2, ensure_ascii=False) + ';')
template = template.replace('/*VOWS_DATA*/', 'var VOWS_DATA = [];')
template = template.replace('/*PAYMENTS_DATA*/', 'var PAYMENTS_DATA = [];')

# 2) Replace the login IIFE (the first (function(){ ... })(); that contains ADMIN)
login_re = re.compile(r"\(function\(\)\{\s*var ADMIN=.*?\}\)\(\);", re.S)
NEW_LOGIN = r"""(function(){
  var API = location.origin + '/api';
  window.API = API;
  function token(){ return sessionStorage.getItem('crm_token') || ''; }
  window.apiToken = token;
  window.apiFetch = function(path, opts){
    opts = opts || {};
    opts.headers = opts.headers || {};
    if(token()) opts.headers['Authorization'] = 'Bearer ' + token();
    if(opts.body && typeof opts.body !== 'string'){ opts.headers['Content-Type']='application/json'; opts.body = JSON.stringify(opts.body); }
    return fetch(API + path, opts).then(function(r){
      // token expired/invalid -> back to login (instead of silently showing empty data)
      if(r.status===401 && sessionStorage.getItem('crm_token')){
        ['crm_token','crm_auth','crm_user','crm_role'].forEach(function(k){sessionStorage.removeItem(k);});
        alert('פג תוקף החיבור. יש להתחבר מחדש.');
        location.reload();
      }
      return r;
    });
  };
  // user-management UI -> API
  window._apiUsers = [];
  window.getUsers = function(){ return window._apiUsers || []; };
  window.loadUsersApi = function(cb){
    window.apiFetch('/users').then(function(r){return r.json();}).then(function(d){
      window._apiUsers = Array.isArray(d) ? d : []; if(cb)cb(window._apiUsers);
    }).catch(function(){ if(cb)cb([]); });
  };
  window.saveUsers = function(){ /* handled per-action via API */ };
  window.hashCreds = function(){ return Promise.resolve(''); };

  window.doLogout = function(){
    ['crm_token','crm_auth','crm_user','crm_role'].forEach(function(k){sessionStorage.removeItem(k);});
    location.reload();
  };
  window.doLogin = function(){
    var eu = document.getElementById('loginUser').value.trim();
    var ep = document.getElementById('loginPass').value;
    var err = document.getElementById('loginError2');
    err.textContent='מאמת...'; err.style.color='#999'; err.style.display='block';
    fetch(API + '/auth/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:eu, password:ep})})
      .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, d:d}; }); })
      .then(function(res){
        if(!res.ok){ err.textContent = res.d.error || 'שם משתמש או סיסמא שגויים'; err.style.color=''; document.getElementById('loginPass').value=''; return; }
        sessionStorage.setItem('crm_token', res.d.token);
        sessionStorage.setItem('crm_auth','1');
        sessionStorage.setItem('crm_user', res.d.user.username);
        sessionStorage.setItem('crm_role', res.d.user.role);
        err.style.display='none';
        document.getElementById('loginScreen').style.display='none';
        window.bootstrapData();
      })
      .catch(function(){ err.textContent='שגיאת חיבור לשרת'; err.style.color=''; });
  };
})();"""
template, n = login_re.subn(lambda m: NEW_LOGIN, template, count=1)
assert n == 1, 'login IIFE not replaced (n=%d)' % n

# 3) Replace the final init(); call with a guarded bootstrap that loads data first
ADAPTER = r"""
/* ===== API ADAPTER (data load + write sync) ===== */
function _vowFromApi(v){ return {id:v.id, date:v.date?String(v.date).slice(0,10):'', hebrewDate:v.hebrew_date||'', name:v.name||'', forA:v.for_a||'', forB:v.for_b||'', amount:parseFloat(v.amount)||0, note:v.note||'', place:v.place||'', _user:v._user||''}; }
function _payFromApi(p){ return {id:p.id, date:p.date?String(p.date).slice(0,10):'', hebrewDate:p.hebrew_date||'', name:p.name||'', vowId:p.vow_id, amount:parseFloat(p.amount)||0, method:p.method||'', numPayments:p.num_payments||1, note:p.note||'', _user:p._user||''}; }

// Map frontend record -> API (snake_case) per type
function _toApi(type, data){
  if(type==='vow'){ return {id:data.id, date:data.date, hebrew_date:data.hebrewDate, name:data.name, for_a:data.forA, for_b:data.forB, amount:data.amount, note:data.note, place:data.place}; }
  if(type==='payment'){ return {id:data.id, date:data.date, hebrew_date:data.hebrewDate, name:data.name, vow_id:data.vowId, amount:data.amount, method:data.method, num_payments:data.numPayments, note:data.note}; }
  return data; // contact already snake_case
}
var _ENDPOINT = {contact:'/contacts', vow:'/vows', payment:'/payments'};

// Override sync: send writes to REST API
function syncToSheets(type, action, data){
  var ep = _ENDPOINT[type]; if(!ep) return;
  var body = _toApi(type, data);
  var opts;
  if(action==='delete'){ opts = {method:'DELETE'}; ep = ep + '/' + data.id; }
  else if(action==='edit'){ opts = {method:'PUT', body:body}; ep = ep + '/' + data.id; }
  else { opts = {method:'POST', body:body}; }
  window.apiFetch(ep, opts).then(function(r){
    if(!r.ok){ r.json().then(function(d){ console.warn('שמירה נכשלה:', d.error||r.status); }); }
  }).catch(function(){ console.warn('שגיאת רשת בשמירה'); });
}
function exportAllToSheets(){ /* disabled - data lives in DB */ }

// Load all data from API, then start the app
function bootstrapData(){
  var loader = document.getElementById('_bootLoader');
  if(loader) loader.style.display='flex';
  function getArr(path){ return window.apiFetch(path).then(function(r){ return r.ok ? r.json() : []; }).then(function(d){ return Array.isArray(d) ? d : []; }).catch(function(){ return []; }); }
  Promise.all([ getArr('/contacts/all'), getArr('/vows/all'), getArr('/payments/all') ]).then(function(res){
    var cts = res[0]||[], vws = res[1]||[], pys = res[2]||[];
    window.contacts = cts.map(function(c,i){ return Object.assign({}, c, {_idx:i}); });
    window.filtered = window.contacts.slice();
    window.cFiltered = window.contacts.slice();
    window.vows = vws.map(_vowFromApi);
    window.payments = pys.map(_payFromApi);
    if(window._apiUsers===undefined) window._apiUsers=[];
    window.loadUsersApi();
    // load saved payment methods from server
    window.apiFetch('/settings/methods').then(function(r){return r.ok?r.json():null;}).then(function(m){
      if(Array.isArray(m) && m.length){ window.paymentMethods = m; if(window.refreshPaymentMethodSelect) refreshPaymentMethodSelect(); }
    }).catch(function(){});
    if(loader) loader.style.display='none';
    init();
  }).catch(function(e){
    if(loader) loader.innerHTML = '<div style="color:#c00;font-size:18px">שגיאה בטעינת הנתונים מהשרת. רענן את הדף.</div>';
    console.error(e);
  });
}

// If already authenticated (refresh), bootstrap immediately; else wait for login
if(sessionStorage.getItem('crm_token')){
  document.getElementById('loginScreen').style.display='none';
  bootstrapData();
}
"""
# Replace trailing "init();" (the last standalone call) with the adapter
assert template.rstrip().endswith('init();\n</script>\n</body>\n</html>') or 'init();' in template
template = template.replace('\ninit();\n</script>', '\n' + ADAPTER + '\n</script>', 1)

# 4) Add a simple loading overlay right after <body>
LOADER = '<div id="_bootLoader" style="display:none;position:fixed;inset:0;background:#fff;z-index:9999;align-items:center;justify-content:center;flex-direction:column;gap:16px"><div style="font-size:22px;color:#1565c0">טוען נתונים...</div><div style="font-size:14px;color:#888">מוסדות אלכסנדר</div></div>'
template = re.sub(r'(<body[^>]*>)', r'\1\n' + LOADER, template, count=1)

out_dir = BASE + '/crm-backend/public'
os.makedirs(out_dir, exist_ok=True)
with open(out_dir + '/index.html', 'w', encoding='utf-8') as f:
    f.write(template)

print('Built server index.html | size:', len(template), '| TABLE1:', len(table1), 'TABLE2:', len(table2))
