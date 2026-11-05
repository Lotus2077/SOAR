# Phase 4 research coverage v4

Status: **Implemented and verified offline; live amendment Proposed and held.**

The production repair passed both CI jobs on `e12c568`. The held trial controls passed fifty-four CPU tests, including actual research receipts, producer/checkpoint creation, read-only seed loading, the production writer and three artifact checks using invented evidence and a mocked sandbox. These checks establish the integration and controls, not live evidence quality or H4/H5 acceptance. The final release must bind the current source manifest, independent review and CI; the new live allowance below remains unapproved.

This design supplies a completion path for the research-seed and writer failures recorded in BUILD_LOG entry BL-20261105-0357. It is not an accepted experiment result, a replacement-run authorization, or a release. Reversible offline implementation may proceed after independent technical review under the continuing project goal. Any further model request requires the named live amendment in section 10 and a reviewed, pinned implementation.

## 1. Evidence and objective

The accepted sixteen-case API qualification remains historical evidence. All thirty-two standalone slots have been consumed. The final artifact pilot completed four requests and four tools, produced a substantive draft after two turns, and passed mechanical artifact checks. Final content was rejected. Quote occurrence and saved artifacts did not establish complete, supported answers.

The retained research seed had twenty-one of twenty-four index entries without semantic metadata. Its packet contained sixty-six verified quotes from eleven sources, with no quotes lost to the packet cap. Synthesis recorded a truncated reply. Material source coverage was missing, and both the synthesis and writer extended packet gaps into unjustified statements about the complete corpus. These observations motivate a generic pipeline correction; they do not prove that an index repair alone will solve the task. Raw index reply bodies were not retained, so the exact model reply responsible for each blank row is unknown.

The objective is to produce a complete, source-grounded research handoff and a supported deliverable. The new path must actually read the eligible corpus, recover bounded extraction failures, preserve unresolved questions, and put the complete resulting packet in the writer's initial context. It must not merely add a refusal gate to the existing incomplete packet.

The previously exposed development corpus may be used for a fresh regression run. It is no longer blind validation. Runtime code and prompts must contain no task-specific facts, source names, preferred answers, or selected evidence. Fresh H5 bodies and evaluator gold remain outside offline design and implementation work.

## 2. Host-owned brief and source coverage

Introduce `ResearchCoverageV1` in a new `research-coverage.ts` module. It binds the exact brief bytes and source manifest, not a model's summary of them.

The host derives coverage units from exact, ordered brief spans. Explicit numbered asks become units; remaining nonempty instructions, headings, and preamble spans remain represented. If deterministic segmentation is ambiguous, retain the entire brief as one unit instead of guessing its meaning. Preserve offsets, text, and hashes, and verify that the representation does not omit or alter any brief text. Units preserve the request; they do not certify that its meaning has been understood.

The plan retains the existing maximum of twelve questions. Each question binds one or more valid host unit IDs; every host unit must be assigned to at least one question. A question may cover multiple units without shortening their text. Missing or invalid assignments trigger the existing bounded second planning call. Both calls count inside the two-call planning ceiling. If assignment remains invalid, preserve the partial plan and stop before claiming a ready seed.

Each extraction request receives the complete brief, all host units, and every planned question with its full text. Planner-selected source hints may guide synthesis or repair order, but cannot exclude a source from the mandatory sweep. Every source has a stable ID, byte length, content hash, readability outcome, and deterministic chunk inventory. An unreadable or omitted source remains an explicit gap.

A complete visitation table, a nonblank gist, an assigned unit, or a matching quote is structural evidence only. None automatically proves relevance, entailment, sufficient depth, or complete answers.

## 3. Index repair with a usable fallback

Keep the existing index role, sampling settings, output limit, and twenty-four-call budget. Add a pure `research-index.ts` module exposing `assessIndexBatch({content, truncated, expectedSourceIds})`, literal-card construction, index-entry assembly, and truthful semantic counters. The pipeline retains dispatch, correction, and budget accounting. Coverage joins these entries by exact source ID and hash; it never interprets index completion as semantic coverage.

