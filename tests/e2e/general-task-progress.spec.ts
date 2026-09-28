import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { _electron as electron, expect, test, type ElectronApplication, type Page, type TestInfo } from "@playwright/test";
import Database from "better-sqlite3";
import type { GeneralTaskSnapshot, SoarGeneralTaskApi } from "../../src/shared/general-task-contracts";
import { generalTaskRuntimeIdentity } from "../../src/main/general-task-runtime";
import { canonical } from "../../src/main/private-agent/contracts";
import type { DispatchReceipt, PrivateRunClaim } from "../../src/main/private-agent/store";
import { DockerSandbox } from "../../src/main/private-agent/sandbox";
import { currentProgressGuidance, digest, failureResult, failingCommand, generalTaskProgressFixture, progressGoal, progressHeading,
  progressInput, progressModel, progressStop, progressStopReason, progressFinishSummary, repairCommand, type ProgressScenario } from "../helpers/general-task-progress-fixture";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const imageId = process.env.SOAR_GENERAL_TASK_IMAGE_ID ?? "";
const exec = promisify(execFile);
type Event = Record<string, any>;
type Fixture = Awaited<ReturnType<typeof generalTaskProgressFixture>>;
type FileRef = { path: string; bytes: number; sha256: string };
function environment(root: string, origin: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ["HOME", "LANG", "LC_ALL", "LC_CTYPE", "LOGNAME", "PATH", "SHELL", "TMPDIR", "USER", "DISPLAY", "XAUTHORITY", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name]!;
  }
  return { ...env, SOAR_PROVIDER_MODE: "local", SOAR_ENABLE_HYBRID_SIMULATION: "false",
    SOAR_DB_PATH: path.join(root, "desktop.sqlite"), SOAR_VLLM_BASE_URL: `${origin}/v1`, SOAR_VLLM_MODEL: progressModel,
    SOAR_VLLM_API_KEY: "", SOAR_VLLM_COST_POLICY: "local_zero_cost", SOAR_ALLOW_INSECURE_VLLM_HTTP: "true",
    SOAR_MAX_OUTPUT_TOKENS: "4096", SOAR_REQUEST_TIMEOUT_MS: "30000", SOAR_GENERAL_TASK_IMAGE_ID: imageId,
    SOAR_PATCH_MODE: "scripted", SOAR_PATCH_API_KEY: "", SOAR_PATCH_LOCAL_API_KEY: "", SOAR_TEST_WORKSPACE: "" };
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
  const db = new Database(path.join(root, "desktop.sqlite"), { readonly: true, fileMustExist: true, timeout: 5000 });
  try { return db.transaction(() => {
    const read = (sql: string) => (db.prepare(sql).all(id) as { value: string }[]).map(row => JSON.parse(row.value));
    return { dispatches: read("SELECT value FROM private_agent_dispatches WHERE job_id=? ORDER BY rowid") as DispatchReceipt[],
      events: read("SELECT value FROM private_agent_events WHERE job_id=? ORDER BY sequence") as Event[],
      claims: read("SELECT r.value FROM private_agent_run_claims r JOIN private_agent_contexts c ON c.id=r.context_id WHERE c.job_id=?") as PrivateRunClaim[],
      record: read("SELECT value FROM general_tasks WHERE id=?")[0] as Event };
  }).deferred(); } finally { db.close(); }
}
async function noContainer(id: string, claims: PrivateRunClaim[]) {
  expect(id).toMatch(/^[a-f0-9-]{36}$/u);
  for (const endpoint of [...new Set(claims.length ? claims.map(row => row.endpoint) : [await DockerSandbox.currentEndpoint()])]) {
    expect(endpoint).toMatch(/^unix:\/\/\/[^\x00-\x20\x7f]+$/u);
    await expect.poll(async () => (await exec("docker", ["--host", endpoint, "container", "ls", "--all", "--quiet",
      "--filter", "label=soar.private-sandbox-id", "--filter", `label=soar.private-job-id=${id}`], { timeout: 10000 })).stdout.trim(), { timeout: 20000 }).toBe("");
  }
}
function sourceTotals(): Record<string, number> {
  // Independent test-side calculation; no candidate code or evaluator is executed.
  return Object.fromEntries(progressInput.trim().split("\n").slice(1).map(line => {
    const [id, quantity, unitCents] = line.split(","); return [id!, Number(quantity) * Number(unitCents)];
  }));
}
async function exportArtifact(app: ElectronApplication, page: Page, root: string, name: string, task: GeneralTaskSnapshot) {
  await page.getByRole("button", { name: "Preview output/report.json", exact: true }).click();
  const preview = page.getByRole("region", { name: "Artifact preview", exact: true });
  await expect(preview).toContainText("totalsCents"); await expect(preview.locator("script,img,iframe,webview,a[href]")).toHaveCount(0);
  const destination = path.join(root, name);
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, destination);
  await page.getByRole("button", { name: "Export output/report.json", exact: true }).click();
  await expect(page.getByText("Artifact exported.", { exact: true })).toBeVisible();
  const bytes = await readFile(destination), report = JSON.parse(bytes.toString("utf8"));
  expect(report).toEqual({ totalsCents: sourceTotals() });
  expect(task.artifacts).toEqual([{ path: "output/report.json", bytes: bytes.length, sha256: digest(bytes) }]);
  return { bytes: bytes.length, sha256: digest(bytes), report };
}

