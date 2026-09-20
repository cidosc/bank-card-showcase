# 使用文档（USAGE）

面向**未来接入本组件的开发者**：安装引入方式、完整参数表、生命周期、代码示例、设计说明与常见问题。

- 公开 API 全部从入口导出：`createBankCard`、`createProductShowcase`、`BANK_CARD_EFFECTS`、
  `resolveEffectPlan`、`seedFromImage`、`isBankCardEffect`、`NAMESPACE`、`VERSION`。
- 参数默认值与类型以 [`../src/types.ts`](../src/types.ts) 为准；本文档逐条对应，未实现的功能不会出现在这里。
- 组件**不做**购物车、订单、支付、数据库、后台、用户系统；按钮只回调，不产生真实业务。

---

## 1. 安装 / 引入

本项目是**私有前端项目**（`package.json` 中 `private: true`，未发布到 npm 包名），因此按
**文件路径**引入构建产物，而不是 `import ... from "bank-card-showcase"`。

### 1.1 ESM（打包器项目）

先把 `dist/bank-card-showcase.es.js` 与 `dist/bank-card-showcase.css` 放进你的工程
（例如 `vendor/bank-card-showcase/`），再按路径引入。**样式是独立文件，必须单独引入**：

```js
import { createBankCard } from "./vendor/bank-card-showcase/bank-card-showcase.es.js";
import "./vendor/bank-card-showcase/bank-card-showcase.css";
```

> 只在打包器里使用时也可以直接引用本仓库的源码入口（`src/index.ts`）——该入口已自带样式
> 引入，打包器会自动处理 CSS。

### 1.2 普通 `<script>`（IIFE，无打包器 / WordPress 场景）

```html
<link rel="stylesheet" href="bank-card-showcase.css" />
<script src="bank-card-showcase.iife.js"></script>
<script>
  // IIFE 会把 API 挂到全局变量 BankCardShowcase 上
  var { createBankCard } = window.BankCardShowcase;

  createBankCard({ image: "/cards/panda.webp", imageAlt: "Sad Panda 卡面" }).mount("#mount");
</script>
```

- 全局变量名：**`BankCardShowcase`**
- 构建产物已把底层 `@kongyo2/cards-css` 的 JS 与 CSS **一起打包**，**自托管，不依赖 CDN**，也不会
  在运行时去请求任何外部资源（图片除外，图片 URL 由你提供）。
- 无需 `type="module"`，可以在 `file://` 下直接双击运行（参见
  [`../examples/plain-html/index.html`](../examples/plain-html/index.html)）。

---

## 2. `createBankCard(options)` 完整参数表

除 `image` 外全部可选。**非数字 / 非法枚举值会回退为默认值，越界数值会被夹紧**（不是报错）。
归一化后的结果可通过 `instance.options` 读取。

