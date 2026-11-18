### BL-20261118-0459-research-trimmed-reply-fixture -- 2026-11-18 -- The research test fixture exports its trimmed-packet reply and corpus for the desktop's controller tests

Status: `Implemented`

Scope or hypothesis: Lane S-desk's 13a controller tests drive the reading stage through a loopback model endpoint. They need the stage's three ends: ready, refused and trimmed. The trimmed end was built inline in one session test.

Decisions:
- **Two exports** in tests/helpers/research-v4-fixture.ts:
  - `researchV4TrimmedReply` quotes every line of a chunk with a 200-character note; every other stage answers as `researchV4Reply`.
  - `researchV4TrimmedSources` is the 20-source corpus whose 240 quotes overflow the packet.

  Both are the session test's inline code, which now uses them.
- **Ready and refused** need no new helper. Ready is `researchV4Reply`; refused is a one-line override or tight admission rates.

Changes: tests/helpers/research-v4-fixture.ts; tests/unit/private-agent-research-session.test.ts; this file.

Evidence:
- The session test file passes: 80 tests.
- The 15 files that import the fixture pass: 440 tests.
- Typecheck passes.
- A helper that stops trimming fails the 7b.2 test.

Failures or blockers: None.

Limitations and non-claims: Tests only. The source freeze and every protocol hash are unchanged.

Paid exposure: None.

Next gate: CI and the coordinating session's merge. S-desk's second 13a.1 pull request imports the helpers.

References: pull requests #102 (7b.2's trim), #156 (13a's design) and #158.
