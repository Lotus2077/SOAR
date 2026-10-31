# Current q4t service capability review

Status: **Verified source and CLI inspection; no new inference qualification**.
Reviewed 2026-11-01 (Asia/Shanghai), following the owner's request to check q4t
before switching to the prepared vLLM candidate.

The q4t controlled stop/restore test passed in BL-20261031-1837. The later
NemoClaw-derived candidate failed startup; after automatic cleanup failed and
blocked restoration, scoped manual reconciliation restored the original q4t
binary/arguments, unit-owned listener and health/model metadata
(BL-20261031-2003-nemoclaw-trial-failed-q4t-recovered). No generation was used to
verify that recovery. A separately approved instrumented retry now serves a
healthy owned vLLM API with context 262144; q4t is stopped and its verified
recovery assets remain retained (BL-20261031-2040-nemoclaw-retry-ready).
Relaunching q4t with different supported flags can enable session/prefix caching
and change scheduling or capacity. It cannot supply the retained Heavy sampling
and structured-response contract through flags alone.

| Requirement | Inspected q4t implementation | What a restart can accomplish |
| --- | --- | --- |
| Heavy sampling: temperature 1, top-p 0.95, top-k 20 | Validator permits only temperature 0, top-p 1, n 1; generation uses argmax. top_k is not accepted. | No sampling switch exists. Engine implementation is needed; merely removing validation would still be greedy. |
| Native single-action tools | Tool definitions are rendered into the input template. tool_choice and parallel_tool_calls are unsupported. Replies contain generated text in content. | No native-response parser flag exists. A scoped parser/adapter and action/history validation are needed. |
| Separate reasoning and final text | enable_thinking, preserve_thinking and low/medium/xhigh effort are accepted template controls. Streaming and JSON replies do not separate reasoning_content from content. | Template controls can be supplied per request; changing launch flags does not add a response parser. |
| Per-job cache isolation | Session and prefix caches exist, using session_id, prefix_cache_scope and explicit prefix_cache_write_tokens. cache_salt is unsupported. | Cache directories/checkpoints can be configured, but SOAR needs a scoped lifecycle adapter and isolation/history tests. The mechanisms are not interchangeable by renaming a field. |
| Context and scheduling | max-len, max-prefill, max-seq and seq-capacities are configurable. | Capacity can be changed within the actual hardware limit and requalified. The inspected configuration has a total input/output ceiling of 208896. |
| Streaming/usage | SSE and integer usage, including cache details, exist. | Availability does not establish the missing sampling or response contracts. |

## Inspected evidence

- Binary: q4t v0.1.0, SHA-256
  `0c5ab1de85ff68f9d757ac3bfad04187756a1b2c6634108c3112a5861c209483`.
- Adjacent source revision: `24b97e7d50ec7d81eaabcf11ef3f7c7be3587a35`
  in [qwen4-thor](https://github.com/thomas-hiddenpeak/qwen4-thor).
- `src/server/chat_contract.cpp` lines 56–64 defines the accepted top-level
  fields; lines 102–108 enforces greedy neutral values. Its SHA-256 is
  `d381ae5d9f656bd70bfdb52eda097492ff9714a0cc66f1edc532988cd925716f`.
- `src/server/server_options.cpp` lines 131–147 defines the applicable launch
  options. The actual binary's usage output lists cache, capacity and MTP
  switches, without sampling or output-parser switches. This binary does not
  implement a successful `--help` subcommand: general usage exits 1 and
  `serve --help` exits 2 with an unknown-option error.
- `src/server/chat_generation.cpp` uses argmax at lines 538–550, 1009 and 1493;
  its JSON response at lines 1728–1740 contains content only.
  `src/server/http_response.cpp` lines 209–229 does the same for SSE.
- The source's `docs/AGENT_CACHE_INTEGRATION.md` documents the capability-ID,
  seed-publication, history and cache-lifecycle rules; it explicitly warns
  that existing messages clients must parse reasoning/tool text themselves.
- Thirteen selected source/document files were reviewed independently. Their
  manifest SHA-256 is `2fdee83e4a2d04e67bd0efe09c171f85d45e4dc56e36feb11cc5afd4d7c5b929`.

This is source and binary-CLI evidence, not a new HTTP generation test or proof
that the installed binary was reproducibly built from the adjacent source.
No inference allowance was consumed by that inspection; q4t was left running at
that point. Its later candidate-trial interruption and recovery are separate
observations recorded below.

## Implication for SOAR

Keeping q4t is possible with additional engineering. Preserving Heavy requires
real stochastic sampling as well as tool/reasoning and cache integration.
Alternatively, a named greedy experiment would require a design amendment;
the existing approval does not silently authorize changing Heavy semantics.

The NemoClaw-derived vLLM recipe remains a candidate, not a mandatory product or
a qualified deployment. In particular, its added fused GDN MTP operator is not
a demonstrated requirement for the proposed MTP-off Triton route. The current
service at the time of this source review was q4t. The owner subsequently
reauthorized one recoverable candidate trial (BL-20261031-1936). It passed 22
selected operator numerical cases and loaded all 206 shards at a reported
74.34 GiB. Initial compilation/profile warmup completed before the stall after a
31.44 GiB KV-capacity log; completed cache initialization and final engine warmup
were not proven. It never reached a healthy API, and the operator stopped it
before the original 30-minute deadline. Fuller kernel evidence shows driver
blocking before stop and allocation failures after stop began; the exact initial
cause remains unproven. Automatic container removal failed; the ownership guard
blocked restoration until later process exit and identity-checked cleanup
permitted verified manual q4t recovery. Preserve both negative results.

The owner then approved a separate instrumented retry with a fixed 12 GiB KV
pool, unchanged context 262144 and one sequence, a single synchronized clean-page
cache drop and a 60-minute startup bound
(BL-20261031-2021-nemoclaw-diagnostic-retry-approved). It passed the same 22
selected numerical cases (64 deselected, zero skips), loaded all 206 shards,
completed total engine initialization in 90.62 seconds, including final
CUDA-graph capture in six seconds using 0.16 GiB. Healthy API metadata arrived at
2026-10-31 20:37:27 UTC, about 321 seconds after server start
(BL-20261031-2040-nemoclaw-retry-ready). Internal and user-facing health, model,
version and metrics checks returned HTTP 200 at 20:40 UTC. Owned image/arguments,
init and pinned read-only overlays matched; the reported KV capacity is 479856
tokens, or 1.83 times the fixed context. The candidate is active and the prior
q4t unit is inactive/dead; verified rollback assets are retained.

The interrupt warning recurred, without a new allocation-failure or blocked-task
report observed through 20:40 UTC. Reduced KV, page-cache preparation, retained
build caches, diagnostics and wait policy were not isolated; this successful
startup does not establish the first stall's cause. Readiness arrived within the
original 30-minute allowance, so the extended bound was not needed to reach it.
No trial generation was sent, all 24 qualification slots remain unused and new
spend is USD 0. This source review and startup are not Heavy compatibility or
stability passes. Six synthetic CPU renderer/tokenizer cases now have matching
token IDs, and shared exact-token admission is implemented with passing focused
tests and independent reviews. Full integrated verification, final role/fixture
pins and live qualification still gate H4/H5.
