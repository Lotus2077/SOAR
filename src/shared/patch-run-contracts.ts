import { z } from "zod";

export const PATCH_RUN_SCHEMA_VERSION = "patch-run-v1" as const;
export const PatchRunPolicySchema = z.enum(["cloud", "prepared_cloud", "hybrid", "local_only", "local_first", "cloud_plan_local", "cloud_plan_local_review", "local_critic_repair"]);
export const PatchRunStatusSchema = z.enum([
  "created", "running", "completed", "failed", "cancelled", "interrupted", "blocked",
]);
export const PatchRunPhaseSchema = z.enum([
  "pending", "preparing", "local_investigation", "local_solver", "cloud_planner", "cloud_solver", "cloud_critic", "checking", "finished",
]);
export const PatchRunDecisionSchema = z.enum(["keep", "reject"]);
export type PatchRunPolicy = z.infer<typeof PatchRunPolicySchema>;
/** Automatic is a create-time selector; workers persist an existing concrete policy. */
export const PatchRunRequestedPolicySchema = z.enum([...PatchRunPolicySchema.options, "automatic"]);
export type PatchRunRequestedPolicy = z.infer<typeof PatchRunRequestedPolicySchema>;
export type PatchRunStatus = z.infer<typeof PatchRunStatusSchema>;
export type PatchRunPhase = z.infer<typeof PatchRunPhaseSchema>;
export type PatchRunDecision = z.infer<typeof PatchRunDecisionSchema>;
export type PatchRunExecutionMode = "scripted" | "live";
export const PatchRunRequestPhaseSchema = z.enum(["scout", "local", "planner", "cloud", "critic"]);
export type PatchRunRequestPhase = z.infer<typeof PatchRunRequestPhaseSchema>;

export function isNativePatchPolicy(policy: PatchRunPolicy): boolean {
  return policy === "local_only" || policy === "local_first" || policy === "local_critic_repair" || patchPolicyNeedsPlan(policy);
}

export function patchPolicyNeedsPlan(policy: PatchRunPolicy): boolean {
  return policy === "cloud_plan_local" || policy === "cloud_plan_local_review";
}

export function patchPolicyNeedsLocal(policy: PatchRunPolicy): boolean {
  return policy === "hybrid" || isNativePatchPolicy(policy);
}

export function patchPolicyNeedsCloud(policy: PatchRunPolicy): boolean {
  return policy !== "local_only";
}

const money = z.number().int().nonnegative().safe();
export const PatchRunRoutingSelectionSchema = z.object({
  schemaVersion: z.literal(1), selector: z.literal("source_size_v1"), requestedPolicy: z.literal("automatic"),
  selectedPolicy: z.enum(["prepared_cloud", "local_critic_repair"]),
  reason: z.enum(["baseline_within_critic_hard_limits", "baseline_exceeds_critic_hard_limits",
    "critic_profile_unavailable", "critic_budget_unavailable"]),
  baseRevision: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u),
  sourceFiles: money.min(1).max(2000), sourceBytes: money.max(32 * 1024 * 1024),
  sourceTreeSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  configurationSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  maxCostMicrousd: money.min(1).max(3_000_000),
}).strict().superRefine((value, context) => {
  const within = value.sourceFiles <= 64 && value.sourceBytes <= 98_304;
  if ((value.selectedPolicy === "local_critic_repair" &&
      (value.reason !== "baseline_within_critic_hard_limits" || !within || value.maxCostMicrousd > 700_000)) ||
      (value.selectedPolicy === "prepared_cloud" && value.reason === "baseline_within_critic_hard_limits") ||
      (value.reason === "baseline_exceeds_critic_hard_limits" && within)) {
    context.addIssue({ code: "custom", message: "Automatic selection contradicts its source limits, policy or budget." });
  }
});
export type PatchRunRoutingSelection = z.infer<typeof PatchRunRoutingSelectionSchema>;
export const PatchRunIdSchema = z.string().uuid();
export const PatchRunCreateInputSchema = z.object({
  workspaceRoot: z.string().trim().min(1).max(4_096),
  objective: z.string().trim().min(1).max(20_000),
  policy: PatchRunRequestedPolicySchema,
  publicSourceAcknowledged: z.literal(true),
  visibleTestCommand: z.string().trim().min(1).max(4_096).optional(),
  episodeBudgetUsd: z.number().finite().positive().max(300).optional(),
}).strict();
export type PatchRunCreateInput = z.infer<typeof PatchRunCreateInputSchema>;

