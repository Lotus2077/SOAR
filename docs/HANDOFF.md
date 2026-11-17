# SOAR handoff

## Start here (2026-11-17)

This section is the entrypoint for the next session. It supersedes every earlier
"next step" in this file; the rest of the file is the September 2026 record. "The
session" below is the orchestrating session: the one that coordinates the lanes, runs
the experiments on the owner's Mac and talks to the owner. The next session takes that
role.

**Superseding note (2026-11-17, after this section was written).** The owner has since
given one direction on every question §4 lists: each recommended answer and each
proposed card value is accepted, and the session decides the rest
(BL-20261117-0940-owner-direction-decisions-delegated). The session's choices for
the questions no source decided are in
BL-20261117-0941-group-a-decided-under-delegation. #105's residues, which §4 keeps
for the owner's explicit answer, are the session's choice under that delegation and
are put to the owner by name. E5's, E2's and E6's cards are `Approved`
(docs/experiments/e5-card-2026-11-17.md, e2-card-2026-11-17.md and
e6-card-2026-11-17.md), and two more Docker-gated suites are `Verified`
(BL-20261117-0942-document-review-and-runtime-suites-docker-verified). What stays
the owner's is decision 7 of the first entry, with the tag push for E5's build, the
serving card's adoption commit and the first query to a new search destination, each
asked by name. Where this section says a question is open, a card does not exist or a
step waits for the owner, those entries govern until the section is restated.

**In brief.**
- **State.** E0 has run every step of its card, and BL-20261116-1357-e0-verified closes
  it. Its serving card is `proposed`, so no run reads it. E1's gate is released. No card
  exists for E5, E2, E6, E3 or E4, and each waits for an owner answer (§4).
- **First,** see what moved: `gh pr list --state open`, `git log --oneline -5
  origin/main` and the log's tail (`grep -n '^### BL-' docs/BUILD_LOG.md | tail -5`).
  Ask the owner which of the fourteen open questions (§4: the twelve topics and
  questions 13 and 14) now has an answer. Question 15 is answered (§3). Record each
  answer in an `Approved` entry, quoted, before acting on it.
- **Second,** ask the owner for the serving card's two answers: whether it is adopted,
  and with which planner settings. Both were put on 2026-11-16 with Amendment 4's two
  results, as questions 6 and 13 of the summary, and neither is answered (§5 step 2).
- **Third,** do the work that needs no owner answer: lane pull requests under the
  standing go-ahead, and the E5, E2 and E6 cards as `Proposed` drafts with every
  open value marked.
- **Not without the owner:** a run in E5, E2, E6, E3 or E4; a card value with no sourced
  default; merging an experiment's card or the adoption commit; K above 1; the three
  Docker-gated suites not yet run; #105's residues; anything paid beyond an approved
  cap, a new egress destination or real private data.

