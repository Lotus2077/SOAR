# E4 judges: models and fees for LiveDRBench's grader and DeepResearch Bench RACE

Date checked: 2026-11-08. Every price, model status and repository fact below was read
on that day. Status: research findings for issue #51. Nothing here is approved,
implemented or verified, and no judge, model or paid API was called. Naming the
LiveDRBench grader's judge model, and settling whether E4's judge fees fit, is the
owner's decision (#61, the open part of review decision 5), recorded before E4 starts.

**Gist: at the pinned revisions, RACE with GPT-5.5 by itself most likely exceeds E4's
USD 6 judge-fee cap (about USD 7.6 for 12 reports, range 4.5-12.6), because the pinned
pipeline also has GPT-5.5 rewrite every report before scoring it. The LiveDRBench grader
adds USD 0.05-4.20 for 12 runs, depending on the model and the answer size. Its authors
judged with GPT-4o, which (with GPT-4o mini, GPT-4.1 and GPT-4.1 mini) is the only
model family whose API accepts the pinned grader's calls unchanged. All four shut down
on 2027-01-14.**

## Short answer

1. **LiveDRBench grader at `6ff85b67`.** The authors used GPT-4o as the judge "across
   all our experiments" (paper, Appendix B). GPT-4o is also the CLI default
   (`--openai_model_name`, default `gpt-4o`), and no other judge is evaluated or
   recommended. Three of its four category graders send `max_tokens` and
   `temperature=0.0`. Those parameters suit non-reasoning chat models. OpenAI documents
   that GPT-5.2, GPT-5.4 and the GPT-6 family reject `temperature` unless reasoning
   effort is `none`. GPT-5.5 and `gpt-6-luna` (OpenAI's named replacement for GPT-4o)
   both default to medium effort, so both are expected to reject the pinned calls. Either
   would need a code patch, and then the grader is no longer the pinned one. One graded
   case makes from one to a few dozen judge calls; SciFacts compares pairs and can make
   a few hundred very short ones. Typically that is about 20 calls with 20k input and
   2k output tokens.
2. **RACE at `469cce54` with GPT-5.5.** Each report costs 2 calls: one GPT-5.5 call at
   low effort that rewrites the report without citations, and one at medium effort that
   scores it. No criteria are generated at grading time; the criteria ship in the
   repository. The full pre-cleaned reference report goes into every scoring call. The
   central estimate is about 33k input and 16k output tokens, or USD 0.63 per report.
3. **Prices** (OpenAI Standard tier, per 1M input / output tokens): GPT-5.5 5.00 / 30.00,
   `gpt-4o` 2.50 / 10.00, `gpt-4.1` 2.00 / 8.00, `gpt-4.1-mini` 0.40 / 1.60,
   `gpt-4o-mini` 0.15 / 0.60, `gpt-5.4-mini` 0.75 / 4.50, `gpt-6-luna` 0.10 / 0.50.
4. **Fit.** At the pinned revisions, no grader model brings the central total under
   USD 6. GPT-4o's central total is about USD 8.45. The total fits only at the low end
   (short reports, light reasoning) or with a cost lever (section 4.3). One lever is
   upstream's newer revision `f2735b5c`, whose official RACE pipeline has GPT-5.6 Luna do
   the cleaning. RACE then costs about USD 4.9 central, and GPT-4o's total is about 5.75.
5. **Planted-conflict tasks** carry no paid judge: they are graded by conflict gold,
   the local citation checker and blind proxy acceptance (agent grading).

## What was read, and what was not

- Both benchmarks' code, READMEs and data files at the pinned commits, through the
  GitHub API. The papers on arXiv. OpenAI's pricing, deprecations, model pages and
  guides (their Markdown versions). The leaderboard's Hugging Face Space through its API.
- LiveDRBench ground truths were **not** read. Its judge-call counts below are given per
  predicted item. The category of each pinned case is inferred from its agent-visible
  description in `benchmarks/research.jsonl`.
- For the 12 pinned DeepResearch Bench prompts, the reference reports, criteria and
  prompts were measured for **length only**; no content is reproduced. Characters are
  converted at 4 per token, OpenAI's rule of thumb for English
  ([Key concepts](https://developers.openai.com/api/docs/concepts)). The conservative
  case uses 3.5, the upper bound DeepResearch Bench's own cleaner applies
  ([`clean_article.py` L104-114](https://github.com/Ayanami0730/deep_research_bench/blob/469cce54ea7f6a63c163d3d9fec879cf289ec484/utils/clean_article.py#L104-L114)).
- Output and reasoning token counts are **assumptions**, stated where used. Neither
  pinned grader logs token usage. Neither paper reports token counts, and DeepResearch
  Bench's paper reports only per-article dollar costs (section 2.3).

## 1. LiveDRBench's official grader at `6ff85b67`

The pin is [`6ff85b67`](https://github.com/microsoft/LiveDRBench/tree/6ff85b67b35fa303907f6f275417622338acd1f6)
("scifacts minor fix", 2025-10-16). It was still the repository's latest commit on
2026-11-08.

### 1.1 The judge its authors used

- **Paper** ([arXiv 2508.04183v1](https://arxiv.org/html/2508.04183v1), CC BY 4.0):
  section 4.4 computes the claim-agreement scores with GPT-4o. The Table 2 caption says
  the same of the published precision, recall and F1, and Appendix B says GPT-4o is the
  judge in every experiment. The only check on the judge is the authors' manual
  verification (Table 11, Appendix D); no other judge model is reported.
- **Code and README**: `--openai_model_name` defaults to `gpt-4o`
  ([`evaluate.py` L155](https://github.com/microsoft/LiveDRBench/blob/6ff85b67b35fa303907f6f275417622338acd1f6/src/evaluate.py#L155)),
  and the [README](https://github.com/microsoft/LiveDRBench/blob/6ff85b67b35fa303907f6f275417622338acd1f6/README.md)
  documents `gpt-4o` as the default judge. It recommends no other model.
- **Snapshot.** Neither source names a dated snapshot. Today the `gpt-4o` alias points
  to `gpt-4o-2024-08-06`
  ([model page](https://developers.openai.com/api/docs/models/gpt-4o)). Passing the
  dated name as `--judge` makes E4's record exact.
- **Comparability.** Criterion 4's LiveDRBench anchors in the 2026-11-05 review (OpenAI
  DR 0.555, Perplexity 0.355) are the paper's Table 2 averages, so they were judged by
  GPT-4o.

### 1.2 What one graded case calls

SOAR's wrapper `benchmarks/harness/evaluate_livedr_row.py` calls the same per-category
`grade` functions as the official evaluator, for one row. All of them use Chat
Completions, and each judge call retries up to 5 times (6 attempts) on any exception,
including a reply that does not parse as JSON
([`utils.py` L52-76](https://github.com/microsoft/LiveDRBench/blob/6ff85b67b35fa303907f6f275417622338acd1f6/src/utils.py#L52-L76)).
Each retry is billed again.

| Category (pinned cases, inferred) | Judge calls per graded case | Fixed prompt | Per-call parameters |
| --- | --- | --- | --- |
| Entities (ldr-004, ldr-010) | 1 per predicted string; each call carries the remaining ground-truth list ([`entities.py` L40-70](https://github.com/microsoft/LiveDRBench/blob/6ff85b67b35fa303907f6f275417622338acd1f6/src/evals/entities.py#L40-L70)) | 692 chars (~170 tokens) | `max_tokens=500`, `temperature=0.0` |
| PriorArt (ldr-086, ldr-099) | 1 per predicted title; only titles are judged ([`priorart.py` L39-72](https://github.com/microsoft/LiveDRBench/blob/6ff85b67b35fa303907f6f275417622338acd1f6/src/evals/priorart.py#L39-L72)) | 591 chars (~150 tokens) | `max_tokens=500`, `temperature=0.0` |
| NovelDS and Flights (ldr-023, ldr-031, ldr-038, ldr-040) | 1 per dictionary answer; for a list of rows, 1 match call per predicted row (carrying the whole remaining ground-truth list) plus 1 scoring call when it matches ([`datasets_flights.py` L92-152](https://github.com/microsoft/LiveDRBench/blob/6ff85b67b35fa303907f6f275417622338acd1f6/src/evals/datasets_flights.py#L92-L152)) | 2,035 chars match, 2,614 chars score (~510 and ~650 tokens) | `max_tokens=1024`, `temperature=0.0` |
| SciFacts (ldr-076) | Pairwise prediction × ground-truth item, skipped on exact string match, for recall and again for precision; materials cases run it twice (material, then title) ([`scifacts.py` L35-91](https://github.com/microsoft/LiveDRBench/blob/6ff85b67b35fa303907f6f275417622338acd1f6/src/evals/scifacts.py#L35-L91)) | 299 chars (~75 tokens) | no `max_tokens`, no `temperature` |

ldr-055's category could not be inferred with confidence. E4's card has not named its
two cases yet.

### 1.3 Which models accept the pinned calls

| Model (dated snapshot) | Kind | Pinned calls accepted unchanged? | Status on 2026-11-08 |
| --- | --- | --- | --- |
| `gpt-4o` (`gpt-4o-2024-08-06`) | Non-reasoning | Yes: the authors' default | Deprecated, shutdown 2027-01-14 |
| `gpt-4.1` (`gpt-4.1-2025-04-14`) | Non-reasoning | Yes (expected) | Deprecated, shutdown 2027-01-14 |
| `gpt-4o-mini` (`gpt-4o-mini-2024-07-18`) | Non-reasoning | Yes (expected) | Deprecated, shutdown 2027-01-14 |
| `gpt-4.1-mini` (`gpt-4.1-mini-2025-04-14`) | Non-reasoning | Yes (expected) | Deprecated, shutdown 2027-01-14 |
| `gpt-5.4-mini` (`gpt-5.4-mini-2026-03-17`) | Reasoning, default effort `none` | Unverified: `temperature` is allowed at `none`; whether it accepts `max_tokens` is not documented | Active |
| `gpt-6-luna` | Reasoning, default effort `medium` | No: `temperature` must be removed unless effort is `none`; needs a patch | Active; OpenAI's named replacement for the four above |
| `gpt-5.5` (`gpt-5.5-2026-04-23`) | Reasoning, default effort `medium` | No (expected): `temperature` is rejected unless effort is `none`; needs a patch | Active |

The evidence for each verdict:

- **Non-reasoning models.** The API reference marks `max_tokens` as deprecated in favour
  of `max_completion_tokens`, and documents it as incompatible with o-series models only
  ([Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)).
- **GPT-5.x.** The "Using GPT-5.4" guide accepts `temperature`, `top_p` and `logprobs`
  only at reasoning effort `none`. It says a request carrying them at any other effort
  errors on GPT-5.4 and GPT-5.2, and always errors on older GPT-5 models
  ([guide](https://developers.openai.com/api/docs/guides/latest-model/gpt-5.4)).
  The "Using GPT-5.5" guide says GPT-5.5 keeps every API feature of GPT-5.4 and defaults
  to medium effort ([guide](https://developers.openai.com/api/docs/guides/latest-model/gpt-5.5)).
  DeepResearch Bench's own pinned client leaves sampling parameters unset for the same
  reason: its comment says GPT-5.x reasoning models reject non-default values
  ([`api.py` L22-25](https://github.com/Ayanami0730/deep_research_bench/blob/469cce54ea7f6a63c163d3d9fec879cf289ec484/utils/api.py#L22-L25)).
- **GPT-6 family.** The "Using GPT-6" guide tells callers to drop `temperature` whenever
  reasoning effort is not `none`
  ([guide](https://developers.openai.com/api/docs/guides/latest-model)).
- **Default efforts** come from the model pages:
  [gpt-5.5](https://developers.openai.com/api/docs/models/gpt-5.5),
  [gpt-6-luna](https://developers.openai.com/api/docs/models/gpt-6-luna) and
  [gpt-5.4-mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini).
- **Statuses and shutdown dates** come from the
  [deprecations page](https://developers.openai.com/api/docs/deprecations): the
  2026-10-14 notice covers the GPT-4 series, with `gpt-6-luna` as the replacement.
- **Older candidates are out.** `gpt-4.1-nano`, `o4-mini` and `gpt-4o-2024-05-13` shut
  down on 2026-10-23. `gpt-5`, `gpt-5-mini`, `gpt-5-nano` and `o3` shut down on
  2026-12-11.
- **What "no" means in practice.** A rejected call fails all 6 attempts, and the case
  then fails to grade. SciFacts' calls carry neither parameter, so they would run on any
  model. On a reasoning model, though, each SciFacts call also bills reasoning tokens.

### 1.4 Tokens and fee per graded case (estimate)

The ground-truth lists were not read, so the size of a case is set by assumption. These
are the per-case scenarios used below:

- **Typical:** about 20 judge calls, 20k input tokens, 2k output tokens.
- **High:** about 60 calls, 100k input, 10k output. This covers a long list answer of
  about 25 predicted rows, each matched against a ground-truth list of about 1-2k tokens.
  SciFacts can exceed 60 calls, but each of its calls is about 120 tokens, so even a few
  hundred stay inside this token budget.

Patched reasoning models add an assumed 0.5k reasoning tokens per call in the typical
case and 1k in the high case. One case is one graded run.

| Grader model | Fee per graded run, typical / high (USD) | 12 graded runs (USD) |
| --- | ---: | ---: |
| `gpt-4o` (authors' judge) | 0.070 / 0.350 | 0.84 / 4.20 |
| `gpt-4.1` | 0.056 / 0.280 | 0.67 / 3.36 |
| `gpt-4.1-mini` | 0.011 / 0.056 | 0.13 / 0.67 |
| `gpt-4o-mini` | 0.004 / 0.021 | 0.05 / 0.25 |
| `gpt-5.4-mini` (compatibility unverified) | 0.024 / 0.120 | 0.29 / 1.44 |
| `gpt-6-luna` (needs a patch) | 0.008 / 0.045 | 0.10 / 0.54 |
| `gpt-5.5` (needs a patch) | 0.460 / 2.600 | 5.52 / 31.20 |

Most grader prompts are under about 1,024 tokens, so no cache discount is assumed.

## 2. DeepResearch Bench RACE at `469cce54` with GPT-5.5

The pin is [`469cce54`](https://github.com/Ayanami0730/deep_research_bench/tree/469cce54ea7f6a63c163d3d9fec879cf289ec484)
(2026-05-11). Its README makes GPT-5.5 the RACE judge. With `LLM_BACKEND=openai` the
defaults are `gpt-5.5` for RACE and `gpt-5.4-mini` for FACT. GPT-5.5 was chosen for the
best overall agreement with human judgments: 71.82, against 70.58 for Gemini-3.1-Pro,
70.11 for Claude-Opus-4-7 and a 68.78 human inter-annotator baseline
([README](https://github.com/Ayanami0730/deep_research_bench/blob/469cce54ea7f6a63c163d3d9fec879cf289ec484/README.md)).
Today `gpt-5.5` resolves to `gpt-5.5-2026-04-23`.

### 2.1 Calls per graded report

- **Criteria generation: zero calls.** The scorer reads the pre-generated
  `data/criteria_data/criteria.jsonl`
  ([`deepresearch_bench_race.py` L28-31](https://github.com/Ayanami0730/deep_research_bench/blob/469cce54ea7f6a63c163d3d9fec879cf289ec484/deepresearch_bench_race.py#L28-L31)).
  `utils/generate_criteria.py` exists, but neither the RACE script nor
  `run_benchmark.sh` calls it.
- **Cleaning: 1 GPT-5.5 call** at `reasoning_effort` low. It rewrites the target report
  without citation marks or reference lists and returns it in full. The cleaning agent
  *is* the RACE client (`clean_agent = llm_client`,
  [L398-399](https://github.com/Ayanami0730/deep_research_bench/blob/469cce54ea7f6a63c163d3d9fec879cf289ec484/deepresearch_bench_race.py#L398-L399);
  stage settings in [`api.py` L84-88](https://github.com/Ayanami0730/deep_research_bench/blob/469cce54ea7f6a63c163d3d9fec879cf289ec484/utils/api.py#L84-L88)).
  A report splits into chunks only above an estimated 50,000 tokens, far beyond
  criterion 6's 6,000 words. Up to 3 attempts are made on API errors
  ([`clean_article.py` L48-124](https://github.com/Ayanami0730/deep_research_bench/blob/469cce54ea7f6a63c163d3d9fec879cf289ec484/utils/clean_article.py#L48-L124)).
- **Scoring: 1 GPT-5.5 call** at `reasoning_effort` medium. One merged prompt carries
  the task prompt, the cleaned target report, **the full pre-cleaned reference report**
  (`data/test_data/cleaned_data/reference.jsonl`, shipped) and the criteria list without
  weights. It asks for a criterion, an analysis and two scores for every criterion
  ([`score_prompt_en.py` L2-79](https://github.com/Ayanami0730/deep_research_bench/blob/469cce54ea7f6a63c163d3d9fec879cf289ec484/prompt/score_prompt_en.py#L2-L79)).
  The weights are applied locally. The call is repeated, up to 10 attempts, whenever the
  JSON cannot be parsed or a dimension is missing
  ([L106-140](https://github.com/Ayanami0730/deep_research_bench/blob/469cce54ea7f6a63c163d3d9fec879cf289ec484/deepresearch_bench_race.py#L106-L140)).
- **Common settings.** Every call sets `max_completion_tokens` to 64,000, which counts
  reasoning tokens. No `temperature` is sent
  ([`api.py` L81, L169-174](https://github.com/Ayanami0730/deep_research_bench/blob/469cce54ea7f6a63c163d3d9fec879cf289ec484/utils/api.py#L169-L174)).
- **Caching gives no relief across reports.** The shared prompt prefix ends at the
  target report (547 template characters plus the task prompt, about 200-300 tokens),
  and the reference and criteria come after it. So all scoring input is priced
  uncached. A retry of an identical prompt can hit the cache
  ([caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)).

### 2.2 Measured input sizes, 12 pinned prompts (ids 51-98, all English)

| Item | Min | Median | Max |
| --- | ---: | ---: | ---: |
| Criteria per prompt | 23 | 25 | 29 |
| Criteria list as sent (characters) | 9,420 | 10,903 | 12,218 |
| Cleaned reference report (characters) | 39,450 | 66,647 | 89,361 |
| Template + task prompt + reference + criteria (characters) | 52,864 | 81,304 | 105,494 |
| Same, in tokens (÷4; max also ÷3.5) | 13.2k | 20.3k | 26.4k (30.1k) |

The prompt file's SHA-256 matches `benchmarks/sources.json` (`62b197a2…`).

### 2.3 Tokens and fee per report

The assumptions behind the three scenarios:

- **Report length.** SOAR's report body is 2,500, 4,000 or 6,000 words (criterion 6's
  band and its midpoint) at 1.4 tokens per word.
- **Raw article.** The raw article is the body plus 25% for citation marks and a URL
  list.
- **Cleaning output.** The cleaner returns the body plus 0.5k, 1k or 2.5k reasoning
  tokens.
- **Scoring output.** The JSON is 3k, 4.5k or 6k tokens for 23-29 criteria, plus 2k,
  4.5k or 10k reasoning tokens. GPT-5.5's guide says it needs fewer reasoning tokens
  than earlier models at the same effort.

| Scenario | Cleaning in / out (tokens) | Scoring in / out (tokens) | Fee per report, Standard (USD) | 12 reports (USD) |
| --- | --- | --- | ---: | ---: |
| Low | 4.6k / 4.0k | 16.7k / 5.0k | 0.38 | 4.52 |
| Central | 7.3k / 6.6k | 25.9k / 9.0k | 0.63 | 7.61 |
| High | 10.8k / 10.9k | 38.5k / 16.0k | 1.05 | 12.64 |

In the central case cleaning is USD 0.23 of the 0.63, because GPT-5.5 re-emits the whole
report at USD 30 per 1M output tokens. One extra scoring attempt costs about USD 0.28 in
the central case, with its input then cached at USD 0.50 per 1M. The 64,000-token output
cap allows up to USD 1.92 of output on a single runaway call.

**A published anchor.** DeepResearch Bench's paper (Table 3,
[arXiv 2506.11763v1](https://arxiv.org/html/2506.11763v1), §4.3.4) reports average RACE
judge costs per article in 2025: Gemini 2.5 Pro Preview USD 0.13, o3 0.37, o4-mini 0.04,
Claude 3.7 Sonnet 0.47. It does not say how they were computed. These are the same order
as the scoring-only estimate here (USD 0.23-0.67).

### 2.4 Upstream changed the cleaner after the pin

Upstream's README news for 2026-09-22 says the default article-cleaning model moved from
GPT-5.5 to GPT-5.6 Luna to cut the cleaning stage's cost, while GPT-5.5 stays the
official RACE judge. The code change is commit
[`636f8eed`](https://github.com/Ayanami0730/deep_research_bench/commit/636f8eedba76965551a752b9a824e6177a2ba2bd)
(2026-09-09). It adds `CLEAN_MODEL`, with default `gpt-5.6-luna`, and makes the cleaner
use it. The README announcement is
[`f2735b5c`](https://github.com/Ayanami0730/deep_research_bench/commit/f2735b5c3636759c22f9e936c0232de8bf545b67)
(2026-09-29), the repository's head on 2026-11-08.
At the pin there is no `CLEAN_MODEL`: GPT-5.5 cleans. One trap at the pin:
`--skip_cleaning` also skips scoring
([L409-476](https://github.com/Ayanami0730/deep_research_bench/blob/469cce54ea7f6a63c163d3d9fec879cf289ec484/deepresearch_bench_race.py#L409-L476)),
so the flag cannot be used to save the cleaning call.

## 3. OpenAI list prices on 2026-11-08

Source: [pricing](https://developers.openai.com/api/docs/pricing) (Markdown version
`pricing.md`), in USD per 1M tokens, for prompts of 272K tokens or less.

| Model | Standard input / cached / output | Flex (= Batch) input / output | Status |
| --- | --- | --- | --- |
| `gpt-5.5` | 5.00 / 0.50 / 30.00 | 2.50 / 15.00 | Active |
| `gpt-4o` | 2.50 / 1.25 / 10.00 | not offered (Batch 1.25 / 5.00) | Shutdown 2027-01-14 |
| `gpt-4.1` | 2.00 / 0.50 / 8.00 | not offered (Batch 1.00 / 4.00) | Shutdown 2027-01-14 |
| `gpt-4.1-mini` | 0.40 / 0.10 / 1.60 | not offered (Batch 0.20 / 0.80) | Shutdown 2027-01-14 |
| `gpt-4o-mini` | 0.15 / 0.075 / 0.60 | not offered (Batch 0.075 / 0.30) | Shutdown 2027-01-14 |
| `gpt-5.4-mini` | 0.75 / 0.075 / 4.50 | 0.375 / 2.25 | Active |
| `gpt-6-luna` | 0.10 / 0.01 / 0.50 (cache write 0.125) | 0.05 / 0.25 | Active |
| `gpt-5.6-luna` (upstream's cleaner) | 0.20 / 0.02 / 1.20 | 0.10 / 0.60 | Active |

Notes on the table:

- Reasoning tokens bill as output.
- For GPT-5.5, prompts over 272K tokens cost 2x input and 1.5x output; RACE's prompts
  stay far below that.
- Regional-processing endpoints add 10%. Neither judge uses one at `api.openai.com`.
- Flex is set per request with `service_tier: "flex"`. It trades slower responses and
  occasional unavailability for Batch rates, and the guide lists model evaluations as a
  suitable use ([Flex guide](https://developers.openai.com/api/docs/guides/flex-processing)).
  Neither pinned grader sets it.

## 4. E4's judge fees against USD 6

### 4.1 What is graded

E4 (review §5.6) grades:

- **LiveDRBench grader:** 2 cases × 3 repeats × 2 arms = **12 graded runs**.
- **RACE:** 2 prompts × 3 × 2 = **12 graded reports**.
- **Planted-conflict tasks: no paid judge.** They are graded by conflict gold
  (criterion 5), the local citation checker (criterion 3) and blind acceptance
  (criterion 8). Blind acceptance is the owner's verdict, else a blind proxy, which
  PLAN.md D9 defines as blind agent grading labelled provisional. The review budgets
  no API fee for it.

The owner's record names exactly two paid judges (BL-20261107-0650, corrected by
BL-20261107-0718), and FACT is not run (`SOAR-pilot`). A run that does not submit is
not graded and costs no judge fee. So 12 + 12 gradings is the ceiling.

### 4.2 Totals by grader model

Each total adds 12 RACE reports and 12 grader runs. The range in brackets runs from
"RACE low + grader typical" to "RACE high + grader high".

| Grader model | Grader, 12 runs (USD) | Total, RACE at the pin: central (range) | Total, RACE at upstream `f2735b5c`: central (range) | Fits USD 6? |
| --- | --- | --- | --- | --- |
| `gpt-4o` | 0.84-4.20 | 8.45 (5.36-16.84) | 5.75 (3.71-12.46) | Pin: low end only. Upstream: central, narrowly |
| `gpt-4.1` | 0.67-3.36 | 8.28 (5.19-16.00) | 5.58 (3.54-11.62) | Same as `gpt-4o` |
| `gpt-4.1-mini` | 0.13-0.67 | 7.74 (4.65-13.31) | 5.04 (3.01-8.93) | Pin: low end only. Upstream: central |
| `gpt-4o-mini` | 0.05-0.25 | 7.66 (4.57-12.89) | 4.96 (2.92-8.51) | Pin: low end only. Upstream: central |
| `gpt-5.4-mini` | 0.29-1.44 | 7.89 (4.81-14.08) | 5.20 (3.16-9.70) | As the minis, if compatible |
| `gpt-6-luna` (patched) | 0.10-0.54 | 7.70 (4.62-13.18) | 5.00 (2.97-8.80) | As the minis; not the pinned grader |
| `gpt-5.5` (patched) | 5.52-31.20 | 13.13 (10.04-43.84) | 10.43 (8.39-39.46) | No |

RACE dominates. At the pin, RACE alone is USD 4.52 / 7.61 / 12.64 (low / central /
high), so the grader choice moves the total by at most about USD 0.8 in the typical case.

### 4.3 What would make the total fit (each needs the owner's record)

| Lever | RACE, 12 reports, low / central / high (USD) | What it changes |
| --- | --- | --- |
| None (pinned `469cce54`) | 4.52 / 7.61 / 12.64 | — |
| Re-pin RACE to upstream `f2735b5c` (GPT-5.6 Luna cleans) | 2.87 / 4.91 / 8.26 | It is upstream's official pipeline. It changes the pinned revision (`benchmarks/sources.json`, `benchmarks/research.jsonl`; a build-log entry) and adds `gpt-5.6-luna` as a judge-role model at the same destination and key (JAO) |
| Flex for GPT-5.5 at the pin | 2.26 / 3.80 / 6.32 | A local one-line patch (`service_tier`) to the pinned client; slower, and requests may fail when capacity is short |
| SOAR cleans the report itself (pre-filling the cleaner's output file, so the pinned cleaner skips its call) | 2.80 / 4.80 / 8.07 | Replaces the official LLM cleaning step with SOAR's own |
| Upstream `f2735b5c` plus Flex | 1.44 / 2.45 / 4.13 | Both changes above |
| Raise the judge sub-cap | unchanged | E4's USD 20.5 cap grows. At about USD 13-17 for judges, the cap would likely outgrow the harness line's balance after E3, so it needs decision 5's reallocation |

Some combinations: with the upstream re-pin plus Flex, GPT-4o totals about USD 3.3
central and 8.3 at the joint high. GPT-4o mini stays under USD 4.4 even at the joint
high.

The levers that do not work:

- **Accepting the risk** means a stop rule that halts grading at USD 6. Every report or
  run left ungraded after that has no criterion-4 score, so it cannot be shown to meet
  the per-run criteria that E4's decision rule counts.
- **Fewer RACE gradings** leave runs without that score in the same way.

## 5. Points for the owner (#61)

1. **The grader's judge: fidelity against fee against shutdown.**
   - GPT-4o (`gpt-4o-2024-08-06`) is the authors' only judge, and criterion 4's
     LiveDRBench anchors were judged with it.
   - The minis save at most about USD 0.8 in the typical case and about 4 at the high
     end. They shift the judge against those anchors, and there is no published
     agreement data for them.
   - All four drop-in models shut down on 2027-01-14. The review's order puts E4 in
     weeks 4-5, but a slip past that date, or any later re-grade, would force a patched
     reasoning judge.
   - Pass a dated snapshot as `--judge`.
2. **RACE's fee is the binding constraint.** The cap needs one lever from section 4.3
   or a raised sub-cap. E4's "expected about 7" in the review should be re-derived with
   these figures.
3. **Spend control.**
   - Neither pinned grader logs token usage or enforces a fee cap.
   - RACE scoring retries up to 10 times, and each grader call up to 6.
   - E4 needs a per-call ledger, for example from each response's `usage` field, or a
     reconciliation of each key's usage. Separate keys (JAO, JAT) make per-judge
     attribution possible.
   - E4 also needs a projected-fee stop rule.
4. **Confirm compatibility before E4.** One graded fixture with the chosen grader model
   would show that the pinned calls are accepted. With `gpt-4o` that costs about USD
   0.07; with a mini, about USD 0.01 or less. It is still a paid call under JAT, so it
   needs the same gate as E4's paid calls.
5. **Invoke RACE directly.** Run `deepresearch_bench_race.py <run-name> --only_en` with
   `LLM_BACKEND=openai`, not `run_benchmark.sh`: that script's second phase runs FACT
   with `gpt-5.4-mini` and Jina, neither of which is approved
   ([`run_benchmark.sh` L71-93](https://github.com/Ayanami0730/deep_research_bench/blob/469cce54ea7f6a63c163d3d9fec879cf289ec484/run_benchmark.sh#L71-L93)).
   Use one target-model name per arm-repeat, because cleaned files and results are
   keyed by model name and task id.
6. **The RACE threshold needs no judge fee.** The official leaderboard Space publishes
   GPT-5.5-judged scores; its tab names GPT-5.5 as the RACE judge. Its `data_gpt55` folder at
   revision [`b2766240`](https://huggingface.co/spaces/muset-ai/DeepResearch-Bench-Leaderboard/tree/b2766240017cd7688374b8aae26fe2dde8146db3/data_gpt55)
   (2026-11-03) gives overall scores of 49.98 (Gemini 2.5 Pro Deep Research), 47.84
   (OpenAI Deep Research), 43.05 (Perplexity Research) and 41.22 (Grok DeeperSearch).
   It also has per-prompt rows for OpenAI and Perplexity covering all 12 pinned prompts.
   Criterion 4's threshold can therefore be set from published scores, without grading
   product reports.

## 6. Repository facts for running the judges

- **The pins.** `benchmarks/sources.json` pins the LiveDRBench evaluator (repository,
  URL, revision `6ff85b67…`, over the preview dataset at `cad63dd0…`). It pins
  DeepResearch Bench as a dataset revision `469cce54…` with a checksummed prompt file,
  with no `evaluator` block.
- **A path mismatch.** The `referencePath` there is the raw `reference.jsonl`, while the
  pinned scorer reads the pre-cleaned copy under `data/test_data/cleaned_data/`.
- **No pinned checkout.** Neither repository is vendored or a submodule. `.gitignore`
  ignores `benchmarks/cache/`, where the removed CLI cloned the grader
  (`benchmarks/cache/evaluators/livedrbench`). The checkout read for this note has no
  `benchmarks/cache` directory.
- **The removed CLI defaulted to `gpt-4o`.** That CLI (`src/benchmark`,
  `scripts/benchmark.ts`) was removed on 2026-09-28 in `bc22d26` and is kept at tag
  `archive/router-era-2026-09-28`. It cloned with `--no-checkout`, fetched the revision,
  detached at it and verified `HEAD`. It passed
  `--judge ${SOAR_LIVEDR_JUDGE_MODEL ?? "gpt-4o"}`, so the repository's own earlier
  default matched upstream's.
- **No runner today.** `benchmarks/README.md` still documents
  `pnpm benchmark fetch|prepare|setup-evaluator|evaluate`, which `package.json` no
  longer defines. E4 needs a runner that clones both pinned repositories before any
  graded run.
- **The wrapper.** `evaluate_livedr_row.py` requires `--judge` and `OPENAI_API_KEY`
  (the value of JAT, set in the grader's own process). It prints only the metrics.

## Sources (all read 2026-11-08)

- LiveDRBench at `6ff85b67`: [README](https://github.com/microsoft/LiveDRBench/blob/6ff85b67b35fa303907f6f275417622338acd1f6/README.md),
  [`src/evaluate.py`](https://github.com/microsoft/LiveDRBench/blob/6ff85b67b35fa303907f6f275417622338acd1f6/src/evaluate.py),
  [`src/evals/`](https://github.com/microsoft/LiveDRBench/tree/6ff85b67b35fa303907f6f275417622338acd1f6/src/evals),
  [`src/utils.py`](https://github.com/microsoft/LiveDRBench/blob/6ff85b67b35fa303907f6f275417622338acd1f6/src/utils.py);
  paper [arXiv 2508.04183v1](https://arxiv.org/html/2508.04183v1) (§4.4, §5.2, Table 2,
  Appendix B, Table 11).
- DeepResearch Bench at `469cce54`: [README](https://github.com/Ayanami0730/deep_research_bench/blob/469cce54ea7f6a63c163d3d9fec879cf289ec484/README.md),
  [`deepresearch_bench_race.py`](https://github.com/Ayanami0730/deep_research_bench/blob/469cce54ea7f6a63c163d3d9fec879cf289ec484/deepresearch_bench_race.py),
  [`utils/api.py`](https://github.com/Ayanami0730/deep_research_bench/blob/469cce54ea7f6a63c163d3d9fec879cf289ec484/utils/api.py),
  [`utils/clean_article.py`](https://github.com/Ayanami0730/deep_research_bench/blob/469cce54ea7f6a63c163d3d9fec879cf289ec484/utils/clean_article.py),
  [`prompt/`](https://github.com/Ayanami0730/deep_research_bench/tree/469cce54ea7f6a63c163d3d9fec879cf289ec484/prompt),
  [`data/`](https://github.com/Ayanami0730/deep_research_bench/tree/469cce54ea7f6a63c163d3d9fec879cf289ec484/data)
  (lengths only), [`run_benchmark.sh`](https://github.com/Ayanami0730/deep_research_bench/blob/469cce54ea7f6a63c163d3d9fec879cf289ec484/run_benchmark.sh);
  later upstream: commits [`636f8eed`](https://github.com/Ayanami0730/deep_research_bench/commit/636f8eedba76965551a752b9a824e6177a2ba2bd)
  and [`f2735b5c`](https://github.com/Ayanami0730/deep_research_bench/commit/f2735b5c3636759c22f9e936c0232de8bf545b67);
  paper [arXiv 2506.11763v1](https://arxiv.org/html/2506.11763v1) (§4.3.4, Table 3);
  [cost question, issue #4](https://github.com/Ayanami0730/deep_research_bench/issues/4);
  leaderboard [Space `b2766240`](https://huggingface.co/spaces/muset-ai/DeepResearch-Bench-Leaderboard/tree/b2766240017cd7688374b8aae26fe2dde8146db3).
- OpenAI: [pricing](https://developers.openai.com/api/docs/pricing),
  [deprecations](https://developers.openai.com/api/docs/deprecations), model pages for
  [gpt-4o](https://developers.openai.com/api/docs/models/gpt-4o),
  [gpt-4.1](https://developers.openai.com/api/docs/models/gpt-4.1),
  [gpt-4o-mini](https://developers.openai.com/api/docs/models/gpt-4o-mini),
  [gpt-4.1-mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini),
  [gpt-5.5](https://developers.openai.com/api/docs/models/gpt-5.5),
  [gpt-5.4-mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini),
  [gpt-6-luna](https://developers.openai.com/api/docs/models/gpt-6-luna),
  [gpt-5.6-luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna);
  guides [Using GPT-5.4](https://developers.openai.com/api/docs/guides/latest-model/gpt-5.4),
  [Using GPT-5.5](https://developers.openai.com/api/docs/guides/latest-model/gpt-5.5),
  [Using GPT-6](https://developers.openai.com/api/docs/guides/latest-model),
  [Flex processing](https://developers.openai.com/api/docs/guides/flex-processing),
  [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching),
  [key concepts](https://developers.openai.com/api/docs/concepts);
  [Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).
- SOAR: `benchmarks/sources.json`, `benchmarks/research.jsonl`, `benchmarks/README.md`,
  `benchmarks/harness/evaluate_livedr_row.py`, `.gitignore`,
  `docs/PROJECT_REVIEW_2026-11-05.md` (§2.2, §5.6 E4, §5.10 item 5), `docs/HANDOFF.md`,
  `docs/BUILD_LOG.md` (BL-20261107-0650, BL-20261107-0718), tag
  `archive/router-era-2026-09-28` (`src/benchmark/evaluators.ts`,
  `src/benchmark/workspace.ts`).
