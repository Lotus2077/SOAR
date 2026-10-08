# Documentation index

Files stay where they are, because the append-only build log links to them. This
index says which documents currently govern the project and which are historical
evidence. Historical documents describe their own versions; their "next steps" are
not active requirements.

## Current

| Document | Role |
| --- | --- |
| [PLAN.md](PLAN.md) | The single living plan: phases, decision rules, envelope, owner decisions |
| [plans/PRIVATE_WORK_DESIGN_V1.md](plans/PRIVATE_WORK_DESIGN_V1.md) | Private-work design (Proposed): strict privacy profile, admin assistant, research and document review, device |
| [PROJECT_REVIEW_2026-09-28.md](PROJECT_REVIEW_2026-09-28.md) | Verified whole-project review behind the plan |
| [BUILD_LOG.md](BUILD_LOG.md) | Append-only decision and evidence ledger |
| [HANDOFF.md](HANDOFF.md) | Code map and operational boundaries of the general-task runtime (September state) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Runtime architecture, including legacy paths |
| [MVP_GENERAL_CONSULTANT_SETUP.md](MVP_GENERAL_CONSULTANT_SETUP.md) | Consultant environment setup |
| [MVP_CODING_QUICKSTART.md](MVP_CODING_QUICKSTART.md) | Coding pilot quickstart |
| [PRIVACY_FILTER_RESEARCH.md](PRIVACY_FILTER_RESEARCH.md) | Local privacy-filter assessment (advisory only) |

## Superseded plans and audits

These are kept as history; each was superseded as noted.

- [plans/MVP_PRIVACY_FIRST_AGENT_V1.md](plans/MVP_PRIVACY_FIRST_AGENT_V1.md) (September 11).
  Its goal and trusted-boundary rules still stand. Its Stage B/C/D ladder was
  superseded by PLAN.md on 2026-09-29.
- [plans/MVP_PRIVATE_AGENT_EXECUTION_V1.md](plans/MVP_PRIVATE_AGENT_EXECUTION_V1.md).
  Its execution bounds were superseded by PLAN.md.
- [MVP_COMPLETION_AUDIT.md](MVP_COMPLETION_AUDIT.md) and
  [MVP_READINESS.md](MVP_READINESS.md). These are September 14 audits and the
  readiness history.
- [ROUTING_POLICY.md](ROUTING_POLICY.md) and
  [ROUTING_POLICY_RESEARCH.md](ROUTING_POLICY_RESEARCH.md). These are routing
  history; savings no longer drives design.
- Every other file in [plans/](plans/) is a per-experiment plan from
  August 29 to September 14 (router era, coding pilot, routing, private-agent
  milestones). [adr/](adr/) holds the legacy architecture decisions.

## Experiment reports, September 7-14

The `MVP_*_REPORT.md` files, plus [LOCAL_CAPABILITY_DIAGNOSIS.md](LOCAL_CAPABILITY_DIAGNOSIS.md),
[NATIVE_LOCAL_CALIBRATION.md](NATIVE_LOCAL_CALIBRATION.md) and
[MVP_COMPARISON_SCREEN.md](MVP_COMPARISON_SCREEN.md), are evidence for specific
runs. Each result holds only under the configuration it states. Every
general-task result used the thinking-off, 4,096-token profile.

## History

- [history/README-2026-09-28.md](history/README-2026-09-28.md) is the detailed
  README from before the September 28 cleanup.
- Code removed in that cleanup (the PR6R development canary, the held-out
  evaluator and `run-session-v2`) is kept at tag `archive/router-era-2026-09-28`.

## New documents

Per [PLAN.md](PLAN.md) section 4, don't add a plan and a report for each trial:

- For each batch, add one experiment card.
- Add a registry row for each run.
- Add a build-log entry only for a decision class.
