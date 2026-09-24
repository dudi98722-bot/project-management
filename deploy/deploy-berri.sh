#!/bin/bash
# ============================================================
#  BERRI — ניהול פרוייקטים: הקמת תת-הדומיין על ה-VPS + SSL
#    berri.dudi-ananalytics.com
#
#  DNS: ל-dudi-ananalytics.com יש wildcard (* -> 64.176.175.180) ולכן לא צריך כלום.
#
#  הרצה (מ-PowerShell):
#    scp deploy/deploy-berri.sh root@64.176.175.180:/tmp/
#    ssh root@64.176.175.180 "bash /tmp/deploy-berri.sh"
#
#  עדכון המערכת עצמה (אחרי push) — לפי SHA של הקומיט, לא main (יש CDN cache):
#    curl -fsSL https://raw.githubusercontent.com/dudi98722-bot/project-management/<SHA>/berri-projects.html -o /var/www/berri/index.html
# ============================================================
set -e
DOMAIN="${DOMAIN:-berri.dudi-ananalytics.com}"
EMAIL="${EMAIL:-dudi98722@gmail.com}"
SLUG="berri"
WEBROOT="/var/www/$SLUG"
TITLE="BERRI — ניהול פרוייקטים"

echo "=== $DOMAIN ==="
mkdir -p "$WEBROOT"

if [ ! -s "$WEBROOT/index.html" ]; then
  cat > "$WEBROOT/index.html" <<EOHTML
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>$TITLE</title>
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Heebo',system-ui,sans-serif;min-height:100vh;display:flex;
align-items:center;justify-content:center;background:#f5f6fa;color:#1c2130;padding:24px}
.card{background:#fff;border-radius:20px;padding:48px 40px;text-align:center;
box-shadow:0 20px 60px rgba(15,22,66,.12);max-width:440px;width:100%;
border-top:6px solid #CC6A29}
h1{font-size:26px;font-weight:800;color:#0F1642;margin-bottom:10px}
p{font-size:16px;color:#6b7280;line-height:1.7}
.dom{margin-top:22px;font-size:13px;color:#9ca3af;direction:ltr;
font-family:ui-monospace,monospace}
</style>
</head>
<body>
<div class="card">
<h1>$TITLE</h1>
<p>תת-הדומיין פעיל ומאובטח.<br>המערכת תעלה לכאן בקרוב.</p>
<div class="dom">$DOMAIN</div>
</div>
</body>
</html>
EOHTML
  echo "  [+] placeholder created"
else
  echo "  [=] index.html already exists, kept as is"
fi

# הרצה חוזרת לא דורסת את ההגדרה — certbot כבר הוסיף לה את בלוק ה-SSL
if [ -f "/etc/nginx/sites-available/$SLUG" ]; then
  echo "  [=] nginx site exists, kept as is"
else
cat > "/etc/nginx/sites-available/$SLUG" <<EONGINX
server {
    listen 80;
    server_name $DOMAIN;

    root $WEBROOT;
    index index.html;

    location = /manifest.webmanifest { default_type application/manifest+json; }
    location = /sw.js { add_header Cache-Control "no-cache"; }

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location ~* \.(html)\$ {
        add_header Cache-Control "no-cache";
    }
}
EONGINX
  echo "  [+] nginx site configured"
fi

ln -sf "/etc/nginx/sites-available/$SLUG" "/etc/nginx/sites-enabled/$SLUG"

nginx -t && systemctl reload nginx
echo "[+] nginx reloaded"

echo "=== SSL for $DOMAIN ==="
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect \
    || echo "  [!] SSL failed for $DOMAIN"
else
  echo "  [=] certificate exists — skipping"
fi

nginx -t && systemctl reload nginx
echo "[+] DONE  https://$DOMAIN"
