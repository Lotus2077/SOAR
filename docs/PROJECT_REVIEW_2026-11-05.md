# SOAR whole-project review and goal-anchored reset

Reviewed: **2026-11-05**, on `main` at `153b8e6`, identical to `origin/main`. Code
and PLAN.md line numbers refer to that commit.
Status: **review complete; every recommendation in it, and every reading of the
owner's direction, is `Proposed`** and needs the owner's recorded decision before it
takes effect. The owner's own directions of 2026-11-05 are recorded verbatim in
BL-20261105-1821-owner-direction-equal-weights-new-model, except the first message's
standing instruction (direction 4 below), which
BL-20261105-2016-correction-direction-and-review-entries records verbatim. That
entry, BL-20261105-1357-second-check-corrections-utc-reset,
BL-20261105-1550-third-check-corrections, BL-20261105-1650-fourth-check-corrections
and BL-20261105-1722-fifth-check-corrections correct the day's earlier entries. This
version, PLAN.md and those correction entries apply the fixes for every finding that
the five adversarial checks of §8 confirmed. This document succeeds the [2026-09-28
review](PROJECT_REVIEW_2026-09-28.md).

The review launched no SOAR model request, application, Docker container, paid
call, endpoint probe or test run. The owner's new endpoint is not reachable from
the review environment, so nothing here measures it. Research on Manus and
comparable products used public web pages only.

## The owner's direction (2026-11-05)

1. **Privacy, result quality and token cost weigh equally.** The local model takes
   on more responsibility. For public deep research it does "the dirty work" on
   free tokens, and the cloud takes only the hardest part (the owner: "let the
   cloud model only to take on the hardest the part of the problem"), so cost falls
   far below an all-cloud agent such as Manus while quality stays good.
2. **The 27B model is retired** as "half sufficient" for daily work. A supposedly
   stronger model now serves at a new endpoint, and all later local work uses it.
   Its address is to be kept only in the owner's ignored `.env.local` (§5.9), never
   in a tracked file.
3. **The research bar is Manus-level depth**, "not just normal research", and the
   cost comparison is Manus's per-task cost.
4. **Everything after this review serves the project's goal**, which the owner
   states as "to preserve privacy while providing good results and saving tokens",
   the three weighed equally. The owner's first message asked to "clarify what the
   ultimate goal of the project is and then propose the new best way to achieve that
   goal and all following experiment design and steps should stick follow and stick
   to that goal"; the standing instruction is recorded verbatim in
   BL-20261105-2016-correction-direction-and-review-entries. §2 is this review's
   clarification of that goal; like the readings below, it stays `Proposed` until
   the owner confirms it (§5.10, item 3).

The direction replaces the order "privacy >= quality > savings > latency" (PLAN.md
§1, and the privacy-first design whose order PLAN.md §8 listed as kept) and
PLAN.md §1's line "Savings are descriptive only". This review reads the same
direction as also superseding two more lines, pending the owner's confirmation
(§5.10, item 3): PLAN.md §1's rule that USD per accepted job is reported "never as
gates", and the first item of PLAN.md §2's W10 Stop row, "Treating API savings as a
design driver" (its second item, on the "Hybrid +4.93%" figure, stands). On that
reading OAJ stays the adoption north star and route decisions use the three
columns.

The owner did not address labelled data on 2026-11-05. This review reads the
2026-09-29 privacy rule and D15 as unchanged. Labelled data never reaches the
cloud automatically, and D15's planned path (one derived-material packet per task,
under the owner's exact-byte approval) stays behind its gates. Within that
constraint the three columns weigh equally. The owner is asked to confirm these readings (§5.10, item 3).

---

## 1. Where the project stands

| Fact | Evidence |
| --- | --- |
| Capability (fair test, Oct 12-19) | 12 fresh tasks: cloud `gpt-6-sol` 10/12; local Heavy 27B 6/12 and 4/12. Local matched or beat cloud on document review, decks and websites; it lost research 0/6, coding and admin (BL-20261019-0432). |
| **The owner's thesis already has one favourable data point** | Two H3 split runs (cloud plans and synthesises from host-verified quotes, everything else local): **USD 0.122 and 0.126** settled, 7/7 gold checks on both. Entailment was 33/6/0/0 with 1 not judged of 40 on H3 v2 (31.7 minutes, writer prompts 89% cached, BL-20261026-1605) and 29/7/1/2 of 39 on protocol v3 (10.1 minutes, 77% cached, BL-20261026-1644). All-cloud on the same task: **USD 3.05** uncached with 3/7 gold checks (Phase 2 r3; 3.05-3.77 across r1-r3); cached, **USD 1.13** on Claude (submitted; USD 1.151653 with its two shape probes, which the owner's Console showed as 1.15) and USD 1.18 on `gpt-6-sol` (r3-cloud-v3, stopped at its 80-call allowance with a failed host check and never graded, so a lower bound). All-local pipeline: **USD 0**, 7/7, 625 s (BL-20261025-2055). All of this is one exposed calibration task under automated checks; no pipeline output has been blind-graded on a fresh task. |
| Local model history | 27B qualified 2026-09-28: 35 tokens/s prose, 56-67 thinking, prefill about 1,790 tokens/s. The Flash-Next migration measured 19.94 tokens/s. The API-only target (alias `RM-01 VLM`, model root `Qwen3.8-Flash-Next-NVFP4`, 262,144-token context, vLLM 0.33.0rc1.dev617+g821038729) passed its 16-case qualification on 2026-11-04 at 70.2 tokens/s full-request and 153.8 decode on two probes, with physical identity unobserved (BL-20261104-1419). The same alias served the 27B earlier, so it does not identify a model. **The owner's new endpoint: no serving card, no role fixture, unknown adapter path.** |
| Need (owner usage) | One owner-run real job ever (document review, 2026-10-12, accepted, 19 actions, 493 s). None since. |
| Privacy tier | Tier O blocked. The endpoint was plain HTTP, unauthenticated, on a public address (serving card 2026-09-28). The box card (2026-10-06) lists 8 hardening gaps; none is recorded fixed. Data labels (P1) and label-aware egress (P2) are not in code. |
| Public research capability | Up to 3 exact user-typed URLs; 5 fetches of at most 64 KiB each; a 32 KiB inline observation per fetch, with the complete retained page copied to `sources/` in the workspace (`runner.ts:604-607`); **no search, no link following, no browser** (`public-sources.ts:6-7`, HANDOFF.md). The broker knows three destination kinds, `local_model`, `cloud_model` and `public_web` (`broker.ts:23`), and refuses credentials on `public_web` (`broker.ts:281`). |
| Last 14 days | Harness H1-H5, the Claude adapter, the 27B to Flash-Next to API-only migration, three writer pilots and the v4 pipeline rewrite. Accepted artifacts: none independently accepted; three r3 calibration runs (H2 all-local, H3 split v2, protocol-v3 split) carry agent-diagnostic `accepted` registry rows that rest on automated checks. H4: six attempts, none accepted. H5: never started. 138 build-log entries in six days; 60 of the last 78 non-merge commits were documentation only. |
| Budget | USD 300 envelope. About **USD 25.4** used: USD 24.54 in unique registry receipts plus about 0.83 logged outside the rows (0.13 of Phase 2 critiques, about 0.70 of H1 probes); up to about 25.7 at the H1 write rate. A naive registry sum gives USD 25.79, because two superseding rows repeat their fee (finding E11). The Phase 2 dashboard reconciliation is still pending, up to USD 4.72 more (BL-20261022-1157). Phase 4 harness line: USD 33, with about USD 4.3 used (up to 4.6 at the write rate: H1 runs and probes 2.73-3.06, H3 0.38, Claude 1.15; USD 3.56 of it is in registry rows), so about **USD 28.4-28.7 remains**. The weekly public-work line (USD 25) is unused. |
| Benchmarks already pinned | 10 LiveDRBench structured cases (official grader at `6ff85b67`, paid judge) and 12 DeepResearch Bench long-form prompts (`469cce54`; RACE possible, FACT credentials missing) in `benchmarks/research.jsonl` and `benchmarks/sources.json`. The cloud deep-research products are publicly scored on both. |
| CI | Never runs Docker, a model, the general-task end-to-end path or Python tests; the research pipeline runs only against fixture models (`private-agent-research-pipeline.test.ts`). The only Electron end-to-end test exercises legacy Labs tracks on a fake provider. |

---

## 2. The ultimate goal (proposed)

> **Deliver Manus-level results on the owner's real work, public deep research
> first, at a fraction of Manus's cost, without private data ever leaving the owned
> device unless the owner approves the exact bytes: the local model does all the
> volume work at zero fee, and the cloud takes only the hardest step, as sealed
> one-shot packets.**

### 2.1 Three equal columns, recorded for every run

| Column | Measure |
| --- | --- |
| Quality | Blind acceptance (owner, else a blind proxy with arm guesses recorded) **and** the depth criteria of 2.2. |
| Cost | Settled cloud USD plus search fees; reserved USD and body bytes per cloud call. |
| Privacy | Disclosed bytes: unique bytes that left the device, including file names, URLs, hashes and search queries. Labelled bytes must be 0 on every route; a D15 packet the owner approved byte for byte (T4, deferred) is recorded separately. |

**Frontier rule (proposed, replaces the lexical order).** A route change is adopted
only if the new route is worse on no column by more than that column's tolerance and
better on at least one column by more than its tolerance. Each column has a
symmetric noise band: quality, one accept in six, with no depth criterion newly
failed; cost, USD 0.02 or 10% of mean settled USD, whichever is larger; privacy, 10%
of public disclosed bytes, with no tolerance for labelled bytes, which are zero on
every route (D15's owner-approved T4 packets, deferred, sit outside route
comparison). A route newly fails a per-run depth criterion when, among the runs to
which that criterion applies, the share of its runs meeting it is lower than the
other route's by more than one run in six; it newly fails criterion 7 when it misses
it and the other route meets it, and criterion 9 when it meets it on more than one
task fewer. Criterion 8's blind verdict is the accept count itself, judged by the
quality band of one accept in six; only its entailment threshold, if E0 activates
it, counts as a depth criterion. A route is better on quality beyond tolerance when
its accepts exceed the other route's by more than one in six or the other route
newly fails a depth criterion. When a route is better on one column and worse on
another beyond tolerance, or each of two routes is better on quality in one of these
two ways, the owner decides and the registry row records why. Equal weight does not
make labelled data tradable; for public data the disclosed bytes are a measured cost
to minimise like dollars.

### 2.2 The quality bar: Manus-level depth (proposed)

Manus publishes no per-task source, citation or report-length figures. Its per-task
figures include about 50 tool calls per typical task (a 2025 blog post), 2025
credit-and-minute examples for other task types, two vendor-selected 2025 showcase
posts (817 credits for a deep-dive research site, known only from a search-index
excerpt, and 635 for a scheduled task that built profiles and deployed a web app),
and a 2025 Wide Research post's unverified claims, known only from a search excerpt,
that a single context starts fabricating by the eighth or ninth item and that Wide
Research takes about as long for 50 items as for 5. The bar below is assembled from
those, Manus's published descriptions, reviewer reports, the cloud deep-research
products, the two benchmarks SOAR already pins, Mind2Web 2 and the "Cited but Not
Verified" study. **The thresholds are proxies.** They should be re-baselined when a
Manus product baseline exists (E4 option).

Criteria 1-6 and 8 apply to each run, each where it fits the task: criterion 1's
query coverage and criterion 4's F1 on LiveDRBench cases, criterion 4's RACE on
DeepResearch Bench prompts, criterion 5 on planted-conflict tasks, and criterion 3's
count of 30 and criterion 6 where the deliverable is a report. LiveDRBench cases
deliver JSON; there every entry or field of the answer must be backed in
`claims.json` by a verbatim quote in a page fetched during the run, and criterion
3's accuracy figures are recorded on those quotes. Criterion 7 applies to each route
over all its runs, and criterion 9 to each task and route. A run meets the bar when
it meets every per-run criterion that applies to its task.

