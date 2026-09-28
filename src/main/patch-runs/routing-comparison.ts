import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { SoarDatabase } from "../database";
import { localCodingLimits, patchPolicyLimits, providerLimits, type PatchRuntimeConfig } from "./config";
import { canonicalRequest } from "./native-contract";
import { inspectRoutingPatchScope, type RoutingPatchScope } from "./patch-scope";
export { inspectRoutingPatchScope, type RoutingPatchScope } from "./patch-scope";
import { patchCampaignExposure } from "./comparison-schema";
import { ComparisonManifestSchema, ComparisonTaskSchema, EvaluationReceiptSchema, digest, validateComparisonSources, validateComparisonManifestReceipts,
  type ComparisonManifest, type ComparisonTask, type ComparisonEvaluation } from "./comparison";
import type { PatchRunController } from "./controller";
import { PatchRunStore } from "./store";
import { isPatchRunTerminal, type PatchRunSnapshot } from "../../shared/patch-run-contracts";

export const ROUTING_ARMS = ["C", "L", "E", "P"] as const;
export const ROUTING_DEVELOPMENT_ARMS = ["C", "P"] as const;
export type RoutingArm = typeof ROUTING_ARMS[number];
export const ROUTING_POLICIES = { C: "prepared_cloud", L: "local_only", E: "local_first", P: "cloud_plan_local" } as const;
export const ROUTING_STAGE_MICROUSD = 150_000_000;
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const relativeFile = z.string().min(1).max(4096).refine((value) => !value.includes("\\") &&
  !/[\u0000-\u001f]/u.test(value) && value.split("/").every((part) => part && part !== "." && part !== ".."), "Expected an exact relative file path.");
export const RoutingTaskContractSchema = z.object({
  taskId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/u),
  allowedFiles: z.array(relativeFile).min(1).max(1000), sourceTreeSha256: sha,
  expectedTests: z.number().int().positive().safe(),
}).strict();
export type RoutingTaskContract = z.infer<typeof RoutingTaskContractSchema>;

/** A separate development cohort, never a smaller reinterpretation of V1. */
export const RoutingDevelopmentManifestSchema = z.object({
  ...ComparisonManifestSchema.shape,
  schemaVersion: z.literal(2), kind: z.literal("routing-public-checks-development-v2"), studyKind: z.literal("development"),
  tasks: z.array(ComparisonTaskSchema).length(6),
}).strict().superRefine((manifest, ctx) => {
  if (new Set(manifest.tasks.map(task => task.taskId)).size !== 6) ctx.addIssue({ code: "custom", message: "Task IDs must be unique." });
  if (new Set(manifest.tasks.map(task => task.source.url)).size < 3) ctx.addIssue({ code: "custom", message: "Screen requires at least three repositories." });
  validateComparisonManifestReceipts(manifest, ctx);
});
export const RoutingManifestSchema = z.union([ComparisonManifestSchema, RoutingDevelopmentManifestSchema]);
export type RoutingDevelopmentManifest = z.infer<typeof RoutingDevelopmentManifestSchema>;
export type RoutingManifest = z.infer<typeof RoutingManifestSchema>;

/** Identical public scope instructions for every arm. This builder is covered
 * by the frozen runtime hash and each frozen task's solverObjectiveSha256. */
export function routingObjective(task: Pick<ComparisonTask, "objective">, contract: RoutingTaskContract): string {
  const objective = `${task.objective.trim()}\n\nFile scope for this task: you may change only these exact repository-relative paths, including additions, deletions, and both endpoints of a rename. Keep every other file unchanged, including existing tests outside this list.\nAllowed paths (JSON): ${JSON.stringify(contract.allowedFiles)}`;
  if (objective.length > 20_000) throw new Error("Scoped solver objective exceeds the shared admission limit.");
  return objective;
}

export interface RoutingComparisonEvaluation extends ComparisonEvaluation {
  scope?: RoutingPatchScope;
  /** Independent evaluation of a failed runtime submission is diagnostic only. */
  kind?: "diagnostic";
}

export interface RoutingRuntimeFailure {
  kind: "budget" | "model_output" | "checks" | "cancelled" | "infrastructure" | "unclassified";
  code: string;
  stop: boolean;
}
const WORKER_INFRASTRUCTURE_FAILURES: Readonly<Record<string, string>> = {
  "Coding worker exited without a durable terminal state.": "worker_durable_terminal_missing",
  "Coding worker exited without a terminal receipt.": "worker_terminal_missing",
  "Worker input channel closed.": "worker_input_closed",
  "Worker output exceeded the protocol limit.": "worker_output_limit",
  "Worker diagnostic output exceeded its limit.": "worker_diagnostic_limit",
  "Worker exited with an incomplete protocol frame.": "worker_frame_incomplete",
  "Coding worker could not start. Run the pilot setup command.": "worker_start_failed",
  "Coding worker did not exit successfully.": "worker_exit_failed",
  "Coding worker protocol failed.": "worker_protocol_failed",
  "Coding worker finalization failed.": "worker_finalization_failed",
  "Worker completion did not match the host check receipt.": "worker_completion_mismatch",
  "Coding run exceeded its total time limit.": "worker_watchdog_expired",
  "Worker stopped: container_command_failed": "container_command_failed",
  "Worker stopped: container_output_drain_failed": "container_output_drain_failed",
  "Worker stopped: invalid_container_identity": "invalid_container_identity",
  "Worker stopped: invalid_container_baseline": "invalid_container_baseline",
  "Worker stopped: routing_checkpoint_source_changed": "routing_checkpoint_source_changed",
};
// Only response-side parser errors are model-output failures. Request/history,
// usage, source, admission and arbitrary routing_* errors are not allowlisted.
const NATIVE_MODEL_OUTPUT_FAILURES = new Set([
  "native_response_schema", "native_choice_count", "native_output_truncated", "native_output_at_token_cap",
  "native_assistant_message", "native_legacy_function_call", "native_refusal", "native_content_type",
  "native_output_format", "native_output_empty", "native_call_count", "native_call_type", "native_call_id",
  "native_call_id_reused", "native_function_schema", "native_function_name", "native_arguments_json",
  "native_arguments_schema", "native_help_reason", "native_command", "native_finish_reason",
].map(code => `Worker stopped: routing_${code}`));

