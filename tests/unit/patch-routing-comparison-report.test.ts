import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSoarDatabase, type SoarDatabase } from "../../src/main/database";
import { PatchRunStore } from "../../src/main/patch-runs/store";
import { ComparisonManifestSchema, digest } from "../../src/main/patch-runs/comparison";
import { canonicalRequest } from "../../src/main/patch-runs/worker";
import { ROUTING_COMPARISON_CODE_PATHS, ROUTING_DEVELOPMENT_CODE_PATHS, RoutingDevelopmentManifestSchema, RoutingDevelopmentConfigurationSchema, routingObjective, ROUTING_POLICIES, RoutingComparisonConfigurationSchema, RoutingComparisonStore, type RoutingArm } from "../../src/main/patch-runs/routing-comparison";
import { joinRoutingIndependentReview, routingComparisonMarkdown, routingComparisonReport } from "../../src/main/patch-runs/routing-comparison-report";
import { evaluateRoutingPatch, routingArguments, routingRunnerLock, routingTaskContracts } from "../../scripts/routing-comparison";

const databases: SoarDatabase[] = [], directories: string[] = [];
afterEach(async () => { for (const db of databases.splice(0)) db.close(); for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function setup(development = false) {
  const db = createSoarDatabase(); databases.push(db);
  const directory = await mkdtemp(path.join(tmpdir(), "soar-routing-test-")); directories.push(directory);
  const oracle = path.join(directory, "private-oracle.py"), reference = path.join(directory, "private-reference.patch");
  await writeFile(oracle, "private-evaluator-content"); await writeFile(reference, "private-reference-content");
  const image = `sha256:${"a".repeat(64)}`, revision = "b".repeat(40), oracleHash = digest("private-evaluator-content"), referenceHash = digest("private-reference-content");
  const oldManifest = ComparisonManifestSchema.parse({ schemaVersion: 1, screenId: "routing-test", seed: "20260909", image, evaluatorSha256: "e".repeat(64),
    tasks: Array.from({ length: 12 }, (_, index) => ({ taskId: `task-${index}`, source: { url: `https://github.com/public/repo${index % 3}`, revision,
      root: path.join(directory, "public-source"), files: 1, bytes: 10 }, objective: `Fix public behavior ${index}`, visibleCommand: "python -m unittest test_public",
      oracle: { path: oracle, sha256: oracleHash }, referencePatch: { path: reference, sha256: referenceHash },
      baselineReceipt: { exitCode: 1, sourceRevision: revision, oracleSha256: oracleHash, patchSha256: null, image, cleanupConfirmed: true,
        sourceTreeSha256: "c".repeat(64), harnessVerified: true, testCount: 2, passed: 1, failures: 1, errors: 0, skipped: 0, failureKind: "candidate" },
      referenceReceipt: { exitCode: 0, sourceRevision: revision, oracleSha256: oracleHash, patchSha256: referenceHash, image, cleanupConfirmed: true,
        sourceTreeSha256: "c".repeat(64), harnessVerified: true, testCount: 2, passed: 2, failures: 0, errors: 0, skipped: 0 } })) });
  const manifest = development ? RoutingDevelopmentManifestSchema.parse({ ...oldManifest, schemaVersion: 2,
    kind: "routing-public-checks-development-v2", studyKind: "development", tasks: oldManifest.tasks.slice(0, 6) }) : oldManifest;
  const taskContracts = manifest.tasks.map((task) => ({ taskId: task.taskId, allowedFiles: ["example.py"], sourceTreeSha256: "c".repeat(64), expectedTests: 2 }));
  const cloud = { id: "openai", protocol: "openai", model: "gpt-5.6-sol", destinationSha256: digest("https://api.openai.com/v1/chat/completions"),
    inputUsdPerMillion: 4, outputUsdPerMillion: 20, allowInsecureHttp: false, maxOutputTokens: 8192, maxInputBytes: 256000 };
  const cloudLimits = { stepLimit: 40, wallTimeSeconds: 600, commandTimeoutSeconds: 30, requestTimeoutSeconds: 120, visibleCheckTimeoutSeconds: 60, maxOutputTokens: 8192, maxInputBytes: 256000 };
  const nativeLimits = { ...cloudLimits, localStepLimit: 24, finishingReserve: 2, visibleCheckTimeoutSeconds: 60, localCoding: { maxOutputTokens: 8192, maxInputBytes: 256000 } };
  const baseConfiguration = { schemaVersion: 1, kind: "routing-comparison-v1", mode: "live",
    manifestSha256: digest(canonicalRequest(manifest)), image, policyByArm: ROUTING_POLICIES, cloud,
    local: { ...cloud, id: "local", model: "owned-local-model", destinationSha256: "d".repeat(64), inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
    episodeMicrousd: 3_000_000, campaignMicrousd: 150_000_000, blockMicrousd: 9_000_000,
    limitsByArm: { C: cloudLimits, L: nativeLimits, E: nativeLimits, P: nativeLimits },
    cloudControls: { reasoningEffort: "medium", serviceTier: "default", promptCacheMode: "explicit_no_breakpoints" },
    localControls: { enableThinking: false, protocol: "native_coding", parallelToolCalls: false }, concurrency: 1,
    taskContracts, taskContractsSha256: digest(canonicalRequest(taskContracts)),
    codeHashes: Object.fromEntries(ROUTING_COMPARISON_CODE_PATHS.map((file) => [file, "e".repeat(64)])),
    localEconomics: { devicePurchaseUsd: 3500, perTokenApiFeeUsd: 0, ownership: "user_owned", electricityAndUtilization: "unavailable" },
  };
  const configuration = development ? RoutingDevelopmentConfigurationSchema.parse({ ...baseConfiguration, schemaVersion: 2,
    kind: "routing-public-checks-development-v2", studyKind: "development", policyByArm: { C: "prepared_cloud", P: "cloud_plan_local" },
    limitsByArm: { C: cloudLimits, P: { ...nativeLimits, plannerMode: "plan_and_checks", localCoding: { ...nativeLimits.localCoding,
      thinking: "disabled", checkSchedule: "host_repair_window" } } },
    codeHashes: Object.fromEntries(ROUTING_DEVELOPMENT_CODE_PATHS.map((file) => [file, "e".repeat(64)])) }) : RoutingComparisonConfigurationSchema.parse(baseConfiguration);
  const screen = new RoutingComparisonStore(db), runs = new PatchRunStore(db);
  return { db, directory, manifest, configuration, screen, runs };
}

function begin(context: Awaited<ReturnType<typeof setup>>, arm: RoutingArm) {
  const { screen, manifest, runs } = context, block = screen.blocks(manifest.screenId)[0]!;
  const task = manifest.tasks.find((row) => row.taskId === block.task_id)!;
  screen.reserveBlock(manifest.screenId, task.taskId); screen.claimDispatch(manifest.screenId, task.taskId, arm);
  const run = runs.create({ workspaceRoot: task.source.root, objective: context.configuration.schemaVersion === 2 ? routingObjective(task, context.configuration.taskContracts.find((item) => item.taskId === task.taskId)!) : task.objective, policy: ROUTING_POLICIES[arm], executionMode: "live",
    baseRevision: task.source.revision, maxCostMicrousd: 3_000_000, visibleTestCommand: task.visibleCommand });
  screen.link(manifest.screenId, task.taskId, arm, run.id); runs.start(run.id);
  return { run, task };
}
function submitted(context: Awaited<ReturnType<typeof setup>>, arm: RoutingArm) {
  const { run, task } = begin(context, arm), text = "diff --git a/example.py b/example.py\n";
  context.runs.recordPatch(run.id, { kind: "submitted", text, sha256: digest(text), files: ["example.py"], truncated: false });
  context.runs.recordChecks(run.id, { status: "passed", command: task.visibleCommand, exitCode: 0, output: "OK" });
  context.runs.recordCleanup(run.id, true); context.runs.finish(run.id, "completed"); context.screen.claimEvaluation(context.manifest.screenId, task.taskId, arm);
  return { run, task, receipt: { ...task.referenceReceipt, patchSha256: digest(text) } };
}

describe("routing report and trusted CLI", () => {
  it("keeps48assignments and unavailable quality/cost metrics before dispatch", async () => {
    const context = await setup(); context.screen.freeze(context.manifest, context.configuration);
    const report = routingComparisonReport(context.db, context.manifest.screenId);
    expect(report.assigned).toBe(48); expect(report.complete).toBe(false); expect(report.expectedAcceptanceMethodsPerArm).toBe(24);
    for (const arm of Object.values(report.arms)) {
      expect(arm).toMatchObject({ assigned: 12, unrun: 12, unfinished: 12, evaluated: 0, independentlySolved: 0,
        costPerIndependentSolveMicrousd: null, costPerAcceptableMicrousd: null, acceptable: null, blindReviewed: 0 });
    }
    expect(report.economics).toMatchObject({ devicePurchaseUsd: 3500, measuredPayback: null, measuredAllInSavingsUsd: null });
    const markdown = routingComparisonMarkdown(report);
    expect(markdown).toContain("prepared cloud"); expect(markdown).toContain("unavailable until patch-bound blind review");
    expect(JSON.stringify(report)).not.toContain(context.directory); expect(JSON.stringify(report)).not.toContain("private-evaluator-content");
  });
  it("separates automatic solves, recovered work and zero-fee unknowns without hiding their denominator", async () => {
    const context = await setup(); context.screen.freeze(context.manifest, context.configuration);
    const c = begin(context, "C"); context.runs.setPhase(c.run.id, "cloud_solver");
    context.runs.reserveRequest(c.run.id, { requestId: "paid", amountMicrousd: 1000, providerLabel: "OpenAI", phase: "cloud", campaignLimitMicrousd: 150_000_000 });
    context.runs.startRequest(c.run.id, "paid"); context.runs.finishRequest(c.run.id, { requestId: "paid", outcome: "succeeded", actualCostMicrousd: 500, usage: { inputTokens: 25, outputTokens: 20 } });
    const text = "diff --git a/example.py b/example.py\n", patchSha256 = digest(text);
    context.runs.recordPatch(c.run.id, { text, sha256: patchSha256, files: ["example.py"], truncated: false });
    context.runs.recordChecks(c.run.id, { status: "passed", command: c.task.visibleCommand, exitCode: 0, output: "OK" });
    context.runs.recordCleanup(c.run.id, true); context.runs.finish(c.run.id, "completed"); context.screen.claimEvaluation(context.manifest.screenId, c.task.taskId, "C");
    context.screen.evaluated(context.manifest.screenId, c.task.taskId, "C", { status: "scored", patchSha256, oracleSha256: c.task.oracle.sha256, receipt: { ...c.task.referenceReceipt, patchSha256 }, scope: { valid: true, reason: "within_scope", changedPaths: ["example.py"] } });
    const local = begin(context, "L");
    context.runs.reserveRequest(local.run.id, { requestId: "zero-unknown", amountMicrousd: 0, providerLabel: "local · model", phase: "local", campaignLimitMicrousd: 150_000_000 });
    context.runs.startRequest(local.run.id, "zero-unknown"); context.runs.finishRequest(local.run.id, { requestId: "zero-unknown", outcome: "unknown" });
    context.runs.recordPatch(local.run.id, { kind: "recovered", text, sha256: patchSha256, files: ["example.py"], truncated: false });
    context.runs.recordCleanup(local.run.id, true); context.runs.finish(local.run.id, "failed"); context.screen.evaluated(context.manifest.screenId, local.task.taskId, "L", { status: "error", patchSha256, oracleSha256: local.task.oracle.sha256, reason: "provider_outcome_unknown" });
    const report = routingComparisonReport(context.db, context.manifest.screenId);
    expect(report.arms.C).toMatchObject({ assigned: 12, evaluated: 1, independentlySolved: 1, checkedCandidates: 1, spentMicrousd: 500,
      costPerIndependentSolveMicrousd: 500, allAssignedIndependentSolveRate: 1 / 12, acceptable: null });
    expect(report.arms.C!.timedRequests.cloud).toBe(1);
    expect(report.arms.L).toMatchObject({ assigned: 12, evaluated: 0, unknownRequests: 1, unresolvedRequests: 1, unresolvedMicrousd: 0,
      failures: 1, unfinished: 12, recoveredArtifacts: 1, independentlySolved: 0, costPerIndependentSolveMicrousd: null });
  });
  it("independently rejects false successful receipts with wrong patch or zero/wrong counts", async () => {
    const context = await setup(); context.screen.freeze(context.manifest, context.configuration);
    for (const [index, arm] of (["C", "L", "E", "P"] as const).entries()) {
      const { task, receipt } = submitted(context, arm);
      const changed = index === 0 ? { ...receipt, patchSha256: "f".repeat(64) } : index === 1 ? { ...receipt, testCount: 0, passed: 0 } : index === 2 ? { ...receipt, testCount: 3, passed: 3 } : { ...receipt, exitCode: 1, passed: 0, testCount: 0, harnessVerified: false, failureKind: "candidate" as const };
      context.screen.evaluated(context.manifest.screenId, task.taskId, arm, { status: "scored", patchSha256: receipt.patchSha256, oracleSha256: task.oracle.sha256, receipt: changed, scope: { valid: true, reason: "within_scope", changedPaths: ["example.py"] } });
    }
    const report = routingComparisonReport(context.db, context.manifest.screenId);
    expect(Object.values(report.arms).map((row) => row.independentlySolved)).toEqual([0, 0, 0, 0]);
    expect(report.arms.P).toMatchObject({ evaluated: 1, evaluationErrors: 0, failures: 1 });
  });
  it("binds task details and refuses duplicate arguments or unsupported combinations", async () => {
    const { manifest } = await setup();
    const details = { schemaVersion: 1, screenId: manifest.screenId, tasks: manifest.tasks.map((task) => ({ taskId: task.taskId, source: task.source,
      oracleSha256: task.oracle.sha256, referencePatchSha256: task.referencePatch.sha256, visibleCommandSha256: digest(task.visibleCommand),
      allowedFiles: ["example.py"], expectedTests: 2, sourceTreeSha256: task.referenceReceipt.sourceTreeSha256 })) };
    expect(routingTaskContracts(details, manifest)).toHaveLength(12);
    expect(() => routingTaskContracts({ ...details, screenId: "other" }, manifest)).toThrow();
    details.tasks[0]!.allowedFiles = ["../escape.py"]; expect(() => routingTaskContracts(details, manifest)).toThrow();
    expect(() => routingArguments(["freeze", "--database", "x", "--output", "y", "--manifest", "z"])).toThrow();
    expect(() => routingArguments(["report", "--database", "x", "--output", "y", "--screen", "s", "--screen", "s"])).toThrow();
    expect(routingArguments(["report", "--database", "x", "--output", "y", "--screen", "s"]).screenId).toBe("s");
  });
  it("does not count a passing oracle without matching file scope and immutable cleanup", async () => {
    const context = await setup(); context.screen.freeze(context.manifest, context.configuration);
    const first = submitted(context, "C");
    context.screen.evaluated(context.manifest.screenId, first.task.taskId, "C", { status: "scored", patchSha256: first.receipt.patchSha256,
      oracleSha256: first.task.oracle.sha256, receipt: first.receipt, scope: { valid: true, reason: "within_scope", changedPaths: ["forbidden.py"] } });
    const second = begin(context, "L"), text = "diff --git a/example.py b/example.py\n", patchSha256 = digest(text);
    context.runs.recordPatch(second.run.id, { kind: "submitted", text, sha256: patchSha256, files: ["example.py"], truncated: false });
    context.runs.recordChecks(second.run.id, { status: "passed", command: second.task.visibleCommand, exitCode: 0, output: "OK" });
    context.runs.recordCleanup(second.run.id, false); context.runs.finish(second.run.id, "failed");
    // Independent report guard against an invalid persisted receipt, even if an
    // earlier writer bypassed the current runner/store evaluation admission.
    const invalid = { status: "scored", patchSha256, oracleSha256: second.task.oracle.sha256, receipt: { ...second.task.referenceReceipt, patchSha256 },
      scope: { valid: true, reason: "within_scope", changedPaths: ["example.py"] } };
    context.db.prepare("UPDATE patch_routing_assignments SET evaluation_json = ? WHERE run_id = ?").run(JSON.stringify(invalid), second.run.id);
    const report = routingComparisonReport(context.db, context.manifest.screenId);
    expect(report.arms.C).toMatchObject({ independentlySolved: 0, evaluationErrors: 1 });
    expect(report.arms.L).toMatchObject({ independentlySolved: 0, checkedCandidates: 0, cleanupFailures: 1 });
  });
  it("never takes over an existing runner lock or removes a replaced lock", async () => {
    const { directory } = await setup(), database = path.join(directory, "stage.sqlite"), file = `${database}.routing-comparison.lock`;
    const release = await routingRunnerLock(database); await expect(routingRunnerLock(database)).rejects.toThrow(/lock exists/);
    await writeFile(file, "another-owner"); await expect(release()).rejects.toThrow(/identity changed/);
    expect(await readFile(file, "utf8")).toBe("another-owner");
  });
  it("gives a stopped trusted evaluator time to clean up and retains its diagnostic", async () => {
    const { directory } = await setup(), helper = path.join(directory, "trusted-cleanup-fixture.py"), marker = path.join(directory, "cleanup.txt");
    const source = "import signal,time,pathlib,sys\ndef stop(*args):\n pathlib.Path(sys.argv[1]).write_text('cleaned')\n raise SystemExit(1)\nsignal.signal(signal.SIGTERM,stop)\nprint('trusted fixture started',flush=True)\ntime.sleep(10)\n";
    await writeFile(helper, source);
    const logPath = path.join(directory, "evaluation.log");
    await expect(evaluateRoutingPatch({ python: "python3", helper, helperSha256: digest(source), args: [marker], logPath, timeoutMs: 250, cleanupGraceMs: 2000 })).rejects.toThrow(/no retry/);
    expect(await readFile(marker, "utf8")).toBe("cleaned"); expect(await readFile(logPath, "utf8")).toContain("trusted fixture started");
    await expect(evaluateRoutingPatch({ python: "python3", helper, helperSha256: "f".repeat(64), args: [], logPath })).rejects.toThrow(/changed/);
  });
});

// Persist ordinary store events/ledger receipts without invoking a controller,
// evaluator, model, or candidate source. These fixtures test reporting only.
async function developmentCohort(options: { diagnosticTask?: number; partial?: boolean } = {}) {
  const context = await setup(true), { screen, runs, manifest, configuration, db } = context;
  screen.freeze(manifest, configuration);
  for (const [index, block] of screen.blocks(manifest.screenId).entries()) {
    if (options.partial && index === 1) break;
    const task = manifest.tasks.find((item) => item.taskId === block.task_id)!;
    screen.reserveBlock(manifest.screenId, task.taskId);
    for (const arm of ["C", "P"] as const) {
      screen.claimDispatch(manifest.screenId, task.taskId, arm);
      const contract = configuration.taskContracts.find((item) => item.taskId === task.taskId)!;
      const run = runs.create({ workspaceRoot: task.source.root, objective: routingObjective(task, contract), policy: ROUTING_POLICIES[arm],
        executionMode: "live", baseRevision: task.source.revision, maxCostMicrousd: 3_000_000, visibleTestCommand: task.visibleCommand });
      screen.link(manifest.screenId, task.taskId, arm, run.id); runs.start(run.id);
      db.prepare("UPDATE patch_runs SET started_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), run.id);
      const phase = arm === "C" ? "cloud" : "planner", fee = arm === "C" ? 1000 : 500;
      runs.setPhase(run.id, arm === "C" ? "cloud_solver" : "cloud_planner");
      runs.reserveRequest(run.id, { requestId: `${run.id}-paid`, amountMicrousd: 2000, providerLabel: "fixture", phase, campaignLimitMicrousd: 150_000_000 });
      runs.startRequest(run.id, `${run.id}-paid`);
      runs.finishRequest(run.id, { requestId: `${run.id}-paid`, outcome: "succeeded", actualCostMicrousd: fee, usage: { inputTokens: 1, outputTokens: 1 } });
      const checkSource = "class PublicTests: pass\n", artifactSha256 = digest(checkSource);
      if (arm === "P") runs.recordPlan(run.id, { summary: "Public contract plan", sha256: digest("Public contract plan"), checks: {
        schemaVersion: 1, kind: "model_generated_python_unittest", source: checkSource, sha256: artifactSha256, expectedTests: 1, testIds: ["PublicTests.test_behavior"] } });
      const text = `diff --git a/example.py b/example.py\n--- a/example.py\n+++ b/example.py\n@@ -1 +1 @@\n-old\n+${arm}${index}\n`, patchSha256 = digest(text), source = digest(`source-${arm}-${index}`);
      runs.recordPatch(run.id, { kind: "submitted", text, sha256: patchSha256, files: ["example.py"], truncated: false });
      runs.setPhase(run.id, "checking");
      runs.recordChecks(run.id, { status: "passed", command: task.visibleCommand, exitCode: 0, output: "OK", ...(arm === "P" ? { sourceSha256: source, sourceAfterSha256: source } : {}) });
      const failed = arm === "P" && index === options.diagnosticTask;
      if (arm === "P") runs.recordPlannerCheck(run.id, { stage: "final", artifactSha256, sourceSha256: source, sourceAfterSha256: source,
        exitCode: failed ? 1 : 0, output: "", outputTruncated: false, elapsedMs: 2, timedOut: false, passed: !failed, fresh: true,
        result: { schemaVersion: 1, kind: "model_generated_python_unittest", sourceSha256: artifactSha256, expectedTests: 1, discoveredTests: 1,
          testsRun: 1, passed: failed ? 0 : 1, failures: failed ? 1 : 0, errors: 0, skipped: 0, expectedFailures: 0,
          unexpectedSuccesses: 0, completed: true, status: failed ? "failed" : "passed", detail: "fixture" } });
      runs.recordCleanup(run.id, true); runs.finish(run.id, failed ? "failed" : "completed", failed ? "Worker stopped: routing_planner_final_checks_failed" : undefined);
      screen.claimEvaluation(manifest.screenId, task.taskId, arm);
      screen.evaluated(manifest.screenId, task.taskId, arm, { status: "scored", patchSha256, oracleSha256: task.oracle.sha256,
        receipt: { ...task.referenceReceipt, patchSha256 }, scope: { valid: true, reason: "within_scope", changedPaths: ["example.py"] },
        ...(failed ? { kind: "diagnostic", reason: "failed_runtime_submission" } : {}) });
    }
    screen.completeBlock(manifest.screenId, task.taskId);
  }
  return { ...context, report: routingComparisonReport(db, manifest.screenId) };
}
function independentReceipt(report: ReturnType<typeof routingComparisonReport>) {
  return { schemaVersion: 1 as const, kind: "routing-independent-review-v2" as const,
    screenId: report.screenId, configurationSha256: report.configurationSha256, manifestSha256: report.manifestSha256,
    reviews: report.rows.map((row) => ({ taskId: row.taskId, arm: row.arm as "C" | "P", runId: row.runId, patchSha256: row.patchSha256,
      status: "accepted" as "accepted" | "rejected" | "incomplete", evidenceSha256: digest(`review-${row.runId}`) as string | null })),
    comparisons: report.configuration.taskContracts.map((task) => ({ taskId: task.taskId,
      ...Object.fromEntries((["C", "P"] as const).map((arm) => { const row = report.rows.find((item) => item.taskId === task.taskId && item.arm === arm)!;
        return [arm, { runId: row.runId, patchSha256: row.patchSha256 }]; })) as { C: { runId: string | null; patchSha256: string | null }; P: { runId: string | null; patchSha256: string | null } },
      additionalMaterialRegression: false as boolean | null, evidenceSha256: digest(`pair-${task.taskId}`) as string | null })) };
}

describe("V2 complete-cohort reporting and independent review", () => {
  it("retains six frozen tasks per C/P arm before dispatch and never auto-advances", async () => {
    const context = await setup(true); context.screen.freeze(context.manifest, context.configuration);
    const report = routingComparisonReport(context.db, context.manifest.screenId);
    expect(report).toMatchObject({ schemaVersion: "routing-comparison-report-v2", studyKind: "development", assigned: 12,
      assignedTasksPerArm: 6, complete: false, totalBlocks: 6, expectedAcceptanceMethodsPerArm: 12,
      review: { status: "pending" }, advancement: { eligible: false, status: "pending_review" } });
    expect(Object.keys(report.arms)).toEqual(["C", "P"]);
    for (const arm of Object.values(report.arms)) expect(arm).toMatchObject({ assigned: 6, unrun: 6, acceptable: null,
      elapsedSamples: 0, latencyComplete: false, medianElapsedMs: null, costPerAcceptableMicrousd: null });
    expect(routingComparisonMarkdown(report)).toContain("C/P development comparison");
    expect(JSON.stringify(report)).not.toContain(context.directory);
    // A damaged assignment table must not silently produce a smaller denominator.
    expect(() => context.db.prepare("DELETE FROM patch_routing_assignments WHERE screen_id = ? AND task_id = ? AND arm = 'P'")
      .run(context.manifest.screenId, context.manifest.tasks[0]!.taskId)).toThrow(/cannot be deleted/);
    const assignments = context.screen.assignments(context.manifest.screenId);
    const incompleteReader = vi.spyOn(RoutingComparisonStore.prototype, "assignments").mockReturnValue(assignments.slice(1));
    try { expect(() => routingComparisonReport(context.db, context.manifest.screenId)).toThrow(/denominator/); }
    finally { incompleteReader.mockRestore(); }
  });
  it("retains paid and zero-fee unknowns from the actual ledger even when the snapshot accounting drifts", async () => {
    const context = await setup(true); context.screen.freeze(context.manifest, context.configuration);
    for (const arm of ["C", "P"] as const) {
      const { run, task } = begin(context, arm), { runs, db } = context;
      runs.reserveRequest(run.id, { requestId: `${arm}-paid`, amountMicrousd: 1000, providerLabel: "fixture", phase: "cloud", campaignLimitMicrousd: 150_000_000 });
      runs.startRequest(run.id, `${arm}-paid`); runs.finishRequest(run.id, { requestId: `${arm}-paid`, outcome: "succeeded", actualCostMicrousd: 500, usage: { inputTokens: 1, outputTokens: 1 } });
      runs.reserveRequest(run.id, { requestId: `${arm}-unknown`, amountMicrousd: arm === "C" ? 77 : 0, providerLabel: "fixture", phase: arm === "C" ? "cloud" : "local", campaignLimitMicrousd: 150_000_000 });
      runs.startRequest(run.id, `${arm}-unknown`); runs.finishRequest(run.id, { requestId: `${arm}-unknown`, outcome: "unknown" });
      runs.recordCleanup(run.id, true); runs.finish(run.id, "failed", "provider_outcome_unknown");
      context.screen.evaluated(context.manifest.screenId, task.taskId, arm, { status: "error", patchSha256: null, oracleSha256: task.oracle.sha256, reason: "provider_outcome_unknown" });
      const changed = runs.get(run.id); changed.spentMicrousd = 0;
      db.prepare("UPDATE patch_runs SET snapshot_json = ? WHERE id = ?").run(JSON.stringify(changed), run.id);
    }
    const report = routingComparisonReport(context.db, context.manifest.screenId);
    expect(report.arms.C).toMatchObject({ assigned: 6, spentMicrousd: 500, unresolvedMicrousd: 77, maximumExposureMicrousd: 577, unknownRequests: 1 });
    expect(report.arms.P).toMatchObject({ assigned: 6, spentMicrousd: 500, unresolvedMicrousd: 0, unknownRequests: 1, unresolvedRequests: 1 });
    expect(report.rows.filter((row) => row.runId).every((row) => row.runtimeInfrastructureFailure)).toBe(true);
  });
  it("requires all six terminal latency samples rather than a partial successful subset", async () => {
    const { report } = await developmentCohort({ partial: true });
    expect(report.complete).toBe(false);
    for (const arm of Object.values(report.arms)) expect(arm).toMatchObject({ assigned: 6, terminal: 1, elapsedSamples: 1, medianElapsedMs: null, latencyComplete: false });
    expect(report.advancement?.eligible).toBe(false);
  });
  it("binds generated verdict to the exact final patch/source and rejects stale persisted evidence", async () => {
    const context = await developmentCohort(), P = context.report.rows.find((row) => row.arm === "P")!;
    expect(P).toMatchObject({ checkedCandidate: true, generatedCheck: { status: "passed", patchSha256: P.patchSha256 }, runtimeInfrastructureFailure: false });
    const original = context.runs.get(P.runId!);
    for (const mutation of [
      (run: typeof original) => { run.plannerCheck!.sourceSha256 = "a".repeat(64); run.plannerCheck!.sourceAfterSha256 = "a".repeat(64); },
      (run: typeof original) => { const text = run.patch!.text + "\n"; run.patch!.text = text; run.patch!.sha256 = digest(text); },
      (run: typeof original) => { run.plannerCheck!.stage = "checkpoint"; },
    ]) {
      const changed = structuredClone(original); mutation(changed);
      context.db.prepare("UPDATE patch_runs SET snapshot_json = ? WHERE id = ?").run(JSON.stringify(changed), P.runId);
      const row = routingComparisonReport(context.db, context.manifest.screenId).rows.find((item) => item.runId === P.runId)!;
      expect(row.generatedCheck).toBeNull(); expect(row.checkedCandidate).toBe(false); expect(row.runtimeInfrastructureFailure).toBe(true);
    }
  });
  it("keeps failed submitted diagnostics in fees and latency but never in independent solves or acceptance", async () => {
    const context = await developmentCohort({ diagnosticTask: 0 }), { report } = context;
    const failed = report.rows.find((row) => row.diagnosticEvaluation)!;
    expect(failed).toMatchObject({ terminal: true, evaluated: true, independentlySolved: false, checkedCandidate: false,
      generatedCheck: { status: "failed" }, runtimeInfrastructureFailure: false, spentMicrousd: 500 });
    const receipt = independentReceipt(report);
    // Equal resolved acceptance counts alone do not substitute for the six paired
    // judgments. The failed diagnostic remains ineligible even if reviewed accepted.
    receipt.reviews.find((row) => row.arm === "C")!.status = "rejected";
    const joined = joinRoutingIndependentReview(report, receipt);
    expect(joined.rows.find((row) => row.runId === failed.runId)!.acceptable).toBe(false);
    expect(joined.arms.P).toMatchObject({ acceptable: 5, independentlySolved: 5, terminal: 6, elapsedSamples: 6, spentMicrousd: 3000,
      costPerAcceptableMicrousd: 600 });
    expect(joined.advancement?.eligible).toBe(true);
    for (const error of ["routing_planner_final_checks_failed", "Worker stopped: routing_planner_final_checks_failed_extra", "Worker stopped: provider_outcome_unknown"]) {
      const changed = context.runs.get(failed.runId!); changed.error = error;
      context.db.prepare("UPDATE patch_runs SET snapshot_json = ? WHERE id = ?").run(JSON.stringify(changed), failed.runId);
      const row = routingComparisonReport(context.db, context.manifest.screenId).rows.find(item => item.runId === failed.runId)!;
      expect(row.runtimeInfrastructureFailure).toBe(true);
    }
  });
  it("requires independent evidence and rejects every cross-binding, duplicate and unknown field", async () => {
    const { report } = await developmentCohort(), receipt = independentReceipt(report);
    for (const mutate of [
      (value: typeof receipt) => { value.screenId = "foreign"; },
      (value: typeof receipt) => { value.configurationSha256 = "a".repeat(64); },
      (value: typeof receipt) => { value.manifestSha256 = "a".repeat(64); },
      (value: typeof receipt) => { value.reviews[0]!.taskId = "foreign"; },
      (value: typeof receipt) => { value.reviews[0]!.arm = "P"; },
      (value: typeof receipt) => { value.reviews[0]!.runId = receipt.reviews[2]!.runId; },
      (value: typeof receipt) => { value.reviews[0]!.patchSha256 = "a".repeat(64); },
      (value: typeof receipt) => { value.reviews[0]!.evidenceSha256 = null; },
      (value: typeof receipt) => { value.reviews[1] = value.reviews[0]!; },
      (value: typeof receipt) => { value.comparisons[0]!.P.patchSha256 = "a".repeat(64); },
      (value: typeof receipt) => { value.comparisons[0]!.evidenceSha256 = null; },
      (value: typeof receipt) => { value.comparisons[1] = value.comparisons[0]!; },
    ]) { const changed = structuredClone(receipt); mutate(changed); expect(() => joinRoutingIndependentReview(report, changed)).toThrow(); }
    expect(() => joinRoutingIndependentReview(report, { ...receipt, acceptable: 12 })).toThrow();
    const v1 = await setup(); v1.screen.freeze(v1.manifest, v1.configuration);
    expect(() => joinRoutingIndependentReview(routingComparisonReport(v1.db, v1.manifest.screenId), receipt)).toThrow(/V2/);
    expect(joinRoutingIndependentReview(report, receipt).advancement).toMatchObject({ eligible: true, additionalMaterialRegression: false });
    expect(report.review?.status).toBe("pending"); expect(report.arms.C!.acceptable).toBeNull();
  });
  it("keeps missing reviews and shared semantic-defect comparisons explicitly unresolved", async () => {
    const { report } = await developmentCohort(), receipt = independentReceipt(report);
    receipt.comparisons = [];
    const noPairs = joinRoutingIndependentReview(report, receipt);
    expect(noPairs.review).toMatchObject({ status: "incomplete", completedReviews: 12, completedComparisons: 0 });
    expect(noPairs.advancement).toMatchObject({ eligible: false, additionalMaterialRegression: null });
    receipt.reviews = [];
    expect(joinRoutingIndependentReview(report, receipt).arms.P).toMatchObject({ acceptable: 0, costPerAcceptableMicrousd: null });
    const extraRegression = independentReceipt(report); extraRegression.comparisons[0]!.additionalMaterialRegression = true;
    expect(joinRoutingIndependentReview(report, extraRegression).advancement?.reasons).toContain("additional_p_material_regression");
  });
  it("enforces exact cost, quality and full-cohort latency thresholds independently of owner decisions", async () => {
    const { report } = await developmentCohort(), receipt = independentReceipt(report);
    const boundary = structuredClone(report);
    for (const row of boundary.rows) { row.spentMicrousd = row.arm === "C" ? 1000 : 800; row.elapsedMs = row.arm === "C" ? 1000 : 1250; row.ownerDecision = "keep"; }
    boundary.arms.C!.maximumExposureMicrousd = 6000; boundary.arms.P!.maximumExposureMicrousd = 4800;
    boundary.arms.C!.medianElapsedMs = 1000; boundary.arms.P!.medianElapsedMs = 1250;
    expect(joinRoutingIndependentReview(boundary, receipt).advancement?.eligible).toBe(true);
    boundary.rows.find((row) => row.arm === "P")!.spentMicrousd++;
    boundary.arms.P!.maximumExposureMicrousd++;
    expect(joinRoutingIndependentReview(boundary, receipt).advancement?.reasons).toContain("api_saving_below_twenty_percent");
    for (const row of boundary.rows.filter((row) => row.arm === "P")) row.elapsedMs = 1251;
    expect(joinRoutingIndependentReview(boundary, receipt).advancement?.reasons).toContain("median_latency_above_twenty_five_percent");
    const fewer = independentReceipt(report); fewer.reviews.find((row) => row.arm === "P")!.status = "rejected";
    expect(joinRoutingIndependentReview(report, fewer).advancement?.reasons).toContain("fewer_p_acceptable_patches");
    for (const row of fewer.reviews) row.status = "rejected";
    const rejected = joinRoutingIndependentReview(report, fewer);
    expect(rejected.arms.C!.costPerAcceptableMicrousd).toBeNull(); expect(rejected.advancement?.reasons).toContain("acceptable_cost_denominator_unavailable");
  });
  it("blocks every unknown, missing, cleanup, infrastructure and early-stop gap while retaining all fees", async () => {
    const { report } = await developmentCohort(), receipt = independentReceipt(report);
    for (const [change, reason] of [
      [(value: typeof report) => { value.rows[0]!.unknownRequests = 1; value.rows[0]!.unresolvedRequests = 1; }, "unresolved_provider_outcomes"],
      [(value: typeof report) => { value.rows[0]!.cleanupConfirmed = false; }, "cleanup_unconfirmed"],
      [(value: typeof report) => { value.rows[0]!.evaluationError = true; }, "infrastructure_or_missing_evaluation"],
      [(value: typeof report) => { value.rows[0]!.runtimeInfrastructureFailure = true; }, "infrastructure_or_missing_evaluation"],
      [(value: typeof report) => { value.rows[0]!.evaluated = false; }, "infrastructure_or_missing_evaluation"],
      [(value: typeof report) => { value.complete = false; }, "incomplete_assignments_or_early_stop"],
      [(value: typeof report) => { value.rows.find((row) => row.arm === "P")!.elapsedMs = null; }, "complete_terminal_latency_unavailable"],
    ] as const) { const changed = structuredClone(report); change(changed); expect(joinRoutingIndependentReview(changed, receipt).advancement?.reasons).toContain(reason); }
    const held = structuredClone(report); held.rows.find((row) => row.arm === "P")!.unresolvedMicrousd = 3000;
    const joined = joinRoutingIndependentReview(held, receipt);
    expect(joined.arms.P!.costPerAcceptableMicrousd).toBe(1000); expect(joined.advancement?.eligible).toBe(false);
  });
});