| 参数 | 类型 | 默认值 | 说明 | 建议取值范围 |
| --- | --- | --- | --- | --- |
| `image` | `string` | **必填** | 卡面图片 URL（PNG / WebP / SVG 均可） | 按 1.586 : 1 制作，建议 ≥ 1015 × 640 |
| `imageAlt` | `string` | `""` | 图片替代文本（可访问性） | 建议 8–40 字，说明卡面内容 |
| `silverImage` | `string \| undefined` | 无（回退 `image`） | 独立银色原图；仅当 `effect: "silver"` 且提供时使用 | 与 `image` 同比例、同尺寸 |
| `silverImageAlt` | `string \| undefined` | 回退 `imageAlt` | 银色原图的替代文本 | 同上 |
| `effect` | `"normal" \| "holographic" \| "glitter" \| "silver"` | `"normal"` | 效果类型，非法值回退 `"normal"` | 四选一 |
| `maxTilt` | `number` | `7` | 最大倾斜角度（度），`0` 表示不倾斜 | 硬性夹紧 `0–20`；建议 `3–10` |
| `interactive` | `boolean` | `true` | 是否允许指针交互（倾斜 / 拖动观赏） | 纯展示列表可设 `false` |
| `shine` | `boolean` | `true` | 是否启用光泽（反射高光层）；`false` 时高光层不透明度为 `0` 且不显示箔高光 | — |
| `intensity` | `number` | `1` | 效果强度（只影响反光 / 高光层的不透明度） | 夹紧 `0–1`；建议 `0.6–1` |
| `surface` | `"flat" \| "physical"` | `"flat"` | 卡面质感。`flat`＝轻量化平面风：投影极轻、无霓虹边缘/辉光、3D 透视更平（`1000px`）；`physical`＝较强实体感：保留底层较重的黑色投影与边缘高光（`600px` 透视）。只影响投影 / 边缘 / 透视，**不影响特效本身** | 默认 `flat`；暗色或沉浸式场景可试 `physical`；可在运行时 `update({ surface })` 切换 |
| `pressScale` | `number` | `0.98` | 鼠标按下时的缩放反馈；`1` 表示关闭 | 夹紧 `0.9–1`；非法值回退 `1`（= 关闭） |
| `dragTilt` | `boolean` | `true` | 允许按住卡片拖动调整倾角；`false` 时按下会**钉住当前倾角**（拖动不再改变角度，松开后回到指针对应的角度） | 默认保持 `true` |
| `touchTilt` | `"off" \| "on"` | `"on"` | 触屏是否允许触摸倾斜。`on`：长按（约 160ms、位移 ≤ 10px）后拖动调整倾角（任意方向），该次手势不再滚动页面；轻点 / 快速滑动不接管手势，页面照常滚动（`touch-action: pan-y`）。`off`：完全不接管触摸 | 默认 `"on"`；需要“触屏完全不响应”时设 `"off"` |
| `aspectRatio` | `number` | `1.586` | 卡片宽高比（宽 / 高，ISO/IEC 7810 ID-1 银行卡比例） | 夹紧 `1–3`；银行卡用 `1.586` |
| `textureSeed` | `number \| undefined` | 由 `image` 派生 | 碎闪 / 纹理种子；同一张卡渲染稳定 | 需要跨版本稳定时显式传正整数 |
| `respectReducedMotion` | `boolean` | `true` | 是否尊重 `prefers-reduced-motion: reduce`（为真时卡片完全静止） | 保持 `true` |
| `imageFit` | `"contain" \| "cover"` | `"contain"` | 图片显示方式；`contain` 完整显示、不裁切不拉伸；非法值回退 `contain` | 默认即可 |
| `className` | `string` | 无 | 追加到组件根元素 `.bc-card` 的类名（可用空格分隔多个） | 只加自定义类，勿改组件类 |

### 2.1 效果与强度映射（`resolveEffectPlan`）

| 对外效果 | 底层效果 | `shineOpacity`（强度 = 1 时） | `glareOpacity`（强度 = 1 时） | `brightness` | `contrast` | `saturate` | 需要纹理种子 | 使用独立银色原图 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `normal` | `none` | `0.48` | `0.36` | `1` | `1` | `1` | 否 | 否 |
| `holographic` | `holo` | `0.48` | `0.24` | `0.86` | `0.9` | `1.05` | 否 | 否 |
| `glitter` | `glitter` | `0.34` | `0.2` | `0.72` | `0.95` | `0.95` | **是** | 否 |
| `silver` | `metal` | `0.18` | `0.12` | `1` | `0.95` | `0.9` | 否 | **是**（提供 `silverImage` 时） |

> 这组数值不是随手定的：它们是在**浅米色（亮度 215）/ 浅绿（212）/ 深蓝（45）三种卡面**上实测得到的
> ——目标是让「加特效前后卡面平均亮度偏移 ≤ 12、高光削波 ≤ 3%」。
> 早期版本（`0.85–0.95`）实测出现过 **24–27% 高光削波**（镭射过曝）与**银色卡面亮度偏移 ±40**（过暗/过亮）。
> 验收脚本里的 12 项 `exposure.*` 检查会持续守住这条线（见 `docs/TESTING.md` 第 7 节）。

