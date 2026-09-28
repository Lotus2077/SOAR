"""SOAR's private JSONL bridge to the pinned mini-swe-agent control loop.

Only the trusted worker contacts providers. Generated commands run in disposable
Docker containers with no network, host mounts, or inherited credentials.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import io
import json
import os
from pathlib import Path
import queue
import re
import shutil
import signal
import socket
import ssl
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parent
MAX_LINE = 4 * 1024 * 1024
MAX_OUTPUT = 48 * 1024
MAX_PATCH = 1024 * 1024
MAX_SOURCE_BYTES = 32 * 1024 * 1024
MAX_ARCHIVE = 96 * 1024 * 1024
SUBMIT = "SOAR_SUBMIT"
ROUTED_POLICIES = ("local_only", "local_first", "cloud_plan_local", "cloud_plan_local_review", "local_critic_repair")


class WorkerError(Exception):
    pass


class Cancelled(WorkerError):
    pass


class CommandTimeout(WorkerError):
    def __init__(self):
        super().__init__("container_command_timeout")
        self.result = {"output": "", "returncode": 124, "exception_info": "",
                       "outputTruncated": False, "timedOut": True}


def substantive_action_lines(command: str) -> list[str]:
    return [line.strip() for line in command.splitlines() if line.strip() and not line.lstrip().startswith("#")]


def canonical_json(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")


def verify_runtime() -> dict:
    lock = json.loads((ROOT / "runtime-lock.json").read_text())
    distribution = importlib.metadata.distribution(lock["distribution"])
    if distribution.version != lock["version"]:
        raise WorkerError("runtime_version_mismatch")
    for name, digest in lock["sourceHashes"].items():
        if hashlib.sha256(Path(distribution.locate_file(name)).read_bytes()).hexdigest() != digest:
            raise WorkerError("runtime_source_mismatch")
    return {"name": lock["distribution"], "version": lock["version"], "sourceVerified": True}


class Bridge:
    def __init__(self, source=None, sink=None):
        self.source = source or sys.stdin
        self.sink = sink or sys.stdout
        self.inbox: queue.Queue = queue.Queue()
        self.cancelled = threading.Event()
        self.output_lock = threading.Lock()
        self.run_id = ""
        self.sequence = 0
        self.secrets: list[str] = []
        self.deadline = float("inf")
        self.unsettled = False

    def start_reader(self):
        def read():
            while True:
                line = self.source.readline(MAX_LINE + 1)
                if not line:
                    self.cancelled.set()
                    self.inbox.put({"type": "cancel"})
                    return
                if len(line.encode("utf-8")) > MAX_LINE:
                    self.cancelled.set()
                    self.inbox.put({"type": "protocol.invalid"})
                    return
                try:
                    message = json.loads(line)
                    if not isinstance(message, dict):
                        raise ValueError()
                    if message.get("type") == "cancel":
                        self.cancelled.set()
                    self.inbox.put(message)
                except (ValueError, TypeError):
                    self.cancelled.set()
                    self.inbox.put({"type": "protocol.invalid"})
                    return
        threading.Thread(target=read, daemon=True).start()

    def check_cancelled(self):
        if self.cancelled.is_set():
            raise Cancelled("cancelled")
        if time.monotonic() >= self.deadline:
            raise WorkerError("run_deadline_exceeded")

    def emit(self, event_type: str, **values):
        with self.output_lock:
            self.sequence += 1
            event = {"type": event_type, "protocolVersion": 1, "runId": self.run_id,
                     "sequence": self.sequence, **values}
            encoded = canonical_json(event).decode("utf-8")
            # Exact outbound requests must never contain the worker's credential.
            if event_type == "request.prepare" and any(secret and secret in encoded for secret in self.secrets):
                raise WorkerError("credential_in_outbound_body")
            if event_type == "request.unsettled":
                self.unsettled = True
            for secret in self.secrets:
                if secret:
                    encoded = encoded.replace(secret, "[credential redacted]")
            self.sink.write(encoded + "\n")
            self.sink.flush()

    def receive(self, timeout=120):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.check_cancelled()
            try:
                return self.inbox.get(timeout=min(0.1, max(0.01, deadline - time.monotonic())))
            except queue.Empty:
                pass
        raise WorkerError("controller_timeout")

    def admit(self, request_id: str, digest: str):
        message = self.receive()
        self.check_cancelled()
        if message.get("requestId") != request_id:
            raise WorkerError("admission_request_mismatch")
        if message.get("type") != "request.admitted":
            raise WorkerError("request_denied")
        if message.get("bodySha256") != digest:
            raise WorkerError("admission_body_mismatch")
        self.check_cancelled()


class ArtifactRecoveryBridge:
    """A bounded, event-only bridge: no provider admission or generated actions."""
    def __init__(self, parent: Bridge):
        self.parent = parent
        self.deadline = self.recovery_deadline = time.monotonic() + 20

    def check_cancelled(self):
        if time.monotonic() >= self.deadline:
            raise WorkerError("artifact_recovery_timeout")

    def emit(self, event_type: str, **values):
        if event_type not in ("container.created", "container.removed", "patch.recovered"):
            raise WorkerError("artifact_recovery_event_denied")
        self.parent.emit(event_type, **values)


def bounded_int(value, default, minimum, maximum):
    if value is None:
        return default
    if not isinstance(value, int) or isinstance(value, bool) or not minimum <= value <= maximum:
        raise WorkerError("invalid_limit")
    return value


def validate_start(start: dict) -> dict:
    if start.get("type") != "start" or start.get("mode") not in ("scripted", "live"):
        raise WorkerError("invalid_start")
    if start.get("policy") not in ("cloud", "prepared_cloud", "hybrid", *ROUTED_POLICIES):
        raise WorkerError("invalid_policy")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", str(start.get("runId", ""))):
        raise WorkerError("invalid_run_id")
    for field in ("workspace", "containerImage", "objective", "visibleTestCommand", "baseRevision"):
        if not isinstance(start.get(field), str) or not start[field].strip():
            raise WorkerError("missing_" + field)
    if len(start["objective"]) > 32768 or len(start["visibleTestCommand"]) > 4096:
        raise WorkerError("oversized_start")
    image = start["containerImage"]
    if len(image) > 256 or image.startswith("-") or not re.fullmatch(r"[A-Za-z0-9._/:@-]+", image):
        raise WorkerError("invalid_container_image")
    workspace = Path(start["workspace"])
    if not workspace.is_absolute() or not workspace.is_dir() or workspace.is_symlink():
        raise WorkerError("invalid_workspace_copy")
    # The caller passes a disposable copy; never accept a repository gitfile
    # pointing out to the user's real worktree metadata.
    if (workspace / ".git").is_file() or (workspace / ".git").is_symlink():
        raise WorkerError("workspace_is_linked_worktree")
    limits = start.get("limits", {})
    local = limits.get("localCoding", {})
    if not isinstance(local, dict):
        raise WorkerError("invalid_local_coding_limits")
    thinking = local.get("thinking", "disabled")
    if not isinstance(thinking, str) or thinking not in ("disabled", "medium"):
        raise WorkerError("invalid_local_thinking_profile")
    if thinking == "medium" and start["policy"] != "local_only":
        raise WorkerError("invalid_local_thinking_policy")
    check_schedule = local.get("checkSchedule", "final_only")
    if not isinstance(check_schedule, str) or check_schedule not in ("final_only", "repair_window", "host_repair_window"):
        raise WorkerError("invalid_local_check_schedule")
    if check_schedule == "repair_window" and start["policy"] != "local_only":
        raise WorkerError("invalid_local_check_schedule_policy")
    if check_schedule == "host_repair_window" and start["policy"] not in ROUTED_POLICIES:
        raise WorkerError("invalid_local_check_schedule_policy")
    critic_policy = start["policy"] == "local_critic_repair"
    if critic_policy and (start["mode"] != "live" or check_schedule != "final_only" or thinking != "disabled"):
        raise WorkerError("invalid_critic_profile")
    planner_mode = limits.get("plannerMode", "plan")
    if planner_mode not in ("plan", "plan_and_checks") or not isinstance(planner_mode, str):
        raise WorkerError("invalid_planner_mode")
    if planner_mode == "plan_and_checks" and (start["mode"] != "live" or
            start["policy"] not in ("cloud_plan_local", "cloud_plan_local_review") or
            check_schedule != "host_repair_window"):
        raise WorkerError("invalid_planner_checks_profile")
    start["limits"] = {
        "stepLimit": bounded_int(limits.get("stepLimit"), 60, 1, 120),
        "wallTimeSeconds": bounded_int(limits.get("wallTimeSeconds"), 1200, 1, 3600),
        "commandTimeoutSeconds": bounded_int(limits.get("commandTimeoutSeconds"), 30, 1, 300),
        "visibleCheckTimeoutSeconds": bounded_int(limits.get("visibleCheckTimeoutSeconds"), 60, 1, 60),
        "requestTimeoutSeconds": bounded_int(limits.get("requestTimeoutSeconds"), 120, 1, 300),
        "maxOutputTokens": bounded_int(limits.get("maxOutputTokens"), 4096, 128, 16384),
        "maxInputBytes": bounded_int(limits.get("maxInputBytes"), 512000, 1024, 2000000),
    }
    if start["policy"] in ROUTED_POLICIES:
        if "localStepLimit" in limits and limits["localStepLimit"] is None:
            raise WorkerError("invalid_limit")
        local_call_limit = bounded_int(limits.get("localStepLimit"), 12 if critic_policy else 24, 2, 24)
        if critic_policy and (local_call_limit != 12 or start["limits"]["stepLimit"] != 13):
            raise WorkerError("invalid_critic_call_limits")
        if local_call_limit != 24 and start["policy"] not in ("local_only", "local_critic_repair"):
            raise WorkerError("invalid_local_call_limit_policy")
        if local_call_limit < 24:
            local_call_limit = min(local_call_limit, start["limits"]["stepLimit"])
            if local_call_limit < 2:
                raise WorkerError("invalid_local_finishing_budget")
        if check_schedule in ("repair_window", "host_repair_window") and (local_call_limit < 5 or start["limits"]["stepLimit"] < local_call_limit):
            raise WorkerError("invalid_local_check_schedule_budget")
        start["limits"].update(
            stepLimit=13 if critic_policy else min(start["limits"]["stepLimit"], local_call_limit if local_call_limit < 24 else 40),
            wallTimeSeconds=min(start["limits"]["wallTimeSeconds"], 600),
            localStepLimit=local_call_limit,
            finishingReserve=bounded_int(limits.get("finishingReserve"), 2, 2, 2),
            visibleCheckTimeoutSeconds=bounded_int(limits.get("visibleCheckTimeoutSeconds"), 60, 1, 60),
            localCoding={"maxOutputTokens":bounded_int(local.get("maxOutputTokens"), 8192, 128, 8192),
                         "maxInputBytes":bounded_int(local.get("maxInputBytes"), 256000, 1024, 256000),
                         "thinking": thinking, "checkSchedule": check_schedule})
        if planner_mode == "plan_and_checks":
            start["limits"]["plannerMode"] = planner_mode
        if critic_policy:
            start["limits"].update(
                draftLocalStepLimit=bounded_int(limits.get("draftLocalStepLimit"), 8, 8, 8),
                repairLocalStepLimit=bounded_int(limits.get("repairLocalStepLimit"), 4, 4, 4))
    if start["mode"] == "scripted":
        actions = start.get("scriptedActions")
        if not isinstance(actions, list) or not 1 <= len(actions) <= 60 or any(not isinstance(a, str) or len(a) > 32768 for a in actions):
            raise WorkerError("invalid_scripted_actions")
    else:
        providers = start.get("providers", {})
        roles = (("local",) if start["policy"] == "local_only" else
                 ("cloud", "local") if start["policy"] in ("hybrid", "local_first", "cloud_plan_local", "cloud_plan_local_review", "local_critic_repair") else ("cloud",))
        for role in roles:
            provider = providers.get(role, {})
            if provider.get("protocol") not in ("openai", "anthropic"):
                raise WorkerError("invalid_provider_protocol")
            parsed = urllib.parse.urlsplit(str(provider.get("endpoint", "")))
            if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or parsed.password or parsed.fragment or parsed.query:
                raise WorkerError("invalid_provider_endpoint")
            if parsed.scheme != "https" and not provider.get("allowInsecureHttp", False):
                raise WorkerError("insecure_provider_endpoint")
            if not isinstance(provider.get("model"), str) or not provider["model"]:
                raise WorkerError("invalid_provider_model")
            if provider.get("apiKey") is not None and not isinstance(provider["apiKey"], str):
                raise WorkerError("invalid_provider_credential")
            if critic_policy and role == "cloud" and (provider["protocol"] != "openai" or
                    provider.get("maxOutputTokens", start["limits"]["maxOutputTokens"]) != 8192):
                raise WorkerError("invalid_critic_provider_profile")
            for field, low, high in (("maxOutputTokens", 128, 16384), ("maxInputBytes", 1024, 2000000)):
                if field in provider:
                    provider[field] = bounded_int(provider[field], start["limits"][field], low, high)
    return start


class DockerSession:
    """Execute through Docker CLI; never execute a generated command on the host."""
    def __init__(self, bridge: Bridge, start: dict):
        self.bridge, self.start = bridge, start
        self.name = "soar-patch-" + uuid.uuid4().hex
        self.container_id = None
        self.baseline = ""
        self.phase = "cloud"
        self.readonly = False
        self.timeout_recoveries = 0
        self.pending_candidate = None
        self.recovery_staging = None
        self.config = {}
        self.staging = tempfile.TemporaryDirectory(prefix="soar-patch-copy-")

    def host_command(self, args: list[str], *, timeout=60, check=True, allow_cancel=True,
                     output_limit=MAX_OUTPUT, binary=False, stdin_data=None) -> dict:
        recovery_deadline = getattr(self.bridge, "recovery_deadline", None)
        if recovery_deadline is not None:
            self.bridge.check_cancelled()
            timeout = min(timeout, recovery_deadline - time.monotonic())
        if allow_cancel:
            self.bridge.check_cancelled()
            timeout = min(timeout, max(0.01, self.bridge.deadline - time.monotonic()))
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   stdin=subprocess.PIPE if stdin_data is not None else subprocess.DEVNULL,
                                   start_new_session=True, env={"PATH": os.environ.get("PATH", ""),
                                   "HOME": os.environ.get("HOME", ""), "DOCKER_CONFIG": os.environ.get("DOCKER_CONFIG", "")})
        output = bytearray()
        truncated = threading.Event()
        def drain():
            while True:
                data = process.stdout.read(8192)
                if not data:
                    return
                remaining = max(0, output_limit - len(output))
                output.extend(data[:remaining])
                if len(data) > remaining:
                    truncated.set()
        reader = threading.Thread(target=drain, daemon=True)
        reader.start()
        def feed():
            try:
                process.stdin.write(stdin_data)
                process.stdin.flush()
            except (BrokenPipeError, OSError):
                pass
            finally:
                process.stdin.close()
        sender = None
        if stdin_data is not None:
            sender = threading.Thread(target=feed, daemon=True)
            sender.start()
        deadline = time.monotonic() + timeout
        try:
            while process.poll() is None:
                if allow_cancel:
                    self.bridge.check_cancelled()
                if time.monotonic() >= deadline:
                    raise CommandTimeout()
                time.sleep(0.03)
        except BaseException as error:
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            process.wait(timeout=5)
            reader.join(timeout=5)
            if sender:
                sender.join(timeout=5)
            if not reader.is_alive():
                process.stdout.close()
            if isinstance(error, CommandTimeout):
                value = bytes(output) if binary else output.decode("utf-8", errors="replace")
                if truncated.is_set() and not binary:
                    value += "\n[output truncated by SOAR]"
                error.result.update(output=value, outputTruncated=truncated.is_set())
            raise
        reader.join(timeout=5)
        if sender:
            sender.join(timeout=5)
        if reader.is_alive():
            raise WorkerError("container_output_drain_failed")
        process.stdout.close()
        value = bytes(output) if binary else output.decode("utf-8", errors="replace")
        if truncated.is_set() and not binary:
            value += "\n[output truncated by SOAR]"
        result = {"output": value, "returncode": process.returncode,
                  "exception_info": "", "outputTruncated": truncated.is_set()}
        if check and process.returncode:
            raise WorkerError("container_command_failed")
        return result

    def setup(self):
        source = Path(self.start["workspace"])
        staging = Path(self.staging.name) / "source"
        def ignore(directory, names):
            return [name for name in names if name in (".git", ".env", "node_modules", "__pycache__", ".venv") or name.startswith(".env.")]
        for path in source.rglob("*"):
            if path.is_symlink():
                raise WorkerError("source_symlink_not_supported")
        shutil.copytree(source, staging, symlinks=True, ignore=ignore)
        self.host_command(["docker", "image", "inspect", self.start["containerImage"]], timeout=15)
        result = self.host_command(["docker", "create", "--name", self.name, "--network", "none",
                                   "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                                   "--pids-limit", "256", "--memory", "4g", "--cpus", "2",
                                   "--workdir", "/workspace", "--label", "soar.patch-worker=1",
                                   "--label", "soar.run-id=" + self.start["runId"],
                                   self.start["containerImage"], "sleep", "3600"])
        self.container_id = result["output"].strip()
        if not re.fullmatch(r"[a-f0-9]{12,64}", self.container_id):
            raise WorkerError("invalid_container_identity")
        self.bridge.emit("container.created", containerId=self.container_id)
        self.import_tree(staging)
        self.host_command(["docker", "start", self.container_id])
        self.raw("git init -q && git -c core.hooksPath=/dev/null -c core.fsmonitor=false add -f -A && git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c user.name=SOAR -c user.email=soar@invalid commit -q --allow-empty -m baseline")
        self.baseline = self.raw("git rev-parse HEAD")["output"].strip()
        if not re.fullmatch(r"[a-f0-9]{40,64}", self.baseline):
            raise WorkerError("invalid_container_baseline")

    def raw(self, command: str, timeout=None, check=True, output_limit=MAX_OUTPUT) -> dict:
        self.bridge.check_cancelled()
        return self.host_command(["docker", "exec", "--workdir", "/workspace", self.container_id,
                                  "env", "-i", "PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/tmp",
                                  "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null",
                                  "bash", "--noprofile", "--norc", "-c", command],
                                 timeout=timeout or self.start["limits"]["commandTimeoutSeconds"], check=check,
                                 output_limit=output_limit)

    def execute(self, action: dict, cwd="", **kwargs) -> dict:
        from minisweagent.exceptions import Submitted
        command = action.get("command", "")
        if not isinstance(command, str) or not command or len(command) > 32768:
            raise WorkerError("invalid_action")
        # Only comments and blank lines may surround the control action. Never
        # discard other shell commands merely because this marker is present.
        if substantive_action_lines(command) == [SUBMIT]:
            raise Submitted({"role": "exit", "content": "Submitted", "extra": {"exit_status": "Submitted", "submission": "host_extracts_patch"}})
        if self.readonly:
            # A read-only scout never gets arbitrary shell; all reads are a
            # fixed host command with argv parsed and quoted by us.
            command = readonly_command(command)
        self.bridge.emit("command.started", phase=self.phase, command=command)
        try:
            result = self.raw(command, check=False)
        except CommandTimeout as error:
            result = error.result
            result["output"] += "\n[SOAR: command timed out. The command did not complete.]"
            self.bridge.emit("command.finished", phase=self.phase, command=command, **result)
            if self.readonly:
                raise
            self.bridge.check_cancelled()
            if self.timeout_recoveries >= 2:
                raise WorkerError("command_timeout_recovery_limit")
            self.timeout_recoveries += 1
            # Killing docker-exec does not kill its descendants. Stop the whole
            # container and rebuild from the pinned original, preserving source
            # only. No timed-out command is automatically rerun.
            self.recovery_staging = tempfile.TemporaryDirectory(prefix="soar-timeout-recovery-")
            candidate = Path(self.recovery_staging.name) / "source"
            self.capture_stopped_candidate(candidate)
            # Keep this safe host snapshot until reconstruction succeeds. A
            # cancellation during fresh setup must not delete the only edits.
            self.pending_candidate = candidate
            self.cleanup(discard_pending=False)
            self.staging = tempfile.TemporaryDirectory(prefix="soar-patch-copy-")
            self.name = "soar-patch-" + uuid.uuid4().hex
            self.setup()
            self.install_candidate(candidate)
            patch = self.patch()
            if patch.strip():
                self.bridge.emit("patch.recovered", patch=patch,
                                 baseRevision=self.start["baseRevision"],
                                 sha256=hashlib.sha256(patch.encode("utf-8")).hexdigest())
            self.discard_pending_candidate()
            self.bridge.emit("command.recovered", count=self.timeout_recoveries)
            result["output"] += ("\nSOAR recovered the source edits in a fresh isolated container. "
                                 "The previous container and its processes were removed. Shell state, /tmp, "
                                 "and changes outside the source tree were discarded. Inspect the timeout "
                                 "output and repair or narrow the check before continuing. "
                                 "This is unfinished work, not a submission or a passed check.")
            return result
        self.bridge.emit("command.finished", phase=self.phase, command=command, **result)
        return result

    def patch(self) -> str:
        self.raw("git -c core.hooksPath=/dev/null -c core.fsmonitor=false add -N -f -- .")
        result = self.raw("git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.attributesFile=/dev/null diff --no-ext-diff --no-textconv --binary " + self.baseline,
                          output_limit=MAX_PATCH)
        patch = result["output"]
        if result["outputTruncated"] or len(patch.encode("utf-8")) > MAX_PATCH:
            raise WorkerError("patch_too_large")
        return patch

    def capture_stopped_candidate(self, destination: Path):
        # Stop every agent-created process before capturing the candidate. Never
        # trust its .git; reconstruct the diff from an original snapshot later.
        self.host_command(["docker", "stop", "--time", "1", self.container_id], timeout=15)
        stopped = self.host_command(["docker", "inspect", "--format", "{{.State.Running}}", self.container_id], timeout=5)
        if stopped["output"].strip() != "false":
            raise WorkerError("candidate_not_stopped")
        result = self.host_command(["docker", "cp", self.container_id + ":/workspace/.", "-"],
                                   output_limit=MAX_ARCHIVE, binary=True)
        if result["outputTruncated"]:
            raise WorkerError("candidate_archive_too_large")
        extract_candidate(result["output"], destination)

    def install_candidate(self, candidate: Path):
        # Generated work never runs in this fresh verifier before diff capture.
        self.raw("find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf -- {} +")
        self.import_tree(candidate)

    def import_tree(self, source: Path):
        self.host_command(["docker", "cp", "-", self.container_id + ":/workspace"],
                          stdin_data=normalized_archive(source))

    def get_template_vars(self, **kwargs):
        return {"cwd": "/workspace", **kwargs}

    def serialize(self):
        return {"info": {"environment": {"type": "soar_docker", "network": "none"}}}

    def discard_pending_candidate(self):
        if self.recovery_staging:
            self.recovery_staging.cleanup()
        self.pending_candidate = None
        self.recovery_staging = None

    def cleanup(self, *, discard_pending=True):
        if self.container_id:
            result = self.host_command(["docker", "rm", "--force", self.container_id], timeout=30, check=False, allow_cancel=False)
            self.bridge.emit("container.removed", containerId=self.container_id, confirmed=result["returncode"] == 0)
            if result["returncode"]:
                raise WorkerError("container_cleanup_failed")
            self.container_id = None
        self.staging.cleanup()
        if discard_pending:
            self.discard_pending_candidate()


def recover_unsubmitted_patch(bridge: Bridge, start: dict, environment: DockerSession,
                              captured_source: Path | None = None):
    """Best-effort source salvage after execution ended; never runs a test/model."""
    recovery = ArtifactRecoveryBridge(bridge)
    verifier = None
    original_bridge = environment.bridge
    try:
        with tempfile.TemporaryDirectory(prefix="soar-unsubmitted-recovery-") as folder:
            candidate = captured_source or Path(folder) / "source"
            environment.bridge = recovery
            if captured_source is None:
                environment.capture_stopped_candidate(candidate)
            environment.cleanup(discard_pending=False)
            verifier = DockerSession(recovery, start)
            verifier.setup()
            verifier.install_candidate(candidate)
            patch = verifier.patch()
            if patch.strip():
                recovery.emit("patch.recovered", patch=patch, baseRevision=start["baseRevision"],
                              sha256=hashlib.sha256(patch.encode("utf-8")).hexdigest())
    except Exception:
        # Preserve the original error. Untrusted paths, Docker loss and recovery
        # deadlines are not permissions to relax extraction or restart solving.
        bridge.emit("recovery.failed")
    finally:
        environment.bridge = original_bridge
        if verifier:
            try:
                verifier.cleanup()
            except Exception:
                bridge.emit("recovery.failed")


def extract_candidate(archive: bytes, destination: Path):
    """Extract a bounded regular-file tree, without tar extraction primitives."""
    destination.mkdir(parents=True, exist_ok=True)
    total = 0
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as bundle:
        for index, member in enumerate(bundle):
            if index >= 10000:
                raise WorkerError("candidate_file_count_exceeded")
            path = Path(member.name)
            if path.is_absolute() or ".." in path.parts:
                raise WorkerError("candidate_path_denied")
            parts = tuple(part for part in path.parts if part != ".")
            if not parts or ".git" in parts:
                continue
            if any(part in (".env", "node_modules", "__pycache__", ".venv") or part.startswith(".env.") for part in parts):
                continue
            target = destination.joinpath(*parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            if not member.isfile() or member.size < 0:
                raise WorkerError("candidate_special_file_denied")
            total += member.size
            if total > MAX_SOURCE_BYTES:
                raise WorkerError("candidate_files_too_large")
            target.parent.mkdir(parents=True, exist_ok=True)
            source = bundle.extractfile(member)
            if source is None:
                raise WorkerError("candidate_archive_invalid")
            data = source.read(member.size + 1)
            if len(data) != member.size:
                raise WorkerError("candidate_archive_invalid")
            target.write_bytes(data)
            target.chmod(0o755 if member.mode & 0o111 else 0o644)


def normalized_archive(source: Path) -> bytes:
    """Normalize imported ownership; cap-drop root cannot write host UID files."""
    data = io.BytesIO()
    total = 0
    with tarfile.open(fileobj=data, mode="w") as bundle:
        for index, path in enumerate(sorted(source.rglob("*"))):
            if index >= 10000 or path.is_symlink() or not (path.is_file() or path.is_dir()):
                raise WorkerError("source_tree_not_supported")
            info = bundle.gettarinfo(str(path), arcname=path.relative_to(source).as_posix())
            info.uid = info.gid = 0
            info.uname = info.gname = "root"
            info.mode = 0o755 if path.is_dir() or info.mode & 0o111 else 0o644
            if path.is_file():
                total += info.size
                if total > MAX_SOURCE_BYTES:
                    raise WorkerError("source_tree_too_large")
                with path.open("rb") as content:
                    bundle.addfile(info, content)
            else:
                bundle.addfile(info)
    if data.tell() > MAX_ARCHIVE:
        raise WorkerError("source_archive_too_large")
    return data.getvalue()


def utf8_prefix(text: str, limit: int) -> str:
    return text.encode("utf-8")[:limit].decode("utf-8", errors="ignore")


def host_source_inventory(source: Path) -> str:
    """Identical deterministic preparation for cloud-only and native coding."""
    return utf8_prefix("\n".join(path.relative_to(source).as_posix()
        for path in sorted(source.rglob("*")) if path.is_file()), 12000)


def readonly_command(command: str) -> str:
    """Scout grammar: inventory, read <relative-path> [start-line], search <literal-text>."""
    import shlex
    parts = shlex.split(command)
    if parts == ["inventory"]:
        return "git ls-files | head -n 200"
    if len(parts) in (2, 3) and parts[0] == "read":
        path = parts[1]
        if not path or path.startswith("/") or ".." in Path(path).parts or path.startswith(".git") or path.startswith("-"):
            raise WorkerError("scout_path_denied")
        first = parts[2] if len(parts) == 3 else "1"
        if not re.fullmatch(r"[1-9][0-9]{0,5}", first):
            raise WorkerError("scout_action_denied")
        script = ("import itertools,sys; p=sys.argv[1]; n=int(sys.argv[2]); "
                  "f=open(p,encoding='utf-8',errors='replace'); "
                  "rows=itertools.islice(enumerate(f,1),n-1,n+119); "
                  "text=''.join(f'{p}:{i}:{line}' for i,line in rows); "
                  "sys.stdout.buffer.write(text.encode('utf-8')[:12000])")
        return "python -c " + shlex.quote(script) + " " + shlex.quote(path) + " " + first
    if len(parts) == 2 and parts[0] == "search" and len(parts[1]) <= 200:
        return "git grep -n -F -e " + shlex.quote(parts[1]) + " -- ':!.git' | head -n 100"
    raise WorkerError("scout_action_denied")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise WorkerError("provider_redirect_denied")


PROVIDER_HTTP_REASONS = {
    status: "provider_http_" + str(status)
    for status in (400, 401, 402, 403, 404, 408, 409, 413, 415, 422, 429, 500, 502, 503, 504)
}


def provider_failure_reason(error: Exception) -> str:
    """Return only fixed codes; exception text, URLs, headers and bodies are private."""
    if isinstance(error, urllib.error.HTTPError):
        # Do not read the error body or derive labels from the reason phrase.
        return PROVIDER_HTTP_REASONS.get(error.code, "provider_http_error")
    if isinstance(error, urllib.error.URLError):
        if not isinstance(error.reason, Exception):
            return "provider_connection_error"
        error = error.reason
    if isinstance(error, ssl.SSLCertVerificationError):
        return "provider_tls_verification_failed"
    if isinstance(error, ssl.SSLError):
        return "provider_tls_error"
    if isinstance(error, (TimeoutError, socket.timeout)):
        return "provider_timeout"
    if isinstance(error, (ConnectionError, socket.gaierror, OSError)):
        return "provider_connection_error"
    if isinstance(error, (json.JSONDecodeError, UnicodeDecodeError)):
        return "provider_response_invalid"
    if isinstance(error, WorkerError) and error.args in (
        ("provider_response_too_large",), ("provider_redirect_denied",),
    ):
        return error.args[0]
    return "provider_transport_error"


def usage_from_response(protocol: str, response: dict) -> dict:
    usage = response.get("usage")
    if not isinstance(usage, dict):
        raise WorkerError("provider_usage_missing")
    if protocol == "anthropic":
        keys = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
        values = [usage.get(key, 0) for key in keys]
    else:
        details = usage.get("prompt_tokens_details") or {}
        completion = usage.get("completion_tokens_details") or {}
        if not isinstance(details, dict) or not isinstance(completion, dict):
            raise WorkerError("provider_usage_invalid")
        keys = ("prompt_tokens", "completion_tokens")
        values = [usage.get(key) for key in keys] + [details.get("cached_tokens", 0), details.get("cache_write_tokens", 0)]
        reasoning = completion.get("reasoning_tokens", 0)
        if not isinstance(reasoning, int) or isinstance(reasoning, bool) or reasoning < 0:
            raise WorkerError("provider_usage_invalid")
    if any(not isinstance(v, int) or isinstance(v, bool) or v < 0 for v in values):
        raise WorkerError("provider_usage_invalid")
    result = {"inputTokens": values[0], "outputTokens": values[1], "cacheReadTokens": values[2],
              "cacheWriteTokens": values[3], "reported": True}
    if protocol != "anthropic":
        if values[2] + values[3] > values[0] or reasoning > values[1]:
            raise WorkerError("provider_usage_invalid")
        # Reasoning is already included in completion_tokens; never bill twice.
        if "reasoning_tokens" in completion:
            result["reasoningTokens"] = reasoning
    cost = usage.get("cost")
    if isinstance(cost, (int, float)) and not isinstance(cost, bool) and 0 <= cost < 1000000:
        result["providerCostUsd"] = cost
    return result


class ExactModel:
    """A mini Model implementation; exact pre-admitted HTTP bodies, zero retries."""
    def __init__(self, bridge: Bridge, start: dict, phase: str):
        self.bridge, self.start, self.phase = bridge, start, phase
        self.provider = start.get("providers", {}).get("local" if phase in ("scout", "local") else "cloud", {})
        self.config = {}
        self.script_index = 0
        self.observations: list[str] = []
        self.scout_evidence: list[str] = []

    def query(self, messages: list[dict], **kwargs):
        from minisweagent.exceptions import FormatError
        self.bridge.check_cancelled()
        if self.start["mode"] == "scripted":
            if self.start["policy"] in ROUTED_POLICIES:
                if self.start.get("_modelCalls", 0) >= self.start["limits"]["stepLimit"]:
                    raise WorkerError("routing_global_call_limit")
                self.start["_modelCalls"] = self.start.get("_modelCalls", 0) + 1
            actions = self.start["scriptedActions"]
            command = actions[self.script_index] if self.script_index < len(actions) else SUBMIT
            self.script_index += 1
            self.bridge.emit("model.finished", phase=self.phase, simulated=True, usage={"reported": False})
            return {"role": "assistant", "content": "```mswea_bash_command\n" + command + "\n```",
                    "extra": {"actions": [{"command": command}], "cost": 0.0}}
        body, max_tokens = self.prepare_body(messages)
        response = self.complete_body(body, max_tokens=max_tokens)
        provider = self.provider
        if provider["protocol"] == "anthropic":
            content = "\n".join(part.get("text", "") for part in response.get("content", []) if part.get("type") == "text")
        else:
            choices = response.get("choices", [])
            if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
                raise WorkerError("provider_output_empty")
            # Settle usage before stopping: a truncated completion is billable,
            # but must never become a partially executable shell action.
            if choices[0].get("finish_reason") == "length":
                raise WorkerError("provider_output_truncated")
            content = choices[0].get("message", {}).get("content", "") if choices else ""
        if not isinstance(content, str):
            content = ""
        if not content.strip():
            raise WorkerError("provider_output_empty")
        actions = re.findall(r"```mswea_bash_command\s*\n(.*?)\n```", content, re.DOTALL)
        if len(actions) != 1:
            raise FormatError({"role": "user", "content": "Return exactly one mswea_bash_command fenced action.", "extra": {"cost": 0.0}})
        return {"role": "assistant", "content": content, "extra": {"actions": [{"command": actions[0]}], "cost": 0.0}}

    def prepare_body(self, messages):
        provider = self.provider
        prepared = [{"role": m["role"], "content": m.get("content", "")} for m in messages if m["role"] in ("system", "user", "assistant")]
        max_tokens = provider.get("maxOutputTokens", self.start["limits"]["maxOutputTokens"])
        if provider["protocol"] == "anthropic":
            systems = [m["content"] for m in prepared if m["role"] == "system"]
            turns = [m for m in prepared if m["role"] != "system"]
            if turns:
                turns[-1] = {**turns[-1], "content": [{"type": "text", "text": turns[-1]["content"], "cache_control": {"type": "ephemeral"}}]}
            body = {"model": provider["model"], "system": "\n".join(systems), "messages": turns, "max_tokens": max_tokens}
            if provider.get("thinkingBudgetTokens"):
                body["thinking"] = {"type": "enabled", "budget_tokens": bounded_int(provider["thinkingBudgetTokens"], 1024, 1024, max_tokens - 1)}
        else:
            sol = provider.get("id") == "openai" and provider["model"] == "gpt-5.6-sol"
            body = {"model": provider["model"], "messages": prepared,
                    ("max_completion_tokens" if sol else "max_tokens"): max_tokens, "stream": False}
            if sol:
                # Explicit-only with no breakpoints creates no cache writes.
                # https://developers.openai.com/api/docs/guides/prompt-caching
                body.update(reasoning_effort="medium", service_tier="default", prompt_cache_options={"mode": "explicit"})
            if provider.get("reasoningEffort"):
                body["reasoning_effort"] = provider["reasoningEffort"]
            if provider.get("routing") is not None:
                body["provider"] = provider["routing"]
        return body, max_tokens

    def complete_body(self, body, *, max_tokens, max_input_bytes=None, request_id=None):
        """Shared admitted transport; settle every response before semantic parsing."""
        self.bridge.check_cancelled()
        provider = self.provider
        encoded = canonical_json(body)
        if len(encoded) > (max_input_bytes or provider.get("maxInputBytes", self.start["limits"]["maxInputBytes"])):
            raise WorkerError("input_limit_exceeded")
        digest = hashlib.sha256(encoded).hexdigest()
        request_id = request_id or uuid.uuid4().hex
        critic_policy = self.start["policy"] == "local_critic_repair"
        if critic_policy:
            if self.phase not in ("local", "critic"):
                raise WorkerError("routing_critic_phase_denied")
            if self.phase == "critic":
                context = self.start.get("_criticContext", {})
                if (self.start.get("_criticRequests", 0) != 0 or max_tokens != 8192 or
                        context.get("requestId") != request_id or context.get("bodySha256") != digest):
                    raise WorkerError("routing_critic_request_denied")
            else:
                local_calls = self.start.get("_criticLocalCalls", 0)
                repair_start = self.start.get("_criticRepairStartedAt")
                if ((repair_start is None and (local_calls >= 8 or self.start.get("_criticRequests", 0))) or
                        (repair_start is not None and (self.start.get("_criticVerdict") != "repair_required" or
                                                     local_calls - repair_start >= 4 or local_calls >= 12))):
                    raise WorkerError("routing_critic_local_call_limit")
        check_reserve = self.start["limits"].get("visibleCheckTimeoutSeconds", 60)
        if self.start["limits"].get("plannerMode") == "plan_and_checks":
            check_reserve *= 2
        reviewed_local = ((self.start["policy"] == "cloud_plan_local_review" or
                           (critic_policy and self.start.get("_criticRepairStartedAt") is None)) and self.phase == "local")
        if reviewed_local:
            check_reserve = self.start["limits"]["requestTimeoutSeconds"] + 2 * check_reserve
        remaining = self.bridge.deadline - time.monotonic()
        required = self.start["limits"]["requestTimeoutSeconds"] + check_reserve
        if remaining < required or (reviewed_local and remaining == required):
            raise WorkerError("routing_request_deadline_reserve")
        if self.start["policy"] in ROUTED_POLICIES:
            call_limit = self.start["limits"]["stepLimit"] - int(reviewed_local)
            if self.start.get("_modelCalls", 0) >= call_limit:
                raise WorkerError("routing_global_call_limit")
            self.start["_modelCalls"] = self.start.get("_modelCalls", 0) + 1
            if critic_policy:
                field = "_criticRequests" if self.phase == "critic" else "_criticLocalCalls"
                self.start[field] = self.start.get(field, 0) + 1
        url = provider["endpoint"]
        self.bridge.emit("request.prepare", requestId=request_id, phase=self.phase, model=provider["model"],
                         provider={"id": provider.get("id", self.phase), "protocol": provider["protocol"], "endpoint": url},
                         preparedRequest={"method": "POST", "url": url, "body": body, "bodySha256": digest},
                         bodySha256=digest, estimatedInputTokens=len(encoded), maxOutputTokens=max_tokens)
        self.bridge.admit(request_id, digest)
        # Admission can take time. The HTTP wall bound must still preserve the
        # final visible-check window; a late acknowledgement cannot spend it.
        deadline = min(self.bridge.deadline - check_reserve,
                       time.monotonic() + self.start["limits"]["requestTimeoutSeconds"])
        if deadline <= time.monotonic():
            self.bridge.emit("request.unsettled", requestId=request_id, phase=self.phase, reason="cancelled_or_timeout")
            raise WorkerError("routing_request_deadline_reserve")
        headers = {"content-type": "application/json"}
        credential = provider.get("apiKey", "")
        if provider["protocol"] == "anthropic":
            headers["anthropic-version"] = "2023-06-01"
            headers["x-api-key"] = credential
        elif credential:
            headers["authorization"] = "Bearer " + credential
        request = urllib.request.Request(url, data=encoded, method="POST", headers=headers)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        outcome: queue.Queue = queue.Queue()
        def perform():
            try:
                with opener.open(request, timeout=max(0.01, deadline - time.monotonic())) as response:
                    data = response.read(MAX_LINE + 1)
                    if len(data) > MAX_LINE:
                        raise WorkerError("provider_response_too_large")
                    outcome.put((True, json.loads(data)))
            except Exception as error:
                outcome.put((False, provider_failure_reason(error)))
        threading.Thread(target=perform, daemon=True).start()
        while True:
            if self.bridge.cancelled.is_set() or time.monotonic() > deadline:
                self.bridge.emit("request.unsettled", requestId=request_id, phase=self.phase, reason="cancelled_or_timeout")
                self.bridge.check_cancelled()
                raise WorkerError("provider_request_timeout")
            try:
                success, response = outcome.get(timeout=0.1)
                break
            except queue.Empty:
                pass
        if not success:
            self.bridge.emit("request.unsettled", requestId=request_id, phase=self.phase, reason=response)
            raise WorkerError(response)
        if not isinstance(response, dict):
            self.bridge.emit("request.unsettled", requestId=request_id, phase=self.phase, reason="provider_response_invalid")
            raise WorkerError("provider_response_invalid")
        try:
            usage = usage_from_response(provider["protocol"], response)
        except WorkerError:
            self.bridge.emit("request.unsettled", requestId=request_id, phase=self.phase, reason="invalid_usage")
            raise
        reported_model = response.get("model")
        safe_identity = isinstance(reported_model, str) and (
            re.fullmatch(r"[A-Za-z0-9._:-]{1,256}", reported_model)
            or (reported_model == provider["model"] and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 ._:-]{0,255}", reported_model)))
        metadata = {"reportedModel": reported_model} if safe_identity else {}
        self.bridge.emit("request.finished", requestId=request_id, phase=self.phase, model=provider["model"], usage=usage, **metadata)
        self.bridge.check_cancelled()
        return response

    def format_message(self, **kwargs):
        return kwargs

    def format_observation_messages(self, message, outputs, template_vars=None):
        result = []
        actions = message.get("extra", {}).get("actions", [])
        for index, output in enumerate(outputs):
            value = "Exit code: " + str(output["returncode"]) + "\n" + output["output"]
            command = actions[index].get("command", "") if index < len(actions) else ""
            lines = substantive_action_lines(command) if isinstance(command, str) else []
            if output["returncode"] == 0 and (not lines or (len(lines) == 1 and re.fullmatch(r"(?:exit(?:\s+0)?|true|:)\s*;?", lines[0]))):
                value += "\nSOAR guidance: A successful no-op or exit 0 does not submit the task. If the patch and checks are ready, use SOAR_SUBMIT as the sole action in an mswea_bash_command fenced block. Otherwise continue inspecting, editing, or checking the repository."
            self.observations.append(value)
            verb = command.split(maxsplit=1)[0] if isinstance(command, str) and command.strip() else ""
            if self.phase == "scout" and verb in ("read", "search") and output["returncode"] == 0 and output["output"].strip():
                self.scout_evidence.append("Host action: " + command.strip() + "\n" + output["output"])
            result.append({"role": "user", "content": value})
        return result

    def get_template_vars(self, **kwargs):
        return kwargs

    def serialize(self):
        return {"info": {"model": {"phase": self.phase, "simulated": self.start["mode"] == "scripted"}}}


SYSTEM = """You are implementing a repository change in /workspace in an isolated Linux container. Available tools include Python 3 with its standard library, Bash, Git, and basic shell utilities. Do not assume apply_patch or rg is installed; use Python for edits and grep/find for searches. Use any host-observed inventory and source excerpts supplied with the task where they are sufficient; do not repeat an inspection solely because it came from host preparation. When repository context is absent or needs verification, list the actual repository using ls or git ls-files and read the relevant source. Read the relevant existing source and tests before editing, using supplied excerpts where sufficient and inspecting additional code as needed. Use paths you have observed; preserve the existing package structure and public API unless the task explicitly requests a change. Implement the requested fix and run relevant checks, including the exact configured visible check supplied in the task. Before submission inspect git diff and git status, and remove temporary backups and scratch files you created. Each response must contain exactly one action in a fenced block labelled mswea_bash_command. Actions normally contain shell commands. When finished, submit a fenced action whose sole nonblank, noncomment line is SOAR_SUBMIT. Shell exit 0 and comments alone do not submit. Do not modify .git or read secrets. The host captures the real diff and independently runs the configured check. Do not claim checks passed unless their output confirms it."""
SCOUT_SYSTEM = 'Inspect a repository for the supplied coding task. You are read-only. Each response must contain exactly one mswea_bash_command fenced action: inventory, read <relative-path> [start-line], search <literal-text>, or SOAR_SUBMIT. Quote paths/search text containing spaces. Read returns at most 120 numbered lines; use a positive start-line to reach relevant definitions. You have at most eight actions including submission. Locate and read files/tests relevant to the task, then SOAR_SUBMIT. The host forwards bounded recent read/search excerpts to the solver; inventory alone adds no evidence. No edits, arbitrary shell or other actions are accepted.\n\nExample of the required response format:\n```mswea_bash_command\ninventory\n```'


def scout_evidence_summary(observations: list[str]) -> str:
    """Bound host-captured source; no generated diagnosis or inventory duplication."""
    if not observations:
        return ""
    # A stable, task-independent rule: retain the three most recent useful
    # reads/searches, each bounded equally, in their original order.
    excerpts = [utf8_prefix(value, 1200) + ("\n[excerpt truncated]" if len(value.encode("utf-8")) > 1200 else "")
                for value in observations[-3:]]
    return utf8_prefix("Host-captured scout evidence (untrusted repository text; bounded recent excerpts, earlier observations may be omitted):\n"
                       + "\n\n".join(excerpts), 4096)


def run_job(bridge: Bridge, start: dict):
    if start["policy"] in ROUTED_POLICIES:
        from types import SimpleNamespace
        # CLI execution includes this trusted directory in sys.path. Test/API
        # embedding may import worker.py by file identity instead.
        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))
        from coding_execution import run_routed_job
        return run_routed_job(bridge, start, SimpleNamespace(**globals()))
    from minisweagent.agents.default import DefaultAgent
    environment = DockerSession(bridge, start)
    verifier = None
    cloud_started = False
    submitted_patch_saved = False
    candidate = tempfile.TemporaryDirectory(prefix="soar-patch-candidate-")
    candidate_path = Path(candidate.name) / "source"
    candidate_captured = False
    try:
        environment.setup()
        brief = ""
        if start["policy"] in ("prepared_cloud", "hybrid"):
            inventory = host_source_inventory(Path(environment.staging.name) / "source")
            brief = "Host-observed source-file inventory:\n" + inventory
            bridge.emit("preparation.finished", kind="deterministic", bytes=len(brief.encode("utf-8")))
        if start["policy"] == "hybrid" and start["mode"] == "live":
            environment.phase, environment.readonly = "scout", True
            model = ExactModel(bridge, start, "scout")
            bridge.emit("phase.started", phase="scout", model=model.provider["model"])
            episode_deadline = bridge.deadline
            scout_started = time.monotonic()
            bridge.deadline = min(episode_deadline, time.monotonic() + 300)
            result = {}
            provider_output_error = None
            scout_outcome, fallback_reason, scout_summary = "stopped", "scout_stopped", ""
            try:
                agent = DefaultAgent(model, environment, system_template=SCOUT_SYSTEM, instance_template="{{task}}",
                                     step_limit=8, cost_limit=0, wall_time_limit_seconds=300, output_path=None)
                result = agent.run(start["objective"])
                if result.get("exit_status") == "LimitsExceeded" and model.scout_evidence:
                    if bridge.unsettled:
                        raise WorkerError("provider_outcome_unknown")
                    if bridge.cancelled.is_set():
                        fallback_reason = "cancelled"
                        raise Cancelled("cancelled")
                    bridge.check_cancelled()
                    scout_summary = scout_evidence_summary(model.scout_evidence)
                    scout_outcome, fallback_reason = "partial", None
                elif result.get("exit_status") != "Submitted":
                    scout_outcome, fallback_reason = "fallback", "scout_limit_or_format_failure"
                    bridge.emit("scout.fallback", reason="scout_limit_or_format_failure")
                else:
                    scout_outcome, fallback_reason = "completed", None
                    scout_summary = scout_evidence_summary(model.scout_evidence)
                    if not scout_summary:
                        scout_outcome, fallback_reason = "fallback", "scout_no_evidence"
                        bridge.emit("scout.fallback", reason=fallback_reason)
            except WorkerError as error:
                # Continue once with the deterministic preparation only after a
                # settled local failure. Unknown exposure, denial, or cancel
                # always stops the episode; it never becomes a cloud retry.
                safe = {"scout_path_denied", "scout_action_denied", "container_command_timeout",
                        "invalid_action", "run_deadline_exceeded", "input_limit_exceeded",
                        "provider_output_empty", "provider_output_truncated"}
                if bridge.unsettled or bridge.cancelled.is_set() or str(error) not in safe or time.monotonic() >= episode_deadline:
                    fallback_reason = ("provider_outcome_unknown" if bridge.unsettled else "cancelled" if bridge.cancelled.is_set()
                                       else "run_deadline_exceeded" if time.monotonic() >= episode_deadline else "scout_stopped")
                    raise
                if str(error) in ("provider_output_empty", "provider_output_truncated"):
                    provider_output_error = str(error)
                scout_outcome, fallback_reason = "fallback", ("scout_limit_or_format_failure"
                    if str(error) in ("provider_output_empty", "provider_output_truncated") else str(error))
                bridge.emit("scout.fallback", reason=fallback_reason)
            finally:
                bridge.deadline = episode_deadline
                environment.readonly = False
                bridge.emit("preparation.finished", kind="scout", summary=scout_summary,
                            elapsedMs=max(0, int((time.monotonic() - scout_started) * 1000)), outcome=scout_outcome,
                            **({"fallbackReason": fallback_reason} if fallback_reason else {}),
                            **({"providerOutputError": provider_output_error} if provider_output_error else {}),
                            bytes=len(scout_summary.encode("utf-8")), exitStatus=result.get("exit_status"))
            if scout_summary:
                if scout_outcome == "partial":
                    brief += "\n\nPartial local investigation: step limit reached before submission. Existing source excerpts follow."
                brief += "\n\n" + scout_summary
            # No scout process survives into the cloud phase, including a
            # bounded read whose docker-exec client timed out.
            environment.cleanup()
            environment = DockerSession(bridge, start)
            environment.setup()
        environment.phase = "cloud"
        model = ExactModel(bridge, start, "cloud")
        bridge.emit("phase.started", phase="cloud", model=model.provider.get("model", "scripted"), simulated=start["mode"] == "scripted")
        cloud_started = True
        bridge.check_cancelled()
        agent = DefaultAgent(model, environment, system_template=SYSTEM, instance_template="{{task}}",
                             step_limit=start["limits"]["stepLimit"], cost_limit=0,
                             wall_time_limit_seconds=max(1, int(bridge.deadline - time.monotonic())), output_path=None)
        objective = (start["objective"]
                     + "\n\nConfigured visible check: run this exact command before submitting, inspect its result, and fix any failures. The host will rerun it on the frozen patch.\n```bash\n"
                     + start["visibleTestCommand"] + "\n```"
                     + (("\n\n" + brief) if brief else ""))
        result = agent.run(objective)
        if result.get("exit_status") != "Submitted":
            raise WorkerError("agent_" + str(result.get("exit_status", "failed")))
        environment.capture_stopped_candidate(candidate_path)
        candidate_captured = True
        environment.cleanup()
        verifier = DockerSession(bridge, start)
        verifier.phase = "verification"
        verifier.setup()
        verifier.install_candidate(candidate_path)
        patch = verifier.patch()
        # Persist the immutable submission before a check can time out or be
        # cancelled. Check completion is a separate receipt, never an export gate.
        bridge.emit("patch.ready", patch=patch, baseRevision=start["baseRevision"],
                    sha256=hashlib.sha256(patch.encode("utf-8")).hexdigest())
        submitted_patch_saved = True
        # Visible checks run against the frozen submitted tree in a new
        # container. They may themselves be modified by the submitted patch.
        bridge.emit("verification.started", command=start["visibleTestCommand"])
        checked = verifier.raw("set -o pipefail\n" + start["visibleTestCommand"],
                               timeout=start["limits"]["visibleCheckTimeoutSeconds"], check=False)
        bridge.emit("verification.finished", passed=checked["returncode"] == 0,
                    output=checked["output"], returncode=checked["returncode"], kind="visible",
                    submittedTests=True, outputTruncated=checked["outputTruncated"])
        return "completed" if checked["returncode"] == 0 else "checks_failed"
    except BaseException:
        if cloud_started and not submitted_patch_saved and (candidate_captured or environment.pending_candidate or environment.container_id):
            recover_unsubmitted_patch(bridge, start, environment,
                                      candidate_path if candidate_captured else environment.pending_candidate)
        raise
    finally:
        # Cleanup is synchronous and gets its own bounded grace period even
        # after the episode deadline, without allowing further model work.
        try:
            environment.cleanup()
        finally:
            try:
                if verifier:
                    verifier.cleanup()
            finally:
                candidate.cleanup()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-runtime", action="store_true")
    args = parser.parse_args()
    bridge = Bridge()
    sandbox_config = tempfile.TemporaryDirectory(prefix="soar-mini-config-")
    os.environ["MSWEA_GLOBAL_CONFIG_DIR"] = sandbox_config.name
    os.environ["MSWEA_SILENT_STARTUP"] = "1"
    try:
        identity = verify_runtime()
        if args.check_runtime:
            print(json.dumps(identity))
            return 0
        bridge.emit("ready", runtime=identity)
        bridge.start_reader()
        start = validate_start(bridge.receive())
        bridge.run_id = start["runId"]
        bridge.deadline = time.monotonic() + start["limits"]["wallTimeSeconds"]
        bridge.secrets = [provider.get("apiKey", "") for provider in start.get("providers", {}).values()]
        def cancel_signal(_number, _frame):
            bridge.cancelled.set()
        signal.signal(signal.SIGTERM, cancel_signal)
        signal.signal(signal.SIGINT, cancel_signal)
        bridge.emit("run.started", mode=start["mode"], policy=start["policy"], baseRevision=start["baseRevision"])
        status = run_job(bridge, start)
        bridge.emit("terminal", status=status, simulated=start["mode"] == "scripted")
        return 0
    except Cancelled:
        bridge.emit("terminal", status="cancelled")
        return 0
    except Exception as error:
        # Deliberately never emit exception text from provider/network/runtime
        # libraries, whose messages can contain credentials or request bodies.
        code = str(error) if isinstance(error, WorkerError) else type(error).__name__
        bridge.emit("terminal", status="failed", errorCode=code)
        return 1
    finally:
        sandbox_config.cleanup()


if __name__ == "__main__":
    raise SystemExit(main())
