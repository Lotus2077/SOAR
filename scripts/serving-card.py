#!/usr/bin/env python3
"""Write the serving card (Markdown) from a probe JSON written by scripts/serving-probe.py (probe_version 2).

    python3 scripts/serving-card.py --input .soar/experiments/serving-probe-<ts>/probe.json \
        [--compare-root Qwen3.8-Flash-Next-NVFP4 --compare-version <vllm version> --compare-context 262144] \
        [--policy-out docs/experiments/serving-card-<date>.json] > docs/experiments/serving-card-<date>.md

Prints Markdown to stdout for the operator to review before committing it. The card holds the Source paragraph, the
Identity table (alias, engine version, context, model root basename, authentication, transport class only), optional
"consistent with the 2026-11-04 qualification" rows (consistency, never identical weights), the Behaviour table per probe
including P10, P11 and the adapter probe, and a derived-bounds table (per role: output cap against the app's 300 s and
900 s request clocks) marked as proposals for the E0 card. It refuses, with exit 2 and no output, a probe JSON that is not
version 2, any string that looks like a URL, an IP address, a host:port or the configured endpoint's host, and a served
alias or engine version that looks like a file path (serve the model under --served-model-name), and it never copies
error detail fields. The output is deterministic for a given input.

With --policy-out the writer also writes the machine-readable card (kind soar_serving_card, version 1) from the same probe
result, after running the same address refusal over it: the identity, the probe's sha256 and probe names, the role policy
research code may read, the concurrency K, the admission basis and the evidence behind them, never an address, a path, a
key or reply text. Its decision is always {status: proposed, entry: null}. It proposes today's caps and thinking on both
attempts, K 1 and admission none, and structured output for a role and thinking mode only from a P10 cell that was assessed
under the protocol the export sent, ran the requested variant, has no unassessed reply, at least 20 calls and at least 95%
valid. An existing file is refused, and nothing is printed or left behind on any refusal. One card is one probe run: run
P1, P10, P11 and the adapter probe in one serving-probe.py invocation, after `pnpm probe:export-schemas` and before
`pnpm probe:assess`. Adoption is a reviewed commit that sets decision to {status: adopted, entry: <the BL entry that records
E0's result>}; the reader (src/main/private-agent/serving-card.ts) reads only adopted cards, selected by the pair
SOAR_SERVING_CARD_FILE and SOAR_SERVING_CARD_SHA256 in the ignored .env.local.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import math
import os
import re
import sys
import urllib.parse
from typing import Any, Dict, Iterator, List, Optional, Sequence, Tuple

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROBE_ORDER = ("P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11", "adapter")
P10_RULE_PERCENT = 95
# The machine-readable card's 95% rule also needs this many assessed calls (P10_RULE in serving-card.ts).
P10_MIN_CALLS = 20
CARD_KIND = "soar_serving_card"
CARD_VERSION = 1
CARD_ROLES = ("index", "plan", "extract", "synthesis")
SCHEMA_ROLES = ("plan", "extract", "synthesis")
P10_CELL_KEYS = tuple(f"{role}/{mode}" for role in SCHEMA_ROLES for mode in ("on", "off"))
# Probe class name and card field, in the card's order; the counts must sum to the cell's total.
P10_CLASS_FIELDS = (("valid", "valid"), ("truncated", "truncated"), ("invalid_json", "invalidJson"), ("schema_invalid", "schemaInvalid"),
                    ("binding_invalid", "bindingInvalid"), ("request_rejected", "requestRejected"), ("unassessed", "unassessed"))
# Record bounds of ServingCardV1 (the reader refuses a larger card).
CARD_MAX_SIZES = 16
CARD_MAX_K_STREAMS = 16
CARD_MAX_K = 999
CARD_MAX_LAYOUTS = 8
CARD_MAX_LAYOUT_REQUESTS = 8
CARD_MAX_CHUNKS = 8
CARD_MAX_BYTES = 64 * 1024
MAX_SAFE_INTEGER = 2 ** 53 - 1
# The app's two request clocks (profiles.ts: standard 300 s, heavy 900 s); the research stages run under the heavy profile.
STAGE_CLOCKS_S = (300, 900)
# Prompt size assumed per role for the derived bounds, matched to the P11 sizes: an index batch is at most 20 KiB, a plan
# reads the whole index, an extraction reads one 64 KiB chunk with its packet, a synthesis reads the packet and coverage.
ROLE_PROMPT_SIZES = {"index": 20_000, "plan": 60_000, "extract": 20_000, "synthesis": 60_000}
QUALIFICATION_DATE = "2026-11-04"

URL_RE = re.compile(r"[a-z][a-z0-9+.-]*://", re.IGNORECASE)
IPV4_RE = re.compile(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])")
IPV6_FULL_RE = re.compile(r"(?<![0-9a-z:])(?:[0-9a-f]{1,4}:){5,7}[0-9a-f]{1,4}(?![0-9a-z:])", re.IGNORECASE)
IPV6_COMPRESSED_RE = re.compile(r"(?<![0-9a-z])(?:[0-9a-f]{1,4}:)*[0-9a-f]{0,4}::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?(?![0-9a-z])", re.IGNORECASE)
TIMESTAMP_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?")
HOST_PORT_RE = re.compile(r"(?<![\w.:-])(?=[a-z0-9.-]*[a-z])[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?:\d{2,5}(?!\w)", re.IGNORECASE)
DRIVE_RE = re.compile(r"[A-Za-z]:")
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
SHA256_RE = re.compile(r"[0-9a-f]{64}")
CARD_DATE_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
SIZE_KEY_RE = re.compile(r"[1-9][0-9]{0,6}")
DIGITS_RE = re.compile(r"[0-9]+")
K_KEY_RE = re.compile(r"[1-9][0-9]{0,2}")
LAYOUT_NAME_RE = re.compile(r"[a-z_]{1,32}")


class Refusal(Exception):
    """The card is not written; the message names a JSON path, never the offending string."""


# --- redaction gate ------------------------------------------------------------------------------------------------


def looks_like_address(text: str, forbidden_hosts: Sequence[str] = ()) -> bool:
    lowered = text.lower()
    if any(host and host in lowered for host in forbidden_hosts):
        return True
    if URL_RE.search(text) or IPV4_RE.search(text) or IPV6_FULL_RE.search(text):
        return True
    for match in IPV6_COMPRESSED_RE.finditer(text):
        if re.search(r"[0-9a-f]", match.group(0), re.IGNORECASE):
            return True
    return HOST_PORT_RE.search(TIMESTAMP_RE.sub(" ", text)) is not None


def walk_strings(value: Any, path: str = "$", forbidden_hosts: Sequence[str] = ()) -> Iterator[Tuple[str, str]]:
    """Every string, keys included, with a JSON path; a key that is itself address-like is never echoed in a path."""
    if isinstance(value, str):
        yield path, value
    elif isinstance(value, dict):
        for key, item in value.items():
            name = str(key)
            segment = "<redacted-key>" if looks_like_address(name, forbidden_hosts) else name
            yield f"{path}.{segment}", name
            yield from walk_strings(item, f"{path}.{segment}", forbidden_hosts)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from walk_strings(item, f"{path}[{index}]", forbidden_hosts)


def configured_hosts(environ: Dict[str, str], env_file: Optional[str]) -> List[str]:
    """The configured endpoint's host (and host:port), so the card can never carry it even if the patterns miss."""
    values = dict(environ)
    if env_file and os.path.exists(env_file):
        with open(env_file, encoding="utf-8") as handle:
            for line in handle:
                match = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
                if match:
                    values.setdefault(match.group(1), match.group(2).strip().strip('"').strip("'"))
    base = values.get("SOAR_VLLM_BASE_URL") or ""
    if not base:
        return []
    parts = urllib.parse.urlsplit(base)
    hosts = [host.lower() for host in (parts.hostname or "", parts.netloc or "") if host]
    return sorted(set(hosts))