const PLANNER_MODEL_OUTPUT_FAILURES = new Set([
  "Worker stopped: routing_plan_invalid",
  "Worker stopped: PlannerChecksError", // Preserve interpretation of historical class-only errors.
  ...[
    "planner_checks_response", "planner_checks_schema", "planner_checks_plan",
    "planner_checks_source", "planner_checks_count", "planner_checks_syntax",
    "planner_checks_declarations",
  ].map(code => `Worker stopped: routing_plan_rejected:${code}`),
]);

/** Classify a persisted terminal outcome, not candidate quality. The runner also
 * requires confirmed cleanup and no pending/unknown requests before using this.
 * Exact worker strings plus phase/receipt evidence distinguish bounded model
 * failures from infrastructure. Unrecognized failures stop without guessing. */
export function classifyRoutingRuntimeFailure(run: PatchRunSnapshot): RoutingRuntimeFailure | null {
  if (!isPatchRunTerminal(run.status) || run.status === "completed") return null;
  const classified = (kind: RoutingRuntimeFailure["kind"], code: string, stop = false): RoutingRuntimeFailure => ({ kind, code, stop });
  if (run.status === "cancelled" || run.status === "interrupted") return classified("cancelled", run.status, true);
  if (run.status === "blocked") return classified("infrastructure", "runtime_blocked", true);
  const error = run.error ?? "";
  if (Object.hasOwn(WORKER_INFRASTRUCTURE_FAILURES, error)) return classified("infrastructure", WORKER_INFRASTRUCTURE_FAILURES[error]!, true);
  const settled = (phase: "cloud" | "local" | "planner") => {
    const usage = run.phaseUsage?.[phase];
    return Boolean(usage && usage.requestCount > 0 && usage.usageReceipts === usage.requestCount &&
      usage.unknownRequests === 0 && usage.reservedMicrousd === 0);
  };
  const checkpoint = run.checkpoint;
  const stoppedFor = (reason: string) => checkpoint?.policy === run.policy && checkpoint.decision === "stop" && checkpoint.state === "stopped" && checkpoint.reason === reason;
  if (settled("cloud") && (error === "Worker stopped: agent_LimitsExceeded" || error === "Worker stopped: agent_TimeExceeded")) {
    return classified("budget", error.slice("Worker stopped: ".length));
  }
  if ((error === "Worker stopped: routing_insufficient_model_calls" && stoppedFor("insufficient_model_calls")) ||
      (error === "Worker stopped: routing_insufficient_handoff_time" && stoppedFor("insufficient_handoff_time")) ||
      ((error === "Worker stopped: run_deadline_exceeded" || error === "Worker stopped: routing_request_deadline_reserve") && stoppedFor("episode_deadline"))) {
    return classified("budget", error.slice("Worker stopped: ".length));
  }
  if ((settled("cloud") && error === "Worker stopped: agent_RepeatedFormatError") ||
      (settled("planner") && run.phaseUsage?.planner?.requestCount === 1 && !run.cloudPlan &&
        PLANNER_MODEL_OUTPUT_FAILURES.has(error)) ||
      (settled("local") && stoppedFor("protocol_failure") && checkpoint?.localCalls === run.phaseUsage?.local?.requestCount &&
        NATIVE_MODEL_OUTPUT_FAILURES.has(error)) ||
      ((settled("cloud") || settled("local") || settled("planner")) &&
        (error === "Worker stopped: provider_output_empty" || error === "Worker stopped: provider_output_truncated"))) {
    return classified("model_output", error.slice("Worker stopped: ".length));
  }
  const artifact = run.cloudPlan?.checks, check = run.plannerCheck, result = check?.result;
  const visible = run.checkpointCheck;
  if (error === "Worker stopped: routing_check_timeout" && artifact && stoppedFor("check_timeout") &&
      checkpoint?.evidence.timedOut === true && checkpoint.evidence.completed === false && visible &&
      visible.command === run.checks.command && visible.exitCode === 124 && !visible.passed && visible.fresh &&
      visible.sourceSha256 === visible.sourceAfterSha256 && visible.sourceAfterSha256 === checkpoint.sourceSha256) {
    return classified("checks", "routing_check_timeout");
  }
  if (error === "Worker stopped: routing_planner_final_checks_failed" && run.policy === "cloud_plan_local" &&
      run.patch?.kind === "submitted" && !run.patch.truncated && artifact && check && result &&
      check.stage === "final" && check.fresh && !check.passed && !check.timedOut && !check.outputTruncated && check.exitCode === 1 &&
      artifact.sha256 === digest(artifact.source) && check.artifactSha256 === artifact.sha256 && result.sourceSha256 === artifact.sha256 &&
      check.sourceSha256 === check.sourceAfterSha256 && check.sourceSha256 === run.checks.sourceSha256 &&
      check.sourceSha256 === run.checks.sourceAfterSha256 && result.completed && result.status === "failed" &&
      result.expectedTests === artifact.expectedTests && result.discoveredTests === artifact.expectedTests && result.testsRun === artifact.expectedTests &&
      result.skipped === 0 && result.expectedFailures === 0 && result.unexpectedSuccesses === 0 && result.failures + result.errors > 0 &&
      result.passed + result.failures + result.errors === result.testsRun) {
    return classified("checks", "routing_planner_final_checks_failed");
  }
  return classified("unclassified", "terminal_failure_unclassified", true);
}
const provider = z.object({ id: z.string().min(1).max(100), protocol: z.literal("openai"), model: z.string().min(1).max(256),
  destinationSha256: sha, inputUsdPerMillion: z.number().nonnegative(), outputUsdPerMillion: z.number().nonnegative(),
  allowInsecureHttp: z.boolean(), maxOutputTokens: z.literal(8192), maxInputBytes: z.literal(256000) }).strict();
