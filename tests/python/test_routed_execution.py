"""Real sandbox and loopback proofs for native coding routes, never paid calls."""
from dataclasses import replace
import hashlib
import http.server
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest import mock

from test_patch_worker import worker, config

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'runtime/patch-worker'))
import coding_execution
from coding_execution import RoutingExecution, tree_identity
from test_planner_checks import (SOURCE as PLANNER_SOURCE, PLANNER_REJECTION_SENTINEL,
                                 invalid_planner_responses, response as planner_response)
from coding_router import CodingRouter, RouterError
from native_local import build_request, parse_response, tool_result_message, NATIVE_CODING_SYSTEM, NativeProtocolError


class NativeCodingProfileTests(unittest.TestCase):
    def local_budget_execution(self, source, check_schedule='final_only'):
        execution = object.__new__(RoutingExecution)
        execution.start = config(source, policy='local_only', limits={'wallTimeSeconds': 600,
            'stepLimit': 40, 'localStepLimit': 8, 'requestTimeoutSeconds': 120,
            'visibleCheckTimeoutSeconds': 60, 'localCoding': {'checkSchedule': check_schedule}})
        execution.bridge = worker.Bridge(sink=io.StringIO())
        execution.bridge.deadline = 1600
        execution.environment = mock.Mock()
        execution.environment.phase = 'local'
        execution.w = worker
        execution.router = CodingRouter('local_only', 'a' * 64, execution.start['visibleTestCommand'],
            local_call_limit=execution.start['limits']['localStepLimit'], check_schedule=check_schedule)
        execution.script_index = 0
        execution.script_submit_pending = False
        execution.submitted = False
        execution.generated_checks = None
        execution.planner_check_receipt = None
        return execution

    def test_thinking_start_defaults_to_disabled_and_medium_requires_local_only(self):
        with tempfile.TemporaryDirectory() as source:
            for policy in ('local_only', 'local_first', 'cloud_plan_local', 'cloud_plan_local_review'):
                with self.subTest(policy=policy):
                    default = config(source, policy=policy)
                    disabled = config(source, policy=policy, limits={'localCoding': {'thinking': 'disabled'}})
                    self.assertEqual(default['limits']['localCoding'], disabled['limits']['localCoding'])
                    self.assertEqual(default['limits']['localCoding'],
                                     {'maxOutputTokens': 8192, 'maxInputBytes': 256000, 'thinking': 'disabled', 'checkSchedule': 'final_only'})
            disabled = config(source, policy='local_only', limits={'wallTimeSeconds': 600, 'stepLimit': 8,
                              'localStepLimit': 8, 'localCoding': {'thinking': 'disabled'}})
            medium = config(source, policy='local_only', limits={'wallTimeSeconds': 600, 'stepLimit': 8,
                            'localStepLimit': 8, 'localCoding': {'thinking': 'medium'}})
            self.assertEqual(medium['limits']['localCoding']['thinking'], 'medium')
            medium['limits']['localCoding']['thinking'] = 'disabled'
            self.assertEqual(medium['limits'], disabled['limits'])
            for policy in ('cloud', 'prepared_cloud', 'hybrid', 'local_first',
                           'cloud_plan_local', 'cloud_plan_local_review'):
                with self.subTest(medium_policy=policy), self.assertRaises(worker.WorkerError):
                    config(source, policy=policy, limits={'localCoding': {'thinking': 'medium'}})
            for thinking in (None, True, False, 1, 'high', 'none', '', [], {}):
                with self.subTest(thinking=thinking), self.assertRaises(worker.WorkerError):
                    config(source, policy='local_only', limits={'localCoding': {'thinking': thinking}})

    def test_local_medium_loop_keeps_tool_mask_and_rejects_cap_reaching_actions(self):
        for tokens, finish, expected in ((8191, 'tool_calls', None),
                                        (8192, 'tool_calls', 'native_output_at_token_cap'),
                                        (8193, 'tool_calls', 'native_output_at_token_cap'),
                                        (8191, 'length', 'native_output_truncated')):
            with self.subTest(tokens=tokens, finish=finish), tempfile.TemporaryDirectory() as source:
                execution = self.local_budget_execution(source)
                execution.start['limits']['localCoding']['thinking'] = 'medium'
                execution.start['mode'] = 'live'
                model = mock.Mock()
                model.provider = {'protocol': 'openai', 'model': 'local-fixture'}
                model.complete_body.return_value = {'choices': [{'finish_reason': finish, 'message': {
                    'role': 'assistant', 'content': None, 'reasoning_content': 'private-reasoning-sentinel',
                    'tool_calls': [{'id': 'call_help', 'type': 'function', 'function': {'name': 'request_help',
                        'arguments': json.dumps({'reason': 'Cannot finish the public task.'})}}]}}],
                    'usage': {'completion_tokens': tokens, 'completion_tokens_details': {'reasoning_tokens': tokens - 1}}}
                with mock.patch.object(worker, 'ExactModel', return_value=model), \
                        mock.patch.object(worker.time, 'monotonic', return_value=1000):
                    if expected:
                        with self.assertRaises(NativeProtocolError) as caught:
                            execution.local('value.txt', '')
                        self.assertEqual(caught.exception.code, expected)
                    else:
                        execution.local('value.txt', '')
                        self.assertEqual(execution.router.latest_decision.reason, 'explicit_help')
                model.complete_body.assert_called_once()
                body = model.complete_body.call_args.args[0]
                self.assertEqual(body['reasoning_effort'], 'medium')
                self.assertNotIn('chat_template_kwargs', body)
                self.assertEqual(body['max_tokens'], 8192)
                self.assertEqual([tool['function']['name'] for tool in body['tools']],
                                 ['run_command', 'run_visible_checks', 'request_help'])
                self.assertFalse(body['parallel_tool_calls'])
                self.assertFalse(body['stream'])
                self.assertEqual(execution.router.local_calls, 1)
                execution.environment.resume.assert_not_called()
                execution.environment.raw.assert_not_called()
                events = [json.loads(line) for line in execution.bridge.sink.getvalue().splitlines()]
                self.assertFalse(any(event['type'] in ('command.started', 'checkpoint.checked', 'patch.ready') for event in events))
                self.assertNotIn('private-reasoning-sentinel', execution.bridge.sink.getvalue())

    def test_start_normalizes_check_schedule_without_changing_other_limits(self):
        with tempfile.TemporaryDirectory() as source:
            options = {'wallTimeSeconds': 600, 'stepLimit': 8, 'localStepLimit': 8}
            default = config(source, policy='local_only', limits=options)
            explicit = config(source, policy='local_only', limits={**options, 'localCoding': {'checkSchedule': 'final_only'}})
            self.assertEqual(default['limits'], explicit['limits'])
            experimental = config(source, policy='local_only', limits={**options, 'localCoding': {'checkSchedule': 'repair_window'}})
            self.assertEqual(experimental['limits']['localCoding']['checkSchedule'], 'repair_window')
            experimental['limits']['localCoding']['checkSchedule'] = 'final_only'
            self.assertEqual(default['limits'], experimental['limits'])
            for calls, total in ((2, 8), (3, 8), (4, 8), (8, 4), (24, 8)):
                with self.subTest(calls=calls, total=total), self.assertRaises(worker.WorkerError):
                    config(source, policy='local_only', limits={**options, 'stepLimit': total,
                        'localStepLimit': calls, 'localCoding': {'checkSchedule': 'repair_window'}})
            for policy in ('cloud', 'prepared_cloud', 'hybrid', 'local_first', 'cloud_plan_local', 'cloud_plan_local_review'):
                with self.subTest(policy=policy), self.assertRaises(worker.WorkerError):
                    config(source, policy=policy, limits={'localCoding': {'checkSchedule': 'repair_window'}})
            for schedule in (None, True, False, 1, '', 'early', [], {}):
                with self.subTest(schedule=schedule), self.assertRaises(worker.WorkerError):
                    config(source, policy='local_only', limits={**options, 'localCoding': {'checkSchedule': schedule}})

    def test_native_reasoning_usage_is_a_subset_of_the_same_completion_total(self):
        receipt = {'usage': {'prompt_tokens': 100, 'completion_tokens': 8191,
                            'completion_tokens_details': {'reasoning_tokens': 8100}}}
        self.assertEqual(worker.usage_from_response('openai', receipt),
                         {'inputTokens': 100, 'outputTokens': 8191, 'reasoningTokens': 8100,
                          'cacheReadTokens': 0, 'cacheWriteTokens': 0, 'reported': True})
        for reasoning in (8192, -1, True, None, '8100'):
            receipt['usage']['completion_tokens_details']['reasoning_tokens'] = reasoning
            with self.subTest(reasoning=reasoning), self.assertRaisesRegex(worker.WorkerError, 'provider_usage_invalid'):
                worker.usage_from_response('openai', receipt)

    def test_local_budget_start_clamps_only_an_explicit_lower_local_only_limit(self):
        with tempfile.TemporaryDirectory() as source:
            for policy in ('local_only', 'local_first', 'cloud_plan_local', 'cloud_plan_local_review'):
                for explicit in ({}, {'localStepLimit': 24}):
                    with self.subTest(policy=policy, explicit=explicit):
                        start = config(source, policy=policy, limits={'stepLimit': 40, **explicit})
                        self.assertEqual((start['limits']['stepLimit'], start['limits']['localStepLimit']), (40, 24))
                if policy != 'local_only':
                    with self.subTest(policy=policy), self.assertRaises(worker.WorkerError):
                        config(source, policy=policy, limits={'stepLimit': 40, 'localStepLimit': 8})
            for total, expected in ((40, 8), (8, 8), (6, 6), (5, 5), (2, 2)):
                with self.subTest(total=total):
                    start = config(source, policy='local_only', limits={'stepLimit': total, 'localStepLimit': 8})
                    self.assertEqual((start['limits']['stepLimit'], start['limits']['localStepLimit'],
                        start['limits']['finishingReserve']), (expected, expected, 2))
            with self.subTest(total=1), self.assertRaises(worker.WorkerError):
                config(source, policy='local_only', limits={'stepLimit': 1, 'localStepLimit': 8})
            for invalid in (None, True, False, 1, 25, 8.0, '8'):
                with self.subTest(invalid=invalid), self.assertRaises(worker.WorkerError):
                    config(source, policy='local_only', limits={'localStepLimit': invalid})

    def test_local_prompt_and_native_body_use_the_effective_eight_call_budget(self):
        for schedule in ('final_only', 'repair_window'):
            with self.subTest(schedule=schedule), tempfile.TemporaryDirectory() as source:
                execution = self.local_budget_execution(source, schedule)
                execution.start['mode'] = 'live'
                model = mock.Mock()
                model.provider = {'protocol': 'openai', 'model': 'local-fixture'}
                model.complete_body.return_value = {'choices': [{'finish_reason': 'tool_calls', 'message': {
                    'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'call_help', 'type': 'function',
                    'function': {'name': 'request_help', 'arguments': json.dumps({'reason': 'Cannot finish the public task.'})}}]}}],
                    'usage': {'completion_tokens': 1}}
                with mock.patch.object(worker, 'ExactModel', return_value=model), \
                        mock.patch.object(worker.time, 'monotonic', return_value=1000):
                    execution.local('value.txt', '')
                model.complete_body.assert_called_once()
                body = model.complete_body.call_args.args[0]
                self.assertIn('You have 8 local calls including two reserved finishing calls.', body['messages'][1]['content'])
                self.assertNotIn('You have 24 local calls', body['messages'][1]['content'])
                if schedule == 'repair_window':
                    self.assertIn('local call 5 must request run_visible_checks or request_help', body['messages'][1]['content'])
                    self.assertIn('Plan inspection and concrete fixes before that first check.', body['messages'][1]['content'])
                else:
                    self.assertNotIn('Repair-window schedule:', body['messages'][1]['content'])
                self.assertEqual(body['messages'][0]['content'], NATIVE_CODING_SYSTEM)
                self.assertEqual(body['max_tokens'], 8192)
                self.assertEqual(body['chat_template_kwargs'], {'enable_thinking': False})
                self.assertFalse(body['parallel_tool_calls'])
                self.assertFalse(body['stream'])
                self.assertEqual((execution.router.local_calls, execution.router.latest_decision.reason), (1, 'explicit_help'))
                execution.environment.resume.assert_not_called()
                execution.environment.raw.assert_not_called()

    def test_run_initializes_router_from_validated_local_budget(self):
        for schedule in ('final_only', 'repair_window'):
            with self.subTest(schedule=schedule), tempfile.TemporaryDirectory() as source:
                execution = self.local_budget_execution(source, schedule)
                execution.router = None
                execution.candidate = Path(source)
                execution.snapshot = mock.Mock(return_value=('a' * 64, []))
                execution.verifier = None
                execution.folder = mock.Mock()
                execution.finish = mock.Mock(return_value='fixture-finished')
                execution.recover_cloud = mock.Mock(side_effect=AssertionError('submitted fixture cannot recover to cloud'))
                def local_fixture(inventory, plan):
                    self.assertEqual((inventory, plan), ('value.txt', ''))
                    self.assertEqual(execution.router.local_call_limit, 8)
                    self.assertEqual(execution.router.remaining_local_calls, 8)
                    execution.submitted = True
                execution.local = mock.Mock(side_effect=local_fixture)
                with mock.patch.object(worker, 'host_source_inventory', return_value='value.txt'):
                    self.assertEqual(execution.run(), 'fixture-finished')
                execution.environment.setup.assert_called_once_with()
                execution.local.assert_called_once_with('value.txt', '')
                execution.recover_cloud.assert_not_called()
                execution.environment.cleanup.assert_called_once_with()
                execution.folder.cleanup.assert_called_once_with()
                checkpoints = [json.loads(line)['checkpoint'] for line in execution.bridge.sink.getvalue().splitlines()
                    if json.loads(line)['type'] == 'routing.checkpoint']
                self.assertEqual(len(checkpoints), 1)
                self.assertEqual(checkpoints[0]['evidence']['maxLocalCalls'], 8)
                self.assertEqual(checkpoints[0]['evidence']['checkSchedule'], schedule)
                self.assertEqual(checkpoints[0]['remainingLocalCalls'], 8)

    def test_reserved_native_actions_are_denied_before_any_execution(self):
        for ordinal, scripted_action in ((7, 'touch forbidden.txt'), (8, 'SOAR_SUBMIT')):
            with self.subTest(ordinal=ordinal), tempfile.TemporaryDirectory() as source:
                execution = self.local_budget_execution(source)
                for index in range(1, 7):
                    execution.router.before_local_request('prior-request-' + str(index))
                    execution.router.observe_command('prior-action-' + str(index), 'inspect ' + str(index), 'ok', 0, 'a' * 64)
                if ordinal == 8:
                    execution.router.before_local_request('prior-check-request')
                    execution.router.observe_visible_check('prior-check', execution.start['visibleTestCommand'], 'pass',
                        0, 'a' * 64, 'a' * 64, completed=True)
                execution.start['_modelCalls'] = ordinal - 1
                execution.start['scriptedActions'] = [scripted_action]
                execution.visible_check = mock.Mock(side_effect=AssertionError('reserved action must not run a check'))
                with mock.patch.object(worker.time, 'monotonic', return_value=1000), \
                        self.assertRaisesRegex(RouterError, 'router_action_not_allowed'):
                    execution.local('value.txt', '')
                self.assertEqual(execution.start['_modelCalls'], ordinal)
                self.assertEqual(execution.router.local_calls, ordinal)
                execution.environment.resume.assert_not_called()
                execution.environment.raw.assert_not_called()
                execution.visible_check.assert_not_called()
                events = [json.loads(line) for line in execution.bridge.sink.getvalue().splitlines()]
                self.assertEqual(sum(event['type'] == 'model.finished' for event in events), 1)
                denial = next(event for event in events if event['type'] == 'native.action_denied')
                self.assertEqual(set(denial), {'type', 'protocolVersion', 'runId', 'sequence',
                    'requestId', 'checkpointEvidenceId', 'localCall', 'action'})
                self.assertEqual(denial['localCall'], ordinal)
                self.assertEqual(denial['action'], 'run_command' if ordinal == 7 else 'run_visible_checks')
                self.assertEqual(denial['checkpointEvidenceId'], execution.router.latest_decision.evidence_id)
                self.assertNotIn('forbidden.txt', json.dumps(denial))
                self.assertFalse(any(event['type'] in ('command.started', 'checkpoint.checked', 'patch.ready') for event in events))

    def test_reviewed_local_transport_preserves_cloud_time_and_last_call_before_admission(self):
        for phase, remaining, calls, expected in [
            ('local', 360, 1, 'routing_request_deadline_reserve'),
            ('local', 361, 39, 'routing_global_call_limit'),
            ('local', 361, 38, 'fixture_admitted'),
            ('cloud', 181, 39, 'fixture_admitted'),
            ('planner', 181, 0, 'fixture_admitted'),
        ]:
            with self.subTest(phase=phase, remaining=remaining, calls=calls), tempfile.TemporaryDirectory() as source:
                start = config(source, policy='cloud_plan_local_review', limits={'wallTimeSeconds': 600, 'stepLimit': 40,
                    'requestTimeoutSeconds': 120, 'visibleCheckTimeoutSeconds': 60})
                provider_role = 'local' if phase == 'local' else 'cloud'
                start['providers'] = {provider_role: {'id': provider_role, 'protocol': 'openai', 'model': 'fixture',
                    'endpoint': 'http://127.0.0.1:1/completions'}}
                start['_modelCalls'] = calls
                bridge = worker.Bridge(sink=io.StringIO())
                bridge.deadline = 1000 + remaining
                model = worker.ExactModel(bridge, start, phase)
                with mock.patch.object(worker.time, 'monotonic', return_value=1000), \
                        mock.patch.object(bridge, 'admit', side_effect=worker.WorkerError('fixture_admitted')) as admission, \
                        mock.patch.object(worker.urllib.request, 'build_opener') as transport:
                    with self.assertRaisesRegex(worker.WorkerError, expected):
                        model.complete_body({'model': 'fixture'}, max_tokens=128)
                    self.assertEqual(admission.call_count, int(expected == 'fixture_admitted'))
                    transport.assert_not_called()

    def test_reviewed_finish_cannot_export_an_unreviewed_candidate(self):
        for submitted, state in [(True, 'submitted'), (False, 'cloud'), (False, 'checkpoint')]:
            with self.subTest(submitted=submitted, state=state):
                execution = object.__new__(RoutingExecution)
                execution.start = {'policy': 'cloud_plan_local_review'}
                execution.submitted = submitted
                execution.router = SimpleNamespace(state=state)
                execution.w = worker
                execution.patch_from_candidate = mock.Mock(side_effect=AssertionError('must not capture submitted patch'))
                with self.assertRaisesRegex(worker.WorkerError, 'routing_review_required'):
                    execution.finish()
                execution.patch_from_candidate.assert_not_called()

    def test_reviewed_local_loop_checkpoints_before_dispatch_when_time_or_calls_are_reserved(self):
        for seconds, consumed, expected in [(360, 1, 'review_time_reserve'), (600, 39, 'insufficient_model_calls')]:
            with self.subTest(seconds=seconds, consumed=consumed), tempfile.TemporaryDirectory() as source:
                execution = object.__new__(RoutingExecution)
                execution.start = config(source, policy='cloud_plan_local_review', limits={'wallTimeSeconds': 600,
                    'stepLimit': 40, 'requestTimeoutSeconds': 120, 'visibleCheckTimeoutSeconds': 60})
                execution.start['_modelCalls'] = consumed
                execution.bridge = worker.Bridge(sink=io.StringIO())
                execution.bridge.deadline = 1000 + seconds
                execution.environment = SimpleNamespace(phase='local')
                execution.w = worker
                execution.generated_checks = None
                execution.router = CodingRouter('cloud_plan_local_review', 'a' * 64, execution.start['visibleTestCommand'])
                execution.router.mark_cloud_plan_complete('plan', request_settled=True)
                execution.scripted_response = mock.Mock(side_effect=AssertionError('must not dispatch a local response'))
                with mock.patch.object(worker.time, 'monotonic', return_value=1000):
                    execution.local('value.txt', 'Plan guidance')
                execution.scripted_response.assert_not_called()
                self.assertEqual(execution.router.latest_decision.reason, expected)
                self.assertEqual(execution.router.local_calls, 0)
                self.assertEqual(execution.start['_modelCalls'], consumed)

    def test_planner_check_transport_preserves_both_verifier_windows_after_admission(self):
        with tempfile.TemporaryDirectory() as source:
            start = config(source, policy='cloud_plan_local', limits={'wallTimeSeconds': 600, 'stepLimit': 40,
                'requestTimeoutSeconds': 120, 'visibleCheckTimeoutSeconds': 60})
            start['limits']['plannerMode'] = 'plan_and_checks'
            start['providers'] = {'cloud': {'id': 'cloud', 'protocol': 'openai', 'model': 'fixture',
                'endpoint': 'http://127.0.0.1:1/completions'}}
            for seconds, admitted in [(239, False), (241, True)]:
                bridge = worker.Bridge(sink=io.StringIO())
                bridge.deadline = 1000 + seconds
                model = worker.ExactModel(bridge, start, 'planner')
                with self.subTest(seconds=seconds), mock.patch.object(worker.time, 'monotonic', return_value=1000), \
                        mock.patch.object(bridge, 'admit', side_effect=worker.WorkerError('fixture_admitted')) as admission, \
                        mock.patch.object(worker.urllib.request, 'build_opener') as transport:
                    with self.assertRaisesRegex(worker.WorkerError, 'fixture_admitted' if admitted else 'routing_request_deadline_reserve'):
                        model.complete_body({'model': 'fixture'}, max_tokens=128)
                    self.assertEqual(admission.call_count, int(admitted))
                    transport.assert_not_called()
            bridge = worker.Bridge(sink=io.StringIO())
            bridge.deadline = 1600
            model = worker.ExactModel(bridge, start, 'planner')
            with mock.patch.object(worker.time, 'monotonic', return_value=1000) as clock, \
                    mock.patch.object(bridge, 'admit', side_effect=lambda *_: setattr(clock, 'return_value', 1481)), \
                    mock.patch.object(worker.urllib.request, 'build_opener') as transport:
                with self.assertRaisesRegex(worker.WorkerError, 'routing_request_deadline_reserve'):
                    model.complete_body({'model': 'fixture'}, max_tokens=128)
                transport.assert_not_called()

    def test_every_request_retains_verification_time_before_admission(self):
        for policy in ['prepared_cloud', 'local_only', 'local_first', 'cloud_plan_local']:
            for remaining, admitted in [(119, False), (150, False), (179, False), (181, True)]:
                with self.subTest(policy=policy, remaining=remaining), tempfile.TemporaryDirectory() as source:
                    start = config(source, policy=policy, limits={'wallTimeSeconds': 600, 'stepLimit': 40,
                        'requestTimeoutSeconds': 120, 'visibleCheckTimeoutSeconds': 60})
                    role = 'local' if policy == 'local_only' else 'cloud'
                    start['providers'] = {role: {'id': role, 'protocol': 'openai', 'model': 'fixture',
                        'endpoint': 'http://127.0.0.1:1/completions'}}
                    bridge = worker.Bridge(sink=io.StringIO())
                    bridge.deadline = 1000 + remaining
                    model = worker.ExactModel(bridge, start, role)
                    with mock.patch.object(worker.time, 'monotonic', return_value=1000), \
                            mock.patch.object(bridge, 'admit', side_effect=worker.WorkerError('fixture_admitted')) as admission, \
                            mock.patch.object(worker.urllib.request, 'build_opener') as transport:
                        with self.assertRaisesRegex(worker.WorkerError, 'fixture_admitted' if admitted else 'routing_request_deadline_reserve'):
                            model.complete_body({'model': 'fixture'}, max_tokens=128)
                        self.assertEqual(admission.call_count, int(admitted))
                        transport.assert_not_called()

    def test_coding_check_help_roundtrip_and_legacy_profile_denial(self):
        for name, args in [('run_visible_checks', {}), ('request_help', {'reason': 'Repeated exact checks fail.'})]:
            response = {'choices': [{'finish_reason': 'tool_calls', 'message': {'role': 'assistant', 'content': None,
                'tool_calls': [{'id': 'call_one', 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}}]}}]}
            with self.assertRaises(NativeProtocolError):
                parse_response(response)
            action = parse_response(response, profile='coding')
            messages = [{'role': 'system', 'content': NATIVE_CODING_SYSTEM}, {'role': 'user', 'content': 'Fix a task'},
                        action.assistant_message, tool_result_message(action, 'Exact check failed', 1, profile='coding')]
            body = build_request('local-fixture', messages, max_output_tokens=8192, profile='coding')
            self.assertEqual(body['messages'][-1]['tool_call_id'], 'call_one')
            self.assertEqual(len(body['tools']), 4)
            self.assertFalse(body['chat_template_kwargs']['enable_thinking'])
        response['choices'][0]['message']['tool_calls'][0]['function']['arguments'] = json.dumps({'reason': '中' * 342})
        with self.assertRaises(NativeProtocolError):
            parse_response(response, profile='coding')

    def test_checked_in_request_contract_matches_python_builder(self):
        path = Path(worker.ROOT) / 'native-coding-contract.json'
        contract = json.loads(path.read_text())
        body = build_request('fixture', [{'role': 'system', 'content': NATIVE_CODING_SYSTEM}, {'role': 'user', 'content': 'task'}],
                             max_output_tokens=8192, profile='coding')
        self.assertEqual(contract['system'], body['messages'][0]['content'])
        self.assertEqual(contract['tools'], body['tools'])
        for key, value in contract['requestProfile'].items():
            self.assertEqual(value, body[key])


