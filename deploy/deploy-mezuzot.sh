#!/bin/bash
# ============================================================
#  התקנת אתר ניהול מזוזות על שרת ה-VPS עם דומיין ייעודי + SSL
#  הרצה על השרת (Ubuntu/Debian):  sudo bash deploy-mezuzot.sh
# ============================================================
set -e

# ---- 1. הגדרה ----
# אפשר להעביר את הדומיין בפקודה (DOMAIN=... bash ...) בלי לערוך את הקובץ,
# או לשנות כאן ידנית את ערך ברירת המחדל.
DOMAIN="${DOMAIN:-mezuzot.YOUR-DOMAIN.com}"   # ← תת-הדומיין שלך
EMAIL="${EMAIL:-dudi98722@gmail.com}"         # ← מייל ל-Let's Encrypt (התראות חידוש SSL)

if [ "$DOMAIN" = "mezuzot.YOUR-DOMAIN.com" ]; then
  echo "❌ לא הוגדר דומיין. הרץ כך:"
  echo "   DOMAIN=mezuzot.הדומיין-שלך.com bash <(curl -fsSL <כתובת-הסקריפט>)"
  exit 1
fi

WEBROOT="/var/www/mezuzot"
RAW_URL="https://raw.githubusercontent.com/dudi98722-bot/project-management/main/mezuzah-management.html"

echo "🚀 מתקין את אתר המזוזות עבור $DOMAIN"
echo "============================================"

# ---- 2. ודא ש-Nginx ו-certbot מותקנים ----
if ! command -v nginx >/dev/null 2>&1; then
  echo "📦 מתקין Nginx..."
  apt-get update -qq && apt-get install -y -qq nginx
fi
if ! command -v certbot >/dev/null 2>&1; then
  echo "📦 מתקין certbot..."
  apt-get install -y -qq certbot python3-certbot-nginx
fi

# ---- 3. הורד את קובץ ה-HTML העדכני מ-GitHub ----
echo "📥 מוריד את הקובץ העדכני..."
mkdir -p "$WEBROOT"
curl -fsSL "$RAW_URL" -o "$WEBROOT/index.html"
echo "   ✅ נשמר ב-$WEBROOT/index.html"

# ---- 4. הגדרת Nginx לתת-הדומיין ----
echo "🌐 מגדיר Nginx..."
cat > /etc/nginx/sites-available/mezuzot <<NGINX
server {
    listen 80;
    server_name $DOMAIN;

    root $WEBROOT;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # קבצים סטטיים — caching קצר כדי שעדכונים יתפסו מהר
    location ~* \.(html)$ {
        add_header Cache-Control "no-cache";
    }
}
NGINX

ln -sf /etc/nginx/sites-available/mezuzot /etc/nginx/sites-enabled/mezuzot
nginx -t && systemctl reload nginx
echo "   ✅ Nginx פעיל על http://$DOMAIN"

# ---- 5. SSL (HTTPS) חינמי דרך Let's Encrypt ----
echo "🔒 מנפיק תעודת SSL..."
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || {
  echo "   ⚠️  הנפקת SSL נכשלה — ודא שהדומיין $DOMAIN מצביע (A record) ל-IP של השרת, ונסה שוב:"
  echo "      certbot --nginx -d $DOMAIN"
}

echo ""
echo "============================================"
echo "✅ הסתיים! האתר זמין בכתובת:  https://$DOMAIN"
echo ""
echo "לעדכון עתידי (אחרי שינוי בקוד) — הרץ שוב רק את ההורדה:"
echo "  curl -fsSL $RAW_URL -o $WEBROOT/index.html"
echo "============================================"
