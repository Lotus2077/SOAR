# MVP readiness

**September 28 handoff:** use [HANDOFF.md](HANDOFF.md) for the current code map,
experiment results, verification scope and ordered next steps. This file retains
the chronological milestone record; older "next" statements are historical.

**Current direction audit, 2026-09-14:** The architecture remains aligned, but
execution priorities drifted toward infrastructure proof. Two synthetic desktop
examples are accepted (file audit and editable slides); research and website
acceptance, useful real consultation, ordinary setup and real-private readiness
remain open. Freeze feature expansion and close one checked owner workflow using
the existing implementation. The [consolidated current audit](MVP_COMPLETION_AUDIT.md)
supersedes older next-step statements below; historical evidence is preserved.
This audit performed no new inference or test run and did not resume the paused goal.

**Bundle delivery, 2026-09-14:** Implemented all-output inventory and native ZIP
export in the existing task flow, with exact manifest/bytes and cleanup checks.
132 host assertions, both app typechecks and the normal build pass. Renderer
assertions remain unrun because its worker times out before startup; actual
desktop bundle interaction is not yet verified. See the
[bundle report](MVP_ARTIFACT_BUNDLE_REPORT.md). Full MVP completion remains open.

**Latest real trial, 2026-09-14:** The fresh website task hit a desktop-control
failure after 51 seconds: the target page closed with nine requests recorded,
eight settled and one uncertain. No native export exists and the evaluator did
not run. The driver remained alive until its outer watchdog killed it after
1130 seconds. Its reported appClosed flag did not establish process exit; the
exact leftover trial app was subsequently identified and terminated, and its
owned Docker scope was confirmed empty after cleanup. Original failure/uncertainty evidence is retained. This
run cannot establish model quality. The proposed next step at that time was
multi-file bundle export. Its later implementation and the course audit above
supersede that ordering; lifecycle correction still precedes further live trials.
Full MVP completion remains open.

A subsequent read-only database audit found that the app continued after the
controller lost its page: ten requests total, nine settled and one unknown, with
a 14,238-byte HTML draft retained in a checkpoint. The task later ended incomplete
and released its execution claim. The draft was never natively exported or
evaluated. Both the early driver observation and later database state are retained.

**Earlier progress milestone, 2026-09-14 (local date):** The general execution loop now
warns after two identical failed commands with unchanged workspace content and
stops an unchanged third command before execution. It permits retries after file
changes, reminds the agent to produce missing artifacts after one third of its
allowance, and exposes capabilities verified for the exact image. There are 222
focused host tests passing, sixteen pure fixture checks, both typechecks and a
successful build. Four complete scripted desktop scenarios verify changed-action
recovery, exact export, stop/restart without replay, observation retrieval and
the remaining request-size stop. One initial fixture assertion failed; its
separate corrected case passed on the unchanged build. The original failure is
retained. No real inference ran in this milestone, so improved model delivery
quality remains unproved. Next is one fresh bounded real task with independent
assessment of any exported candidate. Full MVP completion remains open. See the
[progress report](MVP_EXECUTION_PROGRESS_REPORT.md).

**Earlier observation milestone, 2026-09-14 (local date):** Large execution logs now stay in
local storage, with 8 KiB model observations, a 48 KiB cumulative observation
budget and scoped retrieval of omitted evidence. There are 231 distinct focused
checks passing, both typechecks and a successful build. Two complete desktop
cases verify retrieval and source-derived repair across restart, exact exports,
request accounting and the remaining oversized assistant-content stop. The first
observation case failed on a test label; its separate corrected run passed and
the original is retained. A fresh real-model trial then consumed twenty settled requests in 245.777
seconds without creating an HTML artifact. It used the new reader correctly but
repeated failing diagnostic commands; no candidate evaluation was possible.
See the [fresh trial failure](MVP_LOCAL_WEBSITE_REPAIR_V2_REPORT.md).
The previous real website remains rejected; useful consultation, accepted
research, practical input/output, private-data qualification and owner acceptance
remain open. See the [observation report](MVP_BOUNDED_TOOL_OBSERVATIONS_REPORT.md).

**Earlier website diagnosis, 2026-09-14 (local date):** The website evaluator completed
all sixteen control outcomes in a separately observed batch; earlier incomplete
captures remain retained and their cause is not proved fixed. The unchanged
website and the subsequent local repair draft each passed fifteen of thirty
checks. The repair task stopped incomplete: fifteen requests settled, then an
oversized next request was rejected before dispatch. Its draft, source and
ledger are preserved. The request-size classification fix passed 173 focused
checks, both typechecks, the production build and one complete scripted desktop
export/restart/no-replay scenario. The original fixture assertion failures remain
recorded. It does not fix the arithmetic or conversation growth. No real
consultant call or further live repair ran in this correction. See the
[repair result](MVP_LOCAL_WEBSITE_REPAIR_REPORT.md).

**Earlier consultation preparation, 2026-09-14 (local date):** Consultation can bind the default
service tier and retain validated model/token/tier evidence for fee recomputation
after restart. The safe session-configuration command is usable in the restricted
shell. Ninety-two application checks, five pure trial-driver checks, both
typechecks and four actual current desktop scenarios pass; all responses and
fees remain scripted. At that evidence cut, the website repair was prepared,
the cloud session profile was absent in this process, and two incomplete captures
left its evaluator unqualified. A separate two-control diagnostic passed without
establishing their cause. The current milestone above supersedes that preparation
state; this earlier result establishes no real consultant, quality, privacy or release proof. See the
[preparation report](MVP_GENERAL_CONSULTATION_TRIAL_PREPARATION_REPORT.md)
and [session setup](MVP_GENERAL_CONSULTANT_SETUP.md).

**Earlier consultation milestone, 2026-09-14 (local date):** Optional exact-packet consultation
is implemented in the existing general-task loop. The user reviews the packet,
destination, model and maximum fee, then approves or declines; Resume retains the
same deadline and model/request budgets. One-use priced grants, revocation,
durable untrusted advice and no-replay accounting pass 270 focused host/runtime
tests. Eight actual desktop scenarios pass on the rebuilt app, covering four
consultation cases and four local/public-source regressions. An accessible-label
failure was corrected; the four pre-creation failed attempts remain retained.
Both typechecks and the normal build pass. Two mocked React workers timed out
before any assertions, so that test gap remains. All inference responses in this
milestone are scripted and its fees simulated. Actual provider compatibility,
useful consultation quality, private-data qualification and release remain open.
See the [consultation milestone](MVP_GENERAL_TASK_CONSULTATION_REPORT.md).

**Earlier artifact milestone, 2026-09-14 (local date):** The general desktop delivered an
independently accepted synthetic three-slide presentation with a native editable
table, chart and embedded workbook. Seventeen local requests and seventeen tools
completed in 228.521 seconds; all nine structural/source checks, original
LibreOffice rendering, copy-only native API edits, independent arithmetic/visual
review, exact export and cleanup passed. The fresh website also completed delivery
(twenty requests/tools, 438.465 seconds) but was rejected for incorrect monetary
conversion and hidden required totals. Its browser matrix stopped early; two
supplemental views confirm the wrong values, while a Chromium crash leaves the
1280px view incomplete. No candidate was repaired after evaluation.

