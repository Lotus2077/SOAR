# SOAR whole-project review and goal-anchored reset

Reviewed: **2026-11-05**, on `main` at `153b8e6`, identical to `origin/main`.
Status: **review complete; every recommendation in it is `Proposed`** and needs the
owner's recorded decision before it takes effect. The owner's own directions of
2026-11-05 are recorded verbatim in BL-20261105-1821-owner-direction-equal-weights-new-model. This document succeeds the
[2026-09-28 review](PROJECT_REVIEW_2026-09-28.md).

The review launched no SOAR model request, application, Docker container, paid
call, endpoint probe or test run. The owner's new endpoint is not reachable from
the review environment, so nothing here measures it. Research on Manus and
comparable products used public web pages only.

## The owner's direction (2026-11-05)

1. **Privacy, result quality and token cost weigh equally.** The local model takes
   on more responsibility. For public deep research it does "the dirty work" on
   free tokens, and the cloud takes "only the hardest part", so cost falls far
   below an all-cloud agent such as Manus while quality stays good.
2. **The 27B model is retired** as "half sufficient" for daily work. A supposedly
   stronger model now serves at a new endpoint, and all later local work uses it.
   Its address lives only in the owner's ignored `.env.local`.
3. **The research bar is Manus-level depth**, "not just normal research", and the
   cost comparison is Manus's per-task cost.

The owner's 2026-09-29 privacy rule still holds as a hard constraint: personal or
professional (labelled) data never reaches the cloud. Within that constraint the
three columns weigh equally. This replaces PLAN.md §1's order "privacy >= quality
> savings > latency" and its line "Savings are descriptive only".

---

## 1. Where the project stands

| Fact | Evidence |
| --- | --- |
| Capability (fair test, Oct 12-19) | 12 fresh tasks: cloud `gpt-6-sol` 10/12; local Heavy 27B 6/12 and 4/12. Local matched or beat cloud on document review, decks and websites; it lost research 0/6, coding and admin (BL-20261019-0432). |
| **The owner's thesis already has one favourable data point** | The H3 split (cloud plans and synthesises from host-verified quotes, everything else local): **USD 0.122-0.126** settled, 7/7 gold checks, entailment 33/6/0/0 of 40, 31.7 minutes, writer prompts 89% cached (BL-20261026-1605, BL-20261026-1644). All-cloud on the same task: **USD 3.05-3.77** uncached with 3/7 gold checks (Phase 2), **USD 1.18** cached (r3-cloud-v3). All-local pipeline: **USD 0**, 7/7, 625 s (BL-20261025-2055). All of this is one exposed calibration task under automated checks; no pipeline output has been blind-graded on a fresh task. |
| Local model history | 27B qualified 2026-09-28: 35 tokens/s prose, 56-67 thinking, prefill about 1,790 tokens/s. The Flash-Next migration measured 19.94 tokens/s. The API-only target (alias `RM-01 VLM`, 262,144-token context) passed its 16-case qualification on 2026-11-04 at 70.2 tokens/s full-request and 153.8 decode on two probes, with physical identity unobserved (BL-20261104-1419). **The owner's new endpoint: no serving card, no role fixture, unknown adapter path.** |
| Need (owner usage) | One owner-run real job ever (document review, 2026-10-12, accepted, 19 actions, 493 s). None since. |
| Privacy tier | Tier O blocked. The endpoint was plain HTTP, unauthenticated, on a public address (serving card 2026-09-28). The box card (2026-10-06) lists 8 hardening gaps; none is recorded fixed. Data labels (P1) and label-aware egress (P2) are not in code. |
| Public research capability | Exactly 3 user-typed URLs, 5 fetches of at most 64 KiB, a 32 KiB visible prefix; **no search, no link following, no browser** (`public-sources.ts:6-7`, HANDOFF.md). The broker knows three destination kinds, `local_model`, `cloud_model` and `public_web` (`broker.ts:23`), and refuses credentials on `public_web` (`broker.ts:281`). |
| Last 14 days | Harness H1-H5, the Claude adapter, the 27B to Flash-Next to API-only migration, three writer pilots and the v4 pipeline rewrite. Accepted artifacts: one calibration report (H2, 27B). H4: six attempts, none accepted. H5: never started. 138 build-log entries in six days; 60 of the last 78 non-merge commits were documentation only. |
| Budget | USD 300 envelope. About **USD 24.5** settled in unique receipts; a naive registry sum gives USD 25.79 because two superseding rows repeat their fee (E11). The Phase 2 dashboard reconciliation is still pending, up to USD 4.72 more (BL-20261022-1157). Phase 4 harness line: USD 33 with USD 3.56 settled, so about **USD 29.4 remains**. The weekly public-work line (USD 25) is unused. |
| Benchmarks already pinned | 10 LiveDRBench structured cases (official grader at `6ff85b67`, paid judge) and 12 DeepResearch Bench long-form prompts (`469cce54`; RACE possible, FACT credentials missing) in `benchmarks/research.jsonl` and `benchmarks/sources.json`. The cloud deep-research products are publicly scored on both. |
| CI | Never runs Docker, a model, the general-task end-to-end path, the research pipeline or Python tests. The only Electron end-to-end test exercises legacy Labs tracks on a fake provider. |

---

## 2. The ultimate goal

> **Deliver Manus-level results on the owner's real work, public deep research
> first, at a fraction of Manus's cost, with every byte of private data staying on
> the owned device: the local model does all the volume work at zero fee, and the
> cloud is called only for the few steps it demonstrably does better, as sealed
> one-shot packets.**

### 2.1 Three equal columns, recorded for every run

| Column | Measure |
| --- | --- |
| Quality | Blind acceptance (owner, else a blind proxy with arm guesses recorded) **and** the depth criteria of 2.2. |
| Cost | Settled cloud USD plus search fees; reserved USD and body bytes per cloud call. |
| Privacy | Disclosed bytes: unique bytes that left the device, including file names, URLs, hashes and search queries. Labelled bytes must be 0. |

**Frontier rule (proposed, replaces the lexical order).** A route change is adopted
only if it loses on no column beyond tolerance and wins on at least one.
Tolerances: quality within one accept in six and no depth criterion newly failed;
cost, mean settled USD not higher; privacy, disclosed bytes not higher and
labelled bytes zero. When two routes trade one column against another, the owner
decides and the registry row records why. Equal weight does not make privacy
tradable: labelled data never leaves, and for public data the disclosed bytes are
a measured cost to minimise like dollars.

### 2.2 The quality bar: Manus-level depth (proposed)

Manus publishes no per-task depth figures. The bar below is assembled from Manus's
published descriptions, reviewer reports, the cloud deep-research products and the
two benchmarks SOAR already pins. **The thresholds are proxies.** They should be
re-baselined when a Manus product baseline exists (E4 option).

| # | Criterion | Threshold per public deep-research task | Anchor |
| --- | --- | --- | --- |
| 1 | Breadth | ≥ 30 distinct URLs fetched and read in full from ≥ 10 domains; ≥ 20 distinct search queries; ≥ 60% required-query coverage on LiveDRBench traces | Humans visit 8 sites and 110 pages on Mind2Web 2; query coverage OpenAI DR 66%, Perplexity 52% |
| 2 | Actions | ≥ 40 logged actions, ≥ 25 of them fetch or read | Manus reports about 50 tool calls per task |
| 3 | Citations | ≥ 30 effective citations backed by fetched text, accuracy ≥ 85%; every cited URL fetched during the run; no snippet-only citation; fact-check accuracy ≥ 80% | DeepResearch Bench FACT: Perplexity 90.24%, Gemini 81.44%; fact-check frontier 39-77% |
| 4 | Coverage | LiveDRBench F1 ≥ 0.35 (stretch 0.55); DeepResearch Bench RACE ≥ 42 under the pinned protocol, labelled `SOAR-pilot` without FACT | LiveDRBench F1 OpenAI DR 0.555, Perplexity 0.355; RACE Perplexity 42.25 |
| 5 | Conflicts | ≥ 80% of planted contradictions surfaced with both sides cited; none silently resolved | SOAR fixtures (E4) |
| 6 | Report | 2,500-6,000 words of continuous prose with sections, a summary, ≥ 1 table and a URL reference list; plus `claims.json` mapping claim to URL to verbatim quote; a CSV when the data is tabular | Manus's agent prompt asks for "several thousand words" (unofficial copy) |
| 7 | Time | ≤ 30 minutes P50, ≤ 45 minutes P95 | Manus 14-50 minutes; SOAR's split arm 31.7 minutes |
| 8 | Acceptance | Blind accept rate ≥ the Phase 2 cloud rate (3/3); entailment supported plus partial ≥ 90% with 0 contradicted | Split arm 33 + 6 of 40 |
| 9 | Stability | 3 runs per task, depth metrics within 2x of each other | Manus varies about 2x run to run |

