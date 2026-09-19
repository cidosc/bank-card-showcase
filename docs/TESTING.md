# 测试与验收记录（Bank Card Showcase）

本文档记录**实际执行过**的测试与验收结果，对应任务书第 10 节。所有数字都是真实运行输出，
不是预期值。复现命令见每节标题。

环境：Windows 11 + Node v22.23.2 + Chrome 153.0.8010.48（本机安装版）。
项目内 `dist/`、`dist-demo/`、`acceptance-artifacts/` 均由脚本生成，不依赖任何在线服务。

---

## 1. 分层与复现命令

| 层级 | 命令 | 规模 | 结果 |
| --- | --- | --- | --- |
| 类型检查 | `npm run typecheck` | `tsc --noEmit` 严格模式 | **0 error** |
| 单元 / 集成 | `npm test` | 2 个文件 / **59 个用例** | **59 passed**（约 2.3s，jsdom） |
| 端到端（真实 Chrome） | `npm run acceptance` | **89 个检查项** + 17 张截图 | **89 passed / 0 failed**（含 16 项曝光回归 + dev 工作流回归） |
| 基线校验 | `npm run baseline` | 对比 `acceptance-report.json` 里的代码/产物指纹 | 一致（漂移则退出码 1） |

> **关于数字的读法**：弹簧动画与截图时序会引入小幅抖动（同一产物连续运行，
> 倾角 / 回正耗时 / 不透明度会有 ≈3% 波动）。本文中的测量值写成**区间**；
> **单次运行的权威数值**请直接看 `acceptance-artifacts/acceptance-report.json`
> （含 `generatedAt` 时间戳、89 条逐项结果、17 张截图路径与代码/产物指纹）。
> 脚本断言的是**边界与容差**（如倾角 ≤ maxTilt+1.5、反光层 ≤ 0.97 且 = 计划值±0.04），
> 不是某一次的精确读数，因此可重复运行。
> `npm run baseline` 会把报告里的指纹（`src/**`、`dist/**`、`dist-demo/**`、lockfile 等 35 个文件的
> sha256 前 16 位）与当前磁盘文件逐项比对，用来回答“当前代码与产物是否就是被验收的那份”。
| 一键全流程 | `npm run verify` | typecheck → test → build → build:demo → acceptance | 全绿 |

端到端脚本 `tools/acceptance.mjs` 是**零依赖**实现：自带静态服务器 + 通过 Chrome DevTools
Protocol（CDP）驱动本机 Chrome，不引入 Playwright / Puppeteer。它会真实派发鼠标 / 触摸
事件、切换视口与 `prefers-reduced-motion`，并把截图与 JSON 报告写到 `acceptance-artifacts/`。

```bash
npm run build && npm run build:demo   # 先生成产物
npm run acceptance                    # 默认输出到 acceptance-artifacts/
node tools/acceptance.mjs --out <dir> --chrome <path>   # 可选参数
```

---

## 2. 任务书第 10 节的逐项验收

