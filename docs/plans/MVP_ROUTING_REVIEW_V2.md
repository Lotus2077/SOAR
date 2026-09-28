# Mandatory cloud review experiment

Status: Approved for implementation and bounded evaluation by the owner's active
goal to pursue measured savings while preserving quality. The original failed
comparison and its runtime archive remain unchanged.

## Decision and hypothesis

The first six attempted P tasks produced four acceptable patches versus six for
prepared cloud. One patch silently broke valid keyword forwarding; another lost
fractional date delays. Both were locally submitted after passing narrow visible
checks, so the existing difficulty-triggered escalation never ran.

Add the distinct experimental policy `cloud_plan_local_review`. It retains one
cloud plan, then local implementation, but requires a fresh cloud phase to review
and optionally repair every local candidate. It reuses the existing artifact
handoff, admitted cloud agent, sandbox and final verification. The cloud agent can
inspect the entire workspace when prompt excerpts are insufficient. A cloud
submission is a model action, not independent quality certification.

Prefer this small existing-path experiment before building another model-verdict
protocol or a trained router. If repeated cloud inspection erases savings, measure
that failure before deciding whether a one-request structured review is justified.

## Runtime requirements

- Preserve the existing `cloud_plan_local` policy and original four-arm mapping.
- A fresh-checked local submit under the new policy is provisional: checkpoint
  `review_required`, followed by the existing single cloud handoff. It cannot emit
  an accepted local submission or bypass main-process admission.
- Existing difficulty checkpoints may also hand off once. All final submissions
  under this policy require that admitted cloud phase. There is no return to local.
- Before another local request, preserve time for that request, its visible check,
  a cloud request and final verification. At the current bounds this is 360 seconds;
  insufficient local allowance triggers `review_time_reserve`, not silent acceptance.
  Cloud still observes ordinary admission and remaining-time checks.
- Retain 40 total model calls, 600 seconds, USD 3 per episode, 24 local calls,
  the last two local calls reserved for finishing, and at most one cloud handoff.
  Unknown outcomes, protocol failure and cancellation stop; they do not trigger
  paid recovery. The review phase may still exhaust its budget and fail.
- Review sees the task, actual patch/workspace, visible-check receipt and ordinary
  command evidence. It must assess compatibility and added-test failures rather
  than equating a visible pass with correctness. Hidden oracles, references and
  independent verdicts never enter solver/reviewer inputs.

## Evaluation and budget

The unused original suffix is retired before runtime edits. Its approved authority,
all 24 unrun dispositions and original provider failure remain preserved. No
continuation is dispatched. This changes the next action in response to measured
failure; it does not replace the failed screen with a passing result.

Reallocate up to USD 18 of the retired suffix allowance to at most six exposed
development episodes at USD 3 each. Retain the previously allocated USD 24 for
four fresh paired cloud/selected-policy confirmation tasks (eight episodes). All
new exposure, prior USD 2.691900 known fees and unresolved reservations remain
inside the existing USD 150 total stage ceiling. No new provider or private source
is authorized. Every live batch needs its own frozen configuration, task identity,
one-use claims and readiness receipt after runtime verification.

First verify the new transitions, source freshness, one-handoff enforcement,
cancellation/unknown handling, admission reserve and app representation using
synthetic, Docker and Electron tests. Use exposed failed tasks and available
same-task controls to measure repair benefit and extra cloud fees; these runs are
development evidence, never fresh confirmation. If the local server remains down,
implementation and fixture verification can continue, but live policy evidence
remains blocked.

Freeze a single candidate before the four prepared fresh tasks. Count every attempt,
planner/review/repair request, failed patch and unknown. Require no fewer accepted
tasks than cloud, no extra paired material regression, at least 20 percent lower
API cost per acceptable patch and at most 25 percent median slowdown. A four-task
confirmation is a limited MVP signal; it cannot establish population-level quality
equivalence or device payback. Do not advance a failing policy to the default.

References: [interrupted results](../MVP_ROUTING_SCREEN_REPORT.md),
[original authority](MVP_ROUTING_V1.md), [build log](../BUILD_LOG.md).
