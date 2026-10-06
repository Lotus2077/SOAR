import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

import type { PatchRunSnapshot, SoarPatchRunApi } from "../../src/shared/patch-run-contracts";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const fixtureRoot = path.join(projectRoot, "tests", "fixtures", "patch-pilot");
const execFileAsync = promisify(execFile);

async function git(workspace: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd: workspace,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    timeout: 15_000,
  });
  return result.stdout.trim();
}

async function makeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "soar-patch-e2e-"));
  const workspace = path.join(root, "public-calculator");
  await mkdir(workspace);
  await cp(fixtureRoot, workspace, { recursive: true });
  await git(workspace, ["init", "--quiet", "--initial-branch=main"]);
  await git(workspace, ["add", "--", "calculator.py", "tests/test_calculator.py"]);
  await git(workspace, [
    "-c", "user.name=SOAR Fixture", "-c", "user.email=fixture@example.invalid",
    "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Public addition fixture",
  ]);
  const baseRevision = await git(workspace, ["rev-parse", "HEAD"]);
  const original = `${await readFile(path.join(workspace, "calculator.py"), "utf8")}\n# Uncommitted annotation must remain in the user's checkout.\n`;
  await writeFile(path.join(workspace, "calculator.py"), original);
  return { root, workspace, original, baseRevision };
}

function runtimePython(): string {
  if (process.env.SOAR_PATCH_PYTHON) return process.env.SOAR_PATCH_PYTHON;
  const local = path.join(projectRoot, ".soar", "patch-runtime", "bin", "python");
  return existsSync(local) ? local : "/tmp/soar-patch-runtime/bin/python";
}

function launchEnvironment(root: string, workspace: string): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const name of ["HOME", "LANG", "LC_ALL", "LC_CTYPE", "LOGNAME", "PATH", "SHELL", "TMPDIR", "USER", "DISPLAY", "XAUTHORITY", "DOCKER_HOST", "DOCKER_CONTEXT"]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name]!;
  }
  return {
    ...environment,
    SOAR_PROVIDER_MODE: "fake",
    SOAR_ENABLE_HYBRID_SIMULATION: "false",
    SOAR_ENABLE_LABS: "true",
    SOAR_DB_PATH: path.join(root, "coding-e2e.sqlite"),
    SOAR_TEST_WORKSPACE: workspace,
    SOAR_VLLM_BASE_URL: "http://127.0.0.1:1/v1",
    SOAR_VLLM_MODEL: "unused-local-model",
    SOAR_VLLM_API_KEY: "",
    SOAR_VLLM_COST_POLICY: "local_zero_cost",
    SOAR_ALLOW_INSECURE_VLLM_HTTP: "false",
    SOAR_PATCH_MODE: "scripted",
    SOAR_PATCH_API_KEY: "",
    SOAR_PATCH_MODEL: "deepseek/deepseek-v4-flash-0731",
    SOAR_PATCH_INPUT_USD_PER_MILLION: "0.44",
    SOAR_PATCH_OUTPUT_USD_PER_MILLION: "1.32",
    SOAR_PATCH_PYTHON: runtimePython(),
    SOAR_PATCH_IMAGE: process.env.SOAR_PATCH_IMAGE ?? "soar-patch-python:1",
    SOAR_PATCH_TIMEOUT_SECONDS: "90",
    SOAR_PATCH_STEPS: "8",
    SOAR_PATCH_EPISODE_USD: "5",
  };
}

async function launch(root: string, workspace: string, overrides: Record<string, string> = {}): Promise<ElectronApplication> {
  return electron.launch({
    ...(process.env.SOAR_E2E_EXECUTABLE ? { executablePath: process.env.SOAR_E2E_EXECUTABLE } : {}),
    args: [
      ...(process.env.SOAR_E2E_DARK === "true" ? ["--force-dark-mode"] : []),
      `--user-data-dir=${path.join(root, "browser-data")}`,
      ...(process.env.SOAR_E2E_EXECUTABLE ? [] : [projectRoot]),
    ],
    cwd: projectRoot,
    env: { ...launchEnvironment(root, workspace), ...overrides },
  });
}

