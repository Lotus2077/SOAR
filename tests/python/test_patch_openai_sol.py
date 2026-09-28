"""Direct OpenAI Sol protocol contracts. Mock transport only; no paid requests."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("patch_worker_sol", ROOT / "runtime/patch-worker/worker.py")
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)
os.environ["MSWEA_SILENT_STARTUP"] = "1"
CONFIG = tempfile.TemporaryDirectory(prefix="soar-sol-test-config-")
os.environ["MSWEA_GLOBAL_CONFIG_DIR"] = CONFIG.name


class SolProtocolTests(unittest.TestCase):
    def response(self, **changes):
        return {"model": "gpt-5.6-sol", "choices": [{"finish_reason": "stop", "message": {
            "content": "```mswea_bash_command\nSOAR_SUBMIT\n```"}}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 30,
                      "prompt_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 0},
                      "completion_tokens_details": {"reasoning_tokens": 25}}, **changes}

    def query(self, response, *, failure=None, provider_id="openai", model="gpt-5.6-sol"):
        sink = io.StringIO()
        class AdmittingBridge(worker.Bridge):
            def emit(self, event_type, **values):
                super().emit(event_type, **values)
                if event_type == "request.prepare":
                    self.inbox.put({"type": "request.admitted", "requestId": values["requestId"], "bodySha256": values["bodySha256"]})
        bridge = AdmittingBridge(sink=sink)
        bridge.secrets = ["fixture-secret-value"]
        opened = mock.MagicMock()
        opened.__enter__.return_value.read.return_value = json.dumps(response).encode()
        opener = mock.Mock()
        opener.open.return_value = opened
        with tempfile.TemporaryDirectory() as source:
            start = worker.validate_start({"type": "start", "runId": "sol-test", "mode": "live", "policy": "cloud",
                "workspace": source, "baseRevision": "abc123", "containerImage": "fixture:1", "objective": "Fix public code",
                "visibleTestCommand": "python -m unittest", "limits": {"maxOutputTokens": 8192, "maxInputBytes": 256000},
                "providers": {"cloud": {"id": provider_id, "protocol": "openai", "endpoint": "https://api.openai.com/v1/chat/completions",
                                        "model": model, "apiKey": "fixture-secret-value"}}})
            with mock.patch.object(worker.urllib.request, "build_opener", return_value=opener):
                if failure:
                    with self.assertRaisesRegex(worker.WorkerError, failure):
                        worker.ExactModel(bridge, start, "cloud").query([{"role": "user", "content": "Fix it. 中文"}])
                else:
                    result = worker.ExactModel(bridge, start, "cloud").query([{"role": "user", "content": "Fix it. 中文"}])
                    self.assertEqual(result["extra"]["actions"], [{"command": "SOAR_SUBMIT"}])
        self.assertEqual(opener.open.call_count, 1, "no automatic transport or model retries")
        events = [json.loads(line) for line in sink.getvalue().splitlines()]
        self.assertNotIn("fixture-secret-value", sink.getvalue())
        return events, opener.open.call_args.args[0].data

    def test_exact_body_uses_total_completion_cap_and_fixed_controls(self):
        events, sent = self.query(self.response())
        body = json.loads(sent)
        self.assertEqual(body, {"model": "gpt-5.6-sol", "messages": [{"role": "user", "content": "Fix it. 中文"}],
            "max_completion_tokens": 8192, "reasoning_effort": "medium", "service_tier": "default",
            "prompt_cache_options": {"mode": "explicit"}, "stream": False})
        self.assertEqual(sent, worker.canonical_json(events[0]["preparedRequest"]["body"]))
        self.assertEqual(hashlib.sha256(sent).hexdigest(), events[0]["bodySha256"])
        self.assertEqual(events[0]["estimatedInputTokens"], len(sent))
        self.assertEqual(events[1]["usage"], {"inputTokens": 100, "outputTokens": 30, "reasoningTokens": 25,
            "cacheReadTokens": 0, "cacheWriteTokens": 0, "reported": True})
        self.assertEqual(events[1]["reportedModel"], "gpt-5.6-sol")

    def test_legacy_openai_and_openrouter_keep_max_tokens(self):
        for provider_id, model in (("openai", "gpt-4.1-2025-04-14"), ("openrouter", "gpt-5.6-sol")):
            with self.subTest(provider_id=provider_id):
                _, sent = self.query(self.response(), provider_id=provider_id, model=model)
                body = json.loads(sent)
                self.assertIn("max_tokens", body)
                for field in ("max_completion_tokens", "reasoning_effort", "service_tier", "prompt_cache_options"):
                    self.assertNotIn(field, body)

    def test_truncated_action_is_settled_then_stopped_without_execution_or_retry(self):
        response = self.response()
        response["choices"][0]["finish_reason"] = "length"
        events, _ = self.query(response, failure="provider_output_truncated")
        self.assertEqual([event["type"] for event in events], ["request.prepare", "request.finished"])
        self.assertEqual(events[-1]["usage"]["outputTokens"], 30)

    def test_empty_output_is_settled_then_stopped(self):
        for choices in ([], [{"finish_reason": "stop", "message": {"content": None}}]):
            with self.subTest(choices=choices):
                events, _ = self.query(self.response(choices=choices), failure="provider_output_empty")
                self.assertEqual(events[-1]["type"], "request.finished")

    def test_usage_details_are_subsets_and_never_added_to_total_output(self):
        response = self.response()
        response["usage"]["prompt_tokens_details"] = {"cached_tokens": 40, "cache_write_tokens": 50}
        usage = worker.usage_from_response("openai", response)
        self.assertEqual((usage["inputTokens"], usage["cacheReadTokens"], usage["cacheWriteTokens"], usage["outputTokens"], usage["reasoningTokens"]),
                         (100, 40, 50, 30, 25))
        for details in ({"reasoning_tokens": 31}, {"reasoning_tokens": True}, [1]):
            with self.subTest(details=details):
                response["usage"]["completion_tokens_details"] = details
                with self.assertRaisesRegex(worker.WorkerError, "provider_usage_invalid"):
                    worker.usage_from_response("openai", response)
        response["usage"]["completion_tokens_details"] = {"reasoning_tokens": 25}
        response["usage"]["prompt_tokens_details"] = {"cached_tokens": 60, "cache_write_tokens": 50}
        with self.assertRaisesRegex(worker.WorkerError, "provider_usage_invalid"):
            worker.usage_from_response("openai", response)

    def test_invalid_usage_remains_unsettled(self):
        response = self.response()
        response["usage"]["completion_tokens_details"] = {"reasoning_tokens": 999}
        events, _ = self.query(response, failure="provider_usage_invalid")
        self.assertEqual(events[-1]["type"], "request.unsettled")

    def test_reported_model_metadata_never_emits_non_model_strings_or_credentials(self):
        for model in ("https://private.invalid", "fixture-secret-value", "model with spaces"):
            with self.subTest(model=model):
                events, _ = self.query(self.response(model=model))
                self.assertNotEqual(events[-1].get("reportedModel"), model)


if __name__ == "__main__":
    unittest.main()
