# Phase 4 Flash-Next migration plan

Status: **Approved sequence; shared admission integration Verified; qualification stopped at Q13; approved diagnostic completed; deployment not yet qualified**. Prepared 2026-11-01
(Asia/Shanghai). Authority: BL-20261031-1759-flash-next-sequence-owner-approved.

Updated after owner-authorized inventory, the failed first startup and the
approved instrumented retry on 2026-11-01. The retry candidate now serves healthy
owned API/model metadata; q4t is stopped with its verified recovery assets
retained. Neither deployment has passed the retained Heavy qualification.
The owner selected the suitable-backend path, approved the bounded qualification
and H4 sequence, and separately granted H5 launch permission. The owner then
reserved service modifications for himself, then conditionally authorized a
recoverable recipe trial (BL-20261031-1815). After an intervening owner-operated
handoff, the owner explicitly resumed that trial because q4t stop/start recovery
had passed (BL-20261031-1936). The first attempt failed startup; automatic
cleanup failed and scoped manual reconciliation restored q4t
(BL-20261031-2003-nemoclaw-trial-failed-q4t-recovered). The owner then approved a
separate diagnostic retry with fixed 12 GiB KV and context 262144; it reached API
readiness (BL-20261031-2021-nemoclaw-diagnostic-retry-approved;
BL-20261031-2040-nemoclaw-retry-ready). See the
[exact owner handoff](FLASH_NEXT_VLLM_SERVICE_REQUIREMENTS.md).

The owner requested this design after confirming that the same device now serves
a different underlying model. Adopt Flash-Next as a new, explicitly identified
local evaluation tier only after qualification. Preserve the
completed Claude calibration, run all three exposed H4 loops on the new tier,
then record the final pinned H5 batch start under the launch permission already
granted. Permission does not waive the preceding technical gates.

The recorded owner approval supplies the named amendment required by
BL-20261030-0445-h5-cloud-provider-claude: “Prompts and the local arm stay unchanged
unless the design names a change and the owner approves it.” The conditional
trial retains its recorded configuration, recovery requirement and operational
window; its reauthorization does not waive qualification or evaluation gates.

Current outcome: the second candidate attempt reached a healthy owned API at
2026-10-31 20:37:27 UTC, about 321 seconds after server start. It retains the
original checkpoint/image and context 262144 with one sequence; the sole
serving-argument change is a fixed 12 GiB KV pool. q4t is stopped and recoverable,
not serving alongside it. The earlier
[capability review](Q4T_SERVICE_CAPABILITY_REVIEW.md) still establishes q4t's
sampling and native-response gaps. The failed first startup, failed automatic
cleanup and verified manual q4t recovery remain separate historical results.
Six synthetic CPU renderer/tokenizer cases have matching token IDs
(BL-20261031-2049), and shared admission for every local role passed full
integrated verification: 2247 tests, 81 explicit skips and production build
(BL-20261031-2104). The frozen one-shot qualification stopped at Q13 after 12
passed fixtures and 13 zero-fee wire requests/dispatch receipts. A separately
approved one-request diagnostic then settled at USD 0: native/SSE/accounting and
385-token prompt parity passed, with 641 output tokens. Both heading predicates
failed because the exact section titles were plain paragraphs; the prompt and
design do not explicitly require heading syntax (BL-20261031-2141-q13-diagnostic-result).
Original Q13 remains UNKNOWN, its cause unresolved and qualification unaccepted.
Aggregate use is 14 attempts with 10 unused dispatch slots, while all 11 original
remaining cases are still unattempted. Three post-diagnostic idle samples passed.
No paid call, production-source change or service change occurred. The new H4
loops and H5 remain held; there is no automatic continuation or retry.
The ongoing H4/H5 instruction is recorded in BL-20261031-2158. The named
[qualification continuation](PHASE4_FLASH_NEXT_QUALIFICATION_CONTINUATION_V1.md)
passed offline and independent review and is activated under BL-20261031-2205
for one execution within the original caps and deadline. The new diagnostic
passes the appended literal section adjudication; qualification acceptance
remains pending and all historical negative results are preserved.

## 1. Evidence and remaining uncertainty

