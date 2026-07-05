"""
העלאת תיקיית סינומקס לגוגל דרייב + בניית Google Sheets מסודר
הרץ פעם אחת — ייפתח חלון דפדפן לאישור הרשאות
"""

import os
import sys
import json
import re
from pathlib import Path
from datetime import datetime

# ── בדיקת חבילות ──────────────────────────────────────────────────
def check_and_install(packages):
    import subprocess
    for pkg, import_name in packages:
        try:
            __import__(import_name)
        except ImportError:
            print(f"מתקין {pkg}...")
            subprocess.check_call([sys.executable, "-m", "pip", "install", pkg, "-q"])

check_and_install([
    ("google-auth-oauthlib", "google_auth_oauthlib"),
    ("google-api-python-client", "googleapiclient"),
    ("google-auth-httplib2", "google_auth_httplib2"),
])

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
import pickle

# ── הגדרות ────────────────────────────────────────────────────────
SOURCE_FOLDER = Path(r"C:\Users\בונים ומוגנים\OneDrive\שולחן העבודה\קלוד\סינו")
DRIVE_FOLDER_NAME = "סינומקס - מסמכים 2026"
SHEET_NAME = "סינומקס - ניהול מסמכים"
SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
]
TOKEN_FILE = "token_sino.pickle"
CREDS_FILE = "credentials.json"

# ── סיווג קבצים ───────────────────────────────────────────────────
def classify_file(filename):
    name = filename.lower()
    base = Path(filename).stem.lower()

    # חשבוניות מס
    if any(x in name for x in ["tax_invoice", "חשבונית מס", "חשבונית_מס", "hashdoc"]):
        return "חשבוניות מס"
    if any(x in name for x in ["חשבונית 5", "חשבונית 6", "חשבונית_מס_קבלה"]):
        return "חשבוניות מס"
    # חשבוניות ממוספרות (50xxx, 60xxx, 61xxx, 70xxx)
    if re.match(r"^(50|60|61|70)\d+", Path(filename).stem):
        return "חשבוניות מס"
    # מס הקצאה
    if "מס הקצאה" in name or "הקצאה" in name:
        return "מס הקצאה"
    # קבלות
    if any(x in name for x in ["receipt", "קבלה"]):
        return "קבלות"
    # פרופורמות
    if "proforma" in name:
        return "פרופורמות"
    # כרטסות
    if "כרטסת" in name:
        return "כרטסות"
    # תמונות / צ'קים (WhatsApp, CamScanner, IMG)
    ext = Path(filename).suffix.lower()
    if ext in [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"]:
        return "תמונות וצ'קים"
    if any(x in name for x in ["whatsapp", "camscanner", "scanned", "img_", "img-"]):
        return "תמונות וצ'קים"
    # אקסל
    if ext in [".xlsx", ".xls", ".csv"]:
        return "קבצי אקסל"
    # אחר
    return "אחר"

def extract_doc_number(filename):
    """מנסה לחלץ מספר מסמך משם הקובץ"""
    stem = Path(filename).stem
    # מחפש מספרים בשם
    nums = re.findall(r'\d{4,}', stem)
    return nums[0] if nums else ""

def get_file_date(filepath):
    """תאריך שינוי קובץ"""
    ts = os.path.getmtime(filepath)
    return datetime.fromtimestamp(ts).strftime("%d/%m/%Y")

# ── אימות Google ──────────────────────────────────────────────────
def get_credentials():
    creds = None
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, "rb") as f:
            creds = pickle.load(f)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(CREDS_FILE):
                print(f"""
❌ חסר קובץ {CREDS_FILE}!

הוראות להורדת credentials.json:
1. כנס ל: console.cloud.google.com
2. צור פרויקט חדש (או בחר קיים)
3. APIs & Services → Enable APIs:
   - Google Drive API
   - Google Sheets API
4. APIs & Services → Credentials → Create Credentials → OAuth client ID
5. Application type: Desktop app
6. הורד את הקובץ → שמור אותו כ-credentials.json באותה תיקייה עם הסקריפט
""")
                sys.exit(1)

            flow = InstalledAppFlow.from_client_secrets_file(CREDS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)

        with open(TOKEN_FILE, "wb") as f:
            pickle.dump(creds, f)

    return creds

