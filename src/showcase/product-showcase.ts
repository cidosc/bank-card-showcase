/**
 * `createProductShowcase` —— 商品展示容器（左卡右信息；移动端上卡下信息）。
 *
 * 职责边界：
 *   - 本模块只负责「布局 + 商品信息渲染 + 按钮回调转发」，不含任何业务逻辑
 *     （无购物车 / 订单 / 支付 / 库存判定，缺货只是展示态）；
 *   - 卡面与特效完全交给 `createBankCard`（同一个 BankCard 实例在整个生命周期内复用，
 *     切换商品 / 效果只走 `card.update()`，不重建容器）；
 *   - 所有文本都经 `textContent` 写入，绝不拼接 HTML 字符串（防 XSS）。
 *
 * 样式位于 `src/styles/product-showcase.css`，选择器全部限定在
 * `.bc-showcase*` / `.bc-btn*` 内，且不依赖宿主的全局 CSS 变量。
 */

import { createBankCard } from "../bank-card/bank-card.js";
import type {
  BankCardInstance,
  BankCardOptions,
  ProductAction,
  ProductData,
  ProductShowcaseInstance,
  ProductShowcaseOptions,
  ProductStock,
} from "../types.js";

/** 库存状态的合法取值（非法值一律回退为 `in-stock`）。 */
const STOCK_STATES = ["in-stock", "low-stock", "out-of-stock"] as const;
type StockState = (typeof STOCK_STATES)[number];

/** 按钮上承载 action id 的属性名（事件委托用，避免为每个按钮单独绑定监听）。 */
const ACTION_ATTR = "data-bc-action-id";
const ACTION_SELECTOR = `button[${ACTION_ATTR}]`;

function normalizeStockState(value: unknown): StockState {
  return typeof value === "string" && (STOCK_STATES as readonly string[]).includes(value)
    ? (value as StockState)
    : "in-stock";
}

const isOutOfStock = (stock: ProductStock | undefined): boolean =>
  stock !== undefined && normalizeStockState(stock.state) === "out-of-stock";

/**
 * 商品数据里决定卡面的字段。
 * `silverImage` 显式传空串（而不是 `undefined`）：`bank-card` 会把空串视为
 * 「没有银色原图」，从而避免切换商品后残留上一个商品的银色卡面。
 */
function derivedCardOptions(product: ProductData): Partial<BankCardOptions> {
  const derived: Partial<BankCardOptions> = {
    image: product.image,
    imageAlt: product.imageAlt ?? "",
    silverImage: product.silverImage ?? "",
  };
  if (product.effect) {
    derived.effect = product.effect;
  }
  return derived;
}

/**
 * 创建商品展示容器。除 `product` 外全部可选。
 */
