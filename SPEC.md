# 实现契约（冻结）— Bank Card Showcase

> 本文件是给实现代理看的唯一权威约定。**不要修改本文件描述之外的文件**，
> 需要新增约定时由主控更新。所有路径相对项目根目录
> `D:/Softerware/AHack/bank-card-showcase`。

## 0. 硬约束（违反即返工）

1. **绝对不修改** `D:/Softerware/AHack` 下的 WordPress 站点文件、配置、数据库。
   本项目是完全独立的目录，只在本目录内工作。
2. 不引入 React/Vue/Svelte 或任何大型 UI 框架。不使用在线 CDN。
3. 不修改 `node_modules/` 里第三方依赖的源码。
4. 所有自定义 CSS 类名必须以 `bc-` 开头，样式必须限定在 `.bc-*` 选择器内；
   禁止出现 `:root`、`html`、`body`、`*` 等全局选择器（`@media`/`@supports` 除外）。
5. 不绘制正式卡面美术资源，占位图必须是明确标注的临时占位。
6. 不实现购物车、订单、支付、数据库、后台、用户系统。
7. 依赖版本已固定，**不要新增任何 npm 依赖**（需要时先问主控）。
8. TypeScript 严格模式通过 `npm run typecheck`；不要用 `any` 绕过类型。

## 1. 已有素材与结论（研究阶段产出，勿重复调研）

- 选定底层库：`@kongyo2/cards-css@0.5.0`（MIT，零运行时依赖，已安装）。
  - 提供：3D 倾斜、弹簧动画、pointer 交互、光泽/高光、14 种箔效果、
    `prefers-reduced-motion`（仅用于 showcase 自动动画）、`destroy()`。
  - 关键 API：`createHoloCard(options) → HoloCard`、`card.element`、
    `card.setEffect(effect)`、`card.setVisual(visual)`、`card.setVars(vars)`、
    `card.destroy()`。
  - 相关选项：`aspectRatio`（直接写入 `--card-aspect`，即 CSS `aspect-ratio` 的「宽 / 高」；
    横版银行卡为 1.586。**不要写 `1 / aspectRatio`**）、`physics.maxTilt`（默认 14.29）、`interactive`、
    `visual.{imageFit,shineOpacity,glareOpacity,brightness}`、
    `glow`、`textureSeed`、`gyroscope: false`。
  - DOM 结构：`.holo-card > .holo-card__translater > .holo-card__rotator > .holo-card__front > img.holo-card__image`
    （另含 `.holo-card__shine` / `.holo-card__glare`）。
  - 底层**没有**：按压缩放、`pointerdown` 处理、`:root` 变量隔离
    （其 base.css 会在 `:root` 写自定义属性）、触摸倾斜策略。
    → 这三项由我们的包装层补齐（第 3 节）。
  - 底层 CSS 全部选择器都在 `.holo-card*` 作用域内（已核对 dist/holo-cards.css），
    唯一的全局写入是 1 处 `:root { --card-* ... }` 自定义属性。
    → 我们在 `.bc-card` 上重新声明必要的变量，使组件不依赖站点全局变量。

## 2. 文件所有权（严格按此分工，不要动别人的文件）

| 文件 | 负责人 |
| --- | --- |
| `package.json` / `tsconfig.json` / `vite.config.ts` / `vite.demo.config.ts` / `SPEC.md` / `src/types.ts` / `src/effects.ts` / `src/index.ts` | 主控（代理只读） |
| `src/bank-card/bank-card.ts`、`src/bank-card/pointer-feedback.ts`、`src/styles/bank-card.css`、`tests/bank-card.test.ts` | 代理 A（核心组件） |
| `assets/cards/src/*.svg`、`tools/make-placeholder-assets.mjs`、`public/cards/*` | 代理 B（占位素材） |
| `index.html`、`src/demo/*`、`src/showcase/product-showcase.ts`、`src/styles/product-showcase.css`、`tests/product-showcase.test.ts` | 代理 C（Demo + 商品容器） |
| `examples/plain-html/*`、`README.md`、`docs/*` | 代理 D（示例与文档） |
| `tests/*` 只允许改自己负责的测试文件 | — |

`src/index.ts` 已经 import 下列文件，实现必须提供这些导出：

