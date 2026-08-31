import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

import { HYBRID_SIMULATION_RESULT_MARKER } from "../../src/shared/hybrid-simulation-contracts";
import type { SoarRendererApi } from "../../src/shared/contracts";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const marker = "SOAR-E2E-PROBE-91D7";
const highRiskReviewPath = "src/main/providers/risky-provider.ts";
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
  options: {
    fakeDelayMs?: number;
    hybridSimulation?: boolean;
    fakeCloudScenario?: "success" | "provider_error";
  } = {},
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
      SOAR_ENABLE_HYBRID_SIMULATION: String(
        options.hybridSimulation ?? false,
      ),
      ...(options.fakeCloudScenario
        ? {
            SOAR_HYBRID_SIMULATION_FAKE_CLOUD_SCENARIO:
              options.fakeCloudScenario,
          }
        : {}),
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

async function createChangedReviewWorkspace(
  prefix: string,
  changedContent: string,
  relativePath = "SOAR_PROBE.txt",
): Promise<{
  testRoot: string;
  workspaceRoot: string;
  canonicalWorkspaceRoot: string;
}> {
  const testRoot = await mkdtemp(path.join(tmpdir(), prefix));
  const workspaceRoot = path.join(testRoot, "workspace");
  const probePath = path.join(workspaceRoot, relativePath);
  await mkdir(path.dirname(probePath), { recursive: true });
  const canonicalWorkspaceRoot = await realpath(workspaceRoot);
  await writeFile(probePath, "baseline\n", "utf8");
  await runGit(workspaceRoot, ["init", "--quiet", "--initial-branch=main"]);
  await runGit(workspaceRoot, ["add", "--", relativePath]);
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
  await writeFile(probePath, changedContent, "utf8");
  return { testRoot, workspaceRoot, canonicalWorkspaceRoot };
}

