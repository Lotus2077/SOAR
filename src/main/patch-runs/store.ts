import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { patchCampaignExposure } from "./comparison-schema";
import { canonicalRequest } from "./native-contract";

import {
  isPatchRunTerminal,
  PatchRunChecksSchema,
  PatchRunDecisionSchema,
  PatchRunEventSchema,
  PatchRunIdSchema,
  PatchRunLocalInvestigationSchema,
  PatchRunPatchSchema,
  PatchRunPhaseSchema,
  PatchRunPolicySchema,
  PatchRunRoutingSelectionSchema, type PatchRunRoutingSelection,
  PatchRunRequestPhaseSchema,
  PatchRunSnapshotSchema,
  isNativePatchPolicy, patchPolicyNeedsPlan, PatchRunCheckpointSchema, PatchRunCheckpointCheckSchema, PatchRunPlanSchema, PatchRunHandoffSchema,
  type PatchRunCheckpoint, type PatchRunCheckpointCheck, type PatchRunPlan, type PatchRunHandoff,
  PatchRunPlannerCheckSchema, type PatchRunPlannerCheck,
  PatchRunCriticDraftSchema, PatchRunCriticReceiptSchema, type PatchRunCriticDraft, type PatchRunCriticReceipt,
  type PatchRunChecks,
  type PatchRunDecision,
  type PatchRunExecutionMode,
  type PatchRunLocalInvestigation,
  type PatchRunPhaseUsage,
  type PatchRunPatch,
  type PatchRunPhase,
  type PatchRunPolicy,
  type PatchRunSnapshot,
  type PatchRunStatus,
} from "../../shared/patch-run-contracts";
import type { SoarDatabase } from "../database";

const money = z.number().int().nonnegative().safe();
const requestId = z.string().min(1).max(256);
const timestamp = z.string().datetime();
const label = z.string().min(1).max(256);

const criticEvidenceSchema = z.object({
  localPhase: z.enum(["draft", "repair"]), phaseLocalCalls: money.max(8), phaseLocalLimit: z.union([z.literal(8), z.literal(4)]),
  criticUsed: z.boolean(), repairUsed: z.boolean(), repairStartLocalCalls: money.max(8).nullable(),
}).passthrough();
/** The repair allowance is part of one cumulative episode, never a reset. */
export function validateCriticCheckpointBudget(checkpoint: PatchRunCheckpoint): void {
  const e = criticEvidenceSchema.parse(checkpoint.evidence);
  if (checkpoint.policy !== "local_critic_repair" || checkpoint.localCalls > 12 ||
      e.phaseLocalLimit !== (e.localPhase === "draft" ? 8 : 4) || e.phaseLocalCalls > e.phaseLocalLimit ||
      checkpoint.remainingLocalCalls !== e.phaseLocalLimit - e.phaseLocalCalls ||
      (e.localPhase === "draft" ? (e.repairUsed || e.repairStartLocalCalls !== null || checkpoint.localCalls !== e.phaseLocalCalls) :
        (!e.criticUsed || !e.repairUsed || e.repairStartLocalCalls === null || checkpoint.localCalls !== e.repairStartLocalCalls + e.phaseLocalCalls)) ||
      checkpoint.handoffUsed || checkpoint.handoffCandidate || ["planner", "cloud"].includes(checkpoint.state) || checkpoint.decision === "escalate") {
    throw new Error("Critic checkpoint changed its cumulative draft or repair allowance.");
  }
}

function validateCriticTransition(snapshot: PatchRunSnapshot, next: PatchRunCheckpoint): void {
  validateCriticCheckpointBudget(next);
  const e = criticEvidenceSchema.parse(next.evidence), previous = snapshot.checkpoint;
  const prior = previous && criticEvidenceSchema.parse(previous.evidence);
  if (!previous || !prior) {
    if (next.reason !== "initialized" || next.state !== "local" || next.decision !== "continue" || next.localCalls !== 0 ||
        e.criticUsed || e.repairUsed || e.localPhase !== "draft") throw new Error("Critic policy requires its initial draft checkpoint.");
    return;
  }
  if (["submitted", "stopped"].includes(previous.state) && next.decision !== "stop") {
    throw new Error("Critic checkpoint cannot reopen a submitted or stopped phase.");
  }
  if (next.checkSourceSha256 !== null && next.checkSourceSha256 !== previous.checkSourceSha256 &&
      (next.reason !== "visible_check_passed" || !snapshot.checkpointCheck?.passed || !snapshot.checkpointCheck.fresh ||
        snapshot.checkpointCheck.sourceSha256 !== next.sourceSha256 || snapshot.checkpointCheck.sourceAfterSha256 !== next.sourceSha256)) {
    throw new Error("Critic checkpoint cannot invent a fresh check or reuse the inherited draft check.");
  }
  const repairGrant = next.reason === "critic_repair_required";
  const criticStart = next.reason === "critic_request_started";
  const localStart = next.reason === "local_request_started";
  if (next.localCalls !== previous.localCalls + (localStart ? 1 : 0) ||
      (localStart && (previous.state !== "local" || previous.decision !== "continue" || previous.reason === "local_request_started")) ||
      (!repairGrant && (e.localPhase !== prior.localPhase || e.repairUsed !== prior.repairUsed ||
        e.repairStartLocalCalls !== prior.repairStartLocalCalls || e.phaseLocalCalls !== prior.phaseLocalCalls + (localStart ? 1 : 0))) ||
      e.criticUsed !== (criticStart ? true : prior.criticUsed)) throw new Error("Critic checkpoint reset or skipped its phase counters.");
  if (next.sourceSha256 !== previous.sourceSha256 && !["command_observed", "finish_required", "visible_check_tree_changed", "visible_checks_failed", "execution_failure", "cancelled"].includes(next.reason)) {
    throw new Error("Critic checkpoint changed source outside a source observation.");
  }
  if (next.reason === "critic_required") {
    if (snapshot.phase !== "local_solver" || snapshot.criticDraft || prior.criticUsed || e.localPhase !== "draft" ||
        previous.reason !== "local_request_started" || next.state !== "critic" || next.decision !== "checkpoint" ||
        !snapshot.checkpointCheck?.passed || !snapshot.checkpointCheck.fresh || snapshot.checkpointCheck.sourceSha256 !== next.sourceSha256 ||
        snapshot.checkpointCheck.sourceAfterSha256 !== next.sourceSha256 || next.checkSourceSha256 !== next.sourceSha256) {
      throw new Error("Critic draft requires its fresh checked provisional submission.");
    }
  } else if (criticStart) {
    const draft = snapshot.criticDraft;
    if (previous.reason !== "critic_required" || previous.state !== "critic" || prior.criticUsed || !draft ||
        next.state !== "critic" || next.decision !== "continue" || next.eventId !== draft.requestId ||
        ["requestId", "sourceSha256", "patchSha256", "bundleSha256", "bodySha256"].some(key =>
          next.evidence[key] !== draft[key as keyof PatchRunCriticDraft])) throw new Error("Critic request lacks its once-only host context grant.");
  } else if (["critic_acceptable", "critic_repair_required", "critic_insufficient_context"].includes(next.reason)) {
    const receipt = snapshot.critic;
    if (previous.reason !== "critic_request_started" || !receipt || snapshot.phase !== "cloud_critic" ||
        next.evidence.criticReceiptSha256 !== receipt.receiptSha256 || next.sourceSha256 !== receipt.sourceSha256 ||
        next.reason !== `critic_${receipt.result.verdict}` || (repairGrant ?
          (prior.repairUsed || e.localPhase !== "repair" || !e.repairUsed || e.phaseLocalCalls !== 0 ||
            e.repairStartLocalCalls !== next.localCalls || next.state !== "local" || next.decision !== "continue" || next.checkSourceSha256 !== null) :
          receipt.result.verdict === "acceptable" ? (next.state !== "submitted" || next.decision !== "submit") :
            (next.state !== "stopped" || next.decision !== "stop"))) throw new Error("Critic verdict or repair grant differs from its settled receipt.");
  } else if (next.state === "critic" || (previous.state === "critic" && next.decision !== "stop")) {
    throw new Error("Critic state can only advance through its bound request and verdict.");
  }
  if (prior.repairUsed && next.evidence.criticReceiptSha256 !== snapshot.critic?.receiptSha256) throw new Error("Repair omitted its immutable critic receipt.");
  if (next.decision === "submit" && !((next.reason === "critic_acceptable" && snapshot.critic?.result.verdict === "acceptable") ||
      (e.localPhase === "repair" && e.repairUsed && snapshot.critic?.result.verdict === "repair_required"))) {
    throw new Error("Submission bypassed the required critic verdict.");
  }
}

