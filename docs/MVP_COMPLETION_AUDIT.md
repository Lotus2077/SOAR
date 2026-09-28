# First MVP completion audit

The [September 28 handoff](HANDOFF.md) provides the current operational entrypoint
and a fresh read-only evidence check. The substantive product results and course
assessment below remain the September 14 evidence cut.

## Current course audit — September 14, 2026

**Verdict: the architecture remains useful, but the work sequence has drifted
from a fail-fast MVP toward repeated infrastructure qualification.** The current
product is a public/synthetic general-agent prototype. It is not yet an
owner-ready general agent or the promised privacy-first MVP.

This assessment supersedes the current-state claims and next-step ordering in
the older audit and follow-ups below. Those remain as history. In particular,
public retrieval, editable-deck delivery, optional consultation and bundle export
now exist; useful output quality and ordinary usability remain incomplete.

The original objective is unchanged: delegate general end-to-end work, initially
optimize research, file auditing, websites and editable slides, and learn quickly
from accepted or rejected deliverables. Privacy >= quality > savings > latency.
The four examples are a coverage roadmap, not four independent certification
programs or a closed list of supported tasks.

| Area | What the retained evidence establishes | What it does not establish |
| --- | --- | --- |
| File audit | One accepted synthetic desktop support report; six settled calls, exact export and independent source checks. | Mixed-document auditing or general reliability. |
| Editable slides | One accepted three-slide PPTX; source checks, all rendered slides reviewed and native table/chart/workbook editing exercised. | Microsoft PowerPoint compatibility or general presentation quality. |
| Research | Desktop retrieval and report export work; the first report was rejected for substantive correctness/coverage issues. | An accepted research report or open-ended source discovery. |
| Website | No accepted website. Earlier evaluated website/draft each passed only 15/30 checks. Latest task retained a draft but did not export it. | Correct arithmetic/interactions or reliable end-to-end website delivery. |
| Bundles | Output inventory and ZIP export implemented; 132 host checks and build recorded as passing. | Renderer assertions or actual desktop bundle interaction; both remain unverified. |
| Routing and privacy | Local execution, exact-packet consultation permissions, isolation, recovery and refusal mechanisms have enumerated proofs. | Useful real general-task cloud consultation, savings, or qualification of real-private data on the actual inference deployment. |

This audit reread the active code, reports and retained evidence. A separate
reviewer rehashed 43 important artifacts/receipts, including actual report/deck
exports and their acceptance records; all matched. The ten current bundle source
bindings also match their verification receipt. No inference, application run or
new test run was performed. Historical pass counts are not freshly rerun tests.
The original critique attachment is absent at its referenced location; this audit
uses the user's stated goal and current code rather than inventing its contents.

What is still on track: one reusable job loop; tools isolated from credentials;
explicit outbound permission; saved work; accurate distinction between submitted
and accepted; source-based review that catches plausible wrong answers. Keep
these components and their failure evidence. Legacy coding policies do not prove
the corresponding capability in the general-task path.

Where the sequence drifted:

- The [desktop check](../src/main/general-tasks/controller.ts) still checks input
  preservation and a nonempty primary output. Arithmetic, claim support and
  website behavior are judged by separate operator-run evaluators. The product
  does not yet close the requirement -> check -> useful feedback -> repair loop.
  Its honest not_evaluated label is good reporting, but not task correctness.
- Website failures repeatedly led to another wrapper/protocol/qualification
  milestone. Some fixes addressed actual bugs, but they have not established
  the useful local-plus-cloud route that motivates SOAR. The
  [current coordinator profile](../src/main/general-tasks/controller.ts) also
  fixes thinking disabled and at most 4096 output tokens. Results apply to that
  configuration; they do not isolate the owner's model capability or prove that
  the settings caused failure.
