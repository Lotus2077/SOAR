import { afterEach, describe, expect, it } from "vitest";
import { createSoarDatabase, type SoarDatabase } from "../../src/main/database";
import { PatchRunStore } from "../../src/main/patch-runs/store";
import { PatchRunPlanChecksSchema, PatchRunPlannerCheckResultSchema, PatchRunPlannerCheckSchema,
  PatchRunPlanSchema, PatchRunSnapshotSchema, type PatchRunPlanChecks, type PatchRunPlannerCheck,
  type PatchRunPlannerCheckResult, type PatchRunPolicy } from "../../src/shared/patch-run-contracts";
import { checkpoint, hash } from "../helpers/patch-native-fixture";

const databases: SoarDatabase[] = [];
const source = "import unittest\nclass PublicCases(unittest.TestCase):\n    def test_behavior(self):\n        self.assertEqual(2 + 2, 4)\n";
const artifact: PatchRunPlanChecks = { schemaVersion: 1, kind: "model_generated_python_unittest", source,
  sha256: hash(source), expectedTests: 1, testIds: ["PublicCases.test_behavior"] };
const summary = "Implement the public behavior and run both check sources.";
const command = "python public_cases.py", tree = "a".repeat(64), otherTree = "b".repeat(64);
const visible = { command, exitCode: 0, output: "public checks passed", elapsedMs: 10,
  sourceSha256: tree, sourceAfterSha256: tree, passed: true, fresh: true };
const patchText = "diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n-old\n+new\n";
const patch = { text: patchText, sha256: hash(patchText), files: ["a.py"], truncated: false };

function open(policy: PatchRunPolicy = "cloud_plan_local") {
  const database = createSoarDatabase(); databases.push(database);
  const store = new PatchRunStore(database);
  const { id } = store.create({ workspaceRoot: "/fixture", objective: "Fix public behavior", policy,
    executionMode: "live", baseRevision: "a".repeat(40), maxCostMicrousd: 5_000_000, visibleTestCommand: command });
  store.start(id); store.setPhase(id, "cloud_planner");
  return { database, store, id };
}
function settlePlan(store: PatchRunStore, id: string) {
  store.reserveRequest(id, { requestId: "planner-1", phase: "planner", providerLabel: "Fixture planner", amountMicrousd: 1000 });
  store.startRequest(id, "planner-1");
  store.finishRequest(id, { requestId: "planner-1", outcome: "succeeded", actualCostMicrousd: 100,
    usage: { inputTokens: 10, outputTokens: 10 } });
}
function ready(withArtifact = true, policy: PatchRunPolicy = "cloud_plan_local") {
  const run = open(policy); settlePlan(run.store, run.id);
  run.store.recordPlan(run.id, { summary, sha256: hash(summary), ...(withArtifact ? { checks: artifact } : {}) });
  run.store.setPhase(run.id, "local_solver");
  return run;
}
function result(overrides: Partial<PatchRunPlannerCheckResult> = {}): PatchRunPlannerCheckResult {
  return { schemaVersion: 1, kind: artifact.kind, sourceSha256: artifact.sha256, expectedTests: 1,
    discoveredTests: 1, testsRun: 1, passed: 1, failures: 0, errors: 0, skipped: 0, expectedFailures: 0,
    unexpectedSuccesses: 0, completed: true, status: "passed", detail: "", ...overrides };
}
function receipt(overrides: Partial<PatchRunPlannerCheck> = {}): PatchRunPlannerCheck {
  const parsedResult = overrides.result === undefined ? result() : overrides.result;
  return { stage: "checkpoint", artifactSha256: artifact.sha256, sourceSha256: tree, sourceAfterSha256: tree,
    exitCode: 0, output: parsedResult ? "SOAR_MODEL_GENERATED_CHECKS_V1=" + JSON.stringify(parsedResult) : "invalid output",
    outputTruncated: false, elapsedMs: 10, timedOut: false, result: parsedResult, passed: true, fresh: true, ...overrides };
}
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

