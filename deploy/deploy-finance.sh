#!/bin/bash
# ============================================================
#  ניהול כספים בני — התקנה על שרת ה-VPS עם דומיין ייעודי + SSL
#  הרצה על השרת (Ubuntu):
#     sudo bash deploy-finance.sh
#  אפשר לשנות דומיין:
#     sudo DOMAIN=אחר.dudi-ananalytics.com bash deploy-finance.sh
#
#  דרישה מוקדמת: רשומת A ב-Namecheap:
#     greiman  ->  64.176.175.180
#
#  מותקן גם עדכון אוטומטי: cron מושך את הקבצים מ-GitHub כל 10 דקות,
#  כך שאחרי כל push ל-main האתר מתעדכן לבד.
# ============================================================
set -e

DOMAIN="${DOMAIN:-greiman.dudi-ananalytics.com}"
EMAIL="${EMAIL:-dudi98722@gmail.com}"
WEBROOT="/var/www/finance"
RAW="https://raw.githubusercontent.com/dudi98722-bot/project-management/main"

echo "🚀 מתקין את מערכת ניהול הכספים עבור $DOMAIN"
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
curl -fsSL "$RAW/finance-tracker.html"  -o "$WEBROOT/index.html"
curl -fsSL "$RAW/finance-form.html"     -o "$WEBROOT/form.html"
curl -fsSL "$RAW/bait.html"             -o "$WEBROOT/bait.html"
curl -fsSL "$RAW/xlsx.full.min.js"      -o "$WEBROOT/xlsx.full.min.js"
curl -fsSL "$RAW/chart.umd.min.js"      -o "$WEBROOT/chart.umd.min.js"
# אייקונים + manifest להוספה למסך הבית (PWA)
curl -fsSL "$RAW/manifest.json"         -o "$WEBROOT/manifest.json"
curl -fsSL "$RAW/manifest-home.json"    -o "$WEBROOT/manifest-home.json"
curl -fsSL "$RAW/icon-192.png"          -o "$WEBROOT/icon-192.png"
curl -fsSL "$RAW/icon-512.png"          -o "$WEBROOT/icon-512.png"
curl -fsSL "$RAW/apple-touch-icon.png"  -o "$WEBROOT/apple-touch-icon.png"
echo "   ✅ נשמרו ב-$WEBROOT (index.html=מערכת, form.html=טופס ציבורי)"

# ---- Nginx ----
echo "🌐 מגדיר Nginx..."
cat > /etc/nginx/sites-available/finance <<NGINX
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

ln -sf /etc/nginx/sites-available/finance /etc/nginx/sites-enabled/finance
nginx -t && systemctl reload nginx
echo "   ✅ Nginx פעיל על http://$DOMAIN"

# ---- SSL ----
echo "🔒 מנפיק תעודת SSL..."
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || {
  echo "   ⚠️  הנפקת SSL נכשלה — ודא שרשומת ה-A של $DOMAIN מצביעה ל-IP של השרת, ונסה שוב:"
  echo "      certbot --nginx -d $DOMAIN"
}

# ---- עדכון אוטומטי מ-GitHub כל 10 דקות ----
echo "🔄 מתקין עדכון אוטומטי (cron)..."
cat > /etc/cron.d/finance-pull <<CRON
*/10 * * * * root curl -fsSL $RAW/finance-tracker.html -o $WEBROOT/index.html && curl -fsSL $RAW/finance-form.html -o $WEBROOT/form.html && curl -fsSL $RAW/bait.html -o $WEBROOT/bait.html
CRON
chmod 644 /etc/cron.d/finance-pull
echo "   ✅ האתר יתעדכן לבד תוך 10 דקות מכל push"

echo ""
echo "============================================"
echo "✅ הסתיים!"
echo "   מערכת הניהול:   https://$DOMAIN"
echo "   הטופס הציבורי:  https://$DOMAIN/form.html"
echo "============================================"
