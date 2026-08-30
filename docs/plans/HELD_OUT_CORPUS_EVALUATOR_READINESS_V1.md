# Held-out Corpus and Evaluator Readiness v1

Status: **Implemented; deterministic local verification passed; exact-SHA
remote verification pending; not Executed or Released**

- Plan ID: `held-out-corpus-evaluator-readiness-v1-plan-1`
- Approved: 2026-08-30 by the project owner in the project task
- Baseline revision: `b707f4af59d858d06af487073c8af0d99d1f8dbb`
- Approval ledger: `BL-20260830-2050-heldout-readiness-approved`
- Frozen parent protocol: `change-review-eval-v1`
- Project log: [BUILD_LOG.md](../BUILD_LOG.md)

## Problem statement

Local Evaluation Bridge v1 proves that one frozen public change can traverse
the production local-only review path, but it supplies no defect gold and
therefore cannot measure recall, precision, or false accepts. SOAR needs a
trusted offline boundary that can accept an independently sealed held-out set,
keep its gold out of the runtime, require blinded human judgments, and publish
only aggregate evidence before any provider comparison or routing claim is
credible.

The frozen `change-review-eval-v1` protocol already requires at least 24 real
fixtures, 8 clean and 16 faulty, with at least 20 P0/P1 and 8 P2/P3 defects. It
also requires two humans blinded to policy and provider for semantic matching.
Those private inputs and people do not exist in this repository. This milestone
builds and verifies the offline machinery; it does not pretend those missing
inputs have been supplied.

## Target users and user stories

- As an independent corpus curator, I want a strict private oracle format and a
  commitment-bound runner manifest so that I can freeze real cases without
  placing gold in the model workspace or public repository.
- As a blinded adjudicator, I want an identity-minimized judgment packet so that
  I can classify model findings without seeing policy, provider, cost, or other
  adjudicator decisions.
- As an evaluation operator, I want fail-closed validation and deterministic
  aggregate metrics so that blocked, invalid, incomplete, or disputed runs
  cannot disappear from the report.
- As an open-source maintainer, I want a safe public report that proves which
  contracts and counts were evaluated without disclosing fixture identities,
  gold, review prose, local paths, endpoints, or human identities.

## Goals

1. Strictly validate an external 24-fixture runner bundle and separate oracle
   while enforcing the frozen class and severity minimums.
2. Make runner/oracle separation testable: runner-facing contracts contain no
   gold, expected finding, rubric, adjudication, or defect-label field, and the
   evaluator is a separate offline module with no provider/runtime dependency.
3. Require two independent adjudication records with distinct random study IDs
   for every emitted finding plus externally signed coordinator attestations
   that bind both the distinct-human/blinding assertion and a domain-separated
   commitment to each complete judgment. Require a separately signed joint
   resolution for disagreements. Unresolved, rewritten, or missing/invalid
   records keep the report non-scored.
4. Deterministically compute raw counts, valid-review yield, high-severity and
   all-severity recall, finding precision, false accepts, weighted quality,
   Wilson 95% proportion intervals, and seeded bootstrap cost and latency
   intervals only after adjudication is complete.
5. Publish an exclusive, no-replace, tamper-evident, privacy-safe aggregate and
   last-written completion marker that contains no fixture identity, gold,
   finding-level judgment, review prose, endpoint, credential, or absolute
   path.

## Non-goals

- Curating or committing the real held-out fixtures, identities, candidate
  patches, executable witnesses, gold defects, rubrics, or adjudications.
- Running the configured vLLM, a model-list health check, any inference, a
  provider retry, or a live campaign.
- Claiming a held-out quality baseline, quality floor, routing benefit, cloud or
  hybrid parity, cost saving, latency advantage, general code-review quality,
  or release readiness.
- Changing Local Evaluation Bridge v1, its consumed authority, production app
  routing, Electron UI, SQLite/event contracts, tools, or provider selection.
- PR 6, OpenRouter, Keychain, egress consent, paid admission, cloud synthesis,
  hybrid fallback, or the 42-workload campaign.

## Approval boundary

The project owner's instruction to proceed authorizes this deterministic,
offline, `$0` selected-metered-exposure implementation. It does not authorize
contact with the configured vLLM endpoint. The previously consumed
`local-evaluation-bridge-v1-plan-1` authority must remain untouched.

A future provider campaign requires a second committed plan and build-log entry
after an independent curator supplies a frozen private set. That approval must
bind a new campaign ID to the exact implementation SHA, salted set commitment,
ordered fixture slots, evaluator/rubric versions, deployment fingerprint,
provider/model/configuration, aggregate token ceiling, retry policy, and code
egress disclosure.

Before that approval, a trusted preparer must also deterministically materialize
every case and execute each witness to prove the faulty candidate fails and its
correction passes. A witness commitment alone is not evidence of a real,
testable case.

