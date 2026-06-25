# העלאת אתר המזוזות לשרת Vultr עם דומיין ייעודי

האפליקציה היא קובץ HTML סטטי אחד. השרת רק "מגיש" אותו; הנתונים נשמרים ב-Google Sheets.
לכן ההתקנה פשוטה: דומיין → Nginx → SSL.

## שלב 1 — כוון את הדומיין לשרת
אצל ספק הדומיין שלך, הוסף רשומת **A**:
```
mezuzot.YOUR-DOMAIN.com   →   <ה-IP של שרת ה-Vultr>
```
(החלף ב-תת-הדומיין הרצוי וב-IP של השרת. לוקח כמה דקות עד שעה להתעדכן.)

## שלב 2 — ערוך את הסקריפט
פתח את `deploy-mezuzot.sh` ושנה בראש הקובץ:
- `DOMAIN="mezuzot.YOUR-DOMAIN.com"` → לתת-הדומיין שלך
- `EMAIL` כבר מוגדר (למייל שלך, להתראות חידוש SSL)

## שלב 3 — הרץ על השרת
התחבר ל-VPS ב-SSH והרץ:
```bash
sudo bash deploy-mezuzot.sh
```
הסקריפט: מתקין Nginx+certbot אם צריך, מוריד את הקובץ העדכני מ-GitHub,
מגדיר את תת-הדומיין, ומנפיק SSL חינמי (HTTPS).

בסיום האתר זמין ב: **https://mezuzot.YOUR-DOMAIN.com**

## עדכונים עתידיים
בכל פעם שנשנה משהו בקוד (ואני אדחוף ל-GitHub), פשוט הרץ בשרת:
```bash
curl -fsSL https://raw.githubusercontent.com/dudi98722-bot/project-management/main/mezuzah-management.html -o /var/www/mezuzot/index.html
```
זהו — הגרסה החדשה עלתה.

## הערות
- הנתונים לא נשמרים על שרת ה-Vultr אלא ב-Google Sheets, אז גם אם השרת ייפול הנתונים בטוחים.
- אחרי שתיתן לי את כתובת ה-/exec של Apps Script, אטמיע אותה בקוד — וכל מי שייכנס לדומיין יתחבר אוטומטית לנתונים.
