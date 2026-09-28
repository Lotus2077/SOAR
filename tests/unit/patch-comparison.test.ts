import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSoarDatabase, type SoarDatabase } from "../../src/main/database";
import { PatchRunStore } from "../../src/main/patch-runs/store";
import { patchCampaignExposure } from "../../src/main/patch-runs/comparison-schema";
import { ARMS, balancedBlocks, ComparisonManifestSchema, ComparisonStore, digest, EvaluationReceiptSchema, isSuccessfulEvaluation, runComparisonScreen, type ComparisonManifest } from "../../src/main/patch-runs/comparison";
import { comparisonReport } from "../../src/main/patch-runs/comparison-report";
import type { PatchRunCreateInput } from "../../src/shared/patch-run-contracts";

const databases: SoarDatabase[] = [], directories: string[] = [];
afterEach(async () => { for (const db of databases.splice(0)) db.close(); for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function setup() {
  const db = createSoarDatabase(); databases.push(db);
  const directory = await mkdtemp(path.join(tmpdir(), "soar-comparison-test-")); directories.push(directory);
  const oracle = path.join(directory, "private-oracle.py"); await writeFile(oracle, "private-evaluator-content");
  const reference = path.join(directory, "private-reference.patch"); await writeFile(reference, "private-reference-content");
  const image = `sha256:${"a".repeat(64)}`, revision = "b".repeat(40), oracleHash = digest("private-evaluator-content"), referenceHash = digest("private-reference-content");
  const manifest = ComparisonManifestSchema.parse({ schemaVersion: 1, screenId: "screen-test", seed: "20260908", image,
    tasks: Array.from({ length: 12 }, (_, index) => ({ taskId: `task-${index}`, source: { url: `https://github.com/public/repo${index % 3}`, revision,
      root: path.join(directory, "public-source"), files: 1, bytes: 10 }, objective: `Fix public behavior ${index}`, visibleCommand: "python -m unittest test_public",
      oracle: { path: oracle, sha256: oracleHash }, referencePatch: { path: reference, sha256: referenceHash },
      baselineReceipt: { exitCode: 1, sourceRevision: revision, oracleSha256: oracleHash, patchSha256: null, image, cleanupConfirmed: true },
      referenceReceipt: { exitCode: 0, sourceRevision: revision, oracleSha256: oracleHash, patchSha256: referenceHash, image, cleanupConfirmed: true,
        harnessVerified: true, testCount: 2, passed: 2, failures: 0, errors: 0, skipped: 0 } })) });
  const screen = new ComparisonStore(db), runs = new PatchRunStore(db);
  return { db, directory, manifest, screen, runs };
}
function runRecord(runs: PatchRunStore, manifest: ComparisonManifest, objective = "fixture") {
  return runs.create({ workspaceRoot: manifest.tasks[0]!.source.root, objective, policy: "cloud", executionMode: "live",
    baseRevision: manifest.tasks[0]!.source.revision, maxCostMicrousd: 3_000_000 });
}

describe("frozen C/D/H comparison", () => {
  it("freezes all12tasks and repeats each arm permutation exactly twice", async () => {
    const { manifest, screen, db } = await setup();
    const blocks = balancedBlocks(manifest);
    expect(blocks).toEqual(balancedBlocks(manifest));
    const counts = blocks.reduce((all, block) => { const key = block.order.join(""); all[key] = (all[key] ?? 0) + 1; return all; }, {} as Record<string, number>);
    expect(Object.values(counts)).toEqual([2, 2, 2, 2, 2, 2]);
    screen.freeze(manifest, { publicConfiguration: "fixed" });
    expect(screen.assignments(manifest.screenId)).toHaveLength(36);
    expect(() => screen.freeze(manifest, { publicConfiguration: "changed" })).toThrow(/cannot change/);
    expect(() => db.prepare("UPDATE patch_comparison_screens SET configuration_sha256 = ?").run("f".repeat(64))).toThrow(/immutable/);
    expect(() => screen.freeze({ ...manifest, tasks: manifest.tasks.slice(0, 11) }, {})).toThrow();
  });

  it("requires failing baseline and passing reference identities before freezing", async () => {
    const { manifest, screen } = await setup();
    for (const mutate of [
      (value: ComparisonManifest) => { value.tasks[0]!.baselineReceipt.exitCode = 0; },
      (value: ComparisonManifest) => { value.tasks[0]!.referenceReceipt.exitCode = 1; },
      (value: ComparisonManifest) => { value.tasks[0]!.referenceReceipt.oracleSha256 = "f".repeat(64); },
      (value: ComparisonManifest) => { for (const task of value.tasks) task.source.url = "https://github.com/public/one"; },
    ]) { const altered = structuredClone(manifest); mutate(altered); expect(() => screen.freeze(altered, {})).toThrow(); }
  });

  it("rejects zero-test success receipts even if a process exited successfully", async () => {
    const { manifest } = await setup();
    const passed = manifest.tasks[0]!.referenceReceipt;
    for (const altered of [{ ...passed, testCount: 0, passed: 0 }, { ...passed, harnessVerified: false },
      { ...passed, skipped: 1 }, { ...passed, passed: 1 }, { ...passed, failureKind: "infrastructure" }]) {
      expect(EvaluationReceiptSchema.safeParse(altered).success).toBe(false);
      expect(isSuccessfulEvaluation(altered)).toBe(false);
    }
    expect(isSuccessfulEvaluation(passed)).toBe(true);
  });

  it("the report independently rejects stored zero-test or wrong-count successes", async () => {
    const { manifest, screen, runs, db } = await setup();
    screen.freeze(manifest, {});
    const taskId = screen.blocks(manifest.screenId)[0]!.task_id;
    for (const [index, arm] of ARMS.entries()) {
      const run = runRecord(runs, manifest); screen.link(manifest.screenId, taskId, arm, run.id);
      runs.start(run.id);
      const text = "diff --git a/a b/a\n";
      runs.recordPatch(run.id, { text, sha256: digest(text), files: ["a"], truncated: false });
      runs.finish(run.id, "completed");
      const receipt = { ...manifest.tasks[0]!.referenceReceipt, patchSha256: digest(text), testCount: index, passed: index };
      screen.evaluated(manifest.screenId, taskId, arm, { status: "scored", patchSha256: receipt.patchSha256,
        oracleSha256: receipt.oracleSha256, receipt });
    }
    const report = comparisonReport(db, manifest.screenId);
    expect(ARMS.map((arm) => report.arms[arm].independentlySolved)).toEqual([0, 0, 1]);
  });

  it("reserves a whole block against shared admission and retains unknown cost after release", async () => {
    const { manifest, screen, runs, db } = await setup();
    screen.freeze(manifest, {});
    const taskId = screen.blocks(manifest.screenId)[0]!.task_id;
    expect(() => screen.reserveBlock(manifest.screenId, taskId, 8_999_999)).toThrow(/complete three-arm/);
    screen.reserveBlock(manifest.screenId, taskId, 9_000_000);
    expect(patchCampaignExposure(db).microusd).toBe(9_000_000);
    const outside = runRecord(runs, manifest); runs.start(outside.id);
    expect(() => runs.reserveRequest(outside.id, { requestId: "outside", amountMicrousd: 1, providerLabel: "test", campaignLimitMicrousd: 9_000_000 })).toThrow(/campaign/);
    for (const [index, arm] of ARMS.entries()) {
      const run = runRecord(runs, manifest); screen.link(manifest.screenId, taskId, arm, run.id); screen.claimDispatch(manifest.screenId, taskId, arm); runs.start(run.id);
      if (index === 0) {
        runs.reserveRequest(run.id, { requestId: "unknown", amountMicrousd: 500_000, providerLabel: "test", campaignLimitMicrousd: 9_000_000 });
        runs.startRequest(run.id, "unknown");
      }
      runs.finish(run.id, "interrupted");
      screen.evaluated(manifest.screenId, taskId, arm, { status: "not_scorable", patchSha256: null, oracleSha256: manifest.tasks[0]!.oracle.sha256 });
    }
    screen.completeBlock(manifest.screenId, taskId);
    expect(patchCampaignExposure(db).microusd).toBe(500_000);
    expect(runs.get(screen.runIds(manifest.screenId)[0]!).reservedMicrousd).toBe(500_000);
    expect(() => runs.reserveRequest(outside.id, { requestId: "outside", amountMicrousd: 1, providerLabel: "test", campaignLimitMicrousd: 9_000_000 })).not.toThrow();
  });

  it("scoped recovery leaves unrelated active runs untouched", async () => {
    const { manifest, runs } = await setup();
    const owned = runRecord(runs, manifest), unrelated = runRecord(runs, manifest);
    runs.start(owned.id); runs.start(unrelated.id);
    expect(runs.recoverInterrupted([owned.id]).map((run) => run.id)).toEqual([owned.id]);
    expect(runs.get(unrelated.id).status).toBe("running");
    expect(runs.listStartedRunIds([owned.id])).toEqual([owned.id]);
  });

  it("runs all36assignments through controller methods, scores only terminal patches, and never repeats on resume", async () => {
    const { db, manifest, runs, screen, directory } = await setup();
    const received: PatchRunCreateInput[] = [], started: string[] = [], evaluated: string[] = [];
    const controller = {
      async create(input: PatchRunCreateInput) {
        if (input.policy === "automatic") throw new Error("This legacy fixture requires an explicit policy.");
        received.push(input);
        return runs.create({ workspaceRoot: input.workspaceRoot, objective: input.objective, policy: input.policy, executionMode: "live",
          baseRevision: manifest.tasks[0]!.source.revision, maxCostMicrousd: 3_000_000, visibleTestCommand: input.visibleTestCommand });
      },
      start(runId: string) {
        started.push(runId); runs.start(runId);
        runs.reserveRequest(runId, { requestId: runId, amountMicrousd: 1000, providerLabel: "test", campaignLimitMicrousd: 180_000_000, phase: "cloud" });
        runs.startRequest(runId, runId); runs.finishRequest(runId, { requestId: runId, outcome: "succeeded", actualCostMicrousd: 500,
          usage: { inputTokens: 25, outputTokens: 20, reasoningTokens: 10 } });
        const text = "diff --git a/example.py b/example.py\n";
        runs.recordPatch(runId, { text, sha256: digest(text), files: ["example.py"], truncated: false });
        runs.recordChecks(runId, { command: "python -m unittest test_public", status: "passed", exitCode: 0, output: "OK" });
        return runs.finish(runId, "completed");
      },
      async waitForRun(runId: string) { return runs.get(runId); },
      cancel(runId: string) { return runs.finish(runId, "cancelled"); },
    };
    const execute = () => runComparisonScreen({ manifest, configuration: { fixed: true }, controller, runs, screen,
      campaignCeilingMicrousd: 180_000_000, outputDirectory: directory,
      async evaluate(task, patchPath) {
        const assignment = screen.assignments(manifest.screenId).find((row) => row.run_id && patchPath.includes(row.run_id))!;
        expect(runs.get(assignment.run_id!).status).toBe("completed");
        evaluated.push(assignment.run_id!);
        return { exitCode: assignment.arm === "C" ? 1 : 0, sourceRevision: task.source.revision, oracleSha256: task.oracle.sha256,
          patchSha256: runs.get(assignment.run_id!).patch!.sha256, image: manifest.image, cleanupConfirmed: true,
          harnessVerified: true, testCount: 2, passed: assignment.arm === "C" ? 1 : 2, failures: assignment.arm === "C" ? 1 : 0, errors: 0, skipped: 0 };
      } });
    await execute(); await execute();
    expect(started).toHaveLength(36); expect(evaluated).toHaveLength(36);
    expect(new Set(received.map((value) => value.policy))).toEqual(new Set(["cloud", "prepared_cloud", "hybrid"]));
    expect(JSON.stringify(received)).not.toMatch(/private-oracle|private-reference|private-evaluator/);
    expect(received.every((value) => value.episodeBudgetUsd === 3)).toBe(true);
    const report = comparisonReport(db, manifest.screenId);
    expect(report.complete).toBe(true);
    expect(report.arms.C).toMatchObject({ independentlySolved: 0, costPerIndependentSolveMicrousd: null, falseAccepts: 12, assigned: 12, spentMicrousd: 6000 });
    expect(report.arms.H).toMatchObject({ independentlySolved: 12, checkedCandidates: 12, ownerReviewed: 0, keptUsefulPatches: 0, allAssignedUsefulPatchYield: 0 });
    expect(report.paired.every((pair) => pair.HvsC === "H_win" && pair.HvsD === "tie")).toBe(true);
  });

  it("a dispatch claim lost before start becomes an interruption, not a paid retry", async () => {
    const { manifest, runs, screen, directory, db } = await setup();
    screen.freeze(manifest, {});
    const block = screen.blocks(manifest.screenId)[0]!, arm = JSON.parse(block.arm_order)[0];
    screen.reserveBlock(manifest.screenId, block.task_id, 180_000_000);
    const run = runRecord(runs, manifest); screen.link(manifest.screenId, block.task_id, arm, run.id); screen.claimDispatch(manifest.screenId, block.task_id, arm);
    let starts = 0;
    const abort = new AbortController();
    await runComparisonScreen({ manifest, configuration: {}, runs, screen, campaignCeilingMicrousd: 180_000_000, outputDirectory: directory, signal: abort.signal,
      controller: { async create() { throw new Error("must not reach next assignment"); }, start() { starts++; return run; }, async waitForRun(id) { abort.abort(); return runs.get(id); }, cancel(id) { return runs.finish(id, "cancelled"); } },
      async evaluate() { throw new Error("no patch to score"); } });
    expect(starts).toBe(0); expect(runs.get(run.id).status).toBe("cancelled");
    const report = comparisonReport(db, manifest.screenId);
    expect(report.complete).toBe(false); expect(report.rows.filter((row) => row.status === "unrun")).toHaveLength(35);
    expect(report.paired.every((pair) => pair.HvsC === "incomplete" && pair.HvsD === "incomplete")).toBe(true);
  });

  it("retains an evaluator claim lost before its receipt and never reruns that oracle", async () => {
    const { manifest, runs, screen, directory, db } = await setup();
    screen.freeze(manifest, {});
    const block = screen.blocks(manifest.screenId)[0]!, arm = JSON.parse(block.arm_order)[0];
    screen.reserveBlock(manifest.screenId, block.task_id, 180_000_000);
    const run = runRecord(runs, manifest);
    screen.link(manifest.screenId, block.task_id, arm, run.id); screen.claimDispatch(manifest.screenId, block.task_id, arm);
    runs.start(run.id); runs.finish(run.id, "failed");
    screen.claimEvaluation(manifest.screenId, block.task_id, arm);
    expect(() => screen.claimEvaluation(manifest.screenId, block.task_id, arm)).toThrow();
    expect(() => db.prepare("DELETE FROM patch_comparison_evaluation_claims").run()).toThrow(/append-only/);
    let evaluated = 0, started = 0;
    const execute = () => runComparisonScreen({ manifest, configuration: {}, runs, screen,
      campaignCeilingMicrousd: 180_000_000, outputDirectory: directory,
      controller: { async create() { throw new Error("must not create"); }, start() { started++; return run; },
        async waitForRun(id) { return runs.get(id); }, cancel(id) { return runs.finish(id, "cancelled"); } },
      async evaluate() { evaluated++; return {}; } });
    await expect(execute()).rejects.toThrow(/previous evaluator outcome is unknown/);
    await expect(execute()).rejects.toThrow(/Frozen evaluator failure/);
    expect(evaluated).toBe(0); expect(started).toBe(0);
    const row = comparisonReport(db, manifest.screenId).rows.find((item) => item.runId === run.id)!;
    expect(row).toMatchObject({ independentStatus: "error", independentlySolved: false, failureClass: "evaluation_infrastructure",
      evaluationReason: "evaluation_interrupted_outcome_unknown" });
  });

  it("stops on an explicit evaluator infrastructure receipt without counting it as a model failure", async () => {
    const { manifest, runs, screen, directory, db } = await setup();
    let evaluations = 0;
    const controller = {
      async create(input: PatchRunCreateInput) { return runRecord(runs, manifest, input.objective); },
      start(id: string) { runs.start(id); const text = "diff --git a/a b/a\n"; runs.recordPatch(id, { text, sha256: digest(text), files: ["a"], truncated: false }); return runs.finish(id, "completed"); },
      async waitForRun(id: string) { return runs.get(id); }, cancel(id: string) { return runs.finish(id, "cancelled"); },
    };
    const execute = () => runComparisonScreen({ manifest, configuration: {}, runs, screen, controller, campaignCeilingMicrousd: 180_000_000,
      outputDirectory: directory, async evaluate(task, patchPath) {
        evaluations++;
        const assignment = screen.assignments(manifest.screenId).find((row) => row.run_id && patchPath.includes(row.run_id))!;
        return { exitCode: 1, sourceRevision: task.source.revision, oracleSha256: task.oracle.sha256, patchSha256: runs.get(assignment.run_id!).patch!.sha256,
          image: manifest.image, cleanupConfirmed: true, failureKind: "infrastructure", error: "Docker unavailable" };
      } });
    await expect(execute()).rejects.toThrow(/Independent evaluation failed/);
    await expect(execute()).rejects.toThrow(/Frozen evaluator failure/);
    expect(evaluations).toBe(1);
    expect(comparisonReport(db, manifest.screenId).rows.filter((row) => row.failureClass === "evaluation_infrastructure")).toHaveLength(1);
  });
});
