import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, linkSync, rmSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GENERAL_TASK_LIMITS, GeneralTaskController, VERDICT_RECEIPT_KEYS, type GeneralTaskControllerOptions } from "../../src/main/general-tasks/controller";
import type { SoarConfig } from "../../src/main/config";
import { canonical, digest, contextFingerprint } from "../../src/main/private-agent/contracts";
import { GeneralAgentRunner, type GeneralJobOptions } from "../../src/main/private-agent/runner";
import { DockerSandbox } from "../../src/main/private-agent/sandbox";
import { EXECUTION_PROGRESS_STOP } from "../../src/main/private-agent/progress";
import { PrivateAgentModel } from "../../src/main/private-agent/model";
import type { BrokerDestination } from "../../src/main/private-agent/broker";
import { flashNextAdmissionFixture } from "../helpers/flash-next-admission-fixture";
import { workspaceListing } from "../helpers/workspace-listing";
import { retainPublicSource } from "../../src/main/private-agent/public-sources";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import type { GeneralTaskCreateInput } from "../../src/shared/general-task-contracts";
import { readDesktopResearchCard, type DesktopResearchWriteBound } from "../../src/main/general-tasks/research-route";
import type { ServingCardV1 } from "../../src/main/private-agent/serving-card";
import { adopt, proposedServingCard, writeCard } from "../helpers/serving-card-fixture";
import { SYNTHETIC_P10_REQUEST_SETTINGS } from "../helpers/serving-probe-fixture";
import { RESEARCH_COVERAGE_POLICY, RESEARCH_FILES, RESEARCH_PIPELINE_BUDGET } from "../../src/main/private-agent/research-contract";
import { researchModelServer } from "../helpers/desktop-research-server";
import { RESEARCH_V4_TEST_BRIEF, parseResearchUserContent, researchV4Reply, researchV4Sources, researchV4TrimmedReply, researchV4TrimmedSources } from "../helpers/research-v4-fixture";
import { researchRepairReserve } from "../../src/main/private-agent/research-admission";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0).reverse()) await fn(); });
function fixture(cleanupConfirmed = true) {
  const root = mkdtempSync(join(tmpdir(), "soar-general-controller-")); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const db = new Database(join(root, "desktop.sqlite")); cleanup.push(() => { db.close(); });
  const input = join(root, "source.csv"); writeFileSync(input, "value\n21\n");
  const config: SoarConfig = { providerMode: "local", hybridSimulationEnabled: false, fakeCloudScenario: "success", fakeDelayMs: 0, generalTaskProfile: "standard",
    vllm: { baseUrl: "http://127.0.0.1:9999/v1", apiKey: "host-key-a", model: "unit-fixture", costPolicy: "local_zero_cost", maxOutputTokens: 8192, timeoutMs: 300000 },
    limits: { inferenceRounds: 24, toolCalls: 24 }, context: { maxInputTokens: 32000, safetyMargin: 0.2 } };
  let runtimeIdentity = digest("runtime-v1"), imageId: string | undefined = `sha256:${"a".repeat(64)}`;
  let paused = false, cancelled = false, failModel = false, narrate = false, report = "unit artifact", release: (() => void) | undefined;
  let hold: Promise<void> | undefined;
  const executions: GeneralJobOptions[] = [];
  const factory: NonNullable<NonNullable<GeneralTaskControllerOptions["testing"]>["runnerFactory"]> = args => ({
    pause() { paused = true; }, cancel() { cancelled = true; },
    async run(signal) {
      executions.push(args); const { store, jobId, contextId, checkpoints } = args;
      // The failed-request marker is schema-checked (a real operation id); the ordinary fixture id stays readable.
      const op = failModel ? randomUUID() : `unit_${executions.length}`;
      store.append(jobId, { type: "model_started", contextId, operationId: op, promptProtocolSha256: digest("fixture-protocol") });
      if (hold) await hold;
      if (failModel) {
        // Every attempt ended in a confirmed abort: the row is resolved as failed, the operation closed, the task resumable.
        const { text: _text, ...preview } = args.broker.preview({ jobId, contextId, destinationId: "desktop_local", purpose: "agent reasoning and tool selection", method: "POST", body: "{}", maxFeeMicrousd: 0 });
        store.resolveFailure(store.commit({ ...preview, reservedFeeMicrousd: 0, scan: { status: "not_required_inside_boundary" } }, () => {}).id, "failed", { phase: "transport", code: "connection_failed", elapsedMs: 1, timeoutMs: 1000 });
        store.append(jobId, { type: "model_request_failed", contextId, operationId: op, promptProtocolSha256: digest("fixture-protocol"), reason: "model_unavailable", dispatched: true });
        store.append(jobId, { type: "run_ended", contextId, cleanupConfirmed, elapsedMs: 12 });
        return { status: "incomplete", reason: "model_unavailable", snapshot: [], checks: [], modelCalls: executions.length };
      }
      // The reply's usage and finish reason, as the runner records them (the verdict receipt sums these).
      store.append(jobId, { type: "model_finished", contextId, operationId: op, finishReason: "stop", usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 40, cacheWriteTokens: 0 } });
      const snapshot = checkpoints.save([...args.files, { path: args.contract.requiredArtifacts[0]!.path, bytes: Buffer.from(report) }]);
      store.append(jobId, { type: "checkpoint", contextId, snapshot, sha256: checkpoints.fingerprint(snapshot) });
      const status = cancelled || signal?.aborted ? "incomplete" : paused ? "paused" : "completed";
      const checks = [{ id: "desktop_artifact_structure", passed: true }];
      // A research phase (claims check configured) records what the finish-time check verified, as the runner does; the session judges after completion.
      if (narrate) {
        // The agent's own words and actions, as the runner records them: a plan, one execute action, a failed finish, then the passing finish.
        store.append(jobId, { type: "plan", contextId, plan: "1. Read the input. 2. Write the memo." });
        store.append(jobId, { type: "model_finished", contextId, operationId: op, message: { role: "assistant", content: "", tool_calls: [{ id: "call_exec", type: "function", function: { name: "execute", arguments: JSON.stringify({ command: "python3 compute.py --all" }) } }] } });
        store.append(jobId, { type: "tool_started", contextId, operationId: "unit_exec", toolCallId: "call_exec", name: "execute" });
        store.append(jobId, { type: "tool_finished", contextId, operationId: "unit_exec", toolCallId: "call_exec", output: '{"exitCode":0}' });
        store.append(jobId, { type: "model_finished", contextId, operationId: `${op}_f1`, message: { role: "assistant", content: "", tool_calls: [{ id: "call_f1", type: "function", function: { name: "finish", arguments: JSON.stringify({ summary: "First try." }) } }] } });
        store.append(jobId, { type: "tool_started", contextId, operationId: "unit_f1", toolCallId: "call_f1", name: "finish" });
        store.append(jobId, { type: "tool_finished", contextId, operationId: "unit_f1", toolCallId: "call_f1", output: '{"complete":false,"missingArtifacts":[],"checks":[{"id":"desktop_artifact_structure","passed":false}]}' });
        store.append(jobId, { type: "model_finished", contextId, operationId: `${op}_f2`, message: { role: "assistant", content: "", tool_calls: [{ id: "call_f2", type: "function", function: { name: "finish", arguments: JSON.stringify({ summary: "Wrote the memo from the input; see output/report.md." }) } }] } });
        store.append(jobId, { type: "tool_started", contextId, operationId: "unit_f2", toolCallId: "call_f2", name: "finish" });
        store.append(jobId, { type: "tool_finished", contextId, operationId: "unit_f2", toolCallId: "call_f2", output: '{"complete":true,"missingArtifacts":[],"checks":[{"id":"desktop_artifact_structure","passed":true}]}' });
      }
      if (status === "completed" && args.checks.some(check => check.id === "research_claims_ledger")) store.append(jobId, { type: "claims_verified", contextId, version: 1,
        claims: [{ id: "C1", sentence: "s1", quote: "q1 long enough", context: "c1" }, { id: "C2", sentence: "s2", quote: "q2 long enough", context: "c2" }] });
      if (status === "completed") store.append(jobId, { type: "completed", contextId, snapshot, checks, verifiedSnapshotSha256: checkpoints.fingerprint(snapshot) });
      // One judge request of the entailment pass ended unknown: evidence only, it must not make the task uncertain.
      if (status === "completed" && args.checks.some(check => check.id === "research_claims_ledger")) {
        const { text: _text, ...preview } = args.broker.preview({ jobId, contextId, destinationId: "desktop_local", purpose: "claims entailment judgement", method: "POST", body: "{}", maxFeeMicrousd: 0 });
        store.unknown(store.commit({ ...preview, reservedFeeMicrousd: 0, scan: { status: "not_required_inside_boundary" } }, () => {}).id);
      }
      store.append(jobId, { type: "run_ended", contextId, cleanupConfirmed, elapsedMs: 12 });
      return { status, reason: "unit_fixture", snapshot, checks, modelCalls: executions.length };
    },
  });
  const options: GeneralTaskControllerOptions = { database: db, dataRoot: join(root, "tasks"), config: () => config,
    imageId: () => imageId, runtimeIdentity: () => runtimeIdentity, testing: { readiness: async () => {}, runnerFactory: factory } };
  const controller = new GeneralTaskController(options); cleanup.push(() => controller.close());
  const create = () => controller.create({ goal: "Make a small report.", inputSelectionId: controller.selectInputs([input]).id, outputName: "report.md", publicOrSynthetic: true });
  return { root, db, input, config, controller, options, executions, create, set failModel(value: boolean) { failModel = value; }, set narrate(value: boolean) { narrate = value; },
    set report(value: string) { report = value; },
    changeRuntime() { runtimeIdentity = digest("runtime-v2"); }, removeImage() { imageId = undefined; },
    hold() { hold = new Promise<void>(yes => { release = yes; }); }, release() { release?.(); hold = undefined; }, resetPaused() { paused = false; } };
}

async function interruptedCleanupFixture() {
  const f = fixture(false), task = f.create(); f.hold(); f.controller.start(task.id);
  await vi.waitFor(() => expect(f.executions).toHaveLength(1));
  f.controller.pause(task.id); f.release(); await f.controller.wait(task.id);
  const args = f.executions[0]!, ownerId = "old-desktop-owner";
  args.store.acquireRun(args.contextId, ownerId, "unix:///tmp/soar-unit-docker.sock", 234567);
  args.store.append(task.id, { type: "model_started", contextId: args.contextId, operationId: "unresolved-cleanup-test" });
  const pending = args.store.commit({ jobId: task.id, contextId: args.contextId, contextSha256: contextFingerprint(args.store.context(args.contextId)),
    packetSha256: digest("synthetic interrupted request"), destinationId: args.model.config.destinationId, destinationSha256: digest("synthetic destination"),
    purpose: "synthetic cleanup no-replay guard", policyRevision: 0, reservedFeeMicrousd: 0, scan: { status: "not_required_for_synthetic_local_test" } }, () => {});
  args.store.unknown(pending.id);
  return { ...f, task, args, ownerId, artifact: f.controller.get(task.id).artifacts[0]!, receipts: canonical(args.store.dispatches(task.id)) };
}

