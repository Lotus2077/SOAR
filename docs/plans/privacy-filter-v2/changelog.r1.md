# Change log, revision r1 of PRIVACY_FILTER_V2_DESIGN

Source: the twenty findings in `result.refutation.findings` of the refuter
output (2026-10-19). Target: `PRIVACY_FILTER_V2_DESIGN.r1.md`, written beside
the original `PRIVACY_FILTER_V2_DESIGN.md`, which is unchanged. Nothing in the
repository was edited.

Applied: 20 of 20. Declined: none.

Structure check after writing: every `#`/`##`/`###` heading of the original
is present in r1 with the same number (one title changed on purpose: §1.4
"Two facts" became "Three facts"); every Markdown table has a consistent cell
count per row; code fences balance (six blocks); 1,629 lines against 1,201;
Q1-Q18 retained and Q19-Q20 added; D15-rev, D20-D26 retained and D27 added;
R0-R6 retained.

## Resolutions in the direction of more restriction

Where a fix offered two options, or pulled against another fix or a standing
constraint, r1 took the more restrictive reading and says so in the text:

- Finding 18 (placeholder derivation): the fix offered "cite HHS guidance and
  keep the HMAC" or "switch to a random per-entity code". r1 switches to a
  random CSPRNG code stored only in the map (§0.2, §4.3, §6, §7.1, Q8). The
  `salt` field and `mapSaltSha256` are removed; the manifest records the map
  ciphertext hash instead.
- Finding 19 (key recovery): the fix offered "an owner-held recovery secret"
  or "state the limitation". r1 states the limitation in Q13, §4.5, §6, §7.3
  and §11 as the default (one key, no second copy) and makes the recovery
  secret an owner opt-in (new D27).
- Finding 6 (zh): the fix offered "S-B English-only until F2 passes on zh with
  the registry withheld" or "move the zh detector into v2.0". r1 does the
  first and keeps the detector as the v2.1 candidate that is the expected
  route to opening zh (§0.2, F2, §8.7, D25). S-B now opens per language
  class, which required a `languageClass` on the manifest and a stage with
  language classes on the policy.
- Finding 4 (private source code): the fix asks that P1 define whether
  private code is `export_controlled_or_unpublished_ip` before R6 names
  `coding` first. r1 makes it D20(b) with the restrictive default (treated as
  tagged, so `coding` is not first until the owner records otherwise) and
  reorders R6 accordingly (§1.4, Q2, §7.1, §7.2, R6, D20).
- Finding 5 (verbatim prose): beyond `-U0`, r1 also replaces removed diff
  lines that match the input index with locators, since a `-` line is
  verbatim source as much as a context line is (§1.2, §3.1).
- Finding 16 (utility arms): adding the raw arm changes what F3 gates. r1
  gates on the total recall(R) − recall(P) ≤ 1 of 6 and reports the
  template's and the filter's shares separately (§8.4, F3), which is stricter
  than gating on the filter's share alone.
- Finding 12 and finding 9 together: a length-cut checker pass is a block
  with no override at all, which is stricter than finding 12's scoping alone
  (§3.4, §5.3, D15-rev(e)).
- Finding 14 (echo tiers): the incident switch still fires on every
  incident-class hit; review-class flags are added, not substituted, and two
  review flags in ten packets trigger a red-team round (§3.8, F6).

## Per-finding changes

Numbering follows the order of the findings array.

### 1 (high) S-A permits real labelled packets

- §8.7 S-A row rewritten: synthetic or public contexts only; no packet from a
  non-synthetic context labelled `personal` or above leaves; `eligible()`
  enforces it through a persisted policy `stage`; the first draft's wording is
  named as the defect.
- Q2 gains the persisted `stage` (`S-A` default; `S-B` per language class,
  written only by the S-B `Approved` entry); §1.3 gains a "what never
  crosses" bullet for it; §3.1 builder refusal includes it; §3.0 L0 row gains
  `outbound_stage_denied`; §4.1 manifest gains a `stage` snapshot; §4.6 gains
  the `outbound_stage_denied` event; §5.1 shows the stage; §5.3 requires it;
  §8.7 S-B row says the entry writes it; R1 implements and tests it;
  D15-rev(f) records it; §0.1 and a new §0.2 row ("Where S-A runs") state it.

### 2 (high) Tracer keyed on the dispatch id is unbuildable

