# Flash-Next service requirements for the owner

Status: **Proposed deployment contract; migration and evaluation sequence Approved**.
Prepared 2026-11-01 (Asia/Shanghai). The owner initially reserved service changes,
then authorized a controlled recipe trial if the current service can be restored
(BL-20261031-1815). The q4t stop/start test passed; the candidate image and verified original weights
are staged. The owner subsequently asked to check q4t itself; see the
[capability review](Q4T_SERVICE_CAPABILITY_REVIEW.md). No candidate GPU launch has run.
SOAR continues to use the current service only within its demonstrated capabilities;
the current q4t deployment has not qualified for Heavy, H4 or H5.

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
because the shell uses `:-`. The minimal base/SM110-MoE/GDN patch sources have
since received independent review; installed numerical/API behaviour is pending.

## Required service behaviour

| Area | Required behaviour |
| --- | --- |
| Model route | `GET /v1/models` advertises a stable model ID, preferably `qwen3.8-flash-next`. `POST /v1/chat/completions` actually routes that ID to the pinned checkpoint; replies report the same approved identity. The human box label `RM-01 VLM` is not a checkpoint identity. |
| Heavy sampling | Actually implement `temperature: 1`, `top_p: 0.95`, `top_k: 20`; do not reject, discard or coerce them to greedy sampling. |
| Native tools | Accept OpenAI-style function definitions, `tool_choice: "auto"`, `parallel_tool_calls: false`, assistant tool-call IDs and matching tool-result history. Return schema-valid native `tool_calls`, rather than XML in content. SOAR still rejects multiple actions before execution; field acceptance alone does not prove a model cannot emit multiple calls. |
| Thinking | Support thinking enabled with medium effort and thinking disabled through `chat_template_kwargs.enable_thinking`. Support explicit `preserve_thinking: false` for the qualified profile. Return reasoning separately from final content and tool arguments; pin whether the field is `reasoning` or `reasoning_content`. Thinking-off JSON must be the raw schema object with no reasoning or surrounding prose. |
| Streaming | Support `stream: true` and `stream_options: {"include_usage": true}`. Deliver complete SSE, native tool deltas, a terminal finish reason and final integer usage. Non-streaming requests must also work. |
| Accounting | Return real `prompt_tokens` and `completion_tokens`; expose actual cached-token details or independently attributable engine counters. Missing values must not be filled with invented zeroes. |
| Cache | Enable prefix caching and honour a job-specific `cache_salt`. Demonstrate same-job reuse and different-job isolation, including edited/demoted tool-result history. Global cache reuse or an undocumented session ID is insufficient. |
| Capacity | Allow 16,384 output tokens and enforce tokenized prompt + reserved output within a declared effective context, including template and tools. Target 262,144 context if this deployment can sustain it; a smaller limit must be explicitly recorded and guarded in SOAR before H4. No automatic prompt truncation. |
| Request transport | Accept bodies up to the existing 640 KiB limit and preserve streaming during the existing 900-second request timeout. Reverse proxies must not impose a shorter silent cutoff, rewrite model/tool fields, buffer the entire stream or retry inference automatically. |
| Operations | Expose version/build, model and health metadata plus authoritative active and queued inference counts. Idle means both counts zero in three samples at least 20 seconds apart; a bounded liveness request follows. A metadata HTTP connection is not an active inference. Cancellation must return the engine to idle. |

These are the relevant vLLM flags to verify in the selected build's own help and
effective configuration. They are a configuration fragment, not a complete Thor
installation or a command that has been tested on this box:

```text
--served-model-name qwen3.8-flash-next
--enable-auto-tool-choice
--tool-call-parser qwen3_coder
--reasoning-parser qwen3
--enable-prefix-caching
--enable-chunked-prefill
--max-num-seqs 1
--max-model-len 262144
```

One scheduler slot is sufficient for our sequential qualification. Choose
memory allocation, prefill batch size, kernel backends and PLE offload for the
actual Thor build; record them rather than copying another GPU's flags. Enable
`--enable-prompt-tokens-details` if the pinned build supplies that option, and
verify the resulting cache accounting. Existing telemetry-off requirements stay
in force. Keep the authorized access route; no new public listener is required.

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

After a changed service is prepared under the recorded authority, finish the role/configuration
binding and run the [migration plan's qualification](PHASE4_FLASH_NEXT_MIGRATION_V1.md#4-bounded-local-compatibility-qualification):
at most **24 zero-fee dispatches**, counting failures and cancellation, with the
existing token/time ceilings. Then run k2 local, r3 local and r3 split in order;
split calibration remains at most **USD 0.60**. H5 launch permission is already
granted, but its final pinned batch-start record requires passing qualification
and all three H4 loops; its counted-run bound remains **USD 21.60**.

Current status: q4t restoration and candidate asset preparation are verified;
q4t cannot meet Heavy through launch flags alone. Candidate live compatibility
and exact-token admission remain unresolved. No new inference dispatch,
qualification pass, H4 completion or H5 run is claimed. The original start cutoff
remains 2026-11-01 09:19 Asia/Shanghai unless the owner supplies a new window.
