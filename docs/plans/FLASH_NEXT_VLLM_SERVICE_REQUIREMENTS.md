# Flash-Next service requirements for the owner

Status: **Proposed deployment contract; sequence Approved; startup and six-case CPU parity Verified; shared guard Implemented; integrated verification and inference qualification pending**.
Updated 2026-11-01 (Asia/Shanghai). **The owner authorized an investigated retry
and a clean-page-cache operation** (BL-20261031-2021), following the first failed
NemoClaw-derived attempt and verified scoped manual q4t recovery
(BL-20261031-2003-nemoclaw-trial-failed-q4t-recovered). The second attempt reached
readiness at 04:37:27 Asia/Shanghai, about 321 seconds after model-container start
(BL-20261031-2040-nemoclaw-retry-ready). The candidate is running under its
recovery supervisor; q4t is stopped with its restoration assets retained.
Internal and user-facing health, model, version and metrics routes returned
HTTP 200. No chat-completion or Heavy compatibility proof is claimed.
See the [q4t capability review](Q4T_SERVICE_CAPABILITY_REVIEW.md).
The preserved q4t deployment remains limited to its supported contract; its
recovery does not qualify it for Heavy, H4 or H5 or authorize an engine rewrite.

## Owner handoff

1. Prepare a Flash-Next-capable vLLM build for ARM64/SM110 and an immutable
   checkpoint. Any build that passes the contract below is acceptable; the
   NemoClaw-derived image is one prepared candidate.
2. Enable native tool/reasoning parsers, prefix caching and usage details using
   the configuration fragment below. Preserve request-level Heavy sampling.
   Pin the actual context capacity and generation defaults.
3. Make model, health, version and engine metrics reachable over the existing
   authorized route. Provide the exact tokenizer/template or an equivalent
   template-aware tokenization interface for SOAR's pre-dispatch admission check.
4. Return the model revision, image/build identity, effective non-secret launch
   command, context limit and routes. SOAR then binds every local role, including
   the judge, and performs the already-approved bounded qualification.

The owner handoff remains a reusable contract. The second candidate is ready for
the remaining admission and qualification work. A running listener alone is not
a compatibility pass. All 24 qualification generation requests remain unused.

The first trial's 22 selected added-operator numerical cases passed, with 64 deselected
and zero skipped. It loaded all 206 shards (reported model load 74.34 GiB),
completed initial profiling/compilation, then stalled for more than seven minutes after logging
31.44 GiB of KV capacity. No healthy API was observed. An NVIDIA interrupt warning
and a utilization-query timeout occurred, but their causal role is unproven.
The operator stopped the attempt; no startup-deadline outcome is claimed.
A Docker zombie caused the automatic removal failure; its recovery guard
correctly refused an overlapping restore. Later process exit, identity-checked
non-force removal, absence of both trial containers, exclusive lease, empty GPU
compute list, free listener port and owned recovery marker permitted one scoped
manual q4t restore. These are startup/cleanup/recovery observations, not serving
or inference qualification.

The owner subsequently requested an investigation and another trial, including
cleaning the system cache (BL-20261031-2021). The fuller kernel interval shows
driver-lock blocking that began before the stop, followed by NVIDIA allocation
failures during cleanup. Installed source places the capacity log before actual
KV allocation and final engine warmup; the preceding profile/warmup messages did
not prove those later stages completed. The exact first blocked call was not
captured. Memory pressure during cache initialization is the leading hypothesis,
not an established single cause.

