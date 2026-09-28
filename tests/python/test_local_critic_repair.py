"""Offline bounded critic lifecycle tests. No Docker or provider dispatch."""
import copy
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest import mock

from test_patch_worker import worker, config

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "runtime/patch-worker"))
from coding_router import CodingRouter, RouterError
from coding_execution import RoutingExecution, filtered_critic_response, tree_identity

A, B, C = "a" * 64, "b" * 64, "c" * 64
CHECK = "python public_cases.py"
PROVIDER = {"id": "fixture", "protocol": "openai", "model": "fixture-model",
    "endpoint": "http://127.0.0.1:1/completions", "allowInsecureHttp": True, "maxOutputTokens": 8192}


def digest(value):
    return hashlib.sha256(worker.canonical_json(value)).hexdigest()


def start(source, **changes):
    fields = {"mode": "live", "policy": "local_critic_repair", "baseRevision": "d" * 40,
        "providers": {"local": dict(PROVIDER), "cloud": dict(PROVIDER)},
        "limits": {"stepLimit": 13, "localStepLimit": 12, "wallTimeSeconds": 600,
            "maxOutputTokens": 8192, "maxInputBytes": 128000}, **changes}
    return config(source, **fields)


class CriticRouterTests(unittest.TestCase):
    def new(self):
        return CodingRouter("local_critic_repair", A, CHECK, local_call_limit=12)

    def request(self, router, name):
        return router.before_local_request(name, remaining_seconds=600, request_timeout_seconds=120,
            check_reserve_seconds=60, remaining_model_calls=13)

    def command(self, router, index, source=A):
        self.request(router, "request-" + str(index))
        return router.observe_command("command-" + str(index), "inspect " + str(index), "ok", 0, source)

    def check(self, router, index, source=A, code=0):
        self.request(router, "request-" + str(index))
        return router.observe_visible_check("check-" + str(index), CHECK, "result", code,
            source, source, completed=True)

    def draft(self, router, count=8):
        for index in range(1, count - 1):
            self.command(router, index)
        self.check(router, count - 1)
        self.request(router, "request-" + str(count))
        return router.submit("submit-draft", A)

    def begin(self, router):
        return router.mark_critic_started("critic-start", request_id="critic-request", source_sha256=A,
            patch_sha256=B, body_sha256=C, bundle_sha256=A)

    def verdict(self, router, value="repair_required", **changes):
        return router.mark_critic_complete("critic-result", **{"request_id": "critic-request",
            "source_sha256": A, "receipt_sha256": B, "verdict": value, "request_settled": True, **changes})

    def test_full_budget_is_eight_plus_four_without_reset_or_borrow(self):
        router = self.new()
        provisional = self.draft(router)
        self.assertEqual((provisional.reason, provisional.decision, router.state), ("critic_required", "checkpoint", "critic"))
        self.assertEqual((router.local_calls, router.remaining_local_calls), (8, 0))
        self.assertFalse(provisional.to_dict()["handoffCandidate"])
        self.begin(router)
        repair = self.verdict(router)
        self.assertEqual((router.local_calls, router.remaining_local_calls), (8, 4))
        self.assertIsNone(router.check_source_sha256)
        self.assertNotIn("submit_task", router.allowed_actions)
        self.assertEqual(repair.to_dict()["evidence"]["repairStartLocalCalls"], 8)
        self.command(router, 9, B)
        self.command(router, 10, B)
        self.assertNotIn("run_command", router.allowed_actions)
        self.check(router, 11, B)
        self.request(router, "request-12")
        final = router.submit("submit-repair", B)
        self.assertEqual((router.state, router.local_calls, router.remaining_local_calls), ("submitted", 12, 0))
        self.assertEqual(final.to_dict()["evidence"]["criticReceiptSha256"], B)
        self.assertEqual(final.to_dict()["evidence"]["phaseLocalCalls"], 4)
        with self.assertRaises(RouterError):
            self.request(router, "request-13-local")

    def test_early_draft_does_not_expand_repair_and_second_critic_is_denied(self):
        router = self.new()
        self.draft(router, count=3)
        self.begin(router)
        self.verdict(router)
        self.assertEqual((router.local_calls, router.remaining_local_calls), (3, 4))
        with self.assertRaises(RouterError):
            self.begin(router)
        with self.assertRaises(RouterError):
            self.verdict(router)
        self.command(router, 4)
        self.command(router, 5)
        self.assertEqual(router.remaining_local_calls, 2)
        self.request(router, "request-6")
        with self.assertRaises(RouterError):
            router.authorize_action("run_command")

    def test_acceptable_grants_final_submission_but_no_repair_or_cloud(self):
        router = self.new()
        self.draft(router, count=3)
        self.begin(router)
        result = self.verdict(router, "acceptable")
        self.assertEqual((result.decision, result.reason, router.local_calls), ("submit", "critic_acceptable", 3))
        with self.assertRaises(RouterError):
            self.request(router, "extra")
        with self.assertRaises(RouterError):
            router.confirm_handoff("cloud", request_settled=True, cancelled=False, remaining_model_calls=1,
                remaining_seconds=600, request_timeout_seconds=120, check_reserve_seconds=60)

    def test_stale_request_and_source_do_not_grant_repair(self):
        for changes in ({"source_sha256": B}, {"request_id": "wrong"}, {"receipt_sha256": "bad"}):
            with self.subTest(changes=changes):
                router = self.new()
                self.draft(router, count=3)
                self.begin(router)
                with self.assertRaises(RouterError):
                    self.verdict(router, **changes)
                self.assertEqual(router.state, "critic")
                self.assertEqual(router.remaining_local_calls, 5)

    def test_unknown_cancelled_and_insufficient_context_are_terminal(self):
        for value, changes, reason in (("repair_required", {"request_settled": False}, "unknown_outcome"),
                                      ("repair_required", {"cancelled": True}, "cancelled"),
                                      ("insufficient_context", {}, "critic_insufficient_context")):
            with self.subTest(reason=reason):
                router = self.new()
                self.draft(router, count=3)
                self.begin(router)
                result = self.verdict(router, value, **changes)
                self.assertEqual((result.decision, router.state, result.reason), ("stop", "stopped", reason))
                self.assertIsNone(router.check_source_sha256)

    def test_draft_reserves_critic_slot_and_time_before_counting(self):
        for changes, reason in (({"remaining_seconds": 360}, "critic_time_reserve"),
                                ({"remaining_model_calls": 1}, "insufficient_model_calls")):
            router = self.new()
            values = {"remaining_seconds": 600, "remaining_model_calls": 13, "request_timeout_seconds": 120,
                "check_reserve_seconds": 60, **changes}
            result = router.before_local_request("blocked", **values)
            self.assertEqual((result.reason, router.local_calls, result.to_dict()["handoffCandidate"]), (reason, 0, False))