### 2.3 The cost bar: a fraction of Manus

| Item | Value | Confidence |
| --- | --- | --- |
| Manus list price per credit, all 2026 paid tiers | USD 0.005 (USD 20 for 4,000, 40 for 8,000, 200 for 40,000; Team USD 20 per seat for 4,000 pooled). Add-on packs about USD 0.01. Free: 300 per day, at most 1,500 per month, Lite model only. | High for the rate (consistent official excerpts and third-party captures); the official pages could not be re-fetched from the review environment |
| Manus standard deep-research task | 300-900 credits, **USD 1.50-4.50** at list (central 2.50-4.50; 3-9 if bought as add-ons) | Low to medium: a reviewer band repeated across blogs; no logged run pairs sources, actions, minutes and credits |
| Manus Lite / Max / Wide Research | USD 0.30-1.00 / 7.50-25 / at least 5 (20 sub-tasks capped at 50 credits each), 20-50 reported per run | Low |
| SOAR today, same closed-corpus task | All-cloud uncached 3.05-3.77 (inside the Manus band); cached 1.18; split 0.12; all-local 0 | Measured, settled receipts |
| Comparable products per report | Gemini Deep Research about 1.22 at API list prices; Kimi Researcher about 0.95-1.90; GPT Researcher about 0.40; OpenAI o3 deep research about 10 (2025, model since deprecated) | Mixed, see §7 |
| **SOAR target** | **≤ USD 0.50 P50 per public deep-research task, cloud plus search; hard cap USD 0.75 per episode** (the cap already proposed in `benchmarks/README.md`); stretch 0.25. That is at most a fifth of Manus's central value and a third of its floor. | Target |

Two consequences follow. An all-cloud design cannot meet the target: caching makes
it only 2-4x cheaper than Manus. And search must be free or self-hosted, because
API search costs USD 5-14 per 1,000 calls, so the 20-30 queries of criterion 1 would
alone cost USD 0.10-0.42 if bought.

### 2.4 The privacy bar

Labelled contexts get zero cloud, search or web bytes, always. Public tasks send
the cloud derived material only: byte-capped packets, previewable before the first
dispatch. No labelled work runs on the device until the local endpoint is reached
over TLS, loopback or an explicit tunnel (P11). Until then the device confers no
privacy advantage over the cloud (F6).

### 2.5 What follows from the goal

1. **Local does the volume work:** query planning, triage, reading, extraction,
   writing, critique and repair. Volume is where an all-cloud agent pays: SOAR's
   Phase 2 cloud runs re-sent 1.46-1.79 million input tokens each, about 95% of
   their fee. Locally those tokens are free, and the writer measured 75-89%
   prefix-cache reads.
2. **The cloud does only the hardest step, as a sealed one-shot:** a plan assist
   and a synthesis assist, measured at USD 0.03 and 0.09-0.10. There is no cloud
   critique (cloud and local critiques tied 4/6 against 4/6, BL-20261019-0838),
   no cloud reader and no cloud writer.
3. **Escalation is earned:** the cloud fires only on deterministic host signals
   after the free local attempts fail. Trigger rates are measured, not assumed.
4. **Free local tokens buy breadth:** independent extraction calls run in parallel
   on the local server, the free analogue of Manus's Wide Research.
5. **Quality is blind-graded on fresh tasks** against the depth criteria. "7/7
   automated checks" is never reported as accepted.
6. **An experiment runs only if its result changes a pending decision** (§5.1).

---

## 3. Strategic and architectural flaws (ranked)

**F1. The program buried its own best result (critical).** The split arm (USD 0.12,
7/7) is the owner's thesis working on the first try. It was gated behind H4, a
five-stage pass/fail chain where every ordinary failure (a chmod, a 90-minute
boundary, one invalid JSON reply) consumed the allocation and needed a new named
plan plus owner approval. Six H4 attempts failed, none of them a quality rejection
of a finished deliverable; H5 never ran. Twenty PHASE4 plan documents were written
in five days.

**F2. Model migration churn invalidated the serving evidence (critical).** The
device went from the 27B to Flash-Next (19.94 tokens/s, slower), then through
NVFP4, q4t and disk work, then to an API-only target (70 and 153 tokens/s on two
probes, identity unobserved), and now to a new endpoint with no card at all.
Every stage bound in the pipeline (output caps, clocks, the 40-chunk ceiling, the
16,384-token critic) was derived from the 27B card and is unverified for the model
that will run it. The adapter path is also unknown: the legacy owned-vLLM shape
and the `flash_next_v1` contract differ in thinking semantics, reasoning field,
request-byte caps and the zero-fee settlement envelope (`config.ts:44-49`,
`model.ts:321,329`).

**F3. Tier O retention rules are compiled into code that runs on public fixtures,
which destroys debuggability (major).** The planner persists no model text by
policy (`research-plan.ts:1,13-18`), the pipeline collapses every error into a bare
token (`research-pipeline.ts:100,103`) and the broker records no sub-code for
validation failures. Both v4 planning replies were rejected and nobody can say
which field failed (BL-20261105-0923). Retention should bind to the data label.

**F4. The paid-dispatch ledger governs zero-fee local inference (major).** Slots,
claims, UNKNOWN receipts and no-replay were designed for at-most-once paid
disclosure. Applied to free local calls they do three kinds of damage. A deadline
cancel becomes a permanent UNKNOWN that bricks the job (A1). Only one dispatch per
job may be in flight, so free local tokens cannot be spent in parallel (D12). And
every zero-fee attempt has needed its own approval: PLAN.md §4(c) forbids approval
entries for USD 0 work, yet the log has about 100 since Oct 22, and its last three
entries require per-trial named authority for every live request. The slot logic
lives in untracked `.soar/` files that nothing in the repository tests.

**F5. The owner's headline use case has no desktop path (major).** Public deep
research with local dirty work and a cloud assist exists only as headless scripts.
The desktop controller never passes `research` to the session
(`controller.ts:601-610`), document review is headless only, and the owner build
is still `owner-v0.2` (2026-10-12). H4 measured a path the product does not ship.

**F6. The device confers no privacy advantage yet (major).** The endpoint was plain
HTTP, unauthenticated, on a public address. The broker permits plain HTTP whenever
`local_model && syntheticOnly` holds (`broker.ts:275-276`), which is the normal
desktop configuration, and "owned device" is a self-declaration
(`SOAR_VLLM_COST_POLICY`). The box card's fixes are about a day of sysadmin work
that nobody owns.

**F7. Public research cannot reach Manus depth (major).** Three URLs, five 64 KiB
fetches, no search and no link following cannot reach criterion 1 (≥ 30 URLs,
≥ 10 domains, ≥ 20 queries). There is no search destination kind. A 404, redirect,
bot block or oversize response ended tasks permanently as of the 2026-09-28 review
(W3). The pipeline would refuse a web-scale corpus at admission (D8), the synthesis
argument is capped at 1,200 words (D13), and the evidence packet at 64 KiB (D4).

**F8. Quality has been measured by mechanics (major).** Every 7/7 row is automated
checks on one exposed task. The registry holds a 7/7 run that graders rejected and
a 3/7 run they accepted. The entailment support rate does not separate accepted
drafts (0.46-0.95) from rejected ones (0.91-0.97), yet it decides selection
(E10). No pipeline output has been blind-graded on a fresh task.

**F9. Process weight (major, recurring since W8).** 483 entries in 32 active days;
the log is 2.17 MB and the validator forbids rotation (E3).

**F10. Codebase weight against the goal (major, unchanged since W9).** About 74% of
`src/` serves surfaces hidden behind `SOAR_ENABLE_LABS`, yet they are constructed,
migrated and recovered at every start (`bootstrap.ts:151,171,196,206`), and they
are what CI's only end-to-end test exercises.

---

## 4. Verified bugs and code-level flaws

