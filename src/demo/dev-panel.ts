/**
 * Demo 开发控件面板（只存在于 Demo，不属于 BankCard / 生产组件）。
 *
 * 提供 6 组控件：
 *   ① 商品切换（Cookie / Sad Panda）
 *   ② 效果切换（由 BANK_CARD_EFFECTS 渲染：normal / holographic / glitter / silver）
 *   ③ 卡面质感切换（由 BANK_CARD_SURFACES 渲染：flat 平面 / physical 实体）
 *   ④ 最大倾角滑块（0–14，默认 7）
 *   ⑤ 库存状态模拟（仅 Demo 用，便于验证缺货禁用态）
 *   ⑥ 卸载 / 重新挂载（验证生命周期与重复挂载）
 *
 * 面板只负责「呈现状态 + 回调」，所有状态由 `src/demo/main.ts` 持有。
 * 全部 DOM 用 createElement / textContent 构建，不使用 innerHTML。
 */

import { BANK_CARD_EFFECTS } from "../effects.js";
import { BANK_CARD_SURFACES } from "../surfaces.js";
import type { BankCardEffect, BankCardSurface } from "../types.js";

export type DemoStockChoice = "product-default" | "in-stock" | "low-stock" | "out-of-stock";

export interface DevPanelState {
  productId: string;
  effect: BankCardEffect;
  surface: BankCardSurface;
  maxTilt: number;
  stock: DemoStockChoice;
  mounted: boolean;
}

export interface DevPanelProductOption {
  id: string;
  name: string;
}

export interface DevPanelHandlers {
  onProduct(id: string): void;
  onEffect(effect: BankCardEffect): void;
  onSurface(surface: BankCardSurface): void;
  onMaxTilt(value: number): void;
  onStock(choice: DemoStockChoice): void;
  onToggleMount(): void;
}

export interface DevPanelOptions {
  products: readonly DevPanelProductOption[];
  handlers: DevPanelHandlers;
  /** 最大倾角滑块范围，默认 0–14。 */
  maxTiltRange?: { min: number; max: number; step: number };
}

export interface DevPanelInstance {
  readonly element: HTMLElement;
  render(state: DevPanelState): void;
}

const TILT_INPUT_ID = "bc-demo-max-tilt";
const TILT_OUTPUT_ID = "bc-demo-max-tilt-value";

const STOCK_OPTIONS: ReadonlyArray<{ value: DemoStockChoice; label: string }> = [
  { value: "product-default", label: "商品自带" },
  { value: "in-stock", label: "现货" },
  { value: "low-stock", label: "仅剩 3 件" },
  { value: "out-of-stock", label: "缺货" },
];

interface Choice<T extends string> {
  value: T;
  button: HTMLButtonElement;
}

function createChoice<T extends string>(value: T, label: string, onSelect: (value: T) => void): Choice<T> {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bc-btn bc-btn--secondary bc-demo__choice";
  button.textContent = label;
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", () => onSelect(value));
  return { value, button };
}

function createGroup(groupLabel: string, choices: HTMLElement[]): HTMLDivElement {
  const group = document.createElement("div");
  group.className = "bc-demo__group";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", groupLabel);

  const label = document.createElement("span");
  label.className = "bc-demo__group-label";
  label.textContent = groupLabel;

  const row = document.createElement("div");
  row.className = "bc-demo__choices";
  row.append(...choices);

  group.append(label, row);
  return group;
}

/**
 * 创建开发控件面板。面板内的按钮复用 `.bc-btn` 样式（点击区域 ≥ 44px、
 * 可见焦点环），选中态由 `aria-pressed` + Demo 样式表达。
 */