export const PatchRunChecksSchema = z.object({
  status: z.enum(["not_run", "passed", "failed", "error"]),
  command: z.string().max(4_096),
  exitCode: z.number().int().nullable(),
  output: z.string().max(65_536),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  sourceAfterSha256: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
}).strict();
export type PatchRunChecks = z.infer<typeof PatchRunChecksSchema>;

export const PatchRunPatchSchema = z.object({
  /** Older artifacts omit kind and are submitted patches. */
  kind: z.enum(["submitted", "recovered"]).optional(),
  text: z.string().max(1_048_576),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  files: z.array(z.string().min(1).max(4_096)).max(1_000),
  truncated: z.boolean(),
}).strict();
export type PatchRunPatch = z.infer<typeof PatchRunPatchSchema>;

export const PatchRunEventSchema = z.object({
  sequence: z.number().int().positive().safe(),
  type: z.string().regex(/^[a-z][a-z0-9_.]*$/u).max(80),
  summary: z.string().max(1_000),
  createdAt: z.string().datetime(),
}).strict();
export type PatchRunEvent = z.infer<typeof PatchRunEventSchema>;

export const PatchRunLocalInvestigationSchema = z.object({
  elapsedMs: money,
  outcome: z.enum(["completed", "partial", "fallback", "stopped"]),
  fallbackReason: z.enum(["scout_limit_or_format_failure", "scout_no_evidence", "input_limit_exceeded", "scout_path_denied", "scout_action_denied",
    "container_command_timeout", "invalid_action", "run_deadline_exceeded", "cancelled",
    "provider_outcome_unknown", "scout_stopped"]).optional(),
  providerOutputError: z.enum(["provider_output_empty", "provider_output_truncated"]).optional(),
}).strict();
export type PatchRunLocalInvestigation = z.infer<typeof PatchRunLocalInvestigationSchema>;

export const PatchRunPhaseUsageSchema = z.object({
  providerLabel: z.string().max(256),
  requestCount: money,
  usageReceipts: money,
  unknownRequests: money,
  spentMicrousd: money,
  reservedMicrousd: money,
  inputTokens: money,
  outputTokens: money,
  cacheReadTokens: money,
  cacheWriteTokens: money,
  reasoningTokens: money,
}).strict();
export type PatchRunPhaseUsage = z.infer<typeof PatchRunPhaseUsageSchema>;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
export const PatchRunCheckpointReasonSchema = z.enum([
  "initialized", "cloud_plan_required", "cloud_plan_completed", "local_request_started", "command_observed", "host_check_started",
  "finish_required", "visible_check_passed", "visible_check_failed", "visible_check_tree_changed",
  "repeated_observation", "visible_checks_failed", "explicit_help", "local_call_limit", "finish_reserve_exhausted",
  "fresh_visible_check", "handoff_confirmed", "local_only_checkpoint", "cancelled", "unknown_outcome",
  "protocol_failure", "check_timeout", "episode_deadline", "accounting_failure", "execution_failure",
  "insufficient_model_calls", "insufficient_handoff_time",
  "review_required", "review_time_reserve",
  "planner_check_failed", "planner_check_invalid",
  "critic_required", "critic_request_started", "critic_acceptable", "critic_repair_required", "critic_insufficient_context",
  "critic_time_reserve", "critic_policy_checkpoint",
]);
export const PatchRunCheckpointSchema = z.object({
  sequence: money.min(1), eventId: z.string().min(1).max(256),
  previousEvidenceId: sha256.nullable(),
  decision: z.enum(["continue", "checkpoint", "submit", "escalate", "stop"]),
  reason: PatchRunCheckpointReasonSchema,
  policy: z.enum(["local_only", "local_first", "cloud_plan_local", "cloud_plan_local_review", "local_critic_repair"]),
  state: z.enum(["planner", "local", "checkpoint", "cloud", "critic", "submitted", "stopped"]),
  localCalls: money.max(24), remainingLocalCalls: money.max(24),
  sourceSha256: sha256,
  checkSourceSha256: sha256.nullable(),
  failedChecks: money.max(2), duplicateObservations: money.max(3),
  handoffUsed: z.boolean(), handoffCandidate: z.boolean(),
  allowedActions: z.array(z.enum(["run_command", "run_visible_checks", "submit_task", "request_help"])).max(4),
  evidence: z.record(z.string(), z.unknown()),
  evidenceId: sha256,
}).strict();
export type PatchRunCheckpoint = z.infer<typeof PatchRunCheckpointSchema>;
export const PatchRunCheckpointCheckSchema = z.object({
  command: z.string().max(4096), exitCode: z.number().int(), output: z.string().max(65536),
  elapsedMs: money, sourceSha256: sha256, sourceAfterSha256: sha256,
  passed: z.boolean(), fresh: z.boolean(),
}).strict();
export type PatchRunCheckpointCheck = z.infer<typeof PatchRunCheckpointCheckSchema>;
const invalidUnicode = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const utf8Encoder = new TextEncoder();
function plannerText(maxBytes: number, nonblank = false, noNul = true) {
  return z.string().refine((value) => !invalidUnicode.test(value) && (!noNul || !value.includes("\0")) &&
    utf8Encoder.encode(value).byteLength <= maxBytes && (!nonblank || value.trim().length > 0),
  "Planner check text exceeds its valid UTF-8 envelope.");
}

