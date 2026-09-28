"""Pure, fail-closed native-tool protocol for an isolated local coding adapter.

This module performs no I/O or execution. The caller must settle the HTTP/usage
receipt before parsing, check cancellation before execution/submission, and run
commands only in its isolated environment. NativeProtocolError is terminal; it
must not be translated into mini-SWE's automatically retried FormatError.
"""

from collections.abc import Collection
from dataclasses import dataclass
import json


MAX_COMMAND_BYTES = 32768
MAX_ARGUMENT_BYTES = 65536
MAX_CONTENT_BYTES = 65536
MAX_TOOL_RESULT_BYTES = 65536
MAX_INPUT_BYTES = 256000
MAX_OUTPUT_TOKENS = 8192

NATIVE_SYSTEM = """You are implementing a repository change in /workspace in an isolated Linux container. Available tools include Python 3 with its standard library, Bash, Git, and basic shell utilities. Do not assume apply_patch or rg is installed; use Python for edits and grep/find for searches. Use any supplied host-observed inventory and source excerpts where sufficient. When context is absent or needs verification, list the actual repository with ls or git ls-files and inspect the relevant source and tests. Use paths you have observed, preserve the package structure and public API unless the task requests a change, implement the requested fix, and run relevant checks including the exact configured visible check. Before submission inspect git diff and git status, and remove temporary backups and scratch files you created. Respond with exactly one native function call: run_command with a command string to inspect, edit, or check the repository, or submit_task with an empty object when the patch and checks are ready. Put executable commands only in the run_command JSON argument. Do not put commands in prose, code fences, or XML tags. A shell exit code of zero does not submit the task; only the submit_task function does. Do not modify .git or read secrets. The host captures the real diff and independently runs the configured check. Do not claim checks passed unless their output confirms it."""


NATIVE_CODING_SYSTEM = NATIVE_SYSTEM.replace(
    'Respond with exactly one native function call: run_command with a command string to inspect, edit, or check the repository, or submit_task with an empty object when the patch and checks are ready.',
    'Respond with exactly one native function call: run_command for inspection or edits; run_visible_checks with an empty object to run the configured checks through the host; request_help with a concise reason if you cannot finish; or submit_task with an empty object after a fresh passing host check. Only run_visible_checks establishes check success; arbitrary shell output does not. Any subsequent source edit invalidates that check. The final two local requests are reserved for checking, submission or help. Budget guidance appears in tool results. Apply concrete fixes after a failed check; repeated diagnostic commands without source changes cause a checkpoint. Before asking for help, state the remaining obstacle briefly; the host preserves your patch and exact check evidence.')


