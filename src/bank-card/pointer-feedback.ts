/**
 * 按压反馈 + 指针 / 减少动效工具。
 *
 * 这里刻意不依赖 `BankCardInstance`，全部是纯函数 / 可单测的小逻辑：
 * - `attachPressFeedback(root, opts)`：在根元素上实现按压缩放反馈，返回卸载函数；
 * - `isFinePointer()` / `prefersReducedMotion()`：带 matchMedia 存在性判断的媒体查询；
 * - `watchReducedMotion(cb)`：监听 `prefers-reduced-motion` 变化，返回取消函数。
 *
 * 设计取舍：底层 `@kongyo2/cards-css` 只写 `.holo-card__translater/_rotator` 的
 * transform，因此我们把真实缩放施加在 `.bc-card` 根元素上，两者互不冲突。
 */

/** 允许的最小按压缩放。 */
export const MIN_PRESS_SCALE = 0.9;
/** 最大按压缩放，`1` 表示关闭反馈。 */
export const MAX_PRESS_SCALE = 1;

/** 夹紧按压缩放到 `0.9 - 1`（非法值回退为 `1`）。 */
export function clampPressScale(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MAX_PRESS_SCALE;
  }
  return Math.min(MAX_PRESS_SCALE, Math.max(MIN_PRESS_SCALE, value));
}

/**
 * 安全地获取 `MediaQueryList`。
 * jsdom / 老浏览器可能没有 `matchMedia`（或缺 `window`），此时返回 `null` 而不是抛错。
 */
export function safeMatchMedia(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  try {
    return window.matchMedia(query);
  } catch {
    return null;
  }
}

/**
 * 是否允许“精细指针”交互（hover + fine）。
 * matchMedia 缺失时视为精细指针（契约：jsdom 下缺省当桌面处理）。
 */
export function isFinePointer(): boolean {
  const list = safeMatchMedia("(hover: hover) and (pointer: fine)");
  return list ? list.matches : true;
}

/** 用户是否要求减少动效；matchMedia 缺失时视为否。 */
export function prefersReducedMotion(): boolean {
  const list = safeMatchMedia("(prefers-reduced-motion: reduce)");
  return list ? list.matches : false;
}

type ReducedMotionListener = (event: MediaQueryListEvent) => void;

/** 旧版 MediaQueryList API 的最小结构（仅用于存在性判断，避免依赖已废弃类型）。 */
interface LegacyMediaQueryList {
  addListener?: (listener: ReducedMotionListener) => void;
  removeListener?: (listener: ReducedMotionListener) => void;
}

/**
 * 监听 `prefers-reduced-motion` 变化。返回取消函数（必须在 destroy 时调用）。
 * 不支持 matchMedia 时返回一个空操作函数，调用方无需额外分支。
 */
export function watchReducedMotion(onChange: (reduced: boolean) => void): () => void {
  const list = safeMatchMedia("(prefers-reduced-motion: reduce)");
  if (!list) {
    return () => undefined;
  }
  const handler: ReducedMotionListener = (event) => onChange(event.matches);
  if (typeof list.addEventListener === "function") {
    list.addEventListener("change", handler);
    return () => list.removeEventListener("change", handler);
  }
  const legacy = list as unknown as LegacyMediaQueryList;
  if (typeof legacy.addListener === "function") {
    legacy.addListener(handler);
    return () => legacy.removeListener?.(handler);
  }
  return () => undefined;
}

/** `attachPressFeedback` 的参数。 */
export interface PressFeedbackOptions {
  /** 按下时的缩放（会夹紧到 `0.9 - 1`）。 */
  pressScale?: number;
  /** 返回 `false` 时忽略按压（例如 reduced motion 生效）。 */
  enabled?: () => boolean;
  /** 按压状态变化回调（可选）。 */
  onPressChange?: (pressed: boolean) => void;
}

/**
 * 在 `root`（`.bc-card`）上附加鼠标按压反馈：
 * - `pointerdown`（`pointerType === "mouse"` 且左键）→ `--bc-press: <pressScale>`；
 * - `window` 上兜底 `pointerup` / `pointercancel` / `blur`，`document` 上兜底 `visibilitychange`，
 *   任何中断 / 失焦 / 隐藏都会复位为 `1`，不会卡在按下态；
 * - 触摸（`pointerType === "touch"`）不参与反馈，配合 CSS `touch-action: pan-y` 不干扰滚动。
 *
 * 返回卸载函数：移除全部监听并复位状态。
 */
export function attachPressFeedback(root: HTMLElement, options: PressFeedbackOptions = {}): () => void {
  const scale = clampPressScale(options.pressScale);
  const style = root.style;
  let pressed = false;

  const isEnabled = (): boolean => scale < MAX_PRESS_SCALE && (options.enabled ? options.enabled() : true);

  const setPressed = (next: boolean): void => {
    if (next === pressed) {
      return;
    }
    pressed = next;
    if (next) {
      style.setProperty("--bc-press", String(scale));
      root.setAttribute("data-bc-dragging", "true");
    } else {
      style.setProperty("--bc-press", "1");
      root.removeAttribute("data-bc-dragging");
    }
    options.onPressChange?.(next);
  };

  const release = (): void => {
    if (pressed) {
      setPressed(false);
    }
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") {
      return;
    }
    if (typeof event.button === "number" && event.button !== 0) {
      return;
    }
    if (!isEnabled()) {
      return;
    }
    setPressed(true);
  };

  const onVisibilityChange = (): void => {
    release();
  };

  root.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
  window.addEventListener("blur", release);
  document.addEventListener("visibilitychange", onVisibilityChange);
  // 初始必须处于未按下态，避免复用根元素时继承脏值。
  style.setProperty("--bc-press", "1");

  return () => {
    root.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointerup", release);
    window.removeEventListener("pointercancel", release);
    window.removeEventListener("blur", release);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    pressed = false;
    style.setProperty("--bc-press", "1");
    root.removeAttribute("data-bc-dragging");
  };
}