export function createProductShowcase(options: ProductShowcaseOptions): ProductShowcaseInstance {
  let product: ProductData = options.product;
  /** 显式覆盖项（来自 `options.card` 或 `update({ card })`），优先级高于商品数据。 */
  let cardOverrides: Partial<BankCardOptions> = { ...(options.card ?? {}) };
  let onAction = options.onAction;

  let destroyed = false;
  let appliedClassNames: string[] = [];

  const element = document.createElement("div");
  element.className = "bc-showcase";
  applyClassName(options.className);

  const media = document.createElement("div");
  media.className = "bc-showcase__media";

  const info = document.createElement("div");
  info.className = "bc-showcase__info";

  const name = document.createElement("h3");
  name.className = "bc-showcase__name";

  const desc = document.createElement("p");
  desc.className = "bc-showcase__desc";

  const price = document.createElement("div");
  price.className = "bc-showcase__price";
  const priceValue = document.createElement("span");
  priceValue.className = "bc-showcase__price-value";
  const priceCompare = document.createElement("span");
  priceCompare.className = "bc-showcase__price-compare";
  price.append(priceValue, priceCompare);

  const stock = document.createElement("div");
  stock.className = "bc-showcase__stock";

  const actions = document.createElement("div");
  actions.className = "bc-showcase__actions";
  actions.addEventListener("click", onActionsClick);

  info.append(name, desc, price, stock, actions);
  element.append(media, info);

  // `image` 是 BankCard 的必填项：`effectiveCardOptions()` 一定含该键，这里再显式兜底一次。
  const card: BankCardInstance = createBankCard({ ...effectiveCardOptions(), image: product.image });
  media.appendChild(card.element);

  function applyClassName(className: string | undefined): void {
    for (const applied of appliedClassNames) {
      element.classList.remove(applied);
    }
    appliedClassNames = [];
    if (!className) {
      return;
    }
    for (const name of className.split(/\s+/).filter(Boolean)) {
      if (name === "bc-showcase" || appliedClassNames.includes(name)) {
        continue;
      }
      element.classList.add(name);
      appliedClassNames.push(name);
    }
  }

  /** 商品数据优先，其次才是调用方的显式覆盖。 */
  function effectiveCardOptions(): Partial<BankCardOptions> {
    return { ...derivedCardOptions(product), ...cardOverrides };
  }

  function createActionButton(action: ProductAction, outOfStock: boolean): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = action.variant === "primary" ? "bc-btn bc-btn--primary" : "bc-btn bc-btn--secondary";
    button.textContent = action.label;
    button.dataset.bcActionId = action.id;
    // 缺货时全部按钮走原生 disabled（键盘、屏幕阅读器、鼠标一致不可用）。
    button.disabled = action.disabled === true || outOfStock;
    return button;
  }

  function renderActions(): void {
    const list = product.actions ?? [];
    const outOfStock = isOutOfStock(product.stock);
    const buttons = list.map((action) => createActionButton(action, outOfStock));
    actions.replaceChildren(...buttons);
    actions.hidden = buttons.length === 0;
  }

  function renderInfo(): void {
    name.textContent = product.name;

    const description = product.description ?? "";
    desc.textContent = description;
    desc.hidden = description.length === 0;

    priceValue.textContent = product.price;
    const compareAt = product.compareAtPrice ?? "";
    priceCompare.textContent = compareAt;
    priceCompare.hidden = compareAt.length === 0;

    if (product.stock) {
      stock.textContent = product.stock.label;
      stock.dataset.bcStockState = normalizeStockState(product.stock.state);
      stock.hidden = false;
    } else {
      stock.textContent = "";
      delete stock.dataset.bcStockState;
      stock.hidden = true;
    }

    renderActions();
  }

  /** 事件委托：按钮会被整批替换，只保留这一个监听，destroy 时移除。 */
  function onActionsClick(event: Event): void {
    if (destroyed) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const button = target.closest(ACTION_SELECTOR);
    if (!(button instanceof HTMLButtonElement) || button.disabled || !actions.contains(button)) {
      return;
    }
    const actionId = button.dataset.bcActionId;
    if (!actionId) {
      return;
    }
    onAction?.(actionId, product);
  }

  function mount(target: string | HTMLElement): ProductShowcaseInstance {
    if (destroyed) {
      throw new Error("[bc] createProductShowcase: cannot mount a destroyed showcase.");
    }
    const parent = typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
    if (!parent) {
      throw new Error(`[bc] createProductShowcase: mount target not found: "${String(target)}".`);
    }
    if (element.parentElement !== parent) {
      parent.appendChild(element);
    }
    return instance;
  }

  function update(
    next: Partial<Omit<ProductShowcaseOptions, "card">> & { card?: Partial<BankCardOptions> },
  ): ProductShowcaseInstance {
    if (destroyed) {
      return instance;
    }
    if (next.onAction !== undefined) {
      onAction = next.onAction;
    }
    if (next.className !== undefined) {
      applyClassName(next.className);
    }
    if (next.product) {
      // 商品数据是完整数据（冻结接口的 `product` 类型即完整 ProductData），
      // 采用替换语义：上一个商品没有显式提供的可选字段（划线价 / 银色原图 …）
      // 必须被清空，否则切换商品时会残留上一个商品的信息。
      product = next.product;
      // 商品是卡面 / 特效的权威来源：丢弃上一轮针对这些键的覆盖，
      // 使新商品的 image / imageAlt / silverImage / effect 真正生效。
      const derived = derivedCardOptions(product);
      const remaining: Partial<BankCardOptions> = { ...cardOverrides };
      for (const key of Object.keys(derived) as Array<keyof BankCardOptions>) {
        delete remaining[key];
      }
      cardOverrides = remaining;
      // 只更新信息区文本，容器与 BankCard 实例都不重建。
      renderInfo();
    }
    if (next.card) {
      cardOverrides = { ...cardOverrides, ...next.card };
    }
    card.update(effectiveCardOptions());
    return instance;
  }

  function destroy(): void {
    if (destroyed) {
      return;
    }
    destroyed = true;
    actions.removeEventListener("click", onActionsClick);
    card.destroy();
    element.remove();
  }

  renderInfo();

  const instance: ProductShowcaseInstance = {
    get element(): HTMLElement {
      return element;
    },
    get card(): BankCardInstance {
      return card;
    },
    get destroyed(): boolean {
      return destroyed;
    },
    mount,
    update,
    destroy,
  };

  return instance;
}
