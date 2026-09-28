# General-task request diagnostics and artifact iteration

Status: **Approved for implementation, bounded regression checks and two new
conditional artifact attempts**, under the owner's continuing MVP instruction.
This supersedes the unconsumed deck allowance in the first artifact plan. Its
website attempt is closed incomplete; neither original task is resumed or retried
under its old admission.

## Observed problem and change

The first website task made three short successful local requests, then its
fourth request ended with an unknown outcome. It produced no output. Timing is
consistent with the desktop's hard 45-second cap; the receipt does not prove the
exact cause. Treat this as an incomplete execution, not a model-quality failure.

The general controller currently caps the configured request timeout at 45
seconds even though configuration defaults to 300 seconds and the broker already
supports that ceiling. Honor the configured timeout up to 300 seconds, while the
same task keeps its fifteen-minute deadline, twenty-model/thirty-tool ceilings,
zero local API fees and cancellation/no-replay behavior. Do not raise output
tokens or change thinking/model/provider to hide the failure.

Record a small fixed diagnostic code and elapsed request time for unknown
outcomes: own request timeout, cancellation, HTTP rejection, oversized/failed
transport, or invalid response/fee settlement. Store no exception messages,
provider bodies, credentials, endpoints or source content. Old unknown receipts
remain readable without a guessed cause. Surface the safe cause in the task's
failure explanation; all unknown outcomes still block subsequent dispatch.

## Verification and new attempts

Test actual controlled HTTP timeout/cancellation, failed response/settlement and
no-replay behavior, including retention through store reopening. Check the
controller honors configuration within broker bounds and rejects runtime drift
on resume. Run the focused existing broker/controller/session tests, typecheck,
normal build and four desktop regression scenarios with scripted receivers. The
public-research regression may use its same three synthetic exact source URLs
and single failure URL with the same explicit resolver; no real cloud model or
private source is involved. Keep any failure and correct its specific cause in
a separately recorded run.

After regression success, freeze new app/driver/configuration identities and the
same independently qualified website/deck goals and evaluators. Admit at most one
new website attempt and one new deck attempt, separately, with twenty local model
calls, thirty tools, fifteen minutes and zero public GETs/API fees each. Configure
the request timeout to 300 seconds, bounded by the remaining task deadline.
These are explicitly labelled development iterations, not fresh held-out tasks
or erased failures. No same-job replay, automatic replacement, post-evaluation
candidate repair, cloud fallback or unbounded retry.

The deck remains conditional on corrected native-object checker/fixture
qualification, original LibreOffice rendering and copy-based native API editing
with embedded-workbook checks. Preserve the malformed first control and the
observed LibreOffice workbook-loss limitation. Do not demand unchanged worksheet
names/addresses where the task requires preserved semantic data; do not repair
library output to claim unobserved compatibility.

Independent artifact/content/visual acceptance and exact export/accounting/input/
cleanup joins remain required. Any new uncertain operation stops and retains its
diagnostic; reaching the larger cap does not grant another request. Real-private
qualification, actual cloud routing, economics and release remain open.

References: [first artifact plan](MVP_DESKTOP_ARTIFACT_DELIVERY_V1.md),
[completion audit](../MVP_COMPLETION_AUDIT.md).