| # | Criterion | Threshold | Anchor |
| --- | --- | --- | --- |
| 1 | Breadth | ≥ 30 distinct URLs fetched and read in full from ≥ 10 domains; ≥ 20 distinct search queries; ≥ 60% required-query coverage on LiveDRBench traces | Humans visit 8 sites and 110 pages on Mind2Web 2; query coverage OpenAI DR 66%, Perplexity 52% |
| 2 | Actions | ≥ 40 logged actions, ≥ 25 of them fetch or read | Manus reports about 50 tool calls per task |
| 3 | Citations | ≥ 30 effective citations, each a verbatim quote in a page fetched during the run; no snippet-only citation. The local judge's citation accuracy and fact-check accuracy are recorded; ≥ 85% and ≥ 80% become thresholds only if E0's judge fixture reaches the agreement level its card sets | DeepResearch Bench FACT, 2025 Table 1 under the earlier Gemini-2.5 evaluator: Perplexity 90.24%, Gemini 81.44%. These are loose anchors: the pinned revision's FACT judge is GPT-5.4-mini, and SOAR measures with its local citation checker, not FACT. Fact-check frontier 39-77% |
| 4 | Coverage | LiveDRBench F1 ≥ 0.35 (stretch 0.55); DeepResearch Bench RACE at the pinned revision `469cce54`, whose default RACE judge is GPT-5.5, labelled `SOAR-pilot` without FACT, with the threshold set before E4 from GPT-5.5-judged product scores | LiveDRBench F1 OpenAI DR 0.555, Perplexity 0.355. RACE Perplexity 42.25 is a 2025 score under the earlier Gemini-2.5-Pro judge and is not comparable; the GPT-5.5 leaderboard was not read |
| 5 | Conflicts | ≥ 80% of planted contradictions surfaced with both sides cited; none silently resolved | SOAR fixtures (E4) |
| 6 | Report | 2,500-6,000 words of continuous prose with sections, a summary, ≥ 1 table and a URL reference list; plus `claims.json` mapping claim to URL to verbatim quote; a CSV when the data is tabular | Manus's agent prompt asks for "several thousand words" (unofficial copy) |
| 7 | Time | ≤ 30 minutes P50, ≤ 45 minutes P95 | Manus 14-50 minutes (third-party reviews); SOAR's split runs 31.7 and 10.1 minutes |
| 8 | Acceptance | Blind-accepted (owner, else a blind proxy); a run that does not submit or stops at its cap counts as rejected. The local judge's entailment counts are recorded as evidence; supported plus partial ≥ 90% with 0 contradicted becomes a threshold only if E0's judge fixture reaches the agreement level its card sets | Phase 2 cloud research runs: 3/3 accepted by blind proxy graders, two of them (r1, r3) as unsubmitted drafts stopped at the 80-call cap, so 1/3 under this rule. Entailment so far: split v2 33 + 6 of 40; protocol-v3 split 29 + 7 of 39 with 2 contradicted. The rates do not separate accepted from rejected drafts (F8) |
| 9 | Stability | Per task and route: ≥ 3 runs, depth metrics within 2x of each other | Manus's credit use reportedly varies about 2x between runs of the same task type (one third-party review, low); no source measures Manus's depth variance |

### 2.3 The cost bar: a fraction of Manus

| Item | Value | Confidence |
| --- | --- | --- |
| Manus list price per credit, all 2026 paid tiers | USD 0.005 (USD 20 for 4,000, 40 for 8,000, 200 for 40,000; Team USD 20 per seat for 4,000 pooled). Free: 300 per day, at most 1,500 per month, Lite model only. Add-on packs about USD 0.01 per credit, reportedly sold only on the highest monthly tier | High for the USD 0.005 plan rate (consistent official excerpts and third-party captures); low for the add-on price (third-party pages only, no official price found). The official pages could not be re-fetched from the review environment |
| Manus standard deep-research task | 300-900 credits, **USD 1.50-4.50** at list (central 2.50-4.50; 3-9 if bought as add-ons) | Low to medium. The 500-900 central band is a reviewer estimate repeated across blogs; the 300 floor rests on two blogs' estimate for a 10-source report; no logged run pairs sources, actions, minutes and credits. Most of the evidence predates Manus 2.0 (2026-09-28), which claims 32% lower cost in one tested configuration (vendor claim); per-task burn since 2.0 is unmeasured |
| Manus Lite / Max / Wide Research | USD 0.30-1.00 / 7.50-25 / sub-tasks capped at 50 credits each and run 20 at a time, so at most about USD 5 of sub-task credits per 20-sub-task batch plus the orchestrating task (an inference; whether the cap bounds a whole run is unknown); third-party per-run estimates range from USD 0.40-2 (80-400 credits, nocode.mba) to USD 4-7.50+ (800-1,500+, coworker.ai, fast.io), and reported burns reach USD 20-50 (4,000-10,000 per run in quorum notes; 10,000 in one Trustpilot review) | Low |
| SOAR today, same closed-corpus task (r3) | All-cloud uncached 3.05 (3.05-3.77 across Phase 2 r1-r3), inside the Manus band; cached 1.13 (Claude, submitted) and 1.18 (`gpt-6-sol`, stopped at its allowance, a lower bound); split 0.12-0.13; all-local 0 | Measured, settled receipts |
| Comparable products per report | Gemini Deep Research about 1.22 at API list prices; Kimi Researcher about 0.95-1.90; GPT Researcher about 0.40; OpenAI o3 deep research about 10 (2025, model since deprecated) | Per figure (§7): Gemini's 1.22 applies official token prices (high) to token counts from one member-only blog (low); Kimi's is derived from a third-party estimate that one report uses 5-10% of the USD 19 tier (low); GPT Researcher's is its README's statement; OpenAI's is a 2025 Artificial Analysis post (unverifiable, stale) |
| **SOAR target** | **≤ USD 0.50 P50 per public deep-research task, cloud plus search; hard cap USD 0.75 per episode** (the cap already proposed in `benchmarks/README.md`); stretch 0.25. That is at most a fifth of Manus's central value and a third of its floor. | Target |

Two consequences follow. An all-cloud design cannot meet the target: caching makes
it only about 2-4x cheaper than Manus (USD 1.13 on a submitted cached run). And
search must be free or self-hosted. API search costs USD 5-10 per 1,000 calls
(Perplexity, OpenAI) and USD 14 per 1,000 for Gemini grounding beyond 5,000 free
queries a month, so the 20-30 queries that criterion 1 and R2's cap imply would
alone cost USD 0.10-0.42 per task if bought above any free allowance.

### 2.4 The privacy bar

Labelled contexts get no automatic cloud, search or web bytes. Their only planned
cloud path is D15's: one derived-material packet per task under the owner's
exact-byte approval (T4, deferred). Regime-tagged contexts get none. Public tasks
send the cloud derived material only: byte-capped packets, previewable before the
first dispatch. No labelled work runs on the device until the local endpoint is reached
over TLS, loopback or an explicit tunnel (P11). Until then the device confers no
privacy advantage over the cloud (F6).

### 2.5 What follows from the goal

1. **Local does the volume work:** query planning, triage, reading, extraction,
   writing, critique and repair. Volume is where an all-cloud agent pays: SOAR's
   three Phase 2 cloud research runs re-sent 1.46-1.79 million input tokens each,
   about 95% of their fee. Locally those tokens are free, and the writer measured
   75-89% prefix-cache reads.
2. **The cloud does only the hardest step, as a sealed one-shot:** a plan assist
   and a synthesis assist, measured at USD 0.030-0.034 and 0.091-0.099. There is no
   cloud critique (cloud and local critiques tied 4/6 against 4/6,
   BL-20261019-0838), no cloud reader and no cloud writer.
3. **When the cloud fires is measured before it is decided.** It can fire always, as
   in the forced split that produced F1's result (which the all-local pipeline
   matched on r3 at USD 0), only after the free local attempts fail on a
   deterministic host signal (local-first), or never (all-local). E3 runs all three
   under the frontier rule and measures trigger rates. The route its pre-registered
   rule leaves unbeaten becomes the default once the owner records it, and the owner
   chooses where routes trade under §2.1 or are equal within every tolerance (§5.10,
   item 2).
4. **Free local tokens buy breadth:** independent extraction calls run in parallel
   on the local server, the free analogue of Manus's Wide Research.
5. **Quality is blind-graded on fresh tasks** against the depth criteria. "7/7
   automated checks" is never reported as accepted.
6. **An experiment runs only if its result changes a pending decision** (§5.1).

---

## 3. Strategic and architectural flaws (ranked)

**F1. The program buried its own best results (critical).** The split arm (USD 0.12,
7/7) is the owner's thesis working on the first try, and the all-local pipeline
(USD 0, 7/7, better entailment) matched it on the same task. Both were gated behind H4, a
five-stage pass/fail chain where every ordinary failure (a chmod, a 90-minute
boundary, one invalid JSON reply) consumed the allocation and needed a new named
plan plus owner approval. Six H4 attempts failed, none of them a quality rejection
of a finished deliverable; H5 never ran. Twenty PHASE4 plan documents were written
in five days.

**F2. Model migration churn invalidated the serving evidence (critical).** The
device went from the 27B to Flash-Next (19.94 tokens/s, slower), then through
NVFP4, q4t and disk work, then to an API-only target (70 tokens/s full-request and
154 decode, combined over two probes, identity unobserved), and now to a new
endpoint with no card at all. Every stage bound in the pipeline (output caps,
clocks, the 40-chunk ceiling, the 16,384-token critic) was derived from the 27B
card and is unverified for the model that will run it. The adapter path is also
unknown: the legacy owned-vLLM shape and the `flash_next_v1` contract differ in
thinking semantics, reasoning field, exact-token request admission
(`broker.ts:357-365`) and the zero-fee settlement envelope (`config.ts:44-49`,
`model.ts:321,329`).

**F3. Tier O retention rules are compiled into code that runs on public fixtures,
which destroys debuggability (major).** The planner persists no model text by
policy (`research-plan.ts:1,13-18`). Since PR 34, a rejected attempt records error
codes and field paths (`research-plan.ts:23-29`, `research-pipeline.ts:140,143`),
but never the raw reply or the rejected values, even on public corpora. The
pipeline reduces every request error except a cancellation to one outcome reason,
`research_request_denied` (`research-pipeline.ts:100,103`), and the broker records
no sub-code for validation failures. Both v4 planning
replies in BL-20261105-0923 were rejected before those diagnostics existed, so that
run's failing fields are unrecoverable. Retention should bind to the data label.

**F4. The paid-dispatch ledger governs zero-fee local inference (major).** Slots,
claims, UNKNOWN receipts and no-replay were designed for at-most-once paid
disclosure. Applied to free local calls they do three kinds of damage. A deadline
cancel becomes a permanent UNKNOWN that bricks the job (A1). Only one dispatch per
job may be in flight, so free local tokens cannot be spent in parallel (D12). And
every zero-fee attempt has needed its own approval: PLAN.md §4(c) forbids approval
entries for USD 0 work, yet 38 of the 165 entries since Oct 22 carry Status
`Approved`, most of them for zero-fee local work, and the log's last three entries
require per-trial named authority for every live request. The slot logic
lives in untracked `.soar/` files that nothing in the repository tests.

**F5. The owner's headline use case has no desktop path (major).** Public deep
research with local dirty work and a cloud assist runs only from headless scripts.
The desktop controller never passes `research` to the session
(`controller.ts:601-610`), and only the headless driver applies the staged
document-review route (`private-agent-local-screen.ts:20,282`); desktop general
tasks can still review documents through the agent loop, as the owner's one
accepted job did (BL-20261012-1625-owner-job-classified). The owner build is still
`owner-v0.2` (2026-10-12). H4 measured a path the product does not ship.

**F6. The device confers no privacy advantage yet (major).** The endpoint was plain
HTTP, unauthenticated, on a public address. The broker permits plain HTTP whenever
`local_model && syntheticOnly` holds (`broker.ts:275-276`), which is the normal
desktop configuration; the only other gate is the machine-local opt-in
`SOAR_ALLOW_INSECURE_VLLM_HTTP=true` (`config.ts:176-177`). "Owned device" is a
self-declaration (`SOAR_VLLM_COST_POLICY`). The box card's fixes are about a day of sysadmin work
that nobody owns.

**F7. Public research cannot reach Manus depth (major).** Up to three URLs, five
64 KiB fetches, no search and no link following cannot reach criterion 1 (≥ 30
URLs, ≥ 10 domains, ≥ 20 queries). There is no search destination kind. Since the
2026-09-28 review (W3), a 404, redirect or bot block (any non-2xx response)
resolves `failed` and reaches the model as `public_fetch_failed`
(`broker.ts:667-668`, `store.ts:48`, `runner.ts:651-652`). Other misses still end
the task. A response over 64 KiB (`broker.ts:683,694`), a fetch still running at
the desktop destination's 15-second timeout (`controller.ts:367`, `broker.ts:622`),
an unclassified socket error such as a TLS certificate failure
(`broker.ts:213-220,724`) and a cancel or deadline in flight (`broker.ts:619`) each
become an UNKNOWN (`store.ts:46-50`, `broker.ts:524-527`) that ends the task
(`runner.ts:642`; A1). A non-UTF-8 page such as a PDF stops it with
`public_source_retention_or_text_failed` (`runner.ts:603,643`). The pipeline would
refuse a web-scale corpus at admission (D8), the synthesis prompt asks for at most
1,200 words (D13), and the evidence packet is capped at 64 KiB (D4).

**F8. Quality has been measured by mechanics (major).** Every 7/7 pipeline row
(`p4h2`, `p4h3`, `p4pb`) is automated checks on one exposed task. The registry
holds a 7/7 run that graders rejected and a 3/7 run they accepted. The entailment
support rate does not separate accepted drafts (0.46-0.95) from rejected ones
(0.94-0.97, non-superseded rows). The balance rate that selection actually compares
(`selection.ts:52,67`) overlaps the same way (accepted 0.36-0.95, rejected
0.94-0.97), yet it decides selection (finding E10). No pipeline output has been
blind-graded on a fresh task.

