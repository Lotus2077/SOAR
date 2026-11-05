# SOAR contributor instructions

- Use multiple agents for independent, parallelizable research, implementation,
  or review when doing so materially improves speed or confidence.
- Read `docs/BUILD_LOG.md` before material work. Append a complete entry for
  every crucial product, architecture, persisted-contract, provider, cost,
  permission, evaluation, failure, or milestone change before calling it
  complete.
- Never rewrite a committed build-log entry. Append a correction or superseding
  decision and retain the original negative result or limitation.
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
