# -*- coding: utf-8 -*-
import fitz, os, re, json

BASE = r"C:/Users/בונים ומוגנים/OneDrive/שולחן העבודה/קלוד/זילבר/הכשרת יועצים עסקיים 1"
OUT = r"C:/Users/בונים ומוגנים/OneDrive/שולחן העבודה/קלוד/zilber-extract/docs"
os.makedirs(OUT, exist_ok=True)

def meeting_num(rel):
    m = re.search(r'מפגש\s*(\d+)', rel)
    return int(m.group(1)) if m else 999

rows = []
for root, dirs, files in os.walk(BASE):
    for fn in files:
        if fn.lower().endswith(".pdf"):
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, BASE)
            rows.append((rel, full))

rows.sort(key=lambda r: (meeting_num(r[0]), r[0]))

index = []
for i, (rel, full) in enumerate(rows, 1):
    try:
        doc = fitz.open(full)
        text = "\n".join(p.get_text("text") for p in doc)
        npages = doc.page_count
        doc.close()
    except Exception as e:
        text, npages = f"ERR {e}", 0
    name = f"doc_{i:03d}.txt"
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        f.write(text)
    index.append({"id": i, "file": name, "rel": rel.replace("\\","/"),
                  "chars": len(text), "pages": npages})

with open(os.path.join(OUT, "_INDEX.json"), "w", encoding="utf-8") as f:
    json.dump(index, f, ensure_ascii=False, indent=1)

# readable index
with open(os.path.join(OUT, "_INDEX.md"), "w", encoding="utf-8") as f:
    for r in index:
        f.write(f"- {r['file']} | pages={r['pages']} chars={r['chars']} | {r['rel']}\n")

print("done", len(index))
