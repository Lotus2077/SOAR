# Draft-first writer completion policy

Status: **Approved for the exact policy implementation and conditional three-loop H4 allocation. Exact paragraph implemented; required CI and CPU package checks pass. Execution is held on actual serving drift; H4 remains unaccepted.**

BL-20261101-1838-writer-completion-approved records the owner decision.
BL-20261101-1848-writer-completion-implemented records the exact implementation
and CPU evidence. BL-20261101-1849-writer-completion-prepared-serving-held
records successful source CI and the actual serving blocker: the qualified
container is absent, its owned unit failed, and the responding API lacks required
health/version/context metadata. The fresh H4 allocation remains unconsumed.
Restoration requires the pending service decision and explicit verification of
new physical identities under unchanged serving semantics. The runtime is now `13dcb2ceb0e0a6a76677dbdd033df507d9375348dc37a75a0c8827d45b452e6c`;
the research protocol remains unchanged. Both writer layouts change their
prompt/protocol identity. Actual serving readiness and H4 evidence remain before acceptance. The
approved plan bytes remain preserved at their original proposal commit; current
status updates do not change that decision or extend its limits.

The corrected runtime stopped the latest H4 sample at its shared 90-minute
deadline and did not begin sample b. The writer saw truthful decreasing budgets:
about 67 minutes on entry and 6.5 minutes on its final request. It completed
44 actions: 39 executions, four observation reads and one unsupported action.
All ten inspected final executions succeeded, produced no stderr and left the
workspace unchanged. All 45 captured checkpoints lacked requested output files,
despite 18 missing-artifact reminders. One non-output text intermediate was added.
This supports a writer execution-policy change; it does not demonstrate another
tool, transport, parser or time-accounting defect. Uncaptured changes after the
last completed action remain unknown.

## Minimal proposed change

Replace only the paragraph beginning “Batch related input inspection” in
`systemPrompt()` in `src/main/private-agent/runner.ts` (currently line 149) with
the following task-independent text:

> Inspect the task contract and the minimum provided evidence needed for a supported draft, then save a usable first draft at the exact required artifact paths before broad analysis or repeated source inspection. When a transferred research packet is present, build that draft from its argument and evidence under the existing packet instructions; do not repeat the reading stage. Write supported findings as real content. Where evidence is missing or conflicting, state the specific limitation honestly; do not fill gaps with invented facts, citations, results or placeholder text. Use write_file, append_file and str_replace for short incremental text writes, and execute for generation and checks. Once the draft is saved, inspect specific unresolved points, verify the actual outputs and repair them within the remaining allowance. File presence is not correctness or acceptance. Reserve time for finish and host checks. Preserve useful incomplete work if the task cannot finish.

Keep the initial concise-planning instruction, available tools, tool schemas,
budget messages, observation projection, progress counters and all host checks
unchanged. Do not introduce a forced tool choice, new phase, time-based stop,
observer, telemetry event or automatic extra call. This changes the priority and
sequence requested of the writer; it does not force model compliance.

The existing `contract.requiredArtifacts` paths and descriptions remain the
source of deliverables. For research, `researchTransferPhase()` supplies the
same immutable packet and integrity check to a, b and repair.
`researchWriteInstructions()` remains unchanged: packet quotes and source IDs
must be copied exactly into the claims ledger; verified quote existence does not
establish truth or entailment. Drafting must not manufacture claims to satisfy a
count or hide an evidence gap. Honest incomplete findings may remain unaccepted
by the unchanged task and claims checks. A draft is progress, never acceptance.

Apply the same writer paragraph to every comparable arm and stage, including
local, cloud and split writers and their critic-directed repair. The conditional
packet instruction applies only when a packet exists. Do not add task-specific
hints, inspect fresh H5 inputs/gold, inject a diagnostic plan or reuse another
loop's packet. Critic, judge, selector and research-stage prompts remain unchanged.

## CPU implementation and comparability gate

The owner approved this named policy implementation and the conditional
three-loop H4 allocation below. The exact decision is durably recorded before
gated work begins. Review of the implemented bytes, CPU checks,
clean CI, pins and readiness are execution gates under that decision, not another
generic approval question. Focused checks must establish:

- The exact paragraph occurs in both supported writer layouts and the actual
  model request, with the current budget still in its recorded layout position.
- Local/cloud/split writer construction and repair use the same policy, while
  packet transfer instructions, source digests, required artifact paths and
  critical checks remain unchanged.
- A synthetic writer can save real draft files incrementally, receive failed
  host validation, repair and finish within existing allowances; incomplete or
  unsupported contents do not bypass claims, artifact or transfer checks.
- The deadline clamp and unresolved/failed-dispatch stage stop retain their
  existing regression coverage. Run the required typechecks, project checks,
  independent diff review and both CI jobs on the final clean source.

These checks prove request construction, unchanged authority/checks and the
existing execution path. Mock compliance cannot prove that Flash-Next will follow
the instruction, produce accurate artifacts or finish in time. The previous
prompt already requested early incremental writes, so this is a bounded
functional hypothesis, not a proven completion cure.

Recompute the runtime, writer protocol/layout and affected role pins. Writer
request bytes change; do not claim wire equivalence or retain the old protocol
hash merely because tools and research settings are unchanged. Determine the
actual research-protocol identity rather than assuming it changes. Preserve old
qualification and results under their old identities. Any qualification bridge
must explicitly review the narrow prompt diff and unchanged service/provider,
token-admission, model, sampling/thinking, context and request limits. It must not
claim new live service qualification from CPU tests.

## Approved implementation and conditional execution decision

The consumed allocation grants no replacement. The recorded owner
decision authorizes this named implementation plus **exactly three fresh
H4 loops**, conditional on independent implementation review, passing CPU checks
and clean CI, new pins and current prerequisites. The order is local research,
then deck only if local passes, then the first split loop only if both pass.
Bind the immutable decision to the subsequently reviewed exact held/released
assets without rewriting it. Use the reviewed single-use, failure-anchored
execution path; no replacement or further failed-loop replay is included. Each
research loop makes its own sample-a packet, reused only by that loop's b and
repair. If a gate fails or the eligible start window expires, do not execute or
infer a replacement or extension. No second generic launch approval is required
when the exact approved conditions pass.

Keep every existing per-stage request, output, elapsed, tool, selection and repair
limit. Keep the **single all-history USD 0.60 H4 split ceiling**, with no new paid
allowance or repeat of accepted Claude steps 0/1. Preserve all five prior attempts,
their negative results, unresolved receipts and consumed claims separately. All
three accepted logical loops must use the common new writer/runtime pins;
historical deck evidence cannot fill a new-policy row. No standalone diagnostic
or extra service probe is part of this proposed allocation.

H5 remains conditional on actual H4 mechanics and usable split plan/citation
semantics. Its existing eighteen-row scope, USD 21.60 total ceiling, USD 3 cloud
row and USD 0.60 split row caps, zero replacements and independent blind scoring
remain unchanged. The approved new-start cutoff remains **2026-11-02 10:00 UTC
(18:00 Asia/Shanghai)** for H4 and conditional H5. Admitted rows retain their
existing limits and closure rules; no extension is inferred if preparation or
execution exhausts the window. Approval still requires an exact authority, claim and pinned readiness before
execution; it does not authorize implementers to read fresh H5 material.

References: [runner controls and latest outcome](PHASE4_LOOP_DISPATCH_STOP_V1.md),
[Flash-Next migration](PHASE4_FLASH_NEXT_MIGRATION_V1.md),
BL-20261101-1106-h4-runner-fixes-stopped.
