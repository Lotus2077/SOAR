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

`git`, `gitSource` and `gitDirty` (backlog item 11, #85): a run row takes the commit from the run's own
freeze.json (`gitSource` run), a loop row from the selected run's (`run`, or `runs_differ` when the loop's stage freezes do
not all record that commit), and a row whose run recorded none, a --verdict-file row and a --supersedes row of a row
without a run-sourced commit take the commit the row is written at (`row_written`, `gitDirty` null).

H4: `--loop-dir LOOP` instead of `--run-dir` rows a select-and-repair loop (scripts/phase4-loop.ts): the per-run
counts of the loop's runs are summed with the same logic, status, cause and binding come from the selected run,
wall seconds from the loop's own clock, and a `loop` field records the choice. From backlog item 11's part 3b
(#89), loop versions 1 and 2: the counts sum every run the loop made, moved-aside runs included, the
writer waits for no loop (a held loop.lock refuses), and a loop that ended without a selection is rowed by its
stop's class, never as accepted.

Owner verdicts (#40):

    `--verdict-file RECEIPT.json` rows a desktop task from the app's verdict receipt ("Export verdict receipt"). The
    receipt holds hashes, counts, enums and the verdict only; any other key is refused. It supplies the measurements,
    `arm`, `outcome`, `ownerMinutes`, `interventions`, `verdictAt` and `exportedThroughApp`; the operator types --id,
    --batch, --task, --family, --exposure, --lesson and --verdict-by owner.

    `--supersedes ROW_ID [--registry PATH]` copies the registry row with that id verbatim (every measurement,
    taskJobSha256, date, usd, entailment, hostFlags, loop) and changes only id, supersedes, outcome, verdictBy, ownerMinutes,
    interventions, lesson, verdictAt and, unless the copied row's commit came from its run (gitSource run or
    runs_differ), git, gitSource and gitDirty (the commit the row is written at). It refuses an unknown id, an id
    another row already supersedes, and a new id that already exists.

E0 (#117): `--probe-dir DIR` rows a scripts/serving-probe.py run from its probe.json,
`--fixture-dir DIR --fixture planner|judge|extractor|synthesis` a role-fixture run from its summary.json (or, for a planner or judge
run that died without one, from its replies/ listing), and `--labelling-file FILE` the summary of one scripts/judge-labeller.ts invocation.
Each row holds digests, bounded counts and USD amounts, booleans and closed codes only; the served alias, paths, file names, model
or claim text and labels never reach it.

Exactly one of --run-dir, --loop-dir, --verdict-file, --supersedes, --probe-dir, --fixture-dir and --labelling-file is
accepted. `--verdict-by` is `owner`, `agent_diagnostic` or `none`; `owner` requires --owner-minutes and --interventions (the
receipt supplies them).

Plan 11.4: --run-dir and --loop-dir rows add reservedUsd, pinnedUsd, committedDispatches, cloudCalls, disclosedBytes, urls,
domains, retainedBytes, actions, queries, researchFallback and researchCorrections (docs/experiments/README.md). With --run-dir,
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
    parser.add_argument("--probe-dir", default=None, help="E0: a serving-probe run directory (probe.json from scripts/serving-probe.py)")
    parser.add_argument("--fixture-dir", default=None, help="E0: a role-fixture run directory (summary.json); give --fixture too")
    parser.add_argument("--fixture", default=None, choices=FIXTURE_KINDS, help="with --fixture-dir: the fixture that wrote it (planner, judge, extractor or synthesis)")
    parser.add_argument("--labelling-file", default=None, help="E0: the labelling tool's summary.json (scripts/judge-labeller.ts, pnpm label:judge)")
    parser.add_argument("--supersedes", default=None, metavar="ROW_ID", help="copy the registry row with this id and change only its verdict fields")
    parser.add_argument("--registry", default=DEFAULT_REGISTRY, help="the registry --supersedes reads (default: docs/experiments/registry.jsonl)")
    parser.add_argument("--critical-checks", default=None, help="passed/total, e.g. 26/30")
    parser.add_argument("--owner-minutes", type=float, default=None, help="owner effort; required with --verdict-by owner")
    parser.add_argument("--interventions", type=int, default=None, help="manual interventions; required with --verdict-by owner, else 0")
    parser.add_argument("--verdict-at", default=None, help="UTC ISO 8601 time of the verdict, e.g. 2026-11-07T08:30:00Z; default: now")
    args = parser.parse_args()

    sources = [name for name, value in (("--run-dir", args.run_dir), ("--loop-dir", args.loop_dir), ("--verdict-file", args.verdict_file), ("--supersedes", args.supersedes),
                                        ("--probe-dir", args.probe_dir), ("--fixture-dir", args.fixture_dir), ("--labelling-file", args.labelling_file)) if value is not None]
    if len(sources) != 1:
        sys.exit("give exactly one of --run-dir, --loop-dir, --verdict-file, --supersedes, --probe-dir, --fixture-dir and --labelling-file")
    if args.launcher_ledger is not None and args.run_dir is None:
        sys.exit("--launcher-ledger goes with --run-dir only")
    if (args.fixture is None) != (args.fixture_dir is None):
        sys.exit("--fixture-dir and --fixture go together")
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
    elif args.probe_dir is not None or args.fixture_dir is not None or args.labelling_file is not None:
        row = probe_row(args) if args.probe_dir is not None else fixture_row(args) if args.fixture_dir is not None else labelling_row(args)
        check_e0_numbers(row, "--probe-dir" if args.probe_dir is not None else "--fixture-dir" if args.fixture_dir is not None else "--labelling-file")
        check_e0_outcome(args.outcome, row)
    else:
        row = superseding_row(args)
        # A correction repeats the class checks against the copied run's class, when the copy carries one.
        check_outcome(args.outcome, row.get("runStatus"), row.get("runClass"))
        refuse_unselected_accept(args.outcome, row.get("loop"))
        check_e0_outcome(args.outcome, row)
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


# Backlog item 11, part 3a (#85): whether a run that did not submit ended on infrastructure,
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


# Backlog item 11, part 3b (#89, decisions (4) and (10)): why a loop stage stopped, for the row of a
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
        # H1 (#20): prompt tokens the provider reported as served from its cache; 0 when unreported.
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


# Plan 11.4 (#104): reserved and pinned USD, cloud calls, disclosure, retrieval and action counts,
# and 7(c)'s fallback markers. Every value is a count, a USD amount, a fixed host enum or null: a retained source's URL is read only
# to count it and its hostname, and never leaves this process.
LOOPBACK_HOSTS = ("127.0.0.1", "::1")
DISPATCH_STATUSES = ("committed", "settled", "unknown", "superseded", "failed")
HOST_TOKEN = re.compile(r"^[a-z][a-z0-9 _-]{0,63}$")
# #104, decision (1): the runner's closed set of tool names, runner.ts's tools with every option on and observations.ts's
# read_observation. tests/unit/registry-row-columns.test.ts checks this mirror against the runner's own definitions. A tool_started
# event records the name the model chose before the runner checks it, so any other name counts as `other` and never reaches a row.
RUNNER_TOOLS = ("append_file", "check_claims", "execute", "fetch_public", "finish", "read_observation", "remember_plan", "request_consultation", "str_replace", "write_file")


def source_key(url: str) -> str:
    """A retained source's URL as `urls` counts it (#104, decision (2)). Each run's snapshot receiver listens on its own
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
            # settle has none (#104, decisions (3) and (4)).
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
        # denied index stage does not (#104, decision (3)); item 12 revises it.
        "sourcesRead": index["sourcesIndexed"] if index is not None and is_count(index.get("sourcesIndexed")) else None,
        "fallback": {"plan": "host_plan" if (plan or {}).get("fallback") == "host_plan" else "none",
                     "synthesis": "skeleton" if (synthesis or {}).get("fallback") == "skeleton" else "none"} if stages else None,
        # The synthesis evidence-id tolerance: the synthesise row's correction counts, which it records at every run since coverage
        # version 6; null for a row without them (an older protocol, or no synthesis row), which means not recorded, never zero.
        "corrections": {key: synthesis[key] for key in SYNTHESIS_CORRECTION_COUNTS}
                       if synthesis is not None and all(is_count(synthesis.get(key)) for key in SYNTHESIS_CORRECTION_COUNTS) else None,
    }


def depth_columns(parts: list, fallback, corrections=None) -> dict:
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
        # #104, decision (4): commit order across the runs; a call without a commit time keeps the scan's order, after the others.
        "cloudCalls": [call for _, call in sorted((entry for part in parts for entry in part["cloud"]), key=lambda entry: (entry[0] is None, entry[0] or 0))],
        "disclosedBytes": sum(packets.values()) if all(part["complete"] for part in parts) else None,
        "urls": len(urls), "domains": len(hosts),
        "retainedBytes": sum(part["retainedBytes"] for part in parts),
        "actions": {"tools": dict(sorted(tools.items())), "fetchReceipts": sum(part["fetchReceipts"] for part in parts),
                    "sourcesRead": sum(reads) if reads else None},
        "queries": None,
        "researchFallback": fallback,
        "researchCorrections": corrections,
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
    if not isinstance(receipt["arm"], str) or not re.fullmatch(r"local-(standard|heavy)(-consulted)?|local-heavy-research", receipt["arm"]):
        fail_receipt("arm is not local-<profile>, local-<profile>-consulted or local-heavy-research")
    # A desktop local research task (backlog item 13a) runs the heavy profile only, and never consults.
    if receipt["arm"] == "local-heavy-research" and receipt["profile"] != "heavy":
        fail_receipt("a local-heavy-research receipt is not on the heavy profile")
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
    """The cloud model and request shape a run's cloud arm was frozen with (#31); null on local runs or when absent."""
    arm = freeze.get("arm")
    config = arm.get("modelConfig") if isinstance(arm, dict) and arm.get("arm") == "cloud" else None
    config = config if isinstance(config, dict) else {}
    return {"cloudModel": config.get("model"), "cloudApi": config.get("api")}


# #128 (1): the freeze records of SC and 8.2b (servingCardFreeze, src/main/private-agent/serving-card.ts)
# and of 7a.2's pipeline block (researchPipelineFreeze, scripts/private-agent-local-screen.ts). The card reader's entry pattern, in ASCII
# digits, and its MAX_LOCAL_STREAMS.
CARD_ENTRY = re.compile(r"BL-[0-9]{8}-[0-9]{4}-[a-z0-9]+(?:-[a-z0-9]+)*")
MAX_LOCAL_STREAMS = 8


def card_fields(freeze: dict) -> dict:
    """The run's research protocol hash, the serving card the driver loaded, and its K (#128,
    decision (1)). researchProtocolSha256 is freeze.pipeline.protocolSha256, the protocol under the card's role policy (null without a
    research pipeline). servingCard is {sha256, entry} from freeze.servingCard (null without a card). localStreams, ASSIST-M2's K, is the
    card's localStreams, or 1 when the freeze records none, since the driver gives a session K only from a card. A present value of
    another shape refuses the row, naming the field, never its value."""
    pipeline = freeze.get("pipeline")
    protocol = pipeline.get("protocolSha256") if isinstance(pipeline, dict) else None
    if protocol is not None and not is_digest(protocol):
        sys.exit("freeze.json's pipeline.protocolSha256 is not a sha256")
    card = freeze.get("servingCard")
    if card is None:
        return {"researchProtocolSha256": protocol, "servingCard": None, "localStreams": 1}
    if not isinstance(card, dict) or not is_digest(card.get("sha256")) or not isinstance(card.get("entry"), str) or CARD_ENTRY.fullmatch(card["entry"]) is None:
        sys.exit("freeze.json's servingCard does not record the card's sha256 and the entry that adopted it")
    streams = card.get("localStreams", 1)
    if type(streams) is not int or not 1 <= streams <= MAX_LOCAL_STREAMS:
        sys.exit(f"freeze.json's servingCard.localStreams is not a whole number from 1 to {MAX_LOCAL_STREAMS}")
    return {"researchProtocolSha256": protocol, "servingCard": {"sha256": card["sha256"], "entry": card["entry"]}, "localStreams": streams}


# #140 (5): the name of a write bound in LOCAL_SCREEN_WRITE_BOUNDS
# (scripts/private-agent-local-screen.ts), as freeze.json's limits.writeBound records it.
WRITE_BOUND = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")


def limit_fields(freeze: dict) -> dict:
    """The write phase's bound as freeze.json's `limits` records it (#140, decision (5)):
    writeLimits is {bound, modelCalls, toolCalls, elapsedMs}. `bound` is limits.writeBound, the named bound the driver set, or null for
    the profile's own limits; the three numbers are the write phase's, a number the freeze lacks reading null. Null when the freeze
    records no limits, or none of the three and no bound. A present value of another shape refuses the row, naming the field, never
    its value; so does a bound without all three numbers, which the driver always records beside it."""
    limits = freeze.get("limits")
    if limits is None:
        return {"writeLimits": None}
    if not isinstance(limits, dict):
        sys.exit("freeze.json's limits is not an object")
    numbers = {}
    for key in ("modelCalls", "toolCalls", "elapsedMs"):
        value = limits.get(key)
        if value is not None and (type(value) is not int or value < 1):
            sys.exit(f"freeze.json's limits.{key} is not a positive whole number")
        numbers[key] = value
    bound = limits.get("writeBound")
    if bound is not None and (not isinstance(bound, str) or WRITE_BOUND.fullmatch(bound) is None):
        sys.exit("freeze.json's limits.writeBound is not a bound's name")
    if bound is not None and None in numbers.values():
        sys.exit("freeze.json's limits.writeBound is recorded without the write phase's three limits")
    if bound is None and all(value is None for value in numbers.values()):
        return {"writeLimits": None}
    return {"writeLimits": {"bound": bound, **numbers}}


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
    counts as no record (part 3b, #85 (f)) instead of stopping the row."""
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



# Backlog item 11, part 3b (#89, decisions (9) and (10)): a loop row of version 1 or 2.
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
            "thinking": config.get("thinking") if isinstance(config.get("thinking"), (bool, str)) else None, **cloud_fields(freeze), **card_fields(freeze),
            **limit_fields(freeze),
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
    # #143: the samples the loop planned (`--samples`); a record saved before it planned two.
    planned = loop.get("samplesPlanned", 2)
    if type(planned) is not int or planned not in (1, 2):
        sys.exit("the loop record's samplesPlanned is neither 1 nor 2")
    stage1 = loop["selected"].get("stage1") if isinstance(loop.get("selected"), dict) else None
    if planned == 1:
        seeded = loop.get("seeded") if isinstance(loop.get("seeded"), dict) else {}
        rates = stage1.get("entailmentRates") if isinstance(stage1, dict) else None
        if (isinstance(loop.get("candidates"), dict) and loop["candidates"].get("b") is not None) or seeded.get("b") is True \
                or loop.get("writeIdentityEqual") is not None or (isinstance(stage1, dict) and stage1.get("candidate") != "a") \
                or (isinstance(rates, list) and len(rates) == 2 and rates[1] is not None) \
                or (isinstance(loop.get("begun"), list) and any(isinstance(entry, dict) and entry.get("stage") == "b" for entry in loop["begun"])):
            sys.exit("a single-sample loop record holds a second sample")
    if (isinstance(stage1, dict) and stage1.get("step") == "single_sample") != (planned == 1 and isinstance(stage1, dict)):
        sys.exit("the loop record's stage-1 step does not match its planned samples")
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
             "loop": {"version": version, "rule": loop["selectionRule"], "samples": len([name for name in named if name != "repair"]), "samplesPlanned": planned, "repaired": "repair" in named,
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
    reading = depth_parts(ledger_rows(reader)[0], []) if os.path.isdir(reader) else None
    extra.update(depth_columns(parts, reading["fallback"] if reading else None, reading["corrections"] if reading else None))
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
                # A repair that ended on infrastructure and lost the comparison left the draft unrepaired (#85 (c)).
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
                  # #128: without a stage freeze, the protocol hash, the card and K are unknown.
                  "hostFlags": None, "researchProtocolSha256": None, "servingCard": None, "localStreams": None,
                  # #140: nor is the write phase's bound.
                  "writeLimits": None}
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
# 7d.D (#119) adds questionsTrimmed, quotesLeftByCap and conflictsLeftByCap, the owner's answer of 2026-11-18 (#166) declaredGaps
# and gapQuestions, and the synthesis evidence-id tolerance questionsDowngraded; an older event's misses lack them, which means not
# recorded, never zero.
HOST_FLAG_MISSES = ("briefUnits", "questionsWithoutEvidence", "questionsTrimmed", "unresolvedQuestions", "questionsDowngraded", "noEvidenceOutcomes", "extractionRetries",
                    "droppedQuotes", "quotesLeftByCap", "conflictsLeftByCap", "declaredGaps", "gapQuestions", "fetchFailures", "fetchLimitRefusals")
HOST_FLAG_FORMATS = ("markdown", "html", "text", "docx", "pdf")
HOST_FLAG_SCAN_REASONS = ("missing", "format_not_scanned")
HOST_FLAG_REVIEW_REASONS = ("missing", "too_large", "invalid")
HOST_FLAG_REVIEW_PARTS = ("step", "numeric", "edits", "clauses")
HOST_FLAG_READ_CAPS = ("comparisonsCapped", "figuresCapped", "labelsCapped", "rowsCapped", "sentencesCapped", "termsCapped")
HOST_FLAG_READ_COUNT = "paragraphsClipped"
HOST_FLAG_ERROR_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")


def host_flags(events, run_dir: str) -> dict | None:
    """Backlog item 7(d), part C (#99): the run's host_flags event (7d.B) without its positions,
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
        "started": started, "ended": ended, "depth": depth_columns([parts], parts["fallback"], parts["corrections"]),
        "row": {
            "date": started.date().isoformat(), "taskJobSha256": freeze["taskBinding"]["jobSha256"],
            "profile": freeze.get("profile", "standard"), "maxOutputTokens": freeze["modelConfig"]["maxOutputTokens"],
            "thinking": freeze["modelConfig"]["thinking"], **cloud_fields(freeze), **card_fields(freeze), **limit_fields(freeze),
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


# E0's producers (#117): a serving-probe run, a role-fixture run and the labelling call, each
# rowed from the producer's own output. A row copies only 64-hex digests, counts, USD amounts, booleans, closed enums, exception
# class names and the labelling model's id: the served alias, the request settings, paths, file names, model or claim text, labels
# and error bodies never reach it, and the producers' free-text manifest fields are only compared.
# A failed probe keeps its exception class only when that is a built-in exception or one of the probe's own library classes; any
# other name is recorded as `other`, so no text shaped like an identifier reaches a row.
PROBE_FAILURE_CLASSES = frozenset((
    "ArithmeticError", "AssertionError", "AttributeError", "BaseException", "BaseExceptionGroup", "BlockingIOError", "BrokenPipeError", "BufferError", "BytesWarning",
    "ChildProcessError", "ConnectionAbortedError", "ConnectionError", "ConnectionRefusedError", "ConnectionResetError", "DeprecationWarning", "EOFError",
    "EncodingWarning", "EnvironmentError", "Exception", "ExceptionGroup", "FileExistsError", "FileNotFoundError", "FloatingPointError", "FutureWarning",
    "GeneratorExit", "IOError", "ImportError", "ImportWarning", "IndentationError", "IndexError", "InterruptedError", "IsADirectoryError", "KeyError",
    "KeyboardInterrupt", "LookupError", "MemoryError", "ModuleNotFoundError", "NameError", "NotADirectoryError", "NotImplementedError", "OSError", "OverflowError",
    "PendingDeprecationWarning", "PermissionError", "ProcessLookupError", "PythonFinalizationError", "RecursionError", "ReferenceError", "ResourceWarning",
    "RuntimeError", "RuntimeWarning", "StopAsyncIteration", "StopIteration", "SyntaxError", "SyntaxWarning", "SystemError", "SystemExit", "TabError", "TimeoutError",
    "TypeError", "UnboundLocalError", "UnicodeDecodeError", "UnicodeEncodeError", "UnicodeError", "UnicodeTranslateError", "UnicodeWarning", "UserWarning",
    "ValueError", "Warning", "ZeroDivisionError",
    # The probe's own library classes: urllib's errors, http.client's, json's and the probe's ConfigError (socket.timeout's name before 3.10).
    "URLError", "HTTPError", "RemoteDisconnected", "IncompleteRead", "JSONDecodeError", "ConfigError", "timeout"))
# The labelling models the owner approved (#114, (b)).
LABELLING_MODELS = ("gpt-6-sol",)
# The request shape the labelling tool sends (its schema's cloudApi literal).
LABELLING_APIS = ("openai_responses",)
# An E0 row holds only counts a JavaScript reader holds exactly and bounded USD amounts, so no number can smuggle a long value.
SAFE_INTEGER_MAX = 2 ** 53 - 1
E0_USD_MAX = 1_000_000
CLOUD_APIS = ("openai", "openai_responses", "anthropic_messages")
# scripts/serving-probe.py PROBES and PROBE_VERSION; a test pins this copy to the probe's.
PROBE_NAMES = ("P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11", "adapter")
PROBE_VERSION = 2
P10_ROLES = ("plan", "extract", "synthesis")
P10_MODES = ("on", "off")
# The fixtures' closed sets; tests pin each copy to scripts/planner-fixture.ts and scripts/judge-fixture.ts.
PLANNER_CONDITIONS = ("legacy-thinking", "flash-thinking", "thinking-off", "flash-thinking-off", "legacy-thinking-structured", "legacy-thinking-structured-16384",
                      "legacy-thinking-structured-16384-streamed", "thinking-off-structured-16384-streamed")
# The planner conditions it sends streamed (plannerConditionStreamed), whose raw replies it keeps as .sse.
PLANNER_STREAMED = ("legacy-thinking-structured-16384-streamed", "thinking-off-structured-16384-streamed")
PLANNER_CLASSES = ("valid", "binding_invalid", "schema_invalid", "invalid_json", "truncated", "request_rejected", "transport_failed", "malformed_reply")
JUDGE_CONDITIONS = ("j1-legacy", "j1-flash", "j1-legacy-reversed", "j1-flash-reversed")
JUDGE_VERDICTS = ("supported", "partial", "unsupported", "contradicted")
JUDGE_FAILURES = ("request_rejected", "transport_failed", "malformed_reply", "judge_reply_invalid")
# Lane S-pipe's extractor fixture (scripts/extractor-fixture.ts, pull request #116 at 18b062e): EXTRACTOR_CONDITIONS and EXTRACTOR_CLASSES.
EXTRACTOR_CONDITIONS = ("thinking-off", "thinking-on", "thinking-on-8192", "thinking-on-16384", "thinking-off-structured")
EXTRACTOR_CLASSES = ("complete", "held", "needs_followup", "invalid", "truncated", "request_rejected", "malformed_reply", "transport_failed")
# Lane S-pipe's synthesis fixture (scripts/synthesis-fixture.ts, the E0 card's Amendment 7): SYNTHESIS_CELLS, SYNTHESIS_CALL_CLASSES and SYNTHESIS_OUTCOMES.
SYNTHESIS_CELLS = ("synthesis-8192", "synthesis-16384", "synthesis-8192-repair-thinking-off")
SYNTHESIS_CLASSES = ("accepted", "invalid", "truncated", "request_rejected", "malformed_reply", "transport_failed")
SYNTHESIS_OUTCOMES = ("model_synthesis", "skeleton", "no_outcome")
# The attempt-1 classes after which a synthesis trial sends its attempt 2 (the stage's repair).
SYNTHESIS_REPAIRED = ("invalid", "truncated")
SYNTHESIS_JUDGE = re.compile(r"research_tolerance_v[1-9][0-9]{0,2}")
# The synthesis evidence-id tolerance's counts, on the synthesise row (research-coverage.ts synthesisCorrectionCounts) and on an accepted
# fixture call that the tolerance corrected.
SYNTHESIS_CORRECTION_COUNTS = ("evidenceIdsDroppedNotCitable", "evidenceIdsDroppedNotTagged", "questionsDowngraded")
FIXTURE_KINDS = ("planner", "judge", "extractor", "synthesis")
# The reply files each fixture writes (planner `<condition>-NN.sse` for a streamed condition and `<condition>-NN.json` for any other, judge
# `<condition>-r<repeat>-<claim id>.json`), longest names first.
REPLY_NAMES = {"planner": re.compile("^(?:(?:" + "|".join(map(re.escape, sorted((name for name in PLANNER_CONDITIONS if name not in PLANNER_STREAMED), key=len, reverse=True)))
                                     + r")-[0-9]{2,3}\.json|(?:" + "|".join(map(re.escape, sorted(PLANNER_STREAMED, key=len, reverse=True))) + r")-[0-9]{2,3}\.sse)$"),
               "judge": re.compile("^(?:" + "|".join(map(re.escape, sorted(JUDGE_CONDITIONS, key=len, reverse=True))) + r")-r[0-9]{1,2}-C[0-9]{1,3}\.json$")}
# The labelling summary (lane S-e1's scripts/judge-labeller.ts, `pnpm label:judge`), version 1, as agreed on 2026-11-15: exactly these
# keys. The closed sets mirror the tool's exported LABELLING_OUTCOMES, CALL_KINDS, CALL_STATES, SECOND_REQUEST_VALUES, PLANT_REJECTIONS,
# LABELLING_FAILURES and ENVELOPE_LINE; whichever of the two pull requests merges second pins them with a test.
LABELLING_KEYS = frozenset(("version", "kind", "protocol", "labeller", "cloudModel", "cloudApi", "servedModel", "envelopeLine", "run", "startedUtc", "finishedUtc",
                            "outcome", "failure", "secondRequest", "modelCalls", "rejectedDispatches", "unknownDispatches", "inputTokens", "cachedTokens",
                            "cacheWriteTokens", "outputTokens", "reasoningTokens", "usd", "reservedUnknownUsd", "priorCountedUsd", "capUsd", "instructionsSha256",
                            "prices", "calls", "claims"))
LABELLING_CALL_KEYS = frozenset(("call", "kind", "httpStatus", "state", "failure", "projectedUsd", "usd", "countedUsd", "maxOutputTokens", "bodyBytes", "bodySha256",
                                 "inputTokens", "cachedTokens", "cacheWriteTokens", "outputTokens", "reasoningTokens", "cacheWriteReported", "elapsedMs",
                                 "servedModel", "requestId", "errorType", "errorCode"))
LABELLING_CLAIMS_KEYS = frozenset(("harvested", "planted", "minimumPerClass", "labelCounts", "belowMinimum", "plantedRejected", "notesShortened", "inputSha256",
                                   "claimsSha256", "labelsSha256"))
LABELLING_PRICE_KEYS = ("input", "cached", "write", "output")
LABELLING_TOKENS = ("inputTokens", "cachedTokens", "cacheWriteTokens", "outputTokens", "reasoningTokens")
LABELLING_OUTCOMES = ("labelled", "labelled_below_minimum", "failed")
LABELLING_CALL_KINDS = ("label_and_plant", "plant_only")
# A call's state, and the registry's dispatch status it is written as (11.4's cloudCalls).
LABELLING_STATES = {"settled": "settled", "rejected": "failed", "not_sent": "failed", "unknown": "unknown", "outside_projection": "unknown"}
LABELLING_SECOND_REQUESTS = ("sent", "labeller_cap_exceeded")
# The tool's UNBILLED_STATUSES: the only statuses a `rejected` call, counted at zero, can carry.
LABELLING_UNBILLED_STATUSES = (400, 401, 403, 404, 429)
# The lock a labelling run holds in the tool's e0-judge directory (the tool's LOCK_NAME), created at its start and removed at its end. The run
# directory sits beside claims.json, in that directory or a folder below it, so the lock is looked for in every directory above the run directory.
LABELLING_LOCK = "labelling.lock"
LABELLING_PLANT_REJECTIONS = ("unknown_source", "unchanged_sentence", "duplicate", "sentence_bounds", "empty_note", "surplus", "no_free_id")
LABELLING_FAILURES = ("labeller_interrupted", "labeller_timeout", "labeller_reply_too_large", "labeller_transport_failed", "labeller_rejected", "labeller_http_status",
                      "labeller_reply_undecodable", "labeller_usage_outside_projection", "labeller_reply_cut_at_output_cap", "labeller_reply_incomplete",
                      "labeller_reply_refused", "labeller_served_model_mismatch", "labeller_reply_invalid", "labeller_labels_incomplete", "labeller_output_invalid",
                      "labeller_claims_changed", "labeller_labels_unwritable", "labeller_claims_unwritable")
ENVELOPE_LINES = ("synthetic_data",)
PROVIDER_CODE = re.compile(r"^[a-z0-9_]{1,64}$")


def refuse(source: str, message: str):
    sys.exit(f"{source}: {message}")


def read_producer_json(path: str, source: str, allow_constants: bool = False):
    """A producer's file as (raw bytes, object). Refused: a symbolic link, a missing or irregular file, bytes that are not strict UTF-8
    or start with a byte-order mark, and anything but one JSON object. NaN and the infinities are refused unless `allow_constants`."""
    if os.path.islink(path) or not os.path.isfile(path):
        refuse(source, f"{os.path.basename(path)} is missing or not a regular file")
    with open(path, "rb") as handle:
        raw = handle.read()
    try:
        if raw.startswith(b"\xef\xbb\xbf"):
            raise ValueError("byte-order mark")
        value = json.loads(raw.decode("utf-8"), parse_constant=None if allow_constants else reject_constant)
    except (UnicodeDecodeError, ValueError):
        refuse(source, f"{os.path.basename(path)} is not strict UTF-8 JSON")
    if not isinstance(value, dict):
        refuse(source, f"{os.path.basename(path)} is not a JSON object")
    return raw, value


def recorded_instant(value, source: str, name: str) -> datetime.datetime:
    """An instant a producer recorded, in UTC (Z or +00:00); anything else is refused."""
    try:
        parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00")) if isinstance(value, str) else None
    except ValueError:
        parsed = None
    if parsed is None or parsed.tzinfo is None or parsed.utcoffset() != datetime.timedelta(0):
        refuse(source, f"{name} is not a UTC instant")
    return parsed


def recorded_span(started: datetime.datetime, finished, source: str):
    """The run's recorded wall time in seconds, or None when it did not finish; an end before the start is refused."""
    if finished is None:
        return None
    seconds = (finished - started).total_seconds()
    if seconds < 0:
        refuse(source, "the run's recorded end precedes its start")
    return round(seconds, 1)


def bounded_count(value) -> bool:
    return is_count(value) and value <= SAFE_INTEGER_MAX


def bounded_amount(value) -> bool:
    return is_amount(value) and value <= E0_USD_MAX


def check_e0_numbers(value, source: str) -> None:
    """Every number an E0 row carries, sums included, stays in the range a JavaScript reader holds exactly."""
    if isinstance(value, dict):
        for item in value.values():
            check_e0_numbers(item, source)
    elif isinstance(value, list):
        for item in value:
            check_e0_numbers(item, source)
    elif isinstance(value, (int, float)) and not isinstance(value, bool) and not (math.isfinite(value) and 0 <= value <= SAFE_INTEGER_MAX):
        refuse(source, "a computed count or amount leaves the range a row records exactly")


def is_digest(value) -> bool:
    return isinstance(value, str) and SHA256_HEX.fullmatch(value) is not None


def canonical_sha256(value) -> str:
    """sha256 of the canonical JSON (sorted keys, no spaces) of a structure of digests and counts, as contracts.ts canonical writes it."""
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()


def micro(value) -> int:
    return round(value * 1_000_000)


def local_spend() -> dict:
    """The spend columns of a run that sent only to the owned endpoint, outside the broker: zero fee, no cloud call, and nothing
    disclosed (HARN-27 counts nothing disclosed to a local model), so no call's charge can be unknown."""
    return {"usd": 0.0, "reservedUsd": 0.0, "pinnedUsd": 0.0, "unknownDispatches": 0, "cloudCalls": [], "disclosedBytes": 0}


def e0_row_base(started: datetime.datetime, finished, source: str) -> dict:
    """The fields every E0 row shares (decision (2)): no coordinator profile, and the producer's recorded start and span."""
    return {"date": started.date().isoformat(), "wallSeconds": recorded_span(started, finished, source), "profile": None, "thinking": None,
            "maxOutputTokens": None, "cloudModel": None, "cloudApi": None}


def answered_usage(record):
    """(input, output) tokens of one probe request record that was answered and reports both as counts, else None."""
    if isinstance(record, dict) and record.get("status") == 200 and bounded_count(record.get("prompt_tokens")) and bounded_count(record.get("completion_tokens")):
        return record["prompt_tokens"], record["completion_tokens"]
    return None


def probe_requests(name: str, record):
    """The chat-completion requests that one completed probe's record shows (scripts/serving-probe.py, probe version 2): the records of
    those it keeps one for, and the number of those it keeps none for. /models, /version, /metrics, /openapi.json and /tokenize are not
    model calls."""
    if not isinstance(record, dict):
        refuse("--probe-dir", f"{name}'s record is not an object")
    records = lambda value: [item for item in value.values() if isinstance(item, dict)] if isinstance(value, dict) else []
    listed = lambda value: [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []
    if name == "P1":
        return [], 0
    if name in ("P2", "P3", "P4"):
        return records(record), 0
    if name in ("P5", "P8", "P9"):
        return [record], 0
    if name == "P6":
        return [record[key] for key in ("abort", "next_request") if isinstance(record.get(key), dict)], 0
    if name == "P7":
        return ([record["single"]] if isinstance(record.get("single"), dict) else []) + records(record.get("concurrent")), 0
    if name == "P10":
        return [check for role in records(record.get("acceptance")) for check in records(role)] + \
            [call for cell in records(record.get("cells")) for call in listed(cell.get("calls"))], 0
    if name == "P11":
        layouts = record.get("cache_layouts")
        requests = records(record.get("sizes")) + [row for layout in records(layouts.get("layouts") if isinstance(layouts, dict) else None) for row in listed(layout.get("requests"))]
        bursts = records(record.get("k_streams"))
        if not all(bounded_count(burst.get("streams")) for burst in bursts):
            refuse("--probe-dir", "a P11 K burst does not record its number of streams")
        # A burst keeps aggregates only, so its streams are requests without a per-request record.
        return requests, sum(burst["streams"] for burst in bursts)
    # The adapter probe: its plain chat call is kept only as `chat_status` beside the /tokenize result.
    tokenize = record.get("tokenize")
    return [record[key] for key in ("thinking_on_json", "thinking_on_sse", "thinking_off_json", "thinking_off_sse", "cache_salt") if isinstance(record.get(key), dict)], \
        (1 if isinstance(tokenize, dict) and "chat_status" in tokenize else 0)


def counted(value) -> bool:
    """A count above 0; a bool is not a count."""
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def transport_failed(value) -> bool:
    """Whether a probe record shows a transport failure anywhere in it (#123, decision (5), as
    implemented). It decides from what each record holds, so a record written before this change is read conservatively:
    - a POST's transport_error (status -1), or a stream's error naming an exception class (an HTTP error code is the server's answer);
    - a status of -1, or one naming an exception class: a GET's, the adapter's chat_status, a P11 cache-layout row's;
    - a P11 K burst counting a stream that failed at transport: its transport_errors, or, in a record from before that count, its
      errors count, which also counts a stream without usage or elapsed time;
    - a streamed reply that answered 200 with no finish reason, unless its stream_end says the server ended it ("done" or "error");
      a record from before stream_end has none, so it counts. A P10 call classed stream_ended_early is one.
    P6's deliberate abort is recorded as aborted_after_s and is none of these."""
    if isinstance(value, list):
        return any(transport_failed(item) for item in value)
    if not isinstance(value, dict):
        return False
    if "transport_error" in value or isinstance(value.get("error"), str) or value.get("classification") == "stream_ended_early":
        return True
    if any((key == "status" or key.endswith("_status")) and not isinstance(item, bool) and (item == -1 or isinstance(item, str)) for key, item in value.items()):
        return True
    if "streams" in value and "errors" in value and counted(value.get("transport_errors", value.get("errors"))):
        return True
    if ("chunks" in value or "stream_chunks" in value) and value.get("status") == 200 and "finish_reason" in value and value["finish_reason"] is None \
            and value.get("stream_end", "eof") == "eof":
        return True
    return any(transport_failed(item) for item in value.values())


def probe_names(probe: dict, key: str) -> list:
    value = probe.get(key)
    if not isinstance(value, list) or not all(isinstance(name, str) and name in PROBE_NAMES for name in value) or len(set(value)) != len(value):
        refuse("--probe-dir", f"{key} is not a list of probe names")
    return value


def probe_row(args) -> dict:
    """Decision (3): one serving-probe run directory, from its probe.json."""
    source = "--probe-dir"
    # A Prometheus reading can be NaN, which json.dump writes as is; the writer never copies those readings, so it reads past them.
    raw, probe = read_producer_json(os.path.join(args.probe_dir, "probe.json"), source, allow_constants=True)
    if type(probe.get("probe_version")) is not int or probe["probe_version"] != PROBE_VERSION:
        refuse(source, "probe.json is not probe version 2")
    if probe.get("transport_class") != "loopback" and probe.get("cost_policy") != "local_zero_cost":
        refuse(source, "probe.json does not show the probe's zero-fee guard (a loopback endpoint, or SOAR_VLLM_COST_POLICY=local_zero_cost)")
    started = recorded_instant(probe.get("started_utc"), source, "started_utc")
    finished = recorded_instant(probe["finished_utc"], source, "finished_utc") if probe.get("finished_utc") is not None else None
    selected, ran, skipped = (probe_names(probe, key) for key in ("probes_selected", "probes_run", "probes_skipped"))
    failed = probe.get("probes_failed")
    if not isinstance(failed, dict) or not all(name in PROBE_NAMES and isinstance(error, str) for name, error in failed.items()):
        refuse(source, "probes_failed does not map probe names to exception class names")
    if not set(ran) <= set(selected) or not set(failed) <= set(selected) or set(ran) & set(failed) or set(skipped) & set(selected):
        refuse(source, "probes_run and probes_failed are not disjoint parts of probes_selected, or a skipped probe was selected")
    # A finished run ran or failed every probe it selected; an unfinished one stopped inside the first it records neither for.
    if finished is not None and set(ran) | set(failed) != set(selected):
        refuse(source, "a finished probe run neither ran nor failed every probe it selected")
    calls, usage = {}, {"calls": 0, "inputTokens": 0, "outputTokens": 0}
    for name in (name for name in PROBE_NAMES if name in ran):
        records, unrecorded = probe_requests(name, probe.get(name))
        calls[name] = len(records) + unrecorded
        for tokens in filter(None, map(answered_usage, records)):
            usage["calls"] += 1
            usage["inputTokens"] += tokens[0]
            usage["outputTokens"] += tokens[1]
    # P8 measures whether a long non-streaming request survives, so a connection cut after the request was sent (RemoteDisconnected, a
    # timeout, a reset) is its finding. urllib raises URLError only when it cannot connect or send, so a P8 whose transport_error is
    # URLError never reached the server, and that is a transport failure.
    sent_then_cut = lambda record: isinstance(record, dict) and record.get("transport_error") != "URLError"
    transport = [name for name in PROBE_NAMES if name in ran and transport_failed(probe.get(name)) and not (name == "P8" and sent_then_cut(probe.get(name)))]
    roles = probe.get("roles")
    protocol = roles.get("protocol_sha256") if isinstance(roles, dict) else None
    if protocol is not None and not is_digest(protocol):
        refuse(source, "roles.protocol_sha256 is not a sha256")
    assessed = protocol_match = input_sha256 = None
    if "P10" in ran:
        p10 = probe["P10"]
        assessment = p10.get("assessed")
        assessed = isinstance(assessment, dict)
        if assessed:
            protocol_match = assessment.get("schemasProtocolMatch")
            if not isinstance(protocol_match, bool):
                refuse(source, "P10's assessment does not record whether its export's research protocol matched")
        cells, schemas = p10.get("cells"), p10.get("schema_sha256")
        names = {f"{role}/{mode}" for role in P10_ROLES for mode in P10_MODES}
        if not isinstance(cells, dict) or not set(cells) <= names or not all(isinstance(cell, dict) and (cell.get("request_body_sha256") is None or is_digest(cell["request_body_sha256"]))
                                                                               for cell in cells.values()):
            refuse(source, "P10's cells are not role/thinking cells whose exported request body digest is a sha256 or null")
        # What each cell sent: the exported body (scripts/export-role-schemas.ts records its digest), plus the response_format built from the
        # role's schema and the strict variant the run chose. An export without body digests binds no input hash.
        if cells and all(is_digest(cell.get("request_body_sha256")) and isinstance(cell.get("strict"), bool) for cell in cells.values()) \
                and isinstance(schemas, dict) and set(schemas) == set(P10_ROLES) and all(is_digest(value) for value in schemas.values()):
            input_sha256 = canonical_sha256({"bodies": {name: cell["request_body_sha256"] for name, cell in cells.items()}, "schemas": schemas,
                                             "strict": {name: cell["strict"] for name, cell in cells.items()}})
    return {**e0_row_base(started, finished, source), "inputSha256": input_sha256, "modelCalls": sum(calls.values()),
            # The probe keeps no usage for several of its calls (P5, P9, P10's acceptance checks, P11's K bursts, the adapter's plain and
            # cache-salt calls), so the token columns stay null and `probe.usage` holds what it did record.
            "inputTokens": None, "outputTokens": None, "cachedTokens": None, **local_spend(),
            "terminalCause": "probe_finished" if finished is not None else "probe_unfinished",
            "probe": {"version": PROBE_VERSION, "sha256": hashlib.sha256(raw).hexdigest(), "protocolSha256": protocol, "selected": selected, "run": ran,
                      "skipped": skipped, "failed": {name: error if error in PROBE_FAILURE_CLASSES else "other" for name, error in sorted(failed.items())},
                      "finished": finished is not None, "assessed": assessed, "schemasProtocolMatch": protocol_match, "calls": calls,
                      "usage": usage, "transportFailures": transport}}


def fixture_usage(calls: list) -> dict:
    """Token sums over the answered calls' own usage objects. `usageMissing` counts answered calls whose usage lacks its prompt or completion
    count, and `cachedMissing` those whose usage reports no cached-token detail (none at all included; vLLM leaves the detail out unless it
    runs with --enable-prompt-tokens-details). Either leaves the run's total unknown, not zero: the row's columns are then null, and
    `fixture.usage` keeps the sums over the calls that did report usage."""
    totals = {"calls": 0, "inputTokens": 0, "outputTokens": 0, "cachedTokens": 0, "usageMissing": 0, "cachedMissing": 0}
    for call in calls:
        if call.get("status") != 200:
            continue
        usage = call.get("usage")
        details = usage.get("prompt_tokens_details") if isinstance(usage, dict) else None
        if isinstance(details, dict) and bounded_count(details.get("cached_tokens")):
            totals["cachedTokens"] += details["cached_tokens"]
        else:
            totals["cachedMissing"] += 1
        if not isinstance(usage, dict) or not bounded_count(usage.get("prompt_tokens")) or not bounded_count(usage.get("completion_tokens")):
            totals["usageMissing"] += 1
            continue
        totals["calls"] += 1
        totals["inputTokens"] += usage["prompt_tokens"]
        totals["outputTokens"] += usage["completion_tokens"]
    return totals


def fixture_manifest(kind: str, manifest, source: str) -> dict:
    """The fixture manifest's hashes and counts as the run recorded them, never its name, task, note or packets' run names."""
    digests, counts = {"planner": (("indexSha256", "briefSha256", "sourceIdsSha256"), ("sourceCount", "mandatorySourceChunks", "extractionCallBudget")),
                       "judge": (("sha256", "claimsSha256", "labelsSha256"), ("claimCount", "plantedCount", "minimumPerClass")),
                       "extractor": (("sha256", "briefSha256", "planSha256"), ("unitCount", "sourceCount")),
                       "synthesis": (("sha256", "briefSha256"), ("trialsPerPacket", "packetCount"))}[kind]
    if not isinstance(manifest, dict) or not all(is_digest(manifest.get(key)) for key in digests) or not all(bounded_count(manifest.get(key)) for key in counts):
        refuse(source, "the summary's manifest does not record its hashes and counts")
    kept = {key: manifest[key] for key in digests + counts}
    if kind == "judge":
        labels, agreement = manifest.get("labelCounts"), manifest.get("agreement")
        if not isinstance(labels, dict) or set(labels) != set(JUDGE_VERDICTS) or not all(bounded_count(value) for value in labels.values()):
            refuse(source, "the summary's manifest does not record its label counts")
        if not isinstance(agreement, dict) or set(agreement) != {"measure", "level"} or agreement["measure"] not in ("exact", "established") \
                or not bounded_amount(agreement["level"]) or agreement["level"] > 1:
            refuse(source, "the summary's manifest does not record its agreement measure and level")
        kept.update(labelCounts=dict(labels), agreement=dict(agreement))
    return kept


def check_call_cells(kind: str, calls: list, conditions: list, repeats: int, kept: dict, chunks, interrupted: bool, source: str) -> None:
    """Each condition, repeat and chunk holds its own call (the planner's per condition and repeat, the judge's per claim), never another's:
    the total alone would admit every call moved into one condition."""
    plain = lambda value: type(value) is int and 1 <= value <= repeats
    if kind == "planner":
        keys = [(call["condition"], call.get("ordinal")) for call in calls if plain(call.get("ordinal"))]
        expected = {(condition, repeat) for condition in conditions for repeat in range(1, repeats + 1)}
    elif kind == "extractor":
        names = [chunk.get("chunkId") for chunk in chunks]
        if not all(isinstance(name, str) for name in names) or len(set(names)) != len(names) or len(names) != kept["sourceCount"]:
            refuse(source, "the summary's chunks are not one named chunk per manifest source")
        keys = [(call["condition"], call.get("repeat"), call.get("chunkId")) for call in calls if plain(call.get("repeat")) and call.get("chunkId") in names]
        expected = {(condition, repeat, name) for condition in conditions for repeat in range(1, repeats + 1) for name in names}
    else:
        keys = [(call["condition"], call.get("repeat"), call.get("claimId")) for call in calls
                if plain(call.get("repeat")) and isinstance(call.get("claimId"), str) and re.fullmatch(r"C[0-9]{1,3}", call["claimId"])]
        per_cell = {}
        for condition, repeat, _ in keys:
            per_cell[(condition, repeat)] = per_cell.get((condition, repeat), 0) + 1
        expected = None
        if set(per_cell) != {(condition, repeat) for condition in conditions for repeat in range(1, repeats + 1)} \
                or any(number != kept["claimCount"] for number in per_cell.values()):
            refuse(source, "the summary's calls are not one per condition, repeat and claim")
    if len(keys) != len(calls) or len(set(keys)) != len(keys) or (expected is not None and not (set(keys) <= expected if interrupted else set(keys) == expected)):
        refuse(source, f"the summary's calls are not one per condition, repeat and {'chunk' if kind == 'extractor' else 'claim' if kind == 'judge' else 'ordinal'}")


def call_class(kind: str, call: dict, source: str) -> str:
    """A fixture call's class: the planner's, extractor's or synthesis fixture's classification, or the judge's verdict, or, for a call not
    judged, its failure."""
    if kind in ("planner", "extractor", "synthesis"):
        value = call.get("classification")
        if value not in {"planner": PLANNER_CLASSES, "extractor": EXTRACTOR_CLASSES, "synthesis": SYNTHESIS_CLASSES}[kind]:
            refuse(source, f"a call's classification is not one the {kind} fixture writes")
        return value
    verdict, failure = call.get("verdict"), call.get("failure")
    if verdict in JUDGE_VERDICTS and failure is None:
        return verdict
    if verdict == "not_judged" and failure in JUDGE_FAILURES:
        return failure
    refuse(source, "a call's verdict and failure are not ones the judge fixture writes")


def judge_scores(summary: dict, conditions: list, repeats: int, source: str) -> dict:
    """Per condition and repeat, the counts and the level check the judge run computed; the writer never reads the labels."""
    metrics = summary.get("metrics")
    scores = {}
    for condition in conditions:
        per = metrics.get(condition) if isinstance(metrics, dict) else None
        if not isinstance(per, dict) or set(per) != {f"r{repeat}" for repeat in range(1, repeats + 1)}:
            refuse(source, "the summary's metrics do not cover every condition and repeat")
        scores[condition] = {}
        for key, value in sorted(per.items(), key=lambda item: int(item[0][1:])):
            if not isinstance(value, dict) or not all(bounded_count(value.get(name)) for name in ("claims", "judged", "exactCount", "establishedCount")) \
                    or not isinstance(value.get("meetsLevel"), bool):
                refuse(source, "a repeat's metrics do not record their counts and level check")
            scores[condition][key] = {name: value[name] for name in ("claims", "judged", "exactCount", "establishedCount", "meetsLevel")}
    return scores


def check_judge_scores(scores: dict, calls: list, kept: dict, source: str) -> None:
    """The judge's copied scores are its calls': each repeat scores every claim, `judged` counts the calls judged, the agreements are
    within them, and `meetsLevel` is the manifest's measure at its level over the unrounded counts, as meetsAgreementLevel computes it."""
    measure, level = kept["agreement"]["measure"], kept["agreement"]["level"]
    for condition, repeats in scores.items():
        for key, score in repeats.items():
            judged = sum(1 for call in calls if call["condition"] == condition and call.get("repeat") == int(key[1:]) and call.get("verdict") != "not_judged")
            agreeing = score["exactCount"] if measure == "exact" else score["establishedCount"]
            if score["claims"] != kept["claimCount"] or score["judged"] != judged or score["exactCount"] > judged or score["establishedCount"] > judged \
                    or score["meetsLevel"] != (score["claims"] > 0 and agreeing / score["claims"] >= level):
                refuse(source, f"the summary's {condition} {key} scores are not its calls' and its manifest's")


def synthesis_outcome(classes: list):
    """A synthesis trial's (outcome, acceptedAttempt) from its calls' classes in attempt order, or None while it waits for its attempt 2: an
    accepted call is the model's synthesis, a refused attempt 2 leaves the host skeleton, and a call that settled no reply ends it with none."""
    if classes[-1] == "accepted":
        return "model_synthesis", len(classes)
    if classes[-1] not in SYNTHESIS_REPAIRED:
        return "no_outcome", None
    return ("skeleton", None) if len(classes) == 2 else None


def synthesis_corrections(summary: dict, calls: list, source: str) -> dict:
    """A tolerant synthesis run's corrections (scripts/synthesis-fixture.ts SynthesisCorrectionTotals) from its calls: only an accepted
    call carries them, all three counts together, and `allUnresolvedByDrops` only as true beside a downgrade. Refused unless the summary's
    `corrections` is exactly that tally."""
    totals = {"acceptedWithDrops": 0, **dict.fromkeys(SYNTHESIS_CORRECTION_COUNTS, 0), "allUnresolvedByDrops": 0}
    for call in calls:
        present = [key for key in SYNTHESIS_CORRECTION_COUNTS if key in call]
        flag = call.get("allUnresolvedByDrops")
        if not present and "allUnresolvedByDrops" not in call:
            continue
        if call.get("classification") != "accepted" or len(present) != len(SYNTHESIS_CORRECTION_COUNTS) or not all(is_count(call[key]) for key in present) \
                or ("allUnresolvedByDrops" in call and (flag is not True or call["questionsDowngraded"] < 1)):
            refuse(source, "a call's corrections are not ones the synthesis fixture writes")
        totals["acceptedWithDrops"] += 1
        for key in SYNTHESIS_CORRECTION_COUNTS:
            totals[key] += call[key]
        totals["allUnresolvedByDrops"] += 1 if flag is True else 0
    if summary.get("corrections") != totals:
        refuse(source, "the summary's corrections do not match its calls")
    return totals


def synthesis_trials(summary: dict, calls: list, repeats: int, interrupted: bool, source: str) -> dict:
    """A synthesis run's trials (scripts/synthesis-fixture.ts runSynthesisFixture) from its calls, in the order it made them: each trial sends
    attempt 1, and attempt 2 only after an invalid or truncated attempt 1. Its records are its ended trials', in trial order, each its calls'.
    The fixture rewrites its summary after every call and then after every trial, so a finished run recorded all `repeats` trials, and a
    stopped one may leave its last trial unrecorded, waiting for its attempt 2 or for its record. Returns the outcome counts over the records."""
    trials = []
    for call in calls:
        trial, attempt, name = call.get("trial"), call.get("attempt"), call_class("synthesis", call, source)
        if type(trial) is not int or not 1 <= trial <= repeats or type(attempt) is not int or attempt not in (1, 2):
            refuse(source, "a call's trial or attempt is not one the synthesis fixture writes")
        if attempt == 1 and trial == len(trials) + 1:
            trials.append([name])
        elif attempt == 2 and trial == len(trials) and synthesis_outcome(trials[-1]) is None:
            trials[-1].append(name)
        else:
            refuse(source, "the summary's calls are not each trial's attempt 1 and, only after an invalid or truncated one, its attempt 2, in trial order")
    records, outcomes = summary.get("trials"), dict.fromkeys(SYNTHESIS_OUTCOMES, 0)
    if not isinstance(records, list) or len(records) > len(trials) or (not interrupted and len(trials) != repeats) \
            or len(trials) - len(records) > (1 if interrupted else 0):
        refuse(source, "the summary's trials are not a record of every trial of a finished run, or of all but at most the last of a stopped one")
    for number, (classes, record) in enumerate(zip(trials, records), 1):
        ended = synthesis_outcome(classes)
        expected = None if ended is None else {"trial": number, "outcome": ended[0], "acceptedAttempt": ended[1], "calls": len(classes)}
        # Compared by type too, so that no boolean stands for a trial, an attempt or a count.
        if not isinstance(record, dict) or expected is None or any(type(record.get(key)) is not type(value) or record.get(key) != value for key, value in expected.items()):
            refuse(source, f"the summary's record of trial {number} is not its calls' outcome, accepted attempt and call count")
        outcomes[ended[0]] += 1
    if summary.get("outcomes") != outcomes:
        refuse(source, "the summary's outcomes do not match its trials")
    return outcomes


def unfinished_fixture_row(args, kind: str, source: str) -> dict:
    """A fixture run that died before writing summary.json, rowed from its replies/ listing (decision (4)): one file per answered
    request, so a lower bound; dated by the earliest reply. Only the listing is read, never a reply."""
    replies = os.path.join(args.fixture_dir, "replies")
    if os.path.islink(replies) or not os.path.isdir(replies):
        refuse(source, "the directory holds neither summary.json nor a replies directory")
    files = list(os.scandir(replies))
    if any(not entry.is_file(follow_symlinks=False) or not REPLY_NAMES[kind].fullmatch(entry.name) for entry in files):
        refuse(source, f"replies/ holds an entry the {kind} fixture does not write")
    if not files:
        refuse(source, "the run left no summary.json and no reply, so nothing dates it")
    first = datetime.datetime.fromtimestamp(min(entry.stat(follow_symlinks=False).st_mtime for entry in files), datetime.timezone.utc)
    return {**e0_row_base(first, None, source), "inputSha256": None, "modelCalls": len(files), "inputTokens": None, "outputTokens": None, "cachedTokens": None,
            **local_spend(), "terminalCause": "fixture_unfinished", "fixture": {"kind": kind, "finished": False, "replies": len(files)}}


def fixture_row(args) -> dict:
    """Decision (4): one role-fixture run directory, from its summary.json (scripts/planner-fixture.ts FixtureSummary, scripts/judge-fixture.ts
    JudgeFixtureSummary, and lane S-pipe's scripts/extractor-fixture.ts and scripts/synthesis-fixture.ts SynthesisFixtureSummary)."""
    source, kind = "--fixture-dir", args.fixture
    path = os.path.join(args.fixture_dir, "summary.json")
    if not os.path.lexists(path):
        if kind in ("extractor", "synthesis"):
            refuse(source, f"the {kind} fixture writes summary.json before its first request, so a directory without one sent nothing")
        return unfinished_fixture_row(args, kind, source)
    raw, summary = read_producer_json(path, source)
    if type(summary.get("version")) is not int or summary["version"] != 1 or summary.get("dryRun") is not False:
        refuse(source, "summary.json is not a version 1 summary of a run that sent its requests")
    started = recorded_instant(summary.get("startedUtc"), source, "startedUtc")
    # The extractor and synthesis fixtures rewrite their summary as they go and add finishedUtc at the end.
    interrupted = kind in ("extractor", "synthesis") and summary.get("finishedUtc") is None
    finished = None if interrupted else recorded_instant(summary.get("finishedUtc"), source, "finishedUtc")
    allowed = {"planner": PLANNER_CONDITIONS, "judge": JUDGE_CONDITIONS, "extractor": EXTRACTOR_CONDITIONS, "synthesis": SYNTHESIS_CELLS}[kind]
    conditions, repeats = summary.get("conditions"), summary.get("repeats")
    if not isinstance(conditions, list) or not conditions or not all(condition in allowed for condition in conditions) or len(set(conditions)) != len(conditions):
        refuse(source, f"the summary's conditions are not {kind} fixture conditions")
    if kind == "synthesis" and len(conditions) != 1:
        refuse(source, "the summary's conditions are not the one cell a synthesis run sends")
    if not bounded_count(repeats) or repeats < 1:
        refuse(source, "the summary's repeats is not a positive count")
    manifest = summary.get("manifest")
    for flag, key, given in (("--task", "task", args.task), ("--exposure", "exposure", args.exposure)):
        if not isinstance(manifest, dict) or manifest.get(key) != given:
            refuse(source, f"{flag} must equal the fixture manifest's {key}")
    kept = fixture_manifest(kind, manifest, source)
    if kind == "synthesis":
        # Its trials alternate the packets, trialsPerPacket on each; it sends nothing unless both stage bodies of every packet, rebuilt, match the
        # run's receipts in size and in packet digest.
        if repeats != kept["trialsPerPacket"] * kept["packetCount"]:
            refuse(source, "the summary's repeats is not its manifest's trials per packet times its packet count")
        stage = summary.get("stageCheck")
        passed = lambda check: isinstance(check, dict) and all(isinstance(check.get(key), list) and [item is True for item in check[key]] == [True, True]
                                                               for key in ("bodyBytes", "packetSha256"))
        if not isinstance(stage, list) or len(stage) != kept["packetCount"] or not all(map(passed, stage)):
            refuse(source, "the summary's stage check does not pass both stage bodies of every packet")
    requests, digest = summary.get("requests"), "requestSha256" if kind == "planner" else "requestSetSha256"
    if not isinstance(requests, dict) or set(requests) != set(conditions) or not all(isinstance(item, dict) and is_digest(item.get(digest)) for item in requests.values()):
        refuse(source, "the summary's requests do not record a request digest per condition")
    calls, chunks = summary.get("calls"), summary.get("chunks")
    if kind == "extractor" and (not isinstance(chunks, list) or not chunks or not all(isinstance(chunk, dict) for chunk in chunks)):
        refuse(source, "the summary does not record its chunks")
    # Calls per condition and repeat: one planner request, one judge request per claim, one extractor request per chunk. A synthesis trial
    # makes one or two, which its trials check.
    expected = None if kind == "synthesis" else len(conditions) * repeats * (kept["claimCount"] if kind == "judge" else len(chunks) if kind == "extractor" else 1)
    # An interrupted extractor run records the calls it made so far; every other planner, judge or extractor summary records them all.
    if not isinstance(calls, list) or (expected is not None and (len(calls) > expected if interrupted else len(calls) != expected)) \
            or not all(isinstance(call, dict) and call.get("condition") in conditions for call in calls):
        refuse(source, "the summary does not record its calls" if expected is None else f"the summary does not record its {expected} calls")
    if not all(call.get("status") is None or (isinstance(call["status"], int) and not isinstance(call["status"], bool)) for call in calls):
        refuse(source, "a call's status is not an HTTP status")
    if kind == "synthesis":
        outcomes = synthesis_trials(summary, calls, repeats, interrupted, source)
    else:
        check_call_cells(kind, calls, conditions, repeats, kept, chunks, interrupted, source)
    classes = {condition: {} for condition in conditions}
    for call in calls:
        name = call_class(kind, call, source)
        classes[call["condition"]][name] = classes[call["condition"]].get(name, 0) + 1
    if kind in ("planner", "extractor", "synthesis") and summary.get("counts") != classes:
        refuse(source, "the summary's counts do not match its calls")
    usage = fixture_usage(calls)
    record = {"kind": kind, "finished": not interrupted, "version": 1, "sha256": hashlib.sha256(raw).hexdigest(), "conditions": conditions, "repeats": repeats,
              "manifest": kept, "classes": {condition: dict(sorted(counts.items())) for condition, counts in classes.items()}, "usageMissing": usage["usageMissing"],
              "cachedMissing": usage["cachedMissing"], "usage": {key: usage[key] for key in ("calls", "inputTokens", "outputTokens")}}
    if kind in ("planner", "extractor", "synthesis"):
        # The research protocol hash the run's request bodies were built under (researchProtocolSha256()).
        if not is_digest(summary.get("protocolSha256")):
            refuse(source, "the summary does not record its research protocol hash")
        record["protocolSha256"] = summary["protocolSha256"]
    if kind == "synthesis":
        # Its trials' outcomes, over the trials it recorded: a model synthesis, the host skeleton, or neither.
        record["outcomes"] = outcomes
        # The judge its replies were judged under (SYNTHESIS_JUDGE): the research tolerance policy's version. A summary written before the
        # field records none, and was judged under version 1, which refused a reply listing an evidence id not tagged for its question.
        judge = summary.get("judge")
        if judge is not None and (type(judge) is not str or not SYNTHESIS_JUDGE.fullmatch(judge)):
            refuse(source, "the summary's judge is not a research tolerance version")
        record["judge"] = judge
        # The tolerance's corrections on the accepted calls, by kind, summed from the calls and checked against the summary's own tally:
        # among them the replies the drops left with every question unresolved, which the E0 card's addendum to Amendment 7 counts apart.
        # A summary judged under version 1 records none, and rows as null.
        record["corrections"] = synthesis_corrections(summary, calls, source) if judge is not None else None
    if kind == "extractor":
        # The condition the research pipeline itself sends, which the run compares the others with.
        if summary.get("deployedCondition") not in EXTRACTOR_CONDITIONS:
            refuse(source, "the summary does not record its deployed condition")
        record["deployedCondition"] = summary["deployedCondition"]
    if kind == "judge":
        contract, activation = summary.get("replyContract"), summary.get("activationCondition")
        if not bounded_count(summary.get("promptVersion")) or not is_digest(summary.get("promptSha256")) or (contract, activation) not in (("legacy", "j1-legacy"), ("flash_next_v1", "j1-flash")) \
                or activation not in conditions:
            refuse(source, "the summary does not record the judge prompt, the reply contract and its activation cell")
        record.update(promptVersion=summary["promptVersion"], promptSha256=summary["promptSha256"], replyContract=contract, activationCondition=activation,
                      scores=judge_scores(summary, conditions, repeats, source))
        check_judge_scores(record["scores"], calls, kept, source)
    return {**e0_row_base(started, finished, source), "inputSha256": canonical_sha256({condition: requests[condition][digest] for condition in conditions}),
            "modelCalls": len(calls), "inputTokens": usage["inputTokens"] if usage["usageMissing"] == 0 else None,
            "outputTokens": usage["outputTokens"] if usage["usageMissing"] == 0 else None, "cachedTokens": usage["cachedTokens"] if usage["cachedMissing"] == 0 else None,
            **local_spend(), "terminalCause": "fixture_unfinished" if interrupted else "fixture_finished", "fixture": record}


def short_text(value) -> bool:
    """A string the writer checks but never copies (a reply's model name, a request id), or null."""
    return value is None or (isinstance(value, str) and len(value) <= 200)


def labelling_call(call, ordinal: int, source: str) -> dict:
    """One call record under the tool's own rules (scripts/judge-labeller.ts, LabellingSummarySchema): call i has kind CALL_KINDS[i];
    `usd` is a number or null, never a boolean: the fee when settled, at most its projection, 0 when rejected or not sent, null otherwise;
    `countedUsd` is what the cap counts (the fee, 0, the reservation, or at least the reservation outside the projection); a reply was
    answered 200; and only a reply has tokens or a reported cache write."""
    if not isinstance(call, dict) or set(call) != LABELLING_CALL_KEYS:
        refuse(source, "a call does not hold exactly the summary's call keys")
    status, state, kind, failure = call["httpStatus"], call["state"], call["kind"], call["failure"]
    if type(call["call"]) is not int or call["call"] != ordinal or not isinstance(kind, str) or kind != LABELLING_CALL_KINDS[ordinal - 1] \
            or not isinstance(state, str) or state not in LABELLING_STATES or not (failure is None or (isinstance(failure, str) and failure in LABELLING_FAILURES)) \
            or not (status is None or (isinstance(status, int) and not isinstance(status, bool) and 100 <= status <= 599)) \
            or not is_digest(call["bodySha256"]) or not isinstance(call["cacheWriteReported"], bool) \
            or not all(bounded_amount(call[key]) for key in ("projectedUsd", "countedUsd")) \
            or not all(bounded_count(call[key]) for key in ("maxOutputTokens", "bodyBytes", "elapsedMs") + LABELLING_TOKENS) \
            or not all(short_text(call[key]) for key in ("servedModel", "requestId")) \
            or not all(call[key] is None or (isinstance(call[key], str) and PROVIDER_CODE.fullmatch(call[key])) for key in ("errorType", "errorCode")):
        refuse(source, "a call's number, kind, state, codes, body, amounts or counts are not ones the summary admits")
    fee = call["usd"]
    counted, reserved = micro(call["countedUsd"]), micro(call["projectedUsd"])
    replied = state in ("settled", "outside_projection")
    # Zero is claimed only for a rejection whose status the provider does not bill, and for a request that never left.
    rules = {"settled": bounded_amount(fee) and micro(fee) == counted and counted <= reserved and status == 200,
             "rejected": bounded_amount(fee) and micro(fee) == 0 and counted == 0 and status in LABELLING_UNBILLED_STATUSES,
             "not_sent": bounded_amount(fee) and micro(fee) == 0 and counted == 0 and status is None,
             "unknown": fee is None and counted == reserved, "outside_projection": fee is None and counted >= reserved and status == 200}
    if not rules[state] or (not replied and (any(call[key] != 0 for key in LABELLING_TOKENS) or call["cacheWriteReported"])):
        refuse(source, f"the {state} call's usd, countedUsd, status or tokens break the summary's rules")
    return call


def labelling_claims(claims, source: str) -> dict:
    labels = claims.get("labelCounts") if isinstance(claims, dict) else None
    below = claims.get("belowMinimum") if isinstance(claims, dict) else None
    planted = claims.get("plantedRejected") if isinstance(claims, dict) else None
    if not isinstance(claims, dict) or set(claims) != LABELLING_CLAIMS_KEYS \
            or not all(bounded_count(claims[key]) for key in ("harvested", "planted", "minimumPerClass", "notesShortened")) \
            or not is_digest(claims["inputSha256"]) or not all(claims[key] is None or is_digest(claims[key]) for key in ("claimsSha256", "labelsSha256")) \
            or not (labels is None or (isinstance(labels, dict) and set(labels) == set(JUDGE_VERDICTS) and all(bounded_count(value) for value in labels.values()))) \
            or not (below is None or (isinstance(below, dict) and set(below) <= set(JUDGE_VERDICTS) and all(bounded_count(value) for value in below.values()))) \
            or not (isinstance(planted, dict) and set(planted) <= set(LABELLING_PLANT_REJECTIONS) and all(bounded_count(value) for value in planted.values())):
        refuse(source, "the summary's claims do not hold exactly their counts and hashes")
    return claims


def labelling_prices(prices, source: str) -> dict:
    long = prices.get("longContext") if isinstance(prices, dict) else None
    if not isinstance(prices, dict) or set(prices) != set(LABELLING_PRICE_KEYS) | {"longContext"} or not all(bounded_amount(prices[key]) for key in LABELLING_PRICE_KEYS) \
            or not isinstance(long, dict) or set(long) != set(LABELLING_PRICE_KEYS) | {"aboveTokens"} or not bounded_count(long["aboveTokens"]) \
            or not all(bounded_amount(long[key]) for key in LABELLING_PRICE_KEYS):
        refuse(source, "the summary's prices are not its rates and long-context rates")
    return prices


def labelling_row(args) -> dict:
    """Decision (5), in the shape agreed with lane S-e1 (recorded in the Implemented entry): the labelling summary, version 1."""
    source = "--labelling-file"
    # A labelling run rewrites its summary as interrupted before each request while it holds its lock; a held loop.lock is refused alike.
    directory = os.path.dirname(os.path.dirname(os.path.abspath(args.labelling_file)))
    while True:
        if os.path.lexists(os.path.join(directory, LABELLING_LOCK)):
            refuse(source, f"a labelling run holds {LABELLING_LOCK} above its run directory: row it once that run has ended (a lock a killed run left is removed by hand)")
        if os.path.dirname(directory) == directory:
            break
        directory = os.path.dirname(directory)
    raw, summary = read_producer_json(args.labelling_file, source)
    if set(summary) != LABELLING_KEYS:
        refuse(source, "the summary does not hold exactly the labelling summary's keys")
    if type(summary["version"]) is not int or summary["version"] != 1 or summary["kind"] != "e0_judge_labelling" or summary["protocol"] != "e0-judge-labelling-v1":
        refuse(source, "the summary is not a version 1 e0_judge_labelling summary under protocol e0-judge-labelling-v1")
    if summary["cloudModel"] not in LABELLING_MODELS or summary["cloudApi"] not in LABELLING_APIS:
        refuse(source, "the summary's cloudModel is not an approved labelling model, or its cloudApi is not a request shape")
    # The labeller's name, the reply's own model name and the run directory's name are checked, never copied; a served-model column
    # waits for its own entry (pull request #86).
    if not all(short_text(summary[key]) and summary[key] is not None for key in ("labeller", "run")) or not short_text(summary["servedModel"]):
        refuse(source, "the summary's labeller, run or servedModel is not a short string")
    if summary["outcome"] not in LABELLING_OUTCOMES or (summary["failure"] is not None and summary["failure"] not in LABELLING_FAILURES) \
            or (summary["secondRequest"] is not None and summary["secondRequest"] not in LABELLING_SECOND_REQUESTS):
        refuse(source, "the summary's outcome, failure or second request is not one of its codes")
    if summary["envelopeLine"] not in ENVELOPE_LINES or not is_digest(summary["instructionsSha256"]) \
            or not all(bounded_amount(summary[key]) for key in ("usd", "reservedUnknownUsd", "priorCountedUsd", "capUsd")) \
            or not all(bounded_count(summary[key]) for key in ("modelCalls", "rejectedDispatches", "unknownDispatches") + LABELLING_TOKENS):
        refuse(source, "the summary's envelope line, instructions digest, amounts or counts are not ones the summary admits")
    claims, prices = labelling_claims(summary["claims"], source), labelling_prices(summary["prices"], source)
    # The tool's outcome rules: a failed run has a failure and wrote nothing; a labelled one wrote its set, with no class below the minimum and no failure.
    written = all(claims[key] is not None for key in ("claimsSha256", "labelsSha256", "labelCounts"))
    if (summary["outcome"] == "failed" and (summary["failure"] is None or written or claims["belowMinimum"] is not None or claims["planted"] != 0)) \
            or (summary["outcome"] != "failed" and (not written or (summary["outcome"] == "labelled") != (claims["belowMinimum"] is None)
                                                    or (summary["outcome"] == "labelled" and summary["failure"] is not None))):
        refuse(source, "the summary's outcome, failure and written files do not agree")
    started = recorded_instant(summary["startedUtc"], source, "startedUtc")
    finished = recorded_instant(summary["finishedUtc"], source, "finishedUtc") if summary["finishedUtc"] is not None else None
    # An interim summary, rewritten before each request, carries the time of that rewrite, not an end.
    if summary["failure"] == "labeller_interrupted":
        finished = None
    if summary["outcome"] == "labelled" and finished is None:
        refuse(source, "a labelled outcome records when the tool finished")
    if not isinstance(summary["calls"], list) or len(summary["calls"]) > len(LABELLING_CALL_KINDS):
        refuse(source, "the summary's calls are not a list of at most two")
    calls = [labelling_call(call, ordinal, source) for ordinal, call in enumerate(summary["calls"], 1)]
    # The summary's totals must be its calls' sums; USD is compared in whole micro-USD.
    states = [call["state"] for call in calls]
    totals = {"modelCalls": len(calls), "rejectedDispatches": states.count("rejected") + states.count("not_sent"),
              "unknownDispatches": states.count("unknown") + states.count("outside_projection"), **{key: sum(call[key] for call in calls) for key in LABELLING_TOKENS}}
    unknown = [call for call in calls if LABELLING_STATES[call["state"]] == "unknown"]
    if any(summary[key] != value for key, value in totals.items()) or micro(summary["usd"]) != sum(micro(call["usd"] or 0) for call in calls) \
            or micro(summary["reservedUnknownUsd"]) != sum(micro(call["countedUsd"]) for call in unknown):
        refuse(source, "the summary's totals are not the sums of its calls")
    # HARN-27: a POST to a cloud model discloses its body, counted once per distinct body; a call not sent disclosed nothing.
    bodies = {}
    for call in calls:
        if call["state"] != "not_sent" and bodies.setdefault(call["bodySha256"], call["bodyBytes"]) != call["bodyBytes"]:
            refuse(source, "two calls record one body digest with different sizes")
    return {**e0_row_base(started, finished, source), "inputSha256": claims["inputSha256"], "cloudModel": summary["cloudModel"], "cloudApi": summary["cloudApi"],
            "modelCalls": len(calls), "failedDispatches": totals["rejectedDispatches"], "unknownDispatches": totals["unknownDispatches"],
            **{key: totals[key] for key in ("inputTokens", "outputTokens", "cachedTokens")},
            # 11.4's column holds reported cache writes; a reply that reported none had its writes assumed by the tool's fee, so the total is unknown.
            "cacheWriteTokens": totals["cacheWriteTokens"] if not any(call["state"] in ("settled", "outside_projection") and not call["cacheWriteReported"] for call in calls) else None,
            "usd": micro(summary["usd"]) / 1_000_000, "reservedUsd": sum(micro(call["projectedUsd"]) for call in calls) / 1_000_000,
            "pinnedUsd": micro(summary["reservedUnknownUsd"]) / 1_000_000,
            # 11.4's feeUsd is the settled fee, and null on a call that did not settle.
            "cloudCalls": [{"purpose": call["kind"], "status": LABELLING_STATES[call["state"]], "feeUsd": call["usd"] if call["state"] == "settled" else None,
                            "reservedUsd": call["projectedUsd"],
                            "bodyBytes": call["bodyBytes"]} for call in calls],
            "disclosedBytes": sum(bodies.values()), "terminalCause": summary["failure"] if summary["failure"] is not None else summary["outcome"],
            "labelling": {"version": 1, "sha256": hashlib.sha256(raw).hexdigest(), "outcome": summary["outcome"], "failure": summary["failure"],
                          "secondRequest": summary["secondRequest"], "envelopeLine": summary["envelopeLine"], "capUsd": summary["capUsd"],
                          "priorCountedUsd": summary["priorCountedUsd"], "instructionsSha256": summary["instructionsSha256"], "prices": prices,
                          "reasoningTokens": totals["reasoningTokens"],
                          # Calls whose cache-write tokens the tool assumed (the reply did not report them), so the fee charged the write rate.
                          "cacheWriteAssumed": sum(1 for call in calls if call["state"] in ("settled", "outside_projection") and not call["cacheWriteReported"]),
                          "claims": {key: claims[key] for key in sorted(LABELLING_CLAIMS_KEYS - {"inputSha256"})}}}


def check_e0_outcome(outcome, row: dict) -> None:
    """The outcome refusals of decisions (3) to (5), read from the row's own fields, so that a --supersedes copy repeats them."""
    if outcome is None:
        return
    probe, fixture, labelling = row.get("probe"), row.get("fixture"), row.get("labelling")
    if isinstance(probe, dict) and outcome == "accepted":
        if probe.get("finished") is not True:
            sys.exit("the probe run did not finish (probe.json has no finished_utc): --outcome accepted is refused")
        if probe.get("failed"):
            sys.exit(f"probes failed ({', '.join(sorted(probe['failed']))}): --outcome accepted is refused")
        if probe.get("transportFailures"):
            sys.exit(f"probe records show a transport failure ({', '.join(probe['transportFailures'])}): --outcome accepted is refused")
        if probe.get("assessed") is False:
            sys.exit("P10 has not been assessed: run pnpm probe:assess on probe.json first, or record another outcome")
        if probe.get("schemasProtocolMatch") is False:
            sys.exit("P10 was assessed under another research protocol than its export's: --outcome accepted is refused")
    if isinstance(fixture, dict) and fixture.get("finished") is False and outcome not in ("incomplete", "infra_invalid"):
        sys.exit("the fixture run did not finish (no summary.json, or one without finishedUtc): record --outcome incomplete or infra_invalid")
    if isinstance(labelling, dict) and outcome == "accepted" and labelling.get("outcome") != "labelled":
        sys.exit(f"the labelling ended {labelling.get('outcome')}, not labelled: --outcome accepted is refused")


if __name__ == "__main__":
    sys.exit(main())
