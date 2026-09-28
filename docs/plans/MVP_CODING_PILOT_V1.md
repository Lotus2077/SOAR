# SOAR MVP: usable coding app, short experiments, explicit iteration

Status: **Coding MVP implemented; mechanics, recovery and real cloud execution
verified; the 36-episode comparison is complete with a negative hybrid result.**
Review-acceptable patches were C11/12, D10/12 and H10/12; owner acceptance remains
unmeasured. The separately implemented partial-handoff v2 has no live quality or
cost result. This follows the owner's instruction to build and iterate on
2026-09-08; it is not a release or hybrid savings claim. The initial USD 300
envelope is the maximum for this approved pilot; the optional USD 150 extension
remains unapproved. See the [screen report](../MVP_HYBRID_SCREEN_REPORT.md) and
[preserved earlier pilot](../MVP_CODING_PILOT_REPORT.md). New dispatch still needs
concrete configured destinations, credentials, public snapshots, and normal
request/episode admission within its recorded scope.
Reviewed against clean source revision
`6a32777fb2efcb4b1f24e5d5163f8d3235d84abb` on 2026-09-08 (Asia/Shanghai).

## 1. The decision

Build an app that completes a small repository fix and gives its user a patch,
test evidence, cost, and a clear accept/reject decision. Keep the existing
Electron application. Borrow a coding execution engine. Add one bounded local
investigation policy, measure whether it helps, and change or remove that
policy when the evidence disappoints.

The first user is the owner, followed by up to two engineers working on public
Python repositories. The first tasks are bounded bug fixes or small behavior
changes that a human could plausibly complete in 20–60 minutes. These are
scope assumptions to test with real tasks, not a measured customer segment.

The planning timebox is **15 working days**: a real app-triggered patch by day
5, an instrumented comparison by day 10, and one decision by day 15. This is a
limit on investment, not a guarantee that an arbitrary coding agent can ship
in three weeks. Start with the authorized implementation kickoff; environment
setup counts against the timebox. An unavailable prerequisite can stop the
clocked effort, but must be reported as a blocker rather than silently moving
the deadline.

The deliverable is an **internal MVP used through the app**. General research,
arbitrary repositories, automatic deployment, subscription-account gateways,
and a publicly distributed installer are later decisions. A command-line test
entry must call the same controller as the app; it is not a substitute MVP.

## 2. What the code review changes

The external redesign was reviewed as advice, not as instructions or approval.
Its demand for real tasks, tuned static controls, cache accounting, and short
investment gates is retained. Its blanket bans on handoff formats, universal
1,000-label prerequisite, all-or-nothing reuse judgment, and broad scientific
kill claims are not adopted.

| Current source | What is real | MVP action |
| --- | --- | --- |
| `src/main/bootstrap.ts`, `src/preload/index.ts`, `src/renderer/src/App.tsx` | Sandboxed desktop shell, selected workspace, task UI, typed commands | Reuse the shell and interaction patterns; add a coding task view. |
| `src/main/agent/run-session.ts` | Real local investigation and v2 local review; v2 dispatch rejects other tracks | Preserve existing behavior. Add an independent coding-run controller. |
| `src/main/agent/run-local-change-review.ts` | Actual configured-provider evidence acquisition and synthesis | Preserve. The deprecated fake coordinator does not describe all v2 execution. |
| `src/main/tools/tool-registry.ts`, workspace policy | Bounded read-only tools; no general edit/shell/browser runtime | Reuse source/path checks where interfaces fit; borrow the solver loop. |
| `src/main/providers/openai-compatible.ts` | Streaming/cancellation/usage support, but registry-bound tools and hard-coded `reasoning_effort: none` | Reuse lessons and utilities, not an unchanged coding adapter. Record generation settings explicitly. |
| `src/main/providers/runtime-catalog.ts` | One actual Local provider; cloud candidates are metadata | Real cloud execution is new scope. Do not relabel simulation as a cloud baseline. |
| `src/shared/session-events.ts`, `src/main/event-store.ts`, `src/main/recovery.ts` | v2 limits and recovery tailored to one paid attempt and bounded review | Keep old contracts readable. Do not create fake child sessions to evade their limits. |
| `src/main/database.ts`, `src/main/budget-ledger.ts` | Migrations, transaction patterns, cached-input accounting, conservative exposure; one reservation per session | Reuse infrastructure and arithmetic; introduce coding-specific per-request records and cache-write accounting. |
| `src/main/cloud-egress-policy.ts` | Tool-free review admission with consent and source provenance | Retain those principles; implement a public-snapshot coding policy rather than reducing admission to secret regexes. |
| `src/benchmark/{catalog,fixture-cache,workspace,evaluators,results}.ts` | Pinned fixtures, agent/oracle separation, clean workspaces, scoring and artifact hashes | Reuse compatible utilities. They score submissions; they do not already generate patches. |
| `src/benchmark/preflight.ts`, `evaluators.ts` | Official coding path is SWE-bench Verified and requires Linux/x64 | Keep official results separate. Add an explicitly named internal pilot adapter for current tasks. |
| `src/benchmark/process.ts` | Bounded capture and timeout, inherited environment by default, direct-child termination | Do not expose it as a sandbox. Prove environment isolation and container/process cleanup separately. |
| PR6R, simulation, native credential activation | Useful narrow contracts, no coding-quality or cost proof | Propose deferring further expansion during this pilot; preserve code and history. No deletion prerequisite. |

