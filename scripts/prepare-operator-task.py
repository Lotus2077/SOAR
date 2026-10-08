#!/usr/bin/env python3
"""Prepare a synthetic operator task directory for scripts/private-agent-local-screen.ts.

    python3 scripts/prepare-operator-task.py --out DIR --job-id ID --goal GOAL.txt \
        --input path/in/task=SOURCE_FILE:private --input other.txt=FILE:public \
        --artifact output/report.md [--capability NAME] [--criterion TEXT]

Writes DIR/job.json, DIR/brief.md and DIR/input/..., refuses to overwrite, and prints the
job and brief SHA-256 values the driver needs. Use it only for synthetic or public inputs;
never for personal or professional data. Keep task directories under the ignored .soar/.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys

SAFE_PATH = re.compile(r"^(?!/)(?!.*(?:^|/)\.\.?(?:/|$))[A-Za-z0-9._/-]{1,240}$")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--goal", required=True, help="UTF-8 file holding the task brief")
    parser.add_argument("--input", action="append", default=[], help="TASK_PATH=SOURCE:private|public")
    parser.add_argument("--artifact", action="append", required=True, help="required artifact under output/")
    parser.add_argument("--capability", action="append", default=[])
    parser.add_argument("--criterion", action="append", default=[], help="human acceptance criterion (metadata only)")
    args = parser.parse_args()

    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", args.job_id):
        sys.exit("invalid --job-id")
    if os.path.exists(args.out):
        sys.exit("refusing to overwrite an existing task directory")
    brief = open(args.goal, "rb").read()
    if len(brief) > 32768:
        sys.exit("brief exceeds 32 KiB")
    brief.decode("utf-8")
    inputs = []
    for spec in args.input:
        match = re.fullmatch(r"([^=]+)=(.+):(private|public)", spec)
        if not match or not SAFE_PATH.match(match.group(1)):
            sys.exit(f"invalid --input {spec!r}")
        data = open(match.group(2), "rb").read()
        inputs.append((match.group(1), data, match.group(3)))
    if not inputs:
        sys.exit("at least one input is required")
    for artifact in args.artifact:
        if not artifact.startswith("output/") or not SAFE_PATH.match(artifact):
            sys.exit(f"artifact must be a safe path under output/: {artifact!r}")

    job = {
        "schemaVersion": 1, "jobId": args.job_id, "goalFile": "brief.md",
        "inputs": [{"path": path, "sha256": sha256(data), "bytes": len(data), "confidentiality": kind} for path, data, kind in inputs],
        "requiredArtifacts": args.artifact, "requiredCapabilities": args.capability,
        "permissions": {"externalModelDisclosure": "none", "publicWeb": "none", "publish": False, "send": False, "mutateInputs": False},
        "verification": {"deterministic": "inputs preserved and required artifacts readable", "humanCriteria": args.criterion,
                         "runtimeAndPrivacyReceiptRequired": True},
        "labelIsMetadataOnly": True, "synthetic": True,
    }
    job_bytes = (json.dumps(job, indent=1, sort_keys=True) + "\n").encode("utf-8")
    os.makedirs(os.path.join(args.out, "input"), mode=0o700)
    for path, data, _ in inputs:
        target = os.path.join(args.out, "input", path)
        os.makedirs(os.path.dirname(target), mode=0o700, exist_ok=True)
        with open(target, "xb") as handle:
            handle.write(data)
    with open(os.path.join(args.out, "job.json"), "xb") as handle:
        handle.write(job_bytes)
    with open(os.path.join(args.out, "brief.md"), "xb") as handle:
        handle.write(brief)
    print(json.dumps({"taskDirectory": args.out, "jobSha256": sha256(job_bytes), "briefSha256": sha256(brief)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
