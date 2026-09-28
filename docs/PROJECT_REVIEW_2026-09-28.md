# SOAR whole-project review

Reviewed: **2026-09-28 UTC** (2026-09-29 local), on `main` at `47e3c6f`, identical
to `origin/main`. Status: **review complete**. The accompanying
[revised plan](PLAN.md) is `Proposed` and needs owner approval before any of it
takes effect.

This review checks the whole project against the owner's ultimate goal. It does not
repeat the [handoff](HANDOFF.md). It launched no model request, application,
Docker container, paid call or test run. The only exceptions were read-only
checks of GitHub CI status and public web pages. Every finding below survived an
adversarial re-check against primary sources (method at the end).
Where the re-check corrected a claim, the corrected version is the one stated.

## The goal being measured

The goal is that a user can delegate heavy, general, end-to-end agentic work to
SOAR. Examples are deep research, file auditing, websites and editable decks, the
kind of work Manus does. Codex-like coding is also in scope. The main agent should
run on a dedicated, owned device, about USD 3,500, serving Qwen3.8-27B-class
weights through vLLM. Cloud models should see only exactly permitted packets. The
priority order is **privacy >= quality > savings > latency**. The owner's working
method is to build an MVP, fail fast, learn and iterate.

## Verdict

The project built a trustworthy **safety envelope**. It has a single egress broker,
an offline tool sandbox, exact-packet cloud approval, a durable no-replay ledger and
honest submitted-versus-accepted reporting. That envelope surrounds an agent that
has **never been allowed to work at full strength**, has **never been compared with
a cloud model on the same task**, and has **never been used by its owner on real
work**. The two facts the whole thesis rests on are still unmeasured:

1. **Capability.** Can the owned Qwen3.8-27B tier, configured the way its vendor
   recommends, deliver acceptable heavy work? And how far is it from a cloud
   ceiling running through the same loop?
2. **Need.** Does the owner have recurring private jobs that justify keeping the
   work on owned hardware? No real private data has ever entered SOAR. The desktop
   schema admits only `publicOrSynthetic: true`
   ([general-task-contracts.ts:46](../src/shared/general-task-contracts.ts)).

Over the same period, process weight grew faster than product learning:

- 259 build-log entries in 16 active days, 90 of them `Approved`.
- 73 plan and report documents.
- 26 days without a commit, then one 248-file commit.
- A 14-day pause after the last experiment. The owner later clarified this was
  travel abroad, not a process failure (2026-09-29).

The September 14 audit diagnosed this drift correctly. Its next step, a narrow
lifecycle fix followed by one n=1 workflow on the same limited profile, would not
separate a model limit from a harness limit from a lack of demand. The
[revised plan](PLAN.md) replaces that step with a fair local-versus-cloud test, the
owner's own verdicts as the outcome of record, and a gated tier for the owner's
private files.

## Scorecard against the goal

| Goal component | Status | Evidence |
| --- | --- | --- |
| Delegate **heavy** general work | Not demonstrated | Three accepted outputs on the general-task path: a CLI invoice audit (accepted only under a checker rewritten after the candidate was seen), a 2,547-byte desktop support audit, and a three-slide deck. Research went 0/3 and websites 0/5. All 16 live runs used at most 20-40 calls and together used about 56 minutes of agent time. |
| Codex-like coding | Cloud works; local unproven; dropped from the general path without a decision | Cloud patches were review-acceptable 11/12. Every local stage in the hybrid arm fell back to cloud. No coding task ever ran through the general loop, and no owner decision retired coding ([HANDOFF](HANDOFF.md) "earlier coding pilot"). |
| Owned device does the main work | Unmeasured at proper settings | Every general-task run used thinking off, a 4,096-token output cap, 20 calls and 15 minutes ([controller.ts:29,145,148](../src/main/general-tasks/controller.ts)). |
| Cloud only for permitted packets | Mechanism built, never used for real | Consultation was exercised only with scripted providers. The prepared real profile targets `gpt-4.1` with 2,048 output tokens, not the intended cloud tier. |
| Privacy | Architecture sound; never exercised on real data; deployment trust unverified | Only public/synthetic admission exists. The inference endpoint is plain HTTP, weights and flags have never been inspected, and it is served under the alias "RM-01 VLM". |
| Quality floor | No owner verdict ever | Every acceptance was made by an agent reviewer on agent-authored synthetic tasks. The owner has never made a Keep/Reject decision. |
| Savings | Immaterial at observed costs | Lifetime API spend is about USD 17-18. Cloud cost about USD 0.24-0.40 per accepted small coding patch. The device is a sunk cost. |
| Fail fast, learn | Strong early, then degraded | The 36-run screen was frozen and completed in 78 minutes for USD 12.31. After that came about 5.4 log entries per live trial, and 26 entries around five website attempts. The later 14-day pause was owner travel. |

