#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make-placeholder-assets.py
==========================

生成 3 张 *明确标注的临时占位卡面图*（TEMP PLACEHOLDER），用于银行卡式商品展示
组件的 Demo。这些图片**不是正式卡面美术资源**，正式上线前必须由用户自制的
正式卡面替换（见 public/cards/README.md）。

产出（public/cards/）：
    cookie.png        cookie.webp         商品 A：Cookie
    panda.png         panda.webp          商品 B：Sad Panda
    panda-silver.png  panda-silver.webp   Sad Panda 银色原图（用于 silver 效果演示）

技术要点：
    * 精确银行卡比例 1.586:1，像素 1015 x 640。
    * 卡面圆角按 ISO 比例：水平半径 3.72% 宽、垂直半径 5.89% 高。
    * 使用 Pillow 绘制；4 倍超采样后 LANCZOS 缩小以获得平滑抗锯齿。
    * 同时保存 PNG（无损）与 WebP（quality=92, method=6）。
    * 生成后自检每个文件的真实格式 / 尺寸 / 宽高比误差并打印。

依赖：Python 3 + Pillow（需支持 WebP）。不引入任何 npm 依赖。

用法：
    python tools/make-placeholder-assets.py
或（跨平台包装，推荐）：
    npm run assets
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    from PIL import Image, ImageChops, ImageDraw, ImageFont, features
except Exception as exc:  # pragma: no cover - 仅在缺依赖时触发
    sys.stderr.write(
        "[错误] 无法导入 Pillow。请先安装：\n"
        "       python -m pip install --upgrade Pillow\n"
        f"       原始错误：{exc}\n"
    )
    raise SystemExit(1)

# 强制 UTF-8 输出，避免 Windows 中文控制台以 GBK 编码导致乱码。
for _stream_name in ("stdout", "stderr"):
    _stream = getattr(sys, _stream_name, None)
    if _stream is not None and hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


# --------------------------------------------------------------------------- #
# 常量
# --------------------------------------------------------------------------- #

WIDTH = 1015                     # 目标像素宽
HEIGHT = 640                     # 目标像素高
TARGET_RATIO = WIDTH / HEIGHT    # 1.5859375（= 1.586:1 量级）
RATIO_TOLERANCE = 0.002          # ±0.2%

CORNER_RX = 0.0372               # 水平圆角半径 = 3.72% 宽度（ISO/IEC 7810 参考）
CORNER_RY = 0.0589               # 垂直圆角半径 = 5.89% 高度

SUPERSAMPLE = 4                  # 超采样倍数

# 项目根目录：本文件位于 <root>/tools/
ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "cards"

WEBP_QUALITY = 92
WEBP_METHOD = 6


# --------------------------------------------------------------------------- #
# 字体解析
# --------------------------------------------------------------------------- #

# 搜索顺序：命令行探测到的 Windows 字体目录、环境变量、常见目录。
# 注意：任务描述写的是 D:/Windows/Fonts，但真实环境通常为 C:/Windows/Fonts，
#       这里两者都搜索，并额外兼容 WINDIR 与类 Unix 字体目录。
def _font_dirs() -> list[Path]:
    dirs: list[Path] = []
    for env in ("WINDIR", "SystemRoot"):
        val = os.environ.get(env)
        if val:
            dirs.append(Path(val) / "Fonts")
    dirs += [
        Path("C:/Windows/Fonts"),
        Path("D:/Windows/Fonts"),
        Path("/usr/share/fonts"),
        Path("/usr/local/share/fonts"),
        Path.home() / "Library" / "Fonts",
        Path("/Library/Fonts"),
    ]
    # 去重
    seen: set[str] = set()
    out: list[Path] = []
    for d in dirs:
        key = str(d).lower()
        if key not in seen and d.is_dir():
            seen.add(key)
            out.append(d)
    return out


FONT_DIRS = _font_dirs()

# 粗体拉丁字体（用于 Cookie / Sad Panda 大字）
LATIN_BOLD_NAMES = ["segoeui.ttf", "arialbd.ttf", "seguisb.ttf", "arial.ttf", "DejaVuSans-Bold.ttf"]
# 常规拉丁字体（用于英文小字）
LATIN_REGULAR_NAMES = ["segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"]
# 含 CJK 字体（用于中文与中英混排）
CJK_NAMES = ["msyh.ttc", "msyhbd.ttc", "msyhl.ttc", "simhei.ttf", "simsun.ttc", "NotoSansCJK-Regular.ttc"]


