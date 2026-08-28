# MVP readiness

This file records the repository-level readiness contract. It deliberately does
not describe any maintainer's endpoint, credential, account balance, or local
machine configuration.

## Implemented

- macOS-first Electron shell with a sandboxed React renderer and typed preload
  bridge;
- append-only SQLite session events, restart recovery, and deterministic session
  reconstruction;
- one OpenAI-compatible local provider with streaming, cancellation, timeouts,
  token usage, and honest incomplete-response handling;
- bounded, read-only repository tools for listing, literal search, and text reads;
- path-and-line citation validation plus a tool-free finalization pass;
- executable research and coding benchmark manifests, fixture isolation,
  preflight checks, evaluator adapters, and machine-readable result export;
- deterministic unit, integration, and Electron end-to-end tests.

## Not implemented

- production cloud-provider execution or macOS Keychain retrieval;
- hybrid routing, provider-health leases, or learned scheduling;
- browser, shell, file-write, patch, or external-message tools;
- a stable public data migration policy or signed release channel;
- official bulk SWE-bench evaluation on a native x86-64 Linux worker.

## Provider contract

Development requires an OpenAI-compatible base URL ending in `/v1`. Reasoning
tokens can consume the provider's output allowance without producing visible
content, so the runtime records reasoning separately and rejects empty,
truncated, filtered, malformed, or tool-looping completion states.

The cloud benchmark design currently pins
`deepseek/deepseek-v4-flash-0731` through OpenRouter. That pin is evaluation
configuration, not an enabled application runtime. Pricing and availability are
external facts and must be revalidated before any paid campaign.

## Security boundaries

- credentials and endpoint overrides belong only in ignored machine-local
  configuration;
- raw credentials must never cross into the renderer, event log, trace export,
  test fixture, or error message;
- repository tools remain inside a user-selected canonical workspace and reject
  traversal, symlink escapes, and oversized output;
- repository content and retrieved benchmark material are untrusted input;
- destructive actions, publishing, credential access, and external side effects
  require new tools and an explicit permission design before they can ship.

## Release gate

A contribution is locally releasable when `pnpm check` and `pnpm test:e2e` pass,
the readiness validator reports no tracked secret, and the relevant opt-in live
or benchmark proof is attached without committing its generated artifacts. See
[CONTRIBUTING.md](../CONTRIBUTING.md),
[ARCHITECTURE.md](ARCHITECTURE.md), and the
[benchmark protocol](../benchmarks/README.md).
