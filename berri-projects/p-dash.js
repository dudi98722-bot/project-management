/* BERRI — תמונת מצב: כל הפרוייקטים וכל הקופות יחד */
'use strict';

function kpi(label, value, sub, cls, onclick) {
  var tag = onclick ? 'button' : 'div';
  return '<' + tag + ' class="kpi ' + (cls || '') + '"' + (onclick ? ' onclick="' + onclick + '"' : '') + '>' +
    '<div class="k">' + label + '</div><div class="v' + moneyCls(value) + '">' + money(value) + '</div>' +
    /* sub יכול להכיל טקסט שמשתמש הקליד (למשל שם קטגוריה) — תמיד מסונן */
    (sub ? '<div class="s">' + esc(sub) + '</div>' : '') + '</' + tag + '>';
}
function bar(p, cls) { return '<div class="bar ' + (cls || '') + '"><i style="width:' + Math.round(p) + '%"></i></div>'; }

function regCards(sel) {
  var v = calc();
  return '<div class="regs">' + sortedRegisters(true).filter(function (r) { return r.active || v.bal[r.id]; }).map(function (r) {
    var b = v.bal[r.id], f = v.future[r.id];
    return '<button class="reg' + (r.active ? '' : ' off') + (sel === r.id ? ' sel' : '') + '" onclick="go(\'register\',\'' + r.id + '\')">' +
      '<div class="nm">' + esc(r.name) + '</div><div class="kd">' + esc(r.kind || '') + (r.active ? '' : ' · לא פעילה') + '</div>' +
      '<div class="bl' + moneyCls(b) + '">' + money(b) + '</div>' +
      (f ? '<div class="ft">ועוד ' + money(f) + ' בתנועות עתידיות</div>' : '<div class="ft">יתרה נכון להיום</div>') + '</button>';
  }).join('') + '</div>';
}

/* מי שאין לו צפייה בדוחות (למשל עובד שטח) — מקבל במקום תמונת המצב לוח
   הזנה מהירה עם מה שמותר לו להוסיף, ולא מספרים שאין לו הרשאה לראות */
function pageEntry(w) {
  var opts = quickOpts();
  w.innerHTML = '<div class="page-head"><h2>👋 שלום ' + esc(S.user.fullName) + '</h2><div class="sp"></div>' +
      '<span class="muted">' + dayLabel(calc().today) + '</span></div>' +
    (opts.length
      ? '<div class="card"><div class="card-head"><h3>➕ מה להזין?</h3></div><div class="card-body">' + quickGrid() + '</div></div>'
      : '<div class="card"><div class="empty"><span class="ico">🔒</span><b>עדיין לא הוגדרו לך הרשאות</b>' +
        'פנה למנהל המערכת כדי שיגדיר מה מותר לך לראות ולהזין</div></div>');
}
function pageDash(w) {
  if (!can('reports', 'view')) return pageEntry(w);
  var v = calc(), ym = v.today.slice(0, 7);
  var monthMv = v.moves.filter(function (m) { return m.date.slice(0, 7) === ym && m.k !== 'tr'; });
  var mIn = sumOf(monthMv.filter(function (m) { return m.dir > 0; })), mOut = sumOf(monthMv.filter(function (m) { return m.dir < 0; }));
  var byK = function (k) { return sumOf(monthMv.filter(function (m) { return m.k === k; })); };
  var act = sortedProjects().filter(function (p) { return p.active; });
  /* כל חלק מוצג רק למי שיש לו צפייה בנתונים שלו */
  var R = can('registers', 'view'), Pj = can('projects', 'view');

  w.innerHTML =
    '<div class="page-head"><h2>📊 תמונת מצב</h2><div class="sp"></div><span class="muted">' + dayLabel(v.today) + '</span></div>' +
    '<div class="kpis">' +
      (R ? kpi('💰 יתרה בכל הקופות', v.totalBalance, S.d.registers.filter(function (r) { return r.active; }).length + ' קופות פעילות', 'navy', 'go(\'registers\')') : '') +
      (Pj ? kpi('📥 חובות לקוחות לגבייה', v.clientDebt, 'מכל הפרוייקטים', 'green', 'go(\'reports\')') +
        kpi('👷 יתרה לתשלום לקבלנים', v.subDebt, 'מחיר שסוכם פחות ששולם וקוזז', 'red', 'go(\'reports\')') +
        kpi('🧱 צפי הוצאות שנותרו', v.expLeft, 'בפרוייקטים הפעילים', 'amber') : '') +
      (R && Pj ? kpi('🔮 צפי קופה בסיום', v.projected, 'יתרה + גבייה − קבלנים − הוצאות', 'blue') : '') +
      (Pj ? kpi('📈 רווח צפוי — פעילים', v.activeProfit, v.activeCount + ' פרוייקטים פעילים', '', 'go(\'projects\')') +
        kpi('🗓️ קצב רווח לחודש', v.runRate, 'סכום הרווח החודשי של הפעילים') : '') +
    '</div>' +
    (R ? '<div class="card-head" style="border:0;background:none;padding:0 0 8px"><h3>💰 קופות</h3></div>' + regCards() : '') +
    '<div class="cols2"><div>' + (Pj ? activeProjectsCard(act) : '') + '</div><div>' +
      '<div class="card"><div class="card-head"><h3>🗓️ ' + monthLabel(ym) + '</h3><div class="sp"></div>' +
        '<button class="btn sm gh" onclick="go(\'reports\');S.ui.repTab=\'monthly\'">דוח חודשי ›</button></div><div class="card-body">' +
        [['📥 תשלומי לקוחות', byK('cp'), 'in'], ['⬇️ כסף אחר שנכנס', byK('in'), 'in'], ['👷 תשלומים לקבלנים', byK('sp'), 'out'],
         ['🧱 הוצאות פרוייקטים', byK('pe'), 'out'], ['🧾 הוצאות עסק', byK('be'), 'out'], ['🏠 הוצאות בית', byK('he'), 'out'],
         ['⬆️ כסף אחר שיצא', byK('out'), 'out']].map(function (x) {
          return '<div class="pbox-ln" style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line-2)">' +
            '<span>' + x[0] + '</span><b class="num ' + (x[1] ? x[2] : 'muted') + '">' + money(x[1]) + '</b></div>';
        }).join('') +
        '<div style="display:flex;justify-content:space-between;padding:9px 0 0;font-weight:800;font-size:15px">' +
          '<span>תזרים החודש</span><span class="num' + moneyCls(mIn - mOut) + '">' + money(mIn - mOut) + '</span></div>' +
      '</div></div>' + recentCard(v.moves) +
    '</div></div>';
}

