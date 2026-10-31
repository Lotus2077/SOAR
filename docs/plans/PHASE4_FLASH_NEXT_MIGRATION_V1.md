# Phase 4 Flash-Next migration plan

Status: **Proposed**. Prepared 2026-11-01 (Asia/Shanghai).

The owner requested this design after confirming that the same device now serves
a different underlying model. Adopt Flash-Next as a new, explicitly identified
local evaluation tier only after approval and qualification. Preserve the
completed Claude calibration, run all three exposed H4 loops on the new tier,
then seek the separate H5 batch-start authority.

This document authorizes no runtime work. It names the amendment required by
BL-20261030-0445-h5-cloud-provider-claude: “Prompts and the local arm stay unchanged
unless the design names a change and the owner approves it.” Server changes
remain subject to PLAN D11 and a scheduled restart.

## 1. Evidence and remaining uncertainty

| Item | Current evidence | Consequence |
| --- | --- | --- |
| New endpoint | Advertises `qwen3.8-flash-next`; two synthetic non-streaming POSTs returned HTTP 200. The second completed with `stop`, but reasoning and a closing think tag appeared in ordinary content. | Basic chat works. Tool, streaming, thinking-off and Heavy compatibility remain unverified. |
| Serving readiness | Version route returned 404; metrics lacked the required running/waiting gauges. Owner confirms same box, different model. | Do not reuse the old `0.32.0` / `RM-01 VLM` serving pin or treat missing gauges as zero. |
| Actual model | Checkpoint revision, quantization, engine/build, template, parsers, context and device headroom are unknown. | A served alias or physical device name cannot establish the evaluated model. |
| Claude step 0 | Attempt 1 exited 3 for missing later thinking, triggering the allowed repeat; the repeat exited 2 for a warm read instead of the required initial cache write. The owner accepted their combined evidence once. | Retain both original verdicts and the adjudication; no third probe. |
| Claude step 1 | 79 cloud replies and 34 old-tier local judge calls settled; cloud fee USD 1.127758, approved projection USD 2.121435 below USD 3.00. Guidance review found no visible refusal. | Transport/cost calibration is reusable under its original configuration; task quality remains independently ungraded. |
| Console reconciliation | Owner screenshot shows SOAR-key cost USD 1.15; step-0/1 ledger total USD 1.151653, difference USD 0.001653 within USD 0.05. Earlier owner confirmation supplies the no-competing-usage condition. | Historical step 1 is accepted. The screenshot alone does not establish exclusive usage or qualify Flash-Next. |
| H4 / H5 | First H4 batch failed on infrastructure; replacement preflight failed. No completed qualifying H4 batch or counted H5 run. | New qualification and all three H4 loops precede H5. |

The Console image, key fragments, account details, endpoint addresses and raw
receipts stay outside Git. Public records retain only relevant amounts, counts,
hashes and limitations. Original results are never overwritten.

## 2. Proposed amendment and role binding

For Phase 4's upcoming H4 verification and H5 comparison, replace the former
Qwen3.8-27B local tier with the **qualified Flash-Next deployment recorded in a
new serving manifest**. Use the advertised `qwen3.8-flash-next` request identifier
if inventory confirms it maps to that deployment. `RM-01 VLM` may remain the
device's human label; it must not conceal a changed model in result metadata.

| Role | Proposed model and retained policy |
| --- | --- |
| Research reader; local writer; local repair writer | Flash-Next with existing stage budgets and Heavy writer policy |
| All-local planner and synthesiser | Flash-Next, existing stage overrides and 8,192-token caps |
| Split planner and synthesiser | Existing `claude-sonnet-5-5` Messages configuration |
| All-cloud task writer | Existing `claude-sonnet-5-5` Messages configuration |
| Local critic | Flash-Next; explicitly check its separately loaded configuration; existing 16,384-token bound |
| Entailment judge for every new arm, including all-cloud | Same Flash-Next deployment; thinking disabled, existing 256-token bound and schema |

Keep the current task prompts, tools, checks, selection rule, evidence budgets,
cloud egress destination, prices and caps. Writer Heavy remains thinking enabled,
temperature 1, top-p 0.95, top-k 20; 16,384 output tokens, 900-second request
timeout, 640 KiB request body; 80 model calls, 120 tool calls, a 90-minute
generation-session allowance shared by reading and writing, and 200 session
requests. Reader limits remain 24 index and 40 extraction calls. Each loop has
multiple sessions; post-submission entailment has its separate 15-minute bound.