# ── Drive: יצירת תיקייה ───────────────────────────────────────────
def create_drive_folder(drive_service, name, parent_id=None):
    meta = {
        "name": name,
        "mimeType": "application/vnd.google-apps.folder",
    }
    if parent_id:
        meta["parents"] = [parent_id]
    folder = drive_service.files().create(body=meta, fields="id,webViewLink").execute()
    return folder["id"], folder["webViewLink"]

def create_subfolder(drive_service, name, parent_id):
    return create_drive_folder(drive_service, name, parent_id)

# ── Drive: העלאת קובץ ─────────────────────────────────────────────
MIME_MAP = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".csv": "text/csv",
    ".gif": "image/gif",
}

def upload_file(drive_service, filepath, parent_id):
    filename = filepath.name
    ext = filepath.suffix.lower()
    mime = MIME_MAP.get(ext, "application/octet-stream")

    meta = {"name": filename, "parents": [parent_id]}
    media = MediaFileUpload(str(filepath), mimetype=mime, resumable=True)
    file = drive_service.files().create(
        body=meta, media_body=media, fields="id,webViewLink,name"
    ).execute()
    return file["id"], file["webViewLink"]

# ── Sheets: בניית הגיליון ─────────────────────────────────────────
SHEET_COLORS = {
    "חשבוניות מס":    {"red": 0.18, "green": 0.46, "blue": 0.78},
    "קבלות":          {"red": 0.18, "green": 0.66, "blue": 0.44},
    "פרופורמות":      {"red": 0.58, "green": 0.28, "blue": 0.73},
    "מס הקצאה":      {"red": 0.93, "green": 0.60, "blue": 0.15},
    "כרטסות":         {"red": 0.53, "green": 0.53, "blue": 0.53},
    "תמונות וצ'קים": {"red": 0.82, "green": 0.37, "blue": 0.30},
    "קבצי אקסל":     {"red": 0.20, "green": 0.55, "blue": 0.30},
    "אחר":            {"red": 0.60, "green": 0.60, "blue": 0.60},
    "סיכום":          {"red": 0.13, "green": 0.13, "blue": 0.13},
}

HEADERS = ["#", "שם קובץ", "מספר מסמך", "תאריך קובץ", "קישור לדרייב", "קטגוריה", "הערות"]

def create_spreadsheet(sheets_service, title):
    body = {"properties": {"title": title, "locale": "he_IL"}}
    ss = sheets_service.spreadsheets().create(body=body, fields="spreadsheetId,spreadsheetUrl").execute()
    return ss["spreadsheetId"], ss["spreadsheetUrl"]

def add_sheet_tab(sheets_service, ss_id, title, color_rgb):
    req = {
        "addSheet": {
            "properties": {
                "title": title,
                "tabColor": color_rgb,
            }
        }
    }
    sheets_service.spreadsheets().batchUpdate(
        spreadsheetId=ss_id,
        body={"requests": [req]}
    ).execute()
    # Return the new sheet id
    ss = sheets_service.spreadsheets().get(spreadsheetId=ss_id).execute()
    for s in ss["sheets"]:
        if s["properties"]["title"] == title:
            return s["properties"]["sheetId"]
    return None

def format_header(sheets_service, ss_id, sheet_id, color_rgb, num_cols):
    requests = [
        # כותרות מודגשות עם רקע
        {
            "repeatCell": {
                "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1},
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColor": color_rgb,
                        "textFormat": {"bold": True, "foregroundColor": {"red": 1, "green": 1, "blue": 1}, "fontSize": 11},
                        "horizontalAlignment": "CENTER",
                    }
                },
                "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
            }
        },
        # הקפאת שורה ראשונה
        {"updateSheetProperties": {"properties": {"sheetId": sheet_id, "gridProperties": {"frozenRowCount": 1}}, "fields": "gridProperties.frozenRowCount"}},
        # RTL
        {"updateSheetProperties": {"properties": {"sheetId": sheet_id, "rightToLeft": True}, "fields": "rightToLeft"}},
        # הרחב עמודת שם קובץ (עמודה B = index 1)
        {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 1, "endIndex": 2}, "properties": {"pixelSize": 280}, "fields": "pixelSize"}},
        # עמודת קישור (E = index 4)
        {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 4, "endIndex": 5}, "properties": {"pixelSize": 80}, "fields": "pixelSize"}},
    ]
    sheets_service.spreadsheets().batchUpdate(
        spreadsheetId=ss_id,
        body={"requests": requests}
    ).execute()