- Bundles solve a real composition problem but were not the main blocker in the
  single-HTML website failures. The previous recommendation over-prioritized
  that feature. Keep it; freeze further bundle features/polish after one normal
  desktop verification. A ZIP alone does not validate the files inside it.
- Research currently permits a few exact user-supplied URLs, not autonomous
  discovery/follow-up. The runner exposes only a prefix of each retained public
  source, and the execution-observation reader cannot read those source tails.
  This is a capability gap, not a proved cause of the rejected report. A scoped
  reader for already admitted bytes is a smaller fix than a new research agent.
  Consultation requires a separate session profile without
  a settings screen. These are ordinary product constraints, not model failures.
  The [source schema](../src/shared/general-task-contracts.ts) and
  [consultant setup](MVP_GENERAL_CONSULTANT_SETUP.md) make these limits explicit.
- Work is spread across many plans, bespoke ignored trial adapters and a large
  uncommitted change set. Use this consolidated audit for current priority;
  preserve historical logs without treating every old Next gate as active work.

The revised next milestone is **one owner-usable workflow with a checked output
and an observable permitted route**, rather than another routing or export
framework. Proposed order:

1. Close only the demonstrated operational defect: page/window observation must
   not be mistaken for app-process exit or final task state. Diagnose the timeout
   overrun without guessing its cause. Verify the narrow lifecycle regression
   and the already implemented bundle flow; stop expanding this test work once
   those checks pass. An unresolved request remains uncertain and is not replayed.
2. Define one fresh representative task's critical requirements before running
   it through the normal app. Reuse existing tools and independent checks. Feed
   actionable check failures into bounded repair where the product supports it;
   do not invent a universal correctness judge or call file existence success.
   Require exact delivered artifacts, source-based correctness/format checks,
   visible limitations and owner review. Log manual intervention as a result.
3. If a run with working infrastructure fails those requirements, stop repeating
   the same task/model/prompt pattern. Use one materially different, permitted
   configuration or approved consultation as a bounded diagnostic, or narrow the
   claimed supported capability. Confirm tools and model settings first. A missing
   consultant profile makes the route unavailable; it does not justify endless
   local reruns. Compare useful output before discussing savings.
4. After a successful workflow, try a fresh task and the next uncovered capability
   using that same path. Source discovery and practical setup then address real
   user blockers. Keep real-private deployment/transport/storage and retention
   work explicit. A public-data pilot does not silently complete the privacy-first
   objective. No broad policy benchmark, new filter comparison or unrelated
   feature precedes this delivery decision.

Stop rules: no new feature unless it removes an observed user blocker or tests a
specific product hypothesis; no unchanged rerun after a substantive failure; no
live trial while execution ownership is unresolved; no promotion of mechanics,
test totals or external manual repair to accepted autonomous delivery. Use one
reusable bounded operator/evidence format and narrowly relevant checks while
preserving actual permission, fee, checkpoint and no-replay protections.

The audit itself is complete. The proposed next work is not implemented or run
by this review, and it grants no new provider, spending or private-data authority.
The overall goal remains paused as found; this review does not resume it.

## Original assessment and chronological follow-ups

Date: 2026-09-13. Status: **Assessment and recommended implementation order.**
Evidence cut: `BL-20260913-2328-desktop-general-complete` and the current source.
This audit changes no approval, execution allowance, acceptance result or release
status. It is not a new experiment or permission gate.

SOAR now has a working desktop general-agent slice, with one independently accepted
synthetic report. The first broader MVP is not complete. Its main gaps are usable
research and artifact capabilities, permission-aware routing in this general-task
flow, and qualification of the promised private-data boundary. Another agent loop
or a large coding benchmark would not close those gaps.

The owner's ordering remains **privacy >= quality > savings > latency**. Research,
file auditing, website building and PowerPoint creation are initial targets for
the same general agent, not four exclusive task types. Coding remains a tool.
The unit of success is a useful deliverable within the user's permissions.

## Evidence boundary and the redesign critique

