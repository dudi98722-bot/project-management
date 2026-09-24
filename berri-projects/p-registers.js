/* BERRI — קופות: יתרה בכל קופה + תנועות כניסה/יציאה/העברה */
'use strict';

function pageRegisters(w) {
  var v = calc(), ed = can('cashMoves', 'add');
  w.innerHTML =
    '<div class="page-head"><h2>💰 קופות</h2><div class="sp"></div>' +
      (ed ? '<button class="btn" onclick="entryModal(\'in\')">⬇️ כסף נכנס</button>' +
            '<button class="btn" onclick="entryModal(\'out\')">⬆️ כסף יצא</button>' +
            '<button class="btn" onclick="entryModal(\'tr\')">⇄ העברה</button>' : '') +
      (can('registers', 'add') ? '<button class="btn o" onclick="registerModal()">➕ קופה חדשה</button>' : '') + '</div>' +
    '<div class="kpis">' + kpi('💰 סה״כ בכל הקופות', v.totalBalance, 'נכון להיום · לחיצה על קופה פותחת את הכרטסת שלה', 'navy') + '</div>' +
    regCards() +
    '<p class="hint" style="margin:-6px 0 14px">טיפ: לצ׳קים דחויים פתחו קופה "צ׳קים" — התשלום נרשם אליה, ובפירעון מעבירים ממנה לבנק.</p>' +
    tableOrAdd('cashMoves', '', { add: 'entryModal(\'in\')', addLabel: 'תנועה' });
  mountTables([['cashMoves', '']]);
}
