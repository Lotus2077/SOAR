# Security policy

SOAR is pre-release software. Only the current `main` branch receives security
fixes; no tagged version should be treated as production-supported yet.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting flow for this repository when it
is available. Include the affected commit, impact, reproduction steps, and any
suggested mitigation. Do not include live credentials, private repository data,
or destructive proof-of-concept payloads.

If private reporting is not available, open a minimal issue titled
`Security contact requested` without vulnerability details so a maintainer can
establish a private channel. Please do not disclose an unpatched vulnerability
in a public issue or discussion.

You should receive an acknowledgement within seven days. Timelines for a fix or
coordinated disclosure depend on severity and reproducibility.

## In scope

High-value reports include credential exposure, renderer-to-main privilege
escalation, Electron sandbox escape caused by SOAR configuration, selected
workspace escape, symlink or traversal bypass, event/trace data leakage,
unapproved external side effects, and benchmark gold leakage into agent context.

Provider behavior, upstream model output, unsupported local deployments, and
social engineering without a product vulnerability are generally out of scope.