def refuse_addresses(probe: Dict[str, Any], forbidden_hosts: Sequence[str]) -> None:
    for path, text in walk_strings(probe, "$", forbidden_hosts):
        if looks_like_address(text, forbidden_hosts):
            raise Refusal(f"refused: an address-like string at {path}; the card was not written")


def looks_like_path(text: str) -> bool:
    """A leading /, ~ or ., a backslash, a .. segment or a drive letter: vLLM serves its --model argument as the alias
    unless --served-model-name is set, and that argument is often a machine path. A hub id such as org/name passes."""
    return text.startswith(("/", "~", ".")) or "\\" in text or ".." in text.split("/") or DRIVE_RE.match(text) is not None


def refuse_path_like_identity(probe: Dict[str, Any]) -> None:
    """Both outputs: every served alias and the engine version, named by JSON path, never by value."""
    p1 = probe.get("P1")
    if not isinstance(p1, dict):
        return
    models = p1.get("models")
    candidates = [(f"$.P1.models[{index}].id", model.get("id")) for index, model in enumerate(models) if isinstance(model, dict)] if isinstance(models, list) else []
    candidates.append(("$.P1.version", p1.get("version")))
    for path, value in candidates:
        if isinstance(value, str) and looks_like_path(value):
            raise Refusal(f"refused: a file-path-like served alias or engine version at {path}; serve the model under --served-model-name "
                          "and probe again; the card was not written")


# --- formatting helpers ----------------------------------------------------------------------------------------------


def fmt(value: Any, digits: int = 2, unit: str = "") -> str:
    if value is None:
        return "n/a"
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, int):
        return f"{value:,}{unit}"
    if isinstance(value, float):
        return f"{value:,.{digits}f}{unit}"
    return f"{value}{unit}"


def num(value: Any, digits: int = 2) -> str:
    """A measurement with a fixed number of decimals (ints and floats alike); None is n/a."""
    if value is None:
        return "n/a"
    try:
        return f"{float(value):,.{digits}f}"
    except (TypeError, ValueError):
        return str(value)


def code(value: Any) -> str:
    return f"`{value}`" if value not in (None, "") else "n/a"


def percent(part: Optional[int], total: Optional[int]) -> str:
    if not total or part is None:
        return "n/a"
    return f"{100.0 * part / total:.0f}%"


def stream_summary(result: Optional[Dict[str, Any]], with_reasoning: bool = False) -> str:
    if not isinstance(result, dict):
        return "n/a"
    if "error" in result:
        return f"error {fmt(result.get('error'))}"
    if "aborted_after_s" in result:
        return f"aborted after {fmt(result['aborted_after_s'], 1)} s"
    parts = [f"prompt {fmt(result.get('prompt_tokens'))}", f"completion {fmt(result.get('completion_tokens'))}"]
    if with_reasoning:
        parts.append(f"reasoning {fmt(result.get('reasoning_tokens'))}")
    parts.append(f"first token {num(result.get('ttft_s'), 2)} s")
    if result.get("prefill_tok_s_est") is not None:
        parts.append(f"prefill about {num(result.get('prefill_tok_s_est'), 0)} tok/s")
    parts.append(f"decode {num(result.get('decode_tok_s'), 1)} tok/s")
    if result.get("finish_reason"):
        parts.append(f"finish {result['finish_reason']}")
    return ", ".join(parts)


def post_summary(result: Optional[Dict[str, Any]]) -> str:
    if not isinstance(result, dict):
        return "n/a"
    parts = [f"status {fmt(result.get('status'))}"]
    if result.get("transport_error"):
        parts.append(f"transport error {result['transport_error']}")
    if result.get("elapsed_s") is not None:
        parts.append(f"{num(result['elapsed_s'], 1)} s")
    return ", ".join(parts)


# --- rows -----------------------------------------------------------------------------------------------------------


def row_p2(p2: Dict[str, Any]) -> List[Tuple[str, str]]:
    cells = []
    for label, result in p2.items():
        cells.append(f"{label}: {stream_summary(result, with_reasoning=True)}")
    return [("**P2** thinking effort", "; ".join(cells) or "n/a")]


def row_p3(p3: Dict[str, Any]) -> List[Tuple[str, str]]:
    return [("**P3** decode, single stream", f"prose without thinking: {stream_summary(p3.get('prose_no_think'))}; code without thinking: {stream_summary(p3.get('code_no_think'))}"),
            ("**P3** long context", stream_summary(p3.get("long_context_no_think")))]


def row_p4(p4: Dict[str, Any]) -> List[Tuple[str, str]]:
    repeat = p4.get("repeat_same_long_prompt") or {}
    return [("**P4** prefix cache", f"repeating the same long prompt reused {fmt(repeat.get('cached_tokens'))} cached tokens, first token {num(repeat.get('ttft_s'), 2)} s" if "error" not in repeat else stream_summary(repeat))]


def row_p5(p5: Dict[str, Any]) -> List[Tuple[str, str]]:
    return [("**P5** tool-call integrity", f"{post_summary(p5)}; payload {fmt(p5.get('payload_bytes'))} bytes; tool calls {fmt(p5.get('tool_calls'))}; "
             f"arguments parsed {fmt(p5.get('args_parse'))}; content byte-exact {fmt(p5.get('content_exact'))}; length ratio {fmt(p5.get('content_len_ratio'), 4)}")]


