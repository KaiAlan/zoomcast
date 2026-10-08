import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const { check } = createRequire(import.meta.url)("./tools/release-notes.cjs");
const { version, highlights, url } = check();

export default defineConfig({
  main: {
    define: { __ZOOMCAST_RELEASE__: JSON.stringify({ version, highlights, url }) },
    // uiohook-napi is a native addon: a .node binary cannot be bundled, so
    // dependencies stay external and are required from node_modules at runtime.
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve("src/main/index.ts") } },
    },
    resolve: { alias: { "@shared": resolve("src/shared") } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve("src/preload/index.ts") } },
    },
  },
  renderer: {
    root: resolve("src/renderer"),
    plugins: [react()],
    resolve: { alias: { "@shared": resolve("src/shared") } },
    build: {
      rollupOptions: { input: resolve("src/renderer/index.html") },
    },
  },
});
