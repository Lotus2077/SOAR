# Desktop artifact delivery and request recovery

Date: September 14, 2026 local. Status: **Request correction and artifact delivery verified; one
accepted deck and one rejected website in the fresh development trials. Not released.**

This milestone exercises a website and editable presentation through the existing
general-task desktop, using public/synthetic inputs and the owned model. It does
not add a separate task-family agent, enable cloud fallback or qualify private
inference. The same goal, tools, checkpoint, broker, preview and export path is
used for each task.

## What changed in the app

The desktop previously reduced every model request to at most 45 seconds even
when its configuration allowed 300 seconds. It now honors configuration up to the
broker's existing 300-second maximum. The original fifteen-minute task deadline,
twenty model calls, thirty tool calls and 4096 output-token limit remain unchanged.
Timeout configuration is part of the task identity: changing it cannot silently
restart a queued or paused task with new authority.

Unknown dispatch receipts now optionally retain a strict fixed cause and bounded
elapsed/configured times. Transport distinguishes timeout, cancellation, HTTP
rejection, response size and other transport failures. Response/usage validation
and fee settlement have separate codes. Provider text, URLs, exception messages
and keys are excluded. The desktop displays a fixed explanation; old receipts
stay generic. Every unknown outcome retains its reservation and blocks another
dispatch. The existing precedence of unknown over expired display is unchanged.

Repository typecheck, the normal build, 54 controlled broker tests and 125 distinct
focused controller/session/budget/research/runtime tests pass. The first restricted
run could not bind localhost for 14 session cases; the full eighteen-case session
file then passed with approved local-listen access. This was an environment
failure, preserved separately. Four actual desktop scenarios pass in 27.181
seconds on the rebuilt runtime: pause/restart and export, cancellation/no replay,
public-source retention across restart, and uncertain public GET/no replay. They
use ten scripted model calls and four synthetic public GETs, not real inference.

## Preserved first attempt

The first actual website attempt, before the correction, produced no named output.
It reached four model requests: three settled and one unknown, with three tool
actions and no public GET or cloud call. App setup through closure took 55.921
seconds. Input preservation, cleanup and owned-container absence were confirmed;
full delivery/accounting completion was not. No artifact evaluation was possible.

Timing was consistent with the 45-second request limit, but the historical receipt
contained no diagnostic. The exact cause is unproved. This result is an incomplete
execution, not a demonstrated weakness in website generation. It was closed and
archived without replay, repair or fallback.

## Fresh website result

The corrected runtime completed one website task in 438.465 seconds, with twenty
settled model requests and twenty tool actions, zero unknowns, zero public GETs
and zero declared API fees. Exact native export, inert preview, input/source
preservation, ledger completion, app closure and owned-container absence passed.
The unchanged exported HTML is 14,137 bytes, SHA-256
`d94714b2a79a7b4c01525bb04316d5fe409be54f1c869ffc11ab4368539358db`.

**The website is rejected on independent content review.** Its default Atlas
recommendation displays USD 5.52 rather than USD 1,103.60: conversion divides units
again after conversion, including another division by two in its rounding helper.
It also hides totals for options excluded only by lead time, although the original
goal reserves “Not available” totals for below-minimum orders. These are substantive
requirement failures, not a formatting preference.

The frozen browser evaluator stopped at its initial semantic selection and emitted
no screenshots; its result is incomplete, not a completed arithmetic matrix.
Source contains two regions with the name Recommendation. The original goal does
not explicitly require exactly one such region, so that selector failure alone
must not be used to prove the page unusable. Supplemental offline inspection retained 390px and 768px screenshots, confirming
the wrong displayed values; Chromium crashed before the 1280px image and final DOM
record. This separate run is incomplete and was not retried. Candidate and frozen
evaluator are unchanged; cleanup and zero remaining owned containers were verified.
The two legible views do not establish full responsive or interaction coverage.

The model's own tool output repeatedly reported hundreds of conversion mismatches,
but execution continued and finally submitted. A zero process exit and self-written
check output do not establish a valid result. This is one exposed development task,
not evidence that the model generally cannot build websites. No repair, new model
attempt or cloud fallback follows this evaluation.

