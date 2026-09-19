#!/usr/bin/env python
"""由 test-assets/ 的源素材生成 Demo 卡面（商品 A / 商品 B）。

支持两种素材形态：
  1) 合成型（composite）：一张带透明通道的主体抠图 + 一张背景图 → 合成卡面
  2) 整幅型（plain）：一张已经是完整卡面构图（满幅、无黑边）的图 → 直接归一化

输入（缺失的会被跳过，不报错）：
  test-assets/source-panda.png        + test-assets/source-background.png  → public/cards/panda-card.{png,webp}
  test-assets/source-cookie.png                                                  → public/cards/cookie-card.{png,webp}

输出（1015×640，1.586:1，银行卡 ISO 圆角，圆角外透明）：
  public/cards/panda-card.{png,webp}          + panda-card-silver.{png,webp}
  public/cards/cookie-card.{png,webp}         + cookie-card-silver.{png,webp}

用法：python tools/make-provided-card.py
说明：输出文件会随 Demo 构建进入 dist-demo/cards/；源图在 test-assets/ 下（已被 .gitignore 排除），不随产物发布。
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
ASSETS = ROOT / "test-assets"
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


def fit_canvas(image: Image.Image) -> Image.Image:
    """等比缩放到刚好覆盖 1015×640，再居中裁掉溢出（零拉伸）。"""
    scale = max(WIDTH / image.size[0], HEIGHT / image.size[1])
    resized = image.resize((round(image.size[0] * scale), round(image.size[1] * scale)), Image.LANCZOS)
    left = (resized.size[0] - WIDTH) // 2
    top = (resized.size[1] - HEIGHT) // 2
    return resized.crop((left, top, left + WIDTH, top + HEIGHT))


def build_composite(subject_path: Path, background_path: Path) -> Image.Image:
    subject = Image.open(subject_path).convert("RGBA")
    subject = subject.crop(subject.getchannel("A").point(lambda v: 255 if v > 10 else 0).getbbox())

    background = fit_canvas(Image.open(background_path).convert("RGB"))

    target_h = round(HEIGHT * PANDA_HEIGHT_RATIO)
    target_w = round(subject.size[0] * target_h / subject.size[1])
    position = (round(WIDTH * PANDA_LEFT_RATIO), round(HEIGHT * PANDA_BOTTOM_RATIO) - target_h)

    canvas = background.convert("RGBA")
    canvas.alpha_composite(subject.resize((target_w, target_h), Image.LANCZOS), position)
    canvas.putalpha(ImageChops.multiply(canvas.getchannel("A"), rounded_mask()))
    return canvas


def build_plain(source_path: Path) -> Image.Image:
    image = Image.open(source_path)
    canvas = fit_canvas(image.convert("RGBA"))
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


def save(key: str, card: Image.Image) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    assert card.size == (WIDTH, HEIGHT), card.size
    for name, image in ((key, card), (f"{key}-silver", silver_variant(card))):
        png = OUT_DIR / f"{name}.png"
        webp = OUT_DIR / f"{name}.webp"
        image.save(png)
        image.save(webp, quality=95, method=5)
        print(f"已输出 {png.relative_to(ROOT)} / {webp.relative_to(ROOT)}")


def main() -> int:
    produced = 0
    skipped: list[str] = []

    # 商品 B：合成型（主体抠图 + 背景）
    panda = ASSETS / "source-panda.png"
    background = ASSETS / "source-background.png"
    if panda.exists() and background.exists():
        print("-> 生成 panda-card（合成型）")
        save("panda-card", build_composite(panda, background))
        produced += 1
    else:
        skipped.append(f"panda-card（缺 {panda.name} 或 {background.name}）")

    # 商品 A：整幅型（已是完整卡面构图）
    cookie = ASSETS / "source-cookie.png"
    if cookie.exists():
        print("-> 生成 cookie-card（整幅型）")
        save("cookie-card", build_plain(cookie))
        produced += 1
    else:
        skipped.append(f"cookie-card（缺 {cookie.name}）")

    if skipped:
        print("\n[跳过] " + "；".join(skipped))
        print("       把对应源图放进 test-assets/ 后重新运行本脚本即可。")

    if produced == 0:
        sys.stderr.write("\n[错误] test-assets/ 下没有任何可用的源素材，未生成任何卡面。\n")
        return 1

    print(f"\n[完成] 共生成 {produced} 张卡面（含各自的银色变体）。")
    print("提示：这些是演示素材，正式上线前请替换为最终自制卡面。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
