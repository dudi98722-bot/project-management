/* =====================================================================
   BERRI — מנוע טבלאות: סינון "כמו אקסל" בראש כל עמודה, מיון, סיכום,
   עריכה/מחיקה בשורה וייצוא לאקסל. אותה טבלה משמשת גם בתוך פרוייקט (ctx).
   ===================================================================== */
'use strict';

var PCOL = { k: 'projectName', t: 'פרוייקט', type: 'pick', get: function (r) { return projName(r.projectId); }, noCtx: true };
var RCOL = function (t) { return { k: 'registerName', t: t, type: 'pick', get: function (r) { return regName(r.registerId); } }; };
var WHO = [{ k: 'userName', t: 'נרשם על ידי', type: 'pick', muted: true }];

var TBL = {
  additions: {
    title: 'תוספות לפרוייקט', icon: '➕', table: 'additions', kind: 'ad',
    rows: function (ctx) { return S.d.additions.filter(function (x) { return !ctx || x.projectId === ctx; }); },
    cols: [{ k: 'date', t: 'תאריך', type: 'date' }, PCOL,
      { k: 'description', t: 'תיאור התוספת', type: 'text' },
      { k: 'clientAmount', t: 'תוספת ללקוח', type: 'money', sum: true, cls: 'in' },
      { k: 'subAmount', t: 'תוספת לקבלן', type: 'money', sum: true, cls: 'out' },
      { k: 'profitAdd', t: 'תוספת לרווח', type: 'money', sum: true,
        get: function (r) { return round2((Number(r.clientAmount) || 0) - (Number(r.subAmount) || 0)); } },
      { k: 'note', t: 'הערה', type: 'text' }].concat(WHO)
  },
  clientPayments: {
    title: 'תשלומי לקוחות', icon: '📥', table: 'clientPayments', kind: 'cp',
    rows: function (ctx) { return S.d.clientPayments.filter(function (x) { return !ctx || x.projectId === ctx; }); },
    cols: [{ k: 'date', t: 'תאריך', type: 'date' }, PCOL,
      { k: 'amount', t: 'סכום', type: 'money', sum: true, cls: 'in' }, RCOL('לקופה'),
      { k: 'method', t: 'אמצעי תשלום', type: 'pick' }, { k: 'reference', t: 'אסמכתא', type: 'text' },
      { k: 'note', t: 'הערה', type: 'text' }].concat(WHO)
  },
  subPayments: {
    title: 'תשלומים לקבלן משנה', icon: '👷', table: 'subPayments', kind: 'sp',
    rows: function (ctx) { return S.d.subPayments.filter(function (x) { return !ctx || x.projectId === ctx; }); },
    cols: [{ k: 'date', t: 'תאריך', type: 'date' }, PCOL,
      { k: 'subName', t: 'קבלן משנה', type: 'pick', noCtx: true, get: function (r) { var p = findRow('projects', r.projectId); return p ? p.subName : r.subName; } },
      { k: 'amount', t: 'סכום', type: 'money', sum: true, cls: 'out' }, RCOL('מקופה'),
      { k: 'method', t: 'אמצעי תשלום', type: 'pick' }, { k: 'reference', t: 'אסמכתא', type: 'text' },
      { k: 'note', t: 'הערה', type: 'text' }].concat(WHO)
  },
  projectExpenses: {
    title: 'הוצאות לפרוייקט', icon: '🧱', table: 'projectExpenses', kind: 'pe',
    rows: function (ctx) { return S.d.projectExpenses.filter(function (x) { return !ctx || x.projectId === ctx; }); },
    cols: [{ k: 'date', t: 'תאריך', type: 'date' }, PCOL,
      { k: 'amount', t: 'סכום', type: 'money', sum: true, cls: 'out' }, RCOL('מקופה'),
      { k: 'category', t: 'קטגוריה', type: 'pick' }, { k: 'supplier', t: 'ספק / פירוט', type: 'text' },
      { k: 'deductHe', t: 'קיזוז מהקבלן', type: 'pick', get: function (r) { return r.deductSub ? 'מקוזז' : 'לא'; },
        html: function (r) { return r.deductSub ? '<span class="badge o">מקוזז מהקבלן</span>' : '<span class="muted">—</span>'; } },
      { k: 'note', t: 'הערה', type: 'text' }].concat(WHO)
  },
  businessExpenses: {
    title: 'הוצאות עסק', icon: '🧾', table: 'businessExpenses', kind: 'be',
    rows: function () { return S.d.businessExpenses; },
    cols: [{ k: 'date', t: 'תאריך', type: 'date' }, { k: 'amount', t: 'סכום', type: 'money', sum: true, cls: 'out' },
      RCOL('מקופה'), { k: 'category', t: 'קטגוריה', type: 'pick' }, { k: 'supplier', t: 'ספק / פירוט', type: 'text' },
      { k: 'note', t: 'הערה', type: 'text' }].concat(WHO)
  },
  homeExpenses: {
    title: 'הוצאות בית', icon: '🏠', table: 'homeExpenses', kind: 'he', admin: true,
    rows: function () { return S.d.homeExpenses.filter(function (x) { return !x.masked; }); },
    cols: [{ k: 'date', t: 'תאריך', type: 'date' }, { k: 'amount', t: 'סכום', type: 'money', sum: true, cls: 'out' },
      RCOL('מקופה'), { k: 'category', t: 'קטגוריה', type: 'pick' }, { k: 'supplier', t: 'פירוט', type: 'text' },
      { k: 'note', t: 'הערה', type: 'text' }].concat(WHO)
  },
  cashMoves: {
    title: 'תנועות קופה', icon: '⇄', table: 'cashMoves', kind: 'cm',
    rows: function (ctx) {
      return S.d.cashMoves.filter(function (x) { return !ctx || x.registerId === ctx || x.toRegisterId === ctx; });
    },
    cols: [{ k: 'date', t: 'תאריך', type: 'date' },
      { k: 'typeHe', t: 'סוג', type: 'pick', html: function (r) {
        var c = r.type === 'in' ? 'g' : r.type === 'out' ? 'r' : ''; return '<span class="badge ' + c + '">' + esc(r.typeHe) + '</span>'; } },
      { k: 'amount', t: 'סכום', type: 'money', sum: true },
      { k: 'registerName', t: 'קופה', type: 'pick', get: function (r) { return regName(r.registerId); } },
      { k: 'toRegisterName', t: 'לקופה (בהעברה)', type: 'pick', get: function (r) { return r.toRegisterId ? regName(r.toRegisterId) : ''; } },
      { k: 'category', t: 'מקור / מטרה', type: 'pick' }, { k: 'note', t: 'הערה', type: 'text' }].concat(WHO)
  }
};

