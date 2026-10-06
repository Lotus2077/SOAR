# Experiments

This folder holds the committed, sanitized record of live trials (see
[PLAN.md](../PLAN.md) section 4):

- `registry.jsonl`: one JSON object per run.
- `serving-card-*.md`: measured behaviour of the inference endpoint.
- Experiment cards, one per batch: hypothesis, arms, budget, decision rule and stop
  rule.

The following stay outside Git, under the ignored `.soar/experiments/`:

- raw outputs, traces and databases;
- task gold data and endpoints;
- anything derived from personal or professional data.

## Registry row

| Field | Meaning |
| --- | --- |
| `id` | Unique run id, for example `p0d-t1-website-heavy` |
| `date` | UTC date |
| `git` | Commit the run executed |
| `batch` | Experiment card or batch name |
| `task` | Task id; `taskJobSha256` binds the exact inputs |
| `family` | research, document_review, website, deck, admin, coding or audit |
| `exposure` | `fresh` (never seen by any run or prompt tuning) or `exposed` |
| `arm` | Route and profile, for example `local-standard` or `local-heavy` |
| `profile`, `thinking`, `maxOutputTokens` | Coordinator profile the run was frozen with |
| `modelCalls`, `toolCalls`, `wallSeconds` | Counts from the run's own ledger |
| `inputTokens`, `outputTokens`, `lengthStops`, `usd` | Accounting (`usd` is API fees only; local is zero-fee); `lengthStops` counts replies cut at the output limit |
| `entailment` | Research tasks with a claims ledger: the host's entailment counts, `entailmentCalls`, `truncated` and `supportRate` (supported / judged claims), or `null`; a local-model judgement is evidence, not acceptance |
| `unknownDispatches` | Unsettled dispatches (never replayed) |
| `outcome` | `accepted`, `rejected`, `incomplete` or `infra_invalid` |
| `terminalCause` | Why the run ended, for example `submitted`, `session_deadline`, `request_body_size_exceeded` |
| `criticalChecks` | Pre-written critical checks passed / total, or `null` |
| `verdictBy` | `owner`, `agent_diagnostic` or `none` |
| `ownerMinutes`, `interventions` | Owner effort (owner-run jobs only) |
| `lesson` | One line |

Rows are append-only. Correct a row by appending a new row with `supersedes`.
