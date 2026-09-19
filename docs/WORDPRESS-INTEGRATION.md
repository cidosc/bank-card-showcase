# 移植到 WordPress / WooCommerce（集成指南）

## 0. 阶段声明（请先读这一段）

- **本阶段不开发 WooCommerce 适配器**，不产出插件、不改任何主题文件、不连接任何数据库。
- 本项目是**独立前端项目**，与 WordPress 站点**完全解耦**：只产出静态资源
  （`dist/` 的 JS + CSS），站点侧通过 `wp_enqueue_script` / `wp_enqueue_style` 引入即可。
- 本文给出的是**移植步骤与数据映射建议**，其中的 PHP / JS 片段都是**示例**，
  **未在任何真实 WordPress 站点上验证过**。真实接入时请按你自己站点的主题结构、
  WooCommerce 版本与模板覆盖情况调整，并在**隔离 staging** 环境先验证。
- 迁移只需三样东西：**① 部署构建产物 ② 一个承载容器 ③ 少量商品数据适配代码**。

> 边界：组件不实现购物车、订单、支付、数据库、后台、用户系统。按钮点击只触发前端回调
> (`onAction`)，保存任何业务动作仍由站点自己的代码负责。

---

## 1. 部署构建产物

先在项目根目录构建：

```bash
npm run build
```

得到以下产物（另有 `.map`，生产环境可不部署）：

| 文件 | 用途 |
| --- | --- |
| `dist/bank-card-showcase.iife.js` | IIFE 版本，暴露全局变量 `BankCardShowcase`，用 `wp_enqueue_script` 引入 |
| `dist/bank-card-showcase.es.js` | ESM 版本，供有打包链路的站点使用（用不到时不必部署） |
| `dist/bank-card-showcase.css` | 样式（**已包含**底层 `@kongyo2/cards-css` 的样式，自托管、不依赖 CDN） |

> 库构建已配置 `publicDir: false`，`dist/` 只包含上面三个文件（+ `.map`），**不含图片**。
> 卡面图片一律由站点侧提供（媒体库 / `wp_get_attachment_image_url`）。
> 临时占位卡面位于仓库的 `public/cards/`，只在 Demo 构建 `dist-demo/cards/` 中出现，
> **不是正式卡面**，不要部署到正式站点。

部署位置建议（**不要**放进 WooCommerce Core 或主题的 `vendor` 之外的位置）：

```text
wp-content/themes/<your-child-theme>/assets/bank-card-showcase/
├─ bank-card-showcase.iife.js
├─ bank-card-showcase.css
└─ bc-adapter.js          ← 你自己的少量适配代码（可选）
```

---

## 2. 步骤 1：用 `wp_enqueue_*` 引入产物

在主题（**推荐子主题**）的 `functions.php` 中引入。示例片段：

```php
<?php
/**
 * 示例：引入 Bank Card Showcase 组件产物。
 * 依赖函数：add_action / get_stylesheet_directory_uri / wp_enqueue_style / wp_enqueue_script。
 * 请按自己站点的目录与主题类型调整（父主题用 get_template_directory_uri()）。
 */
add_action( 'wp_enqueue_scripts', function () {
	$dir = get_stylesheet_directory_uri() . '/assets/bank-card-showcase';
	$ver = '0.1.0'; // 更新组件时同步修改（对应组件导出的 VERSION 常量）

	wp_enqueue_style( 'bank-card-showcase', $dir . '/bank-card-showcase.css', array(), $ver );
	wp_enqueue_script( 'bank-card-showcase', $dir . '/bank-card-showcase.iife.js', array(), $ver, true );
} );
```

要点：

- `wp_enqueue_style` / `wp_enqueue_script` 的 `$deps` 参数用空数组、`$in_footer` 用 `true`
  （组件在客户端创建 DOM，放页脚更安全）。
- 组件的 JS 与 CSS **必须成对引入**；只引 JS 会导致卡片没有样式与特效。
- 若你自己写了适配脚本，让它**依赖**组件句柄，确保加载顺序：

  ```php
  wp_enqueue_script(
      'bc-adapter',
      $dir . '/bc-adapter.js',
      array( 'bank-card-showcase' ), // 依赖：保证全局 BankCardShowcase 已就绪
      $ver,
      true
  );
  ```

---

## 3. 步骤 2：在商品卡片里加承载容器

组件只要求一个**承载容器元素**，容器内容由组件自己填充。示例（放在 `woocommerce/content-product.php`
的模板覆盖里，或经由 `woocommerce_before_shop_loop_item_title` 之类的钩子输出）：

