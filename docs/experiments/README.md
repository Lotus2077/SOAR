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
    refused until the backlog item that uses it merges: 7(a) for caps and thinking,
    9 for structured output, 8 for K and 7(b) for admission. Until then, adopt an
    all-default card or leave the pair unset.
  - **What the gates do not show.** The reader binds P10 evidence to the current
    research protocol hash: after any change to it (backlog items 7(b) and 7(c) in
    the plan), re-run P1, P10, P11 and the adapter together and adopt a new card.
    P10's thinking-off cells use the probe's own sampling, non-streaming, so a
    passing cell does not show that the pipeline's own requests pass. The K bursts
    use a one-sentence prompt and show decode concurrency only.
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
- `phase2-tasks-v1.json`: the hashes-only manifest of the frozen Phase 2 tasks (task
  ids, families, driver modes, job, brief, input and gold-file SHA-256 values, check
  counts). The tasks, gold, hidden suites and scorer stay under the ignored `.soar/`.
- `phase4-tasks-v1.json`: the hashes-only manifest of the three fresh Phase 4 research
  tasks for H5 (same fields, plus the scorer and checks versions), authored by a separate
  session; tasks, gold and scorer stay under the ignored `.soar/experiments/phase4-v1/`.

The following stay outside Git, under the ignored `.soar/experiments/`:

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
| `git` | Commit the run executed |
| `batch` | Experiment card or batch name |
| `task` | Task id; `taskJobSha256` binds the exact inputs |
| `family` | research, document_review, website, deck, admin, coding or audit |
| `exposure` | `fresh` (never seen by any run or prompt tuning) or `exposed` |
| `arm` | Route and profile, for example `local-standard` or `local-heavy` |
| `profile`, `thinking`, `maxOutputTokens` | Coordinator profile the run was frozen with |
| `cloudModel`, `cloudApi` | The cloud model and request shape (`openai`, `openai_responses` or `anthropic_messages`) from the freeze's cloud arm (`freeze.arm.modelConfig`), or `null` on local runs; a loop row takes them from sample `a`'s own freeze when the loop's arm is `cloud`. Rows before BL-20261030-0620 omit both fields |
| `modelCalls`, `toolCalls`, `wallSeconds` | Counts from the run's own ledger. Model calls cover the writer and any research pipeline, plus the critique on loop rows; the separate entailment pass reports its calls under `entailmentCalls`. Wall time includes that pass |
| `inputTokens`, `outputTokens`, `cachedTokens`, `cacheWriteTokens`, `lengthStops`, `usd` | Tokens and length stops cover the same calls as `modelCalls`, excluding the separate entailment pass; `usd` sums dispatch fees (local is zero-fee). `cachedTokens` is the part of `inputTokens` the provider reported as served from its prompt cache (summed `cacheReadTokens`, 0 when absent; rows before H1 omit the field). `lengthStops` counts writer replies, research-stage `truncatedReplies` and loop critiques cut at the output limit; historical pipeline rows have the limitation below. `cacheWriteTokens` is the part of `inputTokens` the provider reported as newly written to its cache (summed `cacheWriteTokens`, billed at the write rate); 0 means unrecorded for every run before BL-20261022-1156 including the H1 first attempt |
| `entailment` | Research tasks with a claims ledger: the host's entailment counts, `entailmentCalls`, `truncated` and `supportRate` (supported / (supported + partial + unsupported + contradicted), excluding `not_judged`; `null` when no claims were judged), or `null` for no pass. The signed balance rate that selection protocol 1 compared, and protocol 2 records in `loop.json` as evidence only, is a separate metric. A local-model judgement is evidence, not acceptance |
| `unknownDispatches`, `retriedDispatches`, `failedDispatches`, `assistSkippedDispatches`, `assistFailedDispatches` | Dispatch rows by outcome: unsettled rows (still `committed`, or `unknown`, never replayed); attempts a retry superseded; confirmed failures; and, counted apart since 2026-11-07 (backlog item 10), the sealed cloud one-shots (purposes `research plan assist`, `research synthesis assist`) whose row stayed `unknown` (skipped: its reservation stays pinned and no further grant-free cloud call is made in the job) or resolved `failed` into the host fallback. From that date an assist row is excluded from `unknownDispatches` and `failedDispatches`; rows before it omit the two assist columns. A skipped assist is not a model call (it has no reply), and its pinned reservation is not in `usd`, which sums settled fees, until item 11 adds reserved USD |
| `zeroFeeFailedDispatches` | The part of `failedDispatches` that reserved and settled nothing (backlog item 11, BL-20261109-0331): `failed` rows other than assists to the two fee-free harness destinations (`owned_local_model`, `approved_public_snapshots`), reserved at exactly 0, with no fee key (or a fee of 0) and no approval key; a null fee or approval fails closed. These are the zero-fee local requests and public GETs the broker resolves `failed`. The H4 loop admits them and stops on every other failed row, so a loop row may now carry `failedDispatches` above 0 with a final selection. Only `--run-dir` and `--loop-dir` rows written once this change merges carry the column; earlier rows, desktop verdict-receipt rows and `--supersedes` copies of earlier rows omit it, and an absent column does not mean 0 |
| `outcome` | `accepted`, `rejected`, `incomplete` or `infra_invalid` |
| `terminalCause` | Why the run ended, for example `submitted`, `session_deadline`, `request_body_size_exceeded` |
| `criticalChecks` | Pre-written critical checks passed / total, or `null` |
| `verdictBy` | `owner`, `agent_diagnostic` or `none`; `registry-row.py` refuses any other value. Rows written before 2026-11-07 also carry the legacy values `host_gate`, `qualified_checker`, `qualified_checker+agent_screenshot_review`, `agent_diagnostic_blind` and free-text strings naming the checking model; they are historical and are never re-rowed |
| `verdictAt` | Optional UTC ISO 8601 instant of the verdict in `verdictBy`. `registry-row.py` writes it on every `--supersedes` row (default: the writing time) and on every `--verdict-file` row (the receipt's record time); `--verdict-at` adds it to any row |
| `supersedes` | The id of the row this row corrects; a superseding row repeats the original's measurements. `registry-row.py --supersedes ROW_ID` copies the row verbatim (every measurement, `taskJobSha256`, `date`, `usd`, `entailment`, `loop`) and changes only `id`, `supersedes`, `outcome`, `verdictBy`, `ownerMinutes`, `interventions`, `lesson`, `verdictAt` and `git`, which is the commit the row was written at (the superseded row keeps the run's); `batch`, `task`, `family`, `exposure` and `arm` are copied unless re-declared. It refuses an unknown id, an id another row already supersedes and a new id that already exists. The five rows superseding before 2026-11-07 were hand-written and kept the original `git` |
| `calibrationGate`, `calibrationReviewedAt` | Optional calibration-only acceptance and review time, separate from the task's `outcome` and `verdictBy`; acceptance here does not supply a capability grade |
| `consoleChargeUsd`, `settledStep0And1Usd`, `consoleDifferenceUsd`, `consoleToleranceUsd` | Optional historical Claude step-0/1 reconciliation amounts; the Console display is rounded and the difference must fit the approved tolerance with no competing usage |
| `localJudgeProvenance` | Optional explicit description of the historical judge tier; never relabel old entailment counts after changing the local model |
| `ownerMinutes`, `interventions` | Owner effort (owner-run jobs only). With `verdictBy: owner` both are required: minutes as a finite number of at least 0, interventions as an integer of at least 0 (an edit pass counts as one, PLAN.md section 1). Other rows carry `ownerMinutes: null` and `interventions: 0` |
| `exportedThroughApp` | Owner rows written from a desktop verdict receipt only: whether the owner declared the deliverable exported through the app, an OAJ condition (PLAN.md section 1) |
| `lesson` | One line |
| `loop` | H4 select-and-repair loop rows only (`scripts/phase4-loop.ts`, `registry-row.py --loop-dir`): `version`, `rule` (the selection protocol version), `samples`, `repaired`, `seeded` (whether sample `b` and the repair wrote from sample `a`'s evidence packet), `stage1` (the sample the host-checked selection chose), `selected` (the loop's deliverable: `a`, `b` or `repair`), `step` (the rule step that decided it), `critiqued` and `critiqueFailure`, `writeIdentityEqual` (whether the two samples' write phases carried the same identity) and `candidates` (every sample's own `status` and `terminalCause`, so the harness-terminal rate is computed per sample). The row's counts sum the loop's runs plus the critique's one call (from `critique.json`, or `critique-failure.json` when the critic answered and the tool refused the reply), `wallSeconds` spans the loop from its earliest start to its latest end over its runs, and status, cause, binding and entailment are the selected run's; the all-cloud arm has no loop and no such field |

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
   the commit the row was written at, as for every row.

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
