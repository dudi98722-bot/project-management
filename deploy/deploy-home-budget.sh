#!/bin/bash
# ============================================================
#  ניהול הוצאות בית — התקנה על שרת ה-VPS עם דומיין ייעודי + SSL
#
#  הרצה על השרת (Ubuntu):
#     sudo bash deploy-home-budget.sh
#  שינוי דומיין:
#     sudo DOMAIN=אחר.dudi-ananalytics.com bash deploy-home-budget.sh
#
#  דרישה מוקדמת: רשומת A (או ה-wildcard * הקיים) -> 64.176.175.180
#
#  מותקן גם עדכון אוטומטי: cron מושך את הקובץ מ-GitHub כל 10 דקות,
#  כך שאחרי כל push ל-main האתר מתעדכן לבד.
# ============================================================
set -e

DOMAIN="${DOMAIN:-g.dudi-ananalytics.com}"
EMAIL="${EMAIL:-dudi98722@gmail.com}"
WEBROOT="/var/www/g"
SITE="g"
RAW="https://raw.githubusercontent.com/dudi98722-bot/project-management/main"

echo "🏠 מתקין את מערכת ניהול הוצאות הבית עבור $DOMAIN"
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
curl -fsSL "$RAW/home-budget/index.html" -o "$WEBROOT/index.html"
curl -fsSL "$RAW/xlsx.full.min.js"       -o "$WEBROOT/xlsx.full.min.js"
curl -fsSL "$RAW/chart.umd.min.js"       -o "$WEBROOT/chart.umd.min.js"
echo "   ✅ נשמרו ב-$WEBROOT"

# ---- Nginx ----
echo "🌐 מגדיר Nginx..."
cat > /etc/nginx/sites-available/$SITE <<NGINX
server {
    listen 80;
    server_name $DOMAIN;

    root $WEBROOT;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location ~* \.html\$ {
        add_header Cache-Control "no-cache";
    }
}
NGINX

ln -sf /etc/nginx/sites-available/$SITE /etc/nginx/sites-enabled/$SITE
nginx -t && systemctl reload nginx
echo "   ✅ Nginx פעיל על http://$DOMAIN"

# ---- SSL ----
echo "🔒 מנפיק תעודת SSL..."
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || {
    echo "   ⚠️  הנפקת SSL נכשלה — ודא שה-DNS של $DOMAIN מצביע לשרת, ונסה שוב:"
    echo "      certbot --nginx -d $DOMAIN"
  }
else
  echo "   ✅ כבר קיימת תעודה — מדלג"
fi

# ---- עדכון אוטומטי מ-GitHub כל 10 דקות ----
echo "🔄 מתקין עדכון אוטומטי (cron)..."
cat > /etc/cron.d/home-budget-pull <<CRON
*/10 * * * * root curl -fsSL $RAW/home-budget/index.html -o $WEBROOT/index.html
CRON
chmod 644 /etc/cron.d/home-budget-pull
echo "   ✅ האתר יתעדכן לבד תוך 10 דקות מכל push"

echo ""
echo "============================================"
echo "✅ הסתיים!   https://$DOMAIN"
echo ""
echo "נשאר לחבר את הגיליון:"
echo "  1. צור גיליון Google בשם 'ניהול הוצאות בית'"
echo "  2. Extensions ← Apps Script ← הדבק את home-budget-sheets.gs"
echo "  3. Deploy ← New deployment ← Web app (Execute as: Me, Access: Anyone)"
echo "  4. העתק את כתובת ה-/exec והדבק במערכת: הגדרות ← חיבור ל-Google Sheets"
echo "============================================"
