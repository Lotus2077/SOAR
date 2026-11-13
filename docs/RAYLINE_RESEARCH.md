# Rayline for SOAR: what it sells, how solid its evidence is, and what SOAR borrows

Date checked: 2026-11-13, and calibrated the same day against the report itself (§8). These are research findings, not a ticket. The decisions and
plan adjustments are in BL-20261113-0730-rayline-evaluation-plan-adjustments. Nothing
here is approved, implemented or verified beyond that entry.

How the research was done:
- No Rayline account, API call, model download or paid request was made.
- The agents read the ARC report PDF as extracted text. The session then read the report directly from the copy the owner supplied: all 23 pages of text, and the figures as rendered images. §8 records what that changed.
- Every docs.rayline.ai page has a line telling AI agents to fetch an `llms.txt` index
  first; it was not acted on.
- Nine read-only agents did the research: three on Rayline, two on SOAR, two ideation
  lenses, and one adversarial verifier per lens. The verifier re-fetched the sources and
  checked each idea against this repository. This session then re-checked the SOAR facts
  at `main` 9d10b9a.

**Gist.** Rayline is a source of patterns, not components:
- Its hosted products see whole conversations.
- Its open router cannot run locally end to end, and it is not calibrated for SOAR's model.
- Its headline savings are self-reported, three days old and unreplicated.
- Its own evaluated setup and the routing literature support SOAR's architecture v5: the
  local model does the volume work, and the cloud gets sealed one-shot packets fired by
  host signals after a verified local failure.

Eight patterns survived verification. In order:
1. Record the selected model next to the served model.
2. Check the endpoint's identity and context window in the doctor.
3. Add planner and judge cells to E0: a thinking-sequence condition, a budgeted-thinking
   condition, and probability-scored typed questions.
4. Add descriptive uncertainty and help tables to E3.
5. Keep an egress allowlist that pairs each key with its host.
6. Build a loopback metering gateway for E4's paid judges.
7. Record each provider's data-retention mode in decision 6.
8. Use "value of success × probability − cost" as a descriptive trade-off, never a
   policy.

## 1. What Rayline sells

Rayline Labs is a trade name of Atlas Futures, Inc. (Tennessee), which also runs
Workshop, formerly Memex. The founders previously built DataFleets, a privacy-analytics
company that LiveRamp acquired. The only funding report found ($8.5M, 2026-11-09) is an
aggregator story that cites the founder's own post.

| Product | What it does | Where it runs | What leaves the machine |
|---|---|---|---|
| ARC-1.0 | A decision model that writes no text. For each candidate model it predicts the probability of success, tokens per billing leg and the value of each reasoning level. It also flags personal data and labels the request | Weights are open (Apache-2.0); in practice it is hosted (see §2) | Whatever the caller sends |
| Generation API | Rayline picks the model and reasoning level, runs the request and returns the answer. Model ids: `arc-swift-1.0`, `arc-sage-1.0`, and `arc-1.0` (Dynamic) | Hosted | The whole request, to Rayline and then to the chosen provider |
| Routes API (`POST /v1/routes`) | Returns a model, a provider and a thinking setting for the caller to run. Stateless: it warns `episode_not_tracked` and reads no cache. About 1.5 s per route; 30 requests per minute | Hosted | The whole conversation, tool definitions included. Billed per input token read; never used for training |
| Decisions API | Up to 16 typed questions about a state (yes/no, choice, score), answered with probabilities and no output tokens. Its interface copies TypeSafe AI's Jev ("System One") | Hosted only | The state, up to 32,768 tokens; not retained |
| Raydock | An Apache-2.0 Rust gateway, created 2026-06-19, with 41 stars at the time of checking. It connects llama.cpp, Ollama, MLX or vLLM, plus cloud models, to Claude Code, Codex and other coding agents. Its Go core comes from a fork of vLLM Semantic Router | On the device | `--local`: a fixed rule set, with decisions on the device. Hybrid: every turn's request goes to Rayline's hosted decision service, local turns included, and every turn is billed |
| Workshop | An agent that builds websites, apps and dashboards. Arena mode builds four versions for the user to vote on | Cloud, or a desktop app with optional local models | The desktop docs say tools, publishing, sync and diagnostics still connect out |