## Private input contracts

### Runner bundle

The external runner bundle is agent-safe and strict. It contains:

- protocol and set versions;
- exactly 24 opaque ordinals and unique fixture commitments;
- immutable snapshot, evidence-packet, prompt/schema, and evidence-limit
  commitments;
- a salted canonical set commitment; and
- no repository identity, revision, path, source, patch, class label, defect,
  severity, rubric, expected finding, witness, or adjudication.

The bundle is policy- and provider-neutral so every future cohort receives the
same committed evidence. It is control-plane input only: it must never be sent
to a model or copied into a model-visible workspace. This milestone validates
the contract but does not execute it. A later trusted preparer may use a richer
private acquisition envelope outside the agent workspace; it is not part of
the public runner contract.

### Commitment derivation

`soar-heldout-commitment-v1` uses UTF-8 canonical JSON with lexicographically
sorted object keys, preserved array order, no insignificant whitespace,
SHA-256, and an evaluator-private salt of exactly 32 random bytes. The digest
is computed over bytes as:

`SHA256(UTF8("soar-heldout-set-v1") || 0x00 || salt || 0x00 || canonical_preimage)`.

The strict canonical preimage contains the policy-neutral ordered runner
commitments, oracle entries, and private witness-freeze records. It explicitly
omits the salt and every derived `setCommitment`, digest, or signature field,
avoiding a self-reference. The salt and canonical preimage are carried only in
evaluator-private commitment material; the runner and public report receive
only the resulting digest. The evaluator recomputes the digest rather than
merely comparing repeated strings. The commitment proves binding and tamper
evidence under this contract. It does not prove independent curation,
correctness, or fixture-identity confidentiality against a party able to guess
the private corpus.

### Run manifest

Policy/provider/deployment data is deliberately outside the corpus commitment.
A separate strict run manifest binds the set commitment to the implementation
SHA, policy, provider and served-model identity, non-secret deployment and
configuration fingerprints, context/tool/round/token limits, one-shot retry
rule, evaluator version, campaign authority, fixed `Ed25519` coordinator
signature algorithm, and a trusted coordinator verification-key fingerprint.
The key fingerprint must be approved before the campaign; a result cannot
supply its own trust anchor, and rotation requires a new manifest and approval.
This milestone validates synthetic manifests only; it creates no live
authority.

### Oracle bundle

The separate evaluator-only oracle binds to the exact runner-set commitment and
contains exactly one entry per fixture commitment. Each entry is either:

- `clean`, with no gold defects; or
- `faulty`, with one or more unique gold defects, each carrying severity P0-P3,
  one or more normalized evidence regions, a semantic rubric, and an executable
  witness commitment.

The complete set must contain exactly 8 clean and 16 faulty fixtures, at least
20 P0/P1 defects, and at least 8 P2/P3 defects. `Clean` means no known defect
under the frozen rubric and witness set, not universal correctness.

Each faulty entry also has a bounded canonical witness-freeze record in the set
preimage. It binds the materialization and command-protocol versions,
environment fingerprint, faulty-candidate nonzero result, corrected-candidate
zero result, bounded stdout/stderr hashes and byte counts, and witness
commitment. The trusted preparer creates this only after deterministic witness
execution. The harness verifies the binding and result contract; it does not
turn a hash into proof that an execution occurred.

### Run results

The evaluator accepts one terminal result for every runner ordinal. Outcomes
are `accepted`, `invalid`, `blocked`, `cancelled`, or `unstarted`. Accepted
results include identity-minimized finding IDs, normalized evidence regions,
conclusion, freshness/coverage facts, usage, latency, cost provenance, and
content hashes. The raw provider envelope and full review remain in private
operator storage and are not needed by the aggregate scorer.

For human semantic matching, the evaluator creates a separate private,
identity-minimized adjudication packet containing each bounded finding's title,
defect claim, impact, proposed correction, test recommendation, evidence
regions, and the corresponding blinded gold rubric/context. A `matched_gold`
disposition is structurally impossible unless deterministic normalized-region
overlap first identifies that gold defect as a candidate. Region overlap alone
is never a semantic match. None of this packet is public.

No outcome may be omitted. Operational yield and outcome populations are always
reported. Semantic metrics are emitted only when every finding in every
accepted result has complete adjudication.