async function selectHybridSimulation(
  page: Page,
): Promise<void> {
  await page.getByTestId("review-current-changes").click();
  await page.getByRole("button", { name: "Choose" }).click();
  const local = page.getByRole("radio", { name: "Local" });
  const hybrid = page.getByRole("radio", { name: "Hybrid simulation" });
  await expect(local).toBeChecked();
  await expect(hybrid).toBeEnabled();
  await local.focus();
  await page.keyboard.press("ArrowDown");
  await expect(hybrid).toBeChecked();
  await expect(
    page.getByText(HYBRID_SIMULATION_RESULT_MARKER, { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Set up cloud" })).toHaveCount(0);
  const consent = page.getByRole("checkbox", {
    name: /acknowledge this challenge-bound fake simulation disclosure/u,
  });
  await expect(consent).toBeFocused();
  await expect(consent).not.toBeChecked();
  await expect(page.getByTestId("start-hybrid-simulation")).toBeDisabled();
  for (const target of [
    page.locator("label.review-mode-row").nth(0),
    page.locator("label.review-mode-row").nth(1),
    page.locator(".review-consent-row"),
    page.getByTestId("start-hybrid-simulation"),
  ]) {
    const box = await target.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(32);
  }
  await page.keyboard.press("Space");
  await expect(consent).toBeChecked();
  await expect(page.getByTestId("start-hybrid-simulation")).toBeEnabled();
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
      page.getByText(
        "Cloud setup does not enable Hybrid. Hybrid dispatch is locked in this build.",
        {
          exact: true,
        },
      ),
    ).toBeVisible();

    await page.getByRole("button", { name: "Set up cloud" }).click();
    await expect(
      page.getByRole("heading", { name: "Cloud synthesis" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Cloud synthesis" }),
    ).toBeFocused();
    await expect(page.getByText("Not configured", { exact: true })).toBeVisible();
    await expect(page.getByText("Not validated", { exact: true })).toBeVisible();
    await expect(page.getByText("Hybrid locked", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /validate/u }),
    ).toHaveCount(0);

    const syntheticCredential = "SOAR_E2E_SYNTHETIC_CLOUD_CREDENTIAL";
    const cloudCredential = page.getByLabel("OpenRouter credential");
    await cloudCredential.fill(syntheticCredential);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(cloudCredential).toHaveValue("");
    await expect(page.getByText("Stored locally", { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(syntheticCredential);

    await page.getByRole("button", { name: "Done" }).click();
    await expect(
      page.getByRole("heading", { name: "Review current changes" }),
    ).toBeVisible();
    await expect(page.getByRole("radio", { name: "Hybrid" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Set up cloud" })).toBeFocused();
    await expect(
      page.getByText(
        "Cloud setup does not enable Hybrid. Hybrid dispatch is locked in this build.",
        {
          exact: true,
        },
      ),
    ).toBeVisible();

    await page.getByRole("button", { name: "Set up cloud" }).click();
    await expect(page.getByText("Stored locally", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const removeCredential = page.getByRole("button", {
      name: "Remove credential",
    });
    await expect(removeCredential).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Keep credential" }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(removeCredential).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Not configured", { exact: true })).toBeVisible();
    await expect(page.getByLabel("OpenRouter credential")).toBeFocused();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("radio", { name: "Hybrid" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Set up cloud" })).toBeFocused();
    await expect(
      page.getByText(
        "Cloud setup does not enable Hybrid. Hybrid dispatch is locked in this build.",
        {
          exact: true,
        },
      ),
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

test("runs, copies, and replays a fully attributed Hybrid simulation without redispatch", async () => {
  const { testRoot, workspaceRoot, canonicalWorkspaceRoot } =
    await createChangedReviewWorkspace(
      "soar-hybrid-success-e2e-",
      `${marker}\n`,
      highRiskReviewPath,
    );
  let electronApp = await launchApp(testRoot, workspaceRoot, {
    hybridSimulation: true,
    fakeDelayMs: 180,
    fakeCloudScenario: "success",
  });
  try {
    let page = await electronApp.firstWindow();
    await selectHybridSimulation(page);
    await expect(page.getByText(canonicalWorkspaceRoot, { exact: true })).toBeVisible();
    await page.getByTestId("start-hybrid-simulation").click();
    await expect(page.locator('[aria-current="step"]')).toBeVisible();
    await expect(page.getByTestId("session-status")).toContainText("completed");
    await expect(
      page.getByText(HYBRID_SIMULATION_RESULT_MARKER, { exact: true }).first(),
    ).toBeVisible();
    await expect(page.locator(".session-simulation-marker")).toHaveText(
      HYBRID_SIMULATION_RESULT_MARKER,
    );
    await expect(page.locator(".review-route-sequence")).toContainText(
      "Fake Cloud",
    );
    await expect(page.locator(".review-route-sequence")).toContainText(
      "Fake Local",
    );
    await expect(
      page
        .locator(".review-simulation-cost-summary")
        .getByText("Actual external spend"),
    ).toBeVisible();
    await expect(page.getByTestId("route-cost")).toContainText("actual $0");

    await page.getByRole("button", { name: "Copy Markdown" }).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    const copied = await electronApp.evaluate(({ clipboard }) =>
      clipboard.readText(),
    );
    expect(copied).toContain(HYBRID_SIMULATION_RESULT_MARKER);
    expect(copied).toContain("Simulated");
    expect(copied).toContain("Actual external provider spend: $0");

    const beforeRestart = await page.evaluate(async () => {
      const soar = (globalThis as unknown as {
        soar: Pick<SoarRendererApi, "listSessions" | "getSession">;
      }).soar;
      const [summary] = await soar.listSessions();
      if (!summary) throw new Error("Missing Hybrid simulation session.");
      const snapshot = await soar.getSession(summary.id);
      return {
        id: summary.id,
        attemptStarts: snapshot.events.filter(
          (event) => event.type === "inference.attempt.started",
        ).length,
      };
    });

    await page.evaluate(() => {
      const renderer = globalThis as unknown as {
        document: { documentElement: { style: { zoom: string } } };
      };
      renderer.document.documentElement.style.zoom = "2";
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const renderer = globalThis as unknown as {
            document: {
              querySelector(selector: string): {
                scrollWidth: number;
                clientWidth: number;
              } | null;
            };
          };
          const workspace = renderer.document.querySelector(
            ".review-workspace",
          );
          return workspace
            ? workspace.scrollWidth <= workspace.clientWidth
            : false;
        }),
      )
      .toBe(true);

    await electronApp.close();
    electronApp = await launchApp(testRoot, workspaceRoot, {
      hybridSimulation: true,
      fakeCloudScenario: "success",
    });
    page = await electronApp.firstWindow();
    await expect(page.getByTestId("session-status")).toContainText("completed");
    await expect(page.locator(".session-simulation-marker")).toHaveText(
      HYBRID_SIMULATION_RESULT_MARKER,
    );
    await expect(page.locator(".review-route-sequence")).toContainText(
      "Fake Cloud",
    );
    const afterRestart = await page.evaluate(async (sessionId) => {
      const soar = (globalThis as unknown as {
        soar: Pick<SoarRendererApi, "getSession">;
      }).soar;
      const snapshot = await soar.getSession(sessionId);
      return snapshot.events.filter(
        (event) => event.type === "inference.attempt.started",
      ).length;
    }, beforeRestart.id);
    expect(afterRestart).toBe(beforeRestart.attemptStarts);
  } finally {
    await electronApp.close();
  }
});

test("shows egress denial with zero fake-cloud attempts and one Fake Local continuation", async () => {
  const syntheticDeniedValue = `sk-or-v1-${"D".repeat(24)}`;
  const { testRoot, workspaceRoot } = await createChangedReviewWorkspace(
    "soar-hybrid-denial-e2e-",
    `temporary fixture ${syntheticDeniedValue}\n`,
    highRiskReviewPath,
  );
  const electronApp = await launchApp(testRoot, workspaceRoot, {
    hybridSimulation: true,
    fakeCloudScenario: "success",
  });
  try {
    const page = await electronApp.firstWindow();
    await selectHybridSimulation(page);
    await page.getByTestId("start-hybrid-simulation").click();
    await expect(page.getByTestId("session-status")).toContainText("completed");
    await expect(page.locator(".review-route-sequence")).toContainText(
      "recognized_api_token",
    );
    await expect(page.locator(".review-route-sequence")).toContainText(
      "Fake Local",
    );
    await expect(page.getByTestId("route-cost")).toContainText("actual $0");
    await expect(page.locator("body")).not.toContainText(syntheticDeniedValue);
    const fakeCloudAttempts = await page.evaluate(async () => {
      const soar = (globalThis as unknown as {
        soar: Pick<SoarRendererApi, "listSessions" | "getSession">;
      }).soar;
      const [summary] = await soar.listSessions();
      if (!summary) throw new Error("Missing denied simulation session.");
      const snapshot = await soar.getSession(summary.id);
      return snapshot.events.filter((event) => {
        if (event.type !== "inference.attempt.started") return false;
        const payload = event.payload as { providerId?: unknown };
        return typeof payload.providerId === "string" &&
          payload.providerId.includes("cloud");
      }).length;
    });
    expect(fakeCloudAttempts).toBe(0);
  } finally {
    await electronApp.close();
  }
});

test("shows one failed Fake Cloud phase followed by one Fake Local fallback", async () => {
  const { testRoot, workspaceRoot } = await createChangedReviewWorkspace(
    "soar-hybrid-failure-e2e-",
    `${marker}\n`,
    highRiskReviewPath,
  );
  const electronApp = await launchApp(testRoot, workspaceRoot, {
    hybridSimulation: true,
    fakeCloudScenario: "provider_error",
  });
  try {
    const page = await electronApp.firstWindow();
    await selectHybridSimulation(page);
    await page.getByTestId("start-hybrid-simulation").click();
    await expect(page.getByTestId("session-status")).toContainText("completed");
    const route = page.locator(".review-route-sequence");
    await expect(route).toContainText("Fake Cloud");
    await expect(route).toContainText("Failed");
    await expect(
      route
        .locator("li")
        .filter({ hasText: "Fake Cloud" })
        .filter({ hasText: "Failed" }),
    ).toContainText("provider_error");
    await expect(route).toContainText("Fake Local");
    await expect(route).toContainText("Complete");
    await expect(page.getByTestId("route-cost")).toContainText("actual $0");
  } finally {
    await electronApp.close();
  }
});

test("stops a committed Fake Cloud simulation attempt without starting a Local fallback", async () => {
  const { testRoot, workspaceRoot } = await createChangedReviewWorkspace(
    "soar-hybrid-cancel-e2e-",
    `${marker}\n`,
    highRiskReviewPath,
  );
  const electronApp = await launchApp(testRoot, workspaceRoot, {
    hybridSimulation: true,
    fakeDelayMs: 1_000,
    fakeCloudScenario: "success",
  });
  try {
    const page = await electronApp.firstWindow();
    await selectHybridSimulation(page);
    await page.getByTestId("start-hybrid-simulation").click();
    await expect(page.getByTestId("session-status")).toContainText("running");
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const soar = (globalThis as unknown as {
              soar: Pick<SoarRendererApi, "listSessions" | "getSession">;
            }).soar;
            const [summary] = await soar.listSessions();
            if (!summary) return false;
            const snapshot = await soar.getSession(summary.id);
            return snapshot.events.some((event) => {
              if (event.type !== "inference.attempt.started") return false;
              const payload = event.payload as { providerId?: unknown };
              return payload.providerId === "fake-cloud-review";
            });
          }),
        { timeout: 15_000 },
      )
      .toBe(true);
    await page.getByTestId("stop-review").click();
    await expect(page.getByTestId("session-status")).toContainText("cancelled");
    await expect(page.getByText("Simulation stopped", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/No Local fallback starts after cancellation/u),
    ).toBeVisible();
    await expect(page.getByTestId("route-cost")).toContainText("actual $0");
    const cancellationProof = await page.evaluate(async () => {
      const soar = (globalThis as unknown as {
        soar: Pick<SoarRendererApi, "listSessions" | "getSession">;
      }).soar;
      const [summary] = await soar.listSessions();
      if (!summary) throw new Error("Missing cancelled simulation session.");
      const snapshot = await soar.getSession(summary.id);
      const cloudStarts = snapshot.events.filter((event) => {
        if (event.type !== "inference.attempt.started") return false;
        const payload = event.payload as {
          providerId?: unknown;
          phase?: unknown;
        };
        return (
          payload.providerId === "fake-cloud-review" &&
          payload.phase === "synthesis"
        );
      });
      const cloudAttemptId = (
        cloudStarts[0]?.payload as { attemptId?: unknown } | undefined
      )?.attemptId;
      const cloudFinishes = snapshot.events.filter((event) => {
        if (event.type !== "inference.attempt.finished") return false;
        const payload = event.payload as { attemptId?: unknown };
        return payload.attemptId === cloudAttemptId;
      });
      const cloudFinish = cloudFinishes[0]?.payload as
        | {
            outcome?: unknown;
            cost?: {
              amountMicrousd?: unknown;
              provenance?: unknown;
              costScope?: unknown;
            };
          }
        | undefined;
      const cloudDecision = snapshot.events.find((event) => {
        if (event.type !== "routing.decision.recorded") return false;
        const payload = event.payload as {
          selectedProviderId?: unknown;
          phase?: unknown;
        };
        return (
          payload.selectedProviderId === "fake-cloud-review" &&
          payload.phase === "synthesis"
        );
      })?.payload as
        | {
            billing?: { projectedCostMicrousd?: unknown };
          }
        | undefined;
      const providerFailureDecisions = snapshot.events.filter((event) => {
        if (event.type !== "routing.decision.recorded") return false;
        const payload = event.payload as { boundary?: unknown };
        return payload.boundary === "provider_failure";
      }).length;
      const localSynthesisStarts = snapshot.events.filter((event) => {
        if (event.type !== "inference.attempt.started") return false;
        const payload = event.payload as {
          providerId?: unknown;
          phase?: unknown;
        };
        return payload.providerId === "local-vllm" && payload.phase === "synthesis";
      }).length;
      return {
        cloudStarts: cloudStarts.length,
        cloudFinishes: cloudFinishes.length,
        outcome: cloudFinish?.outcome,
        settledMicrousd: cloudFinish?.cost?.amountMicrousd,
        provenance: cloudFinish?.cost?.provenance,
        costScope: cloudFinish?.cost?.costScope,
        reservedMicrousd:
          cloudDecision?.billing?.projectedCostMicrousd,
        providerFailureDecisions,
        localSynthesisStarts,
      };
    });
    expect(cancellationProof).toMatchObject({
      cloudStarts: 1,
      cloudFinishes: 1,
      outcome: "cancelled",
      provenance: "reserved_unknown",
      costScope: "simulation",
      providerFailureDecisions: 0,
      localSynthesisStarts: 0,
    });
    expect(cancellationProof.reservedMicrousd).toBeGreaterThan(0);
    expect(cancellationProof.settledMicrousd).toBe(
      cancellationProof.reservedMicrousd,
    );
  } finally {
    await electronApp.close();
  }
});
