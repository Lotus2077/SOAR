# Experiments

This folder holds the committed, sanitized record of live trials (see
[PLAN.md](../PLAN.md) section 4):

- `registry.jsonl`: one JSON object per run.
- `serving-card-*.md`: measured behaviour of the inference endpoint. The 2026-09-28
  card was written by hand from the probe JSON; later cards are printed by
  `scripts/serving-card.py` from a `scripts/serving-probe.py` result (probe version
  2: P1-P11 and the adapter probe), reviewed by the operator and then committed. The
  writer keeps the alias, engine version, context and transport class, never the
  address, and refuses any address-like string.
- `serving-card-*.json`: the machine-readable serving card, `kind`
  `soar_serving_card` and `version` 1, written by `scripts/serving-card.py
  --policy-out` from the same probe result as the Markdown card. It holds the
  identity, the probe's digest and probe names, the policy values research code may
  read, and the evidence behind them; it never holds an address, a path or a key.
  - **Probe in one run.** Run P1, P10, P11 and the adapter probe in one
    `serving-probe.py` invocation, after `pnpm probe:export-schemas` and before
    `pnpm probe:assess`. Serve the model under `--served-model-name`: the writer
    refuses a path-like alias.
  - **The writer's proposals.** The writer marks the card `proposed`. It proposes
    structured output by the 95% rule on the requested variant (at least 20 assessed
    calls), the role export's caps and thinking (the pipeline's own, unless the export
    was given a plan cap), K 1 and admission `none`. The Markdown's P10 verdict keeps
    its older wording (no 20-call minimum, no protocol check); the JSON is
    authoritative.
  - **A plan cap for the probe** (topic 6,
    BL-20261117-1000-p10-plan-cap-export-design). `pnpm probe:export-schemas --
    --plan-cap <tokens>` builds both of P10's plan cells at that cap, from 128 to
    16,384 tokens, and records it as the export's `outputTokens.plan`. P10 records
    each cell's cap from the body it sends, and the probe copies the export's caps,
    so the writer proposes the planner's two attempts at the cap its plan cells
    measured. The reader can then resolve a plan flag at that cap. Without the
    option the export is unchanged. The command refuses any other argument, so a
    mistyped option cannot export the pipeline's 8,192 for a re-probe meant for
    another cap. Neither the research protocol hash nor the source freeze depends on
    the option.
  - **P10's request settings**
    (BL-20261114-2301-serving-card-request-settings-design). The card copies the
    settings the role export built P10's bodies under (`evidence.p10.requestSettings`:
    the model, `SOAR_STREAMING`, the Flash reply contract and its context, the heavy
    profile and the cache salt). The reader refuses a structured-output flag
    (`serving_card_p10_settings_drift`) unless they equal the run's, `--cache-salt`
    included, and a card that records none binds no flag; the writer then proposes
    none. A card without flags is not compared. A flagged card binds only salted
    runs (`--cache-salt` true, the default), because the export always salts: run
    the unsalted arm with an all-default card or without the pair. After changing
    the model, the reply contract or its context, or `SOAR_STREAMING`, re-export,
    re-run P1, P10, P11 and the adapter together, and adopt a new card.
  - **Adoption** is a reviewed commit that sets `decision` to `{status: adopted,
    entry: <the BL entry that records E0's result>}`. It is made only once that
    entry's ID is final on `main`, since IDs are re-stamped at merge. The owner then
    computes the sha256 and sets the pair `SOAR_SERVING_CARD_FILE` and
    `SOAR_SERVING_CARD_SHA256` in the ignored `.env.local`.
  - **Audit.** A reviewer re-runs the writer on the retained probe with the same
    `--date` and checks `probe.sha256`: only `decision`, `roles`, `concurrency` and
    `admission` may differ.
  - **Only adopted cards are read.** Every value a card sets is now read: 7b.3
    consumed the last one, admission.
  - **Admission is read since 7b.3** (BL-20261117-1022-research-card-admission-design).
    Under `admission.basis: serving_card` the reader derives rates from the card's
    evidence:
    - P11's fastest and slowest prefill and decode;
    - the decode of the K burst for K above 1;
    - P10's mean completion tokens for plan, extract and synthesis.

    It refuses the card with `serving_card_admission_unmeasured` when any rate is
    missing. Before any request, the reading stage then:
    - keeps room for max(1, ceil(chunks/4)) repair calls inside the extraction
      budget, so at most 32 chunks, or ends `research_mandatory_budget_exceeded`;
    - ends `research_infeasible_in_clock` when even its expected (lower-bound) time
      exceeds half the session's remaining clock. Without a session deadline it
      never ends on the clock. The share is used only in that test: an admitted
      stage may still use the whole remaining clock.

    summary.json records the admission, including the expected and cap-bound
    estimates. The protocol hash binds the admission policy, the session identity
    binds the rates, and freeze.json's pipeline block names them. With admission
    `none`, nothing changes, and summary.json has no admission record.
  - **A second repair under the same basis** (item (ii),
    BL-20261117-1049-research-second-repair-design).
    - **What it does.** Under `admission.basis: serving_card`, a chunk still
      unfinished after its one repair gets one more, at the role policy's second
      attempt slot, while extraction calls are left.
    - **What records it.** coverage.json (version 4) holds that chunk's three
      attempts. The extract row counts `secondRepairCalls` and
      `secondRepairsComplete`. A chunk the second repair saved has three attempts,
      the last `complete`; one it did not save has three, the last not `complete`.
    - **It moved the default research protocol hash** for every run, so it was
      re-pinned. A card whose P10 evidence predates it is refused for protocol
      drift until P1, P10, P11 and the adapter are re-run.
  - **Caps and thinking are read since 7a.2** (BL-20261116-1203-research-role-policy-design).
    The research stage sends each local role's attempts the card's caps and
    thinking: attempt 1 is a role's first call, attempt 2 its repair or second
    call. A cloud planner or synthesiser keeps today's values. The run is refused
    before any request (`research_role_policy_invalid`) when a cap exceeds its role
    model's limit, or when a synthesis attempt's length ceiling falls below 100
    words. A non-default policy changes the research protocol hash, the session
    identity and freeze.json's pipeline block. Without a card, nothing changes.
  - **Structured output is read since item 9**
    (BL-20261116-1208-research-structured-output-design). A local plan, extract or
    synthesis call whose effective thinking mode the card flags sends the body it
    would send without the flag, plus `response_format`: the role's schema under
    P10's name, and `strict: true` for the strict variant. One more value differs:
    a flag changes the research protocol hash, which a synthesis payload carries in
    `coverage.protocolSha256`. Thinking counts as off when the attempt or the role
    model disables it. Index, a cloud role and the assists never send it. The
    reader refuses a flag when an attempt that would send it has another cap than
    its P10 cell measured (`serving_card_structured_output_cap_unmeasured`). A flag
    also changes the session identity and freeze.json's pipeline block, and a stage
    row counts the calls that carried it (`structuredOutputCalls`). Without a card,
    nothing changes.
  - **K is read since 8.2b** (BL-20261116-1213-local-fanout-design). The research
    index and extraction loops and the claims judge run K calls at a time when
    their model is zero-risk local (every rate zero, on a `local_model`), and one
    at a time otherwise. Replies are applied in item order, so while no call is
    denied or fails, a stage's counts, files and request bodies are the serial
    loop's. When one is, K above 1 may already have sent calls the serial loop
    would not, may end the stage on another call's denial, and keeps the judge's
    verdicts from calls already in flight. The reader accepts K from 1 to 8, and
    refuses a K above 1 without a P11 burst at that K with no errors
    (`serving_card_streams_unproven`). K stays out of the research protocol hash
    and the session identity, and freeze.json records it. P11's bursts carry no
    `response_format`, so a structured-output flag at K above 1 is unmeasured. The
    owner's zero-fee run that verifies K above 1 (ASSIST-S4) therefore uses a card
    that flags extract for its extraction calls' thinking mode, so that the
    extract row's `structuredOutputCalls` is above 0.
  - **What the gates do not show.** The reader binds P10 evidence to the current
    research protocol hash: after any change to it (backlog items 7(a) part 1,
    7(b) and 7(c) in the plan), re-run P1, P10, P11 and the adapter together and
    adopt a new card. Since P10-align (BL-20261113-1011-p10-align-design), each
    P10 cell sends the pipeline's own request body for its role and thinking
    mode. `pnpm probe:export-schemas` builds those bodies with the model layer
    under the desktop's settings (`.env.local`). The probe only adds
    `response_format`, and it reads a streamed reply as events. A passing cell
    still shows nothing about requests without `response_format`, which is what
    an unflagged call sends. It also shows nothing about real corpus sizes or
    repair requests, since the payloads are synthetic and small. Re-export after
    changing those settings: the probe refuses an export for another model, and
    the reader refuses a flag measured under other settings. What stays unbound
    is how a body is built from those settings: the model layer's construction of
    it, the heavy profile's values in `COORDINATOR_PROFILES.heavy` (its sampling,
    thinking and output cap) and `buildLocalScreenModelConfig`. A change to any of
    them changes P10's bodies without moving any recorded value, so a PR that
    makes one must state that it invalidates earlier cards' structured-output
    evidence. The recorded `profile` is the constant `heavy` on both sides, the
    only profile research runs under. The K bursts use a one-sentence prompt and
    show decode concurrency only.
  - **The run record.** `freeze.json` records `servingCard {sha256, version, date,
    entry, localStreams}`, and the run directory keeps `serving-card.json`. A
    refused card leaves no run directory. The driver's and the loop's failure
    lines, and the loop's `log.txt` and `errors.txt`, name the refusal's code and,
    except for a file-level refusal, its key path.
