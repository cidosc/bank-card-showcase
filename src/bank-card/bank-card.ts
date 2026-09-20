/**
 * `createBankCard` —— 银行卡展示组件（包装 @kongyo2/cards-css）。
 *
 * 职责划分：
 *   - 底层库负责 3D 倾斜 / 弹簧 / 光泽 / 箔效果 / 指针交互；
 *   - 本包装层负责：`--card-*` 变量隔离、按压缩放反馈、触摸策略、
 *     减少动效、运行时更新（含必要时重建底层实例）与生命周期清理。
 */

import { createHoloCard } from "@kongyo2/cards-css";
import type { HoloCard, VisualOptions } from "@kongyo2/cards-css";

import { isBankCardEffect, resolveEffectPlan, seedFromImage } from "../effects.js";
import type { EffectPlan } from "../effects.js";
import type {
  BankCardEffect,
  BankCardInstance,
  BankCardOptions,
  BankCardSurface,
  ResolvedBankCardOptions,
} from "../types.js";
import {
  attachPressFeedback,
  attachTouchTilt,
  clampPressScale,
  hasTouchInput,
  isFinePointer,
  prefersReducedMotion,
  watchReducedMotion,
} from "./pointer-feedback.js";

const DEFAULT_MAX_TILT = 7;
const MAX_TILT_LIMIT = 20;
const DEFAULT_ASPECT_RATIO = 1.586;
const MIN_ASPECT_RATIO = 1;
const MAX_ASPECT_RATIO = 3;
const DEFAULT_PRESS_SCALE = 0.98;
const DEFAULT_INTENSITY = 1;
const DEFAULT_SURFACE: BankCardSurface = "flat";
const RETURN_DELAY = 140;
/** 回正弹簧（底层默认 k=0.01 / c=0.06 回正过慢，实测需 2s+）：加硬但不振荡。 */
const SNAP_STIFFNESS = 0.05;
const SNAP_DAMPING = 0.32;
/** `dragTilt: false` 时被钉住的倾角变量（只冻结角度，不影响高光）。 */
const TILT_VARS = ["--rotate-x", "--rotate-y"] as const;
/** 传给底层的附加类名（只允许 `bc-` 前缀）。 */
const HOLO_CLASS_NAME = "bc-card__holo";

const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  const num = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, num));
};

const appliedImage = (options: ResolvedBankCardOptions, plan: EffectPlan): string =>
  plan.useSilverImage && options.silverImage ? options.silverImage : options.image;

const appliedAlt = (options: ResolvedBankCardOptions, plan: EffectPlan): string =>
  plan.useSilverImage && options.silverImage ? options.silverImageAlt ?? options.imageAlt : options.imageAlt;

/** 归一化并夹紧所有对外参数（契约第 3.2 节）。 */
function normalizeBankCardOptions(input: BankCardOptions): ResolvedBankCardOptions {
  const effect: BankCardEffect = isBankCardEffect(input.effect) ? input.effect : "normal";
  const image = typeof input.image === "string" ? input.image : "";
  const silverImage = typeof input.silverImage === "string" ? input.silverImage : undefined;
  const silverImageAlt = typeof input.silverImageAlt === "string" ? input.silverImageAlt : undefined;
  const useSilver = effect === "silver" && Boolean(silverImage);
  const seedSource = useSilver ? silverImage ?? image : image;
  const explicitSeed = typeof input.textureSeed === "number" && Number.isFinite(input.textureSeed);

  return {
    image,
    imageAlt: input.imageAlt ?? "",
    silverImage,
    silverImageAlt,
    effect,
    maxTilt: clampNumber(input.maxTilt, 0, MAX_TILT_LIMIT, DEFAULT_MAX_TILT),
    interactive: input.interactive ?? true,
    shine: input.shine ?? true,
    intensity: clampNumber(input.intensity, 0, 1, DEFAULT_INTENSITY),
    // 质感：默认平面风（轻投影）；只有显式传 "physical" 才用较重的实体感。
    surface: input.surface === "physical" ? "physical" : DEFAULT_SURFACE,
    pressScale: clampPressScale(input.pressScale ?? DEFAULT_PRESS_SCALE),
    dragTilt: input.dragTilt ?? true,
    // 触屏默认开启「长按后拖动倾斜」（快速滑动仍归页面滚动，见 pointer-feedback.ts）。
    touchTilt: input.touchTilt === "off" ? "off" : "on",
    aspectRatio: clampNumber(input.aspectRatio, MIN_ASPECT_RATIO, MAX_ASPECT_RATIO, DEFAULT_ASPECT_RATIO),
    respectReducedMotion: input.respectReducedMotion ?? true,
    imageFit: input.imageFit === "cover" ? "cover" : "contain",
    textureSeed: explicitSeed ? (input.textureSeed as number) : seedFromImage(seedSource),
    className: input.className,
  };
}