- §3.1 Tracer paragraph: nonce = HMAC(key, manifestId), with the reason the
  dispatch id cannot serve (created at commit; consultation proposes and
  dispatches at different times); the receipt records `manifestId`.
- §3.7 step 4 verifies against the bound `manifestId`; the receipt gains
  `manifestId`; Q10 says so; §4.1 `tracer.keyedOn: "manifestId"` and the
  `manifestId` comment; §4.6 receipt row gains `scan.manifestId`; §7.3 lists
  the manifest id; §8.8 recomputation is from the manifest id on the receipt;
  §0.2 Tracers row updated.

### 3 (high) `eligible()` sees only the sub-context

- New Q19 (parent-chain binding). §3.9 step 5 rewritten: `cloud_help`
  sub-jobs persist `parentJobId`/`parentContextId`; the store refuses
  creation when the parent has regime tags, is not cloud-help-eligible, or
  lacks the stage; sub-context sources carry the join of the parent's labels
  and are `synthetic: true` only when every parent source is. Step 7:
  `eligible()` re-checks the parent chain inside `validateAtCommit`.
- §3.7: `grantFreeSynthetic` refused in the desktop profile, allowed only in
  the headless script; Q10 and §10.2 step 2 say so. §1.3 regime bullet says
  the parent context is checked. §4.1 manifest gains `cloudHelpJobId`,
  `cloudHelpContextId` and `labels.synthetic`; receipt labels are the parent
  context's (§3.7, §4.6). R1 implements and tests it. §0.1 mentions it.

### 4 (high) "Never for regime-tagged" becomes "never for data the owner tagged"

- §3.2 item 1: hits in regime-indicative families (案号, docket, record-number
  and MRN shapes, ICD codes, dbGaP and other accessions, owner-registered
  regime shapes) are `regime_suggestive` hard stops with no override; the
  owner must tag the context or answer per tag with a reason code, logged as
  an override of kind `regime_suggestive`. Q3, §3.0 L1 row, §3.9 step 4.
- §5.2 item 2: the single yes/no question replaced by a five-row per-tag
  checklist pre-set to the strongest plausible tag per family, each row
  needing an explicit answer, reason codes where L1 stopped. §4.1 ownerForm:
  `regimeChecklist` (five literals) and `regimeSuggestiveResolutions`;
  manifest gains `regimeSuggestive`; §4.6 gains `outbound_regime_suggestive`;
  §5.3, §5.4, §7.2 rows, the disclosure report, §0.2 Consent row.
- Private source code: §1.4 third fact, Q2, §7.1 export-control bullet, §7.2
  new row, R6 family order, D20(b) with the restrictive default, §11 bullet,
  §9.2 row. New §8.3 metric "regime-suggestive stop rate" and F1 clause;
  §8.1 and §8.8 add the leak class.

### 5 (high) Templates admit verbatim third-party prose

- §3.2 item 3: the provenance index is defined over the owner's input files
  and restored cloud replies, never the agent's outputs, with the reason (P1
  label join makes "any labelled source" self-defeating); scope recorded as
  `provenanceDiff.indexScope`; per-template threshold recorded as
  `template.copiedShareThreshold` and `provenanceDiff.thresholdShare` (§4.1);
  matched runs become locators where the template defines one.
- §3.1 new paragraph "Locators, not quotes": document-review issues list
  carries clause locators, action, rationale and new text, never anchor
  quotes; `code_review` sends `-U0` hunks with matched removed lines replaced
  by `[file:line-range, n lines]`; check output has quote fields stripped.
  §1.2 table rows for `repair_critique` and `code_review` updated; §1.2 note
  on templates; §1.3 first bullet; Q1, Q3, Q6; §3.5 item 3; §6 Re-entry
  (restored replies join the index); §0.2 Known-value row; R2; D15-rev(a).

### 6 (high) Sealed evaluation is near-circular

- §8.2 item 7: harvest recall scored against the planted registry, an F0
  metric (also §3.2 item 2, §8.3 first row, F0).
- §8.2 item 8 and §8.5 item 8: every sealed pass runs registry-on and
  registry-withheld (50 % of planted values plus all cross-turn/brief/path-only
  values) inside the one pass; F2 and F5 are read from the withheld
  configuration; both reported (§8.3 rows, §8.6 F0/F1/F2/F5, R5, §11).
- S-B per language class: F2, §8.7 S-B row, §0.2 Learned-layer row, Q18, D25
  default "S-B English-only".