- `e0-planner-fixture-v1.json`: the hashes-only manifest of the E0 planner fixture
  (`scripts/planner-fixture.ts`): the exposed r3 index, its brief and source ids by
  sha256, the chunk count and the proposed 3 x 10 design. It was a template until
  2026-11-16, when it was pinned under E0 card Amendment 1
  (BL-20261116-0814-e0-card-amendment-1); the index and the brief stay under the ignored
  `.soar/`.
- `e0-planner-fixture-v2.json`: v1's pins, with two structured conditions beside
  `legacy-thinking`, the call without a card. `legacy-thinking-structured` is the
  serving card's plan call: the strict `research_plan` response_format item 9 sends,
  with thinking on, at 8,192 tokens. `legacy-thinking-structured-16384` is the same
  request at 16,384 tokens, a calibration cell: no card can send it until P10
  measures plan at 16,384, which an export built with `--plan-cap 16384` lets it
  do. That makes 10 repeats and 30 calls
  (BL-20261116-1253-e0-planner-structured-condition-design). Each of the conditions
  and the repeats comes from the manifest unless its own flag (`--conditions`,
  `--repeats`) is given, and each repeat runs every condition in turn. With
  `--cache-salt` every body carries the fixture's one salt, on every repeat; without
  it, none does.
- `e0-judge-fixture-v1.json`: the hashes-only manifest of the E0 judge fixture
  (`scripts/judge-fixture.ts`). It holds the claim set's and the labels' sha256, the
  claim, class and planted counts, the card's agreement measure and level, and the
  per-class minimum, conditions and repeats from the card's amendment. It was a template
  until 2026-11-16, when it was pinned under E0 card Amendment 2, item 3
  (BL-20261116-1013-e0-judge-labelling-and-pin).
  [E0_JUDGE_LABELLING_PROTOCOL.md](E0_JUDGE_LABELLING_PROTOCOL.md)
  says how the claims are harvested, labelled by a cloud model through its API, planted
  and pinned; `pnpm label:judge` (`scripts/judge-labeller.ts`) sends the labelling
  request. The claims and the labels (evaluator gold) stay under the ignored
  `.soar/`.
- `e0-extractor-fixture-v1.json` and `e0-extractor-fixture-v1/`: the pinned manifest
  and the committed corpus of the E0 extractor fixture (`scripts/extractor-fixture.ts`,
  `pnpm fixture:extractor`). The corpus is a five-requirement brief, a plan the
  pipeline's plan assessor accepts, and three invented, public sources, each one chunk
  of the pipeline's chunking; the manifest binds every file by sha256 and byte count.
  The fixture sends the extraction stage's own request under the manifest's four
  conditions: `thinking-off`, the stage's call as deployed today, and thinking on at
  2,048, 8,192 and 16,384 output tokens. It judges each reply with the stage's own
  checks (`assessResearchExtractionReply`). It holds no gold: no reply is scored
  against an expected answer.
- `e0-extractor-fixture-v2.json`: v1's corpus and pins, exposed now that v1's run has
  seen them. It pins `thinking-off` beside `thinking-off-structured`, the serving
  card's extract call: the deployed call with the strict `research_extraction`
  response_format item 9 sends. That makes 10 repeats and 60 calls
  (BL-20261116-1256-e0-extractor-structured-condition-design).
- Experiment cards, one per batch: hypothesis, arms, budget, decision rule and stop
  rule.
- `LAUNCHER.md`: how a card's batch runs under `scripts/experiment-launcher.ts` (plan
  11.5): the queue, the windows, the idle check, the batch cap, the supervision and
  the launcher's ledger.
- `phase2-tasks-v1.json`: the hashes-only manifest of the frozen Phase 2 tasks (task
  ids, families, driver modes, job, brief, input and gold-file SHA-256 values, check
  counts). The tasks, gold, hidden suites and scorer stay under the ignored `.soar/`.
- `phase4-tasks-v1.json`: the hashes-only manifest of the three fresh Phase 4 research
  tasks for H5 (same fields, plus the scorer and checks versions), authored by a separate
  session; tasks, gold and scorer stay under the ignored `.soar/experiments/phase4-v1/`.

The following stay outside Git, under the ignored `.soar/experiments/`:

- the launcher's state directory: its `launcher.jsonl` ledger, its STOP file and each
  run's output;
