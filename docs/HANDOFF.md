# SOAR handoff

## Start here (2026-11-07)

This section is the entrypoint for the next session. It supersedes every earlier
"next step" in this file; the rest of the file is the September 2026 record.

**Planning map (2026-11-08).** Steps 2 to 7 of §5 are charted as parallel lanes in the
GitHub issue [Wayfinder map: route the next milestones (E0 to E4) in parallel
lanes](https://github.com/Lotus2077/SOAR/issues/46). Its child issues hold the open
owner decisions of §4 and the experiment cards that gate each lane, and their blocking
links show which ones can be taken now. Read the map before acting on §5. A ticket's
resolution stays `Proposed` until the owner's build-log entry records it. E1 and
backlog items 6-11 need no owner decision.

### 1. Get the work

Everything after `main`'s `153b8e6` (the 2026-11-05 review, its five checks and the
2026-11-07 owner decisions) was developed on branch `claude/great-meitner-kri52m` and
merged into `main` on 2026-11-08 as PR #39, so work from `main`. Select Node 22.22.2
and pnpm 10.12.4 first ("Setup and safe verification" below): `.npmrc` sets
`engine-strict=true`, so another Node major fails the install.

```sh
git fetch origin main
git checkout main
pnpm install --frozen-lockfile
```

Then run the checks in "Setup and safe verification" below. CI runs only on pull
requests and on pushes to `main`. Base each new pull request on `main` (PLAN.md D10
approves pushing reviewed work to public `main`). The step-1 pull requests listed
under §5 (#37, #38 and #40 to #44) are all merged into `main` as of 2026-11-08, so the
next action is step 2, E0.

### 2. Read, in this order

1. [PROJECT_REVIEW_2026-11-05.md](PROJECT_REVIEW_2026-11-05.md): §2 (the goal
   statement, confirmed; §2.1-2.5 stay proposed except where E3's and E4's approved
   rules use them), §5.2 (architecture v5: local volume work, sealed cloud
   assists), §5.6 (experiments E0-E7, their caps and pre-registered rules, and
   their order), §5.7 (the engineering backlog, in order) and §5.10 (owner
   decisions).
2. [PLAN.md](PLAN.md): the owner-direction note in §1 and the envelope in §4.
3. [BUILD_LOG.md](BUILD_LOG.md): BL-20261107-0650-owner-decisions-review-items-2-5
   and its correction BL-20261107-0718-correction-owner-decisions-record (what is approved and what still
   gates each experiment), then BL-20261105-1821-owner-direction-equal-weights-new-model
   and BL-20261105-1822-project-review-reset-proposed with their corrections,
   BL-20261105-2016-correction-direction-and-review-entries through
   BL-20261105-1722-fifth-check-corrections.

### 3. Decided

- **The goal** (review §2; the statement was confirmed on 2026-11-07): "Deliver
  Manus-level results on the owner's real work, public deep research first, at a
  fraction of Manus's cost, without private data ever leaving the owned device
  unless the owner approves the exact bytes: the local model does all the volume
  work at zero fee, and the cloud takes only the hardest step, as sealed one-shot
  packets." Privacy, result quality and token cost weigh equally; the 2026-09-29
  labelled-data rule and D15 are unchanged, and OAJ stays the adoption north star.
  The ≤ USD 0.50 P50 cost target (review §2.3) is proposed and binds only through
  E4's approved decision rule.
- **Zero-fee work needs no approval.** Zero-fee local runs on public, synthetic or
  owner-declared-public inputs within the Heavy caps need no approval entry and no
  per-trial named authority (PLAN.md §4(c)). Retiring slot, claim and allocation
  accounting and the untracked launcher as gates is part of the review's stop list
  (§5.8), which stays proposed. Paid runs, real private data, new egress
  destinations and public pushes keep their gates.
- **E3 and E4 are approved** against the Phase 4 harness track line (USD 33, about
  USD 28.4-28.7 left): E3, the closed-corpus route round, with a cap of USD 20.4,
  and E4, the Manus-bar web round, with a cap of USD 20.5. The owner chose neither
  E4's admission condition nor a reallocation, so the record applies the admission
  condition: E4 starts only if the line's balance after E3 settles covers its cap,
  unless the owner records a reallocation from the weekly public-work line. The
  record reads the approval as covering the T1 and T2 packets that E3's and E4's
  cloud-assisted arms send, including each task's brief.
- **E4's paid judges** run at api.openai.com: GPT-5.5 for DeepResearch Bench RACE
  with the key the owner names JAO, and LiveDRBench's official grader with the key
  the owner names JAT. The grader's judge model is not yet named: its wrapper takes
  it as the required `--judge` argument (`benchmarks/harness/evaluate_livedr_row.py`),
  so E4's card proposes it and the owner records it before E4 starts. The wrapper
  reads `OPENAI_API_KEY`, so each judge run sets that variable, in its own process,
  to the named key's value.
- **Who decides the cloud's role:** E3's pre-registered rule picks it for the
  harness, E4's result decides what runs behind the desktop's assist toggle, and
  the owner decides trades and ties.

### 4. Still open, and what each blocks

| Owner decision (review §5.10) | Blocks |
| --- | --- |
| 1: is the endpoint's model the one qualified on 2026-11-04? | Whether E0 is a delta check; E0's probe P1 and the owner answer it |
| 5, open parts: a reallocation from the weekly public-work line; the LiveDRBench grader's judge model | The reallocation only if the line's balance after E3 settles is below USD 20.5; the model before E4 starts |
| 6: which provider carries the assists and E3's arm D | E3's card |
| 7: a thinking-off writer arm | That E2 arm only |
| 8: SearXNG or a keyed search API | Backlog item 12's search destination (R2) and E4 |
| 9: the P11 transport timeline | Any labelled work |
| 10: the Manus product baseline | The E4 option only |
| 11: blind proxy grades as provisional | E3's and E4's verdicts |
| 12: numbered briefs; disclosing the public brief | Task authoring (D11's brief units) and the desktop's first assist packet on a public task (backlog item 13); E3's and E4's approved arms carry their own task briefs in T1 and T2 |
| 13: the Phase 2 dashboard reconciliation; D20(b) | The uncached all-cloud baselines (USD 3.05-3.77); T3 and any coding on private source code |
| 2, last part: whether the assist toggle starts on | The toggle's default for URL-backed public tasks in the desktop wiring (backlog item 13), once E4 ships a cloud-assisted arm |

### 5. Act next, in this order

Follow the order in review §5.6. Each step is done when its condition holds.

1. **Backlog items 1-5 and item 10's assist-purpose exception** (review §5.7), as
   small PRs with tests. Item 1 includes the fix for finding D14. A change to a
   persisted contract or to dispatch semantics gets its build-log decision entry
   first. Done: the tests and CI pass, and the entries are appended. **Done on
   2026-11-08**: see the progress note below.
2. **E0** from the owner's Mac against the new endpoint, at zero fee and with no
   approval entry, after its card is committed: probes P1-P9 in
   `scripts/serving-probe.py`, the new P10, P11 and adapter probe (backlog item 5),
   and the role fixtures. Done: a serving card that records the alias, engine
   version and context, never the address, with every stage bound re-derived from
   it.
3. **E1**, the recoverability tests with no live model. Done: its gate in review
   §5.6 passes.
4. **E5** on the existing local routes in the owner's desktop build, with backlog
   item 2's verdict capture. Ask the owner about the P11 interim (an SSH local
   forward, whose timeline is open decision 9) and the box checklist (deferred at
   the owner's request, PLAN.md D5); both gate labelled work only, so the steps
   below do not wait for them.
5. **E2 and E6**, backlog items 6-11, and the start of item 12.
6. **E3**, once backlog items 6-11 are done (among them item 10's assist wrapper,
   which arms B and C and E3's zero-cache-write condition need, and item 11's
   harness changes), decisions 6 and 11 are made, and its card is committed. The
   card names the provider and D's call allowance, and shows that the allowance's
   projected fee, late reservation included, stays under USD 3.00 on f2, or the
   owner raises D's cap and E3's with it.
7. **E4**, once E3 has settled and the harness line's balance covers E4's USD 20.5
   cap (or the owner records a reallocation), decision 8 is made, items 11
   (paired retrieval) and 12 are done, its cloud-assisted arm is chosen from E3's
   result or named by the owner, the grader's judge model is recorded, and its
   card, with the RACE threshold set from GPT-5.5-judged product scores (review
   §2.2, criterion 4), is committed. Then backlog item 13, the desktop wiring.

**Adjustments from the Rayline evaluation** (2026-11-13,
BL-20261113-0730-rayline-evaluation-plan-adjustments; the owner delegated "adjust the
current building plan if you see fit"). No Rayline component is adopted, and the steps
above keep their order, rules, caps and gates. Each addition below is zero fee. Card
contents and owner decisions stay the owner's.

- **Step 2, before E0.**
  - (a) The doctor (`scripts/setup-general.ts`) reports the endpoint's served alias,
    model root basename, engine version and context window, never the address. It
    flags a window smaller than the profile assumes, and is not ready when an adopted
    card's identity differs. With it the owner can answer decision 1 from observed
    values.
  - (b) A judge-fixture script and its labelling protocol. E0's judge cell has none
    today; only `fixture:planner` exists.
  - (c) Proposals for the E0 card (#47):
    - a planner "sequence" condition: attempt 1 with thinking off, then the repair
      attempt with thinking on;
    - a low-effort or budgeted-thinking condition, only if probe P2 shows the levels
      differ;
    - a logprobs check in the adapter probe;
    - judge cells J1 (today's JSON judge) and J2 (probability-scored, descriptive
      only).
- **Step 5.**
  - (d) Items 10.b and 11 record the served model on assist attempts, on cloud
    `model_finished` events and in a registry column. Item 11 also records whether T1
    and T2 would have fired on arms A and B. Both land before E3's first source
    freeze.
  - (e) New backlog item 17: an approved-egress manifest that pairs each key with its
    host. It is checked wherever a cloud destination is built. It lands before E3's
    first freeze if decision 6 names gpt-6-sol.
- **Steps 6 and 7, proposals for the owner.**
  - (f) A descriptive section and an optional pre-registered tie-break for the E3 card
    (#63).
  - (g) A data-retention comparison for decision 6 (#59).
  - (h) A loopback metering gateway as the answer to question 3 of #61.

**Progress on step 1** (2026-11-07, a later session on the owner's Mac). Backlog items 1-5
and item 10's assist-purpose exception are implemented as small pull requests with
deterministic tests, each with a `Proposed` decision entry before its code and an
`Implemented` entry after it. Every one is merged into `main` (2026-11-08, in the order
#37, #38, #42, #44, #43, #40, #41; `main` is a240afc). Three entries carry IDs later than
their authoring minute because the ledger appends in merge chronology and its validator
refuses an ID that precedes the base's tail: the corrections BL-20261108-0856, -0906 and
-0912 record the original times. When a sibling branch merges after another, re-stamp its
entries after `main`'s tail and add such a correction; never interleave.

| Item | Pull request | Branch | Entries |
| --- | --- | --- | --- |
| 1 (with D14) | #37 | `fix/zero-fee-failures-resolve` | BL-20261107-0809, -0812 |
| 10 (week 1) | #38, on #37 | `fix/assist-purpose-exception` | BL-20261107-0839, -0842 |
| 2 | #40 | `fix/owner-verdict-capture` | BL-20261108-0904, -0852 |
| 5 | #41 | `feat/serving-probe-extensions` | BL-20261108-0911 |
| 3 | #43, on #38 | `fix/stop-bricking-tasks` | BL-20261107-0924, -0936, -1006, -1041, -1110, -1111 |
| 4 | #42, on #38 | `feat/label-keyed-diagnostics` | BL-20261107-0859, -0923 |

Item 3's implementation went through three adversarial review rounds; the brick paths they
found and the smaller corrections are decided in BL-20261107-1006 and BL-20261107-1041 and
implemented in the same pull request, and its Docker-gated sandbox suite was run on the
owner's Mac (the `Verified` entry). Finding D14 is reproduced by a deterministic session
test and fixed in #37 (see §7). Step 1 is complete; nothing live has run. The owner questions
these entries leave open: whether a desktop consultation may follow a skipped assist, and
whether the pre-commit refusals outside item 3's seven denial codes should record a marker
now or wait for item 13 (items 10 and 3); the second-verdict policy, `git` on superseding
rows and the `verdictBy` enum (item 2); which r3 index the planner fixture pins and whether
reasoning text may ever be retained (items 4 and 5); the E0 card still gates every live
probe. Steps 2 onwards have not been started: E0 needs the owner's `.env.local`, which no
agent session has.

### 6. Rules for every step

- Follow `AGENTS.md` and the log rules at the top of BUILD_LOG.md: UTC entry IDs,
  append-only entries, and corrections only as new `Correction` entries. Keep
  `Proposed`, `Approved`, `Implemented`, `Verified` and `Released` distinct.
- The endpoint's address lives only in the owner's ignored `.env.local`
  (`SOAR_VLLM_BASE_URL`, `SOAR_VLLM_MODEL`, `SOAR_VLLM_COST_POLICY=local_zero_cost`;
  review §5.9). The JAO and JAT keys live only in the owner's local configuration.
  Never commit or log an address, a key, a local path, a raw trace or gold.
- Every experiment, zero-fee ones included, is pre-registered: commit its card
  (hypothesis, arms, budget, decision rule, stop rule; PLAN.md §4) before it runs,
  and write one registry row per run with the three columns. E0's card sets the
  judge fixture's agreement level before that fixture runs, and a separate session
  labels its claim set (review §5.6). Run paid work only inside an approved cap.
- Before pushing, run `pnpm --silent validate:build-log -- --base-ref origin/main`,
  `pnpm typecheck`, `pnpm validate:readiness` and the tests for what changed.

### 7. Known limits

Five adversarial checks of the review converged, confirming 96, 54, 37, 17 and 2
findings, but each check after the first covered only the previous revision's
changes. Finding D14 (a retried research call loses a completed stage) was found by
reading code; a later session reproduced it with a deterministic session test and fixed
it in PR #37 (BL-20261107-0812). One independent review checked the
2026-11-07 decision record; BL-20261107-0718-correction-owner-decisions-record records its fixes.

## September 2026 record

Reviewed: **2026-09-28**. Latest substantive product experiment: **2026-09-14**.

SOAR has a working general-task prototype and useful safety/accounting machinery.
It has **two independently accepted synthetic desktop examples: a file audit and
an editable three-slide presentation**. Research was rejected; no website has
been accepted. Useful real cloud consultation, ordinary owner usability and
real-private deployment remain unproved. **The MVP is unfinished and unreleased.**

**Superseded next steps (owner approval 2026-09-29,
BL-20260928-1745-owner-answers-plan-approved):** the revised [plan](PLAN.md) now
replaces the next-milestone ordering below. It is based on a verified
[whole-project review](PROJECT_REVIEW_2026-09-28.md) and comes with a
[private work design](plans/PRIVATE_WORK_DESIGN_V1.md). The plan sets out:
- a fair local-versus-cloud test;
- the owner's own verdicts from week one;
- a gated local-only tier for the owner's files.

The rest of this handoff remains accurate as a record of the September state.

This is the current entrypoint for a successor. It consolidates the
[course audit](MVP_COMPLETION_AUDIT.md), [readiness history](MVP_READINESS.md) and
[append-only build log](BUILD_LOG.md). Older reports remain evidence for their
specific versions; their earlier "next" statements are not simultaneous active
requirements. This handoff does not authorize a new live or paid trial.

## Goal and source checkpoint

The owner's goal is to build an MVP, fail fast, learn and iterate on general
end-to-end agentic work. Research, file auditing, website building and editable
PowerPoint creation are initial optimization priorities, not an exhaustive task
taxonomy. Product priorities remain **privacy >= quality > savings > latency**.
See the [privacy-first design](plans/MVP_PRIVACY_FIRST_AGENT_V1.md) and
[execution sequence](plans/MVP_PRIVATE_AGENT_EXECUTION_V1.md).

This handoff describes a **development source checkpoint**, not a released build:

- The September 28 audit began on `main` at `6a32777` (September 2, PR6R A2
  closure documentation), with 20 modified tracked and 227 untracked files. That
  older commit does not contain the general-task implementation.
- The owner subsequently requested commit and push. The publication checkpoint
  includes the accumulated source, tests, runtime definitions and reports, plus
  this handoff. Inspect Git history for the checkpoint's exact revision; the
  initial dirty-file counts above are historical, not its final worktree state.
- Source publication does not establish release readiness. Verification limits
  remain explicit in the publication build-log entry; do not infer green CI or
  a successful full test suite from the existence of a commit.
- `.soar/` contains ignored local receipts, artifacts, snapshots and trial state.
  A repository handoff alone does not transfer them. Preserve them locally and
  retain negative results. Do not use `git clean` to tidy this workspace.

## What exists and what the experiments establish

| Area | Implemented and observed | Remaining evidence gap |
| --- | --- | --- |
| General-task desktop | Goal, optional public/synthetic files, exact public URLs, saved progress, pause/resume/cancel, artifact preview and native export. Scripted actual-app scenarios exercise these boundaries. | Practical setup and reliable owner use across fresh jobs. |
| File audit | One synthetic support report independently accepted; six settled local calls and six tools, exact export and source-derived checks. | Mixed-document coverage and general reliability. |
| Editable slides | One three-slide PPTX independently accepted; 17 settled calls/tools. Source checks, rendered slides and native chart/table/workbook editing were reviewed. | Broader presentation quality and Microsoft PowerPoint compatibility; editing evidence used LibreOffice. |
| Research | Public-source retrieval and report delivery work. First report was rejected for a recommendation presented as a requirement and omitted requested distinctions. | An accepted research output; autonomous source discovery and follow-up. |
| Website | The first delivered candidate and a later exposed repair draft each passed 15/30 checks. Another run produced no HTML; the latest retained an unexported draft. | Any accepted website, correct arithmetic/interactions and reliable delivery. |
| Multi-file delivery | All-output inventory and ZIP export implemented. Historical 132 host checks, both typechecks and build passed. | Renderer assertions never started; normal desktop bundle interaction remains unverified. |
| General-task routing | One local coordinator plus optional one-use, exact-packet consultation; approval, revocation, restart and accounting exercised with scripted responses. | A helpful real consultant run, provider compatibility and quality/cost benefit. |
| Privacy | Permission, isolation, bounded outbound access and conservative unknown-outcome handling have scoped proofs. Laptop privacy-filter development tests completed. | Actual inference deployment, transport/logging/retention and real-private qualification. Current general-task admission is public/synthetic only. |

These are examples and scoped checks, not a held-out success rate. Historical
test counts overlap and must not be summed into one coverage total. Submission,
file existence, ZIP export and independent semantic acceptance are separate facts.

The earlier coding pilot produced real cloud patches and a 36-run comparison:
11/12 Cloud, 10/12 prepared Cloud and 10/12 Hybrid patches were review-acceptable.
Every local stage fell back; Hybrid cost **4.93% more than prepared Cloud**.
Later planner/native-local calibrations and routing research exposed both useful
coding ability and contract/execution failures; they do not prove benefit in the
general-task path. See the [coding comparison](MVP_HYBRID_SCREEN_REPORT.md),
[native calibration](NATIVE_LOCAL_CALIBRATION.md) and
[routing research](ROUTING_POLICY_RESEARCH.md).

OpenAI privacy-filter ran on this laptop in a synthetic development screen:
84.38% sensitive-character coverage, five of twelve mandatory canaries missed,
and three literal-mask utility failures. The 60 sealed confirmation cases remain
unrun following a preflight deadline. It is advisory and cannot authorize
disclosure. See the [privacy-filter assessment](PRIVACY_FILTER_RESEARCH.md).
Do not restart large integrity scans or a new filter comparison as handoff work.

Owned inference is recorded with a zero API-fee declaration. The owner's roughly
USD 3,500 device, electricity, amortization and utilization are not priced into
that field; neither zero fees nor ownership establishes total savings.

## Latest failure: preserve both observations

The final website trial is an infrastructure-confounded incomplete run, not an
evaluated website failure:

1. At 51.084 seconds the driver lost its page. Its early result showed nine
   model requests, eight settled and one unresolved, and `appClosed: true`.
2. A later read-only database audit found that the app had continued: ten
   requests, nine settled, one unknown and nine completed tools. A 14,238-byte
   HTML draft reached a checkpoint; there was no native export or evaluation.
3. The task ended incomplete, with cleanup recorded at 790.141 seconds and the
   execution claim released. The unknown request recorded 737.461 seconds despite
   a configured 300-second timeout. Its overrun cause remains unresolved.
4. The outer driver required forced termination at 1,130.03 seconds; the exact
   leftover app process was subsequently identified and terminated. These are
   historical cleanup observations, not a current process inventory.

On macOS, local-mode SOAR deliberately remains alive after its last window closes.
`GeneralTaskController.close()` requests cooperative pause and awaits active
work. This makes window loss insufficient evidence of process exit; it does not
explain the timeout overrun. Do not replay the unknown request, reuse that trial's
one-use admission, manually settle its ledger or call its draft delivered.

## Code map and operational boundaries

| Responsibility | Entry points |
| --- | --- |
| App/process ownership | [`index.ts`](../src/main/index.ts), [`bootstrap.ts`](../src/main/bootstrap.ts) |
| General-task desktop and IPC | [`GeneralTaskWorkspace.tsx`](../src/renderer/src/GeneralTaskWorkspace.tsx), [`general-tasks-ipc.ts`](../src/main/general-tasks-ipc.ts), [`controller.ts`](../src/main/general-tasks/controller.ts) |
| Task schemas/status | [`general-task-contracts.ts`](../src/shared/general-task-contracts.ts) |
| Durable task loop | [`session.ts`](../src/main/private-agent/session.ts), [`runner.ts`](../src/main/private-agent/runner.ts) |
| Dispatch/permissions/accounting | [`broker.ts`](../src/main/private-agent/broker.ts), [`store.ts`](../src/main/private-agent/store.ts), [`contracts.ts`](../src/main/private-agent/contracts.ts), [`scanner.ts`](../src/main/private-agent/scanner.ts) |
| Execution and saved state | [`sandbox.ts`](../src/main/private-agent/sandbox.ts), [`checkpoints.ts`](../src/main/private-agent/checkpoints.ts), [`observations.ts`](../src/main/private-agent/observations.ts), [`progress.ts`](../src/main/private-agent/progress.ts) |
| Public sources | [`network-resolver.ts`](../src/main/private-agent/network-resolver.ts), [`public-sources.ts`](../src/main/private-agent/public-sources.ts) |
| Research claims ledger | [`claims.ts`](../src/main/private-agent/claims.ts): ledger schema, host quote check (`check_claims` tool and finish check), retained public sources restored by the host under `sources/`; `judgeClaims` is the entailment pass the session runs after submission |
| Recoverable dispatch | [`broker.ts`](../src/main/private-agent/broker.ts) `request()` retry loop and `transport()` failure classification; [`store.ts`](../src/main/private-agent/store.ts) `superseded`/`failed` statuses and `isResolvedDispatch` (owner decision D4) |
| Owner surface | [`controller.ts`](../src/main/general-tasks/controller.ts) projections (`projectAgentText`, `actionDetail`, `reportedIssues`), per-task profile; [`App.tsx`](../src/renderer/src/App.tsx) default surface and Labs gate; [`scripts/setup-general.ts`](../scripts/setup-general.ts) doctor |
| Optional consultation | [`consultant-config.ts`](../src/main/general-tasks/consultant-config.ts), [`consultation.ts`](../src/main/private-agent/consultation.ts), [`consultant-model.ts`](../src/main/private-agent/consultant-model.ts) |
| Bundle construction/export | [`artifact-bundle.ts`](../src/main/general-tasks/artifact-bundle.ts), controller and native-save IPC above |
| Separate coding pilot | [`patch-runs`](../src/main/patch-runs), coding runtime/scripts and renderer |
| Retained investigation/review | [`run-session.ts`](../src/main/agent/run-session.ts), change-review providers and session/event store |

Do not delete the coding and review paths as apparent duplicates: they remain
wired product surfaces with separate permissions and evidence. Their proofs do
not transfer to General task.

Important current constraints:

- One active desktop general task. Budgets come from the configured coordinator
  profile (`SOAR_GENERAL_TASK_PROFILE`, see
  [`profiles.ts`](../src/main/private-agent/profiles.ts)): `standard` is the
  September configuration (20 model calls, 30 tool actions, 15 minutes, 40 session
  requests, thinking off, 4,096 output tokens, 300 s per request); `heavy`, the
  default since 2026-10-06, is 80 calls, 120 tools, 90 minutes, 200 session
  requests, thinking on, 16,384 output tokens, 900 s per request. Resume retains
  the original deadline and counters. Every result recorded before 2026-10-06 was
  measured under `standard`.
- Since 2026-10-06 a reply without exactly one tool call, or one cut at the output
  limit, is nudged (durably, at most 3 or 2 times in a row) instead of ending the
  task, and a command that exceeds its 180 s limit returns exit 124 as an
  observation instead of destroying the workspace. `write_file`, `append_file`
  and `str_replace` write files without shell quoting.
- Docker tools are offline, non-root and isolated. Internet access is a host
  broker capability, not an intrinsic capability of the local model/container.
  Public retrieval permits up to three exact admitted URLs and five fetches,
  64 KiB each. There is no general search/link-following tool.
- The model sees a bounded prefix of fetched sources. The execution-observation
  reader cannot read omitted public-source tails. This is a capability gap, not
  an established cause of the rejected research report.
- The built-in desktop check preserves input hashes and requires a nonempty
  primary file. `independentAcceptance` stays `not_evaluated`; task-specific
  correctness and rendered/interactive quality are evaluated outside the app.
- Export requires stopped execution, confirmed cleanup and matching artifact or
  manifest identities. Inert previews do not exercise website behavior.
- Unknown dispatches, changed runtime/configuration, exhausted budgets and
  unresolved progress can prevent resume. Rebuilding is not permission to resume
  a saved task against different code. No replay of uncertain requests.
- Real-private storage/retention and deletion controls remain unfinished.

## Setup and safe verification

Use **Node 22.22.2 and pnpm 10.12.4** for the established verification path.
The default shell during this handoff selected Node 26; a verified Node 22 binary
was selected explicitly for checks. Do not diagnose its native-module ABI errors
as product failures or persist a developer's absolute runtime path in the repo.

From the repository, after the existing dependencies are installed:

```sh
node --version
pnpm --version
pnpm validate:readiness
pnpm validate:build-log
pnpm typecheck
pnpm exec vitest run tests/unit/private-agent-progress.test.ts --maxWorkers=1
```

For a future bundle change, the focused host suite is:

```sh
pnpm exec vitest run tests/unit/general-task-controller.test.ts tests/unit/general-task-ipc.test.ts tests/unit/general-task-bundle.test.ts --maxWorkers=1
```

These commands do not constitute a release gate. `pnpm check` is broader;
`pnpm check:release-head` requires an appropriate committed, clean exact-head
state. Actual Electron checks require GUI/loopback access and the repository's
serialized wrapper. Do not retry worker-startup timeouts indefinitely or describe
unstarted assertions as passing.

Normal app entrypoint is `pnpm dev`, after intentionally preparing its runtime.
General task needs the configured local coordinator, owned-zero-fee declaration
and an already installed immutable Linux Docker image selected by
`SOAR_GENERAL_TASK_IMAGE_ID`. Readiness does not download it or prove model
connectivity. `pnpm dev:patch` is a separate cloud-only coding launch.

Consultation configuration belongs only to the launching process environment,
using separate `SOAR_GENERAL_CONSULTANT_*` fields. Old coding credentials,
Keychain setup and another Terminal's environment do not automatically carry
over. The [consultant setup guide](MVP_GENERAL_CONSULTANT_SETUP.md) documents safe
entry and `pnpm check:general-consultant`, which checks syntax without printing
values or sending a request. A `ready` result proves neither provider support nor
valid credentials/prices. There is no settings screen for this profile yet.
Keep keys and private endpoints out of commands, logs, tracked files and handoffs.

## Experiment process and next milestone

The strong part is the separation of permissions, accounting, unknown outcomes
and independent acceptance, with failures preserved. The weak part is learning
throughput: repeated wrapper, observation and export qualification has displaced
useful task completion. More host tests cannot answer whether someone can
delegate a job and trust the result.

Proceed in this order; it supersedes older proposed next-step ordering:

1. **Resolve only the blocking operational defect.** Distinguish window loss,
   app-process exit, final persisted task state and container cleanup. Diagnose
   timeout ownership/overrun with a bounded deterministic case. Verify the
   already-built desktop bundle flow once. Stop expanding this work when those
   checks pass; if they cannot be made observable, report the remaining blocker.
2. **Run one fresh representative owner workflow.** Define critical source-based
   requirements before starting. Use the normal app and existing tools, preserve
   the exact exported output, independently check content and format, and record
   owner review and every manual intervention. Use bounded actionable repair
   feedback where supported. File existence is not the success criterion.
3. **Make failure informative.** If infrastructure works but the output fails,
   test one materially different permitted model setting or approved consultation
   hypothesis, or narrow the claimed capability. Do not repeat the same exposed
   task/prompt/profile and call it a fresh evaluation. If infrastructure fails,
   classify that separately and retain uncertainty; do not score model quality.
4. **Extend after useful delivery.** Try a fresh job and the next uncovered task
   family through the same flow. Source discovery and practical setup should
   address observed user needs. Real-private qualification remains a separate
   requirement; public examples do not complete the privacy-first promise.

Success for the next milestone is one useful checked output, an observable
permitted route, exact delivery and explicit intervention/acceptance evidence.
It is not a new router, another filter benchmark or another export framework.
Before gated runtime or spending, inspect the applicable plan and durable
approval; old proposed budgets and one-use trial approvals are not reusable
allowances. This cleanup launched no new experiment.

## Evidence index

Read these scoped reports for detail:

- [Desktop support audit](MVP_GENERAL_TASK_DESKTOP_REPORT.md),
  [research result](MVP_DESKTOP_PUBLIC_RESEARCH_REPORT.md),
  [deck and website results](MVP_DESKTOP_ARTIFACT_DELIVERY_REPORT.md).
- [Website repair](MVP_LOCAL_WEBSITE_REPAIR_REPORT.md),
  [subsequent no-artifact run](MVP_LOCAL_WEBSITE_REPAIR_V2_REPORT.md), and build-log
  entries `BL-20260914-0628-local-website-repair-v3-failed` /
  `BL-20260914-0640-local-website-late-state-correction` for the last trial.
- [Bundle implementation](MVP_ARTIFACT_BUNDLE_REPORT.md),
  [consultation mechanics](MVP_GENERAL_TASK_CONSULTATION_REPORT.md),
  [consultation preparation](MVP_GENERAL_CONSULTATION_TRIAL_PREPARATION_REPORT.md).
- [Privacy boundary](MVP_PRIVATE_AGENT_BOUNDARY_REPORT.md) and
  [privacy-filter assessment](PRIVACY_FILTER_RESEARCH.md).

Local-only receipt pointers below are relative to `.soar/private-agent-evidence/`.
They are intentionally ignored and absent from a clone. Do not commit raw traces,
evaluator gold, generated databases/artifacts or their private configuration.

| Question | Receipt |
| --- | --- |
| Accepted support report | `desktop-general-v1/live-task/acceptance.json` |
| Accepted deck / rejected first website | `artifact-request-recovery-v1/milestone-result.json` |
| Rejected research | `desktop-public-research-v1/live-task/assessment.json` |
| Early website controller loss | `local-website-repair-v3/run/result.json` |
| Later final task state | `local-website-repair-v3/review/failure-audit-v1.json` |
| Bundle host verification and source bindings | `artifact-bundle-v1/implementation-verification.json` |

## September 28 cleanup and verification

Three independent review lanes checked active architecture, retained evidence
and safe cleanup opportunities. A bounded read-only pass rehashed **24 critical
artifacts, receipts and source bindings, all matching**, including ten current
bundle bindings. This confirms their retained identity, not their quality through
a new evaluator run. No later substantive experiment milestone was found.

Cleanup adds this handoff, makes README/current status links explicit, corrects
stale readiness ordering and removes one unused test-only type import. Twenty-one
ignored Python bytecode cache files (925,087 bytes) were removed only after
checking they were untracked and ignored. Production source, provider settings,
persisted contracts, dependencies and `.soar/` evidence were preserved.

Fresh validation under Node 22.22.2:

| Check | Result and boundary |
| --- | --- |
| `pnpm typecheck` | Passed both node/main and web configurations. |
| `pnpm validate:readiness` | Passed metadata checks; 22 research and 20 coding workload records, no high-confidence secret-pattern match. This is not general-task quality or private-deployment qualification. |
| `pnpm validate:build-log` | Passed; 256 entries, including this handoff/cleanup record. |
| Focused `private-agent-progress.test.ts` | Hit a 60-second startup deadline with no output; process terminated. No assertions ran; test verification remains incomplete. |
| Handoff relative links / `git diff --check` | All handoff targets exist; whitespace check passed. |

Historical bundle, desktop and model results above were not rerun. No new
inference, paid request, network fetch, application launch or Docker run was part
of this handoff. Existing renderer startup failures remain unresolved as well.

The subsequent source-publication work is recorded separately in BUILD_LOG.md.
Its Git network operations and broader check attempt do not rerun the historical
product experiments or qualify the outstanding model and privacy claims.

Publication checks on September 28 found no secret/artifact or integration
blocker in the 248-file candidate set. All staged object IDs matched reviewed
bytes; manifest and whitespace checks passed. Readiness, append-only build-log,
both typechecks and native credential-core checks passed. The 36-test loopback
file passed when run with loopback access. A consultant CLI test had a 5-second
overall deadline despite two 15-second child allowances; its deadline is now
40 seconds with the child limits unchanged, and its ten-test file passes.

Broader verification is incomplete: both full-check attempts reached a
300-second cap, with loopback failures in the restricted run and CLI/local-review
fixture failures in the broader unrestricted run. The normal build separately
hit a 180-second cap in its native build step. These failures remain recorded;
the isolated test correction does not establish their resolution. Publication
is a development checkpoint, not full-suite, fresh-build or release verification.
