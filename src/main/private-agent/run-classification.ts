import { isAssistDispatch } from "./dispatch-purposes";
import { isZeroFeeDispatch, isZeroFeeFailedDispatch } from "./selection";

/**
 * Backlog item 11, part 3a (BL-20261109-0515-infra-classification-design): whether a run that did not submit ended on
 * infrastructure, which the registry labels `infra_invalid`, decided from recorded codes only. The lists are frozen for E3 and E4
 * once E3's card or the owner records them; scripts/registry-row.py mirrors them byte for byte (tests/unit/run-classification.test.ts).
 */
export const RUN_CLASSIFICATION_VERSION = 1;
/** (a) Terminal reasons that are host-side ends: the cause is the reason itself. */
export const INFRA_HOST_REASONS = Object.freeze(["runtime_failure_progress_preserved", "execution_context_unavailable", "cleanup_required", "orphan_cleanup_required",
  "job_context_busy", "session_failure", "source_changed_during_run", "public_snapshot_changed_during_run", "packet_scan_unavailable", "unresolved_dispatch_no_replay",
  "public_source_retention_or_text_failed"] as const);
/** (b) A failed call: the writer's `model_unavailable`, or a reading stage denied with `request_failed`. */
export const FAILED_CALL_STAGE_CODE = "request_failed";
/** (c) Host-side local token-admission codes, on a `local_token_admission_denied` end or as a reading stage's denied code. */
export const INFRA_TOKEN_ADMISSION_CODES = Object.freeze(["local_token_admission_helper_failed", "local_token_admission_timeout", "local_token_admission_proof_invalid",
  "local_token_admission_pin_drift", "local_token_admission_invalid", "local_token_admission_missing"] as const);
/**
 * (d) Broker refusals that are host or configuration faults, on a `model_request_denied` end or as a reading stage's denied code:
 * a missing destination, a packet scanner that failed, an unresolved row of the job (the writer maps the last two to the listed
 * `packet_scan_unavailable` and `unresolved_dispatch_no_replay`).
 */
export const INFRA_BROKER_CODES = Object.freeze(["destination_missing", "packet_scan_failed", "unresolved_dispatch"] as const);
/** (f) Cancelled ends, infrastructure only when the loop's own interrupt cut the run (part 1's mark). */
export const STOP_REASONS = Object.freeze(["cancelled_or_deadline", "research_cancelled", "session_cancelled", "session_stopped", "session_unresolved_or_deadline",
  "cancelled_before_completion"] as const);
/** (f) A token admission the interrupt cut (`local_token_admission_denied` with this code). */
export const STOP_TOKEN_ADMISSION_CODE = "local_token_admission_cancelled";
/** The broker's refusal after a cloud call it could not resolve; the writer records it on `runtime_failure` and ends with progress preserved. */
export const UNCERTAIN_CALL_BROKER_CODE = "transport_or_settlement_unknown";
/** The prefix the session gives every end of a run's public phase (session.ts), stripped once before the rules apply. */
export const PUBLIC_PHASE_PREFIX = "public_";
/** A critique's failure codes that are infrastructure: its local call failed, or the reviewed sources changed under it. */
export const INFRA_CRITIQUE_CODES = Object.freeze(["request_failed", "repair_source_changed_during_critique"] as const);
/** Transport answers after which a cloud call is worth sending again: nothing executed, or the provider was briefly unavailable. */
export const TRANSIENT_TRANSPORT_CODES = Object.freeze(["connection_failed", "upstream_closed", "response_interrupted"] as const);

