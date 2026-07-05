"""
יוצר GIF מונפש לחתימת מייל – עטרה פלדמן
"""
from PIL import Image, ImageDraw, ImageFont
import math, os

# ── גדלים ──
W, H = 560, 110
RADIUS = 22
FRAMES = 60          # סה"כ פריימים
LOOP_FRAMES = 30     # פריימים לאנימציית shimmer חוזרת

# ── צבעים ──
BG_OUTER  = (220, 214, 232)
CARD_DARK  = (107, 97, 121)
CARD_MID   = (117, 107, 130)
CARD_LIGHT = (144, 132, 148)
WHITE      = (255, 255, 255)
WHITE_DIM  = (255, 255, 255, 170)
WHITE_FAINT= (255, 255, 255, 110)

# ── פונטים ──
FONTS_DIR = "C:/Windows/Fonts/"
def font(name, size):
    for n in [name, "arial.ttf", "Arial.ttf"]:
        try:
            return ImageFont.truetype(FONTS_DIR + n, size)
        except:
            pass
    return ImageFont.load_default()

F_NAME    = font("arialbd.ttf", 28)
F_TAG     = font("arial.ttf",   11)
F_PHONE   = font("arialbd.ttf", 13)
F_LABEL   = font("arial.ttf",   11)
F_SHIN    = font("arialbd.ttf", 46)

def lerp(a, b, t): return a + (b - a) * max(0, min(1, t))
def ease_out(t):   return 1 - (1 - t) ** 3
def ease_in_out(t):return t * t * (3 - 2 * t)

def rounded_rect(draw, xy, radius, fill):
    x0,y0,x1,y1 = xy
    draw.rectangle([x0+radius,y0, x1-radius,y1], fill=fill)
    draw.rectangle([x0,y0+radius, x1,y1-radius], fill=fill)
    draw.ellipse([x0,y0, x0+2*radius,y0+2*radius], fill=fill)
    draw.ellipse([x1-2*radius,y0, x1,y0+2*radius], fill=fill)
    draw.ellipse([x0,y1-2*radius, x0+2*radius,y1], fill=fill)
    draw.ellipse([x1-2*radius,y1-2*radius, x1,y1], fill=fill)

def draw_leaves(img, opacity):
    """עלי קישוט בפינות"""
    if opacity <= 0: return
    ov = Image.new("RGBA", img.size, (0,0,0,0))
    d  = ImageDraw.Draw(ov)
    a  = int(55 * opacity)
    col = (255,255,255,a)
    # פינה שמאל עליון
    for i, (sx,sy,ex,ey,mx,my) in enumerate([
        (2,88,48,12,10,50),
        (10,88,62,18,18,54),
        (18,90,70,26,24,58),
        (0,68,46,10,8,40),
    ]):
        d.line([(sx,sy),(mx,my),(ex,ey)], fill=col, width=max(1,int(2*opacity)))
    # פינה ימין תחתון
    for i, (sx,sy,ex,ey,mx,my) in enumerate([
        (W-2,H-88,W-48,H-12,W-10,H-50),
        (W-10,H-88,W-62,H-18,W-18,H-54),
        (W-18,H-90,W-70,H-26,W-24,H-58),
        (W-0,H-68,W-46,H-10,W-8,H-40),
    ]):
        d.line([(sx,sy),(mx,my),(ex,ey)], fill=col, width=max(1,int(2*opacity)))
    img.alpha_composite(ov)

def draw_card_bg(draw):
    """רקע הכרטיס עם גרדיאנט"""
    for x in range(W):
        t = x / W
        r = int(lerp(CARD_LIGHT[0], CARD_DARK[0], t))
        g = int(lerp(CARD_LIGHT[1], CARD_DARK[1], t))
        b = int(lerp(CARD_LIGHT[2], CARD_DARK[2], t))
        draw.line([(x, 0),(x, H)], fill=(r,g,b))

def draw_shimmer(img, phase):
    """ברק חוזר"""
    ov = Image.new("RGBA", img.size, (0,0,0,0))
    d  = ImageDraw.Draw(ov)
    cx = int(phase * (W + 120) - 60)
    for dx, alpha in [(-20,0),(0,18),(20,0)]:
        x = cx + dx
        d.line([(x-40, -10),(x+20, H+10)], fill=(255,255,255,alpha), width=30)
    img.alpha_composite(ov)

def alpha_text(img, pos, text, font, alpha, anchor="ra"):
    """כתיבת טקסט עם שקיפות"""
    ov = Image.new("RGBA", img.size, (0,0,0,0))
    d  = ImageDraw.Draw(ov)
    d.text(pos, text, font=font, fill=(255,255,255,int(alpha*255)), anchor=anchor)
    img.alpha_composite(ov)

def alpha_line(img, xy, alpha, width=1):
    ov = Image.new("RGBA", img.size, (0,0,0,0))
    d  = ImageDraw.Draw(ov)
    d.line(xy, fill=(255,255,255,int(alpha*255)), width=width)
    img.alpha_composite(ov)