### 7 (high) Whole-context metric is pre-empted

- §8.2 item 1: planted confidential facts annotated as propositions beside
  the verbatim sentence; item 4: scored by an arm-blind judge independent of
  wording. §8.3 "Sentence-level whole-context recall" replaced by
  "Proposition recall (whole-context)" with verbatim-copied spans excluded
  from the checker's attribution and L3's recall on the paraphrased subset
  reported; layer-attribution row and F5 exclude verbatim-copied spans; F1
  counts mandatory propositions; R4 and R5 reference propositions; §8.1 leak
  class renamed.

### 8 (medium) 120 mandatory canaries asserted, not constructed

- §8.2 item 3: the generator places ≥ 1 mandatory and ≥ 3 advisory values per
  packet inside the regions the template admits; packets with nothing planted
  are re-generated, and clean-packet controls are authored separately. New
  item 6: a sealed set is rejected if any suite × language cell has fewer than
  ten mandatory canaries in admitted regions; the per-packet gold-count
  distribution is reported. Sizes paragraph and F0 updated.

### 9 (medium) Checker output cap cannot hold its schema

- §3.4: `maxOutputTokens: 8192`; `findings.max(10)`; `truncated: boolean` in
  the schema (version 2); paragraph explaining why forty did not fit and that
  the critic-cap lesson was about thinking; a `finishReason: length` pass is
  `failed` with a non-overridable block. §3.0 L3 row, `LayerOutput.truncated`,
  `LayerVerdictRecord.truncated` and `errorCode "length_cut"`,
  `usefulness.checkerTruncated` (§4.1), §5.1 flag, §5.3, Q5, Q7, F4
  length-cut limits, R4 exit gate, §0.2 Checker row, D15-rev(e).

### 10 (medium) Registry harvest absent from the budget and on the per-turn path

- §3.2 item 2: built lazily on the first cloud action, not at job start;
  harvest chunked at ≤ 200k tokens; progress and partial flag shown. §3.9
  steps 1-2 moved accordingly; §4.4 gains `builtAt` and `harvestChunks`; §4.6
  `registry_built` written by the first cloud action; Q3.
- §9.1 registry row rebudgeted with the 27B's measured rates (prefill ≈ 2.5
  min per MiB, output 25 min to 1.7 h for 5,000 entries), outside the
  per-packet budget; §11 latency bullet.
- §3.4 input: only registry entries not already resolved to a placeholder are
  passed, capped at 4,000 tokens in priority order; truncation recorded as
  `registryPrompt.truncated` (§4.1) and shown (§5.1); L3 prefill estimate
  widened to 17-24k tokens (§9.1); R4 exercises the cap.

### 11 (medium) Checker sampling unpinned

- §3.4: `temperature`, `top_p` and `seed` pinned per pass (T = 0 and T = 0.3,
  `top_p` 1.0, fixed seeds), sent explicitly via a new `sampling` field on
  the request builder because `model.ts` sends sampling only with thinking
  on; pins and served model identity (P16) in the layer identity; passes run
  concurrently; agreement reported per setting. §3.0 interface comment and
  composed identity; `LayerVerdictRecord.sampling` and `servedModelSha256`
  (§4.1); §8.5 freeze includes sampling pins; F4 agreement "between the two
  pinned settings"; Q5; R1 (`sampling` field) and R4; §0.2 Checker row.

### 12 (medium) Unscoped owner override of the checker

- §3.4 "Override, scoped": override only for blocks with no located quote or
  of kind `injection_attempt`; a located `confidential_fact` or
  `reidentification` block offers edit-and-rerun or decline only; every
  override recorded with its finding kind. §5.3, §5.4, §3.0 L5 row, §4.1
  `override.findingKind`, §4.6 `outbound_decision.overrides[]` with
  `findingKind` and the disclosure report, Q9, Q11, D15-rev(e), §0.2 Checker
  authority row, §3.4 containment paragraph rewritten.

### 13 (medium) Checker free text is an unvetted channel

- New Q20. §3.4 "Free text is untrusted": `reason`/`usefulReason` shown as
  untrusted model text; a reveal must carry `preserveClass` (schema field;
  a reveal without one is dropped) and the button reveals only that class;
  when any pass reports `injection_attempt`, reveal suggestions and the
  `useful: false` reason are suppressed. §3.4 question 3, §5.1 findings
  bullet, §3.0 L3 output, `LayerOutput.findings` comment, F4 counts a steered
  reveal or usefulness reason as an injection failure, R4, §8.8 red-team
  target, §11 injection bullet.

