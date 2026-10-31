#!/usr/bin/env python3
"""Emit one sanitized trial-registry row (docs/experiments/README.md) from a headless run.

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
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import sqlite3
import subprocess
import sys

OUTCOMES = ("accepted", "rejected", "incomplete", "infra_invalid")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for name in ("--id", "--batch", "--task", "--family", "--exposure", "--arm", "--outcome", "--verdict-by", "--lesson"):
        parser.add_argument(name, required=True)
    parser.add_argument("--run-dir", default=None)
    parser.add_argument("--loop-dir", default=None, help="H4: a select-and-repair loop directory (loop.json) instead of one run")
    parser.add_argument("--critical-checks", default=None, help="passed/total, e.g. 26/30")
    parser.add_argument("--owner-minutes", type=float, default=None)
    parser.add_argument("--interventions", type=int, default=0)
    args = parser.parse_args()
    if args.outcome not in OUTCOMES or args.exposure not in ("fresh", "exposed"):
        sys.exit("invalid --outcome or --exposure")
    if (args.run_dir is None) == (args.loop_dir is None):
        sys.exit("give exactly one of --run-dir and --loop-dir")

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
        # A cloud loop's cloud calls are sample a's stage; the selected run may be a local writer, and a may have no summary.
        if loop.get("arm") == "cloud":
            a_freeze = os.path.join(args.loop_dir, "a", "freeze.json")
            row.update(cloud_fields(json.load(open(a_freeze, encoding="utf-8")) if os.path.exists(a_freeze) else {}))
    else:
        single = run_counts(args.run_dir)
        row = {**single["row"], **{key: single[key] for key in SUMMED}, "wallSeconds": single["wallSeconds"]}
    row.update({"id": args.id, "batch": args.batch, "task": args.task, "family": args.family, "exposure": args.exposure, "arm": args.arm,
                "git": subprocess.run(["git", "rev-parse", "--short=12", "HEAD"], capture_output=True, text=True).stdout.strip(),
                "outcome": args.outcome, "criticalChecks": args.critical_checks, "verdictBy": args.verdict_by,
                "ownerMinutes": args.owner_minutes, "interventions": args.interventions, "lesson": args.lesson})
    print(json.dumps(row, sort_keys=True))
    return 0


SUMMED = ("modelCalls", "toolCalls", "inputTokens", "outputTokens", "cachedTokens", "cacheWriteTokens", "lengthStops", "usd", "unknownDispatches", "retriedDispatches", "failedDispatches")


def cloud_fields(freeze: dict) -> dict:
    """The cloud model and request shape a run's cloud arm was frozen with (BL-20261030-0620); null on local runs or when absent."""
    arm = freeze.get("arm")
    config = (arm.get("modelConfig") or {}) if isinstance(arm, dict) and arm.get("arm") == "cloud" else {}
    return {"cloudModel": config.get("model"), "cloudApi": config.get("api")}


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
                "supportRate": round(event["counts"]["supported"] / max(1, sum(event["counts"].values())), 3) if isinstance(event.get("counts"), dict) else None}
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
        "lengthStops": sum(1 for event in finished if event.get("finishReason") == "length"),
        "usd": sum(item.get("feeMicrousd") or 0 for item in dispatches) / 1_000_000,
        "unknownDispatches": sum(1 for item in dispatches if item.get("status") in ("unknown", "committed")),
        # PR-C: attempts superseded by a retry and confirmed failures are resolved rows, never uncertain ones.
        "retriedDispatches": sum(1 for item in dispatches if item.get("status") == "superseded"),
        "failedDispatches": sum(1 for item in dispatches if item.get("status") == "failed"),
    }


if __name__ == "__main__":
    sys.exit(main())