const createSchema = z.object({
  workspaceRoot: z.string().min(1).max(4_096).refine((value) => path.isAbsolute(value)),
  objective: z.string().trim().min(1).max(20_000),
  policy: PatchRunPolicySchema,
  routingSelection: PatchRunRoutingSelectionSchema.optional(),
  executionMode: z.enum(["scripted", "live"]),
  baseRevision: z.string().max(128),
  workspaceLabel: label.optional(),
  maxCostMicrousd: money,
  visibleTestCommand: z.string().max(4_096).optional(),
  providerLabel: z.string().max(256).optional(),
}).strict();

export interface CreatePatchRunRecord {
  workspaceRoot: string;
  objective: string;
  policy: PatchRunPolicy;
  routingSelection?: PatchRunRoutingSelection;
  executionMode: PatchRunExecutionMode;
  baseRevision: string;
  workspaceLabel?: string;
  maxCostMicrousd: number;
  visibleTestCommand?: string;
  providerLabel?: string;
}

const reservationSchema = z.object({
  requestId,
  amountMicrousd: money,
  providerLabel: label,
  model: label.optional(),
  inputSha256: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  /** Main-owned phase; absent in legacy requests, which stay unattributed. */
  phase: PatchRunRequestPhaseSchema.optional(),
  /** Controller-owned authority; never accepted directly from renderer input. */
  campaignLimitMicrousd: money.min(1).max(250_000_000).optional(),
}).strict();
export type PatchRequestReservation = z.infer<typeof reservationSchema>;

