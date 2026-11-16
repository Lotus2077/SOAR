# Serving card: owner's inference endpoint, 2026-11-16

**Source:** `scripts/serving-probe.py` (probe version 2), run from the Mac on 2026-11-16 (UTC), written by `scripts/serving-card.py`. Probes run: P1, P2, P3, P4, P5, P6, P7, P8, P9, P10, P11, adapter. Skipped: none. Failed before recording a result: none. All prompts were synthetic, and the API fee was zero. The endpoint address and any credentials stay in ignored local configuration. The full JSON result and the retained replies are under the ignored `.soar/experiments/`.

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
| Speculative decoding | active: 54% of drafted tokens accepted during the probe |
| Server load (other requests) | running/waiting before 0/0, after 0/0 |
| Consistent with the 2026-11-04 qualification: model root | yes (`Qwen3.8-Flash-Next-NVFP4`) |
| Consistent with the 2026-11-04 qualification: engine version | yes (`0.33.0rc1.dev617+g821038729`) |
| Consistent with the 2026-11-04 qualification: context | yes (`262144`) |

Consistency with the 2026-11-04 qualification means the observed value equals the qualified one. It shows a difference or its absence and cannot prove identical weights (review section 5.10, item 1); the owner's confirmation stays required.

## Behaviour

| Probe | Result |
| --- | --- |
| **P2** thinking effort | kwargs_low: prompt 67, completion 1,120, reasoning 834, first token 0.15 s, prefill about 459 tok/s, decode 143.6 tok/s, finish stop; kwargs_medium: prompt 37, completion 1,283, reasoning 760, first token 0.10 s, prefill about 359 tok/s, decode 144.1 tok/s, finish stop; kwargs_xhigh: prompt 79, completion 916, reasoning 833, first token 0.14 s, prefill about 558 tok/s, decode 121.1 tok/s, finish stop; toplevel_medium_as_SOAR_sends: prompt 37, completion 1,187, reasoning 770, first token 0.10 s, prefill about 387 tok/s, decode 141.4 tok/s, finish stop; thinking_disabled: prompt 39, completion 1,451, reasoning 0, first token 0.18 s, prefill about 214 tok/s, decode 144.5 tok/s, finish stop |
| **P3** decode, single stream | prose without thinking: prompt 47, completion 1,169, first token 0.10 s, prefill about 483 tok/s, decode 83.2 tok/s, finish stop; code without thinking: prompt 44, completion 2,015, first token 0.10 s, prefill about 443 tok/s, decode 143.8 tok/s, finish stop |
| **P3** long context | prompt 47,330, completion 253, first token 13.33 s, prefill about 3,551 tok/s, decode 92.0 tok/s, finish stop |
| **P4** prefix cache | repeating the same long prompt reused 44,800 cached tokens, first token 0.97 s |
| **P5** tool-call integrity | status 200, 30.9 s; payload 11,124 bytes; tool calls 1; arguments parsed yes; content byte-exact yes; length ratio 1 |
| **P6** abort | running before 0; aborted after 4.0 s; running after the abort (1 s steps) max 0; next request first token 0.19 s |
| **P7** concurrency | single stream decode 81.1 tok/s; two concurrent streams 71.6, 70.6 tok/s |
| **P8** long non-streaming request | status 200, 137.8 s; completion tokens 20,000 |
| **P9** context guard | max_tokens 262,144 requested: status 200, 0.3 s; rejected with 400 no |
| **P10** `response_format` acceptance, plan | strict: accepted (status 200); non-strict: accepted (status 200) |
| **P10** `response_format` acceptance, extract | strict: accepted (status 200); non-strict: accepted (status 200) |
| **P10** `response_format` acceptance, synthesis | strict: accepted (status 200); non-strict: accepted (status 200) |
| **P10** structured output, plan/on | valid 20/20 (100%); truncated 0; schema invalid 0; binding invalid 0; invalid JSON 0; request rejected 0; variant strict; max_tokens 8,192; median 22.8 s, max 58.0 s; thinking-on replies with zero reasoning tokens 0; against the 95% rule (strict variant): meets |
| **P10** structured output, plan/off | valid 20/20 (100%); truncated 0; schema invalid 0; binding invalid 0; invalid JSON 0; request rejected 0; variant strict; max_tokens 8,192; median 4.4 s, max 6.1 s; against the 95% rule (strict variant): meets |
| **P10** structured output, extract/on | valid 18/20 (90%); truncated 2; schema invalid 0; binding invalid 0; invalid JSON 0; request rejected 0; variant strict; max_tokens 2,048; median 9.5 s, max 24.5 s; thinking-on replies with zero reasoning tokens 0; against the 95% rule (strict variant): does not meet |
| **P10** structured output, extract/off | valid 20/20 (100%); truncated 0; schema invalid 0; binding invalid 0; invalid JSON 0; request rejected 0; variant strict; max_tokens 2,048; median 1.7 s, max 3.3 s; against the 95% rule (strict variant): meets |
| **P10** structured output, synthesis/on | valid 17/20 (85%); truncated 3; schema invalid 0; binding invalid 0; invalid JSON 0; request rejected 0; variant strict; max_tokens 8,192; median 18.9 s, max 170.9 s; thinking-on replies with zero reasoning tokens 0; against the 95% rule (strict variant): does not meet |
| **P10** structured output, synthesis/off | valid 19/20 (95%); truncated 1; schema invalid 0; binding invalid 0; invalid JSON 0; request rejected 0; variant strict; max_tokens 8,192; median 3.8 s, max 53.0 s; against the 95% rule (strict variant): meets |
| **P11** prefill and decode by prompt size | 20,000 target (20,003 observed): prompt 20,003, completion 197, first token 5.59 s, prefill about 3,576 tok/s, decode 95.1 tok/s, finish stop; 60,000 target (59,894 observed): prompt 59,894, completion 183, first token 16.91 s, prefill about 3,541 tok/s, decode 98.3 tok/s, finish stop; 120,000 target (119,980 observed): prompt 119,980, completion 163, first token 34.54 s, prefill about 3,474 tok/s, decode 81.8 tok/s, finish stop |
| **P11** cache reuse per extraction layout | sorted_keys: second request reused 0 of 14,356 prompt tokens, first token 4.12 s; cache_salt accepted yes; stable_prefix: second request reused 0 of 14,358 prompt tokens, first token 4.10 s; cache_salt accepted yes |
| **P11** K concurrent streams | K=1: aggregate 84.5 tok/s, median per stream 85.4 tok/s, max first token 0.12 s, errors 0, running max during the burst 1; K=2: aggregate 141.4 tok/s, median per stream 71.8 tok/s, max first token 0.20 s, errors 0, running max during the burst 2; K=4: aggregate 158.3 tok/s, median per stream 40.3 tok/s, max first token 0.20 s, errors 0, running max during the burst 4; K=8: aggregate 295.9 tok/s, median per stream 37.9 tok/s, max first token 0.34 s, errors 0, running max during the burst 8 |
| **Adapter** `/openapi.json` | status 200; served version `0.1.0`; `/tokenize` route yes; `response_format` in ChatCompletionRequest yes; `chat_template_kwargs` in ChatCompletionRequest yes; `cache_salt` in ChatCompletionRequest yes |
| **Adapter** `/tokenize` parity | status 200; count 19 against usage.prompt_tokens 19: parity yes |
| **Adapter** reasoning field (thinking on) | JSON: `reasoning`, 771 reasoning tokens, model in reply yes; SSE: `reasoning`, model in 347 chunks (0 mismatched); leading `<think>` tag no |
| **Adapter** thinking off | reasoning bytes leaked JSON 0, SSE 0; leading `<think>` tag no; `preserve_thinking` accepted yes; `cache_salt` accepted yes |
| **Adapter** reply contract | consistent with the legacy shape: yes; consistent with `flash_next_v1`: yes (consistency of a few synthetic replies; the contract itself is not established by this probe) |