Confidence: **H** = re-read at the cited line at `153b8e6`; **M** = audit finding
consistent with the surrounding code; **audit only** = not re-read. File names are
resolved in the code map (§8).

### A. Tasks that end permanently for ordinary reasons

| # | Finding | Where | Conf |
| --- | --- | --- | --- |
| A1 | **An UNKNOWN dispatch can never be cleared, and is assigned too eagerly.** `isConfirmedAbort` returns false for every settlement-phase failure and for `cancelled`, `request_timeout` and `inactivity_timeout`, even on a zero-fee local request. The row is marked `unknown`; `store.commit` then refuses every later dispatch in the job; no code path moves an `unknown` row to another status. | `store.ts:46-50,204,242,250`, `broker.ts:521-528` | H |
| A2 | **A fully received local reply that fails validation is recorded as UNKNOWN.** A zod reply-schema failure, usage envelope, service tier, duplicate tool id, think-tag check or token-admission mismatch all become `response_or_usage_invalid`, then `transport_or_settlement_unknown`, and the job is blocked although cost and side effects are known. | `broker.ts:495-528` | H |
| A3 | **Workspace capture after an action runs outside the action's error handling.** If capture throws, `tool_finished` is never written and every resume returns `unresolved_operation_no_replay`. Capture throws on any symlink or hard link (`die()`), more than 1,024 files or 4,096 entries, a file over 64 MiB, a workspace over 128 MiB, or any sandbox error, which also destroys the container. `ln -s`, `python -m venv`, `git clone` and `unzip` all trigger it. | `runner.ts:663,748-749`, `sandbox.ts:209,215-218,402-406` | H |
| A4 | **Command output over 256 KiB kills the container, then A3 fires.** The model is told that large output is retained with bounded excerpts; it is not. | `sandbox.ts:6,99`, `runner.ts:154,640-653,663` | M |
| A5 | **Pre-dispatch broker errors brick the task.** Only four codes are handled after `model_started`; `request_cancelled`, `packet_scan_failed`, `packet_size_exceeded`, `private_agent_unresolved_dispatch` and `private_model_thinking_unsupported` are rethrown with an unmatched `model_started`. | `runner.ts:457-487` | H |
| A6 | **Desktop resume works only for `interrupted` and `model_unavailable`.** Every other runner reason flattens to `incomplete`, and any exception on Resume (Docker down, for example) becomes `runtime_unavailable`, which is not resumable. | `controller.ts:475,622-627` | H |
| A7 | **Pausing during the research stage reports "paused" but can never resume** (`research_stage_not_replayed`). | `session.ts:374-376,385` | H |
| A8 | **A deadline firing mid-request always produces an UNKNOWN.** Nothing checks the remaining time against the 300 or 900 s request timeout before dispatch, and the server cut long requests at about 947 s (serving card P8). This is the documented 90-minute `loop_stage_unresolved_dispatch` failure. | `controller.ts:596`, `session.ts:307`, `runner.ts:419`, `phase4-loop.ts:139` | H |
| A9 | Checkpoint blobs are written to their final content-addressed name with `O_EXCL` and no temporary file and rename; a crash mid-write poisons that hash permanently. | `checkpoints.ts:33-39` | audit only |

### B. Failure detail is thrown away

| # | Finding | Where | Conf |
| --- | --- | --- | --- |
| B1 | Broker settlement diagnostics admit exactly two codes; `error.message` is never recorded. | `store.ts:34-37`, `broker.ts:521-523` | H |
| B2 | The runner records only `error.name` for unhandled errors. | `runner.ts:712` | H |
| B3 | In the pipeline every `BrokerError` becomes `research_request_denied`, so a cap refusal, a cancellation and an UNKNOWN look identical; packet-validation errors become `research_packet_binding_invalid`; `call()` keeps only snake_case messages. | `research-pipeline.ts:100,103,215-216` | H |
| B4 | Planner diagnostics persist codes and paths only; the raw reply is never retained, even for public corpora. | `research-plan.ts:13-18,106-123` | H |
| B5 | Tool errors reach the model as one generic `action_failed_or_not_permitted`, so the model gets no repair signal. | `runner.ts:653` | H |
| B6 | Harness: the driver's top-level catch yields `local_screen_failed_no_replay`; the loop keeps only messages matching `^[a-z0-9_]+$`; `researchTransferSnapshot` returns `null` on almost any error. | `private-agent-local-screen.ts:496`, `phase4-loop.ts:68-71`, `research-seed.ts:132-135` | M |
| B7 | `research_stage_invalid`, cited in PLAN.md as a failure category, exists nowhere in tracked code; it came from an untracked wrapper. | `docs/PLAN.md:659` | H |

### C. Privacy-boundary gaps against the stated design

| # | Finding | Where | Conf |
| --- | --- | --- | --- |
| C1 | **No label system.** Admission is `publicOrSynthetic: z.literal(true)`; there are no label, tier or regime types in `src/`; the broker's `syntheticOnly` gate reduces to that checkbox. | `general-task-contracts.ts:46`, `session.ts:180`, `broker.ts:391-398` | H |
| C2 | **Two egress paths bypass the broker.** The coding pilot's worker POSTs repository source directly with `urllib`; the legacy OpenAI-SDK provider sends repository content to the vLLM endpoint without broker checks. The Labs flag only hides their UI. | `worker.py:869-876`, `openai-compatible.ts:284-289,324` | H |
| C3 | **Plain HTTP to the local model is permitted whenever `local_model && syntheticOnly` holds**, contradicting P11; "owned device" is never verified. | `broker.ts:275-276`, `config.ts:173-178` | H |
| C4 | The headless cloud arm ships the whole conversation with no per-packet consent (`grantFreeSynthetic: true`); a mislabelled task would take the same path. | `private-agent-local-screen.ts:211-213`, `broker.ts:287-288` | H |
| C5 | Consultation packets disclose omitted file names, sizes and hashes; the model-authored `question` is unlabelled free text. | `consultation.ts:155-165` | audit only |
| C6 | Keys may live in plaintext `.env` or `.env.local`; the default key `"local-vllm"` is sent as a Bearer token, possibly over HTTP; the Keychain lease broker is wired to no egress path. | `config.ts:183-205,244`, `src/main/credentials/` | audit only |
| C7 | The Flash-Next token-admission helper is an unsandboxed host executable that receives every full request body. | `flash-next-admission.ts:136` | M |
| C8 | Positive: Electron hardening, the Docker sandbox (`--network none`, `--cap-drop ALL`, read-only root, non-root user, no mounts) and the broker (DNS pinning, credential scan, exact-packet hashes, `publicDnsResolver`) are good. Keep all of it. | `bootstrap.ts:62-66`, `sandbox.ts:358-371`, `broker.ts:289` | M |

### D. The research pipeline is too brittle for a local model and too small for the web