| 任务书验收项 | 对应检查项 | 实测结果 |
| --- | --- | --- |
| 桌面端不同宽度比例正确 | `layout.ratio@1440 / 1280 / 768` | 均 **1.5860**（520×328 / 520×328 / 352×222）；移动端 390/320 为 1.5860 / 1.5861，误差 < 0.01% |
| 手机端不出现横向溢出 | `layout.overflow@390 / @320` | `scrollWidth = innerWidth`（390/390、320/320），溢出 0px |
| 图片不拉伸、不裁切 | `layout.image@*` | `object-fit: contain`；原图 1015×640（1.5859）与渲染框 1.5860 一致，渲染宽 = 卡面宽（误差 ≤ 1.5px） |
| 普通卡交互正常 | `interaction.hover` / `effect.normal*` | 悬停后 `--rotate-x/y` 为 **5.5°–5.7°**；normal → 底层 `none`，反光层 0.550 |
| 最大倾角正确生效 | `interaction.maxTilt` / `maxTiltConfig` | maxTilt=7 → **5.5°–5.7°**（上限 8.5）；滑块改 14 → **11.2°–11.4°**（≈2×，且 ≤ 15.5），即倾角按配置线性缩放且始终受限 |
| 按压与拖拽不触发异常 | `interaction.press` / `dragTilt` / `dragNoTranslate` / `release` / `blurReset` | 按下 `--bc-press=0.98`、实测宽度比 **0.9800**；按住拖动倾角 -5.22°→+5.30°；卡片中心位移 **0.00px**；松开复位为 1；`window.blur` 也会复位 |
| 移出后平滑恢复 | `interaction.leave` | 回正耗时 **约 0.6–1.1s**（底层默认弹簧实测需 2s+，包装层已把回正弹簧调为 k=0.05 / c=0.32；断言上限 1.6s） |
| 特效切换正常 | `effect.normal / holographic / glitter / silver` | 分别映射到底层 `none / holo / glitter / metal`，`data-bc-effect` 与 `holo.dataset.effect` 同步 |
| 默认观感不过度夸张（阴影不厚重） | `surface.defaultFlat` / `flatPerspective` / `flatInfoShadow` | 默认 `data-bc-surface=flat`：投影最大模糊 **16px**（且带 `-12px` 负扩散）、**无纯黑重投影**、透视 `1000px`；页面白色容器同步变轻（宿主变量 `--bc-showcase-info-shadow` 生效） |
| 质感可切换且实体感可复原 | `surface.togglePhysical` / `physicalPerspective` / `backToFlat` | 切到 `physical`：恢复底层 `0 10px 20px -5px black` 重投影（最大模糊 **20px**、含纯黑）与 `600px` 透视；可再切回 `flat` |
| 镭射与碎闪不遮挡主要卡面图案 | `effect.*.artwork` + 截图 | 卡面层 opacity=1、`img` opacity=1；反光层有效不透明度 **0.550 / 0.950 / 0.900 / 0.765**（normal / holo / glitter / silver，容差 ±0.04，且永不为 1；silver 偏低是因为底层 `metal` 自带 0.9 系数） |
| 特效裁切在卡面轮廓内 | `effect.*.clip` | `overflow: hidden`；反光层尺寸与卡面层完全一致（约 520–532 × 328–341，两层相等）；圆角 `3.72% / 5.89%`（ISO 卡角） |
| 银色卡使用独立原图 | `effect.silver.image` | `img.src = panda-silver.webp`（切回 holographic 后回到 panda.webp） |
| 减少动态效果正常生效 | `reduced.flag / static / transition / resume` | `data-bc-reduced-motion=true`、`interactive=false`、悬停与按压后 `--rotate = 0`、`transition-duration = 0s`；取消系统设置后恢复交互 |
| 重复挂载和卸载不产生明显错误 | `lifecycle.stress` | 连续 5 次 destroy → mount 后仍只有 1 个 `.bc-card` / 1 个 `.bc-showcase`，且仍可正常倾斜；全程 0 console 错误 |
| 移动端滚动不受影响 | `mobile.touchAction / scroll / scrollAfterTouch` | 卡面 `touch-action: pan-y`；`scrollY=400`（页面高 2036）；触摸拖动后仍可滚动且无横向溢出 |
| 触摸默认不接管倾斜 | `mobile.touchTilt` | 移动端模拟下 `hover:hover and pointer:fine = false` → `interactive=false`（不绑定指针交互） |
| Chrome / WebKit 检查 | 见第 4 节 | Chrome 全量实测通过；WebKit **未实测**（无可用环境），如实说明 |
| 闪卡不过曝 / 不过暗 | `exposure.*`（16 项） | 4 张卡面 × 4 种效果：**最大平均亮度偏移 9.5**（判据 ≤ 12）、**最大高光削波 0.01%**（判据 ≤ 3%）。详见第 7 节 |
| 无外部 CDN 依赖 | `assets.selfHosted` | 页面声明外部资源 **0** 个，样式表 `@import` / `url(http…)` **0** 处 |
| 不改全局样式 | `styles.noGlobalSelectors` | 扫描 `dist/` 与 `dist-demo/` 的 CSS：`:root` / `html` / `body` / `*` 选择器 **0 处**（依赖自带的全局 `:root` 已在构建期收敛到 `.bc-card`，见第 5 节） |
| 无运行时错误 | `runtime.consoleErrors / network / server` | console 错误 0、未捕获异常 0、失败请求 0、静态资源 4xx/5xx 0 |