describe("desktop general-task host controller", () => {
  it("exposes all output files and exports one bound bundle without another model call", async () => {
    const f = fixture(), task = f.create(); f.controller.start(task.id); await f.controller.wait(task.id);
    const args = f.executions[0]!;
    const files = [{ path: "output/report.md", bytes: Buffer.from("Report") },
      { path: "output/assets/data.csv", bytes: Buffer.from("value\n21\n") },
      { path: "work/private-notes.txt", bytes: Buffer.from("excluded work") }, ...args.files];
    const snapshot = args.checkpoints.save(files);
    args.store.append(task.id, { type: "checkpoint", contextId: args.contextId, snapshot, sha256: args.checkpoints.fingerprint(snapshot) });
    const current = f.controller.get(task.id);
    expect(current.artifacts.map(file => file.path)).toEqual(["output/assets/data.csv", "output/report.md"]);
    expect(current.bundle).toMatchObject({ fileCount: 2, totalBytes: 15 });
    const ref = { id: task.id, manifestSha256: current.bundle!.manifestSha256 };
    const archive = f.controller.bundle(ref);
    expect(archive.bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(archive.manifestSha256).toBe(ref.manifestSha256);
    expect(f.executions).toHaveLength(1);
    expect(() => f.controller.bundle({ ...ref, manifestSha256: digest("stale") })).toThrow("general_task_bundle_stale");
    const changed = args.checkpoints.save([...files, { path: "output/style.css", bytes: Buffer.from("body{}") }]);
    args.store.append(task.id, { type: "checkpoint", contextId: args.contextId, snapshot: changed, sha256: args.checkpoints.fingerprint(changed) });
    expect(() => f.controller.bundle(ref)).toThrow("general_task_bundle_stale");
  });

  it("refuses corrupted checkpoint bytes and portable-name collisions for bundles", async () => {
    const f = fixture(), task = f.create(); f.controller.start(task.id); await f.controller.wait(task.id);
    let current = f.controller.get(task.id);
    writeFileSync(join(f.root, "tasks", "checkpoints", task.id, current.artifacts[0]!.sha256), "corrupt bytes");
    expect(() => f.controller.bundle({ id: task.id, manifestSha256: current.bundle!.manifestSha256 })).toThrow("general_task_bundle_unavailable");
    const args = f.executions[0]!, snapshot = args.checkpoints.save([
      { path: "output/A.txt", bytes: Buffer.from("one") }, { path: "output/a.txt", bytes: Buffer.from("two") }]);
    args.store.append(task.id, { type: "checkpoint", contextId: args.contextId, snapshot, sha256: args.checkpoints.fingerprint(snapshot) });
    current = f.controller.get(task.id);
    expect(current.artifacts).toHaveLength(2);
    expect(current.bundle).toBeUndefined();
    expect(current.bundleUnavailableReason).toContain("individually");
  });

  it("keeps bundle export unavailable while a task is running", async () => {
    const f = fixture(), task = f.create(); f.hold(); f.controller.start(task.id);
    try { expect(() => f.controller.bundle({ id: task.id, manifestSha256: digest("anything") })).toThrow("general_task_artifact_busy"); }
    finally { f.release(); await f.controller.wait(task.id); }
  });

  it.each(["valid", "malformed", "missing_blob", "missing_marker", "unknown"])("recovers a %s execution-progress stop without granting replay", async variant => {
    const f = fixture();
    vi.spyOn(DockerSandbox, "currentEndpoint").mockResolvedValue("unix:///tmp/synthetic-docker.sock");
    vi.spyOn(DockerSandbox, "cleanupOwnedContext").mockResolvedValue(undefined);
    vi.spyOn(DockerSandbox, "create").mockImplementation(async input => ({
      async execute() { return { exitCode: 1, stdout: "", stderr: "deterministic synthetic failure" }; },
      async listFiles() { return workspaceListing(new Map(input.files.map(file => [file.path, file.bytes]))); },
      async readFile(path: string) { return input.files.find(file => file.path === path)!.bytes; }, async close() {},
    } as unknown as DockerSandbox));
    let requests = 0;
    f.options.testing!.runnerFactory = args => {
      f.executions.push(args);
      vi.spyOn(args.model, "complete").mockImplementation(async () => {
        const { text: _text, ...preview } = args.broker.preview({ jobId: args.jobId, contextId: args.contextId,
          destinationId: "desktop_local", purpose: "scripted unit progress", method: "POST", body: "{}", maxFeeMicrousd: 0 });
        const receipt = args.store.commit({ ...preview, reservedFeeMicrousd: 0, scan: { status: "not_required_for_synthetic_local_test" } }, () => {});
        args.store.settle(receipt.id, 0, digest("synthetic response"));
        return { content: "", toolCalls: [{ id: `failure_${++requests}`, type: "function", function: { name: "execute", arguments: '{"command":"exit 1"}' } }],
          finishReason: "tool_calls", costUsd: 0, durationMs: 1 };
      });
      return new GeneralAgentRunner(args);
    };
    const task = f.create(); f.controller.start(task.id); await f.controller.wait(task.id);
    const args = f.executions[0]!, events = args.store.events(task.id);
    expect(requests).toBe(3);
    expect(events.filter(event => event.type === "tool_started")).toHaveLength(2);
    const marker = events.find(event => event.type === "model_action_not_started")!;
    expect(marker.reason).toBe(EXECUTION_PROGRESS_STOP);
    if (variant === "malformed") {
      const row = f.db.prepare("SELECT sequence FROM private_agent_events WHERE job_id = ? AND json_extract(value, '$.type') = 'model_action_not_started'").get(task.id) as { sequence: number };
      f.db.prepare("UPDATE private_agent_events SET value = ? WHERE job_id = ? AND sequence = ?").run(canonical({ ...marker, operationId: randomUUID() }), task.id, row.sequence);
    } else if (variant === "missing_blob") {
      const retained = events.find(event => event.executionCapture === "retained")!.executionObservation as { sha256: string };
      rmSync(join(f.root, "tasks", "checkpoints", task.id, retained.sha256));
    } else if (variant === "missing_marker") {
      f.db.prepare("DELETE FROM private_agent_events WHERE job_id = ? AND json_extract(value, '$.type') = 'model_action_not_started'").run(task.id);
    } else if (variant === "unknown") {
      const { text: _text, ...preview } = args.broker.preview({ jobId: task.id, contextId: args.contextId, destinationId: "desktop_local", purpose: "unknown precedence", method: "POST", body: "{}", maxFeeMicrousd: 0 });
      const receipt = args.store.commit({ ...preview, reservedFeeMicrousd: 0, scan: { status: "not_required_for_synthetic_local_test" } }, () => {});
      args.store.unknown(receipt.id);
    }
    const before = f.controller.get(task.id);
    expect(before).toMatchObject({ status: "incomplete", canResume: false, modelCalls: 3, toolCalls: 2, cleanupConfirmed: true });
    expect(before.reason).toContain(variant === "valid" ? "stopped before execution" : "uncertain outcome");
    await f.controller.close();
    if (variant === "missing_marker") {
      const row = f.db.prepare("SELECT value FROM general_tasks WHERE id = ?").get(task.id) as { value: string };
      f.db.prepare("UPDATE general_tasks SET value = ? WHERE id = ?").run(canonical({ ...JSON.parse(row.value), status: "running", reason: "running" }), task.id);
    }
    const reopened = new GeneralTaskController(f.options); cleanup.push(() => reopened.close());
    expect(reopened.get(task.id).reason).toBe(before.reason);
    expect(() => reopened.resume(task.id)).toThrow("general_task_resume_denied");
    expect(requests).toBe(3);
  });

  it.each(["valid", "malformed", "missing", "unknown"])("preserves the %s pre-dispatch size-stop classification after reopening", async variant => {
    const f = fixture();
    f.options.testing!.runnerFactory = args => ({ pause() {}, cancel() {}, async run() {
      f.executions.push(args);
      const { store, jobId, contextId, checkpoints } = args;
      const start = { type: "model_started", operationId: randomUUID(), contextId, promptProtocolSha256: digest("fixture-protocol") };
      store.append(jobId, start);
      if (variant !== "missing") store.append(jobId, { ...start, type: "model_request_not_dispatched", reason: "request_body_size_exceeded",
        dispatched: false, bodyBytes: variant === "malformed" ? 196608 : 196609, limitBytes: 196608 });
      if (variant === "unknown") {
        const { text: _text, ...preview } = args.broker.preview({ jobId, contextId, destinationId: "desktop_local", purpose: "unit unknown", method: "POST", body: "{}", maxFeeMicrousd: 0 });
        const row = store.commit({ ...preview, reservedFeeMicrousd: 0, scan: { status: "not_required_for_synthetic_local_test" } }, () => {});
        store.unknown(row.id);
      }
      const snapshot = checkpoints.save([...args.files, { path: args.contract.requiredArtifacts[0]!.path, bytes: Buffer.from("saved partial artifact") }]);
      store.append(jobId, { type: "checkpoint", contextId, snapshot, sha256: checkpoints.fingerprint(snapshot) });
      store.append(jobId, { type: "run_ended", contextId, cleanupConfirmed: true, elapsedMs: 12 });
      return { status: "incomplete", reason: "request_body_size_exceeded", snapshot, checks: [], modelCalls: 1 };
    } });
    const task = f.create(); f.controller.start(task.id); await f.controller.wait(task.id);
    const before = f.controller.get(task.id);
    expect(before).toMatchObject({ status: "incomplete", canResume: false, modelCalls: 1, toolCalls: 0, cleanupConfirmed: true });
    expect(before.reason).toContain(variant === "valid" ? "was not sent" : "uncertain outcome");
    if (variant === "valid") expect(before.reason).not.toContain("uncertain");
    await f.controller.close();
    const reopened = new GeneralTaskController(f.options); cleanup.push(() => reopened.close());
    const after = reopened.get(task.id);
    expect(after.reason).toBe(before.reason); expect(after.canResume).toBe(false);
    expect(() => reopened.resume(task.id)).toThrow("general_task_resume_denied");
    expect(f.executions).toHaveLength(1);
    expect(reopened.artifact({ id: task.id, path: after.artifacts[0]!.path, sha256: after.artifacts[0]!.sha256 }).bytes.toString()).toBe("saved partial artifact");
    expect(f.executions[0]!.store.dispatches(task.id)).toHaveLength(variant === "unknown" ? 1 : 0);
  });

  it.each([
    { reason: "packet_scan_unavailable", code: "packet_scan_failed", resumable: true, text: "scanner" },
    { reason: "model_request_denied", code: "destination_missing", resumable: false, text: "refused" },
    { reason: "model_request_denied", code: "cloud_after_assist_unknown", resumable: false, text: "refused" },
    { reason: "model_request_denied", code: "not_a_broker_code", resumable: false, text: "uncertain outcome" },
  ])("maps a pre-dispatch broker refusal ($reason, $code) to its fixed text and resumability after reopening (backlog item 3)", async ({ reason, code, resumable, text }) => {
    const f = fixture();
    f.options.testing!.runnerFactory = args => ({ pause() {}, cancel() {}, async run() {
      f.executions.push(args);
      const { store, jobId, contextId, checkpoints } = args;
      const start = { type: "model_started", operationId: randomUUID(), contextId, promptProtocolSha256: digest("fixture-protocol") };
      store.append(jobId, start);
      store.append(jobId, { ...start, type: "model_request_not_dispatched", reason: "broker_denied", dispatched: false, code });
      const snapshot = checkpoints.save([...args.files, { path: args.contract.requiredArtifacts[0]!.path, bytes: Buffer.from("saved partial artifact") }]);
      store.append(jobId, { type: "checkpoint", contextId, snapshot, sha256: checkpoints.fingerprint(snapshot) });
      store.append(jobId, { type: "run_ended", contextId, cleanupConfirmed: true, elapsedMs: 12 });
      return { status: "incomplete", reason, snapshot, checks: [], modelCalls: 1 };
    } });
    const task = f.create(); f.controller.start(task.id); await f.controller.wait(task.id);
    const before = f.controller.get(task.id);
    expect(before).toMatchObject({ status: "incomplete", canResume: resumable, modelCalls: 1, cleanupConfirmed: true });
    expect(before.reason).toContain(text);
    if (text !== "uncertain outcome") expect(before.reason).not.toContain("uncertain outcome");
    // The event summary keys on the marker's reason, whatever its code; the task's own reason is what flags a malformed marker.
    expect(before.events.find(event => event.type === "model_request_not_dispatched")!.summary).toContain("refused");
    await f.controller.close();
    const reopened = new GeneralTaskController(f.options); cleanup.push(() => reopened.close());
    expect(reopened.get(task.id)).toMatchObject({ reason: before.reason, canResume: resumable });
    if (!resumable) expect(() => reopened.resume(task.id)).toThrow("general_task_resume_denied");
    expect(f.executions).toHaveLength(1);
    expect(reopened.artifact({ id: task.id, path: before.artifacts[0]!.path, sha256: before.artifacts[0]!.sha256 }).bytes.toString()).toBe("saved partial artifact");
  });

  it("summarises a validation the host closed without a verifier result as closed, never as recorded checks or an uncertain outcome (BL-20261107-1041, 12)", async () => {
    const f = fixture();
    f.options.testing!.runnerFactory = args => ({ pause() {}, cancel() {}, async run() {
      f.executions.push(args);
      const { store, jobId, contextId, checkpoints } = args;
      const snapshot = checkpoints.save(args.files);
      store.append(jobId, { type: "checkpoint", contextId, snapshot, sha256: checkpoints.fingerprint(snapshot) });
      const operationId = randomUUID();
      store.append(jobId, { type: "host_validation_started", contextId, operationId, trigger: "model_or_tool_allowance_exhausted" });
      store.append(jobId, { type: "host_validation_finished", contextId, operationId, passed: false, checks: [], missingArtifacts: [args.contract.requiredArtifacts[0]!.path], verificationFailure: { code: "sandbox_unavailable" } });
      store.append(jobId, { type: "run_ended", contextId, cleanupConfirmed: true, elapsedMs: 12 });
      return { status: "incomplete", reason: "bounded_allowance_exhausted", snapshot, checks: [], modelCalls: 1 };
    } });
    const task = f.create(); f.controller.start(task.id); await f.controller.wait(task.id);
    const snapshot = f.controller.get(task.id);
    expect(snapshot).toMatchObject({ status: "incomplete", canResume: false, cleanupConfirmed: true });
    expect(snapshot.reason).not.toContain("uncertain");
    const summary = snapshot.events.find(event => event.type === "host_validation_finished")!.summary;
    expect(summary).toBe("The frozen artifact could not be verified; the validation is closed and nothing is uncertain.");
  });

  it.each(["valid", "malformed", "missing", "orphan", "unknown"])("preserves the %s token-admission stop without replay after reopening", async variant => {
    const f = fixture();
    f.options.testing!.runnerFactory = args => ({ pause() {}, cancel() {}, async run() {
      f.executions.push(args);
      const { store, jobId, contextId, checkpoints } = args;
      const start = { type: "model_started", operationId: randomUUID(), contextId, promptProtocolSha256: digest("fixture-protocol") };
      store.append(jobId, start);
      if (variant !== "missing") store.append(jobId, { ...start, type: "model_request_not_dispatched", reason: "local_token_admission_denied",
        ...(variant === "orphan" ? { operationId: randomUUID() } : {}), dispatched: false,
        code: variant === "malformed" ? "untrusted_detail" : "local_token_context_exceeded", bodySha256: digest("synthetic-body"), policySha256: digest("synthetic-policy") });
      if (variant === "unknown") {
        const { text: _text, ...preview } = args.broker.preview({ jobId, contextId, destinationId: "desktop_local", purpose: "unit unknown", method: "POST", body: "{}", maxFeeMicrousd: 0 });
        const row = store.commit({ ...preview, reservedFeeMicrousd: 0, scan: { status: "not_required_for_synthetic_local_test" } }, () => {});
        store.unknown(row.id);
      }
      const snapshot = checkpoints.save([...args.files, { path: args.contract.requiredArtifacts[0]!.path, bytes: Buffer.from("saved partial artifact") }]);
      store.append(jobId, { type: "checkpoint", contextId, snapshot, sha256: checkpoints.fingerprint(snapshot) });
      store.append(jobId, { type: "run_ended", contextId, cleanupConfirmed: true, elapsedMs: 12 });
      return { status: "incomplete", reason: "local_token_admission_denied", snapshot, checks: [], modelCalls: 1 };
    } });
    const task = f.create(); f.controller.start(task.id); await f.controller.wait(task.id);
    const before = f.controller.get(task.id);
    expect(before).toMatchObject({ status: "incomplete", canResume: false, modelCalls: 1, cleanupConfirmed: true });
    expect(before.reason).toContain(variant === "valid" ? "was not sent" : "uncertain outcome");
    if (variant === "valid") expect(before.reason).not.toContain("uncertain");
    await f.controller.close();
    const reopened = new GeneralTaskController(f.options); cleanup.push(() => reopened.close());
    expect(reopened.get(task.id)).toMatchObject({ reason: before.reason, canResume: false });
    expect(() => reopened.resume(task.id)).toThrow("general_task_resume_denied");
    expect(f.executions).toHaveLength(1);
    expect(f.executions[0]!.store.dispatches(task.id)).toHaveLength(variant === "unknown" ? 1 : 0);
  });

  it.each([120000, 300000, 900000, 15000])(
    "binds the profile request timeout, not the legacy configured timeout %i, without raising job or output limits", async configured => {
      const f = fixture(); f.config.vllm.timeoutMs = configured;
      const task = f.create(); f.controller.start(task.id); await f.controller.wait(task.id);
      const args = f.executions[0]!;
      const preview = args.broker.preview({ jobId: task.id, contextId: args.contextId, destinationId: "desktop_local",
        purpose: "test timeout identity", method: "POST", body: "{}", maxFeeMicrousd: 0 });
      expect(preview.destinationSha256).toBe(digest(canonical({ id: "desktop_local", kind: "local_model",
        endpoint: `${f.config.vllm.baseUrl}/chat/completions`, accountId: "owner_declared_local_server",
        credentialVersion: 1, privateDataAdmitted: false, syntheticOnly: true, maxResponseBytes: 256 * 1024, timeoutMs: 300000, maxRequestBytes: 192 * 1024 })));
      expect(args.contract).toMatchObject({ maxModelCalls: 20, maxToolCalls: 30, maxElapsedMs: 900000 });
      expect(args.model.config).toMatchObject({ maxOutputTokens: 4096, thinking: "disabled", maxRequestBytes: 192 * 1024 });
      expect(args.model.config).not.toHaveProperty("sampling");
      expect(args.store.policy(task.id)).toMatchObject({ maxRequests: 40, maxFeeMicrousd: 0 });
    });
  it("binds the heavy profile at every layer: contract, model, destination and session allowance", async () => {
    const f = fixture(); f.config.generalTaskProfile = "heavy";
    expect(await f.controller.availability()).toMatchObject({ available: true, profile: "heavy", limits: { modelCalls: 80, toolCalls: 120, elapsedMs: 5_400_000 } });
    const task = f.create(); f.controller.start(task.id); await f.controller.wait(task.id);
    const args = f.executions[0]!;
    expect(args.contract).toMatchObject({ maxModelCalls: 80, maxToolCalls: 120, maxElapsedMs: 5_400_000 });
    expect(args.model.config).toMatchObject({ maxOutputTokens: 16_384, thinking: "medium", maxRequestBytes: 640 * 1024, sampling: { temperature: 1, top_p: 0.95, top_k: 20 } });
    expect(args.store.policy(task.id)).toMatchObject({ maxRequests: 200, maxFeeMicrousd: 0 });
    const preview = args.broker.preview({ jobId: task.id, contextId: args.contextId, destinationId: "desktop_local",
      purpose: "test timeout identity", method: "POST", body: "{}", maxFeeMicrousd: 0 });
    expect(preview.destinationSha256).toBe(digest(canonical({ id: "desktop_local", kind: "local_model",
      endpoint: `${f.config.vllm.baseUrl}/chat/completions`, accountId: "owner_declared_local_server",
      credentialVersion: 1, privateDataAdmitted: false, syntheticOnly: true, maxResponseBytes: 256 * 1024, timeoutMs: 900_000, maxRequestBytes: 640 * 1024 })));
    expect(f.controller.get(task.id)).toMatchObject({ status: "submitted" });
  });
  it("shows a research submission's host flags in its timeline and its reported issues, and says when they were not recorded (backlog item 7(d), part C)", async () => {
    const f = fixture(), url = "https://public.example.test/facts";
    const research = () => f.controller.create({ goal: "Summarize the source.", inputSelectionId: f.controller.selectInputs([f.input]).id, outputName: "memo.md", publicOrSynthetic: true,
      publicSources: { urls: [url], allowPublicRetrieval: true, dnsResolver: "system" } });
    // The report the session's host flags pass scans (7d.B): one uncited absence claim on its second line.
    f.report = "# Findings\nNone of the sources quantify the cost.";
    const flagged = research(); f.controller.start(flagged.id); await f.controller.wait(flagged.id);
    const view = f.controller.get(flagged.id);
    expect(view.status).toBe("submitted");
    expect(view.events.find(event => event.type === "host_flags")?.summary).toBe("Host flags recorded for the owner's attention; they decide nothing.");
    expect(view.reportedIssues).toContain("1 sentence of the report, at line 2, asserts that the sources lack something (absence rules v1); it cites no claim.");
    // A research submission whose event was lost says so; silence would read as "no flags".
    const append = PrivateAgentStore.prototype.append;
    const spy = vi.spyOn(PrivateAgentStore.prototype, "append").mockImplementation(function (this: PrivateAgentStore, jobId: string, event: Record<string, unknown>) {
      if (event.type === "host_flags") throw new Error("store unavailable");
      return append.call(this, jobId, event);
    });
    try {
      const lost = research(); f.controller.start(lost.id); await f.controller.wait(lost.id);
      expect(f.controller.get(lost.id)).toMatchObject({ status: "submitted" });
      expect(f.controller.get(lost.id).events.some(event => event.type === "host_flags")).toBe(false);
      expect(f.controller.get(lost.id).reportedIssues).toContain("The host flags of this submission were not recorded.");
    } finally { spy.mockRestore(); }
    // A plain task requires neither check, so no event is expected and no line is given.
    const plain = f.create(); f.controller.start(plain.id); await f.controller.wait(plain.id);
    expect(f.controller.get(plain.id).events.some(event => event.type === "host_flags")).toBe(false);
    expect(f.controller.get(plain.id).reportedIssues).toEqual([]);
  });
  it("requires a host-checked claims ledger for research tasks with exact public sources", async () => {
    const f = fixture();
    const url = "https://public.example.test/facts";
    const task = f.controller.create({ goal: "Summarize the source.", inputSelectionId: f.controller.selectInputs([f.input]).id, outputName: "memo.md", publicOrSynthetic: true,
      publicSources: { urls: [url], allowPublicRetrieval: true, dnsResolver: "system" } });
    f.controller.start(task.id); await f.controller.wait(task.id);
    const args = f.executions[0]!;
    expect(args.contract.requiredArtifacts.map(artifact => artifact.path)).toEqual(["output/memo.md", "output/claims.json"]);
    expect(args.contract.requiredChecks).toEqual(["desktop_artifact_structure", "research_claims_ledger"]);
    expect(args.checks.map(check => check.id)).toEqual(["research_claims_ledger", "desktop_artifact_structure"]);
    expect(args.contract.goal).toContain("Claims ledger requirement");
    expect(args.contract.goal).toContain(url);
    // Public sources are cited by their retrieved URL and resolved by the host at check time; no workspace path is promised in advance.
    expect(args.contract.goal).toContain("exact url that fetch_public reported");
    expect(args.contract.goal).not.toMatch(/sources\/[a-f0-9]{16}\.bin/u);
    // The host's verdicts reach the task snapshot as evidence with a summary line; a plain task has none; an unknown judge dispatch leaves the task submitted.
    expect(f.controller.get(task.id).status).toBe("submitted");
    // No judge is reachable in this fixture: the pass records every claim as not judged and the task is still submitted with the evidence attached.
    expect(f.controller.get(task.id).entailment).toMatchObject({ counts: { supported: 0, not_judged: 2 }, truncated: true, claims: [{ id: "C1", verdict: "not_judged" }, { id: "C2", verdict: "not_judged" }] });
    expect(f.controller.get(task.id).events.some(event => event.type === "claims_entailment" && event.summary.includes("judged by the local model"))).toBe(true);
    const plain = f.create(); f.controller.start(plain.id); await f.controller.wait(plain.id);
    expect(f.executions[1]!.contract.requiredChecks).toEqual(["desktop_artifact_structure"]);
    expect(f.controller.get(plain.id).entailment).toBeUndefined();
    // The claims check reads the deliverable for citations and headings, so a research task needs a document deliverable.
    expect(() => f.controller.create({ goal: "Summarize the source.", inputSelectionId: f.controller.selectInputs([f.input]).id, outputName: "deck.pptx", publicOrSynthetic: true,
      publicSources: { urls: [url], allowPublicRetrieval: true, dnsResolver: "system" } })).toThrow("general_task_research_output_unsupported");
  });
  it("keeps a submitted research task submitted when the deadline timer fires during the evidence pass, and pauses the pass on request", async () => {
    const f = fixture();
    const url = "https://public.example.test/facts";
    const research = () => f.controller.create({ goal: "Summarize the source.", inputSelectionId: f.controller.selectInputs([f.input]).id, outputName: "memo.md", publicOrSynthetic: true,
      publicSources: { urls: [url], allowPublicRetrieval: true, dnsResolver: "system" } });
    // The desktop's deadline timer aborting mid-pass only shortens the pass: submission was already durable.
    const aborted = research();
    let spy = vi.spyOn(PrivateAgentModel.prototype, "complete").mockImplementation(async () => {
      (f.controller as unknown as { active: Map<string, { abort: AbortController }> }).active.get(aborted.id)!.abort.abort();
      throw new Error("aborted");
    });
    try {
      f.controller.start(aborted.id); await f.controller.wait(aborted.id);
      expect(f.controller.get(aborted.id)).toMatchObject({ status: "submitted", entailment: { truncated: true, counts: { not_judged: 2 } } });
    } finally { spy.mockRestore(); }
    // A pause during the pass leaves the task paused and resumable; the resume judges and submits.
    const paused = research(); let calls = 0;
    spy = vi.spyOn(PrivateAgentModel.prototype, "complete").mockImplementation(async () => {
      calls++; if (calls === 1) f.controller.pause(paused.id);
      return { content: '{"verdict":"supported"}', toolCalls: [], finishReason: "stop", costUsd: 0, durationMs: 1 };
    });
    try {
      f.controller.start(paused.id); await f.controller.wait(paused.id);
      expect(f.controller.get(paused.id)).toMatchObject({ status: "paused", canResume: true }); expect(f.controller.get(paused.id).entailment).toBeUndefined();
      f.controller.resume(paused.id); await f.controller.wait(paused.id);
      expect(f.controller.get(paused.id)).toMatchObject({ status: "submitted", entailment: { truncated: false, entailmentCalls: 2, counts: { supported: 2 } } });
    } finally { spy.mockRestore(); }
  });
  it("treats a confirmed model-request failure as resumable and a resolved failed dispatch as settled evidence", async () => {
    const f = fixture();
    f.failModel = true;
    const task = f.create(); f.controller.start(task.id); await f.controller.wait(task.id);
    expect(f.controller.get(task.id)).toMatchObject({ status: "incomplete", canResume: true, reason: expect.stringContaining("could not be reached") });
    expect(f.controller.get(task.id).events.some(event => event.type === "model_request_failed")).toBe(true);
    f.failModel = false;
    f.controller.resume(task.id); await f.controller.wait(task.id);
    expect(f.controller.get(task.id).status).toBe("submitted");
  });
  it("projects the agent's plan, one line per action and the finish summary as untrusted text, and reports host-derived issues on a submission", async () => {
    const f = fixture(); f.narrate = true;
    const task = f.create(); f.controller.start(task.id); await f.controller.wait(task.id);
    const view = f.controller.get(task.id);
    expect(view).toMatchObject({ status: "submitted", plan: "1. Read the input. 2. Write the memo.", finishSummary: "Wrote the memo from the input; see output/report.md." });
    expect(view.events.filter(event => event.detail).map(event => event.detail)).toEqual(["execute: python3 compute.py --all", "finish: First try.", "finish: Wrote the memo from the input; see output/report.md."]);
    expect(view.reportedIssues).toEqual(["1 finish attempt failed the host checks before the final one passed."]);
    // A clean run carries no issues and no projected text.
    f.narrate = false;
    const plain = f.create(); f.controller.start(plain.id); await f.controller.wait(plain.id);
    expect(f.controller.get(plain.id)).toMatchObject({ status: "submitted", reportedIssues: [] });
    expect(f.controller.get(plain.id).plan).toBeUndefined(); expect(f.controller.get(plain.id).finishSummary).toBeUndefined();
  });
  it("binds a per-task profile into the contract and the identity, and advertises the profiles and the Labs flag", async () => {
    const f = fixture();
    const heavy = f.controller.create({ goal: "Make a small report.", inputSelectionId: f.controller.selectInputs([f.input]).id, outputName: "report.md", publicOrSynthetic: true, profile: "heavy" });
    f.controller.start(heavy.id); await f.controller.wait(heavy.id);
    expect(f.executions[0]!.contract).toMatchObject({ maxModelCalls: 80, maxToolCalls: 120, maxElapsedMs: 5_400_000 });
    expect(f.controller.get(heavy.id)).toMatchObject({ status: "submitted", profile: "heavy" });
    const standard = f.create(); f.controller.start(standard.id); await f.controller.wait(standard.id);
    expect(f.executions[1]!.contract.maxModelCalls).toBe(20); expect(f.controller.get(standard.id).profile).toBeUndefined();
    const availability = await f.controller.availability();
    expect(availability).toMatchObject({ profile: "standard", profiles: ["standard", "heavy"], labs: false });
    f.config.labsEnabled = true;
    expect((await f.controller.availability()).labs).toBe(true);
  });
  it("reports activity once when the first task starts and once when the last ends, and streams the local model when enabled", async () => {
    const f = fixture(); const activity: boolean[] = [];
    const controller = new GeneralTaskController({ ...f.options, onActivity: active => activity.push(active) });
    try {
      const a = controller.create({ goal: "Make a small report.", inputSelectionId: controller.selectInputs([f.input]).id, outputName: "report.md", publicOrSynthetic: true });
      controller.start(a.id); expect(controller.busy()).toBe(true); await controller.wait(a.id);
      expect(activity).toEqual([true, false]); expect(controller.busy()).toBe(false);
      expect(f.executions.at(-1)!.model.config).not.toHaveProperty("streaming");
      f.config.streamingEnabled = true;
      const b = controller.create({ goal: "Make a small report.", inputSelectionId: controller.selectInputs([f.input]).id, outputName: "report.md", publicOrSynthetic: true });
      controller.start(b.id); await controller.wait(b.id);
      expect(f.executions.at(-1)!.model.config).toMatchObject({ streaming: true });
    } finally { controller.close(); }
  });
  it("H2a: salts the owned server's prefix cache per job only when switched on, and the switch changes the task's configuration identity", async () => {
    const f = fixture(); f.config.promptCacheSalt = false;
    const a = f.create(); f.controller.start(a.id); await f.controller.wait(a.id);
    expect(f.executions.at(-1)!.model.config).not.toHaveProperty("promptCaching");
    f.config.promptCacheSalt = true;
    const b = f.create(); f.controller.start(b.id); await f.controller.wait(b.id);
    expect(f.executions.at(-1)!.model.config).toMatchObject({ promptCaching: "vllm_job_salt_v1" });
    // A task created under the other setting no longer matches its recorded configuration: an explicit, visible refusal, never a silent change.
    const c = f.create(); f.config.promptCacheSalt = false;
    expect(() => f.controller.start(c.id)).toThrow("general_task_configuration_changed");
  });
  it("uses the explicit local reply contract and refuses a task created under the other contract", async () => {
    const f = fixture(); f.config.vllm.model = "qwen3.8-flash-next";
    const legacy = f.create(); f.controller.start(legacy.id); await f.controller.wait(legacy.id);
    expect(f.executions.at(-1)!.model.config).not.toHaveProperty("localReplyContract");
    const queuedLegacy = f.create();
    f.config.vllm.localReplyContract = "flash_next_v1";
    f.config.vllm.localContextTokens = 262_144;
    expect(() => f.controller.start(queuedLegacy.id)).toThrow("general_task_configuration_changed");
    const optedIn = f.create(); f.controller.start(optedIn.id); await f.controller.wait(optedIn.id);
    expect(f.executions.at(-1)!.model.config).toHaveProperty("localReplyContract", "flash_next_v1");
    expect(f.executions.at(-1)!.model.config).toHaveProperty("localContextTokens", 262_144);
    const queuedContext = f.create(); f.config.vllm.localContextTokens = 131_072;
    expect(() => f.controller.start(queuedContext.id)).toThrow("general_task_configuration_changed");
    f.config.vllm.localContextTokens = 262_144;
    const queuedOptIn = f.create(); delete f.config.vllm.localReplyContract; delete f.config.vllm.localContextTokens;
    expect(() => f.controller.start(queuedOptIn.id)).toThrow("general_task_configuration_changed");
  });
  it("resumes a task paused before streaming was switched on, and streams from then on", async () => {
    const f = fixture(); f.config.streamingEnabled = false;
    const task = f.create(); f.hold(); f.controller.start(task.id);
    await vi.waitFor(() => expect(f.executions).toHaveLength(1));
    f.controller.pause(task.id); f.release(); await f.controller.wait(task.id);
    expect(f.controller.get(task.id).status).toBe("paused");
    f.config.streamingEnabled = true; f.resetPaused();
    f.controller.resume(task.id); await f.controller.wait(task.id);
    expect(f.controller.get(task.id).status).toBe("submitted");
    expect(f.executions[1]!.model.config).toMatchObject({ streaming: true });
  });
  it("refuses queued tasks when the exact-token policy identity changes before dispatch", () => {
    const f = fixture();
    f.config.vllm.localReplyContract = "flash_next_v1"; f.config.vllm.localContextTokens = 262_144;
    const withoutPolicy = f.create();
    f.config.vllm.localTokenAdmission = { path: join(tmpdir(), "synthetic-admission.json"), sha256: "a".repeat(64) };
    expect(() => f.controller.start(withoutPolicy.id)).toThrow("general_task_configuration_changed");
    const bound = f.create(); f.config.vllm.localTokenAdmission.sha256 = "b".repeat(64);
    expect(() => f.controller.start(bound.id)).toThrow("general_task_configuration_changed");
    expect(f.executions).toHaveLength(0);
  });
  it("loads the pinned token policy into the desktop broker and binds it into the task model", async () => {
    const f = fixture(); f.config.vllm.model = "qwen3.8-flash-next";
    const policy = flashNextAdmissionFixture({ endpoint: `${f.config.vllm.baseUrl}/chat/completions`, model: f.config.vllm.model, contextTokens: 262_144 });
    cleanup.push(policy.cleanup);
    f.config.vllm.localReplyContract = "flash_next_v1"; f.config.vllm.localContextTokens = 262_144;
    f.config.vllm.localTokenAdmission = policy.descriptor;
    const task = f.create(); f.controller.start(task.id); await f.controller.wait(task.id);
    expect(f.executions).toHaveLength(1);
    expect(f.executions[0]!.model.config.localTokenAdmissionSha256).toBe(policy.descriptor.sha256);
    expect(f.controller.get(task.id).status).toBe("submitted");
  });
  it("records a late heartbeat against the running task as a host_heartbeat event", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    try {
      const f = fixture(); const task = f.create(); f.hold(); f.controller.start(task.id);
      await vi.waitFor(() => expect(f.executions).toHaveLength(1));
      // The wall clock jumps 90 s past the schedule (the machine slept); the monotonic clock did not move.
      vi.setSystemTime(Date.now() + 90_000); vi.advanceTimersByTime(30_000);
      const late = f.executions[0]!.store.events(task.id).filter(event => event.type === "host_heartbeat");
      expect(late).toHaveLength(1);
      expect(late[0]).toMatchObject({ contextId: f.executions[0]!.contextId, wallLateMs: 90_000, monotonicLateMs: 0 });
      vi.advanceTimersByTime(30_000);
      expect(f.executions[0]!.store.events(task.id).filter(event => event.type === "host_heartbeat")).toHaveLength(1);
      f.release(); await f.controller.wait(task.id);
      expect(f.controller.get(task.id).status).toBe("submitted");
    } finally { vi.useRealTimers(); }
  });
  it("refuses a queued task after the coordinator profile changes", () => {
    const f = fixture();
    const task = f.create(); f.config.generalTaskProfile = "heavy";
    expect(() => f.controller.start(task.id)).toThrow("general_task_configuration_changed");
    expect(f.executions).toEqual([]);
  });
  it("does not resume a paused task under a different profile or reset its deadline", async () => {
    const f = fixture();
    const task = f.create(); f.hold(); f.controller.start(task.id);
    await vi.waitFor(() => expect(f.executions).toHaveLength(1));
    f.controller.pause(task.id); f.release(); await f.controller.wait(task.id);
    const paused = f.controller.get(task.id); f.config.generalTaskProfile = "heavy";
    expect(() => f.controller.resume(task.id)).toThrow("general_task_configuration_changed");
    expect(f.controller.get(task.id)).toMatchObject({ status: "paused", modelCalls: paused.modelCalls, elapsedMs: paused.elapsedMs });
    expect(f.executions).toHaveLength(1);
  });
  it("starts a goal-only task with an empty immutable input manifest and no web tool", async () => {
    const f = fixture(), task = f.controller.create({ goal: "Make a self-contained HTML page.", outputName: "index.html", publicOrSynthetic: true });
    expect(task.inputs).toEqual([]); expect(task.network).toBeUndefined();
    f.controller.start(task.id); await f.controller.wait(task.id);
    expect(f.executions[0]!.files).toEqual([]); expect(f.executions[0]!.webDestinations).toBeUndefined();
    expect(f.controller.get(task.id)).toMatchObject({ status: "submitted", cleanupConfirmed: true });
  });
  it("a URL in the goal grants no network authority", async () => {
    const f = fixture(), task = f.controller.create({ goal: "Summarize https://example.com/source if permitted.", outputName: "report.md", publicOrSynthetic: true });
    f.controller.start(task.id); await f.controller.wait(task.id);
    expect(f.executions[0]!.store.policy(task.id).destinations).toEqual(["desktop_local"]);
    expect(f.executions[0]!.webDestinations).toBeUndefined();
  });
  it.each([
    ["system", true, "https://example.com/data", true],
    ["cloudflare_v1", true, "https://example.com/data", false],
    ["system", false, "https://example.com/data", false],
    ["system", true, "https://1.1.1.1/data", false],
  ] as const)("applies the fake-IP proxy opt-in only to a hostname source on the system resolver (%s, opt-in %s, %s)", async (dnsResolver, optIn, url, expected) => {
    const f = fixture(); f.config.proxyFakeIp = optIn;
    const publicSources = { urls: [url], allowPublicRetrieval: true as const, dnsResolver };
    const task = f.controller.create({ goal: "Research the admitted public source.", outputName: "report.md", publicOrSynthetic: true, publicSources });
    f.controller.start(task.id); await f.controller.wait(task.id);
    expect(f.executions).toHaveLength(1);
    const destinations = (f.executions[0]!.broker as unknown as { destinations: Map<string, BrokerDestination> }).destinations;
    expect(Object.hasOwn(destinations.get("desktop_web_1")!, "proxyFakeIp")).toBe(expected);
    expect(destinations.get("desktop_local")).not.toHaveProperty("proxyFakeIp");
  });
  it("freezes explicit exact sources and makes the primary context public without host paths", async () => {
    const f = fixture(), publicSources = { urls: ["https://example.com/data?q=one"], allowPublicRetrieval: true as const, dnsResolver: "system" as const };
    const task = f.controller.create({ goal: "Research the admitted public source.", outputName: "report.md", publicOrSynthetic: true, publicSources });
    publicSources.urls[0] = "https://example.com/changed";
    expect(task.network).toEqual({ urls: ["https://example.com/data?q=one"], dnsResolver: "system", maxFetches: 5, maxResponseBytes: 65536 });
    expect(task.sources).toEqual([]); expect(task.publicFetches).toBe(0);
    f.controller.start(task.id); await f.controller.wait(task.id);
    const args = f.executions[0]!;
    expect(args.webDestinations).toEqual(["desktop_web_1"]);
    expect(args.contract.goal).toContain("https://example.com/data?q=one");
    expect(args.store.context(args.contextId).sources.every(source => source.classification === "public")).toBe(true);
    expect(args.store.policy(task.id).destinations).toEqual(["desktop_local", "desktop_web_1"]);
    expect(canonical(f.controller.get(task.id))).not.toContain(f.root);
    expect(() => args.broker.preview({ jobId: task.id, contextId: args.contextId, destinationId: "desktop_web_1", purpose: "public source retrieval",
      method: "GET", url: "https://example.com/unlisted", maxFeeMicrousd: 0 })).toThrow("packet_destination_drift");
    args.store.append(task.id, { type: "tool_started", contextId: args.contextId, operationId: "rejected_fetch", name: "fetch_public" });
    args.store.append(task.id, { type: "tool_finished", contextId: args.contextId, operationId: "rejected_fetch", output: "not admitted" });
    expect(f.controller.get(task.id)).toMatchObject({ toolCalls: 1, publicFetches: 0 });
  });
  it.each([
    { urls: ["https://example.com"], allowPublicRetrieval: false, dnsResolver: "system" },
    { urls: ["https://example.com"], allowPublicRetrieval: true },
    { urls: ["http://example.com"], allowPublicRetrieval: true, dnsResolver: "system" },
    { urls: ["https://name:password@example.com"], allowPublicRetrieval: true, dnsResolver: "system" },
    { urls: ["https://example.com/#"], allowPublicRetrieval: true, dnsResolver: "system" },
    { urls: ["https://127.0.0.1/"], allowPublicRetrieval: true, dnsResolver: "system" },
    { urls: ["https://192.0.2.1/"], allowPublicRetrieval: true, dnsResolver: "system" },
    { urls: ["https://server.local/"], allowPublicRetrieval: true, dnsResolver: "system" },
    { urls: ["https://example.com", "https://example.com/"], allowPublicRetrieval: true, dnsResolver: "system" },
    { urls: ["https://example.com/one", "https://example.com/two", "https://example.com/three", "https://example.com/four"], allowPublicRetrieval: true, dnsResolver: "system" },
  ])("rejects missing consent and invalid public authority before any execution: %j", publicSources => {
    const f = fixture();
    expect(() => f.controller.create({ goal: "Research.", outputName: "report.md", publicOrSynthetic: true, publicSources } as never)).toThrow();
    expect(f.controller.list()).toEqual([]); expect(f.executions).toEqual([]);
  });
  it.each(["url", "resolver"])("detects persisted %s permission drift before a runner starts", changed => {
    const f = fixture(), task = f.controller.create({ goal: "Research.", outputName: "report.md", publicOrSynthetic: true,
      publicSources: { urls: ["https://example.com/source"], allowPublicRetrieval: true, dnsResolver: "system" } });
    const record = JSON.parse((f.db.prepare("SELECT value FROM general_tasks WHERE id=?").get(task.id) as { value: string }).value);
    if (changed === "url") record.publicSources.urls[0] = "https://example.com/other";
    else record.publicSources.dnsResolver = "cloudflare_v1";
    f.db.prepare("UPDATE general_tasks SET value=? WHERE id=?").run(canonical(record), task.id);
    f.controller.start(task.id);
    return f.controller.wait(task.id).then(() => { expect(f.executions).toEqual([]); expect(f.controller.get(task.id).status).toBe("incomplete"); });
  });
  it("reads a legacy v1 task as offline without rewriting its frozen phase or granting retrieval", async () => {
    const f = fixture(), task = f.create();
    const record = JSON.parse((f.db.prepare("SELECT value FROM general_tasks WHERE id=?").get(task.id) as { value: string }).value);
    record.version = 1;
    record.attestationIdentity = digest(canonical({ publicOrSynthetic: true, goal: record.goal, phaseIdentity: record.phaseIdentity, inputSnapshot: record.inputSnapshot }));
    f.db.prepare("UPDATE general_tasks SET value=? WHERE id=?").run(canonical(record), task.id);
    expect(f.controller.get(task.id).network).toBeUndefined();
    f.controller.start(task.id); await f.controller.wait(task.id);
    expect(f.controller.get(task.id).status).toBe("submitted");
    expect(f.executions[0]!.webDestinations).toBeUndefined();
    const after = JSON.parse((f.db.prepare("SELECT value FROM general_tasks WHERE id=?").get(task.id) as { value: string }).value);
    expect(after.version).toBe(1); expect(after.phaseIdentity).toBe(record.phaseIdentity); expect(after.attestationIdentity).toBe(record.attestationIdentity);
  });
  it("copies native-selected bytes before create, uses one selection once and exposes no host path", async () => {
    const f = fixture(), selection = f.controller.selectInputs([f.input]);
    writeFileSync(f.input, "changed after selection");
    const task = f.controller.create({ goal: "Report.", inputSelectionId: selection.id, outputName: "report.md", publicOrSynthetic: true });
    expect(task.inputs[0]).toMatchObject({ path: "input/01-source.csv", sha256: digest("value\n21\n") });
    expect(canonical(task)).not.toContain(f.root);
    expect(() => f.controller.create({ goal: "Again.", inputSelectionId: selection.id, outputName: "x.md", publicOrSynthetic: true })).toThrow("selection_expired");
    f.controller.start(task.id); await f.controller.wait(task.id);
    expect(f.executions[0]!.files[0]!.bytes.toString()).toBe("value\n21\n");
    expect(f.executions[0]!.contract).toMatchObject({ maxModelCalls: 20, maxToolCalls: 30, maxElapsedMs: 900000 });
    expect(f.executions[0]!.model.config).toMatchObject({ maxOutputTokens: 4096, inputUsdPerMillion: 0, outputUsdPerMillion: 0 });
  });
  it("rejects renderer-supplied paths/check code, absent attestation and dangerous output names", () => {
    const f = fixture(), selection = f.controller.selectInputs([f.input]);
    const input = { goal: "Report.", inputSelectionId: selection.id, outputName: "report.md", publicOrSynthetic: true as const };
    expect(() => f.controller.create({ ...input, workspaceRoot: f.root } as never)).toThrow();
    expect(() => f.controller.create({ ...input, checks: [{ python: "pass" }] } as never)).toThrow();
    expect(() => f.controller.create({ ...input, publicOrSynthetic: false } as never)).toThrow();
    expect(() => f.controller.create({ ...input, outputName: "../outside" })).toThrow();
    expect(f.executions).toEqual([]);
  });
  it("rejects symlinks, hardlinks, aggregate over-limit inputs and known credential material", () => {
    const f = fixture(), symbolic = join(f.root, "symbolic"), hard = join(f.root, "hard");
    symlinkSync(f.input, symbolic); expect(() => f.controller.selectInputs([symbolic])).toThrow();
    linkSync(f.input, hard); expect(() => f.controller.selectInputs([hard])).toThrow();
    const huge = join(f.root, "huge"); writeFileSync(huge, Buffer.alloc(16 * 1024 * 1024 + 1));
    expect(() => f.controller.selectInputs([huge])).toThrow("input_limit");
    const credential = join(f.root, "credential.txt"); writeFileSync(credential, `ghp_${"a".repeat(36)}`);
    expect(() => f.controller.selectInputs([credential])).toThrow("credential_input_denied");
    expect(f.controller.list()).toEqual([]);
  });
  it("rejects a selected FIFO without waiting for a writer", () => {
    const f = fixture(), fifo = join(f.root, "selected-pipe"); execFileSync("mkfifo", [fifo], { timeout: 1000 });
    expect(() => f.controller.selectInputs([fifo])).toThrow("input_limit");
  });
  it("returns fixed import errors without exposing native paths", () => {
    const f = fixture(); rmSync(f.input);
    expect(() => f.controller.selectInputs([f.input])).toThrow(/^general_task_input_unavailable$/u);
  });
  it("rejects a symlink storage root and a replaced checkpoint parent", () => {
    const f = fixture(), alias = join(f.root, "alias"); symlinkSync(join(f.root, "tasks"), alias);
    expect(() => new GeneralTaskController({ ...f.options, dataRoot: alias })).toThrow("storage_invalid");
    const task = f.create(), checkpointRoot = join(f.root, "tasks", "checkpoints");
    renameSync(checkpointRoot, `${checkpointRoot}-old`); symlinkSync(`${checkpointRoot}-old`, checkpointRoot);
    expect(() => f.controller.selectInputs([f.input])).toThrow("storage_changed");
    expect(task.inputs).toHaveLength(1);
  });
  it.each(["runtime", "endpoint", "model", "image"])("stops %s drift before starting an execution", kind => {
    const f = fixture(), task = f.create();
    if (kind === "runtime") f.changeRuntime();
    if (kind === "endpoint") f.config.vllm.baseUrl = "http://127.0.0.1:8888/v1";
    if (kind === "model") f.config.vllm.model = "changed";
    if (kind === "image") f.removeImage();
    expect(() => f.controller.start(task.id)).toThrow(); expect(f.executions).toEqual([]);
    expect(f.db.prepare("SELECT count(*) AS n FROM private_agent_dispatches").get()).toEqual({ n: 0 });
  });
  it("permits credential rotation without disclosing either credential in the UI projection", async () => {
    const f = fixture(), task = f.create(); f.config.vllm.apiKey = "host-key-b";
    f.controller.start(task.id); await f.controller.wait(task.id);
    const final = f.controller.get(task.id);
    expect(final).toMatchObject({ status: "submitted", independentAcceptance: "not_evaluated", cleanupConfirmed: true });
    expect(canonical(final)).not.toContain("host-key"); expect(canonical(final)).not.toContain("127.0.0.1");
  });
  it("serves only the exact saved artifact and rejects stale hashes and tampered blobs", async () => {
    const f = fixture(), task = f.create(); f.controller.start(task.id); await f.controller.wait(task.id);
    const ref = f.controller.get(task.id).artifacts[0]!;
    expect(f.controller.artifact({ id: task.id, path: ref.path, sha256: ref.sha256 }).bytes.toString()).toBe("unit artifact");
    expect(() => f.controller.artifact({ id: task.id, path: ref.path, sha256: digest("other") })).toThrow("artifact_stale");
    expect(() => f.controller.artifact({ id: task.id, path: "output/../input/source.csv", sha256: ref.sha256 })).toThrow();
    writeFileSync(join(f.root, "tasks", "checkpoints", task.id, ref.sha256), "corrupted");
    expect(() => f.controller.artifact({ id: task.id, path: ref.path, sha256: ref.sha256 })).toThrow();
    rmSync(join(f.root, "tasks", "checkpoints", task.id, ref.sha256));
    expect(() => f.controller.artifact({ id: task.id, path: ref.path, sha256: ref.sha256 })).toThrow(/^general_task_artifact_unavailable$/u);
  });
  it("pauses at an action boundary and reconstructs the same phase and counters after reopening", async () => {
    const f = fixture(), task = f.create(); f.hold(); f.controller.start(task.id);
    await vi.waitFor(() => expect(f.executions).toHaveLength(1));
    f.controller.pause(task.id); f.release(); await f.controller.wait(task.id);
    const paused = f.controller.get(task.id); expect(paused).toMatchObject({ status: "paused", canResume: true, modelCalls: 1 });
    const before = JSON.parse((f.db.prepare("SELECT value FROM general_tasks WHERE id=?").get(task.id) as { value: string }).value);
    await f.controller.close(); f.resetPaused();
    const reopened = new Database(join(f.root, "desktop.sqlite")); cleanup.push(() => { reopened.close(); });
    const second = new GeneralTaskController({ ...f.options, database: reopened }); cleanup.push(() => second.close());
    second.resume(task.id); await second.wait(task.id);
    expect(second.get(task.id)).toMatchObject({ status: "submitted", modelCalls: 2, canResume: false });
    const after = JSON.parse((reopened.prepare("SELECT value FROM general_tasks WHERE id=?").get(task.id) as { value: string }).value);
    expect(after.startedAt).toBe(before.startedAt); expect(after.phaseIdentity).toBe(before.phaseIdentity);
  });
  it("keeps a paused task resumable past a skipped assist row, but not past any other unknown row (backlog item 10)", async () => {
    const f = fixture(), task = f.create(); f.hold(); f.controller.start(task.id);
    await vi.waitFor(() => expect(f.executions).toHaveLength(1)); f.controller.pause(task.id); f.release(); await f.controller.wait(task.id);
    const args = f.executions[0]!;
    // The reading stage's context, where a sealed cloud one-shot's row would sit; the writer's own context is args.contextId.
    args.store.createContext({ id: "reader", jobId: task.id, sources: [{ id: "corpus", version: digest("synthetic corpus"), classification: "public", synthetic: true }] });
    const unknownRow = (purpose: string, contextId: string) => {
      const { text: _packet, ...preview } = args.broker.preview({ jobId: task.id, contextId, destinationId: "desktop_local", purpose: "agent reasoning and tool selection", method: "POST", body: "{}", maxFeeMicrousd: 0 });
      args.store.unknown(args.store.commit({ ...preview, purpose, reservedFeeMicrousd: 0, scan: { status: "not_required_for_synthetic_local_test" } }, () => {}).id);
    };
    unknownRow("research synthesis assist", "reader");
    expect(f.controller.get(task.id)).toMatchObject({ status: "paused", canResume: true, reason: "Paused with progress saved." });
    unknownRow("agent reasoning and tool selection", args.contextId);
    const blocked = f.controller.get(task.id);
    expect(blocked.reason).toContain("uncertain"); expect(blocked.canResume).toBe(false);
    // The text describes the row that blocks, never the skipped assist.
    expect(blocked.reason).toContain("Resume is blocked");
  });
  it("never resumes an unknown dispatch or cancelled task", async () => {
    const f = fixture(), task = f.create(); f.hold(); f.controller.start(task.id);
    await vi.waitFor(() => expect(f.executions).toHaveLength(1)); f.controller.pause(task.id); f.release(); await f.controller.wait(task.id);
    f.executions[0]!.store.append(task.id, { type: "model_started", contextId: f.executions[0]!.contextId, operationId: "uncertain" });
    expect(f.controller.get(task.id).reason).toContain("uncertain outcome");
    expect(f.controller.get(task.id).canResume).toBe(false); expect(() => f.controller.resume(task.id)).toThrow("resume_denied");
    f.controller.cancel(task.id); expect(() => f.controller.resume(task.id)).toThrow("resume_denied");
    expect(f.executions).toHaveLength(1);
  });
  it.each([
    ["transport", "request_timeout", "configured limit of 300 seconds"],
    ["transport", "cancelled", "cancelled after dispatch"],
    ["transport", "http_rejected", "unsuccessful HTTP response"],
    ["transport", "response_oversize", "admitted size limit"],
    ["transport", "transport_failed", "transport failed"],
    ["settlement", "response_or_usage_invalid", "usage could not be validated"],
    ["settlement", "fee_settlement_failed", "charge could not be verified"],
  ] as const)("explains %s/%s from safe retained diagnostics without permitting replay", async (phase, code, text) => {
    const f = fixture(), task = f.create(); f.hold(); f.controller.start(task.id);
    await vi.waitFor(() => expect(f.executions).toHaveLength(1));
    f.controller.pause(task.id); f.release(); await f.controller.wait(task.id);
    const args = f.executions[0]!;
    const { text: _packet, ...preview } = args.broker.preview({ jobId: task.id, contextId: args.contextId,
      destinationId: "desktop_local", purpose: "synthetic diagnostic", method: "POST", body: "{}", maxFeeMicrousd: 0 });
    const receipt = args.store.commit({ ...preview, reservedFeeMicrousd: 0, scan: { status: "not_required_for_synthetic_local_test" } }, () => {});
    args.store.unknown(receipt.id, { phase, code, elapsedMs: 300012, timeoutMs: 300000 } as never);
    const status = f.controller.get(task.id);
    expect(status.reason).toContain(text); expect(status.reason).toContain("uncertain"); expect(status.canResume).toBe(false);
    expect(() => f.controller.resume(task.id)).toThrow("resume_denied");
    await f.controller.close();
    const second = new GeneralTaskController(f.options); cleanup.push(() => second.close());
    expect(second.get(task.id).reason).toBe(status.reason); expect(second.get(task.id).canResume).toBe(false);
    expect(canonical(second.get(task.id))).not.toContain("host-key-a");
    expect(canonical(second.get(task.id))).not.toContain(f.root);
  });
  it("keeps absent or malformed historical failure metadata generic and inert", async () => {
    const f = fixture(), task = f.create(); f.hold(); f.controller.start(task.id);
    await vi.waitFor(() => expect(f.executions).toHaveLength(1));
    f.controller.pause(task.id); f.release(); await f.controller.wait(task.id);
    const args = f.executions[0]!;
    const { text: _packet, ...preview } = args.broker.preview({ jobId: task.id, contextId: args.contextId,
      destinationId: "desktop_local", purpose: "synthetic historical diagnostic", method: "POST", body: "{}", maxFeeMicrousd: 0 });
    const receipt = args.store.commit({ ...preview, reservedFeeMicrousd: 0, scan: { status: "not_required_for_synthetic_local_test" } }, () => {});
    args.store.unknown(receipt.id);
    const generic = f.controller.get(task.id).reason;
    expect(generic).toContain("previous request or action has an uncertain outcome");
    const saved = args.store.dispatch(receipt.id);
    f.db.prepare("UPDATE private_agent_dispatches SET value=? WHERE id=?").run(canonical({ ...saved,
      failure: { phase: "transport", code: "request_timeout", elapsedMs: 1, timeoutMs: 300000, providerText: "DO_NOT_RENDER" } }), receipt.id);
    expect(f.controller.get(task.id).reason).toBe(generic);
    expect(canonical(f.controller.get(task.id))).not.toContain("DO_NOT_RENDER");
  });
  it("distinguishes an expired paused task from an uncertain operation without granting more time", async () => {
    const f = fixture(), task = f.create(); f.hold(); f.controller.start(task.id);
    await vi.waitFor(() => expect(f.executions).toHaveLength(1)); f.controller.pause(task.id); f.release(); await f.controller.wait(task.id);
    const future = Date.now() + 900001; vi.spyOn(Date, "now").mockReturnValue(future);
    expect(f.controller.get(task.id)).toMatchObject({ canResume: false, reason: "The task reached its time limit." });
    expect(() => f.controller.resume(task.id)).toThrow("resume_denied"); expect(f.executions).toHaveLength(1);
  });
  it("denies artifact reads during cancellation until the active session has closed", async () => {
    const f = fixture(), task = f.create(); f.hold(); f.controller.start(task.id);
    await vi.waitFor(() => expect(f.executions).toHaveLength(1)); f.controller.pause(task.id); f.release(); await f.controller.wait(task.id);
    const artifact = f.controller.get(task.id).artifacts[0]!; f.resetPaused(); f.hold(); f.controller.resume(task.id);
    await vi.waitFor(() => expect(f.executions).toHaveLength(2)); f.controller.cancel(task.id);
    expect(f.controller.get(task.id).status).toBe("cancelled");
    expect(() => f.controller.artifact({ id: task.id, path: artifact.path, sha256: artifact.sha256 })).toThrow("artifact_busy");
    f.release(); await f.controller.wait(task.id);
    expect(f.controller.artifact({ id: task.id, path: artifact.path, sha256: artifact.sha256 }).bytes.toString()).toBe("unit artifact");
  });
  it("latches cancellation while readiness is pending and starts no runtime", async () => {
    const f = fixture(); let release!: () => void;
    f.options.testing!.readiness = () => new Promise<void>(yes => { release = yes; });
    const task = f.create(); f.controller.start(task.id); f.controller.cancel(task.id); release(); await f.controller.wait(task.id);
    expect(f.controller.get(task.id)).toMatchObject({ status: "cancelled", canResume: false }); expect(f.executions).toEqual([]);
  });
  it.each(["dead", "alive", "uncertain", "changed"] as const)("cleanup-only cancellation handles a %s interrupted owner without request replay", async state => {
    const f = fixture(), task = f.create(); f.hold(); f.controller.start(task.id);
    await vi.waitFor(() => expect(f.executions).toHaveLength(1)); f.controller.pause(task.id); f.release(); await f.controller.wait(task.id);
    const args = f.executions[0]!, oldOwner = "old-desktop-owner";
    args.store.acquireRun(args.contextId, oldOwner, "unix:///tmp/soar-unit-docker.sock", 234567);
    args.store.append(task.id, { type: "model_started", contextId: args.contextId, operationId: "unresolved-original" });
    const pending = args.store.commit({ jobId: task.id, contextId: args.contextId, contextSha256: contextFingerprint(args.store.context(args.contextId)),
      packetSha256: digest("original unit request"), destinationId: args.model.config.destinationId, destinationSha256: digest("unit destination"),
      purpose: "unit unknown-outcome guard", policyRevision: 0, reservedFeeMicrousd: 0, scan: { status: "not_required_for_synthetic_local_test" } }, () => {});
    args.store.unknown(pending.id);
    const beforeRequests = canonical(args.store.dispatches(task.id));
    vi.spyOn(process, "kill").mockImplementation(() => {
      if (state === "alive") return true;
      throw Object.assign(new Error("safe fixture"), { code: state === "dead" || state === "changed" ? "ESRCH" : "EPERM" });
    });
    if (state === "changed") vi.spyOn(args.store, "acquireRecovery").mockImplementation(() => { throw new Error("private_agent_recovery_changed"); });
    const clean = vi.spyOn(DockerSandbox, "cleanupOwnedContext").mockResolvedValue();
    expect(f.controller.get(task.id).cleanupConfirmed).toBe(false);
    const artifact = f.controller.get(task.id).artifacts[0]!;
    expect(() => f.controller.artifact({ id: task.id, path: artifact.path, sha256: artifact.sha256 })).toThrow("artifact_cleanup_unconfirmed");
    f.controller.cancel(task.id); await f.controller.wait(task.id);
    const result = f.controller.get(task.id), claim = args.store.runClaim(args.contextId)!;
    expect(result).toMatchObject({ status: "cancelled", canResume: false });
    expect(canonical(args.store.dispatches(task.id))).toBe(beforeRequests); expect(f.executions).toHaveLength(1);
    expect(args.store.dispatch(pending.id).status).toBe("unknown");
    if (state === "dead") {
      expect(clean).toHaveBeenCalledExactlyOnceWith({ endpoint: "unix:///tmp/soar-unit-docker.sock", jobId: task.id, contextId: args.contextId });
      expect(claim.state).toBe("released"); expect(result.cleanupConfirmed).toBe(true);
    } else {
      expect(clean).not.toHaveBeenCalled(); expect(claim).toMatchObject({ state: "active", ownerId: oldOwner, pid: 234567 });
      expect(result.cleanupConfirmed).toBe(false); expect(result.reason).toContain("cleanup could not be confirmed");
    }
    expect(args.store.events(task.id).some(event => event.operationId === "unresolved-original" && event.type === "model_finished")).toBe(false);
  });
  it.each([false, true])("retries transient cleanup failure without replay after restart=%s", async restart => {
    const f = await interruptedCleanupFixture(), { task, args, artifact } = f;
    const kill = vi.spyOn(process, "kill").mockImplementation(() => { throw Object.assign(new Error("synthetic dead owner"), { code: "ESRCH" }); });
    const clean = vi.spyOn(DockerSandbox, "cleanupOwnedContext").mockRejectedValueOnce(new Error("synthetic Docker outage")).mockResolvedValue(undefined);
    f.controller.cancel(task.id); await f.controller.wait(task.id);
    expect(f.controller.get(task.id)).toMatchObject({ status: "cancelled", cleanupConfirmed: false, canResume: false, canRetryCleanup: true, cleanupInProgress: false });
    expect(args.store.runClaim(args.contextId)).toMatchObject({ state: "cleanup_required", pid: process.pid });
    const ref = { id: task.id, path: artifact.path, sha256: artifact.sha256 };
    expect(() => f.controller.artifact(ref)).toThrow("general_task_artifact_cleanup_unconfirmed");
    // A cleanup_required owner has explicitly stopped owning execution; its PID
    // may still be alive (and is this process after the first failed attempt).
    kill.mockImplementation(() => true);
    let controller = f.controller;
    if (restart) {
      await controller.close(); controller = new GeneralTaskController(f.options); cleanup.push(() => controller.close());
      expect(controller.get(task.id)).toMatchObject({ status: "cancelled", canRetryCleanup: true });
    }
    const retried = controller.cancel(task.id);
    expect(retried).toMatchObject({ status: "cancelled", cleanupInProgress: true, canRetryCleanup: false });
    expect(() => controller.artifact(ref)).toThrow("general_task_artifact_busy");
    await controller.wait(task.id);
    expect(controller.get(task.id)).toMatchObject({ status: "cancelled", cleanupConfirmed: true, canResume: false, canRetryCleanup: false, cleanupInProgress: false });
    expect(controller.artifact(ref).bytes.toString()).toBe("unit artifact");
    expect(kill).toHaveBeenCalledTimes(1); expect(clean).toHaveBeenCalledTimes(2);
    expect(args.store.runClaim(args.contextId)?.state).toBe("released");
    expect(canonical(args.store.dispatches(task.id))).toBe(f.receipts); expect(f.executions).toHaveLength(1);
    expect(args.store.events(task.id).some(event => event.type === "model_finished" && event.operationId === "unresolved-cleanup-test")).toBe(false);
    expect(() => controller.cancel(task.id)).toThrow("general_task_terminal");
  });
  it.each(["alive", "uncertain"] as const)("cleanup retries never seize an %s execution owner", async state => {
    const f = await interruptedCleanupFixture();
    vi.spyOn(process, "kill").mockImplementation(() => {
      if (state === "alive") return true;
      throw Object.assign(new Error("synthetic permission failure"), { code: "EPERM" });
    });
    const clean = vi.spyOn(DockerSandbox, "cleanupOwnedContext").mockResolvedValue(undefined);
    for (let attempt = 0; attempt < 2; attempt++) {
      f.controller.cancel(f.task.id); await f.controller.wait(f.task.id);
      expect(f.controller.get(f.task.id)).toMatchObject({ status: "cancelled", cleanupConfirmed: false, canRetryCleanup: true });
      expect(f.args.store.runClaim(f.args.contextId)).toMatchObject({ state: "active", ownerId: f.ownerId, pid: 234567 });
    }
    expect(clean).not.toHaveBeenCalled(); expect(f.executions).toHaveLength(1);
    expect(canonical(f.args.store.dispatches(f.task.id))).toBe(f.receipts);
  });
  it("rolls back cleanup release when confirmation append fails and can retry", async () => {
    const f = await interruptedCleanupFixture(), { args, task } = f;
    vi.spyOn(process, "kill").mockImplementation(() => { throw Object.assign(new Error("synthetic dead owner"), { code: "ESRCH" }); });
    const clean = vi.spyOn(DockerSandbox, "cleanupOwnedContext").mockResolvedValue(undefined);
    const append = args.store.append.bind(args.store); let failConfirmation = true;
    vi.spyOn(args.store, "append").mockImplementation((jobId, event) => {
      if (event.type === "desktop_cleanup_confirmed" && failConfirmation) { failConfirmation = false; throw new Error("synthetic append failure"); }
      return append(jobId, event);
    });
    f.controller.cancel(task.id); await f.controller.wait(task.id);
    expect(args.store.events(task.id).some(event => event.type === "run_ended" && event.cleanupConfirmed === true)).toBe(false);
    expect(args.store.events(task.id).some(event => event.type === "desktop_cleanup_confirmed")).toBe(false);
    expect(args.store.runClaim(args.contextId)?.state).toBe("cleanup_required");
    expect(f.controller.get(task.id)).toMatchObject({ status: "cancelled", cleanupConfirmed: false, canRetryCleanup: true });
    expect(() => f.controller.artifact({ id: task.id, path: f.artifact.path, sha256: f.artifact.sha256 })).toThrow("general_task_artifact_cleanup_unconfirmed");
    f.controller.cancel(task.id); await f.controller.wait(task.id);
    expect(clean).toHaveBeenCalledTimes(2); expect(args.store.runClaim(args.contextId)?.state).toBe("released");
    expect(args.store.events(task.id).filter(event => event.type === "desktop_cleanup_confirmed")).toHaveLength(1);
    expect(f.controller.get(task.id)).toMatchObject({ status: "cancelled", cleanupConfirmed: true, canRetryCleanup: false });
    expect(canonical(args.store.dispatches(task.id))).toBe(f.receipts); expect(f.executions).toHaveLength(1);
  });
  it("recovers legacy cancelled cleanup from its released claim without a confirmation event", async () => {
    const f = await interruptedCleanupFixture(), { args, task } = f;
    const clean = vi.spyOn(DockerSandbox, "cleanupOwnedContext").mockResolvedValue(undefined);
    // Simulate the old crash gap: cancellation was saved, cleanup released its
    // claim, then the host stopped before writing its separate confirmation.
    f.controller.cancel(task.id);
    args.store.releaseRun(args.contextId, f.ownerId, true);
    await f.controller.wait(task.id);
    expect(args.store.events(task.id).some(event => event.type === "run_ended" && event.cleanupConfirmed === true || event.type === "desktop_cleanup_confirmed")).toBe(false);
    await f.controller.close(); const restarted = new GeneralTaskController(f.options); cleanup.push(() => restarted.close());
    expect(restarted.get(task.id)).toMatchObject({ status: "cancelled", reason: "Task cancelled.", cleanupConfirmed: true, canRetryCleanup: false, canResume: false });
    expect(restarted.artifact({ id: task.id, path: f.artifact.path, sha256: f.artifact.sha256 }).bytes.toString()).toBe("unit artifact");
    expect(clean).not.toHaveBeenCalled(); expect(f.executions).toHaveLength(1);
    expect(canonical(args.store.dispatches(task.id))).toBe(f.receipts);
  });
  it("deduplicates cleanup clicks and refuses a concurrent live cleanup owner", async () => {
    const f = await interruptedCleanupFixture(); let complete!: () => void;
    vi.spyOn(process, "kill").mockImplementation(pid => {
      if (pid === 234567) throw Object.assign(new Error("synthetic dead owner"), { code: "ESRCH" });
      return true;
    });
    const clean = vi.spyOn(DockerSandbox, "cleanupOwnedContext").mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
    f.controller.cancel(f.task.id);
    await vi.waitFor(() => expect(clean).toHaveBeenCalledOnce());
    const cleaningClaim = f.args.store.runClaim(f.args.contextId)!;
    expect(f.controller.cancel(f.task.id)).toMatchObject({ status: "cancelled", cleanupInProgress: true, canRetryCleanup: false });
    const concurrent = new GeneralTaskController(f.options); cleanup.push(() => concurrent.close());
    concurrent.cancel(f.task.id); await concurrent.wait(f.task.id);
    expect(f.args.store.runClaim(f.args.contextId)).toEqual(cleaningClaim);
    expect(clean).toHaveBeenCalledOnce();
    complete(); await f.controller.wait(f.task.id);
    expect(f.controller.get(f.task.id)).toMatchObject({ status: "cancelled", cleanupConfirmed: true });
    expect(f.args.store.runClaim(f.args.contextId)?.state).toBe("released");
    expect(canonical(f.args.store.dispatches(f.task.id))).toBe(f.receipts); expect(f.executions).toHaveLength(1);
  });
  it("admits only one desktop execution at a time and close requests pause instead of extra work", async () => {
    const f = fixture(), first = f.create(), second = f.create(); f.hold(); f.controller.start(first.id);
    await vi.waitFor(() => expect(f.executions).toHaveLength(1)); expect(() => f.controller.start(second.id)).toThrow("busy");
    const closing = f.controller.close(); f.release(); await closing;
    expect(f.controller.get(first.id).status).toBe("paused"); expect(f.controller.get(second.id).status).toBe("queued"); expect(f.executions).toHaveLength(1);
  });
  it("reports missing pinned runtime as unavailable without creating a task or executing", async () => {
    const f = fixture(); f.removeImage();
    expect(await f.controller.availability()).toMatchObject({ available: false, executionMode: "unavailable", publicOrSyntheticOnly: true });
    expect(f.controller.list()).toEqual([]); expect(f.executions).toEqual([]);
  });
  it("records the owner's verdict once, on a submitted inactive task only, persists it across reopening and leaves acceptance and reported issues unchanged", async () => {
    const f = fixture(); f.narrate = true;
    const updates: string[] = [];
    const controller = new GeneralTaskController({ ...f.options, onUpdate: snapshot => { if (snapshot.verdict) updates.push(snapshot.id); } }); cleanup.push(() => controller.close());
    const task = controller.create({ goal: "Make a small report.", inputSelectionId: controller.selectInputs([f.input]).id, outputName: "report.md", publicOrSynthetic: true });
    const verdict = { id: task.id, decision: "accept" as const, ownerMinutes: 8, interventions: 1, exportedThroughApp: true };
    // Queued, running (active), paused: no verdict yet.
    expect(() => controller.recordVerdict(verdict)).toThrow("general_task_verdict_denied");
    f.hold(); controller.start(task.id); await vi.waitFor(() => expect(f.executions).toHaveLength(1));
    expect(() => controller.recordVerdict(verdict)).toThrow("general_task_verdict_denied");
    controller.pause(task.id); f.release(); await controller.wait(task.id);
    expect(controller.get(task.id).status).toBe("paused");
    expect(() => controller.recordVerdict(verdict)).toThrow("general_task_verdict_denied");
    f.resetPaused(); controller.resume(task.id); await controller.wait(task.id);
    const before = controller.get(task.id);
    expect(before).toMatchObject({ status: "submitted", independentAcceptance: "not_evaluated" }); expect(before.verdict).toBeUndefined(); expect(before.reportedIssues!.length).toBeGreaterThan(0);
    // Strict input: no free text, no renderer-added field, finite minutes, integer interventions.
    for (const invalid of [{ ...verdict, note: "free text" }, { ...verdict, goal: "x" }, { ...verdict, ownerMinutes: Number.NaN }, { ...verdict, ownerMinutes: -1 }, { ...verdict, interventions: 1.5 }, { ...verdict, decision: "maybe" }])
      expect(() => controller.recordVerdict(invalid as never)).toThrow();
    expect(controller.get(task.id).verdict).toBeUndefined();
    const after = controller.recordVerdict(verdict);
    expect(after.verdict).toMatchObject({ decision: "accept", ownerMinutes: 8, interventions: 1, exportedThroughApp: true });
    expect(after.verdict!.recordedAt).toBeGreaterThanOrEqual(before.updatedAt);
    expect(after.revision).toBeGreaterThan(before.revision);
    // The verdict changes nothing else: not acceptance, not the host's issues, not the task's own times.
    expect(after).toMatchObject({ status: "submitted", independentAcceptance: "not_evaluated", reportedIssues: before.reportedIssues, updatedAt: before.updatedAt, elapsedMs: before.elapsedMs, modelCalls: before.modelCalls });
    expect(updates).toEqual([task.id]);
    expect(() => controller.recordVerdict({ ...verdict, decision: "reject" })).toThrow("general_task_verdict_recorded");
    expect(controller.get(task.id).verdict).toEqual(after.verdict);
    expect(() => controller.cancel(task.id)).toThrow("general_task_terminal");
    // Incomplete and cancelled tasks take no verdict: OAJ counts submitted jobs.
    f.failModel = true; const failed = controller.create({ goal: "Make a small report.", inputSelectionId: controller.selectInputs([f.input]).id, outputName: "report.md", publicOrSynthetic: true });
    controller.start(failed.id); await controller.wait(failed.id); f.failModel = false;
    expect(controller.get(failed.id).status).toBe("incomplete");
    expect(() => controller.recordVerdict({ ...verdict, id: failed.id })).toThrow("general_task_verdict_denied");
    const cancelled = controller.create({ goal: "Make a small report.", outputName: "report.md", publicOrSynthetic: true }); controller.cancel(cancelled.id);
    expect(() => controller.recordVerdict({ ...verdict, id: cancelled.id })).toThrow("general_task_verdict_denied");
    // The verdict survives reopening, and a tampered one is refused like every other record invariant.
    await controller.close();
    const reopened = new GeneralTaskController(f.options); cleanup.push(() => reopened.close());
    expect(reopened.get(task.id).verdict).toEqual(after.verdict);
    expect(reopened.get(task.id)).toMatchObject({ status: "submitted", independentAcceptance: "not_evaluated", updatedAt: before.updatedAt });
    const row = JSON.parse((f.db.prepare("SELECT value FROM general_tasks WHERE id=?").get(task.id) as { value: string }).value);
    f.db.prepare("UPDATE general_tasks SET value=? WHERE id=?").run(canonical({ ...row, verdict: { ...row.verdict, decision: "maybe" } }), task.id);
    expect(() => reopened.get(task.id)).toThrow("general_task_record_invalid");
    f.db.prepare("UPDATE general_tasks SET value=? WHERE id=?").run(canonical({ ...row, verdict: { ...row.verdict, note: "free text" } }), task.id);
    expect(() => reopened.get(task.id)).toThrow("general_task_record_invalid");
  });
  it("exports a verdict receipt of hashes, counts and the verdict only, which registry-row.py rows as an owner row", async () => {
    const f = fixture(), task = f.create(); f.controller.start(task.id); await f.controller.wait(task.id);
    expect(() => f.controller.verdictReceipt(task.id)).toThrow("general_task_verdict_missing");
    const args = f.executions[0]!;
    // A second writer reply cut at the output limit, with its usage, as the runner records one; it is not a model_started, so it is not a call.
    args.store.append(task.id, { type: "model_finished", contextId: args.contextId, operationId: "unit_length", finishReason: "length", usage: { inputTokens: 500, outputTokens: 50, cacheReadTokens: 100, cacheWriteTokens: 0 } });
    const snapshot = f.controller.recordVerdict({ id: task.id, decision: "reject", ownerMinutes: 12.5, interventions: 2, exportedThroughApp: false });
    const receipt = f.controller.verdictReceipt(task.id), text = receipt.bytes.toString("utf8"), parsed = JSON.parse(text);
    expect(receipt.sha256).toBe(digest(receipt.bytes)); expect(text.endsWith("\n")).toBe(true);
    expect(Object.keys(parsed).sort()).toEqual([...VERDICT_RECEIPT_KEYS].sort());
    const record = JSON.parse((f.db.prepare("SELECT value FROM general_tasks WHERE id=?").get(task.id) as { value: string }).value);
    expect(record.attestationIdentity).toMatch(/^[a-f0-9]{64}$/u);
    expect(parsed).toEqual({ version: 1, taskId: task.id, taskJobSha256: record.attestationIdentity, date: new Date(record.startedAt).toISOString().slice(0, 10),
      profile: "standard", thinking: "disabled", maxOutputTokens: 4096, runStatus: "submitted", terminalCause: "submitted", modelCalls: snapshot.modelCalls, toolCalls: snapshot.toolCalls,
      wallSeconds: Math.round(snapshot.elapsedMs / 100) / 10, inputTokens: 120 + 500, outputTokens: 30 + 50, cachedTokens: 40 + 100, cacheWriteTokens: 0, lengthStops: 1, usd: 0,
      unknownDispatches: 0, retriedDispatches: 0, failedDispatches: 0, entailment: null, arm: "local-standard", cloudModel: null, cloudApi: null,
      verdict: { decision: "reject", ownerMinutes: 12.5, interventions: 2, exportedThroughApp: false, recordedAt: new Date(snapshot.verdict!.recordedAt).toISOString() } });
    expect(snapshot.modelCalls).toBe(1);
    // Nothing of the task's content, names or host: not the goal, the output name, the input file, the storage root, the endpoint or the key.
    for (const secret of ["Make a small report", "report.md", "source.csv", "input/", "output/", f.root, "127.0.0.1", "host-key", "unit artifact"]) expect(text).not.toContain(secret);
    // The registry writer rows this receipt as an owner row, taking outcome, effort and the verdict time from the receipt and the enums from the operator.
    const path = join(f.root, "receipt.json"); writeFileSync(path, receipt.bytes);
    const row = JSON.parse(execFileSync("python3", ["-I", resolve(__dirname, "..", "..", "scripts", "registry-row.py"), "--verdict-file", path, "--id", "oaj-unit-1", "--batch", "owner-real-jobs",
      "--task", `owner-${task.id.slice(0, 8)}`, "--family", "document_review", "--exposure", "fresh", "--verdict-by", "owner", "--lesson", "unit"], { cwd: resolve(__dirname, "..", ".."), encoding: "utf8" }));
    expect(row).toMatchObject({ id: "oaj-unit-1", batch: "owner-real-jobs", task: `owner-${task.id.slice(0, 8)}`, family: "document_review", exposure: "fresh", taskJobSha256: record.attestationIdentity, arm: "local-standard",
      outcome: "rejected", verdictBy: "owner", ownerMinutes: 12.5, interventions: 2, exportedThroughApp: false, verdictAt: new Date(snapshot.verdict!.recordedAt).toISOString().replace(/\.\d{3}Z$/u, "Z"),
      modelCalls: 1, inputTokens: 620, lengthStops: 1, usd: 0, cloudModel: null, cloudApi: null, criticalChecks: null, lesson: "unit", profile: "standard", thinking: "disabled" });
    expect(row).not.toHaveProperty("taskId"); expect(row).not.toHaveProperty("verdict"); expect(row.git).toMatch(/^[a-f0-9]{12}$/u);
    for (const secret of ["Make a small report", "source.csv", f.root, "127.0.0.1"]) expect(JSON.stringify(row)).not.toContain(secret);
  });

  // Backlog item 6, finding A6 (BL-20261109-0336-desktop-resume-reasons-design): each run's own reason is kept and classified. Appended,
  // so the line numbers other briefs cite above stay valid.
  const GENERIC_INCOMPLETE = "The task stopped without a verified structural submission. Saved progress is retained.";
  /** The first execution stops with `reason` after one closed model call and a saved checkpoint; every later one is the fixture's own. */
  function stopOnce(f: ReturnType<typeof fixture>, reason: string, thrown?: Error) {
    const original = f.options.testing!.runnerFactory!; let stopped = false;
    f.options.testing!.runnerFactory = args => stopped ? original(args) : { pause() {}, cancel() {}, async run() {
      stopped = true; f.executions.push(args);
      const { store, jobId, contextId, checkpoints } = args, operationId = `stop_${f.executions.length}`;
      store.append(jobId, { type: "model_started", contextId, operationId, promptProtocolSha256: digest("fixture-protocol") });
      store.append(jobId, { type: "model_finished", contextId, operationId, finishReason: "stop", usage: null });
      const snapshot = checkpoints.save([...args.files, { path: args.contract.requiredArtifacts[0]!.path, bytes: Buffer.from("saved partial artifact") }]);
      store.append(jobId, { type: "checkpoint", contextId, snapshot, sha256: checkpoints.fingerprint(snapshot) });
      store.append(jobId, { type: "run_ended", contextId, cleanupConfirmed: true, elapsedMs: 12 });
      if (thrown) throw thrown;
      return { status: "incomplete", reason, snapshot, checks: [], modelCalls: 1 };
    } };
  }
  const storedRecord = (f: ReturnType<typeof fixture>, id: string) => JSON.parse((f.db.prepare("SELECT value FROM general_tasks WHERE id=?").get(id) as { value: string }).value) as Record<string, unknown>;
  const rewriteRecord = (f: ReturnType<typeof fixture>, id: string, change: Record<string, unknown>) =>
    f.db.prepare("UPDATE general_tasks SET value=? WHERE id=?").run(canonical({ ...storedRecord(f, id), ...change }), id);
  it.each([
    ["runtime_failure_progress_preserved", "execution runtime failed", true], ["execution_context_unavailable", "could not be prepared", true],
    ["cleanup_required", "could not be confirmed", false], ["orphan_cleanup_required", "could not be cleaned up", false],
    ["job_context_busy", "Another process still holds", false], ["cancelled_or_deadline", "cancellation or time check", true],
    ["model_output_incomplete", "cut at the output limit", true], ["one_complete_tool_action_required", "exactly one tool action", true],
    ["job_already_completed", GENERIC_INCOMPLETE, false],
  ] as const)("backlog item 6: keeps %s, offers Resume with a true text after reopening, and resumes to a submission", async (reason, text, settled) => {
    const f = fixture(); stopOnce(f, reason);
    const task = f.create(); f.controller.start(task.id); await f.controller.wait(task.id);
    expect(storedRecord(f, task.id).reason).toBe(reason);
    const stopped = f.controller.get(task.id);
    expect(stopped).toMatchObject({ status: "incomplete", canResume: true, modelCalls: 1 });
    expect(stopped.reason).toContain(text); expect(stopped.reason).not.toContain("_");
    // Only a stop whose execution context is confirmed says that nothing is uncertain; a cleanup or claim stop makes no such claim.
    if (settled) expect(stopped.reason).toContain("no request or action is uncertain"); else expect(stopped.reason).not.toContain("uncertain");
    await f.controller.close();
    const reopened = new GeneralTaskController(f.options); cleanup.push(() => reopened.close());
    expect(reopened.get(task.id)).toMatchObject({ reason: stopped.reason, canResume: true });
    reopened.resume(task.id); await reopened.wait(task.id);
    expect(reopened.get(task.id)).toMatchObject({ status: "submitted", canResume: false });
    expect(f.executions).toHaveLength(2);
  });
  it.each([
    ["runtime_contract_drift", GENERIC_INCOMPLETE], ["checkpoint_identity_mismatch", GENERIC_INCOMPLETE], ["host_validation_not_replayed", GENERIC_INCOMPLETE],
    ["repeated_incomplete_tool_arguments_at_output_limit", GENERIC_INCOMPLETE], ["duplicate_tool_call_id", GENERIC_INCOMPLETE],
    ["bounded_allowance_exhausted", GENERIC_INCOMPLETE],
    // Backlog item 6 follow-up (6.4): still terminal for Resume, but its text names the cure, a Revoke.
    ["consultation_budget_unavailable", "Revoking it lets a resume continue locally within what remains"],
    // Backlog item 6 (A7): a stage that cannot continue has its own text.
    ["public_source_retention_or_text_failed", GENERIC_INCOMPLETE], ["research_stage_not_replayed", "research stage stopped before its evidence was handed to the writer"],
    // Backlog item 13a: any other research stop names its fixed code and says the task cannot resume.
    ["research_request_denied", "the task's request allowance was spent, or a broker rule refused it"], ["research_admission_invalid", "The research stage stopped (research_admission_invalid), so this task cannot resume."],
    ["session_contract_drift", GENERIC_INCOMPLETE], ["unresolved_dispatch_no_replay", GENERIC_INCOMPLETE],
    ["cancelled_before_completion", GENERIC_INCOMPLETE], ["deadline_before_completion", GENERIC_INCOMPLETE], ["public_session_stopped", GENERIC_INCOMPLETE],
    ["a_reason_no_pull_request_classified", GENERIC_INCOMPLETE], ["constructor", GENERIC_INCOMPLETE],
    ["deadline_before_request", "The time left was shorter"], ["model_request_denied", "The broker refused the next model request before it was sent (a destination, packet or ledger rule, or the task's request allowance spent)"],
  ] as const)("backlog item 6: keeps the terminal %s and refuses to resume it after reopening", async (reason, text) => {
    const f = fixture(); stopOnce(f, reason);
    const task = f.create(); f.controller.start(task.id); await f.controller.wait(task.id);
    expect(storedRecord(f, task.id).reason).toBe(reason);
    const stopped = f.controller.get(task.id);
    expect(stopped).toMatchObject({ status: "incomplete", canResume: false }); expect(stopped.reason).toContain(text);
    await f.controller.close();
    const reopened = new GeneralTaskController(f.options); cleanup.push(() => reopened.close());
    expect(reopened.get(task.id)).toMatchObject({ reason: stopped.reason, canResume: false });
    expect(() => reopened.resume(task.id)).toThrow("general_task_resume_denied");
    expect(f.executions).toHaveLength(1);
  });
  it("backlog item 6: stores a non-code reason, and a submission the controller could not confirm, as the legacy incomplete; a legacy record stays terminal", async () => {
    const f = fixture(); stopOnce(f, "Free Text, not a code");
    const odd = f.create(); f.controller.start(odd.id); await f.controller.wait(odd.id);
    expect(storedRecord(f, odd.id).reason).toBe("incomplete");
    expect(f.controller.get(odd.id)).toMatchObject({ status: "incomplete", canResume: false, reason: GENERIC_INCOMPLETE });
    // The session submitted, but the run's cleanup was never confirmed, so the controller records the task incomplete, as before.
    const unconfirmed = fixture(false), held = unconfirmed.create(); unconfirmed.controller.start(held.id); await unconfirmed.controller.wait(held.id);
    expect(storedRecord(unconfirmed, held.id)).toMatchObject({ status: "incomplete", reason: "incomplete" });
    expect(unconfirmed.controller.get(held.id).canResume).toBe(false);
    // A record written before item 6 kept the bare status: it stays terminal even where its run's reason was transient.
    stopOnce(f, "model_unavailable");
    const legacy = f.create(); f.controller.start(legacy.id); await f.controller.wait(legacy.id);
    expect(f.controller.get(legacy.id).canResume).toBe(true);
    rewriteRecord(f, legacy.id, { reason: "incomplete" });
    expect(f.controller.get(legacy.id)).toMatchObject({ canResume: false, reason: GENERIC_INCOMPLETE });
    expect(() => f.controller.resume(legacy.id)).toThrow("general_task_resume_denied");
  });
  it("backlog item 6: keeps a newly resumable stop behind an unknown row of the writer's context and behind a spent allowance", async () => {
    const f = fixture(); stopOnce(f, "runtime_failure_progress_preserved");
    const task = f.create(); f.controller.start(task.id); await f.controller.wait(task.id);
    expect(f.controller.get(task.id).canResume).toBe(true);
    const args = f.executions[0]!;
    const { text: _packet, ...preview } = args.broker.preview({ jobId: task.id, contextId: args.contextId, destinationId: "desktop_local", purpose: "agent reasoning and tool selection", method: "POST", body: "{}", maxFeeMicrousd: 0 });
    args.store.unknown(args.store.commit({ ...preview, reservedFeeMicrousd: 0, scan: { status: "not_required_for_synthetic_local_test" } }, () => {}).id);
    const blocked = f.controller.get(task.id);
    expect(blocked.canResume).toBe(false); expect(blocked.reason).toContain("uncertain outcome");
    expect(() => f.controller.resume(task.id)).toThrow("general_task_resume_denied");
    // The model allowance spent: the text still holds, and no Resume is offered.
    stopOnce(f, "model_output_incomplete");
    const spent = f.create(); f.controller.start(spent.id); await f.controller.wait(spent.id);
    const context = f.executions[1]!.contextId;
    for (let i = 1; i < GENERAL_TASK_LIMITS.modelCalls; i++) {
      f.executions[1]!.store.append(spent.id, { type: "model_started", contextId: context, operationId: `spent_${i}` });
      f.executions[1]!.store.append(spent.id, { type: "model_finished", contextId: context, operationId: `spent_${i}` });
    }
    expect(f.controller.get(spent.id)).toMatchObject({ canResume: false, modelCalls: GENERAL_TASK_LIMITS.modelCalls });
    expect(f.controller.get(spent.id).reason).toContain("cut at the output limit");
    expect(f.executions).toHaveLength(2);
  });
  it("backlog item 6: records runtime_unavailable as resumable when the runtime is down on resume, and resumes once it is back", async () => {
    const f = fixture(), task = f.create(); f.hold(); f.controller.start(task.id);
    await vi.waitFor(() => expect(f.executions).toHaveLength(1)); f.controller.pause(task.id); f.release(); await f.controller.wait(task.id);
    expect(f.controller.get(task.id).status).toBe("paused");
    f.options.testing!.readiness = async () => { throw new Error("synthetic docker unavailable"); }; f.resetPaused();
    f.controller.resume(task.id); await f.controller.wait(task.id);
    expect(storedRecord(f, task.id).reason).toBe("runtime_unavailable");
    expect(f.controller.get(task.id)).toMatchObject({ status: "incomplete", canResume: true,
      reason: "The local execution runtime is unavailable. Check the configured model and pinned Docker image." });
    expect(f.executions).toHaveLength(1);
    f.options.testing!.readiness = async () => {};
    await f.controller.close();
    const reopened = new GeneralTaskController(f.options); cleanup.push(() => reopened.close());
    reopened.resume(task.id); await reopened.wait(task.id);
    expect(reopened.get(task.id)).toMatchObject({ status: "submitted" }); expect(f.executions).toHaveLength(2);
  });
  it.each(["input", "storage", "checkpoint", "resized blob", "linked directory", "missing blob", "missing storage"] as const)("backlog item 6: ends a task whose stored %s fails its integrity check as the terminal task_integrity_failed", async kind => {
    const f = fixture(), task = f.create();
    if (kind === "input") rewriteRecord(f, task.id, { attestationIdentity: digest("another attestation") });
    else if (kind === "storage") {
      const checkpoints = join(f.root, "tasks", "checkpoints");
      // A replaced directory: storageUnchanged() refuses its new inode before any read.
      renameSync(checkpoints, `${checkpoints}-moved`); mkdirSync(checkpoints);
    } else if (kind === "checkpoint") writeFileSync(join(f.root, "tasks", "checkpoints", task.id, task.inputs[0]!.sha256), "value\n22\n");
    // checkpoint_file_invalid: the blob's size no longer matches its record.
    else if (kind === "resized blob") writeFileSync(join(f.root, "tasks", "checkpoints", task.id, task.inputs[0]!.sha256), "value\n2\n");
    // checkpoint_directory_invalid: the task's own checkpoint directory is a symlink.
    else if (kind === "linked directory") {
      const own = join(f.root, "tasks", "checkpoints", task.id); renameSync(own, `${own}-real`); symlinkSync(`${own}-real`, own);
    }
    // A missing file or directory under the task storage root is lost storage, never a transient runtime failure.
    else if (kind === "missing blob") rmSync(join(f.root, "tasks", "checkpoints", task.id, task.inputs[0]!.sha256));
    else rmSync(join(f.root, "tasks", "checkpoints"), { recursive: true, force: true });
    f.controller.start(task.id); await f.controller.wait(task.id);
    expect(storedRecord(f, task.id).reason).toBe("task_integrity_failed");
    const ended = f.controller.get(task.id);
    expect(ended).toMatchObject({ status: "incomplete", canResume: false });
    expect(ended.reason).toContain("cannot resume"); expect(ended.reason).not.toContain("uncertain"); expect(ended.reason).not.toContain("retained");
    expect(() => f.controller.resume(task.id)).toThrow("general_task_resume_denied");
    expect(f.executions).toHaveLength(0);
  });
  it("backlog item 6: keeps a cancelled task cancelled when its start then fails with a resumable reason", async () => {
    const f = fixture(); let fail!: () => void;
    f.options.testing!.readiness = () => new Promise<void>((_, no) => { fail = () => no(new Error("synthetic docker unavailable")); });
    const task = f.create(); f.controller.start(task.id); f.controller.cancel(task.id); fail(); await f.controller.wait(task.id);
    expect(storedRecord(f, task.id)).toMatchObject({ status: "cancelled", reason: "runtime_unavailable" });
    expect(f.controller.get(task.id)).toMatchObject({ status: "cancelled", canResume: false });
    expect(() => f.controller.resume(task.id)).toThrow("general_task_resume_denied"); expect(f.executions).toEqual([]);
  });
  it("backlog item 6: records a code the session threw as itself, terminal, and anything else as runtime_unavailable", async () => {
    const f = fixture(); stopOnce(f, "unused", new Error("session_completed_snapshot_drift"));
    const drifted = f.create(); f.controller.start(drifted.id); await f.controller.wait(drifted.id);
    expect(storedRecord(f, drifted.id).reason).toBe("session_completed_snapshot_drift");
    expect(f.controller.get(drifted.id)).toMatchObject({ status: "incomplete", canResume: false, reason: GENERIC_INCOMPLETE });
    // The runner's refusal of its own contract when it is built is kept as itself and is terminal.
    stopOnce(f, "unused", new Error("general_job_contract_invalid"));
    const refused = f.create(); f.controller.start(refused.id); await f.controller.wait(refused.id);
    expect(storedRecord(f, refused.id).reason).toBe("general_job_contract_invalid");
    expect(f.controller.get(refused.id)).toMatchObject({ status: "incomplete", canResume: false, reason: GENERIC_INCOMPLETE });
    stopOnce(f, "unused", new Error("Synthetic transport failure"));
    const transient = f.create(); f.controller.start(transient.id); await f.controller.wait(transient.id);
    expect(storedRecord(f, transient.id).reason).toBe("runtime_unavailable");
    expect(f.controller.get(transient.id).canResume).toBe(true);
  });
  it("backlog item 6: keeps a paused task whose run ended while the configuration changed for launch() to decide, as before", async () => {
    const f = fixture(), task = f.create(); f.hold(); f.controller.start(task.id);
    await vi.waitFor(() => expect(f.executions).toHaveLength(1));
    f.changeRuntime(); f.controller.pause(task.id); f.release(); await f.controller.wait(task.id);
    expect(storedRecord(f, task.id)).toMatchObject({ status: "paused", reason: "configuration_changed" });
    expect(f.controller.get(task.id)).toMatchObject({ status: "paused", canResume: true, reason: "The runtime or model configuration changed. Create a new task." });
    expect(() => f.controller.resume(task.id)).toThrow("general_task_configuration_changed"); expect(f.executions).toHaveLength(1);
  });
  it("backlog item 6: shows a finalising task past its deadline as paused, not stopped by the time limit, since it still resumes", async () => {
    const f = fixture();
    const paused = f.controller.create({ goal: "Summarize the source.", inputSelectionId: f.controller.selectInputs([f.input]).id, outputName: "memo.md", publicOrSynthetic: true,
      publicSources: { urls: ["https://public.example.test/facts"], allowPublicRetrieval: true, dnsResolver: "system" } });
    let calls = 0;
    vi.spyOn(PrivateAgentModel.prototype, "complete").mockImplementation(async () => {
      calls++; if (calls === 1) f.controller.pause(paused.id);
      return { content: '{"verdict":"supported"}', toolCalls: [], finishReason: "stop", costUsd: 0, durationMs: 1 };
    });
    f.controller.start(paused.id); await f.controller.wait(paused.id);
    expect(f.controller.get(paused.id)).toMatchObject({ status: "paused", canResume: true });
    // Past the wall budget only submission and the evidence pass remain, which no deadline gates.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + GENERAL_TASK_LIMITS.elapsedMs + 1);
    expect(f.controller.get(paused.id)).toMatchObject({ status: "paused", canResume: true, reason: "Paused with progress saved." });
    f.controller.resume(paused.id); await f.controller.wait(paused.id);
    expect(f.controller.get(paused.id)).toMatchObject({ status: "submitted", entailment: { truncated: false, counts: { supported: 2 } } });
  });

  // Backlog item 6, finding A7 (BL-20261109-0501-research-stage-pause-design): an unfinished research stage offers no Resume.
  const RESEARCH_STOP = "The research stage stopped before its evidence was handed to the writer.";
  /** The first execution records what the session records for a reading stage before the writer runs (its input and one stage event), plus
   * the given extras, then ends as `end` says; every later execution is the fixture's own. */
  function researchStageOnce(f: ReturnType<typeof fixture>, end: "paused" | "throw" | "research_plan_invalid",
    extra: { transferred?: boolean; committedRow?: boolean; settledRow?: boolean; noStageEvent?: boolean } = {}) {
    const original = f.options.testing!.runnerFactory!; let once = false;
    f.options.testing!.runnerFactory = args => once ? original(args) : { pause() {}, cancel() {}, async run() {
      once = true; f.executions.push(args);
      const { store, jobId, contextId } = args;
      store.createContext({ id: "reader", jobId, sources: [{ id: "corpus", version: digest("synthetic corpus"), classification: "public", synthetic: true }] });
      store.append(jobId, { type: "research_input", contextId: "reader", recordedAt: Date.now(), input: {} });
      if (!extra.noStageEvent) store.append(jobId, { type: "research_stage", contextId: "reader", stage: "index", calls: 1 });
      if (extra.transferred) store.append(jobId, { type: "research_transfer", contextId: "reader", binding: {} });
      if (extra.committedRow || extra.settledRow) {
        const { text: _text, ...preview } = args.broker.preview({ jobId, contextId: "reader", destinationId: "desktop_local", purpose: "research source index", method: "POST", body: "{}", maxFeeMicrousd: 0 });
        const row = store.commit({ ...preview, reservedFeeMicrousd: 0, scan: { status: "not_required_for_synthetic_local_test" } }, () => {});
        if (extra.settledRow) store.settle(row.id, 0, digest("synthetic reply"));
      }
      store.append(jobId, { type: "run_ended", contextId, cleanupConfirmed: true, elapsedMs: 12 });
      if (end === "throw") throw new Error("synthetic failure after the stage spent");
      return end === "paused" ? { status: "paused", reason: "checkpoint_saved", snapshot: [], checks: [], modelCalls: 0 } : { status: "incomplete", reason: end, snapshot: [], checks: [], modelCalls: 0 };
    } };
  }
  it.each(["paused", "throw"] as const)("backlog item 6 (A7): offers no Resume for a research stage that started and never transferred, after a %s and after a crash", async end => {
    const f = fixture(); researchStageOnce(f, end);
    const task = f.create(); f.controller.start(task.id); await f.controller.wait(task.id);
    // A pause is stored paused; an error thrown after the stage spent is stored as the resumable runtime_unavailable, which the guard blocks.
    expect(storedRecord(f, task.id)).toMatchObject(end === "paused" ? { status: "paused" } : { status: "incomplete", reason: "runtime_unavailable" });
    const stopped = f.controller.get(task.id);
    expect(stopped).toMatchObject({ canResume: false });
    expect(stopped.reason).toBe(`${RESEARCH_STOP} A partly run research stage cannot continue, so this task cannot resume.`);
    expect(stopped.reason).not.toContain("_"); expect(stopped.reason).not.toContain("uncertain");
    expect(() => f.controller.resume(task.id)).toThrow("general_task_resume_denied");
    // Past the wall budget the unfinished stage, a permanent stop like the size or fee-cap stops, still names itself, not the time limit.
    const late = vi.spyOn(Date, "now").mockReturnValue(Date.now() + GENERAL_TASK_LIMITS.elapsedMs + 1);
    expect(f.controller.get(task.id)).toMatchObject({ canResume: false, reason: stopped.reason }); late.mockRestore();
    // A crash mid-stage: the next app start projects the running record interrupted, and the stage still blocks Resume.
    await f.controller.close();
    rewriteRecord(f, task.id, { status: "running", reason: "running" });
    const reopened = new GeneralTaskController(f.options); cleanup.push(() => reopened.close());
    expect(reopened.get(task.id)).toMatchObject({ status: "incomplete", canResume: false, reason: stopped.reason });
    expect(() => reopened.resume(task.id)).toThrow("general_task_resume_denied"); expect(f.executions).toHaveLength(1);
  });

  it("backlog item 6 (A7): a transferred stage stays resumable, a terminal stored research reason keeps its own text, and an uncertain reader row shows the uncertain-request text first", async () => {
    const transferred = fixture(); researchStageOnce(transferred, "paused", { transferred: true });
    let task = transferred.create(); transferred.controller.start(task.id); await transferred.controller.wait(task.id);
    expect(transferred.controller.get(task.id)).toMatchObject({ status: "paused", canResume: true, reason: "Paused with progress saved." });
    transferred.controller.resume(task.id); await transferred.controller.wait(task.id);
    expect(transferred.controller.get(task.id)).toMatchObject({ status: "submitted" });
    const failed = fixture(); researchStageOnce(failed, "research_plan_invalid");
    task = failed.create(); failed.controller.start(task.id); await failed.controller.wait(task.id);
    expect(failed.controller.get(task.id)).toMatchObject({ status: "incomplete", canResume: false, reason: "The research stage stopped (research_plan_invalid), so this task cannot resume." });
    const uncertain = fixture(); researchStageOnce(uncertain, "paused", { committedRow: true });
    task = uncertain.create(); uncertain.controller.start(task.id); await uncertain.controller.wait(task.id);
    const blocked = uncertain.controller.get(task.id);
    expect(blocked).toMatchObject({ canResume: false }); expect(blocked.reason).toContain("uncertain outcome"); expect(blocked.reason).not.toContain(RESEARCH_STOP);
  });

  it("backlog item 6 (A7): a settled reader row alone marks the stage started, an input alone does not, and the stored refusal names itself past the time limit", async () => {
    // A crash after a settled index call of a stage with several calls leaves its row and no stage event.
    const rows = fixture(); researchStageOnce(rows, "paused", { noStageEvent: true, settledRow: true });
    let task = rows.create(); rows.controller.start(task.id); await rows.controller.wait(task.id);
    const stopped = rows.controller.get(task.id);
    expect(stopped).toMatchObject({ canResume: false }); expect(stopped.reason).toContain(RESEARCH_STOP);
    // Only the input: the session's own pause before the stage, the one resumable stage pause.
    const input = fixture(); researchStageOnce(input, "paused", { noStageEvent: true });
    task = input.create(); input.controller.start(task.id); await input.controller.wait(task.id);
    expect(input.controller.get(task.id)).toMatchObject({ status: "paused", canResume: true, reason: "Paused with progress saved." });
    input.controller.resume(task.id); await input.controller.wait(task.id);
    expect(input.controller.get(task.id)).toMatchObject({ status: "submitted" });
    // The session's own refusal, stored terminal, keeps naming the stage once the wall budget has passed.
    const stored = fixture(); stopOnce(stored, "research_stage_not_replayed");
    task = stored.create(); stored.controller.start(task.id); await stored.controller.wait(task.id);
    const late = vi.spyOn(Date, "now").mockReturnValue(Date.now() + GENERAL_TASK_LIMITS.elapsedMs + 1);
    expect(stored.controller.get(task.id)).toMatchObject({ status: "incomplete", canResume: false }); expect(stored.controller.get(task.id).reason).toContain(RESEARCH_STOP);
    late.mockRestore();
  });

  // Backlog item 6, plan 6.3 (BL-20261113-0817-runner-storage-integrity-design): a damaged blob of the task's storage ends task_integrity_failed.
  const INTEGRITY = "The task's saved inputs, storage or records are missing or no longer match what it recorded, so it stopped. This task cannot resume.";
  type Step = { name: string; args: Record<string, unknown> } | "pause";
  /** The real runner on a stateful sandbox double; each run follows its script of tool calls, and "pause" pauses the task. */
  function runnerBacked(f: ReturnType<typeof fixture>, scripts: Step[][]) {
    vi.spyOn(DockerSandbox, "currentEndpoint").mockResolvedValue("unix:///tmp/synthetic-docker.sock");
    vi.spyOn(DockerSandbox, "cleanupOwnedContext").mockResolvedValue(undefined);
    const create = vi.spyOn(DockerSandbox, "create").mockImplementation(async input => {
      const files = new Map(input.files.map(file => [file.path, Buffer.from(file.bytes)]));
      return {
        async execute(command: string) {
          if (command.startsWith("rm ")) { files.delete(command.slice(3)); return { exitCode: 0, stdout: "", stderr: "" }; }
          return { exitCode: 0, stdout: `ran ${command}`, stderr: "" };
        },
        async listFiles() { return workspaceListing(files); },
        async readFile(path: string) { return files.get(path)!; },
        async editFile(mode: string, path: string, payload: Buffer) { files.set(path, mode === "append" ? Buffer.concat([files.get(path) ?? Buffer.alloc(0), payload]) : Buffer.from(payload)); return { ok: true, bytes: payload.length }; },
        async close() {},
      } as unknown as DockerSandbox;
    });
    const requests: number[] = [];
    f.options.testing!.runnerFactory = args => {
      f.executions.push(args); const run = requests.push(0) - 1, steps = scripts[run] ?? ["pause"]; let i = 0;
      vi.spyOn(args.model, "complete").mockImplementation(async () => {
        requests[run]!++;
        const step = steps[i++] ?? "pause", id = `call_${run}_${i}`;
        if (step === "pause") { f.controller.pause(args.jobId); return { content: "", toolCalls: [{ id, type: "function", function: { name: "remember_plan", arguments: JSON.stringify({ plan: "pause" }) } }], finishReason: "tool_calls", costUsd: 0, durationMs: 1 }; }
        return { content: "", toolCalls: [{ id, type: "function", function: { name: step.name, arguments: JSON.stringify(step.args) } }], finishReason: "tool_calls", costUsd: 0, durationMs: 1 };
      });
      return new GeneralAgentRunner(args);
    };
    return { requests, create };
  }
  const blobPath = (f: ReturnType<typeof fixture>, id: string, sha256: string) => join(f.root, "tasks", "checkpoints", id, sha256);
  const observationSha = (f: ReturnType<typeof fixture>, id: string) => (f.executions[0]!.store.events(id).find(event => event.executionCapture === "retained")!.executionObservation as { sha256: string }).sha256;
  const writes = (path: string, content: string) => ({ name: "write_file", args: { path, content } });
  it.each([
    ["a deleted checkpoint blob", [writes("output/report.md", "report body A")], (f: ReturnType<typeof fixture>, id: string) => rmSync(blobPath(f, id, digest("report body A")))],
    ["a checkpoint blob holding other bytes of the same size", [writes("output/report.md", "report body B")], (f: ReturnType<typeof fixture>, id: string) => writeFileSync(blobPath(f, id, digest("report body B")), "report body X")],
    ["a deleted observation blob", [{ name: "execute", args: { command: "echo hi" } }], (f: ReturnType<typeof fixture>, id: string) => rmSync(blobPath(f, id, observationSha(f, id)))],
    ["a blob that only an earlier checkpoint holds", [writes("work/a.txt", "earlier bytes E"), { name: "execute", args: { command: "true" } }, { name: "execute", args: { command: "rm work/a.txt" } }],
      (f: ReturnType<typeof fixture>, id: string) => rmSync(blobPath(f, id, digest("earlier bytes E")))],
  ] as const)("backlog item 6 (6.3): ends task_integrity_failed at its first runtime failure for %s, with no Resume, also after reopening", async (_, steps, damage) => {
    const f = fixture(), { requests } = runnerBacked(f, [[...steps]]);
    const task = f.create(); f.controller.start(task.id); await f.controller.wait(task.id);
    expect(storedRecord(f, task.id).status).toBe("paused");
    damage(f, task.id);
    f.controller.resume(task.id); await f.controller.wait(task.id);
    // The resume failed inside the runner, whose catch keeps only an error's class, and sent nothing.
    expect(f.executions[1]!.store.events(task.id).some(event => event.type === "runtime_failure")).toBe(true); expect(requests[1]).toBe(0);
    expect(storedRecord(f, task.id)).toMatchObject({ status: "incomplete", reason: "task_integrity_failed" });
    expect(f.controller.get(task.id)).toMatchObject({ status: "incomplete", canResume: false, reason: INTEGRITY });
    expect(() => f.controller.resume(task.id)).toThrow("general_task_resume_denied");
    await f.controller.close();
    const reopened = new GeneralTaskController(f.options); cleanup.push(() => reopened.close());
    expect(reopened.get(task.id)).toMatchObject({ status: "incomplete", canResume: false, reason: INTEGRITY }); expect(f.executions).toHaveLength(2);
  });

  it.each([
    ["a sandbox that fails once", [writes("output/report.md", "report body D")], (_f: ReturnType<typeof fixture>, _id: string, create: { mockRejectedValueOnce(error: Error): void }) => create.mockRejectedValueOnce(new Error("synthetic docker create failure"))],
    ["an unreadable observation blob", [{ name: "execute", args: { command: "echo hi" } }], (f: ReturnType<typeof fixture>, id: string) => {
      const path = blobPath(f, id, observationSha(f, id)); chmodSync(path, 0o000); cleanup.push(() => chmodSync(path, 0o600)); }],
    ["an unreadable checkpoint blob", [writes("output/report.md", "report body G")], (f: ReturnType<typeof fixture>, id: string) => {
      const path = blobPath(f, id, digest("report body G")); chmodSync(path, 0o000); cleanup.push(() => chmodSync(path, 0o600)); }],
  ] as const)("backlog item 6 (6.3): keeps a runtime failure resumable when the storage is intact: %s", async (_, steps, environment) => {
    const f = fixture(), { create } = runnerBacked(f, [[...steps]]);
    const task = f.create(); f.controller.start(task.id); await f.controller.wait(task.id);
    environment(f, task.id, create as unknown as { mockRejectedValueOnce(error: Error): void });
    f.controller.resume(task.id); await f.controller.wait(task.id);
    expect(storedRecord(f, task.id)).toMatchObject({ status: "incomplete", reason: "runtime_failure_progress_preserved" });
    expect(f.controller.get(task.id)).toMatchObject({ canResume: true });
  });

  const SOURCE_URL = "https://public.example.test/facts";
  /** A web task whose first run retains one public source, then ends as `end` says: a runtime failure first deletes the source's blob, and
   * "submitted" hands over to the fixture's own runner. */
  function sourcedTask(f: ReturnType<typeof fixture>, end: "paused" | "incomplete" | "submitted", bytes: Buffer) {
    const original = f.options.testing!.runnerFactory!;
    f.options.testing!.runnerFactory = args => ({ pause() {}, cancel() {}, async run(signal) {
      const { store, jobId, contextId, checkpoints } = args;
      const { text: _text, ...preview } = args.broker.preview({ jobId, contextId, destinationId: "desktop_web_1", purpose: "public source retrieval", method: "GET", url: SOURCE_URL, maxFeeMicrousd: 0 });
      const row = store.commit({ ...preview, reservedFeeMicrousd: 0, scan: { status: "not_required_for_synthetic_local_test" } }, () => {});
      store.settle(row.id, 0, digest(bytes));
      retainPublicSource(store, checkpoints, { jobId, contextId, url: SOURCE_URL, bytes, receipt: store.dispatch(row.id) });
      if (end === "submitted") return original(args).run(signal);
      f.executions.push(args);
      const snapshot = checkpoints.save([...args.files]);
      store.append(jobId, { type: "checkpoint", contextId, snapshot, sha256: checkpoints.fingerprint(snapshot) });
      store.append(jobId, { type: "run_ended", contextId, cleanupConfirmed: true, elapsedMs: 12 });
      if (end === "incomplete") rmSync(blobPath(f, jobId, digest(bytes)));
      return end === "paused" ? { status: "paused", reason: "checkpoint_saved", snapshot, checks: [], modelCalls: 0 } :
        { status: "incomplete", reason: "runtime_failure_progress_preserved", snapshot, checks: [], modelCalls: 0 };
    } });
    return f.controller.create({ goal: "Summarize the source.", inputSelectionId: f.controller.selectInputs([f.input]).id, outputName: "memo.md", publicOrSynthetic: true,
      publicSources: { urls: [SOURCE_URL], allowPublicRetrieval: true, dnsResolver: "system" } });
  }
  it("backlog item 6 (6.3): a damaged public-source blob ends the task, and get(), list() and resume() still answer for it and every other task", async () => {
    for (const end of ["incomplete", "paused"] as const) {
      const f = fixture(), plain = f.create(), bytes = Buffer.from(`retained public bytes ${end}`), task = sourcedTask(f, end, bytes);
      f.controller.start(task.id); await f.controller.wait(task.id);
      // A runtime failure is scanned and stored terminal; a pause is not scanned, and get() itself names the damage.
      if (end === "paused") rmSync(blobPath(f, task.id, digest(bytes)));
      expect(storedRecord(f, task.id).reason).toBe(end === "incomplete" ? "task_integrity_failed" : "paused");
      expect(f.controller.get(task.id)).toMatchObject({ canResume: false, reason: INTEGRITY, sources: [] });
      expect(f.controller.list().map(item => item.id).sort()).toEqual([plain.id, task.id].sort());
      expect(f.controller.get(plain.id)).toMatchObject({ status: "queued" });
      expect(() => f.controller.resume(task.id)).toThrow("general_task_resume_denied");
    }
  });

  it("backlog item 6 (6.3): get()'s source read fails closed: an unreadable blob only empties the sources, damage names itself past the time limit, and a submitted task keeps its outcome", async () => {
    const f = fixture(), bytes = Buffer.from("retained public bytes, unreadable"), task = sourcedTask(f, "paused", bytes);
    f.controller.start(task.id); await f.controller.wait(task.id);
    const healthy = f.controller.get(task.id);
    expect(healthy).toMatchObject({ status: "paused", canResume: true }); expect(healthy.sources).toHaveLength(1);
    // A permission error is environmental: the sources are left out, and nothing else changes.
    const path = blobPath(f, task.id, digest(bytes)); chmodSync(path, 0o000); cleanup.push(() => { try { chmodSync(path, 0o600); } catch { /* removed below */ } });
    expect(f.controller.get(task.id)).toMatchObject({ status: "paused", canResume: true, reason: healthy.reason, sources: [] });
    chmodSync(path, 0o600); rmSync(path);
    // Damage is a permanent stop, named before the time limit.
    const late = vi.spyOn(Date, "now").mockReturnValue(Date.now() + GENERAL_TASK_LIMITS.elapsedMs + 1);
    expect(f.controller.get(task.id)).toMatchObject({ canResume: false, reason: INTEGRITY }); late.mockRestore();
    // A submitted task keeps its outcome; only its sources are left out.
    const g = fixture(), done = Buffer.from("retained public bytes, submitted"), submitted = sourcedTask(g, "submitted", done);
    g.controller.start(submitted.id); await g.controller.wait(submitted.id);
    const before = g.controller.get(submitted.id);
    expect(before.status).toBe("submitted");
    rmSync(blobPath(g, submitted.id, digest(done)));
    expect(g.controller.get(submitted.id)).toMatchObject({ status: "submitted", reason: before.reason, canResume: false, sources: [] });
  });
});