The referenced `soarredesign.md` attachment was unavailable at its original
location during this audit; no retained copy was located in the bounded search.
Consequently this document does not claim a new line-by-line review of that text
or attribute recommendations to its author. An attachment is critique data, not
authority to change the owner's goal, privacy rules or experiment limits.

The current [privacy-first design](plans/MVP_PRIVACY_FIRST_AGENT_V1.md),
[execution plan](plans/MVP_PRIVATE_AGENT_EXECUTION_V1.md),
[readiness](MVP_READINESS.md) and [build log](BUILD_LOG.md) are the requirements
and evidence used here. The earlier cloud-versus-Automatic comparison is
superseded and undispatched. Its spending proposal and savings/relative-latency
thresholds do not become requirements for this milestone.

A useful redesign must address observed failure mechanisms. The project has
already demonstrated plausible reports with wrong calculations, a model verifier
that calculated a contradiction but still gave an overall pass, and complete
tool calls that failed before writing. These justify incremental execution,
source-based calculations and independent artifact checks. They do not justify
assuming that a cloud planner, a self-reported critique, more tests of a wrapper,
or a routing label guarantees a useful result. The subsequent accepted reports
are progress without erasing those failures.

## Minimum user-facing requirements

| Requirement | Evidence needed for the first MVP | Current evidence and remaining gap |
| --- | --- | --- |
| Delegate a goal and receive usable work | Native input selection, dependent tool use, a final artifact, preview/export and a result accepted against the original goal. | **Verified for one bounded report.** The actual desktop support audit used six settled local calls and six tools, with exact input/export identity and independent acceptance. This is a real product slice, not general reliability. |
| Preserve work and stop safely | Pause/restart/resume retains context, counters and deadlines; cancellation and uncertain outcomes cannot replay actions; execution is cleaned up. | **Verified in the enumerated paths.** Two actual Electron/HTTP/Docker scenarios pass, including inert HTML, restart and cancellation. Reuse this implementation. Keep the earlier setup and audit-reader failures. |
| Understand where data goes | Show the admitted inference destination and distinguish offline tools, public retrieval and cloud disclosure. Private data stays within a verified boundary; grants bind actual outbound context. | **Partial.** The broker and isolated contexts have synthetic bypass/revocation/recovery evidence. Desktop admits only public/synthetic goals and files and sends context to its configured model server. Server trust, encrypted remote transport, forwarding/logging and real-private operation remain unverified. Ownership and zero API price are insufficient. |
| Obtain and use public evidence | A separately permitted public brief drives brokered retrieval; source bytes/URLs are retained; the final report supports material claims and reconciles conflicts. Private-derived queries require their own permitted packet. | **Not complete in the desktop.** Live host fetch and model consumption are demonstrated separately. The desktop constructs only a local phase and exposes no fetch capability. Earlier research submissions failed independent quality checks. Connect the existing broker/session path, then assess a complete report. |
| Audit admitted files accurately | Inventory all admitted files; preserve originals; identify unreadable/excluded inputs; trace findings to records and independently recompute required arithmetic. | **Narrow evidence only.** Synthetic CSV/text invoice and support reports have accepted results. The desktop checker tests preserved inputs and a nonempty output, not factual completeness. PDF/Office ingestion and mixed-file audits still need artifact-level evidence. |
| Build a working website | Deliver source/assets together; verify interactions, keyboard access, responsive views and local screenshots in the isolated browser. | **Tooling ready, product proof missing.** The qualified artifact image contains Chromium/Playwright. No accepted website from the general desktop flow is recorded. Its one named artifact also needs a usable way to deliver a site with multiple files, such as a checked source archive plus local preview. Inert HTML preview is a security check, not website functionality. |
| Create an editable presentation | Deliver a genuine PPTX; open it without repair in the declared supported viewer; render and inspect every slide, notes, charts, tables and external relationships. | **Tooling ready, product proof missing.** Office authoring/rendering tools are provisioned, but no accepted desktop deck is recorded. Binary export alone proves neither editability nor layout. LibreOffice evidence must not be described as Microsoft PowerPoint compatibility. |
| Route work within permissions | The general task records a real capability/model decision, its reason and the permitted destination/context. Local work is the default; bounded cloud help receives only authorized information. Denied or unsupported work stays incomplete. | **Missing from this flow.** Its controller uses one fixed local model; its session currently fixes private mode and zero fees. Legacy coding Automatic and local-plus-critic policies are separate and source-bearing. They cannot be attached as silent private-context fallback or counted as general-agent routing. |
| Judge the delivered result honestly | Required artifacts pass format and source checks; failed comparisons or missing critical requirements cannot become a pass. Independent semantic/visual assessment stays distinct. | **Partial.** Frozen snapshots and host verification exist; one report has separate neutral acceptance. The generic app correctly says `not_evaluated`. Add appropriate checks to the delivered artifact path; neither a nonempty file nor a model-written all-pass verdict establishes correctness. |
| Operate without developer intervention | The documented setup can launch a real task; readiness diagnoses missing model/image/tools; the user can retrieve artifacts, understand retention and remove owned task data. | **Partial.** The development app/build and owner-machine flow work. Readiness inspects configuration/image, not model connectivity. There is no general-task deletion API. Cold setup and eighteen unexecuted mocked UI assertions remain explicit gaps. Retention/deletion matters before real private work; a packaged release is separate. |