def row_p6(p6: Dict[str, Any]) -> List[Tuple[str, str]]:
    samples = [s for s in (p6.get("running_after_abort_1s_steps") or []) if s is not None]
    after = p6.get("next_request") or {}
    return [("**P6** abort", f"running before {fmt(p6.get('running_before'))}; {stream_summary(p6.get('abort'))}; running after the abort (1 s steps) max {fmt(max(samples) if samples else None)}; "
             f"next request first token {num(after.get('ttft_s'), 2)} s")]


def row_p7(p7: Dict[str, Any]) -> List[Tuple[str, str]]:
    concurrent = p7.get("concurrent") or {}
    decodes = ", ".join(num((r or {}).get("decode_tok_s"), 1) for r in concurrent.values())
    return [("**P7** concurrency", f"single stream decode {num((p7.get('single') or {}).get('decode_tok_s'), 1)} tok/s; two concurrent streams {decodes or 'n/a'} tok/s")]


def row_p8(p8: Dict[str, Any]) -> List[Tuple[str, str]]:
    return [("**P8** long non-streaming request", f"{post_summary(p8)}; completion tokens {fmt(p8.get('completion_tokens'))}")]


def row_p9(p9: Dict[str, Any]) -> List[Tuple[str, str]]:
    return [("**P9** context guard", f"max_tokens {fmt(p9.get('requested_max_tokens'))} requested: {post_summary(p9)}; rejected with 400 {fmt(p9.get('rejected'))}")]


def row_p10(p10: Dict[str, Any]) -> List[Tuple[str, str]]:
    rows: List[Tuple[str, str]] = []
    acceptance = p10.get("acceptance") or {}
    for role, variants in acceptance.items():
        parts = []
        for name in ("strict", "non_strict"):
            variant = variants.get(name) or {}
            parts.append(f"{name.replace('_', '-')}: {'accepted' if variant.get('accepted') else 'rejected'} (status {fmt(variant.get('status'))})")
        rows.append((f"**P10** `response_format` acceptance, {role}", "; ".join(parts)))
    assessed = p10.get("assessed")
    for key, cell in (p10.get("cells") or {}).items():
        counts = cell.get("counts") or {}
        total = counts.get("total") or 0
        valid = counts.get("valid") or 0
        unassessed = counts.get("unassessed") or 0
        variant = "strict" if cell.get("strict") else "non-strict"
        text = (f"valid {valid}/{total} ({percent(valid, total)}); truncated {fmt(counts.get('truncated'))}; schema invalid {fmt(counts.get('schema_invalid'))}; "
                f"binding invalid {fmt(counts.get('binding_invalid'))}; invalid JSON {fmt(counts.get('invalid_json'))}; request rejected {fmt(counts.get('request_rejected'))}; "
                f"variant {variant}; max_tokens {fmt(cell.get('max_tokens'))}; median {num(counts.get('median_elapsed_s'), 1)} s, max {num(counts.get('max_elapsed_s'), 1)} s")
        if cell.get("thinking") == "on":
            text += f"; thinking-on replies with zero reasoning tokens {fmt(counts.get('thinking_on_zero_reasoning'))}"
        if unassessed or not assessed:
            text += f"; {unassessed} replies not yet assessed (`pnpm probe:assess`), so the {P10_RULE_PERCENT}% rule is not evaluated"
        else:
            meets = total > 0 and 100.0 * valid / total >= P10_RULE_PERCENT
            text += f"; against the {P10_RULE_PERCENT}% rule ({variant} variant): {'meets' if meets else 'does not meet'}"
        rows.append((f"**P10** structured output, {key}", text))
    return rows or [("**P10** structured output", "no cells recorded")]


def row_p11(p11: Dict[str, Any]) -> List[Tuple[str, str]]:
    rows: List[Tuple[str, str]] = []
    sizes = p11.get("sizes") or {}
    parts = []
    for size, result in sizes.items():
        parts.append(f"{fmt(int(size))} target ({fmt(result.get('prompt_tokens'))} observed): {stream_summary(result)}")
    for refused in p11.get("sizes_refused") or []:
        parts.append(f"{fmt(refused.get('target_tokens'))} refused: {refused.get('reason')}")
    rows.append(("**P11** prefill and decode by prompt size", "; ".join(parts) or "n/a"))
    layouts = ((p11.get("cache_layouts") or {}).get("layouts")) or {}
    cache_parts = []
    for name, layout in layouts.items():
        requests = layout.get("requests") or []
        second = requests[-1] if requests else {}
        cache_parts.append(f"{name}: second request reused {fmt(layout.get('second_request_cached_tokens'))} of {fmt(second.get('prompt_tokens'))} prompt tokens, "
                           f"first token {num(second.get('ttft_s'), 2)} s; cache_salt accepted {fmt(layout.get('cache_salt_accepted'))}")
    rows.append(("**P11** cache reuse per extraction layout", "; ".join(cache_parts) or "n/a"))
    k_parts = []
    for k, result in (p11.get("k_streams") or {}).items():
        k_parts.append(f"K={k}: aggregate {num(result.get('aggregate_tok_s'), 1)} tok/s, median per stream {num(result.get('median_decode_tok_s'), 1)} tok/s, "
                       f"max first token {num(result.get('max_ttft_s'), 2)} s, errors {fmt(result.get('errors'))}, running max during the burst {fmt(result.get('running_max'))}")
    rows.append(("**P11** K concurrent streams", "; ".join(k_parts) or "n/a"))
    return rows


