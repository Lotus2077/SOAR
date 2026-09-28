import { afterEach, describe, expect, it } from "vitest";
import { createSoarDatabase, type SoarDatabase } from "../../src/main/database";
import { PatchRunStore, validateCriticCheckpointBudget } from "../../src/main/patch-runs/store";
import { admitPreparedRequest, validateNativeCheckpointBudget, validateCriticRepairBody, criticMaximumReservation } from "../../src/main/patch-runs/worker";
import { canonicalRequest } from "../../src/main/patch-runs/native-contract";
import { patchPolicyLimits, type PatchRuntimeConfig } from "../../src/main/patch-runs/config";
import type { PatchRunCheckpoint, PatchRunCriticDraft, PatchRunCriticReceipt, PatchRunCriticResult } from "../../src/shared/patch-run-contracts";
import { checkpoint, hash, nativeRuntime } from "../helpers/patch-native-fixture";

const databases: SoarDatabase[] = [];
const command = "python public_cases.py", objective = "Fix public behavior", source = "a".repeat(64);
const patch = "diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n-old\n+new\n";
const config: PatchRuntimeConfig = { ...nativeRuntime, maxOutputTokens: 8192, maxInputBytes: 128000 };
const draftEvidence = { localPhase: "draft", phaseLocalCalls: 0, phaseLocalLimit: 8, criticUsed: false,
  repairUsed: false, repairStartLocalCalls: null, maxLocalCalls: 12, finishReserve: 2, checkSchedule: "final_only" };
const acceptable: PatchRunCriticResult = { verdict: "acceptable", summary: "No supported defect.", findings: [], missingContext: [] };
const repair: PatchRunCriticResult = { verdict: "repair_required", summary: "Public behavior needs a repair.", findings: [
  { path: "a.py", revision: "candidate", startLine: 1, endLine: 1, issue: "Boundary case fails.", repair: "Preserve the boundary." }], missingContext: [] };
function next(previous?: PatchRunCheckpoint, changes: Partial<PatchRunCheckpoint> = {}) {
  return checkpoint(previous, { policy: "local_critic_repair", localCalls: previous?.localCalls ?? 0,
    remainingLocalCalls: previous?.remainingLocalCalls ?? 8, sourceSha256: previous?.sourceSha256 ?? source,
    checkSourceSha256: previous?.checkSourceSha256 ?? null, ...changes,
    evidence: { ...(previous?.evidence ?? draftEvidence), ...(changes.evidence ?? {}) } });
}
function setup(maxCostMicrousd = 1_000_000) {
  const db = createSoarDatabase(); databases.push(db); const store = new PatchRunStore(db);
  const { id } = store.create({ workspaceRoot: "/fixture", objective, policy: "local_critic_repair", executionMode: "live",
    baseRevision: "a".repeat(40), maxCostMicrousd, visibleTestCommand: command });
  store.start(id); store.setPhase(id, "preparing"); store.setPhase(id, "local_solver");
  let current = next(); store.recordCheckpoint(id, current);
  function advance(changes: Partial<PatchRunCheckpoint>) { current = next(current, changes); store.recordCheckpoint(id, current); return current; }
  function localCall(campaignLimitMicrousd?: number) {
    const requestId = (current.localCalls + 1).toString(16).padStart(32, "0");
    advance({ reason: "local_request_started", eventId: requestId, localCalls: current.localCalls + 1,
      remainingLocalCalls: current.remainingLocalCalls - 1, evidence: { requestId, phaseLocalCalls: Number(current.evidence.phaseLocalCalls) + 1 } });
    store.reserveRequest(id, { requestId, amountMicrousd: 0, providerLabel: "Local", phase: "local", campaignLimitMicrousd },
      current.evidence.localPhase === "draft" ? criticMaximumReservation(config) : undefined); store.startRequest(id, requestId);
    store.finishRequest(id, { requestId, outcome: "succeeded", actualCostMicrousd: 0, usage: { inputTokens: 10, outputTokens: 10 } });
  }
  function check() {
    store.recordCheckpointCheck(id, { command, exitCode: 0, output: "passed", elapsedMs: 1,
      sourceSha256: current.sourceSha256, sourceAfterSha256: current.sourceSha256, passed: true, fresh: true });
    advance({ reason: "visible_check_passed", checkSourceSha256: current.sourceSha256 });
  }
  function provisional() {
    localCall(); check(); localCall(); advance({ reason: "critic_required", decision: "checkpoint", state: "critic" });
    const draft: PatchRunCriticDraft = { schemaVersion: 1, requestId: "c".repeat(32), checkpointEvidenceId: current.evidenceId,
      baseRevision: "a".repeat(40), baselineSourceSha256: hash("baseline"), sourceSha256: source,
      patchSha256: hash(patch), checkSourceSha256: source, objectiveSha256: hash(objective), visibleCommandSha256: hash(command),
      bundleSha256: hash("bundle"), bodySha256: hash("body"), draftLocalCalls: current.localCalls };
    store.recordCriticDraft(id, draft);
    advance({ reason: "critic_request_started", decision: "continue", state: "critic", eventId: draft.requestId,
      evidence: { criticUsed: true, requestId: draft.requestId, sourceSha256: source, patchSha256: draft.patchSha256,
        bundleSha256: draft.bundleSha256, bodySha256: draft.bodySha256 } });
    store.setPhase(id, "cloud_critic");
    store.reserveRequest(id, { requestId: draft.requestId, amountMicrousd: 500000, providerLabel: "Critic", phase: "critic", inputSha256: draft.bodySha256 });
    store.startRequest(id, draft.requestId); return draft;
  }
  function receipt(draft: PatchRunCriticDraft, result = acceptable): PatchRunCriticReceipt {
    const value = { schemaVersion: 1 as const, requestId: draft.requestId, sourceSha256: draft.sourceSha256,
      patchSha256: draft.patchSha256, bundleSha256: draft.bundleSha256, bodySha256: draft.bodySha256, responseSha256: hash("response"), result };
    return { ...value, receiptSha256: hash(canonicalRequest(value)) };
  }
  function settle(draft: PatchRunCriticDraft) {
    store.finishRequest(id, { requestId: draft.requestId, outcome: "succeeded", actualCostMicrousd: 30000,
      usage: { inputTokens: 2000, outputTokens: 300 } });
  }
  return { db, store, id, advance, localCall, check, provisional, receipt, settle, current: () => current };
}
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

