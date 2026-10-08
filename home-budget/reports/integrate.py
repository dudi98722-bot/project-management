"""מכניס את הדוחות (rep-*.js / rep-*.css) ל-home-budget/index.html. אפשר להריץ שוב — מחליף בין הסמנים."""
import io, os, sys, re

REP = os.path.dirname(os.path.abspath(__file__))
INDEX = sys.argv[1]
ORDER = ['pace', 'heatcal', 'fixflex', 'lastyear', 'savings', 'maaser', 'subs', 'sinking']

def rd(f):
    return io.open(os.path.join(REP, f), encoding='utf-8').read()

s = io.open(INDEX, encoding='utf-8').read()

css_files = ['rep-kit.css'] + [f'rep-{k}.css' for k in ORDER if os.path.exists(os.path.join(REP, f'rep-{k}.css'))]
js_files = ['rep-kit.js'] + [f'rep-{k}.js' for k in ORDER] + ['rep-router.js']
extra = sorted(f for f in os.listdir(REP) if re.match(r'^rep-.+\.js$', f) and f not in js_files)
assert not extra, ('דוחות שלא ברשימה', extra)

CSS_A, CSS_B = '/* ===== דוחות: התחלה (נבנה מ-rep-*.css) ===== */', '/* ===== דוחות: סוף ===== */'
JS_A, JS_B = '/* ===== דוחות: התחלה (נבנה מ-rep-*.js) ===== */', '/* ===== דוחות: סוף ===== */\n'

css = CSS_A + '\n' + '\n'.join(f'/* --- {f} --- */\n' + rd(f).strip() + '\n' for f in css_files) + CSS_B + '\n'
# כל קובץ עטוף ב-try: חריגה בזמן טעינה של דוח אחד לא עוצרת את boot() של כל האפליקציה
js = JS_A + '\n' + '\n'.join(f'/* --- {f} --- */\ntry{{\n' + rd(f).strip() +
                             f'\n}}catch(e){{ console.error("report load {f}", e); }}\n' for f in js_files) + JS_B
for bad in ('</script', '</style', '<!--'):
    assert bad not in css.lower() and bad not in js.lower(), bad

def put(s, a, b, block, anchor, before=True):
    if a in s:
        i = s.index(a); j = s.index(b, i) + len(b)
        return s[:i] + block + s[j:]
    assert s.count(anchor) == 1, ('anchor', anchor[:50], s.count(anchor))
    k = s.index(anchor)
    return s[:k] + block + s[k:] if before else s[:k + len(anchor)] + block + s[k + len(anchor):]

s = put(s, CSS_A, CSS_B + '\n', css, '</style>')
s = put(s, JS_A, JS_B, js, '/* ---------------- אתחול ---------------- */')

def once(s, old, new):
    if new in s: return s
    assert s.count(old) == 1, ('once', old[:60], s.count(old))
    return s.replace(old, new)

s = once(s, '<button data-tab="dash" class="on">📊 דשבורד</button>\n',
            '<button data-tab="dash" class="on">📊 דשבורד</button>\n    <button data-tab="reports">📈 דוחות</button>\n')
s = once(s, '<!-- ============ לסיווג ============ -->',
            '<!-- ============ דוחות ============ -->\n<section id="tab-reports"><div id="repRoot"></div></section>\n\n<!-- ============ לסיווג ============ -->')
s = once(s, "tabs:['dash','classify','tx','import','add','sources','cats','settings'] }",
            "tabs:['dash','reports','classify','tx','import','add','sources','cats','settings'] }")
s = once(s, "tabs:['dash','classify','tx','add'] }", "tabs:['dash','reports','classify','tx','add'] }")
s = once(s, "  if(name==='dash') renderDash();\n",
            "  if(name==='dash') renderDash();\n  if(name==='reports' && typeof renderReports==='function') renderReports();\n")

# שינויים מחוץ לסמנים (מסקירת הדוחות)
s = once(s, "function gotoTab(name){\n  if(!allowedTabs().includes(name)) name='dash';   // חסימה גם בניווט תכנותי\n",
            "function gotoTab(name, keepScroll){\n  if(!allowedTabs().includes(name)) name='dash';   // חסימה גם בניווט תכנותי\n"
            "  /* גרפי הדוחות לא נשארים חיים מאחורי לשונית אחרת */\n"
            "  if(name!=='reports' && window.RK && RK.destroyCharts) RK.destroyCharts();\n")
s = once(s, "  if(name==='settings') renderSettings();\n  window.scrollTo(0,0);\n}",
            "  if(name==='settings') renderSettings();\n"
            "  /* רענון אחרי סנכרון (renderAll) לא מקפיץ לראש הדף באמצע קריאה */\n"
            "  if(!keepScroll) window.scrollTo(0,0);\n}")
s = once(s, "  gotoTab(on?on.dataset.tab:'dash');\n", "  gotoTab(on?on.dataset.tab:'dash', true);\n")
s = once(s, "function catIcon(n){ const c=catByName(n); return esc((c?c.icon:'🏷️')||'🏷️').slice(0,12); }",
            "/* חותכים לפני ההברחה — חיתוך אחריה יכול להשאיר ישות שבורה */\n"
            "function catIcon(n){ const c=catByName(n); const s=String((c?c.icon:'🏷️')||'🏷️'); let g;\n"
            "  try{ g=Array.from(new Intl.Segmenter('he',{granularity:'grapheme'}).segment(s),x=>x.segment).slice(0,2).join(''); }\n"
            "  catch(e){ g=Array.from(s).slice(0,4).join(''); }\n"
            "  return esc(g); }")
s = once(s, ".kpi .sub{font-size:11.5px;color:var(--faint);margin-top:5px;text-wrap:balance}",
            ".kpi .sub{font-size:11.5px;color:var(--dim);margin-top:5px;text-wrap:balance}")

tmp = INDEX + '.tmp'
io.open(tmp, 'w', encoding='utf-8', newline='').write(s)
os.replace(tmp, INDEX)
print('integrated:', len(css), 'css chars,', len(js), 'js chars; total', len(s))
