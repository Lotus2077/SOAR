# Local tool and connectivity check — September 12, 2026

The short commands all reached the execution tool intact. Two of three operations
passed; one failed in generated Python before writing. This separates command
serialization from program correctness. It does not establish autonomous recovery.

## Short writes

| Case | Observed result |
| --- | --- |
| Write UTF-8 Markdown | Passed; exact bytes checked |
| Append while preserving existing UTF-8 text | Failed before append; incorrect bytes assertion |
| Append and execute a short Python calculation | Passed, including independent execution of the saved program in a fresh offline container |

All three responses contained one complete tool call. Their commands were 421,
483 and 537 characters; outputs were 162, 220 and 173 tokens, below the unchanged
4,096-token limit. The batch took 12.121 seconds including startup and cleanup.
All three requests settled, all owned containers closed, and runtime source stayed
unchanged. The result remains **2/3**, with `allPassed: false`.

The failed command compared actual UTF-8 bytes with a Python bytes literal
containing Unicode escapes. Those are different values. Its assertion stopped
execution before the append. The model did not receive this failure for a second
decision, so this first-response check cannot tell us whether it would recover.

## Connectivity

The isolated execution container exposed only its loopback interface. Both DNS
resolution and a direct outbound TCP attempt failed, and the container closed.
This verifies its intended offline execution restriction.

The first model request supplied no client tools. It became an unknown dispatch
without a usable response; no subsequent request from that invocation was replayed.
The provider's metadata endpoint subsequently returned HTTP 200 and listed the
configured model. The three successful transports above further show that the
endpoint was serving requests with tools. Empty-tool request compatibility remains
a possible explanation for the first failure, not a confirmed diagnosis.

The remaining host-fetch portion ran once. The model selected the exact admitted
fetch tool and URL, using 399 input and 82 output tokens. Its request settled. The
host then attempted one public HTTPS GET, which became unknown before returning
content. The response-extraction call did not run. Tool selection is verified;
successful retrieval and consumption of web content are not.

A subsequent DNS-only diagnostic found that the public test hostname resolved to
one IPv4 address in the reserved benchmark range, which the production public-
address classifier rejects. TLS was skipped at that boundary, with no additional
HTTP payload. This is a concrete current host-network/policy blocker consistent
with the failed GET. The earlier request did not retain its resolved address, so
this does not prove its sole historical cause. No guard was relaxed. The diagnostic
does not establish which network component produced this DNS mapping.

Neither the failed direct request nor the container restriction establishes the
GPU server operating system's internet access. That remains unknown without
server-side execution access. Do not classify the model as internet-capable on
the strength of a correct tool call alone.

## Implemented change and limits

The runner now gives specific feedback when invalid execute arguments coincide
with the configured output-token limit. It requests a short incremental write,
records the outcome durably and stops after two consecutive failures. Resume
preserves this limit; complete valid calls at the token cap still execute. The
changed prompt protocol rejects silent resume of historical jobs.

All 18 focused unit tests and strict TypeScript passed. An earlier test launcher
stalled before assertions and was interrupted; the bounded retry passed. The live
short-write cases did not exercise the new output-limit branch, because none hit
that limit. The branch is mechanically verified, not live-qualified by this batch.

The planned twenty-call invoice task remains unrun because its three-pass
prerequisite was not met. No candidate, independent quality score, general-agent
acceptance or MVP release is claimed. The earlier failed tasks are preserved.

Next, resolve the host DNS/transport integration while preserving destination
checks, and test one bounded recovery from the actual append error. A complete
report follows under a separately recorded acceptance decision.
Repeating the same first-response checks would not measure autonomous recovery.
The immediate product requirement is a short action-observation-repair loop with
verified output. Internet-dependent work should receive an explicit host fetch
tool rather than assume a browser exists inside the model API.

Only synthetic inputs and admitted public connectivity data were used. There was
no cloud fallback and no declared API fee allowance. Owned hardware, electricity
and other operating costs remain separate; this is not an economics result.
Across both checks, five model attempts occurred: four settled and one remained
unknown. The public GET also remained unknown; a separate metadata GET succeeded.
All owned processes are terminal. No report task or independent artifact evaluator
ran, and no further live calls remain active.

See the [bounded plan](plans/MVP_LOCAL_TOOL_AND_CONNECTIVITY_V1.md),
[build log](BUILD_LOG.md) and [earlier artifact failures](MVP_PRIVATE_AGENT_FIRST_TASK_REPORT.md).
