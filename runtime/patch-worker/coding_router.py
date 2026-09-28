"""Pure checkpoint policy; never dispatches, executes, checks files or reads time.

The host supplies trusted tree/check observations and must call authorize_action
before an external tool effect. Each request is counted before dispatch, including
failed requests. Protocol/accounting/cancellation failures terminate through stop;
they must never be converted into request_help. Checkpoint evidence is separate
from the explicit, guarded confirm_handoff operation. Persist every Decision in
order; its immutable canonical record forms a deterministic evidence hash chain.
"""

from dataclasses import dataclass
import hashlib
import json
import math
import re


POLICIES = ("local_only", "local_first", "cloud_plan_local", "cloud_plan_local_review", "local_critic_repair")
DECISIONS = ("continue", "checkpoint", "submit", "escalate", "stop")
STATES = ("planner", "local", "checkpoint", "cloud", "critic", "submitted", "stopped")
REASONS = (
    "initialized", "cloud_plan_required", "cloud_plan_completed", "local_request_started",
    "command_observed", "finish_required", "visible_check_passed", "visible_check_failed",
    "visible_check_tree_changed", "repeated_observation", "visible_checks_failed", "explicit_help",
    "local_call_limit", "finish_reserve_exhausted", "fresh_visible_check", "handoff_confirmed",
    "local_only_checkpoint", "cancelled", "unknown_outcome", "protocol_failure", "check_timeout",
    "episode_deadline", "accounting_failure", "execution_failure", "insufficient_model_calls",
    "insufficient_handoff_time", "review_required", "review_time_reserve", "host_check_started",
    "planner_check_failed", "planner_check_invalid",
    "critic_required", "critic_request_started", "critic_acceptable", "critic_repair_required",
    "critic_insufficient_context", "critic_time_reserve", "critic_policy_checkpoint",
)
STOP_REASONS = frozenset(("cancelled", "unknown_outcome", "protocol_failure", "check_timeout",
                          "episode_deadline", "accounting_failure", "execution_failure", "local_only_checkpoint",
                          "planner_check_invalid", "critic_policy_checkpoint"))
LOCAL_CALL_LIMIT = 24
FINISH_RESERVE = 2
DUPLICATE_LIMIT = 3
FAILED_CHECK_LIMIT = 2
MAX_HELP_BYTES = 1024