The named client compatibility change, if needed, is a Flash-specific deployment
profile: explicit supported thinking settings, reasoning-field normalization and
history policy. Keep the current projected history, which omits prior reasoning;
request `chat_template_kwargs.preserve_thinking: false` and explicit
`chat_template_kwargs.enable_thinking` on/off where the inventoried engine
supports those settings. Do not add retained reasoning to history, adopt vendor sampling changes,
change output caps, or strip think tags globally as an incidental fix. If this
contract cannot work, stop with a concrete amendment instead of silently changing
the experiment.

After approval, amend PLAN's current local-tier and Phase 4 descriptions and link
the new Approved entry. Its Phase 2 arms/results and R2 conditional alternative
remain historical. R2 was not triggered; this is an owner-selected migration,
not a retrospective R2 outcome. D11 remains a separate server-change gate.

## 3. Inventory and implementation boundary

Before inference qualification, prepare a sanitized serving manifest with:

- Actual checkpoint source and immutable revision or artifact digest, conversion
  source/revision, weight and KV-cache quantization, tokenizer/template digests.
- Engine name, version and build/container digest; model routing/alias map;
  reasoning and tool parsers; thinking preservation; prefix caching, cache-salt
  behaviour, speculative decoding/offload and effective sampling defaults.
- Effective context limit and output limit; hardware/memory and current serving
  allocation sufficient to assess the existing Heavy envelope.
- Hashes of API destination and serving configuration, metadata-route contract,
  observation time and provenance. Keep raw routes, flags containing private
  paths, and diagnostic captures ignored; never include credentials.

Use existing accessible operator configuration or owner-supplied sanitized
inventory. Do not guess the engine from an OpenAI-compatible route, scan the
device, obtain shell access by another route, or restart it as part of inventory.
If configuration must change, present the exact diff and restart/rollback window
for D11 approval after identifying the actual engine.

Prefer correcting a demonstrated parser/template configuration at the server,
under D11, over compensating for malformed replies in every client. A client
adapter must be scoped to this qualified deployment and reject ambiguous
reasoning fields, malformed tool calls and incomplete streams. A returned
`reasoning` field and the legacy `reasoning_content` field need explicit tests;
no missing field may silently become evidence that thinking was disabled.

Implementation map (after approval):

| Area | Expected work |
| --- | --- |
| `src/main/config.ts`, ignored local configuration | Select the qualified model explicitly; retain endpoint and credential policies. Do not replace the global default for unrelated users. |
| `src/main/private-agent/model.ts`, `src/main/private-agent/broker.ts` and transport tests | Scoped request/response compatibility, SSE reasoning separation, fragmented tool calls, strict usage/terminal handling; preserve existing provider fixtures. |
| `src/main/private-agent/profiles.ts`, `research-pipeline.ts`, `claims.ts` | Verify retained per-role bounds and thinking modes; avoid unrelated tuning. |
| `scripts/private-agent-local-screen.ts`, `scripts/phase2-repair.ts`, `scripts/phase4-loop.ts` | Bind reader, writer, critic and judge to the same manifest; retain packet lineage, session identity and resume refusal on drift. |
| Ignored preflight/operator and experiment summaries | Add engine-specific operational evidence, manifest binding and explicit local-model provenance in every new run/registry row. |

Recompute the runtime digest after any runtime-source change and the research
protocol digest after any protocol change. A configuration-only swap can leave
the source digest unchanged: source, model/serving manifest and role-config hashes
must all match before and after each row. Link the old serving pin as historical
predecessor, never as qualification of the new deployment.

## 4. Bounded local compatibility qualification

Prepare and review the exact synthetic fixture manifest before starting. Use only
synthetic/public fixtures; no fresh H5 inputs, authoring transcript or gold. This
proposed batch permits **at most 24 local inference dispatches**, one at a time,
at declared zero fee, **131,072 total reserved output tokens**, and a **90-minute
batch ceiling** within the owner's available window. No request exceeds its
existing role timeout, output cap or request-body limit. Precompute the fixture
prompt-token total with the pinned tokenizer; admit at most **1,000,000 prompt
tokens** across the batch. Metadata collection is bounded to 5 minutes per gate.
Count failed/cancelled attempts against the same caps; disable automatic retries
for this qualification batch. Unused slots are not permission to tune against
failures or repeat the batch.

