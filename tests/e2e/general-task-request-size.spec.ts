import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import type { GeneralTaskSnapshot, SoarGeneralTaskApi } from "../../src/shared/general-task-contracts";
import { generalTaskRuntimeIdentity } from "../../src/main/general-task-runtime";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import type { WorkspaceSnapshot } from "../../src/main/private-agent/checkpoints";
import type { DispatchReceipt, PrivateRunClaim } from "../../src/main/private-agent/store";
import { DockerSandbox } from "../../src/main/private-agent/sandbox";
import { generalTaskModelFixture } from "../helpers/general-task-model-fixture";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const imageId = process.env.SOAR_GENERAL_TASK_IMAGE_ID ?? "";
const exec = promisify(execFile);
const input = "Public synthetic request-size fixture. Café and 你好.\n";
const output = "# Retained progress\n\nThis tiny synthetic artifact survived an unsent model request.\n";
const goal = "Preserve the selected synthetic input and write report.md. This fixture exercises a host request-size stop, not artifact acceptance.";
const assistantContentBytes = 210 * 1024;
const toolStdout = "Saved progress.\n";
const bodyLimit = 192 * 1024;
// The standard profile keeps the 192 KiB cap this fixture exceeds; the heavy profile would admit it.
const sizeReason = "The next model request exceeded the request size limit and was not sent. Saved progress is retained; this task cannot resume.";
const python = (source: string) => `python3 -c '${source.replaceAll("'", "'\\''")}'`;
const command = python(`from pathlib import Path; import base64,hashlib,sys; assert hashlib.sha256(Path("input/01-source.txt").read_bytes()).hexdigest()=="${digest(input)}"; Path("output").mkdir(exist_ok=True); Path("output/report.md").write_bytes(base64.b64decode("${Buffer.from(output).toString("base64")}")); sys.stdout.write(${JSON.stringify(toolStdout)}); sys.stdout.flush()`);
type Event = Record<string, unknown>;

