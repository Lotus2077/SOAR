# Desktop general-task report

Status: **Implemented and verified for this bounded milestone; not released.**
Two actual Electron/HTTP/Docker scenarios pass. One fresh synthetic support-queue
report was completed through the app by the owned local model and independently
accepted without changing or retrying the candidate.

The General task workspace supports native input selection, a goal and one output
filename, saved task history, progress, pause/resume, cancellation and artifact
preview/export. The main process imports immutable input copies and gives the
renderer an opaque selection token. It owns the model, execution image, task
limits and artifact access. Legacy task, coding and review views remain available.

Each task is limited to **20 local model calls, 30 tool actions and 15 minutes**.
One desktop general task runs at a time. Resume preserves its original identity,
counters and deadline; it does not grant a new allowance. A changed configuration
or an uncertain operation can prevent resume. Cancellation remains available for
an incomplete task that needs cleanup, without replaying model work.

Both the **goal and selected files must be public or synthetic**, with an explicit
declaration before creation. Real private data remains outside the qualified
scope. Sandbox tools run without internet access, and this first desktop flow
does not expose the separately verified public-fetch tool. Local model inference
still sends task context to the configured model destination; an offline tool
workspace does not mean the model runs on the laptop.

To use the flow (the owner's machine-local image and model declarations are prepared):

1. Use Node 22.22.2 and the repository-declared pnpm version. Start Docker and configure
   the existing owned local model with `SOAR_PROVIDER_MODE=local`. Set
   `SOAR_GENERAL_TASK_IMAGE_ID` to the immutable ID of an already installed,
   reviewed Linux execution image. The image must contain the tools needed for
   the chosen deliverable. The app does not download an image automatically.
   Declare `SOAR_VLLM_COST_POLICY=local_zero_cost` only for the owned endpoint.
   Keep private model configuration outside shared documentation.
2. Launch the app with `pnpm dev`, open **General task**, and check availability.
   Availability checks configuration and the installed image; it is not a model
   connectivity or quality result.
3. Choose the input files, describe the desired result, and name one output, such
   as `report.md`. Confirm that the files and goal contain only public or
   synthetic material, then choose **Create and start task**. Editing the goal,
   selection or filename clears the declaration.
4. Follow the saved task and its progress. Pause allows owned execution to settle
   and close. Reopen the app and select the saved task; use Resume only when the
   host offers it. Use Cancel to stop work or request permitted cleanup. An
   interrupted or incomplete task is not a completed deliverable.
5. Once work has stopped and cleanup is confirmed, preview or export the saved
   artifact. Text and Markdown previews have no active HTML, links or images.
   Other formats receive metadata and native export. Truncated previews are
   labelled. Export uses the selected task, artifact path and snapshot hash.

**Submitted for review is not independent acceptance.** Host structural checks
check original-input preservation and the requested output's presence. They do
not prove correct calculations, supported claims or a usable document. Newly
created general tasks remain `not_evaluated`; inspect their contents independently.
Saved artifacts from incomplete or cancelled tasks are unfinished work.

| Verification | Current evidence |
| --- | --- |
| Full normal app build | Passed, including native broker and normal-build isolation check. Renderer has 429 modules after an import-only change to load 30 used icons directly. |
| Node, renderer and focused-test TypeScript | Passed. |
| Host controller / IPC / runtime identity | 23 / 13 / 3 tests passed. Controller checks passed again after the Docker metadata correction. |
| 18 focused renderer assertions | Unrun. Worker startup timed out before test collection, including outside-sandbox and post-import-change attempts. |
| Startup diagnosis | A separate bounded jsdom import stopped at 175 seconds; 257 completed dependency reads consumed 120.88 seconds. No assertion ran. The filesystem cause remains unknown. |
| Actual scripted Electron flow V1 | Both setup attempts failed before task dispatch. The first timed out after 240 seconds; its retained database has zero tasks, dispatches and events. The second reached the form but rejected the runtime because its Docker query required an optional `Volumes` key. Zero fixture requests. |
| Readiness correction | Matches the existing execution runtime's optional-map lookup. The corrected query succeeds against the installed immutable Linux image with no volumes; source review and rebuild precede the same two-scenario rerun. |
| Actual scripted Electron flow V2 | Reached pause/cancel in 4.4/2.7 seconds, then failed in the test ledger reader: dynamic imports are unsupported in Electron's evaluation VM. Two settled scripted requests and released claims were retained. |
| Corrected actual Electron flow V3 | **2/2 passed in 11.8 seconds.** Verified immutable inputs, consent, progress, pause/restart/resume, retained counters/history, cancelled restart and denied resume, inert HTML preview, exact export and container cleanup. Four scripted requests; no real model calls. |
| Test audit-reader correction | Uses a readonly Node SQLite connection and one consistent transaction; same job-scoped joins and assertions. Production app bytes did not change. |
| Fresh real-model app task | **Independently accepted, 1/1 in this frozen scope.** Six settled local calls/six tool actions; 50.796 seconds of task execution and 54.389 seconds including app setup/export/close. Exact export, input/source preservation, accounting and container removal pass. |

The live task used two authored synthetic inputs and a frozen goal. Independent
source arithmetic and a separate reviewer confirmed all aggregate counts, the
complete ordered overdue table, every data issue and the exclusion/boundary rules.
The neutral reviewer derived expectations from the source files before opening
the report and did not read the provided expected-result file. All five review
gates passed, with no material issues. The candidate was not repaired or retried.
An after-output table extractor aided the root review; it is not a frozen benchmark
evaluator and is not used to claim held-out reliability.

The exported artifact is 2,547 bytes, SHA-256
`935bfad744ab3bbc72628b3224d907bbfd43b2d37390421deb6553683601db08`.
The joined acceptance receipt is
`47ce20b58d7345280ec2e803f2b1dca40af8e2f266a9ebe11d4b9301c86d1e7b`.
All six requests settled; none has an unknown outcome. Accounted API fees are zero
under the owned-endpoint declaration. This excludes hardware and operating costs.
The app closed normally, all owned containers were absent, and all 189 frozen
source/build bindings remained unchanged. The app's generic acceptance field stays
`not_evaluated`; this one artifact's external review is recorded separately.

Earlier build and setup failures remain visible above. Narrow icon imports fix an
unnecessary dependency expansion, but cold dependency reads remain an unresolved
machine/setup limitation. The eighteen mocked renderer assertions did not run;
this milestone does not claim a full application regression or release gate.

The next useful experiment is a small, frozen set of public or synthetic tasks
beyond file auditing, with artifact-specific acceptance checks. Public research
needs its verified host-fetch capability connected to the desktop task authority;
website and presentation outputs need correctness and rendered-quality checks.
Real private files still require the outstanding local privacy-filter qualification.
No additional model run or paid allowance is opened by this recommendation.

The earlier accepted synthetic invoice report and public-response proof remain
separate evidence; they remain separate from this desktop proof. No real-private
readiness, general task reliability, routing savings or release is claimed.

See the [approved desktop plan](plans/MVP_GENERAL_TASK_DESKTOP_V1.md),
[previous milestone](MVP_RECOVERY_AND_FIRST_REPORT_REPORT.md) and
[current readiness](MVP_READINESS.md).
