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

H4: `--loop-dir LOOP` instead of `--run-dir` rows a select-and-repair loop (scripts/phase4-loop.ts): the per-run
counts of the loop's runs are summed with the same logic, status, cause and binding come from the selected run,
wall seconds from the loop's own clock, and a `loop` field records the choice.

Owner verdicts (BL-20261108-0904-owner-verdict-capture-design):

    `--verdict-file RECEIPT.json` rows a desktop task from the app's verdict receipt ("Export verdict receipt"). The
    receipt holds hashes, counts, enums and the verdict only; any other key is refused. It supplies the measurements,
    `arm`, `outcome`, `ownerMinutes`, `interventions`, `verdictAt` and `exportedThroughApp`; the operator types --id,
    --batch, --task, --family, --exposure, --lesson and --verdict-by owner.

    `--supersedes ROW_ID [--registry PATH]` copies the registry row with that id verbatim (every measurement,
    taskJobSha256, date, usd, entailment, loop) and changes only id, supersedes, outcome, verdictBy, ownerMinutes,
    interventions, lesson, verdictAt and git (the commit the row is written at). It refuses an unknown id, an id
    another row already supersedes, and a new id that already exists.

Exactly one of --run-dir, --loop-dir, --verdict-file and --supersedes is accepted. `--verdict-by` is `owner`,
`agent_diagnostic` or `none`; `owner` requires --owner-minutes and --interventions (the receipt supplies them).
"""

from __future__ import annotations

import argparse
import copy
import datetime
import json
import math
import os
import re
import sqlite3
import subprocess
import sys

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
        loop = json.load(open(os.path.join(args.loop_dir, "loop.json"), encoding="utf-8"))
        final = (loop.get("selected") or {}).get("final")
        if not final:
            sys.exit("the loop has no final selection")
        runs = [name for name in ("a", "b", "repair") if loop["candidates"].get(name)]
        counts = [run_counts(os.path.join(args.loop_dir, name)) for name in runs]
        selected = run_counts(os.path.join(args.loop_dir, final["candidate"]))
        started = datetime.datetime.fromisoformat(loop["startedAt"].replace("Z", "+00:00"))
        ended = datetime.datetime.fromisoformat(loop["finishedAt"].replace("Z", "+00:00"))
        summed = {key: sum(item[key] for item in counts) for key in SUMMED}
        # The critique is one model call with no run directory of its own: its usage and fee come from the tool's own record,
        # critique.json for a critique that answered and critique-failure.json for one that reached the model and was refused.
        critique = loop.get("critique") or {}
        critiqued = False
        for name in ("critique.json", "critique-failure.json"):
            record_path = os.path.join(args.loop_dir, "critique", name)
            if not os.path.exists(record_path):
                continue
            record = json.load(open(record_path, encoding="utf-8"))
            usage = record.get("usage") or {}
            if name == "critique.json":
                critiqued = True
            elif not usage:
                break
            summed["modelCalls"] += 1
            summed["usd"] += (record.get("feeMicrousd") or 0) / 1_000_000
            for key, field in (("inputTokens", "inputTokens"), ("outputTokens", "outputTokens"), ("cachedTokens", "cacheReadTokens"), ("cacheWriteTokens", "cacheWriteTokens")):
                summed[key] += int(usage.get(field) or 0)
            if record.get("finishReason") == "length":
                summed["lengthStops"] += 1
            break
        # Every sample's own ending stays in the committed record: the plan's harness-terminal rate is computed per sample from these, not from the selected run alone.
        candidates = {name: {"status": loop["candidates"][name].get("status"), "terminalCause": loop["candidates"][name].get("reason")} for name in runs}
        # The loop's span runs from its first start to its last end over every run and the loop record, so a resumed loop is not timed from its rerun.
        started = min([started] + [item["started"] for item in counts])
        ended = max([ended] + [item["ended"] for item in counts])
        extra = {"wallSeconds": round((ended - started).total_seconds(), 1),
                 "loop": {"version": loop["version"], "rule": loop["selectionRule"], "samples": len([n for n in runs if n != "repair"]), "repaired": "repair" in runs,
                          "seeded": loop.get("seeded"), "selected": final["candidate"], "step": final["step"], "stage1": (loop["selected"].get("stage1") or {}).get("candidate"),
                          "critiqued": critiqued, "critiqueFailure": critique.get("failure"), "candidates": candidates,
                          "writeIdentityEqual": loop.get("writeIdentityEqual")}}
        row = {**selected["row"], **summed, **extra}
        # Backlog item 11, part 3a: the selected run's class, with the loop's own interrupt mark for that stage. A loop whose critique failed
        # on infrastructure, leaving an unsubmitted draft it would have repaired, ended on infrastructure too.
        stages = loop.get("stages") if isinstance(loop.get("stages"), list) else []
        marked = any(isinstance(entry, dict) and entry.get("stage") == final["candidate"] and entry.get("interrupted") is True for entry in stages)
        row["runClass"] = classify_run_end(run_end_evidence(os.path.join(args.loop_dir, final["candidate"]), marked))
        critique_failure = critique.get("failure") if isinstance(critique, dict) else None
        if not row["runClass"]["infra"] and final.get("step") == "critique_failed" and row.get("runStatus") != "submitted" and listed(INFRA_CRITIQUE_CODES, critique_failure):
            row["runClass"] = {"version": RUN_CLASSIFICATION_VERSION, "infra": True, "cause": "critique_" + critique_failure}
        check_outcome(args.outcome, row.get("runStatus"), row["runClass"])
        # A cloud loop's cloud calls are sample a's stage; the selected run may be a local writer, and a may have no summary.
        if loop.get("arm") == "cloud":
            a_freeze = os.path.join(args.loop_dir, "a", "freeze.json")
            row.update(cloud_fields(json.load(open(a_freeze, encoding="utf-8")) if os.path.exists(a_freeze) else {}))
    elif args.run_dir is not None:
        single = run_counts(args.run_dir)
        row = {**single["row"], **{key: single[key] for key in SUMMED}, "wallSeconds": single["wallSeconds"]}
        row["runClass"] = classify_run_end(run_end_evidence(args.run_dir, False))
        check_outcome(args.outcome, row.get("runStatus"), row["runClass"])
    elif args.verdict_file is not None:
        row = receipt_row(args)
    else:
        row = superseding_row(args)
        # A correction repeats the class checks against the copied run's class, when the copy carries one.
        check_outcome(args.outcome, row.get("runStatus"), row.get("runClass"))
    row.update({"id": args.id, "git": subprocess.run(["git", "rev-parse", "--short=12", "HEAD"], capture_output=True, text=True).stdout.strip(),
                "verdictBy": args.verdict_by, "lesson": args.lesson})
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
    return (item.get("status") == "failed" and not is_assist(item) and isinstance(item.get("destinationId"), str) and item["destinationId"] in ZERO_FEE_DESTINATIONS
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
    result = json.load(open(os.path.join(run_dir, "result.json"), encoding="utf-8"))
    db = sqlite3.connect(f"file:{os.path.join(run_dir, 'state.sqlite')}?mode=ro", uri=True)
    events = [json.loads(row[0]) for row in db.execute("select value from private_agent_events order by job_id, sequence")]
    db.close()
    dispatches = [item for item in (result.get("dispatches") or []) if isinstance(item, dict)]
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
    """A copy of the row with the superseded id; the caller then sets only the verdict fields (and git, the writing commit)."""
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
    return row


def cloud_fields(freeze: dict) -> dict:
    """The cloud model and request shape a run's cloud arm was frozen with (BL-20261030-0620); null on local runs or when absent."""
    arm = freeze.get("arm")
    config = (arm.get("modelConfig") or {}) if isinstance(arm, dict) and arm.get("arm") == "cloud" else {}
    return {"cloudModel": config.get("model"), "cloudApi": config.get("api")}


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
    db = sqlite3.connect(f"file:{os.path.join(run_dir, 'state.sqlite')}?mode=ro", uri=True)
    events = [json.loads(row[0]) for row in db.execute("select value from private_agent_events order by job_id, sequence")]
    db.close()
    finished = [event for event in events if event.get("type") == "model_finished"]
    usage = [event.get("usage") or {} for event in finished]
    research = [event for event in events if event.get("type") == "research_stage"]
    started = datetime.datetime.fromisoformat(freeze["startedAt"].replace("Z", "+00:00"))
    ended = datetime.datetime.fromisoformat(result["finishedAt"].replace("Z", "+00:00"))
    dispatches = result.get("dispatches", [])
    return {
        "started": started, "ended": ended,
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
        },
        # H2b: the research stage's calls and tokens come from its content-free stage events, beside the write loop's model events.
        "modelCalls": len(finished) + sum(int(event.get("calls") or 0) for event in research),
        "toolCalls": sum(1 for event in events if event.get("type") == "tool_finished"),
        "wallSeconds": round((ended - started).total_seconds(), 1),
        "inputTokens": sum(item.get("inputTokens", 0) for item in usage) + sum(int((event.get("usage") or {}).get("inputTokens") or 0) for event in research),
        "outputTokens": sum(item.get("outputTokens", 0) for item in usage) + sum(int((event.get("usage") or {}).get("outputTokens") or 0) for event in research),
        # H1 (BL-20261022-0834): prompt tokens the provider reported as served from its cache; 0 when unreported.
        "cachedTokens": sum(item.get("cacheReadTokens") or 0 for item in usage) + sum(int((event.get("usage") or {}).get("cacheReadTokens") or 0) for event in research),
        # H1 completion: prompt tokens the provider reported as newly written to its cache (billed at the write rate); 0 when unreported.
        "cacheWriteTokens": sum(item.get("cacheWriteTokens") or 0 for item in usage) + sum(int((event.get("usage") or {}).get("cacheWriteTokens") or 0) for event in research),
        "lengthStops": sum(1 for event in finished if event.get("finishReason") == "length") + sum(int(event.get("truncatedReplies") or 0) for event in research),
        "usd": sum(item.get("feeMicrousd") or 0 for item in dispatches) / 1_000_000,
        "unknownDispatches": sum(1 for item in dispatches if item.get("status") == "committed" or (item.get("status") == "unknown" and not is_assist(item))),
        # PR-C: attempts superseded by a retry and confirmed failures are resolved rows, never uncertain ones.
        "retriedDispatches": sum(1 for item in dispatches if item.get("status") == "superseded"),
        "failedDispatches": sum(1 for item in dispatches if item.get("status") == "failed" and not is_assist(item)),
        "assistSkippedDispatches": sum(1 for item in dispatches if item.get("status") == "unknown" and is_assist(item)),
        "assistFailedDispatches": sum(1 for item in dispatches if item.get("status") == "failed" and is_assist(item)),
        # Backlog item 11: the part of failedDispatches that reserved and settled nothing, the rows the H4 loop admits.
        "zeroFeeFailedDispatches": sum(1 for item in dispatches if is_zero_fee_failed(item)),
    }


if __name__ == "__main__":
    sys.exit(main())