强度公式：`factor = 0.35 + 0.65 × clamp(intensity, 0, 1)`，然后
`shineOpacity = clamp(base × factor, 0, 1)`、`glareOpacity` 同理；
`brightness` **不随强度变化**。`seedFromImage(image)` 由图片 URL 派生稳定种子（同一 URL 每次结果相同），
仅 `glitter` 这类需要颗粒纹理的效果会用到它。

其他导出：`BANK_CARD_EFFECTS`（`["normal","holographic","glitter","silver"]`）、
`isBankCardEffect(value)`（外部值校验）、`NAMESPACE`（`"bc"`）、`VERSION`（`"0.1.0"`，便于移植时确认资源版本）。

---

## 3. 生命周期与幂等性

```js
const card = createBankCard({ image: "/cards/panda.webp", imageAlt: "Sad Panda 卡面" });

card.mount("#mount");            // 挂载
card.setEffect("glitter");       // 切换效果
card.update({ image: "/cards/cookie.webp" }); // 增量更新
card.destroy();                  // 卸载
```

| 成员 | 行为 | 幂等性 |
| --- | --- | --- |
| `mount(target)` | `target` 可为 CSS 选择器字符串或元素；找不到时抛出 `[bc] createBankCard: mount target not found: "..."` | **可重复调用**：元素已在目标容器内则不动，不会重复绑定事件 |
| `update(partial)` | **只处理显式提供且非 `undefined`** 的键；图片（含 `silverImage`）变化只替换底层 `<img>` 的 `src` / `alt`，不重建实例 | 传相同值无副作用；`update({})` 为空操作 |
| `setEffect(effect)` | 等价于 `update({ effect })` 的语法糖 | 同上 |
| `destroy()` | 调用底层销毁、移除本组件的全部监听（按压、`prefers-reduced-motion` 变化）、移除根元素 | **幂等**：重复调用是安全空操作；销毁后 `update()` 为空操作，`mount()` 会抛错（实例不可复用） |
| `element` | 组件根元素（`.bc-card`，命名空间类） | — |
| `options` | 归一化后的**只读**参数（默认值已填充、数值已夹紧） | — |
| `destroyed` | 是否已销毁（`boolean`） | — |

**关于「重建底层实例」：** `interactive`、`touchTilt`、`maxTilt`、`aspectRatio` 变化，或
`prefers-reduced-motion` 系统设置变化导致交互状态改变时，组件会**销毁旧的底层实例并创建新的**
（底层库没有对应运行时接口）。此时包装层根元素 `.bc-card` 与已挂载位置保持不变，销毁前会先
构建新实例，不会出现空窗；重复调用不会累积监听器。`effect` / `intensity` / `shine` / `imageFit` 变化则只更新
渲染，不重建实例。

**环境要求：** 组件在创建时就访问 `document` / `window`，只能在**浏览器环境**创建；SSR 场景请
在客户端挂载完成后再创建（不要放在首屏服务端渲染路径中）。

---

## 4. 代码示例

### 4.1 创建 / 挂载 / 切换 / 卸载

```js
import { createBankCard } from "./vendor/bank-card-showcase/bank-card-showcase.es.js";
import "./vendor/bank-card-showcase/bank-card-showcase.css";

const card = createBankCard({
  image: "/cards/panda.webp",
  silverImage: "/cards/panda-silver.webp", // 仅 silver 效果生效
  imageAlt: "Sad Panda 卡面",
  effect: "holographic",
  maxTilt: 7,
  aspectRatio: 1.586,
});

card.mount("#mount");                // 选择器
// card.mount(document.querySelector(".bc-mount")); // 也接受元素

card.setEffect("glitter");                          // 只换效果
card.update({ effect: "silver" });                  // 切到银色（使用 silverImage）
card.update({ image: "/cards/cookie.webp", imageAlt: "Cookie 卡面" }); // 只换卡面
card.update({ intensity: 0.6, shine: false });      // 调强度 / 关闭光泽

card.destroy();                      // 卸载：移除监听与 DOM；重复调用安全
```

### 4.2 `createProductShowcase(options)`（商品信息容器）

`createProductShowcase` 是轻量容器：桌面端左右布局、移动端（`max-width: 720px`）上下布局，
渲染商品名称、说明、价格、划线原价、库存状态与操作按钮。所有文本通过 `textContent` 写入，
**不接受 HTML 字符串**，因此传入的文案必须是纯文本。

