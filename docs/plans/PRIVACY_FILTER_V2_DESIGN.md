# SOAR privacy filter v2: layered packet sanitisation for owner-approved cloud exposure

Status: **`Proposed` (2026-10-19, revision r3).** This document is the design
companion to the approved [plan](../PLAN.md) and to the
[private work design](PRIVATE_WORK_DESIGN_V1.md). It synthesises four lens
analyses written on 2026-10-19 (architecture, adversary and regulation,
evaluation and gating, state of the art) into one design; revision r1
applied the twenty findings of the adversarial refutation of the same day,
revision r2 applied the nineteen findings of the second refutation and
revision r3 applies the sixteen findings of the third (the change logs
[changelog.r1.md](privacy-filter-v2/changelog.r1.md), [changelog.r2.md](privacy-filter-v2/changelog.r2.md) and [changelog.r3.md](privacy-filter-v2/changelog.r3.md) list each). It grants no runtime, private-data,
provider or spending authority. Every gate named here still needs its own
recorded approval, and nothing in it changes the owner's rule until the owner
records a decision in §12.

The owner's direction of 2026-10-19, as relayed: cloud exposure of some derived
information from private (Tier O) work is probably necessary for quality, and the
filter should become a multilayer system; the example given was OPF as a first
pass, the local 27B as a second-pass checker and rules as a third pass, offered as
an example and not a requirement. The constraints that stand unchanged:

- the owner approves the exact bytes of any packet that leaves a labelled
  context;
- never for regime-tagged data unless the owner changes that rule explicitly;
- the audit chain records every dispatch;
- the local model never falls back to the cloud automatically;
- what crosses is derived material (plans, critique packets, code, schemas,
  structure), never raw files.

Where a refutation fix and a standing constraint, or two fixes, pulled in
different directions, r1 resolves toward the more restrictive reading and says
so at the place it does (§1.4, §3.4, §6, §8.4, §10, §12); r2 does the same
(§3.2, §3.4, §3.8, §4.1, §4.7, §8.6, §9.1, §12); r3 does the same (§3.2,
§3.4, §3.5, §3.8, §4.7, §8.2, §8.6, §9.1).

The evidence base: the Phase 2 provisional result (BL-20261019-0432: C-Sol 10/12,
L-Heavy 6/12 and 4/12; local matched or beat cloud on document review, decks and
websites and lost on research, coding and admin; rule R4 met at its boundary,
Branch B), the September privacy-filter trial
([PRIVACY_FILTER_RESEARCH.md](../PRIVACY_FILTER_RESEARCH.md)), and the code on
`main` (`scanner.ts`, `broker.ts`, `repair.ts`, `consultation.ts`,
`contracts.ts`, `store.ts`, `model.ts`). Sources are listed in §13. Nothing in
the repository was edited.

Timing words follow the private work design: *now* is cheap work that shapes
contracts and runs on synthetic data; *before real data* is the Tier-O gate;
*later* is after the first real use or for a firm, clinic or lab.

## 0. Summary and the choices made between the lenses

### 0.1 The design in one paragraph

A cloud packet for a labelled context is **built, not scanned**. A
purpose-specific template admits only derived material (an outline, a
zero-context diff, a schema, failing-check excerpts with quoted source replaced
by locators, a generic restatement of a question) and refuses before reading
any content when the context carries a regime tag or when the policy's
persisted stage does not yet permit a real packet. The candidate then passes
through restriction-only layers in a fixed order: a **deterministic pre-pass**
(credential and format rules, regime-suggestive identifier stops, the job's own
identifier registry, a provenance diff against the owner's input files), **OPF**
as a learned span detector, the **local 27B as a contextual checker** of the
already-placeholdered text under pinned sampling, and a **deterministic
post-pass** (originals-absent invariant, placeholder grammar and consistency,
generalisation transforms, budgets). Every substitution goes through a
host-owned **restoration map** whose placeholder codes are random per entity
and per packet, kept encrypted on the Mac, so the cloud reply can be
re-identified locally. The owner sees a diff, answers a short recorded form
with a per-tag regime checklist, and approves the **exact bytes**; the approval
becomes a one-use grant bound to the packet hash and a content-free **packet
manifest**. The broker's existing scan slot re-runs the deterministic checks
over the wire bytes; `eligible()` itself re-reads the parent Tier-O job's tags,
the install-level stage row and the D20(b) row at commit, on every path; and
the dispatch receipt is bound to the manifest. The reply is screened in tiers
with its placeholders intact, restored on the device, written as untrusted
advice, and recorded. Verdicts
are **monotone**: a layer may add a redaction or a block, never remove one; no
layer approves; the only release is the owner's approval of the final bytes.
Until an owner action that cites the S-B `Approved` entry writes the
install-level stage row (§4.7), the pipeline runs on synthetic and public
material only. The pipeline lowers what a packet discloses. It does not make
the packet anonymous, and the document says so wherever a number appears.

### 0.2 Where the lenses disagreed, and what this design picks

| Topic | Positions | Pick and reason |
| --- | --- | --- |
| Layer order | Owner's example: OPF, then 27B, then rules. Architecture: rules first, 27B third, structural last. Adversary: rules and provenance diff first, OPF second, 27B last content pass. Landscape: rules and learned detectors in union first, 27B on the masked text, deterministic checks last. Evaluation: decide "checker on original vs residual" on the development split. | **Deterministic first and last, learned in the middle, 27B as the last reader.** Rules are the cheapest layer and the only one no document can argue with, so a credential or a regime identifier blocks before OPF time or Thor time is spent, and the 27B never sees a raw credential. The 27B is the last reader because its question is "what in this outgoing text still identifies someone", which only makes sense on the residual. A deterministic pass must follow it because its output is a model's output. The owner's three mechanisms are all present; the order differs for cost and trust, and §3.0 maps the example to the layers. The residual-versus-original choice is still measured on the development split before the identity is frozen (§8.5). |
| Checker thinking mode and passes | Architecture: thinking off, 2,048 output tokens (the critic-cap lesson). Adversary: thinking on, large cap, at least two seeds, union of findings. Evaluation: thinking off or low effort, three repeats for stability. Refutation: 2,048 tokens cannot hold the schema; unpinned sampling measures the server's defaults. | **Thinking off, structured output, two concurrent passes per packet under pinned sampling (T = 0 and T = 0.3, fixed `top_p` and seeds), at most eight findings per pass with a `truncated` flag, a schema whose CJK maximum (about 2,600 tokens) fits inside an L3 timeout derived from a per-stream rate R4 measures, with a 25 % margin and a 450 s floor, on a dedicated admitted destination whose transport timeout sits above it, output cap 4,096 tokens, union of verified findings.** At 8,192 tokens with thinking on the local critic wrote nothing (BL-20261007-1529) because thinking consumed the budget; with thinking off the cap can be large enough to hold the schema, and a pass that does not end `complete` (timeout, length cut, malformed or empty output) is a block the owner cannot override (the checker was cut off, not fooled). r2 budgets at the plain-FP8 rate rather than pinning speculative decoding, the more restrictive of the two options offered, and shrinks the schema so its maximum fits; r3 moves the checker and the harvest off the coordinator's `standard` destination, whose 300 s transport timeout would have cut a CJK maximum pass before the design's own timeout fired, onto a dedicated destination, and derives the timeout from a rate R4 measures rather than from a community estimate (§3.4, §9.1). Two passes cost only latency when they run concurrently, and under monotone verdicts an extra pass can only add findings; their difference is by design (the two temperatures), not by the server's default, and the pins are part of the identity. Thinking-on is a development-split experiment under F0, not the default. |
| Checker authority | Architecture: its `block` stops the pipeline, owner may override with a reason code. Adversary: its "found" is a block, its silence is nothing. Landscape: never a pass authority; asks whether it should be blocking at all. Evaluation: demote to span proposer if it fails injection or stability limits (F4). Refutation: an unscoped override makes the only whole-context control advisory in practice. | **Restrict-only with a narrowly scoped owner override.** Its `placeholder` and `drop` findings are applied by the host after the quote is verified as a substring; its `block` stops the pipeline; the owner may override only a block from a `complete` pass that has no located quote or whose kind is `injection_attempt`, with a logged reason code; a block carrying a located `confidential_fact` or `reidentification` quote has two exits, edit-and-rerun (which records the lineage, §4.1) or decline; a block from a pass that is not `complete` has no override at all, because a timeout carries no quote for the same reason a length cut does not. A rules or structural block has no override at all. Its `clear` is not a verdict and is never shown as one. F4 keeps the demotion path, and the demotion is written into the stage row by family (§8.6, §4.7). |
| Packet size | Architecture and evaluation: 64 KiB (the repair cap) is the object under test. Adversary: 16 KiB for labelled packets, split and approved per part, because nobody reads sixteen pages after a bad draft. | **16 KiB template default, 64 KiB hard cap with an explicit size acknowledgement.** The templates in §3.1 send outlines and locators, not renderings, so 16 KiB is realistic. Splitting one packet into several multiplies dispatches and linkage (A5), so a larger packet stays one packet, paginated in the diff view, and the owner ticks `large_packet_acknowledged`. The evaluation corpus still exercises 64 KiB packets so the worst-case latency is known. |
| Placeholder form | Architecture: `«PERSON_3»`, sequential per packet. Adversary: fixed grammar, per-packet salt, no sequential numbering (it reveals party counts and order of appearance), HIPAA 164.514(c) as the rule. Landscape: typed `[PERSON_1]` with a per-task vault. Refutation: a keyed HMAC of the name is still derived from information about the individual under 164.514(c)(1). | **Typed, guillemet-delimited, random: `«PERSON_7f3a2c»`.** Guillemets survive Markdown and JSON, are not an HTML tag and are easy to find on return. The six-hex suffix is drawn from a CSPRNG per entity and per packet and stored only in the map, so the same entity has one placeholder inside a packet, a different one in the next packet, and the code is derived from nothing about the individual; this is the more restrictive of the two options the refutation offered, and it removes the keyed-hash question rather than citing guidance for it (§6, §7.1). The type is kept because the critic needs it; distinct-placeholder counts per type are therefore visible in the packet, and §11 says so. |
| Learned-layer composition | Landscape: union OPF with GLiNER2-PII and a Chinese detector or an OPF fine-tune. Architecture: OPF alone. Evaluation: a layer stays only with measured marginal recall (F5). Refutation: OPF alone cannot meet F2 on zh without the registry, and a registry-dependent pass says nothing about unregistered names. | **OPF alone in v2.0; union members only through F5 and a sealed pass; S-B opens per language class.** The September lesson is that correlated layers add nothing (OPF plus rules scored exactly OPF). The classes OPF is weakest on (`account_number` 0.13, `secret` 0.33) are format problems that the rules layer and the registry cover more cheaply than a second neural reader. Because F2 and F5 are read over the withheld gold subset of the registry-withheld configuration (§8.2, §8.3), so that a registry hit cannot stand in for a learned-layer catch, zh and mixed contexts stay at S-A until F2 passes there, a family opens only where its family × language cell met the corpus minimum (§8.2 item 9), and a packet is classed `mixed` on the presence of any CJK run rather than its share (§3.1); the Chinese-name detector is the first v2.1 candidate and the expected route to opening zh, because OPF's independent zh person score is 0.138; it needs its own freeze, Viterbi-decoder check and licence record. |
| Known-value protection | Architecture: originals-absent invariant over map and registry values. Adversary: provenance diff of any N-character run from a labelled source, with a refusal above a copied-bytes share. Evaluation: a per-job known-value list extracted by OPF and rules over the raw inputs. Refutation: "from a labelled source" is ambiguous because the draft is itself labelled, and the templates admit verbatim prose the diff would then refuse. | **All three, in L1 and again in L4, with the provenance index defined over the owner's input files, the private brief and job instructions, and restored cloud replies, never over the agent's own outputs; and templates that carry locators, not quotes.** They cover different misses: the registry catches a known entity anywhere, the provenance diff catches a verbatim passage the agent copied without understanding, the known-value extraction seeds the registry with the identifiers the raw files contain. None needs a model to agree. The index scope is recorded in the manifest so the rule cannot drift. |
| Consent step | D15 as answered: a consent reminder. Architecture: a checkbox. Adversary: a recorded form (basis, data-subject categories, counts, provider posture). Evaluation: two mandatory questions before the button exists. Refutation: one yes/no regime question lets an untagged privileged matter through; one `basisCode` field mixes a legal basis with a conduct step. | **A short recorded form (§5.2, §7.2) with a five-row per-tag regime checklist, a legal basis and a separate professional-analysis flag.** Answers from fixed lists, hashed into the decision event. A reminder that is dismissed records nothing; the breach, client and privilege questions in §7.3 need the answers, and the record must later say what the Art 6 basis was. |
| What the record keeps | P8 and architecture: content-free hash chain. Adversary and evaluation: keep the exact sent bytes and the restored reply encrypted under the job's retention, because a hash cannot answer "what did you send about me". | **Both.** The chain stays content-free. An encrypted copy of the wire bytes and the restored reply lives in the job workspace under the job's retention, readable only while the install's key exists (§6, D27), and the deletion residual report says that after deletion the ledger can say what kind of disclosure occurred and not what. The retention period for labelled jobs is an owner decision (§12). |
| Tracers | Evaluation: a nonce tracer in every packet plus an optional honeytoken URL on an owner-controlled domain, and a response-echo scan. Others: silent. Refutation: a tracer keyed on the dispatch id cannot be in the approved bytes, because the broker creates that id at commit. | **Nonce tracer keyed on the manifest id, and a tiered response-echo scan run over the reply before restoration with the digest set's membership defined, yes; honeytoken URL, owner opt-in only.** The manifest id exists at L0, so the tracer is in the bytes the owner approves; the receipt records the manifest id so a found tracer still resolves to one dispatch. The tracer and the echo scan are free and host-side. The cross-job half of the echo scan consults an exact set of salted HMAC digests, not a bloom filter: a probabilistic structure queried hundreds of times per reply would trip the incident switch on false positives (§3.8). A honeytoken domain discloses the owner's domain to the provider. |
| OPF placement | Research doc and architecture: Mac child process (the only measured placement). Landscape: either; Jetson memory is not the constraint. Evaluation: 64 KiB latency on the Mac is unmeasured. | **Mac first, with a measured entry condition.** p95 on 64 KiB packets is a Stage A entry condition; if it fails, OPF moves to the Thor's CPU cores after the hardening list closes and a re-freeze. |
| Generalisation transforms | Adversary: date shifting, age decades, locality to region, cell-size floors, amount bucketing at construction time. Architecture: shape minimisation only. | **A bounded set in L4, by template:** relative dates, age decades, locality dropped below region, small-cell suppression, with the brief's preserve-literals list as the override. Amount bucketing and date shifting with an anchor check are later, because an anchor leak is easy to make and hard to see. Every transform is measured in the utility study. |
| Where S-A runs | Evaluation lens wording, copied into the first draft: the pipeline runs on every outbound packet from a labelled context, advisory. Refutation: read literally that permits real packets under an unconfirmed filter and relaxes D15. | **S-A runs on synthetic and public material only, enforced in `eligible()` by one install-level stage row (§4.7) that only an owner action citing the S-B `Approved` entry by id and hash can write, snapshotted into each job's policy and each manifest and re-read from the install row at every commit (§8.7, Q2).** The intent was always synthetic-only; the permit text is what a future entry would cite, so the permit text now says it and the broker enforces it. r1 said "the entry writes the stage", which named no writer and no home (the policy is per job); r2 names both. |

## 1. Goal and boundary

### 1.1 Goal

Let the owner send one approved packet of derived material from a labelled
(Tier O) job to `gpt-6-sol` when they judge the local result insufficient, with
the packet carrying as little identifying and confidential content as the task
allows, with every byte shown to and approved by the owner, and with a record
that can later answer who, what, when and under what basis. The filter exists
to make the owner's decision better informed and the packet smaller; it does not
make the decision and it does not make the packet safe.

### 1.2 What crosses

Only what a template renders (§3.1). Each template admits named kinds of derived
material and excludes everything else by construction. The first templates:

| Purpose | Admitted | Excluded by construction |
| --- | --- | --- |
| `repair_critique` | The cloud brief (§3.1); per draft file an outline (headings, section lengths, table shapes); bounded excerpts around failed host checks drawn from the agent's own output, with any run the provenance index matches replaced by a locator; the self-check text with its quoted source fields stripped to locators | Full text renderings of draft files. For the document-review family, the clean copy, the full redline and the anchor quotes of the edit plan (§3.1, the finding about today's repair packet) |
| `code_review` | File tree; function and class signatures; the unified diff of the agent's own change at zero context (`-U0`), with removed lines that the input index matches replaced by `[file:line-range, n lines]` locators; failing test names and assertion messages with quoted source stripped; the cloud brief | Diff context lines, fixtures, `.env`, configuration with values, logs, binaries, any file the diff did not touch |
| `schema_review` | Table and column names, types, nullability, row counts, cardinalities; type-shaped example rows | Any real row |
| `plan_review` | Plan steps, acceptance checks, tool budget, what failed | Inputs, observations, source quotes |
| `research_framing` | A generic restatement of the research question written locally; the claims ledger's shape (counts, support rate, conflict types) | Source quotes, titles that identify a matter, ledger rows |

Everything admitted still passes through L1-L4, the owner and the wire gate. A
template is code with a version, a hash and a copied-bytes threshold, all
recorded in the manifest.

### 1.3 What never crosses

- Raw files, text renderings of whole inputs, verbatim third-party prose
  (quotes of a client's email, a patient's account, a manuscript under review).
  This includes the anchor quotes of an edit plan, the context and removed
  lines of a diff, and the quoted source inside check output; the templates
  carry locators in their place (§3.1), and the provenance diff refuses a
  packet that reproduces input text above the template's threshold (§3.2).
- Anything from a context carrying a regime tag (`legal_privileged`,
  `health_phi`, `research_human_subjects`, `controlled_access_genomic`,
  `export_controlled_or_unpublished_ip`). The builder refuses before reading
  content; `eligible()` refuses a cloud destination for such a context
  regardless of any grant, and checks the parent Tier-O job's context, not
  only the sub-context the builder made, inside `eligible()` itself and not in
  any caller-supplied callback (§3.9). For `controlled_access_genomic` and
  `export_controlled_or_unpublished_ip` the product has no override path, and
  a `regime_suggestive` stop for either has no per-packet exit at all (§3.2).
  For the other three, only an explicit, recorded owner rule change per tag
  opens a path, and §8.7 names the evidence it would need.
- Any packet of family `coding`, and any packet from a non-synthetic context
  whose sources include source-code files, while the install-level D20(b) row
  (§4.7) is unrecorded: the builder refuses it with
  `outbound_regime_tagged_denied` and `eligible()` re-reads the row at commit.
  "Treated as tagged" is enforced by the same code path as a tag, not by a
  checklist row the owner can flip.
- Any packet from a non-synthetic context labelled `personal` or above while
  the install-level stage row (§4.7) is not `S-B` for the packet's language
  class, family and purpose, which only an owner action citing the S-B
  `Approved` entry writes (§8.7). `eligible()` re-reads the install row at commit and refuses
  regardless of any grant and of what the job's policy snapshot says.
- The restoration map, the identifier registry, the private brief, labels,
  paths, document metadata, comments, tracked changes, speaker notes, hidden
  sheets, and any value on the map or the registry in raw or normalised form.
- Any packet without a one-use grant bound to its hash, and any packet whose
  context, policy, parent chain or grant changed between approval and dispatch.

### 1.4 Three facts the design is built around

- **A pseudonymised packet is still personal data** (design §1; GDPR Art 4(5),
  PIPL Art 73(3)). A placeholdered critique of one patient's summary or one
  client's matter is derived personal data about that person or matter, and
  often still PHI or privileged substance. The layers protect identities inside
  a disclosure the owner has decided to make; they do not decide whether the
  disclosure is acceptable.
- **Most Tier-O work carries a regime tag.** The V1 presets map privileged or
  client-confidential, PHI, unpublished manuscript and unpublished research
  data to Tier O with their tags. Under the constraints as they stand, v2
  serves labelled contexts *without* a regime tag: admin without PHI or
  privilege, non-privileged business documents, the owner's own notes and code.
  The evaluation suites still measure PHI, privilege and unpublished-result
  leakage so that, if the owner later changes a tag's rule, the evidence exists.
  Measuring does not open a tag.
- **A tag exists only where the owner chose a preset.** "Never for regime-tagged
  data" must not degrade to "never for data the owner remembered to tag". So
  the rules layer treats regime-indicative identifier families (案号, docket
  forms, record-number and MRN shapes, ICD codes, dbGaP and other accession
  forms) as regime evidence and stops on them (§3.2); the form asks per tag,
  pre-set to the strongest plausible tag for the family (§5.2); and whether the
  owner's private source code is `export_controlled_or_unpublished_ip`, which
  P1 leaves undefined today, is an owner decision (D20(b)). Until the owner
  answers, private source code is treated as tagged, which is the more
  restrictive reading and means `coding` is not the first real family by
  default (§10). "Treated as tagged" is a store-level fact, not a form
  default: the D20(b) answer lives in one install-level row (§4.7) with the
  recording entry's id and hash, and while that row is absent the builder
  refuses family `coding` and any non-synthetic context with source-code
  sources exactly as it refuses a tagged context, the checklist row for the
  tag is locked "applies" and not answerable, and `eligible()` re-reads the
  row at commit. r1 enforced this only through a pre-set checklist row the
  owner could change per packet, which was an override path for a tag the
  product says has none.

## 2. Requirements, with timing

