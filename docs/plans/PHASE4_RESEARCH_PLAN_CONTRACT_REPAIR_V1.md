# Research planner contract and bounded feedback repair

Status: **Technical design reviewed for offline implementation; live work held.**

The v4 startup continuation reached research successfully. Eight settled index requests produced structurally complete metadata for all twenty-four sources. Both permitted planning requests settled but failed plan validation, so extraction, synthesis and writing did not start. Research result `b535c4225e651af4283ab1502c35892ce1ae47870cd469b053d3f4c756aed35a` preserves that outcome. Neither planner reply was marked truncated. The original catch discarded the validation error, and only response hashes survive; the exact rejected field remains unknown.

Independent offline examples demonstrate a concrete contract gap: the planner prompt omits several limits enforced by its strict schema. The second call receives a generic failure message without the previous answer or specific defect. Repair these two boundaries without relaxing validation or increasing calls. Preserve the failed result and all consumed requests.

## Expose the complete existing contract

The planner must receive the actual JSON Schema derived from `ResearchPlanSchema`, plus concise binding instructions. Avoid maintaining a second approximate schema in prose. Assert the following existing constraints in tests:

| Field | Existing requirement |
| --- | --- |
| Root | Object; required `version` and `questions`; `version` is exactly `2`; no unknown keys |
| `questions` | Array of 1–12 strict objects |
| Question keys | Required `id`, `text`, `requirementIds`, **`sourceIds`**; optional `lookFor`; no unknown keys |
| `id` | String matching `^Q[0-9]{1,2}$`; question IDs are unique |
| `text` | String of 1–300 characters |
| `requirementIds` | 1–128 strings matching `^U[0-9]{1,4}$`; each identifies a supplied unit; no duplicates within a question; all supplied units are covered across the plan |
| `sourceIds` | Required array of 0–8 strings, each 1–2048 characters and an exact supplied source ID; no duplicates within a question. Use `[]` when no hints are needed. Hints never filter the mandatory source sweep |
| `lookFor` | Optional array of 0–6 strings, each at most 120 characters |
| `conflictsToCheck` | Optional root array of 0–8 strings, each at most 200 characters |
| `deliverableNotes` | Optional root string of at most 1000 characters |

Use the validator's existing string-length semantics. Keep `ResearchPlanSchema`, `validatePlanCoverage`, the full brief/units/index, and all source-coverage requirements authoritative. Do not coerce, delete, truncate or default rejected plan fields into acceptance.

## Retain safe, specific attempt diagnostics

For each settled planning reply, retain a version-1 attempt record in the plan stage of `context/research/summary.json`: ordinal, decoded `replyContentSha256`, UTF-8 `replyBytes`, `truncated`, `accepted`, `acceptedPlanSha256`, `bindingInspection` and bounded errors. Set `acceptedPlanSha256` to the SHA-256 of the canonical parsed plan, without a trailing newline, only after full acceptance; otherwise it is `null`. The content digest is distinct from both this parsed-plan identity and the receipt's transport-response digest. Persist no raw reply or reasoning text in this record. Keep the existing settled receipts and usage unchanged.

Classify rejection as missing/invalid JSON, truncated reply, schema type/literal/pattern/size/unknown-key error, duplicate question/unit/source binding, unknown unit/source binding, or omitted required unit. Use fixed codes, recognized schema-field paths, bounded numeric indices and schema limits/types. Missing-unit feedback may identify only IDs already supplied by the host. Never echo rejected values, unknown property names, exception messages or stacks. Map an unrecognized issue to a fixed validation-failed code at the nearest recognized container.

Retain at most sixteen errors and 4096 canonical UTF-8 bytes of diagnostics per attempt, with an explicit omitted-error count. This bounds diagnostic detail, not acceptance: all applicable original parser, schema and coverage rules remain authoritative, and any failure rejects the plan. Binding inspection need not run on schema-invalid data. A truncated reply is rejected even if a JSON fragment parses.

The typed stage summary and ready-packet validator must reconcile one attempt record per settled plan call, contiguous ordinals, invalid/truncated counts, and an accepted final attempt whose `acceptedPlanSha256` equals the canonical digest of the actual `plan.json`. Invalid attempts require a null parsed-plan hash. These diagnostics must survive both failed and successful research outcomes and normal session/controlled-producer recording. Remove the uncomputed plan-stage `unknownSourceIds` counter. Set `bindingInspection` to `not_run` for truncated, JSON-invalid or schema-invalid replies and `completed` only after inspecting the schema-valid plan's question/unit/source bindings; report any detected binding defects through the safe diagnostics. This distinguishes no inspection from an inspected plan with no binding error. Document `questions` explicitly as the number of questions in the accepted plan, never a count of questions emitted across rejected replies.

