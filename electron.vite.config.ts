import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

import { pr6rNormalModuleGraphGuard } from "./scripts/pr6r-development-build-graph-policy.mjs";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), pr6rNormalModuleGraphGuard("main")],
    build: {
      rollupOptions: {
        input: resolve("src/main/index.ts"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin(), pr6rNormalModuleGraphGuard("preload")],
    build: {
      rollupOptions: {
        input: resolve("src/preload/index.ts"),
        output: {
          format: "cjs",
          entryFileNames: "index.cjs",
        },
      },
    },
  },
  renderer: {
    root: resolve("src/renderer"),
    plugins: [react(), pr6rNormalModuleGraphGuard("renderer")],
    build: {
      rollupOptions: {
        input: resolve("src/renderer/index.html"),
      },
    },
  },
});