function tid(tk, ctx) { return tk + (ctx ? '_' + ctx : ''); }
function colsOf(tk, ctx) { return TBL[tk].cols.filter(function (c) { return !(ctx && c.noCtx); }); }
function cellVal(c, r) { return c.get ? c.get(r) : r[c.k]; }
function fstate(id) { return (S.filters[id] = S.filters[id] || {}); }
function sstate(id) { return (S.sorts[id] = S.sorts[id] || { k: 'date', dir: -1 }); }
function tableEditable(tk) { return TBL[tk].admin ? isAdmin() : canEdit(); }

function filterCell(tk, ctx, c) {
  var id = tid(tk, ctx), v = fstate(id)[c.k] || {};
  var on = function (part) { return 'setFilt(\'' + tk + '\',\'' + (ctx || '') + '\',\'' + c.k + '\',\'' + part + '\',this.value)'; };
  if (c.type === 'date') {
    return '<div class="f-pair"><input class="f-inp" type="date" title="מתאריך" value="' + esc(v.from || '') + '" onchange="' + on('from') + '">' +
      '<input class="f-inp" type="date" title="עד תאריך" value="' + esc(v.to || '') + '" onchange="' + on('to') + '"></div>';
  }
  if (c.type === 'money' || c.type === 'num') {
    return '<div class="f-pair"><input class="f-inp" inputmode="decimal" placeholder="מ-" value="' + esc(v.min || '') + '" oninput="' + on('min') + '">' +
      '<input class="f-inp" inputmode="decimal" placeholder="עד" value="' + esc(v.max || '') + '" oninput="' + on('max') + '"></div>';
  }
  if (c.type === 'pick') {
    var seen = {};
    TBL[tk].rows(ctx).forEach(function (r) { var x = cellVal(c, r); if (x !== '' && x != null) seen[x] = 1; });
    return '<select class="f-inp" onchange="' + on('eq') + '"><option value="">הכל</option>' +
      Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, 'he'); }).map(function (o) {
        return '<option' + (v.eq === o ? ' selected' : '') + ' value="' + esc(o) + '">' + esc(o) + '</option>';
      }).join('') + '</select>';
  }
  return '<input class="f-inp" type="search" placeholder="חיפוש…" value="' + esc(v.q || '') + '" oninput="' + on('q') + '">';
}
function setFilt(tk, ctx, key, part, value) {
  var f = fstate(tid(tk, ctx));
  f[key] = f[key] || {};
  if (value === '' || value == null) delete f[key][part]; else f[key][part] = value;
  if (!Object.keys(f[key]).length) delete f[key];
  refreshTable(tk, ctx);
}
function clearFilters(tk, ctx) { S.filters[tid(tk, ctx)] = {}; renderPage(); }
function passes(tk, ctx, r) {
  var f = fstate(tid(tk, ctx));
  return colsOf(tk, ctx).every(function (c) {
    var v = f[c.k]; if (!v) return true;
    var x = cellVal(c, r);
    if (c.type === 'date') return !(v.from && String(x) < v.from) && !(v.to && String(x) > v.to);
    if (c.type === 'money' || c.type === 'num') {
      var n = Number(x) || 0, lo = parseAmount(v.min), hi = parseAmount(v.max);
      return !(isFinite(lo) && n < lo) && !(isFinite(hi) && n > hi);
    }
    if (c.type === 'pick') return v.eq === undefined || String(x) === v.eq;
    return !v.q || String(x || '').toLowerCase().indexOf(String(v.q).toLowerCase()) >= 0;
  });
}
function tableRows(tk, ctx) {
  var s = sstate(tid(tk, ctx)), cols = colsOf(tk, ctx);
  var col = cols.filter(function (c) { return c.k === s.k; })[0] || cols[0];
  return TBL[tk].rows(ctx).filter(function (r) { return passes(tk, ctx, r); }).sort(function (a, b) {
    var x = cellVal(col, a), y = cellVal(col, b);
    if (col.type === 'money' || col.type === 'num') return ((Number(x) || 0) - (Number(y) || 0)) * s.dir;
    var c = String(x == null ? '' : x).localeCompare(String(y == null ? '' : y), 'he', { numeric: true });
    return (c || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))) * s.dir;
  });
}
function sortBy(tk, ctx, k) {
  var s = sstate(tid(tk, ctx));
  if (s.k === k) s.dir = -s.dir; else { s.k = k; s.dir = 1; }
  renderPage();
}

