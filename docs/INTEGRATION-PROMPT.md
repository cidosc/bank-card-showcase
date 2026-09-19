# 交给网站开发代理的接入提示词（复制整段使用）

> 用途：让站点开发会话**直接复用**已完成的银行卡展示组件，而不是重写倾斜/镭射/碎闪/弹簧动画。
> 组件仓库 commit：`77f2eb3`（main）。本文件本身也在仓库里，可随代码一起交接。

---

## 任务

把「银行卡式商品展示组件（Bank Card Showcase）」接入本站商品页。

**必须复用现成实现，禁止重复造轮子。** 组件已经实现并验证过：3D 倾斜 + 弹簧回正、按压缩放、
按住拖动观赏、4 种卡面效果（normal / holographic / glitter / silver）、光泽与高光层、移动端
不干扰滚动、`prefers-reduced-motion` 静止、`mount / update / destroy` 生命周期、样式命名空间隔离。

## 资源位置（先读，不要凭猜测实现）

| 资源 | 地址 |
| --- | --- |
| Git 仓库（唯一事实来源） | `git@github.com:cidosc/bank-card-showcase.git`（HTTPS：`https://github.com/cidosc/bank-card-showcase.git`） |
| **本机已克隆并已构建的路径** | `D:\Softerware\AHack\bank-card-showcase`（`dist/` 已就绪，可直接取用） |
| 生产产物 | `dist/bank-card-showcase.css`、`dist/bank-card-showcase.iife.js`（普通 `<script>`，暴露全局 `BankCardShowcase`）、`dist/bank-card-showcase.es.js`（打包链路用） |
| 可直接打开的验证页面 | `examples/effects-gallery/index.html`（效果对照页）、`examples/plain-html/index.html`（最小集成示例）、`dist-demo/`（完整商品 Demo，`npm run preview`） |
| 必读文档 | `README.md`、`docs/USAGE.md`（参数表 + 生命周期 + FAQ）、`docs/WORDPRESS-INTEGRATION.md`（移植步骤 + WooCommerce 字段映射示例）、`docs/THIRD-PARTY.md`（依赖与许可证） |
| 验收记录 | `docs/TESTING.md`、`acceptance-artifacts/acceptance-report.json`（89 项 + 截图 + 曝光数据） |

获取方式二选一：

```bash
# 方式 A：克隆仓库后构建（推荐，产物可复现）
git clone git@github.com:cidosc/bank-card-showcase.git
cd bank-card-showcase && npm ci && npm run build   # 产出 dist/ 三个文件

# 方式 B：直接使用本机已构建产物
#   D:\Softerware\AHack\bank-card-showcase\dist\bank-card-showcase.{css,iife.js}
```

## 硬性约束（违反即返工）

1. **不要重新实现**倾斜 / 镭射 / 碎闪 / 金属光泽 / 弹簧动画；**不要**再引入 hover-tilt、
   vanilla-tilt.js、pokemon-cards-css 或其它同类库。
2. **不要修改组件源码**，也不要改 `node_modules/@kongyo2/cards-css`。确有 bug 就先回报，
   不要在站点侧打补丁式 hack。
3. **不要移植 Demo 的开发控件**（商品/效果切换按钮、强度滑块、倾角滑块、库存模拟、卸载/重挂按钮）——
   那些只存在于开发 Demo，正式站点不需要，也不属于交付物。
4. 站点侧只做三件事：**部署资源 → 放承载容器 → 映射商品数据**。不要改组件公开接口，
   不要把组件包成 WordPress 插件（本阶段明确不做）。
5. 不要用组件自带样式去改全站样式；不要给 `.bc-*` 命名空间里的类写覆盖规则
   （要微调就用组件提供的能力：见下面「可调项」与 CSS 变量 `--bc-*` / `--bc-showcase-info-shadow`）。
6. 卡面美术必须**自制且有合法权利**：比例严格 `1.586 : 1`（建议 1015×640），WebP 优先。
   仓库里的 `public/cards/*` 是演示素材（含临时占位图），**上正式站前必须替换为最终素材**。

