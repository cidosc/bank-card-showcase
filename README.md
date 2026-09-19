# Bank Card Showcase

**一句话定位：** 一个**无框架依赖**的「银行卡式商品展示」前端组件 —— 把一张 1.586:1 的卡面图
变成可倾斜、带光泽 / 镭射 / 碎闪 / 金属效果的卡片，并附带一个商品信息容器。

- **独立前端项目**：与 WordPress / WooCommerce 站点**完全解耦**，只产出静态资源
  （JS + CSS），可单独构建、部署到任意静态站点。
- **唯一运行时依赖**：`@kongyo2/cards-css@0.5.0`（MIT，零运行时依赖），构建时已打包进
  `dist/` 的 JS 与 CSS，**自托管、不依赖任何 CDN**。
- **未来移植成本低**：部署构建产物 + 一个承载容器 + 少量商品数据适配代码即可
  （见 [`docs/WORDPRESS-INTEGRATION.md`](docs/WORDPRESS-INTEGRATION.md)）。
- 许可：MIT（见 [`LICENSE`](LICENSE)）。

## 目录结构

```text
bank-card-showcase/
├─ src/
│  ├─ index.ts                  公开入口：唯一的导出面（API 常量、类型、样式）
│  ├─ types.ts                  公开接口类型与每个参数的默认值说明
│  ├─ effects.ts                4 种效果 → 底层效果的映射与强度公式
│  ├─ bank-card/
│  │  ├─ bank-card.ts           createBankCard（包装层：变量隔离 / 按压 / 触摸策略 / 生命周期）
│  │  └─ pointer-feedback.ts    按压缩放、精细指针判定、reduced-motion 监听（纯函数，易单测）
│  ├─ showcase/
│  │  └─ product-showcase.ts    createProductShowcase（商品信息容器）
│  ├─ demo/                     Demo 页面源码（npm run dev / build:demo 使用）
│  └─ styles/
│     ├─ bank-card.css          组件命名空间样式（全部为 .bc-* 选择器）
│     └─ product-showcase.css   商品容器样式（.bc-showcase* / .bc-btn*）
├─ tests/                       vitest + jsdom 单测
├─ tools/                       占位素材生成脚本（Node + Python/Pillow）与零依赖端到端验收脚本
├─ public/cards/                临时占位卡面（PNG / WebP，非正式美术资源）
├─ examples/plain-html/         最小 IIFE 集成示例（可 file:// 直接打开）
├─ docs/
│  ├─ USAGE.md                  参数表、生命周期、示例、FAQ
│  ├─ WORDPRESS-INTEGRATION.md  移植步骤与数据映射建议（本阶段不开发适配器）
│  ├─ THIRD-PARTY.md            第三方依赖、许可证原文与版权结论
│  └─ TESTING.md                验收测试清单（由项目主控维护）
├─ SPEC.md                      实现契约（冻结）
├─ index.html                   Demo 入口（Vite 开发 / 构建用）
├─ dist/                        库构建产物（npm run build 生成）
├─ dist-demo/                   Demo 静态站产物（npm run build:demo 生成）
├─ package.json / tsconfig.json / vite.config.ts / vite.demo.config.ts / vite.plugins.ts / vitest.config.ts
├─ LICENSE
└─ README.md
```

> 各文件的责任归属见 [`SPEC.md`](SPEC.md) 第 2 节「文件所有权」。`docs/TESTING.md` 是**验收测试清单**，
> 由项目主控维护（本仓库不重复创建）。

## 快速开始

```bash
npm i            # 安装依赖（仅 @kongyo2/cards-css@0.5.0 + 构建/测试工具链）
npm run dev      # 启动 Vite 开发服务器，查看 Demo 页面
```

| 命令 | 作用 |
| --- | --- |
| `npm i` | 安装依赖 |
| `npm run dev` | 启动 Vite 开发服务器（Demo 页面，热更新） |
| `npm run build` | **库构建** → `dist/`：`bank-card-showcase.es.js`、`bank-card-showcase.iife.js`、`bank-card-showcase.css`（+ `.map`）。库构建不包含任何图片（`build.copyPublicDir: false`，dev 仍可正常访问 `public/`），卡面图片由接入方自托管 |
| `npm run build:demo` | Demo 静态站构建 → `dist-demo/`（含 `/cards/*` 占位图） |
| `npm run preview` | 本地预览 `dist-demo/` 产物 |
| `npm test` | 运行单测（`vitest run`，jsdom 环境） |
| `npm run test:watch` | 单测监听模式 |
| `npm run typecheck` | TypeScript 严格模式类型检查（`tsc --noEmit`） |
| `npm run assets` | 重新生成 `public/cards/` 下的临时占位卡面（需要本机 Python 3 + Pillow） |
| `npm run acceptance` | 真实 Chrome 端到端验收（89 项 + 17 张截图 → `acceptance-artifacts/`，零额外依赖） |
| `npm run baseline` | 用验收报告里的指纹校验“当前代码与产物就是被验收的那份”（漂移则退出码 1） |
| `npm run verify` | 一键全流程：typecheck → test → build → build:demo → acceptance |