The owner's implementation approval supersedes PR6R-A3 as the immediate work
sequence. It does not erase PR6R evidence or activate that path's closed
provider/credential gates. Current production readiness remains unchanged until
the coding slice has been implemented and its specific evidence recorded.

Environment finding during review: a Node 22.22.2 runtime is available, but the
installed TypeScript entry file is marked macOS `dataless`. A typecheck stalled
on file access and was interrupted. The readiness validator also stalled and
was interrupted; its exact blocking file was not established. Neither check
passed in this review. Restore dependency/source availability and run the
supported toolchain at kickoff; do not treat installed directory names as a
working environment or reuse historical CI as a current local result.

## 3. The user workflow and acceptance criteria

1. Select an admitted public repository snapshot and describe one fix. The app
   displays the base revision, allowed source scope, execution limits, model
   destinations, and cost ceiling before Start.
2. Start either **Cloud** or **Local investigation + Cloud**. The latter stays
   labelled experimental until its value is measured. There is no automatic
   quality claim attached to a profile name.
3. See meaningful step updates, current phase/model, elapsed time, actual known
   spend and unresolved exposure. Cancel remains available.
4. Receive a patch preview and host-run visible-check results. Model submission,
   visible checks passed, and independent task acceptance are distinct states.
5. Export the patch with its base revision. Record keep/reject and the user's
   reason; keeping a patch does not mean the app applied it. The first pilot
   never writes the result into the original checkout. In-app Apply is P1.

P0 acceptance criteria:

- Two deterministic fixtures exercise successful and failing checks through the
  actual app/controller path, with a real patch artifact. These prove mechanics
  only; scripted model output is visibly identified in test evidence.
- A live task produces a nonempty patch through the same path, and independent
  acceptance confirms the requested behavior. An empty task or empty diff is
  not the live MVP demonstration.
- The source checkout remains unchanged during solving. The execution container
  has no home-directory mount, SSH agent, provider key, host PID namespace, or
  Docker socket. Runtime network is disabled; dependencies are prepared first.
- Cancel/timeout stops admission, terminates the worker and its container, and
  preserves any patch. If cleanup cannot be confirmed, show that failure and
  block another run; do not falsely show Stopped.
- Restart restores the last durable task state, marks unfinished work
  interrupted, and performs no automatic provider retry or patch application.
- Every attempted provider request has a durable disposition and accounting
  outcome. Malformed output and failed tasks still incur their actual cost.
- A reviewer can inspect the diff, the commands actually run, test results,
  missing checks, and the selected model without reading developer telemetry.

P1 after a working pilot: safe in-app Apply, convenient dependency setup,
richer diff interaction, and a packaged worker. Apply requires path/type checks,
concurrent-edit protection and atomic failure handling; a base-revision check
alone is insufficient. Defer automatic cross-model restart, parallel workers,
learned routing, browser research, private-repository onboarding, persistent
credential entry, and broad framework migration. Each extra capability must
replace work in this timebox or wait for the next iteration.

## 4. One owner for each execution boundary

```text
SOAR app
  -> validated coding-run IPC
  -> main controller + canonical SQLite coding-run store
       -> request admission, budget, lifecycle, artifact acceptance
       <-> private framed messages with a trusted Python worker
             -> pinned mini-swe-agent model/action loop
             -> admitted provider transport (cloud or dedicated GPU endpoint)
             -> disposable task container, with no provider credentials
  -> host-visible checks and patch preview
  -> independent hidden evaluator only after the run is terminal
```

