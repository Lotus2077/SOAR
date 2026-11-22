# SOAR handoff

## Start here (E5 updated 2026-11-22 UTC)

This section is the entrypoint for the next session. It replaces every earlier "next step" in
this file; the rest of the file is the September 2026 record. "The session" is the coordinating
session: it runs the lanes and the experiments on the owner's Mac, and it talks to the owner. The
next session takes that role. The sources are the entry files of 2026-11-18 to 2026-11-21 under
`docs/build-log/`, pull requests #155 to #209 and this restatement's, and `main` after the merge of #209.
The current E5 decision is BL-20261122-0525-e5-proxy-only-start.

**In brief.**
- **The measure.** Read each UTC Monday–Sunday week's first eight real job starts in the
  normal app. At least six must be accepted across at least three families in each of two
  consecutive weeks. Eligible community-sourced proxy jobs can supply all eight for now.
  Report owner and proxy counts separately. PLAN.md §1's weekly private job applies once
  Tier O opens for the bar. E5 admits public or synthetic proxy material only.
- **The order.** The owner approved local research in the desktop before the paid experiments
  E3 and E4 (BL-20261118-0418, #155).
- **The state.** E2 and E6 are done and recorded, and no harness run is using the endpoint.
  - **The research beta is cut** on the owner's go (#205, #208): `owner-v0.3.0-research-beta.1`
    at 9812bd8, in its own worktree, checked, with its doctor ready. E2's fresh check (#209) met
    the beta's 3-of-4 reading on two fresh tasks, so the beta stays. No beta job has run yet.
  - **E5.** The owner authorized real community-sourced proxy jobs to start now. The
    synthetic proxy rehearsal passed on `owner-v0.2.1` and contributes zero trial jobs
    (BL-20261121-1953). The first evidenced real proxy desktop start sets proxy day 1.
    Read its first five jobs under O4/O5 separately from the owner's five.
  - **Document review** stays the single sample (E6, #202). 13b's design (#203) is merged, and
    the owner answered its three questions on 2026-11-21 (the same entry), so its code is next.
- **First,** see what moved: `gh pr list --state open`, `git log --oneline -5 origin/main` and
  `ls docs/build-log | tail`. Run the next eligible E5 proxy job under §5 and its card.
- **Not without the owner, each asked by name:** a serving card's adoption commit (Amendment 8,
  item 5); a new outside destination (BL-20261117-0940-owner-direction-decisions-delegated,
  decision 5); #105's residues (BL-20261117-0941-group-a-decided-under-delegation, decision 1).
  The owner approved real private documents for 13b's local review route only, and waived
  PLAN.md §3's Phase 3 preconditions for Tier O for that route (BL-20261121-0611, decision 2);
  other real private data stays the owner's call. The owner's own
  E5 jobs and verdicts, lines in `.env.local`, keys and every step that needs the owner's hands
  are the owner's (BL-20261117-0940, decision 7).

### 1. Get the work

`main` is past 734e702, the merge of #195, only by docs pull requests (#196 to #209 and this
restatement). The main checkout was held at 734e702 for E2's second batch and E6, and at 69ee783
for E2's fresh check; all are done, and it follows `main` again. Do other work in a separate
worktree. Select
Node 22.22.2 and pnpm 10.12.4 first ("Setup and safe verification" below): `.npmrc` sets
`engine-strict=true`, so another Node major fails the install.

```sh
git fetch origin main
git checkout main
pnpm install --frozen-lockfile
```

CI runs on pull requests and on pushes to `main`. These merged from 04:31 UTC on 2026-11-18 to
2026-11-21; the draft #86 is open, and #181 is closed unmerged (§4).

