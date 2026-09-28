# Execution progress routing

Status: Verified for the host contracts and four complete scripted desktop
scenarios. Real-model delivery quality and release remain unproved.

The previous real website trial exhausted twenty attempts without creating HTML.
Four consecutive actions repeated the same failed diagnostic command. This
milestone responds to that observed failure in the general execution loop.

## What changed

- After two executions return the same nonzero result for the same command, with
  unchanged workspace content, the next model request asks it to change course.
- If it selects the same command again, the host captures the workspace again
  and stops before execution if the content is still unchanged. Editing a script
  or input permits another attempt. Reading observations or updating a plan does
  not erase the failure history.
- Once one third of the model allowance is consumed, absent or empty required
  artifacts trigger a bounded reminder to produce a useful draft. File presence
  is not treated as evidence of correctness.
- The prompt describes Python, Python Playwright with system Chromium,
  LibreOffice and document libraries qualified for the exact installed image.
  Node remains unverified. Other images receive no positive capability claims.
- Current guidance is regenerated after restart. A valid stop retains its settled
  model attempt and creates no third tool receipt. Corrupt proof, an unknown
  request, or a crash before the stop is recorded blocks replay.

These are deterministic recovery rules. They do not classify task difficulty,
judge semantic progress, or automatically send work to a cloud model. Consultation
retains its existing explicit packet approval and original allowance.

## Verification

The final focused suite passed **222 tests across twelve files**. Sixteen pure
fixture checks, both application typechecks, scoped desktop types and the
production build also passed. Independent review found and fixed three issues:
NUL-containing output, a deadline reached during workspace capture, and a crash
between receiving the action and recording its stop.

The initial four-case desktop invocation lasted 23.029 seconds and returned three
passes and one failed assertion:

| Desktop case | Model attempts / settled requests / tools | Result |
| --- | --- | --- |
| Change action after warning; pause, reopen, export and reopen again | 4 / 4 / 4 | Passed |
| Ignore warning; stop before the third execution | 3 / 3 / 2 | Stop worked; test assertion interrupted restart verification |
| Retrieve omitted observation and repair source totals across restart | 4 / 4 / 4 | Passed |
| Oversized next request remains unsent across restart and export | 2 / 1 / 1 | Passed |

The failed assertion expected the generic task record to contain the specific
stop reason. The controller derives that reason from the verified event proof;
the actual UI already displayed it correctly. The original invocation, including
its unrun final restart, remains retained. Only that assertion was corrected;
the production runtime stayed unchanged. The separately admitted corrected case
passed in 5.799 seconds. Its three responses and two executions were unchanged
after reopening; the specific stop reason persisted and Resume was denied.
All four planned scenarios therefore have complete proofs on the same build.

Root independently reread SQLite, verified all referenced checkpoint and
execution bytes, and recomputed the recovery export from the original CSV. Its
three totals are 945, 2299 and 2625 cents. Exported bytes matched across restart.
The initial invocation recorded twelve settled requests, thirteen model attempts,
eleven tools, zero unknowns and zero API fees. All responses were scripted.
Including the original failed case and the corrected fresh case, the two
invocations used sixteen model attempts, fifteen settled requests and thirteen
tools. Read-only Docker checks confirmed no owned containers for any of the five
jobs. Independent review regenerated guidance and stop hashes from actual
SQLite and retained bytes, including the corrected case's unchanged restart state.

## Evidence and limits

Frozen runtime:
`e91d588115ff209f7f66327e99067114a7fbe8123eea1059141cb607ff0e5e0c`.
The admission archives 197 source/build bindings and 31 supporting evidence
bindings. Raw controlled traces, databases and generated artifacts are retained
under ignored local evidence storage.

Final root audit: `3f78cd36e883034b0adbfec6c3c8001107a8dcc87f769139859be617b953a0b6`.
Independent corrected-case audit:
`e261a04ac6ff7ce3c957968bcbb36e9249ac2eb74cfbee99dfc4d55264086a6f`.
The older size fixture retains parsed request bodies, so this independent audit
does not reconstruct its missing raw wire bytes. The admitted desktop test
checks packet identity against its actual localhost origin. Two audit-script
format assumptions were corrected without changing the runtime or task evidence.

The rule catches exact repeated failures; changing a command trivially can evade
it. Exit-zero semantic loops and wrong artifacts remain possible. Capability
qualification does not guarantee reliable browser captures or document quality.
No real inference ran in this milestone, so improved delivery quality, useful
consultation and savings remain unproved. The first MVP is still incomplete.

The next experiment is one fresh local task using the original website inputs
and unchanged allowance. Assess its exact exported candidate independently if
one exists; otherwise preserve the failure and stop. Do not replay either closed
website trial. See the [prior failure](MVP_LOCAL_WEBSITE_REPAIR_V2_REPORT.md),
[progress plan](plans/MVP_EXECUTION_PROGRESS_ROUTING_V1.md) and
[completion audit](MVP_COMPLETION_AUDIT.md).
