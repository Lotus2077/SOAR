#!/usr/bin/env python3
"""Prepare and dispatch E5 website jobs through the qualified weekly operator."""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


# Published v4 manifest. The wrapper delegates to v4 without changing its files or pins.
V4_MANIFEST = "c6710a2ffa158214eba5733ae43dce00bd36c69016654ecf6f637310417dccb9"
FORMATS = {
    "page": "Use passive HTML with no form controls.",
    "views": "Use same-document fragment links and CSS :target for the precomputed views, with no form controls.",
}
LABEL = "SOAR delivery format (technical instructions, separate from the source evidence):"


class Hold(Exception):
    """Safe status for the operator; messages never contain source or policy text."""


def sha(data):
    return hashlib.sha256(data).hexdigest()


def checked_package(folder):
    manifest = (folder / "verification.json").read_bytes()
    if sha(manifest) != V4_MANIFEST:
        raise Hold("unqualified_operator_package")
    verifier = folder / "verify_package.py"
    if sha(verifier.read_bytes()) != json.loads(manifest)["files"]["verify_package.py"]:
        raise Hold("unqualified_operator_verifier")
    check = subprocess.run([sys.executable, "-IB", str(verifier)], capture_output=True)
    if check.returncode:
        raise Hold("operator_package_hash_mismatch")


def prepared_candidate(candidate, mode):
    if candidate.get("family") != "website":
        raise Hold("website_candidate_required")
    if mode == "requires-active":
        raise Hold("website_requires_active_behavior")
    if mode not in FORMATS:
        raise Hold("unknown_website_format")
    if not isinstance(candidate.get("syntheticInput"), str) or not isinstance(candidate.get("need"), str):
        raise Hold("missing_website_source")
    source = candidate["syntheticInput"].strip()
    if not source or not candidate["need"].strip():
        raise Hold("missing_website_source")
    if LABEL in source:
        raise Hold("website_format_already_attached")
    note = (f"{LABEL}\nCopy this short technical instruction into the desktop brief or attachment: {FORMATS[mode]} "
            "Exclude inputs, buttons, selects and labels. Keep all requested behavior and ordering.")
    if mode == "views":
        note += (" Provide a default visible section and a fragment destination for every state. "
                 "Only the selected section should be visible. Tie breaking and totals must agree across views.")
    augmented = {**candidate, "syntheticInput": source + "\n\n" + note}
    # v4's author reads this exact combination after the native source/privacy checks.
    author_input = candidate["need"].strip() + "\n\n" + augmented["syntheticInput"] + "\n"
    if len(author_input.encode()) > 5500:
        raise Hold("website_source_exceeds_author_limit")
    return augmented


def prepare(package, args):
    candidate = json.loads(args.candidate.read_bytes())
    configured = prepared_candidate(candidate, args.mode)
    with tempfile.TemporaryDirectory(prefix="soar-website-intake-") as private:
        spec = Path(private) / "candidate.json"
        spec.write_text(json.dumps(configured, ensure_ascii=False), encoding="utf-8")
        return subprocess.run([sys.executable, "-IB", str(package / "live.py"), "prepare", str(spec),
                               str(args.original_text), str(args.policy), str(args.source_review)]).returncode


def format_reached_worker(candidate, material):
    source = candidate["syntheticInput"]
    if source.count(LABEL) != 1:
        return False
    note = source.split(LABEL)[1]
    words = " ".join(material.casefold().split())
    excludes_forms = any(term in words for term in (
        "no form controls", "without form controls", "avoid form controls", "exclude form controls",
        "do not use form controls", "no forms", "without forms", "form-free",
    ))
    if FORMATS["views"] in note:
        return excludes_forms and ":target" in words and "fragment" in words
    return FORMATS["page"] in note and excludes_forms


def desktop(package, root, equivalent=None, incompatible=None):
    # Use the installed operator's root validation, immutable writer and lifecycle gates.
    sys.path.insert(0, str(package))
    import weekly_live as v4

    try:
        root = v4.checked_root(root)
        v4.phase_gate(root)
    except v4.Hold:
        raise Hold("native_admission_held") from None
    op = root / "operator"
    candidate = v4.rec(op / "candidate.json")
    if candidate.get("family") != "website":
        raise Hold("website_candidate_required")
    # Do not race a running desktop, or produce a stop marker for a consumed position.
    with (v4.AREA / ".live-desktop.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Hold("shared_endpoint_busy") from None
        if v4.get_job(root).exists() or (op / "stock-launch.json").exists():
            raise Hold("desktop_attempt_not_fresh")
        freeze = (op / "proxy-intake-freeze.json").read_bytes()
        frozen = json.loads(freeze)
        if (equivalent or incompatible) and (equivalent or incompatible) != sha(freeze):
            raise Hold("format_review_freeze_changed")
        visible = []
        for name in ("brief.txt", "input.txt"):
            data = (root / "role" / "intake" / name).read_bytes()
            if sha(data) != frozen["files"][name]:
                raise Hold("frozen_intake_changed")
            visible.append(data.decode())
        if incompatible:
            v4.once(op / "desktop-stop.json", {"status": "stopped", "reason": "website_brief_omits_format",
                                               "intakeFreezeSha256": incompatible, "atUtc": v4.ops["when"]().isoformat()})
            raise Hold("website_brief_omits_format")
        if equivalent:
            v4.once(op / "website-format-review.json", {"status": "equivalent_passive_format",
                                                        "intakeFreezeSha256": equivalent})
        elif not format_reached_worker(candidate, "\n".join(visible)):
            raise Hold("website_format_needs_coordinator_review")
    return subprocess.run([sys.executable, "-IB", str(package / "live.py"), "desktop", str(root)]).returncode


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--package", type=Path, required=True)
    sub = p.add_subparsers(dest="phase", required=True)
    s = sub.add_parser("prepare")
    s.add_argument("mode", choices=[*FORMATS, "requires-active"])
    for field in ("candidate", "original_text", "policy", "source_review"):
        s.add_argument(field, type=Path)
    d = sub.add_parser("desktop")
    d.add_argument("job_root", type=Path)
    review = d.add_mutually_exclusive_group()
    review.add_argument("--equivalent", metavar="FROZEN_SHA256")
    review.add_argument("--incompatible", metavar="FROZEN_SHA256")
    args = p.parse_args()
    package = args.package.resolve(strict=True)
    checked_package(package)
    return prepare(package, args) if args.phase == "prepare" else desktop(package, args.job_root, args.equivalent, args.incompatible)


if __name__ == "__main__":
    os.umask(0o077)
    try:
        sys.exit(main())
    except Hold as exc:
        print(json.dumps({"status": "held", "reason": str(exc)}))
        sys.exit(2)
    except (OSError, ValueError, KeyError, TypeError):
        print('{"status":"held","reason":"missing_or_invalid_intake_evidence"}')
        sys.exit(2)