function environment(root: string, origin: string): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const name of ["HOME", "LANG", "LC_ALL", "LC_CTYPE", "LOGNAME", "PATH", "SHELL", "TMPDIR", "USER", "DISPLAY", "XAUTHORITY", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"]) {
    if (process.env[name] !== undefined) inherited[name] = process.env[name]!;
  }
  return { ...inherited, SOAR_PROVIDER_MODE: "local", SOAR_ENABLE_HYBRID_SIMULATION: "false",
    SOAR_DB_PATH: path.join(root, "desktop.sqlite"), SOAR_VLLM_BASE_URL: `${origin}/v1`,
    SOAR_VLLM_MODEL: "synthetic-general-tools", SOAR_VLLM_API_KEY: "", SOAR_VLLM_COST_POLICY: "local_zero_cost",
    SOAR_ALLOW_INSECURE_VLLM_HTTP: "true", SOAR_MAX_OUTPUT_TOKENS: "4096", SOAR_REQUEST_TIMEOUT_MS: "30000", SOAR_GENERAL_TASK_PROFILE: "standard",
    SOAR_GENERAL_TASK_IMAGE_ID: imageId, SOAR_PATCH_MODE: "scripted", SOAR_PATCH_API_KEY: "", SOAR_PATCH_LOCAL_API_KEY: "",
    SOAR_TEST_WORKSPACE: "" };
}
async function bounded<T>(promise: Promise<T>, ms: number, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(code)), ms); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function first(page: Page): Promise<GeneralTaskSnapshot> {
  const rows = await page.evaluate(() => (globalThis as unknown as { soar: SoarGeneralTaskApi }).soar.listGeneralTasks());
  expect(rows).toHaveLength(1); return rows[0]!;
}
function ledger(root: string, id: string) {
  // Driver-process Node SQLite, not an import inside Electron's VM; no writes.
  const db = new Database(path.join(root, "desktop.sqlite"), { readonly: true, fileMustExist: true, timeout: 5000 });
  try {
    return db.transaction(() => {
      const read = (sql: string) => (db.prepare(sql).all(id) as { value: string }[]).map(row => JSON.parse(row.value));
      return { dispatches: read("SELECT value FROM private_agent_dispatches WHERE job_id=? ORDER BY rowid") as DispatchReceipt[],
        events: read("SELECT value FROM private_agent_events WHERE job_id=? ORDER BY sequence") as Event[],
        claims: read("SELECT r.value FROM private_agent_run_claims r JOIN private_agent_contexts c ON c.id=r.context_id WHERE c.job_id=?") as PrivateRunClaim[],
        record: read("SELECT value FROM general_tasks WHERE id=?")[0] as Event };
    }).deferred();
  } finally { db.close(); }
}
async function noContainer(id: string, claims: PrivateRunClaim[]) {
  expect(id).toMatch(/^[a-f0-9-]{36}$/u);
  const endpoints = [...new Set(claims.length ? claims.map(row => row.endpoint) : [await DockerSandbox.currentEndpoint()])];
  for (const endpoint of endpoints) {
    expect(endpoint).toMatch(/^unix:\/\/\/[^\x00-\x20\x7f]+$/u);
    await expect.poll(async () => (await exec("docker", ["--host", endpoint, "container", "ls", "--all", "--quiet",
      "--filter", "label=soar.private-sandbox-id", "--filter", `label=soar.private-job-id=${id}`], { timeout: 10000 })).stdout.trim(), { timeout: 20000 }).toBe("");
  }
}
async function stoppedUi(page: Page): Promise<GeneralTaskSnapshot> {
  const article = page.getByRole("article", { name: "Selected general task" });
  await expect(article.getByText("Incomplete", { exact: true })).toBeVisible({ timeout: 60000 });
  await expect.poll(async () => (await first(page)).cleanupConfirmed, { timeout: 30000 }).toBe(true);
  const task = await first(page);
  expect(task).toMatchObject({ goal, outputName: "report.md", status: "incomplete", reason: sizeReason,
    modelCalls: 2, toolCalls: 1, canResume: false, cleanupConfirmed: true, checks: [],
    independentAcceptance: "not_evaluated", routing: "local_only" });
  if (task.fees !== undefined) expect(task.fees).toEqual({ settledMicrousd: 0, reservedMicrousd: 0 });
  expect(task.artifacts).toEqual([{ path: "output/report.md", bytes: Buffer.byteLength(output), sha256: digest(output) }]);
  await expect(article.getByText(sizeReason, { exact: true })).toBeVisible();
  await expect(article.locator(".general-metrics > div").filter({ has: page.getByText("Model attempts", { exact: true }) }).locator("dd")).toHaveText("2");
  await expect(page.getByRole("button", { name: "Resume task", exact: true })).toHaveCount(0);
  expect(task.reason).not.toMatch(/uncertain|unknown/iu);
  expect(task.events.filter(event => event.type === "model_request_not_dispatched")).toHaveLength(1);
  return task;
}
async function audit(root: string, task: GeneralTaskSnapshot, origin: string, request: Record<string, unknown>) {
  const value = ledger(root, task.id);
  const events = (type: string) => value.events.filter(event => event.type === type);
  const starts = events("model_started"), responses = events("model_finished"), markers = events("model_request_not_dispatched");
  expect(starts).toHaveLength(2); expect(responses).toHaveLength(1); expect(markers).toHaveLength(1);
  expect(responses[0]!.operationId).toBe(starts[0]!.operationId);
  expect((responses[0]!.message as { content: string }).content).toBe("X".repeat(assistantContentBytes));
  const marker = markers[0]!;
  expect(marker).toEqual({ type: "model_request_not_dispatched", operationId: starts[1]!.operationId,
    contextId: starts[1]!.contextId, promptProtocolSha256: starts[1]!.promptProtocolSha256,
    reason: "request_body_size_exceeded", dispatched: false, bodyBytes: expect.any(Number), limitBytes: bodyLimit });
  expect(Number.isSafeInteger(marker.bodyBytes)).toBe(true); expect(Number(marker.bodyBytes)).toBeGreaterThan(assistantContentBytes);
  expect(value.events.indexOf(marker)).toBeGreaterThan(value.events.indexOf(starts[1]!));
  expect(events("tool_started")).toHaveLength(1); expect(events("tool_finished")).toHaveLength(1);
  const tool = events("tool_finished")[0]!;
  expect(tool).toMatchObject({ operationId: events("tool_started")[0]!.operationId, toolCallId: "desktop-action-1" });
  const observed = JSON.parse(String(tool.output));
  expect(observed).toMatchObject({ exitCode: 0, stdout: toolStdout, stderr: "" });
  expect(Buffer.byteLength(observed.stdout)).toBeLessThan(256 * 1024);
  expect(value.events.indexOf(tool)).toBeLessThan(value.events.indexOf(starts[1]!));
  expect(events("completed")).toEqual([]); expect(events("host_validation_started")).toEqual([]);
  expect(events("session_started")).toHaveLength(1); expect(events("run_ended")).toHaveLength(1);
  expect(events("run_ended")[0]).toMatchObject({ cleanupConfirmed: true });
  expect(value.dispatches).toHaveLength(1);
  expect(value.dispatches[0]).toMatchObject({ jobId: task.id, contextId: starts[0]!.contextId, status: "settled",
    purpose: "agent reasoning and tool selection", feeMicrousd: 0, reservedFeeMicrousd: 0,
    packetSha256: digest(canonical({ method: "POST", url: `${origin}/v1/chat/completions`, headers: { "content-type": "application/json" }, body: canonical(request) })) });
  expect(value.dispatches[0]!.responseSha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(value.dispatches[0]).not.toHaveProperty("failure");
  expect(value.claims).toHaveLength(1); expect(value.claims[0]!.state).toBe("released");
  expect(value.record).toMatchObject({ id: task.id, goal, outputName: "report.md", status: "incomplete", reason: "request_body_size_exceeded",
    inputSnapshot: [{ path: "input/01-source.txt", bytes: Buffer.byteLength(input), sha256: digest(input) }] });
  const checkpoint = events("checkpoint").at(-1)!;
  const snapshot = checkpoint.snapshot as WorkspaceSnapshot;
  expect(digest(canonical(snapshot))).toBe(checkpoint.sha256);
  for (const [relative, bytes] of [["input/01-source.txt", input], ["output/report.md", output]]) {
    expect(snapshot.find(file => file.path === relative)).toEqual({ path: relative, bytes: Buffer.byteLength(bytes!), sha256: digest(bytes!) });
    expect(await readFile(path.join(root, "general-tasks", "checkpoints", task.id, digest(bytes!)), "utf8")).toBe(bytes);
  }
  await noContainer(task.id, value.claims); return value;
}
async function exportArtifact(app: ElectronApplication, page: Page, root: string, name: string) {
  await page.getByRole("button", { name: "Preview output/report.md", exact: true }).click();
  await expect(page.getByRole("region", { name: "Artifact preview", exact: true })).toContainText("This tiny synthetic artifact survived an unsent model request.");
  const destination = path.join(root, name);
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, destination);
  await page.getByRole("button", { name: "Export output/report.md", exact: true }).click();
  await expect(page.getByText("Artifact exported.", { exact: true })).toBeVisible();
  const bytes = await readFile(destination); expect(bytes.toString("utf8")).toBe(output); return digest(bytes);
}