**Planning map.** Steps 2 to 7 of §5 are charted as parallel lanes in the GitHub issue
[Wayfinder map: route the next milestones (E0 to E4) in parallel
lanes](https://github.com/Lotus2077/SOAR/issues/46). Its child issues (#47 to #63) hold
the open owner decisions of §4 and the cards that gate each lane; #48 to #51 are closed.
A ticket's resolution stays `Proposed` until the owner's build-log entry records it. The
defaults adopted on 2026-11-15 (§4) are recorded in the log only, not on the tickets.
The lanes' order of work is in the git-ignored `.soar/next-milestones/plan.md` of the
owner's checkout.

### 1. Get the work

`main` is at d14ad42, the merge of #132; work from it. Select Node
22.22.2 and pnpm 10.12.4 first ("Setup and safe verification" below): `.npmrc` sets
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
| 2026-11-14 | #96 | This section, restated for `main` at 6c30bbf |
| 2026-11-14 | #99, #98, #101, #104 | 7d.C; 11.5, the experiment launcher; 8.1; 11.4 |
| 2026-11-14 | #107, #109, #112 | The racy-git test fix; E1-J2's decision 6, the claims check's six other slow patterns; long character references in the claims check |
| 2026-11-14 | #91, #90, #106 | E0's judge fixture; the doctor; corrections to this section |
| 2026-11-14 | #111, #97, #100 | The SC settings binding; E1-G; 6.4 |
| 2026-11-15 | #113 (d92a3af) | This section, restated for `main` at b7c0431 |
| 2026-11-16 | #114 (f5082e8), #102 (b487f75) | The owner adopts every standing default and answers E0's three questions, and E1-L is Docker-verified; 7b.2, the priority trim with disclosed omissions, coverage v3 and the presentation guard |
| 2026-11-16 | #115 (30002a7), #118 (a355074), #117 (6a96098, the one squash) | E0's judge labelling tool, `pnpm label:judge`; E0 card Amendment 1 and the r3 runs' record; registry-row.py's probe, fixture and labelling rows |
| 2026-11-16 | #121 (42b36e7, with #120's commit 7bb3c73), #122 (5bc5088) | The serving card of 2026-11-16 (proposed), Amendment 2, the labelling, the judge pin and the planner and judge fixture results; the planner fixture reads a null reply content as empty text |
| 2026-11-16 | #116 (fe0ceb0), #124 (a372a1e) | E0's extractor fixture, `pnpm fixture:extractor`; Amendment 3 and the owner's directions of 2026-11-16 |
| 2026-11-16 | #119 (267a288), #103 (1c2277c), #108 (860ec58), #110 (36e194b) | 7d.D, host flags count what 7b.2's trim left out; 7a.2, per-role caps and thinking from an adopted card; item 9, `response_format` per local research role; 8.2b, K zero-risk local calls at a time |
| 2026-11-16 | #123 (2e2d75c), #125 (7e75a47) | The serving probe connects directly and classes an early-ended P10 stream; E0 fixture cells that send `response_format` (v2 manifests) |
| 2026-11-16 | #127 (100e00a), #126 (a7a21f3) | 8.2b's follow-ups from #110's skeptic check; E0's extractor result and its closing `Verified` entry |
| 2026-11-16 | #128 (da30c9d), #129 (daab44e, carried by #130's merge), #130 (b2e1d1e), #131 (7ef19ea) | Run rows record the protocol hash, the loaded card and K, and the doctor checks a card through the driver's own loader; E0 card Amendment 4; tests that pin the planner fixture's `--cache-salt`; the two `response_format` fixture runs' rows and result |
| 2026-11-17 | #132 (d14ad42) | This section, restated for `main` at 7ef19ea, with Amendment 4's two runs verified |

`researchProtocolSha256()` last changed with #102 (7b.2). Its default is
`7100b7a2584b8afaea9ea8b79a31d676204448a1a203a4d9ef7206cda3c24aa5`, pinned in
tests/helpers/research-protocol-pin.ts.

- **What moves it:** a change to the research protocol itself, as 7b.2's was. By the
  lane plan, not yet by code, 7b.3 moves it only under a card and 10.b only under a
  configured assist.
- **What does not:** 7a.2 (#103), item 9 (#108) and 8.2b (#110) left the default as it
  was, and K is never in the hash (BL-20261116-1213-local-fanout-design).
- **A carded run binds another hash:** a card that sets a cap, a thinking mode or a
  structured-output flag binds its role policy into that run's hash
  (BL-20261116-1203-research-role-policy-design for a cap or thinking; decision (6) of
  BL-20261116-1208-research-structured-output-design for a flag). The proposed card
  does, by its flags.

### 2. Read, in this order

1. [PROJECT_REVIEW_2026-11-05.md](PROJECT_REVIEW_2026-11-05.md): §2 (the goal), §5.2
   (architecture v5), §5.6 (experiments E0-E7, their caps, rules and order), §5.7
   (the backlog) and §5.10 (owner decisions).
2. [PLAN.md](PLAN.md): the owner-direction note in §1 and the envelope in §4.
3. [BUILD_LOG.md](BUILD_LOG.md), by grepping these IDs (the file is more than 47,000
   lines; never read it whole). A correction governs the entry it corrects.
   - BL-20261116-1357-e0-verified, first and in full: what E0 found, what it did not,
     and its Next gate. It cites the run entries. Then
     BL-20261116-1441-e0-card-amendment-4 (Amendment 4) and
     BL-20261116-1546-e0-structured-fixtures-result (its two runs' results).
   - BL-20261116-0939-e0-probes-serving-card, corrected by
     BL-20261116-1017-correction-e0-probes-serving-card-review: the probes and the
     proposed serving card.
   - BL-20261115-1937-owner-adopts-standing-defaults, corrected by
     BL-20261116-0812-correction-owner-defaults-review: the defaults adopted, E0's three
     owner answers and what stays open.
   - BL-20261115-1938-e1-l-sandbox-suite-docker-verified: E1's gate released.
   - BL-20261116-0814-e0-card-amendment-1, decision 3: the merge go of 2026-11-16.
   - BL-20261117-0530-owner-merge-go-handoff-restatements, as
     BL-20261117-0539-correction-owner-merge-go-review corrects it: the merge go for
     handoff restatements, and what it does not cover.
   - BL-20261116-1131-owner-directions-merge-and-continue, corrected by
     BL-20261116-1159-correction-e0-amendment-3-pre-run-review: the owner's two
     directions, what they do not lift, and the open topics.
   - BL-20261116-1216-correction-local-fanout-restamp and
     BL-20261116-1331-correction-local-fanout-skeptic-followups: what the lane queue
     left on `main`, and what is unmeasured at K above 1.
   - BL-20261107-0650-owner-decisions-review-items-2-5, corrected by
     BL-20261107-0718-correction-owner-decisions-record: what is approved and what
     gates each experiment.
4. E0's card with its four amendments (docs/experiments/e0-card-2026-11-13.md), the
   serving card (docs/experiments/serving-card-2026-11-16.md and .json) and issue #57,
   whose resolution predates Amendment 4's two runs.

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
  included. E0's labelling was charged to another line, so this one is untouched.
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
- **E0's card** (2026-11-13; BL-20261113-1003-e0-card-owner-answers), now with
  Amendments 1 to 4.
  - Decision 1: the endpoint serves the model qualified on 2026-11-04, so E0 is a
    delta check. If P1 or a `--compare-*` row differs, E0 re-derives every bound.
  - The judge fixture's agreement level is 95%. A cloud model labelled its claim set,
    public and synthetic material only, capped at USD 1.00. The cap is the
    orchestrator's figure; the owner stated none, and the option chosen on 2026-11-15
    names it.
  - Reasoning text is kept, and P10 is aligned with the pipeline's requests (#95).
- **The owner's blanket answer of 2026-11-15:** "all go by default; start the
  experiments asap" (BL-20261115-1937-owner-adopts-standing-defaults, as
  BL-20261116-0812-correction-owner-defaults-review corrects it).
  - Every question with a stated default takes that default, and the owner may replace
    any of them with a recorded answer. The owner did not read each default.
  - `Approved` covers the adoption, the three answers below and the direction to start.
    That direction started E1-L's Docker run and E0 (decision 5).
  - PLAN.md §5 bounds it: "Defaults apply only to non-gated planning. They never
    authorize live, paid, private or publication actions." §4 below lists what stays
    open.
- **E0's three owner answers** (2026-11-15; decision 2 of that entry), each the
  recommended option of a question the session wrote: 7b.2 merged before the export;
  the labeller was `gpt-6-sol`, its USD 1.00 cap charged to PLAN.md §4's synthetic-data
  line; the planner fixture pinned the stage brief. All three are applied. The owner's
  go for the paid run was "Key stored, go ahead"
  (BL-20261116-1013-e0-judge-labelling-and-pin).
- **The merge go of 2026-11-16** (decision 3 of BL-20261116-0814-e0-card-amendment-1).
  The session asked: "May I merge #114 now, then the E0 record PRs that follow it (#102
  is a lane PR and merges under your standing go-ahead), each once its review is clean
  and CI is green?" The owner answered "Yes, merge them (Recommended)".
  - It covers the session's E0 record pull requests (amendments, run records and
    corrections), each after a clean light review and green CI.
  - Lane pull requests keep the standing go-ahead of 2026-11-13. "Squash-merge #117
    (Recommended)" departs from merge commits for that pull request only.
  - Whether it covers a later experiment's card is open (§4, topic 12).
