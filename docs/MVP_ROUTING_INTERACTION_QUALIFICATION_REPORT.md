# Public interaction qualification result

Date: 2026-09-10. Status: **Verified — development coverage qualified**.

The new public-requirement interaction suite detects the rejected local-first
patch while the reference, historical prepared-cloud patch and accepted
planned-local patch pass. This closes a specific coverage gap on the exposed
ordered-build-rules task. It does not establish a reliable routing policy or
preserved-quality savings.

| Artifact | Methods passed / executed | Unique failed methods | Assertion failure reports | Evaluator time |
| --- | ---: | ---: | ---: | ---: |
| Original baseline, retained from V1 | 0 / 12 | 12 | 14 | 603 ms |
| Equivalent reference, V2 | 12 / 12 | 0 | 0 | 733 ms |
| Historical prepared cloud, V2 | 12 / 12 | 0 | 0 | 626 ms |
| Accepted planned local, V2 | 12 / 12 | 0 | 0 | 660 ms |
| Rejected local first, V2 | 8 / 12 | 4 | 5 | 665 ms |

All five observations have verified harness completion and cleanup, with zero
errors or skipped methods. Subtests can produce more assertion reports than
failed methods; the table keeps those counts separate. The four V2 evaluator
durations sum to 2,684 ms. These measure isolated checks, not agent generation
latency or end-to-end policy cost.

The suite was written from the public objective after source review found the
exclusion/escape defect. Its twelve methods cover exclusions with a literal
backslash before either marker, positive escaped markers, ordinary and doubled
backslashes, ordered overrides, one-shot inputs, first-occurrence order and
preservation of input values. They also exercise whitespace/comments, case
sensitivity, whole-path matching, no normalization and empty-input behavior.
The original five-test evaluator remains unchanged. Reference implementation and
gold bodies did not inform this added coverage, and the four untouched tasks
remain reserved.

The first batch, V1, did not complete. It evaluated only the original baseline,
then the production scope checker rejected the reference's ordinary unified-diff
representation before any reference evaluator claim or execution. V1 preparation
had checked model-patch scope but omitted this reference-format preflight. The
runner stopped correctly; no reference behavior or candidate outcome was measured
in V1, and its stopped result and claim remain intact.

The separately approved V2 correction rendered the unchanged reference as a Git
diff. Applying the original and canonical representations to separate copies of
the exact baseline produced identical complete file bytes and executable modes.
This was a mechanical representation correction, not a source repair. V2 checked
all four patch scopes before claiming its batch, reused the exact completed
baseline receipt, and required reference success before evaluating the three
unchanged candidate patches. Neither V1 nor the baseline was rerun.

Preparation passed twenty V1 guard tests, then twenty-six V2 guard and metadata
checks, with scoped strict TypeScript checks. Independent source review cleared
the corrected runner and normalization proof. A separate final audit verified
all 103 frozen bindings, including 87 retained V1 bindings and the 17 original
qualified evaluator bindings; these sets overlap. It also joined each exact
claim, receipt and log, the normalization proof, retained baseline and historical
candidate identities. The evidence archive contains 123 bound files plus the exact
approval entry, with original and archived bytes rechecked.

An early synthetic fixture expected an invalid cleanup receipt to classify as
infrastructure; the fixture was corrected to expect the production schema's
rejection. Two final-audit attempts stopped on audit path/inventory assumptions;
only those audit assumptions were corrected. These failures remain recorded and
changed no runtime artifact, original evaluator or production contract.

No model request, API fee, database write or new run was added. The ledger remains
at **58 runs and 568 requests** with the same before/after digest. Stage maximum
exposure remains USD 15.825576 under the existing accounting convention. The
qualification does not reclassify prior accepted/rejected artifacts, prove
general test completeness, or establish hardware payback, routing quality,
latency benefit, a fresh paired comparison or release.

The result digest is
`ce9a6fdf5a561960e757be1479647900267d8f481abcbb3a1dce34a5d4f32394`;
the independent final audit digest is
`fe3109209d8e1a811a0891fd0daddf112621a2da30d141c552d952dd9cba0734`.
The archive manifest digest is
`2b326bdf212b266d75e94dcc9665ed2c4791a530abe28684a00c2b1a993fee00`.

At this qualification's close, the next proposed step is a separately bounded
two-request critic signal calibration using neutral complete-source inputs.
Input preparation exists; paid dispatch is not yet approved or executed, and no
critic response or repair result exists. Any later use of these interaction tests
as feedback is development input and requires fresh confirmation elsewhere. See
the [proposed critic plan](plans/MVP_POST_DRAFT_CRITIC_CALIBRATION_V1.md),
[V2 correction plan](plans/MVP_ROUTING_INTERACTION_QUALIFICATION_V2.md),
[original qualification plan](plans/MVP_ROUTING_INTERACTION_QUALIFICATION_V1.md),
[local-first rejection](MVP_LOCAL_FIRST_EXECUTION_REPORT.md), and
[planned-local result](MVP_PLANNER_LOCAL_EXECUTION_REPORT.md).
