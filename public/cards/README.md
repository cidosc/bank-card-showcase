# 卡面素材说明

本目录有两类图片：**项目提供的演示卡面**（Demo 商品 A / B 与效果对照页使用）与
**中性临时占位素材**（带 TEMP 水印，用于明暗/深度等通用测试）。

> ⚠️ 正式上线前必须把**所有**图片替换为**自制的正式卡面**（项目提供的演示图也不应作为最终上线素材）。
> 不得使用第三方受版权保护的素材、官方卡面、logo 或插画。

## 1. 项目提供的演示卡面

由 `tools/make-provided-card.py` 从 `test-assets/` 的源图生成（源图目录已被 `.gitignore` 排除，不随仓库分发）：

| 文件 | 用途 | 说明 |
| --- | --- | --- |
| `cookie-card.png` / `.webp` | 商品 A（Cookie 曲奇卡）+ 效果对照页 ① | 低多边形曲奇 + 麦田背景（源图比例即 1.5860），浅色高光美术 |
| `cookie-card-silver.png` / `.webp` | 商品 A 的独立银色原图 | 上者的派生变体（仅去饱和 + 轻微提亮），用于 `silver` 效果演示 |
| `panda-card.png` / `.webp` | 商品 B（Sad Panda 熊猫卡）+ 效果对照页 ④ | 低多边形熊猫 + 浅绿几何背景（主体抠图 + 背景合成） |
| `panda-card-silver.png` / `.webp` | 商品 B 的独立银色原图 | 上者的派生银色变体 |

生成命令（可复现，缺源图时会提示并跳过）：

```bash
python tools/make-provided-card.py
```

## 2. 中性临时占位素材（TEMP PLACEHOLDER）

由 `npm run assets` 可复现生成，带明显的「TEMP PLACEHOLDER / 临时占位」斜向水印带、
大字标题与「TEMP ASSET – NOT FINAL ARTWORK / 临时占位素材，非正式卡面」字样：

| 文件 | 用途 | 配色主题 |
| --- | --- | --- |
| `cookie.png` / `.webp` | 通用浅色占位（示例页 `examples/plain-html` 用 PNG 演示格式兼容） | 暖米色 |
| `panda.png` / `.webp` | 通用浅色占位（效果对照页 ②） | 浅绿灰 |
| `panda-silver.png` / `.webp` | 独立银色原图占位（效果对照页 ② 的 silver 列） | 中性银灰 |
| `dark.png` / `.webp` | **深色测试卡面**（效果对照页 ③），用于暴露过曝/过暗 | 深蓝 |

## 尺寸与比例要求

- 像素尺寸：**1015 × 640**
- 宽高比：**1.586 : 1**（1015 / 640 = 1.5859375，符合银行卡 ISO/IEC 7810 ID-1）
- 卡面圆角按 ISO 比例：水平半径 = 宽度 **3.72%**，垂直半径 = 高度 **5.89%**
- 图像为 RGBA，圆角以外区域透明
- 格式：WebP 优先（体积更小），PNG 兼容；组件在 `imageFit: "contain"` 下完整显示、不裁切不拉伸

## 替换为正式卡面时

1. 保持相同文件名与路径，或同步更新引用（Demo 在 `src/demo/mock-data.ts`，对照页在 `examples/effects-gallery/index.html`）。
2. 保持 1.586 : 1 比例（如 1015 × 640），避免变形。
3. 只使用自制、拥有合法权利的素材。
4. 替换后跑一次 `npm run build && npm run build:demo && npm run acceptance`：
   16 项 `exposure.*` 检查会给出新卡面的曝光数值（判据：平均亮度偏移 ≤ 12、高光/暗部削波 ≤ 3%），
   对照页 `examples/effects-gallery/index.html` 可同时目视复核。
