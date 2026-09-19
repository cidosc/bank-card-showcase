import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { scopeVendorRootVars } from "./vite.plugins.js";

const here = fileURLToPath(new URL(".", import.meta.url));

/**
 * 库构建：产出可直接部署的静态资源
 *   dist/bank-card-showcase.es.js     —— ESM（现代打包器）
 *   dist/bank-card-showcase.iife.js   —— IIFE（普通 <script>，WordPress 用这个）
 *   dist/bank-card-showcase.css       —— 样式（含底层 cards-css 的 CSS，已自托管）
 */
export default defineConfig({
  // dev 与预览要能访问 public/ 下的卡面图；库构建则通过 build.copyPublicDir 关掉拷贝，
  // 保证 dist/ 只有 JS / CSS（卡面图片由接入方自托管）。
  publicDir: "public",
  plugins: [scopeVendorRootVars()],
  build: {
    copyPublicDir: false,
    target: "es2019",
    cssTarget: "chrome80",
    emptyOutDir: true,
    lib: {
      entry: resolve(here, "src/index.ts"),
      name: "BankCardShowcase",
      formats: ["es", "iife"],
      fileName: (format) => (format === "es" ? "bank-card-showcase.es.js" : "bank-card-showcase.iife.js"),
      cssFileName: "bank-card-showcase",
    },
    rollupOptions: {
      output: {
        // 单文件产物，不拆分 chunk，便于直接投放。
        inlineDynamicImports: true,
      },
    },
    minify: "esbuild",
    sourcemap: true,
  },
});
