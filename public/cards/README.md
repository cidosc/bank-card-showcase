# 临时占位卡面素材（TEMP PLACEHOLDER）

本目录下的所有图片都是**临时占位素材（placeholder）**，仅用于银行卡式商品展示
组件的 Demo 开发与联调，**不是正式卡面美术资源**。

> ⚠️ 正式上线前必须替换为**用户自制的正式卡面**。
> 不得使用任何第三方受版权保护的素材、官方卡面、logo 或插画。

## 文件清单

| 文件 | 用途 | 配色主题 |
| --- | --- | --- |
| `cookie.png` / `cookie.webp` | 商品 A（Cookie）占位卡面 | 暖米色 |
| `panda.png` / `panda.webp` | 商品 B（Sad Panda）占位卡面 | 浅绿灰 |
| `panda-silver.png` / `panda-silver.webp` | Sad Panda 的独立银色原图，用于 `silver` 效果演示 | 中性银灰 |

每张图都带有明显的“TEMP PLACEHOLDER / 临时占位”斜向水印带、大字商品名、
以及“TEMP ASSET – NOT FINAL ARTWORK / 临时占位素材，非正式卡面”字样，
目的是让人一眼看出这是占位素材而非正式卡面。

## 尺寸与比例

- 像素尺寸：**1015 × 640**
- 宽高比：**1.586 : 1**（1015 / 640 = 1.5859375，符合银行卡 ISO/IEC 7810 ID-1 的 1.586 比例）
- 卡面圆角按 ISO 比例绘制：
  - 水平半径 = 宽度的 **3.72%**
  - 垂直半径 = 高度的 **5.89%**
- 图像为 RGBA，圆角以外的区域透明。

## 生成方式（可复现）

素材由脚本可复现地生成，**不引入任何 npm 依赖**，仅需本机 Python 3 + Pillow
（Pillow 需支持 WebP）。推荐使用 npm 脚本：

```bash
npm run assets
```

等价的直接调用：

```bash
node tools/make-placeholder-assets.mjs
# 或跳过 Node 包装，直接运行 Python
python tools/make-placeholder-assets.py
```

脚本行为：

- 由 `tools/make-placeholder-assets.py` 使用 Pillow 绘制（4 倍超采样抗锯齿），
  输出 PNG 与 WebP。
- WebP 参数固定为 `quality=92, method=6`。
- 生成结束后脚本会自动**自检**每个文件的真实格式（`PIL.Image.open().format`）、
  像素尺寸与宽高比误差，并打印结果。
- 若找不到 Python 或 Pillow，`tools/make-placeholder-assets.mjs` 会打印清晰的中文
  提示并以退出码 `1` 结束。

## 替换正式卡面时的要求

1. 保持**相同的文件名与路径**，或同步更新组件中的引用。
2. 建议保持 **1.586 : 1** 的银行卡比例（例如 1015 × 640），避免变形。
3. 必须使用**自己制作**、拥有合法权利的素材；不得使用第三方版权素材。
4. 替换后请移除图片中的“TEMP PLACEHOLDER / 临时占位”等占位标记。