## What is right, and should be kept

1. **Ordered, non-tradeable priorities.** Privacy gates which routes are eligible;
   quality is a floor; cost and latency are compared only among routes that pass
   both ([privacy-first design section 1](plans/MVP_PRIVACY_FIRST_AGENT_V1.md)).
2. **One general job loop** rather than four task-specific apps. Task families are
   metadata, not separate controllers.
3. **The privacy boundary design.**
   - A single host broker owns all egress.
   - Tools run in credential-free, `--network none` containers.
   - Outputs inherit the restrictions of their inputs.
   - Redaction never grants disclosure, and consent is bound to exact bytes.
   - The privacy filter's result (84.38% sensitive-character coverage, 5 of 12
     canaries missed) was correctly kept advisory.
4. **Honest evidence.**
   - Submitted and accepted are kept separate (`independentAcceptance` stays
     `not_evaluated` in the app).
   - Negative results are append-only and checked by the validator.
   - Unknown dispatches are never replayed.
   - Cost is ledgered in microdollars.
   - Owned hardware is never treated as free.
5. **Independent, source-based acceptance.** It caught plausible but wrong outputs:
   a research memo that presented a recommendation as a requirement, a website
   that got a currency conversion wrong, and cloud patches that passed tests but
   had defects.
6. **The September 8 coding screen as a model experiment.** It was pre-registered,
   matched, blind-reviewed, cheap and fast. It also showed exactly why the hybrid
   arm failed: its first cloud input was byte-identical to the prepared-cloud arm's
   on 12/12 tasks, so local work contributed nothing.
7. **Reusable pieces.**
   - Native OpenAI-compatible tool calling with schema-validated arguments.
   - A crash-safe, event-sourced loop with content-addressed checkpoints.
   - Restorable observation compression.
   - A hash-pinned artifact toolchain (Chromium, LibreOffice, python-pptx) in an
     offline image.
   - A genuinely editable native PPTX path.
8. **The September 14 self-audit and September 28 handoff.** They named the drift,
   set stop rules and gave a successor one entry point.

## What is wrong, ranked by impact on the goal

### W1. The two load-bearing unknowns were never tested (critical)

- **Capability versus a ceiling.** No trial ever ran a cloud model through the same
  harness on the same task. So every general-task failure is unattributable: it
  could be the model, the profile, the harness or the task.
- **Need.** No owner-specific private job, data class or disclosure scenario is
  written down. The design itself lists "acceptable disclosure examples" and GPU
  trust verification as open decisions
  ([MVP_PRIVACY_FIRST_AGENT_V1.md:64-66, 434-438](plans/MVP_PRIVACY_FIRST_AGENT_V1.md)).
- **Result.** All the governance and boundary machinery protects a use case that
  has never been exercised, and the owner-value question has no data.
- **Plan response:** Phase 2 fair test; D1 jobs card; Phase 3 Tier O.

### W2. The coordinator profile contradicts vendor guidance and the owner's priority order (critical)

What the general-task profile does:

- Forces thinking off ([controller.ts:145](../src/main/general-tasks/controller.ts)).
- Caps output at 4,096 tokens ([model.ts:78](../src/main/private-agent/model.ts)).
- Sends no sampling parameters.
- Uses non-streaming requests with a 300 s timer.
- Allows a 192 KiB body cap, 20 calls, 30 tools and 15 minutes.

