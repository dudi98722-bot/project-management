#!/bin/bash
# ============================================================
#  מערכת שידוכים (פרק ב') — התקנה על שרת ה-VPS עם דומיין ייעודי + SSL
#  הרצה על השרת (Ubuntu):
#     sudo bash deploy-shidduchim.sh
#  אפשר לשנות דומיין:
#     sudo DOMAIN=אחר.dudi-ananalytics.com bash deploy-shidduchim.sh
#
#  דרישה מוקדמת: רשומת A ב-Namecheap:
#     shidduchim  ->  64.176.175.180
#     (רשומת ה-wildcard * שכבר קיימת מכסה את זה גם בלי רשומה מפורשת)
#
#  שונה משאר האפליקציות: המאגר הזה מכיל שמות, פרטי גירושין והערות אישיות,
#  ולכן האתר מוגן בסיסמה (Basic Auth). הסיסמה נקבעת בסוף ההתקנה, ידנית.
#
#  מותקן גם עדכון אוטומטי: cron מושך את הקבצים מ-GitHub כל 10 דקות,
#  כך שאחרי כל push ל-main האתר מתעדכן לבד.
# ============================================================
set -e

DOMAIN="${DOMAIN:-shidduchim.dudi-ananalytics.com}"
EMAIL="${EMAIL:-dudi98722@gmail.com}"
WEBROOT="/var/www/shidduchim"
HTPASSWD="/etc/nginx/.htpasswd-shidduchim"
RAW="https://raw.githubusercontent.com/dudi98722-bot/project-management/main"

echo "🚀 מתקין את מערכת השידוכים עבור $DOMAIN"
echo "============================================"

# ---- Nginx + certbot + htpasswd ----
if ! command -v nginx >/dev/null 2>&1; then
  echo "📦 מתקין Nginx..."
  apt-get update -qq && apt-get install -y -qq nginx
fi
if ! command -v certbot >/dev/null 2>&1; then
  echo "📦 מתקין certbot..."
  apt-get install -y -qq certbot python3-certbot-nginx
fi
if ! command -v htpasswd >/dev/null 2>&1; then
  echo "📦 מתקין apache2-utils (ליצירת סיסמה)..."
  apt-get install -y -qq apache2-utils
fi

# ---- הורדת הקבצים ----
echo "📥 מוריד את הקבצים העדכניים..."
mkdir -p "$WEBROOT"
curl -fsSL "$RAW/shidduchim.html"    -o "$WEBROOT/index.html"
# הספריות מוגשות מקומית — סינון NetFree חוסם CDN-ים
curl -fsSL "$RAW/xlsx.full.min.js"   -o "$WEBROOT/xlsx.full.min.js"
curl -fsSL "$RAW/chart.umd.min.js"   -o "$WEBROOT/chart.umd.min.js"
echo "   ✅ נשמרו ב-$WEBROOT"

# ---- קובץ סיסמאות ----
# נוצר ריק אם אינו קיים, כדי ש-nginx יעלה. קובץ ריק = כל כניסה נדחית,
# כלומר עד שלא נקבעת סיסמה אמיתית המאגר סגור — וזו ההתנהגות הרצויה.
if [ ! -f "$HTPASSWD" ]; then
  touch "$HTPASSWD"
  chmod 640 "$HTPASSWD"
  chown root:www-data "$HTPASSWD"
  NEED_PASSWORD=1
fi

# ---- Nginx ----
echo "🌐 מגדיר Nginx..."
cat > /etc/nginx/sites-available/shidduchim <<NGINX
server {
    listen 80;
    server_name $DOMAIN;

    root $WEBROOT;
    index index.html;

    location / {
        auth_basic "מערכת שידוכים";
        auth_basic_user_file $HTPASSWD;
        try_files \$uri \$uri/ /index.html;
    }

    location ~* \.(html)$ {
        add_header Cache-Control "no-cache";
    }
}
NGINX

ln -sf /etc/nginx/sites-available/shidduchim /etc/nginx/sites-enabled/shidduchim
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
cat > /etc/cron.d/shidduchim-pull <<CRON
*/10 * * * * root curl -fsSL $RAW/shidduchim.html -o $WEBROOT/index.html
CRON
chmod 644 /etc/cron.d/shidduchim-pull
echo "   ✅ האתר יתעדכן לבד תוך 10 דקות מכל push"

echo ""
echo "============================================"
echo "✅ ההתקנה הסתיימה:  https://$DOMAIN"
echo ""
if [ "$NEED_PASSWORD" = "1" ]; then
  echo "⚠️  חובה עכשיו לקבוע סיסמה — עד אז האתר חסום לכולם:"
  echo ""
  echo "      htpasswd -c $HTPASSWD shadchan && systemctl reload nginx"
  echo ""
  echo "   ('shadchan' הוא שם המשתמש — אפשר לשנות. הסיסמה תתבקש בהקלדה.)"
  echo "   להוספת משתמש נוסף בהמשך, בלי -c:   htpasswd $HTPASSWD name"
else
  echo "🔑 קובץ הסיסמאות קיים כבר — לא נגעתי בו."
fi
echo "============================================"
