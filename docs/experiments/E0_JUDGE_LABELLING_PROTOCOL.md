# E0 judge fixture: labelling protocol (`e0-judge-labelling-v1`)

Status: `Implemented` with the fixture (`scripts/judge-fixture.ts`); not yet run. The E0
card ([#47](https://github.com/Lotus2077/SOAR/issues/47), item 2) fixes the per-class
minimum, the agreement measure and level, the conditions and the repeats before the
fixture runs.

## Why the claim set needs a protocol

Criteria 3 and 8 of the review's quality bar (docs/PROJECT_REVIEW_2026-11-05.md §2.2)
become thresholds only if E0's judge fixture reaches the agreement level the E0 card
sets. The judge is the entailment pass in `src/main/private-agent/claims.ts`: one
thinking-off call per verified claim, with four verdicts.

The fixture measures that pass against labels a separate session assigns. A measurement
is only as good as its labels and its mix of claims. Real claims are mostly supported
(the split runs' entailment counts were 33 supported + 6 partial of 40, and 29 + 7 of
39), so the protocol plants negatives until every class reaches the card's minimum.

## Roles

- **Harvester** (any session): collects the claims from exposed runs. Only public or
  synthetic runs qualify; never a run on labelled or private data.
- **Labeller** (a separate session): labels every claim and plants negatives.
  - It must not see any judge verdict on these claims: no `claims_entailment` events
    and no fixture summary.
  - It must not see the runs' grades.
  - It records its own identifier in `labeller`.
- **Owner:** commits the E0 card and pins the manifest before the fixture runs, and
  runs the fixture on the Mac that reaches the endpoint.

## Step 1: harvest

```sh
pnpm fixture:judge -- harvest --runs <runDir>[,<runDir>...] --task r3-grid-batteries \
  --out .soar/experiments/e0-judge/claims.json
```

For each run directory, the harvest reads the run's `state.sqlite` read-only. It takes,
per job and context, the last `claims_verified` event: the claims the host's finish-time
check verified, each with the source window of up to 1,200 characters that the pass
judges.

- Claims without a window are skipped.
- A claim repeated across runs (the same sentence, quote and window) is kept once.
- Claims get new ids `C1`, `C2`, and so on. `origin` keeps the run directory's basename
  and the original id.
- The file is written with mode 0600, and an existing file is never overwritten.
- The command prints counts and the file's sha256, never claim text.

## Step 2: label

For each claim, read only the `sentence`, the `quote` and the `context`, and assign one
label. The definitions are the judge's own (`ENTAILMENT_SYSTEM_PROMPT`):

- `supported`: the passage establishes the sentence.
- `partial`: the passage establishes only part of it or a weaker form.
- `unsupported`: the passage does not establish it.
- `contradicted`: the passage says otherwise.

Judge from the passage alone; outside knowledge does not count. When two labels seem
possible:
- choose `partial` over `supported` when any part of the sentence goes beyond the
  passage;
- choose `contradicted` over `unsupported` only when the passage states the opposite.

Put a note of at most 400 characters on any claim that stayed hard.

## Step 3: plant negatives up to the minimum

The proposal for the card is 10 claims per class; the card fixes the number.

To plant a claim, copy a real claim's `quote` and `context` byte for byte, give it the
next free id, omit `origin`, mark it `planted: true` in the labels, and rewrite only the
sentence:

- **unsupported:** add a specific detail the passage does not contain, such as a number,
  a cause, a comparison or a date;
- **contradicted:** state what the passage contradicts, such as a changed number, a
  reversed direction or a negation;
- **partial**, if still short: state a stronger form than the passage gives, such as
  "all" for "some", a dropped hedge, or two facts where the passage gives one.

A planted claim must be wrong for one stated reason, which the labeller writes in its
note. Planted claims may be easier to catch than the judge's natural errors; the
fixture reports the planted claims' detection separately (`plantedNotEstablished`).

## Files

Both files stay under `.soar/experiments/e0-judge/`, which git ignores. The labels are
evaluator gold: never commit them or send them to a cloud tool.

- `claims.json`: `{"version": 1, "task": "...", "claims": [{"id", "sentence", "quote",
  "context", "origin"?}]}`. Bounds follow `ClaimsVerifiedClaimSchema`, and every context
  is non-empty.
- `labels.json`: `{"version": 1, "protocol": "e0-judge-labelling-v1", "labeller": "...",
  "labels": [{"id", "label", "planted", "note"?}]}`, with exactly one label per claim.

## Step 4: pin, then run

1. Compute each file's sha256 over its exact bytes (`shasum -a 256`), the claim count,
   the count per label and the planted count.
2. Fill `docs/experiments/e0-judge-fixture-v1.json` with these values. Copy the card's
   `minimumPerClass`, `agreement` (`measure` `exact` or `established`, and its `level`),
   `conditions` and `repeats`, then set `status` to `pinned`.
3. Commit the manifest with the E0 card, before any run.
4. On the owner's Mac, run
   `pnpm fixture:judge -- --claims <claims.json> --labels <labels.json> --dry-run`, then
   the same command without `--dry-run`.

The fixture refuses a template, a hash or count mismatch, a missing label, a class below
the minimum, or a prompt version other than the manifest's, all before any request.

**Where the results go.** Raw replies are retained under
`.soar/experiments/e0-judge-fixture-<time>/replies/` with mode 0600, next to a
`summary.json` of per-call verdicts and metrics. The command prints aggregates only.

**Which cell decides.** The activation cell is the J1 condition that matches the
endpoint's reply contract: `j1-legacy`, or `j1-flash` under `flash_next_v1`. Its
`meetsLevel` applies the card's measure and level. The `-reversed` conditions measure
only how often a verdict flips when the four verdicts are listed in reverse order.
Repeats measure consistency.

**After a run, the set is frozen.** If it needs relabelling, make a new set with new
hashes and a new manifest version, and keep the first result.

## What the fixture shows, and what it does not

It shows how often today's judge agrees with one separate labeller on harvested and
planted claims from the exposed r3 runs, overall, on criterion 8's established split,
and per side. It does not show:
- accuracy against an objective truth;
- performance on web-scale pages unlike r3's;
- whether the judge separates accepted from rejected drafts. That second activation
  condition (review §5.2, the S10 row) needs graded runs.
