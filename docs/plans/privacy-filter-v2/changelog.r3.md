# Change log, revision r3 of PRIVACY_FILTER_V2_DESIGN

Source: the sixteen findings of the third adversarial refutation (of r2,
2026-10-19). Target: `PRIVACY_FILTER_V2_DESIGN.r3.md`, written beside
`PRIVACY_FILTER_V2_DESIGN.r2.md`, which is unchanged. Nothing in the
repository was edited.

Applied: 16 of 16. Declined: none.

Structure check after writing: every `#`/`##`/`###` heading of r2 is present
in r3 with the same number and text (59 of 59, script-compared); 14 Markdown
tables in each, every row of every r3 table with a consistent cell count
(script-checked, 0 inconsistent); code fences balance (14 fence lines, seven
blocks); 2,347 lines against 2,014; Q1-Q20, D15-rev, D20-D27 and R0-R6
retained; the Status line reads revision r3. One schema block added inside
§4.1 (`RegimeContextDecisionSchema`, after `LayerVerdictRecordSchema`) and one
numbered item added to §3.5 (item 8) and to §8.2 (item 9); no item or row
renumbered.

Citations verified by reading the cited file and line on `main` of
2026-10-19 (`<local path>): `broker.ts` 12, 14, 16,
51, 58, 60, 247-248, 260, 312, 347, 362, 379, 464, 515; `profiles.ts` 36 and
37-38; `src/main/config.ts` 74 and 223; `src/main/general-tasks/controller.ts`
250-251; `src/main/liveness.ts` 8 and 15-16; `model.ts` 101, 104, 105-106,
234-235, 247-248; `consultation.ts` 66-70, 177, 218; `store.ts` 105, 208;
`contracts.ts` 16-27; `scripts/phase2-repair.ts` 80-81, 83, 104-105;
`docs/BUILD_LOG.md` 17825; `docs/experiments/serving-card-2026-09-28.md` 29,
30, 34, 35, 41-43. Two r2 citations were wrong and are corrected in §13 with
the correction named: `contracts.ts` 19-27 is 16-27, and `config.ts:74` with
`profiles.ts:36-37` were cited for a "900 s request ceiling" when
`src/main/config.ts:74` defaults to 300_000 (900_000 is its maximum),
`profiles.ts:36` is the 300 s `standard` profile and only `profiles.ts:37`
(`heavy`) and `broker.ts:16` carry 900 s. `config.ts` lives at
`src/main/config.ts`, not under `private-agent/`. The r2 claim that
`scripts/phase2-repair.ts` calls `request()` without a callback is true but
indirect: it calls `model.complete` (line 83), which calls `broker.request()`
at `model.ts:247-248` with two arguments; §3.9 and §13 now say so.

## Resolutions in the direction of more restriction

Where a fix offered two options, or pulled against another fix, r3 took the
more restrictive reading and says so in the text:

- Finding 4 (families): the fix allowed (a) opening S-B per language class
  only with `families` as a demotion field, or (b) a family dimension in the
  corpus with a per-family × language minimum. r3 takes (b), and makes the
  stage row a **product** of three lists (class, family, purpose) rather
  than a table of cells, so a family is listed only when its cell passed in
  every listed language class; the consequence (opening zh later may require
  dropping a family that passed only in English) is stated in §4.7 rather
  than hidden (§4.7 "Product, not cells", §8.2 item 9, F2).
- Finding 2 (timeout): the fix allowed a measured derivation or a 450 s
  floor. r3 takes both: the timeout is (CJK maximum / measured p5 + prefill)
  × 1.25 and never below 450 s, so a measured rate can only widen it, and a
  pass inside the margin is a reported warning, never a demotion and never a
  release (§3.4, §9.1, F4).
- Finding 1 (destination): the destination's `timeoutMs` is set at 720 s,
  above the harvest's derived per-call bound of about 675 s and the fix's
  "≥ 600 s", so the operative limits are the derived per-call bounds, not the
  transport; the 640 KiB body cap serves only the checker and the harvest and
  §3.5 item 6 says the cloud destination keeps 192 KiB (§3.4, §3.5).
- Finding 3 (echo screen): beyond moving the screen before restoration, r3
  adds an L4 query of the same digest set over the outgoing final bytes
  (§3.5 item 8), which turns a harvest miss another job already knows into a
  placeholder before dispatch; it reads digests only (P6). This is marked in
  the text as an addition beyond the fix.
- Finding 11 (reason codes): the fix's "unless the brief's preserve list
  names it as `public_identifier`" is kept, but the literal is counted in the
  manifest (`regimeSuggestiveLiterals`) and the two no-override tags' codes
  exist only on the per-context decision schema, with the store rejecting
  any other tag-code pairing (§3.2, §4.1).
- Finding 7 (reveal): the exemption is stated as exactly the logged reveal
  ids, with `matter` and regime identifiers excluded alongside `person`,
  `patient` and `participant`, and the button not offered for any other span
  (§3.4, §3.5, §3.7).
- Finding 9 (hash): r3 does both halves of the fix: the surface computes the
  hash and length from the entry text the owner supplies, and the text says
  what that does and does not verify, naming the writer restriction as the
  control (§4.7).
- Finding 6 (independence): the product is kept, stated under a named
  independence assumption, and bounded by the harvest-missed-subset figure,
  which §8.2, §8.3, F2 and §11 name as the one to cite.

## Per-finding changes

Numbering follows the order of the findings array.

### 1 (medium) Transport limits of the adopted profile; wrong ceiling citation

- §3.4 new paragraph "A dedicated destination, not the coordinator's": the
  `thor_filter` destination from a `filter` profile (`thinking: disabled`,
  `maxOutputTokens: 4096`, `requestTimeoutMs: 720_000`, `maxRequestBytes:
  640 * 1024`, streaming with the inactivity clock via `localStreamSettings`);
  why `standard` (`profiles.ts:36`, 300 s, 192 KiB) could not carry a CJK
  maximum pass or a harvest chunk; where 900 s actually lives
  (`profiles.ts:37`, `broker.ts:16`); the transport abort at
  `broker.ts:464`; `SOAR_REQUEST_TIMEOUT_MS` (`src/main/config.ts:74`,
  `controller.ts:250-251`); the body-cap chain (`broker.ts:14`, `:248`,
  `:260`, `model.ts:104`, `:234-235`); the two R1 tests.
- §3.2 item 2: the harvest runs through the same destination; the 8.5-min
  parenthetical rewritten with prefill and the reasons the `standard`
  destination fails (`broker.ts:312` for `packet_size_exceeded`).
- §3.5 item 6: the cloud destination's cap stays 192 KiB (`broker.ts:12`).
- §9.1 L3 row and registry row: the ceiling citations corrected and r2's
  error named; §0.2 Checker row; Q3; Q5; §3.0 L3 row; §8.5 item 2 (the
  destination's values in the freeze); R1 work and tests; R4 ("vLLM 0.30.0",
  BUILD_LOG line 17825, with the note that r2 wrote 0.28); §9.4; §13.

### 2 (medium) 6 % timeout margin on an unmeasured rate

- §3.4: the derivation paragraph replaced: r2's 360 s named as a 6 % margin
  on a community estimate (serving card lines 41-43, with the measured
  figures at lines 29 and 34 all under speculative decoding); the rule
  (R4 measures per-stream p5 under two concurrent passes with
  `responseFormat`; timeout = (CJK maximum / p5 + prefill) × 1.25, floor
  450 s; p5 and the timeout in the freeze; destination `timeoutMs` above);
  the budget-warning band (`budgetWarning: true` on a complete pass past the
  no-margin figure; an F4 rate, never a demotion).
- §3.0 interface (`budgetWarning`) and L3 row; §4.1 `LayerVerdictRecord`
  `budgetWarning`; §4.6 `outbound_layer`; §5.1 (shown with elapsed time);
  §8.3 F4 metric row; F0 (composed p95 ≤ 9 and ≤ 10 min at the 450 s floor,
  restated in the freeze when the derived figure differs); F4 (warning rate
  reported, eight-finding clause kept); §8.5 items 2 and 6 (7.5 min per
  packet); §9.1 L3 row and composed budget (484 s, 544 s); R4 work and exit
  gate; §11 latency bullet; §0.2 Checker row; Q5.

### 3 (medium) Echo screen trips on this job's own restored originals

- §3.8: the reply is screened before restoration with placeholders intact,
  with r2's failure mode named (the owner's name in every registry, P15
  revoking everything); restored originals never enter a screen; the tiers
  restated on raw bytes (this job's mandatory-class registry value in the
  raw reply is incident-class because it could not have been sent; a
  cross-job hit on a value not in this job's registry is incident-class; a
  cross-job hit on a value also in this job's registry is review-class);
  mandatory-class defined for the digest set (checksummed identifiers,
  emails, phones, secrets, full multi-token names of kinds person, patient,
  participant); this job's registry values and restored originals excluded
  from the cross-job query; the R2 test (owner's own name does not trip the
  switch; an unsent registry value does).
- §3.5 item 8 (L4 cross-job query, the addition noted above); §4.4
  registry origin `cross_job`; §3.0 L4 and L7 rows; §0.1; §0.2 Tracers row;
  Q12; §3.9 step 8; §4.6 `outbound_restored.replyScreen.screenedBeforeRestore`;
  §6 Restoration bullet; F6; §8.8; R2 work and exit gate; §9.4.

### 4 (medium) S-B per family with no family dimension in the corpus

- §8.2 new item 9 "Family and purpose": the suite-to-family mapping; at
  least ten packets per family × language cell for every family the S-B
  entry would name, at least two per purpose; a short cell is not named for
  that class; F2 per family × language. Item 6 rejects a sealed set with a
  short named cell; the Sizes paragraph says 120 is the suite × language
  minimum and the cell counts are reported.
- F2's consequence rewritten in stage-row terms (class not written into
  `languageClasses`; family not written into `families` when short or
  failing in any listed class; product rule), with r2's wording named.
- §4.7 "Product, not cells" bullet; Q2; §8.3 covering-recall row (per family
  × language); §8.7 S-B row (per cell, the entry names families with their
  cells); §0.2 Learned-layer row; R5 work and "does not prove"; D15-rev(f).

### 5 (medium) Judge-agreement comparator, owner time, sample size

- §8.2 item 4: the owner is the comparator (and why the ambiguity mattered);
  audited sample ≥ 60 propositions stratified by language (≥ 20 per class);
  gate on Wilson 95 % lower bound ≥ 0.80 with the arithmetic for r2's 36-60;
  the sample held out of judge-prompt iteration (a changed prompt is scored
  on a fresh 10 %); agent-auditor agreement reported separately and labelled.
- §9.2 new row (60 min per sealed version) and the total restated as about
  five hours; D26; §8.3 proposition row; F0; R4 work and exit gate (Wilson
  lower bound ≥ 0.80 on ≥ 60 adjudicated propositions); §11 judge bullet;
  Q14; §9.4 (judge work one day).

### 6 (medium) Composed estimate assumes independence

- §8.2 item 7: harvest recall per origin (27B harvest, OPF-plus-rules raw
  scan, union). Item 8: the withheld configuration also withholds every
  planted value the registry build missed on development; the product stated
  under a named independence assumption, the correlation explained (same
  27B, same OPF), withheld recall reported on the harvest-missed subset
  alone, and the composed estimate bounded by that figure.
- §3.2 item 2 (harvest recall per origin and why); §8.3 harvest and
  covering-recall rows; F0 (per origin); F2 (stated twice); §4.6
  `registry_built.byOrigin`; §11 numbers bullet; Q14; R5.

### 7 (low) `owner_marked` reveal cannot dispatch

- §3.4 reveal paragraph: the dead-button problem named; the exemption (not a
  registry entry of kind person, patient, participant or matter, not a
  regime identifier, preserve class on the template's list; button not
  offered otherwise); L4 and L6 check (map ∪ registry) minus exactly the
  logged reveal ids; manifest `reveals[]`; `outbound_decision` carries them;
  the R2 test.
- §3.5 item 2; §3.7 step 2; §4.1 `reveals`; §4.6 `outbound_decision`; §5.1
  (button offered only within the exemption); §5.3; §7.3; Q6; Q10; R2 work
  and exit gate; §9.4.

### 8 (low) F4 demotion in purposes, stage row has no `purposes`

- §4.7 `StageRowSchema.purposes` and `demotion.purposesKept`; "Demotion"
  bullet (narrows `purposes` to `[schema_review, plan_review]`; `eligible()`
  checks purpose; r2's gap named); "Absent means closed" (no purposes).
- §4.1 `stage.purposes`; §4.6 `stage_row_set` and `outbound_stage_denied`
  (`purpose`, `reason: purpose`); §3.0 L0 row; §3.1; §3.9 steps 3 and 7;
  §1.3; Q2; §5.1; §5.3; §7.2; F4; §8.7; R1 work and test (purpose outside
  the row refused at commit); R5; D15-rev(f).

### 9 (low) Entry hash cannot be verified by the app

- §4.7 "Writer" bullet rewritten: the surface takes the entry's committed
  text, parses the id, computes the SHA-256 and byte length and stores all
  three; refuses an id alone; r2's sentence named as presenting a recorded
  citation as a verified one; what is and is not verified; the writer
  restriction is the control. Schema fields `approvedEntryLength` and
  `recordedEntryLength`; `stage_row_set` and `code_decision_recorded` carry
  them; Q2; R1 work and test ("refuses an entry id without the entry text
  and stores the hash and length of the text it was given"); §4.1 snapshot.

### 10 (low) F1's two adjudication sentences conflict

- §8.2 item 4 and F1: the owner, and only the owner, may overturn a judged
  survival, with a recorded reason and the packet text; agent graders never
  may; a judged absence the owner finds present in the audited sample is an
  F1 miss and re-judges the whole split; r2's cancelling sentences named.
  R5 ("judged survivals overturned only by the owner").

### 11 (low) One reason-code list for five tags; resolved identifier's fate

- §3.2 item 1: per-tag lists (genomic: `synthetic_or_test_data`,
  `dataset_open_access_no_dua`; export/IP: `synthetic_or_test_data`,
  `data_is_the_owners_published_work`, `owner_holds_rights_and_releases`;
  the three per-packet tags keep the four codes with the ICD exception); the
  no-override codes accepted only in a per-context decision; the incoherent
  r2 pairing named; a resolved identifier becomes a `registered_identifier`
  placeholder unless the preserve list names it `public_identifier`, counted
  in the manifest.
- §4.1 `reasonCode` comment, `regimeSuggestiveLiterals`, new
  `RegimeContextDecisionSchema`; §4.6 `outbound_regime_context_decision`;
  §5.2 item 2 ("that tag's list"); §7.2 genomic/export row; D20(c).

### 12 (low) `more: true` continuation, flood, entry cap

- §3.2 item 2: continuation by deterministic sub-chunking at line boundaries
  (halves, deduplicated, at most four splits per original chunk, about 3k
  tokens at the leaf), never a model-reported offset; a leaf still reporting
  `more: true` is `flooded`; the entry cap is `entry_cap_reached`; both are
  harvest failures.
- §4.4 `failedChunks.reason` enum and `partial` comment; §8.2 item 7 and §8.8
  (the flood case in the harvest-injected subset); §3.9 step 2; Q3; §9.1
  registry row; R2 work; R5; §9.4.

### 13 (low) `eligible()` and the source-code check on derived sources

- §3.9 step 7: `eligible()` resolves the manifest through the bound grant
  and reads the parent context's sources from the store; derived sources
  carry `sourceClasses` joined from their parents (R1 schema); the D20(b)
  check uses the manifest's family and the parent's source classes; r2's
  builder-only statement named. Step 5 (`sourceClasses` join). The
  `phase2-repair.ts` call path corrected to `model.complete` →
  `model.ts:247-248`.
- Q19; §4.7 tests; R1 work and test (`.txt` derived source over a `.ts`
  parent refused while the row is absent); §13.

### 14 (low) Mac-stage deadline asserted; Thor stage omits the judge

- §8.5 item 3: Mac stage ≤ 120 × p95_OPF × 1.5 per configuration with p95
  from R3 (r2's 60 min named, with the 40-90 min arithmetic); Thor stage ≤
  120 × (p95_checker + n_props × p95_judge) × 1.5 with the judge's 360-600
  calls per configuration named; both into the freeze receipt. Item 2.
- §9.3 GPU row (the judge's device-hours); R3 work and exit gate (the
  Mac-stage p95 recorded); R4 (the judge's per-call p95 recorded).

### 15 (low) Private brief and job instructions in neither harvest nor index

- §3.2 item 2 (harvest inputs include the brief and the instructions, with
  the reason) and item 3 (index scope); §4.1 `indexScope` literal
  `owner_inputs_brief_and_restored_replies`; §3.5 item 2 (originals-absent
  set includes them); §3.1 cloud-brief paragraph (why the restatement can no
  longer carry an unknown name); §4.4 `harvestScope`; §4.6 `registry_built`;
  §3.9 step 2; §0.2 Known-value row; Q3; §9.1 registry row; R2 work; §9.4.

### 16 (low) Generator shares weights with harvester, checker and judge

- §8.2 item 2: the sharing named; the cloud-authored hard subset sized to at
  least ten documents per language; proposition recall and harvest recall
  reported on it separately. Item 7; §8.3 harvest and proposition rows; F0;
  §9.3 (the bucket, or a restatement); §11 judge bullet widened to the
  harvester and the generator; R5.

## Declined

None.