class RouterError(Exception):
    """Fixed invariant/shape error. Host treats this as terminal, never paid help."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def canonical_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _text(value, limit: int, *, nonblank=False) -> str:
    if not isinstance(value, str):
        raise RouterError("router_text")
    try:
        size = len(value.encode("utf-8"))
    except UnicodeError:
        raise RouterError("router_text") from None
    if size > limit or (nonblank and not value.strip()):
        raise RouterError("router_text")
    return value


def _hash(value) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value):
        raise RouterError("router_source_hash")
    return value


def _integer(value, low: int, high: int) -> int:
    if type(value) is not int or not low <= value <= high:
        raise RouterError("router_integer")
    return value


def _boolean(value) -> bool:
    if type(value) is not bool:
        raise RouterError("router_boolean")
    return value


def _milliseconds(value, *, positive=False) -> int:
    if type(value) not in (int, float):
        raise RouterError("router_time_budget")
    if value < 0 or value > (2**53 - 1) / 1000 or not math.isfinite(value) or (positive and value <= 0):
        raise RouterError("router_time_budget")
    # Round available time down and required reserves up, never borrowing from
    # the final check because fractional seconds were independently truncated.
    milliseconds = math.ceil(value * 1000) if positive else math.floor(value * 1000)
    if milliseconds > 2**53 - 1:
        raise RouterError("router_time_budget")
    return milliseconds


@dataclass(frozen=True)
class Decision:
    """Immutable wire record. to_dict returns a fresh copy, never shared state."""

    record_json: str

    def to_dict(self) -> dict:
        return json.loads(self.record_json)

    @property
    def decision(self) -> str:
        return self.to_dict()["decision"]

    @property
    def reason(self) -> str:
        return self.to_dict()["reason"]

    @property
    def evidence_id(self) -> str:
        return self.to_dict()["evidenceId"]


class CodingRouter:
    """A single episode's local checkpoint state, with no implicit retries.

    Both cloud_plan_local policies start in planner; mark_cloud_plan_complete
    must acknowledge their settled cloud plan
    before local requests. The host separately enforces the shared 40-call/600s
    envelope, provider accounting and paid admission for all phases.

    before_local_request(request_id) opens one pending request and counts it.
    authorize_action(name) validates that pending request's finishing allowance.
    Exactly one observe_command/observe_visible_check/request_help/submit follows
    a valid response. Every event_id must be unique within this episode (request
    IDs and tool-call IDs are suitable distinct IDs). Failure before observation
    uses stop(event_id, fixed_reason), never another local or paid request.

    host_repair_window additionally requires begin_host_check at its one initial
    boundary. The host settles and observes the preceding request first, then
    runs only its configured visible check and observes it with host=True. This
    check consumes no model call; the host still enforces its time/cleanup caps.
    """

    def __init__(self, policy: str, initial_tree_sha256: str, visible_command: str, *, local_call_limit=LOCAL_CALL_LIMIT,
                 check_schedule="final_only"):
        if policy not in POLICIES:
            raise RouterError("router_policy")
        self._local_call_limit = _integer(local_call_limit, FINISH_RESERVE, LOCAL_CALL_LIMIT)
        if policy == "local_critic_repair" and (self._local_call_limit != 12 or check_schedule != "final_only"):
            raise RouterError("router_critic_profile")
        if self._local_call_limit != LOCAL_CALL_LIMIT and policy not in ("local_only", "local_critic_repair"):
            raise RouterError("router_local_call_limit_policy")
        if not isinstance(check_schedule, str) or check_schedule not in ("final_only", "repair_window", "host_repair_window"):
            raise RouterError("router_check_schedule")
        if check_schedule == "repair_window" and (policy != "local_only" or self._local_call_limit < 5):
            raise RouterError("router_check_schedule_budget_or_policy")
        if check_schedule == "host_repair_window" and self._local_call_limit < 5:
            raise RouterError("router_check_schedule_budget_or_policy")
        self._check_schedule = check_schedule
        self._policy = policy
        self._source = _hash(initial_tree_sha256)
        self._visible_command = _text(visible_command, 32768, nonblank=True)
        self._state = "planner" if policy in ("cloud_plan_local", "cloud_plan_local_review") else "local"
        self._local_calls = 0
        self._failed_checks = 0
        self._duplicates = 0
        self._last_signature = None
        self._check_source = None
        self._handoff_used = False
        self._pending_request = None
        self._pending_allowed = ()
        self._host_check_used = False
        self._pending_host_check = False
        self._planner_checks_sha256 = None
        self._local_phase = "draft"
        self._repair_start_local_calls = None
        self._critic_used = False
        self._critic_request_id = None
        self._critic_source = None
        self._critic_receipt_sha256 = None
        self._event_ids = set()
        self._decisions = ()
        self._record("initial", "continue", "cloud_plan_required" if self._state == "planner" else "initialized",
                     {"visibleCommandSha256": _digest(self._visible_command), "maxLocalCalls": self._local_call_limit,
                      "finishReserve": FINISH_RESERVE, "duplicateLimit": DUPLICATE_LIMIT, "failedCheckLimit": FAILED_CHECK_LIMIT})

    @property
    def policy(self) -> str:
        return self._policy

    @property
    def state(self) -> str:
        return self._state

    @property
    def local_calls(self) -> int:
        return self._local_calls

    @property
    def remaining_local_calls(self) -> int:
        if self.policy == "local_critic_repair":
            return self.phase_local_limit - self.phase_local_calls
        return self._local_call_limit - self._local_calls

    @property
    def local_phase(self) -> str:
        return self._local_phase

    @property
    def phase_local_limit(self) -> int:
        return (4 if self._local_phase == "repair" else 8) if self.policy == "local_critic_repair" else self._local_call_limit

    @property
    def phase_local_calls(self) -> int:
        return self._local_calls - (self._repair_start_local_calls or 0)

    @property
    def local_call_limit(self) -> int:
        return self._local_call_limit

    @property
    def source_sha256(self) -> str:
        return self._source

    @property
    def check_source_sha256(self) -> str | None:
        return self._check_source

    @property
    def decisions(self) -> tuple[Decision, ...]:
        return self._decisions

    @property
    def latest_decision(self) -> Decision:
        return self._decisions[-1]

    @property
    def allowed_actions(self) -> tuple[str, ...]:
        if self._state != "local" or self._pending_host_check:
            return ()
        if self._pending_request is not None:
            return self._pending_allowed
        remaining = self.remaining_local_calls
        if remaining <= 0:
            return ()
        if (self._check_schedule == "repair_window" and remaining == 4
                and self._check_source != self._source and self._failed_checks == 0):
            return ("run_visible_checks", "request_help")
        actions = []
        if remaining > FINISH_RESERVE:
            actions.append("run_command")
        if remaining >= FINISH_RESERVE:
            actions.append("run_visible_checks")
        if self._check_source == self._source:
            actions.append("submit_task")
        actions.append("request_help")
        return tuple(actions)

    def should_run_host_check(self) -> bool:
        """Whether the single initial host check is due after an observed request.

        A fresh or failed check at this exact boundary skips the host window;
        subsequent source edits must use ordinary explicit checks to finish.
        """
        return (self._check_schedule == "host_repair_window" and self._state == "local"
                and self._pending_request is None and not self._pending_host_check
                and not self._host_check_used and self._local_calls == min(4, self._local_call_limit - 4)
                and self._check_source != self._source and self._failed_checks == 0)

    def begin_host_check(self, event_id: str) -> Decision:
        """Authorize one exact host-configured check, without a model request."""
        self._event(event_id)
        self._local()
        if self._pending_request is not None:
            raise RouterError("router_request_pending")
        if self._pending_host_check:
            raise RouterError("router_host_check_pending")
        if not self.should_run_host_check():
            raise RouterError("router_host_check_not_due")
        self._host_check_used = True
        self._pending_host_check = True
        return self._record(event_id, "continue", "host_check_started",
                            {"visibleCommandSha256": _digest(self._visible_command)})

    def _event(self, event_id):
        _text(event_id, 256, nonblank=True)
        if event_id in self._event_ids:
            raise RouterError("router_event_reused")

    def _record(self, event_id: str, decision: str, reason: str, evidence: dict) -> Decision:
        self._event(event_id)
        value = {"sequence": len(self._decisions) + 1, "eventId": event_id,
                 "previousEvidenceId": self.latest_decision.evidence_id if self._decisions else None,
                 "decision": decision, "reason": reason, "policy": self.policy, "state": self._state,
                 "localCalls": self._local_calls, "remainingLocalCalls": self.remaining_local_calls,
                 "sourceSha256": self._source, "checkSourceSha256": self._check_source,
                 "failedChecks": self._failed_checks, "duplicateObservations": self._duplicates,
                 "handoffUsed": self._handoff_used,
                 "handoffCandidate": self._state == "checkpoint" and self.policy not in ("local_only", "local_critic_repair") and not self._handoff_used,
                 "allowedActions": list(self.allowed_actions),
                 "evidence": {**evidence, "checkSchedule": self._check_schedule}}
        if self._check_schedule == "host_repair_window":
            value["evidence"]["hostCheckUsed"] = self._host_check_used
        if self._planner_checks_sha256 is not None:
            value["evidence"]["plannerChecksSha256"] = self._planner_checks_sha256
        if self.policy == "local_critic_repair":
            value["evidence"].update(localPhase=self._local_phase, phaseLocalCalls=self.phase_local_calls,
                phaseLocalLimit=self.phase_local_limit, criticUsed=self._critic_used,
                repairUsed=self._repair_start_local_calls is not None, repairStartLocalCalls=self._repair_start_local_calls)
            if self._critic_receipt_sha256 is not None:
                value["evidence"]["criticReceiptSha256"] = self._critic_receipt_sha256
        value["evidenceId"] = _digest(canonical_json(value))
        result = Decision(canonical_json(value))
        self._decisions += (result,)
        self._event_ids.add(event_id)
        return result

    def _local(self):
        if self._state != "local":
            raise RouterError("router_not_local")

    def _clear_pending(self):
        self._pending_request = None
        self._pending_allowed = ()
        self._pending_host_check = False

    def _set_source(self, source):
        if source != self._source:
            self._check_source = None
        self._source = source

    def _checkpoint(self, event_id, reason, evidence):
        self._clear_pending()
        self._state = "checkpoint"
        return self._record(event_id, "checkpoint", reason, evidence)

    def _continue_or_checkpoint(self, event_id, reason, evidence):
        if self._failed_checks >= FAILED_CHECK_LIMIT:
            return self._checkpoint(event_id, "visible_checks_failed", evidence)
        if self._duplicates >= DUPLICATE_LIMIT:
            return self._checkpoint(event_id, "repeated_observation", evidence)
        if self.remaining_local_calls == 0:
            return self._checkpoint(event_id, "local_call_limit", evidence)
        if self.remaining_local_calls < FINISH_RESERVE and self._check_source != self._source:
            return self._checkpoint(event_id, "finish_reserve_exhausted", evidence)
        if self.remaining_local_calls <= FINISH_RESERVE and self._check_source != self._source:
            reason = "finish_required"
        return self._record(event_id, "continue", reason, evidence)

    def before_local_request(self, request_id: str, *, remaining_seconds=None,
                             request_timeout_seconds=None, check_reserve_seconds=None,
                             remaining_model_calls=None) -> Decision:
        """Count before dispatch; inspect returned decision before calling a model."""
        self._event(request_id)
        self._local()
        if self._pending_host_check:
            raise RouterError("router_host_check_pending")
        if self._pending_request is not None:
            raise RouterError("router_request_pending")
        if self.should_run_host_check():
            raise RouterError("router_host_check_required")
        critic_draft = self.policy == "local_critic_repair" and self._local_phase == "draft"
        if self.policy == "cloud_plan_local_review" or critic_draft:
            remaining_ms = _milliseconds(remaining_seconds)
            request_ms = _milliseconds(request_timeout_seconds, positive=True)
            check_ms = _milliseconds(check_reserve_seconds, positive=True)
            remaining_calls = _integer(remaining_model_calls, 0, 40)
            required_ms = 2 * (request_ms + check_ms)
            if required_ms > 2**53 - 1:
                raise RouterError("router_time_budget")
            evidence = {"remainingMs": remaining_ms, "requestTimeoutMs": request_ms,
                        "checkReserveMs": check_ms, "requiredReviewReserveMs": required_ms,
                        "remainingModelCalls": remaining_calls}
            # A local request must leave one cloud request, its final check,
            # and the local visible check. Checkpoint before counting/dispatch.
            if remaining_calls < 2:
                return self._checkpoint(request_id, "insufficient_model_calls", evidence)
            if remaining_ms <= required_ms:
                return self._checkpoint(request_id, "critic_time_reserve" if critic_draft else "review_time_reserve", evidence)
        if not self.remaining_local_calls:
            return self._checkpoint(request_id, "local_call_limit", {})
        if self.remaining_local_calls < FINISH_RESERVE and self._check_source != self._source:
            return self._checkpoint(request_id, "finish_reserve_exhausted", {})
        self._pending_allowed = self.allowed_actions
        self._pending_request = request_id
        self._local_calls += 1
        return self._record(request_id, "continue", "local_request_started", {"requestId": request_id})

    def authorize_action(self, action_name: str):
        """Must precede external effects; a denial is a terminal protocol error."""
        self._local()
        if self._pending_host_check:
            raise RouterError("router_host_check_pending")
        if self._pending_request is None:
            raise RouterError("router_no_pending_request")
        if action_name not in self._pending_allowed:
            raise RouterError("router_action_not_allowed")

    def _observation(self, command, output, returncode, source):
        changed = source != self._source
        signature = _digest(canonical_json({"commandSha256": _digest(command), "outputSha256": _digest(output),
                                            "returncode": returncode, "sourceSha256": source}))
        self._duplicates = min(DUPLICATE_LIMIT, self._duplicates + 1) if not changed and signature == self._last_signature else (0 if changed else 1)
        self._last_signature = signature
        self._set_source(source)
        return {"commandSha256": _digest(command), "outputSha256": _digest(output), "returncode": returncode,
                "sourceChanged": changed, "observationSha256": signature}

    def observe_command(self, event_id: str, command: str, output: str, returncode: int, source_sha256: str) -> Decision:
        self._event(event_id)
        self.authorize_action("run_command")
        command = _text(command, 32768, nonblank=True)
        output = _text(output, 65536)
        returncode = _integer(returncode, -(2**31), 2**31 - 1)
        source = _hash(source_sha256)
        evidence = self._observation(command, output, returncode, source)
        self._clear_pending()
        return self._continue_or_checkpoint(event_id, "command_observed", evidence)

    def observe_visible_check(self, event_id: str, command: str, output: str, returncode: int,
                              source_before_sha256: str, source_after_sha256: str, *, completed: bool,
                              timed_out: bool = False, host: bool = False, planner_check=None) -> Decision:
        """Accept only the exact host-configured check on one unchanged tree.

        A timeout/unreceipted check stops without help. A normal failed check
        counts toward the cumulative two-check checkpoint for this local phase.
        stdout truncation is separate from process completion and exit status.
        A bound planner artifact must also pass in a separate verifier on the
        same original source. Its source mutations are never retained here.
        """
        self._event(event_id)
        _boolean(host)
        if host:
            self._local()
            if not self._pending_host_check:
                raise RouterError("router_no_pending_host_check")
        else:
            self.authorize_action("run_visible_checks")
        command = _text(command, 32768, nonblank=True)
        output = _text(output, 65536)
        returncode = _integer(returncode, -(2**31), 2**31 - 1)
        before, after = _hash(source_before_sha256), _hash(source_after_sha256)
        _boolean(completed)
        _boolean(timed_out)
        if command != self._visible_command:
            raise RouterError("router_visible_command_mismatch")
        if host and before != self._source:
            raise RouterError("router_host_check_source_mismatch")
        if self._planner_checks_sha256 is not None and before != self._source:
            raise RouterError("router_planner_check_source_mismatch")
        if self._planner_checks_sha256 is not None and (timed_out or not completed):
            # The visible verifier stops first; no generated execution occurred.
            if planner_check is not None:
                raise RouterError("router_planner_check_unexpected")
            planner = None
        else:
            planner = self._validate_planner_check(planner_check, before)
        evidence = {"commandSha256": _digest(command), "outputSha256": _digest(output), "returncode": returncode,
                    "checkSourceBeforeSha256": before, "checkSourceAfterSha256": after,
                    "completed": completed, "timedOut": timed_out}
        if planner is not None:
            evidence.update({"plannerCheckPassed": planner["passed"], "plannerCheckCompleted": planner["completed"],
                             "plannerCheckTimedOut": planner["timedOut"],
                             "plannerCheckSourceBeforeSha256": planner["sourceSha256"],
                             "plannerCheckSourceAfterSha256": planner["sourceAfterSha256"]})
        self._clear_pending()
        self._set_source(after)
        self._check_source = None
        if timed_out or not completed:
            return self._stop(event_id, "check_timeout" if timed_out else "unknown_outcome", evidence)
        if planner is not None and (planner["timedOut"] or not planner["completed"]):
            return self._stop(event_id, "check_timeout" if planner["timedOut"] else "planner_check_invalid", evidence)
        self._last_signature = None
        self._duplicates = 0
        visible_passed = returncode == 0 and before == after
        if visible_passed and (planner is None or planner["passed"]):
            self._check_source = after
            reason = "visible_check_passed"
        else:
            self._failed_checks = min(FAILED_CHECK_LIMIT, self._failed_checks + 1)
            reason = ("planner_check_failed" if visible_passed else
                      "visible_check_tree_changed" if before != after else "visible_check_failed")
        return self._continue_or_checkpoint(event_id, reason, evidence)

    def _validate_planner_check(self, value, visible_before):
        if self._planner_checks_sha256 is None:
            if value is not None:
                raise RouterError("router_planner_check_unexpected")
            return None
        if value is None:
            raise RouterError("router_planner_check_required")
        fields = {"artifactSha256", "sourceSha256", "sourceAfterSha256", "passed", "completed", "timedOut"}
        if type(value) is not dict or set(value) != fields:
            raise RouterError("router_planner_check_shape")
        artifact, before, after = (_hash(value[field]) for field in ("artifactSha256", "sourceSha256", "sourceAfterSha256"))
        passed, completed, timed_out = (_boolean(value[field]) for field in ("passed", "completed", "timedOut"))
        if artifact != self._planner_checks_sha256:
            raise RouterError("router_planner_check_artifact_mismatch")
        if before != visible_before or visible_before != self._source:
            raise RouterError("router_planner_check_source_mismatch")
        if passed and (not completed or timed_out or before != after):
            raise RouterError("router_planner_check_pass_invalid")
        return {"artifactSha256": artifact, "sourceSha256": before, "sourceAfterSha256": after,
                "passed": passed, "completed": completed, "timedOut": timed_out}

    def request_help(self, event_id: str, reason: str) -> Decision:
        self._event(event_id)
        self.authorize_action("request_help")
        reason = _text(reason, MAX_HELP_BYTES, nonblank=True)
        return self._checkpoint(event_id, "explicit_help", {"helpMessage": reason, "helpMessageSha256": _digest(reason)})

    def submit(self, event_id: str, source_sha256: str) -> Decision:
        """Run before external submission; refresh the trusted current tree first."""
        self._event(event_id)
        self.authorize_action("submit_task")
        source = _hash(source_sha256)
        if source != self._source or self._check_source != source:
            raise RouterError("router_submission_requires_fresh_check")
        if self.policy == "cloud_plan_local_review":
            return self._checkpoint(event_id, "review_required", {"checkSourceSha256": source})
        if self.policy == "local_critic_repair" and self._local_phase == "draft":
            if self._critic_used:
                raise RouterError("router_critic_reused")
            self._clear_pending()
            self._state = "critic"
            self._critic_source = source
            return self._record(event_id, "checkpoint", "critic_required", {"checkSourceSha256": source})
        self._clear_pending()
        self._state = "submitted"
        return self._record(event_id, "submit", "fresh_visible_check", {"checkSourceSha256": source})

    def mark_critic_started(self, event_id: str, *, request_id: str, source_sha256: str,
                            patch_sha256: str, bundle_sha256: str, body_sha256: str) -> Decision:
        """Consume the single critic grant before dispatch, binding its draft."""
        self._event(event_id)
        if self.policy != "local_critic_repair" or self._state != "critic" or self._critic_used:
            raise RouterError("router_critic_not_available")
        source = _hash(source_sha256)
        request_id = _text(request_id, 256, nonblank=True)
        evidence = {"requestId": request_id, "sourceSha256": source,
            "patchSha256": _hash(patch_sha256), "bundleSha256": _hash(bundle_sha256), "bodySha256": _hash(body_sha256)}
        if source != self._source or source != self._critic_source or source != self._check_source:
            raise RouterError("router_critic_source_mismatch")
        self._critic_used = True
        self._critic_request_id = request_id
        return self._record(event_id, "continue", "critic_request_started", evidence)

    def mark_critic_complete(self, event_id: str, *, request_id: str, source_sha256: str,
                             receipt_sha256: str, verdict: str, request_settled: bool,
                             cancelled: bool = False) -> Decision:
        """Consume a host-parsed, settled verdict once; it never establishes acceptance."""
        self._event(event_id)
        if self.policy != "local_critic_repair" or self._state != "critic" or not self._critic_used or self._critic_receipt_sha256:
            raise RouterError("router_critic_not_pending")
        if _text(request_id, 256, nonblank=True) != self._critic_request_id:
            raise RouterError("router_critic_request_mismatch")
        source, receipt = _hash(source_sha256), _hash(receipt_sha256)
        if source != self._source or source != self._critic_source or self._check_source != source:
            raise RouterError("router_critic_source_mismatch")
        if verdict not in ("acceptable", "repair_required", "insufficient_context"):
            raise RouterError("router_critic_verdict")
        _boolean(request_settled)
        _boolean(cancelled)
        evidence = {"requestId": request_id, "requestSettled": request_settled, "cancelled": cancelled,
                    "criticReceiptSha256": receipt, "verdict": verdict, "sourceSha256": source}
        if cancelled or not request_settled:
            return self._stop(event_id, "cancelled" if cancelled else "unknown_outcome", evidence)
        self._critic_receipt_sha256 = receipt
        if verdict == "insufficient_context":
            return self._stop(event_id, "critic_insufficient_context", evidence)
        if verdict == "acceptable":
            self._state = "submitted"
            return self._record(event_id, "submit", "critic_acceptable", evidence)
        self._local_phase = "repair"
        self._repair_start_local_calls = self._local_calls
        self._check_source = None
        self._duplicates = 0
        self._last_signature = None
        self._state = "local"
        return self._record(event_id, "continue", "critic_repair_required", evidence)

    def mark_cloud_plan_complete(self, event_id: str, *, request_settled: bool, cancelled: bool = False,
                                 planner_checks_sha256=None) -> Decision:
        self._event(event_id)
        _boolean(request_settled)
        _boolean(cancelled)
        if self._state != "planner":
            raise RouterError("router_not_planner")
        if planner_checks_sha256 is not None:
            if self._check_schedule != "host_repair_window":
                raise RouterError("router_planner_check_policy")
            planner_checks_sha256 = _hash(planner_checks_sha256)
        evidence = {"requestSettled": request_settled, "cancelled": cancelled}
        if cancelled or not request_settled:
            return self._stop(event_id, "cancelled" if cancelled else "unknown_outcome", evidence)
        self._planner_checks_sha256 = planner_checks_sha256
        self._state = "local"
        return self._record(event_id, "continue", "cloud_plan_completed", evidence)

    def confirm_handoff(self, event_id: str, *, request_settled: bool, cancelled: bool,
                        remaining_model_calls: int, remaining_seconds: float, request_timeout_seconds: float,
                        check_reserve_seconds: float) -> Decision:
        """Explicit host authorization for one irreversible cloud recovery phase.

        Policy candidacy never establishes paid admission. The caller must also
        hold the shared money reservation and enforce its global time/call caps.
        This gate requires a full request timeout plus positive check reserve.
        """
        self._event(event_id)
        if self.policy == "local_critic_repair":
            raise RouterError("router_critic_cloud_handoff_denied")
        if self._state != "checkpoint" or self._handoff_used:
            raise RouterError("router_no_handoff_checkpoint")
        _boolean(request_settled)
        _boolean(cancelled)
        remaining_calls = _integer(remaining_model_calls, 0, 40)
        remaining_ms = _milliseconds(remaining_seconds)
        request_ms = _milliseconds(request_timeout_seconds, positive=True)
        check_ms = _milliseconds(check_reserve_seconds, positive=True)
        if request_ms < 1 or check_ms < 1:
            raise RouterError("router_time_budget")
        evidence = {"requestSettled": request_settled, "cancelled": cancelled, "remainingModelCalls": remaining_calls,
                    "remainingMs": remaining_ms, "requestTimeoutMs": request_ms, "checkReserveMs": check_ms,
                    "checkpointEvidenceId": self.latest_decision.evidence_id}
        if cancelled:
            return self._stop(event_id, "cancelled", evidence)
        if not request_settled:
            return self._stop(event_id, "unknown_outcome", evidence)
        if self.policy == "local_only":
            return self._stop(event_id, "local_only_checkpoint", evidence)
        if remaining_calls < 1:
            return self._stop(event_id, "insufficient_model_calls", evidence)
        if remaining_ms < request_ms + check_ms:
            return self._stop(event_id, "insufficient_handoff_time", evidence)
        self._handoff_used = True
        self._state = "cloud"
        return self._record(event_id, "escalate", "handoff_confirmed", evidence)

    def _stop(self, event_id, reason, evidence):
        self._clear_pending()
        if self._planner_checks_sha256 is not None or self.policy == "local_critic_repair":
            # A verifier may already have failed before its combined observation
            # reaches the router. Never retain prior passing eligibility on stop.
            self._check_source = None
        self._state = "stopped"
        return self._record(event_id, "stop", reason, evidence)

    def stop(self, event_id: str, reason: str) -> Decision:
        self._event(event_id)
        if self._state in ("stopped", "submitted"):
            raise RouterError("router_terminal")
        if reason not in STOP_REASONS:
            raise RouterError("router_stop_reason")
        return self._stop(event_id, reason, {})
