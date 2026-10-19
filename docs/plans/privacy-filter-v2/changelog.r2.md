# Change log, revision r2 of PRIVACY_FILTER_V2_DESIGN

Source: the nineteen findings of the second adversarial refutation (of r1,
2026-10-19). Target: `PRIVACY_FILTER_V2_DESIGN.r2.md`, written beside
`PRIVACY_FILTER_V2_DESIGN.r1.md`, which is unchanged. Nothing in the
repository was edited.

Applied: 19 of 19. Declined: none.

Structure check after writing: every `#`/`##`/`###` heading of r1 is present
in r2 with the same number; one subsection added (§4.7 "Install-level rows:
the stage and the D20(b) answer"); every Markdown table has a consistent cell
count per row (script-checked, 0 inconsistent); code fences balance (seven
blocks against six); 2,014 lines against 1,629; Q1-Q20, D15-rev, D20-D27 and
R0-R6 retained; the Status line reads revision r2.

## Resolutions in the direction of more restriction

Where a fix offered two options, or pulled against another fix or a standing
constraint, r2 took the more restrictive reading and says so in the text:

- Finding 11 (latency and schema): the fix offered (a) pin speculative
  decoding into the serving identity and budget at 35 tokens/s, or (b) budget
  at 8 tokens/s and shrink the schema. r2 takes (b): schema v3 with eight
  findings, quote ≤ 200 and reason ≤ 150 characters, the CJK maximum
  computed (≈ 2,600 tokens, 325 s), the L3 timeout derived from it (360 s),
  F0's cap raised to the resulting composed figure (≤ 7 min per 16 KiB,
  ≤ 8 min per 64 KiB), and a note that a later pin of speculative decoding
  may restate the budget in a new freeze (§0.2, §3.4, §9.1, F0).
- Finding 10 (cross-job echo): the fix offered an exact salted-digest set or
  a bloom filter sized for 1e-9 with review-class hits. r2 takes the exact
  set, because a hit is then always real and the incident switch stays
  incident-class (§3.8, §4.5, Q12).
- Finding 12 (reason codes) and finding 1 (D20(b)) together: for the two
  no-override tags a suggestive stop has no per-packet exit at all; the only
  exits are re-labelling or a per-context decision made in the job surface,
  never in the approval panel, and D20 gains a part (c) so the owner can
  forbid even that (§3.2, §5.2, §7.2, D20).
- Finding 6 (proposition judge): the fix allowed a different model or the
  27B under a different prompt. r2 names the local 27B under a distinct
  judge prompt and declines a paid cloud judge, because the run is absent
  from §9.3 and would send labelled-shaped synthetic packets to the cloud for
  scoring; the shared-weights limitation is stated in §11 and the agreement
  measurement and owner adjudication are made preconditions of F1 (§8.2
  item 4, F1, §11).
- Finding 15 (public packets): the fix allowed "manifest with stage S-A" or
  "advisory-only without a manifest". r2 gives public packets a manifest so
  the exact-bytes binding, tracer and receipt fields apply to them (§4.1,
  §8.7).
- Finding 2 and finding 11 together: because the budget is written at
  8 tokens/s, a non-complete pass is rare by construction and counted by
  cause under one F4 rate, and the override survives only for a `complete`
  pass (§3.0, §3.4, §5.3, F4, D15-rev(e)).
- Finding 3 and finding 19 together: the stage row carries `families` as well
  as language classes, so an F4 demotion is a row write `eligible()` can act
  on; absent row means closed (§4.7, F4).

## Per-finding changes

Numbering follows the order of the findings array.

### 1 (high) D20(b) "restrictive default" enforced by nothing

- §4.7 (new): `CodeDecisionRowSchema` as one install-level row
  `{answer, recordedEntryId, recordedEntrySha256, setAt}`; absent means
  tagged; written only by the stage surface with an entry reference.
- §3.1: the builder refuses family `coding`, and any non-synthetic context
  whose sources include source-code files (extension-class list hashed into
  the template record), with `outbound_regime_tagged_denied` while the row is
  absent, reading the install row and not the policy snapshot. §3.0 L0 row;
  §3.9 step 3 and step 7 (`eligible()` re-reads the row at commit).
- §4.1: `codeDecision` snapshot on the manifest; the
  `export_controlled_or_unpublished_ip` checklist row annotated as locked
  "applies" and not answerable for such packets. §5.2 item 2 says the
  pre-set is a prompt, not a control, and names r1's defect. §5.3 adds the
  row as a button condition.