| Item | Current evidence | Consequence |
| --- | --- | --- |
| Earlier q4t chat probes | The former route advertised `qwen3.8-flash-next`; two synthetic non-streaming POSTs returned HTTP 200. The second completed with `stop`, but reasoning and a closing think tag appeared in ordinary content. | These historical q4t replies do not qualify the now-active vLLM candidate or establish q4t tool, streaming, thinking-off or Heavy behavior. |
| Current serving readiness | The retry serves vLLM `0.1.dev20073+g8e685d198`; internal and user-facing health, model-list, version and metrics checks returned HTTP 200 at 20:40 UTC. Owned image/init, selected environment/arguments and read-only diagnostic overlays matched their pins; metadata advertises context 262144. | Candidate API readiness is verified. No generation, sampler/tool/cache contract, tokenizer parity or model-quality pass is implied. |
| Preserved q4t deployment | Thor device; q4t binary and clean source tree hashed; model directory `Qwen3.8-Flash-Next-NVFP4-SSD-Stream`, config declares modelopt NVFP4. Tokenizer/template/config/index hashes retained. Its prior unit is now inactive/dead. | Recovery assets are retained. q4t's immutable weight revision/full weight digests, binary-to-source build correspondence and exact route-to-checkpoint binding remain unverified. Candidate checkpoint verification is separate. |
| First candidate startup | All 206 original weight shards verified; 22 selected operator cases passed (64 deselected, zero skipped). Model load reported 74.34 GiB. Initial compilation/profile warmup completed, then progress stopped for over seven minutes after a 31.44 GiB KV-capacity log. Completed cache initialization and final engine warmup were not proven. The operator stopped it before the 30-minute deadline, without a healthy API. | Fuller kernel evidence shows driver blocking before stop and allocation failures after stop began. The initial blocked allocation/cause remains unproven; operator tests do not qualify MTP-off serving. |
| First-attempt cleanup and recovery | Docker zombie prevented automatic container removal and the guard blocked restoration. After process exit, identity-checked non-force removal and lease/GPU/listener/marker checks permitted one manual restore, which verified q4t. | Preserve failed automatic rollback alongside successful manual recovery. q4t was subsequently stopped again for the approved retry; this does not establish a second completed restore. |
| Retry startup | All 206 shards loaded at 74.34 GiB; 22 selected operator cases passed (64 deselected, zero skipped). With fixed 12 GiB KV, total engine initialization completed in 90.62 s, including final CUDA-graph capture in 6 s using 0.16 GiB. Capacity reports 479856 tokens, 1.83 times context 262144; healthy API arrived in about 321 s. | Startup now reaches readiness. Added-operator checks, reported capacity and graph capture do not qualify actual Heavy requests. The larger 60-minute bound was not needed to reach readiness. |
| Retry observations | After verified idle/q4t stop, one synchronized page-cache drop changed Cached from 1117980 to 410532 KiB and MemAvailable from 122136392 to 122560152 KiB. The interrupt warning recurred; no new allocation failure or blocked-task report was observed through 20:40 UTC. Running/waiting, completion-reason and prefix-cache query/hit counters were zero. | Reduced KV, cache preparation, retained build caches, diagnostics and wait policy were not isolated. Neither successful startup nor the bounded kernel observation identifies the first stall's cause or proves stability/cache behavior. |
| CPU parity and admission integration | Six synthetic cases have matching token IDs between tokenization and the installed generation renderer. The shared guard passed full integrated checks (2247 tests, 81 explicit skips, production build). The ignored driver passed 26 synthetic tests; tokenizer/metadata helpers passed 9/22 mock tests. Serving, role and fixture identities were frozen for the one-shot batch. | Integration is verified, while generation qualification remains incomplete. CPU parity does not establish generated-output behavior. |
| Partial one-shot qualification | Q01–Q12 passed, including native SSE tools/history demotion, thinking on/off, index/plan/extraction and A/A/B/B cache reports 0/15680/0/15680 with independent counters. Thirteen wire requests and dispatch receipts were recorded, with USD 0 new fees. | Q13 stopped the batch; eleven slots were unsent and cannot automatically be used for continuation or retry. The new H4 loops and H5 remain unstarted. |
| Q13 stop and diagnosis | The wire observer counted 648 SSE events, one usage frame, one DONE and zero parse failures. The receipt is UNKNOWN/`response_or_usage_invalid`; the wrapper code is `research_stage_invalid`. The original validation category was not retained. Offline review separately proved the fixture rejects valid Setext and closing-hash headings. | Q13 content was not retained, so neither this validator defect nor a backend failure can be assigned as its cause. Its UNKNOWN receipt remains unchanged after the separately approved diagnostic. |
| Post-stop service observation | Healthy/idle metadata was observed at 21:09 UTC. Thirteen generation HTTP 200 log entries, no server errors and no new kernel allocation failures were captured through 21:12 UTC. | This bounded observation supports continued service availability, not successful qualification or a stability guarantee. |
| Completed approved diagnostic | One fresh-job reconstruction settled at USD 0. Native reply/SSE assembly/model settlement passed; exact prompt usage was 385 tokens with 641 output tokens. Required titles were plain paragraphs, so both heading predicates failed while fact/citation checks passed. Three post-request idle samples passed. | The prompt/design do not explicitly require heading syntax. This new result does not explain original Q13 or accept qualification. Aggregate use is 14 attempts with 10 unused dispatch slots; all 11 original remaining cases are still unattempted. No automatic continuation, paid call, production-source change or service change occurred (BL-20261031-2141-q13-diagnostic-result). |
| Claude step 0 | Attempt 1 exited 3 for missing later thinking, triggering the allowed repeat; the repeat exited 2 for a warm read instead of the required initial cache write. The owner accepted their combined evidence once. | Retain both original verdicts and the adjudication; no third probe. |
| Claude step 1 | 79 cloud replies and 34 old-tier local judge calls settled; cloud fee USD 1.127758, approved projection USD 2.121435 below USD 3.00. Guidance review found no visible refusal. | Transport/cost calibration is reusable under its original configuration; task quality remains independently ungraded. |
| Console reconciliation | Owner screenshot shows SOAR-key cost USD 1.15; step-0/1 ledger total USD 1.151653, difference USD 0.001653 within USD 0.05. Earlier owner confirmation supplies the no-competing-usage condition. | Historical step 1 is accepted. The screenshot alone does not establish exclusive usage or qualify Flash-Next. |
| H4 / H5 | Owner approved the sequence and H5 launch. First H4 batch failed on infrastructure; replacement preflight failed. No completed qualifying H4 batch or counted H5 run. | New qualification and all three H4 loops precede H5; the blocker is technical readiness, not missing H5 permission. |

