### BL-20261122-0742-e5-material-false-claim-rule -- 2026-11-22 -- Reject material factual errors before considering edit time

Status: `Implemented`

Scope or hypothesis: A proxy in the first ranked job detected a materially false assertion in a decoy and accepted it under the editing allowance. The owner directed a correction, fresh verification, then resumption in the existing customer order.

Decisions:
1. A material false claim requires rejection by every proxy judging role. Judge the supplied export against its evidence before estimating the cost of repair. Record the claim, evidentiary basis and significance; hold a contradictory judgment.
2. Pre-register a new private decoy and matched clean control. Use four fresh isolated sessions and the same rule. Require both defect judges to reject for the planted reason and both clean judges to accept. Only a fully verified pass authorizes resumption.
3. Preserve prior verdicts, chronological starts, weekly sampling, and the previous pause. Verification carries zero trial jobs.

Changes: E5 Amendment 1 points 4 and 5 and the active handoff register the rule and resumption gate. The shared Python judge supplies the prompt, structured response and consistency checks to all three judging roles.

Evidence: The owner requested that a material false claim be rejected even when quick to edit and authorized resumption after fresh verification. Four offline regression tests exercise all roles, quick repairs, clean controls and conflicting verdicts. BL-20261122-0542 records the earlier stop.

Failures or blockers: The original accepted decoy remains part of E5's record.

Limitations and non-claims: Authorization establishes the rule and gate. Live results and any subsequent trial starts require their own evidence.

Paid exposure: Reserve at most USD 8 for the four verification turns together, within the existing USD 300 envelope. At the owner's USD 0.04 per credit, GPT-6.2 Sol Standard uses 50, 2.5 and 250 credits per million input, cached input and output tokens on November 22.

Next gate: Pin the rule and private test materials, reconcile the day's available budget, and run the blinded check.

References: BL-20261122-0542-e5-first-ranked-job-and-counting-pause, BL-20261122-0533-e5-ranked-proxy-intake, E5 Amendment 1 points 4 to 8.
