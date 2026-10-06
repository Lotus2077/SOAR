#!/usr/bin/env python3
"""Emit one sanitized trial-registry row (docs/experiments/README.md) from a headless run.

    python3 scripts/registry-row.py --run-dir .soar/experiments/<batch>/runs/<run> \
        --id p0d-t1-website-heavy --batch phase0-discriminator --task t1-website \
        --family website --exposure exposed --arm local-heavy \
        --outcome rejected --critical-checks 26/30 --verdict-by agent_diagnostic \
        --lesson "..." >> docs/experiments/registry.jsonl

Counts come from the run's own state.sqlite and result.json. The row holds hashes,
counts and enums only: no paths, endpoints, prompts or outputs.
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
    for name in ("--run-dir", "--id", "--batch", "--task", "--family", "--exposure", "--arm", "--outcome", "--verdict-by", "--lesson"):
        parser.add_argument(name, required=True)
    parser.add_argument("--critical-checks", default=None, help="passed/total, e.g. 26/30")
    parser.add_argument("--owner-minutes", type=float, default=None)
    parser.add_argument("--interventions", type=int, default=0)
    args = parser.parse_args()
    if args.outcome not in OUTCOMES or args.exposure not in ("fresh", "exposed"):
        sys.exit("invalid --outcome or --exposure")

    result = json.load(open(os.path.join(args.run_dir, "result.json"), encoding="utf-8"))
    freeze = json.load(open(os.path.join(args.run_dir, "freeze.json"), encoding="utf-8"))
    db = sqlite3.connect(f"file:{os.path.join(args.run_dir, 'state.sqlite')}?mode=ro", uri=True)
    events = [json.loads(row[0]) for row in db.execute("select value from private_agent_events order by job_id, sequence")]
    db.close()
    finished = [event for event in events if event.get("type") == "model_finished"]
    usage = [event.get("usage", {}) for event in finished]
    started = datetime.datetime.fromisoformat(freeze["startedAt"].replace("Z", "+00:00"))
    ended = datetime.datetime.fromisoformat(result["finishedAt"].replace("Z", "+00:00"))
    dispatches = result.get("dispatches", [])
    row = {
        "id": args.id, "date": started.date().isoformat(),
        "git": subprocess.run(["git", "rev-parse", "--short=12", "HEAD"], capture_output=True, text=True).stdout.strip(),
        "batch": args.batch, "task": args.task, "taskJobSha256": freeze["taskBinding"]["jobSha256"],
        "family": args.family, "exposure": args.exposure, "arm": args.arm,
        "profile": freeze.get("profile", "standard"), "maxOutputTokens": freeze["modelConfig"]["maxOutputTokens"],
        "thinking": freeze["modelConfig"]["thinking"],
        "modelCalls": len(finished), "toolCalls": sum(1 for event in events if event.get("type") == "tool_finished"),
        "wallSeconds": round((ended - started).total_seconds(), 1),
        "inputTokens": sum(item.get("inputTokens", 0) for item in usage),
        "outputTokens": sum(item.get("outputTokens", 0) for item in usage),
        "lengthStops": sum(1 for event in finished if event.get("finishReason") == "length"),
        "usd": sum(item.get("feeMicrousd") or 0 for item in dispatches) / 1_000_000,
        "unknownDispatches": sum(1 for item in dispatches if item.get("status") in ("unknown", "committed")),
        # PR-C: attempts superseded by a retry and confirmed failures are resolved rows, never uncertain ones.
        "retriedDispatches": sum(1 for item in dispatches if item.get("status") == "superseded"),
        "failedDispatches": sum(1 for item in dispatches if item.get("status") == "failed"),
        "runStatus": result.get("status"), "terminalCause": result.get("reason"),
        "outcome": args.outcome, "criticalChecks": args.critical_checks, "verdictBy": args.verdict_by,
        "ownerMinutes": args.owner_minutes, "interventions": args.interventions, "lesson": args.lesson,
        # Research tasks: the host's entailment pass (PR-J2), counts only; a judge verdict is evidence, not acceptance.
        "entailment": next(({"counts": event.get("counts"), "entailmentCalls": event.get("entailmentCalls"), "truncated": event.get("truncated"),
            "supportRate": round(event["counts"]["supported"] / max(1, sum(event["counts"].values())), 3) if isinstance(event.get("counts"), dict) else None}
            for event in reversed(events) if event.get("type") == "claims_entailment"), None),
    }
    print(json.dumps(row, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
