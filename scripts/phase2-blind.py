#!/usr/bin/env python3
"""Make a blind verdict bundle for one Phase 2 task (design BL-20261007-1451).

    python3 scripts/phase2-blind.py --task-directory TASK --out BLIND_ROOT --keys KEY_ROOT \
        --run ARM=RUN_DIRECTORY [--run ARM=RUN_DIRECTORY ...]

For every run of the task (every arm and seed), the required artifacts, including the ones
the task's host-checked mode adds (claims ledger, document-review redline, clean copy, issues
list, hygiene report and edit plan), are copied byte for byte into BLIND_ROOT/<job id>/<label>/,
under random letter labels. Make repair pairs (H, L-prime) a bundle of their own. Nothing else goes in:
no freeze, result, model, arm or timing. The label-to-run key is written to
KEY_ROOT/<job id>.json, which must be outside BLIND_ROOT and outside Git. Its SHA-256 is
printed for the build log. An owner verdict sheet, verdicts.csv, lists the labels. Both
roots must be under the ignored .soar/. Refuses to overwrite anything; a failure leaves nothing.
"""

import argparse
import csv
import hashlib
import json
import os
import re
import secrets
import shutil
import sys
import tempfile

SAFE_ARTIFACT = re.compile(r"^(output|review)/[A-Za-z0-9._\- /]{1,230}$")
# The deliverables a host-checked mode adds at run time (src/main/private-agent/claims.ts and document-review.ts).
CLAIMS_ARTIFACTS = ("output/claims.json",)
DOCUMENT_REVIEW_ARTIFACTS = ("review/edits.json", "output/redline.docx", "output/clean.docx", "output/issues.xlsx", "output/hygiene.json")
SAFE_ARM = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    with open(path, "rb") as handle:
        return handle.read()


def fail(message):
    sys.exit("phase2-blind: " + message)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--task-directory", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--keys", required=True)
    parser.add_argument("--run", action="append", required=True, help="ARM=RUN_DIRECTORY, e.g. L-Heavy-1=.soar/.../runs/t1")
    args = parser.parse_args(argv)

    job_bytes = read(os.path.join(args.task_directory, "job.json"))
    brief_bytes = read(os.path.join(args.task_directory, "brief.md"))
    job = json.loads(job_bytes)
    job_id, required = job["jobId"], job["requiredArtifacts"]
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", job_id) or not required:
        fail("task job.json is not a prepared task")
    out_root, key_root = os.path.realpath(args.out), os.path.realpath(args.keys)
    if key_root == out_root or key_root.startswith(out_root + os.sep):
        fail("the key root must be outside the bundle root")
    if ".soar" not in out_root.split(os.sep) or ".soar" not in key_root.split(os.sep):
        fail("keep the bundle and key roots under the ignored .soar/ directory")
    runs = []
    for spec in args.run:
        arm, _, directory = spec.partition("=")
        if not SAFE_ARM.match(arm) or not directory:
            fail("--run takes ARM=RUN_DIRECTORY")
        freeze_bytes, result_bytes = read(os.path.join(directory, "freeze.json")), read(os.path.join(directory, "result.json"))
        freeze = json.loads(freeze_bytes)
        binding = freeze.get("taskBinding", {})
        if binding.get("jobSha256") != sha256(job_bytes) or binding.get("briefSha256") != sha256(brief_bytes):
            fail("run %s is not bound to this task" % arm)
        runs.append({"arm": arm, "directory": directory, "freezeSha256": sha256(freeze_bytes), "resultSha256": sha256(result_bytes),
                     "status": json.loads(result_bytes).get("status"), "mode": (freeze.get("claimsLedger") is True, freeze.get("documentReview") is True),
                     "repairOf": (freeze.get("repair") or {}).get("source", {}).get("freezeSha256")})
    if len({run["arm"] for run in runs}) != len(runs) or len(runs) > len(LETTERS):
        fail("arm names must be unique, at most %d runs" % len(LETTERS))
    if len({run["mode"] for run in runs}) != 1:
        fail("the runs of one task must share its host-checked mode")
    if any(run["repairOf"] in {other["freezeSha256"] for other in runs} for run in runs):
        fail("a repair and the draft it started from would share files; bundle repair pairs on their own")
    claims, review = runs[0]["mode"]
    artifacts = sorted(set(required) | (set(CLAIMS_ARTIFACTS) if claims else set()) | (set(DOCUMENT_REVIEW_ARTIFACTS) if review else set()))
    if any(not SAFE_ARTIFACT.match(path) or ".." in path.split("/") for path in artifacts):
        fail("task job.json is not a prepared task")

    bundle, key_path = os.path.join(out_root, job_id), os.path.join(key_root, job_id + ".json")
    if os.path.exists(bundle) or os.path.exists(key_path):
        fail("refusing to overwrite an existing bundle or key")
    labels = list(LETTERS[:len(runs)])
    secrets.SystemRandom().shuffle(labels)
    os.makedirs(out_root, mode=0o700, exist_ok=True)
    # Built aside and renamed into place, so a failure partway leaves nothing that blocks a re-run.
    staging = tempfile.mkdtemp(prefix="." + job_id + "-", dir=out_root)
    key = {"version": 1, "jobId": job_id, "taskJobSha256": sha256(job_bytes), "taskBriefSha256": sha256(brief_bytes), "artifacts": artifacts, "labels": {}}
    for label, run in sorted(zip(labels, runs)):
        files, missing = [], []
        os.makedirs(os.path.join(staging, label), mode=0o700)
        for path in artifacts:
            source = os.path.join(run["directory"], "candidate", path)
            if os.path.islink(source) or not os.path.isfile(source):
                missing.append(path)
                continue
            target = os.path.join(staging, label, path)
            os.makedirs(os.path.dirname(target), mode=0o700, exist_ok=True)
            shutil.copyfile(source, target)
            files.append({"path": path, "sha256": sha256(read(target))})
        if missing:
            with open(os.path.join(staging, label, "MISSING.txt"), "w", encoding="utf-8") as handle:
                handle.write("Required files this output does not contain:\n" + "".join("- %s\n" % path for path in missing))
        key["labels"][label] = {"arm": run["arm"], "freezeSha256": run["freezeSha256"], "resultSha256": run["resultSha256"],
                                "runStatus": run["status"], "files": files, "missing": missing}
    with open(os.path.join(staging, "verdicts.csv"), "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["label", "accepted (yes/no)", "notes", "arm guess"])
        for label in sorted(key["labels"]):
            writer.writerow([label, "", "", ""])
    os.makedirs(key_root, mode=0o700, exist_ok=True)
    key_bytes = (json.dumps(key, indent=1, sort_keys=True) + "\n").encode("utf-8")
    try:
        descriptor = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(key_bytes)
        os.rename(staging, bundle)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        if os.path.exists(key_path) and not os.path.exists(bundle):
            os.remove(key_path)
        raise
    print(json.dumps({"bundle": bundle, "labels": sorted(key["labels"]), "keySha256": sha256(key_bytes)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
