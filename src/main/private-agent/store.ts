import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ContextSchema, ExactApprovalSchema, GrantSchema, JobPolicySchema, canonical, contextFingerprint,
  privateAgentId, type ExactApproval, type PrivateAgentContext, type PrivateAgentGrant, type PrivateJobPolicy,
} from "./contracts";

const diagnosticTiming = {
  elapsedMs: z.number().int().nonnegative().max(3_600_000),
  timeoutMs: z.number().int().min(1).max(900_000),
};
/**
 * Fixed host diagnostics for a dispatch that did not settle. `connection_failed` (never sent) and `upstream_closed`
 * (the peer closed after the request was written) are confirmed aborts, as is a 5xx `http_rejected`; the rest leave
 * the upstream state uncertain. `attempt` numbers the tries of one recoverable packet.
 */
export const UnknownRequestDiagnosticSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("transport"),
    code: z.enum(["request_timeout", "cancelled", "http_rejected", "response_oversize", "transport_failed", "connection_failed", "upstream_closed", "response_interrupted"]),
    status: z.number().int().min(100).max(599).optional(), attempt: z.number().int().min(1).max(3).optional(),
    ...diagnosticTiming }).strict(),
  z.object({ phase: z.literal("settlement"),
    code: z.enum(["response_or_usage_invalid", "fee_settlement_failed"]),
    attempt: z.number().int().min(1).max(3).optional(),
    ...diagnosticTiming }).strict(),
]);
export type UnknownRequestDiagnostic = z.infer<typeof UnknownRequestDiagnosticSchema>;
/**
 * A transport failure that leaves nothing uncertain. Never sent, or answered with an error: confirmed for every
 * destination. Closed by the peer after the request was written (before or after a response started): confirmed
 * only for a zero-risk packet (a zero-fee local request or a public GET), which may have been executed but can be
 * re-sent without cost or side effect; for a priced or cloud destination it stays unknown.
 */
export function isConfirmedAbort(failure: UnknownRequestDiagnostic | undefined, zeroRisk = false): boolean {
  if (failure?.phase !== "transport") return false;
  if (failure.code === "connection_failed" || failure.code === "http_rejected") return true;
  return zeroRisk && (failure.code === "upstream_closed" || failure.code === "response_interrupted");
}
/** Of the confirmed aborts of a zero-risk packet, only transient ones are worth another attempt; a 4xx other than 429 is deterministic. */
export function isRetryableAbort(failure: UnknownRequestDiagnostic | undefined): boolean {
  return isConfirmedAbort(failure, true) && failure!.phase === "transport" && (failure!.code !== "http_rejected" || (failure!.status ?? 0) >= 500 || failure!.status === 429);
}
/** `settled` has a response; `superseded` (retried) and `failed` (confirmed abort, no retry left) are resolved without one and never block the ledger. */
export type DispatchStatus = "committed" | "settled" | "unknown" | "superseded" | "failed";
export function isResolvedDispatch(receipt: { status: DispatchStatus }): boolean {
  return receipt.status === "settled" || receipt.status === "superseded" || receipt.status === "failed";
}

export interface DispatchReceipt {
  id: string; jobId: string; contextId: string; contextSha256: string;
  packetSha256: string; destinationId: string; destinationSha256: string;
  purpose: string; policyRevision: number; committedAt: number;
  reservedFeeMicrousd: number; status: DispatchStatus;
  scan: { status: "not_required_inside_boundary" | "not_required_for_synthetic_local_test" } | { status: "complete"; detector: string };
  feeMicrousd?: number; responseSha256?: string;
  /** Fixed host diagnostics only. Absence on historical unknown rows is meaningful. */
  failure?: UnknownRequestDiagnostic;
  approval?: ExactApproval;
}