const finishRequestSchema = z.object({
  requestId,
  outcome: z.enum(["succeeded", "failed", "not_sent", "unknown"]),
  actualCostMicrousd: money.optional(),
  usage: z.object({
    inputTokens: money,
    outputTokens: money,
    cacheReadTokens: money.optional(),
    cacheWriteTokens: money.optional(),
    reasoningTokens: money.optional(),
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  if ((value.outcome === "succeeded" || value.outcome === "failed") &&
      value.actualCostMicrousd === undefined) {
    context.addIssue({ code: "custom", message: "Known settlement requires actual cost" });
  }
  if ((value.outcome === "unknown" || value.outcome === "not_sent") &&
      value.actualCostMicrousd !== undefined) {
    context.addIssue({ code: "custom", message: "Unsent/unknown outcomes must not claim actual cost" });
  }
});
export type PatchRequestFinish = z.infer<typeof finishRequestSchema>;

interface RunRow {
  id: string;
  workspace_root: string;
  started_at: string | null;
  snapshot_json: string;
}
interface RequestRow {
  request_id: string;
  run_id: string;
  state: "reserved" | "started" | PatchRequestFinish["outcome"];
  reservation_microusd: number;
  actual_microusd: number | null;
  admission_json: string;
  finish_json: string | null;
}
type TerminalStatus = Exclude<PatchRunStatus, "created" | "running">;
type SnapshotChanges = Partial<Omit<PatchRunSnapshot, "id" | "schemaVersion" | "events">>;

function safeSum(left: number, right: number): number {
  return money.parse(left + right);
}

function emptyPhaseUsage(providerLabel: string): PatchRunPhaseUsage {
  return { providerLabel, requestCount: 0, usageReceipts: 0, unknownRequests: 0,
    spentMicrousd: 0, reservedMicrousd: 0, inputTokens: 0, outputTokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
}

/**
 * Main-only storage. Event records are canonical; run and request tables are
 * transactionally maintained projections. Legacy session/budget tables are
 * never touched. This class stores no credentials or raw provider requests.
 */
export class PatchRunStore {
  private readonly now: () => string;

  constructor(private readonly database: SoarDatabase, options: { now?: () => string } = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private row(id: string): RunRow {
    PatchRunIdSchema.parse(id);
    const row = this.database.prepare("SELECT * FROM patch_runs WHERE id = ?").get(id) as RunRow | undefined;
    if (!row) throw new Error("Coding run was not found.");
    return row;
  }

  get(id: string): PatchRunSnapshot {
    return PatchRunSnapshotSchema.parse(JSON.parse(this.row(id).snapshot_json));
  }

  campaignExposureMicrousd(): number {
    return patchCampaignExposure(this.database).microusd;
  }

  getWorkspaceRoot(id: string): string {
    return this.row(id).workspace_root;
  }

  list(limit = 100): PatchRunSnapshot[] {
    z.number().int().min(1).max(500).parse(limit);
    const rows = this.database.prepare(
      "SELECT snapshot_json FROM patch_runs ORDER BY updated_at DESC, id ASC LIMIT ?",
    ).all(limit) as Array<{ snapshot_json: string }>;
    return rows.map((row) => PatchRunSnapshotSchema.parse(JSON.parse(row.snapshot_json)));
  }

  /** Minimal, uncapped startup cleanup inventory; UI list limits are irrelevant. */
  listStartedRunIds(scope?: readonly string[]): string[] {
    return (this.database.prepare("SELECT id FROM patch_runs WHERE status != 'created' ORDER BY id").all() as Array<{ id: string }>)
      .map(({ id }) => id).filter((id) => scope === undefined || scope.includes(id));
  }

  private event(
    id: string,
    type: string,
    summary: string,
    changes: SnapshotChanges = {},
    detail?: unknown,
  ): PatchRunSnapshot {
    const row = this.row(id);
    const previous = PatchRunSnapshotSchema.parse(JSON.parse(row.snapshot_json));
    const currentTime = timestamp.parse(this.now());
    const createdAt = currentTime < previous.updatedAt ? previous.updatedAt : currentTime;
    const sequenceRow = this.database.prepare(
      "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM patch_run_events WHERE run_id = ?",
    ).get(id) as { sequence: number };
    const event = PatchRunEventSchema.parse({
      sequence: sequenceRow.sequence + 1, type, summary, createdAt,
    });
    const elapsedMs = row.started_at === null ? 0 :
      isPatchRunTerminal(previous.status) ? previous.elapsedMs :
        Math.max(previous.elapsedMs, Date.parse(createdAt) - Date.parse(row.started_at));
    const durableChanges = { ...changes, updatedAt: createdAt, elapsedMs };
    const snapshot = PatchRunSnapshotSchema.parse({
      ...previous, ...durableChanges, events: [...previous.events, event].slice(-200),
    });
    this.database.prepare(
      "INSERT INTO patch_run_events (run_id, sequence, type, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, event.sequence, type, summary, JSON.stringify({ changes: durableChanges, detail }), createdAt);
    this.database.prepare(
      "UPDATE patch_runs SET status = ?, updated_at = ?, snapshot_json = ? WHERE id = ?",
    ).run(snapshot.status, snapshot.updatedAt, JSON.stringify(snapshot), id);
    return snapshot;
  }

  private mutate(id: string, operation: (snapshot: PatchRunSnapshot) => PatchRunSnapshot): PatchRunSnapshot {
    return this.database.transaction(() => operation(this.get(id))).immediate();
  }

  private requireRunning(snapshot: PatchRunSnapshot): void {
    if (snapshot.status !== "running") throw new Error("Coding run is not running.");
  }

  create(raw: CreatePatchRunRecord): PatchRunSnapshot {
    const input = createSchema.parse(raw);
    const id = randomUUID();
    const createdAt = timestamp.parse(this.now());
    const initial = PatchRunSnapshotSchema.parse({
      id, schemaVersion: "patch-run-v1", objective: input.objective,
      title: input.objective.split(/\r?\n/u)[0].slice(0, 100),
      workspaceLabel: input.workspaceLabel ?? (path.basename(input.workspaceRoot) || "Repository"),
      baseRevision: input.baseRevision, policy: input.policy, executionMode: input.executionMode,
      ...(input.routingSelection ? { routingSelection: input.routingSelection } : {}),
      status: "created", phase: "pending", createdAt, updatedAt: createdAt,
      providerLabel: input.providerLabel ?? "", spentMicrousd: 0, reservedMicrousd: 0,
      elapsedMs: 0, maxCostMicrousd: input.maxCostMicrousd, events: [],
      checks: { status: "not_run", command: input.visibleTestCommand ?? "", exitCode: null, output: "" },
    });
    return this.database.transaction(() => {
      this.database.prepare(
        "INSERT INTO patch_runs (id, workspace_root, status, updated_at, snapshot_json) VALUES (?, ?, ?, ?, ?)",
      ).run(id, input.workspaceRoot, initial.status, createdAt, JSON.stringify(initial));
      return this.event(id, "run.created", input.executionMode === "scripted"
        ? "Scripted mechanics run created; no model will be contacted."
        : "Coding run created.", {}, { initial });
    }).immediate();
  }

  start(id: string): PatchRunSnapshot {
    return this.mutate(id, (snapshot) => {
      if (snapshot.status === "running") return snapshot;
      if (snapshot.status !== "created") throw new Error("A terminal coding run cannot restart.");
      this.database.prepare("UPDATE patch_runs SET started_at = ? WHERE id = ?")
        .run(timestamp.parse(this.now()), id);
      return this.event(id, "run.started", "Preparing an isolated repository copy.", {
        status: "running", phase: "preparing",
      });
    });
  }

  setPhase(id: string, phase: PatchRunPhase, providerLabel?: string): PatchRunSnapshot {
    PatchRunPhaseSchema.parse(phase);
    if (providerLabel !== undefined) z.string().max(256).parse(providerLabel);
    return this.mutate(id, (snapshot) => {
      this.requireRunning(snapshot);
      if (snapshot.policy === "local_critic_repair" && (!["preparing", "local_solver", "cloud_critic", "checking"].includes(phase) ||
          (phase === "preparing" && (snapshot.phase !== "preparing" || snapshot.checkpoint !== undefined ||
            Object.keys(snapshot.phaseUsage ?? {}).length !== 0)) ||
          (phase === "cloud_critic" && (snapshot.phase !== "local_solver" || snapshot.checkpoint?.reason !== "critic_request_started" || !snapshot.criticDraft)) ||
          (phase === "local_solver" && snapshot.phase !== "preparing" && !(snapshot.phase === "cloud_critic" &&
            snapshot.checkpoint?.reason === "critic_repair_required" && snapshot.critic?.result.verdict === "repair_required")) ||
          (phase === "checking" && snapshot.checkpoint?.decision !== "submit"))) throw new Error("Critic policy phase is not admitted.");
      return this.event(id, "phase.changed", `Phase: ${phase.replaceAll("_", " ")}.`, {
        phase, ...(providerLabel === undefined ? {} : { providerLabel }),
      });
    });
  }

  recordEvent(id: string, input: { type: string; summary: string }): PatchRunSnapshot {
    return this.mutate(id, (snapshot) => {
      if (isPatchRunTerminal(snapshot.status)) throw new Error("Coding run is already terminal.");
      return this.event(id, input.type, input.summary);
    });
  }

  recordCleanup(id: string, confirmed: boolean): PatchRunSnapshot {
    z.boolean().parse(confirmed);
    return this.mutate(id, (snapshot) => {
      if (snapshot.cleanupConfirmed !== undefined) {
        if (snapshot.cleanupConfirmed !== confirmed) throw new Error("Original worker cleanup outcome is immutable.");
        return snapshot;
      }
      this.requireRunning(snapshot);
      return this.event(id, "cleanup.result", confirmed
        ? "Host confirmed that all task containers were removed."
        : "Host could not confirm task container cleanup; the evaluation batch must stop.",
      { cleanupConfirmed: confirmed });
    });
  }

  recordTool(id: string, raw: { command: string; exitCode: number | null; output: string; durationMs?: number }): PatchRunSnapshot {
    const tool = z.object({ command: z.string().max(4_096), exitCode: z.number().int().nullable(),
      output: z.string().max(65_536), durationMs: money.optional() }).strict().parse(raw);
    return this.mutate(id, (snapshot) => {
      this.requireRunning(snapshot);
      return this.event(id, "tool.finished", `Command ${tool.exitCode === 0 ? "completed" : "finished with an error"}: ${tool.command.slice(0, 850)}`,
        { ...(snapshot.plannerCheck?.fresh ? { plannerCheck: { ...snapshot.plannerCheck, fresh: false } } : {}),
          ...(snapshot.critic ? { criticCurrent: false } : {}) }, tool);
    });
  }

  recordChecks(id: string, raw: PatchRunChecks): PatchRunSnapshot {
    const checks = PatchRunChecksSchema.parse(raw);
    return this.mutate(id, (snapshot) => {
      this.requireRunning(snapshot);
      if (snapshot.patch?.kind === "recovered" && checks.status !== "not_run") {
        throw new Error("Recovered unfinished work has no submitted check result.");
      }
      if (snapshot.policy === "local_critic_repair" && checks.status !== "not_run" &&
          (snapshot.phase !== "checking" || snapshot.checks.status !== "not_run" || snapshot.checkpoint?.decision !== "submit" ||
            checks.command !== snapshot.checks.command || checks.sourceSha256 !== snapshot.checkpoint.sourceSha256 ||
            (checks.status === "passed" && (checks.exitCode !== 0 || checks.sourceAfterSha256 !== checks.sourceSha256)))) {
        throw new Error("Critic final check differs from its submitted source and fresh invocation.");
      }
      return this.event(id, "checks.finished", `Visible checks: ${checks.status}.`, { checks,
        ...(snapshot.critic && checks.sourceAfterSha256 && checks.sourceAfterSha256 !== snapshot.critic.sourceSha256 ? { criticCurrent: false } : {}) });
    });
  }

  recordPatch(id: string, raw: PatchRunPatch): PatchRunSnapshot {
    const patch = PatchRunPatchSchema.parse(raw);
    if (createHash("sha256").update(patch.text, "utf8").digest("hex") !== patch.sha256) {
      throw new Error("Patch content does not match its identity.");
    }
    for (const file of patch.files) {
      if (path.posix.isAbsolute(file) || path.win32.isAbsolute(file) ||
          file.includes("\0") || file.split(/[\\/]/u).includes("..")) {
        throw new Error("Patch contains an unsafe file path.");
      }
    }
    return this.mutate(id, (snapshot) => {
      this.requireRunning(snapshot);
      // A verifier may have changed files before cancellation. That work must
      // never replace the immutable submission the owner is already reviewing.
      if (patch.kind === "recovered" && snapshot.patch && snapshot.patch.kind !== "recovered") return snapshot;
      const recovered = patch.kind === "recovered";
      if (!recovered && snapshot.policy === "cloud_plan_local_review" &&
          (snapshot.phase !== "cloud_solver" || snapshot.cloudRecoveryCount !== 1 || !snapshot.cloudPlan || !snapshot.handoff)) {
        throw new Error("Reviewed-policy submission requires the admitted cloud review phase.");
      }
      if (!recovered && snapshot.policy === "cloud_plan_local_review" && (this.hasUnresolvedRequests(id) ||
          (snapshot.executionMode !== "scripted" && (!snapshot.phaseUsage?.cloud?.usageReceipts ||
            snapshot.phaseUsage.cloud.requestCount !== snapshot.phaseUsage.cloud.usageReceipts)))) {
        throw new Error("Reviewed-policy submission requires a settled cloud review response.");
      }
      if (!recovered && snapshot.policy === "local_critic_repair" &&
          (snapshot.patch?.kind === "submitted" || !snapshot.critic || snapshot.critic.result.verdict === "insufficient_context" ||
            snapshot.checkpoint?.decision !== "submit" || this.hasUnresolvedRequests(id) ||
            (snapshot.critic.result.verdict === "acceptable" && (!snapshot.criticCurrent || patch.sha256 !== snapshot.critic.patchSha256)))) {
        throw new Error("Critic policy patch lacks its exact admitted submission.");
      }
      return this.event(id, recovered ? "patch.recovered" : "patch.ready",
        recovered ? `Unfinished work recovered (${patch.files.length} files); not submitted or checked.` : `Patch captured (${patch.files.length} files).`,
        { patch, ...(recovered ? { checks: { status: "not_run", command: snapshot.checks.command, exitCode: null, output: "" } as PatchRunChecks } : {}) });
    });
  }

  setLocalSummary(id: string, summary: string, rawInvestigation?: PatchRunLocalInvestigation): PatchRunSnapshot {
    z.string().max(4_096).parse(summary);
    const localInvestigation = rawInvestigation === undefined ? undefined : PatchRunLocalInvestigationSchema.parse(rawInvestigation);
    return this.mutate(id, (snapshot) => {
      this.requireRunning(snapshot);
      if (snapshot.policy !== "hybrid") throw new Error("Local investigation is not part of this policy.");
      if (localInvestigation?.outcome === "partial" && (!summary.trim() || localInvestigation.fallbackReason !== undefined)) {
        throw new Error("Partial local investigation requires source evidence without a fallback reason.");
      }
      if (localInvestigation?.outcome !== undefined && localInvestigation.outcome !== "completed" && localInvestigation.outcome !== "partial" && summary) {
        throw new Error("A stopped or fallback local investigation cannot claim evidence was handed to cloud.");
      }
      return this.event(id, "local.finished", localInvestigation?.outcome === "partial"
        ? "Local step limit reached; partial source observations prepared for cloud."
        : localInvestigation?.outcome === "fallback"
        ? "Local investigation fell back to the host inventory."
        : localInvestigation?.outcome === "stopped" ? "Local investigation stopped; no cloud continuation was authorized."
        : summary.trim() ? "Host-captured local observations prepared for cloud." : "Local investigation finished without source evidence.",
      { localSummary: summary, ...(localInvestigation ? { localInvestigation } : {}) });
    });
  }

  hasUnresolvedRequests(id: string): boolean {
    this.get(id);
    return Boolean(this.database.prepare("SELECT request_id FROM patch_run_requests WHERE run_id = ? AND state IN ('reserved','started','unknown') LIMIT 1").get(id));
  }

  recordCheckpointCheck(id: string, raw: PatchRunCheckpointCheck): PatchRunSnapshot {
    const check = PatchRunCheckpointCheckSchema.parse(raw);
    return this.mutate(id, (snapshot) => {
      this.requireRunning(snapshot);
      if (!isNativePatchPolicy(snapshot.policy) || snapshot.phase !== "local_solver" || this.hasUnresolvedRequests(id) ||
          check.command !== snapshot.checks.command || check.fresh !== (check.sourceSha256 === check.sourceAfterSha256) ||
          check.passed !== (check.exitCode === 0 && check.sourceSha256 === check.sourceAfterSha256)) {
        throw new Error("Trusted checkpoint check does not match its source or command authority.");
      }
      return this.event(id, "checkpoint.checked", check.passed ? "Exact visible check passed on an unchanged source snapshot."
        : "Exact visible check failed or changed its verification snapshot.", { checkpointCheck: check });
    });
  }

  recordPlannerCheck(id: string, raw: PatchRunPlannerCheck): PatchRunSnapshot {
    const plannerCheck = PatchRunPlannerCheckSchema.parse(raw);
    return this.mutate(id, (snapshot) => {
      this.requireRunning(snapshot);
      const artifact = snapshot.cloudPlan?.checks;
      if (!artifact || this.hasUnresolvedRequests(id) ||
          snapshot.phase !== (plannerCheck.stage === "checkpoint" ? "local_solver" : "checking") ||
          plannerCheck.artifactSha256 !== artifact.sha256 ||
          (plannerCheck.result !== null && plannerCheck.result.expectedTests !== artifact.expectedTests) ||
          plannerCheck.fresh !== (plannerCheck.sourceSha256 === plannerCheck.sourceAfterSha256)) {
        throw new Error("Generated planner check does not match its artifact, phase or source authority.");
      }
      return this.event(id, "planner.checks.checked", plannerCheck.passed
        ? "Model-generated checks passed on an unchanged source snapshot; this is not independent acceptance."
        : "Model-generated checks failed or did not produce a complete valid result.", { plannerCheck });
    });
  }

  invalidateCheckpointCheck(id: string): PatchRunSnapshot {
    return this.mutate(id, (snapshot) => {
      this.requireRunning(snapshot);
      if (!snapshot.checkpointCheck?.fresh && !snapshot.plannerCheck?.fresh && !snapshot.criticCurrent) return snapshot;
      return this.event(id, "checkpoint.check_invalidated", "A later command requires source freshness to be established again.",
        { ...(snapshot.checkpointCheck ? { checkpointCheck: { ...snapshot.checkpointCheck, fresh: false } } : {}),
          ...(snapshot.plannerCheck ? { plannerCheck: { ...snapshot.plannerCheck, fresh: false } } : {}),
          ...(snapshot.critic ? { criticCurrent: false } : {}) });
    });
  }

  recordCheckpoint(id: string, raw: PatchRunCheckpoint): PatchRunSnapshot {
    const checkpoint = PatchRunCheckpointSchema.parse(raw);
    const { evidenceId, ...evidence } = checkpoint;
    if (createHash("sha256").update(canonicalRequest(evidence)).digest("hex") !== evidenceId) throw new Error("Checkpoint evidence identity mismatch.");
    return this.mutate(id, (snapshot) => {
      this.requireRunning(snapshot);
      if (!isNativePatchPolicy(snapshot.policy) || checkpoint.policy !== snapshot.policy ||
          checkpoint.sequence !== (snapshot.checkpoint?.sequence ?? 0) + 1 ||
          checkpoint.previousEvidenceId !== (snapshot.checkpoint?.evidenceId ?? null) ||
          (checkpoint.decision !== "stop" && this.hasUnresolvedRequests(id))) throw new Error("Checkpoint is outside its ordered execution authority.");
      if (snapshot.policy === "local_critic_repair") validateCriticTransition(snapshot, checkpoint);
      // The local router does not observe later cloud edits. Final receipts are
      // bound to the exported source by their own verification invocation.
      const plannerCheck = snapshot.plannerCheck?.stage === "checkpoint" ? { ...snapshot.plannerCheck,
        fresh: snapshot.plannerCheck.sourceSha256 === checkpoint.sourceSha256 &&
          snapshot.plannerCheck.sourceAfterSha256 === checkpoint.sourceSha256 } : snapshot.plannerCheck;
      if (snapshot.cloudPlan?.checks && (checkpoint.decision === "submit" || checkpoint.state === "submitted" || checkpoint.reason === "review_required" ||
          checkpoint.checkSourceSha256 !== null) && (!plannerCheck?.passed || !plannerCheck.fresh ||
          plannerCheck.stage !== "checkpoint" || plannerCheck.artifactSha256 !== snapshot.cloudPlan.checks.sha256 ||
          (checkpoint.checkSourceSha256 !== null && checkpoint.checkSourceSha256 !== checkpoint.sourceSha256))) {
        throw new Error("Local check success requires a fresh passing generated planner check on the same source.");
      }
      if (snapshot.policy === "cloud_plan_local_review" && (checkpoint.decision === "submit" || checkpoint.state === "submitted")) {
        throw new Error("Local submission is provisional and requires cloud review.");
      }
      if (checkpoint.reason === "review_required" || checkpoint.reason === "review_time_reserve") {
        if (snapshot.policy !== "cloud_plan_local_review" || snapshot.phase !== "local_solver" ||
            checkpoint.decision !== "checkpoint" || checkpoint.state !== "checkpoint" ||
            !checkpoint.handoffCandidate || checkpoint.handoffUsed || snapshot.handoff || (snapshot.cloudRecoveryCount ?? 0) !== 0) {
          throw new Error("Cloud review checkpoint is outside its local handoff authority.");
        }
        if (checkpoint.reason === "review_required" && (!snapshot.checkpointCheck?.passed ||
            snapshot.checkpointCheck.sourceSha256 !== checkpoint.sourceSha256 ||
            snapshot.checkpointCheck.sourceAfterSha256 !== checkpoint.sourceSha256 ||
            checkpoint.checkSourceSha256 !== checkpoint.sourceSha256 || checkpoint.evidence.checkSourceSha256 !== checkpoint.sourceSha256)) {
          throw new Error("Cloud review requires a fresh passing exact check on the provisional source.");
        }
        if (checkpoint.reason === "review_time_reserve") {
          const timing = z.object({ remainingMs: money, requestTimeoutMs: money.positive(),
            checkReserveMs: money.positive(), requiredReviewReserveMs: money.positive() }).passthrough().parse(checkpoint.evidence);
          if (timing.requiredReviewReserveMs !== 2 * (timing.requestTimeoutMs + timing.checkReserveMs) ||
              timing.remainingMs > timing.requiredReviewReserveMs) throw new Error("Cloud review reserve evidence is inconsistent.");
        }
      }
      if (checkpoint.decision === "submit" && ((snapshot.phase !== "local_solver" && !(snapshot.policy === "local_critic_repair" && snapshot.phase === "cloud_critic")) || !snapshot.checkpointCheck?.passed ||
          checkpoint.sourceSha256 !== snapshot.checkpointCheck.sourceSha256 || checkpoint.checkSourceSha256 !== checkpoint.sourceSha256 ||
          (snapshot.policy === "local_critic_repair" && !snapshot.checkpointCheck.fresh && snapshot.checkpoint?.checkSourceSha256 !== checkpoint.sourceSha256))) {
        throw new Error("Native submission requires a fresh passing exact check.");
      }
      if (checkpoint.decision === "escalate" && ((snapshot.policy === "local_only" || snapshot.policy === "local_critic_repair") || snapshot.phase !== "local_solver" ||
          (snapshot.cloudRecoveryCount ?? 0) !== 0 || !snapshot.handoff || checkpoint.reason !== "handoff_confirmed" ||
          snapshot.handoff.sourceSha256 !== checkpoint.sourceSha256 || !checkpoint.handoffUsed)) {
        throw new Error("Cloud recovery requires one explicitly confirmed artifact handoff.");
      }
      // The worker's source digest can re-establish that a read-only command
      // did not stale the last check. A boolean alone never establishes this.
      const check = snapshot.checkpointCheck;
      const checkpointCheck = check ? { ...check, fresh: (snapshot.policy !== "local_critic_repair" || checkpoint.checkSourceSha256 === checkpoint.sourceSha256) && check.sourceSha256 === checkpoint.sourceSha256 &&
        check.sourceAfterSha256 === checkpoint.sourceSha256 } : undefined;
      return this.event(id, "routing.checkpoint", `Checkpoint: ${checkpoint.decision} (${checkpoint.reason.replaceAll("_", " ")}).`,
        { checkpoint, ...(checkpointCheck ? { checkpointCheck: checkpoint.reason === "critic_repair_required" ? { ...checkpointCheck, fresh: false } : checkpointCheck } : {}),
          ...(plannerCheck ? { plannerCheck } : {}), ...(snapshot.critic ? { criticCurrent: snapshot.criticCurrent === true &&
            checkpoint.reason !== "critic_repair_required" && snapshot.critic.sourceSha256 === checkpoint.sourceSha256 } : {}) });
    });
  }

  recordCriticDraft(id: string, raw: PatchRunCriticDraft): PatchRunSnapshot {
    const draft = PatchRunCriticDraftSchema.parse(raw);
    return this.mutate(id, snapshot => {
      this.requireRunning(snapshot);
      const checkpoint = snapshot.checkpoint, usage = snapshot.phaseUsage?.local;
      if (snapshot.policy !== "local_critic_repair" || snapshot.phase !== "local_solver" || snapshot.criticDraft || snapshot.critic ||
          checkpoint?.reason !== "critic_required" || checkpoint.state !== "critic" || this.hasUnresolvedRequests(id) ||
          checkpoint.evidenceId !== draft.checkpointEvidenceId || draft.baseRevision !== snapshot.baseRevision ||
          draft.sourceSha256 !== checkpoint.sourceSha256 || draft.checkSourceSha256 !== checkpoint.checkSourceSha256 ||
          draft.objectiveSha256 !== createHash("sha256").update(snapshot.objective).digest("hex") ||
          draft.visibleCommandSha256 !== createHash("sha256").update(snapshot.checks.command).digest("hex") ||
          draft.draftLocalCalls !== checkpoint.localCalls || (snapshot.executionMode !== "scripted" &&
            (!usage || usage.requestCount !== draft.draftLocalCalls || usage.usageReceipts !== draft.draftLocalCalls || usage.unknownRequests !== 0))) {
        throw new Error("Critic context differs from its settled, checked draft authority.");
      }
      return this.event(id, "critic.context.ready", "Complete public critic context bound to the provisional draft.", { criticDraft: draft });
    });
  }

  recordCriticReceipt(id: string, raw: PatchRunCriticReceipt): PatchRunSnapshot {
    const receipt = PatchRunCriticReceiptSchema.parse(raw), { receiptSha256, ...value } = receipt;
    if (createHash("sha256").update(canonicalRequest(value)).digest("hex") !== receiptSha256) throw new Error("Critic receipt identity mismatch.");
    return this.mutate(id, snapshot => {
      this.requireRunning(snapshot);
      const draft = snapshot.criticDraft, usage = snapshot.phaseUsage?.critic;
      if (snapshot.policy !== "local_critic_repair" || snapshot.phase !== "cloud_critic" || snapshot.critic || !draft ||
          snapshot.checkpoint?.reason !== "critic_request_started" || this.hasUnresolvedRequests(id) ||
          ["requestId", "sourceSha256", "patchSha256", "bundleSha256", "bodySha256"].some(key => receipt[key as keyof PatchRunCriticReceipt] !== draft[key as keyof PatchRunCriticDraft]) ||
          snapshot.checkpoint.sourceSha256 !== receipt.sourceSha256 ||
          (snapshot.executionMode !== "scripted" && (!usage || usage.requestCount !== 1 || usage.usageReceipts !== 1 || usage.unknownRequests !== 0 || usage.reservedMicrousd !== 0))) {
        throw new Error("Critic verdict requires its one settled source-bound request.");
      }
      if (snapshot.executionMode !== "scripted") {
        const row = this.request(id, receipt.requestId), admission = reservationSchema.parse(JSON.parse(row.admission_json));
        if (row.state !== "succeeded" || admission.phase !== "critic" || admission.inputSha256 !== receipt.bodySha256) {
          throw new Error("Critic verdict request identity differs from its settled admission.");
        }
      }
      return this.event(id, "critic.verdict", `Compact critic: ${receipt.result.verdict.replaceAll("_", " ")}; model feedback is not independent acceptance.`,
        { critic: receipt, criticCurrent: true });
    });
  }

  recordPlan(id: string, raw: PatchRunPlan): PatchRunSnapshot {
    const cloudPlan = PatchRunPlanSchema.parse(raw);
    if (createHash("sha256").update(cloudPlan.summary).digest("hex") !== cloudPlan.sha256) throw new Error("Cloud plan identity mismatch.");
    if (cloudPlan.checks && createHash("sha256").update(cloudPlan.checks.source, "utf8").digest("hex") !== cloudPlan.checks.sha256) {
      throw new Error("Generated planner check source identity mismatch.");
    }
    return this.mutate(id, (snapshot) => {
      this.requireRunning(snapshot);
      if (!patchPolicyNeedsPlan(snapshot.policy) || snapshot.phase !== "cloud_planner" || snapshot.cloudPlan ||
          (snapshot.executionMode !== "scripted" && (snapshot.phaseUsage?.planner?.requestCount !== 1 || snapshot.phaseUsage.planner.usageReceipts !== 1)) || this.hasUnresolvedRequests(id)) {
        throw new Error("Cloud plan is outside its one-request planning authority.");
      }
      return this.event(id, "plan.ready", "One cloud planning response is ready for local execution.", { cloudPlan });
    });
  }

  recordHandoff(id: string, raw: PatchRunHandoff): PatchRunSnapshot {
    const handoff = PatchRunHandoffSchema.parse(raw);
    return this.mutate(id, (snapshot) => {
      this.requireRunning(snapshot);
      const checkpoint = snapshot.checkpoint;
      const expectedHash = snapshot.patch?.sha256 ?? createHash("sha256").update("").digest("hex");
      const expectedBytes = Buffer.byteLength(snapshot.patch?.text ?? "");
      if ((snapshot.policy !== "local_first" && !patchPolicyNeedsPlan(snapshot.policy)) || snapshot.phase !== "local_solver" ||
          checkpoint?.decision !== "checkpoint" || !checkpoint.handoffCandidate || snapshot.handoff ||
          (snapshot.cloudRecoveryCount ?? 0) !== 0 || this.hasUnresolvedRequests(id) ||
          handoff.sourceSha256 !== checkpoint.sourceSha256 || handoff.patchSha256 !== expectedHash || handoff.bytes !== expectedBytes ||
          (handoff.checkSourceSha256 ?? null) !== checkpoint.checkSourceSha256) throw new Error("Artifact handoff does not match its admitted checkpoint.");
      return this.event(id, "handoff.ready", "Local patch and exact check evidence prepared for one cloud recovery phase.", { handoff });
    });
  }

  beginCloudRecovery(id: string, providerLabel: string): PatchRunSnapshot {
    return this.mutate(id, (snapshot) => {
      this.requireRunning(snapshot);
      if ((snapshot.policy !== "local_first" && !patchPolicyNeedsPlan(snapshot.policy)) || snapshot.phase !== "local_solver" ||
          snapshot.checkpoint?.decision !== "escalate" || !snapshot.handoff || (snapshot.cloudRecoveryCount ?? 0) !== 0 || this.hasUnresolvedRequests(id)) {
        throw new Error("Cloud recovery is not admitted by the current checkpoint.");
      }
      return this.event(id, "phase.changed", "Phase: cloud solver after one local handoff.",
        { phase: "cloud_solver", providerLabel, cloudRecoveryCount: 1 });
    });
  }

  private request(id: string, request: string): RequestRow {
    const row = this.database.prepare("SELECT * FROM patch_run_requests WHERE run_id = ? AND request_id = ?")
      .get(id, requestId.parse(request)) as RequestRow | undefined;
    if (!row) throw new Error("Request reservation was not found.");
    return row;
  }

  reserveRequest(id: string, raw: PatchRequestReservation, criticHeadroomMicrousd?: number): PatchRunSnapshot {
    const input = reservationSchema.parse(raw);
    if (criticHeadroomMicrousd !== undefined) money.positive().parse(criticHeadroomMicrousd);
    return this.mutate(id, (snapshot) => {
      this.requireRunning(snapshot);
      const existing = this.database.prepare("SELECT * FROM patch_run_requests WHERE request_id = ?")
        .get(input.requestId) as RequestRow | undefined;
      if (existing) {
        if (existing.run_id !== id || existing.admission_json !== JSON.stringify(input) || existing.state !== "reserved") {
          throw new Error("Request identity has already been used.");
        }
        return snapshot;
      }
      if (snapshot.policy === "local_critic_repair") {
        const count = Object.values(snapshot.phaseUsage ?? {}).reduce((sum, usage) => sum + usage.requestCount, 0);
        const checkpoint = snapshot.checkpoint, draft = snapshot.criticDraft;
        if (count >= 13 || !["local", "critic"].includes(input.phase ?? "") ||
            (input.phase === "local" && (snapshot.phase !== "local_solver" || checkpoint?.state !== "local" ||
              checkpoint.reason !== "local_request_started" || checkpoint.eventId !== input.requestId ||
              checkpoint.localCalls !== (snapshot.phaseUsage?.local?.requestCount ?? 0) + 1 || checkpoint.localCalls > 12)) ||
            (input.phase === "critic" && (snapshot.phase !== "cloud_critic" || !draft || snapshot.critic ||
              (snapshot.phaseUsage?.critic?.requestCount ?? 0) !== 0 || checkpoint?.reason !== "critic_request_started" ||
              input.requestId !== draft.requestId || input.inputSha256 !== draft.bodySha256))) {
          throw new Error("Critic policy request exceeds its once-only phase or cumulative authority.");
        }
        if (checkpoint) validateCriticCheckpointBudget(checkpoint);
      }
      const unresolved = this.database.prepare(
        "SELECT request_id FROM patch_run_requests WHERE run_id = ? AND state IN ('reserved','started','unknown') LIMIT 1",
      ).get(id);
      if (unresolved) throw new Error("A request is already in flight or has unresolved exposure.");
      if (safeSum(safeSum(snapshot.spentMicrousd, snapshot.reservedMicrousd), input.amountMicrousd) > snapshot.maxCostMicrousd) {
        throw new Error("Coding run budget cannot admit this request.");
      }
      const campaign = patchCampaignExposure(this.database);
      const assignment = this.database.prepare(`SELECT s.episode_microusd, b.state, a.dispatch_claimed FROM patch_comparison_assignments a
        JOIN patch_comparison_screens s ON s.id = a.screen_id JOIN patch_comparison_blocks b USING(screen_id, task_id)
        WHERE a.run_id = ?`).get(id) as { episode_microusd: number; state: string; dispatch_claimed: number } | undefined;
      if (assignment && (assignment.state !== "reserved" || assignment.dispatch_claimed !== 1 || snapshot.maxCostMicrousd !== assignment.episode_microusd)) {
        throw new Error("Comparison episode is not covered by its admitted block.");
      }
      if (snapshot.policy === "local_critic_repair" && input.phase === "local" && snapshot.checkpoint?.evidence.localPhase === "draft") {
        if (criticHeadroomMicrousd === undefined ||
            safeSum(safeSum(snapshot.spentMicrousd, snapshot.reservedMicrousd), safeSum(input.amountMicrousd, criticHeadroomMicrousd)) > snapshot.maxCostMicrousd ||
            safeSum(campaign.microusd, campaign.coveredRunIds.has(id) ? 0 : safeSum(input.amountMicrousd, criticHeadroomMicrousd)) >
              (input.campaignLimitMicrousd ?? 70_000_000)) {
          throw new Error("Draft request cannot preserve the conservative critic monetary headroom.");
        }
      } else if (criticHeadroomMicrousd !== undefined) throw new Error("Critic monetary headroom is only part of draft admission.");
      const additional = campaign.coveredRunIds.has(id) ? 0 : input.amountMicrousd;
      if (safeSum(campaign.microusd, additional) > (input.campaignLimitMicrousd ?? 70_000_000)) {
        throw new Error("Pilot campaign budget cannot admit this request.");
      }
      if (snapshot.executionMode === "scripted" && input.amountMicrousd !== 0) {
        throw new Error("Scripted runs cannot reserve paid exposure.");
      }
      this.database.prepare(
        "INSERT INTO patch_run_requests (request_id, run_id, state, reservation_microusd, admission_json) VALUES (?, ?, 'reserved', ?, ?)",
      ).run(input.requestId, id, input.amountMicrousd, JSON.stringify(input));
      const phaseUsage = input.phase ? { ...snapshot.phaseUsage, [input.phase]: (() => {
        const previous = snapshot.phaseUsage?.[input.phase] ?? emptyPhaseUsage(input.providerLabel);
        return { ...previous, providerLabel: input.providerLabel,
          requestCount: safeSum(previous.requestCount, 1),
          reservedMicrousd: safeSum(previous.reservedMicrousd, input.amountMicrousd) };
      })() } : undefined;
      return this.event(id, "request.reserved", "Request budget reserved before dispatch.", {
        reservedMicrousd: safeSum(snapshot.reservedMicrousd, input.amountMicrousd),
        providerLabel: input.providerLabel,
        ...(phaseUsage ? { phaseUsage } : {}),
      }, input);
    });
  }

  startRequest(id: string, request: string): PatchRunSnapshot {
    return this.mutate(id, (snapshot) => {
      this.requireRunning(snapshot);
      const row = this.request(id, request);
      // A repeated start is not a new authority to dispatch.
      if (row.state !== "reserved") throw new Error("Request start authority was already consumed.");
      this.database.prepare("UPDATE patch_run_requests SET state = 'started' WHERE request_id = ?").run(request);
      return this.event(id, "request.started", "Provider request admitted; billing may begin.", {}, { requestId: request });
    });
  }

  private settle(id: string, input: PatchRequestFinish): PatchRunSnapshot {
    const snapshot = this.get(id);
    const row = this.request(id, input.requestId);
    if (row.finish_json !== null) {
      if (row.finish_json !== JSON.stringify(input)) throw new Error("Conflicting request settlement.");
      return snapshot;
    }
    if (input.outcome === "not_sent" && row.state !== "reserved") {
      throw new Error("A started request cannot be released as unsent.");
    }
    if (input.outcome !== "not_sent" && row.state !== "started") {
      throw new Error("Request must be started before settlement.");
    }
    const actual = input.actualCostMicrousd ?? null;
    this.database.prepare("UPDATE patch_run_requests SET state = ?, actual_microusd = ?, finish_json = ? WHERE request_id = ?")
      .run(input.outcome, actual, JSON.stringify(input), input.requestId);
    const reservedMicrousd = input.outcome === "unknown" ? snapshot.reservedMicrousd :
      snapshot.reservedMicrousd - row.reservation_microusd;
    const spentMicrousd = actual === null ? snapshot.spentMicrousd : safeSum(snapshot.spentMicrousd, actual);
    const admission = reservationSchema.parse(JSON.parse(row.admission_json));
    const phase = admission.phase;
    let phaseUsage: PatchRunSnapshot["phaseUsage"];
    if (phase) {
      const previous = snapshot.phaseUsage?.[phase];
      if (!previous) throw new Error("Request phase usage was not reserved.");
      phaseUsage = { ...snapshot.phaseUsage, [phase]: {
        ...previous,
        reservedMicrousd: input.outcome === "unknown" ? previous.reservedMicrousd : previous.reservedMicrousd - row.reservation_microusd,
        spentMicrousd: actual === null ? previous.spentMicrousd : safeSum(previous.spentMicrousd, actual),
        unknownRequests: safeSum(previous.unknownRequests, input.outcome === "unknown" ? 1 : 0),
        usageReceipts: safeSum(previous.usageReceipts, input.usage ? 1 : 0),
        inputTokens: safeSum(previous.inputTokens, input.usage?.inputTokens ?? 0),
        outputTokens: safeSum(previous.outputTokens, input.usage?.outputTokens ?? 0),
        cacheReadTokens: safeSum(previous.cacheReadTokens, input.usage?.cacheReadTokens ?? 0),
        cacheWriteTokens: safeSum(previous.cacheWriteTokens, input.usage?.cacheWriteTokens ?? 0),
        reasoningTokens: safeSum(previous.reasoningTokens, input.usage?.reasoningTokens ?? 0),
      } };
    }
    // Real overruns must be recorded, never rejected and silently lost.
    return this.event(id, "request.finished", input.outcome === "unknown"
      ? "Request outcome unknown; full reservation retained."
      : `Request ${input.outcome}; cost accounted.`, { reservedMicrousd, spentMicrousd, ...(phaseUsage ? { phaseUsage } : {}) }, input);
  }

  finishRequest(id: string, raw: PatchRequestFinish): PatchRunSnapshot {
    const input = finishRequestSchema.parse(raw);
    return this.mutate(id, (snapshot) => {
      // Idempotent repeated receipts are allowed after terminal projection.
      const row = this.request(id, input.requestId);
      if (row.finish_json === null) this.requireRunning(snapshot);
      return this.settle(id, input);
    });
  }

  finish(id: string, status: TerminalStatus, error?: string): PatchRunSnapshot {
    z.enum(["completed", "failed", "cancelled", "interrupted", "blocked"]).parse(status);
    if (error !== undefined) z.string().max(2_000).parse(error);
    return this.mutate(id, (snapshot) => {
      if (isPatchRunTerminal(snapshot.status)) {
        if (snapshot.status !== status) throw new Error("Coding run already has a different terminal outcome.");
        return snapshot;
      }
      if (status === "completed" && (!snapshot.patch?.text.trim() || snapshot.patch.truncated)) {
        throw new Error("Completion requires a nonempty complete patch artifact.");
      }
      if (status === "completed" && snapshot.patch?.kind === "recovered") {
        throw new Error("Recovered unfinished work cannot complete a coding run.");
      }
      if (status === "completed" && snapshot.policy === "cloud_plan_local_review" && snapshot.cloudRecoveryCount !== 1) {
        throw new Error("Reviewed-policy completion requires exactly one admitted cloud review phase.");
      }
      if (status === "completed" && snapshot.cloudPlan?.checks && snapshot.checks.status === "passed" &&
          (!snapshot.plannerCheck?.passed || !snapshot.plannerCheck.fresh || snapshot.plannerCheck.stage !== "final" ||
            snapshot.plannerCheck.artifactSha256 !== snapshot.cloudPlan.checks.sha256 ||
            snapshot.plannerCheck.sourceSha256 !== snapshot.checks.sourceSha256 ||
            snapshot.plannerCheck.sourceAfterSha256 !== snapshot.checks.sourceAfterSha256)) {
        throw new Error("Passing completion requires fresh final generated checks on the exact visible-check source.");
      }
      if (status === "completed" && snapshot.policy === "local_critic_repair" &&
          (!snapshot.critic || snapshot.critic.result.verdict === "insufficient_context" || snapshot.checkpoint?.decision !== "submit" ||
            snapshot.checks.status !== "passed" || snapshot.checks.sourceSha256 !== snapshot.checkpoint.sourceSha256 ||
            snapshot.checks.sourceAfterSha256 !== snapshot.checkpoint.sourceSha256 ||
            (snapshot.critic.result.verdict === "acceptable" && (!snapshot.criticCurrent || snapshot.patch?.sha256 !== snapshot.critic.patchSha256)) ||
            snapshot.cloudPlan || snapshot.plannerCheck || snapshot.handoff || (snapshot.cloudRecoveryCount ?? 0) !== 0)) {
        throw new Error("Critic policy completion requires its final checked submission and immutable verdict history.");
      }
      const open = this.database.prepare(
        "SELECT * FROM patch_run_requests WHERE run_id = ? AND state IN ('reserved','started')",
      ).all(id) as RequestRow[];
      if (status === "completed" && (open.length > 0 || snapshot.reservedMicrousd > 0)) {
        throw new Error("Completion cannot hide unresolved provider exposure.");
      }
      if (status === "completed" && this.database.prepare(
        "SELECT request_id FROM patch_run_requests WHERE run_id = ? AND state = 'unknown' LIMIT 1",
      ).get(id)) throw new Error("Completion cannot hide an unknown provider outcome, including zero-fee local requests.");
      for (const row of open) this.settle(id, {
        requestId: row.request_id, outcome: row.state === "reserved" ? "not_sent" : "unknown",
      });
      return this.event(id, `run.${status}`, error?.slice(0, 1_000) ?? `Coding run ${status}.`, {
        status, phase: "finished", ...(error === undefined ? {} : { error }),
      });
    });
  }

  decide(id: string, decision: PatchRunDecision): PatchRunSnapshot {
    PatchRunDecisionSchema.parse(decision);
    return this.mutate(id, (snapshot) => {
      if (!isPatchRunTerminal(snapshot.status) || !snapshot.patch?.text.trim()) {
        throw new Error("A terminal patch is required before a user decision.");
      }
      if (snapshot.decision === decision) return snapshot;
      return this.event(id, "decision.recorded", decision === "keep" ? "User kept the patch." : "User rejected the patch.", { decision });
    });
  }

  recoverInterrupted(scope?: readonly string[]): PatchRunSnapshot[] {
    const rows = this.database.prepare("SELECT id FROM patch_runs WHERE status = 'running' ORDER BY id")
      .all() as Array<{ id: string }>;
    return rows.filter(({ id }) => scope === undefined || scope.includes(id))
      .map(({ id }) => this.finish(id, "interrupted", "The app stopped before this run finished. No request was retried."));
  }

  /** Reconstruct from immutable events for audit/recovery checks, not each append. */
  replay(id: string): PatchRunSnapshot {
    this.row(id);
    const rows = this.database.prepare("SELECT * FROM patch_run_events WHERE run_id = ? ORDER BY sequence")
      .all(id) as Array<{ sequence: number; type: string; summary: string; payload_json: string; created_at: string }>;
    let snapshot: PatchRunSnapshot | undefined;
    for (const row of rows) {
      const payload = JSON.parse(row.payload_json) as { changes: SnapshotChanges; detail?: { initial?: PatchRunSnapshot } };
      if (snapshot === undefined) {
        if (row.sequence !== 1 || row.type !== "run.created" || !payload.detail?.initial) throw new Error("Invalid coding event origin.");
        snapshot = PatchRunSnapshotSchema.parse(payload.detail.initial);
      }
      snapshot = PatchRunSnapshotSchema.parse({ ...snapshot, ...payload.changes,
        events: [...snapshot.events, { sequence: row.sequence, type: row.type, summary: row.summary, createdAt: row.created_at }].slice(-200),
      });
    }
    if (!snapshot) throw new Error("Coding run has no canonical events.");
    return snapshot;
  }
}