def row_adapter(adapter: Dict[str, Any]) -> List[Tuple[str, str]]:
    openapi = adapter.get("openapi") or {}
    fields = openapi.get("chat_request_fields") or {}
    tokenize = adapter.get("tokenize") or {}
    on_json, on_sse = adapter.get("thinking_on_json") or {}, adapter.get("thinking_on_sse") or {}
    off_json, off_sse = adapter.get("thinking_off_json") or {}, adapter.get("thinking_off_sse") or {}
    verdict = adapter.get("verdict") or {}
    rows = [("**Adapter** `/openapi.json`", f"status {fmt(openapi.get('status'))}; served version {code(openapi.get('version'))}; `/tokenize` route {fmt(openapi.get('tokenize_route'))}; "
             + "; ".join(f"`{name}` in ChatCompletionRequest {fmt(present)}" for name, present in fields.items())),
            ("**Adapter** `/tokenize` parity", f"status {fmt(tokenize.get('status'))}; count {fmt(tokenize.get('count'))} against usage.prompt_tokens {fmt(tokenize.get('usage_prompt_tokens'))}: parity {fmt(tokenize.get('parity'))}"),
            ("**Adapter** reasoning field (thinking on)", f"JSON: {code(on_json.get('reasoning_field'))}, {fmt(on_json.get('reasoning_tokens'))} reasoning tokens, model in reply {fmt(on_json.get('model_matches'))}; "
             f"SSE: {code(on_sse.get('reasoning_field'))}, model in {fmt(on_sse.get('model_chunks'))} chunks ({fmt(on_sse.get('model_mismatch_chunks'))} mismatched); "
             f"leading `<think>` tag {fmt(bool(on_json.get('leading_think_tag') or on_sse.get('leading_think_tag')))}"),
            ("**Adapter** thinking off", f"reasoning bytes leaked JSON {fmt(off_json.get('reasoning_bytes'))}, SSE {fmt(off_sse.get('reasoning_bytes'))}; leading `<think>` tag {fmt(bool(off_json.get('leading_think_tag') or off_sse.get('leading_think_tag')))}; "
             f"`preserve_thinking` accepted {fmt((adapter.get('preserve_thinking') or {}).get('accepted'))}; `cache_salt` accepted {fmt((adapter.get('cache_salt') or {}).get('accepted'))}"),
            ("**Adapter** reply contract", f"consistent with the legacy shape: {fmt(verdict.get('legacy_consistent'))}; consistent with `flash_next_v1`: {fmt(verdict.get('flash_next_v1_consistent'))} "
             "(consistency of a few synthetic replies; the contract itself is not established by this probe)")]
    return rows


ROW_BUILDERS = {"P2": row_p2, "P3": row_p3, "P4": row_p4, "P5": row_p5, "P6": row_p6, "P7": row_p7, "P8": row_p8, "P9": row_p9, "P10": row_p10, "P11": row_p11, "adapter": row_adapter}


# --- sections -------------------------------------------------------------------------------------------------------


def probe_state(probe: Dict[str, Any], name: str) -> str:
    if name in (probe.get("probes_run") or []):
        return "run"
    if name in (probe.get("probes_failed") or {}):
        return "failed"
    if name in (probe.get("probes_skipped") or []):
        return "skipped"
    return "absent"


def identity_rows(probe: Dict[str, Any], compare: Dict[str, Any]) -> List[Tuple[str, str]]:
    p1 = probe.get("P1") or {}
    models = p1.get("models") or []
    first = models[0] if models else {}
    version = p1.get("version")
    rows: List[Tuple[str, str]] = []
    state = probe_state(probe, "P1")
    if state != "run":
        rows.append(("Identity probe", f"P1 {state}: identity not observed in this run"))
    rows.append(("Engine", f"vLLM {version}" if version else f"version not read (status {fmt(p1.get('version_status'))})"))
    rows.append(("Served alias", code(first.get("id")) if first.get("id") else "not read"))
    rows.append(("Model root (basename)", code(first.get("root_basename")) if first.get("root_basename") else "not reported"))
    rows.append(("Context limit", f"{fmt(first.get('max_model_len'))} tokens" if first.get("max_model_len") else "not reported"))
    if p1.get("auth_required"):
        auth = f"required (`/v1/models` answered {fmt(p1.get('models_status'))} without a key)"
    elif probe.get("api_key_configured"):
        auth = "a configured key was sent and accepted; whether the server requires one was not tested"
    elif p1.get("models_status") == 200:
        auth = "none required: `/v1/models` answered without a key"
    else:
        auth = f"not determined (`/v1/models` status {fmt(p1.get('models_status'))})"
    rows.append(("Authentication", auth))
    transport = {"loopback": "loopback (a local forward or the same host); the remote hop, if any, is outside this probe",
                 "plain_http": "plain HTTP to a non-loopback address (operator-acknowledged)", "https": "HTTPS to a non-loopback address"}
    rows.append(("Transport", transport.get(probe.get("transport_class"), "not recorded")))
    acceptance = probe.get("spec_decode_acceptance_during_probe")
    rows.append(("Speculative decoding", f"active: {num(100 * acceptance, 0)}% of drafted tokens accepted during the probe" if isinstance(acceptance, (int, float))
                 else "no draft-token counters changed during the probe (not observed)"))
    before, after = probe.get("load_before") or {}, probe.get("load_after") or {}
    rows.append(("Server load (other requests)", f"running/waiting before {fmt(before.get('running'))}/{fmt(before.get('waiting'))}, after {fmt(after.get('running'))}/{fmt(after.get('waiting'))}"))
    for label, observed, expected in (("model root", first.get("root_basename"), compare.get("root")), ("engine version", version, compare.get("version")),
                                      ("context", first.get("max_model_len"), compare.get("context"))):
        if expected is None:
            continue
        if observed is None:
            verdict = "not observed"
        else:
            verdict = f"yes ({code(observed)})" if str(observed) == str(expected) else f"no ({code(observed)} against {code(expected)})"
        rows.append((f"Consistent with the {QUALIFICATION_DATE} qualification: {label}", verdict))
    return rows


def behaviour_rows(probe: Dict[str, Any]) -> List[Tuple[str, str]]:
    rows: List[Tuple[str, str]] = []
    for name in PROBE_ORDER[1:]:
        state = probe_state(probe, name)
        label = f"**{name}**" if name != "adapter" else "**Adapter**"
        if state == "run":
            try:
                rows.extend(ROW_BUILDERS[name](probe.get(name) or {}))
            except (TypeError, ValueError, AttributeError, KeyError):
                rows.append((label, "recorded, but the result could not be summarised; see the probe JSON"))
        elif state == "failed":
            rows.append((label, f"failed before recording a result (`{(probe.get('probes_failed') or {}).get(name)}`)"))
        elif state == "skipped":
            rows.append((label, "not run (skipped by the operator)"))
        else:
            rows.append((label, "not run"))
    return rows


def stage_ceiling(clock_s: float, prefill_s: float, decode_tok_s: float) -> int:
    """Output tokens that fit in a request clock after the prefill; zero or negative when the prefill alone exceeds it."""
    return int(math.floor((clock_s - prefill_s) * decode_tok_s))