## 接入步骤（WordPress / 自建站同理）

1. 把 `dist/bank-card-showcase.css` 与 `dist/bank-card-showcase.iife.js` 放到主题（或子主题）的
   assets 目录，例如 `wp-content/themes/<your-child-theme>/assets/bank-card-showcase/`。
2. 只在需要卡片的页面引入（商品详情页 / 商品卡片列表）：

```php
add_action('wp_enqueue_scripts', function () {
    $base = get_stylesheet_directory_uri() . '/assets/bank-card-showcase';
    wp_enqueue_style('bank-card-showcase', "$base/bank-card-showcase.css", [], '0.1.0');
    wp_enqueue_script('bank-card-showcase', "$base/bank-card-showcase.iife.js", [], '0.1.0', true);
});
```

3. 模板里放承载容器（组件只认容器，不依赖任何主题 DOM）：

```html
<div class="bc-mount"
     data-bc-image="<?php echo esc_url(wp_get_attachment_image_url($card_image_id, 'full')); ?>"
     data-bc-effect="holographic"
     data-bc-name="…商品名…"
     data-bc-price="…价格文案…">
</div>
```

4. 用少量 JS 把数据映射进组件（示例，按站点实际情况调整）：

```js
const mount = document.querySelector('.bc-mount');
const card = BankCardShowcase.createBankCard({
  image: mount.dataset.bcImage,       // 1.586:1 卡面图
  imageAlt: mount.dataset.bcName + ' 卡面',
  effect: mount.dataset.bcEffect,     // normal | holographic | glitter | silver
  surface: 'flat',                    // flat（默认，轻量平面）/ physical（较重实体感）
  maxTilt: 7,
});
card.mount(mount);
```

5. 需要商品信息区（名称 / 说明 / 价格 / 库存 / 按钮）时用 `createProductShowcase`，
   而不是自己写一套布局；按钮点击只回调 `onAction(id, product)`，**不要**在里面写购物车/订单/支付逻辑：

```js
const showcase = BankCardShowcase.createProductShowcase({
  product: { id, name, description, price, stock, image, imageAlt, effect, actions },
  onAction: (actionId, product) => { /* 交给站点既有逻辑：跳转/加购/埋点 */ },
});
showcase.mount('#product-stage');
// 数据变化（如切换规格/颜色/卡面）时增量更新，不重建：
showcase.update({ product: nextProduct });
```

6. **生命周期**：AJAX 局部刷新、区块重渲染、无刷新路由切换时，先 `destroy()` 再重建；
   `mount()` 可重复调用是幂等的，但**销毁后的实例不能再用**。路由离开页面时务必 `destroy()`，
   否则监听不会释放。

## 组件接口速查（公开接口已冻结）

```ts
createBankCard(options) → {
  element, options, destroyed,
  mount(target: string | HTMLElement),
  update(partial),            // 增量更新；含切换卡面/效果/强度/质感
  setEffect(effect),          // update({ effect }) 的语法糖
  destroy()                   // 幂等，释放监听与动画
}
```

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `image` | `string` | 必填 | 卡面图 URL（1.586:1，WebP 优先） |
| `imageAlt` | `string` | `""` | 无障碍替代文本 |
| `silverImage` | `string` | — | `silver` 效果专用的独立银色原图（推荐提供） |
| `effect` | `"normal" \| "holographic" \| "glitter" \| "silver"` | `"normal"` | 对外 4 种效果 |
| `surface` | `"flat" \| "physical"` | `"flat"` | 卡面质感：平面 / 实体 |
| `maxTilt` | `number` | `7` | 最大倾角（°），夹紧 0–20，永不翻面 |
| `interactive` | `boolean` | `true` | 是否允许指针交互 |
| `shine` | `boolean` | `true` | 是否启用光泽层 |
| `intensity` | `number` | `1` | 效果强度 0–1（只影响反光层不透明度） |
| `pressScale` | `number` | `0.98` | 按下缩放（`1` = 关闭） |
| `dragTilt` | `boolean` | `true` | 允许按住拖动调整倾角 |
| `touchTilt` | `"off" \| "on"` | `"off"` | 移动端触摸倾斜（默认不干扰滚动） |
| `aspectRatio` | `number` | `1.586` | 宽高比（银行卡 ISO/IEC 7810 ID-1） |
| `imageFit` | `"contain" \| "cover"` | `"contain"` | 完整显示、不裁切不拉伸 |
| `respectReducedMotion` | `boolean` | `true` | 尊重系统"减少动态效果" |
| `className` | `string` | — | 追加到组件根元素的类名 |