截图证据（`acceptance-artifacts/`）：5 个视口宽度、`interaction-hover-tilt`、4 种效果、
`reduced-motion`、`lifecycle-after-remount`、`mobile-390`，共 13 张，均已人工目视核对
（比例、排版、无溢出、反光不遮挡图案、银色独立原图）。

---

## 3. 由单元测试覆盖的部分

`tests/bank-card.test.ts`（32 项）与 `tests/product-showcase.test.ts`（27 项）覆盖：
（其中 54 项针对会进入产物的组件代码，5 项针对只在 Demo 存在的开发控件面板 `src/demo/dev-panel.ts`）

- 效果映射与强度公式：`intensity` 只降低反光不透明度、**永不提高亮度上限**；只有 `glitter`
  需要纹理种子，只有 `silver` 使用银色原图；`seedFromImage` 对同一 URL 稳定。
- 参数归一化与夹紧：`maxTilt 0–20`、`intensity 0–1`、`pressScale 0.9–1`、`aspectRatio 1–3`、
  非法 `effect` 回退 `normal`。
- 生命周期：重复 `mount` 不重复绑定（子元素数恒为 1）、`destroy` 幂等且逐条比对
  `window` / `document` 监听已移除、`destroy` 后 `update` 安全空操作、切换 `maxTilt /
  interactive / aspectRatio` 时重建底层实例且不残留旧节点。
- 按压反馈：`pointerup / pointercancel / blur / visibilitychange` 四种中断都会复位；
  触摸与右键不触发；`enabled=false` 时不触发。
- 减少动效：`matchMedia` 缺失时不抛错，`respectReducedMotion` 开关与 change 监听注销。
- 样式约束：组件 CSS 中**不存在** `:root` / 文档元素 / 通配符等全局选择器；
  `.bc-card` 上重新声明了底层所需的全部变量。

`intensity` 的端到端表现（无法在 Demo 控件里调整）由上述单元测试覆盖，浏览器侧只验证了
各效果的默认档位。

---

## 4. 已知限制与未覆盖项（如实记录）

1. **WebKit / Safari 未实测**：当前环境没有 macOS 或 WebKit 运行时，也没有为此引入
   Playwright 等重型依赖（按“最简必要”原则）。已做的替代检查：
   - 静态扫描 `src/`、`index.html`：未使用 `:has()`、`@container`、`color-mix()`、
     `oklch()`、`dvh`、`subgrid`、`@layer` 等高版本特性；组件只依赖 `aspect-ratio`、
     百分比圆角、CSS 自定义属性、Pointer Events、`matchMedia`（均为 Safari 15+ 能力）。
   - 仅在 Demo 页使用了 `accent-color`（Safari 15.4+，渐进增强，不支持也不影响功能）。
   - 组件样式对 `-webkit-` 前缀做了必要处理：`-webkit-tap-highlight-color`、
     `-webkit-user-select`、`-webkit-user-drag`。
   - 结论：**未在 Safari 上运行过**，不能声称 WebKit 通过；建议移植到正式站点时补一次真机 / WebKit 验证。
2. **触屏真机未实测**：浏览器侧只验证了移动视口 + 触摸模拟（`touch-action`、滚动、
   媒体查询判定）。真实触摸拖动倾斜（`touchTilt: "on"`）只在单元测试层面覆盖。
3. **宿主浏览器工具不可用**：本次验收期间，托管浏览器（betterwright）因本机 Chrome 153
   与启动器 151 的 profile 版本冲突无法启动，因此改用自建的 CDP 验收脚本完成等价的
   真实浏览器验证。修复方式（不丢登录态）：把 `BETTERWRIGHT_HOME` 指向独立目录，或删除
   `~/.betterwright/browser/profile` 后重新登录。
4. **环境注入噪声**：本机卡巴斯基会把 `gc.kis.v2.scr.kaspersky-labs.com` 的脚本注入页面，
   `assets.selfHosted` 检查因此只统计「页面自身声明 / 样式表内」的资源（均为 0 个外部依赖），
   注入请求单独作为 NOTE 输出，不算作项目依赖。
