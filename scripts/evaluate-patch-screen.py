#!/usr/bin/env python3
"""Evaluate a frozen public-source patch; repository and oracle code run only in Docker."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import selectors
import signal
import subprocess
import tarfile
import time
import uuid


def evaluated_outcome(code, output, marker, expected_tests=None):
    """A successful import/exit is not proof that acceptance tests executed."""
    results = []
    for line in output.decode("utf-8", "replace").splitlines():
        if line.startswith(marker):
            try:
                value = json.loads(line[len(marker):])
                if isinstance(value, dict):
                    results.append(value)
            except (ValueError, TypeError):
                pass
    keys = ("passed", "testCount", "failures", "errors", "skipped")
    valid = len(results) == 1 and all(type(results[0].get(key)) is int and results[0][key] >= 0 for key in keys)
    if not valid:
        return {"exitCode": 1, "passed": 0, "testCount": 0, "harnessVerified": False,
                "failureKind": "candidate", "failureReason": "acceptance_did_not_complete"}
    result = {key: results[0][key] for key in keys}
    passed = (code == 0 and result["testCount"] > 0 and result["passed"] == result["testCount"]
              and result["failures"] == result["errors"] == result["skipped"] == 0
              and (expected_tests is None or result["testCount"] == expected_tests))
    return {**result, "exitCode": 0 if passed else 1, "harnessVerified": True,
            **({} if passed else {"failureKind": "candidate", "failureReason": "acceptance_failed"})}


class EvaluationInterrupted(RuntimeError):
    pass


CANCEL_REQUESTED = False


def interrupt_evaluation(_number, _frame):
    global CANCEL_REQUESTED
    CANCEL_REQUESTED = True


def bounded_command(argv, *, env, payload=None, timeout=45, check=True, interruptible=True):
    """Bound both execution and combined output of trusted Git/Docker clients."""
    process = subprocess.Popen(argv, stdin=subprocess.PIPE if payload is not None else subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env)
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    if payload is not None:
        os.set_blocking(process.stdin.fileno(), False)
        selector.register(process.stdin, selectors.EVENT_WRITE)
    output = bytearray()
    sent = 0
    deadline = time.monotonic() + timeout
    try:
        while selector.get_map():
            if interruptible and CANCEL_REQUESTED:
                raise EvaluationInterrupted("Evaluator interrupted before a complete receipt")
            if time.monotonic() >= deadline:
                raise TimeoutError("Evaluation client command timed out")
            for key, _ in selector.select(min(0.25, max(0, deadline - time.monotonic()))):
                if key.fileobj is process.stdin:
                    sent += os.write(process.stdin.fileno(), payload[sent:sent + 65536])
                    if sent == len(payload):
                        selector.unregister(process.stdin)
                        process.stdin.close()
                else:
                    part = os.read(process.stdout.fileno(), 65536)
                    if not part:
                        selector.unregister(process.stdout)
                    output.extend(part)
                    if len(output) > 4 * 1024 * 1024:
                        raise RuntimeError("Evaluation client output exceeded 4 MiB")
        code = process.wait(timeout=max(0.01, deadline - time.monotonic()))
        if check and code:
            raise RuntimeError("Evaluation client failed: " + bytes(output[-8192:]).decode("utf-8", "replace"))
        return code, bytes(output)
    finally:
        selector.close()
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)
        process.stdout.close()
        if process.stdin is not None and not process.stdin.closed:
            process.stdin.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ("source", "revision", "oracle", "oracle-sha256", "image"):
        parser.add_argument("--" + field, required=True)
    parser.add_argument("--patch")
    parser.add_argument("--expected-tests", type=int)
    parser.add_argument("--visible-command", help="Optional reference-only command, run after the oracle inside the sandbox")
    args = parser.parse_args()
    if args.expected_tests is not None and args.expected_tests <= 0:
        raise ValueError("Expected a positive frozen acceptance test count")
    signal.signal(signal.SIGTERM, interrupt_evaluation)
    signal.signal(signal.SIGINT, interrupt_evaluation)
    if not re.fullmatch(r"[a-f0-9]{40}|[a-f0-9]{64}", args.revision):
        raise ValueError("Expected an exact source commit")
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", args.image):
        raise ValueError("Expected an immutable Docker image digest")
    oracle = Path(args.oracle).read_bytes()
    if hashlib.sha256(oracle).hexdigest() != args.oracle_sha256:
        raise ValueError("Frozen oracle hash mismatch")
    if len(oracle) > 1024 * 1024:
        raise ValueError("Oracle exceeds 1 MiB")
    patch = Path(args.patch).read_bytes() if args.patch else None
    if patch is not None and len(patch) > 4 * 1024 * 1024:
        raise ValueError("Patch exceeds 4 MiB")
    source = Path(args.source).resolve()
    env = {key: os.environ[key] for key in ("PATH", "HOME", "DOCKER_CONTEXT", "DOCKER_HOST") if key in os.environ}
    env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL="/dev/null", GIT_TERMINAL_PROMPT="0")

    def run(argv, **kwargs):
        if kwargs.get("interruptible", True) and CANCEL_REQUESTED:
            raise EvaluationInterrupted("Evaluator interrupted before a complete receipt")
        return bounded_command(argv, env=env, **kwargs)

    git = ["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "protocol.allow=never", "-C", str(source)]
    _, head = run([*git, "rev-parse", "HEAD"])
    if head.decode().strip() != args.revision:
        raise ValueError("Source HEAD does not match frozen revision")
    _, tree = run([*git, "ls-tree", "-r", "-l", "-z", args.revision])
    archive = io.BytesIO()
    total = count = 0
    directories = set()
    with tarfile.open(fileobj=archive, mode="w") as output:
        for row in filter(None, tree.decode("utf-8").split("\0")):
            metadata, relative = row.split("\t", 1)
            mode, kind, oid, size = metadata.split()
            path = PurePosixPath(relative)
            if kind != "blob" or mode not in ("100644", "100755") or path.is_absolute() or any(x in ("..", ".", ".git") for x in path.parts):
                raise ValueError("Unsupported source entry")
            if any(x in relative for x in ("\\", "\r", "\n")):
                raise ValueError("Unsupported source path")
            size = int(size)
            total += size
            count += 1
            if size > 1048576 or total > 33554432 or count > 2000:
                raise ValueError("Source exceeds pilot size limits")
            for parent in reversed(path.parents):
                if str(parent) != "." and str(parent) not in directories:
                    info = tarfile.TarInfo(str(parent))
                    info.type, info.mode = tarfile.DIRTYPE, 0o755
                    output.addfile(info)
                    directories.add(str(parent))
            _, data = run([*git, "cat-file", "blob", oid])
            if len(data) != size:
                raise ValueError("Source blob size mismatch")
            info = tarfile.TarInfo(relative)
            info.size, info.mode = size, 0o755 if mode == "100755" else 0o644
            output.addfile(info, io.BytesIO(data))

    marker = "SOAR_EVALUATOR_RESULT_" + uuid.uuid4().hex + "="
    harness = ("import json,sys,types,unittest\n"
               "sys.path[:0]=['/workspace/src','/workspace']\n"
               "module=types.ModuleType('frozen_acceptance')\n"
               "sys.modules[module.__name__]=module\n"
               f"exec(compile({oracle.decode('utf-8')!r}, '<frozen_acceptance>', 'exec'), module.__dict__)\n"
               "suite=unittest.defaultTestLoader.loadTestsFromModule(module)\n"
               "result=unittest.TextTestRunner(stream=sys.stdout,verbosity=2).run(suite)\n"
               "failed_ids={getattr(test,'test_case',test).id() for test,_ in result.failures+result.errors}\n"
               "skipped_ids={getattr(test,'test_case',test).id() for test,_ in result.skipped}\n"
               "receipt={'passed':result.testsRun-len(failed_ids|skipped_ids),"
               "'testCount':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped)}\n"
               f"print({marker!r}+json.dumps(receipt),flush=True)\n"
               "raise SystemExit(0 if result.wasSuccessful() and result.testsRun and not result.skipped else 1)\n").encode()
    name = "soar-screen-eval-" + uuid.uuid4().hex[:16]
    started = time.monotonic()
    receipt = {"exitCode": 1, "passed": 0, "testCount": 0, "sourceRevision": args.revision,
               "sourceTreeSha256": hashlib.sha256(tree).hexdigest(), "sourceFiles": count, "sourceBytes": total,
               "oracleSha256": args.oracle_sha256, "patchSha256": hashlib.sha256(patch).hexdigest() if patch is not None else None,
               "image": args.image, "cleanupConfirmed": False, "harnessVerified": False}
    stage = "container_setup"
    create_confirmed = False
    def confirm_sandbox_running():
        # An unavailable Docker sandbox is not evidence of a candidate test failure.
        _, state = run(["docker", "inspect", "--format", "{{.State.Running}}", name], timeout=5)
        if state.strip() != b"true":
            raise RuntimeError("Evaluation sandbox is unavailable")

    try:
        run(["docker", "create", "--name", name, "--label", "soar.screen-evaluator=1", "--network", "none",
             "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "256m", "--cpus", "1",
             "--pids-limit", "64", "--read-only", "--tmpfs", "/workspace:rw,nosuid,nodev,size=64m",
             "--tmpfs", "/tmp:rw,nosuid,nodev,size=16m", args.image, "sleep", "150"], timeout=15, interruptible=False)
        create_confirmed = True
        run(["docker", "start", name])
        run(["docker", "exec", "-i", name, "tar", "--no-same-owner", "-xf", "-", "-C", "/workspace"], payload=archive.getvalue())
        if patch is not None:
            for suffix in (["--check", "-"], ["-"]):
                stage = "patch_application"
                code, output = run(["docker", "exec", "-i", "-w", "/workspace", name, "git", "-c", "core.hooksPath=/dev/null", "apply", *suffix], payload=patch, check=False)
                if code:
                    confirm_sandbox_running()
                    receipt.update(failureKind="candidate", failureReason="patch_did_not_apply")
                    break
        if "failureReason" not in receipt:
            stage = "acceptance"
            try:
                code, output = run(["docker", "exec", "-i", "-w", "/workspace", name, "python", "-I", "-B", "-"], payload=harness, timeout=90, check=False)
                print(output.decode("utf-8", "replace")[-32768:], end="")
                outcome = evaluated_outcome(code, output, marker, args.expected_tests)
                if code or not outcome["harnessVerified"]:
                    confirm_sandbox_running()
                receipt.update(outcome)
            except TimeoutError:
                receipt.update(failureKind="candidate", failureReason="acceptance_timeout")
        if args.visible_command:
            stage = "visible_reference_check"
            visible_code, visible_output = run(["docker", "exec", "-w", "/workspace", name, "bash", "-lc", args.visible_command], timeout=90, check=False)
            print(visible_output.decode("utf-8", "replace")[-32768:], end="")
            receipt["visibleExitCode"] = visible_code
            if visible_code:
                receipt["exitCode"] = 1
    except Exception as error:
        receipt.update(failureKind="infrastructure", failureReason="evaluator_infrastructure_failure", failureStage=stage)
        receipt["error"] = type(error).__name__
    finally:
        # Let bounded cleanup complete after the outer supervisor requests stop.
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        try:
            run(["docker", "rm", "-f", name], check=False, timeout=10, interruptible=False)
            _, remaining = run(["docker", "ps", "-a", "--filter", "name=^/" + name + "$", "--format", "{{.ID}}"], timeout=5, interruptible=False)
            # A timed-out create client could finish remotely after an empty listing.
            receipt["cleanupConfirmed"] = create_confirmed and not remaining.strip()
        except Exception as error:
            receipt["cleanupError"] = str(error)[:8192]
        if not receipt["cleanupConfirmed"]:
            receipt["exitCode"] = 1
            receipt["failureKind"] = "infrastructure"
        receipt["durationMs"] = round((time.monotonic() - started) * 1000)
    print(json.dumps(receipt, sort_keys=True))
    return receipt["exitCode"]


if __name__ == "__main__":
    raise SystemExit(main())