- Require unique, exact expected source IDs and a nonblank gist for `model_complete`. Title, date, and numeric figures may legitimately be empty. Do not remap basenames or count inventory rows as semantic success.
- Preserve individually valid rows. Report bounded reasons for unresolved rows: invalid JSON, missing ID, duplicate ID, unexpected ID, empty gist, or truncated reply. A truncated reply cannot mark its batch complete.
- Run initial batches for the entire inventory first. Then allow at most one correction call per deficient batch, requesting only unresolved IDs, within the same twenty-four calls. No correction may consume capacity reserved for an unseen initial batch.
- Independently construct a literal card for every readable source: exact heading up to 160 characters, first 512 UTF-8 bytes, source hash, and exact span references. Mark it `host_literal`, untrusted, and `needsCoverageRead`. It is not a generated summary or semantic success.

A source whose index metadata remains unresolved still enters the full source sweep. This permits useful progress without pretending that an empty index was successful. Record inventory, semantic-complete, repaired, and literal-fallback counts separately. Transport failure or an unresolved dispatch follows existing stop and reconciliation rules; it does not grant a replay.

## 4. Source-first extraction and bounded recovery

Replace the question/source-pair selection loop with one mandatory extraction per readable source chunk, asking about all frozen brief units and questions in that call. Preserve the forty-call extraction ceiling and the existing extraction role, sampling, thinking policy, and 2,048-token output limit.

Use deterministic UTF-8-safe chunks of at most 64 KiB. A source that fits is read whole. For larger sources, cut at a line boundary where possible, retain exact half-open byte ranges, and use up to 2 KiB of recorded overlap. The chunk union must cover every source byte; overlap is not additional source coverage. Order sources and chunks deterministically. Before the first research model request, compute the complete source/chunk inventory, readability outcomes, mandatory initial index batches, and mandatory extraction-call count. Refuse without a model call if required input is unreadable or either mandatory stage alone exceeds its pinned budget. Record the shortfall; do not silently sample the corpus or label a partial run complete.

Public hashes-and-sizes metadata for the three H5 research corpora describes twenty, twenty-one, and twenty-three files, with each file below 64 KiB. That supports a one-chunk-per-file budget estimate only; it is not evidence about their content or answerability, and no body or gold inspection is needed for this design.

Use a compact structured extraction reply:

- one entry for every expected question, with an outcome such as `evidence_found`, `no_verified_evidence`, or `needs_followup` and references to shared quote records;
- bounded quote records with exact source/chunk identity, original quoted text, locator, and one or more valid question IDs;
- conflicts and unresolved issues with source/question references.

Retain existing quote-length and quote-count bounds. A shared quote is represented once even when useful to multiple questions. Host verification checks source identity, quote occurrence within the supplied chunk, allowed question IDs, and response completeness. It cannot establish that the model assigned the quote to the right question.

Finish the complete mandatory sweep before running any repair. Queue invalid, truncated, missing-question, or explicit follow-up results in deterministic order. Permit at most one follow-up per deficient chunk, using remaining calls inside the same forty-call ceiling. The repair sees the complete chunk, brief, and questions, with the specific defect identified; it may request a more compact response but must not replace the source with a selected answer excerpt. Preserve the initial response status and the repaired outcome. No retry may starve an unseen source, enlarge the stage allowance, or replay an unresolved dispatch.

If the stage exhausts its budget with unresolved structural failures, retain the evidence and coverage diagnostics but do not transfer a ready seed. `no_verified_evidence` means only that this extraction did not verify evidence from the examined chunk. It is not a factual assertion that the source or corpus contains none. Zero quotes, trivial quotes, or one quote per question cannot automatically satisfy final quality review.

## 5. Packet and synthesis that preserve gaps

Add `coverage.json` to the persisted research packet. Keep the existing 64 KiB evidence-packet cap. Deduplicate verified quote text by source and span, retaining every question association and stable evidence ID. Record every cap exclusion and its source/question associations; excluded evidence cannot count as evidence delivered to the writer. Conflict count/byte caps also retain an explicit omission record and prevent ready transfer. Do not silently convert a bounded selection into an exhaustive packet.