What the vendor's guidance says:

- The Qwen3.8-27B card puts thinking on by default, recommends preserving reasoning
  in agent use, and recommends long outputs.
- The vendor's agentic scores were measured with thinking on, 256K context and
  32K+ output tokens.
- An independent index scores the model 20 without reasoning and 34 with it.

The project's own matched control passed 3/3 with thinking on versus 2/3 with it
off, and called the fast setting "not a maximum-capability profile"
(BL-20260908-1452). Receipts show the caps binding:

- Three consecutive 4,096-token responses with empty tool arguments (vLLM reports
  these as `tool_calls` with `{}`, not `length`).
- A request of at least 214,335 bytes stopped at the 196,608-byte cap.
- 20 of 20 calls used in 245.8 s with repeated actions.

Two further problems:

- **Thinking effort may never have been set.** Thinking-on runs send `reasoning_effort`
  at the top level ([model.ts:88](../src/main/private-agent/model.ts)). The vLLM
  recipe sets effort through `chat_template_kwargs`, so the historical "medium" runs
  may have run at the server default (xhigh).
- **The caps are enforced in eight places:**
  - [controller.ts:29](../src/main/general-tasks/controller.ts) and its
    `phase()` literals at :233-235;
  - [runner.ts:24-26](../src/main/private-agent/runner.ts);
  - [session.ts:49](../src/main/private-agent/session.ts);
  - sandbox container lifetime of 1,800 s;
  - [broker.ts:111](../src/main/private-agent/broker.ts);
  - [store.ts:11](../src/main/private-agent/store.ts);
  - [model.ts:78](../src/main/private-agent/model.ts).

  Lifting them requires one coordinated change.

**Plan response:** Phase 0 serving probe; Phase 1 PR-A.

### W3. Ordinary events end tasks permanently (critical)

The at-most-once ledger was designed for paid cloud disclosure. It also covers
zero-fee local inference and public GETs, and any unsettled dispatch blocks the
job ([store.ts:161](../src/main/private-agent/store.ts)). As a result, each of
these ends a task permanently and non-resumably:

- a local-model timeout;
- a public 404, redirect, bot block or response over 64 KiB;
- a text-only reply;
- `finish_reason=length`;
- a 90 s sandbox command timeout, which destroys the container;
- a force-quit.

Two of the four observed real failures were harness-caused. This makes every trial
expensive and turns harness trivia into "failures".

**Plan response:** Phase 1 PR-C and PR-D. Strict no-replay stays for cloud and
consultant destinations.

### W4. The 737 s overrun is a host-side stall; the laptop cannot support "delegate and walk away" (major)

- The 300 s guard is one `setTimeout` on the Electron main thread, cleared only in
  `finally`. The recorded `request_timeout` at 737,461 ms therefore fired about 437 s
  late.
- A stalled server alone would have been aborted at 300 s. The overrun began a few
  seconds after the test driver's `app.close()` left SOAR running with no window.
- There is no `powerSaveBlocker`. On macOS the app deliberately stays alive with no
  window ([index.ts:47](../src/main/index.ts)).
- App Nap, idle sleep or iCloud-induced synchronous I/O stalls all fit. The macOS
  `pmset` log from September 14 is gone, but vLLM server logs could still
  discriminate.
- More broadly, the runner and sandbox live in the laptop app. Thinking-on heavy
  jobs at the measured ~42-44 tokens/s decode can take hours.

**Plan response:** Phase 1 PR-B, headless driver with a watchdog; always-on host
later.

### W5. The owner has never been in the loop (major)

- There are zero owner Keep/Reject decisions across about 17 coding experiments and
  16 general-task runs. The accepted real-task runs were driven by an automated live
  driver.
- The app opens on the legacy Repository Investigator, not General task
  ([App.tsx:2906-2908](../src/renderer/src/App.tsx)), and ⌘N goes there too.
- Setup is developer-only:
  - Node 22, then a manual `docker build` with no documented command.
  - Copying a `sha256` image ID into `.env.local`.
  - Consultant variables in the launching shell.
  - No probe of model connectivity.
