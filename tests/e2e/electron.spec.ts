import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const marker = "SOAR-E2E-PROBE-91D7";

async function launchApp(
  testRoot: string,
  workspaceRoot: string,
  options: { fakeDelayMs?: number } = {},
): Promise<ElectronApplication> {
  const executablePath = process.env.SOAR_E2E_EXECUTABLE;
  const runtimeFlags = process.env.SOAR_E2E_DARK === "true" ? ["--force-dark-mode"] : [];
  return electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? runtimeFlags : [...runtimeFlags, projectRoot],
    cwd: projectRoot,
    env: {
      ...process.env,
      SOAR_PROVIDER_MODE: "fake",
      SOAR_FAKE_DELAY_MS: String(options.fakeDelayMs ?? 12),
      SOAR_VLLM_BASE_URL: "http://127.0.0.1:1/v1",
      SOAR_VLLM_MODEL: "RM-01 VLM",
      SOAR_ALLOW_INSECURE_VLLM_HTTP: "false",
      SOAR_DB_PATH: path.join(testRoot, "soar-e2e.sqlite"),
      SOAR_TEST_WORKSPACE: workspaceRoot,
    },
  });
}

test("runs a local tool loop and restores it after restart", async () => {
  const testRoot = await mkdtemp(path.join(tmpdir(), "soar-e2e-"));
  const workspaceRoot = path.join(testRoot, "workspace");
  await mkdir(workspaceRoot);
  await writeFile(path.join(workspaceRoot, "SOAR_PROBE.txt"), `${marker}\n`, "utf8");

  let electronApp = await launchApp(testRoot, workspaceRoot);
  let page = await electronApp.firstWindow();
  if (process.env.SOAR_E2E_DARK === "true") await page.emulateMedia({ colorScheme: "dark" });
  const initialScreenshotPath = process.env.SOAR_E2E_INITIAL_SCREENSHOT;
  if (initialScreenshotPath) await page.screenshot({ path: initialScreenshotPath, fullPage: true });
  await page.getByTestId("choose-workspace").click();
  await expect(page.getByTestId("choose-workspace")).toContainText("workspace");
  await page.getByTestId("task-input").fill("Read SOAR_PROBE.txt and return its marker.");
  await page.getByTestId("run-task").click();

  await expect(page.getByTestId("session-status")).toContainText("completed");
  await expect(page.getByTestId("session-result")).toContainText(marker);
  await expect(page.getByTestId("route-model")).toContainText("RM-01 VLM");
  await expect(page.getByTestId("route-cost")).toHaveText("$0.00");
  await expect(
    page.evaluate(() => ({
      process: typeof (globalThis as { process?: unknown }).process,
      require: typeof (globalThis as { require?: unknown }).require,
    })),
  ).resolves.toEqual({ process: "undefined", require: "undefined" });

  await page.getByRole("button", { name: "Open run details" }).click();
  await expect(page.getByRole("dialog", { name: "Run details" })).toBeVisible();
  await expect(page.getByText("Context Compiled", { exact: true })).toHaveCount(4);
  await expect(
    page.getByText(/packet \+ .* reserved \/ 16384 token cap \/ .* evidence \/ .* omitted/u).first(),
  ).toBeVisible();

  const traceScreenshotPath = process.env.SOAR_E2E_TRACE_SCREENSHOT;
  if (traceScreenshotPath) {
    await page.waitForTimeout(220);
    await expect(
      page.evaluate(() => {
        const renderer = globalThis as unknown as {
          innerWidth: number;
          document: {
            elementFromPoint: (
              x: number,
              y: number,
            ) => { closest: (selector: string) => unknown } | null;
          };
        };
        return (
          renderer.document
            .elementFromPoint(renderer.innerWidth - 8, 100)
            ?.closest(".trace-panel") !== null
        );
      }),
    ).resolves.toBe(true);
    await page.screenshot({ path: traceScreenshotPath, fullPage: true });
  }
  await page.getByRole("button", { name: "Close run details" }).click();
  await expect(page.getByRole("dialog", { name: "Run details" })).toBeHidden();
  await page.waitForTimeout(220);

  const screenshotPath = process.env.SOAR_E2E_SCREENSHOT;
  if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true });
  await electronApp.close();

  electronApp = await launchApp(testRoot, workspaceRoot);
  page = await electronApp.firstWindow();
  if (process.env.SOAR_E2E_DARK === "true") await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.getByTestId("session-status")).toContainText("completed");
  await expect(page.getByTestId("session-result")).toContainText(marker);
  await expect(page.getByTestId("route-cost")).toHaveText("$0.00");
  await electronApp.close();
});

test("cancels an active local inference through the UI", async () => {
  const testRoot = await mkdtemp(path.join(tmpdir(), "soar-cancel-e2e-"));
  const workspaceRoot = path.join(testRoot, "workspace");
  await mkdir(workspaceRoot);
  await writeFile(path.join(workspaceRoot, "SOAR_PROBE.txt"), `${marker}\n`, "utf8");

  const electronApp = await launchApp(testRoot, workspaceRoot, { fakeDelayMs: 1_000 });
  const page = await electronApp.firstWindow();
  await page.getByTestId("choose-workspace").click();
  await page.getByTestId("task-input").fill("Read the probe, then explain its marker.");
  await page.getByTestId("run-task").click();
  await expect(page.getByTestId("session-status")).toContainText("running");
  await page.getByTestId("stop-task").click();
  await expect(page.getByTestId("session-status")).toContainText("cancelled");
  await expect(page.getByText("The session context and activity trace were preserved.")).toBeVisible();
  await electronApp.close();
});