An accepted record must assert at least one dispatched inference, positive
reported input and output usage, usage coverage for every attempt, measured
latency, and non-`no_dispatch` cost provenance. The evaluator verifies the
record's internal consistency and committed envelope; it does not observe the
dispatch or turn an unsigned operator record into execution proof. Conversely,
`no_dispatch` requires zero inference attempts and zero provider usage even
when bounded pre-inference tooling occurred. The aggregate publishes total
inference, reported, and unreported attempt counts so incomplete usage on
non-accepted records remains visible rather than being silently represented as
zero. A future trusted runner must bind these records to retained campaign
execution evidence.
Every terminal record must remain within the manifest's round, successful-tool,
episode-latency, and necessary aggregate per-reported-attempt token ceilings;
violations invalidate the run input. Because these records do not retain
individual attempt durations or failed tool-call counts, the evaluator cannot
independently re-prove the per-attempt timeout or total attempted-tool ceiling;
a future trusted runner must enforce and retain those campaign facts.

### Blinded adjudication

Two distinct random adjudicator study IDs independently judge every emitted
finding. The IDs are random/keyed identifiers, never hashes of names or email
addresses. Each judgment is one of:

- a unique match to one gold defect;
- a valid novel defect, which invalidates the fixture's current quality score
  pending corpus correction; or
- a false positive.

The packet records that provider, policy, cost, and the peer judgment were
hidden. A signed external coordinator attestation binds each random study ID to
a distinct human, the required blinding procedure, and a domain-separated
canonical commitment over every judgment field except the attestation hash
that is created afterward. This non-circular binding includes the disposition,
so rewriting a judgment invalidates its attestation. The harness can verify
record independence, signature integrity, and identifier distinctness; it
cannot itself observe personhood, actual blindness, or whether the supplied
manifest/key were approved outside the evaluator, and reports that trust
boundary. Identical independent judgments resolve automatically. A
disagreement requires an explicit coordinator-signed joint resolution binding
both study IDs, both complete judgment hashes, all finding/run bindings, and
the final disposition. Missing, rewritten, invalidly attested, or unresolved
judgments produce a non-scored status, never an inferred score.

## Metric semantics

The primary scorer follows an intention-to-evaluate reading of the frozen
protocol. All gold across all 24 assigned fixtures remains in recall
denominators. Invalid, blocked, cancelled, and unstarted fixtures therefore
contribute zero matches rather than disappearing:

- high-severity recall = unique matched P0/P1 defects divided by P0/P1 gold;
- all-severity recall = unique matched P0-P3 defects divided by all gold;
- finding precision = unique matched findings divided by all emitted findings,
  with duplicate matches after the first counted as false positives;
- false accept = a clean conclusion while any P0/P1 gold remains unmatched;
- weighted quality = `0.5 * high-severity recall + 0.3 * all-severity recall +
  0.2 * finding precision`.

Any valid novel-defect judgment suppresses every current semantic metric and
requires a corrected corpus version, new set commitment, and newly authorized
campaign. It never earns numerator credit in the run that discovered it.

The report separately exposes valid-review yield over all 24 with its Wilson
95% interval, exact terminal outcome counts, and optional accepted-result-only
recall/precision values clearly labeled as secondary conditional diagnostics.
Those diagnostics never replace or rename the primary all-assigned metrics.
Wilson 95% intervals accompany proportions. A deterministic seeded percentile
bootstrap with a fixed algorithm, replicate count, and seed derivation
accompanies fixture-level latency and cost per successful accepted review.
Total cost, cost per assigned fixture, raw numerators, and raw denominators are
retained. Selected token cost and local infrastructure cost are reported
separately; unknown infrastructure cost never becomes zero.

Zero denominators never acquire a conventional numeric value. Zero emitted
findings makes precision and its interval `null` with reason
`zero_emitted_findings`, which also makes weighted quality `null`. Zero
successful accepted reviews makes latency and cost-per-success estimates and
intervals `null` with reason `zero_successful_reviews`. Cost-per-success uses
paired all-assignment bootstrap samples; if any fixed-seed replicate has zero
successes, its interval is `null` with reason
`zero_success_bootstrap_replicate`, and the report retains valid and zero-count
replicate totals rather than silently dropping samples.

## Public report and privacy

The public aggregate contains only schema/protocol/evaluator versions, the
salted set commitment, policy, safe served-model/deployment/configuration
fingerprints, aggregate outcome and stratum counts, completed metrics when
permitted, interval method and seed, aggregate usage/cost/latency, and
non-claims.

It excludes runner ordinals, fixture commitments, repository or revision
identity, paths, evidence regions, defect IDs, severities per fixture, semantic
rubrics, witnesses, finding IDs, individual judgments, adjudicator identities,
review prose, endpoint or credential data, private input artifact hashes/sizes,
and raw diagnostics. Publication uses exclusive creation, restrictive
permissions, no replacement, fsync, and a last-written completion marker.
Hashes are tamper-evident, not immutable, and the private corpus prevents the
public report from being independently reproducible corpus proof.