def bounds_rows(probe: Dict[str, Any]) -> Tuple[List[str], List[List[str]]]:
    roles = probe.get("roles") or {}
    caps = roles.get("output_tokens") or {}
    sizes = ((probe.get("P11") or {}).get("sizes")) or {}
    header = ["Role", "Output cap (tokens)", "Prompt size assumed (tokens)", "Prefill at that size (s)", "Decode (tok/s, thinking off)"]
    for clock in STAGE_CLOCKS_S:
        header.append(f"Ceiling under the {clock} s clock (tokens)")
    rows: List[List[str]] = []
    for role, size in ROLE_PROMPT_SIZES.items():
        cap = caps.get(role)
        measured = sizes.get(str(size)) or {}
        prefill, decode = measured.get("ttft_s"), measured.get("decode_tok_s")
        row = [role, fmt(cap), fmt(size), num(prefill, 1), num(decode, 1)]
        for clock in STAGE_CLOCKS_S:
            if prefill is None or decode is None:
                row.append("n/a (P11 size not measured)")
            else:
                ceiling = stage_ceiling(clock, prefill, decode)
                verdict = "n/a" if cap is None else ("within the cap" if ceiling >= cap else "below the cap")
                row.append(f"{fmt(ceiling)} ({verdict})")
        rows.append(row)
    return header, rows


def table(header: Sequence[str], rows: Sequence[Sequence[str]]) -> str:
    lines = ["| " + " | ".join(header) + " |", "| " + " | ".join("---" for _ in header) + " |"]
    for row in rows:
        lines.append("| " + " | ".join(str(cell).replace("|", "\\|").replace("\n", " ") for cell in row) + " |")
    return "\n".join(lines)


def render_card(probe: Dict[str, Any], compare: Dict[str, Any], date: Optional[str] = None) -> str:
    started = str(probe.get("started_utc") or "")
    day = date or (started[:10] if started else "unknown date")
    run_list = ", ".join(probe.get("probes_run") or []) or "none"
    skipped = ", ".join(probe.get("probes_skipped") or []) or "none"
    failed = ", ".join(f"{name} (`{error}`)" for name, error in (probe.get("probes_failed") or {}).items()) or "none"
    parts = [f"# Serving card: owner's inference endpoint, {day}", "",
             f"**Source:** `scripts/serving-probe.py` (probe version {probe.get('probe_version')}), run from the Mac on {day} (UTC), written by "
             f"`scripts/serving-card.py`. Probes run: {run_list}. Skipped: {skipped}. Failed before recording a result: {failed}. All prompts were synthetic, "
             "and the API fee was zero. The endpoint address and any credentials stay in ignored local configuration. The full JSON result and the retained "
             "replies are under the ignored `.soar/experiments/`.", "",
             "These are one-shot measurements on a server whose other load is recorded in the Identity table (running and waiting requests before and after "
             "the probe) and per K burst in P11. Treat them as orders of magnitude, not benchmarks.", "",
             "## Identity (P1)", "", table(["Item", "Observed"], identity_rows(probe, compare))]
    if any(value is not None for value in compare.values()):
        parts += ["", f"Consistency with the {QUALIFICATION_DATE} qualification means the observed value equals the qualified one. It shows a difference or its "
                  "absence and cannot prove identical weights (review section 5.10, item 1); the owner's confirmation stays required."]
    parts += ["", "## Behaviour", "", table(["Probe", "Result"], behaviour_rows(probe)), "",
              "## Stage bounds derived from this card (proposals for the E0 card)", ""]
    if probe.get("roles") and (probe.get("P11") or {}).get("sizes"):
        header, rows = bounds_rows(probe)
        parts += [table(header, rows), "",
                  "Ceiling = (clock - prefill at the assumed prompt size) x thinking-off decode, with the app's two request clocks (300 s standard, 900 s heavy). "
                  "Thinking-on replies also spend reasoning tokens (P2, P10), so a thinking-on role needs its reasoning budget under the same ceiling. "
                  "Output caps come from the role export that the probe read; every bound here is a proposal for the E0 card, not a decision."]
    else:
        parts += ["Not derived: the table needs the role export (`pnpm probe:export-schemas` before the probe) and the P11 size measurements."]
    parts += ["", "## Consequences for the plan", "", "_Left to the author: write the consequences after reviewing the tables above._", ""]
    return "\n".join(parts)


# --- the machine-readable card (--policy-out; ServingCardV1 in src/main/private-agent/serving-card.ts) -------------------
# Pure functions: no I/O, so a test can import them the way the probe helpers are imported.


def malformed(path: str) -> Refusal:
    """A probe record the card cannot represent; the path is a fixed JSON path, never a probe key or value."""
    return Refusal(f"refused: the probe record at {path} does not have the shape the machine-readable card needs; the card was not written")


def is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def is_count(value: Any) -> bool:
    return is_int(value) and 0 <= value <= MAX_SAFE_INTEGER


def is_positive(value: Any) -> bool:
    return is_int(value) and 0 < value <= MAX_SAFE_INTEGER


def is_sha256(value: Any) -> bool:
    return isinstance(value, str) and SHA256_RE.fullmatch(value) is not None


def opt_count(value: Any) -> Optional[int]:
    return value if is_count(value) else None


def opt_number(value: Any) -> Optional[float]:
    """A non-negative finite measurement, or None when the probe lacks one."""
    if is_int(value):
        return value if 0 <= value <= MAX_SAFE_INTEGER else None
    if isinstance(value, float) and math.isfinite(value) and value >= 0:
        return value
    return None


def utf16_length(text: str) -> int:
    """The reader measures strings in UTF-16 code units, as zod does."""
    return sum(2 if ord(character) > 0xFFFF else 1 for character in text)


def identity_text(value: Any, limit: int) -> bool:
    return isinstance(value, str) and 0 < utf16_length(value) <= limit and CONTROL_RE.search(value) is None and not looks_like_path(value)


def card_identity(probe: Dict[str, Any]) -> Dict[str, Any]:
    """The served alias, engine version, context and model root basename from P1: exactly one served model, never a path."""
    if probe_state(probe, "P1") != "run":
        raise Refusal("refused: the machine-readable card needs probe P1 (the served alias) from the same probe run; the card was not written")
    p1 = probe.get("P1")
    models = p1.get("models") if isinstance(p1, dict) else None
    if not isinstance(models, list) or len(models) != 1 or not isinstance(models[0], dict):
        raise Refusal("refused: the machine-readable card needs exactly one served model at $.P1.models; the card was not written")
    model = models[0]
    if not identity_text(model.get("id"), 256):
        raise Refusal("refused: the served alias at $.P1.models[0].id is empty, longer than 256 characters or has a control character; the card was not written")
    version = p1.get("version")
    if version == "":
        version = None
    if version is not None and not identity_text(version, 128):
        raise Refusal("refused: the engine version at $.P1.version is longer than 128 characters or has a control character; the card was not written")
    root = model.get("root_basename")
    if root == "":
        root = None
    if root is not None and not (isinstance(root, str) and 0 < utf16_length(root) <= 256 and CONTROL_RE.search(root) is None
                                 and "/" not in root and "\\" not in root):
        raise Refusal("refused: the model root basename at $.P1.models[0].root_basename is not a plain file name; the card was not written")
    context = model.get("max_model_len")
    return {"servedModel": model["id"], "engineVersion": version, "contextTokens": context if is_positive(context) else None, "modelRootBasename": root}


