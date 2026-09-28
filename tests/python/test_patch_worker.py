"""Worker contract tests; Docker proofs opt in with SOAR_TEST_DOCKER_IMAGE.

Run with the pinned worker venv, not the system Python. No paid provider calls.
"""
import hashlib
import http.server
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import unittest
from unittest import mock
import urllib.error

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("patch_worker", ROOT / "runtime/patch-worker/worker.py")
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)
os.environ["MSWEA_SILENT_STARTUP"] = "1"
CONFIG = tempfile.TemporaryDirectory(prefix="soar-worker-test-config-")
os.environ["MSWEA_GLOBAL_CONFIG_DIR"] = CONFIG.name


def config(workspace, **overrides):
    return worker.validate_start({
        "type": "start", "runId": "test-run", "mode": "scripted", "policy": "cloud",
        "workspace": str(workspace), "baseRevision": "abc123", "containerImage": "soar-patch-fixture:1",
        "objective": "Fix the addition function.", "visibleTestCommand": "python -m unittest discover -s .",
        "scriptedActions": ["SOAR_SUBMIT"], "limits": {"wallTimeSeconds": 120}, **overrides,
    })


class WorkerUnitTests(unittest.TestCase):
    def test_core_source_matches_pinned_distribution(self):
        self.assertEqual(worker.verify_runtime()["version"], "2.4.6")

    def test_admission_requires_exact_body_digest(self):
        bridge = worker.Bridge(sink=io.StringIO())
        bridge.inbox.put({"type": "request.admitted", "requestId": "one", "bodySha256": "different"})
        with self.assertRaisesRegex(worker.WorkerError, "admission_body_mismatch"):
            bridge.admit("one", "expected")
        for reply in ({"type": "cancel"}, {"type": "request.admitted", "requestId": "one", "bodySha256": "expected"}):
            with self.subTest(reply=reply["type"]):
                bridge = worker.Bridge(sink=io.StringIO())
                def cancelled_while_waiting():
                    bridge.cancelled.set()
                    return reply
                with mock.patch.object(bridge, "receive", side_effect=cancelled_while_waiting):
                    with self.assertRaises(worker.Cancelled):
                        bridge.admit("one", "expected")
                self.assertFalse(bridge.unsettled, "no HTTP request was started while awaiting admission")

    def test_output_drain_is_bounded_without_deadlock(self):
        with tempfile.TemporaryDirectory() as source:
            session = worker.DockerSession(worker.Bridge(sink=io.StringIO()), config(source))
            try:
                result = session.host_command([sys.executable, "-c", "import sys; sys.stdout.write('a'*2000000)"], output_limit=1000)
                self.assertTrue(result["outputTruncated"])
                self.assertLess(len(result["output"]), 1100)
            finally:
                session.cleanup()

    def test_episode_deadline_blocks_commands(self):
        bridge = worker.Bridge(sink=io.StringIO())
        bridge.deadline = time.monotonic() - 1
        with tempfile.TemporaryDirectory() as source:
            session = worker.DockerSession(bridge, config(source))
            try:
                with self.assertRaisesRegex(worker.WorkerError, "run_deadline_exceeded"):
                    session.host_command([sys.executable, "-c", "raise Exception('must not run')"])
            finally:
                session.cleanup()

    def test_command_timeout_retains_bounded_partial_output(self):
        with tempfile.TemporaryDirectory() as source:
            session = worker.DockerSession(worker.Bridge(sink=io.StringIO()), config(source))
            try:
                with self.assertRaises(worker.CommandTimeout) as raised:
                    session.host_command([sys.executable, "-u", "-c",
                                          "import time; print('started-' + 'x'*1000); time.sleep(5)"],
                                         timeout=0.2, output_limit=64)
                self.assertEqual(raised.exception.result["returncode"], 124)
                self.assertTrue(raised.exception.result["timedOut"])
                self.assertTrue(raised.exception.result["outputTruncated"])
                self.assertTrue(raised.exception.result["output"].startswith("started-"))
                self.assertLess(len(raised.exception.result["output"]), 128)
            finally:
                session.cleanup()

    def test_recovery_bridge_cannot_admit_model_requests(self):
        bridge = worker.Bridge(sink=io.StringIO())
        recovery = worker.ArtifactRecoveryBridge(bridge)
        with self.assertRaisesRegex(worker.WorkerError, "artifact_recovery_event_denied"):
            recovery.emit("request.prepare", preparedRequest={})
        self.assertEqual(bridge.sequence, 0)
        recovery.deadline = recovery.recovery_deadline = time.monotonic() - 1
        with self.assertRaisesRegex(worker.WorkerError, "artifact_recovery_timeout"):
            recovery.check_cancelled()

    def test_candidate_capture_requires_independently_stopped_state(self):
        with tempfile.TemporaryDirectory() as source, tempfile.TemporaryDirectory() as target:
            session = worker.DockerSession(worker.Bridge(sink=io.StringIO()), config(source))
            session.container_id = "candidate"
            try:
                with mock.patch.object(session, "host_command", side_effect=[{"output": "candidate"}, {"output": "true\n"}]) as run:
                    with self.assertRaisesRegex(worker.WorkerError, "candidate_not_stopped"):
                        session.capture_stopped_candidate(Path(target) / "source")
                    self.assertEqual(run.call_count, 2, "must not copy a still-running candidate")
            finally:
                session.container_id = None
                session.cleanup()

    def test_scout_denies_shell_and_path_traversal(self):
        for action in ("read ../secret", "read /etc/passwd", "read .git/config", "inventory; touch x", "python evil.py",
                       "read calc.py 0", "read calc.py -1", "read calc.py 2;evil", "read calc.py 1000000"):
            with self.subTest(action=action), self.assertRaises(worker.WorkerError):
                worker.readonly_command(action)
        self.assertIn("python -c", worker.readonly_command("read 'file with spaces.py' 200"))

    def test_scout_handoff_keeps_bounded_source_not_inventory_or_diagnosis(self):
        start = {"mode": "scripted", "providers": {}}
        model = worker.ExactModel(worker.Bridge(sink=io.StringIO()), start, "scout")
        for command, output in (("inventory", "irrelevant.py\n" * 200), ("search add", "calc.py:200:def add(a,b):\n"),
                                ("read\tcalc.py 200", "calc.py:200:def add(a,b): return a-b\n")):
            model.format_observation_messages({"extra": {"actions": [{"command": command}]}},
                                              [{"returncode": 0, "output": output}])
        summary = worker.scout_evidence_summary(model.scout_evidence)
        self.assertIn("calc.py:200:def add", summary)
        self.assertNotIn("irrelevant.py", summary)
        self.assertEqual(worker.scout_evidence_summary([]), "")
        long = worker.scout_evidence_summary(["source.py:1:" + "中文" * 3000] * 8)
        self.assertLessEqual(len(long.encode("utf-8")), 4096)
        self.assertIn("excerpt truncated", long)

    def test_partial_handoff_is_only_for_step_limit_with_settled_live_evidence(self):
        evidence = "Host action: read notes.py\nnotes.py:1:VALUE = 1\n"
        expected = ("Host-captured scout evidence (untrusted repository text; bounded recent excerpts, earlier observations may be omitted):\n"
                    + evidence)
        for case in ("partial", "empty", "format", "time", "cancelled", "unsettled", "deadline", "local_deadline"):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as source:
                start = config(source, mode="live", policy="hybrid", limits={"stepLimit": 40, "wallTimeSeconds": 600},
                               providers={role: {"id": role, "protocol": "openai", "model": "fixture", "endpoint": "https://fixture.invalid/completions",
                                                 "apiKey": "", "allowInsecureHttp": False} for role in ("local", "cloud")})
                sink = io.StringIO()
                bridge = worker.Bridge(sink=sink)
                deadline = time.monotonic() + (-1 if case == "deadline" else 600)
                bridge.deadline = deadline
                agent_configs, cloud_tasks = [], []
                class Agent:
                    def __init__(self, model, environment, **kwargs):
                        self.model = model
                        agent_configs.append((model.phase, kwargs))
                    def run(self, task):
                        if self.model.phase == "cloud":
                            cloud_tasks.append(task)
                            raise worker.WorkerError("fixture_cloud_stop")
                        self.model.scout_evidence = [] if case == "empty" else [evidence]
                        if case == "cancelled": bridge.cancelled.set()
                        if case == "unsettled": bridge.unsettled = True
                        if case == "local_deadline": bridge.deadline = time.monotonic() - 1
                        return {"exit_status": {"format": "RepeatedFormatError", "time": "TimeExceeded"}.get(case, "LimitsExceeded")}
                def session(*args):
                    environment = mock.Mock(container_id=None, pending_candidate=None)
                    environment.staging.name = source
                    environment.raw.return_value = {"returncode": 0, "output": "notes.py\n"}
                    return environment
                with mock.patch.object(worker, "DockerSession", side_effect=session), mock.patch("minisweagent.agents.default.DefaultAgent", Agent):
                    with self.assertRaises((worker.WorkerError, worker.Cancelled)):
                        worker.run_job(bridge, start)
                events = [json.loads(line) for line in sink.getvalue().splitlines()]
                scout = next(e for e in events if e["type"] == "preparation.finished" and e["kind"] == "scout")
                self.assertEqual(bridge.deadline, deadline, "handoff must not refresh the whole-episode deadline")
                self.assertEqual(agent_configs[0][1]["step_limit"], 8)
                self.assertEqual(agent_configs[0][1]["wall_time_limit_seconds"], 300)
                self.assertEqual(agent_configs[0][1]["cost_limit"], 0)
                self.assertFalse(any(e["type"] == "request.prepare" for e in events), "this is a no-provider control-flow test")
                if case == "partial":
                    self.assertEqual((scout["outcome"], scout["summary"], scout["exitStatus"]), ("partial", expected, "LimitsExceeded"))
                    self.assertNotIn("fallbackReason", scout)
                    self.assertEqual(len(cloud_tasks), 1)
                    self.assertIn("Partial local investigation: step limit reached before submission.", cloud_tasks[0])
                    self.assertIn(expected, cloud_tasks[0])
                    self.assertEqual(agent_configs[1][1]["step_limit"], 40)
                    self.assertLessEqual(agent_configs[1][1]["wall_time_limit_seconds"], 600)
                elif case in ("cancelled", "unsettled", "deadline"):
                    self.assertEqual((scout["outcome"], scout["summary"]), ("stopped", ""))
                    self.assertEqual(cloud_tasks, [])
                else:
                    self.assertEqual((scout["outcome"], scout["summary"]), ("fallback", ""))
                    self.assertEqual(len(cloud_tasks), 1)
                    self.assertNotIn(expected, cloud_tasks[0])
                    self.assertNotIn("Partial local investigation:", cloud_tasks[0])

    def test_submission_allows_comments_without_discarding_other_shell_actions(self):
        from minisweagent.exceptions import Submitted
        bridge = worker.Bridge(sink=io.StringIO())
        with tempfile.TemporaryDirectory() as source:
            session = worker.DockerSession(bridge, config(source))
            try:
                with mock.patch.object(session, "raw", return_value={"returncode": 0, "output": "executed"}) as execute:
                    for command in ("SOAR_SUBMIT", "\n# Finished the fix\n  SOAR_SUBMIT\n# Review the captured patch\n"):
                        with self.subTest(command=command), self.assertRaises(Submitted):
                            session.execute({"command": command})
                    execute.assert_not_called()
                    for command in ("touch changed.py\nSOAR_SUBMIT", "SOAR_SUBMIT\nprintf extra", "SOAR_SUBMIT; touch changed.py", "printf 'SOAR_SUBMIT'"):
                        with self.subTest(command=command):
                            result = session.execute({"command": command})
                            self.assertEqual(result["output"], "executed")
                            execute.assert_called_with(command, check=False)
            finally:
                session.cleanup()

    def test_successful_noops_get_submission_guidance_without_claiming_completion(self):
        with tempfile.TemporaryDirectory() as source:
            model = worker.ExactModel(worker.Bridge(sink=io.StringIO()), config(source), "cloud")
            for command in ("# Finished\nexit 0", "true", ":", "# Just a comment"):
                with self.subTest(command=command):
                    result = model.format_observation_messages({"extra": {"actions": [{"command": command}]}}, [{"returncode": 0, "output": ""}])
                    self.assertIn("exit 0 does not submit", result[0]["content"])
                    self.assertIn("SOAR_SUBMIT", result[0]["content"])
                    self.assertEqual(result[0]["role"], "user")
            for command, code in (("python -m unittest", 0), ("exit 0", 1), ("python -m unittest\nexit 0", 0)):
                with self.subTest(command=command, code=code):
                    result = model.format_observation_messages({"extra": {"actions": [{"command": command}]}}, [{"returncode": code, "output": "actual output"}])
                    self.assertEqual(result[0]["content"], f"Exit code: {code}\nactual output")

    def test_tar_rejects_links_and_traversal_and_ignores_git(self):
        for name, kind in (("../escape", tarfile.REGTYPE), ("link", tarfile.SYMTYPE)):
            data = io.BytesIO()
            with tarfile.open(fileobj=data, mode="w") as bundle:
                info = tarfile.TarInfo(name)
                info.type = kind
                info.linkname = "/etc/passwd"
                bundle.addfile(info)
            with tempfile.TemporaryDirectory() as target, self.assertRaises(worker.WorkerError):
                worker.extract_candidate(data.getvalue(), Path(target))
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode="w") as bundle:
            for name in ("./.git/config", "./pkg/.git/config", "./fix.py"):
                info = tarfile.TarInfo(name)
                info.size = 1
                bundle.addfile(info, io.BytesIO(b"x"))
        with tempfile.TemporaryDirectory() as target:
            worker.extract_candidate(data.getvalue(), Path(target))
            self.assertEqual([p.name for p in Path(target).rglob("*")], ["fix.py"])

    def test_utf8_brief_limit_is_bytes(self):
        self.assertLessEqual(len(worker.utf8_prefix("漢" * 4096, 4096).encode()), 4096)

    def test_provider_reported_cost_is_optional_and_validated(self):
        result = worker.usage_from_response("openai", {"usage": {"prompt_tokens": 10, "completion_tokens": 4, "cost": 0.002}})
        self.assertEqual(result["providerCostUsd"], 0.002)
        with self.assertRaises(worker.WorkerError):
            worker.usage_from_response("openai", {"usage": {"prompt_tokens": 10}})

    def assert_provider_failure(self, expected, *, error=None, response=None):
        sink = io.StringIO()
        class AdmittingBridge(worker.Bridge):
            def emit(self, event_type, **values):
                super().emit(event_type, **values)
                if event_type == "request.prepare":
                    self.inbox.put({"type": "request.admitted", "requestId": values["requestId"], "bodySha256": values["bodySha256"]})
        bridge = AdmittingBridge(sink=sink)
        # Deliberately leave the redaction list empty: diagnostics must be safe
        # by construction, even for secret strings the bridge has never seen.
        opener = mock.Mock()
        if error is not None:
            opener.open.side_effect = error
        else:
            opened = mock.MagicMock()
            opened.__enter__.return_value.read.return_value = response
            opener.open.return_value = opened
        with tempfile.TemporaryDirectory() as source:
            start = config(source, mode="live", providers={"cloud": {
                "id": "fixture", "protocol": "openai", "endpoint": "https://fixture.invalid/chat/completions",
                "model": "fixture-model", "apiKey": "session-secret-do-not-emit",
            }})
            with mock.patch.object(worker.urllib.request, "build_opener", return_value=opener):
                with self.assertRaises(worker.WorkerError) as raised:
                    worker.ExactModel(bridge, start, "cloud").query([{"role": "user", "content": "fix it"}])
        self.assertEqual(str(raised.exception), expected)
        events = [json.loads(line) for line in sink.getvalue().splitlines()]
        self.assertEqual([event["type"] for event in events], ["request.prepare", "request.unsettled"])
        self.assertEqual(events[-1]["reason"], expected)
        self.assertTrue(bridge.unsettled)
        self.assertEqual(opener.open.call_count, 1, "provider failures must not trigger retries")
        for private in ("session-secret-do-not-emit", "private-error-message", "private-response-body", "private-header-value", "private-url-token"):
            self.assertNotIn(private, sink.getvalue())
            self.assertNotIn(private, str(raised.exception))

    def test_http_errors_emit_status_only_without_reading_secret_response(self):
        for status, expected in ((401, "provider_http_401"), (402, "provider_http_402"), (429, "provider_http_429"),
                                 (503, "provider_http_503"), (418, "provider_http_error")):
            with self.subTest(status=status):
                body = mock.Mock(wraps=io.BytesIO(b"private-response-body session-secret-do-not-emit"))
                error = urllib.error.HTTPError("https://fixture.invalid/private-url-token", status,
                                               "private-error-message", {"Authorization": "private-header-value"}, body)
                self.assert_provider_failure(expected, error=error)
                body.read.assert_not_called()

    def test_transport_errors_emit_only_allowlisted_categories(self):
        cases = (
            (urllib.error.URLError(ssl.SSLCertVerificationError(1, "private-error-message")), "provider_tls_verification_failed"),
            (ssl.SSLError(1, "private-error-message"), "provider_tls_error"),
            (urllib.error.URLError(TimeoutError("private-error-message")), "provider_timeout"),
            (ConnectionResetError("private-error-message"), "provider_connection_error"),
            (urllib.error.URLError(socket.gaierror(-2, "private-error-message")), "provider_connection_error"),
            (urllib.error.URLError("private-error-message"), "provider_connection_error"),
            (worker.WorkerError("provider_redirect_denied"), "provider_redirect_denied"),
            (worker.WorkerError("private-error-message"), "provider_transport_error"),
            (RuntimeError("private-error-message"), "provider_transport_error"),
        )
        for error, expected in cases:
            with self.subTest(expected=expected, error_type=type(error).__name__):
                self.assert_provider_failure(expected, error=error)

    def test_malformed_or_oversized_responses_keep_unknown_exposure(self):
        for response, expected in ((b"private-response-body", "provider_response_invalid"),
                                   (b"\xffprivate-response-body", "provider_response_invalid"),
                                   (b'["private-response-body"]', "provider_response_invalid"),
                                   (b"x" * (worker.MAX_LINE + 1), "provider_response_too_large")):
            with self.subTest(expected=expected, size=len(response)):
                self.assert_provider_failure(expected, response=response)

    def test_exact_admitted_http_body_and_no_retry(self):
        received = []
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                data = self.rfile.read(int(self.headers["content-length"]))
                received.append((data, self.headers.get("Authorization")))
                body = json.dumps({"choices": [{"message": {"content": "```mswea_bash_command\nSOAR_SUBMIT\n```"}}],
                                   "usage": {"prompt_tokens": 13, "completion_tokens": 8, "cost": 0.0002}}).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            def log_message(self, *args):
                pass
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        sink = io.StringIO()
        class AdmittingBridge(worker.Bridge):
            def emit(self, event_type, **values):
                super().emit(event_type, **values)
                if event_type == "request.prepare":
                    self.inbox.put({"type": "request.admitted", "requestId": values["requestId"], "bodySha256": values["bodySha256"]})
        bridge = AdmittingBridge(sink=sink)
        bridge.secrets = ["test-session-secret"]
        try:
            with tempfile.TemporaryDirectory() as source:
                start = config(source, mode="live", providers={"cloud": {
                    "id": "fixture", "protocol": "openai", "endpoint": "http://127.0.0.1:" + str(server.server_port) + "/chat/completions",
                    "model": "fixture-model", "apiKey": "test-session-secret", "allowInsecureHttp": True,
                    "routing": {"allow_fallbacks": False, "max_price": {"prompt": 0.44, "completion": 1.32}},
                }})
                response = worker.ExactModel(bridge, start, "cloud").query([{"role": "user", "content": "fix it"}])
            self.assertEqual(response["extra"]["actions"], [{"command": "SOAR_SUBMIT"}])
            events = [json.loads(line) for line in sink.getvalue().splitlines()]
            prepared = next(e for e in events if e["type"] == "request.prepare")
            self.assertEqual(len(received), 1)
            self.assertEqual(received[0][0], worker.canonical_json(prepared["preparedRequest"]["body"]))
            self.assertEqual(hashlib.sha256(received[0][0]).hexdigest(), prepared["bodySha256"])
            self.assertEqual(received[0][1], "Bearer test-session-secret")
            self.assertNotIn("test-session-secret", sink.getvalue())
            self.assertFalse(json.loads(received[0][0])["provider"]["allow_fallbacks"])
        finally:
            server.shutdown()
            server.server_close()


