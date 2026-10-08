import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, symlinkSync, linkSync, rmSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeneralTaskController, type GeneralTaskControllerOptions } from "../../src/main/general-tasks/controller";
import type { SoarConfig } from "../../src/main/config";
import { canonical, digest, contextFingerprint } from "../../src/main/private-agent/contracts";
import { GeneralAgentRunner, type GeneralJobOptions } from "../../src/main/private-agent/runner";
import { DockerSandbox } from "../../src/main/private-agent/sandbox";
import { EXECUTION_PROGRESS_STOP } from "../../src/main/private-agent/progress";
import { PrivateAgentModel } from "../../src/main/private-agent/model";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0).reverse()) await fn(); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "soar-general-controller-")); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const db = new Database(join(root, "desktop.sqlite")); cleanup.push(() => { db.close(); });
  const input = join(root, "source.csv"); writeFileSync(input, "value\n21\n");
  const config: SoarConfig = { providerMode: "local", hybridSimulationEnabled: false, fakeCloudScenario: "success", fakeDelayMs: 0, generalTaskProfile: "standard",
    vllm: { baseUrl: "http://127.0.0.1:9999/v1", apiKey: "host-key-a", model: "unit-fixture", costPolicy: "local_zero_cost", maxOutputTokens: 8192, timeoutMs: 300000 },
    limits: { inferenceRounds: 24, toolCalls: 24 }, context: { maxInputTokens: 32000, safetyMargin: 0.2 } };
  let runtimeIdentity = digest("runtime-v1"), imageId: string | undefined = `sha256:${"a".repeat(64)}`;
  let paused = false, cancelled = false, failModel = false, narrate = false, release: (() => void) | undefined;
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
        store.append(jobId, { type: "run_ended", contextId, cleanupConfirmed: true, elapsedMs: 12 });
        return { status: "incomplete", reason: "model_unavailable", snapshot: [], checks: [], modelCalls: executions.length };
      }
      store.append(jobId, { type: "model_finished", contextId, operationId: op });
      const snapshot = checkpoints.save([...args.files, { path: args.contract.requiredArtifacts[0]!.path, bytes: Buffer.from("unit artifact") }]);
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
      store.append(jobId, { type: "run_ended", contextId, cleanupConfirmed: true, elapsedMs: 12 });
      return { status, reason: "unit_fixture", snapshot, checks, modelCalls: executions.length };
    },
  });
  const options: GeneralTaskControllerOptions = { database: db, dataRoot: join(root, "tasks"), config: () => config,
    imageId: () => imageId, runtimeIdentity: () => runtimeIdentity, testing: { readiness: async () => {}, runnerFactory: factory } };
  const controller = new GeneralTaskController(options); cleanup.push(() => controller.close());
  const create = () => controller.create({ goal: "Make a small report.", inputSelectionId: controller.selectInputs([input]).id, outputName: "report.md", publicOrSynthetic: true });
  return { root, db, input, config, controller, options, executions, create, set failModel(value: boolean) { failModel = value; }, set narrate(value: boolean) { narrate = value; },
    changeRuntime() { runtimeIdentity = digest("runtime-v2"); }, removeImage() { imageId = undefined; },
    hold() { hold = new Promise<void>(yes => { release = yes; }); }, release() { release?.(); hold = undefined; }, resetPaused() { paused = false; } };
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
      async listFiles() { return input.files.map(file => file.path); },
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
});