Source anchors for the gaps are the
[desktop contracts](../src/shared/general-task-contracts.ts),
[controller](../src/main/general-tasks/controller.ts),
[general session](../src/main/private-agent/session.ts) and
[outbound broker](../src/main/private-agent/broker.ts).
The [desktop report](MVP_GENERAL_TASK_DESKTOP_REPORT.md) records the actual app
proof, accepted artifact and retained failures. The
[boundary report](MVP_PRIVATE_AGENT_BOUNDARY_REPORT.md) describes the tested
isolation scope; it is not certification of the owned inference server.

## Smallest useful implementation sequence

1. **Connect research to the working app.** Reuse the current session's isolated
   public phase and brokered fetch. Let the user designate the public brief and
   permitted retrieval separately from other inputs; retain source receipts and
   display the actual destination and route. Deliver one complete source-grounded
   report through the normal preview/export flow. Verify its required numerical
   and conditional claims from the source, not from constants copied out of the
   generated report. A fetch-only proof is already available and need not replace
   this complete-task proof again.
2. **Make artifact delivery general, then exercise it.** Keep one job/runner.
   Expose the required deliverable set or a verified bundle rather than forcing
   a site and supporting sources into one text filename. Use the already installed
   parsers, browser and renderer for a website and editable deck. Add bounded
   format/interaction checks and inspect the rendered results. Extend the audit
   path to its admitted document formats. Show unsupported capabilities before
   generation where practical; do not add a controller per task family.
3. **Make permission-aware routing real.** Start with deterministic host decisions,
   not a learned router: permitted local work, an isolated public worker, and
   explicitly enabled bounded cloud consultation when needed. Preserve local
   synthesis and verification. Wire the existing exact-packet/grant ledger into
   this job path before enabling cloud help; retain route reasons, cumulative
   charges and refusal/unknown outcomes. A size limit, low budget or model request
   never grants disclosure. Prove actual selection and useful output separately;
   no savings claim follows just from exercising two routes.
4. **Close private-data and practical-use gaps in parallel.** Verify the actual
   inference deployment and transport, complete the outstanding local-filter
   qualification, and expose packet preview/permissions plus owned-data retention
   and deletion. OPF currently has incomplete confirmation and missed mandatory
   development canaries: keep it advisory, never release authority. Continue
   useful public/synthetic product work while these prerequisites remain open.
   Finish with an owner-representative task through the same app, including a
   composition of existing capabilities, and record what the owner accepted.

