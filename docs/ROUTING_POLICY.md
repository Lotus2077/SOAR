# MVP routing policy

## Decision

SOAR will plan globally and assign provisionally. It will not run a full model-selection decision after every session event, and it will not bind the entire episode to providers before execution.

Current implementation boundary: `checkpoint-router-v0` implements only
`session_start`, `evidence_complete`, and eligible `provider_failure`
checkpoints in an explicit two-fake-provider v2 test/runtime path. Production
Repository Investigator remains v1 local-only. Production Review Current
Changes creates a v2 `local_only_v1` session, assigns the configured local
provider at `session_start`, records an `evidence_complete` decision, and keeps
the same provider lease through synthesis. It has no provider-failure fallback
or separately configured cloud provider. PR6A adds only a locked metadata
candidate, setup-only Keychain lifecycle, and pure egress shadow guard; none is
a selectable route or scheduler input. The broader invalidation triggers and
profiles below are product policy, not shipped scheduler behavior.

The target policy persists every event and applies cheap deterministic guards
for permissions, budget, deadline, context size, and provider health. A full
routing decision would run only at the start, meaningful phase boundaries, or
when evidence invalidates the current assignment. The production local review
currently evaluates its fixed route at session start and evidence completion;
ordinary tool progress does not invoke a general scheduler.

Each work node receives a model lease. A valid lease keeps the same model across a progressing tool or edit loop, preserving context affinity and avoiding unnecessary switching. A lease is reconsidered when:

- a phase or task node completes;
- reconnaissance changes the estimated difficulty or scope;
- two attempts produce no new verified progress;
- tests keep failing without narrowing the cause;
- research evidence conflicts or remains incomplete;
- a required capability, risk level, budget, deadline, or provider-health condition changes;
- an irreversible action or final verification is approaching.

One transient error or one successful routine tool call does not trigger rerouting.

## Shared state

Providers share the canonical observable record: user messages, plans, artifacts, tool calls and results, verified facts, citations, decisions, and compacted summaries. They do not share hidden reasoning, KV caches, or provider-native session state.

When switching models, SOAR generates a structured handoff containing the objective, constraints, verified facts, side effects already performed, artifacts, validator results, unresolved questions, and next action. Earlier model output is labeled as untrusted unless a validator confirmed it.

## Research phases

```text
intake -> decompose -> retrieve -> extract -> reconcile -> synthesize -> citation audit
```

Local defaults: query variants, extraction, deduplication, table normalization, and bulk workers. Cloud candidates: difficult decomposition, conflict resolution, gap analysis, and final synthesis. Mandatory checkpoints occur after the first retrieval batch and before final synthesis.

## Coding phases

```text
intake -> inspect and baseline -> diagnose and plan -> edit -> test and repair -> review
```

Local defaults: repository inventory, search, formatting, test execution, log reduction, and narrow reversible edits. Cloud candidates: ambiguous root causes, architecture, cross-module changes, security-sensitive work, and persistent repair failures. A mandatory checkpoint occurs after repository inspection.

## Initial deterministic profiles

| Profile | Default behavior |
| --- | --- |
| Quality | Cloud for difficult planning and critical synthesis; local for bulk work; strongest verification. |
| Balanced | Local reconnaissance, then evidence-based escalation and selective cloud synthesis. |
| Economy | Local by default; cloud only after explicit failure, risk, or capability triggers. |
| Fast | Choose the provider most likely to finish before the deadline; avoid slow cascades. |

Learned checkpoint routing can replace thresholds only after SOAR has enough complete, evaluator-backed trajectories. Per-turn reinforcement learning is outside the first MVP.

PR6A being Verified does not make a cloud candidate eligible for a
lease. Provider validation, immediately-pre-dispatch egress admission, explicit
Hybrid authority, and any paid canary remain unapproved PR6B work.
