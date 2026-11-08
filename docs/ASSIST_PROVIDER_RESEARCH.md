# Assist providers for decision 6: `claude-sonnet-5-5` against `gpt-6-sol`

Date checked: 2026-11-08. Status: **research findings, no decision.** Resolves
GitHub issue #49. The choice itself is the owner's decision 6
(PROJECT_REVIEW_2026-11-05.md §5.10, item 6; GitHub issue #59).

Verified 2026-11-08 against every cited provider page and repository source. Corrected: the Claude shape probes each began with a one-shot, which wrote about 1,030 tokens (the draft called them tool-loop probes only); the assist system prompts are 1,123 and 993 bytes with the shared `TRUST` suffix (not 894 and 764) and sit under Claude's 512-token minimum by estimate only; both providers, not only Anthropic, reject the current plan and synthesis schemas as they stand; the 90-call `gpt-6-sol` row is 1.90 and 2.41 (not 1.91 and 2.42); the 2.1-2.6 D fee at 100 calls was f2's alone; both providers fit D's cap to 117 calls (not about 115); the Phase 2 dashboard gap is up to about 22% above the settled figure; a model outside PLAN.md §4(b) needs an envelope amendment, not a new egress destination; several quotes made exact. The r3 late-call fee is marked unverified.

Scope: the facts behind decision 6, which provider carries the T1 and T2 assists
(§5.2) and E3's all-cloud ceiling arm D (§5.6): list prices, how each provider
guarantees zero cache writes and which receipt field proves it, structured-output
and reasoning controls for one-shot packets, what the repository's own receipts
measured, and arm D's projected fee on f2 against its USD 3.00 cap. Every provider
claim is from the provider's own documentation as read on 2026-11-08; every
repository claim names the build-log entry, registry row or source file. Nothing
here was run against either API.

## Gist

Both models list at the same base prices (USD 2 input, 10 output, 2.50 cache
write per million tokens); `claude-sonnet-5-5` reads its cache at 0.10, `gpt-6-sol`
at 0.20. Both can prove zero cache writes on a one-shot from a usage field the
adapters already read, but by different mechanisms: Anthropic caches nothing unless
`cache_control` is sent; OpenAI caches by default and needs `prompt_cache_options`
`mode: "explicit"` with no breakpoint. Today both adapters mark a one-shot's system
block; on Claude that writes once the marked prefix reaches 512 tokens (by the
registry totals, the shape probe's 3.2 KB one-shot wrote about 1,030 tokens), and
the current 1.0-1.1 KB assist prompts stay under it by estimate only. The repository has measured both providers'
all-cloud r3 runs at about USD 1.13-1.18, and both project arm D on f2 at about USD
2.16-2.20 with the late reservation at 80 calls, under USD 3.00 up to an allowance
of 117 (`gpt-6-sol`) and 120 (`claude-sonnet-5-5`) calls on a linear scaling. Only
`gpt-6-sol` has measured assist (T1, T2) receipts; only `claude-sonnet-5-5` has a
Console-reconciled receipt. The prices the review assumed (§5.4) match today's
lists for both.

## 1. List prices, dated and sourced

Prices in USD per million tokens, read 2026-11-08.

| Model | Input | Output | Cached input (read) | Cache write | Long-context tier | Source |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `claude-sonnet-5-5` | 2.00 | 10.00 | 0.10 (0.05x base; footnote 2) | 2.50 (5-minute, 1.25x); 4.00 (1-hour, 2x) | none: "the full 1M token context window at standard pricing" | [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing); [Sonnet 5.5 overview](https://platform.claude.com/docs/en/models/sonnet-5-5/overview) |
| `gpt-6-sol` | 2.00 | 10.00 | 0.20 | 2.50 ("30m write", 1.25x); 5.00 ("12h write", 2.5x) | above 272K input tokens: 4.00 / 15.00 / 0.40 / 5.00, and 10.00 for the 12h write ("2x input and cache rates and 1.5x output for the full request", model page) | [OpenAI pricing](https://developers.openai.com/api/docs/pricing); [gpt-6-sol model page](https://developers.openai.com/api/docs/models/gpt-6-sol) |

Notes from the same pages:

- Anthropic's page states the general multipliers: 5-minute writes 1.25x, 1-hour
  writes 2x, reads "0.1x base input price (0.025x on Claude Fable 5.1 and Claude
  Mythos 5.1; 0.05x on Claude Opus 5.5 and Claude Sonnet 5.5)"; footnote 2:
  "Cache hits and refreshes on Claude Opus 5.5 and Claude Sonnet 5.5 are priced at
  0.05x the base input price." Batch API is 50% off input and output. US-only
  `inference_geo` adds a 1.1x multiplier; the adapter pins `global`.
- `claude-sonnet-5-5`: released 2026-09-28, 1M context, 128K max output, default
  effort `high`, minimum cacheable prompt 512 tokens.
- `gpt-6-sol`: 1,050,000-token context (922,000 max input), 128,000 max output,
  knowledge cutoff 2026-04-20; Batch and Flex at 50% of standard; a "Fast" tier at
  2x. The model page lists cache writes at $2.5 per 1M tokens ("Cache writes are
  billed at 1.25x the uncached input token rate.") and prompt caching among its
  features. OpenAI's pricing page also lists a newer sibling, `gpt-6.1-sol`, at
  2.00 / 0.10 / 10.00 (input / cached / output); it is not in the standing
  envelope (PLAN.md §4(b)) and is noted only so the owner knows it exists.
- The review's assumed prices (§5.4: `gpt-6-sol` 2 / 0.20 / 10 / 2.50,
  `claude-sonnet-5-5` 2 / 0.10 / 10 / 2.50 for input, cached, output, cache write)
  are the current lists. An uncached one-shot costs the same on both.

## 2. Zero cache writes: mechanism and proof field per provider

E3's pre-registered rule needs 0 cache-write tokens on every assist receipt
(§5.6, E3 decision rule). The assists are one-shots built as
`[{role: "system"}, {role: "user"}]` with no tools (`research-pipeline.ts`, the
`call` helper), so the only prefix a cache could hold is the system prompt plus the
packet.

### Anthropic (`claude-sonnet-5-5`, Messages API)

- **Mechanism.** Caching is opt-in: for the Messages API the page's usage line is
  "Opt in with `cache_control`, at the top level or on blocks." With no
  `cache_control` anywhere in a tool-less one-shot, nothing is written or read: the
  automatic breakpoint on server-tool results "only applies when your request
  already has at least one `cache_control` marker", and the automatic caching of
  thinking blocks concerns blocks passed back with tool results, which a one-shot
  never sends. Below the model's minimum cacheable prompt (512 tokens on Sonnet
  5.5) "Shorter prompts cannot be cached, even if marked with `cache_control`",
  silently. Sources: [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching);
  [Tool use with prompt caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching).
- **Proof field.** `usage.cache_creation_input_tokens` ("Number of tokens written
  to the cache when creating a new entry") must be 0; it "equals the sum of the
  values in the `cache_creation` object" (`ephemeral_5m_input_tokens`,
  `ephemeral_1h_input_tokens`). `usage.cache_read_input_tokens` reports reads and
  `usage.input_tokens` the uncached remainder; total input is the sum of the three.
  "if both `cache_creation_input_tokens` and `cache_read_input_tokens` are 0, the
  prompt was not cached".
- **Repository.** `src/main/private-agent/anthropic.ts` decodes
  `cache_creation_input_tokens` into `cacheWriteTokens` and refuses any reply
  reporting a 1-hour write (`model_cache_ttl_mismatch`); the broker settles writes
  at the 5-minute price (BL-20261030-0620, BL-20261030-0850). The registry's
  `cacheWriteTokens` column is the summed receipt field.
- **Where the one-shot stands today.** `anthropicBody` marks blocks only when the
  model configuration's `promptCaching` is set (`anthropic_explicit_5m_v1`, which
  the driver script's `buildCloudArm` sets on every Anthropic cloud arm, the split
  arm's planner and synthesiser included). On a two-message one-shot the marked
  block is the system message alone (the brief is marked only when more messages
  follow). The system prompts are 1,123 bytes (`PLAN_SYSTEM`) and 993 bytes
  (`SYNTHESIS_SYSTEM`), each including the shared 229-byte `TRUST` suffix. No Claude
  token count of them has been measured; at 0.32-0.38 Claude tokens per byte (the
  shape probe's one-shot below; the all-cloud run's request bodies) they come to
  about 320-420 tokens, under the 512 minimum by estimate only, and any fixed text
  rendered before the breakpoint adds to that. The shape does write above the
  minimum: each shape probe began with a tool-less `[system, user]` call whose
  3,222-byte padded system prompt was marked by the same rule, and the registry
  totals imply that call wrote about 1,030 tokens on attempt 1 and read them on
  attempt 2 (attempt 2's 10,357 cached tokens are the loop's 3 x 3,109 plus 1,030;
  attempt 1's 4,459 written are 3,109 + 1,030 + 320; BL-20261031-1325; the per-call
  receipts are not in the repository). So the surest guarantee on this provider is
  to send no `cache_control` on a one-shot, which costs nothing here (reads on a
  one-shot are worth nothing). Anthropic also injects "a specialized system
  prompt" when thinking is active (Steering thinking, Pricing); whether that text
  counts toward the marked prefix is not stated, which is one more reason to prefer
  no breakpoint over a sub-minimum one. The review's note (§5.2, Caching) that
  `promptCaching` "is never left undefined on an assist, because that re-enables
  implicit writes at 1.25x the input rate" is true of OpenAI's shape only; on
  Anthropic's shape, undefined means no caching, and the review's "sub-1,024-token"
  bound is OpenAI's minimum, not Claude's 512.

### OpenAI (`gpt-6-sol`, Responses API)

- **Mechanism.** "Prompt caching is enabled by default for supported OpenAI
  models." For GPT-5.6 and later the control is `prompt_cache_options`
  (`mode`: `implicit` or `explicit`; `ttl` `"30m"` default or `"12h"`; `prewarm`).
  In implicit mode "OpenAI places a breakpoint at the end of the latest eligible
  message", so a one-shot's whole prompt is written on every request. In explicit
  mode, "When no explicit breakpoints are placed, the request does not use prompt
  caching or create cache writes." Minimum cacheable prompt: "1,024 tokens for
  GPT-5.6 and later." Writes "cost 1.25× the standard, uncached input-token rate
  for the default 30-minute lifetime" and are "not an additive fee: input tokens
  use the uncached-input, cached-input, or cache-write rate." The guide documents
  these controls for the Responses API and does not say whether Chat Completions
  accepts them. Source: [Prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching).
- **Proof field.** `usage.input_tokens_details.cache_write_tokens` must be 0
  (`cache_write_tokens_details.ttl_30m_tokens` and `ttl_12h_tokens` split it);
  `usage.input_tokens_details.cached_tokens` reports billed reads. The Chat
  Completions object also defines `prompt_tokens_details.cache_write_tokens`
  ("The unadjusted number of prompt tokens written to cache") and
  `completion_tokens_details.reasoning_tokens`
  ([chat object reference](https://developers.openai.com/api/docs/api-reference/chat/object)).
- **Repository.** The Responses shape sends `prompt_cache_options: {mode:
  "explicit"}` whenever `promptCaching` is set and reads
  `input_tokens_details.cache_write_tokens` into `cacheWriteTokens`
  (`model.ts`); the chat-completions shape reads no write count and records
  `cacheWriteTokens: 0`, so a chat-shape receipt cannot prove zero writes
  (BL-20261022-1157). The 2026-10-22 replay showed every implicit-mode request
  writing its input minus the cached part minus three tokens (BL-20261022-1157),
  which is why the explicit mode and the write price were adopted
  (BL-20261022-1156, -1157). The owner's dashboard check of the pre-2026-10-22
  settlements is still open (§5.10, item 13): if every uncached input token was
  billed as a write, the charge exceeds the USD 20.985 settled by up to USD 4.72,
  about 22% in aggregate and up to about 24% per run (BL-20261022-1157).
- **Where the one-shot stands today.** `responsesInput(messages, breakpoints)`
  marks the leading system message only on a two-message one-shot; at about 0.25
  `gpt-6-sol` tokens per byte the 1,123- and 993-byte prompts are about 250-280
  tokens, far under the 1,024-token minimum, so no write results. Measured, on the
  shorter protocol v2 and v3 prompts (about 0.6-0.9 KB): the three `gpt-6-sol`
  split runs on r3 recorded `cacheWriteTokens` 0 (registry rows
  `p4h3-...-planner-v1`, `-v2`, `p4pb-...-protocol-v3`; the pipeline sums each
  call's write count) and read nothing from cache on their cloud calls (the `-v2`
  and `-v3` rows' non-zero `cachedTokens`, 2,169,600 and 443,200, are exactly the
  local writer's salted-cache reads in BL-20261026-1605 and -1644); BL-20261026-1605:
  "no cache reads expected (system prompts under the provider's minimum)".

### Summary table

| | `claude-sonnet-5-5` | `gpt-6-sol` |
| --- | --- | --- |
| Default without any cache field | no caching | caching on, implicit breakpoint at the end of the latest message, written at 1.25x input |
| How a request guarantees 0 writes | send no `cache_control` (or keep every marked prefix under 512 tokens) | `prompt_cache_options.mode: "explicit"` with no `prompt_cache_breakpoint` (or keep the marked prefix under 1,024 tokens) |
| Receipt field that must read 0 | `usage.cache_creation_input_tokens` (and both `cache_creation.*` fields) | `usage.input_tokens_details.cache_write_tokens` (and both `cache_write_tokens_details.*` fields) |
| Adapter reads it today | yes (`anthropic.ts`) | Responses shape yes; chat shape no (`model.ts`) |
| Measured on a one-shot receipt | no assist receipt exists; the shape probe's padded one-shot wrote about 1,030 tokens (attempt 1, inferred from registry totals) | 0 writes on 3 of 3 assist runs (6 cloud calls) |

## 3. Structured output and reasoning controls for one-shot packets

| | `claude-sonnet-5-5` | `gpt-6-sol` |
| --- | --- | --- |
| JSON schema output | `output_config.format` `{type: "json_schema", schema}`; "available on every model"; first use of a schema compiles a grammar (extra latency; cached 24 hours from last use); an injected system prompt adds input tokens; changing the format invalidates the prompt cache; unsupported: recursive schemas, complex types in enums, external `$ref`, `minimum`/`maximum`/`multipleOf`, `minLength`/`maxLength`, array constraints beyond `minItems` 0 or 1, `additionalProperties` other than `false`; incompatible with citations and prefill; "Grammars apply only to Claude's direct output, not to ... thinking tags", so it works with thinking ([Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)) | Responses `text.format` `{type: "json_schema", strict: true, schema}`; Chat Completions `response_format`; "the first request you make with any schema will have additional latency"; limits: root must be an object, up to 5,000 properties, 10 nesting levels, 1,000 enum values, 120,000 characters of names and values; supported keywords are `pattern`, `format`, numeric bounds and `minItems`/`maxItems` (`minLength`/`maxLength` are not listed); every field must be `required` (optional emulated with a `null` union) and `additionalProperties` `false`; a `refusal` output may not follow the schema; `incomplete` with `max_output_tokens` may truncate ([Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)); the model page lists `structured_outputs` as supported |
| Thinking or reasoning control | adaptive thinking is on by default; `output_config.effort` `low`/`medium`/`high`/`xhigh`/`max`, default `high` on the API, levels "recalibrated" against Sonnet 5; `thinking: {type: "disabled"}` returns 400; the lowest setting is `thinking: {type: "between_tools"}`, accepted at `low`/`medium`/`high`, and on a request without tools "the response contains only text, as with `disabled` on Claude Sonnet 5" ([What's new](https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5), [Effort](https://platform.claude.com/docs/en/build-with-claude/effort)) | `reasoning.effort` `none`, `low`, `medium` (default), `high`, `xhigh`, `max` (model page); on Chat Completions "function calling only with `reasoning_effort` set to `none`", which is why the harness uses Responses (BL-20261008-1300) |
| Token accounting | thinking "billed as output tokens"; `usage.output_tokens_details.thinking_tokens` is the reasoning part of `output_tokens`; the bill is the same whatever `display` is set to; changing top-level effort or the thinking configuration between requests invalidates cache breakpoints ([Steering thinking](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost)) | reasoning tokens are "billed as" output tokens and reported under `usage.output_tokens_details.reasoning_tokens`; "reasoning tokens are not visible via the API" ([Reasoning guide](https://developers.openai.com/api/docs/guides/reasoning)) |
| Other request constraints | `temperature`/`top_p`/`top_k` return 400; forced `tool_choice` `any`/`tool` returns 400 (irrelevant to tool-less one-shots); safeguards may return `stop_reason: "refusal"` with a `stop_details` category | `service_tier` pinned to `default` by the adapter; `store: false` |
| What the adapters send today | adaptive thinking at effort `medium` only; `disabled` is refused before dispatch (`private_model_thinking_unsupported`); no `output_config.format`; JSON is parsed from the text reply | `reasoning.effort` `medium` (or `none` with thinking off), `store: false`, non-strict function tools when tools exist; no `text.format`; JSON parsed from the text reply |

Two consequences for the packets. First, neither adapter sends an output-format
constraint to the cloud today (the plan call carries its JSON Schema only as prompt
data, `authoritativeSchema`); the review's probe P10 (`response_format`
`json_schema`) is about the local endpoint. Both providers offer schema-constrained
output for the T1 and T2 replies, but neither accepts the current schemas as they
stand: `z.toJSONSchema` turns the plan and synthesis schemas' `.min()`/`.max()`
into `minLength`/`maxLength` and `minItems`/`maxItems` (no numeric bounds), which
Anthropic rejects except `minItems` 0 or 1, while OpenAI's supported list omits
`minLength`/`maxLength` and its every-field-required rule excludes the plan's
optional `lookFor`, `conflictsToCheck` and `deliverableNotes`. Either provider
needs a schema variant. Second, the plan and synthesis assists run with thinking on
(`THINKING.plan` and `.synthesis` are `"model"`), and "Cloud reasoning bills as
output and dominates every assist fee" (§5.4): on Claude's r3 run, 13,279 of
32,876 output tokens were thinking (40%), and the adapter's `effort: "medium"` is
below Sonnet 5.5's default `high`. `between_tools` is a new lowest setting that a
tool-less one-shot could use where E2 or E0 shows thinking-off is wanted; the
adapter does not send it.

## 4. What the repository's receipts measured

All figures from `docs/experiments/registry.jsonl` and the build-log entries named;
fees are the broker's settlements at the frozen published rates.

### All-cloud ceiling arm on r3 (76,709-byte corpus), cached

| Run | Provider | Calls | Input tokens | Cache reads | Cache writes | Output tokens | Settled USD | Status |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `p4claude-r3-grid-batteries-all-cloud-step1` (2026-10-31; BL-20261031-1342) | `claude-sonnet-5-5` | 79 | 1,908,357 | 1,650,344 (86.5%) | 235,805 | 32,876 (13,279 thinking) | 1.127758 | submitted; Console shows 1.15 for steps 0 and 1 (1.151653 settled, difference 0.0017, within the 0.05 tolerance; BL-20261031-1636) |
| `p4h1-r3-grid-batteries-cloud-gpt-6-sol-heavy-layout2-v3` (2026-10-22; BL-20261022-1156) | `gpt-6-sol` | 80 | 1,282,609 | 945,417 (73.7%) | 323,511 | 15,396 | 1.179218 | stopped at its allowance (a lower bound); no dashboard reconciliation recorded |

Recomputed at the list prices above, the Claude run is 0.165 reads + 0.590 writes
+ 0.044 uncached + 0.329 output = 1.128 (writes 52%, output 29%); the `gpt-6-sol`
run is 0.189 + 0.809 + 0.027 + 0.154 = 1.179 (writes 69%, output 13%). Claude used
1.52x the prompt tokens per body byte (f = 1.5234, whole-run; 1.87 on the first
call) and 2.2x the output per call (416 against 192), and paid 0.59 against 0.92 USD
per million prompt tokens, so the two runs land within 5% of each other. These are
the "about USD 1.2 at 79-80 calls" figures of §5.6.

### Uncached all-cloud baselines (Phase 2, `gpt-6-sol`, implicit caching, pre-correction settlement)

r1 USD 3.766 (80 calls, allowance exhausted), r2 3.748 (78 calls), r3 3.054 (80
calls, allowance exhausted); `cached_tokens` 0 on every call (BL-20261022-0834), and
the settlements omit the 1.25x write price (BL-20261022-1157), which is §5.10 item
13's open dashboard question. No Claude uncached run exists.

### Assist one-shots (`gpt-6-sol` only; `cacheWriteTokens` 0 on every cloud call)

| Run | Plan call | Synthesis call | Cloud total USD |
| --- | --- | --- | ---: |
| `p4h3-...-planner-v1` (2026-10-26, BL-20261026-0743) | 0.034 | 0.099 | 0.133 |
| `p4h3-...-planner-v2` (2026-10-26, BL-20261026-1605) | 0.031 (0.136 reserved) | 0.091 (0.243 reserved) | 0.122 |
| `p4pb-...-protocol-v3` (2026-10-26, BL-20261026-1644) | 0.030 (5,698 input, 1,852 output tokens) | 0.096 (0.211 reserved) | 0.126 |

Request bodies (the review's "packets", recovered from the reservations at 2.50
per million plus 8,192 output tokens) were about 22 KB (plan) and 52-64 KB
(synthesis); both calls carried medium reasoning and the 8,192-token output cap.
No Claude assist has been run. The Claude shape probes
(`p4-claude-shape-20261031-attempt1`/`-attempt2`, 4 calls each, USD 0.016 and
0.008) each sent one tool-less `[system, user]` call with a padded 3,222-byte
system prompt, then a three-turn tool loop with breakpoints; they recorded writes
of 4,459 and 311 tokens, of which about 1,030 on attempt 1 came from that one-shot
(inferred in §2).

### The r1 projections

- `gpt-6-sol` (BL-20261022-1156, H5 gate arithmetic): 1.179 / 1,282,609 = 0.919 USD
  per million prompt tokens, times r1's 1.79M tokens = **1.65**, plus a 0.51 late
  reservation (a 138 KB late body at the write rate plus 16,384 output tokens) =
  2.16, under the then USD 2.50 cap: "passes on this measurement", "thin rather than
  comfortable" because r1's prompts average 40% longer and a 32% write share would
  project about 2.42.
- `claude-sonnet-5-5` (BL-20261030-0620 start condition; BL-20261031-1342 result):
  1.127758 / 1,908,357 per token, times 1.79M, times f 1.5234 = 1.61, plus 0.51 =
  **2.1214**, under USD 3.00 without a fee-cap stop. (With r1's exact 1,785,235
  tokens instead of the rounded 1.79M the fee part is 1.607 and 1.641 respectively;
  the recorded figures are used below.)

## 5. Arm D on f2 (512,514 bytes) at an allowance above 78-80 calls

Method: the recorded r1 fee parts (Claude 1.61, `gpt-6-sol` 1.65 at 80 calls on
499,438 bytes) scaled by corpus bytes (512,514 / 499,438 = 1.0262) and then
linearly by the call allowance, plus the USD 0.51 late reservation that the design
and the review both carry. Fees in USD.

| Allowance (calls) | `claude-sonnet-5-5` fee | with 0.51 | `gpt-6-sol` fee | with 0.51 | Under 3.00? |
| ---: | ---: | ---: | ---: | ---: | --- |
| 80 (r1's count, the floor the card must exceed) | 1.65 | 2.16 | 1.69 | 2.20 | both |
| 90 | 1.86 | 2.37 | 1.90 | 2.41 | both |
| 100 | 2.07 | 2.58 | 2.12 | 2.63 | both |
| 110 | 2.27 | 2.78 | 2.33 | 2.84 | both |
| 120 | 2.48 | 2.99 | 2.54 | 3.05 | Claude by 0.01; `gpt-6-sol` no |
| Largest allowance under 3.00 | 120 | | 117 | | |

What the table does not show:

- The scaling is linear in calls. In the agent loop the prompt grows with the
  history, so calls 81-120 each carry a longer history than the r1 average; the
  cache-read share makes that growth cheap (0.10-0.20 per million) but the
  demotion-batch rewrites, which are cache writes at 2.50, grow with it too (writes
  are 69% of the `gpt-6-sol` fee and 52% of Claude's; on the `gpt-6-sol` run the
  batch-turn rewrites were 224,771 of its 323,511 written tokens, BL-20261022-1156).
  Unverified: the draft's figure that r3's last `gpt-6-sol` calls cost about 0.02
  each. Per-call fees are in the ignored run directories, not the repository; the
  build log gives only the last call's split (25,808 of 26,948 prompt tokens read),
  about USD 0.01 with mean output, while a late batch turn rewrote up to 20,841
  tokens, about 0.05. Against r1's projected mean of 0.021 per call, the linear
  figure is a central estimate, not a bound, and thin at 120. The design's own
  sensitivity (BL-20261030-0620) reached 3.00 at output multiples of 3.4-5.5, and
  3.09 at a cache read of 0.20 in its worst corner.
- f2 is 2.6% larger than r1 by bytes but is a different brief with 21 files; the
  bytes-to-tokens ratio f was measured on r3, not on f2.
- The 0.51 reservation is the same on both providers only because the design
  reserved by bytes at 2.50 per million; Claude's higher tokens-per-byte ratio
  means the same body is more tokens, which the reservation by bytes already
  covers (prompt tokens never exceed body bytes under the adapter's rule).
- The uncached r1-r3 runs cost 3.05-3.77 at 78-80 calls (before the write-price
  correction), so arm D fits under 3.00 only cached, as §5.6 says.
- E3's expected spend of about 6.6 assumes each D run costs about 1.2 (r3 at
  79-80 calls). At 100 calls this projection gives 2.07-2.12 on f2 (2.58-2.63 with
  the late reservation, which is headroom, not spend); f1 and f3 are smaller, but
  r3 at 77 KB already settled 1.13-1.18 at 79-80 calls, about 1.4-1.5 at 100, so a
  D run on f1-f3 at 100 calls plausibly settles at about 1.4-2.1, above the 1.2 the
  expectation uses. E3's cap of 20.4 is unchanged either way.

Both providers fit D's cap at any allowance from 81 to 117 calls on this
projection (Claude to 120), with USD 0.04-0.06 between them at every row; the
provider choice does not decide D's feasibility.

## 6. Points the owner must weigh (not decided here)

1. **Measured evidence is split.** `gpt-6-sol` has the only assist receipts (3
   runs, 6 one-shots, 0 cache writes, USD 0.12-0.13 per run) and the only uncached
   baselines; `claude-sonnet-5-5` has the only Console-reconciled receipt (1.15
   against 1.1517 settled) and the only all-cloud r3 run that submitted within its
   allowance (79 of 80 calls; `gpt-6-sol` stopped at 80, incomplete). Choosing
   Claude for the assists means the first T1/T2 receipts on it are produced inside
   E3's B and C arms (or an r3 calibration run), not before.
2. **The 2026-10-22 dashboard question is open on `gpt-6-sol`** (§5.10, item 13):
   its pre-correction settlements may understate the charge by up to about 22% in
   aggregate (up to about 24% per run). The cached 1.13-1.18 figures are
   unaffected, but a provider whose invoice has never been reconciled against the
   ledger carries that uncertainty into E3's "mean settled USD at most 0.25 x
   USD(D)" rule.
3. **Zero-write proof differs in kind.** On Anthropic the guarantee is the absence
   of a request field; on OpenAI it is the presence of one (`mode: "explicit"`)
   against a default that writes. The review's "`promptCaching` is never left
   undefined on an assist" rule is right for OpenAI and inverted for Anthropic,
   where undefined is the no-cache setting; the test the review promises
   (`cacheWriteTokens = 0` on every assist receipt) should run on both shapes, and
   the Anthropic one-shot would be safest with no `cache_control` at all: today's
   shape marks its system block, which wrote about 1,030 tokens on the shape
   probe's padded one-shot.
4. **Reasoning cost.** The adapter runs Claude at `effort: "medium"` (below the
   model's default `high`) and `gpt-6-sol` at `medium` (its default). Claude spent
   2.2x the output tokens per call on r3 with 40% of them thinking; on a one-shot
   that ratio sets the fee, since output is 10 per million against 2 for input. No
   assist on Claude has been measured, so T1/T2 fees on Claude are a projection
   from the all-cloud ratio, not a receipt. `between_tools` (Claude) and
   `reasoning.effort: "none"` (OpenAI) are the thinking-off options if E2 or E0
   motivates one; the Claude adapter would need a change to send it.
5. **Structured output.** Both providers can constrain the T1/T2 reply to the plan
   and synthesis schemas; neither adapter does, and neither provider accepts the
   current Zod output as it stands (Anthropic rejects its `minLength`/`maxLength`
   and `maxItems`; OpenAI does not list `minLength`/`maxLength` and requires every
   field, including the plan's three optional ones). This is a protocol-identity
   change either way and is independent of the provider choice.
6. **Cache read price.** Claude's 0.10 against `gpt-6-sol`'s 0.20 matters only
   for arm D (reads are 15% of Claude's r3 fee, 16% of `gpt-6-sol`'s); assists read
   nothing. Claude's 1-hour write (4.00) is refused by the adapter; OpenAI's 12-hour
   write (5.00) is never requested.
7. **Approval trail.** `claude-sonnet-5-5` was approved for the Phase 4 harness
   track, with its Anthropic egress destination, on 2026-10-30 (BL-20261030-0745),
   and PLAN.md §4(b) names both models in the standing envelope, so neither choice
   needs a new egress destination or an envelope change; a model §4(b) does not
   name (such as `gpt-6.1-sol`) would need an envelope amendment first.

## Sources

Provider documentation, all read 2026-11-08:

- Anthropic: [Pricing](https://platform.claude.com/docs/en/about-claude/pricing);
  [Claude Sonnet 5.5 overview](https://platform.claude.com/docs/en/models/sonnet-5-5/overview);
  [What's new in Claude Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5);
  [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching);
  [Tool use with prompt caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching);
  [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs);
  [Steering thinking](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost);
  [Effort](https://platform.claude.com/docs/en/build-with-claude/effort);
  [Extended thinking (legacy)](https://platform.claude.com/docs/en/build-with-claude/extended-thinking).
- OpenAI: [Pricing](https://developers.openai.com/api/docs/pricing);
  [GPT-6 Sol model page](https://developers.openai.com/api/docs/models/gpt-6-sol);
  [Prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching);
  [Structured outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs);
  [Reasoning guide](https://developers.openai.com/api/docs/guides/reasoning);
  [Chat completion object](https://developers.openai.com/api/docs/api-reference/chat/object).

Repository:

- `docs/PROJECT_REVIEW_2026-11-05.md` §5.2 (T1/T2 packets, Caching note), §5.4
  (prices assumed), §5.6 (E3 row and decision rule), §5.10 (items 6 and 13).
- `docs/PLAN.md` §4(b) (standing envelope).
- `docs/experiments/registry.jsonl` rows named above; `docs/experiments/README.md`
  (`cachedTokens`, `cacheWriteTokens` definitions);
  `docs/experiments/phase2-tasks-v1.json` (r1 499,438 bytes) and
  `phase4-tasks-v1.json` (f1 204,272, f2 512,514, f3 370,350 bytes).
- `docs/BUILD_LOG.md`: BL-20261008-1300 (Responses shape), BL-20261022-0834
  (uncached Phase 2 calls), BL-20261022-1156 (H1 caching, the r1 gate arithmetic),
  BL-20261022-1157 (cache-write price correction), BL-20261026-0743, -1605 and
  -1644 (assist receipts), BL-20261030-0620 (Claude adapter design, cap and
  projection), BL-20261030-0745 (approval), BL-20261030-0850 (implementation),
  BL-20261031-1325 (shape probes), BL-20261031-1342 (Claude all-cloud observed),
  BL-20261031-1636 (Console reconciled).
- `src/main/private-agent/anthropic.ts`, `src/main/private-agent/model.ts`,
  `src/main/private-agent/research-pipeline.ts`,
  `src/main/private-agent/research-plan.ts` and `research-coverage.ts` (the plan and
  synthesis schemas), `scripts/anthropic-probe.ts`,
  `src/main/providers/openai-compatible.ts`, `scripts/private-agent-local-screen.ts`.