| # | Finding | Where | Conf |
| --- | --- | --- | --- |
| D1 | Two planner calls, strict JSON and no host fallback plan; one misspelled `sourceIds` hint rejects the whole plan. Two distinct failure modes exist: reasoning that exhausts the 8,192-token cap (BL-20261101-0036) and schema or binding rejection without truncation (BL-20261105-0923, prompt since repaired in PR 34). | `research-pipeline.ts:135-143`, `research-plan.ts:8-10,73-89` | H |
| D2 | Extraction is all-or-nothing per chunk: one non-verbatim quote sets `valid = false` for the whole chunk. | `research-pipeline.ts:162` | H |
| D3 | Repairs run only while `calls < extractionCalls`, so a 40-chunk corpus has no repair capacity. | `research-pipeline.ts:116,181` | H |
| D4 | Any cap omission or incomplete chunk makes the run `incomplete`: quotes beyond the 64 KiB packet go to `coverage.omissions` and the run returns `research_packet_cap_omission`. r3 already filled 46-52 KB with 24 sources. The writer never starts. | `research-pipeline.ts:185,193-196`, `session.ts:385` | H |
| D5 | Synthesis requires exact `^## Conflicting evidence\s*$` and `^## Unanswered questions\s*$` lines; other capitalisation or Setext headings fail. | `research-pipeline.ts:207` | H |
| D6 | Plan and synthesis run with thinking on under an 8,192-token cap (silently 4,096 on `standard`), so reasoning tokens can truncate the JSON. | `research-pipeline.ts:28`, `model.ts:295` | M |
| D7 | The pipeline, select-and-repair loop, seed loader and critic exist only under `scripts/`; the desktop never passes `research` to the session. | `controller.ts:601-610`, `selection.ts`, `repair.ts` | H |
| D8 | **Index batching refuses web-scale corpora.** Every source over 20 KiB gets its own batch, and more than 24 batches refuses the run regardless of total bytes; more than 40 chunks refuses too. A web corpus of 30 or more pages is refused at admission. | `research-pipeline.ts:113,116` | H |
| D9 | The extraction prompt's stable prefix ends early: `canonical()` sorts keys (brief, chunk, plan, repairReason, source, units), so the chunk sits between the brief and the plan. Pipeline stages measured 0 cached tokens on 2026-10-25 and 2026-11-05, though the 2026-11-01 runs did cache. | `contracts.ts:80`, `research-pipeline.ts:149-150` | H |
| D10 | **Desktop research would ship without its checks.** The claims ledger and its check are compiled only when `record.publicSources` exists, so a file-only research task has none; the controller never passes `judgeModelFactory`, so the entailment judge cannot run in the app. | `controller.ts:343-346`, `session.ts:56,250` | H |
| D11 | `deriveBriefUnits` splits only on lines starting `1.` or `2)`; an unnumbered brief becomes one unit and the brief-coverage check is vacuous. | `research-coverage.ts:68-79` | H |
| D12 | **One dispatch at a time per job.** `store.commit` refuses any dispatch while an earlier one is unresolved, and `committed` (in flight) counts as unresolved; the index, extraction and judge loops also await each call in turn. Free local tokens cannot be spent in parallel, although the server held full per-stream speed with two concurrent streams on the 27B (serving card P7). | `store.ts:57-59,204`, `research-pipeline.ts:128,180`, `claims.ts:63` | H |
| D13 | **Report length is capped far below the bar.** The synthesis argument is limited to "at most 1200 words" and the r3 brief capped the report at 1,000 words; criterion 6 asks for 2,500-6,000. | `research-pipeline.ts:35` | H |

### E. Harness, validator and engineering health

| # | Finding | Where | Conf |
| --- | --- | --- | --- |
| E1 | The loop hard-stops on any `unknown`, `committed` **or `failed`** receipt (a test locks this in), and a stopped loop cannot be written to the registry. Hence zero loop rows in 99 registry rows after six H4 attempts. | `phase4-loop.ts:139-140`, `registry-row.py:49-50`, `phase4-loop.test.ts:102` | H |
| E2 | The source-freeze hash covers every `private-agent/*.ts`, four scripts, `config.ts`, `pnpm-lock.yaml` and the Dockerfile, so any one-line fix invalidates the loop and its allocation. | `private-agent-local-screen.ts:132-139`, `phase4-loop.ts:118` | H |
| E3 | The validator has a hard-coded path, enforces byte-prefix append-only and requires an entry for any change under `src/`, `tests/`, `scripts/`, `benchmarks/`, `docs/plans/` or `.github/`; rotation is impossible. The log is 2.17 MB, above `search_text`'s 1 MiB per-file cap, so the live repository proof cannot pass at HEAD. | `validate-build-log.ts:8,555-577,597-672`, `search-text.ts:19` | H |
| E4 | The registry's `git` field is `git rev-parse HEAD` at row-writing time, not the run's commit; `unknownDispatches` also counts in-flight `committed` rows. | `registry-row.py:97,160` | H |
| E5 | Limits are scattered across at least 25 locations, with inconsistencies: the presentation cap of 192 KiB equals the `standard` request-body cap; claims output 256 KiB against 240,000 bytes; quote length defined twice. | `profiles.ts`, `runner.ts:28-30`, `sandbox.ts:4-7`, `broker.ts:15-19`, `research-contract.ts:10-13`, `claims.ts:16-33` | M |
| E6 | Dead or unused code: `GENERAL_TASK_LIMITS`, `stripUnknownCitations` (test only), and an effectively unreachable `invalidExecuteAtOutputLimit` branch that is bound into the protocol hash. | `controller.ts:38`, `research-pipeline.ts:62-76`, `runner.ts:646-647` | H |
| E7 | 163 vitest files; every Docker, model and general-task end-to-end test is environment-gated and skipped in CI; fixtures are self-consistent fakes, none built from recorded real model output. | `ci.yml`, `tests/helpers/` | H |
| E8 | Positive: repository hygiene is good. No secrets, private hosts, generated artifacts or TODOs in tracked code. | `.gitignore` | H |
| E9 | **Ties go to the repair, not the original.** The final selection calls `compareCandidates(repair, selected)` and ties award `first`; the stated design is the opposite. | `phase4-loop.ts:193`, `selection.ts:68` | H |
| E10 | The entailment step decides selection on a 0.1 margin although support rates do not separate accepted from rejected drafts (F8). | `selection.ts:19,67` | H |
| E11 | Registry rows that supersede another row repeat its fee: a naive sum gives USD 25.79 against USD 24.54 of unique receipts. Consumers must skip superseded rows. | `registry.jsonl` (`supersedes` field) | H |

---

## 5. The new best way

### 5.1 Admission rules for every future experiment

An experiment runs only if all ten hold.

1. **Decision.** Its pre-registered result changes a pending product decision:
   ship, keep or drop a route or family, or open or keep closed Tier O. The card
   names the decision.
2. **Three columns or it does not count:** acceptance (blind or owner), settled USD
   with reserved USD and body bytes per cloud call, and disclosed bytes.
3. **Fresh tasks, blind grading.** Gold is held by a separate session and arm
   guesses are recorded. r1-r3 and the exposed Phase 4 task are calibration only.
4. **Serving card first.** Every stage bound and the adapter contract cite the card
   of the endpoint that runs them (E0). No bound is inherited from the 27B.
5. **Zero-fee work needs no approval entry** (PLAN.md §4(c), restored by one
   superseding entry, backlog item 0). A paid run needs one named `Approved` entry
   that names its envelope line, cap, window and arms. Failures never consume an
   allocation that needs a new approval; an `infra_invalid` run resumes once from
   its last complete stage at zero fee and never re-pays a settled assist.
6. **The cloud is called only after the free local attempts fail on a
   deterministic signal**, as a one-shot template packet with a byte cap: no
   literal source openings, names, hashes, history or tool outputs; previewable;
   a reply never feeds another packet without approval.
7. **Labels gate destinations.** Labelled contexts have no cloud, search or web
   destination; regime-tagged contexts have none under any grant; labelled work
   waits for P11 transport.
8. **Caps use the shipped formula.** Reservation = body bytes × max(input, write)
   + max output × output (`model.ts:329-337`); cap = settled + outstanding
   reservations + new (`store.ts:207-210`). A cap refusal is a recorded fallback,
   never an abort.
9. **Every fallback is disclosed** in `reportedIssues`. Mechanics are never
   acceptance. `Proposed`, `Approved`, `Implemented`, `Verified` and `Released`
   stay distinct.
10. **No model or serving change** without a one-day timebox and a pre-registered
    role-level target that reverts the change if missed.

### 5.2 Architecture v5: local-first staged research with sealed cloud assists

**Principles.**

1. The staged pipeline is the only research reader; the agent loop only writes.
2. Local does every volume stage at zero fee, with bounded concurrency where calls
   are independent.
3. The cloud receives at most three one-shot, stateless, host-built packets per
   public research task: a plan assist, a synthesis assist and one synthesis retry
   on truncation. No tools, history or tool outputs.
4. Escalation fires only on deterministic host signals. Model-judged signals are
   recorded on every run and fire nothing until calibrated.
5. No single failure ends a task; every fallback is disclosed.
6. Every bound is re-derived from the E0 serving card.

**Stage graph for research.** R-stages run only when the task has a web scope; a
file-only task starts at S1.

