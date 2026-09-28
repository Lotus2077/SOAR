# Real consultation preparation and accounting verification

September 14, 2026 local date. **Accounting and session setup implemented;
controlled desktop behavior verified; real consultation diagnostic prepared but not run.**
The full MVP remains incomplete.

## Delivered behavior

An optional default service tier now binds the exact consultant request and price
identity. Missing or mismatched returned tier cannot settle as a successful
standard-price response. Omitting the option preserves legacy request bytes and
price identities. New proposals require durable accounting: validated model,
tier and prompt/completion/cached-token counts saved with the advice and receipt.
After restart the host checks usage bounds and recomputes the integer fee before
continuation. Missing or inconsistent evidence blocks replay and further inference.
Historical unmarked proposals remain readable without invented token counts.

`pnpm check:general-consultant` reports fixed reasons and missing/invalid field
names. It sends no request, reads no credential store and prints no field values.
The [setup guide](MVP_GENERAL_CONSULTANT_SETUP.md) includes a concrete proposed
OpenAI profile and instructions for keeping its key in the same shell. The actual
command reports all ten required fields missing in this process. Computer use
denied access to the prepared Terminal; that does not establish whether another
shell still holds the earlier session key.

## Verification

- **92 application checks passed:** 33 helper/response tests, 49 manager,
  controller and runner tests, and 10 configuration/CLI tests. These cover tier
  mismatch, cached-token arithmetic, SQLite reopen, corrupt/missing usage,
  historical records and missing/invalid session fields.
- **Five pure staged-driver checks passed**, with strict TypeScript and independent
  source review. These do not execute the proposed real task.
- Both application TypeScript checks and the normal production build passed.
- **Four final desktop scenarios passed in 21.099 seconds**, with no skipped or
  flaky cases: exact approval plus restarts, decline, revocation and invalid
  consultant response with no replay. They use the normal app, IPC, controlled
  HTTP receivers and installed offline Docker image.

The final four cases made ten scripted local and two scripted consultant requests:
eleven settled and one deliberately unknown. They settled 64 microdollars and
retained 9,912 microdollars of simulated reservation. All worker claims were
released and owned-container cleanup was checked. No real model, paid API or
public fetch call occurred in these consultation cases.

Runtime verified by these four cases (historical after the request-size fix):
`81045e134ff499efc88ba05a674b1f66309509bf0f356143fde12a6886444a96`.
Pre-run manifest, binding 182 source/build/fixture files:
`fc84939324ca4e6e50381687260ff3ed6367a661798a8078fe4c6fa1e023b69e`.
The earlier eight-case milestone keeps its separate frozen runtime.
An independent read-only audit verified all four ledgers, exact packet/grant,
default-tier usage, fee, response and restart joins, plus all 182 source bindings.
Its receipt SHA-256 is
`6760e83cfb4798e92c98ac32239bf4e24e2648fd9d1097933dca3652204351e5`.

## Prepared diagnostic and unresolved evaluator

The [one-task plan](plans/MVP_GENERAL_CONSULTATION_REAL_TRIAL_V1.md) uses unchanged
copies of the rejected procurement website, original requirements, supplier data
and policy: four inputs totaling 18,201 bytes. Neither model receives evaluator
gold, controls, reference code or expected amounts. The staged adapter uses the
normal desktop and stops at the exact pending proposal. Approval and continuation
are separate, within the original fifteen-minute task deadline and execution
allowances. It cannot predict a packet before the local coordinator requests it,
extend the deadline or silently restart an uncertain request.

The proposed consultant is direct OpenAI `gpt-4.1-2025-04-14`, default tier,
2,048 output tokens, 120-second timeout and at most USD 0.10 for one exact request.
Standard input/cached/output prices are USD 2/0.50/8 per million tokens; official
sources are linked in the plan. This is documented compatibility, not verified
account access or an actual API response.

The copied evaluator now selects the uniquely matching polite live Recommendation
region, allowing an outer section with the same name. It rejects missing or
duplicate polite regions and retains arithmetic, interaction, validation and
responsive checks. Each negative control must exhibit its specific intended
semantic failure with clean terminal evidence; infrastructure failure cannot
masquerade as a successful negative.

The first sixteen-control batch had **fourteen matched controls and two incomplete
tablet captures**. Both affected controls detected their intended faults, then
raised a generic browser Error at the 768-pixel screenshot. One separately
admitted two-control diagnostic completed all views and correctly rejected both
faults, but did not reproduce the screenshot error. The original result remains
unchanged. At that evidence cut the evaluator was not qualified. A subsequent
instrumented batch also matched fourteen of sixteen controls, followed by a
separately admitted resource-observed batch that matched all sixteen. Its exact
checker is now qualified for the bounded website observations in the
[local repair report](MVP_LOCAL_WEBSITE_REPAIR_REPORT.md). All thirty-six control
screenshots and source/result/cleanup bindings were reconciled. No general
rendering or timeout fix is claimed; earlier failures remain recorded.

## Preserved failures and limits

The first current four-case desktop run passed, but manifest creation had failed
on a renamed build chunk and orchestration continued incorrectly. That result is
diagnostic, not pre-bound proof. Current-file enumeration fixed the manifest and
the next four cases passed. The actual package command then exposed an IPC-pipe
failure in the tsx CLI wrapper that module-only tests missed. Switching to
`node --import tsx` made the actual no-network check work. The final package/runtime
was frozen and the four cases above passed again. All three invocations remain
separate; they are not twelve independent task types.

Earlier React worker initialization failures remain unverified. No historical
research/website rejection was repaired or relabeled. No private-data, quality,
savings or release claim follows from these checks.

The prepared consultation operator now references the separately qualified
receipt; five pure checks, strict TypeScript and independent source review pass.
It remains unadmitted. A separate local-only repair ran and failed both workflow
completion and artifact acceptance; it made no consultant request. That result
led to the request-size correction and a changed production runtime. The four
consultation cases above remain evidence for their own frozen build and must not
be relabeled as verification of the new build.

Next for real consultation: configure the explicit session profile, verify the
changed runtime and exact trial bindings, then admit a bounded task and obtain
its concrete packet/fee decision. The local-only failure is useful development
evidence, not held-out or causal evidence of a routing policy's superiority.

References: [consultation milestone](MVP_GENERAL_TASK_CONSULTATION_REPORT.md),
[completion audit](MVP_COMPLETION_AUDIT.md),
[preserved artifact results](MVP_DESKTOP_ARTIFACT_DELIVERY_REPORT.md).