## Stage bounds derived from this card (proposals for the E0 card)

| Role | Output cap (tokens) | Prompt size assumed (tokens) | Prefill at that size (s) | Decode (tok/s, thinking off) | Ceiling under the 300 s clock (tokens) | Ceiling under the 900 s clock (tokens) |
| --- | --- | --- | --- | --- | --- | --- |
| index | 1,536 | 20,000 | 5.6 | 95.1 | 28,001 (within the cap) | 85,067 (within the cap) |
| plan | 8,192 | 60,000 | 16.9 | 98.3 | 27,830 (within the cap) | 86,816 (within the cap) |
| extract | 2,048 | 20,000 | 5.6 | 95.1 | 28,001 (within the cap) | 85,067 (within the cap) |
| synthesis | 8,192 | 60,000 | 16.9 | 98.3 | 27,830 (within the cap) | 86,816 (within the cap) |

Ceiling = (clock - prefill at the assumed prompt size) x thinking-off decode, with the app's two request clocks (300 s standard, 900 s heavy). Thinking-on replies also spend reasoning tokens (P2, P10), so a thinking-on role needs its reasoning budget under the same ceiling. Output caps come from the role export that the probe read; every bound here is a proposal for the E0 card, not a decision.

## Consequences for the plan

The orchestrating session wrote this section after reviewing the tables above. Each point is a proposal for E0's `Verified` entry and for the card's adoption commit, not a decision. The probe run behind this card is BL-20261116-0939-e0-probes-serving-card's third run.