## Fresh presentation result

**One synthetic presentation is independently accepted.** The same desktop flow
completed its three-slide deck in 228.521 seconds, with seventeen settled model
requests and seventeen tool actions. Exact export, preserved inputs/source,
completed accounting, app closure and container cleanup passed. The original
46,441-byte PPTX has SHA-256
`d3f7368eb28bc826e4a575b45f08fd71de7b9ba2292860faa98310b8ed61c503`.
There were zero unknown requests, public GETs or declared API fees.

All nine frozen structural/source checks passed. LibreOffice rendered all three
original slides without a reported repair. A verification copy retained native
table and chart edits through public Python API save/reopen, including the actual
related embedded workbook. The original remained unchanged. The offline evaluator
ended normally in 3.002 seconds, with all bindings intact and cleanup confirmed.

Independent review recomputed the decision, savings, table and changed winner at
24 units from the sources, then inspected all slides and speaker notes. The result
is legible and consistent, with a native table and chart and no visible overlap or
clipping. Titles are 30pt, table 15pt and main narrative 14–24pt. The smaller 10pt
repeated caveat footer and 12pt chart ticks are treated as supplemental footnotes
and axis annotations, not main body/table text; this interpretation is explicit.
The actual slide dimensions/render are widescreen despite a stale screen-format
metadata enum. No Microsoft PowerPoint or cross-viewer guarantee follows.

This is the first accepted presentation from the general-task product path,
not general presentation reliability. Acceptance is an external review record;
the generic app correctly retains its separate `not_evaluated` label. The failed
website and earlier rejected research remain failures.

## Artifact evaluation scope

Both tasks use the original goals and two exact synthetic JSON inputs. Evaluators
and independent criteria were prepared before seeing a model output. Browser and
Office tooling run inside the existing pinned, offline, non-root container.
Inputs, candidate bytes, source/build, export and evaluator versions are bound to
each attempt. The new website and deck are development iterations after a runtime
correction, not held-out evidence. Each has one separately admitted attempt with
unchanged task limits and a 300-second model-request configuration.

Website assessment covers the original interaction, exact-decimal calculation,
invalid-input, accessibility and responsive-layout requirements in an offline
browser, followed by independent visual/semantic review. An inert desktop HTML
preview alone does not establish that the website functions.

Presentation assessment requires native chart/table objects and related embedded
workbook data, source arithmetic, notes and slide structure. Original bytes are
rendered with LibreOffice. A separate verification copy is edited through public
python-pptx APIs, saved, reopened, and independently checked against its actual
chart cache and related workbook. Worksheet names and addresses may legitimately
change; categories, series and unchanged values must retain their meaning.

Control failures were retained and corrected before any model-generated deck:
a malformed table namespace falsely passed the first structural checker, and a
LibreOffice-saved copy lost its embedded workbook. Original rendering and native
Python API editing are therefore separate supported observations. There is no
claim of LibreOffice saved-copy workbook preservation or Microsoft PowerPoint
compatibility. Binary floating-point storage permits an absolute 0.000001
representation tolerance; visible two-decimal values remain required.

## Remaining product work

The general-task flow still selects one fixed local model. The
[bounded consultation proposal](plans/MVP_GENERAL_TASK_CONSULTATION_V1.md) describes
one exact approved cloud packet followed by local continuation; it is proposed,
not an implemented or paid-tested route. The earlier rejected research memo also
remains rejected. Real-private deployment, privacy-filter qualification, owned
retention/deletion, broad task quality and release readiness remain unfinished.

Declared local API fees exclude the roughly USD 3,500 machine and operation.
There is no new claim of savings, hardware payback or general reliability.

References: [artifact plan](plans/MVP_DESKTOP_ARTIFACT_DELIVERY_V1.md),
[request recovery plan](plans/MVP_ARTIFACT_REQUEST_RECOVERY_V1.md),
[completion audit](MVP_COMPLETION_AUDIT.md), [build log](BUILD_LOG.md).
