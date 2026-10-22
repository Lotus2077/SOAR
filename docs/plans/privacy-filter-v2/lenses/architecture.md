# Privacy filter v2: a multilayer outbound-packet pipeline inside SOAR

Lens: architecture inside the codebase. Status of everything below: **Proposed**.
Nothing here grants runtime, private-data or spending authority; the owner's
constraints of 2026-10-19 stand unchanged (exact-byte approval per packet, never
for regime-tagged data, every dispatch in the audit chain, no automatic cloud
fallback, derived material only).

Written against `<local path> at the `main` state of
2026-10-19 and the OPF trial under `<local path>
Sources are listed at the end. Nothing in the repository was edited.

---

## 0. The one-paragraph design

A cloud packet for a labelled (Tier O) context is **built, not scanned**. A new
`outbound/` module in `src/main/private-agent/` produces a candidate packet from a
purpose-specific template that admits only derived material (brief, outline,
schema, counts, diff, failing-check output), then runs it through four
restriction-only layers in this order: **deterministic rules and the matter's
own identifier registry** (cheap, precision 1.0, hard blocks), **OPF** (learned
span detector, bulk placeholder substitution), **the local 27B as a contextual
checker** (fixed prompt, structured verdict, catches whole-context sensitivity
that span detectors cannot see), and **a structural pass** (placeholder
consistency, an "originals-absent" invariant over the final bytes, size and
usefulness). Every substitution is recorded in an on-device **restoration map**
so the cloud reply can be re-identified locally. The owner approves the **exact
bytes** in a diff view; approval becomes a one-use grant bound to the packet hash
and a **packet manifest** hash; the existing broker scan gate re-runs the
deterministic checks over the wire bytes and binds the dispatch receipt to the
manifest; every layer verdict, decision, dispatch and restoration is an event on a
`prev_sha256` chain. Verdicts are **monotone**: a layer can add a redaction or a
block, never remove one; the only release is the owner's approval of the final
bytes.

The owner's example order (OPF, then local model, then rules) is honoured in
substance: three independent mechanisms with a deterministic pass last, at the
wire. The deterministic rules also run first because they are the cheapest layer
and their hits are hard blocks, so spending OPF and 27B time on a packet that a
credential or a regime identifier will block anyway is wasted.

---

## 1. What exists today and what the design must compose with

| Piece | Where | What it does now | What v2 does with it |
| --- | --- | --- | --- |
| Scan gate | `broker.ts` `request()` lines 354-365 | For any non-admitted destination, `scanner.scan(packet.text)` must return `{complete: true, blocked: false, detector}`; the receipt stores `scan: {status: "complete", detector}`. Admitted local destinations skip it. | Keep the gate and its semantics. Replace `RulePacketScanner` with a `CompositePacketScanner` that also checks the originals-absent invariant and binds the body to the approved manifest. Extend `ScanResult`/`DispatchReceipt.scan` with `manifestSha256`. |
| Today's scanner | `scanner.ts`, `scripts/secret-patterns.mjs` | Five credential regexes, 512 KiB cap, boolean block. Identity = hash of the pattern list. | Becomes the `rules` layer's seed. The identity pattern (config hash in `detector`) is reused for every layer. |
| Packet construction | `broker.ts` `packet()` lines 294-326 | Canonicalises `{method, url, headers, body}`, denies drift, size, and a known API key in the body. `PacketPreview.text` is the exact wire text. | Unchanged. The approved `packetSha256` is still the hash of this wire text; the diff view shows content and wire tabs. |
| Exact grants | `contracts.ts` `GrantSchema`, `ExactApprovalSchema`; `broker.ts` `eligible()` | A restricted context on a cloud destination needs a grant bound to `packetSha256`, `contextSha256`, `destinationSha256`, purpose; `cloud_model` needs `policy.mode === "cloud_help"`. | Reused as-is. The grant gains nothing; the manifest hash rides in the `approval.proposalSha256` chain (the proposal embeds the manifest). |
| Owner approval flow | `consultation.ts` (`propose` → `consultation_proposed` event with the full packet text → `decide("approve")` → grant with `remainingUses: 1` → `resume` with `validateAtCommit`) and `GeneralTaskWorkspace.tsx` (packet SHA-256, context SHA-256, approve/decline/revoke) | The only owner-approved cloud path. Packet = `canonical({question, checkpointSha256, inheritedContext, selected, files, omitted})`, ≤ 96 KiB body. | The state machine is generalised into an `OutboundProposal`; the consultant packet becomes one template. The renderer panel gains the diff view. |
| Repair packet | `repair.ts` `buildRepairPacket` (64 KiB: 24 KiB brief, water-filled text renderings of each draft file, 8 KiB self-check), `RepairBindingSchema`, `withRepair`; `scripts/phase2-repair.ts` `runCritique` (a `cloud_help` sub-job with one synthetic private source) | The Phase 2 H/L′ mechanism. | Becomes the first template (`repair_critique`). `RepairBindingSchema` gains `manifestSha256` and `restoredCritiqueSha256`; `withRepair` seeds the **restored** critique. |
| Labels | `contracts.ts` `SourceSchema.classification: public \| private \| credential`, `synthetic` | P1's lattice (`public < personal < confidential_professional` + regime tags) is **not implemented**. | Prerequisite R1. The builder refuses any regime-tagged context before touching content. |
| Audit chain | `store.ts` `private_agent_events (job_id, sequence, value)` | Ordered rows, no `prev_sha256`. P8 is still "now (contract)". | Prerequisite R1. New event types below. |
| OPF trial | `runtime/privacy-filter/{adapter,calibrate,prepare}.py`; `.soar/privacy-filter/` | Pinned source `f7f00ca7…`, checkpoint `7ffa9a04…`, CPU BF16, 32 KiB / 8,192-token cases, codepoint and UTF-16 offsets, tokenizer round-trip rejection, sandbox-exec network denial. Dev split: 84.38 % sensitive-character coverage, 5/12 canaries missed, 3 literal-mask failures. Sealed confirmation never ran. | `adapter.py`'s protocol becomes the OPF worker's IPC. The sealed confirmation is rollout step R3's exit gate. |
| Local model | `model.ts` `complete()` composes the body and dispatches via the broker with a `purpose` | Qwen3.8-27B FP8 on the Thor via vLLM 0.28, `max_model_len` 262,144, about 8 tok/s on prose. | The checker is a zero-fee local dispatch with `purpose: "outbound privacy check"`, thinking disabled, structured output. |

