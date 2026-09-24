/* BERRI — הגדרות: קופות, קטגוריות ומשתמשים. כל חלק מוצג לפי ההרשאות */
'use strict';

function pageSettings(w) {
  w.innerHTML = '<div class="page-head"><h2>⚙️ הגדרות</h2></div>' +
    (can('registers', 'view') ? settingsRegisters() : '') + settingsCats() + (isAdmin() ? settingsUsers() : '') +
    '<div class="card"><div class="card-head"><h3>🔗 המערכת</h3></div><div class="card-body">' +
      '<div class="pbox-ln" style="display:flex;justify-content:space-between;padding:5px 0"><span>מחובר כ-</span><b>' +
        esc(S.user.fullName) + ' (' + (ROLE_HE[S.user.role] || 'משתמש') + ')</b></div>' +
      (S.sheetUrl ? '<div style="padding:5px 0"><a href="' + esc(S.sheetUrl) + '" target="_blank" rel="noopener">📗 פתיחת גיליון הגיבוי בגוגל שיטס</a></div>' : '') +
      '<div class="hint" style="margin-top:8px">כל הנתונים נשמרים בגוגל שיטס — לשונית לכל טבלה. הגיליון הוא הגיבוי המלא.</div>' +
      '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="btn sm" onclick="passwordModal()">🔑 החלפת סיסמה</button>' +
        '<button class="btn sm gh" onclick="refresh()">🔄 רענון מהגיליון</button></div>' +
    '</div></div>';
}

function settingsRegisters() {
  var v = calc(), ed = can('registers', 'edit'), del = can('registers', 'delete');
  return '<div class="card"><div class="card-head"><h3>💰 קופות</h3><div class="sp"></div>' +
      (can('registers', 'add') ? '<button class="btn sm o" onclick="registerModal()">➕ קופה</button>' : '') + '</div>' +
    '<div class="tbl-scroll"><table class="tbl"><thead><tr><th class="nosort">שם</th><th class="nosort">סוג</th>' +
      '<th class="nosort num">יתרת פתיחה</th><th class="nosort">נכון לתאריך</th><th class="nosort num">יתרה היום</th>' +
      '<th class="nosort">סטטוס</th>' + (ed || del ? '<th class="nosort"></th>' : '') + '</tr></thead><tbody>' +
      sortedRegisters(true).map(function (r) {
        return '<tr><td><b>' + esc(r.name) + '</b></td><td>' + esc(r.kind || '') + '</td>' +
          '<td class="num">' + money(r.opening) + '</td><td class="num">' + (fmtDate(r.openingDate) || '<span class="muted">—</span>') + '</td>' +
          '<td class="num m' + moneyCls(v.bal[r.id]) + '">' + money(v.bal[r.id]) + '</td>' +
          '<td>' + (r.active ? '<span class="badge g">פעילה</span>' : '<span class="badge gray">לא פעילה</span>') + '</td>' +
          (ed || del ? '<td><div class="row-acts">' +
            (ed ? '<button class="icon-btn" onclick="registerModal(\'' + r.id + '\')">✏️</button>' : '') +
            (del ? '<button class="icon-btn del" onclick="askDelete(\'registers\',\'' + r.id + '\')">🗑️</button>' : '') +
            '</div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div></div>';
}

/* רק קבוצות של אזורים שהמשתמש עובד בהם */
function settingsCats() {
  var groups = [['project', '🧱 הוצאות פרוייקט'], ['business', '🧾 הוצאות עסק'], ['home', '🏠 הוצאות בית'],
                ['in', '⬇️ כסף נכנס לקופה'], ['out', '⬆️ כסף יצא מקופה']].filter(function (g) { return canCatGroup(g[0]); });
  if (!groups.length) return '';
  return '<div class="card"><div class="card-head"><h3>🏷️ קטגוריות</h3><div class="sp"></div>' +
      '<span class="muted" style="font-size:12.5px">קטגוריה חדשה נוספת לבד כשמקלידים אותה בטופס</span></div>' +
    '<div class="card-body"><div class="p-grid" style="margin:0">' + groups.map(function (g) {
      var list = catsOf(g[0]), ed = canCat(g[0], 'edit'), del = canCat(g[0], 'delete');
      return '<div class="pbox"><h4>' + g[1] + '</h4>' +
        (list.length ? list.map(function (c) {
          return '<div style="display:flex;align-items:center;gap:4px;padding:3px 0;border-bottom:1px solid var(--line-2)">' +
            '<span style="flex:1">' + esc(c.name) + '</span>' +
            (ed ? '<button class="icon-btn" onclick="catModal(\'' + c.id + '\')">✏️</button>' : '') +
            (del ? '<button class="icon-btn del" onclick="askDelete(\'categories\',\'' + c.id + '\')">🗑️</button>' : '') + '</div>';
        }).join('') : '<div class="muted">אין עדיין</div>') +
        (canCat(g[0], 'add') ? '<button class="btn sm gh" style="margin-top:8px" onclick="catModal(null,\'' + g[0] + '\')">➕ הוספה</button>' : '') + '</div>';
    }).join('') + '</div></div></div>';
}

function settingsUsers() {
  return '<div class="card"><div class="card-head"><h3>👥 משתמשים והרשאות</h3><div class="sp"></div>' +
      '<button class="btn sm o" onclick="userModal()">➕ משתמש</button></div>' +
    '<div class="tbl-scroll"><table class="tbl"><thead><tr><th class="nosort">שם מלא</th><th class="nosort">שם משתמש</th>' +
      '<th class="nosort">תפקיד</th><th class="nosort">הרשאות</th><th class="nosort">סטטוס</th><th class="nosort"></th></tr></thead><tbody>' +
      S.d.users.map(function (u) {
        var me = u.id === S.user.id, adm = u.role === 'admin';
        return '<tr class="click" onclick="userModal(\'' + u.id + '\')"><td><b>' + esc(u.fullName) + '</b>' + (me ? ' <span class="badge o">אני</span>' : '') + '</td>' +
          '<td dir="ltr">' + esc(u.username) + '</td>' +
          '<td><span class="badge' + (adm ? '' : ' gray') + '">' + (adm ? 'מנהל' : 'משתמש') + '</span></td>' +
          '<td class="muted" style="font-size:12.5px">' + esc(permSummary(u)) + '</td>' +
          '<td>' + (u.active ? '<span class="badge g">פעיל</span>' : '<span class="badge gray">מושבת</span>') + '</td>' +
          '<td onclick="event.stopPropagation()"><div class="row-acts"><button class="icon-btn" onclick="userModal(\'' + u.id + '\')">✏️</button>' +
          (me ? '' : '<button class="icon-btn del" title="השבתה" onclick="askDisableUser(\'' + u.id + '\')">🚫</button>') + '</div></td></tr>';
      }).join('') + '</tbody></table></div>' +
    '<div class="count-line">מנהל — הכל, כולל ניהול משתמשים. לכל משתמש אחר — לחיצה על השורה פותחת טבלה שבה מסמנים מה מותר לו: ' +
      'צפייה, הוספה, עריכה ומחיקה, לכל אזור בנפרד. ההרשאות נאכפות בשרת, לא רק במסך.</div></div>';
}