The solutions pages render only in the browser, so their text was read from the site's
script bundle:

| Page | Rayline's pitch | Relevance to SOAR |
|---|---|---|
| AI application developers | Route on your own prices, including the cost of your own compute | SOAR prices local calls at USD 0; wall time is the real local cost |
| Engineering organizations | See which model did the work and whether extra reasoning paid off | Served-model receipts; thinking-level fixtures |
| Hybrid cloud and edge agents | For teams that own Apple-silicon or NVIDIA hardware. The page states that ARC does not run on the device and that hybrid mode is not offline | SOAR's exact owner, and the clearest difference: SOAR's privacy works at the level of the bytes sent |
| Routing developers | Weights, preference data, joint training, held-out evaluation with replay | Replay fixtures, paired labels, evaluation discipline |

How Rayline handles data:

| Mode | Training on the data | Retention |
|---|---|---|
| Standard | No | Rayline and its providers may keep content up to 30 days. It is unclear whether this covers Routes |
| Contributor (opt-in, cheaper) | Yes | About 5% of requests go to other models for exploration |
| Zero retention | No | Needs sales approval. The mode is encoded in the model id, and an unconfirmed setting is treated as zero retention |

Rayline publishes no sub-processor list and no processing-region commitment.
OpenRouter's app page credits Rayline with 84B tokens since June 2026, and a Rayline
gateway test record names an OpenRouter provider. That suggests OpenRouter carries some
hosted traffic, but this is an inference. Per-token prices could not be read because
the pricing tables never loaded.

## 2. How ARC works

**Model.** The report calls ARC a 0.8B decision model on a Qwen3.5-0.8B backbone; the
Hugging Face metadata counts 615,054,751 parameters. Its specialized heads read the frozen
layers 1-12, and only the question head uses layers 13-24, fine-tuned (report §3.1). A
12-layer vision encoder handles images. The NOTICE also credits Nemotron-PII (CC-BY-4.0).

**Inputs.** ARC reads the messages, tool calls and tool results that come before the
next reply, plus the tool definitions. Its second stage also embeds the earlier arms of
the session and price features.

**Outputs:**
- the probability of success per model, from a five-member ensemble;
- four token legs: uncached input, cache read, cache write and output;
- the quality of continuing at each reasoning control;
- personal-data presence and type (15 classes);
- topic labels (only `software` is served).

**Policy.** Utility = V × p(success) − predicted cost, where V is the dollar value of a
success. V is 0.1 for Swift and 4.5 for Sage; Dynamic accepts 0.1-30. The prefer-local
policy keeps the local model when its predicted success reaches a threshold: 0.65 is
the service default, and the evaluation used 0.85. The reasoning level is picked with
its own cost weight. The selector also subtracts a small relative-duration term (weight
µ, 0.01 in the RouteBench rollouts; report Appendix A.2).

**Training.** About 90% of the training weight comes from Workshop trajectories, with
users who opted out excluded. The rest comes from tasks with checkable outcomes, where
several arms are replayed from one recorded state, and from Workshop Arena preferences.
Labels come from weak supervision over verifiers, later judgements, removal of the
agent's edits and user feedback.

The candidate pool is eleven models (the Claude 5.5 family, GPT-6 variants, DeepSeek
V4.1 Flash, GLM-5.3, Kimi K3). A new model needs new evidence and a refit through
Rayline's proprietary pipeline. Prices need no retraining: callers pass them per
request.

**Long tasks and caching.** Model switches are allowed only at cache boundaries: task
start, subagent start, compaction, or a user turn with a cold cache. A switch at a user
turn is charged the cost of rebuilding the cached prefix. The evaluated configuration
picked the model at task start and held it for the episode, while choosing the reasoning
level on every routed call (report §2.3). The provider's native effort setting is part of
its cache key, so reasoning is steered by privately appended text instead. Rayline
maps thinking budgets of up to 2,000 tokens to low, up to 4,000 to medium, and more to
high.

