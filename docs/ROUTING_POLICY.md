# MVP routing policy

## Decision

SOAR will plan globally and assign provisionally. It will not run a full model-selection decision after every session event, and it will not bind the entire episode to providers before execution.

Current implementation boundary: `checkpoint-router-v0` implements
`session_start`, `evidence_complete`, and one eligible `provider_failure`
checkpoint in PR6B0's explicitly enabled two-fake-provider Hybrid simulation.
That app-visible development/test path assigns Fake Local inspection, chooses
Fake Local or Fake Cloud synthesis from host-owned facts, and may assign one
Fake Local fallback. Routine evidence work retains its lease. PR6B0 is
Implemented locally, not Verified or Released.

Normal vLLM Repository Investigator remains v1 Local-only. Normal vLLM Review
Current Changes creates a v2 `local_only_v1` session, assigns the configured
Local provider at `session_start`, records an `evidence_complete` decision, and
keeps the same provider lease through synthesis. It has no provider-failure
fallback or separately configured cloud provider, and Hybrid remains visibly
locked. PR6A's metadata candidate, setup-only Keychain lifecycle, and normal-
mode egress shadow are not selectable routes or scheduler inputs. The broader
invalidation triggers and profiles below are product policy, not shipped
scheduler behavior.

The target policy persists every event and applies cheap deterministic guards
for permissions, budget, deadline, context size, and provider health. A full
routing decision would run only at the start, meaningful phase boundaries, or
when evidence invalidates the current assignment. Normal Local review currently
evaluates its fixed route at session start and evidence completion; PR6B0
simulation additionally evaluates one eligible fake-provider failure. Ordinary
tool progress does not invoke a general scheduler in either path.

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

PR6A being Verified and PR6B0 having automated exact-SHA closure do not make a real cloud
candidate eligible for a lease. The Fake Cloud lease has no credential,
endpoint, network client, or actual-spend authority. Signed credential leasing,
real provider validation, wire-bound external egress admission, explicit real
Hybrid authority, and any paid canary remain separately unapproved PR6B1 through
PR6B3 work. Manual VoiceOver, light/dark contrast, and reduced-motion proof for
the simulation UI also remains pending, so PR6B0 is not Verified or Released.