**F9. Process weight (major, recurring since W8).** 482 entries on 34 active days;
the log is 2.17 MB and the validator forbids rotation (finding E3).

**F10. Codebase weight against the goal (major, unchanged since W9).** About 74% of
`src/` serves surfaces hidden behind `SOAR_ENABLE_LABS`, yet they are constructed,
migrated and recovered at every start (`bootstrap.ts:151,171,192,206`), and they
are what CI's only end-to-end test exercises.

---

## 4. Bugs and code-level flaws (confidence per row)

Confidence: **H** = re-read at the cited line at `153b8e6`; **M** = audit finding
consistent with the surrounding code; **audit only** = not re-read. File names are
resolved in the code map (§8). Rows E1-E11 of table E are findings; E0-E7 in §5.6
are experiments, so the text says "finding E3" where it means a row of table E.

### A. Tasks that end permanently for ordinary reasons

| # | Finding | Where | Conf |
| --- | --- | --- | --- |
| A1 | **An UNKNOWN dispatch can never be cleared, and is assigned too eagerly.** `isConfirmedAbort` returns false for every settlement-phase failure and for `cancelled`, `request_timeout`, `inactivity_timeout`, `response_oversize`, `transport_failed` (an unclassified socket error such as a TLS certificate failure, or any other unclassified transport exception) and `stream_invalid`, even on a zero-risk packet (a zero-fee local request or a public GET without a grant). The row is marked `unknown`; `store.commit` then refuses every later dispatch in the job; no code path moves an `unknown` row to another status. | `store.ts:29,46-50,204,242,250`, `broker.ts:213-220,446-447,521-528` | H |
| A2 | **A fully received local reply that fails validation is recorded as UNKNOWN.** For the legacy local shape, a zod reply-schema failure or a usage-envelope failure becomes `response_or_usage_invalid`; under `flash_next_v1` so do a duplicate tool id, a failed think-tag reply inspection and a token-admission usage mismatch. All then become `transport_or_settlement_unknown`, and the job is blocked although cost and side effects are known. | `broker.ts:495-528`, `model.ts:344-351` | H |
| A3 | **Workspace capture after an action runs outside the action's error handling.** If capture throws, `tool_finished` is never written and every resume returns `unresolved_operation_no_replay`. Capture throws on any symlink or hard link (`die()`), more than 1,024 files or 4,096 entries, a file over 64 MiB, a workspace over 128 MiB, or any sandbox error, which also destroys the container. `ln -s`, `python -m venv` and `git clone` trigger it, as does extracting an archive that creates links or more than 1,024 files. | `runner.ts:663,748-749`, `sandbox.ts:209,215-218,402-406` | H |
| A4 | **Command output over 256 KiB kills the container, then A3 fires.** The model is told that large output is retained with bounded excerpts; it is not. | `sandbox.ts:6,99`, `runner.ts:154,640-653,663` | M |
| A5 | **Pre-dispatch broker errors brick the task.** Five cases are handled after `model_started` (`LocalTokenAdmissionError`, `ModelRequestBodyTooLarge`, `budget_denied`, a cancelled retry wait and `request_failed`). Others are rethrown with an unmatched `model_started`, for example `request_cancelled` and `packet_scan_failed` (scanned, that is cloud, destinations). Two codes are latent. `packet_size_exceeded` is latent while model and destination share one byte cap. `private_agent_unresolved_dispatch` is latent because the runner stops with `unresolved_dispatch_no_replay` before any call while a non-judge row is unresolved, and judge rows are written only by the post-submission entailment pass, after which no runner starts in that job. | `runner.ts:309,358,425,457-487`, `session.ts:197,310,402-406` | H |
| A6 | **Desktop resume works only for paused tasks and for incomplete tasks whose reason is `interrupted` or `(public_)model_unavailable`.** Every other runner reason flattens to the status, except `consultation_pending` and the size, fee-cap, token-admission and configuration stops, which are kept but not resumable (a consultation becomes resumable once decided). Any other exception on Resume (Docker down, for example) becomes `runtime_unavailable`, which is not resumable. | `controller.ts:475,622-627` | H |
| A7 | **Pausing during the research stage reports "paused" but can never resume** (`research_stage_not_replayed`). | `session.ts:374-376,385` | H |
| A8 | **A deadline firing mid-request always produces an UNKNOWN.** Nothing checks the remaining time against the 300 or 900 s request timeout before dispatch, and the server cut long requests at about 947 s (serving card, probe P8). This is the documented 90-minute `loop_stage_unresolved_dispatch` failure. | `controller.ts:596`, `session.ts:307`, `runner.ts:419`, `phase4-loop.ts:139` | H |
| A9 | Checkpoint blobs are written to their final content-addressed name with `O_EXCL` and no temporary file and rename; a crash mid-write poisons that hash permanently. | `checkpoints.ts:33-39` | audit only |

### B. Failure detail is thrown away

