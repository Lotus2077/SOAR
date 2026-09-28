import { afterEach, describe, expect, it, vi } from "vitest";
import { createSoarDatabase, type SoarDatabase } from "../../src/main/database";
import { PatchRunStore } from "../../src/main/patch-runs/store";
import { patchPolicyLimits, type PatchRuntimeConfig } from "../../src/main/patch-runs/config";
import { canonicalRequest } from "../../src/main/patch-runs/native-contract";
import { checkpoint, hash, nativeBody, nativePair, nativeRuntime, preparedNative } from "../helpers/patch-native-fixture";
import type { PatchRunCheckpoint, PatchRunPlannerCheck, PatchRunPlannerCheckResult } from "../../src/shared/patch-run-contracts";

const childState = vi.hoisted(() => ({ child: undefined as any }));
vi.mock("node:child_process", async original => {
  const actual = await original<typeof import("node:child_process")>();
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  const { promisify } = await import("node:util");
  return { ...actual, execFile: Object.assign(vi.fn(), { [promisify.custom]: async () => ({ stdout: "", stderr: "" }) }),
    spawn: vi.fn(() => childState.child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })) };
});
import { launchPatchWorker } from "../../src/main/patch-runs/worker";

const databases: SoarDatabase[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); childState.child = undefined; vi.restoreAllMocks(); });
const source = "import unittest\nclass Public(unittest.TestCase):\n    def test_public(self):\n        self.assertEqual(2 + 2, 4)\n";
const artifact = { schemaVersion: 1, kind: "model_generated_python_unittest", source, expectedTests: 1,
  sha256: hash(source), testIds: ["Public.test_public"] } as const;
const usage = { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, reported: true };
const prefix = "SOAR_MODEL_GENERATED_CHECKS_V1=";
const successfulResult = (changes: Partial<PatchRunPlannerCheckResult> = {}): PatchRunPlannerCheckResult => ({
  schemaVersion: 1, kind: "model_generated_python_unittest", sourceSha256: artifact.sha256,
  expectedTests: 1, discoveredTests: 1, testsRun: 1, passed: 1, failures: 0, errors: 0, skipped: 0, expectedFailures: 0,
  unexpectedSuccesses: 0, completed: true, status: "passed", detail: "", ...changes,
});
const initial = () => checkpoint(undefined, { policy: "cloud_plan_local", state: "planner", reason: "cloud_plan_required",
  evidence: { maxLocalCalls: 24, finishReserve: 2, checkSchedule: "host_repair_window", hostCheckUsed: false } });