5. **卡面图片使用 `loading="lazy"`**（底层库行为）：隐藏标签页或后台截图时卡面可能尚未加载，
   真实用户不受影响；自动化截图前需确保卡片在视口内（验收脚本已处理）。
6. **占位素材不是正式卡面**：`public/cards/` 下是明确标注的临时占位图，上线前必须替换为
   用户自制、拥有合法权利的正式卡面。

---

## 5. 复审与修正记录

本交付经过一次独立复审（只读审计，逐项核对约束、重新运行 `tsc` / `vitest`、用真实 Chrome
CDP 独立复跑 `examples/plain-html`）。复审提出的问题与处理：

| 复审发现 | 严重度 | 处理 |
| --- | --- | --- |
| `docs/TESTING.md` 记录的是某一次运行的具体读数，与后来重跑的产物数值不符（回正耗时、倾角、反光层不透明度） | 中 | 已把读数改为**区间**并说明抖动来源，同时指向 `acceptance-report.json` 作为单次权威数据（见第 2 节开头的“关于数字的读法”） |
| `effect.silver.artwork` 只断言不透明度落在 `0.3–0.97`，与详情里打印的“计划值”无关，不具诊断性 | 中 | 已改为断言 **实测值 ≈ 计划值 × 底层系数（容差 ±0.04）且 ≤ 0.97**，四个效果实测 0.550 / 0.950 / 0.900 / 0.765 全部命中 |
| `tests/bank-card.test.ts` 中“destroy 后按压监听不再触发”即使用了 `dispose()` 泄漏也会通过（非诊断性） | 低-中 | 已改为：销毁前先断言按压缩放生效 → `destroy()` 后断言 `window`/`document` 监听**注册与移除完全抵扣**（泄漏即失败）→ 再断言按下不再缩放 |
| `tests/product-showcase.test.ts` 中“destroy 后旧按钮不触发回调”同样不具诊断性（有 `destroyed` 守卫兜底） | 低-中 | 已改为先取证 `.bc-showcase__actions` 容器上的 `removeEventListener("click")` 确实在 `destroy()` 时被调用 |
| 依赖注入的全局 `:root` 变量名（`--pointer-x` / `--card-scale` 等 35 个）会写入宿主根命名空间，理论上可能与主题变量同名 | 低-中 | **已从根本上消除**：新增构建期插件 `vite.plugins.ts`，把依赖自带的 `:root { … }` 选择器收敛到组件根 `.bc-card`（**不修改依赖源码**，只改写构建产物）。新增验收项 `styles.noGlobalSelectors` 持续守住“产物零全局写入”，实测 `dist/` 与 `dist-demo/` 的 `:root`/`html`/`body`/`*` 选择器均为 **0 处**，且 63 项验收全绿（渲染无回归） |
| 项目不是 git 仓库，无提交基线 → 无法证明“当前代码 = 被验收的产物” | 说明项 | 已在验收报告里加入**代码/产物指纹**（`src/**`、`dist/**`、`dist-demo/**`、lockfile 等 35 个文件的 sha256 前 16 位 + `manifestDigest`），并提供 `npm run baseline` 逐项比对当前磁盘文件（漂移则退出码 1，已实测两种路径）。未自行 `git init`（避免引入未要求的仓库状态） |
| 两个单元测试的期望值由被测函数现算（`seedFromImage` / `resolveEffectPlan`），改错常量也不会失败 | 低-中 | 已改为字面量/不变量断言：种子断言“正整数 + 同图稳定 + 异图不同 + 与派生函数一致”，反光层断言**字面量 `0.9`** |
| `examples/plain-html/README.md` 的示例代码用 `alt` 而非真实参数名 `imageAlt`，且用 `null` 而页面用 `""` | 低 | 已改为 `imageAlt` 与 `""`，并补充说明“示例页自身的 `body{}` 样式属于页面，不属于组件产物” |

