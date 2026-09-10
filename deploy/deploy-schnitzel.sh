#!/bin/bash
# ============================================================
#  הקמת תת-הדומיינים של שניצל שף על ה-VPS + SSL
#    schnitzel-chef.dudi-ananalytics.com   — האתר הראשי
#    schnitzel-kupa.dudi-ananalytics.com   — קופה קטנה
#
#  DNS: ל-dudi-ananalytics.com יש wildcard (* -> 64.176.175.180) ולכן לא צריך כלום.
#       לדומיין אחר — חובה רשומת A לכל תת-דומיין לפני הרצה, אחרת ה-SSL ייכשל.
#
#  הרצה:  ssh root@64.176.175.180 "BASE=הדומיין-שלך bash -s" < deploy/deploy-schnitzel.sh
# ============================================================
set -e
BASE="${BASE:-dudi-ananalytics.com}"   # הדומיין הראשי — אפשר לעקוף: BASE=my-domain.com bash ...
EMAIL="${EMAIL:-dudi98722@gmail.com}"

setup_site () {
  local SLUG="$1" DOMAIN="$2" TITLE="$3"
  local WEBROOT="/var/www/$SLUG"

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
align-items:center;justify-content:center;background:#F0EFE8;color:#1A1A1A;padding:24px}
.card{background:#fff;border-radius:20px;padding:48px 40px;text-align:center;
box-shadow:0 20px 60px rgba(0,0,0,.10);max-width:440px;width:100%;
border-top:6px solid #F5C800}
h1{font-size:26px;font-weight:800;color:#4A4A2A;margin-bottom:10px}
p{font-size:16px;color:#6B6B3A;line-height:1.7}
.dom{margin-top:22px;font-size:13px;color:#9B9B8A;direction:ltr;
font-family:ui-monospace,monospace}
</style>
</head>
<body>
<div class="card">
<h1>$TITLE</h1>
<p>תת-הדומיין פעיל ומאובטח.<br>התוכן יעלה לכאן בקרוב.</p>
<div class="dom">$DOMAIN</div>
</div>
</body>
</html>
EOHTML
    echo "  [+] placeholder created"
  else
    echo "  [=] index.html already exists, kept as is"
  fi

  cat > "/etc/nginx/sites-available/$SLUG" <<EONGINX
server {
    listen 80;
    server_name $DOMAIN;

    root $WEBROOT;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location ~* \.(html)\$ {
        add_header Cache-Control "no-cache";
    }
}
EONGINX

  ln -sf "/etc/nginx/sites-available/$SLUG" "/etc/nginx/sites-enabled/$SLUG"
  echo "  [+] nginx site configured"
}

setup_site "schnitzel-chef" "schnitzel-chef.$BASE" "שניצל שף"
setup_site "schnitzel-kupa" "schnitzel-kupa.$BASE" "שניצל שף — קופה קטנה"

nginx -t && systemctl reload nginx
echo "[+] nginx reloaded"

for D in "schnitzel-chef.$BASE" "schnitzel-kupa.$BASE"; do
  echo "=== SSL for $D ==="
  certbot --nginx -d "$D" --non-interactive --agree-tos -m "$EMAIL" --redirect \
    || echo "  [!] SSL failed for $D"
done

nginx -t && systemctl reload nginx
echo "[+] DONE"