Coverage records must distinguish source/chunk not examined, read or parse failure, truncated response, no verified evidence extracted, evidence retained, and evidence omitted by a cap. They also retain brief-unit/question assignments, verified evidence links, conflicts, repair history, and unresolved work. These are provenance and limitations, not a semantic completeness score. Use an explicit conservative structural rule for v4: any cap-excluded verified quote prevents ready transfer, because the host cannot decide that the omitted quote is semantically unnecessary. All inventoried sources must be readable, every mandatory chunk must have a complete terminal extraction result, and no structural failure may remain unresolved. Retain cap-excluded quote identities and coverage diagnostics on failure; do not silently trim a ready packet. A ready packet still does not certify that its retained evidence is sufficient or relevant to every requested answer.

Synthesis receives the full brief, plan, retained evidence, and coverage. Keep the two-call synthesis ceiling, existing synthesis role/thinking policy, and 8,192-token output limit. Require a structured result containing the argument, evidence references, and a disposition for every brief unit/question: supported findings, conflict or uncertainty, or explicit unresolved evidence. Unknown evidence IDs, missing dispositions, empty output, invalid structure, and `finishReason=length` are not successful synthesis. Do not strip a bad citation and silently retain its factual claim.

Use the second existing synthesis call to repair the specific defect, asking for a complete concise result over the same evidence. A second failure preserves partial work without producing a ready seed. A valid shape and known evidence IDs remain insufficient for semantic acceptance; independent final review must judge relevance, factual support, contradictions, temporal scope, limitations, and requested coverage.

The synthesis and writer instructions must distinguish packet gaps from corpus facts. They may report that the bounded extraction did not obtain verified evidence for an issue. They may not infer corpus-wide absence from an empty packet cell or a failed extraction. A natural-language rule or structured status is not an automatic proof that the resulting report follows it; the final content gate remains necessary.

## 6. One complete presentation for every research writer

Introduce a generic `ResearchPresentationV1` and an optional, host-owned `initialEvidence` field on `SessionPhase` and `GeneralJobOptions`. Use the same builder for ordinary research sessions, loaded research seeds, selected candidates, and repair writers, including applicable H4/H5 paths. This is an explicit production input-presentation change. It is not a claim that the former private preloaded pilot had unchanged prompts or that its mechanical pass qualifies the new path.

The presentation contains the exact complete `argument.md`, the complete human-readable `evidence.md`, `plan.json`, and `coverage.json`, with file hashes and clear untrusted-data delimiters. Verify that the human-readable evidence render corresponds to the complete retained `evidence.json` records and IDs. Do not include a second duplicate rendering of every quote merely to repeat the same data. Retain all seven packet files in the workspace so the writer can inspect provenance or resolve ambiguity. Original task text, brief, source availability, output requirements, and ordinary tool observation policy remain intact.

Insert the presentation once in the retained initial context, separately from `contract.goal`; the goal's existing size limit is not a container for the packet. Treat quoted source instructions as data, never as runtime authority. Bind the presentation's ordered file hashes, exact rendered bytes/hash, policy version, and original goal identity into phase/session/runner identity. Resume must reconstruct the same single block, not append another copy. Each actual serialized model body must contain it exactly once. Persist evidence sufficient to verify that relationship without adding a separate model-API provenance feature where existing body hashing and admission already suffice.

Set a 192 KiB maximum for the complete rendered presentation. A larger presentation fails admission without clipping, summary substitution, selective omission, or an extra diagnostic generation. Before each request, the actual serializer must still enforce the existing 640 KiB Heavy request-body ceiling and native token admission over the complete goal, tools, presentation, retained history, and reserved output. Passing the presentation cap alone does not prove context fit. Preserve the existing output reserve and safety margin. The model may write artifacts directly from the full packet without spending discovery turns rereading files; successful completion is still unproven until the intended production path passes a live pilot.

## 7. Persisted contracts, implementation surfaces, and identity

Implement the change in the separate research-coverage checkout. Preserve the original checkout, frozen sources, failed seeds, all three pilot outcomes, and historical validators. Do not hand-patch a rejected seed or relabel an old runtime as v4.

