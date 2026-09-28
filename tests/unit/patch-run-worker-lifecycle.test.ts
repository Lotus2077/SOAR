import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSoarDatabase, type SoarDatabase } from "../../src/main/database";
import { PatchRunStore } from "../../src/main/patch-runs/store";
import type { PatchRuntimeConfig } from "../../src/main/patch-runs/config";
import { patchPolicyNeedsPlan, type PatchRunPolicy } from "../../src/shared/patch-run-contracts";
import { checkpoint, hash, nativeBody, nativePair, nativeRuntime, preparedNative } from "../helpers/patch-native-fixture";

const processState = vi.hoisted(() => ({
  child: undefined as any,
  cleanupFailure: false,
  cleanupGate: undefined as Promise<void> | undefined,
}));

vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  const { promisify } = await import("node:util");
  const execFile = Object.assign(vi.fn(), {
    [promisify.custom]: async () => {
      await processState.cleanupGate;
      if (processState.cleanupFailure) throw new Error("test Docker failure");
      return { stdout: "", stderr: "" };
    },
  });
  return { ...actual, execFile, spawn: vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
    });
    processState.child = child;
    return child;
  }) };
});

import { canonicalRequest, launchPatchWorker } from "../../src/main/patch-runs/worker";

const databases: SoarDatabase[] = [];
const config: PatchRuntimeConfig = {
  mode: "scripted", enabled: true, python: "unused-test-python", workerPath: "/test/worker.py", image: "test-image", storageRoot: "/test/runs",
  episodeCapMicrousd: 5_000_000, campaignCapMicrousd: 70_000_000, stepLimit: 60,
  wallTimeSeconds: 1200, maxOutputTokens: 4096, maxInputBytes: 512000,
};
function setup(mode: "scripted" | "live" = "scripted", policy: PatchRunPolicy = "cloud") {
  const db = createSoarDatabase(); databases.push(db);
  const store = new PatchRunStore(db);
  const snapshot = store.create({ workspaceRoot: "/fixture/original", objective: "Fix fixture", policy, executionMode: mode,
    baseRevision: "a".repeat(40), maxCostMicrousd: 5_000_000 });
  store.start(snapshot.id);
  return { db, store, id: snapshot.id };
}
function terminal(id: string, status = "completed") {
  processState.child.stdout.write(`${JSON.stringify({ protocolVersion: 1, type: "ready", runId: "", sequence: 1 })}\n`);
  processState.child.stdout.write(`${JSON.stringify({ protocolVersion: 1, type: "terminal", runId: id, sequence: 2, status })}\n`);
}
afterEach(() => {
  vi.useRealTimers();
  for (const database of databases.splice(0)) if (database.open) database.close();
  processState.cleanupFailure = false; processState.cleanupGate = undefined; processState.child = undefined;
});