复审同时独立确认：`tsc` 0 错误、55 个单测通过、`dist` 无外部 CDN 引用与图片、
`docs/THIRD-PARTY.md` 的 MIT 原文与上游 `LICENSE` 逐字一致（sha256 前 16 位同为
`3363f66adb2645b6`）、8 项参数默认值与实现一致、`examples/plain-html` 在 `file://` 下实测可用。
（复审当时的 “1 处 `:root`” 结论已由本次修正消除，现为 **0 处**，见上表第一行。）

---

## 6. 视觉调整记录：卡面质感（surface）

起因：默认观感“太真实、阴影太重”。核查后确认底层 `.holo-card__rotator` 自带两层较重的黑色投影
（`0px 10px 20px -5px black` / `0 2px 15px -5px black`），这与任务书「不能出现过度夸张的阴影」并不一致。

处理：
1. 新增对外参数 **`surface: "flat" | "physical"`，默认 `flat`**（轻量化平面风）；
   `physical` 保留底层原有的实体投影与边缘高光。切换只改变量 / 属性，**不重建实例**。
2. `flat` 的实现：在 `.bc-card[data-bc-surface="flat"]` 作用域内覆盖投影为
   `inset 0 0 0 1px`(1px 内描边) + `0 1px 2px` + `0 6px 16px -12px` 三段极轻阴影，
   把 `--card-edge` / `--card-glow` 置为 `transparent`（去掉霓虹描边与辉光），
   并把 `--card-perspective` 从 `600px` 放宽到 `1000px`（倾角保留、立体压缩感更弱）。
3. Demo 新增第 ③ 组「卡面质感（surface）」控件，可用于目视对比；
   页面自身的白色容器通过宿主变量 `--bc-showcase-info-shadow` 同步变轻（组件 CSS 不新增全局规则）。
4. 自动化：新增 6 项验收（`surface.*`），其中投影“重量”用 **box-shadow 解析出的最大模糊半径 + 是否含纯黑**
   来量化，而不是靠人眼；另新增 3 个单元测试。
5. 顺带修正一处测量方法：反光层不透明度的断言改为**等 glare 弹簧收敛到稳态后再读值**
   （此前会在弹簧过冲瞬间取样，实测过冲可达 4%，导致同一份产物出现假失败）。
   修正后四个效果的稳态读数精确等于「计划值 × 底层系数」：`0.550 / 0.950 / 0.900 / 0.765`。

---

## 7. 闪卡曝光审计记录（过曝 / 过暗）

背景：默认档位下用户反馈「有的过曝有的过暗」。为了不靠肉眼判断，本项目加入了**像素级曝光测量**：

- `tools/png-luma.mjs`：零依赖 PNG 解码 + 亮度/削波统计（平均亮度、p05/p50/p95、通道削波比例、暗部压死比例）；
- `examples/effects-gallery/index.html`：静态对照页（3 张内置卡面 + 1 张本地测试卡面 × 4 种效果，附原图基线），既是调参工具也是交付给使用方的**检查入口**；
- `tools/acceptance.mjs` 的 `exposure.*`：16 项回归检查（4 张卡面 × 4 种效果），判据为 **|平均亮度偏移| ≤ 12 且 高光/暗部削波 ≤ 3%**。

### 调整前实测（旧档位 shineOpacity 0.85–0.95）

| 卡面（原图亮度） | normal | holographic | glitter | silver |
| --- | --- | --- | --- | --- |
| 浅米 cookie（215） | Δ +2 | Δ +4.5，**高光削波 23.8–26.5%** | Δ +10~15.8，高光削波最高 15.9% | **Δ −36~−46**（p05 掉到 49） |
| 浅绿 panda（212） | Δ +2 | Δ +5，**高光削波 12–21%** | Δ +12~18 | **Δ −40~−48** |
| 深蓝 dark（45） | Δ +5 | Δ +6~15 | Δ +15~20 | **Δ +32~37** |

### 调整后实测（现行档位见 `src/effects.ts` 的 `BASE`）

| 卡面 | normal | holographic | glitter | silver |
| --- | --- | --- | --- | --- |
| 浅米 cookie（215） | Δ +1.5 | Δ +3.6 | Δ +3.6 | Δ −7.9 |
| 浅绿 panda（212） | Δ +1.6 | Δ +3.8 | Δ +5.5 | Δ −7.3（对照独立银色原图 206.5） |
| 深蓝 dark（45） | Δ +4.3 | Δ +6.0 | Δ +4.6 | Δ +9.2 |
| **本地测试卡面**（低多边形熊猫，169） | Δ +2.5 | Δ +4.3 | Δ +9.5 | Δ −3.1 |