function harness(overrides: Partial<PatchRuntimeConfig> = {}) {
  const db = createSoarDatabase(); databases.push(db); const store = new PatchRunStore(db);
  const run = store.create({ workspaceRoot: "/fixture/seed", objective: "Fix public behavior", policy: "cloud_plan_local", executionMode: "live",
    baseRevision: "a".repeat(40), visibleTestCommand: "python public_cases.py", maxCostMicrousd: 3_000_000 });
  store.start(run.id);
  const config: PatchRuntimeConfig = { ...nativeRuntime, localCodingCheckSchedule: "host_repair_window", plannerMode: "plan_and_checks", ...overrides };
  const worker = launchPatchWorker({ config, store, snapshot: store.get(run.id), workspace: "/fixture/copy", image: "fixture", publish: vi.fn() });
  let sequence = 0, current = initial(); const history: unknown[] = [];
  const emit = (value: Record<string, unknown>) => childState.child.stdout.write(JSON.stringify({ protocolVersion: 1, runId: run.id, sequence: ++sequence, ...value }) + "\n");
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  const end = async (status: "completed" | "failed" = "failed") => {
    emit({ type: "terminal", status, ...(status === "failed" ? { errorCode: "fixture_end" } : {}) });
    await flush(); childState.child.emit("close", status === "completed" ? 0 : 1, null); await worker.done; return store.get(run.id);
  };
  const next = (changes: Partial<PatchRunCheckpoint>) => checkpoint(current, {
    policy: "cloud_plan_local", localCalls: current.localCalls, remainingLocalCalls: current.remainingLocalCalls,
    sourceSha256: current.sourceSha256, checkSourceSha256: current.checkSourceSha256, failedChecks: current.failedChecks,
    ...changes, evidence: { checkSchedule: "host_repair_window", hostCheckUsed: current.evidence.hostCheckUsed,
      ...(current.evidence.plannerChecksSha256 ? { plannerChecksSha256: current.evidence.plannerChecksSha256 } : {}), ...changes.evidence },
  });
  const emitCheckpoint = (value: PatchRunCheckpoint) => { current = value; emit({ type: "routing.checkpoint", checkpoint: value }); return value; };
  const plan = (checks: unknown = artifact, settle = true, summary = "Repair the public behavior.") => {
    emit({ type: "phase.started", phase: "planner", model: config.cloud!.model });
    const provider = config.cloud!, requestId = "f".repeat(32);
    const body = { model: provider.model, messages: [{ role: "system", content: "Plan from public inputs." }], max_tokens: 4096, stream: false };
    const encoded = canonicalRequest(body), digest = hash(encoded);
    emit({ type: "request.prepare", phase: "planner", model: provider.model, requestId, maxOutputTokens: 4096,
      estimatedInputTokens: Buffer.byteLength(encoded), bodySha256: digest,
      provider: { id: provider.id, protocol: provider.protocol, endpoint: provider.endpoint },
      preparedRequest: { method: "POST", url: provider.endpoint, body, bodySha256: digest } });
    if (settle) emit({ type: "request.finished", requestId, usage });
    emit({ type: "plan.ready", summary, sha256: hash(summary),
      ...(checks == null ? {} : { checks }) });
  };
  const enterLocal = (binding: string | undefined = artifact.sha256) => {
    emitCheckpoint(next({ reason: "cloud_plan_completed", evidence: { requestSettled: true, cancelled: false,
      ...(binding === undefined ? {} : { plannerChecksSha256: binding }) } }));
    emit({ type: "phase.started", phase: "local", model: config.local!.model });
  };
  const request = () => {
    const call = current.localCalls + 1, requestId = call.toString(16).padStart(32, "0");
    emitCheckpoint(next({ reason: "local_request_started", eventId: requestId, localCalls: call, remainingLocalCalls: 24 - call, evidence: { requestId } }));
    const body = nativeBody(current.allowedActions); body.messages = [...body.messages as unknown[], ...history];
    emit({ type: "request.prepare", ...preparedNative(body, requestId) }); emit({ type: "request.finished", requestId, usage });
  };
  const command = () => {
    emit({ type: "command.started", command: "python edit.py" }); emit({ type: "command.finished", returncode: 0, output: "Edited source" });
    history.push(...nativePair(`action-${current.localCalls}`, "run_command", '{"command":"python edit.py"}'));
    emitCheckpoint(next({ reason: "command_observed", sourceSha256: hash(`source-${current.localCalls}`), checkSourceSha256: null }));
  };
  const startHost = () => emitCheckpoint(next({ reason: "host_check_started", allowedActions: [],
    evidence: { hostCheckUsed: true, visibleCommandSha256: hash("python public_cases.py") } }));
  let visible = { before: current.sourceSha256, after: current.sourceSha256, code: 0, completed: true, timedOut: false };
  let generated: PatchRunPlannerCheck | undefined;
  const visibleCheck = (code = 0, after = current.sourceSha256, timedOut = false) => {
    visible = { before: current.sourceSha256, after, code, completed: !timedOut, timedOut }; generated = undefined;
    emit({ type: "checkpoint.checked", command: "python public_cases.py", returncode: code, output: code ? "Failed" : "Passed", elapsedMs: 1,
      sourceSha256: visible.before, sourceAfterSha256: after, passed: code === 0 && after === visible.before && !timedOut,
      completed: !timedOut, timedOut });
    if (current.reason !== "host_check_started") history.push(...nativePair(`action-${current.localCalls}`, "run_visible_checks", "{}"));
  };
  const generatedCheck = (changes: Partial<PatchRunPlannerCheck> = {}, resultChanges: Partial<PatchRunPlannerCheckResult> = {}) => {
    const result = successfulResult(resultChanges);
    const value: PatchRunPlannerCheck = { stage: "checkpoint", artifactSha256: artifact.sha256,
      sourceSha256: visible.before, sourceAfterSha256: visible.before, exitCode: { passed: 0, failed: 1, invalid: 2 }[result.status],
      output: prefix + JSON.stringify(result), outputTruncated: false, elapsedMs: 1, timedOut: false, result,
      passed: result.status === "passed", fresh: true, ...changes };
    generated = value; emit({ type: "planner.checks.checked", ...value }); return value;
  };
  const finishCheck = (changes: Partial<PatchRunCheckpoint> = {}) => {
    const timedOut = visible.timedOut || generated?.timedOut, invalid = !visible.timedOut && !generated?.result?.completed;
    const passed = visible.code === 0 && visible.before === visible.after && generated?.passed === true;
    const failedChecks = current.failedChecks + (timedOut || invalid || passed ? 0 : 1);
    const reason = timedOut ? "check_timeout" : invalid ? "planner_check_invalid" : passed ? "visible_check_passed" :
      failedChecks >= 2 ? "visible_checks_failed" : visible.before !== visible.after ? "visible_check_tree_changed" :
        visible.code ? "visible_check_failed" : "planner_check_failed";
    emitCheckpoint(next({ reason, decision: timedOut || invalid ? "stop" : failedChecks >= 2 ? "checkpoint" : "continue",
      state: timedOut || invalid ? "stopped" : failedChecks >= 2 ? "checkpoint" : "local",
      sourceSha256: visible.after, checkSourceSha256: passed && !timedOut && !invalid ? visible.after : null, failedChecks,
      handoffCandidate: !timedOut && !invalid && failedChecks >= 2,
      evidence: { returncode: visible.code, completed: visible.completed, timedOut: visible.timedOut,
        checkSourceBeforeSha256: visible.before, checkSourceAfterSha256: visible.after,
        ...(generated ? { plannerCheckPassed: generated.passed, plannerCheckCompleted: generated.result?.completed ?? false,
          plannerCheckTimedOut: generated.timedOut, plannerCheckSourceBeforeSha256: generated.sourceSha256,
          plannerCheckSourceAfterSha256: generated.sourceAfterSha256 } : {}) }, ...changes }));
  };
  const prepareFinal = () => {
    request(); emitCheckpoint(next({ reason: "fresh_visible_check", decision: "submit", state: "submitted" }));
    const patch = "diff --git a/code.py b/code.py\n--- a/code.py\n+++ b/code.py\n@@ -1 +1 @@\n-old\n+new\n";
    emit({ type: "patch.ready", patch, baseRevision: run.baseRevision, sha256: hash(patch) });
    emit({ type: "verification.started" });
    emit({ type: "verification.finished", returncode: 0, output: "Passed", sourceSha256: current.sourceSha256,
      sourceAfterSha256: current.sourceSha256, passed: true });
  };
  emit({ type: "ready", runId: "" }); emit({ type: "routing.checkpoint", checkpoint: current });
  return { store, id: run.id, config, emit, flush, end, next, emitCheckpoint, plan, enterLocal, request, command, startHost,
    visibleCheck, generatedCheck, finishCheck, prepareFinal, current: () => current };
}

