import { defineConfig } from "vite";
import { scopeVendorRootVars } from "./vite.plugins.js";

/**
 * Demo 构建：产出静态预览站点 dist-demo/（含示例卡面占位图）。
 * 仅用于验证布局与交互，不属于交付的生产组件。
 */
export default defineConfig({
  base: "./",
  publicDir: "public",
  plugins: [scopeVendorRootVars()],
  build: {
    outDir: "dist-demo",
    emptyOutDir: true,
    target: "es2020",
  },
});
