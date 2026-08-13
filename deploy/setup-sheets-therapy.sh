#!/bin/bash
# ============================================================
#  חיבור "פסיכולוגיה מסילות" לגוגל שיטס — דרך Apps Script
#
#  לפני כן: פתח גיליון, הדבק את therapy-sheets-AppsScript.gs,
#  קבע SECRET, פרוס כ-Web app והעתק את כתובת ה-/exec.
#
#  ואז כאן:
#     sudo bash setup-sheets-therapy.sh "<כתובת /exec>" "<הסיסמה>"
# ============================================================
set -e

APP="/opt/therapy-crm/app"
SERVICE="therapy-crm"
WEBHOOK="$1"
SECRET="$2"

echo "🔗 חיבור פסיכולוגיה מסילות לגוגל שיטס"
echo "============================================"

[ -d "$APP" ] || { echo "❌ המערכת לא מותקנת ב-$APP — הרץ קודם את deploy-therapy.sh"; exit 1; }

if [ -z "$WEBHOOK" ] || [ -z "$SECRET" ]; then
  cat <<'HELP'

חסרים פרטים. כך עושים את זה:

  1. פתח גיליון חדש ב-https://sheets.google.com
  2. תוספים ▸ Apps Script  (Extensions ▸ Apps Script)
  3. מחק את הקוד הקיים והדבק את התוכן של:
     https://raw.githubusercontent.com/dudi98722-bot/project-management/main/therapy-sheets-AppsScript.gs
  4. בשורה  var SECRET = '...'  שים טקסט אקראי משלך ושמור 💾
  5. Deploy ▸ New deployment ▸ Web app
       Execute as: Me        |     Who has access: Anyone
     אשר הרשאות והעתק את הכתובת שמסתיימת ב-/exec
  6. חזור לכאן והרץ:

     sudo bash setup-sheets-therapy.sh "<הכתובת>" "<הסיסמה>"

HELP
  exit 1
fi

echo "$WEBHOOK" | grep -qE '^https://script\.google\.com/.*/exec$' \
  || { echo "❌ הכתובת חייבת להיות של Apps Script ולהסתיים ב-/exec"; echo "   קיבלתי: $WEBHOOK"; exit 1; }

# ---------- עדכון .env ----------
set_env() {
  if grep -q "^$1=" "$APP/.env"; then
    # ערך בתוך גרשיים כדי לשרוד רווחים ותווים מיוחדים
    python3 - "$APP/.env" "$1" "$2" <<'PY'
import sys, re
path, key, val = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(path, encoding='utf-8').read().splitlines()
out = [(key + '=' + val) if l.startswith(key + '=') else l for l in lines]
open(path, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
PY
  else
    printf '%s=%s\n' "$1" "$2" >> "$APP/.env"
  fi
}
set_env SHEETS_WEBHOOK_URL "$WEBHOOK"
set_env SHEETS_SECRET "$SECRET"
chmod 600 "$APP/.env"
echo "✔ ההגדרות נשמרו"

# ---------- בדיקת חיבור אמיתית ----------
echo "🧪 בודק חיבור לגיליון..."
cd "$APP"
set +e
OUT=$(node scripts/test_sheets.js 2>&1); RC=$?
set -e
echo "$OUT"
[ $RC -eq 0 ] || { echo ""; echo "   תקן ונסה שוב את אותה פקודה."; exit 1; }

# ---------- ייצוא ראשוני של מה שכבר במערכת ----------
echo ""
echo "📤 מייצא לגיליון את הנתונים הקיימים..."
node scripts/sync_all.js || echo "   ⚠️  הייצוא נכשל. אפשר לנסות שוב: cd $APP && node scripts/sync_all.js"

# ---------- הפעלה מחדש ----------
systemctl restart "$SERVICE"
sleep 2
echo ""
echo "============================================"
echo "✅ הסנכרון פעיל. כל שינוי במערכת יופיע בגיליון תוך שניות."
echo "============================================"
