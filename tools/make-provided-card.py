#!/usr/bin/env python
"""由 test-assets/ 的源素材生成 Demo 卡面（商品 B）。

输入：test-assets/source-panda.png（带透明通道的熊猫抠图）、test-assets/source-background.png（几何背景）
输出：public/cards/panda-card.{png,webp}（1015×640，1.586:1，ISO 银行卡圆角，圆角外透明）
      public/cards/panda-card-silver.{png,webp}（上者的派生银色变体，供 silver 效果演示独立银色原图流程）

用法：python tools/make-provided-card.py
说明：这两个输出文件会随 Demo 构建进入 dist-demo/cards/；源图本身在 test-assets/ 下，不随产物发布。
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, ImageChops, ImageDraw, ImageOps
except ImportError:  # pragma: no cover
    sys.stderr.write("[错误] 需要 Pillow：pip install Pillow\n")
    raise SystemExit(1)

ROOT = Path(__file__).resolve().parent.parent
SRC_PANDA = ROOT / "test-assets" / "source-panda.png"
SRC_BACKGROUND = ROOT / "test-assets" / "source-background.png"
OUT_DIR = ROOT / "public" / "cards"
WIDTH, HEIGHT = 1015, 640
RADIUS_X, RADIUS_Y = 0.0372, 0.0589  # 银行卡 ISO/IEC 7810 ID-1 卡角比例
PANDA_HEIGHT_RATIO = 0.62
PANDA_LEFT_RATIO = 0.04
PANDA_BOTTOM_RATIO = 0.89


def rounded_mask() -> Image.Image:
    mask = Image.new("L", (WIDTH, HEIGHT), 0)
    draw = ImageDraw.Draw(mask)
    rx, ry = WIDTH * RADIUS_X, HEIGHT * RADIUS_Y
    draw.rectangle((rx, 0, WIDTH - rx, HEIGHT), fill=255)
    draw.rectangle((0, ry, WIDTH, HEIGHT - ry), fill=255)
    for cx, cy in ((rx, ry), (WIDTH - rx, ry), (rx, HEIGHT - ry), (WIDTH - rx, HEIGHT - ry)):
        draw.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=255)
    return mask


def build_card() -> Image.Image:
    panda = Image.open(SRC_PANDA).convert("RGBA")
    panda = panda.crop(panda.getchannel("A").point(lambda v: 255 if v > 10 else 0).getbbox())

    background = Image.open(SRC_BACKGROUND).convert("RGB")
    scale = HEIGHT / background.size[1]
    background = background.resize((max(WIDTH, round(background.size[0] * scale)), HEIGHT), Image.LANCZOS)
    if background.size[0] > WIDTH:
        left = (background.size[0] - WIDTH) // 2
        background = background.crop((left, 0, left + WIDTH, HEIGHT))

    target_h = round(HEIGHT * PANDA_HEIGHT_RATIO)
    target_w = round(panda.size[0] * target_h / panda.size[1])
    position = (round(WIDTH * PANDA_LEFT_RATIO), round(HEIGHT * PANDA_BOTTOM_RATIO) - target_h)

    canvas = background.convert("RGBA")
    canvas.alpha_composite(panda.resize((target_w, target_h), Image.LANCZOS), position)
    canvas.putalpha(ImageChops.multiply(canvas.getchannel("A"), rounded_mask()))
    return canvas


def silver_variant(card: Image.Image) -> Image.Image:
    """去饱和 + 轻微提亮，得到“银色原图”演示素材（机械变换，不是重新设计）。"""
    gray = ImageOps.grayscale(card.convert("RGB"))
    cool = Image.merge(
        "RGB",
        (
            gray.point(lambda v: min(255, int(v * 0.97 + 4))),
            gray.point(lambda v: min(255, int(v * 1.00 + 4))),
            gray.point(lambda v: min(255, int(v * 1.05 + 5))),
        ),
    )
    silver = cool.convert("RGBA")
    silver.putalpha(card.getchannel("A"))
    return silver


def main() -> int:
    for path in (SRC_PANDA, SRC_BACKGROUND):
        if not path.exists():
            sys.stderr.write(f"[错误] 缺少源素材：{path}（本目录不随仓库分发，请放置后重试）\n")
            return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    card = build_card()
    assert card.size == (WIDTH, HEIGHT)

    for name, image in (("panda-card", card), ("panda-card-silver", silver_variant(card))):
        png = OUT_DIR / f"{name}.png"
        webp = OUT_DIR / f"{name}.webp"
        image.save(png)
        image.save(webp, quality=95, method=5)
        print(f"已输出 {png.relative_to(ROOT)} / {webp.relative_to(ROOT)}")

    print("[完成] Demo 商品 B 卡面已生成。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
