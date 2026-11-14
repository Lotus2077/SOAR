# SOAR handoff

## Start here (2026-11-14)

This section is the entrypoint for the next session. It supersedes every earlier
"next step" in this file; the rest of the file is the September 2026 record.

**Planning map.** Steps 2 to 7 of §5 are charted as parallel lanes in the GitHub issue
[Wayfinder map: route the next milestones (E0 to E4) in parallel
lanes](https://github.com/Lotus2077/SOAR/issues/46). Its child issues (#47 to #63) hold
the open owner decisions of §4 and the cards that gate each lane. A ticket's resolution
stays `Proposed` until the owner's build-log entry records it. The lanes' order of work
is in the git-ignored `.soar/next-milestones/plan.md` of the owner's checkout.

### 1. Get the work

`main` is at 6c30bbf, the merge of #95; work from it. Select Node 22.22.2 and pnpm
10.12.4 first ("Setup and safe verification" below): `.npmrc` sets
`engine-strict=true`, so another Node major fails the install.

```sh
git fetch origin main
git checkout main
pnpm install --frozen-lockfile
```

Then run the checks in "Setup and safe verification" below. CI runs only on pull
requests and on pushes to `main`. Base each new pull request on `main` (PLAN.md D10
approves pushing reviewed work to public `main`).

| Merged (UTC) | Pull requests | What |
| --- | --- | --- |
| 2026-11-08 | #37, #38, #40, #41, #42, #43, #44 | Step 1: backlog items 1-5 and item 10's assist-purpose exception; #44 points the handoff at `main` after #39 |
| 2026-11-09 | #65 | SC, the serving-card reader |
| 2026-11-13 | #85, merge train 1 (9d10b9a) | #66 E1-T1, #67 11.1, #68 E1-R, #69 7b.1, #70 E1-J, #71 8.2a, #72 6.1, #73 11.2, #74 E1-L, #76 7a.1, #77 6.2, #78 11.3a, #81 7d.A and #83 (BL-20261110-1506-merge-train-1-integration) |
| 2026-11-13 | #92, #82, #89 | 7d.B; 6.3; 11.3b |
| 2026-11-13 | #94, train 2b | #88 (corrections for #66, #70 and #74), #84 E1-T2, #75 E1-T3 and #80 E1-J2 |
| 2026-11-13 | #79, #93 | 10.a, the assist core; 7c, research pipeline v5 |
| 2026-11-13 | #87, #95 | E0's card, docs/experiments/e0-card-2026-11-13.md; P10-align |

Since #93, `researchProtocolSha256()` is
`505c385abb05484ecb147c07b12c05893e08733f5a818b567c7b28659f3d4b92`, pinned in
tests/helpers/research-protocol-pin.ts.

### 2. Read, in this order

1. [PROJECT_REVIEW_2026-11-05.md](PROJECT_REVIEW_2026-11-05.md): §2 (the goal), §5.2
   (architecture v5), §5.6 (experiments E0-E7, their caps, rules and order), §5.7
   (the backlog) and §5.10 (owner decisions).
2. [PLAN.md](PLAN.md): the owner-direction note in §1 and the envelope in §4.
3. [BUILD_LOG.md](BUILD_LOG.md), by grepping these IDs (the file is about 38,000
   lines): BL-20261107-0650-owner-decisions-review-items-2-5 with its correction
   BL-20261107-0718-correction-owner-decisions-record (what is approved and what
   gates each experiment); BL-20261110-1506-merge-train-1-integration;
   BL-20261113-0937-owner-decision-restamp-unmerged-entries and
   BL-20261113-0938-correction-restamp-rule-dates; BL-20261113-0936-e0-card,
   BL-20261113-1003-e0-card-owner-answers and
   BL-20261113-1023-p10-align-implemented, with the E0 card and issue #57; and
   decision 2 of BL-20261113-0848-correction-e1-train-1-reviews (E1's gate).

### 3. Decided

- **The goal** (review §2; confirmed on 2026-11-07): "Deliver Manus-level results on
  the owner's real work, public deep research first, at a fraction of Manus's cost,
  without private data ever leaving the owned device unless the owner approves the
  exact bytes: the local model does all the volume work at zero fee, and the cloud
  takes only the hardest step, as sealed one-shot packets." Privacy, result quality
  and token cost weigh equally; the 2026-09-29 labelled-data rule and D15 are
  unchanged, and OAJ stays the adoption north star. The ≤ USD 0.50 P50 cost target
  (review §2.3) is proposed and binds only through E4's approved decision rule.
- **Zero-fee local runs need no approval entry** on public, synthetic or
  owner-declared-public inputs within the Heavy caps (PLAN.md §4(c)). Paid runs, real
  private data, new egress destinations and public pushes keep their gates.
- **E3 and E4 are approved** against the Phase 4 harness track line (USD 33, about
  USD 28.4-28.7 left): E3 capped at USD 20.4, E4 at USD 20.5. E4 starts only if the
  line's balance after E3 covers its cap, unless the owner records a reallocation.
  The approval covers the T1 and T2 packets of their cloud-assisted arms, briefs
  included.
- **E4's paid judges** run on OpenAI's API: GPT-5.5 for DeepResearch Bench RACE with
  the key named JAO, and LiveDRBench's grader with the key named JAT. The grader's
  judge model (`--judge` of `benchmarks/harness/evaluate_livedr_row.py`) is proposed
  by E4's card and recorded by the owner before E4 starts.
- **The cloud's role:** E3's rule picks it for the harness, E4's result decides the
  desktop's assist toggle, and the owner decides trades and ties.
- **Re-stamping** (2026-11-13; BL-20261113-0937-owner-decision-restamp-unmerged-entries
  and BL-20261113-0938-correction-restamp-rule-dates). An unmerged branch re-stamps
  its entries after `main`'s tail at merge, date included, with a `Correction` entry
  that records the original IDs. Train 1's sorted union
  (BL-20261110-1506-merge-train-1-integration) was a one-time exception and is not
  reopened.
- **E0's card** (2026-11-13; BL-20261113-1003-e0-card-owner-answers).
  - Decision 1: the endpoint serves the model qualified on 2026-11-04, so E0 is a
    delta check. If P1 or a `--compare-*` row differs, E0 re-derives every bound.
  - The judge fixture's agreement level is 95%. Before the test a cloud model labels
    its claim set through its API, on public and synthetic material only, capped at
    USD 1.00 (the cap is the orchestrator's figure; the owner stated none).
  - Reasoning text is kept, and P10 is aligned with the pipeline's requests (#95).

### 4. Still open, and what each blocks

| Owner decision (review §5.10) | Blocks |
| --- | --- |
| 5, open parts: a reallocation from the weekly public-work line; the LiveDRBench grader's judge model | The reallocation only if the line's balance after E3 settles is below USD 20.5; the model before E4 starts |
| 6: which provider carries the assists and E3's arm D | E3's card |
| 7: a thinking-off writer arm | That E2 arm only |
| 8: SearXNG or a keyed search API | Backlog item 12's search destination (R2) and E4 |
| 9: the P11 transport timeline | Any labelled work |
| 10: the Manus product baseline | The E4 option only |
| 11: blind proxy grades as provisional | E3's and E4's verdicts |
| 12: numbered briefs; disclosing the public brief | Task authoring (D11's brief units) and the desktop's first assist packet on a public task (item 13) |
| 13: the Phase 2 dashboard reconciliation; D20(b) | The uncached all-cloud baselines (USD 3.05-3.77); T3 and any coding on private source code |
| 2, last part: whether the assist toggle starts on | The toggle's default for URL-backed public tasks (item 13), once E4 ships a cloud-assisted arm |

- **Owner-only Docker-gated runs, none run yet:** #74's sandbox suite, #81's
  document-review suite, #73's runtime freeze `git` assertion and #72's general-task
  e2e assertion.
- **Train 1's owner questions:** see the git-ignored
  `.soar/next-milestones/reviews/train-1/owner-decisions-train-1.md`.
- **Later owner questions**, each default standing until answered:
  - #89, question (b) of BL-20261113-0836-infra-resume-design: criterion 7 reads
    `activeSeconds` for a resumed loop. It amends E3's and E4's approved rules, so it
    needs the owner's own answer.
  - #92 (BL-20261110-1509-host-flags-event-design): D11 (#55) keeps the segmentation
    and flags single-unit briefs; "misses" means the run's own misses.
  - #88 (decision 2 of BL-20261113-0848-correction-e1-train-1-reviews): when a fix
    changes LIST_FILES, E1's gate waits for that fix's Docker run, recorded `Verified`.
  - #80 (decision 6 of BL-20261113-0856-claims-trailing-strip-linear-design): the
    claims check's other slow patterns go in one follow-up PR.
- **Open drafts from another session:** #86 (the Rayline evaluation; it also edits
  this section, so whichever merges second resolves the conflict), #90 (the doctor)
  and #91 (the judge fixture).

### 5. Act next, in this order

Follow the order in review §5.6. Each step is done when its condition holds.

1. **Backlog items 1-5 and item 10's assist-purpose exception.** Done on 2026-11-08.
2. **E0** from the owner's Mac, at zero fee, per its card. Done: a serving card that
   records the alias, engine version and context, never the address, with every stage
   bound re-derived from it or, for the delta check, matched to 2026-11-04.
   - Done: the card (#87) and P10-align (#95).
   - The owner's remaining steps, in order:
     1. Produce the current-format r3 research index with one zero-fee local research
        run (the command is in #95's description; the r3 task directory is
        `.soar/experiments/phase2-v1/tasks/r3-grid-batteries` in the owner's
        checkout), then pin docs/experiments/e0-planner-fixture-v1.json. Which brief
        it pins is open (BL-20261113-1023-p10-align-implemented, (5)).
     2. For the judge: #91 merges, then the cloud labelling.
     3. The probes, per issue #57: P1 alone first, checked by hand; then P1, P10, P11
        and the adapter probe in one invocation after `pnpm probe:export-schemas`;
        then `pnpm probe:assess`; then the card writer with the `--compare-*` flags.
   - No PR that changes `researchProtocolSha256()` may merge between the export and
     the assessment; 7b.2, 7a.2 and item 9 will change it.
3. **E1**, the recoverability tests with no live model. Every E1 test and fix PR is
   merged. Progress, 2026-11-14: E1-G,
   BL-20261114-1253-e1-recoverability-gate-ci-verified, records the four gate clauses
   `Verified` in CI and maps each one to named tests. Under #88's default the gate
   stays held, with no E2 to E6 live run and no harness loop, until the owner's Docker
   run of E1-L's sandbox suite (tests/integration/private-agent-sandbox.test.ts; the
   command and image are in that entry) is recorded `Verified`. Done: its gate in
   review §5.6 passes.
4. **E5** on the existing local routes in the owner's desktop build, with item 2's
   verdict capture. Not started. Ask the owner about the P11 interim (decision 9) and
   the box checklist (PLAN.md D5); both gate labelled work only.
5. **E2 and E6** (cards #62 and #54), backlog items 6-11, and the start of item 12.
   - Done: 6.1, 6.2, 6.3, 7a.1, 7b.1, 7c, 7d.A, 7d.B, 8.2a, 10.a, 11.1, 11.2, 11.3a
     and 11.3b.
   - Remaining, as the entries name them: 7a.2, 7b.2, 7b.3, 7d.C, 8.1, 8.2b, item 9,
     10.b, 11.4, the part 5 launcher (11.5) and RA (the assist receipt fields). The
     lane plan puts item 9 last in S-pipe's sequence, after 7b.2 and 7a.2.
   - E2 and E6 have not run, and item 12 has not started.
6. **E3** waits as before: items 6-11 done (10.b and item 11 among them), decisions 6
   and 11 made, and its card (#63) committed, naming the provider and D's call
   allowance with a projected fee under USD 3.00 on f2.
7. **E4** waits as before: E3 settled and the line covering E4's cap (or a recorded
   reallocation), decision 8 made, items 11 and 12 done, its cloud-assisted arm
   chosen, the grader's judge model recorded, and its card, with the RACE threshold
   (review §2.2, criterion 4), committed. Then item 13, the desktop wiring.

### 6. Rules for every step

- Follow `AGENTS.md` and the log rules at the top of BUILD_LOG.md: UTC entry IDs,
  append-only entries, and corrections only as new `Correction` entries. Keep
  `Proposed`, `Approved`, `Implemented`, `Verified` and `Released` distinct.
- The endpoint's address lives only in the owner's ignored `.env.local`
  (`SOAR_VLLM_BASE_URL`, `SOAR_VLLM_MODEL`, `SOAR_VLLM_COST_POLICY=local_zero_cost`);
  the JAO and JAT keys only in the owner's local configuration. Never commit or log an
  address, a key, a local path, a raw trace or gold.
- Pre-register every experiment, zero-fee ones included: commit its card before it
  runs, and write one registry row per run. Run paid work only inside an approved cap.
- Before pushing, `git fetch` (other sessions move `origin/main`), then run
  `pnpm --silent validate:build-log -- --base-ref origin/main`, `pnpm typecheck`,
  `pnpm validate:readiness` and the tests for what changed. Gate on the validator's
  own exit status, never through a pipe (BL-20261113-0938-correction-restamp-rule-dates).
- The owner's process choices, made in the orchestrating session's chat and not in
  the log:
  - Lighter reviews (2026-11-10): one reviewer per PR, a skeptic only for a blocker
    or major finding, and privacy findings always checked.
  - Merging (2026-11-13): merge a lane PR with a merge commit once its review is clean
    and CI is green.
- Practice that worked on 2026-11-13, not an owner decision:
  - The owner's permission settings refuse a force-push, so bring `main` into a branch
    with a merge, never a rebase that needs one.
  - When several branches are ready, the lanes re-stamp into reserved, ascending
    minute blocks and one integration PR lands them with one CI run.

### 7. Known limits

- Of the work merged since 2026-11-07, only E1's gate clauses are `Verified`, and only
  in CI (BL-20261114-1253-e1-recoverability-gate-ci-verified); E1's gate itself is
  held. The last `Verified` entry before it, and the last Docker-verified one, is
  BL-20261107-1111-stop-bricking-tasks-docker-suite-verified. No live, Docker or paid
  run has happened since 2026-11-07, and the approved cloud labelling has not run.
- The harness source-freeze digest moved with every code merge from #85 to #93 (#87
  and #95 leave it unchanged): recompute `--runtime-sha256` before any loop or E-run.
- The research protocol hash changed with train 1 and again with #93: a research run
  directory from before #93 no longer seeds, and a research session paused before it
  resumes as `session_contract_drift`.
- Five adversarial checks of the 2026-11-05 review converged, but each check after
  the first covered only the previous revision's changes.

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