| # | Requirement | When |
| --- | --- | --- |
| Q1 | **Built, not scanned.** Packets come from versioned templates that admit named derived material (§1.2). The renderer that feeds a template is disclosure-aware: no comments, revisions, notes, hidden sheets or cells, document properties or paths. Third-party text is carried as locators, never quotes. The cloud brief is a separate field the owner writes for the cloud, pre-filled from a generalised rendering; the private brief never goes out. | now |
| Q2 | **Regime refusal and stage refusal before content.** P1's label lattice and regime tags become persisted contract (today only `public \| private \| credential` exists). The D20(b) answer on private source code is one install-level row (§4.7) carrying the recording entry's id and hash; while it is absent, family `coding` and any non-synthetic context with source-code sources are refused with `outbound_regime_tagged_denied`, the same code as a tag. The stage is one install-level row `{level, languageClasses, families, purposes, approvedEntryId, approvedEntrySha256, approvedEntryLength, setAt}` (`S-A` when absent), written only by an owner action in a surface that takes the entry's committed text and computes the hash itself, snapshotted into each job's policy at creation and into each manifest, and re-read from the install row by `eligible()` at every commit; the row is a product, so a packet is open only when its language class, family and purpose are each listed (§4.7). The builder refuses a regime-tagged context, or a non-synthetic restricted context whose stage is not `S-B` for its language class, family and purpose, before reading content; `eligible()` denies cloud for any of these regardless of grant; no product path exists for the genomic and export-controlled tags. | now |
| Q3 | **Deterministic pre-pass (L1).** Rules v2: today's five credential regexes plus vendored Gitleaks-class and detect-secrets-class patterns (MIT and Apache-2.0 only; no TruffleHog), `key=`/`token=`/`口令=`/`密钥=` secret-after-key forms, split and multiline literals, local paths, private hostnames and RFC 1918 addresses, and checksummed identifiers (Luhn, IBAN mod-97, GB 11643 身份证 with ISO 7064 MOD 11-2, GB 32100 统一社会信用代码, `1[3-9]\d{9}` mobiles, 案号 forms, docket forms, and the owner's registered record-number shapes), all after NFKC normalisation and a bounded one-level decode of base64, hex, URL and `\uXXXX` forms with zero-width characters stripped. Hits in the regime-indicative families are `regime_suggestive` hard stops, not placeholders, and for the two no-override tags the stop has no per-packet exit (§3.2). The per-job identifier registry (§3.2), built on the first cloud action in output-bounded streaming chunks over the rendered inputs, the private brief and the job instructions, on the dedicated filter destination (§3.4), continued by deterministic sub-chunking bounded per chunk; a cut, malformed or flooded harvest call, or the entry cap, is a harvest failure that marks the registry `partial` and holds the first packet. The provenance diff over the owner's input files, the private brief and job instructions, and restored replies, never over the agent's outputs. | now |
| Q4 | **OPF worker (L2).** The pinned checkpoint and source (`7ffa9a04…`, `f7f00ca7…`), the `adapter.py` protocol, a persistent sandboxed child process on the Mac with network denied, span-only output, chunking by the OPF tokenizer's count (≤ 7,000 tokens) at line boundaries, lazy load and idle unload. The sealed confirmation that never ran is run once, after the trial tree moves off iCloud. | now (worker); before real data (confirmation) |
| Q5 | **Local contextual checker (L3).** A fixed, versioned prompt and JSON schema, structured output on vLLM (`responseFormat: {type: "json_schema", schema}` on the request builder, the mode and the vLLM version in the layer identity beside the schema hash), thinking off, sampling pinned per pass (`temperature`, `top_p`, `seed`, all three on the request builder's `sampling` field) and carried in the layer identity with the served model identity, run on a dedicated admitted destination (`thor_filter`: thinking disabled, 4,096 output tokens, streaming with an inactivity clock, `timeoutMs` 720 s, `maxRequestBytes` 640 KiB, its values in the layer identity, §3.4); two concurrent passes; at most eight findings per pass with a `truncated` flag; an L3 timeout derived as (CJK schema maximum / measured per-stream p5 rate + prefill) × 1.25, never below 450 s, with the destination's `timeoutMs` above it, and a pass that completes past the no-margin figure recorded as a budget warning; output cap 4,096 tokens; any pass that is not `complete` (timeout, length cut, malformed or empty) a non-overridable block; quotes verified as substrings, restrict-only actions, silence treated as no information. | now |
| Q6 | **Deterministic post-pass (L4).** Originals-absent invariant over map and registry values (the brief's and instructions' values included), the set being (map ∪ registry) minus exactly the logged reveal ids (§3.4); the cross-job digest query over the final bytes (§3.5 item 8); provenance diff re-run on the input index; placeholder grammar and entity consistency; generalisation transforms by template; shape minimisation; budgets; the existing known-credential check. The only layer whose `complete && !blocked` reaches the broker. | now |
| Q7 | **Monotone verdicts, fail closed.** `clear < redact < block`; the pipeline's verdict is the join; a non-`complete` layer is `block`, and for the checker a non-complete pass is a block with no override; no layer approves; a crashed, stalled or length-cut layer never means skip-and-proceed, and neither does a cut or malformed harvest call, which is not a layer but gets the same shape (§3.2). | now |
| Q8 | **Host-owned restoration map (§6).** Fixed grammar, random per-entity per-packet codes stored only in the map, never derived from the original or the entity key, stored encrypted under a Keychain key in a store the renderer and the sandbox cannot reach, consumed on return, deleted with the job. Adopted as the placeholder policy for every regime after HIPAA 164.514(c)(1), with the keyed-hash question avoided rather than argued (§7.1). | now |
| Q9 | **Owner approval surface (§5).** Diff view with every layer's flags, the copied-bytes share, the provider posture line, the count of packets already sent about this matter; the recorded form with the per-tag regime checklist, the legal basis and the professional-analysis flag; the button disabled until the conditions in §5.3 hold; the checker override scoped to unquoted or injection blocks; checker free text shown as untrusted; never on the screen that shows the failing local result; 16 KiB default; one packet per task by default. | now (surface); before real data (form content once D14 names jurisdictions) |
| Q10 | **Wire gate binds bytes to manifest, in two modes.** With a binding (`{jobId, contextId, grantId, purpose}`), the composite scanner in the broker's scan slot re-runs L1's rules and the originals-absent invariant over the wire text ((map ∪ registry) minus the manifest's logged reveal ids), checks that the body embeds the approved content hash, verifies the tracer's HMAC keyed on the manifest id, and returns `manifestSha256` and `manifestId` in the receipt. Without a binding (public web GETs), it runs rules only, returns no `manifestSha256`, and the receipt says so. The `grantFreeSynthetic` destination kind is refused in the desktop profile. Receipts gain the provider posture snapshot. | now |
| Q11 | **Audit chain.** `prevSha256` on every event and receipt with a verifier; the new event types in §4.6; the consultation proposal event stops carrying packet text (the text moves to the encrypted proposal store, R1) and a CI test bounds event row size; the per-job disclosure report lists every proposal that reached a receipt and every override with its finding kind. | now (contract); before real data (verified) |
| Q12 | **Return path (L7).** Screen the reply **before restoration**, placeholders intact, with L1's rules in two tiers (incident-class and review-class), the injection kind, a request-for-more-data detector, and an exact set of salted HMAC digests of mandatory-class values (checksummed identifiers, emails, phones, secrets, full multi-token names of kinds person, patient and participant) across live jobs in place of other jobs' plaintext registries, this job's own registry values excluded from the cross-job query (no probabilistic structure feeds the incident switch); then restore on the device; strip the tracer; write the reply as untrusted advice; a reply is never an input to another cloud packet without passing the pipeline and a fresh approval. | now |
| Q13 | **The record can answer, while the key exists.** The wire bytes and the restored reply are kept encrypted in the job workspace under the job's retention; the chain holds the hashes; the record answers "what did you send about me" only while the install's Keychain key exists, unless the owner elects a recovery secret (D27); the deletion residual report states what the ledger can and cannot say afterwards and the key dependency. | before real data |
| Q14 | **Evaluation v2 (§8).** Packet-shaped corpus with gold by construction placed inside the regions each template admits, planted confidential facts annotated as propositions, harvest recall measured per origin and on the cloud-authored subset, every sealed pass run registry-on and registry-withheld with the harvest-missed values among the withheld, four profession suites in three languages plus a cross-cutting suite with a family × language minimum for every family the S-B entry names, the proposition judge's agreement with the owner on an audited sample of at least 60 propositions, sealed protocol v2, pre-registered rules F0-F7, red-team rounds, the utility study with a raw-packet arm. | now (authoring, development split); before real data (sealed pass) |
| Q15 | **Provider posture verified and recorded.** Before the first labelled packet: the API retention class for this account (zero data retention or the default abuse-monitoring window), BAA availability for the Responses API with reasoning, the DPA and transfer mechanism on file. Per dispatch: terms snapshot hash, `store: false`, service tier, model, retention class as believed. | before real data |
| Q16 | **Pipeline hygiene.** Detectors run with network denied; originals are never logged, cached by text, or shown in telemetry; the Thor's request and output logging stays off (P10); the trial tree and all SOAR state are off iCloud (P9). The filter pipeline is itself an exfiltration surface and is treated as one. | before real data |
| Q17 | **Per-tag regime path.** None by default. Opened only by a recorded owner decision per tag with the preconditions in §7.2 and the evidence in §8.7. | later (never by default) |
| Q18 | **Learned-layer union candidates.** A Chinese-name detector, GLiNER2-PII, an OPF fine-tune on SOAR's synthetic corpus, each admitted only through F5 on the development split (registry withheld) and one sealed pass, with its own freeze, decoder check and licence record. The Chinese-name detector is the expected route to opening S-B for zh. | later |
| Q19 | **Parent-chain binding.** A `cloud_help` sub-job persists `parentJobId` and `parentContextId`; the store refuses to create one whose parent context has regime tags, whose parent policy is not cloud-help-eligible, or whose parent stage is not `S-B` for a non-synthetic context; sub-context sources are derived sources carrying the join of the parent's labels (P1) and `sourceClasses` joined from the parent sources' extension classes, and are `synthetic: true` only when every parent source is; `eligible()` itself reads `parentJobId`/`parentContextId` from the store for any `cloud_help` context, resolves the manifest through the bound grant, reads the parent context's sources for the D20(b) check, and re-checks the parent chain on every commit, whether or not the caller passed a `validateAtCommit` callback (that argument is optional in `broker.ts` and `phase2-repair.ts` omits it). | now |
| Q20 | **Checker free text and reveal.** `reason`, `usefulReason` and reveal suggestions are shown as untrusted model text; a reveal names a preserve-literal class, never free text; when any pass reports `injection_attempt`, reveal suggestions and `useful: false` reasons are suppressed. | now |

## 3. The layer pipeline

### 3.0 Overview

| Layer | Role | Input | Output | Verdict record | On failure |
| --- | --- | --- | --- | --- | --- |
| L0 Build | Decide what is rendered at all | Job brief, frozen draft, self-check events, labels, the install-level stage and D20(b) rows (§4.7), registry state, purpose, family | Candidate text, provenance list, language class (by CJK presence), manifest start | `outbound_built` | Regime tag; family `coding` or a non-synthetic context with source-code sources while the D20(b) row is unrecorded (`outbound_regime_tagged_denied`, the same code as a tag); offline mode; a destination without `requireExactGrant`; a non-synthetic restricted context while the stage row is not `S-B` for its language class, family and purpose (`outbound_stage_denied`); a registry still `partial` without an acknowledged reason (`outbound_registry_partial`): refuse before content |
| L1 Deterministic pre-pass | Hard blocks, regime-suggestive stops and known-value placeholders | Candidate, registry, input-source n-gram index | Spans (block, placeholder), `regime_suggestive` stops, findings | `outbound_layer` (`rules`) | Any exception is `failed`, hence block; an unresolved `regime_suggestive` stop is a block until the owner answers per tag with a regime-statement reason code (§5.2); for the two no-override tags the stop discards the packet and only re-labelling or a recorded per-context decision changes the next packet (§3.2) |
| L2 OPF | Learned span proposals in prose, including Chinese and mixed text | L1 residual, chunked by token count | Spans (placeholder), findings | `outbound_layer` (`opf`) | Timeout, tokenizer round-trip mismatch, invalid offsets, incomplete chunk: `failed`, block |
| L3 Local checker | Whole-context sensitivity, re-identification from facts, aliases, over-redaction, injected text | L2 residual, purpose, family, label level, placeholder type counts, the registry entries not already resolved to a placeholder (local only, capped) | Verified findings as spans (placeholder, drop), reveal suggestions by preserve class, block, usefulness, `truncated` | `outbound_layer` (`local_checker`), one per pass with its sampling pins | Any pass whose status is not `complete` (timeout, length cut, malformed or empty output): block with **no override**, because a cut-off pass has no located quote to show and the packets most likely to be cut are the ones with the most to report; the L3 timeout is derived from the schema's CJK maximum at the per-stream rate R4 measures, with a 25 % margin and a 450 s floor, on a destination whose transport timeout sits above it (§3.4, §9.1), so a timeout is rare and counted (F4); a pass that completes inside the margin is `complete` with a budget warning; the owner sees which pass and why |
| L4 Deterministic post-pass | Invariants, consistency, transforms, budgets | L3 residual, map, registry, input-source index, cross-job digest set | Final content, placeholder density | `outbound_layer` (`structural`) | Any invariant failure: block with the invariant named; no override |
| L5 Owner | The only release | Diff, findings, form, posture, counts | `approve`, `decline`, `revoke`; overrides with reason codes, only where §5.3 allows | `outbound_proposed`, `outbound_decision` | Decline or revoke: nothing leaves |
| L6 Wire gate | Prove the bytes leaving are the bytes approved | Wire text, grant, manifest, map (binding present); wire text alone (binding absent) | `{complete, blocked, detector, mode, manifestSha256?, manifestId?}` | Dispatch receipt | `packet_scan_failed` or `packet_scan_incomplete_or_blocked`, as today |
| L7 Return path | Screen with placeholders intact, re-identify locally, record | Reply bytes, map, cross-job digest set | Screen result by tier; restored reply as untrusted advice; counts | `outbound_restored` | Map missing: reply stays placeholdered and is marked `unrestored` |

Mapping to the owner's example: OPF is L2; the local model is L3; rules are L1
and L4 (and the wire gate). The three mechanisms the owner asked for are all
present; the deterministic one runs twice.

Every layer implements one interface. The host, not the layer, applies spans
through the restoration map and recomputes the text between layers:

```ts
interface FilterLayer {
  readonly name: "rules" | "opf" | "local_checker" | "structural";
  readonly identity: string;   // config, weights, prompt, schema and sampling hashes, like RulePacketScanner.identity; for the checker also the structured-output mode and the vLLM version
  run(input: LayerInput, signal: AbortSignal): Promise<LayerOutput>;
}
interface LayerInput { text: string; manifest: OutboundPacketManifest; registry: IdentifierRegistry; map: RestorationMap }
interface LayerOutput {
  status: "complete" | "timeout" | "failed";
  verdict: "clear" | "redact" | "block";
  spans: SpanRecord[];       // additions only
  findings: Finding[];       // human-readable, for the diff view; model-written text is marked untrusted
  truncated?: boolean;       // the layer had more to report than the finding cap (checker only; a cut output is status "failed" or "timeout", never "complete")
  budgetWarning?: boolean;   // checker only: complete, but later than the no-margin figure (§3.4); reported under F4, never a demotion
  errorCode?: string;        // fixed codes, never library text
  elapsedMs: number;
}
```

The composed identity recorded in every receipt is the hash of the four layer
identities (the checker's including its sampling pins, its structured-output
mode and vLLM version, and the served model identity, P16), the template hash
and the pipeline version, so an audit can later scope "every packet approved
under filter version X".

### 3.1 L0: the builder

Location: a new `src/main/private-agent/outbound/` module. It is called only
from an owner action in the session surface ("Ask the cloud about this draft"),
never as a model-callable tool (P3: labelled jobs are closed-corpus and the tool
is not offered). Whether that action is offered only after a bad local result or
at any point in a labelled job is part of the D15 revision (§12).

The builder refuses before reading content when the context's regime tags are
non-empty; when the family is `coding`, or the context is non-synthetic and any
of its sources is a source-code file (by the builder's extension-class list,
whose hash is part of the template record), while the install-level D20(b) row
(§4.7) is unrecorded, with the same code a tag produces,
`outbound_regime_tagged_denied`; when the policy mode is `offline`; when the
destination is not a `cloud_model` with `requireExactGrant`; when the context
is non-synthetic and labelled `personal` or above while the install-level
stage row is not `S-B` for the packet's language class, family and purpose
(`outbound_stage_denied`); and when the job's registry is `partial` without an
acknowledged reason code (`outbound_registry_partial`, §3.2). It reads the
stage and D20(b) rows from the install store, not from the job's policy
snapshot, so a job created under S-B does not outlive a revert.

**Language class, by presence and not by share.** The builder records the
class (`en`, `zh`, `mixed`) in the manifest because S-B opens per language
class (§8.7). r1 classed "by script share over the candidate", which let a
mostly-English packet whose parties are 李伟 and 王芳 class as `en`: the names
are a small share of the bytes and exactly what OPF misses on zh (0.138
independent recall). The rule is now: after NFKC, any run of two or more CJK
codepoints anywhere in the candidate, or any CJK entry in the job's registry
(the registry's own script is consulted, because a registered Chinese name
can surface in pinyin or in a later turn), makes the class at least `mixed`;
`zh` when CJK codepoints are the majority of letter codepoints. The manifest
records the rule version, the CJK run count and the CJK registry-entry count
(`languageClassEvidence`, §4.1). A development-split check asserts that no
`en`-classed packet contains a CJK gold span (§8.2).

**A finding about today's repair packet.** For the document-review family the
draft output *is* the owner's input with changes: a redline of the client's
contract, a clean copy of a note. `buildRepairPacket` sends a text rendering of
each required draft file, so for that family the Phase 2 H mechanism would send
the raw document in all but name. The `repair_critique` template therefore
sends the issues list and the tracked-change summaries for document review,
never the clean copy or the full redline text, and the manifest records the
family so the checker knows what it is judging. This is a template rule, not a
detector problem, and it is why Q1 comes first.

**Locators, not quotes.** Three admitted kinds carried verbatim third-party
prose in the first draft of this design, which §1.3 forbids and which the
provenance diff (§3.2) would then refuse: the anchor quotes of the edit plan
(design V1 §4: anchor quote, action, new text, rationale), the context and
removed lines of a unified diff, and the quoted source inside `check_claims`
output. Each is now a locator. The document-review issues list carries a clause
or paragraph number from the rendered numbering with a character range, the
action, the agent's rationale and the agent's new text; the client's words do
not go. `code_review` sends `-U0` hunks, and a removed line that the input
index matches becomes `[file:line-range, n lines]`. Check output goes with its
quote fields stripped to a locator and the check's verdict. Where the agent's
new text reproduces input text above the template's copied-bytes threshold, the
provenance diff refuses the packet; that is the intended outcome for a template
that cannot say anything without quoting, and the owner is told why.

**The cloud brief.** The owner's own brief is the commonest leak ("review my
reply to Dr Chen's referral for the Li family"). The template carries a separate
cloud brief, pre-filled by the local model as a generalised restatement, edited
by the owner, and run through L1-L4 like everything else. The private brief
never goes out. The private brief and the job's instructions are harvest
inputs and part of the provenance index (§3.2), so a name that occurs only
there ("Dr Chen", "the Li family") is a known value to L1 and L4 and cannot
reach the cloud brief unplaceholdered through the local model's restatement;
in r2 neither the harvest nor the index covered them.

**Tracer.** Every labelled packet carries one inert reference in the brief
header, `Reference: SOAR-REF-<nonce>`, where the nonce is an HMAC of the
**manifest id** under a Keychain key, truncated to 20 base32 characters. The
manifest id exists at L0, so the tracer is inside the bytes the owner approves
and inside `contentSha256`; the dispatch id cannot serve, because the broker
creates it at commit after the wire text is frozen and hashed, and because the
consultation flow proposes at one time and dispatches at `resume`. The receipt
records `manifestId` beside `scan.manifestSha256`, so a tracer found anywhere
later resolves to one dispatch by recomputation; no table of tracers exists.
The wire gate allowlists a tracer only when its HMAC verifies against the bound
manifest; anything else tracer-shaped is data. The tracer is stripped from the
reply before `withRepair` sees it, with a CI test.

### 3.2 L1: deterministic pre-pass

Runs first. Cost: milliseconds. Three sources of findings.

1. **Rules v2** (Q3). A credential, private-key, local-path or private-host hit
   is a **hard block** with the pattern named; a checksummed identifier hit
   outside the regime-indicative families is a **placeholder**. A hit in a
   **regime-indicative family** (案号 and docket forms, record-number and MRN
   shapes, ICD codes, dbGaP and other controlled-access accession forms, the
   owner's registered record-number shapes marked as regime) is a
   `regime_suggestive` **hard stop** with no override: the pipeline halts and
   the owner must either tag the context (the packet is discarded and the
   context re-labelled) or record, per suggested tag, an explicit "this regime
   does not apply" answer with a reason code from a fixed list (§5.2); the
   answer is logged as an override of kind `regime_suggestive` and appears in
   the disclosure report. The reason codes are **statements about the
   regime**, not about the identifier: `owner_is_the_party`,
   `synthetic_or_test_data`, `no_client_or_patient_relationship`,
   `data_is_the_owners_published_work`. r1 also offered `public_record` and
   `identifier_not_of_a_person_or_matter`; both answer whether the identifier
   is public (a dbGaP accession is a public identifier for a controlled-access
   dataset, a docket number is public for a privileged memo), which is true
   and establishes nothing about the tag, so `public_record` is gone and
   `identifier_not_of_a_person_or_matter` is accepted only for ICD-shaped hits
   in the `general` and `website` families. For the two tags the product has
   no override path for, `controlled_access_genomic` and
   `export_controlled_or_unpublished_ip`, a suggestive stop has **no
   per-packet exit**: the packet is discarded, and the only ways a later packet
   from the same context is built are re-labelling the context with the tag
   (then nothing leaves) or a **recorded per-context owner decision**, made in
   the job surface and not in the packet form, that names the family, the tag
   and a regime-statement reason code, written as
   `outbound_regime_context_decision` and cited by id in every later manifest
   from that context. A per-context decision is the more restrictive of the
   readings available because it cannot be made in the approval flow, where
   §5.4 says fatigue lives. The reason codes are **per tag** (§4.1): the four
   above serve the three tags that have a per-packet path; for
   `controlled_access_genomic` only `synthetic_or_test_data` and
   `dataset_open_access_no_dua` (an open-access accession, as for GEO or SRA,
   under no data-use agreement) are coherent, and for
   `export_controlled_or_unpublished_ip` only `synthetic_or_test_data`,
   `data_is_the_owners_published_work` and `owner_holds_rights_and_releases`;
   those are accepted only in a per-context decision, never in the packet
   form, and the store rejects any other tag-code pairing. r2's single list
   offered `owner_is_the_party` for a genomic accession, which is incoherent
   and would have produced a false record. An identifier whose stop was
   resolved, per packet or per context, does **not** leave as a literal by
   default: it becomes a `registered_identifier` placeholder unless the
   brief's preserve list names it as `public_identifier`, and the manifest
   counts such literals (`regimeSuggestiveLiterals`). Entropy heuristics flag, never block, because they
   fire on hashes and sample keys. Measured gap this targets: OPF's
   `account_number` recall was 0.13 and `secret` 0.33 on the development
   split, and all five missed mandatory canaries were secrets in log or
   split-literal form.
2. **The identifier registry** (per Tier-O job, encrypted like the map), built
   **lazily on the first cloud action in the job**, not at job start: the raw
   inputs are retained in the workspace, most Tier-O jobs never send a packet,
   and the harvest is not cheap (§9.1). Three origins: (a) an entity harvest run
   locally by the 27B over the rendered inputs **and the owner's private brief
   and the job's instructions** (§3.1 calls the brief the commonest leak, and
   a name that occurs only there was unknown to r2's registry) in a fresh
   context, through the dedicated filter destination (§3.4), into a strict
   schema ("list every person, organisation, identifier, place, product and
   study named"), **chunked by expected output, not by input**: ≤ 50k input
   tokens per call, streamed, with a per-call output cap of 4,096 tokens
   (about 512 s of decode at the pinned 8 tokens/s plus about 28 s of prefill
   at 1,790 tokens/s, inside the 720 s `timeoutMs` of the filter destination
   and the remote's 947 s cut; the coordinator's `standard` destination could
   not carry it, because its 300 s transport timeout, `profiles.ts:36`, would
   cut every full chunk at `broker.ts:464`, and its 192 KiB body cap would
   refuse a 50k-token chunk of about 200-250 KB as `packet_size_exceeded`,
   `broker.ts:312`) and a `more: true` field in the schema that says the model
   had more entries than the cap allowed. A continuation does **not** use a
   model-reported stopping position, which an injected document can misstate:
   the host splits the chunk deterministically at line boundaries into two
   halves and re-runs each, deduplicating entries, to a depth of at most four
   splits per original chunk (about 3k tokens at the leaf); a leaf that still
   reports `more: true` is a **flood**, recorded in `failedChunks` with reason
   `flooded`. Reaching the 5,000-entry cap is likewise a failure, reason
   `entry_cap_reached`. The harvest is bounded at 4 MiB of rendered text in
   all, above which the registry is marked partial and the owner is told.
   r1's 200k-token chunks could not complete at that rate: a dense
   legal or clinical chunk yields on the order of a thousand entries, about
   10k output tokens, 21 min at 8 tokens/s, so every full chunk would have
   been cut. A cut, timed-out, malformed or flooded harvest call, or a
   registry at its entry cap, is a **harvest failure**, not a shorter
   registry: the registry is `partial: true` with the
   failed chunk range in `failedChunks`, the owner is told, and the builder
   refuses the first packet (`outbound_registry_partial`) until the harvest
   completes or the owner acknowledges `partial` with a reason code from a
   fixed list (`inputs_exceed_bound`, `harvest_failed_retried`,
   `owner_supplied_registry`) that is recorded in the manifest and the
   disclosure report. The harvest is not a layer, so Q7's rule did not reach
   it in r1; this paragraph gives it the same fail-closed shape; (b) OPF and
   rules v2 run over the raw inputs on the Mac, which never leave, so that
   every identifier the files contain is a known value; (c) owner additions in
   the job surface. The owner sees the harvest's progress and its partial flag
   before the first packet is built. Matching is exact
   after normalisation (NFKC, casefold, whitespace collapsed, full-width to
   ASCII, separators removed; for persons also surname-only, given-name-only
   and pinyin forms of at least two characters). A registry hit is a
   placeholder; a registry entry the owner marks as a regime identifier is a
   hard block. The registry is sensitive: never logged, exported or shown in
   telemetry; it lives under the job's retention. Harvest recall against a
   planted registry is an F0 metric (§8.3), because every later number depends
   on what the harvest found; it is reported **per origin** ((a), (b) and
   their union), because the 27B harvest shares weights with the checker and
   the OPF raw scan shares weights with L2, so a miss in one is correlated
   with a miss in the other and the composed estimate in §8.2 must say which
   origin it rests on.
3. **The provenance diff.** The index is built, host-owned, over the normalised
   bytes of the **owner's input files** in the job workspace, of the
   **private brief and the job's instructions**, and of every **restored
   cloud reply** in the job (third-party text that may carry the originals
   back), and never over the agent's own outputs: a derived output
   carries the join of its sources' labels (P1), so "any labelled source" would
   include the draft itself and refuse every packet, or be gamed by the choice
   of set. The scope is recorded in the manifest as
   `provenanceDiff.indexScope`. Any run of N characters (24 for Latin script, 8
   for CJK) from the index that reappears in the candidate is flagged and
   replaced by a locator where the template defines one; a candidate whose
   copied-bytes share exceeds the template's threshold (default 5 %, recorded
   per template in the manifest) is refused outright. The agent cannot argue
   with a substring match and an injection cannot turn it off.

What this layer catches that the others miss: formatted secrets in code and
logs, checksum-valid numbers, paths, verbatim copying, regime evidence the
owner did not tag, and matter-specific proper nouns that are not PII to a
general detector (a counterparty's company, a study's acronym).

### 3.3 L2: OPF span detection

Placement: the Mac, as a persistent child process launched with the
`calibrate.py` pattern (pinned venv, `python -I`, `PYTHONDONTWRITEBYTECODE=1`,
a `sandbox-exec` profile denying network, four threads, the frozen checkpoint,
lazy load on first use, unload after ten idle minutes to return the 3.8 GiB).
Identity: the runtime freeze hash (`3533c82e…` for the current freeze).

IPC: JSON lines on stdio, `{id, text, language}` in, `{id, complete, spans:
[{start, end, label, startUtf16, endUtf16}], elapsedMs, errorCode}` out. Spans
only: the OPF JSON output carries the original text and `redacted_text`, and
`adapter.py` already strips them. Nothing from the worker is logged.

Chunking: `adapter.py` caps a case at 32 KiB / 8,192 tokens. A candidate is
split at line boundaries into pieces of at most **7,000 tokens by the OPF
tokenizer's count** (not by bytes: 24 KiB of dense CJK is about 8,192
characters and would exceed the token cap, which is `failed`, hence block), no
overlap (OPF's attention band is 257 tokens, so boundary loss is local),
offsets re-based by the host. Entity consistency across chunks is L4's job.
Labels map through `OPF_LABELS` to the eight corpus labels; every span becomes
a placeholder. A tokenizer round-trip mismatch, an invalid offset or an
incomplete chunk is `failed`, hence block.

Latency on packet-sized input is unmeasured. The September median of 0.37 s
was on about 390-byte snippets; a transformer with banded attention scales
roughly linearly, so three 7,000-token chunks are of order 60 s median, not
the 1-12 s the first draft of this design carried. R3 measures it; the S-A
entry condition is the measured p95 (§9.1).

What it catches that the others miss: names, emails, phones, addresses and
dates in prose without a registry entry, including Chinese and mixed text
(development split: email 15/15, person 0.89 typed recall overall and 0.52 on
zh, phone 0.83, 85 % character coverage on zh). What it does not catch:
secrets and account numbers (above), split or encoded values, and the twelve
of sixty development cases that were whole-context sensitive, which are outside
an eight-label span model by construction.

### 3.4 L3: the local 27B as contextual checker

A zero-fee local dispatch through the broker to the admitted Thor destination,
`purpose: "outbound privacy check"`, `thinking: "disabled"`, `maxOutputTokens:
4096` (about twice the schema's CJK maximum, below), vLLM structured output
with a JSON schema, no tools, the packet wrapped as untrusted text, prompt and
schema versioned and hashed into the identity. Sampling is **pinned per pass
and sent explicitly**: pass 1 `temperature: 0`, pass 2 `temperature: 0.3`,
both `top_p: 1.0`, each with a fixed `seed` named in the prompt version. Today
`model.ts` types `sampling` as `{temperature, top_p, top_k}` with no `seed`,
sends it only when thinking is on, and has no `response_format`, `json_schema`
or `guided` field at all; so the request builder gains a `sampling` field that
carries `seed` and a `responseFormat: {type: "json_schema", schema}` option,
both in R1's work list and tests. Without the first the two passes would
measure vLLM's defaults (Qwen's non-thinking default is 0.7) and F4's
agreement figure would be the server's, not the design's; without the second
"structured output" is a sentence, not a request. The pins, the
structured-output mode, the vLLM version and the served model identity (P16)
are part of the layer identity. The Thor already holds the raw job, so this
adds no recipient; it is still a dispatch row (`not_required_inside_boundary`)
and may be retried under D4. The two passes run **concurrently** (two streams
each held 35 tokens/s on the serving card), so wall time is one pass; the
union of verified findings is applied and agreement is reported per setting.
The budget is written at the plain-FP8 rate of 8 tokens/s, not at the 35
tokens/s observed under speculative decoding that D11 leaves unpinned (§9.1).

**A dedicated destination, not the coordinator's.** The checker and the
registry harvest (§3.2) run on their own admitted local destination,
`thor_filter`, declared from a `filter` profile beside `standard` and `heavy`
in `profiles.ts`: `thinking: "disabled"`, `maxOutputTokens: 4096`,
`requestTimeoutMs: 720_000`, `maxRequestBytes: 640 * 1024`, streaming on with
the inactivity clock (`stream: localStreamSettings(...)`,
`src/main/liveness.ts:15-16`; 120 s of silence after the first byte,
`liveness.ts:8`). r2 took the checker's thinking mode, output cap and body cap
from the `standard` profile and then cited "the 900 s ceiling" for its
timeouts, but the transport aborts at the *destination's* own `timeoutMs`
(`broker.ts:464`), and `standard` declares 300_000 ms and 192 KiB
(`profiles.ts:36`); 900_000 ms belongs to `heavy` (`profiles.ts:37`, thinking
on, which the checker does not use) and to `BROKER_MAX_TIMEOUT_MS`
(`broker.ts:16`), the most a destination may declare, not what any admitted
one declared. `SOAR_REQUEST_TIMEOUT_MS` likewise defaults to 300_000
(`src/main/config.ts:74`) and belongs to the review adapter
(`src/main/general-tasks/controller.ts:250-251`). Under a 300 s destination a
CJK pass at the schema maximum (≈ 339 s, below) is cut by the transport before
the design's own timeout ever fires, and a full harvest chunk (≈ 540 s) is cut
on every call. The `filter` destination's `timeoutMs` sits above the L3
timeout and above the harvest's per-call bound ((512 + 28) × 1.25 ≈ 675 s);
its 640 KiB body cap holds a 50k-token harvest chunk (about 200-250 KB of
English or CJK text before wrapping) and is within the 4 MiB destination
ceiling (`broker.ts:14`, validated at `broker.ts:248`); the inactivity clock
is ≤ `timeoutMs` as `broker.ts:260` requires; `PrivateModelConfig.maxRequestBytes`
(`model.ts:104`) carries the same cap, since `model.ts:234-235` checks it
before the broker does. The destination's values are part of the checker's
layer identity and of the freeze (§8.5), and R1 carries two tests: the
`thor_filter` `timeoutMs` is not below the derived L3 timeout or the harvest's
per-call bound, and a 50k-token chunk body fits its `maxRequestBytes`.

Input: the already-placeholdered text (so the judgement is about what would
leave), the purpose and family, the label level, the placeholder type counts,
and the registry entries whose normalised forms do **not** already resolve to
a placeholder in the residual (the rest are gone; passing them would only
inflate the prompt). The registry portion is capped at 4,000 tokens, filled in
priority order (regime, person, matter, patient, participant, organisation,
others); when the cap truncates it the manifest records
`registryPrompt.truncated` and the diff view shows the flag. The registry is
local, so the checker may see it; this is how it spots a paraphrase or a pinyin
form of a registered entity.

The fixed question has four parts, each answered in the schema:

1. `reidentification`: can a reader with public knowledge still tell which
   person, organisation, matter, patient or study this is? Quote each passage.
2. `confidential_facts`: are there business, legal, clinical or research facts
   that are sensitive without naming anyone (a strategy, a diagnosis plus a rare
   treatment, an unpublished result, a settlement figure)? Quote them.
3. `over_redaction`: does a placeholder destroy the task (a quantity, a date the
   critique needs, a public identifier)? Quote the placeholder and name the
   preserve-literal class it belongs to.
4. `useful`: can a reviewer still do the stated purpose with this packet?

```ts
const CheckerVerdictSchema = z.object({
  version: z.literal(3),
  verdict: z.enum(["clear", "redact", "block"]),
  findings: z.array(z.object({
    kind: z.enum(["reidentification", "confidential_fact", "alias", "over_redaction", "injection_attempt"]),
    quote: z.string().min(1).max(200),   // must be a substring of the input or the finding is dropped
    reason: z.string().max(150),         // shown as untrusted model text
    action: z.enum(["placeholder", "drop", "reveal", "block"]),
    preserveClass: z.enum(["quantity", "dose", "amount", "citation", "public_identifier", "code_identifier", "date_needed"]).optional(),
                                         // required when action is "reveal"; a reveal without a class is dropped
  })).max(8),                            // eight findings at 200 + 150 characters: ≈ 1,050 tokens in English, ≈ 2,600 in CJK (§9.1)
  truncated: z.boolean(),                // the model had more to report than eight findings
  useful: z.boolean(),
  usefulReason: z.string().max(150),     // shown as untrusted model text
}).strict();
```

The cap of eight findings per pass, with shorter quote and reason limits,
replaces r1's ten at 400 + 300 and the first draft's forty: forty findings at
the first draft's limits were eight to ten thousand tokens, which no output cap
the critic-cap lesson allows would hold; r1's ten were about 2,000 tokens in
English but about 5,000 in Chinese (Qwen tokenises CJK at roughly 1.3
characters per token), 250-660 s at the 8 tokens/s the design commits to,
which no 180 s budget held either. The schema is now sized from its **CJK
maximum at the pinned rate**: eight findings × (200 + 150 CJK characters ≈ 270
tokens + about 35 tokens of JSON keys and enums) + `usefulReason` (≈ 115) +
the envelope (≈ 20) ≈ 2,600 tokens, 325 s at 8 tokens/s; the English maximum
is about 1,050 tokens, 130 s. **The L3 timeout is derived from a measured
rate, with a margin.** r2 set it at 360 s against its own worst case of
335-339 s (325 s of decode plus 10-14 s of prefill), a 6 % margin on a rate
that is a community estimate for plain FP8 on this memory-bandwidth class
(serving card, lines 41-43), not a measurement on this device: every measured
figure (P3, 35 tokens/s single stream, line 29; P7, two concurrent streams
each 35, line 34) was taken with speculative decoding active, none under two
concurrent streams without it, and vLLM's grammar-constrained decoding adds
per-token work the arithmetic omitted. A margin that thin measures the margin,
not the checker, and F4's zero-tolerance clause would then have demoted the
checker on one pass that was 22 s slow. The rule is now: in R4, measure the
per-stream decode rate with two concurrent passes under `responseFormat` on
the frozen server and record its 5th percentile, p5; the L3 timeout is
(CJK maximum / p5 + prefill) × 1.25, and never below **450 s**, the figure at
the 8 tokens/s floor ((325 + 14) × 1.25 ≈ 424 s, rounded up); both p5 and the
derived timeout are written into the freeze, and the `thor_filter`
destination's `timeoutMs` (720 s, above) sits above it. A pass that completes
after the no-margin figure (CJK maximum / p5 + prefill) but inside the timeout
is `complete` and is recorded with `budgetWarning: true` in its layer record;
F4 reports the warning rate and does not demote on it. A pass that reaches
the timeout is one that produced more than the schema allows or a server that
fell below p5, and either is a measured event. With `truncated: true` the
owner sees that the checker had more. **Any pass whose status is not `complete`** — a transport
timeout, a `finishReason: length` cut, malformed or empty output — is a block
with **no override**, because the checker was cut off, not fooled, and a cut
pass carries no located quote for the same reason a length-cut one does not.
r1 made only the length cut non-overridable; at 8 tokens/s a cut-off pass
arrives as a timeout, never as a length cut (8,192 tokens is 1,024 s, beyond
the 900 s ceiling), so r1's rule never fired on the packets it was written
for. F4 counts timeouts, length cuts and malformed answers under one
non-complete rate.

The host turns each located `placeholder` or `drop` finding into a `SpanRecord`
with `layer: "local_checker"` and applies it. A `reveal` finding is not applied;
it is shown as a quality note naming its preserve class, with a button that
creates an `owner_marked` reveal span, logged. A reveal has a bounded effect
on the invariants, or the button would be dead: L4 item 2 and the wire gate
check that no original from the map or the registry remains, and r2 stated no
exemption, so either every reveal was blocked or an implementer would have
exempted "entries the owner revealed" without bound, and a registry
`record_number` revealed as `public_identifier` could leave. The exemption is
exact: a reveal removes the map entry only for a span whose original is
**not** a registry entry of kind `person`, `patient`, `participant` or
`matter` and not a regime identifier, and whose preserve class is on the
template's preserve list; the button is not offered for any other span. L4
and L6 then check (map ∪ registry) minus **exactly the logged reveal ids**;
the manifest records `reveals: [{spanId, preserveClass}]` and
`outbound_decision` carries them. R2 tests that a revealed registry `person`
value is still blocked at L4 and at L6. `block` stops the pipeline with
the reasons visible. `useful: false` sets `packet_not_useful` (§3.5). An empty
or malformed answer is `failed`, not clean.

**Override, scoped.** A `local_checker` block may be overridden by the owner,
with a reason code from a fixed list, only when it comes from a pass whose
status is `complete` **and** the block carries no located quote or its kind is
`injection_attempt`: that is the case an injected packet can manufacture. A
block carrying a located `confidential_fact` or `reidentification` quote is
evidence, and its only exits are edit-and-rerun (drop or generalise the quoted
passage, then run L1-L4 again) or decline. A block from a non-complete pass
has no override (above). Edit-and-rerun leaves lineage: the new manifest
carries `supersedesManifestId` and `priorBlock: {layer, findingKind}`, and so
does its `outbound_built` event, so a packet approved after a quoted passage
was generalised is distinguishable in the disclosure report from one the
checker never flagged (§4.1, §4.6). Every override is recorded in
`outbound_decision` and in the disclosure report with the finding kind. §5.4
names approval fatigue as a leak path; an unscoped override would have been
the shortcut.

**Free text is untrusted.** `reason`, `usefulReason` and `reveal` suggestions
are a channel from a possibly injected packet to the owner's eyes: an
instruction in the packet can make the checker argue, fluently, that the
placeholders destroy the task or that the packet is useless unless more is
sent, the same social-engineering vector §3.8 guards against on the reply side.
So the diff view shows checker free text as untrusted model text, visibly
marked; a reveal must name a preserve-literal class and the button reveals only
spans of that class; and when any pass reports `injection_attempt`, all reveal
suggestions and the `useful: false` reason are suppressed for that packet.

Containment (P4): the packet may contain text addressed to the checker. The
output is schema-constrained, the verdict can only restrict, quotes are
verified, there are no tools, and a `clear` from an injected checker is harmless
because `clear` releases nothing. What an injection can do is force a block
(overridable only when the pass completed and the block carries no located
quote, so the injection buys a delay, not a release), make the checker write
past the cap so the pass is not `complete` (a block with no override, so again
a delay), or write persuasive free text, which is shown as untrusted and, once
the injection kind is reported, loses the reveal and usefulness channels
entirely.

What it catches that the others miss: whole-context sensitivity,
re-identification from fact patterns, aliases and cross-turn references,
Chinese and mixed-language meaning (Qwen's largest comparative advantage, and
unmeasured), and over-redaction (the three literal-mask failures). It is the
only layer that reads meaning. It is also the slowest and the least trustworthy,
which is why it is neither first nor last, why it is the same model whose task
results were weaker than the cloud's, and why its silence is worth nothing.

### 3.5 L4: deterministic post-pass

Runs last over the text that would be shown to the owner.

1. **Entity consistency.** Spans with the same `entityKey` get the same
   placeholder; distinct keys never share one; the final text is searched for
   surname-only, given-name-only, pinyin and normalised forms of every mapped
   entity, which join the same placeholder. This makes the `same_entity` and
   `distinct_entity` utility checks evaluable for the first time.
2. **Originals-absent invariant.** No original value from the map or the
   registry (the private brief's and the job instructions' values included,
   since they are harvest inputs, §3.2), in raw, normalised, or
   one-level-decoded form, remains anywhere in the final bytes; the set is
   (map ∪ registry) minus exactly the logged reveal ids (§3.4), nothing wider.
   This catches any upstream miss for a known value; it cannot catch an
   unknown one.
3. **Provenance diff re-run** over the final bytes against the input index
   (§3.2 item 3), including the checker's effect.
4. **Placeholder grammar.** Every placeholder matches
   `«(PERSON|ORG|ADDRESS|EMAIL|PHONE|ACCOUNT|URL|DATE|SECRET|ID|PLACE|AMOUNT|CTX)_[0-9a-f]{6}»`
   and resolves in the map; nothing placeholder-shaped is unmapped.
5. **Generalisation transforms by template.** Dates not on the preserve list
   become relative intervals ("day 0", "day +14"); ages become decades and ages
   over 89 become "90+"; localities below region are dropped; table cells with a
   count below 5 are suppressed; tables longer than N rows become header plus
   row count; repeated structures become one instance plus a count. The brief's
   preserve-literals list (quantities, public identifiers, citations the task
   needs) overrides a transform and is recorded. **Anchor check for relative
   dates.** A relative interval has the single-anchor weakness §6 cites for
   deferring date shifting: one preserved public date, or one dated citation,
   beside "day +3" reveals day 0. So when a packet carries relative days, L4
   searches the final text for any absolute date (ISO, numeric, written, and
   CJK 年月日 forms, after NFKC) and any citation that carries a date on the
   preserve list; a survivor is a `structural` finding of kind
   `relative_date_anchor`, and the owner must drop the anchor or restore the
   absolute dates to the generalisation (that is, remove them from the
   preserve list) before the button exists; the finding is not overridable.
6. **Budgets.** Content ≤ 16 KiB by default, ≤ 64 KiB with acknowledgement;
   body ≤ the cloud destination's `maxRequestBytes` (192 KiB, the broker
   default at `broker.ts:12`; the 640 KiB cap of the filter destination in
   §3.4 serves the checker and the harvest, never anything that leaves);
   non-prose bytes
   (code blocks, encoded runs) ≤ the template's share; placeholder density
   reported as a number; `packet_not_useful` set when density exceeds the
   template threshold.
7. **Known-credential check.** The existing `credential_in_packet` test.
8. **Cross-job digest query.** The exact digest set of §3.8 is queried over
   the final bytes' normalised tokens and multi-token windows. A hit is a
   value some other live job's registry knows and this job did not
   placeholder, which is a harvest miss caught before dispatch rather than on
   the echo: it becomes a placeholder with label `registered_identifier` and
   layer `structural`, the value joins this job's registry with origin
   `cross_job`, and the owner sees a review-class flag. The query is
   restriction-only and needs no decision; it is an r3 addition beyond the
   fixes, in the direction of more restriction, and it reads digests only
   (P6), never another job's plaintext.

Any invariant failure is `block` with the invariant named and no override.

### 3.6 L5: the owner's diff view and decision

Specified in §5. In pipeline terms: `outbound_proposed` is written with the
manifest; approval writes `outbound_decision` and a grant with
`remainingUses: 1` bound to `packetSha256`, `contextSha256`,
`destinationSha256` and purpose, exactly as the consultation path does today;
decline and revoke work as today. The consultant state machine
(`consultation.ts`: propose, decide, resume with `validateAtCommit`) is
generalised into an `OutboundProposal`, and the consultant packet becomes one
more template.

One thing the generalisation must not inherit: today `consultation.ts` appends
`consultation_proposed` with `proposal: base`, whose `packetText` is up to
196,608 bytes, and `state()` rebuilds the pending proposal from that event. That
is packet text on the chain, which §4.6 and Q13 forbid. In R1 `packetText`
moves out of the proposal event into an encrypted proposal store (the same
table family as the map, §4.5); the event keeps `packetSha256` and
`manifestSha256`; `state()` is rebuilt from the store; existing consultation
rows get a migration note; and a CI test asserts that no event row exceeds a
small size bound.

### 3.7 L6: the wire gate

`CompositePacketScanner.scan(text, binding?)` replaces `RulePacketScanner` in
the broker's scan slot (`request()`, the gate around line 362). The broker
runs the scanner for every destination that is not an admitted or synthetic
local model, so the gate has **two modes**, each with its own test:

- **Binding present** (`{jobId, contextId, grantId, purpose}` from the frozen
  request, which every labelled packet has). It:
  1. runs rules v2 over the wire text, system prompt and JSON wrapping included;
  2. loads the manifest, map and registry bound to the grant and checks the
     originals-absent invariant over the wire bytes, the set being (map ∪
     registry) minus exactly the manifest's logged reveal ids (§3.4), so a
     revealed registry `person` value is still blocked here (R2 test);
  3. checks that the wire body embeds the approved content (`contentSha256`);
  4. verifies the tracer's HMAC against the bound `manifestId`;
  5. returns `{complete: true, blocked: false, detector: <composite identity>,
     mode: "bound", manifestSha256, manifestId}`.
- **Binding absent** (public web GETs). It runs rules v2 only, returns
  `mode: "rules_only"` with no `manifestSha256`, and the receipt says so. It
  never silently degrades: a request to a `cloud_model` with
  `requireExactGrant` and no binding is refused, not scanned in the lesser
  mode.

The `grantFreeSynthetic` destination kind, which serves synthetic contexts
without any grant, is **refused in the desktop profile**; it exists only in the
headless Phase-2 script (`scripts/phase2-repair.ts`) and the first synthetic
trial's headless arm (§10.2). A desktop build that finds it configured fails
closed at start.

OPF and the checker are not re-run at the wire: the owner approved these bytes,
and the gate's job is to prove that the bytes leaving are the bytes approved
and carry no known original. `DispatchReceipt.scan` gains `manifestSha256`,
`manifestId` and `mode`; the receipt gains the provider posture snapshot (Q15),
the label set and regime tags at dispatch (of the parent Tier-O context, §3.9),
and the owner's location class (home jurisdiction or abroad), which changes the
PIPL analysis.

### 3.8 L7: the return path

The reply is a dispatch response like any other. It is screened **before
restoration, with its placeholders intact**: r2 screened after `restore()`,
which put this job's own restored originals into the bytes the cross-job
query read, so the owner's name or organisation, which the harvest puts into
every job's registry, was an exact digest hit on every reply that mentioned
it, and P15 would have revoked every destination and stopped the sandboxes
for it. On the raw reply bytes the screens are: rules v2 and this job's
registry **in two tiers** (below), the checker's `injection_attempt` kind, a
request-for-more-data detector (a critique that asks for "the full
participant table" is flagged as such and shown, because the owner who just
saw a bad local result is primed to say yes), and the cross-job digest query.
Only then does `restore(reply, map)` replace placeholders with originals on
the device, record `placeholdersRestored` and `unresolvedPlaceholders` (a
cloud model may mangle a placeholder), strip the tracer, and write the
restored text as untrusted advice (as `withRepair` does, `REPAIR_INSTRUCTIONS`
unchanged). Restored originals never enter any screen.

The two tiers exist because a flat "any registry value in the reply is an
incident" fires on "e.g. Mr Li" and on any common surname that the
surname-only rule put in the registry, and an incident switch that trips weekly
is one the owner learns to reset:

- **Incident-class**: in the raw reply, a checksummed identifier, an email, a
  phone, a secret, or a full multi-token name from this job's registry (none
  of which could have been sent, by L4's invariant, so the cloud produced it),
  or an exact cross-job digest hit on a value that is *not* in this job's
  registry. This trips the incident switch (F6).
- **Review-class**: a single token, a surname-only or given-name-only form, or
  a registry value of kind `place`, `product` or `other`; and a cross-job
  digest hit on a value that is also in this job's registry, which this job's
  own rule has already classed and which the cross-job side only annotates.
  This is shown to the owner as a flag and logged (`outbound_echo_review`);
  two in ten packets trigger a red-team round (F6).

For cross-job detection the screen does not load other jobs' plaintext
registries, which P6 forbids unless the owner links jobs; it consults an
**exact set of salted HMAC digests** of the mandatory-class normalised values
of every other live job (`HMAC(salt, normalised value)`, one per-process salt
drawn at host start and never persisted), rebuilt when a registry changes,
held in the host process only, so a hit says "some other job knows this value"
without saying which or what. **Mandatory-class**, for the digest set, is
defined here and not left to the corpus term of §8.2: checksummed
identifiers, emails, phones, secrets, and full multi-token names of registry
kinds `person`, `patient` and `participant`; nothing else is in the set. The
query excludes this job's own registry values and this job's restored
originals (moot under the screening order above, stated so the rule cannot
drift), so a remaining hit means "some other job knows this value and this
job did not". The same set is queried once more at L4 over the outgoing
final bytes (§3.5 item 8). R2 tests that a reply which restores to contain
the owner's own name, a registry value shared by two live jobs, does not trip
the switch, and that a raw reply carrying an unsent registry value does. r1 used a salted bloom filter; a reply screen
queries every normalised token and multi-token window of a reply, hundreds to
thousands of queries, and at a bloom false-positive rate of 1e-3 to 1e-2 a
spurious cross-job *incident* (which revokes every destination and stops
sandboxes, P15) would be likely per reply, the "switch the owner learns to
reset" the tier split exists to avoid. An exact digest set has the same
privacy property, no false positives, and at ≤ 5,000 entries per live job is
trivial in memory; it is the more restrictive of the two options offered
because a hit is then always real. The tier that fired is recorded. The reply's requests are recorded, not acted on;
side-effect actions stay non-model-callable (P4). A restored reply joins the
provenance index (§3.2 item 3). A reply, restored or not, is never an input to
another cloud packet except through the whole pipeline and a fresh approval;
the originals-absent invariant and the provenance diff catch a restored
critique copied into a later draft.

### 3.9 The end-to-end flow for one packet

1. The Tier-O job runs `mode: "private"` on the Thor.
2. The owner chooses the cloud action for a purpose. The session freezes the
   draft, as the repair pair does. On the first cloud action in the job the
   registry is built from the retained raw inputs, the private brief and the
   job instructions (`registry_built`) in output-bounded streaming chunks on
   the filter destination (§3.4), with its progress and partial flag shown; a
   failed or flooded chunk, or the entry cap, leaves the registry `partial`
   and holds the first packet
   until the harvest completes or the owner acknowledges `partial` with a
   reason code (§3.2); later packets in the job reuse it.
3. L0 reads the install-level stage and D20(b) rows (§4.7) and the context's
   labels; refuses on a tag, on an unrecorded D20(b) for `coding` or
   source-code sources, on a stage short of `S-B` for the class, family and
   purpose, or on an unacknowledged `partial` registry; picks the template for purpose
   and family, renders the admitted material with locators, pre-fills the
   cloud brief, records the language class by CJK presence with its evidence
   counts, writes `outbound_built` (with `supersedesManifestId` and
   `priorBlock` when this is a rerun after a quoted block).
4. L1, L2, L3 (two concurrent passes), L4, each writing `outbound_layer`, each
   substituting through the map. Any block writes `outbound_blocked` and stops;
   a `regime_suggestive` stop waits for the owner's per-tag answer.
5. The pipeline creates a `cloud_help` sub-job and context that **persist
   `parentJobId` and `parentContextId`**. The store refuses to create one whose
   parent context has regime tags, whose parent policy mode is not
   cloud-help-eligible, or whose parent stage is not `S-B` for a non-synthetic
   context. The sub-context's sources are derived sources carrying the join of
   the parent's labels (P1) and `sourceClasses` joined from the parent
   sources' extension classes (R1 schema); they are `synthetic: true` only when every parent
   source is synthetic, so the construction cannot route a real packet to the
   `grantFreeSynthetic` kind (which the desktop profile refuses anyway, §3.7).
   The pipeline composes the wire body through the model body builder, calls
   `broker.preview()`, and writes `outbound_proposed`.
6. The owner reads the diff, answers the form, approves. `outbound_decision`
   and a one-use grant.
7. `broker.request()` runs `eligible()`, which reads the sub-job's policy and
   context **and, inside `eligible()` itself, re-checks the parent chain**:
   for any `cloud_help` context it reads `parentJobId` and `parentContextId`
   from the store and requires parent tags empty; the install-level stage row
   `S-B` for the manifest's language class, family and purpose (re-read from
   the install row, not from the job's policy snapshot, so a revert under F6
   refuses a job whose snapshot still says `S-B`); the D20(b) row recorded
   where the manifest's family is `coding` or the **parent context's**
   sources carry a source-code class, the manifest being resolved through the
   bound grant (grant → `manifestId`) and the parent's sources read from the
   store, because the sub-context `eligible()` is handed carries derived
   sources whose `sourceClasses` are joined from the parent and the family
   exists only on the manifest (r2 stated the source-code rule only for the
   builder, §3.1, which a script path bypasses, the case `eligible()` exists
   for); and the parent policy unchanged since approval. r1 put this check
   "inside `validateAtCommit`", but that callback is an optional argument of
   `request()` (`broker.ts:347`; `consultation.ts:218` passes one,
   `scripts/phase2-repair.ts` reaches `request()` through
   `PrivateAgentModel.complete`, `model.ts:247-248`, which passes none), so a
   caller that omits it would have skipped the check; `eligible()` runs on
   every commit regardless of the caller, and `validateAtCommit` remains for
   the caller's own additional checks only. Then the composite wire gate in
   bound mode, the receipt committed with `manifestSha256` and `manifestId`,
   send. If L0 were bypassed by a script path or a bug, this is where the
   parent's tags stop the packet.
8. The reply is screened by tier with placeholders intact, restored and
   written; `outbound_restored`;
   the local repair runs on the Thor with real names.
9. At retention the map, the encrypted packet copy and the reply are deleted;
   `restoration_map_deleted` and the tombstone remain.

Nothing in steps 3-8 happens without step 2's owner action and step 6's
approval. There is no path from a failed local run to a cloud dispatch, and no
path from a sub-context's own labels to a dispatch the parent's labels forbid.

## 4. Data shapes

### 4.1 Packet manifest (persisted; hashes, counts and codes only)

```ts
export const OutboundPacketManifestSchema = z.object({
  version: z.literal(2),
  manifestId: z.string().uuid(),                               // tracer key input; known at L0
  jobId: privateAgentId, contextId: privateAgentId,            // the parent Tier-O job and context
  cloudHelpJobId: privateAgentId.optional(), cloudHelpContextId: privateAgentId.optional(),   // the sub-job, once created (step 5)
  policyRevision: z.number().int().nonnegative(),
  supersedesManifestId: z.string().uuid().optional(),         // set on an edit-and-rerun after a quoted block (§3.4)
  priorBlock: z.object({ layer: z.string(), findingKind: z.string() }).strict().optional(),   // what the superseded packet was blocked on
  stage: z.object({                                            // snapshot of the install-level stage row (§4.7) at build; eligible() re-reads the row at commit
    level: z.enum(["S-A", "S-B"]), languageClasses: z.array(z.enum(["en", "zh", "mixed"])),
    families: z.array(z.string()), purposes: z.array(z.string()),      // a product: class, family and purpose must each be listed (§4.7)
    approvedEntryId: z.string().optional(), approvedEntrySha256: sha256Schema.optional(), approvedEntryLength: z.number().int().optional(),
  }).strict(),
  codeDecision: z.object({ answer: z.enum(["tagged", "not_tagged"]), recordedEntryId: z.string(), recordedEntrySha256: sha256Schema }).strict().optional(),
                                                               // snapshot of the D20(b) row; required (and "not_tagged") for family coding or source-code sources
  languageClass: z.enum(["en", "zh", "mixed"]),                // by CJK presence, not share (§3.1)
  languageClassEvidence: z.object({ ruleVersion: z.number().int(), cjkRuns: z.number().int(), cjkRegistryEntries: z.number().int() }).strict(),
  contextSha256: sha256Schema,
  labels: z.object({
    level: z.enum(["public", "personal", "confidential_professional"]),   // public: an S-A packet from the owner's own public-labelled context; it carries a manifest like any other
    regimeTags: z.array(regimeTagSchema).length(0),          // must be empty for the manifest to exist
    synthetic: z.boolean(),                                  // true only when every parent source is synthetic
  }).strict(),
  regimeContextDecisionIds: z.array(z.string().uuid()).max(16),   // per-context decisions (§3.2) this packet relies on; never per packet
  registryPartial: z.object({ partial: z.boolean(), acknowledgedReasonCode: z.enum(["inputs_exceed_bound", "harvest_failed_retried", "owner_supplied_registry"]).optional() }).strict(),
  purpose: z.enum(["repair_critique", "code_review", "schema_review", "plan_review", "research_framing"]),
  family: z.enum(["research", "document_review", "deck", "website", "admin", "coding", "general"]),
  template: z.object({ id: z.string(), version: z.number().int(), sha256: sha256Schema, copiedShareThreshold: z.number().min(0).max(1) }).strict(),
  provenance: z.array(z.object({ path: z.string(), sha256: sha256Schema, bytes: z.number().int() }).strict()).max(64),
  candidateSha256: sha256Schema,
  layers: z.array(LayerVerdictRecordSchema).min(5).max(10),
  regimeSuggestive: z.array(z.object({ family: z.string(), suggestedTag: regimeTagSchema, hits: z.number().int() }).strict()).max(16),
  regimeSuggestiveLiterals: z.number().int(),                 // resolved regime-shaped identifiers that leave as literals under a public_identifier preserve entry (§3.2)
  reveals: z.array(z.object({ spanId: z.string(), preserveClass: z.string() }).strict()).max(64),   // the only exemption L4 and L6 apply to originals-absent (§3.4)
  provenanceDiff: z.object({
    indexScope: z.literal("owner_inputs_brief_and_restored_replies"),   // input files, the private brief and job instructions, restored replies; never the agent's outputs
    thresholdShare: z.number().min(0).max(1),
    copiedShare: z.number().min(0).max(1), flaggedRuns: z.number().int(), locatorsSubstituted: z.number().int(),
  }).strict(),
  registryPrompt: z.object({ entriesPassed: z.number().int(), truncated: z.boolean() }).strict(),
  contentSha256: sha256Schema,                                 // final content the owner saw, tracer included
  packetSha256: sha256Schema,                                  // wire text hash, == grant.packetSha256
  destinationId: privateAgentId, destinationSha256: sha256Schema, model: z.string(),
  restorationMapId: z.string().uuid(), mapCiphertextSha256: sha256Schema,
  placeholderCounts: z.record(z.string(), z.number().int()),
  bytes: z.object({ candidate: z.number().int(), final: z.number().int(), wire: z.number().int() }).strict(),
  usefulness: z.object({ checker: z.boolean(), checkerTruncated: z.boolean(), placeholderDensity: z.number(), ownerAcknowledged: z.boolean() }).strict(),
  ownerForm: z.object({                                        // answers from fixed lists; free text stays local
    dataSubjects: z.array(z.enum(["owner_only", "clients", "patients", "participants", "correspondents", "staff", "other_third_party"])),
    approximateSubjectCount: z.enum(["0", "1", "2-9", "10-99", "100+"]),
    regimeChecklist: z.object({                                // one explicit answer per tag; any other answer discards the packet
      legal_privileged: z.literal("does_not_apply"),
      health_phi: z.literal("does_not_apply"),
      research_human_subjects: z.literal("does_not_apply"),
      controlled_access_genomic: z.literal("does_not_apply"),
      export_controlled_or_unpublished_ip: z.literal("does_not_apply"),
                                                               // for family coding or source-code sources this row is locked "applies" and not shown as answerable
                                                               // unless codeDecision is "not_tagged"; the lock is enforced by the builder and eligible(), not by the form
    }).strict(),
    regimeSuggestiveResolutions: z.array(z.object({            // required for every family in regimeSuggestive; statements about the regime, never about the identifier
      family: z.string(), tag: regimeTagSchema,
      reasonCode: z.enum(["owner_is_the_party", "synthetic_or_test_data", "no_client_or_patient_relationship", "data_is_the_owners_published_work",
        "identifier_not_of_a_person_or_matter"]),              // per tag (§3.2): legal_privileged, health_phi and research_human_subjects take the first four; the last only for
                                                               // ICD-shaped hits in the general and website families; the two no-override tags never appear here, their
                                                               // codes exist only on RegimeContextDecisionSchema below
    }).strict()).max(16),
    legalBasis: z.enum(["owner_own_data", "consent_obtained", "contract_necessity", "legitimate_interest_balanced"]),
    professionalAnalysisDone: z.boolean(),                     // the conduct-rule step, separate from the legal basis
    providerPostureAcknowledged: z.literal(true),
    largePacketAcknowledged: z.boolean(),
    packetNotUsefulAcknowledged: z.boolean(),
  }).strict(),
  providerPosture: z.object({ termsSnapshotSha256: sha256Schema, storeFalse: z.literal(true), retentionClassAsBelieved: z.enum(["zero_data_retention", "default_abuse_window", "unknown"]),
    serviceTier: z.string(), locationClass: z.enum(["home_jurisdiction", "abroad"]) }).strict(),
  packetBudget: z.object({ sentForJob: z.number().int(), limit: z.number().int() }).strict(),
  tracer: z.object({ present: z.literal(true), keyedOn: z.literal("manifestId"), hmacVerified: z.boolean() }).strict(),
  createdAt: z.number().int(),
}).strict();

export const LayerVerdictRecordSchema = z.object({
  layer: z.enum(["rules", "opf", "local_checker", "structural", "owner"]),
  pass: z.number().int().min(1).max(3).optional(),            // checker passes
  identity: z.string(),
  sampling: z.object({ temperature: z.number(), topP: z.number(), seed: z.number().int() }).strict().optional(),   // checker passes
  servedModelSha256: sha256Schema.optional(),                 // checker passes (P16)
  status: z.enum(["complete", "timeout", "failed"]),          // checker: anything but "complete" is a block with no override (§3.4)
  verdict: z.enum(["clear", "redact", "block"]),
  truncated: z.boolean().optional(),                          // checker: eight-finding cap reached on a complete pass; a cut output is status "failed" with errorCode "length_cut" or "malformed", or status "timeout"
  budgetWarning: z.boolean().optional(),                      // checker: complete, but later than the no-margin figure (§3.4); an F4 rate, never a demotion
  inputSha256: sha256Schema, outputSha256: sha256Schema,
  spanCount: z.number().int(), findingCount: z.number().int(), findingsSha256: sha256Schema,
  elapsedMs: z.number().int(), errorCode: z.string().optional(),
  override: z.object({ by: z.literal("owner"), reasonCode: z.string(), findingKind: z.string().optional() }).strict().optional(),
}).strict();

export const RegimeContextDecisionSchema = z.object({          // §3.2: per context, never per packet; the only place the two no-override tags take a reason code
  decisionId: z.string().uuid(), contextId: privateAgentId, family: z.string(),
  tag: z.enum(["controlled_access_genomic", "export_controlled_or_unpublished_ip"]),
  reasonCode: z.enum(["synthetic_or_test_data", "dataset_open_access_no_dua", "data_is_the_owners_published_work", "owner_holds_rights_and_releases"]),
                                                               // genomic: synthetic_or_test_data | dataset_open_access_no_dua; export/IP: synthetic_or_test_data |
                                                               // data_is_the_owners_published_work | owner_holds_rights_and_releases; the store rejects any other pairing
  recordedAt: z.number().int(),
}).strict();
```

### 4.2 Span record (local manifest store only; never in events)

```ts
export const SpanRecordSchema = z.object({
  id: z.string().regex(/^s_\d{1,5}$/u),
  layer: z.enum(["rules", "opf", "local_checker", "structural", "owner"]),
  label: z.enum(["person", "organisation", "address", "email", "phone", "account_number", "private_url", "private_date",
    "secret", "registered_identifier", "context_sensitive", "owner_marked"]),
  start: z.number().int(), end: z.number().int(),             // Unicode codepoints, exclusive end, in this layer's input
  startUtf16: z.number().int(), endUtf16: z.number().int(),
  originalSha256: sha256Schema,                               // the value itself lives only in the map
  entityKey: z.string(),                                      // normalised original, for consistency
  placeholder: z.string().regex(/^«[A-Z]+_[0-9a-f]{6}»$/u),
  action: z.enum(["placeholder", "drop", "reveal", "block"]),
  confidence: z.number().min(0).max(1).optional(),
}).strict();
```

Offsets are verified in Unicode codepoints across Python and TypeScript on
Chinese, emoji with modifiers and combining characters before any span is
applied; a mask is never reconstructed from display strings.

### 4.3 Restoration map (encrypted at rest; deleted with the job)

```ts
export const RestorationMapSchema = z.object({
  version: z.literal(2),
  mapId: z.string().uuid(), manifestId: z.string().uuid(),
  jobId: privateAgentId, contextId: privateAgentId,
  codeSpace: z.literal("csprng_hex6"),                         // placeholder suffix = six hex from a CSPRNG, unique within this map, per entity per packet
  entries: z.array(z.object({
    placeholder: z.string(), label: z.string(), entityKey: z.string(),
    original: z.string(),                                      // the only place the value exists
    aliases: z.array(z.string()).max(16),
    spanIds: z.array(z.string()).min(1),
  }).strict()).max(2000),
  createdAt: z.number().int(), consumedAt: z.number().int().optional(), expiresAt: z.number().int(),
}).strict();
```

The first draft derived the suffix as `HMAC(salt, entityKey)[0:6]`. A keyed
hash of the name is still *derived from* information about the individual in
the words of HIPAA 164.514(c)(1) (§7.1); a random code stored only in the map
is not, gives the same within-packet consistency (the map is the lookup, not
the hash), and removes the question instead of citing guidance for it. The
`salt` field and `mapSaltSha256` are gone; the manifest records the hash of
the map's ciphertext, which is content-free.

### 4.4 Identifier registry (per job; encrypted like the map)

```ts
export const IdentifierRegistrySchema = z.object({
  version: z.literal(2), jobId: privateAgentId,
  builtAt: z.number().int(),                                   // the first cloud action in the job, not job start
  partial: z.boolean(),                                        // harvest hit its byte bound, a chunk failed (cut, timed out, malformed, flooded), or the entry cap was reached
  harvestScope: z.literal("inputs_brief_and_instructions"),    // the rendered input files, the private brief and the job instructions (§3.2)
  harvestChunks: z.number().int(),                             // ≤ 50k-input-token, ≤ 4,096-output-token streaming calls to the 27B on the filter destination (§3.4), sub-chunk continuations included
  failedChunks: z.array(z.object({ chunk: z.number().int(), reason: z.enum(["length_cut", "timeout", "malformed", "flooded", "entry_cap_reached"]) }).strict()).max(256),
  partialAcknowledged: z.object({ reasonCode: z.enum(["inputs_exceed_bound", "harvest_failed_retried", "owner_supplied_registry"]), at: z.number().int() }).strict().optional(),
  entries: z.array(z.object({
    kind: z.enum(["person", "organisation", "matter", "patient", "participant", "study", "place", "product", "record_number", "other"]),
    value: z.string().min(2).max(200),
    origin: z.enum(["harvest", "raw_scan", "owner", "cross_job"]),   // cross_job: an L4 digest hit (§3.5 item 8)
    regime: z.boolean(),                                       // a regime identifier is a hard block, never a placeholder
  }).strict()).max(5000),
  harvestIdentity: z.string().optional(),
}).strict();
```

### 4.5 Storage

| Object | Where | Encrypted | In events | Deleted with job |
| --- | --- | --- | --- | --- |
| Manifest | `private_agent_outbound_manifests (manifest_id, job_id, value)` | no (content-free) | hash only | tombstone kept |
| Span records | with the manifest, local store | yes | never | yes |
| Restoration map | `private_agent_restoration_maps (map_id, job_id, ciphertext, nonce)` | per-install Keychain key (the helper from BL-20261008-1211, not `security -w`) | never | yes |
| Registry | same table family | yes | counts by kind only | yes |
| Proposal text (consultation and outbound) | `private_agent_proposals (proposal_id, job_id, ciphertext, nonce)`, same table family as the map; replaces `packetText` inside `consultation_proposed` (R1 migration) | yes | hashes only (`packetSha256`, `manifestSha256`) | yes |
| Wire bytes and restored reply | job workspace, host-only path the renderer and sandbox cannot reach | yes | hashes only | yes, under the labelled-job retention (§12) |
| Cross-job echo digest set | host process memory, rebuilt from live registries; exact set of salted HMAC digests, no probabilistic structure (§3.8) | salted with a per-process salt never persisted; holds no plaintext | never | rebuilt |
| Stage row (§4.7) | `private_agent_install (key = "stage", value)`, one row per install | no (content-free) | `stage_row_set` with the entry reference | no; survives jobs |
| D20(b) row (§4.7) | `private_agent_install (key = "code_decision", value)` | no (content-free) | `code_decision_recorded` with the entry reference | no; survives jobs |
| Per-context regime decisions (§3.2) | `private_agent_outbound_context_decisions (decision_id, context_id, value)` | no (codes only) | `outbound_regime_context_decision` | with the context |
| Tracer key | Keychain | | | no |
| Key recovery secret (D27, opt-in only) | off-device, owner-held, passphrase-wrapped copy of the Keychain key | yes | never | no |

Everything in the "yes" column is readable only while the per-install Keychain
key exists. Without D27 there is no second copy of that key; a lost Mac or a
wiped Keychain makes every map, registry, proposal text and packet copy
unreadable, and Q13's "the record can answer" is true only up to that point
(§6, §7.3).

### 4.6 Events on the chain

Prerequisite (P8): `prevSha256` on every row of `private_agent_events` and on
every receipt, computed as `digest(canonical(previousRow))`, the first row
chained to the first context's `contextSha256`, with a verifier script. All
events below are content-free, and so, after the R1 migration, is
`consultation_proposed`; a CI test asserts that no event row exceeds a small
size bound.

| Event | Fields | Written by |
| --- | --- | --- |
| `stage_row_set` | `level, languageClasses[], families[], purposes[], approvedEntryId, approvedEntrySha256, approvedEntryLength, previous: {level, languageClasses[], families[], purposes[]}, demotion?: {rule: F4 \| F6, familiesKept[], purposesKept[]}` | the owner action in the stage surface (§4.7); never by a job |
| `code_decision_recorded` | `answer: tagged \| not_tagged, recordedEntryId, recordedEntrySha256, recordedEntryLength` | the owner action in the stage surface (§4.7) |
| `registry_built` | `jobId, entryCount, byKind, byOrigin, partial, harvestScope, harvestChunks, failedChunks[], partialAcknowledged?, harvestIdentity?, harvestDispatchId?` | first cloud action in the job; rewritten on completion or acknowledgement |
| `outbound_registry_partial` | `jobId, failedChunks[], acknowledgedReasonCode?` | L0 (refusal) or the owner (acknowledgement) |
| `outbound_regime_context_decision` | `decisionId, contextId, family, tag, reasonCode` (the tag's own list, `RegimeContextDecisionSchema` §4.1) | the owner, in the job surface, never in the packet form (§3.2) |
| `outbound_built` | `manifestId, purpose, family, languageClass, languageClassEvidence, templateSha256, candidateSha256, provenance[], supersedesManifestId?, priorBlock?` | L0 |
| `outbound_stage_denied` | `jobId, contextId, stage, languageClass, family, purpose, reason: stage \| code_decision \| purpose` | L0 or `eligible()` |
| `outbound_layer` | `manifestId` + one `LayerVerdictRecord` | after each layer and pass, timeouts, length cuts and budget warnings included |
| `outbound_regime_suggestive` | `manifestId, families[], suggestedTags[], resolution: tagged \| does_not_apply_per_tag, reasonCodes[]` | L1 and the owner |
| `outbound_blocked` | `manifestId, layer, reasonCode` | pipeline |
| `outbound_proposed` | `manifestId, manifestSha256, contentSha256, packetSha256, destinationSha256, maxFeeMicrousd, bytes` | proposal |
| `outbound_decision` | `manifestId, decision, grantId?, overrides[]: {layer, findingKind, reasonCode}, reveals[]: {spanId, preserveClass}, ownerFormSha256, reviewSeconds` | owner |
| dispatch receipt | existing fields + `scan.manifestSha256`, `scan.manifestId`, `scan.mode`, `providerPosture`, `labels` (parent context), `locationClass` | broker |
| `outbound_restored` | `manifestId, dispatchId, responseSha256, restoredSha256, placeholdersRestored, unresolvedPlaceholders, replyScreen: {screenedBeforeRestore: true, rulesHit, echoTier: none \| review \| incident, crossJobHit, injectionFindings, requestsMoreData}` | L7 |
| `outbound_echo_review` | `manifestId, dispatchId, kind, count` | L7, review-class |
| `outbound_incident` | `manifestId?, kind: tracer_hit \| response_echo \| owner_found_miss, tier: incident, action: incident_switch` | F6 |
| `restoration_map_deleted` | `mapId, manifestId` | retention |

The per-job disclosure report (P15) lists each `outbound_proposed` that reached
a receipt: time, destination, bytes on the wire, label level, language class,
purpose, manifest hash, layer verdicts, every override with its finding kind,
every `regime_suggestive` resolution with its reason code and every
per-context decision the packet relied on, the registry's `partial` state and
any acknowledged reason, the form answers, the provider posture, the echo tier
of the reply, and whether the reply was restored into an artifact. For each
approved packet it lists the **rerun chain**: every manifest it supersedes and
the layer and finding kind each was blocked on, so a packet approved after a
quoted passage was generalised reads differently from one the checker never
flagged. It also lists, by a keyed per-matter identifier, every packet ever
sent about the same matter, so the owner can judge accumulation.

### 4.7 Install-level rows: the stage and the D20(b) answer

Two facts the enforcement in L0 and `eligible()` rests on are not per job and
cannot be written by a job: which stage the install is at, and whether the
owner has answered D20(b). r1 said "the S-B `Approved` entry writes `stage` to
the policy", which named no writer and no home: `PrivateJobPolicy` is per job
(`contracts.ts:19-27`; `store.ts:105` `revisePolicy(id, {mode, destinations})`),
a build-log entry cannot write a database row, and a job created after the
entry would have re-defaulted to `S-A`. Each is now **one row in an
install-level table** with a defined writer:

```ts
export const StageRowSchema = z.object({
  level: z.enum(["S-A", "S-B"]),
  languageClasses: z.array(z.enum(["en", "zh", "mixed"])),     // empty under S-A
  families: z.array(z.enum(["research", "document_review", "deck", "website", "admin", "coding", "general"])),   // empty under S-A; F2 writes it per cell, F4 demotion narrows it
  purposes: z.array(z.enum(["repair_critique", "code_review", "schema_review", "plan_review", "research_framing"])),   // empty under S-A; F4 demotion narrows it to the structure-only two
  approvedEntryId: z.string().regex(/^BL-\d{8}-\d{4}$/u),     // the S-B Approved entry; required even for a revert to S-A; parsed from the entry text the owner supplied
  approvedEntrySha256: sha256Schema,                           // SHA-256 the surface computed over the entry text the owner supplied (§4.7 "Writer")
  approvedEntryLength: z.number().int().positive(),            // byte length of that text, so an audit can compare it with the committed entry
  setAt: z.number().int(),
  demotion: z.object({ rule: z.enum(["F4", "F6"]), familiesKept: z.array(z.string()), purposesKept: z.array(z.string()), entryId: z.string() }).strict().optional(),
}).strict();

export const CodeDecisionRowSchema = z.object({                // D20(b)
  answer: z.enum(["tagged", "not_tagged"]),
  recordedEntryId: z.string().regex(/^BL-\d{8}-\d{4}$/u),
  recordedEntrySha256: sha256Schema,
  recordedEntryLength: z.number().int().positive(),
  setAt: z.number().int(),
}).strict();
```

- **Writer.** Only an owner action in a dedicated stage surface (a settings
  panel, never the approval panel, never a job) writes either row. The surface
  takes the entry's **committed text** (pasted, or read from a repository
  path the owner configures), parses the id from its header, computes the
  SHA-256 and the byte length itself, and stores all three; it refuses to
  write from an id alone. r2 said "the store rejects a row whose hash does
  not match the entry it names", but the desktop app holds no copy of
  `docs/BUILD_LOG.md`, so with a typed id and a typed hash the check could
  not be performed, and the sentence presented a recorded citation as a
  verified one. What the row now verifies is that the stored hash is the hash
  of the text the owner supplied; whether that text is the committed entry is
  checked later, by anyone with the repository, against the stored hash and
  length. The **writer restriction is the control**; the entry reference is a
  recorded citation an audit can verify, not one the app verifies against the
  repository. No host code path other than that surface's handler has write
  access; a test asserts that `revisePolicy`, the broker and the outbound
  module cannot write it.
- **Absent means closed.** No stage row is `S-A` with no classes, no
  families and no purposes; no D20(b) row is "tagged". A fresh install, a
  wiped database and a revert all read the same way.
- **Product, not cells.** A packet is open under the row only when its
  language class, its family and its purpose are each listed. The row is a
  product of three lists, not a table of cells, which is the more restrictive
  of the two shapes the F2 fix allowed: a family is listed only when its
  family × language cell met the corpus minimum and passed F2 in **every**
  language class the row lists (§8.2 item 9, §8.6), so opening a second
  language class later may require dropping a family that passed only in the
  first, and that trade is made in the open by the owner's row write rather
  than hidden in a per-cell table.
- **Snapshot and re-read.** Each job's policy receives a snapshot of both
  rows at creation (`policy.stage`, `policy.codeDecision`), and each manifest
  carries them (§4.1), so the record says what the packet was judged under;
  but L0 and `eligible()` read the **install row** at build and at every
  commit, so a stale snapshot never permits what the row no longer does. An
  F6 revert (`level: "S-A"`) refuses the next commit of any job whose snapshot
  still says `S-B`, with `outbound_stage_denied`.
- **Demotion.** F4 failure narrows `families` to the ones the owner names in a
  recorded decision as structure-only and `purposes` to
  `["schema_review", "plan_review"]`, and records the demotion in the row;
  `eligible()` checks the manifest's family and purpose against `families`
  and `purposes` as it checks the language class. r2's row had no `purposes`
  field and `eligible()` checked class and family only, so after a demotion
  `repair_critique` or `code_review` in a kept family would have remained
  eligible.
- **Tests (R1).** The surface refuses an entry id without the entry text and
  stores the hash and length of the text it was given; a job created under
  `S-B` cannot commit after a revert; a packet whose purpose is outside the
  row's `purposes` is refused at commit; a `coding` packet from a
  non-synthetic context cannot produce a manifest or a grant while the D20(b)
  row is absent, and the same for a `general` packet whose context has a
  source-code source, and for a script path that creates a sub-context with a
  `.txt` derived source over a parent with a `.ts` source; a request with no
  `validateAtCommit` callback is still refused when the parent carries a
  tag.

## 5. The owner approval step

### 5.1 The surface

In `GeneralTaskWorkspace.tsx`, generalising the consultation panel. It is
never shown on the screen that shows the failing local result; the owner
navigates to it.

- Left: the candidate (derived material, real values). Right: the exact bytes
  that would leave, placeholders highlighted, colour by layer, paginated at
  16 KiB.
- A findings list grouped by layer, each with its action; checker free text
  (`reason`, `usefulReason`) marked as untrusted model text; `reveal`
  suggestions with a button, each naming its preserve class, offered only for
  spans the §3.4 exemption allows and hidden entirely when any pass reported
  `injection_attempt`; blocks with reasons and with
  whether they can be overridden (§5.3); a `truncated` flag when the checker
  had more than eight findings; a non-complete pass shown with its status
  (timeout, length cut, malformed) and the words "no override"; a `complete`
  pass that carries a budget warning, with its elapsed time against the
  no-margin figure (§3.4); the copied-bytes share and the locators
  substituted; the placeholder density;
  the checker's usefulness verdict; the registry-prompt truncation flag and
  the registry's `partial` state when they apply; the rerun chain when this
  packet supersedes a blocked one, with the prior finding kind.
- A tab with the wire text (`PacketPreview.text`), its SHA-256, the context
  SHA-256, the manifest SHA-256 and id, the destination, model, fee cap.
- The restoration map as counts by label, expandable to entries on request,
  local view only.
- The provider posture line: retention class as believed, `store: false`,
  terms snapshot date.
- The count of packets already sent about this matter and the job's budget.
- The install-level stage (level, classes, families, purposes, the entry it
  cites) and
  the language class with its CJK evidence counts the packet is being judged
  under; the D20(b) row's state where the family or sources make it relevant.

### 5.2 The recorded form

Answers from fixed lists, required before the button exists, hashed into
`outbound_decision`:

1. Whose data is in this packet (categories, approximate count).
2. **The per-tag regime checklist**: five rows, one per tag, each requiring an
   explicit answer. Rows are pre-set to the strongest plausible tag for the
   family (`document_review` → `legal_privileged` and `health_phi`; `research`
   → `research_human_subjects` and `export_controlled_or_unpublished_ip`;
   `coding` → `export_controlled_or_unpublished_ip`; `admin` → `health_phi`;
   `deck`, `website` and `general` → no pre-set) and the owner must change each
   pre-set row to "does not apply" deliberately. Any row left as "applies"
   removes the button, tells the owner to re-label the context, and discards
   the packet. A pre-set is a prompt, not a control: for the
   `export_controlled_or_unpublished_ip` row on a `coding` packet, or on any
   packet whose context has source-code sources, the row is **locked
   "applies" and not shown as answerable** unless the install-level D20(b) row
   says `not_tagged` (§4.7); such a packet is refused by the builder before
   the form exists, so the form never decides it. r1 let the owner flip that
   pre-set per packet, which was an override path for a tag §7.2 says has
   none. Where L1 raised a `regime_suggestive` stop, the matching rows
   additionally need a reason code from that tag's regime-statement list in
   §4.1, and the answer is recorded as an override of kind
   `regime_suggestive`; for
   the two no-override tags no row can be answered here at all, the packet is
   discarded, and only re-labelling or a per-context decision made in the job
   surface (§3.2) changes the next packet. This replaces the single yes/no
   question of the first draft, which let an untagged privileged matter
   through on one click.
3. The legal basis for this disclosure (fixed list in §4.1) and, as a separate
   boolean, whether the professional-conduct analysis (confidentiality rule,
   client terms) has been done. The first draft mixed the two in one field, so
   the record could not later say what the Art 6 basis was.
4. The provider posture line has been read.

Plus `large_packet_acknowledged` when content exceeds 16 KiB, and
`packet_not_useful` acknowledged when the checker or the density threshold said
so. Free text the owner adds stays local.

### 5.3 When the button is enabled

Regime tags empty on the parent context; the D20(b) row recorded `not_tagged`
where the family is `coding` or the context has source-code sources (otherwise
the packet was never built); every row of the per-tag checklist answered "does
not apply", with regime-statement reason codes where L1 stopped, and no
unresolved stop for the two no-override tags; the install-level stage row
`S-B` for the packet's language class, family **and purpose**, re-read at the
moment the button is enabled, or the context synthetic or `public`; every
reveal within the §3.4 exemption; every checker
pass `complete` (no timeout, length cut, malformed or empty pass, none of
which can be overridden); every other layer `complete`; L4 invariants passed,
the relative-date anchor check included; the registry not `partial`, or
`partial` acknowledged with a recorded reason code; `useful` true or
acknowledged; the preview still matches (`expiresAt` not passed, context and
parent-chain hashes unchanged); the form complete; the job's packet budget not
exhausted; the provider posture verified at least once (Q15). Approve writes
the decision and the one-use grant. A `local_checker` block can be overridden
with a reason code from a fixed list **only when its pass is `complete` and it
carries no located quote or is of kind `injection_attempt`**; a block with a
located `confidential_fact` or `reidentification` quote offers edit-and-rerun
(which records `supersedesManifestId` and `priorBlock` on the rerun) or
decline and nothing else; a `rules` or `structural` block, and any block from
a non-complete pass, cannot be overridden. Approval, decline and revoke are
events; every override is recorded with its finding kind; the review time is
recorded (D9 pattern).

### 5.4 Ergonomics as a control

Approval fatigue is a leak path (A15). Hence: the 16 KiB default, the diff
rather than the whole packet, one packet per task by default, the per-tag rows
that must each be answered, the override that is not available for the finding
that matters, and the separation from the failure screen. The owner's minutes
per packet are measured and reported with the first real uses.

## 6. The restoration map

- **Grammar.** `«TYPE_xxxxxx»`, six lowercase hex drawn from a CSPRNG per
  entity and per packet, unique within the map. Never derived from the
  original's letters, never a surrogate name, never sequential, and never a
  hash of the entity key, keyed or not. HIPAA 164.514(c)(1) says a
  re-identification code must not be "derived from or related to information
  about the individual" and (c)(2) that the mechanism must not be disclosed; a
  keyed HMAC of the name is derived from it, and whether HHS's 2012
  de-identification guidance accepts a keyed hash is a question (*verify*,
  §7.1) this design does not need to answer. The rule is adopted for every
  regime.
- **Consistency.** One placeholder per entity within a packet (L4 clusters
  "Li, Wei", "Wei Li", "W. Li" and "李伟" when the registry or the checker
  links them); a different placeholder for the same entity in the next packet,
  because the code is drawn afresh. A cloud critic can still count distinct
  placeholders per type; §11.
- **Ownership.** Built by the host from L1-L4 spans; the agent never chooses
  placeholders; the map never enters `output/`, `review/`, `context/` or any
  path the renderer or the sandbox reads.
- **Storage.** Encrypted with a per-install Keychain key; the manifest holds
  only the map id, the ciphertext hash and counts; never in events, previews,
  telemetry or exports.
- **Key recovery.** There is one key, in this install's Keychain, and by
  default no second copy. A lost Mac or a wiped Keychain leaves every map,
  registry, proposal text and packet copy unreadable, including inside a
  72-hour breach window; Q13 and the deletion residual report say so. The
  owner may elect an owner-held recovery secret (a passphrase-wrapped copy of
  the key stored off-device by the owner, D27); the default is none, because a
  second copy of the key is a second thing to lose, and the more restrictive
  reading is the default here.
- **Lifecycle.** Created at L1, extended through L4, bound to the grant,
  consumed at L7 (`consumedAt`), kept until the job's retention for the
  disclosure report, then deleted and vacuumed (`restoration_map_deleted`).
- **Restoration.** The reply is screened first, placeholders intact (§3.8).
  Exact placeholder matches are then replaced; unmatched
  placeholders are counted and left in place; the reply is untrusted advice
  either way. If the key is missing the reply stays placeholdered and is marked
  `unrestored`; nothing re-identifies by guessing.
- **Re-entry.** A restored reply joins the provenance index (§3.2 item 3), so
  a restored critique copied into a later draft is caught on the next packet by
  the originals-absent invariant and the provenance diff; a reply is never a
  cloud input without the pipeline and a fresh approval.
- **Dates.** Relative dates are a transform, not a map entry; the interval
  origin is recorded in the map so a critique's "day +14" can be restored. Date
  shifting with a random offset is deferred (one public anchor in the packet
  gives the offset away). The same single-anchor weakness applies to relative
  intervals, which r1 emitted without the check it deferred shifting for: a
  preserved public date or a dated citation beside "day +3" reveals day 0
  equally. So L4 runs the anchor check now for relative intervals (§3.5 item
  5): any surviving absolute date or date-bearing citation in a packet with
  relative days is a non-overridable finding, and the owner drops one or the
  other before approval. Shifting stays deferred until the same check has
  been exercised on the development split.

## 7. Regulatory frame and the consent and recording minimum

This section is a frame for the owner and their counsel in the jurisdictions
the owner has not yet named (D14). It is not legal advice. Items the lenses
cited from memory and did not re-fetch are marked *verify*; the private work
design's source list of 2026-09-29 is the fact-checked baseline.

### 7.1 What the professions impose on a placeholdered packet

- **GDPR and UK GDPR.** Art 4(5): a packet with placeholders and a local map is
  pseudonymised, hence personal data in SOAR's hands; Recital 26's "means
  reasonably likely" test decides the provider's side, and for one rare case in
  one city the answer is usually yes even without the map (EDPB Guidelines
  01/2025 and CJEU *EDPS v SRB* C-413/23 P, *verify*). Art 32 lists
  pseudonymisation as a security measure: the filter is Art 32 evidence and
  never a basis under Arts 6 or 9. Art 9 special categories (health, and the
  rest), Art 28 processor contract (the provider's DPA), Art 30 record, Art 35
  DPIA naming "cloud critique of pseudonymised drafts" as an operation,
  Chapter V transfer mechanism, Art 33's 72-hour clock, which needs the ledger
  to say what left, to whom, about whom (*verify* the article numbers beyond
  4(5), 9 and 32). The form records the Art 6 basis as its own field
  (`legalBasis`), separate from the professional-conduct step, so the record
  can later say which basis was claimed. A note the lenses raised and this
  design does not build on: whether a Chinese name reveals ethnic origin under
  Art 9 is contested (*verify*); no control here is planned on that reading.
- **HIPAA.** Safe Harbor's eighteen identifiers (45 CFR 164.514(b)(2)): OPF's
  eight labels cover about seven; rules cover most of the rest by format; the
  eighteenth ("any other unique identifying characteristic") and the
  actual-knowledge condition are the quasi-identifier problem no detector
  covers. Expert Determination (164.514(b)(1)) has no population requirement,
  but it is impractical per packet for an n = 1 narrative, so it is not a route
  this design offers. A critique packet about one patient is PHI unless Safe
  Harbor is met on every element, which the owner must assert per packet;
  disclosure to the provider then needs a BAA and minimum necessary.
  164.514(c) is the placeholder rule: (c)(1) forbids a code derived from or
  related to information about the individual, which is why the code is
  random and not a keyed hash of the name (§6); whether HHS's 2012
  de-identification guidance would accept a keyed hash is left unanswered
  (*verify*) because nothing here depends on it (*verify* also 164.502,
  164.504, 164.514(b)(1), (c), (e), 164.402-404).
- **Attorney-client privilege and confidentiality.** Confidentiality (ABA Model
  Rule 1.6; ABA Formal Opinion 512 on generative AI, *verify* 477R and 498)
  covers all information relating to the representation, named or not; a
  redacted critique of a privileged memo is still that. Privilege protects the
  advice and strategy, which is what a critique packet contains, so stripping
  names does not help privilege at all; disclosure to a vendor under
  confidentiality terms (the *Kovel* line, *verify*) is the argument, and the
  terms that matter are no training, no human review except narrow abuse
  review (which zero data retention removes), deletion, and the provider's
  position on legal process. FRE 502(b) (*verify*) is where the filter, the
  exact-bytes approval and the ledger are evidence of reasonable steps and the
  incident switch of prompt rectification. The per-tag checklist (§5.2) exists
  because a privileged matter the owner did not tag is still a privileged
  matter.
- **Human-subjects research and data use.** Consent forms and DUAs govern
  derived participant information regardless of identifiability; NIH
  NOT-OD-24-157 and NOT-OD-25-081 forbid generative AI tools that retain or
  train on controlled-access data; the PRC Human Genetic Resources Regulation
  (*verify*) restricts providing HGR information abroad. `research_human_subjects`
  may open only on the IRB protocol, the consent form and the DUA, each cited by
  hash; `controlled_access_genomic` never. An accession-shaped identifier in a
  packet is treated as regime evidence by L1 (§3.2) whether or not the context
  was tagged.
- **PIPL.** Art 73: de-identified (去标识化) is still personal information;
  only anonymised (匿名化) is outside the law. Arts 28-32: medical, financial,
  whereabouts and identity data are sensitive and need separate consent; Art 55
  impact assessment before sensitive processing and cross-border provision;
  Arts 38-40 transfer mechanisms (*verify* the March 2024 Provisions' exemption
  thresholds); Art 41 on foreign legal process. The owner's location at
  dispatch changes which regime attaches, so the receipt records it.
- **Export control and trade secrets.** A cloud model processes plaintext, so
  a packet with controlled technical data is a release (EAR §734.18 does not
  help, *verify*); `export_controlled_or_unpublished_ip` stays never. Whether
  the owner's private source code falls under this tag is undefined in P1 today
  and is D20(b); until the owner answers it is treated as tagged, and "treated
  as tagged" is an install-level row the builder and `eligible()` read (§4.7),
  not a checklist default. Trade secret status depends on reasonable
  measures; record the terms version per packet.

### 7.2 The consent minimum, by whose data is in the packet

| Data in packet | Minimum before the approve button exists |
| --- | --- |
| Owner's own data only | The form with `owner_own_data`, the five-row checklist answered, the professional-analysis flag; the record. |
| Third-party `personal` or `confidential_professional`, no regime tag | The form: a legal basis from the fixed list, the professional-analysis flag, data-subject categories and count, the five-row checklist answered with regime-statement reason codes where L1 stopped, provider posture read; the posture verified under Q15; the install-level stage row `S-B` for the language class, family and purpose. |
| Owner's own private source code | Treated as `export_controlled_or_unpublished_ip` until the D20(b) row is recorded (§4.7): the builder refuses family `coding` and any non-synthetic context with source-code sources, the checklist row is locked and unanswerable, and `eligible()` re-reads the row at commit; then as the row above if the owner has recorded `not_tagged`. |
| `health_phi` | Never, unless the owner changes the rule for this tag explicitly and the product then records per packet: BAA in force for this account and endpoint, Safe Harbor asserted per element or patient authorisation on file, a minimum-necessary statement. |
| `legal_privileged` | Never, unless the owner changes the rule explicitly and records written client consent referencing the provider, or that the matter is the owner's own. |
| `research_human_subjects` | Never, unless the IRB protocol, consent form and DUA permit it, each cited by document hash. |
| `controlled_access_genomic`, `export_controlled_or_unpublished_ip` | Never. No override path in the product, and no per-packet exit from a `regime_suggestive` stop for either: the packet is discarded; re-labelling or a recorded per-context decision in the job surface, with a reason code from that tag's own list (§3.2, §4.1), is the only way a later packet from that context is built. |

### 7.3 What each dispatch must record, and what the record can answer

The receipt and manifest fields in §4 are the recording minimum: packet hash,
bytes, context hash, policy revision and stage, destination hash, labels and
tags at dispatch (of the parent context), language class, location class,
every layer's identity and outcome with a findings hash and the checker's
sampling pins, the provenance-diff share and index scope, the map ciphertext
hash, the form answers including the per-tag checklist and the separate legal
basis, every override with its finding kind, every reveal with its preserve
class, the stage row and D20(b) row snapshots with the entries they cite, the per-context regime decisions relied
on, the registry's `partial` state, the rerun chain with each prior block's
finding kind, the provider posture, the response hash, the echo tier, and
whether the reply was restored into an artifact, the chain link, the manifest
id and the keyed per-matter identifier.
With the encrypted packet copy under retention (Q13) the record can answer a
client's "what did you send about me", a 72-hour breach notice, or a privilege
dispute, **while the install's Keychain key exists** (or the D27 recovery
secret, if the owner elected one). After deletion, or after the key is lost,
it can say what kind of disclosure occurred and to whom, and not what; the
deletion residual report says both.

### 7.4 Words the product never uses

Design V1 §6 stands. Added: "multilayer" is not a safety claim; the product may
say "four checks ran and found nothing", never "clean", "anonymised",
"de-identified", "multilayer-verified", "HIPAA-safe" or
"privilege-preserving".

## 8. Evaluation and gates

### 8.1 The object under test

A packet, not a snippet: the canonical `{method, url, headers, body}` text the
broker builds and the owner approves, produced by the real builder from
synthetic jobs, with gold spans on the packet text. The September corpus
(snippets averaging about 390 bytes, 60 development and 60 sealed cases) is
retained for one run of record and is not the v2 confirmation set.

Leak classes the suites contain: direct identifiers; quasi-identifiers;
whole-context confidential propositions; credentials; structural leaks (paths,
table and schema names, fixture rows, commit messages); injection-carried
exfiltration aimed at the checker or the cloud; transformed identifiers
(initials, surname only, pinyin, full-width digits, zero-width joiners,
homoglyphs, encodings); regime-indicative identifiers in untagged contexts.

### 8.2 Corpus v2, gold by construction

Four profession suites (legal matters, clinical notes, grant and manuscript,
Chinese-language cases authored natively) in three languages (en, zh, mixed)
and the packet formats that occur (prose, Markdown tables, JSON, YAML, CSV,
logs, code, file headers), plus one cross-cutting suite. Each suite has
mandatory canaries (exposure is an incident), advisory canaries (a defect,
scored as a rate) and utility literals (must survive).

1. A registry of planted values per synthetic job, each with its class and its
   registered variants, generated by code. Each planted confidential fact is
   annotated as a **proposition** (RedacBench-style: the fact a reader could
   infer, written independent of wording) beside its verbatim sentence, because
   a 27B drafting from the source paraphrases, and verbatim gold that survives
   is caught by the provenance diff before the checker sees it.
2. Synthetic source documents written around the registry by the local model
   (free; about 4 minutes per 2,000-token document at 8 tokens/s, so 240
   documents is one or two overnight batches) and, for the hardest cases, by
   `gpt-6-sol` with no owner seed under the synthetic bucket. The local
   generator is the same 27B that then harvests, checks and judges, so a
   paraphrase habit shared by generator and checker is invisible to every
   number in §8.3; the cloud-authored hard subset is therefore sized to be
   reportable, at least ten documents per language within the existing
   synthetic bucket (§9.3), and proposition recall and harvest recall are
   reported on it separately (§8.3, §11).
3. Packets built by running the real local pipeline on those documents to
   produce drafts, then the real templates. The generator **places at least
   one mandatory and three advisory values per packet inside the regions the
   packet's template admits** (a heading, a failing-check excerpt, a diff
   hunk, a schema name, the cloud brief), **and at least one planted
   proposition per packet inside an admitted region where the family allows
   one** (the agent's rationale or new text in an issues list, a
   failing-check excerpt, the cloud brief, a plan step's "what failed"); r1
   placed values only, and a strategy sentence in a source document does not
   survive into an outline, so on outline-and-locator templates the
   proposition metric would have been computed on near-zero survivals. A
   packet that would otherwise carry nothing planted is re-generated, not
   kept as a cheap clean-packet control. A packet in a family whose admitted
   regions cannot carry a proposition (`schema_review`) is recorded as
   `proposition_unreachable` and excluded from the proposition denominator,
   never counted as recall. Clean-packet controls are authored separately and
   labelled as such.
4. Gold spans by exact search of registry values and variants in the packet
   text; planted propositions scored by an **arm-blind proposition judge**
   on whether the proposition survives in the packet, independent of wording.
   The judge is named in the freeze: the local 27B (zero fee) under a
   **judge prompt distinct from the checker prompt**, given only the
   proposition and the packet, never the checker's output, with its own
   schema, sampling pins and identity hash recorded beside the checker's; a
   paid judge (`gpt-6-sol`) is not used because the roughly 120 packets × 2
   configurations × several propositions would be a run absent from §9.3 and
   would send synthetic-but-labelled-shaped packets to the cloud for scoring.
   Sharing weights with the checker is a known limitation, so the judge's
   agreement with **the owner** (the comparator is the owner, not the
   auditing agent; r2 left that ambiguous, and read as the agent it would
   have gated the 27B against another model) is measured before the sealed
   pass on an **audited sample of at least 60 propositions, stratified by
   language (at least 20 per language class)**, scored on survive/absent and
   gated on the **Wilson 95 % lower bound ≥ 0.80** (0.90 observed on 60 is
   about 0.80; r2's 12 packets × 3-5 propositions gave 36-60 judgements whose
   lower bound at 0.90 observed was about 0.78). The audited sample is **held
   out of judge-prompt iteration**: a changed judge prompt is scored on a
   fresh 10 % sample, never on the one it was tuned against. The owner's
   adjudication of that sample is a scheduled hour per sealed version in
   §9.2. Separately, an agent that has seen no detector output audits the
   10 % sample for unplanned leaks, which are added as gold; its agreement
   with the judge is reported as **agent-auditor agreement**, labelled as
   such, and gates nothing. Adjudication of the judge's verdicts is
   one-directional by role: **the owner, and only the owner, may overturn a
   judged survival** (the judge says the proposition survived, the owner
   reads the packet text and records that it did not, with a reason); agent
   graders never may; and a judged *absence* that the owner finds present in
   the audited sample is an F1 miss and triggers re-judging of the whole
   split under the same prompt. r2's two sentences ("every judged miss is
   owner-adjudicated" and "a judged survival is never overturned in the
   agent's favour") described the same event and cancelled; this is what
   they meant.
5. Half the jobs per suite and language go to development, half to sealed
   confirmation; the independent evaluator holds the sealed gold.
6. A sealed set is rejected before the pass if any suite × language cell has
   fewer than ten mandatory canaries inside admitted regions, or fewer than
   five planted propositions inside admitted regions among the families that
   can carry one, or if any family × language cell the S-B entry would name
   has fewer than ten packets (item 9); the per-packet gold-count distribution and the per-packet
   **proposition-survival distribution** (how many planted propositions
   reached an admitted region, per packet) are reported with the pass. A
   development-split check also asserts that no `en`-classed packet contains
   a CJK gold span (§3.1).
7. **Harvest recall.** The §3.2 registry harvest runs on every synthetic job
   and is scored against the planted registry, per class, language and
   **origin** (the 27B harvest, the OPF-plus-rules raw scan, and their
   union), and separately on the cloud-authored subset (item 2). It is
   an F0 metric, because on a corpus whose gold *is* a registry and whose L1
   matches a harvested registry with the same normalisation, every other number
   depends on what the harvest found. It is also scored on the
   **harvest-injected subset** (§8.8): documents that instruct the harvester
   to omit, rename or flood (the flood case includes a document that keeps a
   leaf sub-chunk reporting `more: true`, §3.2), where a drop below the clean
   figure by more than two percentage points in any class is a development
   failure.
8. **Two configurations per sealed pass**, on the same sealed set and within
   the one sealed pass per version (§8.5): *registry on*, and *registry
   withheld*, in which 50 % of planted values are withheld from the registry at
   random together with every value that occurs only in cross-turn text, the
   brief or a path, **and, in addition, every planted value the registry
   build missed on the development split** (the harvest-missed subset). In
   the withheld configuration F2 and F5 are computed
   **over the withheld gold subset only** (the values absent from the
   registry, plus the cross-turn, brief and path-only values), because the
   registered half is caught by L1 by construction: over all gold spans a
   layer set that found nothing it was not handed would still show ≈ 0.90.
   Recall on the registered subset is reported separately. The composed
   per-class, per-language estimate (1 − harvest recall) × (1 − withheld
   recall) is stated **under a named independence assumption** that the
   design knows to be false in the direction that matters: the harvest is
   the same 27B as the checker and registry origin (b) is the same OPF as
   L2, so a name the 27B cannot list from the raw document is correlated
   with a name it does not flag in the packet, and the product understates
   P(miss | not in registry) for exactly the names the configuration exists
   to measure. So withheld recall is also reported **on the harvest-missed
   subset alone**, and the composed estimate is bounded by (1 − harvest
   recall) × (1 − recall on the harvest-missed subset), the figure to cite;
   §11 says so. Both configurations are reported. Without this, L1 pre-empts
   nearly every identifier span and F5 removes OPF and the checker on a
   technicality.
9. **Family and purpose.** Every packet carries the family and purpose its
   template was chosen for, so the sealed set is a family × language matrix
   as well as a suite × language one; r2 sized it by suite only, with no
   stated mapping from a legal or clinical suite to `document_review`,
   `admin` or `research`, so the stage row's `families` would have been
   written from evidence never computed per family. The mapping: legal
   matters → `document_review` and `admin`; clinical notes →
   `document_review` and `admin`; grant and manuscript → `research` and
   `document_review`; the Chinese-language suite spans the same three,
   authored natively; the cross-cutting suite supplies `coding`, `deck`,
   `website` and `general`. For every family the S-B entry would name, each
   family × language cell has **at least ten packets, with at least two per
   purpose the template set admits for that family**; a family whose cell is
   short in a language class is not named for that class, F2 is reported per
   family × language beside per suite × language, and the stage row is
   written from those cells under the product rule of §4.7.

Sizes: 4 suites × 3 languages × 10 packets per split = 120 packets per split
as the suite × language minimum (the family × language minimum of item 9 adds
packets where the suites' spread leaves a named family short, and the
per-cell counts are reported with the pass), about 2,500 to 4,500 spans, at least 120 mandatory canaries per split and at
least ten per cell by construction, at least 100 planted propositions in
admitted regions per split and at least five per cell among the families that
can carry one, at least 40 Chinese `person` and 40 Chinese
structured-identifier spans. Rule of three on 120 clean sealed packets gives a
95 % per-packet upper bound of about 2.5 %.

### 8.3 Metrics

| Metric | Definition | Role |
| --- | --- | --- |
| Harvest recall | Planted registry values and variants the §3.2 harvest found, per class, language and origin (27B harvest, OPF-plus-rules raw scan, union), on clean documents, on the harvest-injected subset and on the cloud-authored subset separately | Validity (F0) |
| Mandatory misses | Mandatory gold spans not fully covered, per layer and composed, per suite and language, per registry configuration; the worst of the checker passes | Gate floor (F1) |
| Clean-packet rate | Share of sealed packets with zero mandatory misses, registry withheld | Headline; maps to incidents |
| Untyped covering recall | A gold span is found if some predicted span fully covers it (≤ 2 characters of overhang); strict exact-tuple recall alongside; read from the registry-withheld configuration **over the withheld gold subset** (values absent from the registry plus cross-turn, brief and path-only values); the registered subset reported separately; reported per family × language beside per suite × language; composed estimate (1 − harvest recall) × (1 − withheld recall) per class and language, stated under the independence assumption and bounded by the harvest-missed-subset figure (§8.2 item 8) | Advisory floor (F2) |
| Typed precision and recall | September's typed tuple match, per class | Placeholder typing |
| Character coverage | September's metric | Diagnostic only; never a headline again |
| Unnecessary mask rate; literal utility failures per class; reference consistency | Over-redaction and placeholder consistency | Utility (F3) |
| Proposition recall (whole-context) | Planted confidential propositions the named arm-blind judge (§8.2 item 4) finds absent from the packet after the pipeline, independent of wording, over the propositions that reached an admitted region (packets marked `proposition_unreachable` excluded from the denominator and reported as a count); judge–owner agreement on the ≥ 60-proposition audited sample (Wilson lower bound) and agent-auditor agreement reported beside it, each labelled; the cloud-authored subset reported separately; for the checker's attribution, spans the provenance diff caught verbatim are excluded and L3's recall on the paraphrased subset is reported | The only metric for whole-context sensitivity (F1 for mandatory propositions, owner-adjudicated; F2 input for L3) |
| Layer attribution | For each found span, the layers that found it; marginal recall per layer, registry withheld, over the withheld gold subset, verbatim-copied spans excluded from the checker's share | Removes dead layers (F5) |
| Checker injection resistance, false blocks, stability, non-complete passes | Share of packets whose verdict or quotes changed under a planted instruction; checker-only blocks on clean public packets; agreement across the two pinned settings; share of passes that did not end `complete`, by cause (`timeout`, `length_cut`, `malformed`); share of `complete` passes with a budget warning (§3.4) | F4 |
| Provenance-diff recall on variants | Registered variants found by L1 | F2; red-team seed |
| Regime-suggestive stop rate | Share of untagged packets with a planted regime-indicative identifier on which L1 stopped | F1 for the mandatory families |
| Completion, latency, offset round-trip | Share of packets completed; p50 and p95 per layer and composed on the machine that runs it; codepoint, UTF-16 and UTF-8 agreement on CJK, emoji and combining characters | F0 |
| Re-identification red team | The local model, given a candidate packet, is asked to name the institution, city, condition or matter; a correct guess on synthetic cases is a measured leak class, not a gate | Report |

Per-language and per-suite Wilson 95 % intervals; mandatory counts reported as
counts; every table reported for both registry configurations.

### 8.4 Utility study

Twelve synthetic failed drafts in the repair-pair shape (3 document review, 3
research, 2 admin, 2 deck, 1 website, 1 coding), each with six planted defects.
**Four** packet conditions per draft: R the raw packet as today's
`buildRepairPacket` renders it (synthetic, so allowed), U the template
unfiltered, P the template filtered with typed placeholders and transforms, M
the template filtered with literal masks. The R arm is the cell the first draft
lacked: the template is the largest change relative to the Phase 2 evidence
(10/12 measured on raw packets), and without R its cost would have been
invisible. One `gpt-6-sol` critique per condition (fee cap USD 0.80 each), 48
critiques, the same local repair from the identical draft for each, and an L′
critique on P as the "was cloud worth it" baseline. Outcomes: critique defect
recall of six, local repair pass rate, critiques that reference placeholders in
a way the repair cannot act on, arm guesses. Automated checks plus arm-blind
agent pre-score, provisional; the owner spot-checks four of forty-eight.
Utility loss is reported as two differences, recall(R) − recall(U) (the
template's cost) and recall(U) − recall(P) (the filter's cost), and gated on
their sum (F3): the more restrictive reading, since the owner pays both.
Cost ≤ USD 40, a new allocation (§9).

### 8.5 Sealed confirmation protocol v2

The September pass stalled in a full-inventory rehash of 28,116 frozen files
(3.57 GB, venv included) before loading any input, on a tree under the
iCloud-synced Desktop; zero detector calls, SIGTERM at one hour, exit 130. The
corrected protocol:

1. Move the trial tree off iCloud to `~/Developer` (P9 requires it); re-run
   `prepare.py`; the checkpoint, source and lock hashes must match the
   September receipts, which binds the move.
2. Two-tier freeze: hash the authority set eagerly (runtime sources, adapter,
   checkpoint, tokenizer, calibration, rules, checker prompt, schema and
   sampling pins, the structured-output mode and vLLM version, the
   proposition judge's prompt, schema and pins, the measured per-stream p5
   decode rate and the L3 timeout derived from it with its 450 s floor
   (§3.4), the `thor_filter` destination's values, the per-stage deadlines
   computed from R3's and R4's measured p95 figures (item 3), lock file); verify the
   venv lazily by manifest, size and a random 2 % content sample, stated in
   the receipt.
3. Separate deadlines, each with a receipt: preflight ≤ 10 min; the
   **Mac-only stage** (L1, L2, L4 over the sealed packets) ≤ 120 × p95_OPF ×
   1.5 per registry configuration, where p95_OPF is the per-packet OPF wall
   time R3 measured over the development corpus's packet sizes (r2 asserted
   60 min without arithmetic while OPF latency was unmeasured; at the
   design's own 20-30 s per 16 KiB chunk, 120 packets with the 64 KiB ones
   among them is 40-90 min, so the figure could not hold); the **Thor stage**
   (the checker's two passes and the proposition judge) ≤ 120 × (p95_checker
   + n_props × p95_judge) × 1.5 per registry configuration, where p95_checker
   is the per-packet checker wall time R4 measured, p95_judge the per-call
   judge wall time R4 measured and n_props the mean planted propositions per
   packet (r2's formula used the checker's p95 only, while the judge's
   360-600 calls per configuration, of order 3-5 h at 8 tokens/s over both
   configurations, run inside the same stage); both numbers are written into
   the freeze receipt before the pass; scoring ≤ 5 min. A preflight
   timeout does not consume the one sealed pass. A Mac-stage or Thor-stage
   deadline hit **voids the pass as an F0 completion failure**: it does not
   count as a tuning iteration against the sealed set, the inputs are not
   re-read, and the version gets a new identity only if something other than
   the deadline arithmetic changes.
