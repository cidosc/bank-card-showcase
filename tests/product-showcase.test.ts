import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 从公开入口导入：同时验证 `src/index.ts` 冻结的导出路径。
import { createProductShowcase } from "../src/index.js";
import { createDevPanel } from "../src/demo/dev-panel.js";
import type { DemoStockChoice, DevPanelState } from "../src/demo/dev-panel.js";
import { BANK_CARD_EFFECTS } from "../src/effects.js";
import { BANK_CARD_SURFACES } from "../src/surfaces.js";
import type { ProductData, ProductShowcaseInstance } from "../src/types.js";

const IMG_COOKIE = "data:image/webp;base64,cookie";
const IMG_PANDA = "data:image/webp;base64,panda";
const IMG_PANDA_SILVER = "data:image/webp;base64,panda-silver";

/** jsdom 没有真实图片加载，这里只断言属性，不断言加载完成。 */
const cookie = (overrides: Partial<ProductData> = {}): ProductData => ({
  id: "cookie",
  name: "Cookie 曲奇卡",
  description: "暖米色曲奇主题卡面",
  price: "¥ 12.50",
  compareAtPrice: "¥ 18.00",
  stock: { label: "现货 · 库存充足", state: "in-stock" },
  image: IMG_COOKIE,
  imageAlt: "cookie 卡面",
  effect: "holographic",
  actions: [
    { id: "add-to-cart", label: "加入购物车", variant: "primary" },
    { id: "view-details", label: "查看详情" },
  ],
  ...overrides,
});

const panda = (overrides: Partial<ProductData> = {}): ProductData => ({
  id: "sad-panda",
  name: "Sad Panda 熊猫卡",
  description: "浅绿灰熊猫主题卡面",
  price: "¥ 68.00",
  stock: { label: "仅剩 3 件", state: "low-stock" },
  image: IMG_PANDA,
  imageAlt: "panda 卡面",
  silverImage: IMG_PANDA_SILVER,
  effect: "glitter",
  actions: [{ id: "notify-restock", label: "到货提醒", variant: "primary" }],
  ...overrides,
});

/** 可编程 matchMedia 替身：默认「精细指针 + 非减少动效」，并统计 change 监听数。 */
function installMatchMedia(): { listenerCount(): number; setReduced(value: boolean): void } {
  const state = { reduced: false, fine: true };
  const entries = new Set<{ query: string; listeners: Set<(event: { matches: boolean }) => void> }>();

  const makeList = (query: string): MediaQueryList => {
    const isReduced = query.includes("prefers-reduced-motion");
    const isFine = query.includes("hover: hover") && query.includes("pointer: fine");
    const entry = { query, listeners: new Set<(event: { matches: boolean }) => void>() };
    entries.add(entry);
    const fake = {
      media: query,
      get matches(): boolean {
        return isReduced ? state.reduced : isFine ? state.fine : false;
      },
      addEventListener(type: string, listener: (event: { matches: boolean }) => void): void {
        if (type === "change") {
          entry.listeners.add(listener);
        }
      },
      removeEventListener(type: string, listener: (event: { matches: boolean }) => void): void {
        if (type === "change") {
          entry.listeners.delete(listener);
        }
      },
    };
    return fake as unknown as MediaQueryList;
  };

  vi.stubGlobal("matchMedia", makeList);

  return {
    listenerCount(): number {
      let total = 0;
      for (const entry of entries) {
        total += entry.listeners.size;
      }
      return total;
    },
    setReduced(value: boolean): void {
      state.reduced = value;
      for (const entry of entries) {
        if (entry.query.includes("prefers-reduced-motion")) {
          for (const listener of [...entry.listeners]) {
            listener({ matches: value });
          }
        }
      }
    },
  };
}

const created: ProductShowcaseInstance[] = [];
function makeShowcase(
  options: Parameters<typeof createProductShowcase>[0],
): ProductShowcaseInstance {
  const showcase = createProductShowcase(options);
  created.push(showcase);
  return showcase;
}

