### BL-20261118-0428-build-log-entry-files -- 2026-11-18 -- The build log moves to one file per entry: docs/BUILD_LOG.md becomes a frozen archive, new entries are files under docs/build-log/, and no check orders one pull request's entries after another's

Status: `Implemented`

Scope or hypothesis: Decision 3 of BL-20261118-0418-owner-approves-desktop-first-order-and-log-layout. From this merge it replaces the re-stamp rule of BL-20261113-0937-owner-decision-restamp-unmerged-entries. On 2026-11-17, 35% of the lines added went to the log, and 18 of 61 entries only moved a timestamp.

Decisions:
- **The archive.** docs/BUILD_LOG.md is frozen at a pinned sha256, checked with or without a base, so a pull request whose checks ran before the switch cannot append to it.
- **An entry file.** Each entry is one file, docs/build-log/BL-YYYYMMDD-HHMM-slug.md: the archive's heading line with the UTC date, then the ten fields.
- **Checks in each file** (scripts/validate-build-log.ts): the name equals the ID, the UTC ID is valid and gives the heading's date, the fields are in order and non-empty, the status is allowed, and the file holds one entry. The validator reads the directory as git lists it.
- **Checks across files:** a file on the base never changes or goes; a Correction cites an ID in the archive or the directory, in either order; nothing compares times; a material change needs a new file; a new file over 40 lines gets a warning only.
- **Code citations.** A pull request adds no log ID under src/ or scripts/. IDs are counted over every changed file there, so a moved file keeps its citations.
- **The PR's own file.** It may be revised until the PR merges, and must be true then (AGENTS.md).
- **The conversion.** `pnpm build-log:to-files` moves a branch's appended entries into files during a merge; CONTRIBUTING.md has the three-line recipe.

Changes:
- scripts/validate-build-log.ts, scripts/build-log-to-files.ts, package.json and the CI step names;
- tests/unit/build-log-validator.test.ts and tests/unit/build-log-entry-files.test.ts (new);
- AGENTS.md, CONTRIBUTING.md, docs/PLAN.md, docs/HANDOFF.md, README.md, docs/README.md, docs/experiments/README.md, docs/agents/skill-routing.md and the PR template.

Evidence:
- **Tests and mutants.** The two build-log suites pass 66 of 66, and 43 single-edit mutants of the two scripts all fail them.
- **This branch** passes the validator against `main` 5140f5d.
- **A real conversion.** The recipe converted #86's branch (2dd2de9) mid-merge, and the result validated against this branch.
- **The light review.** Its verdict: needs fixes, with one major, seven minor and some nits; privacy was clean. All are fixed:
  - the recipe stages only the log;
  - the conversion refuses another conflict, a rebase and a repeated ID;
  - the archive pin;
  - citations counted across files;
  - git's listing of the directory;
  - warnings only against a base.

Failures or blockers: None.

Limitations and non-claims:
- The archive's "Log rules" header is historical.
- Citations already under src/ and scripts/ stay until one pull request removes them, which moves the source freeze once. Neither script here is in the source freeze.
- An archive append that merges before this one needs the pin updated.

Paid exposure: None.

Next gate: The coordinator's merge on green CI; open branches then convert.

References: BL-20261118-0418-owner-approves-desktop-first-order-and-log-layout; BL-20261113-0937-owner-decision-restamp-unmerged-entries.