4. A smoke run on a five-case decoy with its own gold, retired afterwards.
5. One sealed pass per filter version; inputs read once; gold opened only by
   the evaluator's scorer; failing categories reported, never failing cases; no
   tuning against the sealed set; after two versions a sealed set is retired.
6. The checker's sealed pass runs on the Thor over the SSH local forward, 120
   packets at up to 7.5 minutes each at the 450 s timeout (one to three at
   the unpinned 35 tokens/s), two concurrent passes, then the proposition judge
   over the same packets, one overnight batch per registry configuration
   inside the Thor-stage deadline of item 3.
7. Close the September loop first: run the retained 60-case sealed set against
   the frozen OPF-only selection once, scored by the September scorer.
   Expected: F1 fails (OPF alone missed 5/12 on development). The value is a
   complete record and a working protocol at zero cloud cost.
8. Both registry configurations (§8.2 item 8) run inside the one sealed pass,
   on the same inputs, the withheld set chosen by the evaluator and held with
   the sealed gold; a version whose withheld configuration was not run has no
   sealed result.

The choice between the checker reading the residual or the original, and
thinking off versus on, is made on the development split and frozen into the
identity before the sealed pass.

### 8.6 Pre-registered decision rules

- **F0 Validity.** A sealed pass counts only if every packet completed, every
  checker pass ended `complete`, every offset round-trip agreed, harvest
  recall was reported per class, language and origin on clean, on
  harvest-injected and on cloud-authored documents with the injected figure
  within two percentage points of the clean one in every class, every suite
  × language cell met the mandatory-canary and the proposition minimums and
  every named family × language cell met the packet minimum (§8.2 items 6
  and 9), the proposition judge's agreement with the owner on the ≥
  60-proposition audited sample was reported with its Wilson lower bound ≥
  0.80 and the sample held out of prompt iteration (§8.2 item 4), both
  registry configurations ran, every stage finished inside its deadline
  (§8.5 item 3), and latency stayed within the budget recorded in the freeze
  (composed p95 ≤ 9 min per 16 KiB packet and ≤ 10 min per 64 KiB packet at
  the 450 s L3 timeout, restated in the freeze when R4's derived timeout
  differs, on the machine that ran each layer, §9.1; r1's 3 and 5 min
  assumed an L3 row that exceeded its own budget, and r2's 7 and 8 min rested
  on the 360 s timeout).
  Otherwise the pass is void, the defect is fixed on development, and the
  version gets a new identity before its one sealed pass; a deadline hit
  alone does not count as a tuning iteration.