**Local serving.** `vllm-arc` is a work in progress. It serves the encoder and the
first-stage score only, with no second stage, policy, question head or signals. It
needs a pinned vLLM fork and was tested on Linux with CUDA 13.0. The report says Raydock
obtains decisions from an on-device service or the hosted API (Appendix B), but no
on-device decision service is published, and the model card recommends the hosted API. Raydock's hybrid
mode accepts only local models in its registry and defaults to Qwen3.8-27B.

## 3. How solid the evidence is

All figures are Rayline's, from the report and the model card (released 2026-11-10/11).
No independent replication was found. The only outside discussion is a June 2026 Show HN
(11 points) in which a question about how the router decides was left unanswered.
OpenRouter's router-benchmark post does not list ARC; Rayline ran that benchmark itself.
Adoption at the time of checking: 37 downloads, and 41 stars for Raydock.

| Benchmark | Opus 5.5 | Sage | Sage cost vs Opus | Prefer-local | Prefer-local cost | Local picks |
|---|---|---|---|---|---|---|
| DeepSWE | 69.9 | 68.7 | 7% | 72.3 | 1.1% | 98.2% |
| Terminal-Bench 2.1 | 91.0 | 92.4 | 58% | 90.5 | 75.7% | 10.8% |
| SWE-Atlas QA | 61.6 | 62.4 | 13% | 62.6 | 1.6% | 91.9% |
| Tau3 Banking | 42.8 | 33.2 | 17% | 35.3 | 17.3% | 53.1% |
| GPQA Diamond | 89.9 | 94.1 | 21% | 92.5 | 12.3% | 51.4% |
| MMMU-Pro Vision | 82.2 | 82.9 | 39% | 82.7 | 40.9% | 2.1% |

Figures 8 and 9 of the report, read from the rendered figures. Opus's own scores in
Figure 9's run differ slightly: 90.7 on Terminal-Bench and 89.5 on GPQA.

- **The headline mixes two kinds of average.** The 97.4% quality figure is the mean of
  per-benchmark ratios. The 14.3% cost figure pools spend across all tasks, and DeepSWE
  dominates that pool (Opus costs USD 2.61 per task there, against 0.33 on
  Terminal-Bench). Averaged per benchmark, cost is about 25.8% for Sage and 24.8% for
  prefer-local.
- **One benchmark is much worse.** Tau3 Banking keeps 78% of Opus's quality; without it
  the mean would be about 101%.
- **The prefer-local quality headline doesn't follow from its figure.** The report never
  says how its 97.5% is aggregated. Figure 9's own values, against its Opus run, give
  98.5% as a mean of per-benchmark ratios, or 97.0% with each ratio capped at 100%. The
  figure's labels are consistent, so the gap is in the headline, not a swapped bar. The
  7.1% cost figure used DeepSeek V4.1 Flash (about 552B parameters) on several DGX
  Spark machines, and the report does not state the price it assigned to local compute.
- **The baselines are thin.** The only single-model baselines are Opus and Haiku. Sage
  sends 46.8% of its picks to GPT-6.1 Sol and 34.8% to DeepSeek Flash, but neither is
  run alone. RouterBench (2024) found that a single fixed model is hard for learned
  routers to beat.
- **No uncertainty is reported.** There are no run counts or intervals, and Opus's own
  scores differ between tables (91.0 against 90.7; 89.9 against 89.5). Differences of
  one or two points are within noise.
- **The test sets may overlap the training data.** The provenance lists 198 GPQA groups
  and 89 Terminal-Bench groups, which equal the full benchmark sizes, and no held-out
  split is stated.
- **The setup was narrow.** The model was chosen at task start and held for the
  episode; only the reasoning level changed per call. Switching models mid-task was not
  tested, and no ablation separates what model choice and reasoning control each
  contributed.
