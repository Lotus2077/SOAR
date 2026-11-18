# Serving card: owner's inference endpoint, 2026-11-18

**Source:** `scripts/serving-probe.py` (probe version 2), run from the Mac on 2026-11-18 (UTC), written by `scripts/serving-card.py`. Probes run: P1, P2, P3, P4, P5, P6, P7, P8, P9, P10, P11, adapter. Skipped: none. Failed before recording a result: none. All prompts were synthetic, and the API fee was zero. The endpoint address and any credentials stay in ignored local configuration. The full JSON result and the retained replies are under the ignored `.soar/experiments/`.

These are one-shot measurements on a server whose other load is recorded in the Identity table (running and waiting requests before and after the probe) and per K burst in P11. Treat them as orders of magnitude, not benchmarks.

## Identity (P1)

| Item | Observed |
| --- | --- |
| Engine | vLLM 0.33.0rc1.dev617+g821038729 |
| Served alias | `RM-01 VLM` |
| Model root (basename) | `Qwen3.8-Flash-Next-NVFP4` |
| Context limit | 262,144 tokens |
| Authentication | none required: `/v1/models` answered without a key |
| Transport | plain HTTP to a non-loopback address (operator-acknowledged) |
| Speculative decoding | active: 60% of drafted tokens accepted during the probe |
| Server load (other requests) | running/waiting before 0/0, after 0/0 |
| Consistent with the 2026-11-04 qualification: model root | yes (`Qwen3.8-Flash-Next-NVFP4`) |
| Consistent with the 2026-11-04 qualification: engine version | yes (`0.33.0rc1.dev617+g821038729`) |
| Consistent with the 2026-11-04 qualification: context | yes (`262144`) |

Consistency with the 2026-11-04 qualification means the observed value equals the qualified one. It shows a difference or its absence and cannot prove identical weights (review section 5.10, item 1); the owner's confirmation stays required.

## Behaviour

