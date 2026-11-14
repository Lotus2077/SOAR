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
    calls), today's caps and thinking, K 1 and admission `none`. The Markdown's P10
    verdict keeps its older wording (no 20-call minimum, no protocol check); the
    JSON is authoritative.
  - **Adoption** is a reviewed commit that sets `decision` to `{status: adopted,
    entry: <the BL entry that records E0's result>}`. It is made only once that
    entry's ID is final on `main`, since IDs are re-stamped at merge. The owner then
    computes the sha256 and sets the pair `SOAR_SERVING_CARD_FILE` and
    `SOAR_SERVING_CARD_SHA256` in the ignored `.env.local`.
  - **Audit.** A reviewer re-runs the writer on the retained probe with the same
    `--date` and checks `probe.sha256`: only `decision`, `roles`, `concurrency` and
    `admission` may differ.
  - **Only adopted cards are read.** A value that differs from today's default is
    refused until the backlog item that uses it merges: 7(a) part 2 for caps and
    thinking, 9 for structured output, 8 for K and 7(b) for admission. Until then,
    adopt an all-default card or leave the pair unset.
  - **What the gates do not show.** The reader binds P10 evidence to the current
    research protocol hash: after any change to it (backlog items 7(a) part 1,
    7(b) and 7(c) in the plan), re-run P1, P10, P11 and the adapter together and
    adopt a new card. Since P10-align (BL-20261113-1011-p10-align-design), each
    P10 cell sends the pipeline's own request body for its role and thinking
    mode. `pnpm probe:export-schemas` builds those bodies with the model layer
    under the desktop's settings (`.env.local`). The probe only adds
    `response_format`, and it reads a streamed reply as events. A passing cell
    still shows nothing about requests without `response_format`, which is what
    the pipeline sends until backlog item 9. It also shows nothing about real
    corpus sizes or repair requests, since the payloads are synthetic and small.
    Re-export after changing those settings: the probe refuses an export for
    another model. The K bursts use a one-sentence prompt and show decode
    concurrency only.
  - **The run record.** `freeze.json` records `servingCard {sha256, version, date,
    entry}`, and the run directory keeps `serving-card.json`. A refused card leaves
    no run directory. The driver's and the loop's failure lines, and the loop's
    `log.txt` and `errors.txt`, name the refusal's code and, except for a file-level
    refusal, its key path.