describe("planner-check worker lifecycle", () => {
  it("preserves legacy limits byte-for-byte and admits only the explicit live 24/40 planned-host profile", () => {
    for (const policy of ["cloud_plan_local", "cloud_plan_local_review"] as const) {
      const base = patchPolicyLimits(nativeRuntime, policy);
      expect(JSON.stringify(patchPolicyLimits({ ...nativeRuntime, plannerMode: "plan" }, policy))).toBe(JSON.stringify(base));
      expect(base).not.toHaveProperty("plannerMode");
      expect(patchPolicyLimits({ ...nativeRuntime, plannerMode: "plan_and_checks", localCodingCheckSchedule: "host_repair_window" }, policy))
        .toMatchObject({ plannerMode: "plan_and_checks", stepLimit: 40, localStepLimit: 24, wallTimeSeconds: 600, visibleCheckTimeoutSeconds: 60 });
    }
    for (const override of [{ mode: "scripted" }, { localCodingCheckSchedule: "final_only" }, { stepLimit: 23 }, { plannerMode: "unexpected" }, { plannerMode: null }]) {
      expect(() => patchPolicyLimits({ ...nativeRuntime, plannerMode: "plan_and_checks", localCodingCheckSchedule: "host_repair_window", ...override } as PatchRuntimeConfig,
        "cloud_plan_local")).toThrow();
    }
    for (const policy of ["local_only", "local_first", "cloud", "prepared_cloud", "hybrid"] as const) {
      expect(() => patchPolicyLimits({ ...nativeRuntime, plannerMode: "plan_and_checks", localCodingCheckSchedule: "host_repair_window" }, policy)).toThrow();
    }
  });

  it.each(["valid", "missing", "wrong_hash", "secret", "unsettled", "default_injection", "binding_changed"])("binds the one settled plan artifact before local admission: %s", async kind => {
    const h = harness(kind === "default_injection" ? { plannerMode: "plan" } : {});
    const checks = kind === "missing" ? null : kind === "wrong_hash" ? { ...artifact, sha256: "0".repeat(64) } :
      kind === "secret" ? { ...artifact, source: source + h.config.cloud!.apiKey, sha256: hash(source + h.config.cloud!.apiKey) } : artifact;
    h.plan(checks, kind !== "unsettled");
    h.enterLocal(kind === "binding_changed" ? "b".repeat(64) : artifact.sha256);
    await h.flush(); if (kind === "valid") expect(childState.child.kill).not.toHaveBeenCalled();
    const result = await h.end();
    expect(result.phaseUsage?.planner).toMatchObject({ requestCount: 1, usageReceipts: kind === "unsettled" ? 0 : 1,
      unknownRequests: kind === "unsettled" ? 1 : 0 });
    expect(result.phaseUsage?.local).toBeUndefined();
    if (["valid", "binding_changed"].includes(kind)) expect(result.cloudPlan?.checks).toBeDefined();
    if (!["valid", "binding_changed"].includes(kind)) expect(result.cloudPlan).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(h.config.cloud!.apiKey);
    expect(h.store.replay(h.id)).toEqual(result);
  });

  it("reserves time for both check commands before admitting the planner request", async () => {
    const h = harness(); const now = performance.now(); vi.spyOn(performance, "now").mockReturnValue(now + 400_000);
    h.plan(); const result = await h.end();
    expect(result.error).toMatch(/final check reserve/); expect(result.phaseUsage).toBeUndefined();
    expect(result.reservedMicrousd).toBe(0);
  });

  it("independently enforces the planner summary's UTF-8, NUL and nonblank boundaries after accounting", async () => {
    for (const summary of ["\ud800", "plan\0text", "   ", "中".repeat(1334)]) {
      const h = harness(); h.plan(artifact, true, summary); const result = await h.end();
      expect(result.error).toMatch(/UTF-8 envelope/); expect(result.cloudPlan).toBeUndefined();
      expect(result.phaseUsage?.planner).toMatchObject({ requestCount: 1, usageReceipts: 1, spentMicrousd: 120, unknownRequests: 0 });
    }
  });

  it("uses paired host failure as feedback, repairs, checks again, and requires separate final checks without adding model calls", async () => {
    const h = harness(); h.plan(); h.enterLocal();
    for (let call = 0; call < 4; call++) { h.request(); h.command(); }
    h.startHost(); h.visibleCheck(); h.generatedCheck({ passed: false }, { status: "failed", passed: 0, failures: 1 }); h.finishCheck();
    await h.flush(); expect(childState.child.kill).not.toHaveBeenCalled();
    expect(h.store.get(h.id).checkpoint).toMatchObject({ reason: "planner_check_failed", localCalls: 4, failedChecks: 1, checkSourceSha256: null });
    expect(h.store.get(h.id).phaseUsage?.local?.requestCount).toBe(4);
    h.request(); h.command(); h.request(); h.visibleCheck(); h.generatedCheck(); h.finishCheck();
    h.prepareFinal(); h.generatedCheck({ stage: "final" });
    const result = await h.end("completed");
    expect(result.status).toBe("completed");
    expect(result.phaseUsage?.local).toMatchObject({ requestCount: 7, usageReceipts: 7, unknownRequests: 0 });
    expect(result.phaseUsage?.planner).toMatchObject({ requestCount: 1, usageReceipts: 1, spentMicrousd: 120 });
    expect(result.checks.status).toBe("passed"); expect(result.plannerCheck).toMatchObject({ stage: "final", passed: true, fresh: true });
    expect(result.events.filter(event => event.type === "planner.checks.checked")).toHaveLength(3);
    expect(h.store.replay(h.id)).toEqual(result);
  });

  it.each(["malformed", "nul_output", "duplicate_json", "duplicate_valid_json", "timeout", "truncated", "mutated", "wrong_artifact", "wrong_source", "forged_result", "suppressed_result", "duplicate_event", "missing_event", "unsolicited"])(
    "retains negative results and rejects generated receipt authority bypass: %s", async kind => {
      const h = harness(); h.plan(); h.enterLocal(); h.request();
      if (kind !== "unsolicited") h.visibleCheck();
      if (kind !== "missing_event") {
        const changes: Partial<PatchRunPlannerCheck> = {};
        const duplicateOutput = prefix + JSON.stringify(successfulResult()).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1');
        if (["malformed", "nul_output", "timeout", "truncated", "duplicate_json"].includes(kind)) Object.assign(changes, {
          result: null, passed: false, output: kind === "duplicate_json" ? duplicateOutput : kind === "nul_output" ? "invalid\0output" : "invalid output",
          timedOut: kind === "timeout", outputTruncated: kind === "truncated" });
        if (kind === "mutated") Object.assign(changes, { sourceAfterSha256: "b".repeat(64), fresh: false, passed: false });
        if (kind === "wrong_artifact") changes.artifactSha256 = "b".repeat(64);
        if (kind === "wrong_source") Object.assign(changes, { sourceSha256: "b".repeat(64), sourceAfterSha256: "b".repeat(64) });
        if (kind === "forged_result") changes.output = "malformed output";
        if (kind === "duplicate_valid_json") changes.output = duplicateOutput;
        if (kind === "suppressed_result") Object.assign(changes, { result: null, passed: false });
        h.generatedCheck(changes);
        if (kind === "duplicate_event") h.generatedCheck();
      }
      h.finishCheck(); await h.flush();
      const retained = ["malformed", "nul_output", "timeout", "truncated", "duplicate_json", "mutated"].includes(kind);
      if (retained) expect(childState.child.kill).not.toHaveBeenCalled(); else expect(childState.child.kill).toHaveBeenCalled();
      const result = await h.end();
      expect(result.phaseUsage?.local).toMatchObject({ requestCount: 1, usageReceipts: 1, unknownRequests: 0 });
      expect(result.events.filter(event => event.type === "planner.checks.checked")).toHaveLength(retained || kind === "duplicate_event" ? 1 : 0);
      if (retained) expect(result.checkpoint?.reason).toBe(kind === "mutated" ? "planner_check_failed" : kind === "timeout" ? "check_timeout" : "planner_check_invalid");
      expect(h.store.replay(h.id)).toEqual(result);
    });

  it("retains a visible timeout without fabricating a generated execution receipt", async () => {
    const h = harness(); h.plan(); h.enterLocal(); h.request(); h.visibleCheck(124, h.current().sourceSha256, true); h.finishCheck();
    await h.flush(); expect(childState.child.kill).not.toHaveBeenCalled(); const result = await h.end();
    expect(result.checkpoint).toMatchObject({ reason: "check_timeout", state: "stopped", failedChecks: 0 });
    expect(result.plannerCheck).toBeUndefined(); expect(result.events.filter(event => event.type === "planner.checks.checked")).toHaveLength(0);
  });

  it.each(["before_generated", "after_generated"])("retains cancellation between verifier receipts and observation: %s", async kind => {
    const h = harness(); h.plan(); h.enterLocal(); h.request(); h.visibleCheck();
    if (kind === "after_generated") h.generatedCheck();
    h.emitCheckpoint(h.next({ state: "stopped", decision: "stop", reason: "cancelled" }));
    await h.flush(); expect(childState.child.kill).not.toHaveBeenCalled();
    const result = await h.end(); expect(result.checkpoint).toMatchObject({ reason: "cancelled", state: "stopped", localCalls: 1 });
    expect(result.events.filter(event => event.type === "planner.checks.checked")).toHaveLength(kind === "after_generated" ? 1 : 0);
    expect(h.store.replay(h.id)).toEqual(result);
  });

  it("clears a prior passing authority when a failed recheck is cancelled before observation", async () => {
    const h = harness(); h.plan(); h.enterLocal(); h.request(); h.visibleCheck(); h.generatedCheck(); h.finishCheck();
    h.request(); h.visibleCheck(); h.generatedCheck({ passed: false }, { status: "failed", passed: 0, failures: 1 });
    const sourceBeforeStop = h.current().sourceSha256;
    h.emitCheckpoint(h.next({ state: "stopped", decision: "stop", reason: "cancelled", checkSourceSha256: null }));
    await h.flush(); expect(childState.child.kill).not.toHaveBeenCalled();
    const result = await h.end();
    expect(result.checkpoint).toMatchObject({ reason: "cancelled", state: "stopped", localCalls: 2,
      sourceSha256: sourceBeforeStop, checkSourceSha256: null, failedChecks: 0 });
    expect(result.plannerCheck).toMatchObject({ passed: false, result: { status: "failed" } });
    expect(result.phaseUsage?.local).toMatchObject({ requestCount: 2, usageReceipts: 2, unknownRequests: 0 });
    expect(h.store.replay(h.id)).toEqual(result);
  });

  it.each(["missing", "failed", "duplicate", "wrong_source"])("cannot complete from checkpoint checks alone or an invalid final check: %s", async kind => {
    const h = harness(); h.plan(); h.enterLocal(); h.request(); h.visibleCheck(); h.generatedCheck(); h.finishCheck(); h.prepareFinal();
    if (kind !== "missing") {
      h.generatedCheck({ stage: "final", ...(kind === "failed" ? { passed: false } : {}),
        ...(kind === "wrong_source" ? { sourceSha256: "b".repeat(64), sourceAfterSha256: "b".repeat(64) } : {}) },
      kind === "failed" ? { status: "failed", passed: 0, failures: 1 } : {});
      if (kind === "duplicate") h.generatedCheck({ stage: "final" });
    }
    const result = await h.end("completed");
    expect(result.status).toBe("failed"); expect(result.checks.status).toBe("passed");
    expect(h.store.replay(h.id)).toEqual(result);
  });
});