| # | Finding | Where | Conf |
| --- | --- | --- | --- |
| B1 | Broker settlement diagnostics admit exactly two codes; `error.message` is never recorded. | `store.ts:34-37`, `broker.ts:521-523` | H |
| B2 | The runner records a sandbox code (`sandbox_<code>`) or, for any other unhandled error, only `error.name` (for example `Error` or `BrokerError`), never its message or broker code. | `runner.ts:712` | H |
| B3 | In the pipeline, any `BrokerError` not caused by the stage's own abort ends the stage as `research_request_denied`; an abort gives `research_cancelled`. In the outcome reason and the registry's `terminalCause` a cap refusal and an UNKNOWN therefore look identical, and a cancel that leaves an UNKNOWN row reports plain `research_cancelled`. The exact code survives only in the `research_stage` event's `denied` field. An UNKNOWN also leaves an `unknown` receipt with its transport or settlement diagnostic, while a cap refusal leaves no row (`broker.ts:469-470`, `store.ts:208-210`). Packet-validation errors become `research_packet_binding_invalid`; `call()` keeps only snake_case messages. | `research-pipeline.ts:96-103,215-216`, `session.ts:382` | H |
| B4 | Planner diagnostics persist codes and paths only; the raw reply is never retained, even for public corpora. | `research-plan.ts:13-18,106-123` | H |
| B5 | Thrown tool errors that neither end the task at `runner.ts:641-644` nor close the container, other than invalid arguments (answered with the tool's schema and a retry instruction), an `execute` call with invalid arguments in a reply that reached the model's output-token limit, `public_fetch_limit_reached` and a failed fetch (`public_fetch_failed`), reach the model as one generic `action_failed_or_not_permitted`: for example a sandbox `invalid_input` path, `destination_denied`, `tool_unknown` or a refused `read_observation`. In those cases the model gets no repair signal. A sandbox error inside a container operation, such as command output over 256 KiB, or a `check_claims` restore write or check command that ends in one (an unsafe-file exit, a Docker failure, or a cancel or deadline during the command), closes the container, so the capture at `runner.ts:663` throws and the task ends as `runtime_failure_progress_preserved` before any reply is sent (A3, A4). A soft-refused restore write (its result is ignored) and a check that exits non-zero, including the in-container timeout (exit 124), leave the container usable; a non-zero check is returned as `passed: false`. | `runner.ts:616-620,640-653,663,709-713`, `sandbox.ts:99,228-230,397-408,415-428,470` | H |
| B6 | Harness: the driver's top-level catch yields `local_screen_failed_no_replay`; the loop keeps only messages matching `^[a-z0-9_]+$`; `researchTransferSnapshot` returns `null` on almost any error. | `private-agent-local-screen.ts:496`, `phase4-loop.ts:68-71`, `research-seed.ts:132-135` | M |
| B7 | `research_stage_invalid`, cited in PLAN.md as a failure category, exists nowhere in tracked code; it came from an untracked wrapper. | `docs/PLAN.md:659` at `153b8e6` (the Q13 qualification paragraph of the Phase 4 status) | H |

### C. Privacy-boundary gaps against the stated design

| # | Finding | Where | Conf |
| --- | --- | --- | --- |
| C1 | **No label system.** Admission is `publicOrSynthetic: z.literal(true)`; there are no label, tier or regime types in `src/`; the broker's `syntheticOnly` gate reduces to that checkbox. | `general-task-contracts.ts:46`, `session.ts:180`, `broker.ts:391-398` | H |
| C2 | **Two egress paths bypass the broker.** The coding pilot's worker POSTs repository source directly with `urllib`; the legacy OpenAI-SDK provider sends repository content to the vLLM endpoint without broker checks. The Labs flag only hides their UI. | `worker.py:869-876`, `openai-compatible.ts:284-289,518` | H |
| C3 | **The broker admits plain HTTP to the local model whenever `local_model && syntheticOnly` holds.** The only other gate is the machine-local opt-in `SOAR_ALLOW_INSECURE_VLLM_HTTP=true`, which `loadConfig` requires for a non-loopback `http:` endpoint; once it is set, nothing requires TLS, loopback or a tunnel, contradicting P11. "Owned device" is never verified. | `broker.ts:275-276`, `config.ts:173-178,232-233` | H |
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
| D6 | Plan and synthesis inherit the profile's thinking setting. Under Heavy, the only profile the driver admits for the pipeline, thinking is on under an 8,192-token cap, so reasoning tokens can truncate the JSON; on `standard` thinking would be off and the cap silently 4,096. | `research-pipeline.ts:28-29`, `model.ts:295`, `private-agent-local-screen.ts:450-452` | M |
| D7 | The pipeline, select-and-repair loop, seed loader and critic live in `src/main/private-agent/` but are invoked only from headless drivers under `scripts/`. The session accepts a `research` option, but the desktop controller never passes it. | `session.ts:61`, `controller.ts:601-610`, `selection.ts`, `repair.ts` | H |
| D8 | **Index batching refuses web-scale corpora.** Every source over 20 KiB gets its own batch, and more than 24 batches refuses the run regardless of total bytes; more than 40 chunks refuses too. A web corpus of 30 or more pages is refused at admission. | `research-pipeline.ts:113,116` | H |
| D9 | The extraction prompt's stable prefix ends early: `canonical()` sorts keys (brief, chunk, plan, repairReason, source, units), so the chunk sits between the brief and the plan. Pipeline stages measured 0 cached tokens on 2026-10-25 and 2026-11-05, though the 2026-11-01 runs did cache. | `contracts.ts:80`, `research-pipeline.ts:149-150` | H |
| D10 | **File-only desktop research would ship without its checks.** The claims ledger and its check are compiled only when `record.publicSources` exists, so a file-only task has no ledger and therefore no entailment pass. URL-backed tasks are covered: the entailment judge runs after submission on the task's own local model, because the controller passes no `judgeModelFactory` and the session then judges with the private phase's model. | `controller.ts:343-346`, `session.ts:55-56,406` | H |
| D11 | `deriveBriefUnits` splits only on lines starting `1.` or `2)`; an unnumbered brief becomes one unit and the brief-coverage check is vacuous. | `research-coverage.ts:68-79` | H |
| D12 | **One dispatch at a time per job.** `store.commit` refuses any dispatch while an earlier one is unresolved, and `committed` (in flight) counts as unresolved; the index, extraction and judge loops also await each call in turn. Free local tokens cannot be spent in parallel, although the server held full per-stream speed with two concurrent streams on the 27B (serving card, probe P7). | `store.ts:57-59,204`, `research-pipeline.ts:128,180`, `claims.ts:63` | H |
| D13 | **Report length is held far below the bar.** The synthesis prompt asks for "at most 1200 words" (not validated; the enforced bound is the 8,192-token reply), and the r3 brief capped the report at 1,000 words; criterion 6 asks for 2,500-6,000. | `research-pipeline.ts:28,35`, `research-coverage.ts:32` | H |
| D14 | **A retried research call still loses a completed stage.** `SOAR_RECOVERABLE_DISPATCH` defaults to `true` (owner decision D4), so the headless driver flags its owned local destination recoverable, and the broker retries a transient confirmed abort of a zero-fee local call up to twice, marking each retried row `superseded`; with the flag set to `false` the row resolves `failed` and the stage ends as `research_request_denied` (B3). Whatever the flag says, the Anthropic destination also retries a 429 or 529 up to twice, marking each retried row `superseded` (never when the reply reports the monthly spend cap or asks to wait more than 120 s), and the split arm's cloud planner and synthesiser may run on it in the same reader context. The research producer binds every reader-context row, requires each to be `settled` and each stage's row count to equal its calls, so after a pipeline that completed with one retried call, local or cloud, it throws `research_producer_unsettled_receipt` and the stage's output never reaches the writer. No run record keeps that code: the headless driver's guard ends the run `incomplete` with reason `session_failure`, and the select-and-repair loop, finding no research transfer from sample a, ends after it with `stage_failed`, the step a genuine stage failure records. A test asserts the same refusal for a `failed` row. | `broker.ts:449,451-456,535-547`, `store.ts:52-54`, `research-producer.ts:35-56`, `session.ts:249,389`, `config.ts:66,262`, `private-agent-local-screen.ts:320,385-386,398-399,453-456`, `phase4-loop.ts:156-157`, `private-agent-research-seed.test.ts:170` | H |

### E. Harness, validator and engineering health

| # | Finding | Where | Conf |
| --- | --- | --- | --- |
| E1 | The loop hard-stops on any `unknown`, `committed` **or `failed`** receipt (a test locks this in). A stopped loop has no final selection, and the registry writer refuses it. That explains the stopped attempts but not the whole zero: the completed k2 deck loop (BL-20261031-2308-h4-deck-loop-verified, final selection the repair) and the r3-local loop's terminal `a/stage_failed` selection (BL-20261031-2322-h4-local-plan-rejected) were never written either, so the 99 registry rows hold no loop row. | `phase4-loop.ts:139-140`, `registry-row.py:48-50`, `phase4-loop.test.ts:102` | H |
| E2 | The source-freeze hash covers every `src/main/private-agent/*.ts`, five files under `scripts/` (`private-agent-run.ts`, `private-agent-local-screen.ts`, `phase4-loop.ts`, `phase2-repair.ts`, `secret-patterns.mjs`), `config.ts`, `liveness.ts`, `pnpm-lock.yaml` and the private-agent `Dockerfile` and `requirements.txt`, so any one-line fix invalidates the loop and its allocation. | `private-agent-local-screen.ts:132-139,273-274`, `phase4-loop.ts:134` | H |
| E3 | The validator has a hard-coded path, enforces byte-prefix append-only and requires an entry for any change under `src/`, `tests/`, `scripts/`, `benchmarks/`, `docs/plans/` or `.github/`; rotation is impossible. The log is 2.17 MB, above `search_text`'s 1 MiB per-file cap, so the live repository proof cannot pass at HEAD. | `validate-build-log.ts:8,555-577,597-672`, `search-text.ts:19` | H |
| E4 | The registry's `git` field is `git rev-parse HEAD` at row-writing time, not the run's commit; `unknownDispatches` also counts in-flight `committed` rows. | `registry-row.py:97,160` | H |
| E5 | Limits are scattered across at least 25 locations and kept in step by hand: the presentation cap of 192 KiB equals the `standard` request-body cap; quote length is defined twice; the claims check's 240,000-byte output budget is set by hand under the 256 KiB stdout slice. | `profiles.ts`, `runner.ts:28-30`, `sandbox.ts:4-7`, `broker.ts:15-19`, `research-contract.ts:10-13`, `claims.ts:16-33` | M |
| E6 | Dead or unused code: `GENERAL_TASK_LIMITS`, `stripUnknownCitations` (test only), and an effectively unreachable `invalidExecuteAtOutputLimit` branch that is bound into the protocol hash. | `controller.ts:38`, `research-pipeline.ts:62-76`, `runner.ts:646-647` | H |
| E7 | 163 vitest files; every Docker, model and general-task end-to-end test is environment-gated and skipped in CI; fixtures are self-consistent fakes, none built from recorded real model output. | `ci.yml`, `tests/helpers/` | H |
| E8 | Positive: repository hygiene is good. No secrets, private hosts, generated artifacts or TODOs in tracked code. | `.gitignore` | H |
| E9 | **Ties go to the repair, by recorded design.** The final selection calls `compareCandidates(repair, selected)` and ties award `first`, as step (5) of BL-20261026-1831-h4-select-and-repair-design chose ("a decision, not a measurement"); a test locks it in. This review proposes reversing it (S11, backlog item 11), because no measurement shows that a tied repair beats its draft. | `phase4-loop.ts:193`, `selection.ts:55-56,68`, `phase4-loop.test.ts:68` | H |
| E10 | The entailment step decides selection on a 0.1 margin although neither the support rate nor the balance rate it compares separates accepted from rejected drafts (F8). | `selection.ts:19,52,67` | H |
| E11 | Registry rows that supersede another row repeat its fee: a naive sum gives USD 25.79 against USD 24.54 of unique receipts. Consumers must skip superseded rows. | `registry.jsonl` (`supersedes` field) | H |

---

## 5. The new best way

### 5.1 Admission rules for every future experiment

An experiment runs only if all ten hold.

1. **Decision.** Its pre-registered result changes a pending product decision
   (ship, keep or drop a route or family, or open or keep closed Tier O) or a named
   prerequisite of one, such as the stage bounds (E0), the live-run gate (E1) or a
   stage policy (E2). The card names the decision.
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
6. **The cloud sees only sealed one-shot packets at named touchpoints** (T1-T4): a
   template packet with a byte cap; no literal source openings, names, hashes,
   history or tool outputs; previewable; a cloud reply never feeds another packet
   without approval, except that a host-validated T1 plan enters the same task's T2
   packet. A research route fires T1 and T2 either always (the forced split) or only
   after the free local attempts fail on a deterministic signal (local-first); E3
   measures both. T3 fires only under E7, and T4 only under D15's exact-byte
   approval.
7. **Labels gate destinations.** Labelled contexts have no automatic cloud, search
   or web destination, and D15's exact-byte packet (T4) stays deferred;
   regime-tagged contexts have none under any grant; labelled work waits for P11
   transport.
8. **Caps use the shipped formula.** Reservation = body bytes × max(input, write)
   + max output × output (`model.ts:329-337`); cap = settled + outstanding
   reservations + new (`store.ts:207-210`). A cap refusal is a recorded fallback,
   never an abort.
9. **Every fallback is disclosed** in `reportedIssues`. Mechanics are never
   acceptance. `Proposed`, `Approved`, `Implemented`, `Verified` and `Released`
   stay distinct.
10. **No model or serving change** without a one-day timebox and a pre-registered
    role-level target that reverts the change if missed.

### 5.2 Architecture v5: staged research with local volume work and sealed cloud assists

**Principles.**

1. The staged pipeline is the only research reader; the agent loop only writes.
2. Local does every volume stage at zero fee, with bounded concurrency where calls
   are independent.
3. The cloud receives at most three one-shot, stateless, host-built packets per
   public research task: a plan assist, a synthesis assist and one synthesis retry
   on truncation. No tools, history or tool outputs.
4. A local-first route escalates only on deterministic host signals. Model-judged
   signals are recorded on every run and fire nothing until calibrated.
5. No single failure ends a task; every fallback is disclosed.
6. Every bound is re-derived from the E0 serving card.

**Stage graph for research.** R-stages run only when the task has a web scope; a
file-only task starts at S1.

| Stage | Executor | Bound or rule | Why |
| --- | --- | --- | --- |
| R0 admit | host | goal ≤ 32 KiB; files ≤ 16 MiB; web scope = search allowed plus ≤ 3 seed URLs; class public or synthetic (the checkbox today, a P1 label later); wall-clock feasibility from the card before the first call; numbered requirements recommended in the form (D11) | Only the host mints authority |
| R1 query plan | local | ≤ 3 calls, thinking off; 20-30 queries derived from brief units (criterion 1 needs ≥ 20) | Dirty work, free |
| R2 search | host, **new ledgered search destination** | ≤ 30 queries per task; GET only; credentials refused; one zero-fee receipt per query; self-hosted SearXNG on loopback or LAN (PLAN.md already names it). SearXNG forwards each query to its configured upstream engines, which see it; the broker pins and ledgers only the hop to SearXNG, so each receipt records the engine set | `public_web` refuses keys; API search costs USD 5-10 per 1,000 (USD 14 for Gemini grounding beyond 5,000 free a month) |
| R3 triage | local | ≤ 4 calls over result snippets, yielding ≤ 60 candidate URLs from ≥ 10 domains; snippets are never cited | Snippets are not sources |
| R4 fetch | host, `public_web` with DNS pinning and an exact URL per receipt | ≤ 60 fetches; ≤ 1 MiB raw retained per page (64 KiB today); an oversize, timed-out, TLS-failed or non-UTF-8 response becomes a recorded miss, never a task end, as a 404, redirect or bot block already does; retained bytes keyed by URL and hash so re-runs work offline | Criterion 1 |
| R5 extract text | offline sandbox (`lxml` and `poppler` are already in the image) | HTML or PDF to text in the workspace; a paged reader; one hop of link following back to R4 (≤ 20 more URLs) | The model reads whole pages as text, not 64 KiB of raw bytes |
| S1 inventory | host | 64 KiB chunks; chunk and batch ceilings set to what the card's prefill rate fits in the clock (today ≤ 40 chunks, ≤ 24 batches); batches by preview size | Feasibility stated at admission (D8) |
| S2 index | local | batches in parallel; thinking off; literal-card fraction reported as an insufficiency signal (21 of 24 cards preceded the 2026-11-05 content rejection) | |
| S3 plan | local | 2 calls: attempt 1 thinking off (with `json_schema` where E0 shows it valid), attempt 2 thinking on with diagnostics; host fallback plan of ≤ 12 grouped questions | Truncation and schema rejection are both observed (D1) |
| **S3c plan assist** | **cloud, T1** | local-first: after two rejected local plans; forced split: always, in place of S3; body ≤ 32 KiB; headless now, desktop with the per-task toggle later | Cloud plans were valid 3/3 at USD 0.030-0.034 settled, while local plans on r3 were rejected in several attempts (D1), so T1 has measured support as a fallback. No run shows a cloud plan beating a valid local plan: the drop from 46-51 to 27 planned reads came from protocol v3's budget message (BL-20261026-1644-planner-budget-dry-run-verified), and the one valid local plan that reached the writer on r3 matched the split's 7/7 with better entailment. The forced split's always-on T1 therefore tests the owner's thesis, not a measured advantage |
| S4 extract | local | one call per chunk, K in parallel (K from E0's probe P7), plus repairs with reserved capacity; thinking off; per-quote drop; prefix layout `[system][stable packet][chunk]` | The dirty work (D2, D3, D9, D12) |
| S5 coverage table | host | unit × question × quotes; omissions; fallback fractions; priority trim with disclosed drops accepted by the ready gate | Separates "no evidence extracted" from "the corpus lacks it" (D4) |
| S6 synthesis | local | 2 calls, thinking off then on; headings normalised; length cap set by the brief, not 1,200 words; skeleton fallback marked | Equal gold and better entailment than the cloud on r3, n = 1 (D5, D13) |
| **S6c synthesis assist** | **cloud, T2** | local-first: after two refused local syntheses; forced split: always, in place of S6; body ≤ 96 KiB, with `evidence.md` ≤ 64 KiB of verified quotes with opaque ids; one retry on truncation with trimmed evidence | Measured USD 0.091-0.099 |
| S7 presentation | host | ≤ 192 KiB, once | The writer drafts in 2 turns instead of burning 4 on discovery |
| S8 write | local | Heavy bounds until E2; output budget and clock from the card; per-call cap ≤ (timeout − prefill) × measured decode | Passing writers used 29-78 calls |
| S9 checks | host | claims ledger (verbatim quote in the retained page; URL fetched during the run); sections; absence-claim flag for owner attention; brief-unit coverage; **depth metrics** (queries, URLs, domains, bytes, actions) | Targets recorded rejection causes and the bar |
| S10 judge | local | 40 × 256 tokens, K in parallel, evidence only, no selection role unless E0's judge fixture reaches its agreement level and graded runs show its rate separating accepted from rejected drafts | Uncorrelated with grades so far (finding E10) |
| S11 critique and repair | local | one round; cap from the card; the original wins ties, reversing the recorded preference (finding E9) | 4 of 6 recovered at zero fee |
| S12 verdict | owner | accept, minutes and interventions captured in the app and written to the registry | OAJ, the adoption north star, recorded beside the three columns |

**Cloud touchpoints, and what the cloud never sees.**

| Touchpoint | Packet | The cloud never sees | Settled estimate | Reservation at bound |
| --- | --- | --- | --- | --- |
| T1 plan assist | schema, brief ≤ 8 KiB, units, gists with opaque source ids trimmed to the 32 KiB body bound, budget line, safe diagnostic codes | literal source openings, file names, URLs, hashes, raw local replies, the conversation | 0.030-0.034 measured (three plan packets of about 22 KB, two under protocol v2 and one under v3); about 0.04 at the 32 KiB bound with v3-like output, at most 0.10 at full output | 0.16 |
| T2 synthesis assist | brief, units, plan, `evidence.md` ≤ 64 KiB, counts-only coverage; body ≤ 96 KiB | source text outside quotes, file names, hashes, drafts, tool outputs | 0.091-0.099 measured; about 0.13 at the 96 KiB bound with full output | 0.33 |
| T3 coding review (conditional, E7) | tree names, signatures, `-U0` diff, failing assertions; no body or output bound set yet | untouched files, fixtures, config, logs | about 0.05 (assumed) | about 0.10 (assumed) |
| T4 labelled packet | deferred: needs P1, P11, D15's exact-byte approval and a new builder; no bound set yet | raw files, prose, names, paths, metadata | about 0.03 (assumed) | about 0.06 (assumed) |
| B0 all-cloud | experiment ceiling arm only | anything labelled | 1.13 submitted (Claude); 1.18 stopped at its allowance (`gpt-6-sol`) | cap 3.00 |

Cap check per research task: USD 0.60 on a closed corpus. The store counts settled
fees plus outstanding reservations plus the new reservation. At the measured 3.8
bytes per token, the exposure at T2's dispatch is T1's settled fee (at most 0.10)
plus T2's 0.33, at most 0.43. At a synthesis retry it is about 0.04 + 0.13 + 0.33 =
0.50 with a v3-like plan reply, and at most 0.10 + 0.13 + 0.33 = 0.56. A retry that
would exceed the cap is refused as a recorded fallback (rule 8). On web scale the
cap is USD 0.75 and also counts search fees. With a keyed search API, T2 is certain
to fit, whatever T1 settled, only while search costs at most about USD 0.32 per task
(0.75 − 0.10 − 0.33), about USD 10.7 per 1,000 at 30 queries; after a v3-like 0.04
plan reply the limit is about 0.38 (USD 12.7 per 1,000). The synthesis retry is
certain to fit only up to about USD 0.19 of search (0.75 − 0.10 − 0.13 − 0.33),
about USD 6.3 per 1,000, or 0.25 (USD 8.3) after a v3-like plan reply. On a public
task the brief itself is a disclosure, so the exact first packet is previewable
before dispatch.

**Escalation (local-first routes).** Signals are deterministic and host-side: two
rejected local plans fire T1, and two refused local syntheses fire T2. Checks that
still fail after one local critique and repair are disclosed for the owner's
attention and fire no cloud call. Fallback-eligible `BrokerError` codes (budget,
mode, grant, synthetic-destination and size denials, a confirmed `request_failed`,
an invalid cloud reply) apply the host fallback and continue. Stop codes
(`job_cancelled`, `request_cancelled`) stop the stage. A
`transport_or_settlement_unknown` on an assist resolves the assist as skipped with
its reservation pinned. That needs a purpose-aware exception in four places. One is
the session, runner and controller pre-checks, which already exempt entailment rows
(`session.ts:370,403`, `runner.ts:309`, `controller.ts:400`). The second is
`store.commit`, whose unresolved-dispatch check (`store.ts:203-204`) has no purpose
exception today; entailment avoids it only because its pass runs last. The third is
the research producer. It binds every reader-context receipt, admits only settled
rows with one of the four stage purposes, and requires each stage's receipt count to
equal its calls (`research-producer.ts:35-56`, called at `session.ts:389` and
re-checked at `session.ts:366`); it must bind an assist row, whether settled, failed
into the host fallback or resolved as skipped, as an assist that counts toward the
stage it serves, so that a forced-split plan or synthesis stage whose only call is
its assist passes the per-stage count (`research-producer.ts:54-56`); it must also
admit, without counting it, an assist row that a retry superseded (the Anthropic
destination retries a 429 or 529, `broker.ts:535-538`). The fourth is the harness
loop that runs S11's critique, repair and tie rule (finding E9). It starts no later
sample, critique or repair, and makes no final selection, once a sample's or the
repair's job ledger holds any `unknown` or `committed` row of any purpose, or any
`failed` row (`phase4-loop.ts:139-140`, counted at `selection.ts:136,138`; finding
E1); it must admit an assist row resolved as skipped or failed into the host
fallback. With all four, a cloud UNKNOWN never blocks local work and the cloud row
stays at-most-once. Resolved local rows, and any reader-context row that a retry
superseded, cloud rows included, need a separate fix in the producer (D14, backlog
item 1); resolved local `failed` rows also need one in the loop (backlog item 11).
Never: a model-initiated cloud call (`request_consultation` is withdrawn from new
tasks); a cloud reader, writer or critic; a second cloud attempt after an UNKNOWN; a
cloud call from a labelled context outside T4; any cloud call for a regime-tagged
context.

**Forced split.** T1 and T2 fire on every run in place of S3 and S6. If either is
refused, returns an invalid reply (for T2, after its one retry on truncation) or
ends UNKNOWN, the local stage it replaced runs as in local-first (two S3 or two S6
calls), then the host fallback. After an UNKNOWN, no further cloud call is made in
the job; after a T1 UNKNOWN, T2 is not sent and S6 runs as it would after a failed
T2 (two S6 calls, then the skeleton fallback). The fallback and stop code lists
above apply unchanged.

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

**Privacy.** Desktop routes are local-only by default, except that URL-backed public
tasks start with the assist toggle set if the owner records that it starts on
(§5.10, item 2). A URL-backed public task, which the session already classifies
`public` (`session.ts:352,397`, set by `controller.ts:603-604`), may enable "allow a
cloud assist for this public task"; the assist destination is compiled only when the
toggle is set. File-only tasks get no toggle until P1. Labelled contexts have no
automatic cloud, search or web destination; T4 is reachable only through D15's
exact-byte approval; regime-tagged contexts, never. No labelled work runs before
P11. The attestation path the owner used on 2026-10-12 (owner-declared public or
synthetic inputs) is unchanged. Every dispatch, local, search or web, appears in the
task ledger; for search, the ledger covers the hop to SearXNG and each receipt names
the upstream engines. The badge says "no cloud, search or web dispatch", never
"nothing left the device"; disclosed bytes count unique bytes sent.

**Quality.** Deterministic host checks plus depth metrics, the local judge as
evidence, and blind grading on fresh tasks against the bar of §2.2.

### 5.3 Routes per family

| Family | Local | Cloud | Labelled data |
| --- | --- | --- | --- |
| Research, public (web or files) | R1-R5, S1-S11 | T1 and T2, always (forced split) or on deterministic signals (local-first), as E3 and the owner decide; in the harness first, then in the desktop only through the per-task toggle on URL-backed tasks, once E4 ships a cloud-assisted arm (file-only tasks get no toggle until P1) | the brief is named as a disclosure |
| Research, labelled | the whole pipeline, once P11 exists | none; T4 deferred | unavailable until P11 |
| Document review | edit plan, host redline applier, fidelity checks; two samples with critique and repair if E6 says so | none (local 3/3 and 1/3 against cloud 2/3) | unavailable until P11 |
| Website, deck | build, hooks, OOXML check, render, repair | none (1/1; 1/2 against 1/2) | local only |
| Admin | deferred (unbuilt) | never on the owner's mail | blocked until P11 and P1 |
| Coding | implement, host-run tests, repair | T3 on public repositories only, conditional on E7 and D20(b) | no path until D20(b) |

### 5.4 Cost and time model

| Route (research task, closed corpus r3 unless stated) | USD per task | Evidence |
| --- | --- | --- |
| All-local pipeline | 0 | BL-20261025-2055 |
| Local-first, both assists fire | 0.12-0.13 measured (H3 v2 and the protocol-v3 split; plan packets about 22 KB, synthesis packets about 52-64 KB); at most about 0.23 at the stated bounds with full output, about 0.37 with one synthesis retry; cap 0.60 | split receipts (BL-20261026-1605, BL-20261026-1644); the T1 and T2 rows above |
| Forced split | 0.122-0.126 measured; the same bounds as local-first with both assists firing | registry `p4h3` and `p4pb` rows |
| All-cloud cached | 1.13 (Claude, submitted; 1.15 with its two shape probes, Console-reconciled); 1.18 (`gpt-6-sol`, stopped at its allowance, a lower bound) | Claude calibration; r3-cloud-v3 |
| All-cloud uncached | 3.05 on r3; 3.05-3.77 across Phase 2 r1-r3 | dashboard check pending |
| Manus at list | 1.50-4.50 standard; 7.50-25 Max | §2.3 |
| Web scale, indicative split of the USD 0.50 target with SearXNG | plan about 0.04; synthesis 0.10-0.25; search 0; reserve 0.10, for example for a cloud claim-verification option if E0 leaves the local judge uncalibrated or E4 shows local fact-checking below criterion 3; total 0.24-0.39 | target, measured in E4. With keyed API search (20-30 queries at USD 5-10 per 1,000, or USD 14 for Gemini grounding beyond 5,000 free a month, so 0.10-0.42 if bought above any free allowance), the uncapped sum is 0.34-0.81, which fits the 0.50 target only at the cheapest rates. The 0.75 episode cap, which counts search, settled fees and each new 0.33 synthesis reservation, keeps settled spend at or below 0.75: it refuses the synthesis retry once search passes about 0.25, about USD 8.3 per 1,000 at 30 queries (0.25 + 0.04 + 0.13 + 0.33 = 0.75), and the synthesis assist itself near the top of the range (0.42 + 0.04 + 0.33 = 0.79), each as a recorded fallback |

Prices assumed: `gpt-6-sol` USD 2 / 0.20 / 10 / 2.50 and `claude-sonnet-5-5`
2 / 0.10 / 10 / 2.50 per million tokens (input, cached, output, cache write);
uncached one-shots cost the same on both. Cloud reasoning bills as output and
dominates every assist fee. Trigger rates are unmeasured; the design point is both
assists firing.

**Wall time is the real local cost.** Time ≈ prefill tokens ÷ prefill rate +
output tokens ÷ (decode rate × effective concurrency). A worked example at the
27B card's rates: 2 MB of page text is about 32 chunks, 520k prefill tokens and
20k extraction output tokens, which is about 5 minutes of prefill and 9.5 of decode
sequentially; the writer (30-47k output tokens) adds 14-22 minutes. That is about
29-37 minutes before the plan, synthesis, judge and writer prefill are added, so
it already reaches or passes criterion 7's 30-minute P50. At the API-only target's
decode rate, the 27B's prefill rate and three parallel streams, the same parts would
take about 9-11 minutes.
These are arithmetic on other deployments' measured rates, not predictions for the
new endpoint; E0 measures the real ones.

### 5.5 Capability build for Manus-depth public research

- **A ledgered search destination** in the broker: a new kind, or a `public_web`
  variant with a bound query template. GET only, credentials refused, DNS pinned
  for the hop to SearXNG, one zero-fee receipt per query, ≤ 30 per task. SearXNG
  self-hosted on the device or the Mac on loopback or LAN, with a runbook. SearXNG
  is a metasearch relay: it forwards each query to its configured upstream engines,
  which see the query (as PRIVATE_WORK_DESIGN_V1.md already notes). Each receipt
  therefore records the engine set, and queries count as disclosed bytes. A keyed
  search API (Brave or a provider's) is only an owner-keyed alternative, under
  exact-byte consent and R2's 30-query cap. Either choice is a new egress
  destination, which PLAN.md §4 reserves to the owner's explicit approval.
- **Fetch volume and retention:** ≤ 60 fetches plus ≤ 20 one-hop follow-ups, ≤ 1 MiB
  raw per page retained under `public-sources/`, misses recorded, retained bytes
  written into the workspace as today (`publicSourceWorkspacePath`). Web dispatches
  need their own request pool: the Heavy pool of 200 is already 188 committed to
  research (68), writer (80) and judge (40).
- **Text extraction in the sandbox:** HTML and PDF to text with `lxml` and `poppler`,
  which are already in the image; a paged reader over the extracted text replaces
  the 32 KiB inline observation.
- **Run-trace metrics** in the registry row: queries, distinct URLs, domains, bytes
  read, actions by type, wall time, token classes, provider USD and search fees.
- **A citation checker:** every cited URL fetched during the run, the quote
  verbatim in the retained page (reusing `claims.ts`), and the claim entailed by the
  stored text (local judge, recorded as evidence).
- **Planted-conflict fixtures:** six public tasks with at least three contradictions
  each, authored by a separate session, gold held separately. Two serve E4; four
  are held out unseen for the round after the next lever.
- **Benchmark adapters:** run records for the pinned LiveDRBench cases (official
  grader, paid judge) and DeepResearch Bench prompts (RACE, labelled `SOAR-pilot`).

### 5.6 Experiment program, re-gated

Each experiment is pre-registered, with one card per batch and one registry row
per run.

| # | Experiment | Arms and tasks | Fee cap (USD) | Days | Decision it changes |
| --- | --- | --- | --- | --- | --- |
| E0 | **New-endpoint qualification and role calibration**, run from the Mac | `scripts/serving-probe.py` probes P1-P9, plus new probe P10 (`response_format` `json_schema` per role schema, 20 calls each, thinking on and off, truncation counted apart from schema rejection), probe P11 (prefill and decode at 20k, 60k and 120k tokens; cache reuse on the extraction layout; K-stream concurrency) and an adapter probe (`/tokenize` route, reasoning field, legacy shape or `flash_next_v1`). Role fixtures: planner 3 × 10 on the exposed r3 index with raw replies retained; extractor on 3 synthetic chunks; judge on a fixed claim set labelled by a separate session, scored against a per-claim agreement level that the E0 card sets before the fixture runs; below that level, or without the set, the judge stays evidence-only | 0 | 2 | Every stage bound and clock; thinking policy per role; structured output per role (probe P10 ≥ 95% valid); the adapter path; K; whether the 2026-11-04 figures apply (same model, confirmed by the owner and consistent with probe P1) or not; whether criterion 8's judge threshold applies in E3 and E4 and criterion 3's in E4 (E3 does not measure criterion 3) |
| E1 | **Recoverability**, no live model | extend `private-agent-broker.test.ts`, the runner and pipeline tests, `private-agent-research-session.test.ts`, `private-agent-research-seed.test.ts` and `phase4-loop.test.ts`: cancel mid-call at each stage, an upstream close (also retried inside a research stage that the session runs on the real broker, and a `superseded` row given to the producer, D14), invalid JSON twice, a cloud timeout on an assist, stdout over 256 KiB, more than 1,024 files, a 500 KB synthetic corpus | 0 | 2 | The gate for any live run: zero zero-fee UNKNOWN rows, a research stage with a retried call still reaches the writer, local work continues after a cloud UNKNOWN, cancellation still stops the stage |
| E2 | **Writer policy** on byte-identical packets | writer-1, the current Heavy writer; writer-2, a preloaded presentation with an output budget from E0, thinking on; r3 plus 2 synthetic packets, 2 repeats: 12 runs. writer-3, writer-2 with thinking off, adds 6 runs only on the owner's named decision. Blind proxy grades | 0, plus ≤ 1 for fixtures (synthetic line) | 3 | The E3 and E4 writer; the never-run 12-call bound and thinking-off are hypotheses here |
| E3 | **Closed-corpus route round** on the frozen fresh tasks f1-f3 (204-513 KB, 23 critical checks) | A all-local v5 × 2 repeats; B local-first with T1 and T2 × 2 (cap 0.60 per run); C forced split × 2 (0.60); D all-cloud ceiling × 1 (3.00), cached, on a provider and with a call allowance that the E3 card names, the allowance set above the 78-80 calls the all-cloud loop used on r1-r3 (uncached r1-r3 runs cost USD 3.05-3.77, above this cap); the card shows that the chosen allowance's projected fee, late reservation included, stays under USD 3.00 on f2 (512,514 bytes; the cached projection for r1, 499,438 bytes, was USD 2.12 with its late reservation at the 80 calls of r1's earlier all-cloud run), or the owner raises D's cap, and E3's cap of 20.4 with it, and the card re-derives E3's expected spend; one r3 calibration run per arm: 25 runs | 20.4 (expected about 6.6 if each D run costs about 1.2, as the cached r3 runs did at 79-80 calls on r3's 77 KB corpus; D may cost more on f1-f3 at a higher allowance: the cached r1 projections put D's fee at about 1.6 on a 499 KB corpus at 80 calls (USD 2.12 less its USD 0.51 late reservation for `claude-sonnet-5-5`, 1.65 for `gpt-6-sol`), about the 1.5-1.6 average above which, with both assists firing on every B and C run, E4 needs the reallocation (Budget)) | 7 | The harness default for public research on files, including when the cloud fires (always, on local failure, or never), and, through its result for B and C, the cloud-assisted route E4 tests; measured trigger rates (gate signals logged on every arm) |
| E4 | **Manus-bar public round**, web scale | 2 pinned LiveDRBench cases, 2 pinned DeepResearch Bench prompts and 2 fresh planted-conflict tasks; arm A and one cloud-assisted route, chosen in this order: the one E3 made the default, if that is B or C; else, if E3 was not harness-limited, the only eligible one of B and C, or, when both are eligible, the one that beats the other under the frontier rule; else (E3 harness-limited, neither eligible, or B and C trading under §2.1 or equal within every tolerance) the owner's choice under §5.10, item 2, recorded before E4 starts; 3 repeats: 36 runs. Each task-repeat runs R0-R5 once and both arms read the same retained pages (a paired design), so arm differences reflect the cloud steps and search is paid once. The shared retrieval's search fee is ledgered once and counted both in each arm's cloud-plus-search cost and in each arm's USD 0.75 episode cap (see the cap check in §5.2). Graders: the official LiveDRBench grader, DeepResearch Bench RACE (GPT-5.5 judge) as `SOAR-pilot`, the local citation checker, conflict gold, blind proxy acceptance. The external ceiling is the published product scores; no all-cloud web arm is built | 20.5: 18 task-repeats × 0.75 + judge fees ≤ 6 + fixtures ≤ 1 (expected about 7 with SearXNG). The episode caps include search, so a keyed search API (18 retrievals × 30 queries: up to 5.40 at USD 10 per 1,000, or 7.56 at Gemini grounding's USD 14 per 1,000 if bought above its 5,000 free a month) raises the expected spend, not the cap. At R2's 30 queries the episode cap can refuse the synthesis retry above about USD 6.3 per 1,000 (search above 0.19 with T1 at its 0.10 maximum; about USD 8.3 after a v3-like 0.04 plan) and T2 itself above about USD 10.7 per 1,000 (search above 0.32; about USD 12.7 after a v3-like plan), so every cloud step of the cloud-assisted arm is certain to fit only below about USD 6.3 per 1,000 (§5.2) | 10 | Whether public deep research ships to the desktop, on which arm, and which criterion is the next lever |
| E5 | **Desktop real-jobs trial (OAJ)** | The owner's real public or synthetic jobs in the shipped build, from week 1 on the routes that exist (document review, deck, site; local only); the research route joins in week 6 only if E4 ships an arm, on that arm, with the per-task assist toggle only when that arm is cloud-assisted, in which case toggle-off and file-only research jobs run arm A only if A itself qualified and otherwise get no research route (E4 rule) | 0 local; assists from the weekly public-work line, ≤ 0.75 per task | 14+ | OAJ ≥ 3 of 5 marks the routes `Verified` and makes P1 next; 1-2 means one lever per the trial-first rule; 0 means no route work until the cause is named |
| E6 | **Document review, two samples** | review-1, a single sample, against review-2, two samples with host selection and local critique and repair; 3 synthetic planted-defect `.docx` files; 12 runs | ≤ 1 (fixtures, synthetic line) | 4 | The desktop review route; the numeric cross-check and clause-inversion flags (backlog item 7(d)) ship either way |
| E7 | **Coding review packet (T3)** | only if E5 reaches OAJ ≥ 3 and the owner asks: L against L+T3 on c1 plus 2 synthetic tasks | 1.5, from the line its approval names | 3 | Whether coding gets any cloud |

Probe P1-P11 number the checks in `scripts/serving-probe.py`; P1, P2 and P11
without the word "probe" are PRIVATE_WORK_DESIGN_V1 requirements.

**Decision rules, pre-registered.**

- **E3** is an investment rule; n = 3 tasks per repeat cannot detect gaps under two
  tasks. Ceiling first: if D accepts fewer than 2 of 3, the round is harness-limited
  and no route changes. D is the ceiling and never a candidate. Of A, B and C, a
  route is eligible only if it accepts at least accepts(D) − 1 on each repeat. A
  cloud-assisted route (B or C) also needs mean settled USD at most 0.25 × USD(D),
  no run at its cap and 0 cache-write tokens on every assist receipt. Among the
  eligible routes, a route that no other beats under the frontier rule (§2.1)
  becomes the default once the owner records it. If more than one remains unbeaten,
  because they trade under §2.1 or are equal within every tolerance, the owner
  chooses (§5.10, item 2). If no route is eligible, no route changes and the next
  lever is the stage that failed, one lever per entry. On the closed corpus the
  frontier rule's depth clause covers criteria 2, 5, 6 and 7, and criterion 8's
  entailment threshold if E0 activates it. Each of f1-f3 holds one planted conflict
  with gold (BL-20261027-0145-phase4-tasks-design), so criterion 5 is measured;
  criterion 6 is judged with the corpus files in place of URLs, and its word band
  yields to each brief's word limit. Criteria 1, 3, 4 and 9 are not measured in E3.
  The r3 runs are calibration only. A run that does not submit or stops at its cap
  counts as rejected; a result with ≥ 80% correct arm guesses is labelled weakly
  blinded.
- **E4** measures the bar. An arm qualifies as the default if ≥ 80% of its task-runs
  meet the per-run criteria that apply to their task, it meets criterion 7 over its
  18 runs, at least five of the six tasks meet criterion 9, and its P50
  cloud-plus-search cost is ≤ USD 0.50. It qualifies as a beta if at least 50% of
  its task-runs meet those per-run criteria at that cost but it misses another
  default condition. Public deep research ships on the better-qualified arm: a
  default beats a beta; between two arms at the same level, the one the frontier
  rule prefers ships, and if it prefers neither, the owner chooses. A cloud-assisted
  arm that ships runs behind the per-task assist toggle (§5.2). With the toggle off,
  the desktop runs arm A only if A itself qualified, as a default or as a beta with
  its failing criteria named; otherwise the research route is offered only with the
  toggle on, so file-only tasks, which get no toggle until P1, get no research
  route. Whether the toggle starts on for URL-backed public tasks is the owner's
  decision (§5.10, item 2). A beta ships with every failing criterion named. If
  neither arm qualifies, there is no desktop public-research route, and the next
  lever is the single stage the failing criterion points to (retrieval volume, the
  T2 packet or the writer), one lever per entry.
- **E4 option**, separately gated and the owner's call: the same six tasks on a
  Manus Pro account, logging credit use from Manus's task API. About 18 runs at
  500-900 credits need 9,000-16,200 credits, worth USD 45-81 at list. Monthly
  credits expire at reset, and add-ons are reportedly sold only on the top tier.
  Manus lists the USD 20 and USD 40 tiers as "starting from" 4,000 and 8,000
  credits and calls the USD 40 tier "Customizable". If intermediate amounts exist at
  the same rate, one month costs about the list value. If only the three listed
  tiers exist, the cash is about USD 80 (two months at USD 40, 16,000 credits) to
  USD 200 (one month at 40,000). It is recorded as a product
  baseline, never mixed with the same-harness arms (`benchmarks/README.md`). It is
  the only way to replace the proxy thresholds of §2.2 with measured Manus numbers.

**Order.** Week 1: backlog items 0-5 and item 10's assist-purpose exception (E1
tests it), E0, E1, the owner's P11 interim (an SSH local forward) and box checklist,
and E5 on the existing local routes. Week 2: E2, E6, items 6-10, and item 12 starts.
Week 3: item 11, then E3; item 12 completes. Weeks 4-5: E4; item 13 desktop wiring,
tagged `owner-v0.3`. Week 6: if E4 shipped an arm (as the default or a beta), the
research route goes live in E5 on that arm (if it is cloud-assisted, toggle-off and
file-only research jobs run arm A only if A itself qualified); otherwise E5
continues on the other routes. Review OAJ and the three bars. If fewer than three
owner jobs were submitted by then, Branch D applies (pause and record the adoption
lesson), as PLAN.md says.

**Budget.** The harness line has about USD 28.4-28.7 left. E3's cap is 20.4
(expected about 6.6) and E4's is 20.5 (expected about 7 with SearXNG), together 40.9
in caps. E4's episode caps include search, so a keyed search API raises E4's
expected spend by up to 5.40 at USD 10 per 1,000, or 7.56 (to at most about 14.6) if
Gemini grounding is bought above its free allowance, without changing its cap. Caps
are worst cases, so E4 is admitted only if the line's remaining balance after E3
settles covers E4's cap (about 22 is expected to remain if each D run costs about
1.2; with both assists firing on every B and C run, a D average above about 1.5-1.6
leaves less than E4's 20.5 cap, and E4 then needs the reallocation), or the owner
records a reallocation from the unused weekly public-work line. E5 assists draw on
the weekly public-work line; E2 and E6 fixtures on the synthetic line (USD 20); E7
on the line its approval names. E3 and E4 each need a named `Approved` entry: the
approved H5 shape (18 rows, USD 21.60, other arms) cannot be renamed into them.

### 5.7 Engineering backlog

Ordered; small PRs; any change to a persisted contract or to dispatch semantics
gets its decision entry first.

0. **Process entry:** restore PLAN.md §4(c) for zero-fee work and close per-trial
   named authority for zero-fee runs; the owner records it `Approved`.
1. **Zero-fee failures resolve** (A1, A2, A8, B1, D14, F7): for zero-risk packets,
   treat every transport failure (among them `cancelled`, `request_timeout`,
   `inactivity_timeout`, `transport_failed` and `response_oversize`) and
   settlement-phase validation failures as `failed`, not `unknown`; add a sub-code
   to the settlement diagnostic; check remaining time against the request timeout
   before dispatch; let the research producer admit resolved `superseded` and
   `failed` reader-context rows, cloud ones included (the Anthropic destination's
   429 or 529 retry also leaves `superseded` rows), matching each stage's calls to
   the rows no retry superseded (D14). Cloud and consultant dispatch semantics are
   otherwise unchanged. Prerequisite of E0 and E1.
2. **Owner verdict capture:** accept, minutes and interventions on a submitted task,
   appended to the registry through `registry-row.py`. Needed on E5's first day.
3. **Stop bricking tasks** (A3, A4, A5, B5): capture inside the action's error
   handling, with `tool_finished` written on capture failure; the lister skips and
   reports symlinks and oversize files instead of `die()`; bounded excerpts on
   output overflow instead of destroying the container; the remaining pre-dispatch
   broker codes handled; specific tool error codes returned to the model.
4. **Diagnostics keyed on label** (F3, B2-B6): raw replies and validation errors
   retained for public and synthetic contexts; hashes only for labelled ones.
5. **Probe extensions:** probes P10 and P11 and the adapter probe in
   `scripts/serving-probe.py`; a planner fixture script; a serving-card writer.
6. **Desktop resume** (A6, A7): every reason without an unresolved dispatch is
   resumable; `runtime_unavailable` stays resumable; a research-stage pause either
   resumes from persisted stage counters or cancels the stage, as the UI says.
7. **Pipeline tolerance, as four PRs** (D1-D6, D8, D9, D11, D13): (a) per-quote
   drop, heading normalisation, per-role thinking policy and output caps from the
   card; (b) the extraction layout, local packet trimming with disclosed omissions
   accepted by the ready gate, index batching by preview size, admission bounds and
   the feasibility estimate, the length cap from the brief; (c) the host fallback
   plan, skeleton synthesis, and a planner budget of two local calls plus one assist;
   (d) host flags: an absence-claim phrase flag for owner attention, with misses
   recorded (`claims.ts`, `research-coverage.ts`), and a numeric table-against-prose
   cross-check and clause-inversion flag (`document-review.ts`).
8. **Concurrent zero-risk local dispatch** (D12): the ledger admits several
   in-flight zero-fee local rows; index, extraction and judge loops run K at a time;
   cloud stays serialized and at-most-once.
9. **Structured output** behind a probe flag, reusing the `ReviewResultV1`
   `response_format` shape already sent by `openai-compatible.ts:223`.
10. **Assist wrapper for T1 and T2:** slim packet builders, explicit cache mode with
    a test asserting zero cache writes, per-touchpoint output caps, both firing
    policies (on signals for local-first; always, in place of S3 and S6, for the
    forced split), the fallback and stop code lists, the assist-purpose exception in
    the session, runner and controller pre-checks, in `store.commit`, in the
    research producer's receipt binding, with assists counted toward their stage and
    assist rows a retry superseded admitted uncounted, and in the harness loop's
    stage checks (`phase4-loop.ts:139-140`) (§5.2, Escalation), receipt fields in
    the registry row.
11. **Harness:** gate signals logged on every arm; E4's paired-retrieval mode (one
    R0-R5 pass per task-repeat whose retained pages and fetch receipts both arms
    replay offline, its search fee counted in each arm's episode cap, S9's
    fetched-during-the-run check satisfied by the shared retrieval's receipts,
    criteria 1 and 2 credited with the shared retrieval's queries and fetches, and
    criterion 7 timed from the start of the shared retrieval); `infra_invalid` classification
    with zero-fee resume; registry columns for queries, URLs, domains, bytes, settled
    and reserved USD, body bytes and disclosed bytes; ties to the original,
    reversing the recorded preference (finding E9); the entailment step off unless
    E0's judge fixture reaches its agreement level and graded runs show the rate
    separating accepted from rejected drafts (finding E10); the loop's stage checks
    (`phase4-loop.ts:139-140`) admitting a zero-fee `failed` row that its stage
    resolved (item 1); `git` set to the run's commit (finding E4); the
    supervised launcher (BL-20261101-0036) with an idle-window schedule for
    experiments E3 and E4.
12. **Search and browse front-end** (§5.5).
13. **Desktop wiring**, local only plus the per-task public assist toggle: research
    route (files and web scope), document review, the claims ledger, and so the
    entailment pass, for file-only research (D10); a separate judge model through
    `judgeModelFactory` only if E0 calls for one; a dispatch badge with counts. Tag
    `owner-v0.3`.
14. **P11 transport** (C3): refuse plain HTTP to the local model unless it is
    loopback or carries an explicit tunnel marker; an SSH local forward with a pinned
    host key as the interim; the box checklist; a packet-capture canary. The owner's
    day of work.
15. **P1 labels** replacing the `publicOrSynthetic` checkbox (public, or labelled
    with regime tags; monotonic join; imports labelled by default), after E5
    evidence. The T4 labelled packet path per D15 stays deferred.
16. **Later:** build-log rotation (finding E3); delete the legacy tracks or route the
    coding worker through the broker (C2); A9; consolidate limits (finding E5).

### 5.8 Stop list (recorded once, in one entry)

- H4's select-and-repair loop as a gate, and H5 as shaped (18 rows, USD 21.60):
  closed and superseded by E3 and E4. The pipeline code and f1-f3 are kept.
- The all-cloud agent loop as a product route (it stays a ceiling arm); the agent
  loop as a research reader; every cloud critique path (the 4/6 against 4/6 tie,
  BL-20261019-0838); model-judged escalation triggers; "7/7 automated" reported as
  accepted. Cloud claim verification is outside the three assist packets and
  unmeasured; it is reconsidered if E0's judge fixture does not reach the agreement
  level its card sets, so that local fact-checking cannot be scored, or if E4 shows
  calibrated local fact-check accuracy below criterion 3's 80%.
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

1. Is the model now served at your endpoint the one qualified on 2026-11-04 (model
   root `Qwen3.8-Flash-Next-NVFP4`, 262,144-token context, vLLM
   0.33.0rc1.dev617+g821038729)? The
   alias `RM-01 VLM` does not decide this, because it also served the 27B, and
   probe P1 can show a difference but cannot prove identical weights. If you confirm
   the same model and probe P1 matches, the 2026-11-04 figures are admissible and
   E0 is a delta check; otherwise none of them apply.
2. The cloud's role in public research, in the harness and behind the desktop's
   per-task assist toggle (desktop routes are local-only by default, §5.2, unless
   you decide below that the toggle starts on): always plan and synthesise (the
   forced split, which F1 calls your thesis), step in only after two failed local
   attempts (local-first), or not at all (all-local). The proposal is that E3's
   pre-registered rule picks the harness role and you record the result. What runs
   behind the toggle is E4's result instead: E4 tests one cloud-assisted route even
   when E3 picks all-local, and the toggle exists only if E4 ships that route (§5.6,
   E4). On the closed corpus all-local pays no fee and discloses nothing, so no
   route whose assists fire can beat it under the frontier rule, and it beats any
   such route that is not better on quality beyond tolerance. The rule therefore
   makes a cloud-assisted route the default by itself only when all-local is
   ineligible or that route's assists never fired. You choose where routes trade under §2.1 (for example a cloud-assisted route better on quality
   beyond tolerance) or are equal within every tolerance, and you name E4's
   cloud-assisted arm when E3 cannot (§5.6, E4). Also decide whether the per-task
   assist toggle starts on for URL-backed public tasks once E4 ships a
   cloud-assisted arm. You may instead fix the role now.
