#!/bin/bash
# ============================================================
#  חיבור "פסיכולוגיה מסילות" ל-Google Sheets — בפקודה אחת
#
#  שלב 1 (בלי פרמטרים) — מוצא חשבון שירות קיים ומראה למי לשתף את הגיליון:
#     sudo bash setup-sheets-therapy.sh
#
#  שלב 2 (עם מזהה הגיליון) — מחבר, מפעיל מחדש ובודק:
#     sudo bash setup-sheets-therapy.sh 1AbC...XyZ
#
#  אפשר גם להצביע על קובץ חשבון שירות ספציפי:
#     sudo SA=/root/my-key.json bash setup-sheets-therapy.sh 1AbC...XyZ
# ============================================================
set -e

APP="/opt/therapy-crm/app"
SERVICE="therapy-crm"
TARGET="$APP/service-account.json"
SHEET_ID="$1"

echo "🔗 חיבור פסיכולוגיה מסילות ל-Google Sheets"
echo "============================================"

[ -d "$APP" ] || { echo "❌ המערכת לא מותקנת ב-$APP — הרץ קודם את deploy-therapy.sh"; exit 1; }

# ---------- 1. איתור קובץ חשבון שירות ----------
if [ -n "$SA" ]; then
  [ -f "$SA" ] || { echo "❌ הקובץ שציינת לא קיים: $SA"; exit 1; }
  FOUND="$SA"
elif [ -f "$TARGET" ]; then
  FOUND="$TARGET"
  echo "✔ נמצא חשבון שירות שכבר מוגדר במערכת"
else
  echo "🔎 מחפש חשבון שירות במערכות אחרות על השרת..."
  # מיון לפי תאריך שינוי — החדש ביותר ראשון
  mapfile -t CANDIDATES < <(find /opt /root -maxdepth 4 -name 'service-account*.json' \
                            -not -path "*/node_modules/*" -printf '%T@ %p\n' 2>/dev/null \
                            | sort -rn | cut -d' ' -f2-)
  if [ ${#CANDIDATES[@]} -eq 0 ]; then
    echo ""
    echo "❌ לא נמצא אף קובץ חשבון שירות על השרת."
    echo ""
    echo "   אם יש לך קובץ כזה במחשב, העלה אותו והרץ שוב. מ-PowerShell במחשב שלך:"
    echo "     scp \"\$env:USERPROFILE\\Downloads\\service-account.json\" root@64.176.175.180:$TARGET"
    echo ""
    echo "   אם אין לך בכלל — צריך ליצור אחד פעם אחת בגוגל קלאוד (ראה GOOGLE-SETUP.md)."
    exit 1
  fi
  FOUND="${CANDIDATES[0]}"
  echo "✔ נמצאו ${#CANDIDATES[@]} קבצים. משתמש בעדכני ביותר:"
  for c in "${CANDIDATES[@]}"; do
    [ "$c" = "$FOUND" ] && echo "   → $c  (נבחר)" || echo "     $c"
  done
  [ ${#CANDIDATES[@]} -gt 1 ] && echo "   (לבחירה אחרת: sudo SA=/נתיב/לקובץ bash setup-sheets-therapy.sh $SHEET_ID)"
fi

# ---------- 2. אימות והעתקה ----------
EMAIL=$(grep -o '"client_email"[[:space:]]*:[[:space:]]*"[^"]*"' "$FOUND" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
[ -n "$EMAIL" ] || { echo "❌ הקובץ $FOUND אינו חשבון שירות תקין (חסר client_email)"; exit 1; }

if [ "$FOUND" != "$TARGET" ]; then
  cp "$FOUND" "$TARGET"
  echo "✔ הקובץ הועתק ל-$TARGET"
fi
chmod 600 "$TARGET"

# ---------- 3. בלי מזהה גיליון — עוצרים ומסבירים ----------
if [ -z "$SHEET_ID" ]; then
  echo ""
  echo "============================================"
  echo "📋 נשארו לך שני דברים:"
  echo ""
  echo "1. פתח גיליון חדש ב-https://sheets.google.com"
  echo "   לחץ Share ושתף אותו עם הכתובת הזו, בהרשאת Editor:"
  echo ""
  echo "      $EMAIL"
  echo ""
  echo "2. העתק את המזהה מכתובת הגיליון והרץ שוב איתו:"
  echo "   https://docs.google.com/spreadsheets/d/<המזהה כאן>/edit"
  echo ""
  echo "      sudo bash setup-sheets-therapy.sh <המזהה>"
  echo "============================================"
  exit 0
fi

# ---------- 4. עדכון .env ----------
echo "$SHEET_ID" | grep -qE '^[A-Za-z0-9_-]{20,}$' \
  || { echo "❌ '$SHEET_ID' לא נראה כמו מזהה גיליון. העתק רק את החלק שבין /d/ ל-/edit"; exit 1; }

if grep -q '^BACKUP_SHEET_ID=' "$APP/.env"; then
  sed -i "s|^BACKUP_SHEET_ID=.*|BACKUP_SHEET_ID=$SHEET_ID|" "$APP/.env"
else
  echo "BACKUP_SHEET_ID=$SHEET_ID" >> "$APP/.env"
fi
grep -q '^GOOGLE_SERVICE_ACCOUNT_FILE=' "$APP/.env" \
  || echo "GOOGLE_SERVICE_ACCOUNT_FILE=./service-account.json" >> "$APP/.env"
echo "✔ ההגדרות עודכנו"

# ---------- 5. בדיקת חיבור אמיתית ----------
echo "🧪 בודק חיבור לגיליון..."
cd "$APP"
set +e
OUT=$(node scripts/test_sheets.js 2>&1); RC=$?
set -e
echo "$OUT"
if [ $RC -ne 0 ]; then
  echo ""
  echo "   ודא ששיתפת את הגיליון עם:  $EMAIL   (הרשאת Editor)"
  echo "   אחרי התיקון הרץ שוב את אותה פקודה."
  exit 1
fi

# ---------- 6. הפעלה מחדש ----------
systemctl restart "$SERVICE"
sleep 2
echo ""
echo "============================================"
echo "✅ הסנכרון פעיל. כל שינוי במערכת יופיע בגיליון תוך שניות."
echo "   https://docs.google.com/spreadsheets/d/$SHEET_ID/edit"
echo "============================================"
