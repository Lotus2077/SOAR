# ADR 0003: Immutable Change Acquisition v1

- Status: Accepted for the PR 3 foundation; no app/model integration
- Date: 2026-08-29
- Plan: `hybrid-lease-router-v0-plan-2`
- Scope: host-only Git acquisition, immutable review evidence/coverage
  contracts, and risk calibration

## Context

Review Current Changes must not let a provider define which changes exist,
execute arbitrary Git commands, or claim complete evidence after the workspace
has changed. A review also needs stable references to both deleted/base lines
and added/working lines. The existing Repository Investigator tools expose
bounded reads and searches to the model, but they do not define one immutable
base-to-working change identity.

PR 3 is a `$0` prerequisite. It must establish the host authority and frozen
routing inputs before PR 4 implements a pure router and before PR 5 adds an app
workflow. It must not create a model-facing review flow or make a provider call.

## Decision

### Host-only authority

`inspect_git_changes` is registered with audience
`host_change_acquisition_v1`, separate from the provider-visible
`repository_agent_v1` registry. It is absent from
`MODEL_TOOL_DEFINITIONS`; the model gateway rejects a provider call that names
it. The current preload and IPC contracts expose no change-review entry point.

Its request has one strict discriminator:

```ts
interface InspectGitChangesRequestV1 {
  schemaVersion: "inspect-git-changes-v1";
}
```

There is no model-selected path, revision, command, or Git argument. The host
supplies the already selected canonical workspace root.

### Acquisition and identity

The inspector requires a POSIX Git worktree with a committed `HEAD`, and the
selected workspace must be its canonical top level. Unborn repositories,
unmerged index stages, unsupported modes, inconsistent Git views, and non-root
workspace selections fail closed.

Git supplies five NUL-delimited discovery views: index stage, index visibility,
porcelain-v2 status, base-to-working raw diff, and numstat. The host parser
requires status, raw, and numstat to agree through multiplicity-preserving,
unambiguous nullable old/new path identities; rename sides and duplicate records
cannot collapse into an ordinary path. It covers staged, unstaged, renamed,
deleted, and bounded untracked changes. A pinned host diff library constructs
textual hunks from captured base blobs and bounded direct working-file reads;
Git diff drivers never produce admitted hunk text.

`ChangeSnapshotV1` binds:

- the captured base commit OID;
- `indexSha256`, derived from canonical stage-zero index entries (or exact raw
  index-stage bytes when an unsafe path cannot enter the decoded contract);
- `discoverySha256`, derived from the base OID and hashes of all exact Git
  discovery bytes, including index visibility and entries omitted from the
  bounded manifest;
- a deterministic manifest of change state, old/new path, mode, size,
  admitted-content hash, omission codes, and side-aware textual hunks; and
- omitted path/hunk counts and aggregate omission codes.

Every hunk ID and `snapshotId` is SHA-256 over a canonical JSON preimage that
does not include its own ID. The host recomputes identities at trust boundaries.
The `InspectGitChangesResultV1` evidence map must be the exact sorted projection
of every admitted hunk's base/working lines.

Acquisition has these hard bounds:

| Boundary | Limit |
| --- | ---: |
| Changed paths admitted | 200 |
| Source bytes per file side | 256 KiB |
| Total admitted source | 4 MiB |
| Hunks per snapshot | 200 |
| Hunk lines per snapshot contract | 20,000 |
| Host result | 192 KiB |
| Overall inspection | 20 seconds |
| One Git subprocess | 5 seconds |
| Git stdout / stderr | 4 MiB / 64 KiB |
| Process termination grace | 500 ms |

If the result-size limit is reached, trailing hunk evidence is removed
deterministically and marked truncated. If no bounded valid result can fit, the
operation fails. Cancellation terminates the detached POSIX process group,
waits the bounded grace, and then sends a kill signal.

