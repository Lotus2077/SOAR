## Summary

<!-- What problem does this solve, and why is this the smallest useful change? -->

## Validation

<!-- List exact commands and outcomes. -->

- [ ] `pnpm check`
- [ ] `pnpm test:e2e` (macOS runtime or renderer changes)
- [ ] Relevant opt-in live or benchmark check, or not applicable

## Risk and contract checklist

- [ ] Tests cover the changed behavior
- [ ] No secrets, local endpoints, databases, gold data, caches, or generated artifacts are committed
- [ ] Persisted event/schema compatibility is preserved or documented
- [ ] Filesystem, renderer/main, provider, cost, and benchmark-isolation boundaries were considered
- [ ] User-facing or architecture documentation is updated when needed
- [ ] Renderer changes include screenshots