- The agent's plan and finish summary are recorded but never shown.
- A website was marked Submitted even though its own tool output reported
  mismatches.

**Plan response:** Phase 0 first owner verdict; Phase 1 PR-F and owner build; OAJ
north star.

### W6. Research and websites are limited by their structure, not only by the model (major)

- Research allows 1-3 exact user-supplied URLs, 5 fetches, a 64 KiB hard reject and
  a 32 KiB visible prefix. There is no search and no link following
  ([public-sources.ts:6-7](../src/main/private-agent/public-sources.ts)). That is
  not deep research.
- The one fully rejected research memo did fail on reasoning with the relevant text
  visible. That is a real, weak negative signal for the thinking-off profile.
- Websites and slides get no visual feedback. The model is a vision-language model,
  but observations are text-only. Screenshot feedback is the largest published lever
  for web generation: WebGen-Agent reports 26.4% rising to 51.9%.
- The only in-app check is "inputs unchanged and output non-empty".

**Plan response:** Phase 2 uses a closed-corpus research family; research tooling,
visual feedback and requirement checks are conditional later work.

### W7. The permitted-cloud half of SOAR has never run, and the consultant profile is wrong (major)

- Consultation was set up with `gpt-4.1-2025-04-14`, 2,048 output tokens and
  `max_tokens`. It is single-use and model-initiated only, and has never made a real
  request.
- The ledger settles cost as `prompt_tokens × uncached input price`, ignoring
  `cached_tokens`, and reserves `bodyBytes × input price`
  ([model.ts:92,99](../src/main/private-agent/model.ts)). Per-job caps would
  therefore truncate a cloud arm on ledger artefacts rather than real spend.
- The best published hybrid evidence (an advisor reading shared context) buys cost
  efficiency, not quality parity. It relies on shared context that SOAR's
  exact-packet rule forbids for private tasks. So the hybrid's quality value under
  SOAR's constraints is untested, not implied.

**Plan response:** Phase 1 PR-E; Phase 2 repair pair; later minimized-packet test.

### W8. Process converted failures into infrastructure work (major)

- **Volume.** The build log has 17,571 lines and 134,410 words:
  - 259 entries in 16 active days;
  - status counts: Approved 90, Verified 78, Implemented 55, Failed 14, Proposed 10,
    In progress 10, Blocked 2, Released 0;
  - 35 correction headings.
- **Ratio.** Docs hold 43 plans and 30 reports, about 34k lines in total, against
  about 4k lines of core general-task code.
- **General-task phase.** The general-task phase alone had 76 entries for 14 live
  trials: about 5.4 entries per trial and 34 `Approved` entries, all at zero API
  fees and mostly issued by the agent under a broad owner instruction.
- **The website loop.** It ran 5 attempts, 26 entries and 0 accepted outputs, with
  the best score 15/30 twice. The pattern was to re-admit the same already-seen task
  under an unchanged profile, with host fixes in between. The obvious model levers
  were never pulled: output cap, thinking, and the USD 0.10 consultation.
- **Stalls.** There were zero commits from September 3 to 27. The absence of
  experiments from September 14 to 28 was owner travel (owner, 2026-09-29), not a
  process effect. It does show that the product cannot yet work while the owner is
  away.

**Plan response:** the process reset in the plan.

### W9. Engineering health works against fast iteration (major)

- **CI on `main` is red for a deterministic reason.**
  - `docs/BUILD_LOG.md` grew to 1,064,131 bytes.
  - That passes `search_text`'s 1 MiB per-file cap
    ([search-text.ts:19](../src/main/tools/search-text.ts)).
  - A legacy investigator test builds a fixture from the repository's own `HEAD`
    (`tests/integration/local-repository-investigator.test.ts:3288`, also :4458).
  - The documentation habit therefore broke the build. The build step never ran,
    and CI never exercises the general-task Docker runtime or its e2e specs.