最小用法：

```js
import { createBankCard } from "./dist/bank-card-showcase.es.js";
import "./dist/bank-card-showcase.css"; // dist 里样式是独立文件，需单独引入

const card = createBankCard({
  image: "/cards/panda.webp",
  imageAlt: "Sad Panda 卡面",
  effect: "holographic",
});

card.mount("#mount");   // #mount 里需要有一个承载容器元素
// card.update({ effect: "glitter" });
// card.destroy();
```

不使用打包器（普通 `<script>`，WordPress 场景）时引入 IIFE 版本，全局变量名为
`BankCardShowcase`：

```html
<link rel="stylesheet" href="bank-card-showcase.css" />
<script src="bank-card-showcase.iife.js"></script>
```

完整参数表与更多示例见 [`docs/USAGE.md`](docs/USAGE.md)，可直接双击运行的最小示例见
[`examples/plain-html/index.html`](examples/plain-html/index.html)。

## 组件能力概览

**4 种对外的卡面效果**（内部映射到底层 `@kongyo2/cards-css` 的效果名）：

| 对外效果 | 底层效果 | 观感 | 说明 |
| --- | --- | --- | --- |
| `normal` | `none` | 只倾斜 + 轻微光泽，最克制 | 默认值 |
| `holographic` | `holo` | 镭射彩虹反光，随倾斜流动 | 箔层半透明，避免盖住卡面图案 |
| `glitter` | `glitter` | 细腻颗粒碎闪 | 使用纹理种子保证同一张卡渲染稳定 |
| `silver` | `metal` | 中性金属光泽 | 可搭配 `silverImage` 独立银色原图 |

**卡面质感 `surface`**（默认 `"flat"`）——只影响投影 / 边缘 / 透视，**不改特效**：

| 取值 | 观感 |
| --- | --- |
| `flat`（默认） | 轻量化平面风：极轻的两段投影 + 1px 内描边、去掉霓虹边缘与辉光、3D 透视收平（`1000px`），与简洁浅色页面融为一体 |
| `physical` | 较强实体感：保留底层较重的黑色投影与边缘高光（`600px` 透视），适合暗色 / 沉浸式场景 |

运行时切换：`card.update({ surface: "physical" })`（只改变量与属性，**不重建实例**）。

**交互与生命周期：**

| 能力 | 说明 |
| --- | --- |
| 指针交互 | 3D 倾斜、弹簧回位、光泽/高光跟随指针（由底层库提供，包装层不重复实现倾斜算法） |
| 按压缩放 | 鼠标按下时缩放，默认 `0.98`；松开 / 中断 / 失焦 / 切后台都会复位，不会卡在按下态 |
| 触摸策略 | 默认 `touchTilt: "off"`，移动端不接管手势，**不干扰页面滚动**（CSS `touch-action: pan-y`） |
| 减少动效 | 默认尊重 `prefers-reduced-motion: reduce`：卡片完全静止（无倾斜、无缩放、无过渡） |
| 生命周期 | `mount` / `update` / `setEffect` / `destroy`；`element` / `options` / `destroyed` 三个只读属性 |
| 商品容器 | `createProductShowcase` 渲染名称、说明、价格、库存、操作按钮（桌面左右、移动端上下布局） |

## 无框架依赖与命名空间隔离

- **不用任何 UI 框架**：不依赖 React / Vue / Svelte，纯命令式 API，任何技术栈都能调用。
- **样式不污染站点**：所有类名以 `bc-` 前缀开头，样式规则只写在 `.bc-*` 选择器内；
  从不使用全局根选择器、文档元素选择器或通配符选择器。
- **零全局样式写入**：底层 `@kongyo2/cards-css` 自带的样式表里有一处全局 `:root { --card-* … }`
  自定义属性声明（不含视觉属性）。构建期由 `vite.plugins.ts` 把它收敛到组件根 `.bc-card` 上
  （**不修改依赖源码**），因此 `dist/` 产物中 **不再存在任何全局选择器**（`:root` / `html` /
  `body` / `*`），也不会向宿主根命名空间写入变量；验收脚本的 `styles.noGlobalSelectors`
  会持续守住这一点。
- **不依赖站点全局变量**：本组件在 `.bc-card` 上完整重声明了底层所需的全部变量，
  因此即使站点没有提供任何全局样式也能正确渲染。
