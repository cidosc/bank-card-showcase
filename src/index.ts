/**
 * Bank Card Showcase —— 公开入口。
 *
 * 唯一的样式入口：底层 cards-css 的样式 + 本组件命名空间样式。
 * 组件内部模块不得自行 import CSS，以保证产物中样式顺序稳定。
 */
import "@kongyo2/cards-css/styles.css";
import "./styles/bank-card.css";
import "./styles/product-showcase.css";

export { createBankCard } from "./bank-card/bank-card.js";
export { BANK_CARD_EFFECTS, resolveEffectPlan, seedFromImage, isBankCardEffect } from "./effects.js";
export { BANK_CARD_SURFACES } from "./surfaces.js";
export type { EffectPlan } from "./effects.js";
export { createProductShowcase } from "./showcase/product-showcase.js";

export type {
  BankCardEffect,
  BankCardInstance,
  BankCardOptions,
  BankCardSurface,
  BankCardTouchTilt,
  ProductAction,
  ProductData,
  ProductShowcaseInstance,
  ProductShowcaseOptions,
  ProductStock,
  ResolvedBankCardOptions,
} from "./types.js";

/** 组件命名空间（所有 CSS 类名前缀），用于未来移植时排错。 */
export const NAMESPACE = "bc";

/** 版本号，便于移植时确认资源版本。 */
export const VERSION = "0.1.0";
