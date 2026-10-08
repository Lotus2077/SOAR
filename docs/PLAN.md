# SOAR plan

Status: **`Approved` by the owner on 2026-09-29 local**
(BL-20260928-1745-owner-answers-plan-approved), and amended the same day with the
owner's answers. The approval replaces the old gates listed in D8 with this plan and
a USD 300 cloud envelope.

- **Proposed until the owner confirms them:** the new privacy, admin-assistant,
  research, document-review and device requirements, detailed in the
  [private work design](plans/PRIVATE_WORK_DESIGN_V1.md).
- **Still needs a separately recorded approval:** each gate named inside the plan
  (Tier O activation, connectors, public pushes, recoverable dispatch, spend beyond
  USD 300). No default here authorizes live, paid, private-data or publication
  actions.

This plan responds to the [whole-project review](PROJECT_REVIEW_2026-09-28.md). The
review found that SOAR has a sound privacy envelope, but has not answered the
questions its thesis depends on (review W1-W12):

- whether the owned Qwen3.8-27B tier can do heavy work when configured correctly;
- how far that tier falls short of a cloud ceiling;
- whether permitted cloud help closes the gap;
- whether the owner actually needs private delegation.

The plan answers those questions in about four weeks. It puts the owner in the loop
from the first week and keeps every protection that matters.

## 1. Goal and success metric

**Goal.** A user delegates heavy, general, end-to-end agentic work. The main
agent runs on the owned device, and the priority order is privacy >= quality >
savings > latency.

The owner's own jobs, in priority order (2026-09-29):
1. deep and reliable research;
2. document review and amendment;
3. website building;
4. slide generation;
5. day-to-day administration: email replies, calendar management;
6. Codex-like coding ("in scope but not as important").

**Privacy rule (owner, 2026-09-29).** *"I don't want any of my personal data leak to
the cloud, and for more strict data protection, think of the need from lawyers,
doctors and scientific researchers."*

- **What "the cloud" covers.** Cloud AI models, search engines and fetched URLs,
  telemetry, iCloud, development agents and any new third party.
- **Where cloud models may help.** Only on public or synthetic work. Labelled
  (personal or professional) contexts get **no** cloud help, with no placeholder
  exception by default.
- **Design target.** Lawyers, doctors and scientific researchers are the target
  for the strictest profile.

See the [private work design](plans/PRIVATE_WORK_DESIGN_V1.md) §1-§2.

**North star: owner-accepted real jobs per week (OAJ).** A job counts only if:

- the owner chose it and it is real work;
- the owner ran it in the normal app build, not a test driver;
- it was exported through the app;
- the owner rated it **Accept** within 72 h, or **Accept with ≤ 10 minutes of edits**
  (the edits are recorded as an intervention);
- it needed at most one other manual intervention;
- it clears the "heavy" floor: the owner estimates it saves ≥ 30 minutes of their
  own work, or it took ≥ 15 agent actions.

**MVP exit (beyond this window):** ≥ 6 of 8 real owner jobs accepted in each of two
consecutive weeks, across ≥ 3 families, with ≥ 1 private (Tier O) job per week once
Tier O is open.

**Secondary metrics, reported as raw counts, never as gates:**

- local-versus-cloud acceptance gap on the same fresh tasks;
- harness-terminal rate (runs ended by timeout, cap, reply-format or transport
  causes);
- `infra_invalid` share;
- owner minutes per job;
- wall time against the owner's stated tolerance;
- USD per accepted job per route;
- live trials per week (target ≥ 8);
- days since the last owner verdict (target ≤ 3).

**Economics.** Savings are descriptive only. The device is sunk, so capital payback
is moot. The cloud reference tier as of 2026-09-28 is `gpt-6-sol` at USD 2 / 0.20 /
10 per 1M tokens (input / cached / output). Recheck the price on the day it is used.

**The cloud envelope approved by the owner is USD 300 in total**, allocated in
section 4. Local runs are unlimited.

## 2. Decisions