class InitialPlannerDiagnosticTests(unittest.TestCase):
    """Real route/plan/terminal flow with synthetic model and sandbox boundaries."""

    def execution(self):
        folder = tempfile.TemporaryDirectory(prefix='soar-planner-diagnostic-')
        self.addCleanup(folder.cleanup)
        execution = object.__new__(RoutingExecution)
        execution.start = config(folder.name, policy='cloud_plan_local', limits={
            'wallTimeSeconds': 600, 'stepLimit': 40, 'requestTimeoutSeconds': 120,
            'visibleCheckTimeoutSeconds': 60,
            'localCoding': {'checkSchedule': 'host_repair_window'}})
        # The synthetic ExactModel supplies the live response shape without HTTP.
        execution.start['mode'] = 'live'
        execution.start['limits']['plannerMode'] = 'plan_and_checks'
        execution.bridge = worker.Bridge(sink=io.StringIO())
        execution.w = worker
        execution.environment = mock.Mock(container_id=None)
        execution.Session = mock.Mock(return_value=mock.Mock())
        execution.folder = mock.Mock()
        execution.candidate = Path(folder.name)
        execution.snapshot = mock.Mock(return_value=('a' * 64, []))
        execution.router = None
        execution.verifier = None
        execution.submitted = False
        execution.saved_submission = False
        execution.reconstructing = False
        execution.generated_checks = None
        execution.planner_check_receipt = None
        execution.local = mock.Mock(side_effect=AssertionError('initial rejection must not start local work'))
        execution.recover_cloud = mock.Mock(side_effect=AssertionError('initial rejection must not start cloud recovery'))
        execution.finish = mock.Mock(side_effect=AssertionError('initial rejection must not export a patch'))
        return execution

    def terminal_for(self, execution, content, *, parser_error=None, finish_reason='stop'):
        model = mock.Mock()
        model.provider = {'protocol': 'openai', 'model': 'synthetic-planner'}
        model.prepare_body.return_value = ({'model': 'synthetic-planner'}, 8192)
        model.complete_body.return_value = {'choices': [{'finish_reason': finish_reason,
            'message': {'role': 'assistant', 'content': content}}],
            'usage': {'prompt_tokens': 5, 'completion_tokens': 3}}
        parser_args = ({'side_effect': parser_error} if parser_error is not None
                       else {'wraps': coding_execution.parse_planner_response})
        bridge = execution.bridge
        with mock.patch.object(worker, 'ExactModel', return_value=model) as model_factory, \
                mock.patch.object(coding_execution, 'parse_planner_response', **parser_args) as parser_call, \
                mock.patch.object(worker, 'Bridge', return_value=bridge), \
                mock.patch.object(worker, 'verify_runtime', return_value={'version': 'synthetic'}), \
                mock.patch.object(worker, 'validate_start', return_value=execution.start), \
                mock.patch.object(worker, 'run_job', side_effect=lambda *_: execution.run()), \
                mock.patch.object(worker, 'host_source_inventory', return_value=''), \
                mock.patch.object(worker, 'recover_unsubmitted_patch'), \
                mock.patch.object(bridge, 'start_reader'), \
                mock.patch.object(bridge, 'receive', return_value=execution.start), \
                mock.patch.object(worker.signal, 'signal'), \
                mock.patch.object(worker.time, 'monotonic', return_value=1000), \
                mock.patch.object(worker.urllib.request, 'build_opener') as transport, \
                mock.patch.object(worker.DockerSession, 'host_command',
                                  side_effect=AssertionError('host fixture must not call Docker')) as docker, \
                mock.patch.object(sys, 'argv', ['patch-worker']):
            status = worker.main()
        self.assertEqual(status, 1)
        model_factory.assert_called_once_with(bridge, execution.start, 'planner')
        model.complete_body.assert_called_once_with({'model': 'synthetic-planner'}, max_tokens=8192)
        transport.assert_not_called()
        docker.assert_not_called()
        events = [json.loads(line) for line in bridge.sink.getvalue().splitlines()]
        terminals = [event for event in events if event['type'] == 'terminal']
        self.assertEqual(len(terminals), 1)
        self.assertEqual(terminals[0]['status'], 'failed')
        return terminals[0], events, parser_call

    def assert_initial_stop(self, execution, terminal, events, expected):
        self.assertEqual(terminal['errorCode'], expected)
        self.assertNotIn(PLANNER_REJECTION_SENTINEL, execution.bridge.sink.getvalue())
        self.assertEqual([event['phase'] for event in events if event['type'] == 'phase.started'], ['planner'])
        self.assertFalse(any(event['type'] in ('plan.ready', 'planner.checks.checked', 'patch.ready',
            'patch.recovered', 'command.started', 'checkpoint.checked', 'verification.started') for event in events))
        self.assertIsNone(execution.generated_checks)
        self.assertIsNone(execution.planner_check_receipt)
        self.assertEqual(execution.router.local_calls, 0)
        execution.local.assert_not_called()
        execution.recover_cloud.assert_not_called()
        execution.finish.assert_not_called()
        execution.Session.assert_not_called()
        execution.environment.raw.assert_not_called()
        execution.environment.resume.assert_not_called()
        self.assertEqual(list(execution.candidate.iterdir()), [])

    def test_real_parser_codes_reach_real_worker_terminal_without_raw_response(self):
        for expected, content in invalid_planner_responses():
            with self.subTest(expected=expected):
                execution = self.execution()
                terminal, events, parser_call = self.terminal_for(execution, content)
                parser_call.assert_called_once_with(content)
                self.assert_initial_stop(execution, terminal, events, 'routing_plan_rejected:' + expected)

    def test_unknown_and_nonstring_codes_map_only_to_unknown_without_stringifying(self):
        class UnprintableCode:
            def __str__(self):
                raise AssertionError('unknown diagnostic code must not be stringified')

            def __repr__(self):
                raise AssertionError('unknown diagnostic code must not be serialized')

        class CodeSubclass(str):
            pass

        cases = (
            ('unknown-string', PLANNER_REJECTION_SENTINEL),
            ('allowlist-prefix', 'planner_checks_schema:' + PLANNER_REJECTION_SENTINEL),
            ('none', None), ('integer', 7), ('boolean', True),
            ('mapping', {'source': PLANNER_REJECTION_SENTINEL}),
            ('list', [PLANNER_REJECTION_SENTINEL]),
            ('string-subclass', CodeSubclass('planner_checks_schema')),
            ('unprintable-object', UnprintableCode()),
        )
        content = planner_response(PLANNER_SOURCE + '\n# ' + PLANNER_REJECTION_SENTINEL)
        for label, code in cases:
            with self.subTest(case=label):
                execution = self.execution()
                error = coding_execution.PlannerChecksError(code)
                terminal, events, parser_call = self.terminal_for(execution, content, parser_error=error)
                parser_call.assert_called_once_with(content)
                self.assert_initial_stop(execution, terminal, events, 'routing_plan_rejected:unknown')

    def test_non_planner_parse_exception_keeps_generic_terminal_handling(self):
        execution = self.execution()
        content = planner_response(PLANNER_SOURCE + '\n# ' + PLANNER_REJECTION_SENTINEL)
        terminal, events, parser_call = self.terminal_for(execution, content,
            parser_error=ValueError(PLANNER_REJECTION_SENTINEL))
        parser_call.assert_called_once_with(content)
        self.assert_initial_stop(execution, terminal, events, 'ValueError')

    def test_outer_response_failure_keeps_existing_error_and_never_calls_parser(self):
        execution = self.execution()
        content = planner_response(PLANNER_SOURCE + '\n# ' + PLANNER_REJECTION_SENTINEL)
        terminal, events, parser_call = self.terminal_for(execution, content, finish_reason='length')
        parser_call.assert_not_called()
        self.assert_initial_stop(execution, terminal, events, 'routing_plan_invalid')

    def test_later_real_artifact_declaration_rejection_is_not_initial_plan_rejection(self):
        execution = self.execution()
        observed = []

        def invalid_later_artifact(*_):
            execution.generated_checks = replace(execution.generated_checks,
                source=execution.generated_checks.source + '\nunittest.main()\n')
            try:
                execution.planner_check(execution.candidate, stage='checkpoint')
            except coding_execution.PlannerChecksError as error:
                observed.append(error.code)
                raise

        execution.local.side_effect = invalid_later_artifact
        content = planner_response()
        terminal, events, parser_call = self.terminal_for(execution, content)
        parser_call.assert_called_once_with(content)
        self.assertEqual(observed, ['planner_checks_declarations'])
        self.assertEqual(terminal['errorCode'], 'PlannerChecksError')
        self.assertNotIn('routing_plan_rejected:', execution.bridge.sink.getvalue())
        self.assertEqual(sum(event['type'] == 'plan.ready' for event in events), 1)
        execution.local.assert_called_once_with('', 'Implement the public task.')
        execution.Session.assert_called_once_with(execution.bridge, execution.start)
        execution.Session.return_value.raw.assert_not_called()
        self.assertFalse(any(event['type'] in ('planner.checks.checked', 'patch.ready', 'patch.recovered',
            'command.started', 'checkpoint.checked') for event in events))
        execution.recover_cloud.assert_not_called()
        execution.finish.assert_not_called()


