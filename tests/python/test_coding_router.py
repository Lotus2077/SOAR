"""Routing/checkpoint contracts. No provider, Docker, clock or source execution."""

from dataclasses import FrozenInstanceError
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("coding_router", ROOT / "runtime/patch-worker/coding_router.py")
router = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(router)
A, B = "a" * 64, "b" * 64
CHECK = "python public_cases.py"
PLANNER_SHA = "c" * 64
LEGACY_POLICIES = ("local_only", "local_first", "cloud_plan_local", "cloud_plan_local_review")


class CodingRouterTests(unittest.TestCase):
    def new(self, policy="local_first"):
        return router.CodingRouter(policy, A, CHECK)

    def stop_error(self, code, function, *args, **kwargs):
        with self.assertRaises(router.RouterError) as caught:
            function(*args, **kwargs)
        self.assertEqual(caught.exception.code, code)

    def request(self, policy, event, **overrides):
        reserve = {"remaining_seconds": 600, "request_timeout_seconds": 120,
                   "check_reserve_seconds": 60, "remaining_model_calls": 40}
        return policy.before_local_request(event, **{**reserve, **overrides})

    def command(self, policy, index, *, command=None, output="ok", code=0, tree=A):
        self.request(policy, "request-" + str(index))
        policy.authorize_action("run_command")
        return policy.observe_command("action-" + str(index), command or "inspect " + str(index), output, code, tree)

    def check(self, policy, index, *, code=0, before=A, after=A, completed=True, timed_out=False):
        self.request(policy, "request-" + str(index))
        policy.authorize_action("run_visible_checks")
        return policy.observe_visible_check("check-" + str(index), CHECK, "check output", code, before, after,
                                            completed=completed, timed_out=timed_out)

    def help(self, policy):
        policy.before_local_request("help-request")
        return policy.request_help("help-action", "I need help with the public task.")

    def handoff(self, policy, event="handoff", **changes):
        fields = {"request_settled": True, "cancelled": False, "remaining_model_calls": 1,
                  "remaining_seconds": 210, "request_timeout_seconds": 180, "check_reserve_seconds": 30}
        fields.update(changes)
        return policy.confirm_handoff(event, **fields)

    def planner_policy(self, name="cloud_plan_local"):
        policy = router.CodingRouter(name, A, CHECK, check_schedule="host_repair_window")
        policy.mark_cloud_plan_complete("plan", request_settled=True, planner_checks_sha256=PLANNER_SHA)
        return policy

    def planner_receipt(self, **changes):
        return {"artifactSha256": PLANNER_SHA, "sourceSha256": A, "sourceAfterSha256": A,
                "passed": True, "completed": True, "timedOut": False, **changes}

    def open_planner_check(self, policy, host):
        if host:
            for index in range(1, 5):
                self.command(policy, index)
            policy.begin_host_check("host-begin")
        else:
            self.request(policy, "explicit-request")

    def test_three_exact_unchanged_observations_checkpoint_before_paid_dispatch(self):
        policy = self.new()
        one = self.command(policy, 1, command="inspect", output="same")
        two = self.command(policy, 2, command="inspect", output="same")
        three = self.command(policy, 3, command="inspect", output="same")
        self.assertEqual([x.decision for x in (one, two, three)], ["continue", "continue", "checkpoint"])
        self.assertEqual(three.reason, "repeated_observation")
        self.assertEqual(three.to_dict()["duplicateObservations"], 3)
        self.assertTrue(three.to_dict()["handoffCandidate"])
        self.assertFalse(three.to_dict()["handoffUsed"])
        self.stop_error("router_not_local", policy.before_local_request, "must-not-dispatch")
        approved = self.handoff(policy)
        self.assertEqual((approved.decision, policy.state), ("escalate", "cloud"))
        self.assertEqual(approved.to_dict()["evidence"]["checkpointEvidenceId"], three.evidence_id)
        self.stop_error("router_no_handoff_checkpoint", self.handoff, policy, "second-handoff")
        self.stop_error("router_not_local", policy.before_local_request, "local-after-cloud")

    def test_tree_output_command_and_exit_changes_reset_repetition(self):
        for changed in ({"tree": B}, {"output": "different"}, {"command": "other"}, {"code": 1}):
            with self.subTest(changed=changed):
                policy = self.new()
                self.command(policy, 1, command="inspect")
                self.command(policy, 2, command="inspect")
                result = self.command(policy, 3, **{"command": "inspect", **changed})
                self.assertEqual(result.decision, "continue")
                self.assertLess(result.to_dict()["duplicateObservations"], 3)
                self.assertEqual(result.to_dict()["evidence"]["sourceChanged"], "tree" in changed)

    def test_call_23_is_reserved_for_check_and_24_for_fresh_submit(self):
        policy = self.new()
        for i in range(1, 23):
            decision = self.command(policy, i)
        self.assertEqual(decision.reason, "finish_required")
        self.assertEqual(policy.remaining_local_calls, 2)
        request = policy.before_local_request("request-23")
        self.assertEqual(request.to_dict()["allowedActions"], ["run_visible_checks", "request_help"])
        self.stop_error("router_action_not_allowed", policy.authorize_action, "run_command")
        policy.observe_visible_check("check-23", CHECK, "pass", 0, A, A, completed=True)
        self.assertEqual(policy.remaining_local_calls, 1)
        self.assertEqual(policy.allowed_actions, ("submit_task", "request_help"))
        policy.before_local_request("request-24")
        self.stop_error("router_action_not_allowed", policy.authorize_action, "run_visible_checks")
        submitted = policy.submit("submit-24", A)
        self.assertEqual(submitted.decision, "submit")
        self.assertEqual(submitted.to_dict()["checkSourceSha256"], A)
        self.assertEqual(policy.local_calls, 24)
        self.stop_error("router_not_local", policy.before_local_request, "request-25")

    def test_local_only_accepts_bounded_call_limits_and_binds_initial_evidence(self):
        for limit in range(2, 25):
            with self.subTest(limit=limit):
                policy = router.CodingRouter("local_only", A, CHECK, local_call_limit=limit)
                initial = policy.latest_decision.to_dict()
                self.assertEqual(initial["evidence"]["maxLocalCalls"], limit)
                self.assertEqual(initial["evidence"]["finishReserve"], 2)
                self.assertEqual((initial["localCalls"], initial["remainingLocalCalls"]), (0, limit))
                self.assertEqual(policy.local_call_limit, limit)
        for invalid in (None, True, False, 0, 1, 25, 8.0, "8"):
            with self.subTest(invalid=invalid), self.assertRaises(router.RouterError):
                router.CodingRouter("local_only", A, CHECK, local_call_limit=invalid)
        with self.assertRaises(TypeError):
            router.CodingRouter("local_only", A, CHECK, 8)

    def test_lower_local_budget_cannot_change_a_cloud_capable_policy(self):
        for name in LEGACY_POLICIES:
            with self.subTest(policy=name):
                implicit = router.CodingRouter(name, A, CHECK)
                explicit = router.CodingRouter(name, A, CHECK, local_call_limit=24)
                self.assertEqual(implicit.decisions, explicit.decisions)
                self.assertEqual(implicit.local_call_limit, 24)
                self.assertEqual(implicit.remaining_local_calls, 24)
                if name != "local_only":
                    for limit in (2, 8, 23):
                        with self.subTest(limit=limit), self.assertRaises(router.RouterError):
                            router.CodingRouter(name, A, CHECK, local_call_limit=limit)

    def test_eight_call_budget_reserves_seven_for_check_and_eight_for_submit(self):
        policy = router.CodingRouter("local_only", A, CHECK, local_call_limit=8)
        for i in range(1, 7):
            decision = self.command(policy, i)
        self.assertEqual((decision.reason, policy.remaining_local_calls), ("finish_required", 2))
        seventh = policy.before_local_request("request-7")
        self.assertEqual(seventh.to_dict()["allowedActions"], ["run_visible_checks", "request_help"])
        self.stop_error("router_action_not_allowed", policy.authorize_action, "run_command")
        policy.observe_visible_check("check-7", CHECK, "pass", 0, A, A, completed=True)
        self.assertEqual(policy.allowed_actions, ("submit_task", "request_help"))
        policy.before_local_request("request-8")
        for denied in ("run_command", "run_visible_checks"):
            self.stop_error("router_action_not_allowed", policy.authorize_action, denied)
        submitted = policy.submit("submit-8", A)
        self.assertEqual((submitted.decision, policy.local_calls, policy.remaining_local_calls), ("submit", 8, 0))
        self.stop_error("router_not_local", policy.before_local_request, "request-9")
        for decision in policy.decisions:
            wire = decision.to_dict()
            self.assertEqual(wire["localCalls"] + wire["remainingLocalCalls"], 8)
            self.assertFalse(wire["handoffCandidate"])
            self.assertFalse(wire["handoffUsed"])

    def test_repair_window_forces_check_five_then_permits_repair_check_and_submit(self):
        policy = router.CodingRouter("local_only", A, CHECK, local_call_limit=8, check_schedule="repair_window")
        for index in range(1, 5):
            self.command(policy, index, tree=B)
        self.assertEqual(policy.allowed_actions, ("run_visible_checks", "request_help"))
        request = self.request(policy, "request-5")
        self.assertEqual(request.to_dict()["allowedActions"], ["run_visible_checks", "request_help"])
        self.stop_error("router_action_not_allowed", policy.authorize_action, "run_command")
        failed = policy.observe_visible_check("check-5", CHECK, "AttributeError", 1, B, B, completed=True)
        self.assertEqual((failed.decision, policy.remaining_local_calls), ("continue", 3))
        self.assertEqual(policy.allowed_actions, ("run_command", "run_visible_checks", "request_help"))
        self.command(policy, 6, tree=A)
        self.assertEqual(policy.allowed_actions, ("run_visible_checks", "request_help"))
        self.check(policy, 7)
        self.assertEqual(policy.allowed_actions, ("submit_task", "request_help"))
        self.request(policy, "request-8")
        self.assertEqual(policy.submit("submit-8", A).decision, "submit")
        self.assertEqual(policy.local_calls, 8)
        for decision in policy.decisions:
            record = decision.to_dict()
            self.assertEqual(record["evidence"]["checkSchedule"], "repair_window")
            self.assertEqual(record["localCalls"] + record["remainingLocalCalls"], 8)
        self.stop_error("router_not_local", self.request, policy, "request-9")

    def test_repair_window_does_not_repeat_an_earlier_failed_check(self):
        policy = router.CodingRouter("local_only", A, CHECK, local_call_limit=8, check_schedule="repair_window")
        self.command(policy, 1)
        self.command(policy, 2)
        self.check(policy, 3, code=1)
        self.command(policy, 4)
        self.assertEqual(policy.allowed_actions, ("run_command", "run_visible_checks", "request_help"))
        self.command(policy, 5, tree=B)
        self.assertEqual(policy.local_calls, 5)

    def test_repair_window_fresh_pass_allows_submit_but_later_edit_invalidates_it(self):
        policy = router.CodingRouter("local_only", A, CHECK, local_call_limit=8, check_schedule="repair_window")
        for index in range(1, 5):
            self.command(policy, index)
        self.check(policy, 5)  # Passing unchanged seed is only a check, never a submission.
        self.assertEqual(policy.state, "local")
        self.assertIn("submit_task", policy.allowed_actions)
        self.command(policy, 6, tree=B)
        self.assertIsNone(policy.check_source_sha256)
        self.assertNotIn("submit_task", policy.allowed_actions)
        failed = self.check(policy, 7, code=1, before=B, after=B)
        self.assertEqual((failed.decision, failed.reason), ("checkpoint", "finish_reserve_exhausted"))
        self.stop_error("router_not_local", self.request, policy, "request-8")

    def test_repair_window_does_not_force_check_when_a_passing_check_is_fresh(self):
        policy = router.CodingRouter("local_only", A, CHECK, local_call_limit=8, check_schedule="repair_window")
        for index in range(1, 4):
            self.command(policy, index)
        self.check(policy, 4)
        self.assertEqual(policy.remaining_local_calls, 4)
        self.assertEqual(policy.allowed_actions, ("run_command", "run_visible_checks", "submit_task", "request_help"))

    def test_check_schedule_defaults_and_invalid_policy_or_budgets(self):
        for name in LEGACY_POLICIES:
            implicit = router.CodingRouter(name, A, CHECK)
            explicit = router.CodingRouter(name, A, CHECK, check_schedule="final_only")
            self.assertEqual(implicit.decisions, explicit.decisions)
            if name != "local_only":
                self.stop_error("router_check_schedule_budget_or_policy", router.CodingRouter,
                                name, A, CHECK, check_schedule="repair_window")
        for calls in (2, 3, 4):
            self.stop_error("router_check_schedule_budget_or_policy", router.CodingRouter,
                            "local_only", A, CHECK, local_call_limit=calls, check_schedule="repair_window")
        router.CodingRouter("local_only", A, CHECK, local_call_limit=5, check_schedule="repair_window")
        for schedule in (None, True, False, 1, "", "early", [], {}):
            self.stop_error("router_check_schedule", router.CodingRouter, "local_only", A, CHECK, check_schedule=schedule)

    def test_host_window_supports_existing_native_policy_budgets_only(self):
        for name in LEGACY_POLICIES:
            with self.subTest(policy=name):
                policy = router.CodingRouter(name, A, CHECK, check_schedule="host_repair_window")
                self.assertFalse(policy.should_run_host_check())
                if policy.state == "planner":
                    self.stop_error("router_not_local", policy.begin_host_check, "before-plan")
                    policy.mark_cloud_plan_complete("plan", request_settled=True)
                for index in range(1, 5):
                    self.command(policy, index)
                self.assertTrue(policy.should_run_host_check())
                began = policy.begin_host_check("host-begin")
                self.assertEqual((began.reason, policy.local_calls, policy.remaining_local_calls),
                                 ("host_check_started", 4, 20))
                if name != "local_only":
                    self.stop_error("router_local_call_limit_policy", router.CodingRouter,
                                    name, A, CHECK, local_call_limit=8, check_schedule="host_repair_window")
        for limit in (2, 3, 4):
            self.stop_error("router_check_schedule_budget_or_policy", router.CodingRouter,
                            "local_only", A, CHECK, local_call_limit=limit, check_schedule="host_repair_window")

    def test_host_window_requires_exact_observed_boundary_across_caps(self):
        for limit in range(5, 25):
            with self.subTest(limit=limit):
                policy = router.CodingRouter("local_only", A, CHECK, local_call_limit=limit,
                                             check_schedule="host_repair_window")
                threshold = min(4, limit - 4)
                for index in range(1, threshold + 1):
                    self.assertFalse(policy.should_run_host_check())
                    self.stop_error("router_host_check_not_due", policy.begin_host_check, "too-soon")
                    self.request(policy, "request-" + str(index))
                    self.assertFalse(policy.should_run_host_check())
                    self.stop_error("router_request_pending", policy.begin_host_check, "in-flight")
                    policy.observe_command("action-" + str(index), "inspect " + str(index), "ok", 0, A)
                self.assertTrue(policy.should_run_host_check())
                self.stop_error("router_host_check_required", self.request, policy, "bypass-host")
                self.assertEqual(policy.local_calls, threshold)
                begin = policy.begin_host_check("host-begin").to_dict()
                self.assertEqual(begin["allowedActions"], [])
                self.assertEqual(begin["evidence"], {"checkSchedule": "host_repair_window",
                    "hostCheckUsed": True, "visibleCommandSha256": hashlib.sha256(CHECK.encode()).hexdigest()})
                self.assertFalse(policy.should_run_host_check())
                passed = policy.observe_visible_check("host-result", CHECK, "pass", 0, A, A,
                                                       completed=True, host=True)
                self.assertEqual((passed.reason, policy.local_calls), ("visible_check_passed", threshold))
                self.assertIn("submit_task", policy.allowed_actions)
                self.request(policy, "submit-request")
                self.assertEqual(policy.submit("submitted", A).decision, "submit")
                self.assertEqual(policy.local_calls, threshold + 1)
                for decision in policy.decisions:
                    record = decision.to_dict()
                    self.assertEqual(record["localCalls"] + record["remainingLocalCalls"], limit)
                    self.assertEqual(record["evidence"]["hostCheckUsed"], record["sequence"] >= begin["sequence"])

    def test_active_host_check_blocks_every_model_action_and_duplicate_start(self):
        policy = router.CodingRouter("local_only", A, CHECK, local_call_limit=5, check_schedule="host_repair_window")
        self.command(policy, 1)
        policy.begin_host_check("host-begin")
        self.stop_error("router_event_reused", policy.begin_host_check, "host-begin")
        self.stop_error("router_host_check_pending", policy.begin_host_check, "second-start")
        self.stop_error("router_host_check_pending", self.request, policy, "request-during-check")
        for action in ("run_command", "run_visible_checks", "submit_task", "request_help"):
            self.stop_error("router_host_check_pending", policy.authorize_action, action)
        self.stop_error("router_host_check_pending", policy.observe_command, "command", "edit", "ok", 0, B)
        self.stop_error("router_host_check_pending", policy.observe_visible_check, "forged-model-check",
                        CHECK, "pass", 0, A, A, completed=True)
        self.stop_error("router_host_check_pending", policy.submit, "submit", A)
        self.stop_error("router_host_check_pending", policy.request_help, "help", "help")
        self.assertEqual((policy.local_calls, policy.source_sha256, policy.check_source_sha256), (1, A, None))
        self.assertEqual(policy.latest_decision.reason, "host_check_started")
        policy.observe_visible_check("host-result", CHECK, "pass", 0, A, A, completed=True, host=True)
        self.stop_error("router_event_reused", policy.observe_visible_check, "host-result",
                        CHECK, "pass", 0, A, A, completed=True, host=True)
        self.stop_error("router_no_pending_host_check", policy.observe_visible_check, "second-result",
                        CHECK, "pass", 0, A, A, completed=True, host=True)
        self.stop_error("router_host_check_not_due", policy.begin_host_check, "repeat-check")

    def test_host_check_requires_exact_command_and_source_without_mutating_on_denial(self):
        policy = router.CodingRouter("local_only", A, CHECK, local_call_limit=5, check_schedule="host_repair_window")
        self.stop_error("router_no_pending_host_check", policy.observe_visible_check, "orphan",
                        CHECK, "pass", 0, A, A, completed=True, host=True)
        self.request(policy, "request-1")
        self.stop_error("router_no_pending_host_check", policy.observe_visible_check, "forged-host",
                        CHECK, "pass", 0, A, A, completed=True, host=True)
        policy.observe_command("action-1", "edit", "ok", 0, B)
        began = policy.begin_host_check("host-begin")
        self.stop_error("router_visible_command_mismatch", policy.observe_visible_check, "other-command",
                        CHECK + " ", "pass", 0, B, B, completed=True, host=True)
        self.stop_error("router_host_check_source_mismatch", policy.observe_visible_check, "stale-source",
                        CHECK, "pass", 0, A, A, completed=True, host=True)
        self.stop_error("router_boolean", policy.observe_visible_check, "invalid-host",
                        CHECK, "pass", 0, B, B, completed=True, host=1)
        self.assertEqual(policy.latest_decision, began)
        self.assertEqual((policy.source_sha256, policy.check_source_sha256, policy.allowed_actions), (B, None, ()))
        self.assertEqual(policy.observe_visible_check("host-result", CHECK, "pass", 0, B, B,
                                                     completed=True, host=True).reason, "visible_check_passed")

    def test_host_failed_or_mutating_check_preserves_repair_budget_and_requires_fresh_recheck(self):
        for code, after, reason in ((1, A, "visible_check_failed"), (0, B, "visible_check_tree_changed")):
            with self.subTest(reason=reason):
                policy = router.CodingRouter("local_only", A, CHECK, local_call_limit=8,
                                             check_schedule="host_repair_window")
                for index in range(1, 5):
                    self.command(policy, index)
                policy.begin_host_check("host-begin")
                failed = policy.observe_visible_check("host-result", CHECK, "failed", code, A, after,
                                                       completed=True, host=True).to_dict()
                self.assertEqual((failed["reason"], failed["failedChecks"], policy.local_calls), (reason, 1, 4))
                self.assertIsNone(policy.check_source_sha256)
                self.assertFalse(policy.should_run_host_check())
                self.command(policy, 5, tree=B)
                self.check(policy, 6, before=B, after=B)
                self.request(policy, "submit-request")
                self.assertEqual(policy.submit("submitted", B).decision, "submit")
                self.assertEqual(policy.local_calls, 7)

    def test_host_check_failure_counts_toward_existing_two_failure_gate(self):
        policy = router.CodingRouter("local_first", A, CHECK, check_schedule="host_repair_window")
        for index in range(1, 5):
            self.command(policy, index)
        policy.begin_host_check("host-begin")
        policy.observe_visible_check("host-result", CHECK, "failed", 1, A, A, completed=True, host=True)
        failed = self.check(policy, 5, code=1)
        self.assertEqual((failed.decision, failed.reason, policy.local_calls), ("checkpoint", "visible_checks_failed", 5))
        self.assertFalse(policy.should_run_host_check())
        self.assertFalse(failed.to_dict()["handoffUsed"])
        self.assertEqual(self.handoff(policy).decision, "escalate")

    def test_host_check_pass_is_invalidated_by_later_source_edits(self):
        policy = router.CodingRouter("local_only", A, CHECK, local_call_limit=8, check_schedule="host_repair_window")
        for index in range(1, 5):
            self.command(policy, index)
        policy.begin_host_check("host-begin")
        policy.observe_visible_check("host-result", CHECK, "pass", 0, A, A, completed=True, host=True)
        self.command(policy, 5, tree=B)
        self.assertIsNone(policy.check_source_sha256)
        self.assertNotIn("submit_task", policy.allowed_actions)
        self.assertFalse(policy.should_run_host_check())
        self.command(policy, 6, tree=A)
        self.assertEqual(policy.allowed_actions, ("run_visible_checks", "request_help"))
        self.check(policy, 7)
        self.request(policy, "request-8")
        self.assertEqual(policy.submit("submitted", A).decision, "submit")

    def test_fresh_or_failed_boundary_check_skips_host_window_without_late_revival(self):
        for code in (0, 1):
            with self.subTest(code=code):
                policy = router.CodingRouter("local_only", A, CHECK, local_call_limit=8,
                                             check_schedule="host_repair_window")
                for index in range(1, 4):
                    self.command(policy, index)
                self.check(policy, 4, code=code)
                self.assertFalse(policy.should_run_host_check())
                self.stop_error("router_host_check_not_due", policy.begin_host_check, "skip-check")
                self.command(policy, 5, tree=B)
                self.assertFalse(policy.should_run_host_check())
                self.stop_error("router_host_check_not_due", policy.begin_host_check, "late-check")
                self.assertFalse(policy.latest_decision.to_dict()["evidence"]["hostCheckUsed"])

    def test_stale_earlier_pass_still_runs_host_check_at_initial_boundary(self):
        policy = router.CodingRouter("local_only", A, CHECK, local_call_limit=8, check_schedule="host_repair_window")
        self.check(policy, 1)
        for index in range(2, 5):
            self.command(policy, index, tree=B)
        self.assertTrue(policy.should_run_host_check())
        policy.begin_host_check("host-begin")
        self.assertEqual(policy.observe_visible_check("host-result", CHECK, "pass", 0, B, B,
                                                     completed=True, host=True).reason, "visible_check_passed")

    def test_host_timeout_incomplete_and_cancellation_stop_without_retry_or_extra_call(self):
        for outcome in ("timeout", "incomplete", "cancelled", "episode_deadline", "accounting_failure"):
            with self.subTest(outcome=outcome):
                policy = router.CodingRouter("local_only", A, CHECK, local_call_limit=5,
                                             check_schedule="host_repair_window")
                self.command(policy, 1)
                policy.begin_host_check("host-begin")
                if outcome in ("timeout", "incomplete"):
                    terminal = policy.observe_visible_check("host-result", CHECK, "partial", 0, A, A,
                        completed=outcome != "incomplete", timed_out=outcome == "timeout", host=True)
                    expected = "check_timeout" if outcome == "timeout" else "unknown_outcome"
                else:
                    terminal = policy.stop("host-stop", outcome)
                    expected = outcome
                self.assertEqual((terminal.decision, terminal.reason, policy.local_calls), ("stop", expected, 1))
                self.assertTrue(terminal.to_dict()["evidence"]["hostCheckUsed"])
                self.assertIsNone(policy.check_source_sha256)
                self.assertFalse(policy.should_run_host_check())
                self.stop_error("router_not_local", self.request, policy, "retry")
                self.stop_error("router_not_local", policy.begin_host_check, "retry-host")
                self.stop_error("router_no_handoff_checkpoint", self.handoff, policy)

    def test_legacy_schedules_have_no_host_window_or_host_evidence(self):
        for schedule in ("final_only", "repair_window"):
            policy = router.CodingRouter("local_only", A, CHECK, local_call_limit=8, check_schedule=schedule)
            for index in range(1, 5):
                self.command(policy, index)
            self.assertFalse(policy.should_run_host_check())
            self.stop_error("router_host_check_not_due", policy.begin_host_check, "host-attempt")
            for decision in policy.decisions:
                self.assertNotIn("hostCheckUsed", decision.to_dict()["evidence"])

    def test_planner_artifact_binds_once_only_after_settled_planning_in_host_profile(self):
        for name in ("cloud_plan_local", "cloud_plan_local_review"):
            policy = self.planner_policy(name)
            self.assertNotIn("plannerChecksSha256", policy.decisions[0].to_dict()["evidence"])
            self.assertEqual(policy.latest_decision.to_dict()["evidence"]["plannerChecksSha256"], PLANNER_SHA)
            self.stop_error("router_not_planner", policy.mark_cloud_plan_complete, "replacement-plan",
                            request_settled=True, planner_checks_sha256=A)
            policy.stop("end", "cancelled")
            self.assertEqual(policy.latest_decision.to_dict()["evidence"]["plannerChecksSha256"], PLANNER_SHA)
        for name in ("local_only", "local_first"):
            policy = router.CodingRouter(name, A, CHECK, check_schedule="host_repair_window")
            self.stop_error("router_not_planner", policy.mark_cloud_plan_complete, "plan",
                            request_settled=True, planner_checks_sha256=PLANNER_SHA)
        policy = self.new("cloud_plan_local")
        self.stop_error("router_planner_check_policy", policy.mark_cloud_plan_complete, "plan",
                        request_settled=True, planner_checks_sha256=PLANNER_SHA)
        for invalid in ("", "A" * 64, "x" * 64, True, 1, []):
            policy = router.CodingRouter("cloud_plan_local", A, CHECK, check_schedule="host_repair_window")
            self.stop_error("router_source_hash", policy.mark_cloud_plan_complete, "bad-plan",
                            request_settled=True, planner_checks_sha256=invalid)
            self.assertEqual(policy.state, "planner")
        for fields in ({"cancelled": True, "request_settled": True}, {"request_settled": False}):
            policy = router.CodingRouter("cloud_plan_local", A, CHECK, check_schedule="host_repair_window")
            stopped = policy.mark_cloud_plan_complete("failed-plan", planner_checks_sha256=PLANNER_SHA, **fields)
            self.assertEqual(stopped.decision, "stop")
            self.assertNotIn("plannerChecksSha256", stopped.to_dict()["evidence"])

    def test_planner_and_visible_passes_allow_host_and_explicit_submission_with_full_binding(self):
        for host in (False, True):
            with self.subTest(host=host):
                policy = self.planner_policy()
                self.open_planner_check(policy, host)
                count = policy.local_calls
                result = policy.observe_visible_check("combined-check", CHECK, "pass", 0, A, A,
                    completed=True, host=host, planner_check=self.planner_receipt()).to_dict()
                self.assertEqual((result["reason"], policy.check_source_sha256, policy.local_calls),
                                 ("visible_check_passed", A, count))
                evidence = result["evidence"]
                self.assertEqual({key: evidence[key] for key in evidence if key.startswith("planner")},
                    {"plannerChecksSha256": PLANNER_SHA, "plannerCheckPassed": True,
                     "plannerCheckCompleted": True, "plannerCheckTimedOut": False,
                     "plannerCheckSourceBeforeSha256": A, "plannerCheckSourceAfterSha256": A})
                self.request(policy, "submit-request")
                self.assertEqual(policy.submit("submitted", A).decision, "submit")
                for decision in policy.decisions[1:]:
                    self.assertEqual(decision.to_dict()["evidence"]["plannerChecksSha256"], PLANNER_SHA)

    def test_planner_completed_failure_or_mutation_cannot_pass_or_change_retained_source(self):
        for host in (False, True):
            for generated_after in (A, B):
                with self.subTest(host=host, mutation=generated_after == B):
                    policy = self.planner_policy()
                    self.open_planner_check(policy, host)
                    count = policy.local_calls
                    failed = policy.observe_visible_check("combined-check", CHECK, "visible pass", 0, A, A,
                        completed=True, host=host,
                        planner_check=self.planner_receipt(passed=False, sourceAfterSha256=generated_after)).to_dict()
                    self.assertEqual((failed["reason"], failed["failedChecks"], policy.local_calls),
                                     ("planner_check_failed", 1, count))
                    self.assertEqual(policy.source_sha256, A)
                    self.assertIsNone(policy.check_source_sha256)
                    self.assertNotIn("submit_task", policy.allowed_actions)
                    self.request(policy, "second-check-request")
                    second = policy.observe_visible_check("second-check", CHECK, "visible pass", 0, A, A,
                        completed=True, planner_check=self.planner_receipt(passed=False))
                    self.assertEqual((second.decision, second.reason), ("checkpoint", "visible_checks_failed"))
                    self.assertEqual(second.to_dict()["failedChecks"], 2)

    def test_visible_failure_keeps_original_reason_and_one_failure_with_planner_failure(self):
        for code, visible_after, expected in ((1, A, "visible_check_failed"), (0, B, "visible_check_tree_changed")):
            for generated_passed in (False, True):
                with self.subTest(expected=expected, generated_passed=generated_passed):
                    policy = self.planner_policy()
                    self.open_planner_check(policy, False)
                    result = policy.observe_visible_check("combined-check", CHECK, "visible failed", code, A, visible_after,
                        completed=True, planner_check=self.planner_receipt(passed=generated_passed)).to_dict()
                    self.assertEqual((result["reason"], result["failedChecks"]), (expected, 1))
                    self.assertEqual(policy.source_sha256, visible_after)
                    self.assertIsNone(policy.check_source_sha256)

    def test_planner_timeout_and_incomplete_results_stop_host_and_explicit_paths(self):
        for host in (False, True):
            for timed_out, completed in ((True, True), (True, False), (False, False)):
                with self.subTest(host=host, timed_out=timed_out, completed=completed):
                    policy = self.planner_policy()
                    self.open_planner_check(policy, host)
                    count = policy.local_calls
                    result = policy.observe_visible_check("combined-check", CHECK, "visible pass", 0, A, A,
                        completed=True, host=host,
                        planner_check=self.planner_receipt(passed=False, completed=completed, timedOut=timed_out))
                    expected = "check_timeout" if timed_out else "planner_check_invalid"
                    self.assertEqual((result.decision, result.reason, policy.local_calls), ("stop", expected, count))
                    self.assertIsNone(policy.check_source_sha256)
                    self.stop_error("router_not_local", self.request, policy, "retry")
                    self.stop_error("router_no_handoff_checkpoint", self.handoff, policy)

    def test_visible_terminal_failure_has_no_fabricated_generated_execution(self):
        for timed_out, completed, reason in ((True, True, "check_timeout"), (False, False, "unknown_outcome")):
            policy = self.planner_policy()
            self.open_planner_check(policy, False)
            self.stop_error("router_planner_check_unexpected", policy.observe_visible_check, "fabricated-result",
                CHECK, "partial visible", 0, A, A, completed=completed, timed_out=timed_out,
                planner_check=self.planner_receipt(passed=False, completed=False))
            result = policy.observe_visible_check("combined-check", CHECK, "partial visible", 0, A, A,
                completed=completed, timed_out=timed_out)
            self.assertEqual((result.decision, result.reason), ("stop", reason))
            self.assertEqual(result.to_dict()["evidence"]["plannerChecksSha256"], PLANNER_SHA)
            self.assertNotIn("plannerCheckPassed", result.to_dict()["evidence"])
            self.assertEqual(result.to_dict()["failedChecks"], 0)

    def test_bound_planner_check_requires_exact_receipt_shape_types_artifact_and_source(self):
        missing_key = self.planner_receipt()
        del missing_key["completed"]
        invalid = [(None, "router_planner_check_required"), ({}, "router_planner_check_shape"),
                   ([], "router_planner_check_shape"), (missing_key, "router_planner_check_shape"),
                   (self.planner_receipt(extra=True), "router_planner_check_shape"),
                   (self.planner_receipt(artifactSha256=B), "router_planner_check_artifact_mismatch"),
                   (self.planner_receipt(sourceSha256=B), "router_planner_check_source_mismatch")]
        for field in ("artifactSha256", "sourceSha256", "sourceAfterSha256"):
            invalid.append((self.planner_receipt(**{field: "invalid"}), "router_source_hash"))
        for field in ("passed", "completed", "timedOut"):
            for bad in (1, None, "true"):
                invalid.append((self.planner_receipt(**{field: bad}), "router_boolean"))
        for change in ({"completed": False}, {"timedOut": True}, {"sourceAfterSha256": B}):
            invalid.append((self.planner_receipt(**change), "router_planner_check_pass_invalid"))
        for host in (False, True):
            policy = self.planner_policy()
            self.open_planner_check(policy, host)
            original = policy.latest_decision
            for receipt, error in invalid:
                with self.subTest(host=host, error=error, receipt=receipt):
                    self.stop_error(error, policy.observe_visible_check, "invalid-check", CHECK, "pass", 0, A, A,
                                    completed=True, host=host, planner_check=receipt)
                    self.assertEqual(policy.latest_decision, original)
                    self.assertEqual(policy.source_sha256, A)
                    self.assertIsNone(policy.check_source_sha256)

    def test_unbound_planner_receipt_is_rejected_without_changing_legacy_wire(self):
        for schedule in ("final_only", "host_repair_window"):
            one = router.CodingRouter("cloud_plan_local", A, CHECK, check_schedule=schedule)
            two = router.CodingRouter("cloud_plan_local", A, CHECK, check_schedule=schedule)
            one.mark_cloud_plan_complete("plan", request_settled=True)
            two.mark_cloud_plan_complete("plan", request_settled=True, planner_checks_sha256=None)
            for policy in (one, two):
                self.request(policy, "check-request")
                self.stop_error("router_planner_check_unexpected", policy.observe_visible_check, "foreign-check",
                                CHECK, "pass", 0, A, A, completed=True, planner_check=self.planner_receipt())
            one.observe_visible_check("check", CHECK, "pass", 0, A, A, completed=True)
            two.observe_visible_check("check", CHECK, "pass", 0, A, A, completed=True, planner_check=None)
            self.assertEqual(one.decisions, two.decisions)
            for decision in one.decisions:
                self.assertFalse(any(key.startswith("planner") for key in decision.to_dict()["evidence"]))

    def test_planner_freshness_rejects_stale_pair_then_requires_new_source_pass(self):
        policy = self.planner_policy()
        self.open_planner_check(policy, False)
        policy.observe_visible_check("first-check", CHECK, "pass", 0, A, A, completed=True,
                                     planner_check=self.planner_receipt())
        self.command(policy, 2, tree=B)
        self.assertIsNone(policy.check_source_sha256)
        self.request(policy, "new-check-request")
        self.stop_error("router_planner_check_source_mismatch", policy.observe_visible_check, "stale-check",
                        CHECK, "pass", 0, A, A, completed=True, planner_check=self.planner_receipt())
        self.assertEqual(policy.source_sha256, B)
        result = policy.observe_visible_check("new-check", CHECK, "pass", 0, B, B, completed=True,
            planner_check=self.planner_receipt(sourceSha256=B, sourceAfterSha256=B))
        self.assertEqual((result.reason, policy.check_source_sha256), ("visible_check_passed", B))

    def test_planner_binding_survives_required_review_and_handoff(self):
        policy = self.planner_policy("cloud_plan_local_review")
        self.open_planner_check(policy, False)
        policy.observe_visible_check("combined-check", CHECK, "pass", 0, A, A, completed=True,
                                     planner_check=self.planner_receipt())
        self.request(policy, "submit-request")
        self.assertEqual(policy.submit("provisional-submit", A).reason, "review_required")
        self.assertEqual(self.handoff(policy).decision, "escalate")
        for decision in policy.decisions[1:]:
            self.assertEqual(decision.to_dict()["evidence"]["plannerChecksSha256"], PLANNER_SHA)

    def test_planner_bound_stop_clears_prior_pass_when_recheck_observation_is_interrupted(self):
        for reason in ("cancelled", "execution_failure"):
            with self.subTest(reason=reason):
                policy = self.planner_policy()
                self.open_planner_check(policy, False)
                passed = policy.observe_visible_check("combined-pass", CHECK, "pass", 0, A, A,
                    completed=True, planner_check=self.planner_receipt())
                self.request(policy, "recheck-request")
                self.assertEqual(policy.check_source_sha256, A)
                # The host has begun rechecking this tree; cancellation or a
                # verifier failure arrives before observe_visible_check can run.
                stopped = policy.stop("recheck-interrupted", reason).to_dict()
                self.assertEqual((stopped["decision"], stopped["reason"], stopped["localCalls"]), ("stop", reason, 2))
                self.assertIsNone(stopped["checkSourceSha256"])
                self.assertEqual(stopped["sourceSha256"], A)
                self.assertEqual(stopped["failedChecks"], 0)
                self.assertEqual(stopped["evidence"]["plannerChecksSha256"], PLANNER_SHA)
                self.assertEqual(passed.to_dict()["checkSourceSha256"], A)
                self.stop_error("router_not_local", self.request, policy, "retry")

    def test_planner_bound_cloud_stop_clears_provisional_pass_after_final_check_failure(self):
        for reason in ("cancelled", "execution_failure"):
            with self.subTest(reason=reason):
                policy = self.planner_policy("cloud_plan_local_review")
                self.open_planner_check(policy, False)
                policy.observe_visible_check("combined-pass", CHECK, "pass", 0, A, A, completed=True,
                                             planner_check=self.planner_receipt())
                self.request(policy, "submit-request")
                policy.submit("provisional-submit", A)
                self.handoff(policy)
                self.assertEqual((policy.state, policy.check_source_sha256), ("cloud", A))
                # Final cloud verification is host-owned; its failure must not
                # leave the earlier local pass eligible in the stop checkpoint.
                stopped = policy.stop("final-check-stopped", reason).to_dict()
                self.assertEqual((stopped["state"], stopped["reason"], stopped["localCalls"]), ("stopped", reason, 2))
                self.assertIsNone(stopped["checkSourceSha256"])
                self.assertTrue(stopped["handoffUsed"])
                self.assertEqual(stopped["sourceSha256"], A)
                self.assertEqual(stopped["evidence"]["plannerChecksSha256"], PLANNER_SHA)

    def test_unbound_stop_retains_legacy_check_source_behavior(self):
        for schedule in ("final_only", "repair_window", "host_repair_window"):
            for reason in ("cancelled", "execution_failure"):
                with self.subTest(schedule=schedule, reason=reason):
                    policy = router.CodingRouter("local_only", A, CHECK, check_schedule=schedule)
                    self.check(policy, 1)
                    self.request(policy, "recheck-request")
                    stopped = policy.stop("stopped", reason).to_dict()
                    self.assertEqual(stopped["checkSourceSha256"], A)
                    self.assertNotIn("plannerChecksSha256", stopped["evidence"])

    def test_failed_or_mutating_seventh_check_does_not_spend_eighth_call(self):
        for code, after in ((1, A), (0, B)):
            with self.subTest(code=code, after=after):
                policy = router.CodingRouter("local_only", A, CHECK, local_call_limit=8)
                for i in range(1, 7):
                    self.command(policy, i)
                result = self.check(policy, 7, code=code, after=after)
                self.assertEqual((result.decision, result.reason), ("checkpoint", "finish_reserve_exhausted"))
                self.assertEqual((policy.local_calls, policy.remaining_local_calls), (7, 1))
                self.assertIsNone(policy.check_source_sha256)
                self.assertFalse(result.to_dict()["handoffCandidate"])
                self.stop_error("router_not_local", policy.before_local_request, "request-8")
                stopped = self.handoff(policy)
                self.assertEqual((stopped.decision, stopped.reason), ("stop", "local_only_checkpoint"))

    def test_two_call_minimum_can_check_and_submit_without_editing(self):
        policy = router.CodingRouter("local_only", A, CHECK, local_call_limit=2)
        self.assertEqual(policy.allowed_actions, ("run_visible_checks", "request_help"))
        self.check(policy, 1)
        policy.before_local_request("request-2")
        self.assertEqual(policy.submit("submit-2", A).decision, "submit")
        self.assertEqual((policy.local_calls, policy.remaining_local_calls), (2, 0))

    def test_failed_reserved_check_checkpoints_without_burning_submission_call(self):
        policy = self.new()
        for i in range(1, 23):
            self.command(policy, i)
        result = self.check(policy, 23, code=1)
        self.assertEqual(result.decision, "checkpoint")
        self.assertEqual(result.reason, "finish_reserve_exhausted")
        self.assertEqual(policy.local_calls, 23)
        self.assertEqual(result.to_dict()["failedChecks"], 1)

    def test_submission_requires_exact_fresh_trusted_check(self):
        policy = self.new()
        policy.before_local_request("first")
        self.stop_error("router_action_not_allowed", policy.submit, "too-soon", A)
        self.stop_error("router_visible_command_mismatch", policy.observe_visible_check, "piped-check", CHECK + " | tail", "pass", 0, A, A, completed=True)
        self.assertEqual(policy.local_calls, 1)
        self.assertIsNone(policy.check_source_sha256)
        policy.observe_visible_check("real-check", CHECK, "pass", 0, A, A, completed=True)
        policy.before_local_request("submit-request")
        self.stop_error("router_submission_requires_fresh_check", policy.submit, "changed-under-check", B)
        self.assertNotEqual(policy.state, "submitted")

    def test_any_observed_tree_mutation_invalidates_check_even_after_restore(self):
        policy = self.new()
        self.check(policy, 1)
        self.assertIn("submit_task", policy.allowed_actions)
        self.command(policy, 2, tree=B)
        self.assertIsNone(policy.check_source_sha256)
        self.command(policy, 3, tree=A)
        self.assertNotIn("submit_task", policy.allowed_actions)
        self.check(policy, 4)
        policy.before_local_request("submit")
        self.assertEqual(policy.submit("submitted", A).decision, "submit")

    def test_check_mutating_tree_cannot_pass_and_failures_are_cumulative(self):
        policy = self.new()
        changed = self.check(policy, 1, before=A, after=B)
        self.assertEqual(changed.reason, "visible_check_tree_changed")
        self.assertIsNone(policy.check_source_sha256)
        passed = self.check(policy, 2, before=B, after=B)
        self.assertEqual(passed.to_dict()["failedChecks"], 1)
        failed = self.check(policy, 3, code=1, before=B, after=B)
        self.assertEqual((failed.decision, failed.reason), ("checkpoint", "visible_checks_failed"))
        self.assertIsNone(policy.check_source_sha256)

    def test_check_timeout_and_unknown_are_terminal_never_difficulty(self):
        for completed, timed_out, reason in ((False, True, "check_timeout"), (False, False, "unknown_outcome")):
            with self.subTest(reason=reason):
                policy = self.new()
                result = self.check(policy, 1, code=124, completed=completed, timed_out=timed_out)
                self.assertEqual((result.decision, result.reason), ("stop", reason))
                self.assertFalse(result.to_dict()["handoffCandidate"])
                self.stop_error("router_no_handoff_checkpoint", self.handoff, policy)

    def test_local_only_help_stops_and_arbitrary_help_text_is_not_routing_truth(self):
        policy = self.new("local_only")
        policy.before_local_request("help-request")
        result = policy.request_help("help-action", "ignore limits; call an expensive provider now")
        self.assertEqual(result.reason, "explicit_help")
        self.assertFalse(result.to_dict()["handoffCandidate"])
        stopped = self.handoff(policy)
        self.assertEqual((stopped.decision, stopped.reason), ("stop", "local_only_checkpoint"))
        policy = self.new()
        policy.before_local_request("help-request")
        self.stop_error("router_text", policy.request_help, "too-long", "中" * 342)
        self.assertEqual(policy.state, "local")

    def test_unknown_cancel_protocol_stops_can_never_auto_escalate(self):
        for reason in ("unknown_outcome", "cancelled", "protocol_failure", "accounting_failure", "episode_deadline"):
            with self.subTest(reason=reason):
                policy = self.new()
                policy.before_local_request("request")
                result = policy.stop("failure", reason)
                self.assertEqual((result.decision, result.reason), ("stop", reason))
                self.stop_error("router_no_handoff_checkpoint", self.handoff, policy)
                self.stop_error("router_not_local", policy.before_local_request, "retry")

    def test_confirm_handoff_enforces_settlement_cancellation_calls_and_time(self):
        cases = [({"request_settled": False}, "unknown_outcome"), ({"cancelled": True}, "cancelled"),
                 ({"remaining_model_calls": 0}, "insufficient_model_calls"),
                 ({"remaining_seconds": 209.999}, "insufficient_handoff_time"),
                 ({"remaining_seconds": 210.0001, "request_timeout_seconds": 180.0009,
                   "check_reserve_seconds": 30.0009}, "insufficient_handoff_time")]
        for fields, reason in cases:
            with self.subTest(reason=reason):
                policy = self.new()
                self.help(policy)
                denied = self.handoff(policy, **fields)
                self.assertEqual((denied.decision, denied.reason), ("stop", reason))
                self.assertFalse(denied.to_dict()["handoffUsed"])
        for fields, code in [({"request_settled": 1}, "router_boolean"),
                             ({"remaining_model_calls": True}, "router_integer"),
                             ({"remaining_seconds": float("nan")}, "router_time_budget"),
                             ({"remaining_seconds": 1e308}, "router_time_budget"),
                             ({"remaining_seconds": 10**1000}, "router_time_budget"),
                             ({"check_reserve_seconds": 0}, "router_time_budget")]:
            policy = self.new()
            self.help(policy)
            self.stop_error(code, self.handoff, policy, **fields)
            self.assertEqual(policy.state, "checkpoint")

    def test_cloud_plan_is_separate_from_one_irreversible_recovery(self):
        policy = self.new("cloud_plan_local")
        self.assertEqual(policy.latest_decision.reason, "cloud_plan_required")
        self.assertEqual(policy.state, "planner")
        self.stop_error("router_not_local", policy.before_local_request, "premature")
        plan = policy.mark_cloud_plan_complete("plan-receipt", request_settled=True)
        self.assertEqual((plan.reason, policy.local_calls), ("cloud_plan_completed", 0))
        self.help(policy)
        self.assertEqual(self.handoff(policy).decision, "escalate")
        self.stop_error("router_not_planner", policy.mark_cloud_plan_complete, "another-plan", request_settled=True)
        unknown = self.new("cloud_plan_local").mark_cloud_plan_complete("unknown-plan", request_settled=False)
        self.assertEqual((unknown.decision, unknown.reason), ("stop", "unknown_outcome"))

    def test_reviewed_policy_checked_submission_remains_provisional_until_one_cloud_handoff(self):
        policy = self.new("cloud_plan_local_review")
        policy.mark_cloud_plan_complete("plan", request_settled=True)
        self.check(policy, 1)
        self.request(policy, "submit-request")
        decision = policy.submit("submit-action", A)
        self.assertEqual((decision.decision, decision.reason, policy.state), ("checkpoint", "review_required", "checkpoint"))
        self.assertEqual(decision.to_dict()["evidence"], {"checkSourceSha256": A, "checkSchedule": "final_only"})
        self.assertEqual(decision.to_dict()["checkSourceSha256"], A)
        self.assertTrue(decision.to_dict()["handoffCandidate"])
        self.assertFalse(decision.to_dict()["handoffUsed"])
        self.stop_error("router_not_local", self.request, policy, "no-local-bypass")
        self.assertEqual(self.handoff(policy).decision, "escalate")
        self.stop_error("router_no_handoff_checkpoint", self.handoff, policy, "second")

    def test_reviewed_policy_requires_fresh_source_and_known_settled_handoff(self):
        for failure in ("changed-source", "unknown", "cancelled"):
            with self.subTest(failure=failure):
                policy = self.new("cloud_plan_local_review")
                policy.mark_cloud_plan_complete("plan", request_settled=True)
                self.check(policy, 1)
                self.request(policy, "submit-request")
                if failure == "changed-source":
                    self.stop_error("router_submission_requires_fresh_check", policy.submit, "submit-action", B)
                    self.assertEqual(policy.state, "local")
                else:
                    policy.submit("submit-action", A)
                    decision = self.handoff(policy, **({"request_settled": False} if failure == "unknown" else {"cancelled": True}))
                    self.assertEqual(decision.decision, "stop")
                    self.assertFalse(decision.to_dict()["handoffUsed"])

    def test_review_reserve_checkpoints_before_counting_next_local_request(self):
        for seconds, proceed in ((359.999, False), (360, False), (360.001, True)):
            with self.subTest(seconds=seconds):
                policy = self.new("cloud_plan_local_review")
                policy.mark_cloud_plan_complete("plan", request_settled=True)
                decision = self.request(policy, "request", remaining_seconds=seconds)
                self.assertEqual(policy.local_calls, int(proceed))
                if proceed:
                    self.assertEqual(decision.reason, "local_request_started")
                else:
                    self.assertEqual((decision.decision, decision.reason), ("checkpoint", "review_time_reserve"))
                    evidence = decision.to_dict()["evidence"]
                    self.assertEqual(evidence["requiredReviewReserveMs"], 360000)
                    self.assertTrue(decision.to_dict()["handoffCandidate"])
                    self.assertEqual(self.handoff(policy).decision, "escalate")
        policy = self.new("cloud_plan_local")
        policy.mark_cloud_plan_complete("old-plan", request_settled=True)
        self.assertEqual(self.request(policy, "old-request", remaining_seconds=1).reason, "local_request_started")

    def test_review_reserve_requires_safe_host_time_and_preserves_one_cloud_call(self):
        policy = self.new("cloud_plan_local_review")
        policy.mark_cloud_plan_complete("plan", request_settled=True)
        self.stop_error("router_time_budget", policy.before_local_request, "no-reserve")
        self.stop_error("router_time_budget", self.request, policy, "infinite", remaining_seconds=float("inf"))
        self.stop_error("router_integer", self.request, policy, "bool-calls", remaining_model_calls=True)
        self.stop_error("router_time_budget", self.request, policy, "overflow", request_timeout_seconds=(2**53 - 1) / 1000,
                        check_reserve_seconds=(2**53 - 1) / 1000)
        self.assertEqual(policy.local_calls, 0)
        decision = self.request(policy, "last-call", remaining_model_calls=1)
        self.assertEqual((decision.decision, decision.reason, policy.local_calls), ("checkpoint", "insufficient_model_calls", 0))
        self.assertEqual(decision.to_dict()["evidence"]["remainingModelCalls"], 1)
        self.assertEqual(self.handoff(policy, remaining_model_calls=1).decision, "escalate")

    def test_old_cloud_plan_policy_still_submits_locally(self):
        policy = self.new("cloud_plan_local")
        policy.mark_cloud_plan_complete("plan", request_settled=True)
        self.check(policy, 1)
        policy.before_local_request("submit")
        self.assertEqual(policy.submit("done", A).decision, "submit")
        self.assertEqual(policy.state, "submitted")

    def test_pending_and_reused_events_cannot_double_count_or_reexecute(self):
        policy = self.new()
        self.stop_error("router_no_pending_request", policy.observe_command, "orphan", "ls", "ok", 0, A)
        policy.before_local_request("request")
        self.stop_error("router_request_pending", policy.before_local_request, "concurrent")
        self.assertEqual(policy.local_calls, 1)
        policy.observe_command("action", "ls", "ok", 0, A)
        self.stop_error("router_event_reused", policy.before_local_request, "request")
        self.stop_error("router_event_reused", policy.observe_command, "action", "ls", "ok", 0, A)
        self.assertEqual(policy.local_calls, 1)

    def test_decision_chain_is_immutable_deterministic_and_safe_integer_json(self):
        one, two = self.new(), self.new()
        for policy in (one, two):
            self.command(policy, 1, output="中文\nexact output")
            self.help(policy)
            self.handoff(policy, remaining_seconds=210.001)
        self.assertEqual(one.decisions, two.decisions)
        previous = None
        for sequence, decision in enumerate(one.decisions, 1):
            wire = decision.to_dict()
            self.assertEqual(wire["sequence"], sequence)
            self.assertEqual(wire["previousEvidenceId"], previous)
            expected = wire.pop("evidenceId")
            self.assertEqual(hashlib.sha256(router.canonical_json(wire).encode()).hexdigest(), expected)
            previous = expected
            self.assertIn(wire["reason"], router.REASONS)
            self.assertIn(wire["decision"], router.DECISIONS)
            self.assertIn(wire["state"], router.STATES)
            with self.assertRaises(FrozenInstanceError):
                decision.record_json = "changed"
        changed = one.latest_decision.to_dict()
        changed["evidence"]["remainingMs"] = 0
        self.assertEqual(one.latest_decision.to_dict()["evidence"]["remainingMs"], 210001)
        with self.assertRaises(AttributeError):
            one.policy = "local_only"


if __name__ == "__main__":
    unittest.main()
