import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBankCard } from "../src/bank-card/bank-card.js";
import {
  TOUCH_LONG_PRESS_MS,
  TOUCH_TILT_ATTR,
  attachPressFeedback,
  attachTouchTilt,
  clampPressScale,
  hasTouchInput,
  isFinePointer,
  prefersReducedMotion,
  watchReducedMotion,
} from "../src/bank-card/pointer-feedback.js";
import { resolveEffectPlan, seedFromImage } from "../src/effects.js";
import type { BankCardEffect, BankCardInstance, BankCardOptions } from "../src/types.js";

const IMG = "data:image/webp;base64,xx";
const IMG_ALT = "data:image/webp;base64,yy";
const SILVER = "data:image/webp;base64,silver";

/** 不依赖 PointerEvent（jsdom 未必提供）：用普通 Event + 关键属性兜底。 */
function pointerEvent(
  type: string,
  init: { pointerType?: string; button?: number; pointerId?: number; clientX?: number; clientY?: number } = {},
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "pointerType", { value: init.pointerType ?? "mouse" });
  Object.defineProperty(event, "button", { value: init.button ?? 0 });
  Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 });
  Object.defineProperty(event, "clientX", { value: init.clientX ?? 0 });
  Object.defineProperty(event, "clientY", { value: init.clientY ?? 0 });
  return event;
}

type MediaListener = (event: { matches: boolean; media: string }) => void;

interface MediaHandle {
  state: { reduced: boolean; fine: boolean };
  setReduced(value: boolean): void;
  listenerCount(): number;
}

/** 可编程的 matchMedia 替身（含 change 事件与监听者计数）。 */
function installMatchMedia(initial: { reduced?: boolean; fine?: boolean } = {}): MediaHandle {
  const state = { reduced: initial.reduced ?? false, fine: initial.fine ?? true };
  const lists = new Set<{ query: string; listeners: Set<MediaListener> }>();

  const makeList = (query: string): MediaQueryList => {
    const isReduced = query.includes("prefers-reduced-motion");
    const isFine = query.includes("hover: hover") && query.includes("pointer: fine");
    const entry = { query, listeners: new Set<MediaListener>() };
    lists.add(entry);
    const fake = {
      media: query,
      get matches(): boolean {
        return isReduced ? state.reduced : isFine ? state.fine : false;
      },
      addEventListener(type: string, listener: MediaListener): void {
        if (type === "change") {
          entry.listeners.add(listener);
        }
      },
      removeEventListener(type: string, listener: MediaListener): void {
        if (type === "change") {
          entry.listeners.delete(listener);
        }
      },
      addListener(listener: MediaListener): void {
        entry.listeners.add(listener);
      },
      removeListener(listener: MediaListener): void {
        entry.listeners.delete(listener);
      },
    };
    return fake as unknown as MediaQueryList;
  };

  vi.stubGlobal("matchMedia", makeList);

  return {
    state,
    setReduced(value: boolean): void {
      state.reduced = value;
      for (const entry of lists) {
        if (entry.query.includes("prefers-reduced-motion")) {
          for (const listener of [...entry.listeners]) {
            listener({ matches: value, media: entry.query });
          }
        }
      }
    },
    listenerCount(): number {
      let total = 0;
      for (const entry of lists) {
        total += entry.listeners.size;
      }
      return total;
    },
  };
}

interface ListenerRecord {
  target: EventTarget;
  type: string;
  listener: unknown;
}

/** 记录 target 上的监听器注册 / 移除，用于断言 destroy 不泄漏。 */
function trackListeners(targets: EventTarget[]): {
  added: ListenerRecord[];
  removed: ListenerRecord[];
  restore(): void;
} {
  const added: ListenerRecord[] = [];
  const removed: ListenerRecord[] = [];
  const restores: Array<() => void> = [];

  for (const target of targets) {
    const originalAdd = target.addEventListener;
    const originalRemove = target.removeEventListener;
    const patchedAdd = (type: string, listener: unknown, options?: unknown): void => {
      added.push({ target, type, listener });
      Reflect.apply(originalAdd, target, [type, listener, options]);
    };
    const patchedRemove = (type: string, listener: unknown, options?: unknown): void => {
      removed.push({ target, type, listener });
      Reflect.apply(originalRemove, target, [type, listener, options]);
    };
    Object.defineProperty(target, "addEventListener", { configurable: true, writable: true, value: patchedAdd });
    Object.defineProperty(target, "removeEventListener", { configurable: true, writable: true, value: patchedRemove });
    restores.push(() => {
      Object.defineProperty(target, "addEventListener", { configurable: true, writable: true, value: originalAdd });
      Object.defineProperty(target, "removeEventListener", { configurable: true, writable: true, value: originalRemove });
    });
  }

  return { added, removed, restore: () => restores.forEach((restore) => restore()) };
}

