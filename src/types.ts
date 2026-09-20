/**
 * Bank Card Showcase — 公开接口类型（冻结契约）
 *
 * 这里只描述“对外”稳定接口。内部实现细节（如何映射到 @kongyo2/cards-css）
 * 不出现在本文件中，以保证未来移植到 WordPress 时接口不变。
 */

import { BANK_CARD_SURFACES } from "./surfaces.js";

/**
 * 对外只暴露 4 种易理解的效果类型，内部映射到底层库效果：
 * - `normal`      → 底层 `none`（仅倾斜 + 光泽，最克制）
 * - `holographic` → 底层 `holo`（镭射彩虹反光）
 * - `glitter`     → 底层 `glitter`（细腻颗粒碎闪）
 * - `silver`      → 底层 `metal`（金属光泽，可搭配独立银色原图）
 */
export type BankCardEffect = "normal" | "holographic" | "glitter" | "silver";

/** 移动端触摸倾斜策略：`on`（默认，长按后拖动观赏倾斜）| `off`（完全不接管触摸）。 */
export type BankCardTouchTilt = "off" | "on";

/**
 * 卡面质感 / 表面风格：
 * - `"flat"`（**默认**）：轻量化平面风 —— 投影极轻、无霓虹边缘与辉光、3D 透视更平，
 *   与简洁的浅色页面融为一体；
 * - `"physical"`：较强实体感 —— 保留底层较重的黑色投影与边缘高光。
 */
export type BankCardSurface = (typeof BANK_CARD_SURFACES)[number];

/** BankCard 构造参数。除 `image` 外全部可选，默认值见各字段说明。 */
export interface BankCardOptions {
  /** 卡面图片 URL（由用户自行制作后导入）。PNG / WebP 均可，SVG 亦可。必填。 */
  image: string;
  /** 图片替代文本（可访问性）。默认 `""`。 */
  imageAlt?: string;
  /**
   * 可选的独立银色原图。使用 `effect: "silver"` 时若提供，则显示该图，
   * 动态特效只贡献金属光泽。默认回退到 `image`。
   */
  silverImage?: string;
  /** 银色原图的替代文本。默认回退到 `imageAlt`。 */
  silverImageAlt?: string;
  /** 效果类型。默认 `"normal"`。 */
  effect?: BankCardEffect;
  /** 最大倾斜角度（度）。默认 `7`，允许 0–20，超过会被夹紧以保证永不翻面。 */
  maxTilt?: number;
  /** 是否允许指针交互（倾斜 / 拖动观赏）。默认 `true`。 */
  interactive?: boolean;
  /** 是否启用光泽（反射高光层）。默认 `true`。 */
  shine?: boolean;
  /** 效果强度 0–1。默认 `1`（= 已调好的克制档位，1 不会再额外加亮）。 */
  intensity?: number;
  /**
   * 卡面质感。默认 `"flat"`（轻量化平面风，阴影极轻）；传 `"physical"` 可获得更强的
   * 实体感（保留底层较重的投影与边缘高光）。可在运行时用 `update()` 切换。
   */
  surface?: BankCardSurface;
  /** 按下时的缩放反馈。默认 `0.98`；传入 `1` 可关闭。 */
  pressScale?: number;
  /** 允许按住卡片拖动观赏（调整倾角）。默认 `true`。 */
  dragTilt?: boolean;
  /**
   * 触屏是否允许触摸倾斜。默认 `"on"`：
   * 长按（约 160ms、位移 ≤ 10px）卡面后拖动即可调整倾角（任意方向）；
   * 快速滑动 / 轻点不接管手势，页面纵向滚动照常（根元素 `touch-action: pan-y`）。
   * 传 `"off"` 可完全不接管触摸（触屏上卡片不倾斜，也不会被 tap 的粘滞 hover 影响）。
   */
  touchTilt?: BankCardTouchTilt;
  /** 卡片宽高比（宽 / 高）。默认 `1.586`（银行卡 ISO/IEC 7810 ID-1）。 */
  aspectRatio?: number;
  /** 碎闪 / 宇宙纹理种子。默认由图片 URL 派生，保证同一张卡渲染稳定。 */
  textureSeed?: number;
  /**
   * 是否尊重 `prefers-reduced-motion: reduce`。默认 `true`：
   * 此时关闭倾斜、按压缩放与过渡动画，卡片保持静止。
   */
  respectReducedMotion?: boolean;
  /** 图片显示方式。默认 `"contain"`（完整显示，不裁切、不拉伸）。 */
  imageFit?: "contain" | "cover";
  /** 追加到组件根元素的类名（可选）。 */
  className?: string;
}