- **The decision models disagree across benchmarks.** On Rayline's own routing-question
  bench ARC beats Jev 1.14 (agreement 56.2% against 32.7%, calibration error 0.079
  against 0.31). On the public Decision Index it loses (46.9 against 60.7), and it also
  trails StartLux 0.8B, a model of its own size (53.8). It flips its answer twice as
  often as Jev when the options are reordered (19.0% against 9.3%; report Figure 11).
- **Against other routers** (report Table 2), the index weights quality 60%, speed 20%
  and cost 20%, so it is not a quality comparison alone. ARC Sage has the best mean (9.3)
  of the routers scored on all five benchmarks, but Pareto leads DeepSWE (9.9 against
  9.6), and OpenRouter Auto and Auto Code lead Tau3 Banking (9.0 and 8.9 against 7.7).
- **When the figures hold, and when not.** They plausibly hold for coding-agent work with
  a pool of strong, cheap models, measured against the most expensive frontier model.
  They likely fail on tool-and-policy tasks, unknown or small local models, frequent
  switching, adversarial inputs, and work unlike Workshop's traffic, such as deep
  research, document review and slide decks.

## 4. What the routing literature says

Signals that predict when a stronger model helps, from strongest to weakest:
1. **Checked outcomes** (tests, executable checks, answer checkers). With a reliable
   checker, cascades come close to a router that knows the answers in hindsight
   (RouterBench; Dekoninck et al., ICML 2025). Cascades degrade once the checker's error
   rate passes about 0.1-0.2.
2. **Evidence from partway through the task**, after the cheap model has explored
   (SWE-Router, 2026). A router that sees only the task description has a limited
   ceiling.
3. **Token-level uncertainty** with a learned deferral rule (Gupta et al., 2024).
4. **The model checking itself, or agreement across samples.** Helpful but unreliable
   (AutoMix, NeurIPS 2024).
5. **Features of the prompt alone.** These are weakest under shifted data (Kassem et al.,
   EACL 2026) and can be gamed: appended "confounder gadgets" send 88-100% of queries to
   the strong model (Shafran et al., 2025).

In agent loops, handing a task up to the stronger model mid-way recovers less than half
the quality gap, at extra cost, while handing it down is efficient ("The Handoff Tax",
2026). A learned one-way handoff did best in simulation (TACIT-Switch, 2026). Changing
the thinking setting can invalidate a provider's prompt cache, and OpenRouter and
Cloudflare penalise model switches for that reason.

Comparable routers:

| Router | What it routes on | Runs locally | Licence |
|---|---|---|---|
| RouteLLM (LMSYS) | The prompt alone, trained on Arena preferences | Yes | Apache-2.0, idle since 2024 |
| vLLM Semantic Router | 13 signal types combined by rules | Yes | Apache-2.0 |
| Arch-Router-1.5B / Plano | Policies the user writes | Yes | The model needs a commercial licence |
| Not Diamond | Reward and cost predicted per step | No (hosted) | Proprietary |
| OpenRouter Auto | The Jev decision model; prefers changing effort to changing model | No (hosted) | Proprietary |
| LiteLLM auto-router | Complexity tiers | Yes | Mixed |
| Cloudflare Auto | Task categories; a switching penalty that grows with context | No (hosted) | Proprietary |

Cloudflare reports its own results: 86.6% success against 96.6% for Opus, at about 35%
of the cost, with intervals of ±3-7 points.

## 5. What SOAR borrows

The verifiers checked each item against the repository; this session re-checked the
gaps at `main` 9d10b9a. Where each item lands is recorded in
BL-20261113-0730-rayline-evaluation-plan-adjustments.