The app now honors configured model request timeouts up to 300 seconds and retains
safe fixed failure diagnostics. Its task deadline, call/tool limits and unknown
no-replay rules are unchanged. Fifty-four controlled broker tests and 125 distinct
focused host/runtime tests, typecheck, normal build and four actual desktop
regressions pass on the rebuilt runtime. The original 45-second website attempt
remains incomplete with one unknown request and no file. Full general routing,
accepted research/website quality, real-private deployment and release remain
open. See the [artifact delivery and failure report](MVP_DESKTOP_ARTIFACT_DELIVERY_REPORT.md).

**Earlier public-research milestone, 2026-09-14 (local date):** General tasks can start without
files and explicitly retrieve up to three exact public HTTPS sources through the
host while execution stays offline. Source bytes, consent, resolver choice and
receipts survive restart; unknown fetches stop without replay. Four actual desktop
scenarios, 194 focused host/runtime tests, both typechecks and the normal app build
pass. Twenty-six mocked renderer cases remain unexecuted. The first live public
memo completed delivery in 109.475 seconds, using ten local model calls and two
GETs with twelve settled requests, exact source/export identity and confirmed
cleanup. **Independent review rejected its correctness:** it mislabeled a
recommendation as a requirement and omitted two requested distinctions. The
unchanged candidate and all failed attempts are retained. This verifies delivery
mechanics, not accepted research quality, private-data readiness, routing savings
or release. See the [public research report and usage](MVP_DESKTOP_PUBLIC_RESEARCH_REPORT.md).

**Desktop foundation, 2026-09-13:** one synthetic support audit through the same
app was independently accepted, with six local calls and exact input/export and
cleanup checks. The earlier [desktop report](MVP_GENERAL_TASK_DESKTOP_REPORT.md)
retains that evidence, its two original scripted passes and setup failures.
The newer research attempt does not rewrite that result.

**Previous milestone, 2026-09-13:** the local agent submitted a complete synthetic
invoice audit in six calls and 45.866 seconds. Neutral review independently
confirmed its arithmetic. The frozen checker passed three of five gates; its
natural-Markdown false negatives were corrected in a separately versioned
development evaluator. V2 passed 28 controls and all five report gates in the
offline container. This one unchanged synthetic report is independently accepted
under the exposed development correction; V1's failure remains. Public retrieval
passes a live host-tool/model-consumption proof. The runtime changes pass 100 focused
tests and Node TypeScript; this is not a full application or release gate. See the
[milestone report](MVP_RECOVERY_AND_FIRST_REPORT_REPORT.md).

**Product direction, established 2026-09-11:** the owner prioritizes privacy >= quality >
savings > latency for a general end-to-end agent. Deep research, file auditing,
website building and PowerPoint creation are initial optimization targets, not
the product's scope boundary. The [recalibrated design](plans/MVP_PRIVACY_FIRST_AGENT_V1.md)
defines a local coordinator, isolated permitted-context workers, mandatory host
outbound admission, durable jobs and artifact-specific verification. The
[filter research](PRIVACY_FILTER_RESEARCH.md) recommends a local OPF calibration,
with laptop deployment as an option, before integration. The owner has now authorized
the [execution sequence](plans/MVP_PRIVATE_AGENT_EXECUTION_V1.md). The broker,
restricted execution and general loop pass the enumerated synthetic runtime checks,
including the corrected Docker proxy-environment gap, exact orphan recovery and
isolated public/private composition. Real-model task qualification remains open.
See the [development boundary report](MVP_PRIVATE_AGENT_BOUNDARY_REPORT.md).
The [first real artifact trial](MVP_PRIVATE_AGENT_FIRST_TASK_REPORT.md) reached
submission but failed independent arithmetic verification. Zero of four initial
assignments are accepted; one failed and three remain unrun. Expansion is paused
after two verification development probes: the second detected the main error but
failed as an acceptance mechanism. OPF's sixty-case confirmation attempt stopped
before inference at its preflight deadline; all confirmation cases remain unrun.
A separately frozen fresh calibration subsequently exhausted forty requests and
saved only one of seven required outputs. Its diagnostic checker passed two
preservation checks and failed fourteen remaining checks. At that stage there was
no accepted general-agent task. That runtime and evaluator are closed; no retry of
that assignment began. The goal was paused at the September 12 status check; the
owner subsequently requested the separate milestone recorded above. See the updated
[first-task report](MVP_PRIVATE_AGENT_FIRST_TASK_REPORT.md).

The subsequent [small tool/connectivity check](MVP_LOCAL_TOOL_AND_CONNECTIVITY_REPORT.md)
closed on September 12. All three short model commands serialized correctly, but
only two operations passed; the append command failed its own Unicode bytes
assertion before writing. Its conditional report task did not run in that closed
allowance. The model
selected the correct public-fetch tool, but no web content arrived. A later DNS
probe found a reserved-address mapping denied by SOAR's outbound policy. GPU-server
internet access remains unknown. The output-limit feedback/two-strike runner change
passes eighteen focused unit tests; these live cases did not reach the token cap.
That closed step established no independently accepted general-agent task or release.
The subsequent milestone above is separate evidence; the earlier failures remain.

The pending twelve-episode cloud-versus-Automatic comparison is **superseded as the
next experiment and remains undispatched**. Its proposed USD 29.10 allowance is not
open. The previous 25% relative latency and 20% savings advancement conditions no
longer gate the new product experiment; privacy and quality do. Historical results
below are preserved, including their original criteria and limitations. That next
product step is now verified in the desktop milestone above. The next proposed
experiment broadens public or synthetic task coverage with explicit artifact checks.
Privacy qualification remains necessary before real private inputs; permitted-route
comparisons and transfer outside the initial four families still require evidence.

An explicit experimental **Automatic selector is implemented and its runtime
mechanics are verified**. It sends committed baselines beyond the critic's source
limits directly to prepared cloud and can use local drafting plus critique for
eligible sources. A host-owned receipt binds source, configuration, reason and
budget; admission drift stops dispatch. All six original tasks were inspected:
three select cloud and three select local draft/critique. Sixty-two focused and
108 adjacent tests pass, as do both typechecks. Both real controller/HTTP/Python/
Docker fixtures pass, with seven synthetic requests and no real provider calls.
A new fractional-time check is separately qualified against valid and defective
controls. UI assertions still did not execute because worker initialization timed
out. Fresh paired quality and savings remain unproven. See the
[implementation result](MVP_AUTOMATIC_ROUTING_IMPLEMENTATION_REPORT.md) and
[revised six-task comparison](plans/MVP_LOCAL_CRITIC_REPAIR_COMPARISON_V1.md).

The opt-in local draft, one cloud critique and optional local repair policy has
**one independently accepted patch from one fresh exposed-task episode**. Seven
local calls and one acceptable cloud critique produced the ordered-build-rules
patch in 55.552 seconds for USD 0.039000 in accounted API fees. No repair ran.
Final visible checks, the original five independent tests, the qualified twelve
interaction methods and a neutral source review all passed. Accounting and cleanup
are verified; all sixty prior runs/570 requests are preserved, and the ledger now
contains 61 runs/578 requests. This proves a useful local contribution in one
complete production-policy episode, not general quality or matched savings.
The [fresh six-task comparison](plans/MVP_LOCAL_CRITIC_REPAIR_COMPARISON_V1.md) is
the proposed next experiment. See the [episode result](MVP_LOCAL_CRITIC_REPAIR_EXECUTION_REPORT.md).