/** 归一化后的参数（所有默认值已填充），只读。 */
export type ResolvedBankCardOptions = Readonly<
  Required<
    Omit<BankCardOptions, "silverImage" | "silverImageAlt" | "className">
  > &
    Pick<BankCardOptions, "silverImage" | "silverImageAlt" | "className">
>;

/** BankCard 实例。 */
export interface BankCardInstance {
  /** 组件根元素（命名空间 `.bc-card`）。 */
  readonly element: HTMLElement;
  /** 归一化后的当前参数。 */
  readonly options: ResolvedBankCardOptions;
  /** 是否已销毁。 */
  readonly destroyed: boolean;
  /** 将卡片挂载到选择器或元素中（重复挂载不会重复绑定事件）。 */
  mount(target: string | HTMLElement): this;
  /** 增量更新参数（含切换卡面 / 效果），未提供的字段保持不变。 */
  update(next: Partial<BankCardOptions>): this;
  /** 切换效果的语法糖，等价于 `update({ effect })`。 */
  setEffect(effect: BankCardEffect): this;
  /** 卸载：移除事件监听、动画与 DOM，可安全重复调用。 */
  destroy(): void;
}

/** 商品操作按钮（Demo / 未来接入时为纯前端回调，不含真实购物车逻辑）。 */
export interface ProductAction {
  /** 回调标识，点击时通过 `onAction` 回传。 */
  id: string;
  /** 按钮文案。 */
  label: string;
  /** 视觉样式：`primary`（主按钮）| `secondary`（次按钮）。默认 `secondary`。 */
  variant?: "primary" | "secondary";
  /** 是否禁用（例如缺货）。默认 `false`。 */
  disabled?: boolean;
}

/** 库存展示信息。 */
export interface ProductStock {
  /** 展示文案，例如 `现货` / `仅剩 3 件` / `暂时缺货`。 */
  label: string;
  /** 语义状态，用于配色。默认 `"in-stock"`。 */
  state?: "in-stock" | "low-stock" | "out-of-stock";
}

/** 商品展示数据（由调用方传入，组件不关心数据来源）。 */
export interface ProductData {
  /** 商品唯一标识（H5 与 mock 数据使用；不绑定任何真实商品系统）。 */
  id: string;
  /** 商品名称。 */
  name: string;
  /** 商品说明。 */
  description?: string;
  /** 价格文案，已由调用方格式化，例如 `"¥ 12.50"`。 */
  price: string;
  /** 划线原价（可选）。 */
  compareAtPrice?: string;
  /** 库存信息（可选）。 */
  stock?: ProductStock;
  /** 卡面图片 URL。 */
  image: string;
  /** 卡面替代文本。 */
  imageAlt?: string;
  /** 可选独立银色原图。 */
  silverImage?: string;
  /** 该商品默认效果类型。默认 `"normal"`。 */
  effect?: BankCardEffect;
  /** 操作按钮列表（可选）。 */
  actions?: ProductAction[];
}

/** 商品展示容器参数。 */
export interface ProductShowcaseOptions {
  /** 商品数据。 */
  product: ProductData;
  /** 透传给 BankCard 的参数（`image` / `imageAlt` / `effect` 由 product 决定，可在此覆盖）。 */
  card?: Partial<BankCardOptions>;
  /** 按钮点击回调（纯前端演示用途）。 */
  onAction?: (actionId: string, product: ProductData) => void;
  /** 追加到根元素的类名。 */
  className?: string;
}

/** 商品展示容器实例。 */
export interface ProductShowcaseInstance {
  /** 容器根元素（命名空间 `.bc-showcase`）。 */
  readonly element: HTMLElement;
  /** 内部 BankCard 实例（用于单独切换卡面 / 效果）。 */
  readonly card: BankCardInstance;
  /** 是否已销毁。 */
  readonly destroyed: boolean;
  mount(target: string | HTMLElement): this;
  /** 更新商品数据（含切换卡面 / 效果）。 */
  update(next: Partial<Omit<ProductShowcaseOptions, "card">> & { card?: Partial<BankCardOptions> }): this;
  destroy(): void;
}