| # | Pattern | Rayline origin | SOAR gap | Where it lands |
|---|---|---|---|---|
| 1 | Record the selected model next to the served model | The usage page; Raydock's receipts keep the decision model and the executed model apart | `model.ts:406` returns `servedModel`, but `runner.ts:610-612` records only the finish reason and usage. #79's assist record has no field for it. `registry-row.py:504-508` reports the configured model | Items 10.b and 11, before E3's first source freeze |
| 2 | Check the endpoint's identity and context window | Raydock reads the window from vLLM's `max_model_len` and refuses unknown models | The doctor reads only model ids (`setup-general.ts:81-83`), and `ready` (`:114`) ignores both the window and the card | Before E0; touches no file of an open pull request |
| 3 | Thinking budgets and probability-scored typed questions | The thinking budget in Routes and its effort mapping; the Decisions API's typed questions | A local plan attempt spent its whole 8,192-token budget on reasoning (BL-20261101-0036). The judge's support rates do not separate accepted from rejected drafts. No judge fixture exists | E0 card (#47): a planner sequence condition, a conditional low or budgeted condition, a logprobs probe, judge cells J1 and J2, and a labelled set with planted negatives |
| 4 | State the uncertainty Rayline omits | Rayline's missing intervals and baselines | E3 decides on 3 tasks × 2 repeats, with one run of D | E3 card (#63): a help table, posteriors, and the runs that would flip eligibility |
| 5 | Egress allowlist that pairs each key with its host | Raydock allows its decisions URL only on the exact Rayline host or loopback, and keeps keys from the harness | `buildCloudArm` pins only Anthropic. The two OpenAI request shapes accept any HTTPS host, key included (`private-agent-local-screen.ts:282-288`); so does the consultant (`consultant-config.ts:51-59`) | New backlog item 17 |
| 6 | Loopback gateway with tokens | Raydock's token-gated loopback gateway, which withholds credentials | E4's judges are capped at USD 6, against an estimated 7.6, and neither meters itself | Decision 5's open part (#61, question 3) |
| 7 | Per-recipient data modes | Rayline's standard, contributor and zero-retention modes | Decision 6's research compares prices, not retention | Addendum to #59 |
| 8 | V × p − cost as a description | ARC's policy | The owner settles trade-offs by hand | Optional: E4 card and decision 2 |

What the verifiers changed:
- **Item 4.** A hindsight-oracle "router headroom" measure was dropped. Simulating three
  identical arms at two repeats shows 0.7-1.2 accepts of invented headroom. The ratio of
  accepts to D was also dropped, because D runs once per task.
- **Item 3, J1 and J2.** Only today's JSON judge (J1) can activate criteria 3 and 8 for
  E3, because the judge code is inside the source-freeze hash. The probability-scored
  form (J2) stays descriptive. Calibration needs planted negatives: real claims are
  mostly supported.
- **Item 3, the sequence condition.** Today's code sends the model's default thinking
  setting on both plan attempts. "Attempt 1 with thinking off" is v5's design, waiting
  on item 7(a), so the fixture condition tests that design.
- **Item 3, the thinking ladder.** A per-turn "reasoning ladder" for the writer was
  dropped. Rayline's own guidance treats a thinking change as a cache boundary, and lost
  prefix reuse costs local wall time.
- **Item 6.** Both pinned judges already read `OPENAI_BASE_URL`, so no patch is needed.
  RACE sets `max_completion_tokens` to 64,000, so reservations must use that figure. The
  SDK's own retries add attempts that must each be reserved. Replaying replies during
  scoring would defeat the judges' retry-on-invalid loops; replay is for an explicit
  offline re-score mode only.
- **Rejected:** a one-command, resumable E0 runner. It would break the rule of one card
  per probe run.

## 6. What SOAR does not copy

- **Hosted routing of any kind** (Generation, Routes, Decisions, Raydock hybrid). It would
  be a new egress destination, it reads far more than SOAR's sealed packets carry, and it
  keeps data up to 30 days by default. Even in shadow mode, the Routes reply carries no
  probability or expected cost.
- **ARC's open weights as a local shadow router now.**
  - The runtime is incomplete, and the model is not calibrated for SOAR's endpoint.
  - It is trained on another product's traffic, and E3's three tasks cannot calibrate it.
  - If a learned signal ever becomes worth having, SOAR's own paired labels and a small
    in-process model over host counts would be simpler and private.
- **A router or gateway as decision 6's provider.** Hidden upstream retries and fallbacks
  break at-most-once dispatch. A per-request upstream breaks the fixed-rate reservation.
  E3's zero-cache-write proof would come to depend on the gateway.
- **Escalation before a verified local failure** (prompt-feature routers, a prefer-local
  probability threshold, Raydock's handoff when the context overflows). These are the
  weakest signals, they can be gamed, model-judged triggers are on the stop list, and
  sending overflow to the cloud contradicts "local does every volume stage".
- **Per-turn model switching or exploration on owner jobs.** Switching models drifts the
  session's identity, which a resumed session refuses as `session_contract_drift`, and
  it pays the handoff tax. Exploration sends bytes to destinations the owner did not
  choose.
- **Cache-aware switching, or cache writes on assist packets.** Assist packets are
  stateless one-shots. A write pays back only if more than about 26-28% of T2 calls
  retry.
- **Rayline's headline arithmetic.** Report each task with both aggregations, run counts
  and wall minutes; never show local work as "0% of cost".
- **Code dependencies on Raydock, `vllm-arc`, the semantic-router fork or ARC's
  personal-data head.** They are young and change fast: on 2026-11-10 a retired model id
  broke an integration. The personal-data head does not locate spans.
- **Raydock in front of the owned endpoint during E0-E4.** It would distort E0's
  measurements. Its `--local` mode keeps the main agent on cloud Claude, and its proxy
  mode injects a local certificate authority.
- **Workshop as a helper or baseline for site and deck jobs.** Its privacy terms are weak,
  and a cloud app builder answers no pending decision.

## 7. Open questions and when to revisit

Revisit the "adopt nothing" decision only if one of these happens:
- a local decision service ships and an independent evaluation on non-coding work
  appears;
- SOAR holds the evaluator-backed trajectories that `docs/ROUTING_POLICY.md` requires.

Open about Rayline:
- what hybrid mode's "execution context" contains, and how long it is kept;
- whether the 30-day retention covers Routes;
- who the sub-processors are, and in which regions data is processed;
- per-token rates, and whether per-turn decision fees cancel the savings of local turns;
- when hosted routing will track conversations;
- whether Workshop Arena votes train ARC.

## 8. Calibration against the report itself (2026-11-13)

The session read the report from the copy the owner supplied: all 23 pages of text, and
Figures 1, 6, 8, 9, 11, 12 and 13 as rendered images. It checked them against this
document and against BL-20261113-0730-rayline-evaluation-plan-adjustments.

**Confirmed.**
- The utility rule, the V presets, and prices applied at decision time without
  retraining (§2.2, Appendix A).
- About 90% of the training weight is Workshop traffic, with opted-out users excluded.
  Corpus and training system stay proprietary (§4.1, Appendix C).
- The per-benchmark results and costs in §3 above, priced at OpenRouter market rates.
  The only single-model baselines are Opus 5.5 and Haiku 5.5. No intervals or run
  counts are given, and no held-out split is stated.
- Sage's 97.4% reproduces as the mean of Figure 8's per-benchmark ratios.
- The selection shares (Figure 13) and the question head's results (Figures 11 and 12).
- The switching charge and the fail-closed rule for unknown prefixes (Appendix A.2), and
  steering reasoning by private appended text where a native setting would break the
  cache (Appendix B).
- The evaluated policy uses only the success and usage predictions; no routing by data
  sensitivity was evaluated (§2.1).

**Corrected.**
1. The evaluation held one model per task but chose the reasoning level on every call
   (§2.3). Only mid-task model switching was untested. The earlier "only one model per
   task was evaluated" undersold what ran.
2. The prefer-local 97.5% headline is an unexplained aggregate, not a mislabelled bar
   (Figure 9's labels are consistent).
3. ARC is a 0.8B decision model in the report's words, 615M parameters by the Hugging
   Face metadata.
4. The report describes an on-device decision service for Raydock (Appendix B) that has
   not shipped.
5. The outside-calibration notes (kept outside Git) put the local model at about 2% of
   GPQA tasks. Figure 9 shows 51.4% on GPQA and 2.1% on MMMU-Pro Vision.

**New, and relevant to SOAR.**
- **Three separate events.** §2.3 separates refreshing a prediction, reconsidering a
  choice and actually changing it. That is the shape of SOAR's model-judged signals,
  which are recorded on every run and fire nothing until calibrated.
- **Reasoning control is part of Rayline's evaluated setup.** That supports measuring
  thinking levels at E0 (plan item (c)). The report isolates no effect for it.
- **Missing evidence stays missing.** The usage head learns from calls that have no
  outcome without inventing a quality label (§4.3.4), and labelling functions abstain
  when their evidence is absent (§4.2). This is the same discipline as SOAR's
  upper-bound labels.
- **A Qwen model is represented, not evaluated.** Figure 6 places a Qwen3.8-27B vector
  among the candidates. The report evaluates no local model other than DeepSeek V4.1
  Flash, and Raydock's docs call its Qwen decisions uncalibrated.
- **Swift saves little.** Swift saves only 10-15% against Haiku 5.5, at equal or lower
  success (Figure 8).

**Effect on SOAR's decisions: none.** "Adopt nothing" stands, as do the router bars and
plan items (a) to (h). PR #86 (commit 2dd2de9) refines the entry's wording on the
evaluated configuration, the on-device path, the model size and item (a)'s window
floor.

## Sources

Rayline: https://rayline.ai, /arc, /decisions, /raydock, /pricing, /about, /privacy,
/terms and /solutions/{ai-application-developers, engineering-organizations,
hybrid-cloud-edge-agents, routing-developers}; https://static.rayline.ai/rayline/reports/arc/latest
(the 23-page report PDF dated 2026-11-10); https://docs.rayline.ai (the arc/quickstart,
models, dynamic, routes, reference/routes, routes/applying-effort, routes/hybrid,
concepts/caching, decisions-api, open-source, platform/data-privacy, platform/usage,
raydock/local-models, raydock/connections and workshop pages);
https://huggingface.co/rayline-ai/ARC-1.0 (README, config, provenance, presets and
CHANGELOG); https://github.com/rayline-ai/raydock (README, docs/hybrid-routing.md,
docs/hybrid-local-setup.md, SECURITY.md); https://github.com/rayline-ai/vllm-arc;
https://github.com/atlasfutures/semantic-router; https://workshop.ai.