```
src/bank-card/bank-card.ts   → export function createBankCard(options: BankCardOptions): BankCardInstance
src/showcase/product-showcase.ts → export function createProductShowcase(options: ProductShowcaseOptions): ProductShowcaseInstance
src/styles/bank-card.css
src/styles/product-showcase.css
```

## 3. `createBankCard` 实现要求

### 3.1 DOM 结构（由我们构建）

```html
<div class="bc-card" data-bc-effect="holographic" style="--bc-aspect:0.6305;--bc-press:0.98">
  <!-- 由 createHoloCard() 生成的 .holo-card 元素直接作为子元素 -->
</div>
```

- 根元素只加 `bc-card` 与可选 `className`。
- 挂载点由 `mount(target)` 决定：`target` 为字符串时用 `document.querySelector`；
  找不到时抛出明确错误。`mount` 可重复调用（第二次移动元素，不重复创建实例）。

### 3.2 参数归一化（默认值）

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `imageAlt` | `""` | |
| `effect` | `"normal"` | 非法值回退 `"normal"` |
| `maxTilt` | `7` | 夹紧到 `0..20`（防止弹簧过冲导致翻面） |
| `interactive` | `true` | |
| `shine` | `true` | `false` 时 `glareOpacity = 0` 且不显示箔高光 |
| `intensity` | `1` | 夹紧 `0..1` |
| `pressScale` | `0.98` | 夹紧 `0.9..1`；`1` = 关闭反馈 |
| `dragTilt` | `true` | |
| `touchTilt` | `"off"` | |
| `aspectRatio` | `1.586` | 夹紧 `1..3`；传给底层的是 `1 / aspectRatio` |
| `respectReducedMotion` | `true` | |
| `imageFit` | `"contain"` | 完整显示，不裁切 |
| `textureSeed` | 无 | 若效果 `needsSeed` 且未提供 → `seedFromImage(image)` |

### 3.3 传给底层库的固定参数（必须遵守）

```ts
createHoloCard({
  image: 当前应用的图片（silver 效果且提供 silverImage 时用它）,
  imageAlt,
  effect: plan.effect,                 // 来自 resolveEffectPlan()
  aspectRatio: aspectRatio,              // 横版银行卡 = 1.586（直接传，不要取倒数）
  interactive: effectiveInteractive,
  gyroscope: false,                    // 不请求设备方向权限
  activateOnClick: false,              // 不需要“点开放大”弹层
  showcase: false,                     // 不使用自动动画
  backdrop/back: 不传,                 // 永不显示背面
  textureSeed: needsSeed ? seed : undefined,
  visual: {
    imageFit,                          // "contain"
    shineOpacity: plan.shineOpacity,
    glareOpacity: shine ? plan.glareOpacity : 0,
    brightness: plan.brightness,
  },
  physics: { maxTilt, returnDelay: 220 },
  className: "bc-card__holo",
})
```

`effectiveInteractive = interactive && (允许精细指针 || touchTilt === "on") && !(reducedMotion && respectReducedMotion)`。

- 精细指针判定：`window.matchMedia("(hover: hover) and (pointer: fine)").matches`
  （jsdom 下 matchMedia 可能不存在 → 必须做存在性判断，缺失时视为精细指针）。
- `reducedMotion`：`matchMedia("(prefers-reduced-motion: reduce)")`。
  **必须在 `update()` 时重新读取**，并通过 matchMedia 的 `change` 事件监听变化
  （监听器必须在 `destroy()` 中移除）。
- 当 `effectiveInteractive` 为 false 时，底层会退化为纯 CSS hover 兜底；
  这符合“移动端不干扰滚动”的要求。

### 3.4 按压 / 拖拽（包装层补齐）

- 监听**自己**的根元素 `.bc-card` 上的 `pointerdown`（`pointerType === "mouse"` 时）
  → 设置 `--bc-press: <pressScale>`（CSS 用过渡做缩放）。松开 / 中断 / 失焦恢复 `1`。
- 必须在 `window` 上兜底监听 `pointerup` / `blur`，并监听 `document` 的
  `visibilitychange`，任何情况下不得让卡片停留在按下态。
