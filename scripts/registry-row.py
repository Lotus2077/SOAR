#!/usr/bin/env python3
"""Emit one sanitized trial-registry row (docs/experiments/README.md) from a headless run, an H4 loop, a desktop verdict receipt
or an existing registry row.

    python3 scripts/registry-row.py --run-dir .soar/experiments/<batch>/runs/<run> \
        --id p0d-t1-website-heavy --batch phase0-discriminator --task t1-website \
        --family website --exposure exposed --arm local-heavy \
        --outcome rejected --critical-checks 26/30 --verdict-by agent_diagnostic \
        --lesson "..." >> docs/experiments/registry.jsonl

Counts come from the run's own state.sqlite and result.json. The row holds hashes,
counts and enums only: no paths, endpoints, prompts or outputs.

`git`, `gitSource` and `gitDirty` (backlog item 11, BL-20261109-0422): a run row takes the commit from the run's own
freeze.json (`gitSource` run), a loop row from the selected run's (`run`, or `runs_differ` when the loop's stage freezes do
not all record that commit), and a row whose run recorded none, a --verdict-file row and a --supersedes row of a row
without a run-sourced commit take the commit the row is written at (`row_written`, `gitDirty` null).

H4: `--loop-dir LOOP` instead of `--run-dir` rows a select-and-repair loop (scripts/phase4-loop.ts): the per-run
counts of the loop's runs are summed with the same logic, status, cause and binding come from the selected run,
wall seconds from the loop's own clock, and a `loop` field records the choice. From backlog item 11's part 3b
(BL-20261113-0836), loop versions 1 and 2: the counts sum every run the loop made, moved-aside runs included, the
writer waits for no loop (a held loop.lock refuses), and a loop that ended without a selection is rowed by its
stop's class, never as accepted.

Owner verdicts (BL-20261108-0904-owner-verdict-capture-design):

    `--verdict-file RECEIPT.json` rows a desktop task from the app's verdict receipt ("Export verdict receipt"). The
    receipt holds hashes, counts, enums and the verdict only; any other key is refused. It supplies the measurements,
    `arm`, `outcome`, `ownerMinutes`, `interventions`, `verdictAt` and `exportedThroughApp`; the operator types --id,
    --batch, --task, --family, --exposure, --lesson and --verdict-by owner.

    `--supersedes ROW_ID [--registry PATH]` copies the registry row with that id verbatim (every measurement,
    taskJobSha256, date, usd, entailment, hostFlags, loop) and changes only id, supersedes, outcome, verdictBy, ownerMinutes,
    interventions, lesson, verdictAt and, unless the copied row's commit came from its run (gitSource run or
    runs_differ), git, gitSource and gitDirty (the commit the row is written at). It refuses an unknown id, an id
    another row already supersedes, and a new id that already exists.

Exactly one of --run-dir, --loop-dir, --verdict-file and --supersedes is accepted. `--verdict-by` is `owner`,
`agent_diagnostic` or `none`; `owner` requires --owner-minutes and --interventions (the receipt supplies them).

Plan 11.4: --run-dir and --loop-dir rows add reservedUsd, pinnedUsd, committedDispatches, cloudCalls, disclosedBytes, urls,
domains, retainedBytes, actions, queries and researchFallback (docs/experiments/README.md). With --run-dir,
--launcher-ledger STATE/launcher.jsonl reads whether the experiment launcher forwarded a signal to the run.
"""

from __future__ import annotations

import argparse
import copy
import datetime
import hashlib
import json
import math
import os
import pathlib
import re
import shutil
import sqlite3
import urllib.parse
import subprocess
import sys
import tempfile

OUTCOMES = ("accepted", "rejected", "incomplete", "infra_invalid")
EXPOSURES = ("fresh", "exposed")
VERDICTS = ("owner", "agent_diagnostic", "none")
REPOSITORY_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_REGISTRY = os.path.join(REPOSITORY_ROOT, "docs", "experiments", "registry.jsonl")
# The desktop verdict receipt (src/main/general-tasks/controller.ts, VERDICT_RECEIPT_KEYS): exactly these keys, nothing else.
RECEIPT_KEYS = frozenset(("version", "taskId", "taskJobSha256", "date", "profile", "thinking", "maxOutputTokens", "runStatus", "terminalCause",
                          "modelCalls", "toolCalls", "wallSeconds", "inputTokens", "outputTokens", "cachedTokens", "cacheWriteTokens", "lengthStops", "usd",
                          "unknownDispatches", "retriedDispatches", "failedDispatches", "entailment", "arm", "verdict", "cloudModel", "cloudApi"))
RECEIPT_VERDICT_KEYS = frozenset(("decision", "ownerMinutes", "interventions", "exportedThroughApp", "recordedAt"))
RECEIPT_ENTAILMENT_KEYS = frozenset(("counts", "entailmentCalls", "truncated", "supportRate"))
RECEIPT_COUNT_KEYS = frozenset(("supported", "partial", "unsupported", "contradicted", "not_judged"))
RECEIPT_COUNTS = ("maxOutputTokens", "modelCalls", "toolCalls", "inputTokens", "outputTokens", "cachedTokens", "cacheWriteTokens", "lengthStops",
                  "unknownDispatches", "retriedDispatches", "failedDispatches")
# Enum-like identifiers only: a status, cause, profile or thinking mode is never free text.
IDENTIFIER = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--id", required=True, help="the new row's id; it must not exist in the registry when --supersedes is used")
    parser.add_argument("--lesson", required=True)
    parser.add_argument("--verdict-by", required=True, help="owner, agent_diagnostic or none")
    for name in ("--batch", "--task", "--family", "--exposure"):
        parser.add_argument(name, default=None, help="required unless --supersedes copies it")
    parser.add_argument("--arm", default=None, help="required unless --supersedes or --verdict-file supplies it")
    parser.add_argument("--outcome", default=None, help="accepted, rejected, incomplete or infra_invalid; from the receipt with --verdict-file")
    parser.add_argument("--run-dir", default=None)
    parser.add_argument("--launcher-ledger", default=None, help="with --run-dir: the launcher.jsonl whose run_exited record says whether a signal was forwarded")
    parser.add_argument("--loop-dir", default=None, help="H4: a select-and-repair loop directory (loop.json) instead of one run")
    parser.add_argument("--verdict-file", default=None, help="a desktop verdict receipt (JSON) instead of a run directory")
    parser.add_argument("--supersedes", default=None, metavar="ROW_ID", help="copy the registry row with this id and change only its verdict fields")
    parser.add_argument("--registry", default=DEFAULT_REGISTRY, help="the registry --supersedes reads (default: docs/experiments/registry.jsonl)")
    parser.add_argument("--critical-checks", default=None, help="passed/total, e.g. 26/30")
    parser.add_argument("--owner-minutes", type=float, default=None, help="owner effort; required with --verdict-by owner")
    parser.add_argument("--interventions", type=int, default=None, help="manual interventions; required with --verdict-by owner, else 0")
    parser.add_argument("--verdict-at", default=None, help="UTC ISO 8601 time of the verdict, e.g. 2026-11-07T08:30:00Z; default: now")
    args = parser.parse_args()

    sources = [name for name, value in (("--run-dir", args.run_dir), ("--loop-dir", args.loop_dir), ("--verdict-file", args.verdict_file), ("--supersedes", args.supersedes)) if value is not None]
    if len(sources) != 1:
        sys.exit("give exactly one of --run-dir, --loop-dir, --verdict-file and --supersedes")
    if args.launcher_ledger is not None and args.run_dir is None:
        sys.exit("--launcher-ledger goes with --run-dir only")
    required = [] if args.verdict_file is not None else ["--outcome"]
    if args.supersedes is None:
        required += ["--batch", "--task", "--family", "--exposure"] + ([] if args.verdict_file is not None else ["--arm"])
    missing = [name for name in required if getattr(args, name[2:].replace("-", "_")) is None]
    if missing:
        sys.exit("missing " + ", ".join(missing))
    if args.outcome is not None and args.outcome not in OUTCOMES:
        sys.exit("invalid --outcome")
    if args.exposure is not None and args.exposure not in EXPOSURES:
        sys.exit("invalid --exposure")
    if args.verdict_by not in VERDICTS:
        sys.exit("invalid --verdict-by: use owner, agent_diagnostic or none (the registry's other values are legacy and are never re-rowed)")
    if args.owner_minutes is not None and (not math.isfinite(args.owner_minutes) or args.owner_minutes < 0):
        sys.exit("--owner-minutes must be a finite number of minutes, at least 0")
    if args.interventions is not None and args.interventions < 0:
        sys.exit("--interventions must be an integer, at least 0")
    if args.verdict_by != "owner" and args.owner_minutes is not None:
        sys.exit("--owner-minutes records owner effort: give it with --verdict-by owner only")
    if args.verdict_by == "owner" and args.verdict_file is None and (args.owner_minutes is None or args.interventions is None):
        sys.exit("--verdict-by owner requires --owner-minutes and --interventions")

    if args.loop_dir is not None:
        row = loop_row(args)
    elif args.run_dir is not None:
        single = run_counts(args.run_dir)
        row = {**single["row"], **{key: single[key] for key in SUMMED}, "wallSeconds": single["wallSeconds"], **single["depth"]}
        signalled = launcher_signalled(args.launcher_ledger, args.run_dir) if args.launcher_ledger is not None else False
        row["runClass"] = classify_run_end(run_end_evidence(args.run_dir, signalled))
        check_outcome(args.outcome, row.get("runStatus"), row["runClass"])
    elif args.verdict_file is not None:
        row = receipt_row(args)
    else:
        row = superseding_row(args)
        # A correction repeats the class checks against the copied run's class, when the copy carries one.
        check_outcome(args.outcome, row.get("runStatus"), row.get("runClass"))
        refuse_unselected_accept(args.outcome, row.get("loop"))
    row.update({"id": args.id, **row_provenance(args, row), "verdictBy": args.verdict_by, "lesson": args.lesson})
    for key, value in (("batch", args.batch), ("task", args.task), ("family", args.family), ("exposure", args.exposure), ("arm", args.arm), ("outcome", args.outcome)):
        if value is not None:
            row[key] = value
    if args.critical_checks is not None or "criticalChecks" not in row:
        row["criticalChecks"] = args.critical_checks
    if args.verdict_file is None:
        row["ownerMinutes"] = args.owner_minutes
        row["interventions"] = args.interventions if args.interventions is not None else 0
        if args.verdict_at is not None or args.supersedes is not None:
            row["verdictAt"] = utc_iso(args.verdict_at, "--verdict-at")
    print(json.dumps(row, sort_keys=True))
    return 0


