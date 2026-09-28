import { afterEach, describe, expect, it } from "vitest";
import { createSoarDatabase, type SoarDatabase } from "../../src/main/database";
import { PatchRunStore } from "../../src/main/patch-runs/store";
import { patchPolicyNeedsPlan, type PatchRunPolicy, type PatchRunCheckpointCheck } from "../../src/shared/patch-run-contracts";
import { checkpoint, hash } from "../helpers/patch-native-fixture";

const databases: SoarDatabase[] = [];
const command = "python public_cases.py";
const check: PatchRunCheckpointCheck = { command, exitCode: 0, output: "public tests passed", elapsedMs: 120,
  sourceSha256: "a".repeat(64), sourceAfterSha256: "a".repeat(64), passed: true, fresh: true };
function setup(policy: PatchRunPolicy = "local_first") {
  const db = createSoarDatabase(); databases.push(db); const store = new PatchRunStore(db);
  const { id } = store.create({ workspaceRoot: "/fixture", objective: "Fix public behavior", policy,
    executionMode: "live", baseRevision: "a".repeat(40), maxCostMicrousd: 5_000_000, visibleTestCommand: command });
  store.start(id); store.setPhase(id, patchPolicyNeedsPlan(policy) ? "cloud_planner" : "local_solver");
  return { store, id };
}
function pendingHandoff(store: PatchRunStore, id: string) {
  const first = checkpoint(); store.recordCheckpoint(id, first);
  const next = checkpoint(first, { decision: "checkpoint", state: "checkpoint", reason: "explicit_help", handoffCandidate: true });
  store.recordCheckpoint(id, next);
  return next;
}
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

