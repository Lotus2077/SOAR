"""No-provider acceptance-runner proofs; real Docker checks are explicitly enabled."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / "scripts/evaluate-patch-screen.py"
SPEC = importlib.util.spec_from_file_location("patch_screen_evaluator", HELPER)
helper = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(helper)


class ReceiptTests(unittest.TestCase):
    def test_exit_zero_without_completed_tests_is_not_a_solve(self):
        for output in (b"", b'SOAR_EVALUATOR_RESULT={"passed":1,"testCount":1}\n'):
            self.assertEqual(helper.evaluated_outcome(0, output, "nonce=", 1)["exitCode"], 1)

    def test_only_one_complete_matching_test_receipt_can_pass(self):
        receipt = {"passed": 2, "testCount": 2, "failures": 0, "errors": 0, "skipped": 0}
        def output(value):
            return ("nonce=" + json.dumps(value) + "\n").encode()
        self.assertEqual(helper.evaluated_outcome(0, output(receipt), "nonce=", 2)["exitCode"], 0)
        self.assertEqual(helper.evaluated_outcome(0, output(receipt), "nonce=", 3)["exitCode"], 1)
        self.assertEqual(helper.evaluated_outcome(0, output(receipt) * 2, "nonce=", 2)["exitCode"], 1)
        for changed in ({**receipt, "testCount": 0, "passed": 0}, {**receipt, "skipped": 1}, {**receipt, "errors": 1}):
            self.assertEqual(helper.evaluated_outcome(0, output(changed), "nonce=")["exitCode"], 1)


@unittest.skipUnless(os.environ.get("SOAR_TEST_DOCKER_IMAGE"), "set SOAR_TEST_DOCKER_IMAGE for real Docker proof")
class EvaluatorDockerTests(unittest.TestCase):
    def fixture(self, folder, subject, extra=None, oracle_suffix=""):
        source = Path(folder) / "source"
        source.mkdir()
        (source / "subject.py").write_text(subject)
        for name, text in (extra or {}).items():
            (source / name).write_text(text)
        for args in (["init", "-q"], ["add", "."], ["-c", "user.name=Test", "-c", "user.email=test@invalid", "commit", "-qm", "fixture"]):
            subprocess.run(["git", "-C", str(source), *args], check=True, capture_output=True)
        revision = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
        oracle = Path(folder) / "oracle.py"
        oracle.write_text("import unittest\nfrom subject import value\n" + oracle_suffix +
                          "class Acceptance(unittest.TestCase):\n def test_value(self):\n  self.assertEqual(value, 1)\n")
        image = subprocess.check_output(["docker", "image", "inspect", "--format", "{{.Id}}", os.environ["SOAR_TEST_DOCKER_IMAGE"]], text=True).strip()
        return [sys.executable, str(HELPER), "--source", str(source), "--revision", revision, "--oracle", str(oracle),
                "--oracle-sha256", hashlib.sha256(oracle.read_bytes()).hexdigest(), "--image", image, "--expected-tests", "1"]

    def test_candidate_import_exit_zero_fails_without_a_harness_result(self):
        with tempfile.TemporaryDirectory() as folder:
            result = subprocess.run(self.fixture(folder, "import sys\nsys.exit(0)\n"), capture_output=True, text=True, timeout=45)
            receipt = json.loads(result.stdout.strip().splitlines()[-1])
            self.assertEqual(receipt["exitCode"], 1)
            self.assertEqual(receipt["testCount"], 0)
            self.assertFalse(receipt["harnessVerified"])
            self.assertEqual(receipt["failureKind"], "candidate")
            self.assertTrue(receipt["cleanupConfirmed"])

    def test_isolated_startup_ignores_candidate_sitecustomize_and_unittest_shadow(self):
        with tempfile.TemporaryDirectory() as folder:
            args = self.fixture(folder, "value=1\n", {"sitecustomize.py": "import os\nos._exit(0)\n", "unittest.py": "raise RuntimeError('candidate shadow')\n"})
            result = subprocess.run(args, capture_output=True, text=True, timeout=45)
            receipt = json.loads(result.stdout.strip().splitlines()[-1])
            self.assertEqual(receipt["exitCode"], 0)
            self.assertTrue(receipt["harnessVerified"])
            self.assertEqual(receipt["testCount"], 1)
            self.assertTrue(receipt["cleanupConfirmed"])

    def test_sigterm_preserves_an_infrastructure_failure_and_confirms_cleanup(self):
        with tempfile.TemporaryDirectory() as folder:
            before = set(subprocess.check_output(["docker", "ps", "-aq", "--filter", "label=soar.screen-evaluator=1"], text=True).split())
            args = self.fixture(folder, "value=1\n", oracle_suffix="import time\ntime.sleep(30)\n")
            process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    current = set(subprocess.check_output(["docker", "ps", "-aq", "--filter", "label=soar.screen-evaluator=1"], text=True).split())
                    if current - before:
                        break
                    time.sleep(0.05)
                else:
                    self.fail("Evaluator never created its sandbox")
                process.send_signal(signal.SIGTERM)
                stdout, stderr = process.communicate(timeout=30)
                receipt = json.loads(stdout.strip().splitlines()[-1])
                self.assertEqual(receipt["exitCode"], 1, stderr)
                self.assertEqual(receipt["failureKind"], "infrastructure")
                self.assertTrue(receipt["cleanupConfirmed"])
                after = set(subprocess.check_output(["docker", "ps", "-aq", "--filter", "label=soar.screen-evaluator=1"], text=True).split())
                self.assertFalse(after - before)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate(timeout=5)


if __name__ == "__main__":
    unittest.main()
