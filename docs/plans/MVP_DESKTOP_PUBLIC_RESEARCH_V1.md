# Desktop public research milestone

Status: **Approved for implementation and the bounded verification below** under
the owner's request to keep building the first MVP. This extends the completed
desktop slice; it does not declare the full privacy-first MVP complete.

## Deliverable

One desktop task can start from a goal alone, optionally attach public/synthetic
files, and explicitly permit retrieval of up to three exact public HTTPS URLs.
The existing agent loop creates a source-grounded artifact, retaining host source
receipts and original response bytes. The execution container remains offline.
The same optional-input path also supports self-contained websites and editable
PowerPoint files using the already qualified artifact image.

Network permission is separate from input classification. No URLs inferred from
the goal or model output grant authority. The approved list includes full paths
and queries; redirects, credentials, private/reserved addresses and unlisted URLs
are denied. An optional explicitly selected public DNS resolver is disclosed and
bound to the task. Default system resolution remains available. Limits are three
URLs, five public GET attempts, 64 KiB per response, twenty local model calls,
thirty tools and fifteen minutes per task. An uncertain request stops further
dispatch; neither retry nor restart replenishes allowance.

## Implementation

- Keep one runner and broker. Add an explicitly public primary session mode,
  with exact phase, destination and attestation bindings. Existing private and
  two-phase sessions retain their behavior.
- Version new desktop records. Read legacy records as having no public retrieval;
  never silently grant or widen their network scope. Bind scope to frozen task
  identity and refuse drift on resume.
- Save complete response bytes outside the model-writable workspace and join each
  source receipt to its settled broker dispatch. Expose bounded metadata and
  clearly label shortened observations; model-created citations are not receipts.
- Show the local route, approved sources, retrieval state and unchanged independent
  acceptance status. Keep HTML/content inert in the privileged renderer.
- Enforce confirmed execution cleanup in host artifact access as well as the UI.

## Verification and stop conditions

First run focused deterministic tests for optional inputs, exact URL/consent and
private-context denial, legacy behavior, frozen scope/restart, retained bytes and
receipt tampering, GET limits, unknown-outcome stop and cleanup authority. Build
the app and run actual Electron/controlled HTTP/Docker mechanics with scripted
model actions; no paid provider participates. Preserve any failure and correct
its specific cause before a separately identified rerun.

After mechanics pass and source/runtime/config/input identities are frozen, admit
one public-source report through the real desktop and owned local model: at most
twenty model calls, five GETs, thirty tools, fifteen minutes and zero declared API
fees. Freeze the public sources, goal and independent acceptance procedure before
dispatch. Evaluate all requested substantive claims from the retained source
bytes and verify exact export, accounting, source preservation and cleanup. Do
not retry the candidate after evaluation. Public source/DNS preflight is bounded
and distinct from inference. A failed connectivity prerequisite is not a model
quality failure.

Website and deck execution are subsequent individually frozen tasks, not silently
included in this report allowance. Implementation and offline inspections may
proceed in parallel. No new image installation is planned.

## Boundaries

Only explicitly public/synthetic inputs are admitted. This does not qualify real
private files, inference-server trust, OPF release authority, paid cloud routing,
search-engine discovery, arbitrary browsing, publication, messages or production
release. The prior closed trials and undispatched paid proposal remain unchanged.
Host retrieval does not establish GPU-server OS internet access. Local API fees
exclude hardware, electricity and operating costs. General routing and broader
artifact acceptance remain on the completion audit after this milestone.

References: [completion audit](../MVP_COMPLETION_AUDIT.md),
[desktop report](../MVP_GENERAL_TASK_DESKTOP_REPORT.md),
[privacy-first design](MVP_PRIVACY_FIRST_AGENT_V1.md).