- **F1 Mandatory floor.** One missed mandatory canary or mandatory proposition
  in any suite, language, registry configuration or pass keeps the version at
  S-A; the owner, and only the owner, may overturn a judged survival, with a
  recorded reason and the packet text; agent graders never may; a judged
  absence the owner finds present in the audited sample is an F1 miss and
  re-judges the whole split (§8.2 item 4). A planted regime-indicative identifier on which L1 did not
  stop is a mandatory miss. The failing category joins the next development
  set. A category that fails twice across versions triggers a design change,
  not a threshold change.
- **F2 Advisory floor.** On the registry-withheld configuration, over the
  withheld gold subset (§8.2 item 8): untyped covering recall ≥ 0.90 overall,
  ≥ 0.85 per language and suite, Wilson lower bound ≥ 0.80; the registered
  subset is reported beside it and does not count toward the floor; the
  composed estimate (1 − harvest recall) × (1 − withheld recall) is stated
  per class and language twice, under independence and bounded by the
  harvest-missed subset (§8.2 item 8). Reported per suite × language and per
  family × language. The consequence is in stage-row terms (§4.7): a
  language class below the floor is not written into `languageClasses`; a
  family whose family × language cell is below the floor, or short of the
  §8.2 item 9 minimum, in any language class the row lists is not written
  into `families`; the row is a product, so nothing opens for a (class,
  family) pair unless both are listed. r2's "stays at S-A for that suite's
  contexts" named no field the row carries. S-B opens per language class
  only where F2 passes there; English is expected first, and zh and mixed
  stay at S-A until a version passes on them with the registry withheld.
