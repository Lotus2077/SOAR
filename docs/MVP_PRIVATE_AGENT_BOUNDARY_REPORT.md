# Private agent boundary — development evidence

Date: 2026-09-11. Status: **Implemented; enumerated synthetic boundary checks verified. Real-task qualification remains open.**

The owner authorized completing the privacy-first sequence. Implementation and
synthetic tests have started under the [execution bounds](plans/MVP_PRIVATE_AGENT_EXECUTION_V1.md).
This report is separate from the historical public coding pilot and is not a
claim of accepted general tasks or a private production deployment.

## Implemented development path

The new `src/main/private-agent` modules provide a host-owned SQLite permission and
request ledger, exact packet broker, model adapter, restricted Docker execution,
durable artifact checkpoints and a reusable plan/action/observation/verification
loop. No category selects a coding/research/website/slide controller. Generated
programs receive neither provider credentials nor a direct network route.

The broker binds task, context provenance, policy revision, recipient/account,
purpose and exact request bytes. It atomically consumes one-use disclosure grants
and maximum fees before HTTP. An uncertain response retains its reservation and
blocks automatic replay. Public and private contexts cannot be silently mixed.
Known broker credentials and host-classified imported credential sources are
excluded independently of the learned detector. Unknown secrets remain a detector
limitation, not a guaranteed classification capability.

Admitted private/local computation does not depend on learned-detector availability.
Its receipts distinguish a trusted-local scan exemption from a synthetic-local
test exemption and from a completed external-packet scan. External release still
requires a complete scan and disclosure authority; a clean scan cannot create it.

The general runner preserves context and artifacts across pause/resume, stops
uncertain operations from replaying, and routes cancellation through both the
durable broker state and running sandbox command. At submission it stops the agent
container, verifies immutable captured bytes in a separate container using host
Python code with isolated imports, and binds completion to that snapshot. Passing
configured checks proves only the named contract; independent semantic/visual and
owner acceptance remain separate gates for real tasks.

## Observed checks and retained failures

- The joined root batch passed **98 tests**: forty-one broker/receiver cases,
  nine actual synthetic model–Docker–verification/resume cases, twenty-seven
  sandbox host-admission tests, seventeen session/loader cases and four checkpoint
  cases. One additional operator-entry integration case subsequently passed. It used local HTTP receivers,
  synthetic model responses and temporary databases, not a real model provider.
  Earlier 35-, 45-, 66- and 67-test runs overlap this coverage and are not additive.
- All **thirteen real sandbox cases** passed together on the current source.
  They exercised actual file exchange, separate filesystems, blocked
  descendant networking/host resources, unsafe exports, timeout/cancel descendants
  and cleanup, injected proxy credentials, exact orphan ownership and daemon-side
  lifetime termination. This gives 112 distinct passing current cases across these
  invocations, not complete host-environment coverage.
- Initial receiver tests in the tool sandbox could not bind loopback (`EPERM`):
  twenty-two cases timed out, with thirteen address checks passing. The fixture
  now handles listen failure immediately; the authorized loopback run passed.
- The first Docker batch stopped before container creation because the image
  inspection template assumed a present `Volumes` field. The next run passed seven
  cases; two descendant observers lacked Docker's required PID column. The focused
  corrected observers subsequently passed, with all temporary containers removed.
- Source review found and corrected mutable post-verification artifact capture,
  cancellation/deadline gaps, compressed IPv6 address admission and candidate-module
  spoofing of Python verification. Regression fixtures exercise these behaviors.
- A further review found Docker's automatic proxy-environment injection, which
  could expose a credential-bearing proxy URL through the long-lived container
  process. The real positive control first demonstrated injection, then verified
  that explicit clearing removes the synthetic credential from configuration,
  initial/current processes and descendants. [Docker proxy behavior](https://docs.docker.com/engine/cli/proxy/).
- Durable context claims prevent a second runner or steering from a separate
  database connection. A real owned child-host crash left an observed running
  container; restart removed it before refusing uncertain tool replay. The first
  crash-fixture attempt omitted a required timeout argument and failed during
  setup; its correction passed. Final cleanup cannot extend completion past the
  task deadline. Independent review of these joined paths found no remaining
  material issue within the enumerated boundary scope.
- Public-phase approval binds all prompt-bearing contract fields, files and web
  destinations. Fixed-public/varying-private fixtures produce identical observed
  public GET transcripts. Exact transfer receipts preserve provenance; session
  policy, cancellation, shared request limits and the wall deadline survive phases
  and resume. This remains a controlled transcript test, not live-web generality.
- An initial full-sandbox invocation used the wrong opt-in and skipped all thirteen
  tests. Its receipt is retained separately; only the corrected thirteen-pass
  invocation contributes evidence.

Current Node typechecking passes. This is not a full application/release test run.
The artifact-capable image subsequently passed its offline tooling qualification.
The first real local-model research session reached submission but failed independent
arithmetic acceptance; its separate eight-call verifier produced no review artifact.
See the [first-task report](MVP_PRIVATE_AGENT_FIRST_TASK_REPORT.md) for the current
failed ledger and bounded iteration. Local filter confirmation, the remaining
real-model task families, fresh comparison, composition and app acceptance remain
unfinished. No real private user input has entered these fixtures, and no historical
ledger has been rewritten by this stage.

The first development evidence checkpoint is SHA-256
`ebc98c18579f3fdb13cc155949372ac021149118f74e0fde92bd665611328398`.
It records source/test identities and retained negative receipts; it is expressly
not a final source freeze. A later reviewed source manifest is required by the
local operator entry point before effects and rechecked at closure. Raw fixtures, logs and temporary databases remain local
and ignored by Git. These boundary fixtures used **zero real model calls**. The
separately recorded artifact trials use the owned local endpoint; their declared
zero API fees do not establish zero device or operating cost.


## Budget and deadline iteration after the first task

The first task and verifier failures led to a generic execution improvement.
Before each model call, the host now supplies current remaining model/tool calls,
shared broker requests and active time. Invalid tool arguments receive fixed schema
feedback without invoking the requested action or refunding allowance. Static prompt,
tool and feedback identities bind resumes; older unfinished runs cannot silently
continue under the changed protocol.

A post-response check also stops a late or cancelled model response before any tool
starts. A durable marker retains the settled response and prevents its unstarted
action from replaying. This closes a delayed-timer edge found during source review.
The new instructions encourage source-derived calculations and incremental work;
their effect on real task quality remains untested.

Eleven focused cases and strict Node TypeScript pass on the final source. Ten existing
real HTTP/Docker runtime cases passed before the final deadline correction; the three
affected deadline/cancellation cases passed again afterward. The initial runtime
invocation used an unsupported CLI option and executed no tests; its failure is
retained. These checks do not qualify the rejected model verifier or the first task.

Current operator source identity:
`8c80cdea1e5f38160fe76b9e3fd4457a504755bc5bcdc191bb0d24bab5059f55`.
The original first-pass identity and complete source bytes are retained separately;
the old runner was reconstructed and matched its original digest exactly. Both
sixteen-file source snapshots are archived under ignored evidence. No new model
session, private-data admission, fee allowance or release is authorized by this
source qualification.