export function createDevPanel(options: DevPanelOptions): DevPanelInstance {
  const handlers = options.handlers;
  const range = options.maxTiltRange ?? { min: 0, max: 14, step: 1 };

  const element = document.createElement("section");
  element.className = "bc-demo__panel";
  element.setAttribute("aria-labelledby", "bc-demo-panel-title");

  const header = document.createElement("header");
  header.className = "bc-demo__panel-header";
  const title = document.createElement("h2");
  title.className = "bc-demo__panel-title";
  title.id = "bc-demo-panel-title";
  title.textContent = "开发演示控件";
  const note = document.createElement("p");
  note.className = "bc-demo__panel-note";
  note.textContent = "开发演示控件，不属于生产组件（仅 Demo 存在）。";
  header.append(title, note);

  const controls = document.createElement("div");
  controls.className = "bc-demo__controls";

  // ① 商品切换
  const productChoices = options.products.map((product) =>
    createChoice(product.id, product.name, (id) => handlers.onProduct(id)),
  );
  controls.append(createGroup("① 商品切换", productChoices.map((choice) => choice.button)));

  // ② 效果切换（由 BANK_CARD_EFFECTS 渲染，保证与组件支持的效果一致）
  const effectChoices = BANK_CARD_EFFECTS.map((effect) =>
    createChoice<BankCardEffect>(effect, effect, (value) => handlers.onEffect(value)),
  );
  controls.append(createGroup("② 效果切换（effect）", effectChoices.map((choice) => choice.button)));

  // ③ 卡面质感（平面 / 实体）：只影响投影、边缘与透视强弱，不影响特效
  const surfaceChoices = BANK_CARD_SURFACES.map((surface) =>
    createChoice<BankCardSurface>(surface, surface, (value) => handlers.onSurface(value)),
  );
  controls.append(createGroup("③ 卡面质感（surface）", surfaceChoices.map((choice) => choice.button)));

  // ④ 最大倾角滑块
  const tiltGroup = document.createElement("div");
  tiltGroup.className = "bc-demo__group";
  tiltGroup.setAttribute("role", "group");
  tiltGroup.setAttribute("aria-label", "最大倾角");
  const tiltLabel = document.createElement("label");
  tiltLabel.className = "bc-demo__group-label";
  tiltLabel.htmlFor = TILT_INPUT_ID;
  tiltLabel.textContent = "④ 最大倾角（maxTilt，0–14，默认 7）";
  const tiltRow = document.createElement("div");
  tiltRow.className = "bc-demo__range-row";
  const tiltInput = document.createElement("input");
  tiltInput.type = "range";
  tiltInput.id = TILT_INPUT_ID;
  tiltInput.className = "bc-demo__range";
  tiltInput.min = String(range.min);
  tiltInput.max = String(range.max);
  tiltInput.step = String(range.step);
  tiltInput.value = "7";
  const tiltOutput = document.createElement("output");
  tiltOutput.className = "bc-demo__range-value";
  tiltOutput.id = TILT_OUTPUT_ID;
  tiltOutput.htmlFor = TILT_INPUT_ID;
  /** 滑块自身立即同步显示值（包含 aria-valuetext，不依赖宿主重新 render）。 */
  const syncTiltDisplay = (value: number): void => {
    const text = `${value}°`;
    tiltInput.setAttribute("aria-valuetext", text);
    tiltOutput.textContent = text;
  };
  tiltInput.addEventListener("input", () => {
    const value = Number(tiltInput.value);
    syncTiltDisplay(value);
    handlers.onMaxTilt(value);
  });
  tiltRow.append(tiltInput, tiltOutput);
  tiltGroup.append(tiltLabel, tiltRow);
  controls.append(tiltGroup);

  // ⑤ 库存状态模拟（Demo 专用：用于验证缺货时的原生 disabled 呈现）
  const stockChoices = STOCK_OPTIONS.map((option) =>
    createChoice<DemoStockChoice>(option.value, option.label, (value) => handlers.onStock(value)),
  );
  controls.append(createGroup("⑤ 库存状态模拟", stockChoices.map((choice) => choice.button)));

  // ⑥ 卸载 / 重新挂载
  const mountGroup = document.createElement("div");
  mountGroup.className = "bc-demo__group";
  mountGroup.setAttribute("role", "group");
  mountGroup.setAttribute("aria-label", "生命周期");
  const mountLabel = document.createElement("span");
  mountLabel.className = "bc-demo__group-label";
  mountLabel.textContent = "⑥ 生命周期（destroy / mount）";
  const mountRow = document.createElement("div");
  mountRow.className = "bc-demo__choices";
  const mountButton = document.createElement("button");
  mountButton.type = "button";
  mountButton.className = "bc-btn bc-btn--secondary bc-demo__mount";
  mountButton.dataset.bcDemoMount = "toggle";
  mountButton.addEventListener("click", () => handlers.onToggleMount());
  mountRow.append(mountButton);
  mountGroup.append(mountLabel, mountRow);
  controls.append(mountGroup);

  element.append(header, controls);

  const setPressed = <T extends string>(choices: Array<Choice<T>>, active: T): void => {
    for (const choice of choices) {
      choice.button.setAttribute("aria-pressed", choice.value === active ? "true" : "false");
    }
  };

  function render(state: DevPanelState): void {
    setPressed(productChoices, state.productId);
    setPressed(effectChoices, state.effect);
    setPressed(surfaceChoices, state.surface);
    setPressed(stockChoices, state.stock);

    const tiltValue = String(state.maxTilt);
    if (tiltInput.value !== tiltValue) {
      tiltInput.value = tiltValue;
    }
    syncTiltDisplay(state.maxTilt);

    mountButton.textContent = state.mounted ? "卸载（destroy）" : "重新挂载（mount）";
    mountButton.setAttribute("aria-pressed", state.mounted ? "true" : "false");
    element.dataset.bcDemoMounted = state.mounted ? "true" : "false";
  }

  return { element, render };
}