/** What a run's own records say about how it ended; every field is a recorded code or a row of its ledger. */
export interface RunEndEvidence {
  status: string; reason: string;
  /** The reading stage's denied code (its last `research_stage` event's `denied`), or null. */
  stageDenied: string | null;
  /** The failing call: the last `failed` dispatch row that is not an assist, or null. */
  failingCall: Record<string, unknown> | null;
  /** The uncertain call: the last `unknown` dispatch row that is not an assist, or null. */
  uncertainCall: Record<string, unknown> | null;
  /** The last `runtime_failure` event's broker code, or null. */
  runtimeBrokerCode: string | null;
  /** The last host validation's capture failure code, and its verification failure code. */
  captureFailure: string | null; verificationFailure: string | null;
  /** The last `model_request_not_dispatched` code under `local_token_admission_denied`, and under `broker_denied`. */
  tokenAdmissionCode: string | null; brokerDenialCode: string | null;
  /** Whether the loop's own interrupt cut the run (part 1's `interrupted` mark); a single run has no such record yet. */
  stopSignalled: boolean;
}
export interface RunClass { version: typeof RUN_CLASSIFICATION_VERSION; infra: boolean; cause: string }

const has = (list: readonly string[], value: unknown) => typeof value === "string" && list.includes(value);
const row = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
/** A cloud transport failure that is not the arm's or its configuration's: a transient answer, never a spend cap or limit. */
export function isTransientCloudFailure(failure: unknown): boolean {
  if (!failure || typeof failure !== "object") return false;
  const { phase, code, status, spendCap, spendLimit } = failure as Record<string, unknown>;
  if (phase !== "transport" || spendCap === true || spendLimit === true) return false;
  if (has(TRANSIENT_TRANSPORT_CODES, code)) return true;
  return (code === "http_rejected" || code === "stream_error") && typeof status === "number" && (status >= 500 || status === 429);
}
/** The failed call is the run's infrastructure only when it cost nothing, or failed transiently at the cloud; with no row, the reason decides. */
function failedCallIsInfra(value: unknown): boolean {
  const call = row(value);
  return call === null || isZeroFeeFailedDispatch(call) || isTransientCloudFailure(call.failure);
}
/** A cloud call the broker could not resolve is infrastructure when its transport failed; a reply it received and refused is not. */
function uncertainCallIsInfra(value: unknown): boolean {
  const call = row(value), failure = row(call?.failure);
  return call === null || failure?.phase === "transport";
}

/** The rules of decision (1) on a reason with any public-phase prefix already stripped. */
function classifyCore(end: RunEndEvidence, reason: string): string | null {
  if (has(INFRA_HOST_REASONS, reason)) {
    if (reason === "runtime_failure_progress_preserved" && end.runtimeBrokerCode === UNCERTAIN_CALL_BROKER_CODE && !uncertainCallIsInfra(end.uncertainCall)) return null;
    return reason;
  }
  if (reason === "model_unavailable" && failedCallIsInfra(end.failingCall)) return "model_unavailable";
  if (reason === "research_request_denied") {
    if (end.stageDenied === FAILED_CALL_STAGE_CODE && failedCallIsInfra(end.failingCall)) return "research_request_failed";
    if (has(INFRA_TOKEN_ADMISSION_CODES, end.stageDenied) || has(INFRA_BROKER_CODES, end.stageDenied)) return end.stageDenied;
  }
  if (reason === "local_token_admission_denied" && has(INFRA_TOKEN_ADMISSION_CODES, end.tokenAdmissionCode)) return end.tokenAdmissionCode;
  if (reason === "model_request_denied" && has(INFRA_BROKER_CODES, end.brokerDenialCode)) return end.brokerDenialCode;
  if (reason === "bounded_allowance_exhausted" && (typeof end.captureFailure === "string" || (typeof end.verificationFailure === "string" && end.verificationFailure.startsWith("sandbox_")))) return "verification_unavailable";
  if (end.stopSignalled === true && (has(STOP_REASONS, reason) || (reason === "local_token_admission_denied" && end.tokenAdmissionCode === STOP_TOKEN_ADMISSION_CODE))) return "operator_stop";
  return null;
}
/** Classifies a run's end (decision (1) of the design entry, as its correction amends it); a submitted run is never infrastructure. */
export function classifyRunEnd(end: RunEndEvidence): RunClass {
  if (end.status === "submitted") return { version: RUN_CLASSIFICATION_VERSION, infra: false, cause: "submitted" };
  const reason = typeof end.reason === "string" ? end.reason : "";
  let cause = classifyCore(end, reason);
  // A public phase's end carries the session's prefix: the same rules apply to the phase's own reason, and the cause keeps the prefix.
  if (cause === null && reason.startsWith(PUBLIC_PHASE_PREFIX)) {
    const inner = classifyCore(end, reason.slice(PUBLIC_PHASE_PREFIX.length));
    if (inner !== null) cause = `${PUBLIC_PHASE_PREFIX}${inner}`;
  }
  return cause === null ? { version: RUN_CLASSIFICATION_VERSION, infra: false, cause: "task" } : { version: RUN_CLASSIFICATION_VERSION, infra: true, cause };
}

