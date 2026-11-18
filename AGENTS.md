# SOAR contributor instructions

- Use multiple agents for independent, parallelizable research, implementation,
  or review when doing so materially improves speed or confidence.
- Start from the "Start here" section of `docs/HANDOFF.md` for the current state,
  the decisions in force and the next actions.
- Before material work, read the entries that bear on it: the frozen archive
  `docs/BUILD_LOG.md` (to 2026-11-18) and the entry files in `docs/build-log/`.
  For every crucial product, architecture, persisted-contract, provider, cost,
  permission, evaluation, failure, or milestone change, add one entry file to
  the pull request before calling it complete. Keep it to about 25 lines and
  put the detail in the pull request's description.
- An entry file is `docs/build-log/BL-YYYYMMDD-HHMM-slug.md`, named by its ID
  in UTC. Its first line is `### <ID> -- <UTC date> -- <title>`, and the ten
  fields follow in order. A pull request's own entry file may be revised until
  it merges, and the entry as merged must be true at the merge: update its
  statuses, figures and review notes rather than leaving them as first drafted.
- Never edit the archive, and never change or delete an entry file once it is on
  `main`. Add a `Correction` entry file instead, and keep the original negative
  result or limitation. Entries are never re-stamped.
- Cite entries from entries, docs and pull requests, not from code. A pull
  request may not add a log ID to a file under `src/` or `scripts/`.
- Keep `Proposed`, `Approved`, `Implemented`, `Verified`, and `Released`
  distinct. State exactly what each test or live proof demonstrates and what it
  does not.
- If a referenced plan has an approval gate, do not begin its gated runtime or
  paid work until the required approval is durably recorded.
- Never commit credentials, private endpoints, local paths, raw private traces,
  evaluator gold, or generated databases/artifacts.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues on `Lotus2077/SOAR` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` (created lazily) plus `docs/adr/`. See `docs/agents/domain.md`.

### Skill routing

When a plan settles, needs tickets, spans sessions, or issues need triage,
read `docs/agents/skill-routing.md` and suggest the matching slash command.
