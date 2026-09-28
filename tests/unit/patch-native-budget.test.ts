import { afterEach, describe, expect, it, vi } from "vitest";
import { createSoarDatabase, type SoarDatabase } from "../../src/main/database";
import { PatchRunStore } from "../../src/main/patch-runs/store";
import { patchPolicyLimits, type PatchRuntimeConfig } from "../../src/main/patch-runs/config";
import { checkpoint, hash, nativeBody, nativePair, nativeRuntime, preparedNative } from "../helpers/patch-native-fixture";
import { PatchRunCheckpointSchema, type PatchRunCheckpoint } from "../../src/shared/patch-run-contracts";

const state = vi.hoisted(() => ({ child: undefined as any }));
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  const { promisify } = await import("node:util");
  return { ...actual,
    execFile: Object.assign(vi.fn(), { [promisify.custom]: async () => ({ stdout: "", stderr: "" }) }),
    spawn: vi.fn(() => {
      state.child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
      return state.child;
    }) };
});
import { launchPatchWorker, validateNativeCheckpointBudget } from "../../src/main/patch-runs/worker";

const databases: SoarDatabase[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); state.child = undefined; });
const usage = { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, reported: true };
function initial(cap = 8, checkSchedule?: PatchRuntimeConfig["localCodingCheckSchedule"]) {
  return checkpoint(undefined, { policy: "local_only", localCalls: 0, remainingLocalCalls: cap,
    evidence: { maxLocalCalls: cap, finishReserve: 2, ...(checkSchedule ? { checkSchedule } : {}),
      ...(checkSchedule === "host_repair_window" ? { hostCheckUsed: false } : {}) } });
}
function harness(overrides: Partial<PatchRuntimeConfig> = {}) {
  const db = createSoarDatabase(); databases.push(db); const store = new PatchRunStore(db);
  const run = store.create({ workspaceRoot: "/fixture/seeded", objective: "Bounded local repair", policy: "local_only", executionMode: "live",
    baseRevision: "a".repeat(40), visibleTestCommand: "python public_cases.py", maxCostMicrousd: 3_000_000 });
  store.start(run.id); const config = { ...nativeRuntime, localCodingMaxCalls: 8, ...overrides };
  const worker = launchPatchWorker({ config, store, snapshot: store.get(run.id), workspace: "/fixture/copy", image: "fixture-image", publish: vi.fn() });
  let sequence = 0;
  const emit = (event: Record<string, unknown>) => state.child.stdout.write(JSON.stringify({ protocolVersion: 1, runId: run.id, sequence: ++sequence, ...event }) + "\n");
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  const end = async () => { emit({ type: "terminal", status: "failed", errorCode: "fixture_end" }); await flush(); state.child.emit("close", 1, null); await worker.done; return store.get(run.id); };
  emit({ type: "ready", runId: "" }); emit({ type: "routing.checkpoint", checkpoint: initial(8, config.localCodingCheckSchedule) });
  emit({ type: "phase.started", phase: "local", model: config.local!.model });
  return { db, store, id: run.id, config, emit, flush, end };
}