- 悬停倾斜与拖拽倾斜都由底层 `pointermove` 提供，**不要重复实现倾斜算法**；
  我们只需在 `dragTilt: false` 时通过 `setVisual`/CSS 关闭吗？——不，保持底层行为即可，
  但 `dragTilt === false` 时必须保证按压不会改变角度：实现方式为不向底层传递任何
  额外倾斜，并（可选）在按下时给根元素加 `data-bc-dragging` 供 CSS 观测。
- `touch-action` 在 CSS 中固定为 `pan-y`（允许纵向滚动）。
- 所有监听器必须记录并在 `destroy()` 中移除；`pointer-feedback.ts` 应导出
  `attachPressFeedback(root, opts) → () => void` 这类纯函数，便于单测。

### 3.5 `update` / `destroy`

- `update(partial)`：只处理提供的键；图片（含 `silverImage`）变化时更新 `img.src`
  与 `alt`（不允许重建实例）；`effect` 变化时调用 `card.setEffect()` 与 `setVisual()`；
  `interactive` / `touchTilt` / `maxTilt` 变化时重建底层实例并**完全销毁旧的**
  （底层未提供 setInteractive/setMaxTilt 之类的运行时接口时，允许
  `oldCard.destroy()` 后重新 `createHoloCard`，但必须保证不泄漏监听器）。
- `destroy()`：调用底层 `card.destroy()`、释放我们自己的监听、移除根元素，幂等。
- 重复 `mount()` / `destroy()` 不产生重复监听器（测试会断言）。

## 4. `createProductShowcase` 实现要求

轻量容器，无框架，纯命令式，返回 `{ element, card, mount, update, destroy }`。

```html
<div class="bc-showcase">
  <div class="bc-showcase__media"><!-- .bc-card 挂这里 --></div>
  <div class="bc-showcase__info">
    <h3 class="bc-showcase__name">…</h3>
    <p class="bc-showcase__desc">…</p>
    <div class="bc-showcase__price">…</div>
    <div class="bc-showcase__stock" data-bc-stock-state="in-stock">…</div>
    <div class="bc-showcase__actions"><button class="bc-btn bc-btn--primary">…</button></div>
  </div>
</div>
```

- 桌面端左右布局，移动端（`max-width: 720px`）上下布局。
- 视觉：浅绿 + 白色，简洁；商品信息区是独立白色卡片。
- 按钮点击只调用 `onAction(id, product)`，不做任何真实业务。
- 安全：所有文本用 `textContent` / `createElement`，**禁止 innerHTML 拼接动态数据**。
- 所有样式写在 `src/styles/product-showcase.css`，只允许 `.bc-showcase*` / `.bc-btn*` 选择器。
- `update()` 支持仅更新商品数据（含切换卡面与效果）。

## 5. 测试要求（最小必要）

- 测试框架：`vitest` + `jsdom`（已安装），测试文件放 `tests/`。
- 必须覆盖：效果映射（`resolveEffectPlan` / `seedFromImage`）、
  参数归一化与夹紧、`mount` 重复调用不重复绑定、`destroy` 幂等且移除监听、
  `update` 切换图片/效果、按压反馈在中断/失焦后能复位、
  `createProductShowcase` 渲染数据且按钮回调正确。
- 单测不得依赖真实网络图片（用 `data:` URL 或字符串路径即可）。
- 运行：`npx vitest run`（主控会统一跑）。测试必须能通过。

## 6. 交付与验收（主控执行）

- `npm run typecheck`、`npm test`、`npm run build`（产物 `dist/`）、`npm run build:demo`。
- 用浏览器在桌面宽度（1440/1280/768）与移动宽度（390）验证：
  比例 1.586、无横向溢出、特效切换、减少动效、滚动不受影响。
- 单次命令的总运行上限：构建/测试各 ≤120 秒，超过先看日志再决定重跑。

## 7. 冻结后的追加变更（主控维护）

以下变更在原契约（第 1–6 节）冻结之后实施，均已通过测试与浏览器验收：

1. **`aspectRatio` 方向修正**（第 3.3 节原写 `1 / aspectRatio` 有误）：
   底层 `--card-aspect` 就是 CSS `aspect-ratio` 的「宽 / 高」，因此横版银行卡**直接传 1.586**。