def _find_font(names: list[str]) -> Path | None:
    for d in FONT_DIRS:
        for name in names:
            p = d / name
            if p.is_file():
                return p
        # 递归一层，兼容 Linux 分类子目录
        for name in names:
            hits = list(d.glob(f"**/{name}"))
            if hits:
                return hits[0]
    return None


def _load(path: Path | None, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """加载字体，失败时回退 Pillow 默认位图字体（保证脚本不崩）。"""
    if path is not None:
        try:
            # .ttc 需要指定 index；默认 0 即可。
            return ImageFont.truetype(str(path), size)
        except Exception:
            try:
                return ImageFont.truetype(str(path), size, index=0)
            except Exception:
                pass
    return ImageFont.load_default()


FONT_LATIN_BOLD = _find_font(LATIN_BOLD_NAMES)
FONT_LATIN_REGULAR = _find_font(LATIN_REGULAR_NAMES)
FONT_CJK = _find_font(CJK_NAMES)


# --------------------------------------------------------------------------- #
# 配色（三种明显区分的浅色方案；文字均为深色以保证对比度）
# --------------------------------------------------------------------------- #

THEMES: dict[str, dict] = {
    "cookie": {
        "label": "Cookie",
        "subtitle": "PRODUCT A",
        "top": (250, 241, 222),
        "bottom": (232, 208, 168),
        "ink": (74, 50, 22),            # 深棕，对浅米色对比充足
        "sub_ink": (108, 78, 40),
        "band": (146, 108, 52, 70),     # 半透明水印带
        "watermark": (146, 108, 52, 60),
        "border": (120, 88, 44, 200),
    },
    "panda": {
        "label": "Sad Panda",
        "subtitle": "PRODUCT B",
        "top": (233, 241, 232),
        "bottom": (198, 216, 198),
        "ink": (34, 58, 40),            # 深墨绿
        "sub_ink": (62, 92, 68),
        "band": (58, 100, 70, 66),
        "watermark": (58, 100, 70, 58),
        "border": (56, 96, 68, 200),
    },
    # 深色测试卡面：用于检查闪卡效果在深色美术上的过曝（银行深色卡面很常见）
    "dark": {
        "label": "Midnight",
        "subtitle": "DARK TEST FACE",
        "top": (32, 43, 62),
        "bottom": (12, 19, 33),
        "ink": (228, 237, 247),
        "sub_ink": (156, 176, 200),
        "band": (150, 182, 222, 54),
        "watermark": (150, 182, 222, 46),
        "border": (122, 152, 192, 175),
    },
    "panda-silver": {
        "label": "Sad Panda",
        "subtitle": "SILVER ORIGINAL",
        "top": (238, 240, 244),
        "bottom": (192, 198, 208),
        "ink": (36, 41, 52),            # 深石板灰
        "sub_ink": (74, 82, 96),
        "band": (78, 86, 102, 66),
        "watermark": (78, 86, 102, 58),
        "border": (86, 94, 110, 200),
    },
}


# --------------------------------------------------------------------------- #
# 绘图辅助
# --------------------------------------------------------------------------- #

def vertical_gradient(size: tuple[int, int], top: tuple[int, int, int],
                      bottom: tuple[int, int, int]) -> Image.Image:
    w, h = size
    strip = Image.new("RGB", (1, h))
    px = strip.load()
    for y in range(h):
        t = y / max(1, h - 1)
        px[0, y] = (
            round(top[0] + (bottom[0] - top[0]) * t),
            round(top[1] + (bottom[1] - top[1]) * t),
            round(top[2] + (bottom[2] - top[2]) * t),
        )
    return strip.resize((w, h), Image.BILINEAR)


def rounded_rect_mask(size: tuple[int, int], rx: float, ry: float) -> Image.Image:
    """带椭圆角的圆角矩形遮罩（水平半径 rx、垂直半径 ry 可不同）。"""
    w, h = size
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.rectangle([rx, 0, w - rx, h], fill=255)
    d.rectangle([0, ry, w, h - ry], fill=255)
    d.ellipse([0, 0, 2 * rx, 2 * ry], fill=255)
    d.ellipse([w - 2 * rx, 0, w, 2 * ry], fill=255)
    d.ellipse([0, h - 2 * ry, 2 * rx, h], fill=255)
    d.ellipse([w - 2 * rx, h - 2 * ry, w, h], fill=255)
    return mask


def text_size(draw: ImageDraw.ImageDraw, text: str, font) -> tuple[int, int]:
    box = draw.textbbox((0, 0), text, font=font)
    return box[2] - box[0], box[3] - box[1]


def draw_centered(draw: ImageDraw.ImageDraw, cx: int, cy: int, text: str, font, fill) -> None:
    box = draw.textbbox((0, 0), text, font=font)
    w = box[2] - box[0]
    h = box[3] - box[1]
    draw.text((cx - w / 2 - box[0], cy - h / 2 - box[1]), text, font=font, fill=fill)


def make_diagonal_watermark_layer(size: tuple[int, int], text: str, font, fill,
                                  angle: float = -18.0) -> Image.Image:
    """整幅平铺的斜向水印文字。"""
    w, h = size
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    tw, th = text_size(d, text, font)
    step_x = max(1, tw + int(0.10 * w))
    step_y = max(1, th + int(0.14 * h))
    for iy in range(-2, h // step_y + 3):
        offset = (step_x // 2) if (iy % 2) else 0
        for ix in range(-2, w // step_x + 3):
            d.text((ix * step_x + offset, iy * step_y), text, font=font, fill=fill)
    return layer.rotate(angle, resample=Image.BICUBIC, expand=False)


def make_band_layer(size: tuple[int, int], text: str, font, fill,
                    band_h_ratio: float = 0.20, angle: float = -18.0,
                    repeat_gap_ratio: float = 0.06) -> Image.Image:
    """一条斜向的“临时占位”水印带（半透明色块 + 重复文字）。"""
    w, h = size
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    band_h = int(h * band_h_ratio)
    y0 = (h - band_h) // 2
    d.rectangle([0, y0, w, y0 + band_h], fill=fill)
    tw, th = text_size(d, text, font)
    gap = int(w * repeat_gap_ratio)
    step = tw + gap
    ty = y0 + (band_h - th) // 2
    for x in range(-step, w + step, step):
        d.text((x, ty), text, font=font, fill=(255, 255, 255, 210))
    return layer.rotate(angle, resample=Image.BICUBIC, expand=False)


# --------------------------------------------------------------------------- #
# 单张卡面生成
# --------------------------------------------------------------------------- #

def build_card(key: str, theme: dict) -> Image.Image:
    """在 4x 超采样画布上绘制，返回最终的 1015x640 RGBA 图像。"""
    s = SUPERSAMPLE
    W, H = WIDTH * s, HEIGHT * s

    # 1) 背景渐变
    canvas = vertical_gradient((W, H), theme["top"], theme["bottom"]).convert("RGBA")

    # 2) 斜向平铺水印（低透明度，铺满整面）
    wm_font = _load(FONT_CJK, int(34 * s))
    wm_text = "TEMP PLACEHOLDER / 临时占位"
    wm_layer = make_diagonal_watermark_layer((W, H), wm_text, wm_font, theme["watermark"])
    canvas = Image.alpha_composite(canvas, wm_layer)

    # 3) 斜向水印带
    band_font = _load(FONT_CJK, int(40 * s))
    band_layer = make_band_layer((W, H), wm_text, band_font, theme["band"])
    canvas = Image.alpha_composite(canvas, band_layer)

    draw = ImageDraw.Draw(canvas)

    # 4) 顶部标签：TEMP / 占位
    top_font = _load(FONT_CJK, int(30 * s))
    margin = int(0.055 * W)
    draw.text((margin, margin), "TEMP PLACEHOLDER", font=top_font, fill=theme["sub_ink"])
    draw.text((margin, margin + int(38 * s)), "临时占位素材", font=top_font, fill=theme["sub_ink"])

    # 5) 中央大字商品名
    name_font = _load(FONT_LATIN_BOLD, int(96 * s))
    draw_centered(draw, W // 2, int(0.42 * H), theme["label"], name_font, theme["ink"])

    # 6) 副标题（产品位 / 银色原图）
    sub_font = _load(FONT_LATIN_BOLD, int(30 * s))
    draw_centered(draw, W // 2, int(0.545 * H), theme["subtitle"], sub_font, theme["sub_ink"])

    # 7) 免责声明两行
    en_font = _load(FONT_LATIN_BOLD, int(27 * s))
    cn_font = _load(FONT_CJK, int(27 * s))
    draw_centered(draw, W // 2, int(0.665 * H),
                  "TEMP ASSET \u2013 NOT FINAL ARTWORK", en_font, theme["ink"])
    draw_centered(draw, W // 2, int(0.735 * H),
                  "临时占位素材，非正式卡面", cn_font, theme["ink"])

    # 8) 右下角规格标注（便于核对）
    spec_font = _load(FONT_LATIN_REGULAR, int(22 * s))
    spec = f"{WIDTH} x {HEIGHT}  |  1.586:1"
    sw, sh = text_size(draw, spec, spec_font)
    draw.text((W - margin - sw, H - margin - sh), spec, font=spec_font, fill=theme["sub_ink"])

    # 9) 卡面圆角遮罩 + 内描边（写出精确圆角轮廓）
    rx = CORNER_RX * W
    ry = CORNER_RY * H
    mask = rounded_rect_mask((W, H), rx, ry)

    # 内描边：沿遮罩边缘画一条细线（用遮罩腐蚀差分近似）
    border_w = max(2, int(2.5 * s))
    inner = rounded_rect_mask((W, H), max(1, rx - border_w), max(1, ry - border_w))
    ring = ImageChops.difference(mask, inner)
    outline = Image.new("RGBA", (W, H), theme["border"])
    outline.putalpha(ring)
    canvas = Image.alpha_composite(canvas, outline)

    # 应用圆角遮罩，外部透明（使卡面比例严格 = 1015:640）
    canvas.putalpha(mask)

    # 10) 下采样到目标尺寸
    final = canvas.resize((WIDTH, HEIGHT), Image.LANCZOS)
    return final


# --------------------------------------------------------------------------- #
# 保存
# --------------------------------------------------------------------------- #

def save_assets(card: Image.Image, stem: str) -> list[Path]:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    png_path = OUT_DIR / f"{stem}.png"
    webp_path = OUT_DIR / f"{stem}.webp"

    # PNG：保留 alpha，优化
    card.save(png_path, format="PNG", optimize=True)
    # WebP：quality 92, method 6（有损 + alpha）
    card.save(webp_path, format="WEBP", quality=WEBP_QUALITY, method=WEBP_METHOD)
    return [png_path, webp_path]


# --------------------------------------------------------------------------- #
# 自检
# --------------------------------------------------------------------------- #

def self_check(paths: list[Path]) -> bool:
    print("\n=== 自检结果 ===")
    ok = True
    for p in paths:
        try:
            with Image.open(p) as im:
                fmt = im.format
                size = im.size
                mode = im.mode
        except Exception as exc:
            ok = False
            print(f"[FAIL] {p}: 无法打开 -> {exc}")
            continue

        ratio = size[0] / size[1]
        err = abs(ratio - TARGET_RATIO) / TARGET_RATIO * 100.0
        dims_ok = size == (WIDTH, HEIGHT)
        ratio_ok = err <= (RATIO_TOLERANCE * 100.0)
        fmt_ok = fmt in ("PNG", "WEBP")
        good = dims_ok and ratio_ok and fmt_ok
        ok = ok and good
        flag = "OK  " if good else "FAIL"
        print(
            f"[{flag}] {p.name:<20} format={fmt:<5} mode={mode:<5} "
            f"size={size[0]}x{size[1]} ratio={ratio:.6f} "
            f"误差={err:.4f}% (允许 ±{RATIO_TOLERANCE * 100:.1f}%)"
        )
    return ok


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #

def main() -> int:
    print("生成临时占位卡面（TEMP PLACEHOLDER）")
    print(f"  目标尺寸 : {WIDTH} x {HEIGHT}")
    print(f"  目标比例 : 1.586:1（精确 {TARGET_RATIO:.6f}，允差 ±{RATIO_TOLERANCE * 100:.1f}%）")
    print(f"  输出目录 : {OUT_DIR}")
    print(f"  字体目录 : {', '.join(str(d) for d in FONT_DIRS) or '(未找到，使用内置默认字体)'}")
    print(f"  拉丁粗体 : {FONT_LATIN_BOLD}")
    print(f"  拉丁常规 : {FONT_LATIN_REGULAR}")
    print(f"  中文 CJK : {FONT_CJK}")

    if not features.check("webp"):
        sys.stderr.write("[错误] 当前 Pillow 不支持 WebP，无法生成 .webp 文件。\n")
        return 1

    all_paths: list[Path] = []
    for key, theme in THEMES.items():
        print(f"\n-> 绘制 {key} ...")
        card = build_card(key, theme)
        if card.size != (WIDTH, HEIGHT):
            sys.stderr.write(f"[错误] {key} 尺寸异常：{card.size}\n")
            return 1
        saved = save_assets(card, key)
        all_paths.extend(saved)
        for p in saved:
            print(f"   已保存 {p.relative_to(ROOT)}")

    if not self_check(all_paths):
        sys.stderr.write("\n[错误] 自检未通过，请检查生成逻辑。\n")
        return 1

    print("\n[完成] 共生成", len(all_paths), "个文件。")
    print("提示：这些是临时占位素材，正式上线前必须替换为自制正式卡面。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
