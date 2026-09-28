# Planner-contract calibration results

## V2: one accepted plan after the prompt clarification

Date: 2026-09-10. The separately bounded V2 probe produced **one accepted plan
with nine explicit regression tests**, using one planner request at an accounted
API cost of **USD 0.061024**. It stopped before local coding, test execution or
patching, as planned. This resolves admission for this one exposed input; it does
not establish reliable adherence, patch quality or routing savings.

| Measure | V2 result |
| --- | --- |
| Assigned / attempted / unrun | 1 / 1 / 0 |
| Accepted plans | 1 |
| Explicit generated tests | 9, parsed only |
| Settled planner requests | 1 |
| Local / cloud-solver requests | 0 / 0 |
| Accounted API fee | USD 0.061024 |
| New unknown requests / reserved exposure | 0 / USD 0 |
| Terminal duration | 65.265 seconds |
| Cleanup | Confirmed |

The production change adds a complete JSON/unittest example and clarifies that
the configured visible command is host scaffolding, not generated-suite source.
The example deliberately calls self.fail until replaced with task assertions.
Every parser function, artifact schema and limit remains unchanged. The private
wrapper now distinguishes fixed structural conditions at the combined declaration
rule while retaining the original exception. No diagnostic was needed in V2.

The admitted suite replaced the example and contains task-specific assertions for
parsing, escaped markers, exclusion errors, last-match decisions, one-shot inputs,
path semantics, stable deduplication, input preservation and empty cases. Source
inspection found no copied failing placeholder or obvious conflict with the public
objective. These tests were **not executed** and their completeness is unproven.
No prior response, hidden check, reference patch or critique entered the model input.

Usage was 1,341 input and 2,783 output tokens, including 1,693 reasoning tokens.
At the frozen USD 4/20 per million-token rates, the request accounts USD 0.061024;
reasoning is included in output rather than charged again. The run's stored status
is intentionally failed with planner_calibration_complete: this marks a successful
planner-only stop, never a completed coding task. Both launcher and driver exited
zero with no retry. The original V1 rejection and unrun assignment remain closed.

Offline verification passed 19 host parser tests, 12 wrapper tests, nine driver
tests, four launcher tests, two actual controller/HTTP/Python/Docker fixtures and
the private driver typecheck. Independent review cleared the final source. Root
review tightened diagnostic validation to require structural details exactly at
the trusted combined branch. Two preparation-only mistakes remain recorded: the
root hash auditor initially assumed a shared receipt schema, and one freeze
invocation supplied a placeholder hash. Both stopped before dispatch; corrected
checks passed. No inference was retried.

V2 plan SHA-256: 88c860705e4c31f0acf0d0a68a80d70ffd4749f82b9f51efcb8512e6cf99e50d.
Freeze SHA-256: 0aeabd30d245d3f05c670ad558b98257d6c0c1afe9b40a3815cb719dbe38ff6f.
Parser/prompt SHA-256: affdf62243cde679b7bc383261e987258dac68ea0eb3fd25ae26f49eb2a8bf05.
Generated-check source SHA-256: 7e1026584aaf33b0eeba26fba39948d4efaf1484d69295e792f7932cf10d228a.
Fifty-seven frozen source/input/authority files and the exact approval entry are
archived privately. Independent read-only audit verified all 54 frozen file
bindings, the archive, request/event hashes, exact replay and unchanged prior
55 runs and 550 requests. Audit SHA-256 is
b39902181b1260dddee480a748b23c6ef23e219ac1a1d9afe3a99fc12ce35cd4.
Stage maximum exposure is USD 15.748292, including historical unknown exposure
and the original block hold. The two planner probes together account USD 0.130268;
these figures are neither invoices nor all-in device economics. The four untouched
tasks remain reserved.

The next experiment should run one complete cloud-plan/local coding episode with
the clarified prompt on an exposed task, then independently check the resulting
patch and account for all planner, local and fallback work. It needs a separate
bounded execution plan; this planner-only allowance is closed. One successful
response after one failure does not establish that the prompt caused the change.
A fresh comparison at preserved quality is still required before claiming savings.

References: [V2 bounded plan](plans/MVP_PLANNER_CONTRACT_CALIBRATION_V2.md),
[failed C/P comparison](MVP_ROUTING_PUBLIC_CHECKS_DEVELOPMENT_REPORT.md),
[build log](BUILD_LOG.md).

## V1: closed after the first declaration rejection

Date: 2026-09-10. **Stopped on the first contract rejection, as planned.** One
planner call cost USD 0.069244. Ordered build rules was rejected; cache discard
remains unrun. No local or cloud-solver request, check execution or patch followed.
This calibration located the failing parser branch, but did not produce an
accepted plan or establish routing savings.