| File or interface | Required change |
| --- | --- |
| `src/main/private-agent/research-pipeline.ts` | Protocol version 4; strict index assessment; complete source sweep; bounded recovery; coverage packet; non-truncated structured synthesis; accurate counters. |
| New `research-index.ts` | Pure exact-ID batch assessment, literal source cards, metadata outcomes, and semantic counters; no model calls, I/O, or budget ownership. |
| New `research-coverage.ts` | Host brief spans; source/chunk inventory; extraction dispositions; provenance links, omissions, and reconciliation. Pure validation helpers support CPU tests. |
| New `research-presentation.ts` | Deterministic complete untrusted presentation builder/validator; exact file/render correspondence; 192 KiB cap. |
| `research-seed.ts` | `ResearchSeedV2`; exact seven-file packet manifest; v4 protocol/default-budget and coverage consistency checks; explicit session or controlled-pipeline producer provenance; existing source-job/snapshot and one-hop lineage protections. |
| `session.ts` | Copy/validate/hash `initialEvidence`; common transfer builder; preserve exact presentation on ordinary, seeded, resumed, selected, and repaired paths. |
| `runner.ts` | Bind presentation into identity and initial messages exactly once; preserve normal serializer, admission, history, tool projection, checks, cancellation, and cleanup. |
| `scripts/private-agent-local-screen.ts` | Freeze the new protocol/presentation/runtime identity; regenerate the full seed for the integrated trial; use the real intended writer path. |
| `scripts/phase4-loop.ts` | Bind samples and repairs to the same newly accepted seed/presentation policy without weakening full-loop requirements. |

The exact seven files are `index.json`, `plan.json`, `evidence.json`, `evidence.md`, `argument.md`, `summary.json`, and `coverage.json`. Presentation is derived from those frozen files; do not create a self-referential manifest/hash cycle. Legacy seeds remain inspectable historical evidence and are not accepted as v4-ready inputs.

The new research protocol digest must include material prompt and policy changes: schemas and bounds, brief segmentation, index assessment/repair, chunk and sweep order, extraction recovery, packet/coverage rules, synthesis success rules, writer instructions, and presentation policy. Bind the reviewed runtime source closure separately so a schema or code change cannot hide behind an unchanged prompt digest. All new sources, CI results, fixtures, and private control packages must identify the resulting runtime and protocol exactly. No model, role assignment, tool sandbox, service, tokenizer contract, sampling profile, or provider change is proposed here.

## 8. CPU verification and technical review

Tests must execute the changed production helpers and real serializer/runner paths where their behavior is at issue. Use invented, source-grounded fixtures; avoid tests that merely duplicate constants or infer semantic quality from a count.

| Area | Meaningful verification |
| --- | --- |
| Brief and plan | Exact text/span round trip; numbered and unstructured briefs; every unit assigned; omitted or unknown IDs repaired or rejected; full brief/questions in every extraction body. |
| Index | Missing/duplicate/unknown IDs, empty gist, title-only row, partial valid rows, truncation; initial inventory before repair; successful correction and bounded literal fallback with honest counts. |
| Source sweep | Planner omits a decisive synthetic source but the source is still read; source tails, UTF-8 boundaries and overlap cover every byte; mandatory work cannot be displaced by repairs. |
| Extraction | Out-of-chunk quote rejection; multi-question quote deduplication; missing dispositions and truncation recover within the ceiling; unresolved dispatch cannot replay; exhausted repair preserves failure. |
| Packet and synthesis | Cap exclusions stay visible; absence of extracted evidence does not become corpus absence; unknown citations and nonempty truncated synthesis cannot pass; complete second reply recovers; failed second reply remains failed. |
| Writer presentation | Exact full packet once in each of four serialized requests and after resume; ordinary/seeded/repair paths use identical packet bytes; source instructions stay untrusted; changed packet invalidates identity. |
| Admission | Presentation, request-body, and native-context excess refuse before dispatch without trimming; real serializer includes goal/tools/history/output reserve in the appropriate checks. |
| Seed and integration | Exact seven files, one-hop lineage, source/hash/protocol mismatch rejection; production-path mock research-to-writer run creates the required artifact and claims; preserved failure paths do not manufacture acceptance. |
| Content boundary | Invented conflicting/date-sensitive sources and misrouted or irrelevant quotes demonstrate that structural success alone cannot set final content acceptance. |