The last-written completion marker contains the already-written aggregate's
SHA-256 and byte count. It contains no self-hash and no hash of a not-yet-written
artifact. Only the post-publication safe stdout summary may contain hashes and
byte counts for both the aggregate and marker.

The offline CLI reads private control paths from bounded JSON on stdin, not
process arguments. It emits only stable error codes and a safe summary; it
never echoes paths, parser values, oracle fields, raw exceptions, or private
content to stdout, stderr, diagnostics, logs, or persistent temporary files.
Tests capture and scan both output streams and allowed artifacts. Literal
sentinel absence proves literal non-disclosure only, not noninterference against
every encoded or transformed representation.

## P0 requirements and acceptance criteria

1. **Strict separation**
   - Runner data with any oracle-like field is rejected.
   - Oracle data cannot be imported from the runner-facing module graph.
   - Sentinel gold never appears in runner data, model-visible input/workspace,
     stdout, stderr, diagnostics, allowed temporary output, or public report.
   - Runner/evaluator import deny-lists prove the offline evaluator has no
     provider, fetch, network, runtime, or subprocess dependency.
2. **Frozen-set validation**
   - Exactly 24 ordered unique fixture commitments are required.
   - Exactly 8 clean and 16 faulty entries and the severity minimums are
     enforced.
   - Runner/oracle/run/adjudication set commitments must match exactly.
3. **Fail-closed adjudication**
   - Two distinct study-ID judgments and valid signed coordinator attestations
     that commit each judgment disposition are required for every finding;
     disputed dispositions require a signed joint resolution. The report
     preserves the external trust limitation rather than claiming personhood,
     blinding, or approval of the caller-supplied trust anchor was mechanically
     proved.
   - Missing, duplicate, self-paired, cross-fixture, invalid-gold, or unresolved
     judgments suppress semantic metrics.
   - Valid novel defects mark the affected fixture and aggregate invalid for a
     corpus correction rather than silently improving precision.
4. **Deterministic scoring**
   - Duplicate gold matches penalize precision.
   - Clean false positives and faulty false accepts are counted correctly.
   - Wilson and seeded-bootstrap results are stable across repeated runs.
   - Zero findings, zero successful reviews, and zero-success bootstrap
     replicates produce explicit non-estimable values and stable reasons.
   - All assigned gold remains in primary recall denominators, while every
     terminal outcome remains in aggregate counts.
   - Deterministic seeded bootstrap intervals cover both fixture latency and
     cost per successful accepted review.
5. **Safe publication**
   - The report is strict, bounded, scanned, private on disk, no-replace, and
     considered complete only with its final marker.
   - Raw private inputs and sensitive sentinels are absent byte-for-byte from
     both output streams and the allowed public artifacts.
6. **Executable proof**
   - Synthetic temporary bundles cover clean, faulty, duplicate, novel,
     disagreement, invalid, and complete cases without adding a real oracle to
     the repository.
   - The full deterministic suite, exact committed-head gate, Electron E2E, and
     Linux/macOS GitHub Actions pass.

## Success metrics

### Leading

- 100% of contract and isolation regressions pass.
- 100% of malformed or incomplete private inputs fail closed or produce an
  explicit non-scored status.
- 0 literal gold sentinel occurrences in model-visible, runner-facing, output
  stream, diagnostic, temporary-publication, and public-report bytes.
- Repeated scoring of identical inputs is byte-stable.

### Lagging, outside this milestone

- An independent curator can produce a conforming 24-case bundle without a
  repository change.
- Two blinded humans can complete the adjudication workflow.
- A separately approved one-shot local-only campaign can produce an honest
  fixed-provider baseline.

## Open dependencies

- An independent curator must select and witness the 24 real cases.
- Two human adjudicators and an external coordinator able to sign the blinding
  and distinct-person attestations must be recruited.
- The private repository map and full pinned clones must be available to a
  future runner.
- The operator must supply a deployment fingerprint; a served model name alone
  is only an endpoint snapshot.

These dependencies block a quality result, not this offline implementation.

## Milestone states

- `Approved`: this plan and approval ledger are committed.
- `Implemented`: contracts, scorer, exporter, CLI, and synthetic tests exist.
- `Verified`: exact local and remote deterministic gates pass for the offline
  promise.
- `Executed pending adjudication`: future campaign-only state, not authorized
  here.
- `Verified baseline`: future state requiring sealed real corpus, authorized
  provider execution, completed two-human adjudication, and exact report gates.
- `Released`: not authorized.

## Next gate after this milestone

Do not run a provider. Independently curate and seal the 24-case set,
deterministically materialize it, execute every faulty/corrected witness,
validate it with this harness, record only its salted aggregate commitment, and
then seek explicit approval for a new one-shot campaign authority. A poor
future quality score may still be a valid measurement; the result and the
quality floor are separate decisions.