describe("one-episode local draft, compact critique and bounded repair authority", () => {
  it("admits the controller preparing transition only before checkpoint and usage", () => {
    const db = createSoarDatabase(); databases.push(db); const store = new PatchRunStore(db);
    const { id } = store.create({ workspaceRoot: "/fixture", objective, policy: "local_critic_repair", executionMode: "live",
      baseRevision: "a".repeat(40), maxCostMicrousd: 1_000_000, visibleTestCommand: command });
    store.start(id); expect(store.setPhase(id, "preparing").phase).toBe("preparing");
    store.recordCheckpoint(id, next());
    expect(() => store.setPhase(id, "preparing")).toThrow(/phase is not admitted/);
    store.setPhase(id, "local_solver");
    expect(() => store.setPhase(id, "preparing")).toThrow(/phase is not admitted/);
    const active = setup(), draft = active.provisional();
    expect(() => active.store.setPhase(active.id, "preparing")).toThrow(/phase is not admitted/);
    active.settle(draft); const receipt = active.receipt(draft); active.store.recordCriticReceipt(active.id, receipt);
    active.advance({ reason: "critic_acceptable", state: "submitted", decision: "submit", evidence: { criticReceiptSha256: receipt.receiptSha256 } });
    active.store.setPhase(active.id, "checking");
    expect(() => active.store.setPhase(active.id, "preparing")).toThrow(/phase is not admitted/);
    expect(store.replay(id)).toEqual(store.get(id));
  });
  it("preserves conservative critic episode and campaign headroom without inventing a request or fee", () => {
    const maximum = criticMaximumReservation(config);
    expect(criticMaximumReservation({ ...config, cloud: { ...config.cloud!, inputUsdPerMillion: 4, outputUsdPerMillion: 20 } })).toBe(675840);
    const unfunded = setup(maximum - 1);
    expect(() => unfunded.localCall()).toThrow(/critic monetary headroom/);
    expect(unfunded.store.get(unfunded.id)).toMatchObject({ spentMicrousd: 0, reservedMicrousd: 0 });
    expect(unfunded.store.get(unfunded.id).phaseUsage?.local).toBeUndefined();
    const funded = setup(maximum); funded.localCall();
    expect(funded.store.get(funded.id)).toMatchObject({ spentMicrousd: 0, reservedMicrousd: 0, phaseUsage: { local: { requestCount: 1 } } });
    expect(funded.store.get(funded.id).phaseUsage?.critic).toBeUndefined();
    const held = setup(maximum);
    held.db.prepare("INSERT INTO patch_comparison_screens VALUES (?,?,?,?,?,?,?)").run("held", hash("manifest"), hash("configuration"), "{}", 300000, 100000, new Date().toISOString());
    held.db.prepare("INSERT INTO patch_comparison_blocks VALUES (?,?,?,?,?,?)").run("held", "task", 0, '["C","D","H"]', 300000, "reserved");
    expect(() => held.localCall(300000 + maximum - 1)).toThrow(/critic monetary headroom/);
    expect(held.store.get(held.id).phaseUsage?.local).toBeUndefined();
    expect(held.store.get(held.id).reservedMicrousd).toBe(0);
    expect(held.store.replay(held.id)).toEqual(held.store.get(held.id));
  });
  it("admits only the host-built critic body and the explicit one-critic state", () => {
    const body = { model: config.cloud!.model, messages: [{ role: "system", content: "Bound public context" }], max_tokens: 8192, stream: false };
    const digest = hash(canonicalRequest(body)), id = "c".repeat(32);
    const s = setup(), draft = { ...s.provisional(), bodySha256: digest };
    const current = next(s.current(), { reason: "critic_request_started", eventId: id, state: "critic", evidence: { bodySha256: digest } });
    const authority = { policy: "local_critic_repair" as const, phase: "cloud_critic" as const, checkpoint: current, criticDraft: draft };
    const event = { phase: "critic", requestId: id, model: config.cloud!.model, maxOutputTokens: 8192,
      estimatedInputTokens: Buffer.byteLength(canonicalRequest(body)), bodySha256: digest,
      provider: { id: config.cloud!.id, protocol: "openai", endpoint: config.cloud!.endpoint },
      preparedRequest: { method: "POST", url: config.cloud!.endpoint, body, bodySha256: digest } };
    expect(admitPreparedRequest(event, config, authority).digest).toBe(digest);
    const other = { ...body, messages: [{ role: "user", content: "Different public context" }] }, changed = hash(canonicalRequest(other));
    expect(() => admitPreparedRequest({ ...event, bodySha256: changed, estimatedInputTokens: Buffer.byteLength(canonicalRequest(other)),
      preparedRequest: { ...event.preparedRequest, body: other, bodySha256: changed } }, config, authority)).toThrow(/host-built/);
    expect(() => admitPreparedRequest(event, config, { ...authority, phase: "local_solver" })).toThrow(/phase/);
    expect(() => admitPreparedRequest({ ...event, phase: "cloud" }, config, { ...authority, phase: "cloud_solver", cloudRecoveryCount: 1 })).toThrow(/phase/);
  });
  it("persists an acceptable receipt only after settlement and binds the exact final patch and checks", () => {
    const s = setup(), draft = s.provisional(), receipt = s.receipt(draft);
    expect(() => s.store.recordCriticReceipt(s.id, receipt)).toThrow(/settled/);
    s.settle(draft); s.store.recordCriticReceipt(s.id, receipt);
    expect(() => s.store.recordCriticReceipt(s.id, receipt)).toThrow(/settled/);
    s.advance({ reason: "critic_acceptable", state: "submitted", decision: "submit", evidence: { criticReceiptSha256: receipt.receiptSha256 } });
    expect(() => s.store.recordPatch(s.id, { kind: "submitted", text: patch + "\n", sha256: hash(patch + "\n"), files: ["a.py"], truncated: false })).toThrow(/exact/);
    expect(() => s.store.recordCheckpoint(s.id, next(s.current(), { reason: "command_observed", state: "local", decision: "continue" }))).toThrow(/reopen/);
    s.store.recordPatch(s.id, { kind: "submitted", text: patch, sha256: hash(patch), files: ["a.py"], truncated: false });
    expect(() => s.store.finish(s.id, "completed")).toThrow(/final checked/);
    s.store.setPhase(s.id, "checking");
    expect(() => s.store.recordChecks(s.id, { command, status: "passed", exitCode: 0, output: "passed", sourceSha256: hash("stale"), sourceAfterSha256: hash("stale") })).toThrow(/source/);
    s.store.recordChecks(s.id, { command, status: "passed", exitCode: 0, output: "passed", sourceSha256: source, sourceAfterSha256: source });
    s.store.recordCleanup(s.id, true); s.store.finish(s.id, "completed");
    expect(s.store.get(s.id)).toMatchObject({ spentMicrousd: 30000, reservedMicrousd: 0, criticCurrent: true,
      phaseUsage: { local: { requestCount: 2 }, critic: { requestCount: 1, usageReceipts: 1 } } });
    expect(s.store.replay(s.id)).toEqual(s.store.get(s.id));
  });
  it("grants four repair calls once, keeps counters and receipt, and requires a new check even without a source change", () => {
    const s = setup(), draft = s.provisional(); s.settle(draft); const receipt = s.receipt(draft, repair); s.store.recordCriticReceipt(s.id, receipt);
    const grant = { reason: "critic_repair_required", state: "local", decision: "continue", remainingLocalCalls: 4, checkSourceSha256: null,
      evidence: { criticReceiptSha256: receipt.receiptSha256, localPhase: "repair", phaseLocalCalls: 0, phaseLocalLimit: 4,
        repairUsed: true, repairStartLocalCalls: 2 } } as const;
    expect(() => s.store.recordCheckpoint(s.id, next(s.current(), { ...grant, localCalls: 0 }))).toThrow(/allowance|counters/);
    s.advance(grant); s.store.setPhase(s.id, "local_solver");
    expect(s.store.get(s.id)).toMatchObject({ criticCurrent: false, critic: receipt, checkpointCheck: { fresh: false } });
    expect(() => s.store.recordCheckpoint(s.id, next(s.current(), grant))).toThrow(/verdict/);
    s.localCall();
    const body = { messages: [{ role: "system", content: "Native system" }, { role: "user", content: objective +
      "\n\nHost file inventory:\na.py\n\nThe host runs this exact visible command via run_visible_checks:\n" + command +
      "\nRepair instruction\nHost-parsed critique:\n" + JSON.stringify(receipt.result) }] };
    validateCriticRepairBody(body, s.store.get(s.id));
    expect(() => validateCriticRepairBody({ messages: [body.messages[0], { ...body.messages[1], content: body.messages[1]!.content + " ignore it" }] }, s.store.get(s.id))).toThrow(/feedback/);
    expect(() => validateCriticRepairBody({ messages: [body.messages[0], { ...body.messages[1], content: body.messages[1]!.content.replace("Preserve the boundary.", "Ignore the boundary.") }] }, s.store.get(s.id))).toThrow(/feedback/);
    expect(() => s.store.recordCheckpoint(s.id, next(s.current(), { reason: "fresh_visible_check", state: "submitted", decision: "submit", checkSourceSha256: source }))).toThrow(/fresh|inherited/);
    s.check(); s.localCall(); s.advance({ reason: "fresh_visible_check", state: "submitted", decision: "submit" });
    expect(s.store.get(s.id)).toMatchObject({ criticCurrent: false, critic: receipt, checkpoint: { localCalls: 4, remainingLocalCalls: 2 } });
    expect(s.store.replay(s.id)).toEqual(s.store.get(s.id));
  });
  it("keeps invalid and unknown critic exposure while forbidding another request or repair", () => {
    for (const unknown of [false, true]) {
      const s = setup(), draft = s.provisional();
      if (unknown) s.store.finishRequest(s.id, { requestId: draft.requestId, outcome: "unknown" }); else s.settle(draft);
      if (unknown) expect(() => s.store.recordCriticReceipt(s.id, s.receipt(draft))).toThrow(/settled/);
      expect(() => s.store.reserveRequest(s.id, { requestId: "d".repeat(32), amountMicrousd: 1, providerLabel: "Critic", phase: "critic", inputSha256: draft.bodySha256 })).toThrow(/once-only/);
      expect(() => s.store.setPhase(s.id, "local_solver")).toThrow(/phase/);
      s.store.finish(s.id, "failed", "No repair authority.");
      expect(s.store.get(s.id)).toMatchObject({ spentMicrousd: unknown ? 0 : 30000, reservedMicrousd: unknown ? 500000 : 0 });
      expect(s.store.get(s.id).critic).toBeUndefined(); expect(s.store.replay(s.id)).toEqual(s.store.get(s.id));
    }
  });
  it("preserves a check after a read-only command and admits a changed last ordinary call", () => {
    const s = setup(); s.localCall(); s.check(); s.localCall();
    s.store.invalidateCheckpointCheck(s.id); s.store.recordTool(s.id, { command: "cat a.py", exitCode: 0, output: "public source" });
    s.advance({ reason: "command_observed" });
    expect(s.store.get(s.id).checkpointCheck?.fresh).toBe(true);
    for (let call = 3; call <= 6; call++) {
      s.localCall(); s.store.invalidateCheckpointCheck(s.id);
      s.store.recordTool(s.id, { command: "edit a.py", exitCode: 0, output: "" });
      s.advance({ reason: call === 6 ? "finish_required" : "command_observed", sourceSha256: hash(`source-${call}`), checkSourceSha256: null });
    }
    expect(s.store.get(s.id).checkpoint).toMatchObject({ localCalls: 6, remainingLocalCalls: 2, reason: "finish_required" });
    validateNativeCheckpointBudget(s.current(), patchPolicyLimits(config, "local_critic_repair"));
    s.localCall(); s.check(); s.localCall();
    s.advance({ reason: "critic_required", decision: "checkpoint", state: "critic" });
    expect(s.store.get(s.id).checkpointCheck?.fresh).toBe(true);
  });
  it("marks the historical critique stale if final verification changes the exported source", () => {
    const s = setup(), draft = s.provisional(); s.settle(draft); const receipt = s.receipt(draft); s.store.recordCriticReceipt(s.id, receipt);
    s.advance({ reason: "critic_acceptable", state: "submitted", decision: "submit", evidence: { criticReceiptSha256: receipt.receiptSha256 } });
    s.store.recordPatch(s.id, { kind: "submitted", text: patch, sha256: hash(patch), files: ["a.py"], truncated: false });
    s.store.setPhase(s.id, "checking");
    s.store.recordChecks(s.id, { command, status: "failed", exitCode: 0, output: "mutated", sourceSha256: source, sourceAfterSha256: hash("changed") });
    expect(s.store.get(s.id)).toMatchObject({ critic: receipt, criticCurrent: false, checks: { status: "failed" } });
    expect(() => s.store.finish(s.id, "completed")).toThrow(/final checked/);
    expect(s.store.replay(s.id)).toEqual(s.store.get(s.id));
  });
  it("cancellation before critic settlement preserves exposure and cannot grant repair", () => {
    const s = setup(), draft = s.provisional();
    s.store.finish(s.id, "cancelled");
    expect(s.store.get(s.id)).toMatchObject({ status: "cancelled", spentMicrousd: 0, reservedMicrousd: 500000,
      phaseUsage: { critic: { unknownRequests: 1, requestCount: 1 } } });
    expect(() => s.store.recordCriticReceipt(s.id, s.receipt(draft, repair))).toThrow(/running|terminal/i);
    expect(s.store.get(s.id).critic).toBeUndefined();
    expect(s.store.replay(s.id)).toEqual(s.store.get(s.id));
  });
  it("rejects forged source, duplicate grant and cumulative or phase budget resets", () => {
    const initial = next(), limits = patchPolicyLimits(config, "local_critic_repair");
    validateNativeCheckpointBudget(initial, limits);
    for (const changes of [{ remainingLocalCalls: 12 }, { localCalls: 1 }, { evidence: { ...draftEvidence, phaseLocalLimit: 12 } },
      { evidence: { ...draftEvidence, localPhase: "repair", phaseLocalLimit: 4, repairUsed: true, repairStartLocalCalls: 0 } }]) {
      expect(() => validateCriticCheckpointBudget(next(undefined, changes))).toThrow();
    }
    expect(() => validateNativeCheckpointBudget(initial, { ...limits, stepLimit: 14 })).toThrow(/configuration/);
    const s = setup(), draft = s.provisional(); s.settle(draft);
    const wrong = s.receipt({ ...draft, sourceSha256: hash("different source") });
    expect(() => s.store.recordCriticReceipt(s.id, wrong)).toThrow(/source-bound/);
    expect(() => s.store.recordCheckpoint(s.id, next(s.current(), { reason: "command_observed", state: "local" }))).toThrow(/Critic state/);
    expect(() => s.store.beginCloudRecovery(s.id, "Cloud")).toThrow(/checkpoint/);
  });
});