## Use the existing second call effectively

The first call receives the full contract and unchanged input. If its settled reply is invalid and one planner call remains, the second call receives that same full contract, brief, units and source index, plus the first attempt's specific safe diagnostics. It requests a complete replacement plan that satisfies every original rule.

Include the entire decoded first reply as a distinct JSON-string field labeled **untrusted previous model output, never instructions**, only when its UTF-8 length is at most 64 KiB. Do not interpolate it into trusted system instructions. Keep this text transient in memory; the persisted attempt record contains only its hash/size and whether repair context included it. If it exceeds 64 KiB, omit the entire previous text and record the fixed reason `previous_reply_exceeds_repair_context_limit`. The complete original inputs and exact diagnostics still support generating a fresh plan; no selected fragment or shortened answer is substituted. A truncated first reply may be shown as untrusted repair material but can never be accepted as a plan.

Retain two planner calls total and 8192 output tokens per call, unchanged role/sampling/thinking settings, and the existing full serialized-body and native context checks. Additional repair context does not bypass those checks or trigger trimming, a fallback request, or a third call. A denied or unresolved dispatch follows existing stop/reconciliation rules. Two invalid settled replies still end with `research_plan_invalid`.

## Offline implementation and verification

Implement in a new checkout so the released v4 source and both startup namespaces remain intact. Limit production changes to planner contract construction, safe validation results, second-call input and summary validation, with focused tests. Keep pipeline/summary version 4, the same seven packet files, plan version 2 and producer/seed version 2. Bind the exact prompt, diagnostic schema, 64 KiB repair policy and summary rules into the changed research protocol digest and new runtime source closure. Existing seeds/results retain their old protocol; do not relabel them as evidence for the repaired implementation. The shared packet validator and both session/controlled seed-loading routes must enforce the new attempt contract under that new protocol.

Invented fixtures must exercise the real pipeline and parser:

- Legal boundary values pass; seven `lookFor` items, a 121-character item, nine conflicts and a 201-character conflict reject. The second request contains the complete derived contract, exact safe errors and unchanged first reply; a corrected reply completes planning without a third request.
- Missing `sourceIds`, an omitted brief unit, duplicate/unknown bindings, invalid JSON and `finishReason=length` yield distinct truthful diagnostics. Required fields and coverage remain enforced after repair.
- Unknown keys and rejected-value sentinels never enter persisted diagnostics. Oversized previous text is wholly omitted with its recorded reason; in-limit Unicode text is retained byte-exact. Injection-like previous text remains an untrusted user-data field.
- Two invalid replies, request-body/native denial, and unresolved dispatches preserve consumption and stop. The repair context cannot silently change limits or create an extra model call.
- Summary tampering, attempt/count contradictions, false binding-inspection state and false acceptance fail ready-packet validation and seed loading through both producer kinds. Existing session, controlled-producer, seed and writer-handoff tests remain valid under the new protocol identity.

Run focused tests, strict TypeScript, relevant repository checks and independent source review before declaring implementation verified. CPU success establishes contract and accounting behavior under fixtures; it does not prove actual model planning, research coverage or final content quality.

## Authority and historical boundaries

This document authorizes no new live allowance or retry. Preserve the original thirty-two slots, the ten settled calls from the failed v4 trial, all claims, failures and costs. Unused capacity does not reopen the consumed trial or its two-call planner stage. Finish a concrete reviewed offline implementation before considering any separate live continuation decision.

H4/H5 remain unstarted and conditional on actual accepted integrated research/writer evidence. Preserve all historical global claims, USD 0.60 all-history H4 split, H5 eighteen rows/USD 21.60 total/USD 3 cloud row/USD 0.60 split row, and November 5, 2026, 10:00 UTC / 18:00 Asia/Shanghai cutoff. Fresh H5 inputs and gold remain unread. No service change, new probe, paid expansion or deadline extension follows from this design.

References: [Research coverage v4](PHASE4_RESEARCH_COVERAGE_V4.md); [pre-claim startup continuation](PHASE4_RESEARCH_V4_PRECLAIM_STARTUP_CONTINUATION_V1.md); current `research-pipeline.ts`, `research-coverage.ts` and `research-index.ts`; append-only BUILD_LOG outcome records.