@unittest.skipUnless(os.environ.get("SOAR_TEST_DOCKER_IMAGE"), "set SOAR_TEST_DOCKER_IMAGE for real Docker proofs")
class WorkerDockerTests(unittest.TestCase):
    def run_worker(self, source, actions, check, cancel=False, cancel_at=None, cancel_occurrence=1, **overrides):
        start = config(source, containerImage=os.environ["SOAR_TEST_DOCKER_IMAGE"], scriptedActions=actions,
                       visibleTestCommand=check, **{"limits": {"wallTimeSeconds": 120,
                           "requestTimeoutSeconds": 5, "visibleCheckTimeoutSeconds": 5}, **overrides})
        process = subprocess.Popen([sys.executable, str(ROOT / "runtime/patch-worker/worker.py")],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        events = []
        cancel_matches = 0
        cancellation_sent = False
        try:
            ready = json.loads(process.stdout.readline())
            self.assertEqual(ready["type"], "ready")
            process.stdin.write(json.dumps(start) + "\n")
            process.stdin.flush()
            for line in process.stdout:
                event = json.loads(line)
                events.append(event)
                if (cancel and event["type"] == "command.started") or event["type"] == cancel_at:
                    cancel_matches += 1
                if cancel_matches == cancel_occurrence:
                    process.stdin.write('{"type":"cancel"}\n')
                    process.stdin.flush()
                    cancel_matches += 1
                    cancellation_sent = True
                if event["type"] == "request.prepare" and not cancellation_sent:
                    process.stdin.write(json.dumps({"type": "request.admitted", "requestId": event["requestId"],
                                                    "bodySha256": event["bodySha256"]}) + "\n")
                    process.stdin.flush()
                if event["type"] == "terminal":
                    break
            process.wait(timeout=10)
            self.assertTrue(events and events[-1]["type"] == "terminal", process.stderr.read())
            created = [e["containerId"] for e in events if e["type"] == "container.created"]
            removed = [e["containerId"] for e in events if e["type"] == "container.removed" and e["confirmed"]]
            self.assertCountEqual(created, removed)
            return events
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            process.stdin.close()
            process.stdout.close()
            process.stderr.close()

    def test_two_fixtures_and_untrusted_git_baseline(self):
        for broken, fixed in (("return a - b", "return a + b"), ("return a * b", "return a + b")):
            with self.subTest(broken=broken), tempfile.TemporaryDirectory() as source:
                path = Path(source) / "calc.py"
                original = "def add(a, b):\n    " + broken + "\n"
                path.write_text(original)
                events = self.run_worker(source, ["sed -i 's/" + broken.replace("*", r"\*") + "/" + fixed + "/' calc.py; rm -rf .git", "# Finished the fix\nSOAR_SUBMIT\n# Capture the patch"],
                                         "python -c 'from calc import add; assert add(2, 3) == 5'")
                self.assertEqual(events[-1]["status"], "completed", events[-1])
                patch = next(e for e in events if e["type"] == "patch.ready")["patch"]
                self.assertIn("+    " + fixed, patch)
                self.assertEqual(path.read_text(), original)
                self.assertFalse(any(e["type"] == "request.prepare" for e in events))

    def test_cancel_waits_for_container_removal(self):
        with tempfile.TemporaryDirectory() as source:
            Path(source, "calc.py").write_text("x = 1\n")
            events = self.run_worker(source, ["sleep 30"], "true", cancel=True)
            self.assertEqual(events[-1]["status"], "cancelled")
            self.assertFalse(any(e["type"] == "patch.ready" for e in events))

    def test_submitted_patch_survives_cancellation_during_visible_check(self):
        with tempfile.TemporaryDirectory() as source:
            original = "def add(a,b): return a-b\n"
            Path(source, "calc.py").write_text(original)
            events = self.run_worker(source, ["printf 'def add(a,b): return a+b\\n' > calc.py", "SOAR_SUBMIT"],
                                     "sleep 30", cancel_at="verification.started")
            self.assertEqual(events[-1]["status"], "cancelled")
            types = [event["type"] for event in events]
            self.assertLess(types.index("patch.ready"), types.index("verification.started"))
            self.assertNotIn("verification.finished", types)
            patch = next(event for event in events if event["type"] == "patch.ready")
            self.assertIn("+def add(a,b): return a+b", patch["patch"])
            self.assertEqual(patch["sha256"], hashlib.sha256(patch["patch"].encode()).hexdigest())
            self.assertEqual(Path(source, "calc.py").read_text(), original)

    def test_timeout_stops_descendants_preserves_edits_and_continues_in_clean_image(self):
        with tempfile.TemporaryDirectory() as source:
            original = "x = 1\n"
            Path(source, "calc.py").write_text(original)
            hung = """printf 'timeout-output-marker\\n'
printf 'x = 2\\n' > calc.py
touch /tmp/soar-mutated-image
rm -rf .git
python -u - <<'PY'
import os, time
if os.fork() == 0:
    os.setsid()
    while True:
        with open('heartbeat.txt', 'a') as stream:
            stream.write('tick\\n')
        time.sleep(0.03)
time.sleep(30)
PY"""
            continued = """python - <<'PY'
from pathlib import Path
import time
assert Path('calc.py').read_text() == 'x = 2\\n'
assert not Path('/tmp/soar-mutated-image').exists()
assert Path('.git').is_dir()
before = Path('heartbeat.txt').read_bytes()
assert before
time.sleep(0.2)
assert Path('heartbeat.txt').read_bytes() == before, 'descendant survived recovery'
Path('heartbeat.txt').unlink()
Path('calc.py').write_text('x = 3\\n')
PY"""
            events = self.run_worker(source, [hung, continued, "SOAR_SUBMIT"],
                                     "python -c 'from calc import x; assert x == 3'",
                                     limits={"wallTimeSeconds": 120, "commandTimeoutSeconds": 1})
            self.assertEqual(events[-1]["status"], "completed", events[-1])
            timeout = next(e for e in events if e["type"] == "command.finished" and e.get("timedOut"))
            self.assertEqual(timeout["returncode"], 124)
            self.assertIn("timeout-output-marker", timeout["output"])
            recovery = next(e for e in events if e["type"] == "patch.recovered")
            final = next(e for e in events if e["type"] == "patch.ready")
            self.assertIn("+x = 2", recovery["patch"])
            self.assertIn("+x = 3", final["patch"])
            self.assertNotIn("heartbeat", final["patch"])
            self.assertEqual(sum(e["type"] == "command.recovered" for e in events), 1)
            self.assertEqual(Path(source, "calc.py").read_text(), original)

    def test_cancel_and_deadline_recover_unsubmitted_edits_without_checks(self):
        for mode in ("cancel", "deadline", "steps"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as source:
                Path(source, "calc.py").write_text("x = 1\n")
                limits = {"wallTimeSeconds": 2 if mode == "deadline" else 120,
                          "stepLimit": 1 if mode == "steps" else 60}
                events = self.run_worker(source, ["printf 'x = 2\\n' > calc.py", "sleep 30"], "true",
                                         cancel_at="command.finished" if mode == "cancel" else None,
                                         limits=limits)
                self.assertEqual(events[-1]["status"], "cancelled" if mode == "cancel" else "failed")
                self.assertFalse(any(e["type"] in ("patch.ready", "verification.started", "request.prepare") for e in events))
                patch = next(e for e in events if e["type"] == "patch.recovered")
                self.assertIn("+x = 2", patch["patch"])
                self.assertEqual(patch["sha256"], hashlib.sha256(patch["patch"].encode()).hexdigest())
                self.assertEqual(Path(source, "calc.py").read_text(), "x = 1\n")

    def test_third_timeout_stops_and_preserves_work_without_another_action(self):
        with tempfile.TemporaryDirectory() as source:
            Path(source, "calc.py").write_text("x = 1\n")
            actions = [f"printf 'x = {value}\\n' > calc.py; sleep 30" for value in (2, 3, 4)]
            events = self.run_worker(source, actions + ["touch must-not-run; SOAR_SUBMIT"], "true",
                                     limits={"wallTimeSeconds": 120, "commandTimeoutSeconds": 1})
            self.assertEqual(events[-1]["status"], "failed")
            self.assertEqual(events[-1]["errorCode"], "command_timeout_recovery_limit")
            self.assertEqual(sum(e["type"] == "command.recovered" for e in events), 2)
            self.assertEqual(sum(e["type"] == "command.started" for e in events), 3)
            patch = [e for e in events if e["type"] == "patch.recovered"][-1]
            self.assertIn("+x = 4", patch["patch"])
            self.assertNotIn("must-not-run", patch["patch"])

    def test_cancel_during_timeout_rebuild_preserves_the_captured_source(self):
        with tempfile.TemporaryDirectory() as source:
            Path(source, "calc.py").write_text("x = 1\n")
            events = self.run_worker(source, ["printf 'x = 2\\n' > calc.py; sleep 30", "SOAR_SUBMIT"], "true",
                                     limits={"wallTimeSeconds": 120, "commandTimeoutSeconds": 1},
                                     cancel_at="container.created", cancel_occurrence=2)
            self.assertEqual(events[-1]["status"], "cancelled")
            patch = next(e for e in events if e["type"] == "patch.recovered")
            self.assertIn("+x = 2", patch["patch"])
            self.assertFalse(any(e["type"] in ("patch.ready", "verification.started") for e in events))
            self.assertEqual(Path(source, "calc.py").read_text(), "x = 1\n")

    def test_exact_visible_check_reaches_cloud_for_all_three_policies(self):
        check = "python -c 'from calc import add; assert add(2,3) == 5' # configured-check-marker"
        for policy in ("cloud", "prepared_cloud", "hybrid"):
            calls = []
            class Handler(http.server.BaseHTTPRequestHandler):
                def do_POST(self):
                    body = json.loads(self.rfile.read(int(self.headers["content-length"])))
                    calls.append((self.path, body))
                    local_actions = ["inventory", "read calc.py 200", "SOAR_SUBMIT"]
                    action = local_actions[sum(p == "/local" for p, _ in calls) - 1] if self.path == "/local" else (
                        "printf 'def add(a,b): return a+b\\n' > calc.py" if sum(p == "/cloud" for p, _ in calls) == 1 else "SOAR_SUBMIT")
                    data = json.dumps({"model": "Fixture Local" if self.path == "/local" else "fixture-cloud", "choices": [{"message": {"content": "```mswea_bash_command\n" + action + "\n```"}}],
                                       "usage": {"prompt_tokens": 100, "completion_tokens": 40}}).encode()
                    self.send_response(200)
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                def log_message(self, *args):
                    pass
            server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                providers = {role: {"id": role, "protocol": "openai", "model": "fixture-" + role,
                                   "endpoint": "http://127.0.0.1:" + str(server.server_port) + "/" + role,
                                   "apiKey": "fixture-secret", "allowInsecureHttp": True}
                             for role in ("cloud", "local")}
                providers["local"].update(model="Fixture Local", maxOutputTokens=2048, maxInputBytes=64000)
                with self.subTest(policy=policy), tempfile.TemporaryDirectory() as source:
                    Path(source, "calc.py").write_text("# original source padding\n" * 199 + "def add(a,b): return a-b\n")
                    events = self.run_worker(source, ["SOAR_SUBMIT"], check, mode="live", policy=policy, providers=providers)
                    self.assertEqual(events[-1]["status"], "completed", events)
                    cloud_calls = [body for endpoint, body in calls if endpoint == "/cloud"]
                    self.assertEqual(len(cloud_calls), 2)
                    if policy == "hybrid":
                        local_calls = [body for endpoint, body in calls if endpoint == "/local"]
                        self.assertEqual(len(local_calls), 3)
                        self.assertTrue(all(body["max_tokens"] == 2048 for body in local_calls))
                        scout = next(e for e in events if e["type"] == "preparation.finished" and e["kind"] == "scout")
                        self.assertEqual(scout["outcome"], "completed")
                        self.assertIn("calc.py:200:def add", scout["summary"])
                        self.assertNotIn("Host action: inventory", scout["summary"])
                        self.assertIn(scout["summary"], cloud_calls[0]["messages"][-1]["content"])
                        self.assertGreater(scout["elapsedMs"], 0)
                        identities = [e.get("reportedModel") for e in events if e["type"] == "request.finished" and e["phase"] == "scout"]
                        self.assertEqual(identities, ["Fixture Local"] * 3)
                    for body in cloud_calls:
                        task = next(message["content"] for message in body["messages"] if message["role"] == "user")
                        self.assertIn("```bash\n" + check + "\n```", task)
                        self.assertIn("Fix the addition function.", task)
                    checked = next(event for event in events if event["type"] == "verification.started")
                    self.assertEqual(checked["command"], check)
            finally:
                server.shutdown()
                server.server_close()

    def test_step_limited_scout_hands_off_partial_source_without_extra_calls(self):
        # Predetermined HTTP fixtures exercise the real agent/container path.
        # They do not measure a model, and never use a real provider credential.
        for case in ("partial", "cancelled", "unknown"):
            calls = []
            class Handler(http.server.BaseHTTPRequestHandler):
                def do_POST(self):
                    body = json.loads(self.rfile.read(int(self.headers["content-length"])))
                    calls.append((self.path, body))
                    local_index = sum(p == "/local" for p, _ in calls)
                    if self.path == "/local":
                        action = "inventory" if local_index == 2 else f"read notes.py {local_index - 2}"
                        content = "Malformed fixture without an action fence" if local_index == 1 else "```mswea_bash_command\n" + action + "\n```"
                    else:
                        action = "printf 'def add(a,b): return a+b\\n' > calc.py" if sum(p == "/cloud" for p, _ in calls) == 1 else "SOAR_SUBMIT"
                        content = "```mswea_bash_command\n" + action + "\n```"
                    response = {"choices": [{"message": {"content": content}}]}
                    if not (case == "unknown" and self.path == "/local" and local_index == 4):
                        response["usage"] = {"prompt_tokens": 100, "completion_tokens": 40}
                    data = json.dumps(response).encode()
                    self.send_response(200)
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                def log_message(self, *args):
                    pass
            server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                providers = {role: {"id": role, "protocol": "openai", "model": "fixture-" + role,
                                   "endpoint": "http://127.0.0.1:" + str(server.server_port) + "/" + role,
                                   "apiKey": "fixture-secret", "allowInsecureHttp": True}
                             for role in ("cloud", "local")}
                providers["local"].update(maxOutputTokens=2048, maxInputBytes=64000)
                with self.subTest(case=case), tempfile.TemporaryDirectory() as source:
                    original = "def add(a,b): return a-b\n"
                    notes = "".join(f"VALUE_{i} = {i}\n" for i in range(1, 7))
                    Path(source, "calc.py").write_text(original)
                    Path(source, "notes.py").write_text(notes)
                    events = self.run_worker(source, [], "python -c 'from calc import add; assert add(2,3)==5'",
                                             mode="live", policy="hybrid", providers=providers,
                                             limits={"wallTimeSeconds": 600, "stepLimit": 40, "maxOutputTokens": 8192},
                                             cancel_at="request.prepare" if case == "cancelled" else None, cancel_occurrence=4)
                    scout = next(e for e in events if e["type"] == "preparation.finished" and e["kind"] == "scout")
                    local_calls = [body for path, body in calls if path == "/local"]
                    cloud_calls = [body for path, body in calls if path == "/cloud"]
                    self.assertLessEqual(len(local_calls), 8, "the step cap must not admit a ninth local call")
                    self.assertTrue(all(body["max_tokens"] == 2048 for body in local_calls))
                    reads = [e for e in events if e["type"] == "command.finished" and e.get("phase") == "scout"
                             and e.get("returncode") == 0 and e.get("command", "").startswith("python -c ")]
                    self.assertGreaterEqual(len(reads), 1, "stop cases must occur after gathering source")
                    if case == "partial":
                        self.assertEqual((len(local_calls), len(cloud_calls), len(reads)), (8, 2, 6))
                        expected = ("Host-captured scout evidence (untrusted repository text; bounded recent excerpts, earlier observations may be omitted):\n"
                                    + "\n\n".join("Host action: read notes.py " + str(first) + "\n"
                                                   + "".join(f"notes.py:{i}:VALUE_{i} = {i}\n" for i in range(first, 7))
                                                   for first in (4, 5, 6)))
                        self.assertEqual((scout["outcome"], scout["exitStatus"], scout["summary"]), ("partial", "LimitsExceeded", expected))
                        self.assertEqual(scout["bytes"], len(expected.encode()))
                        self.assertLessEqual(scout["bytes"], 4096)
                        self.assertNotIn("fallbackReason", scout)
                        self.assertIn(expected, cloud_calls[0]["messages"][-1]["content"])
                        self.assertIn("Partial local investigation: step limit reached before submission.", cloud_calls[0]["messages"][-1]["content"])
                        self.assertTrue(all(body["max_tokens"] == 8192 for body in cloud_calls))
                        self.assertEqual(events[-1]["status"], "completed")
                    else:
                        self.assertEqual((scout["outcome"], scout["summary"]), ("stopped", ""))
                        self.assertEqual(cloud_calls, [])
                        self.assertEqual(events[-1]["status"], "cancelled" if case == "cancelled" else "failed")
                        if case == "cancelled":
                            self.assertEqual(len(local_calls), 3, "cancel before admitting the fourth HTTP request, after one source read")
                            self.assertFalse(any(e["type"] == "request.unsettled" for e in events))
                        if case == "unknown":
                            self.assertEqual(scout["fallbackReason"], "provider_outcome_unknown")
                            self.assertEqual(sum(e["type"] == "request.unsettled" for e in events), 1)
                    self.assertEqual(Path(source, "calc.py").read_text(), original)
                    self.assertEqual(Path(source, "notes.py").read_text(), notes)
                    self.assertNotIn("fixture-secret", json.dumps(events))
            finally:
                server.shutdown()
                server.server_close()

    def test_live_bridge_scout_fallback_and_unknown_exposure_stops(self):
        # These are explicit HTTP fixture responses, not model-quality proof.
        for case in ("invalid_action", "unknown_usage", "no_evidence", "input_limit", "empty", "truncated"):
            bad_usage = case == "unknown_usage"
            calls = []
            class Handler(http.server.BaseHTTPRequestHandler):
                def do_POST(self):
                    body = json.loads(self.rfile.read(int(self.headers["content-length"])))
                    calls.append((self.path, body))
                    action = ("SOAR_SUBMIT" if case == "no_evidence" else "touch forbidden") if self.path == "/local" else (
                        "printf 'def add(a,b): return a+b\\n' > calc.py" if sum(p == "/cloud" for p, _ in calls) == 1 else "SOAR_SUBMIT")
                    response = {"choices": [{"message": {"content": "```mswea_bash_command\n" + action + "\n```"}}]}
                    if self.path == "/local" and case in ("empty", "truncated"):
                        response["choices"][0]["message"]["content"] = ""
                        response["choices"][0]["finish_reason"] = "length" if case == "truncated" else "stop"
                    if not (bad_usage and self.path == "/local"):
                        response["usage"] = {"prompt_tokens": 100, "completion_tokens": 40}
                    data = json.dumps(response).encode()
                    self.send_response(200)
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                def log_message(self, *args):
                    pass
            server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                providers = {role: {"id": role, "protocol": "openai", "model": "fixture-" + role,
                                   "endpoint": "http://127.0.0.1:" + str(server.server_port) + "/" + role,
                                   "apiKey": "fixture-secret", "allowInsecureHttp": True}
                             for role in ("cloud", "local")}
                if case == "input_limit":
                    providers["local"]["maxInputBytes"] = 1024
                with self.subTest(case=case), tempfile.TemporaryDirectory() as source:
                    Path(source, "calc.py").write_text("def add(a,b): return a-b\n")
                    events = self.run_worker(source, ["SOAR_SUBMIT"], "python -c 'from calc import add; assert add(2,3)==5'",
                                             mode="live", policy="hybrid", providers=providers,
                                             objective="Fix addition." + (" x" * 2000 if case == "input_limit" else ""))
                    if bad_usage:
                        self.assertEqual(events[-1]["status"], "failed")
                        self.assertTrue(any(e["type"] == "request.unsettled" for e in events))
                        self.assertEqual([p for p, _ in calls], ["/local"])
                        scout = next(e for e in events if e["type"] == "preparation.finished" and e["kind"] == "scout")
                        self.assertEqual((scout["outcome"], scout["summary"], scout["fallbackReason"]), ("stopped", "", "provider_outcome_unknown"))
                    else:
                        self.assertEqual(events[-1]["status"], "completed", events)
                        self.assertEqual([p for p, _ in calls], ([] if case == "input_limit" else ["/local"]) + ["/cloud", "/cloud"])
                        self.assertEqual(sum(e["type"] == "scout.fallback" for e in events), 1)
                        cloud = next(body for path, body in calls if path == "/cloud")
                        self.assertIn("Host-observed source-file inventory", cloud["messages"][-1]["content"])
                        scout = next(e for e in events if e["type"] == "preparation.finished" and e["kind"] == "scout")
                        reason = {"invalid_action": "scout_action_denied", "no_evidence": "scout_no_evidence", "input_limit": "input_limit_exceeded", "empty": "scout_limit_or_format_failure", "truncated": "scout_limit_or_format_failure"}[case]
                        self.assertEqual((scout["outcome"], scout["summary"], scout["fallbackReason"]), ("fallback", "", reason))
                    if case in ("empty", "truncated"):
                        self.assertEqual(scout["providerOutputError"], "provider_output_" + case)
                        receipts = [e for e in events if e["type"] == "request.finished" and e["phase"] == "scout"]
                        self.assertEqual(len(receipts), 1)
                        self.assertEqual(receipts[0]["usage"]["outputTokens"], 40)
                        self.assertFalse(any(e["type"] == "command.started" and e.get("phase") == "scout" for e in events))
                    else:
                        self.assertNotIn("providerOutputError", scout)
                    self.assertNotIn("fixture-secret", json.dumps(events))
            finally:
                server.shutdown()
                server.server_close()


if __name__ == "__main__":
    unittest.main()