| Check | Required evidence / pass criterion |
| --- | --- |
| Operational guard | Version/build and model manifest match; authoritative running and waiting counts are both zero at three observations at least 20 seconds apart, followed by one bounded liveness request. For a different engine, document and test an equivalent queue/active-request contract. Missing, stale or ambiguous metadata fails closed. Every local reply must report a model matching the pinned alias-to-checkpoint map; missing or unexpected response identity blocks the row. Owner “idle” and `/models` alone are insufficient. |
| Text and thinking | Thinking-off synthetic answer contains only the requested final answer and no separate reasoning or reasoning/tag leakage. For JSON roles, check the raw content is only the schema object: the existing tolerant reader/judge parsers can extract JSON from surrounding prose, so their success alone cannot prove this. Thinking-on yields a valid final answer with reasoning separately represented under the qualified wire contract. Test both modes without relying on an exact reasoning-token count. |
| Heavy tool history | A three-turn synthetic tool loop at the existing Heavy request shape makes the two expected schema-valid tool calls in its first two replies, with distinct IDs, consumes matching results and completes. Assert the exact edited first tool-result bytes are present in request three; a no-tool or nudge path fails without extra calls. No raw tool syntax masquerading as final text or reasoning leakage into tool arguments. |
| Streaming and usage | Real SSE completes through the production decoder, with fragmented arguments reconstructed, explicit termination and valid final usage. Mock tests cover split UTF-8/JSON frames, missing usage, conflicting reasoning fields and truncation. Missing usage is a failure/unknown, never fabricated zero usage. |
| Structured local roles | Synthetic index/extraction, all-local plan/synthesis and critic fixtures satisfy the actual host schemas within their existing caps. Four trivial judge cases cover supported, partial, unsupported and contradicted using the existing thinking-off 256-token contract. Any malformed/truncated result blocks qualification; no tuning on H5 material. |
| Context | Establish actual tokenized prompt plus reserved output within the configured context, including chat-template/tool overhead. Exercise a large allowed synthetic prompt and an offline over-limit rejection. The existing byte/3 estimate is not a proof for a new tokenizer, and `SOAR_CONTEXT_MAX_INPUT_TOKENS` does not enforce this private-agent path. If a conservative guard cannot be validated, propose a guard change before H4. |
| Cache | Demonstrate accepted per-job salt, stable same-job reuse and distinct-job isolation using engine instrumentation, not latency alone. Qualify cache behaviour separately from token accounting; unsupported/ignored salt blocks this design. Any substitute or disabling of caching needs a named amendment. |
| Cancellation and failure | One bounded synthetic cancellation verifies abort and return to idle without replay. Offline tests cover timeout, early stream close, malformed usage, context rejection and exhausted allowance; preserve receipt classification and cloud at-most-once semantics. |

All liveness, cache, context and cancellation inference requests count toward
the same 24-dispatch and token ceilings. Fixture dispatch and output reservations must fit the global caps; overlapping
checks share one fixture where appropriate. Record request shapes/hashes, expected
schema/assertions and role settings before running. A pass proves compatibility
of that manifest with those cases, not quality, sustained throughput, privacy
qualification or immunity to later server failure.

Run focused transport/config/role tests and both typechecks. Before H4, the final
integrated migration source must pass `pnpm check`, build-log append-only and
readiness checks, production build and applicable CI. Review tests for preserved
old-provider behaviour, rather than updating golden fixtures to accept regressions.

## 5. H4 verification and split calibration

After approved migration work, local qualification and final source verification,
create a new immutable H4 authority binding the serving manifest, endpoint hash,
role settings, runtime/protocol/image/task pins, operator hashes, approved caps,
Console acceptance and a valid availability window. The existing inactive
operator must be adapted and reviewed; do not merely replace its old serving pin.

Run in order, stopping on the first failed gate:

1. `k2-qbr-deck-loop-local` — execute the deck check.
2. `r3-grid-batteries-loop-local` — complete the local research loop.
3. `r3-grid-batteries-loop-split` — sample `a` also supplies Claude calibration
   step 2, within the existing **USD 0.60** cloud cap. Samples `b` and repair
   reuse its packet; no extra cloud planning/synthesis for them.

All three must reach final selection with no loop failure, and every stage must
classify as counted under one final migration identity. Each research loop's
sample `b` and repair must start from its own sample `a` packet;
`writeIdentityEqual` must hold for samples `a`/`b`. Repair additionally carries
its own verified critique/draft lineage. Never seed from an old-model run.
Check initial and final pins for every stage and the independently loaded critic.

Step 2 additionally needs a schema-valid plan within the 40-read allowance, a
digest-bound cited argument using known evidence references, neither cloud call
ending at length, and actual fees within USD 0.60. Root review must establish a
usable plan and cited argument; nonempty prose or syntactically valid references
alone are insufficient. H4 mechanics do not require task-quality acceptance;
step-2's separate calibration criteria still apply.

