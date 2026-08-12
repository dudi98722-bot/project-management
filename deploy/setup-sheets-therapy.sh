#!/bin/bash
# ============================================================
#  חיבור "פסיכולוגיה מסילות" ל-Google Sheets
#
#  הדרך הקצרה — הסקריפט יוצר את הגיליון ונותן לך אליו גישה, בלי שיתוף ידני:
#     sudo bash setup-sheets-therapy.sh --create you@gmail.com
#
#  הדרך השנייה — גיליון שיצרת בעצמך ושיתפת עם חשבון השירות:
#     sudo bash setup-sheets-therapy.sh "https://docs.google.com/spreadsheets/d/1AbC.../edit"
#
#  בלי פרמטרים — מציג את כתובת חשבון השירות (למי לשתף) ואת שתי האפשרויות:
#     sudo bash setup-sheets-therapy.sh
#
#  אפשר גם להצביע על קובץ חשבון שירות ספציפי:
#     sudo SA=/root/my-key.json bash setup-sheets-therapy.sh --create you@gmail.com
# ============================================================
set -e

APP="/opt/therapy-crm/app"
SERVICE="therapy-crm"
TARGET="$APP/service-account.json"

CREATE_FOR=""
if [ "$1" = "--create" ]; then
  CREATE_FOR="$2"
  [ -n "$CREATE_FOR" ] || { echo "❌ חסרה כתובת מייל: sudo bash setup-sheets-therapy.sh --create you@gmail.com"; exit 1; }
  SHEET_ID=""
else
  # מקבל קישור מלא לגיליון או מזהה בלבד — מחלץ את המזהה בכל מקרה
  SHEET_ID=$(echo "$1" | sed -E 's|.*/spreadsheets/d/([A-Za-z0-9_-]+).*|\1|')
fi

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

# ---------- 3. יצירת גיליון אוטומטית ----------
if [ -n "$CREATE_FOR" ]; then
  echo "📄 יוצר גיליון חדש ונותן גישה ל-$CREATE_FOR ..."
  cd "$APP"
  set +e
  SHEET_ID=$(node scripts/create_sheet.js "$CREATE_FOR"); RC=$?
  set -e
  if [ $RC -ne 0 ] || [ -z "$SHEET_ID" ]; then
    echo ""
    echo "   אפשר במקום זה ליצור גיליון ידנית, לשתף אותו עם $EMAIL (הרשאת Editor),"
    echo "   ואז להריץ:  sudo bash setup-sheets-therapy.sh \"<הקישור לגיליון>\""
    exit 1
  fi
fi

# ---------- 4. בלי מזהה גיליון — מציגים את שתי האפשרויות ----------
if [ -z "$SHEET_ID" ]; then
  echo ""
  echo "============================================"
  echo "בחר איך להמשיך:"
  echo ""
  echo "▸ הדרך הקצרה — הסקריפט יוצר את הגיליון ונותן לך גישה (בלי שיתוף ידני):"
  echo ""
  echo "      sudo bash setup-sheets-therapy.sh --create המייל_שלך@gmail.com"
  echo ""
  echo "▸ אם אתה מעדיף ליצור את הגיליון בעצמך:"
  echo "  פתח גיליון ב-https://sheets.google.com, לחץ Share ושתף עם הכתובת הזו"
  echo "  בהרשאת Editor:"
  echo ""
  echo "      $EMAIL"
  echo ""
  echo "  ואז הרץ עם הקישור לגיליון (במרכאות):"
  echo ""
  echo "      sudo bash setup-sheets-therapy.sh \"<הדבק כאן את הקישור>\""
  echo "============================================"
  exit 0
fi

# ---------- 5. עדכון .env ----------
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

# ---------- 6. בדיקת חיבור אמיתית ----------
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

# ---------- 7. הפעלה מחדש ----------
systemctl restart "$SERVICE"
sleep 2
echo ""
echo "============================================"
echo "✅ הסנכרון פעיל. כל שינוי במערכת יופיע בגיליון תוך שניות."
echo "   https://docs.google.com/spreadsheets/d/$SHEET_ID/edit"
[ -n "$CREATE_FOR" ] && echo "   (הגיליון משותף איתך — תמצא אותו ב-Google Drive תחת 'Shared with me')"
echo "============================================"