test.describe("desktop proven unsent model request", () => {
  test.skip(process.env.SOAR_RUN_GENERAL_TASK_E2E !== "true", "Requires separately admitted frozen app execution; localhost scripted responses only, no inference.");
  test.skip(!/^sha256:[a-f0-9]{64}$/u.test(imageId), "Supply the installed immutable offline image; this fixture never pulls an image.");
  test.setTimeout(240000);

  test("retains an oversized-request stop and its export across restart without dispatch or replay", async ({}, testInfo) => {
    // Raw synthetic ledgers/screenshots belong only to ignored evidence directories.
    const relative = path.relative(path.join(projectRoot, ".soar"), testInfo.outputDir);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("fixture_requires_ignored_output_directory");
    const runtimeSha256 = generalTaskRuntimeIdentity(projectRoot);
    const root = await mkdtemp(path.join(tmpdir(), "soar-request-size-e2e-"));
    const model = await generalTaskModelFixture();
    let app: ElectronApplication | undefined, appClosed = true, jobId: string | undefined;
    const evidence: Record<string, unknown> = { imageId, runtimeSha256, syntheticProtocolOnly: true,
      independentAcceptance: "not_evaluated", assistantContentBytes, bodyLimit, inputSha256: digest(input), outputSha256: digest(output) };
    const closeApp = async () => {
      const current = app; app = undefined; if (!current) return;
      try { await bounded(current.close(), 45000, "fixture_app_close_timeout"); appClosed = true; }
      catch {
        const child = current.process();
        evidence.forcedAppKill = child.exitCode === null && child.signalCode === null ? child.kill("SIGKILL") : false;
        throw new Error("fixture_app_cleanup_unconfirmed");
      }
    };
    const launch = async () => {
      expect(generalTaskRuntimeIdentity(projectRoot)).toBe(runtimeSha256); appClosed = false;
      app = await electron.launch({ ...(process.env.SOAR_E2E_EXECUTABLE ? { executablePath: process.env.SOAR_E2E_EXECUTABLE } : {}),
        args: [`--user-data-dir=${path.join(root, "browser-data")}`, ...(process.env.SOAR_E2E_EXECUTABLE ? [] : [projectRoot])],
        cwd: projectRoot, env: environment(root, model.origin), timeout: 45000 });
      return app.firstWindow();
    };
    try {
      const source = path.join(root, "source.txt"); await writeFile(source, input);
      // Execution observations are now bounded. Large non-observation history
      // must still hit the final request cap without a second dispatch.
      model.actions.push({ name: "execute", arguments: { command }, content: "X".repeat(assistantContentBytes) });
      let page = await launch();
      await app!.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, source);
      await page.getByTestId("general-task-entry").click();
      await expect(page.getByText("Ready for a general task", { exact: true })).toBeVisible({ timeout: 30000 });
      await page.getByRole("textbox", { name: "Task goal", exact: true }).fill(goal);
      await page.getByRole("textbox", { name: "Output filename", exact: true }).fill("report.md");
      await page.getByRole("button", { name: "Choose files", exact: true }).click();
      await expect(page.getByRole("list", { name: "Selected input files" })).toContainText("source.txt");
      await page.getByRole("checkbox", { name: /^I confirm that my task goal/u }).check();
      await page.getByRole("button", { name: "Create and start task", exact: true }).click();
      const stopped = await stoppedUi(page); jobId = stopped.id; evidence.stopped = stopped;
      expect(model.requests).toHaveLength(1); expect(model.errors).toEqual([]);
      const before = await audit(root, stopped, model.origin, model.requests[0]!.body); evidence.beforeRestartLedger = before;
      evidence.firstExportSha256 = await exportArtifact(app!, page, root, "export-before-restart.md");
      await page.screenshot({ path: testInfo.outputPath("request-size-stopped.png"), fullPage: true });
      await closeApp();
      expect(ledger(root, jobId)).toEqual(before);
      page = await launch(); await page.getByTestId("general-task-entry").click();
      const restored = await stoppedUi(page); expect(restored).toEqual(stopped); evidence.restored = restored;
      const resumeDenied = await page.evaluate(async id => {
        try { await (globalThis as unknown as { soar: SoarGeneralTaskApi }).soar.resumeGeneralTask(id); return false; } catch { return true; }
      }, jobId);
      expect(resumeDenied).toBe(true); evidence.resumeDenied = resumeDenied;
      evidence.secondExportSha256 = await exportArtifact(app!, page, root, "export-after-restart.md");
      await page.screenshot({ path: testInfo.outputPath("request-size-reopened.png"), fullPage: true });
      expect(await audit(root, restored, model.origin, model.requests[0]!.body)).toEqual(before);
      expect(await readFile(source, "utf8")).toBe(input);
      expect(model.requests).toHaveLength(1); expect(model.errors).toEqual([]); expect(model.canaryRequests).toBe(0);
    } finally {
      let cleanupFailed = false, containersAbsent = false;
      try { await closeApp(); } catch { cleanupFailed = true; }
      try { await bounded(model.close(), 5000, "fixture_model_close_timeout"); } catch { cleanupFailed = true; }
      try {
        // Recover the owned ID even when an earlier assertion prevented its assignment.
        if (!jobId && existsSync(path.join(root, "desktop.sqlite"))) {
          const db = new Database(path.join(root, "desktop.sqlite"), { readonly: true, fileMustExist: true, timeout: 5000 });
          try { const ids = db.prepare("SELECT id FROM general_tasks").all() as { id: string }[];
            if (ids.length > 1) throw new Error("fixture_unexpected_job_count"); jobId = ids[0]?.id; }
          finally { db.close(); }
        }
        if (jobId) {
          const finalLedger = ledger(root, jobId); evidence.finalLedger = finalLedger;
          await noContainer(jobId, finalLedger.claims);
          if (evidence.beforeRestartLedger) expect(finalLedger).toEqual(evidence.beforeRestartLedger);
        }
        containersAbsent = appClosed;
      } catch { cleanupFailed = true; }
      let sourcePreserved = false;
      try { sourcePreserved = generalTaskRuntimeIdentity(projectRoot) === runtimeSha256; } catch { /* Retain evidence even if a build file becomes unreadable. */ }
      const cleanupConfirmed = appClosed && containersAbsent && !cleanupFailed;
      Object.assign(evidence, { appClosed, containersAbsent, cleanupConfirmed, sourcePreserved,
        requests: model.requests, fixtureErrors: model.errors, canaryRequests: model.canaryRequests,
        ...(!cleanupConfirmed ? { retainedOriginalDirectory: root } : {}) });
      await writeFile(testInfo.outputPath("evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
      await cp(root, testInfo.outputPath("retained-state"), { recursive: true });
      if (cleanupConfirmed) await rm(root, { recursive: true, force: true });
      expect(cleanupConfirmed).toBe(true); expect(sourcePreserved).toBe(true);
      expect(model.requests).toHaveLength(1); expect(model.errors).toEqual([]); expect(model.canaryRequests).toBe(0);
    }
  });
});
