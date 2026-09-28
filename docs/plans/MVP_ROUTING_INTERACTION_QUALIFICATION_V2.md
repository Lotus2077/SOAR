# Reference-format correction and remaining qualification

Status: Approved under the continuing routing MVP goal. Exact reviewed preparation,
runner, source and approval hashes are required before four bounded evaluations.
There is no model-call authority and no production policy change.

The preceding batch is closed after one baseline evaluation. All twelve methods
failed as expected, with fourteen failure reports, no errors/skips and confirmed
cleanup. The reference never ran: its ordinary unified-diff representation was
rejected by the product's stricter Git-diff scope parser before a reference claim
or evaluator invocation. The remaining three model artifacts also did not run.
Preserve that incomplete result and its original source/ledger bindings.

Mechanically convert the exact existing reference patch to Git-diff representation
in a disposable private staging repository. Execute no candidate/reference Python
on the host. Preserve the original patch bytes. Prove that applying either
representation to the same original baseline yields identical complete file bytes,
modes and source identity. Require both representations to change only the same
three allowed implementation paths; validate the canonical patch with the unchanged
production scope parser. No reference behavior or suite expectation may change.

Reuse the original completed baseline receipt and log as the negative control,
bound to its exact suite, source, image, expected test count and cleanup evidence.
Keep the same twelve-method suite and its SHA-256 unchanged. Create a new one-use
batch for only the four previously unevaluated artifacts: canonical reference,
prepared cloud, planned-local and local-first. This does not resume the old batch
or rerun the completed baseline.

Before claiming the batch, validate scope and identity for all four patches and
the reference equivalence proof. Freeze exact invocations, original result/receipts,
the complete ledger, source files, suite, helper and runner. Require independent
review and an exact root gate tied to the new build-log approval entry. Preserve
all prior model artifacts and classifications.

Run each artifact once, sequentially, using the same pinned network-disabled
Docker evaluator and bounds: 180-second evaluation timeout and 45-second cleanup
grace. The reference must pass all twelve methods with no errors/skips before
model-artifact evaluations begin. Unexpected control results, incomplete harness,
scope/input drift, cancellation or unconfirmed cleanup stop remaining work without
retry. Complete semantic failures among the three model artifacts remain recorded
and permit the remaining evaluations.

A complete result joins one reused baseline evaluation and four new evaluations,
with their distinct batch identities and full failure history. It qualifies exposed
public-requirement development checks only. It cannot replace the original frozen
five-test evaluator, count as a repair, prove routing quality, or authorize the
proposed paid critic calibration by itself.

References: [closed first qualification plan](MVP_ROUTING_INTERACTION_QUALIFICATION_V1.md),
[proposed critic calibration](MVP_POST_DRAFT_CRITIC_CALIBRATION_V1.md),
[local-first rejection](../MVP_LOCAL_FIRST_EXECUTION_REPORT.md),
[build log](../BUILD_LOG.md).