The preceding implementation verified runtime mechanics. Four synthetic
controller/HTTP/Python/Docker cases passed: acceptable without repair, actual
feedback followed by repair, invalid settled critique, and unknown transport.
Source/check binding, cumulative limits, fee accounting, replay and cleanup are
verified. The initial fixture invocation failed before any request because of a
preparation-phase guard; that failure is retained and the correction has a
regression test. Final host checks passed 121 tests, context/scope checks passed
78, final focused Python checks passed 84, and both application typechecks pass.
The UI assertions did not run because dependency initialization timed out; that
gap remains. The implementation-only stage made no real model requests and left
its then-current 60-run/570-request ledger unchanged. Its synthetic tests prove
mechanics; the subsequent real episode is separate evidence above. See the
[implementation report](MVP_LOCAL_CRITIC_REPAIR_IMPLEMENTATION_REPORT.md).

The post-draft critic calibration **passed its fixed-pair signal gate**. Two
independent critiques identified the exact material bug in the rejected local
draft and accepted the valid planned-local control without an invented defect.
Independent source adjudication supports both judgments. Actual API fees were
USD 0.073784, all settled; batch elapsed time was 32.411 seconds. Prior records
and 132 frozen bindings are preserved. This produced no repair or newly accepted
patch. The subsequent runtime implementation and verification are recorded
above; a fresh live comparison remains outstanding. General routing quality and savings
remain unproven. See the [critic result](MVP_POST_DRAFT_CRITIC_CALIBRATION_REPORT.md).

The separately versioned public interaction suite is **qualified development
coverage** on the exposed ordered-build-rules task. The reference, historical
prepared-cloud patch and accepted planned-local patch pass all twelve methods;
the rejected local-first patch passes eight and fails four, with five assertion
reports. V1 stopped after its baseline because the reference's patch format failed
scope admission, before reference execution. V2 proved equivalent source/modes
under a canonical patch representation and reused the completed baseline. All
checks, cleanup, 103 frozen bindings and the unchanged 58-run/568-request ledger
are independently verified, with zero new model calls or API fees. The original
evaluator, classifications and four reserved tasks remain unchanged. Its
subsequent separately approved critic calibration is recorded above. General
routing quality and preserved-quality savings remain unproven. See the
[qualification result](MVP_ROUTING_INTERACTION_QUALIFICATION_REPORT.md).

The new local-first episode is closed with **zero accepted patches out of one**.
It submitted in 44.184 seconds using seven local calls, no cloud recovery and zero
API fees. Both visible tests and all five frozen independent tests passed, but a
fresh blind source reviewer found an exclusion-to-inclusion parser defect; a
separate isolated Docker diagnostic reproduced both marker variants. Accounting,
cleanup and prior records are verified. The low fee is not preserved-quality
savings. Current check/progress signals did not trigger recovery for this semantic
defect. The subsequent public-requirement interaction qualification above now
detects this failure; a bounded feedback/repair or review policy still needs its
own evidence. See the [local-first result](MVP_LOCAL_FIRST_EXECUTION_REPORT.md).

The preceding cloud-plan/local route has one independently accepted patch on one
exposed task: one planner request, nine local requests, no fallback, and USD 0.077284
in accounted API fees. Runtime public/generated checks passed, followed by five
frozen independent tests and a neutral source review. Cleanup, accounting and all
prior records are verified. This episode took 159.149 seconds; the earlier cloud
run on the same task took 73.812 seconds and cost USD 0.144580. The historical
comparison shows a latency concern, not a fresh savings result. The subsequent
local-first experiment above removed the planner and generated checks together;
its faster submitted patch failed independent acceptance. See the
[complete execution result](MVP_PLANNER_LOCAL_EXECUTION_REPORT.md).

The clarified planner prompt produced one accepted plan with nine parsed tests
in a separately bounded one-call probe. Accounted API cost was USD 0.061024, with
confirmed cleanup and no local/solver request, test execution or patch. The parser
logic and limits are unchanged. Source inspection found no copied placeholder;
that plan-only probe did not test usefulness. The complete episode above is
separate evidence. The preceding unchanged-prompt calibration stays
closed with its first rejection and second task unrun. See the
[calibration results](MVP_PLANNER_CONTRACT_CALIBRATION_REPORT.md).

The approved twelve-episode public-checks comparison is closed and **Failed**.
Prepared cloud produced four acceptable patches out of six; cloud-plan/local
produced zero. All six planner responses failed the inner output contract before
any local model request. Total accounted API cost was USD 2.027200 across 45
settled requests, with no new unknowns and confirmed cleanup for all twelve runs.
Two independent source reviews, including separately labeled guided cache
adjudication, confirm two material cloud patch defects. Missing P artifacts leave
all paired regression judgments unknown. Lower fees from failing to produce work
are not savings. See the [completed development result](MVP_ROUTING_PUBLIC_CHECKS_DEVELOPMENT_REPORT.md).

The planner's missing rejection detail is now corrected and verified: 79 focused
TypeScript tests, 37 host-only Python methods, one actual loopback main/Python/
Docker fixture and the Node typecheck pass. Fourteen Python Docker methods and
four existing integration scenarios were not rerun. This preserves diagnostic
codes without changing planner acceptance or rewriting the live failures. That diagnostic
fix enabled the V1 calibration. V2 then clarified the host-command boundary and
added a concrete suite example, passing 19 host parser tests, 12 wrapper tests,
nine driver tests, four launcher tests, two actual loopback/Docker fixtures and a
private driver typecheck. Its single real planner response was admitted. The
subsequent complete coding episode and independent patch checks are recorded above;
planner admission alone proves neither quality nor savings. No failed assignment
is retried and the four untouched tasks remain reserved. The original permission rejection and retired undispatched freeze are
preserved in the build log. The executed replacement had 128 passing scoped tests,
a passing Node typecheck and independent source review before dispatch.

Earlier runtime verification: host-owned checkpoints and public-requirement
planner checks passed scoped tests. Four actual controller/HTTP/Python/Docker
fixtures passed after a terminal-source correction; twelve other runtime fixtures
passed before that correction. That invocation passed 312 scoped TypeScript tests
and both application typechecks. The Python invocation passed 152 methods
including 27 Docker cases; the corrected router subsequently passed 53 methods,
including three added regressions. The UI invocation executed zero tests because
its worker failed to start. This is not a current full-suite or release gate.
Those fixtures establish mechanics. The later twelve-episode live comparison
above failed; quality-preserving savings remain unproven. See the
[offline result](MVP_ROUTING_PUBLIC_CHECKS_REPORT.md).

Earlier development result: the two earlier-check attempts are closed and neither
repair qualifies for acceptance. Cache stopped after returning a command outside
the restricted checkpoint tools, before any early check ran. Retry submitted and
passed the original tests but failed both stronger date probes; source review also
found incorrect long-decimal parsing. Ten local requests settled, with zero new
cloud/API fees, no unknown outcome and confirmed cleanup. The profile gate failed.
See the [earlier-check result](MVP_ROUTING_EARLY_CHECK_REPORT.md).

The prerequisite original-reference precheck also failed one stronger case per
task. Those negatives remain. Separately versioned corrected positive controls
passed all four suites (seventeen methods) before generation; none of the corrected
reference or added probe content entered model inputs.

The preceding paired native reasoning comparison stopped with
zero submitted candidates out of four assigned episodes. Disabled reasoning failed
a visible checkpoint test; medium reasoning timed out on its sixth request, and
the two Retry-After assignments remain unrun. Accounting reconciles thirteen local
requests (twelve settled, one unknown), zero new API fees and confirmed cleanup of
both attempted runs. The post-generation evaluator separately stopped before its
first result; no independent evaluations or blind reviews completed for this batch.
The profile advancement gate failed. See the [reasoning report](MVP_ROUTING_REASONING_REPORT.md).

