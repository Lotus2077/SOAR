# Flash-Next local planner diagnostic

Status: **Approved for the bounded diagnostic; execution prerequisites remain.**
Prepared 2026-11-01 (Asia/Shanghai).

The second H4 loop stopped with `research_plan_invalid`. Its eight index calls
included two invalid replies; both subsequent plan replies failed validation,
and one was truncated. All ten requests settled at USD 0. The preserved records
contain aggregate counts and response hashes, but no per-reply validation cause.
They cannot identify the offending JSON syntax or schema field. See
BL-20261031-2322-h4-local-plan-rejected.

This proposal collects the missing diagnostic information using the same exposed
research task and frozen pipeline. It neither changes the planner contract nor
replaces the failed H4 result.

## Bounded proposal

| Control | Proposed limit |
| --- | --- |
| Model and service | Existing qualified Flash-Next deployment, unchanged |
| Task | Exposed `r3-grid-batteries` input only |
| Requests | At most eight index calls and two plan calls; ten total |
| Output reservations | At most 1536 tokens per index call and 8192 per plan call; 28672 total |
| Input admission | Existing exact tokenizer, context and safety-margin policy before dispatch |
| Fees | USD 0; local model only |
| Runtime | At most 45 minutes, bounded by the owner's 2026-11-01T10:00:00Z availability cutoff |
| Stop point | The plan-stage record, before extraction, synthesis or writing |
| Retry | Only the frozen planner's one validation retry; no transport, diagnostic or whole-loop replay |

The original 24-request qualification allocation is exhausted. These would be
**up to ten additional diagnostic requests**. The owner explicitly approved
this proposal on 2026-11-01; see BL-20261101-0009-planner-diagnostic-approved.
Unused diagnostic requests cannot be reassigned to another purpose.
The H4 split USD 0.60 allowance and H5 USD 21.60 allowance remain unchanged and
unused by this diagnostic. No H4 rerun or H5 launch is included.

## Implementation and evidence

Use a separate, initially held operator around the existing production research
pipeline. Keep its prompts, schemas, thinking settings, output caps, retry
behavior, role identities, runtime and protocol bytes unchanged. An external
guard limits the exposed task to eight index and two planner calls. A
synchronous stop at the plan-stage record prevents extraction even when a plan
passes validation. A first valid plan therefore ends after nine requests.

Each completed call records only numeric byte counts, finish reason, usage and
hashes bound to its own settled receipt. Planner calls additionally retain fixed
validation categories and bounded schema-path identifiers. Byte counts are not
inferred reasoning-token counts. Arbitrary model-provided keys, values and error
messages must not enter those records. Prompts, raw replies, candidate content
and fresh evaluation material are excluded from the diagnostic report and Git.

To make the new validation failures reproducible offline, retain at most two
planner final-`content` files in the ignored private evidence directory. Use
fixed filenames, exclusive creation, directory mode 0700, file mode 0600 and a
256 KiB limit per file. The report contains their hashes only. Do not retain the
separate reasoning field, transport body, prompts or index gists. These files
remain untrusted model output and are never copied into public documentation.
Their hashes and the frozen parser/schema permit deterministic revalidation
without another model request.

Before execution, bind the reviewed operator and tests, clean commit, existing
runtime/protocol/role/serving/token-policy hashes, exposed input hashes, exact
owner approval and cutoff in a new single-use authority. A durable claim must
prevent replay by copying the output directory. Confirm current host/service
readiness and idle state. Unknown receipts, drift, unexpected purposes, extra
calls, withdrawal of availability or the deadline stop further admission;
cleanup does not authorize another request.

Preparation and independent synthetic review must finish before the approval
request. A held template or passing mock test is not live authorization. The
final preparation record must identify the actual reviewed bytes and tests.

The held implementation is now prepared and independently reviewed. All 46
synthetic tests and strict TypeScript checks pass, including storage failure
stopping before a second planner request. Root verified all nine asset hashes
against both the prepared proposal and independent review. Preparation invoked
no live helper, read no task input content and dispatched no generation.
That held snapshot is archived. The owner has since approved the bounded run;
only its activation hold has been released. A concrete authority, current
readiness checks and applicable CI must precede execution.

Held proposal SHA-256:
`9c3109c58c57bb79f3be22e001c3c76f89900e58316a8fc44786c9e4fd9c062b`.
Independent review SHA-256:
`b469f7feb7839d16ea3cc2706c4a8e92d955ebe2046e5acd48ce583b512c2e96`.
These establish preparation only, not permission or a live result. See
BL-20261031-2340-planner-diagnostic-prepared.

## Interpreting the result

- A valid diagnostic plan demonstrates only that this new run satisfied the
  existing plan contract. It does not recover the original missing replies,
  explain their precise defect, accept H4 or establish task quality.
- An invalid plan may identify a reproducible syntax, schema or cutoff category
  under the frozen configuration. Preserve that result without relaxing the
  validator or changing prompts during the run.
- Any proposed implementation, configuration change or failed-loop replay must
  be separately specified and authorized where the migration plan requires it.
  H5 still follows accepted mechanics for all three H4 loops and the usable
  split plan/argument gate.

References: [migration plan](PHASE4_FLASH_NEXT_MIGRATION_V1.md),
BL-20261031-2235-owner-window-extension,
BL-20261031-2322-h4-local-plan-rejected.