效果映射（对外 → 底层）：`normal → none`、`holographic → holo`、`glitter → glitter`、`silver → metal`。
另外导出：`BANK_CARD_EFFECTS`、`BANK_CARD_SURFACES`、`VERSION`、`NAMESPACE`。

**可调项（不改代码就能调）**：`surface`（平面/实体）、`intensity`（效果强弱）、`maxTilt`（倾角上限）、
`--bc-aspect`。想整体减淡反射可用 `update({ intensity: 0.8 })`；想更"实体"用 `update({ surface: 'physical' })`。

**站点侧需要调整商品信息卡投影时**，在任意祖先元素上设 `--bc-showcase-info-shadow`，
不要覆盖 `.bc-showcase*` 类（组件 CSS 不引入全局选择器，宿主也不应反向侵入）。

## 验收清单（必须逐条实测并给出证据：截图 / 数值 / 控制台）

- [ ] 桌面（1440 / 1280 / 768）与移动（390 / 320）下卡面比例均为 **1.586**，无横向溢出。
- [ ] 图片完整显示、不拉伸不裁切（`object-fit: contain`），WebP 真的解码（`naturalWidth = 1015`）。
- [ ] 悬停产生倾斜且 `|倾角| ≤ maxTilt`、永不翻面；鼠标移出约 1 秒内平滑回正。
- [ ] 按下有轻微缩小（0.98）、松开复位；中途取消/失焦/隐藏不会卡在按下态。
- [ ] 4 种效果切换正常，且**不明显改变卡面明暗**（判据：加特效前后平均亮度偏移 ≤ 12、高光削波 ≤ 3%）。
- [ ] 移动端页面可正常滚动、卡面 `touch-action: pan-y`，触摸不接管倾斜。
- [ ] 系统开启"减少动态效果"时卡片静止（无过渡、无倾斜、无按压缩放）。
- [ ] 反复 `destroy()` / `mount()` 不报错、无监听泄漏（浏览器 Performance/内存面板或 `getEventListeners` 抽查）。
- [ ] 站点其它页面/组件样式不受影响：产物 CSS 中**没有**全局选择器（`:root` / `html` / `body` / `*`）。
- [ ] 页面不加载任何 CDN 资源（字体、脚本、样式均自托管），控制台无错误。
- [ ] 卡面素材为最终自制版本（比例 1.586:1），已替换演示素材。

## 组件侧回归命令（在组件仓库里跑，用来复核组件本体没被改坏）

```bash
npm ci
npm run typecheck      # 0 错误
npm test               # 59 个单测
npm run build          # 产出 dist/
npm run acceptance     # 89 项真实 Chrome 端到端检查 + 截图 + 曝光数据（含 dev 工作流回归）
npm run baseline       # 校验"当前代码/产物"与验收报告指纹一致
```

`npm run acceptance` 会输出 `acceptance-artifacts/acceptance-report.json` 与截图；
其中 16 项 `exposure.*` 检查专门盯"闪卡过曝 / 过暗"，换卡面后可直接复跑复核。

## 明确不做

- 不做 WordPress 插件、不做 WooCommerce 适配器（本阶段）。
- 不实现购物车 / 订单 / 支付 / 库存判定 / 用户系统。
- 不新增第 5 种效果、不做特效编辑器、不重画卡面。
- 不把 Demo 的开发控件搬进正式站点。