“Host-run” means host-controlled, not execution on the unconfined desktop.
Every repository-controlled setup command, visible check, reference test and
hidden evaluation runs in a separately identified, credential-free sandbox.
The trusted provider worker never executes project commands locally. Reused
evaluation utilities receive an explicit environment allowlist and isolated
execution adapter; their inherited-environment defaults are not acceptable.

**Borrow first.** The initial candidate is `mini-swe-agent` 2.4.6, with a pinned
artifact and complete dependency lock. Current source provides `DefaultAgent`,
`LitellmTextbasedModel`, a text-action prompt, and `DockerEnvironment`. Wrap its
library classes instead of scraping an interactive CLI. The first UI promises
step updates, not token streaming. Validate the actual pinned artifact: current
`main` and a published version with the same number can differ.

LiteLLM's existing Anthropic path can carry cache controls. Do not write a new
cloud client merely because its Python interface looks OpenAI-compatible. The
gate is the actual request and usage receipt, including cache reads/writes,
reasoning-token semantics, price version, and explicit retry configuration.

**Main is the authority.** Add a small `patch-run-v1` schema, append-only event
records, per-request exposure, and derived task projections through the current
migration system. Do not widen v2 or dual-write reservations into its ledger.
Worker trajectories are diagnostic artifacts, not a second source of task
status. Use one coding run and at most one in-flight model request initially.

**The worker is trusted code; model-generated actions are not.** The worker's
model wrapper must prepare the request, obtain a main-process admission ACK,
then make exactly that request. Main binds the run, phase, request identity,
model, allowed source, output ceiling, and reservation before acknowledging.
The frozen adapter must demonstrate that no post-admission transform widens the
request or changes the provider. If this cannot be established by the bridge
spike, replace only the model adapter or stop the spike; do not waive admission.

For the internal pilot, propose operator-provisioned, session-lived credentials
in the trusted transport process. They must never enter model arguments,
serialized configuration, renderer messages, trajectories, or the task
container. Isolate mini's global configuration so it cannot auto-load unrelated
`.env` settings. This is a new explicit pilot credential mode; it neither
activates nor bypasses the existing locked Keychain feature. Persistent custody
and distribution remain later product work.

The first source admission policy allows only explicitly admitted public
snapshots and user task text, with bounded tool observations derived from that
snapshot/container. It excludes checkout credentials, untracked local files,
git history/remotes, and unrelated host content. Apply secret detection as an
additional check, not as the definition of confidentiality. “Local” describes
the configured inference destination; it is not an automatic privacy or
zero-infrastructure-cost guarantee.

**Do not trust library defaults.** Stock mini cost limits are retrospective,
retries can multiply attempts, and Docker cleanup is not a sufficient lifecycle
guarantee. Set one outer attempt and disable inner SDK retries. Before each
request, reserve a conservative upper bound using pinned provider prices,
bounded input and output, and conservative cache-write assumptions. Unknown
usage retains the reservation; a confirmed unsent request releases it. Main
must stop admission on exhausted caps or unknown pricing. A provider/account
spend cap is a backstop, not a replacement for local admission. Cancellation
can stop future calls; it cannot promise that a sent request will not be billed.

Track the worker and container with ownership identifiers; remove only this
run's resources on cancellation/recovery. A worker whose parent or control
channel disappears cannot continue dispatching. Keep temporary app artifacts
local and ignored. Reuse the existing packaged app's guardrails and verify the
new opt-in coding path explicitly; do not import the fixture-only PR6R runtime
or weaken its tests to get this feature through.

Local Docker is enough for an initial app smoke if it is available. The GPU
server supplies inference, not implicit authority to execute repository code.
Use native Linux/x64 for the existing official evaluator. An unavailable x64
host leaves that benchmark blocked; it need not prevent an honestly labelled
internal test on a compatible pinned container. Do not add remote orchestration
infrastructure as an invisible prerequisite to the first app task.

## 5. The exact first hybrid policy

The pilot tests **local investigation followed by the same cloud solver**. It
does not claim to validate cloud-planner/local-worker delegation or arbitrary
mid-session model switching.

- The host prepares a bounded inventory and task-visible test command list.
- In hybrid mode, a fresh local phase gets the task and the admitted snapshot.
  Limit it initially to eight actions, five minutes, and a 4 KiB evidence brief;
  record these as tunable pilot settings. Enforce a read-only source mount and
  bounded scratch area, rather than trusting a “read only” prompt.
