import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const marker = "SOAR-E2E-PROBE-91D7";
const execFileAsync = promisify(execFile);

async function runGit(workspaceRoot: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
}

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
      SOAR_CONTEXT_MAX_INPUT_TOKENS: "18432",
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
    page.getByText(/packet \+ .* reserved \/ 18432 token cap \/ .* evidence \/ .* omitted/u).first(),
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

test("reviews current Git changes locally and refuses a stale Markdown copy", async () => {
  const testRoot = await mkdtemp(path.join(tmpdir(), "soar-review-e2e-"));
  const workspaceRoot = path.join(testRoot, "workspace");
  const probePath = path.join(workspaceRoot, "SOAR_PROBE.txt");
  await mkdir(workspaceRoot);
  const canonicalWorkspaceRoot = await realpath(workspaceRoot);
  await writeFile(probePath, "baseline\n", "utf8");
  await runGit(workspaceRoot, ["init", "--quiet", "--initial-branch=main"]);
  await runGit(workspaceRoot, ["add", "--", "SOAR_PROBE.txt"]);
  await runGit(workspaceRoot, [
    "-c",
    "user.name=SOAR E2E",
    "-c",
    "user.email=soar-e2e@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "--quiet",
    "-m",
    "baseline",
  ]);
  await writeFile(probePath, `${marker}\n`, "utf8");

  const electronApp = await launchApp(testRoot, workspaceRoot);
  try {
    const page = await electronApp.firstWindow();
    await page.getByTestId("review-current-changes").click();
    await expect(
      page.getByRole("heading", { name: "Review current changes" }),
    ).toBeVisible();

    const localRoute = page.getByRole("radio").nth(0);
    const hybridRoute = page.getByRole("radio").nth(1);
    await expect(localRoute).toBeChecked();
    await expect(localRoute).toBeEnabled();
    await expect(hybridRoute).toBeDisabled();
    await expect(
      page.getByText("Cloud setup is not available in this build.", {
        exact: true,
      }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Choose" }).click();
    await expect(
      page.getByText(canonicalWorkspaceRoot, { exact: true }),
    ).toBeVisible();
    await page.getByTestId("start-local-review").click();

    await expect(page.getByTestId("session-status")).toContainText("completed");
    await expect(page.getByTestId("review-freshness")).toContainText(
      "Fresh and complete",
    );
    await expect(page.getByTestId("review-result")).toContainText(
      "No blocking findings found in the inspected evidence",
    );
    await expect(page.locator(".review-route-line")).toContainText(
      "RM-01 VLM (deterministic test double)",
    );
    await expect(page.locator(".review-route-line")).toContainText(
      "local-vllm · Local",
    );
    await expect(page.getByTestId("route-cost")).toHaveText("$0.00");

    const renderedText = await page.locator("body").innerText();
    expect(renderedText).not.toContain("change-review-result-v1");
    expect(renderedText).not.toContain("schemaVersion");

    const sessionId = await page.evaluate(async () => {
      const renderer = globalThis as unknown as {
        soar: {
          listSessions(): Promise<Array<{ id: string }>>;
        };
      };
      const sessions = await renderer.soar.listSessions();
      if (!sessions[0]) throw new Error("Missing review session.");
      return sessions[0].id;
    });
    const freshView = await page.evaluate(async (id) => {
      const renderer = globalThis as unknown as {
        soar: {
          getChangeReviewView(sessionId: string): Promise<{
            freshness: string;
          }>;
        };
      };
      return renderer.soar.getChangeReviewView(id);
    }, sessionId);
    expect(freshView.freshness).toBe("fresh_complete");

    await writeFile(probePath, "changed after accepted review\n", "utf8");
    const driftedView = await page.evaluate(async (id) => {
      const renderer = globalThis as unknown as {
        soar: {
          getChangeReviewView(sessionId: string): Promise<{
            freshness: string;
            reviewResult?: unknown;
            coverage?: unknown;
          }>;
        };
      };
      return renderer.soar.getChangeReviewView(id);
    }, sessionId);
    expect(driftedView.freshness).toBe("drifted");
    expect(driftedView).not.toHaveProperty("reviewResult");
    expect(driftedView).not.toHaveProperty("coverage");

    await page.getByRole("button", { name: "Copy Markdown" }).click();
    await expect(page.getByRole("button", { name: "Copy failed" })).toBeVisible();
  } finally {
    await electronApp.close();
  }
});