The Console image, key fragments, account details, endpoint addresses and raw
receipts stay outside Git. Public records retain only relevant amounts, counts,
hashes and limitations. Original results are never overwritten.

### 1.1 Read-only inventory findings and the selected design path

The earlier read-only inventory reached an NVIDIA Jetson AGX Thor Developer Kit,
Ubuntu 24.04, aarch64, 14 CPUs and 128,828,748 KiB RAM (about 122.9 GiB). Its then-active
binary reported q4t v0.1.0. Its SHA-256 is
`0c5ab1de85ff68f9d757ac3bfad04187756a1b2c6634108c3112a5861c209483`;
the adjacent clean tracked source is at
`24b97e7d50ec7d81eaabcf11ef3f7c7be3587a35`. These are separate observations,
not a reproducible-build proof. The supplied credentials were used only for
authentication; no credential file or committed credential was created.

That q4t launch explicitly set `--max-seq 1`, `--max-prefill 8192` and
`--max-len 208896`. The checkpoint's 262,144 declaration does not override that
serving limit. A 16,384-token output reservation leaves at most **192,512
tokenized prompt tokens**, including template/tool overhead, at the configured
ceiling. `max-prefill` bounds forward/prefill work, not an inferred 8K total
context. Exact effective capacity remains part of qualification.