async function snapshots(page: Page) {
  return page.evaluate(async () => {
    const renderer = globalThis as unknown as { soar: SoarPatchRunApi };
    return renderer.soar.listPatchRuns();
  });
}

async function openAndStart(page: Page, visibleCommand?: string, policy?: "local_only" | "local_first" | "cloud_plan_local_review") {
  await page.getByTestId("coding-task-entry").click();
  await expect(page.getByText("Scripted test — mechanics only.", { exact: true })).toBeVisible();
  await expect(page.getByText("Ready for a coding task", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Choose repository", exact: true }).click();
  await page.getByRole("textbox", { name: "What should change?", exact: true }).fill("Fix add so it returns the sum of both numbers.");
  if (policy) {
    const label = policy === "local_only" ? "Local only Experimental" : policy === "local_first"
      ? "Local first + Cloud recovery Experimental" : "Cloud plan + Local + Cloud review Experimental";
    await page.getByRole("radio", { name: label, exact: true }).check();
  }
  if (visibleCommand) await page.getByRole("textbox", { name: "Visible test command Optional", exact: true }).fill(visibleCommand);
  const start = page.getByRole("button", { name: "Start scripted task", exact: true });
  await expect(start).toBeDisabled();
  await page.getByRole("checkbox", { name: /I confirm this repository/u }).check();
  await expect(start).toBeEnabled();
  await start.click();
}

async function assertContainerRemoved(id: string) {
  await expect.poll(async () => {
    const result = await execFileAsync("docker", ["ps", "-aq", "--filter", "label=soar.patch-worker=1", "--filter", `label=soar.run-id=${id}`], { timeout: 10_000 });
    return result.stdout.trim();
  }, { timeout: 20_000 }).toBe("");
}

test.describe("real worker coding app", () => {
  test.skip(process.env.SOAR_RUN_PATCH_E2E !== "true", "Set SOAR_RUN_PATCH_E2E=true after preparing the pinned Python runtime and Docker image; these tests run actual isolated containers.");
  test.setTimeout(120_000);

  test("shows a real tested scripted patch, exports it, and restores the owner's decision", async ({}, testInfo) => {
    const fixture = await makeFixture();
    let app: ElectronApplication | undefined;
    try {
      app = await launch(fixture.root, fixture.workspace);
      let page = await app.firstWindow();
      await openAndStart(page);
      await expect.poll(async () => {
        const [current] = await snapshots(page);
        return current && current.status !== "created" && current.status !== "running";
      }, { timeout: 45_000 }).toBe(true);
      const [result] = await snapshots(page);
      expect(result.status, result.error ?? "The scripted worker should produce a patch.").toBe("completed");
      await expect(page.getByRole("button", { name: "Keep patch", exact: true })).toBeVisible({ timeout: 45_000 });
      await expect(page.getByText(/Visible checks passed\. Independent task acceptance/u)).toBeVisible();
      await expect(page.getByLabel("Proposed diff")).toContainText("+    return a + b");
      await expect(page.getByRole("button", { name: /apply/iu })).toHaveCount(0);
      expect(result.executionMode).toBe("scripted");
      expect(result.baseRevision).toBe(fixture.baseRevision);
      expect(result.spentMicrousd).toBe(0);
      expect(result.reservedMicrousd).toBe(0);
      expect(result.checks.status).toBe("passed");
      expect(result.checks.output).toContain("Ran 3 tests");
      expect(result.events.some((event) => event.type === "tool.finished" && event.summary.includes("finished with an error"))).toBe(true);
      expect(result.patch?.text).not.toContain("Uncommitted annotation");
      expect(await readFile(path.join(fixture.workspace, "calculator.py"), "utf8")).toBe(fixture.original);
      await assertContainerRemoved(result.id);

      const exported = path.join(fixture.root, "accepted.patch");
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      }, exported);
      await page.getByRole("button", { name: "Export patch", exact: true }).click();
      await expect(page.getByText(/Patch exported/u)).toBeVisible();
      const patch = await readFile(exported, "utf8");
      expect(patch).toBe(result.patch?.text);
      expect(createHash("sha256").update(patch).digest("hex")).toBe(result.patch?.sha256);
      await page.getByRole("button", { name: "Keep patch", exact: true }).click();
      await expect(page.getByText("Patch kept", { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("coding-scripted-patch.png"), fullPage: true });
      await page.locator(".patch-workspace").evaluate((element) => { element.scrollTop = 0; });
      await page.screenshot({ path: testInfo.outputPath("coding-scripted-overview.png"), fullPage: true });

      await app.close();
      app = await launch(fixture.root, fixture.workspace);
      page = await app.firstWindow();
      await page.getByTestId("coding-task-entry").click();
      await page.getByRole("region", { name: "Coding task history" }).getByRole("button").first().click();
      await expect(page.getByText("Patch kept", { exact: true })).toBeVisible();
      await expect(page.getByText("Scripted test — mechanics only.", { exact: true })).toBeVisible();
      expect((await snapshots(page))[0].decision).toBe("keep");
      expect(await readFile(path.join(fixture.workspace, "calculator.py"), "utf8")).toBe(fixture.original);
    } finally {
      await app?.close();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("cancels a real long-running check and confirms container cleanup", async () => {
    const fixture = await makeFixture();
    let app: ElectronApplication | undefined;
    try {
      app = await launch(fixture.root, fixture.workspace);
      const page = await app.firstWindow();
      await openAndStart(page, 'python -c "import time; time.sleep(45)"');
      await expect.poll(async () => (await snapshots(page))[0]?.phase, { timeout: 45_000 }).toBe("checking");
      await page.getByRole("button", { name: "Cancel task", exact: true }).click();
      await expect.poll(async () => (await snapshots(page))[0]?.status, { timeout: 30_000 }).toBe("cancelled");
      const selected = page.getByRole("article", { name: "Selected coding task" });
      await expect(selected.getByText("Cancelled", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Cancel task", exact: true })).toHaveCount(0);
      const [result] = await snapshots(page);
      expect(result.events.some((event) => event.type === "run.cancel_requested")).toBe(true);
      expect(result.spentMicrousd).toBe(0);
      expect(result.reservedMicrousd).toBe(0);
      expect(result.patch?.kind).toBe("submitted");
      await assertContainerRemoved(result.id);
      expect(await readFile(path.join(fixture.workspace, "calculator.py"), "utf8")).toBe(fixture.original);
    } finally {
      await app?.close();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("exports and restores unfinished work when the solver reaches its step cap", async ({}, testInfo) => {
    const fixture = await makeFixture();
    let app: ElectronApplication | undefined;
    try {
      app = await launch(fixture.root, fixture.workspace, { SOAR_PATCH_STEPS: "2" });
      let page = await app.firstWindow();
      await openAndStart(page);
      await expect.poll(async () => (await snapshots(page))[0]?.status, { timeout: 45_000 }).toBe("failed");
      const [result] = await snapshots(page);
      expect(result.patch?.kind).toBe("recovered");
      expect(result.checks.status).toBe("not_run");
      expect(result.spentMicrousd).toBe(0);
      expect(result.reservedMicrousd).toBe(0);
      await expect(page.getByText("Recovered unfinished work.", { exact: true })).toBeVisible();
      await expect(page.getByText("Ready for review", { exact: true })).toHaveCount(0);
      await expect(page.getByLabel("Proposed diff")).toContainText("+    return a + b");
      await assertContainerRemoved(result.id);
      const exported = path.join(fixture.root, "unfinished.patch");
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      }, exported);
      await page.getByRole("button", { name: "Export patch", exact: true }).click();
      await expect(page.getByText(/Unfinished patch exported\. It was not submitted or checked/u)).toBeVisible();
      expect(await readFile(exported, "utf8")).toBe(result.patch?.text);
      await page.screenshot({ path: testInfo.outputPath("coding-recovered-patch.png"), fullPage: true });
      await app.close();
      app = await launch(fixture.root, fixture.workspace);
      page = await app.firstWindow();
      await page.getByTestId("coding-task-entry").click();
      await page.getByRole("region", { name: "Coding task history" }).getByRole("button").first().click();
      await expect(page.getByText("Recovered unfinished work.", { exact: true })).toBeVisible();
      const [restored] = await snapshots(page);
      expect(restored.patch).toEqual(result.patch);
      expect(restored.status).toBe("failed");
      expect(restored.checks.status).toBe("not_run");
      expect(await readFile(path.join(fixture.workspace, "calculator.py"), "utf8")).toBe(fixture.original);
    } finally {
      await app?.close();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  for (const policy of ["local_only", "local_first", "cloud_plan_local_review"] as const) {
    test(`native ${policy} shows checked work, routing evidence and the exact exported patch`, async ({}, testInfo) => {
      const fixture = await makeFixture();
      let app: ElectronApplication | undefined;
      const visibleCommand = "python -m unittest discover -s tests -v";
      const repair = "python -c \"from pathlib import Path; p=Path('calculator.py'); s=p.read_text(); assert 'return a - b' in s; p.write_text(s.replace('return a - b', 'return a + b'))\"";
      const cloudInspection = "python -c \"from calculator import add; assert add(3, 5) == 8; print('Cloud received the local addition fix.')\"";
      // The local visible tests permit diagnostic stdout. Cloud removes it, so
      // the final source must differ from the previously checked local source.
      const localRepair = policy === "cloud_plan_local_review" ? repair.replace("return a + b", "print(123456); return a + b") : repair;
      const cloudAction = policy === "cloud_plan_local_review" ? cloudInspection.replace("from calculator import add;",
        "from pathlib import Path; p=Path('calculator.py'); s=p.read_text(); assert 'print(123456); return a + b' in s; p.write_text(s.replace('print(123456); return a + b', 'return a + b')); from calculator import add;") : cloudInspection;
      const overrides = {
        // A real handoff reserves 120 seconds for a request and 60 for checking.
        // The scripted episode itself must reach its terminal receipt in 30 seconds.
        SOAR_PATCH_TIMEOUT_SECONDS: "600",
        SOAR_PATCH_STEPS: "40",
        ...(policy === "local_first" ? { SOAR_PATCH_SCRIPTED_ACTIONS_JSON: JSON.stringify([
          repair, "SOAR_REQUEST_HELP", cloudInspection, visibleCommand, "SOAR_SUBMIT",
        ]) } : policy === "cloud_plan_local_review" ? { SOAR_PATCH_SCRIPTED_ACTIONS_JSON: JSON.stringify([
          localRepair, "SOAR_SUBMIT", cloudAction, visibleCommand, "SOAR_SUBMIT",
        ]) } : {}),
      };
      try {
        app = await launch(fixture.root, fixture.workspace, overrides);
        let page = await app.firstWindow();
        await page.evaluate(() => {
          const renderer = globalThis as unknown as { soar: SoarPatchRunApi; nativePatchObservations: PatchRunSnapshot[] };
          renderer.nativePatchObservations = [];
          renderer.soar.subscribePatchRuns((snapshot) => renderer.nativePatchObservations.push(snapshot));
        });
        await openAndStart(page, visibleCommand, policy);
        await expect.poll(async () => {
          const [current] = await snapshots(page);
          return current && current.status !== "created" && current.status !== "running";
        }, { timeout: 30_000 }).toBe(true);
        const [result] = await snapshots(page);
        expect(result.status, result.error ?? "The native scripted route should finish its real isolated checks.").toBe("completed");
        expect(result.policy).toBe(policy);
        expect(result.executionMode).toBe("scripted");
        expect(result.baseRevision).toBe(fixture.baseRevision);
        expect(result.patch?.kind).toBe("submitted");
        expect(result.patch?.truncated).toBe(false);
        expect(result.patch?.text).toContain("+    return a + b");
        expect(result.patch?.text).not.toContain("Uncommitted annotation");
        expect(result.checks).toMatchObject({ status: "passed", command: visibleCommand, exitCode: 0 });
        expect(result.checks.output).toContain("Ran 3 tests");
        expect(result.checks.sourceSha256).toMatch(/^[a-f0-9]{64}$/u);
        expect(result.checks.sourceAfterSha256).toBe(result.checks.sourceSha256);
        expect(result.cleanupConfirmed).toBe(true);
        expect(result.spentMicrousd).toBe(0);
        expect(result.reservedMicrousd).toBe(0);
        expect(result.events.filter((event) => event.type === "model.scripted")).toHaveLength(policy === "cloud_plan_local_review" ? 7 : 5);
        expect(result.events.some((event) => event.type.startsWith("request."))).toBe(false);
        const observations = await page.evaluate(() =>
          (globalThis as unknown as { nativePatchObservations: PatchRunSnapshot[] }).nativePatchObservations);
        const ownObservations = observations.filter((snapshot) => snapshot.id === result.id);
        expect(ownObservations.some((snapshot) => snapshot.phase === "local_solver")).toBe(true);

        const checkpoint = page.getByRole("region", { name: "Routing checkpoint", exact: true });
        await expect(checkpoint).toBeVisible();
        await expect(page.getByRole("region", { name: "Visible checks", exact: true })).toContainText(
          "Visible checks passed. Independent task acceptance has not been established by these checks.");
        await expect(page.getByLabel("Proposed diff")).toContainText("+    return a + b");
        if (policy === "local_only") {
          expect(result.cloudRecoveryCount ?? 0).toBe(0);
          expect(result.handoff).toBeUndefined();
          expect(result.checkpoint).toMatchObject({ decision: "submit", reason: "fresh_visible_check", localCalls: 5, handoffUsed: false });
          expect(result.checkpointCheck).toMatchObject({ passed: true, fresh: true, command: visibleCommand, exitCode: 0,
            sourceSha256: result.checks.sourceSha256, sourceAfterSha256: result.checks.sourceSha256 });
          expect(ownObservations.some((snapshot) => snapshot.phase === "cloud_solver")).toBe(false);
          await expect(checkpoint).toContainText("The local model submitted after a source-bound visible check.");
          await expect(checkpoint).toContainText("Cloud recovery phases: 0 / 0.");
          const localCheck = page.getByRole("region", { name: "Latest local checkpoint check", exact: true });
          await expect(localCheck).toContainText("Exact visible check passed.");
          await expect(localCheck).toContainText("The recorded source identity still matches this check.");
        } else {
          expect(result.cloudRecoveryCount).toBe(1);
          expect(result.checkpoint).toMatchObject({ decision: "escalate", reason: "handoff_confirmed", localCalls: policy === "cloud_plan_local_review" ? 3 : 2, handoffUsed: true });
          expect(result.events.filter((event) => event.type === "handoff.ready")).toHaveLength(1);
          expect(result.events.filter((event) => event.type === "phase.changed" && event.summary === "Phase: cloud solver after one local handoff.")).toHaveLength(1);
          expect(ownObservations.some((snapshot) => snapshot.checkpoint?.reason === (policy === "cloud_plan_local_review" ? "review_required" : "explicit_help"))).toBe(true);
          if (policy === "cloud_plan_local_review") {
            const provisional = ownObservations.find((snapshot) => snapshot.checkpoint?.reason === "review_required");
            expect(provisional?.status).toBe("running");
            expect(provisional?.checkpointCheck).toMatchObject({ passed: true, fresh: true });
            expect(provisional?.patch?.kind).not.toBe("submitted");
            expect(result.cloudPlan).toBeDefined();
          }
          const preserved = ownObservations.find((snapshot) => snapshot.handoff && snapshot.patch?.kind === "recovered");
          expect(preserved?.handoff?.patchSha256).toBe(preserved?.patch?.sha256);
          expect(result.handoff?.bytes).toBe(Buffer.byteLength(preserved!.patch!.text));
          if (policy === "cloud_plan_local_review") {
            expect(preserved?.patch?.text).toContain("print(123456); return a + b");
            expect(result.patch?.text).not.toContain("print(123456)");
            expect(preserved?.patch?.sha256).not.toBe(result.patch?.sha256);
            expect(preserved?.handoff?.sourceSha256).not.toBe(result.checks.sourceSha256);
            expect(result.checkpointCheck).toMatchObject({ passed: true, fresh: false, sourceSha256: preserved?.handoff?.sourceSha256 });
            expect(ownObservations.some((snapshot) => snapshot.phase === "cloud_solver" && snapshot.checkpointCheck?.fresh === false)).toBe(true);
            await expect(page.getByRole("region", { name: "Latest local checkpoint check", exact: true })).toContainText("This check is stale for later work; a fresh check is required.");
          } else {
            expect(preserved?.patch?.text).toBe(result.patch?.text);
            expect(preserved?.handoff?.sourceSha256).toBe(result.checks.sourceSha256);
          }
          expect(ownObservations.some((snapshot) => snapshot.phase === "cloud_solver" && snapshot.events.some((event) =>
            event.type === "tool.finished" && event.summary === `Command completed: ${cloudAction}`))).toBe(true);
          await expect(checkpoint).toContainText(policy === "cloud_plan_local_review"
            ? "The required cloud review and repair phase was admitted." : "A cloud recovery phase was explicitly admitted.");
          await expect(checkpoint).toContainText(policy === "cloud_plan_local_review" ? "Cloud review and repair phases: 1 / 1." : "Cloud recovery phases: 1 / 1.");
          await page.getByText("Local work prepared for cloud", { exact: true }).click();
          await expect(page.getByText(/The handoff itself does not establish acceptance\./u)).toBeVisible();
        }
        expect(await readFile(path.join(fixture.workspace, "calculator.py"), "utf8")).toBe(fixture.original);
        await assertContainerRemoved(result.id);

        const exported = path.join(fixture.root, `${policy}.patch`);
        await app.evaluate(({ dialog }, filePath) => {
          dialog.showSaveDialog = async () => ({ canceled: false, filePath });
        }, exported);
        await page.getByRole("button", { name: "Export patch", exact: true }).click();
        await expect(page.getByText(/Patch exported/u)).toBeVisible();
        const patch = await readFile(exported, "utf8");
        expect(patch).toBe(result.patch?.text);
        expect(createHash("sha256").update(patch).digest("hex")).toBe(result.patch?.sha256);
        await page.screenshot({ path: testInfo.outputPath(`coding-${policy}-checkpoint.png`), fullPage: true });

        await app.close();
        app = await launch(fixture.root, fixture.workspace, overrides);
        page = await app.firstWindow();
        await page.getByTestId("coding-task-entry").click();
        await page.getByRole("region", { name: "Coding task history" }).getByRole("button").first().click();
        await expect(page.getByRole("region", { name: "Routing checkpoint", exact: true })).toContainText(
          policy === "local_only" ? "Cloud recovery phases: 0 / 0." : policy === "cloud_plan_local_review"
            ? "Cloud review and repair phases: 1 / 1." : "Cloud recovery phases: 1 / 1.");
        const [restored] = await snapshots(page);
        expect(restored.patch).toEqual(result.patch);
        expect(restored.checkpoint).toEqual(result.checkpoint);
        expect(restored.handoff).toEqual(result.handoff);
        expect(restored.cleanupConfirmed).toBe(true);
        expect(await readFile(path.join(fixture.workspace, "calculator.py"), "utf8")).toBe(fixture.original);
      } finally {
        await app?.close();
        await rm(fixture.root, { recursive: true, force: true });
      }
    });
  }
});