const query = (root: HTMLElement, selector: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(selector);
  if (!found) {
    throw new Error(`expected ${selector}`);
  }
  return found;
};

const imageOf = (showcase: ProductShowcaseInstance): HTMLImageElement =>
  showcase.element.querySelector<HTMLImageElement>("img.holo-card__image") as HTMLImageElement;

const holoOf = (showcase: ProductShowcaseInstance): HTMLElement => query(showcase.element, ".holo-card");

const buttonsOf = (showcase: ProductShowcaseInstance): HTMLButtonElement[] =>
  Array.from(showcase.element.querySelectorAll<HTMLButtonElement>("button[data-bc-action-id]"));

const buttonById = (showcase: ProductShowcaseInstance, id: string): HTMLButtonElement => {
  const found = buttonsOf(showcase).find((button) => button.dataset.bcActionId === id);
  if (!found) {
    throw new Error(`expected button for action "${id}"`);
  }
  return found;
};

let media: ReturnType<typeof installMatchMedia>;

beforeEach(() => {
  media = installMatchMedia();
});

afterEach(() => {
  for (const showcase of created) {
    showcase.destroy();
  }
  created.length = 0;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("createProductShowcase 渲染", () => {
  it("渲染商品名称 / 说明 / 价格 / 划线价 / 库存，并按 SPEC 结构组织 DOM", () => {
    const product = cookie();
    const showcase = makeShowcase({ product });

    expect(showcase.element.classList.contains("bc-showcase")).toBe(true);
    expect(showcase.element.childElementCount).toBe(2);

    const media_ = query(showcase.element, ".bc-showcase__media");
    const info = query(showcase.element, ".bc-showcase__info");
    expect(showcase.element.firstElementChild).toBe(media_);
    expect(showcase.element.lastElementChild).toBe(info);
    // 卡面挂在 media 里，信息区是独立的白色卡片块。
    expect(showcase.card.element.parentElement).toBe(media_);

    expect(query(showcase.element, ".bc-showcase__name").textContent).toBe(product.name);
    expect(query(showcase.element, ".bc-showcase__desc").textContent).toBe(product.description);
    expect(query(showcase.element, ".bc-showcase__price-value").textContent).toBe(product.price);

    const compare = query(showcase.element, ".bc-showcase__price-compare");
    expect(compare.textContent).toBe(product.compareAtPrice);
    expect(compare.hidden).toBe(false);

    const stock = query(showcase.element, ".bc-showcase__stock");
    expect(stock.textContent).toBe(product.stock?.label);
    expect(stock.dataset.bcStockState).toBe("in-stock");
    expect(stock.hidden).toBe(false);
  });

  it("渲染按钮：变体类名、type=button、action id 数据属性", () => {
    const showcase = makeShowcase({ product: cookie() });
    const buttons = buttonsOf(showcase);
    expect(buttons).toHaveLength(2);

    const primary = buttonById(showcase, "add-to-cart");
    expect(primary.textContent).toBe("加入购物车");
    expect(primary.type).toBe("button");
    expect(primary.classList.contains("bc-btn")).toBe(true);
    expect(primary.classList.contains("bc-btn--primary")).toBe(true);
    expect(primary.disabled).toBe(false);

    const secondary = buttonById(showcase, "view-details");
    expect(secondary.classList.contains("bc-btn--secondary")).toBe(true);
    expect(secondary.classList.contains("bc-btn--primary")).toBe(false);
  });

  it("没有说明 / 划线价 / 库存 / 按钮时对应节点隐藏而不是残留空文本", () => {
    const showcase = makeShowcase({
      product: {
        id: "minimal",
        name: "最简商品",
        price: "¥ 1.00",
        image: IMG_COOKIE,
      },
    });

    expect(query(showcase.element, ".bc-showcase__desc").hidden).toBe(true);
    expect(query(showcase.element, ".bc-showcase__price-compare").hidden).toBe(true);
    expect(query(showcase.element, ".bc-showcase__stock").hidden).toBe(true);
    expect(query(showcase.element, ".bc-showcase__actions").hidden).toBe(true);
    expect(buttonsOf(showcase)).toHaveLength(0);
    expect(showcase.card.options.effect).toBe("normal");
  });

  it("非法 stock.state 回退为 in-stock", () => {
    const showcase = makeShowcase({
      product: cookie({ stock: { label: "未知状态", state: "nope" as unknown as "in-stock" } }),
    });
    expect(query(showcase.element, ".bc-showcase__stock").dataset.bcStockState).toBe("in-stock");
  });
});

describe("按钮回调 onAction", () => {
  it("点击按钮回传正确的 action id 与商品数据", () => {
    const product = cookie();
    const calls: Array<[string, ProductData]> = [];
    const showcase = makeShowcase({ product, onAction: (id, data) => calls.push([id, data]) });
    showcase.mount(document.body);

    buttonById(showcase, "add-to-cart").click();
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("add-to-cart");
    expect(calls[0][1].id).toBe("cookie");

    buttonById(showcase, "view-details").click();
    expect(calls.map(([id]) => id)).toEqual(["add-to-cart", "view-details"]);
  });

  it("没有 onAction 时点击不抛错；update 可替换回调", () => {
    const first: string[] = [];
    const second: string[] = [];
    const showcase = makeShowcase({ product: cookie(), onAction: (id) => first.push(id) });

    buttonById(showcase, "add-to-cart").click();
    expect(first).toEqual(["add-to-cart"]);

    showcase.update({ onAction: (id) => second.push(id) });
    buttonById(showcase, "add-to-cart").click();
    expect(first).toEqual(["add-to-cart"]);
    expect(second).toEqual(["add-to-cart"]);

    showcase.update({ onAction: undefined });
    expect(() => buttonById(showcase, "add-to-cart").click()).not.toThrow();
  });
});

describe("缺货禁用态", () => {
  it("stock.state === out-of-stock 时全部按钮为 HTML disabled 且点击不触发回调", () => {
    const calls: string[] = [];
    const showcase = makeShowcase({
      product: cookie({ stock: { label: "暂时缺货", state: "out-of-stock" } }),
      onAction: (id) => calls.push(id),
    });

    expect(query(showcase.element, ".bc-showcase__stock").dataset.bcStockState).toBe("out-of-stock");
    const buttons = buttonsOf(showcase);
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.disabled).toBe(true);
      expect(button.hasAttribute("disabled")).toBe(true);
      button.click();
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }
    expect(calls).toEqual([]);
  });

  it("action.disabled 只禁用该按钮；库存恢复后按钮重新可用", () => {
    const actions = [
      { id: "add-to-cart", label: "加入购物车", variant: "primary" as const },
      { id: "preorder", label: "预售", disabled: true },
    ];
    const showcase = makeShowcase({ product: cookie({ actions }) });

    expect(buttonById(showcase, "add-to-cart").disabled).toBe(false);
    expect(buttonById(showcase, "preorder").disabled).toBe(true);

    showcase.update({ product: cookie({ actions, stock: { label: "暂时缺货", state: "out-of-stock" } }) });
    expect(buttonsOf(showcase).every((button) => button.disabled)).toBe(true);

    showcase.update({ product: cookie({ actions, stock: { label: "现货", state: "in-stock" } }) });
    expect(buttonById(showcase, "add-to-cart").disabled).toBe(false);
    expect(buttonById(showcase, "preorder").disabled).toBe(true);
  });
});