/** Fallible critique of an immutable provisional draft, never patch acceptance. */
export const PatchRunCriticResultSchema = z.object({
  verdict: z.enum(["acceptable", "repair_required", "insufficient_context"]),
  summary: plannerText(1024, true),
  findings: z.array(z.object({
    path: plannerText(1024, true).refine(value => !/[\\:\x00-\x1f\x7f]/u.test(value) && !value.startsWith("/") &&
      value.split("/").every(part => part && part !== "." && part !== "..")),
    revision: z.enum(["candidate", "baseline"]),
    startLine: money.min(1), endLine: money.min(1), issue: plannerText(1024, true), repair: plannerText(2048, true),
  }).strict()).max(8),
  missingContext: z.array(plannerText(512, true)).max(8),
}).strict().superRefine((value, context) => {
  if ((value.verdict === "acceptable" && (value.findings.length || value.missingContext.length)) ||
      (value.verdict === "repair_required" && (!value.findings.length || value.missingContext.length)) ||
      (value.verdict === "insufficient_context" && !value.missingContext.length) ||
      value.findings.some(finding => finding.endLine < finding.startLine)) {
    context.addIssue({ code: "custom", message: "Critic verdict or cited range is inconsistent." });
  }
});
export type PatchRunCriticResult = z.infer<typeof PatchRunCriticResultSchema>;
export const PatchRunCriticDraftSchema = z.object({
  schemaVersion: z.literal(1), requestId: z.string().regex(/^[a-f0-9]{32}$/u), checkpointEvidenceId: sha256,
  baseRevision: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u), baselineSourceSha256: sha256,
  sourceSha256: sha256, patchSha256: sha256, checkSourceSha256: sha256,
  objectiveSha256: sha256, visibleCommandSha256: sha256, bundleSha256: sha256, bodySha256: sha256,
  draftLocalCalls: money.min(1).max(8),
}).strict();
export type PatchRunCriticDraft = z.infer<typeof PatchRunCriticDraftSchema>;
export const PatchRunCriticReceiptSchema = z.object({
  schemaVersion: z.literal(1), requestId: z.string().regex(/^[a-f0-9]{32}$/u), sourceSha256: sha256,
  patchSha256: sha256, bundleSha256: sha256, bodySha256: sha256, responseSha256: sha256,
  result: PatchRunCriticResultSchema, receiptSha256: sha256,
}).strict();
export type PatchRunCriticReceipt = z.infer<typeof PatchRunCriticReceiptSchema>;
// Python sorts identifier strings by Unicode code point, not UTF-16 code unit.
function compareTestIds(left: string, right: string): number {
  const a = Array.from(left, (char) => char.codePointAt(0)!), b = Array.from(right, (char) => char.codePointAt(0)!);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return a.length - b.length;
}
export const PatchRunPlanChecksSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal("model_generated_python_unittest"),
  source: plannerText(6000, true), expectedTests: money.min(1).max(12), sha256,
  testIds: z.array(plannerText(6000, true).regex(/^[\p{ID_Start}_][\p{ID_Continue}]*\.test_[\p{ID_Continue}]*$/u)).min(1).max(12),
}).strict().superRefine((value, context) => {
  if (value.testIds.length !== value.expectedTests ||
      value.testIds.some((id, index) => index > 0 && compareTestIds(value.testIds[index - 1]!, id) >= 0)) {
    context.addIssue({ code: "custom", message: "Generated test identities must be sorted, unique and match the declared count." });
  }
});
export type PatchRunPlanChecks = z.infer<typeof PatchRunPlanChecksSchema>;

