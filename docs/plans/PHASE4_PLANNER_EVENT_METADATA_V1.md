# Planner validation metadata in host audit events

Status: **Proposed, deferred after owner priority correction; no implementation or new model-call authority.**
The owner directed work back to completing H4 and H5. This optional observation
proposal is not a prerequisite for that goal, and its pending CPU-only approval
request is withdrawn as the next step. See BL-20261101-0224-h4-h5-priority-restored.
Prepared after BL-20261101-0208: the metadata diagnostic completed after nine
zero-fee requests and a valid first plan, without reproducing either earlier H4
planning rejection.

## Recommended change

Add an explicit opt-in, `planReplyMetadata: "finite_v1"`, for the actual research
pipeline and bind that choice in session identity and the run freeze. Capture
fixed validation metadata at the existing planner decision and persist it in the
one existing `research_stage` event for `stage: "plan"`. This supplies evidence
from the actual H4 attempt rather than another separately regenerated diagnostic.
It is an observation change, not a demonstrated cure for invalid plans.

The implementation would touch the research/session types, pipeline metadata
projection, harness option/freeze plumbing and focused tests. Keep the normal
default off. Do not introduce a general observer framework, substitute the full
H4 driver or monkeypatch model prototypes.

For each of at most two completed planner replies, record:

- Ordinal and fixed finish category: stop, length, tool_calls, content_filter,
  other or missing.
- Numeric input/output/cache usage with explicit production-normalized
  provenance; absent native reasoning/cache provenance remains unavailable.
- Final-content and separate reasoning byte counts, never reasoning-token
  estimates.
- `valid`, `json_no_object`, `json_syntax` or `schema`, plus at most three
  allowlisted issue-code/schema-path pairs. Array indices map to `[]`; unknown
  paths map to `$`.

Retain no reply/reasoning text, prompt, gist, model-provided key/value, parser
exception or validation message in those observations. Project the existing
parser/schema decision; leave the existing retry-feedback bytes untouched.
Missing/invalid telemetry must not silently become a successful evidence check.

## Keep diagnostics out of model inputs

`ResearchStageCounts` also feeds `ResearchSummary.stages`, serialized into
`context/research/summary.json`. That file is transferred to the writer. Adding
observations directly to `planCounts` would therefore change model-visible
inputs and defeat the proposed comparison.

Keep plain counts in the pipeline's `stages` array and returned summary. Enrich
only a cloned plan-stage object passed to the existing `input.record` callback;
the session already persists that host event. Emit the aggregate stage event
exactly once. Do not add observations to outcome files, transfer snapshots,
writer instructions or cloud packets.

Keep all model request construction, sampling/thinking, 8192 planner output
limit, existing two-call validation policy, acceptance/filtering rules and stage
budgets unchanged. A length-finished reply that passes the current schema remains
accepted. This change does not alter the service or repeat Claude calibration.

## Evidence association and limits

The current model return exposes finish, usage and native reasoning-byte
metadata, but not receipt/body identity. For this minimal revision, an independent
closed-run reviewer joins the ordered observations to settled planner receipts
using the exact job, context and purpose, requiring unambiguous ordering and
equal cardinality. For local planner dispatches, require the exact local-token
admission proof and its body hash. For split Claude planner dispatches, retain
the existing cloud approval, destination and fee bindings; no local tokenizer
proof is invented. Available receipt response hashes remain authoritative;
a packet hash must never be labelled a request-body hash. If the implementation
cannot prove that join, stop and revise this design before live work. Do not
silently add a weaker match or more production plumbing.

Denial, cancellation and UNKNOWN remain distinct from a completed invalid
reply. The observer adds no request, retry or recovery path. Persist both
completed invalid observations on the ordinary plan-rejection path.

A stage-end event cannot guarantee observation survival if the process dies
before that event. Record this limitation; per-reply crash durability would
require a separate journal/event design. No raw-text retention is proposed.

## CPU acceptance before any live proposal

1. Telemetry off/on produces identical request bodies, retry feedback, call
   sequence, protocol hash, return status/reason, outcome-file bytes, summaries
   and writer seed/transfer snapshots on the same synthetic replies.
2. First-valid, invalid-then-valid, two-invalid and length-with-valid-JSON cases
   preserve existing behavior and call counts.
3. Empty/no-object, syntax, duplicate-ID, unknown-key and schema-bound cases emit
   only the finite metadata; sentinel private text and arbitrary key names never
   reach events or reports.
4. The plan aggregate event occurs once. Denial, cancellation, UNKNOWN and event
   persistence failure add no replay or extra dispatch. Closed receipt joins fail
   when order, cardinality, identity or settlement differs, or the applicable local
   admission proof / cloud approval, destination and fee binding is invalid.
5. Legacy telemetry-off runs keep their existing event/file behavior. Local,
   split and cloud fixtures expose no new raw content; unavailable fields and
   normalized usage are labelled accurately.

Run appropriate typechecks, targeted regression tests, full required CI and
independent evidence/privacy review. Freeze the exact reviewed implementation
before requesting a new live run.

## Runtime identity and subsequent H4 gate

This changes the runtime source digest and the versioned persisted event contract.
Do not continue labelling it as the earlier runtime merely because wire requests
match in CPU tests. Record a new source/option/event-contract identity, regenerate
all affected run and eight-role pins, and verify model/service/profile identities
against the qualified deployment. The protocol hash is expected to stay unchanged
only if the actual implementation and equivalence tests demonstrate that.

Propose an explicit comparability bridge: retain the existing deployment
qualification as evidence for the unchanged serving/model contract, add the CPU
request/output equivalence proofs for this observation revision, and perform
**three fresh H4 loops under the new runtime**. Keep the old deck pass and both
research rejections as historical results; do not silently compose them into the
new batch. Reusing the old deck would require a separate mixed-runtime decision.

No standalone probe or regenerated diagnostic is proposed. The future live
request would be exactly one new three-loop H4 batch in its fixed order, with no
replacement attempts and the shared USD 0.60 split-calibration cap. Its exact
per-loop limits, new single-use claim, source/role pins, current readiness and
eligible start window must be concrete before approval and launch. Existing
claims, the unused diagnostic slot and unused money cannot authorize it. Do not
infer an extension of the current 2026-11-01 10:00 UTC new-start cutoff.

H5 keeps its existing conditional permission, but remains ineligible until the
new H4 mechanics and usable split semantics pass. It needs compatible new pins
and an eligible start record; the old authority cannot be silently relabelled.

## Next decision

This design is deferred. If revisited, review it for CPU-only implementation. That decision
would authorize preparing and testing the change, not any model call, service
change, H4 batch or H5 start. Present the verified implementation and exact
new-runtime H4 authority separately before requesting live execution.

References: BL-20261101-0208-planner-metadata-diagnostic-result;
[closed diagnostic](PHASE4_FLASH_NEXT_PLANNER_METADATA_DIAGNOSTIC_V1.md);
[H4 recovery history](PHASE4_FLASH_NEXT_H4_RECOVERY_V1.md);
[migration controls](PHASE4_FLASH_NEXT_MIGRATION_V1.md).