- §1.3 new bullet; §1.4 third fact extended; Q2; §7.1 export bullet; §7.2
  private-code row; §8.7 S-B evidence ("the D20(b) row recorded"); §9.2
  row; R1 work and the unit test ("a `coding` packet from a non-synthetic
  context cannot produce a manifest or a grant while the row is unrecorded",
  plus the source-code-source case); R6; §10 closing note; D20(b) default
  restated as a store state; §4.5 storage row; §4.6 `code_decision_recorded`
  event and `outbound_stage_denied.reason`.

### 2 (high) A timed-out checker pass is overridable

- §3.4: any pass whose status is not `complete` (timeout, length cut,
  malformed, empty) is a block with no override, with the arithmetic showing
  why r1's length-cut rule never fired at 8 tokens/s (8,192 tokens = 1,024 s,
  beyond the 900 s ceiling); the L3 timeout derived from the schema's CJK
  maximum at the pinned rate (360 s, §9.1); F4 counts timeouts, length cuts
  and malformed answers under one non-complete rate by cause.
- §3.0 L3 row; "Override, scoped" and the containment paragraph in §3.4;
  §0.2 Checker rows; Q5; Q7; `LayerOutput.truncated` and
  `LayerVerdictRecord.status`/`truncated` comments (§3.0, §4.1); §5.1 shows
  the status and "no override"; §5.3; §8.3 F4 metric row renamed
  "non-complete passes"; F0 ("every checker pass ended `complete`"); F4;
  R4 work and exit gate; D15-rev(e); §11 latency bullet.

### 3 (medium) The persisted `stage` has no home or writer

- §4.7 (new): `StageRowSchema`
  `{level, languageClasses, families, approvedEntryId, approvedEntrySha256,
  setAt, demotion?}`, one row per install; writer is an owner action in a
  dedicated stage surface that refuses to write without an entry id and the
  matching hash of the entry's committed text; no other host path has write
  access; absent means `S-A`; snapshotted into each job's policy at creation
  and into the manifest; re-read from the install row by L0 and `eligible()`
  at every commit so a stale `S-B` snapshot never outlives a revert.
- R1 tests: the row cannot be set without an entry reference whose hash
  matches; a job created under `S-B` is refused at its next commit after a
  revert. F6 now reverts by writing the row and names the refused commit;
  the S-B incident drill includes the revert (§8.7).