/** Fallible generated-check execution evidence, never semantic acceptance. */
export const PatchRunPlannerCheckResultSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal("model_generated_python_unittest"), sourceSha256: sha256,
  expectedTests: money.min(1).max(12), discoveredTests: money.max(12), testsRun: money.max(12), passed: money.max(12),
  failures: money.max(12), errors: money.max(12), skipped: money.max(12),
  expectedFailures: money.max(12), unexpectedSuccesses: money.max(12),
  completed: z.boolean(), status: z.enum(["passed", "failed", "invalid"]), detail: plannerText(2048),
}).strict().superRefine((value, context) => {
  const successful = value.completed && value.discoveredTests === value.expectedTests && value.testsRun === value.expectedTests &&
    value.passed === value.expectedTests && value.failures === 0 && value.errors === 0 && value.skipped === 0 &&
    value.expectedFailures === 0 && value.unexpectedSuccesses === 0;
  if (value.passed > value.testsRun || value.testsRun > value.discoveredTests ||
      (value.completed && (value.discoveredTests !== value.expectedTests || value.testsRun !== value.expectedTests)) ||
      value.status !== (successful ? "passed" : value.completed ? "failed" : "invalid")) {
    context.addIssue({ code: "custom", message: "Generated check result counts or status are inconsistent." });
  }
});
export type PatchRunPlannerCheckResult = z.infer<typeof PatchRunPlannerCheckResultSchema>;

export const PatchRunPlannerCheckSchema = z.object({
  stage: z.enum(["checkpoint", "final"]), artifactSha256: sha256,
  sourceSha256: sha256, sourceAfterSha256: sha256, exitCode: z.number().int().safe(),
  output: plannerText(16384, false, false), outputTruncated: z.boolean(), elapsedMs: money, timedOut: z.boolean(),
  result: PatchRunPlannerCheckResultSchema.nullable(), passed: z.boolean(), fresh: z.boolean(),
}).strict().superRefine((value, context) => {
  const unchanged = value.sourceSha256 === value.sourceAfterSha256;
  const passed = value.result?.status === "passed" && value.exitCode === 0 &&
    !value.outputTruncated && !value.timedOut && unchanged;
  if (value.passed !== passed || (value.fresh && !unchanged) ||
      (value.result !== null && (value.result.sourceSha256 !== value.artifactSha256 ||
        value.exitCode !== ({ passed: 0, failed: 1, invalid: 2 } as const)[value.result.status]))) {
    context.addIssue({ code: "custom", message: "Generated check receipt does not match its process, artifact or source." });
  }
});
export type PatchRunPlannerCheck = z.infer<typeof PatchRunPlannerCheckSchema>;
export const PatchRunPlanSchema = z.object({ summary: z.string().min(1).max(16384), sha256,
  checks: PatchRunPlanChecksSchema.optional() }).strict();
export type PatchRunPlan = z.infer<typeof PatchRunPlanSchema>;
export const PatchRunHandoffSchema = z.object({
  patchSha256: sha256, sourceSha256: sha256, bytes: money.max(1048576),
  summary: z.string().max(16384), checkSourceSha256: sha256.optional(),
}).strict();
export type PatchRunHandoff = z.infer<typeof PatchRunHandoffSchema>;