describe("update 切换商品 / 卡面 / 效果", () => {
  it("切换商品只更新文本与 img.src，不重建容器，也不换 BankCard 实例", () => {
    const showcase = makeShowcase({ product: cookie() });
    const root = showcase.element;
    const card = showcase.card;
    const holo = holoOf(showcase);
    expect(imageOf(showcase).getAttribute("src")).toBe(IMG_COOKIE);

    showcase.update({ product: panda() });

    expect(showcase.element).toBe(root);
    expect(showcase.card).toBe(card);
    expect(holoOf(showcase)).toBe(holo);
    expect(root.childElementCount).toBe(2);

    expect(query(root, ".bc-showcase__name").textContent).toBe("Sad Panda 熊猫卡");
    expect(query(root, ".bc-showcase__price-value").textContent).toBe("¥ 68.00");
    expect(query(root, ".bc-showcase__desc").textContent).toBe("浅绿灰熊猫主题卡面");
    expect(query(root, ".bc-showcase__price-compare").hidden).toBe(true);
    expect(query(root, ".bc-showcase__stock").textContent).toBe("仅剩 3 件");
    expect(query(root, ".bc-showcase__stock").dataset.bcStockState).toBe("low-stock");

    // 卡面 / 效果来自商品数据，经 card.update 应用（不重建实例）。
    expect(imageOf(showcase).getAttribute("src")).toBe(IMG_PANDA);
    expect(imageOf(showcase).alt).toBe("panda 卡面");
    expect(card.options.effect).toBe("glitter");
    expect(holo.dataset.effect).toBe("glitter");
    expect(holoOf(showcase).classList.contains("holo-card--interactive")).toBe(true);

    // 按钮整批替换为新商品的按钮。
    expect(buttonsOf(showcase)).toHaveLength(1);
    expect(buttonsOf(showcase)[0].dataset.bcActionId).toBe("notify-restock");
  });

  it("silver 效果使用商品自带的银色原图；换商品后不会残留", () => {
    const showcase = makeShowcase({ product: cookie(), card: { effect: "silver" } });
    // 商品 A 没有 silverImage：silver 效果下仍用原图（不误用别的商品图）。
    expect(imageOf(showcase).getAttribute("src")).toBe(IMG_COOKIE);

    showcase.update({ product: panda() });
    expect(imageOf(showcase).getAttribute("src")).toBe(IMG_PANDA);

    showcase.update({ card: { effect: "silver" } });
    expect(imageOf(showcase).getAttribute("src")).toBe(IMG_PANDA_SILVER);
    expect(holoOf(showcase).dataset.effect).toBe("metal");

    // 切回没有银色原图的商品：必须回到商品原图（清掉残留的 silverImage）。
    showcase.update({ product: cookie({ effect: "silver" }) });
    expect(imageOf(showcase).getAttribute("src")).toBe(IMG_COOKIE);
  });

  it("update({ card }) 可覆盖卡面参数与效果，且不改变商品文本", () => {
    const showcase = makeShowcase({ product: cookie(), card: { maxTilt: 4 } });
    expect(showcase.card.options.maxTilt).toBe(4);

    showcase.update({ card: { maxTilt: 12, effect: "silver" } });
    expect(showcase.card.options.maxTilt).toBe(12);
    expect(showcase.card.options.effect).toBe("silver");
    expect(query(showcase.element, ".bc-showcase__name").textContent).toBe("Cookie 曲奇卡");

    // 商品数据仍是卡面 / 效果的默认来源：换商品后回到商品自带效果。
    showcase.update({ product: panda() });
    expect(showcase.card.options.effect).toBe("glitter");
    // 但显式覆盖过的 maxTilt 保留。
    expect(showcase.card.options.maxTilt).toBe(12);
  });

  it("update({}) 与 destroy 之后 update 都是安全的空操作", () => {
    const showcase = makeShowcase({ product: cookie() });
    const image = imageOf(showcase).getAttribute("src");

    expect(() => showcase.update({})).not.toThrow();
    expect(imageOf(showcase).getAttribute("src")).toBe(image);

    showcase.destroy();
    expect(() => showcase.update({ product: panda() })).not.toThrow();
    expect(query(showcase.element, ".bc-showcase__name").textContent).toBe("Cookie 曲奇卡");
  });
});

