import type { HoloEffect } from "@kongyo2/cards-css";
import type { BankCardEffect } from "./types.js";

/**
 * 对外 4 种效果类型（冻结契约）。内部映射到底层 @kongyo2/cards-css：
 * normal → none、holographic → holo、glitter → glitter、silver → metal。
 */
export const BANK_CARD_EFFECTS = ["normal", "holographic", "glitter", "silver"] as const;

/** 每个效果对应的一组底层参数。 */
export interface EffectPlan {
  /** 底层 cards-css 效果名。 */
  effect: HoloEffect;
  /** 反光（箔）层不透明度倍率，控制特效对卡面图案的遮挡程度。 */
  shineOpacity: number;
  /** 高光层不透明度倍率。 */
  glareOpacity: number;
  /** 箔层亮度倍率，避免过曝。 */
  brightness: number;
  /** 箔层对比度倍率（<1 可抑制高光削波）。 */
  contrast: number;
  /** 箔层饱和度倍率（银色卡偏低，保留金属感）。 */
  saturate: number;
  /** 是否需要纹理种子（碎闪的颗粒层依赖它）。 */
  needsSeed: boolean;
  /** 是否应使用独立银色原图。 */
  useSilverImage: boolean;
}

const BASE: Record<BankCardEffect, Omit<EffectPlan, "useSilverImage">> = {
  // 普通卡保持克制：只有轻微光泽，不叠加任何箔层。
  normal: {
    effect: "none",
    shineOpacity: 0.48,
    glareOpacity: 0.36,
    brightness: 1,
    contrast: 1,
    saturate: 1,
    needsSeed: false,
  },
  // 镭射：随倾斜显示彩色反光。底层 foil 用 color-dodge，原值会把高光打到削波（实测 24–27% 过曝），
  // 因此降低反光层不透明度与亮度、压一点对比度，保留色彩而不冲白卡面。
  holographic: {
    effect: "holo",
    shineOpacity: 0.48,
    glareOpacity: 0.24,
    brightness: 0.86,
    contrast: 0.9,
    saturate: 1.05,
    needsSeed: false,
  },
  // 碎闪：细腻颗粒反射。原值平均亮度比原图高 10–18，为全部效果中最易“发灰发白”的一档。
  glitter: {
    effect: "glitter",
    shineOpacity: 0.34,
    glareOpacity: 0.2,
    brightness: 0.72,
    contrast: 0.95,
    saturate: 0.95,
    needsSeed: true,
  },
  // 银色：金属光泽。底层 metal 层的自身渐变偏暗，在浅色卡面上会把卡面压暗 36–48，
  // 在深色卡面上又会提亮 32–37；这里降不透明度 + 提高亮度，把两侧摆动收小。
  silver: {
    effect: "metal",
    shineOpacity: 0.18,
    glareOpacity: 0.12,
    brightness: 1.0,
    contrast: 0.95,
    saturate: 0.9,
    needsSeed: false,
  },
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * 将对外效果类型 + 强度（0–1）解析为底层参数。
 * 强度只影响两层不透明度，永远不会提高亮度上限，以保证卡面清晰。
 */
export function resolveEffectPlan(effect: BankCardEffect, intensity: number): EffectPlan {
  const base = BASE[effect];
  const factor = 0.35 + 0.65 * clamp01(intensity);
  return {
    effect: base.effect,
    shineOpacity: clamp01(base.shineOpacity * factor),
    glareOpacity: clamp01(base.glareOpacity * factor),
    brightness: base.brightness,
    contrast: base.contrast,
    saturate: base.saturate,
    needsSeed: base.needsSeed,
    useSilverImage: effect === "silver",
  };
}

/** 由图片 URL 派生稳定纹理种子，保证同一张卡每次渲染的颗粒分布一致。 */
export function seedFromImage(image: string): number {
  let hash = 2166136261;
  for (let i = 0; i < image.length; i += 1) {
    hash ^= image.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // 归一到正整数，避免 0（0 被底层视为“无种子”，会退化为随机纹理）。
  return (Math.abs(hash) % 100000) + 1;
}

/** 是否属于已知效果类型（用于校验外部传入值）。 */
export function isBankCardEffect(value: unknown): value is BankCardEffect {
  return typeof value === "string" && (BANK_CARD_EFFECTS as readonly string[]).includes(value);
}
