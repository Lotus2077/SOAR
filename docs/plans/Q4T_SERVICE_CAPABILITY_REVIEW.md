# Current q4t service capability review

Status: **Verified source and CLI inspection; no new inference qualification**.
Reviewed 2026-11-01 (Asia/Shanghai), following the owner's request to check q4t
before switching to the prepared vLLM candidate.

The current q4t service can be stopped and restored; that controlled test passed
in BL-20261031-1837. Relaunching it with different supported flags can enable
session/prefix caching and change scheduling or capacity. It cannot supply the
retained Heavy sampling and structured-response contract through flags alone.

| Requirement | Current q4t implementation | What a restart can accomplish |
| --- | --- | --- |
| Heavy sampling: temperature 1, top-p 0.95, top-k 20 | Validator permits only temperature 0, top-p 1, n 1; generation uses argmax. top_k is not accepted. | No sampling switch exists. Engine implementation is needed; merely removing validation would still be greedy. |
| Native single-action tools | Tool definitions are rendered into the input template. tool_choice and parallel_tool_calls are unsupported. Replies contain generated text in content. | No native-response parser flag exists. A scoped parser/adapter and action/history validation are needed. |
| Separate reasoning and final text | enable_thinking, preserve_thinking and low/medium/xhigh effort are accepted template controls. Streaming and JSON replies do not separate reasoning_content from content. | Template controls can be supplied per request; changing launch flags does not add a response parser. |
| Per-job cache isolation | Session and prefix caches exist, using session_id, prefix_cache_scope and explicit prefix_cache_write_tokens. cache_salt is unsupported. | Cache directories/checkpoints can be configured, but SOAR needs a scoped lifecycle adapter and isolation/history tests. The mechanisms are not interchangeable by renaming a field. |
| Context and scheduling | max-len, max-prefill, max-seq and seq-capacities are configurable. | Capacity can be changed within the actual hardware limit and requalified. The current configured total input/output ceiling is 208896. |
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
No inference allowance was consumed. The active service was left running.

## Implication for SOAR

Keeping q4t is possible with additional engineering. Preserving Heavy requires
real stochastic sampling as well as tool/reasoning and cache integration.
Alternatively, a named greedy experiment would require a design amendment;
the existing approval does not silently authorize changing Heavy semantics.

The NemoClaw-derived vLLM recipe remains a candidate, not a mandatory product or
a qualified deployment. In particular, its added fused GDN MTP operator is not
a demonstrated requirement for the proposed MTP-off Triton route. The current
service remains q4t. The candidate image and verified original weights are
staged, but its numerical tests and GPU/model startup have not run. H4/H5 remain
behind the compatibility gate.
