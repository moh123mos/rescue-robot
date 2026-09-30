"""قصّ ورقة الشخصيات (contact sheet) إلى أوضاع منفصلة جاهزة للعبة.

الإدخال : assets/characters_src/sheets.json  يصف كل ورقة:
            {"file": "sheet_all.png", "cols": 7, "poses": [...], "rows": ["kid_boy", "kid_girl", "kid_bot"]}
          كل صفّ = شخصية، وكل عمود = وضع (بالترتيب المذكور في poses).
الإخراج : assets/characters/<id>/<pose>.png + portrait.png + meta.json
التشغيل : python tools/slice_characters.py

إزالة الخلفية (تلقائية): شفافية موجودة ← تُستعمل؛ خلفية خضراء نقية ← chroma key؛
وإلا خلفية بنفسجية متدرّجة (كما في الورقة الحالية) ← قناع بنسب اللون + ملء فيضي متّصل
(يُبقي الأجزاء الداخلية المشابهة للخلفية)، وتُحذف العناصر الصغيرة المنفصلة (شرارات الرسم).
المحاذاة: قدما كل وضع تُحاذيان قدمي idle (المركز الأفقي لمنطقة القدمين + خط الأرض)،
والإطار النهائي موحّد لكل الأوضاع فلا «ترتجف» الشخصية عند تبديل الوضع.
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "characters_src")
OUT = os.path.join(ROOT, "assets", "characters")
MAX_H = 420
MARGIN = 6
MIN_COMPONENT = 1200     # أصغر من هذا = شرارات/شوائب تُحذف


def foreground_mask(img):
    """يُرجع (rgb float, mask bool). يكتشف نوع الخلفية من الزوايا."""
    rgba = np.asarray(img.convert("RGBA")).astype(np.float32)
    rgb, alpha = rgba[..., :3], rgba[..., 3]
    if alpha.min() < 200:
        return rgb, alpha > 40
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    corner = np.median(np.concatenate([rgb[:8, :8].reshape(-1, 3), rgb[-8:, -8:].reshape(-1, 3)]), axis=0)
    if corner[1] > 180 and corner[0] < 80 and corner[2] < 80:          # أخضر نقي
        return rgb, (g - np.maximum(r, b)) < 40
    rb = r / np.maximum(b, 1); gb = g / np.maximum(b, 1)
    cand = (rb > .50) & (rb < 1.0) & (gb > .45) & (gb < .88) & (b > 75) & (b - g > 25) & (r < 172) & (g < 150)
    er = ndi.binary_erosion(cand, iterations=2)
    lab, n = ndi.label(er)
    sizes = ndi.sum(er, lab, range(1, n + 1))
    big = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s > 2500])
    bg = ndi.binary_dilation(big, iterations=3) & cand
    return rgb, ~bg


def components(rgb, fg):
    lab, n = ndi.label(fg)
    sizes = ndi.sum(fg, lab, range(1, n + 1))
    out = []
    for i, s in enumerate(sizes, 1):
        if s < MIN_COMPONENT:
            continue
        m = ndi.binary_fill_holes(lab == i)
        m = ndi.binary_opening(m, iterations=1)
        m = ndi.binary_erosion(m, iterations=1)
        ys, xs = np.nonzero(m)
        if len(xs) == 0:
            continue
        out.append(dict(mask=m, cx=xs.mean(), cy=ys.mean(), bbox=(xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)))
    return out


def sprite_of(rgb, comp):
    x0, y0, x1, y1 = comp["bbox"]
    a = ndi.gaussian_filter(comp["mask"][y0:y1, x0:x1].astype(np.float32), .8)
    return Image.fromarray(np.dstack([rgb[y0:y1, x0:x1].astype(np.uint8), (a * 255).astype(np.uint8)]), "RGBA")


def feet_center(sp):
    """المركز الأفقي لمنطقة القدمين (الربع السفلي) + خط الأرض"""
    a = np.asarray(sp)[..., 3] > 60
    h = a.shape[0]
    lower = a[int(h * .78):]
    xs = np.nonzero(lower.any(axis=0))[0]
    return (xs.min() + xs.max()) / 2, h


def build(sheet_cfg):
    img = Image.open(os.path.join(SRC, sheet_cfg["file"]))
    rgb, fg = foreground_mask(img)
    H, W = fg.shape
    cols, rows, poses = sheet_cfg["cols"], sheet_cfg["rows"], sheet_cfg["poses"]
    cw, ch = W / cols, H / len(rows)
    grid = {}
    for comp in components(rgb, fg):
        c, r = int(comp["cx"] // cw), int(comp["cy"] // ch)
        if c < len(poses) and r < len(rows):
            # إن وقع أكثر من مكوّن في الخلية نأخذ الأكبر
            if (r, c) not in grid or comp["mask"].sum() > grid[(r, c)]["mask"].sum():
                grid[(r, c)] = comp
    for r, cid in enumerate(rows):
        sprites = {poses[c]: sprite_of(rgb, grid[(r, c)]) for c in range(len(poses)) if (r, c) in grid}
        if "idle" not in sprites:
            print(f"[{cid}] لا يوجد idle — تخطّي"); continue
        ifx, ih = feet_center(sprites["idle"])
        # لوحة عمل: كل وضع يوضع بحيث يقع مركز قدميه وقاعدته على نقطة ثابتة
        PAD = 80
        boxes, placed = [], {}
        for pose, sp in sprites.items():
            fx, h = feet_center(sp)
            ox, oy = PAD + ifx - fx, PAD + ih - h          # إزاحة الرسم بحيث تتطابق القاعدة والمركز
            placed[pose] = (ox, oy, sp)
            boxes.append((ox, oy, ox + sp.width, oy + sp.height))
        ux0 = int(min(b[0] for b in boxes)) - MARGIN; uy0 = int(min(b[1] for b in boxes)) - MARGIN
        ux1 = int(max(b[2] for b in boxes)) + MARGIN; uy1 = int(max(b[3] for b in boxes)) + MARGIN
        scale = min(1.0, MAX_H / (uy1 - uy0))
        size = (max(1, round((ux1 - ux0) * scale)), max(1, round((uy1 - uy0) * scale)))
        out_dir = os.path.join(OUT, cid); os.makedirs(out_dir, exist_ok=True)
        frames = {}
        for pose, (ox, oy, sp) in placed.items():
            canvas = Image.new("RGBA", (ux1 - ux0, uy1 - uy0), (0, 0, 0, 0))
            canvas.paste(sp, (int(ox - ux0), int(oy - uy0)), sp)
            canvas = canvas.resize(size, Image.LANCZOS)
            canvas.save(os.path.join(out_dir, pose + ".png"), optimize=True)
            frames[pose] = canvas
        # صورة الرأس: النصف العلوي من idle
        idle = frames["idle"]; a = np.asarray(idle)[..., 3] > 60
        ys, xs = np.nonzero(a)
        top, bottom = ys.min(), ys.max()
        head_rows = a[top: top + int((bottom - top) * .5)]
        hx = np.nonzero(head_rows.any(axis=0))[0]
        cx, half = (hx.min() + hx.max()) // 2, (hx.max() - hx.min()) // 2 + 4
        side = 2 * half
        crop = idle.crop((cx - half, top - 4, cx + half, top - 4 + side))
        crop.resize((192, 192), Image.LANCZOS).save(os.path.join(out_dir, "portrait.png"), optimize=True)
        base_y = round((PAD + ih - uy0) * scale, 1)
        meta = {"id": cid, "poses": sorted(frames), "w": size[0], "h": size[1], "baseline": base_y,
                "cx": round((PAD + ifx - ux0) * scale, 1)}
        json.dump(meta, open(os.path.join(out_dir, "meta.json"), "w"), ensure_ascii=False)
        print(f"[{cid}] {len(frames)} poses  {size[0]}x{size[1]}  baseline={base_y}")


if __name__ == "__main__":
    for cfg in json.load(open(os.path.join(SRC, "sheets.json"), encoding="utf-8")):
        build(cfg)
