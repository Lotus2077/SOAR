### BL-20261121-0640-desktop-review-record-and-route -- 2026-11-21 -- 13b.1: a document review is a task (record version 5) on the driver's review-1 route, under the owner's Tier O waiver: one change to the broker's trust rule, scoped to review tasks

Status: `Implemented`

Scope or hypothesis: Part 1 of 13b (BL-20261120-0646-desktop-document-review-13b-design), with the owner's answers (BL-20261121-0611-owner-e5-proxy-jobs-and-13b-answers, decisions 2 to 4). Exports, the view, the folder on either flag, the adapters and the e2e are later parts. The pull request's description holds the detail.

Decisions:
1. **Persisted contracts change.** Record version 5 holds `review: { route: "local_beta", transport: "owner_waived" }`: heavy, with no URLs, consultation, research or `wallMs`, and the identity needs the flag. A review's verdict receipt is version 2, which adds `transport` and has the arm `local-heavy-review1`. registry-row.py accepts version 2 for that arm alone and keeps `transport` on the row; every other receipt stays version 1.
2. **A change to the broker's trust rule, scoped to review tasks** (decision 2 of BL-20261121-0611). A review's destination alone admits private data; every other destination stays synthetic-only, the research beta's and E5's included. A new field, `ownerWaivedTransport`, lets that destination alone use plain HTTP. Only the review route's code sets it, the broker refuses it on any other destination with its own code, and every other destination still needs HTTPS.
3. **No synthetic claim and no raw text.** A review carries no public-or-synthetic declaration, its attestation records `false`, and its session gets no synthetic approval. Its contexts are therefore private, with hashes-only diagnostics.
4. **The route.** The flag `SOAR_ENABLE_DOCUMENT_REVIEW_BETA` is off by default, and masked outside the beta folder until part 4. A review takes exactly one .docx, heavy and local only, into a fixed `review-summary.md`; its phase is the driver's `withDocumentReview` unchanged. The availability text says the document goes in full to the owner's endpoint over plain HTTP, by the waiver, with no privacy protection.

Changes: src/main/private-agent/broker.ts; src/main/general-tasks/controller.ts and review-route.ts (new); src/main/config.ts; src/main/user-data-folder.ts; src/shared/general-task-contracts.ts; scripts/registry-row.py; tests/unit/private-agent-broker-transport-waiver.test.ts and desktop-review-route.test.ts (new), general-task-controller.test.ts, registry-row-verdict.test.ts, config.test.ts and user-data-folder.test.ts; this entry.

Evidence: On main 2e83fd5 plus this change, typecheck passes, and the full `pnpm test` passes (4,137 tests, 88 skipped, none failed). 39 mutants were each killed once a missing test case was added; they cover the broker's waiver, the controller's destination, approval, attestation, record, identity, create checks and receipt, the route, the schema, the folder masking and registry-row.py's version 2. The missing case, a destination both synthetic-only and admitting private data, closed the one early survivor. The source freeze moves from 86732c63… to 139d012c…, through config.ts and broker.ts. No window, Docker, model endpoint or network was used.

Failures or blockers: None.

Limitations and non-claims: Nothing ran in a window or against a real model; the review's requests reached a loopback endpoint only. broker.ts and config.ts are in the headless driver's source freeze, so the freeze moves; no E-run window is open. With the waiver, nothing here protects a private document: it reaches the owner's endpoint over plain HTTP, on a machine SOAR does not check.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: The coordinating session's light review, plus a skeptic pass on the broker change alone, then its merge on green CI. Then part 2, exports.

References: BL-20261120-0646-desktop-document-review-13b-design; BL-20261121-0611-owner-e5-proxy-jobs-and-13b-answers; BL-20261118-0438-desktop-local-research-13a-design; BL-20261120-0233-e6-result.
