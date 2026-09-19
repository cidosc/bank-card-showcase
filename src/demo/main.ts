/**
 * Demo 入口（只用于演示与联调，不属于生产组件）。
 *
 * 页面结构：标题 / 商品展示容器（左卡右信息，移动端上下）/ 开发控件面板 /
 * 实时状态行 / 按钮点击反馈行。
 *
 * 这里只做前端状态编排：
 *   - 切换商品 / 效果 / 倾角 / 库存 -> `showcase.update()` + `card.update()` 路径；
 *   - 卸载 -> `showcase.destroy()`；重新挂载 -> 用当前状态重新 `createProductShowcase()`。
 */

import { createProductShowcase } from "../index.js";
import type {
  BankCardEffect,
  BankCardSurface,
  ProductData,
  ProductShowcaseInstance,
  ProductStock,
} from "../types.js";
import { createDevPanel } from "./dev-panel.js";
import type { DemoStockChoice, DevPanelState } from "./dev-panel.js";
import { DEFAULT_PRODUCT_ID, DEMO_PRODUCTS, STOCK_PRESETS, findProduct } from "./mock-data.js";
import "./demo.css";

/** 默认最大倾角（与 BankCard 默认值一致）。 */
const DEFAULT_MAX_TILT = 7;

interface DemoState {
  productId: string;
  effect: BankCardEffect;
  surface: BankCardSurface;
  maxTilt: number;
  stock: DemoStockChoice;
  mounted: boolean;
}

/** 取必需的页面骨架节点；缺失时立即报错，避免 Demo 静默失效。 */
function mustQuery<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) {
    throw new Error(`[bc-demo] 页面骨架缺少必需节点：${selector}`);
  }
  return found;
}

const host = mustQuery("#bc-demo-showcase");
const panelHost = mustQuery("#bc-demo-panel");
const statusList = mustQuery("#bc-demo-status");
const feedbackLine = mustQuery("#bc-demo-feedback");

const state: DemoState = {
  productId: DEFAULT_PRODUCT_ID,
  effect: findProduct(DEFAULT_PRODUCT_ID).effect ?? "normal",
  surface: "flat",
  maxTilt: DEFAULT_MAX_TILT,
  stock: "product-default",
  mounted: false,
};

let showcase: ProductShowcaseInstance | null = null;

function stockFor(choice: DemoStockChoice, fallback: ProductStock | undefined): ProductStock | undefined {
  return choice === "product-default" ? fallback : STOCK_PRESETS[choice];
}

/** 当前生效的商品数据（叠加 Demo 的效果 / 库存模拟）。 */
function currentProduct(): ProductData {
  const base = findProduct(state.productId);
  return { ...base, effect: state.effect, stock: stockFor(state.stock, base.stock) };
}