Run relevant unit/integration suites, strict TypeScript checks, required repository checks, and an independent review of the complete source/persisted-contract diff. Review source closure, cost/request accounting, actual writer handoff, historical preservation, and H5 isolation. CPU success demonstrates implementation behavior under those fixtures; it does not establish actual model coverage, native context fit, live artifact quality, or H4/H5 completion.

## 9. Explicit delta evidence before H4/H5

The historical sixteen-case qualification is not rerun automatically. Retain it as evidence for the old accepted source and API identity. A reviewed delta matrix must identify unchanged transport, tools, cache, cancellation, critic/judge, and performance dependencies and request bodies before reusing their historical evidence. Record where identities or bodies differ; do not claim unchanged speed or full new-runtime qualification by inheritance.

| Dependency | Current offline comparison | Required evidence before downstream use |
| --- | --- | --- |
| Model serializer, broker, native token admission, profiles | Source bytes unchanged against the preserved qualified checkout | Retain historical transport/schema evidence; require fresh API identity/readiness and native admission of each actual new request. |
| Sandbox, tool observation/progress policy, claims and local judge | Source bytes unchanged; research runner now additionally binds the complete initial evidence | Retain the original role/tool configuration; run the new handoff integration tests and actual H4 loops. Prior quote occurrence is not final semantic support. |
| Selection and repair drivers | Driver bytes unchanged; their seed loader and writer handoff change transitively | Require v2 seed validation and identical packet/presentation policy for both samples and repair; no legacy partial seed is reusable. |
| Research index, plan, extraction and synthesis | Protocol v4 and source-first requests change materially | Fresh full development-corpus stage evidence, complete ready packet and independent support/coverage review; no inherited F4–F7 success. |
| Writer input and resume | Goal remains separate; complete evidence becomes a retained initial message | Real-serializer and resume tests, actual native body/token proofs, timely draft and accepted final pilot content. |
| Throughput | Historical matched-workload measurements remain unchanged records | Do not assign their throughput to new research requests or claim a new hardware/performance qualification. |

Freeze a machine-readable source comparison and the actual runtime/protocol identities with the release. This matrix identifies which proof is reusable; it is not itself a release or live acceptance.

The research stages formerly exercised by F4–F7, seed contract, and writer presentation have changed. Validate them through one fresh, full development-corpus seed construction and one artifact pilot using the actual v4 production writer path. That integrated run must retain the real index, plan, extraction, synthesis, presentation, and native-admission evidence.

For this bounded development trial, compose the production `runResearchPipeline`, the shared production transfer/presentation validator, and a direct `GeneralAgentRunner` writer. Do not call `PrivateAgentSession` and assume that omitting a judge configuration disables judging: the current session runs entailment after submission and can use the writer model as its judge. The trial has no extra model-based entailment call; root and independent content reviews remain mandatory. Normal H4/H5 sessions retain their full judge path and existing phase allowances.

The controlled pipeline producer must retain actual stage receipts, source-job/freeze identity, packet hashes, and a real transfer snapshot. Give that producer an explicit v2 provenance kind recognized by the seed loader, with the same source/brief/budget checks and one-hop restriction. Do not forge historical session events or a completed session to make a pipeline-only seed loadable. The direct writer must use the shared production goal composition, model roles, files, checks, presentation, and request layout; a private alternate prompt does not demonstrate the intended H4/H5 handoff. Test both producer kinds and the real direct-runner bridge offline before live release. A separate four-stage live fixture is not implicitly authorized or required when the integrated stage evidence covers the same changed contracts. Synthetic tests alone and replaying the old seed cannot supply this delta acceptance.