| Stage | Executor | Bound or rule | Why |
| --- | --- | --- | --- |
| R0 admit | host | goal ≤ 32 KiB; files ≤ 16 MiB; web scope = search allowed plus ≤ 3 seed URLs; class public or synthetic (the checkbox today, a P1 label later); wall-clock feasibility from the card before the first call; numbered requirements recommended in the form (D11) | Only the host mints authority |
| R1 query plan | local | ≤ 3 calls, thinking off; 8-30 queries derived from brief units | Dirty work, free |
| R2 search | host, **new ledgered search destination** | ≤ 30 queries per task; GET only; credentials refused; one zero-fee receipt per query; self-hosted SearXNG on loopback or LAN (PLAN.md already names it) | `public_web` refuses keys; API search costs USD 5-14 per 1,000 |
| R3 triage | local | ≤ 4 calls over result snippets, yielding ≤ 60 candidate URLs from ≥ 10 domains; snippets are never cited | Snippets are not sources |
| R4 fetch | host, `public_web` with DNS pinning and an exact URL per receipt | ≤ 60 fetches; ≤ 1 MiB raw retained per page (64 KiB today); a 404, redirect, bot block or oversize response is a recorded miss, never a task end; retained bytes keyed by URL and hash so re-runs work offline | Criterion 1 |
| R5 extract text | offline sandbox (`lxml` and `poppler` are already in the image) | HTML or PDF to text in the workspace; a paged reader; one hop of link following back to R4 (≤ 20 more URLs) | The model reads whole pages, not a 32 KiB prefix |
| S1 inventory | host | 64 KiB chunks; chunk and batch ceilings set to what the card's prefill rate fits in the clock (today ≤ 40 chunks, ≤ 24 batches); batches by preview size | Feasibility stated at admission (D8) |
| S2 index | local | batches in parallel; thinking off; literal-card fraction reported as an insufficiency signal (21 of 24 cards preceded the 2026-11-05 content rejection) | |
| S3 plan | local | 2 calls: attempt 1 thinking off (with `json_schema` where E0 shows it valid), attempt 2 thinking on with diagnostics; host fallback plan of ≤ 12 grouped questions | Truncation and schema rejection are both observed (D1) |
| **S3c plan assist** | **cloud, T1** | after two rejected local plans; body ≤ 32 KiB; headless now, desktop with the per-task toggle later | Cloud plans valid 3/3 at USD 0.030 settled |
| S4 extract | local | one call per chunk, K in parallel (K from E0 P7), plus repairs with reserved capacity; thinking off; per-quote drop; prefix layout `[system][stable packet][chunk]` | The dirty work (D2, D3, D9, D12) |
| S5 coverage table | host | unit × question × quotes; omissions; fallback fractions; priority trim with disclosed drops accepted by the ready gate | Separates "no evidence extracted" from "the corpus lacks it" (D4) |
| S6 synthesis | local | 2 calls, thinking off then on; headings normalised; length cap set by the brief, not 1,200 words; skeleton fallback marked | Equal gold and better entailment than the cloud on r3, n = 1 (D5, D13) |
| **S6c synthesis assist** | **cloud, T2** | after two refused local syntheses; `evidence.md` ≤ 64 KiB of verified quotes with opaque ids; one retry on truncation with trimmed evidence | Measured USD 0.091-0.099 |
| S7 presentation | host | ≤ 192 KiB, once | The writer drafts in 2 turns instead of burning 4 on discovery |
| S8 write | local | Heavy bounds until E2; output budget and clock from the card; per-call cap ≤ (timeout − prefill) × measured decode | Passing writers used 29-78 calls |
| S9 checks | host | claims ledger (verbatim quote in the retained page; URL fetched during the run); sections; absence-claim flag for owner attention; brief-unit coverage; **depth metrics** (queries, URLs, domains, bytes, actions) | Targets recorded rejection causes and the bar |
| S10 judge | local | 40 × 256 tokens, K in parallel, evidence only, no selection role until per-claim gold exists | Uncorrelated with grades so far (E10) |
| S11 critique and repair | local | one round; cap from the card; the original wins ties (E9) | 4 of 6 recovered at zero fee |
| S12 verdict | owner | accept, minutes and interventions captured in the app and written to the registry | OAJ is the north star |

**Cloud touchpoints, and what the cloud never sees.**

| Touchpoint | Packet | The cloud never sees | Settled estimate | Reservation at bound |
| --- | --- | --- | --- | --- |
| T1 plan assist | schema, brief ≤ 8 KiB, units, gists with opaque source ids, budget line, safe diagnostic codes | literal source openings, file names, URLs, hashes, raw local replies, the conversation | 0.03 measured (v3 packet) to about 0.07 (v4 size) | 0.16 |
| T2 synthesis assist | brief, units, plan, `evidence.md` ≤ 64 KiB, counts-only coverage | source text outside quotes, file names, hashes, drafts, tool outputs | 0.09-0.10 measured; about 0.15 at bound | 0.33 |
| T3 coding review (conditional, E7) | tree names, signatures, `-U0` diff, failing assertions | untouched files, fixtures, config, logs | about 0.05 | 0.10 |
| T4 labelled packet | deferred: needs P1, P11, D15's exact-byte approval and a new builder | raw files, prose, names, paths, metadata | about 0.03 | 0.06 |
| B0 all-cloud | experiment ceiling arm only | anything labelled | 1.13-1.18 measured | cap 3.00 |

Cap check per research task: closed corpus USD 0.60 (T1 settled 0.07 plus T2
reserved 0.33 gives 0.40; after T2 settles at about 0.15, a retry reservation gives
0.55); web scale USD 0.75. On a public task the brief itself is a disclosure, so
the exact first packet is previewable before dispatch.

**Escalation.** Signals are deterministic and host-side: two rejected local plans,
two refused local syntheses, or checks still failing after one local critique and
repair. Fallback-eligible `BrokerError` codes (budget, mode, grant, synthetic-
destination and size denials, a confirmed `request_failed`, an invalid cloud reply)
apply the host fallback and continue. Stop codes (`job_cancelled`,
`request_cancelled`) stop the stage. A `transport_or_settlement_unknown` on an
assist resolves the assist as skipped with its reservation pinned. Assist-purpose
dispatches are excluded from the unresolved-dispatch block the way entailment
dispatches already are (`session.ts:370`, `claims.ts:37`), so a cloud UNKNOWN never
blocks local work and the cloud row stays at-most-once. Never: a model-initiated
cloud call (`request_consultation` is withdrawn from new tasks); a cloud reader,
writer or critic; a second cloud attempt after an UNKNOWN; a cloud call from a
labelled context outside T4; any cloud call for a regime-tagged context.

**Local fan-out.** Index batches, extraction chunks and judge claims are
independent, so they run K at a time, with K set from the card's concurrency probe.
This needs one ledger change: zero-risk local dispatches may be in flight together,
while a cloud dispatch still requires no unresolved row before it commits. It is
the free counterpart of Manus's Wide Research, which runs 20 paid sub-tasks at
once.

**Caching.** Locally the per-job `cache_salt` stays and extraction moves to the
`[system][stable packet][chunk]` layout (D9); the gain is wall time, measured in
E0. Cloud one-shots use explicit cache mode, so only the sub-1,024-token system
block is marked; a test asserts `cacheWriteTokens = 0` on every assist receipt.
`promptCaching` is never left undefined on an assist, because that re-enables
implicit writes at 1.25x the input rate.

**Privacy.** Desktop routes are local-only by default. A URL-backed public task,
which the session already classifies `public` (`session.ts:180`), may enable "allow
a cloud assist for this public task"; the assist destination is compiled only when
the toggle is set. File-only tasks get no toggle until P1. Labelled contexts have
no cloud, search or web destination; T4 is reachable only through D15's exact-byte
approval; regime-tagged contexts, never. No labelled work runs before P11. The
attestation path the owner used on 2026-10-12 (owner-declared public or synthetic
inputs) is unchanged. Every dispatch, local, search or web, appears in the task
ledger. The badge says "no cloud, search or web dispatch", never "nothing left the
device"; disclosed bytes count unique bytes sent.

**Quality.** Deterministic host checks plus depth metrics, the local judge as
evidence, and blind grading on fresh tasks against the bar of §2.2.

### 5.3 Routes per family

| Family | Local | Cloud | Labelled data |
| --- | --- | --- | --- |
| Research, public (web or files) | R1-R5, S1-S11 | T1 and T2 on deterministic signals; in the harness first, then in the desktop through the per-task toggle after E3 | the brief is named as a disclosure |
| Research, labelled | the whole pipeline, once P11 exists | none; T4 deferred | unavailable until P11 |
| Document review | edit plan, host redline applier, fidelity checks; two samples with critique and repair if E6 says so | none (local 3/3 and 1/3 against cloud 2/3) | unavailable until P11 |
| Website, deck | build, hooks, OOXML check, render, repair | none (1/1; 1/2 against 1/2) | local only |
| Admin | deferred (unbuilt) | never on the owner's mail | blocked until P11 and P1 |
| Coding | implement, host-run tests, repair | T3 on public repositories only, conditional on E7 and D20(b) | no path until D20(b) |