describe("mount / destroy 生命周期", () => {
  it("支持选择器与元素挂载，重复挂载只移动不复制", () => {
    const host = document.createElement("div");
    const second = document.createElement("div");
    host.id = "bc-demo-host";
    document.body.append(host, second);

    const showcase = makeShowcase({ product: cookie() });
    showcase.mount("#bc-demo-host");
    expect(host.childElementCount).toBe(1);
    expect(host.firstElementChild).toBe(showcase.element);

    showcase.mount(host);
    showcase.mount(host);
    expect(host.childElementCount).toBe(1);

    showcase.mount(second);
    expect(host.childElementCount).toBe(0);
    expect(second.childElementCount).toBe(1);
  });

  it("选择器找不到时抛出明确错误", () => {
    const showcase = makeShowcase({ product: cookie() });
    expect(() => showcase.mount("#bc-not-here")).toThrow(/mount target not found/);
  });

  it("destroy 幂等、移除 DOM、销毁内部 BankCard 并注销 matchMedia 监听", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const showcase = makeShowcase({ product: cookie(), onAction: () => undefined });
    showcase.mount(host);
    expect(media.listenerCount()).toBe(1);

    showcase.destroy();
    expect(showcase.destroyed).toBe(true);
    expect(showcase.card.destroyed).toBe(true);
    expect(host.contains(showcase.element)).toBe(false);
    expect(document.body.contains(showcase.element)).toBe(false);
    expect(media.listenerCount()).toBe(0);

    // 幂等：第二次 destroy 不抛错，状态不变。
    expect(() => showcase.destroy()).not.toThrow();
    expect(showcase.destroyed).toBe(true);
  });

  it("destroy 会移除按钮监听（监听平衡），旧按钮不再触发回调；重新创建可再次挂载", () => {
    const calls: string[] = [];
    const first = makeShowcase({ product: cookie(), onAction: (id) => calls.push(id) });
    first.mount(document.body);
    const oldButton = buttonById(first, "add-to-cart");

    // 诊断性取证：按钮回调是委托在 .bc-showcase__actions 上的，
    // 因此这里盯住容器的 removeEventListener（只看 destroyed 守卫会漏掉监听泄漏）。
    const actions = first.element.querySelector<HTMLElement>(".bc-showcase__actions");
    if (!actions) {
      throw new Error("未找到 .bc-showcase__actions 容器，无法验证监听移除");
    }
    const removedTypes: string[] = [];
    const originalRemove = actions.removeEventListener.bind(actions);
    actions.removeEventListener = ((type: string, ...rest: unknown[]) => {
      removedTypes.push(type);
      (originalRemove as (...args: unknown[]) => void)(type, ...rest);
    }) as typeof actions.removeEventListener;

    first.destroy();
    expect(removedTypes).toContain("click");

    oldButton.click();
    oldButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(calls).toEqual([]);

    const second = makeShowcase({ product: cookie(), onAction: (id) => calls.push(id) });
    second.mount(document.body);
    expect(document.body.querySelectorAll(".bc-showcase")).toHaveLength(1);
    buttonById(second, "add-to-cart").click();
    expect(calls).toEqual(["add-to-cart"]);
  });

  it("destroy 后 mount 抛出明确错误", () => {
    const showcase = makeShowcase({ product: cookie() });
    showcase.destroy();
    expect(() => showcase.mount(document.body)).toThrow(/cannot mount a destroyed showcase/);
  });
});