- **状态钩子**（可用于主题微调，均为组件根元素上的属性 / 变量）：
  `data-bc-effect`（当前效果）、`data-bc-press`（`on` / `off`）、
  `data-bc-reduced-motion`（`true` / `false`）、`data-bc-dragging`（按住拖动中）；
  CSS 变量 `--bc-aspect`（宽高比）、`--bc-press`（按压缩放）。
- **常量**：`NAMESPACE`（`"bc"`）、`VERSION`（`"0.1.0"`）、`BANK_CARD_EFFECTS`。

## 检查入口（先看效果再谈接入）

| 入口 | 打开方式 | 用途 |
| --- | --- | --- |
| **闪卡效果对照页** | `npm run build` 后直接双击 `examples/effects-gallery/index.html` | 4 种效果 × 浅色/深色卡面并排对比，附**原图基线**与实测亮度；检查过曝 / 过暗、切换质感与强度。说明见 `examples/effects-gallery/README.md` |
| **完整商品 Demo** | `npm run dev` → `http://localhost:5173/` | 商品布局（桌面左卡右信息 / 移动上下）、开发控件、生命周期演示 |
| **纯 HTML 集成示例** | `npm run build` 后直接双击 `examples/plain-html/index.html` | 最小接入示例（IIFE + `<link>`/`<script>`），含 4 个生命周期按钮 |
| **量化验收** | `npm run acceptance` | 89 项真实 Chrome 检查 + 截图 → `acceptance-artifacts/`（含 16 项曝光审计、dev 工作流回归与基线指纹） |

## 交给站点开发代理的接入提示词

`docs/INTEGRATION-PROMPT.md` 是一份可以直接复制给网站开发会话的提示词：包含仓库地址、本机构建路径、
硬性约束（不重复造轮子、不移植 Demo 控件）、接入步骤与代码片段、冻结的公开接口速查、以及逐条验收清单。

## 移植到 WordPress

本项目**当前阶段不开发** WooCommerce 适配器插件，只提供构件与移植指引。整体思路是：
**把 `dist/` 的三个文件放进主题（或子主题）的 assets 目录 → 用 `wp_enqueue_script` /
`wp_enqueue_style` 引入 → 在模板里放一个承载容器 → 用少量 JS 把商品数据映射进去**。

逐步操作、示例 PHP 片段与 WooCommerce 字段映射建议见
[`docs/WORDPRESS-INTEGRATION.md`](docs/WORDPRESS-INTEGRATION.md)。

## 第三方依赖与许可证

| 名称 | 版本 | 用途 | 许可证 | 是否打包进产物 |
| --- | --- | --- | --- | --- |
| `@kongyo2/cards-css` | `0.5.0` | 3D 倾斜 / 弹簧 / 光泽 / 箔效果（组件底层） | MIT | 是（JS 与 CSS 均已打包，自托管） |
| `vite` / `vitest` / `jsdom` / `typescript` / `@types/node` | 见 `package.json` | 仅构建与测试（devDependencies） | 见各自许可证 | 否 |

依赖全文、许可证原文、选型理由与「评估过但未引入源码」的同类项目清单见
[`docs/THIRD-PARTY.md`](docs/THIRD-PARTY.md)。本项目自身代码以 MIT 发布，见 [`LICENSE`](LICENSE)。

## 素材说明

`public/cards/` 下有两类图片：

| 类别 | 文件 | 说明 |
| --- | --- | --- |
| 项目提供的演示卡面 | `cookie-card.*`、`panda-card.*`、`panda-card-silver.*`、`cookie-card-silver.*` | 由 `tools/make-provided-card.py` 从 `test-assets/` 的源图生成（1015×640，1.586:1，ISO 圆角）；Demo 商品 A / B 与效果对照页使用它们 |
| 中性临时占位 | `cookie.*`、`panda.*`、`panda-silver.*`、`dark.*` | 由 `npm run assets` 可复现生成，带「TEMP PLACEHOLDER / 临时占位」水印，用于明暗/深度等通用测试 |

**上线前必须把上述所有图片替换为自制、拥有合法权利的正式卡面**（项目提供的演示图也不应作为最终上线素材）。

## 验收测试

- 可自行执行的检查：`npm run typecheck`、`npm test`、`npm run build`、`npm run build:demo`，
  以及用浏览器打开 [`examples/plain-html/index.html`](examples/plain-html/index.html) 手动验证交互。
- 完整的验收清单（桌面 / 移动宽度、比例 1.586、无横向溢出、效果切换、减少动效、滚动不受影响）
  见 [`docs/TESTING.md`](docs/TESTING.md)（由项目主控维护）。

> 本文档只描述组件已实现的行为；**不代表任何环境下的验收结论**。实际验收结果以项目主控
> 在真实浏览器中的测试记录为准。