- The brief contains located files and source excerpts. The host checks paths,
  revision/line references and quoted text. Unverified root-cause hypotheses
  remain attributed hypotheses. Do not ship a claim that these checks verify
  the diagnosis. Reproduction-script generation is outside this first policy.
- The cloud solver starts fresh with the task, the same host preparation, and
  the surviving local evidence. It edits/tests/repairs within one continuous
  model loop and one total episode budget. Its prefix stays stable between
  ordinary steps. Avoid per-round full packet replacement.
- A failed local phase falls back once to the same prepared cloud start, with
  its lost time/compute recorded. User cancellation never triggers fallback.
  All arms share the same total wall-clock and resource ceilings; hybrid does
  not get free extra time or an extra full solver budget.
- Submission ends the policy. Hidden tests cannot trigger another attempt.

This scope produces real patches while testing one plausible local contribution.
If it fails, the next experiment is chosen from its failure mechanism; a more
complex router is not the automatic response.

## 6. Delivery and stop rules

| Timebox | Concrete output | Evidence needed to continue | If it fails |
| --- | --- | --- | --- |
| Days 1–2 | App/controller-to-worker vertical slice, two scripted fixtures, pinned container and request adapter | A patch reaches the app; visible test pass/fail is real; cancel, isolated environment, bounded output, admission and recovery work | One day maximum on a specific adapter/environment alternative. No new harness project. |
| Days 3–5 | First useful live app patch; three development tasks for model/effort calibration | Nonempty accepted patch, all request costs attributable, actual caching measured where supported | Freeze feature expansion. Repair one named blocker or narrow task scope. Report no usable MVP if still unsuccessful. |
| Days 6–10 | Bounded local phase and a frozen 12-task comparison | Complete paired task blocks, independent outcomes, local contribution separated from host preparation | Diagnose protocol, model, information, latency or economics failure. Choose at most one substantive change. |
| Days 11–15 | Eight new comparison tasks if warranted, owner use on real tasks, one decision | The useful behavior or promising direction repeats, and patches are reviewable/useful in the app | Retire the local policy, narrow the task class, or stop this MVP slice. Preserve the evidence and working baseline. |

The day-2 slice may use scripted provider output; the day-5 milestone must not.
The first useful patch is a development demonstration, not an unbiased solve
rate. Broader tests cannot be added merely to postpone the product demonstration.

Implementation slices, each independently reviewable:

1. Coding-run contract/store, worker supervisor, script-driven app patch flow,
   isolation/cancel/recovery tests. Existing user flows remain readable.
2. Admitted real transport, normalized usage/cache prices, controller-driven
   cloud solve, patch verification/preview/export, real app proof.
3. Bounded local phase, host-only control, shared-runner experiment entry and
   failure report. Exact policy/configuration recorded per run.
4. One evidence-driven change and a fresh comparison; user-facing fixes only
   where observed use requires them.

Run affected tests as slices land. Before the internal MVP handoff, run the
repository's unmodified `pnpm check` under Node 22.22.2, the changed Electron
flows, and live proofs on the exact candidate revision. Packaging proof applies
if an app bundle is actually delivered. Green tests establish contracts, not
task quality; fake-provider tests do not satisfy live milestones.

## 7. Learn from a small experiment without overstating it

Execution update, 2026-09-08: the owner's active goal now explicitly requests the
actual hybrid result. Preserve the unsuccessful development calibrations and
proceed with the frozen twelve-task C/D/H screen under the recorded authority,
rather than requiring more cloud-only trials first. Use the same $3, 600-second,
forty-solver-step limits in all arms and reserve $9 before each block. The exact
tasks, independent agent-authored acceptance, reference proofs and balanced order
are frozen before model outcomes. This internal screen does not claim the
separate human curation or owner-use evidence described below. See the
[comparison entry](../MVP_COMPARISON_SCREEN.md) and build log.

Use three development tasks, excluded from the screen, to choose a reasonable
static cloud configuration from one strong model, one cheaper model, and a
lower-effort setting where supported. Pin actual model IDs, endpoint locality,
pricing, effort, context/output limits, engine/precision, hardware and software
versions before collecting comparison results. This small calibration does
not establish the globally cheapest sufficient model.

Freeze 12 previously unused tasks before running the policies. Prefer real
bounded maintenance tasks on public repositories, spread across at least three
repositories where feasible. A human freezes acceptance cases independently of
the solver. Confirm setup and tests against a reference before exposure; do not
feed reference patches, hidden tests, future commits, or hint text to the agent.
Existing SWE-bench Verified cases can prove plumbing, but are separately
labelled and cannot become a claim about fresh-issue performance.

