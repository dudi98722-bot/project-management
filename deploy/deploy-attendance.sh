#!/bin/bash
# ============================================================
#  נוכחות ויזניץ — התקנה על שרת ה-VPS עם דומיין ייעודי + SSL
#  הרצה על השרת (Ubuntu):  sudo bash deploy-attendance.sh
#  דרישה מוקדמת: רשומת A ב-Namecheap:
#     nochehut-vizhnitz  ->  64.176.175.180
# ============================================================
set -e

DOMAIN="${DOMAIN:-nochehut-vizhnitz.dudi-ananalytics.com}"
EMAIL="${EMAIL:-dudi98722@gmail.com}"
WEBROOT="/var/www/nochehut"
RAW_URL="https://raw.githubusercontent.com/dudi98722-bot/project-management/main/attendance-crm.html"
XLSX_URL="https://raw.githubusercontent.com/dudi98722-bot/project-management/main/xlsx.full.min.js"

echo "🚀 מתקין את מערכת הנוכחות עבור $DOMAIN"
echo "============================================"

# ---- Nginx + certbot ----
if ! command -v nginx >/dev/null 2>&1; then
  echo "📦 מתקין Nginx..."
  apt-get update -qq && apt-get install -y -qq nginx
fi
if ! command -v certbot >/dev/null 2>&1; then
  echo "📦 מתקין certbot..."
  apt-get install -y -qq certbot python3-certbot-nginx
fi

# ---- הורדת הקבצים ----
echo "📥 מוריד את הקבצים העדכניים..."
mkdir -p "$WEBROOT"
curl -fsSL "$RAW_URL" -o "$WEBROOT/index.html"
# ספריית ייצוא אקסל — מקומית על השרת (עוקף סינון NetFree על CDN)
curl -fsSL "$XLSX_URL" -o "$WEBROOT/xlsx.full.min.js" || echo "⚠️ לא הצלחתי להוריד xlsx — הייצוא ייפול לפורמט xls בסיסי"
echo "   ✅ נשמר ב-$WEBROOT"

# ---- Nginx ----
echo "🌐 מגדיר Nginx..."
cat > /etc/nginx/sites-available/nochehut <<NGINX
server {
    listen 80;
    server_name $DOMAIN;

    root $WEBROOT;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location ~* \.(html)$ {
        add_header Cache-Control "no-cache";
    }
}
NGINX

ln -sf /etc/nginx/sites-available/nochehut /etc/nginx/sites-enabled/nochehut
nginx -t && systemctl reload nginx
echo "   ✅ Nginx פעיל על http://$DOMAIN"

# ---- SSL ----
echo "🔒 מנפיק תעודת SSL..."
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || {
  echo "   ⚠️  הנפקת SSL נכשלה — ודא שרשומת ה-A של $DOMAIN מצביעה ל-IP של השרת, ונסה שוב:"
  echo "      certbot --nginx -d $DOMAIN"
}

echo ""
echo "============================================"
echo "✅ הסתיים! המערכת זמינה בכתובת:  https://$DOMAIN"
echo ""
echo "לעדכון עתידי (אחרי שינוי בקוד):"
echo "  curl -fsSL $RAW_URL -o $WEBROOT/index.html"
echo "============================================"