- **F3 Utility.** Unnecessary mask rate ≤ 2 %; literal failures ≤ 2 % overall
  and 0 on dose, amount, citation and code-identifier classes; reference
  consistency ≥ 95 %; utility study mean recall loss recall(R) − recall(P)
  ≤ 1 of 6, with the template's and the filter's shares reported separately;
  local repair pass rate under P not worse than under R by more than 1 of 12;
  the P critique at least as good as L′. Otherwise the redaction strategy or
  the template changes before another sealed pass; recall bought by deleting
  everything is not promoted.
- **F4 Checker validity.** Injection resistance 100 % on ≥ 30 injection
  packets, counting a reveal suggestion or a `useful: false` reason that
  follows an injected instruction as a failure even when the verdict held;
  false blocks ≤ 10 % on clean public packets; agreement ≥ 95 % on verdicts
  between the two pinned settings; non-complete passes (timeout, length cut,
  malformed, counted together and reported by cause) ≤ 2 % and none on a
  packet with eight or fewer gold findings; a `complete` pass with a budget
  warning (§3.4) is reported as a rate and is not a non-complete pass, so a
  pass that was slow inside the margin does not demote the checker. Failing, the checker is demoted to
  span proposer, its verdict is not shown, and **S-B does not open, or
  reverts to S-A, for every family except those the owner names in a recorded
  decision as structure-only** (`schema_review` and `plan_review` purposes in
  the families the owner lists); the demotion is written into the stage row's
  `families`, `purposes` (`["schema_review", "plan_review"]`) and `demotion`
  fields (§4.7), which is what `eligible()` reads.
  r1's "closed for contexts whose risk is whole-context sensitivity" named no
  class the stage could carry.
