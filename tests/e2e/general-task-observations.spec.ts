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
import { canonical } from "../../src/main/private-agent/contracts";
import type { DispatchReceipt, PrivateRunClaim } from "../../src/main/private-agent/store";
import { DockerSandbox } from "../../src/main/private-agent/sandbox";
import { digest, generalTaskObservationFixture, observationDetailOffset, observationGoal, observationInput,
  observationLogBytes, observationModel, observationReadBytes } from "../helpers/general-task-observation-fixture";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const imageId = process.env.SOAR_GENERAL_TASK_IMAGE_ID ?? "";
const exec = promisify(execFile);
type Event = Record<string, any>;
type Fixture = Awaited<ReturnType<typeof generalTaskObservationFixture>>;
function environment(root: string, origin: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ["HOME", "LANG", "LC_ALL", "LC_CTYPE", "LOGNAME", "PATH", "SHELL", "TMPDIR", "USER", "DISPLAY", "XAUTHORITY", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name]!;
  }
  return { ...env, SOAR_PROVIDER_MODE: "local", SOAR_ENABLE_HYBRID_SIMULATION: "false",
    SOAR_DB_PATH: path.join(root, "desktop.sqlite"), SOAR_VLLM_BASE_URL: `${origin}/v1`, SOAR_VLLM_MODEL: observationModel,
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
  for (const endpoint of [...new Set(claims.length ? claims.map(row => row.endpoint) : [await DockerSandbox.currentEndpoint()])]) {
    expect(endpoint).toMatch(/^unix:\/\/\/[^\x00-\x20\x7f]+$/u);
    await expect.poll(async () => (await exec("docker", ["--host", endpoint, "container", "ls", "--all", "--quiet",
      "--filter", "label=soar.private-sandbox-id", "--filter", `label=soar.private-job-id=${id}`], { timeout: 10000 })).stdout.trim(), { timeout: 20000 }).toBe("");
  }
}
function independentlyExpectedTotals(): Record<string, number> {
  // Independent test calculation from the original public CSV, never an evaluator file.
  return Object.fromEntries(observationInput.trim().split("\n").slice(1).map(line => {
    const [id, quantity, unitCents] = line.split(","); return [id!, Number(quantity) * Number(unitCents)];
  }));
}
async function verifyExport(app: ElectronApplication, page: Page, root: string, name: string, model: Fixture, task: GeneralTaskSnapshot) {
  await page.getByRole("button", { name: "Preview output/report.json", exact: true }).click();
  const preview = page.getByRole("region", { name: "Artifact preview", exact: true });
  await expect(preview).toContainText("totalsCents"); await expect(preview.locator("script,img,iframe,webview,a[href]")).toHaveCount(0);
  const destination = path.join(root, name);
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, destination);
  await page.getByRole("button", { name: "Export output/report.json", exact: true }).click();
  await expect(page.getByText("Artifact exported.", { exact: true })).toBeVisible();
  const bytes = await readFile(destination), report = JSON.parse(bytes.toString("utf8"));
  expect(report).toEqual({ totalsCents: independentlyExpectedTotals(), recoveryEvidence: model.learnedFailure });
  expect(model.learnedFailure).toBeDefined(); expect(task.artifacts).toEqual([{ path: "output/report.json", bytes: bytes.length, sha256: digest(bytes) }]);
  return { bytes: bytes.length, sha256: digest(bytes), report };
}