```js
import { createProductShowcase } from "./vendor/bank-card-showcase/bank-card-showcase.es.js";
import "./vendor/bank-card-showcase/bank-card-showcase.css";

const showcase = createProductShowcase({
  product: {
    id: "sku-001",                                  // 由调用方定义的标识，组件不绑定任何系统
    name: "Sad Panda 卡面",
    description: "示例商品说明（纯前端演示数据）。",
    price: "¥ 68.00",                               // 已格式化好的价格文案
    compareAtPrice: "¥ 98.00",                      // 可选：划线原价
    stock: { label: "现货", state: "in-stock" },     // state: in-stock | low-stock | out-of-stock
    image: "/cards/panda.webp",
    imageAlt: "Sad Panda 卡面",
    silverImage: "/cards/panda-silver.webp",        // 可选
    effect: "holographic",                          // 默认 "normal"
    actions: [
      { id: "add-to-cart", label: "加入购物车", variant: "primary" },
      { id: "details", label: "查看详情" },          // variant 默认 "secondary"
      // 缺货可写 disabled: true
    ],
  },
  card: { maxTilt: 6, pressScale: 0.97 },            // 透传给 BankCard 的参数（image/imageAlt/effect 由 product 决定，可覆盖）
  onAction: (actionId, product) => {
    // 组件只回调，不做任何真实业务：购物车 / 订单 / 支付都由宿主实现
    console.log(actionId, product.id);
  },
  className: "my-showcase",                          // 可选：追加到根元素 .bc-showcase
});

showcase.mount("#product-1");
showcase.update({ product: { /* 新的商品数据（可含切换卡面与效果） */ } });
showcase.card.setEffect("silver");   // 需要单独控制卡片时，用内部 BankCard 实例
showcase.destroy();
```

实例成员：`element`（根元素 `.bc-showcase`）、`card`（内部 `BankCardInstance`）、`destroyed`、
`mount(target)`、`update(next)`、`destroy()`。渲染出的 DOM 结构如下（可用于主题侧定制，
但 **不要**直接改写组件内部样式）：

```html
<div class="bc-showcase">
  <div class="bc-showcase__media"><!-- .bc-card 由组件创建并挂在里 --></div>
  <div class="bc-showcase__info">
    <h3 class="bc-showcase__name">商品名称</h3>
    <p class="bc-showcase__desc">商品说明</p>
    <div class="bc-showcase__price">
      <span class="bc-showcase__price-value">¥ 68.00</span>
      <span class="bc-showcase__price-compare">¥ 98.00</span>
    </div>
    <div class="bc-showcase__stock" data-bc-stock-state="in-stock">现货</div>
    <div class="bc-showcase__actions">
      <button type="button" class="bc-btn bc-btn--primary" data-bc-action-id="add-to-cart">加入购物车</button>
    </div>
  </div>
</div>
```

`update()` 的语义：

| 调用 | 行为 |
| --- | --- |
| `update({ product })` | 商品数据**整体替换**（含卡面 / 效果 / 操作按钮），信息区文本与 `src` 刷新；容器与内部 `BankCard` 实例都**不重建** |
| `update({ card })` | 合并卡片参数覆盖项（优先级高于商品数据里的 `image` / `effect` 等派生值） |
| `update({ onAction })` / `update({ className })` | 替换回调 / 重新应用类名 |

其他细节：`description`、`compareAtPrice` 为空时对应元素自动隐藏；`stock.state === "out-of-stock"`
（或 `action.disabled: true`）时按钮使用原生 `disabled`；库存状态写在 `.bc-showcase__stock` 的
`data-bc-stock-state` 属性上；点击按钮只在**未禁用**时回调 `onAction(id, product)`。

---

## 5. 设计说明

1. **特效必须裁切在卡面轮廓内。** 卡面圆角按银行卡 ISO 比例设置（横向 3.72% / 纵向 5.89%），
   箔层 / 高光层与卡面共用同一圆角并被裁切（`.bc-card` 内即为完整的卡面轮廓）；
   特效不会溢出卡片边界影响页面其它内容。