- **The owner's directions of 2026-11-16:** "merge when green, then continue with the
  lane queue" and "when all current tasks are done, keep continue the experiments"
  (BL-20261116-1131-owner-directions-merge-and-continue, as
  BL-20261116-1159-correction-e0-amendment-3-pre-run-review corrects it).
  - `Approved` covers the two quotes only. The reading is the session's, until the
    owner replaces it: after E0's remaining steps it goes on to the next experiments
    in §5's order, unprompted.
  - Zero-fee local runs within the Heavy caps proceed once their card is committed. A
    card value with no sourced default is put to the owner, not filled in. That is the
    narrower of two readings, and the session has asked which is meant (§4, topic 1).
  - Neither direction lifts: anything paid beyond an approved cap, any new egress
    destination, any real private data, #105's residues, the review's decisions with no
    default, or any change to a rule the owner approved.
- **The merge go for handoff restatements** (2026-11-17;
  BL-20261117-0530-owner-merge-go-handoff-restatements). After merging #132 the
  owner wrote: "you may merge a handoff restatement myself on a clean review and green
  CI".
  - `Approved` covers the quote only. The reading below is the session's, until the
    owner replaces it.
  - It covers a pull request that restates this section, with the entries that record
    the restatement, once its light review is clean and CI is green.
  - It does not cover an experiment's card, the serving card's adoption commit, or any
    other pull request that is not a lane PR or an E0 record (§6).
- **What E0's runs settle under its card's rules** (the Decisions of
  BL-20261116-1357-e0-verified). The readings are the session's, not the owner's.
  `Verified` covers only that the thirteen rowed runs happened and gave the measurements
  stated; it covers no decision.
  - The 2026-11-04 figures stay admissible: P1's four identity fields and the three
    compare rows match (decision 1). The match does not show identical weights.
  - The judge did not reach its level: 38 of 60 claims, 63.3%, against 95%. So the
    judge stays evidence-only: criterion 8's judge threshold does not apply in E3 and
    E4, nor criterion 3's in E4 (decision 7).
  - K stays 1, the card writer's proposal. Any K above 1 is the owner's (decision 6).
  - Extraction keeps the deployed call, thinking off at 2,048 tokens: of Amendment 3's
    four thinking conditions, none completed more first attempts overall (decision 3).
    That is not a finding that the call is adequate: it completed 10 of 30 first
    attempts. The same call with `response_format` was measured afterwards (§5 step 2).
  - The legacy reply shape stays, as the session's procedural choice (decision 5).
- **Not decisions,** though that entry reports them:
  - The serving card of 2026-11-16 is `proposed`. Adopting it as written is the owner's
    call (decision 9).
  - The thinking policy for planning and for synthesis is not settled (decision 3).
    Structured output was a proposal measured on synthetic input when that entry was
    written (decision 4). Amendment 4's runs then measured the plan call on the real r3
    index and the extract call on the fixture's chunks (§5 step 2).
  - Whether E0 shows a role-level gap, which would restart serving-recipe work, is the
    owner's call (decision 8). So is reconsidering cloud claim verification.

### 4. Still open, and what each blocks