全部卡面的削波均为 **0%–0.01%**（判据 ≤ 3%），最大亮度偏移 **9.5**（判据 ≤ 12）。

### 一个重要的过程发现

第一轮调参只用了自制占位卡面（几何 + 大字，明暗分布平坦），结果**低估**了真实美术上的问题：
换成 `test-assets/local-test-card.webp`（左侧高对比主体 + 大面积浅色背景，平均亮度 169）后，
`holographic` 实测 Δ **+13.1**、`glitter` Δ **+13.6**，双双越界。针对真实美术又收了一档后才达标。
→ 结论：**曝光验收必须包含“有明确主体 + 明暗层次”的真实感卡面**，纯色块占位图会漏掉问题。

结论：**最大亮度偏移从 48 收到 9.5，最大高光削波从 26.5% 收到 0.01%**，同时保留 4 种效果的可辨识度
（`holographic` 仍有随倾斜移动的彩虹反光，`glitter` 仍有颗粒反射，`silver` 仍提供金属光泽）。

### 主要手段与取舍

1. **降低反光/高光层不透明度**（shine 0.85–0.95 → 0.18–0.6、glare 0.7–0.85 → 0.12–0.45）：
   削波主要来自 `color-dodge` 混合模式，降低不透明度是最直接的解法。
2. **亮度不再放大**：`brightness` 从 `1.02` 降到 `0.82–1`，并新增 `contrast` / `saturate` 两个乘数
   （均 ≤ 1），从源头保证「特效不会把卡面越调越亮」。
3. **银色单独处理**：底层 `metal` 箔层自身的渐变会随卡面明暗反向摆动（浅色卡压暗、深色卡提亮），
   因此 `silver` 取最保守的一档（`shineOpacity 0.18`），并推荐使用**独立银色原图**
   （原始美术已是金属质感，特效只补光泽）——对照页第 ② 组就是这种用法。
4. **不建议**在深色卡面上用 `silver` 直接叠加普通美术：实测仍有 +9.2 的提亮；需要银色观感时请提供 `silverImage`。

---

## 8. 开发工作流回归（发现并修复的真实 bug）

**现象**：`http://localhost:5173/`（`npm run dev`）页面上看不到卡面图，`/cards/*.webp` 请求返回的是 `index.html`
（`content-type: text/html`），浏览器因此无法解码图片。

**根因**：为让“库产物不含图片”，`vite.config.ts` 里设置了 `publicDir: false`；
而 `npm run dev` 用的正是这份配置 —— **dev 模式同样不再提供 `public/`**，于是所有 `/cards/*` 都落到 SPA 回退。

**修复**：改为 `publicDir: "public"` + `build.copyPublicDir: false`
（dev 与 preview 正常提供 `public/`，仅库构建不拷贝图片）。修复后实测：
`/cards/panda-card.webp → 200 image/webp 61212B`，`dist/` 仍只有 5 个文件、0 张图片。

**回归保护**（3 项新检查，都会在 `npm run acceptance` 里跑）：

| 检查 | 做什么 |
| --- | --- |
| `dev.assets` | 临时启动一个 `vite` dev server，断言 `/cards/panda-card.webp` 返回 `200`、`content-type: image/webp` 且体积 > 10KB |
| `dev.cardImage` | 在真实浏览器里打开 dev 页面、切到商品 B，断言 `<img>` 的 `naturalWidth/Height = 1015×640`（即真的是 WebP 解码成功，而不是“路径写对了但没图”） |
| `build.libDistClean` | 断言 `dist/` 内没有任何图片（防止 `copyPublicDir` 被改回而把示例素材打进库产物） |

**WebP 可读性**：`layout.image@*` 与 `effect.productSwitchIn` 现在都显式断言
`naturalWidth/Height === 1015×640` 且 `src` 以 `.webp` 结尾 —— 用证据说明 WebP 能正常解码渲染（不是只写了路径）。