| Kind | Decision | Why (review ref) |
| --- | --- | --- |
| Keep | Broker-only egress, `--network none` tool sandbox, exact-packet consent, reservation fee ledger, strict at-most-once for every cloud or consultant dispatch, submitted ≠ accepted, append-only negative results, synthetic/public-only admission until Tier O is verified. | These make the privacy promise auditable (Right 3-5). |
| Keep | One general loop, native tool calls, event-sourced checkpoints, observation compression, the pinned artifact image. | Reusable core (Right 7). |
| Change | Replace the handoff's next milestone with a **fair local-vs-cloud test** plus **owner verdicts from week 1**. The lifecycle defect is *mitigated* (power assertion, headless watchdog, streaming), not diagnosed open-endedly. | W1, W4, W12 |
| Change | Coordinator profile follows vendor guidance and becomes the "Heavy" profile. Caps are raised together at every layer, and the Standard profile stays selectable. | W2 |
| Change | Zero-fee local inference and idempotent public GETs become recoverable. Cloud and consultant dispatches stay strictly at-most-once. | W3 |
| Change | Consultation targets `gpt-6-sol` with correct parameters; the ledger prices cached tokens. The `gpt-4.1` profile is retired. | W7 |
| Start | A **Tier O** for the owner's own files: local-only, with cloud, web and consultation disabled. Gated on a box checklist and owner approval. | W1 (need), W11 (device) |
| Start | Owner jobs card, a tagged owner build, and a trial registry. | W5, W8 |
| Start | Codex-like coding stays **in scope at lower priority** (owner, 2026-09-29): 1 coding task in the fair test; a private-repo patch is a later Tier-O candidate. | Owner answer; W1 |
| Change | **Privacy rule:** label-aware, default-deny egress. Any context labelled personal or above may reach only the local model. Search queries, URLs and DNS count as disclosures. No cloud help for labelled contexts. | Owner answer; [design](plans/PRIVATE_WORK_DESIGN_V1.md) P1-P3 |
| Start | **Data labels** (`public < personal < confidential_professional`, plus regime tags for privileged, PHI, human-subjects, controlled-access and export-controlled data) replace `publicOrSynthetic`. | Design P1 |
| Start | **Admin assistant**, staged and draft-only: file exports, then read-only sync, then owner-approved draft writes, then per-action approved sends. Never autonomous in the MVP. | Owner answer; design §3 |
| Start | **Document review and amendment** as a family: the model writes an edit plan, a deterministic script produces redlines, and fidelity checks follow. | Owner answer; design §4 |
| Change | **Research reliability comes from host checks:** a claims ledger, verbatim-quote verification against sources, and a local entailment pass. Unsupported claims are shown, not hidden. | Owner answer ("deep and reliable"); design §4 |
| Stop | Per-trial approval entries for zero-fee work; n=1 reruns of already-seen tasks; building new evaluators or qualification layers per task; new routers or export features before the fair test reports. | W8 |
| Stop | Treating API savings as a design driver; leading documents with the "Hybrid +4.93%" figure. | W10 |
| Defer | Deleting *wired* legacy code (flag it off in PR-F, delete later; dead and unshipped code was already removed on 2026-09-29 at the owner's direction); build-log rotation (needs a validator redesign); moving the runner to an always-on host; research search tooling; visual feedback. Each is triggered by a result below. | W6, W9 |

## 3. Phases

Dates assume approval by 2026-09-30. Each day of owner silence shifts gated work by
one day. Non-gated engineering continues regardless.

### Phase 0: Restart safely (Sep 29 – Oct 2)

1. **Owner decision card.** *Done 2026-09-29:* D1, D3, D6, D8 and D12 are answered
   and D5 partly. Recorded in BL-20260928-1745. The remaining decisions are in
   section 5.
2. **Environment.**
   - Before any disk cleanup, `docker save` the qualified image
     `sha256:e5c7075f…` ([capabilities.ts:4](../src/main/private-agent/capabilities.ts)
     binds tool guidance to that exact ID). A rebuilt image silently downgrades the
     guidance to "unverified", which would confound deck and website quality.
   - Fresh-clone to a non-iCloud path such as `~/Developer/SOAR`. Keep the Desktop
     copy untouched until verification.
   - Fully download `.soar`, copy it, and re-verify the 24 receipt hashes from
     BL-20260928-1443.
   - Rebuild the absolute-path Python environments (`.soar/patch-runtime`,
     `.soar/privacy-filter`) rather than moving them.
   - Move `.env.local` off the synced tree.
   - Install Node 22.22.2 with a version manager so it precedes Node 26 on `PATH`.
   - Time the test that stalled
     (`tests/unit/private-agent-progress.test.ts`, 351 ms on CI).
   - Owner checks on the Mac: FileVault on; Desktop & Documents iCloud sync status;
     Docker Desktop "Send usage statistics" off.
3. **Green CI.**
   - In `tests/integration/local-repository-investigator.test.ts`, pin the fixture
     source at :3287-3293 (and :4458) to `6a32777` instead of `HEAD`. **Do not** pin
     :593; it binds the gated live proof to the real HEAD.
   - Record one build-log entry.
   - Push only with explicit owner approval. The harness blocks public pushes
     without it.
4. **Box checklist and serving probe.** Local runs are approved, so both are zero
   fee.
   - The owner runs [`scripts/box-checklist.py`](../scripts/box-checklist.py) with
     `sudo` on the machine they have a shell on.
   - It prints only an approved list of facts: no IPs, usernames, keys or raw
     command lines.
   - Its output identifies the module (Thor or Orin, memory size, whether it is an
     RM-01 application module), the served weights and flags, and the logging,
     telemetry, SSH, encryption and firewall state.

   The probe runs from the Mac. Record the results as a serving card:
   - **P1** the `/v1/models` root and the actual weights and quantization;
   - **P2** whether effort is honoured through `chat_template_kwargs`: medium and
     xhigh should produce different reasoning-token counts, compared with the
     top-level field;
   - **P3** prefill and decode tokens per second at 8K, 32K and 64K, with and
     without MTP if possible. Report **separately** for prose, code and long
     context. Plain FP8 27B is about 8 tokens/s on prose at this bandwidth class, so
     the observed 42-44 tokens/s probably reflects speculative decoding on
     code-like text or a different model (design §5);
   - **P4** prefix-cache reuse (`cached_tokens`);
   - **P5** integrity of a 12 KB escaped tool argument;
   - **P6** abort, then time the next request (orphaned generation);
   - **P7** one stream versus two concurrent streams;
   - **P8** one non-streaming request over 300 s, to detect an appliance gateway
     timeout;
   - **P9** a context guard: prompt tokens + `max_tokens` ≤ 262,144.
5. **Fast discriminator.** *Done 2026-09-28, narrowed to local Standard vs Heavy*
   (BL-20260928-1836, result in BL-20260928-1921, rows in
   [experiments/registry.jsonl](experiments/registry.jsonl)). The cloud arm moved
   to Phase 2: a cloud coordinator needs session policy changes, so it wasn't
   near-zero engineering.

   | Task | Standard | Heavy |
   | --- | --- | --- |
   | Website, fresh write | 26/30 | 30/30 |
   | RFC memo | 9/12, reject | 7/12, reject |
   | Website repair | 15/30 | 18/30 |
   | Quality V2 | incomplete (shared request budget) | incomplete (`length` treated as terminal) |

   The resulting Phase 1 order is below. The original design, kept for reference:
   - Use the existing headless path (`scripts/private-agent-run.ts`, which already
     allows 40 calls / 80 tools / 30 minutes).
   - Make two changes: send effort through `chat_template_kwargs`, and admit a
     public/synthetic `gpt-6-sol` coordinator (`max_completion_tokens`,
     `reasoning_effort`, caching on, after one compatibility request under
     USD 0.05).
   - Re-run 4 of the failed, already-seen tasks as local-fixed versus Sol. Label
     them **diagnostic, exposed**; they are not capability claims.
   - Use the result only to order Phase 1:
     - Sol succeeds and local fails: prioritize profile and model levers.
     - Both fail: prioritize harness levers, and bring the harness spike forward.
6. **Owner-directed cleanup** (*done 2026-09-29*, BL-20260928-1826-phase0-cleanup).
   - Tagged `archive/router-era-2026-09-28`, then removed the PR6R development
     canary, the held-out benchmark evaluator (`src/benchmark`) and the dead
     `run-session-v2`: about 26k source lines and 23k test lines.
   - Wired legacy tracks stay, and are flagged off in PR-F.
   - Added a docs index and a concise README; archived the old README.
7. **First owner verdict.**
   - The owner runs one small real public job on the current build, with the window
     visible and `caffeinate` held, and records a verdict.
   - Ask the owner why work stopped for 14 days and what would make them delegate.

**Exit:**

- approvals recorded;
- off iCloud;
- CI green;
- serving card written;
- discriminator result;
- ≥ 1 owner verdict.

**Kill and branch rules:**

- **P1 root is not a Qwen3.8-27B-class model, or the endpoint is unreachable.** Stop
  local capability work until the owner identifies or fixes the box.
- **Decode below 15 tokens/s, or typical medium-thinking requests over 10 minutes.**
  The Heavy profile uses low effort and 8K output. Overnight batches become the
  default mode, and the owner is told the expected wait.
- **Local checks still over 3× CI after the move.** Record it as an environment fact
  and use CI as the gate. Spend no more than 2 h on it.
- **No owner answer by Oct 1.** Non-gated engineering (Phase 1 code and tests) only;
  no live runs.

### Phase 1: A runtime that survives real jobs at full strength (Oct 1 – Oct 7, hard stop)

Work lands as one pull request per item, each with a single reviewer, CI and one
build-log entry.

**Order set by the Phase 0 discriminator:**
1. PR-A and PR-D together (thinking helped build tasks; harness rules caused both
   T4 failures);
2. PR-J (research was rejected under both profiles);
3. PR-C and PR-F;
4. PR-E (before the Phase 2 cloud arm);
5. PR-B (no timeouts at current sizes, but long non-streaming requests are cut at
   about 947 s);
6. PR-I.

When an output fails its checks, regenerate from the requirements with the failure
as feedback instead of patching the flawed artifact (T3).

**Status 2026-10-06 (BL-20261006-1008): PR-A and PR-D implemented** on branch
`phase1-heavy-loop` (PR #4), with these recorded deviations from the bullets
below:
- the token-estimate guard is folded into the 640 KiB body cap (3 bytes per
  token plus 16,384 output tokens stays under the 262,144 context);
- thinking effort is fixed at `medium` (probe P2 showed no monotone effort
  effect) and reasoning is not carried between turns;
- vendor sampling is sent only when thinking is on, so `standard` stays
  byte-comparable with September;
- the per-command limit is 180 s, stopped inside the container;
- per-task profile selection in the UI is left to PR-F; the desktop profile comes
  from `SOAR_GENERAL_TASK_PROFILE` (default `heavy`).

**Status 2026-10-06, later (BL-20261006-1141, BL-20261006-1150):** exit
criterion 2 is met for the heavy arm (T4 and T2 completed with no
harness-terminal cause; registry rows `p1d-*`); PR-J1 is implemented on
`phase1-claims-ledger` (PR #5) with public sources cited by retrieved URL and
`sources/` owned by the host; J2 (entailment) is next. Exit criterion 3 is
owner-only and open.

**Status 2026-10-07 (BL-20261007-0120 to BL-20261007-0320):** PR-J2 implemented
on `phase1-claims-entailment` (PR #6): the judge runs after submission is
durable; first live judgement 19 of 20 claims supported, 1 partial. PR-C
(recoverable dispatch, D4) and PR-F (owner surface: general task default and
⌘N target, Labs flag for legacy tracks, plan/action/finish projections
labelled untrusted, "Submitted with reported issues", per-task profile,
`pnpm setup:general`) are implemented and reviewed (BL-20261007-0530,
BL-20261007-0640) as PR #7 and PR #8, stacked on #6. PR-E, PR-B and PR-I
remain; the owner build and exit criterion 3 are owner-only.

**Status 2026-10-07, later (BL-20261007-1040, BL-20261007-1247):** PR-E (cloud
correctness: OpenAI request shape, cached-rate settlement, fee-cap stop,
headless `--arm cloud`) is PR #9, and PR-B (liveness: streamed local replies
assembled at the transport with an inactivity clock from the first byte and a
raw cap from the token limit, the power-save blocker, late-heartbeat events,
and a quit that waits for a running task to pause and offers "Quit now") is PR
#10, stacked on #9. PR-I remains; the owner build and exit criterion 3 are
owner-only.

- **PR-A, Heavy profile at every cap layer.** Raise, together:
  - [controller.ts](../src/main/general-tasks/controller.ts):29, :145, :148 and the
    `phase()` literals at :233-235;
  - [runner.ts:24-26](../src/main/private-agent/runner.ts);
  - [session.ts:49](../src/main/private-agent/session.ts);
  - sandbox lifetime (it must exceed the task deadline);
  - [broker.ts:111](../src/main/private-agent/broker.ts);
  - [store.ts:11](../src/main/private-agent/store.ts);
  - [model.ts:78, :88](../src/main/private-agent/model.ts).

  Settings:
  - Starting point: thinking on, effort from P2, sampling per mode (temperature 1.0,
    top_p 0.95, top_k 20 when thinking), 16K output tokens, about 80 calls,
    120 tools, 60-120 minutes sized from P3.
  - Replace the byte-based body cap with a token estimate checked against
    `max_model_len`. Preserve reasoning across turns if P2 and P5 allow.
  - **Caps are symmetric across local and cloud arms.** Only the timeout and fee
    differ.
  - Add an end-to-end Heavy contract test. The Standard profile remains
    selectable.
- **PR-B, liveness.**
  - Streaming with an inactivity timeout plus an absolute deadline.
  - `powerSaveBlocker('prevent-app-suspension')` while a task runs.
  - Timer-lateness logging (wall-clock and monotonic).
  - A bounded quit.
- **PR-C, recoverable dispatch.** Zero-fee `local_model` and idempotent public GETs
  are retried at most twice, and only after a confirmed upstream abort. Public
  failures return to the model as observations. Tests assert at-most-once for every
  cloud and consultant destination. The flag stays off until D4 is approved.
- **PR-D, tolerant loop.**
  - A text-only reply gets a nudge (at most 3).
  - A `length` finish or `{}` arguments become an observation.
  - Add host-side `write_file`, `append` and `str_replace`.
  - Sandbox command timeouts go through an in-container `timeout -k 5` and return an
    observation instead of destroying the container.
- **PR-E, cloud correctness.**
  - Settle cost with `cached_tokens` at the cached rate, and reserve from a token
    estimate ([model.ts:92,99](../src/main/private-agent/model.ts)).
  - Add a separate OpenAI request shape (`max_completion_tokens`, top-level
    `reasoning_effort`, no `chat_template_kwargs` or `top_k`).
  - Retire the `gpt-4.1` / 2,048-token consultant.
- **PR-F, owner surface.**
  - Make General task the default surface and the ⌘N target
    ([App.tsx:2906-2908](../src/renderer/src/App.tsx)). Put legacy tracks behind an
    off-by-default Labs flag; flag them, don't delete them.
  - Show the plan text, a one-line description of each action, and the finish
    summary, labelled untrusted.
  - Show "Submitted with reported issues" when the agent's own checks failed.
  - Add a `pnpm setup:general` doctor. It locates the image by digest, writes
    settings into the app's user-data folder, checks Node 22, and probes
    `/v1/models` plus a 1-token completion.
- **PR-G, experiment driver and registry.**
  - A headless driver under `caffeinate` with an outer watchdog that reads the
    persisted final state. It never calls `app.close()`.
  - Registry rows go to `docs/experiments/registry.jsonl`. Rows are sanitized:
    hashes, counts and enums, no local paths and no private content.
- **PR-I, artifact image v2 for document review.**
  - `docker save` the qualified image first.
  - Add `docx-revisions` (pure Python, MIT), and `python-redlines` only if its
    linux-arm64 wheel works under `--network none` with a read-only rootfs.
  - Add the edit-plan applier and the redline fidelity checks (design §4).
  - Re-qualify, and update the capability binding at
    [capabilities.ts:4](../src/main/private-agent/capabilities.ts).
  - Fallback if this slips: document-review tasks deliver an issues list, comments
    (python-docx 1.2) and a clean amended copy, with "redline not tested" recorded.
- **PR-J, research claims ledger.** A host quote check (verbatim quote against the
  retained source bytes, with a host-computed locator) that the agent can call and
  that runs as a finish check, plus a local entailment pass (design §4).
- **Owner build.** Tag `owner-v0.1` in a separate git worktree, so development
  rebuilds never invalidate the owner's queued or paused tasks (runtime identity
  binding).

**Exit:**

- the Heavy contract test passes;
- dry runs on 2 already-seen tasks per arm complete without harness-terminal causes;
- the owner has run ≥ 2 real public jobs on `owner-v0.1` and recorded verdicts.

**Fallbacks at the Oct 7 hard stop:**

- If streaming is unfinished, run non-streaming with a timeout sized from P3 and a
  watchdog.
- If reasoning replay is unfinished, record the deviation.
- If the file tools are unfinished, use `execute` only and record it.
- Phase 2 starts no later than Oct 9.

### Phase 2: The fair test (Oct 8 – Oct 15, verdict Oct 15)

**Tasks: 12 fresh tasks, frozen and tagged before the first counted run, each sized
for 30-80 actions.**

| Family | Count | Shape |
| --- | --- | --- |
| Research | 3 | Closed corpus: 15-30 pre-fetched public documents with one planted conflict, delivered as a cited report with a claims ledger. Critical checks: 0 fabricated quotes, planted conflict surfaced, support rate reported. |
| Document review and amend | 3 | Public CC BY contract, synthetic clinical note or unpublished-style manuscript (synthetic) with 5-8 planted issues, delivered as a redline DOCX (or annotated PDF), an issues list and a clean copy. Critical checks: planted-issue recall, 0 unintended changes, fidelity checks. |
| Deck | 2 | 10-15 editable slides from data, with native charts and tables |
| Website | 1 | A static interactive site with 8-12 required behaviours |
| Admin | 2 | A synthetic mailbox and calendar (mbox/`.ics`) with planted constraints, DST edges and injection attempts, delivered as `.eml` drafts and `.ics` holds. Critical checks: 0 canary leaks, 0 injected recipients, correct slots. These run through the general loop to measure capability; the real-mail product uses the fixed pipeline (design §3). |
| Coding | 1 | Codex-like multi-file change in a public stdlib-only Python repository, with hidden `unittest` suites, run in the general loop |

All Phase 2 inputs are public or synthetic, so the cloud arm is permitted. The
owner's real jobs run local-only, in Phase 1 (non-personal) and in Phase 3 (Tier O).
Synthetic personas and mailboxes may be generated with `gpt-6-sol`, but only
without any seed from the owner.

- A separate agent session authors the tasks. Each task gets 5-8 critical checks,
  written before the freeze.
- No checker changes after any candidate has been seen.
- Gold data, hidden tests and raw outputs stay outside Git. Git holds hashes only.

**Arms.** All arms use the same runner, tools, prompts, caps and git SHA:

- **L-Heavy × 2 seeds:** Qwen3.8-27B on the owned device with the Heavy profile.
- **C-Sol × 1:** `gpt-6-sol` coordinator, public/synthetic only, ≤ USD 8 per task.
- **Repair pair, on ≤ 6 L-Heavy drafts that failed:** both halves start from an
  identical draft.
  - **H:** one `gpt-6-sol` critique of a packet of ≤ 64 KiB (brief, text rendering
    of the artifact, the agent-visible self-check), followed by local repair.
  - **L′:** the same packet critiqued by the local model, followed by the same
    local repair.
- **Optional:** the old Standard profile as an automated-only anchor.

**Acceptance.**

1. Automated critical checks, plus an agent pre-score that is blind to the arm.
2. The **owner's blind verdict** on every output. It takes about 4-5 h in total and
   is the outcome of record. The owner also guesses the arm for each output, which
   measures whether the blinding held.
3. One output carries a planted defect, to check verdict quality.

Disagreements between the agent and the owner are logged, never resolved in the
agent's favour.

**Statistics, stated honestly.**

- With n = 12 paired tasks, only large gaps are detectable. Five one-directional
  discordant pairs give an exact two-sided sign test p ≈ 0.06.
- Results are reported per seed with Wilson intervals.
- The rules below are **investment decisions**, not significance claims.

**Pre-registered decision rules**, frozen with the task tag:

- **R0 Infrastructure.** If more than 3 of 12 runs in an arm are `infra_invalid`,
  fix the top cause (≤ 1 day) and re-run only the invalid runs, flagged as re-runs.
- **R1 Ceiling sanity.** If C-Sol accepts fewer than 6 of 12, the result is harness-
  or task-limited, and local is not judged. Run the **harness spike** before any
  verdict (3-day timebox). The spike is a host-side adapter for OpenHands SDK,
  Codex CLI or Qwen Code, fronted by a broker model proxy, with tools kept in the
  `--network none` sandbox.
- **R2 Throughput-limited.** If ≥ 50% of L-Heavy failures are budget or time
  exhaustion, test speed levers before any "not viable" verdict:
  - MTP or a DFlash2 drafter;
  - low effort;
  - longer overnight budgets;
  - 27B NVFP4;
  - Qwen3.6-35B-A3B (about 100-139 tokens/s with a drafter on Thor,
    community-reported);
  - Qwen3.8-Flash-Next as a community NVFP4/FP8 hybrid, only if the device has
    128 GB (46.7 tokens/s reported; not vendor-supported).
- **R3 Local viable.** If L-Heavy is ≥ C-Sol − 2 on both seeds, choose **Branch A**:
  local-first product; cloud only as a permitted packet; Tier O is the priority.
- **R4 Model gap.** If C-Sol is ≥ 8/12 and L-Heavy is ≤ C-Sol − 4 on both seeds,
  choose **Branch B**, hybrid-led: cloud serves public work within the envelope, and
  local serves Tier O. If H beats L′ by ≥ 2 on the repair pair, a minimized-packet
  cloud critique becomes the hybrid mechanism to test on private tasks.
- **R5 In between.** Choose **Branch A-narrow**: local-first for families where
  L-Heavy came within 1 of C-Sol, cloud (public only) for the rest.
- **Branch E, shelving the local tier.** Allowed only after R1 and R2 are cleared, a
  harness spike, a device-sized alternative model, and explicit owner sign-off.
  Never a default.

**Cost:**

| Item | Cap |
| --- | --- |
| C-Sol | ≤ USD 100 |
| Repair pair | ≤ USD 5 |
| Phase total, hard cap | ≤ USD 120 |
| Local | zero fee; roughly 40-80 GPU hours, overnight batches allowed |

### Phase 3: Tier O, the owner's own files, local-only (gated; target Oct 12 – Oct 20)

**Preconditions, all recorded:**

- **Box checklist**, run by the owner with `scripts/box-checklist.py`, then fixed
  where needed (design §2 P10-P13, P16):
  - device and memory confirmed;
  - weights and launch flags recorded;
  - vLLM request and output logging off;
  - vLLM usage stats, Hugging Face telemetry and Apport/whoopsie off;
  - vendor-default passwords changed, SSH key-only;
  - vendor management module (for example an RM-01's ESP32) assessed or isolated;
  - nftables default-deny outbound on the box.
- **Transport:** SSH local forward or WireGuard. On an RM-01 this goes through the
  application module. Plain LAN HTTP does not qualify.
- **Packet-capture canary:** one canary job with a capture on the box uplink; every
  connection must reconcile to the ledger (P12).
- **The Mac:** FileVault on; all SOAR state, `.soar`, exports and `.env.local` off
  iCloud; Docker Desktop usage statistics off (P9).
- **Code:** labels (P1), default-deny egress by label (P2-P3), audit hash chain and
  disclosure report (P8), deletion with a residual report (P14), and agent
  permission deny rules on Tier-O paths (P5). These can be built during Phase 2
  while the GPU runs batches.
- **An `Approved` build-log entry** quoting the owner.

**Rules:**

- **Egress.** Cloud, web and consultation are disabled. The schema gains a tier enum
  in place of `publicOrSynthetic: literal(true)`.
- **No agent reads Tier-O data.** The development agent and every agent reviewer
  are themselves cloud disclosure paths. They must never read Tier-O inputs,
  outputs, traces or databases. Debug from hashes, counts and symptoms the owner
  describes.
- **Registry.** Rows are hash-only.

**First candidate jobs**, in the owner's priority order:

1. Review and amend one of the owner's own documents, closed-corpus.
2. A research brief over documents the owner supplies, closed-corpus.
3. Admin Stage 1: draft replies and calendar holds from a file export of one mail
   folder and calendar. The owner sends from their own client (design §3).
4. A patch in one of the owner's private repositories (lower priority).

**Exit:**

- ≥ 1 owner-accepted Tier-O job;
- the broker ledger shows zero unapproved egress.

**Kill and branch rules:**

- **Box unverifiable.** Tier O stays blocked and the privacy promise is recorded as
  unproven. The owner chooses one of:
  - a documented residual risk for low-sensitivity files;
  - other hardware;
  - pausing the tier.
- **Any unintended egress.** Stop immediately, record a `Failed` entry, and require
  re-approval before resuming.

### Phase 4: A real week of use (Oct 21 – Oct 27, branch review Oct 27)

The owner delegates normal work on the owner build, and agents fix only observed
blockers.

- **Continue toward MVP exit** if OAJ ≥ 4 of ≥ 5 submitted, across ≥ 2 families,
  including ≥ 1 Tier-O job (when Tier O is open).
- **Narrow to the single family with accepted outputs and repeat once** if fewer
  than 2 are accepted.
- **Branch D: pause development and record the adoption lesson** if 0 are accepted
  or the owner submitted fewer than 3 jobs.

**Adoption kill rule, applied at any time:** no owner-run job by Oct 9, or no owner
verdict for 7 days. Pause and talk; do not build more.

Declared owner unavailability, such as travel, pauses these clocks. The owner's
14-day absence in September was travel. It also shows that "delegate while away" is
a real requirement (see Later).

### Later, conditional on results (nothing here is approved)

**On Branch A or B**, work toward the MVP exit:

- A `render_and_view` tool that returns screenshots of websites and slides to the
  local vision-language model, only if deck and website acceptance is limited by
  visual quality.
- Requirement checks the agent can call, feeding the repair loop.
- Move the runner and sandbox to an always-on host, for delegate-and-walk-away jobs
  that take hours. This is promoted because the owner travels. It needs:
  - a memory budget on the unified-memory device;
  - a UPS and a second path for power-cycling;
  - remote access over WireGuard or Headscale (Tailscale only with its metadata
    disclosure accepted).

  See design §5.
- Admin assistant Stages 1b-3 (read-only sync, owner-approved draft writes,
  per-action approved sends), each behind its own gate (design §3).
- Public web search for public jobs only (Brave API or self-hosted SearXNG, each
  query ledgered), and a paged source reader in place of the 32 KiB prefix.
- **Cloud help that respects the owner's rule.** Cloud models improve prompts,
  skills and checklists offline, on synthetic tasks only, while runtime stays fully
  local. This is OpenJarvis-style: that paper reports on-device accuracy within
  3.2 points of cloud. Separately, cloud may serve public subtasks such as public
  research briefs. A minimized-packet test on private tasks happens only if the
  owner opts in explicitly (D15), and never for regime-tagged data.

**Always, once the window ends:**

- Remove the wired legacy tracks once they have been flagged off and unused for a
  full phase. The dead modules were already removed in Phase 0.
- Redesign the build-log validator to allow monthly rotation.

## 4. Process reset (effective on approval)

- **Standing envelope, in one `Approved` entry:**
  - (a) unlimited zero-fee local runs on public, synthetic or owner-declared-public
    inputs within the Heavy caps;
  - (b) `gpt-6-sol` on public/synthetic tasks only, **USD 300 in total**
    (approved by the owner on 2026-09-29), never more than USD 8 per task.
    Allocation:

    | Use | Cap (USD) |
    | --- | --- |
    | Phase 0 discriminator and compatibility request | 15 |
    | Phase 2 cloud arm (100) and repair pair (5) | 105 |
    | Synthetic personas, mailboxes and documents (no owner seed) | 20 |
    | Harness spike or re-runs of invalid runs | 40 |
    | Public-work cloud route after Phase 2, weekly | 25 |
    | **Hard total** | **300** |

    Remaining budget is tracked in the registry;
  - (c) no approval entries for offline or USD 0 work.

  Still needing an explicit owner approval each time:
  - real private data (Tier O);
  - new egress destinations;
  - spend beyond the envelope;
  - public pushes.
- **One trial registry row per run.** It records:
  - SHA, input hash, family, fresh or already seen, arm and profile;
  - calls, tokens, USD, unknowns;
  - an outcome enum (`accepted` / `rejected` / `incomplete` / `infra_invalid`);
  - terminal cause, critical-check score, owner verdict, owner minutes,
    interventions;
  - a one-line lesson.
- **Build log.** At most one entry per PR or batch, for decision classes only:
  provider, egress, permission, persisted contract, budget, pivot, milestone
  verdict. Typically ≤ 25 lines. Don't log push mechanics or permission prompts.
- **Documents.** This file is the single living plan. HANDOFF is regenerated at each
  phase end. Each batch gets one experiment card (hypothesis, arms, budget, decision
  rule, stop rule). No new per-trial plan-plus-report pairs.
- **Trial-first rule.** After a failed trial, the next action is a trial with one
  changed model-side or route lever. Host or infrastructure work is allowed only
  when infrastructure invalidated ≥ 2 consecutive trials, time-boxed to half a day.
- **Commits.** Commit daily on branches; each PR runs CI; `main` stays green.
- **Review.** Single-reviewer default. A full multi-agent review only when the owner
  calls a decision high-stakes.
- **Weekly 30-minute review:** OAJ, accepted per route, cost per accepted job,
  interventions, trial throughput.

## 5. Owner decisions

Defaults apply only to non-gated planning. They never authorize live, paid, private
or publication actions.

| ID | Decision | Status or default if silent |
| --- | --- | --- |
| D1 | **Jobs to hand off.** | **Answered 2026-09-29:** deep and reliable research; document review and amendment; website building; slide generation; day-to-day admin (email replies, calendar management); plus the privacy rule quoted in section 1. Per-job acceptance checks get drafted with the owner per job; private specifics never go into anything an agent reads. |
| D2 | **Acceptable wall time per job:** ≤ 30 min interactive, ≤ 2 h, or overnight. | **Answered 2026-09-29:** not a concern yet. |
| D3 | **Cloud envelope.** | **Answered:** USD 300 in total, local runs unlimited. Allocation in section 4. |
| D4 | **Recoverable semantics** for zero-fee local inference and public GETs (cloud stays at-most-once). | **Approved 2026-09-29.** Cloud and consultant stay at-most-once. |
| D5 | **Device and box checklist.** | **Partly answered:** NVIDIA Jetson module, owner has shell access. The checklist is deferred at the owner's request (2026-09-29); the owner supplied the endpoint, which is kept only in ignored local configuration. Tier O stays blocked until the checklist runs. |
| D6 | **Codex-like coding.** | **Answered:** in scope, lower priority. 1 Phase-2 task; a private-repo patch is a later Tier-O candidate. |
| D7 | **Websites.** | **Answered by D1:** websites stay (1 Phase-2 task). Repairs of the already-seen procurement site stop. |
| D8 | **Governance supersession.** Retire:<br>• the stop rule at [MVP_COMPLETION_AUDIT.md:107-110](MVP_COMPLETION_AUDIT.md);<br>• the handoff's next-milestone ordering;<br>• the Stage B/C/D ladder ([MVP_PRIVACY_FIRST_AGENT_V1.md:343-370](plans/MVP_PRIVACY_FIRST_AGENT_V1.md), [MVP_PRIVATE_AGENT_EXECUTION_V1.md:24-34](plans/MVP_PRIVATE_AGENT_EXECUTION_V1.md));<br>• the 40-call / 4,096-token / 192 KiB / 30-minute bound at [:42-43](plans/MVP_PRIVATE_AGENT_EXECUTION_V1.md). | **Approved 2026-09-29.** Replaced by this plan and the USD 300 envelope. |
| D9 | **Owner time:** about 2 h per week, verdicts within 72 h, about 4-5 h of blind grading Oct 15-17, and a 30-minute weekly review. | Blind agent grading, labelled provisional. Branch E is never applied. |
| D10 | **Publication:** approve pushes to public `main`, per push or per phase. | **Approved 2026-09-29** for reviewed work, never credentials, private endpoints, raw traces or evaluator gold. |
| D11 | **Server changes on the box:** prefix caching, `--reasoning-parser qwen3`, `--tool-call-parser qwen3_xml`, MTP, telemetry-off environment. | No change; results labelled "unpinned serving". |
| D12 | **Why work stopped Sep 14-28.** | **Answered:** travel abroad. Unavailability now pauses adoption clocks, and delegate-while-away is promoted. |
| D13 | **Mail and calendar:** which accounts (personal Gmail, Workspace, university Microsoft 365, iCloud, other IMAP) and which Mac clients. Is draft-only acceptable, with you pressing Send in your own client? | **Deferred 2026-09-29** until connectors exist. |
| D14 | **Jurisdiction and third-party data.** Which countries or provinces apply? Will Tier-O jobs contain other people's data (clients, patients, participants, correspondents) or only yours? Any data under a Data Use Certification, IRB protocol, NDA or export control? | **Answered:** real jobs will include other people's data, so the strict profile applies. Jurisdictions not yet stated. |
| D15 | **Is "never to the cloud" absolute for labelled data**, or may you opt in per task to reviewed placeholder packets? | **Answered:** never automatic. The owner may approve cloud help for one specific task after a bad local result, through exact-packet approval, with a consent reminder for third parties' data. Not planned during development. |
| D16 | **Retention default** for finished private jobs. | Delete workspaces after 30 days; keep only the hash-only audit trail. |
| D17 | **Remote access while travelling:** WireGuard or Headscale, or Tailscale (which discloses device names, IPs and connection times to its coordination server). | WireGuard. |
| D18 | **Mac state:** FileVault, Desktop & Documents iCloud sync, Advanced Data Protection, Time Machine encryption. | Assume unsafe until checked; Tier O stays blocked. |
| D19 | **Provider-side AI** (Gemini in Gmail, Copilot in Outlook) also reads your mail. SOAR cannot control it; do you want to turn it off? | Informational only. |

## 6. Risks

| Risk | Mitigation |
| --- | --- |
| The Phase 1 engineering list slips, repeating infrastructure-first. | The Phase 0 discriminator and owner verdict come first. Oct 7 is a hard stop with recorded fallbacks. The trial-first rule applies. |
| Thinking-on jobs take hours. Prose may decode at about 8-18 tokens/s, not the 42-44 seen on code-like text. | P3 reported per workload; overnight batches; the throughput-limited rule (R2) with device-sized faster models before any "not viable" verdict; later, an always-on host. |
| Ledger artefacts truncate the cloud arm. | PR-E before Phase 2. Caps are symmetric across arms. |
| n = 12 is noise-prone. | Two local seeds, paired exact tests and investment-style rules. Phase 4 is a sequential replication on real jobs. |
| Owner verdicts become rubber stamps. | A planted defect, arm guesses, owner minutes recorded, and disagreements logged. |
| Private data leaks through development tooling. | Agents are barred from Tier-O data; the registry is hash-only; the jobs card holds data classes only. |
| The device is a vendor appliance with an unknown management plane. | The box checklist gates Tier O. An unverifiable box keeps the privacy promise explicitly unproven. |
| Legacy code breaks when flagged off. | Flag, don't delete, during the window. The CI fixture is pinned. |
| Prompt injection through email, calendar invites or reviewed documents manipulates drafts or recipients. | No send path; recipients and calendar math computed by code; taint flags; owner review of every artifact; injection canaries in Phase 2 admin and review tasks. Never claim immunity (design §3). |
| Pressure to send private work to the cloud when local quality is weak. | No automatic fallback: the job pauses and states the gap. Cloud help for labelled data exists only if the owner opts in explicitly (D15). |
| "Local" is not actually local: vendor telemetry, plain-HTTP link, iCloud, crash reporters. | Tier-O preconditions plus a packet-capture canary before any claim (design P9-P12). |
| The owner travels and cannot power-cycle or reach the box. | Delegate-while-away work: remote access, a UPS, and a second power path before relying on unattended jobs.

## 7. What not to do

- Don't run counted evaluations under the old 4,096-token, thinking-off, 15-minute
  profile.
- Don't re-run already-seen tasks as fresh evidence.
- Don't build a new router, export framework, filter benchmark or per-task
  evaluator before Phase 2 reports.
- Don't replay unknown cloud dispatches, and don't settle them by hand.
- Don't send personal or professional data, or private specifics from the jobs
  card, to any cloud model, search engine, telemetry service or development agent.
  This includes pasting raw device output; use the checklist summary.
- Don't count file existence, mechanics or test totals as acceptance.
- Don't prune Docker images or rebuild the artifact image without saving the
  qualified one and recording re-qualification.

## 8. Relationship to earlier plans

- **September 7 redesign (MVP-0, never adopted).** Kept: its rules (a cloud
  reference arm through the same harness, no model switch inside a progressing loop,
  restart with artifacts rather than continuation, cost per accepted task against
  the cheapest sufficient tier). Replaced: its SWE-rebench coding workload, by the
  owner's workload plus two coding tasks, run on the existing harness.
- **[Privacy-first design](plans/MVP_PRIVACY_FIRST_AGENT_V1.md) (September 11).**
  Kept: the goal, trusted-boundary rules and priority order. Superseded on
  approval: its Stage B/C/D ladder, and the four-family equal-certification framing.
- **[Course correction](MVP_COMPLETION_AUDIT.md) and [handoff](HANDOFF.md)
  (September 14 and 28).** Kept: the diagnosis and the stop rules against unchanged
  re-runs. Replaced on approval: the ordering "resolve lifecycle, then one workflow".