2. **图案必须保持清晰。** 默认 `imageFit: "contain"`，图片**完整显示、不裁切、不拉伸**；
   反光层是半透明的（默认最亮的一档 `shineOpacity = 0.6`），叠加而非覆盖图案。
3. **强度只影响反光层，不提高亮度上限。** `intensity` 只按
   `0.35 + 0.65 × intensity` 缩小 `shineOpacity` / `glareOpacity` 两层不透明度，
   `brightness` / `contrast` / `saturate` 固定不变（且都不超过 1，即不会把箔层调得比原值更亮），
   因此调高强度只会让反光更明显，**不会把卡面越调越亮 / 越调越过曝**。
4. **变量隔离。** 底层库会在全局根上写入一批 `--card-*` 自定义属性；本组件在 `.bc-card` 上重新
   声明所需变量（`--card-aspect`、`--card-radius`、`--card-back`、`--card-edge`、`--card-glow`、
   `--sunpillar-*`、`--pointer-*` 等），因此不依赖站点是否提供全局样式，也不会把自己的变量写进站点全局。
5. **按压与倾斜分工。** 倾斜 / 弹簧 / 光泽由底层库负责，包装层不重复实现倾斜算法；
   按压缩放施加在 `.bc-card` 根元素上，与底层元素上的 `transform` 互不冲突。

---

## 6. 移动端、减少动效与可访问性

**移动端 / 触屏**

- 默认 `touchTilt: "on"`，采用**长按门槛**区分「滚动 / 快滑」与「按住观赏」：
  - 轻点、快速滑动：不接管手势，页面纵向滚动照常（根元素 `touch-action: pan-y`）；
  - 长按（约 160ms、位移 ≤ 10px）后拖动：进入倾斜态（`data-bc-touch-tilt="true"`），
    任意方向跟手调整倾角，该次手势不再滚动页面；松开后由弹簧回正。
- **修复过的坑**：触屏浏览器在 tap 后会保持 `:hover`。底层卡片在非交互模式下用
  `.holo-card:not(.holo-card--interactive):hover` 做纯 CSS 兜底，会被 tap 触发并“粘”在
  最大倾角 + 高光（只能点其它区域恢复）。组件现在在触屏上把该兜底复位（`data-bc-touch="true"`
  + `@media (hover: none)`），并默认改用真实的指针交互。
- 长按不会弹出 iOS 的图片菜单 / Android 上下文菜单（`-webkit-touch-callout: none`，卡面 `img` 不接手手势）。
- 鼠标按压反馈仍只在 `pointerType === "mouse"` 时生效；触屏长按进入倾斜时会用同一个 `--bc-press` 给一次轻微按压缩放作为反馈。
- 需要触屏完全不响应（例如纯展示列表）时设 `touchTilt: "off"`。
- 减少动效生效时，触屏倾斜与缩放同时关闭。

**减少动效（`prefers-reduced-motion`）**

- 默认 `respectReducedMotion: true`：系统开启「减少动效」时卡片**完全静止**（不倾斜、不缩放、
  无过渡动画），根元素带 `data-bc-reduced-motion="true"`。
- 组件会监听该媒体查询的变化（`change` 事件，`destroy()` 时移除监听），系统设置切换后**无需你
  重新创建组件**，会自动调整（必要时重建底层实例并清理旧实例）。
- `update()` 时会重新读取当前系统设置；设 `respectReducedMotion: false` 表示忽略系统设置
  （不建议）。

**可访问性**

- `imageAlt` 用于卡面图的替代文本；`silverImage` 生效时 `silverImageAlt` 优先，缺省回退 `imageAlt`。
  请写有意义的描述，不要留空、也不要写「图片」。
- 组件**不创建可聚焦元素、不实现键盘交互**：卡片的标题、链接、按钮等可聚焦语义与键盘焦点顺序
  **由宿主负责**（例如把卡片放在 `<a>` / `<button>` / 带标题的 `<article>` 中）。倾斜与光泽只是
  增强效果，不应作为唯一的信息通道。