/** 该次注册是否已被对应的移除调用抵扣（用于断言“无泄漏监听”）。 */
function isListenerRemoved(tracker: { removed: ListenerRecord[] }, entry: ListenerRecord): boolean {
  return tracker.removed.some(
    (removed) => removed.target === entry.target && removed.type === entry.type && removed.listener === entry.listener,
  );
}

const created: BankCardInstance[] = [];
function makeCard(options: BankCardOptions): BankCardInstance {
  const card = createBankCard(options);
  created.push(card);
  return card;
}

const holoOf = (card: BankCardInstance): HTMLElement => {
  const element = card.element.querySelector<HTMLElement>(".holo-card");
  if (!element) {
    throw new Error("expected .holo-card");
  }
  return element;
};

const imageOf = (card: BankCardInstance): HTMLImageElement => {
  const image = card.element.querySelector<HTMLImageElement>("img.holo-card__image");
  if (!image) {
    throw new Error("expected .holo-card__image");
  }
  return image;
};

let media: MediaHandle;

beforeEach(() => {
  media = installMatchMedia({ reduced: false, fine: true });
});

afterEach(() => {
  for (const card of created) {
    card.destroy();
  }
  created.length = 0;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("resolveEffectPlan 效果映射", () => {
  it("把 4 种对外效果映射到底层 HoloEffect", () => {
    expect(resolveEffectPlan("normal", 1).effect).toBe("none");
    expect(resolveEffectPlan("holographic", 1).effect).toBe("holo");
    expect(resolveEffectPlan("glitter", 1).effect).toBe("glitter");
    expect(resolveEffectPlan("silver", 1).effect).toBe("metal");
  });

  it("只有 glitter 需要纹理种子、只有 silver 使用银色原图", () => {
    expect(resolveEffectPlan("glitter", 1).needsSeed).toBe(true);
    expect(resolveEffectPlan("normal", 1).needsSeed).toBe(false);
    expect(resolveEffectPlan("silver", 1).useSilverImage).toBe(true);
    expect(resolveEffectPlan("holographic", 1).useSilverImage).toBe(false);
  });

  it("四种效果的默认强度受曝光约束（反光层不透明度保守、亮度不放大）", () => {
    // 依据：在浅色/深色卡面上实测，旧档位（shine 0.85–0.95）会造成 24–27% 高光削波、银色卡面亮度偏移 ±40。
    const normal = resolveEffectPlan("normal", 1);
    const holo = resolveEffectPlan("holographic", 1);
    const glitter = resolveEffectPlan("glitter", 1);
    const silver = resolveEffectPlan("silver", 1);

    for (const plan of [normal, holo, glitter, silver]) {
      expect(plan.shineOpacity).toBeLessThanOrEqual(0.6);
      expect(plan.glareOpacity).toBeLessThanOrEqual(0.45);
      expect(plan.brightness).toBeLessThanOrEqual(1);
    }
    // 银色（metal）自身的箔层偏暗/偏亮摆动最大，必须是其中最保守的一档。
    expect(silver.shineOpacity).toBeLessThan(normal.shineOpacity);
    expect(silver.shineOpacity).toBeLessThanOrEqual(0.2);
    // 普通卡不叠加箔层，但也保留一点光泽。
    expect(normal.shineOpacity).toBeGreaterThan(0.3);
  });

  it("intensity 夹紧到 0..1 且只降低不透明度、永不提高亮度", () => {
    expect(resolveEffectPlan("holographic", 5)).toEqual(resolveEffectPlan("holographic", 1));
    expect(resolveEffectPlan("holographic", -1)).toEqual(resolveEffectPlan("holographic", 0));
    const low = resolveEffectPlan("holographic", 0);
    const high = resolveEffectPlan("holographic", 1);
    expect(low.shineOpacity).toBeLessThan(high.shineOpacity);
    expect(low.glareOpacity).toBeLessThan(high.glareOpacity);
    expect(low.brightness).toBe(high.brightness);
    expect(high.shineOpacity).toBeLessThanOrEqual(1);
  });
});

describe("seedFromImage 稳定性", () => {
  it("同一 URL 恒定、不同 URL 不同、始终为正整数", () => {
    const first = seedFromImage(IMG);
    expect(seedFromImage(IMG)).toBe(first);
    expect(seedFromImage(IMG_ALT)).not.toBe(first);
    expect(Number.isInteger(first)).toBe(true);
    expect(first).toBeGreaterThan(0);
  });
});

describe("参数归一化与夹紧", () => {
  it("填充默认值", () => {
    const card = makeCard({ image: IMG });
    expect(card.options.image).toBe(IMG);
    expect(card.options.imageAlt).toBe("");
    expect(card.options.effect).toBe("normal");
    expect(card.options.maxTilt).toBe(7);
    expect(card.options.interactive).toBe(true);
    expect(card.options.shine).toBe(true);
    expect(card.options.intensity).toBe(1);
    expect(card.options.pressScale).toBeCloseTo(0.98, 5);
    expect(card.options.dragTilt).toBe(true);
    expect(card.options.touchTilt).toBe("on");
    expect(card.options.aspectRatio).toBeCloseTo(1.586, 5);
    expect(card.options.respectReducedMotion).toBe(true);
    expect(card.options.imageFit).toBe("contain");
    expect(card.options.surface).toBe("flat");
    // 纹理种子是“由图片 URL 派生的正整数”，不写成 seedFromImage(IMG)（否则会自证实现）。
    expect(Number.isInteger(card.options.textureSeed)).toBe(true);
    expect(card.options.textureSeed).toBeGreaterThan(0);
    expect(card.options.textureSeed).toBe(seedFromImage(IMG));
    const sameImage = makeCard({ image: IMG });
    const otherImage = makeCard({ image: IMG_ALT });
    expect(sameImage.options.textureSeed).toBe(card.options.textureSeed);
    expect(otherImage.options.textureSeed).not.toBe(card.options.textureSeed);
  });

  it("质感：默认 flat（轻量化平面风）、非法值回退 flat、可用 update 切换且不重建实例", () => {
    const card = makeCard({ image: IMG });
    expect(card.options.surface).toBe("flat");
    expect(card.element.dataset.bcSurface).toBe("flat");

    const holo = holoOf(card);
    card.update({ surface: "physical" });
    expect(card.options.surface).toBe("physical");
    expect(card.element.dataset.bcSurface).toBe("physical");
    // 质感只改变量 / 属性，不重建底层实例。
    expect(holoOf(card)).toBe(holo);

    card.update({ surface: "flat" });
    expect(card.element.dataset.bcSurface).toBe("flat");

    // 非法值回退默认（flat），且不会写入奇怪的值。
    card.update({ surface: "neon" as unknown as "flat" });
    expect(card.options.surface).toBe("flat");
    expect(card.element.dataset.bcSurface).toBe("flat");
  });

  it("夹紧 maxTilt / intensity / pressScale / aspectRatio 并回退非法 effect", () => {
    const high = makeCard({
      image: IMG,
      maxTilt: 999,
      intensity: 5,
      pressScale: 2,
      aspectRatio: 99,
      effect: "nope" as unknown as BankCardEffect,
    });
    expect(high.options.maxTilt).toBe(20);
    expect(high.options.intensity).toBe(1);
    expect(high.options.pressScale).toBe(1);
    expect(high.options.aspectRatio).toBe(3);
    expect(high.options.effect).toBe("normal");

    const low = makeCard({ image: IMG, maxTilt: -5, intensity: -1, pressScale: 0.1, aspectRatio: 0.2 });
    expect(low.options.maxTilt).toBe(0);
    expect(low.options.intensity).toBe(0);
    expect(low.options.pressScale).toBe(0.9);
    expect(low.options.aspectRatio).toBe(1);

    const nan = makeCard({ image: IMG, maxTilt: Number.NaN, aspectRatio: Number.NaN });
    expect(nan.options.maxTilt).toBe(7);
    expect(nan.options.aspectRatio).toBeCloseTo(1.586, 5);
  });

  it("touchTilt 默认 on；`off` 保留；非法值回退 on", () => {
    expect(makeCard({ image: IMG }).options.touchTilt).toBe("on");
    expect(makeCard({ image: IMG, touchTilt: "on" }).options.touchTilt).toBe("on");
    expect(makeCard({ image: IMG, touchTilt: "off" }).options.touchTilt).toBe("off");
    expect(
      makeCard({ image: IMG, touchTilt: "nonsense" as unknown as "on" }).options.touchTilt,
    ).toBe("on");
  });

  it("根元素只有 bc-card（+ 可选 className）与正确的数据属性", () => {
    const card = makeCard({ image: IMG, effect: "holographic", className: "bc-extra custom" });
    expect(card.element.classList.contains("bc-card")).toBe(true);
    expect(card.element.classList.contains("bc-extra")).toBe(true);
    expect(card.element.classList.contains("custom")).toBe(true);
    expect(card.element.dataset.bcEffect).toBe("holographic");
    expect(card.element.dataset.bcSurface).toBe("flat");
    // jsdom 中无触摸能力（maxTouchPoints=0 / 无 any-pointer:coarse）→ "false"。
    expect(card.element.dataset.bcTouch).toBe("false");
    expect(card.element.hasAttribute(TOUCH_TILT_ATTR)).toBe(false);
    expect(card.element.style.getPropertyValue("--bc-aspect")).toBe(String(1.586));
    expect(card.element.style.getPropertyValue("--bc-press")).toBe("1");
    // 根元素内只有一个子元素：底层 .holo-card。
    expect(card.element.childElementCount).toBe(1);
    const holo = holoOf(card);
    expect(holo.classList.contains("bc-card__holo")).toBe(true);
    // 契约要求的固定传参。
    expect(holo.dataset.effect).toBe("holo");
    expect(holo.style.getPropertyValue("--card-aspect")).toBe(String(1.586));
    expect(holo.style.getPropertyValue("--imgsize")).toBe("contain");
  });
});

describe("mount", () => {
  it("支持选择器与元素，重复 mount 不重复绑定（仍只有 1 个子元素）", () => {
    const host = document.createElement("div");
    const second = document.createElement("div");
    host.id = "bc-host";
    document.body.append(host, second);

    const card = makeCard({ image: IMG });
    card.mount("#bc-host");
    expect(host.childElementCount).toBe(1);
    expect(host.firstElementChild).toBe(card.element);

    card.mount(host);
    card.mount(host);
    expect(host.childElementCount).toBe(1);
    expect(card.element.parentElement).toBe(host);

    card.mount(second);
    expect(host.childElementCount).toBe(0);
    expect(second.childElementCount).toBe(1);
  });

  it("找不到选择器时抛明确错误", () => {
    const card = makeCard({ image: IMG });
    expect(() => card.mount("#bc-does-not-exist")).toThrow(/mount target not found/);
  });
});

describe("update", () => {
  it("切换图片只更新 img.src/alt，不重建实例", () => {
    const card = makeCard({ image: IMG, imageAlt: "old" });
    const holo = holoOf(card);
    expect(imageOf(card).getAttribute("src")).toBe(IMG);

    card.update({ image: IMG_ALT, imageAlt: "new" });

    expect(holoOf(card)).toBe(holo);
    expect(imageOf(card).getAttribute("src")).toBe(IMG_ALT);
    expect(imageOf(card).alt).toBe("new");
    expect(card.options.image).toBe(IMG_ALT);
  });

  it("切换 effect 调用 setEffect + setVisual", () => {
    const card = makeCard({ image: IMG, effect: "normal" });
    const holo = holoOf(card);
    card.update({ effect: "glitter" });
    expect(holoOf(card)).toBe(holo);
    expect(holo.dataset.effect).toBe("glitter");
    expect(card.element.dataset.bcEffect).toBe("glitter");
    expect(holo.style.getPropertyValue("--hc-shine-opacity")).toBe(String(0.34));
  });

  it("silver 效果与银色原图可来回切换", () => {
    const card = makeCard({ image: IMG, silverImage: SILVER, effect: "silver" });
    expect(imageOf(card).getAttribute("src")).toBe(SILVER);
    card.update({ effect: "normal" });
    expect(imageOf(card).getAttribute("src")).toBe(IMG);
    card.update({ effect: "silver" });
    expect(imageOf(card).getAttribute("src")).toBe(SILVER);
  });

  it("maxTilt / interactive / aspectRatio 变化会重建底层实例且不残留旧节点", () => {
    const card = makeCard({ image: IMG });
    const before = holoOf(card);

    card.update({ maxTilt: 12 });
    const afterTilt = holoOf(card);
    expect(afterTilt).not.toBe(before);
    expect(before.isConnected).toBe(false);
    expect(card.element.childElementCount).toBe(1);
    expect(card.options.maxTilt).toBe(12);

    card.update({ aspectRatio: 2 });
    const afterAspect = holoOf(card);
    expect(afterAspect.style.getPropertyValue("--card-aspect")).toBe(String(2));
    expect(card.element.style.getPropertyValue("--bc-aspect")).toBe(String(2));

    card.update({ interactive: false });
    expect(holoOf(card).classList.contains("holo-card--interactive")).toBe(false);
  });

  it("shine=false 时 glareOpacity 归零；imageFit 可运行时切换", () => {
    const card = makeCard({ image: IMG, shine: false, imageFit: "contain" });
    const holo = holoOf(card);
    expect(holo.style.getPropertyValue("--hc-glare-opacity")).toBe("0");
    card.update({ imageFit: "cover" });
    expect(holoOf(card).style.getPropertyValue("--imgsize")).toBe("cover");
  });

  it("destroy 之后 update 是安全的空操作", () => {
    const card = makeCard({ image: IMG });
    card.destroy();
    expect(() => card.update({ image: IMG_ALT })).not.toThrow();
    expect(card.options.image).toBe(IMG);
  });
});

describe("destroy", () => {
  it("幂等并移除 window / document 上的全部监听", () => {
    const tracker = trackListeners([window, document]);
    try {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const card = makeCard({ image: IMG });
      card.mount(host);
      expect(card.element.parentElement).toBe(host);

      card.destroy();
      expect(card.destroyed).toBe(true);
      expect(host.contains(card.element)).toBe(false);
      card.destroy();

      const isRemoved = (entry: ListenerRecord): boolean =>
        tracker.removed.some(
          (removed) =>
            removed.target === entry.target && removed.type === entry.type && removed.listener === entry.listener,
        );
      expect(tracker.added.length).toBeGreaterThan(0);
      expect(tracker.added.filter((entry) => !isRemoved(entry))).toEqual([]);
    } finally {
      tracker.restore();
    }
  });

  it("destroy 会移除按压反馈监听（监听平衡），且之后按下不再产生缩放", () => {
    const tracker = trackListeners([window, document, document.body]);
    try {
      const card = makeCard({ image: IMG, pressScale: 0.95 });
      // 销毁前：鼠标按下确实生效（防止“本来就无效所以看起来通过了”）。
      card.element.dispatchEvent(pointerEvent("pointerdown", { pointerType: "mouse" }));
      expect(card.element.style.getPropertyValue("--bc-press")).toBe("0.95");

      card.destroy();
      // 诊断性断言：只要 dispose 泄漏了监听，这里就会失败。
      expect(tracker.added.filter((entry) => !isListenerRemoved(tracker, entry))).toEqual([]);

      // 销毁后：即使再次派发，也不会出现按压态。
      card.element.dispatchEvent(pointerEvent("pointerdown", { pointerType: "mouse" }));
      expect(card.element.style.getPropertyValue("--bc-press")).toBe("1");
    } finally {
      tracker.restore();
    }
  });
});

describe("按压反馈 attachPressFeedback", () => {
  it("鼠标按下缩放、松开/取消/失焦/隐藏都会复位", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const dispose = attachPressFeedback(root, { pressScale: 0.95 });

    root.dispatchEvent(pointerEvent("pointerdown", { pointerType: "mouse" }));
    expect(root.style.getPropertyValue("--bc-press")).toBe("0.95");
    expect(root.getAttribute("data-bc-dragging")).toBe("true");

    window.dispatchEvent(new Event("pointerup"));
    expect(root.style.getPropertyValue("--bc-press")).toBe("1");
    expect(root.hasAttribute("data-bc-dragging")).toBe(false);

    root.dispatchEvent(pointerEvent("pointerdown"));
    window.dispatchEvent(new Event("pointercancel"));
    expect(root.style.getPropertyValue("--bc-press")).toBe("1");

    root.dispatchEvent(pointerEvent("pointerdown"));
    window.dispatchEvent(new Event("blur"));
    expect(root.style.getPropertyValue("--bc-press")).toBe("1");

    root.dispatchEvent(pointerEvent("pointerdown"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(root.style.getPropertyValue("--bc-press")).toBe("1");

    dispose();
  });

  it("触摸 / 右键 / enabled=false 不触发按压", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const dispose = attachPressFeedback(root, { pressScale: 0.95 });

    root.dispatchEvent(pointerEvent("pointerdown", { pointerType: "touch" }));
    expect(root.style.getPropertyValue("--bc-press")).toBe("1");

    root.dispatchEvent(pointerEvent("pointerdown", { pointerType: "mouse", button: 2 }));
    expect(root.style.getPropertyValue("--bc-press")).toBe("1");

    dispose();

    const disabled = attachPressFeedback(root, { pressScale: 0.95, enabled: () => false });
    root.dispatchEvent(pointerEvent("pointerdown", { pointerType: "mouse" }));
    expect(root.style.getPropertyValue("--bc-press")).toBe("1");

    disabled();
  });

  it("卸载函数移除监听并复位状态", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const dispose = attachPressFeedback(root, { pressScale: 0.9 });
    root.dispatchEvent(pointerEvent("pointerdown"));
    expect(root.style.getPropertyValue("--bc-press")).toBe("0.9");

    dispose();
    expect(root.style.getPropertyValue("--bc-press")).toBe("1");
    root.dispatchEvent(pointerEvent("pointerdown"));
    expect(root.style.getPropertyValue("--bc-press")).toBe("1");
  });

  it("clampPressScale 夹紧到 0.9 - 1", () => {
    expect(clampPressScale(0.5)).toBe(0.9);
    expect(clampPressScale(2)).toBe(1);
    expect(clampPressScale(0.97)).toBeCloseTo(0.97, 5);
    expect(clampPressScale(Number.NaN)).toBe(1);
    expect(clampPressScale(undefined)).toBe(1);
  });

  it("BankCard 上按下 / 松开同样会复位 --bc-press", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const card = makeCard({ image: IMG, pressScale: 0.94 });
    card.mount(host);

    card.element.dispatchEvent(pointerEvent("pointerdown", { pointerType: "mouse" }));
    expect(card.element.style.getPropertyValue("--bc-press")).toBe("0.94");
    window.dispatchEvent(new Event("pointerup"));
    expect(card.element.style.getPropertyValue("--bc-press")).toBe("1");
  });
});