An explicit earlier-check local profile is now implemented and verified in scoped
mechanics tests. With eight calls it can require a check on call five, preserving
edit/check/submit capacity after a failure. Its subsequent real-model development
test failed the quality gate described above. See the
[early-check plan](plans/MVP_ROUTING_EARLY_CHECK_V1.md).

The preceding implementation passed 237 TypeScript assertions, 114 Python methods including
27 Docker cases in one invocation, ten actual main/runtime integration cases, and
node/web typechecks. The integration covers both successful repair after early
feedback and rejection of a later regression after an early pass. Future evaluator
objective attribution now uses the actual create schema; a separate read-only
receipt verifies both prior run objectives without rerunning failed evaluations.
The default routing comparison again accepts current explicit default settings
while retaining historical configuration bytes. Thirty-one earlier UI assertions
remain unexecuted; this is not a current clean full-suite or release gate.

The preceding compact critique plus bounded local repair has four
accepted candidates out of six assigned and fails its advancement gate. Five final
submissions passed independent tests, but Retry-After failed blind review and cache
never submitted. The same counterexamples reveal defects in two original cloud
controls, correcting the earlier six-of-six assessment. Tool filtering now has
focused runtime verification; no fresh confirmation or preserved-quality savings is
established. See the [repair report](MVP_ROUTING_REPAIR_REPORT.md).

The preceding tool-filtering change passed 100 Python tests including 27 Docker
cases, 213 TypeScript unit assertions, and all seven main/runtime integration
cases across two focused runs. Independent source review found no runtime blocker.
The broader unit invocation also reported a UI worker startup error; 31 UI tests
did not execute. Final node and web typechecks passed.
These are scoped mechanics results, not a clean current full-suite or release gate.

The additive **coding MVP** is **Implemented with local mechanics, unfinished-work
recovery and real OpenAI execution verified**, not Released. The completed
36-episode screen produced 11/12 review-acceptable Cloud patches and 10/12 each
for prepared Cloud and Hybrid. Every original local phase fell back, so no local
contribution or hybrid saving is established. The later partial-handoff repair
is separate and has no live quality/cost calibration. Owner acceptance remains
unmeasured. See the [screen report](MVP_HYBRID_SCREEN_REPORT.md) and preserved
[development pilot](MVP_CODING_PILOT_REPORT.md).
It has a separate `patch-run-v1` store, main-owned
per-request admission, a pinned mini-swe-agent worker, credential-free Docker
execution, OpenRouter and direct OpenAI session-key paths, fixed and experimental native policies, and app
preview/export/Keep/Reject. Its route is explicitly enabled with
`SOAR_PATCH_MODE=live` or `scripted`; the legacy review/Keychain/PR6R contracts
below retain their own boundaries. Mechanics tests and loopback fixtures are
not provider, model-quality, savings, routing-benefit or release evidence.
See [coding quickstart](MVP_CODING_QUICKSTART.md) and the latest build-log entry.

The separate [local capability diagnosis](LOCAL_CAPABILITY_DIAGNOSIS.md) preserves
the original hybrid result and documents direct coding success, protocol failures,
unfinished autonomous tasks and unresolved timeouts. The scout now uses the exact
format example that passed six first-turn controls. That is not a verified full
scout or hybrid improvement. The subsequent [native coding calibration](NATIVE_LOCAL_CALIBRATION.md)
verifies an isolated adapter: 60 complete requests, two of four exposed tasks
submitted and independently accepted, two unfinished tasks, and no new paid cloud
calls. The later app-integrated native policies now have fixture/Docker/HTTP proof,
including trusted checks, bounded checkpoints and one patch-preserving cloud
recovery. A subsequent six-episode app-integrated calibration completed: local-only
and local-first each passed one of two exposed tasks, while cloud-plan/local passed
both. All 97 requests settled, with USD 0.096508 accounted API fees and no unknown
exposure. See [app routing calibration](MVP_ROUTING_CALIBRATION.md) for the retained
quality and finishing failures. The frozen 48-assignment fresh comparison stopped
after 24 assignments when the local server returned HTTP 500. That request remains
unknown with zero reserved API fees; worker cleanup is confirmed. The unused
continuation was subsequently retired without dispatch after review established
quality losses. The original blind-review join accepted six cloud, two local-only,
three local-first and four cloud-plan/local patches among the six attempted tasks
per policy. The later identical-counterexample audit found material defects in two
cloud controls and supersedes that six-of-six assessment. Twenty-four assignments
remain unrun. Preserved quality remains unproven; the interrupted screen also cannot pass its original
no-unknown advancement gate. See the [partial comparison report](MVP_ROUTING_SCREEN_REPORT.md).
The original calibration results
remain separate from this new implementation; [the routing plan](plans/MVP_ROUTING_V1.md)
records its limits, exact cloud control and evaluation requirements.

The distinct `cloud_plan_local_review` experiment is **Implemented with runtime
and app mechanics verified**, but its live development cost gate **Failed**. Local
submission is provisional and requires one cloud review/repair phase before final
submission, with time and model-call reserves. Its pre-dispatch verification covered 89 Python
runtime tests, the full 1,485-test repository gate (12 existing skips), six Electron
workflows and 13 private driver tests. Application typechecks, native checks and
both build flavors pass. Earlier dependency and Git-fixture delays remain recorded;
the passing runs retain the original test timeouts. Cloud repairs now mark the local
check stale while final checks bind the repaired source. The six-task development
batch stopped after three completed runs already exceeded the maximum total fee
compatible with 20 percent savings, even assuming six accepted patches and no further
fees. One later run was cancelled; two remain unrun. Known new fees are USD 1.288388
plus USD 0.301480 unknown exposure from the cancellation. All containers were removed.
Two independent blind reviews now agree on all four available artifacts. One of
the three completed runs is accepted; two contain material regressions despite
passing tests. The source-review-acceptable cancelled patch cannot count as a
completed success. The final denominator is one accepted out of six assigned,
including the cancellation and two unrun tasks. The join remains incomplete;
the separate cost rejection is conclusive. No fresh confirmation has run. The
[review policy plan](plans/MVP_ROUTING_REVIEW_V2.md) retains its original bounds;
the failed result does not establish quality improvement or savings.

A subsequent compact-critique diagnostic completed six one-response cloud critiques
for USD 0.491912, with no new unknowns. It marks the same two original P candidates
for repair and accepts the other four. This is binary classification agreement on
exposed artifacts; it does not establish exhaustive defect detection, repaired-patch
quality or fresh routing savings. The known cache keyword-forwarding defect was not
explicitly identified. The subsequent bounded local repair is now closed with four
of six final candidates accepted; see the latest result above. The implementation
is a private diagnostic using shared admission, separate from app policy defaults.
See [latest routing results](MVP_ROUTING_SCREEN_REPORT.md) and the
[compact-critique plan](plans/MVP_ROUTING_CRITIC_V1.md).

The eight-call local-repair limit, two deterministic repair seeds and frozen driver
were verified before inference with 235 TypeScript tests, 99 Python tests including
27 Docker cases, eight private driver tests, twelve seed tests and typechecks.
Both repairs ran once, making thirteen settled local requests with zero new API
fees. Five submitted patches passed independent checks; blind review accepted four.
The failed batch is closed. Earlier full-suite and Electron results above belong
to the earlier runtime, before subsequent native-runtime changes.
See the [local repair plan](plans/MVP_ROUTING_CRITIC_REPAIR_V1.md).