/**
 * Classifies a critique's end (part 3b resumes on it): its failure code, null when its directory holds no record. Part 3b
 * (BL-20261113-0805, decision (1)) amends part 3a's helper: the loop's interrupt counts as the operator's stop only when the
 * failure is infrastructure, a cancellation the interrupt caused (CRITIQUE_CANCEL_CODES), or there is no record, so a failure in
 * the model's output stays the task's. The mark must be exactly true.
 */
export function classifyCritiqueEnd(code: string | null, stopSignalled: boolean): RunClass {
  const marked = stopSignalled === true;
  if (marked && has(CRITIQUE_CANCEL_CODES, code)) return { version: RUN_CLASSIFICATION_VERSION, infra: true, cause: "operator_stop" };
  if (code !== null && !has(INFRA_CRITIQUE_CODES, code)) return { version: RUN_CLASSIFICATION_VERSION, infra: false, cause: "task" };
  return { version: RUN_CLASSIFICATION_VERSION, infra: true, cause: marked ? "operator_stop" : code ?? RUN_UNFINISHED_CAUSE };
}

/** The last dispatch row of a run that is not an assist and has this status (rows are in commit order): the failing or the uncertain call. */
export function lastCall(dispatches: readonly Record<string, unknown>[], status: "failed" | "unknown"): Record<string, unknown> | null {
  for (let i = dispatches.length - 1; i >= 0; i--) if (dispatches[i]!.status === status && !isAssistDispatch(dispatches[i]!)) return dispatches[i]!;
  return null;
}

/**
 * Backlog item 11, part 3b (BL-20261113-0805-infra-resume-design, decisions (4) and (10)): why a loop stage stopped, for the
 * loop's own stop rules and for the registry's row of a loop that ends without a selection. These lists are separate from
 * version 1's run-end lists, which do not change; scripts/registry-row.py mirrors them and tests/unit/run-classification.test.ts
 * keeps the two equal.
 */
/** A stage run that left no `result.json`: the driver failed after its session started, or its process died. */
export const RUN_UNFINISHED_CAUSE = "run_unfinished";
/** The stop rules for a stage's ledger, checked in this order: an uncertain row, then a priced failed row. */
export const LEDGER_STOP_FAILURES = Object.freeze(["loop_stage_unresolved_dispatch", "loop_stage_failed_dispatch"] as const);
/** The causes a stopped stage's ledger gives, by the row that stopped it. */
export const LEDGER_STOP_CAUSES = Object.freeze(["stage_unresolved_dispatch", "stage_failed_dispatch"] as const);
/** Host-side integrity refusals: infrastructure, with the code itself as the cause. */
export const LOOP_INTEGRITY_STOPS = Object.freeze(["loop_stage_missing", "loop_resume_spent", "loop_stage_mismatch", "loop_resume_mismatch", "loop_stage_ledger_unreadable"] as const);
/** The loop's interrupt between stages, or before a stage's run created its directory. */
export const LOOP_INTERRUPT_FAILURE = "loop_interrupted";
/** The broker's refusals when the loop's interrupt lands before or around a critique's call (broker.ts): the operator's stop when marked. */
export const CRITIQUE_CANCEL_CODES = Object.freeze([STOP_TOKEN_ADMISSION_CODE, "request_cancelled", "retry_wait_cancelled", "transport_cancelled"] as const);