These are implementation priorities using the existing design and authority,
not new inference budgets or permission requests. Each runtime attempt retains
its own outcome. A discovered failure should lead to the smallest justified fix
and separately identified verification, not silent retries until the task passes.

## What closes the first MVP, and what does not

The minimum completion claim should name supported inputs, tools, destinations
and deliverables and show that the same app can produce accepted work across the
initial targets. It also needs a real permission-aware routing path and the
privacy behavior actually promised to the user. If real-private qualification
remains open, the honest deliverable is a **public/synthetic general-agent MVP**;
that limitation cannot silently stand in for the full privacy-first requirement.
One completed report is the foundation, not the endpoint.

The larger paired route experiment measures quality regressions and economics;
it is not a substitute for these missing product capabilities. Learned routing,
broad connector coverage, advanced OCR/media and statistical generalization need
not precede the smallest useful app. Signing/notarization, clean release-head CI,
distribution/update testing and wider compatibility belong to release readiness.
Existing proposed experiment stages remain recorded; this audit neither declares
them passed nor reopens their closed allowances.

Report accepted and unfinished tasks, interventions, actual permitted disclosures,
settled and uncertain API exposure, and elapsed time. Zero declared local API fees
do not make the roughly USD 3,500 machine or its operation free. Hardware payback
and quality-preserving savings need a comparable accepted-task baseline later.
Latency remains observable and bounded for operability; it does not outweigh
privacy or turn incorrect work into success.

## Follow-up: public research delivery, September 14 local date

The first implementation priority now has a verified desktop transport path:
optional files, explicit exact source URLs and DNS permission, retained source
bytes/receipts, pause/restart and exact artifact export. Four actual app scenarios
pass. The first real memo used ten local model calls and two GETs; delivery,
accounting and cleanup passed, but independent review rejected a material
requirement/recommendation contradiction and missing source distinctions.
[The research report](MVP_DESKTOP_PUBLIC_RESEARCH_REPORT.md) supersedes the earlier
source-wiring gap above; research quality remains open. No candidate repair or
retry followed evaluation. Website/deck acceptance and general routing are still
next implementation gaps, with private-data qualification separate.

## Follow-up: artifact delivery and request correction, September 14 local date

The desktop now has one independently accepted synthetic presentation, including
source-recomputed decision/table/sensitivity, native chart and workbook, original
three-page LibreOffice render, copy-based native API editing, exact export and
cleanup. The fresh website completed delivery but failed monetary conversion and
required total visibility. Its incomplete browser matrix and separate partially
captured views remain explicit. The original pre-correction website has no output
and one unknown request; no historical cause is inferred.

The hard desktop request cap was corrected to respect configuration up to 300
seconds, with fixed diagnostic metadata and unchanged task/no-replay rules. Four
actual desktop regressions pass on the new build. The
[artifact report](MVP_DESKTOP_ARTIFACT_DELIVERY_REPORT.md) supersedes the missing
presentation proof above. It does not close accepted website/research work, broad
Office ingestion, bundles, permission-aware general routing or private readiness.

The next implementation priority is the proposed exact-packet consultation path
in this existing job loop, with scripted permission/accounting/recovery proof
before any separately approved paid trial. The website also motivates retaining
and acting on check failures: repeated mismatch text cannot support acceptance
just because its process exits zero. Preserve the rejected output as a regression
example; do not substitute a hand-repaired page for model-delivery evidence.

## Follow-up: optional general consultation, September 14 local date

The existing task loop now has an optional local-coordinator consultation path.
It freezes a question and selected checkpoint text, pauses for exact priced
approval, makes one tool-free request, then replays durable advice within the
original task allowance. Decline/revoke, response uncertainty and restart preserve
authority and accounting. This closes the missing permission-aware execution
wiring identified above, with 270 focused tests and eight actual desktop scenarios
using scripted responses. The original label-related desktop failures and two
unexecuted mocked React runs remain recorded in the
[consultation report](MVP_GENERAL_TASK_CONSULTATION_REPORT.md).

