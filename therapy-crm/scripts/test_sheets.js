// בדיקת חיבור ל-Google Sheets: יוצר את הלשוניות ורושם שורת בדיקה.
// שימוש:  node scripts/test_sheets.js
require('dotenv').config();
const sheets = require('../sheets');

(async () => {
  try {
    const r = await sheets.verify();
    console.log(`✅ החיבור עובד — גיליון: "${r.title}"`);
    console.log(`   לשוניות: ${r.tabs.join(' · ')}`);
    process.exit(0);
  } catch (e) {
    const m = e.message || String(e);
    console.error('❌ החיבור נכשל: ' + m);
    if (/permission|forbidden|403/i.test(m)) {
      console.error('   הסיבה כמעט תמיד: הגיליון לא שותף עם חשבון השירות (צריך הרשאת Editor).');
    } else if (/not found|404/i.test(m)) {
      console.error('   מזהה הגיליון (BACKUP_SHEET_ID) שגוי — בדוק שהעתקת אותו נכון מהכתובת.');
    } else if (/API has not been used|disabled/i.test(m)) {
      console.error('   צריך להפעיל את Google Sheets API בפרויקט בגוגל קלאוד.');
    }
    process.exit(1);
  }
})();
