# Advertise the router's permitted native actions

Status: Implemented with focused offline mechanics verified under the continuing
owner goal. The broader UI worker could not start, so a current full-suite pass is
not claimed. This does not authorize another model attempt or promotion
of the failed compact-critic repair policy.

The bounded repair batch made thirteen settled local requests with zero API fees.
Retry-After submitted after six calls and passed independent checks. Cache stopped
after its seventh validly parsed response requested a forbidden action; it never
checked or submitted. The exact action name was not retained. All four native tools
were still advertised, although the validated router checkpoint permitted fewer.
The thirteen requests and failed run remain in the historical denominator.

Change the native request builder to advertise exactly the current router's allowed
actions, in canonical catalog order. Main admission must independently derive and
validate the same subset from its validated checkpoint before permitting dispatch.
Keep historical messages validated against the complete catalog: earlier command
calls remain valid history after new commands become unavailable. Keep execution
authorization, request settlement, eight-call repair limits, finishing reserves,
deadline and cancellation behavior unchanged.

Record a small denial event if a model nevertheless chooses an unavailable action:
the allowlisted action name, request ID, checkpoint identity and call number only.
Do not retain raw response bodies or action arguments in this diagnostic event.
This event explains the failure; it does not authorize retry or ignore the action.

Verify exact masks at ordinary, checking and submission checkpoints, preserved
history, rejection of extra/missing/reordered/altered tool definitions, stale or
foreign checkpoint bindings, denial receipts and unchanged conservative settlement.
Exercise actual admitted loopback requests through the main/runtime path and Docker
execution, not only a pure request-builder test. Preserve the previous full-catalog
behavior in immutable generation evidence; changes must not overwrite old results.

The existing compact-critic repair policy failed its six-of-six gate. Any subsequent
live policy version needs separate frozen configuration and bounded authority, and
must include all candidate-generation, critique, failure and repair costs. Tool
filtering alone is not evidence of improved model quality or economic benefit.

References: [repair plan](MVP_ROUTING_CRITIC_REPAIR_V1.md),
[routing report](../MVP_ROUTING_SCREEN_REPORT.md).