const RunClaimSchema = z.object({ contextId: privateAgentId, ownerId: privateAgentId,
  pid: z.number().int().positive().safe(), endpoint: z.string().regex(/^unix:\/\/\/[^\x00-\x20\x7f]+$/u),
  state: z.enum(["active", "cleanup_required", "released"]), startedAt: z.number().int().nonnegative().safe(),
}).strict();
export type PrivateRunClaim = z.infer<typeof RunClaimSchema>;
const SessionStartSchema = z.object({ type: z.literal("session_started"),
  identity: z.string().regex(/^[a-f0-9]{64}$/u), startedAt: z.number().int().nonnegative().safe(),
  privateContextId: privateAgentId, publicContextId: privateAgentId,
}).strict();
export type PrivateSessionStart = z.infer<typeof SessionStartSchema>;

/** Only the trusted host owns this store. Never expose it through model tools. */
export class PrivateAgentStore {
  constructor(private readonly db: Database.Database) {
    db.pragma("foreign_keys = ON");
    db.pragma("synchronous = FULL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS private_agent_jobs (id TEXT PRIMARY KEY, policy TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS private_agent_contexts (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES private_agent_jobs(id), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS private_agent_grants (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES private_agent_jobs(id), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS private_agent_dispatches (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES private_agent_jobs(id), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS private_agent_events (job_id TEXT NOT NULL REFERENCES private_agent_jobs(id), sequence INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(job_id, sequence));
      CREATE TABLE IF NOT EXISTS private_agent_run_claims (context_id TEXT PRIMARY KEY REFERENCES private_agent_contexts(id), value TEXT NOT NULL);
    `);
  }

  /** Synchronous host compare-and-set work, sharing grant/reservation transactions. */
  atomic<T>(fn: () => T): T { return this.db.transaction(fn).immediate(); }

  createJob(value: PrivateJobPolicy): void {
    const policy = JobPolicySchema.parse(value);
    if (new Set(policy.destinations).size !== policy.destinations.length || policy.revision !== 0 || policy.cancelled) {
      throw new Error("private_agent_invalid_initial_policy");
    }
    this.db.prepare("INSERT INTO private_agent_jobs VALUES (?, ?)").run(policy.id, canonical(policy));
  }

  policy(id: string): PrivateJobPolicy {
    const row = this.db.prepare("SELECT policy FROM private_agent_jobs WHERE id = ?").get(privateAgentId.parse(id)) as { policy: string } | undefined;
    if (!row) throw new Error("private_agent_job_missing");
    return JobPolicySchema.parse(JSON.parse(row.policy));
  }

  revisePolicy(id: string, update: Pick<PrivateJobPolicy, "mode" | "destinations">): PrivateJobPolicy {
    return this.db.transaction(() => {
      const previous = this.policy(id);
      if (previous.cancelled) throw new Error("private_agent_cancelled");
      const next = JobPolicySchema.parse({ ...previous, ...update, revision: previous.revision + 1 });
      this.db.prepare("UPDATE private_agent_jobs SET policy = ? WHERE id = ?").run(canonical(next), id);
      return next;
    }).immediate();
  }

  cancel(id: string): void {
    this.db.transaction(() => {
      const policy = this.policy(id);
      this.db.prepare("UPDATE private_agent_jobs SET policy = ? WHERE id = ?")
        .run(canonical({ ...policy, revision: policy.revision + 1, cancelled: true }), id);
    }).immediate();
  }

  createContext(value: PrivateAgentContext): void {
    const context = ContextSchema.parse(value);
    this.policy(context.jobId);
    if (context.sources.some(source => source.classification === "credential")) throw new Error("private_agent_credential_in_context");
    if (new Set(context.sources.map(source => source.id)).size !== context.sources.length) throw new Error("private_agent_duplicate_source");
    this.db.prepare("INSERT INTO private_agent_contexts VALUES (?, ?, ?)").run(context.id, context.jobId, canonical(context));
  }

  context(id: string): PrivateAgentContext {
    const row = this.db.prepare("SELECT value FROM private_agent_contexts WHERE id = ?").get(privateAgentId.parse(id)) as { value: string } | undefined;
    if (!row) throw new Error("private_agent_context_missing");
    return ContextSchema.parse(JSON.parse(row.value));
  }

  /** Context taint is monotonic. Compaction or a model response cannot clear it. */
  addSources(id: string, additions: PrivateAgentContext["sources"]): PrivateAgentContext {
    return this.db.transaction(() => {
      const context = this.context(id);
      for (const source of additions) {
        const prior = context.sources.find(existing => existing.id === source.id);
        if (prior && canonical(prior) !== canonical(source)) throw new Error("private_agent_source_version_changed");
        if (!prior) context.sources.push(source);
      }
      const next = ContextSchema.parse(context);
      if (next.sources.some(source => source.classification === "credential")) throw new Error("private_agent_credential_in_context");
      this.db.prepare("UPDATE private_agent_contexts SET value = ? WHERE id = ?").run(canonical(next), id);
      return next;
    }).immediate();
  }

  grant(value: PrivateAgentGrant): void {
    const grant = GrantSchema.parse(value);
    const policy = this.policy(grant.jobId), context = this.context(grant.contextId);
    if (policy.cancelled || grant.revoked || grant.remainingUses < 1 || (grant.approval && grant.remainingUses !== 1) || grant.policyRevision !== policy.revision ||
        context.jobId !== grant.jobId || contextFingerprint(context) !== grant.contextSha256) {
      throw new Error("private_agent_stale_grant");
    }
    this.db.prepare("INSERT INTO private_agent_grants VALUES (?, ?, ?)").run(grant.id, grant.jobId, canonical(grant));
  }

  revoke(grantId: string): void {
    this.db.transaction(() => {
      const row = this.db.prepare("SELECT value FROM private_agent_grants WHERE id = ?").get(privateAgentId.parse(grantId)) as { value: string } | undefined;
      if (!row) throw new Error("private_agent_grant_missing");
      this.db.prepare("UPDATE private_agent_grants SET value = ? WHERE id = ?").run(canonical({ ...JSON.parse(row.value), revoked: true }), grantId);
    }).immediate();
  }

  /** Permission use and maximum fee are committed together before any transport. */
  commit(input: Omit<DispatchReceipt, "id" | "status" | "committedAt" | "failure">,
    validate: (policy: PrivateJobPolicy, context: PrivateAgentContext) => void,
    grantId?: string, now = Date.now()): DispatchReceipt {
    return this.db.transaction(() => {
      const parsedApproval = input.approval === undefined ? undefined : ExactApprovalSchema.safeParse(input.approval);
      if (parsedApproval && (!parsedApproval.success || parsedApproval.data.maxFeeMicrousd !== input.reservedFeeMicrousd || !grantId)) {
        throw new Error("private_agent_approval_invalid");
      }
      const approval = parsedApproval?.success ? parsedApproval.data : undefined;
      const policy = this.policy(input.jobId), context = this.context(input.contextId);
      if ("failure" in input || policy.cancelled || context.jobId !== policy.id || input.policyRevision !== policy.revision ||
          input.contextSha256 !== contextFingerprint(context) || !policy.destinations.includes(input.destinationId)) {
        throw new Error("private_agent_admission_changed");
      }
      validate(policy, context);
      const history = this.dispatches(policy.id);
      if (history.some(receipt => !isResolvedDispatch(receipt))) throw new Error("private_agent_unresolved_dispatch");
      if (approval && this.db.prepare("SELECT 1 FROM private_agent_dispatches WHERE json_extract(value, '$.approval.proposalId') = ? LIMIT 1")
        .get(approval.proposalId)) throw new Error("private_agent_proposal_already_dispatched");
      const exposure = history.reduce((sum, receipt) => sum + (receipt.status === "settled" ? receipt.feeMicrousd! : isResolvedDispatch(receipt) ? 0 : receipt.reservedFeeMicrousd), 0);
      if (!Number.isSafeInteger(input.reservedFeeMicrousd) || input.reservedFeeMicrousd < 0 ||
          history.length >= policy.maxRequests || exposure + input.reservedFeeMicrousd > policy.maxFeeMicrousd) {
        throw new Error("private_agent_budget_denied");
      }
      if (grantId !== undefined) {
        const row = this.db.prepare("SELECT value FROM private_agent_grants WHERE id = ?").get(privateAgentId.parse(grantId)) as { value: string } | undefined;
        if (!row) throw new Error("private_agent_grant_missing");
        const grant = GrantSchema.parse(JSON.parse(row.value));
        if (grant.revoked || grant.remainingUses < 1 || grant.expiresAt <= now ||
            ((grant.approval !== undefined || approval !== undefined) &&
              (!grant.approval || !approval || grant.remainingUses !== 1 || canonical(grant.approval) !== canonical(approval))) ||
            (["jobId", "contextId", "contextSha256", "packetSha256", "destinationId", "destinationSha256", "purpose", "policyRevision"] as const)
              .some(key => grant[key] !== input[key])) throw new Error("private_agent_grant_mismatch");
        this.db.prepare("UPDATE private_agent_grants SET value = ? WHERE id = ?")
          .run(canonical({ ...grant, remainingUses: grant.remainingUses - 1, revoked: grant.remainingUses === 1 }), grantId);
      }
      const receipt: DispatchReceipt = { ...input, ...(approval ? { approval } : {}), id: randomUUID(), committedAt: now, status: "committed" };
      this.db.prepare("INSERT INTO private_agent_dispatches VALUES (?, ?, ?)").run(receipt.id, receipt.jobId, canonical(receipt));
      return receipt;
    }).immediate();
  }

  settle(id: string, feeMicrousd: number, responseSha256: string): void {
    this.db.transaction(() => {
      const receipt = this.dispatch(id);
      if (receipt.status !== "committed" || !Number.isSafeInteger(feeMicrousd) || feeMicrousd < 0 ||
          feeMicrousd > receipt.reservedFeeMicrousd || !/^[a-f0-9]{64}$/u.test(responseSha256)) {
        throw new Error("private_agent_settlement_invalid");
      }
      this.db.prepare("UPDATE private_agent_dispatches SET value = ? WHERE id = ?")
        .run(canonical({ ...receipt, status: "settled", feeMicrousd, responseSha256 }), id);
    }).immediate();
  }

  unknown(id: string, failure?: UnknownRequestDiagnostic): void { this.close(id, "unknown", failure); }

  /** A confirmed abort resolves the row without a response: `superseded` when another attempt follows, `failed` when none does. */
  resolveFailure(id: string, status: "superseded" | "failed", failure: UnknownRequestDiagnostic, zeroRisk = false): void {
    if (!isConfirmedAbort(failure, zeroRisk)) throw new Error("private_agent_failure_not_confirmed");
    this.close(id, status, failure);
  }

  private close(id: string, status: "unknown" | "superseded" | "failed", failure?: UnknownRequestDiagnostic): void {
    const parsed = failure === undefined ? undefined : UnknownRequestDiagnosticSchema.safeParse(failure);
    if (parsed && !parsed.success) throw new Error("private_agent_unknown_diagnostic_invalid");
    this.db.transaction(() => {
      const receipt = this.dispatch(id);
      if (receipt.status !== "committed") return;
      this.db.prepare("UPDATE private_agent_dispatches SET value = ? WHERE id = ?")
        .run(canonical({ ...receipt, status, ...(parsed?.success ? { failure: parsed.data } : {}) }), id);
    }).immediate();
  }

  dispatch(id: string): DispatchReceipt {
    const row = this.db.prepare("SELECT value FROM private_agent_dispatches WHERE id = ?").get(id) as { value: string } | undefined;
    if (!row) throw new Error("private_agent_dispatch_missing");
    return JSON.parse(row.value) as DispatchReceipt;
  }

  dispatches(jobId: string): DispatchReceipt[] {
    return (this.db.prepare("SELECT value FROM private_agent_dispatches WHERE job_id = ? ORDER BY rowid").all(jobId) as { value: string }[])
      .map(row => JSON.parse(row.value) as DispatchReceipt);
  }

  append(jobId: string, event: Record<string, unknown>): number {
    return this.db.transaction(() => {
      this.policy(jobId);
      const row = this.db.prepare("SELECT COALESCE(MAX(sequence), 0) AS n FROM private_agent_events WHERE job_id = ?").get(jobId) as { n: number };
      this.db.prepare("INSERT INTO private_agent_events VALUES (?, ?, ?)").run(jobId, row.n + 1, canonical(event));
      return row.n + 1;
    }).immediate();
  }

  events(jobId: string): Record<string, unknown>[] {
    return (this.db.prepare("SELECT value FROM private_agent_events WHERE job_id = ? ORDER BY sequence").all(jobId) as { value: string }[])
      .map(row => JSON.parse(row.value) as Record<string, unknown>);
  }

  /** Concurrent hosts must adopt one pair of phase context IDs before dispatch. */
  ensureSessionStart(jobId: string, proposal: PrivateSessionStart): PrivateSessionStart {
    const checked = SessionStartSchema.parse(proposal);
    if (checked.privateContextId === checked.publicContextId) throw new Error("private_agent_session_context_collision");
    return this.db.transaction(() => {
      this.policy(jobId);
      const events = this.events(jobId);
      const starts = events.filter(event => event.type === "session_started");
      if (starts.length > 1) throw new Error("private_agent_duplicate_session_start");
      if (starts.length) {
        const existing = SessionStartSchema.parse(starts[0]);
        if (existing.identity !== checked.identity) throw new Error("private_agent_session_identity_changed");
        return existing;
      }
      if (events.length) throw new Error("private_agent_session_missing_start_identity");
      this.append(jobId, checked);
      return checked;
    }).immediate();
  }

  runClaim(contextId: string): PrivateRunClaim | undefined {
    const row = this.db.prepare("SELECT value FROM private_agent_run_claims WHERE context_id = ?").get(privateAgentId.parse(contextId)) as { value: string } | undefined;
    return row ? RunClaimSchema.parse(JSON.parse(row.value)) : undefined;
  }

  acquireRun(contextId: string, ownerId: string, endpoint: string, pid = process.pid): PrivateRunClaim {
    return this.db.transaction(() => {
      this.context(contextId);
      const previous = this.runClaim(contextId);
      if (previous && previous.state !== "released") throw new Error("private_agent_context_busy");
      const claim = RunClaimSchema.parse({ contextId, ownerId, endpoint, pid, state: "active", startedAt: Date.now() });
      this.db.prepare("INSERT INTO private_agent_run_claims VALUES (?, ?) ON CONFLICT(context_id) DO UPDATE SET value = excluded.value")
        .run(contextId, canonical(claim));
      return claim;
    }).immediate();
  }

  /** Host verifies dead owner or explicit cleanup-required state before this CAS. */
  acquireRecovery(contextId: string, previousOwner: string, nextOwner: string): PrivateRunClaim {
    return this.db.transaction(() => {
      const previous = this.runClaim(contextId);
      if (!previous || previous.ownerId !== previousOwner || previous.state === "released") throw new Error("private_agent_recovery_changed");
      const claim = RunClaimSchema.parse({ ...previous, ownerId: nextOwner, pid: process.pid, state: "active", startedAt: Date.now() });
      this.db.prepare("UPDATE private_agent_run_claims SET value = ? WHERE context_id = ?").run(canonical(claim), contextId);
      return claim;
    }).immediate();
  }

  releaseRun(contextId: string, ownerId: string, cleanupConfirmed: boolean): void {
    this.db.transaction(() => {
      const claim = this.runClaim(contextId);
      if (!claim || claim.ownerId !== ownerId || claim.state !== "active") throw new Error("private_agent_run_owner_changed");
      this.db.prepare("UPDATE private_agent_run_claims SET value = ? WHERE context_id = ?")
        .run(canonical({ ...claim, state: cleanupConfirmed ? "released" : "cleanup_required" }), contextId);
    }).immediate();
  }
}