// Backlog item 13a: the desktop's local research route on files.
let researchWriterCard: ServingCardV1 | undefined;
/** The fixture with the beta on and an adopted card the desktop accepts: the synthetic P10's model alias with streaming on. */
function researchFixture() {
  const f = fixture(), card = adopt(structuredClone(researchWriterCard ??= proposedServingCard())), written = writeCard(f.root, card);
  f.config.vllm.model = SYNTHETIC_P10_REQUEST_SETTINGS.model; f.config.streamingEnabled = true; f.config.localResearchBeta = true; f.config.vllm.servingCard = written;
  const goal = "Summarize what the notes say about the river.";
  /** A new selection of the fixture's input unless `overrides` names one (a refused create keeps its selection). */
  const createResearch = (overrides: Partial<GeneralTaskCreateInput> = {}) => f.controller.create({ goal, outputName: "report.md", publicOrSynthetic: true, research: "local_beta", ...overrides,
    inputSelectionId: "inputSelectionId" in overrides ? overrides.inputSelectionId : f.controller.selectInputs([f.input]).id });
  const createHeavy = () => f.controller.create({ goal, inputSelectionId: f.controller.selectInputs([f.input]).id, outputName: "report.md", publicOrSynthetic: true, profile: "heavy" });
  const stored = (id: string) => JSON.parse((f.db.prepare("SELECT value FROM general_tasks WHERE id=?").get(id) as { value: string }).value);
  const write = (id: string, record: unknown) => { f.db.prepare("UPDATE general_tasks SET value=? WHERE id=?").run(canonical(record), id); };
  return { f, card, written, createResearch, createHeavy, stored, write };
}