/** 计算是否交给底层做指针交互。 */
function computeEffectiveInteractive(options: ResolvedBankCardOptions, rawReducedMotion: boolean): boolean {
  return (
    options.interactive &&
    (isFinePointer() || options.touchTilt === "on") &&
    !(rawReducedMotion && options.respectReducedMotion)
  );
}

/** 只挑出「显式提供且非 undefined」的键，保证 update 只处理用户给出的字段。 */
function pickDefined(next: Partial<BankCardOptions>): Partial<BankCardOptions> {
  const patch: Partial<BankCardOptions> = {};
  const target = patch as Record<string, unknown>;
  for (const key of Object.keys(next) as Array<keyof BankCardOptions>) {
    const value = next[key];
    if (value !== undefined) {
      target[key] = value;
    }
  }
  return patch;
}

/**
 * 创建银行卡实例。除 `options.image` 外全部可选，默认值见 `BankCardOptions`。
 */
export function createBankCard(input: BankCardOptions): BankCardInstance {
  let options = normalizeBankCardOptions(input);
  let plan = resolveEffectPlan(options.effect, options.intensity);
  let explicitSeed = typeof input.textureSeed === "number" && Number.isFinite(input.textureSeed);

  let rawReducedMotion = prefersReducedMotion();
  let reducedMotionActive = rawReducedMotion && options.respectReducedMotion;
  let effectiveInteractive = computeEffectiveInteractive(options, rawReducedMotion);

  let destroyed = false;
  let card: HoloCard | null = null;
  let disposePress: (() => void) | null = null;
  let disposeTouch: (() => void) | null = null;
  let appliedClassNames: string[] = [];

  const element = document.createElement("div");
  element.className = "bc-card";
  element.dataset.bcEffect = options.effect;
  element.dataset.bcSurface = options.surface;
  element.style.setProperty("--bc-aspect", String(options.aspectRatio));
  element.style.setProperty("--bc-press", "1");
  applyClassName(options.className);
  syncStateAttributes();

  function applyClassName(className: string | undefined): void {
    for (const name of appliedClassNames) {
      element.classList.remove(name);
    }
    appliedClassNames = [];
    if (!className) {
      return;
    }
    for (const name of className.split(/\s+/).filter(Boolean)) {
      if (name === "bc-card" || appliedClassNames.includes(name)) {
        continue;
      }
      element.classList.add(name);
      appliedClassNames.push(name);
    }
  }

  function syncStateAttributes(): void {
    element.dataset.bcReducedMotion = reducedMotionActive ? "true" : "false";
    element.dataset.bcPress = options.pressScale >= 1 ? "off" : "on";
    // 触屏专用样式（非交互模式下的 hover 兜底复位）依赖该属性，
    // 不用媒体查询也能在触摸模拟 / 混合设备上稳定生效。
    element.dataset.bcTouch = hasTouchInput() ? "true" : "false";
  }

  function visualOptions(): VisualOptions {
    return {
      imageFit: options.imageFit,
      shineOpacity: plan.shineOpacity,
      glareOpacity: options.shine ? plan.glareOpacity : 0,
      brightness: plan.brightness,
      contrast: plan.contrast,
      saturate: plan.saturate,
    };
  }

  function buildCard(): HoloCard {
    return createHoloCard({
      image: appliedImage(options, plan),
      imageAlt: appliedAlt(options, plan),
      effect: plan.effect,
      // 底层 `--card-aspect` 就是 CSS aspect-ratio 的「宽 / 高」，
      // 因此横版银行卡直接传 1.586（而非 1/1.586）。
      aspectRatio: options.aspectRatio,
      interactive: effectiveInteractive,
      gyroscope: false,
      activateOnClick: false,
      showcase: false,
      textureSeed: plan.needsSeed ? options.textureSeed : undefined,
      visual: visualOptions(),
      physics: {
        maxTilt: options.maxTilt,
        returnDelay: RETURN_DELAY,
        // 默认回正过于松弛（k=0.01 / c=0.06），这里调成轻微欠阻尼：平滑但不拖沓。
        snapSpring: { stiffness: SNAP_STIFFNESS, damping: SNAP_DAMPING },
      },
      className: HOLO_CLASS_NAME,
    });
  }

  /** 先构建新的底层实例，再彻底销毁旧的，避免中途出现空窗。 */
  function rebuildCard(): void {
    const previous = card;
    const next = buildCard();
    if (previous) {
      previous.destroy();
      previous.element.remove();
    }
    card = next;
    element.appendChild(next.element);
  }

  /**
   * 钉住 / 释放底层写入的倾角变量。
   * `dragTilt: false` 时按下即冻结当前角度，按住移动不再改变倾角；
   * 松开后移除钉住值，由底层弹簧自然回到指针对应的角度。
   */
  function setTiltPinned(pinned: boolean): void {
    const active = card;
    if (!active) {
      return;
    }
    const rotator = active.element.querySelector<HTMLElement>(".holo-card__rotator");
    if (!rotator) {
      return;
    }
    if (pinned) {
      for (const name of TILT_VARS) {
        const value = active.element.style.getPropertyValue(name);
        if (value) {
          rotator.style.setProperty(name, value);
        }
      }
      return;
    }
    for (const name of TILT_VARS) {
      rotator.style.removeProperty(name);
    }
  }

  function setupPressFeedback(): void {
    disposePress?.();
    disposePress = null;
    const needsScale = options.pressScale < 1 && !reducedMotionActive;
    const needsTiltPin = !options.dragTilt && !reducedMotionActive;
    element.style.setProperty("--bc-press", "1");
    element.removeAttribute("data-bc-dragging");
    if (!needsScale && !needsTiltPin) {
      return;
    }
    disposePress = attachPressFeedback(element, {
      // `1` 表示不缩放，仅用于在需要时触发按压状态以钉住倾角。
      pressScale: needsScale ? options.pressScale : 1,
      enabled: () => !destroyed && !reducedMotionActive,
      onPressChange: (pressed) => {
        if (needsTiltPin) {
          setTiltPinned(pressed);
        }
      },
    });
  }

  /**
   * 触屏倾斜：长按卡面进入拖动观测（快滑不动卡面、仍可滚动页面）。
   * 关闭条件：`interactive: false` / `touchTilt: "off"` / `dragTilt: false` / 减少动效。
   */
  function setupTouchTilt(): void {
    disposeTouch?.();
    disposeTouch = null;
    element.removeAttribute("data-bc-touch-tilt");
    const needsTouch =
      effectiveInteractive && options.touchTilt === "on" && options.dragTilt !== false && !reducedMotionActive;
    if (!needsTouch) {
      return;
    }
    disposeTouch = attachTouchTilt(element, {
      enabled: () => !destroyed && !reducedMotionActive,
      onEngageChange: (engaged) => {
        // 进入长按倾斜时给一个轻微按压缩放作为“已进入拖动”的反馈；退出时复位。
        // （鼠标按压反馈与触摸互斥，直接写同一个 `--bc-press` 即可。）
        if (engaged && options.pressScale < 1) {
          element.style.setProperty("--bc-press", String(options.pressScale));
          element.setAttribute("data-bc-dragging", "true");
        } else {
          element.style.setProperty("--bc-press", "1");
          element.removeAttribute("data-bc-dragging");
        }
      },
    });
  }

  /** 鼠标按压 + 触屏倾斜共用一套重建入口，保证监听器不会重复挂载。 */
  function setupPointerFeedback(): void {
    setupPressFeedback();
    setupTouchTilt();
  }

  function updateImageElement(): void {
    if (!card) {
      return;
    }
    const image = card.element.querySelector<HTMLImageElement>("img.holo-card__image");
    if (!image) {
      return;
    }
    image.src = appliedImage(options, plan);
    image.alt = appliedAlt(options, plan);
  }

  const stopWatchingReducedMotion = watchReducedMotion((reduced) => {
    if (destroyed) {
      return;
    }
    rawReducedMotion = reduced;
    const nextReduced = reduced && options.respectReducedMotion;
    const nextEffective = computeEffectiveInteractive(options, rawReducedMotion);
    reducedMotionActive = nextReduced;
    syncStateAttributes();
    setupPointerFeedback();
    if (nextEffective !== effectiveInteractive) {
      effectiveInteractive = nextEffective;
      rebuildCard();
    }
  });

  function mount(target: string | HTMLElement): BankCardInstance {
    if (destroyed) {
      throw new Error("[bc] createBankCard: cannot mount a destroyed card.");
    }
    const parent = typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
    if (!parent) {
      throw new Error(`[bc] createBankCard: mount target not found: "${String(target)}".`);
    }
    if (element.parentElement !== parent) {
      parent.appendChild(element);
    }
    return instance;
  }

  function update(next: Partial<BankCardOptions>): BankCardInstance {
    if (destroyed) {
      return instance;
    }
    const patch = pickDefined(next);
    if (Object.keys(patch).length === 0) {
      return instance;
    }
    if (patch.textureSeed !== undefined) {
      explicitSeed = true;
    }

    const previous = options;
    const previousPlan = plan;
    const previousEffectiveInteractive = effectiveInteractive;
    const previousReducedMotion = reducedMotionActive;

    options = normalizeBankCardOptions({ ...previous, ...patch });
    plan = resolveEffectPlan(options.effect, options.intensity);

    // 未显式提供种子时，图片或银色原图（含 silver 效果切换）变化后重新派生。
    if (
      !explicitSeed &&
      (options.image !== previous.image ||
        options.silverImage !== previous.silverImage ||
        plan.useSilverImage !== previousPlan.useSilverImage)
    ) {
      options = { ...options, textureSeed: seedFromImage(appliedImage(options, plan)) };
    }

    // 契约：update 时必须重新读取 prefers-reduced-motion。
    rawReducedMotion = prefersReducedMotion();
    reducedMotionActive = rawReducedMotion && options.respectReducedMotion;
    effectiveInteractive = computeEffectiveInteractive(options, rawReducedMotion);

    const needRebuild =
      options.interactive !== previous.interactive ||
      options.touchTilt !== previous.touchTilt ||
      options.maxTilt !== previous.maxTilt ||
      options.aspectRatio !== previous.aspectRatio ||
      effectiveInteractive !== previousEffectiveInteractive;

    applyClassName(options.className);
    element.dataset.bcEffect = options.effect;
    element.dataset.bcSurface = options.surface;
    element.style.setProperty("--bc-aspect", String(options.aspectRatio));
    syncStateAttributes();

    if (
      needRebuild ||
      options.pressScale !== previous.pressScale ||
      options.dragTilt !== previous.dragTilt ||
      reducedMotionActive !== previousReducedMotion
    ) {
      setupPointerFeedback();
    }

    if (needRebuild) {
      rebuildCard();
    } else if (card) {
      if (options.effect !== previous.effect || options.intensity !== previous.intensity || options.shine !== previous.shine) {
        card.setEffect(plan.effect);
        card.setVisual(visualOptions());
      } else if (options.imageFit !== previous.imageFit) {
        card.setVisual(visualOptions());
      }
      updateImageElement();
    }
    return instance;
  }

  function setEffect(effect: BankCardEffect): BankCardInstance {
    return update({ effect });
  }

  function destroy(): void {
    if (destroyed) {
      return;
    }
    destroyed = true;
    disposePress?.();
    disposePress = null;
    disposeTouch?.();
    disposeTouch = null;
    stopWatchingReducedMotion();
    if (card) {
      card.destroy();
      card = null;
    }
    element.remove();
  }

  rebuildCard();
  setupPointerFeedback();

  const instance: BankCardInstance = {
    get element(): HTMLElement {
      return element;
    },
    get options(): ResolvedBankCardOptions {
      return options;
    },
    get destroyed(): boolean {
      return destroyed;
    },
    mount,
    update,
    setEffect,
    destroy,
  };

  return instance;
}
