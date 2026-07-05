#!/bin/bash
# deploy.sh - הקמת תת-דומיין לאפליקציית ייעוץ שינה על ה-VPS הקיים
# הרצה על השרת:  sudo bash deploy.sh SUBDOMAIN.your-domain.com
set -e

DOMAIN="$1"
if [ -z "$DOMAIN" ]; then echo "שימוש: sudo bash deploy.sh sleep.your-domain.com"; exit 1; fi

APP_DIR="/var/www/sleep-crm"
SERVICE="sleep-crm"
PORT="3100"
DB_NAME="sleep_db"
DB_USER="sleep_user"

echo "🌙 פריסת Sleep-CRM אל $DOMAIN"

# 1) DB (משתמש ובסיס נתונים נפרדים, על אותו PostgreSQL קיים)
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '${SLEEP_DB_PASSWORD:-ChangeThisDbPass}';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

# 2) קבצים
mkdir -p "$APP_DIR"
cp -r ./* "$APP_DIR"/ 2>/dev/null || true
cd "$APP_DIR"
npm install --production

# 3) .env (נוצר רק אם לא קיים)
if [ ! -f "$APP_DIR/.env" ]; then
  cat > "$APP_DIR/.env" <<ENV
PORT=$PORT
NODE_ENV=production
DATABASE_URL=postgresql://$DB_USER:${SLEEP_DB_PASSWORD:-ChangeThisDbPass}@localhost:5432/$DB_NAME
JWT_SECRET=$(head -c32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c40)
JWT_EXPIRES_IN=12h
ADMIN_USER=atara
ADMIN_PASSWORD=${SLEEP_ADMIN_PASSWORD:-ChangeThisLogin}
CORS_ORIGIN=https://$DOMAIN
ENV
  echo "⚠️  נוצר .env — ערוך סיסמאות אם צריך: $APP_DIR/.env"
fi

# 4) סכמה + משתמש אדמין
node scripts/init_admin.js

# 5) systemd service
cat > /etc/systemd/system/$SERVICE.service <<SERVICE
[Unit]
Description=Sleep-CRM (Node.js)
After=network.target postgresql.service
[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
SERVICE
systemctl daemon-reload
systemctl enable $SERVICE
systemctl restart $SERVICE

# 6) Nginx vhost לתת-הדומיין
cat > /etc/nginx/sites-available/$SERVICE <<NGINX
server {
    listen 80;
    server_name $DOMAIN;
    location / {
        proxy_pass http://localhost:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/$SERVICE /etc/nginx/sites-enabled/$SERVICE
nginx -t && systemctl reload nginx

echo ""
echo "✅ הושלם. עכשיו:"
echo "   1) ודא שרשומת DNS A עבור $DOMAIN מצביעה ל-IP של השרת."
echo "   2) הרץ HTTPS:  certbot --nginx -d $DOMAIN"
echo ""
echo "   טופס להורים:   https://$DOMAIN/form.html"
echo "   CRM ליועצת:    https://$DOMAIN/"