describe("样式约束（src/styles/product-showcase.css）", () => {
  const nodeFs = process.getBuiltinModule("fs");
  const rawCss = nodeFs.readFileSync(`${process.cwd()}/src/styles/product-showcase.css`, "utf8");
  const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, "");

  /** 抽出所有选择器（跳过 @media / @supports 等 at-rule 前置条件）。 */
  const selectors = [...css.matchAll(/(?:^|[}{;])\s*([^{}]+?)\s*\{/g)]
    .map((match) => match[1].trim())
    .filter((selectorText) => !selectorText.startsWith("@"))
    .flatMap((selectorText) => selectorText.split(","))
    .map((selector) => selector.trim())
    .filter((selector) => selector.length > 0);

  it("不包含任何全局选择器", () => {
    expect(css).not.toMatch(/(^|[},])\s*:root/);
    expect(css).not.toMatch(/(^|[},])\s*html\b/);
    expect(css).not.toMatch(/(^|[},])\s*body\b/);
    expect(css).not.toMatch(/(^|[},])\s*\*/);
  });

  it("每个选择器都限定在 .bc-showcase* / .bc-btn* 命名空间内", () => {
    expect(selectors.length).toBeGreaterThan(10);
    const offenders = selectors.filter((selector) => !/^\.bc-(showcase|btn)/.test(selector));
    expect(offenders).toEqual([]);
  });

  it("不引用在线 CDN / 在线字体，使用系统字体栈", () => {
    expect(css).not.toMatch(/https?:\/\//);
    expect(css).not.toMatch(/@import/);
    expect(css).toContain('system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif');
  });

  it("包含布局 / 响应式 / 可访问性的关键声明", () => {
    expect(css).toContain("grid-template-columns");
    expect(css).toContain("max-width: min(100%, 520px)");
    expect(css).toContain("@media (max-width: 720px)");
    expect(css).toContain("font-size: 16px");
    expect(css).toContain("line-height: 1.5");
    expect(css).toContain("min-height: 44px");
    expect(css).toContain(".bc-btn:focus-visible");
    expect(css).toContain("outline: 2px solid");
    expect(css).toContain(".bc-btn:disabled");
    expect(css).toContain("prefers-reduced-motion");
  });

  it("不在组件样式里读取 demo 专属令牌（组件可独立投放）", () => {
    expect(css).not.toContain("--bc-demo");
  });
});