const limits = z.object({ stepLimit: z.literal(40), wallTimeSeconds: z.literal(600),
  commandTimeoutSeconds: z.literal(30), requestTimeoutSeconds: z.literal(120),
  maxOutputTokens: z.literal(8192), maxInputBytes: z.literal(256000), localStepLimit: z.literal(24).optional(),
  finishingReserve: z.literal(2).optional(), visibleCheckTimeoutSeconds: z.literal(60),
  // Optional literal defaults keep old frozen bytes valid while admitting the
  // explicit default fields returned by the current runtime. Experimental
  // profiles cannot silently enter this declared four-policy V1 comparison.
  localCoding: z.object({ maxOutputTokens: z.literal(8192), maxInputBytes: z.literal(256000),
    thinking: z.literal("disabled").optional(), checkSchedule: z.literal("final_only").optional() }).strict().optional() }).strict();
export const RoutingComparisonConfigurationSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal("routing-comparison-v1"), mode: z.literal("live"),
  manifestSha256: sha, image: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  policyByArm: z.object({ C: z.literal("prepared_cloud"), L: z.literal("local_only"), E: z.literal("local_first"), P: z.literal("cloud_plan_local") }).strict(),
  cloud: provider.extend({ id: z.literal("openai"), model: z.literal("gpt-5.6-sol"), inputUsdPerMillion: z.literal(4), outputUsdPerMillion: z.literal(20), allowInsecureHttp: z.literal(false) }),
  local: provider.extend({ id: z.literal("local"), inputUsdPerMillion: z.literal(0), outputUsdPerMillion: z.literal(0) }),
  episodeMicrousd: z.literal(3_000_000), campaignMicrousd: z.literal(150_000_000), blockMicrousd: z.literal(9_000_000),
  limitsByArm: z.object({ C: limits, L: limits, E: limits, P: limits }).strict(),
  cloudControls: z.object({ reasoningEffort: z.literal("medium"), serviceTier: z.literal("default"), promptCacheMode: z.literal("explicit_no_breakpoints") }).strict(),
  localControls: z.object({ enableThinking: z.literal(false), protocol: z.literal("native_coding"), parallelToolCalls: z.literal(false) }).strict(),
  concurrency: z.literal(1), taskContracts: z.array(RoutingTaskContractSchema).length(12), taskContractsSha256: sha,
  codeHashes: z.record(relativeFile, sha),
  localEconomics: z.object({ devicePurchaseUsd: z.literal(3500), perTokenApiFeeUsd: z.literal(0),
    ownership: z.literal("user_owned"), electricityAndUtilization: z.literal("unavailable") }).strict(),
}).strict();
export type RoutingComparisonConfiguration = z.infer<typeof RoutingComparisonConfigurationSchema>;
export const RoutingHistoricalAdmissionSchema = z.object({ receiptSha256: sha,
  priorCampaignExposureMicrousd: z.number().int().nonnegative().safe(), priorRunCount: z.number().int().nonnegative().safe() }).strict();
export type RoutingHistoricalAdmission = z.infer<typeof RoutingHistoricalAdmissionSchema>;
export const RoutingDevelopmentConfigurationSchema = RoutingComparisonConfigurationSchema.extend({
  schemaVersion: z.literal(2), kind: z.literal("routing-public-checks-development-v2"), studyKind: z.literal("development"),
  policyByArm: z.object({ C: z.literal("prepared_cloud"), P: z.literal("cloud_plan_local") }).strict(),
  limitsByArm: z.object({
    C: limits.omit({ localStepLimit: true, finishingReserve: true, localCoding: true }),
    P: limits.extend({ localStepLimit: z.literal(24), finishingReserve: z.literal(2), plannerMode: z.literal("plan_and_checks"),
      localCoding: z.object({ maxOutputTokens: z.literal(8192), maxInputBytes: z.literal(256000),
        thinking: z.literal("disabled"), checkSchedule: z.literal("host_repair_window") }).strict() }),
  }).strict(),
  taskContracts: z.array(RoutingTaskContractSchema).length(6),
  historicalAdmission: RoutingHistoricalAdmissionSchema.optional(),
});
export const RoutingConfigurationSchema = z.union([RoutingComparisonConfigurationSchema, RoutingDevelopmentConfigurationSchema]);
export type RoutingDevelopmentConfiguration = z.infer<typeof RoutingDevelopmentConfigurationSchema>;
export type RoutingConfiguration = z.infer<typeof RoutingConfigurationSchema>;

export function routingArms(configuration: RoutingConfiguration): readonly RoutingArm[] {
  return configuration.schemaVersion === 2 ? ROUTING_DEVELOPMENT_ARMS : ROUTING_ARMS;
}

/** The caller supplies the default comparator profile. Experiments are added
 * only to the declared V2 P arm, never silently replacing caller overrides. */
export function routingRuntimeConfigForArm(base: PatchRuntimeConfig, arm: RoutingArm, manifest: RoutingManifest): PatchRuntimeConfig {
  if ((base.localCodingMaxCalls !== undefined && base.localCodingMaxCalls !== 24) ||
      (base.localCodingThinking !== undefined && base.localCodingThinking !== "disabled") ||
      (base.localCodingCheckSchedule !== undefined && base.localCodingCheckSchedule !== "final_only") ||
      (base.plannerMode !== undefined && base.plannerMode !== "plan")) throw new Error("Routing comparison requires a default-compatible base profile.");
  if (!(manifest.schemaVersion === 2 ? ROUTING_DEVELOPMENT_ARMS : ROUTING_ARMS).some(value => value === arm)) throw new Error("Arm is not assigned by this routing manifest.");
  return manifest.schemaVersion === 2 && arm === "P"
    ? { ...base, plannerMode: "plan_and_checks", localCodingCheckSchedule: "host_repair_window" } : base;
}
export const ROUTING_COMPARISON_CODE_PATHS = [
  "runtime/patch-worker/worker.py", "runtime/patch-worker/runtime-lock.json", "runtime/patch-worker/native_local.py",
  "runtime/patch-worker/native-coding-contract.json", "runtime/patch-worker/coding_router.py",
  "runtime/patch-worker/coding_execution.py", "src/main/patch-runs/native-contract.ts",
  "src/main/patch-runs/worker.ts", "src/main/patch-runs/controller.ts", "src/main/patch-runs/store.ts",
  "src/main/patch-runs/config.ts", "src/main/patch-runs/workspace.ts", "src/main/patch-runs/comparison.ts",
  "src/main/patch-runs/comparison-schema.ts", "src/main/patch-runs/routing-comparison.ts",
  "src/main/patch-runs/routing-comparison-schema.ts", "src/shared/patch-run-contracts.ts", "src/main/database.ts",
  "scripts/evaluate-patch-screen.py",
] as const;
export const ROUTING_DEVELOPMENT_CODE_PATHS = [...ROUTING_COMPARISON_CODE_PATHS, "runtime/patch-worker/planner_checks.py"] as const;

