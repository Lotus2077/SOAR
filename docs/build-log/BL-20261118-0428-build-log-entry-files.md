### BL-20261118-0428-build-log-entry-files -- 2026-11-18 -- The build log moves to one file per entry: docs/BUILD_LOG.md becomes a frozen archive, new entries are files under docs/build-log/, and no check orders one pull request's entries after another's

Status: `Implemented`

Scope or hypothesis: Decision 3 of BL-20261118-0418-owner-approves-desktop-first-order-and-log-layout. From this merge it replaces the re-stamp rule of BL-20261113-0937-owner-decision-restamp-unmerged-entries. On 2026-11-17, 35% of the lines added went to the log, and 18 of 61 entries only moved a timestamp.

Decisions:
- **The archive.** docs/BUILD_LOG.md is frozen at a pinned sha256, checked with or without a base.
- **An entry file.** Each entry is docs/build-log/BL-YYYYMMDD-HHMM-slug.md: the archive's heading line with its UTC date, then the ten fields.
- **Checks in each file.** The validator checks that the name equals the ID, that the UTC ID gives the heading's date, that the fields are in order, and that the status is allowed. It also checks that the file holds one entry.
- **Checks across files:**
  - files on the base never change;
  - a Correction cites an existing ID, in either order;
  - nothing compares times;
  - a material change needs a new file;
  - over 40 lines warns only.
- **Code citations.** A pull request adds no log ID under src/ or scripts/, counted over every changed file there.
- **The PR's own file.** It may be revised until merge, and must be true then (AGENTS.md).
- **The conversion.** `pnpm build-log:to-files` converts an open branch during a merge, by CONTRIBUTING.md's three-line recipe.

Changes: the validator, scripts/build-log-to-files.ts, package.json, CI step names, two test files; AGENTS.md, CONTRIBUTING.md, docs/PLAN.md, docs/HANDOFF.md, the READMEs, docs/agents/skill-routing.md and the PR template.

Evidence:
- **Tests and mutants.** 66 of 66 build-log tests pass, and 43 single-edit mutants of the two scripts all fail them.
- **This branch** passes the validator against `main` 4ec4928, whose archive the pin holds.
- **A real conversion.** The recipe converted #86's branch mid-merge, and the result validated.
- **The light review.** Its verdict: needs fixes, with one major, seven minor and some nits; privacy was clean. All are fixed, the archive pin and the recipe staging only the log among them.

Failures or blockers: None.

Limitations and non-claims:
- The archive's own "Log rules" header is historical.
- Citations already under src/ and scripts/ stay until one later PR removes them, which moves the source freeze once.
- Neither script is in the source freeze.

Paid exposure: None.

Next gate: The coordinator's merge on green CI; open branches then convert.

References: BL-20261118-0418-owner-approves-desktop-first-order-and-log-layout; BL-20261113-0937-owner-decision-restamp-unmerged-entries.