class CriticTransportTests(unittest.TestCase):
    def test_profile_is_fixed_live_only_and_preserves_thirteenth_slot(self):
        with tempfile.TemporaryDirectory() as source:
            limits = start(source)["limits"]
            self.assertEqual((limits["stepLimit"], limits["localStepLimit"], limits["draftLocalStepLimit"],
                limits["repairLocalStepLimit"], limits["finishingReserve"]), (13, 12, 8, 4, 2))
            for changes in ({"mode": "scripted"}, {"limits": {"stepLimit": 12, "localStepLimit": 12}},
                            {"limits": {"stepLimit": 13, "localStepLimit": 8}},
                            {"limits": {"stepLimit": 13, "localStepLimit": 12, "draftLocalStepLimit": 9}},
                            {"limits": {"stepLimit": 13, "localStepLimit": 12, "localCoding": {"checkSchedule": "host_repair_window"}}}):
                with self.subTest(changes=changes), self.assertRaises(worker.WorkerError):
                    start(source, **changes)

    def test_shared_transport_stops_second_critic_extra_local_and_cloud_before_admission(self):
        with tempfile.TemporaryDirectory() as source:
            configured = start(source)
            body = {"model": "fixture-model", "max_tokens": 8192, "stream": False}
            configured.update(_modelCalls=8, _criticLocalCalls=8,
                _criticContext={"requestId": "critic", "bodySha256": digest(body)})
            bridge = worker.Bridge(sink=io.StringIO())
            bridge.deadline = time.monotonic() + 1000
            bridge.admit = mock.Mock(side_effect=worker.WorkerError("fixture_admission_stop"))
            critic = worker.ExactModel(bridge, configured, "critic")
            with self.assertRaisesRegex(worker.WorkerError, "fixture_admission_stop"):
                critic.complete_body(body, max_tokens=8192, request_id="critic")
            self.assertEqual((configured["_modelCalls"], configured["_criticRequests"]), (9, 1))
            with self.assertRaisesRegex(worker.WorkerError, "routing_critic_request_denied"):
                critic.complete_body(body, max_tokens=8192, request_id="critic")
            configured.update(_criticVerdict="repair_required", _criticRepairStartedAt=8)
            local = worker.ExactModel(bridge, configured, "local")
            for index in range(4):
                with self.assertRaisesRegex(worker.WorkerError, "fixture_admission_stop"):
                    local.complete_body(body, max_tokens=8192)
            self.assertEqual((configured["_modelCalls"], configured["_criticLocalCalls"]), (13, 12))
            with self.assertRaisesRegex(worker.WorkerError, "routing_critic_local_call_limit"):
                local.complete_body(body, max_tokens=8192)
            with self.assertRaisesRegex(worker.WorkerError, "routing_critic_phase_denied"):
                worker.ExactModel(bridge, configured, "cloud").complete_body(body, max_tokens=8192)
            self.assertEqual(bridge.admit.call_count, 5)

    def test_transport_requires_host_bound_critic_body_and_reserves_draft_time(self):
        with tempfile.TemporaryDirectory() as source:
            configured = start(source)
            bridge = worker.Bridge(sink=io.StringIO())
            bridge.deadline = time.monotonic() + 350
            bridge.admit = mock.Mock()
            with self.assertRaisesRegex(worker.WorkerError, "routing_critic_request_denied"):
                worker.ExactModel(bridge, configured, "critic").complete_body({}, max_tokens=8192)
            with self.assertRaisesRegex(worker.WorkerError, "routing_request_deadline_reserve"):
                worker.ExactModel(bridge, configured, "local").complete_body({}, max_tokens=8192)
            bridge.admit.assert_not_called()
            self.assertNotIn("_modelCalls", configured)

    def test_filtered_response_preserves_rejections_and_discards_private_fields(self):
        original = {"choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant",
            "content": "{}", "reasoning_content": "PRIVATE_SENTINEL"}}], "usage": {"private": "PRIVATE_SENTINEL"}}
        filtered = filtered_critic_response(original)
        self.assertNotIn("PRIVATE_SENTINEL", json.dumps(filtered))
        self.assertEqual(filtered["choices"][0]["message"], {"role": "assistant", "content": "{}"})
        for field, value in (("tool_calls", [{"arguments": "PRIVATE_SENTINEL"}]),
                             ("function_call", {"arguments": "PRIVATE_SENTINEL"}), ("refusal", "PRIVATE_SENTINEL")):
            rejected = copy.deepcopy(original)
            rejected["choices"][0]["message"][field] = value
            filtered = filtered_critic_response(rejected)
            self.assertTrue(filtered["choices"][0]["message"][field])
            self.assertNotIn("PRIVATE_SENTINEL", json.dumps(filtered))
        for bad in (None, {}, {"choices": []}, {"choices": [1]}, {"choices": [{"message": {"content": "x" * 32769}}]}):
            self.assertEqual(filtered_critic_response(bad), {"choices": []})