SUMMED = ("modelCalls", "toolCalls", "inputTokens", "outputTokens", "cachedTokens", "cacheWriteTokens", "lengthStops", "usd", "unknownDispatches", "retriedDispatches", "failedDispatches",
          "assistSkippedDispatches", "assistFailedDispatches",
          "zeroFeeFailedDispatches")
# The sealed cloud one-shots' purposes (src/main/private-agent/dispatch-purposes.ts; backlog item 10): an unknown or failed assist row is
# counted in its own column and never as an unresolved or failed dispatch of the run.
ASSIST_PURPOSES = ("research plan assist", "research synthesis assist")


def is_assist(item: dict) -> bool:
    return item.get("purpose") in ASSIST_PURPOSES


# The harness destinations that never carry a fee (selection.ts ZERO_FEE_DESTINATIONS; backlog item 11): the owned local model and the
# loopback public-snapshot fixture. An allowlist, so a destination added later is never counted as zero-fee until it is named here.
ZERO_FEE_DESTINATIONS = ("owned_local_model", "approved_public_snapshots")


def is_zero(value) -> bool:
    """A JSON number equal to 0; a boolean, a string or null is not."""
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value == 0


def is_zero_fee_failed(item: dict) -> bool:
    """A resolved zero-fee failure (selection.ts isZeroFeeFailedDispatch; backlog item 11): a failed row, not an assist, to a
    destination in ZERO_FEE_DESTINATIONS, reserved at exactly 0, with no fee key or a fee of 0 and no approval key. The H4 loop
    admits these rows; a missing or malformed field fails closed."""
    return item.get("status") == "failed" and is_zero_fee(item)


def is_zero_fee(item: dict) -> bool:
    """Part 1's zero-fee predicate apart from the status (selection.ts isZeroFeeDispatch; backlog item 11, part 3b)."""
    return (not is_assist(item) and isinstance(item.get("destinationId"), str) and item["destinationId"] in ZERO_FEE_DESTINATIONS
            and is_zero(item.get("reservedFeeMicrousd")) and ("feeMicrousd" not in item or is_zero(item["feeMicrousd"])) and "approval" not in item)


# Backlog item 11, part 3a (BL-20261109-0515-infra-classification-design): whether a run that did not submit ended on infrastructure,
# labelled `infra_invalid`, from recorded codes only. src/main/private-agent/run-classification.ts holds the same lists and function,
# and tests/unit/run-classification.test.ts keeps them equal.
RUN_CLASSIFICATION_VERSION = 1
INFRA_HOST_REASONS = ("runtime_failure_progress_preserved", "execution_context_unavailable", "cleanup_required", "orphan_cleanup_required",
                      "job_context_busy", "session_failure", "source_changed_during_run", "public_snapshot_changed_during_run", "packet_scan_unavailable",
                      "unresolved_dispatch_no_replay", "public_source_retention_or_text_failed")
FAILED_CALL_STAGE_CODE = "request_failed"
INFRA_TOKEN_ADMISSION_CODES = ("local_token_admission_helper_failed", "local_token_admission_timeout", "local_token_admission_proof_invalid",
                               "local_token_admission_pin_drift", "local_token_admission_invalid", "local_token_admission_missing")
INFRA_BROKER_CODES = ("destination_missing", "packet_scan_failed", "unresolved_dispatch")
STOP_REASONS = ("cancelled_or_deadline", "research_cancelled", "session_cancelled", "session_stopped", "session_unresolved_or_deadline",
                "cancelled_before_completion")
STOP_TOKEN_ADMISSION_CODE = "local_token_admission_cancelled"
UNCERTAIN_CALL_BROKER_CODE = "transport_or_settlement_unknown"
PUBLIC_PHASE_PREFIX = "public_"
INFRA_CRITIQUE_CODES = ("request_failed", "repair_source_changed_during_critique")
TRANSIENT_TRANSPORT_CODES = ("connection_failed", "upstream_closed", "response_interrupted")


def listed(values: tuple, value) -> bool:
    return isinstance(value, str) and value in values


def is_transient_cloud_failure(failure) -> bool:
    """A cloud transport failure that is not the arm's or its configuration's: a transient answer, never a spend cap or limit."""
    if not isinstance(failure, dict) or failure.get("phase") != "transport" or failure.get("spendCap") is True or failure.get("spendLimit") is True:
        return False
    if listed(TRANSIENT_TRANSPORT_CODES, failure.get("code")):
        return True
    status = failure.get("status")
    return failure.get("code") in ("http_rejected", "stream_error") and isinstance(status, (int, float)) and not isinstance(status, bool) and (status >= 500 or status == 429)


def failed_call_is_infra(row) -> bool:
    if not isinstance(row, dict):
        return True
    return is_zero_fee_failed(row) or is_transient_cloud_failure(row.get("failure"))


def uncertain_call_is_infra(row) -> bool:
    if not isinstance(row, dict):
        return True
    failure = row.get("failure")
    return isinstance(failure, dict) and failure.get("phase") == "transport"


def classify_core(end: dict, reason: str):
    """The rules of decision (1) on a reason with any public-phase prefix already stripped; None when no rule holds."""
    denied, token, broker = end.get("stageDenied"), end.get("tokenAdmissionCode"), end.get("brokerDenialCode")
    if listed(INFRA_HOST_REASONS, reason):
        if reason == "runtime_failure_progress_preserved" and end.get("runtimeBrokerCode") == UNCERTAIN_CALL_BROKER_CODE and not uncertain_call_is_infra(end.get("uncertainCall")):
            return None
        return reason
    if reason == "model_unavailable" and failed_call_is_infra(end.get("failingCall")):
        return "model_unavailable"
    if reason == "research_request_denied":
        if denied == FAILED_CALL_STAGE_CODE and failed_call_is_infra(end.get("failingCall")):
            return "research_request_failed"
        if listed(INFRA_TOKEN_ADMISSION_CODES, denied) or listed(INFRA_BROKER_CODES, denied):
            return denied
    if reason == "local_token_admission_denied" and listed(INFRA_TOKEN_ADMISSION_CODES, token):
        return token
    if reason == "model_request_denied" and listed(INFRA_BROKER_CODES, broker):
        return broker
    verification = end.get("verificationFailure")
    if reason == "bounded_allowance_exhausted" and (isinstance(end.get("captureFailure"), str) or (isinstance(verification, str) and verification.startswith("sandbox_"))):
        return "verification_unavailable"
    if end.get("stopSignalled") is True and (listed(STOP_REASONS, reason) or (reason == "local_token_admission_denied" and token == STOP_TOKEN_ADMISSION_CODE)):
        return "operator_stop"
    return None


def classify_run_end(end: dict) -> dict:
    """The run's class (run-classification.ts classifyRunEnd); a submitted run is never infrastructure."""
    if end.get("status") == "submitted":
        return {"version": RUN_CLASSIFICATION_VERSION, "infra": False, "cause": "submitted"}
    reason = end.get("reason") if isinstance(end.get("reason"), str) else ""
    cause = classify_core(end, reason)
    # A public phase's end carries the session's prefix: the same rules apply to the phase's own reason, and the cause keeps the prefix.
    if cause is None and reason.startswith(PUBLIC_PHASE_PREFIX):
        inner = classify_core(end, reason[len(PUBLIC_PHASE_PREFIX):])
        if inner is not None:
            cause = PUBLIC_PHASE_PREFIX + inner
    if cause is None:
        return {"version": RUN_CLASSIFICATION_VERSION, "infra": False, "cause": "task"}
    return {"version": RUN_CLASSIFICATION_VERSION, "infra": True, "cause": cause}


def last_call(dispatches: list, status: str):
    return next((item for item in reversed(dispatches) if item.get("status") == status and not is_assist(item)), None)


def run_end_evidence(run_dir: str, stop_signalled: bool) -> dict:
    """What a run's own records say about how it ended: result.json and its ledger's events, codes and rows only
    (selection.ts readRunEndEvidence reads the same)."""
    result = read_object(run_dir, "result.json") or {}
    events = ledger_rows(run_dir)[0]
    dispatches = [item for item in (result.get("dispatches") if isinstance(result.get("dispatches"), list) else []) if isinstance(item, dict)]
    stage = next((event for event in reversed(events) if event.get("type") == "research_stage" and isinstance(event.get("denied"), str)), None)
    validation = next((event for event in reversed(events) if event.get("type") == "host_validation_finished"), None) or {}
    runtime = next((event for event in reversed(events) if event.get("type") == "runtime_failure"), None) or {}

    def code_of(value):
        return value["code"] if isinstance(value, dict) and isinstance(value.get("code"), str) else None

    def not_dispatched(reason):
        return next((event["code"] for event in reversed(events) if event.get("type") == "model_request_not_dispatched" and event.get("reason") == reason
                     and isinstance(event.get("code"), str)), None)
    text = lambda value: value if isinstance(value, str) else ""
    return {"status": text(result.get("status")), "reason": text(result.get("reason")), "stageDenied": stage["denied"] if stage else None,
            "failingCall": last_call(dispatches, "failed"), "uncertainCall": last_call(dispatches, "unknown"),
            "runtimeBrokerCode": runtime.get("brokerCode") if isinstance(runtime.get("brokerCode"), str) else None,
            "captureFailure": code_of(validation.get("captureFailure")), "verificationFailure": code_of(validation.get("verificationFailure")),
            "tokenAdmissionCode": not_dispatched("local_token_admission_denied"), "brokerDenialCode": not_dispatched("broker_denied"),
            "stopSignalled": stop_signalled}


# Backlog item 11, part 3b (BL-20261113-0836-infra-resume-design, decisions (4) and (10)): why a loop stage stopped, for the row of a
# loop that ends without a selection. run-classification.ts holds the same lists and functions (ledgerStop, classifyLoopStop and the
# amended classifyCritiqueEnd), and tests/unit/run-classification.test.ts keeps them equal. Version 1's run-end lists do not change.
RUN_UNFINISHED_CAUSE = "run_unfinished"
LEDGER_STOP_FAILURES = ("loop_stage_unresolved_dispatch", "loop_stage_failed_dispatch")
LEDGER_STOP_CAUSES = ("stage_unresolved_dispatch", "stage_failed_dispatch")
LOOP_INTEGRITY_STOPS = ("loop_stage_missing", "loop_resume_spent", "loop_stage_mismatch", "loop_resume_mismatch", "loop_stage_ledger_unreadable")
LOOP_INTERRUPT_FAILURE = "loop_interrupted"
CRITIQUE_CANCEL_CODES = (STOP_TOKEN_ADMISSION_CODE, "request_cancelled", "retry_wait_cancelled", "transport_cancelled")


def run_class(infra: bool, cause: str) -> dict:
    return {"version": RUN_CLASSIFICATION_VERSION, "infra": infra, "cause": cause}


