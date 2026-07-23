#!/bin/bash
# ============================================================
#  התקנת ה-Backend של "ניהול דירות ושותפויות" על שרת ה-VPS
#  - שירות Node (systemd) שמאזין מקומית על פורט 3610
#  - nginx: פרוקסי /api -> ה-Node, והשאר מגיש את ה-HTML הסטטי
#  הרצה על השרת:  sudo bash deploy-dirot-backend.sh
# ============================================================
set -e

DOMAIN="alexander-dirot.dudi-ananalytics.com"
APP_DIR="/opt/alexander-dirot"
DATA_DIR="/var/lib/alexander-dirot"
PORT=3610
RAW_BASE="https://raw.githubusercontent.com/dudi98722-bot/project-management/main"

echo "🚀 מתקין את ה-Backend עבור $DOMAIN"
echo "============================================"

# ---- 1. תיקיות + קוד השרת ----
mkdir -p "$APP_DIR" "$DATA_DIR"
echo "📥 מוריד server.js..."
curl -fsSL "$RAW_BASE/apartments-backend/server.js" -o "$APP_DIR/server.js"
echo "   ✅ $APP_DIR/server.js"

# ---- 2. שירות systemd ----
echo "⚙️  מגדיר שירות systemd..."
cat > /etc/systemd/system/alexander-dirot.service <<UNIT
[Unit]
Description=Alexander Dirot backend (Node.js)
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node $APP_DIR/server.js
Restart=always
RestartSec=3
User=root
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable alexander-dirot >/dev/null 2>&1 || true
systemctl restart alexander-dirot
sleep 1
systemctl --no-pager --lines=0 status alexander-dirot | head -3

# ---- 3. nginx: static + /api proxy + SSL (קיים מ-certbot) ----
echo "🌐 מגדיר nginx (סטטי + פרוקסי /api)..."
cat > /etc/nginx/sites-available/alexander-dirot <<'NGINX'
server {
    server_name alexander-dirot.dudi-ananalytics.com;
    client_max_body_size 60M;

    root /var/www/alexander-dirot;
    index index.html;

    # ה-API של הנתונים -> שירות ה-Node המקומי
    location /api {
        proxy_pass http://127.0.0.1:3610;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # שאר הבקשות -> הקובץ הסטטי
    location / {
        try_files $uri $uri/ /index.html;
    }
    location ~* \.(html)$ { add_header Cache-Control "no-cache"; }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/alexander-dirot.dudi-ananalytics.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/alexander-dirot.dudi-ananalytics.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}
server {
    if ($host = alexander-dirot.dudi-ananalytics.com) { return 301 https://$host$request_uri; }
    listen 80;
    server_name alexander-dirot.dudi-ananalytics.com;
    return 404;
}
NGINX

ln -sf /etc/nginx/sites-available/alexander-dirot /etc/nginx/sites-enabled/alexander-dirot
nginx -t && systemctl reload nginx
echo "   ✅ nginx נטען מחדש"

echo ""
echo "============================================"
echo "✅ ה-Backend פעיל. בדיקת עשן:"
curl -s "http://127.0.0.1:$PORT/api?key=f11fad687d3005d8a75809c0dcf84fc782568f34" && echo ""
echo "============================================"
