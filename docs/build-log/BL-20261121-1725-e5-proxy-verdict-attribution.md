### BL-20261121-1725-e5-proxy-verdict-attribution -- 2026-11-21 -- The registry records the E5 proxy's verdict and estimated effort

Status: `Implemented`

Scope or hypothesis: E5 Amendment 1, points 4, 5 and 9, distinguish the proxy that judged its task, the owner's own verdicts and the blind sample.

Decisions:
1. The operator can identify a submitted, plain local Heavy version 1 desktop receipt as `proxy_agent` in `proxy-real-jobs`. The row carries estimated `proxyMinutes`, null `ownerMinutes` and the receipt's interventions.
2. A blind grade is recorded in the closed-format lesson. A later grade supersedes the original row while retaining its proxy verdict, effort, job identity and verdict time.

Changes: scripts/registry-row.py, tests/unit/registry-row-verdict.test.ts and docs/experiments/README.md.

Evidence: All ten focused CLI tests passed with synthetic receipts, including acceptance, rejection, a disagreeing blind grade, a later annotation and refusals for mixed attribution. The full `pnpm check` passed with 4,163 tests passing and 88 skipped. Light review found a missing refusal for public-source entailment data, now covered by a regression.

Failures or blockers: None in the receipt writer.

Limitations and non-claims: The operator supplies the actor and source provenance. The receipt cannot establish who dispatched the task or prove a week's eligibility. No rehearsal, counted job or registry append took place.

Paid exposure: USD 0. Zero model requests for verification.

Next gate: Integrate the writer with the isolated proxy workflow and run the synthetic rehearsal required by Amendment 1.

References: BL-20261121-1701-owner-e5-proxy-job-choices; BL-20261121-1705-e5-card-amendment-1-proxy-jobs; docs/experiments/e5-card-2026-11-17.md.