test.describe("desktop bounded observations with explicit evidence recovery", () => {
  test.skip(process.env.SOAR_RUN_GENERAL_TASK_E2E !== "true", "Requires a separately admitted frozen runtime. Only a controlled localhost protocol fixture and offline Docker are used.");
  test.skip(!/^sha256:[a-f0-9]{64}$/u.test(imageId), "Supply the installed immutable image; no pull or download.");
  test.setTimeout(240000);

  test("restarts before retrieving a hidden failed check, repairs from readback and exports the verified source totals", async ({}, testInfo) => {
    const relative = path.relative(path.join(projectRoot, ".soar"), testInfo.outputDir);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("fixture_requires_ignored_output_directory");
    const runtimeSha256 = generalTaskRuntimeIdentity(projectRoot);
    const root = await mkdtemp(path.join(tmpdir(), "soar-observation-e2e-"));
    const model = await generalTaskObservationFixture();
    let app: ElectronApplication | undefined, appClosed = true, jobId: string | undefined;
    const evidence: Record<string, unknown> = { runtimeSha256, imageId, scriptedMechanicsOnly: true,
      independentAcceptance: "not_evaluated", inputSha256: digest(observationInput), observationLogBytes, observationDetailOffset };
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
      const source = path.join(root, "source.csv"); await writeFile(source, observationInput);
      let page = await launch();
      await app!.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, source);
      await page.getByTestId("general-task-entry").click();
      await expect(page.getByText("Ready for a general task", { exact: true })).toBeVisible({ timeout: 30000 });
      await page.getByRole("textbox", { name: "Task goal", exact: true }).fill(observationGoal);
      await page.getByRole("textbox", { name: "Output filename", exact: true }).fill("report.json");
      await page.getByRole("button", { name: "Choose files", exact: true }).click();
      await expect(page.getByRole("list", { name: "Selected input files" })).toContainText("source.csv");
      await page.getByRole("checkbox", { name: /^I confirm that my task goal/u }).check();
      await page.getByRole("button", { name: "Create and start task", exact: true }).click();
      await expect.poll(() => model.requests.length, { timeout: 45000 }).toBe(1);
      await page.getByRole("button", { name: "Pause task", exact: true }).click(); model.releaseFirst();
      await expect.poll(async () => (await first(page)).status, { timeout: 45000 }).toBe("paused");
      await expect.poll(async () => (await first(page)).cleanupConfirmed).toBe(true);
      const paused = await first(page); jobId = paused.id; evidence.paused = paused;
      expect(paused).toMatchObject({ modelCalls: 1, toolCalls: 1, canResume: true, checks: [], independentAcceptance: "not_evaluated" });
      const pausedLedger = ledger(root, jobId); evidence.pausedLedger = pausedLedger;
      expect(pausedLedger.dispatches).toHaveLength(1); expect(pausedLedger.dispatches[0]!.status).toBe("settled");
      expect(pausedLedger.events.filter(event => event.type === "tool_finished")).toHaveLength(1);
      await noContainer(jobId, pausedLedger.claims);
      await page.screenshot({ path: testInfo.outputPath("observation-paused.png"), fullPage: true });
      await closeApp(); expect(ledger(root, jobId)).toEqual(pausedLedger);
      page = await launch(); await page.getByTestId("general-task-entry").click();
      await expect(page.getByRole("button", { name: "Resume task", exact: true })).toBeEnabled({ timeout: 30000 });
      const reopened = await first(page); evidence.reopened = reopened;
      expect(reopened).toMatchObject({ id: jobId, status: "paused", modelCalls: 1, toolCalls: 1, canResume: true, cleanupConfirmed: true });
      expect(ledger(root, jobId)).toEqual(pausedLedger); expect(model.requests).toHaveLength(1);
      await page.getByRole("button", { name: "Resume task", exact: true }).click();
      await expect.poll(async () => (await first(page)).status, { timeout: 90000 }).toBe("submitted");
      await expect.poll(async () => (await first(page)).cleanupConfirmed).toBe(true);
      const submitted = await first(page); evidence.submitted = submitted;
      expect(submitted).toMatchObject({ id: jobId, modelCalls: 4, toolCalls: 4, canResume: false, cleanupConfirmed: true,
        independentAcceptance: "not_evaluated", checks: [{ id: "desktop_artifact_structure", passed: true }] });
      await expect(page.getByRole("article", { name: "Selected general task" }).locator(".general-metrics > div").filter({ has: page.getByText("Model attempts", { exact: true }) }).locator("dd")).toHaveText("4");
      expect(model.errors).toEqual([]); expect(model.requests).toHaveLength(4); expect(model.responses).toHaveLength(4);
      const finalLedger = ledger(root, jobId); evidence.beforeFinalRestartLedger = finalLedger;
      evidence.observationAudit = await verifyObservationLedger(root, finalLedger, model, pausedLedger);
      evidence.firstExport = await verifyExport(app!, page, root, "export-before-restart.json", model, submitted);
      await page.screenshot({ path: testInfo.outputPath("observation-submitted.png"), fullPage: true });
      await closeApp(); expect(ledger(root, jobId)).toEqual(finalLedger);
      page = await launch(); await page.getByTestId("general-task-entry").click();
      await expect(page.getByRole("article", { name: "Selected general task" }).getByRole("status")).toHaveText("Submitted for review", { timeout: 30000 });
      const restored = await first(page); expect(restored).toEqual(submitted); evidence.restored = restored;
      await expect(page.getByRole("button", { name: "Resume task", exact: true })).toHaveCount(0);
      const denied = await page.evaluate(async id => { try { await (globalThis as unknown as { soar: SoarGeneralTaskApi }).soar.resumeGeneralTask(id); return false; } catch { return true; } }, jobId);
      expect(denied).toBe(true); evidence.resumeDeniedAfterSubmission = denied;
      evidence.secondExport = await verifyExport(app!, page, root, "export-after-restart.json", model, restored);
      expect(evidence.secondExport).toEqual(evidence.firstExport);
      expect(await readFile(source, "utf8")).toBe(observationInput); expect(model.requests).toHaveLength(4);
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
      let sourcePreserved = false; try { sourcePreserved = generalTaskRuntimeIdentity(projectRoot) === runtimeSha256; } catch { /* Retain failure evidence. */ }
      const cleanupConfirmed = appClosed && containersAbsent && !failed;
      Object.assign(evidence, { requests: model.requests, responses: model.responses, learnedFailure: model.learnedFailure,
        selectedReference: model.selectedReference, fixtureErrors: model.errors, appClosed, containersAbsent, cleanupConfirmed, sourcePreserved,
        ...(!cleanupConfirmed ? { retainedOriginalDirectory: root } : {}) });
      await writeFile(testInfo.outputPath("evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
      await cp(root, testInfo.outputPath("retained-state"), { recursive: true });
      if (cleanupConfirmed) await rm(root, { recursive: true, force: true });
      expect(cleanupConfirmed).toBe(true); expect(sourcePreserved).toBe(true); expect(model.requests).toHaveLength(4); expect(model.errors).toEqual([]);
    }
  });
});