- 组件根元素上的状态属性（`data-bc-effect` / `data-bc-press` / `data-bc-reduced-motion` /
  `data-bc-dragging`）可用于主题侧自定义，但请勿修改组件类名。

---

## 7. 常见问题（FAQ）

**Q1. 图片比例不是 1.586 : 1 会怎样？**
默认 `imageFit: "contain"`：图片**完整显示、不裁切、不拉伸**，比例不符时会在容器内留下空白边
（上下或左右）。若希望填满容器，可设 `imageFit: "cover"`（会裁掉超出部分）；或者把
`aspectRatio` 设成图片的实际宽高比。

**Q2. 怎么换成自己的图片 / 自托管图片？**
组件只接受图片 **URL 字符串**，自己不下载、不转换、不内联图片；图片一律由宿主提供。
把图片放到你的站点目录 / 媒体库 / 对象存储，然后把 URL 传给 `image`（`silverImage` 同理）即可。
参考 1.586 : 1 制作，WebP 体积更小。

> 注意：库构建（`npm run build`）已配置 `publicDir: false`，因此 `dist/` 只包含 JS / CSS，
> **不包含**任何图片；`public/cards/` 下的临时占位卡面只出现在 Demo 构建（`dist-demo/cards/`）。
> 上线前必须把占位素材替换为你自制的正式卡面 —— **不要**把占位素材当正式美术资源上线。

**Q3. 怎么避免和现有主题样式冲突？**
所有类名以 `bc-` 前缀开头，样式规则全部限定在 `.bc-*` 选择器内，不使用全局根选择器、
文档元素选择器或通配符选择器；所需的 `--card-*` 变量在 `.bc-card` 上本地重新声明。
主题侧不要覆盖 `.bc-*` 内部实现细节，需要定制时优先使用 `className` 追加自己的类，
或基于 `data-bc-*` 状态属性 / `--bc-aspect`、`--bc-press` 变量做微调。

**Q4. 切换效果会不会重建 DOM、丢事件？**
`effect` / `intensity` / `shine` / `imageFit` 变化不会重建实例；`interactive` / `touchTilt` /
`maxTilt` / `aspectRatio` 变化会重建**底层**实例（旧实例被彻底销毁），但包装层根元素与挂载位置
不变，不会累积监听器。`destroy()` 之后实例不可复用，需要重新 `createBankCard()`。

**Q5. 为什么换了图但实例没变？**
这是设计如此：`update({ image })` 只替换底层 `<img>` 的 `src` / `alt`（并视需要重新派生纹理种子），
不重建实例、不丢事件。

**Q6. 触屏上怎么倾斜卡片？轻点为什么没有反应？**
默认 `touchTilt: "on"`，但采用**长按**门槛：轻点 / 快速滑动留给页面滚动，**按住卡面约 160ms
后拖动**才会进入倾斜（任意方向）。若希望触屏完全不响应，设 `touchTilt: "off"`。

**Q7. 为什么系统开启「减少动效」后卡片完全不动？**
默认 `respectReducedMotion: true`，这是刻意的可访问性行为。详见第 6 节。

**Q8. 一个页面能放多张卡吗？**
可以。每张卡一个独立实例（各自 `mount` / `update` / `destroy`），互不影响；多张卡时建议控制
`intensity` 与 `maxTilt`，避免页面过于花哨。

**Q9. 遇到问题如何自查？**
先在控制台确认 `instance.destroyed`、`instance.options`（归一化后的真实参数），再检查
`instance.element` 上的 `data-bc-*` 属性与挂载容器是否存在（选择器拼写错误会直接抛错）。

---

## 8. 相关文档

- 组件定位、脚本命令、目录结构：[`../README.md`](../README.md)
- 移植到 WordPress / WooCommerce：[`WORDPRESS-INTEGRATION.md`](WORDPRESS-INTEGRATION.md)
- 第三方依赖与许可证原文：[`THIRD-PARTY.md`](THIRD-PARTY.md)
- 可直接双击运行的最小示例：[`../examples/plain-html/index.html`](../examples/plain-html/index.html)
