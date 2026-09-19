import { defineConfig } from "vitest/config";

/**
 * 最小测试配置：仅用 jsdom 跑 DOM 相关单测。
 * 视觉与响应式验收由浏览器实测完成（见 README / docs/TESTING.md）。
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    globals: false,
    restoreMocks: true,
  },
});