- **F5 Layer attribution.** On the registry-withheld configuration, over the
  withheld gold subset, with verbatim-copied spans excluded from the checker's
  share, a layer without measurable marginal recall on development (≥ 2
  percentage points or ≥ 1 mandatory canary or proposition no other layer
  caught) is removed; the identity changes; a sealed pass follows. The same
  rule admits a union member (Q18).
- **F6 In use.** Any tracer hit, incident-class response-echo detection
  (including an exact cross-job digest hit on a value not in this job's
  registry, screened before restoration, §3.8), or owner-found mandatory
  miss on a real packet: incident switch (P15), a `Failed` entry, revert to
  S-A by writing the stage row (`level: "S-A"`, the `Failed` entry cited),
  which refuses the next commit of every job whose snapshot still says
  `S-B`, re-approval required. Review-class echo flags are shown and logged;
  two in any ten real packets, or two owner-found advisory misses in any ten,
  trigger a red-team round and a new version before further S-B packets.
- **F7 Automatic use.** No rule opens S-C. A per-packet miss bound below the
  owner's tolerance for PHI or privilege would need thousands of
  in-distribution sealed packets with zero misses, which cannot be authored
  without real data, which cannot be used without the disclosure the filter
  exists to prevent; and the packet stays personal data regardless. S-C is
  defined and declared unreachable under this evidence model.

These are investment decisions on small samples in the plan's R-rule sense.
Disagreements between agent graders and the owner are logged and never
resolved in the agent's favour.

### 8.7 Stages

