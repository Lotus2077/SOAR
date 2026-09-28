# Bounded local repair after compact critique

Status: Approved for offline implementation under the continuing owner goal.
Local execution requires a separate verified mechanics and frozen-input gate.

The six completed critiques cost USD 0.491912 and produced four acceptable and
two repair-required verdicts. Only the two flagged candidates get a repair attempt.
The other four retain their exact original patches. This selection follows the
frozen critic output, not hidden tests or independent reviewer findings.

## Repair behavior

Use the existing controller, worker, native model adapter, isolated Docker execution,
visible checks and request ledger. Add a programmatic local-only call limit of eight,
including two finishing calls. The router, parent admission, worker limits and model
instructions must agree on that limit. Existing policy defaults remain unchanged;
the native wire contract retains its 24-call ceiling. Do not add an environment flag,
private worker fork, alternate tool protocol or cloud recovery.

Each seed contains the indexed original public baseline plus the exact original P
patch, committed into a disposable private repository. Its Git seed revision differs
from the original public revision; record both. The repair model receives the public
task, original visible command and exact critic guidance. Independent review findings,
hidden tests and reference solutions are excluded, including the cache keyword issue
that the critic did not explicitly find. The model must satisfy the whole public task.

Retain the original local model, native request profile, input/output limits and
owner-attested zero API token fees. No cloud configuration reaches the repair worker.
Allow at most eight local requests per flagged task, two tasks total, 600 seconds per
episode, the existing command/check deadlines and no retry after an unknown. Stop
new dispatch if a request outcome or cleanup is unresolved. A provider or protocol
failure cannot trigger a cloud call.

## Evidence and acceptance

The ordinary repair run records a truthful incremental patch against its seed commit.
Separately compose that patch with the original P patch against the original baseline.
Verify that the reconstructed final source hash matches the source bound to the
runtime's final checks; retain source modes, allowed-file scope and both revisions.
No host executes repository code during preparation or patch composition. Tests run
inside the existing isolated execution/evaluation environment.

Freeze the two seeds, objectives, critic receipts, runtime/configuration and original
stage database binding. Preserve all prior rows and unknown reservations. Existing
critique accounting carriers did not create containers, so do not fabricate cleanup
evidence for them. New real repair runs must confirm cleanup. Use fresh local model
metadata and pinned runtime/image readiness before each one-use dispatch.

Independently evaluate all six final artifacts, including the four retained originals,
using the frozen task checks and two blind full-patch reviews. Failed or unsubmitted
repairs remain failures. Count all original generation, critique, repair and failed
attempt fees. Six acceptable final candidates and at least 20 percent lower API cost
are needed to qualify for the previously planned fresh paired confirmation. Current
generation-plus-critique cost is USD 0.964592; its 31.98 percent potential saving remains
conditional until acceptance. Hardware and power economics remain unmeasured.

The current stage is development on exposed artifacts. It does not demonstrate
end-to-end routing quality, latency or savings. If it qualifies, integrate and freeze
the complete policy before the four fresh cloud/selected-policy pairs. Preserve the
original no-extra-regression, 20 percent cost and 25 percent median-latency gates.

References: [compact critique](MVP_ROUTING_CRITIC_V1.md),
[routing results](../MVP_ROUTING_SCREEN_REPORT.md), [build log](../BUILD_LOG.md).