3. Confirm the readings of your direction: §2's statement of the ultimate goal,
   which you asked this review to clarify; the 2026-09-29 labelled-data rule and
   D15 are unchanged; equal weight also supersedes PLAN.md's "never as gates" rule
   for USD per accepted job and the first item of PLAN.md §2's W10 Stop row,
   "Treating API savings as a design driver"; OAJ stays the adoption north star
   beside the three columns.
4. Backlog item 0, the zero-fee process entry.
5. A named `Approved` entry for E3 and E4 against the harness line, with E4's
   admission condition or a reallocation from the weekly public-work line. E4's
   entry must also name its paid judges and the destination and key each uses, since
   the backend decides the egress destination (PLAN.md §4): GPT-5.5 for DeepResearch
   Bench RACE at the pinned revision, at OpenAI directly (`LLM_BACKEND=openai`) or
   through OpenRouter (`openai/gpt-5.5`), which that revision's README makes the
   default; and the OpenAI model and separately authorized key for LiveDRBench's
   official grader. Neither model is in the standing envelope (PLAN.md §4(b) names
   `gpt-6-sol` and `claude-sonnet-5-5`).
6. Which provider carries the assists and the E3 ceiling arm D:
   `claude-sonnet-5-5` (the 2026-10-30 decision) or `gpt-6-sol` (the only one with
   measured assist receipts).