/** Validates the pinned sources and returns a whitelist only: no credentials, raw
 * endpoints, local paths, oracle contents, or evaluator output enter this object.
 * Additional trusted CLI/report files can be bound before the first freeze. */
export function routingComparisonConfiguration(config: PatchRuntimeConfig, projectRoot: string,
  rawManifest: ComparisonManifest, taskContracts: RoutingTaskContract[], additionalCodePaths?: string[], historicalAdmission?: RoutingHistoricalAdmission): Promise<RoutingComparisonConfiguration>;
export function routingComparisonConfiguration(config: PatchRuntimeConfig, projectRoot: string,
  rawManifest: RoutingDevelopmentManifest, taskContracts: RoutingTaskContract[], additionalCodePaths?: string[], historicalAdmission?: RoutingHistoricalAdmission): Promise<RoutingDevelopmentConfiguration>;
export function routingComparisonConfiguration(config: PatchRuntimeConfig, projectRoot: string,
  rawManifest: RoutingManifest, taskContracts: RoutingTaskContract[], additionalCodePaths?: string[], historicalAdmission?: RoutingHistoricalAdmission): Promise<RoutingConfiguration>;
export async function routingComparisonConfiguration(config: PatchRuntimeConfig, projectRoot: string,
  rawManifest: RoutingManifest, taskContracts: RoutingTaskContract[], additionalCodePaths: string[] = [], historicalAdmission?: RoutingHistoricalAdmission): Promise<RoutingConfiguration> {
  const manifest = RoutingManifestSchema.parse(rawManifest);
  if (historicalAdmission !== undefined && manifest.schemaVersion !== 2) throw new Error("Historical admission is available only for V2 development.");
  const priorAdmission = historicalAdmission === undefined ? undefined : RoutingHistoricalAdmissionSchema.parse(historicalAdmission);
  const arms = manifest.schemaVersion === 2 ? ROUTING_DEVELOPMENT_ARMS : ROUTING_ARMS;
  const profiles = Object.fromEntries(arms.map(arm => [arm, routingRuntimeConfigForArm(config, arm, manifest)]));
  if (!config.cloud || !config.local || config.cloud.endpoint !== "https://api.openai.com/v1/chat/completions" || config.cloud.routing ||
      config.image !== manifest.image) throw new Error("Routing screen requires the exact direct cloud/local configuration and pinned image.");
  await validateComparisonSources(manifest);
  const describe = (value: NonNullable<PatchRuntimeConfig["cloud"]>, envelope: { maxOutputTokens: number; maxInputBytes: number }) => ({
    id: value.id, protocol: value.protocol, model: value.model, destinationSha256: digest(value.endpoint),
    inputUsdPerMillion: value.inputUsdPerMillion, outputUsdPerMillion: value.outputUsdPerMillion, allowInsecureHttp: value.allowInsecureHttp, ...envelope,
  });
  const codeHashes: Record<string, string> = {};
  for (const file of [...(manifest.schemaVersion === 2 ? ROUTING_DEVELOPMENT_CODE_PATHS : ROUTING_COMPARISON_CODE_PATHS), ...additionalCodePaths.map((value) => relativeFile.parse(value))]) {
    const full = path.join(projectRoot, file), stat = await lstat(full);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Runtime code must be a regular frozen file.");
    codeHashes[file] = digest(await readFile(full));
  }
  if (manifest.evaluatorSha256 !== codeHashes["scripts/evaluate-patch-screen.py"]) throw new Error("Routing manifest must bind the exact evaluator.");
  const configuration = RoutingConfigurationSchema.parse({ schemaVersion: manifest.schemaVersion,
    kind: manifest.schemaVersion === 2 ? manifest.kind : "routing-comparison-v1", ...(manifest.schemaVersion === 2 ? { studyKind: manifest.studyKind } : {}), mode: config.mode,
    manifestSha256: digest(canonicalRequest(manifest)), image: manifest.image,
    policyByArm: manifest.schemaVersion === 2 ? { C: ROUTING_POLICIES.C, P: ROUTING_POLICIES.P } : ROUTING_POLICIES,
    cloud: describe(config.cloud, providerLimits(config, config.cloud)), local: describe(config.local, localCodingLimits(config)),
    episodeMicrousd: config.episodeCapMicrousd, campaignMicrousd: config.campaignCapMicrousd, blockMicrousd: 9_000_000,
    limitsByArm: Object.fromEntries(arms.map((arm) => [arm, patchPolicyLimits(profiles[arm]!, ROUTING_POLICIES[arm])])),
    cloudControls: { reasoningEffort: "medium", serviceTier: "default", promptCacheMode: "explicit_no_breakpoints" },
    localControls: { enableThinking: false, protocol: "native_coding", parallelToolCalls: false }, concurrency: 1,
    taskContracts, taskContractsSha256: digest(canonicalRequest(taskContracts)), codeHashes,
    localEconomics: { devicePurchaseUsd: 3500, perTokenApiFeeUsd: 0, ownership: "user_owned", electricityAndUtilization: "unavailable" },
    ...(priorAdmission === undefined ? {} : { historicalAdmission: priorAdmission }),
  });
  validateConfiguration(manifest, configuration);
  return configuration;
}