A new accepted bridge must bind the original qualification, exact new source/protocol/presentation, full generated seed and coverage, actual completed pilot, independent trial review, root substantive-draft review, root final support/coverage review, and additive accounting. Keep draft presence/substance separate from final correctness. The first draft must arrive by the earlier of four completed writer turns or five minutes; final artifacts must satisfy the existing task and quality gates within twenty minutes and no more than 20,000 cumulative writer output tokens.

Only actual full acceptance admits the complete H4 research, deck, and split loops in their existing order. H4 and H5 must exercise the same newly pinned ordinary/seeded/repair presentation policy where research applies. Freeze the implementation and bridge rules before access to fresh H5 tasks. Do not import private-pilot presentation credit, development answers, or new gold information into H5.

Preserve all historical H4 attempts and global claims, the USD 0.60 all-history H4 split-calibration cap, and the existing Claude calibration/reconciliation requirements. H5 remains conditional on accepted H4 and usable calibrated split behavior: eighteen rows, USD 21.60 total, USD 3 per cloud row and USD 0.60 per split row. Preserve the original role assignments, scoring isolation, request/cost settlement, no-competing-usage requirement, cleanup, and stop-on-failure behavior. API-only targeting remains in force; this design does not reintroduce SSH, host disk, or physical-deployment gates.

## 10. Proposed live allocation and exact authority boundary

No unused slot remains in the original thirty-two-slot allowance. The proposed named amendment is **one v4 integrated research-and-writer trial**, with no automatic replacement:

| Bound | Proposed maximum |
| --- | ---: |
| Index calls, including corrections | 24 |
| Planning calls, including repair | 2 |
| Extraction calls, including follow-ups | 40 |
| Synthesis calls, including repair | 2 |
| Research phase total | 68 zero-fee model requests / 60 minutes |
| Writer phase total | 12 zero-fee model requests / 12 tools / 20 minutes |
| New standalone allowance | 80 zero-fee model requests |
| Preserved history plus new allowance | 32 + 80 = 112 slots maximum |

These are ceilings, not expected consumption or a minimum number of requests. All retries and corrections consume their named stage ceiling and the additive allocation. Research does not secretly run outside the trial budget or writer clock: it has its own explicit sixty-minute bound; the writer's twenty-minute/draft clocks begin at writer start. Unused research capacity does not enlarge writer or tool limits, and vice versa. The original thirty-two rows, claims, settled costs, and sole planned unknown remain immutable. New phase namespaces and once-only claims append to that history; they never reset it.

The latest approved admission cutoff remains **2026-11-05 10:00 UTC / November 5, 18:00 Asia/Shanghai**. This proposal does not extend it. Every model dispatch in the integrated development trial, including index corrections, planning repairs, extraction follow-ups, synthesis repairs, and writer requests, must occur before that cutoff. A phase starting earlier does not authorize a later dispatch. Preserve the separate existing H4-loop and H5-row admission/closure semantics and all phase wall-time bounds; do not infer a future window if approval or preparation misses the cutoff. All paid H4/H5 caps remain unchanged; this proposed development trial has zero fees and authorizes no extra paid call.

Before a live release, durably record one named owner amendment accepting the v4 runtime/protocol/presentation change, the new maximum eighty requests and sixty-/twenty-minute phase bounds, the additive 112-slot ceiling, the unchanged cutoff, and conditional H4/H5 sequence under existing caps. The owner record must bind the final reviewed implementation and delta-acceptance rules. Routine offline fixes within this design do not require another user decision; source review, tests, exact CI/source binding, fresh API readiness and native admission must still pass before execution.

Stop on the next failed live gate, exhausted stage, unsupported final deliverable, or unresolved outcome and retain its evidence. No additional probe, allowance transfer, automatic retry, post-review artifact edit, qualification rerun, service operation, paid expansion, or deadline extension is granted by this document. Until the named amendment and final release exist, all live work and downstream operators remain held.

References: BUILD_LOG BL-20261105-0357; `PHASE4_API_ONLY_ENDPOINT_CONTINUATION_V1.md`; `PHASE4_API_ONLY_PRELOADED_WRITER_PILOT_V1.md`; current research pipeline, seed, session, and runner source. Historical approved plan bytes and negative results remain unchanged.
