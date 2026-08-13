// בדיקת חיבור לגיליון דרך Apps Script.
// שימוש:  node scripts/test_sheets.js
require('dotenv').config();
const sheets = require('../sheets');

(async () => {
  try {
    const r = await sheets.verify();
    console.log(`✅ החיבור עובד — הגיליון "${r.sheet}" מוכן (6 לשוניות נוצרו)`);
    process.exit(0);
  } catch (e) {
    const m = (e && e.message) || String(e);
    console.error('❌ החיבור נכשל: ' + m);
    if (/סיסמה שגויה/.test(m)) {
      console.error('   הסיסמה בשרת שונה מזו שבקוד ה-Apps Script (המשתנה SECRET).');
    } else if (/לא צפויה|Anyone|<!DOCTYPE|html/i.test(m)) {
      console.error('   בדוק ב-Deploy ▸ Manage deployments:');
      console.error('     • Who has access = Anyone');
      console.error('     • Execute as = Me');
    } else if (/abort|timeout|ETIMEDOUT|fetch failed/i.test(m)) {
      console.error('   הכתובת לא נענתה. ודא שהיא מסתיימת ב-/exec ושהפריסה פעילה.');
    }
    process.exit(1);
  }
})();