function validateConfiguration(manifest: RoutingManifest, configuration: RoutingConfiguration): void {
  if (configuration.schemaVersion !== manifest.schemaVersion || configuration.manifestSha256 !== digest(canonicalRequest(manifest)) || configuration.image !== manifest.image ||
      configuration.taskContractsSha256 !== digest(canonicalRequest(configuration.taskContracts)) ||
      configuration.cloud.destinationSha256 !== digest("https://api.openai.com/v1/chat/completions") ||
      (configuration.schemaVersion === 2 ? ROUTING_DEVELOPMENT_CODE_PATHS : ROUTING_COMPARISON_CODE_PATHS).some((file) => !configuration.codeHashes[file]) ||
      manifest.evaluatorSha256 !== configuration.codeHashes["scripts/evaluate-patch-screen.py"]) throw new Error("Frozen routing identity mismatch.");
  if (new Set(configuration.taskContracts.map((item) => item.taskId)).size !== manifest.tasks.length) throw new Error("Task contracts must be unique.");
  const nativeProfiles = configuration.schemaVersion === 2 ? [configuration.limitsByArm.P]
    : [configuration.limitsByArm.L, configuration.limitsByArm.E, configuration.limitsByArm.P];
  for (const profile of nativeProfiles) {
    if (profile.localStepLimit !== 24 || profile.finishingReserve !== 2 || !profile.localCoding) throw new Error("Native routing finishing envelope is incomplete.");
  }
  for (const task of manifest.tasks) {
    const contract = configuration.taskContracts.find((item) => item.taskId === task.taskId);
    if (!contract || contract.expectedTests !== task.referenceReceipt.testCount ||
        contract.sourceTreeSha256 !== task.referenceReceipt.sourceTreeSha256 ||
        contract.sourceTreeSha256 !== task.baselineReceipt.sourceTreeSha256 ||
        new Set(contract.allowedFiles).size !== contract.allowedFiles.length ||
        task.baselineReceipt.harnessVerified !== true || task.baselineReceipt.testCount !== contract.expectedTests ||
        !(task.baselineReceipt.passed! > 0)) throw new Error("Task acceptance contract is incomplete or inconsistent.");
    routingObjective(task, contract);
  }
}

/** Three independently relabelled Latin squares give every arm each position
 * exactly three times. The seeded task/block shuffle is fixed before outcomes. */
export function balancedRoutingBlocks(manifest: Pick<ComparisonManifest, "seed" | "tasks"> & { schemaVersion?: 1 | 2 }): Array<{ taskId: string; order: RoutingArm[] }> {
  let counter = 0;
  const shuffle = <T>(input: T[]): T[] => {
    const values = [...input];
    for (let index = values.length - 1; index > 0; index--) {
      const target = createHash("sha256").update(`${manifest.seed}:routing-v${manifest.schemaVersion === 2 ? 2 : 1}:${counter++}`).digest().readUInt32BE(0) % (index + 1);
      [values[index], values[target]] = [values[target]!, values[index]!];
    }
    return values;
  };
  const orders: RoutingArm[][] = [];
  if (manifest.schemaVersion === 2) {
    for (let pair = 0; pair < 3; pair++) orders.push(["C", "P"], ["P", "C"]);
  } else for (let square = 0; square < 3; square++) {
    const labels = shuffle([...ROUTING_ARMS]);
    for (let offset = 0; offset < 4; offset++) orders.push(labels.map((_, index) => labels[(index + offset) % 4]!));
  }
  const randomized = shuffle(orders);
  return shuffle(manifest.tasks.map((task) => task.taskId).sort()).map((taskId, index) => ({ taskId, order: randomized[index]! }));
}

