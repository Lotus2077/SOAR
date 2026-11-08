#!/usr/bin/env python3
"""Write the serving card (Markdown) from a probe JSON written by scripts/serving-probe.py (probe_version 2).

    python3 scripts/serving-card.py --input .soar/experiments/serving-probe-<ts>/probe.json \
        [--compare-root Qwen3.8-Flash-Next-NVFP4 --compare-version <vllm version> --compare-context 262144] \
        > docs/experiments/serving-card-<date>.md

Prints Markdown to stdout for the operator to review before committing it. The card holds the Source paragraph, the
Identity table (alias, engine version, context, model root basename, authentication, transport class only), optional
"consistent with the 2026-11-04 qualification" rows (consistency, never identical weights), the Behaviour table per probe
including P10, P11 and the adapter probe, and a derived-bounds table (per role: output cap against the app's 300 s and
900 s request clocks) marked as proposals for the E0 card. It refuses, with exit 2 and no output, a probe JSON that is not
version 2 and any string that looks like a URL, an IP address, a host:port or the configured endpoint's host, and it
never copies error detail fields. The output is deterministic for a given input.
"""

from __future__ import annotations

import argparse
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
                ceiling = int(math.floor((clock - prefill) * decode))
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


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Write the serving card from a probe JSON")
    parser.add_argument("--input", required=True, help="probe.json written by scripts/serving-probe.py")
    parser.add_argument("--compare-root", default=None, help=f"model root basename of the {QUALIFICATION_DATE} qualification")
    parser.add_argument("--compare-version", default=None, help=f"vLLM version of the {QUALIFICATION_DATE} qualification")
    parser.add_argument("--compare-context", type=int, default=None, help=f"context limit of the {QUALIFICATION_DATE} qualification")
    parser.add_argument("--date", default=None, help="card date (default: the probe's start date)")
    parser.add_argument("--env-file", default=None, help="env file whose SOAR_VLLM_BASE_URL host is also refused (default: the repository's .env.local)")
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        with open(args.input, encoding="utf-8") as handle:
            probe = json.load(handle)
        if not isinstance(probe, dict) or probe.get("probe_version") != 2:
            raise Refusal("refused: the card writer needs a probe_version 2 JSON from scripts/serving-probe.py")
        env_file = args.env_file if args.env_file is not None else os.path.join(ROOT, ".env.local")
        refuse_addresses(probe, configured_hosts(dict(os.environ), env_file))
        card = render_card(probe, {"root": args.compare_root, "version": args.compare_version, "context": args.compare_context}, args.date)
        refuse_addresses({"card": card}, configured_hosts(dict(os.environ), env_file))
    except (Refusal, ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 2
    sys.stdout.write(card)
    return 0


if __name__ == "__main__":
    sys.exit(main())