- **Identity.** The endpoint serves the model qualified on 2026-11-04: model root, engine version and context are all unchanged. E0 stays the delta check of decision 1 of BL-20261113-1003-e0-card-owner-answers. Identical weights are not shown.
- **Structured output fails only at the output cap.** No reply in any P10 cell was invalid JSON, broke its schema or failed its binding.
  - Plan: 20 of 20 valid, with thinking on and with thinking off.
  - Extract: 20 of 20 with thinking off. With thinking on, 18 of 20; both failures were truncated at the 2,048-token cap.
  - Synthesis: 19 of 20 with thinking off. With thinking on, 17 of 20; all four failures across both modes were truncated at the 8,192-token cap.
  - Thinking-on replies spend tokens on reasoning first (P2), which is where those cells lost their room.
- **The writer's structured-output proposal follows the 95% rule:** plan with thinking on and off, extract with thinking off, and synthesis with thinking off. The extraction stage already calls with thinking off at 2,048 tokens, the cell that passed 20 of 20.
- **The planner.** With `response_format`, no plan reply was truncated at 8,192 tokens: median 22.8 s, longest 58.0 s with thinking on. By contrast, every r3 run's first planner reply, made with the pipeline's own request, came back empty (BL-20261116-0813-e0-r3-runs-index-and-harvest). This card does not explain the difference. The planner fixture measures the pipeline's planner request under three conditions.
- **Clocks.** At each role's assumed prompt size, its output cap fits inside both of the app's request clocks: the derived ceilings are about 27,800 tokens at 300 s and about 85,000 at 900 s. The risk is long thinking-on replies; one synthesis reply took 170.9 s.
- **Throughput and concurrency.**
  - Prefill ran at about 3,500 tokens per second up to 120,000 tokens.
  - Single-stream decode ran at 82 to 98 tokens per second, and two streams gave 141 tokens per second in aggregate.
  - The writer proposes one local stream and no admission basis. K above 1 waits for 8.2b's own decision.
- **Prefix caching.** An identical long prompt reused 44,800 cached tokens (P4). Neither extraction layout reused any tokens between two consecutive requests (P11: 0 of about 14,300, with `cache_salt` accepted). Plans that count on prefix reuse on the extraction layout do not hold on this evidence until that is explained.
- **The reply contract.** On a few synthetic replies, both the legacy shape and `flash_next_v1` were consistent. The contract stays legacy, by decision 4 of BL-20261115-1937-owner-adopts-standing-defaults, unless the owner chooses otherwise.
- **Speculative decoding** was active during the probe: 54% of drafted tokens accepted.
- **The measurement path.**
  - Probe runs 1 and 2 went through this Mac's loopback HTTP proxy, which the shell's proxy variables set for the probe's Python client. Both lost the endpoint partway.
  - Run 3 bypassed that proxy for the probe process only. The app's own requests, made from Node, never used it. Every probe in run 3 completed.
  - This card rests on run 3 alone.