```php
<?php
/**
 * 示例：商品循环里的承载容器。
 * 依赖函数：esc_attr / esc_url / get_the_ID / (WooCommerce) wc_get_product。
 * 注意：改模板请放在【子主题】里，不要直接改 WooCommerce Core 或父主题文件。
 */
$product_id = get_the_ID();
$product    = function_exists( 'wc_get_product' ) ? wc_get_product( $product_id ) : null;

$image_url = '';
if ( $product ) {
	$image_url = (string) wp_get_attachment_image_url( $product->get_image_id(), 'full' );
}
?>
<div
	class="bc-mount"
	data-bc-card="1"
	data-image="<?php echo esc_url( $image_url ); ?>"
	data-image-alt="<?php echo esc_attr( $product ? $product->get_name() : '' ); ?>"
	data-effect="normal"
	data-product-id="<?php echo esc_attr( (string) $product_id ); ?>"
></div>
```

- `data-*` 上的数据一律用 `esc_attr` / `esc_url` 输出（示例已体现）。
- `data-bc-card="1"` 只是你自己的**选择器标记**（`bc-` 前缀便于识别；组件不会自动扫描 DOM）。
- 不要把价格、库存、承诺、评价等**未确认事实**硬编码进属性或 JS。

---

## 4. 步骤 3：用少量 JS 把数据映射进组件

适配代码有两种数据来源，任选其一：

1. **容器上的 `data-*` 属性**（推荐，天然按商品分片）；
2. `wp_localize_script` 输出的全局配置（适合放站点级默认值，例如默认效果）。

```php
<?php
/**
 * 示例：站点级配置（可选）。
 * 依赖函数：wp_localize_script（需在 wp_enqueue_script 之后调用）。
 */
wp_localize_script(
	'bc-adapter',
	'BC_SHOWCASE',
	array(
		'defaultEffect' => 'normal', // 只映射到组件的 4 种效果之一
	)
);
```

```js
/* assets/bank-card-showcase/bc-adapter.js —— 示例适配代码（按站点实际需求调整） */
(function () {
  "use strict";

  var NS = window.BankCardShowcase; // 由 IIFE 产物写入的全局对象
  if (!NS || typeof NS.createBankCard !== "function") {
    return;
  }

  var defaults = window.BC_SHOWCASE || {};

  function mountCard(el) {
    if (el.dataset.bcMounted === "1" || !el.dataset.image) {
      return;
    }
    var card = NS.createBankCard({
      image: el.dataset.image,
      silverImage: el.dataset.silverImage || undefined,
      imageAlt: el.dataset.imageAlt || "",
      effect: el.dataset.effect || defaults.defaultEffect || "normal",
      maxTilt: 7,
      aspectRatio: 1.586,
    });
    card.mount(el); // 容器就是挂载点（字符串选择器或元素均可）
    el.dataset.bcMounted = "1";
    el.bcCardInstance = card; // 便于后续 destroy()（示例做法；复杂站点可用 Map 统一管理）
  }

  document.querySelectorAll("[data-bc-card]").forEach(mountCard);
})();
```

- 需要**单个商品**的更多字段（价格、库存、按钮）时，改用
  `NS.createProductShowcase({ product: {...}, onAction: ... })`，
  数据映射见第 6 节；价格等文案必须由 PHP 渲染成**纯文本**再传进来。
- 不要用 `innerHTML` 拼接商品数据；组件内部用 `textContent` / `createElement` 渲染，
  传进来的必须是纯文本。

---

## 5. 步骤 4：图片派生与卡面比例

```php
<?php
// 示例：从附件 ID 取全尺寸图 URL（依赖 wp_get_attachment_image_url）
$image_url = wp_get_attachment_image_url( $product->get_image_id(), 'full' );
```

- 卡面统一按 **1.586 : 1**（宽 : 高，例如 1015 × 640）制作，与银行卡
  ISO/IEC 7810 ID-1 比例一致。
- 建议使用 **WebP** 以减小体积；`srcset` / 响应式图片由站点侧自行决定（组件只接受一个 URL）。
- 比例不符时组件默认 `imageFit: "contain"`：**完整显示、不裁切、不拉伸**，可能留边
  （详见 [`USAGE.md`](USAGE.md) 第 7 节 Q1）。
- 占位素材（`public/cards/`）**不是正式卡面**：上线前必须替换为用户自制、拥有合法权利的正式卡面，
  不得使用第三方版权素材。

---

## 6. 商品数据映射建议（`createProductShowcase`）

