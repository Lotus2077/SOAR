import { isAssistDispatch } from "./dispatch-purposes";
import { isZeroFeeFailedDispatch } from "./selection";

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

/** Classifies a critique's end (part 3b resumes on it): its failure code, or the loop's interrupt. */
export function classifyCritiqueEnd(code: string, stopSignalled: boolean): RunClass {
  if (stopSignalled) return { version: RUN_CLASSIFICATION_VERSION, infra: true, cause: "operator_stop" };
  return has(INFRA_CRITIQUE_CODES, code) ? { version: RUN_CLASSIFICATION_VERSION, infra: true, cause: code } : { version: RUN_CLASSIFICATION_VERSION, infra: false, cause: "task" };
}

/** The last dispatch row of a run that is not an assist and has this status (rows are in commit order): the failing or the uncertain call. */
export function lastCall(dispatches: readonly Record<string, unknown>[], status: "failed" | "unknown"): Record<string, unknown> | null {
  for (let i = dispatches.length - 1; i >= 0; i--) if (dispatches[i]!.status === status && !isAssistDispatch(dispatches[i]!)) return dispatches[i]!;
  return null;
}