def card_date(date: Optional[str], probe: Dict[str, Any]) -> str:
    day = date if date is not None else str(probe.get("started_utc") or "")[:10]
    try:
        valid = CARD_DATE_RE.fullmatch(day) is not None and datetime.date.fromisoformat(day).isoformat() == day
    except ValueError:
        valid = False
    if not valid:
        raise Refusal("refused: the machine-readable card needs a valid YYYY-MM-DD date (--date, else the probe's start date); the card was not written")
    return day


def probe_names(names: Any, path: str) -> List[str]:
    if not isinstance(names, list) or len(names) > len(PROBE_ORDER) or not all(isinstance(name, str) and name in PROBE_ORDER for name in names) \
            or len(set(names)) != len(names):
        raise malformed(path)
    return list(names)


def p10_cell_evidence(cell: Any, path: str = "$.P10.cells") -> Dict[str, Any]:
    """One P10 cell: the variant it ran, its max_tokens, the class counts recounted from its calls, and the mean completion and
    reasoning tokens of settled replies (the probe records medians only)."""
    if not isinstance(cell, dict) or not isinstance(cell.get("calls"), list) or not is_positive(cell.get("max_tokens")):
        raise malformed(path)
    counts = {name: 0 for name, _ in P10_CLASS_FIELDS}
    completion: List[int] = []
    reasoning: List[int] = []
    for call in cell["calls"]:
        if not isinstance(call, dict):
            raise malformed(path)
        classification = call.get("classification", "unassessed")
        if not isinstance(classification, str) or classification not in counts:
            raise malformed(path)
        counts[classification] += 1
        if call.get("status") == 200:
            if is_count(call.get("completion_tokens")):
                completion.append(call["completion_tokens"])
            if is_count(call.get("reasoning_tokens")):
                reasoning.append(call["reasoning_tokens"])
    evidence: Dict[str, Any] = {"variant": "strict" if cell.get("strict") else "non_strict", "maxTokens": cell["max_tokens"], "total": len(cell["calls"])}
    for name, field in P10_CLASS_FIELDS:
        evidence[field] = counts[name]
    evidence["meanCompletionTokens"] = round(sum(completion) / len(completion), 1) if completion else None
    evidence["meanReasoningTokens"] = round(sum(reasoning) / len(reasoning), 1) if reasoning else None
    return evidence


def p10_cell_meets_rule(cell: Dict[str, Any], assessed: Optional[Dict[str, Any]], requested_variant: str) -> bool:
    """The 95% rule as the reader applies it: assessed under the protocol the export sent, the requested variant, no
    unassessed reply, at least P10_MIN_CALLS calls and at least P10_RULE_PERCENT valid."""
    return (isinstance(assessed, dict) and assessed.get("schemasProtocolMatch") is True and cell["unassessed"] == 0
            and cell["variant"] == requested_variant and cell["total"] >= P10_MIN_CALLS and cell["valid"] * 100 >= P10_RULE_PERCENT * cell["total"])


