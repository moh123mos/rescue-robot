"""اقتطاع الأصول من board.png إلى assets/ (Pillow + numpy + scipy).
التشغيل:  python tools/crop_assets.py
كل الاقتطاعات RGBA بحواف مموّهة (feathered) لتندمج مع الخلفية.
"""
import json, os, re
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(ROOT, "assets")
board = Image.open(os.path.join(A, "board.png")).convert("RGB")
B = np.asarray(board).astype(np.float32)
W, H = board.size


def save(img, name):
    img.save(os.path.join(A, name), optimize=True)
    print("saved", name, img.size)


def feather_rect(w, h, f):
    """قناع مستطيل بحواف ناعمة بعرض f بكسل"""
    y, x = np.mgrid[0:h, 0:w]
    d = np.minimum.reduce([x, y, w - 1 - x, h - 1 - y]).astype(np.float32)
    return np.clip(d / f, 0, 1)


def feather_ellipse(w, h, f):
    y, x = np.mgrid[0:h, 0:w]
    cx, cy = (w - 1) / 2, (h - 1) / 2
    r = np.sqrt(((x - cx) / (w / 2)) ** 2 + ((y - cy) / (h / 2)) ** 2)
    return np.clip((1 - r) * (min(w, h) / 2) / f, 0, 1)


def crop_rgba(box, mask=None, feather=8, ellipse=False):
    x0, y0, x1, y1 = box
    c = np.asarray(board.crop(box)).astype(np.uint8)
    h, w = c.shape[:2]
    if mask is None:
        mask = feather_ellipse(w, h, feather) if ellipse else feather_rect(w, h, feather)
    a = (mask * 255).astype(np.uint8)
    return Image.fromarray(np.dstack([c, a]), "RGBA")


def diffuse_inpaint(arr, hole, iters=400, noise=6.0, seed=1):
    """ملء المنطقة المحذوفة بانتشار لوني + ضجيج يطابق النسيج المحيط"""
    out = arr.copy()
    hole = hole.astype(bool)
    # بداية: متوسط الحافة
    ring = ndi.binary_dilation(hole, iterations=6) & ~hole
    for c in range(3):
        out[..., c][hole] = out[..., c][ring].mean()
    k = np.array([[0, 1, 0], [1, 0, 1], [0, 1, 0]], np.float32) / 4
    for _ in range(iters):
        for c in range(3):
            n = ndi.convolve(out[..., c], k, mode="nearest")
            out[..., c][hole] = n[hole]
    rng = np.random.default_rng(seed)
    n = sum(ndi.gaussian_filter(rng.normal(0, 1, hole.shape), sg) * sg * a
            for sg, a in ((1.2, 1.4), (3, 1.6), (7, 1.4))) * noise / 4
    for c in range(3):
        out[..., c][hole] += n[hole]
    return np.clip(out, 0, 255)