- **The development machine is the main drag.**
  - The repository sits on an iCloud-synced Desktop, with the disk about 94% full.
  - About 26,305 of 28,138 `node_modules/.pnpm` files and 80,011 of 80,324 `.soar`
    files are evicted ("dataless").
  - The same suite runs in about 75 s on CI but hits 60-300 s deadlines locally.
  - `.env.local` and the retained evidence live in the synced tree, which conflicts
    with privacy first.
- **Legacy weight.**
  - Only about 13% of the 78,228 TypeScript source lines serve the current goal:
    4,689 for general task and 5,700 for the coding pilot.
  - About 48% is legacy that is still wired at every app start.
  - About 31% is unshipped or dead (PR6R canary, held-out evaluator,
    `run-session-v2`).
  - 16 of 36 package scripts are legacy-only.

**Plan response:** Phase 0 environment and CI; legacy behind a flag.

### W10. Economics cannot carry the product; savings should not drive design (major)

- **Price per accepted patch.** Cloud cost about USD 0.24-0.40 per accepted small
  coding patch.
- **Break-even.** Recovering a USD 3,500 device from API savings at that price would
  take roughly 9,000 full replacements, or about 46,000 tasks at a 20% saving.
- **Cloud got cheaper.** On 2026-09-22 OpenAI released `gpt-6-sol` at USD 2 / 0.20 /
  10 per 1M tokens (input / cached / output), half of `gpt-5.6-sol`'s 4 / 0.40 / 20.
- **Framing.** The device is sunk, so capital payback is moot. The device is
  justified by privacy, control and offline capability, or not at all.
- **Status of the gate.** The 20% savings gate was already retired on September 11.
  Some documents still lead with savings language.

### W11. Stale premises in current documents (major)

- **Flash-Next.** Qwen3.8-Flash-Next (about 180B total, 172.78 GiB at FP8) is
  vendor-validated only on multi-GPU servers, so the 27B is the local model.
  *Correction 2026-09-29:* a community NVFP4/FP8 hybrid build reportedly runs it on
  a 128 GB Jetson Thor at 46.7 tokens/s with MTP. It is therefore a possible
  speed-lever candidate if the device has 128 GB, but it is not vendor-supported.
- **Cloud reference.** Pricing and the reference tier should move from GPT-5.6 to
  GPT-6 (`gpt-6-sol`; `gpt-6-astra` at USD 10/50 is the ceiling). The `gpt-4.1`
  consultant is obsolete.
- **The device itself.** The served alias "RM-01 VLM" matches RMinte's RM-01
  "portable AI supercomputer", an appliance with a vendor OS (TianshanOS), its own
  inference engine and a management plane. This is an inference, not confirmed.
  The owner confirmed on 2026-09-29 that the device is an NVIDIA Jetson GPU
  module and that they have shell access; the exact module and any vendor wrapper
  are still to be recorded by the box checklist.
  - If it holds, the vendor software is inside the privacy boundary and must be
    assessed before any real private use.
  - The measured ~42-44 tokens/s decode is high for a dense 27B FP8 model on a
    Jetson-Thor-class memory bus. Community measurements at 273 GB/s show about
    8 tokens/s on plain prose, about 18 with MTP and about 32 with a DFlash2
    drafter. So the figure implies speculative decoding on code-like text, a 27B
    NVFP4 build with a drafter, or a different model. The served weights must be
    verified, and prose throughput measured separately, before quality or latency
    claims.
  - On an RM-01 the inference module has no SSH. The owner's shell may be on the
    x86 application module, which has a publicly documented default password.
- **Noise floor.** It is misquoted in places. In the coding screen, the prepared
  cloud and hybrid arms (byte-identical first cloud inputs) were 10/12 each with the
  same per-task outcomes; 11/12 was the separate cloud arm. There is no measured
  A/A noise, and local variance at temperature 1.0 is unmeasured.

### W12. Approved gates were abandoned without a recorded decision (minor, but blocks restart)

- **Stage B ledger never finished.** The owner-approved Stage B four-session ledger
  stayed at 0 accepted, 1 failed and 3 unrun
  ([MVP_PRIVACY_FIRST_AGENT_V1.md:343-370](plans/MVP_PRIVACY_FIRST_AGENT_V1.md)).