def p10_evidence(probe: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if probe_state(probe, "P10") != "run":
        return None
    p10 = probe.get("P10")
    if not isinstance(p10, dict):
        raise malformed("$.P10")
    if not is_positive(p10.get("calls_per_cell")):
        raise malformed("$.P10.calls_per_cell")
    if not isinstance(p10.get("strict_requested"), bool):
        raise malformed("$.P10.strict_requested")
    protocol = p10.get("schemas_protocol_sha256")
    if protocol is not None and not is_sha256(protocol):
        raise malformed("$.P10.schemas_protocol_sha256")
    digests = p10.get("schema_sha256")
    if not isinstance(digests, dict) or sorted(digests) != sorted(SCHEMA_ROLES) or not all(is_sha256(digests[role]) for role in SCHEMA_ROLES):
        raise malformed("$.P10.schema_sha256")
    assessed = p10.get("assessed")
    if assessed is not None:
        if not isinstance(assessed, dict) or not is_sha256(assessed.get("protocolSha256")) or not isinstance(assessed.get("schemasProtocolMatch"), bool):
            raise malformed("$.P10.assessed")
        if assessed["schemasProtocolMatch"] != (protocol is not None and assessed["protocolSha256"] == protocol):
            raise Refusal("refused: $.P10.assessed.schemasProtocolMatch disagrees with the export's and the assessor's protocol hashes; the card was not written")
        assessed = {"protocolSha256": assessed["protocolSha256"], "schemasProtocolMatch": assessed["schemasProtocolMatch"]}
    acceptance_in = p10.get("acceptance") or {}
    if not isinstance(acceptance_in, dict) or not all(role in SCHEMA_ROLES and isinstance(variants, dict) for role, variants in acceptance_in.items()):
        raise malformed("$.P10.acceptance")

    def accepted(variant: Any) -> bool:
        return isinstance(variant, dict) and variant.get("accepted") is True

    acceptance = {role: {"strict": accepted(acceptance_in[role].get("strict")), "nonStrict": accepted(acceptance_in[role].get("non_strict"))}
                  for role in SCHEMA_ROLES if role in acceptance_in}
    cells_in = p10.get("cells") or {}
    if not isinstance(cells_in, dict) or not all(key in P10_CELL_KEYS for key in cells_in):
        raise malformed("$.P10.cells")
    cells = {key: p10_cell_evidence(cells_in[key], f"$.P10.cells.{key}") for key in P10_CELL_KEYS if key in cells_in}
    return {"callsPerCell": p10["calls_per_cell"], "strictRequested": p10["strict_requested"], "protocolSha256": protocol,
            "schemaSha256": {role: digests[role] for role in SCHEMA_ROLES}, "assessed": assessed, "acceptance": acceptance, "cells": cells}


def beyond_bounds() -> Refusal:
    return Refusal("refused: the probe has more P11 sizes, K values or layouts than the card holds; the card was not written")


def bounded_keys(record: Any, path: str, pattern: Any, limit: int, maximum: Optional[int] = None) -> List[str]:
    """The keys of a probe record in the card's order (numeric keys ascending), refused past the card's bounds."""
    if not isinstance(record, dict) or not all(isinstance(key, str) for key in record):
        raise malformed(path)
    if len(record) > limit or (maximum is not None and any(DIGITS_RE.fullmatch(key) is not None and int(key) > maximum for key in record)):
        raise beyond_bounds()
    if not all(pattern.fullmatch(key) is not None and key != "__proto__" for key in record):
        raise malformed(path)
    return sorted(record, key=int) if maximum is not None else sorted(record)


def p11_evidence(probe: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if probe_state(probe, "P11") != "run":
        return None
    p11 = probe.get("P11")
    if not isinstance(p11, dict):
        raise malformed("$.P11")
    assumed = p11.get("tokens_per_word_assumed")
    if opt_number(assumed) is None or assumed <= 0:
        raise malformed("$.P11.tokens_per_word_assumed")
    if not is_positive(p11.get("max_tokens")):
        raise malformed("$.P11.max_tokens")
    sizes_in = p11.get("sizes") or {}
    sizes: Dict[str, Any] = {}
    for key in bounded_keys(sizes_in, "$.P11.sizes", SIZE_KEY_RE, CARD_MAX_SIZES, 9_999_999):
        result = sizes_in[key]
        if not isinstance(result, dict):
            raise malformed("$.P11.sizes")
        # A failed size is {error, elapsed_s, target_tokens, words}: ok false and nulls.
        sizes[key] = {"ok": result.get("status") == 200, "promptTokens": opt_count(result.get("prompt_tokens")), "completionTokens": opt_count(result.get("completion_tokens")),
                      "ttftS": opt_number(result.get("ttft_s")), "prefillTokS": opt_number(result.get("prefill_tok_s_est")),
                      "decodeTokS": opt_number(result.get("decode_tok_s")), "tokensPerWord": opt_number(result.get("tokens_per_word_observed"))}
    refused_in = p11.get("sizes_refused") or []
    if not isinstance(refused_in, list) or not all(isinstance(row, dict) and is_positive(row.get("target_tokens")) for row in refused_in):
        raise malformed("$.P11.sizes_refused")
    if len(refused_in) > CARD_MAX_SIZES:
        raise beyond_bounds()
    cache_layouts = None
    layouts_in = p11.get("cache_layouts")
    if layouts_in is not None:
        if not isinstance(layouts_in, dict) or not is_count(layouts_in.get("packet_bytes")) or not isinstance(layouts_in.get("chunk_bytes"), list) \
                or not all(is_count(size) for size in layouts_in["chunk_bytes"]):
            raise malformed("$.P11.cache_layouts")
        if len(layouts_in["chunk_bytes"]) > CARD_MAX_CHUNKS:
            raise beyond_bounds()
        layouts: Dict[str, Any] = {}
        record = layouts_in.get("layouts") or {}
        for name in bounded_keys(record, "$.P11.cache_layouts.layouts", LAYOUT_NAME_RE, CARD_MAX_LAYOUTS):
            layout = record[name]
            requests = (layout.get("requests") or []) if isinstance(layout, dict) else None
            if not isinstance(requests, list) or not all(isinstance(row, dict) for row in requests):
                raise malformed("$.P11.cache_layouts.layouts")
            if len(requests) > CARD_MAX_LAYOUT_REQUESTS:
                raise beyond_bounds()
            layouts[name] = {"cacheSaltAccepted": layout.get("cache_salt_accepted") is True,
                             "requests": [{"promptTokens": opt_count(row.get("prompt_tokens")), "cachedTokens": opt_count(row.get("cached_tokens")),
                                           "ttftS": opt_number(row.get("ttft_s"))} for row in requests]}
        cache_layouts = {"packetBytes": layouts_in["packet_bytes"], "chunkBytes": list(layouts_in["chunk_bytes"]), "layouts": layouts}
    streams_in = p11.get("k_streams") or {}
    k_streams: Dict[str, Any] = {}
    for key in bounded_keys(streams_in, "$.P11.k_streams", K_KEY_RE, CARD_MAX_K_STREAMS, CARD_MAX_K):
        burst = streams_in[key]
        if not isinstance(burst, dict) or not is_positive(burst.get("streams")) or not is_count(burst.get("errors")) or burst["errors"] > burst["streams"]:
            raise malformed("$.P11.k_streams")
        k_streams[key] = {"streams": burst["streams"], "errors": burst["errors"], "medianDecodeTokS": opt_number(burst.get("median_decode_tok_s")),
                          "aggregateTokS": opt_number(burst.get("aggregate_tok_s")), "maxTtftS": opt_number(burst.get("max_ttft_s")),
                          "maxTotalS": opt_number(burst.get("max_total_s")), "runningMax": opt_number(burst.get("running_max"))}
    return {"tokensPerWordAssumed": assumed, "maxTokens": p11["max_tokens"], "sizes": sizes, "sizesRefused": [row["target_tokens"] for row in refused_in],
            "cacheLayouts": cache_layouts, "kStreams": k_streams}


def bounds_evidence(probe: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """The Markdown's derived-bounds table as numbers, under the Markdown's own condition; informational only."""
    if not (probe.get("roles") and (probe.get("P11") or {}).get("sizes")):
        return None
    sizes = probe["P11"]["sizes"]
    bounds: Dict[str, Any] = {}
    for role, size in ROLE_PROMPT_SIZES.items():
        measured = sizes.get(str(size)) or {}
        prefill, decode = measured.get("ttft_s"), measured.get("decode_tok_s")
        row: Dict[str, Any] = {"promptTokensAssumed": size}
        for clock in STAGE_CLOCKS_S:
            row[f"ceiling{clock}s"] = None if prefill is None or decode is None else stage_ceiling(clock, prefill, decode)
        bounds[role] = row
    return bounds


def adapter_evidence(probe: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if probe_state(probe, "adapter") != "run":
        return None
    adapter = probe.get("adapter")
    if not isinstance(adapter, dict):
        raise malformed("$.adapter")
    verdict, tokenize = adapter.get("verdict"), adapter.get("tokenize")
    verdict = verdict if isinstance(verdict, dict) else {}
    parity = tokenize.get("parity") if isinstance(tokenize, dict) else None
    return {"legacyConsistent": verdict.get("legacy_consistent") is True, "flashNextV1Consistent": verdict.get("flash_next_v1_consistent") is True,
            "tokenizeParity": parity if isinstance(parity, bool) else None}


def proposed_structured_output(role: str, p10: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Proposed only on the requested variant: a cell that fell back to the other variant never qualifies."""
    if p10 is None:
        return None
    requested = "strict" if p10["strictRequested"] else "non_strict"
    meets = {mode: f"{role}/{mode}" in p10["cells"] and p10_cell_meets_rule(p10["cells"][f"{role}/{mode}"], p10["assessed"], requested) for mode in ("off", "on")}
    if not (meets["off"] or meets["on"]):
        return None
    return {"variant": requested, "thinkingOff": meets["off"], "thinkingOn": meets["on"]}


def proposed_roles(probe: Dict[str, Any], p10: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """The role export's caps and thinking on both attempts; structured output by the 95% rule."""
    roles = probe.get("roles")
    caps = roles.get("output_tokens") if isinstance(roles, dict) else None
    thinking = roles.get("thinking") if isinstance(roles, dict) else None
    if not isinstance(caps, dict) or not isinstance(thinking, dict) or not all(is_positive(caps.get(role)) and thinking.get(role) in ("disabled", "model") for role in CARD_ROLES):
        raise Refusal("refused: the machine-readable card needs the role export's output caps and thinking for every role "
                      "(pnpm probe:export-schemas before the probe); the card was not written")
    proposal: Dict[str, Any] = {}
    for role in CARD_ROLES:
        entry: Dict[str, Any] = {"maxOutputTokens": [caps[role], caps[role]], "thinking": [thinking[role], thinking[role]]}
        if role in SCHEMA_ROLES:
            entry["structuredOutput"] = proposed_structured_output(role, p10)
        proposal[role] = entry
    return proposal


def build_policy(probe: Dict[str, Any], date: Optional[str], probe_sha256: str) -> Dict[str, Any]:
    """The machine-readable card (ServingCardV1), keys in the documented order; the decision is always proposed."""
    if not is_sha256(probe_sha256):
        raise Refusal("refused: the probe digest is not a sha256; the card was not written")
    day = card_date(date, probe)
    identity = card_identity(probe)
    failed = probe.get("probes_failed") or {}
    if not isinstance(failed, dict):
        raise malformed("$.probes_failed")
    p10 = p10_evidence(probe)
    return {"kind": CARD_KIND, "version": CARD_VERSION, "date": day, "decision": {"status": "proposed", "entry": None}, "identity": identity,
            "probe": {"probeVersion": 2, "sha256": probe_sha256, "probesRun": probe_names(probe.get("probes_run") or [], "$.probes_run"),
                      "probesSkipped": probe_names(probe.get("probes_skipped") or [], "$.probes_skipped"), "probesFailed": probe_names(list(failed), "$.probes_failed")},
            "roles": proposed_roles(probe, p10), "concurrency": {"localStreams": 1}, "admission": {"basis": "none"},
            "evidence": {"p10": p10, "p11": p11_evidence(probe), "bounds": bounds_evidence(probe), "adapter": adapter_evidence(probe)}}


def encode_card(card: str) -> bytes:
    try:
        return card.encode("utf-8")
    except UnicodeEncodeError:
        raise Refusal("refused: the card cannot be encoded as UTF-8 (a lone surrogate); the card was not written") from None


def encode_policy(policy: Dict[str, Any]) -> bytes:
    """Encoded before any file exists: a lone surrogate or a non-finite number is refused here."""
    try:
        data = (json.dumps(policy, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")
    except ValueError:
        raise Refusal("refused: the machine-readable card cannot be encoded (a lone surrogate or a non-finite number); the card was not written") from None
    if len(data) > CARD_MAX_BYTES:
        raise Refusal("refused: the machine-readable card would exceed 64 KiB; the card was not written")
    return data


def remove_quietly(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass


def write_policy(path: str, data: bytes) -> None:
    """Creates the file exclusively, writes and syncs it, and removes it on any failure; no message names the path."""
    try:
        handle = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    except FileExistsError:
        raise Refusal("refused: the --policy-out file exists; the card was not written") from None
    except OSError:
        raise Refusal("refused: the --policy-out file could not be written; the card was not written") from None
    try:
        view = memoryview(data)
        while view:
            view = view[os.write(handle, view):]
        os.fsync(handle)
        closing, handle = handle, -1
        os.close(closing)
    except BaseException as error:
        if handle >= 0:
            try:
                os.close(handle)
            except OSError:
                pass
        remove_quietly(path)
        if isinstance(error, OSError):
            raise Refusal("refused: the --policy-out file could not be written; the card was not written") from None
        raise


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Write the serving card from a probe JSON")
    parser.add_argument("--input", required=True, help="probe.json written by scripts/serving-probe.py")
    parser.add_argument("--compare-root", default=None, help=f"model root basename of the {QUALIFICATION_DATE} qualification")
    parser.add_argument("--compare-version", default=None, help=f"vLLM version of the {QUALIFICATION_DATE} qualification")
    parser.add_argument("--compare-context", type=int, default=None, help=f"context limit of the {QUALIFICATION_DATE} qualification")
    parser.add_argument("--date", default=None, help="card date (default: the probe's start date)")
    parser.add_argument("--env-file", default=None, help="env file whose SOAR_VLLM_BASE_URL host is also refused (default: the repository's .env.local)")
    parser.add_argument("--policy-out", default=None,
                        help="also write the machine-readable card (kind soar_serving_card, version 1, status proposed); an existing file is refused")
    arguments = list(argv) if argv is not None else sys.argv[1:]
    # pnpm 10 passes the `--` of `pnpm card:serving -- --input ...` through, and argparse would read every flag after it as a
    # positional; the parser has no positional, so dropping one leading `--` changes no invocation that worked before.
    if arguments[:1] == ["--"]:
        arguments = arguments[1:]
    args = parser.parse_args(arguments)
    written: Optional[str] = None
    try:
        with open(args.input, "rb") as handle:
            raw = handle.read()
        probe_sha256 = hashlib.sha256(raw).hexdigest()
        probe = json.loads(raw.decode("utf-8"))
        if not isinstance(probe, dict) or probe.get("probe_version") != 2:
            raise Refusal("refused: the card writer needs a probe_version 2 JSON from scripts/serving-probe.py")
        env_file = args.env_file if args.env_file is not None else os.path.join(ROOT, ".env.local")
        hosts = configured_hosts(dict(os.environ), env_file)
        refuse_addresses(probe, hosts)
        refuse_path_like_identity(probe)
        card = render_card(probe, {"root": args.compare_root, "version": args.compare_version, "context": args.compare_context}, args.date)
        refuse_addresses({"card": card}, hosts)
        encode_card(card)
        if args.policy_out is not None:
            policy = build_policy(probe, args.date, probe_sha256)
            refuse_addresses(policy, hosts)
            data = encode_policy(policy)
            write_policy(args.policy_out, data)
            written = args.policy_out
    except (Refusal, ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 2
    try:
        sys.stdout.write(card)
        sys.stdout.flush()
    except Exception:  # a JSON card never outlives a Markdown card that was not printed
        if written is not None:
            remove_quietly(written)
        print("refused: the Markdown card could not be written to standard output; the card was not written", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
