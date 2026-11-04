# API-only Flash-Next experiment continuation

Status: **Approved target change and admission window; implementation, verification
and release are separate.** The owner instructed: “ignore the SSH thing, just use
the new API endpoint for the experiment and all the required vLLM params are
supported”. The owner then confirmed: “November 5, 18:00 Shanghai”.

This continuation evaluates the supplied external API. Its new-admission cutoff
is **November 5, 2026, 10:00 UTC / 18:00 Asia/Shanghai**. The earlier November 4
window expired; this decision supplies the replacement window without resetting
requests, costs, failures or phase claims. Ordinary implementation and independent
review of this approved change do not require another owner approval.

## Target and evidence boundary

Pin the private API destination by hash, its advertised `RM-01 VLM` model alias,
262144-token context, observed serving version, API schema, client request
settings and all eight local roles, including the judge. Preserve the exact
endpoint and operational records privately. Obtain fresh API metadata at release
and enforce the existing freshness and idle checks before dispatch.

The owner's statement that the required vLLM parameters are supported is an
**owner attestation**, not proof that every parameter is applied as intended.
Schema support and metadata are **API observations**. Actual qualification
responses establish the tested tool, reasoning, cache, token-admission and
performance behavior. Keep these evidence classes distinct in every acceptance.

The API does not establish the server's image digest, checkpoint byte hashes,
launch arguments, hardware identity, conversion results, exclusive GPU lease or
on-host numerical validation. Record these as **unobserved under API-only access**;
never copy old physical proofs or mark those checks passed for this target.
Historical deployment and numerical evidence remains historical.

SSH mapping, the old host's disk floor, service restoration, lease acquisition
and recovery are not admission gates for this external API. This decision does
not request changes to that host. Preserve its prior refusal, stopped-service
evidence and all previous plans unchanged.

## API-native admission and provenance

Create new source, authority and phase namespaces for this target. Bind the
approved decision and cutoff to the exact reviewed runtime, API observer,
tokenizer helper, role pins, request fixtures and downstream admission sources.
The owner record must not depend on future successful observations or reports.
Root releases bind those actual records after verification.

Use the API's native chat-tokenization route to count the exact serialized model
input, including messages, tool schemas, role-specific template options and
generation-prompt behavior. Pin the schema and helper configuration. The proof
must identify remote tokenization honestly; it must not claim a locally inspected
tokenizer or template digest. Require the existing context/output/safety checks
and actual usage parity, including the F2/F3 native-context admission policy.
Any unsupported or ambiguous required field stops release or qualification.

Retain streaming, native tool history, separated reasoning, cache controls,
sampling, output limits and retry behavior for every role. Client retries remain
disabled. Preserve the original tool-sandbox image independently of the external
model server; do not invent a server image pin.

The model alias is an explicit target change. Preserve original request hashes
and record the new wire hashes. For historical paired-performance comparison,
permit only the declared model-alias substitution; require every other request
field and workload byte to match the frozen paired fixture. No prompt, tool,
history, sampling or output-limit simplification is permitted.

## Unchanged experiment and accounting

| Stage | Required work and unchanged bounds |
| --- | --- |
| Historical allocation | Retain all four consumed slots, including the failed pre-dispatch slot, and all original ledger rows and claims. |
| Fresh qualification | One complete 16-case run, at most 60 minutes, no old F1 reuse, baseline replay or replacement attempt. |
| Artifact pilot | At most 12 model requests, 12 tool actions, 20 minutes, USD 0 and one attempt. |
| H4 | Three fresh loops in local research → deck → split order; no replacement loops; all-history split cap USD 0.60. |
| H5 | At most 18 rows, USD 21.60 total, USD 3 per cloud row and USD 0.60 per split row; no replacements. |

The aggregate standalone allocation remains **32 zero-fee slots: four historical
plus sixteen qualification plus at most twelve pilot**. The API-only target and
new source version create no additional allowance. Preserve the original global
H4/H5 claim identities and all historical paid and unresolved receipts. No
repeated Claude calibration is authorized by this change.

Run all sixteen original compatibility contracts. F15 alone may have its
predeclared UNKNOWN cancellation outcome; retain it unresolved. Require the six
healthy/idle API observations at twenty-second start intervals before the sole
F16 recovery. Stop on the first other failure or unresolved outcome.

Keep both cold-cache performance pairs, explicit zero cached-input tokens and at
least 512 completed output tokens per sample. Require neither candidate pair to
be slower, combined full-request throughput at least 1.5 times the retained
baseline and combined decode throughput at least 30 tokens/second. Report this
as comparison across the approved API target change, not proof of identical
server internals.

Only accepted qualification and performance admit the existing artifact pilot.
Require a substantive report artifact by four completed turns or five minutes,
whichever comes first; retain its bytes, hash and timestamp and perform content
review. Final pilot success requires the original artifact/claims checks and
**at most 20,000 completed output tokens**. The token threshold is a success
criterion, not an enforced cumulative output reservation. The pilot gives no
H4 credit and adds no research, critic or judge calls.

Only accepted qualification and pilot evidence admit H4. Preserve normal Heavy
research, critic, repair, selection, entailment and artifact checks, all six
historical H4 attempts and four unresolved receipts. H5 remains conditional on
all three accepted H4 loops and usable Claude split semantics. Retain independent
blind scoring and isolation of fresh H5 inputs, candidates and evaluator gold
from implementation and qualification work.

## Implementation and release

Prepare and independently review the API-native admission path, source closure,
synthetic failure tests and ledger reconciliation before dispatch. Keep source
templates held until the corresponding actual observations and accepted records
exist. A passing offline test is not a live qualification or release result.
Do not fabricate compatibility records to satisfy old physical-deployment types.

Root may release the already-approved stages when their actual gates pass,
without a further routine approval request. Every new qualification/pilot
dispatch and H4-loop/H5-row admission must precede the fixed cutoff. Preserve
the existing per-phase/per-row limits and permitted closure of already admitted
work. An expired window supplies no automatic extension.

On a failed or drifting API contract, preserve the result and stop the affected
sequence. An externally managed server offers no agent-managed repair or
replacement attempt under this plan. Report what failed and what remains before
any proposed change.

References: [fixture-admission retry](PHASE4_FAST_V3_FIXTURE_ADMISSION_RETRY_V1.md),
[preserved disk-continuation proposal](PHASE4_FIXTURE_RETRY_DISK_PREFLIGHT_CONTINUATION_V1.md)
and the append-only approval and implementation entries in `docs/BUILD_LOG.md`.
