/**
 * Backlog item 6, finding A6 (BL-20261109-0336-desktop-resume-reasons-design): every reason a desktop task can record, classified by
 * whether a later run could change it.
 * - `resumable`: a resume may continue. Every guard in the controller still comes first: an uncertain row, operation or consultation,
 *   a stop marker, the allowance, the deadline and a pending consultation.
 * - `terminal`: a later run would stop the same way, or the task has already ended.
 * - `not_a_stop`: a reason that never ends a run paused or incomplete.
 * A pull request that adds a reason classifies it here. tests/unit/general-task-run-reasons.test.ts holds this table to the reasons the
 * runner, the research pipeline, the session and the controller can produce (tests/helpers/run-reason-scan.ts) and fails on any it
 * does not classify.
 */
export type RunReasonClass = "resumable" | "terminal" | "not_a_stop";

export const RUN_REASONS: Readonly<Record<string, RunReasonClass>> = Object.freeze({
  // Resumable as before item 6: the pause, quit and crash projections, a consultation's states, and the transient model and scanner stops.
  interrupted: "resumable", paused: "resumable", consultation_pending: "resumable", consultation_ready: "resumable",
  model_unavailable: "resumable", packet_scan_unavailable: "resumable",
  // Resumable since item 6: the runtime, the execution workspace or its claim was unavailable; a cancel or time check stopped the run
  // while the desktop record was neither cancelled nor expired; or the model's last replies ran nothing. And the runner's paused reason.
  runtime_unavailable: "resumable", runtime_failure_progress_preserved: "resumable", execution_context_unavailable: "resumable",
  cleanup_required: "resumable", orphan_cleanup_required: "resumable", job_context_busy: "resumable", job_already_completed: "resumable",
  cancelled_or_deadline: "resumable", model_output_incomplete: "resumable", one_complete_tool_action_required: "resumable",
  checkpoint_saved: "resumable",
  // Terminal, decided by earlier entries.
  request_body_size_exceeded: "terminal", fee_cap_reached: "terminal", local_token_admission_denied: "terminal",
  deadline_before_request: "terminal", model_request_denied: "terminal", repeated_identical_execution_failure: "terminal",
  configuration_changed: "terminal", deadline: "terminal",
  // Terminal, because a later run repeats them.
  runtime_contract_drift: "terminal", checkpoint_identity_mismatch: "terminal", host_validation_not_replayed: "terminal",
  repeated_incomplete_tool_arguments_at_output_limit: "terminal", duplicate_tool_call_id: "terminal", bounded_allowance_exhausted: "terminal",
  consultation_budget_unavailable: "terminal", consultation_response_missing_no_replay: "terminal",
  public_source_retention_or_text_failed: "terminal", public_retrieval_receipt_missing: "terminal", task_integrity_failed: "terminal",
  // Terminal: the runner refused its own contract when it was built (runner.ts), which every later run repeats.
  general_job_contract_invalid: "terminal", general_initial_evidence_missing: "terminal", general_initial_evidence_context_invalid: "terminal",
  general_session_deadline_invalid: "terminal", general_public_fetch_limit_invalid: "terminal",
  // Terminal, because the task has already ended; and the legacy flattened reason.
  cancelled: "terminal", cleanup_in_progress: "terminal", cleanup_blocked: "terminal", incomplete: "terminal",
  // Never a stop.
  queued: "not_a_stop", running: "not_a_stop", submitted: "not_a_stop", critical_checks_passed: "not_a_stop",
  critical_checks_passed_at_allowance: "not_a_stop", research_packet_ready: "not_a_stop", independent_acceptance_pending: "not_a_stop",
});
/** A reason with one of these prefixes, or this suffix, is terminal unless the table says otherwise (plan decision 10). */
export const TERMINAL_RUN_REASON_PREFIXES: readonly string[] = Object.freeze(["research_", "session_", "unresolved_"]);
export const TERMINAL_RUN_REASON_SUFFIXES: readonly string[] = Object.freeze(["_before_completion"]);
/** A two-phase session's public phase prefixes its runner's reason (session.ts); the desktop runs no public phase. */
const PUBLIC_PHASE_PREFIX = "public_";
/** A reason the desktop record keeps is a fixed code, never text. */
export const RUN_REASON_SHAPE = /^[a-z][a-z0-9_]{0,95}$/u;
/** Keys the controller's projection derives at read time; a record never stores them. */
export const PROJECTION_ONLY_REASONS: ReadonlySet<string> = new Set(["interrupted_unknown", "consultation_uncertain", "consultation_failed"]);