- `e0-planner-fixture-v1.json`: the hashes-only manifest of the E0 planner fixture
  (`scripts/planner-fixture.ts`): the exposed r3 index, its brief and source ids by
  sha256, the chunk count and the proposed 3 x 10 design. It is a template until the
  owner fills its hashes; the index and the brief stay under the ignored `.soar/`.
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
  `role-schemas.json`);
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
| `family` | research, document_review, website, deck, admin, coding or audit |
| `exposure` | `fresh` (never seen by any run or prompt tuning) or `exposed` |
| `arm` | Route and profile, for example `local-standard` or `local-heavy` |
| `profile`, `thinking`, `maxOutputTokens` | Coordinator profile the run was frozen with |
| `cloudModel`, `cloudApi` | The cloud model and request shape (`openai`, `openai_responses` or `anthropic_messages`) from the freeze's cloud arm (`freeze.arm.modelConfig`), or `null` on local runs; a loop row takes them from sample `a`'s own freeze when the loop's arm is `cloud`, or, once backlog item 11's part 3b merges, from `a.infra-1` after a seeded-writer resume of `a` (`stage_run` in `registry-row.py`). Rows before BL-20261030-0620 omit both fields |
| `modelCalls`, `toolCalls`, `wallSeconds` | Counts from the run's own ledger. Model calls cover the writer and any research pipeline, plus the critique on loop rows; the separate entailment pass reports its calls under `entailmentCalls`. Wall time includes that pass |
| `activeSeconds` | Loop rows written once backlog item 11's part 3b merges (BL-20261113-0836): the time the loop's stages ran. It sums the spans the loop recorded (`stages`, and each resume entry's span), plus, for a stage whose process died before the loop recorded its end, the time from its begun time to its last dispatch commit. The wait between a loop's invocations is left out, so a resumed loop's `wallSeconds`, which keeps its meaning, can be much longer. `null` for a version-1 loop |
| `inputTokens`, `outputTokens`, `cachedTokens`, `cacheWriteTokens`, `lengthStops`, `usd` | Tokens and length stops cover the same calls as `modelCalls`, excluding the separate entailment pass; `usd` sums dispatch fees (local is zero-fee). `cachedTokens` is the part of `inputTokens` the provider reported as served from its prompt cache (summed `cacheReadTokens`, 0 when absent; rows before H1 omit the field). `lengthStops` counts writer replies, research-stage `truncatedReplies` and loop critiques cut at the output limit; historical pipeline rows have the limitation below. `cacheWriteTokens` is the part of `inputTokens` the provider reported as newly written to its cache (summed `cacheWriteTokens`, billed at the write rate); 0 means unrecorded for every run before BL-20261022-1156 including the H1 first attempt |
| `entailment` | Research tasks with a claims ledger: the host's entailment counts, `entailmentCalls`, `truncated` and `supportRate` (supported / (supported + partial + unsupported + contradicted), excluding `not_judged`; `null` when no claims were judged), or `null` for no pass. The signed balance rate that selection protocol 1 compared, and protocol 2 records in `loop.json` as evidence only, is a separate metric. A local-model judgement is evidence, not acceptance |
| `unknownDispatches`, `retriedDispatches`, `failedDispatches`, `assistSkippedDispatches`, `assistFailedDispatches` | Dispatch rows by outcome: unsettled rows (still `committed`, or `unknown`, never replayed); attempts a retry superseded; confirmed failures; and, counted apart since 2026-11-07 (backlog item 10), the sealed cloud one-shots (purposes `research plan assist`, `research synthesis assist`) whose row stayed `unknown` (skipped: its reservation stays pinned and no further grant-free cloud call is made in the job) or resolved `failed` into the host fallback. From that date an assist row is excluded from `unknownDispatches` and `failedDispatches`; rows before it omit the two assist columns. A skipped assist is not a model call (it has no reply), and its pinned reservation is not in `usd`, which sums settled fees, until item 11 adds reserved USD. On a loop row written once item 11's part 3b merges, `unknownDispatches` can include a zero-fee `committed` row of a run the loop moved aside: the local call in flight when that run's process died. The resume admitted it because sending equivalent work again costs nothing, and the row itself is never sent again, because the rerun is a new job |
| `zeroFeeFailedDispatches` | The part of `failedDispatches` that reserved and settled nothing (backlog item 11, BL-20261109-0331): `failed` rows other than assists to the two fee-free harness destinations (`owned_local_model`, `approved_public_snapshots`), reserved at exactly 0, with no fee key (or a fee of 0) and no approval key; a null fee or approval fails closed. These are the zero-fee local requests and public GETs the broker resolves `failed`. The H4 loop admits them and stops on every other failed row, so a loop row may now carry `failedDispatches` above 0 with a final selection. Only `--run-dir` and `--loop-dir` rows written once this change merges carry the column; earlier rows, desktop verdict-receipt rows and `--supersedes` copies of earlier rows omit it, and an absent column does not mean 0 |
| `outcome` | `accepted`, `rejected`, `incomplete` or `infra_invalid` |
| `runClass` | `--run-dir` and `--loop-dir` rows written once backlog item 11's part 3a merges (BL-20261109-0515): `{version, infra, cause}`, whether the run (for a loop, its selected run, with the loop's own interrupt mark) ended on infrastructure, from its recorded codes only (src/main/private-agent/run-classification.ts, mirrored in `registry-row.py`). `cause` is the host-side reason (`runtime_failure_progress_preserved` only when no uncertain cloud call's reply was refused), `model_unavailable` or `research_request_failed` (a failed call that cost nothing, failed transiently at the cloud, or left no failed row), a token-admission or broker code, `verification_unavailable`, `operator_stop`, or, on a loop row whose critique failed on infrastructure and left an unsubmitted draft, `critique_` and the critique's code; a public phase's end keeps the session's `public_` prefix (`public_model_unavailable`, for example); `task` or `submitted` otherwise. The writer refuses `--outcome rejected` or `incomplete` for an unsubmitted run whose `infra` is true, and `--outcome infra_invalid` for any other run; `accepted` stays allowed. A `--supersedes` row repeats these checks against the copied `runClass` when the copy carries one, so an owner's `rejected` on an unsubmitted infrastructure end is refused. `infra_invalid` counts as not accepted in an experiment's arithmetic unless a re-run flagged under the card's rule replaces it. Under version 1 a cloud call answered 429 with no recorded kind is transient: only the Anthropic arm records the spend-cap and spend-limit flags, so on an OpenAI-shaped arm a quota or billing refusal answered 429 is classed as infrastructure (BL-20261110-0723 adds this to owner question (d), to be answered before E3's card records version 1). From part 3b (BL-20261113-0836), a loop row can also have these causes: on a version-2 `critique_failed` or `repair_failed` loop whose draft did not submit, `critique_` or `repair_` and the stop's recorded infrastructure cause; on a loop whose repair ended on infrastructure and lost, `repair_` and the repair's own cause, in either version; and on the row of a loop that ended without a selection, the stop's class. That class is part 3a's for a stopped run with a result; `run_unfinished`, `stage_unresolved_dispatch` or `stage_failed_dispatch` for a run without one; the code of an integrity stop (`loop_stage_missing`, `loop_resume_spent`, `loop_stage_mismatch`, `loop_resume_mismatch`, `loop_stage_ledger_unreadable`); or `operator_stop` after the loop's own interrupt. Such a row is never `accepted`, and neither is a superseding copy of it. These rows carry `version` 1, whose run-end lists do not change |
| `terminalCause` | Why the run ended, for example `submitted`, `session_deadline`, `request_body_size_exceeded` |
| `criticalChecks` | Pre-written critical checks passed / total, or `null` |
| `verdictBy` | `owner`, `agent_diagnostic` or `none`; `registry-row.py` refuses any other value. Rows written before 2026-11-07 also carry the legacy values `host_gate`, `qualified_checker`, `qualified_checker+agent_screenshot_review`, `agent_diagnostic_blind` and free-text strings naming the checking model; they are historical and are never re-rowed |
| `verdictAt` | Optional UTC ISO 8601 instant of the verdict in `verdictBy`. `registry-row.py` writes it on every `--supersedes` row (default: the writing time) and on every `--verdict-file` row (the receipt's record time); `--verdict-at` adds it to any row |
| `supersedes` | The id of the row this row corrects; a superseding row repeats the original's measurements. `registry-row.py --supersedes ROW_ID` copies the row verbatim (every measurement, `taskJobSha256`, `date`, `usd`, `entailment`, `loop`) and changes only `id`, `supersedes`, `outcome`, `verdictBy`, `ownerMinutes`, `interventions`, `lesson`, `verdictAt`, `criticalChecks` when `--critical-checks` is given (a row without it gains it as `null`) and, unless the copied row holds a well-formed run-sourced commit (`gitSource` `run` with a boolean `gitDirty`, or `runs_differ`; kept with both once backlog item 11's part 2 merges, since the measurements are the run's), `git`, `gitSource` and `gitDirty`, which then record the commit the row was written at (`row_written`); `batch`, `task`, `family`, `exposure` and `arm` are copied unless re-declared. It refuses an unknown id, an id another row already supersedes and a new id that already exists. The five rows superseding before 2026-11-07 were hand-written and kept the original `git` |
| `calibrationGate`, `calibrationReviewedAt` | Optional calibration-only acceptance and review time, separate from the task's `outcome` and `verdictBy`; acceptance here does not supply a capability grade |
| `consoleChargeUsd`, `settledStep0And1Usd`, `consoleDifferenceUsd`, `consoleToleranceUsd` | Optional historical Claude step-0/1 reconciliation amounts; the Console display is rounded and the difference must fit the approved tolerance with no competing usage |
| `localJudgeProvenance` | Optional explicit description of the historical judge tier; never relabel old entailment counts after changing the local model |
| `ownerMinutes`, `interventions` | Owner effort (owner-run jobs only). With `verdictBy: owner` both are required: minutes as a finite number of at least 0, interventions as an integer of at least 0 (an edit pass counts as one, PLAN.md section 1). Other rows carry `ownerMinutes: null` and `interventions: 0` |
| `exportedThroughApp` | Owner rows written from a desktop verdict receipt only: whether the owner declared the deliverable exported through the app, an OAJ condition (PLAN.md section 1) |
| `lesson` | One line |
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
can submit. Until item 11 adds registry columns for it, the fallback is disclosed
only in the packet: `coverage.json` (`fallbacks`), the research stage rows
(`fallback`) and the skeleton's first sentence. Read those before crediting a v5
research row. v4 rows that ended `research_plan_invalid` or
`research_synthesis_invalid` keep that terminal cause.

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