@unittest.skipUnless(os.environ.get('SOAR_TEST_DOCKER_IMAGE'), 'set pinned Docker image for real sandbox proofs')
class RoutedDockerTests(unittest.TestCase):
    def run_route(self, policy, actions, check="python -I -c \"assert open('value.txt').read().strip() == 'fixed'\"", bridge_factory=None, limits=None, **kwargs):
        self.source = tempfile.TemporaryDirectory(prefix='soar-routing-test-')
        self.addCleanup(self.source.cleanup)
        Path(self.source.name, 'value.txt').write_text('broken\n')
        sink = io.StringIO()
        bridge = (bridge_factory or worker.Bridge)(sink=sink)
        start = config(self.source.name, policy=policy, containerImage=os.environ['SOAR_TEST_DOCKER_IMAGE'],
            scriptedActions=actions, visibleTestCommand=check,
            limits={'wallTimeSeconds': 600, 'stepLimit': 40, 'requestTimeoutSeconds': 10,
                    'visibleCheckTimeoutSeconds': 5, 'commandTimeoutSeconds': 3, **(limits or {})}, **kwargs)
        bridge.run_id = start['runId']
        bridge.deadline = time.monotonic() + start['limits']['wallTimeSeconds']
        try:
            status = worker.run_job(bridge, start)
            error = None
        except worker.WorkerError as caught:
            status, error = 'failed', str(caught)
        events = [json.loads(line) for line in sink.getvalue().splitlines()]
        self.assertEqual(Path(self.source.name, 'value.txt').read_text(), 'broken\n')
        created = {event['containerId'] for event in events if event['type'] == 'container.created'}
        removed = {event['containerId'] for event in events if event['type'] == 'container.removed' and event['confirmed']}
        self.assertTrue(created)
        self.assertEqual(created, removed)
        return status, error, events

    def test_local_only_submits_only_after_fresh_real_check_without_cloud(self):
        status, error, events = self.run_route('local_only', ["printf 'fixed\\n' > value.txt", 'SOAR_SUBMIT'])
        self.assertEqual((status, error), ('completed', None))
        self.assertEqual([e['phase'] for e in events if e['type'] == 'phase.started'], ['local'])
        checked = [e for e in events if e['type'] == 'checkpoint.checked']
        self.assertEqual(len(checked), 1)
        self.assertTrue(checked[0]['passed'])
        submitted = [e['checkpoint'] for e in events if e['type'] == 'routing.checkpoint' and e['checkpoint']['decision'] == 'submit']
        self.assertEqual(submitted[0]['checkSourceSha256'], checked[0]['sourceSha256'])
        self.assertIn('+fixed', next(e['patch'] for e in events if e['type'] == 'patch.ready'))
        self.assertTrue(next(e['passed'] for e in events if e['type'] == 'verification.finished'))

    def test_eight_call_local_only_uses_six_edits_then_fresh_check_and_submit(self):
        actions = ["printf 'work-" + str(index) + "\\n' > value.txt" for index in range(1, 6)]
        actions += ["printf 'fixed\\n' > value.txt", 'SOAR_SUBMIT']
        status, error, events = self.run_route('local_only', actions, limits={'stepLimit': 8, 'localStepLimit': 8})
        self.assertEqual((status, error), ('completed', None))
        self.assertEqual([event['phase'] for event in events if event['type'] == 'phase.started'], ['local'])
        calls = [event for event in events if event['type'] == 'model.finished']
        self.assertEqual(len(calls), 8)
        self.assertTrue(all(event['phase'] == 'local' and event['simulated'] for event in calls))
        self.assertFalse(any(event['type'] in ('request.prepare', 'handoff.ready', 'patch.recovered') for event in events))
        commands = [event for event in events if event['type'] == 'command.finished']
        self.assertEqual([event['command'] for event in commands], actions[:6])
        self.assertTrue(all(event['returncode'] == 0 for event in commands))

        checkpoints = [event['checkpoint'] for event in events if event['type'] == 'routing.checkpoint']
        self.assertEqual(checkpoints[0]['evidence']['maxLocalCalls'], 8)
        self.assertEqual(checkpoints[0]['evidence']['finishReserve'], 2)
        self.assertTrue(all(value['localCalls'] + value['remainingLocalCalls'] == 8 for value in checkpoints))
        requests = [value for value in checkpoints if value['reason'] == 'local_request_started']
        self.assertEqual([value['localCalls'] for value in requests], list(range(1, 9)))
        self.assertTrue(all('run_command' in value['allowedActions'] for value in requests[:6]))
        self.assertEqual(requests[6]['allowedActions'], ['run_visible_checks', 'request_help'])
        self.assertEqual(requests[7]['allowedActions'], ['submit_task', 'request_help'])
        edits = [value for value in checkpoints if value['reason'] in ('command_observed', 'finish_required')]
        self.assertEqual(len(edits), 6)
        self.assertTrue(all(value['evidence']['sourceChanged'] for value in edits))

        checks = [event for event in events if event['type'] == 'checkpoint.checked']
        self.assertEqual(len(checks), 1)
        checked = checks[0]
        with tempfile.TemporaryDirectory(prefix='soar-routing-expected-') as expected:
            Path(expected, 'value.txt').write_text('fixed\n')
            expected_source = tree_identity(Path(expected))[0]
        self.assertEqual((checked['passed'], checked['sourceSha256'], checked['sourceAfterSha256']),
            (True, expected_source, expected_source))
        submitted = next(event for event in events if event['type'] == 'routing.checkpoint' and event['checkpoint']['decision'] == 'submit')
        self.assertEqual((submitted['checkpoint']['localCalls'], submitted['checkpoint']['remainingLocalCalls']), (8, 0))
        self.assertEqual(submitted['checkpoint']['checkSourceSha256'], expected_source)
        patch = next(event for event in events if event['type'] == 'patch.ready')
        self.assertIn('-broken', patch['patch'])
        self.assertIn('+fixed', patch['patch'])
        self.assertEqual(patch['sha256'], hashlib.sha256(patch['patch'].encode()).hexdigest())
        final = next(event for event in events if event['type'] == 'verification.finished')
        self.assertEqual((final['passed'], final['sourceSha256'], final['sourceAfterSha256']),
            (True, expected_source, expected_source))
        self.assertLess(calls[6]['sequence'], checked['sequence'])
        self.assertLess(checked['sequence'], calls[7]['sequence'])
        self.assertLess(calls[7]['sequence'], submitted['sequence'])
        self.assertLess(submitted['sequence'], patch['sequence'])
        self.assertLess(patch['sequence'], final['sequence'])

    def test_one_cloud_recovery_keeps_local_patch_and_exact_handoff(self):
        status, error, events = self.run_route('local_first', ["printf 'fixed\\n' > value.txt", 'SOAR_REQUEST_HELP',
            "test \"$(cat value.txt)\" = fixed && printf 'kept\\n' > recovery.txt", 'SOAR_SUBMIT'])
        self.assertEqual((status, error), ('completed', None))
        self.assertEqual([e['phase'] for e in events if e['type'] == 'phase.started'], ['local', 'cloud'])
        recovered = next(e for e in events if e['type'] == 'patch.recovered')
        handoff = next(e for e in events if e['type'] == 'handoff.ready')
        self.assertEqual(handoff['patchSha256'], recovered['sha256'])
        self.assertEqual(handoff['bytes'], len(recovered['patch'].encode()))
        patch = next(e['patch'] for e in events if e['type'] == 'patch.ready')
        self.assertIn('+fixed', patch)
        self.assertIn('+kept', patch)
        escalations = [e for e in events if e['type'] == 'routing.checkpoint' and e['checkpoint']['decision'] == 'escalate']
        self.assertEqual(len(escalations), 1)

    def test_cloud_plan_then_local_success_has_no_recovery(self):
        status, error, events = self.run_route('cloud_plan_local', ["printf 'fixed\\n' > value.txt", 'SOAR_SUBMIT'])
        self.assertEqual((status, error), ('completed', None))
        self.assertEqual([e['phase'] for e in events if e['type'] == 'phase.started'], ['planner', 'local'])
        plan = next(e for e in events if e['type'] == 'plan.ready')
        self.assertEqual(plan['sha256'], hashlib.sha256(plan['summary'].encode()).hexdigest())
        self.assertNotIn('handoff.ready', [e['type'] for e in events])

    def test_reviewed_policy_requires_cloud_after_success_and_can_repair_the_actual_candidate(self):
        status, error, events = self.run_route('cloud_plan_local_review', [
            "printf 'fixed\\n' > value.txt; printf 'defect\\n' > compatibility.txt", 'SOAR_SUBMIT',
            "test \"$(cat value.txt)\" = fixed && test \"$(cat compatibility.txt)\" = defect && printf 'repaired\\n' > compatibility.txt",
            'SOAR_SUBMIT'])
        self.assertEqual((status, error), ('completed', None))
        self.assertEqual([e['phase'] for e in events if e['type'] == 'phase.started'], ['planner', 'local', 'cloud'])
        checkpoints = [e['checkpoint'] for e in events if e['type'] == 'routing.checkpoint']
        provisional = next(c for c in checkpoints if c['reason'] == 'review_required')
        self.assertEqual(provisional['decision'], 'checkpoint')
        self.assertEqual(provisional['sourceSha256'], provisional['checkSourceSha256'])
        self.assertEqual(provisional['evidence']['checkSourceSha256'], provisional['sourceSha256'])
        self.assertFalse(any(c['decision'] == 'submit' for c in checkpoints))
        self.assertEqual(sum(c['decision'] == 'escalate' for c in checkpoints), 1)
        recovered = next(e for e in events if e['type'] == 'patch.recovered')
        handoff = next(e for e in events if e['type'] == 'handoff.ready')
        self.assertEqual(handoff['patchSha256'], recovered['sha256'])
        self.assertIn('+defect', recovered['patch'])
        patch = next(e for e in events if e['type'] == 'patch.ready')
        self.assertIn('+fixed', patch['patch'])
        self.assertIn('+repaired', patch['patch'])
        cloud = next(e for e in events if e['type'] == 'phase.started' and e['phase'] == 'cloud')
        self.assertLess(cloud['sequence'], patch['sequence'])
        self.assertTrue(next(e['passed'] for e in events if e['type'] == 'verification.finished'))

    def test_reviewed_policy_difficulty_checkpoint_still_has_only_one_cloud_handoff(self):
        status, error, events = self.run_route('cloud_plan_local_review', [
            "printf 'fixed\\n' > value.txt", 'SOAR_REQUEST_HELP', 'SOAR_SUBMIT'])
        self.assertEqual((status, error), ('completed', None))
        self.assertEqual([e['phase'] for e in events if e['type'] == 'phase.started'], ['planner', 'local', 'cloud'])
        self.assertEqual(sum(e['type'] == 'handoff.ready' for e in events), 1)
        self.assertIn('+fixed', next(e['patch'] for e in events if e['type'] == 'patch.ready'))

    def test_three_unchanged_commands_stop_local_only_and_preserve_unfinished_patch(self):
        status, error, events = self.run_route('local_only', ["printf 'fixed\\n' > value.txt", 'cat value.txt', 'cat value.txt', 'cat value.txt', 'SOAR_SUBMIT'])
        self.assertEqual((status, error), ('failed', 'routing_local_only_checkpoint'))
        checkpoints = [e['checkpoint'] for e in events if e['type'] == 'routing.checkpoint']
        self.assertIn('repeated_observation', [c['reason'] for c in checkpoints])
        self.assertEqual(len([e for e in events if e['type'] == 'model.finished']), 4)
        self.assertNotIn('patch.ready', [e['type'] for e in events])
        self.assertIn('+fixed', next(e['patch'] for e in events if e['type'] == 'patch.recovered'))

    def test_agent_cannot_forge_check_by_replacing_python_in_its_container(self):
        status, error, events = self.run_route('local_first', [
            "printf '#!/bin/sh\\nexit 0\\n' > /usr/local/bin/fake-python && chmod +x /usr/local/bin/fake-python && ln -sf /usr/local/bin/fake-python /usr/local/bin/python",
            'SOAR_SUBMIT'])
        self.assertEqual(status, 'failed')
        check = next(e for e in events if e['type'] == 'checkpoint.checked')
        self.assertFalse(check['passed'])
        self.assertNotEqual(check['returncode'], 0)
        self.assertNotIn('cloud', [e['phase'] for e in events if e['type'] == 'phase.started'])
        self.assertNotIn('patch.ready', [e['type'] for e in events])

    def test_pipe_masks_no_failed_trusted_check(self):
        status, error, events = self.run_route('local_only', ['SOAR_SUBMIT'], check="python -I -c 'raise SystemExit(4)' | cat")
        check = next(e for e in events if e['type'] == 'checkpoint.checked')
        self.assertEqual(check['returncode'], 4)
        self.assertFalse(check['passed'])
        self.assertEqual(status, 'failed')

    def test_command_timeout_never_escalates_and_keeps_partial_edit(self):
        status, error, events = self.run_route('local_first', ["printf 'fixed\\n' > value.txt; sleep 30"])
        self.assertEqual((status, error), ('failed', 'container_command_timeout'))
        self.assertEqual([e['phase'] for e in events if e['type'] == 'phase.started'], ['local'])
        self.assertNotIn('handoff.ready', [e['type'] for e in events])
        self.assertIn('+fixed', next(e['patch'] for e in events if e['type'] == 'patch.recovered'))

    def test_cancel_during_fresh_reconstruction_keeps_last_complete_source(self):
        original = worker.DockerSession.install_candidate
        calls = []
        def install(session, candidate):
            calls.append(candidate)
            if len(calls) == 2:
                session.bridge.cancelled.set()
                raise worker.Cancelled('cancelled')
            return original(session, candidate)
        with mock.patch.object(worker.DockerSession, 'install_candidate', install):
            status, error, events = self.run_route('local_first', ["printf 'fixed\\n' > value.txt", 'SOAR_SUBMIT'])
        self.assertEqual((status, error), ('failed', 'cancelled'))
        self.assertGreaterEqual(len(calls), 3)
        self.assertTrue(next(e['passed'] for e in events if e['type'] == 'checkpoint.checked'))
        self.assertIn('+fixed', next(e['patch'] for e in events if e['type'] == 'patch.recovered'))
        self.assertNotIn('handoff.ready', [e['type'] for e in events])

    def test_check_that_changes_source_cannot_certify_its_own_new_tree(self):
        status, error, events = self.run_route('local_only', ['SOAR_SUBMIT'],
            check="python -I -c \"open('value.txt', 'w').write('fixed')\"")
        checked = next(e for e in events if e['type'] == 'checkpoint.checked')
        self.assertEqual(checked['returncode'], 0)
        self.assertNotEqual(checked['sourceSha256'], checked['sourceAfterSha256'])
        self.assertFalse(checked['passed'])
        self.assertEqual(status, 'failed')
        self.assertNotIn('patch.ready', [e['type'] for e in events])

    def test_real_http_native_history_and_usage_complete_before_each_tool(self):
        bodies = []
        actions = [('run_command', {'command': "printf 'fixed\\n' > value.txt"}),
                   ('run_visible_checks', {}), ('submit_task', {})]
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                bodies.append(body)
                name, arguments = actions[len(bodies) - 1]
                response = {'model': 'local-fixture', 'choices': [{'finish_reason': 'tool_calls',
                    'message': {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'call_' + str(len(bodies)),
                    'type': 'function', 'function': {'name': name, 'arguments': json.dumps(arguments)}}]}}],
                    'usage': {'prompt_tokens': 30, 'completion_tokens': 10}}
                data = json.dumps(response).encode()
                self.send_response(200)
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        test = self
        class AdmittingBridge(worker.Bridge):
            def admit(self, request_id, digest):
                event = json.loads(self.sink.getvalue().splitlines()[-1])
                test.assertEqual(event['requestId'], request_id)
                test.assertEqual(hashlib.sha256(worker.canonical_json(event['preparedRequest']['body'])).hexdigest(), digest)
                self.inbox.put({'type': 'request.admitted', 'requestId': request_id, 'bodySha256': digest})
                super().admit(request_id, digest)
        status, error, events = self.run_route('local_only', [], bridge_factory=AdmittingBridge, mode='live',
            providers={'local': {'id': 'local', 'protocol': 'openai', 'model': 'local-fixture',
                'endpoint': f'http://127.0.0.1:{server.server_port}/local', 'allowInsecureHttp': True}})
        self.assertEqual((status, error), ('completed', None))
        self.assertEqual(len(bodies), 3)
        self.assertEqual([len(body['messages']) for body in bodies], [2, 4, 6])
        self.assertEqual(bodies[2]['messages'][:4], bodies[1]['messages'])
        self.assertEqual(bodies[2]['messages'][3]['tool_call_id'], 'call_1')
        self.assertEqual(bodies[2]['messages'][5]['tool_call_id'], 'call_2')
        self.assertIn('Exit code: 0', bodies[2]['messages'][5]['content'])
        self.assertEqual(bodies[0]['max_tokens'], 8192)
        self.assertEqual([tool['function']['name'] for tool in bodies[0]['tools']],
                         ['run_command', 'run_visible_checks', 'request_help'])
        finished = [e for e in events if e['type'] == 'request.finished']
        self.assertEqual(len(finished), 3)
        self.assertTrue(all(e['usage']['reported'] for e in finished))
        self.assertNotIn('request.unsettled', [e['type'] for e in events])
        command_start = next(e['sequence'] for e in events if e['type'] == 'command.started')
        self.assertLess(finished[0]['sequence'], command_start)

    def test_reviewed_http_uses_fresh_cloud_context_and_unknown_local_never_triggers_review(self):
        for fail_local in (False, True):
            with self.subTest(fail_local=fail_local):
                bodies, local_bodies, cloud_bodies = [], [], []
                actions = [('run_command', {'command': "printf 'fixed\\n' > value.txt"}),
                           ('run_visible_checks', {}), ('submit_task', {})]
                class Handler(http.server.BaseHTTPRequestHandler):
                    def log_message(self, *args):
                        pass
                    def do_POST(self):
                        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                        bodies.append(body)
                        if self.path == '/local':
                            local_bodies.append(body)
                            if fail_local:
                                self.send_response(500)
                                self.send_header('Content-Length', '0')
                                self.end_headers()
                                return
                            name, args = actions[len(local_bodies) - 1]
                            message = {'role': 'assistant', 'content': None, 'tool_calls': [{
                                'id': 'local_' + str(len(local_bodies)), 'type': 'function',
                                'function': {'name': name, 'arguments': json.dumps(args)}}]}
                            finish = 'tool_calls'
                        else:
                            cloud_bodies.append(body)
                            content = 'Planner-only marker: fix value.txt and run checks.' if len(cloud_bodies) == 1 else '```mswea_bash_command\nSOAR_SUBMIT\n```'
                            message, finish = {'role': 'assistant', 'content': content}, 'stop'
                        data = json.dumps({'model': body['model'], 'choices': [{'finish_reason': finish, 'message': message}],
                            'usage': {'prompt_tokens': 30, 'completion_tokens': 10}}).encode()
                        self.send_response(200)
                        self.send_header('Content-Length', str(len(data)))
                        self.end_headers()
                        self.wfile.write(data)
                server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                class AdmittingBridge(worker.Bridge):
                    def admit(self, request_id, digest):
                        self.inbox.put({'type': 'request.admitted', 'requestId': request_id, 'bodySha256': digest})
                        super().admit(request_id, digest)
                try:
                    status, error, events = self.run_route('cloud_plan_local_review', [], bridge_factory=AdmittingBridge, mode='live',
                        providers={role: {'id': role, 'protocol': 'openai', 'model': role + '-fixture',
                            'endpoint': f'http://127.0.0.1:{server.server_port}/{role}', 'allowInsecureHttp': True}
                            for role in ('local', 'cloud')})
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join(timeout=5)
                if fail_local:
                    self.assertEqual(status, 'failed')
                    self.assertEqual(len(cloud_bodies), 1, 'unknown local outcome cannot authorize review or repair')
                    self.assertEqual(len(local_bodies), 1)
                    self.assertEqual(sum(e['type'] == 'request.unsettled' for e in events), 1)
                    self.assertNotIn('handoff.ready', [e['type'] for e in events])
                    self.assertNotIn('patch.ready', [e['type'] for e in events])
                else:
                    self.assertEqual((status, error), ('completed', None))
                    self.assertEqual(len(bodies), 5)
                    self.assertEqual(len(cloud_bodies), 2)
                    review_messages = cloud_bodies[1]['messages']
                    self.assertEqual([m['role'] for m in review_messages], ['system', 'user'])
                    review = review_messages[-1]['content']
                    self.assertIn('Mandatory independent-context review and optional repair', review)
                    self.assertIn('COMPLETE workspace git diff', review)
                    self.assertIn('pipelines can mask failure', review)
                    self.assertIn('+fixed', review)
                    self.assertNotIn('Planner-only marker', review)
                    self.assertNotIn('tool_calls', json.dumps(review_messages))
                    finished = [e for e in events if e['type'] == 'request.finished']
                    self.assertEqual([e['phase'] for e in finished], ['planner', 'local', 'local', 'local', 'cloud'])
                    self.assertNotIn('request.unsettled', [e['type'] for e in events])
                    self.assertLess(finished[-1]['sequence'], next(e['sequence'] for e in events if e['type'] == 'patch.ready'))


if __name__ == '__main__':
    unittest.main()