- §0.1; §0.2 "Where S-A runs" row (names r1's gap); §1.3; Q2; §3.1; §3.9
  step 7; §4.1 `stage` snapshot with `families` and the entry reference;
  §4.5 storage row; §4.6 `stage_row_set` event; §5.1; §5.3; §7.2; §7.3;
  §8.7 S-A and S-B rows; §9.2 row; §9.4; R1; R6; D15-rev(f).

### 4 (medium) Language class by script share

- §3.1 new paragraph "Language class, by presence and not by share": after
  NFKC any run of ≥ 2 CJK codepoints in the candidate, or any CJK entry in
  the job's registry, makes the class at least `mixed`; `zh` when CJK
  codepoints are the majority of letter codepoints; the 李伟/王芳 case named.
- §4.1 `languageClass` comment and new `languageClassEvidence
  {ruleVersion, cjkRuns, cjkRegistryEntries}`; §4.6 `outbound_built` carries
  it; §3.0 L0 row; §3.9 step 3; §5.1; §8.2 item 6 development-split check
  that no `en`-classed packet contains a CJK gold span; §0.2 Learned-layer
  row; R2 work.

### 5 (medium) F2 under the withheld configuration has no denominator

- §8.2 item 8: F2 and F5 computed over the withheld gold subset only (values
  absent from the registry plus cross-turn, brief and path-only values), with
  the reason (the registered half is caught by L1 by construction); the
  registered subset reported separately; the composed estimate
  (1 − harvest recall) × (1 − withheld recall) per class and language.
- §8.3 "Untyped covering recall" and "Layer attribution" rows; F2; F5; §8.7
  S-B evidence; §0.2 Learned-layer row; R5; §11 numbers bullet.

### 6 (medium) The arm-blind proposition judge is unspecified

- §8.2 item 4: the judge is the local 27B under a judge prompt distinct from
  the checker prompt, given only the proposition and the packet, with its own
  schema, sampling pins and identity hash in the freeze; a paid judge
  declined with the reason; agreement with the owner measured on the 10 %
  audited sample before the sealed pass (≥ 0.90, or the prompt changes and
  development is re-judged); every judged mandatory-proposition miss
  owner-adjudicated before F1 is read; a judged survival never overturned in
  the agent's favour.
- §8.3 proposition row; §8.5 freeze item 2 and item 6 (the judge runs inside
  the Thor stage); F0 (agreement reported) and F1 (adjudication); §9.3 new
  zero-fee line for the judge; §9.4; R4 work and exit gate; R5; §11 new
  bullet on the shared-weights limitation.

### 7 (medium) Placement constraint covers values only

- §8.2 item 3: ≥ 1 planted proposition per packet inside an admitted region
  where the family allows one (rationale or new text, failing-check excerpt,
  cloud brief, plan step); packets whose admitted regions cannot carry one
  (`schema_review`) marked `proposition_unreachable` and excluded from the
  denominator, never counted as recall; the outline-survival defect named.
- Item 6: per-cell minimum of five propositions among the families that can
  carry one; the per-packet proposition-survival distribution reported with
  the pass. Sizes paragraph; §8.3 proposition row (denominator); F0; R5; §9.4.

### 8 (medium) Inference deadline contradicts batch size

- §8.5 item 3: separate Mac-only stage (≤ 60 min per configuration, which is
  what r1's figure meant) and Thor stage (≤ 120 × p95 × 1.5 per configuration,
  p95 from R4, the number written into the freeze receipt); a Mac- or
  Thor-stage deadline hit voids the pass as an F0 completion failure without
  counting as a tuning iteration or re-reading the inputs.
- Item 6 restated (up to six minutes per packet at the pinned rate); item 2
  (deadline in the freeze); F0; §9.3 GPU row (up to about 12 device-hours
  per configuration at 8 tokens/s); R4 records the p95 that sets the
  deadline; R5.

### 9 (medium) Registry harvest cannot complete a 200k-token chunk

- §3.2 item 2: chunks bounded by expected output (≤ 50k input tokens,
  streamed, 4,096-token output cap ≈ 8.5 min at 8 tokens/s under the 900 s
  ceiling and the 947 s remote cut, `more: true` continuation re-sending only
  the unharvested remainder); the arithmetic for r1's failure; a cut,
  timed-out or malformed call is a harvest failure: registry `partial: true`
  with `failedChunks`, the owner told, the builder refuses the first packet
  (`outbound_registry_partial`) until the harvest completes or the owner
  acknowledges `partial` with a reason code recorded in the manifest and the
  disclosure report; the harvest given Q7's fail-closed shape.
- §4.4 schema (`harvestChunks` comment, `failedChunks`,
  `partialAcknowledged`); §4.1 `registryPartial`; §4.6 `registry_built`
  fields and new `outbound_registry_partial` event; §3.0 L0 row; §3.9
  step 2; Q3; Q7; §5.1; §5.3; §7.3; §9.1 registry row with the ceiling
  references; R2 work; §9.4.

### 10 (medium) Bloom filter feeds the incident switch

- §3.8: exact set of salted HMAC digests of mandatory-class normalised values
  (per-process salt, never persisted), with the false-positive arithmetic
  that made the bloom filter unacceptable for an incident-class signal.
- §0.2 Tracers row; Q12; §3.0 L7 row; §4.5 row renamed and described; F6;
  §8.8; §9.4.

### 11 (medium) Latency budget does not fit; schema maximum understated

- §3.4: schema v3 (`findings.max(8)`, `quote.max(200)`, `reason.max(150)`,
  `usefulReason.max(150)`, `version: 3`), `maxOutputTokens: 4096`; the CJK
  and English maxima computed (≈ 2,600 and ≈ 1,050 tokens); the budget
  written at 8 tokens/s rather than at the unpinned 35; the L3 timeout
  derived (360 s).
- §9.1 L3 row rewritten with the arithmetic and r1's error; composed budget
  restated with CJK as the worst case (394 s per 16 KiB, 454 s per 64 KiB)
  and the D11 note; F0 caps raised to ≤ 7 and ≤ 8 min; §0.2 Checker row;
  Q5; §5.1 (eight findings); §8.5 freeze item 2 (pinned rate and derived
  timeout); R4 work and exit gate ("eight-finding packet"); §9.4.

### 12 (medium) Regime-suggestive reason codes answer the wrong question

- §3.2 item 1: reason codes restricted to statements about the regime
  (`owner_is_the_party`, `synthetic_or_test_data`,
  `no_client_or_patient_relationship`, `data_is_the_owners_published_work`);
  `public_record` dropped with the dbGaP and docket examples;
  `identifier_not_of_a_person_or_matter` kept only for ICD-shaped hits in
  the `general` and `website` families; for the two no-override tags a stop
  has no per-packet exit: the packet is discarded, and only re-labelling or a
  recorded per-context owner decision in the job surface
  (`outbound_regime_context_decision`, cited in later manifests) changes the
  next packet.
- §4.1 `reasonCode` enum and `regimeContextDecisionIds`; §4.5 storage row;
  §4.6 new event and the disclosure report; §3.0 L1 row; §1.3; Q3; §5.2
  item 2; §5.3; §7.2 rows; §7.3; §11 untagged-matter bullet; D20 new part
  (c) with a restrictive default; R2 work.

### 13 (low) Parent-chain re-check lives in an optional callback

- §3.9 step 7: the check is inside `eligible()` itself, reading
  `parentJobId`/`parentContextId` from the store for any `cloud_help`
  context, on every commit regardless of the caller; `broker.ts:347`,
  `consultation.ts:218` and `scripts/phase2-repair.ts` cited;
  `validateAtCommit` remains for the caller's own checks only.
- Q19; §0.1; §1.3; R1 work and the test ("a request with no
  `validateAtCommit` callback is still refused when the parent carries a
  tag"); §4.7 tests; §13 source lines.

### 14 (low) `seed` and structured output are unscheduled work

- §3.4: `model.ts` typed as `{temperature, top_p, top_k}` with no `seed` and
  no `response_format`/`json_schema`/`guided` field; the request builder
  gains `seed` on `sampling` and a `responseFormat: {type: "json_schema",
  schema}` option; the structured-output mode and vLLM version join the
  checker's layer identity beside the schema hash.
- §3.0 interface comment and composed identity; Q5; §8.5 freeze item 2; R1
  work and the wire test; R4; §9.4; §13 source lines.

### 15 (low) Manifest cannot describe S-A public packets

- §4.1 `labels.level` gains `public` with the comment that such a packet
  carries a manifest like any other; §8.7 S-A row states that public packets
  carry a manifest with `labels.level: public` and `stage: S-A` so the
  exact-bytes binding, tracer and receipt fields apply; §5.3 lists `public`
  beside synthetic; R1 schema list.

### 16 (low) Edit-and-rerun leaves no lineage

- §4.1 `supersedesManifestId` and `priorBlock: {layer, findingKind}`; §4.6
  `outbound_built` carries both; the disclosure report lists each approved
  packet's rerun chain with the finding kinds it was blocked on; §3.4
  "Override, scoped" says so; §3.9 step 3; §5.1 shows the chain; §5.3;
  §7.3; §0.2 Checker authority row; D15-rev(e); R1 schema list; §9.4.

### 17 (low) Relative dates have the single-anchor problem

- §3.5 item 5: anchor check for relative intervals in L4 (absolute dates in
  ISO, numeric, written and CJK 年月日 forms, and date-bearing citations on
  the preserve list); a survivor is a non-overridable `structural` finding
  `relative_date_anchor`; the owner drops the anchor or removes the dates
  from the preserve list before approval. §6 Dates bullet names r1's
  inconsistency and keeps shifting deferred; §5.3; §11 new bullet on what
  the check cannot see; R2 work; §9.4.

### 18 (low) Harvest injection not in the red-team list

- §8.8: harvest-targeted injections (omit, rename, flood) added with the
  reason; harvest recall on the injected subset reported under F0 beside
  the clean figure. §8.2 item 7: a drop below the clean figure by more than
  two percentage points in any class is a development failure; §8.3 harvest
  row; F0; R5; §9.4.

### 19 (low) F4's failure consequence names no machine-checkable class

- F4: on failure S-B does not open, or reverts to S-A, for every family
  except those the owner names in a recorded decision as structure-only
  (`schema_review` and `plan_review` purposes in the families the owner
  lists); the demotion is written into the stage row's `families` and
  `demotion` fields, which `eligible()` reads; r1's wording named as the
  defect. §4.7 row schema and "Demotion" bullet; §4.6 `stage_row_set`
  carries `demotion`; §0.2 Checker authority row; §8.7 S-B row ("language
  classes and families"); §5.3 ("and family"); R5.

## Declined

None.