/** 当前实际用于渲染的卡面文件名（silver 效果时是银色原图）。 */
function appliedFileName(product: ProductData): string {
  const url = state.effect === "silver" && product.silverImage ? product.silverImage : product.image;
  const path = url.split(/[?#]/)[0] ?? url;
  const segments = path.split("/");
  const last = segments[segments.length - 1];
  return last && last.length > 0 ? decodeURIComponent(last) : url;
}

// —— 实时状态行（验收用：效果 / 倾角 / 卡面文件名）——
const statusValues = new Map<string, HTMLElement>();

function statusValue(label: string): HTMLElement {
  const existing = statusValues.get(label);
  if (existing) {
    return existing;
  }
  const term = document.createElement("dt");
  term.className = "bc-demo__status-term";
  term.textContent = label;
  const value = document.createElement("dd");
  value.className = "bc-demo__status-value";
  value.dataset.bcDemoStatus = label;
  statusList.append(term, value);
  statusValues.set(label, value);
  return value;
}

function renderStatus(): void {
  const product = currentProduct();
  statusValue("商品").textContent = product.name;
  statusValue("当前效果").textContent = state.effect;
  statusValue("当前质感").textContent = state.surface;
  statusValue("当前倾角").textContent = `${state.maxTilt}°`;
  statusValue("当前卡面").textContent = appliedFileName(product);
  statusValue("挂载状态").textContent = showcase ? "已挂载" : "已卸载（destroy）";
}

function handleAction(actionId: string, product: ProductData): void {
  const action = product.actions?.find((item) => item.id === actionId);
  feedbackLine.textContent = `按钮点击：${product.name} ·「${action?.label ?? actionId}」（action id: ${actionId}）— 纯前端演示，未接入购物车 / 订单 / 支付。`;
}

function panelState(): DevPanelState {
  return {
    productId: state.productId,
    effect: state.effect,
    surface: state.surface,
    maxTilt: state.maxTilt,
    stock: state.stock,
    mounted: state.mounted,
  };
}

/** 把当前状态推给展示容器（商品 / 卡面 / 效果 / 倾角），容器与 BankCard 实例都不重建。 */
function pushToShowcase(): void {
  showcase?.update({
    product: currentProduct(),
    card: { maxTilt: state.maxTilt, surface: state.surface },
  });
}

function renderAll(): void {
  renderStatus();
  panel.render(panelState());
  // 让 Demo 页面自身的容器也跟随质感（平面风时页面级的白色卡片同样变轻）。
  document.body.dataset.bcDemoSurface = state.surface;
}

function setMounted(next: boolean): void {
  if (next === state.mounted) {
    return;
  }
  state.mounted = next;
  if (next) {
    showcase = createProductShowcase({
      product: currentProduct(),
      card: { maxTilt: state.maxTilt, surface: state.surface },
      onAction: handleAction,
    });
    showcase.mount(host);
  } else {
    showcase?.destroy();
    showcase = null;
    feedbackLine.textContent = "展示容器已 destroy（DOM 已移除、监听已释放）；点击「重新挂载」可验证重复挂载。";
  }
  renderAll();
}

const panel = createDevPanel({
  products: DEMO_PRODUCTS.map((product) => ({ id: product.id, name: product.name })),
  handlers: {
    onProduct(id: string): void {
      state.productId = id;
      state.effect = findProduct(id).effect ?? "normal";
      // 切换商品时回到该商品自带的库存状态。
      state.stock = "product-default";
      feedbackLine.textContent = `已切换到商品「${findProduct(id).name}」——切换商品复用同一个 BankCard 实例（card.update 换图与效果）。`;
      pushToShowcase();
      renderAll();
    },
    onEffect(effect: BankCardEffect): void {
      state.effect = effect;
      pushToShowcase();
      renderAll();
    },
    onSurface(surface: BankCardSurface): void {
      state.surface = surface;
      feedbackLine.textContent =
        surface === "flat"
          ? "已切换到「平面」质感：投影极轻、无霓虹边缘、透视更平 —— 更适合简洁浅色页面。"
          : "已切换到「实体」质感：保留较重的投影与边缘高光（底层默认效果）。";
      pushToShowcase();
      renderAll();
    },
    onMaxTilt(value: number): void {
      state.maxTilt = Math.min(14, Math.max(0, Math.round(value)));
      // 滑块 input 事件本身已按帧节流，直接同步应用：
      // 卡片（maxTilt 变化时内部会重建底层实例）与状态行 / 面板显示始终一致。
      pushToShowcase();
      renderAll();
    },
    onStock(choice: DemoStockChoice): void {
      state.stock = choice;
      feedbackLine.textContent =
        choice === "out-of-stock"
          ? "库存状态已模拟为「缺货」：所有操作按钮应呈现为 HTML disabled（不可点击）。"
          : `库存状态模拟：${choice}。`;
      pushToShowcase();
      renderAll();
    },
    onToggleMount(): void {
      setMounted(!state.mounted);
    },
  },
  maxTiltRange: { min: 0, max: 14, step: 1 },
});

panelHost.appendChild(panel.element);
panel.render(panelState());
setMounted(true);
renderAll();
