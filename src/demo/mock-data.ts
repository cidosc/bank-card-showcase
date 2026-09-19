/**
 * Demo 静态 Mock 数据（只属于 Demo，不属于生产组件）。
 *
 * 说明：
 *   - 两个商品的卡面来自**临时占位素材** `public/cards/*`，非正式美术资源；
 *   - 价格 / 库存 / 按钮全部是模拟文案，不做任何真实业务（无购物车 / 订单 / 支付）；
 *   - 两个商品使用**不同**的卡面文件，商品 B 额外提供独立银色原图以演示 silver 效果。
 */

import type { ProductData, ProductStock } from "../types.js";

/** 商品 A：Cookie，默认镭射（holographic）。 */
export const COOKIE_PRODUCT: ProductData = {
  id: "cookie",
  name: "Cookie 曲奇卡",
  description: "暖米色曲奇主题卡面，默认镭射（holographic）效果；占位素材，仅用于组件联调。",
  price: "¥ 12.50",
  compareAtPrice: "¥ 18.00",
  stock: { label: "现货 · 库存充足", state: "in-stock" },
  image: "/cards/cookie.webp",
  imageAlt: "Cookie 曲奇主题的临时占位卡面",
  effect: "holographic",
  actions: [
    { id: "add-to-cart", label: "加入购物车（演示）", variant: "primary" },
    { id: "view-details", label: "查看详情", variant: "secondary" },
  ],
};

/** 商品 B：Sad Panda，默认碎闪（glitter），附独立银色原图。 */
export const SAD_PANDA_PRODUCT: ProductData = {
  id: "sad-panda",
  name: "Sad Panda 熊猫卡",
  description: "浅绿灰熊猫主题卡面，默认碎闪（glitter）效果；另附独立银色原图用于 silver 效果演示。",
  price: "¥ 68.00",
  stock: { label: "仅剩 3 件", state: "low-stock" },
  image: "/cards/panda-card.webp",
  imageAlt: "Sad Panda 熊猫主题的临时占位卡面",
  silverImage: "/cards/panda-card-silver.webp",
  effect: "glitter",
  actions: [
    { id: "add-to-cart", label: "加入购物车（演示）", variant: "primary" },
    { id: "notify-restock", label: "到货提醒", variant: "secondary" },
  ],
};

/** Demo 商品列表（顺序即「商品切换」控件的顺序）。 */
export const DEMO_PRODUCTS: readonly ProductData[] = [COOKIE_PRODUCT, SAD_PANDA_PRODUCT];

/** Demo 初始商品。 */
export const DEFAULT_PRODUCT_ID = COOKIE_PRODUCT.id;

/** 按 id 取商品；未知 id 回退到首个商品（Demo 内部使用，不需要抛错）。 */
export function findProduct(id: string): ProductData {
  return DEMO_PRODUCTS.find((product) => product.id === id) ?? COOKIE_PRODUCT;
}

/** Demo 库存状态模拟预设（用于演示缺货时的禁用态）。 */
export const STOCK_PRESETS: Record<"in-stock" | "low-stock" | "out-of-stock", ProductStock> = {
  "in-stock": { label: "现货 · 库存充足", state: "in-stock" },
  "low-stock": { label: "仅剩 3 件", state: "low-stock" },
  "out-of-stock": { label: "暂时缺货 · 补货中", state: "out-of-stock" },
};
