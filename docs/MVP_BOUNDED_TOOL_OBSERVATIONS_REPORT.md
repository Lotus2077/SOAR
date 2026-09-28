# Bounded execution observations

Status: Implemented and verified for the bounded-observation mechanism, including
two complete desktop scenarios. This does not establish real-model artifact
quality or completion of the full MVP.

The failed local website repair repeatedly printed hundreds of mismatches and
eventually exceeded the model request limit. The agent now retains returned
execution output locally and sends bounded excerpts, with a tool for retrieving
omitted evidence. This directly addresses the observed conversation growth.

## Implemented behavior

Each returned execution result is saved with its job, context, operation and
content hash before the tool is acknowledged. The complete decoded stdout,
stderr and exit code stay outside the workspace artifact list. Model-facing
observations are limited to 8 KiB each, including JSON escaping; their cumulative
content is limited to 48 KiB, favoring recent excerpts. Older messages retain
references. The original events remain intact.

The new `read_observation` tool retrieves a bounded UTF-8 range using the saved
observation ID and exact hash. It consumes the existing task allowance. Missing,
altered or mismatched saved evidence blocks continuation. Restart validates the
same references and reconstructs the same projection. The changed protocol
prevents silently resuming an older task under new behavior.

A failed process produces explicit repair feedback. A successful process exit
does not establish semantic correctness. Goals, assistant commands, public-source
observations and consultation advice retain their existing treatment and can
still reach the final 192 KiB request cap. That path keeps the specific unsent
stop and consumed attempt.

## Focused verification

The root batch passed 215 checks across nine files. The new observation module
passed sixteen checks. A subsequent exact-feedback validation correction passed
all 55 affected module and runner checks; the final small-output wording change
then passed the sixteen module checks and Node typecheck. These are 231 distinct
checks, not the sum of repeated executions. Both application typechecks, the
four-file desktop-fixture typecheck and the normal build passed.

Coverage includes escaped/control-character sizes, UTF-8 ranges, cross-context
and wrong-hash rejection, full saved output, repeated large observations,
projection identity, persistence failure, atomic acknowledgement rollback,
missing saved blobs after SQLite reopening, unchanged consultation/public-source
behavior, request accounting and remaining oversized-request handling.

Independent source review caught and corrected outer JSON byte counting,
provider tool-ID compatibility, capture-state validation, projection preference
for small original messages and exact host failure serialization before the
desktop run. Earlier source revisions and verification receipts remain retained.

## Controlled desktop proof

Two cases passed on runtime
`92f6325db666d8f0e11726a72fada267006a5147a5f21be72e81721909b4469e`.
The frozen admission binds 191 source/build/fixture files. One case requires
retrieval and source-derived repair across restart; the other exercises the
remaining oversized assistant-content stop. The size-stop case passed: oversized assistant content made a 220,975-byte
request that was rejected before dispatch, with two attempts and one settled
request. The exact 84-byte artifact exported before and after restart.

The initial observation case reached repair, first export and final restart,
then failed because the test expected Submitted instead of the actual Submitted
for review status. Its missing final assertions are not counted as passed. The
original run and source are preserved; only that locator was corrected for one
separately admitted rerun. The corrected case passed in 8.606 seconds. It preserved a 215,040-byte log,
retrieved bytes 100,000–100,512 after restart, repaired the single wrong row and
exported the exact 208-byte result before and after a second restart. Independent
calculations from the original CSV confirmed all three totals. Its four model
attempts and four tools stayed within the original allowance. The largest
request was 17,544 bytes; projected execution/readback content was 9,208 bytes.

Root independently read both retained SQLite databases, verified source and
checkpoint hashes, matched the readback to the original log, recalculated the
source totals and request sizes, checked both exports, and queried Docker to
confirm the owned containers were gone. The selected screenshots show the
correct submitted/incomplete states and counters. Both passing cases have zero
unknown requests, fees and reservations. The initial failed case also remains
accounted for.

Root audit SHA-256:
`f1e21e10174343e19c50bf9d6c15f2b986897fe05ea5d59eee5cadefa5efd51d`.
The current two-case proof does not turn the earlier failed invocation into a
pass or extend historical consultation proofs to this build.

## Limits and next step

Retention covers successfully returned decoded execution output, with a 2 MiB
encoded blob limit. It does not recover output lost by the existing sandbox on a
timeout or capture-limit exception. Scripted tool selection cannot establish
that the local model will use the evidence well.

The previous real repair remains rejected: fifteen of thirty website checks
passed, and no verified submission was produced. A subsequent [fresh local trial](MVP_LOCAL_WEBSITE_REPAIR_V2_REPORT.md)
used the original inputs and this runtime. It successfully used the new reader
but exhausted twenty attempts on diagnostic scripts without writing the HTML
artifact. Its projected observations stayed within 48 KiB. No candidate existed
for independent evaluation. This negative outcome remains separate from the
controlled proof and earlier failed jobs. Useful real consultation, accepted research output,
practical input/output composition, private-data qualification and owner
acceptance remain open.

References: [approved plan](plans/MVP_BOUNDED_TOOL_OBSERVATIONS_V1.md),
[website failure](MVP_LOCAL_WEBSITE_REPAIR_REPORT.md),
[completion audit](MVP_COMPLETION_AUDIT.md),
BL-20260913-2055-bounded-tool-observations-approved.
