import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // 使用 node 环境
    environment: "node",
    // 全局变量
    globals: true,
    // 测试文件匹配模式
    include: ["src/**/*.test.ts"],
    // 覆盖率配置
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts"],
    },
  },
})