The inspected [q4t request contract](https://github.com/thomas-hiddenpeak/qwen4-thor/blob/24b97e7d50ec7d81eaabcf11ef3f7c7be3587a35/src/server/chat_contract.cpp)
rejects non-neutral sampling values: temperature must be 0 and top-p 1. It also
rejects unknown fields, and its allowlist omits SOAR's `top_k`, `tool_choice`,
`parallel_tool_calls` and `cache_salt`. This is a static incompatibility finding;
no rejected inference request was sent to demonstrate it. Template thinking
controls are supported in source. q4t's `session_id` and `prefix_cache_scope`
fields have their own capability contracts and are not proven equivalents of
SOAR's per-job cache salt.

| Path | Decision and impact |
| --- | --- |
| **A — preserve the existing Heavy experiment (selected)** | Qualify a Flash-Next serving deployment that supports the retained sampling, native single-action tools, cache isolation and context contract. The owner reauthorized the recoverable NemoClaw-derived trial after the q4t stop/start proof. The rest of this plan retains this path's experiment semantics; current-service use does not silently select a greedy profile. |
| **B — evaluate the q4t tier** | First revise the design to name greedy temperature 0/top-p 1/no top-k, an explicitly scoped tool adapter, a proven cache-isolation strategy, the actual context bound and scoped reasoning parsing. Record the change to repeat/diversity interpretation: two greedy repeats do not supply two stochastic samples. The revision must be reviewed and approved before implementation. Omitting unsupported fields is not an invisible compatibility fix. |

Do not apply vLLM parser flags to q4t. A q4t readiness proposal should
use `q4t_active_chats=0` (parsing, queued and generating requests), zero reserved
chat-body bytes, all configured slots free and `q4t_gpu_healthy=1`, sampled at
least three times 20 seconds apart, followed by bounded liveness qualification.
The [q4t metrics source](https://github.com/thomas-hiddenpeak/qwen4-thor/blob/24b97e7d50ec7d81eaabcf11ef3f7c7be3587a35/src/server/chat_metrics.cpp)
shows that `q4t_num_requests_running` counts HTTP connection threads; a metrics
poll can itself make it 1. Requiring that counter to be zero would misclassify an
idle engine. This proposed equivalence still needs verification, not a retroactive
pass of the old gate. A separate legacy proxy was observed, but its relation to
the supplied API is unproven and no dependency or change to it is assumed.

### 1.2 Backend investigation and owner handoff

The [service requirements](FLASH_NEXT_VLLM_SERVICE_REQUIREMENTS.md) identify a
published Thor-specific vLLM candidate with prefix caching and native tools,
plus the exact API, capacity, cache and role requirements. Its community tests
are not SOAR qualification. A second recipe disables prefix caching; SGLang's
SSD-Stream automatic ARM profile targets GB10 rather than Thor; the TensorFold
Thor recipe uses a different distilled checkpoint with unresolved cache-salt
semantics. None is an already verified replacement for the running deployment.

Read-only feasibility checks found about 24.1 GiB available RAM and 142.25 GiB
free on the model filesystem. Passwordless elevated Docker inventory succeeded
after ordinary-user inventory had failed; no vLLM image appeared in that listing.
The known sibling model directories contain older 27B models, not an original
Flash checkpoint. This scoped search does not prove no other copy exists. A new
server cannot be assumed to fit alongside q4t. Storage may be feasible with
hash-verified sharing of unchanged shards and additional original PLE files;
image/build peaks and driver/kernel compatibility remain unverified.

At the first owner-operated handoff (BL-20261031-1812), no build, weight download, conversion,
installation, runtime configuration or restart had been performed; q4t model and
health metadata returned HTTP 200. That historical boundary remains recorded.

The owner then approved a conditional recipe trial (BL-20261031-1815). Its
preparation pins the minimal source/image and original RadixArk weights, reuses
196 SHA-256-verified shards, and downloads ten missing original PLE files.
The original q4t unit is transient and its guard rejects an existing output
directory, so restoration uses a protected snapshot and fresh guard output.
The controlled restore passed before the trial. The subsequent candidate attempt
failed startup and automatic cleanup; guarded manual reconciliation then restored
q4t. BL-20261031-1820 retains the preparation boundary and
BL-20261031-2003-nemoclaw-trial-failed-q4t-recovered records the later failure and
recovery. The separately approved diagnostic retry
(BL-20261031-2021-nemoclaw-diagnostic-retry-approved) used fixed 12 GiB KV with
context 262144 and reached healthy API metadata in about 321 seconds
(BL-20261031-2040-nemoclaw-retry-ready). It is active with q4t stopped and recovery
assets retained. Six-case CPU token parity and full shared-admission integration
are verified. The later one-shot qualification stopped at Q13 after 12 passed
fixtures and 13 zero-fee dispatches. Its unresolved validation failure does not
prove a backend defect. The separately approved diagnostic completed native/SSE
and accounting checks but failed both section-heading predicates on plain titled
paragraphs. Original Q13 and qualification remain unchanged. Aggregate use is 14
attempts with 10 unused dispatch slots, with all 11 original remaining cases still
unattempted. The new H4 loops and H5 remain held, pending further adjudication.

## 2. Approved amendment and frozen role binding

For Phase 4's upcoming H4 verification and H5 comparison, replace the former
Qwen3.8-27B local tier with the **qualified Flash-Next deployment recorded in a
new serving manifest**. Use the advertised `qwen3.8-flash-next` request identifier
if inventory confirms it maps to that deployment. `RM-01 VLM` may remain the
device's human label; it must not conceal a changed model in result metadata.

The eight-role manifest was frozen for qualification in BL-20261031-2104.
Those pins establish identity; the stopped qualification has not accepted them
for H4 or H5.

| Role | Approved model choice and retained policy |
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

PLAN's current Phase 4 description links the new Approved entry. Its Phase 2
arms/results and R2 conditional alternative
remain historical. R2 was not triggered; this is an owner-selected migration,
not a retrospective R2 outcome. D11 remains a separate server-change gate.

## 3. Inventory and implementation boundary

Before inference qualification, prepare a sanitized serving manifest with:

- Actual checkpoint source and immutable revision or artifact digest, conversion
  source/revision, weight and KV-cache quantization, tokenizer/template digests.
- Engine name, version and build/container digest, plus the effective read-only
  diagnostic source-overlay hashes; model routing/alias map;
  reasoning and tool parsers; thinking preservation; prefix caching, cache-salt
  behaviour, speculative decoding/offload and effective sampling defaults.
- Effective context limit and output limit; hardware/memory and current serving
  allocation sufficient to assess the existing Heavy envelope.
- Hashes of API destination and serving configuration, metadata-route contract,
  observation time and provenance. Keep raw routes, flags containing private
  paths, and diagnostic captures ignored; never include credentials.

The owner authorized SSH inspection and later a conditional recoverable trial;
section 1 records the bounded read-only results. Use this inventory and remaining owner-supplied
configuration. Do not guess the engine from an OpenAI-compatible route, scan the
network, obtain shell access by another route, or restart it as part of inventory.
Record the actual D11 trial configuration and restart/rollback window, then
re-inventory the resulting service before creating active deployment pins.

Prefer correcting a demonstrated parser/template configuration at the server,
under D11, over compensating for malformed replies in every client. A client
adapter must be scoped to this qualified deployment and reject ambiguous
reasoning fields, malformed tool calls and incomplete streams. A returned
`reasoning` field and the legacy `reasoning_content` field need explicit tests;
no missing field may silently become evidence that thinking was disabled.

Authorized implementation map (dependent on a suitable deployment):

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
approved batch permits **at most 24 local inference dispatches**, one at a time,
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
| Approved local qualification and local H4 work | USD 0 declared inference fee; bounded device use as above |
| Remaining H4 split step 2 | Existing USD 0.60 cap; no increase requested |
| H5 counted runs | Existing USD 21.60 bound, inside the USD 33 Phase 4 line and USD 300 envelope; owner launch permission granted, final pinned batch-start record pending gates |
| Server changes, extra retries or replacement paid calibration | Conditional recoverable recipe trial approved; no additional paid allowance or automatic inference retries |

The original calibration start cutoff is **2026-11-01 09:19 Asia/Shanghai**
(`2026-11-01T01:19:14.660899Z`). Plan approval does not extend it. Before any
admission, check availability and cutoff; if expired or withdrawn, record a new
owner-declared window. H5 still requires its own batch-start entry naming the
new local tier, cloud model/prices/caps, all digests and passed H4/step-2 evidence.

## 7. Approval, stop and rollback

The owner's five-item instruction approved path A, the named local-tier amendment,
scoped implementation, bounded qualification and three H4 loops, and separately
granted H5 launch permission. BL-20261031-1759 records this supersession of the
earlier Proposed-only and H5-permission-pending text. Every execution stage still
requires its preceding evidence, current pins, existing caps and valid window.
The later instruction permitted the concrete recoverable recipe trial,
superseding the owner-operated-only boundary. That first attempt failed startup
and ended with verified scoped manual q4t recovery. A separate owner-approved
diagnostic retry retained the experiment controls, set fixed 12 GiB KV, reclaimed
clean page cache once and reached healthy API metadata
(BL-20261031-2021-nemoclaw-diagnostic-retry-approved;
BL-20261031-2040-nemoclaw-retry-ready). It remains unqualified, with q4t stopped
and recovery assets retained. This permission does not
approve a silently changed greedy experiment, private data, additional paid
calibration or release. No further H5 permission question is needed solely
because older text described it as a separate decision.

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
and a concrete H5 batch start under the existing permission. Report each stage's
Approved/Implemented/Verified status separately; overall approval is not a live pass.

## 8. Sources and implementation caveats

Official sources checked 2026-11-01; they describe upstream software, not proof
of what runs on the owner's device:

- [Qwen4-Thor upstream](https://github.com/thomas-hiddenpeak/qwen4-thor) and the
  pinned contract/metrics sources above: the earlier inventory identified q4t
  and its greedy API. The later retry's owned API/version checks separately
  identify the now-active vLLM candidate; neither is inferred from its alias.
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
