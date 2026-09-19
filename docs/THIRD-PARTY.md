# 第三方依赖与许可证（THIRD-PARTY）

本文列出本组件实际使用的第三方依赖、许可证、是否打包进产物，并附上**逐字准确**的许可证原文，
以及「评估过但未引入源码」的同类项目清单和素材版权结论。

---

## 1. 依赖清单

### 1.1 运行时依赖（会打包进产物）

| 名称 | 版本 | 用途 | 许可证 | 主页 | 是否打包进产物 |
| --- | --- | --- | --- | --- | --- |
| `@kongyo2/cards-css` | `0.5.0`（精确锁定，`package.json` 中为 `"0.5.0"`） | 3D 倾斜、弹簧回位、指针交互、光泽 / 高光、箔效果（本组件的底层库） | MIT | <https://github.com/kongyo2/cards-css> | **是**：其 JS 与 CSS 均被打进 `dist/bank-card-showcase.es.js` / `.iife.js` / `.css`，**自托管，不依赖 CDN** |

说明：

- `@kongyo2/cards-css` **零运行时依赖**，因此我们的产物不会连带引入其它第三方代码。
- 我们**没有修改** `node_modules/` 中该库的任何源码，也没有复制它的源码到本仓库。
- 本项目自身的代码以 MIT 发布（见 [`../LICENSE`](../LICENSE)），版权行为
  `Copyright (c) 2026 Bank Card Showcase contributors`。

### 1.2 开发依赖（仅构建 / 测试，不进产物）

| 名称 | 版本（见 `package.json`） | 用途 | 许可证 |
| --- | --- | --- | --- |
| `vite` | `7.3.6`（devDependencies） | 开发服务器与库构建 | MIT |
| `vitest` | `5.0.1`（devDependencies） | 单元测试运行器 | MIT |
| `jsdom` | `27.4.0`（devDependencies） | 单测用的 DOM 环境 | MIT |
| `typescript` | `5.9.3`（devDependencies） | 类型检查 / 编译 | Apache-2.0 |
| `@types/node` | `^24.13.6`（devDependencies） | Node 类型定义 | MIT |

> 上表中的版本号取自当前 `package.json`。这些工具只在开发与构建阶段使用，
> **不会**出现在 `dist/` 产物中，也不构成运行时依赖。

### 1.3 构建链之外的依赖

- **占位素材生成**：仅使用本机 **Python 3 + Pillow**（脚本 `tools/make-placeholder-assets.py`
  与 Node 包装 `tools/make-placeholder-assets.mjs`），**不引入任何 npm 依赖**。
  Pillow 的许可证为 HPND（MIT-CMU 风格）；生成的图片是本项目自制素材，不是第三方美术资源。

---

## 2. `@kongyo2/cards-css@0.5.0` MIT 许可证原文

以下文本与 `node_modules/@kongyo2/cards-css/LICENSE` **逐字一致**（含版权行）：

```text
MIT License

Copyright (c) 2026 kongyo2

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**MIT 义务提醒：** 由于我们把该库的代码与样式打包进了 `dist/`，分发产物时需要**随附上述
版权声明与许可文本**。建议在部署目录中保留本文件（或把许可证原文一并放入你的主题说明文档）。

---

## 3. 为什么选择 `@kongyo2/cards-css`

| 理由 | 说明 |
| --- | --- |
| 许可证干净 | MIT，可商用、可打包、可修改；无附加条款 |
| 零运行时依赖 | 不会把我们拖进依赖树，产物体积与安全面都可控 |
| 提供我们需要的能力 | 3D 倾斜、弹簧回位、pointer 交互、光泽 / 高光、多种箔效果 |
| 样式作用域收敛 | 它的 CSS 选择器全部限定在 `.holo-card*` 内（仅 1 处全局 `:root { --card-* … }` 自定义属性声明）。我们在 `.bc-card` 上完整重声明同类变量，并在构建期用 `vite.plugins.ts` 把该 `:root` 收敛到 `.bc-card`（不修改依赖源码），使产物零全局写入 |
| 有 `destroy()` | 能在 SPA / 区块重渲染 / AJAX 场景中正确释放监听与动画（移植的关键前提） |
| 我们自己补的三项 | 按压缩放、全局变量收敛（构建期作用域重定向）、移动端触摸策略（默认不干扰滚动）由本包装层实现，不改动上游源码 |

---

## 4. 评估过但**未引入源码**的项目

以下项目仅作为**对比参考**（了解同类实现思路），我们**没有复制任何代码、着色器或美术资源**，
也**没有**把它们加入依赖（避免重复引入同类倾斜库、避免许可证与体积风险）：

| 项目 | 参考点 | 结论 |
| --- | --- | --- |
| [simeydotme/hover-tilt](https://github.com/simeydotme/hover-tilt) | 卡片倾斜 / 高光的交互手感 | 未引入源码，未复制代码 |
| [micku7zu/vanilla-tilt.js](https://github.com/micku7zu/vanilla-tilt.js) | 轻量 tilt 实现方式对比 | 未引入源码，未复制代码 |
| [simeydotme/pokemon-cards-css](https://github.com/simeydotme/pokemon-cards-css) | 箔 / 镭射效果的观感与实现思路对比 | 未引入源码，未复制代码或美术资源 |

> 只要引入其中一个同类倾斜库，就可能与 `@kongyo2/cards-css` 的倾斜与指针逻辑重复甚至互相打架，
> 因此本项目**只保留一个**底层倾斜库。

---

## 5. 美术资源与版权结论

1. **未复制 Balatro 的任何源代码、着色器或美术资源。** 本项目与 Balatro 无任何代码或素材关系。
2. **占位卡面是本项目自制的临时素材**（由 `tools/make-placeholder-assets.py` + Node 包装
   `tools/make-placeholder-assets.mjs` 生成到 `public/cards/`，可用 `npm run assets` 可复现），
   **不是正式卡面美术资源**，图上明确标注「TEMP PLACEHOLDER / 临时占位」。
3. **正式卡面由用户自行制作**：上线前必须用自己制作、拥有合法权利的卡面替换占位素材；
   **不得使用任何第三方版权素材**（包括但不限于官方银行卡面、品牌 logo、动漫 / 游戏插画、
   第三方图库未授权图片）。
4. 本项目**不绘制也不需要**任何第三方角色、品牌或受保护标识。

---

## 6. 相关文档

- 组件定位与脚本命令：[`../README.md`](../README.md)
- 完整参数表与 FAQ：[`USAGE.md`](USAGE.md)
- WordPress 移植步骤：[`WORDPRESS-INTEGRATION.md`](WORDPRESS-INTEGRATION.md)
- 本项目自身许可证：[`../LICENSE`](../LICENSE)