Independent: https://news.ycombinator.com/item?id=48448372;
https://openrouter.ai/blog/announcements/model-router-benchmarks/;
https://openrouter.ai/docs/guides/routing/routers/auto-router;
https://blog.cloudflare.com/auto-router/; https://github.com/lm-sys/RouteLLM;
https://github.com/vllm-project/semantic-router;
https://huggingface.co/katanemo/Arch-Router-1.5B; https://docs.litellm.ai/docs/auto_router/benchmarks.

Literature: RouterBench https://arxiv.org/abs/2403.12031; Hybrid LLM
https://arxiv.org/abs/2404.14618; FrugalGPT https://arxiv.org/abs/2305.05176; AutoMix
https://arxiv.org/abs/2310.12963; Dekoninck et al. https://arxiv.org/abs/2410.10347;
Jitkrittum et al. https://arxiv.org/abs/2307.02764; Gupta et al.
https://arxiv.org/abs/2404.10136; Kassem et al. https://arxiv.org/abs/2504.07113;
Shafran et al. https://arxiv.org/abs/2501.01818; RouterEval https://arxiv.org/abs/2503.10657;
SWE-Router https://arxiv.org/abs/2607.00053; "The Handoff Tax"
https://arxiv.org/abs/2608.24358; TACIT-Switch https://arxiv.org/abs/2608.27911;
MTRouter https://arxiv.org/abs/2604.23530.