function activeProjectsCard(list) {
  var v = calc();
  return '<div class="card"><div class="card-head"><h3>🏗️ פרוייקטים פעילים</h3><div class="sp"></div>' +
    '<button class="btn sm gh" onclick="go(\'projects\')">כל הפרוייקטים ›</button></div>' +
    (list.length ? '<div class="tbl-scroll"><table class="tbl"><thead><tr><th class="nosort">פרוייקט</th><th class="nosort">גבייה מהלקוח</th>' +
      '<th class="nosort">תשלום לקבלן</th><th class="nosort">הוצאות מול צפי</th><th class="nosort num">רווח צפוי</th><th class="nosort num">לחודש</th></tr></thead><tbody>' +
      list.map(function (p) {
        var s = v.proj[p.id];
        return '<tr class="click" onclick="go(\'project\',\'' + p.id + '\')"><td><b>' + esc(p.name) + '</b><div class="muted" style="font-size:12px">' + esc(p.client || '') + '</div></td>' +
          '<td style="min-width:120px"><div class="meter"><div class="t"><span>' + Math.round(pct(s.clientPaid, s.clientPrice)) + '%</span><b>' + money(s.clientDue) + '</b></div>' + bar(pct(s.clientPaid, s.clientPrice), 'g') + '</div></td>' +
          '<td style="min-width:120px"><div class="meter"><div class="t"><span>' + Math.round(pct(s.subCovered, s.subPrice)) + '%</span><b>' + money(s.subDue) + '</b></div>' + bar(pct(s.subCovered, s.subPrice), 'n') + '</div></td>' +
          '<td style="min-width:120px"><div class="meter"><div class="t"><span>' + money(s.ownExp) + '</span><b>' + money(s.expected) + '</b></div>' +
            bar(pct(s.ownExp, s.expected || s.ownExp), s.ownExp > s.expected ? 'r' : '') + '</div></td>' +
          '<td class="num m' + moneyCls(s.profit) + '">' + money(s.profit) + '</td>' +
          '<td class="num">' + (s.monthly === null ? '<span class="muted">—</span>' : money(s.monthly)) + '</td></tr>';
      }).join('') + '</tbody></table></div>'
    : '<div class="empty"><span class="ico">🏗️</span><b>אין פרוייקטים פעילים</b>' +
      (can('projects', 'add') ? '<button class="btn o" style="margin-top:10px" onclick="projectModal()">➕ פרוייקט חדש</button>' : '') + '</div>') + '</div>';
}

function recentCard(moves) {
  var last = moves.filter(function (m) { return m.half !== 'to'; }).slice(-8).reverse();
  return '<div class="card"><div class="card-head"><h3>🕒 תנועות אחרונות</h3><div class="sp"></div>' +
    '<button class="btn sm gh" onclick="go(\'daily\')">דוח יומי ›</button></div>' +
    (last.length ? '<table class="tbl"><tbody>' + last.map(function (m) {
      return '<tr><td class="num muted">' + fmtDate(m.date) + '</td><td><span class="mv-type">' + MV[m.k].i + ' ' + MV[m.k].t + '</span>' +
        '<div class="muted" style="font-size:12px">' + esc(m.desc) + '</div></td>' +
        '<td class="num m ' + (m.k === 'tr' ? '' : m.dir > 0 ? 'in' : 'out') + '">' + (m.k === 'tr' ? '' : m.dir > 0 ? '+' : '−') + money(m.amount) + '</td></tr>';
    }).join('') + '</tbody></table>' : '<div class="empty">עדיין אין תנועות</div>') + '</div>';
}
