# Desktop public research milestone

Status: **Desktop mechanics verified; first live report rejected on correctness.**
This extends the accepted desktop file-audit slice, not the full privacy-first
MVP or a release. See the [completion audit](MVP_COMPLETION_AUDIT.md).

A General task can now begin with a goal alone. Files are optional. The user can
separately approve up to three exact public HTTPS URLs, including their paths and
queries, and select system DNS or an explicitly disclosed Cloudflare lookup.
SOAR uses its host broker for those requests; the execution container remains
without network access. URLs inside the goal do not grant retrieval permission.

The host retains complete source bytes and receipts joining the exact request,
settled response digest, public context and retrieval time. The renderer shows
those receipts as inert text. A receipt proves acquisition, not correctness of
the source or the generated report. Observations over 32 KiB are explicitly
shortened; complete responses are retained up to 64 KiB. No broader browsing,
search engine, private query or cloud fallback is enabled.

Each task remains bounded to twenty local model calls, thirty tools, fifteen
minutes and five public GET dispatches. Pauses and restarts keep the original
scope and allowances. Unknown request outcomes stop further work and cannot be
replayed. New records use version 2; existing version 1 records retain no public
retrieval authority. Changed runtime protocols refuse unfinished historical
resume rather than silently changing its behavior. Host artifact access now
requires confirmed execution cleanup, matching the UI restriction.

## Evidence so far

- Full Node/renderer typechecking and the normal app build pass.
- 55 desktop host tests pass: controller, IPC and runtime identity.
- 139 runtime tests pass: source/permission contracts, session/budget behavior
  and broker integration. This includes retained-byte tampering, exact URL and
  query denial, a durable fetch cap, unknown-outcome stop and bounded DNS waits.
- The original eighteen mocked renderer assertions plus eight newly authored
  cases have not been executed. Their source typechecks; actual Electron tests
  are the next verification step. Prior worker-startup failures remain recorded.
- Public preflight used six brokered GETs and no model calls: two RFC texts and
  three authored synthetic source pages settled with matching bytes; a separately
  requested failure endpoint produced the expected unknown dispatch state. The
  system resolver returned nonpublic addresses, so tests explicitly select the
  existing Cloudflare resolver. No hidden fallback or address-policy bypass was
  added. An abort stops waiting for a system lookup; it does not cancel underlying
  OS resolver activity.
- The first preflight harness supplied an invalid extra context field and stopped
  before dispatch. Its database confirms zero requests; the failure is retained.
  A separate preparation command encountered the sandbox restriction on the tsx
  CLI's IPC socket; using Node's existing tsx import loader completed that read-only
  preparation without granting network access.

## Actual desktop verification

The corrected build passed all four Electron scenarios in 32.0 seconds: two
existing offline flows, plus source retrieval/pause/restart/export and an unknown
fetch that stops without another model turn or replay. The tests used ten
scripted localhost model requests and four real public HTTPS GET dispatches;
one GET deliberately ended unknown. No production transport override or real
model participated. All 194 frozen source/build bindings were unchanged.

The first invocation retains two offline passes and two research failures. Both
research cases stopped before creating a task because nested helper text became
part of the controls' accessible names. Explicit caption bindings fixed the
source and resolver controls. Both failed cases had zero requests and normal
app closure; their evidence has not been relabelled as a pass.

## First live result

The first owned-local report completed its delivery flow in **109.475 seconds**:
ten model calls, ten tool actions and two public GETs. All twelve requests settled
with zero accounted API fees. Both exact retained RFC response bodies match their
preflight identities, all 194 source/build bindings remained unchanged, and the
native export matches the submitted artifact. Execution cleanup and actual owned
container absence are confirmed; the app closed normally without a forced kill.

**The report is rejected.** Separate root and neutral source-based reviews agree
on a material contradiction: its example explanation calls an object-only top
level an RFC requirement, although the standard permits other JSON values and
recommends objects or arrays for older parsers ([RFC 7493, section 4.1](https://www.rfc-editor.org/rfc/rfc7493.txt)). The neutral review also identifies
two requested comparison omissions: RFC 8259's problematic-Unicode behavior and
the qualified scope of its UTF-8 requirement. These are source-derived findings,
not a preference for a different writing style. Several failed review gates
overlap the same contradiction and must not be counted as distinct errors.

The example parses as JSON and both independent prose counts are below the
380-word limit. Those positives do not outweigh the material claim error. Root
and neutral criteria were frozen before the candidate; no criteria or candidate
was edited and no model retry followed evaluation. The app still correctly says
independent acceptance is not evaluated, because its generic checker validates
input preservation and a nonempty artifact, not factual claims.

Candidate SHA-256: `bf06d8db3c81abd28d1105e62b3ef090da721435e849f37165c7030c1ccb1ef7`.
The retained assessment joins source, criteria, dispatch, cleanup and export
evidence. This is zero accepted reports in one new research attempt, not a model
reliability estimate. Earlier accepted file audits remain separate.

The practical result is a working public-source delivery capability with research
quality still unqualified. The next MVP work is to exercise real website/deck
artifacts and add a permission-aware review/escalation route. A stronger model
or reviewer must earn its usefulness on actual results; it is not assumed to
solve this error automatically. Closed trials are not silently reopened.

## Use the new flow

Launch the configured pilot with the existing desktop quickstart, open **General
task**, and describe the deliverable. Choose a single output filename such as
`report.md`, `index.html` or `presentation.pptx`. Files are optional.

For source-grounded research, enter up to three public HTTPS source URLs in the
separate field and explicitly permit retrieval. Select the hostname resolver;
on the currently preflighted machine, the explicit Cloudflare choice succeeds
where system answers are rejected as nonpublic. Confirm that the goal, files and
sources are public or synthetic, then create the task. Review saved source
receipts and export the final artifact. Source receipts and a Submitted status
do not replace checking the actual result.

Leaving the source field empty keeps the tool workspace offline and gives the
model no public-fetch tool. This pilot takes exact supplied sources; it does not
yet search for or autonomously approve new websites.

## Limits

The route admits only explicitly public/synthetic material. It does not qualify
real-private inference transport, server trust, detector release authority,
cloud consultation, quality-preserving routing savings or GPU-server OS internet
access. Zero declared API fees exclude the owned hardware and operating costs.
Website and editable PowerPoint tooling is already available, but accepted app
artifacts in those families still require separate frozen trials.

References: [approved plan](plans/MVP_DESKTOP_PUBLIC_RESEARCH_V1.md),
[desktop foundation](MVP_GENERAL_TASK_DESKTOP_REPORT.md),
[build log](BUILD_LOG.md), [readiness](MVP_READINESS.md).