describe("desktop local research tasks (backlog item 13a)", () => {
  it("creates a heavy version-4 task bound to the accepted card, salted and with a claims ledger", () => {
    const { f, card, written, createResearch, createHeavy, stored } = researchFixture(), task = createResearch();
    expect(task).toMatchObject({ status: "queued", profile: "heavy" });
    const record = stored(task.id);
    expect(record).toMatchObject({ version: 4, profile: "heavy", research: { route: "local_beta", cardSha256: written.sha256, cardDate: card.date } });
    for (const key of ["publicSources", "routing", "consultantIdentity"]) expect(record).not.toHaveProperty(key);
    // The claims ledger is in the phase from creation: the same goal and input as a plain heavy task make another phase.
    const heavy = createHeavy();
    expect(stored(heavy.id).phaseIdentity).not.toBe(record.phaseIdentity);
    // The identity binds the salted heavy profile, whatever the configured salt, and the card the task was created on.
    f.config.promptCacheSalt = true; const salted = createHeavy(); f.config.promptCacheSalt = false;
    expect(stored(salted.id).configurationIdentity).not.toBe(stored(heavy.id).configurationIdentity);
    expect(record.configurationIdentity).toBe(digest(canonical({ version: 4, local: stored(salted.id).configurationIdentity, research: record.research })));
  });

  it("advertises the beta with its card only while the flag is on, whether or not local execution is ready", async () => {
    const { f, written, card } = researchFixture();
    expect((await f.controller.availability()).research).toEqual({ available: true, reason: expect.any(String), card: { date: card.date, sha256: written.sha256 } });
    f.config.vllm.servingCard = { path: written.path, sha256: "0".repeat(64) };
    expect((await f.controller.availability()).research).toMatchObject({ available: false, code: "serving_card_pin_drift" });
    f.removeImage();
    expect(await f.controller.availability()).toMatchObject({ executionMode: "unavailable", research: { available: false, code: "serving_card_pin_drift" } });
    f.config.localResearchBeta = false;
    expect(await f.controller.availability()).not.toHaveProperty("research");
  });

  it("ends a research task's start when the beta is turned off or the card's bytes change", () => {
    const { f, card, written, createResearch } = researchFixture(), task = createResearch();
    f.config.localResearchBeta = false;
    expect(() => f.controller.start(task.id)).toThrow("general_task_configuration_changed");
    f.config.localResearchBeta = true;
    // The creation card refused in place: its file's bytes change under the same pair, and the pinned read refuses it.
    const bytes = readFileSync(written.path); writeFileSync(written.path, Buffer.from(`${JSON.stringify(card)}\n`));
    expect(readDesktopResearchCard(f.config)).toEqual({ accepted: false, code: "serving_card_pin_drift" });
    expect(() => f.controller.start(task.id)).toThrow("general_task_configuration_changed");
    writeFileSync(written.path, bytes);
    // The same card in other bytes is another card: the task runs only on the very card it was created on.
    f.config.vllm.servingCard = writeCard(f.root, Buffer.from(`${JSON.stringify(card)}\n`), "compact.json");
    expect(readDesktopResearchCard(f.config)).toMatchObject({ accepted: true, card: { date: card.date } });
    expect(() => f.controller.start(task.id)).toThrow("general_task_configuration_changed");
    expect(f.executions).toHaveLength(0); expect(f.controller.get(task.id).status).toBe("queued");
  });

  it("refuses a research task without the beta or an accepted card, with consultation or typed URLs, on the standard profile, for a non-document deliverable, or without readable inputs, and stores nothing", () => {
    const { f, written, createResearch } = researchFixture(), pdf = join(f.root, "paper.pdf"); writeFileSync(pdf, "%PDF-1.7\n");
    const refuse = (overrides: Partial<GeneralTaskCreateInput> = {}) => createResearch({ inputSelectionId: selection, ...overrides }), selection = f.controller.selectInputs([f.input]).id;
    expect(() => refuse({ routing: "ask_before_consulting" })).toThrow("general_task_research_consultation_denied");
    expect(() => refuse({ publicSources: { urls: ["https://public.example.test/facts"], allowPublicRetrieval: true, dnsResolver: "system" } })).toThrow("general_task_research_sources_unsupported");
    expect(() => refuse({ profile: "standard" })).toThrow("general_task_research_profile_heavy");
    expect(() => refuse({ outputName: "deck.pptx" })).toThrow("general_task_research_output_unsupported");
    expect(() => refuse({ inputSelectionId: undefined })).toThrow("general_task_research_inputs_required");
    expect(() => refuse({ inputSelectionId: f.controller.selectInputs([f.input, pdf]).id })).toThrow("general_task_research_source_unreadable");
    f.config.vllm.servingCard = { path: written.path, sha256: "0".repeat(64) };
    expect(() => refuse()).toThrow("general_task_research_unavailable");
    delete f.config.vllm.servingCard;
    expect(() => refuse()).toThrow("general_task_research_unavailable");
    f.config.vllm.servingCard = written; f.config.localResearchBeta = false;
    expect(() => refuse()).toThrow("general_task_research_unavailable");
    expect(f.controller.list()).toEqual([]);
    f.config.localResearchBeta = true;
    expect(createResearch({ profile: "heavy" })).toMatchObject({ status: "queued", profile: "heavy" });
  });

  it("keeps room at create for the stage's repair reserve under a card whose admission basis is serving_card", () => {
    const { f, createResearch } = researchFixture(), card = adopt(structuredClone(researchWriterCard!), undefined, { defaults: true });
    (card as { admission: { basis: string } }).admission.basis = "serving_card";
    f.config.vllm.servingCard = writeCard(f.root, card, "admission.json");
    expect(readDesktopResearchCard(f.config)).toMatchObject({ accepted: true, card: { policy: { admission: { basis: "serving_card" } } } });
    const { chunkBytes, overlapBytes } = RESEARCH_COVERAGE_POLICY, calls = RESEARCH_PIPELINE_BUDGET.extractionCalls, long = join(f.root, "long.txt");
    let reserved = calls; while (reserved + researchRepairReserve(reserved) > calls) reserved--;
    const select = (chunks: number) => { writeFileSync(long, Buffer.alloc(chunkBytes + (chunks - 1) * (chunkBytes - overlapBytes), 0x61)); return f.controller.selectInputs([long]).id; };
    expect(() => createResearch({ inputSelectionId: select(reserved + 1) })).toThrow("general_task_research_mandatory_budget_exceeded");
    expect(createResearch({ inputSelectionId: select(reserved) })).toMatchObject({ status: "queued", profile: "heavy" });
  });

  it("reads a version-4 record only with the exact route, the heavy profile and no typed URLs, and no other version with a route", () => {
    const { f, createResearch, stored, write } = researchFixture(), task = createResearch(), plain = f.create(), original = stored(task.id);
    const edits: ((record: Record<string, any>) => void)[] = [record => { delete record.research; }, record => { record.profile = "standard"; }, record => { delete record.profile; },
      record => { record.research.cardPath = "card.json"; }, record => { record.research.route = "cloud"; }, record => { record.research.cardSha256 = "0".repeat(63); },
      record => { record.publicSources = { urls: ["https://public.example.test/facts"], allowPublicRetrieval: true, dnsResolver: "system" }; },
      record => { record.version = 3; record.routing = "ask_before_consulting"; record.consultantIdentity = "a".repeat(64); },
      record => { record.wallMs = -1; }, record => { record.wallMs = 1.5; }];
    for (const edit of edits) {
      const record = structuredClone(original); edit(record); write(task.id, record);
      expect(() => f.controller.get(task.id), String(edit)).toThrow("general_task_record_invalid");
    }
    write(task.id, original); expect(f.controller.get(task.id).status).toBe("queued");
    write(plain.id, { ...stored(plain.id), research: original.research });
    expect(() => f.controller.get(plain.id)).toThrow("general_task_record_invalid");
    const { research: _route, ...plainRecord } = stored(plain.id); write(plain.id, { ...plainRecord, wallMs: 5 });
    expect(() => f.controller.get(plain.id)).toThrow("general_task_record_invalid");
  });

  it("exports a research task's verdict receipt under its own arm, which registry-row.py rows", async () => {
    // A submitted research task is simulated by rewriting a submitted heavy task's record, since the stage is wired by a later change.
    const { f, card, written, createHeavy, stored, write } = researchFixture(), task = createHeavy();
    f.controller.start(task.id); await f.controller.wait(task.id);
    f.controller.recordVerdict({ id: task.id, decision: "accept", ownerMinutes: 5, interventions: 0, exportedThroughApp: true });
    write(task.id, { ...stored(task.id), version: 4, research: { route: "local_beta", cardSha256: written.sha256, cardDate: card.date } });
    const receipt = f.controller.verdictReceipt(task.id);
    expect(JSON.parse(receipt.bytes.toString("utf8"))).toMatchObject({ profile: "heavy", arm: "local-heavy-research" });
    const path = join(f.root, "receipt.json"); writeFileSync(path, receipt.bytes);
    const row = JSON.parse(execFileSync("python3", ["-I", resolve(__dirname, "..", "..", "scripts", "registry-row.py"), "--verdict-file", path, "--id", "oaj-unit-research", "--batch", "owner-real-jobs",
      "--task", `owner-${task.id.slice(0, 8)}`, "--family", "research", "--exposure", "fresh", "--verdict-by", "owner", "--lesson", "unit"], { cwd: resolve(__dirname, "..", ".."), encoding: "utf8" }));
    expect(row).toMatchObject({ arm: "local-heavy-research", profile: "heavy", outcome: "accepted" });
  });
});