7. Whether E2 may include a thinking-off writer arm
   (BL-20261101-2120-fast-v3-artifact-trial-approved recorded it as not approved).
8. SearXNG self-hosted on the device or the Mac, naming its upstream engines, or a
   keyed search API under R2's 30-query cap. Either is a new egress destination that
   needs your explicit approval (PLAN.md §4). A keyed API's fees (in E4 up to USD
   5.40 at USD 10 per 1,000, or 7.56 at Gemini grounding's USD 14 above its free
   allowance) count inside each episode's USD 0.75 cap, and at R2's 30 queries that
   cap can refuse the synthesis retry above about USD 6.3 per 1,000 and T2 above
   about USD 10.7 per 1,000 (§5.2).
9. The P11 timeline: an SSH local forward now, WireGuard later. Nothing labelled
   runs before it.
10. Whether to fund the Manus product baseline, on a separate account (E4 option):
    credits worth about USD 45-81 at list. The cash is about the same if the USD 40
    tier is adjustable, as Manus's "starting from" wording suggests, and otherwise
    USD 80-200. It is spend outside the USD 300 envelope and a new egress
    destination, both reserved to your explicit approval (PLAN.md §4).
11. Grading capacity: whether blind proxy grades may stand as provisional, with the
    owner's verdicts on every E5 job and a sample of E3 and E4.
