# חיבור Google — גיבוי לשיטס + חשבוניות לדרייב 📊📁

המערכת יכולה:
- **לגבות כל פעולה** (הוספה/עריכה/מחיקה) אוטומטית ל-**Google Sheet** שלך.
- להעלות **חשבוניות** ל-**Google Drive** שלך.

שניהם עובדים דרך **"חשבון שירות"** אחד של גוגל — מעין "משתמש רובוט" שמותר לו לכתוב
רק לגיליון ולתיקייה שתשתף איתו. **הכל אופציונלי** — בלי זה המערכת עובדת מצוין
(חשבוניות נשמרות על השרת, והגיבוי לשיטס פשוט כבוי).

הגדרה חד-פעמית, ~10 דקות.

---

## שלב א׳ — חשבון שירות בגוגל (פעם אחת)

1. היכנס ל-https://console.cloud.google.com והתחבר עם החשבון שלך.
2. למעלה ליד הלוגו: בורר הפרויקטים → **New Project** → שם `contractor-crm` → **Create**.
3. תפריט (☰) → **APIs & Services → Library**. הפעל **שני** ממשקים:
   - חפש **Google Sheets API** → **Enable**
   - חפש **Google Drive API** → **Enable**
4. **APIs & Services → Credentials → Create Credentials → Service account**
   → שם `crm-robot` → **Create and continue** → **Done**.
5. לחץ על החשבון שנוצר → לשונית **Keys** → **Add Key → Create new key → JSON → Create**.
   יורד קובץ `.json` — **שמור אותו, זה המפתח.**
6. פתח את הקובץ והעתק את הכתובת שבשדה `client_email`
   (משהו כמו `crm-robot@contractor-crm.iam.gserviceaccount.com`).

---

## שלב ב׳ — גיליון הגיבוי (Sheets)

1. צור גיליון חדש: https://sheets.new — תן לו שם (למשל "גיבוי CRM קבלן").
2. לחץ **Share** (שתף) → הדבק את מייל חשבון השירות → הרשאה **Editor** → **Share**.
3. העתק את מזהה הגיליון מה-URL:
   `https://docs.google.com/spreadsheets/d/`**`1AbC...XyZ`**`/edit` ← החלק המודגש הוא ה-`SHEET_ID`.

> את הלשוניות (פרויקטים / תנועות / שלבים / קבלני משנה / בית / פעולות) המערכת יוצרת לבד.

---

## שלב ג׳ — תיקיית החשבוניות (Drive)

1. ב-Google Drive צור/בחר תיקייה לחשבוניות.
2. לחץ ימני → **Share** → הדבק את מייל חשבון השירות → **Editor** → **Share**.
3. העתק את מזהה התיקייה מה-URL:
   `https://drive.google.com/drive/folders/`**`1Def...Uvw`** ← החלק המודגש הוא ה-`FOLDER_ID`.

---

## מה לתת לי
1. **קובץ ה-JSON** (שלב א׳.5)
2. **SHEET_ID** (שלב ב׳.3)
3. **FOLDER_ID** (שלב ג׳.3)

ואני מגדיר בשרת (`.env`) ומפעיל מחדש:
```
GOOGLE_SERVICE_ACCOUNT_FILE=/var/www/project-management/contractor-crm/service-account.json
BACKUP_SHEET_ID=<SHEET_ID>
DRIVE_FOLDER_ID=<FOLDER_ID>
```
מרגע זה: כל פעולה נכתבת לגיליון, וכל חשבונית עולה לדרייב. ✅

> 🔒 אבטחה: קובץ ה-JSON הוא מפתח — לא לשתף בצ'אט פומבי ולא בגיט. הוא יושב רק על השרת שלך.
