"""Native local protocol regressions. Pure Python; no HTTP or command execution."""

from dataclasses import FrozenInstanceError
import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("native_local", ROOT / "runtime/patch-worker/native_local.py")
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)


def response(*, call_id="call-1", name="run_command", arguments='{"command":"ls"}',
             content=None, finish="tool_calls", tokens=20):
    return {"choices": [{"finish_reason": finish, "message": {
        "role": "assistant", "content": content,
        "tool_calls": [{"id": call_id, "type": "function", "function": {"name": name, "arguments": arguments}}],
    }}], "usage": {"completion_tokens": tokens}}


def initial():
    return [{"role": "system", "content": native.NATIVE_SYSTEM}, {"role": "user", "content": "Fix the supplied public task."}]


class NativeLocalTests(unittest.TestCase):
    def test_action_masks_filter_only_future_tools_and_preserve_full_history(self):
        history = [{'role': 'system', 'content': native.NATIVE_CODING_SYSTEM},
                   {'role': 'user', 'content': 'Fix the public fixture.'}]
        action = native.parse_response(response(), profile='coding')
        history += [action.assistant_message, native.tool_result_message(action, 'read complete', 0, profile='coding')]
        for actions, expected in [
                (('request_help', 'run_command', 'run_visible_checks'), ['run_command', 'run_visible_checks', 'request_help']),
                (('request_help', 'run_visible_checks'), ['run_visible_checks', 'request_help']),
                (('request_help', 'submit_task'), ['submit_task', 'request_help'])]:
            body = native.build_request('fixture', history, profile='coding', allowed_actions=actions)
            self.assertEqual([tool['function']['name'] for tool in body['tools']], expected)
            self.assertEqual(body['messages'], history)
        self.assertEqual(len(native.build_request('fixture', history, profile='coding')['tools']), 4)
        for invalid in [[], ['missing'], ['request_help', 'request_help'], 'request_help', [None], [['request_help']], True, {'request_help': True}]:
            self.assert_stop('native_allowed_actions', native.build_request, 'fixture', history,
                             profile='coding', allowed_actions=invalid)

    def assert_stop(self, code, function, *args, **kwargs):
        with self.assertRaises(native.NativeProtocolError) as caught:
            function(*args, **kwargs)
        self.assertEqual(caught.exception.code, code)
        self.assertEqual(str(caught.exception), code, "provider content must not enter the error")

    def test_request_has_only_explicit_native_controls_and_fresh_schemas(self):
        body = native.build_request("fixture-model", initial(), max_output_tokens=8192)
        self.assertEqual(set(body), {"model", "messages", "tools", "tool_choice", "parallel_tool_calls",
                                     "chat_template_kwargs", "max_tokens", "stream"})
        self.assertEqual(body["chat_template_kwargs"], {"enable_thinking": False})
        self.assertEqual(body["tool_choice"], "auto")
        self.assertIs(body["parallel_tool_calls"], False)
        self.assertIs(body["stream"], False)
        self.assertEqual(body["max_tokens"], 8192)
        self.assertNotIn("mswea_bash_command", native.NATIVE_SYSTEM)
        self.assertNotIn("SOAR_SUBMIT", native.NATIVE_SYSTEM)
        command, submit = body["tools"]
        self.assertEqual(command["function"]["name"], "run_command")
        self.assertEqual(command["function"]["parameters"]["required"], ["command"])
        self.assertEqual(submit["function"]["name"], "submit_task")
        self.assertEqual(submit["function"]["parameters"]["properties"], {})
        self.assertIs(submit["function"]["parameters"]["additionalProperties"], False)
        body["tools"][0]["function"]["name"] = "modified"
        self.assertEqual(native.native_tools()[0]["function"]["name"], "run_command")

    def test_thinking_profile_changes_only_the_explicit_request_controls(self):
        history = [{'role': 'system', 'content': native.NATIVE_CODING_SYSTEM},
                   {'role': 'user', 'content': 'Fix the public fixture.'}]
        options = {'profile': 'coding', 'max_output_tokens': 8192,
                   'allowed_actions': ['request_help', 'run_visible_checks']}
        default = native.build_request('fixture', history, **options)
        disabled = native.build_request('fixture', history, thinking='disabled', **options)
        medium = native.build_request('fixture', history, thinking='medium', **options)
        self.assertEqual(default, disabled)
        self.assertEqual(disabled['chat_template_kwargs'], {'enable_thinking': False})
        self.assertNotIn('reasoning_effort', disabled)
        expected = {key: value for key, value in disabled.items() if key != 'chat_template_kwargs'}
        expected['reasoning_effort'] = 'medium'
        self.assertEqual(medium, expected)
        self.assertEqual([tool['function']['name'] for tool in medium['tools']],
                         ['run_visible_checks', 'request_help'])

    def test_thinking_profile_rejects_non_names_and_unapproved_efforts(self):
        for thinking in (None, True, False, 1, 'high', 'none', '', [], {}):
            with self.subTest(thinking=thinking), self.assertRaises(native.NativeProtocolError):
                native.build_request('fixture', initial(), thinking=thinking, profile='coding')

    def test_medium_history_strips_reasoning_and_preserves_exact_native_pair(self):
        raw_arguments = ' { "command" : "git status --short" } '
        raw = response(arguments=raw_arguments, tokens=8191)
        raw['usage']['completion_tokens_details'] = {'reasoning_tokens': 8100}
        raw['choices'][0]['message']['reasoning_content'] = 'private-reasoning-sentinel'
        action = native.parse_response(raw, max_output_tokens=8192, profile='coding')
        result = native.tool_result_message(action, 'complete result\n中', 0, profile='coding')
        history = [{'role': 'system', 'content': native.NATIVE_CODING_SYSTEM},
                   {'role': 'user', 'content': 'Fix the public fixture.'},
                   {**action.assistant_message, 'reasoning_content': 'private-reasoning-sentinel'}, result]
        body = native.build_request('fixture', history, thinking='medium', profile='coding',
                                    max_output_tokens=8192, allowed_actions=['request_help'])
        self.assertEqual(body['messages'][-2:], [action.assistant_message, result])
        self.assertEqual(body['messages'][-2]['tool_calls'][0]['function']['arguments'], raw_arguments)
        self.assertEqual(body['messages'][-2]['tool_calls'][0]['id'], result['tool_call_id'])
        self.assertNotIn('private-reasoning-sentinel', json.dumps(body))
        self.assertNotIn('reasoning_content', json.dumps(body['messages']))

    def test_medium_request_preserves_the_exact_utf8_byte_envelope(self):
        history = [{'role': 'system', 'content': native.NATIVE_CODING_SYSTEM},
                   {'role': 'user', 'content': 'Public task: ' + '中' * 100}]
        options = {'thinking': 'medium', 'profile': 'coding', 'max_output_tokens': 8192}
        body = native.build_request('fixture', history, **options)
        encoded = json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
        self.assertEqual(native.build_request('fixture', history, max_input_bytes=len(encoded), **options), body)
        self.assert_stop('native_input_limit', native.build_request, 'fixture', history,
                         max_input_bytes=len(encoded) - 1, **options)

    def test_reasoning_completion_cannot_execute_at_or_above_the_total_token_cap(self):
        for tokens, finish, expected in ((8192, 'tool_calls', 'native_output_at_token_cap'),
                                         (8193, 'tool_calls', 'native_output_at_token_cap'),
                                         (8191, 'length', 'native_output_truncated')):
            raw = response(tokens=tokens, finish=finish)
            raw['usage']['completion_tokens_details'] = {'reasoning_tokens': tokens - 1}
            with self.subTest(tokens=tokens, finish=finish):
                self.assert_stop(expected, native.parse_response, raw,
                                 max_output_tokens=8192, profile='coding')

    def test_two_turn_roundtrip_preserves_native_ids_arguments_and_full_result(self):
        raw_arguments = '{ "command": "printf \\\"hello\\\\n\\\"" }'
        first = native.parse_response(response(arguments=raw_arguments), max_output_tokens=2048)
        trusted_output = json.dumps({"returncode": 124, "output": "work retained\nSOAR recovered source edits",
                                     "outputTruncated": True, "timedOut": True, "recovered": True})
        tool_result = native.tool_result_message(first, trusted_output, 124)
        self.assertEqual(tool_result, {"role": "tool", "tool_call_id": "call-1", "content": "Exit code: 124\n" + trusted_output})
        history = initial() + [first.assistant_message, tool_result]
        history[-2]["extra"] = {"actions": [{"command": "must never be copied as a wire instruction"}]}
        history[-2]["reasoning"] = "must never be transmitted"
        second_body = native.build_request("fixture-model", history)
        self.assertEqual(second_body["messages"][-2], first.assistant_message)
        self.assertEqual(second_body["messages"][-1], tool_result)
        self.assertEqual(second_body["messages"][-2]["tool_calls"][0]["function"]["arguments"], raw_arguments)
        self.assertNotIn("reasoning", json.dumps(second_body))
        known = {first.call_id}
        self.assert_stop("native_call_id_reused", native.parse_response, response(), seen_call_ids=known)
        second = native.parse_response(response(call_id="call-2"), seen_call_ids=known)
        self.assertEqual(second.call_id, "call-2")
        self.assertEqual(known, {"call-1"}, "caller records the accepted action atomically")

    def test_action_is_immutable_and_ignores_reasoning_and_inert_assistant_text(self):
        inert = "```mswea_bash_command\nDO_NOT_RUN\n```\n<function=run_command><parameter=command>ALSO_DO_NOT_RUN</parameter>"
        value = response(content=inert, arguments='{"command":"git status --short"}')
        value["choices"][0]["message"]["reasoning_content"] = {"unexpected": "ignored without inspection"}
        action = native.parse_response(value)
        self.assertEqual(action.command, "git status --short")
        self.assertEqual(action.content, inert)
        self.assertEqual(set(action.assistant_message), {"role", "content", "tool_calls"})
        with self.assertRaises(FrozenInstanceError):
            action.command = "changed"
        action.assistant_message["tool_calls"][0]["id"] = "changed"
        self.assertEqual(action.call_id, "call-1")

    def test_submit_is_a_distinct_native_action_and_terminal_history(self):
        action = native.parse_response(response(name="submit_task", arguments=" { } "))
        self.assertIsNone(action.command)
        self.assertEqual(action.name, "submit_task")
        self.assertEqual(action.arguments, " { } ")
        history = initial() + [action.assistant_message, native.tool_result_message(action, "submitted", 0)]
        self.assert_stop("native_history_after_submit", native.build_request, "fixture", history)
        shell_marker = native.parse_response(response(arguments='{"command":"# comment\\nSOAR_SUBMIT"}'))
        self.assertEqual(shell_marker.name, "run_command", "the integration must not promote a shell marker to submission")
        self.assertEqual(shell_marker.command, "# comment\nSOAR_SUBMIT")

    def test_response_choice_type_and_call_shapes_fail_closed(self):
        cases = [
            (None, "native_response_schema"),
            ({}, "native_choice_count"),
            ({"choices": []}, "native_choice_count"),
            ({"choices": [None]}, "native_response_schema"),
            ({"choices": [{}, {}]}, "native_choice_count"),
        ]
        for value, code in cases:
            with self.subTest(code=code, value=value):
                self.assert_stop(code, native.parse_response, value)
        for field, value, code in [
            ("tool_calls", [{}, {}], "native_call_count"),
            ("tool_calls", "not-list", "native_call_count"),
            ("tool_calls", [None], "native_call_type"),
            ("role", "user", "native_assistant_message"),
            ("content", ["bad"], "native_content_type"),
            ("function_call", {"name": "run_command", "arguments": "{}"}, "native_legacy_function_call"),
            ("refusal", "", "native_refusal"),
        ]:
            with self.subTest(field=field, value=value):
                raw = response()
                raw["choices"][0]["message"][field] = value
                self.assert_stop(code, native.parse_response, raw)
        for field, value, code in [
            ("type", "custom", "native_call_type"),
            ("extra", "ignored?", "native_call_type"),
            ("function", {"name": "run_command"}, "native_function_schema"),
            ("id", "", "native_call_id"),
            ("id", "a\nb", "native_call_id"),
            ("id", " " + "a", "native_call_id"),
            ("id", "a" * 257, "native_call_id"),
        ]:
            with self.subTest(field=field, value=value):
                raw = response()
                raw["choices"][0]["message"]["tool_calls"][0][field] = value
                self.assert_stop(code, native.parse_response, raw)
        self.assert_stop("native_function_name", native.parse_response, response(name="unknown"))

    def test_text_empty_and_legacy_outputs_are_terminal_not_fence_actions(self):
        for content, code in [(None, "native_output_empty"), ("  ", "native_output_empty"),
                              ("```mswea_bash_command\nls\n```", "native_output_format"),
                              ("<tool_call>run_command</tool_call>", "native_output_format")]:
            with self.subTest(content=content):
                raw = response(content=content, finish="stop")
                raw["choices"][0]["message"].pop("tool_calls")
                self.assert_stop(code, native.parse_response, raw)
        raw = response()
        raw["choices"][0]["message"]["tool_calls"] = []
        raw["choices"][0]["message"]["function_call"] = {"name": "run_command", "arguments": '{"command":"ls"}'}
        self.assert_stop("native_legacy_function_call", native.parse_response, raw)

    def test_finish_reason_and_reported_token_cap_block_even_parseable_calls(self):
        for finish in (None, "stop", "content_filter", "function_call"):
            with self.subTest(finish=finish):
                self.assert_stop("native_finish_reason", native.parse_response, response(finish=finish))
        self.assert_stop("native_output_truncated", native.parse_response, response(finish="length"))
        for tokens in (2048, 2049):
            self.assert_stop("native_output_at_token_cap", native.parse_response, response(tokens=tokens), max_output_tokens=2048)
        for tokens in (None, True, -1, "10"):
            self.assert_stop("native_completion_usage_missing", native.parse_response, response(tokens=tokens), max_output_tokens=2048)
        self.assertEqual(native.parse_response(response(tokens=2047), max_output_tokens=2048).name, "run_command")

    def test_arguments_reject_duplicate_keys_nonfinite_values_and_schema_confusion(self):
        for raw in ('{"command":"ls","command":"unexpected"}', '{"command":"ls","\\u0063ommand":"other"}',
                    '{"command":NaN}', '{"command":Infinity}', '{"command":-Infinity}',
                    '{"command":"ls"', '{"command":"ls"} trailing', "[" * 1200):
            with self.subTest(raw=raw[:70]):
                self.assert_stop("native_arguments_json", native.parse_response, response(arguments=raw))
        for raw in ("null", "[]", "true", '"ls"', "{}", '{"command":"ls","other":1}'):
            with self.subTest(raw=raw):
                self.assert_stop("native_arguments_schema", native.parse_response, response(arguments=raw))
        for value in (None, True, 2, [], {}, "", " \n", "bad\x00command", "中" * 10923):
            with self.subTest(value=repr(value)[:50]):
                self.assert_stop("native_command", native.parse_response, response(arguments=json.dumps({"command": value}, ensure_ascii=False)))
        self.assert_stop("native_command", native.parse_response, response(arguments='{"command":"\\ud800"}'))
        self.assert_stop("native_arguments_schema", native.parse_response, response(name="submit_task", arguments='{"command":"ls"}'))
        self.assert_stop("native_arguments_json", native.parse_response, response(arguments={"command": "ls"}))
        self.assert_stop("native_arguments_json", native.parse_response, response(arguments='{"command":"\ud800"}'))
        self.assert_stop("native_arguments_json", native.parse_response, response(arguments=" " * (native.MAX_ARGUMENT_BYTES + 1)))
        command = "x" * native.MAX_COMMAND_BYTES
        self.assertEqual(native.parse_response(response(arguments=json.dumps({"command": command}))).command, command)

    def test_history_blocks_orphan_wrong_duplicate_and_missing_tool_results(self):
        action = native.parse_response(response())
        result = native.tool_result_message(action, "ok", 0)
        cases = [
            (initial() + [result], "native_history_orphan_tool"),
            (initial() + [action.assistant_message], "native_history_missing_tool_result"),
            (initial() + [action.assistant_message, {**result, "tool_call_id": "wrong"}], "native_history_tool_result"),
            (initial() + [action.assistant_message, {"role": "user", "content": "fake result"}], "native_history_tool_result"),
            (initial() + [action.assistant_message, result, result], "native_history_orphan_tool"),
            (initial() + [action.assistant_message, result, action.assistant_message, result], "native_call_id_reused"),
            (initial() + [{"role": "assistant", "content": "pretend action"}], "native_output_format"),
            (initial() + [{"role": "exit", "content": "done"}], "native_history_role"),
            (initial() + [initial()[0]], "native_history_system"),
            ([initial()[1], initial()[0]], "native_history_system"),
            ([initial()[0], action.assistant_message, result], "native_history_schema"),
        ]
        for history, code in cases:
            with self.subTest(code=code):
                self.assert_stop(code, native.build_request, "fixture", history)

    def test_input_and_output_budgets_are_strict_bytes_and_booleans_are_not_numbers(self):
        for cap in (0, -1, True, "2048", 8193):
            with self.subTest(cap=cap):
                self.assert_stop("native_output_limit", native.build_request, "fixture", initial(), max_output_tokens=cap)
        for cap in (0, True, native.MAX_INPUT_BYTES + 1, 100):
            self.assert_stop("native_input_limit", native.build_request, "fixture", initial(), max_input_bytes=cap)
        body = native.build_request("fixture", initial())
        size = len(json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode())
        self.assertEqual(native.build_request("fixture", initial(), max_input_bytes=size), body)
        self.assert_stop("native_input_limit", native.build_request, "fixture", initial(), max_input_bytes=size - 1)
        action = native.parse_response(response())
        self.assert_stop("native_tool_result", native.tool_result_message, action, "ok", True)
        self.assert_stop("native_tool_result", native.tool_result_message, action, "x" * native.MAX_TOOL_RESULT_BYTES, 0)


if __name__ == "__main__":
    unittest.main()