/**
 * The class the table, a terminal prefix or suffix, or the public-phase prefix gives a reason, in that order; undefined when none
 * classifies it. A `public_` form takes the class of the reason it prefixes.
 */
export function classifiedRunReason(reason: string): RunReasonClass | undefined {
  if (typeof reason !== "string" || !RUN_REASON_SHAPE.test(reason)) return undefined;
  if (Object.hasOwn(RUN_REASONS, reason)) return RUN_REASONS[reason];
  if (TERMINAL_RUN_REASON_PREFIXES.some(prefix => reason.startsWith(prefix)) || TERMINAL_RUN_REASON_SUFFIXES.some(suffix => reason.endsWith(suffix))) return "terminal";
  return reason.startsWith(PUBLIC_PHASE_PREFIX) ? classifiedRunReason(reason.slice(PUBLIC_PHASE_PREFIX.length)) : undefined;
}
/** An unclassified reason, or a value without the code shape, is terminal. */
export function runReasonClass(reason: string): RunReasonClass { return classifiedRunReason(reason) ?? "terminal"; }
export function isResumableRunReason(reason: string): boolean { return runReasonClass(reason) === "resumable"; }
/**
 * The reason an incomplete record keeps: the run's own code, or the legacy `incomplete` for a value without the code shape and for a
 * reason that is no stop (a submitted session result the controller could not confirm).
 */
export function storedRunReason(reason: unknown): string {
  return typeof reason === "string" && RUN_REASON_SHAPE.test(reason) && classifiedRunReason(reason) !== "not_a_stop" && !PROJECTION_ONLY_REASONS.has(reason) ? reason : "incomplete";
}
/**
 * Integrity failures: the controller's own checks (the stored inputs, the storage directories or the task's context no longer match), the
 * checkpoint store's refusals of a stored file (src/main/private-agent/checkpoints.ts), and the retained public sources no longer matching
 * their settled receipts or context (src/main/private-agent/public-sources.ts; deterministic, since a settled receipt is final). A failed
 * checkpoint write is not one, and neither are the observation and progress checks' codes, which also wrap environmental errors (6.3).
 */
export const TASK_INTEGRITY_ERRORS: ReadonlySet<string> = new Set(["general_task_input_changed", "general_task_storage_changed", "general_task_context_changed",
  "checkpoint_digest_mismatch", "checkpoint_file_invalid", "checkpoint_path_invalid", "checkpoint_size_exceeded", "checkpoint_directory_invalid",
  "public_source_identity_invalid", "public_source_duplicate", "public_source_context_invalid"]);
/** The runner's refusals of its own contract when it is built; each is recorded as itself. */
export const RUNNER_CONTRACT_ERRORS: ReadonlySet<string> = new Set(["general_job_contract_invalid", "general_initial_evidence_missing",
  "general_initial_evidence_context_invalid", "general_session_deadline_invalid", "general_public_fetch_limit_invalid"]);
/**
 * The reason a start or resume that threw records:
 * - a changed configuration ends the task as `configuration_changed`;
 * - an integrity failure, or a file or directory missing under the task storage root (`storageRoot`), ends it as `task_integrity_failed`;
 * - a session or research code the session threw (a drifted completion, an invalid phase, a producer mismatch) and the runner's contract
 *   refusals are recorded as themselves, terminal, because every run repeats them;
 * - anything else (Docker down, the model or image missing, a failed checkpoint write, a database error) is `runtime_unavailable`, resumable.
 */
export function caughtRunReason(error: unknown, storageRoot?: string): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "general_task_configuration_changed") return "configuration_changed";
  if (TASK_INTEGRITY_ERRORS.has(message)) return "task_integrity_failed";
  const missing = error instanceof Error ? error as NodeJS.ErrnoException : undefined;
  if (storageRoot && missing?.code === "ENOENT" && typeof missing.path === "string" &&
      (missing.path === storageRoot || missing.path.startsWith(`${storageRoot}/`))) return "task_integrity_failed";
  if (RUNNER_CONTRACT_ERRORS.has(message)) return message;
  if (message !== "session_already_running" && RUN_REASON_SHAPE.test(message) && (message.startsWith("session_") || message.startsWith("research_"))) return message;
  return "runtime_unavailable";
}