This file records the repository-level readiness contract. It deliberately does
not describe any maintainer's endpoint, credential, account balance, or local
machine configuration.

Local Evaluation Bridge v1 is **Verified** but not **Released**: exact
release-head and Electron checks passed on its implementation revision, its
separately authorized nonempty live proof passed once, and the exact post-proof
revision passed Linux and macOS GitHub Actions.

PR6A Cloud Setup and Dispatch Lock was **Verified** but not **Released**. Its
historical setup-only Keychain operations are superseded by the PR6B1-B
status-only boundary. Its metadata candidate and pure egress-shadow
code do not authorize provider validation, production cloud dispatch, real
Hybrid selection, or PR6B1-C through PR6B3.

PR6B0 Hybrid Simulation is **Implemented with automated exact-SHA closure** but
not **Verified** or **Released**. Its app-visible route exists only when the main process uses fake
provider mode and explicitly enables simulation. It uses in-process Fake Local
and Fake Cloud implementations, does not read Cloud Settings or a credential,
does not contact the configured vLLM or an external provider, and records `$0`
actual external spend. Exact-head tests, all seven Electron workflows, macOS
package validation, independent final review, and exact-SHA Linux/macOS CI
passed on `9495d6bcbaa8cef5d3342e0d53ab02efe28d0002`; manual VoiceOver,
keyboard-only traversal, 200% zoom/reflow, light/dark contrast, and reduced-
motion proof remain pending.

PR6B1-B is **Implemented with automated exact-SHA closure**, not **Verified**,
**Activated**, or **Released**. It removes secret entry and mutation from the
web stack, adds a status-only locked native authority and conservative operation
journal, and leaves provider checks, real Hybrid, repository egress, and spend
locked. Deterministic, committed-head, Electron, exact-archive, canary,
independent-review, and Linux/macOS CI gates passed on
`ddd171c6092f695e64360d73e78a257ee3fb9159`. This is `$0` phase-B substrate
evidence, not signed credential-continuity or provider evidence.

## Implemented PR6R-A checkpoints

PR6R-A is approved only for the `$0`, loopback-development sequence. Its A1
contracts, exact public-fixture materializer, development-only Electron graph,
canary store, and OS-user-local authority ledger are present in the current
working milestone and are **Implemented** on exact revision
`4cab8a7d61ef648fdfed6b03653c5bfbe367e28d` after independent review,
committed-head proof, and Linux/macOS CI run `33603435199`. A2's backend-only
sealed loopback transport, SQLite/OS accounting, and conservative recovery are
also **Implemented with automated exact-SHA closure** on revision
`f9037ef9d9739c1df33bfcc0fdc5d3c2aa372523`: committed-head local proof and
Linux/macOS CI run `33633065030` passed. Neither A1 nor A2 is Verified or
Released, and A3 is not implemented.

A1 proof is deliberately narrow:

- the special build admits exact repository modules and bare externals, carries
  distinct artifact identities, and is rejected by the normal package policy;
  the dual-flavor command then restores a verified normal `out/`;
- the explicit `cal-007-flask-jinja-name` command reconstructs the pinned
  nine-path, 62-line fixture from already-present local Git objects with no URL
  clone, fetch, provider call, credential, or paid spend; and
- the strict contracts and append-only stores bind checkpoint, request,
  campaign, guard, slot, terminal, accounting, fallback, and projection facts
  using opaque structural hashes. Payload-contract v6 also removes the internal
  fallback child-session ID from renderer output and bounds raw replay history
  to 17 records of at most 1 MiB each. The payload ceiling is four times the
  single-result ceiling: three bounded review outputs plus one result-sized
  allowance for the versioned projection envelope. Those hashes prove host-canonical
  equality, not secrecy, authenticity outside the host boundary, model quality,
  or an external provider event.

A2 proof is also deliberately narrow:

- one hash-only synthesis child imports the exact completed public-fixture
  checkpoint, inherits the existing Local lease, and starts with zero child
  attempts. Restart authority is reminted only after transiently rehydrated
  packet/message/checkpoint inputs revalidate against the exact parent and
  import-only child;
- one direct `node:http` loopback transport accepts only the sealed canonical
  request, a live fixture-listener capability, genuine runtime/OS/SQLite
  authority, and one admitted simulation reservation. It has no credential,
  proxy, redirect, retry, SDK, configured provider, or arbitrary URL input;
- atomic SQLite start/finish accounting and the OS slot ledger are reconciled
  through nominal live two-store witnesses. Budget denial and pre-reservation
  cancellation make zero requests; every sent crash recovers without
  redispatch, and an admitted open attempt consumes the full simulation
  reservation as `unknown`;
- the first all-pending comparison/projection pair consumes a separate one-use
  live-campaign authority over the exact campaign-only replay. A later terminal
  transition is bound to the exact prior replay and may change only its matching
  decision; reuse, unrelated decision/fallback mutation, topology changes, and
  schema-rejection validity mislabeling fail closed;
- complete bounded responses persist only normalized usage, cost, stable
  terminal facts, and optional response/result hashes. File-backed success and
  malformed-response tests scan every SQLite table, the closed database files,
  and the safe finish projection for unique raw request/response markers; and
- the focused local matrix passes strict parser/framing, IPv4/IPv6, one-use
  authority, zero/one observed-request, cancellation, denial, exact host-priced
  settlement, crash/reopen, transplant, deletion, and idempotent-recovery
  cases. This is synthetic loopback evidence, not provider or quality evidence.

The following limitations are part of the readiness contract:

- `pr6r-development-module-graph.json` is an unsigned deterministic declaration,
  not an artifact-byte attestation. Public identities plus copied JSON can
  counterfeit it outside the canonical build, so it is not standalone proof;
- build-proof v5 parses allowlisted TypeScript/JavaScript and applies a
  dynamic-loader/global-network AST-node denylist. It remains a conservative
  regression guard, not semantic/data-flow analysis or standalone no-egress
  proof. Exact-source review and runtime evidence remain required;
- the authority files are a cooperative same-user ratchet. Deleting only the
  ledger root is detected, but a same-user process can delete both the separate
  guard and ledger; A1 is not hardened tamper-proof storage;
- structurally completed A1 output retains `outputValidity=deferred`. Only A3
  may recompute validity from admitted evidence;
- A1 renderer-safe citations are limited to the fixture's nine changed paths.
  Unchanged tests, helpers, and other repository context require an A3
  snapshot/evidence-set-bound allowlist and a persisted-contract revision;
- the current special signature denylist includes `local_only_v1`, which A3
  will legitimately need. A3 must replace or narrowly scope that heuristic
  through the exact graph/provenance policy and regression tests; and
- A2 remains absent from renderer, preload, IPC, bootstrap, the retained
  Electron graph, and packaged activation; build proof remains v5. A3 must bind
  the canonical reopened ledger, run dedicated PR6R recovery before generic
  startup recovery, transiently reconstruct the public packet/messages, remove
  or explicitly reassess the narrow static ESM cycle, and advance the retained
  graph proof to v6;
- A2's deterministic runner accepts explicit ID/clock sources for fault proof,
  but validates and freezes all IDs and its one canonical nonfuture timestamp
  before the first OS effect. A3 must encapsulate production host sources in
  its retained coordinator rather than expose them through IPC or renderer
  input; and
