#!/usr/bin/env python3
"""SOAR serving probe: measure the local inference endpoint (zero API fee).

Reads SOAR_VLLM_BASE_URL (and optional SOAR_VLLM_API_KEY, SOAR_VLLM_MODEL) from the
environment or from the repository's ignored .env.local. Never prints the endpoint
or key. Writes the full JSON result under .soar/experiments/ (ignored) and prints a
summary without addresses.

    python3 scripts/serving-probe.py            # all probes (P8 takes 5-10 minutes)
    python3 scripts/serving-probe.py --skip-p8  # skip the long non-streaming probe

Probes (docs/PLAN.md Phase 0 step 4):
  P1 identity   P2 effort honoured   P3 decode/prefill by workload
  P4 prefix cache   P5 escaped tool-argument integrity   P6 abort then next request
  P7 one vs two streams   P8 non-streaming request over 300 s   P9 context guard
All prompts are synthetic. Never send personal or professional data through this.
"""

from __future__ import annotations

import datetime
import json
import os
import random
import re
import sys
import threading
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NO_THINK = {"chat_template_kwargs": {"enable_thinking": False}, "temperature": 0.7, "top_p": 0.8, "top_k": 20,
            "presence_penalty": 1.5}
THINK_SAMPLING = {"temperature": 1.0, "top_p": 0.95, "top_k": 20}


def load_config() -> tuple[str, str | None, str | None]:
    env = dict(os.environ)
    path = os.path.join(ROOT, ".env.local")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            match = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
            if match and match.group(1) not in env:
                env[match.group(1)] = match.group(2).strip().strip('"').strip("'")
    base = env.get("SOAR_VLLM_BASE_URL", "").rstrip("/")
    if not base:
        sys.exit("SOAR_VLLM_BASE_URL is not set (environment or .env.local).")
    return base, env.get("SOAR_VLLM_API_KEY") or None, env.get("SOAR_VLLM_MODEL") or None


BASE, KEY, MODEL = load_config()
HEADERS = {"Content-Type": "application/json", **({"Authorization": f"Bearer {KEY}"} if KEY else {})}


def get(path: str, timeout: float = 15) -> tuple[int, str]:
    request = urllib.request.Request(BASE.rsplit("/v1", 1)[0] + path if path.startswith("/metrics") or path.startswith("/version")
                                     else BASE + path, headers=HEADERS)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")[:500]


def metric(name: str) -> float | None:
    status, text = get("/metrics")
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


def post(body: dict, timeout: float) -> tuple[int, dict | str, float]:
    started = time.monotonic()
    request = urllib.request.Request(BASE + "/chat/completions", data=json.dumps(body).encode(), headers=HEADERS)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read()), time.monotonic() - started
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")[:400], time.monotonic() - started
    except Exception as error:  # timeouts, resets
        return -1, f"{type(error).__name__}: {str(error)[:200]}", time.monotonic() - started


def stream(messages: list, max_tokens: int, extra: dict, timeout: float = 900, abort_after: float | None = None) -> dict:
    body = {"model": MODEL, "messages": messages, "max_tokens": max_tokens, "stream": True,
            "stream_options": {"include_usage": True}, **extra}
    request = urllib.request.Request(BASE + "/chat/completions", data=json.dumps(body).encode(), headers=HEADERS)
    started = time.monotonic()
    first = last = None
    usage: dict = {}
    content_chars = reasoning_chars = 0
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
                usage = obj.get("usage") or usage
                for choice in obj.get("choices", []):
                    delta = choice.get("delta", {})
                    text = delta.get("content") or ""
                    reasoning = delta.get("reasoning_content") or delta.get("reasoning") or ""
                    if text or reasoning:
                        now = time.monotonic()
                        first = first or now
                        last = now
                        content_chars += len(text)
                        reasoning_chars += len(reasoning)
                    finish = choice.get("finish_reason") or finish
    except urllib.error.HTTPError as error:
        return {"error": error.code, "detail": error.read().decode("utf-8", "replace")[:300]}
    except Exception as error:
        return {"error": type(error).__name__, "detail": str(error)[:200], "elapsed_s": round(time.monotonic() - started, 2)}
    completion = usage.get("completion_tokens") or 0
    prompt = usage.get("prompt_tokens") or 0
    ttft = (first - started) if first else None
    decode = (completion - 1) / (last - first) if first and last and last > first and completion > 1 else None
    details = usage.get("prompt_tokens_details") or {}
    comp_details = usage.get("completion_tokens_details") or {}
    return {"prompt_tokens": prompt, "completion_tokens": completion, "cached_tokens": details.get("cached_tokens"),
            "reasoning_tokens": comp_details.get("reasoning_tokens"), "reasoning_chars": reasoning_chars,
            "content_chars": content_chars, "ttft_s": round(ttft, 3) if ttft else None,
            "decode_tok_s": round(decode, 2) if decode else None,
            "prefill_tok_s_est": round(prompt / ttft, 1) if ttft and prompt else None,
            "total_s": round(time.monotonic() - started, 2), "finish_reason": finish}


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


