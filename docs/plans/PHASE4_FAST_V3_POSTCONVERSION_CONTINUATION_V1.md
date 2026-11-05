# Fast-v3 continuation from the completed conversion

Status: **Proposed; new runtime authority is not granted.** The original serving
attempt failed and is consumed. This amendment requests one bounded continuation
from its verified image and completed conversion, overriding only the original
plan's stop-after-failure rule for this named continuation. The original approved
[trial plan](PHASE4_FAST_V3_ARTIFACT_TRIAL_V1.md), failure records, allocations,
technical gates and cutoff remain intact. No automatic retry follows this proposal.

## Current evidence

The two original-service baselines passed and settled at USD 0, with zero UNKNOWN
and cache tokens. They consumed **2 of 30** model-request slots: 10388 completed
output tokens, **19.944971 decode tokens/s** and **18.462977 full-request tokens/s**.
They provide a reference, without candidate improvement or H4 credit.

The admitted serving attempt built image
`sha256:9c0182182d93192a0f68225580bbe5bba6833474f979a9291f9dc1039e00f8dc`
and completed protected conversion in 311.44 seconds. Completion
`76da52fa609c3ad3ab3520e0f3e9cb34a79201838a69a2e39899764f4492071c`
records 300 converted matrices/scales across four shards, all 206 original weight
hashes/stat identities unchanged and 1134 nonselected tensor payloads verified.
The host then failed with `PermissionError` while reading root-owned mode-0600
completion metadata. Numerical checks, candidate startup, candidate qualification
and the artifact pilot did not run. Terminal
`4051a16b2aa681cd2d5699f98c4d658582880992487ee1158d611455b451968f`
and the initial zero-attempt preflight refusal remain preserved. Unused model slots
do not make the failed serving attempt unused.

The original automatic recovery subsequently produced its ready record and passed
ten current physical/ownership/lease/API checks at 23:11:40 UTC. It retains exact
qualified image
`sha256:10d0df20a140d12e987013b12da289e2dec0bcb1db4a14f2491d75c0c7ae5d6c`
and profile
`a799a126185582ea0465d9116e43543300f3a788cf72a263cc98e64a14eaa29e`,
with fresh physical identities, healthy idle API, 262144 context and engine
`0.1.dev20073+g8e685d198`. The separately prepared recovery-repair helper saw that
parent ready record before its claim or stop and exited successfully without
restarting anything. Root current-recovery acceptance
`e55349d9edc70c4fdb4bb742d3f1921bc6cd280600667e7a12c0a0b22907380f`
binds observation `56f22179e788af5d4701e2c4c56268006a6156f66af53a3c2c22bf187f1de622`
and independent review
`268fb15e82b03123990d1dbeafbb2f0619edee9991d127a121d882091b895467`.
It accepts current exact-profile recovery, while explicitly withholding candidate
resume, H4 and H5 authority. These checks dispatched no generation request and do
not qualify the fast-v3 image.

## Implemented correction, held execution

The fixed privileged reader preserves file ownership, modes and inodes. It opens
only the reviewed fixed metadata/shard paths without following symlinks, bounds
reads and output, and verifies exact hashes. A host snapshot supplies the same
verified bytes for hashing and parsing. It makes no permission change and does not
run conversion, a model, tokenizer or service action.

The inert continuation driver is implemented and independently source-reviewed:

| Binding | SHA-256 |
| --- | --- |
| Source manifest | `c20dc6d992485ab97bd80b378196dae5ec5d93a730c5c21150bf4181920af7d7` |
| Driver | `9fa516c65538f67ea30f7be36230eebd2c9ea5ca59773792466b08e9f9f3d1f8` |
| Fixed metadata reader | `672bdc009086a264c1efda734ebfa2456af208c04cbd482cfe49254087d92220` |
| Mandatory lease-order clarification | `b6dd8132394c8024a0a846f1d28e72a266cbffa49175a5978e2738f8bd523c02` |
| Mandatory clarification text | `a474b62fb4ad95d7d92cc63021a47389c9e30939b476e79d66cc6d549bbb6274` |

Twenty-one focused CPU cases pass, including actual frozen-helper integration,
an owned process-local startup alarm, same-buffer metadata integrity, lease-before-
GPU ordering and unknown stop/cleanup failure paths. Independent reviewers checked
the final source and original 43 serving assets. CPU evidence establishes these
control behaviors; it does not establish live numerical, startup or model results.
The original serving package, adapter and failed attempt remain unchanged.

## One requested amendment

Authorize **one continuation** using the exact existing image and completed hybrid
checkpoint. There is no rebuild, reconversion, new baseline, extra model-request
grant, second replacement, profile change or reset of historical claims. A failure
of this continuation ends its scope.

1. Keep the qualified service running while freezing the named owner decision,
   source/review/CI records and current recovery acceptance. Use fresh, exclusive
   continuation and recovery namespaces, units, claims and physical records.
   Bind original owner, attempt, terminal, build/conversion and recovery history;
   never replay or relabel an old claim or physical identity.
2. Before stopping anything, verify the exact current qualified unit/container,
   image, arguments, environment, six mounts, idle API and shared lease/marker.
   Under the reviewed bounded reader, snapshot and verify retained completion,
   preparation, started record, index and four converted shards; check all 206
   original identities, 202 unchanged links and eleven real metadata copies.
   Retained verification is bounded to ten minutes. Any drift or missing current
   recovery proof leaves the service running and ends this continuation.