/* opts: { add: 'js()', addLabel, title, compact } */
function tableCard(tk, ctx, opts) {
  opts = opts || {};
  var T = TBL[tk], id = tid(tk, ctx), s = sstate(id), cols = colsOf(tk, ctx), acts = tableEditable(tk);
  var nf = Object.keys(fstate(id)).length;
  /* שורת הסינון פתוחה כברירת מחדל במחשב; בטלפון — בלחיצה */
  var sf = S.filters['_show_' + id];
  var showF = nf > 0 || (sf === undefined ? window.innerWidth > 720 : sf);
  var cx = '\'' + tk + '\',\'' + (ctx || '') + '\'';
  return '<div class="card"><div class="card-head"><h3>' + T.icon + ' ' + (opts.title || T.title) + '</h3><div class="sp"></div>' +
      '<button class="btn sm gh" onclick="toggleFilters(' + cx + ')">🔍 סינון' + (nf ? ' · ' + nf : '') + '</button>' +
      (nf ? '<button class="btn sm gh" onclick="clearFilters(' + cx + ')">✕ נקה</button>' : '') +
      '<button class="btn sm gh" onclick="exportTable(' + cx + ')">📤 אקסל</button>' +
      (IMP[tk] && acts ? '<button class="btn sm gh" onclick="importOpen(' + cx + ')" title="ייבוא שורות מקובץ אקסל">📥 ייבוא</button>' : '') +
      (opts.add && acts ? '<button class="btn sm o" onclick="' + opts.add + '">➕ ' + (opts.addLabel || 'הוספה') + '</button>' : '') +
    '</div><div id="bb-' + id + '"></div><div class="tbl-scroll"><table class="tbl"><thead><tr>' +
      (acts ? '<th class="nosort sel-col"><input type="checkbox" id="sa-' + id + '" title="סימון כל השורות המוצגות" ' +
        'onchange="selAll(' + cx + ',this.checked)"></th>' : '') +
      cols.map(function (c) {
        return '<th class="' + (c.type === 'money' ? 'num' : '') + '" onclick="sortBy(' + cx + ',\'' + c.k + '\')">' + c.t +
          (s.k === c.k ? '<span class="arw">' + (s.dir > 0 ? '▲' : '▼') + '</span>' : '') + '</th>';
      }).join('') + (acts ? '<th class="nosort"></th>' : '') + '</tr>' +
      (showF ? '<tr class="filt">' + (acts ? '<th></th>' : '') +
        cols.map(function (c) { return '<th>' + filterCell(tk, ctx, c) + '</th>'; }).join('') +
        (acts ? '<th></th>' : '') + '</tr>' : '') +
    '</thead><tbody id="tb-' + id + '"></tbody><tfoot id="tf-' + id + '"></tfoot></table></div>' +
    '<div class="count-line" id="cl-' + id + '"></div></div>';
}
function toggleFilters(tk, ctx) {
  var k = '_show_' + tid(tk, ctx), cur = S.filters[k];
  S.filters[k] = !(cur === undefined ? window.innerWidth > 720 : cur);
  renderPage();
}
function cellHtml(c, r) {
  var v = cellVal(c, r);
  if (c.html) return '<td>' + c.html(r) + '</td>';
  if (c.type === 'date') return '<td class="num">' + fmtDate(v) + '</td>';
  if (c.type === 'money') {
    var cls = c.cls || (r.type === 'in' ? 'in' : r.type === 'out' ? 'out' : '');
    return '<td class="num m ' + cls + '">' + money(v) + '</td>';
  }
  return '<td' + (c.muted ? ' class="muted"' : '') + '>' + (v ? esc(v) : '<span class="muted">—</span>') + '</td>';
}
function refreshTable(tk, ctx) {
  var id = tid(tk, ctx), tb = byId('tb-' + id);
  if (!tb) return;
  var T = TBL[tk], rows = tableRows(tk, ctx), all = T.rows(ctx).length, cols = colsOf(tk, ctx), acts = tableEditable(tk);
  var n = cols.length + (acts ? 2 : 0);
  /* סימון נשאר רק על שורות שמוצגות עכשיו — כדי שפעולה מרוכזת לא תיגע
     בשורה שהוסתרה בסינון ואי אפשר לראות אותה */
  var sel = selOf(tk, ctx), shown = {};
  rows.forEach(function (r) { shown[r.id] = 1; });
  Object.keys(sel).forEach(function (k) { if (!shown[k]) delete sel[k]; });
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="' + n + '"><div class="empty"><span class="ico">' + (all ? '🔍' : T.icon) + '</span>' +
      (all ? 'אין שורות שמתאימות לסינון' : 'עדיין לא הוזנו ' + T.title) + '</div></td></tr>';
    byId('tf-' + id).innerHTML = '';
  } else {
    tb.innerHTML = rows.map(function (r) {
      return '<tr' + (sel[r.id] ? ' class="selected"' : '') + '>' +
        (acts ? '<td class="sel-col"><input type="checkbox"' + (sel[r.id] ? ' checked' : '') +
          ' onchange="selOne(\'' + tk + '\',\'' + (ctx || '') + '\',\'' + r.id + '\',this.checked)"></td>' : '') +
        cols.map(function (c) { return cellHtml(c, r); }).join('') +
        (acts ? '<td><div class="row-acts">' +
          '<button class="icon-btn" title="עריכה" onclick="editRow(\'' + tk + '\',\'' + r.id + '\')">✏️</button>' +
          '<button class="icon-btn del" title="מחיקה" onclick="askDelete(\'' + T.table + '\',\'' + r.id + '\')">🗑️</button>' +
          '</div></td>' : '') + '</tr>';
    }).join('');
    byId('tf-' + id).innerHTML = '<tr>' + (acts ? '<td></td>' : '') + cols.map(function (c, i) {
      if (c.sum) return '<td class="num">' + money(sumOf(rows, function (r) { return cellVal(c, r); })) + '</td>';
      return '<td>' + (i === 0 ? 'סה״כ' : '') + '</td>';
    }).join('') + (acts ? '<td></td>' : '') + '</tr>';
  }
  byId('cl-' + id).innerHTML = rows.length === all ? '<span>' + all + ' שורות</span>'
    : '<span class="badge o">מציג ' + rows.length + ' מתוך ' + all + '</span>';
  if (acts) bulkBar(tk, ctx, rows);
}

