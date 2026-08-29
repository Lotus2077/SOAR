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