# ---------------------------------------------------------------- الروبوت في الحفرة
def build_pit_robot():
    box = (440, 420, 700, 616)
    x0, y0, x1, y1 = box
    c = B[y0:y1, x0:x1]
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    sat = c.max(-1) - c.min(-1)
    blue = (b > r + 45) & (b > 120)
    white = (lum > 195) & (sat < 45)
    orange = (r > 190) & (g > 95) & (g < 185) & (b < 95)
    m = blue | white | orange
    m = ndi.binary_closing(m, iterations=5)
    m = ndi.binary_fill_holes(m)
    m = ndi.binary_opening(m, iterations=2)
    lab, n = ndi.label(m)
    if n:
        sizes = ndi.sum(m, lab, range(1, n + 1))
        m = lab == (1 + int(np.argmax(sizes)))
    m = ndi.binary_fill_holes(ndi.binary_closing(m, iterations=6))
    # الروبوت كاملاً: وسّع قليلاً ليشمل الحواف الداكنة (الخطوط)
    m_d = ndi.binary_dilation(m, iterations=3)
    alpha = ndi.gaussian_filter(m_d.astype(np.float32), 1.3)
    rgba = np.dstack([c.astype(np.uint8), (alpha * 255).astype(np.uint8)])
    save(Image.fromarray(rgba, "RGBA"), "pit_robot.png")
    # خلفية نظيفة: املأ الفراغ (موسّع أكثر) بانتشار
    hole = ndi.binary_dilation(m | ndi.binary_dilation(blue | orange, iterations=2), iterations=10)
    full = B.copy()
    region = full[y0:y1, x0:x1]
    region = diffuse_inpaint(region, hole, iters=500, noise=16, seed=3)
    # صخور مولّدة فوق الفراغ (ألوان مأخوذة من صخور الحفرة المحيطة)
    from PIL import ImageDraw
    ring = ndi.binary_dilation(hole, iterations=18) & ~ndi.binary_dilation(hole, iterations=4)
    lum = (0.299 * B[y0:y1, x0:x1, 0] + 0.587 * B[y0:y1, x0:x1, 1] + 0.114 * B[y0:y1, x0:x1, 2])
    cand = np.argwhere(ring & (lum < 150) & (lum > 45))
    rng = np.random.default_rng(11)
    pil = Image.fromarray(np.clip(region, 0, 255).astype(np.uint8), "RGB"); dr = ImageDraw.Draw(pil)
    hy, hx = np.nonzero(hole)
    order = sorted(range(40), key=lambda i: 0)
    pts = []
    for i in range(46):
        k = rng.integers(0, len(hy)); cx, cy = int(hx[k]), int(hy[k])
        pts.append((cy, cx))
    pts.sort()
    for cy, cx in pts:
        r = int(rng.integers(13, 30))
        if len(cand):
            yy_, xx_ = cand[rng.integers(0, len(cand))]; base = B[y0 + yy_, x0 + xx_]
        else:
            base = np.array([95, 90, 100], np.float32)
        base = base * rng.uniform(.75, 1.05)
        n = int(rng.integers(5, 8)); ang = np.sort(rng.uniform(0, 2 * np.pi, n))
        poly = [(cx + np.cos(a_) * r * rng.uniform(.7, 1.15), cy + np.sin(a_) * r * rng.uniform(.6, 1.0)) for a_ in ang]
        dr.polygon(poly, fill=tuple(int(v) for v in np.clip(base * .8, 0, 255)), outline=tuple(int(v) for v in np.clip(base * .45, 0, 255)))
        top = [(px_, py_ - r * .18) for px_, py_ in poly[:max(3, n // 2 + 1)]] + [(cx, cy)]
        dr.polygon(top, fill=tuple(int(v) for v in np.clip(base * 1.12, 0, 255)))
    region = np.asarray(pil.filter(ImageFilter.GaussianBlur(.7))).astype(np.float32)
    # عتمة عمق الحفرة (أقل قوة ليبقى لون الصخر)
    hm = ndi.gaussian_filter(hole.astype(np.float32), 9)
    for ch in range(3):
        region[..., ch] *= (1 - 0.3 * hm)
    clean = np.clip(region, 0, 255).astype(np.uint8)
    a = (feather_rect(x1 - x0, y1 - y0, 12) * 255).astype(np.uint8)
    save(Image.fromarray(np.dstack([clean, a]), "RGBA"), "pit_clean.png")
    # طبقة الصخور الأمامية (تخفي أسفل الروبوت وهو يصعد) من النسخة النظيفة
    fy = 572 - y0
    front = clean[fy:]
    fa = np.clip(np.linspace(0, 1, front.shape[0])[:, None] * 6, 0, 1) * feather_rect(front.shape[1], front.shape[0], 10) ** 0.3
    # لا تُخفِ الحواف العلوية
    fa = np.minimum(fa, 1.0)
    save(Image.fromarray(np.dstack([front, (fa * 255).astype(np.uint8)]), "RGBA"), "pit_front.png")
    json.dump({"robot": [x0, y0], "front": [x0, 572], "clean": [x0, y0]}, open(os.path.join(A, "pit_meta.json"), "w"))


# ---------------------------------------------------------------- الحبل المتأرجح
def build_rope():
    # الحبل المتدلّي من العقدة إلى رأس الروبوت
    box = (498, 352, 572, 452)
    save(crop_rgba(box, feather=6), "rope_hang.png")


# ---------------------------------------------------------------- الماء
def build_water():
    box = (545, 182, 720, 250)
    save(crop_rgba(box, feather=14, ellipse=True), "water.png")


# ---------------------------------------------------------------- البوابة والأعلام
def build_gate():
    # الروبوت السعيد داخل البوابة
    box = (1070, 744, 1234, 876)
    x0, y0, x1, y1 = box
    c = B[y0:y1, x0:x1]
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    sat = c.max(-1) - c.min(-1)
    blue = (b > r + 55) & (b > 120) & (sat > 70)
    orange = (r > 190) & (g > 95) & (g < 180) & (b < 90)
    dark = (lum < 80)
    skel = ndi.binary_closing(blue | orange | dark, iterations=2)
    white = (lum > 200) & (sat < 35) & (b - r < 30)
    m = skel | (white & ndi.binary_dilation(skel, iterations=9))
    m = ndi.binary_closing(m, iterations=5)
    m = ndi.binary_fill_holes(m)
    m = ndi.binary_opening(m, iterations=3)
    lab, n = ndi.label(m)
    if n:
        sizes = ndi.sum(m, lab, range(1, n + 1))
        m = lab == (1 + int(np.argmax(sizes)))
    m = ndi.binary_fill_holes(m)
    m[:55, 136:] = False  # عمود البوابة
    md = ndi.binary_dilation(m, iterations=3)
    alpha = ndi.gaussian_filter(md.astype(np.float32), 1.3)
    save(Image.fromarray(np.dstack([c.astype(np.uint8), (alpha * 255).astype(np.uint8)]), "RGBA"), "gate_robot.png")
    # داخل البوابة فارغاً: تدرّج سماء/توهج + نجوم مرسومة
    h, w = y1 - y0, x1 - x0
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    t = np.clip(yy / h, 0, 1)[..., None]
    top = np.array([150, 214, 244], np.float32); bot = np.array([255, 249, 214], np.float32)
    region = top * (1 - t) + bot * t
    glow = np.clip(1 - np.sqrt(((xx - w * .55) / (w * .6)) ** 2 + ((yy - h * .55) / (h * .7)) ** 2), 0, 1)[..., None]
    region = region * (1 - glow * .65) + np.array([255, 255, 240], np.float32) * glow * .65
    from PIL import ImageDraw
    im = Image.fromarray(np.clip(region, 0, 255).astype(np.uint8), "RGB"); d = ImageDraw.Draw(im)
    rng = np.random.default_rng(7)
    for _ in range(9):
        cx, cy, r = rng.integers(14, w - 14), rng.integers(10, h - 14), rng.integers(4, 8)
        d.polygon([(cx, cy - r * 1.6), (cx + r * .45, cy - r * .45), (cx + r * 1.6, cy), (cx + r * .45, cy + r * .45), (cx, cy + r * 1.6), (cx - r * .45, cy + r * .45), (cx - r * 1.6, cy), (cx - r * .45, cy - r * .45)], fill=(255, 226, 92))
    region = np.asarray(im.filter(ImageFilter.GaussianBlur(.6))).astype(np.float32)
    # أبقِ أعمدة البوابة الأصلية على الجانبين
    a_in = np.ones((h, w), np.float32); a_in[:, :10] = 0; a_in[:, -10:] = 0
    a = (ndi.gaussian_filter(a_in, 3) * feather_rect(w, h, 8) * 255).astype(np.uint8)
    save(Image.fromarray(np.dstack([np.clip(region, 0, 255).astype(np.uint8), a]), "RGBA"), "gate_clean.png")
    # الأعلام
    save(crop_rgba((950, 655, 1098, 824), feather=10), "flag_left.png")
    save(crop_rgba((1196, 655, 1254, 730), feather=6), "flag_right.png")
    # لافتة الإنقاذ كاملة (للتوهج)
    save(crop_rgba((1040, 650, 1254, 935), feather=16), "gate_full.png")


# ---------------------------------------------------------------- الواجهة الخشبية
def cutout(box, sample, thresh=58):
    """قصّ عنصر ملوّن من ورقة البرشمان: قناع بالمسافة اللونية عن لون الورقة"""
    x0, y0, x1, y1 = box
    sx0, sy0, sx1, sy1 = sample
    paper = B[sy0:sy1, sx0:sx1].reshape(-1, 3).mean(0)
    c = B[y0:y1, x0:x1]
    d = np.sqrt(((c - paper) ** 2).sum(-1))
    m = d > thresh
    m = ndi.binary_closing(m, iterations=2)
    m = ndi.binary_fill_holes(m)
    m = ndi.binary_opening(m, iterations=1)
    lab, n = ndi.label(m)
    if n:
        sizes = ndi.sum(m, lab, range(1, n + 1))
        keep = [i + 1 for i, sz in enumerate(sizes) if sz > 0.08 * sizes.max()]
        m = np.isin(lab, keep)
    return m


def build_panels():
    sample = (26, 470, 34, 540)
    panels = {"panel_dice": (10, 403, 182, 593), "panel_turn": (10, 587, 182, 729), "panel_cards": (10, 723, 182, 909)}
    work = {k: B[v[1]:v[3], v[0]:v[2]].copy() for k, v in panels.items()}
    # النرد
    dice_box = (36, 456, 150, 574)
    m = cutout(dice_box, sample, 40)
    md = ndi.binary_dilation(m, iterations=4)
    x0, y0, x1, y1 = dice_box
    sub = B[y0:y1, x0:x1].copy()
    filled = diffuse_inpaint(sub, md, iters=500, noise=2, seed=2)
    px, py = panels["panel_dice"][:2]
    work["panel_dice"][y0 - py:y1 - py, x0 - px:x1 - px] = filled
    save(Image.fromarray(np.dstack([c := np.clip(filled, 0, 255).astype(np.uint8), (ndi.gaussian_filter(m.astype(np.float32), 1) * 255).astype(np.uint8)]), "RGBA"), "dice_baked.png")
    # البيادق
    for name, box in (("turn_red", (38, 628, 94, 708)), ("turn_blue", (96, 628, 152, 708))):
        m = cutout(box, sample, 55)
        a = (ndi.gaussian_filter(ndi.binary_dilation(m, iterations=1).astype(np.float32), 0.9) * 255).astype(np.uint8)
        c = B[box[1]:box[3], box[0]:box[2]].astype(np.uint8)
        save(Image.fromarray(np.dstack([c, a]), "RGBA"), name + ".png")
        md = ndi.binary_dilation(m, iterations=5)
        sub = B[box[1]:box[3], box[0]:box[2]].copy()
        filled = diffuse_inpaint(sub, md, iters=400, noise=2, seed=4)
        px, py = panels["panel_turn"][:2]
        work["panel_turn"][box[1] - py:box[3] - py, box[0] - px:box[2] - px] = filled
    # رزمة البطاقات
    box = (26, 762, 168, 870)
    m = cutout(box, sample, 50)
    a = (ndi.gaussian_filter(ndi.binary_dilation(m, iterations=1).astype(np.float32), 0.9) * 255).astype(np.uint8)
    c = B[box[1]:box[3], box[0]:box[2]].astype(np.uint8)
    save(Image.fromarray(np.dstack([c, a]), "RGBA"), "cards_stack.png")
    md = ndi.binary_dilation(m, iterations=6)
    sub = B[box[1]:box[3], box[0]:box[2]].copy()
    filled = diffuse_inpaint(sub, md, iters=500, noise=2, seed=6)
    px, py = panels["panel_cards"][:2]
    work["panel_cards"][box[1] - py:box[3] - py, box[0] - px:box[2] - px] = filled
    for k, arr in work.items():
        save(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB").convert("RGBA"), k + ".png")


# ---------------------------------------------------------------- مراحل الإنقاذ
def build_stages():
    js = open(os.path.join(ROOT, "data", "tiles.js"), encoding="utf-8").read()
    m = re.search(r"STAGE_BOXES\s*=\s*(\[.*?\]);", js, re.S)
    boxes = json.loads(m.group(1))
    for i, b in enumerate(boxes, 1):
        save(crop_rgba((b["x"] + 4, b["y"] + 4, b["x"] + b["w"] - 4, b["y"] + b["h"] - 40), feather=3), f"stage_{i}.png")


# ---------------------------------------------------------------- أيقونات المربعات (تموّج)
def build_tile_icons():
    js = open(os.path.join(ROOT, "data", "tiles.js"), encoding="utf-8").read()
    m = re.search(r"TILES_DATA\s*=\s*(\[.*?\]);", js, re.S)
    tiles = json.loads(m.group(1))
    for t in tiles:
        if t["type"] in ("challenge", "mystery", "spot", "tool", "team", "hazard", "choose", "comeback"):
            cx, cy = t["x"], t["y"] - 18
            r = 27
            save(crop_rgba((cx - r, cy - r, cx + r, cy + r), feather=10, ellipse=True), f"icon_{t['i']}.png")


if __name__ == "__main__":
    build_pit_robot()
    build_rope()
    build_water()
    build_gate()
    build_panels()
    build_stages()
    build_tile_icons()