- raw outputs, traces and databases, including the probe results and the raw model
  replies the probes and fixtures retain (`serving-probe-*/`, `e0-planner-fixture-*/`,
  `e0-judge-fixture-*/`, `e0-extractor-fixture-*/`, `role-schemas.json`), and the
  judge fixture's claim set and labels (`e0-judge/`);
- task gold data and endpoints;
- anything derived from personal or professional data.

## Current Phase 4 record

[Phase 4 experiment record through November 5](PHASE4_EXPERIMENT_RECORD_2026-11-05.md)
links the recovery, calibration, serving qualification, pilot and research-trial
sequence to the append-only build log. It separates standalone request accounting,
historical H4 attempts and Claude calibration charges, including failed and
unresolved outcomes. H4/H5 acceptance remains unestablished.

## Registry row

| Field | Meaning |
| --- | --- |
| `id` | Unique run id, for example `p0d-t1-website-heavy` |
| `date` | UTC date |
| `git` | The commit the row names, its first 12 hex digits: the commit the run executed when `gitSource` is `run` or `runs_differ`, and otherwise the commit the row was written at. Once backlog item 11's part 2 merges (BL-20261109-0422), the driver records the run's commit in its `freeze.json` (`git.commit`) at the run's start; a `--run-dir` row takes it from there and a `--loop-dir` row from the selected run's. A row whose run recorded none, a `--verdict-file` row, and a `--supersedes` row of a row whose `gitSource` is not `run` or `runs_differ` hold the writing commit. Rows without `gitSource` hold what their writer recorded: the writing commit for rows `registry-row.py` wrote, and the original's or the run's commit for at least seven hand-written rows (the five superseding rows and the two `p4-claude-shape-20261031` rows, whose 40 hex digits are the run's commit) |
| `gitSource` | Where `git` came from, on every row written once that change merges: `run` (the run's freeze; for a loop, every run directory's freeze records the same commit), `runs_differ` (a loop whose run directories do not all record the selected run's commit; the loop refuses stages of another runtime hash, so the difference lies in files outside the source freeze, or a run's git could not be read) or `row_written` (the commit the row was written at) |
| `gitDirty` | Whether a checkout of `git` would not reproduce the frozen sources when the run started: the repository's clean test failed (anything staged, unstaged, or untracked and not ignored by the repository's own rules; the user's global ignore file is not read, as in scripts/verify-release-head.ts), an index entry is one the status does not compare (skip-worktree, assume-unchanged, a sparse checkout), or a frozen file's bytes were not the ones the source freeze hashed or not its committed blob. `false` means the commit reproduces the run's `sourceFreezeSha256`, since a checkout writes blobs unchanged under this repository's `.gitattributes`. A repository with a configured filter command records `git: null` instead of running it. A loop row is `true` if any stage was dirty and `null` if any stage's state is unknown; `null` on `row_written` rows |
| `batch` | Experiment card or batch name |
| `task` | Task id; `taskJobSha256` binds the exact inputs |
| `family` | research, document_review, website, deck, admin, coding or audit; `serving` on a serving-probe row (`--probe-dir`), which has no task family |
| `exposure` | `fresh` (never seen by any run or prompt tuning) or `exposed` |
| `arm` | Route and profile, for example `local-standard` or `local-heavy` |
| `profile`, `thinking`, `maxOutputTokens` | Coordinator profile the run was frozen with |
| `cloudModel`, `cloudApi` | The cloud model and request shape (`openai`, `openai_responses` or `anthropic_messages`) from the freeze's cloud arm (`freeze.arm.modelConfig`), or `null` on local runs; a loop row takes them from sample `a`'s own freeze when the loop's arm is `cloud`, or, once backlog item 11's part 3b merges, from `a.infra-1` after a seeded-writer resume of `a` (`stage_run` in `registry-row.py`). Rows before BL-20261030-0620 omit both fields |
| `researchProtocolSha256`, `servingCard`, `localStreams` | From the run's freeze (BL-20261116-1358-run-row-card-and-doctor-sources-design): the research protocol hash under the card's role policy (`freeze.pipeline.protocolSha256`, which structured-output flags, caps and thinking change; `null` without a research pipeline); the serving card the driver loaded, `{sha256, entry}` (its sha256 and the build-log entry that adopted it; `null` without a card); and ASSIST-M2's K, the card's `localStreams` (1 to 8), or 1 when the freeze records none, since the driver gives a session K only from a card (a session runs K calls at a time only on a zero-risk local model). A loop row takes them from the run it takes its other run fields from; a stopped loop whose stage froze nothing records all three as `null`, K included, since nothing recorded it. A present value of another shape refuses the row. Rows before this change omit all three |
| `modelCalls`, `toolCalls`, `wallSeconds` | Counts from the run's own ledger. Model calls cover the writer and any research pipeline, plus the critique on loop rows; the separate entailment pass reports its calls under `entailmentCalls`. Wall time includes that pass |
| `activeSeconds` | Loop rows written once backlog item 11's part 3b merges (BL-20261113-0836): the time the loop's stages ran. It sums the spans the loop recorded (`stages`, and each resume entry's span), plus, for a stage whose process died before the loop recorded its end, the time from its begun time to its last dispatch commit. The wait between a loop's invocations is left out, so a resumed loop's `wallSeconds`, which keeps its meaning, can be much longer. `null` for a version-1 loop |
| `inputTokens`, `outputTokens`, `cachedTokens`, `cacheWriteTokens`, `lengthStops`, `usd` | Tokens and length stops cover the same calls as `modelCalls`, excluding the separate entailment pass; `usd` sums dispatch fees (local is zero-fee). `cachedTokens` is the part of `inputTokens` the provider reported as served from its prompt cache (summed `cacheReadTokens`, 0 when absent; rows before H1 omit the field). `lengthStops` counts writer replies, research-stage `truncatedReplies` and loop critiques cut at the output limit; historical pipeline rows have the limitation below. `cacheWriteTokens` is the part of `inputTokens` the provider reported as newly written to its cache (summed `cacheWriteTokens`, billed at the write rate); 0 means unrecorded for every run before BL-20261022-1156 including the H1 first attempt |
| `entailment` | Research tasks with a claims ledger: the host's entailment counts, `entailmentCalls`, `truncated` and `supportRate` (supported / (supported + partial + unsupported + contradicted), excluding `not_judged`; `null` when no claims were judged), or `null` for no pass. The signed balance rate that selection protocol 1 compared, and protocol 2 records in `loop.json` as evidence only, is a separate metric. A local-model judgement is evidence, not acceptance |
| `hostFlags` | Rows written once backlog item 7(d)'s part C merges (BL-20261114-1246): the run's `host_flags` event (7d.B, BL-20261110-1516) without its positions (no hit lines, flag positions or edit ids). It holds `version`; `rules`, the rule sets that ran (`absence`, `review`); and `counts`, which holds only the parts that ran, so an absent count is never a zero. When present, it also holds `misses` (the run's own misses), `errors` (the sections the host could not compute), the `report` and `argument` scan states (`format`, `scanned`, `reason`, `textCut`, `truncated`) and the `review` state (`valid`, `reason`, `errors`, `read`). Since 7d.D (BL-20261116-1200-host-flags-trimmed-counts-design), `misses` also holds `questionsTrimmed` (the questions whose verified quotes the packet's caps all left out, which `questionsWithoutEvidence` also counts), `quotesLeftByCap` and `conflictsLeftByCap` (the verified quotes and conflict notes the packet left out) whenever the run's event holds `questionsWithoutEvidence` and was recorded by code that includes 7d.D. A row whose event was recorded by earlier code lacks them, even when the row itself is written later, and that means not recorded, never zero. `null` means not recorded, never "no flags". That covers a run with no event (one that did not submit, a phase with neither check, a run from before 7d.B, a lost append), a run without a result, and every row written from a desktop verdict receipt, whose version 1 carries none. A loop row reads the run its other fields come from. Every kept value is a name, an enum value, a boolean, a non-negative integer or an error class name; a row whose event holds anything else is refused. Rows written before this change, and `--supersedes` copies of them, have no `hostFlags` key at all: an absent key is neither `null` nor "no flags". Flags decide nothing |
| `unknownDispatches`, `retriedDispatches`, `failedDispatches`, `assistSkippedDispatches`, `assistFailedDispatches` | Dispatch rows by outcome: unsettled rows (still `committed`, or `unknown`, never replayed); attempts a retry superseded; confirmed failures; and, counted apart since 2026-11-07 (backlog item 10), the sealed cloud one-shots (purposes `research plan assist`, `research synthesis assist`) whose row stayed `unknown` (skipped: its reservation stays pinned and no further grant-free cloud call is made in the job) or resolved `failed` into the host fallback. From that date an assist row is excluded from `unknownDispatches` and `failedDispatches`; rows before it omit the two assist columns. A skipped assist is not a model call (it has no reply), and its pinned reservation is not in `usd`, which sums settled fees; rows written once plan 11.4 merges carry it in `pinnedUsd`. On a loop row written once item 11's part 3b merges, `unknownDispatches` can include a zero-fee `committed` row of a run the loop moved aside: the local call in flight when that run's process died. The resume admitted it because sending equivalent work again costs nothing, and the row itself is never sent again, because the rerun is a new job |
| `zeroFeeFailedDispatches` | The part of `failedDispatches` that reserved and settled nothing (backlog item 11, BL-20261109-0331): `failed` rows other than assists to the two fee-free harness destinations (`owned_local_model`, `approved_public_snapshots`), reserved at exactly 0, with no fee key (or a fee of 0) and no approval key; a null fee or approval fails closed. These are the zero-fee local requests and public GETs the broker resolves `failed`. The H4 loop admits them and stops on every other failed row, so a loop row may now carry `failedDispatches` above 0 with a final selection. Only `--run-dir` and `--loop-dir` rows written once this change merges carry the column; earlier rows, desktop verdict-receipt rows and `--supersedes` copies of earlier rows omit it, and an absent column does not mean 0 |
| `reservedUsd`, `pinnedUsd`, `committedDispatches` | `--run-dir` and `--loop-dir` rows written once plan 11.4 merges (BL-20261114-1523): every attempt's reservation summed, in USD; the reservations still pinned by rows that stayed `committed` or `unknown` (store.ts's exposure: with `usd` it is the run's exposure, which the experiment launcher's batch cap counts, and it holds a skipped assist's reservation); and the rows still `committed` at the run's end, already counted in `unknownDispatches`. Earlier rows omit these and the columns below, and an absent column does not mean 0 |
| `cloudCalls` | The same rows: one object per cloud-model dispatch row in commit order, `{purpose, status, feeUsd, reservedUsd, bodyBytes}`. `feeUsd` is the settled fee, and null on a call that did not settle. A row written before plan 11.4 is a cloud call when its destination is `cloud_coordinator`, and its `bodyBytes` is null. On a loop row, the calls of all its runs are in commit order |
| `disclosedBytes` | The same rows: the bytes the run's requests disclosed, counted once per packet hash (HARN-27's default): none to a local model or a loopback URL, else a POST's body bytes or a GET's URL bytes, as the broker records them on each dispatch row. Null when any of the run's rows predates plan 11.4 |
| `urls`, `domains`, `retainedBytes` | The same rows: distinct retained public-source URLs (a loopback URL without its port, since each run's snapshot receiver listens on its own), distinct lowercased hostnames among them with a leading `www.` dropped and loopback hosts excluded (approximate: hostnames, not registrable domains), and the retained bytes. Counts only, never a URL or a hostname. Harness runs read approved snapshots from a loopback receiver, so their `domains` is 0: read `urls` and `actions.sourcesRead` there. On a loop row, URLs and hostnames are counted over the union of the loop's runs |
| `actions` | The same rows: `{tools, fetchReceipts, sourcesRead}`, the finished tool calls by the runner's tool names (`other` for any other name the model chose, or for a call whose start was not recorded), the retained public sources, and the sources the reading stage indexed (null unless a reading stage recorded the count; a loop row sums the counts its runs recorded), which is "read" on a closed corpus until item 12 revises it |
| `queries` | The same rows: null until item 12 |
| `researchFallback` | The same rows: `{plan, synthesis}`, `host_plan` or `none` and `skeleton` or `none`, from the reading stage's stage rows (backlog item 7(c)); null without a reading stage. On a loop row it comes from the run whose reading stage made the loop's packet (`stage_run`) |
| `outcome` | `accepted`, `rejected`, `incomplete` or `infra_invalid` |
| `runClass` | `--run-dir` and `--loop-dir` rows written once backlog item 11's part 3a merges (BL-20261109-0515): `{version, infra, cause}`, whether the run (for a loop, its selected run, with the loop's own interrupt mark) ended on infrastructure, from its recorded codes only (src/main/private-agent/run-classification.ts, mirrored in `registry-row.py`). `cause` is the host-side reason (`runtime_failure_progress_preserved` only when no uncertain cloud call's reply was refused), `model_unavailable` or `research_request_failed` (a failed call that cost nothing, failed transiently at the cloud, or left no failed row), a token-admission or broker code, `verification_unavailable`, `operator_stop`, or, on a loop row whose critique failed on infrastructure and left an unsubmitted draft, `critique_` and the critique's code; a public phase's end keeps the session's `public_` prefix (`public_model_unavailable`, for example); `task` or `submitted` otherwise. The writer refuses `--outcome rejected` or `incomplete` for an unsubmitted run whose `infra` is true, and `--outcome infra_invalid` for any other run; `accepted` stays allowed. A `--supersedes` row repeats these checks against the copied `runClass` when the copy carries one, so an owner's `rejected` on an unsubmitted infrastructure end is refused. `infra_invalid` counts as not accepted in an experiment's arithmetic unless a re-run flagged under the card's rule replaces it. Under version 1 a cloud call answered 429 with no recorded kind is transient: only the Anthropic arm records the spend-cap and spend-limit flags, so on an OpenAI-shaped arm a quota or billing refusal answered 429 is classed as infrastructure (BL-20261110-0723 adds this to owner question (d), to be answered before E3's card records version 1). From part 3b (BL-20261113-0836), a loop row can also have these causes: on a version-2 `critique_failed` or `repair_failed` loop whose draft did not submit, `critique_` or `repair_` and the stop's recorded infrastructure cause; on a loop whose repair ended on infrastructure and lost, `repair_` and the repair's own cause, in either version; and on the row of a loop that ended without a selection, the stop's class. That class is part 3a's for a stopped run with a result; `run_unfinished`, `stage_unresolved_dispatch` or `stage_failed_dispatch` for a run without one; the code of an integrity stop (`loop_stage_missing`, `loop_resume_spent`, `loop_stage_mismatch`, `loop_resume_mismatch`, `loop_stage_ledger_unreadable`); or `operator_stop` after the loop's own interrupt. Such a row is never `accepted`, and neither is a superseding copy of it. These rows carry `version` 1, whose run-end lists do not change |
| `terminalCause` | Why the run ended, for example `submitted`, `session_deadline`, `request_body_size_exceeded` |
| `criticalChecks` | Pre-written critical checks passed / total, or `null` |
| `verdictBy` | `owner`, `agent_diagnostic` or `none`; `registry-row.py` refuses any other value. Rows written before 2026-11-07 also carry the legacy values `host_gate`, `qualified_checker`, `qualified_checker+agent_screenshot_review`, `agent_diagnostic_blind` and free-text strings naming the checking model; they are historical and are never re-rowed |
| `verdictAt` | Optional UTC ISO 8601 instant of the verdict in `verdictBy`. `registry-row.py` writes it on every `--supersedes` row (default: the writing time) and on every `--verdict-file` row (the receipt's record time); `--verdict-at` adds it to any row |
| `supersedes` | The id of the row this row corrects; a superseding row repeats the original's measurements. `registry-row.py --supersedes ROW_ID` copies the row verbatim (every measurement, `taskJobSha256`, `date`, `usd`, `entailment`, `hostFlags`, `loop`) and changes only `id`, `supersedes`, `outcome`, `verdictBy`, `ownerMinutes`, `interventions`, `lesson`, `verdictAt`, `criticalChecks` when `--critical-checks` is given (a row without it gains it as `null`) and, unless the copied row holds a well-formed run-sourced commit (`gitSource` `run` with a boolean `gitDirty`, or `runs_differ`; kept with both once backlog item 11's part 2 merges, since the measurements are the run's), `git`, `gitSource` and `gitDirty`, which then record the commit the row was written at (`row_written`); `batch`, `task`, `family`, `exposure` and `arm` are copied unless re-declared. It refuses an unknown id, an id another row already supersedes and a new id that already exists. The five rows superseding before 2026-11-07 were hand-written and kept the original `git` |
| `calibrationGate`, `calibrationReviewedAt` | Optional calibration-only acceptance and review time, separate from the task's `outcome` and `verdictBy`; acceptance here does not supply a capability grade |
| `consoleChargeUsd`, `settledStep0And1Usd`, `consoleDifferenceUsd`, `consoleToleranceUsd` | Optional historical Claude step-0/1 reconciliation amounts; the Console display is rounded and the difference must fit the approved tolerance with no competing usage |
| `localJudgeProvenance` | Optional explicit description of the historical judge tier; never relabel old entailment counts after changing the local model |
| `ownerMinutes`, `interventions` | Owner effort (owner-run jobs only). With `verdictBy: owner` both are required: minutes as a finite number of at least 0, interventions as an integer of at least 0 (an edit pass counts as one, PLAN.md section 1). Other rows carry `ownerMinutes: null` and `interventions: 0` |
| `exportedThroughApp` | Owner rows written from a desktop verdict receipt only: whether the owner declared the deliverable exported through the app, an OAJ condition (PLAN.md section 1) |
| `lesson` | One line |
| `inputSha256`, `probe`, `fixture`, `labelling` | E0 rows only, written by `--probe-dir`, `--fixture-dir` and `--labelling-file` (BL-20261116-0839-e0-registry-modes-design); see "E0 rows" below. On those rows `modelCalls` counts every request the run made, answered or not: the mode object says how each probe or fixture request ended, and `failedDispatches` and `unknownDispatches` how each labelling request did |
| `loop` | H4 select-and-repair loop rows only (`scripts/phase4-loop.ts`, `registry-row.py --loop-dir`): `version`, `rule` (the selection protocol version), `samples`, `repaired`, `seeded` (whether sample `b` and the repair wrote from sample `a`'s evidence packet), `stage1` (the sample the host-checked selection chose), `selected` (the loop's deliverable: `a`, `b` or `repair`), `step` (the rule step that decided it), `critiqued` and `critiqueFailure`, `writeIdentityEqual` (whether the two samples' write phases carried the same identity) and `candidates` (every sample's own `status` and `terminalCause`, so the harness-terminal rate is computed per sample). The row's counts sum the loop's runs plus the critique's one call (from `critique.json`, or `critique-failure.json` when the critic answered and the tool refused the reply), `wallSeconds` spans the loop from its earliest start to its latest end over its runs, and status, cause, binding and entailment are the selected run's; the all-cloud arm has no loop and no such field. From part 3b (backlog item 11, BL-20261113-0836), a row of either version carries each sample's own `runClass` in `candidates`, classed with that sample's own interrupt mark. Version 2 adds these fields: `seeded.a` (sample `a` resumed as a writer seeded from its moved run); `resumes` (`[{stage, cause, as}]`, the stages resumed once at zero fee); `closed` (whether the operator ended the loop with `scripts/phase4-loop.ts --close`, at a stop or after stage 1); the `step` `repair_failed`; and, for a loop that ended without a selection, `stopped` (`{stage, failure, closed}`) with `selected` and `step` null. A stopped row's run fields are the stopped stage's run's when it has a readable result, else those its freeze records (status, cause and entailment null), else null ones with `date` and `taskJobSha256` from the loop. Its counts sum every run the loop made, found by one scan of the loop directory: its stages, every stage it moved aside (`<stage>.infra-1`), and every critique record (`critique/`, `critique.infra-1/`). A void start (`<stage>.void-<n>`) adds nothing, and a run without a readable `result.json` (none, or one torn by a crash) adds its ledger's counts; a critique record that cannot be read adds nothing. A version-1 loop's row also sums every run directory that an operator moved aside inside the loop directory under part 1. In either version each run is summed once per job, a stage's own directory before a copy of it. It is refused when `log.txt` records more finished runs than the directory holds. The writer refuses: a loop directory while a loop holds its `loop.lock`; a version-2 directory holding what its record does not name, unless the operator closed the loop (`closed`), in which case every run directory is summed; a run of another task or runtime than the loop's; a run with a readable freeze or a result whose ledger (`state.sqlite` and its tables) is missing; a version-2 record whose task, pipeline, begun entries, stop or closed mark is malformed; and a loop with neither a selection nor a stop (a version-1 loop is resumed; only a version-2 loop can be closed) |

Loop rows record the selection protocol in `loop.rule`; split them by it before comparing. Under rule 1, a stage-2 tie
went to the repair and `step` could be `entailment` (a balance-rate margin of at least 0.10); from BL-20261101-0436
(2026-11-01) a failed dispatch row other than an assist's also stopped a rule-1 loop, which earlier loops did not do. Under
rule 2 (backlog item 11, BL-20261109-0331), a tie keeps sample `a` over `b` and the selected draft over its repair, the
entailment rates decide nothing, and the loop admits zero-fee failed rows (`zeroFeeFailedDispatches`). A rule-2 `step` is
`submitted`, `checks`, `artifacts` or `tie`, or the loop's own ending (`stage_failed`, `no_draft`, `critique_failed`).
Under rule 2 a repair can change the outcome only when the selected draft did not submit.

Rows are append-only. Correct a row by appending a new row with `supersedes`
(`registry-row.py --supersedes`, above). The Claude step-1 reconciliation
correction updates calibration status only; its original `incomplete` task
outcome, absent capability verdict, measurements and old-local-judge entailments
are preserved. Exclude superseded rows from totals: a superseding row repeats the
original's `usd` and counts, so a naive sum counts them twice (review finding E11).

Research pipeline v5 (backlog item 7(c)) no longer ends a run on a rejected plan or
synthesis. A run whose plan or synthesis attempts were all rejected goes on with
the host fallback plan or the host skeleton argument, which state no finding, and
can submit. Rows written once plan 11.4 merges disclose the fallback in
`researchFallback`; earlier rows disclose it only in the packet: `coverage.json`
(`fallbacks`), the research stage rows (`fallback`) and the skeleton's first
sentence. Read those before crediting a v5 research row. v4 rows that ended `research_plan_invalid` or
`research_synthesis_invalid` keep that terminal cause.

A single run that the experiment launcher ran (plan 11.5) is rowed with
`--launcher-ledger STATE/launcher.jsonl` beside `--run-dir` (plan 11.4). The row's
run is found by its job id among the ledger's `run_exited` records, and exactly one
must match. A forwarded signal makes a `cancelled_or_deadline` end the operator's
stop (`runClass` cause `operator_stop`, so `--outcome infra_invalid`). Nothing else
from the ledger reaches the row. Without the flag, a single run's cancelled end
stays the task's.

## E0 rows: probe runs, fixture runs and the labelling call

E0 (docs/experiments/e0-card-2026-11-13.md) records one row per run of three producers
that have no harness run directory (BL-20261116-0839-e0-registry-modes-design). The
operator types `--id`, `--batch`, `--task`, `--family`, `--exposure`, `--arm`,
`--outcome`, `--verdict-by` and `--lesson`, as for a run row:

```sh
python3 scripts/registry-row.py --probe-dir .soar/experiments/serving-probe-<time> ...
python3 scripts/registry-row.py --fixture-dir .soar/experiments/e0-planner-fixture-<time> --fixture planner ...
python3 scripts/registry-row.py --fixture-dir .soar/experiments/e0-judge-fixture-<time> --fixture judge ...
python3 scripts/registry-row.py --fixture-dir <the extractor fixture's out directory> --fixture extractor ...
python3 scripts/registry-row.py --labelling-file .soar/experiments/e0-judge/labelling-<time>/summary.json ...
```

**Every E0 row:**
- `git` is the commit the row was written at (`gitSource` `row_written`), since no producer
  records one.
- `date` and `wallSeconds` come from the producer's recorded start and end.
- `profile`, `thinking` and `maxOutputTokens` are null. So are `cloudModel` and `cloudApi`,
  except on a labelling row.
- The row carries the three columns: `outcome`, `usd` with `reservedUsd`, `pinnedUsd` and
  `cloudCalls`, and `disclosedBytes`.
- Columns this section does not name are absent, which means not recorded.
- A row copies only:
  - digests, booleans and closed codes;
  - counts of at most 2^53 - 1, which a JavaScript reader holds exactly, sums included;
  - USD amounts of at most 1,000,000;
  - known exception class names;
  - the approved labelling model's id.
- It never copies:
  - the served alias or the engine version;
  - P10's binding, whose source ids are paths, or the request settings;
  - file or directory names;
  - reply, claim or label text;
  - error bodies or a provider's error codes or request ids;
  - a manifest's `name`.

  The fixture manifest's `task` and `exposure` are compared with `--task` and
  `--exposure`, not copied.

**`--probe-dir`** reads `probe.json` (scripts/serving-probe.py, probe version 2). Write the row
after `pnpm probe:assess`.
- **Refused:**
  - another probe version;
  - a record that shows neither a loopback endpoint nor
    `SOAR_VLLM_COST_POLICY=local_zero_cost`, the probe's zero-fee guard;
  - a finished run that neither ran nor failed a probe it selected.

  A NaN the probe wrote for a metrics reading is read past, since the row never copies it.
- **Spend:** `usd`, `reservedUsd`, `pinnedUsd`, `disclosedBytes` and `unknownDispatches`
  are 0, and `cloudCalls` is empty.
- **`modelCalls`:** the chat-completion requests that the completed probes' records show.
  - P11's K bursts count their streams.
  - The adapter's /tokenize call and the /models, /version, /metrics and /openapi.json reads
    are not model calls.
  - A failed probe keeps no record, so its calls are not counted. Neither are those of the
    probe in flight when an unfinished run stopped.
- **Tokens:** the token columns are null, because the probe keeps no complete usage.
  `probe.usage` sums the calls whose record keeps both prompt and completion tokens, and
  says how many calls that covers.
  - P5, P8, P9, P6's aborted stream, P10's acceptance checks, P11's K bursts and
    cache-layout requests, and the adapter's plain and cache-salt calls keep no such pair.
  - A stream that got no usage chunk is recorded by the probe as 0 and 0, and counts as
    covered.
- **`inputSha256`:** the sha256 of the canonical JSON of what P10 sent: each cell's
  exported `request_body_sha256`, the roles' `schema_sha256` and each cell's `strict`
  variant. It is null without P10, or without any of those.
- **`probe`:**
  - `version`;
  - `sha256` over probe.json's bytes, which matches the serving card's `probe.sha256`
    when both read the same file;
  - `protocolSha256`;
  - `selected`, `run` and `skipped`;
  - `failed`: each failed probe's exception class when it is on the writer's fixed list (the
    built-in exceptions and the probe's library classes), else `other`;
  - `finished`;
  - `assessed`, and `schemasProtocolMatch` from the assessment, both null without P10;
  - `calls` per probe, and `usage`;
  - `transportFailures`: the probes, in the probe order, whose records show a transport
    failure (BL-20261116-1217-serving-probe-direct-transport-design, as implemented). The writer decides from
    what each record holds, so a record written before this change is read conservatively:
    - a POST's `transport_error`, recorded with status -1;
    - a stream's `error` naming an exception class (a stream's HTTP error code is the
      server's answer);
    - a status of -1, as a GET records (P1's `models_status` and `version_status`, the
      adapter's `/openapi.json` status) and as the adapter's plain chat call records
      (`chat_status`), or a status naming an exception class, as a P11 cache-layout row
      records;
    - a P11 K burst whose `transport_errors` count is above 0. A record from before that
      count has none, so its `errors` count is read instead, which also counts a stream that
      reported no usage or no elapsed time;
    - a streamed reply that answered 200 with no finish reason, unless its `stream_end` says
      the server ended it (`done` at `[DONE]`, or `error` after an error event). A record
      from before `stream_end` has none, so such a reply counts. A P10 call classed
      `stream_ended_early` is one.

    P8 is listed only when its `transport_error` is `URLError`: urllib raises that only when
    it cannot connect or send, and a connection cut after the request was sent is what P8
    measures. P6's deliberate abort is recorded as `aborted_after_s`, which is none of these.

    **Older records.** A probe.json written before these records existed has no
    `stream_end` on its streamed records and no `transport_errors` on its K bursts, so the
    writer reads it conservatively. Such a run can be refused `accepted` where a newer run
    would not be: a burst whose `errors` count is above 0, or a streamed reply that
    answered 200 with no finish reason, lists its probe even when the transport was not the
    cause. Rerunning the probe with the current scripts/serving-probe.py records what tells
    the two apart.
- **`terminalCause`:** `probe_finished`, or `probe_unfinished` when probe.json has no
  `finished_utc`.
- **Outcome:** `--outcome accepted` is refused when:
  - the run did not finish;
  - a probe failed;
  - `transportFailures` is not empty. Rows that #117's writer wrote carry no
    `transportFailures`, so `--supersedes` cannot repeat this refusal for them;
  - P10 is unassessed;
  - P10 was assessed under another research protocol than its export's.

**`--fixture-dir DIR --fixture planner|judge|extractor`** reads `summary.json`
(scripts/planner-fixture.ts, scripts/judge-fixture.ts, and lane S-pipe's
scripts/extractor-fixture.ts, pull request #116).
- **Refused:**
  - another version;
  - a dry run;
  - a condition, class, verdict or failure the fixture does not write;
  - a call count other than the design's;
  - planner counts that disagree with its calls;
  - a judge activation cell outside its conditions;
  - calls that are not one per condition and ordinal (planner), per condition, repeat and
    claim (judge), or per condition, repeat and chunk (extractor). The total alone would admit
    every call moved into one condition;
  - extractor chunks that are not one named chunk per manifest source;
  - judge scores that are not the calls' and the manifest's: each repeat must score
    `claimCount` claims, `judged` must count the calls judged, the agreements must fall within
    them, and `meetsLevel` is recomputed from the manifest's measure and level;
  - a `--task` or `--exposure` other than the manifest's;
  - an extractor directory without `summary.json`, since the extractor writes it before its
    first request.
- **Spend:** as for probe rows.
- **`modelCalls`:** the recorded calls.
- **Tokens:** the sums of the answered calls' own `usage`, when every answered call
  reported it.
  - `fixture.usageMissing` counts answered calls without prompt or completion tokens. When
    any exists, `inputTokens` and `outputTokens` are null, since the total is unknown.
    `fixture.usage` keeps the sums over the calls that did report, and how many they are.
  - `cachedTokens` is null when any answered call has no cached-token detail, including a call
    with no usage at all. vLLM leaves the detail out unless started with
    `--enable-prompt-tokens-details`, and unknown reuse is not zero; `fixture.cachedMissing`
    counts those calls.
- **`inputSha256`:** the sha256 of the canonical JSON of the request digests by
  condition: the planner's `requestSha256`, the judge's and the extractor's
  `requestSetSha256`.
- **`fixture`:** `kind`, `finished`, `version`, `sha256` (over summary.json), `conditions`,
  `repeats`, the manifest's hashes and counts, `classes` per condition, `usageMissing` and
  `cachedMissing`.
  - The planner's and the extractor's classes are their classification. The judge's are each
    call's verdict, or the failure of a call not judged.
  - Planner and extractor rows add `protocolSha256`, the research protocol hash their request
    bodies were built under.
  - An extractor row's manifest is its `sha256`, `briefSha256`, `planSha256`, `unitCount` and
    `sourceCount`. Its conditions are `thinking-off`, `thinking-on`, `thinking-on-8192`,
    `thinking-on-16384` and `thinking-off-structured` (the serving card's extract call), and the
    row adds `deployedCondition`, the one the pipeline sends. A
    finished run holds one call per condition, repeat and chunk. The writer
    never copies its `requestSettings`, its `chunks` (whose source ids are paths), its `order`,
    its `cells`, or any per-call field but the classification and the usage counts.
  - A judge row adds `promptVersion`, `promptSha256`, `replyContract`,
    `activationCondition` and `scores`: per condition and repeat, `claims`, `judged`,
    `exactCount`, `establishedCount` and `meetsLevel`, as the run computed them.
  - The writer never reads the labels.
- **A run that died** without `summary.json` is rowed from its `replies/` listing:
  - the listing must hold only the fixture's own reply files, by name, as regular files;
  - `modelCalls` counts them, a lower bound;
  - tokens and `inputSha256` are null;
  - `date` comes from the earliest reply;
  - `fixture` is `{kind, finished: false, replies}`;
  - `terminalCause` is `fixture_unfinished`, and the outcome may only be `incomplete` or
    `infra_invalid`.

  A finished run's `terminalCause` is `fixture_finished`, and its outcome is the operator's,
  by the card's rule.
- **An interrupted extractor run:** the extractor rewrites `summary.json` after every call, so
  a summary without `finishedUtc` is a run that stopped. Its row holds the calls made so far:
  `terminalCause` `fixture_unfinished`, `fixture.finished` false, `wallSeconds` null, and the
  outcome `incomplete` or `infra_invalid` only. The call in flight when it stopped is not
  among them.

**`--labelling-file FILE`** reads the summary that the labelling tool (`pnpm label:judge`,
scripts/judge-labeller.ts) writes for each paid invocation, version 1, as agreed with the
tool's lane on 2026-11-15. The writer refuses any key it does not know: at the top level,
in a call, under `claims` or under `prices`.
- **Checked, not copied:**
  - `labeller`, `run` and `servedModel`;
  - each call's `servedModel`, `requestId`, `errorType`, `errorCode` and `failure`.
- **Refused while running:** a summary with `labelling.lock` in any directory above its run
  directory. A run holds that lock in the tool's `e0-judge` directory while it rewrites its
  summary before each request, and its run directory sits beside `claims.json`, in that
  directory or a folder below it. A lock that a killed run left is removed by hand.
- **Required and copied:**
  - `cloudModel` must be an approved labelling model (`gpt-6-sol`, BL-20261115-1937), sent
    through `openai_responses`;
  - `envelopeLine` is `synthetic_data`, PLAN.md §4's line "Synthetic personas, mailboxes
    and documents (no owner seed)".
- **Call states:**
  - `settled` is written as `settled`;
  - `rejected` (HTTP 400, 401, 403, 404 or 429, the statuses the tool counts as unbilled)
    and `not_sent` (the connection failed before its handshake) are written as `failed`;
  - `unknown` and `outside_projection` are written as `unknown`.
- **Per-call rules** (the tool's own `LabellingSummarySchema`):
  - call 1 is `label_and_plant`, call 2 `plant_only`, and there are at most two;
  - `usd` is a number or null, never a boolean: the fee when settled, at most the call's
    projection; 0 when rejected or not sent; null otherwise;
  - a `rejected` call carries one of the unbilled statuses, a `not_sent` call none, and a
    `settled` or `outside_projection` call HTTP 200;
  - a call without a reply reports no tokens and no cache write. `countedUsd`, what the cap counts, is the fee, 0, the reservation, or at
  least the reservation outside the projection. Tokens are 0 unless a reply was read.
- **Totals:** `modelCalls`, `rejectedDispatches`, `unknownDispatches`, the token totals,
  `usd` and `reservedUnknownUsd` must equal the sums over the calls, in micro-USD.
- **Outcome rules:**
  - `failed` has a failure and wrote nothing, with nothing planted and no class below the
    minimum;
  - `labelled` and `labelled_below_minimum` wrote the set's hashes and counts;
  - `labelled` means no class is below the minimum and there is no failure, and it records its
    finish.

The row:
- `cloudModel` and `cloudApi`;
- `modelCalls` (every request attempted, a `not_sent` one included), `failedDispatches` and
  `unknownDispatches`;
- `usd` (settled fees), `reservedUsd` (every `projectedUsd`), and `pinnedUsd`
  (`reservedUnknownUsd`, what the cap counts for unknown calls);
- `cloudCalls`, each `{purpose, status, feeUsd, reservedUsd, bodyBytes}`, with `feeUsd` null
  on a call that did not settle;
- `disclosedBytes`: each distinct `bodySha256`'s bytes once, over every call except
  `not_sent` (HARN-27);
- the token columns. `cacheWriteTokens` holds reported cache writes only, so it is null when
  the tool assumed a reply's writes;
- `wallSeconds`, null for an interim summary (`labeller_interrupted`), whose `finishedUtc` is
  the time of that rewrite, not an end;
- `inputSha256`, the claim set before labelling;
- `terminalCause`: the failure code, else the outcome;
- `labelling`:
  - `version`, `sha256`, `outcome`, `failure` and `secondRequest`;
  - `envelopeLine`, `capUsd` and `priorCountedUsd`;
  - `instructionsSha256` and `prices`;
  - `reasoningTokens`, and `cacheWriteAssumed`: replies whose cache-write tokens the tool
    assumed;
  - the claims' counts and hashes.

`--outcome accepted` is refused unless the outcome is `labelled`. An exposure above the cap
is recorded, not refused.

`--supersedes` copies an E0 row like any other and repeats these outcome refusals against
the copy.

## Owner verdict rows (desktop jobs)

A desktop task has no run directory: its record and events live in the app's
database, which the registry writer never opens. Instead the app captures the
owner's verdict and exports a receipt (BL-20261108-0904-owner-verdict-capture-design):

1. On a `submitted` task the general-task workspace's "Owner verdict" section
   records accept or reject, the owner's minutes, the manual interventions and
   whether the deliverable was exported through the app. It is recorded once; the
   app refuses a second verdict, and a correction is a `--supersedes` row. The
   task's independent acceptance stays `not_evaluated`: the verdict is the OAJ
   mark (PLAN.md section 1), not a correctness grade.
2. "Export verdict receipt" saves a JSON receipt holding exactly these keys:
   `version` (1), `taskId`, `taskJobSha256` (the task's attestation identity,
   the binding the first owner row `oaj-20261012-document-review-1` used),
   `date` (the UTC date the task started), `profile`, `thinking`,
   `maxOutputTokens`, `runStatus`, `terminalCause`, `modelCalls`, `toolCalls`,
   `wallSeconds` (the task time the app shows), `inputTokens`, `outputTokens`,
   `cachedTokens`, `cacheWriteTokens`, `lengthStops`, `usd` (settled fees),
   `unknownDispatches`, `retriedDispatches`, `failedDispatches`, `entailment`
   (counts, calls, truncation and support rate, or `null`), `arm`
   (`local-<profile>`, or `local-<profile>-consulted` when a consultation
   settled), `verdict` (`decision`, `ownerMinutes`, `interventions`,
   `exportedThroughApp`, `recordedAt` in UTC), `cloudModel: null` and
   `cloudApi: null`. Never the goal, a file name, a path, a URL or model text.
   Tokens and length stops sum the local writer's `model_finished` events, as for
   every row; the entailment pass writes no model events and stays excluded, and a
   consultation's tokens are not in the token columns (its settled fee is in `usd`).
3. The operator writes the row:

   ```sh
   python3 scripts/registry-row.py --verdict-file verdict-receipt-<id>.json \
       --id oaj-<date>-<family>-<n> --batch <the E5 card's batch> \
       --task owner-<first 8 hex of the task id> --family document_review \
       --exposure fresh --verdict-by owner --lesson "..." >> docs/experiments/registry.jsonl
   ```

   The receipt supplies the measurements, `arm`, `outcome` (accept to `accepted`,
   reject to `rejected`), `ownerMinutes`, `interventions`, `verdictAt` and
   `exportedThroughApp`; `--outcome`, `--owner-minutes`, `--interventions`,
   `--verdict-at` and `--arm` may repeat the receipt's values but a different value
   is refused. The writer refuses a receipt with any other key, a wrong `version`
   or a missing `verdict`, so nothing typed in the app and no file name reaches the
   public registry; the one-line `lesson` is typed at the command line. `git` is
   the commit the row was written at, labelled `gitSource: row_written`: the receipt carries no build commit.

An owner verdict on a run that already has a row, for example an E3 or E4 harness
run the owner graded later, is a `--supersedes` row with `--verdict-by owner`,
`--owner-minutes` and `--interventions`.

## Historical metric corrections (2026-10-31)

Three appended rows correct `entailment.supportRate` using the counts already in
the public registry. They supersede `p1e-t2-rfc-memo-heavy` (no judged claims:
`0.0` to `null`), `p2-r1-python-packaging-local-heavy-s2` (`30/32`, `0.909` to
`0.938`) and `p4h3-r3-grid-batteries-split-gpt-6-sol-planner-v2` (`33/39`,
`0.825` to `0.846`). Original rows, verdicts and other run measurements are
preserved. Summaries must exclude superseded rows rather than count corrections as
new runs.

The following four pipeline rows predate the inclusion of research-stage
`truncatedReplies` in `lengthStops`. Their recorded zero counts cover writer replies
only and are lower bounds for the whole pipeline, including in any superseding
support-rate correction. Stage totals cannot be recovered from the public rows and
were not recomputed from raw traces:

- `p4h2-r3-grid-batteries-local-heavy-pipeline-s1`
- `p4h3-r3-grid-batteries-split-gpt-6-sol-planner-v1`
- `p4h3-r3-grid-batteries-split-gpt-6-sol-planner-v2`
- `p4pb-r3-grid-batteries-split-gpt-6-sol-protocol-v3`

No committed loop rows predate the critique-truncation correction. These metric
corrections do not change the selection policy, experiment grades or privacy gates.