// Backlog item 13a, part 2: the reading stage wired into the controller, on a loopback model endpoint (the stage seam).
/**
 * A research task on a loopback endpoint that answers with `reply`: the card with its default roles (no structured output, so the
 * replies are not streamed), two text sources, and fixture()'s scripted writer. `edit` changes the card before it is written.
 */
async function stageFixture(reply: Parameters<typeof researchModelServer>[0], edit?: (card: ServingCardV1) => void, writeBound?: DesktopResearchWriteBound,
  sources: { id: string; path: string; bytes: Buffer }[] = researchV4Sources()) {
  const server = await researchModelServer(reply); cleanup.push(server.close);
  const base = fixture(), card = adopt(structuredClone(researchWriterCard ??= proposedServingCard()), undefined, { defaults: true }); edit?.(card);
  // E2's one-line choice, through the controller's test option in place of the shipped constant.
  const controller = writeBound ? new GeneralTaskController({ ...base.options, testing: { ...base.options.testing, researchWriteBound: writeBound } }) : base.controller;
  if (writeBound) cleanup.push(() => controller.close());
  const f = { ...base, controller };
  f.config.vllm.model = SYNTHETIC_P10_REQUEST_SETTINGS.model; f.config.vllm.baseUrl = server.baseUrl; f.config.localResearchBeta = true;
  f.config.vllm.servingCard = writeCard(f.root, card, "stage-card.json");
  const files = sources.map(source => { const path = join(f.root, basename(source.path)); writeFileSync(path, source.bytes); return path; });
  const task = f.controller.create({ goal: RESEARCH_V4_TEST_BRIEF, inputSelectionId: f.controller.selectInputs(files).id, outputName: "report.md", publicOrSynthetic: true, research: "local_beta" });
  const run = async () => { f.controller.start(task.id); await f.controller.wait(task.id); return f.controller.get(task.id); };
  const stored = () => JSON.parse((f.db.prepare("SELECT value FROM general_tasks WHERE id=?").get(task.id) as { value: string }).value);
  const write = (record: unknown) => { f.db.prepare("UPDATE general_tasks SET value=? WHERE id=?").run(canonical(record), task.id); };
  return { f, server, task, run, stored, write };
}
const STAGE_PROMPTS = ["You index", "You plan", "You extract", "You write"];
const stageRequests = (requests: { system: string }[]) => requests.filter(request => STAGE_PROMPTS.some(prefix => request.system.startsWith(prefix)));