def ledger_stop(dispatches: list):
    """The row of a stage's ledger that stops the loop before the stage could be moved aside, as (failure, row), or None: an uncertain
    row (a committed row that is not zero-fee, or an unknown row that is not an assist), then a priced failed row."""
    uncertain = next((item for item in reversed(dispatches) if isinstance(item, dict) and ((item.get("status") == "committed" and not is_zero_fee(item))
                                                                                          or (item.get("status") == "unknown" and not is_assist(item)))), None)
    if uncertain is not None:
        return ("loop_stage_unresolved_dispatch", uncertain)
    failed = next((item for item in reversed(dispatches) if isinstance(item, dict) and item.get("status") == "failed" and not is_assist(item) and not is_zero_fee(item)), None)
    return ("loop_stage_failed_dispatch", failed) if failed is not None else None


def classify_critique_end(code, stop_signalled: bool) -> dict:
    """A critique's end: its failure code, None without a record; the loop's interrupt counts only on an infrastructure failure, a
    cancellation it caused, or no record."""
    marked = stop_signalled is True
    if marked and listed(CRITIQUE_CANCEL_CODES, code):
        return run_class(True, "operator_stop")
    if code is not None and not listed(INFRA_CRITIQUE_CODES, code):
        return run_class(False, "task")
    return run_class(True, "operator_stop" if marked else (code if code is not None else RUN_UNFINISHED_CAUSE))


def classify_loop_stop(failure, run: dict) -> dict:
    """The class of a loop's stop, from its code and what the stopped stage left (decision (10))."""
    if listed(LOOP_INTEGRITY_STOPS, failure):
        return run_class(True, failure)
    kind = run.get("kind")
    if kind == "result":
        return classify_run_end(run["end"])
    if kind == "critique":
        return classify_critique_end(run.get("code"), run.get("stopSignalled") is True)
    if kind == "none":
        return run_class(True, "operator_stop") if failure == LOOP_INTERRUPT_FAILURE else run_class(False, "task")
    stop = ledger_stop(run.get("dispatches") or [])
    if stop is not None and stop[0] == "loop_stage_unresolved_dispatch":
        recorded = stop[1].get("failure")
        uncertain = stop[1].get("status") == "committed" or (isinstance(recorded, dict) and recorded.get("phase") == "transport")
        return run_class(True, "stage_unresolved_dispatch") if uncertain else run_class(False, "task")
    if stop is not None and stop[0] == "loop_stage_failed_dispatch":
        return run_class(True, "stage_failed_dispatch") if failed_call_is_infra(stop[1]) else run_class(False, "task")
    return run_class(True, RUN_UNFINISHED_CAUSE)


def reject_constant(name: str):
    """JSON as JavaScript's JSON.parse reads it: NaN and the infinities are not JSON."""
    raise ValueError(f"{name} is not JSON")


def read_object(run_dir: str, name: str):
    """One of a run's own files (or the critique tool's) as a JSON object, or None when it is absent, not a regular file (a symbolic
    link is not followed), not strict UTF-8, led by a byte-order mark, not JSON or not an object. selection.ts readRunObject reads the
    same: part 3b reads a run's files defensively, so one damaged directory never stops a row with a traceback."""
    path = os.path.join(run_dir, name)
    if os.path.islink(path) or not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as handle:
            value = json.load(handle, parse_constant=reject_constant)
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def read_result(run_dir: str):
    """A run's result as part 3b reads one (selection.ts readRunResult): a readable object with a status, a reason and an end time,
    else None, a run that did not finish."""
    result = read_object(run_dir, "result.json")
    return result if result is not None and all(isinstance(result.get(key), str) for key in ("status", "reason", "finishedAt")) else None


def read_freeze(run_dir: str):
    """A run's freeze.json as an object, or None (read_object)."""
    return read_object(run_dir, "freeze.json")


JOB_ID = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
LEDGER_TABLES = ("private_agent_events", "private_agent_dispatches", "private_agent_run_claims")


def frozen(raw) -> bool:
    """Whether a run's freeze is readable with a job, as selection.ts readRunLedger takes one."""
    return isinstance(raw, dict) and isinstance(raw.get("jobId"), str) and JOB_ID.fullmatch(raw["jobId"]) is not None


def ledger_rows(run_dir: str):
    """A run directory's ledger as (events, dispatches, claims), read from a private copy taken with its journal. A process killed
    during a commit leaves a hot journal that a read-only open refuses; the copy rolls it back, and the run directory is never written.
    A run with a readable freeze or a result has a ledger with the store's tables (the driver creates both before its session), so a
    missing one refuses the row, as selection.ts readRunLedger refuses with `run_ledger_missing`; otherwise a missing ledger or table
    gives no rows. A row that is not a JSON object is skipped; a row that is not JSON refuses."""
    path = os.path.join(run_dir, "state.sqlite")
    required = frozen(read_freeze(run_dir)) or os.path.exists(os.path.join(run_dir, "result.json"))
    missing = f"{os.path.basename(os.path.normpath(run_dir))} holds a run without its ledger (state.sqlite and its tables): the row is refused"
    if not os.path.isfile(path):
        if required:
            sys.exit(missing)
        return [], [], []
    with tempfile.TemporaryDirectory(prefix="soar-ledger-") as scratch:
        copied = os.path.join(scratch, "state.sqlite")
        shutil.copyfile(path, copied)
        for suffix in ("-journal", "-wal", "-shm"):
            if os.path.isfile(path + suffix):
                shutil.copyfile(path + suffix, copied + suffix)
        db = sqlite3.connect(copied)
        try:
            tables = {row[0] for row in db.execute("select name from sqlite_master where type = 'table'")}
            if required and not all(table in tables for table in LEDGER_TABLES):
                sys.exit(missing)

            def values(table: str, order: str) -> list:
                if table not in tables:
                    return []
                rows = []
                for (text,) in db.execute(f"select value from {table} order by {order}"):
                    try:
                        value = json.loads(text, parse_constant=reject_constant)
                    except (TypeError, ValueError):
                        sys.exit(f"{os.path.basename(os.path.normpath(run_dir))} holds a ledger row that is not JSON: the row is refused")
                    if isinstance(value, dict):
                        rows.append(value)
                return rows
            return (values("private_agent_events", "job_id, sequence"), values("private_agent_dispatches", "rowid"), values("private_agent_run_claims", "rowid"))
        finally:
            db.close()


def number(value):
    """A finite JSON number, else 0, as selection.ts reads a count (`usageNumber`): a boolean or a string is not a number."""
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else 0


def count(value):
    """A finite, non-negative JSON number, else 0, as phase4-loop.ts `countOf` reads a critique's counts."""
    value = number(value)
    return value if value >= 0 else 0


def counts_of(events: list, dispatches: list) -> dict:
    """One run's counts from its events and dispatch rows (selection.ts runCounts), with `usd` in place of fee micro-USD. A row that
    is not an object is skipped, and a field that is not a finite number counts 0, as there."""
    events = [event for event in events if isinstance(event, dict)]
    dispatches = [item for item in dispatches if isinstance(item, dict)]
    finished = [event for event in events if event.get("type") == "model_finished"]
    research = [event for event in events if event.get("type") == "research_stage"]

    def summed(key: str):
        # H2b: the research stage's calls and tokens come from its content-free stage events, beside the write loop's model events.
        return sum(number(event["usage"].get(key)) for event in finished + research if isinstance(event.get("usage"), dict))
    return {
        "modelCalls": len(finished) + sum(number(event.get("calls")) for event in research),
        "toolCalls": sum(1 for event in events if event.get("type") == "tool_finished"),
        "inputTokens": summed("inputTokens"),
        "outputTokens": summed("outputTokens"),
        # H1 (BL-20261022-0834): prompt tokens the provider reported as served from its cache; 0 when unreported.
        "cachedTokens": summed("cacheReadTokens"),
        # H1 completion: prompt tokens the provider reported as newly written to its cache (billed at the write rate); 0 when unreported.
        "cacheWriteTokens": summed("cacheWriteTokens"),
        "lengthStops": sum(1 for event in finished if event.get("finishReason") == "length") + sum(number(event.get("truncatedReplies")) for event in research),
        "usd": sum(number(item.get("feeMicrousd")) for item in dispatches) / 1_000_000,
        "unknownDispatches": sum(1 for item in dispatches if item.get("status") == "committed" or (item.get("status") == "unknown" and not is_assist(item))),
        # PR-C: attempts superseded by a retry and confirmed failures are resolved rows, never uncertain ones.
        "retriedDispatches": sum(1 for item in dispatches if item.get("status") == "superseded"),
        "failedDispatches": sum(1 for item in dispatches if item.get("status") == "failed" and not is_assist(item)),
        "assistSkippedDispatches": sum(1 for item in dispatches if item.get("status") == "unknown" and is_assist(item)),
        "assistFailedDispatches": sum(1 for item in dispatches if item.get("status") == "failed" and is_assist(item)),
        # Backlog item 11: the part of failedDispatches that reserved and settled nothing, the rows the H4 loop admits.
        "zeroFeeFailedDispatches": sum(1 for item in dispatches if is_zero_fee_failed(item)),
    }