| Owner decision (review §5.10) | Blocks |
| --- | --- |
| 5, open part: the LiveDRBench grader's judge model | E4's start. The reallocation's adopted default is none: E4 starts only if the line's balance after E3 covers USD 20.5 |
| 6: which provider carries the assists and E3's arm D | E3's card (#63) |
| 8: SearXNG or a keyed search API | Backlog item 12's search destination (R2) and E4 |
| 9: the P11 transport timeline (#52) and the box checklist (PLAN.md D5) | Any labelled work, E5's among it |
| 10: the Manus product baseline | The E4 option only |
| 11, open parts (#53): the sample the owner grades, the second-verdict policy, `verdictBy`, what E5 records | E3's and E4's verdicts, and E5's records |
| 12, second part: disclosing the public brief from the desktop | The desktop's first assist packet on a public task (item 13) |
| 13: the Phase 2 dashboard reconciliation | The uncached all-cloud baselines (USD 3.05-3.77) |

None of these has a stated default, so the blanket answer left each open (decision 3
of BL-20261115-1937-owner-adopts-standing-defaults).

- **Defaults adopted on 2026-11-15** (decision 1 of that entry, as decision 4 of
  BL-20261116-0812-correction-owner-defaults-review corrects it):
  - Review §5.10: no reallocation (5), no thinking-off writer arm (7), and proxy grades
    are provisional (11). Keep the segmentation and flag single-unit briefs (12, first
    part). D20(b) stands, so T3 and coding on private source code stay blocked (13). The
    assist toggle starts off (2, last part).
  - Every "later owner question" the restatement of 2026-11-15 listed: #89's question
    (b), #92's D11 reading, #97's E1-1, E1-2, E1-3 and E1-6, #98's launcher values,
    #101's four ASSIST defaults, #104's three and #100's Revoke rule.
  - 7b.2's rule that an incomplete chunk still ends `research_extraction_incomplete`.
  - #89 (b) amends E3's and E4's approved rules: criterion 7 reads `activeSeconds` for
    a loop with resumes or void starts. The entry takes the blanket answer as the
    owner's own answer.
  - E1-2 keeps two obligations: 10.b re-proves clause 3 end to end under the same
    describe name, and E3's card cites that test.
  - E1-6 stays a condition on the gate: a fix that changes LIST_FILES needs its own
    Docker-gated run on the owner's Mac, recorded `Verified` (decision 2 of
    BL-20261113-0848-correction-e1-train-1-reviews).
- **What the adoption does not cover:** any question with no stated default, and any
  live, paid, private or publication action (PLAN.md §5). #105's 13 residues are not
  covered: accepting them is a privacy exposure only the owner's explicit answer can
  take. ASSIST-6 and ASSIST-8 stand as defaults only: they act when 10.b dispatches,
  and the owner's answer on #105 confirms or replaces them.

**The twelve owner questions of 2026-11-16.** None is answered. They are in the
git-ignored `.soar/next-milestones/owner-questions-2026-11-16.md` of the owner's
checkout, which the session updated after the two runs and which now holds three more
(below the table); decision 5 of BL-20261116-1131-owner-directions-merge-and-continue
lists the topics. The finer wording below is the summary's, which the log does not
hold. Train
1's list and the summary of 2026-11-15 are git-ignored there too; the blanket answer
covered the summary's defaulted questions.

| Topic | Blocks |
| --- | --- |
| 1. How far the second direction of 2026-11-16 ("keep continue the experiments") reaches for card values with no default | Whether the session may fill such values in E5's, E2's and E6's cards |
| 2. E5: which build, the row conventions, what "3 of 5" counts, the stop rule, how a job that never submits is recorded | E5's card and its start |
| 3. E2's card values, with writer-2's bound, which E0's card does not give | E2's card (#62) |
| 4. E6's card values and its planted-defect scorer | E6's card (#54) |
| 5. The incomplete-chunk rule | No step: the adopted default stands until an answer is recorded |
| 6. The planner's settings when the serving card is adopted | The adoption commit, and with it every run under a card |
| 7. #105's 13 residues | #105, 10.b, RA and E3's "items 6-11" condition |
| 8. Decision 6: the assist provider and arm D's allowance | E3's card (#63) |
| 9. Decision 11's open parts | E3's and E4's verdicts, and what E5 records |
| 10. Cloud claim verification, now that the judge is evidence-only | E3's and E4's cards |
| 11. E4's decisions | E4's card |
| 12. Whether the session may run the remaining Docker-gated no-model suites; whether the merge go covers card pull requests | Those three runs; merging a later experiment's card without asking |

Added to the summary after the two runs, as its questions 13 to 15, with question 6
rewritten around the results: whether the serving card is adopted and with which
planner settings (put to the owner on 2026-11-16 as questions 6 and 13 of the updated
summary, and not answered; BL-20261116-1637-correction-handoff-start-here-final-check
records that they were put); whether the reader should refuse a flagged card at K above
1 until a burst is measured with `response_format`, the choice lane S-assist left open
(BL-20261116-1331-correction-local-fanout-skeptic-followups); and whether the session
may merge a handoff restatement on a clean review and green CI, which the owner
answered on 2026-11-17 (§3). The first blocks the adoption commit. Not put to the
owner yet: whether E0 shows a role-level gap (Next gate, step 7, of
BL-20261116-1357-e0-verified).

- **Docker-gated runs.** One of four has run: E1-L's sandbox suite (#74) passed 18 of
  18 on the owner's Mac at d92a3af and is recorded `Verified`
  (BL-20261115-1938-e1-l-sandbox-suite-docker-verified). Not run: #81's document-review
  suite, #73's runtime freeze `git` assertion and #72's general-task e2e assertion.
  #127 edits tests/integration/private-agent-runtime.test.ts, a Docker-gated suite,
  without running it.
- **Open pull requests:**
  - #105 (scrub policy 5, for 10.b's scrubber gate), a draft at 44240e4 that conflicts
    with `main`. It waits for the owner's answer on its 13 residues and blocks 10.b.
    Its rules are frozen. It merges `main` in and re-stamps when its merge is scheduled.
  - #86 (the Rayline evaluation), a draft at 2dd2de9 that conflicts with `main`. It
    also edits this section, so it resolves that conflict and re-stamps at merge. §7
    notes its entry.
- **Lane work that needs no owner answer:** 7b.3 (card-derived admission), not started,
  with no blocker named in any entry now that 7a.2, item 9 and 8.2b are merged; and lane
  S-pipe's three small points from #130's review (decision 4 of
  BL-20261116-1559-correction-e0-planner-fixture-salt-pin-run-attribution).
- **Waiting on topic 6:** a schema-export option for a P10 plan cell at 16,384 tokens,
  which would be new lane work.
- **Blocked:** 10.b and RA, behind #105 (topic 7).

### 5. Act next, in this order

Follow the order in review §5.6. Each step is done when its condition holds.

1. **Backlog items 1-5 and item 10's assist-purpose exception.** Done on 2026-11-08.
2. **E0** from the owner's Mac, per its card, at zero fee except the labelling. Every
   card step has run. BL-20261116-1357-e0-verified is its closing `Verified` entry and
   covers thirteen rowed runs in docs/experiments/registry.jsonl. Amendment 4's two
   runs came after it and have their own rows and entry.
   - **The first done condition is not met as worded** (decision 1 of that entry). It
     asked for a serving card that records the alias, engine version and context, never
     the address, with every stage bound re-derived from it or matched to 2026-11-04.
     - The card records those fields and no address, but it is `proposed`, not adopted.
     - Identity is what matched 2026-11-04. No stage bound, clock, cap, K or admission
       setting in the code rests on a 2026-11-04 figure, so none could be matched.
     - The card derives ceilings for index, plan, extract and synthesis only, and no
       code reads them (decision 2).
   - **The reading this restatement takes** (the session's; the owner may replace it):
     for the order of work, step 2 is complete. The first condition stays recorded as
     not met as worded: no bound in the code had a 2026-11-04 figure to match, and the
     card derives no writer, judge, critique or repair bound (decision 2). E2's and
     E6's cards still need a writer bound that E0 does not give (step 5). What is left
     of E0 is the adoption below, which waits for the owner; drafting the next cards
     does not wait on it. Amendment 4's two runs are verified
     (BL-20261116-1636-e0-amendment-4-runs-verified).
   - **The second done condition is met:** #57's resolution, posted on 2026-11-16 as a
     comment on the issue, records that the judge did not reach its level.
   - **Amendment 4's two runs** (pull request #129; BL-20261116-1441-e0-card-amendment-4):
     the extractor's v2 manifest, 60 calls, and the planner's v2 manifest, 30 calls with
     `--cache-salt`. Each sends the `response_format` the proposed card would add,
     beside a control without it.
     - **Results** (BL-20261116-1546-e0-structured-fixtures-result, `Implemented`). All
       90 calls were answered, and no planner call met the client's 300 s limit.
     - **Extractor:** the format removed `schema_too_big` on the fixture's chunks, 7 of
       30 calls to 0, a shown difference (Fisher's exact test, p = 0.011). No other
       difference is shown: complete first attempts were 8 and 12 of 30, and held
       replies 3 and 10 (p = 0.057).
     - **Planner, registered questions:** no difference is shown. At 8,192 tokens the
       plan call gave 4 valid plans of 10 without the format and 3 with it, with 4 and
       5 empty truncations. At 16,384 with the format it gave 1 empty truncation,
       against 5 at 8,192 (p = 0.14).
     - **Planner, post hoc:** with the format at 16,384 tokens, 9 plans of 10 were
       valid. The comparison was chosen after the counts were seen, the cell is a
       calibration cell no card can send today, and 16,384 without the format was not
       run. It is an observation, not a finding.
     - **What it leaves open.** With plan's thinking-on flag kept, the reader holds the
       plan cap at 8,192 tokens, where the planner failed 6 and 7 times in 10. A
       flagged plan call at 16,384 needs a P10 cell measured at that cap, which the
       schema export cannot build today.
   - **What the Next gates of BL-20261116-1357 and BL-20261116-1546 still leave,** in the
     order the session takes them. All wait for the owner:
     1. The owner's calls on the serving card: the planner's settings (topic 6 of §4),
        whether adoption waits for anything more, and whether the card is adopted as
        written. They were put to the owner on 2026-11-16 as questions 6 and 13 of the
        updated summary and are not answered
        (BL-20261116-1637-correction-handoff-start-here-final-check).
     2. The adoption commit, in its own reviewed pull request, merged on the owner's
        own go. It sets `decision` in docs/experiments/serving-card-2026-11-16.json to
        `adopted`, with BL-20261116-1357-e0-verified as its entry. A reviewer checks
        that only `decision`, `roles`, `concurrency` and `admission` differ from the
        writer's output (docs/experiments/README.md, "Adoption" and "Audit").
     3. The owner's local pin: the JSON file's absolute path in
        `SOAR_SERVING_CARD_FILE` and its sha256 in `SOAR_SERVING_CARD_SHA256`, both in
        the ignored `.env.local` the headless driver reads. The path is local and is
        never committed. `pnpm setup:general` then compares the card with the endpoint.
     4. Cloud claim verification and the role-level-gap question go to the owner with
        E3's and E4's cards.
   - **Until the pin is set, the card changes no run.** Only the headless driver and
     the doctor read a card. 7a.2's caps and thinking, item 9's `response_format` and
     8.2b's K act only through an adopted card.
   - **What adoption as written would do** (decisions 4 and 9 of that entry). Both plan
     attempts and every extraction call carry `response_format`; no synthesis call
     does. The reader holds plan's cap at 8,192 tokens and extract's at 2,048. The run
     must use P10's settings: streaming on, no reply contract, the cache salt on.
   - **When a re-probe is needed.** A flagged card's P10 evidence is bound to the
     default protocol hash, the export's request settings, the role-schema digests and
     each flagged attempt's cap (src/main/private-agent/serving-card.ts;
     docs/experiments/README.md).
     - Re-probe in full after a change to the default hash, the served model, the reply
       contract or its context, `SOAR_STREAMING`, or a role schema.
     - In full means P1 alone first, checked by hand; `pnpm probe:export-schemas`; then
       P1, P10, P11 and the adapter probe in one scripts/serving-probe.py invocation
       (E0 ran all twelve); `pnpm probe:assess`; and `pnpm card:serving` with the
       `--compare-*` flags for a new card. Re-running P10 alone is not enough: a card
       covers exactly one invocation.
     - A PR that changes how the model layer builds the owned vLLM body,
       `COORDINATOR_PROFILES.heavy` or `buildLocalScreenModelConfig` moves no recorded
       value, and no check catches it. Such a PR must state that it invalidates earlier
       cards' structured-output evidence (decision (1) of
       BL-20261114-2301-serving-card-request-settings-design; decision (2) of
       BL-20261114-2304-correction-serving-card-request-settings-review).
     - None is needed today: no merge since the assessment of 2026-11-16 changed any of
       these. #125 changes no `src/` file, and #127 and #128 change only comments in
       `src/`.
3. **E1**, the recoverability tests with no live model. Its gate is released: E1-L's
   sandbox suite passed against Docker and is recorded `Verified`
   (BL-20261115-1938-e1-l-sandbox-suite-docker-verified), and the four E1 defaults are
   adopted (§4). That is its done condition, the gate in review §5.6. The release
   lifts only E1's hold on E2 to E6's live runs and on harness loops. Each still needs
   its own card, cap and gates (decision 8 of
   BL-20261116-0812-correction-owner-defaults-review).
4. **E5** on the existing local routes in the owner's desktop build, with item 2's
   verdict capture. Not started, and no card exists. It waits for the owner on topics
   1, 2 and 9 of §4. The P11 interim (review decision 9) and the box checklist (PLAN.md
   D5) gate its labelled work only.
5. **E2 and E6** (cards #62 and #54), backlog items 6-11, and the start of item 12.
   - Done: 6.1, 6.2, 6.3, 6.4, 7a.1, 7a.2, 7b.1, 7b.2, 7c, 7d.A, 7d.B, 7d.C, 7d.D, 8.1,
     8.2a, 8.2b, item 9, 10.a, 11.1, 11.2, 11.3a, 11.3b, 11.4 and 11.5. Each is
     `Implemented` on offline tests.
   - Remaining, as the entries name them: 7b.3 (card-derived admission; not started,
     no PR), 10.b (blocked by #105, topic 7) and RA (the assist receipt fields). The
     lane plan puts RA in one PR with 11.6 after 10.b. It leaves 11.7a/b (after review
     decision 8 and item 12) and 11.8 (after review decision 5's open part) out of E3's
     "items 6-11" condition.
   - serving-card-flags.ts: 7a.2, item 9 and 8.2b merged in that order, so only
     `admission` (7b.3) is unconsumed. 10.b merges `main` in once it is unblocked. It
     must re-prove E1's clause 3 end to end and add T2's local trim counts.
   - E2 waits for topics 1 and 3. E0's card has no writer row, so it gives no writer
     budget or thinking policy (Limitations of BL-20261116-1357-e0-verified). E6 waits
     for topics 1 and 4, and likewise gets no output cap for its writer.
   - E2 and E6 have not run, and item 12 has not started.
6. **E3** waits for items 6-11: 7b.3, 10.b and RA remain, the last two behind #105
   (topic 7). It also waits for review decisions 6 and 11 (topics 8 and 9) and the
   owner's call on cloud claim verification (topic 10). Its card (#63), not written yet,
   must name the provider and D's call allowance with a projected fee under USD 3.00 on
   f2, and cite 10.b's clause-3 test (E1-2). E3 takes its per-role bounds from E0's
   card, today the code's defaults, and runs without the judge's thresholds.
7. **E4** waits as before: E3 settled, the line covering E4's cap (the adopted default
   is no reallocation), review decision 8 made, and items 11 and 12 done. It also needs its
   cloud-assisted arm chosen, the grader's judge model recorded, and its card
   committed with the RACE threshold (review §2.2, criterion 4). Topic 11 holds its
   open decisions. Then item 13, the desktop wiring.

No run in E5, E2, E6 or E3 can start without the owner's answers. That holds under the
session's narrower reading (decision 3 of
BL-20261116-1159-correction-e0-amendment-3-pre-run-review). Meanwhile the session plans
to draft the E5, E2 and E6 cards as `Proposed`, with every open value marked. That is
the session's choice, and no entry records it.

### 6. Rules for every step

- Follow `AGENTS.md` and the log rules at the top of BUILD_LOG.md: UTC entry IDs,
  append-only entries, and corrections only as new `Correction` entries. Keep
  `Proposed`, `Approved`, `Implemented`, `Verified` and `Released` distinct.
- The endpoint's address lives only in the owner's ignored `.env.local`
  (`SOAR_VLLM_BASE_URL`, `SOAR_VLLM_MODEL`, `SOAR_VLLM_COST_POLICY=local_zero_cost`);
  the JAO and JAT keys only in the owner's local configuration. scripts/with-cloud-key.sh
  reads the labeller's key from the owner's Keychain; it never enters a file. Never
  commit or log an address, a key, a local path, a raw trace or gold.
- Pre-register every experiment, zero-fee ones included: commit its card before it
  runs, and write one registry row per run. Run paid work only inside an approved cap,
  and recheck its price on the day, before the call (PLAN.md). E0's recheck came after
  its run (decision 3 of BL-20261116-1018-correction-e0-amendment-2-review).
- Before pushing, `git fetch` (other sessions move `origin/main`), then run
  `pnpm --silent validate:build-log -- --base-ref origin/main`, `pnpm typecheck`,
  `pnpm validate:readiness` and the tests for what changed. Gate on the validator's
  own exit status, never through a pipe (BL-20261113-0938-correction-restamp-rule-dates).
  Scan the branch's diff for an account name or a local path first. #117 pushed one in
  three test strings, and its earlier commits stay readable on GitHub after the squash
  (BL-20261116-0841-correction-e0-registry-modes-skeptic; decision 4 of
  BL-20261116-0838-correction-e0-amendment-1-review).
- **Before any request to the owned endpoint,** as E0's Amendments 3 and 4 required of
  their runs:
  - Run from the owner's main checkout, at a commit on `main`, with a clean tracked
    tree, and record that commit in the run's entry.
  - Run `pnpm setup:general` first, read-only and without `--write`: the model is
    listed and its one-token completion is answered
    (BL-20261114-2255-doctor-endpoint-identity-implemented).
  - Run `--dry-run` first for a fixture or the labelling, at the same commit. If a
    printed digest differs from the card's, the run does not start.
  - Run one thing at a time: nothing else uses the endpoint meanwhile.
  - Afterwards write one registry row with scripts/registry-row.py (`--run-dir`,
    `--loop-dir`, `--probe-dir`, `--fixture-dir` or `--labelling-file`) and a result
    entry. Raw replies and summaries stay under the ignored `.soar/experiments/`.
- **The owner's process choices:**
  - Lighter reviews (2026-11-10; made in chat, not in the log): one reviewer per PR, a
    skeptic only for a blocker or major finding, and privacy findings always checked.
  - Merging lane PRs (2026-11-13; made in chat, and later entries refer to it): merge
    a lane PR with a merge commit once its review is clean and CI is green.
  - Merging E0 record PRs (2026-11-16; decision 3 of
    BL-20261116-0814-e0-card-amendment-1): on the same two conditions.
  - The two directions of 2026-11-16 (§3).
  - Merging a handoff restatement (2026-11-17;
    BL-20261117-0530-owner-merge-go-handoff-restatements): on the same two conditions.
- **The session's practice of 2026-11-13 and 2026-11-14,** not an owner decision:
  - The owner's permission settings refuse a force-push, so bring `main` into a branch
    with a merge, never a rebase that needs one.
  - When several branches are ready, the lanes re-stamp into reserved, ascending
    minute blocks and one integration PR lands them with one CI run.
  - Ready PRs merge one at a time: each branch merges `main` in after the previous
    merge and re-stamps after its tail. PRs that must land in sequence can each merge
    the previous PR's head instead of `main`, so their CI runs at once; they then
    merge strictly in that order.
- **The session's practice of 2026-11-16,** not an owner decision:
  - The session asks the owner before it merges a PR that is not a lane PR, an E0
    record PR or a handoff restatement.
  - Review a card amendment and a result entry before the run or the commit, so fixes
    go in place, as Amendment 3's did (Scope of
    BL-20261116-1159-correction-e0-amendment-3-pre-run-review). Amendments 1 and 2
    were reviewed after their runs began, so their findings became `Correction` entries.
  - Commit and push a fixture's pinned manifest before its first request (decision 2
    of BL-20261116-0814-e0-card-amendment-1 for the commit; decision 7 of
    BL-20261116-1018-correction-e0-amendment-2-review for the push).
  - State before a run how its counts will be read. Amendment 4's pre-run review found
    its questions had no reading rule, and that the planner fixture's unstreamed calls
    are cut by the client at 300 s (BL-20261116-1441-e0-card-amendment-4).
  - **The proxy.** The owner's shell sets proxy variables, and probe runs 1 and 2 went
    through that proxy and failed at transport. Since #123 the Python probe opens every
    request with no proxy, so it needs no `NO_PROXY`
    (BL-20261116-1218-serving-probe-direct-transport-implemented). That is tested on
    loopback fakes only: no probe has run against the endpoint since. The broker
    connects directly. The doctor and the three fixtures use Node's `fetch`, which is
    direct only while `NODE_USE_ENV_PROXY` is unset, so check that it is unset before a
    run (decision 4 of BL-20261116-1017-correction-e0-probes-serving-card-review).
  - Hold any PR that moves the protocol hash or the source freeze while a probe window,
    from the export to the assessment, or an E-run is open
    (BL-20261116-1200-host-flags-trimmed-counts-design). For the hash it is the card's
    own rule.
  - Merge with `gh pr merge N --merge --match-head-commit <sha>`. GitHub auto-merge is
    not usable, because `main` has no required checks; no entry records this.
  - Rerun a failed electron-e2e job once before treating the failure as a regression
    (§7).
  - A registry row written after its run records the commit it was written at
    (`gitSource` `row_written`). The run's own revision goes in its entry.

### 7. Known limits

- **What is `Verified` among the entries dated 2026-11-08 or later:** four entries,
  each of narrow scope.
  - In CI only: E1's four gate clauses
    (BL-20261114-2306-e1-recoverability-gate-ci-verified).
  - Against Docker on the owner's Mac, with no model request: E1-L's sandbox suite, 18
    tests at d92a3af (BL-20261115-1938-e1-l-sandbox-suite-docker-verified). It is the
    last Docker-verified entry.
  - Live: E0's thirteen rowed runs happened as their entries record
    (BL-20261116-1357-e0-verified): twelve at zero fee against the owned endpoint, and
    the one paid labelling request. Reviewers recomputed the figures from the runs'
    records, with the one exception that entry names. It does not cover the card's
    hypothesis, product quality, the serving card's adoption or Amendment 4's two runs.
  - Amendment 4's two runs: a read-only verifier recomputed the committed entry's and
    rows' figures from the two summaries (BL-20261116-1636-e0-amendment-4-runs-verified).
    That covers the runs and their measurements, not the readings.
- **No other work merged since then is `Verified`.** The code is `Implemented` on
  offline tests, 7b.2, 7a.2, item 9, 8.2b and 7d.D included. No run under an adopted
  card exists. K above 1 stays `Implemented` until the owner's zero-fee run (ASSIST-S4).
  A flagged card at K above 1 is unmeasured, so that run must use a card that flags
  extract (BL-20261116-1331-correction-local-fanout-skeptic-followups).
- **One paid run since 2026-11-07:** E0's judge labelling on 2026-11-16, one request,
  USD 0.067876 by the tool's ledger, inside its USD 1.00 cap
  (BL-20261116-1013-e0-judge-labelling-and-pin). The provider's bill is not visible to
  the tool. Its body, 63,658 bytes of public or synthetic material, is the only
  request body E0 sent to a cloud provider.
- **The harness source-freeze digest** moved on 2026-11-16 with #102, #116, #119, #103,
  #108, #110, #127 and #128. At `main` d14ad42 it is
  e4c29bf0c08d95df95f80a52b470e96596e0158ee2526fbc5e602137627a4dca over 61 files, the
  output of `localScreenSourceFreeze()` at da30c9d's code. #129 to #133 change no hashed
  file.
  - Recompute `--runtime-sha256`, the digest `localScreenSourceFreeze()` in
    scripts/private-agent-local-screen.ts returns, before any loop or E-run, and let
    none span a merge that moves it (decision (3) of
    BL-20261116-1205-correction-research-role-policy-review).
  - A re-stamp alone can move it: comments in hashed files cite entry IDs
    (BL-20261116-1127-correction-e0-extractor-fixture-restamp).
- **The research protocol hash** changed with train 1, with #93 and again with #102.
  A research run directory from before #102 no longer seeds
  (`research_seed_protocol_mismatch`), E0's five r3 runs among them. A research session
  paused before #102 resumes as `session_contract_drift`. Under a non-default card, a
  seed or a resume under another card fails the same two ways
  (BL-20261116-1203-research-role-policy-design).
- Entries of #90, #91 and #104 on `main`, six in all, cite
  BL-20261113-0730-rayline-evaluation-plan-adjustments, the plan entry on draft #86,
  which is not on `main`. Until #86 merges, those references point outside `main`'s
  log; its re-stamp correction will record the ID they cite.
- **The electron-e2e job** has failed five times, each time with the Git-review test
  (tests/e2e/electron.spec.ts:510): three on 2026-11-14 and two on 2026-11-16, the last
  two on GitHub only. Three reruns passed. Two failures were never rerun: #104's at
  7eb5499 and `main`'s at 42b36e7.
  - Separately, on 2026-11-16 the job was cancelled four times by its 15-minute
    timeout while it waited for a macOS runner, with no step run: `main`'s run at
    100e00a, never re-run, and all three attempts of #129's run at daab44e. That is
    not a test failure. Re-run the job.
- **E0's limits that later experiments inherit** (Limitations of
  BL-20261116-1357-e0-verified):
  - One endpoint, two days and one accepted run of all twelve probes: its rates and
    latencies are one-shot measurements.
  - Small or synthetic inputs. P10 and the extractor fixture are synthetic, the planner
    fixture and the r3 runs use one task, and the judge's labels are one cloud model's.
  - Not shown: identical weights, the decoding configuration, K at extraction-size
    prompts, exact native-token admission under `flash_next_v1`, and synthesis on a real
    packet.
  - The planner and the extractor with `response_format`: measured once each, on one
    exposed index and three synthetic chunks, first attempts only
    (BL-20261116-1546-e0-structured-fixtures-result). The planner's cells hold 10 calls,
    sent unstreamed.
  - Four of five r3 runs ended `research_extraction_incomplete`, and the planner's
    first reply was truncated with no content in all five.
  - P9: the server answered a request whose prompt plus `max_tokens` exceeded the
    window, so a rejection by the server cannot be counted on.
  - E2 and E6 get no writer bound from the card. E3 takes the code's defaults, and E3
    and E4 run without the judge's thresholds.
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