12. Whether briefs will number their requirements, and whether the public brief may
    be disclosed with the exact first assist packet shown before dispatch.
13. The OpenAI dashboard reconciliation for Phase 2 (about 22% in aggregate, up to
    about 24% per run, on the pre-2026-10-22 uncached baselines such as 3.05-3.77;
    the cached 1.13-1.18 baselines are unaffected) and D20(b): is private source
    code regime-tagged by default?

---

## 6. Measured versus assumed

**Measured** (settled receipts, registry rows, code constants, or the shipped
reservation formula applied to a stated bound): every settled SOAR USD figure and
every reservation at a stated bound; the split, all-local and all-cloud results on
r3; the Phase 2 family pattern; the critique tie; the 27B, Flash-Next and API-only
throughput figures; every code finding marked H.

**Assumed or hypothesis**, which E0-E4 exist to measure: the new endpoint's
identity, throughput, concurrency, structured-output validity and adapter path;
local plan and synthesis failure rates, and so the assist trigger rates; acceptance
on fresh tasks for every route; whether the depth criteria are reachable on local
hardware inside 30 minutes; the judge's agreement with graders. Also assumed: the
settled estimates for T1 and T2 at their bounds (they rest on the 3.8 bytes per
token of one v3 packet), the T3 and T4 estimates and reservations (neither row
states a body or output bound yet), the retry figure, the web-scale split and the
expected spend of E3 and E4.

**Third-party and low confidence:** every Manus per-task credit and minute figure
(reviewer estimates and reports, or vendor-published claims and examples that are
dated or vendor-selected; none is an independently logged measurement), Manus's
depth profile except its 2025 blog post's figure of about 50 tool calls per task
(high but dated, §7), and competitor per-report costs, including those computed from
published API prices on third-party token counts.

---

## 7. Sources for the Manus bar

Read on 2026-11-05. Manus's own pages and arxiv.org could not be fetched from the
review environment. The Manus figures therefore rest on search excerpts of the
official pages plus third-party captures, and the paper figures on project sites,
mirrors or third-party notes, as each row says.

