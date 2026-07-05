# -*- coding: utf-8 -*-
import fitz  # PyMuPDF
import os, sys, re

BASE = r"C:/Users/בונים ומוגנים/OneDrive/שולחן העבודה/קלוד/זילבר/הכשרת יועצים עסקיים 1"
OUT = r"C:/Users/בונים ומוגנים/OneDrive/שולחן העבודה/קלוד/zilber-extract/txt"
os.makedirs(OUT, exist_ok=True)

def safe(name):
    return re.sub(r'[\\/:*?"<>|]+', '_', name)

def extract_pdf(path, outname):
    try:
        doc = fitz.open(path)
        parts = []
        for i, page in enumerate(doc):
            t = page.get_text("text")
            parts.append(t)
        doc.close()
        text = "\n".join(parts)
        with open(os.path.join(OUT, outname + ".txt"), "w", encoding="utf-8") as f:
            f.write(text)
        return len(text)
    except Exception as e:
        return f"ERR: {e}"

# Walk and extract all PDFs (skip audio). Record an index.
index = []
for root, dirs, files in os.walk(BASE):
    for fn in files:
        if fn.lower().endswith(".pdf"):
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, BASE)
            outname = safe(rel.replace(os.sep, "__")).replace(".pdf","")
            n = extract_pdf(full, outname)
            index.append((rel, outname, n))

with open(os.path.join(OUT, "_INDEX.txt"), "w", encoding="utf-8") as f:
    for rel, outname, n in index:
        f.write(f"{n}\t{outname}.txt\t<= {rel}\n")

print(f"Extracted {len(index)} PDFs")
for rel, outname, n in index[:50]:
    print(n, "\t", outname)