async function verifyObservationLedger(root: string, value: ReturnType<typeof ledger>, model: Fixture, paused: ReturnType<typeof ledger>) {
  const rows = (type: string) => value.events.filter(event => event.type === type);
  expect(rows("model_started")).toHaveLength(4); expect(rows("model_finished")).toHaveLength(4);
  expect(rows("tool_started")).toHaveLength(4); expect(rows("tool_finished")).toHaveLength(4);
  expect(rows("tool_started").map(row => row.name)).toEqual(["execute", "read_observation", "execute", "finish"]);
  expect(rows("session_started")).toEqual(paused.events.filter(row => row.type === "session_started"));
  expect(value.events.slice(0, paused.events.length)).toEqual(paused.events);
  expect(value.dispatches).toHaveLength(4); expect(value.dispatches[0]).toEqual(paused.dispatches[0]);
  const jobId = String(value.record.id);
  for (let i = 0; i < 4; i++) {
    const request = model.requests[i]!, response = model.responses[i]!, receipt = value.dispatches[i]!;
    expect(receipt).toMatchObject({ jobId, status: "settled", feeMicrousd: 0, reservedFeeMicrousd: 0,
      purpose: "agent reasoning and tool selection", responseSha256: digest(response),
      packetSha256: digest(canonical({ method: "POST", url: `${model.origin}/v1/chat/completions`, headers: { "content-type": "application/json" }, body: request.rawBody })) });
    expect(request.bytes).toBe(Buffer.byteLength(request.rawBody)); expect(request.sha256).toBe(digest(request.rawBody));
    expect(request.bytes).toBeLessThanOrEqual(192 * 1024);
    expect(rows("model_finished")[i]!.operationId).toBe(rows("model_started")[i]!.operationId);
  }
  expect(value.claims).toHaveLength(1); expect(value.claims[0]!.state).toBe("released");
  expect(rows("run_ended")).toHaveLength(2); expect(rows("run_ended").every(row => row.cleanupConfirmed)).toBe(true);
  expect(rows("completed")).toHaveLength(1); expect(rows("model_request_not_dispatched")).toHaveLength(0);
  expect(value.record).toMatchObject({ goal: observationGoal, outputName: "report.json", status: "submitted",
    inputSnapshot: [{ path: "input/01-source.csv", bytes: Buffer.byteLength(observationInput), sha256: digest(observationInput) }] });
  const snapshot = rows("checkpoint").at(-1)!.snapshot as { path: string; bytes: number; sha256: string }[];
  expect(snapshot.some(item => item.path.startsWith("execution-observations/"))).toBe(false);
  for (const item of snapshot) { const bytes = await readFile(path.join(root, "general-tasks", "checkpoints", jobId, item.sha256)); expect(bytes.length).toBe(item.bytes); expect(digest(bytes)).toBe(item.sha256); }
  expect(snapshot.find(row => row.path === "input/01-source.csv")).toEqual({ path: "input/01-source.csv", bytes: Buffer.byteLength(observationInput), sha256: digest(observationInput) });
  const initial = JSON.parse(String(rows("tool_finished")[0]!.output));
  expect(initial).toMatchObject({ version: 1, kind: "execution_observation", ...model.selectedReference, exitCode: 0, truncated: true });
  expect(initial.stdout.bytes).toBe(observationLogBytes); expect(initial.stdout.head.text).toContain(`details_offset=${observationDetailOffset}`);
  expect(initial.stdout.head.end).toBeLessThan(observationDetailOffset); expect(initial.stdout.tail.start).toBeGreaterThan(observationDetailOffset + observationReadBytes);
  const read = JSON.parse(String(rows("tool_finished")[1]!.output));
  expect(read).toMatchObject({ version: 1, kind: "execution_observation_read", ...model.selectedReference, stream: "stdout",
    offset: observationDetailOffset, maxBytes: observationReadBytes, start: observationDetailOffset, totalBytes: observationLogBytes });
  expect(read.text).toContain(model.learnedFailure!.nonce); expect(read.nextOffset).toBe(read.end);
  expect(read.end - read.start).toBe(Buffer.byteLength(read.text));
  for (const request of model.requests.slice(0, 2)) expect(request.rawBody).not.toContain(model.learnedFailure!.nonce);
  const finishes = rows("tool_finished"), retained = finishes.filter(event => event.executionCapture === "retained");
  expect(retained).toHaveLength(2);
  let firstResult: { exitCode: number; stdout: string; stderr: string } | undefined;
  for (const event of retained) {
    const reference = event.executionObservation;
    expect(reference).toMatchObject({ version: 1, jobId, contextId: event.contextId, operationId: event.operationId,
      toolCallId: event.toolCallId, observationId: event.operationId, exitCode: 0 });
    expect(reference.snapshot).toEqual([{ path: `execution-observations/${event.operationId}.json`, bytes: reference.bytes, sha256: reference.sha256 }]);
    const bytes = await readFile(path.join(root, "general-tasks", "checkpoints", jobId, reference.sha256));
    expect(bytes.length).toBe(reference.bytes); expect(digest(bytes)).toBe(reference.sha256);
    const blob = JSON.parse(bytes.toString("utf8"));
    expect(blob).toMatchObject({ version: 1, jobId, contextId: event.contextId, operationId: event.operationId, toolCallId: event.toolCallId });
    expect(Buffer.byteLength(blob.result.stdout)).toBe(reference.stdoutBytes); expect(Buffer.byteLength(blob.result.stderr)).toBe(reference.stderrBytes);
    if (event.toolCallId === "observation-action-1") firstResult = blob.result;
  }
  expect(firstResult).toBeDefined(); expect(firstResult!.exitCode).toBe(0); expect(firstResult!.stderr).toBe("");
  expect(Buffer.byteLength(firstResult!.stdout)).toBe(observationLogBytes);
  expect(Buffer.from(firstResult!.stdout).subarray(read.start, read.end).toString("utf8")).toBe(read.text);
  const oldSnapshot = paused.events.filter(event => event.type === "checkpoint").at(-1)!.snapshot as { path: string; bytes: number; sha256: string }[];
  const oldArtifact = oldSnapshot.find(item => item.path === "output/report.json")!;
  const oldBytes = await readFile(path.join(root, "general-tasks", "checkpoints", jobId, oldArtifact.sha256));
  expect(oldBytes.length).toBe(oldArtifact.bytes); expect(digest(oldBytes)).toBe(oldArtifact.sha256);
  const oldReport = JSON.parse(oldBytes.toString("utf8")), expected = independentlyExpectedTotals();
  const brokenKeys = Object.keys(expected).filter(key => oldReport.totalsCents[key] !== expected[key]);
  expect(brokenKeys).toEqual([model.learnedFailure!.caseId]);
  expect(oldReport.totalsCents[brokenKeys[0]!]).toBe(model.learnedFailure!.reportedCents);
  expect(expected[brokenKeys[0]!]).toBe(model.learnedFailure!.computedCents);
  expect(finishes[1]).toMatchObject({ observationCapture: "retained", observationRead: {
    version: 1, ...model.selectedReference, stream: "stdout", offset: observationDetailOffset, maxBytes: observationReadBytes,
    start: read.start, end: read.end, nextOffset: read.nextOffset, totalBytes: observationLogBytes, exitCode: 0 } });
  expect(finishes[0]).toEqual(paused.events.find(event => event.type === "tool_finished"));
  const projectionAudit = model.requests.map((request, index) => {
    const messages = request.body.messages as { role: string; tool_call_id?: string; content: string }[];
    const before = new Set(value.events.slice(0, value.events.indexOf(rows("model_started")[index]!)));
    const eligible = finishes.filter(event => before.has(event) && (event.executionObservation || event.observationRead));
    const selected = messages.flatMap((message, messageIndex) => {
      const event = message.role === "tool" ? eligible.find(row => row.toolCallId === message.tool_call_id) : undefined;
      if (!event) return [];
      expect(Buffer.byteLength(JSON.stringify(message.content))).toBeLessThanOrEqual(8192);
      // This short scenario fits all original bounded excerpts; restart may not expand them.
      expect(message.content).toBe(event.output);
      return [{ index: messageIndex, toolCallId: event.toolCallId,
        reference: orderedReference(event.executionObservation ?? event.observationRead), outputSha256: digest(message.content) }];
    });
    expect(selected).toHaveLength(index);
    const bytes = selected.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(messages[item.index]!.content)), 0);
    expect(bytes).toBeLessThanOrEqual(48 * 1024);
    const manifest = { version: 1, bytes, sha256: digest(JSON.stringify({ version: 1, observationMaxBytes: 8192, budgetBytes: 48 * 1024, selected })) };
    expect(rows("model_started")[index]!.observationProjection).toEqual(manifest);
    return { request: index + 1, bodyBytes: request.bytes, eligibleMessages: selected.length, manifest };
  });
  await noContainer(jobId, value.claims);
  return { capturedDecodedStdoutBytes: observationLogBytes, recoveredRange: { start: read.start, end: read.end },
    sourceTotalsIndependentlyRecomputed: true, projectionAudit };
}

// Projection v1 hashes the schema-ordered reference; SQLite JSON key order is not that wire contract.
function orderedReference(ref: Event): Event {
  if (ref.jobId !== undefined) return { version: ref.version, jobId: ref.jobId, contextId: ref.contextId,
    operationId: ref.operationId, toolCallId: ref.toolCallId, observationId: ref.observationId, sha256: ref.sha256,
    bytes: ref.bytes, exitCode: ref.exitCode, stdoutBytes: ref.stdoutBytes, stderrBytes: ref.stderrBytes,
    snapshot: ref.snapshot.map((item: Event) => ({ path: item.path, sha256: item.sha256, bytes: item.bytes })) };
  return { observationId: ref.observationId, sha256: ref.sha256, stream: ref.stream, offset: ref.offset,
    maxBytes: ref.maxBytes, version: ref.version, start: ref.start, end: ref.end, nextOffset: ref.nextOffset,
    totalBytes: ref.totalBytes, exitCode: ref.exitCode };
}