| Area | Pull requests |
| --- | --- |
| The order and the log | #155 (the owner's approval, and E0's Amendment 6), #159 (one file per entry), #157 (source comments cite pull requests) |
| 13a, local research in the desktop | #156 (the design), #158, #160, #162, #164, #168, #170, #175, #185 ("resolved", not "read") |
| E0 and the research protocol | #163 (r3), #166 (the owner's gap decision), #171 (Amendment 7), #172 (the gap), #173 (card-writer options), #176 (the tolerant check), #178 (Amendment 7's result), #180 (Amendment 8), #183 (the re-probe's result), #184 (the adoption), #186 (the r3 runs under the adopted card) |
| E2 | #187 (Amendment 1), #190 (the grading brief), #193 (the first batch's result), #194 (the owner's "Fix first"), #196 (a Correction to it), #198 (Amendment 2, the second batch), #201 (the second batch's result), #206 (Amendment 3, the fresh check), #207 (the fresh tasks), #209 (the fresh check's result) |
| The writer | #195 (ledger feedback and the length nudge) |
| E6 | #177 (the grading brief), #179 (the scorer's re-pin), #197 (the grader start), #199 (the batch state), #202 (the result) |
| The owner's builds | #205 (the owner's answers of 2026-11-20), #208 (E5's rehearsal and the research beta's cut) |
| 13b, document review in the desktop | #203 (the design, `Proposed`) |
| Other | #189, #200 and #204 (the handoff syncs), #191 (criterion 6 restated, on the owner's yes), #192 (a stage-resume design, `Proposed`) |
| Tests and git | #161, #165, #169 and #188 (test timeouts and waits), #167 (the e2e diagnostic), #174 (the git deadline) |

**Values at 734e702.** #195 changed the writer, not the research stage. The earlier values
`0160d8f3…` and `6d6dbf43…` are superseded: no run reads them now.
- the default research protocol hash `4bb74c03…`, and `99bbc0e6…` under the 2026-11-18 card's
  roles with admission, both pinned by tests/unit/research-protocol-adopted-card.test.ts;