describe("触摸倾斜 attachTouchTilt（长按后拖动）", () => {
  it("hasTouchInput 识别 navigator.maxTouchPoints", () => {
    vi.stubGlobal("navigator", { maxTouchPoints: 0 });
    expect(hasTouchInput()).toBe(false);
    vi.stubGlobal("navigator", { maxTouchPoints: 5 });
    expect(hasTouchInput()).toBe(true);
  });

  it("长按后进入倾斜；位移超过容差则取消长按；触摸以外的指针不参与", () => {
    vi.useFakeTimers();
    try {
      const root = document.createElement("div");
      document.body.appendChild(root);
      const seen: boolean[] = [];
      const dispose = attachTouchTilt(root, { onEngageChange: (value) => seen.push(value) });

      root.dispatchEvent(pointerEvent("pointerdown", { pointerType: "mouse" }));
      vi.advanceTimersByTime(TOUCH_LONG_PRESS_MS + 20);
      expect(root.hasAttribute(TOUCH_TILT_ATTR)).toBe(false);

      root.dispatchEvent(pointerEvent("pointerdown", { pointerType: "touch", pointerId: 7, clientX: 10, clientY: 10 }));
      vi.advanceTimersByTime(TOUCH_LONG_PRESS_MS - 20);
      expect(root.hasAttribute(TOUCH_TILT_ATTR)).toBe(false);
      vi.advanceTimersByTime(40);
      expect(root.getAttribute(TOUCH_TILT_ATTR)).toBe("true");

      window.dispatchEvent(pointerEvent("pointerup", { pointerType: "touch", pointerId: 7 }));
      expect(root.hasAttribute(TOUCH_TILT_ATTR)).toBe(false);

      // 长按判定前移动超过容差 → 该次手势不再进入倾斜（视为滚动 / 快滑）。
      root.dispatchEvent(pointerEvent("pointerdown", { pointerType: "touch", pointerId: 8, clientX: 0, clientY: 0 }));
      root.dispatchEvent(
        pointerEvent("pointermove", { pointerType: "touch", pointerId: 8, clientX: 40, clientY: 0 }),
      );
      vi.advanceTimersByTime(TOUCH_LONG_PRESS_MS + 50);
      expect(root.hasAttribute(TOUCH_TILT_ATTR)).toBe(false);
      window.dispatchEvent(pointerEvent("pointerup", { pointerType: "touch", pointerId: 8 }));

      expect(seen).toEqual([true, false]);
      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("未进入倾斜前拦截 pointermove（不让底层抖动）；进入后放行", () => {
    vi.useFakeTimers();
    try {
      const root = document.createElement("div");
      const child = document.createElement("div");
      root.appendChild(child);
      document.body.appendChild(root);
      const reached = vi.fn();
      child.addEventListener("pointermove", reached);
      const dispose = attachTouchTilt(root);

      root.dispatchEvent(pointerEvent("pointerdown", { pointerType: "touch", pointerId: 1, clientX: 5, clientY: 5 }));
      child.dispatchEvent(pointerEvent("pointermove", { pointerType: "touch", pointerId: 1, clientX: 6, clientY: 5 }));
      expect(reached).not.toHaveBeenCalled();

      vi.advanceTimersByTime(TOUCH_LONG_PRESS_MS + 10);
      child.dispatchEvent(pointerEvent("pointermove", { pointerType: "touch", pointerId: 1, clientX: 20, clientY: 30 }));
      expect(reached).toHaveBeenCalledTimes(1);

      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("进入倾斜后对 touchmove 调用 preventDefault；未进入时交给页面滚动", () => {
    vi.useFakeTimers();
    try {
      const root = document.createElement("div");
      document.body.appendChild(root);
      const dispose = attachTouchTilt(root);

      const idleMove = new Event("touchmove", { bubbles: true, cancelable: true });
      root.dispatchEvent(idleMove);
      expect(idleMove.defaultPrevented).toBe(false);

      root.dispatchEvent(pointerEvent("pointerdown", { pointerType: "touch", pointerId: 2, clientX: 0, clientY: 0 }));
      vi.advanceTimersByTime(TOUCH_LONG_PRESS_MS + 10);
      const engagedMove = new Event("touchmove", { bubbles: true, cancelable: true });
      root.dispatchEvent(engagedMove);
      expect(engagedMove.defaultPrevented).toBe(true);

      dispose();
      const afterDispose = new Event("touchmove", { bubbles: true, cancelable: true });
      root.dispatchEvent(afterDispose);
      expect(afterDispose.defaultPrevented).toBe(false);
      expect(root.hasAttribute(TOUCH_TILT_ATTR)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("enabled=false 时不进入倾斜；blur / visibilitychange 会退出倾斜", () => {
    vi.useFakeTimers();
    try {
      const root = document.createElement("div");
      document.body.appendChild(root);
      const disabled = attachTouchTilt(root, { enabled: () => false });
      root.dispatchEvent(pointerEvent("pointerdown", { pointerType: "touch", pointerId: 3 }));
      vi.advanceTimersByTime(TOUCH_LONG_PRESS_MS + 50);
      expect(root.hasAttribute(TOUCH_TILT_ATTR)).toBe(false);
      disabled();

      const dispose = attachTouchTilt(root);
      root.dispatchEvent(pointerEvent("pointerdown", { pointerType: "touch", pointerId: 4 }));
      vi.advanceTimersByTime(TOUCH_LONG_PRESS_MS + 10);
      expect(root.getAttribute(TOUCH_TILT_ATTR)).toBe("true");
      window.dispatchEvent(new Event("blur"));
      expect(root.hasAttribute(TOUCH_TILT_ATTR)).toBe(false);

      root.dispatchEvent(pointerEvent("pointerdown", { pointerType: "touch", pointerId: 5 }));
      vi.advanceTimersByTime(TOUCH_LONG_PRESS_MS + 10);
      document.dispatchEvent(new Event("visibilitychange"));
      expect(root.hasAttribute(TOUCH_TILT_ATTR)).toBe(false);
      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("BankCard 默认在触摸时长按进入倾斜，`touchTilt: off` / `dragTilt: false` 时不进入", () => {
    vi.useFakeTimers();
    try {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const card = makeCard({ image: IMG });
      card.mount(host);
      card.element.dispatchEvent(pointerEvent("pointerdown", { pointerType: "touch", pointerId: 11 }));
      vi.advanceTimersByTime(TOUCH_LONG_PRESS_MS + 10);
      expect(card.element.getAttribute(TOUCH_TILT_ATTR)).toBe("true");
      expect(card.element.style.getPropertyValue("--bc-press")).toBe(String(card.options.pressScale));
      window.dispatchEvent(pointerEvent("pointerup", { pointerType: "touch", pointerId: 11 }));
      expect(card.element.style.getPropertyValue("--bc-press")).toBe("1");

      card.update({ touchTilt: "off" });
      card.element.dispatchEvent(pointerEvent("pointerdown", { pointerType: "touch", pointerId: 12 }));
      vi.advanceTimersByTime(TOUCH_LONG_PRESS_MS + 10);
      expect(card.element.hasAttribute(TOUCH_TILT_ATTR)).toBe(false);
      window.dispatchEvent(pointerEvent("pointerup", { pointerType: "touch", pointerId: 12 }));

      card.update({ touchTilt: "on", dragTilt: false });
      card.element.dispatchEvent(pointerEvent("pointerdown", { pointerType: "touch", pointerId: 13 }));
      vi.advanceTimersByTime(TOUCH_LONG_PRESS_MS + 10);
      expect(card.element.hasAttribute(TOUCH_TILT_ATTR)).toBe(false);
      window.dispatchEvent(pointerEvent("pointerup", { pointerType: "touch", pointerId: 13 }));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("matchMedia 缺失与减少动效", () => {
  it("matchMedia 不存在时不抛错，并视为精细指针 / 非减少动效", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(() => isFinePointer()).not.toThrow();
    expect(isFinePointer()).toBe(true);
    expect(prefersReducedMotion()).toBe(false);
    const card = makeCard({ image: IMG });
    expect(holoOf(card).classList.contains("holo-card--interactive")).toBe(true);
  });

  it("respectReducedMotion 时关闭倾斜、按压与过渡（卡片静止）", () => {
    const card = makeCard({ image: IMG });
    expect(card.element.dataset.bcReducedMotion).toBe("false");
    expect(holoOf(card).classList.contains("holo-card--interactive")).toBe(true);

    media.setReduced(true);

    expect(card.element.dataset.bcReducedMotion).toBe("true");
    expect(holoOf(card).classList.contains("holo-card--interactive")).toBe(false);
    expect(card.element.style.getPropertyValue("--bc-press")).toBe("1");
    card.element.dispatchEvent(pointerEvent("pointerdown", { pointerType: "mouse" }));
    expect(card.element.style.getPropertyValue("--bc-press")).toBe("1");

    media.setReduced(false);
    expect(card.element.dataset.bcReducedMotion).toBe("false");
    expect(holoOf(card).classList.contains("holo-card--interactive")).toBe(true);
  });

  it("respectReducedMotion=false 时忽略系统设置", () => {
    media.setReduced(true);
    const card = makeCard({ image: IMG, respectReducedMotion: false });
    expect(card.element.dataset.bcReducedMotion).toBe("false");
    expect(holoOf(card).classList.contains("holo-card--interactive")).toBe(true);
  });

  it("watchReducedMotion 返回的取消函数会移除 change 监听", () => {
    const seen: boolean[] = [];
    const stop = watchReducedMotion((reduced) => seen.push(reduced));
    expect(media.listenerCount()).toBe(1);
    media.setReduced(true);
    expect(seen).toEqual([true]);
    stop();
    expect(media.listenerCount()).toBe(0);
    media.setReduced(false);
    expect(seen).toEqual([true]);
  });

  it("destroy 会注销 matchMedia 的 change 监听", () => {
    const card = makeCard({ image: IMG });
    expect(media.listenerCount()).toBe(1);
    card.destroy();
    expect(media.listenerCount()).toBe(0);
  });
});

describe("样式约束", () => {
  // Vitest 默认会把 CSS 导入替换成空模块，因此直接经 Node 读取源文件。
  const nodeFs = process.getBuiltinModule("fs");
  const rawCss = nodeFs.readFileSync(`${process.cwd()}/src/styles/bank-card.css`, "utf8");
  const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, "");

  it("不包含全局选择器", () => {
    expect(css).not.toMatch(/(^|[},])\s*:root/);
    expect(css).not.toMatch(/(^|[},])\s*html\b/);
    expect(css).not.toMatch(/(^|[},])\s*body\b/);
    expect(css).not.toMatch(/(^|[},])\s*\*/);
  });

  it("重新声明底层所需变量（不依赖站点全局变量）", () => {
    const required = [
      "--card-aspect",
      "--card-radius",
      "--card-scale",
      "--card-opacity",
      "--pointer-x",
      "--pointer-y",
      "--translate-x",
      "--translate-y",
      "--rotate-x",
      "--rotate-y",
      "--background-x",
      "--background-y",
      "--tilt-x",
      "--tilt-y",
      "--card-back",
      "--card-edge",
      "--card-glow",
    ];
    for (const name of required) {
      expect(css).toContain(`${name}:`);
    }
    expect(css).toContain("--card-radius: 3.72% / 5.89%");
    expect(css).toContain("touch-action: pan-y");
    expect(css).toContain("scale(var(--bc-press, 1))");
    expect(css).toContain('[data-bc-reduced-motion="true"]');
    expect(css).toContain('[data-bc-press="off"]');
  });

  it("触屏修正：粘滞 hover 复位、长按手势不被原生菜单 / 拖拽抢走", () => {
    // 触屏上非交互模式的 hover 兜底必须复位为静止值（否则 tap 后卡片钉在最大倾角）。
    expect(css).toMatch(
      /\[data-bc-touch="true"\][^{]*\.bc-card__holo:not\(\.holo-card--interactive\):hover[^{]*\{/,
    );
    expect(css).toMatch(
      /@media \(hover: none\)[^{]*\{[^@]*\.bc-card__holo:not\(\.holo-card--interactive\):hover/,
    );
    // 触屏长按不弹 iOS 菜单、图片不抢手势。
    expect(css).toContain("-webkit-touch-callout: none");
    expect(css).toMatch(/\.bc-card img\s*\{[^}]*-webkit-user-drag: none[^}]*pointer-events: none/);
  });

  it("质感：flat 覆盖较重的投影、physical 保留实体感（都不影响特效层）", () => {
    // flat 必须用属性选择器覆盖底层 .holo-card__rotator 的重投影，并去掉霓虹边缘 / 辉光。
    expect(css).toContain('[data-bc-surface="flat"]');
    expect(css).toContain("--card-glow: transparent");
    expect(css).toContain("--card-edge: transparent");
    expect(css).toMatch(/\[data-bc-surface="flat"\][^{]*\.holo-card__rotator[^{]*\{[^}]*box-shadow/);
    // flat 的投影里不得出现黑色重投影。
    const flatBlock = /\[data-bc-surface="flat"\][^{]*\.holo-card__rotator,[\s\S]*?\}\s*\}/.exec(css)?.[0] ?? "";
    expect(flatBlock).not.toContain("black");
    // physical 恢复底层透视（盒阴影交给底层默认，保持实体感）。
    expect(css).toContain('[data-bc-surface="physical"]');
    expect(css).toMatch(/\[data-bc-surface="physical"\][^{]*\{[^}]*--card-perspective: 600px/);
  });
});
