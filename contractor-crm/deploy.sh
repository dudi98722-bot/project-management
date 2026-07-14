#!/bin/bash
# ============================================================
#  מערכת ניהול קבלן — התקנה על VPS (Ubuntu): Postgres + Node + Nginx + SSL
#  הרצה על השרת:  sudo bash deploy.sh
#  דרישה מוקדמת: רשומת A ב-Namecheap:
#      feder.dudi-ananalytics.com  ->  64.176.175.180
#  (החלף את תת-הדומיין ב-DOMAIN למטה אם בחרת שם אחר)
# ============================================================
set -e

DOMAIN="${DOMAIN:-feder.dudi-ananalytics.com}"
EMAIL="${EMAIL:-dudi98722@gmail.com}"
PORT="${PORT:-3600}"
REPO="https://github.com/dudi98722-bot/project-management.git"
REPO_DIR="/var/www/project-management"
APP_DIR="$REPO_DIR/contractor-crm"
DB_NAME="contractor_crm"
DB_USER="contractor_user"
SERVICE="contractor-crm"

echo "🚀 מתקין את מערכת הקבלן על $DOMAIN"
echo "==============================================="

# ---- 1. חבילות מערכת ----
echo "📦 מתקין חבילות..."
apt-get update -qq
apt-get install -y -qq curl git nginx postgresql postgresql-contrib certbot python3-certbot-nginx openssl

# ---- 2. Node.js 20 ----
if ! command -v node >/dev/null 2>&1; then
  echo "📦 מתקין Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "   Node $(node --version)"

# ---- 3. PostgreSQL: משתמש + מסד ----
echo "🐘 מגדיר PostgreSQL..."
systemctl enable --now postgresql
DB_PASS_FILE=/etc/contractor-crm.dbpass
if [ -f "$DB_PASS_FILE" ]; then DB_PASS=$(cat "$DB_PASS_FILE"); else DB_PASS=$(openssl rand -hex 16); echo "$DB_PASS" > "$DB_PASS_FILE"; chmod 600 "$DB_PASS_FILE"; fi
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
sudo -u postgres psql -c "ALTER USER $DB_USER WITH PASSWORD '$DB_PASS';" >/dev/null
echo "   ✅ מסד $DB_NAME מוכן"

# ---- 4. קוד מ-GitHub ----
echo "📁 מוריד/מעדכן קוד..."
if [ -d "$REPO_DIR/.git" ]; then (cd "$REPO_DIR" && git pull origin main); else git clone "$REPO" "$REPO_DIR"; fi
cd "$APP_DIR"

# ---- 5. תלויות (ללא devDependencies) ----
echo "📦 מתקין תלויות..."
npm install --omit=dev

# ---- 6. קובץ .env ----
if [ ! -f "$APP_DIR/.env" ]; then
  echo "🔐 יוצר .env..."
  JWT=$(openssl rand -hex 32)
  ADMINPASS=$(openssl rand -hex 6)
  cat > "$APP_DIR/.env" <<ENV
DATABASE_URL=postgres://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME
JWT_SECRET=$JWT
JWT_EXPIRES_IN=12h
PORT=$PORT
NODE_ENV=production
CORS_ORIGIN=https://$DOMAIN
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$ADMINPASS
# Google Drive + Sheets (אופציונלי) — ראה GOOGLE-SETUP.md
GOOGLE_SERVICE_ACCOUNT_FILE=
DRIVE_FOLDER_ID=
BACKUP_SHEET_ID=
ENV
  chmod 600 "$APP_DIR/.env"
  echo "   🔑 סיסמת מנהל ראשונית:  admin / $ADMINPASS   (שמור אותה!)"
else
  echo "   • .env כבר קיים — לא משנה"
fi

# ---- 7. אתחול מסד (סכימה + מנהל; בלי משתמשי דמו בפרודקשן) ----
echo "🗄️  מאתחל סכימה..."
node scripts/init_db.js

# ---- 8. שירות systemd ----
echo "⚙️  מגדיר שירות..."
cat > /etc/systemd/system/$SERVICE.service <<SERVICE
[Unit]
Description=Contractor CRM (Node.js)
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=$SERVICE

[Install]
WantedBy=multi-user.target
SERVICE
systemctl daemon-reload
systemctl enable $SERVICE
systemctl restart $SERVICE
echo "   ✅ השירות פועל"

# ---- 9. Nginx + SSL ----
echo "🌐 מגדיר Nginx..."
cat > /etc/nginx/sites-available/$SERVICE <<NGINX
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 20M;   # להעלאת חשבוניות

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
echo "   ✅ Nginx פעיל"

echo "🔒 מנפיק SSL..."
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect \
  || echo "   ⚠️  SSL נכשל — ודא שרשומת A של $DOMAIN מצביעה ל-64.176.175.180 ונסה: certbot --nginx -d $DOMAIN"

# ---- 10. בדיקת בריאות ----
sleep 2
echo -n "🏥 בדיקה: "; curl -s http://localhost:$PORT/api/health && echo

echo ""
echo "==============================================="
echo "✅ הסתיים! המערכת זמינה ב:  https://$DOMAIN"
echo ""
echo "עדכון עתידי (אחרי דחיפה ל-GitHub):"
echo "  cd $APP_DIR && git pull && npm install --omit=dev && systemctl restart $SERVICE"
echo "==============================================="