The inspector captures discovery before and after content admission. It also
checks the canonical index-file fingerprint around each discovery pass and
reopens every admitted working file to compare its no-follow filesystem
fingerprint, mode, size, content identity, and omission state. Any observed
change fails as `WORKSPACE_DRIFT`. If the 192 KiB host result would overflow,
it deterministically removes trailing hunks and then trailing manifest entries,
records the corresponding omissions, and retains the full discovery digest.

`verifyChangeSnapshot` first recomputes the supplied immutable identity. A
snapshot with any path, hunk, or manifest-entry omission cannot pass freshness
validation. Otherwise the host performs a new acquisition and accepts only the
same `snapshotId`. PR 5 must use this acceptance/display gate; PR 3 does not
yet call it from a session.

### Omitted and non-text state

Binary, symlink, submodule, unreadable, oversized, sensitive/ignored, unsafe,
total-byte-limited, file-count-limited, hunk-limited, truncated, and simultaneous
staged-plus-unstaged state uses explicit bounded omission codes. The v1 manifest
binds base and final-working sides but not a separately admitted index-content
side, so a path changed in both the index and worktree is represented and
explicitly incomplete rather than presented as full three-state review
evidence. This includes staged additions deleted again, staged deletions
recreated in place, and staged rename reversals or destination deletions; each
is normalized to one honest final base-to-working record. Changed admitted text
cannot have zero hunks unless hunk evidence was explicitly truncated or
hunk-limited.

Working files are opened with `O_NOFOLLOW`, and symlink contents are never
admitted. Submodule processes and nested worktrees are never entered. Because
nested dirtiness is not acquired, the presence of any gitlink in the index
conservatively marks the whole manifest incomplete. Missing objects in a
partial clone fail; they are not fetched.

### Git process isolation and residual trust

The runner exposes semantic operations rather than a raw argument API. It uses
an absolute Git executable, argument arrays, `shell: false`, fixed commands,
fixed configuration overrides, bounded output, and sanitized errors. It never
inherits `process.env`; global/system Git config, prompting, pagers, optional
locks, replacement objects, lazy fetch, hooks, fsmonitor, untracked cache,
external diff, textconv, submodule recursion, and user-selected protocols are
disabled. Fixed overrides require file-mode and stat checking. One discovery
bundle uses a stable, no-follow copy of the canonical index in a private
temporary directory; it preserves the source index timestamp, validates stage
and visibility semantics after Git runs, and is removed after success, error,
or cancellation. The canonical index's bytes, inode, and timestamps are checked
unchanged. Split indexes and nonbaseline assume-unchanged/skip-worktree flags
are unsupported and fail closed. `cat-file` accepts only full object IDs
previously observed by that runner.

Status and diff can still consult repository/worktree configuration. Before
each worktree-sensitive operation, the runner inspects the effective local
configuration (including its includes) and rejects clean/process filters or
protocol overrides. The runner serializes these check/operation pairs against
its own calls.

This is not an atomic sandbox. Git exposes no read lock spanning the config
preflight process and the subsequent status/diff process. An external actor
with concurrent write control of repository configuration can alter it during
that gap. The selected repository is therefore trusted not to be concurrently
hostile. This repository-config TOCTOU limitation is explicit and remains open.

### Review evidence and coverage

`ReviewEvidenceSetV1` binds one snapshot ID to sorted retained hunk hashes,
complete changed bodies, and bounded repository observations. Its
`evidenceSetId` is a canonical SHA-256 identity. Structured references support:

- one base or working line in a specific admitted hunk;
- snapshot-bound metadata for a change with no content hunk; and
- one full-file or matched-line repository observation bound to its evidence
  set and content hash.

Host admission first rehashes the snapshot and evidence set, then verifies the
reference's IDs, side, path, line, hunk, or observation membership. Shared
shape-only helpers are not acceptance APIs. A metadata reference is admitted
only when that manifest entry has no content hunk; PR 5 still owns the host and
evaluator policy that decides whether metadata alone semantically supports a
particular finding.

The PR 3 evidence-set canonicalizer validates and hashes observation-shaped
records. It does **not** prove that a repository observation came from a
successful canonical gateway event. PR 5 must derive and validate those
records from persisted tool events before it can accept a review. Until then,
repository-observation provenance is unimplemented.