The approved diagnostic retry retains the model, 262,144-token context and all
experiment semantics, with an explicit 12 GiB KV pool
(`--kv-cache-memory-bytes 12884901888`), startup-only phase/stack diagnostics,
Docker init/reaping, and up to 60 minutes from startup within the owner window.
After stopping q4t and obtaining verified exclusive GPU access, it synchronizes
writes and clears clean filesystem pages once using `drop_caches=1`; existing
on-disk model and compiled-kernel caches remain. This is the Linux
[page-cache debugging operation](https://docs.kernel.org/admin-guide/sysctl/vm.html#drop-caches),
not CUDA-memory reclamation. Its separate effects cannot be isolated from the
smaller KV budget, retained build caches and diagnostics in this retry.

The operation reduced Linux `Cached` from 1,117,980 to 410,532 KiB and increased
`MemAvailable` from 122,136,392 to 122,560,152 KiB. The selected numerical gate
again passed 22 cases, with zero skips and 64 deselected. All 206 shards loaded;
the instrumented KV allocation and final warmup returned, including CUDA graph
capture (6 seconds, 0.16 GiB). Engine initialization took 90.62 seconds. The engine
reported 479,856 KV tokens and 1.83 times the fixed 262,144-token context; metadata
confirmed that context without automatic reduction. Exact running image,
arguments, selected environment, init setting and read-only diagnostic overlays
were checked. At 04:40 Asia/Shanghai, running/waiting and generation-success
counters were zero. The NVIDIA interrupt warning recurred, but no new allocation
failure or blocked-task report appeared in the captured retry kernel interval.
The successful startup did not need the extended 60-minute allowance. This
supports the revised configuration, without isolating a single cause of the
first failure or proving generation, tools, reasoning, cache isolation or full
context inference. No generation has been dispatched.

## Source of the Thor candidate

The candidate is the community-maintained
[NemoClaw-Thor recipe](https://github.com/pastoriomarco/NemoClaw-Thor/blob/main/serving/docs/QWEN38-FLASH-NEXT-FAST-THOR.md),
a source for the staged image, which is not a SOAR-qualified backend. Its
[launcher](https://github.com/pastoriomarco/NemoClaw-Thor/blob/main/serving/start-qwen38-flash-next-fast.sh)
enables prefix caching and native tool/reasoning parsers. The published tool
evaluation used temperature zero; it does not establish our Heavy sampling or
per-job cache isolation. The subsequently reviewed immutable Nemo revision is
`dd07dcc2f5650916e18e2c706144c6fd1f8bf13c`. Device identity itself comes from
the SSH inventory in BL-20261031-1723; the recipe supplies backend evidence.

The underlying [blazux Dockerfile](https://github.com/blazux/qwen3.8-Flash-DGX/blob/4b723de2e2c465d866738b57ae64bde6e8c07744/Dockerfile)
is pinned at `4b723de2e2c465d866738b57ae64bde6e8c07744`. The published Thor build
adds SM110-specific overlays. This is a candidate recipe, not a requirement to
install that particular community stack. Another backend is acceptable if its
actual pinned deployment passes the same contract and qualification.

Do not copy its fast defaults invisibly: the launcher selects converted FP8
side-layer weights, BF16 recurrent state, MTP and a restricted draft vocabulary.
Those settings must be explicit in the deployment record. Setting its draft
vocabulary environment variable to an empty string does not disable the default
because the shell uses `:-`. The staged base/SM110-MoE/GDN patch sources have
received independent review; the 22 selected added-operator numerical cases
passed, while ordinary serving/API behaviour remains unqualified.
The added GDN/MTP CUDA overlay and its numerical test selection are not general
requirements for an MTP-off deployment using ordinary Triton decoding.

## Required service behaviour

| Area | Required behaviour |
| --- | --- |
| Model route | `GET /v1/models` advertises a stable model ID, preferably `qwen3.8-flash-next`. `POST /v1/chat/completions` actually routes that ID to the pinned checkpoint; replies report the same approved identity. The human box label `RM-01 VLM` is not a checkpoint identity. |
| Heavy sampling | Actually implement `temperature: 1`, `top_p: 0.95`, `top_k: 20`; do not reject, discard or coerce them to greedy sampling. |
| Native tools | Accept OpenAI-style function definitions, `tool_choice: "auto"`, `parallel_tool_calls: false`, assistant tool-call IDs and matching tool-result history. Return schema-valid native `tool_calls`, rather than XML in content. SOAR still rejects multiple actions before execution; field acceptance alone does not prove a model cannot emit multiple calls. |
| Thinking | Support thinking enabled with medium effort and thinking disabled through `chat_template_kwargs.enable_thinking`. Support explicit `preserve_thinking: false` for the qualified profile. Return reasoning separately from final content and tool arguments; pin whether the field is `reasoning` or `reasoning_content`. Thinking-off JSON must be the raw schema object with no reasoning or surrounding prose. |
| Streaming | Support `stream: true` and `stream_options: {"include_usage": true}`. Deliver complete SSE and native tool deltas, then a terminal finish reason, final integer usage with `choices: []`, and `[DONE]` with complete newline framing. No further reasoning/content/tools after finish and no response payload after final usage. Non-streaming requests must also work. |
| Accounting | Return real `prompt_tokens`, `completion_tokens` and `usage.prompt_tokens_details.cached_tokens` in both response modes. The current SOAR client reads the per-response cache field; engine counters alone are not a drop-in replacement. Missing cache details would otherwise decode as zero, so qualification must reject that omission rather than claim measured zero reuse. |
| Cache | Enable prefix caching and honour a job-specific `cache_salt`. Demonstrate same-job reuse and different-job isolation, including edited/demoted tool-result history. Global cache reuse or an undocumented session ID is insufficient. |
| Capacity | Allow 16,384 output tokens and enforce tokenized prompt + reserved output within a declared effective context, including template and tools. Target 262,144 context if this deployment can sustain it; the actual limit must be explicitly recorded and guarded in SOAR before qualification. No automatic prompt truncation. |
| Exact tokenization | Supply the frozen tokenizer, chat template and rendering settings, or a template-aware tokenization API such as `/tokenize` supported by the selected build. It must count the same messages, tools, assistant tool arguments and thinking settings as generation. Plain-text token counts and body-byte estimates are insufficient. The shared hash-bound admission hook is implemented with passing focused tests and independent reviews; full integrated verification passed (2247 tests; production build). |
| Request transport | Accept bodies up to the existing 640 KiB limit and preserve streaming during the existing 900-second request timeout. Reverse proxies must not impose a shorter silent cutoff, rewrite model/tool fields, buffer the entire stream or retry inference automatically. |
| Operations | Expose version/build, model and health metadata plus authoritative active and queued inference counts. Idle means both counts zero in three samples at least 20 seconds apart; a bounded liveness request follows. A metadata HTTP connection is not an active inference. Cancellation must return the engine to idle. |

These are the relevant vLLM flags to verify in the selected build's own help and
effective configuration. This partial configuration omits the remaining Thor
installation and launch steps. The failed candidate accepted these serving
options during startup; it never reached a healthy API or compatibility pass:

```text
--served-model-name qwen3.8-flash-next
--enable-auto-tool-choice
--tool-call-parser qwen3_coder
--reasoning-parser qwen3
--enable-prefix-caching
--enable-prompt-tokens-details
--enable-chunked-prefill
--max-num-seqs 1
--max-model-len 262144
```

Chunked prefill, one scheduler slot and the 262,144-token target are proposed
deployment choices, not universal client requirements. One slot is sufficient
for our sequential qualification. Choose
memory allocation, prefill batch size, kernel backends and PLE offload for the
actual Thor build; record them rather than copying another GPU's flags. If
`--enable-prompt-tokens-details` is unavailable, an equivalent implementation
must still populate the actual per-response cached-token field; counters alone
would require a separately implemented SOAR integration. The 16,384 output allowance is the
request's `max_tokens`, not another launch flag. Existing telemetry-off requirements stay
in force. Keep the authorized access route; no new public listener is required.

For operational inspection, expose `GET /v1/models`, `GET /health`,
`GET /version` and `GET /metrics`, or document a source-verified equivalent for
any unavailable route. Metrics must include `vllm:num_requests_running` and
`vllm:num_requests_waiting` (or equivalent authoritative engine gauges), plus
usable cache accounting. Do not substitute proxy connection counts. These
metadata reads do not generate tokens; the subsequent liveness generation
counts against the 24-request allowance.

The flags are documented in the [vLLM CLI reference](https://docs.vllm.ai/en/latest/cli/serve/).
The [prefix-cache design](https://docs.vllm.ai/en/latest/design/prefix_caching/)
describes per-request salt isolation, and the
[metrics reference](https://docs.vllm.ai/en/latest/usage/metrics/) identifies the
engine gauges. These upstream documents describe interfaces, not proof that a
particular Thor build implements every feature for this checkpoint.

The Heavy request contract includes the following values in addition to the
messages and tool schemas:

```json
{
  "model": "qwen3.8-flash-next",
  "max_tokens": 16384,
  "temperature": 1,
  "top_p": 0.95,
  "top_k": 20,
  "reasoning_effort": "medium",
  "chat_template_kwargs": {"enable_thinking": true, "preserve_thinking": false},
  "tool_choice": "auto",
  "parallel_tool_calls": false,
  "stream": true,
  "stream_options": {"include_usage": true},
  "cache_salt": "<job-specific hash>"
}
```

This illustrates the intended qualified Flash profile. Current SOAR thinking-on
requests already send medium effort and Heavy sampling; explicit template
settings are implemented behind the explicit `flash_next_v1` opt-in. That opt-in
also requires the pinned `SOAR_VLLM_CONTEXT_TOKENS`; exact pre-dispatch tokenization
is still an operator gate before qualification/H4/H5. Tool-less calls omit
all tool fields. Thinking-off calls set `enable_thinking: false`, omit medium
effort and currently omit Heavy sampling; record the effective server sampling
defaults they inherit. Do not infer those defaults from the writer's overrides.

## Model and configuration record

Before qualification, provide or allow read-only collection of:

- Checkpoint repository and immutable revision; full weight-file hashes or
  verified published blob hashes; any conversion source and output hashes.
- Weight, KV and recurrent-state precision; tokenizer and chat-template hashes.
- Engine version/source revision, installed patches and immutable image digest;
  the selected image must support ARM64/SM110 on this host.
- Effective non-secret launch arguments, generation defaults, cache/parser
  options, context/output limits, MTP/draft-vocabulary/offload settings.
- Alias-to-checkpoint mapping and metadata/metrics routes. Private addresses,
  filesystem paths, credentials and raw diagnostics stay outside Git.

An original-checkpoint candidate is
[RadixArk revision `7b719225242aacd3dbd3f9407468c2ee9a9d2594`](https://huggingface.co/RadixArk/Qwen3.8-Flash-Next-NVFP4/tree/7b719225242aacd3dbd3f9407468c2ee9a9d2594).
The current SSD-Stream directory is not directly interchangeable with the vLLM
mmap recipe: its PLE table is a sidecar, while the
[pinned loader](https://github.com/blazux/qwen3.8-Flash-DGX/blob/4b723de2e2c465d866738b57ae64bde6e8c07744/src/vllm_ple_mmap.py)
expects original safetensors. Unchanged files may be shared through read-only
staging only after their hashes match; filenames alone are not proof. Trial
preparation matched all 196 reusable weight shards by published SHA-256 and
downloaded and SHA-256-verified the ten original PLE shards. All 206 original
weight files are now staged (135,195,303,851 bytes). No weight conversion is planned.

## Local roles and subsequent gates

All roles below must bind to the same qualified model/serving manifest; each
role's effective request configuration also receives its own digest.

| Local role | Retained bound |
| --- | --- |
| Reader index / extraction | Thinking off; 24 × 1,536 / 40 × 2,048 output tokens |
| All-local planner / synthesiser | Existing stage settings; up to 2 × 8,192 each |
| Writer / repair | Heavy, thinking on; 16,384 output tokens per call |
| Separately loaded critic | Existing thinking settings; 16,384 output tokens |
| Entailment judge across every new arm | Thinking off; 256 output tokens per call; separate 15-minute bound |

Claude remains the all-cloud writer and split planner/synthesiser. The accepted
Claude step-0/1 calibration does not need a paid repeat solely for this migration.

After the owner or the authorized trial prepares the changed service, finish the role/configuration
binding and run the [migration plan's qualification](PHASE4_FLASH_NEXT_MIGRATION_V1.md#4-bounded-local-compatibility-qualification):
at most **24 zero-fee dispatches**, counting failures and cancellation, with the
existing token/time ceilings. Then run k2 local, r3 local and r3 split in order;
split calibration remains at most **USD 0.60**. H5 launch permission is already
granted, but its final pinned batch-start record requires passing qualification
and all three H4 loops; its counted-run bound remains **USD 21.60**.

Current status: the second candidate's startup and metadata are verified; q4t
is stopped under the recoverable trial. Its earlier recovery remains evidence
of the fallback, not a fresh rollback test of this retry. The ignored qualification
driver passed 26 synthetic tests and a strict TypeScript check; CPU tokenizer and
metadata helpers passed 9 and 22 mock tests and received independent review.
Six synthetic CPU comparisons returned identical token IDs from tokenization
and the installed generation renderer (BL-20261031-2049-flash-tokenizer-parity).
Shared exact-token admission is implemented for every local H4/H5 role, including
the separately loaded critic and judge, with passing focused tests and independent
reviews. Full integrated verification, final role/fixture pins and generation
compatibility remain pending. CPU parity and offline checks do not qualify
generated replies, cache isolation, tools or Heavy behavior.
No generation was dispatched, all 24 qualification slots remain unused and new
spend is USD 0. No qualification pass, H4 completion or H5 run is claimed. The original start cutoff
remains 2026-11-01 09:19 Asia/Shanghai unless the owner supplies a new window.