| Topic | Source | Date | Confidence |
| --- | --- | --- | --- |
| Plans and credit prices | Manus Help Center, "What is the current membership pricing for Manus" (https://help.manus.im/en/articles/11711111-what-is-the-current-membership-pricing-for-manus) | about 2026-10-23 | High (excerpt) |
| Pricing-page captures, including the USD 200 tier | ooligo's check of manus.im/pricing (https://raw.githubusercontent.com/marius-bughiu/ooligo/f5292770a7c94d00aafefedbcc7441fd9eaadd5e/content/tools/en/manus.mdx) and a TokenApp screenshot record (https://raw.githubusercontent.com/heathermhuang/TokenApp/50d479d7f91db81d6f942784d6806bd126a7ed29/docs/reviews/pricing-verify-2026-09.md), both re-fetched; Manus blog (https://manus.im/blog/best-ai-app-builders) | 2026-09-18 to 2026-10-02 | Medium |
| Add-on price, about USD 0.01 per credit | https://www.allable.ai/blog/manus-ai-pricing/ (third party; no official price found) | 2026-10-12 | Low |
| Credit rules, free-tier cap | Manus Help Center, credit consumption rules (https://help.manus.im/en/articles/11711097-what-are-the-rules-for-credits-consumption-and-how-can-i-obtain-them) | about 2026-10-01 | High (excerpt) |
| Wide Research limits | Manus Help Center, "What is Wide Research" (https://help.manus.im/en/articles/11960169-what-is-wide-research) | 2026 | Medium |
| Lite, Max and Wide Research costs | https://aimaker.substack.com/p/manus-claude-code-agents-review, https://cybernews.com/ai-tools/manus-max-review/, quorum research notes (https://raw.githubusercontent.com/krzysztoff1/quorum/main/docs/research/01-manus-and-entrants.md), Trustpilot reviews (https://www.trustpilot.com/review/manus.im); Wide Research per-run estimates: 80-400 credits from nocode.mba, known only through a search-index summary that does not say which of the two nocode.mba pages it listed (https://www.nocode.mba/articles/manus-review, https://www.nocode.mba/articles/manus-ai-pricing) holds the figure, and 800-1,500+ credits from https://coworker.ai/blog/manus-ai-pricing and https://fast.io/resources/manus-ai-pricing/ | 2026 | Low |
| Manus showcase credit counts (817 for a deep-dive research site, 635 for a scheduled profile-building task) | Manus posts https://x.com/ManusAI/status/1937155935946055890 (the 817 known only from a search-index excerpt) and https://x.com/ManusAI_HQ/status/1937865863623061907 | 2025-06 | Low (vendor-selected examples) |
| Manus 2.0 cost claim | Manus blog (https://manus.im/blog/introducing-manus-2-0) | 2026-09-28 | Vendor claim |
| Single-context fabrication and Wide Research timing | Manus blog, "Wide Research: Beyond the Context Window" (https://manus.im/blog/manus-wide-research-solve-context-problem), known only from a search excerpt | 2025-10-29 | Vendor claim |
| About 50 tool calls, 100:1 input to output, KV-cache hit rate | Manus blog, "Context Engineering for AI Agents: Lessons from Building Manus" | 2025-07-18 | High, but dated |
| 300-900 credits per research task | Synthesis range: 500-900 for one complex task, a reviewer estimate repeated across blogs (https://www.lindy.ai/blog/manus-ai-review, https://trycompass.co/review/manus-review, https://fast.io/resources/manus-ai-pricing/), and 300-500 for a 10-source report with chart (https://www.openaitoolshub.org/en/blog/manus-ai-review, https://felloai.com/manus-ai-pricing/) | 2026 | Low to medium |
| Minutes per research task (14-50) | Third-party reviews (https://aiinsightsnews.net/is-manus-ai-good/, https://till-freitag.com/en/blog/manus-ai-review-en, https://www.buildingcreativemachines.com/p/test-driving-manus-a-new-generative, https://www.allaboutai.com/ai-reviews/manus-ai/) | 2025-2026 | Low |
| About 2x run-to-run credit variance | https://www.shareuhack.com/en/posts/manus-ai-review-2026, known only through a search-index paraphrase | 2026 | Low |
| Depth rules (open original pages, no snippet citations, several thousand words) | An unofficial, publicly circulated copy of Manus's 2025 agent prompt | 2025-03 | Low |
| DeepResearch Bench (RACE, FACT) | 2025 scores from Table 1 on the project site (https://deepresearch-bench.github.io/); the switch of the RACE judge to GPT-5.5 and of the FACT judge to GPT-5.4-mini, from the README at the pinned revision `469cce54` (https://github.com/Ayanami0730/deep_research_bench); the paper, arXiv 2506.11763, was not reachable | 2025; judges changed 2026-05-11 | High |
| LiveDRBench | Third-party notes on arXiv 2508.04183, which was not reachable (zhaoyang97 Paper-Notes, XiaoKuge records); the README at https://github.com/microsoft/livedrbench has no scores | 2025 | Medium |
| Mind2Web 2 | A third-party summary (MKurdi21 Agentic-Web-Crawlers) and a leaderboard snapshot (O6lvl4 agent-bench-matrix) of arXiv 2506.21506, which was not reachable | 2025 | Medium |
| Citation fact-check frontier | "Cited but Not Verified", arXiv 2605.06635, read through an abstract mirror (Miyan0Shiho arxiv-auto-collector) | 2026-05 | Medium |
| Gemini Deep Research per-report cost | Official token and grounding prices (https://cloud.google.com/model-garden/pricing; Search grounding USD 14 per 1,000 beyond 5,000 free a month) applied to token counts from one member-only blog (https://levelup.gitconnected.com/i-tested-googles-new-deep-research-vs-deep-research-max-the-1-22-b31a7a78c70f) | 2026-11-05 | High for prices, low for token counts |
| Kimi Researcher per-report cost | Derived from a third-party estimate of one report's credit share (https://www.usagepricing.com/blueprint/activity/moonshot-ai-2026-09-28-kimi-plus-pro-max-ultra-plans) | 2026-09-28 | Low |
| OpenAI o3 deep research per-report cost | Artificial Analysis post (https://x.com/ArtificialAnlys/status/1940896348364210647) | 2025-07 | Unverifiable, stale |
| OpenAI and Perplexity API and search prices | LiteLLM price map (https://github.com/BerriAI/litellm, `model_prices_and_context_window.json`) | 2026-11-05 | Medium |
| GPT Researcher cost and depth | https://github.com/assafelovic/gpt-researcher (README) | 2026-11-05 | High for the README's statements |

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

**Adversarial checks.** After the first version was committed (`6a5d396`), five
read-only checkers each worked through one scope: code tables A and B; code tables
C to E and §5; SOAR numbers; external figures; compliance and goal alignment. A
skeptic then tried to refute every finding. They checked about 850 claims,
confirmed 96 findings (7 errors, 56 imprecisions, 33 minor points) and refuted 4.
The errors were in rows B3, B5, D10 and E9 of §4, in the label on the all-cloud 3.05-3.77
range, in the Wide Research cost (a cap read as a floor) and in the harness line's
remaining balance. The second version (`cf17706`) applied fixes for all 96, plus
one claim a checker flagged outside its scope (§1's CI row).

A second check then ran five read-only checkers on `cf17706`, each with a skeptic:
the code fixes, the number fixes, the external and comparison fixes, the new design
elements, and the correction entry with the PLAN.md notes. They checked about 800
claims, confirmed 54 findings (1 error, 29 imprecisions, 24 minor points) and
refuted 4. Several first-round fixes had been incomplete or had introduced new
imprecision. The error was in §5.2's escalation: the assist exception also needs the
research producer's receipt binding, so the two places named would not have kept a
cloud UNKNOWN from blocking local work. The third version (`90046a0`), PLAN.md and
BL-20261105-1357-second-check-corrections-utc-reset applied fixes for all 54; the
consequential ones were re-read at the source first.

A third check ran five read-only checkers on `90046a0`, each with a skeptic: the
code facts, the numbers, the external sources, the design rules, and the correction
entry with the validator reset. They checked about 480 claims, confirmed 37 findings
(1 error, 16 imprecisions, 20 minor points) and refuted 1. As in the second check,
several earlier fixes had been incomplete or had introduced new imprecision. The
error, which the fix for the second check had introduced, was in E3's rule: the
floor of accepts(D) − 1 applied to every route and D meets it trivially, so the
all-cloud ceiling could have become the default, which the stop list rules out. The
fourth version (`72433d1`) and BL-20261105-1550-third-check-corrections applied
fixes for all 37; the consequential ones were re-read at the source first. That
re-reading also found D14, which no checker reported.

A fourth check ran three read-only checkers on `72433d1`, each with a skeptic: the
decision rules, the code facts, and the record (numbers, sources and the new entry).
They checked about 270 claims, confirmed 17 findings (no errors, 6 imprecisions, 11
minor points) and refuted 1. The most consequential: what runs behind the desktop's
assist toggle is E4's result, not E3's; the option of a toggle that starts on
contradicted the stated local-only default; a cloud assist retried after a 429 or
529 also leaves a row the research producer rejects, which widens D14; and E4's rule
still gave no outcome for two arms that trade within the quality column. The fifth version (`a0fdd95`) and
BL-20261105-1650-fourth-check-corrections applied fixes for all 17.

A fifth check ran one read-only checker on `a0fdd95`, with a skeptic, over that
version's changes and its entry. It checked about 96 claims and confirmed 2 minor
points, with no errors and no imprecisions: §8's list from the fourth check omitted
two proposal changes that its entry records, and three passages still gave only the
older reasons for the owner's choice after §2.1 added a third. This version and
BL-20261105-1722-fifth-check-corrections apply both.

Where a fix changed the proposal, the change is still `Proposed`. The proposal
changes recorded in the correction entries are these. From the first check:
symmetric tolerances in the frontier rule; acceptance per run and stability per
task, with three E4 repeats and paired retrieval; RACE tied to the pinned revision's
GPT-5.5 judge; the forced split as an equal E3 candidate; E4's cloud-assisted arm
chosen from E3 instead of fixed to B; R2's 30-query cap for a keyed search API
instead of 20 calls; the revised E3, E4 and budget figures; `store.commit` as the
second place for the assist exception; host flags as backlog item 7(d); and 13 owner
decisions instead of 11. From the second: a quality floor for every E3 route, which
as worded also made the ceiling D a candidate, and stated outcomes for the E3 and E4
results, corrected after the third and fourth checks; the scope of each depth
criterion; the local judge's thresholds held until E0 calibrates it; the forced
split's failure path; search fees inside each E4 episode cap; the ceiling arm D
cached, with a call allowance above the 78-80 calls the all-cloud loop used; E4's
paid judges named in §5.10, item 5; and the research producer as the third place for
the assist exception. From the third: D as the ceiling and never a candidate;
criterion 5 measured in E3, criterion 6 judged with the corpus files and each
brief's word limit, and a definition of a newly failed depth criterion; criterion 3
scoped for JSON deliverables; an E4 arm order without overlaps, with the owner
choosing between arms equal within every tolerance; the desktop research route and
its toggle gated on E4, the toggle-off route limited to an arm A that itself
qualified, and the toggle's starting state as an owner decision; an agreement level,
set by the E0 card, before the judge's thresholds or selection role apply, with
cloud claim verification reconsidered if E0 leaves the judge uncalibrated; the
harness loop as the fourth place for the assist exception, with assists counted
toward their stage; D's fee checked against its cap on f2, with E3's expected spend
and E4's balance conditional on D's cost; the search-fee limits restated, with E4's
keyed-search exposure at USD 5.40 or 7.56; E4's paid judges named with the
destination and key each uses, OpenRouter included; the producer (D14) and the loop
admitting resolved local rows; and §2's goal statement put to the owner for
confirmation, with direction 4 anchored on the owner's own words. From the fourth,
including six changes the third entry omitted: criteria 1 and 2 credited with E4's
shared retrieval; graded runs that separate accepted from rejected drafts, besides
the agreement level, before the judge gets a selection role or the harness
entailment step turns on; the forced split's paths after a truncated T2 and after a
T1 UNKNOWN; E1 extended to the harness loop, the research session and seed tests and
a retried research call, with a gate that such a stage still reaches the writer; the
owner's option to raise D's and E3's caps; the producer binding assists that failed
into the host fallback and admitting, uncounted, any assist row a retry superseded;
backlog item 1's producer fix extended to resolved cloud rows in the reader context;
what runs behind the toggle set by E4, not E3; the toggle's starting state as the
one exception to the local-only default; depth criteria compared over the runs to
which they apply; a definition of being better on quality, with the owner choosing
between two E4 arms the frontier rule cannot order; toggle-off and file-only
research jobs in E5 on arm A only if A itself qualified; and E0 deciding whether
criterion 3's judge thresholds apply in E4 (E3 does not measure criterion 3).

**Code map.** Short names in the tables resolve as follows.

| Name | Path |
| --- | --- |
| `broker.ts`, `store.ts`, `runner.ts`, `sandbox.ts`, `session.ts`, `model.ts`, `profiles.ts`, `contracts.ts`, `checkpoints.ts`, `claims.ts`, `selection.ts`, `repair.ts`, `consultation.ts`, `public-sources.ts`, `flash-next-admission.ts`, `document-review.ts`, `research-*.ts` | [src/main/private-agent/](../src/main/private-agent/) |
| `controller.ts` | [src/main/general-tasks/controller.ts](../src/main/general-tasks/controller.ts) |
| `general-task-contracts.ts` | [src/shared/general-task-contracts.ts](../src/shared/general-task-contracts.ts) |
| `config.ts`, `bootstrap.ts`, `liveness.ts` | [src/main/config.ts](../src/main/config.ts), [src/main/bootstrap.ts](../src/main/bootstrap.ts), [src/main/liveness.ts](../src/main/liveness.ts) |
| `Dockerfile`, `requirements.txt` (private agent) | [runtime/private-agent/](../runtime/private-agent/) |
| `search-text.ts` | [src/main/tools/search-text.ts](../src/main/tools/search-text.ts) |
| `openai-compatible.ts` | [src/main/providers/openai-compatible.ts](../src/main/providers/openai-compatible.ts) |
| `worker.py` | [runtime/patch-worker/worker.py](../runtime/patch-worker/worker.py) |
| `private-agent-local-screen.ts`, `phase4-loop.ts`, `registry-row.py`, `validate-build-log.ts`, `serving-probe.py` | [scripts/](../scripts/) |
| `phase4-loop.test.ts`, `private-agent-research-pipeline.test.ts`, `private-agent-research-seed.test.ts`, `private-agent-research-session.test.ts`, `private-agent-broker.test.ts` | [tests/unit/](../tests/unit/), [tests/integration/](../tests/integration/) |
| `ci.yml` | [.github/workflows/ci.yml](../.github/workflows/ci.yml) |
| `registry.jsonl` | [experiments/registry.jsonl](experiments/registry.jsonl) |
