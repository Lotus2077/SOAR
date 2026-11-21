#!/usr/bin/env python3
"""Publish the pinned need, criteria and deliverables for a fresh E5 blind grader."""

import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import stat
import sys
import tempfile
from types import SimpleNamespace

scan = SimpleNamespace(**runpy.run_path(str(Path(__file__).with_name("e5-proxy-stage.py"))))


def admitted_path(value, roots):
    path = Path(value)
    scan.require(path.is_absolute() and ".." not in path.parts, "unsafe_location")
    if sys.platform == "darwin" and len(path.parts) > 1 and path.parts[1] in ("tmp", "var", "etc"):
        path = Path("/private", *path.parts[1:])
    candidates = [root for root in roots if root in path.parents]
    scan.require(candidates, "outside_material_roots")
    root = max(candidates, key=lambda item: len(item.parts))
    scan.require(not any(part.startswith(".") for part in path.relative_to(root).parts), "unsafe_entry")
    return path


def pinned_file(path, digest, terms, budget):
    scan.require(re.fullmatch(r"[a-f0-9]{64}", digest), "invalid_pin")
    # Walk by directory descriptor: a moved directory or a symlink cannot redirect the leaf open.
    directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    directory = os.open(path.anchor, directory_flags)
    try:
        for part in path.parts[1:-1]:
            child = os.open(part, directory_flags, dir_fd=directory)
            os.close(directory)
            directory = child
        selected = os.stat(path.name, dir_fd=directory, follow_symlinks=False)
        scan.require(stat.S_ISREG(selected.st_mode) and selected.st_nlink == 1, "unsafe_entry")
        desc = os.open(path.name, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW, dir_fd=directory)
    finally:
        os.close(directory)
    with os.fdopen(desc, "rb") as file:
        before = os.fstat(file.fileno())
        scan.require(os.path.samestat(selected, before) and stat.S_ISREG(before.st_mode)
                     and before.st_nlink == 1, "unsafe_entry")
        scan.require(before.st_size <= scan.MAX_FILE and before.st_size + budget[1] <= scan.MAX_TOTAL, "oversize")
        raw = file.read(before.st_size + 1)
        after = os.fstat(file.fileno())
        scan.require(len(raw) == before.st_size and after.st_ctime_ns == before.st_ctime_ns
                     and after.st_mtime_ns == before.st_mtime_ns, "source_changed")
    scan.require(hashlib.sha256(raw).hexdigest() == digest, "pin_mismatch")
    budget[1] += len(raw)
    ext = path.suffix.lower()
    scan.scan_text(path.name, terms)
    if ext in scan.TEXT:
        scan.scan_plain(raw, ext, terms)
    elif ext in scan.OFFICE:
        scan.scan_office(raw, ext, terms, budget)
    else:
        raise scan.Refusal("unsupported_file")
    return raw


def blind_copy(args, terms, roots):
    out = admitted_path(args.out, roots)
    parent = scan.canonical_dir(out.parent)
    info = parent.stat()
    scan.require(info.st_uid == os.getuid() and info.st_mode & 0o077 == 0
                 and not scan.has_git_root(parent), "unsafe_destination")
    scan.require(not os.path.lexists(out), "destination_exists")
    scan.require(len(args.deliverable) + 2 <= scan.MAX_ENTRIES, "oversize")
    budget = [0, 0, 0]
    files = {}
    seen = set()
    selections = [("need", args.need), ("criteria", args.criteria)]
    selections += [(f"deliverable-{i:02}", pair) for i, pair in enumerate(args.deliverable, 1)]
    for label, (value, digest) in selections:
        path = admitted_path(value, roots)
        scan.require(path not in seen and path != out and out not in path.parents, "invalid_selection")
        scan.require(path.parent != parent and path.parent not in parent.parents, "unsafe_destination")
        seen.add(path)
        if label in ("need", "criteria"):
            scan.require(path.suffix.lower() in (".txt", ".md"), "expected_text")
            name = label + ".txt"
        else:
            name = label + path.suffix.lower()
        raw = pinned_file(path, digest, terms, budget)
        scan.require(raw.strip(), "empty_file")
        files[name] = raw

    # Only verified bytes enter private scratch on the destination side. Role sources remain
    # read-only. The shared scanner checks and publishes the neutral representation as one unit.
    with tempfile.TemporaryDirectory(prefix=".e5-grader-", dir=parent) as selected:
        for name, raw in files.items():
            (Path(selected) / name).write_bytes(raw)
        return scan.stage(Path(selected), out, terms, roots)


def main():
    parser = scan.PrivateArguments(description=__doc__)
    for name in ("need", "criteria"):
        parser.add_argument("--" + name, nargs=2, required=True, metavar=("PATH", "SHA256"))
    parser.add_argument("--deliverable", action="append", nargs=2, required=True, metavar=("PATH", "SHA256"))
    parser.add_argument("--out", required=True, help="New grader folder outside input directories, within a private material root")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        print(json.dumps(blind_copy(args, *scan.read_policy()), sort_keys=True))
    except scan.Refusal as error:
        sys.exit(str(error))
    except KeyboardInterrupt:
        sys.exit("handoff_interrupted")
    except Exception:
        sys.exit("invalid_handoff")


if __name__ == "__main__":
    main()