### 5.4 Cost and time model

| Route (research task, closed corpus r3 unless stated) | USD per task | Evidence |
| --- | --- | --- |
| All-local pipeline | 0 | BL-20261025-2055 |
| Local-first, both assists fire | 0.13 (v3 packets) to 0.22 (v4 size); about 0.37 with a retry; cap 0.60 | split receipts; v4 planner body about 24k tokens (BL-20261105-0923) |
| Forced split | 0.122-0.126 | registry `p4h3` and `p4pb` rows |
| All-cloud cached | 1.13-1.18 | r3-cloud-v3; Claude calibration, Console-reconciled 1.15 |
| All-cloud uncached | 3.05-3.77 | Phase 2 r1-r3, dashboard check pending |
| Manus at list | 1.50-4.50 standard; 7.50-25 Max | §2.3 |
| Web scale, indicative split of the USD 0.50 target | plan 0.03; synthesis 0.10-0.25; search 0 (SearXNG) or 0.10-0.42 (API); reserve 0.10 | target, measured in E4 |

Prices assumed: `gpt-6-sol` USD 2 / 0.20 / 10 / 2.50 and `claude-sonnet-5-5`
2 / 0.10 / 10 / 2.50 per million tokens (input, cached, output, cache write);
uncached one-shots cost the same on both. Cloud reasoning bills as output and
dominates every assist fee. Trigger rates are unmeasured; the design point is both
assists firing.

**Wall time is the real local cost.** Time ≈ prefill tokens ÷ prefill rate +
output tokens ÷ (decode rate × effective concurrency). A worked example at the
27B card's rates: 2 MB of page text is about 32 chunks, 520k prefill tokens and
20k extraction output tokens, which is about 5 minutes of prefill and 9.5 of decode
sequentially; the writer (30-47k output tokens) adds 14-22 minutes; the total is
about 30-40 minutes, at the edge of criterion 7. At the API-only target's decode
rate and three parallel streams the same work would take well under 15 minutes.
These are arithmetic on other deployments' measured rates, not predictions for the
new endpoint; E0 measures the real ones.

### 5.5 Capability build for Manus-depth public research

- **A ledgered search destination** in the broker: a new kind, or a `public_web`
  variant with a bound query template. GET only, credentials refused, DNS pinned,
  one zero-fee receipt per query, ≤ 30 per task. SearXNG self-hosted on the device
  or the Mac on loopback or LAN, with a runbook. Brave or a provider search API
  only as an owner-keyed alternative under exact-byte consent and a 20-call cap.
  Queries count as disclosed bytes.
- **Fetch volume and retention:** ≤ 60 fetches plus ≤ 20 one-hop follow-ups, ≤ 1 MiB
  raw per page retained under `public-sources/`, misses recorded, retained bytes
  written into the workspace as today (`publicSourceWorkspacePath`). Web dispatches
  need their own request pool: the Heavy pool of 200 is already 188 committed to
  research (68), writer (80) and judge (40).
- **Text extraction in the sandbox:** HTML and PDF to text with `lxml` and `poppler`,
  which are already in the image; a paged reader replaces the 32 KiB prefix.
- **Run-trace metrics** in the registry row: queries, distinct URLs, domains, bytes
  read, actions by type, wall time, token classes, provider USD and search fees.
- **A citation checker:** every cited URL fetched during the run, the quote
  verbatim in the retained page (reusing `claims.ts`), and the claim entailed by the
  stored text (local judge, recorded as evidence).
- **Planted-conflict fixtures:** six public tasks with at least three contradictions
  each, authored by a separate session, gold held separately.
- **Benchmark adapters:** run records for the pinned LiveDRBench cases (official
  grader, paid judge) and DeepResearch Bench prompts (RACE, labelled `SOAR-pilot`).

### 5.6 Experiment program, re-gated

Each experiment is pre-registered, with one card per batch and one registry row
per run.

| # | Experiment | Arms and tasks | Fee cap (USD) | Days | Decision it changes |
| --- | --- | --- | --- | --- | --- |
| E0 | **New-endpoint qualification and role calibration**, run from the Mac | `scripts/serving-probe.py` P1-P9, plus new P10 (`response_format` `json_schema` per role schema, 20 calls each, thinking on and off, truncation counted apart from schema rejection), P11 (prefill and decode at 20k, 60k and 120k tokens; cache reuse on the extraction layout; K-stream concurrency) and an adapter probe (`/tokenize` route, reasoning field, legacy shape or `flash_next_v1`). Role fixtures: planner 3 × 10 on the exposed r3 index with raw replies retained; extractor on 3 synthetic chunks; judge on a fixed claim set labelled by a separate session, else the judge stays evidence-only | 0 | 2 | Every stage bound and clock; thinking policy per role; structured output per role (P10 ≥ 95% valid); the adapter path; K; whether the 2026-11-04 figures apply (same server) or not |
| E1 | **Recoverability**, no live model | extend `private-agent-broker.test.ts` and the runner and pipeline tests: cancel mid-call at each stage, upstream close, invalid JSON twice, a cloud timeout on an assist, stdout over 256 KiB, more than 1,024 files, a 500 KB synthetic corpus | 0 | 2 | The gate for any live run: zero zero-fee UNKNOWN rows, local work continues after a cloud UNKNOWN, cancellation still stops the stage |
| E2 | **Writer policy** on byte-identical packets | W1 current Heavy writer; W2 preloaded presentation with an output budget from E0, thinking on; r3 plus 2 synthetic packets, 2 repeats: 12 runs. W3, W2 with thinking off, adds 6 runs only on the owner's named decision. Blind proxy grades | 0, plus ≤ 1 for fixtures | 3 | The E3 and E4 writer; the never-run 12-call bound and thinking-off are hypotheses here |
| E3 | **Closed-corpus route round** on the frozen fresh tasks f1-f3 (204-513 KB, 23 critical checks) | A all-local v5 × 2 repeats; B local-first with T1 and T2 × 2 (cap 0.60 per run); C forced split × 1 (0.60); D all-cloud ceiling × 1 (3.00); one r3 calibration run per arm: 22 runs | 18.6 (expected about 6.2) | 7 | The public-research default on files; measured trigger rates (gate signals logged on every arm) |
| E4 | **Manus-bar public round**, web scale | 2 pinned LiveDRBench cases, 2 pinned DeepResearch Bench prompts and 2 fresh planted-conflict tasks; arms A and B; 2 repeats: 24 runs; cap 0.75 per episode. Graders: the official LiveDRBench grader, DeepResearch Bench RACE as `SOAR-pilot`, the local citation checker, conflict gold, blind proxy acceptance. The external ceiling is the published product scores; no all-cloud web arm is built | 14: 12 × 0.75 + judge fees ≤ 4 + fixtures ≤ 1 (expected about 6) | 10 | Whether public deep research ships to the desktop as the default route, and which criterion is the next lever |
| E5 | **Desktop real-jobs trial (OAJ)** | The owner's real public or synthetic jobs in the shipped build, from week 1 on the routes that exist (document review, deck, site; local only); the research route joins when backlog item 13 lands, with the per-task assist toggle after E3 | 0 local; assists from the weekly public-work line, ≤ 0.75 per task | 14+ | OAJ ≥ 3 of 5 marks the routes `Verified` and makes P1 next; 1-2 means one lever per the trial-first rule; 0 means no route work until the cause is named |
| E6 | **Document review, two samples** | R1 single sample against R2 two samples with host selection and local critique and repair; 3 synthetic planted-defect `.docx` files; 12 runs | ≤ 1 (fixtures) | 4 | The desktop review route; the numeric cross-check and clause-inversion flags ship either way |
| E7 | **Coding review packet (T3)** | only if E5 reaches OAJ ≥ 3 and the owner asks: L against L+T3 on c1 plus 2 synthetic tasks | 1.5 | 3 | Whether coding gets any cloud |

**Decision rules, pre-registered.**