| 组件字段 | WooCommerce 取数（示例） | 注意事项 |
| --- | --- | --- |
| `product.id` | `$product->get_id()` | 仅作标识，组件不绑定任何系统 |
| `product.name` | `$product->get_name()` | 纯文本 |
| `product.description` | `wp_strip_all_tags( $product->get_short_description() )` | 组件用 `textContent` 渲染，**必须纯文本** |
| `product.price` | `wp_strip_all_tags( wc_price( $product->get_price() ) )` | `wc_price()` 返回含 HTML 的价格，必须先剥离标签；不要自行编造价格 / 币种符号 |
| `product.compareAtPrice` | `wp_strip_all_tags( wc_price( $product->get_regular_price() ) )` | 可选；没有划线价就不要传 |
| `product.stock.label` | 站点自己的文案（如「现货」「仅剩 N 件」「暂时缺货」） | 只能反映真实库存数据，**不要编造库存与服务时效** |
| `product.stock.state` | `$product->is_in_stock()` / `managing_stock()` / `get_stock_quantity()` | 映射到 `in-stock \| low-stock \| out-of-stock` |
| `product.image` | `wp_get_attachment_image_url( $product->get_image_id(), 'full' )` | 1.586 : 1，建议 WebP |
| `product.silverImage` | 自定义字段 / 媒体库第二张银版图 | 可选，仅 `effect: "silver"` 时生效 |
| `product.effect` | 自定义字段 / 分类映射 | 只允许 `normal \| holographic \| glitter \| silver` |
| `product.actions[]` | 由站点定义（如「查看详情」跳 `get_permalink()`） | 组件只回调 `onAction(id, product)`；加购 / 结算必须调用站点自己的逻辑 |
| `card` | 例如 `{ maxTilt: 7, intensity: 0.8 }` | 透传给 BankCard 的展示参数 |

**文案红线：** 不得编造价格、库存、服务时效、保证、评价、税务、退款或法律政策。
未确认的事实一律留待确认，不要写进页面。

---

## 7. 步骤 5：卸载与清理

组件不是「设置一次就永不回收」的静态片段。以下场景需要主动 `destroy()`：

| 场景 | 处理 |
| --- | --- |
| 区块编辑器 / 前端区块重新渲染 | 在区块卸载或重新渲染前销毁旧实例，再按新数据创建 |
| SPA / AJAX 局部替换商品列表（含无限滚动） | 替换 DOM 前对旧容器调用 `destroy()` |
| 商品卡片被移出可视区域且不再复用 | 可选择性销毁以释放监听与动画 |

```js
/* 示例：销毁某个容器上的实例 */
function unmountCard(el) {
  var card = el.bcCardInstance;
  if (card) {
    card.destroy();       // 幂等：移除监听、动画与 DOM
    delete el.bcCardInstance;
  }
  el.dataset.bcMounted = "0";
}
```

切记：**`destroy()` 之后实例不可复用**（再次 `mount()` 会抛错），需要重新
`createBankCard()` / `createProductShowcase()`。重复 `destroy()` 是安全空操作。

---

## 8. 步骤 6：注意事项（踩坑清单）

1. **不要改主题样式**，也不要把组件的 CSS 复制进主题样式表：组件样式全部限定在 `.bc-*` 选择器内，
   与主题互不干扰。需要微调时用 `className` 追加自己的类，或基于
   `data-bc-effect` / `data-bc-press` / `data-bc-reduced-motion` 等状态属性做定制。
2. **组件不写全局样式**：不会设置站点根元素、`html` / `body` 或通配符规则；底层所需的
   `--card-*` 变量已在 `.bc-card` 本地重新声明。
3. **变量与类名隔离**：所有类名以 `bc-` 开头（`NAMESPACE` 常量 = `"bc"`），避免与主题、插件冲突。
4. **图片建议 WebP**，并按 1.586 : 1 制作；组件不下载、不转换、不内联图片。
5. **不依赖站点 DOM 结构**：组件只操作自己的根元素与给定承载容器，不读取站点其它节点的结构；
   因此主题换版、插件改动样式不会让组件失效。
6. **不要改 WooCommerce Core，也不要直接改父主题模板**；模板改动放在子主题里。
7. **生产发布前**先在隔离 staging 验证：比例 1.586、无横向溢出、效果切换、
   `prefers-reduced-motion`、移动端滚动不受影响（验收清单见 [`TESTING.md`](TESTING.md)）。
8. **不提交密钥**，不把真实订单 / 客户数据写进前端数据或示例。

---

## 9. 本阶段明确不做的事

- 不开发 WooCommerce 插件 / 适配器（本文只是步骤建议）。
- 不实现购物车、订单、支付、优惠券、运费、税务、退款等任何业务逻辑。
- 不改动任何 WordPress / WooCommerce Core 文件，也不连接任何生产数据库。
- 不生成正式卡面美术资源（占位素材仅用于联调，必须替换）。

## 10. 相关文档

- 完整参数表与生命周期：[`USAGE.md`](USAGE.md)
- 第三方依赖与许可证：[`THIRD-PARTY.md`](THIRD-PARTY.md)
- 组件定位与脚本命令：[`../README.md`](../README.md)
- 纯 HTML 最小示例（可先在本机跑通再移植）：[`../examples/plain-html/index.html`](../examples/plain-html/index.html)