describe("Demo 开发控件面板（src/demo/dev-panel）", () => {
  const setup = (): {
    panel: ReturnType<typeof createDevPanel>;
    handlers: {
      onProduct: ReturnType<typeof vi.fn>;
      onEffect: ReturnType<typeof vi.fn>;
      onSurface: ReturnType<typeof vi.fn>;
      onMaxTilt: ReturnType<typeof vi.fn>;
      onStock: ReturnType<typeof vi.fn>;
      onToggleMount: ReturnType<typeof vi.fn>;
    };
  } => {
    const handlers = {
      onProduct: vi.fn(),
      onEffect: vi.fn(),
      onSurface: vi.fn(),
      onMaxTilt: vi.fn(),
      onStock: vi.fn(),
      onToggleMount: vi.fn(),
    };
    const panel = createDevPanel({
      products: [
        { id: "cookie", name: "Cookie 曲奇卡" },
        { id: "sad-panda", name: "Sad Panda 熊猫卡" },
      ],
      handlers,
      maxTiltRange: { min: 0, max: 14, step: 1 },
    });
    document.body.appendChild(panel.element);
    return { panel, handlers };
  };

  const state = (overrides: Partial<DevPanelState> = {}): DevPanelState => ({
    productId: "cookie",
    effect: "holographic",
    surface: "flat",
    maxTilt: 7,
    stock: "product-default" as DemoStockChoice,
    mounted: true,
    ...overrides,
  });

  it("倾角滑块 input 时立即同步显示值与 aria-valuetext（回归：曾停留在旧值）", () => {
    const { panel, handlers } = setup();
    const input = panel.element.querySelector<HTMLInputElement>("input[type='range']") as HTMLInputElement;
    const output = panel.element.querySelector<HTMLOutputElement>("output") as HTMLOutputElement;

    input.value = "14";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(handlers.onMaxTilt).toHaveBeenCalledTimes(1);
    expect(handlers.onMaxTilt).toHaveBeenCalledWith(14);
    expect(output.textContent).toBe("14°");
    expect(input.getAttribute("aria-valuetext")).toBe("14°");
    expect(input.min).toBe("0");
    expect(input.max).toBe("14");
    expect(input.step).toBe("1");
  });

  it("效果选项由 BANK_CARD_EFFECTS 渲染，点击回传对应效果", () => {
    const { panel, handlers } = setup();
    const group = [...panel.element.querySelectorAll<HTMLElement>(".bc-demo__group")].find(
      (item) => item.querySelector(".bc-demo__group-label")?.textContent?.includes("效果切换"),
    );
    const buttons = [...(group?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    expect(buttons.map((button) => button.textContent)).toEqual([...BANK_CARD_EFFECTS]);

    const silver = buttons.find((button) => button.textContent === "silver") as HTMLButtonElement;
    silver.click();
    expect(handlers.onEffect).toHaveBeenCalledWith("silver");
  });

  it("质感选项由 BANK_CARD_SURFACES 渲染，点击回传对应质感", () => {
    const { panel, handlers } = setup();
    const group = [...panel.element.querySelectorAll<HTMLElement>(".bc-demo__group")].find((item) =>
      item.querySelector(".bc-demo__group-label")?.textContent?.includes("卡面质感"),
    );
    const buttons = [...(group?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    expect(buttons.map((button) => button.textContent)).toEqual([...BANK_CARD_SURFACES]);

    const physical = buttons.find((button) => button.textContent === "physical") as HTMLButtonElement;
    physical.click();
    expect(handlers.onSurface).toHaveBeenCalledWith("physical");
  });

  it("render(state) 反显商品 / 效果 / 质感 / 库存 / 倾角 / 挂载状态", () => {
    const { panel } = setup();
    panel.render(state());
    expect(panel.element.dataset.bcDemoMounted).toBe("true");

    panel.render(
      state({
        maxTilt: 3,
        effect: "silver",
        surface: "physical",
        productId: "sad-panda",
        stock: "out-of-stock",
        mounted: false,
      }),
    );

    const input = panel.element.querySelector<HTMLInputElement>("input[type='range']") as HTMLInputElement;
    expect(input.value).toBe("3");
    expect(input.getAttribute("aria-valuetext")).toBe("3°");
    expect(panel.element.dataset.bcDemoMounted).toBe("false");

    const pressed = [...panel.element.querySelectorAll<HTMLButtonElement>("button[aria-pressed='true']")].map(
      (button) => button.textContent,
    );
    expect(pressed).toContain("Sad Panda 熊猫卡");
    expect(pressed).toContain("silver");
    expect(pressed).toContain("physical");
    expect(pressed).toContain("缺货");
    expect(pressed).not.toContain("Cookie 曲奇卡");

    const mountButton = panel.element.querySelector<HTMLButtonElement>("button[data-bc-demo-mount]") as HTMLButtonElement;
    expect(mountButton.textContent).toBe("重新挂载（mount）");
  });

  it("声明「不属于生产组件」并暴露 6 组演示控件", () => {
    const { panel } = setup();
    expect(panel.element.querySelector(".bc-demo__panel-note")?.textContent).toContain("不属于生产组件");
    const labels = [...panel.element.querySelectorAll(".bc-demo__group-label")].map((label) => label.textContent);
    expect(labels).toHaveLength(6);
    expect(labels.join("|")).toContain("商品切换");
    expect(labels.join("|")).toContain("效果切换");
    expect(labels.join("|")).toContain("卡面质感");
    expect(labels.join("|")).toContain("最大倾角");
    expect(labels.join("|")).toContain("生命周期");
  });
});