- **E3** is an investment rule; n = 3 per repeat cannot detect gaps under two tasks.
  Ceiling first: if D accepts fewer than 2 of 3, the round is harness-limited and no
  route changes. B becomes the default if accepts(B) ≥ accepts(D) − 1 on both
  repeats, mean settled USD(B) ≤ 0.25 × USD(D), no B run hit its cap and every
  assist receipt shows 0 cache-write tokens. If in addition accepts(A) ≥ accepts(B)
  on both repeats and no accepted B run had an assist fire, A is the default and
  assists stay the owner's option. If C's three runs accept at least two more than
  B's first repeat, the forced split becomes the default pending a new entry. A run
  that does not submit or stops at its cap counts as rejected; a result with ≥ 80%
  correct arm guesses is labelled weakly blinded.
- **E4** measures the bar: if ≥ 80% of task-runs meet all nine criteria at a P50
  cloud-plus-search cost ≤ USD 0.50, public deep research ships as the default; at
  50-80% it ships local-first as a beta with the failing criteria named; below 50%
  there is no desktop public-research route, and the next lever is the single stage
  the failing criterion points to (retrieval volume, the T2 packet or the writer),
  one lever per entry.
- **E4 option**, separately gated and the owner's call: the same six tasks on a
  Manus Pro account, logging credit use from Manus's task API; about 18 runs at
  500-900 credits is USD 45-81 at list. It is recorded as a product baseline, never
  mixed with the same-harness arms (`benchmarks/README.md`). It is the only way to
  replace the proxy thresholds of §2.2 with measured Manus numbers.

**Order.** Week 1: backlog items 0-5, E0, E1, the owner's P11 interim (an SSH local
forward) and box checklist, and E5 on the existing local routes. Week 2: E2, E6,
items 6-9, and item 12 starts. Week 3: E3; item 12 completes; item 11. Weeks 4-5:
E4; item 13 desktop wiring, tagged `owner-v0.3`. Week 6: the research route goes
live in E5; review OAJ and the three bars. If fewer than three owner jobs were
submitted by then, Branch D applies (pause and record the adoption lesson), as
PLAN.md says.

**Budget.** The harness line has about USD 29.4 left. E3's cap is 18.6 (expected
about 6.2) and E4's is 14 (expected about 6), together 32.6 in caps. Caps are worst
cases, so E4 is admitted only if the line's remaining balance after E3 settles is
at least USD 14 (expected about 23), or the owner records a reallocation from the
unused weekly public-work line. E5 assists draw on the weekly public-work line;
E6 and E7 fixtures on the synthetic line (USD 20). E3 and E4 each need a named
`Approved` entry: the approved H5 shape (18 rows, USD 21.60, other arms) cannot be
renamed into them.

### 5.7 Engineering backlog

Ordered; small PRs; any change to a persisted contract or to dispatch semantics
gets its decision entry first.

0. **Process entry:** restore PLAN.md §4(c) for zero-fee work and close per-trial
   named authority for zero-fee runs; the owner records it `Approved`.
1. **Zero-fee failures resolve** (A1, A2, A8, B1): for zero-risk packets, treat
   `cancelled`, `request_timeout`, `inactivity_timeout` and settlement-phase
   validation failures as `failed`, not `unknown`; add a sub-code to the settlement
   diagnostic; check remaining time against the request timeout before dispatch.
   Cloud and consultant semantics are unchanged. Prerequisite of E0 and E1.
2. **Owner verdict capture:** accept, minutes and interventions on a submitted task,
   appended to the registry through `registry-row.py`. Needed on E5's first day.
3. **Stop bricking tasks** (A3, A4, A5, B5): capture inside the action's error
   handling, with `tool_finished` written on capture failure; the lister skips and
   reports symlinks and oversize files instead of `die()`; bounded excerpts on
   output overflow instead of destroying the container; the remaining pre-dispatch
   broker codes handled; specific tool error codes returned to the model.
4. **Diagnostics keyed on label** (F3, B2-B6): raw replies and validation errors
   retained for public and synthetic contexts; hashes only for labelled ones.
5. **Probe extensions:** P10, P11 and the adapter probe in `scripts/serving-probe.py`;
   a planner fixture script; a serving-card writer.
6. **Desktop resume** (A6, A7): every reason without an unresolved dispatch is
   resumable; `runtime_unavailable` stays resumable; a research-stage pause either
   resumes from persisted stage counters or cancels the stage, as the UI says.
7. **Pipeline tolerance, as three PRs** (D1-D6, D8, D9, D11, D13): (a) per-quote
   drop, heading normalisation, per-role thinking policy and output caps from the
   card; (b) the extraction layout, local packet trimming with disclosed omissions
   accepted by the ready gate, index batching by preview size, admission bounds and
   the feasibility estimate, the length cap from the brief; (c) the host fallback
   plan, skeleton synthesis, and a planner budget of two local calls plus one assist.
8. **Concurrent zero-risk local dispatch** (D12): the ledger admits several
   in-flight zero-fee local rows; index, extraction and judge loops run K at a time;
   cloud stays serialized and at-most-once.
9. **Structured output** behind a probe flag, reusing the `ReviewResultV1`
   `response_format` shape already sent by `openai-compatible.ts:223`.
10. **Assist wrapper for T1 and T2:** slim packet builders, explicit cache mode with
    a test asserting zero cache writes, per-touchpoint output caps, the fallback and
    stop code lists, the assist-purpose exclusion, receipt fields in the registry row.
11. **Harness:** gate signals logged on every arm; `infra_invalid` classification
    with zero-fee resume; registry columns for queries, URLs, domains, bytes, settled
    and reserved USD, body bytes and disclosed bytes; ties to the original (E9); the
    entailment step off until gold exists (E10); `git` set to the run's commit (E4);
    the supervised launcher (BL-20261101-0036) with an idle-window schedule for E3
    and E4.
12. **Search and browse front-end** (§5.5).
13. **Desktop wiring**, local only plus the per-task public assist toggle: research
    route (files and web scope), document review, the claims ledger for file-only
    research and `judgeModelFactory` from the controller (D10), a dispatch badge with
    counts. Tag `owner-v0.3`.
14. **P11 transport** (C3): refuse plain HTTP to the local model unless it is
    loopback or carries an explicit tunnel marker; an SSH local forward with a pinned
    host key as the interim; the box checklist; a packet-capture canary. The owner's
    day of work.
15. **P1 labels** replacing the `publicOrSynthetic` checkbox (public, or labelled
    with regime tags; monotonic join; imports labelled by default), after E5
    evidence. The T4 labelled packet path per D15 stays deferred.
16. **Later:** build-log rotation (E3); delete the legacy tracks or route the coding
    worker through the broker (C2); A9; consolidate limits (E5).

### 5.8 Stop list (recorded once, in one entry)

- H4's select-and-repair loop as a gate, and H5 as shaped (18 rows, USD 21.60):
  closed and superseded by E3 and E4. The pipeline code and f1-f3 are kept.
- The all-cloud agent loop as a product route (it stays a ceiling arm); the agent
  loop as a research reader; every cloud critique or verification path; model-judged
  escalation triggers; "7/7 automated" reported as accepted.
- Per-attempt plan documents and approvals, slot, claim and allocation accounting,
  and the untracked launcher as a gate, for zero-fee local requests.
- Permanent UNKNOWN on zero-fee failures; discarding raw replies on public and
  synthetic runs; all-or-nothing stages; `promptCaching` left undefined on
  one-shots; one-at-a-time local dispatch.
- Serving-recipe work (NVFP4, q4t, disk, conversions) until E0 shows a role-level
  gap on the new endpoint; the 27B card as a source of bounds; the 12-call writer
  bound and the thinking-off writer treated as facts (they are E2 hypotheses).
- Before accepted public jobs exist: a generic multi-family stage graph, admin
  stages, a weekly cap inside the per-job fee ledger, a labelled opt-in slice.

### 5.9 Process reset

- Build-log entries only for the seven decision classes in PLAN.md §4, at most 25
  lines each; caps stated once in PLAN.md, not repeated per entry; rotation per
  backlog item 16.
- One experiment card per batch; one registry row per run with the three columns;
  one OAJ row per owner job (`verdictBy: owner`, `ownerMinutes`, `interventions`).
- Zero-fee local work: no approval entries, no slots, recoverable retries on.
- Any gate that decides whether an experiment runs lives in tracked code with a
  test, or it is not a gate.