A changed runtime/protocol/serving identity after any loop invalidates the batch's
coherent qualification: preserve the results and plan all three again. No silent
retry or automatic paid repeat. Additional split calibration or cloud evidence
needs a specific recorded budget decision when not already authorized.

## 6. H5 handoff, comparability and spend

Keep the three frozen fresh research tasks, 23 critical checks, three arms and two
labelled repeats per arm: **18 counted runs**. “Repeat” does not claim an RNG seed;
the current model configuration exposes no seed. Packet seeding inside a loop is
a separate deterministic lineage requirement. Preserve blind grading and decision
rules with three-party separation: task author, harness implementer, and a
scoring/bundling/S3 session that is neither of those. The task author cannot grade
their own fresh outputs. A session exposed to fresh gold cannot implement the
provider or harness changes.

Use the same qualified Flash-Next judge across all new H5 arms, including the
Claude all-cloud arm. Old entailment counts remain old-judge evidence and must
not be pooled as a controlled Flash comparison. A common new judge enables a
consistent comparison but does not remove judge bias; independent acceptance
and critical checks remain distinct. Historical Phase 2 model-gap conclusions
are not retested or overturned by migrating this Phase 4 harness.

Retain the Claude model, prompt projection, Messages adapter, rate settings,
geography/tier, cache policy and prices. Changing the local tier alone requires
**no paid repeat of step 0 or step 1**. If implementation changes their cloud
request/settlement contract, identify the affected proof and obtain narrowly
scoped replacement calibration authority before using it.

| Spend item | Treatment |
| --- | --- |
| Completed steps 0/1 | USD 1.151653 settled; Console reconciled at cent precision |
| Proposed local qualification and local H4 work | USD 0 declared inference fee; bounded device use as above |
| Remaining H4 split step 2 | Existing USD 0.60 cap; no increase requested |
| H5 counted runs | Existing USD 21.60 bound, inside the USD 33 Phase 4 line and USD 300 envelope; separate launch authority |
| Server changes, extra retries or replacement paid calibration | No new authority/budget from this plan |

The original calibration start cutoff is **2026-11-01 09:19 Asia/Shanghai**
(`2026-11-01T01:19:14.660899Z`). Plan approval does not extend it. Before any
admission, check availability and cutoff; if expired or withdrawn, record a new
owner-declared window. H5 still requires its own batch-start entry naming the
new local tier, cloud model/prices/caps, all digests and passed H4/step-2 evidence.

## 7. Approval, stop and rollback

Approval of this plan would authorize the named Phase 4 local-tier amendment,
scoped client/operator implementation and offline tests, the bounded local
qualification, and the three exposed H4 loops only after all preceding gates
pass within a valid window and existing caps. It would not authorize unknown
server changes, a restart, H5, private data, additional paid calibration or release.

Stop on identity drift, missing operational evidence, response/schema/accounting
failure, a failed compatibility case, infrastructure instability, cap exhaustion
or lost device availability. Window expiry blocks new admissions; an already
admitted row finishes within its normal bounds unless availability is withdrawn.
Retain every attempted receipt and
failure. Do not switch back to the old model inside a batch. Restoring its exact
deployment and rerunning its readiness checks is a separate recorded choice;
never change the meaning of earlier rows to make either tier pass.

Done means: approved named deployment; verified compatibility; verified source;
three coherent H4 loops plus split calibration; accurate append-only records;
and a concrete H5 handoff ready for its separate launch decision. Until then the
status remains Proposed/Implemented/Verified at the specific stage reached.

## 8. Sources and implementation caveats

Official sources checked 2026-11-01; they describe upstream software, not proof
of what runs on the owner's device:

- [Qwen Flash-Next model card](https://huggingface.co/Qwen/Qwen3.8-Flash-Next):
  thinking defaults, `enable_thinking` and `preserve_thinking` API controls.
- [vLLM exact-model recipe](https://github.com/vllm-project/vllm/blob/main/recipes/models/Qwen/Qwen3.8-Flash-Next.yaml):
  upstream example uses `qwen3_coder` for tools and `qwen3` for reasoning. These
  are candidates to verify against the actual engine/build, not approved flags.
- [vLLM reasoning output contract](https://docs.vllm.ai/en/stable/features/reasoning_outputs/):
  current documentation uses `reasoning` and identifies the older
  `reasoning_content` spelling. Pin and test the deployed version's actual schema.

Project authority: PLAN sections 4/5 and D11; BL-20261030-0445,
BL-20261030-0620, BL-20261030-0745, BL-20261031-1318,
BL-20261031-1328, BL-20261031-1342, BL-20261031-1556 and
BL-20261031-1604. Their full entry identifiers in BUILD_LOG remain authoritative.