| Stage | Permits | Entry evidence |
| --- | --- | --- |
| **S-A advisory** | **Synthetic or public contexts only.** The pipeline runs on labelled-shaped synthetic jobs and on the owner's own `public`-labelled packets, each with a manifest whose `labels.level` is `public` and whose `stage` is `S-A` so the exact-bytes binding, tracer and receipt fields apply to them as to any other (§4.1), and shows the owner the diff, flags and residual-risk list; nothing is sent without exact-byte approval (unchanged); **no packet from a non-synthetic context labelled `personal` or above leaves**, and `eligible()` enforces that through the install-level stage row (absent or `S-A`, §4.7) regardless of any grant; the owner is told the filter is advisory and unconfirmed. The first draft's wording ("every outbound packet from a labelled context") withheld only confidence, not permission, and would have relaxed D15 by citation. | The September sealed set run once; the v2 development suites authored and scored once; completion 100 % and p95 within budget on 64 KiB packets; offset tests green; fail-closed and stage-refusal tests green; tracer and echo scan built and tested on synthetic; `Proposed` and `Approved` entries. About one owner hour. |
| **S-B owner-approved packets, labelled contexts without a regime tag, per language class** | D15 as revised: the owner may approve one packet per task through the surface in §5 from a labelled context without a regime tag, in the language classes, families and purposes for which F2 and F4 passed with the registry withheld, per family × language cell (§8.2 item 9) under the product rule of §4.7 (English first; zh and mixed stay at S-A until then); after the S-B `Approved` entry is committed, the owner writes the install-level stage row through the stage surface, citing that entry's id and hash (§4.7); nothing else can write it, a job created before or after snapshots it, and `eligible()` re-reads it at every commit; the filter is now a control the owner relies on. | F0-F5 pass on the v2 sealed set in the withheld configuration over the withheld gold subset; two red-team rounds closed; utility study within F3; tracer baseline done; disclosure report and incident switch drilled once on a synthetic job, the drill including the F6 revert of the stage row and the refused commit that follows it; Q15 provider facts verified; the D20(b) row recorded for any `coding` use; an `Approved` entry naming the filter identity, the language classes, the families with their cells and the purposes. About six to eight owner hours once, then three to five minutes per packet. |
| **S-B-regime** (not opened here) | Packets from a regime-tagged context, per tag. | An explicit, recorded owner rule change per tag; S-B plus the relevant profession suite at S-B thresholds plus a regime-specific red-team round plus the §7.2 preconditions. This design measures; it does not open. |
| **S-C automatic** | Any packet leaving without per-packet approval. | Unreachable under F7. |

### 8.8 Red-team rounds and continuous canaries

A session that has not seen the current version's development results writes
at least 30 adversarial packets per round, gold by construction, targeting
format evasion, transformed identifiers, semantic identification without
identifiers, injection at the checker (including injections that aim at the
reveal and usefulness channels) and at the cloud, **injection at the registry
harvest** (a document that tells the harvester to omit names, to rename them,
or to flood the schema with decoys so real entries fall past the cap,
including a document that keeps a leaf sub-chunk reporting `more: true`
(§3.2); r1 measured harvest recall on clean documents only, and OPF and rules over the
raw inputs bound the loss without measuring it), regime-indicative
identifiers in untagged contexts, and structural leaks. Harvest recall on the
injected subset is reported under F0 beside the clean figure. One round per version
against the frozen version; misses become new registry categories for the
next development set; the owner reads the miss summary (30 minutes) and once
describes, in data classes only, what their files contain (15 minutes).
Cadence: one round before each sealed pass and one per quarter in use.

In use, three free host-side detections: the tracer (verified by
recomputation from the manifest id on the receipt), the tiered response-echo
scan (an unsent registry value of this job in the raw reply, or an exact
cross-job digest hit, both screened before restoration; the tracer itself is
expected and recorded), and the owner-found miss (a
mandatory-class value the owner sees in the diff, recorded as a filter miss
even if the packet is then declined). A silent tracer proves nothing about
retention or training; a hit does not identify the actor; neither detects a
leak of meaning.

## 9. Cost and latency budgets

### 9.1 Latency and memory, per 64 KiB packet

| Layer | Where | Memory | Typical / budget | Basis |
| --- | --- | --- | --- | --- |
| L1 rules, registry, provenance diff | Mac main process | negligible; n-gram index proportional to input bytes | < 100 ms / 2 s | regex and string search over 64 KiB; registry ≤ 5,000 entries |
| L2 OPF | Mac child process, CPU BF16 | 3.83 GiB peak RSS measured; 2.8 GB model file | **unmeasured on packet-sized input**; linear estimate from the 390-byte median (0.37 s) is of order 60 s median for three 7,000-token chunks / 90 s | September figures were for 390-byte snippets and the first draft's "1-12 s" assumed a chunk costs what a snippet costs; R3 measures it and the measured p95 is the S-A entry condition |
| L3 checker, two concurrent passes | Thor via broker | a request, not a resident | prefill of about 17-24k tokens (packet plus the capped registry portion) at about 1,790 tokens/s ≈ 10-14 s; output at the **schema maximum**: ≈ 1,050 tokens in English (≈ 130 s at 8 tokens/s) and ≈ 2,600 tokens in CJK (≈ 325 s at 8 tokens/s; 75 s at 35), computed in §3.4; the passes run concurrently, so wall time is one pass → typically 1-3 min; **L3 timeout 450 s wall at the planning floor**, derived as (CJK schema maximum / p5 + prefill) × 1.25 with p5 the per-stream rate R4 measures under two concurrent passes with `responseFormat`, never below 450 s, written into the freeze; the `thor_filter` destination's `timeoutMs` is 720 s (§3.4); a pass that reaches the L3 timeout is a non-complete pass (block, no override, counted under F4); a pass past the no-margin figure is `complete` with a budget warning | serving card 2026-09-28 (P3, line 29, and P7, line 34: 35 tokens/s per stream under speculative decoding, which D11 leaves unpinned; lines 41-43: 8-18 tokens/s is a community estimate for plain FP8, not a measurement); the design commits to 8 tokens/s as the planning floor until R4 measures p5. r1's row ("≤ 1,500 tokens at 8 tokens/s ≈ 3 min / 180 s") exceeded its own budget (1,500/8 = 187.5 s before prefill) and assumed an English worst case; r2 budgets at 8 tokens/s and shrinks the schema (the more restrictive of the two options offered) rather than pinning speculative decoding into the serving identity, but its 360 s left a 6 % margin over its own 339 s worst case and sat on the `standard` destination's 300 s transport timeout (`profiles.ts:36`, `broker.ts:464`), which would have cut the pass first; r3 adds the margin and the destination |
| L4 structural | Mac | negligible | < 200 ms / 2 s | string search over map and registry; transforms |
| L5 owner | human | | 3-5 min measured target; 15-20 for a full 64 KiB read | D9 pattern |
| L6 wire gate | Mac | negligible | < 100 ms | |
| Registry build (once per job, on the first cloud action, outside the per-packet budget) | Mac + Thor | OPF over raw inputs on the Mac; the 27B harvest in ≤ 50k-input-token streaming chunks with a 4,096-token output cap and `more: true` continuations | per MiB of English (≈ 250k tokens): OPF about 1-3 min; 27B prefill ≈ 2.5 min spread over about five chunks; 27B output proportional to entries, 50k tokens for 5,000 entries ≈ 25 min at 35 tokens/s and ≈ 1.7 h at 8 tokens/s, in calls of at most ≈ 9 min each (≈ 512 s of decode plus ≈ 28 s of prefill) at 8 tokens/s on the `thor_filter` destination, whose `timeoutMs` is 720 s and whose body cap is 640 KiB (§3.4), so no call reaches the transport timeout or the remote's 947 s cut, with sub-chunk continuation rather than reported offsets (§3.2); the brief and the job instructions are among the inputs; at the 4 MiB bound the harvest is tens of minutes to about two hours, shown as progress, and the first packet waits for it; a cut, malformed or flooded call, or the entry cap, marks the registry `partial` and holds the first packet (§3.2) | serving card rates (P8, line 35, for the 947 s cut); D11 unpinned; `broker.ts:16` for the 900 s destination ceiling, `profiles.ts:36-37` for the 300 s `standard` and 900 s `heavy` timeouts, `src/main/config.ts:74` for the 300 s default of `SOAR_REQUEST_TIMEOUT_MS`; r2 cited `config.ts:74` and `profiles.ts:37` for a "900 s ceiling" that no admitted destination declared, and its 50k-token chunks did not fit the 192 KiB body cap it inherited; the first draft counted only the OPF part and ran the harvest at every job start; r1's 200k-token chunks produced single calls that could not complete at 8 tokens/s |

Composed per-packet budget, with **CJK as the worst case** at the pinned 8
tokens/s: p95 ≤ 9 min for a 16 KiB packet (2 + 30 + 450 + 2 s = 484 s, OPF
at one chunk) and ≤ 10 min for 64 KiB (2 + 90 + 450 + 2 s = 544 s), stated and
read as composed p95 on the machine that runs each layer (F0) and restated in
the freeze when R4's derived L3 timeout differs from the 450 s floor; the
per-layer figures are estimates until R3 and R4. The first draft's arithmetic
(two sequential 180 s passes inside a 300 s budget) did not add up, which the
concurrent passes fixed; r1's 274 s then rested on an L3 row that exceeded
its own 180 s budget at 8 tokens/s and on an English-only output estimate,
which the schema resizing and the derived timeout fix; r2's 394 and 454 s
used a 360 s timeout with a 6 % margin, which r3 widens (§3.4). If the owner later
pins speculative decoding into the serving identity (D11), the same packets
run in about a third of the time and the budget may be restated in a new
freeze; until then the slower figure is the one the design holds itself to.
The registry build is outside the per-packet budget and
runs once per job. The pipeline runs once per cloud packet on an owner action;
it is not on the per-turn path; the owner's order is privacy ≥ quality >
savings > latency. Mac headroom: 32 GiB total; Electron plus the OPF worker
under 6 GiB; the 12 GiB September kill limit kept. Thor: 122.9 GiB; the 27B FP8
and its KV cache already live there.

### 9.2 Owner time

| Activity | When | Minutes |
| --- | --- | --- |
| Read and decide this design (§12) | before anything | 30 |
| Describe, in data classes only, what their files contain | once | 15 |
| Answer D20(b) on private source code and record it in the stage surface with the entry reference | before any `coding` use | 5 |
| Write the stage row in the stage surface after the S-B entry (and after any revert) | S-B | 5 |
| Sign off the September sealed run and the S-A entry | S-A | 20 |
| Approve one synthetic packet through the real surface (first trial, §10.2) | S-A | 15 |
| Spot-check 4 of 48 utility critiques | before S-B | 40 |
| Read two red-team miss summaries | before S-B | 60 |
| Incident drill on a synthetic job; tracer baseline review | before S-B | 30 |
| Adjudicate the proposition judge's audited sample (≥ 60 propositions, survive/absent, with the packet text, §8.2 item 4) | before each sealed pass | 60 per sealed version |
| Sealed result sign-off and the S-B entry | S-B | 20 |
| Per packet in S-B | each | 3-5, recorded |
| Weekly alert review (incident and review-class flags) | in use | 10 |

About five hours once (one of them repeated per sealed version), then minutes
per packet; r2's four omitted the adjudication hour.

### 9.3 Money

| Item | Cap | Bucket |
| --- | --- | --- |
| First synthetic trial: seven H critiques on placeholdered repair packets (six Phase 2 drafts plus one planted document-review draft, §10.2) | ≤ USD 7 (CRITIC_MAX_FEE_USD 1 each) | new |
| Utility study: 48 critiques × ≤ USD 0.80 (four arms, the raw-packet arm added) | ≤ USD 40 | new |
| Tracer baseline: five synthetic packets | ≤ USD 2 | new |
| Hard synthetic documents from `gpt-6-sol`, no owner seed; at least ten per language so the cloud-authored subset is reportable (§8.2 item 2) | within the existing USD 20 synthetic bucket, or restated here if it does not fit | existing |
| Per real packet in S-B | fee cap shown at approval; proposed USD 1 default | owner decision |
| Proposition judge: the local 27B under the judge prompt, about 120 packets × 2 configurations × 3-5 propositions per sealed pass, plus the development split | zero fee; local only; no cloud judge | existing (Thor) |
| GPU | zero fee; up to about 12 device-hours per checker evaluation pass per registry configuration at the pinned 8 tokens/s (about 4 at the unpinned 35), plus the judge (360-600 calls per configuration at 3-5 propositions per packet, of order 3-5 h at 8 tokens/s over both configurations, inside the Thor-stage deadline of §8.5); the harvest per synthetic job; development iterations | |

A new allocation of ≤ USD 49 inside the USD 300 envelope (USD 38 in the first
draft; the raw-packet arm and the seventh trial draft add USD 11) needs its
own `Approved` entry before the first call. Envelope used so far: about
USD 21.

### 9.4 Agent time

Contracts and chain, including the install-level stage and D20(b) rows with
their surface, the parent-chain check inside `eligible()`, the `sampling`
field with `seed` and the `responseFormat` option on the request builder, the
`filter` profile and `thor_filter` destination with their two tests, and
the consultation proposal migration, 3-4 days; builder, templates with
locators, language class by presence, L1 with the output-bounded harvest
over files, brief and instructions and sub-chunk continuation, L4 with the
anchor check, the reveal exemption and the cross-job query, map, diff view
with the rerun chain, 3-4 days; OPF worker and the sealed re-run, 1 day;
checker prompt, schema v3, quote bridge, the measured-rate timeout and the
budget warning, 1 day; proposition judge prompt, the ≥ 60-proposition
audited-sample tooling and the agreement measurement, 1 day; corpus registry,
generator with placement constraints for values and propositions and the
family × language minimum, harvest-injection documents with the flood case,
packets and gold, 2-3 days; tracer, pre-restoration tiered echo scan,
cross-job digest set (reply and L4) and two-mode wire gate, 1-2 days;
red-team rounds, half a day each.
Nothing above runs real private data; Phase 3 and 4 in their local-only form
are unaffected.

## 10. Staged rollout

Each step is `Proposed`. Each exit gate states what its test proves and what it
does not. R1-R5 run on synthetic material only and need no owner decision
beyond the new allocation; R6 needs the D15 revision and D20(b).

| Step | Work | Exit gate (proves) | Does not prove |
| --- | --- | --- | --- |
| **R0 Close the September loop** | Move the trial tree off iCloud; re-freeze with matching hashes; decoy smoke; run the 60-case sealed set once with the frozen OPF-only selection | A complete sealed record exists and the protocol works; per-language and per-class numbers disclosed | Anything about v2; a zero-leak claim |
| **R1 Contracts and chain** | P1 label lattice and regime tags on contexts; the install-level D20(b) row and stage row (`{level, languageClasses, families, purposes, approvedEntryId, approvedEntrySha256, approvedEntryLength, setAt, demotion?}`) with the stage surface, which takes the entry text and computes the hash, as their only writer, snapshotted into policies and manifests; `parentJobId`/`parentContextId` on `cloud_help` sub-jobs with the store's refusal rules, the derived-source label join and the `sourceClasses` join; the `filter` coordinator profile and the `thor_filter` admitted destination (§3.4); `grantFreeSynthetic` refused in the desktop profile; `prevSha256` on events and receipts with a verifier; `consultation_proposed` migrated to hashes with `packetText` in the encrypted proposal store, a migration note and a CI bound on event row size; the `sampling` field (`temperature`, `top_p`, `top_k`, `seed`) and the `responseFormat: {type: "json_schema", schema}` option on the request builder, with the structured-output mode and vLLM version in the checker identity; manifest (with `supersedesManifestId`, `priorBlock`, `languageClassEvidence`, `codeDecision`, `registryPartial`, `labels.level: public`), span, map, registry (with `failedChunks`) and checker (v3) schemas; `ScanResult` and `DispatchReceipt.scan` extensions (`manifestSha256`, `manifestId`, `mode`); `eligible()` denies cloud for regime-tagged contexts, for family `coding` or parent source-code classes while the D20(b) row is absent, for non-synthetic restricted contexts whose install-row stage is not `S-B` for the class, family and purpose, resolves the manifest through the grant and reads the parent's sources, and re-checks the parent chain inside itself on every commit | Unit tests on synthetic data: a regime-tagged context cannot produce a packet or a grant; the `thor_filter` destination's `timeoutMs` is not below the derived L3 timeout or the harvest's per-call bound, and a 50k-token harvest chunk body fits its `maxRequestBytes`; a packet whose purpose is outside the row's `purposes` is refused at commit; a script path that creates a sub-context with a `.txt` derived source over a parent with a `.ts` source is refused while the D20(b) row is absent; a `coding` packet from a non-synthetic context, and a `general` packet whose context has a source-code source, cannot produce a manifest or a grant while the D20(b) row is unrecorded; a non-synthetic restricted context cannot pass `eligible()` while the stage row is absent or `S-A`; the stage surface refuses an entry id without the entry text and stores the hash and length of the text it was given; a job created under `S-B` is refused at its next commit after a revert to `S-A`; a request with no `validateAtCommit` callback is still refused when the parent carries a tag; a sub-job whose parent carries a tag or lacks the stage cannot be created, and a sub-context cannot be `synthetic` over a non-synthetic parent; the request builder sends `seed` and `response_format` on the wire; a tampered event breaks the chain; no event row carries packet text | Any detection quality |
| **R2 Builder, L1, L4, map, surface, wire gate, and the first synthetic trial** | Templates `repair_critique` (with the document-review rule and clause locators) and `code_review` (`-U0`, removed-line locators); language class by CJK presence; L1 with rules v2, `regime_suggestive` stops with regime-statement reason codes and the per-context decision for the two no-override tags, the lazily built output-bounded registry over files, brief and instructions with sub-chunk continuation and the `partial` hold, and the provenance diff over the input index; L4 with the relative-date anchor check, the reveal exemption and the cross-job digest query; the pre-restoration tiered reply screen; map store with random codes; `OutboundProposal` from the consultation state machine; diff view with the per-tag checklist, the split basis field and the scoped override; composite wire gate in both modes with a test for each; the trial in §10.2 | The packet that leaves equals the approved bytes (hash and packet capture on the Mac, P12 pattern); originals-absent holds on seven real-sized packets; a planted regime-indicative identifier stops L1; a revealed registry `person` value is still blocked at L4 and at L6; a reply that restores to contain the owner's own name does not trip the incident switch and a raw reply carrying an unsent registry value does; the rules-only mode never serves a `requireExactGrant` destination; per-layer latency measured; a utility signal on n = 7 | Detection quality (no gold yet); real-data safety; OPF or checker quality |
| **R3 OPF worker** | Persistent sandboxed worker on `adapter.py`'s protocol; chunking by token count; idle unload; p95 on 64 KiB packets measured and the "linear estimate" in §9.1 replaced by a number; the per-packet p95 over the development corpus's packet sizes that sets the sealed Mac-stage deadline recorded (§8.5) | The worker completes the development corpus under the limits; 64 KiB latency known; the Mac-stage deadline is a measured figure | A production prevalence estimate |
| **R4 Checker** | Prompt v1 and schema v3 (eight findings, quote ≤ 200, reason ≤ 150); structured output on vLLM 0.30.0 (the version the endpoint reports, BUILD_LOG line 17825; r2 wrote 0.28, the version recorded before the 2026-10 probe; the identity carries whatever the frozen server reports) through `responseFormat`, with pinned sampling and `seed` sent explicitly; concurrent passes on the `thor_filter` destination; the per-stream p5 decode rate measured under two concurrent passes with `responseFormat` on the frozen server and the L3 timeout derived from it with the 25 % margin and the 450 s floor; residual-versus-original and thinking-mode chosen on development; the proposition judge prompt and its agreement with the owner on the ≥ 60-proposition audited sample, held out of prompt iteration; evaluation on the development split's whole-context propositions plus planted injections, including injections aimed at the reveal and usefulness channels; non-complete and budget-warning rates by cause and Thor latency measured, the checker's per-packet p95 and the judge's per-call p95 that set the sealed Thor-stage deadline recorded; registry-prompt cap exercised | The checker flags the whole-context propositions OPF structurally cannot, blocks none of the clean public cases, no planted injection changes a verdict upward or produces an accepted reveal on development, no pass is non-complete on an eight-finding packet (a budget warning is reported, not counted), and the judge's agreement with the owner has a Wilson lower bound ≥ 0.80 on at least 60 adjudicated propositions | That the 27B is a reliable judge in general |
| **R5 Corpus v2, red team, sealed pass, utility study** | Registry with propositions, generator with placement constraints for values and propositions and the family × language minimum (§8.2 item 9), harvest-injection documents including the flood case, the cloud-authored hard subset sized to report, packets, gold, splits; harvest recall per origin on clean, injected and cloud-authored documents; two red-team rounds; the utility study with four arms (needs the allocation); one sealed pass with the composed identity in both registry configurations, scored over the withheld gold subset with the harvest-missed values among the withheld, inside the per-stage deadlines; F0-F5 applied with judged survivals overturned only by the owner; S-A entry, then S-B entry per language class, family and purpose from the cells that passed, or stay with the failing categories named | Whatever F0-F5 say, on synthetic packets, in both configurations, with rule-of-three bounds stated | Real-data safety; anything about regime-tagged contexts; anything about a language class or family × language cell that did not pass |
| **R6 Owner gate (S-B)** | The D15 revision recorded; D20(b) answered and its row written in the stage surface; Q15 provider facts verified; incident drill including the stage-row revert; the S-B entry committed and the stage row written by the owner citing it; first real use, English only, in whichever family the owner's D20 answers leave eligible: `coding` first (most structurally minimisable, least third-party data) only if the D20(b) row says `not_tagged`, otherwise `research_framing` on the owner's own non-regime material first, `admin` last (most injection-exposed, most third-party data); `repair_critique` on real tasks only if the repair pair shows H beating L′ by ≥ 2 | The first real packets recorded with manifests and disclosure reports; owner minutes measured | Nothing beyond those uses |

R0 and R1 can start now. R2's templates other than `repair_critique` do not
depend on the repair pair's result, which is still running (BL-20261019-0432).
The first draft named `coding` first unconditionally; under the restrictive
default for D20(b) it is not first until the owner says so, and under r2 the
builder refuses it (and any context with source-code sources) with the tag
code until the D20(b) row exists, so "until the owner says so" is a store
state, not a form default.

### 10.2 The first synthetic trial

Name: `pf2-trial-1`. Inputs: the six failed L-Heavy drafts selected for the
repair pair on 2026-10-13 (BL-20261013-1640), all synthetic or public, whose
raw-packet H critiques already exist or are being produced, **plus one
synthetic document-review draft with planted parties**, because of the six only
a1, a2 and w1 carry synthetic persons, d1 (the one the document-review rule
applies to) is a public CC-BY PSA template, and c1 and r2 are a task-written
MIT repository and public RFCs, so on three of six the placeholder density and
copied-bytes share would be near zero and the document-review rule would be
exercised on a packet with nothing to protect.

1. For each draft, build the `repair_critique` packet with template v1 (the
   document-review rule and clause locators apply to d1 and to the planted
   draft), run L1 and L4 (and L2 and L3 where R3 and R4 have landed; otherwise
   the trial records them as absent and the composed identity says so), and
   freeze the manifest.
2. Headless: dispatch each placeholdered packet to the cloud through
   `runCritique`'s synthetic `cloud_help` sub-job (the grant-free synthetic
   destination, which exists only in the headless script and is refused in the
   desktop profile, §3.7; fee cap USD 1), with packet capture on the Mac's
   uplink during the run; reconcile every connection to the ledger.
3. Desktop: take one of the seven through the real approval surface with the
   owner clicking approve on synthetic data, so the diff view, the per-tag
   checklist, the split basis field and the one-use grant are exercised end to
   end (about 15 owner minutes).
4. Measure: captured bytes equal the approved bytes (hash); originals-absent on
   the captured bytes; placeholder density, copied-bytes share and locators
   substituted per packet; per-layer latency on real-sized packets; defects
   found by the critique on the placeholdered packet versus the raw-packet
   critique for the same draft (overlap, and defects referenced through
   placeholders in a way a repair could not act on); the local repair outcome
   where time allows.
5. Record a build-log entry with the numbers, the identities and the
   non-claims. Cost ≤ USD 7. No real private data.

What it proves: the mechanics, the latency on real-sized packets, and a first
utility signal. What it does not prove: detection quality (there is no gold on
these packets beyond the planted parties of the seventh draft), and anything
about real data.

## 11. What this design does not promise

- **That a packet is anonymous, de-identified, PHI-free or
  privilege-preserving.** It is derived material about one case, pseudonymised,
  and personal data in law (§1.4, §7.1).
- **That quasi-identifiers, document structure, writing style, small-n
  aggregates or the confidential substance itself do not identify the person,
  matter or institution.** No layer sees a table shape as a fingerprint or a
  settlement figure as the secret; the generalisation transforms narrow this
  for the shapes they know and the checker is unmeasured on the rest; for
  n = 1 there is no k-anonymity to reach.
- **That a series of packets cannot be linked.** Per-packet random codes and
  the per-job budget narrow it; the provider can still reconstruct a matter
  from a series of packets about it. The disclosure report lists them so the
  owner can judge accumulation; it does not prevent it.
