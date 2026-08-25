#!/bin/bash
# ============================================================
#  פסיכולוגיה מסילות — רשימת המתנה, שיבוץ מטפלים ולוח שנה
#  התקנה מלאה על ה-VPS: Node + PostgreSQL + systemd + nginx + SSL
#
#  הרצה על השרת:  sudo bash deploy-therapy.sh
#  עדכון גרסה בלבד (אחרי git push):  sudo bash deploy-therapy.sh update
#  שינוי דומיין:  sudo DOMAIN=אחר.dudi-ananalytics.com bash deploy-therapy.sh
#
#  דרישה מוקדמת: רשומת A ב-Namecheap  ->  64.176.175.180
#  (רשומת ה-wildcard * הקיימת כבר מכסה את זה — אין צורך ברשומה נפרדת)
# ============================================================
set -e

DOMAIN="${DOMAIN:-psychology-mesilot.dudi-ananalytics.com}"
APP_DIR="/opt/therapy-crm"
SERVICE="therapy-crm"
PORT=3720
DB_NAME="therapy_crm"
DB_USER="therapycrm"
REPO="https://github.com/dudi98722-bot/project-management.git"
SUBDIR="therapy-crm"

MODE="${1:-full}"

echo "🚀 פסיכולוגיה מסילות — $DOMAIN"
echo "============================================"

# ---------- עדכון בלבד ----------
if [ "$MODE" = "update" ]; then
  echo "🔄 מושך גרסה חדשה..."
  cd "$APP_DIR/repo" && git pull --ff-only

  # הסקריפט מריץ את עצמו מהעותק שהורדת פעם; מרעננים אותו כדי שתיקוני
  # בטיחות (כמו --exclude uploads) יחולו גם בהרצה הבאה
  SELF="$(readlink -f "$0")"
  FRESH="$APP_DIR/repo/deploy/deploy-therapy.sh"
  if [ -f "$FRESH" ] && ! cmp -s "$FRESH" "$SELF"; then
    cp "$FRESH" "$SELF"
    echo "   ↻ סקריפט ההתקנה עודכן — מריץ מחדש את הגרסה החדשה"
    exec bash "$SELF" update
  fi

  # הקבצים חייבים לשבת מחוץ ל-app/ כדי ש-rsync --delete לא ימחק אותם
  mkdir -p "$APP_DIR/uploads"
  grep -q '^UPLOAD_DIR=' "$APP_DIR/app/.env" 2>/dev/null || echo "UPLOAD_DIR=$APP_DIR/uploads" >> "$APP_DIR/app/.env"
  # משתנים שנוספו אחרי ההתקנה הראשונה — מתווספים בלי לדרוס ערכים קיימים
  while IFS= read -r kv; do
    k=$(printf %s "$kv" | cut -d= -f1)
    grep -q "^$k=" "$APP_DIR/app/.env" 2>/dev/null || printf "%s\n" "$kv" >> "$APP_DIR/app/.env"
  done <<EOKV
APP_URL=https://$DOMAIN
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
EOKV

  rsync -a --delete --exclude node_modules --exclude .env --exclude service-account.json --exclude uploads "$APP_DIR/repo/$SUBDIR/" "$APP_DIR/app/"
  cd "$APP_DIR/app" && npm install --omit=dev
  systemctl restart "$SERVICE"
  sleep 2
  systemctl --no-pager --lines=0 status "$SERVICE" | head -3
  echo "✅ עודכן. הסכימה מוחלת אוטומטית בעליית השרת."
  exit 0
fi

# ---------- 1. תלויות מערכת ----------
echo "📦 בודק תלויות..."
if ! command -v node >/dev/null 2>&1; then
  echo "   מתקין Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "   מתקין PostgreSQL..."
  apt-get update && apt-get install -y postgresql postgresql-contrib
fi
apt-get install -y git rsync nginx >/dev/null 2>&1 || true
echo "   ✅ Node $(node -v), Postgres מותקן"

# ---------- 2. מסד נתונים ----------
echo "🗄️  מגדיר מסד נתונים..."
DB_PASS_FILE="$APP_DIR/.dbpass"
mkdir -p "$APP_DIR"
if [ -f "$DB_PASS_FILE" ]; then
  DB_PASS=$(cat "$DB_PASS_FILE")
