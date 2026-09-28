# Serving card: owner's inference endpoint, 2026-09-28

**Source:** `scripts/serving-probe.py`, run from the Mac on 2026-09-28 (UTC). All
prompts were synthetic, and the API fee was zero. The endpoint address and any
credentials stay in ignored local configuration. The full JSON result is under
the ignored `.soar/experiments/`.

These are one-shot measurements on a shared server whose external load is
unexplained (see the build log). Treat them as orders of magnitude, not
benchmarks.

## Identity (P1)

| Item | Observed |
| --- | --- |
| Engine | vLLM 0.30.0 (0.28.0 was recorded earlier in September) |
| Served alias | `RM-01 VLM` (RMinte RM-01 appliance naming) |
| Model directory | `Qwen3.8-27B` under an `rm01` home directory; precision not verified |
| Context limit | 262,144 tokens |
| Authentication | **None required**. `/v1/models`, `/version` and `/metrics` answer without a key. CORS allows any origin. |
| Transport | Plain HTTP on a public internet address |
| Speculative decoding | Active: 73% of drafted tokens accepted (server lifetime counters) |

## Behaviour

| Probe | Result |
| --- | --- |
| **P2** thinking effort | `chat_template_kwargs.reasoning_effort` low, medium and xhigh change the rendered prompt. A top-level `reasoning_effort: "medium"` (what SOAR sends) renders identically to the kwargs `medium`. Thinking-on requests used 520-850 reasoning tokens on a small puzzle. Effort has no monotone effect at n = 1 on an easy task. |
| **P3** decode, single stream | Prose without thinking about **35 tokens/s**. Code without thinking about **58 tokens/s**. Thinking text **56-67 tokens/s**. First token about 0.12-0.14 s on short prompts. |
| **P3** long context | A 47,299-token fresh prompt took 26.4 s to first token (prefill about **1,790 tokens/s**), then decoded at about 35 tokens/s. |
| **P4** prefix cache | Repeating the same 47K prompt reused **44,800 cached tokens**, with first token in **1.85 s**. |
| **P5** tool-call integrity | An 11,124-byte argument full of escaped quotes, backslashes, tabs and CJK came back through a native tool call **byte-exact**, in 79.7 s. |
| **P6** abort | Aborting a stream left **no running generation**, and the next request's first token arrived in 0.12 s. |
| **P7** concurrency | Two concurrent prose streams each held about 35 tokens/s (about 70 aggregate), matching a single stream. |
| **P8** long non-streaming request | A 20,000-token non-streaming request (with `ignore_eos`) got **no response**. The remote end closed the connection at **947 s**. There is no 300 s cutoff, but requests near 15 minutes are cut. |
| **P9** context guard | Prompt plus `max_tokens` above 262,144 returns a clean **400 in 0.04 s**. |

## Consequences for the plan

- **Throughput is not the blocker it was feared to be.** Prose runs at about
  35 tokens/s and thinking at about 60, far above the 8-18 tokens/s community
  estimates for plain FP8 on this memory-bandwidth class. Speculative decoding
  explains the difference.
- **Long outputs must stream.** A long non-streaming request is cut at about
  15 minutes, so Phase 1 PR-B (streaming with an inactivity and absolute
  deadline) is required before hour-scale jobs.
- **Agentic loops benefit from prefix caching.** Prompts must stay byte-stable to
  keep the cache hitting.
- **The endpoint is open to the internet with no authentication.** Until the owner
  adds a key and restricts network access (or tunnels the endpoint), it may carry
  only public or synthetic data. Tier O stays blocked regardless.