- the harness source freeze `86732c63…`, now over 63 files (#195 added one), recomputed on a
  clean tree.

The freeze moved with #195; the protocol hash last moved with #172 and #176. Recompute both
before any run. E2's first batch and E0's r3 runs were made at 2996218 (freeze `0b896d92…`);
E2's second batch and E6 were made at 734e702, and E2's fresh check at 69ee783, whose source is
the same.

### 2. Read, in this order

1. This section.
2. `AGENTS.md` and `CONTRIBUTING.md`, for the log's layout and rules (#159).
3. docs/PLAN.md §1 for the measure and §4 for the process. Then, in the frozen archive
   `docs/BUILD_LOG.md`, the owner's delegation (BL-20261117-0940) and approval (BL-20261118-0418).
4. The E0 card, docs/experiments/e0-card-2026-11-13.md, with its Amendments 6, 7 and 8, and the
   adopted serving card, docs/experiments/serving-card-2026-11-18.json.
5. 13a's design (BL-20261118-0438-desktop-local-research-13a-design, in the archive) and
   13a.1's entry files. #170's description holds the beta-cut checklist. 13b's design is
   BL-20261120-0646-desktop-document-review-13b-design, and #203's description holds its detail.
6. The E2, E5 and E6 cards (docs/experiments/e2-, e5- and e6-card-2026-11-17.md), E2's
   Amendments 1 to 3, and the grading briefs, docs/experiments/e2-grading-brief.md and
   e6-grading-brief.md.
7. The entry files of 2026-11-19 to 2026-11-21 under `docs/build-log/`, newest first.

### 3. Decided

- **The order of work** (BL-20261118-0418, #155).
  - Item 13 is split. 13a puts the research pipeline and a serving-card reader in the desktop,
    as a beta with no cloud assist. 13b, the staged document review, comes after E6.
  - E3 and E4 stay, as the paid question of whether a cloud assist is worth adding.
  - The gate the session's plan proposes for 13a reaching an owner build: the r3
    re-measurement reaches the packet in at least 2 of 3 runs, and E2's graded runs accept the
    writer.
- **The working rules** (the same entry, decision 5): one entry a pull request, of about 25
  lines, with the detail in the PR's description; a Correction only for a fact that is wrong on
  `main`; no entry ID in a file under `src/` or `scripts/`; cards and amendments under 200 lines;
  the handoff restated at most once a day; harness runs when the owner is not using the endpoint.
- **The log is one file per entry** (#159, BL-20261118-0428-build-log-entry-files).
  `docs/BUILD_LOG.md` is a frozen archive, and no entry is re-stamped. Source comments cite pull
  requests instead of entry IDs (#157, BL-20261118-0438-source-comments-cite-pull-requests).
- **The r3 re-measurement** (#163, BL-20261118-0606-e0-r3-remeasurement-result, `Verified`).
  2 of 3 runs reached the packet, each only through the second repair, which stays. That meets
  the first half of 13a's gate. No card value moved.
- **The owner's two decisions on 2026-11-18:**
  - **One disclosed unresolved chunk.** A packet may stand when one chunk's last reply declared
    its questions unresolved. The gap is disclosed in coverage and the report; an invalid,
    cut-off or refused chunk still ends the run (#166,
    BL-20261118-0639-owner-allows-one-disclosed-unresolved-chunk). Built as #172
    (BL-20261118-0712-research-one-declared-gap, coverage version 5).
  - **The tolerant synthesis check.** The synthesis judge drops an evidence id that is not
    citable or not tagged for its question, and discloses it, instead of refusing the reply
    (coverage version 6). The owner's "go ahead with your decision" is in #176's entry
    (BL-20261118-0905-synthesis-evidence-id-tolerance, decision 6, `Verified`). Its
    confirmation cell gave 10 model syntheses of 10.
- **Amendment 7's fixtures** (#171; the result in #178,
  BL-20261118-0923-e0-amendment-7-fixtures-result, `Verified`): neither registered rule was
  met. Synthesis gave 0, 2 and 3 of 10, and the plan cells 7, 6 and 5 of 10.
- **Amendment 8's values** (#180, the amendment's item 0): synthesis caps become
  [16384, 16384], with thinking on both attempts; the plan row is unchanged.
- **The serving card of 2026-11-18 is adopted** on the owner's "Yes, adopt" (#184,
  BL-20261118-1232-serving-card-2026-11-18-adopted), from Amendment 8's re-probe (#183).
- **E0's r3 runs under the adopted card** (#186,
  BL-20261118-1604-e0-amendment-8-remeasurement-result, `Verified`): 2 of 3 reached the packet,
  each only through the second repair and the one disclosed gap, both with a model synthesis;
  the third ended with two unresolved chunks. The unresolved chunk differed in every run. The
  first half of 13a's gate is met again, and no card value changed.
- **E2's Amendment 1** (#187, BL-20261118-1605-e2-card-amendment-1): E2's runs read the adopted
  card and are made at 2996218, which the amendment names (freeze `0b896d92…`); packet attempts
  carry admission, the second repair, the gap and the tolerant judge; writer-2 runs under
  `--write-bound twelve-call`; a 3-of-4 reading is added for the beta's gate; the card's 3 days
  stand.
- **The desktop speaks of "resolved" passages** (#185): a passage read and left unresolved is
  never called unread.
- **E2's grading brief** (#190, BL-20261119-0552-e2-grading-brief): Phase 2's procedure written
  out. Each bundle goes to a fresh headless grader in a copy outside the repository, with file
  tools only, no project instructions or memory, and writes only to its sheet; a dummy-folder
  check gates the first grader.
- **E2's first batch** (#193, BL-20261119-1454-e2-result, `Verified`): every task's packet came on
  its first attempt. A graded writer-2 run ended at its bound, so Heavy stays (case 1). Writer-1
  had 1 of 4 graded runs accepted and writer-2 2 of 4: no difference shown (p = 1.0). Heavy's 1 of
  4 misses the beta's 3-of-4 reading. The grader accepted 3 of 4 reports in each arm; submitting
  separated them. The decoy was rejected. The blind grader and the gold scorer disagreed on all
  4 r3 runs and on 2 of 4 submitted graded runs; the owner chose "Keep the proxy grader".
- **The owner's "Fix first"** (#194, BL-20261119-1555-owner-fix-writer-bugs-first; two of its
  figures corrected by #196, BL-20261119-1701). Not approved: thinking off after a cut-off, or
  any change to Heavy's clock, calls or per-reply cap.
- **The writer fixes** (#195, BL-20261119-1620-writer-ledger-feedback-and-length-nudge): the
  claims check accepts and ignores arguments, and its failures come back as codes; under the twelve-call bound
  the host checks the ledger once when it first appears; the length nudge says when a cut came
  while reasoning and that write_file replaces the file. Any paused runner task from before it,
  desktop plain tasks included, fails closed on Resume.
- **E2's Amendment 2** (#198, BL-20261119-1702-e2-card-amendment-2): batch `e2-2026-11-19-b2` at
  734e702, its 12 writer runs seeded from the first batch's packets, read as counts of 4. s1 and
  s2 are `exposed`; grading them "on exposed tasks" departs from review rule 3 as worded. Its
  reading supersedes the first batch's for the E3/E4 writer and the beta's gate reading.
  - The amendment let the owner choose a strict or a fresh reading before the first writer run.
    That run started at 17:36 UTC while the owner was away, before #198 merged at 17:57, so the
    owner did not get that choice. The owner keeps point 6's decision, and may still replace
    the reading by an entry of their own, which the session would follow.
- **E6's grader start and batch state** (#197, BL-20261119-1705; BL-20261119-1732): a
  headless grader with a sandboxed shell, confined for user data and with no network; the batch
  at 734e702 under the adopted card, by S-harn's runbook (sha256 `019cb926…`); "fresh at the
  start" read as no change tuned on E6's tasks.
- **E2's second batch** (#201, BL-20261119-2128-e2-batch-2-result, `Verified`): 11 of 12 writer
  runs submitted. s1's writer-2 run 2 ended at its bound with no ledger, so Heavy stays by case 1
  again. Heavy had 4 of 4 graded runs accepted and writer-2 3 of 4 (p 1.0). The beta's 3-of-4
  reading is met on exposed tasks, and the owner decides whether that opens the beta. On r3 the
  grader and the gold disagree on all 8 runs across both batches; on s1 and s2 they agree on all 8.
- **E6's result** (#202, BL-20261120-0233-e6-result, `Verified`): review-1 had 4 of 6 and review-2
  5 of 6 delivered reviews accepted (p 1.0), so the route stays the single sample. Every loop chose
  and delivered sample a on a tie, so question 1 compared single samples. In pd3's second loop the
  repair (8 of 8 defects, accepted) lost on that tie to its draft (6 of 8, rejected). Planted
  defects: 46 against 44 of 48 (p 0.694); no control changed; kind guesses 12 of 24.
- **The owner's answers of 2026-11-20** (#205, BL-20261120-0657-owner-opens-beta-with-fresh-check-and-starts-e5):
  cut the research beta now with a fresh-task check beside it; 8 or more real jobs a week; E5
  today; push the tag `owner-v0.2.1` (pushed).
- **E5's rehearsal and the beta's cut** (#208, BL-20261120-1012-e5-rehearsed-and-research-beta-cut):
  E5's build (`owner-v0.2.1`, c02366a) passed `pnpm check`, its doctor and the owner's rehearsal;
  the beta (`owner-v0.3.0-research-beta.1`, 9812bd8) passed `pnpm check` and its doctor with the
  adopted card. Receipts go to the ignored `.soar/experiments/e5/receipts/` and
  `.soar/experiments/research-beta/receipts/`, and E5's tally to `.soar/experiments/e5/tally.csv`.
- **E2's fresh check** (#206, Amendment 3; #207, the tasks; #209,
  BL-20261120-1317-e2-fresh-check-result, `Verified`): two packets and four Heavy writer runs on
  the fresh tasks s3 and s4. Heavy had 3 of 4 graded runs accepted, which meets the beta's
  reading there, so the beta stays. s4's first grader accepted the decoy, so the reading rests on
  the card's "the owner then grades, or names another grader" and the owner's choice of a second
  grader, who rejected it. The gold gave 7, 7, 6 and 0 of 7. s3's run 1 ended after three replies
  were cut at the 16,384-token cap.
- **13b's design** (#203, BL-20261120-0646-desktop-document-review-13b-design, `Proposed`):
  review-1 in the desktop as an opt-in beta route for one .docx, local only, with a record
  version 5, an export allowlist and a scan of the document's text; 5 to 7 days in six parts.
- **The owner's decisions of 2026-11-21** (BL-20261121-0611-owner-e5-proxy-jobs-and-13b-answers):
  - The owner subsequently chose the sourcing proxy to judge its export against pre-dispatch
    criteria. A fresh blind grader checks the sample. Accepted eligible proxy jobs count
    toward the MVP measure (BL-20261121-1701, BL-20261121-1705).
  - 13b may run on the owner's real private documents, on its local route only; the owner
    waived PLAN.md §3's Phase 3 preconditions for Tier O for 13b ("Waive them for 13b"), accepting
    a plain-HTTP endpoint and an unverified box.
  - 13b's export bundle is the six deliverables E6 graded; the flags file stays in the task's
    record for grading and scoring (the session's choice).
  - One synthetic desktop run is enough before an owner build of 13b, with no E6-style grading.
- **Two other pull requests:** #191 restates criterion 6 of the review's depth bar, on the
  owner's yes; it is an input to E3's and E4's rules. #192 designs resuming a paused research
  stage, `Proposed`; the owner kept the 90-minute clock running through a pause ("Keep it for
  now"); the E2 and E6 windows that held its code closed on 2026-11-20.
- **13a.1 is complete:** #160 (the contract, and the beta flag, off by default), #162 (the
  beta's own user-data folder), #164 (the stage), #168 (the task view), #170 (the gated
  end-to-end case, `Verified`, and the beta-cut checklist) and #175 (the disclosed gap in the
  view).
- **E6.** Its grading brief is `Approved`, as the session's procedural choice (#177,
  BL-20261118-0923-e6-grading-brief). Its scorer is re-pinned after #157 changed one comment
  (#179, the card's Amendment 2).
- **The tests.** The Git-review e2e failures came from the 5 s per-command git deadline, now
  15 s, below the inspection's 20 s (#167, #174). Every test has a 30 s default timeout (#169).
- **Still in force from 2026-11-17:** the owner's delegation (BL-20261117-0940) and the
  session's choices under it (BL-20261117-0941); E5's, E2's and E6's cards, `Approved`. The
  2026-11-17 serving card (BL-20261117-1616) stays as committed; no run reads it now (#184).

### 4. Still open, and what each blocks

1. **E5's live evidence.** Record the first real desktop start, receipt, attributed proxy
   verdict and any blind grade. The grader copy passed on rehearsal material
   (BL-20261121-2007). Live sampling, decoys and weekly eligibility need their own evidence.
2. **13b's code** (lane S-desk), per #203 and the owner's answers of 2026-11-21; then one
   announced synthetic desktop run before an owner build. After that the owner may use it on real
   private documents; the Tier O preconditions are waived for 13b (BL-20261121-0611, decision 2).
3. **Waiting on the owner:** #105's residues (BL-20261117-0941, decision 1); the session's
   readings the owner may replace: s1's kept packet (#193, decision 4) and E6's "fresh at the
   start" (BL-20261119-1732).
4. **The writer's length runaway.** E2's fresh check ended one Heavy run after three replies
   were cut at the 16,384-token cap despite two nudges (#209). It may ground a later writer
   change, under its own entry; none is planned.
5. **The selection rule's tie step.** In every E6 loop both steps chose sample a on a tie, and in
   one loop that kept a rejected draft over an accepted repair. It may ground a later card, "a
   later lever under its own entry"; none is planned.
6. **E3 and E4** have no cards. They stay as the paid assist question (BL-20261118-0418). A
   reviewer of #191 read E3's frozen f1-f3 briefs, which #191 discloses; this goes to the owner
   with E3's items.
7. **The draft #86** (the Rayline evaluation of 2026-11-13) adds a paragraph inside an earlier
   "Start here", which this one replaces, so that paragraph is re-placed or dropped at its merge.
   Entries on `main` from #90, #91 and #104 cite its entry, BL-20261113-0730, which reaches
   `main` only with #86.

### 5. Act next, in this order

1. **E5's first real proxy job.** Read Amendment 1. Log the public need and freeze the
   persona's acceptance notes. Check the day's price and reserve within USD 8 per task and
   USD 300 total including prior spend. Scan each handoff, run the same-day doctor, confirm an
   idle exclusive endpoint and record the sampling decision at dispatch. The sourcing proxy
   judges the exported work. Keep its `proxy_agent` row and the blind grade attributed separately.
2. **13b's code** by lane S-desk, in the design's six parts, each a pull request with one light
   review, merged on green CI. The gated Playwright case and the synthetic desktop run are
   announced first. An owner build of 13b follows the synthetic run.
3. **The owner's jobs** in E5's build and in the beta, whenever the owner runs them: one at a time
   on an idle endpoint, with no harness run meanwhile (E5's card, O10); the doctor before each
   day's first E5 job; receipts saved to the ignored folders and rowed by reviewed pull requests
   (batch `owner-real-jobs` for E5, `research-beta-1` for the beta).
4. **Lanes.** S-pipe: the research protocol and the writer, and #192's part (a) once owner-job
   evidence exists. S-desk: 13b's code, and #192's part (b). S-harn: the harness, the log's tools,
   the runbooks and any proxy-job tooling E5's amendment needs. S-e1: E2's and E6's fixtures and
   their gold, which only it opens. S-assist: the next failed electron-e2e run, read before
   anyone re-runs it (BL-20261118-0800-git-command-deadline-15s).

### 6. Rules for every step

- **The log** (AGENTS.md, CONTRIBUTING.md, #159). One entry file a pull request, under
  `docs/build-log/`, named by its UTC ID. It may be revised until its pull request merges, and
  must be true then. A file on `main` never changes: a correction is a new `Correction` file.
  Keep `Proposed`, `Approved`, `Implemented`, `Verified` and `Released` distinct.
- **No secrets in Git.** The endpoint's address lives only in the owner's ignored `.env.local`,
  and the keys only in the owner's local configuration. The session never opens `.env.local` and
  never enters a key (BL-20261117-0940, decision 6). Never commit or log an address, a key, a
  local path, an account name, a raw trace or gold; scan each branch's diff for an account name
  or a local path before pushing.
- **Pre-register every experiment,** zero-fee ones included: the card or amendment is committed,
  and reviewed, before the run, and each run gets one registry row. State before a run how its
  counts will be read. A paid run stays inside the USD 300 envelope and USD 8 a task, with a
  cap and a price rechecked that day (BL-20261117-0940, decision 5).
- **Before pushing,** `git fetch`, since other sessions move `origin/main`. Then run
  `pnpm --silent validate:build-log -- --base-ref <the branch point>`, `pnpm typecheck`,
  `pnpm validate:readiness` and the tests for what changed.
- **Before any request to the owned endpoint,** as E0's amendments require:
  - run from the owner's main checkout, at a commit on `main` with a clean tracked tree, and
    record the commit;
  - run `pnpm setup:general` read-only first, and a fixture's `--dry-run` at the same commit; a
    digest that differs from the card's stops the run;
  - check that `NODE_USE_ENV_PROXY` is unset, since the doctor and the fixtures use Node's
    `fetch` (BL-20261116-1017-correction-e0-probes-serving-card-review, decision 4);
  - one thing at a time on the endpoint, in a window announced to the lanes and the owner;
  - afterwards, one row with scripts/registry-row.py and a result entry. Raw replies stay under
    the ignored `.soar/experiments/`.
- **Hold any PR that moves the protocol hash or the source freeze** while a probe window or an
  E-run is open (BL-20261116-1200-host-flags-trimmed-counts-design).
- **The owner's process choices.**
  - Lighter reviews (2026-11-10, made in chat): one reviewer a PR, a skeptic only for a blocker
    or major finding, and privacy findings always checked.
  - Lane PRs (2026-11-13, made in chat), E0 record PRs (BL-20261116-0814-e0-card-amendment-1,
    decision 3) and handoff restatements (BL-20261117-0530-owner-merge-go-handoff-restatements)
    merge with a merge commit once the review is clean and CI is green.
- **The session's practice,** not an owner decision.
  - Since the owner's delegation, the session merges its own and the lanes' pull requests,
    records and amendments included, once the review is clean and CI is green. It records each
    decision in an entry before acting on it and reports it to the owner, and it asks the owner
    by name only for the items under "Not without the owner" (In brief; BL-20261117-0940,
    decision 5; BL-20261118-0418).
  - The owner's permission settings refuse a force-push: bring `main` into a branch with a merge.
    Entry files never conflict, so ready PRs merge in any order.
  - Merge with `gh pr merge N --merge --match-head-commit <sha>`. GitHub auto-merge is not
    usable, because `main` has no required checks.
  - A failed electron-e2e run's printed event summary is read before anyone re-runs it (#167).
    This replaces the earlier rule of one re-run. A run cancelled for want of a macOS runner is
    simply re-run.
  - A finished CI run does not wake the session, and the session does not poll CI: it checks CI
    after its next piece of work. A finished background run does wake it.

### 7. Known limits

- **What is `Verified`:** the r3 results (#163 and #186); 13a.1's gated end-to-end case (#170);
  the tolerant check and its cell (#176); Amendment 7's result (#178); the re-probe (#183); E2's
  two batches (#193, #201) and its fresh check (#209); E6 (#202).
- **Nothing measures research quality yet.** #163 covers no report's quality. The stage's checks
  are not a verdict on content (#178). The desktop stage has run only against loopback endpoints
  with scripted replies, and the gated case once, on one machine, outside CI (#164, #170).
- **Counts, not rates.** E0's r3 runs and E2's batches are a few runs of three tasks, two of them
  exposed for the second batch; E6's 12 runs are on three synthetic files, and E2's fresh check's
  6 runs on two; all ran on one endpoint between 2026-11-18 and 2026-11-20, and they estimate no
  rate (Amendment 8,
  item 6; E2's card). E0's inherited limits are in
  BL-20261116-1357-e0-verified.
- **One paid run since 2026-11-07:** E0's judge labelling on 2026-11-16, USD 0.067876 by the
  tool's ledger (BL-20261116-1013-e0-judge-labelling-and-pin). E2's and E6's graders ran on the
  owner's Claude subscription; no entry since records a fee.
- **The proxy grades are weak evidence.** E2's graders read for about a minute each and
  disagreed with the gold on every r3 run in both batches (#193, #201). E6's graders read for one
  to two minutes, and a repair and its draft went to different graders (#202). E2's fresh check
  needed a second grader after the first accepted the decoy, and its grader and gold disagreed on
  one of four runs (#209).
- **13b's route carries no privacy promise.** The owner waived PLAN.md's Tier O preconditions for
  13b (BL-20261121-0611, decision 2). A private document reaches the owner's box over plain HTTP,
  and the box's logging and egress are unverified (E5's card).
- **The Git-review e2e flake** is diagnosed (run 44260413394: `inspect_git_changes` failed after
  5,609 ms) and its deadline raised (#174). It is not shown gone, against a base rate near 3%
  (BL-20261118-0800-git-command-deadline-15s).
- **The adopted card rests on one probe run,** on the export's synthetic payloads; E0's three r3
  runs, E2's two batches, E6 and E2's fresh check are its live uses so far (#186, #193, #201,
  #202, #209).

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
