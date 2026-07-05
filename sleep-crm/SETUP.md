# 🌙 מערכת ייעוץ שינה – הקמה

מערכת עצמאית: **טופס אינטייק ציבורי** להורים + **CRM פרטי** ליועצת.
רצה על תת-דומיין משלה, על אותו VPS של ה-CRM הקיים (פורט 3100, בסיס נתונים נפרד `sleep_db`).

## מבנה
```
sleep-crm/
├─ public/
│  ├─ form.html      ← הטופס שההורים ממלאים (ציבורי)
│  ├─ index.html     ← ה-CRM של היועצת (דורש התחברות)
│  └─ schema.js      ← 45 השאלות (מקור אמת אחד לשניהם)
├─ routes/           ← auth + submissions (API)
├─ db/schema.sql     ← טבלאות
├─ scripts/init_admin.js
├─ server.js
└─ deploy.sh         ← מקים תת-דומיין מקצה לקצה
```

## כתובות אחרי ההקמה
- טופס להורים: `https://<תת-דומיין>/form.html`
- CRM ליועצת:  `https://<תת-דומיין>/`

## שלבי הקמה (על השרת)
1. **DNS** – ברשם הדומיין / Cloudflare: הוסף רשומת `A` בשם תת-הדומיין (למשל `sleep`) שמצביעה ל-IP של ה-VPS.
2. **העלאת הקוד** לשרת (git pull / scp) אל תיקייה כלשהי.
3. **הרצה**:
   ```bash
   sudo SLEEP_DB_PASSWORD='סיסמת-DB-חזקה' \
        SLEEP_ADMIN_PASSWORD='סיסמת-כניסה-ליועצת' \
        bash deploy.sh sleep.your-domain.com
   ```
   הסקריפט מקים: בסיס נתונים, שירות systemd, vhost ב-nginx, ומשתמש אדמין.
4. **HTTPS**:
   ```bash
   certbot --nginx -d sleep.your-domain.com
   ```

## כניסה ל-CRM
- משתמש ברירת מחדל: `atara` (ניתן לשנות ב-`.env` → `ADMIN_USER`)
- סיסמה: מה שהוגדר ב-`SLEEP_ADMIN_PASSWORD`

## עדכון גרסה
```bash
cd /var/www/sleep-crm && git pull && npm install --production && systemctl restart sleep-crm
```