- A1/A2 have no app coordinator, interactive canary UI, configured-provider
  request, credential resolution, off-device egress, actual-cost reservation,
  or paid inference.

Accordingly, A1/A2 prove no review quality, best-result regret, routing benefit,
cost saving, latency improvement, production readiness, verification, or
release. Contributor commands and cleanup boundaries are documented in
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Implemented

- macOS-first Electron shell with a sandboxed React renderer and typed preload
  bridge;
- append-only SQLite session events, restart recovery, and deterministic session
  reconstruction;
- a checksummed database migration ledger, exact frozen-baseline adoption check,
  and operational append-only integer-micro-USD budget storage whose supported
  paid-attempt mutations run through the atomic unit of work;
- one OpenAI-compatible, operator-attested local provider with streaming,
  cancellation, timeouts, token usage, structured `ReviewResultV1` JSON Schema
  output, and honest incomplete-response handling. Its configured vLLM endpoint
  may run on this Mac or another machine. For a non-loopback endpoint, the
  operator must explicitly set `SOAR_VLLM_COST_POLICY=local_zero_cost` after
  confirming that the endpoint charges no token fee;
- validated provider descriptors plus a main-process runtime catalog and
  registry. Normal vLLM mode constructs exactly the configured Local provider.
  Explicit fake simulation mode constructs only the branded Fake Local and
  tool-free Fake Cloud providers; one locked real-cloud candidate remains
  separate metadata and cannot be parsed as a dispatchable provider;
- a PR6B1-B status-only Cloud Credential boundary with no renderer/preload/IPC
  secret or mutation schema, exact current-window/top-frame authority, a
  locked Objective-C++ macOS broker, noninteractive legacy attribute status,
  a non-secret SQLite operation journal with conservative restart ambiguity,
  and provider-not-run/dispatch-locked projections;
- a pure canonical-message cloud-egress shadow guard that evaluates
  host-derived provenance and returns bounded finding codes and semantic
  hashes. It performs no I/O. Normal vLLM mode retains the PR6A shadow-only
  boundary; PR6B0 binds the policy to an in-process fake invocation only;
- bounded, read-only repository tools for listing, literal search, and text reads;
- a separate host-only `inspect_git_changes` gateway that acquires deterministic
  staged, unstaged, rename, delete, and bounded untracked change manifests
  without exposing arbitrary host invocation through renderer IPC. It is absent
  from the default model tool surface and is exposed only as the one required
  inspection tool in the dedicated review coordinator;
- strict, content-addressed `ChangeSnapshotV1`, `ReviewEvidenceSetV1`, evidence
  reference, and host-derived `ReviewCoverageV1` contracts with exact identity
  revalidation and fail-closed omission/coverage semantics;
- an app-created `change-review-v1`, `agentic-execution-v2`, `local_only_v1`
  Review Current Changes path. It keeps inspection, bounded full reads, and one
  tool-free synthesis on the same selected provider and records zero selected
  metered-provider exposure under that operator attestation;
- a separate main-owned `hybrid_simulation_v1` Review Current Changes path
  available only under explicit fake simulation configuration. It consumes a
  single-use workspace-bound disclosure challenge, acquires evidence locally,
  evaluates immediate semantic egress admission, may invoke one no-tools Fake
  Cloud synthesis, and permits one eligible Fake Local continuation/fallback;
- immutable `simulation | actual | legacy_unclassified` cost scope across
  campaigns, reservations, route decisions, attempts, terminal accounting, and
  recovery. PR6B0 uses only `simulation`, labels provider-reported, host-priced,
  conservative-full-reservation, or not-settled provenance, and excludes those
  values from actual-spend projections;
- a renderer-safe Hybrid simulation picker with Local selected by default,
  challenge-bound consent and invalidation, exact fake-only result/history/copy
  markers, replay-safe phase and provider trace, simulated cap/reserved/settled
  values, `$0` actual external spend, cancellation disclosure, focus restoration,
  textual phase status, and responsive reflow assertions;
- canonical-event review provenance reconstruction, a no-truncation review
  packet, exact raw-versus-attached result verification, host semantic
  acceptance, and post-synthesis snapshot revalidation;
- a renderer-safe review projection with allow-listed/redacted session events,
  no streaming raw deltas, aggregate-only coverage metadata, freshness
  reinspection, withheld drifted/unavailable/invalid results, and visible but
  non-copyable incomplete results. The accepted structured result may still
  expose bounded evidence references for its findings;
- a frozen `change-review-eval-v1` protocol and 12 real public calibration
  changes from SOAR, Flask, and pytest, materialized through the bounded host
  acquisition path; the mechanical policy classifies 5 low risk and 7 high
  risk and retains one curator-label disagreement;
- provider-neutral, token-bounded context packets with deterministic evidence
  deduplication, breadth-first admission, explicit failed-tool state,
  compact source-result metadata, citation-support snippets, fail-closed
  mandatory intent, packet/message hashes, and persisted per-inference
  compilation telemetry;
- a persisted `repository-investigator-v1` task-track identity, ordered
  completion obligations, next-required-tool filtering, exact path-and-line
  citation validation with replayable acceptance/retry checks, and a tool-free
  finalization pass;
- duplicate-observation detection that marks repeated results failed and ends
  tool use after two no-progress observations;
- 22 research and 20 coding benchmark manifests plus fixture isolation,
  preflight checks, evaluator adapters, and machine-readable result export for
  already-produced submissions. These utilities do not execute an agent episode
  or prove that a caller-supplied trace came from the production runtime;
- a separate Local Evaluation Bridge v1 command that materializes one frozen
  nonempty public SOAR change without network access, runs the same production
  local-only review coordinator used by Electron, judges canonical replay, and
  writes a privacy-safe lossy proof under a run-ID reservation. The run ID is
  non-reusable while its ignored `.run-ledger` is preserved. Its one-live-episode
  authority is fixed to the committed plan ID in OS-user-local application
  state on this machine and is independent of disposable benchmark output;
- a separate offline held-out evaluator-readiness command with policy-neutral
  runner contracts, evaluator-only 24/8/16 oracle and witness contracts,
  domain-separated salted commitments, private semantic-finding bindings,
  manifest-bound Ed25519 coordinator keys, signed judgment commitments and
  signed joint resolutions, conservative all-assigned scoring, Wilson and
  fixed-seed cost/latency intervals, dispatch/usage consistency with explicit
  unreported-attempt counts, manifest-envelope checks, explicit valid-review
  yield, and no-replace safe aggregate publication.
  External trust-anchor approval remains a future campaign gate because the
  offline caller supplies both manifest and key. Its recursive import gate
  excludes the app runtime, providers, network, dynamic loading, and
  subprocesses. Tests use generated synthetic records; no real held-out corpus,
  run, or quality result exists. Exact implementation revision
  `0819a60f22ce442b481063d8575d1533540d0f4d` passed Linux Node 22 and macOS
  Electron CI and is Verified as an offline harness, not Executed or Released;
- deterministic unit, integration, and Electron end-to-end tests;
- strict additive v2 routing-decision and inference-attempt schemas, replay
  invariants, and crash-window recovery;
- a pure checkpoint router, immutable router-input snapshots, operational
  integer-micro-USD budget ledger, atomic attempt unit of work, paged recovery,
  event/ledger reconciliation, and an explicit two-fake-provider v2 runner that
  covers admission, denial, timeout, cancellation, overrun, and one local
  fallback at zero paid cost. PR6B0 now connects those mechanics to the strict
  change-review coordinator using branded in-process fakes. Normal vLLM mode
  still constructs no separately configured metered cloud provider: Repository
  Investigator emits v1 local-only sessions and Review Current Changes emits v2
  local-only sessions.

