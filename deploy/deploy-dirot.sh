#!/bin/bash
# ============================================================
#  התקנת אתר "ניהול דירות ושותפויות" על ה-VPS עם תת-דומיין + SSL
#  הרצה על השרת (Ubuntu/Debian):  sudo bash deploy-dirot.sh
# ============================================================
set -e

# ---- 1. הגדרה ----
# אפשר להעביר את הדומיין בפקודה (DOMAIN=... bash ...) בלי לערוך את הקובץ,
# או להשאיר את ברירת המחדל.
DOMAIN="${DOMAIN:-alexander-dirot.dudi-ananalytics.com}"   # ← תת-הדומיין
EMAIL="${EMAIL:-dudi98722@gmail.com}"                      # ← מייל ל-Let's Encrypt (התראות חידוש SSL)

WEBROOT="/var/www/alexander-dirot"
RAW_URL="https://raw.githubusercontent.com/dudi98722-bot/project-management/main/apartments-crm.html"

echo "🚀 מתקין את אתר הדירות עבור $DOMAIN"
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
cat > /etc/nginx/sites-available/alexander-dirot <<NGINX
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

ln -sf /etc/nginx/sites-available/alexander-dirot /etc/nginx/sites-enabled/alexander-dirot
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