export interface RoutingAssignment { screen_id: string; task_id: string; arm: RoutingArm; run_id: string | null; dispatch_claimed: number; evaluation_json: string | null }
export interface RoutingBlock { screen_id: string; task_id: string; ordinal: number; arm_order: string; reservation_microusd: number; state: "pending" | "reserved" | "completed" }
export class RoutingComparisonStore {
  constructor(readonly database: SoarDatabase) {}
  freeze(rawManifest: RoutingManifest, rawConfiguration: RoutingConfiguration): void {
    const manifest = RoutingManifestSchema.parse(rawManifest), configuration = RoutingConfigurationSchema.parse(rawConfiguration);
    validateConfiguration(manifest, configuration);
    const manifestSha = digest(canonicalRequest(manifest)), configSha = digest(canonicalRequest(configuration));
    this.database.transaction(() => {
      const existing = this.database.prepare("SELECT manifest_sha256,configuration_sha256 FROM patch_routing_screens WHERE id = ?").get(manifest.screenId) as
        { manifest_sha256: string; configuration_sha256: string } | undefined;
      if (existing) {
        if (existing.manifest_sha256 !== manifestSha || existing.configuration_sha256 !== configSha) throw new Error("Frozen routing manifest/configuration cannot change on resume.");
        return;
      }
      const blocks = balancedRoutingBlocks(manifest);
      const publicTasks = manifest.tasks.map((task) => ({ taskId: task.taskId, kind: task.kind,
        source: { url: task.source.url, revision: task.source.revision, files: task.source.files, bytes: task.source.bytes },
        objective: task.objective, solverObjectiveSha256: digest(routingObjective(task, configuration.taskContracts.find((item) => item.taskId === task.taskId)!)),
        visibleCommand: task.visibleCommand, oracleSha256: task.oracle.sha256, referencePatchSha256: task.referencePatch.sha256 }));
      const frozen = { screenId: manifest.screenId, seed: manifest.seed, manifestSha256: manifestSha,
        configurationSha256: configSha, configuration, tasks: publicTasks, blocks, blocksSha256: digest(canonicalRequest(blocks)) };
      this.database.prepare("INSERT INTO patch_routing_screens VALUES(?,?,?,?,?,?,?)")
        .run(manifest.screenId, manifestSha, configSha, JSON.stringify(frozen), ROUTING_STAGE_MICROUSD, 3_000_000, new Date().toISOString());
      for (const [ordinal, block] of blocks.entries()) {
        this.database.prepare("INSERT INTO patch_routing_blocks(screen_id,task_id,ordinal,arm_order,reservation_microusd) VALUES(?,?,?,?,?)")
          .run(manifest.screenId, block.taskId, ordinal, JSON.stringify(block.order), 9_000_000);
        for (const arm of routingArms(configuration)) this.database.prepare("INSERT INTO patch_routing_assignments(screen_id,task_id,arm) VALUES(?,?,?)").run(manifest.screenId, block.taskId, arm);
      }
    }).immediate();
  }
  blocks(screenId: string): RoutingBlock[] { return this.database.prepare("SELECT * FROM patch_routing_blocks WHERE screen_id = ? ORDER BY ordinal").all(screenId) as RoutingBlock[]; }
  assignments(screenId: string): RoutingAssignment[] { return this.database.prepare("SELECT * FROM patch_routing_assignments WHERE screen_id = ? ORDER BY task_id,arm").all(screenId) as RoutingAssignment[]; }
  runIds(screenId: string): string[] { return this.assignments(screenId).flatMap((row) => row.run_id ? [row.run_id] : []); }
  private assignment(screenId: string, taskId: string, arm: RoutingArm): RoutingAssignment {
    const row = this.assignments(screenId).find((item) => item.task_id === taskId && item.arm === arm);
    if (!row) throw new Error("Unknown routing assignment.");
    return row;
  }
  reserveBlock(screenId: string, taskId: string): void {
    this.database.transaction(() => {
      const block = this.blocks(screenId).find((row) => row.task_id === taskId);
      if (!block) throw new Error("Unknown routing block.");
      if (block.state !== "pending") return;
      if (patchCampaignExposure(this.database).microusd + block.reservation_microusd > ROUTING_STAGE_MICROUSD) throw new Error("Insufficient stage campaign capacity for the complete routing block.");
      this.database.prepare("UPDATE patch_routing_blocks SET state = 'reserved' WHERE screen_id = ? AND task_id = ?").run(screenId, taskId);
    }).immediate();
  }
  /** Claim before even creating the controller run. A crash at any later point
   * cannot silently create a second attempt for this assignment. */
  claimDispatch(screenId: string, taskId: string, arm: RoutingArm): void {
    const result = this.database.prepare(`UPDATE patch_routing_assignments SET dispatch_claimed = 1
      WHERE screen_id = ? AND task_id = ? AND arm = ? AND dispatch_claimed = 0 AND evaluation_json IS NULL
        AND EXISTS(SELECT 1 FROM patch_routing_blocks b WHERE b.screen_id = patch_routing_assignments.screen_id
          AND b.task_id = patch_routing_assignments.task_id AND b.state = 'reserved')`).run(screenId, taskId, arm);
    if (result.changes !== 1) throw new Error("Routing dispatch already claimed or block not reserved; no retry is allowed.");
  }
  link(screenId: string, taskId: string, arm: RoutingArm, runId: string): void {
    this.database.transaction(() => {
      const run = new PatchRunStore(this.database).get(runId);
      if (run.status !== "created" || run.policy !== ROUTING_POLICIES[arm] || run.maxCostMicrousd !== 3_000_000 ||
          this.database.prepare("SELECT 1 FROM patch_comparison_assignments WHERE run_id = ?").get(runId)) throw new Error("Routing run identity/policy mismatch.");
      if (this.database.prepare(`UPDATE patch_routing_assignments SET run_id = ? WHERE screen_id = ? AND task_id = ? AND arm = ?
        AND run_id IS NULL AND dispatch_claimed = 1 AND evaluation_json IS NULL`).run(runId, screenId, taskId, arm).changes !== 1) throw new Error("Routing assignment already linked or not claimed.");
    }).immediate();
  }
  hasEvaluationClaim(screenId: string, taskId: string, arm: RoutingArm): boolean {
    return Boolean(this.database.prepare("SELECT 1 FROM patch_routing_evaluation_claims WHERE screen_id = ? AND task_id = ? AND arm = ?").get(screenId, taskId, arm));
  }
  claimEvaluation(screenId: string, taskId: string, arm: RoutingArm): void {
    this.database.transaction(() => {
      const row = this.assignment(screenId, taskId, arm);
      const run = row.run_id ? new PatchRunStore(this.database).get(row.run_id) : undefined;
      if (!run || row.evaluation_json || !isPatchRunTerminal(run.status) || run.cleanupConfirmed !== true) throw new Error("Evaluation requires an unscored terminal run with confirmed cleanup.");
      this.database.prepare("INSERT INTO patch_routing_evaluation_claims VALUES(?,?,?,?)").run(screenId, taskId, arm, new Date().toISOString());
    }).immediate();
  }
  evaluated(screenId: string, taskId: string, arm: RoutingArm, result: RoutingComparisonEvaluation): void {
    this.database.transaction(() => {
      const row = this.assignment(screenId, taskId, arm);
      const evaluatedRun = row.run_id ? new PatchRunStore(this.database).get(row.run_id) : undefined;
      if (result.kind === "diagnostic" || (result.status === "scored" && evaluatedRun?.status === "failed")) {
        const frozen = this.database.prepare("SELECT frozen_json FROM patch_routing_screens WHERE id = ?").get(screenId) as { frozen_json: string };
        const version = RoutingConfigurationSchema.parse(JSON.parse(frozen.frozen_json).configuration).schemaVersion;
        if (result.kind === "diagnostic" && (version !== 2 || evaluatedRun?.status !== "failed" || evaluatedRun.patch?.kind !== "submitted" ||
            evaluatedRun.patch.truncated || result.patchSha256 !== evaluatedRun.patch.sha256 ||
            (result.status === "scored" && result.reason !== "failed_runtime_submission"))) throw new Error("Diagnostic evaluation requires a V2 failed submitted artifact.");
        if (version === 2 && result.status === "scored" && evaluatedRun?.status === "failed" && result.kind !== "diagnostic") {
          throw new Error("A failed V2 submission can only receive a labelled diagnostic evaluation.");
        }
      }
      if (result.status !== "error" && (!row.run_id || new PatchRunStore(this.database).get(row.run_id).cleanupConfirmed !== true)) throw new Error("Scoring requires confirmed cleanup.");
      if (!row.dispatch_claimed || (row.run_id && !isPatchRunTerminal(new PatchRunStore(this.database).get(row.run_id).status)) ||
          (result.status === "scored" && (!row.run_id || !this.hasEvaluationClaim(screenId, taskId, arm)))) throw new Error("Scoring requires terminal dispatch and a prior evaluator claim.");
      if (this.database.prepare("UPDATE patch_routing_assignments SET evaluation_json = ? WHERE screen_id = ? AND task_id = ? AND arm = ? AND evaluation_json IS NULL")
        .run(JSON.stringify(result), screenId, taskId, arm).changes !== 1) throw new Error("Routing evaluation is immutable.");
    }).immediate();
  }
  completeBlock(screenId: string, taskId: string): void {
    this.database.transaction(() => {
      const rows = this.assignments(screenId).filter((row) => row.task_id === taskId);
      const screen = this.database.prepare("SELECT frozen_json FROM patch_routing_screens WHERE id = ?").get(screenId) as { frozen_json: string } | undefined;
      if (!screen) throw new Error("Unknown routing screen.");
      const arms = routingArms(RoutingConfigurationSchema.parse(JSON.parse(screen.frozen_json).configuration));
      if (rows.length !== arms.length || arms.some(arm => !rows.some(row => row.arm === arm)) ||
          rows.some((row) => !row.evaluation_json || JSON.parse(row.evaluation_json).status === "error")) throw new Error("Routing block is incomplete or requires review.");
      this.database.prepare("UPDATE patch_routing_blocks SET state = 'completed' WHERE screen_id = ? AND task_id = ? AND state = 'reserved'").run(screenId, taskId);
    }).immediate();
  }
}