The next proof is useful consultation on a real bounded task after concrete
provider/settings, current pricing and packet/fee approval. This implementation
does not prove that the local model chooses helpful consultations or that advice
repairs an artifact. Preserve and independently evaluate its before/after output;
keep exposed development failures distinct from held-out comparisons. Accepted
research/website quality, practical ingestion/composition, real-private deployment
and owner acceptance still prevent a full first-MVP completion claim.

The subsequent [real-trial preparation](MVP_GENERAL_CONSULTATION_TRIAL_PREPARATION_REPORT.md)
adds explicit standard-tier binding, durable fee recomputation and actionable
session diagnostics. Ninety-two application checks, five pure driver checks and
four current desktop scenarios pass. The real repair remains unrun: session
configuration is absent here, and two incomplete evaluator captures prevent a
full qualification claim despite a successful separate two-control diagnostic.
This advances practical execution and accounting while retaining the same
unfinished quality, privacy and owner-acceptance requirements.


## Follow-up: failed website repair and request-size diagnosis, September 14 local date

The independently qualified browser checker now completes all thirty checks on
both the unchanged website and the exact exported repair draft. Each passes
fifteen and fails the same fourteen arithmetic cases plus keyboard recalculation.
All three views of each candidate were inspected. This supersedes the earlier
incomplete-matrix gap without accepting either artifact or claiming a general
fix for intermittent Chromium captures.

The one fresh local repair stopped incomplete after fifteen settled requests.
Accumulated tool output made the sixteenth prepared request exceed the unchanged
192 KiB body limit before dispatch. No sixteenth provider request occurred. The
app incorrectly treated its unmatched model-start event as uncertain. The narrow
host-proven size-stop correction passed 173 focused checks, both typechecks and
the normal build. A complete scripted desktop case verified the specific reason,
two attempts but one settled request, exact exports across restart and denied
resume. Root independently reconciled its read-only ledger and reviewed both
screenshots. Initial host and desktop fixture assertion errors remain recorded.
The correction preserves the consumed attempt, output and no-resume outcome.
Historical runtime and failure evidence were frozen before edits. See the
[repair report](MVP_LOCAL_WEBSITE_REPAIR_REPORT.md).

Accurate failure reporting is now verified for this path. The next product work
is bounded handling of large tool observations and better use of failed checks. The first
MVP still needs accepted website/research work, useful real consultation,
practical input/output composition, private-data qualification and owner
acceptance. An error-message fix does not close those requirements.


## Follow-up: bounded execution evidence, September 14 local date

Large returned execution output is now retained with job/context/operation/hash
identity and exposed through bounded excerpts plus scoped range retrieval.
Projection limits eligible observations to 48 KiB while preserving authoritative
events and the existing final request cap. Persistence failure and corrupted
recovery evidence fail closed. The changed runtime passed 231 distinct focused
checks, both typechecks, the build and two complete desktop cases. One retrieved
an omitted failure after restart, repaired source totals and exported identical
bytes across another restart; the other retained the specific unsent size stop.
The initial fixture label failure remains recorded. See the
[observation report](MVP_BOUNDED_TOOL_OBSERVATIONS_REPORT.md).

This closes the execution-log growth mechanism identified above. It does not
prove that a real model will inspect or repair well. The next experiment uses
the same original website inputs in a fresh bounded task with independent
assessment. No closed task is resumed, and website/research quality, useful real
consultation, practical I/O, private-data qualification and owner acceptance are
still unfinished first-MVP requirements.


## Follow-up: real-model observation use without delivery, September 14 local date