def make_frame(t, shimmer_t):
    """
    t = 0..1 (אנימציית כניסה)
    shimmer_t = 0..1 (פאזה של ברק חוזר)
    """
    img = Image.new("RGBA", (W, H), BG_OUTER)

    # ── 1. כרטיס רקע ──
    card_scale = lerp(0.92, 1.0, ease_out(min(t*3, 1)))
    # בפשטות – ציור ישיר ללא scale אמיתי
    card_img = Image.new("RGBA", (W, H), (0,0,0,0))
    d = ImageDraw.Draw(card_img)
    draw_card_bg(d)
    # mask rounded
    mask = Image.new("L", (W, H), 0)
    md   = ImageDraw.Draw(mask)
    rounded_rect(md, (0,0,W-1,H-1), RADIUS, 255)
    card_img.putalpha(mask)
    card_opacity = int(255 * ease_out(min(t*4, 1)))
    card_img.putalpha(Image.fromarray(
        __import__('numpy').array(card_img.split()[3]) * card_opacity // 255
    ))
    img.alpha_composite(card_img)

    # ── 2. עלים ──
    leaf_t = ease_out(max(0, (t - 0.05) * 6))
    draw_leaves(img, leaf_t)

    # ── 3. ברק ──
    if t >= 1.0:
        draw_shimmer(img, shimmer_t)
    else:
        draw_shimmer(img, t * 0.3)

    # ── 4. לוגו ש' ──
    shin_t = ease_out(max(0, (t - 0.1) * 4))
    if shin_t > 0:
        alpha_text(img, (W-28, H//2), "ש", F_SHIN, shin_t * 0.9, anchor="rm")
        # קרל מתחת לש'
        curl_t = ease_out(max(0, (t - 0.3) * 5))
        if curl_t > 0:
            cx, cy = W - 60, H//2 + 26
            pts = []
            for i in range(int(20 * curl_t) + 1):
                p = i / 20
                px = cx + int(p * 44)
                py = cy + int(math.sin(p * math.pi) * 7)
                pts.append((px, py))
            if len(pts) >= 2:
                alpha_line(img, pts, 0.55 * curl_t, width=2)
            pts2 = []
            curl2_t = ease_out(max(0, (t - 0.4) * 5))
            for i in range(int(16 * curl2_t) + 1):
                p = i / 16
                px = cx + 4 + int(p * 30)
                py = cy + 8 + int(math.sin(p * math.pi) * 5)
                pts2.append((px, py))
            if len(pts2) >= 2:
                alpha_line(img, pts2, 0.3 * curl2_t, width=1)

    # ── 5. שם ──
    name_t = ease_out(max(0, (t - 0.28) * 5))
    if name_t > 0:
        # clip effect: reveal right-to-left
        name_full = "עטרה פלדמן"
        name_x = W - 95
        alpha_text(img, (name_x, 28), name_full, F_NAME, name_t, anchor="ra")

    # ── 6. טאגליין ──
    tag_t = ease_out(max(0, (t - 0.42) * 5))
    if tag_t > 0:
        alpha_text(img, (W - 95, 60), "להעניק בביטחון  קורסים · יעוץ · ליווי", F_TAG, tag_t * 0.7, anchor="ra")

    # ── 7. קו ──
    line_t = ease_in_out(max(0, (t - 0.5) * 6))
    if line_t > 0:
        lx_end = W - 95
        lx_start = lx_end - int(160 * line_t)
        alpha_line(img, [(lx_start, 74),(lx_end, 74)], 0.38 * line_t, width=1)

    # ── 8. טלפון ראשי ──
    ph_t = ease_out(max(0, (t - 0.58) * 6))
    if ph_t > 0:
        alpha_text(img, (W - 95, 80), "054-8598744", F_PHONE, ph_t, anchor="ra")

    # ── 9. שורות טלפון שמאל ──
    p1_t = ease_out(max(0, (t - 0.65) * 7))
    p2_t = ease_out(max(0, (t - 0.75) * 7))

    LEFT_X = 26
    if p1_t > 0:
        # שורה 1
        ov = Image.new("RGBA", img.size, (0,0,0,0))
        d2 = ImageDraw.Draw(ov)
        d2.text((LEFT_X, 32), "054-8598744", font=F_PHONE, fill=(255,255,255,int(p1_t*255)), anchor="la")
        d2.text((LEFT_X + 85, 32), ":  ליעוץ מקצועי", font=F_LABEL, fill=(255,255,255,int(p1_t*170)), anchor="la")
        img.alpha_composite(ov)
    if p2_t > 0:
        # שורה 2
        ov = Image.new("RGBA", img.size, (0,0,0,0))
        d2 = ImageDraw.Draw(ov)
        d2.text((LEFT_X, 58), "073-3579554", font=F_PHONE, fill=(255,255,255,int(p2_t*255)), anchor="la")
        d2.text((LEFT_X + 85, 58), ":  קו אמא בטוחה", font=F_LABEL, fill=(255,255,255,int(p2_t*170)), anchor="la")
        img.alpha_composite(ov)

    # המר ל-RGB
    bg = Image.new("RGB", (W, H), BG_OUTER)
    bg.paste(img, mask=img.split()[3])
    return bg


# ── בניית הפריימים ──
import numpy
frames = []
durations = []

# שלב כניסה: 50 פריימים
ENTRY = 50
for i in range(ENTRY):
    t = i / (ENTRY - 1)
    s = (i / ENTRY) * 0.4   # shimmer קל בכניסה
    frames.append(make_frame(t, s))
    durations.append(40)     # 40ms לפריים

# שלב loop – shimmer חוזר: 40 פריימים
LOOP = 40
for i in range(LOOP):
    s = i / LOOP
    frames.append(make_frame(1.0, s))
    d = 50
    # הפריים הראשון של ה-loop – עצור מעט
    if i == 0: d = 400
    durations.append(d)

# pause בסוף
for _ in range(8):
    frames.append(make_frame(1.0, 0.95))
    durations.append(80)

# ─── שמירה ───
out = r"C:\Users\בונים ומוגנים\OneDrive\שולחן העבודה\קלוד\atara-signature.gif"
frames[0].save(
    out,
    save_all=True,
    append_images=frames[1:],
    loop=0,
    duration=durations,
    optimize=False,
)
print(f"✅ נשמר: {out}")
print(f"   {len(frames)} פריימים, {os.path.getsize(out)//1024} KB")