| Probe | Result |
| --- | --- |
| **P2** thinking effort | kwargs_low: prompt 67, completion 780, reasoning 659, first token 0.14 s, prefill about 464 tok/s, decode 129.3 tok/s, finish stop; kwargs_medium: prompt 37, completion 1,058, reasoning 639, first token 0.16 s, prefill about 237 tok/s, decode 142.6 tok/s, finish stop; kwargs_xhigh: prompt 79, completion 941, reasoning 858, first token 0.15 s, prefill about 540 tok/s, decode 113.3 tok/s, finish stop; toplevel_medium_as_SOAR_sends: prompt 37, completion 1,099, reasoning 645, first token 0.10 s, prefill about 376 tok/s, decode 140.9 tok/s, finish stop; thinking_disabled: prompt 39, completion 1,466, reasoning 0, first token 0.17 s, prefill about 235 tok/s, decode 146.0 tok/s, finish stop |
| **P3** decode, single stream | prose without thinking: prompt 47, completion 1,165, first token 0.10 s, prefill about 470 tok/s, decode 85.2 tok/s, finish stop; code without thinking: prompt 44, completion 1,609, first token 0.10 s, prefill about 447 tok/s, decode 141.5 tok/s, finish stop |
| **P3** long context | prompt 47,268, completion 282, first token 13.16 s, prefill about 3,592 tok/s, decode 103.5 tok/s, finish stop |
| **P4** prefix cache | repeating the same long prompt reused 44,800 cached tokens, first token 0.87 s |
| **P5** tool-call integrity | status 200, 31.9 s; payload 11,124 bytes; tool calls 1; arguments parsed yes; content byte-exact yes; length ratio 1 |
| **P6** abort | running before 0; aborted after 4.1 s; running after the abort (1 s steps) max 0; next request first token 0.11 s |
| **P7** concurrency | single stream decode 81.3 tok/s; two concurrent streams 72.3, 71.5 tok/s |
| **P8** long non-streaming request | status 200, 136.6 s; completion tokens 20,000 |
| **P9** context guard | max_tokens 262,144 requested: status 200, 0.2 s; rejected with 400 no |
| **P10** `response_format` acceptance, plan | strict: accepted (status 200); non-strict: accepted (status 200) |
| **P10** `response_format` acceptance, extract | strict: accepted (status 200); non-strict: accepted (status 200) |
| **P10** `response_format` acceptance, synthesis | strict: accepted (status 200); non-strict: accepted (status 200) |
| **P10** structured output, plan/on | valid 20/20 (100%); truncated 0; schema invalid 0; binding invalid 0; invalid JSON 0; request rejected 0; variant strict; max_tokens 16,384; median 27.6 s, max 108.5 s; thinking-on replies with zero reasoning tokens 0; against the 95% rule (strict variant): meets |
| **P10** structured output, plan/off | valid 20/20 (100%); truncated 0; schema invalid 0; binding invalid 0; invalid JSON 0; request rejected 0; variant strict; max_tokens 16,384; median 4.3 s, max 5.8 s; against the 95% rule (strict variant): meets |
| **P10** structured output, extract/on | valid 19/20 (95%); truncated 1; schema invalid 0; binding invalid 0; invalid JSON 0; request rejected 0; variant strict; max_tokens 2,048; median 8.3 s, max 23.8 s; thinking-on replies with zero reasoning tokens 0; against the 95% rule (strict variant): meets |
| **P10** structured output, extract/off | valid 20/20 (100%); truncated 0; schema invalid 0; binding invalid 0; invalid JSON 0; request rejected 0; variant strict; max_tokens 2,048; median 1.6 s, max 2.4 s; against the 95% rule (strict variant): meets |
| **P10** structured output, synthesis/on | valid 17/20 (85%); truncated 3; schema invalid 0; binding invalid 0; invalid JSON 0; request rejected 0; variant strict; max_tokens 16,384; median 17.6 s, max 110.8 s; thinking-on replies with zero reasoning tokens 0; against the 95% rule (strict variant): does not meet |
| **P10** structured output, synthesis/off | valid 20/20 (100%); truncated 0; schema invalid 0; binding invalid 0; invalid JSON 0; request rejected 0; variant strict; max_tokens 16,384; median 5.3 s, max 18.4 s; against the 95% rule (strict variant): meets |
| **P11** prefill and decode by prompt size | 20,000 target (20,103 observed): prompt 20,103, completion 267, first token 5.85 s, prefill about 3,439 tok/s, decode 105.8 tok/s, finish stop; 60,000 target (60,027 observed): prompt 60,027, completion 182, first token 16.85 s, prefill about 3,563 tok/s, decode 89.3 tok/s, finish stop; 120,000 target (120,002 observed): prompt 120,002, completion 194, first token 34.26 s, prefill about 3,503 tok/s, decode 90.3 tok/s, finish stop |
| **P11** cache reuse per extraction layout | sorted_keys: second request reused 0 of 14,319 prompt tokens, first token 4.03 s; cache_salt accepted yes; stable_prefix: second request reused 0 of 14,321 prompt tokens, first token 4.06 s; cache_salt accepted yes |
| **P11** K concurrent streams | K=1: aggregate 84.7 tok/s, median per stream 85.4 tok/s, max first token 0.10 s, errors 0, running max during the burst 1; K=2: aggregate 136.1 tok/s, median per stream 71.3 tok/s, max first token 0.30 s, errors 0, running max during the burst 2; K=4: aggregate 152.6 tok/s, median per stream 38.8 tok/s, max first token 0.30 s, errors 0, running max during the burst 4; K=8: aggregate 295.1 tok/s, median per stream 37.6 tok/s, max first token 0.30 s, errors 0, running max during the burst 8 |
| **Adapter** `/openapi.json` | status 200; served version `0.1.0`; `/tokenize` route yes; `response_format` in ChatCompletionRequest yes; `chat_template_kwargs` in ChatCompletionRequest yes; `cache_salt` in ChatCompletionRequest yes |
| **Adapter** `/tokenize` parity | status 200; count 19 against usage.prompt_tokens 19: parity yes |
| **Adapter** reasoning field (thinking on) | JSON: `reasoning`, 534 reasoning tokens, model in reply yes; SSE: `reasoning`, model in 311 chunks (0 mismatched); leading `<think>` tag no |
| **Adapter** thinking off | reasoning bytes leaked JSON 0, SSE 0; leading `<think>` tag no; `preserve_thinking` accepted yes; `cache_salt` accepted yes |
| **Adapter** reply contract | consistent with the legacy shape: yes; consistent with `flash_next_v1`: yes (consistency of a few synthetic replies; the contract itself is not established by this probe) |

## Stage bounds derived from this card (proposals for the E0 card)

| Role | Output cap (tokens) | Prompt size assumed (tokens) | Prefill at that size (s) | Decode (tok/s, thinking off) | Ceiling under the 300 s clock (tokens) | Ceiling under the 900 s clock (tokens) |
| --- | --- | --- | --- | --- | --- | --- |
| index | 1,536 | 20,000 | 5.8 | 105.8 | 31,130 (within the cap) | 94,628 (within the cap) |
| plan | 16,384 | 60,000 | 16.8 | 89.3 | 25,285 (within the cap) | 78,865 (within the cap) |
| extract | 2,048 | 20,000 | 5.8 | 105.8 | 31,130 (within the cap) | 94,628 (within the cap) |
| synthesis | 16,384 | 60,000 | 16.8 | 89.3 | 25,285 (within the cap) | 78,865 (within the cap) |

Ceiling = (clock - prefill at the assumed prompt size) x thinking-off decode, with the app's two request clocks (300 s standard, 900 s heavy). Thinking-on replies also spend reasoning tokens (P2, P10), so a thinking-on role needs its reasoning budget under the same ceiling. Output caps come from the role export that the probe read; every bound here is a proposal for the E0 card, not a decision.

## Consequences for the plan

_Left to the author: write the consequences after reviewing the tables above._