def write_rows(sheets_service, ss_id, sheet_title, rows):
    if not rows:
        return
    sheets_service.spreadsheets().values().append(
        spreadsheetId=ss_id,
        range=f"'{sheet_title}'!A2",
        valueInputOption="USER_ENTERED",
        body={"values": rows},
    ).execute()

def write_header(sheets_service, ss_id, sheet_title, headers):
    sheets_service.spreadsheets().values().update(
        spreadsheetId=ss_id,
        range=f"'{sheet_title}'!A1",
        valueInputOption="USER_ENTERED",
        body={"values": [headers]},
    ).execute()

# ── ראשי ──────────────────────────────────────────────────────────
def main():
    print("🔐 מתחבר לגוגל...")
    creds = get_credentials()
    drive = build("drive", "v3", credentials=creds)
    sheets = build("sheets", "v4", credentials=creds)

    # ── איסוף קבצים ──
    all_files = [f for f in SOURCE_FOLDER.iterdir() if f.is_file()]
    print(f"📁 נמצאו {len(all_files)} קבצים בתיקייה")

    # ── סיווג ──
    categorized = {}
    for f in all_files:
        cat = classify_file(f.name)
        categorized.setdefault(cat, []).append(f)

    print("\n📊 סיווג קבצים:")
    for cat, files in sorted(categorized.items()):
        print(f"  {cat}: {len(files)} קבצים")

    # ── יצירת תיקיית Drive ──
    print(f"\n📂 יוצר תיקייה בדרייב: {DRIVE_FOLDER_NAME}")
    main_folder_id, main_folder_url = create_drive_folder(drive, DRIVE_FOLDER_NAME)
    print(f"✅ תיקייה נוצרה: {main_folder_url}")

    # ── יצירת תת-תיקיות והעלאה ──
    uploaded = {}  # cat -> list of (filename, doc_num, date, link)
    subfolders = {}

    for cat, files in categorized.items():
        print(f"\n📤 מעלה: {cat} ({len(files)} קבצים)...")
        sub_id, _ = create_subfolder(drive, cat, main_folder_id)
        subfolders[cat] = sub_id

        uploaded[cat] = []
        for i, filepath in enumerate(files, 1):
            try:
                file_id, file_url = upload_file(drive, filepath, sub_id)
                doc_num = extract_doc_number(filepath.name)
                date = get_file_date(filepath)
                uploaded[cat].append((i, filepath.name, doc_num, date, file_url, cat, ""))
                print(f"  ✅ {i}/{len(files)}: {filepath.name}")
            except Exception as e:
                print(f"  ❌ שגיאה ב-{filepath.name}: {e}")
                uploaded[cat].append((i, filepath.name, "", "", "שגיאה בהעלאה", cat, str(e)))

    # ── יצירת Google Sheets ──
    print(f"\n📊 יוצר גיליון: {SHEET_NAME}")
    ss_id, ss_url = create_spreadsheet(sheets, SHEET_NAME)

    # קבל את ה-sheet הראשון שנוצר אוטומטית (Sheet1)
    ss_info = sheets.spreadsheets().get(spreadsheetId=ss_id).execute()
    default_sheet_id = ss_info["sheets"][0]["properties"]["sheetId"]
    default_sheet_title = ss_info["sheets"][0]["properties"]["title"]

    # ── גיליון סיכום ──
    summary_color = SHEET_COLORS["סיכום"]
    # שנה שם ל"סיכום"
    sheets.spreadsheets().batchUpdate(
        spreadsheetId=ss_id,
        body={"requests": [{"updateSheetProperties": {
            "properties": {"sheetId": default_sheet_id, "title": "סיכום", "tabColor": summary_color, "rightToLeft": True},
            "fields": "title,tabColor,rightToLeft"
        }}]}
    ).execute()

    # כתוב לגיליון הסיכום
    total = sum(len(v) for v in uploaded.values())
    summary_data = [
        ["סינומקס — סיכום מסמכים", "", "", ""],
        ["תאריך עדכון:", datetime.now().strftime("%d/%m/%Y %H:%M"), "", ""],
        ["סה״כ קבצים:", total, "", ""],
        ["קישור לתיקיית דרייב:", main_folder_url, "", ""],
        ["", "", "", ""],
        ["קטגוריה", "מספר קבצים", "קישור לתת-תיקייה", ""],
    ]
    for cat, files in sorted(categorized.items()):
        sub_url = f"https://drive.google.com/drive/folders/{subfolders.get(cat, '')}"
        summary_data.append([cat, len(files), sub_url, ""])

    sheets.spreadsheets().values().update(
        spreadsheetId=ss_id,
        range="'סיכום'!A1",
        valueInputOption="USER_ENTERED",
        body={"values": summary_data},
    ).execute()

    # עיצוב גיליון סיכום
    sheets.spreadsheets().batchUpdate(
        spreadsheetId=ss_id,
        body={"requests": [
            {"repeatCell": {
                "range": {"sheetId": default_sheet_id, "startRowIndex": 0, "endRowIndex": 1},
                "cell": {"userEnteredFormat": {
                    "textFormat": {"bold": True, "fontSize": 16, "foregroundColor": {"red": 1, "green": 1, "blue": 1}},
                    "backgroundColor": summary_color,
                }},
                "fields": "userEnteredFormat(textFormat,backgroundColor)",
            }},
            {"repeatCell": {
                "range": {"sheetId": default_sheet_id, "startRowIndex": 5, "endRowIndex": 6},
                "cell": {"userEnteredFormat": {
                    "textFormat": {"bold": True},
                    "backgroundColor": {"red": 0.85, "green": 0.85, "blue": 0.85},
                }},
                "fields": "userEnteredFormat(textFormat,backgroundColor)",
            }},
        ]}
    ).execute()

    # ── גיליון לכל קטגוריה ──
    for cat, rows in uploaded.items():
        if not rows:
            continue
        color = SHEET_COLORS.get(cat, SHEET_COLORS["אחר"])
        print(f"  📋 יוצר גיליון: {cat}")
        sheet_id = add_sheet_tab(sheets, ss_id, cat, color)
        write_header(sheets, ss_id, cat, HEADERS)
        format_header(sheets, ss_id, sheet_id, color, len(HEADERS))

        # המר tuple לרשימה עם hyperlink לקישור
        sheet_rows = []
        for row in rows:
            idx, name, doc_num, date, url, category, notes = row
            if url and url.startswith("http"):
                link_formula = f'=HYPERLINK("{url}","פתח")'
            else:
                link_formula = url
            sheet_rows.append([idx, name, doc_num, date, link_formula, category, notes])

        write_rows(sheets, ss_id, cat, sheet_rows)

    print(f"""
╔══════════════════════════════════════════════════════════╗
║           ✅  הושלם בהצלחה!                              ║
╠══════════════════════════════════════════════════════════╣
║  📂 תיקיית Drive:                                        ║
║  {main_folder_url[:55]}
║                                                          ║
║  📊 Google Sheets:                                       ║
║  {ss_url[:55]}
╚══════════════════════════════════════════════════════════╝
""")

    # שמור URLs לקובץ
    with open("sino_links.txt", "w", encoding="utf-8") as f:
        f.write(f"תיקיית Drive:\n{main_folder_url}\n\nGoogle Sheets:\n{ss_url}\n")
    print("🔗 הקישורים נשמרו בקובץ sino_links.txt")

if __name__ == "__main__":
    main()
