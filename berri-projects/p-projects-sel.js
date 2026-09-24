/* BERRI — טבלת הפרוייקטים: סינון בראש כל עמודה, וסימון לעדכון מרוכז */
'use strict';

/* סינון לפי עמודה: טקסט = מכיל, תאריך = מ-עד, סכום/מספר = מינימום-מקסימום */
function projFstate() { return (S.filters._proj = S.filters._proj || {}); }
function projFilterCell(c) {
  var v = projFstate()[c.k] || {};
  var on = function (part) { return 'projSetFilt(\'' + c.k + '\',\'' + part + '\',this.value)'; };
  if (c.d) {
    return '<div class="f-pair"><input class="f-inp" type="date" title="מתאריך" value="' + esc(v.from || '') + '" onchange="' + on('from') + '">' +
      '<input class="f-inp" type="date" title="עד תאריך" value="' + esc(v.to || '') + '" onchange="' + on('to') + '"></div>';
  }
  if (c.m || c.n) {
    return '<div class="f-pair"><input class="f-inp" inputmode="decimal" placeholder="מ-" value="' + esc(v.min || '') + '" oninput="' + on('min') + '">' +
      '<input class="f-inp" inputmode="decimal" placeholder="עד" value="' + esc(v.max || '') + '" oninput="' + on('max') + '"></div>';
  }
  return '<input class="f-inp" type="search" placeholder="חיפוש…" value="' + esc(v.q || '') + '" oninput="' + on('q') + '">';
}
function projSetFilt(k, part, value) {
  var f = projFstate();
  f[k] = f[k] || {};
  if (value === '' || value == null) delete f[k][part]; else f[k][part] = value;
  if (!Object.keys(f[k]).length) delete f[k];
  refreshProjTable();
}
function projPasses(s) {
  var f = projFstate();
  return projCols().every(function (c) {
    var v = f[c.k]; if (!v) return true;
    var x = pv(c, s);
    if (c.d) return !(v.from && (!x || x < v.from)) && !(v.to && (!x || x > v.to));
    if (c.m || c.n) {
      var n = Number(x) || 0, lo = parseAmount(v.min), hi = parseAmount(v.max);
      return !(isFinite(lo) && n < lo) && !(isFinite(hi) && n > hi);
    }
    return !v.q || String(x || '').toLowerCase().indexOf(String(v.q).toLowerCase()) >= 0;
  });
}
function projClearFilters() { S.filters._proj = {}; renderPage(); }

/* סימון שורות */
function projSel(id, on) {
  var s = selOf('projects', '');
  if (on) s[id] = 1; else delete s[id];
  refreshProjTable();
}
function projSelAll(on) {
  var s = selOf('projects', '');
  Object.keys(s).forEach(function (k) { delete s[k]; });
  if (on) projFiltered().forEach(function (x) { s[x.p.id] = 1; });
  refreshProjTable();
}
function projBulkBar(list) {
  var el = byId('bb-projects'), s = selOf('projects', '');
  var picked = list.filter(function (x) { return s[x.p.id]; });
  var sa = byId('sa-projects');
  if (sa) { sa.checked = !!picked.length && picked.length === list.length; sa.indeterminate = !!picked.length && picked.length < list.length; }
  if (!el) return;
  if (!picked.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="bulkbar"><b>' + picked.length + ' פרוייקטים מסומנים</b>' +
    '<span>רווח צפוי ' + money(sumOf(picked, function (x) { return x.profit; })) + '</span><div class="sp"></div>' +
    (bulkReady()
      ? (can('projects', 'edit')
          ? '<button class="btn sm" onclick="projBulkActive(true)">✔ סמן כפעילים</button>' +
            '<button class="btn sm" onclick="projBulkActive(false)">⏸ סמן כלא פעילים</button>' +
            '<button class="btn sm p" onclick="bulkEditOpen(\'projects\',\'\')">✏️ עדכון מרוכז</button>' : '') +
        (can('projects', 'delete') ? '<button class="btn sm d" onclick="bulkDeleteAsk(\'projects\',\'\')">🗑️</button>' : '')
      : bulkNotReady()) +
    '<button class="btn sm gh" onclick="projSelAll(false)">✕</button></div>';
}
function projBulkActive(on) {
  var rows = bulkPicked('projects', '');
  if (!rows.length) return;
  bulkSend('projects', 'update', rows, { active: on });
  selAll('projects', '', false);
  rerender();
  toast(rows.length + ' פרוייקטים סומנו כ' + (on ? 'פעילים' : 'לא פעילים'), 'ok');
}
