import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@main": resolve("src/main"),
      "@shared": resolve("src/shared"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // vitest's default is 5 s. On the owner's shared machine, with several lanes' suites running at once, tests that spawn processes
    // or build git repositories run past it, though they pass on CI's runner. A test, suite or command line that sets its own timeout
    // keeps it. A hung test now fails after 30 s instead of 5.
    testTimeout: 30_000,
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