def main() -> int:
    skip_p8 = "--skip-p8" in sys.argv
    card: dict = {"probe_version": 1, "started_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")}
    status, text = get("/models")
    models = json.loads(text).get("data", []) if status == 200 else []
    global MODEL
    MODEL = MODEL or (models[0]["id"] if models else None)
    card["P1"] = {"models_status": status, "auth_required": status in (401, 403),
                  "models": [{"id": m.get("id"), "root_basename": os.path.basename(str(m.get("root", "")).rstrip("/")),
                              "max_model_len": m.get("max_model_len")} for m in models]}
    status, text = get("/version")
    card["P1"]["version"] = json.loads(text).get("version") if status == 200 else status
    card["load_before"] = {"running": metric("vllm:num_requests_running"), "waiting": metric("vllm:num_requests_waiting")}
    spec_draft0, spec_acc0 = metric("vllm:spec_decode_num_draft_tokens_total"), metric("vllm:spec_decode_num_accepted_tokens_total")
    print("P1", json.dumps(card["P1"]), flush=True)

    puzzle = [{"role": "user", "content": "Find all integer pairs (x, y) with x^2 - y^2 = 45. List them and stop."}]
    card["P2"] = {}
    for label, extra in (("kwargs_low", {"chat_template_kwargs": {"reasoning_effort": "low"}}),
                         ("kwargs_medium", {"chat_template_kwargs": {"reasoning_effort": "medium"}}),
                         ("kwargs_xhigh", {"chat_template_kwargs": {"reasoning_effort": "xhigh"}}),
                         ("toplevel_medium_as_SOAR_sends", {"reasoning_effort": "medium"}),
                         ("thinking_disabled", {"chat_template_kwargs": {"enable_thinking": False}})):
        result = stream(puzzle, 8000, {**THINK_SAMPLING, **extra}, timeout=600)
        card["P2"][label] = result
        print("P2", label, json.dumps(result), flush=True)

    prose = [{"role": "user", "content": "Write an original, detailed essay of about 900 words on the history of "
              "lighthouses and their keepers. Plain prose paragraphs, no lists, no headings."}]
    code = [{"role": "user", "content": "Write a complete Python module implementing a thread-safe LRU cache with "
             "per-entry TTL, plus a unittest test class with at least eight tests. Output only code."}]
    card["P3"] = {"prose_no_think": stream(prose, 1400, NO_THINK), "code_no_think": stream(code, 2200, NO_THINK)}
    nonce = int(time.time())
    long_doc = synthetic_document(38000, nonce)
    long_messages = [{"role": "user", "content": long_doc + "\n\nSummarize the document above in about 150 words."}]
    card["P3"]["long_context_no_think"] = stream(long_messages, 300, NO_THINK, timeout=1200)
    print("P3", json.dumps(card["P3"]), flush=True)

    card["P4"] = {"repeat_same_long_prompt": stream(long_messages, 300, NO_THINK, timeout=1200)}
    print("P4", json.dumps(card["P4"]), flush=True)

    rng = random.Random(7)
    payload_text = "\n".join(
        f'Line {i}: "quoted {rng.randint(0, 9999)}" back\\slash tab\t unicode é中文 {{brace}} [{i}]' for i in range(160))
    tools = [{"type": "function", "function": {"name": "write_file", "description": "Write text to a file.",
              "parameters": {"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
                             "required": ["path", "content"]}}}]
    body = {"model": MODEL, "max_tokens": 12000, "tools": tools, "tool_choice": "auto",
            "messages": [{"role": "user", "content": "Call write_file with path out.txt and content EXACTLY equal to the text "
                          "between <<<BEGIN>>> and <<<END>>> (not including the markers).\n<<<BEGIN>>>" + payload_text + "<<<END>>>"}],
            **NO_THINK}
    status, response, elapsed = post(body, timeout=900)
    p5: dict = {"status": status, "elapsed_s": round(elapsed, 1), "payload_bytes": len(payload_text.encode())}
    if isinstance(response, dict):
        choice = response["choices"][0]
        calls = choice["message"].get("tool_calls") or []
        p5["finish_reason"] = choice.get("finish_reason")
        p5["tool_calls"] = len(calls)
        if calls:
            try:
                args = json.loads(calls[0]["function"]["arguments"])
                p5["args_parse"] = True
                p5["content_exact"] = args.get("content") == payload_text
                p5["content_len_ratio"] = round(len(args.get("content", "")) / len(payload_text), 4)
            except ValueError:
                p5["args_parse"] = False
    else:
        p5["detail"] = response
    card["P5"] = p5
    print("P5", json.dumps(p5), flush=True)

    running_before = metric("vllm:num_requests_running")
    aborted = stream(prose, 4000, {**NO_THINK, "ignore_eos": True}, abort_after=4.0)
    samples = []
    for _ in range(10):
        time.sleep(1)
        samples.append(metric("vllm:num_requests_running"))
    after = stream([{"role": "user", "content": "Reply with the single word: ready"}], 10, NO_THINK)
    card["P6"] = {"running_before": running_before, "abort": aborted, "running_after_abort_1s_steps": samples,
                  "next_request": after}
    print("P6", json.dumps(card["P6"]), flush=True)

    results: dict = {}

    def worker(name: str) -> None:
        results[name] = stream(prose, 900, NO_THINK)

    single = stream(prose, 900, NO_THINK)
    threads = [threading.Thread(target=worker, args=(f"s{i}",)) for i in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    card["P7"] = {"single": single, "concurrent": results}
    print("P7", json.dumps(card["P7"]), flush=True)

    status, response, elapsed = post({"model": MODEL, "max_tokens": 262144, **NO_THINK,
                                      "messages": [{"role": "user", "content": "hello"}]}, timeout=60)
    card["P9"] = {"status": status, "elapsed_s": round(elapsed, 2),
                  "detail": response if isinstance(response, str) else "unexpected success"}
    print("P9", json.dumps(card["P9"]), flush=True)

    if not skip_p8:
        status, response, elapsed = post({"model": MODEL, "max_tokens": 20000, "ignore_eos": True, **NO_THINK,
                                          "messages": prose}, timeout=1500)
        usage = response.get("usage", {}) if isinstance(response, dict) else {}
        card["P8"] = {"status": status, "elapsed_s": round(elapsed, 1), "completion_tokens": usage.get("completion_tokens"),
                      "detail": None if isinstance(response, dict) else response}
        print("P8", json.dumps(card["P8"]), flush=True)

    spec_draft1, spec_acc1 = metric("vllm:spec_decode_num_draft_tokens_total"), metric("vllm:spec_decode_num_accepted_tokens_total")
    if None not in (spec_draft0, spec_acc0, spec_draft1, spec_acc1) and spec_draft1 > spec_draft0:
        card["spec_decode_acceptance_during_probe"] = round((spec_acc1 - spec_acc0) / (spec_draft1 - spec_draft0), 3)
    card["load_after"] = {"running": metric("vllm:num_requests_running"), "waiting": metric("vllm:num_requests_waiting")}
    card["finished_utc"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    out_dir = os.path.join(ROOT, ".soar", "experiments")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"serving-card-{card['started_utc'].replace(':', '')}.json")
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(card, handle, indent=1)
    print("saved", os.path.relpath(out_path, ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