| Measure | Result |
| --- | --- |
| Assigned tasks | 2 exposed development tasks |
| Attempted / unrun | 1 / 1 |
| Accepted plans | 0 |
| Settled planner requests | 1 |
| New unknown requests / unresolved exposure | 0 / USD 0 |
| Accounted API fee | USD 0.069244 |
| Terminal duration | 67.806 seconds |
| Cleanup | Confirmed |

The request used the same prepared-input SHA-256 as the corresponding earlier
planner attempt. The production prompt, source preparation, parser, model controls
and transport were unchanged. The private wrapper added diagnostics and an
intentional stop after accepted plans; its guard permitted at most one planner
request and prevented local execution. The owned launcher and driver both exited
zero after recording the failed diagnostic episode, without retry.

### What the rejection establishes

The response passed the outer envelope, JSON/schema, plan/source size and Python
syntax checks. Its declared test count was a valid integer within the allowed
range. Declaration validation then raised `planner_checks_declarations` at
the frozen V1 parser branch, line 170 (bound to the parser hash below).
The source-bound call chain is `parse_planner_response:225` →
`_declared_tests:170` → `_fail:70`.

That branch rejects a module-level statement that has not qualified as an import,
literal fixture assignment or allowed function definition, or a class with
decorators, class keywords or a base count other than one. It runs before the
subsequent direct-`unittest.TestCase` base check and final test-count comparison.
The receipt does not distinguish which part of this combined condition failed.
Raw rejected source was deliberately not retained, so no specific construct such
as a top-level conditional, fixture initialization or helper class is established.

The concrete finding is a mismatch between this generated suite and the host's
allowed declaration form. It does not establish a local-model weakness or that
the parser restriction should be removed. Executable-check usefulness and semantic
correctness were not evaluated.

### Cost and evidence

Recorded usage is 1,131 input tokens and 3,236 output tokens, including 1,904
reasoning tokens. At the frozen USD 4 input / USD 20 output per million-token
rates, this accounts USD 0.069244. Reasoning tokens are already included in output
and are not charged twice. This is usage-ledger accounting, not provider invoice
reconciliation. The authorized USD 2 ceiling was not reached; the first-rejection
stop closes further dispatch despite the unused allowance.

The driver closure confirms historical rows, all frozen files and approval evidence
were preserved. The calibration adds one new diagnostic run and changes no old
assignment. Fifty exact source/input/authority files were archived privately for
reproduction. Independent read-only audit confirmed exact replay, usage arithmetic, all 47
frozen file/approval bindings, and preservation of the prior 54 runs and 549
requests. Stage maximum exposure is now USD 15.687268, including historical
unknown exposure and its old block hold; this is not all-time project spending.
Audit SHA-256 is c3d5fa7cac89d17e90c4de59539b2c820dfc74f3a21694160e4879acaf31ec9d.
The four untouched confirmation tasks remain reserved.

Plan SHA-256: 53a881b1cc50e276b54acf2c02f51e13275db63b6c767bd67ab37f4d7b881190.
Freeze SHA-256: 58d65b4918d0acd31fb6132fb2e2025f657f24e912b071f5e209d9fbe2943c0f.
Diagnostic SHA-256: 5bd748b4b7c63155d51f1ccfafe344dc7e1f4d154df5c5e39f7104ed938de5d8.
The diagnostic is bound to parser SHA-256
89dcb42e9b96da2e9fdca11d28c07f9bf73aa3c694900ea02e3c984a5b9a6766.

### Verification and next step

Preparation passed nine wrapper tests, eight driver tests, four launcher tests,
two actual controller/HTTP/Python/Docker fixtures and the private driver typecheck.
Independent reviews cleared the final components after cancellation and frozen
source/authority validation gaps were corrected. Test-only setup/assertion/type
failures remain recorded. This is scoped verification, not a full-repository or
release gate.

The public visible-check command contains path setup and a main guard that would
violate the generated-source contract if copied. That is a plausible source of
prompt confusion, not observed model output. The next proposed change is to label
that command as separate host scaffolding, supply a concrete unittest module
shape, and add more precise fixed diagnostic tags for the combined branch. Verify those offline without relaxing accepted syntax first.
Then a separately bounded one-call probe can test prompt adherence. Do not spend
on another complete C/P comparison until the planner can produce an accepted
artifact. Neither the earlier six failures nor this rejection may be relabeled
by a later change.

References: [approved frozen plan](plans/MVP_PLANNER_CONTRACT_CALIBRATION_V1.md),
[preceding comparison](MVP_ROUTING_PUBLIC_CHECKS_DEVELOPMENT_REPORT.md),
[build log](BUILD_LOG.md).
