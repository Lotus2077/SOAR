import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createSoarDatabase, listAppliedDatabaseMigrations, type SoarDatabase } from "../../src/main/database";
import { PatchRunStore } from "../../src/main/patch-runs/store";
import { patchCampaignExposure } from "../../src/main/patch-runs/comparison-schema";
import { ComparisonManifestSchema, ComparisonStore, digest, type ComparisonManifest } from "../../src/main/patch-runs/comparison";
import { canonicalRequest } from "../../src/main/patch-runs/worker";
import { balancedRoutingBlocks, inspectRoutingPatchScope, routingObjective, ROUTING_ARMS, ROUTING_COMPARISON_CODE_PATHS, ROUTING_DEVELOPMENT_CODE_PATHS, ROUTING_POLICIES, RoutingComparisonConfigurationSchema,
  RoutingComparisonStore, runRoutingComparisonScreen, routingArms, routingRuntimeConfigForArm, routingComparisonConfiguration,
  RoutingDevelopmentManifestSchema, RoutingDevelopmentConfigurationSchema, RoutingManifestSchema, RoutingConfigurationSchema,
  RoutingHistoricalAdmissionSchema, classifyRoutingRuntimeFailure,
  type RoutingArm, type RoutingComparisonConfiguration, type RoutingConfiguration, type RoutingManifest } from "../../src/main/patch-runs/routing-comparison";
import { isPatchRunTerminal, type PatchRunCreateInput, type PatchRunRequestPhase, type PatchRunSnapshot } from "../../src/shared/patch-run-contracts";
import { patchPolicyLimits, type PatchRuntimeConfig } from "../../src/main/patch-runs/config";
import { checkpoint, nativeRuntime } from "../helpers/patch-native-fixture";