export const PatchRunSnapshotSchema = z.object({
  id: PatchRunIdSchema,
  schemaVersion: z.literal(PATCH_RUN_SCHEMA_VERSION),
  objective: z.string().min(1).max(20_000),
  title: z.string().min(1).max(100),
  workspaceLabel: z.string().min(1).max(256),
  baseRevision: z.string().max(128),
  policy: PatchRunPolicySchema,
  routingSelection: PatchRunRoutingSelectionSchema.optional(),
  executionMode: z.enum(["scripted", "live"]),
  status: PatchRunStatusSchema,
  phase: PatchRunPhaseSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  providerLabel: z.string().max(256),
  spentMicrousd: money,
  reservedMicrousd: money,
  elapsedMs: money,
  maxCostMicrousd: money,
  events: z.array(PatchRunEventSchema).max(200),
  patch: PatchRunPatchSchema.optional(),
  checks: PatchRunChecksSchema,
  error: z.string().max(2_000).optional(),
  localSummary: z.string().max(4_096).optional(),
  localInvestigation: PatchRunLocalInvestigationSchema.optional(),
  phaseUsage: z.object({ scout: PatchRunPhaseUsageSchema.optional(), cloud: PatchRunPhaseUsageSchema.optional(),
    local: PatchRunPhaseUsageSchema.optional(), planner: PatchRunPhaseUsageSchema.optional(), critic: PatchRunPhaseUsageSchema.optional() }).strict().optional(),
  checkpoint: PatchRunCheckpointSchema.optional(),
  checkpointCheck: PatchRunCheckpointCheckSchema.optional(),
  plannerCheck: PatchRunPlannerCheckSchema.optional(),
  cloudPlan: PatchRunPlanSchema.optional(),
  handoff: PatchRunHandoffSchema.optional(),
  cloudRecoveryCount: z.number().int().min(0).max(1).optional(),
  criticDraft: PatchRunCriticDraftSchema.optional(),
  critic: PatchRunCriticReceiptSchema.optional(),
  /** Receipt remains immutable; repair or later commands revoke currency for final source. */
  criticCurrent: z.boolean().optional(),
  /** First host-observed worker cleanup outcome. Missing is unknown, not success. */
  cleanupConfirmed: z.boolean().optional(),
  decision: PatchRunDecisionSchema.optional(),
}).strict().superRefine((value, context) => {
  const selection = value.routingSelection;
  if (selection && (selection.selectedPolicy !== value.policy || selection.baseRevision !== value.baseRevision ||
      selection.maxCostMicrousd !== value.maxCostMicrousd || value.executionMode !== "live")) {
    context.addIssue({ code: "custom", message: "Run differs from its immutable automatic selection." });
  }
});
export type PatchRunSnapshot = z.infer<typeof PatchRunSnapshotSchema>;

export interface PatchRunAvailability {
  ready: boolean;
  executionMode: PatchRunExecutionMode;
  cloudReady: boolean;
  localReady: boolean;
  criticReady?: boolean;
  dockerReady: boolean;
  blockedReasons: string[];
  maxEpisodeCostMicrousd: number;
  cloudLabel?: string;
  localLabel?: string;
}

export const PatchRunDecisionInputSchema = z.object({
  id: PatchRunIdSchema,
  decision: PatchRunDecisionSchema,
}).strict();
export type PatchRunDecisionInput = z.infer<typeof PatchRunDecisionInputSchema>;
export interface PatchRunExportResult { exported: boolean; filePath?: string }

export interface SoarPatchRunApi {
  getPatchRunAvailability(): Promise<PatchRunAvailability>;
  createPatchRun(input: PatchRunCreateInput): Promise<PatchRunSnapshot>;
  listPatchRuns(): Promise<PatchRunSnapshot[]>;
  getPatchRun(id: string): Promise<PatchRunSnapshot>;
  startPatchRun(id: string): Promise<PatchRunSnapshot>;
  cancelPatchRun(id: string): Promise<PatchRunSnapshot>;
  exportPatchRun(id: string): Promise<PatchRunExportResult>;
  decidePatchRun(input: PatchRunDecisionInput): Promise<PatchRunSnapshot>;
  subscribePatchRuns(listener: (snapshot: PatchRunSnapshot) => void): () => void;
}

export const PATCH_RUN_IPC_CHANNELS = {
  getPatchRunAvailability: "soar:patch-run-availability",
  createPatchRun: "soar:patch-run-create",
  listPatchRuns: "soar:patch-run-list",
  getPatchRun: "soar:patch-run-get",
  startPatchRun: "soar:patch-run-start",
  cancelPatchRun: "soar:patch-run-cancel",
  exportPatchRun: "soar:patch-run-export",
  decidePatchRun: "soar:patch-run-decide",
  patchRunUpdate: "soar:patch-run-update",
} as const;

export function isPatchRunTerminal(status: PatchRunStatus): boolean {
  return status !== "created" && status !== "running";
}