/**
 * Decision (4): the row of a stage's ledger that stops the loop before the stage could be moved aside, or null. A `committed` row
 * that is not zero-fee (part 1's predicate apart from the status) and any `unknown` row that is not an assist are uncertain; a
 * `failed` row that is neither an assist nor zero-fee is a priced failure. A zero-fee `committed` row, the local call in flight when
 * a process died, is admitted: sending equivalent work again costs nothing.
 */
export function ledgerStop(dispatches: readonly Record<string, unknown>[]): { failure: (typeof LEDGER_STOP_FAILURES)[number]; row: Record<string, unknown> } | null {
  const last = (accept: (row: Record<string, unknown>) => boolean) => { for (let i = dispatches.length - 1; i >= 0; i--) if (accept(dispatches[i]!)) return dispatches[i]!; return null; };
  const uncertain = last(item => (item.status === "committed" && !isZeroFeeDispatch(item)) || (item.status === "unknown" && !isAssistDispatch(item)));
  if (uncertain) return { failure: "loop_stage_unresolved_dispatch", row: uncertain };
  const failed = last(item => item.status === "failed" && !isAssistDispatch(item) && !isZeroFeeDispatch(item));
  return failed ? { failure: "loop_stage_failed_dispatch", row: failed } : null;
}

/** What a stopped stage left: a run with a result, a run's ledger without one, a critique's record, or nothing. */
export type LoopStopRun =
  | { kind: "result"; end: RunEndEvidence }
  | { kind: "ledger"; dispatches: readonly Record<string, unknown>[] }
  | { kind: "critique"; code: string | null; stopSignalled: boolean }
  | { kind: "none" };
/**
 * Decision (10): the class of a loop's stop, from the stop's code and what the stopped stage left. An integrity stop is
 * infrastructure. A run with a result takes part 3a's class, with its mark, so an interrupt never turns a task end into
 * infrastructure. A run without a result takes the class of the row that stopped it (an uncertain row counts as infrastructure
 * when it is `committed`, or its failure lies in the transport; a priced failed row under part 3a's failed-call rule), else
 * `run_unfinished`. A stop with no run is the operator's after the loop's interrupt, and otherwise the task's: a refusal
 * before the session is configuration (part 3a's question (d)).
 */
export function classifyLoopStop(failure: string, run: LoopStopRun): RunClass {
  const infra = (cause: string): RunClass => ({ version: RUN_CLASSIFICATION_VERSION, infra: true, cause }), task: RunClass = { version: RUN_CLASSIFICATION_VERSION, infra: false, cause: "task" };
  if (has(LOOP_INTEGRITY_STOPS, failure)) return infra(failure);
  if (run.kind === "result") return classifyRunEnd(run.end);
  if (run.kind === "critique") return classifyCritiqueEnd(run.code, run.stopSignalled === true);
  if (run.kind === "none") return failure === LOOP_INTERRUPT_FAILURE ? infra("operator_stop") : task;
  const stop = ledgerStop(run.dispatches);
  if (stop?.failure === "loop_stage_unresolved_dispatch") {
    const failureRecord = row(stop.row.failure);
    return stop.row.status === "committed" || failureRecord?.phase === "transport" ? infra("stage_unresolved_dispatch") : task;
  }
  if (stop?.failure === "loop_stage_failed_dispatch") return failedCallIsInfra(stop.row) ? infra("stage_failed_dispatch") : task;
  return infra(RUN_UNFINISHED_CAUSE);
}