const databases: SoarDatabase[] = [], directories: string[] = [];
const PATCH = "diff --git a/example.py b/example.py\n--- a/example.py\n+++ b/example.py\n@@ -1 +1 @@\n-old\n+new\n";
afterEach(async () => { for (const db of databases.splice(0)) db.close(); for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function setup() {
  const db = createSoarDatabase(); databases.push(db);
  const directory = await mkdtemp(path.join(tmpdir(), "soar-routing-test-")); directories.push(directory);
  const oracle = path.join(directory, "private-oracle.py"), reference = path.join(directory, "private-reference.patch");
  await writeFile(oracle, "private-evaluator-content"); await writeFile(reference, "private-reference-content");
  const image = `sha256:${"a".repeat(64)}`, revision = "b".repeat(40), oracleHash = digest("private-evaluator-content"), referenceHash = digest("private-reference-content");
  const manifest = ComparisonManifestSchema.parse({ schemaVersion: 1, screenId: "routing-test", seed: "20260909", image, evaluatorSha256: "e".repeat(64),
    tasks: Array.from({ length: 12 }, (_, index) => ({ taskId: `task-${index}`, source: { url: `https://github.com/public/repo${index % 3}`, revision,
      root: path.join(directory, "public-source"), files: 1, bytes: 10 }, objective: `Fix public behavior ${index}`, visibleCommand: "python -m unittest test_public",
      oracle: { path: oracle, sha256: oracleHash }, referencePatch: { path: reference, sha256: referenceHash },
      baselineReceipt: { exitCode: 1, sourceRevision: revision, oracleSha256: oracleHash, patchSha256: null, image, cleanupConfirmed: true,
        sourceTreeSha256: "c".repeat(64), harnessVerified: true, testCount: 2, passed: 1, failures: 1, errors: 0, skipped: 0, failureKind: "candidate" },
      referenceReceipt: { exitCode: 0, sourceRevision: revision, oracleSha256: oracleHash, patchSha256: referenceHash, image, cleanupConfirmed: true,
        sourceTreeSha256: "c".repeat(64), harnessVerified: true, testCount: 2, passed: 2, failures: 0, errors: 0, skipped: 0 } })) });
  const taskContracts = manifest.tasks.map((task) => ({ taskId: task.taskId, allowedFiles: ["example.py"], sourceTreeSha256: "c".repeat(64), expectedTests: 2 }));
  const cloud = { id: "openai", protocol: "openai", model: "gpt-5.6-sol", destinationSha256: digest("https://api.openai.com/v1/chat/completions"),
    inputUsdPerMillion: 4, outputUsdPerMillion: 20, allowInsecureHttp: false, maxOutputTokens: 8192, maxInputBytes: 256000 };
  const cloudLimits = { stepLimit: 40, wallTimeSeconds: 600, commandTimeoutSeconds: 30, requestTimeoutSeconds: 120, visibleCheckTimeoutSeconds: 60, maxOutputTokens: 8192, maxInputBytes: 256000 };
  const nativeLimits = { ...cloudLimits, localStepLimit: 24, finishingReserve: 2, visibleCheckTimeoutSeconds: 60, localCoding: { maxOutputTokens: 8192, maxInputBytes: 256000 } };
  const configuration = RoutingComparisonConfigurationSchema.parse({ schemaVersion: 1, kind: "routing-comparison-v1", mode: "live",
    manifestSha256: digest(canonicalRequest(manifest)), image, policyByArm: ROUTING_POLICIES, cloud,
    local: { ...cloud, id: "local", model: "owned-local-model", destinationSha256: "d".repeat(64), inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
    episodeMicrousd: 3_000_000, campaignMicrousd: 150_000_000, blockMicrousd: 9_000_000,
    limitsByArm: { C: cloudLimits, L: nativeLimits, E: nativeLimits, P: nativeLimits },
    cloudControls: { reasoningEffort: "medium", serviceTier: "default", promptCacheMode: "explicit_no_breakpoints" },
    localControls: { enableThinking: false, protocol: "native_coding", parallelToolCalls: false }, concurrency: 1,
    taskContracts, taskContractsSha256: digest(canonicalRequest(taskContracts)),
    codeHashes: Object.fromEntries(ROUTING_COMPARISON_CODE_PATHS.map((file) => [file, "e".repeat(64)])),
    localEconomics: { devicePurchaseUsd: 3500, perTokenApiFeeUsd: 0, ownership: "user_owned", electricityAndUtilization: "unavailable" },
  });
  const screen = new RoutingComparisonStore(db), runs = new PatchRunStore(db);
  return { db, directory, manifest, configuration, screen, runs };
}
type Setup = Awaited<ReturnType<typeof setup>>;
type RoutingSetup = Omit<Setup, "manifest" | "configuration"> & { manifest: RoutingManifest; configuration: RoutingConfiguration };
function createRun(context: RoutingSetup, arm: RoutingArm, objective = "fixture") {
  return context.runs.create({ workspaceRoot: context.manifest.tasks[0]!.source.root, objective, policy: ROUTING_POLICIES[arm], executionMode: "live",
    baseRevision: context.manifest.tasks[0]!.source.revision, maxCostMicrousd: 3_000_000 });
}
function receipt(context: RoutingSetup, task: ComparisonManifest["tasks"][number], patchSha256: string) {
  return { ...task.referenceReceipt, patchSha256, image: context.manifest.image };
}
function controllerFor(context: RoutingSetup, seen: PatchRunCreateInput[] = [], patchText = PATCH) {
  const { runs, manifest } = context;
  return {
    async create(input: PatchRunCreateInput) {
      if (input.policy === "automatic") throw new Error("This legacy fixture requires an explicit policy.");
      seen.push(input);
      return runs.create({ workspaceRoot: input.workspaceRoot, objective: input.objective, policy: input.policy, executionMode: "live",
        baseRevision: manifest.tasks[0]!.source.revision, maxCostMicrousd: 3_000_000, visibleTestCommand: input.visibleTestCommand });
    },
    start(id: string) {
      const run = runs.start(id), local = run.policy === "local_only";
      runs.reserveRequest(id, { requestId: id, amountMicrousd: local ? 0 : 1000, providerLabel: local ? "local · model" : "OpenAI · gpt-5.6-sol",
        campaignLimitMicrousd: 150_000_000, phase: local ? "local" : "cloud" });
      runs.startRequest(id, id);
      runs.finishRequest(id, { requestId: id, outcome: "succeeded", actualCostMicrousd: local ? 0 : 500,
        usage: { inputTokens: 25, outputTokens: 20, reasoningTokens: 0 } });
      const text = patchText;
      runs.recordPatch(id, { kind: "submitted", text, sha256: digest(text), files: ["example.py"], truncated: false });
      runs.recordChecks(id, { command: "python -m unittest test_public", status: "passed", exitCode: 0, output: "OK" });
      runs.recordCleanup(id, true);
      return runs.finish(id, "completed");
    },
    async waitForRun(id: string) { return runs.get(id); }, cancel(id: string) {
      if (isPatchRunTerminal(runs.get(id).status)) return runs.get(id);
      if (runs.get(id).status === "running") runs.recordCleanup(id, true);
      return runs.finish(id, "cancelled");
    },
  };
}
function optionsFor(context: RoutingSetup) {
  return { manifest: context.manifest, configuration: context.configuration, runs: context.runs, screen: context.screen,
    outputDirectory: context.directory, beforeEpisode: async () => {}, controller: controllerFor(context),
    evaluate: async (task: ComparisonManifest["tasks"][number], patchPath: string): Promise<unknown> => {
      const assignment = context.screen.assignments(context.manifest.screenId).find((row) => row.run_id && patchPath.includes(row.run_id))!;
      expect(context.runs.get(assignment.run_id!).status).toBe("completed");
      expect(context.screen.hasEvaluationClaim(context.manifest.screenId, task.taskId, assignment.arm)).toBe(true);
      return receipt(context, task, context.runs.get(assignment.run_id!).patch!.sha256);
    } };
}

function defaultRuntime(image: string): PatchRuntimeConfig {
  return { ...nativeRuntime, image, episodeCapMicrousd: 3_000_000, campaignCapMicrousd: 150_000_000,
    maxOutputTokens: 8192, maxInputBytes: 256000,
    cloud: { ...nativeRuntime.cloud!, endpoint: "https://api.openai.com/v1/chat/completions", model: "gpt-5.6-sol", inputUsdPerMillion: 4, outputUsdPerMillion: 20 } };
}
async function setupDevelopment() {
  const context = await setup();
  const manifest = RoutingDevelopmentManifestSchema.parse({ ...context.manifest, schemaVersion: 2,
    kind: "routing-public-checks-development-v2", studyKind: "development", screenId: "routing-development-test", tasks: context.manifest.tasks.slice(0, 6) });
  const base = defaultRuntime(manifest.image);
  const taskContracts = context.configuration.taskContracts.slice(0, 6);
  const configuration = RoutingDevelopmentConfigurationSchema.parse({ ...context.configuration, schemaVersion: 2,
    kind: manifest.kind, studyKind: manifest.studyKind, manifestSha256: digest(canonicalRequest(manifest)),
    policyByArm: { C: ROUTING_POLICIES.C, P: ROUTING_POLICIES.P },
    limitsByArm: { C: patchPolicyLimits(base, "prepared_cloud"), P: patchPolicyLimits(routingRuntimeConfigForArm(base, "P", manifest), "cloud_plan_local") },
    taskContracts, taskContractsSha256: digest(canonicalRequest(taskContracts)),
    codeHashes: Object.fromEntries(ROUTING_DEVELOPMENT_CODE_PATHS.map(file => [file, "e".repeat(64)])),
  });
  return { ...context, manifest, configuration, base };
}

function settleFixtureRequest(context: RoutingSetup, id: string, phase: PatchRunRequestPhase) {
  context.runs.reserveRequest(id, { requestId: id, amountMicrousd: 1000, providerLabel: "fixture", phase, campaignLimitMicrousd: 150_000_000 });
  context.runs.startRequest(id, id);
  context.runs.finishRequest(id, { requestId: id, outcome: "succeeded", actualCostMicrousd: 500,
    usage: { inputTokens: 25, outputTokens: 20, reasoningTokens: 0 } });
}
function failedSubmission(context: RoutingSetup, id: string, options: { kind?: "submitted" | "recovered"; truncated?: boolean; cancelled?: boolean } = {}) {
  const { runs } = context;
  const run = runs.start(id), source = "import unittest\nclass Cases(unittest.TestCase):\n    def test_public(self):\n        self.fail('fixture failure')\n";
  const tree = "a".repeat(64), generated = context.configuration.schemaVersion === 2 && run.policy === "cloud_plan_local" &&
    !options.kind && !options.truncated && !options.cancelled;
  let error: string | undefined;
  if (context.configuration.schemaVersion === 2) {
    settleFixtureRequest(context, id, run.policy === "cloud_plan_local" ? "planner" : "cloud");
    error = run.policy === "cloud_plan_local" ? "Worker stopped: routing_plan_invalid" : "Worker stopped: agent_RepeatedFormatError";
  }
  if (generated) {
    runs.setPhase(id, "cloud_planner");
    runs.recordPlan(id, { summary: "Fixture plan", sha256: digest("Fixture plan"), checks: { schemaVersion: 1,
      kind: "model_generated_python_unittest", source, expectedTests: 1, sha256: digest(source), testIds: ["Cases.test_public"] } });
  }
  runs.recordPatch(id, { kind: options.kind ?? "submitted", text: PATCH, sha256: digest(PATCH), files: ["example.py"], truncated: options.truncated ?? false });
  if (options.kind !== "recovered") runs.recordChecks(id, { command: "python -m unittest test_public", status: "passed", exitCode: 0, output: "OK",
    ...(generated ? { sourceSha256: tree, sourceAfterSha256: tree } : {}) });
  if (generated) {
    runs.setPhase(id, "checking");
    const result = { schemaVersion: 1 as const, kind: "model_generated_python_unittest" as const, sourceSha256: digest(source),
      expectedTests: 1, discoveredTests: 1, testsRun: 1, passed: 0, failures: 1, errors: 0, skipped: 0, expectedFailures: 0,
      unexpectedSuccesses: 0, completed: true, status: "failed" as const, detail: "" };
    runs.recordPlannerCheck(id, { stage: "final", artifactSha256: digest(source), sourceSha256: tree, sourceAfterSha256: tree,
      exitCode: 1, output: "SOAR_MODEL_GENERATED_CHECKS_V1=" + JSON.stringify(result), outputTruncated: false,
      elapsedMs: 10, timedOut: false, result, passed: false, fresh: true });
    error = "Worker stopped: routing_planner_final_checks_failed";
  }
  runs.recordCleanup(id, true);
  return runs.finish(id, options.cancelled ? "cancelled" : "failed", error);
}

describe("exact persisted routing failure classification", () => {
  it.each([
    "planner_checks_response", "planner_checks_schema", "planner_checks_plan",
    "planner_checks_source", "planner_checks_count", "planner_checks_syntax", "planner_checks_declarations",
  ])("preserves initial planner rejection %s only with a single settled request and no plan", async code => {
    const context = await setupDevelopment(), { runs } = context, run = createRun(context, "P");
    runs.start(run.id); settleFixtureRequest(context, run.id, "planner"); runs.recordCleanup(run.id, true);
    const error = `Worker stopped: routing_plan_rejected:${code}`;
    const failed = runs.finish(run.id, "failed", error);
    expect(failed.events.at(-1)).toMatchObject({ type: "run.failed", summary: error });
    expect(runs.get(run.id)).toEqual(failed); expect(runs.replay(run.id)).toEqual(failed);
    expect(failed.spentMicrousd).toBe(500);
    expect(classifyRoutingRuntimeFailure(failed)).toEqual({ kind: "model_output", code: `routing_plan_rejected:${code}`, stop: false });
    for (const old of ["routing_plan_invalid", "PlannerChecksError"]) {
      expect(classifyRoutingRuntimeFailure({ ...failed, error: `Worker stopped: ${old}` }))
        .toEqual({ kind: "model_output", code: old, stop: false });
    }
    const usage = failed.phaseUsage!.planner!;
    for (const change of [
      { phaseUsage: undefined },
      ...[{ usageReceipts: 0 }, { unknownRequests: 1 }, { reservedMicrousd: 1 },
        { requestCount: 2, usageReceipts: 2 }].map(value => ({ phaseUsage: { planner: { ...usage, ...value } } })),
      { cloudPlan: { summary: "Already admitted", sha256: digest("Already admitted") } },
      ...["Worker stopped: routing_plan_rejected:unknown", "Worker stopped: routing_plan_rejected:future",
        `${error} extra`, `prefix ${error}`, `${error}\n`].map(value => ({ error: value })),
    ]) {
      expect(classifyRoutingRuntimeFailure({ ...failed, ...change })).toMatchObject({ kind: "unclassified", stop: true });
    }
  });


  it("classifies actual host errors and fails closed on unfamiliar terminal errors without guessing their cause", async () => {
    const context = await setupDevelopment(), run = createRun(context, "C");
    context.runs.start(run.id); context.runs.recordCleanup(run.id, true);
    const snapshot = context.runs.finish(run.id, "failed", "Coding worker exited without a durable terminal state.");
    expect(snapshot.events.at(-1)).toMatchObject({ type: "run.failed", summary: snapshot.error });
    expect(classifyRoutingRuntimeFailure(snapshot)).toEqual({ kind: "infrastructure", code: "worker_durable_terminal_missing", stop: true });
    for (const error of ["Coding worker exited without a terminal receipt.", "Worker input channel closed.",
      "Worker output exceeded the protocol limit.", "Worker exited with an incomplete protocol frame.",
      "Worker completion did not match the host check receipt.", "Worker stopped: invalid_container_baseline"]) {
      expect(classifyRoutingRuntimeFailure({ ...snapshot, error })).toMatchObject({ kind: "infrastructure", stop: true });
    }
    for (const error of [undefined, "Worker stopped: ValueError", "Worker stopped: routing_future_failure",
      "Worker stopped: routing_native_completion_usage_missing", "Worker stopped: routing_native_profile",
      "Worker stopped: routing_native_history_schema", "routing_plan_invalid", "Worker stopped: routing_plan_invalid extra"]) {
      expect(classifyRoutingRuntimeFailure({ ...snapshot, error })).toEqual({ kind: "unclassified", code: "terminal_failure_unclassified", stop: true });
    }
  });

  it("requires settled phase evidence for recognized model/budget failures and preserves completed visible failures", async () => {
    const context = await setupDevelopment(), { runs } = context, run = createRun(context, "C");
    runs.start(run.id); settleFixtureRequest(context, run.id, "cloud");
    runs.recordPatch(run.id, { kind: "submitted", text: PATCH, sha256: digest(PATCH), files: ["example.py"], truncated: false });
    runs.recordChecks(run.id, { status: "failed", command: "python -m unittest test_public", exitCode: 1, output: "public assertion failed" });
    runs.recordCleanup(run.id, true);
    const completed = runs.finish(run.id, "completed");
    expect(classifyRoutingRuntimeFailure(completed)).toBeNull();
    for (const [error, kind] of [["agent_LimitsExceeded", "budget"], ["agent_TimeExceeded", "budget"],
      ["agent_RepeatedFormatError", "model_output"], ["provider_output_empty", "model_output"], ["provider_output_truncated", "model_output"]] as const) {
      const failed: PatchRunSnapshot = { ...completed, status: "failed", error: `Worker stopped: ${error}` };
      expect(classifyRoutingRuntimeFailure(failed)).toEqual({ kind, code: error, stop: false });
      expect(classifyRoutingRuntimeFailure({ ...failed, phaseUsage: undefined })).toMatchObject({ kind: "unclassified", stop: true });
      expect(classifyRoutingRuntimeFailure({ ...failed, phaseUsage: { cloud: { ...failed.phaseUsage!.cloud!, usageReceipts: 0 } } })).toMatchObject({ kind: "unclassified", stop: true });
    }
  });

  it("matches native response failures and bounded handoff/deadline reasons to persisted stopped checkpoints", async () => {
    const context = await setupDevelopment(), { runs } = context, run = createRun(context, "P");
    runs.start(run.id); settleFixtureRequest(context, run.id, "local");
    runs.recordCheckpoint(run.id, checkpoint(undefined, { policy: "cloud_plan_local", state: "stopped", decision: "stop", reason: "protocol_failure",
      localCalls: 1, remainingLocalCalls: 23 }));
    runs.recordCleanup(run.id, true);
    const failed = runs.finish(run.id, "failed", "Worker stopped: routing_native_arguments_json");
    expect(classifyRoutingRuntimeFailure(failed)).toEqual({ kind: "model_output", code: "routing_native_arguments_json", stop: false });
    expect(classifyRoutingRuntimeFailure({ ...failed, checkpoint: undefined })).toMatchObject({ kind: "unclassified", stop: true });
    // Building the next request increments the router before history validation;
    // shared parser codes there must not turn a host/history fault into a response.
    expect(classifyRoutingRuntimeFailure({ ...failed, checkpoint: { ...failed.checkpoint!, localCalls: 2, remainingLocalCalls: 22 } }))
      .toMatchObject({ kind: "unclassified", stop: true });
    for (const [code, reason] of [["routing_insufficient_model_calls", "insufficient_model_calls"],
      ["routing_insufficient_handoff_time", "insufficient_handoff_time"], ["run_deadline_exceeded", "episode_deadline"],
      ["routing_request_deadline_reserve", "episode_deadline"]] as const) {
      const bounded = { ...failed, error: `Worker stopped: ${code}`,
        checkpoint: checkpoint(undefined, { policy: "cloud_plan_local", state: "stopped", decision: "stop", reason }) };
      expect(classifyRoutingRuntimeFailure(bounded)).toEqual({ kind: "budget", code, stop: false });
      expect(classifyRoutingRuntimeFailure({ ...bounded, checkpoint: failed.checkpoint })).toMatchObject({ kind: "unclassified", stop: true });
    }
  });

  it("requires the exact final generated-check error and complete bound failing evidence before diagnostic continuation", async () => {
    const context = await setupDevelopment(), run = createRun(context, "P"), failed = failedSubmission(context, run.id);
    expect(failed.error).toBe("Worker stopped: routing_planner_final_checks_failed");
    expect(failed.events.some(event => event.type === "planner.checks.checked")).toBe(true);
    expect(classifyRoutingRuntimeFailure(failed)).toEqual({ kind: "checks", code: "routing_planner_final_checks_failed", stop: false });
    const check = failed.plannerCheck!, result = check.result!;
    const invalid: Partial<PatchRunSnapshot>[] = [
      { error: "routing_planner_final_checks_failed" }, { cloudPlan: undefined }, { plannerCheck: undefined },
      { patch: { ...failed.patch!, truncated: true } }, { checks: { ...failed.checks, sourceAfterSha256: "b".repeat(64) } },
      ...[{ fresh: false }, { timedOut: true }, { outputTruncated: true }, { result: null },
        { artifactSha256: "b".repeat(64) }, { result: { ...result, expectedTests: 2 } },
        { result: { ...result, completed: false, status: "invalid" as const } },
        { result: { ...result, skipped: 1, failures: 0 } }].map(change => ({ plannerCheck: { ...check, ...change } })),
    ];
    for (const change of invalid) expect(classifyRoutingRuntimeFailure({ ...failed, ...change })).toMatchObject({ kind: "unclassified", stop: true });

    const timeout: PatchRunSnapshot = { ...failed, error: "Worker stopped: routing_check_timeout", plannerCheck: undefined,
      checkpoint: checkpoint(undefined, { policy: "cloud_plan_local", state: "stopped", decision: "stop", reason: "check_timeout",
        evidence: { timedOut: true, completed: false } }),
      checkpointCheck: { command: failed.checks.command!, exitCode: 124, output: "time limit", elapsedMs: 60_000,
        sourceSha256: "a".repeat(64), sourceAfterSha256: "a".repeat(64), passed: false, fresh: true } };
    expect(classifyRoutingRuntimeFailure(timeout)).toEqual({ kind: "checks", code: "routing_check_timeout", stop: false });
    expect(classifyRoutingRuntimeFailure({ ...timeout, checkpointCheck: undefined })).toMatchObject({ kind: "unclassified", stop: true });
    expect(classifyRoutingRuntimeFailure({ ...timeout, checkpoint: { ...timeout.checkpoint!, evidence: { timedOut: false, completed: false } } })).toMatchObject({ kind: "unclassified", stop: true });
  });
});

describe("versioned six-task C/P development routing", () => {
  it("keeps strict legacy manifest/configuration bytes and rejects cross-version profiles", async () => {
    const old = await setup(), current = await setupDevelopment();
    for (const [schema, value] of [[ComparisonManifestSchema, old.manifest], [RoutingComparisonConfigurationSchema, old.configuration]] as const) {
      expect(canonicalRequest(schema.parse(value))).toBe(canonicalRequest(value));
    }
    expect(RoutingManifestSchema.parse(current.manifest)).toEqual(current.manifest);
    expect(RoutingConfigurationSchema.parse(current.configuration)).toEqual(current.configuration);
    expect(() => ComparisonManifestSchema.parse(current.manifest)).toThrow();
    expect(() => RoutingComparisonConfigurationSchema.parse(current.configuration)).toThrow();
    expect(() => RoutingDevelopmentManifestSchema.parse(old.manifest)).toThrow();
    expect(() => RoutingDevelopmentConfigurationSchema.parse(old.configuration)).toThrow();
    expect(() => current.screen.freeze(current.manifest, old.configuration)).toThrow();
    expect(() => old.screen.freeze(old.manifest, current.configuration)).toThrow();
    expect(current.screen.assignments(current.manifest.screenId)).toEqual([]);
    expect(routingArms(old.configuration)).toEqual(["C", "L", "E", "P"]);
    expect(routingArms(current.configuration)).toEqual(["C", "P"]);
  });

  it("requires all six unique tasks, three repositories and the unchanged reference receipt bindings", async () => {
    const { manifest } = await setupDevelopment();
    for (const tasks of [manifest.tasks.slice(1), [...manifest.tasks, manifest.tasks[0]!],
      [...manifest.tasks.slice(0, 5), manifest.tasks[0]!],
      manifest.tasks.map(task => ({ ...task, source: { ...task.source, url: "https://github.com/public/one" } })),
      manifest.tasks.map((task, index) => index ? task : ({ ...task, referenceReceipt: { ...task.referenceReceipt, patchSha256: "f".repeat(64) } })),
      manifest.tasks.map((task, index) => index ? task : ({ ...task, baselineReceipt: { ...task.baselineReceipt, sourceRevision: "f".repeat(40) } })),
    ]) expect(() => RoutingDevelopmentManifestSchema.parse({ ...manifest, tasks })).toThrow();
    expect(() => RoutingDevelopmentManifestSchema.parse({ ...manifest, studyKind: "confirmation" })).toThrow();
  });

  it("derives only the P experiment and rejects non-default caller profiles without mutation", async () => {
    const { manifest, base, configuration } = await setupDevelopment();
    const original = structuredClone(base);
    expect(routingRuntimeConfigForArm(base, "C", manifest)).toBe(base);
    const planned = routingRuntimeConfigForArm(base, "P", manifest);
    expect(planned).toEqual({ ...base, plannerMode: "plan_and_checks", localCodingCheckSchedule: "host_repair_window" });
    expect(patchPolicyLimits(planned, "cloud_plan_local")).toEqual(configuration.limitsByArm.P);
    expect(base).toEqual(original);
    for (const override of [{ localCodingThinking: "medium" }, { localCodingThinking: null }, { localCodingMaxCalls: 8 },
      { localCodingCheckSchedule: "host_repair_window" }, { localCodingCheckSchedule: "repair_window" }, { plannerMode: "plan_and_checks" }, { plannerMode: null }]) {
      for (const arm of ["C", "P"] as const) expect(() => routingRuntimeConfigForArm({ ...base, ...override } as PatchRuntimeConfig, arm, manifest)).toThrow(/default-compatible/);
    }
    expect(() => routingRuntimeConfigForArm(base, "L", manifest)).toThrow(/not assigned/);
    expect(() => RoutingDevelopmentConfigurationSchema.parse({ ...configuration, limitsByArm: { ...configuration.limitsByArm,
      C: { ...configuration.limitsByArm.C, plannerMode: "plan_and_checks" } } })).toThrow();
    for (const change of [{ plannerMode: undefined }, { localStepLimit: 8 }, { localCoding: { ...configuration.limitsByArm.P.localCoding, checkSchedule: "final_only" } }]) {
      expect(() => RoutingDevelopmentConfigurationSchema.parse({ ...configuration, limitsByArm: { ...configuration.limitsByArm, P: { ...configuration.limitsByArm.P, ...change } } })).toThrow();
    }
  });

  it("freezes twelve assignments with three CP and three PC pairs under unchanged SQL reservations", async () => {
    const { db, manifest, configuration, screen } = await setupDevelopment();
    const blocks = balancedRoutingBlocks(manifest);
    expect(blocks).toEqual(balancedRoutingBlocks(manifest));
    expect(blocks.filter(block => block.order.join("") === "CP")).toHaveLength(3);
    expect(blocks.filter(block => block.order.join("") === "PC")).toHaveLength(3);
    expect(new Set(blocks.map(block => block.taskId)).size).toBe(6);
    expect(listAppliedDatabaseMigrations(db).at(-1)?.version).toBe(8);
    screen.freeze(manifest, configuration);
    expect(screen.assignments(manifest.screenId)).toHaveLength(12);
    expect(new Set(screen.assignments(manifest.screenId).map(row => row.arm))).toEqual(new Set(["C", "P"]));
    expect(screen.blocks(manifest.screenId).every(block => block.reservation_microusd === 9_000_000)).toBe(true);
    screen.reserveBlock(manifest.screenId, blocks[0]!.taskId);
    expect(patchCampaignExposure(db).microusd).toBe(9_000_000);
    expect(() => screen.completeBlock(manifest.screenId, blocks[0]!.taskId)).toThrow(/incomplete/);
    expect(() => screen.claimDispatch(manifest.screenId, blocks[0]!.taskId, "L")).toThrow();
    const missing = structuredClone(configuration); delete missing.codeHashes["runtime/patch-worker/planner_checks.py"];
    expect(() => screen.freeze(manifest, missing)).toThrow(/identity/);
  });

  it("binds optional V2 historical admission without admitting it in V1 or allowing it to drift", async () => {
    const current = await setupDevelopment(), old = await setup();
    const admission = { receiptSha256: "f".repeat(64), priorCampaignExposureMicrousd: 13_000_000, priorRunCount: 42 };
    const configuration = RoutingDevelopmentConfigurationSchema.parse({ ...current.configuration, historicalAdmission: admission });
    current.screen.freeze(current.manifest, configuration);
    expect(() => current.screen.freeze(current.manifest, { ...configuration, historicalAdmission: { ...admission, priorRunCount: 43 } })).toThrow(/cannot change/);
    expect(() => RoutingComparisonConfigurationSchema.parse({ ...old.configuration, historicalAdmission: admission })).toThrow();
    await expect(routingComparisonConfiguration(current.base, process.cwd(), old.manifest, old.configuration.taskContracts, [], admission)).rejects.toThrow(/only for V2/);
    for (const change of [{ priorRunCount: -1 }, { priorRunCount: 0.5 }, { priorCampaignExposureMicrousd: Number.MAX_SAFE_INTEGER + 1 }, { receiptSha256: "invalid" }, { privatePath: "/must-not-persist" }]) {
      expect(() => RoutingHistoricalAdmissionSchema.parse({ ...admission, ...change })).toThrow();
    }
    expect(RoutingHistoricalAdmissionSchema.parse({ ...admission, priorRunCount: 0, priorCampaignExposureMicrousd: 0 })).toMatchObject({ priorRunCount: 0 });
    expect(current.configuration).not.toHaveProperty("historicalAdmission");
  });

  it("uses per-arm controllers and revalidation for all twelve episodes without retries", async () => {
    const context = await setupDevelopment(), cSeen: PatchRunCreateInput[] = [], pSeen: PatchRunCreateInput[] = [];
    const c = controllerFor(context, cSeen), p = controllerFor(context, pSeen), before: string[] = [];
    const options = { ...optionsFor(context), controller: undefined, controllerForArm: (arm: RoutingArm) => arm === "C" ? c : p,
      beforeEpisode: async ({ taskId, arm }: { taskId: string; arm: RoutingArm }) => { before.push(`${taskId}:${arm}`); } };
    let evaluations = 0; const evaluate = options.evaluate;
    options.evaluate = async (...args) => { evaluations++; return evaluate(...args); };
    await runRoutingComparisonScreen(options); await runRoutingComparisonScreen(options);
    expect(cSeen).toHaveLength(6); expect(pSeen).toHaveLength(6); expect(before).toHaveLength(12); expect(evaluations).toBe(12);
    expect(cSeen.every(input => input.policy === "prepared_cloud")).toBe(true);
    expect(pSeen.every(input => input.policy === "cloud_plan_local")).toBe(true);
    expect(cSeen.map(input => input.objective).sort()).toEqual(pSeen.map(input => input.objective).sort());
    expect(context.screen.blocks(context.manifest.screenId).every(block => block.state === "completed")).toBe(true);
    expect(patchCampaignExposure(context.db).microusd).toBe(6_000);
    expect(JSON.stringify([...cSeen, ...pSeen])).not.toMatch(/oracle|reference|private-evaluator/);
  });

  it("requires per-arm selection before freezing and stops before claiming on configuration drift", async () => {
    const context = await setupDevelopment(), options = optionsFor(context);
    await expect(runRoutingComparisonScreen(options)).rejects.toThrow(/selected for each arm/);
    expect(context.screen.assignments(context.manifest.screenId)).toHaveLength(0);
    await expect(runRoutingComparisonScreen({ ...options, controllerForArm: () => options.controller,
      beforeEpisode: async () => { throw new Error("configuration drift"); } })).rejects.toThrow(/drift/);
    expect(context.screen.assignments(context.manifest.screenId)).toHaveLength(12);
    expect(context.screen.assignments(context.manifest.screenId).every(row => row.dispatch_claimed === 0 && row.run_id === null)).toBe(true);
  });

  it("retains old unknown exposure and stops on a new zero-fee unknown before the next assignment", async () => {
    const context = await setupDevelopment(), { runs, screen, manifest, configuration } = context;
    const old = runs.create({ workspaceRoot: "/public", objective: "prior immutable exposure", policy: "prepared_cloud", executionMode: "live", baseRevision: "b".repeat(40), maxCostMicrousd: 150_000_000 });
    runs.start(old.id); runs.reserveRequest(old.id, { requestId: "prior", amountMicrousd: 140_000_000, providerLabel: "OpenAI", campaignLimitMicrousd: 150_000_000 });
    runs.startRequest(old.id, "prior"); runs.finishRequest(old.id, { requestId: "prior", outcome: "unknown" }); runs.recordCleanup(old.id, true); runs.finish(old.id, "failed");
    const beforeOld = runs.get(old.id);
    for (let seed = 0; balancedRoutingBlocks(manifest)[0]!.order[0] !== "P"; seed++) manifest.seed = String(seed);
    configuration.manifestSha256 = digest(canonicalRequest(manifest));
    const controller = controllerFor(context); let starts = 0, evaluated = 0;
    controller.start = id => {
      starts++; runs.start(id); runs.reserveRequest(id, { requestId: id, amountMicrousd: 0, providerLabel: "local · fixture", phase: "local", campaignLimitMicrousd: 150_000_000 });
      runs.startRequest(id, id); runs.finishRequest(id, { requestId: id, outcome: "unknown" }); runs.recordCleanup(id, true); return runs.finish(id, "failed");
    };
    const options = { ...optionsFor(context), controllerForArm: () => controller, evaluate: async () => { evaluated++; throw new Error("must not evaluate"); } };
    await expect(runRoutingComparisonScreen(options)).rejects.toThrow(/Provider outcome is unknown/);
    await expect(runRoutingComparisonScreen(options)).rejects.toThrow(/Frozen routing error/);
    expect(starts).toBe(1); expect(evaluated).toBe(0); expect(runs.get(old.id)).toEqual(beforeOld);
    expect(screen.assignments(manifest.screenId).filter(row => row.run_id === null)).toHaveLength(11);
    expect(patchCampaignExposure(context.db).microusd).toBe(149_000_000);
  });

  it("labels failed submitted patches as diagnostics without upgrading runtime completion", async () => {
    const context = await setupDevelopment(), c = controllerFor(context), p = controllerFor(context);
    p.start = id => failedSubmission(context, id);
    let evaluated = 0;
    await runRoutingComparisonScreen({ ...optionsFor(context), controllerForArm: arm => arm === "C" ? c : p,
      evaluate: async (task, patchPath) => {
        evaluated++;
        expect(digest(await readFile(patchPath))).toBe(digest(PATCH));
        return receipt(context, task, digest(PATCH));
      } });
    expect(evaluated).toBe(12);
    for (const row of context.screen.assignments(context.manifest.screenId)) {
      const result = JSON.parse(row.evaluation_json!);
      if (row.arm === "P") {
        expect(context.runs.get(row.run_id!).status).toBe("failed");
        expect(result).toMatchObject({ status: "scored", kind: "diagnostic", reason: "failed_runtime_submission", receipt: { exitCode: 0 } });
        expect(result).not.toHaveProperty("acceptable");
      } else expect(result).not.toHaveProperty("kind");
    }
  });

  it("rejects an unlabelled or rebound diagnostic at the persisted evaluation boundary", async () => {
    const context = await setupDevelopment(), { manifest, configuration, screen } = context;
    screen.freeze(manifest, configuration);
    const block = screen.blocks(manifest.screenId)[0]!;
    screen.reserveBlock(manifest.screenId, block.task_id); screen.claimDispatch(manifest.screenId, block.task_id, "P");
    const run = createRun(context, "P"); screen.link(manifest.screenId, block.task_id, "P", run.id);
    failedSubmission(context, run.id); screen.claimEvaluation(manifest.screenId, block.task_id, "P");
    const result = { status: "scored" as const, patchSha256: digest(PATCH), oracleSha256: manifest.tasks[0]!.oracle.sha256,
      receipt: receipt(context, manifest.tasks[0]!, digest(PATCH)) };
    expect(() => screen.evaluated(manifest.screenId, block.task_id, "P", result)).toThrow(/labelled diagnostic/);
    expect(() => screen.evaluated(manifest.screenId, block.task_id, "P", { ...result, kind: "diagnostic", reason: "failed_runtime_submission", patchSha256: "f".repeat(64) })).toThrow(/failed submitted artifact/);
    screen.evaluated(manifest.screenId, block.task_id, "P", { ...result, kind: "diagnostic", reason: "failed_runtime_submission" });
    expect(() => screen.evaluated(manifest.screenId, block.task_id, "P", { ...result, kind: "diagnostic", reason: "failed_runtime_submission" })).toThrow(/immutable/);
  });

  it.each([{ version: 1, artifact: {} }, { version: 1, artifact: { cancelled: true } },
    { version: 2, artifact: { kind: "recovered" as const } }, { version: 2, artifact: { truncated: true } }])(
    "never evaluates ineligible terminal artifacts ($version / $artifact)", async ({ version, artifact }) => {
      const context = version === 1 ? await setup() : await setupDevelopment(), controller = controllerFor(context), abort = new AbortController();
      controller.start = id => failedSubmission(context, id, artifact);
      let evaluated = 0;
      await runRoutingComparisonScreen({ ...optionsFor(context), controllerForArm: () => controller, signal: abort.signal,
        progress: () => abort.abort(), evaluate: async () => { evaluated++; throw new Error("not eligible"); } });
      expect(evaluated).toBe(0);
      const row = context.screen.assignments(context.manifest.screenId).find(value => value.evaluation_json)!;
      expect(JSON.parse(row.evaluation_json!)).toMatchObject({ status: "not_scorable" });
      expect(context.screen.hasEvaluationClaim(context.manifest.screenId, row.task_id, row.arm)).toBe(false);
    });

  it.each([
    { status: "failed" as const, error: "Coding worker exited without a durable terminal state.", reason: "runtime_infrastructure:worker_durable_terminal_missing" },
    { status: "failed" as const, error: "Worker stopped: unexpected_future_error", reason: "runtime_unclassified:terminal_failure_unclassified" },
    { status: "cancelled" as const, error: undefined, reason: "runtime_cancelled:cancelled" },
    { status: "interrupted" as const, error: undefined, reason: "runtime_cancelled:interrupted" },
  ])("stops V2 before another dispatch for settled, cleaned $status / $reason", async ({ status, error, reason }) => {
    const context = await setupDevelopment(), { runs, screen, manifest } = context;
    const controller = controllerFor(context); let starts = 0, evaluations = 0;
    controller.start = id => {
      starts++; runs.start(id); settleFixtureRequest(context, id, "cloud");
      runs.recordCleanup(id, true); return runs.finish(id, status, error);
    };
    const options = { ...optionsFor(context), controllerForArm: () => controller,
      evaluate: async () => { evaluations++; throw new Error("must not evaluate"); } };
    await expect(runRoutingComparisonScreen(options)).rejects.toThrow(/stage stops without automatic retry/);
    await expect(runRoutingComparisonScreen(options)).rejects.toThrow(/Frozen routing error/);
    expect(starts).toBe(1); expect(evaluations).toBe(0);
    const rows = screen.assignments(manifest.screenId), attempted = rows.find(row => row.run_id)!;
    expect(rows.filter(row => row.dispatch_claimed === 0 && row.run_id === null)).toHaveLength(11);
    expect(JSON.parse(attempted.evaluation_json!)).toMatchObject({ status: "error", reason });
    expect(screen.hasEvaluationClaim(manifest.screenId, attempted.task_id, attempted.arm)).toBe(false);
    expect(runs.get(attempted.run_id!)).toMatchObject({ status, cleanupConfirmed: true, spentMicrousd: 500, reservedMicrousd: 0 });
    expect(runs.replay(attempted.run_id!)).toEqual(runs.get(attempted.run_id!));
    expect(patchCampaignExposure(context.db).microusd).toBe(9_000_000);
  });

  it("retains bounded budget/model failures in all denominators and continues the paired V2 cohort", async () => {
    const context = await setupDevelopment(), { runs, screen, manifest } = context;
    const controller = controllerFor(context); let starts = 0;
    controller.start = id => {
      const run = runs.start(id); starts++;
      settleFixtureRequest(context, id, run.policy === "prepared_cloud" ? "cloud" : "planner");
      runs.recordCleanup(id, true);
      return runs.finish(id, "failed", run.policy === "prepared_cloud" ? "Worker stopped: agent_LimitsExceeded" : "Worker stopped: routing_plan_invalid");
    };
    await runRoutingComparisonScreen({ ...optionsFor(context), controllerForArm: () => controller,
      evaluate: async () => { throw new Error("no submitted artifacts"); } });
    expect(starts).toBe(12);
    for (const row of screen.assignments(manifest.screenId)) {
      expect(JSON.parse(row.evaluation_json!)).toMatchObject({ status: "not_scorable",
        reason: row.arm === "C" ? "runtime_budget:agent_LimitsExceeded" : "runtime_model_output:routing_plan_invalid" });
    }
    expect(screen.blocks(manifest.screenId).every(block => block.state === "completed")).toBe(true);
    expect(patchCampaignExposure(context.db).microusd).toBe(6000);
  });

  it("retains precise planner failures in the complete SQLite cohort without retry on replay", async () => {
    const context = await setupDevelopment(), { runs, screen, manifest } = context;
    const seen: PatchRunCreateInput[] = [], controller = controllerFor(context, seen);
    const errors = ["response", "schema", "plan", "source", "count", "syntax"]
      .map(code => `Worker stopped: routing_plan_rejected:planner_checks_${code}`);
    let starts = 0, planners = 0;
    controller.start = id => {
      const run = runs.start(id); starts++;
      settleFixtureRequest(context, id, run.policy === "prepared_cloud" ? "cloud" : "planner");
      runs.recordCleanup(id, true);
      return runs.finish(id, "failed", run.policy === "prepared_cloud"
        ? "Worker stopped: agent_LimitsExceeded" : errors[planners++]!);
    };
    const options = { ...optionsFor(context), controllerForArm: () => controller,
      evaluate: async () => { throw new Error("No submitted artifact can be evaluated"); } };
    await runRoutingComparisonScreen(options);
    const rows = screen.assignments(manifest.screenId);
    expect(rows).toHaveLength(12);
    expect(planners).toBe(6); expect(starts).toBe(12); expect(seen).toHaveLength(12);
    for (const row of rows) {
      const snapshot = runs.get(row.run_id!);
      expect(snapshot).toMatchObject({ status: "failed", spentMicrousd: 500, reservedMicrousd: 0, cleanupConfirmed: true });
      expect(snapshot.patch).toBeUndefined(); expect(snapshot.cloudPlan).toBeUndefined();
      expect(runs.replay(row.run_id!)).toEqual(snapshot);
      expect(JSON.parse(row.evaluation_json!)).toMatchObject({ status: "not_scorable", patchSha256: null,
        reason: row.arm === "C" ? "runtime_budget:agent_LimitsExceeded"
          : `runtime_model_output:${snapshot.error!.slice("Worker stopped: ".length)}` });
    }
    expect(screen.blocks(manifest.screenId).every(block => block.state === "completed")).toBe(true);
    expect(patchCampaignExposure(context.db).microusd).toBe(6000);
    await runRoutingComparisonScreen(options);
    expect(starts).toBe(12); expect(seen).toHaveLength(12);
    expect(screen.assignments(manifest.screenId)).toEqual(rows);
  });

  it("preserves V1 terminal infrastructure handling without adding the V2 stop behavior", async () => {
    const context = await setup(), controller = controllerFor(context), abort = new AbortController();
    controller.start = id => { context.runs.start(id); context.runs.recordCleanup(id, true);
      return context.runs.finish(id, "failed", "Coding worker exited without a durable terminal state."); };
    await runRoutingComparisonScreen({ ...optionsFor(context), controller, signal: abort.signal, progress: () => abort.abort(),
      evaluate: async () => { throw new Error("not eligible"); } });
    const row = context.screen.assignments(context.manifest.screenId).find(value => value.evaluation_json)!;
    expect(JSON.parse(row.evaluation_json!)).toEqual({ status: "not_scorable", patchSha256: null,
      oracleSha256: context.manifest.tasks[0]!.oracle.sha256, reason: "no_complete_submission" });
  });

  it("builds the frozen V2 profile from actual local Git source and binds the new helper only for V2", async () => {
    const context = await setupDevelopment(), repository = path.join(context.directory, "repository");
    await mkdir(repository);
    const git = async (...args: string[]) => (await promisify(execFile)("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args],
      { cwd: repository, env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_COUNT: "0" } })).stdout.trim();
    await git("init", "-q"); await writeFile(path.join(repository, "example.py"), "old\n"); await git("add", "example.py");
    await git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "public fixture");
    const revision = await git("rev-parse", "HEAD");
    context.manifest.tasks = context.manifest.tasks.map(task => ({ ...task, source: { ...task.source, root: repository, revision, files: 1, bytes: 4 },
      baselineReceipt: { ...task.baselineReceipt, sourceRevision: revision }, referenceReceipt: { ...task.referenceReceipt, sourceRevision: revision } }));
    context.manifest.evaluatorSha256 = digest(await readFile("scripts/evaluate-patch-screen.py"));
    const current = await routingComparisonConfiguration(context.base, process.cwd(), context.manifest, context.configuration.taskContracts);
    expect(current.limitsByArm).toEqual(context.configuration.limitsByArm);
    expect(current.codeHashes["runtime/patch-worker/planner_checks.py"]).toBe(digest(await readFile("runtime/patch-worker/planner_checks.py")));
    expect(canonicalRequest(current)).not.toContain("test-cloud-private");
    const admission = { receiptSha256: "f".repeat(64), priorCampaignExposureMicrousd: 13_000_000, priorRunCount: 42 };
    const withHistory = await routingComparisonConfiguration(context.base, process.cwd(), context.manifest, context.configuration.taskContracts, [], admission);
    expect(withHistory).toEqual({ ...current, historicalAdmission: admission });
    expect(current).not.toHaveProperty("historicalAdmission");
    const legacy = await setup();
    legacy.manifest.image = context.manifest.image; legacy.manifest.evaluatorSha256 = context.manifest.evaluatorSha256;
    legacy.manifest.tasks = Array.from({ length: 12 }, (_, index) => ({ ...context.manifest.tasks[index % 6]!, taskId: `legacy-${index}` }));
    const contracts = legacy.manifest.tasks.map(task => ({ ...context.configuration.taskContracts[0]!, taskId: task.taskId }));
    const old = await routingComparisonConfiguration(context.base, process.cwd(), legacy.manifest, contracts);
    expect(old).toMatchObject({ schemaVersion: 1, kind: "routing-comparison-v1", policyByArm: ROUTING_POLICIES });
    expect(old.codeHashes).not.toHaveProperty("runtime/patch-worker/planner_checks.py");
    expect(old.limitsByArm.P).not.toHaveProperty("plannerMode");
    expect(old.limitsByArm.P.localCoding?.checkSchedule).toBe("final_only");
    context.manifest.tasks[0]!.source.bytes++;
    await expect(routingComparisonConfiguration(context.base, process.cwd(), context.manifest, context.configuration.taskContracts)).rejects.toThrow(/Pinned source changed/);
  });
});

describe("fresh C/L/E/P routing comparison", () => {
  it("accepts current default runtime limits without rewriting historical frozen profiles", async () => {
    const { manifest, configuration, screen } = await setup();
    const historical = canonicalRequest(configuration);
    expect(canonicalRequest(RoutingComparisonConfigurationSchema.parse(configuration))).toBe(historical);
    const current = { ...configuration, limitsByArm: Object.fromEntries(ROUTING_ARMS.map(arm => [arm,
      patchPolicyLimits({ ...nativeRuntime, maxOutputTokens: 8192, maxInputBytes: 256000 }, ROUTING_POLICIES[arm])])) };
    const parsed = RoutingComparisonConfigurationSchema.parse(current);
    for (const arm of ["L", "E", "P"] as const) {
      expect(parsed.limitsByArm[arm].localCoding).toMatchObject({ thinking: "disabled", checkSchedule: "final_only" });
    }
    expect(() => screen.freeze(manifest, parsed)).not.toThrow();
    // V1 remains the declared default-profile comparison. Experimental settings
    // need a distinct freeze, never an implicit reinterpretation of old records.
    for (const change of [{ thinking: "medium" }, { checkSchedule: "repair_window" }]) {
      const altered = structuredClone(current);
      Object.assign(altered.limitsByArm.L!.localCoding!, change);
      expect(() => RoutingComparisonConfigurationSchema.parse(altered)).toThrow();
    }
    expect(canonicalRequest(configuration)).toBe(historical);
  });

  it("adds migration8 and balances every arm at every position exactly3times", async () => {
    const { db, manifest, configuration, screen } = await setup();
    expect(listAppliedDatabaseMigrations(db).at(-1)).toMatchObject({ version: 8, name: "patch-routing-comparison-v1" });
    const blocks = balancedRoutingBlocks(manifest);
    expect(blocks).toEqual(balancedRoutingBlocks(manifest));
    expect(new Set(blocks.map((block) => block.taskId)).size).toBe(12);
    for (const arm of ROUTING_ARMS) for (let position = 0; position < 4; position++) expect(blocks.filter((block) => block.order[position] === arm)).toHaveLength(3);
    screen.freeze(manifest, configuration); expect(screen.assignments(manifest.screenId)).toHaveLength(48);
    expect(() => screen.freeze(manifest, { ...configuration, concurrency: 2 } as unknown as RoutingComparisonConfiguration)).toThrow();
    expect(() => db.prepare("DELETE FROM patch_routing_screens").run()).toThrow(/immutable/);
    expect(() => db.prepare("UPDATE patch_routing_blocks SET arm_order = '[]'").run()).toThrow(/monotonic/);
  });

  it("rejects configuration/source/contract drift and stores no private artifact paths or raw receipts", async () => {
    const { db, manifest, configuration, screen, directory } = await setup();
    screen.freeze(manifest, configuration);
    const frozen = (db.prepare("SELECT frozen_json FROM patch_routing_screens").get() as { frozen_json: string }).frozen_json;
    expect(frozen).not.toContain(directory); expect(frozen).not.toContain("private-evaluator"); expect(frozen).not.toContain("baselineReceipt");
    expect(() => screen.freeze(manifest, { ...configuration, local: { ...configuration.local, apiKey: "must-not-persist" } } as unknown as RoutingComparisonConfiguration)).toThrow();
    expect(() => screen.freeze(manifest, { ...configuration, codeHashes: { ...configuration.codeHashes, "runtime/patch-worker/native_local.py": "f".repeat(64) } })).toThrow(/cannot change/);
    const altered = structuredClone(configuration); altered.taskContracts[0]!.allowedFiles.push("../escape.py");
    expect(() => screen.freeze(manifest, altered)).toThrow();
  });

  it("reserves a whole$9block globally, includes calibration and unknowns, and does not rewrite legacy blocks", async () => {
    const context = await setup(), { db, manifest, configuration, runs, screen } = context;
    const prior = runs.create({ workspaceRoot: "/public", objective: "earlier calibration", policy: "prepared_cloud", executionMode: "live", baseRevision: "b".repeat(40), maxCostMicrousd: 150_000_000 });
    runs.start(prior.id); runs.reserveRequest(prior.id, { requestId: "prior", amountMicrousd: 132_000_000, providerLabel: "OpenAI", campaignLimitMicrousd: 150_000_000 });
    runs.startRequest(prior.id, "prior"); runs.finishRequest(prior.id, { requestId: "prior", outcome: "unknown" }); runs.finish(prior.id, "failed");
    const legacy = new ComparisonStore(db); legacy.freeze(manifest, {}); legacy.reserveBlock(manifest.screenId, legacy.blocks(manifest.screenId)[0]!.task_id, 150_000_000);
    const original = db.prepare("SELECT * FROM patch_comparison_screens").all();
    screen.freeze(manifest, configuration); screen.reserveBlock(manifest.screenId, screen.blocks(manifest.screenId)[0]!.task_id);
    expect(patchCampaignExposure(db).microusd).toBe(150_000_000);
    expect(() => screen.reserveBlock(manifest.screenId, screen.blocks(manifest.screenId)[1]!.task_id)).toThrow(/capacity/);
    expect(db.prepare("SELECT * FROM patch_comparison_screens").all()).toEqual(original);
  });

  it("blocks requests before claims, wrong policies, local cloud/paid admission, and wrong campaign ceilings", async () => {
    const context = await setup(), { manifest, configuration, screen, runs } = context;
    screen.freeze(manifest, configuration); const block = screen.blocks(manifest.screenId)[0]!;
    expect(() => screen.claimDispatch(manifest.screenId, block.task_id, "L")).toThrow();
    screen.reserveBlock(manifest.screenId, block.task_id); screen.claimDispatch(manifest.screenId, block.task_id, "L");
    expect(() => screen.link(manifest.screenId, block.task_id, "L", createRun(context, "C").id)).toThrow(/policy/);
    const local = createRun(context, "L"); screen.link(manifest.screenId, block.task_id, "L", local.id); runs.start(local.id);
    const input = { requestId: "local", amountMicrousd: 0, providerLabel: "local · model", campaignLimitMicrousd: 150_000_000, phase: "local" as const };
    expect(() => runs.reserveRequest(local.id, { ...input, amountMicrousd: 1 })).toThrow(/local-only/);
    expect(() => runs.reserveRequest(local.id, { ...input, phase: "cloud", providerLabel: "OpenAI · model" })).toThrow(/local-only/);
    expect(() => runs.reserveRequest(local.id, { ...input, campaignLimitMicrousd: 180_000_000 })).toThrow(/claimed block/);
    expect(() => runs.reserveRequest(local.id, input)).not.toThrow();
  });

  it("uses the shared controller for48assignments and resumes without new requests or evaluations", async () => {
    const context = await setup(), seen: PatchRunCreateInput[] = [];
    const options = optionsFor(context); options.controller = controllerFor(context, seen);
    let evaluations = 0; const evaluate = options.evaluate; options.evaluate = async (...args) => { evaluations++; return evaluate(...args); };
    await runRoutingComparisonScreen(options); await runRoutingComparisonScreen(options);
    expect(seen).toHaveLength(48); expect(evaluations).toBe(48);
    expect(new Set(seen.map((input) => input.policy))).toEqual(new Set(Object.values(ROUTING_POLICIES)));
    expect(seen.every((input) => input.episodeBudgetUsd === 3)).toBe(true);
    for (const task of context.manifest.tasks) {
      const expected = routingObjective(task, context.configuration.taskContracts.find((item) => item.taskId === task.taskId)!);
      expect(seen.filter((input) => input.objective === expected)).toHaveLength(4);
    }
    expect(JSON.stringify(seen)).not.toMatch(/oracle|reference|private-evaluator/);
    expect(context.screen.blocks(context.manifest.screenId).every((block) => block.state === "completed")).toBe(true);
    expect(patchCampaignExposure(context.db).microusd).toBe(18_000);
    expect(context.screen.assignments(context.manifest.screenId).filter((row) => row.arm === "L").every((row) => context.runs.get(row.run_id!).spentMicrousd === 0)).toBe(true);
  });

  it("never repeats a dispatch claim lost before run creation", async () => {
    const context = await setup(), { screen, manifest, configuration } = context;
    screen.freeze(manifest, configuration); const block = screen.blocks(manifest.screenId)[0]!, arm = JSON.parse(block.arm_order)[0] as RoutingArm;
    screen.reserveBlock(manifest.screenId, block.task_id); screen.claimDispatch(manifest.screenId, block.task_id, arm);
    const options = optionsFor(context); let created = 0; options.controller.create = async () => { created++; throw new Error("must not create"); };
    await expect(runRoutingComparisonScreen(options)).rejects.toThrow(/interrupted before linking/);
    await expect(runRoutingComparisonScreen(options)).rejects.toThrow(/Frozen routing error/);
    expect(created).toBe(0); expect(patchCampaignExposure(context.db).microusd).toBe(9_000_000);
  });

  it("cancels a linked created run after a crash and never starts it", async () => {
    const context = await setup(), { screen, manifest, configuration, runs } = context;
    screen.freeze(manifest, configuration); const block = screen.blocks(manifest.screenId)[0]!, arm = JSON.parse(block.arm_order)[0] as RoutingArm;
    screen.reserveBlock(manifest.screenId, block.task_id); screen.claimDispatch(manifest.screenId, block.task_id, arm);
    const run = createRun(context, arm); screen.link(manifest.screenId, block.task_id, arm, run.id);
    const options = optionsFor(context), abort = new AbortController(); let starts = 0;
    options.controller.start = () => { starts++; throw new Error("no start"); };
    options.controller.waitForRun = async (id) => { abort.abort(); return runs.get(id); };
    await expect(runRoutingComparisonScreen({ ...options, signal: abort.signal })).rejects.toThrow(/cleanup is unconfirmed/);
    expect(starts).toBe(0); expect(runs.get(run.id).status).toBe("cancelled");
    expect(JSON.parse(screen.assignments(manifest.screenId).find((row) => row.run_id === run.id)!.evaluation_json!)).toMatchObject({ status: "error", reason: "cleanup_unconfirmed" });
  });

  it("retains a one-use evaluator claim without replay after a crash", async () => {
    const context = await setup(), { screen, manifest, configuration, runs, db } = context;
    screen.freeze(manifest, configuration); const block = screen.blocks(manifest.screenId)[0]!, arm = JSON.parse(block.arm_order)[0] as RoutingArm;
    screen.reserveBlock(manifest.screenId, block.task_id); screen.claimDispatch(manifest.screenId, block.task_id, arm);
    const run = createRun(context, arm); screen.link(manifest.screenId, block.task_id, arm, run.id); runs.start(run.id);
    runs.recordCleanup(run.id, true); runs.finish(run.id, "failed");
    screen.claimEvaluation(manifest.screenId, block.task_id, arm);
    expect(() => db.prepare("DELETE FROM patch_routing_evaluation_claims").run()).toThrow(/append-only/);
    let evaluated = 0; const options = optionsFor(context); options.evaluate = async () => { evaluated++; throw new Error("no replay"); };
    await expect(runRoutingComparisonScreen(options)).rejects.toThrow(/evaluator outcome is unknown/);
    await expect(runRoutingComparisonScreen(options)).rejects.toThrow(/Frozen routing error/); expect(evaluated).toBe(0);
  });

  it("stops on unknown local requests even when their dollar reservation is zero", async () => {
    const context = await setup(), options = optionsFor(context), { runs } = context;
    for (let seed = 0; balancedRoutingBlocks(context.manifest)[0]!.order[0] !== "L"; seed++) context.manifest.seed = String(seed);
    context.configuration.manifestSha256 = digest(canonicalRequest(context.manifest));
    options.controller.start = (id) => {
      runs.start(id); const local = runs.get(id).policy === "local_only";
      runs.reserveRequest(id, { requestId: id, amountMicrousd: local ? 0 : 100, providerLabel: local ? "local · model" : "OpenAI", phase: local ? "local" : "cloud", campaignLimitMicrousd: 150_000_000 });
      runs.startRequest(id, id); runs.finishRequest(id, { requestId: id, outcome: "unknown" }); runs.recordCleanup(id, true); return runs.finish(id, "failed");
    };
    let evaluated = 0; options.evaluate = async () => { evaluated++; throw new Error("not scorable"); };
    await expect(runRoutingComparisonScreen(options)).rejects.toThrow(/Provider outcome is unknown/);
    await expect(runRoutingComparisonScreen(options)).rejects.toThrow(/Frozen routing error/); expect(evaluated).toBe(0);
  });

  it("rejects incomplete or infrastructure evaluator receipts and retains their claim", async () => {
    const context = await setup(), options = optionsFor(context); let evaluations = 0;
    options.evaluate = async (task) => { evaluations++; return { ...task.referenceReceipt, testCount: 0, passed: 0 }; };
    await expect(runRoutingComparisonScreen(options)).rejects.toThrow(/Independent evaluation failed/);
    await expect(runRoutingComparisonScreen(options)).rejects.toThrow(/Frozen routing error/); expect(evaluations).toBe(1);
  });

  it("records trusted candidate import failures as failures without treating them as infrastructure", async () => {
    const context = await setup(), options = optionsFor(context), abort = new AbortController();
    options.evaluate = async (task, patchPath) => {
      const assignment = context.screen.assignments(context.manifest.screenId).find((row) => row.run_id && patchPath.includes(row.run_id))!;
      abort.abort();
      return { ...receipt(context, task, context.runs.get(assignment.run_id!).patch!.sha256), exitCode: 1,
        harnessVerified: false, testCount: undefined, passed: undefined, failureKind: "candidate" };
    };
    await runRoutingComparisonScreen({ ...options, signal: abort.signal });
    const scored = context.screen.assignments(context.manifest.screenId).filter((row) => row.evaluation_json);
    expect(scored).toHaveLength(1); expect(JSON.parse(scored[0]!.evaluation_json!)).toMatchObject({ status: "scored", receipt: { exitCode: 1, failureKind: "candidate" } });
  });

  it("retains recovered unfinished patches without invoking independent acceptance", async () => {
    const context = await setup(), options = optionsFor(context), abort = new AbortController(), { runs } = context;
    options.controller.start = (id) => {
      runs.start(id); const text = "diff --git a/example.py b/example.py\n";
      runs.recordPatch(id, { kind: "recovered", text, sha256: digest(text), files: ["example.py"], truncated: false });
      runs.recordCleanup(id, true);
      return runs.finish(id, "failed");
    };
    options.controller.waitForRun = async (id) => { abort.abort(); return runs.get(id); };
    let evaluations = 0; options.evaluate = async () => { evaluations++; throw new Error("unfinished"); };
    await runRoutingComparisonScreen({ ...options, signal: abort.signal });
    expect(evaluations).toBe(0);
    const row = context.screen.assignments(context.manifest.screenId).find((item) => item.evaluation_json)!;
    expect(JSON.parse(row.evaluation_json!)).toMatchObject({ status: "not_scorable", reason: "unfinished_recovered_artifact" });
  });

  it.each([
    { name: "ordinary edit", patch: PATCH, allowed: ["example.py"], valid: true, changed: ["example.py"] },
    { name: "deletion", patch: "diff --git a/gone.py b/gone.py\ndeleted file mode 100644\n--- a/gone.py\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n", allowed: ["gone.py"], valid: true, changed: ["gone.py"] },
    { name: "mode-only edit", patch: "diff --git a/example.py b/example.py\nold mode 100644\nnew mode 100755\n", allowed: ["example.py"], valid: true, changed: ["example.py"] },
    { name: "rename protected origin", patch: "diff --git a/protected.py b/new.py\nsimilarity index 100%\nrename from protected.py\nrename to new.py\n", allowed: ["new.py"], valid: false, changed: ["new.py", "protected.py"] },
    { name: "quoted rename", patch: "diff --git \"a/old name.py\" \"b/new name.py\"\nsimilarity index 100%\nrename from old name.py\nrename to new name.py\n", allowed: ["old name.py", "new name.py"], valid: true, changed: ["new name.py", "old name.py"] },
    { name: "Git octal quoted Unicode", patch: "diff --git \"a/caf\\303\\251.py\" \"b/caf\\303\\251.py\"\nold mode 100644\nnew mode 100755\n", allowed: ["café.py"], valid: true, changed: ["café.py"] },
    { name: "existing test edit", patch: PATCH.replaceAll("example.py", "tests/test_existing.py"), allowed: ["example.py", "tests/test_new.py"], valid: false, changed: ["tests/test_existing.py"] },
    { name: "malformed hunk", patch: PATCH.replace("@@ -1 +1 @@", "@@ -1,2 +1,2 @@"), allowed: ["example.py"], valid: false, changed: [] },
    { name: "unsafe path", patch: PATCH.replaceAll("example.py", "../escape.py"), allowed: ["example.py"], valid: false, changed: [] },
    { name: "unsupported binary header", patch: "diff --git a/data.bin b/data.bin\nindex abc123..def456 100644\nBinary files a/data.bin and b/data.bin differ\n", allowed: ["data.bin"], valid: false, changed: [] },
    { name: "unsupported symlink", patch: "diff --git a/example.py b/example.py\nold mode 100644\nnew mode 120000\n", allowed: ["example.py"], valid: false, changed: [] },
    { name: "ignored trailing material", patch: `${PATCH}unexpected trailing material\n`, allowed: ["example.py"], valid: false, changed: [] },
  ])("validates scope for $name from actual Git metadata", async ({ patch, allowed, valid, changed }) => {
    const result = await inspectRoutingPatchScope(patch, allowed);
    expect(result.valid).toBe(valid); expect(result.changedPaths).toEqual(changed);
  });

  it("records out-of-scope edits as candidate failures without calling the oracle", async () => {
    const context = await setup(), options = optionsFor(context), abort = new AbortController();
    options.controller = controllerFor(context, [], PATCH.replaceAll("example.py", "tests/test_existing.py"));
    let evaluated = 0; options.evaluate = async () => { evaluated++; throw new Error("protected patch must not reach oracle"); };
    await runRoutingComparisonScreen({ ...options, signal: abort.signal, progress: () => abort.abort() });
    expect(evaluated).toBe(0);
    const row = context.screen.assignments(context.manifest.screenId).find((item) => item.evaluation_json)!;
    expect(JSON.parse(row.evaluation_json!)).toMatchObject({ status: "not_scorable", reason: "candidate_scope_failure",
      scope: { valid: false, reason: "outside_allowed_paths", changedPaths: ["tests/test_existing.py"] } });
    expect(context.screen.hasEvaluationClaim(context.manifest.screenId, row.task_id, row.arm)).toBe(false);
  });

  it.each([undefined, false])("stops the stage when terminal cleanup is %s", async (confirmed) => {
    const context = await setup(), options = optionsFor(context); let starts = 0, evaluated = 0;
    options.controller.start = (id) => {
      starts++; context.runs.start(id);
      if (confirmed !== undefined) context.runs.recordCleanup(id, confirmed);
      return context.runs.finish(id, "failed");
    };
    options.evaluate = async () => { evaluated++; throw new Error("no cleanup proof"); };
    await expect(runRoutingComparisonScreen(options)).rejects.toThrow(/cleanup is unconfirmed/);
    await expect(runRoutingComparisonScreen(options)).rejects.toThrow(/Frozen routing error/);
    expect(starts).toBe(1); expect(evaluated).toBe(0);
    expect(patchCampaignExposure(context.db).microusd).toBe(9_000_000);
  });

  it("rechecks cleanup for already-evaluated completed blocks on resume", async () => {
    const context = await setup(), { manifest, configuration, screen, runs, db } = context;
    screen.freeze(manifest, configuration); const block = screen.blocks(manifest.screenId)[0]!;
    screen.reserveBlock(manifest.screenId, block.task_id);
    for (const arm of ROUTING_ARMS) {
      screen.claimDispatch(manifest.screenId, block.task_id, arm);
      const run = createRun(context, arm); screen.link(manifest.screenId, block.task_id, arm, run.id); runs.start(run.id); runs.finish(run.id, "failed");
      const result = { status: "not_scorable" as const, patchSha256: null, oracleSha256: manifest.tasks[0]!.oracle.sha256, reason: "no_complete_submission" };
      expect(() => screen.evaluated(manifest.screenId, block.task_id, arm, result)).toThrow(/cleanup/);
      // Simulate a historical caller that bypassed the current store boundary.
      db.prepare("UPDATE patch_routing_assignments SET evaluation_json = ? WHERE run_id = ?").run(JSON.stringify(result), run.id);
    }
    screen.completeBlock(manifest.screenId, block.task_id);
    await expect(runRoutingComparisonScreen(optionsFor(context))).rejects.toThrow(/Frozen assignment cleanup is unconfirmed/);
  });

  it("stops on an evaluator receipt with the wrong original source tree", async () => {
    const context = await setup(), options = optionsFor(context); let evaluated = 0;
    const evaluate = options.evaluate;
    options.evaluate = async (...args) => { evaluated++; return { ...(await evaluate(...args) as object), sourceTreeSha256: "f".repeat(64) }; };
    await expect(runRoutingComparisonScreen(options)).rejects.toThrow(/Independent evaluation failed/);
    await expect(runRoutingComparisonScreen(options)).rejects.toThrow(/Frozen routing error/); expect(evaluated).toBe(1);
  });
});