function hostHarness() {
  const h = harness({ localCodingCheckSchedule: "host_repair_window" });
  let current = initial(8, "host_repair_window");
  const history: unknown[] = [];
  const next = (changes: Partial<PatchRunCheckpoint>) => checkpoint(current, {
    policy: "local_only", localCalls: current.localCalls, remainingLocalCalls: current.remainingLocalCalls,
    sourceSha256: current.sourceSha256, checkSourceSha256: current.checkSourceSha256, failedChecks: current.failedChecks,
    ...changes, evidence: { checkSchedule: "host_repair_window", hostCheckUsed: current.evidence.hostCheckUsed, ...changes.evidence },
  });
  const emitCheckpoint = (value: PatchRunCheckpoint) => { current = value; h.emit({ type: "routing.checkpoint", checkpoint: value }); return value; };
  const request = (settle = true) => {
    const call = current.localCalls + 1, requestId = call.toString(16).repeat(32);
    emitCheckpoint(next({ reason: "local_request_started", eventId: requestId,
      localCalls: call, remainingLocalCalls: 8 - call, evidence: { requestId } }));
    const body = nativeBody(current.allowedActions);
    body.messages = [...body.messages as unknown[], ...history];
    h.emit({ type: "request.prepare", ...preparedNative(body, requestId) });
    if (settle) h.emit({ type: "request.finished", requestId, usage });
    return requestId;
  };
  const command = () => {
    const call = current.localCalls;
    h.emit({ type: "command.started", command: "python edit.py" });
    h.emit({ type: "command.finished", returncode: 0, output: "Changed public source" });
    history.push(...nativePair(`action-${call}`, "run_command", '{"command":"python edit.py"}'));
    return emitCheckpoint(next({ reason: "command_observed", sourceSha256: hash(`source-${call}`), checkSourceSha256: null }));
  };
  const startHost = () => emitCheckpoint(next({ reason: "host_check_started", allowedActions: [],
    evidence: { hostCheckUsed: true, visibleCommandSha256: hash("python public_cases.py") } }));
  const receipt = (code = 0, after = current.sourceSha256) => {
    h.emit({ type: "checkpoint.checked", command: "python public_cases.py", returncode: code, output: code ? "Failed" : "Passed",
      elapsedMs: 1, sourceSha256: current.sourceSha256, sourceAfterSha256: after, passed: code === 0 && after === current.sourceSha256 });
  };
  const check = (code = 0, host = false, after = current.sourceSha256) => {
    const before = current.sourceSha256, passed = code === 0 && before === after;
    receipt(code, after);
    if (!host) history.push(...nativePair(`action-${current.localCalls}`, "run_visible_checks", "{}"));
    return emitCheckpoint(next({ reason: before !== after ? "visible_check_tree_changed" : passed ? "visible_check_passed" : "visible_check_failed",
      sourceSha256: after, checkSourceSha256: passed ? after : null, failedChecks: current.failedChecks + (passed ? 0 : 1),
      evidence: { commandSha256: hash("python public_cases.py"), returncode: code, completed: true, timedOut: false,
        checkSourceBeforeSha256: before, checkSourceAfterSha256: after } }));
  };
  const advance = (count = 4) => { for (let index = 0; index < count; index++) { request(); command(); } };
  return { ...h, next, emitCheckpoint, request, command, startHost, receipt, check, advance, current: () => current };
}

