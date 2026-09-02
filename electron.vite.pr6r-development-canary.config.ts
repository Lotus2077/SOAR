import { resolve } from "node:path";

import { defineConfig, externalizeDepsPlugin } from "electron-vite";

import {
  PR6R_DEVELOPMENT_CANARY_MAIN_IDENTITY,
  PR6R_DEVELOPMENT_CANARY_PRELOAD_IDENTITY,
  PR6R_DEVELOPMENT_CANARY_RENDERER_IDENTITY,
} from "./scripts/locked-credential-package-policy.mjs";
import { pr6rDevelopmentModuleGraphGuard } from "./scripts/pr6r-development-build-graph-policy.mjs";

const PR6R_DEVELOPMENT_CANARY_BANNER =
  "/* SOAR_PR6R_DEVELOPMENT_CANARY_V1 */";

/**
 * Structurally distinct, unpackaged-development build flavor for PR6R-A.
 *
 * Keep this as an explicit config and entry point. Environment variables must
 * never be able to select this graph from the normal application build.
 */
export default defineConfig({
  main: {
    plugins: [
      pr6rDevelopmentModuleGraphGuard("main", {
        artifactIdentity: PR6R_DEVELOPMENT_CANARY_MAIN_IDENTITY,
      }),
      externalizeDepsPlugin(),
    ],
    build: {
      rollupOptions: {
        input: resolve("src/main/index.pr6r-development-canary.ts"),
        output: {
          banner:
            `${PR6R_DEVELOPMENT_CANARY_BANNER}\n` +
            `/* ${PR6R_DEVELOPMENT_CANARY_MAIN_IDENTITY} */`,
          // Electron resolves the main entry from package.json in both flavors.
          // Keep the emitted path stable while the compile-time input differs.
          entryFileNames: "index.js",
        },
      },
    },
  },
  preload: {
    plugins: [
      pr6rDevelopmentModuleGraphGuard("preload", {
        artifactIdentity: PR6R_DEVELOPMENT_CANARY_PRELOAD_IDENTITY,
      }),
      externalizeDepsPlugin(),
    ],
    build: {
      rollupOptions: {
        input: resolve("src/preload/index.pr6r-development-canary.ts"),
        output: {
          format: "cjs",
          entryFileNames: "index.cjs",
          banner:
            `${PR6R_DEVELOPMENT_CANARY_BANNER}\n` +
            `/* ${PR6R_DEVELOPMENT_CANARY_PRELOAD_IDENTITY} */`,
        },
      },
    },
  },
  renderer: {
    root: resolve("src/renderer/pr6r-development-canary"),
    plugins: [
      pr6rDevelopmentModuleGraphGuard("renderer", {
        artifactIdentity: PR6R_DEVELOPMENT_CANARY_RENDERER_IDENTITY,
      }),
    ],
    build: {
      rollupOptions: {
        input: resolve("src/renderer/pr6r-development-canary/index.html"),
      },
    },
  },
});