3. Recheck current ownership immediately before stopping only that qualified
   unit. Confirm its captured container/listener absence and old marker removal.
   **Acquire, assign and verify the original-inode shared lease before checking
   post-stop GPU quiescence or available RAM.** Persist truthful unknown outcomes;
   uncertainty retains the owned marker and requires root reconciliation.
4. Enter at numerical verification, once: run the retained 22 GDN cases plus the
   two actual ratio-three/TP-one/BF16/sigmoid reference cases, without skips, and
   the refreshed top-k reference including ties. Retain the 15-minute, two-CPU,
   96-GiB RAM, GPU, disabled-network and bounded-log controls. Require at least 49 GiB
   ordinary-user free disk before this scope, the existing 24 GiB disk reserve,
   and 96 GiB available RAM after the owned stop. Unsupported limits or failed
   guards stop; no resource-floor waiver is included.
5. Start the exact candidate once, with the original 60-minute startup bound:
   MTP3, FP8 side weights, CUDA GDN, BF16 recurrent state, max sequences three,
   fixed 12 GiB KV and context 262144. Retain native tools/reasoning, Heavy role
   settings, offline/telemetry controls, compilation and sampling. Prove capacity
   for at least 262147 tokens, one full context plus speculative lookahead.
   No context reduction, MTP-off fallback, cache purge, VM/swap action, settings
   change, model/precision substitution or alternative candidate is permitted.
6. On numerical/startup/ownership failure, preserve bounded failure evidence and
   clean only captured owned resources. Restore the exact qualified image/profile
   only after confirmed cleanup, empty listener/GPU and exact lease/marker
   ownership, using the new source/owner-bound recovery namespace and one-use
   recovery claim. Unknown stop, lease or cleanup outcomes hold recovery for root
   reconciliation. No q4t switch or unrelated-resource action is included.
7. After actual numerical/startup acceptance, require reviewed versioned serving,
   token-admission, helper, all-eight-role and physical bindings for the new owner
   and source. Only then release the **remaining 16 candidate requests**, followed
   conditionally by **at most 12 artifact-pilot requests**. Keep the original
   global ledger: **30 total = 2 consumed baselines + 16 candidate + at most 12
   pilot**, with zero extra slots, warmups, replacements or hidden judge calls.
   Each failed/invalid/UNKNOWN dispatch consumes its slot. Do not reset a phase
   clock or use an unused slot for a diagnostic.

## Unchanged model, artifact and H4/H5 gates

Candidate qualification remains bounded to 60 minutes and the pilot to twelve
model requests, twelve tool actions and twenty minutes. Clamp every dispatch to
its remaining phase time and the existing new-admission cutoff. Preserve native
JSON/SSE framing, usage/token-admission parity, actual tool-result history,
separate reasoning, single-action tools, all eight role contracts and cache
write/read/isolation checks. The sole planned F15 cancellation may remain UNKNOWN;
six healthy/idle GET observations at twenty-second start intervals are required
before its sole F16 recovery. Any other unresolved or invalid response stops.

Use the frozen paired B1/F1 and B2/F14 request bodies and cold-cache semantics,
without another baseline. Each pair needs at least 512 completed output tokens.
Recompute actual token/duration rates: at least 1.5 times baseline combined
full-request TPS, at least 30 combined decode TPS and neither paired fixture
slower. These two pairs are limited feasibility evidence, without a promised
40-TPS result or quality equivalence.

Heavy writer/repair thinking stays enabled. The pilot must preserve substantive
`output/report.md` bytes, hash and time by four completed turns or five minutes,
whichever boundary is reached first, then pass existing artifact/claims checks
and root content review. The 20000
completed-output-token threshold remains a success criterion. No build,
conversion, startup, qualification or pilot result alone earns H4 credit.

Only accepted qualification and pilot evidence can admit exactly three fresh full
H4 loops, in local research, deck, split order, stopping at the first failure with
zero replacements. H5 remains conditional on all three accepted loops, usable
Claude split semantics, compatible current pins and independent blind scoring.
Retain all six historical H4 attempts, 352 dispatches, 348 settled and four
unresolved. The single all-history H4 split cap is **USD 0.60**. H5 remains **18
rows / USD 21.60 total / USD 3 cloud row / USD 0.60 split row**. Fresh H5 inputs,
candidates and evaluator gold remain isolated from implementers.

Every new qualification/pilot dispatch and new H4-loop/H5-row admission must
precede **2026-11-02 10:00 UTC (18:00 Asia/Shanghai)**. Existing admitted-row
bounds and permitted late closure remain; there is no extension.

## Release gate

Before runtime work, record one fresh named owner decision binding this exact
amendment, the frozen driver/reader and mandatory clarification, original failed
attempt/conversion and actual qualified recovery acceptance. Then require current
independent source review, required CI, exact assets, readiness and a fresh root
release. Generation additionally needs its reviewed versioned pins/admission
route and the unchanged ledger. Prepared or CPU-verified controls are not runtime
approval. If approval is declined or a gate fails, keep the qualified service and
preserve all evidence; do not perform another candidate attempt.