describe("desktop local research stage (backlog item 13a, part 2)", () => {
  it("runs the reading stage on the task's own local model before the writer, hands the writer the packet, and shows the stage", async () => {
    const { f, server, run } = await stageFixture(researchV4Reply), done = await run();
    expect(done.status).toBe("submitted");
    expect(done.research).toMatchObject({ route: "local_beta", stage: "transferred" });
    expect(done.research!.stages.map(row => row.stage)).toEqual(["index", "plan", "extract", "synthesise"]);
    for (const row of done.research!.stages) { expect(row.calls, row.stage).toBeGreaterThan(0); expect(row.fallback, row.stage).toBeUndefined(); }
    for (const prefix of STAGE_PROMPTS) expect(server.requests.some(request => request.system.startsWith(prefix)), prefix).toBe(true);
    // The stage's requests are its own count; the writer's model calls are the scripted writer's one.
    expect(done.research!.requests).toBe(stageRequests(server.requests).length);
    expect(done.modelCalls).toBe(1);
    // The writer starts after the transfer, with the packet among its files and the heavy profile's own write phase (requirement B's default).
    const args = f.executions[0]!;
    expect(args.files.some(file => file.path === RESEARCH_FILES.evidenceText)).toBe(true);
    expect(args.contract).toMatchObject({ maxModelCalls: 80, maxToolCalls: 120, maxElapsedMs: 5_400_000 });
    expect(args.contract.requiredChecks).toContain("research_claims_ledger");
  });

  it("uses the host's plan after two plan attempts cut at the output limit, and shows the fallback and the cut replies", async () => {
    const { run } = await stageFixture((system, user) => system.startsWith("You plan") ? { content: "{\"version\":2,\"questions\":[", finishReason: "length" } : researchV4Reply(system, user));
    const done = await run();
    expect(done.status).toBe("submitted");
    expect(done.research!.stages.find(row => row.stage === "plan")).toEqual({ stage: "plan", calls: 2, truncatedReplies: 2, fallback: "host_plan" });
  });

  it("writes from the synthesis skeleton when no synthesis attempt is accepted, and shows the fallback", async () => {
    const { run } = await stageFixture((system, user) => system.startsWith("You write") ? "not an argument" : researchV4Reply(system, user));
    const done = await run();
    expect(done.status).toBe("submitted");
    expect(done.research!.stages.find(row => row.stage === "synthesise")).toMatchObject({ fallback: "skeleton" });
  });

  it("ends research_extraction_incomplete, with no writer and no Resume, when a chunk stays incomplete after its repairs", async () => {
    const { f, run, stored } = await stageFixture((system, user) =>
      system.startsWith("You extract") && parseResearchUserContent(user).source.id === "input/02-beta.md" ? "not an extraction" : researchV4Reply(system, user));
    const done = await run();
    expect(stored()).toMatchObject({ status: "incomplete", reason: "research_extraction_incomplete" });
    expect(done).toMatchObject({ status: "incomplete", canResume: false, research: { stage: "stopped" } });
    const extract = done.research!.stages.find(row => row.stage === "extract")!;
    expect(extract.chunksComplete).toBeLessThan(extract.chunksPlanned!);
    expect(f.executions).toHaveLength(0);
  });

  it("gives the writer E2's twelve-call bound when that one setting names it, and leaves the stage and a plain task as they were", async () => {
    const { f, run } = await stageFixture(researchV4Reply, undefined, "twelve-call"), done = await run();
    expect(done).toMatchObject({ status: "submitted", research: { stage: "transferred" } });
    expect(f.executions[0]!.contract).toMatchObject({ maxModelCalls: 12, maxToolCalls: 12, maxElapsedMs: 1_200_000 });
    const plain = f.controller.create({ goal: "Make a small report.", inputSelectionId: f.controller.selectInputs([f.input]).id, outputName: "report.md", publicOrSynthetic: true, profile: "heavy" });
    f.controller.start(plain.id); await f.controller.wait(plain.id);
    expect(f.executions[1]!.contract).toMatchObject({ maxModelCalls: 80, maxToolCalls: 120, maxElapsedMs: 5_400_000 });
  });

  it("sends each role's cap from the card, without a response format under default structured output", async () => {
    const { f, server, run } = await stageFixture(researchV4Reply, card => { card.roles.extract.maxOutputTokens = [1024, 2048]; });
    expect((await run()).status).toBe("submitted");
    const read = readDesktopResearchCard(f.config);
    if (!read.accepted) throw new Error("card refused");
    const roles = read.card.policy.roles, first = (prefix: string) => server.requests.find(request => request.system.startsWith(prefix))!;
    expect(roles.extract.maxOutputTokens[0]).toBe(1024);
    expect(first("You index")).toMatchObject({ maxTokens: roles.index.maxOutputTokens[0], responseFormat: false });
    expect(first("You plan")).toMatchObject({ maxTokens: roles.plan.maxOutputTokens[0], responseFormat: false });
    expect(first("You extract")).toMatchObject({ maxTokens: 1024, responseFormat: false });
    expect(first("You write")).toMatchObject({ maxTokens: roles.synthesis.maxOutputTokens[0], responseFormat: false });
  });

  it("counts the stage's calls, tokens, cut replies and time in the verdict receipt, as registry-row.py's counts_of counts a driver row", async () => {
    const { f, task, run, stored } = await stageFixture((system, user) => system.startsWith("You plan") ? { content: "{", finishReason: "length" } : researchV4Reply(system, user));
    const done = await run();
    expect(done.status).toBe("submitted");
    f.controller.recordVerdict({ id: task.id, decision: "accept", ownerMinutes: 5, interventions: 0, exportedThroughApp: true });
    const receipt = JSON.parse(f.controller.verdictReceipt(task.id).bytes.toString("utf8"));
    const args = f.executions[0]!, events = args.store.events(task.id), dispatches = args.store.dispatches(task.id);
    const counts = JSON.parse(execFileSync("python3", ["-I", "-c", ["import importlib.util, json, sys", "spec = importlib.util.spec_from_file_location('registry_row', sys.argv[1])",
      "module = importlib.util.module_from_spec(spec)", "spec.loader.exec_module(module)", "print(json.dumps(module.counts_of(*json.load(sys.stdin))))"].join("\n"),
      resolve(__dirname, "..", "..", "scripts", "registry-row.py")], { input: JSON.stringify([events, dispatches]), encoding: "utf8" }));
    for (const key of ["modelCalls", "inputTokens", "outputTokens", "cachedTokens", "cacheWriteTokens", "lengthStops"]) expect(receipt[key], key).toBe(counts[key]);
    const stageCalls = events.filter(event => event.type === "research_stage").reduce((total, row) => total + Number(row.calls), 0);
    expect(stageCalls).toBeGreaterThan(0); expect(receipt.modelCalls).toBe(done.modelCalls + stageCalls);
    expect(receipt.lengthStops).toBe(2);
    expect(stored().wallMs).toBeGreaterThan(0); expect(receipt.wallSeconds).toBe(Math.round(stored().wallMs / 100) / 10);
    expect(done.elapsedMs).toBe(stored().wallMs);
  });

  it("ends a task paused mid-stage, and its unfinished stage alone keeps Resume closed on a record left resumable", async () => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const { f, server, task, stored, write } = await stageFixture(async (system, user) => { if (system.startsWith("You index")) await held; return researchV4Reply(system, user); });
    f.controller.start(task.id);
    await vi.waitFor(() => expect(server.requests.length).toBeGreaterThan(0));
    f.controller.pause(task.id); release(); await f.controller.wait(task.id);
    expect(f.controller.get(task.id)).toMatchObject({ status: "incomplete", canResume: false, research: { stage: "stopped" } });
    expect(f.executions).toHaveLength(0);
    // A record a crash left paused: only the unfinished-stage guard can keep Resume closed, and it names the stop.
    write({ ...stored(), status: "paused", reason: "paused" });
    expect(f.controller.get(task.id)).toMatchObject({ canResume: false, reason: expect.stringContaining("A partly run research stage cannot continue") });
    expect(() => f.controller.resume(task.id)).toThrow("general_task_resume_denied");
  });

  it("keeps a run's wall time when the writer's run fails after the stage", async () => {
    const { f, run, stored } = await stageFixture(researchV4Reply);
    f.options.testing!.runnerFactory = args => ({ pause() {}, cancel() {}, async run() { f.executions.push(args); throw new Error("fixture_runner_failure"); } });
    const done = await run();
    expect(done).toMatchObject({ status: "incomplete", research: { stage: "transferred" } });
    expect(stored().wallMs).toBeGreaterThan(0); expect(done.elapsedMs).toBe(stored().wallMs);
  });

  it("reads a missing writer context as none yet only for a research session the writer never touched", async () => {
    /** Removes the writer's context and, as asked, every dispatch row and event that carries its id: what a stop before the write phase leaves. */
    const lose = (f: { db: Database.Database }, jobId: string, writer: string, rows: { events: boolean; dispatches: boolean }) => {
      f.db.pragma("foreign_keys = OFF");
      f.db.prepare("DELETE FROM private_agent_run_claims WHERE context_id=?").run(writer);
      f.db.prepare("DELETE FROM private_agent_contexts WHERE id=?").run(writer);
      if (rows.dispatches) f.db.prepare("DELETE FROM private_agent_dispatches WHERE job_id=? AND json_extract(value, '$.contextId')=?").run(jobId, writer);
      if (rows.events) f.db.prepare("DELETE FROM private_agent_events WHERE job_id=? AND json_extract(value, '$.contextId')=?").run(jobId, writer);
    };
    // A research task's writer context lost after the write phase: its events still name it, so the snapshot still fails, as before.
    const research = await stageFixture(researchV4Reply);
    expect((await research.run()).status).toBe("submitted");
    lose(research.f, research.task.id, research.f.executions[0]!.contextId, { events: false, dispatches: true });
    expect(() => research.f.controller.get(research.task.id)).toThrow("private_agent_context_missing");
    // With no event and no dispatch naming it, a research session's writer never began: the task reads as having no writer context yet.
    lose(research.f, research.task.id, research.f.executions[0]!.contextId, { events: true, dispatches: true });
    expect(research.f.controller.get(research.task.id).research).toMatchObject({ route: "local_beta" });
    // A plain task in the same state still fails: only a research session starts before its writer context exists.
    const plain = fixture(), task = plain.create(); plain.controller.start(task.id); await plain.controller.wait(task.id);
    lose(plain, task.id, plain.executions[0]!.contextId, { events: true, dispatches: true });
    expect(() => plain.controller.get(task.id)).toThrow("private_agent_context_missing");
  });

  it("pauses in the writer and resumes from the transferred packet, with no second stage request", async () => {
    const { f, server, task } = await stageFixture(researchV4Reply);
    f.hold(); f.controller.start(task.id);
    await vi.waitFor(() => expect(f.executions).toHaveLength(1));
    const stageCount = stageRequests(server.requests).length;
    f.controller.pause(task.id); f.release(); await f.controller.wait(task.id);
    expect(f.controller.get(task.id)).toMatchObject({ status: "paused", canResume: true, research: { stage: "transferred" } });
    f.resetPaused(); f.controller.resume(task.id); await f.controller.wait(task.id);
    expect(f.controller.get(task.id).status).toBe("submitted");
    expect(stageRequests(server.requests)).toHaveLength(stageCount); expect(f.executions).toHaveLength(2);
  });

  it("passes the card's admission rates under a serving_card basis to the stage, which records its admission", async () => {
    const { f, run } = await stageFixture(researchV4Reply, card => { (card as { admission: { basis: string } }).admission.basis = "serving_card"; });
    const done = await run();
    expect(done.status).toBe("submitted");
    const args = f.executions[0]!, transfer = args.store.events(args.jobId).find(event => event.type === "research_transfer") as { binding: { summary: { admission?: { basis: string; decision: string } } } };
    expect(transfer.binding.summary.admission).toMatchObject({ basis: "serving_card", decision: "admitted" });
  });
});

