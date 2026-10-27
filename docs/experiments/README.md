# Experiments

This folder holds the committed, sanitized record of live trials (see
[PLAN.md](../PLAN.md) section 4):

- `registry.jsonl`: one JSON object per run.
- `serving-card-*.md`: measured behaviour of the inference endpoint.
- Experiment cards, one per batch: hypothesis, arms, budget, decision rule and stop
  rule.
- `phase2-tasks-v1.json`: the hashes-only manifest of the frozen Phase 2 tasks (task
  ids, families, driver modes, job, brief, input and gold-file SHA-256 values, check
  counts). The tasks, gold, hidden suites and scorer stay under the ignored `.soar/`.
- `phase4-tasks-v1.json`: the hashes-only manifest of the three fresh Phase 4 research
  tasks for H5 (same fields, plus the scorer and checks versions), authored by a separate
  session; tasks, gold and scorer stay under the ignored `.soar/experiments/phase4-v1/`.

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
| `inputTokens`, `outputTokens`, `cachedTokens`, `cacheWriteTokens`, `lengthStops`, `usd` | Accounting (`usd` is API fees only; local is zero-fee); `cachedTokens` is the part of `inputTokens` the provider reported as served from its prompt cache (summed `cacheReadTokens`, 0 when absent; rows before H1 omit the field); `lengthStops` counts replies cut at the output limit; `cacheWriteTokens` is the part of `inputTokens` the provider reported as newly written to its cache (summed `cacheWriteTokens`, billed at the write rate); 0 means the run did not record it, which is every run before BL-20261022-1156 including the H1 first attempt, not a measured zero |
| `entailment` | Research tasks with a claims ledger: the host's entailment counts, `entailmentCalls`, `truncated` and `supportRate` (supported / judged claims), or `null`; a local-model judgement is evidence, not acceptance |
| `unknownDispatches` | Unsettled dispatches (never replayed) |
| `outcome` | `accepted`, `rejected`, `incomplete` or `infra_invalid` |
| `terminalCause` | Why the run ended, for example `submitted`, `session_deadline`, `request_body_size_exceeded` |
| `criticalChecks` | Pre-written critical checks passed / total, or `null` |
| `verdictBy` | `owner`, `agent_diagnostic` or `none` |
| `ownerMinutes`, `interventions` | Owner effort (owner-run jobs only) |
| `lesson` | One line |
| `loop` | H4 select-and-repair loop rows only (`scripts/phase4-loop.ts`, `registry-row.py --loop-dir`): `version`, `rule` (the selection protocol version), `samples`, `repaired`, `seeded` (whether sample `b` and the repair wrote from sample `a`'s evidence packet), `stage1` (the sample the host-checked selection chose), `selected` (the loop's deliverable: `a`, `b` or `repair`), `step` (the rule step that decided it), `critiqued` and `critiqueFailure`, `writeIdentityEqual` (whether the two samples' write phases carried the same identity) and `candidates` (every sample's own `status` and `terminalCause`, so the harness-terminal rate is computed per sample). The row's counts sum the loop's runs plus the critique's one call (from `critique.json`, or `critique-failure.json` when the critic answered and the tool refused the reply), `wallSeconds` spans the loop from its earliest start to its latest end over its runs, and status, cause, binding and entailment are the selected run's; the all-cloud arm has no loop and no such field |

Rows are append-only. Correct a row by appending a new row with `supersedes`.