## Not implemented

- PR6R-A3 coordinator/UI/package proof and every later PR6R-B credential/
  provider or PR6R-C paid-provider phase;
- production cloud-provider execution, dispatch-time credential retrieval, or
  remote credential validation;
- real/production hybrid routing, production provider-health/price acquisition, or
  learned scheduling;
- any production provider switch: the review v2 path is deliberately
  same-provider and Local only in normal vLLM mode, where Hybrid is visibly
  disabled and reports that no separate metered provider is configured;
- PR6B1-C's signed A/B credential-continuity proof, PR6B1-D's real native
  re-entry and protected lease activation, PR6B2's real credential/provider/
  health/pricing validation, and PR6B3's external transport, wire-bound
  admission, real reservation, and paid canary. Phase B authorizes none of
  them;
- complete release validation or current Repository Investigator live proof;
  the one-shot synthetic empty-snapshot structured-review schema canary and
  deterministic/Electron PR 5 gates passed on 2026-08-30, but the live canary
  proves only schema compatibility—not a post-fix real-repository flow—and does
  not substitute for those broader checks;
- browser, shell, file-write, patch, or external-message tools;
- test execution, patch application, commit/push, arbitrary historical-range
  review, or unbounded/binary/submodule evidence review;
- a signed release channel or general downgrade support for databases that
  contain v2 events;
- official bulk SWE-bench evaluation on a native x86-64 Linux worker;
- held-out review-quality evidence for Local Evaluation Bridge v1; its one live
  result is a production-path wiring proof, not a defect-recall or precision
  benchmark.

## Provider contract

Development requires an OpenAI-compatible base URL ending in `/v1`. Reasoning
tokens can consume the provider's output allowance without producing visible
content, so every local request sets `reasoning_effort: "none"`; its serialized
request overhead is included in the context reserve. The runtime still records
any reported reasoning separately and rejects empty, truncated, filtered,
malformed, or tool-looping completion states rather than assuming the provider
honored that request.

The configured URL may point to a vLLM server on another machine. Review
evidence is transported to that endpoint, so the Local-only label is an
execution-policy statement, not a claim that evidence never leaves the Mac.
For a non-loopback endpoint, the operator must explicitly set
`SOAR_VLLM_COST_POLICY=local_zero_cost`; SOAR treats this as an attestation that
the endpoint charges no token fee. It does not independently identify the
service behind an arbitrary URL, inspect external billing, or measure
infrastructure cost. Review synthesis uses the exact OpenAI-compatible JSON
Schema response format with tools disabled; arbitrary structured contracts and
a free-form JSON-suffix fallback are not supported.

Locked PR6A candidate metadata records
`deepseek/deepseek-v4-flash-0731` through OpenRouter as product intent. It is not
an enabled application runtime or evidence of current availability, capability,
limits, or pricing; those external facts require fresh validation under a
separately approved PR6B2 plan.

Context Packet v1 conservatively estimates one token per UTF-8 byte, reserves a
configurable safety margin, and subtracts adapter-estimated provider request
overhead before admitting evidence. `usage.recorded` remains the source for
actual provider token usage, while its `reported` flag distinguishes real
telemetry from a missing report represented by zero. The packet compiler changes
provider request construction, not route selection. Repository Investigator
retains its single local route. In normal vLLM mode, Review Current Changes
records a v2 local lease and keeps that same selected provider through
synthesis. Explicit fake simulation mode instead uses its fixed main-owned
Fake Local/Fake Cloud catalog and simulation-only checkpoint policy; renderer
input and stored credential state cannot alter that catalog.

## Live proof status

The PR6B0 source, persistence, IPC, renderer, and deterministic-test
implementation passed its automated exact-SHA closure on corrective revision
`9495d6bcbaa8cef5d3342e0d53ab02efe28d0002`: exact-head tests, seven Electron
workflows, package validation, independent review, and GitHub Linux/macOS jobs
passed. This remains implementation evidence, not a real-provider run or a
release. Manual VoiceOver, keyboard-only traversal, 200% zoom/reflow,
light/dark contrast, and reduced-motion proof is pending. Normal vLLM mode
remains Local-only and Hybrid-locked throughout.

The PR 5 local Review Current Changes implementation has deterministic adapter,
event/replay, Git, coordinator, IPC, projection, and Electron test coverage.
The one-shot `pnpm test:live-review-schema` run passed against the configured
`RM-01 VLM` on 2026-08-30, as recorded in the build log. It proves exact-schema
compatibility on a synthetic empty snapshot, not a post-fix real-repository
flow or real-review quality. The final full-suite/release gate and current
Repository Investigator live proof remain separate. The app constructs no
separate OpenRouter or metered provider, and no such PR 5 route was selected.
The canary's `$0` cost provenance relies on the operator's configured-endpoint
attestation and is not independent billing evidence.

Local Evaluation Bridge v1 now adds deterministic production-path coverage for
the frozen two-file `cal-001-soar-plan-approval` change, including four terminal
attempts, three successful read-only tools, two routing boundaries, one retained
provider lease, exact snapshot acceptance, safe canonical projection, and
no-replace result-file publication followed by a last-written
`publication.complete-v1.json` marker. The final directory is not atomically
published and is incomplete until that marker exists. Content hashes make later
mutation detectable, not impossible. Focused deterministic tests use a scripted
local provider and do not contact an endpoint. Exact release-head and Electron
gates passed on implementation revision
`5be93c100c945cfdebb310f5e36dafa1827b9101`. The one authorized nonempty
real-vLLM episode then passed with a fresh complete host-accepted result, four
terminal inference attempts, three successful read-only tools, two routing
decisions, no provider switch, and 34 safe canonical events. Final remote CI on
the exact post-proof revision passed on Linux and macOS.

The authority ledger is a cooperative guard for processes using the same OS
account, not a hardened security boundary. A sent or disposition-unknown
attempt retains the claim, and a crash after claim may conservatively consume
it. Another live attempt requires new explicit approval and a new committed
plan authority ID. A run namespace reserved before a classified blocked outcome
also consumes that run ID while the ignored run ledger remains present.
Emergency safe-projection or unsafe-output records preserve bounded execution
and safe trace data where each is independently scannable and omit it
fail-closed otherwise. Accepted review prose and relative evidence references
remain untrusted and require inspection before sharing.

Review Current Changes invokes configured-model health admission before its
provider attempt. That admission fails closed unless the unique selected
`/models` entry supplies a positive safe-integer `max_model_len` at least as
large as the configured maximum input plus maximum output allowances. The
default floor is 26,624 tokens (18,432 input + 8,192 output). Missing, invalid,
or insufficient capacity is unhealthy for that review admission. The live
Repository Investigator proof independently applies the same inequality in
preflight. The adapter's generic completion method does not implicitly perform
this capacity check.

The prior Local Repository Investigator reports are diagnostics, not accepted
proof. The 934,311-token reference came from `f221798+working-tree`, did not
identify a content-hashed fixture, and predates the current claim-coverage and
exact-symbol validators. The later 101,321-token failed attempt also predates
the current schema-v5 isolated-fixture contract. Neither supports a direct 60%
before/after claim.