def safe_integer(value):
    """A JSON number that is an integer JavaScript holds exactly (Number.isSafeInteger), as an int, else None."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or (isinstance(value, float) and not (math.isfinite(value) and value.is_integer())):
        return None
    value = int(value)
    return value if abs(value) <= 2 ** 53 - 1 else None


# Plan 11.4 (BL-20261114-1504-registry-columns-design): reserved and pinned USD, cloud calls, disclosure, retrieval and action counts,
# and 7(c)'s fallback markers. Every value is a count, a USD amount, a fixed host enum or null: a retained source's URL is read only
# to count it and its hostname, and never leaves this process.
LOOPBACK_HOSTS = ("127.0.0.1", "::1")
DISPATCH_STATUSES = ("committed", "settled", "unknown", "superseded", "failed")
HOST_TOKEN = re.compile(r"^[a-z][a-z0-9 _-]{0,63}$")
# BL-20261114-1507, decision (1): the runner's closed set of tool names, runner.ts's tools with every option on and observations.ts's
# read_observation. tests/unit/registry-row-columns.test.ts checks this mirror against the runner's own definitions. A tool_started
# event records the name the model chose before the runner checks it, so any other name counts as `other` and never reaches a row.
RUNNER_TOOLS = ("append_file", "check_claims", "execute", "fetch_public", "finish", "read_observation", "remember_plan", "request_consultation", "str_replace", "write_file")


def source_key(url: str) -> str:
    """A retained source's URL as `urls` counts it (BL-20261114-1507, decision (2)). Each run's snapshot receiver listens on its own
    loopback port, so a loopback URL is counted without its port, and one source read by two runs of a loop counts once."""
    try:
        parts = urllib.parse.urlsplit(url)
        host = parts.hostname
    except ValueError:
        return url
    if host not in LOOPBACK_HOSTS:
        return url
    return urllib.parse.urlunsplit((parts.scheme, f"[{host}]" if ":" in host else host, parts.path, parts.query, parts.fragment))


def depth_parts(events: list, dispatches: list) -> dict:
    """One run's parts of plan 11.4's columns, from its events and dispatch rows; `depth_columns` turns one run's, or a loop's runs',
    parts into the row's values. A cloud call is a row of destination kind cloud_model, or on a row written before plan 11.4, one
    whose destination is cloud_coordinator. Disclosure is kept by packet, so a retried packet counts once."""
    events = [event for event in events if isinstance(event, dict)]
    rows = [item for item in dispatches if isinstance(item, dict)]
    cloud, packets, complete = [], {}, True
    for item in rows:
        if not is_count(item.get("disclosedBytes")):
            complete = False
        elif isinstance(item.get("packetSha256"), str):
            packets.setdefault(item["packetSha256"], item["disclosedBytes"])
        kind = item.get("destinationKind")
        if kind == "cloud_model" or (kind is None and item.get("destinationId") == "cloud_coordinator"):
            purpose, status = item.get("purpose"), item.get("status")
            # Kept with its commit time for the row's commit order. Only the store's settle records a fee, so a call that did not
            # settle has none (BL-20261114-1507, decisions (3) and (4)).
            cloud.append((safe_integer(item.get("committedAt")), {
                "purpose": purpose if isinstance(purpose, str) and HOST_TOKEN.fullmatch(purpose) else "other",
                "status": status if status in DISPATCH_STATUSES else "other",
                "feeUsd": item["feeMicrousd"] / 1_000_000 if is_count(item.get("feeMicrousd")) else None,
                "reservedUsd": count(item.get("reservedFeeMicrousd")) / 1_000_000,
                "bodyBytes": item["bodyBytes"] if is_count(item.get("bodyBytes")) else None}))
    named = {event.get("operationId"): event.get("name") for event in events if event.get("type") == "tool_started" and isinstance(event.get("operationId"), str)}
    tools = {}
    for event in events:
        if event.get("type") == "tool_finished":
            name = named.get(event.get("operationId"))
            name = name if name in RUNNER_TOOLS else "other"
            tools[name] = tools.get(name, 0) + 1
    retained = [event for event in events if event.get("type") == "public_source_retained"]
    stages = [event for event in events if event.get("type") == "research_stage"]

    def last(stage: str):
        return next((event for event in reversed(stages) if event.get("stage") == stage), None)
    index, plan, synthesis = last("index"), last("plan"), last("synthesise")
    return {
        "reserved": sum(count(item.get("reservedFeeMicrousd")) for item in rows),
        # store.ts's exposure: a row still committed or unknown pins its reservation.
        "pinned": sum(count(item.get("reservedFeeMicrousd")) for item in rows if item.get("status") in ("committed", "unknown")),
        "committed": sum(1 for item in rows if item.get("status") == "committed"),
        "cloud": cloud, "packets": packets, "complete": complete,
        "urls": {source_key(event["url"]) for event in retained if isinstance(event.get("url"), str)},
        "retainedBytes": sum(count(event.get("bytes")) for event in retained),
        "tools": tools, "fetchReceipts": len(retained),
        # "Read" on a closed corpus (HARN-27): the sources the reading stage indexed, and null unless it recorded the count, which a
        # denied index stage does not (BL-20261114-1507, decision (3)); item 12 revises it.
        "sourcesRead": index["sourcesIndexed"] if index is not None and is_count(index.get("sourcesIndexed")) else None,
        "fallback": {"plan": "host_plan" if (plan or {}).get("fallback") == "host_plan" else "none",
                     "synthesis": "skeleton" if (synthesis or {}).get("fallback") == "skeleton" else "none"} if stages else None,
    }


def depth_columns(parts: list, fallback) -> dict:
    """Plan 11.4's columns from one or several runs' parts: amounts and counts summed, cloud calls in commit order, URLs and
    hostnames counted over the union; `domains` drops a leading www. and loopback hosts, and is approximate (hostnames, not
    registrable domains)."""
    packets, urls, tools = {}, set(), {}
    for part in parts:
        for packet, disclosed in part["packets"].items():
            packets.setdefault(packet, disclosed)
        urls |= part["urls"]
        for name, value in part["tools"].items():
            tools[name] = tools.get(name, 0) + value
    hosts = set()
    for url in urls:
        try:
            host = urllib.parse.urlsplit(url).hostname
        except ValueError:
            host = None
        if host and host not in LOOPBACK_HOSTS:
            hosts.add(host[4:] if host.startswith("www.") else host)
    reads = [part["sourcesRead"] for part in parts if part["sourcesRead"] is not None]
    return {
        "reservedUsd": sum(part["reserved"] for part in parts) / 1_000_000,
        "pinnedUsd": sum(part["pinned"] for part in parts) / 1_000_000,
        "committedDispatches": sum(part["committed"] for part in parts),
        # BL-20261114-1507, decision (4): commit order across the runs; a call without a commit time keeps the scan's order, after the others.
        "cloudCalls": [call for _, call in sorted((entry for part in parts for entry in part["cloud"]), key=lambda entry: (entry[0] is None, entry[0] or 0))],
        "disclosedBytes": sum(packets.values()) if all(part["complete"] for part in parts) else None,
        "urls": len(urls), "domains": len(hosts),
        "retainedBytes": sum(part["retainedBytes"] for part in parts),
        "actions": {"tools": dict(sorted(tools.items())), "fetchReceipts": sum(part["fetchReceipts"] for part in parts),
                    "sourcesRead": sum(reads) if reads else None},
        "queries": None,
        "researchFallback": fallback,
    }


def launcher_signalled(path: str, run_dir: str) -> bool:
    """Plan 11.4, decision (4) (HARN-12): whether the launcher forwarded a signal to this run, from the one run_exited record its
    ledger holds for the run's job id. The ledger is only read, and nothing from it but that flag reaches the row."""
    job = (read_freeze(run_dir) or {}).get("jobId")
    if not isinstance(job, str) or not JOB_ID.fullmatch(job):
        sys.exit("the run has no job id to find in the launcher ledger")
    if os.path.islink(path) or not os.path.isfile(path):
        sys.exit("the launcher ledger cannot be read")
    try:
        with open(path, "rb") as handle:
            events = [json.loads(line) for line in handle.read().decode("utf-8").split("\n") if line]
    except (OSError, UnicodeDecodeError, ValueError):
        sys.exit("the launcher ledger cannot be read")
    exits = [event for event in events if isinstance(event, dict) and event.get("event") == "run_exited" and event.get("jobId") == job]
    if len(exits) != 1:
        sys.exit("the launcher ledger holds no single exit for this run")
    return exits[0].get("signalled") is True


def run_ledger(run_dir: str) -> dict:
    """A run directory with or without a result, as selection.ts readRunLedger reads it: its freeze (job, sha256, runtime, start, fee
    cap, local arm) or None, its dispatch rows and claims, its counts, the latest commit time of its rows, and its result's end."""
    events, dispatches, claims = ledger_rows(run_dir)
    freeze = None
    raw = read_freeze(run_dir)
    if frozen(raw):
        with open(os.path.join(run_dir, "freeze.json"), "rb") as handle:
            digest = hashlib.sha256(handle.read()).hexdigest()
        limits = raw.get("limits") if isinstance(raw.get("limits"), dict) else {}
        fee_cap = limits.get("feeMicrousd")
        freeze = {"jobId": raw["jobId"], "sha256": digest, "runtimeSha256": raw.get("sourceFreezeSha256") if isinstance(raw.get("sourceFreezeSha256"), str) else None,
                  "startedAt": raw.get("startedAt") if isinstance(raw.get("startedAt"), str) else None,
                  "feeCapMicrousd": fee_cap if isinstance(fee_cap, (int, float)) and not isinstance(fee_cap, bool) and math.isfinite(fee_cap) else None,
                  "localArm": isinstance(raw.get("arm"), dict) and raw["arm"].get("arm") == "local"}
    commits = [value for value in (safe_integer(item.get("committedAt")) for item in dispatches) if value is not None]
    result = read_object(run_dir, "result.json")
    return {"freeze": freeze, "dispatches": dispatches, "claims": claims, "counts": counts_of(events, dispatches), "lastCommittedAt": max(commits) if commits else None,
            "finishedAt": result["finishedAt"] if result is not None and isinstance(result.get("finishedAt"), str) else None}


def check_outcome(outcome, run_status, run_class) -> None:
    """An unsubmitted run that ended on infrastructure is `infra_invalid`, never `rejected` or `incomplete` (`accepted` stays allowed: a
    grader may accept a complete deliverable); a run that did not end on infrastructure is never `infra_invalid`."""
    if not isinstance(run_class, dict) or outcome is None:
        return
    cause = run_class.get("cause") if isinstance(run_class.get("cause"), str) and IDENTIFIER.fullmatch(run_class["cause"]) else "unknown"
    if run_class.get("infra") is True and run_status != "submitted" and outcome in ("rejected", "incomplete"):
        sys.exit(f"the run ended on infrastructure ({cause}): record --outcome infra_invalid, not {outcome}")
    if run_class.get("infra") is not True and outcome == "infra_invalid":
        sys.exit(f"the run did not end on infrastructure ({cause}): --outcome infra_invalid is refused")


def utc_iso(value, flag: str) -> str:
    """A UTC ISO 8601 instant in the `...Z` form; None means now. Anything without a UTC offset is refused."""
    if value is None:
        return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    try:
        parsed = datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        sys.exit(f"{flag} must be UTC ISO 8601, for example 2026-11-07T08:30:00Z")
    if parsed.tzinfo is None or parsed.utcoffset() != datetime.timedelta(0):
        sys.exit(f"{flag} must carry the UTC offset (Z or +00:00)")
    return parsed.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_registry(path: str) -> list:
    try:
        with open(path, encoding="utf-8") as handle:
            lines = [line for line in handle.read().split("\n") if line.strip()]
    except OSError as error:
        sys.exit(f"cannot read the registry: {error.strerror}")
    rows = []
    for number, line in enumerate(lines, 1):
        try:
            row = json.loads(line)
        except ValueError:
            sys.exit(f"registry line {number} is not JSON")
        if not isinstance(row, dict):
            sys.exit(f"registry line {number} is not a row")
        rows.append(row)
    return rows


