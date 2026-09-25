import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "@shared": resolve("src/shared") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Transforms were 60-70% of every run. The cache lives in node_modules so
    // a reinstall invalidates it.
    fsModuleCache: true,
  },
});