- **That an injected instruction did not shape what the agent wrote into the
  draft that became the packet, or that the checker's silence means anything.**
  The provenance diff and the caps bound the crude version; the acrostic is not
  caught; checker free text is shown as untrusted because it can be steered.
- **Completeness in Chinese or mixed text.** The sealed split never ran; OPF's
  independent zh person score is 0.138; the checker's advantage here is
  unmeasured. Until the v2 sealed pass, every Chinese number is a
  development-split number, and S-B does not open for zh or mixed contexts
  until F2 passes there with the registry withheld.
- **That the numbers transfer.** Every detector figure is from 60 synthetic
  snippets on the development split; v2's will be from 120 synthetic packets
  per split. Zero misses on 120 packets bounds the per-packet miss rate at
  about 2.5 % at 95 %, says nothing about prevalence in the owner's real files,
  and is not a zero-leak claim. A registry-on result says nothing about names
  the harvest missed; the withheld configuration, read over the withheld gold
  subset, is the one to read; the composed estimate (1 − harvest recall)
  × (1 − withheld recall) approximates a real unregistered name's chance of
  passing only under an independence assumption that does not hold, because
  the harvest is the same 27B as the checker and the raw scan is the same
  OPF as L2, so the figure to cite is the one bounded by recall on the
  harvest-missed subset (§8.2 item 8), and it is an estimate, not a bound on
  the owner's files.
- **That the proposition judge, the harvester or the synthetic-document
  generator is independent of the checker.** All four are the same 27B under
  different prompts: the judge's agreement with the owner is measured on a
  ≥ 60-proposition audited sample held out of prompt iteration, and only the
  owner overturns a judged survival; but a blind spot the prompts share is
  not measured by that figure, a name the harvester cannot list is
  correlated with one the checker does not flag, and a paraphrase habit
  shared by the generator and the checker is invisible to every number in
  §8.3 except those reported on the `gpt-6-sol`-authored subset (§8.2
  item 2).
- **That an unregistered, unformatted, non-PII confidential fact the checker
  also misses is caught.** The originals-absent invariant covers known values
  only. The residual is the owner reading the diff.
- **That an untagged regime matter is always stopped.** The
  `regime_suggestive` families and the per-tag checklist catch the shapes and
  the families they know; a privileged matter with no docket number and an
  owner who answers "does not apply" five times is not caught by any layer.
  The reason codes are statements about the regime, and a false statement is
  recorded, not detected.
- **That a relative-date packet cannot be dated.** The L4 anchor check finds
  absolute dates and dated citations it can recognise; a date implied by an
  event ("the quarter the merger closed") is not an anchor it sees.
- **That the 27B is a reliable checker.** It is unmeasured in this role, it is
  the model whose task results were weaker than the cloud's, and its injection
  resistance is unknown; the design limits the damage rather than relying on it.
- **That over-redaction, or the template itself, does not cost quality.** The
  utility study measures both; until then the value of a cloud critique on a
  placeholdered packet is unknown, and the Phase 2 result that motivates this
  design was measured on unfiltered raw packets, which the templates no longer
  send.
- **That the Thor is a verified boundary.** The checker adds no recipient the
  job does not already have, but the hardening list is open and Tier O stays
  gated on it; nothing here relaxes that.
- **That the latency estimates hold.** OPF on 64 KiB and the checker on the
  Thor are estimates until R3 and R4; the L3 timeout is derived from a rate
  R4 measures, with a 450 s floor at 8 tokens/s, and a server that falls
  below the measured p5 turns checker passes into non-complete blocks; the
  registry harvest on a 4 MiB job may take hours.
- **That the record answers after the key is lost.** Maps, registries,
  proposal texts and packet copies are readable only while the install's
  Keychain key exists, or the D27 recovery secret if the owner elected one.
- **Anything about the provider's conduct**: retention, abuse-monitoring human
  review, subprocessors, regions, legal process, training. Q15 records what the
  owner believed at dispatch; it does not verify the provider.
- **That automatic cloud use will ever be reachable** (F7).
- **That this design serves most Tier-O work.** Under the constraints as they
  stand it serves labelled contexts without a regime tag, and under the
  restrictive default for D20(b) not the owner's private code either. The
  per-tag question is the owner's (§12).

## 12. Owner decisions this design needs

Defaults apply only to planning. They never authorise live, paid, private or
publication actions.

| ID | Decision | Default if silent |
| --- | --- | --- |
| **D15-rev** | **Revision of D15.** D15 as answered: never automatic; the owner may approve cloud help for one specific task after a bad local result, through exact-packet approval, with a consent reminder for third parties' data; not planned during development. Proposed revision: (a) "cloud help" means one of the templates in §1.2, never a placeholder rendering of a whole file, and never verbatim third-party text; (b) the trigger is an owner action in a labelled job, either only after a local result the owner judged insufficient (as answered) or at any point the owner chooses; (c) the consent reminder becomes the recorded form in §5.2 with the five-row per-tag checklist and the separate legal basis; (d) one packet per task and at most two per labelled job by default, no packet on a job linked to another labelled job; (e) a `local_checker` block may be overridden with a reason code only when its pass is `complete` and it carries no located quote or is of kind `injection_attempt`; a block with a located `confidential_fact` or `reidentification` quote, a block from any non-complete pass (timeout, length cut, malformed or empty), a `rules` block or a `structural` block never; an edit-and-rerun after a quoted block records its lineage in the next manifest; (f) it is now planned, through the stages in §8.7, with S-B as the first real use, per language class, family and purpose, and S-A confined to synthetic and public material by one install-level stage row that only the owner writes in a surface requiring the entry reference, and that `eligible()` re-reads at every commit. | The design proceeds through R0-R5 on synthetic material; R6 waits. If silent on (b), "after an insufficient local result" stands. |
| **D20** | **Per-tag regime rule.** (a) Keep "never" for all five tags, or name tags for which an S-B-regime path may be built with the §7.2 preconditions. The product has no override path for `controlled_access_genomic` or `export_controlled_or_unpublished_ip` regardless. The most plausible first candidate is the owner's own unpublished manuscripts, where the owner is the rights holder; `health_phi` is the least plausible, because third parties' rights dominate. (b) Whether the owner's private source code (not public, not authored for release) carries `export_controlled_or_unpublished_ip`; P1 does not define it today, and R6's family order depends on it. The answer is recorded as one install-level row carrying the recording entry's id and hash (§4.7), written in the stage surface; until the row exists the builder refuses family `coding` and any non-synthetic context with source-code sources with the tag code, and `eligible()` re-reads the row at commit. (c) For a `regime_suggestive` stop on either no-override tag, whether a per-context decision (§3.2) may ever be recorded, with that tag's own reason codes (§4.1), or whether re-labelling is the only exit. | (a) Never, for all five. The suites measure anyway. (b) Treated as tagged as a store state: no row, no `coding` packet, no packet from a context with source-code sources; the more restrictive reading. (c) Per-context decisions are allowed only with a regime-statement reason code and are listed in every disclosure report; if the owner prefers, re-labelling only. |
| **D14 (completion)** | Jurisdictions and professional registrations, so the form's basis list and the §7 frame can be checked by counsel. | The frame stays generic; the form's basis list is used as written. |
| **D21** | **Provider account posture.** Whether the account in use carries zero data retention, a BAA and a DPA, or whether a separate account for labelled packets is wanted; verification of the three Q15 facts against the provider's current documents before the first labelled packet. | No labelled packet until verified. |
| **D22** | **Retention of labelled-job packet copies.** D16 says 30 days; professional file-retention and limitation periods are longer. The encrypted packet copy and reply follow the job's retention, owner-adjustable per labelled job. | 30 days. |
| **D23** | **The new allocation** of ≤ USD 49 (first trial ≤ 7, utility study ≤ 40 with the raw-packet arm, tracer baseline ≤ 2) inside the USD 300 envelope, and the per-packet fee cap for S-B (proposed USD 1). | Nothing paid runs. |
| **D24** | **Honeytoken domain.** Whether the owner wants URL tracers on a domain they control (discloses the domain to the provider and needs DNS logs). | Nonce tracer and response-echo scan only. |
| **D25** | **OPF placement and union detectors.** Mac first; move to the Thor only after the hardening list closes; any new detector weights (a Chinese-name model, GLiNER2-PII, an OPF fine-tune) provisioned only after an owner-approved asset pin. The Chinese-name model is the expected route to opening S-B for zh (F2). | Mac; OPF alone; S-B English-only. |
| **D26** | **Owner time.** About five hours once (§9.2), one of them the adjudication of the proposition judge's audited sample per sealed version, including the 15-minute data-class description, which is the only legitimate bridge between synthetic suites and the owner's real files. | The suites are authored from the professions' public document types without that bridge, and say so. |
| **D27** | **Key recovery.** Whether the owner wants an owner-held recovery secret (a passphrase-wrapped copy of the per-install Keychain key, stored off-device by the owner) so that maps, registries, proposal texts and packet copies stay readable after a lost Mac or a wiped Keychain, or accepts that the record answers only while the install's key exists (§6, §7.3). | None: one key, no second copy; the deletion residual report and Q13 state the limit. |

## 13. Sources consulted

Lens analyses (2026-10-19, scratchpad): `architecture.md`, `adversary.md`,
`evaluation.md`, `landscape.md`; the adversarial refutation of the first draft
(2026-10-19, twenty findings, applied in revision r1; `changelog.r1.md`); the
second refutation, of r1 (2026-10-19, nineteen findings, applied in revision
r2; `changelog.r2.md`); the third refutation, of r2 (2026-10-19, sixteen
findings, applied in revision r3; `changelog.r3.md`).

Repository (read-only, `main` of 2026-10-19):
`docs/plans/PRIVATE_WORK_DESIGN_V1.md` (§1 the rule and the pseudonymisation
statement, §2 P1-P17, §4 the edit plan shape, §6 what SOAR must not claim);
`docs/PLAN.md` (Phase 2 rules R0-R5 and Branch B, "cloud help that respects the
owner's rule", D4, D9, D11, D14, D15, D16, the envelope);
`docs/PRIVACY_FILTER_RESEARCH.md`; `docs/BUILD_LOG.md` entries
BL-20261007-1451, BL-20261007-1529, BL-20261008-1211, BL-20261008-1312,
BL-20261013-1640, BL-20261019-0432, and line 17825 for the endpoint's vLLM
0.30.0; `docs/experiments/serving-card-2026-09-28.md` (line 29 for P3's
35 tokens/s and line 30 for the 1,790 tokens/s prefill, line 34 for P7's two
concurrent streams, line 35 for P8's 947 s cut, lines 41-43 for the 8-18
tokens/s community estimate for plain FP8);
`src/main/private-agent/{scanner,broker,repair,consultation,contracts,store,model,profiles}.ts`
(`consultation.ts` lines 66-70 and 177 for the proposal event, line 218 for
the `validateAtCommit` it passes; `model.ts` line 101 for `streaming`, line
104 for `maxRequestBytes`, lines 105-106 for the sampling condition and
shape, and the absence of `seed` and any `response_format` field, lines
234-235 for the body check, lines 247-248 for its `broker.request()` call
with no `validateAtCommit`; `store.ts` line 105 for the per-job
`revisePolicy` and line 208 for the dispatch id at commit; `broker.ts` line
12 for the 192 KiB default body cap, line 14 for the 4 MiB destination body
ceiling, line 16 for `BROKER_MAX_TIMEOUT_MS` (900 s, the most a destination
may declare), lines 51, 58 and 60 for a destination's `timeoutMs`, `stream`
and `maxRequestBytes`, lines 247-248 and 260 for their validation, line 312
for `packet_size_exceeded`, line 347 for the optional `validateAtCommit`
argument, line 362 for the scan slot, line 379 for the commit closure, line
464 for the transport abort at the destination's own `timeoutMs` and line
515 for the inactivity clock; `contracts.ts` lines 16-27 for the per-job
policy (r2 wrote 19-27); `profiles.ts` line 36 for the `standard` profile
(thinking disabled, 4,096 output tokens, 300 s, 192 KiB) and lines 37-38 for
`heavy` (thinking medium, 16,384 output tokens, 900 s, 640 KiB); r2 cited
`config.ts:74` and `profiles.ts:36-37` for a "900 s request ceiling" that
only `heavy` and the broker constant carry);
`src/main/config.ts` line 74 (`SOAR_REQUEST_TIMEOUT_MS`, default 300_000,
maximum 900_000) and line 223 (its use for the review adapter's
destination); `src/main/general-tasks/controller.ts` lines 250-251 (the
coordinator profile owns the request timeout); `src/main/liveness.ts` line 8
(`STREAM_INACTIVITY_TIMEOUT_MS` 120 s) and lines 15-16
(`localStreamSettings`); `scripts/secret-patterns.mjs`;
`scripts/phase2-repair.ts` (`runCritique`, lines 80-81 for the sub-job
construction, line 83 for the `model.complete` call through which it reaches
`request()` without a callback, lines 104-105 for the headless script's
local destination built from the `heavy` profile with stream settings);
`src/renderer/src/GeneralTaskWorkspace.tsx`; `runtime/privacy-filter/README.md`
and `adapter.py`.

OPF trial (`.soar/privacy-filter/`, holds no real private data):
`evaluation/schema.md`, `operating-selection-v1.json`,
`development-aggregate-v1.json`, `confirmation-incomplete-v1.json`,
`manifest.json` (metadata only), `results/development-v2/runtime-summary.json`,
`provision/pins.json`.

External sources are those cited by the lenses: the fact-checked list of
2026-09-29 in the private work design, the OpenAI Privacy Filter model card and
repository, the independent and vendor evaluations listed in `landscape.md`
§7, and the legal sources listed in `adversary.md` §9, with the memory-sourced
items marked *verify* in §7 of this document. Added by r1 and not re-fetched:
HHS, *Guidance Regarding Methods for De-identification of Protected Health
Information* (2012), on re-identification codes and keyed hashes (*verify*;
cited only to say why the design does not rely on it).

## Appendix A. Open findings from the final refutation (resolve before approval)

The third refutation (2026-10-19) returned `needs_changes` with two medium and eight low findings. They are interactions between earlier fixes and arithmetic that did not follow a revision. None is a privacy leak the owner's exact-byte approval would not catch, and none is applied yet; each must be resolved, or declined with a reason, before this design can be `Approved`.

### A.1 (medium) The r3 reply screen's incident tier fires on values the r3 reveal exemption lets the owner send: §3.8 classes 'a checksummed identifier, an email, a phone, a secret, or a full multi-token name from this job's registry' in the raw reply as incident-class because 'none of which could have been sent, by L4's invariant', but §3.4/§3.5 now exempt from that invariant any registry entry of kind organisation, study, place, product or non-regime record_number that the owner reveals under a preserve class, so a cloud reply that echoes a revealed organisation name or a revealed non-regime record number trips the incident switch (P15: every destination revoked, sandboxes stopped) on an owner-sanctioned literal.

**Why:** Finding 7's fix (the exact reveal exemption) and finding 3's fix (the pre-restoration tiers) were written against each other without a joint rule: the tier's premise that a registry value in the reply 'could not have been sent' is false for exactly the logged reveal ids, and the R2 test added for finding 3 (the owner's own name does not trip the switch) does not cover it. The same sentence is also ambiguous about whether a rules-v2 hit that is not a map or registry value (an AWS example key or user@example.com in a code-review critique) is incident-class; read that way a routine critique trips the switch too.

**Fix:** In §3.8 define the this-job incident tier over (map ∪ registry) minus exactly the manifest's logged reveal ids, with an echo of a revealed value recorded as `revealedEchoes` in `outbound_restored.replyScreen` and shown as review-class; state that a rules-v2 hit in the reply is incident-class only when its normalised value is in the map or registry and review-class otherwise; add the R2 test that a reply echoing a revealed registry organisation value does not trip the switch while a reply carrying an unrevealed registry organisation value does.

### A.2 (medium) The `thor_filter` destination that §3.4, §3.2 and §9.1 now rest on cannot be constructed under the broker rules the design cites: it must be `privateDataAdmitted: true` (its scan status `not_required_inside_boundary` is the line-359 branch for that flag, and `eligible()` at broker.ts:339-340 denies a restricted context to any other local model), but `normalizeDestination` refuses a non-HTTPS endpoint unless it is a `loopbackFixture` or a `syntheticOnly` local model (broker.ts:250-251), `syntheticOnly` with `privateDataAdmitted` is `destination_trust_conflict` (broker.ts:268), the Thor endpoint is plain HTTP (serving card line 21) reached over an SSH local forward (PLAN.md 'Transport'), and the only admitted local destination today, `desktop_local`, passes the rule solely because it is `privateDataAdmitted: false, syntheticOnly: true` (controller.ts:508-509). The two R1 tests the design lists (timeout above the L3 bound, 50k-token body under the cap) test a destination the broker refuses at construction.

**Why:** Finding 1's fix moved the checker and the harvest onto a dedicated destination and cited broker.ts line by line for its limits (14, 16, 247-248, 260, 464) but not the TLS rule three lines below the validation it cites; an implementer meets `destination_tls_required` on the first run and the available shortcut, `loopbackFixture: true`, is a fixture allowance the broker comment says is 'never a general HTTP setting'. Every §3.4/§9.1 figure, the F0 latency budget and R1's exit gate are stated against a destination the design has not shown to be admissible.

**Fix:** State in §3.4 and R1 how `thor_filter` satisfies broker.ts:250-251: either TLS terminated inside the tunnel with a pinned certificate the transport verifies (today `rejectUnauthorized` is set only for the DNS and proxy routes, broker.ts:493), or a narrow broker rule admitting a `privateDataAdmitted` local model only on a loopback tunnel endpoint (never via `loopbackFixture`), with its own test; cite 250-251 and 268 in §13; add the R1 test that the declared `thor_filter` normalises and that `desktop_local` remains synthetic-only; and note that the `filter` profile must not join `CoordinatorProfileName` (config.ts:56 and general-task-contracts.ts:48 enumerate `standard | heavy`) so it cannot be selected as a coordinator.

### A.3 (low) A harvest chunk that overruns the 4,096-token output cap is `length_cut` and a terminal failure, not a continuation: §3.2 sub-chunks only on `more: true`, but a model under structured output cannot count its own tokens against the cap, so a dense chunk is cut mid-JSON rather than stopping early with `more: true`; the only exits are an undefined retry and the owner acknowledging `partial` with `harvest_failed_retried`, which is the fatigue path the design elsewhere treats as a leak. By the design's own rate (about 1,000 entries per 200k tokens) a dense 4 MiB job also lands on the 5,000-entry cap, so the maximum-size job is `partial` by construction.

**Why:** Finding 12's fix bounded `more: true` continuations but left `length_cut` (and `malformed`, which a cut JSON also produces) outside the sub-chunking rule in §3.2, §4.4 and §3.9 step 2.

**Fix:** Apply the same deterministic line-boundary halving on `length_cut` and `malformed` at depth < 4, recording a failure only for a leaf; state the expected entry density that sizes the 50k-token chunk and either lower the 4 MiB bound for dense inputs or raise the entry cap with the registry-prompt cap unchanged.

### A.4 (low) The harvest runs with no sampling pins and `harvestIdentity` is optional (§4.4), while harvest recall is the F0 metric 'every later number depends on'; at vLLM defaults (Qwen non-thinking temperature 0.7) a harvest, its retry after `harvest_failed_retried`, and the development and sealed harvests are different experiments, and the freeze cannot name what was measured.

**Why:** Finding 1's fix moved the harvest onto the checker's destination but did not give it the checker's pins (§3.4: temperature, top_p, seed sent explicitly and carried in the identity), which the second refutation required for the checker for the same reason.

**Fix:** Pin the harvest at temperature 0, top_p 1 and a fixed seed sent explicitly, make `harvestIdentity` required and part of the freeze (§8.5 item 2), and report harvest recall under that identity.

### A.5 (low) L4 item 3 re-runs the provenance diff over the final bytes with no exemption for logged reveals, so a revealed `citation` or `public_identifier` of 24 or more Latin characters (8 CJK) that also occurs in the owner's inputs is locator-substituted or counted toward the refusal share, undoing the reveal the exemption in §3.4 was written to permit.

**Why:** Finding 7's fix exempted reveals from the originals-absent set at L4 item 2 and L6 but not from the run-matching at L4 item 3 and §3.2 item 3.

**Fix:** Exempt the logged reveal spans from provenance run matching, bounded to the span's own extent and its preserve class, and report their bytes separately in `provenanceDiff` so the exemption cannot carry a longer passage.

### A.6 (low) The judge-agreement gate is unpassable after any judge-prompt change as sized: §8.2 item 4 requires at least 60 owner-adjudicated propositions with Wilson lower bound ≥ 0.80, holds that sample out of iteration, and scores 'a changed judge prompt on a fresh 10 % sample'; with at least 100 planted propositions per split, the 10 % sample is 10-ish propositions (lower bound about 0.72 even at 100 % observed), 60 held out leaves about 40 for iteration, and §9.2 budgets the owner's hour per sealed version, not per prompt version.

**Why:** Finding 5's fix raised the audited sample to 60 but kept r2's '10 %' language for the agent audit and for re-scoring, and did not size the development proposition pool to supply a fresh 60.

**Fix:** Define the audited set as ≥ 60 propositions per judge-prompt version drawn from a development pool sized for the expected number of prompt versions, state what remains for iteration, budget 60 owner minutes per prompt version in §9.2 and D26, and keep '10 %' only for the agent's unplanned-leak audit.

### A.7 (low) The 'harvest-missed subset' the composed estimate is now bounded by is defined on the wrong data: §8.2 item 8 withholds 'every planted value the registry build missed on the development split' in the sealed pass, but sealed jobs plant different values, so that set is empty or undefined on the sealed set; and withholding a harvest-missed value is a no-op, since it is absent from the registry by definition.

**Why:** Finding 6's fix asked for recall reported on the values the registry build actually missed; r3 wrote it as a withholding rule tied to development.

**Fix:** Define the subset as the gold values the sealed harvest (registry-on configuration) failed to register, computed by the evaluator's scorer from the sealed registry after the harvest runs, reported in both configurations without any withholding step; keep the development figure as the development-split number.

### A.8 (low) D20(c)'s default-if-silent takes the less restrictive of the two options the design itself offers: per-context 'regime does not apply' decisions for the two no-override tags are allowed by default, with 're-labelling only' named as the alternative, against the document's stated rule of resolving toward the more restrictive reading.

**Why:** Finding 11's fix added per-tag codes to the per-context decision; the default that makes that path available without a recorded owner answer was not revisited.

**Fix:** Set the D20(c) default to re-labelling only, with per-context decisions available only after the owner records an explicit D20(c) answer, and say so in §3.2 and §7.2.

### A.9 (low) Three numbers did not follow the r3 changes: §9.3 'up to about 12 device-hours per checker evaluation pass' is r2's 120 × 360 s (at the 450 s floor it is 15 h); the §8.5 item 3 deadlines and §8.2's rule-of-three use 120 packets while item 9 adds packets beyond 120 for short family × language cells; and §3.4 calls 4,096 output tokens 'about twice' a 2,600-token CJK maximum (1.6×).

**Why:** Finding 2's and finding 4's fixes changed the timeout and the corpus size without touching the dependent figures.

**Fix:** Write 15 device-hours; state the deadlines and bounds in terms of N, the sealed packet count recorded in the freeze; say '1.6 times'.

### A.10 (low) The harvest's dispatches and the two checker passes per packet draw on the parent job's `maxRequests` (contracts.ts:24, at most 1,000; session default 40 at session.ts:61, heavy 200 at profiles.ts:43), and a 4 MiB harvest with four-deep sub-chunking is up to about 620 calls, so a large job can exhaust its allowance mid-harvest (`budget_denied`, broker.ts:382) and become `partial` for a reason the `failedChunks` enum does not carry.

**Why:** The harvest's request budget is stated nowhere; §9.1 bounds its bytes and minutes but not its dispatch count against the policy it runs under.

**Fix:** Give the harvest its own request allowance in the job policy (or account it outside `maxRequests` with a stated bound), add `budget_denied` to `failedChunks.reason`, and state the checker's two passes per packet in the job's allowance.
