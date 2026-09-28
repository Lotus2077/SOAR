# Desktop general-task milestone

Status: Approved by the owner's instruction, "go for next milestone", following
the accepted local report and host-mediated public retrieval milestone.

Deliver a usable desktop flow: choose public or synthetic inputs, describe a goal,
name one output, run the local agent, follow progress, pause/resume or cancel, and
preview/export the exact submitted artifact. Use the existing general session,
runner, broker and checkpoints. Do not introduce a second agent loop or broaden
the current privacy authority. Public web retrieval is not required for this first
app flow; sandbox execution remains offline.

The main process owns native file selection, bounded immutable input copies,
goal/input consent, model/image/source bindings, generic structural checks and
artifact resolution. The renderer receives an opaque selection token and safe
metadata. It cannot supply arbitrary host paths, checker programs, providers or
limits. Inputs and the goal must be explicitly identified as public or synthetic.
Real private inputs remain outside this milestone's authority.

Persist a separate general-task record and reuse the existing runtime records for
each new job. App restart must preserve phase identity, counters and original
deadlines. Pause closes owned execution; cancellation is durable. Unknown operations
and live-owner claims cannot be replayed or silently cleaned up. A changed runtime,
model, destination or task binding stops resume.

Preview Markdown/text without active HTML, images or network links. Binary outputs
receive metadata and native export. Resolve preview/export by job, output path and
snapshot digest, never a renderer-supplied host path. Display submission and
independent acceptance separately; generic structural checks cannot prove quality.

Implementation and verification are authorized. Use focused controller/IPC/UI
tests and at most two bounded actual Electron/loopback-model/Docker flow scenarios,
with no real provider calls in those fixtures. Exercise input selection, progress,
pause, process restart, resume, preview, exact export and invalid authority paths.
Retain setup failures and label scripted results as mechanics evidence.

After both typechecks, the focused host checks, both actual scripted Electron
scenarios and independent source review pass, freeze
the app/runtime/task bindings before one fresh real local-model app task. Bound
that task to twenty model calls, thirty tools and fifteen minutes, with zero
declared API fees, no cloud fallback and no public retrieval. Use authored
synthetic inputs; no prior failed task or sealed evaluator is reused. Stop on a
terminal failure and retain the candidate. Inspect the artifact independently
from the actual source data and verify app progress, cleanup and exported bytes.
No model retry after independent evaluation is included.

Completion means the working app flow is exercised and limitations are recorded.
It does not establish general task reliability, four-family coverage, real-private
readiness, routing savings or release. Record the final evidence in BUILD_LOG and
MVP_READINESS before calling this milestone complete.

Verification clarification, 2026-09-13: the mocked renderer suite has repeatedly
stopped before test collection. It remains an explicit unverified test surface.
The two actual Electron scenarios are mandatory for admitting the already approved
single synthetic local-model task; they exercise the real renderer, IPC, runtime
and export. A passing host suite and source review alone cannot substitute for
that app proof. This clarification changes the verification path, not the one-task
allowance, privacy scope, model fees or no-retry rule. A separate bounded dependency
startup investigation may close the mocked-suite gap without delaying unaffected
implementation work.