| Arm | Execution | Question |
| --- | --- | --- |
| C | Calibrated cloud solver with task and normal repository access | Does the app produce useful patches without preparation? |
| D | Same solver plus deterministic host inventory/test-location brief | Does preparation alone help? |
| H | Same D setup plus bounded local investigation | Does the local model add value beyond preparation? |

One trial per task/arm initially: 36 episodes. Keep tools, visible acceptance,
solver configuration, base revision and total caps fixed. Randomize policy
order inside task blocks; admit a block only when sufficient campaign capacity
remains. Report incomplete blocks, their costs and why they stopped; do not
interpret unrun arms. Repeat a predeclared balanced subset only if variance
prevents choosing the next action, using the optional next tranche.

The runtime verifier sees ordinary project tests and visible task requirements.
The independent evaluator receives the final immutable patch after the policy
ends. It runs hidden acceptance tests in a separate clean environment, with
baseline integrity checked. “Visible checks passed, independent acceptance
failed” is a false-accept observation; it does not retroactively authorize a
cloud retry. Benchmark code invokes the same app controller, not a separate
unattributed harness, and links outcomes to run, configuration and patch hashes.

Report raw task-level wins/losses, independent solved count, all-assigned useful
patch yield, total API spend, cost per independently solved task, local service
time/cost, median and maximum latency, user interventions, and false accepts.
Keep infra-invalid and genuine model failures separate, while charging both to
the product's cost and delivered-yield denominator. Zero solves means cost per
solve is unavailable/infinite, not zero. No majority-of-three statistic, model
judge of coding correctness, or unstable small-sample p95 is needed.

Show local economics both as incremental expense on the existing machine and
as fully allocated cost at measured/credible utilization; add rental sensitivity
when relevant. Price scout and driver durations separately. A favorable assumed
utilization cannot establish savings. Record development effort separately from
the provider/worker cap.

At 12 tasks, no quality degradation is accepted as statistically demonstrated
parity. H must first be undominated by both C and D on observed independent
solved count and fully accounted cost per solve: a cheaper, more successful C
blocks advancement even if H beats D. The local contribution is promising if H
also has no observed loss in solved count versus D and roughly 20% lower fully
accounted cost per solve, or solves additional useful tasks at comparable cost
and acceptable latency. These are **investment heuristics**, not statistical
certification or permission to advertise savings. Choose the next comparison's
control from the actual C/D frontier, not automatically from D.
Inspect every discordant task. A quality regression cannot be hidden inside a
better cost ratio. A wide interval remains inconclusive; lack of a winner is
not proof that no hybrid policy can work.

If worth another tranche, change one substantive variable, freeze again, and
compare against the best relevant control on eight new tasks. Do not pool
changed configurations or claim that repeatedly testing the same tasks is a
fresh confirmation. A later public quality/cost claim needs a separately sized
held-out evaluation, based on a user-acceptable quality floor and observed
variance rather than a margin chosen to fit the sample.

## 8. Decisions after use, not after infrastructure milestones

| Observation | Next decision |
| --- | --- |
| Cloud cannot solve the scoped tasks | Check fixture/runner/settings; try one stronger configuration or narrower task class. Routing is not yet the bottleneck. |
| D helps and H does not | Keep deterministic preparation; remove local scouting from the default. |
| H adds correct evidence but saves no downstream work | Inspect whether cloud redoes it; change brief consumption once, then retire this policy if the result repeats. |
| H misleads the solver or exceeds latency tolerance | Tighten evidence scope or remove the local phase; do not purchase a bigger routing framework. |
| Local protocol/engine fails | One bounded compatibility repair. Keep the useful cloud app and record local unavailable; do not call this a model-quality result. |
| Patches are correct but users reject the workflow | Fix the observed review/apply/trust obstacle or stop the product slice. A good benchmark is insufficient. |
| Useful patches and a promising hybrid direction repeat on new tasks | Continue this exact policy; investigate the next largest measured failure/cost source. |
| No useful user outcome after the timebox and one repair | Stop this slice, preserve the app/evaluator/evidence, and write what failed and the next falsifiable hypothesis. |

By day 5 the owner should review a real output. During the final week, aim for
the owner plus up to two available engineers using the app on two real tasks
each. Record whether they kept/applied the patch, their corrections and review
effort, and whether they chose a second task without prompting. Start with the
owner if others are unavailable; no recruiting work blocks the MVP. Invitations
or external messages require the user's authorization.

