# Fixture retry: disk preflight and one unused-candidate continuation

Status: **Proposed; this continuation is not approved or released.** The approved
[fixture retry](PHASE4_FAST_V3_FIXTURE_ADMISSION_RETRY_V1.md) remains the governing
experiment. This proposal requests one manual continuation after a disk preflight
refusal, with its resource floor, workload, allocation and cutoff unchanged.

## Observed refusal

On November 3, 2026, at 08:21:52 UTC, the candidate unit exited with status 2 and
`disk_start_below_49gib`. Its preserved record states `claimPresent=false` and
`noAutomaticRetry=true`. The check ran before a candidate claim, qualified-service
stop, numerical work or candidate startup. No qualification request was made.
The previously verified qualified service remained active at the follow-up
observation.

The relevant filesystem had approximately **45.23 GiB free**, below the unchanged
**49 GiB** startup floor. Reported reclaimable Docker images/cache were insufficient
to close that gap. The retained conversion is protected, and unrelated archives
and host caches are not an agent cleanup allowance. This is a disk-admission
refusal, not evidence of model performance or a failed generation.

Preserve these exact records:

| Record | SHA-256 |
| --- | --- |
| Preflight refusal | `e3ff568da5d3a39c636a7a705136bc769ac4fda732a53a43985eac2086e03e0d` |
| Unused candidate root release | `54f8ef1bb124bb29dc041a3f4063bc9a80278bc2c755ef71d7412b3167a3e1bf` |
| Installed base owner decision | `d8c6030fe792ad9910ea02aa84c06864750832d9c8af599fe05ae2beb994c622` |

## Owner-managed disk preparation

The owner frees **at least 5 GiB on the filesystem used by the candidate's disk
check**, using material the owner determines can be removed or moved. Preserve
the running qualified service; every pinned serving and tool image; original
weights and completed conversion; all ledger, failure, review and experiment
evidence; and the shared lease inode, marker and ownership state.

This proposal authorizes no agent deletion, Docker prune, cache purge, archive
removal, lease manipulation, rebuild or reconversion. It grants no new qualified-service
restoration or restart. Freeing 5 GiB is a preparation target: root must
measure **at least 49 GiB actually available** afterward, and the unchanged driver
must still pass its own disk check when invoked. Another filesystem's capacity,
expected reclaimable bytes or a rounded estimate does not satisfy the gate.

## Explicit one-time continuation

After the owner confirms disk preparation and explicitly approves this named
continuation, root may perform the following sequence once:

1. Preserve the failed candidate unit's terminal status, exit result, refusal
   bytes and old root-release bytes in immutable, hash-bound history. Confirm the
   exact candidate unit has no main process and that no `resume-attempt` serving
   claim, stop outcome, numerical work or candidate deployment exists in this
   retry namespace. Neither new ledger phase claim `candidate:fixture-retry-v1`
   nor `pilot:fixture-retry-v1` may exist. Preserve the original baseline and
   candidate phase claims. If that premise is false or uncertain, stop this
   continuation.
2. Verify available disk is at least 49 GiB and all protected assets/source
   bindings are unchanged. Obtain fresh physical/API/passive-lease evidence and
   independent/root acceptance for the **same running qualified service** using
   the existing freshness limits. Service, ownership or resource drift stops the
   path; this proposal supplies no repair or replacement authority.
3. Keep base owner decision `d8c6030…` unchanged: the live ready record and lease
   already bind it. Record the new owner approval separately as an additive
   continuation decision bound to this document, that base owner, the exact
   refusal and prior release, current no-claim evidence, unchanged source
   manifests and existing cutoff. It must authorize only this one pre-claim
   continuation, not another serving attempt after a claim or failed phase.
4. Produce and review a fresh candidate root release binding the same base owner
   and actual qualified-ready record, fresh acceptance and lease evidence, and
   the additive continuation decision. Retain the original approved plan hash
   and all existing limits. Archive the previous canonical release byte-for-byte
   before installing the new release; retain the original preflight-failure
   record. Do not erase or relabel either refusal or release.
5. If the exact failed transient candidate unit requires `reset-failed` before
   launch, perform only that unit-lifecycle reset after approval, preserved
   terminal evidence and confirmed no main process/owned candidate resources.
   Do not restart the qualified service, reset any state directory, remove a
   claim, reopen a phase, or reset a ledger or clock. Use the same candidate
   namespace and unchanged reviewed launch command.
6. Before invoking the candidate command, create an exclusive durable consumption
   record for this **manual continuation permission**, bound to its decision and
   fresh release. Then invoke it once. This separate root control prevents a
   repeated pre-claim loop; the frozen candidate claim guards the serving attempt
   and does not itself enforce this additional manual permission. A second
   refusal consumes this permission and stops, even if the candidate claim is
   still absent. Preserve any new refusal separately without overwriting history.

Successful preflight proceeds through the original claim, asset verification,
captured qualified-service stop, lease handoff, numerical tests and candidate
startup gates. Their order, bounds and existing scoped failure cleanup/recovery
remain unchanged. This proposal grants no additional recovery and no automatic
retry at any stage.

## Unchanged experiment and source

| Binding | SHA-256 |
| --- | --- |
| Approved fixture-retry plan | `182fe5ac9cbe5ae37996a7d7d1ee12cad4809dcf10c447fef2e1bda808c70ef1` |
| Serving source | `d76b09b1c48cf6fb65b2a460fdd0b347189fc58dbe04db99585279741892b0b0` |
| Local admission source | `4ca913d9fe65e3646bfde0cde06c90b551a5e5fe81fefb43d8502889656292ef` |
| Provenance source | `47c2865dd7e6821a49069731094e1c944c1b26b9200f74165134c5ac52fae981` |
| Downstream source | `77a24e3a600ce1e5c1a7a7aad40182fb1834b4d72687c8ddc0af7f132998ef24` |

No source change or lower resource floor is proposed. Retain all four historical
standalone slots, all sixteen fresh qualification cases and up to twelve pilot
requests within the same **32-slot aggregate**, all zero-fee. This preflight
refusal adds no model slot and refunds none. Baselines, full paired performance,
cold-cache, native context/role, artifact and claims gates remain unchanged.

The pilot earns no H4 credit. Exactly three conditional H4 loops still precede
H5; preserve the **USD 0.60 all-history H4 split cap** and H5's **18 rows,
USD 21.60 total, USD 3 per cloud row and USD 0.60 per split row**, with no
replacements and independent blind scoring. Fresh H5 inputs, candidates and
evaluator gold remain isolated.

Every new admission remains before **November 4, 2026, 10:00 UTC / 18:00
Asia/Shanghai**. Existing admitted-work closure rules remain; no window extension
or new phase allowance follows from disk preparation. Until the owner approves
this continuation and the actual gates pass, retain the current qualified
service and keep the candidate/pilot/H4/H5 path stopped.
