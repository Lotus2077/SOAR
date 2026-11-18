### BL-20261118-0932-e6-scorer-repin -- 2026-11-18 -- E6's manifest re-pins the planted-defect scorer after #157 changed one comment line (the card's Amendment 2)

Status: `Implemented`

Scope or hypothesis: E6's manifest pinned `scripts/e6-score.py` at `b8e77c2f…` (Amendment 1, item 4). #157 (commit e084878) changed one docstring line, so the file on `main` is `9cfe1410…`, and E6's precondition that the manifest pins the scorer failed. Lane S-harn found it while writing E6's runbook. The orchestrating session decided the re-pin.

Decisions:
- The manifest's `scorer.sha256` moves to `9cfe14105e50f989f61d52d5e46d4b16c49d98244fdac56ebe2e8b7c049ecca7`. The version stays 1.
- The card gains Amendment 2, which states the re-pin and supersedes Amendment 1, item 4's value. Amendment 1's text stays as written.
- Restoring the old bytes was not chosen: it would put a log ID back under `scripts/`, which the validator refuses (#159).

Changes: docs/experiments/e6-tasks-v1.json (one value); docs/experiments/e6-card-2026-11-17.md (Amendment 2, 22 lines appended); this entry.

Evidence:
- **One line differs.** The pinned blob and the current one differ in the docstring's "Design:" line only: 1 insertion, 1 deletion. No other commit has touched the file since 3ade65b.
- **Same version.** `--version` prints `e6-score 1` for both.
- **Tests.** The scorer's unit suite as it was at 3ade65b passes 15 of 15 against the current file. The suite on `main` also passes 15 of 15.
- **The manifest.** Its sha256 is now `c316bb72f739f1e176ba27aed89e503907fb53bc9b90ab9ea73a83f67fec318f`. Its `tasksSha256` (the tasks sorted by id) is unchanged, recomputed.
- **No other pins.** Apart from this manifest and Amendment 1's text, no tracked file pins either old value. The frozen archive names them four times, as history.
- **Checks.** `pnpm validate:build-log -- --base-ref origin/main`, `pnpm typecheck` and `pnpm validate:readiness` exit 0.

Failures or blockers: None.

Limitations and non-claims: The pin is by bytes, so any later commit to the scorer needs another re-pin before E6's first run. This scores no gold and starts no E6 run.

Paid exposure: None. Zero SOAR model requests and zero envelope spend.

Next gate: Merge on green CI after the orchestrating session's read. E6's runbook then pins the manifest's new sha256.

References: BL-20261117-1311-e6-card-amendment-1; BL-20261117-1200-e6-planted-defect-tasks-frozen; #135; #145; #157; #161.
