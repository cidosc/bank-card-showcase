/**
 * 按压反馈 + 指针 / 减少动效工具。
 *
 * 这里刻意不依赖 `BankCardInstance`，全部是纯函数 / 可单测的小逻辑：
 * - `attachPressFeedback(root, opts)`：在根元素上实现按压缩放反馈，返回卸载函数；
 * - `attachTouchTilt(root, opts)`：长按进入「触摸倾斜」，返回卸载函数；
 * - `isFinePointer()` / `hasTouchInput()` / `prefersReducedMotion()`：带 matchMedia
 *   存在性判断的媒体查询；
 * - `watchReducedMotion(cb)`：监听 `prefers-reduced-motion` 变化，返回取消函数。
 *
 * 设计取舍：底层 `@kongyo2/cards-css` 只写 `.holo-card__translater/_rotator` 的
 * transform，因此我们把真实缩放施加在 `.bc-card` 根元素上，两者互不冲突。
 *
 * 触摸策略（为什么需要 `attachTouchTilt`）：
 * - 触屏浏览器在 tap 之后会让 `:hover` 保持「粘滞」状态。底层卡片在
 *   **非交互**模式下用 `.holo-card:not(.holo-card--interactive):hover` 作为兜底，
 *   一旦被 tap 触发就会把卡片钉在最大倾角并点亮高光层，直到点击其它区域才复位。
 * - 包装层因此把触屏上的倾斜交给**真实的指针交互**（长按后 `pointermove`），并在
 *   CSS 里把非交互模式的 hover 兜底在触屏上复位（见 `styles/bank-card.css`）。
 * - 长按门槛（默认 160ms 且位移不超过 10px）用于区分「滚动 / 快速滑动」与
 *   「按住观赏」：未进入倾斜前拦截 `pointermove`（不让底层产生抖动），进入倾斜后对
 *   `touchmove` 调用 `preventDefault()` 冻结该次手势的页面滚动，松开后由底层弹簧回正。
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

/** 当前环境是否具备触摸输入（用于触屏专用样式与状态属性）。 */
export function hasTouchInput(): boolean {
  if (typeof navigator !== "undefined") {
    const points = navigator.maxTouchPoints;
    if (typeof points === "number" && points > 0) {
      return true;
    }
  }
  const coarse = safeMatchMedia("(any-pointer: coarse)");
  return coarse ? coarse.matches : false;
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

/** 长按判定时间（ms）：按住不动超过该时间即进入触摸倾斜。 */
export const TOUCH_LONG_PRESS_MS = 160;
/** 长按判定前的移动容差（px）：超过视为滚动 / 快速滑动，本次手势不再进入倾斜。 */
export const TOUCH_MOVE_TOLERANCE_PX = 10;
/** 进入触摸倾斜期间挂在根元素上的状态属性（供 CSS / 宿主观测）。 */
export const TOUCH_TILT_ATTR = "data-bc-touch-tilt";

/** `attachTouchTilt` 的参数。 */
export interface TouchTiltOptions {
  /** 长按判定时间（ms），默认 160。 */
  longPressMs?: number;
  /** 长按判定前的移动容差（px），默认 10。 */
  moveTolerancePx?: number;
  /** 返回 `false` 时忽略触摸（例如已销毁 / 减少动效生效）。 */
  enabled?: () => boolean;
  /** 进入 / 退出触摸倾斜的回调（用于按压缩放与状态反馈）。 */
  onEngageChange?: (engaged: boolean) => void;
}

/**
 * 触屏倾斜适配器：把「长按卡面后拖动」变成底层的真实指针交互。
 *
 * 行为：
 * - `pointerdown`（`pointerType === "touch"`）开始计时；
 * - 计时结束且位移未超过容差 → 进入倾斜态（挂 `data-bc-touch-tilt="true"`）；
 * - 位移超过容差 → 取消长按，本次手势保持拦截（用于页面滚动 / 快速滑动）；
 * - 未进入倾斜前，在**捕获阶段**拦截 `pointermove`，底层不会因滚动产生抖动；
 * - 进入倾斜后，对 `touchmove` 调用 `preventDefault()` 冻结本次手势的滚动，
 *   让手指在任意方向都能连续调整倾角；
 * - `pointerup` / `pointercancel` / `blur` / `visibilitychange` 都会退出倾斜态。
 *
 * 返回卸载函数：移除全部监听、清除计时器并复位状态属性。
 */
export function attachTouchTilt(root: HTMLElement, options: TouchTiltOptions = {}): () => void {
  const longPressMs = options.longPressMs ?? TOUCH_LONG_PRESS_MS;
  const tolerance = options.moveTolerancePx ?? TOUCH_MOVE_TOLERANCE_PX;
  const isEnabled = (): boolean => (options.enabled ? options.enabled() : true);

  let activeId: number | null = null;
  let startX = 0;
  let startY = 0;
  let engaged = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const setEngaged = (next: boolean): void => {
    if (next === engaged) {
      return;
    }
    engaged = next;
    if (next) {
      root.setAttribute(TOUCH_TILT_ATTR, "true");
    } else {
      root.removeAttribute(TOUCH_TILT_ATTR);
    }
    options.onEngageChange?.(next);
  };

  const endGesture = (): void => {
    clearTimer();
    activeId = null;
    setEngaged(false);
  };

  const isTrackedTouch = (event: PointerEvent): boolean =>
    event.pointerType === "touch" && activeId !== null && event.pointerId === activeId;

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== "touch" || !isEnabled() || activeId !== null) {
      return;
    }
    activeId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      if (activeId !== null && isEnabled()) {
        setEngaged(true);
      }
    }, longPressMs);
  };

  /** 捕获阶段：未进入倾斜前不让底层看到 `pointermove`（避免滚动时卡片抖动）。 */
  const onPointerMoveCapture = (event: PointerEvent): void => {
    if (!isTrackedTouch(event)) {
      return;
    }
    if (engaged) {
      return;
    }
    if (timer !== null) {
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.hypot(dx, dy) > tolerance) {
        clearTimer();
      }
    }
    event.stopPropagation();
  };

  /** 进入倾斜后冻结本次手势的滚动；未进入倾斜时保持页面可以正常滚动。 */
  const onTouchMove = (event: TouchEvent): void => {
    if (engaged) {
      event.preventDefault();
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (isTrackedTouch(event)) {
      endGesture();
    }
  };

  const onBlur = (): void => {
    if (activeId !== null || engaged) {
      endGesture();
    }
  };

  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMoveCapture, true);
  root.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onBlur);

  return () => {
    root.removeEventListener("pointerdown", onPointerDown);
    root.removeEventListener("pointermove", onPointerMoveCapture, true);
    root.removeEventListener("touchmove", onTouchMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onBlur);
    clearTimer();
    activeId = null;
    setEngaged(false);
  };
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
 * - 触摸（`pointerType === "touch"`）不参与反馈（触摸倾斜的长按反馈由
 *   `attachTouchTilt` 负责），配合 CSS `touch-action: pan-y` 不干扰滚动。
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
