"""Bounded synthetic calibration; no gold inputs and no hosted detector.

Run with a pinned environment/configuration under macOS sandbox-exec. Results are
create-only. A failed worker is never restarted, and partial scans stay partial.
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
from pathlib import Path
import resource
import selectors
import signal
import subprocess
import sys
import time

from adapter import Detector, ScanError, canonical_sha, sha, union_receipt, validate_text

DETECTORS = ("rules", "opf", "presidio_local_en_zh")
MAX_RSS = 12 * 1024 ** 3
CASE_SECONDS = 300
PASS_SECONDS = 3600


def file_sha(path: Path) -> str:
    import hashlib
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def inventory_paths(roots: list[str], standalone: list[str]) -> list[Path]:
    files = {Path(path).absolute() for path in standalone}
    for name in roots:
        for path in Path(name).rglob("*"):
            if path.is_symlink():
                raise ScanError("runtime_symlink")
            if path.is_file() and path.suffix not in {".whl", ".gz", ".part"}:
                files.add(path.absolute())
    return sorted(files)


def load_inputs(path: Path, expected_sha: str) -> list[dict]:
    raw = path.read_bytes()
    if sha(raw) != expected_sha or len(raw) > 2 * 1024 ** 2:
        raise ScanError("input_binding")
    rows = [json.loads(line) for line in raw.splitlines()]
    if len(rows) != 60 or len({r["id"] for r in rows}) != 60:
        raise ScanError("input_count")
    if any(sum(r["language"] == lang for r in rows) != 20 for lang in ("en", "zh", "mixed")):
        raise ScanError("language_balance")
    for row in rows:
        if set(row) != {"schemaVersion", "id", "language", "text"} or row["schemaVersion"] != 1:
            raise ScanError("input_schema")
        validate_text(row["text"])
    return rows


def validate_freeze(path: Path, expected: str) -> dict:
    raw = path.read_bytes()
    if sha(raw) != expected:
        raise ScanError("freeze_binding")
    frozen = json.loads(raw)
    if frozen["limits"] != {"peakRssBytes": MAX_RSS, "caseSeconds": CASE_SECONDS,
                             "passSeconds": PASS_SECONDS, "threads": 4}:
        raise ScanError("limit_binding")
    actual = [str(path) for path in inventory_paths(frozen["roots"], frozen["standalone"])]
    if actual != [binding["path"] for binding in frozen["files"]]:
        raise ScanError("inventory_binding")
    for binding in frozen["files"]:
        if file_sha(Path(binding["path"])) != binding["sha256"]:
            raise ScanError("asset_binding")
    return frozen


def validate_worker_receipt(result: dict, item: dict, detector: str) -> None:
    if result.get("id") != item["id"] or result.get("inputSha256") != sha(item["text"].encode("utf-8")):
        raise ScanError("invalid_worker_receipt")
    if result.get("canAuthorizeDisclosure") is not False or result.get("detector") != detector:
        raise ScanError("invalid_worker_receipt")
    if type(result.get("complete")) is not bool or result.get("status") != ("complete" if result["complete"] else "incomplete"):
        raise ScanError("invalid_worker_receipt")
    peak = result.get("peakRssBytes")
    if type(peak) is not int or peak < 0:
        raise ScanError("invalid_worker_receipt")
    if peak > MAX_RSS:
        raise ScanError("rss_limit")
    if not result["complete"] and result.get("spans") != []:
        raise ScanError("invalid_worker_receipt")


def deny_python_network(event: str, args: tuple) -> None:
    if event in {"socket.connect", "socket.getaddrinfo", "socket.sendto", "socket.bind"}:
        raise ScanError("network_forbidden")


def worker(args: argparse.Namespace) -> int:
    # OS sandbox is the actual network boundary; this is an additional fast stop.
    sys.addaudithook(deny_python_network)
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            detector = Detector(args.detector, checkpoint=args.checkpoint, english_model=args.english_model,
                                chinese_model=args.chinese_model)
        for line in sys.stdin:
            item = json.loads(line)
            try:
                result = detector.scan(item["text"], item["language"])
                result["complete"] = True
            except ScanError as exc:
                result = {"detector": args.detector, "complete": False, "status": "incomplete",
                          "error": exc.code, "inputSha256": sha(item["text"].encode("utf-8")),
                          "spans": [], "canAuthorizeDisclosure": False}
            result["id"] = item["id"]
            result["peakRssBytes"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if sys.platform == "darwin" else 1024)
            print(json.dumps(result, ensure_ascii=False, separators=(",", ":")), flush=True)
        return 0
    except Exception:
        # No exception message or traceback (potential input, token, or file data).
        return 2


def incomplete(item: dict, detector: str, code: str) -> dict:
    return {"schemaVersion": 1, "id": item["id"], "detector": detector,
            "inputSha256": sha(item["text"].encode("utf-8")), "complete": False,
            "status": "incomplete", "error": code, "spans": [], "canAuthorizeDisclosure": False}


def run_backend(args, frozen: dict, items: list[dict], detector: str, deadline: float) -> list[dict]:
    if time.monotonic() >= deadline:
        return [incomplete(item, detector, "pass_deadline") for item in items]
    command = ["/usr/bin/sandbox-exec", "-p", "(version 1)(allow default)(deny network*)",
               sys.executable, "-u", str(Path(__file__).resolve()), "--worker", "--detector", detector,
               "--checkpoint", frozen["checkpoint"], "--english-model", frozen["englishModel"],
               "--chinese-model", frozen["chineseModel"]]
    env = {"PATH": "/usr/bin:/bin", "PYTHONPATH": frozen["opfSource"],
           "HF_HUB_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1", "DO_NOT_TRACK": "1",
           "TOKENIZERS_PARALLELISM": "false", "OMP_NUM_THREADS": "4", "MKL_NUM_THREADS": "4",
           "OPENBLAS_NUM_THREADS": "4", "TIKTOKEN_CACHE_DIR": frozen["tokenizerCache"],
           "VECLIB_MAXIMUM_THREADS": "4", "NUMEXPR_NUM_THREADS": "4",
           "PYTHONUNBUFFERED": "1", "PYTHONDONTWRITEBYTECODE": "1"}
    started = time.monotonic()
    rows, peak, failure = [], 0, None
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, env=env, start_new_session=True)
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    buffer = b""
    try:
        for ordinal, item in enumerate(items):
            if failure or time.monotonic() >= deadline:
                rows.append(incomplete(item, detector, failure or "pass_deadline"))
                continue
            case_started = time.monotonic()
            process.stdin.write((json.dumps(item, ensure_ascii=False) + "\n").encode("utf-8"))
            process.stdin.flush()
            while b"\n" not in buffer:
                if time.monotonic() >= min(deadline, case_started + CASE_SECONDS):
                    failure = "pass_deadline" if time.monotonic() >= deadline else "case_timeout"
                    break
                if process.poll() is not None:
                    failure = "worker_stopped"
                    break
                usage = subprocess.run(["/bin/ps", "-o", "rss=", "-p", str(process.pid)],
                                       capture_output=True, timeout=2, check=False)
                if usage.stdout.strip():
                    peak = max(peak, int(usage.stdout.strip()) * 1024)
                if peak > MAX_RSS:
                    failure = "rss_limit"
                    break
                if selector.select(timeout=0.2):
                    block = os.read(process.stdout.fileno(), 65536)
                    if not block:
                        failure = "worker_stopped"
                        break
                    buffer += block
                    if len(buffer) > 2 * 1024 ** 2:
                        failure = "worker_output_limit"
                        break
            if failure:
                rows.append(incomplete(item, detector, failure))
                continue
            line, buffer = buffer.split(b"\n", 1)
            result = None
            try:
                result = json.loads(line)
                validate_worker_receipt(result, item, detector)
            except Exception as exc:
                failure = exc.code if isinstance(exc, ScanError) else "invalid_worker_receipt"
                row = incomplete(item, detector, failure)
                if isinstance(result, dict) and type(result.get("peakRssBytes")) is int:
                    row["peakRssBytes"] = result["peakRssBytes"]
                rows.append(row)
                continue
            result["wallElapsedMs"] = round((time.monotonic() - case_started) * 1000, 3)
            result["observedPeakRssBytes"] = peak
            rows.append(result)
            print(json.dumps({"detector": detector, "completedOrdinal": ordinal + 1,
                              "complete": result["complete"]}), flush=True)
    finally:
        selector.close()
        if process.poll() is None:
            if not failure:
                process.stdin.close()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)
    elapsed = round((time.monotonic() - started) * 1000, 3)
    for row in rows:
        row["backendElapsedMs"] = elapsed
        row["backendObservedPeakRssBytes"] = peak
        row["workerExitCode"] = process.returncode
    return rows


def main(args) -> int:
    frozen = validate_freeze(Path(args.freeze), args.expected_freeze_sha256)
    items = load_inputs(Path(args.inputs), args.expected_input_sha256)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=False)
    (output / "claim.json").write_text(json.dumps({"freezeSha256": args.expected_freeze_sha256,
                                                "inputSha256": args.expected_input_sha256}) + "\n")
    all_rows = []
    started = time.monotonic()
    try:
        by_detector = {}
        for detector in DETECTORS:
            rows = run_backend(args, frozen, items, detector, started + PASS_SECONDS)
            for row in rows:
                row["runtimeFreezeSha256"] = args.expected_freeze_sha256
            by_detector[detector] = rows
            all_rows += rows
            with (output / f"{detector}.jsonl").open("x") as stream:
                for row in rows:
                    stream.write(json.dumps(row, ensure_ascii=False) + "\n")
        unions = []
        for item, opf, rules in zip(items, by_detector["opf"], by_detector["rules"]):
            try:
                row = union_receipt(item["text"], opf, rules)
                row.update({"id": item["id"], "complete": True})
            except ScanError:
                row = incomplete(item, "opf_plus_rules", "union_incomplete")
            row["runtimeFreezeSha256"] = args.expected_freeze_sha256
            unions.append(row)
        with (output / "opf_plus_rules.jsonl").open("x") as stream:
            for row in unions:
                stream.write(json.dumps(row, ensure_ascii=False) + "\n")
        all_rows += unions
        validate_freeze(Path(args.freeze), args.expected_freeze_sha256)
        preserved = file_sha(Path(args.inputs)) == args.expected_input_sha256
        summary = {"schemaVersion": 1, "freezeSha256": args.expected_freeze_sha256,
                   "inputSha256": args.expected_input_sha256, "bindingsPreserved": preserved,
                   "elapsedSeconds": round(time.monotonic() - started, 3),
                   "rows": len(all_rows), "complete": sum(r["complete"] for r in all_rows),
                   "canAuthorizeDisclosure": False, "confirmationGoldRead": False}
        (output / "runtime-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
        print(json.dumps(summary), flush=True)
        return 0 if preserved else 2
    finally:
        # Preserve partial evidence even when static revalidation or orchestration fails.
        (output / "partial-receipts.json").write_text(json.dumps(all_rows, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", action="store_true")
    parser.add_argument("--detector", choices=DETECTORS)
    parser.add_argument("--checkpoint")
    parser.add_argument("--english-model")
    parser.add_argument("--chinese-model")
    parser.add_argument("--freeze")
    parser.add_argument("--expected-freeze-sha256")
    parser.add_argument("--inputs")
    parser.add_argument("--expected-input-sha256")
    parser.add_argument("--output")
    parsed = parser.parse_args()
    try:
        sys.exit(worker(parsed) if parsed.worker else main(parsed))
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception:
        print(json.dumps({"status": "stopped", "error": "calibration_orchestration_failed"}), file=sys.stderr)
        sys.exit(2)
