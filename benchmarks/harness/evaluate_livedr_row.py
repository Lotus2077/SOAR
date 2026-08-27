#!/usr/bin/env python3
"""Run the pinned LiveDRBench category grader against one isolated oracle row."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


parser = argparse.ArgumentParser()
parser.add_argument("--evaluator-root", required=True)
parser.add_argument("--oracle", required=True)
parser.add_argument("--submission", required=True)
parser.add_argument("--judge", required=True)
args = parser.parse_args()

evaluator_src = Path(args.evaluator_root).resolve() / "src"
if not evaluator_src.is_dir():
    raise SystemExit(f"pinned evaluator source is absent: {evaluator_src}")
sys.path.insert(0, str(evaluator_src))

from evals import datasets_flights, entities, priorart, scifacts  # noqa: E402

oracle = json.loads(Path(args.oracle).read_text(encoding="utf-8"))
submission = json.loads(Path(args.submission).read_text(encoding="utf-8"))
row = oracle["row"]
predictions = submission.get("preds", submission) if isinstance(submission, dict) else submission
category = row.get("category", "")

if "OPENAI_API_KEY" not in os.environ:
    raise SystemExit("OPENAI_API_KEY is required by the official LiveDRBench judge")

try:
    ground_truths = json.loads(row["ground_truths"])
    evaluation_info = json.loads(row["misc"])["eval_info"]
except (KeyError, TypeError, json.JSONDecodeError) as error:
    raise SystemExit(f"could not decode pinned preview oracle: {error}") from error

if "scifacts-" in category:
    grade = scifacts.grade
elif "novel-datasets-" in category or category == "flights":
    grade = datasets_flights.grade
elif category == "prior-art":
    grade = priorart.grade
elif category == "entities":
    grade = entities.grade
else:
    raise SystemExit(f"unknown LiveDRBench category: {category}")

result = grade(
    judge_name=args.judge,
    key=row["key"],
    ground_truths=ground_truths,
    preds=predictions,
    eval_info=evaluation_info,
)
print(json.dumps(result))
