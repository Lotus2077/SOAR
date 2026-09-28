# Bounded execution observations

Status: Approved for implementation and controlled verification under the owner's
continuing first-MVP instruction. Real-model execution needs a separately bound
task after the changed runtime is verified. Historical failed tasks stay closed.

The real website repair accumulated 184,248 bytes of tool observations. Repeated
commands printed hundreds of failed comparisons while exiting zero; the next
request exceeded the unchanged 192 KiB limit. Accurate failure reporting is now
verified. This change makes execution evidence usable within the same allowance.

## Contract

Keep each successfully returned execute result's complete decoded stdout/stderr
and exit code in the existing host-only content-addressed checkpoint store.
This is the sandbox's returned text, not a claim about exact raw process bytes or
uncaptured output after a timeout/output-limit exception. It is not a workspace
artifact and cannot be selected implicitly for cloud consultation.

Bind every retained result to one job, context and completed execute operation,
with its exact content hash, byte count and storage descriptor. Save and fsync
the content before atomically acknowledging the checkpoint and tool completion.
Missing or inconsistent retention cannot become a successful tool response.
After a crash, an unfinished operation remains blocked from replay.

The model receives at most 8 KiB of serialized observation for one result. Large
results explicitly identify omitted bytes and expose head/tail excerpts, exit
code and the retained observation ID/hash. Preserve control characters through
JSON escaping; never silently replace them in retained decoded output. A nonzero
exit must remain visible with a prompt to inspect, repair and rerun the check.
An exit code of zero says the process ended successfully, not that its reported
comparisons or the requested artifact are correct.

Add `read_observation` for a retained execute operation ID, expected SHA, stdout
or stderr, and a bounded UTF-8 byte range. It uses only this job/context's strict
host-owned references, never arbitrary paths, raw digest lookup or workspace
claims. Returned ranges identify actual boundaries and the next offset. Each
read consumes an ordinary model/tool allowance and grants no network permission.

Before each model request, deterministically project eligible execute and log-read
messages into at most 48 KiB total serialized content. Start with explicit compact
references for every eligible message and restore saved excerpts newest first
while they fit. Keep every assistant/tool pair and preserve the durable original
observations. Bind the projection policy and selected-message digest to each
model-start event; fresh execution and restart must derive the same projection.
Do not infer host eligibility from model text. Strictly validate references,
completion joins and content before replay or retrieval.

Leave public-source observations, consultation advice, goals, command arguments,
plans and finish/check feedback unchanged. They still count toward the final
192 KiB request cap. This bounds execution evidence, not every possible request.
Any remaining oversized request keeps the verified unsent stop and consumed
attempt. Change the protocol identity so old tasks cannot resume silently.

## Verification

Use focused tests for Unicode/JSON size boundaries, complete retained output,
head/middle/tail reads, wrong hash and cross-context rejection, corruption and
crash ordering, repeated output/readback growth, exact restart projection,
failed-check feedback, unchanged public/consultation messages and real unknown
request blocking. Retain the existing final request-size regression using an
oversized non-observation component.

Then build and freeze the app for controlled desktop verification. A synthetic
source-derived checker emits a large log containing a hidden failure and exits
zero. The scripted model must retrieve the record through the production tool,
repair the artifact from the actual returned evidence, and submit it to an
independent source-derived check. No fixture may secretly read the retained log.
Verify normal preview/export and restart, exact ledgers, unchanged inputs and
cleanup. This demonstrates mechanics, not learned model quality.

The next real task should use the same original requirements and an independent
evaluator after source/runtime admission. A failed task is retained rather than
replayed. Useful output, private-data qualification, real consultation and owner
acceptance remain first-MVP requirements.
