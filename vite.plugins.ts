import type { Plugin } from "vite";

/**
 * 构建期把底层依赖 CSS 里的**全局** `:root { … }` 自定义属性声明
 * 重定向到组件根 `.bc-card { … }`。
 *
 * 为什么需要：
 *   - 任务要求「组件不得修改 body 等全局元素的样式」。底层 `@kongyo2/cards-css`
 *     自带的样式表里有 1 处 `:root { --card-* / --pointer-* … }`（只声明自定义属性，
 *     不含视觉属性），会写入宿主根命名空间，存在与主题变量撞名的理论风险。
 *   - 我们**不修改第三方源码**：这里只在构建产物（Rollup 输出的 CSS 资源）上做一次
 *     选择器作用域收敛；依赖源码与 node_modules 保持不变。
 *   - `src/styles/bank-card.css` 已在 `.bc-card` 上完整重声明这些同名变量
 *     （测试 `样式约束 / 重新声明底层所需变量` 会断言无遗漏），
 *     因此把依赖自带的默认值放回 `.bc-card` 作用域内不会改变渲染结果。
 *
 * 只处理 CSS 资源，只匹配「行首 / 规则后」的 `:root`，不触碰 `:root ...` 后代选择器。
 */
const ROOT_RULE = /(^|[},])(\s*):root(\s*)\{/g;

export function scopeVendorRootVars(): Plugin {
  return {
    name: "bc-scope-vendor-root-vars",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "asset" || !file.fileName.endsWith(".css")) {
          continue;
        }
        const source = typeof file.source === "string" ? file.source : Buffer.from(file.source).toString("utf8");
        const next = source.replace(ROOT_RULE, "$1$2.bc-card$3{");
        if (next !== source) {
          file.source = next;
        }
      }
    },
  };
}