describe("coding worker finalization", () => {
  function nativeHarness(policy: PatchRunPolicy = "local_first", overrides: Partial<PatchRuntimeConfig> = {}) {
    const { store, id } = setup("live", policy); const runtime = { ...nativeRuntime, ...overrides };
    const worker = launchPatchWorker({ config: runtime, store, snapshot: store.get(id), workspace: "/fixture/copy", image: "test-image", publish: vi.fn() });
    let sequence = 0;
    const emit = (event: Record<string, unknown>) => processState.child.stdout.write(`${JSON.stringify({ protocolVersion: 1, runId: id, sequence: ++sequence, ...event })}\n`);
    const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
    const finish = async (status = "failed") => { emit({ type: "terminal", status, errorCode: "fixture_end" }); await flush(); processState.child.emit("close", status === "failed" ? 1 : 0, null); await worker.done; return store.get(id); };
    emit({ type: "ready", runId: "" });
    const initial = checkpoint(undefined, { policy: policy as "local_first", ...(patchPolicyNeedsPlan(policy) ? { state: "planner", reason: "cloud_plan_required" } : {}) });
    emit({ type: "routing.checkpoint", checkpoint: initial });
    emit({ type: "phase.started", phase: patchPolicyNeedsPlan(policy) ? "planner" : "local", model: patchPolicyNeedsPlan(policy) ? runtime.cloud!.model : runtime.local!.model });
    return { store, id, runtime, worker, emit, flush, finish, initial };
  }
  const usage = { inputTokens: 100, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0, reported: true };
  function cloudPrepared(phase: "cloud" | "planner", requestId: string) {
    const provider = nativeRuntime.cloud!; const body = { model: provider.model, messages: [{ role: "user", content: "Public fixture" }], max_tokens: 4096, stream: false };
    const encoded = canonicalRequest(body); const digest = hash(encoded);
    return { type: "request.prepare", phase, requestId, model: provider.model, provider: { id: provider.id, protocol: provider.protocol, endpoint: provider.endpoint },
      preparedRequest: { method: "POST", url: provider.endpoint, body, bodySha256: digest }, bodySha256: digest, estimatedInputTokens: Buffer.byteLength(encoded), maxOutputTokens: 4096 };
  }

  it("omits cloud credentials for local-only execution and rejects rewritten native history", async () => {
    const h = nativeHarness("local_only"); let current = h.initial;
    for (let i = 1; i <= 2; i += 1) {
      const requestId = String(i).repeat(32);
      current = checkpoint(current, { policy: "local_only", reason: "local_request_started", eventId: requestId, evidence: { requestId }, localCalls: i, remainingLocalCalls: 24 - i });
      h.emit({ type: "routing.checkpoint", checkpoint: current });
      const body = nativeBody();
      if (i === 2) { body.messages = [...body.messages as unknown[], ...nativePair()]; (body.messages as any[])[1].content = "Rewrite original task"; }
      h.emit({ type: "request.prepare", ...preparedNative(body, requestId) });
      if (i === 1) h.emit({ type: "request.finished", requestId, usage });
    }
    const result = await h.finish();
    expect(result.error).toMatch(/history/);
    expect(result.phaseUsage?.local).toMatchObject({ requestCount: 1, usageReceipts: 1, spentMicrousd: 0 });
    const sent = processState.child.stdin.read().toString().trim().split("\n").map((line: string) => JSON.parse(line));
    expect(sent[0].providers).not.toHaveProperty("cloud");
    expect(JSON.stringify(sent)).not.toContain(nativeRuntime.cloud!.apiKey);
    expect(sent.filter((entry: any) => entry.type === "request.admitted")).toHaveLength(1);
  });
  it("blocks a direct cloud transition from local work without a confirmed handoff", async () => {
    const h = nativeHarness(); h.emit({ type: "phase.started", phase: "cloud", model: h.runtime.cloud!.model });
    const result = await h.finish();
    expect(result.error).toMatch(/checkpoint/);
    expect(result.cloudRecoveryCount).toBeUndefined();
    expect(result.phaseUsage).toBeUndefined();
  });
  it("admits one recovery from a preserved patch, accounts both phases, and forbids return to local", async () => {
    const h = nativeHarness(); const requestId = "a".repeat(32);
    let current = checkpoint(h.initial, { eventId: requestId, reason: "local_request_started", evidence: { requestId }, localCalls: 1, remainingLocalCalls: 23 });
    h.emit({ type: "routing.checkpoint", checkpoint: current }); h.emit({ type: "request.prepare", ...preparedNative(undefined, requestId) });
    h.emit({ type: "request.finished", requestId, usage });
    current = checkpoint(current, { decision: "checkpoint", state: "checkpoint", reason: "explicit_help", handoffCandidate: true, localCalls: 1, remainingLocalCalls: 23 });
    h.emit({ type: "routing.checkpoint", checkpoint: current });
    const patch = "diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n-old\n+new\n";
    h.emit({ type: "patch.recovered", patch, sha256: hash(patch), baseRevision: "a".repeat(40) });
    h.emit({ type: "handoff.ready", patchSha256: hash(patch), sourceSha256: current.sourceSha256, bytes: Buffer.byteLength(patch), summary: "Fix remains incomplete." });
    current = checkpoint(current, { decision: "escalate", state: "cloud", reason: "handoff_confirmed", handoffUsed: true, localCalls: 1, remainingLocalCalls: 23 });
    h.emit({ type: "routing.checkpoint", checkpoint: current }); h.emit({ type: "phase.started", phase: "cloud", model: h.runtime.cloud!.model });
    h.emit(cloudPrepared("cloud", "b".repeat(32))); h.emit({ type: "request.finished", requestId: "b".repeat(32), usage });
    h.emit({ type: "phase.started", phase: "local", model: h.runtime.local!.model });
    const result = await h.finish();
    expect(result).toMatchObject({ cloudRecoveryCount: 1, spentMicrousd: 160, phaseUsage: { local: { requestCount: 1 }, cloud: { requestCount: 1 } }, patch: { kind: "recovered" }, checks: { status: "not_run" } });
    expect(result.error).toMatch(/phase transition/);
    expect(h.store.replay(h.id)).toEqual(result);
  });
  it.each(["cloud_plan_local", "cloud_plan_local_review"] as const)("counts the planner separately and rejects a second planning request for %s", async (policy) => {
    const h = nativeHarness(policy);
    h.emit(cloudPrepared("planner", "a".repeat(32))); h.emit({ type: "request.finished", requestId: "a".repeat(32), usage });
    const summary = "Inspect then implement the public change."; h.emit({ type: "plan.ready", summary, sha256: hash(summary) });
    h.emit(cloudPrepared("planner", "b".repeat(32)));
    const result = await h.finish();
    expect(result.error).toMatch(/call limit/);
    expect(result).toMatchObject({ cloudPlan: { summary }, phaseUsage: { planner: { requestCount: 1, usageReceipts: 1, spentMicrousd: 160 } } });
  });
  function plannedLocal(h: ReturnType<typeof nativeHarness>) {
    h.emit(cloudPrepared("planner", "a".repeat(32))); h.emit({ type: "request.finished", requestId: "a".repeat(32), usage });
    const summary = "Inspect source, implement, then review compatibility.";
    h.emit({ type: "plan.ready", summary, sha256: hash(summary) });
    const current = checkpoint(h.initial, { policy: h.initial.policy, state: "local", reason: "cloud_plan_completed" });
    h.emit({ type: "routing.checkpoint", checkpoint: current }); h.emit({ type: "phase.started", phase: "local", model: h.runtime.local!.model });
    return current;
  }
  it.each(["patch.ready", "verification.started", "local_submit"])("rejects %s bypass of mandatory cloud review", async (event) => {
    const h = nativeHarness("cloud_plan_local_review"); const current = plannedLocal(h);
    if (event === "local_submit") h.emit({ type: "routing.checkpoint", checkpoint: checkpoint(current, {
      policy: "cloud_plan_local_review", decision: "submit", state: "submitted", reason: "fresh_visible_check" }) });
    else h.emit({ type: event, patch: "unreviewed", sha256: hash("unreviewed"), baseRevision: "a".repeat(40) });
    const result = await h.finish();
    expect(result.status).toBe("failed"); expect(result.cloudRecoveryCount).toBeUndefined();
    expect(result.patch).toBeUndefined(); expect(result.error).toMatch(/checkpoint|review/);
  });
  it.each([false, true])("runs one planner, a provisional patch and one cloud phase with cloud editing=%s", async (cloudEdit) => {
    const h = nativeHarness("cloud_plan_local_review"); let current = plannedLocal(h);
    const policy = "cloud_plan_local_review", source = "a".repeat(64), requestId = "b".repeat(32);
    current = checkpoint(current, { policy, eventId: requestId, reason: "local_request_started", evidence: { requestId }, localCalls: 1, remainingLocalCalls: 23 });
    h.emit({ type: "routing.checkpoint", checkpoint: current }); h.emit({ type: "request.prepare", ...preparedNative(undefined, requestId) });
    h.emit({ type: "request.finished", requestId, usage });
    h.emit({ type: "checkpoint.checked", command: h.store.get(h.id).checks.command, returncode: 0, output: "Passed", elapsedMs: 10,
      sourceSha256: source, sourceAfterSha256: source, passed: true });
    current = checkpoint(current, { policy, decision: "checkpoint", state: "checkpoint", reason: "review_required", handoffCandidate: true,
      checkSourceSha256: source, evidence: { checkSourceSha256: source }, localCalls: 1, remainingLocalCalls: 23 });
    h.emit({ type: "routing.checkpoint", checkpoint: current });
    const patch = "diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n-old\n+new\n";
    h.emit({ type: "patch.recovered", patch, sha256: hash(patch), baseRevision: "a".repeat(40) });
    h.emit({ type: "handoff.ready", patchSha256: hash(patch), sourceSha256: source, checkSourceSha256: source, bytes: Buffer.byteLength(patch), summary: "Inspect compatibility before submission." });
    current = checkpoint(current, { policy, decision: "escalate", state: "cloud", reason: "handoff_confirmed", handoffUsed: true, localCalls: 1, remainingLocalCalls: 23 });
    h.emit({ type: "routing.checkpoint", checkpoint: current }); h.emit({ type: "phase.started", phase: "cloud", model: h.runtime.cloud!.model });
    h.emit(cloudPrepared("cloud", "c".repeat(32))); h.emit({ type: "request.finished", requestId: "c".repeat(32), usage });
    const finalSource = cloudEdit ? "b".repeat(64) : source;
    const finalPatch = cloudEdit ? patch.replace("+new", "+reviewed") : patch;
    if (cloudEdit) {
      h.emit({ type: "command.started", command: "python repair.py" }); await h.flush();
      expect(h.store.get(h.id).checkpointCheck).toMatchObject({ sourceSha256: source, passed: true, fresh: false });
      h.emit({ type: "command.finished", returncode: 0, output: "Changed candidate source." });
      h.emit(cloudPrepared("cloud", "d".repeat(32))); h.emit({ type: "request.finished", requestId: "d".repeat(32), usage });
    }
    h.emit({ type: "patch.ready", patch: finalPatch, sha256: hash(finalPatch), baseRevision: "a".repeat(40) });
    h.emit({ type: "verification.started" });
    h.emit({ type: "verification.finished", returncode: 0, sourceSha256: finalSource, sourceAfterSha256: finalSource, passed: true, output: "Passed" });
    const result = await h.finish("completed");
    expect(result).toMatchObject({ status: "completed", cleanupConfirmed: true, cloudRecoveryCount: 1, spentMicrousd: cloudEdit ? 480 : 320,
      phaseUsage: { planner: { requestCount: 1, usageReceipts: 1 }, local: { requestCount: 1, usageReceipts: 1 }, cloud: { requestCount: cloudEdit ? 2 : 1, usageReceipts: cloudEdit ? 2 : 1 } },
      patch: { kind: "submitted", text: finalPatch }, checks: { status: "passed", sourceSha256: finalSource },
      checkpointCheck: { passed: true, fresh: !cloudEdit, sourceSha256: source }, handoff: { sourceSha256: source, patchSha256: hash(patch) } });
    expect(result.error).toBeUndefined(); expect(h.store.replay(h.id)).toEqual(result);
  });
  it.each([{ wallTimeSeconds: 360, stepLimit: 40, reason: /review and check reserve/ },
    { wallTimeSeconds: 600, stepLimit: 2, reason: /call limit/ }])("keeps review time and one cloud call before local admission: $wallTimeSeconds seconds, $stepLimit calls", async ({ wallTimeSeconds, stepLimit, reason }) => {
    const h = nativeHarness("cloud_plan_local_review", { wallTimeSeconds, stepLimit }); const current = plannedLocal(h), requestId = "b".repeat(32);
    h.emit({ type: "routing.checkpoint", checkpoint: checkpoint(current, { policy: "cloud_plan_local_review", eventId: requestId,
      reason: "local_request_started", evidence: { requestId }, localCalls: 1, remainingLocalCalls: 23 }) });
    h.emit({ type: "request.prepare", ...preparedNative(undefined, requestId) });
    const result = await h.finish();
    expect(result.error).toMatch(reason); expect(result.phaseUsage?.local).toBeUndefined();
    expect(result.phaseUsage?.planner).toMatchObject({ requestCount: 1, usageReceipts: 1 });
    expect(result.reservedMicrousd).toBe(0);
  });
  it("preserves the older cloud-plan policy's local allowance at the new review reserve", async () => {
    const h = nativeHarness("cloud_plan_local", { wallTimeSeconds: 360, stepLimit: 2 }); const current = plannedLocal(h), requestId = "b".repeat(32);
    h.emit({ type: "routing.checkpoint", checkpoint: checkpoint(current, { policy: "cloud_plan_local", eventId: requestId,
      reason: "local_request_started", evidence: { requestId }, localCalls: 1, remainingLocalCalls: 23 }) });
    h.emit({ type: "request.prepare", ...preparedNative(undefined, requestId) }); h.emit({ type: "request.finished", requestId, usage });
    const result = await h.finish();
    expect(result.error).toMatch(/fixture_end/);
    expect(result.phaseUsage?.local).toMatchObject({ requestCount: 1, usageReceipts: 1 });
    expect(result.phaseUsage?.planner).toMatchObject({ requestCount: 1, usageReceipts: 1 });
  });
  it("stops the mandatory-review policy on an unknown local result before any cloud review", async () => {
    const h = nativeHarness("cloud_plan_local_review"); const current = plannedLocal(h), requestId = "b".repeat(32);
    h.emit({ type: "routing.checkpoint", checkpoint: checkpoint(current, { policy: "cloud_plan_local_review", eventId: requestId,
      reason: "local_request_started", evidence: { requestId }, localCalls: 1, remainingLocalCalls: 23 }) });
    h.emit({ type: "request.prepare", ...preparedNative(undefined, requestId) });
    h.emit({ type: "request.unsettled", requestId, reason: "provider_timeout" });
    h.emit({ type: "phase.started", phase: "cloud", model: h.runtime.cloud!.model });
    const result = await h.finish();
    expect(result.error).toMatch(/unknown/); expect(result.cloudRecoveryCount).toBeUndefined();
    expect(result.phaseUsage?.cloud).toBeUndefined();
    expect(result.phaseUsage?.local).toMatchObject({ requestCount: 1, unknownRequests: 1 });
  });
  it("does not turn a zero-fee unknown local response into paid recovery", async () => {
    const h = nativeHarness(); const requestId = "a".repeat(32);
    const current = checkpoint(h.initial, { eventId: requestId, reason: "local_request_started", evidence: { requestId }, localCalls: 1, remainingLocalCalls: 23 });
    h.emit({ type: "routing.checkpoint", checkpoint: current }); h.emit({ type: "request.prepare", ...preparedNative(undefined, requestId) });
    h.emit({ type: "request.unsettled", requestId, reason: "provider_timeout" });
    h.emit({ type: "phase.started", phase: "cloud", model: h.runtime.cloud!.model });
    const result = await h.finish();
    expect(result).toMatchObject({ status: "failed", reservedMicrousd: 0, phaseUsage: { local: { requestCount: 1, unknownRequests: 1 } } });
    expect(result.phaseUsage?.cloud).toBeUndefined(); expect(result.cloudRecoveryCount).toBeUndefined();
    expect(h.store.hasUnresolvedRequests(h.id)).toBe(true);
  });
  it("enforces the shared call ceiling independently of valid local checkpoint records", async () => {
    const h = nativeHarness("local_first", { stepLimit: 1 }); let current = h.initial;
    for (let i = 1; i <= 2; i += 1) {
      const requestId = String(i).repeat(32);
      current = checkpoint(current, { eventId: requestId, reason: "local_request_started", evidence: { requestId }, localCalls: i, remainingLocalCalls: 24 - i });
      h.emit({ type: "routing.checkpoint", checkpoint: current });
      const body = nativeBody(); if (i === 2) body.messages = [...body.messages as unknown[], ...nativePair()];
      h.emit({ type: "request.prepare", ...preparedNative(body, requestId) });
      if (i === 1) h.emit({ type: "request.finished", requestId, usage });
    }
    const result = await h.finish(); expect(result.error).toMatch(/call limit/); expect(result.phaseUsage?.local?.requestCount).toBe(1);
  });
  it.each(["local_only", "cloud"] as const)("preserves final check time before any %s admission", async (policy) => {
    const { store, id } = setup("live", policy);
    const runtime = { ...nativeRuntime, wallTimeSeconds: 179 };
    const worker = launchPatchWorker({ config: runtime, store, snapshot: store.get(id), workspace: "/fixture/copy", image: "test-image", publish: vi.fn() });
    let sequence = 0;
    const emit = (event: Record<string, unknown>) => processState.child.stdout.write(`${JSON.stringify({ protocolVersion: 1, runId: id, sequence: ++sequence, ...event })}\n`);
    emit({ type: "ready", runId: "" });
    if (policy === "local_only") {
      const initial = checkpoint(undefined, { policy });
      emit({ type: "routing.checkpoint", checkpoint: initial });
      emit({ type: "phase.started", phase: "local", model: runtime.local!.model });
      const requestId = "c".repeat(32);
      emit({ type: "routing.checkpoint", checkpoint: checkpoint(initial, { policy, eventId: requestId,
        reason: "local_request_started", evidence: { requestId }, localCalls: 1, remainingLocalCalls: 23 }) });
      emit({ type: "request.prepare", ...preparedNative(undefined, requestId) });
    } else {
      emit({ type: "phase.started", phase: "cloud", model: runtime.cloud!.model });
      emit(cloudPrepared("cloud", "c".repeat(32)));
    }
    await new Promise((resolve) => setImmediate(resolve));
    emit({ type: "terminal", status: "failed", errorCode: "fixture_end" });
    await new Promise((resolve) => setImmediate(resolve)); processState.child.emit("close", 1, null); await worker.done;
    expect(store.get(id)).toMatchObject({ status: "failed", spentMicrousd: 0, reservedMicrousd: 0 });
    expect(store.get(id).error).toMatch(/final check reserve/); expect(store.get(id).phaseUsage).toBeUndefined();
    expect(processState.child.stdin.read().toString()).not.toContain('"type":"request.admitted"');
  });
  it.each(["completed", "partial"] as const)("persists %s scout evidence and separate local/cloud usage without trusting receipt phase", async (outcome) => {
    const { store, id } = setup("live", "hybrid");
    const runtime: PatchRuntimeConfig = { ...config, mode: "live", cloud: {
      id: "openai", protocol: "openai", endpoint: "https://cloud.invalid/chat/completions", model: "cloud-fixture", apiKey: "test-cloud-private",
      allowInsecureHttp: false, inputUsdPerMillion: 1, outputUsdPerMillion: 2,
    }, local: { id: "local", protocol: "openai", endpoint: "http://127.0.0.1:9999/chat/completions", model: "RM-01 VLM", apiKey: "test-local-private",
      allowInsecureHttp: true, inputUsdPerMillion: 0, outputUsdPerMillion: 0, maxOutputTokens: 2048, maxInputBytes: 64000 } };
    const worker = launchPatchWorker({ config: runtime, store, snapshot: store.get(id), workspace: "/fixture/copy", image: "test-image", publish: vi.fn() });
    let sequence = 0;
    const emit = (event: Record<string, unknown>) => processState.child.stdout.write(`${JSON.stringify({ protocolVersion: 1, runId: id, sequence: ++sequence, ...event })}\n`);
    const prepare = (phase: "scout" | "cloud", requestId: string) => {
      const provider = phase === "scout" ? runtime.local! : runtime.cloud!;
      const maxOutputTokens = provider.maxOutputTokens ?? runtime.maxOutputTokens;
      const body = { model: provider.model, messages: [{ role: "user", content: "Fix fixture" }], max_tokens: maxOutputTokens, stream: false };
      const encoded = canonicalRequest(body);
      const digest = createHash("sha256").update(encoded).digest("hex");
      emit({ type: "request.prepare", phase, requestId, model: provider.model,
        provider: { id: provider.id, protocol: provider.protocol, endpoint: provider.endpoint },
        preparedRequest: { method: "POST", url: provider.endpoint, body, bodySha256: digest },
        bodySha256: digest, estimatedInputTokens: Buffer.byteLength(encoded), maxOutputTokens });
    };
    emit({ type: "ready", runId: "" });
    emit({ type: "phase.started", phase: "scout", model: runtime.local!.model });
    prepare("scout", "a".repeat(32));
    emit({ type: "request.finished", requestId: "a".repeat(32), phase: "cloud", reportedModel: "RM-01 VLM",
      usage: { inputTokens: 300, outputTokens: 30, reasoningTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, reported: true } });
    emit({ type: "preparation.finished", kind: "scout", elapsedMs: 2500, outcome,
      summary: "read parser.py:10-20\nObserved public source\ntest-local-private\nhttp://127.0.0.1:9999/chat/completions" });
    emit({ type: "phase.started", phase: "cloud", model: runtime.cloud!.model });
    prepare("cloud", "b".repeat(32));
    emit({ type: "request.finished", requestId: "b".repeat(32), phase: "scout",
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, reported: true } });
    emit({ type: "terminal", status: "failed", errorCode: "fixture_end" });
    await new Promise((resolve) => setImmediate(resolve));
    processState.child.emit("close", 1, null);
    await worker.done;
    const result = store.get(id);
    expect(result).toMatchObject({ spentMicrousd: 140, reservedMicrousd: 0,
      localInvestigation: { elapsedMs: 2500, outcome },
      phaseUsage: { scout: { providerLabel: "local · RM-01 VLM", requestCount: 1, usageReceipts: 1, spentMicrousd: 0, inputTokens: 300, outputTokens: 30, reasoningTokens: 10 },
        cloud: { requestCount: 1, usageReceipts: 1, spentMicrousd: 140, inputTokens: 100, outputTokens: 20 } } });
    expect(result.localSummary).toContain("read parser.py:10-20");
    expect(result.localSummary).not.toContain("test-local-private");
    expect(result.localSummary).not.toContain("http://127.0.0.1");
    expect(result.events.some((event) => event.type === "provider.model" && event.summary.includes("RM-01 VLM"))).toBe(true);
    expect(store.replay(id)).toEqual(result);
  });

  it.each(["provider_output_empty", "provider_output_truncated"] as const)("persists the allowlisted scout diagnostic %s with settled usage", async (providerOutputError) => {
    const { store, id } = setup("live", "hybrid");
    const local = { id: "local", protocol: "openai" as const, endpoint: "http://127.0.0.1:9999/chat/completions", model: "local-fixture", apiKey: "",
      allowInsecureHttp: true, inputUsdPerMillion: 0, outputUsdPerMillion: 0 };
    const worker = launchPatchWorker({ config: { ...config, mode: "live", local }, store, snapshot: store.get(id), workspace: "/fixture/copy", image: "test-image", publish: vi.fn() });
    let sequence = 0;
    const emit = (event: Record<string, unknown>) => processState.child.stdout.write(`${JSON.stringify({ protocolVersion: 1, runId: id, sequence: ++sequence, ...event })}\n`);
    emit({ type: "ready", runId: "" });
    emit({ type: "phase.started", phase: "scout", model: local.model });
    await new Promise((resolve) => setImmediate(resolve));
    const body = { model: local.model, messages: [{ role: "user", content: "Fix fixture" }], max_tokens: config.maxOutputTokens, stream: false };
    const encoded = canonicalRequest(body);
    const bodySha256 = createHash("sha256").update(encoded).digest("hex");
    const requestId = "d".repeat(32);
    emit({ type: "request.prepare", phase: "scout", requestId, model: local.model,
      provider: { id: local.id, protocol: local.protocol, endpoint: local.endpoint },
      preparedRequest: { method: "POST", url: local.endpoint, body, bodySha256 },
      bodySha256, estimatedInputTokens: Buffer.byteLength(encoded), maxOutputTokens: config.maxOutputTokens });
    emit({ type: "request.finished", requestId, phase: "scout",
      usage: { inputTokens: 100, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0, reported: true } });
    emit({ type: "preparation.finished", kind: "scout", elapsedMs: 1200, outcome: "fallback",
      fallbackReason: "scout_limit_or_format_failure", providerOutputError, summary: "" });
    emit({ type: "terminal", status: "failed", errorCode: "fixture_end" });
    await new Promise((resolve) => setImmediate(resolve));
    processState.child.emit("close", 1, null);
    await worker.done;
    expect(store.get(id)).toMatchObject({ localSummary: "", spentMicrousd: 0, reservedMicrousd: 0,
      localInvestigation: { elapsedMs: 1200, outcome: "fallback", fallbackReason: "scout_limit_or_format_failure", providerOutputError },
      phaseUsage: { scout: { requestCount: 1, usageReceipts: 1, unknownRequests: 0, spentMicrousd: 0, reservedMicrousd: 0, inputTokens: 100, outputTokens: 40 } } });
    expect(store.replay(id)).toEqual(store.get(id));
  });

  it("retains stopped scout timing after cancellation without starting cloud or losing zero-fee unknown requests", async () => {
    const { store, id } = setup("live", "hybrid");
    const local = { id: "local", protocol: "openai" as const, endpoint: "http://127.0.0.1:9999/chat/completions", model: "local-fixture", apiKey: "",
      allowInsecureHttp: true, inputUsdPerMillion: 0, outputUsdPerMillion: 0 };
    const worker = launchPatchWorker({ config: { ...config, mode: "live", local }, store, snapshot: store.get(id), workspace: "/fixture/copy", image: "test-image", publish: vi.fn() });
    let sequence = 0;
    const emit = (event: Record<string, unknown>) => processState.child.stdout.write(`${JSON.stringify({ protocolVersion: 1, runId: id, sequence: ++sequence, ...event })}\n`);
    emit({ type: "ready", runId: "" });
    emit({ type: "phase.started", phase: "scout", model: local.model });
    await new Promise((resolve) => setImmediate(resolve));
    store.reserveRequest(id, { requestId: "local-pending", amountMicrousd: 0, providerLabel: "Local", phase: "scout" });
    store.startRequest(id, "local-pending");
    worker.cancel();
    emit({ type: "preparation.finished", kind: "scout", elapsedMs: 1700, outcome: "stopped", fallbackReason: "cancelled", summary: "" });
    emit({ type: "phase.started", phase: "cloud", model: "must-not-start" });
    emit({ type: "request.prepare", phase: "cloud", requestId: "must-not-admit" });
    emit({ type: "terminal", status: "cancelled" });
    await new Promise((resolve) => setImmediate(resolve));
    processState.child.emit("close", 0, null);
    await worker.done;
    expect(store.get(id)).toMatchObject({ status: "cancelled", localSummary: "", localInvestigation: { elapsedMs: 1700, outcome: "stopped", fallbackReason: "cancelled" },
      phaseUsage: { scout: { requestCount: 1, usageReceipts: 0, unknownRequests: 1, spentMicrousd: 0, reservedMicrousd: 0 } } });
    expect(store.get(id).phaseUsage?.cloud).toBeUndefined();
    expect(store.replay(id)).toEqual(store.get(id));
  });

  it.each([
    ["openai", "OpenAI", "gpt-4.1-2025-04-14"],
    ["openrouter", "OpenRouter", "deepseek/deepseek-v4-flash-0731"],
  ])("retains the configured %s model label through phase, reservation and settlement", async (providerId, displayName, model) => {
    const { db, store, id } = setup("live");
    const provider = { id: providerId, protocol: "openai" as const, endpoint: "https://provider.invalid/v1/chat/completions",
      model, apiKey: "test-secret", allowInsecureHttp: false, inputUsdPerMillion: 1, outputUsdPerMillion: 2 };
    const runtime = { ...config, mode: "live" as const, cloud: provider };
    const worker = launchPatchWorker({ config: runtime, store, snapshot: store.get(id), workspace: "/fixture/copy", image: "test-image", publish: vi.fn() });
    let sequence = 0;
    const emit = (event: Record<string, unknown>) => processState.child.stdout.write(`${JSON.stringify({ protocolVersion: 1, runId: id, sequence: ++sequence, ...event })}\n`);
    const expectedLabel = `${displayName} · ${model}`;
    emit({ type: "ready", runId: "" });
    emit({ type: "phase.started", phase: "cloud", model });
    await new Promise((resolve) => setImmediate(resolve));
    expect(store.get(id).providerLabel).toBe(expectedLabel);

    const body = { model, messages: [{ role: "user", content: "Fix fixture" }], max_tokens: runtime.maxOutputTokens, stream: false };
    const encoded = canonicalRequest(body);
    const digest = createHash("sha256").update(encoded).digest("hex");
    const requestId = "b".repeat(32);
    emit({ type: "request.prepare", phase: "cloud", requestId, model,
      provider: { id: providerId, protocol: provider.protocol, endpoint: provider.endpoint },
      preparedRequest: { method: "POST", url: provider.endpoint, body, bodySha256: digest },
      bodySha256: digest, estimatedInputTokens: Buffer.byteLength(encoded), maxOutputTokens: runtime.maxOutputTokens });
    await new Promise((resolve) => setImmediate(resolve));
    expect(store.get(id).providerLabel).toBe(expectedLabel);
    const reserved = store.get(id).reservedMicrousd;
    expect(reserved).toBe(Buffer.byteLength(encoded) + runtime.maxOutputTokens * 2);

    emit({ type: "request.finished", requestId, usage: { inputTokens: 100, outputTokens: 10,
      cacheReadTokens: 0, cacheWriteTokens: 0, reported: true } });
    await new Promise((resolve) => setImmediate(resolve));
    expect(store.get(id)).toMatchObject({ providerLabel: expectedLabel, spentMicrousd: 120, reservedMicrousd: 0 });
    expect(db.prepare("SELECT state FROM patch_run_requests WHERE request_id = ?").get(requestId)).toEqual({ state: "succeeded" });
    emit({ type: "terminal", status: "failed", errorCode: "fixture_end" });
    await new Promise((resolve) => setImmediate(resolve));
    processState.child.emit("close", 1, null);
    await worker.done;
    expect(store.get(id).providerLabel).toBe(expectedLabel);
  });

  it.each([
    ["provider_http_401", "Provider returned HTTP 401."],
    ["provider_tls_verification_failed", "Provider TLS certificate verification failed."],
    ["echo-secret-body-or-private-url", "Provider transport or response failed."],
  ])("retains unknown exposure and only records an allowlisted diagnostic for %s", async (reason, expected) => {
    const { db, store, id } = setup("live");
    const provider = { id: "test-cloud", protocol: "openai" as const, endpoint: "https://provider.invalid/v1/chat/completions",
      model: "fixture", apiKey: "test-secret", allowInsecureHttp: false, inputUsdPerMillion: 1, outputUsdPerMillion: 2 };
    const runtime = { ...config, mode: "live" as const, cloud: provider };
    const worker = launchPatchWorker({ config: runtime, store, snapshot: store.get(id), workspace: "/fixture/copy", image: "test-image", publish: vi.fn() });
    const body = { model: provider.model, messages: [{ role: "user", content: "Fix fixture" }], max_tokens: runtime.maxOutputTokens, stream: false };
    const encoded = canonicalRequest(body);
    const digest = createHash("sha256").update(encoded).digest("hex");
    const requestId = "a".repeat(32);
    const events = [
      { type: "ready", runId: "" },
      { type: "phase.started", phase: "cloud", model: provider.model },
      { type: "request.prepare", phase: "cloud", requestId, model: provider.model,
        provider: { id: provider.id, protocol: provider.protocol, endpoint: provider.endpoint },
        preparedRequest: { method: "POST", url: provider.endpoint, body, bodySha256: digest },
        bodySha256: digest, estimatedInputTokens: Buffer.byteLength(encoded), maxOutputTokens: runtime.maxOutputTokens },
      { type: "request.unsettled", requestId, reason },
    ];
    events.forEach((event, index) => processState.child.stdout.write(`${JSON.stringify({ protocolVersion: 1, runId: id, sequence: index + 1, ...event })}\n`));
    await new Promise((resolve) => setImmediate(resolve));
    processState.child.emit("close", 1, null);
    await worker.done;
    const result = store.get(id);
    expect(result).toMatchObject({ status: "failed", spentMicrousd: 0 });
    expect(result.reservedMicrousd).toBeGreaterThan(0);
    expect(result.error).toContain(expected);
    expect(result.events.some((event) => event.type === "provider.failed" && event.summary === expected)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("echo-secret-body-or-private-url");
    expect(db.prepare("SELECT state FROM patch_run_requests WHERE request_id = ?").get(requestId)).toEqual({ state: "unknown" });
  });

  it("keeps the run active until terminal receipt, process exit and independent cleanup all agree", async () => {
    const { store, id } = setup();
    const text = "diff --git a/a.py b/a.py\n+fixed\n";
    store.recordPatch(id, { text, sha256: createHash("sha256").update(text).digest("hex"), files: ["a.py"], truncated: false });
    store.recordChecks(id, { status: "passed", command: "test", exitCode: 0, output: "passed" });
    let confirmCleanup!: () => void;
    processState.cleanupGate = new Promise<void>((resolve) => { confirmCleanup = resolve; });
    const worker = launchPatchWorker({ config, store, snapshot: store.get(id), workspace: "/fixture/copy", image: "test-image", publish: vi.fn() });
    terminal(id);
    await new Promise((resolve) => setImmediate(resolve));
    expect(store.get(id).status).toBe("running");
    processState.child.emit("close", 0, null);
    await new Promise((resolve) => setImmediate(resolve));
    expect(store.get(id).status).toBe("running");
    confirmCleanup();
    expect(await worker.done).toEqual({ cleanupConfirmed: true });
    expect(store.get(id).status).toBe("completed");
  });

  it.each(["cancel", "timeout", "failed_checks"] as const)("preserves the submitted patch when verification ends with %s", async (outcome) => {
    const { store, id } = setup();
    const text = "diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n-broken\n+fixed\n";
    const sha256 = createHash("sha256").update(text).digest("hex");
    const worker = launchPatchWorker({ config, store, snapshot: store.get(id), workspace: "/fixture/copy", image: "test-image", publish: vi.fn() });
    let sequence = 0;
    const emit = (event: Record<string, unknown>) => processState.child.stdout.write(`${JSON.stringify({ protocolVersion: 1, runId: id, sequence: ++sequence, ...event })}\n`);
    emit({ type: "ready", runId: "" });
    emit({ type: "phase.started", phase: "cloud", model: "scripted", simulated: true });
    emit({ type: "patch.ready", patch: text, sha256, baseRevision: "a".repeat(40) });
    emit({ type: "verification.started" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(store.get(id)).toMatchObject({ status: "running", phase: "checking", patch: { text, sha256 }, checks: { status: "not_run" } });

    if (outcome === "cancel") {
      worker.cancel();
      emit({ type: "terminal", status: "cancelled" });
    } else if (outcome === "timeout") {
      emit({ type: "terminal", status: "failed", errorCode: "container_command_timeout" });
    } else {
      emit({ type: "verification.finished", returncode: 1, output: "1 test failed" });
      emit({ type: "terminal", status: "checks_failed" });
    }
    await new Promise((resolve) => setImmediate(resolve));
    processState.child.emit("close", outcome === "timeout" ? 1 : 0, null);
    expect(await worker.done).toEqual({ cleanupConfirmed: true });
    const result = store.get(id);
    expect(result).toMatchObject({
      status: outcome === "cancel" ? "cancelled" : outcome === "timeout" ? "failed" : "completed",
      patch: { text, sha256, files: ["a.py"], truncated: false },
      checks: { status: outcome === "failed_checks" ? "failed" : "not_run" },
    });
    expect(store.replay(id)).toEqual(result);
  });

  it("records a recovered timeout separately and completes only after a later actual submission and checks", async () => {
    const { store, id } = setup();
    const worker = launchPatchWorker({ config, store, snapshot: store.get(id), workspace: "/fixture/copy", image: "test-image", publish: vi.fn() });
    let sequence = 0;
    const emit = (event: Record<string, unknown>) => processState.child.stdout.write(`${JSON.stringify({ protocolVersion: 1, runId: id, sequence: ++sequence, ...event })}\n`);
    const text = "diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n-broken\n+fixed\n";
    const sha256 = createHash("sha256").update(text).digest("hex");
    emit({ type: "ready", runId: "" });
    emit({ type: "phase.started", phase: "cloud", model: "scripted", simulated: true });
    emit({ type: "patch.recovered", patch: text, sha256, baseRevision: "a".repeat(40) });
    emit({ type: "command.recovered", count: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    expect(store.get(id)).toMatchObject({ status: "running", patch: { kind: "recovered" }, checks: { status: "not_run" } });
    expect(store.get(id).events.at(-1)).toMatchObject({ type: "command.recovered", summary: expect.stringContaining("recovery 1 of 2") });
    emit({ type: "patch.ready", patch: text, sha256, baseRevision: "a".repeat(40) });
    emit({ type: "verification.started" });
    emit({ type: "verification.finished", returncode: 0, output: "passed" });
    emit({ type: "terminal", status: "completed" });
    await new Promise((resolve) => setImmediate(resolve));
    processState.child.emit("close", 0, null);
    expect(await worker.done).toEqual({ cleanupConfirmed: true });
    expect(store.get(id)).toMatchObject({ status: "completed", patch: { kind: "submitted", text, sha256 }, checks: { status: "passed" } });
    expect(store.replay(id)).toEqual(store.get(id));
  });

  it("accepts a late recovery receipt during cancellation without admitting or checking more work", async () => {
    const { db, store, id } = setup("live");
    const worker = launchPatchWorker({ config, store, snapshot: store.get(id), workspace: "/fixture/copy", image: "test-image", publish: vi.fn() });
    let sequence = 0;
    const emit = (event: Record<string, unknown>) => processState.child.stdout.write(`${JSON.stringify({ protocolVersion: 1, runId: id, sequence: ++sequence, ...event })}\n`);
    emit({ type: "ready", runId: "" });
    emit({ type: "command.started", command: "python -m unittest" });
    await new Promise((resolve) => setImmediate(resolve));
    worker.cancel();
    const text = "diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n-broken\n+unfinished\n";
    const sha256 = createHash("sha256").update(text).digest("hex");
    emit({ type: "command.finished", returncode: 124, output: "Partial test output before timeout" });
    emit({ type: "patch.recovered", patch: text, sha256, baseRevision: "a".repeat(40) });
    emit({ type: "request.prepare", requestId: "must-not-be-admitted" });
    emit({ type: "verification.finished", returncode: 0, output: "must-not-be-accepted" });
    emit({ type: "recovery.failed", errorCode: "private-error-or-endpoint" });
    emit({ type: "terminal", status: "cancelled" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(store.get(id)).toMatchObject({ status: "running", patch: { kind: "recovered", text, sha256 }, checks: { status: "not_run" } });
    expect(db.prepare("SELECT count(*) AS count FROM patch_run_requests").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT payload_json FROM patch_run_events WHERE type = 'tool.finished'").get()).toEqual({ payload_json: expect.stringContaining("Partial test output before timeout") });
    expect(JSON.stringify(store.get(id))).not.toContain("private-error-or-endpoint");
    processState.child.emit("close", 0, null);
    expect(await worker.done).toEqual({ cleanupConfirmed: true });
    const result = store.get(id);
    expect(result).toMatchObject({ status: "cancelled", patch: { kind: "recovered", text, sha256 }, checks: { status: "not_run" } });
    expect(store.replay(id)).toEqual(result);
  });

  it("rejects a recovery receipt with a mismatched artifact identity even after cancellation", async () => {
    const { store, id } = setup();
    const worker = launchPatchWorker({ config, store, snapshot: store.get(id), workspace: "/fixture/copy", image: "test-image", publish: vi.fn() });
    processState.child.stdout.write(`${JSON.stringify({ protocolVersion: 1, runId: "", sequence: 1, type: "ready" })}\n`);
    await new Promise((resolve) => setImmediate(resolve));
    worker.cancel();
    processState.child.stdout.write(`${JSON.stringify({ protocolVersion: 1, runId: id, sequence: 2, type: "patch.recovered", patch: "untrusted", sha256: "0".repeat(64), baseRevision: "a".repeat(40) })}\n`);
    await new Promise((resolve) => setImmediate(resolve));
    processState.child.emit("close", 0, null);
    await worker.done;
    expect(store.get(id)).toMatchObject({ status: "failed", error: "Patch artifact identity mismatch." });
    expect(store.get(id).patch).toBeUndefined();
  });

  it("provides a bounded recovery grace while keeping cancellation active until process exit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { store, id } = setup();
    const worker = launchPatchWorker({ config, store, snapshot: store.get(id), workspace: "/fixture/copy", image: "test-image", publish: vi.fn() });
    processState.child.stdout.write(`${JSON.stringify({ protocolVersion: 1, runId: "", sequence: 1, type: "ready" })}\n`);
    await new Promise((resolve) => setImmediate(resolve));
    worker.cancel();
    expect(processState.child.kill).toHaveBeenCalledWith("SIGTERM");
    await vi.advanceTimersByTimeAsync(44_999);
    expect(processState.child.kill).not.toHaveBeenCalledWith("SIGKILL");
    expect(store.get(id).status).toBe("running");
    await vi.advanceTimersByTimeAsync(1);
    expect(processState.child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(store.get(id).status).toBe("running");
    processState.child.emit("close", null, "SIGKILL");
    expect(await worker.done).toEqual({ cleanupConfirmed: true });
    expect(store.get(id).status).toBe("cancelled");
  });

  it("resolves a cleanup failure, retains ambiguous cost and never falsely reports a completed run", async () => {
    const { store, id } = setup("live");
    store.reserveRequest(id, { requestId: "pending", amountMicrousd: 2_000_000, providerLabel: "Fixture cloud" });
    store.startRequest(id, "pending");
    processState.cleanupFailure = true;
    const worker = launchPatchWorker({ config, store, snapshot: store.get(id), workspace: "/fixture/copy", image: "test-image", publish: vi.fn() });
    terminal(id, "failed");
    processState.child.emit("close", 1, null);
    const result = await worker.done;
    expect(result.cleanupConfirmed).toBe(false);
    expect(result.error).toMatch(/cleanup/);
    expect(store.get(id)).toMatchObject({ status: "failed", spentMicrousd: 0, reservedMicrousd: 2_000_000 });
  });
});