/** Trusted orchestration only. The caller owns the exclusive runner lock, scoped
 * controller recovery, per-episode runtime/source revalidation, and evaluator
 * isolation. Hidden material is passed only to evaluate after terminal cleanup. */
export async function runRoutingComparisonScreen(options: {
  manifest: RoutingManifest; configuration: RoutingConfiguration;
  controller?: Pick<PatchRunController, "create" | "start" | "waitForRun" | "cancel">;
  controllerForArm?(arm: RoutingArm): Pick<PatchRunController, "create" | "start" | "waitForRun" | "cancel">;
  runs: PatchRunStore; screen: RoutingComparisonStore; outputDirectory: string;
  beforeEpisode(context: { taskId: string; arm: RoutingArm }): Promise<void>; evaluate(task: ComparisonTask, patchPath: string): Promise<unknown>;
  signal?: AbortSignal; progress?(value: { taskId: string; arm: RoutingArm; runId: string; status: string }): void;
}): Promise<void> {
  const { manifest, configuration, runs, screen } = options;
  if (configuration.schemaVersion === 2 && !options.controllerForArm) throw new Error("V2 routing requires a controller selected for each arm.");
  if (!options.controller && !options.controllerForArm) throw new Error("Routing requires an admitted controller.");
  screen.freeze(manifest, configuration);
  for (const assignment of screen.assignments(manifest.screenId)) {
    if (assignment.evaluation_json && JSON.parse(assignment.evaluation_json).status !== "error" &&
        (!assignment.run_id || runs.get(assignment.run_id).cleanupConfirmed !== true)) throw new Error("Frozen assignment cleanup is unconfirmed; stage remains stopped.");
  }
  await mkdir(options.outputDirectory, { recursive: true, mode: 0o700 });
  for (const block of screen.blocks(manifest.screenId)) {
    if (options.signal?.aborted) return;
    if (block.state === "completed") continue;
    screen.reserveBlock(manifest.screenId, block.task_id);
    const task = manifest.tasks.find((item) => item.taskId === block.task_id)!;
    const contract = configuration.taskContracts.find((item) => item.taskId === task.taskId)!;
    for (const arm of JSON.parse(block.arm_order) as RoutingArm[]) {
      if (options.signal?.aborted) return;
      const controller = options.controllerForArm ? options.controllerForArm(arm) : options.controller!;
      const assignment = screen.assignments(manifest.screenId).find((row) => row.task_id === task.taskId && row.arm === arm)!;
      if (assignment.evaluation_json) {
        if (JSON.parse(assignment.evaluation_json).status === "error") throw new Error("Frozen routing error requires review; no automatic retry.");
        if (!assignment.run_id || runs.get(assignment.run_id).cleanupConfirmed !== true) throw new Error("Frozen assignment cleanup is unconfirmed; stage remains stopped.");
        continue;
      }
      const retainError = (reason: string, patchSha256: string | null = null) => screen.evaluated(manifest.screenId, task.taskId, arm,
        { status: "error", patchSha256, oracleSha256: task.oracle.sha256, reason });
      if (screen.hasEvaluationClaim(manifest.screenId, task.taskId, arm)) {
        retainError("evaluation_interrupted_outcome_unknown", assignment.run_id ? runs.get(assignment.run_id).patch?.sha256 ?? null : null);
        throw new Error("Previous evaluator outcome is unknown; no automatic retry.");
      }
      let runId = assignment.run_id;
      if (!assignment.dispatch_claimed) {
        await options.beforeEpisode({ taskId: task.taskId, arm });
        if (options.signal?.aborted) return;
        screen.claimDispatch(manifest.screenId, task.taskId, arm);
        try {
          const created = await controller.create({ workspaceRoot: task.source.root, objective: routingObjective(task, contract), policy: ROUTING_POLICIES[arm],
            visibleTestCommand: task.visibleCommand, publicSourceAcknowledged: true, episodeBudgetUsd: 3 });
          if (created.baseRevision !== task.source.revision) { controller.cancel(created.id); throw new Error("Source changed before dispatch."); }
          screen.link(manifest.screenId, task.taskId, arm, created.id); runId = created.id;
          runs.recordEvent(runId, { type: "routing_comparison.assigned", summary: `Screen ${manifest.screenId}; task ${task.taskId}; arm ${arm}; configuration SHA-256 ${digest(canonicalRequest(configuration))}.` });
          if (options.signal?.aborted) controller.cancel(runId); else controller.start(runId);
        } catch {
          if (runId && !isPatchRunTerminal(runs.get(runId).status)) controller.cancel(runId);
          if (runId) await controller.waitForRun(runId);
          retainError("dispatch_failed_or_interrupted");
          throw new Error("Routing dispatch failed; its claim is retained and cannot retry.");
        }
      } else if (!runId) {
        retainError("dispatch_interrupted_before_run_link");
        throw new Error("Previous dispatch was interrupted before linking; no automatic retry.");
      } else if (runs.get(runId).status === "created") controller.cancel(runId);
      if (!runId) throw new Error("Missing claimed run.");
      const cancel = () => { controller.cancel(runId); };
      options.signal?.addEventListener("abort", cancel, { once: true });
      if (options.signal?.aborted) cancel();
      let snapshot;
      try { snapshot = await controller.waitForRun(runId); }
      finally { options.signal?.removeEventListener("abort", cancel); }
      if (!isPatchRunTerminal(snapshot.status)) throw new Error("Routing evaluation waits for terminal cleanup.");
      options.progress?.({ taskId: task.taskId, arm, runId, status: snapshot.status });
      const patch = snapshot.patch;
      if (snapshot.cleanupConfirmed !== true) {
        retainError("cleanup_unconfirmed", patch?.sha256 ?? null);
        throw new Error("Terminal cleanup is unconfirmed; stage remains stopped without automatic retry.");
      }
      if (runs.hasUnresolvedRequests(runId)) {
        retainError("provider_outcome_unknown", patch?.sha256 ?? null);
        throw new Error("Provider outcome is unknown; campaign exposure is retained and the screen stops.");
      }
      const runtimeFailure = configuration.schemaVersion === 2 ? classifyRoutingRuntimeFailure(snapshot) : null;
      if (runtimeFailure?.stop) {
        retainError(`runtime_${runtimeFailure.kind}:${runtimeFailure.code}`, patch?.sha256 ?? null);
        throw new Error(`Routing runtime ${runtimeFailure.kind} failure; stage stops without automatic retry.`);
      }
      let evaluation: RoutingComparisonEvaluation = { status: "not_scorable", patchSha256: patch?.sha256 ?? null, oracleSha256: task.oracle.sha256,
        reason: patch?.kind === "recovered" ? "unfinished_recovered_artifact" : runtimeFailure ?
          `runtime_${runtimeFailure.kind}:${runtimeFailure.code}` : "no_complete_submission" };
      const diagnostic = configuration.schemaVersion === 2 && snapshot.status === "failed" && patch?.kind === "submitted";
      if ((snapshot.status === "completed" || diagnostic) && patch && patch.kind !== "recovered" && !patch.truncated && patch.text.trim()) {
        if (digest(patch.text) !== patch.sha256) throw new Error("Terminal patch identity changed.");
        const patchPath = path.join(options.outputDirectory, `${task.taskId}-${arm}-${runId}.patch`);
        try { await writeFile(patchPath, patch.text, { mode: 0o600, flag: "wx" }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || digest(await readFile(patchPath)) !== patch.sha256) throw new Error("Frozen patch export changed."); }
        let scope: RoutingPatchScope;
        try { scope = await inspectRoutingPatchScope(patch.text, contract.allowedFiles); }
        catch {
          retainError("scope_inspection_infrastructure_failure", patch.sha256);
          throw new Error("Trusted scope inspection failed; stage remains stopped.");
        }
        if (!scope.valid) {
          screen.evaluated(manifest.screenId, task.taskId, arm, { status: "not_scorable", patchSha256: patch.sha256,
            oracleSha256: task.oracle.sha256, reason: "candidate_scope_failure", scope, ...(diagnostic ? { kind: "diagnostic" as const } : {}) });
          continue;
        }
        const oracleStat = await lstat(task.oracle.path);
        if (!oracleStat.isFile() || oracleStat.isSymbolicLink() || oracleStat.size > 4 * 1024 * 1024 || digest(await readFile(task.oracle.path)) !== task.oracle.sha256) throw new Error("Frozen oracle changed.");
        screen.claimEvaluation(manifest.screenId, task.taskId, arm);
        try {
          const receipt = EvaluationReceiptSchema.parse(await options.evaluate(task, patchPath));
          if (receipt.sourceRevision !== task.source.revision || receipt.oracleSha256 !== task.oracle.sha256 || receipt.patchSha256 !== patch.sha256 || receipt.image !== manifest.image ||
              receipt.sourceTreeSha256 !== contract.sourceTreeSha256 ||
              receipt.failureKind === "infrastructure" || receipt.error !== undefined ||
              (receipt.exitCode === 0 && (receipt.harnessVerified !== true || receipt.testCount !== task.referenceReceipt.testCount)) ||
              (receipt.exitCode !== 0 && receipt.failureKind !== "candidate")) throw new Error("Evaluator receipt identity/completeness mismatch.");
          evaluation = { status: "scored", patchSha256: patch.sha256, oracleSha256: task.oracle.sha256, receipt, scope,
            ...(diagnostic ? { kind: "diagnostic" as const, reason: "failed_runtime_submission" } : {}) };
        } catch {
          retainError("evaluator_or_receipt_failure", patch.sha256);
          throw new Error("Independent evaluation failed; retain the assignment and inspect cleanup before continuing.");
        }
      }
      screen.evaluated(manifest.screenId, task.taskId, arm, evaluation);
    }
    screen.completeBlock(manifest.screenId, block.task_id);
  }
}