describe("native checkpoint persistence and route authority", () => {
  it("checks the canonical evidence chain and preserves it exactly on replay", () => {
    const { store, id } = setup(); const first = checkpoint();
    store.recordCheckpoint(id, first);
    expect(() => store.recordCheckpoint(id, first)).toThrow(/ordered/);
    expect(() => store.recordCheckpoint(id, { ...checkpoint(first), evidenceId: "0".repeat(64) })).toThrow(/identity/);
    expect(() => store.recordCheckpoint(id, checkpoint())).toThrow(/ordered/);
    store.recordCheckpoint(id, checkpoint(first, { reason: "command_observed" }));
    expect(store.replay(id)).toEqual(store.get(id));
  });
  it("requires the exact command and unchanged source for a passing check and submission", () => {
    const { store, id } = setup();
    expect(() => store.recordCheckpointCheck(id, { ...check, command: "python public_cases.py | tail" })).toThrow(/authority/);
    expect(() => store.recordCheckpointCheck(id, { ...check, sourceAfterSha256: "b".repeat(64) })).toThrow(/authority/);
    const first = checkpoint(); store.recordCheckpoint(id, first);
    const submitted = checkpoint(first, { decision: "submit", state: "submitted", reason: "fresh_visible_check", checkSourceSha256: check.sourceSha256 });
    expect(() => store.recordCheckpoint(id, submitted)).toThrow(/fresh/);
    store.recordCheckpointCheck(id, check); store.invalidateCheckpointCheck(id);
    expect(store.get(id).checkpointCheck?.fresh).toBe(false);
    expect(() => store.recordCheckpoint(id, checkpoint(first, { ...submitted, sourceSha256: "b".repeat(64), checkSourceSha256: "b".repeat(64) }))).toThrow(/fresh/);
    store.recordCheckpoint(id, submitted);
    expect(store.get(id).checkpointCheck?.fresh).toBe(true);
    expect(store.get(id).checks.status).toBe("not_run");
    expect(store.replay(id)).toEqual(store.get(id));
  });
  it("admits one irreversible recovery only after a byte-bound artifact handoff", () => {
    const { store, id } = setup(); const ready = pendingHandoff(store, id);
    const text = "diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n-old\n+new\n";
    const handoff = { patchSha256: hash(text), sourceSha256: ready.sourceSha256, bytes: Buffer.byteLength(text), summary: "Public work remains." };
    expect(() => store.recordHandoff(id, handoff)).toThrow(/match/);
    store.recordPatch(id, { kind: "recovered", text, sha256: hash(text), files: ["a.py"], truncated: false });
    store.recordHandoff(id, handoff);
    expect(() => store.beginCloudRecovery(id, "Cloud fixture")).toThrow(/checkpoint/);
    store.recordCheckpoint(id, checkpoint(ready, { decision: "escalate", state: "cloud", reason: "handoff_confirmed", handoffUsed: true }));
    store.beginCloudRecovery(id, "Cloud fixture");
    expect(store.get(id)).toMatchObject({ phase: "cloud_solver", cloudRecoveryCount: 1, checks: { status: "not_run" }, patch: { kind: "recovered" } });
    expect(() => store.beginCloudRecovery(id, "Cloud fixture")).toThrow(/checkpoint/);
    expect(store.replay(id)).toEqual(store.get(id));
  });
  it("never admits a cloud handoff for local-only work", () => {
    const { store, id } = setup("local_only");
    const first = checkpoint(undefined, { policy: "local_only" }); store.recordCheckpoint(id, first);
    const ready = checkpoint(first, { policy: "local_only", decision: "checkpoint", state: "checkpoint", reason: "explicit_help" });
    store.recordCheckpoint(id, ready);
    expect(() => store.recordHandoff(id, { patchSha256: hash(""), sourceSha256: ready.sourceSha256, bytes: 0, summary: "Help" })).toThrow(/checkpoint/);
    expect(() => store.recordCheckpoint(id, checkpoint(ready, { policy: "local_only", decision: "escalate", state: "cloud", reason: "handoff_confirmed", handoffUsed: true }))).toThrow(/recovery/);
  });
  it("keeps zero-fee unknown requests blocking checks and cloud recovery", () => {
    const { store, id } = setup(); const ready = pendingHandoff(store, id);
    store.reserveRequest(id, { requestId: "unknown-local", amountMicrousd: 0, providerLabel: "Local", phase: "local" });
    store.startRequest(id, "unknown-local"); store.finishRequest(id, { requestId: "unknown-local", outcome: "unknown" });
    expect(store.get(id).reservedMicrousd).toBe(0);
    expect(store.hasUnresolvedRequests(id)).toBe(true);
    expect(() => store.recordCheckpointCheck(id, check)).toThrow(/authority/);
    expect(() => store.recordHandoff(id, { patchSha256: hash(""), sourceSha256: ready.sourceSha256, bytes: 0, summary: "Help" })).toThrow(/checkpoint/);
    expect(store.replay(id)).toEqual(store.get(id));
  });
  it.each(["cloud_plan_local", "cloud_plan_local_review"] as const)("requires one settled planning request and reports its fee separately for %s", (policy) => {
    const { store, id } = setup(policy); const plan = { summary: "Inspect public source, implement and check.", sha256: hash("Inspect public source, implement and check.") };
    expect(() => store.recordPlan(id, plan)).toThrow(/planning/);
    store.reserveRequest(id, { requestId: "plan", amountMicrousd: 500000, providerLabel: "Planner", phase: "planner" });
    store.startRequest(id, "plan");
    expect(() => store.recordPlan(id, plan)).toThrow(/planning/);
    store.finishRequest(id, { requestId: "plan", outcome: "succeeded", actualCostMicrousd: 20000, usage: { inputTokens: 1000, outputTokens: 100 } });
    store.recordPlan(id, plan);
    expect(() => store.recordPlan(id, plan)).toThrow(/planning/);
    expect(store.get(id)).toMatchObject({ spentMicrousd: 20000, phaseUsage: { planner: { requestCount: 1, usageReceipts: 1, spentMicrousd: 20000 } } });
    expect(store.replay(id)).toEqual(store.get(id));
  });
  it("makes reviewed local submissions provisional and binds them to the exact passing source", () => {
    const policy = "cloud_plan_local_review";
    const { store, id } = setup(policy); store.setPhase(id, "local_solver");
    const first = checkpoint(undefined, { policy }); store.recordCheckpoint(id, first);
    const ready = checkpoint(first, { policy, decision: "checkpoint", state: "checkpoint", reason: "review_required",
      handoffCandidate: true, checkSourceSha256: check.sourceSha256, evidence: { checkSourceSha256: check.sourceSha256 } });
    expect(() => store.recordCheckpoint(id, ready)).toThrow(/fresh passing/);
    store.recordCheckpointCheck(id, check); store.invalidateCheckpointCheck(id);
    for (const override of [{ sourceSha256: "b".repeat(64) }, { checkSourceSha256: "b".repeat(64) },
      { evidence: { checkSourceSha256: "b".repeat(64) } }, { handoffCandidate: false }, { state: "submitted" as const }]) {
      expect(() => store.recordCheckpoint(id, checkpoint(first, { ...ready, ...override }))).toThrow();
    }
    expect(() => store.recordCheckpoint(id, checkpoint(first, { policy, decision: "submit", state: "submitted", reason: "fresh_visible_check",
      checkSourceSha256: check.sourceSha256 }))).toThrow(/provisional/);
    store.recordCheckpoint(id, ready);
    expect(store.get(id)).toMatchObject({ checkpoint: { decision: "checkpoint", reason: "review_required" }, checkpointCheck: { fresh: true } });
    const text = "diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n-old\n+new\n";
    expect(() => store.recordPatch(id, { text, sha256: hash(text), files: ["a.py"], truncated: false })).toThrow(/cloud review phase/);
    store.recordPatch(id, { kind: "recovered", text, sha256: hash(text), files: ["a.py"], truncated: false });
    expect(() => store.finish(id, "completed")).toThrow(/Recovered/);
    expect(store.replay(id)).toEqual(store.get(id));
  });
  it("admits review reserves only for the new policy with consistent timing evidence", () => {
    const policy = "cloud_plan_local_review";
    const { store, id } = setup(policy); store.setPhase(id, "local_solver");
    const first = checkpoint(undefined, { policy }); store.recordCheckpoint(id, first);
    const ready = checkpoint(first, { policy, decision: "checkpoint", state: "checkpoint", reason: "review_time_reserve",
      handoffCandidate: true, evidence: { remainingMs: 360000, requestTimeoutMs: 120000, checkReserveMs: 60000, requiredReviewReserveMs: 360000 } });
    for (const evidence of [{ ...ready.evidence, remainingMs: 360001 }, { ...ready.evidence, requiredReviewReserveMs: 180000 },
      { ...ready.evidence, checkReserveMs: 0 }, { ...ready.evidence, remainingMs: "1" }]) {
      expect(() => store.recordCheckpoint(id, checkpoint(first, { ...ready, evidence }))).toThrow();
    }
    store.recordCheckpoint(id, ready);
    const previous = setup("local_first"); const oldFirst = checkpoint(); previous.store.recordCheckpoint(previous.id, oldFirst);
    expect(() => previous.store.recordCheckpoint(previous.id, checkpoint(oldFirst, { ...ready, policy: "local_first" }))).toThrow(/authority/);
    expect(store.replay(id)).toEqual(store.get(id));
  });
  it("requires a settled cloud response after a valid reviewed-policy handoff before capturing a submission", () => {
    const policy = "cloud_plan_local_review", { store, id } = setup(policy);
    const summary = "Inspect and implement the public change.";
    store.reserveRequest(id, { requestId: "plan", amountMicrousd: 1000, providerLabel: "Planner", phase: "planner" });
    store.startRequest(id, "plan"); store.finishRequest(id, { requestId: "plan", outcome: "succeeded", actualCostMicrousd: 100,
      usage: { inputTokens: 10, outputTokens: 10 } });
    store.recordPlan(id, { summary, sha256: hash(summary) }); store.setPhase(id, "local_solver");
    const first = checkpoint(undefined, { policy }); store.recordCheckpoint(id, first);
    const ready = checkpoint(first, { policy, decision: "checkpoint", state: "checkpoint", reason: "explicit_help", handoffCandidate: true });
    store.recordCheckpoint(id, ready);
    const text = "diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n-old\n+new\n";
    const patch = { text, sha256: hash(text), files: ["a.py"], truncated: false };
    store.recordPatch(id, { ...patch, kind: "recovered" });
    store.recordHandoff(id, { patchSha256: patch.sha256, sourceSha256: ready.sourceSha256, bytes: Buffer.byteLength(text), summary: "Review the current patch." });
    store.recordCheckpoint(id, checkpoint(ready, { policy, decision: "escalate", state: "cloud", reason: "handoff_confirmed", handoffUsed: true }));
    store.beginCloudRecovery(id, "Reviewer");
    expect(() => store.recordPatch(id, { ...patch, kind: "submitted" })).toThrow(/settled cloud review/);
    store.reserveRequest(id, { requestId: "review", amountMicrousd: 1000, providerLabel: "Reviewer", phase: "cloud" });
    store.startRequest(id, "review");
    expect(() => store.recordPatch(id, { ...patch, kind: "submitted" })).toThrow(/settled cloud review/);
    store.finishRequest(id, { requestId: "review", outcome: "succeeded", actualCostMicrousd: 200,
      usage: { inputTokens: 20, outputTokens: 20 } });
    store.recordPatch(id, { ...patch, kind: "submitted" }); store.finish(id, "completed");
    expect(store.get(id)).toMatchObject({ status: "completed", cloudRecoveryCount: 1, patch: { kind: "submitted" }, spentMicrousd: 300 });
    expect(store.replay(id)).toEqual(store.get(id));
  });
});