/* ---------- סימון שורות לפעולה מרוכזת ---------- */
function selOf(tk, ctx) { S.sel = S.sel || {}; var k = tid(tk, ctx); return (S.sel[k] = S.sel[k] || {}); }
function selOne(tk, ctx, id, on) {
  var s = selOf(tk, ctx);
  if (on) s[id] = 1; else delete s[id];
  refreshTable(tk, ctx);
}
function selAll(tk, ctx, on) {
  if (tk === 'projects') return projSelAll(on);      // לטבלת הפרוייקטים יש מנוע משלה
  var s = selOf(tk, ctx);
  Object.keys(s).forEach(function (k) { delete s[k]; });
  if (on) tableRows(tk, ctx).forEach(function (r) { s[r.id] = 1; });
  refreshTable(tk, ctx);
}
function bulkBar(tk, ctx, rows) {
  var id = tid(tk, ctx), el = byId('bb-' + id), s = selOf(tk, ctx);
  var picked = rows.filter(function (r) { return s[r.id]; });
  var sa = byId('sa-' + id);
  if (sa) { sa.checked = !!picked.length && picked.length === rows.length; sa.indeterminate = !!picked.length && picked.length < rows.length; }
  if (!el) return;
  if (!picked.length) { el.innerHTML = ''; return; }
  var mc = colsOf(tk, ctx).filter(function (c) { return c.sum && c.type === 'money'; })[0];
  var cx = '\'' + tk + '\',\'' + (ctx || '') + '\'';
  el.innerHTML = '<div class="bulkbar"><b>' + picked.length + ' שורות מסומנות</b>' +
    (mc ? '<span>סה״כ ' + money(sumOf(picked, function (r) { return cellVal(mc, r); })) + '</span>' : '') +
    '<div class="sp"></div>' +
    '<button class="btn sm p" onclick="bulkEditOpen(' + cx + ')">✏️ עדכון מרוכז</button>' +
    '<button class="btn sm d" onclick="bulkDeleteAsk(' + cx + ')">🗑️ מחיקה</button>' +
    '<button class="btn sm gh" onclick="selAll(' + cx + ',false)">✕ ביטול סימון</button></div>';
}
function mountTables(list) { list.forEach(function (x) { refreshTable(x[0], x[1]); }); }

function exportTable(tk, ctx) {
  var T = TBL[tk], cols = colsOf(tk, ctx), rows = tableRows(tk, ctx);
  var head = cols.map(function (c) { return c.t; });
  var body = rows.map(function (r) {
    return cols.map(function (c) {
      var v = c.k === 'deductHe' ? (r.deductSub ? 'מקוזז' : '') : cellVal(c, r);
      if (c.type === 'date') return { v: v, t: 'd' };
      if (c.type === 'money') return { v: Number(v) || 0, t: 'money' };
      return String(v == null ? '' : v);
    });
  });
  var foot = cols.map(function (c, i) {
    if (i === 0) return 'סה״כ (' + rows.length + ')';
    return c.sum ? { v: sumOf(rows, function (r) { return cellVal(c, r); }), t: 'money' } : '';
  });
  var name = T.title + (ctx && findRow('projects', ctx) ? ' — ' + projName(ctx) : ctx && findRow('registers', ctx) ? ' — ' + regName(ctx) : '');
  saveXlsx([{ name: T.title, rows: [head].concat(body), foot: [foot] }], name);
}