else
  DB_PASS=$(openssl rand -hex 24)
  echo "$DB_PASS" > "$DB_PASS_FILE"; chmod 600 "$DB_PASS_FILE"
fi
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
sudo -u postgres psql -c "ALTER USER $DB_USER WITH PASSWORD '$DB_PASS';" >/dev/null
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
echo "   ✅ מסד $DB_NAME מוכן"

# ---------- 3. קוד האפליקציה ----------
echo "📥 מוריד את קוד האפליקציה..."
if [ -d "$APP_DIR/repo/.git" ]; then
  cd "$APP_DIR/repo" && git pull --ff-only
else
  rm -rf "$APP_DIR/repo"
  git clone --depth 1 "$REPO" "$APP_DIR/repo"
fi
mkdir -p "$APP_DIR/app" "$APP_DIR/uploads"
rsync -a --delete --exclude node_modules --exclude .env --exclude service-account.json --exclude uploads "$APP_DIR/repo/$SUBDIR/" "$APP_DIR/app/"
cd "$APP_DIR/app"
npm install --omit=dev
echo "   ✅ הקוד מותקן ב-$APP_DIR/app"

# ---------- 4. קובץ סביבה ----------
if [ ! -f "$APP_DIR/app/.env" ]; then
  echo "⚙️  יוצר .env..."
  JWT=$(openssl rand -hex 32)
  ADMIN_PASS=$(openssl rand -base64 12 | tr -d '/+=' | head -c 12)
  cat > "$APP_DIR/app/.env" <<ENV
DATABASE_URL=postgres://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME
JWT_SECRET=$JWT
JWT_EXPIRES_IN=12h
PORT=$PORT
NODE_ENV=production
CORS_ORIGIN=https://$DOMAIN
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$ADMIN_PASS
SHEETS_WEBHOOK_URL=
SHEETS_SECRET=
UPLOAD_DIR=$APP_DIR/uploads
APP_URL=https://$DOMAIN
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
ENV
  chmod 600 "$APP_DIR/app/.env"
  echo "$ADMIN_PASS" > "$APP_DIR/.adminpass"; chmod 600 "$APP_DIR/.adminpass"
  NEW_INSTALL=1
fi

# ---------- 5. אתחול הסכימה + אדמין ----------
echo "🔧 מאתחל סכימה..."
cd "$APP_DIR/app" && node scripts/init_db.js

# ---------- 6. שירות systemd ----------
echo "⚙️  מגדיר שירות systemd..."
cat > /etc/systemd/system/$SERVICE.service <<UNIT
[Unit]
Description=Therapy-CRM — רשימת המתנה ושיבוץ מטפלים (Node.js)
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=$APP_DIR/app
ExecStart=/usr/bin/node $APP_DIR/app/server.js
Restart=always
RestartSec=3
User=root
EnvironmentFile=$APP_DIR/app/.env

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable $SERVICE >/dev/null 2>&1 || true
systemctl restart $SERVICE
sleep 2
systemctl --no-pager --lines=0 status $SERVICE | head -3

# ---------- 7. nginx ----------
echo "🌐 מגדיר nginx..."
cat > /etc/nginx/sites-available/$SERVICE <<NGINX
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
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
echo "   ✅ nginx נטען מחדש"

# ---------- 8. SSL ----------
echo "🔒 מגדיר SSL..."
if ! command -v certbot >/dev/null 2>&1; then apt-get install -y certbot python3-certbot-nginx; fi
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect \
  -m dudi98722@gmail.com || echo "   ⚠️  certbot נכשל — ודא שה-DNS של $DOMAIN מצביע לשרת, והרץ שוב"

echo ""
echo "============================================"
echo "✅ ההתקנה הושלמה:  https://$DOMAIN"
if [ -n "$NEW_INSTALL" ]; then
  echo ""
  echo "🔑 פרטי כניסה ראשוניים:"
  echo "   משתמש: admin"
  echo "   סיסמא: $(cat $APP_DIR/.adminpass)"
  echo "   (מומלץ להחליף מיד בלשונית משתמשים)"
fi
echo ""
echo "פקודות שימושיות:"
echo "   עדכון גרסה:  sudo bash deploy-therapy.sh update"
echo "   לוגים:       journalctl -u $SERVICE -f"
echo "============================================"