def superseding_row(args) -> dict:
    """A copy of the row with the superseded id; the caller then sets only the verdict fields (and git, gitSource and gitDirty, see row_provenance)."""
    rows = load_registry(args.registry)
    matches = [row for row in rows if row.get("id") == args.supersedes]
    if not matches:
        sys.exit(f"no registry row has id {args.supersedes!r}")
    if len(matches) > 1:
        sys.exit(f"{len(matches)} registry rows carry id {args.supersedes!r}; the registry needs a correction first")
    already = [row.get("id") for row in rows if row.get("supersedes") == args.supersedes]
    if already:
        sys.exit(f"row {args.supersedes!r} is already superseded by {already[0]!r}; supersede that row instead")
    if any(row.get("id") == args.id for row in rows):
        sys.exit(f"a registry row with id {args.id!r} already exists")
    row = copy.deepcopy(matches[0])
    row["supersedes"] = args.supersedes
    return row


def fail_receipt(message: str) -> None:
    sys.exit(f"invalid verdict receipt: {message}")


def is_count(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def is_amount(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def load_receipt(path: str) -> dict:
    """The desktop verdict receipt, checked key by key: exactly the documented keys, enum-like identifiers, counts, and the verdict."""
    try:
        with open(path, encoding="utf-8") as handle:
            receipt = json.load(handle)
    except OSError as error:
        sys.exit(f"cannot read the receipt: {error.strerror}")
    except ValueError:
        fail_receipt("not JSON")
    if not isinstance(receipt, dict):
        fail_receipt("not an object")
    unknown = sorted(set(receipt) - RECEIPT_KEYS)
    if unknown:
        fail_receipt(f"unknown key {unknown[0]!r}; a receipt holds hashes, counts and the verdict only")
    missing = sorted(RECEIPT_KEYS - set(receipt))
    if missing:
        fail_receipt(f"missing key {missing[0]!r}")
    if receipt["version"] != 1:
        fail_receipt("version is not 1")
    if not isinstance(receipt["taskId"], str) or not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", receipt["taskId"]):
        fail_receipt("taskId is not a UUID")
    if not isinstance(receipt["taskJobSha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", receipt["taskJobSha256"]):
        fail_receipt("taskJobSha256 is not a SHA-256 hex digest")
    if not isinstance(receipt["date"], str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", receipt["date"]):
        fail_receipt("date is not a UTC date")
    for key in ("profile", "thinking", "runStatus", "terminalCause"):
        if not isinstance(receipt[key], str) or not IDENTIFIER.fullmatch(receipt[key]):
            fail_receipt(f"{key} is not an identifier")
    if not isinstance(receipt["arm"], str) or not re.fullmatch(r"local-(standard|heavy)(-consulted)?", receipt["arm"]):
        fail_receipt("arm is not local-<profile> or local-<profile>-consulted")
    for key in RECEIPT_COUNTS:
        if not is_count(receipt[key]):
            fail_receipt(f"{key} is not a count")
    for key in ("wallSeconds", "usd"):
        if not is_amount(receipt[key]):
            fail_receipt(f"{key} is not a non-negative number")
    if receipt["cloudModel"] is not None or receipt["cloudApi"] is not None:
        fail_receipt("a desktop task has no cloud model")
    entailment = receipt["entailment"]
    if entailment is not None:
        if not isinstance(entailment, dict) or set(entailment) != RECEIPT_ENTAILMENT_KEYS:
            fail_receipt("entailment carries other keys than counts, entailmentCalls, truncated and supportRate")
        if not isinstance(entailment["counts"], dict) or set(entailment["counts"]) != RECEIPT_COUNT_KEYS or not all(is_count(value) for value in entailment["counts"].values()):
            fail_receipt("entailment counts are not the five verdict counts")
        if not is_count(entailment["entailmentCalls"]) or not isinstance(entailment["truncated"], bool):
            fail_receipt("entailment calls or truncation are not counts")
        if entailment["supportRate"] is not None and not is_amount(entailment["supportRate"]):
            fail_receipt("supportRate is not a rate or null")
    verdict = receipt["verdict"]
    if not isinstance(verdict, dict) or set(verdict) != RECEIPT_VERDICT_KEYS:
        fail_receipt("verdict is missing or carries other keys than decision, ownerMinutes, interventions, exportedThroughApp and recordedAt")
    if verdict["decision"] not in ("accept", "reject"):
        fail_receipt("verdict decision is not accept or reject")
    if not is_amount(verdict["ownerMinutes"]):
        fail_receipt("verdict ownerMinutes is not a finite number of minutes")
    if not is_count(verdict["interventions"]):
        fail_receipt("verdict interventions is not a count")
    if not isinstance(verdict["exportedThroughApp"], bool):
        fail_receipt("verdict exportedThroughApp is not a boolean")
    if not isinstance(verdict["recordedAt"], str):
        fail_receipt("verdict recordedAt is not a UTC instant")
    verdict["recordedAt"] = utc_iso(verdict["recordedAt"], "the receipt's recordedAt")
    return receipt


def receipt_row(args) -> dict:
    """The registry row of a desktop task from its verdict receipt; the operator's flags may repeat the receipt's values but never contradict them."""
    receipt = load_receipt(args.verdict_file)
    if args.verdict_by != "owner":
        sys.exit("a desktop verdict receipt rows the owner's verdict: give --verdict-by owner")
    verdict = receipt["verdict"]
    derived = {"outcome": "accepted" if verdict["decision"] == "accept" else "rejected", "ownerMinutes": verdict["ownerMinutes"],
               "interventions": verdict["interventions"], "verdictAt": verdict["recordedAt"], "arm": receipt["arm"]}
    given = {"outcome": args.outcome, "ownerMinutes": args.owner_minutes, "interventions": args.interventions,
             "verdictAt": utc_iso(args.verdict_at, "--verdict-at") if args.verdict_at is not None else None, "arm": args.arm}
    for key, value in given.items():
        if value is not None and value != derived[key]:
            sys.exit(f"the receipt records {key} {derived[key]!r}; omit the flag or repeat that value")
    row = {key: receipt[key] for key in RECEIPT_KEYS if key not in ("version", "taskId", "verdict")}
    row.update(derived)
    row["exportedThroughApp"] = verdict["exportedThroughApp"]
    # Backlog item 7(d), part C: receipt version 1 carries no host flags, so they are not recorded on this row.
    row["hostFlags"] = None
    return row


def cloud_fields(freeze: dict) -> dict:
    """The cloud model and request shape a run's cloud arm was frozen with (BL-20261030-0620); null on local runs or when absent."""
    arm = freeze.get("arm")
    config = arm.get("modelConfig") if isinstance(arm, dict) and arm.get("arm") == "cloud" else None
    config = config if isinstance(config, dict) else {}
    return {"cloudModel": config.get("model"), "cloudApi": config.get("api")}


# Read-only git as scripts/verify-release-head.ts runs it (backlog item 11, part 2): no user or system configuration, pager,
# prompts or optional locks, no hook or file-system monitor, and no repository found above this one.
GIT_ENVIRONMENT = {"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C", "TZ": "UTC", "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull,
                   "GIT_CONFIG_NOSYSTEM": "1", "GIT_NO_LAZY_FETCH": "1", "GIT_NO_REPLACE_OBJECTS": "1", "GIT_OPTIONAL_LOCKS": "0", "GIT_PAGER": "cat",
                   "GIT_PROTOCOL_FROM_USER": "0", "GIT_TERMINAL_PROMPT": "0", "GIT_CEILING_DIRECTORIES": os.path.dirname(REPOSITORY_ROOT)}
GIT_OBJECT_NAME = re.compile(r"^[0-9a-f]{40}(?:[0-9a-f]{24})?$")


def writing_commit() -> str:
    """The commit this row is written at, in the registry's 12-hex form; the writer refuses to emit a row without one."""
    try:
        result = subprocess.run(["/usr/bin/git", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "rev-parse", "--verify", "HEAD^{commit}"],
                                cwd=REPOSITORY_ROOT, env=GIT_ENVIRONMENT, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        result = None
    commit = result.stdout.strip() if result is not None and result.returncode == 0 else ""
    if not GIT_OBJECT_NAME.fullmatch(commit):
        sys.exit("cannot read the commit this row is written at: /usr/bin/git could not read HEAD of the repository this script is in")
    return commit[:12]


def freeze_git(run_dir: str):
    """A run's own {commit, dirty} from its freeze.json (scripts/private-agent-local-screen.ts localScreenGitState), or None
    when the freeze is absent or records no valid one: a malformed value is never guessed at, and a truncated or non-object freeze
    counts as no record (part 3b, BL-20261110-0723 (f)) instead of stopping the row."""
    freeze = read_freeze(run_dir)
    if freeze is None:
        return None
    git = freeze.get("git")
    if isinstance(git, dict) and set(git) == {"commit", "dirty"} and isinstance(git["commit"], str) and GIT_OBJECT_NAME.fullmatch(git["commit"]) \
            and isinstance(git["dirty"], bool):
        return git
    return None


def written_provenance() -> dict:
    return {"git": writing_commit(), "gitSource": "row_written", "gitDirty": None}


def run_provenance(selected_dir: str, stage_dirs: list) -> dict:
    """A run or loop row's git from the selected run's freeze. gitSource is `run` only when every stage freeze records that same
    commit (a stage without a valid record counts as differing); gitDirty is true if any stage was dirty, null if any stage's
    state is unknown, else false. Without the selected run's record, the writing commit, labelled."""
    selected = freeze_git(selected_dir)
    if selected is None:
        return written_provenance()
    stages = [freeze_git(directory) for directory in stage_dirs]
    same = all(stage is not None and stage["commit"] == selected["commit"] for stage in stages)
    if any(stage is not None and stage["dirty"] for stage in stages + [selected]):
        dirty = True
    else:
        dirty = None if any(stage is None for stage in stages) else False
    return {"git": selected["commit"][:12], "gitSource": "run" if same else "runs_differ", "gitDirty": dirty}


def row_provenance(args, row: dict) -> dict:
    """git, gitSource and gitDirty for the row being written. A superseding row repeats a run's measurements, so it keeps that
    run's provenance when the copied row recorded it (proposed default for item 2's open question); otherwise every mode
    without a run's freeze records the writing commit."""
    if args.run_dir is not None:
        return run_provenance(args.run_dir, [args.run_dir])
    if args.loop_dir is not None:
        loop = json.load(open(os.path.join(args.loop_dir, "loop.json"), encoding="utf-8"))
        # Every run of the loop that holds a freeze (part 3b's shared scan): a, b and the repair, and every run moved aside; a critique
        # or a void start holds none. The row's own run is the selected one, or the stage a loop stopped at.
        stages = [entry["path"] for entry in loop_scan(args.loop_dir) if entry["freeze"] and not entry["critique"] and entry["kind"] != "void"]
        own = loop_row_run(args.loop_dir, loop)
        return run_provenance(own, stages) if own is not None else written_provenance()
    if args.supersedes is not None and isinstance(row.get("git"), str) and re.fullmatch(r"[0-9a-f]{12}", row["git"]) and (
            (row.get("gitSource") == "run" and isinstance(row.get("gitDirty"), bool))
            or (row.get("gitSource") == "runs_differ" and (row.get("gitDirty") is None or isinstance(row.get("gitDirty"), bool)))):
        return {"git": row["git"], "gitSource": row["gitSource"], "gitDirty": row.get("gitDirty")}
    return written_provenance()



# Backlog item 11, part 3b (BL-20261113-0836-infra-resume-design, decisions (9) and (10)): a loop row of version 1 or 2.
LOOP_STAGES = ("a", "b", "critique", "repair")
LOOP_RUN_STAGES = ("a", "b", "repair")
LOOP_FAILURE = re.compile(r"^[a-z0-9_]{1,80}$")
SHA256_HEX = re.compile(r"^[0-9a-f]{64}$")
_LOOP_LOCK = []


def hold_loop_lock(loop_dir: str) -> None:
    """A version-2 loop holds an exclusive SQLite transaction on loop.lock while it runs. The writer takes the same lock without
    waiting and holds it until it exits, so no loop runs while its row is read; a directory without the file holds no lock to take."""
    path = os.path.join(loop_dir, "loop.lock")
    if not os.path.lexists(path):
        return
    try:
        if os.path.islink(path):
            raise sqlite3.OperationalError("symbolic link")
        # A file URI of the absolute path, percent-encoded, so a space, `?`, `#` or `%` in the loop directory's path is read as part of it.
        connection = sqlite3.connect(pathlib.Path(path).absolute().as_uri() + "?mode=rw", uri=True, timeout=0, isolation_level=None)
        connection.execute("BEGIN EXCLUSIVE")
    except sqlite3.Error:
        sys.exit("the loop is running, or its lock cannot be read: write its row once the loop has stopped")
    _LOOP_LOCK.append(connection)


def loop_scan(loop_dir: str) -> list:
    """Every subdirectory of a loop directory, typed (shared by the sums and the row's provenance): a stage, a stage a resume moved
    aside (`<stage>.infra-1`), a void start (`<stage>.void-<n>`) or another directory, with whether it holds a freeze, a result and a
    critique record. A symbolic link refuses the row."""
    entries = []
    for name in sorted(os.listdir(loop_dir)):
        path = os.path.join(loop_dir, name)
        if os.path.islink(path):
            sys.exit(f"the loop directory holds a symbolic link ({name}): the row is refused")
        if not os.path.isdir(path):
            continue
        match = re.fullmatch(r"(a|b|critique|repair)(?:\.(infra)-1|\.(void)-([1-9][0-9]{0,5}))?", name)
        kind = "other" if match is None else "moved" if match.group(2) else "void" if match.group(3) else "stage"
        stage = match.group(1) if match else None

        def has(file: str) -> bool:
            return os.path.isfile(os.path.join(path, file))
        entries.append({"name": name, "path": path, "kind": kind, "stage": stage, "critique": stage == "critique" or has("critique.json") or has("critique-failure.json"),
                        "freeze": has("freeze.json"), "result": has("result.json")})
    return entries


def loop_moves(loop: dict):
    """A version-2 record's resume and void entries, each from the fixed lists, at most one resume per stage; anything else refuses."""
    resumes, voids = loop.get("resumes"), loop.get("voids")
    if not isinstance(resumes, list) or not isinstance(voids, list):
        sys.exit("the version-2 loop record has no resumes or voids")
    stages = set()
    for entry in resumes:
        if not (isinstance(entry, dict) and entry.get("stage") in LOOP_STAGES and entry.get("as") in ("rerun", "seeded_writer") and isinstance(entry.get("cause"), str)
                and IDENTIFIER.fullmatch(entry["cause"]) and entry["stage"] not in stages):
            sys.exit("the loop record holds a malformed resume entry")
        stages.add(entry["stage"])
    for entry in voids:
        if not (isinstance(entry, dict) and entry.get("stage") in LOOP_STAGES and isinstance(entry.get("n"), int) and not isinstance(entry["n"], bool) and entry["n"] >= 1):
            sys.exit("the loop record holds a malformed void entry")
    return resumes, voids


def loop_closed(loop: dict) -> bool:
    """Whether the operator closed a version-2 loop (`--close`): at a stop, or after stage 1 with a final selection."""
    return loop.get("closed") is True or (isinstance(loop.get("stopped"), dict) and loop["stopped"].get("closed") is True)


def own_runs(loop: dict, entries: list) -> list:
    """The loop's runs once per job, each of the loop's own task and runtime (a run of another refuses the row). A stage's own
    directory is kept before a copy of the same job elsewhere in the loop directory, then a moved run, then any other directory."""
    task = loop.get("task") if isinstance(loop.get("task"), dict) else None
    runtime = loop.get("runtimeSha256") if isinstance(loop.get("runtimeSha256"), str) else None
    order = {"stage": 0, "moved": 1, "void": 2, "other": 3}
    runs, jobs = [], set()
    for entry in sorted(entries, key=lambda item: (order[item["kind"]], item["name"])):
        freeze = read_freeze(entry["path"])
        job = freeze["jobId"] if frozen(freeze) else None
        if job is not None and job in jobs:
            continue
        binding = freeze.get("taskBinding") if freeze is not None and isinstance(freeze.get("taskBinding"), dict) else {}
        if task is not None and freeze is not None and binding.get("jobSha256") != task.get("jobSha256"):
            sys.exit(f"the loop directory holds a run of another task ({entry['name']})")
        if runtime is not None and freeze is not None and freeze.get("sourceFreezeSha256") != runtime:
            sys.exit(f"the loop directory holds a run of another runtime ({entry['name']})")
        if job is not None:
            jobs.add(job)
        runs.append(entry)
    return sorted(runs, key=lambda item: item["name"])


def loop_runs(loop_dir: str, loop: dict, entries: list, resumes: list, voids: list) -> list:
    """The loop's run directories to sum, once per job and each of the loop's own task and runtime (own_runs). A version-2 loop's
    subdirectories must be its begun stages and the directories its entries moved aside (a closed loop's are all summed, matched or
    not); a version-1 loop's are every run directory, including stages an operator moved aside by hand under part 1."""
    if loop.get("version") == 2:
        if not loop_closed(loop):
            begun = {entry.get("stage") for entry in loop.get("begun") or [] if isinstance(entry, dict)}
            named = {f"{entry['stage']}.infra-1" for entry in resumes} | {f"{entry['stage']}.void-{entry['n']}" for entry in voids}
            for entry in entries:
                if not ((entry["kind"] == "stage" and entry["name"] in begun) or entry["name"] in named):
                    sys.exit(f"the loop directory holds {entry['name']}, which its record does not name: resume the loop to reconcile it, or close it")
            missing = named - {entry["name"] for entry in entries}
            if missing:
                sys.exit("a directory the loop moved aside is missing: " + ", ".join(sorted(missing)))
        return own_runs(loop, [entry for entry in entries if not entry["critique"] and entry["kind"] != "void"
                               and (entry["freeze"] or entry["result"] or os.path.isfile(os.path.join(entry["path"], "state.sqlite")))])
    runs = own_runs(loop, [entry for entry in entries if not entry["critique"] and (entry["freeze"] or entry["result"])])
    # Part 1 had the operator move a stage aside by hand. A finished run the log records but the directory lacks was moved out of it,
    # and its spend would be hidden: the row is refused until it is moved back (finding F1 of the review of pull request #67).
    log = os.path.join(loop_dir, "log.txt")
    if os.path.isfile(log):
        with open(log, encoding="utf-8") as handle:
            ends = sum(1 for line in handle if re.fullmatch(r"\S+ (?:a|b|repair) end", line.rstrip("\n")))
        finished = sum(1 for entry in runs if entry["result"])
        if ends > finished:
            sys.exit(f"log.txt records {ends} finished runs but the loop directory holds {finished}: move the missing stage back into the loop directory to row its spend")
    return runs


def parse_time(value):
    """A UTC ISO 8601 time as an aware datetime, or None when it is not one."""
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def run_totals(run_dir: str) -> dict:
    """One run's counts with or without a result (its result's rows, else its ledger's), and its start and end where it recorded them."""
    events, ledger_dispatches, _ = ledger_rows(run_dir)
    freeze = read_freeze(run_dir)
    # A result that cannot be read is a run that did not finish: its ledger's rows are its spend (part 3b).
    result = read_object(run_dir, "result.json")
    dispatches = [item for item in (result.get("dispatches") if isinstance(result.get("dispatches"), list) else []) if isinstance(item, dict)] if result is not None else ledger_dispatches
    return {"counts": counts_of(events, dispatches), "depth": depth_parts(events, dispatches), "started": parse_time((freeze or {}).get("startedAt")),
            "ended": parse_time(result.get("finishedAt")) if result is not None else None}


def critique_totals(critique_dir: str):
    """The critique's one call from the tool's own record, as (counts, critiqued): critique.json for a critique that answered, and
    critique-failure.json for one that reached the model and was refused; a refusal before the model counts nothing."""
    counts = {key: 0 for key in SUMMED}
    for name in ("critique.json", "critique-failure.json"):
        if not os.path.lexists(os.path.join(critique_dir, name)):
            continue
        # A record that cannot be read counts nothing (phase4-loop.ts critiqueCounts); a field that is not a count counts 0.
        record = read_object(critique_dir, name)
        if record is None:
            return counts, False
        usage = record.get("usage") if isinstance(record.get("usage"), dict) else {}
        if name == "critique-failure.json" and not usage:
            return counts, False
        counts["modelCalls"] = 1
        counts["usd"] = count(record.get("feeMicrousd")) / 1_000_000
        for key, field in (("inputTokens", "inputTokens"), ("outputTokens", "outputTokens"), ("cachedTokens", "cacheReadTokens"), ("cacheWriteTokens", "cacheWriteTokens")):
            counts[key] = count(usage.get(field))
        counts["lengthStops"] = 1 if record.get("finishReason") == "length" else 0
        return counts, name == "critique.json"
    return counts, False


def stage_run(loop_dir: str, loop: dict) -> str:
    """The run whose freeze holds a loop's cloud stage: `a.infra-1` after a seeded-writer resume of sample a, else `a` (part 3b).
    Part 11.4 and the assist receipt fields (RA) are to read a loop's cloud evidence through it, never from `a/` directly."""
    resumes = loop.get("resumes") if loop.get("version") == 2 and isinstance(loop.get("resumes"), list) else []
    if any(isinstance(entry, dict) and entry.get("stage") == "a" and entry.get("as") == "seeded_writer" for entry in resumes):
        return os.path.join(loop_dir, "a.infra-1")
    return os.path.join(loop_dir, "a")


def loop_row_run(loop_dir: str, loop: dict):
    """The run whose fields a loop row carries: the selected run, or the run of the stage a loop stopped at; None without one."""
    final = (loop.get("selected") or {}).get("final")
    if isinstance(final, dict) and final.get("candidate") in LOOP_RUN_STAGES:
        return os.path.join(loop_dir, final["candidate"])
    stopped = loop.get("stopped") if loop.get("version") == 2 else None
    if isinstance(stopped, dict) and stopped.get("stage") in LOOP_RUN_STAGES and os.path.isfile(os.path.join(loop_dir, stopped["stage"], "freeze.json")):
        return os.path.join(loop_dir, stopped["stage"])
    return None


def active_seconds(loop_dir: str, loop: dict):
    """Part 3b: the time a version-2 loop's stages ran, so the wait between its invocations is left out: the spans the loop recorded
    (`stages`, and each resume entry's span), and a begun stage whose process died before the loop recorded its end, from its begun time
    to its last dispatch commit. None for a version-1 loop."""
    if loop.get("version") != 2:
        return None
    total, recorded = 0.0, set()
    spans = [(entry.get("startedAt"), entry.get("finishedAt")) for entry in loop.get("stages") or [] if isinstance(entry, dict)]
    recorded = {entry.get("stage") for entry in loop.get("stages") or [] if isinstance(entry, dict)}
    spans += [((entry.get("span") or {}).get("startedAt"), (entry.get("span") or {}).get("endedAt")) for entry in loop.get("resumes") or [] if isinstance(entry, dict)]
    for start, end in spans:
        started, ended = parse_time(start), parse_time(end)
        if started is None or ended is None:
            sys.exit("the loop record holds a stage time that is not a UTC ISO 8601 time")
        total += max(0.0, (ended - started).total_seconds())
    for entry in loop.get("begun") or []:
        stage = entry.get("stage") if isinstance(entry, dict) else None
        path = os.path.join(loop_dir, stage) if stage in LOOP_STAGES else None
        if stage in recorded or path is None or not os.path.isdir(path):
            continue
        started, last = parse_time(entry.get("at")), run_ledger(path)["lastCommittedAt"]
        if started is not None and last is not None:
            total += max(0.0, last / 1000 - started.timestamp())
    return round(total, 1)


def freeze_fields(freeze: dict, result=None, events=(), run_dir: str = "") -> dict:
    """A stopped stage's row fields, read defensively (part 3b): from its freeze, the date it started, its task, profile, model
    settings, cloud model and pipeline; from its readable result (read_result), its status and cause; from its events, its entailment,
    as run_counts reads them. A field none of them holds is None, so a damaged directory never stops the row with a traceback."""
    def text(value):
        return value if isinstance(value, str) else None
    binding = freeze.get("taskBinding") if isinstance(freeze.get("taskBinding"), dict) else {}
    config = freeze.get("modelConfig") if isinstance(freeze.get("modelConfig"), dict) else {}
    pipeline = freeze.get("pipeline") if isinstance(freeze.get("pipeline"), dict) else {}
    started = parse_time(freeze.get("startedAt"))
    tokens = config.get("maxOutputTokens")
    entailment = next(({"counts": event.get("counts"), "entailmentCalls": event.get("entailmentCalls"), "truncated": event.get("truncated"),
                        "supportRate": support_rate(event.get("counts"))} for event in reversed(list(events)) if isinstance(event, dict) and event.get("type") == "claims_entailment"), None)
    return {"date": started.date().isoformat() if started else None, "taskJobSha256": text(binding.get("jobSha256")), "profile": text(freeze.get("profile")) or "standard",
            "maxOutputTokens": tokens if isinstance(tokens, int) and not isinstance(tokens, bool) and tokens >= 0 else None,
            "thinking": config.get("thinking") if isinstance(config.get("thinking"), (bool, str)) else None, **cloud_fields(freeze),
            "pipeline": text(pipeline.get("name")), "pipelinePlanner": text(pipeline.get("planner")),
            "runStatus": text(result.get("status")) if result is not None else None, "terminalCause": text(result.get("reason")) if result is not None else None,
            "entailment": entailment if result is not None else None, "hostFlags": host_flags(events, run_dir) if result is not None else None}


def refuse_unselected_accept(outcome, loop) -> None:
    """A loop that ended without a selection selected nothing to accept (part 3b, decision (10)); part 3a's `accepted` rule concerns a
    loop's selected run."""
    if outcome == "accepted" and isinstance(loop, dict) and loop.get("selected") is None:
        sys.exit("the loop selected nothing: --outcome accepted is refused for a loop that ended without a selection")


def loop_row(args) -> dict:
    """An H4 loop's row (scripts/phase4-loop.ts), version 1 or 2: the selected run's fields, or a stopped loop's (part 3b), every run's
    counts and the loop's span; the loop's own record of its choice, its moves and its stop."""
    loop_dir = args.loop_dir
    hold_loop_lock(loop_dir)
    with open(os.path.join(loop_dir, "loop.json"), encoding="utf-8") as handle:
        loop = json.load(handle)
    version = loop.get("version")
    if isinstance(version, bool) or version not in (1, 2):
        sys.exit("the loop record's version is neither 1 nor 2")
    # A stopped version-2 row takes its task from the record; a version-1 record's task, when it holds one, binds its runs (own_runs).
    task = loop.get("task")
    if (version == 2 or task is not None) and not (isinstance(task, dict) and isinstance(task.get("jobSha256"), str) and SHA256_HEX.fullmatch(task["jobSha256"])):
        sys.exit("the loop record's task is malformed")
    if loop.get("pipeline") not in ("research", None):
        sys.exit("the loop record's pipeline is neither research nor null")
    if version == 2:
        begun = loop.get("begun")
        if not isinstance(begun, list) or not all(isinstance(entry, dict) and entry.get("stage") in LOOP_STAGES and isinstance(entry.get("at"), str) for entry in begun):
            sys.exit("the loop record holds a malformed begun entry")
        if loop.get("closed", True) is not True:
            sys.exit("the loop record's closed mark is malformed")
    final = (loop.get("selected") or {}).get("final")
    stopped = loop.get("stopped") if version == 2 else None
    if final and stopped:
        sys.exit("the loop record holds both a final selection and a stop")
    if not final and not stopped:
        # Version 1 has no --close: a version-1 loop without a selection is resumed (part 1's protocol).
        sys.exit("the loop has no final selection: resume it, or close it with scripts/phase4-loop.ts --close" if version == 2 else "the loop has no final selection: resume it")
    entries = loop_scan(loop_dir)
    resumes, voids = loop_moves(loop) if version == 2 else ([], [])
    runs = loop_runs(loop_dir, loop, entries, resumes, voids)
    summed = {key: 0 for key in SUMMED}
    parts = []
    started, ended = parse_time(loop.get("startedAt")), parse_time(loop.get("finishedAt"))
    for entry in runs:
        totals = run_totals(entry["path"])
        parts.append(totals["depth"])
        for key in SUMMED:
            summed[key] += totals["counts"][key]
        started = min([value for value in (started, totals["started"]) if value is not None], default=None)
        ended = max([value for value in (ended, totals["ended"]) if value is not None], default=None)
    critiqued = False
    for entry in entries:
        if entry["critique"]:
            counts, answered = critique_totals(entry["path"])
            for key in SUMMED:
                summed[key] += counts[key]
            critiqued = critiqued or (answered and entry["name"] == "critique")
            events, dispatches, _ = ledger_rows(entry["path"])
            parts.append(depth_parts(events, dispatches))
    stages = loop.get("stages") if isinstance(loop.get("stages"), list) else []

    def marked(stage) -> bool:
        return any(isinstance(entry, dict) and entry.get("stage") == stage and entry.get("interrupted") is True for entry in stages)
    critique = loop.get("critique") or {}
    named = [name for name in LOOP_RUN_STAGES if (loop.get("candidates") or {}).get(name)]
    # Every sample's own ending stays in the record, with its own class: the plan's harness-terminal rate is computed per sample.
    candidates = {}
    for name in named:
        summary = loop["candidates"][name]
        candidates[name] = {"status": summary.get("status"), "terminalCause": summary.get("reason")}
        if read_result(os.path.join(loop_dir, name)) is not None:
            candidates[name]["runClass"] = classify_run_end(run_end_evidence(os.path.join(loop_dir, name), marked(name)))
    extra = {"wallSeconds": round((ended - started).total_seconds(), 1) if started and ended else None,
             "loop": {"version": version, "rule": loop["selectionRule"], "samples": len([name for name in named if name != "repair"]), "repaired": "repair" in named,
                      "seeded": loop.get("seeded"), "selected": final["candidate"] if final else None, "step": final["step"] if final else None,
                      "stage1": (loop["selected"].get("stage1") or {}).get("candidate") if loop.get("selected") else None,
                      "critiqued": critiqued, "candidates": candidates,
                      # A recorded failure is a code, never a message (a message may carry a host path).
                      "critiqueFailure": critique["failure"] if isinstance(critique, dict) and isinstance(critique.get("failure"), str) and LOOP_FAILURE.fullmatch(critique["failure"]) else None,
                      "writeIdentityEqual": loop.get("writeIdentityEqual")}}
    if version == 2:
        extra["loop"]["resumes"] = [{"stage": entry["stage"], "cause": entry["cause"], "as": entry["as"]} for entry in resumes]
        extra["loop"]["closed"] = loop_closed(loop)
    extra["activeSeconds"] = active_seconds(loop_dir, loop)
    # Plan 11.4: every run the scan found, the critique's ledger included; the fallback markers of the run whose reading stage made the packet.
    reader = stage_run(loop_dir, loop)
    extra.update(depth_columns(parts, depth_parts(ledger_rows(reader)[0], [])["fallback"] if os.path.isdir(reader) else None))
    cloud = read_freeze(stage_run(loop_dir, loop)) or {} if loop.get("arm") == "cloud" else None
    if final:
        selected_dir = os.path.join(loop_dir, final["candidate"])
        row = {**run_counts(selected_dir)["row"], **summed, **extra}
        row["runClass"] = classify_run_end(run_end_evidence(selected_dir, marked(final["candidate"])))
        step, failure = final.get("step"), critique.get("failure") if isinstance(critique, dict) else None
        if not row["runClass"]["infra"] and row.get("runStatus") != "submitted":
            cause = None
            if version == 2 and step in ("critique_failed", "repair_failed"):
                # A loop stopped at the critique or the repair after stage 1 delivers its unsubmitted draft; the stop's cause is recorded.
                recorded = final.get("cause")
                if isinstance(recorded, str) and IDENTIFIER.fullmatch(recorded) and recorded not in ("task", "submitted"):
                    cause = ("critique_" if step == "critique_failed" else "repair_") + recorded
            elif version == 1 and step == "critique_failed" and listed(INFRA_CRITIQUE_CODES, failure):
                cause = "critique_" + failure
            elif step not in ("stage_failed", "no_draft", "critique_failed", "repair_failed") and final["candidate"] != "repair" and isinstance(candidates.get("repair", {}).get("runClass"), dict) \
                    and candidates["repair"]["runClass"]["infra"] is True:
                # A repair that ended on infrastructure and lost the comparison left the draft unrepaired (BL-20261110-0723 (c)).
                cause = "repair_" + candidates["repair"]["runClass"]["cause"]
            if cause is not None:
                row["runClass"] = run_class(True, cause)
        check_outcome(args.outcome, row.get("runStatus"), row["runClass"])
    else:
        stage, failure = stopped.get("stage"), stopped.get("failure")
        if stage not in LOOP_STAGES + (None,) or not isinstance(failure, str) or not LOOP_FAILURE.fullmatch(failure) or stopped.get("closed", True) is not True:
            sys.exit("the loop record holds a malformed stop")
        path = os.path.join(loop_dir, stage) if stage else None
        fields = {"date": started.date().isoformat() if started else None, "taskJobSha256": task["jobSha256"], "profile": None, "maxOutputTokens": None,
                  "thinking": None, "cloudModel": None, "cloudApi": None, "pipeline": loop.get("pipeline"), "pipelinePlanner": None, "runStatus": None, "terminalCause": None, "entailment": None,
                  "hostFlags": None}
        evidence = {"kind": "none"}
        if path is not None and stage in LOOP_RUN_STAGES and os.path.isdir(path):
            # What the stopped stage left, as phase4-loop.ts closeLoop reads it: a readable result; else its ledger, when its freeze is
            # readable (a start that froze nothing left nothing, `none`); its row fields from the run, else from its freeze alone.
            ledger = run_ledger(path)
            result = read_result(path)
            if ledger["freeze"] is not None:
                # The loop's own date, task and pipeline stand where the freeze records none.
                found = freeze_fields(read_freeze(path), result, ledger_rows(path)[0], path)
                fields = {**fields, **{key: value for key, value in found.items() if value is not None or key not in ("date", "taskJobSha256", "pipeline")}}
                evidence = {"kind": "result", "end": run_end_evidence(path, marked(stage))} if result is not None else {"kind": "ledger", "dispatches": ledger["dispatches"]}
        elif path is not None and stage == "critique" and os.path.isdir(path):
            saved = read_object(path, "critique-failure.json")
            code = saved["code"] if saved is not None and isinstance(saved.get("code"), str) else None
            evidence = {"kind": "critique", "code": code, "stopSignalled": marked("critique")}
        extra["loop"]["stopped"] = {"stage": stage, "failure": failure, "closed": stopped.get("closed") is True}
        row = {**fields, **summed, **extra, "runClass": classify_loop_stop(failure, evidence)}
        check_outcome(args.outcome, row.get("runStatus"), row["runClass"])
        refuse_unselected_accept(args.outcome, row["loop"])
    # A cloud loop's cloud calls are sample a's stage, or the moved run after a seeded-writer resume (`stage_run`).
    if cloud is not None:
        row.update(cloud_fields(cloud))
    return row

HOST_FLAGS_VERSION = 1
HOST_FLAG_RULES = ("absence", "review")
HOST_FLAG_SECTIONS = ("report_failed", "argument_failed", "misses_failed", "review_failed")
# The closed sets of 7d.B's HostFlagsEventSchema (src/main/private-agent/host-flags.ts): the column copies no value outside them.
HOST_FLAG_COUNTS = ("reportAbsence", "reportAbsenceUncited", "reportBounded", "argumentAbsence", "argumentAbsenceUncited", "argumentBounded", "briefSingleUnit",
                    "inversionEdits", "inversionIntroduced", "inversionSource", "inversionUnaddressed", "numericIntroduced", "numericResolved", "numericSource",
                    "numericUnaddressed")
HOST_FLAG_MISSES = ("briefUnits", "questionsWithoutEvidence", "unresolvedQuestions", "noEvidenceOutcomes", "extractionRetries", "droppedQuotes", "fetchFailures",
                    "fetchLimitRefusals")
HOST_FLAG_FORMATS = ("markdown", "html", "text", "docx", "pdf")
HOST_FLAG_SCAN_REASONS = ("missing", "format_not_scanned")
HOST_FLAG_REVIEW_REASONS = ("missing", "too_large", "invalid")
HOST_FLAG_REVIEW_PARTS = ("step", "numeric", "edits", "clauses")
HOST_FLAG_READ_CAPS = ("comparisonsCapped", "figuresCapped", "labelsCapped", "rowsCapped", "sentencesCapped", "termsCapped")
HOST_FLAG_READ_COUNT = "paragraphsClipped"
HOST_FLAG_ERROR_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")


def host_flags(events, run_dir: str) -> dict | None:
    """Backlog item 7(d), part C (BL-20261114-1246-host-flags-surfaces-design): the run's host_flags event (7d.B) without its positions,
    or None when the run recorded none, which means "not recorded", never "no flags". It keeps the event's version, the rule sets that ran
    and its counts, and, when present, the run's misses, the sections that failed, and the report's, the argument's and the review's states.
    It drops every hit line, flag position and edit id. Every value it keeps must lie in the event schema's closed sets (names, enums,
    booleans, non-negative integers and error class names), so the column never carries free text, whatever wrote the ledger; an event
    outside them refuses the row, as a ledger row that is not JSON does."""
    event = next((item for item in reversed(list(events)) if isinstance(item, dict) and item.get("type") == "host_flags"), None)
    if event is None:
        return None

    def refuse():
        sys.exit(f"{os.path.basename(os.path.normpath(run_dir))} holds a host_flags event the registry cannot read: the row is refused")

    def one(value) -> bool:
        return isinstance(value, int) and not isinstance(value, bool) and value == 1

    def natural(value) -> bool:
        return isinstance(value, int) and not isinstance(value, bool) and value >= 0

    def counted(value, names: tuple) -> dict:
        if not isinstance(value, dict) or not all(key in names and natural(n) for key, n in value.items()):
            refuse()
        return dict(value)
    rules = event.get("rules")
    if not one(event.get("version")) or not isinstance(rules, dict) or any(key not in HOST_FLAG_RULES or not one(value) for key, value in rules.items()):
        refuse()
    flags = {"version": HOST_FLAGS_VERSION, "rules": dict(rules), "counts": counted(event.get("counts"), HOST_FLAG_COUNTS)}
    if "misses" in event:
        flags["misses"] = counted(event["misses"], HOST_FLAG_MISSES)
    if "errors" in event:
        errors = event["errors"]
        if not isinstance(errors, list) or not errors or any(code not in HOST_FLAG_SECTIONS for code in errors):
            refuse()
        flags["errors"] = list(errors)
    for name in ("report", "argument"):
        if name in event:
            scan = event[name]
            if not isinstance(scan, dict) or not isinstance(scan.get("scanned"), bool) or scan.get("format") not in HOST_FLAG_FORMATS \
                    or ("reason" in scan and scan["reason"] not in HOST_FLAG_SCAN_REASONS) \
                    or any(key in scan and not isinstance(scan[key], bool) for key in ("textCut", "truncated")):
                refuse()
            flags[name] = {key: scan[key] for key in ("format", "scanned", "reason", "textCut", "truncated") if key in scan}
    if "review" in event:
        review = event["review"]
        if not isinstance(review, dict) or not isinstance(review.get("valid"), bool) or ("reason" in review and review["reason"] not in HOST_FLAG_REVIEW_REASONS):
            refuse()
        state = {key: review[key] for key in ("valid", "reason") if key in review}
        if "errors" in review:
            errors = review["errors"]
            if not isinstance(errors, dict) or any(key not in HOST_FLAG_REVIEW_PARTS or not isinstance(value, str) or not HOST_FLAG_ERROR_NAME.fullmatch(value)
                                                   for key, value in errors.items()):
                refuse()
            state["errors"] = dict(errors)
        if "read" in review:
            read = review["read"]
            if not isinstance(read, dict) or any(not (key in HOST_FLAG_READ_CAPS and isinstance(value, bool) or key == HOST_FLAG_READ_COUNT and natural(value))
                                                 for key, value in read.items()):
                refuse()
            state["read"] = dict(read)
        flags["review"] = state
    return flags


def support_rate(counts: dict | None) -> float | None:
    """Supported / judged claims; an unjudged claim is neither supported nor a negative judgement."""
    if not isinstance(counts, dict):
        return None
    judged = sum(counts.get(key, 0) for key in ("supported", "partial", "unsupported", "contradicted"))
    return round(counts.get("supported", 0) / judged, 3) if judged else None


def run_counts(run_dir: str) -> dict:
    """One run's counts from its own state.sqlite and result.json, plus the row fields its freeze and result give."""
    result = json.load(open(os.path.join(run_dir, "result.json"), encoding="utf-8"))
    freeze = json.load(open(os.path.join(run_dir, "freeze.json"), encoding="utf-8"))
    events = ledger_rows(run_dir)[0]
    started = datetime.datetime.fromisoformat(freeze["startedAt"].replace("Z", "+00:00"))
    ended = datetime.datetime.fromisoformat(result["finishedAt"].replace("Z", "+00:00"))
    dispatches = result.get("dispatches", [])
    parts = depth_parts(events, dispatches if isinstance(dispatches, list) else [])
    return {
        "started": started, "ended": ended, "depth": depth_columns([parts], parts["fallback"]),
        "row": {
            "date": started.date().isoformat(), "taskJobSha256": freeze["taskBinding"]["jobSha256"],
            "profile": freeze.get("profile", "standard"), "maxOutputTokens": freeze["modelConfig"]["maxOutputTokens"],
            "thinking": freeze["modelConfig"]["thinking"], **cloud_fields(freeze),
            "pipeline": (freeze.get("pipeline") or {}).get("name"), "pipelinePlanner": (freeze.get("pipeline") or {}).get("planner"),
            "runStatus": result.get("status"), "terminalCause": result.get("reason"),
            # Research tasks: the host's entailment pass (PR-J2), counts only; a judge verdict is evidence, not acceptance.
            "entailment": next(({"counts": event.get("counts"), "entailmentCalls": event.get("entailmentCalls"), "truncated": event.get("truncated"),
                "supportRate": support_rate(event.get("counts"))}
                for event in reversed(events) if event.get("type") == "claims_entailment"), None),
            # Backlog item 7(d), part C: the host flags, or None when not recorded.
            "hostFlags": host_flags(events, run_dir),
        },
        "wallSeconds": round((ended - started).total_seconds(), 1),
        **counts_of(events, dispatches),
    }


if __name__ == "__main__":
    sys.exit(main())
