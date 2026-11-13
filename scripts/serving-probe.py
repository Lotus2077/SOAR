#!/usr/bin/env python3
"""SOAR serving probe: measure the local inference endpoint (zero API fee).

Reads SOAR_VLLM_BASE_URL (and the optional SOAR_VLLM_API_KEY, SOAR_VLLM_MODEL,
SOAR_VLLM_COST_POLICY and SOAR_ALLOW_INSECURE_VLLM_HTTP) from the environment or from
the repository's ignored .env.local, and only when run: nothing reads the environment
at import, so the pure helpers can be imported without an endpoint. The address and
the key are never printed or stored. Server error bodies are stored as status, length
and sha256 only. The probe JSON and the retained P10 replies go under the ignored
.soar/experiments/serving-probe-<ts>/ and the printed summary carries no address.

    pnpm probe:export-schemas                        # .soar/experiments/role-schemas.json (P10 needs it)
    python3 scripts/serving-probe.py                 # every probe (P8, P10 and P11 are long)
    python3 scripts/serving-probe.py --skip P8,P10   # probe selection
    python3 scripts/serving-probe.py --only P1,adapter
    pnpm probe:assess -- --probe .soar/experiments/serving-probe-<ts>/probe.json   # P10 verdicts
    pnpm card:serving -- --input .soar/experiments/serving-probe-<ts>/probe.json  # the card

Probes (docs/PLAN.md Phase 0 step 4; docs/PROJECT_REVIEW_2026-11-05.md section 5.6, E0):
  P1 identity   P2 effort honoured   P3 decode/prefill by workload
  P4 prefix cache   P5 escaped tool-argument integrity   P6 abort then next request
  P7 one vs two streams   P8 non-streaming request over 300 s   P9 context guard
  P10 structured output per role: the pipeline's own request bodies (pnpm probe:export-schemas) with response_format
      json_schema added, thinking on and off; a streamed body is read as server-sent events (P10-align)
  P11 prefill and decode by prompt size, cache reuse per extraction layout, K streams
  adapter: /openapi.json, /tokenize parity, reasoning field, legacy or flash_next_v1
All prompts are synthetic. Never send personal or professional data through this.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import random
import re
import statistics
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Sequence, Tuple

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROBE_VERSION = 2
PROBES = ("P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11", "adapter")
NO_THINK = {"chat_template_kwargs": {"enable_thinking": False}, "temperature": 0.7, "top_p": 0.8, "top_k": 20,
            "presence_penalty": 1.5}
THINK_SAMPLING = {"temperature": 1.0, "top_p": 0.95, "top_k": 20}
# Measured on 2026-09-28 (serving card P3): 47,299 prompt tokens for a 38,000-word synthetic document.
TOKENS_PER_WORD = 1.245
P10_CALLS = 20
P10_ROLES = ("plan", "extract", "synthesis")
P10_MODES = ("on", "off")
# P10-align (BL-20261113-1011-p10-align-design): the export version that carries the pipeline's request bodies.
P10_EXPORT_VERSION = 2
P10_SCHEMA_NAMES = {"plan": "research_plan", "extract": "research_extraction", "synthesis": "research_synthesis"}
P10_CLASSES = ("request_rejected", "truncated", "invalid_json", "schema_invalid", "binding_invalid", "valid", "unassessed")
P11_SIZES = (20_000, 60_000, 120_000)
P11_MAX_TOKENS = 300
P11_KS = (1, 2, 4, 8)
P11_CHUNK_BYTES = 65536
P11_PACKET_BYTES = 20 * 1024
P11_EXTRACT_SYSTEM = ("You extract evidence from one complete supplied source chunk for all supplied questions. "
                      "Reply with one short JSON object.")
LOOPBACK_HOSTS = ("localhost", "127.0.0.1", "::1", "[::1]")
THINK_TAG = re.compile(r"^\s*</?think(?:\s[^>]*)?>", re.IGNORECASE)
REASONING_FIELDS = ("reasoning", "reasoning_content")


class ConfigError(Exception):
    """Configuration refused before any request."""


# --- pure helpers (no I/O, no environment) ------------------------------------------------------------------


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def redact_error(body: Any) -> Dict[str, Any]:
    """A server error body may name paths or hosts: keep its length and digest only."""
    if body is None:
        return {"error_bytes": 0, "error_sha256": None}
    data = body if isinstance(body, bytes) else str(body).encode("utf-8", "replace")
    return {"error_bytes": len(data), "error_sha256": sha256_bytes(data) if data else None}


def read_env_file(path: str) -> Dict[str, str]:
    values: Dict[str, str] = {}
    if not path or not os.path.exists(path):
        return values
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            match = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
            if match:
                values[match.group(1)] = match.group(2).strip().strip('"').strip("'")
    return values


def load_config(environ: Dict[str, str], env_file: Optional[str]) -> Dict[str, Any]:
    """Environment first, then the env file; refuses without a base URL. Never logs the values."""
    env = dict(environ)
    for name, value in read_env_file(env_file or "").items():
        env.setdefault(name, value)
    base = (env.get("SOAR_VLLM_BASE_URL") or "").strip().rstrip("/")
    if not base:
        raise ConfigError("SOAR_VLLM_BASE_URL is not set (environment or .env.local).")
    return {"base": base, "key": env.get("SOAR_VLLM_API_KEY") or None, "model": env.get("SOAR_VLLM_MODEL") or None,
            "cost_policy": env.get("SOAR_VLLM_COST_POLICY") or None,
            "allow_insecure": (env.get("SOAR_ALLOW_INSECURE_VLLM_HTTP") or "").strip().lower() == "true"}


def hostname_of(base: str) -> str:
    parts = urllib.parse.urlsplit(base)
    host = parts.hostname or ""
    return "[::1]" if host == "::1" else host


def is_loopback(base: str) -> bool:
    host = hostname_of(base)
    return host in LOOPBACK_HOSTS


def endpoint_policy_issue(base: str, cost_policy: Optional[str], allow_insecure: bool) -> Optional[str]:
    """Mirror of vllmEndpointPolicyIssue in src/main/config.ts: the probe refuses what the app refuses."""
    parts = urllib.parse.urlsplit(base)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return "SOAR_VLLM_BASE_URL is not a valid HTTP or HTTPS URL."
    loopback = is_loopback(base)
    if not loopback and cost_policy != "local_zero_cost":
        return ("A non-loopback endpoint requires SOAR_VLLM_COST_POLICY=local_zero_cost; the probe cannot verify "
                "endpoint billing and refuses to run.")
    if parts.scheme == "http" and not loopback and not allow_insecure:
        return "A non-loopback plaintext endpoint requires SOAR_ALLOW_INSECURE_VLLM_HTTP=true in the machine-local environment."
    return None


def transport_class(base: str) -> str:
    """A class, never an address: loopback (a local forward counts), plain_http or https."""
    if is_loopback(base):
        return "loopback"
    return "https" if urllib.parse.urlsplit(base).scheme == "https" else "plain_http"


def words_for_tokens(tokens: int, factor: float = TOKENS_PER_WORD) -> int:
    if tokens <= 0:
        raise ValueError("tokens must be positive")
    return int(round(tokens / factor))


def p11_size_admissible(prompt_tokens: int, max_tokens: int, max_model_len: Optional[int]) -> bool:
    """A size is refused when its prompt plus the reply would exceed the served context (P9's guard)."""
    if max_model_len is None:
        return True
    return prompt_tokens + max_tokens <= max_model_len


def plan_p11_sizes(sizes: Sequence[int], max_tokens: int, max_model_len: Optional[int]) -> Tuple[List[int], List[int]]:
    admitted = [size for size in sizes if p11_size_admissible(size, max_tokens, max_model_len)]
    refused = [size for size in sizes if size not in admitted]
    return admitted, refused


def parse_int_list(text: str, name: str) -> Tuple[int, ...]:
    """Comma-separated positive integers, deduplicated and ascending ("8,1,2,2" -> (1, 2, 8))."""
    values = set()
    for item in text.split(","):
        item = item.strip()
        if not item:
            continue
        if not item.isdigit() or int(item) <= 0:
            raise ValueError(f"{name}: expected positive integers, got {item!r}")
        values.add(int(item))
    if not values:
        raise ValueError(f"{name}: no values")
    return tuple(sorted(values))


def select_probes(only: Optional[str], skip: Optional[str]) -> List[str]:
    chosen = list(PROBES)
    if only:
        wanted = [name.strip() for name in only.split(",") if name.strip()]
        unknown = [name for name in wanted if name not in PROBES]
        if unknown:
            raise ValueError(f"unknown probe(s): {', '.join(unknown)}")
        chosen = [name for name in PROBES if name in wanted]
    if skip:
        dropped = [name.strip() for name in skip.split(",") if name.strip()]
        unknown = [name for name in dropped if name not in PROBES]
        if unknown:
            raise ValueError(f"unknown probe(s): {', '.join(unknown)}")
        chosen = [name for name in chosen if name not in dropped]
    return chosen


def synthetic_document(target_words: int, seed: int) -> str:
    rng = random.Random(seed)
    vocab = ("harbor lantern keeper storm ledger granite coastline signal beacon tide archive courier valley "
             "orchard meadow circuit protocol lattice mineral canal bridge timber furnace quarry glacier "
             "compass cartographer weaver bakery market council river delta estuary monsoon ferry").split()
    sentences = []
    words = 0
    while words < target_words:
        n = rng.randint(8, 18)
        sentence = " ".join(rng.choice(vocab) for _ in range(n)).capitalize() + "."
        sentences.append(sentence)
        words += n
    return f"Document id {seed}.\n" + " ".join(sentences)


def synthetic_text_bytes(target_bytes: int, seed: int) -> str:
    """Synthetic prose of about target_bytes UTF-8 bytes, cut at a word boundary."""
    text = synthetic_document(max(16, target_bytes // 6), seed)
    while len(text.encode("utf-8")) < target_bytes:
        text += " " + synthetic_document(max(16, target_bytes // 6), seed + len(text))
    cut = text.encode("utf-8")[:target_bytes].decode("utf-8", "ignore")
    return cut.rsplit(" ", 1)[0]


def synthetic_packet(seed: int, target_bytes: int = P11_PACKET_BYTES) -> Dict[str, Any]:
    """An extraction request's job-level parts: the stable packet (brief, units and plan, about target_bytes in all) and the source
    the chunks belong to, which the pipeline sends in the per-chunk part."""
    brief = ("1. Describe the synthetic observations in the supplied corpus.\n2. Name every conflict between sources.\n"
             "3. State the limitations of the evidence.\n")
    units = [{"id": f"U{i + 1}", "text": line} for i, line in enumerate(brief.splitlines())]
    plan = {"version": 2, "questions": [{"id": f"Q{i + 1}", "text": f"What does the corpus establish about {unit['text'][3:].rstrip('.').lower()}?",
                                          "requirementIds": [unit["id"]], "sourceIds": [], "lookFor": []} for i, unit in enumerate(units)],
            "conflictsToCheck": [], "deliverableNotes": synthetic_text_bytes(target_bytes - 1200, seed)}
    return {"brief": brief, "units": units, "plan": plan, "source": {"id": f"input/corpus/synthetic-{seed}.md", "sha256": sha256_text(str(seed))}}


def synthetic_chunk(target_bytes: int, seed: int) -> Dict[str, Any]:
    text = synthetic_text_bytes(target_bytes, seed)
    return {"id": f"S1C{seed % 97}", "startByte": 0, "endByte": len(text.encode("utf-8")), "text": text}


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


# The pipeline's extraction layout (RESEARCH_EXTRACTION_LAYOUT in research-pipeline.ts, backlog item 7(b) part 1), recorded in
# P11's output so a probe JSON states which stable_prefix it measured; a test pins this copy equal to the TypeScript one.
EXTRACTION_LAYOUT = {"version": 1, "separator": "\n", "stable": ["brief", "plan", "units"], "perChunk": ["chunk", "repairReason", "source"]}


def stable_packet(packet: Dict[str, Any]) -> Dict[str, Any]:
    """The part every extraction request of a job shares: brief, plan and units."""
    return {key: packet[key] for key in EXTRACTION_LAYOUT["stable"]}


def extraction_layouts(system: str, packet: Dict[str, Any], chunk: Dict[str, Any]) -> Dict[str, List[Dict[str, str]]]:
    """sorted_keys is the pipeline's extraction message before backlog item 7(b) part 1: one sorted-key object, which puts the
    chunk between the brief and the plan. stable_prefix is the pipeline's message since then (researchExtractionUserContent in
    research-pipeline.ts): canonical {brief, plan, units}, a newline, then canonical {chunk, repairReason, source}."""
    sorted_user = canonical_json({**packet, "chunk": chunk, "repairReason": None})
    per_chunk = {"chunk": chunk, "repairReason": None, "source": packet["source"]}
    stable_user = canonical_json(stable_packet(packet)) + EXTRACTION_LAYOUT["separator"] + canonical_json({key: per_chunk[key] for key in EXTRACTION_LAYOUT["perChunk"]})
    return {"sorted_keys": [{"role": "system", "content": system}, {"role": "user", "content": sorted_user}],
            "stable_prefix": [{"role": "system", "content": system}, {"role": "user", "content": stable_user}]}


def cache_layouts_record(packet: Dict[str, Any], chunks: List[Dict[str, Any]], layouts: Dict[str, Any]) -> Dict[str, Any]:
    """P11's cache_layouts block: the pipeline's layout descriptor, then packet_* over the stable packet (the first line every
    extraction request of a job shares; since 7b.1 it holds no source), the chunks' digests and sizes, and the layouts' rows."""
    stable = canonical_json(stable_packet(packet))
    return {"stable_prefix_layout": EXTRACTION_LAYOUT, "packet_sha256": sha256_text(stable), "packet_bytes": len(stable.encode("utf-8")),
            "chunk_sha256": [sha256_text(chunk["text"]) for chunk in chunks], "chunk_bytes": [chunk["endByte"] for chunk in chunks],
            "layouts": layouts}


def stable_prefix_of(messages: List[Dict[str, str]]) -> str:
    """The part of a stable_prefix layout before its chunk (what a second request can reuse)."""
    return messages[1]["content"].split("\n", 1)[0]


def parse_json_reply(content: Optional[str]) -> Optional[Any]:
    """Mirror of parseJsonReply in research-index.ts: the outer object only, surrounding prose ignored."""
    if not isinstance(content, str):
        return None
    start, end = content.find("{"), content.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        return json.loads(content[start:end + 1])
    except ValueError:
        return None


def classify_reply(status: int, finish_reason: Optional[str], content: Optional[str], assessment: Optional[str] = None) -> str:
    """P10 order: request_rejected, truncated, invalid_json, then the schema verdict (assessed in TypeScript)."""
    if status != 200:
        return "request_rejected"
    if finish_reason == "length":
        return "truncated"
    if parse_json_reply(content) is None:
        return "invalid_json"
    if assessment is None:
        return "unassessed"
    if assessment not in ("schema_invalid", "binding_invalid", "valid"):
        raise ValueError(f"unknown assessment {assessment!r}")
    return assessment


def reasoning_field_of(message: Dict[str, Any]) -> str:
    """none, reasoning, reasoning_content, or mixed: the same names flash-next-reply.ts records."""
    seen = [field for field in REASONING_FIELDS if isinstance(message.get(field), str) and message.get(field)]
    if not seen:
        return "none"
    return seen[0] if len(seen) == 1 else "mixed"


def reasoning_bytes_of(message: Dict[str, Any]) -> int:
    return sum(len(message[field].encode("utf-8")) for field in REASONING_FIELDS if isinstance(message.get(field), str))


def leading_think_tag(content: Optional[str]) -> bool:
    return bool(content) and THINK_TAG.match(content) is not None


def summarize_cell(calls: List[Dict[str, Any]], thinking: str) -> Dict[str, Any]:
    counts = {name: 0 for name in P10_CLASSES}
    for call in calls:
        counts[call.get("classification", "unassessed")] += 1
    settled = [call for call in calls if call.get("status") == 200]
    elapsed = [call["elapsed_s"] for call in calls if isinstance(call.get("elapsed_s"), (int, float))]
    completion = [call["completion_tokens"] for call in settled if isinstance(call.get("completion_tokens"), int)]
    summary: Dict[str, Any] = {**counts, "total": len(calls),
                               "median_elapsed_s": round(statistics.median(elapsed), 2) if elapsed else None,
                               "max_elapsed_s": round(max(elapsed), 2) if elapsed else None,
                               "median_completion_tokens": int(statistics.median(completion)) if completion else None}
    if thinking == "on":
        summary["thinking_on_zero_reasoning"] = sum(1 for call in settled if call.get("reasoning_tokens") == 0)
        summary["reasoning_tokens_unreported"] = sum(1 for call in settled if call.get("reasoning_tokens") is None)
    return summary


def aggregate_streams(results: Sequence[Dict[str, Any]], running_samples: Sequence[Optional[float]]) -> Dict[str, Any]:
    """Per-K view of a burst: per-stream decode, aggregate tokens/s over the burst's wall time, load during it."""
    ok = [r for r in results if "error" not in r and r.get("completion_tokens") and r.get("total_s")]
    decode = [r["decode_tok_s"] for r in ok if r.get("decode_tok_s") is not None]
    ttft = [r["ttft_s"] for r in ok if r.get("ttft_s") is not None]
    load = [s for s in running_samples if s is not None]
    return {"streams": len(results), "errors": len(results) - len(ok),
            "per_stream_decode_tok_s": decode, "median_decode_tok_s": round(statistics.median(decode), 2) if decode else None,
            "aggregate_tok_s": round(sum(r["completion_tokens"] for r in ok) / max(r["total_s"] for r in ok), 2) if ok else None,
            "max_ttft_s": round(max(ttft), 3) if ttft else None, "max_total_s": round(max(r["total_s"] for r in ok), 2) if ok else None,
            "running_samples": list(running_samples), "running_max": max(load) if load else None}


def adapter_verdict(adapter: Dict[str, Any]) -> Dict[str, Any]:
    """Consistency with the two reply contracts, from recorded observations only (flash-next-reply.ts rules)."""
    on_json, on_sse = adapter.get("thinking_on_json") or {}, adapter.get("thinking_on_sse") or {}
    off_json, off_sse = adapter.get("thinking_off_json") or {}, adapter.get("thinking_off_sse") or {}
    replies = (on_json, on_sse, off_json, off_sse)
    settled = all(r.get("status") == 200 and r.get("finish_reason") for r in replies)
    legacy = settled and all(r.get("content_bytes") is not None for r in replies)
    model_seen = all(r.get("model_matches") for r in (on_json, off_json)) and all(r.get("model_chunks", 0) > 0 and r.get("model_mismatch_chunks", 0) == 0 for r in (on_sse, off_sse))
    no_wrapper = not any(r.get("leading_think_tag") for r in replies)
    no_leak = all((r.get("reasoning_bytes") or 0) == 0 for r in (off_json, off_sse))
    fields = {r.get("reasoning_field") for r in (on_json, on_sse)} - {"none", None}
    one_field = len(fields) <= 1 and "mixed" not in fields
    preserve = bool((adapter.get("preserve_thinking") or {}).get("accepted"))
    flash = legacy and model_seen and no_wrapper and no_leak and one_field and preserve
    return {"legacy_consistent": legacy, "flash_next_v1_consistent": flash,
            "checks": {"settled": settled, "model_in_replies": model_seen, "no_leading_think_tag": no_wrapper,
                       "no_reasoning_under_thinking_off": no_leak, "one_reasoning_field": one_field, "preserve_thinking_accepted": preserve},
            "note": "consistency of a few synthetic replies; it does not establish the contract"}


def response_format(role: str, schema: Dict[str, Any], strict: bool) -> Dict[str, Any]:
    """The strict variant is the ReviewResultV1 shape openai-compatible.ts already sends; non-strict omits the flag."""
    json_schema: Dict[str, Any] = {"name": P10_SCHEMA_NAMES[role], "schema": schema}
    if strict:
        json_schema["strict"] = True
    return {"type": "json_schema", "json_schema": json_schema}


def choose_variant(acceptance: Dict[str, Dict[str, Any]], requested_strict: bool) -> bool:
    """The 20-call cells use the requested variant if the server accepted it, else the other accepted one."""
    requested, other = ("strict", "non_strict") if requested_strict else ("non_strict", "strict")
    if acceptance.get(requested, {}).get("accepted"):
        return requested_strict
    if acceptance.get(other, {}).get("accepted"):
        return not requested_strict
    return requested_strict


def p10_bodies(schemas: Dict[str, Any], model: Optional[str]) -> Dict[str, Dict[str, Dict[str, Any]]]:
    """P10-align: the pipeline's own body for each role and thinking mode, as the role export built it. Refuses, before any
    request, an older export, a missing body, a body for another model than the probe's, and a body that already sets
    response_format."""
    if not isinstance(schemas.get("version"), int) or schemas["version"] < P10_EXPORT_VERSION or not isinstance(schemas.get("requests"), dict):
        raise ConfigError("P10 needs the pipeline's request bodies (role export version 2): run pnpm probe:export-schemas again")
    bodies: Dict[str, Dict[str, Dict[str, Any]]] = {}
    for role in P10_ROLES:
        for mode in P10_MODES:
            entry = (schemas["requests"].get(role) or {}).get(mode) or {}
            body = entry.get("body") if isinstance(entry, dict) else None
            if not isinstance(body, dict) or not isinstance(body.get("messages"), list) or "response_format" in body:
                raise ConfigError(f"the role export has no usable {role}/{mode} body: run pnpm probe:export-schemas again")
            if model is not None and body.get("model") != model:
                raise ConfigError("the role export names another model than the probe: export with the same SOAR_VLLM_MODEL")
            bodies.setdefault(role, {})[mode] = body
    return bodies


def p10_request_body(body: Dict[str, Any], role: str, schema: Dict[str, Any], strict: bool) -> Dict[str, Any]:
    """The exported body with only response_format added: nothing else is the probe's own."""
    return {**body, "response_format": response_format(role, schema, strict)}


def reassemble_stream(lines: Sequence[str]) -> Tuple[Dict[str, Any], int]:
    """A streamed chat completion as the JSON a plain reply would have: the joined content and reasoning fields, the last
    finish reason, the usage and the model. Returns the reply and the number of data chunks; a malformed line raises ValueError."""
    content_parts: List[str] = []
    reasoning: Dict[str, List[str]] = {}
    finish = usage = model = None
    chunks = 0
    for raw in lines:
        line = raw.strip()
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if payload == "[DONE]":
            break
        obj = json.loads(payload)
        if not isinstance(obj, dict):
            raise ValueError("stream chunk is not an object")
        chunks += 1
        model = obj.get("model", model)
        usage = obj.get("usage") or usage
        for choice in obj.get("choices") or []:
            delta = choice.get("delta") or {}
            if isinstance(delta.get("content"), str):
                content_parts.append(delta["content"])
            for field in REASONING_FIELDS:
                if isinstance(delta.get(field), str) and delta[field]:
                    reasoning.setdefault(field, []).append(delta[field])
            finish = choice.get("finish_reason") or finish
    message: Dict[str, Any] = {"role": "assistant", "content": "".join(content_parts) if content_parts else None}
    for field, parts in reasoning.items():
        message[field] = "".join(parts)
    reply: Dict[str, Any] = {"object": "chat.completion", **({"model": model} if model is not None else {}),
                             "choices": [{"index": 0, "message": message, "finish_reason": finish}], **({"usage": usage} if usage is not None else {})}
    return reply, chunks


def write_private(path: str, data: bytes) -> str:
    """Retained reply bodies are owner-readable only."""
    handle = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(handle, data)
    finally:
        os.close(handle)
    os.chmod(path, 0o600)
    return sha256_bytes(data)


def strip_reasoning_fields(raw: bytes) -> bytes:
    try:
        body = json.loads(raw)
    except ValueError:
        return raw
    for choice in body.get("choices") or []:
        message = choice.get("message")
        if isinstance(message, dict):
            for field in REASONING_FIELDS:
                message.pop(field, None)
    return json.dumps(body, ensure_ascii=False).encode("utf-8")


# --- endpoint access (the only place the address is used; never returned or printed) ---------------------------


class Endpoint:
    def __init__(self, config: Dict[str, Any]) -> None:
        self.base: str = config["base"]
        parts = urllib.parse.urlsplit(self.base)
        self.origin = f"{parts.scheme}://{parts.netloc}"
        self.model: Optional[str] = config.get("model")
        self.model_source = "env" if self.model else None
        self.max_model_len: Optional[int] = None
        key = config.get("key")
        self.headers = {"Content-Type": "application/json", **({"Authorization": f"Bearer {key}"} if key else {})}

    def get(self, path: str, at_origin: bool = False, timeout: float = 15) -> Tuple[int, str]:
        request = urllib.request.Request((self.origin if at_origin else self.base) + path, headers=self.headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.status, response.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as error:
            return error.code, ""
        except Exception:  # a transient reset must not abort the whole probe
            return -1, ""

    def ensure_model(self) -> None:
        status, text = self.get("/models")
        models = []
        if status == 200:
            try:
                models = json.loads(text).get("data", [])
            except ValueError:
                models = []
        if models:
            self.max_model_len = models[0].get("max_model_len") or self.max_model_len
            if not self.model:
                self.model = models[0].get("id")
                self.model_source = "served_first"

    def metric(self, name: str) -> Optional[float]:
        status, text = self.get("/metrics", at_origin=True)
        if status != 200:
            return None
        total = None
        for line in text.splitlines():
            if line.startswith(name) and not line.startswith("#"):
                try:
                    total = (total or 0.0) + float(line.rsplit(" ", 1)[1])
                except ValueError:
                    pass
        return total

    def post(self, path: str, body: Dict[str, Any], timeout: float, at_origin: bool = False) -> Dict[str, Any]:
        """Returns status, elapsed, the parsed JSON (or None) and the raw bytes; callers never store raw or error text."""
        started = time.monotonic()
        request = urllib.request.Request((self.origin if at_origin else self.base) + path, data=json.dumps(body).encode(), headers=self.headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
                try:
                    parsed: Any = json.loads(raw)
                except ValueError:
                    parsed = None
                return {"status": response.status, "raw": raw, "json": parsed, "elapsed_s": time.monotonic() - started}
        except urllib.error.HTTPError as error:
            raw = error.read()
            return {"status": error.code, "raw": raw, "json": None, "elapsed_s": time.monotonic() - started, **redact_error(raw)}
        except Exception as error:  # timeouts, resets
            return {"status": -1, "raw": b"", "json": None, "elapsed_s": time.monotonic() - started, "transport_error": type(error).__name__}

    def post_stream(self, path: str, body: Dict[str, Any], timeout: float) -> Dict[str, Any]:
        """post() for a body with stream: true: the reply is reassembled into the JSON a plain reply has, so callers and the
        assessor read both alike. A malformed stream is a transport failure."""
        started = time.monotonic()
        request = urllib.request.Request(self.base + path, data=json.dumps(body).encode(), headers=self.headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                status = response.status
                lines = [raw.decode("utf-8", "replace") for raw in response]
        except urllib.error.HTTPError as error:
            raw = error.read()
            return {"status": error.code, "raw": raw, "json": None, "elapsed_s": time.monotonic() - started, **redact_error(raw)}
        except Exception as error:  # timeouts, resets
            return {"status": -1, "raw": b"", "json": None, "elapsed_s": time.monotonic() - started, "transport_error": type(error).__name__}
        try:
            reply, chunks = reassemble_stream(lines)
        except ValueError:
            return {"status": -1, "raw": b"", "json": None, "elapsed_s": time.monotonic() - started, "transport_error": "StreamMalformed"}
        raw = json.dumps(reply, ensure_ascii=False).encode("utf-8")
        return {"status": status, "raw": raw, "json": reply, "elapsed_s": time.monotonic() - started, "stream_chunks": chunks}

    def stream(self, messages: list, max_tokens: int, extra: dict, timeout: float = 900, abort_after: Optional[float] = None,
               keep_content: bool = False) -> dict:
        body = {"model": self.model, "messages": messages, "max_tokens": max_tokens, "stream": True,
                "stream_options": {"include_usage": True}, **extra}
        request = urllib.request.Request(self.base + "/chat/completions", data=json.dumps(body).encode(), headers=self.headers)
        started = time.monotonic()
        first = last = None
        usage: dict = {}
        content_chars = reasoning_chars = reasoning_bytes = 0
        content_parts: List[str] = []
        head = ""
        fields_seen = set()
        model_chunks = model_mismatch = chunk_count = 0
        finish = None
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                for raw in response:
                    if abort_after is not None and time.monotonic() - started > abort_after:
                        return {"aborted_after_s": round(time.monotonic() - started, 2)}
                    line = raw.decode("utf-8", "replace").strip()
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if payload == "[DONE]":
                        break
                    obj = json.loads(payload)
                    chunk_count += 1
                    if "model" in obj:
                        if obj.get("model") == self.model:
                            model_chunks += 1
                        else:
                            model_mismatch += 1
                    usage = obj.get("usage") or usage
                    for choice in obj.get("choices", []):
                        delta = choice.get("delta", {})
                        text = delta.get("content") or ""
                        reasoning = ""
                        for field in REASONING_FIELDS:
                            value = delta.get(field)
                            if isinstance(value, str) and value:
                                fields_seen.add(field)
                                reasoning += value
                        if text or reasoning:
                            now = time.monotonic()
                            first = first or now
                            last = now
                            content_chars += len(text)
                            reasoning_chars += len(reasoning)
                            reasoning_bytes += len(reasoning.encode("utf-8"))
                        if text:
                            if len(head) < 256:
                                head += text[:256 - len(head)]
                            if keep_content:
                                content_parts.append(text)
                        finish = choice.get("finish_reason") or finish
        except urllib.error.HTTPError as error:
            return {"error": error.code, **redact_error(error.read()), "elapsed_s": round(time.monotonic() - started, 2)}
        except Exception as error:
            return {"error": type(error).__name__, "elapsed_s": round(time.monotonic() - started, 2)}
        completion = usage.get("completion_tokens") or 0
        prompt = usage.get("prompt_tokens") or 0
        ttft = (first - started) if first else None
        decode = (completion - 1) / (last - first) if first and last and last > first and completion > 1 else None
        details = usage.get("prompt_tokens_details") or {}
        comp_details = usage.get("completion_tokens_details") or {}
        result = {"status": 200, "prompt_tokens": prompt, "completion_tokens": completion, "cached_tokens": details.get("cached_tokens"),
                  "reasoning_tokens": comp_details.get("reasoning_tokens"), "reasoning_chars": reasoning_chars, "reasoning_bytes": reasoning_bytes,
                  "content_chars": content_chars, "ttft_s": round(ttft, 3) if ttft else None,
                  "decode_tok_s": round(decode, 2) if decode else None,
                  "prefill_tok_s_est": round(prompt / ttft, 1) if ttft and prompt else None,
                  "total_s": round(time.monotonic() - started, 2), "finish_reason": finish,
                  "reasoning_field": "none" if not fields_seen else (next(iter(fields_seen)) if len(fields_seen) == 1 else "mixed"),
                  "model_chunks": model_chunks, "model_mismatch_chunks": model_mismatch, "chunks": chunk_count,
                  "leading_think_tag": leading_think_tag(head)}
        if keep_content:
            content = "".join(content_parts)
            result.update({"content": content, "content_sha256": sha256_text(content), "content_bytes": len(content.encode("utf-8"))})
        return result


def post_record(result: Dict[str, Any]) -> Dict[str, Any]:
    """The card-safe view of a post() result: status, timing and the redacted error, never the body."""
    record = {"status": result["status"], "elapsed_s": round(result["elapsed_s"], 2)}
    for key in ("error_bytes", "error_sha256", "transport_error"):
        if key in result:
            record[key] = result[key]
    return record


def inspect_json_reply(result: Dict[str, Any], model: Optional[str]) -> Dict[str, Any]:
    record = post_record(result)
    body = result.get("json")
    if not isinstance(body, dict):
        return record
    choices = body.get("choices") or [{}]
    choice = choices[0] if choices else {}
    message = choice.get("message") or {}
    content = message.get("content") if isinstance(message.get("content"), str) else None
    usage = body.get("usage") or {}
    record.update({"finish_reason": choice.get("finish_reason"), "model_present": "model" in body, "model_matches": body.get("model") == model,
                   "reasoning_field": reasoning_field_of(message), "reasoning_bytes": reasoning_bytes_of(message),
                   "reasoning_tokens": (usage.get("completion_tokens_details") or {}).get("reasoning_tokens"),
                   "prompt_tokens": usage.get("prompt_tokens"), "completion_tokens": usage.get("completion_tokens"),
                   "content_bytes": len(content.encode("utf-8")) if content is not None else None,
                   "content_sha256": sha256_text(content) if content is not None else None, "leading_think_tag": leading_think_tag(content)})
    return record


def inspect_sse(result: Dict[str, Any]) -> Dict[str, Any]:
    record = {key: value for key, value in result.items() if key != "content"}
    if "error" in record:
        record["status"] = record["error"] if isinstance(record["error"], int) else -1
    return record


# --- probes ----------------------------------------------------------------------------------------------------


def probe_p1(ep: Endpoint, card: dict, ctx: dict) -> dict:
    status, text = ep.get("/models")
    models = []
    if status == 200:
        try:
            models = json.loads(text).get("data", [])
        except ValueError:
            models = []
    p1 = {"models_status": status, "auth_required": status in (401, 403),
          "models": [{"id": m.get("id"), "root_basename": os.path.basename(str(m.get("root", "")).rstrip("/")),
                      "max_model_len": m.get("max_model_len")} for m in models]}
    status, text = ep.get("/version", at_origin=True)
    version = None
    if status == 200:
        try:
            version = json.loads(text).get("version")
        except ValueError:
            version = None
    p1["version_status"] = status
    p1["version"] = version
    if models and models[0].get("max_model_len"):
        ep.max_model_len = models[0]["max_model_len"]
    return p1


def probe_p2(ep: Endpoint, card: dict, ctx: dict) -> dict:
    p2 = {}
    for label, extra in (("kwargs_low", {"chat_template_kwargs": {"reasoning_effort": "low"}}),
                         ("kwargs_medium", {"chat_template_kwargs": {"reasoning_effort": "medium"}}),
                         ("kwargs_xhigh", {"chat_template_kwargs": {"reasoning_effort": "xhigh"}}),
                         ("toplevel_medium_as_SOAR_sends", {"reasoning_effort": "medium"}),
                         ("thinking_disabled", {"chat_template_kwargs": {"enable_thinking": False}})):
        p2[label] = ep.stream(ctx["puzzle"], 8000, {**THINK_SAMPLING, **extra}, timeout=600)
    return p2


def probe_p3(ep: Endpoint, card: dict, ctx: dict) -> dict:
    p3 = {"prose_no_think": ep.stream(ctx["prose"], 1400, NO_THINK), "code_no_think": ep.stream(ctx["code"], 2200, NO_THINK)}
    p3["long_context_no_think"] = ep.stream(ctx["long_messages"], 300, NO_THINK, timeout=1200)
    return p3


def probe_p4(ep: Endpoint, card: dict, ctx: dict) -> dict:
    return {"repeat_same_long_prompt": ep.stream(ctx["long_messages"], 300, NO_THINK, timeout=1200)}


def probe_p5(ep: Endpoint, card: dict, ctx: dict) -> dict:
    rng = random.Random(7)
    payload_text = "\n".join(
        f'Line {i}: "quoted {rng.randint(0, 9999)}" back\\slash tab\t unicode é中文 {{brace}} [{i}]' for i in range(160))
    tools = [{"type": "function", "function": {"name": "write_file", "description": "Write text to a file.",
              "parameters": {"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
                             "required": ["path", "content"]}}}]
    body = {"model": ep.model, "max_tokens": 12000, "tools": tools, "tool_choice": "auto",
            "messages": [{"role": "user", "content": "Call write_file with path out.txt and content EXACTLY equal to the text "
                          "between <<<BEGIN>>> and <<<END>>> (not including the markers).\n<<<BEGIN>>>" + payload_text + "<<<END>>>"}],
            **NO_THINK}
    result = ep.post("/chat/completions", body, timeout=900)
    p5: dict = {**post_record(result), "payload_bytes": len(payload_text.encode())}
    response = result["json"]
    if isinstance(response, dict) and response.get("choices"):
        choice = response["choices"][0]
        calls = (choice.get("message") or {}).get("tool_calls") or []
        p5["finish_reason"] = choice.get("finish_reason")
        p5["tool_calls"] = len(calls)
        if calls:
            try:
                args = json.loads(calls[0]["function"]["arguments"])
                p5["args_parse"] = True
                p5["content_exact"] = args.get("content") == payload_text
                p5["content_len_ratio"] = round(len(args.get("content", "")) / len(payload_text), 4)
            except (ValueError, KeyError, TypeError):
                p5["args_parse"] = False
    return p5


def probe_p6(ep: Endpoint, card: dict, ctx: dict) -> dict:
    running_before = ep.metric("vllm:num_requests_running")
    aborted = ep.stream(ctx["prose"], 4000, {**NO_THINK, "ignore_eos": True}, abort_after=4.0)
    samples = []
    for _ in range(10):
        time.sleep(1)
        samples.append(ep.metric("vllm:num_requests_running"))
    after = ep.stream([{"role": "user", "content": "Reply with the single word: ready"}], 10, NO_THINK)
    return {"running_before": running_before, "abort": aborted, "running_after_abort_1s_steps": samples, "next_request": after}


def run_streams(ep: Endpoint, messages: list, max_tokens: int, k: int) -> Tuple[Dict[str, dict], List[Optional[float]]]:
    results: Dict[str, dict] = {}
    samples: List[Optional[float]] = []
    stop = threading.Event()

    def worker(name: str) -> None:
        results[name] = ep.stream(messages, max_tokens, NO_THINK)

    def sampler() -> None:
        while not stop.is_set():
            samples.append(ep.metric("vllm:num_requests_running"))
            stop.wait(1.0)

    threads = [threading.Thread(target=worker, args=(f"s{i}",)) for i in range(k)]
    monitor = threading.Thread(target=sampler)
    monitor.start()
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    stop.set()
    monitor.join()
    return results, samples


def probe_p7(ep: Endpoint, card: dict, ctx: dict) -> dict:
    single = ep.stream(ctx["prose"], 900, NO_THINK)
    results, _samples = run_streams(ep, ctx["prose"], 900, 2)
    return {"single": single, "concurrent": results}


def probe_p8(ep: Endpoint, card: dict, ctx: dict) -> dict:
    result = ep.post("/chat/completions", {"model": ep.model, "max_tokens": 20000, "ignore_eos": True, **NO_THINK, "messages": ctx["prose"]}, timeout=1500)
    usage = result["json"].get("usage", {}) if isinstance(result["json"], dict) else {}
    return {**post_record(result), "completion_tokens": usage.get("completion_tokens")}


def probe_p9(ep: Endpoint, card: dict, ctx: dict) -> dict:
    limit = ep.max_model_len or 262144
    result = ep.post("/chat/completions", {"model": ep.model, "max_tokens": limit, **NO_THINK, "messages": [{"role": "user", "content": "hello"}]}, timeout=60)
    return {**post_record(result), "requested_max_tokens": limit, "rejected": result["status"] == 400}


def probe_p10(ep: Endpoint, card: dict, ctx: dict) -> dict:
    schemas = ctx["schemas"]
    if not schemas:
        raise ConfigError("P10 needs the role schemas: run pnpm probe:export-schemas first, or --skip P10")
    args = ctx["args"]
    p10_dir = os.path.join(ctx["run_dir"], "p10")
    os.makedirs(p10_dir, mode=0o700, exist_ok=True)
    plan_payload = schemas["payloads"]["plan"]
    # P10-align: the pipeline's own bodies, checked before any request (an older export, or another model, is refused here).
    bodies = p10_bodies(schemas, ep.model)
    out: dict = {"calls_per_cell": args.p10_calls, "strict_requested": args.p10_strict, "reasoning_stripped": args.strip_reasoning,
                 "export_version": schemas.get("version"), "request_settings": schemas.get("requestSettings"),
                 "schemas_protocol_sha256": schemas.get("protocolSha256"), "schema_sha256": {role: sha256_text(canonical_json(schemas["schemas"][role])) for role in P10_ROLES},
                 "binding": {"units": plan_payload["units"], "sourceIds": plan_payload["sourceIds"]}, "acceptance": {}, "cells": {}}
    for role in P10_ROLES:
        schema = schemas["schemas"][role]
        # The acceptance check is unchanged by P10-align: two 16-token requests that pick the response_format variant only.
        messages = [{"role": "system", "content": schemas["systems"][role]}, {"role": "user", "content": schemas["payloads"][role]["userContent"]}]
        acceptance: Dict[str, Dict[str, Any]] = {}
        for strict in (True, False):
            result = ep.post("/chat/completions", {"model": ep.model, "messages": messages, "max_tokens": 16, **NO_THINK,
                                                   "response_format": response_format(role, schema, strict)}, timeout=300)
            acceptance["strict" if strict else "non_strict"] = {**post_record(result), "accepted": result["status"] == 200}
        out["acceptance"][role] = acceptance
        variant = choose_variant(acceptance, args.p10_strict)
        for thinking in P10_MODES:
            # The exported body for this role and mode, with only response_format added; a streamed body is read as events.
            exported = bodies[role][thinking]
            streamed = exported.get("stream") is True
            calls = []
            for ordinal in range(1, args.p10_calls + 1):
                body = p10_request_body(exported, role, schema, variant)
                result = ep.post_stream("/chat/completions", body, timeout=900) if streamed else ep.post("/chat/completions", body, timeout=900)
                record: Dict[str, Any] = {"ordinal": ordinal, **post_record(result), **({"stream_chunks": result["stream_chunks"]} if "stream_chunks" in result else {})}
                content = None
                finish = None
                body_json = result["json"]
                if result["status"] == 200 and isinstance(body_json, dict) and body_json.get("choices"):
                    choice = body_json["choices"][0]
                    message = choice.get("message") or {}
                    content = message.get("content") if isinstance(message.get("content"), str) else None
                    finish = choice.get("finish_reason")
                    usage = body_json.get("usage") or {}
                    record.update({"finish_reason": finish, "prompt_tokens": usage.get("prompt_tokens"), "completion_tokens": usage.get("completion_tokens"),
                                   "reasoning_tokens": (usage.get("completion_tokens_details") or {}).get("reasoning_tokens"),
                                   "reasoning_field": reasoning_field_of(message), "reasoning_bytes": reasoning_bytes_of(message),
                                   "content_bytes": len(content.encode("utf-8")) if content is not None else None,
                                   "content_sha256": sha256_text(content) if content is not None else None, "leading_think_tag": leading_think_tag(content)})
                    file_name = f"{role}-{thinking}-{'strict' if variant else 'nonstrict'}-{ordinal:02d}.json"
                    retained = strip_reasoning_fields(result["raw"]) if args.strip_reasoning else result["raw"]
                    record["reply_file"] = file_name
                    record["body_sha256"] = write_private(os.path.join(p10_dir, file_name), retained)
                record["classification"] = classify_reply(result["status"], finish, content)
                calls.append(record)
            out["cells"][f"{role}/{thinking}"] = {"role": role, "thinking": thinking, "strict": variant, "max_tokens": exported.get("max_tokens"),
                                                 "streamed": streamed, "request_body_sha256": schemas["requests"][role][thinking].get("bodySha256"),
                                                 "calls": calls, "counts": summarize_cell(calls, thinking)}
    return out


def probe_p11(ep: Endpoint, card: dict, ctx: dict) -> dict:
    args = ctx["args"]
    nonce = int(time.time())
    out: dict = {"tokens_per_word_assumed": TOKENS_PER_WORD, "max_model_len": ep.max_model_len, "max_tokens": P11_MAX_TOKENS}
    admitted, refused = plan_p11_sizes(args.p11_sizes, P11_MAX_TOKENS, ep.max_model_len)
    out["sizes_refused"] = [{"target_tokens": size, "reason": "prompt_plus_max_tokens_exceeds_max_model_len"} for size in refused]
    sizes: Dict[str, Any] = {}
    for size in admitted:
        words = words_for_tokens(size)
        document = synthetic_document(words, nonce + size)
        messages = [{"role": "user", "content": document + "\n\nSummarize the document above in about 150 words."}]
        result = ep.stream(messages, P11_MAX_TOKENS, NO_THINK, timeout=1800)
        result.update({"target_tokens": size, "words": words})
        if result.get("prompt_tokens"):
            result["tokens_per_word_observed"] = round(result["prompt_tokens"] / words, 4)
        sizes[str(size)] = result
    out["sizes"] = sizes
    packet = synthetic_packet(nonce)
    chunks = [synthetic_chunk(P11_CHUNK_BYTES, nonce + i) for i in (1, 2)]
    layouts: Dict[str, Any] = {}
    salt_base = sha256_text(f"soar-p11-{card['started_utc']}")
    for layout_name in ("sorted_keys", "stable_prefix"):
        salt = sha256_text(salt_base + layout_name)
        rows = []
        for ordinal, chunk in enumerate(chunks, start=1):
            messages = extraction_layouts(P11_EXTRACT_SYSTEM, packet, chunk)[layout_name]
            result = ep.stream(messages, 64, {**NO_THINK, "cache_salt": salt}, timeout=900)
            rows.append({"request": ordinal, "status": result.get("status", result.get("error")), "prompt_tokens": result.get("prompt_tokens"),
                         "cached_tokens": result.get("cached_tokens"), "ttft_s": result.get("ttft_s"), "total_s": result.get("total_s")})
        layouts[layout_name] = {"requests": rows, "cache_salt_accepted": all(row["status"] == 200 for row in rows),
                                "second_request_cached_tokens": rows[-1]["cached_tokens"] if rows else None}
    out["cache_layouts"] = cache_layouts_record(packet, chunks, layouts)
    k_streams: Dict[str, Any] = {}
    for k in args.p11_ks:
        results, samples = run_streams(ep, ctx["prose"], 900, k)
        k_streams[str(k)] = aggregate_streams(list(results.values()), samples)
    out["k_streams"] = k_streams
    return out


def probe_adapter(ep: Endpoint, card: dict, ctx: dict) -> dict:
    out: dict = {}
    status, text = ep.get("/openapi.json", at_origin=True, timeout=20)
    openapi: Dict[str, Any] = {"status": status}
    if status == 200:
        openapi["schema_sha256"] = sha256_text(text)
        try:
            schema = json.loads(text)
        except ValueError:
            schema = {}
        openapi["version"] = (schema.get("info") or {}).get("version")
        openapi["tokenize_route"] = "/tokenize" in (schema.get("paths") or {})
        properties = ((((schema.get("components") or {}).get("schemas") or {}).get("ChatCompletionRequest") or {}).get("properties") or {})
        openapi["chat_request_fields"] = {name: name in properties for name in ("response_format", "chat_template_kwargs", "cache_salt")}
    out["openapi"] = openapi
    short = [{"role": "user", "content": "Reply with the single word: ready"}]
    tokenize = ep.post("/tokenize", {"model": ep.model, "messages": short, "chat_template_kwargs": {"enable_thinking": False}}, timeout=30, at_origin=True)
    count = tokenize["json"].get("count") if isinstance(tokenize["json"], dict) else None
    chat = ep.post("/chat/completions", {"model": ep.model, "messages": short, "max_tokens": 4, **NO_THINK}, timeout=120)
    prompt_tokens = (chat["json"].get("usage") or {}).get("prompt_tokens") if isinstance(chat["json"], dict) else None
    out["tokenize"] = {**post_record(tokenize), "count": count, "chat_status": chat["status"], "usage_prompt_tokens": prompt_tokens,
                       "parity": count is not None and prompt_tokens is not None and count == prompt_tokens}
    on_kwargs = {"chat_template_kwargs": {"enable_thinking": True, "preserve_thinking": False}, "reasoning_effort": "medium", **THINK_SAMPLING}
    off_kwargs = {"chat_template_kwargs": {"enable_thinking": False, "preserve_thinking": False},
                  **{key: value for key, value in NO_THINK.items() if key != "chat_template_kwargs"}}
    puzzle = ctx["puzzle"]
    out["thinking_on_json"] = inspect_json_reply(ep.post("/chat/completions", {"model": ep.model, "messages": puzzle, "max_tokens": 1200, **on_kwargs}, timeout=600), ep.model)
    out["thinking_on_sse"] = inspect_sse(ep.stream(puzzle, 1200, on_kwargs, timeout=600, keep_content=True))
    out["thinking_off_json"] = inspect_json_reply(ep.post("/chat/completions", {"model": ep.model, "messages": puzzle, "max_tokens": 400, **off_kwargs}, timeout=600), ep.model)
    out["thinking_off_sse"] = inspect_sse(ep.stream(puzzle, 400, off_kwargs, timeout=600, keep_content=True))
    out["preserve_thinking"] = {"accepted": out["thinking_on_json"].get("status") == 200 and out["thinking_off_json"].get("status") == 200}
    salted = ep.post("/chat/completions", {"model": ep.model, "messages": short, "max_tokens": 4, **NO_THINK, "cache_salt": sha256_text("soar-adapter-probe")}, timeout=120)
    out["cache_salt"] = {**post_record(salted), "accepted": salted["status"] == 200}
    out["verdict"] = adapter_verdict(out)
    return out


PROBE_FUNCTIONS = {"P1": probe_p1, "P2": probe_p2, "P3": probe_p3, "P4": probe_p4, "P5": probe_p5, "P6": probe_p6, "P7": probe_p7,
                   "P8": probe_p8, "P9": probe_p9, "P10": probe_p10, "P11": probe_p11, "adapter": probe_adapter}


# --- driver ----------------------------------------------------------------------------------------------------


def parse_args(argv: Optional[Sequence[str]]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="SOAR serving probe (zero API fee, synthetic prompts only)")
    parser.add_argument("--only", default=None, help="comma-separated probes to run, e.g. P1,P10,adapter")
    parser.add_argument("--skip", default=None, help="comma-separated probes to skip, e.g. P8,P11")
    parser.add_argument("--skip-p8", action="store_true", help="alias of --skip P8")
    parser.add_argument("--schemas", default=os.path.join(ROOT, ".soar", "experiments", "role-schemas.json"),
                        help="role schemas written by pnpm probe:export-schemas (P10 and the derived-bounds table)")
    parser.add_argument("--env-file", default=None, help="env file read after the environment (default: the repository's .env.local)")
    parser.add_argument("--p10-calls", type=int, default=P10_CALLS, help="calls per P10 cell (role x thinking); default 20")
    parser.add_argument("--p10-strict", choices=("true", "false"), default="true", help="response_format variant for the P10 cells; default true")
    parser.add_argument("--strip-reasoning", action="store_true", help="drop reasoning fields from the retained P10 reply bodies")
    parser.add_argument("--p11-sizes", default=",".join(str(size) for size in P11_SIZES), help="P11 prompt sizes in tokens")
    parser.add_argument("--p11-ks", default=",".join(str(k) for k in P11_KS), help="P11 stream counts")
    args = parser.parse_args(list(argv) if argv is not None else None)
    args.p10_strict = args.p10_strict == "true"
    args.p11_sizes = parse_int_list(args.p11_sizes, "--p11-sizes")
    args.p11_ks = parse_int_list(args.p11_ks, "--p11-ks")
    if args.p10_calls <= 0:
        parser.error("--p10-calls must be positive")
    if args.skip_p8:
        args.skip = f"{args.skip},P8" if args.skip else "P8"
    return args


def load_role_schemas(path: str) -> Optional[Dict[str, Any]]:
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as handle:
        schemas = json.load(handle)
    for key in ("schemas", "systems", "payloads", "outputTokens"):
        if key not in schemas:
            raise ConfigError(f"role schemas file lacks {key}; rerun pnpm probe:export-schemas")
    return schemas


def save_card(card: dict, path: str) -> None:
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(card, handle, indent=1)
    os.replace(temporary, path)


def main(argv: Optional[Sequence[str]] = None) -> int:
    try:
        args = parse_args(argv)
        selected = select_probes(args.only, args.skip)
        env_file = args.env_file if args.env_file is not None else os.path.join(ROOT, ".env.local")
        config = load_config(dict(os.environ), env_file)
        issue = endpoint_policy_issue(config["base"], config["cost_policy"], config["allow_insecure"])
        if issue:
            raise ConfigError(issue)
        schemas = load_role_schemas(args.schemas)
        if "P10" in selected and schemas is None:
            raise ConfigError("P10 needs the role schemas: run pnpm probe:export-schemas first, or pass --skip P10")
        if "P10" in selected:
            # P10-align: an export without the pipeline's bodies, or with another model than the configured one, is refused before any request.
            p10_bodies(schemas, config["model"])
    except (ConfigError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 2
    ep = Endpoint(config)
    started = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    run_id = f"serving-probe-{started.replace(':', '')}"
    run_dir = os.path.join(ROOT, ".soar", "experiments", run_id)
    os.makedirs(run_dir, mode=0o700, exist_ok=True)
    out_path = os.path.join(run_dir, "probe.json")
    card: dict = {"probe_version": PROBE_VERSION, "started_utc": started, "run_id": run_id, "transport_class": transport_class(config["base"]),
                  "cost_policy": config["cost_policy"], "api_key_configured": bool(config["key"]), "probes_selected": selected, "probes_run": [],
                  "probes_skipped": [name for name in PROBES if name not in selected], "probes_failed": {}}
    if schemas:
        card["roles"] = {"output_tokens": schemas.get("outputTokens"), "thinking": schemas.get("thinking"), "protocol_sha256": schemas.get("protocolSha256")}
    ep.ensure_model()
    card["model_source"] = ep.model_source
    card["load_before"] = {"running": ep.metric("vllm:num_requests_running"), "waiting": ep.metric("vllm:num_requests_waiting")}
    spec_draft0, spec_acc0 = ep.metric("vllm:spec_decode_num_draft_tokens_total"), ep.metric("vllm:spec_decode_num_accepted_tokens_total")
    nonce = int(time.time())
    long_document = synthetic_document(38000, nonce)
    ctx = {"args": args, "schemas": schemas, "run_dir": run_dir,
           "puzzle": [{"role": "user", "content": "Find all integer pairs (x, y) with x^2 - y^2 = 45. List them and stop."}],
           "prose": [{"role": "user", "content": "Write an original, detailed essay of about 900 words on the history of "
                      "lighthouses and their keepers. Plain prose paragraphs, no lists, no headings."}],
           "code": [{"role": "user", "content": "Write a complete Python module implementing a thread-safe LRU cache with "
                     "per-entry TTL, plus a unittest test class with at least eight tests. Output only code."}],
           "long_messages": [{"role": "user", "content": long_document + "\n\nSummarize the document above in about 150 words."}]}
    for name in PROBES:
        if name not in selected:
            continue
        try:
            card[name] = PROBE_FUNCTIONS[name](ep, card, ctx)
            card["probes_run"].append(name)
            print(name, json.dumps(card[name]), flush=True)
        except Exception as error:  # a failed probe is recorded by exception type only and the run continues
            card["probes_failed"][name] = type(error).__name__
            print(name, json.dumps({"failed": type(error).__name__}), flush=True)
        save_card(card, out_path)
    spec_draft1, spec_acc1 = ep.metric("vllm:spec_decode_num_draft_tokens_total"), ep.metric("vllm:spec_decode_num_accepted_tokens_total")
    if None not in (spec_draft0, spec_acc0, spec_draft1, spec_acc1) and spec_draft1 > spec_draft0:
        card["spec_decode_acceptance_during_probe"] = round((spec_acc1 - spec_acc0) / (spec_draft1 - spec_draft0), 3)
    card["load_after"] = {"running": ep.metric("vllm:num_requests_running"), "waiting": ep.metric("vllm:num_requests_waiting")}
    card["finished_utc"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    save_card(card, out_path)
    print("saved", run_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())