- **Handoff sequence never approved.** The September 14 course correction is still
  `Proposed`, yet the handoff adopted its sequence.
- **Live trials formally blocked.** Two rules together forbid any live trial:
  - the audit stop rule "no live trial while execution ownership is unresolved"
    ([MVP_COMPLETION_AUDIT.md:107-110](MVP_COMPLETION_AUDIT.md));
  - the 40-call / 4,096-token / 192 KiB / 30-minute bound
    ([MVP_PRIVATE_AGENT_EXECUTION_V1.md:42-43](plans/MVP_PRIVATE_AGENT_EXECUTION_V1.md)).
- **Consequence.** Restarting learning needs one explicit, owner-approved supersession.

## Corrections to existing summaries

| Existing statement | Correction |
| --- | --- |
| Handoff: two accepted desktop examples. | True for the desktop. The general-task path has three accepted outputs in total; the third is a CLI invoice audit accepted under a checker rewritten after the candidate was seen (BL-20260913-1737). |
| Coding "A/A noise" of one task. | No A/A measurement exists. The byte-identical D and H arms had identical outcomes (10/12, the same two rejects). |
| Historical "medium" thinking runs. | Effort was sent top-level, not through `chat_template_kwargs`, so these runs may have used the server-default effort. |
| Cloud reference `gpt-5.6-sol` at USD 4/20 and Luna at 0.10/0.50. | `gpt-6-sol` 2/10 is current; 0.10/0.50 is `gpt-6-luna`; `gpt-5.6-luna` is 0.20/1.20. |
| This review (W11): Flash-Next "cannot run on the owner's device". | It can on a 128 GB Thor through a community NVFP4/FP8 hybrid build (not vendor-supported). Device memory is still unconfirmed (corrected 2026-09-29). |
| Local "300 s timeouts" and "300 s check" failures as unexplained. | CI runs the whole suite in about 75 s. The local stalls are consistent with evicted iCloud files and should be treated as environmental until measured off iCloud. |

## Decisions only the owner can make

Each is detailed in the [plan's owner decisions](PLAN.md#5-owner-decisions):

- which real jobs the owner wants to hand off, and which data must never leave the
  owner's hardware;
- acceptable wait per job;
- the local and cloud spending envelope;
- whether zero-fee local and public-GET failures may be retried;
- the Tier-O box checklist, including confirming the device;
- whether coding stays in scope;
- family priority, including whether websites stay a first-class family;
- governance supersession;
- time for verdicts;
- permission for public pushes;
- server changes on the box;
- why work stopped for 14 days (answered 2026-09-29: travel abroad).

## Method and limits

**Stage 1: nine read-only review lanes.** Each lane's findings were then re-checked
by an independent verifier that tried to refute them against primary sources.

1. Goal and plan.
2. Coding and hybrid evidence.
3. General-task evidence.
4. General-task code.
5. Engineering health and CI.
6. Process and governance.
7. Product landscape (web).
8. Technical landscape (web).
9. User journey.

Across all lanes the verifiers confirmed 113 of 207 checked items outright and
corrected most of the rest. Only corrected versions appear here.

**Stage 2: plan panel.** Three independent plan drafts (owner-value-first,
decisive-evidence-first, simplify-and-reuse) were scored by two adversarial critics
(goal attainment and fail-fast; evidence correctness and hidden blockers). The
orchestrator then spot-checked the load-bearing facts:

- the BUILD_LOG size against the `search_text` cap;
- the default renderer surface;
- the cap layers and the ledger pricing code;
- the image capability binding;
- OpenAI's pricing page;
- the vLLM Qwen3.8-27B recipe;
- the RMinte site.

**Limits.**

- No test, build, app, Docker or model run occurred. Historical results were not
  re-executed, and code findings are static reads.
- Web facts are as of 2026-09-28. Some vendor numbers are self-reported.
- The device identity is an inference from the served alias.
- The review did not read every file of the repository or every build-log entry.
  Coverage was targeted by lane.