// Backlog item 13a, part 3: what the task view reads from the controller.
describe("desktop local research task view (backlog item 13a, part 3)", () => {
  it("reports a stage in progress while its request is open, so a pause or a quit can warn, and not once the writer has the packet", async () => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const { f, server, task } = await stageFixture(async (system, user) => { if (system.startsWith("You index")) await held; return researchV4Reply(system, user); });
    expect(f.controller.researchStageRunning()).toBe(false);
    f.controller.start(task.id);
    await vi.waitFor(() => expect(server.requests.length).toBeGreaterThan(0));
    expect(f.controller.researchStageRunning()).toBe(true);
    expect(f.controller.get(task.id).research).toMatchObject({ stage: "running" });
    release(); await f.controller.wait(task.id);
    expect(f.controller.researchStageRunning()).toBe(false);
    expect(f.controller.get(task.id)).toMatchObject({ status: "submitted", research: { stage: "transferred" } });
  });

  it("names a research stop in its own words, beside the stage's counts", async () => {
    const { run } = await stageFixture((system, user) =>
      system.startsWith("You extract") && parseResearchUserContent(user).source.id === "input/02-beta.md" ? "not an extraction" : researchV4Reply(system, user));
    const done = await run();
    expect(done.reason).toBe("The research stage could not read every source passage, even after its repairs, so nothing was handed to the writer. This task cannot resume; its research section shows how many passages were read.");
    expect(done.research!.stages.find(row => row.stage === "extract")).toMatchObject({ chunksPlanned: 2, chunksComplete: 1, repairCalls: 1 });
  });

  it("shows how a packet was trimmed from the stage's own counts, on S-pipe's corpus that overflows the packet", async () => {
    const { run } = await stageFixture(researchV4TrimmedReply, undefined, undefined, researchV4TrimmedSources().slice(0, 16));
    const done = await run();
    expect(done.status).toBe("submitted");
    const extract = done.research!.stages.find(row => row.stage === "extract")!;
    expect(extract.quotesVerified).toBeGreaterThan(extract.quotesInPacket!);
    expect(extract.quotesLeftByCap).toBe(extract.quotesVerified! - extract.quotesInPacket!);
    expect(extract).toMatchObject({ chunksPlanned: 16, chunksComplete: 16 });
  });
});