class CriticExecutionTests(unittest.TestCase):
    def execution(self, source, result, *, corrupt=None):
        candidate = Path(source) / "candidate"
        candidate.mkdir()
        (candidate / "value.py").write_text("answer = 2\n")
        source_sha, _ = tree_identity(candidate)
        configured = start(source)
        configured["_criticLocalCalls"] = 3
        configured["_modelCalls"] = 3
        execution = object.__new__(RoutingExecution)
        execution.start = configured
        execution.w = worker
        execution.candidate = candidate
        execution.environment = mock.Mock()
        execution.generated_checks = None
        execution.check_receipt = {"passed": True}
        execution.submitted = False
        execution.router = CodingRouter("local_critic_repair", source_sha, configured["visibleTestCommand"], local_call_limit=12)
        router = execution.router
        for request_id in ("inspect", "check", "submit"):
            router.before_local_request(request_id, remaining_seconds=600, request_timeout_seconds=120,
                check_reserve_seconds=60, remaining_model_calls=13)
            if request_id == "inspect":
                router.observe_command("inspect-action", "cat value.py", "answer = 2", 0, source_sha)
            elif request_id == "check":
                router.observe_visible_check("check-action", configured["visibleTestCommand"], "ok", 0,
                    source_sha, source_sha, completed=True)
            else:
                router.submit("submit-action", source_sha)
        events = []
        body = {"model": PROVIDER["model"], "max_tokens": 8192, "messages": [], "stream": False}
        bridge = worker.Bridge(sink=io.StringIO())
        bridge.deadline = time.monotonic() + 1000
        def emit(kind, **values):
            events.append({"type": kind, **values})
        def receive():
            event = events[-1]
            if event["type"] == "critic.context.prepare":
                reply = {**{key: event[key] for key in ("requestId", "sourceSha256", "patchSha256", "checkpointEvidenceId")},
                    "type": "critic.context.ready", "bundleSha256": B, "bodySha256": digest(body), "body": body}
                if corrupt == "context":
                    reply["sourceSha256"] = C
                if corrupt == "context_source":
                    (candidate / "value.py").write_text("changed = True\n")
                return reply
            reply = {**{key: event[key] for key in ("requestId", "sourceSha256", "patchSha256", "bundleSha256", "bodySha256", "responseSha256")},
                "type": "critic.verdict", "receiptSha256": C, "result": result}
            if corrupt == "verdict":
                reply["responseSha256"] = A
            if corrupt == "source":
                (candidate / "value.py").write_text("changed = True\n")
            return reply
        bridge.emit, bridge.receive = emit, receive
        execution.bridge = bridge
        execution.patch_from_candidate = mock.Mock(return_value="diff --git a/value.py b/value.py\n")
        execution.snapshot = mock.Mock(return_value=(source_sha, []))
        execution.reconstruct = mock.Mock()
        execution.local = mock.Mock()
        return execution, events

    def invoke(self, execution, events, result):
        model = mock.Mock()
        model.provider = PROVIDER
        def complete(body, **kwargs):
            execution.start["_modelCalls"] += 1
            execution.start["_criticRequests"] = 1
            events.append({"type": "request.finished", "requestId": kwargs["request_id"]})
            return {"choices": [{"index": 0, "finish_reason": "stop", "message": {
                "role": "assistant", "content": json.dumps(result), "reasoning_content": "PRIVATE_SENTINEL"}}]}
        model.complete_body.side_effect = complete
        with mock.patch.object(worker, "ExactModel", return_value=model):
            execution.critic()
        return model

    def test_acceptable_waits_for_host_verdict_and_never_reenters_local(self):
        result = {"verdict": "acceptable", "summary": "No supported defect.", "findings": [], "missingContext": []}
        with tempfile.TemporaryDirectory() as source:
            execution, events = self.execution(source, result)
            model = self.invoke(execution, events, result)
            self.assertTrue(execution.submitted)
            execution.local.assert_not_called()
            execution.reconstruct.assert_not_called()
            self.assertEqual(execution.router.local_calls, 3)
            self.assertEqual(model.complete_body.call_args.kwargs["max_tokens"], 8192)
            kinds = [event["type"] for event in events]
            self.assertLess(kinds.index("request.finished"), kinds.index("critic.response"))
            self.assertNotIn("patch.ready", kinds)
            self.assertNotIn("PRIVATE_SENTINEL", json.dumps(events))

    def test_repair_uses_actual_feedback_and_clears_previous_check_authority(self):
        result = {"verdict": "repair_required", "summary": "Fix the public behavior.", "findings": [
            {"path": "value.py", "revision": "candidate", "startLine": 1, "endLine": 1,
             "issue": "Observed defect.", "repair": "Actual host-bound repair instruction."}], "missingContext": []}
        with tempfile.TemporaryDirectory() as source:
            execution, events = self.execution(source, result)
            self.invoke(execution, events, result)
            execution.local.assert_called_once()
            self.assertEqual(execution.local.call_args.kwargs["critic_feedback"], result)
            self.assertEqual((execution.router.local_calls, execution.router.remaining_local_calls), (3, 4))
            self.assertEqual(execution.start["_criticRepairStartedAt"], 3)
            self.assertIsNone(execution.router.check_source_sha256)
            self.assertIsNone(execution.check_receipt)
            self.assertFalse(execution.submitted)

    def test_stale_context_verdict_or_source_never_grants_repair(self):
        result = {"verdict": "acceptable", "summary": "ok", "findings": [], "missingContext": []}
        for corrupt in ("context", "context_source", "verdict", "source"):
            with self.subTest(corrupt=corrupt), tempfile.TemporaryDirectory() as source:
                execution, events = self.execution(source, result, corrupt=corrupt)
                with self.assertRaises(worker.WorkerError):
                    self.invoke(execution, events, result)
                execution.local.assert_not_called()
                self.assertFalse(execution.submitted)

    def test_repair_loop_requires_host_grant_before_model_construction(self):
        result = {"verdict": "repair_required", "summary": "Fix this.", "findings": [], "missingContext": []}
        with tempfile.TemporaryDirectory() as source:
            execution, events = self.execution(source, result)
            self.invoke(execution, events, result)
            with mock.patch.object(worker, "ExactModel") as model:
                with self.assertRaisesRegex(worker.WorkerError, "routing_critic_repair_context_denied"):
                    RoutingExecution.local(execution, "value.py", "")
                execution.start["_criticVerdict"] = "acceptable"
                with self.assertRaisesRegex(worker.WorkerError, "routing_critic_repair_context_denied"):
                    RoutingExecution.local(execution, "value.py", "", critic_feedback=result)
                model.assert_not_called()

    def test_repair_native_body_has_actual_feedback_and_rejects_reused_tool_id(self):
        result = {"verdict": "repair_required", "summary": "Fix this.", "findings": [
            {"path": "value.py", "revision": "candidate", "startLine": 1, "endLine": 1,
             "issue": "Actual issue.", "repair": "Actual correction."}], "missingContext": []}
        with tempfile.TemporaryDirectory() as source:
            execution, events = self.execution(source, result)
            self.invoke(execution, events, result)
            execution.native_seen_call_ids = {"old-tool-id"}
            local_model = mock.Mock()
            local_model.provider = PROVIDER
            local_model.complete_body.return_value = {"choices": [{"finish_reason": "tool_calls", "message": {
                "role": "assistant", "content": None, "tool_calls": [{"id": "old-tool-id", "type": "function",
                "function": {"name": "run_command", "arguments": json.dumps({"command": "echo forbidden"})}}]}}],
                "usage": {"completion_tokens": 1}}
            with mock.patch.object(worker, "ExactModel", return_value=local_model):
                with self.assertRaises(Exception) as caught:
                    RoutingExecution.local(execution, "value.py", "", critic_feedback=result)
            self.assertEqual(getattr(caught.exception, "code", None), "native_call_id_reused")
            body = local_model.complete_body.call_args.args[0]
            self.assertEqual(len(body["messages"]), 2)
            self.assertIn("You have 4 local calls including two reserved finishing calls.", body["messages"][1]["content"])
            self.assertTrue(body["messages"][1]["content"].endswith("\nHost-parsed critique:\n" +
                json.dumps(result, ensure_ascii=False, separators=(",", ":"))))
            self.assertNotIn("submit_task", [tool["function"]["name"] for tool in body["tools"]])
            execution.environment.raw.assert_not_called()

    def test_direct_cloud_recovery_is_denied_without_container_work(self):
        execution = object.__new__(RoutingExecution)
        execution.start, execution.w = {"policy": "local_critic_repair"}, worker
        execution.snapshot = mock.Mock()
        with self.assertRaisesRegex(worker.WorkerError, "routing_critic_cloud_solver_denied"):
            execution.recover_cloud("inventory")
        execution.snapshot.assert_not_called()


if __name__ == "__main__":
    unittest.main()
