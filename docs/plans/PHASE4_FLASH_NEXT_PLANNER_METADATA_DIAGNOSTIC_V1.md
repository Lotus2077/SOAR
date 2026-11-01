# Flash-Next planner validation metadata diagnostic

Status: **Approved; implementation CPU-verified and hold released; final launch checks pending.**
Prepared 2026-11-01 after the permitted H4 recovery failed.

The next useful evidence is the planner's validation category for each reply.
The original and recovery local H4 attempts both failed planning. In the recovery,
both replies were invalid and one was length-truncated. Its records do not retain
per-reply finish reason, usage, byte counts or JSON/schema category. A longer
output allowance therefore cannot yet explain or fix the non-length failure.

This proposal adds observation in a separate ignored diagnostic wrapper. It keeps
the production runtime, prompts, parser/schema, retries, model, service and every
local role unchanged. It does not propose another H4 attempt.

## Approved bounded scope

| Item | Limit |
| --- | --- |
| Task | The same already-exposed research task, with original job/brief/corpus hashes |
| Local generation | At most eight index calls and two planner calls; ten total |
| Output reservations | Index: 1536 each; planner: 8192 each; at most 28672 summed |
| Fees | USD 0; no cloud call |
| Duration | One interval of at most 45 minutes, wholly before 18:00 Asia/Shanghai on 2026-11-01 |
| Retry | Stop at the first valid plan; second planner call only for the existing validation retry; no transport or whole-diagnostic replay |
| Stop boundary | Synchronously at the existing plan-stage record, before extraction, synthesis, writer, critic or judge |
| Later evaluation | No H4 replay, split calibration or H5 start granted |

The owner replied "approve" to this specific scope; see
BL-20261101-0139-planner-metadata-diagnostic-approved. Approval is not runtime
completion or a production fix.

This is a **new allocation**. The completed 24-request qualification, ten-request
planner diagnostic and consumed H4 recovery cannot supply it. Unused split money
is not dispatch permission. If approval or preparation leaves too little time,
do not start outside the current window or infer an extension.

A two-planner-call replay using the recovery's index is unavailable: the failed
pipeline returned before checkpoint save, leaving no persisted index or transfer
snapshot. Request/response hashes cannot reconstruct that input. The proposed
eight index calls build a fresh index under the same frozen controls; its gists
and planner bodies can differ. These would be new observations, never a
reconstruction of the missing original replies.

## Evidence retained

For each of at most two planner attempts, retain only:

- Ordinal and a finite finish category: stop, length, tool_calls, content_filter,
  other or missing.
- Numeric input/output/cache usage; final-content bytes and reasoning bytes, or
  explicit unavailable values where the provider does not expose a field.
- Actual admitted request-body hash, settled response hash and exact admission
  proof binding.
- Validation category: valid, json_no_object, json_syntax or schema.
- At most three allowlisted issue-code/schema-path pairs. Array indices become
  `[]`; unknown paths map to `$`. Unknown key names, rejected values and error
  messages are never retained.

No final text, reasoning text, prompts, index gists, corpus text or raw transport
body is saved or printed. Do not invoke the earlier diagnostic's private-final
file adapter. Transient classification uses the production outermost-brace
parser and strict schema, without adding a stricter JSON rule or relaxing one.
A length-truncated response that satisfies the current schema retains the
current acceptance semantics; the diagnostic must not change that decision.
Unknown source IDs retain their existing filtering/counting behavior.

## Preparation and single-use execution

Reuse the existing ignored diagnostic core's settled-reply observation, safe
classifier, receipt/admission join and synchronous plan-boundary stop. Create a
new held wrapper and output directory; preserve all earlier files, authorities,
claims, failures and diagnostic results unchanged. Keep the production runtime
and research protocol hashes fixed.

The new authority must bind the reviewed held/released wrapper, clean commit and
CI, current qualified deployment/eight roles/token policy, actual failed recovery
and root adjudication, exact owner decision and the limits above. A durable
exclusive claim anchored to this recovery failure must prevent a copied output
directory or new authority hash from resetting the allowance. Admission,
transport, persistence, UNKNOWN, fee, identity, cancellation or deadline failure
stops without replacement calls.

Before release, independently review the exact code and run CPU tests proving:

1. Empty/no-object, JSON syntax and schema failures produce safe finite categories;
   duplicate IDs, unknown keys and bounds are covered without retaining values.
2. Production parse/validation and request construction remain identical,
   including surrounding prose, length-plus-valid JSON, existing retry feedback
   and source-ID filtering.
3. Every observation joins exactly one settled receipt and mandatory exact-token
   admission proof. Bad settlement, drift, fee or output reservations stop before
   another dispatch.
4. Both valid-plan and two-invalid-plan outcomes stop before extraction. No raw
   text file or raw stdout can be produced, including failure paths.
5. Copied authorities/directories cannot replay the stable claim. Supervision,
   signals, deadline and cleanup are bounded and uncertain cleanup stays unknown.

After the owner approves this exact new allocation and those checks pass, root
records approval durably, verifies current host/service/idleness prerequisites,
binds the final authority and launches once under owned process-group supervision.
Retain fresh pre/post idle evidence and reconcile all receipts before interpreting
the result. A drift or proposed behavior change stops for a named decision;
the single-use claim and zero-replay limit remain in force.

## Verified preparation

The new wrapper passed 48 TypeScript and 14 mocked supervisor tests, strict
TypeScript, and independent evidence/privacy reviews. It imports the frozen
core unchanged and retains no reply-text adapter. Review found and corrected a
pending-call cleanup gap at deadline setup before any live use. Provider-reported
cache absence is recorded as unavailable, separately from production-normalized
usage. All prior failures and assets remain unchanged.

The twenty-file held archive and immutable owner approval were preserved. Only
the activation declaration changed; the other nine assets are identical. The
released package passed 46 applicable TypeScript and 14 supervisor tests; its two
held-only assertions remain covered by the held snapshot and actual release-byte
comparison. See BL-20261101-0147-planner-metadata-wrapper-prepared. This is CPU
verification and scoped hold release, not a completed diagnostic or product
release. The final clean commit/CI, concrete authority and current service/idle
checks still precede execution.

## Interpretation and subsequent gate

The diagnostic can classify new replies. It may not reproduce the failure and
cannot recover the missing original response text or prove a production fix.
A valid new reply would not erase either counted H4 rejection.

Use an observed category to propose the smallest targeted change, if needed.
Do not automatically increase output tokens, disable thinking, relax the schema,
alter retry feedback or restart the service. Any later behavior/runtime change
needs its own named design, pins and applicable qualification/comparability review;
the old deck result is not silently relabelled under a changed baseline.

H4 remains unaccepted, and H5 still requires all three accepted logical H4 roles
and usable split semantics under its existing conditional launch permission.
Historical Claude step-0/1 calibration needs no repeat for this local observation.

References: BL-20261101-0134-h4-recovery-plan-rejected;
[recovery result](PHASE4_FLASH_NEXT_H4_RECOVERY_V1.md);
[original diagnostic](PHASE4_FLASH_NEXT_PLANNER_DIAGNOSTIC_V1.md);
[migration controls](PHASE4_FLASH_NEXT_MIGRATION_V1.md).
