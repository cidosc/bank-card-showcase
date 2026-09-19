# 纯 HTML 集成示例（plain-html）

**这是示例页面**，不是组件本身。它演示「不打包、不用任何框架」时如何把 Bank Card Showcase
接到一个普通 HTML 页面上：只需要一个 `<link>`、一个 `<script>`，加两个承载容器。

- 无框架、无构建、无 CDN 依赖
- 使用 IIFE 全局变量 `BankCardShowcase`（**不使用 ES module**），因此可以**直接双击 `index.html`**（`file://`）打开
- 本页面所有样式都写在 `index.html` 的内联 `<style>` 里，只作用于本示例页；组件样式不在其中

## 如何运行

1. 在项目根目录构建一次库产物（示例引用的是 `dist/`，不是源码）：

   ```bash
   npm i
   npm run build
   ```

   构建会生成示例需要的两个文件：

   - `dist/bank-card-showcase.iife.js`（全局 `BankCardShowcase`）
   - `dist/bank-card-showcase.css`（已包含底层 `@kongyo2/cards-css` 的样式，自托管）

2. 直接双击打开 `examples/plain-html/index.html`（或在编辑器 / 文件管理器里用浏览器打开）。
   也可以放到任意静态服务器下访问，不需要额外配置。

3. 打开后应看到两张 1.586:1 的卡片：
   - **卡片 A（normal）**：`../../public/cards/cookie.png`，只有倾斜与轻微光泽；
   - **卡片 B（演示卡，holographic）**：`../../public/cards/panda.webp`，并预置了独立银色原图
     `../../public/cards/panda-silver.webp`，用于演示 `silver` 效果。

> 图片都是 `public/cards/` 下的**临时占位素材（非正式卡面）**，带有「TEMP PLACEHOLDER / 临时占位」水印。
> 上线前必须替换为你自己制作、拥有合法权利的正式卡面。

## 四个按钮的作用

按钮只作用于**卡片 B（演示卡）**，卡片 A 固定为 `normal`，方便对比。

| 按钮 | 调用的 API | 演示的行为 |
| --- | --- | --- |
| 切换效果 | `cardB.setEffect(effect)` | 在 `normal → holographic → glitter → silver` 之间循环；等价于 `update({ effect })`，只更新效果层，**不重建实例** |
| 更换卡面 | `cardB.update({ image, imageAlt, silverImage })` | 在 `panda.webp` 与 `cookie.png` 之间切换；只替换底层 `<img>` 的 `src` / `alt`，实例与监听保持不变 |
| 卸载 | `cardB.destroy()` | 移除 DOM、事件监听与动画；**销毁后的实例不可再次 `mount()`**，重复 `destroy()` 是安全的空操作 |
| 重新挂载 | `createBankCard(...).mount("#mount-b")` 或 `cardB.mount("#mount-b")` | 已卸载时：创建**全新实例**并挂回同一容器；仍存活时：重复调用 `mount()`，验证其**幂等**（不会重复绑定事件） |

页面底部的状态行会实时显示当前效果、卡面文件名与挂载状态。

> 说明：本示例页为了自身排版，在页内 `<style>` 里写了 `body { … }` 等**页面级**样式；
> 那是「示例页面」的样式，**不是组件产物**。组件产物（`dist/bank-card-showcase.css`）里
> 不存在任何 `:root` / `html` / `body` / `*` 全局选择器。

## 换成你自己的图片

1. 把图片放到任意可访问路径（本地文件、你的服务器或 WordPress 媒体库均可）。
2. 修改 `index.html` 里的两处数据：

   ```js
   var CARD_A = { image: "../../public/cards/cookie.png", imageAlt: "……" };

   var CARD_B_IMAGES = [
     { image: "../../public/cards/panda.webp",  imageAlt: "……", silverImage: "../../public/cards/panda-silver.webp" },
     { image: "../../public/cards/cookie.png", imageAlt: "……", silverImage: "" }
   ];
   ```

   - `image`：必填，卡面图 URL；
   - `imageAlt`：无障碍替代文本，建议写清是什么卡面（**不要留空**，也不要写「图片」）；
   - `silverImage`：可选，仅当 `effect: "silver"` 时生效的独立银色原图；传 `""`（或省略）表示不使用。
3. 建议卡面按 **1.586 : 1**（宽 : 高，例如 1015 × 640）制作；比例不符时组件默认 `imageFit: "contain"`，
   会**完整显示、不裁切、不拉伸**，但可能留下上下或左右空白。

## 相关文档

- 完整参数表、生命周期、`createProductShowcase` 用法：[`../../docs/USAGE.md`](../../docs/USAGE.md)
- WordPress / WooCommerce 移植步骤：[`../../docs/WORDPRESS-INTEGRATION.md`](../../docs/WORDPRESS-INTEGRATION.md)
- 第三方依赖与许可证：[`../../docs/THIRD-PARTY.md`](../../docs/THIRD-PARTY.md)
- 组件定位与脚本命令：[`../../README.md`](../../README.md)