2. **`dragTilt` 语义落地**：`false` 时按下会钉住当前倾角（拖动不再改变角度），松开后由弹簧回到
   指针对应的角度；`true`（默认）保持底层原生拖拽倾斜。
3. **新增对外参数 `surface: "flat" | "physical"`（默认 `"flat"`）**：卡面质感。
   `flat` 覆盖底层较重的黑色投影（改为 1px 内描边 + 两段极轻阴影）、去掉霓虹边缘/辉光、
   把透视从 `600px` 放宽到 `1000px`；`physical` 保持底层原样。只影响投影 / 边缘 / 透视，
   不影响特效；切换不重建实例（`data-bc-surface` 属性 + CSS）。
4. **新增 `src/surfaces.ts`**：导出 `BANK_CARD_SURFACES = ["flat", "physical"]`（供上层构建切换控件）。
5. **构建期全局变量收敛**：`vite.plugins.ts` 在产物 CSS 上把依赖自带的 `:root{…}` 选择器改写为
   `.bc-card{…}`（**不修改依赖源码**），使 `dist/` 实现零全局样式写入；由验收项
   `styles.noGlobalSelectors` 持续守住。
6. **验收脚本**（`tools/acceptance.mjs`，零依赖 CDP）：69 项检查 + 截图，并在报告里写入
   代码/产物指纹（`manifest` / `manifestDigest`），可用 `npm run baseline` 校验漂移。
7. **商品容器投影变量化**：`.bc-showcase__info` 的投影改由宿主变量 `--bc-showcase-info-shadow`
   控制，宿主可在任意祖先上调轻/调重，无需覆盖组件类名。
8. **效果参数按“曝光约束”重定**：`BASE` 表中四种效果的 `shineOpacity / glareOpacity / brightness`
   下调，并新增 `contrast` / `saturate` 乘数（均 ≤ 1）。依据是像素级实测：旧档位在浅色卡面上出现
   24–27% 高光削波、银色卡面亮度偏移 −46 ~ +37；现行档位把最大偏移收到 9.2、削波收到 0.01%。
   判据与回归检查：`tools/acceptance.mjs` 的 16 项 `exposure.*`（|Δmean| ≤ 12、削波 ≤ 3%，4 张卡面 × 4 效果），
   测量入口为 `examples/effects-gallery/index.html`（静态对照页，3 类卡面 × 4 效果 + 原图基线）。
9. **新增 `tools/png-luma.mjs`**：零依赖 PNG 解码 + 亮度/削波统计，供验收脚本量化“过曝 / 过暗”。

10. **本地测试素材目录 `test-assets/`**：放置项目负责人提供的测试卡面（不在 `publicDir` 内，
    不进入 `dist/` 与 `dist-demo/`，已在 `.gitignore` 中）；`examples/effects-gallery` 第 ④ 组
    与曝光审计会**自动探测**它，文件缺失时自动跳过（不影响验收通过）。
    当前内容：低多边形熊猫 + 浅绿几何背景合成成的 1015×640 卡面（平均亮度 169），
    以及两张原始素材与可复现脚本说明。
11. **效果参数第二轮收敛**：在真实感卡面上补测后发现第一轮仍偏亮（holo +13.1 / glitter +13.6），
    再收一档至 `shine 0.34–0.48 / brightness 0.72–1`。最终 4 张卡面的最大亮度偏移 9.5、削波 ≤ 0.01%。

12. **dev 工作流修复**：`publicDir: false` 曾同时影响 `vite dev`，导致 dev 页面取不到 `/cards/*`
    （回退成 index.html）。现改为 `publicDir: "public"` + `build.copyPublicDir: false`，
    并新增 3 项验收：`dev.assets`、`dev.cardImage`、`build.libDistClean`。
13. **Demo 商品 B 的卡面改为项目提供素材**：由 `test-assets/` 的两张源图经
    `tools/make-provided-card.py` 合成 `public/cards/panda-card.{png,webp}`（1015×640，1.586:1，ISO 圆角）
    与派生银色变体 `panda-card-silver.*`；效果对照页第 ④ 组使用同一素材（单一来源）。
    `test-assets/` 只保留源图（已被 `.gitignore` 排除，不进入仓库与交付产物）。