---

## 2. Where the packet is born: `OutboundPacketBuilder`

Location: `src/main/private-agent/outbound/builder.ts`. Called only from an owner
action in the session surface ("Ask the cloud to critique this draft"), after a
local result the owner judged bad (D15). It is never a model-callable tool
(P3: labelled jobs are closed-corpus; the tool is not offered).

Inputs: the job's brief, the frozen draft (the agent's own `output/` and
`review/` files, rendered to text by the existing `RENDER_PY` in the qualified
image), the self-check events, the context labels, and the purpose.

The builder **refuses before reading any content** when:

- `labels.regimeTags` is non-empty (`outbound_regime_tagged_denied`), or
- the policy mode is `offline`, or
- the destination is not a `cloud_model` with `requireExactGrant`.

Templates (one per purpose; each has a version and a hash recorded in the
manifest). The point of a template is that the admitted material is decided by
code, not by a detector.

| Purpose | Admitted material | Excluded by construction |
| --- | --- | --- |
| `repair_critique` (today's H) | Brief; per draft file an **outline** (headings, section lengths, table shapes); **excerpts** only around the host checks that failed (bounded window per failure); the self-check text | Full text renderings. See §2.1 for why. |
| `code_review` | File tree; function and class signatures; the unified diff of the agent's change; failing test names and assertion messages; the brief | Fixture data, `.env`, config with values, any file not touched by the diff |
| `schema_review` | Table and column names, types, nullability, row counts, cardinalities; example rows replaced with type-shaped placeholders | Any real row |
| `plan_review` | The plan steps, acceptance checks, tool budget, what failed | Inputs, observations |
| `research_framing` | A **generic restatement** of the research question written by the local model (an L0 step, see §3.3), the claims ledger's shape (counts, support rate), the conflict type | Source quotes, titles that identify a matter, the ledger rows |

Output: a `candidate` text, a `provenance` list (which draft files and events
contributed, by hash), and the start of the manifest.

### 2.1 A finding about today's repair packet

For the document-review family the draft output **is the owner's input with
changes**: a redline of the client's contract, a clean copy of a clinical note.
`buildRepairPacket` sends a text rendering of each required draft file, so for
that family the current H mechanism would send the raw document in all but name.
The `repair_critique` template must therefore send the issues list and the
tracked-change summaries for document review, never the clean copy or the full
redline text, and the manifest must record the family so the checker knows what
it is judging. This is a template rule, not a detector problem.

---

## 3. The layers, in order, with what each catches that the others miss

Each layer implements one interface:

```ts
interface FilterLayer {
  readonly name: "rules" | "opf" | "local_checker" | "structural";
  /** Config, weights, prompt and schema hashes, like RulePacketScanner.identity. */
  readonly identity: string;
  run(input: LayerInput, signal: AbortSignal): Promise<LayerOutput>;
}
interface LayerInput { text: string; manifest: OutboundPacketManifest; registry: IdentifierRegistry; map: RestorationMap }
interface LayerOutput {
  status: "complete" | "timeout" | "failed";
  verdict: "clear" | "redact" | "block";
  spans: SpanRecord[];          // additions only; the host applies them
  findings: Finding[];          // human-readable, for the diff view
  errorCode?: string;           // fixed codes only, never library text
  elapsedMs: number;
}
```

The host, not the layer, applies spans (placeholder substitution through the
restoration map) and recomputes the text between layers. The verdict lattice is
`clear < redact < block`; the pipeline's verdict is the join of the layers' and
a non-`complete` status is treated as `block` (fail closed).

### 3.1 Layer 1: deterministic rules and the matter's identifier registry

Runs first. Cost: milliseconds.

Three sources of patterns:

1. **Credential and path patterns**: today's five from `secret-patterns.mjs`
   plus `adapter.py`'s `<local path>` and `/home/` path rule, plus PEM variants. A
   hit is a **hard block** (`credential_in_packet` already exists as the wire
   check; this moves it earlier and names the pattern).
2. **Format-and-checksum identifiers**: IBAN (mod-97), card numbers (Luhn),
   national ID formats for the owner's stated jurisdictions once D14 is answered,
   medical record number shapes the owner registers, accession or DOI patterns
   for the research regime. Measured gap this covers: OPF's `account_number`
   recall was **0.13** and `secret` recall **0.33** on the development split; the
   five missed canaries were in the `code`, `log`, `split` and `cross_turn`
   categories, which are format problems, not language problems.
3. **The identifier registry** (per Tier-O job): parties, people, institutions,
   matter and study numbers, drug names if the owner marks them, project code
   names. Two origins: (a) an **entity harvest** run locally at job start by the
   27B over the inputs ("list every person, organisation, identifier and place
   named in these documents" into a strict schema), stored encrypted; (b) owner
   additions in the job surface. Matching is exact and normalised (NFKC,
   casefold, whitespace collapsed; for persons also surname-only and given-name-
   only forms of at least two characters, which covers the `long_distance`
   alias category OPF missed). A registry hit is a **placeholder**, not a block.

What this layer catches that the others miss: formatted secrets in code and
logs, checksum-valid account numbers, local paths, and **matter-specific
proper nouns that are not PII to a general detector** (a counterparty's company
name, a study's acronym). Rules alone covered only 10.77 % of sensitive
characters in September, but with precision 1.0 and zero unnecessary masking;
the registry is what turns the rules layer from a credential check into a
matter-aware one.

### 3.2 Layer 2: OPF span detection

Placement: on the Mac, as a persistent child process (the research doc's
placement decision; it keeps the Thor's GPU for generation, and the Mac numbers
are the only measured ones). The process is launched with the `calibrate.py`
pattern: pinned venv, `python -I`, `PYTHONDONTWRITEBYTECODE=1`, a sandbox-exec
profile that denies network, four threads, the frozen checkpoint, lazy load on
first use, unload after ten idle minutes to return the 3.8 GiB. Identity =
`runtimeFreezeSha256` (`3533c82e…` for the current freeze).

IPC: JSON lines on stdio, one request per chunk, `{id, text, language}` in,
`{id, complete, spans: [{start, end, label, startUtf16, endUtf16}], elapsedMs,
errorCode}` out. Spans only: the OPF JSON output carries the original text and
`redacted_text` (`OUTPUT_SCHEMAS.md`), and `adapter.py` already strips that.
Nothing from the worker is logged.

Chunking: `adapter.py` caps a case at 32 KiB / 8,192 tokens. A 64 KiB candidate
is split at line boundaries into ≤ 24 KiB pieces, no overlap (OPF's attention
band is 257 tokens, so boundary loss is local), offsets re-based by the host.
Entity consistency across chunks is the host's job (§3.4), not OPF's.

Labels map through `adapter.py`'s `OPF_LABELS` to the eight corpus labels.
Every span becomes a placeholder through the restoration map. A tokenizer
round-trip mismatch, an invalid offset or an incomplete chunk is `failed`, hence
block.

What this layer catches that the others miss: names, emails, phones, addresses
and dates **in prose, including Chinese and mixed text**, without a registry
entry. Development split: email 15/15, person recall 0.89, phone 0.83, Chinese
coverage 85 %. What it does not catch: secrets and account numbers (above),
split or encoded values, and everything the corpus calls
`wholeContextSensitive` (12 of 60 development cases by construction: business
facts without PII, proprietary details, long-distance aliases). Those are
structurally outside an eight-label span model.

### 3.3 Layer 3: the local 27B as a contextual checker

A zero-fee local dispatch through the broker to the admitted Thor destination,
`purpose: "outbound privacy check"`, `thinking: "disabled"` (the critic-cap
lesson from BL-20261007-1529: with reasoning on, the local model spent every
token thinking and wrote nothing), `maxOutputTokens: 2048`, vLLM structured
output (`response_format` with a JSON schema) so the reply is parseable, and the
packet is wrapped as untrusted text. The prompt and schema are versioned and
hashed into the layer identity. The Thor already holds the raw job, so this
dispatch adds no recipient; it is still a dispatch row (scan status
`not_required_inside_boundary`) and may be retried twice under D4.

Input: the **already placeholdered** text (so the judgement is about what would
leave), the purpose and family, the label level, the placeholder type counts,
and the registry entries (it is local, so it may see them; this lets it spot
paraphrases of registered entities).

The fixed question has four parts, each answered in the schema:

1. `reidentification`: can a reader with public knowledge still tell which
   person, organisation, matter, patient or study this is? Quote each passage
   that gives it away.
2. `confidential_facts`: are there business, legal, clinical or research facts
   that are sensitive without naming anyone (a strategy, a diagnosis plus a rare
   treatment, an unpublished result)? Quote them.
3. `over_redaction`: does any placeholder destroy the task (a quantity, a date
   the critique needs, a public identifier)? Quote the placeholder.
4. `useful`: can a reviewer still do the stated purpose with this packet?

Verdict schema (zod-validated, every quote must be a substring of the input or
the finding is dropped):

```ts
const CheckerVerdictSchema = z.object({
  version: z.literal(1),
  verdict: z.enum(["clear", "redact", "block"]),
  findings: z.array(z.object({
    kind: z.enum(["reidentification", "confidential_fact", "alias", "over_redaction", "injection_attempt"]),
    quote: z.string().min(1).max(400),      // located by the host; becomes a SpanRecord
    reason: z.string().max(300),
    action: z.enum(["placeholder", "drop", "reveal", "block"]),
  })).max(40),
  useful: z.boolean(),
  usefulReason: z.string().max(300),
}).strict();
```

The host turns each located `placeholder`/`drop` finding into a `SpanRecord`
with `layer: "local_checker"` and applies it. A `reveal` finding (over-
redaction) is **not** applied; it is shown to the owner as a quality note with a
button that creates an `owner_marked` reveal span, logged. `block` stops the
pipeline with the reasons visible. `useful: false` sets `packet_not_useful`
(§6).

Containment (P4): the packet may contain text addressed to the checker. The
output is schema-constrained, the verdict can only restrict, quotes are verified
as substrings, there are no tools, and a `clear` from an injected checker is
harmless because `clear` is not a release. The worst an injection can do is
force a `block`, which the owner sees and may override with a logged reason.

What this layer catches that the others miss: **whole-context sensitivity**,
aliases and cross-turn references, re-identification from fact patterns, domain
sensitivity (a diagnosis in a small town), Chinese and mixed-language meaning,
and over-redaction (the 3 literal-mask failures OPF produced). It is the only
layer that reads meaning. It is also the slowest and the least trustworthy
layer, which is why it is neither first nor last.

An optional L0 use of the same model: for `research_framing`, the local model
rewrites the question in generic terms before any detector runs. That output is
derived material produced on-device and goes through the pipeline like anything
else.

### 3.4 Layer 4: structural minimisation and invariants

Deterministic, runs last over the text that would be shown to the owner.

1. **Entity consistency**: all spans with the same `entityKey` get the same
   placeholder; distinct keys never share one. The host also searches the final
   text for surname-only, given-name-only and normalised forms of every mapped
   entity and places them under the same placeholder (`same_entity_reference`
   and `distinct_entity_reference` utility checks, which the September trial
   could not evaluate because no map existed).
2. **Originals-absent invariant**: no original value from the restoration map
   or the registry, in raw or normalised form, remains anywhere in the final
   bytes. This catches any upstream miss **for values that are known**; it
   cannot catch an unknown value.
3. **Shape minimisation by template**: tables longer than N rows become header
   plus row count; repeated structures become one instance plus a count;
   anything the template calls optional is dropped if the packet is over its
   budget.
4. **Budgets**: packet ≤ 64 KiB (the repair cap); body ≤ `maxRequestBytes` of
   the destination (≤ `BROKER_MAX_BODY_BYTES` 192 KiB today); placeholder density
   reported as a number.
5. **Known-credential check**: the existing `credential_in_packet` test.

Any invariant failure is `block` with the invariant named.

### 3.5 Layer 5: the owner's diff view

In `GeneralTaskWorkspace.tsx`, beside the consultation panel it generalises.

- Left: the candidate (derived material, real values). Right: the exact bytes
  that would leave, placeholders highlighted, colour by layer.
- A findings list grouped by layer, each with its action; `reveal` suggestions
  with a button; blocks with reasons.
- A tab showing the wire text (`PacketPreview.text`), its SHA-256, the context
  SHA-256, the manifest SHA-256, the destination, model, fee cap.
- The restoration map shown as counts by label, expandable to entries on request
  (local view only).
- The D15 consent reminder when the label level is `confidential_professional`
  or the registry contains third-party persons, as a checkbox the owner must tick.
- "Approve exact packet" is disabled unless: regime tags are empty, every layer
  is `complete`, the structural invariants passed, `useful` is true or the owner
  has acknowledged `packet_not_useful`, and the preview still matches.
- Approve → `outbound_decision` event → grant with `remainingUses: 1` bound to
  `packetSha256`. Decline and revoke as today.

Owner overrides (of a `local_checker` block, or revealing a placeholder) are
events with a reason string chosen from a fixed list plus free text that stays
local. A `rules` hard block (credential, regime identifier) has no override.

### 3.6 Layer 6: the broker scan gate at the wire

`CompositePacketScanner.scan(text, binding)` where the broker passes
`{jobId, contextId, grantId, purpose}` from the frozen request (a one-line
change at line 362). It:

1. runs the deterministic rules over the wire text (system prompt and JSON
   wrapping included);
2. loads the manifest and restoration map bound to the grant and checks the
   originals-absent invariant over the wire bytes;
3. checks that the wire body embeds the approved content (`contentSha256` of the
   packet section equals the manifest's);
4. returns `{complete: true, blocked: false, detector: <composite identity>,
   manifestSha256}`.

OPF and the 27B are not re-run at the wire: the owner approved these bytes, and
the gate's job is to prove that the bytes leaving are the bytes approved and
carry no known original. `DispatchReceipt.scan` gains
`{status: "complete"; detector: string; manifestSha256: string}`.

### 3.7 Layer 7: the return path

The reply is a dispatch response like any other. `restore(reply, map)` replaces
placeholders with originals on-device, records `placeholdersRestored` and
`unresolvedPlaceholders` (a cloud model may mangle `«PERSON_3»`), writes the
restored text as untrusted advice (as `withRepair` does for the critique, with
`REPAIR_INSTRUCTIONS` unchanged), and marks the map consumed. The reply is also
run through the rules layer and a short injection screen (the checker prompt's
`injection_attempt` kind) before it is written, and the result is recorded, not
acted on: side-effect actions remain non-model-callable (P4).

---

## 4. Data shapes

### 4.1 Packet manifest (persisted; content-free except hashes and counts)

```ts
export const OutboundPacketManifestSchema = z.object({
  version: z.literal(1),
  manifestId: z.string().uuid(),
  jobId: privateAgentId, contextId: privateAgentId, policyRevision: z.number().int().nonnegative(),
  contextSha256: sha256Schema,
  labels: z.object({
    level: z.enum(["personal", "confidential_professional"]),
    regimeTags: z.array(z.enum(["legal_privileged", "health_phi", "research_human_subjects",
      "controlled_access_genomic", "export_controlled_or_unpublished_ip"])).length(0),   // must be empty to exist
  }).strict(),
  purpose: z.enum(["repair_critique", "code_review", "schema_review", "plan_review", "research_framing"]),
  family: z.enum(["research", "document_review", "deck", "website", "admin", "coding", "general"]),
  template: z.object({ id: z.string(), version: z.number().int(), sha256: sha256Schema }).strict(),
  provenance: z.array(z.object({ path: z.string(), sha256: sha256Schema, bytes: z.number().int() }).strict()).max(64),
  candidateSha256: sha256Schema,                 // L0 output
  layers: z.array(LayerVerdictRecordSchema).min(4).max(8),
  contentSha256: sha256Schema,                   // final filtered content the owner saw
  packetSha256: sha256Schema,                    // wire text hash, == grant.packetSha256
  destinationId: privateAgentId, destinationSha256: sha256Schema, model: z.string(),
  restorationMapId: z.string().uuid(),
  placeholderCounts: z.record(z.string(), z.number().int()),   // {"PERSON": 4, "ORG": 2, ...}
  bytes: z.object({ candidate: z.number().int(), final: z.number().int(), wire: z.number().int() }).strict(),
  usefulness: z.object({ checker: z.boolean(), placeholderDensity: z.number(), ownerAcknowledged: z.boolean() }).strict(),
  createdAt: z.number().int(),
}).strict();

export const LayerVerdictRecordSchema = z.object({
  layer: z.enum(["rules", "opf", "local_checker", "structural", "owner"]),
  identity: z.string(),                          // detector/config/prompt hash
  status: z.enum(["complete", "timeout", "failed"]),
  verdict: z.enum(["clear", "redact", "block"]),
  inputSha256: sha256Schema, outputSha256: sha256Schema,
  spanCount: z.number().int(), findingCount: z.number().int(),
  elapsedMs: z.number().int(), errorCode: z.string().optional(),
  override: z.object({ by: z.literal("owner"), reasonCode: z.string() }).strict().optional(),
}).strict();
```

### 4.2 Span record (local manifest only; never in events)

```ts
export const SpanRecordSchema = z.object({
  id: z.string().regex(/^s_\d{1,5}$/u),
  layer: z.enum(["rules", "opf", "local_checker", "structural", "owner"]),
  label: z.enum(["person", "address", "email", "phone", "account_number", "private_url", "private_date", "secret",
    "registered_identifier", "organisation", "context_sensitive", "owner_marked"]),
  start: z.number().int(), end: z.number().int(),            // Unicode codepoints, exclusive end, in this layer's input
  startUtf16: z.number().int(), endUtf16: z.number().int(),  // adapter.py already supplies both
  originalSha256: sha256Schema,                              // hash of the original bytes; the value lives in the map
  entityKey: z.string(),                                     // normalised original, for consistency
  placeholder: z.string().regex(/^«[A-Z_]+_\d{1,4}»$/u),     // «PERSON_3»
  action: z.enum(["placeholder", "drop", "reveal", "block"]),
  confidence: z.number().min(0).max(1).optional(),
}).strict();
```

The guillemet form was chosen because it survives Markdown and JSON, is not an
HTML tag, is unlikely to be re-detected by OPF, and is easy to find on return.
Indices are per packet and never reused across jobs (P6).

### 4.3 Restoration map (encrypted at rest; deleted with the job)

```ts
export const RestorationMapSchema = z.object({
  version: z.literal(1),
  mapId: z.string().uuid(), manifestId: z.string().uuid(),
  jobId: privateAgentId, contextId: privateAgentId,
  entries: z.array(z.object({
    placeholder: z.string(), label: z.string(), entityKey: z.string(),
    original: z.string(),                                      // the only place the value exists
    aliases: z.array(z.string()).max(16),                      // surname-only etc., found by the structural layer
    spanIds: z.array(z.string()).min(1),
  }).strict()).max(2000),
  createdAt: z.number().int(), consumedAt: z.number().int().optional(), expiresAt: z.number().int(),
}).strict();
```

Storage: a new table `private_agent_restoration_maps (map_id, job_id, ciphertext,
nonce)` in the same SQLite store, `entries` encrypted with a per-install key in
the macOS Keychain (through the helper from BL-20261008-1211, not `security -w`).
It is never written to events, previews, telemetry or exports; the manifest
holds only `restorationMapId` and counts. Deleted and vacuumed with the job
(D16, P14), leaving the hash-only tombstone.

### 4.4 Identifier registry (per job, encrypted like the map)

```ts
export const IdentifierRegistrySchema = z.object({
  version: z.literal(1), jobId: privateAgentId,
  entries: z.array(z.object({
    kind: z.enum(["person", "organisation", "matter", "patient", "study", "place", "product", "other"]),
    value: z.string().min(2).max(200),
    origin: z.enum(["harvest", "owner"]),
    regime: z.boolean(),                                       // a regime-tagged identifier is a hard block, never a placeholder
  }).strict()).max(5000),
  harvestIdentity: z.string().optional(),                       // prompt/schema hash of the harvest run
}).strict();
```

---

## 5. Audit chain

Prerequisite (P8): add `prevSha256` to every row in `private_agent_events`,
computed as `digest(canonical(previousRow.value))`, with the job's first row
chained to `contextSha256` of the first context. Dispatch receipts get the same
field. A verifier script walks a job and recomputes the chain. Everything below
is content-free: hashes, counts, codes, timings.

New event types (appended by the pipeline, in this order per packet):

| Event | Fields | Written by |
| --- | --- | --- |
| `registry_built` | `jobId, entryCount, byKind, harvestIdentity?, harvestDispatchId?` | job start |
| `outbound_built` | `manifestId, purpose, family, templateSha256, candidateSha256, provenance[]` | builder |
| `outbound_layer` | `manifestId` + one `LayerVerdictRecord` | after each layer, including timeouts |
| `outbound_blocked` | `manifestId, layer, reasonCode` | pipeline, on a block |
| `outbound_proposed` | `manifestId, manifestSha256, contentSha256, packetSha256, destinationSha256, maxFeeMicrousd, consentReminder: boolean` | proposal |
| `outbound_decision` | `manifestId, decision: approve \| decline \| revoke, grantId?, overrides[], consentAcknowledged` | owner |
| dispatch receipt | existing fields + `scan.manifestSha256` | broker |
| `outbound_restored` | `manifestId, dispatchId, responseSha256, restoredSha256, placeholdersRestored, unresolvedPlaceholders, replyScreen: {rulesHit, injectionFindings}` | return path |
| `restoration_map_deleted` | `mapId, manifestId` | retention |

The disclosure report (P15) for a job lists each `outbound_proposed` that reached
a dispatch receipt: time, destination, bytes on the wire, label level, purpose,
manifest hash, the four layer verdicts, and whether an override was used. The
incident switch revokes destinations and grants as today; maps are kept until
retention so the report can say how many values were placeholdered, then deleted.

---

## 6. Budgets and failure modes

### 6.1 Latency and memory

The pipeline runs once per cloud packet, after a bad local result, on an owner
action. It is not on the per-turn path. Minutes are acceptable; the owner's
stated order is privacy ≥ quality > savings > latency.

| Layer | Where | Memory | Typical / budget on a 64 KiB packet | Basis |
| --- | --- | --- | --- | --- |
| Rules + registry | Mac main process | negligible | < 50 ms / 2 s | regex over 64 KiB; registry ≤ 5,000 entries with normalised index |
| OPF | Mac child process, CPU BF16 | 3.83 GiB peak RSS measured; model file 2.8 GB | 3 chunks × 0.37 s median, p95 4 s each → about 1-12 s / 60 s | September development run, 60 cases |
| Local checker | Thor via broker | none on the Mac; on the Thor the normal KV cost of a 20k-token prompt | prefill of about 17-20k tokens unmeasured on the Thor (estimate 10-30 s); output ≤ 600 tokens at 8 tok/s ≈ 75 s, about 35 s with MTP → 2-3 min / 300 s | Thor prose rate from the serving card; MTP unpinned (D11) |
| Structural | Mac | negligible | < 100 ms / 2 s | string search over map + registry |
| Owner | human | | minutes | |
| Wire gate | Mac | negligible | < 100 ms | rules + originals-absent + hash compare |

Mac headroom: 32 GiB total; Electron plus the OPF worker stays under 6 GiB. The
September `peakRssBytes` stop threshold (12 GiB) is kept as a kill limit. Thor:
122.9 GiB; the 27B FP8 and its KV cache already live there; the checker adds a
request, not a resident. If the Mac proves too slow or the owner prefers, OPF
can move to the Thor's CPU cores (14 ARM cores; no measurement exists), but only
after the hardening list closes, since the Thor is not yet a verified boundary.

### 6.2 Failure modes and the response to each

| Failure | Response | Why |
| --- | --- | --- |
| A layer times out or crashes (OPF preflight stalls were observed in September) | `status: timeout`/`failed`, verdict `block`, the owner sees which layer and may retry. Never skip-and-proceed. | Fail closed; priority order |
| Layers disagree | Not possible as a conflict: verdicts join upward. The visible case is the checker flagging what OPF cleared (expected) or flagging an over-redaction (shown as a quality note; owner decides). | Monotone verdicts |
| The checker blocks on a false positive, or is injected into blocking | Owner override with a reason code, logged in the manifest and the chain. | The model is fallible both ways; over-blocking is a quality defect |
| Rules hard block (credential, regime identifier) | No override. The packet is rebuilt with the material removed, or the task stays local. | These are invariants, not judgements |
| The packet shrinks to uselessness (checker `useful: false`, or placeholder density above a template threshold) | `packet_not_useful`: the owner is offered a narrower template (outline-only, schema-only), staying local, or an acknowledged send. No silent send, no silent widening. | Over-redaction is a measured defect in the research doc |
| OPF tokenizer round-trip mismatch, invalid offsets, chunk incomplete | `failed` → block, error code shown. | adapter.py already rejects these |
| Context drift between approval and dispatch | Existing `validateAtCommit` and grant binding refuse. | Unchanged |
| Reply mangles placeholders | Restore what matches, count the rest, show the count; the reply is untrusted advice regardless. | Return path is advisory |
| Reply contains instructions | Screened and recorded; nothing is executed; side effects remain non-model-callable. | P4 |
| Restoration map lost (Keychain key missing) | The reply stays placeholdered and is marked `unrestored`; nothing re-identifies by guessing. | Never reconstruct from display strings |
| Incident switch | Destinations and grants revoked, pending proposals revoked, report generated; maps retained until retention for the report, then deleted. | P15 |

---

## 7. The end-to-end flow for one Tier-O packet

1. The Tier-O job runs `mode: "private"` on the Thor. At job start the registry
   is harvested locally (`registry_built`).
2. The local result is bad; the owner chooses "Ask the cloud to critique this
   draft". The session freezes the draft (as the repair pair does).
3. `OutboundPacketBuilder` checks labels (regime tags empty), picks the template
   for the purpose and family, renders the admitted material, writes
   `outbound_built`.
4. Rules + registry → OPF → local checker → structural, each writing
   `outbound_layer`, each substituting through the restoration map. Any block
   writes `outbound_blocked` and stops.
5. The pipeline creates a `cloud_help` sub-job and context (as `runCritique`
   does, but `synthetic: false`), composes the wire body through
   `PrivateAgentModel`'s body builder, calls `broker.preview()`, and records
   `outbound_proposed` with the manifest.
6. The owner reviews the diff, ticks the consent reminder if shown, approves.
   `outbound_decision` → grant (`remainingUses: 1`) with `packetSha256`.
7. `broker.request()` runs `eligible()` (cloud mode, grant present, restricted
   context) and the composite wire gate, commits the dispatch with
   `scan.manifestSha256`, sends.
8. The reply is restored on-device, screened, written as `context/critique.md`
   with `REPAIR_INSTRUCTIONS`; `outbound_restored` is written; the local repair
   runs on the Thor with real names.
9. At retention, the map is deleted (`restoration_map_deleted`).

Nothing in steps 1-9 happens without step 2's owner action and step 6's
approval. There is no path from a failed local run to a cloud dispatch.

---

## 8. Rollout order

Each step is `Proposed`. Each exit gate states what its test proves and what it
does not.

| Step | Work | Exit gate (proves) | Does not prove |
| --- | --- | --- | --- |
| **R1 Contracts and chain** | P1 label lattice and regime tags on contexts; `prevSha256` on events and receipts with a verifier; manifest, span, map, registry schemas; `ScanResult`/`DispatchReceipt.scan` extension; `eligible()` denies cloud for regime-tagged contexts regardless of grant | Unit tests on synthetic data: a regime-tagged context cannot produce a packet or a grant; a tampered event breaks the chain | Any detection quality |
| **R2 Builder, rules, structural, map, diff view** | Templates for `repair_critique` (with the document-review rule of §2.1) and `code_review`; rules + registry layer; structural layer; restoration map store; `OutboundProposal` from the consultation state machine; renderer diff view; composite wire gate | On the six Phase 2 repair drafts (synthetic): the packet that leaves equals the approved bytes (hash and packet capture on the Mac, per P12); originals-absent holds; H critiques on placeholdered packets are re-graded against the raw-packet H critiques to measure the utility cost | Anything about real data; OPF or checker quality |
| **R3 OPF worker** | Persistent sandboxed worker with `adapter.py`'s protocol; chunking; idle unload; **run the sealed confirmation** (the 60 unrun cases) under the frozen identity | Confirmation scored by the independent scorer; the worker completes 60/60 under the limits; per-language and per-class numbers disclosed | A production prevalence estimate; zero-leak |
| **R4 Local checker** | Prompt v1 and schema; structured output on vLLM 0.28; evaluation on the 120-case corpus's `wholeContextSensitive` cases plus planted injection attempts; latency measured on the Thor | The checker flags ≥ the whole-context cases OPF structurally cannot, blocks on none of the `clean_public` cases, and no planted injection changes a verdict upward | That the 27B is a reliable judge in general |
| **R5 End-to-end canary** | A synthetic Tier-O-shaped job with registered canaries in every category OPF missed; the full pipeline; packet capture | Zero bytes leave without a grant; with a grant, zero canaries in the captured bytes; the chain verifies | Real-data safety |
| **R6 Owner gate** | D15 opt-in surface with the consent reminder; `coding` family first (most structurally minimisable, least third-party PII), then `research_framing`, `admin` last (most injection-exposed, most third-party data) | The owner's first real use is recorded with its manifest and disclosure report | Nothing beyond that one use |

R1 and R2 can proceed now on synthetic material. R3's confirmation is the item
blocked since September and should not wait for R4. R6 waits for the repair
pair's result: the plan's R4 rule says a cloud critique becomes the hybrid
mechanism only if H beats L′ by ≥ 2, and that result is still running.

---

## 9. Limitations the design does not remove

- **A pseudonymised packet is still personal data** (design §1, GDPR Art 4(5),
  PIPL Art 73). This pipeline lowers what a packet discloses; it does not change
  the rule that cloud help for a labelled context is per-task opt-in and never
  for regime-tagged data.
- **No layer catches an unregistered, unformatted, non-PII confidential fact
  that the checker also misses.** The originals-absent invariant covers known
  values only. The residual is the owner's reading of the diff.
- **The detector numbers are development-split numbers** on 60 synthetic cases.
  The sealed confirmation never ran. Zero misses on a small sample would not be a
  zero-leak claim.
- **The 27B as checker is unmeasured in this role**, and it is the model whose
  task results were weaker than the cloud's. Its injection resistance is
  unknown; the design limits the damage (restrict-only, schema-bound) rather than
  relying on it.
- **Over-redaction costs quality**, and the cloud critique's value on a
  placeholdered packet is unmeasured. R2 measures it before R6 depends on it.
- **The Thor is not yet a verified boundary** (hardening list pending). The
  checker dispatch adds no recipient the job does not already have, but the
  boundary claim waits on the checklist.
- **Latency on the Thor for a 20k-token prefill is an estimate.** R4 measures it.

---

## 10. Sources consulted

- `<repo>/docs/plans/PRIVATE_WORK_DESIGN_V1.md` §1-2 (P1-P17; "pseudonymised packets are still personal data"; regime tags).
- `<repo>/docs/PLAN.md`: Phase 2 rules R0-R5 and Branch B; "Cloud help that respects the owner's rule"; D4, D11, D14, D15, D16.
- `<repo>/docs/PRIVACY_FILTER_RESEARCH.md` (September trial numbers, placement decision, integration cautions).
- `<repo>/docs/BUILD_LOG.md`: BL-20261019-0432 (Phase 2 provisional result), BL-20261013-1640 (repair selection), BL-20261007-1451 and -1529 (repair design, critic cap), BL-20261006-1008 (box checklist).
- `<repo>/src/main/private-agent/broker.ts` (packet(), eligible(), the scan gate, transport), `scanner.ts`, `contracts.ts`, `store.ts` (DispatchReceipt, events table), `repair.ts`, `consultation.ts`, `model.ts`, `profiles.ts`.
- `<repo>/scripts/secret-patterns.mjs`, `scripts/phase2-repair.ts` (runCritique).
- `<repo>/src/renderer/src/GeneralTaskWorkspace.tsx` (consultation approval panel).
- `<repo>/runtime/privacy-filter/README.md` and `adapter.py` (protocol, limits, label maps, rules).
- `<local path> `evaluation/schema.md`, `evaluation/development/score-opf-v2.json` (per-class numbers), `evaluation/development-aggregate-v1.json`, `evaluation/operating-selection-v1.json`, `evaluation/manifest.json` (category counts; no case text read), `evaluation/score.py`, `provision/pins.json`, `provision/checkpoint.json`, `results/development-v2/runtime-summary.json`, `assets/opf-source/README.md` and `OUTPUT_SCHEMAS.md`, `assets/checkpoint/config.json`.
- Memory note `project-soar-target-workload.md` (Thor RAM, serving alias, token rates).