### 14 (medium) Response-echo scan trips on common tokens and reads other jobs' plaintext

- §3.8 rewritten in two tiers (incident-class: checksummed identifiers,
  emails, phones, secrets, full multi-token names, any mandatory-class value
  of another live job; review-class: single tokens, surname-only forms,
  place/product/other kinds), with a salted bloom filter of mandatory-class
  normalised values across live jobs in place of plaintext registries, the
  tier recorded. Q12; §3.0 L7 row; §4.5 new row for the filter; §4.6
  `replyScreen.echoTier`, `crossJobHit`, new `outbound_echo_review`, and
  `outbound_incident.tier`; F6 split into incident-class and review-class
  consequences; §8.8; §9.2 weekly review row; §0.2 Tracers row.

### 15 (medium) The consultation event stores full packet text

- §3.6 new paragraph: `packetText` moves from `consultation_proposed` into an
  encrypted proposal store; the event keeps hashes; `state()` rebuilt from the
  store; migration note; CI test bounding event row size. §4.5 new "Proposal
  text" row; §4.6 prerequisite paragraph; Q11; R1 work and exit test; §9.4.

### 16 (medium) Template cost not isolated; trial exercises nothing

- §8.4: a fourth arm R (today's raw `buildRepairPacket` rendering) with the
  reason; 48 critiques; two reported differences; gate on their sum (F3);
  cost ≤ USD 40; owner spot-checks 4 of 48 (§9.2).
- §10.2: a seventh synthetic document-review draft with planted parties, with
  the reason (d1 is a public template, c1/r2 public code and RFCs); cost
  ≤ USD 7; R2 exit gate on seven packets; "does not prove" updated.
- §9.3 and D23: allocation ≤ USD 49 (was 38), the delta named.

### 17 (low) Latency arithmetic inconsistent; OPF figure assumed snippet cost

- §3.4 and §9.1: the two checker passes run concurrently, wall time one pass;
  composed budget restated as composed p95 on the machine that runs each
  layer, with the arithmetic (2 + 90 + 180 + 2 = 274 s) and the first draft's
  error named; F0 reads it that way.
- §3.3 and Q4: OPF chunks by the OPF tokenizer's count (≤ 7,000 tokens) at
  line boundaries, with the dense-CJK reason; §3.3 new paragraph and §9.1 L2
  row: "unmeasured on packet-sized input; linear estimate of order 60 s
  median" until R3; R3 exit gate replaces the estimate with a number.

### 18 (low) Three regulatory statements overstated

- §7.1 HIPAA: Expert Determination "has no population requirement, but it is
  impractical per packet for an n = 1 narrative". §7.1 GDPR: the Chinese-name
  ethnicity point moved to a closing note marked contested with *verify* and
  "no control here is planned on that reading"; the Art 9 parenthetical no
  longer carries it. §7.1 HIPAA and §6 Grammar: 164.514(c)(1) quoted, the
  keyed HMAC named as derived, HHS 2012 guidance cited with *verify* as
  something the design does not rely on because the code is now random (see
  the restriction note above); §13 adds the guidance as a not-re-fetched
  source; §4.3 note explains the removed salt.

### 19 (low) One Keychain key with no backup

- Q13 restated ("while the key exists"); §4.5 closing paragraph and new
  opt-in row; §6 new "Key recovery" bullet with the restrictive default; §7.3
  caveat; §11 new bullet; new D27 with default "none". §0.2 record row.

### 20 (low) Wire gate unspecified without a grant; `basisCode` mixes two things

- §3.7 rewritten with two modes (binding present: full; binding absent:
  rules-only, no `manifestSha256`, receipt says so, never serves a
  `requireExactGrant` destination), each with a test; `scan.mode` on the
  receipt (§4.6), Q10, §3.0 L6 row, R2 exit gate.
- §4.1 ownerForm: `basisCode` replaced by `legalBasis` (fixed list without
  `professional_rules_analysis_done`) and `professionalAnalysisDone: boolean`;
  §5.2 item 3; §7.1 GDPR bullet; §7.2 rows; §7.3; §0.2 Consent row; D15-rev(c).

## Declined

None.
