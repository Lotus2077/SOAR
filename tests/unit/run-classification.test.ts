import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CRITIQUE_CANCEL_CODES, FAILED_CALL_STAGE_CODE, INFRA_BROKER_CODES, INFRA_CRITIQUE_CODES, INFRA_HOST_REASONS, INFRA_TOKEN_ADMISSION_CODES, LEDGER_STOP_CAUSES, LEDGER_STOP_FAILURES, LOOP_INTEGRITY_STOPS,
  LOOP_INTERRUPT_FAILURE, PUBLIC_PHASE_PREFIX, RUN_CLASSIFICATION_VERSION, RUN_UNFINISHED_CAUSE, STOP_REASONS, STOP_TOKEN_ADMISSION_CODE, TRANSIENT_TRANSPORT_CODES, UNCERTAIN_CALL_BROKER_CODE,
  classifyCritiqueEnd, classifyLoopStop, classifyRunEnd, isTransientCloudFailure, lastCall, ledgerStop, type LoopStopRun, type RunClass, type RunEndEvidence } from "../../src/main/private-agent/run-classification";
import { isRetryableAbort } from "../../src/main/private-agent/store";

/** Backlog item 11, part 3a (BL-20261109-0515-infra-classification-design): the frozen `infra_invalid` classification. */
const ROOT = resolve(__dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts", "registry-row.py");
const end = (over: Partial<RunEndEvidence> = {}): RunEndEvidence => ({ status: "incomplete", reason: "model_unavailable", stageDenied: null, failingCall: null, uncertainCall: null,
  runtimeBrokerCode: null, captureFailure: null, verificationFailure: null, tokenAdmissionCode: null, brokerDenialCode: null, stopSignalled: false, ...over });
const zeroFee = { status: "failed", destinationId: "owned_local_model", purpose: "agent reasoning and tool selection", reservedFeeMicrousd: 0 };
const cloud = (failure: Record<string, unknown>) => ({ status: "failed", destinationId: "cloud_coordinator", purpose: "research plan", reservedFeeMicrousd: 160_000, failure });
const transport = (code: string, extra: Record<string, unknown> = {}) => ({ phase: "transport", code, ...extra });
const infra = (cause: string): RunClass => ({ version: RUN_CLASSIFICATION_VERSION, infra: true, cause });
const TASK: RunClass = { version: RUN_CLASSIFICATION_VERSION, infra: false, cause: "task" };

/** Every case the TypeScript and Python classifications must agree on, with its expected class. */
const CASES: [string, RunEndEvidence, RunClass][] = [
  ["a submitted run, whatever else", end({ status: "submitted", reason: "independent_acceptance_pending", stopSignalled: true }), { version: RUN_CLASSIFICATION_VERSION, infra: false, cause: "submitted" }],
  ["a submitted run whose reason is listed", end({ status: "submitted", reason: "runtime_failure_progress_preserved", failingCall: { status: "failed", destinationId: "owned_local_model", reservedFeeMicrousd: 0 } }),
    { version: RUN_CLASSIFICATION_VERSION, infra: false, cause: "submitted" }],
  ["a submitted run ended by a failed call", end({ status: "submitted" }), { version: RUN_CLASSIFICATION_VERSION, infra: false, cause: "submitted" }],
  // A cloud writer call the broker could not resolve ends runtime_failure_progress_preserved: its transport's failure is infrastructure, a refused reply is not.
  ["an uncertain cloud call whose transport timed out", end({ reason: "runtime_failure_progress_preserved", runtimeBrokerCode: UNCERTAIN_CALL_BROKER_CODE, uncertainCall: cloud(transport("request_timeout")) }),
    infra("runtime_failure_progress_preserved")],
  ["an uncertain cloud call whose reply was refused", end({ reason: "runtime_failure_progress_preserved", runtimeBrokerCode: UNCERTAIN_CALL_BROKER_CODE,
    uncertainCall: cloud({ phase: "settlement", code: "response_or_usage_invalid", subcode: "model_served_mismatch" }) }), TASK],
  ["an uncertain cloud call with no diagnostic", end({ reason: "runtime_failure_progress_preserved", runtimeBrokerCode: UNCERTAIN_CALL_BROKER_CODE, uncertainCall: cloud(undefined as never) }), TASK],
  ["an uncertain call with no row", end({ reason: "runtime_failure_progress_preserved", runtimeBrokerCode: UNCERTAIN_CALL_BROKER_CODE }), infra("runtime_failure_progress_preserved")],
  ["a runtime failure of the sandbox", end({ reason: "runtime_failure_progress_preserved", uncertainCall: cloud({ phase: "settlement", code: "fee_settlement_failed" }) }), infra("runtime_failure_progress_preserved")],
  // A public phase's end carries the session's prefix; the same rules apply to the phase's own reason.
  ["a public phase whose zero-fee call failed", end({ reason: "public_model_unavailable", failingCall: zeroFee }), infra("public_model_unavailable")],
  ["a public phase whose cloud call answered 402", end({ reason: "public_model_unavailable", failingCall: cloud(transport("http_rejected", { status: 402 })) }), TASK],
  ["a public phase's runtime failure", end({ reason: "public_runtime_failure_progress_preserved" }), infra("public_runtime_failure_progress_preserved")],
  ["a public phase whose retained sources failed", end({ reason: "public_public_source_retention_or_text_failed" }), infra("public_public_source_retention_or_text_failed")],
  ["a public phase cut by the loop's interrupt", end({ reason: "public_cancelled_or_deadline", stopSignalled: true }), infra("public_operator_stop")],
  ["a public phase on its own clock", end({ reason: "public_cancelled_or_deadline" }), TASK],
  ["a public phase out of allowance", end({ reason: "public_bounded_allowance_exhausted" }), TASK],
  ["a public prefix on nothing", end({ reason: "public_" }), TASK],
  ...INFRA_HOST_REASONS.map(reason => [`the host-side end ${reason}`, end({ reason }), infra(reason)] as [string, RunEndEvidence, RunClass]),
  ["a failed call with no failed row", end(), infra("model_unavailable")],
  ["a failed zero-fee local call", end({ failingCall: zeroFee }), infra("model_unavailable")],
  ...["connection_failed", "upstream_closed", "response_interrupted"].map(code => [`a cloud call that failed with ${code}`, end({ failingCall: cloud(transport(code)) }), infra("model_unavailable")] as [string, RunEndEvidence, RunClass]),
  ["a cloud call answered 503", end({ failingCall: cloud(transport("http_rejected", { status: 503 })) }), infra("model_unavailable")],
  ["a cloud call answered 529", end({ failingCall: cloud(transport("http_rejected", { status: 529 })) }), infra("model_unavailable")],
  // Version 1's reading (BL-20261110-0723, owner question (d)): only the Anthropic arm records the spend flags, so a 429 with no recorded kind, as every other arm records one, is transient.
  ["a cloud call answered 429 with no recorded kind", end({ failingCall: cloud(transport("http_rejected", { status: 429 })) }), infra("model_unavailable")],
  ["a cloud stream that errored 500", end({ failingCall: cloud(transport("stream_error", { status: 500 })) }), infra("model_unavailable")],
  ["a cloud call answered 429 with the spend cap", end({ failingCall: cloud(transport("http_rejected", { status: 429, spendCap: true })) }), TASK],
  ["a cloud call answered 429 with the spend limit", end({ failingCall: cloud(transport("http_rejected", { status: 429, spendLimit: true })) }), TASK],
  ["a cloud call answered 401", end({ failingCall: cloud(transport("http_rejected", { status: 401 })) }), TASK],
  ["a cloud call answered 400", end({ failingCall: cloud(transport("http_rejected", { status: 400 })) }), TASK],
  ["a cloud call answered 402", end({ failingCall: cloud(transport("http_rejected", { status: 402 })) }), TASK],
  ["a cloud call with no diagnostic", end({ failingCall: cloud(undefined as never) }), TASK],
  ["a cloud call whose reply failed settlement", end({ failingCall: cloud({ phase: "settlement", code: "response_or_usage_invalid" }) }), TASK],
  ["a reading stage whose zero-fee call failed", end({ reason: "research_request_denied", stageDenied: FAILED_CALL_STAGE_CODE, failingCall: zeroFee }), infra("research_request_failed")],
  ["a reading stage whose cloud call answered 402", end({ reason: "research_request_denied", stageDenied: FAILED_CALL_STAGE_CODE, failingCall: cloud(transport("http_rejected", { status: 402 })) }), TASK],
  ...INFRA_TOKEN_ADMISSION_CODES.map(code => [`a reading stage denied ${code}`, end({ reason: "research_request_denied", stageDenied: code }), infra(code)] as [string, RunEndEvidence, RunClass]),
  ...INFRA_BROKER_CODES.map(code => [`a reading stage denied ${code}`, end({ reason: "research_request_denied", stageDenied: code }), infra(code)] as [string, RunEndEvidence, RunClass]),
  ...["deadline_before_request", "request_body_size_exceeded", "local_token_context_exceeded", "budget_denied", "cancelled"].map(code =>
    [`a reading stage denied ${code}`, end({ reason: "research_request_denied", stageDenied: code }), TASK] as [string, RunEndEvidence, RunClass]),
  ...INFRA_TOKEN_ADMISSION_CODES.map(code => [`a token admission denied ${code}`, end({ reason: "local_token_admission_denied", tokenAdmissionCode: code }), infra(code)] as [string, RunEndEvidence, RunClass]),
  ["a token admission over the context", end({ reason: "local_token_admission_denied", tokenAdmissionCode: "local_token_context_exceeded" }), TASK],
  ["a token admission without a code", end({ reason: "local_token_admission_denied" }), TASK],
  ["a token admission the loop's interrupt cut", end({ reason: "local_token_admission_denied", tokenAdmissionCode: STOP_TOKEN_ADMISSION_CODE, stopSignalled: true }), infra("operator_stop")],
  ["a token admission cancelled without the loop's mark", end({ reason: "local_token_admission_denied", tokenAdmissionCode: STOP_TOKEN_ADMISSION_CODE }), TASK],
  // Odd types never count as the mark or as a code.
  ["a mark that is not true", end({ reason: "cancelled_or_deadline", stopSignalled: [] as never }), TASK],
  ["a mark that is truthy but not true", end({ reason: "cancelled_or_deadline", stopSignalled: 1 as never }), TASK],
  ["a mark that is the string true", end({ reason: "cancelled_or_deadline", stopSignalled: "true" as never }), TASK],
  ["a capture failure that is not a code", end({ reason: "bounded_allowance_exhausted", captureFailure: undefined as never }), TASK],
  ["a verification failure that is not a code", end({ reason: "bounded_allowance_exhausted", verificationFailure: 7 as never }), TASK],
  ["a failing call that is not a row", end({ failingCall: "row" as never }), infra("model_unavailable")],
  ["a broker refusal for a missing destination", end({ reason: "model_request_denied", brokerDenialCode: "destination_missing" }), infra("destination_missing")],
  ["another broker refusal", end({ reason: "model_request_denied", brokerDenialCode: "packet_approval_mismatch" }), TASK],
  // A writer whose destination is missing ends model_request_denied with no marker (model.ts throws before one), so rule (d) reaches it only through a reading stage.
  ["a broker refusal with no marker", end({ reason: "model_request_denied" }), TASK],
  ["an allowance end after a capture failure", end({ reason: "bounded_allowance_exhausted", captureFailure: "capture_timeout" }), infra("verification_unavailable")],
  ["an allowance end after a sandbox verification failure", end({ reason: "bounded_allowance_exhausted", verificationFailure: "sandbox_unavailable" }), infra("verification_unavailable")],
  ["an allowance end after another verification failure", end({ reason: "bounded_allowance_exhausted", verificationFailure: "verification_failed" }), TASK],
  ["an allowance end with a verified validation", end({ reason: "bounded_allowance_exhausted" }), TASK],
  ...STOP_REASONS.map(reason => [`${reason} cut by the loop's interrupt`, end({ reason, stopSignalled: true }), infra("operator_stop")] as [string, RunEndEvidence, RunClass]),
  ...STOP_REASONS.map(reason => [`${reason} without the loop's mark`, end({ reason }), TASK] as [string, RunEndEvidence, RunClass]),
  ...["session_deadline", "deadline_before_request", "deadline_before_completion", "fee_cap_reached", "request_body_size_exceeded", "research_plan_invalid", "model_output_incomplete",
    "repeated_identical_execution_failure", "research_stage_not_replayed", "checkpoint_identity_mismatch", "runtime_contract_drift"].flatMap(reason =>
    [[`${reason}`, end({ reason }), TASK], [`${reason} with the loop's mark`, end({ reason, stopSignalled: true }), TASK]] as [string, RunEndEvidence, RunClass][]),
];

describe("the infra_invalid classification (backlog item 11, part 3a)", () => {
  it("pins version 1's lists literally: changing one needs a new version and its own entry", () => {
    expect(RUN_CLASSIFICATION_VERSION).toBe(1);
    expect({ INFRA_HOST_REASONS, FAILED_CALL_STAGE_CODE, INFRA_TOKEN_ADMISSION_CODES, INFRA_BROKER_CODES, STOP_REASONS, STOP_TOKEN_ADMISSION_CODE, UNCERTAIN_CALL_BROKER_CODE, PUBLIC_PHASE_PREFIX,
      INFRA_CRITIQUE_CODES, TRANSIENT_TRANSPORT_CODES }).toEqual({
      INFRA_HOST_REASONS: ["runtime_failure_progress_preserved", "execution_context_unavailable", "cleanup_required", "orphan_cleanup_required", "job_context_busy", "session_failure",
        "source_changed_during_run", "public_snapshot_changed_during_run", "packet_scan_unavailable", "unresolved_dispatch_no_replay", "public_source_retention_or_text_failed"],
      FAILED_CALL_STAGE_CODE: "request_failed",
      INFRA_TOKEN_ADMISSION_CODES: ["local_token_admission_helper_failed", "local_token_admission_timeout", "local_token_admission_proof_invalid", "local_token_admission_pin_drift",
        "local_token_admission_invalid", "local_token_admission_missing"],
      INFRA_BROKER_CODES: ["destination_missing", "packet_scan_failed", "unresolved_dispatch"],
      STOP_REASONS: ["cancelled_or_deadline", "research_cancelled", "session_cancelled", "session_stopped", "session_unresolved_or_deadline", "cancelled_before_completion"],
      STOP_TOKEN_ADMISSION_CODE: "local_token_admission_cancelled", UNCERTAIN_CALL_BROKER_CODE: "transport_or_settlement_unknown", PUBLIC_PHASE_PREFIX: "public_",
      INFRA_CRITIQUE_CODES: ["request_failed", "repair_source_changed_during_critique"], TRANSIENT_TRANSPORT_CODES: ["connection_failed", "upstream_closed", "response_interrupted"] });
  });
  it("names only codes the source writes, and keeps the lists disjoint where they must be", () => {
    // Every listed code is a literal some module of the private agent or the harness writes.
    const files = [...readdirSync(join(ROOT, "src", "main", "private-agent")).filter(name => name.endsWith(".ts") && name !== "run-classification.ts").map(name => join(ROOT, "src", "main", "private-agent", name)),
      ...readdirSync(join(ROOT, "scripts")).filter(name => name.endsWith(".ts")).map(name => join(ROOT, "scripts", name))];
    const source = files.map(path => readFileSync(path, "utf8")).join("\n");
    const codes = [...INFRA_HOST_REASONS, ...INFRA_TOKEN_ADMISSION_CODES, ...INFRA_BROKER_CODES, ...STOP_REASONS, ...INFRA_CRITIQUE_CODES, ...TRANSIENT_TRANSPORT_CODES, FAILED_CALL_STAGE_CODE,
      STOP_TOKEN_ADMISSION_CODE, UNCERTAIN_CALL_BROKER_CODE, "runtime_failure",
      "model_unavailable", "research_request_denied", "local_token_admission_denied", "model_request_denied", "bounded_allowance_exhausted", "broker_denied"];
    for (const code of codes) expect(source, code).toContain(`"${code}"`);
    expect(new Set([...INFRA_HOST_REASONS, ...STOP_REASONS]).size).toBe(INFRA_HOST_REASONS.length + STOP_REASONS.length);
    expect(INFRA_TOKEN_ADMISSION_CODES).not.toContain("local_token_context_exceeded");
  });
  it.each(CASES)("classifies %s", (_label, evidence, expected) => {
    expect(classifyRunEnd(evidence)).toEqual(expected);
  });
  it("calls a cloud failure transient only when a retry could have succeeded, never on a spend cap or limit, as the broker's retry rule does", () => {
    const diagnostics = [transport("connection_failed"), transport("upstream_closed"), transport("response_interrupted"), transport("request_timeout"), transport("cancelled"),
      transport("response_oversize"), transport("transport_failed"), transport("inactivity_timeout"), transport("stream_invalid"),
      ...[400, 401, 402, 403, 404, 408, 409, 413, 422, 429, 500, 502, 503, 504, 529].flatMap(status => [transport("http_rejected", { status }), transport("stream_error", { status })])];
    for (const failure of diagnostics) expect(isTransientCloudFailure(failure), JSON.stringify(failure)).toBe(isRetryableAbort(failure as never));
    expect(isTransientCloudFailure(transport("http_rejected", { status: 529, spendCap: true }))).toBe(false);
    expect(isTransientCloudFailure({ phase: "settlement", code: "fee_settlement_failed" })).toBe(false);
    for (const odd of [null, undefined, "connection_failed", [], { phase: "transport" }, transport("http_rejected"), transport("http_rejected", { status: "503" })]) expect(isTransientCloudFailure(odd)).toBe(false);
  });
  it("classifies a critique's end by its failure code or the loop's interrupt, and finds a run's failing call", () => {
    expect(classifyCritiqueEnd("request_failed", false)).toEqual(infra("request_failed"));
    expect(classifyCritiqueEnd("repair_source_changed_during_critique", false)).toEqual(infra("repair_source_changed_during_critique"));
    expect(classifyCritiqueEnd("repair_critique_empty", false)).toEqual(TASK);
    // Part 3b amends the helper (BL-20261113-0836, decision (1)): the interrupt counts as the operator's only on an infrastructure failure or no record.
    expect(classifyCritiqueEnd("repair_critique_empty", true)).toEqual(TASK); expect(classifyCritiqueEnd("request_failed", true)).toEqual(infra("operator_stop"));
    expect(classifyCritiqueEnd(null, false)).toEqual(infra("run_unfinished")); expect(classifyCritiqueEnd(null, true)).toEqual(infra("operator_stop"));
    const assistFailed = { status: "failed", purpose: "research plan assist" }, later = { ...zeroFee, purpose: "research source index" }, unknownCloud = { ...cloud(transport("request_timeout")), status: "unknown" };
    expect(lastCall([{ status: "settled" }, zeroFee, { status: "superseded" }, assistFailed], "failed")).toBe(zeroFee);
    expect(lastCall([zeroFee, later], "failed")).toBe(later); expect(lastCall([later, zeroFee], "failed")).toBe(zeroFee);
    expect(lastCall([{ status: "settled" }, assistFailed], "failed")).toBeNull(); expect(lastCall([], "failed")).toBeNull();
    expect(lastCall([zeroFee, unknownCloud, { status: "unknown", purpose: "research plan assist" }], "unknown")).toBe(unknownCloud);
  });
  it("is mirrored by registry-row.py: the same lists, value for value, and the same class for every case", () => {
    const probe = [
      "import importlib.util, json, sys",
      "spec = importlib.util.spec_from_file_location('registry_row', sys.argv[1]); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)",
      "cases = json.load(sys.stdin)",
      "names = ['RUN_CLASSIFICATION_VERSION', 'INFRA_HOST_REASONS', 'FAILED_CALL_STAGE_CODE', 'INFRA_TOKEN_ADMISSION_CODES', 'INFRA_BROKER_CODES', 'STOP_REASONS', 'STOP_TOKEN_ADMISSION_CODE', 'UNCERTAIN_CALL_BROKER_CODE', 'PUBLIC_PHASE_PREFIX', 'INFRA_CRITIQUE_CODES', 'TRANSIENT_TRANSPORT_CODES']",
      "print(json.dumps({'lists': {name: getattr(module, name) for name in names}, 'classes': [module.classify_run_end(case) for case in cases]}))",
    ].join("\n");
    const output = JSON.parse(execFileSync("python3", ["-I", "-c", probe, SCRIPT], { input: JSON.stringify(CASES.map(([, evidence]) => evidence)), encoding: "utf8" })) as
      { lists: Record<string, unknown>; classes: unknown[] };
    expect(output.lists).toEqual({ RUN_CLASSIFICATION_VERSION, INFRA_HOST_REASONS: [...INFRA_HOST_REASONS], FAILED_CALL_STAGE_CODE, INFRA_TOKEN_ADMISSION_CODES: [...INFRA_TOKEN_ADMISSION_CODES],
      INFRA_BROKER_CODES: [...INFRA_BROKER_CODES], STOP_REASONS: [...STOP_REASONS], STOP_TOKEN_ADMISSION_CODE, UNCERTAIN_CALL_BROKER_CODE, PUBLIC_PHASE_PREFIX, INFRA_CRITIQUE_CODES: [...INFRA_CRITIQUE_CODES],
      TRANSIENT_TRANSPORT_CODES: [...TRANSIENT_TRANSPORT_CODES] });
    output.classes.forEach((value, i) => expect(value, CASES[i]![0]).toEqual(CASES[i]![2]));
  });
});

/** Backlog item 11, part 3b (BL-20261113-0836-infra-resume-design, decisions (4) and (10)): the ledger's stop rule and a loop stop's class. */
const committedCloud = { status: "committed", destinationId: "cloud_coordinator", purpose: "research plan", reservedFeeMicrousd: 160_000 };
const committedLocal = { status: "committed", destinationId: "owned_local_model", purpose: "agent reasoning and tool selection", reservedFeeMicrousd: 0 };
const unknownCloud = (failure: Record<string, unknown>) => ({ ...cloud(failure), status: "unknown" });
const assist = (status: string) => ({ status, destinationId: "cloud_coordinator", purpose: "research plan assist", reservedFeeMicrousd: 160_000 });
const ledger = (...dispatches: Record<string, unknown>[]): LoopStopRun => ({ kind: "ledger", dispatches });
const LOOP_CASES: [string, string, LoopStopRun, RunClass][] = [
  ...LOOP_INTEGRITY_STOPS.map(code => [`the integrity stop ${code}`, code, { kind: "result", end: end({ status: "submitted" }) }, infra(code)] as [string, string, LoopStopRun, RunClass]),
  ["a cut run that ended cancelled", "loop_stage_interrupted", { kind: "result", end: end({ reason: "cancelled_or_deadline", stopSignalled: true }) }, infra("operator_stop")],
  ["a cut run that ended on its fee cap", "loop_stage_interrupted", { kind: "result", end: end({ reason: "fee_cap_reached", stopSignalled: true }) }, TASK],
  ["a submitted run stopped by an uncertain row", "loop_stage_unresolved_dispatch", { kind: "result", end: end({ status: "submitted" }) }, { version: RUN_CLASSIFICATION_VERSION, infra: false, cause: "submitted" }],
  ["a run with a result that failed a priced call transiently", "loop_stage_failed_dispatch", { kind: "result", end: end({ failingCall: cloud(transport("http_rejected", { status: 503 })) }) }, infra("model_unavailable")],
  ["an unfinished run with a priced committed row", "loop_stage_unresolved_dispatch", ledger(committedCloud), infra("stage_unresolved_dispatch")],
  ["an unfinished run whose uncertain cloud call's transport failed", "loop_stage_unresolved_dispatch", ledger(unknownCloud(transport("request_timeout"))), infra("stage_unresolved_dispatch")],
  ["an unfinished run whose uncertain cloud reply was refused", "loop_stage_unresolved_dispatch", ledger(unknownCloud({ phase: "settlement", code: "response_or_usage_invalid" })), TASK],
  ["an unfinished run with a committed assist", "loop_stage_unresolved_dispatch", ledger(zeroFee, assist("committed")), infra("stage_unresolved_dispatch")],
  ["an unfinished run whose priced call failed transiently", "loop_stage_failed_dispatch", ledger(cloud(transport("connection_failed"))), infra("stage_failed_dispatch")],
  ["an unfinished run whose priced call answered 402", "loop_stage_failed_dispatch", ledger(cloud(transport("http_rejected", { status: 402 }))), TASK],
  ["an unfinished run whose uncertain row outranks a failed one", "loop_stage_failed_dispatch", ledger(unknownCloud(transport("request_timeout")), cloud(transport("http_rejected", { status: 402 }))), infra("stage_unresolved_dispatch")],
  ["an unfinished run whose last uncertain row was a refused reply, after a call in flight", "loop_stage_unresolved_dispatch", ledger(committedCloud, unknownCloud({ phase: "settlement", code: "response_or_usage_invalid" })), TASK],
  ["an unfinished run with a zero-fee committed row", "loop_stage_incomplete", ledger(zeroFee, committedLocal), infra(RUN_UNFINISHED_CAUSE)],
  ["an unfinished run with skipped and failed assists", "loop_stage_incomplete", ledger(assist("unknown"), assist("failed")), infra(RUN_UNFINISHED_CAUSE)],
  ["an unfinished run with no rows", "loop_stage_incomplete", ledger(), infra(RUN_UNFINISHED_CAUSE)],
  ["a critique with no record", "loop_stage_incomplete", { kind: "critique", code: null, stopSignalled: false }, infra(RUN_UNFINISHED_CAUSE)],
  ["a cut critique with no record", "loop_stage_interrupted", { kind: "critique", code: null, stopSignalled: true }, infra("operator_stop")],
  ["a critique whose local call failed", "loop_stage_incomplete", { kind: "critique", code: "request_failed", stopSignalled: false }, infra("request_failed")],
  ["a cut critique whose reply was empty", "loop_stage_interrupted", { kind: "critique", code: "repair_critique_empty", stopSignalled: true }, TASK],
  ["a cut critique cancelled at its token admission", "loop_stage_interrupted", { kind: "critique", code: "local_token_admission_cancelled", stopSignalled: true }, infra("operator_stop")],
  ["a cut critique whose request was cancelled", "loop_stage_interrupted", { kind: "critique", code: "request_cancelled", stopSignalled: true }, infra("operator_stop")],
  ["a critique cancelled without the loop's mark", "loop_stage_incomplete", { kind: "critique", code: "request_cancelled", stopSignalled: false }, TASK],
  ["an interrupt between stages", LOOP_INTERRUPT_FAILURE, { kind: "none" }, infra("operator_stop")],
  ["a refusal before a session", "local_screen_cloud_key_missing", { kind: "none" }, TASK],
];

describe("why a loop stopped (backlog item 11, part 3b)", () => {
  it("pins the loop-stop lists literally, apart from version 1's run-end lists", () => {
    expect({ RUN_UNFINISHED_CAUSE, LEDGER_STOP_FAILURES, LEDGER_STOP_CAUSES, LOOP_INTEGRITY_STOPS, LOOP_INTERRUPT_FAILURE, CRITIQUE_CANCEL_CODES }).toEqual({ RUN_UNFINISHED_CAUSE: "run_unfinished",
      LEDGER_STOP_FAILURES: ["loop_stage_unresolved_dispatch", "loop_stage_failed_dispatch"], LEDGER_STOP_CAUSES: ["stage_unresolved_dispatch", "stage_failed_dispatch"],
      LOOP_INTEGRITY_STOPS: ["loop_stage_missing", "loop_resume_spent", "loop_stage_mismatch", "loop_resume_mismatch", "loop_stage_ledger_unreadable"], LOOP_INTERRUPT_FAILURE: "loop_interrupted",
      CRITIQUE_CANCEL_CODES: ["local_token_admission_cancelled", "request_cancelled", "retry_wait_cancelled", "transport_cancelled"] });
    const loop = readFileSync(join(ROOT, "scripts", "phase4-loop.ts"), "utf8");
    for (const code of [...LEDGER_STOP_FAILURES, ...LOOP_INTEGRITY_STOPS, LOOP_INTERRUPT_FAILURE, "loop_stage_interrupted", "loop_stage_incomplete"]) expect(loop + readFileSync(join(ROOT, "src", "main", "private-agent", "loop-ledger.ts"), "utf8"), code).toContain(`"${code}"`);
  });
  it("stops on a ledger's uncertain row first, then a priced failed row, and admits a zero-fee committed row and assists", () => {
    expect(ledgerStop([zeroFee, committedLocal, assist("unknown"), assist("failed")])).toBeNull();
    expect(ledgerStop([committedCloud, cloud(transport("connection_failed"))])).toEqual({ failure: "loop_stage_unresolved_dispatch", row: committedCloud });
    expect(ledgerStop([cloud(transport("connection_failed")), zeroFee])?.failure).toBe("loop_stage_failed_dispatch");
    expect(ledgerStop([{ ...committedLocal, approval: { proposalId: "p" } }])?.failure).toBe("loop_stage_unresolved_dispatch");
    expect(ledgerStop([{ ...zeroFee, reservedFeeMicrousd: 1 }])?.failure).toBe("loop_stage_failed_dispatch");
    expect(ledgerStop([assist("committed")])?.failure).toBe("loop_stage_unresolved_dispatch");
  });
  it.each(LOOP_CASES)("classifies %s", (_label, failure, run, expected) => {
    expect(classifyLoopStop(failure, run)).toEqual(expected);
  });
  it("is mirrored by registry-row.py: the same lists, ledger stops and classes", () => {
    const probe = [
      "import importlib.util, json, sys",
      "spec = importlib.util.spec_from_file_location('registry_row', sys.argv[1]); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)",
      "cases = json.load(sys.stdin)",
      "names = ['RUN_UNFINISHED_CAUSE', 'LEDGER_STOP_FAILURES', 'LEDGER_STOP_CAUSES', 'LOOP_INTEGRITY_STOPS', 'LOOP_INTERRUPT_FAILURE', 'CRITIQUE_CANCEL_CODES']",
      "stops = [module.ledger_stop(case[1]['dispatches']) if case[1].get('kind') == 'ledger' else None for case in cases]",
      "print(json.dumps({'lists': {name: getattr(module, name) for name in names}, 'classes': [module.classify_loop_stop(case[0], case[1]) for case in cases], 'stops': [stop[0] if stop else None for stop in stops], 'rows': [stop[1] if stop else None for stop in stops]}))",
    ].join("\n");
    const output = JSON.parse(execFileSync("python3", ["-I", "-c", probe, SCRIPT], { input: JSON.stringify(LOOP_CASES.map(([, failure, run]) => [failure, run])), encoding: "utf8" })) as
      { lists: Record<string, unknown>; classes: unknown[]; stops: (string | null)[]; rows: unknown[] };
    expect(output.lists).toEqual({ RUN_UNFINISHED_CAUSE, LEDGER_STOP_FAILURES: [...LEDGER_STOP_FAILURES], LEDGER_STOP_CAUSES: [...LEDGER_STOP_CAUSES], LOOP_INTEGRITY_STOPS: [...LOOP_INTEGRITY_STOPS], LOOP_INTERRUPT_FAILURE,
      CRITIQUE_CANCEL_CODES: [...CRITIQUE_CANCEL_CODES] });
    output.classes.forEach((value, i) => expect(value, LOOP_CASES[i]![0]).toEqual(LOOP_CASES[i]![3]));
    output.stops.forEach((value, i) => { const run = LOOP_CASES[i]![2]; if (run.kind === "ledger") expect(value, LOOP_CASES[i]![0]).toBe(ledgerStop(run.dispatches)?.failure ?? null); });
    // The same row stops in both: the last uncertain row, else the last priced failed one.
    output.rows.forEach((value, i) => { const run = LOOP_CASES[i]![2]; if (run.kind === "ledger") expect(value, LOOP_CASES[i]![0]).toEqual(ledgerStop(run.dispatches)?.row ?? null); });
  });
});
