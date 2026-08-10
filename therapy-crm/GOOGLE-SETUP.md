# חיבור מערכת הטיפולים ל-Google Sheets

המערכת משקפת אוטומטית כל נתון לגיליון גוגל: לשונית לכל טבלה (ממתינים, מטפלים,
קבוצות מטפלים, סדרות טיפול, פגישות) + לשונית "פעולות" עם יומן כל שינוי.
הכיוון הוא חד-כיווני — המערכת כותבת לגיליון (גיבוי/צפייה). עריכה ידנית בגיליון
לא חוזרת למערכת.

## שלב 1 — יצירת חשבון שירות (חד-פעמי, אם אין לך כבר)
אם כבר יש לך `service-account.json` מפרויקט קודם (contractor-crm) — אפשר להשתמש באותו קובץ ולדלג לשלב 2.

1. היכנס ל-https://console.cloud.google.com
2. צור פרויקט (או בחר קיים) → APIs & Services → Library → חפש **Google Sheets API** → Enable
3. APIs & Services → Credentials → Create Credentials → **Service Account**
4. אחרי היצירה: היכנס לחשבון השירות → Keys → Add Key → JSON → הורד את הקובץ

## שלב 2 — יצירת הגיליון ושיתוף
1. צור גיליון חדש ב-Google Sheets (למשל "מערכת טיפולים — גיבוי")
2. העתק את ה-ID מהכתובת: `https://docs.google.com/spreadsheets/d/`**`<זה-ה-ID>`**`/edit`
3. שתף את הגיליון (כפתור Share) עם כתובת המייל של חשבון השירות
   (נראית כמו `xxx@yyy.iam.gserviceaccount.com`, מופיעה בקובץ ה-JSON בשדה `client_email`) — הרשאת **Editor**

## שלב 3 — הגדרה על השרת
```bash
# העתק את קובץ חשבון השירות לשרת
scp service-account.json root@SERVER:/opt/therapy-crm/app/service-account.json

# הוסף את ה-ID לקובץ הסביבה
nano /opt/therapy-crm/app/.env
#   BACKUP_SHEET_ID=<ה-ID מהשלב הקודם>

systemctl restart therapy-crm
```

זהו. מהשינוי הבא במערכת — הלשוניות ייווצרו לבד והנתונים יתחילו להתעדכן.
אם `BACKUP_SHEET_ID` ריק — המערכת עובדת רגיל, פשוט בלי שיקוף.
