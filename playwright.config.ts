import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  // Retained e2e state stays in the ignored .soar/. The general-task specs refuse any other output directory
  // (fixture_requires_ignored_output_directory), and Playwright's default, test-results/, is outside it.
  outputDir: ".soar/test-results",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