describe("bounded native call authority", () => {
  it("admits host checks only as an explicit native profile without reallocating existing call budgets", () => {
    for (const policy of ["local_only", "local_first", "cloud_plan_local", "cloud_plan_local_review"] as const) {
      const ordinary = patchPolicyLimits(nativeRuntime, policy);
      const host = patchPolicyLimits({ ...nativeRuntime, localCodingCheckSchedule: "host_repair_window" }, policy);
      expect(host).toEqual({ ...ordinary, localCoding: { ...ordinary.localCoding, checkSchedule: "host_repair_window" } });
      expect([host.stepLimit, host.localStepLimit]).toEqual([40, 24]);
      if (policy !== "local_only") expect(() => patchPolicyLimits({ ...nativeRuntime,
        localCodingMaxCalls: 8, localCodingCheckSchedule: "host_repair_window" }, policy)).toThrow(/local_only/);
    }
    for (const policy of ["prepared_cloud", "cloud", "hybrid"] as const) {
      expect(() => patchPolicyLimits({ ...nativeRuntime, localCodingCheckSchedule: "host_repair_window" }, policy)).toThrow(/native policy/);
    }
    for (const cap of [2, 3, 4]) expect(() => patchPolicyLimits({ ...nativeRuntime,
      localCodingMaxCalls: cap, localCodingCheckSchedule: "host_repair_window" }, "local_only")).toThrow(/five/);
    expect(() => patchPolicyLimits({ ...nativeRuntime, stepLimit: 8,
      localCodingCheckSchedule: "host_repair_window" }, "local_only")).toThrow(/total call budget/);
    expect(patchPolicyLimits({ ...nativeRuntime, localCodingMaxCalls: 5,
      localCodingCheckSchedule: "host_repair_window" }, "local_only")).toMatchObject({ stepLimit: 5, localStepLimit: 5 });
  });

  it("runs one host check after four settled actions, preserves all eight model calls, and submits only after a fresh later check", async () => {
    const h = hostHarness(); h.advance(); await h.flush();
    const before = h.store.get(h.id).phaseUsage;
    h.startHost(); h.check(1, true); await h.flush();
    expect(state.child.kill).not.toHaveBeenCalled();
    expect(h.store.get(h.id).phaseUsage).toEqual(before);
    expect(h.store.get(h.id).checkpoint).toMatchObject({ localCalls: 4, remainingLocalCalls: 4, failedChecks: 1,
      evidence: { hostCheckUsed: true } });
    h.request(); h.command(); h.request(); h.command(); h.request(); h.check();
    h.request(); h.emitCheckpoint(h.next({ state: "submitted", decision: "submit", reason: "fresh_visible_check" }));
    await h.flush(); expect(state.child.kill).not.toHaveBeenCalled();
    const result = await h.end();
    expect(result.checkpoint).toMatchObject({ state: "submitted", localCalls: 8, remainingLocalCalls: 0, failedChecks: 1 });
    expect(result.checkpointCheck).toMatchObject({ passed: true, fresh: true, sourceSha256: hash("source-6") });
    expect(result.phaseUsage?.local).toMatchObject({ requestCount: 8, usageReceipts: 8, unknownRequests: 0, spentMicrousd: 0 });
    expect(result.events.filter(event => event.type === "checkpoint.checked")).toHaveLength(2);
    expect(h.store.replay(h.id)).toEqual(result);
  });

  it.each(["fresh", "failed"])("skips the initial host window after a %s explicit check and cannot revive it after a later edit", async kind => {
    const h = hostHarness(); h.advance(3); h.request(); h.check(kind === "fresh" ? 0 : 1);
    h.request(); h.command(); await h.flush();
    expect(state.child.kill).not.toHaveBeenCalled();
    h.startHost(); const result = await h.end();
    expect(result.error).toMatch(/initial window/);
    expect(result.phaseUsage?.local).toMatchObject({ requestCount: 5, usageReceipts: 5 });
    expect(result.events.filter(event => event.type === "checkpoint.checked")).toHaveLength(1);
    expect(result.checkpoint?.evidence.hostCheckUsed).toBe(false);
    expect(h.store.replay(h.id)).toEqual(result);
  });

  it.each(["late", "duplicate", "wrong_command", "source_changed", "no_observation", "forged_observation", "unsettled", "ordinary_profile", "skipped_host"])(
    "rejects a forged host start before check execution: %s", async kind => {
      if (kind === "ordinary_profile") {
        const h = harness(); h.emit({ type: "routing.checkpoint", checkpoint: checkpoint(initial(), {
          reason: "host_check_started", policy: "local_only", localCalls: 4, remainingLocalCalls: 4, allowedActions: [],
          evidence: { hostCheckUsed: true } }) });
        const result = await h.end(); expect(result.error).toMatch(/initial window/); expect(result.checkpointCheck).toBeUndefined(); return;
      }
      const needsRequest = ["no_observation", "forged_observation", "unsettled"].includes(kind);
      const h = hostHarness(); h.advance(needsRequest ? 3 : 4);
      if (needsRequest) h.request(kind !== "unsettled");
      if (kind === "forged_observation") h.emitCheckpoint(h.next({ reason: "initialized" }));
      if (kind === "skipped_host") h.request();
      else {
        if (kind === "duplicate") h.startHost();
        h.emitCheckpoint(h.next({ reason: "host_check_started", allowedActions: [],
          ...(kind === "late" ? { localCalls: 5, remainingLocalCalls: 3 } : {}),
          ...(kind === "source_changed" ? { sourceSha256: "f".repeat(64) } : {}),
          evidence: { hostCheckUsed: true, visibleCommandSha256: hash(kind === "wrong_command" ? "other command" : "python public_cases.py") } }));
      }
      const result = await h.end();
      expect(result.error).toMatch(/host check|Host check|Checkpoint is outside|completed action receipt/);
      expect(result.checkpointCheck).toBeUndefined();
      expect(result.phaseUsage?.local).toMatchObject({ requestCount: 4, usageReceipts: kind === "unsettled" ? 3 : 4,
        unknownRequests: kind === "unsettled" ? 1 : 0 });
      expect(h.store.replay(h.id)).toEqual(result);
    });

  it.each(["unsolicited", "duplicate_receipt", "foreign_source", "missing_receipt", "forged_pass", "reset_used", "request_overlap", "command_overlap", "timeout", "resume_after_stop"])(
    "binds host receipts and completion to one active invocation: %s", async kind => {
      const h = hostHarness(); h.advance();
      if (kind !== "unsolicited") h.startHost();
      if (kind === "unsolicited" || kind === "duplicate_receipt") {
        h.receipt(); if (kind === "duplicate_receipt") h.receipt();
      } else if (kind === "foreign_source") {
        h.emit({ type: "checkpoint.checked", command: "python public_cases.py", returncode: 0, output: "Passed", elapsedMs: 1,
          sourceSha256: "f".repeat(64), sourceAfterSha256: "f".repeat(64), passed: true });
      } else if (kind === "request_overlap") h.request();
      else if (kind === "command_overlap") h.emit({ type: "command.started", command: "python edit.py" });
      else if (kind === "timeout" || kind === "resume_after_stop") {
        h.emitCheckpoint(h.next({ state: "stopped", decision: "stop", reason: "check_timeout" }));
        if (kind === "resume_after_stop") h.request();
      }
      else {
        if (kind !== "missing_receipt") h.receipt(1);
        h.emitCheckpoint(h.next({ reason: "visible_check_passed", checkSourceSha256: h.current().sourceSha256,
          evidence: { hostCheckUsed: kind !== "reset_used", returncode: 0, completed: true, timedOut: false,
            checkSourceBeforeSha256: h.current().sourceSha256, checkSourceAfterSha256: h.current().sourceSha256 } }));
      }
      await h.flush();
      if (kind === "timeout") expect(state.child.kill).not.toHaveBeenCalled();
      else expect(state.child.kill).toHaveBeenCalled();
      const result = await h.end();
      expect(result.phaseUsage?.local).toMatchObject({ requestCount: 4, usageReceipts: 4, unknownRequests: 0 });
      expect(result.checkpoint?.reason).toBe(["timeout", "resume_after_stop"].includes(kind) ? "check_timeout" : kind === "unsolicited" ? "command_observed" : "host_check_started");
      expect(result.events.filter(event => event.type === "checkpoint.checked")).toHaveLength(
        ["duplicate_receipt", "forged_pass", "reset_used"].includes(kind) ? 1 : 0);
      expect(h.store.replay(h.id)).toEqual(result);
    });

  it.each(["valid", "impossible_subset", "malformed"])("accounts medium reasoning without double charging and stops invalid receipts: %s", async (kind) => {
    const h = harness({ localCodingThinking: "medium", local: { ...nativeRuntime.local!, inputUsdPerMillion: 1, outputUsdPerMillion: 2 } });
    const requestId = "a".repeat(32);
    const current = checkpoint(initial(), { policy: "local_only", reason: "local_request_started", eventId: requestId,
      evidence: { requestId }, localCalls: 1, remainingLocalCalls: 7 });
    const { chat_template_kwargs: _disabled, ...body } = nativeBody(current.allowedActions);
    body.reasoning_effort = "medium";
    h.emit({ type: "routing.checkpoint", checkpoint: current });
    h.emit({ type: "request.prepare", ...preparedNative(body, requestId) });
    h.emit({ type: "request.finished", requestId, usage: { ...usage, reasoningTokens: kind === "valid" ? 6 : kind === "impossible_subset" ? 11 : -1 } });
    await h.flush();
    if (kind === "valid") expect(state.child.kill).not.toHaveBeenCalled();
    const result = await h.end();
    const sent = state.child.stdin.read().toString().trim().split("\n").map((line: string) => JSON.parse(line));
    expect(sent[0].limits.localCoding).toEqual({ maxOutputTokens: 8192, maxInputBytes: 256000, thinking: "medium", checkSchedule: "final_only" });
    expect(sent.filter((value: any) => value.type === "request.admitted")).toHaveLength(1);
    if (kind === "malformed") {
      expect(result.phaseUsage?.local).toMatchObject({ requestCount: 1, usageReceipts: 0, unknownRequests: 1, spentMicrousd: 0 });
      expect(result.reservedMicrousd).toBeGreaterThan(0);
    } else {
      expect(result.phaseUsage?.local).toMatchObject({ requestCount: 1, usageReceipts: 1, unknownRequests: 0, spentMicrousd: 120,
        inputTokens: 100, outputTokens: 10, reasoningTokens: kind === "valid" ? 6 : 11 });
      expect(result.reservedMicrousd).toBe(0);
      if (kind === "impossible_subset") expect(result.error).toMatch(/reasoning usage exceeded total output/);
    }
    expect(result.events.some(event => event.type === "tool.started")).toBe(false);
    expect(h.store.replay(h.id)).toEqual(result);
  });

  it("binds initial limit, budget sum and pending finishing actions independently in main", () => {
    const limits = patchPolicyLimits({ ...nativeRuntime, localCodingMaxCalls: 8 }, "local_only"), start = initial();
    validateNativeCheckpointBudget(start, limits);
    expect(() => validateNativeCheckpointBudget(initial(24), limits)).toThrow(/budget/);
    const seventh = checkpoint(start, { policy: "local_only", reason: "local_request_started", localCalls: 7, remainingLocalCalls: 1 });
    expect(seventh.allowedActions).toEqual(["run_visible_checks", "request_help"]); validateNativeCheckpointBudget(seventh, limits);
    expect(() => validateNativeCheckpointBudget({ ...seventh, allowedActions: ["run_command", ...seventh.allowedActions] }, limits)).toThrow(/finishing/);
    const eighth = checkpoint(seventh, { policy: "local_only", reason: "local_request_started", localCalls: 8, remainingLocalCalls: 0,
      checkSourceSha256: seventh.sourceSha256 });
    expect(eighth.allowedActions).toEqual(["submit_task", "request_help"]); validateNativeCheckpointBudget(eighth, limits);
    expect(() => validateNativeCheckpointBudget({ ...eighth, allowedActions: ["run_visible_checks", ...eighth.allowedActions] }, limits)).toThrow(/finishing/);
    expect(() => validateNativeCheckpointBudget({ ...eighth, localCalls: 9, remainingLocalCalls: -1 }, limits)).toThrow(/budget/);
    expect(() => PatchRunCheckpointSchema.parse({ ...eighth, localCalls: 9, remainingLocalCalls: -1 })).toThrow();
    validateNativeCheckpointBudget(initial(24), patchPolicyLimits(nativeRuntime, "local_only"));
  });

  it("uses the existing parent process and real ledger to admit at most eight local requests", async () => {
    const h = harness(); let current = initial();
    for (let call = 1; call <= 8; call++) {
      const requestId = call.toString(16).repeat(32);
      current = checkpoint(current, { policy: "local_only", reason: "local_request_started", eventId: requestId,
        evidence: { requestId }, localCalls: call, remainingLocalCalls: 8 - call,
        ...(call === 8 ? { checkSourceSha256: current.sourceSha256 } : {}) });
      h.emit({ type: "routing.checkpoint", checkpoint: current });
      const body = nativeBody(current.allowedActions);
      body.messages = [...body.messages as unknown[], ...Array.from({ length: call - 1 }, (_, index) =>
        nativePair(`action-${index + 1}`, index === 6 ? "run_visible_checks" : "run_command", index === 6 ? "{}" : '{"command":"cat calculator.py"}')).flat()];
      h.emit({ type: "request.prepare", ...preparedNative(body, requestId) }); h.emit({ type: "request.finished", requestId, usage });
      if (call === 7) h.emit({ type: "checkpoint.checked", command: "python public_cases.py", returncode: 0, output: "Passed", elapsedMs: 1,
        sourceSha256: current.sourceSha256, sourceAfterSha256: current.sourceSha256, passed: true });
    }
    // Reusing the last checkpoint cannot manufacture a ninth request.
    h.emit({ type: "request.prepare", ...preparedNative(nativeBody(current.allowedActions), "8".repeat(32)) });
    const result = await h.end();
    expect(result.error).toMatch(/call limit/);
    expect(result.phaseUsage?.local).toMatchObject({ requestCount: 8, usageReceipts: 8, spentMicrousd: 0, reservedMicrousd: 0 });
    const sent = state.child.stdin.read().toString().trim().split("\n").map((line: string) => JSON.parse(line));
    expect(sent[0].limits).toMatchObject({ stepLimit: 8, localStepLimit: 8, finishingReserve: 2 });
    expect(sent[0].providers).not.toHaveProperty("cloud");
    expect(sent.filter((value: any) => value.type === "request.admitted")).toHaveLength(8);
    expect(h.store.replay(h.id)).toEqual(result);
  });

  it("binds the optional schedule while retaining historical final-only checkpoints", () => {
    const ordinary = patchPolicyLimits({ ...nativeRuntime, localCodingMaxCalls: 8 }, "local_only");
    const experimental = patchPolicyLimits({ ...nativeRuntime, localCodingMaxCalls: 8, localCodingCheckSchedule: "repair_window" }, "local_only");
    validateNativeCheckpointBudget(initial(), ordinary);
    validateNativeCheckpointBudget(initial(8, "final_only"), ordinary);
    validateNativeCheckpointBudget(initial(8, "repair_window"), experimental);
    expect(() => validateNativeCheckpointBudget(initial(), experimental)).toThrow(/schedule/);
    expect(() => validateNativeCheckpointBudget(initial(8, "repair_window"), ordinary)).toThrow(/schedule/);
    for (const invalid of [null, true, "early"]) {
      expect(() => validateNativeCheckpointBudget(checkpoint(undefined, { ...initial(), evidence: {
        ...initial().evidence, checkSchedule: invalid } }), ordinary)).toThrow();
    }
    const start = initial(8, "repair_window");
    expect(() => validateNativeCheckpointBudget({ ...start, policy: "local_first" }, experimental)).toThrow(/schedule/);
    expect(() => validateNativeCheckpointBudget(start, { ...experimental, stepLimit: 4 })).toThrow(/schedule/);
    expect(() => validateNativeCheckpointBudget(initial(4, "repair_window"), { ...experimental, localStepLimit: 4 })).toThrow(/schedule/);
  });

  it("enforces check five before and after request counting without repeating prior failures or fresh checks", () => {
    const limits = patchPolicyLimits({ ...nativeRuntime, localCodingMaxCalls: 8, localCodingCheckSchedule: "repair_window" }, "local_only");
    const start = initial(8, "repair_window");
    for (const [reason, calls] of [["command_observed", 4], ["local_request_started", 5]] as const) {
      const forced = checkpoint(start, { policy: "local_only", reason, localCalls: calls, remainingLocalCalls: 8 - calls,
        evidence: { checkSchedule: "repair_window" }, allowedActions: ["run_visible_checks", "request_help"] });
      validateNativeCheckpointBudget(forced, limits);
      expect(() => validateNativeCheckpointBudget({ ...forced, allowedActions: ["run_command", ...forced.allowedActions] }, limits)).toThrow(/finishing/);
      const priorFailure = checkpoint(start, { ...forced, failedChecks: 1,
        allowedActions: ["run_command", "run_visible_checks", "request_help"] });
      validateNativeCheckpointBudget(priorFailure, limits);
      const fresh = checkpoint(start, { ...forced, checkSourceSha256: forced.sourceSha256,
        allowedActions: ["run_command", "run_visible_checks", "submit_task", "request_help"] });
      validateNativeCheckpointBudget(fresh, limits);
      expect(() => validateNativeCheckpointBudget({ ...fresh, sourceSha256: "b".repeat(64) }, limits)).toThrow(/finishing/);
    }
    const repair = checkpoint(start, { policy: "local_only", reason: "local_request_started", localCalls: 6, remainingLocalCalls: 2,
      failedChecks: 1, evidence: { checkSchedule: "repair_window" } });
    expect(repair.allowedActions).toEqual(["run_command", "run_visible_checks", "request_help"]);
    validateNativeCheckpointBudget(repair, limits);
    const check = checkpoint(repair, { policy: "local_only", reason: "local_request_started", localCalls: 7, remainingLocalCalls: 1,
      failedChecks: 1, evidence: { checkSchedule: "repair_window" } });
    expect(check.allowedActions).toEqual(["run_visible_checks", "request_help"]);
    validateNativeCheckpointBudget(check, limits);
    const submit = checkpoint(check, { policy: "local_only", reason: "local_request_started", localCalls: 8, remainingLocalCalls: 0,
      failedChecks: 1, checkSourceSha256: check.sourceSha256, evidence: { checkSchedule: "repair_window" } });
    expect(submit.allowedActions).toEqual(["submit_task", "request_help"]);
    validateNativeCheckpointBudget(submit, limits);
  });

  it.each(["checkpoint_mask", "command_event", "schedule_downgrade"])("rejects repair-window authority bypass before tool execution: %s", async (kind) => {
    const h = harness({ localCodingCheckSchedule: "repair_window" });
    const current = checkpoint(initial(8, "repair_window"), { policy: "local_only", reason: "local_request_started",
      eventId: "5".repeat(32), localCalls: 5, remainingLocalCalls: 3,
      evidence: { requestId: "5".repeat(32), checkSchedule: kind === "schedule_downgrade" ? "final_only" : "repair_window" },
      allowedActions: kind === "checkpoint_mask" ? ["run_command", "run_visible_checks", "request_help"] : ["run_visible_checks", "request_help"] });
    h.emit({ type: "routing.checkpoint", checkpoint: current });
    if (kind === "command_event") h.emit({ type: "command.started", phase: "local", command: "python forbidden-edit.py" });
    const result = await h.end();
    expect(result.error).toMatch(kind === "schedule_downgrade" ? /schedule/ : /finishing/);
    expect(result.events.some(event => event.type === "tool.started")).toBe(false);
    expect(result.phaseUsage).toBeUndefined();
    expect(result.reservedMicrousd).toBe(0);
    expect(h.store.replay(h.id)).toEqual(result);
  });

  it("rejects a seventh-request edit event in main before recording tool execution", async () => {
    const h = harness(); const current = checkpoint(initial(), { policy: "local_only", reason: "local_request_started",
      eventId: "7".repeat(32), evidence: { requestId: "7".repeat(32) }, localCalls: 7, remainingLocalCalls: 1 });
    h.emit({ type: "routing.checkpoint", checkpoint: current });
    h.emit({ type: "command.started", phase: "local", command: "python forbidden-edit.py" });
    const result = await h.end();
    expect(result.error).toMatch(/reserved finishing/);
    expect(result.events.some(event => event.type === "tool.started")).toBe(false);
    expect(result.phaseUsage).toBeUndefined();
  });

  it("rejects an eighth-request check receipt in main before recording fresh evidence", async () => {
    const h = harness(); const current = checkpoint(initial(), { policy: "local_only", reason: "local_request_started",
      eventId: "8".repeat(32), evidence: { requestId: "8".repeat(32) }, localCalls: 8, remainingLocalCalls: 0 });
    h.emit({ type: "routing.checkpoint", checkpoint: current });
    h.emit({ type: "checkpoint.checked", command: "python public_cases.py", returncode: 0, output: "Passed", elapsedMs: 1,
      sourceSha256: current.sourceSha256, sourceAfterSha256: current.sourceSha256, passed: true });
    const result = await h.end();
    expect(result.error).toMatch(/reserved submission/);
    expect(result.checkpointCheck).toBeUndefined();
    expect(result.phaseUsage).toBeUndefined();
  });

  it.each(["valid", "foreign_request", "foreign_checkpoint", "unknown_action", "extra_raw", "unsettled", "allowed_action"])(
    "validates the minimal settled action-denial receipt: %s", async (kind) => {
      const h = harness(); await h.flush();
      const requestId = "7".repeat(32);
      const current = checkpoint(initial(), { policy: "local_only", reason: "local_request_started",
        eventId: requestId, evidence: { requestId }, localCalls: 7, remainingLocalCalls: 1 });
      h.emit({ type: "routing.checkpoint", checkpoint: current }); await h.flush();
      for (let index = 1; index <= 7; index++) {
        const id = String(index).repeat(32);
        h.store.reserveRequest(h.id, { requestId: id, amountMicrousd: 0, providerLabel: "local fixture", model: h.config.local!.model,
          phase: "local", inputSha256: "a".repeat(64), campaignLimitMicrousd: h.config.campaignCapMicrousd });
        h.store.startRequest(h.id, id);
        if (!(kind === "unsettled" && index === 7)) h.store.finishRequest(h.id, { requestId: id, outcome: "succeeded", actualCostMicrousd: 0,
          usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 } });
      }
      const event: Record<string, unknown> = { type: "native.action_denied", requestId, checkpointEvidenceId: current.evidenceId, localCall: 7, action: "run_command" };
      if (kind === "foreign_request") event.requestId = "8".repeat(32);
      if (kind === "foreign_checkpoint") event.checkpointEvidenceId = "b".repeat(64);
      if (kind === "unknown_action") event.action = "raw-private-action";
      if (kind === "extra_raw") event.arguments = "raw-private-arguments";
      if (kind === "allowed_action") event.action = "run_visible_checks";
      h.emit(event); const result = await h.end();
      const denials = result.events.filter(value => value.type === "native.action_denied");
      expect(denials).toHaveLength(kind === "valid" ? 1 : 0);
      if (kind === "valid") expect(denials[0]!.summary).toBe(`Denied run_command; request ${requestId}; checkpoint ${current.evidenceId}; local call 7.`);
      expect(result.status).toBe("failed");
      expect(result.phaseUsage?.local).toMatchObject({ requestCount: 7, usageReceipts: kind === "unsettled" ? 6 : 7, spentMicrousd: 0 });
      expect(JSON.stringify(result)).not.toContain("raw-private");
      expect(h.store.replay(h.id)).toEqual(result);
    });
});