The minimum user evidence to continue is one independently accepted useful
patch and voluntary repeat use by the owner. It supports another iteration,
not product-market fit. Extra users strengthen the evidence without becoming
a fabricated statistical sample.

## 9. Proposed spend and remaining decisions

The owner's instruction to build the presented MVP adopts the initial
**USD 300** all-in ceiling, including failed requests, worker/evaluator
infrastructure and controlled reruns. This ceiling does not itself admit a
provider request; the exact configured pilot scope and pre-dispatch limits must
be recorded first. No unused allowance transfers automatically:

| Allocation | Ceiling |
| --- | ---: |
| Two smoke runs, three-task static calibration, bounded compatibility probes | USD 70 |
| Twelve-task screen: 36 episodes at at most USD 5 each | USD 180 |
| Worker/evaluator infrastructure | USD 50 |
| Initial total | **USD 300** |

An optional **USD 150** fresh-iteration/user-use tranche is a separate decision;
it is not available automatically. The overall proposed maximum is USD 450 if
both tranches are explicitly authorized. Within that optional tranche, eight
tasks across two arms at the same USD 5 cap reserve USD 80, up to six user
episodes reserve USD 30, and USD 40 remains for infrastructure/probes or a
predeclared balanced repeat. These are exposure ceilings, not
price forecasts. Scout and solver share an episode cap; account for any paid
local endpoint too. Retain a conservative campaign stop below the hard cap to
cover unknown exposure. If the measured task mix cannot fit, run fewer complete
blocks or return a revised scoped proposal; do not silently increase limits.

The owner has adopted implementation of this scope and deferred the previous
A3 sequence. Before live work, record a single scoped
pilot authority covering exact admitted repositories, provider credentials and
destinations, local-machine classification, request/episode/campaign caps,
container execution and artifact handling. Existing PR6R approval does not
cover these new actions. Do not require a new permission conversation for each
routine step inside a subsequently approved scope.

Engineering resolves within the first two days: pinned harness hooks and
dependencies, actual GPU model/engine, Python and Docker availability, a
compatible evaluator host, request/usage normalization, and two public task
fixtures. Unknowns remain unknown until checked. No hardware model, endpoint,
provider price, or native signing readiness is inferred from the redesign.

## 10. Evidence references

The source review covered the app/IPC/bootstrap path, current agent dispatch,
provider construction and request settings, event/migration/recovery contracts,
budget/egress boundaries, fixture/evaluator utilities, package guardrails and
the append-only build log. This was a targeted code review, not a claim that
every line or dependency has been audited.

Primary harness sources inspected for the plan (implementation must verify the
pinned artifact rather than depend on mutable `main`):

- [mini-swe-agent release and license](https://pypi.org/project/mini-swe-agent/)
- [Agent library hooks](https://github.com/SWE-agent/mini-swe-agent/blob/main/src/minisweagent/agents/default.py)
- [Text-action model](https://github.com/SWE-agent/mini-swe-agent/blob/main/src/minisweagent/models/litellm_textbased_model.py)
- [Provider/cache adapter](https://github.com/SWE-agent/mini-swe-agent/blob/main/src/minisweagent/models/litellm_model.py)
- [Docker environment and cleanup](https://github.com/SWE-agent/mini-swe-agent/blob/main/src/minisweagent/environments/docker.py)
- [Official evaluation limitations](https://mini-swe-agent.com/latest/usage/swebench/)

Research constrains hypotheses rather than selecting an architecture by fiat:
[direction-dependent handoffs](https://arxiv.org/html/2608.24358),
[scouting and its controls](https://arxiv.org/html/2608.04804), and
[cold-start task routing](https://arxiv.org/html/2607.22465v2).

## 11. Executed screen and fail-fast decision — 2026-09-08

The approved 12-task / 36-episode screen is complete. Review-acceptable counts
are C11, D10 and H10; all twelve local phases fell back. H cost 4.93% more than
D and forwarded zero source bytes. The original policy does not advance.
See the [complete report](../MVP_HYBRID_SCREEN_REPORT.md), which retains five
review-discovered false accepts and all prior development exposure.

Keep the cloud patch workflow usable; owner acceptance and repeat use remain
unmeasured. One bounded implementation repair now permits existing source
excerpts at the scout step cap and improves failure diagnostics. It is v2,
separate from the frozen original screen, with no live cost/quality claim.
No extra paid trial or optional USD 150 extension was started. A future hybrid
experiment must first specify fresh tasks and a new freeze within explicit
scope; a negative result is not permission for repeated automatic trials.