describe("model-generated planner check persistence", () => {
  it("preserves legacy plans and snapshots without optional generated-check fields", () => {
    const { store, id } = ready(false);
    expect(store.get(id).cloudPlan).toEqual({ summary, sha256: hash(summary) });
    expect(store.get(id)).not.toHaveProperty("plannerCheck");
    expect(PatchRunPlanSchema.parse({ summary, sha256: hash(summary) })).toEqual({ summary, sha256: hash(summary) });
    const initial = checkpoint(undefined, { policy: "cloud_plan_local" }); store.recordCheckpoint(id, initial);
    store.recordCheckpointCheck(id, visible);
    store.recordCheckpoint(id, checkpoint(initial, { policy: "cloud_plan_local", decision: "submit", state: "submitted",
      reason: "fresh_visible_check", checkSourceSha256: tree }));
    store.recordPatch(id, patch); store.recordChecks(id, { status: "passed", command, exitCode: 0, output: "legacy" });
    expect(store.finish(id, "completed").status).toBe("completed");
    expect(store.replay(id)).toEqual(store.get(id));
  });

  it("binds generated source SHA after the single planning request settles", () => {
    const { store, id } = open();
    const plan = { summary, sha256: hash(summary), checks: artifact };
    expect(() => store.recordPlan(id, plan)).toThrow(/planning/);
    settlePlan(store, id);
    expect(() => store.recordPlan(id, { ...plan, checks: { ...artifact, source: source + "\n" } })).toThrow(/identity/);
    store.recordPlan(id, plan);
    expect(store.get(id).cloudPlan?.checks).toEqual(artifact);
    expect(() => store.recordPlan(id, plan)).toThrow(/planning/);
    expect(store.get(id).spentMicrousd).toBe(100);
    expect(store.replay(id)).toEqual(store.get(id));
  });

  it("validates UTF-8 source bytes, strict artifact fields and sorted unique declared identities", () => {
    const exact = source + "#" + "x".repeat(6000 - Buffer.byteLength(source) - 1);
    expect(PatchRunPlanChecksSchema.parse({ ...artifact, source: exact }).source).toBe(exact);
    for (const changes of [{ source: exact + "x" }, { source: "中".repeat(2001) }, { source: "\ud800" }, { source: "\0" },
      { expectedTests: true }, { expectedTests: 0 }, { expectedTests: 13 }, { expectedTests: 2 }, { schemaVersion: 2 },
      { kind: "trusted_public" }, { extra: true }, { testIds: ["PublicCases.test_behavior", "PublicCases.test_behavior"], expectedTests: 2 },
      { testIds: ["Z.test_x", "A.test_x"], expectedTests: 2 }, { testIds: ["missing_method"] }]) {
      expect(PatchRunPlanChecksSchema.safeParse({ ...artifact, ...changes }).success).toBe(false);
    }
    expect(PatchRunPlanChecksSchema.parse({ ...artifact, expectedTests: 2, testIds: ["A.test_x", "Z.test_x"] }).expectedTests).toBe(2);
  });

  it("keeps generated receipt distinct from trusted visible checks and replays exactly", () => {
    const { store, id } = ready();
    store.recordCheckpointCheck(id, visible);
    const snapshot = store.recordPlannerCheck(id, receipt());
    expect(snapshot.checkpointCheck).toEqual(visible);
    expect(snapshot.plannerCheck).toEqual(receipt());
    expect(snapshot.checks.status).toBe("not_run");
    expect(snapshot.plannerCheck?.result).not.toHaveProperty("accepted");
    expect(PatchRunSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(store.replay(id)).toEqual(snapshot);
  });

  it("requires a plan artifact, correct phase and matching artifact/count", () => {
    const legacy = ready(false);
    expect(() => legacy.store.recordPlannerCheck(legacy.id, receipt())).toThrow(/authority/);
    const { store, id } = ready();
    expect(() => store.recordPlannerCheck(id, receipt({ stage: "final" }))).toThrow(/authority/);
    expect(() => store.recordPlannerCheck(id, receipt({ artifactSha256: "c".repeat(64), result: result({ sourceSha256: "c".repeat(64) }) }))).toThrow(/authority/);
    const two = result({ expectedTests: 2, discoveredTests: 2, testsRun: 2, passed: 2 });
    expect(() => store.recordPlannerCheck(id, receipt({ result: two }))).toThrow(/authority/);
    store.setPhase(id, "checking");
    expect(() => store.recordPlannerCheck(id, receipt())).toThrow(/authority/);
    expect(store.recordPlannerCheck(id, receipt({ stage: "final" })).plannerCheck?.stage).toBe("final");
  });

  it.each(["reserved", "started", "unknown"] as const)("blocks generated checks during %s requests including zero-fee unknowns", (state) => {
    const { store, id } = ready();
    store.reserveRequest(id, { requestId: "local-1", phase: "local", providerLabel: "Fixture local", amountMicrousd: 0 });
    if (state !== "reserved") store.startRequest(id, "local-1");
    if (state === "unknown") store.finishRequest(id, { requestId: "local-1", outcome: "unknown" });
    expect(() => store.recordPlannerCheck(id, receipt())).toThrow(/authority/);
    expect(store.hasUnresolvedRequests(id)).toBe(true);
    expect(store.replay(id)).toEqual(store.get(id));
  });

  it("rejects impossible passing receipts and inconsistent process/count status", () => {
    for (const changes of [{ result: null }, { timedOut: true }, { outputTruncated: true }, { exitCode: 1 },
      { sourceAfterSha256: otherTree }, { passed: false }, { artifactSha256: "c".repeat(64) },
      { output: "中".repeat(5462) }, { output: "\ud800" }, { elapsedMs: Number.MAX_SAFE_INTEGER + 1 },
      { result: { ...result(), testsRun: 0 } }, { result: { ...result(), passed: true } },
      { result: { ...result(), skipped: 1 } }, { result: { ...result(), extra: true } }]) {
      expect(PatchRunPlannerCheckSchema.safeParse({ ...receipt(), ...changes }).success).toBe(false);
    }
    expect(PatchRunPlannerCheckResultSchema.safeParse(result({ discoveredTests: 2 })).success).toBe(false);
    expect(PatchRunPlannerCheckResultSchema.safeParse(result({ expectedFailures: 1 })).success).toBe(false);
    expect(PatchRunPlannerCheckResultSchema.safeParse(result({ detail: "x".repeat(2049) })).success).toBe(false);
  });

  it("retains null invalid results and completed failures without promoting either", () => {
    const { store, id } = ready();
    for (const failed of [receipt({ result: null, exitCode: 124, timedOut: true, passed: false }),
      receipt({ result: null, output: "malformed\0output", passed: false }),
      receipt({ result: result({ passed: 0, failures: 1, status: "failed" }), exitCode: 1, passed: false }),
      receipt({ result: result({ passed: 0, skipped: 1, status: "failed" }), exitCode: 1, passed: false }),
      receipt({ result: result({ discoveredTests: 0, testsRun: 0, passed: 0, completed: false, status: "invalid" }), exitCode: 2, passed: false }),
      receipt({ sourceAfterSha256: otherTree, passed: false, fresh: false })]) {
      expect(store.recordPlannerCheck(id, failed).plannerCheck?.passed).toBe(false);
    }
    expect(() => store.recordPlannerCheck(id, receipt({ fresh: false }))).toThrow(/authority/);
    expect(store.replay(id)).toEqual(store.get(id));
  });

  it("invalidates generated freshness on command and restores it only from exact later source hashes", () => {
    const { store, id } = ready();
    const first = checkpoint(undefined, { policy: "cloud_plan_local" }); store.recordCheckpoint(id, first);
    store.recordPlannerCheck(id, receipt());
    store.recordTool(id, { command: "cat a.py", exitCode: 0, output: "source" });
    expect(store.get(id).plannerCheck?.fresh).toBe(false);
    const unchanged = checkpoint(first, { policy: "cloud_plan_local", reason: "command_observed" });
    expect(store.recordCheckpoint(id, unchanged).plannerCheck?.fresh).toBe(true);
    store.invalidateCheckpointCheck(id);
    expect(store.get(id).plannerCheck?.fresh).toBe(false);
    const changed = checkpoint(unchanged, { policy: "cloud_plan_local", reason: "command_observed", sourceSha256: otherTree });
    expect(store.recordCheckpoint(id, changed).plannerCheck?.fresh).toBe(false);
    expect(store.replay(id)).toEqual(store.get(id));
  });

  it.each(["continue", "submit"] as const)("requires generated passing evidence before %s can claim a checked source", (decision) => {
    const { store, id } = ready();
    const first = checkpoint(undefined, { policy: "cloud_plan_local" }); store.recordCheckpoint(id, first);
    store.recordCheckpointCheck(id, visible);
    const next = checkpoint(first, { policy: "cloud_plan_local", decision, state: decision === "submit" ? "submitted" : "local",
      reason: "fresh_visible_check", checkSourceSha256: tree });
    expect(() => store.recordCheckpoint(id, next)).toThrow(/generated planner check/);
    store.recordPlannerCheck(id, receipt({ result: null, passed: false }));
    expect(() => store.recordCheckpoint(id, next)).toThrow(/generated planner check/);
    store.recordPlannerCheck(id, receipt()); store.invalidateCheckpointCheck(id);
    expect(store.recordCheckpoint(id, next).plannerCheck?.fresh).toBe(true);
  });

  it("requires generated checks before review_required and retains failure reasons", () => {
    const { store, id } = ready(true, "cloud_plan_local_review");
    const first = checkpoint(undefined, { policy: "cloud_plan_local_review" }); store.recordCheckpoint(id, first);
    store.recordCheckpointCheck(id, visible);
    const next = checkpoint(first, { policy: "cloud_plan_local_review", decision: "checkpoint", state: "checkpoint",
      reason: "review_required", handoffCandidate: true, checkSourceSha256: tree, evidence: { checkSourceSha256: tree } });
    expect(() => store.recordCheckpoint(id, next)).toThrow(/generated planner check/);
    store.recordPlannerCheck(id, receipt());
    store.recordCheckpoint(id, next);
    expect(store.replay(id)).toEqual(store.get(id));
    for (const reason of ["planner_check_failed", "planner_check_invalid"] as const) {
      const current = store.get(id).checkpoint!;
      store.recordCheckpoint(id, checkpoint(current, { policy: "cloud_plan_local_review", decision: "stop", state: "stopped", reason }));
    }
  });

  it("rejects relabeled checked-source digests and submitted state without generated evidence", () => {
    const { store, id } = ready();
    const first = checkpoint(undefined, { policy: "cloud_plan_local" }); store.recordCheckpoint(id, first);
    expect(() => store.recordCheckpoint(id, checkpoint(first, { policy: "cloud_plan_local", state: "submitted" }))).toThrow(/generated planner check/);
    store.recordPlannerCheck(id, receipt());
    expect(() => store.recordCheckpoint(id, checkpoint(first, { policy: "cloud_plan_local", checkSourceSha256: otherTree }))).toThrow(/generated planner check/);
    expect(store.get(id).checkpoint).toEqual(first);
    expect(store.replay(id)).toEqual(store.get(id));
  });

  it("requires final generated evidence on the same source before passing completion", () => {
    const { store, id } = ready();
    store.recordPlannerCheck(id, receipt()); store.recordPatch(id, patch); store.setPhase(id, "checking");
    store.recordChecks(id, { status: "passed", command, exitCode: 0, output: "public passed", sourceSha256: tree, sourceAfterSha256: tree });
    expect(() => store.finish(id, "completed")).toThrow(/final generated checks/);
    store.recordPlannerCheck(id, receipt({ stage: "final", result: result({ passed: 0, failures: 1, status: "failed" }), exitCode: 1, passed: false }));
    expect(() => store.finish(id, "completed")).toThrow(/final generated checks/);
    store.recordPlannerCheck(id, receipt({ stage: "final", sourceSha256: otherTree, sourceAfterSha256: otherTree }));
    expect(() => store.finish(id, "completed")).toThrow(/final generated checks/);
    store.recordPlannerCheck(id, receipt({ stage: "final" }));
    expect(store.finish(id, "completed").status).toBe("completed");
    expect(store.replay(id)).toEqual(store.get(id));
  });

  it("preserves final cloud-source freshness when the local router stops on its earlier source", () => {
    const policy = "cloud_plan_local_review", { store, id } = ready(true, policy);
    const initial = checkpoint(undefined, { policy }); store.recordCheckpoint(id, initial);
    store.recordCheckpointCheck(id, visible); store.recordPlannerCheck(id, receipt());
    const reviewed = checkpoint(initial, { policy, decision: "checkpoint", state: "checkpoint", reason: "review_required",
      handoffCandidate: true, checkSourceSha256: tree, evidence: { checkSourceSha256: tree } });
    store.recordCheckpoint(id, reviewed); store.recordPatch(id, { ...patch, kind: "recovered" });
    store.recordHandoff(id, { patchSha256: patch.sha256, sourceSha256: tree, bytes: Buffer.byteLength(patchText),
      summary: "Review the candidate.", checkSourceSha256: tree });
    const cloud = checkpoint(reviewed, { policy, decision: "escalate", state: "cloud", reason: "handoff_confirmed",
      handoffUsed: true, checkSourceSha256: tree });
    store.recordCheckpoint(id, cloud); store.beginCloudRecovery(id, "Fixture reviewer");
    store.reserveRequest(id, { requestId: "review-1", phase: "cloud", providerLabel: "Fixture reviewer", amountMicrousd: 1000 });
    store.startRequest(id, "review-1"); store.finishRequest(id, { requestId: "review-1", outcome: "succeeded", actualCostMicrousd: 200,
      usage: { inputTokens: 10, outputTokens: 10 } });
    store.recordPatch(id, { ...patch, kind: "submitted" }); store.setPhase(id, "checking");
    store.recordChecks(id, { status: "passed", command, exitCode: 0, output: "Public checks passed on cloud source.",
      sourceSha256: otherTree, sourceAfterSha256: otherTree });
    const failed = receipt({ stage: "final", sourceSha256: otherTree, sourceAfterSha256: otherTree,
      result: result({ passed: 0, failures: 1, status: "failed" }), exitCode: 1, passed: false });
    store.recordPlannerCheck(id, failed);
    const stop = checkpoint(cloud, { policy, decision: "stop", state: "stopped", reason: "planner_check_failed",
      sourceSha256: tree, checkSourceSha256: null });
    const stopped = store.recordCheckpoint(id, stop);
    expect(stopped.plannerCheck).toEqual(failed);
    expect(stopped.plannerCheck?.fresh).toBe(true);
    expect(stopped.checkpoint?.checkSourceSha256).toBeNull();
    expect(stopped.checks).toMatchObject({ status: "passed", sourceSha256: otherTree, sourceAfterSha256: otherTree });
    expect(() => store.finish(id, "completed")).toThrow(/final generated checks/);
    const terminal = store.finish(id, "failed", "Final generated checks failed.");
    expect(terminal.plannerCheck).toEqual(failed);
    expect(store.replay(id)).toEqual(terminal);
  });

  it("does not let failure/cancellation masquerade as completion or lose receipts", () => {
    const { store, id } = ready();
    store.recordPlannerCheck(id, receipt({ result: null, passed: false, timedOut: true, exitCode: 124 }));
    expect(store.finish(id, "failed", "Generated checks did not complete.").plannerCheck?.passed).toBe(false);
    expect(() => store.recordPlannerCheck(id, receipt())).toThrow(/not running/);
    expect(store.replay(id)).toEqual(store.get(id));
  });

  it("rolls back generated check projection when its event cannot persist", () => {
    const { database, store, id } = ready();
    const before = store.get(id);
    database.exec("CREATE TRIGGER fail_planner_check BEFORE INSERT ON patch_run_events WHEN NEW.type = 'planner.checks.checked' BEGIN SELECT RAISE(ABORT, 'planner check storage fault'); END;");
    expect(() => store.recordPlannerCheck(id, receipt())).toThrow(/storage fault/);
    expect(store.get(id)).toEqual(before);
    expect(store.replay(id)).toEqual(before);
  });
});
