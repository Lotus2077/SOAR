# Change-review calibration contracts

This directory contains the frozen routing-policy calibration inputs for
`change-review-eval-v1`. The manifest contains 12 real parent-to-commit changes
from three public repositories:

- 3 from [SOAR](https://github.com/Lotus2077/SOAR);
- 6 from [Flask](https://github.com/pallets/flask); and
- 3 from [pytest](https://github.com/pytest-dev/pytest).

Each record pins the public repository and commit metadata, materialization
protocol, host-acquired `ChangeSnapshotV1` and index identities, an exact
per-file projection of additions and deletions from that snapshot's admitted
hunks, complete review-risk facts, score, classification, and a
curator-assigned review attention label. All 12 records were materialized
through the bounded host Git acquisition path before the set was marked
`frozen`; none is a model-authored record.

The frozen line-count protocol is
`host_change_snapshot_admitted_hunks_v1`. It counts the same admitted hunk line
records as live `review-risk-v1`. Git numstat remains part of host discovery,
view reconciliation, and the snapshot discovery identity, but it is not an
independent source of frozen routing line counts. This matters for content such
as bare-CR text, where Git numstat and SOAR's admitted hunk semantics can count
lines differently.

## What frozen means

`calibration-v1.json` is a byte-stable 12-change manifest.
`protocol-v1.json` pins its SHA-256, the `review-risk-v1` weights and threshold,
the acquisition limits and diff-engine version, and the later evaluation and
reporting contracts. Strict schemas reject pending records, incomplete
acquisition, inconsistent derived facts or scores, and unknown fields.

Frozen does not mean held out, defect-labeled, representative of all code
changes, or evidence of review quality. The curator labels express only how much
independent review attention the scope merited. They are not claims that a
revision is correct, faulty, clean, valuable, or production-ready.

The frozen policy classifies 5 changes as low risk and 7 as high risk. Its
threshold-derived attention agrees with the curator on 11 of 12 changes. The
retained disagreement is `cal-010-pytest-source-line-memoization`: the policy
scores it 2 (low risk), while the curator marks its cache-semantics change for
heightened attention. This is calibration evidence for the routing policy, not
defect recall, precision, or accuracy.

## Offline checks used by CI

The ordinary unit test reads only checked-in files. It performs no clone,
network request, provider call, or inference. It verifies:

- strict calibration and protocol schemas;
- the protocol-to-manifest SHA-256 binding;
- 12 complete, verified acquisitions across the expected three repositories;
- derived risk arithmetic, the 5/7 split, and the retained `cal-010`
  disagreement;
- rejection of pending-state, score, and hidden-evaluator-field tampering; and
- structural absence of held-out identities, gold, or oracle files.

Run that default proof with:

```sh
pnpm exec vitest run tests/unit/change-review-calibration.test.ts
```

The historical Git reproduction case is skipped unless all three explicit
local-repository variables below are present. Therefore the default CI proof
does not claim that the pinned commits were rematerialized during that CI run.

## Opt-in full materialization

First prepare full local clones containing every pinned object. Clone and fetch
operations are deliberately outside the test so a test run cannot silently use
the network. Then provide absolute paths to the three clones:

```sh
SOAR_CALIBRATION_SOAR_REPO=/absolute/path/to/SOAR \
SOAR_CALIBRATION_FLASK_REPO=/absolute/path/to/flask \
SOAR_CALIBRATION_PYTEST_REPO=/absolute/path/to/pytest \
pnpm exec vitest run tests/unit/change-review-calibration.test.ts
```

The opt-in case verifies all 12 commit objects and direct-parent pins, commit
metadata, binary full-index patch application, host-acquired snapshot and index
identities, exact snapshot-hunk source projections, and complete risk facts,
scores, and classifications. It uses local Git data and the local host tool
only: provider cost is $0 and no model is called. A successful reproduction
proves those contracts for the supplied local clones and current
implementation; it still does not measure model quality or routing benefit.

## Held-out boundary

The final evaluation set is separate from this calibration set. Its fixture
identities and evaluator gold remain sealed outside the agent workspace. Do not
add defect oracles, expected findings, adjudication records, provider outputs,
or generated evaluation databases to this directory. The protocol describes
the held-out minimums and metrics without revealing the fixtures or gold.