- The new endpoint is configured only in the owner's ignored `.env.local`:
  `SOAR_VLLM_BASE_URL`; `SOAR_VLLM_MODEL` set to the served alias from `/v1/models`;
  `SOAR_VLLM_COST_POLICY=local_zero_cost`; and `SOAR_VLLM_REPLY_CONTRACT=flash_next_v1`
  with `SOAR_VLLM_CONTEXT_TOKENS` and the admission file only if E0 shows the
  endpoint satisfies that contract. Tracked files call it "the owner's endpoint";
  its serving card records the alias, engine version and context, never the address.

### 5.10 Decisions the owner must record

1. Is the new endpoint the 2026-11-04 API-only target (alias `RM-01 VLM`)? E0's P1
   answers this. If it is, the 2026-11-04 figures are admissible and E0 is a delta
   check; if not, none of them apply.
2. Backlog item 0, the zero-fee process entry.
3. A named `Approved` entry for E3 and E4 against the harness line, with E4's
   admission condition or a reallocation from the weekly public-work line.
4. Which provider carries the assists: `claude-sonnet-5-5` (the 2026-10-30 decision)
   or `gpt-6-sol` (the only one with measured assist receipts).
5. Whether E2 may include a thinking-off writer arm (BL-20261031 recorded it as not
   approved).
6. SearXNG self-hosted on the device or the Mac, or a keyed search API under the
   20-call cap.
7. The P11 timeline: an SSH local forward now, WireGuard later. Nothing labelled
   runs before it.
8. Whether to fund the Manus product baseline (about USD 45-81, a separate account).
9. Grading capacity: whether blind proxy grades may stand as provisional, with the
   owner's verdicts on every E5 job and a sample of E3 and E4.
10. Whether briefs will number their requirements, and whether the public brief may
    be disclosed with the exact first assist packet shown before dispatch.
11. The OpenAI dashboard reconciliation for Phase 2 (up to 22% on every all-cloud
    baseline) and D20(b): is private source code regime-tagged by default?

---

## 6. Measured versus assumed

**Measured** (settled receipts, registry rows, code constants, or a stated formula
applied to a stated bound): every SOAR USD figure; the split, all-local and
all-cloud results on r3; the Phase 2 family pattern; the critique tie; the 27B,
Flash-Next and API-only throughput figures; every code finding marked H.

**Assumed or hypothesis**, which E0-E4 exist to measure: the new endpoint's
identity, throughput, concurrency, structured-output validity and adapter path;
local plan and synthesis failure rates, and so the assist trigger rates; acceptance
on fresh tasks for every route; whether the depth criteria are reachable on local
hardware inside 30 minutes; the judge's agreement with graders.

**Third-party and low confidence:** every Manus per-task figure (a reviewer band,
not a logged measurement), Manus's depth profile, and competitor per-report costs
other than those computed from published API prices.

---

## 7. Sources for the Manus bar

Read on 2026-11-05. Manus's own pages could not be fetched from the review
environment, so the Manus figures rest on search excerpts of the official pages
plus third-party captures.

| Topic | Source | Date | Confidence |
| --- | --- | --- | --- |
| Plans and credit prices | Manus Help Center, "What is the current membership pricing for Manus" (https://help.manus.im/en/articles/11711111-what-is-the-current-membership-pricing-for-manus) | about 2026-10-23 | High (excerpt) |
| Credit rules, free-tier cap | Manus Help Center, credit consumption rules (https://help.manus.im/en/articles/11711097-what-are-the-rules-for-credits-consumption-and-how-can-i-obtain-them) | about 2026-10-01 | High (excerpt) |
| No pre-task cost estimate | Manus Help Center (https://help.manus.im/en/articles/13185575-is-there-a-way-to-check-how-many-credits-a-task-will-cost-before-i-begin) | 2026 | Medium |
| Wide Research limits | Manus Help Center, "What is Wide Research" (https://help.manus.im/en/articles/11960169-what-is-wide-research) | 2026 | Medium |
| USD 200 tier | Manus blog (https://manus.im/blog/best-ai-app-builders); pricing-page capture (https://www.usagepricing.com/blueprint/manus) | 2026-09 to 2026-10 | Medium |
| Manus 2.0 cost claim | Manus blog (https://manus.im/blog/introducing-manus-2-0) | 2026-09-28 | Vendor claim |
| About 50 tool calls, 100:1 input to output, KV-cache hit rate | Manus blog, "Context Engineering for AI Agents: Lessons from Building Manus" | 2025-07-18 | High, but dated |
| Single-context fabrication past 8-9 items | Manus blog (https://manus.im/blog/manus-wide-research-solve-context-problem) | 2025-10-29 | Medium |
| 300-900 credits per research task | Reviewer reports, for example https://www.lindy.ai/blog/manus-ai-review and https://trycompass.co/review/manus-review | 2026 | Low to medium |
| Depth rules (open original pages, no snippet citations, several thousand words) | An unofficial, publicly circulated copy of Manus's 2025 agent prompt | 2025-03 | Low |
| DeepResearch Bench (RACE, FACT) | arXiv 2506.11763; https://github.com/Ayanami0730/deep_research_bench | 2025, updated 2026 | High |
| LiveDRBench | arXiv 2508.04183; https://github.com/microsoft/livedrbench | 2025 | High |
| Mind2Web 2 | arXiv 2506.21506 | 2025 | High |
| Citation fact-check frontier | "Cited but Not Verified", arXiv 2605.06635 | 2026-05 | Medium |
| Gemini Deep Research prices | https://cloud.google.com/model-garden/pricing | 2026-11-05 | High for token prices |
| OpenAI and Perplexity API prices | LiteLLM price map (https://github.com/BerriAI/litellm, `model_prices_and_context_window.json`) | 2026-11-05 | Medium |
| GPT Researcher cost and depth | https://github.com/assafelovic/gpt-researcher (README) | 2026-11-05 | High for the README's statements |
| Kimi Researcher depth | Moonshot AI Kimi-Researcher project page | 2025-06-20 | Medium |

---

## 8. Method and code map

**Method.** The review read PLAN.md, HANDOFF.md, the 2026-09-28 review, the Phase 4
experiment record, all 99 registry rows and about the last 60 build-log entries,
plus the key plans. Three read-only code audits covered the core loop, the privacy
boundary and the harness. Two multi-agent rounds followed. The architecture round
produced four independent designs, twelve critiques, a synthesis and a completeness
critique, then a revised synthesis. The Manus round ran six web sweeps and a
115-row source verification. Every code finding marked H was re-read at the cited
line, and every SOAR number was re-read in the build log or the registry. The
owner's corrections of 2026-11-05 changed the goal, the model and the research bar
after the first draft of this review, and the text above reflects them.

**Code map.** Short names in the tables resolve as follows.

| Name | Path |
| --- | --- |
| `broker.ts`, `store.ts`, `runner.ts`, `sandbox.ts`, `session.ts`, `model.ts`, `profiles.ts`, `contracts.ts`, `checkpoints.ts`, `claims.ts`, `selection.ts`, `repair.ts`, `consultation.ts`, `public-sources.ts`, `flash-next-admission.ts`, `document-review.ts`, `research-*.ts` | [src/main/private-agent/](../src/main/private-agent/) |
| `controller.ts` | [src/main/general-tasks/controller.ts](../src/main/general-tasks/controller.ts) |
| `general-task-contracts.ts` | [src/shared/general-task-contracts.ts](../src/shared/general-task-contracts.ts) |
| `config.ts`, `bootstrap.ts` | [src/main/config.ts](../src/main/config.ts), [src/main/bootstrap.ts](../src/main/bootstrap.ts) |
| `search-text.ts` | [src/main/tools/search-text.ts](../src/main/tools/search-text.ts) |
| `openai-compatible.ts` | [src/main/providers/openai-compatible.ts](../src/main/providers/openai-compatible.ts) |
| `worker.py` | [runtime/patch-worker/worker.py](../runtime/patch-worker/worker.py) |
| `private-agent-local-screen.ts`, `phase4-loop.ts`, `registry-row.py`, `validate-build-log.ts`, `serving-probe.py` | [scripts/](../scripts/) |
| `phase4-loop.test.ts`, `private-agent-broker.test.ts` | [tests/unit/](../tests/unit/), [tests/integration/](../tests/integration/) |
| `ci.yml` | [.github/workflows/ci.yml](../.github/workflows/ci.yml) |
| `registry.jsonl` | [experiments/registry.jsonl](experiments/registry.jsonl) |