`ReviewCoverageV1` records manifest completeness, admitted/omitted path and
hunk counts, every changed file's full-read and retained-body/hunk state,
changed test paths, runtime-code-without-changed-test, final-packet evidence
retention, snapshot revalidation, and omission codes. Only the host derives the
record. Replay verification recomputes it exactly from rehashed snapshot and
evidence records plus the two host gate facts. A caller cannot promote coverage
by supplying a forged `complete` field. Complete-body records are admissible
only for required added, deleted, or untracked sides; modified, renamed, and
type-changed files require a matching full-read observation. Both rename sides
participate in changed-test and runtime-without-test derivation.

### Frozen risk calibration

`change-review-eval-v1` freezes 12 real parent-to-commit public changes: 3 from
SOAR, 6 from Flask, and 3 from pytest. Every record pins its source revision,
complete host-acquired snapshot/index/discovery identities, an exact per-file
projection from its admitted snapshot hunks, mechanical risk facts, score,
classification, and independent curator review-attention label. The frozen
`host_change_snapshot_admitted_hunks_v1` protocol derives additions and
deletions from the same hunk records as live risk. Git numstat remains bound
discovery and reconciliation evidence, not an independent routing-line source.

`review-risk-v1` has a threshold of 3 and these additive signals:

| Signal | Weight |
| --- | ---: |
| At least 8 changed paths | 1 |
| At least 300 changed lines | 1 |
| Crosses at least 3 code surfaces | 2 |
| Runtime code changed without a relevant changed test | 2 |
| Touches a sensitive path | 2 |

For renames, both the old and new paths contribute to surface, runtime, test,
and sensitive-path facts. Moving runtime code into a non-runtime directory
therefore cannot erase the risk carried by the old side.

Incomplete acquisition is classified `incomplete` and is never given a
low/high score. Among the 12 complete frozen records, 5 are low risk and 7 are
high risk. Threshold-derived attention agrees with the curator on 11 records.
`cal-010-pytest-source-line-memoization` deliberately remains the one visible
disagreement: its mechanical score is 2/low while its cache-semantics scope is
labeled for heightened attention.

The labels mean review attention only. They are not defect labels, correctness
judgments, evaluator gold, or a quality measure. Offline tests verify the
checked-in schemas, manifest hash, arithmetic, split, disagreement, and absence
of held-out identities. An opt-in test can rematerialize all 12 revisions from
three explicit local clones. It does not clone, fetch, or invoke a provider.

## Consequences

- PR 4 can consume a deterministic, frozen risk result at an
  evidence-complete routing checkpoint without trusting a model to inventory
  the diff.
- PR 5 can build structured review acceptance on immutable side-aware evidence,
  but must add canonical-event provenance, `ReviewResultV1`, final-packet
  retention, snapshot revalidation, and the app/model workflow.
- Large, binary, submodule, unavailable, or drifting changes degrade to an
  explicit incomplete state instead of an unqualified clean result.
- The checked-in app still runs `agentic-execution-v1` with one local provider.
  No dynamic route, model-facing review, production cloud provider, credential,
  or paid call is introduced by this decision.
- The 12-change calibration is routing-policy calibration only. With no sealed
  held-out gold in the repository and no provider comparison, it proves no
  review quality, cost saving, latency improvement, or routing optimality.

## Verification boundary

Deterministic tests cover contract strictness and identity tampering; coverage
rederivation; Git command allow-listing, environment isolation, object
authorization, output/timeout/cancellation behavior, and hostile configured
diff/textconv/filter/fsmonitor/pager behavior; parsing; no-follow reads; staged,
unstaged, rename, delete, untracked, binary, symlink, submodule, size, drift,
unborn, unmerged, and non-root cases; model/host registry separation; risk
arithmetic; and frozen calibration integrity.

Those tests do not close the external repository-config TOCTOU window, prove
repository-observation gateway provenance, rematerialize public history unless
the opt-in clone paths are supplied, or demonstrate a successful review or
provider route.