test.describe("desktop execution progress intervention", () => {
  test.skip(process.env.SOAR_RUN_GENERAL_TASK_E2E !== "true", "Requires a separately frozen admission; scripted localhost responses and installed offline Docker only.");
  test.skip(!/^sha256:[a-f0-9]{64}$/u.test(imageId), "Supply the installed immutable image; no pull or download.");
  test.setTimeout(240000);
  test("changes action after two failures across pause and restart, then exports source-derived output", async ({}, info) => runCase("recover", info));
  test("blocks the third unchanged failed command before execution and denies replay after restart", async ({}, info) => runCase("ignore", info));
});

async function runCase(scenario: ProgressScenario, testInfo: TestInfo) {
  const relative = path.relative(path.join(projectRoot, ".soar"), testInfo.outputDir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("fixture_requires_ignored_output_directory");
  const expectedCalls = scenario === "recover" ? 4 : 3, expectedTools = scenario === "recover" ? 4 : 2;
  const runtimeSha256 = generalTaskRuntimeIdentity(projectRoot);
  const root = await mkdtemp(path.join(tmpdir(), "soar-progress-e2e-")), model = await generalTaskProgressFixture(scenario);
  let app: ElectronApplication | undefined, appClosed = true, jobId: string | undefined;
  const evidence: Record<string, unknown> = { scenario, runtimeSha256, imageId, scriptedMechanicsOnly: true,
    independentAcceptance: "not_evaluated", inputSha256: digest(progressInput), failingCommandSha256: digest(failingCommand) };
  const closeApp = async () => {
    const current = app; app = undefined; if (!current) return;
    try { await bounded(current.close(), 45000, "fixture_app_close_timeout"); appClosed = true; }
    catch { const child = current.process(); evidence.forcedAppKill = child.exitCode === null && child.signalCode === null ? child.kill("SIGKILL") : false;
      throw new Error("fixture_app_cleanup_unconfirmed"); }
  };
  const launch = async () => {
    expect(generalTaskRuntimeIdentity(projectRoot)).toBe(runtimeSha256); appClosed = false;
    app = await electron.launch({ ...(process.env.SOAR_E2E_EXECUTABLE ? { executablePath: process.env.SOAR_E2E_EXECUTABLE } : {}),
      args: [`--user-data-dir=${path.join(root, "browser-data")}`, ...(process.env.SOAR_E2E_EXECUTABLE ? [] : [projectRoot])],
      cwd: projectRoot, env: environment(root, model.origin), timeout: 45000 }); return app.firstWindow();
  };
  try {
    const source = path.join(root, "source.csv"); await writeFile(source, progressInput);
    let page = await launch();
    await app!.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, source);
    await page.getByTestId("general-task-entry").click();
    await expect(page.getByText("Ready for a general task", { exact: true })).toBeVisible({ timeout: 30000 });
    await page.getByRole("textbox", { name: "Task goal", exact: true }).fill(progressGoal);
    await page.getByRole("textbox", { name: "Output filename", exact: true }).fill("report.json");
    await page.getByRole("button", { name: "Choose files", exact: true }).click();
    await expect(page.getByRole("list", { name: "Selected input files" })).toContainText("source.csv");
    await page.getByRole("checkbox", { name: /^I confirm that my task goal/u }).check();
    await page.getByRole("button", { name: "Create and start task", exact: true }).click();
    let pausedLedger: ReturnType<typeof ledger> | undefined;
    if (scenario === "recover") {
      await expect.poll(() => model.requests.length, { timeout: 45000 }).toBe(2);
      await page.getByRole("button", { name: "Pause task", exact: true }).click(); model.releaseSecond();
      await expect.poll(async () => (await first(page)).status, { timeout: 45000 }).toBe("paused");
      await expect.poll(async () => (await first(page)).cleanupConfirmed).toBe(true);
      const paused = await first(page); jobId = paused.id; evidence.paused = paused;
      expect(paused).toMatchObject({ modelCalls: 2, toolCalls: 2, canResume: true, artifacts: [], checks: [] });
      pausedLedger = ledger(root, jobId); evidence.pausedLedger = pausedLedger;
      expect(pausedLedger.dispatches).toHaveLength(2); await noContainer(jobId, pausedLedger.claims);
      await page.screenshot({ path: testInfo.outputPath("progress-paused.png"), fullPage: true });
      await closeApp(); expect(ledger(root, jobId)).toEqual(pausedLedger);
      page = await launch(); await page.getByTestId("general-task-entry").click();
      await expect(page.getByRole("button", { name: "Resume task", exact: true })).toBeEnabled({ timeout: 30000 });
      const reopened = await first(page); evidence.reopened = reopened;
      expect(reopened).toMatchObject({ id: jobId, status: "paused", modelCalls: 2, toolCalls: 2, canResume: true, cleanupConfirmed: true });
      expect(ledger(root, jobId)).toEqual(pausedLedger); expect(model.requests).toHaveLength(2);
      await page.getByRole("button", { name: "Resume task", exact: true }).click();
    }
    const expectedStatus = scenario === "recover" ? "submitted" : "incomplete";
    await expect.poll(async () => (await first(page)).status, { timeout: 90000 }).toBe(expectedStatus);
    await expect.poll(async () => (await first(page)).cleanupConfirmed).toBe(true);
    const stopped = await first(page); jobId = stopped.id; evidence.stopped = stopped;
    expect(stopped).toMatchObject({ modelCalls: expectedCalls, toolCalls: expectedTools, canResume: false, cleanupConfirmed: true, independentAcceptance: "not_evaluated" });
    await expect(page.getByRole("article", { name: "Selected general task" }).locator(".general-metrics > div").filter({ has: page.getByText("Model attempts", { exact: true }) }).locator("dd")).toHaveText(String(expectedCalls));
    const finalLedger = ledger(root, jobId); evidence.beforeFinalRestartLedger = finalLedger;
    evidence.progressAudit = await auditProgress(root, scenario, stopped, finalLedger, model, pausedLedger);
    if (scenario === "recover") {
      expect(stopped.checks).toEqual([{ id: "desktop_artifact_structure", passed: true }]);
      evidence.firstExport = await exportArtifact(app!, page, root, "export-before-restart.json", stopped);
    } else {
      expect(stopped.artifacts).toEqual([]); expect(stopped.checks).toEqual([]); expect(stopped.reason).toBe(progressStopReason);
      await expect(page.getByRole("article", { name: "Selected general task" })).toContainText(progressStopReason);
    }
    await page.screenshot({ path: testInfo.outputPath("progress-terminal.png"), fullPage: true });
    await closeApp(); expect(ledger(root, jobId)).toEqual(finalLedger);
    page = await launch(); await page.getByTestId("general-task-entry").click();
    await expect(page.getByRole("article", { name: "Selected general task" }).getByRole("status")).toHaveText(scenario === "recover" ? "Submitted for review" : "Incomplete", { timeout: 30000 });
    const restored = await first(page); evidence.restored = restored; expect(restored).toEqual(stopped);
    await expect(page.getByRole("button", { name: "Resume task", exact: true })).toHaveCount(0);
    const resumeDenied = await page.evaluate(async id => { try { await (globalThis as unknown as { soar: SoarGeneralTaskApi }).soar.resumeGeneralTask(id); return false; } catch { return true; } }, jobId);
    expect(resumeDenied).toBe(true); evidence.resumeDenied = resumeDenied;
    if (scenario === "recover") {
      evidence.secondExport = await exportArtifact(app!, page, root, "export-after-restart.json", restored);
      expect(evidence.secondExport).toEqual(evidence.firstExport);
    } else await expect(page.getByRole("button", { name: /^Export output\//u })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("progress-reopened.png"), fullPage: true });
    expect(ledger(root, jobId)).toEqual(finalLedger); expect(await readFile(source, "utf8")).toBe(progressInput);
    expect(model.requests).toHaveLength(expectedCalls); expect(model.responses).toHaveLength(expectedCalls); expect(model.errors).toEqual([]);
    await noContainer(jobId, finalLedger.claims);
  } finally {
    let failed = false, containersAbsent = false;
    try { await closeApp(); } catch { failed = true; }
    try { await bounded(model.close(), 5000, "fixture_model_close_timeout"); } catch { failed = true; }
    try {
      if (!jobId && existsSync(path.join(root, "desktop.sqlite"))) {
        const db = new Database(path.join(root, "desktop.sqlite"), { readonly: true, fileMustExist: true, timeout: 5000 });
        try { const ids = db.prepare("SELECT id FROM general_tasks").all() as { id: string }[]; if (ids.length > 1) throw new Error("fixture_unexpected_job_count"); jobId = ids[0]?.id; } finally { db.close(); }
      }
      if (jobId) { const finalLedger = ledger(root, jobId); evidence.finalLedger = finalLedger; await noContainer(jobId, finalLedger.claims);
        if (evidence.beforeFinalRestartLedger) expect(finalLedger).toEqual(evidence.beforeFinalRestartLedger); }
      containersAbsent = appClosed;
    } catch { failed = true; }
    let sourcePreserved = false; try { sourcePreserved = generalTaskRuntimeIdentity(projectRoot) === runtimeSha256; } catch { /* Retain failures. */ }
    const cleanupConfirmed = appClosed && containersAbsent && !failed;
    Object.assign(evidence, { requests: model.requests, responses: model.responses, decisions: model.decisions, fixtureErrors: model.errors,
      appClosed, containersAbsent, cleanupConfirmed, sourcePreserved, ...(!cleanupConfirmed ? { retainedOriginalDirectory: root } : {}) });
    await writeFile(testInfo.outputPath("evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    await cp(root, testInfo.outputPath("retained-state"), { recursive: true });
    if (cleanupConfirmed) await rm(root, { recursive: true, force: true });
    expect(cleanupConfirmed).toBe(true); expect(sourcePreserved).toBe(true); expect(model.requests).toHaveLength(expectedCalls); expect(model.errors).toEqual([]);
  }
}

async function auditProgress(root: string, scenario: ProgressScenario, task: GeneralTaskSnapshot, value: ReturnType<typeof ledger>, model: Fixture, paused?: ReturnType<typeof ledger>) {
  const count = scenario === "recover" ? 4 : 3, tools = scenario === "recover" ? 4 : 2;
  const rows = (type: string) => value.events.filter(event => event.type === type);
  const starts = rows("model_started"), finished = rows("model_finished"), toolStarts = rows("tool_started"), toolFinishes = rows("tool_finished");
  expect(starts).toHaveLength(count); expect(finished).toHaveLength(count); expect(toolStarts).toHaveLength(tools); expect(toolFinishes).toHaveLength(tools);
  expect(value.dispatches).toHaveLength(count); expect(rows("model_request_not_dispatched")).toEqual([]);
  expect(rows("session_started")).toHaveLength(1); expect(rows("started")[0]).toMatchObject({ executionProgressPolicyVersion: 1 });
  expect(value.record).toMatchObject({ id: task.id, goal: progressGoal, outputName: "report.json", status: task.status,
    inputSnapshot: [{ path: "input/01-source.csv", bytes: Buffer.byteLength(progressInput), sha256: digest(progressInput) }] });
  expect(value.claims).toHaveLength(1); expect(value.claims[0]!.state).toBe("released");
  expect(rows("run_ended")).toHaveLength(scenario === "recover" ? 2 : 1); expect(rows("run_ended").every(e => e.cleanupConfirmed)).toBe(true);
  for (let i = 0; i < count; i++) {
    const request = model.requests[i]!, response = model.responses[i]!;
    expect(value.dispatches[i]).toMatchObject({ jobId: task.id, contextId: starts[i]!.contextId, status: "settled", feeMicrousd: 0, reservedFeeMicrousd: 0,
      purpose: "agent reasoning and tool selection", responseSha256: digest(response),
      packetSha256: digest(canonical({ method: "POST", url: `${model.origin}/v1/chat/completions`, headers: { "content-type": "application/json" }, body: request.rawBody })) });
    expect(request.bytes).toBe(Buffer.byteLength(request.rawBody)); expect(request.sha256).toBe(digest(request.rawBody)); expect(request.bytes).toBeLessThanOrEqual(192 * 1024);
    expect(finished[i]!.operationId).toBe(starts[i]!.operationId);
    const guidanceText = currentProgressGuidance(request.body);
    expect(starts[i]!.executionProgress.guidanceSha256).toBe(digest(guidanceText));
    expect(Buffer.byteLength(JSON.stringify(guidanceText))).toBeLessThanOrEqual(8192);
    const system = String(request.body.messages[0].content);
    expect(system).toContain(`\n${canonical(starts[i]!.budget)}`);
    expect(starts[i]!.budget).toMatchObject({ remainingModelCalls: 20 - i, remainingBrokerRequests: 40 - i, remainingToolCalls: 30 - Math.min(i, tools) });
    if (i) expect(starts[i]!.budget.remainingActiveMs).toBeLessThan(starts[i - 1]!.budget.remainingActiveMs);
  }
  const rootCheckpoint = rows("checkpoint")[0]!;
  expect(rootCheckpoint.snapshot).toEqual([{ path: "input/01-source.csv", bytes: Buffer.byteLength(progressInput), sha256: digest(progressInput) }]);
  for (const event of value.events.slice(0, value.events.indexOf(starts[2]!)).filter(e => e.type === "checkpoint")) expect(event).toMatchObject({ snapshot: rootCheckpoint.snapshot, sha256: rootCheckpoint.sha256 });
  const blobs: { operationId: string; sha256: string; result: unknown }[] = [];
  for (let i = 0; i < (scenario === "recover" ? 3 : 2); i++) {
    const event = toolFinishes[i]!, ref = event.executionObservation;
    expect(event.executionCapture).toBe("retained");
    expect(ref).toMatchObject({ jobId: task.id, contextId: event.contextId, operationId: event.operationId, toolCallId: event.toolCallId, observationId: event.operationId });
    expect(ref.snapshot).toEqual([{ path: `execution-observations/${event.operationId}.json`, bytes: ref.bytes, sha256: ref.sha256 }]);
    const bytes = await readFile(path.join(root, "general-tasks", "checkpoints", task.id, ref.sha256));
    expect(bytes.length).toBe(ref.bytes); expect(digest(bytes)).toBe(ref.sha256);
    const blob = JSON.parse(bytes.toString("utf8")); expect(blob).toMatchObject({ jobId: task.id, contextId: event.contextId, operationId: event.operationId, toolCallId: event.toolCallId });
    if (i < 2) { expect(blob.result).toEqual(failureResult); expect(JSON.parse(event.output)).toMatchObject(failureResult); }
    else expect(blob.result).toMatchObject({ exitCode: 0, stderr: "", stdout: "SOURCE_CHECK_PASS rows=3\n" });
    blobs.push({ operationId: ref.operationId, sha256: ref.sha256, result: blob.result });
  }
  expect(blobs[0]!.operationId).not.toBe(blobs[1]!.operationId); expect(blobs[0]!.sha256).not.toBe(blobs[1]!.sha256); expect(blobs[0]!.result).toEqual(blobs[1]!.result);
  expect(toolFinishes[0]!.output).toBe(toolFinishes[1]!.output);
  const call = (index: number) => finished[index]!.message.tool_calls[0];
  expect(JSON.parse(call(0).function.arguments)).toEqual({ command: failingCommand }); expect(JSON.parse(call(1).function.arguments)).toEqual({ command: failingCommand });
  const guidance = starts[2]!.executionProgress;
  expect(guidance).toMatchObject({ version: 1, snapshotSha256: rootCheckpoint.sha256, requiredPaths: ["output/report.json"],
    consumedModelCalls: 2, maxModelCalls: 20, consultationAvailable: false,
    repeatedFailure: { commandSha256: digest(failingCommand), resultSha256: digest(canonical(failureResult)), snapshotSha256: rootCheckpoint.sha256,
      operationIds: [toolFinishes[0]!.operationId, toolFinishes[1]!.operationId] },
    missingArtifacts: { paths: ["output/report.json"], total: 1, reminder: false } });
  expect(guidance.policySha256).toMatch(/^[a-f0-9]{64}$/u); expect(guidance.guidanceSha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(starts[0]!.executionProgress.repeatedFailure).toBeNull(); expect(starts[1]!.executionProgress.repeatedFailure).toBeNull();
  const system = String(model.requests[2]!.body.messages[0].content);
  expect(system.split(progressHeading)).toHaveLength(2);
  expect(system).toContain(`Prior execution IDs: ${canonical(guidance.repeatedFailure.operationIds)}.`);
  expect(model.decisions.map(x => x.guidanceObserved)).toEqual(scenario === "recover" ? [false, false, true, false] : [false, false, true]);
  if (scenario === "recover") {
    expect(paused).toBeDefined(); expect(value.events.slice(0, paused!.events.length)).toEqual(paused!.events); expect(value.dispatches.slice(0, 2)).toEqual(paused!.dispatches);
    expect(JSON.parse(call(2).function.arguments)).toEqual({ command: repairCommand }); expect(repairCommand).not.toBe(failingCommand);
    expect(call(3).function.name).toBe("finish"); expect(JSON.parse(call(3).function.arguments)).toEqual({ summary: progressFinishSummary });
    expect(starts[3]!.executionProgress.repeatedFailure).toBeNull();
    expect(starts[3]!.executionProgress.missingArtifacts).toEqual({ paths: [], total: 0, reminder: false });
    expect(rows("model_action_not_started")).toEqual([]); expect(rows("completed")).toHaveLength(1);
  } else {
    expect(JSON.parse(call(2).function.arguments)).toEqual({ command: failingCommand });
    const markers = rows("model_action_not_started"); expect(markers).toHaveLength(1);
    expect(markers[0]).toEqual({ type: "model_action_not_started", operationId: starts[2]!.operationId, contextId: starts[2]!.contextId, reason: progressStop,
      promptProtocolSha256: starts[2]!.promptProtocolSha256, toolCallId: call(2).id, progressSha256: digest(canonical(guidance)),
      responseSha256: digest(canonical(finished[2]!.message)), commandSha256: digest(failingCommand), snapshotSha256: rootCheckpoint.sha256 });
    expect(value.events.indexOf(markers[0]!)).toBeGreaterThan(value.events.indexOf(finished[2]!));
    expect(toolStarts.some(row => row.toolCallId === call(2).id)).toBe(false); expect(toolFinishes.some(row => row.toolCallId === call(2).id)).toBe(false);
    expect(rows("completed")).toEqual([]); expect(rows("host_validation_started")).toEqual([]); expect(rows("host_validation_finished")).toEqual([]);
    // The stored task keeps its generic status. get() derives the specific
    // user-facing reason from the verified marker checked above.
    expect(value.record.reason).toBe("incomplete");
  }
  const snapshot = rows("checkpoint").at(-1)!.snapshot as FileRef[];
  if (scenario === "ignore") expect(snapshot).toEqual(rootCheckpoint.snapshot);
  for (const item of snapshot) { const bytes = await readFile(path.join(root, "general-tasks", "checkpoints", task.id, item.sha256)); expect(bytes.length).toBe(item.bytes); expect(digest(bytes)).toBe(item.sha256); }
  await noContainer(task.id, value.claims);
  return { guidance, executionBlobs: blobs, requestBytes: model.requests.map(row => row.bytes), thirdActionStarted: scenario === "recover",
    toolActions: tools, modelAttempts: count, sourceCorrectnessIndependentlyCheckedOnExport: scenario === "recover" };
}
