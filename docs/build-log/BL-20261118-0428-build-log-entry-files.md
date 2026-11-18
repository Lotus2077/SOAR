### BL-20261118-0428-build-log-entry-files -- 2026-11-18 -- The build log moves to one file per entry: docs/BUILD_LOG.md becomes a frozen archive, new entries are files under docs/build-log/, and no check orders one pull request's entries after another's

Status: `Proposed`

Scope or hypothesis: The owner approved this as decision 3 of BL-20261118-0418-owner-approves-desktop-first-order-and-log-layout. Once on `main`, it replaces the re-stamp rule of BL-20261113-0937-owner-decision-restamp-unmerged-entries. On 2026-11-17, 35% of the lines added went to the log, and 18 of 61 entries only moved a timestamp.

Decisions:
- docs/BUILD_LOG.md is a frozen archive: the validator fails any change to it against the base.
- Each new entry is one file, docs/build-log/BL-YYYYMMDD-HHMM-slug.md. Its first line is the archive's heading form, with the UTC date, and the ten fields follow in order.
- What the validator checks in each file:
  - the ID equals the file's name, and its UTC timestamp is valid and gives the heading's date;
  - the fields come in order, none is empty, and the status is an allowed one;
  - the file holds one entry.
- What it checks across files:
  - a file on the base never changes or goes;
  - a Correction cites an ID that exists in the archive or the directory;
  - a material change needs a new file;
  - no check compares times;
  - a file over 40 lines gets a warning only.
- A pull request may not add a log ID to a file under src/ or scripts/. Citations already there stay.
- A pull request's own entry file may be revised until it merges, and must be true at the merge.
- `pnpm build-log:to-files` moves an open branch's appended entries into files.

Changes:
- scripts/validate-build-log.ts, scripts/build-log-to-files.ts, package.json and tests/unit/build-log-validator.test.ts;
- AGENTS.md, CONTRIBUTING.md, docs/PLAN.md, docs/HANDOFF.md, docs/experiments/README.md, README.md, docs/README.md and the pull-request template.

Evidence: To be stated before review.

Failures or blockers: None.

Limitations and non-claims:
- The archive's "Log rules" header stays as it was, and is now historical.
- Citations already under src/ and scripts/ stay until a later pull request removes them, since that moves the source freeze.
- Neither script is in the source freeze.

Paid exposure: None.

Next gate: One light review, then the coordinator's merge on green CI.

References: BL-20261118-0418-owner-approves-desktop-first-order-and-log-layout (decision 3); BL-20261113-0937-owner-decision-restamp-unmerged-entries.