class NativeProtocolError(Exception):
    """A fixed, non-provider-derived reason for a terminal protocol stop."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class NativeAction:
    call_id: str
    name: str
    command: str | None
    arguments: str
    content: str | None

    @property
    def assistant_message(self) -> dict:
        """A fresh wire message; preserve exact call IDs and argument strings."""
        return {"role": "assistant", "content": self.content, "tool_calls": [{
            "id": self.call_id, "type": "function",
            "function": {"name": self.name, "arguments": self.arguments},
        }]}


def _fail(code: str):
    raise NativeProtocolError(code)


def _text(value, cap: int, code: str, *, nonblank=False, no_nul=False) -> str:
    if not isinstance(value, str):
        _fail(code)
    try:
        size = len(value.encode("utf-8"))
    except UnicodeError:
        _fail(code)
    if size > cap or (nonblank and not value.strip()) or (no_nul and "\x00" in value):
        _fail(code)
    return value


def _call_id(value) -> str:
    value = _text(value, 256, "native_call_id", nonblank=True)
    if value != value.strip() or any(ord(char) < 32 or ord(char) == 127 for char in value):
        _fail("native_call_id")
    return value


def _seen_ids(values) -> set[str]:
    if isinstance(values, str) or not isinstance(values, Collection):
        _fail("native_seen_call_ids")
    return {_call_id(value) for value in values}


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate key")
        result[key] = value
    return result


def _invalid_constant(_value):
    raise ValueError("nonfinite constant")


def _arguments(value, name: str, profile="basic") -> tuple[str, str | None]:
    raw = _text(value, MAX_ARGUMENT_BYTES, "native_arguments_json")
    try:
        arguments = json.loads(raw, object_pairs_hook=_unique_object, parse_constant=_invalid_constant)
    except (ValueError, RecursionError):
        _fail("native_arguments_json")
    if not isinstance(arguments, dict):
        _fail("native_arguments_schema")
    if profile not in ("basic", "coding"):
        _fail("native_profile")
    if name == "request_help" and profile == "coding":
        if set(arguments) != {"reason"}:
            _fail("native_arguments_schema")
        _text(arguments["reason"], 1024, "native_help_reason", nonblank=True, no_nul=True)
        return raw, None
    if name == "submit_task" or (name == "run_visible_checks" and profile == "coding"):
        if arguments:
            _fail("native_arguments_schema")
        return raw, None
    if set(arguments) != {"command"}:
        _fail("native_arguments_schema")
    command = _text(arguments["command"], MAX_COMMAND_BYTES, "native_command", nonblank=True, no_nul=True)
    return raw, command


def native_tools(profile="basic") -> list[dict]:
    """Fresh schemas; auto mode is still validated locally before any action."""
    result = [
        {"type": "function", "function": {
            "name": "run_command",
            "description": "Run one Bash command string in the isolated repository container.",
            "parameters": {"type": "object", "properties": {
                "command": {"type": "string", "minLength": 1, "maxLength": MAX_COMMAND_BYTES},
            }, "required": ["command"], "additionalProperties": False},
        }},
        {"type": "function", "function": {
            "name": "submit_task",
            "description": "Finish the task and submit the current patch for host verification.",
            "parameters": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
        }},
    ]

    if profile == "coding":
        result.extend([
            {"type":"function","function":{"name":"run_visible_checks",
             "description":"Run the exact configured visible check on a frozen source snapshot in a fresh isolated container; obtain a source-bound receipt.",
             "parameters":{"type":"object","properties":{},"required":[],"additionalProperties":False}}},
            {"type":"function","function":{"name":"request_help",
             "description":"Ask for help at a checkpoint. The host preserves the current patch and test evidence and decides whether a cloud phase is allowed.",
             "parameters":{"type":"object","properties":{"reason":{"type":"string","minLength":1,"maxLength":1024}},"required":["reason"],"additionalProperties":False}}}
        ])
    elif profile != "basic":
        _fail("native_profile")
    return result


def _assistant_action(message, seen: set[str], profile="basic") -> NativeAction:
    if not isinstance(message, dict) or message.get("role") != "assistant":
        _fail("native_assistant_message")
    if message.get("function_call") is not None:
        _fail("native_legacy_function_call")
    if message.get("refusal") is not None:
        _fail("native_refusal")
    content = message.get("content")
    if content is not None:
        content = _text(content, MAX_CONTENT_BYTES, "native_content_type")
    calls = message.get("tool_calls")
    if calls is None or calls == []:
        _fail("native_output_format" if content and content.strip() else "native_output_empty")
    if not isinstance(calls, list) or len(calls) != 1:
        _fail("native_call_count")
    call = calls[0]
    if not isinstance(call, dict) or set(call) != {"id", "type", "function"} or call.get("type") != "function":
        _fail("native_call_type")
    call_id = _call_id(call["id"])
    if call_id in seen:
        _fail("native_call_id_reused")
    function = call["function"]
    if not isinstance(function, dict) or set(function) != {"name", "arguments"}:
        _fail("native_function_schema")
    name = function["name"]
    allowed = ("run_command", "submit_task", "run_visible_checks", "request_help") if profile == "coding" else ("run_command", "submit_task")
    if profile not in ("basic", "coding"):
        _fail("native_profile")
    if name not in allowed:
        _fail("native_function_name")
    arguments, command = _arguments(function["arguments"], name, profile)
    return NativeAction(call_id, name, command, arguments, content)


def parse_response(response, *, seen_call_ids: Collection[str] = (), max_output_tokens: int | None = None, profile="basic") -> NativeAction:
    """Parse known-complete, non-streaming OpenAI Chat Completions JSON only.

    Normalized client envelopes must be mapped explicitly by the caller. This
    function does not infer an HTTP receipt or read reasoning fields. Supply the
    actual request cap to conservatively reject a cap-reaching completion: some
    servers can rewrite a truncated response's finish_reason to tool_calls.
    The supplied seen-ID collection is not mutated, even on successful parsing.
    """
    seen = _seen_ids(seen_call_ids)
    if not isinstance(response, dict):
        _fail("native_response_schema")
    choices = response.get("choices")
    if not isinstance(choices, list) or len(choices) != 1:
        _fail("native_choice_count")
    choice = choices[0]
    if not isinstance(choice, dict):
        _fail("native_response_schema")
    if choice.get("finish_reason") == "length":
        _fail("native_output_truncated")
    if max_output_tokens is not None:
        _output_cap(max_output_tokens)
        usage = response.get("usage")
        tokens = usage.get("completion_tokens") if isinstance(usage, dict) else None
        if type(tokens) is not int or tokens < 0:
            _fail("native_completion_usage_missing")
        if tokens >= max_output_tokens:
            _fail("native_output_at_token_cap")
    # A text-only stop gets a specific format/empty error; a call is accepted
    # only when its finish reason also confirms the native-call protocol.
    action = _assistant_action(choice.get("message"), seen, profile)
    if choice.get("finish_reason") != "tool_calls":
        _fail("native_finish_reason")
    return action


def normalize_history(messages, profile="basic") -> list[dict]:
    """Validate complete call/result pairs before dispatch; strip local extras.

    There must be one leading system message and at least one user message.
    Every accepted assistant call must be followed immediately by its one tool
    result. Repeated IDs, orphan results and unfinished calls stop the request.
    Reasoning metadata/text and mini-SWE's local 'extra' fields are never sent.
    """
    if not isinstance(messages, list) or len(messages) < 2:
        _fail("native_history_schema")
    prepared = []
    seen = set()
    pending = None
    user_seen = False
    submitted = False
    for index, message in enumerate(messages):
        if not isinstance(message, dict):
            _fail("native_history_schema")
        role = message.get("role")
        if index == 0 and role != "system":
            _fail("native_history_system")
        if submitted:
            _fail("native_history_after_submit")
        if pending is not None:
            if role != "tool" or message.get("tool_call_id") != pending.call_id:
                _fail("native_history_tool_result")
            if message.get("tool_calls") is not None or message.get("function_call") is not None:
                _fail("native_history_tool_result")
            content = _text(message.get("content"), MAX_TOOL_RESULT_BYTES, "native_tool_result")
            prepared.append({"role": "tool", "tool_call_id": pending.call_id, "content": content})
            submitted = pending.name == "submit_task"
            pending = None
            continue
        if role in ("system", "user"):
            if role == "system" and index != 0:
                _fail("native_history_system")
            if message.get("tool_calls") is not None or message.get("tool_call_id") is not None or message.get("function_call") is not None:
                _fail("native_history_schema")
            content = _text(message.get("content"), MAX_INPUT_BYTES, "native_history_content", nonblank=True)
            prepared.append({"role": role, "content": content})
            user_seen |= role == "user"
        elif role == "assistant":
            if not user_seen or message.get("tool_call_id") is not None:
                _fail("native_history_schema")
            pending = _assistant_action(message, seen, profile)
            seen.add(pending.call_id)
            prepared.append(pending.assistant_message)
        elif role == "tool":
            _fail("native_history_orphan_tool")
        else:
            _fail("native_history_role")
    if pending is not None:
        _fail("native_history_missing_tool_result")
    if submitted:
        _fail("native_history_after_submit")
    if not user_seen:
        _fail("native_history_schema")
    return prepared


def _output_cap(value):
    if type(value) is not int or not 1 <= value <= MAX_OUTPUT_TOKENS:
        _fail("native_output_limit")


def build_request(model: str, messages: list[dict], *, max_output_tokens: int = 2048,
                  max_input_bytes: int = MAX_INPUT_BYTES, profile="basic", allowed_actions=None,
                  thinking="disabled") -> dict:
    """Build one native call; medium is explicit and disabled remains the default."""
    if not isinstance(thinking, str) or thinking not in ("disabled", "medium"):
        _fail("native_thinking_profile")
    model = _text(model, 256, "native_model", nonblank=True, no_nul=True)
    _output_cap(max_output_tokens)
    if type(max_input_bytes) is not int or not 1 <= max_input_bytes <= MAX_INPUT_BYTES:
        _fail("native_input_limit")
    tools = native_tools(profile)
    if allowed_actions is not None:
        catalog = {tool["function"]["name"] for tool in tools}
        if (not isinstance(allowed_actions, (list, tuple))
                or not allowed_actions or any(not isinstance(name, str) or name not in catalog for name in allowed_actions)
                or len(set(allowed_actions)) != len(allowed_actions)):
            _fail("native_allowed_actions")
        tools = [tool for tool in tools if tool["function"]["name"] in allowed_actions]
    # The mask controls this response only. Earlier calls retain the full
    # catalog's history validation, even when their actions are unavailable now.
    body = {"model": model, "messages": normalize_history(messages, profile),
            "tools": tools, "tool_choice": "auto", "parallel_tool_calls": False,
            "max_tokens": max_output_tokens, "stream": False}
    if thinking == "medium":
        body["reasoning_effort"] = "medium"
    else:
        body["chat_template_kwargs"] = {"enable_thinking": False}
    encoded = json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    if len(encoded) > max_input_bytes:
        _fail("native_input_limit")
    return body


def tool_result_message(action: NativeAction, output: str, returncode: int, *, profile="basic") -> dict:
    """Wrap trusted result text, preserving it verbatim (including JSON flags).

    Callers may serialize the complete trusted environment result as output so
    timeout, truncation and recovery notices survive the native tool roundtrip.
    This function neither executes an action nor grants submission permission.
    """
    if not isinstance(action, NativeAction):
        _fail("native_action")
    checked = _assistant_action(action.assistant_message, set(), profile)
    if checked != action or type(returncode) is not int:
        _fail("native_tool_result")
    output = _text(output, MAX_TOOL_RESULT_BYTES, "native_tool_result")
    content = "Exit code: " + str(returncode) + "\n" + output
    _text(content, MAX_TOOL_RESULT_BYTES, "native_tool_result")
    return {"role": "tool", "tool_call_id": action.call_id, "content": content}