The live proof runs against a temporary archive of the declared
clean HEAD with the evaluator implementation excluded and the archive SHA-256
recorded. Its agent-visible objectives deliberately disclose the required
paths, source substrings, relationships, and exact tool schedules. It is
therefore a guided execution, evidence-retention, and replay proof—not a blind
test of repository discovery skill or general answer quality. The persisted
model result remains model-attributed; additive `evaluatorRecords` are derived
by the host and explicitly marked as not model-authored.
Architecture must first perform exactly one bounded,
non-recursive root listing, one exact read of `src/main/index.ts`, and seven
ordered, case-sensitive, file-scoped evidence searches in evaluator-owned
order; missing, extra, reordered, broad, or argument-mismatched calls fail the
task. Cancellation likewise requires its nine ordered searches. The symbol task
has its own call-path manifest. Successful complete reads must cover all five
evidence files and snippets, followed by five exact file-scoped searches that refresh every
non-`cancelSession` evidence snippet in evaluator-owned order before synthesis.
Its symbol gold comes
from a separate bounded UTF-8 filesystem scanner rather than the production
search implementation; the method, scope, occurrence set, and hash are
recorded. The host derives the symbol evaluator record only from the successful
complete global-search observation, then independently cross-checks it against
the oracle; it never derives a passing record from oracle data alone. The proof
retains the conservative `utf8-bytes-v1` estimator, a 20% safety margin, and a
per-call provider-overhead reserve within an 18,432 maximum-input-token policy.
The episode is bounded to 34 provider calls, 29 tool calls, and
626,688 reported input tokens. Each session attests the
persisted `repository-investigator-v1` track, and every provider call attests
the served model and local-zero-cost policy. Preflight hashes the normalized API
base and records only bounded `/models` metadata after requiring the configured
model to be advertised and applying the same 26,624-token minimum-capacity
check. One configured-endpoint availability response on 2026-08-30 advertised
`max_model_len` of 262,144 for `RM-01 VLM`; this was a one-time `$0` response,
not proof of universal provider support or empirically verified capacity. The
accepted-answer provider input is bound to the
unique accepted completion round and persisted packet/message hashes; all
verified answer citations, required claim snippets, and exact symbol-oracle
occurrences must survive in its completed tool evidence. The fully admitted
global-symbol-search envelope retains its own compact citation membership even
when an overlapping read keeps fuller support. Contract v7 identifies that
exact envelope, sorts its citations and the
independent oracle separately, and compares the exact sets rather than accepting
the union of citations from all tools. Evaluator manifests supply deterministic
claim IDs, summaries, and required evidence; the host binds those claims to
distinct citations present in both successful parsed tool observations and the
accepted completion check. This is structural evidence coverage; the model
answer is checked for completion and citation integrity, not general semantic
quality. Artifact schema v5 remains unchanged; this strengthened task evaluator
is contract v7.
The exact schedules are
task-specific guided proof checks, not a generic runtime exact-argument
scheduler or evidence of dynamic provider routing.

Only a revision-addressed `.accepted.json` report containing `passed: true` is
an accepted result. Legacy ambiguous filenames and same-revision stale reports
are quarantined before preflight. Once a full revision is declared, setup
failures write a distinct self-identifying preflight diagnostic. Attachable
reports replace repository and isolated-fixture absolute roots with stable
labels before serialization. Reports still contain objectives, model results,
and workspace-derived event/tool trace content and must be inspected before
sharing.

## Security boundaries

- credentials and endpoint overrides belong only in ignored machine-local
  configuration;
- raw credentials must never cross into the renderer, event log, trace export,
  test fixture, or error message;
- repository tools remain inside a user-selected canonical workspace and reject
  traversal, symlink escapes, and oversized output;
- host change acquisition uses fixed, non-shell Git operations with an isolated
  environment, disables lazy fetch, external diff/textconv execution, hooks,
  prompts, pagers, fsmonitor, submodule recursion, and caller transport
  settings, and restricts object reads to already-observed full OIDs;
- status and diff discovery share a secure application-owned temporary index;
  the canonical index is fingerprinted and not refreshed or rewritten, while
  split indexes and assume-unchanged/skip-worktree visibility flags fail closed;
- missing partial-clone objects fail rather than fetch; symlink contents and
  submodule worktrees are not inspected, and any gitlink conservatively makes
  review coverage incomplete;
- a path changed in both the index and worktree is represented but explicitly
  incomplete—including add/delete and rename reversal states—because version 1
  does not admit a separate index-content side;
- effective repository clean/process filters and protocol overrides are
  rejected before status/diff. Git cannot atomically lock that config check to
  the following operation, so a concurrent external repository-config writer
  remains a documented TOCTOU trust limitation;
- repository content and retrieved benchmark material are untrusted input;
- Hybrid simulation authority is main-owned, fake-only, and unavailable in
  normal vLLM mode. Its challenge acknowledges simulation only, real egress
  consent remains `none`, and no Keychain or external transport is reachable
  from that path;
- destructive actions, publishing, credential access, and external side effects
  require new tools and an explicit permission design before they can ship.

## Release gate

A contribution is locally releasable when `pnpm check` and `pnpm test:e2e` pass,
the readiness validator reports no tracked secret, and the relevant opt-in live
or benchmark proof passes and is attached without committing its generated
artifacts. See
[CONTRIBUTING.md](../CONTRIBUTING.md),
[ARCHITECTURE.md](ARCHITECTURE.md), and the
[benchmark protocol](../benchmarks/README.md).

PR6B0 has not met that release gate. Automated exact-SHA closure passed, but its
manual accessibility record remains outstanding, so **Implemented** must not be
read as **Verified**, **Released**, or safe for real Hybrid dispatch.

## PR 3 through PR 5 verification boundaries

The default change-review calibration test is offline and `$0`: it validates
the checked-in strict schemas, manifest hash, risk arithmetic, 5/7 split, single
label disagreement, and structural absence of held-out identities or gold. It
does not reacquire the 12 historical revisions in ordinary CI. An opt-in local
materialization test accepts explicit SOAR, Flask, and pytest clone paths and
reconstructs all 12 changes without a provider call or implicit network fetch.
Frozen per-file additions and deletions are projected from those same acquired
snapshot hunks used by live risk; Git numstat remains a bound discovery view,
not a second routing-line-count definition.

The frozen curator labels represent review attention, not defect correctness.
No held-out quality corpus, model-facing review workflow, quality improvement,
cost saving, or latency benefit is proved by PR 3. PR 4 adds deterministic
routing and accounting mechanics only through nominally branded fake providers.
Its original fake cloud lease is not a production cloud path and was not
rendered as a user review. PR6B0 separately connects a strictly branded fake
simulation to the app without creating a real cloud route. PR 5 implements the
app-created local-only workflow,
repository-observation event provenance, no-truncation evidence packet, strict
same-provider structured result, freshness/copy rules, and renderer redaction.
It does not prove review quality or dynamic routing and is not a claim that the
final release validation or Repository Investigator live proof passed. The
local structured-schema canary did pass once on 2026-08-30, but only against a
synthetic empty snapshot; it is not post-fix real-repository or release proof.
PR6A is Verified but not Released. PR6B0 has automated exact-SHA closure but is
not Verified or Released; its Fake Cloud label never denotes an external
provider. PR6B1-B is Implemented with automated exact-SHA closure for local
`$0` phase B, not Verified, Activated, or Released. PR6B1-C signed proof,
PR6B1-D real re-entry, PR6B2, and PR6B3 remain separately gated and are required
before a real credential lease, provider validation, production cloud dispatch,
or a paid OpenRouter canary.