The fresh local website trial used the verified reader twice, retained all
seventeen execution results and stayed below the 48 KiB observation budget.
Twenty requests settled in 245.777 seconds with zero unknowns or API fees.
Nevertheless it produced no HTML artifact: repeated Python type errors and
rewritten diagnostic scripts consumed all twenty attempts. All 22 checkpoints
were inspected; no output candidate exists. Cleanup and input/source preservation
were verified. The independent candidate evaluator therefore did not run. See the
[fresh trial report](MVP_LOCAL_WEBSITE_REPAIR_V2_REPORT.md).

The next proposed routing signal is repeated execution failure and lack of an
artifact checkpoint. Stop or change approach before spending the remaining
allowance on unchanged failures; consultation still requires its own configured
and approved path. The current result proves neither website quality nor full
MVP completion. Historical failed jobs remain closed.


## Follow-up: execution progress routing, September 14 local date

The host now responds to two exact repeated nonzero executions against unchanged
workspace content, offers current recovery guidance and blocks an unchanged next
command before invocation. Actual file changes permit retries. Missing required
output prompts a working-draft reminder after one third of the model allowance.
The exact image's qualified tools are described to the agent; other capabilities
remain unverified. Unknown or unrecorded action outcomes retain no-replay behavior.

The final host suite passed 222 tests; sixteen pure fixture checks, both app
typechecks, scoped desktop types and the production build passed. Four complete
scripted desktop scenarios now cover changed-action recovery and exact export,
known-stop restart, omitted observation retrieval and the remaining size stop.
The first four-case invocation had three passes and one incorrect raw-record
assertion; that negative result remains retained. Only the assertion changed,
and a fresh corrected case passed on the same build with three settled responses,
two tools and no extra request after restart. Both invocations together used
fifteen settled scripted requests, zero unknowns and zero API fees; all five jobs'
owned containers were absent in the final read-only check.

This closes the selected recovery mechanism, not the website-quality gap. No
real model ran in this milestone. Exact-match detection can miss semantic loops
or trivially changed commands, and file presence cannot prove artifact quality.
The next fresh real task must preserve original inputs and the original allowance,
then independently assess an actual exported candidate if one exists. Accepted
research/website delivery, useful real consultation, practical I/O, private-data
qualification and owner acceptance remain unfinished. See the
[progress report](MVP_EXECUTION_PROGRESS_REPORT.md).


## Follow-up: interrupted real trial, September 14

The fresh website trial hit a page-closure error after 51 seconds, with eight
settled requests and one uncertain request. It produced no native export; the
evaluator remains unrun. Its outer driver required watchdog termination after
1130 seconds, and the appClosed flag incorrectly implied process termination.
The exact leftover trial app was subsequently terminated; the owned Docker
scope is empty. These are execution-control failures, not an artifact score or
proof of a model-quality regression. The closed trial is not replayed.

The next concrete product improvement is first-class bundle export from the
final checkpoint: visible file inventory and sizes, exact-byte ZIP delivery and
existing inert preview. It should reuse the current task loop and installed
artifact tools. A narrow process-lifecycle correction is needed before another
real trial. Accepted research/website work, useful real consultation, private
deployment/retention and owner acceptance remain open; full MVP is not complete.

The separate late-state audit supersedes the early observation as the final
request count: ten requests, nine settled and one unknown. The app continued
after its controller lost the page and created a 14,238-byte HTML draft in a
checkpoint, then ended incomplete and released its claim. There was still no
native export or independent evaluation. The early failed result remains intact.


## Follow-up: native output bundles, September 14

The app now exposes all validated output files and can save a complete ZIP with
relative folder structure. Exact manifest/checkpoint checks protect export;
input/work files are excluded and incomplete status is preserved. 132 host
assertions, application typechecks and build pass. Renderer assertions remain
unrun due worker startup timeouts, and actual desktop bundle interaction remains
the next verification. This advances practical composition without claiming an
accepted multi-file website or full MVP. See the
[bundle report](MVP_ARTIFACT_BUNDLE_REPORT.md).
