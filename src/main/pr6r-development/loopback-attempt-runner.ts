import {
  AttemptUnitOfWork,
  type AtomicPersistenceFaultPoint,
} from "../attempt-unit-of-work";
import type { BudgetLedger, BudgetReservation } from "../budget-ledger";
import type { ReviewResultV1 } from "../../shared/review-result-contract";
import {
  buildPr6rCloudSlotBinding,
  bindPr6rCampaignExecutionAuthority,
  claimPr6rCloudSlot,
  assertPr6rCrossStoreReconciledTerminalLedger,
  preparePr6rCloudSlotDispatchArm,
  reconcilePr6rCloudSlotTerminal,
  recoverPr6rCloudSlot,
  recoverPr6rPersistedCloudSlotTerminal,
  terminalizePr6rCloudSlotFromSqliteReceipt,
  type Pr6rCampaignAuthority,
  type Pr6rCrossStoreReconciledTerminalAuthority,
} from "./authority-ledger";
import {
  readPr6rFixtureListenerBinding,
  type Pr6rFixtureListenerCapability,
} from "./fixture-server";
import {
  assertPr6rPreparedLoopbackAttempt,
  preparePr6rLoopbackAttemptFinish,
  type PreparedPr6rLoopbackAttempt,
} from "./loopback-attempt-adapter";
import {
  dispatchPr6rLoopbackRequest,
} from "./loopback-transport";
import {
  mintPr6rLoopbackDispatchGrant,
} from "./loopback-transport-authority";
import {
  assertPr6rCanonicalLedgerAuthority,
  assertPr6rCanonicalLedgerAuthorityForRuntime,
  type Pr6rCanonicalLedgerAuthority,
  type Pr6rDevelopmentRuntimeAuthority,
} from "./runtime-authority";
import {
  bindPr6rCommittedAttemptFinish,
  bindPr6rCommittedBudgetedStart,
  commitPr6rOpenAttemptRecovery,
  commitPr6rPreReservationCancellation,
  recoverPr6rSqliteTerminalReceipt,
} from "./sqlite-attempt-authority";

export type Pr6rLoopbackSagaFaultPoint =
  | "after_os_slot_claim"
  | "after_os_dispatch_arm"
  | "after_sqlite_cancellation_commit"
  | "after_sqlite_start_commit"
  | "after_transport_started"
  | "after_transport_result"
  | "after_sqlite_finish_commit"
  | "after_sqlite_recovery_commit"
  | "after_os_terminal";

export interface RunPreparedPr6rLoopbackAttemptInput {
  readonly campaignAuthority: Pr6rCampaignAuthority;
  readonly priorTerminalAuthority?: Pr6rCrossStoreReconciledTerminalAuthority;
  readonly runtimeAuthority: Pr6rDevelopmentRuntimeAuthority;
  readonly canonicalLedgerAuthority: Pr6rCanonicalLedgerAuthority;
  readonly listenerCapability: Pr6rFixtureListenerCapability;
  readonly preparedAttempt: PreparedPr6rLoopbackAttempt;
  readonly ledger: BudgetLedger;
  readonly signal?: AbortSignal;
  /** Production supplies a cryptographically random ID source; tests use a queue. */
  readonly nextId: () => string;
  /** Production supplies a canonical UTC clock; tests use fixed timestamps. */
  readonly now: () => string;
  /** Test-only crash seam. Production callers omit it. */
  readonly faultInjector?: (point: Pr6rLoopbackSagaFaultPoint) => void;
  /** Test-only SQLite rollback seam, always bound to the supplied ledger. */
  readonly persistenceFaultInjector?: (
    point: AtomicPersistenceFaultPoint,
  ) => void;
}

export type RunPreparedPr6rLoopbackAttemptResult =
  | {
      readonly status: "cancelled_before_dispatch";
      readonly terminalAuthority: Pr6rCrossStoreReconciledTerminalAuthority;
    }
  | {
      readonly status: "budget_denied";
      readonly reason:
        | "campaign_overrun"
        | "episode_cap"
        | "campaign_automatic_stop"
        | "campaign_hard_ceiling";
      readonly terminalAuthority: Pr6rCrossStoreReconciledTerminalAuthority;
    }
  | {
      readonly status: "finished";
      readonly terminalAuthority: Pr6rCrossStoreReconciledTerminalAuthority;
      readonly reservation: BudgetReservation;
      /** Main-process only. R-A2 does not persist or evidence-accept this value. */
      readonly reviewResult?: ReviewResultV1;
    };

export class Pr6rLoopbackSagaError extends Error {
  constructor(
    readonly code:
      | "pr6r_slot_already_consumed"
      | "pr6r_budget_resolution_invalid"
      | "pr6r_dispatch_preflight_invalid"
      | "pr6r_runtime_source_invalid",
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "Pr6rLoopbackSagaError";
  }
}

export interface RecoverPr6rLoopbackAttemptInput {
  readonly campaignAuthority: Pr6rCampaignAuthority;
  readonly canonicalLedgerAuthority: Pr6rCanonicalLedgerAuthority;
  readonly applicationRequest: unknown;
  readonly reservationId: string;
  readonly ledger: BudgetLedger;
  readonly nextId: () => string;
  readonly now: () => string;
  /** Test-only crash seam. Production callers omit it. */
  readonly faultInjector?: (point: Pr6rLoopbackSagaFaultPoint) => void;
}

export type RecoverPr6rLoopbackAttemptResult =
  | {
      readonly status: "reconciled";
      readonly recoveredOpenAttempt: boolean;
      readonly terminalAuthority: Pr6rCrossStoreReconciledTerminalAuthority;
    }
  | {
      readonly status: "blocked";
      readonly reason:
        | "os_evidence_missing_or_conflicting"
        | "sqlite_evidence_missing_or_conflicting"
        | "cross_store_evidence_conflicting";
    };

function invokeFault(
  input: RunPreparedPr6rLoopbackAttemptInput,
  point: Pr6rLoopbackSagaFaultPoint,
): void {
  input.faultInjector?.(point);
}

function allocateIds(nextId: () => string, count: number): string[] {
  let values: string[];
  try {
    values = Array.from({ length: count }, () => nextId());
  } catch (error) {
    throw new Pr6rLoopbackSagaError("pr6r_runtime_source_invalid", {
      cause: error,
    });
  }
  if (
    values.some(
      (value) =>
        typeof value !== "string" ||
        value !== value.trim() ||
        value.length === 0 ||
        value.length > 256,
    ) ||
    new Set(values).size !== values.length
  ) {
    throw new Pr6rLoopbackSagaError("pr6r_runtime_source_invalid");
  }
  return values;
}

function captureTimestamp(now: () => string, minimum: string): string {
  let value: string;
  try {
    value = now();
  } catch (error) {
    throw new Pr6rLoopbackSagaError("pr6r_runtime_source_invalid", {
      cause: error,
    });
  }
  const milliseconds = Date.parse(value);
  const minimumMilliseconds = Date.parse(minimum);
  if (
    !Number.isFinite(milliseconds) ||
    !Number.isFinite(minimumMilliseconds) ||
    new Date(milliseconds).toISOString() !== value ||
    milliseconds < minimumMilliseconds ||
    milliseconds > Date.now()
  ) {
    throw new Pr6rLoopbackSagaError("pr6r_runtime_source_invalid");
  }
  return value;
}

function finishTimestampFromCompletionObservation(startedAt: string): string {
  const startedAtMs = Date.parse(startedAt);
  const observedAtMs = Date.now();
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(observedAtMs)) {
    throw new Pr6rLoopbackSagaError("pr6r_runtime_source_invalid");
  }
  const completedAtMs = Math.max(startedAtMs, observedAtMs);
  return new Date(completedAtMs).toISOString();
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function assertDispatchPreflight(
  runtimeAuthority: Pr6rDevelopmentRuntimeAuthority,
  canonicalLedgerAuthority: Pr6rCanonicalLedgerAuthority,
  ledger: BudgetLedger,
  listenerCapability: Pr6rFixtureListenerCapability,
  expectedOrigin: string,
): void {
  try {
    assertPr6rCanonicalLedgerAuthorityForRuntime(canonicalLedgerAuthority, {
      runtimeAuthority,
      ledger,
    });
    const listener = readPr6rFixtureListenerBinding(listenerCapability);
    if (listener.origin !== expectedOrigin) {
      throw new Error("listener origin mismatch");
    }
  } catch (error) {
    throw new Pr6rLoopbackSagaError("pr6r_dispatch_preflight_invalid", {
      cause: error,
    });
  }
}

/**
 * Execute the fixed R-A2 post-import saga once. The prepared attempt carries
 * the nominal checkpoint proof; every later side effect is authorized by the
 * immediately preceding durable or process-local receipt.
 *
 * There is deliberately no await, cancellation callback, or fault seam
 * between an admitted SQLite commit and grant mint plus request start.
 */
export async function runPreparedPr6rLoopbackAttempt(
  input: RunPreparedPr6rLoopbackAttemptInput,
): Promise<RunPreparedPr6rLoopbackAttemptResult> {
  const prepared = input.preparedAttempt;
  const applicationRequest = prepared.applicationRequest;
  const reservationId = prepared.reservationId;
  // Drain and validate every caller-supplied deterministic source before the
  // final live prepared/runtime/listener checks. A hostile test callback may
  // mutate SQLite or close the listener; the checks below must observe that
  // mutation before any OS claim.
  const allocatedIds = allocateIds(input.nextId, 16);
  const sagaCreatedAt = captureTimestamp(input.now, prepared.createdAt);
  // Reject structural clones and store transplants before the first OS or
  // SQLite side effect. This check is intentionally read-only: the later
  // atomic start/cancellation path still consumes the one-use commit proof.
  assertPr6rPreparedLoopbackAttempt(prepared, {
    store: input.ledger.eventStore,
    applicationRequest,
    asOf: sagaCreatedAt,
  });
  assertDispatchPreflight(
    input.runtimeAuthority,
    input.canonicalLedgerAuthority,
    input.ledger,
    input.listenerCapability,
    applicationRequest.origin,
  );
  try {
    if (input.priorTerminalAuthority !== undefined) {
      await assertPr6rCrossStoreReconciledTerminalLedger(
        input.priorTerminalAuthority,
        input.ledger,
      );
    }
    await bindPr6rCampaignExecutionAuthority(input.campaignAuthority, {
      executionAuthority: input.canonicalLedgerAuthority,
      implementationRevision: prepared.implementationRevision,
    });
  } catch (error) {
    throw new Pr6rLoopbackSagaError("pr6r_dispatch_preflight_invalid", {
      cause: error,
    });
  }
  // Both admission alternatives and every later terminal ID were allocated
  // before the final live preflight. Admission chooses one start batch only.
  const eventIds = Object.freeze({
    admitted: allocatedIds.slice(0, 6),
    denied: allocatedIds.slice(6, 11),
    cancellation: allocatedIds[11]!,
    finish: allocatedIds.slice(12, 15),
    terminalLedgerEntry: allocatedIds[15]!,
  });
  const slotBinding = buildPr6rCloudSlotBinding({
    applicationRequest,
    reservationId,
  });
  const claimed = await claimPr6rCloudSlot(
    input.campaignAuthority,
    slotBinding,
    input.priorTerminalAuthority,
  );
  if (claimed.status !== "claimed") {
    throw new Pr6rLoopbackSagaError("pr6r_slot_already_consumed");
  }
  invokeFault(input, "after_os_slot_claim");

  // This is the final asynchronous OS read before the synchronous admission,
  // grant-consumption, and request-start critical section.
  const osDispatchArm = await preparePr6rCloudSlotDispatchArm(claimed);
  invokeFault(input, "after_os_dispatch_arm");

  if (isAborted(input.signal)) {
    const receipt = commitPr6rPreReservationCancellation({
      ledger: input.ledger,
      preparedAttemptAuthority: prepared.commitAuthority,
      applicationRequest,
      reservationId,
      reason: "Cancelled before PR6R loopback dispatch.",
      eventId: eventIds.cancellation,
      createdAt: sagaCreatedAt,
    });
    invokeFault(input, "after_sqlite_cancellation_commit");
    const terminalAuthority =
      await terminalizePr6rCloudSlotFromSqliteReceipt(claimed, {
        sqliteTerminalReceipt: receipt,
        applicationRequest,
        reservationId,
      });
    invokeFault(input, "after_os_terminal");
    return Object.freeze({
      status: "cancelled_before_dispatch" as const,
      terminalAuthority,
    });
  }

  const attempts = new AttemptUnitOfWork(input.ledger, {
    ...(input.persistenceFaultInjector === undefined
      ? {}
      : { faultInjector: input.persistenceFaultInjector }),
  });
  const committedStart = attempts.commitBudgetedStart({
    sessionId: prepared.childSessionId,
    expectedSequence: prepared.expectedSequence,
    createdAt: prepared.createdAt,
    eventIds: {
      admitted: eventIds.admitted,
      denied: eventIds.denied,
    },
    campaignId: prepared.campaignId,
    reservationId,
    attemptId: prepared.attemptId,
    providerId: prepared.providerId,
    pricingSnapshotId: prepared.pricingSnapshotId,
    costScope: prepared.costScope,
    cloudEgressAdmissionId: prepared.cloudEgressAdmissionId,
    projection: prepared.projection,
    buildEvents: prepared.buildEvents,
  });
  invokeFault(input, "after_sqlite_start_commit");
  const boundStart = bindPr6rCommittedBudgetedStart({
    committed: committedStart,
    preparedAttemptAuthority: prepared.commitAuthority,
    applicationRequest,
    reservationId,
  });

  if (boundStart.status === "budget_denied") {
    const terminalAuthority =
      await terminalizePr6rCloudSlotFromSqliteReceipt(claimed, {
        sqliteTerminalReceipt: boundStart.receipt,
        applicationRequest,
        reservationId,
      });
    invokeFault(input, "after_os_terminal");
    return Object.freeze({
      status: "budget_denied" as const,
      reason: boundStart.reason,
      terminalAuthority,
    });
  }

  const resolution = committedStart.budgetResolution;
  if (resolution?.status !== "admitted") {
    throw new Pr6rLoopbackSagaError("pr6r_budget_resolution_invalid");
  }
  const reservation = Object.freeze({ ...resolution.reservation });

  // Keep this synchronous adjacency intact. dispatchPr6rLoopbackRequest burns
  // the grant and calls request.end before returning its promise.
  const grant = mintPr6rLoopbackDispatchGrant({
    runtimeAuthority: input.runtimeAuthority,
    listenerCapability: input.listenerCapability,
    osDispatchArm,
    sqliteDispatchAuthority: boundStart.authority,
    applicationRequest,
    reservationId,
  });
  const transportPromise = dispatchPr6rLoopbackRequest({
    grant,
    applicationRequest,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  invokeFault(input, "after_transport_started");
  const transportResult = await transportPromise;
  invokeFault(input, "after_transport_result");

  const startedMessage = committedStart.events.find(
    (event) => event.type === "assistant.message.started",
  );
  const compiledContext = committedStart.events.find(
    (event) => event.type === "context.compiled",
  );
  if (
    startedMessage?.type !== "assistant.message.started" ||
    compiledContext?.type !== "context.compiled"
  ) {
    throw new Pr6rLoopbackSagaError("pr6r_budget_resolution_invalid");
  }
  const preparedFinish = preparePr6rLoopbackAttemptFinish({
    applicationRequest,
    checkpointId: compiledContext.payload.checkpointId,
    messageId: startedMessage.payload.messageId,
    reservation,
    transportResult,
    cancelledAfterTransport: isAborted(input.signal),
  });
  const startLastSequence = committedStart.events.at(-1)?.sequence;
  if (startLastSequence === undefined) {
    throw new Pr6rLoopbackSagaError("pr6r_budget_resolution_invalid");
  }
  const finishedAt = finishTimestampFromCompletionObservation(sagaCreatedAt);
  const committedFinish = attempts.commitAttemptFinish({
    sessionId: prepared.childSessionId,
    expectedSequence: startLastSequence,
    createdAt: finishedAt,
    eventIds: eventIds.finish.slice(0, preparedFinish.events.length),
    terminalLedgerEntryId: eventIds.terminalLedgerEntry,
    events: preparedFinish.events,
  });
  invokeFault(input, "after_sqlite_finish_commit");
  const sqliteTerminalReceipt = bindPr6rCommittedAttemptFinish({
    committed: committedFinish,
    preparedFinishAuthority: preparedFinish.commitAuthority,
    applicationRequest,
    reservationId,
  });
  const terminalAuthority =
    await terminalizePr6rCloudSlotFromSqliteReceipt(claimed, {
      sqliteTerminalReceipt,
      applicationRequest,
      reservationId,
    });
  invokeFault(input, "after_os_terminal");
  return Object.freeze({
    status: "finished" as const,
    terminalAuthority,
    reservation,
    ...(preparedFinish.reviewResult === undefined
      ? {}
      : { reviewResult: preparedFinish.reviewResult }),
  });
}

/**
 * Reconcile one already-claimed R-A2 slot after restart. This path has no
 * runtime authority, listener capability, grant, or transport call, so it can
 * never redispatch. An admitted open attempt is conservatively interrupted
 * and charged its full reservation before OS terminal publication.
 */
export async function recoverPr6rLoopbackAttempt(
  input: RecoverPr6rLoopbackAttemptInput,
): Promise<RecoverPr6rLoopbackAttemptResult> {
  assertPr6rCanonicalLedgerAuthority(input.canonicalLedgerAuthority, {
    ledger: input.ledger,
  });
  const recoveryIds = allocateIds(input.nextId, 3);
  const recoveryAt = captureTimestamp(input.now, "1970-01-01T00:00:00.000Z");
  const slotBinding = buildPr6rCloudSlotBinding({
    applicationRequest: input.applicationRequest,
    reservationId: input.reservationId,
  });
  const recoveryEventIds = Object.freeze([
    recoveryIds[0]!,
    recoveryIds[1]!,
  ] as const);
  const terminalLedgerEntryId = recoveryIds[2]!;

  let osRecovery: Awaited<ReturnType<typeof recoverPr6rCloudSlot>>;
  try {
    osRecovery = await recoverPr6rCloudSlot(
      input.campaignAuthority,
      slotBinding,
    );
  } catch {
    return Object.freeze({
      status: "blocked" as const,
      reason: "os_evidence_missing_or_conflicting" as const,
    });
  }

  const sqliteRecovery = recoverPr6rSqliteTerminalReceipt({
    ledger: input.ledger,
    applicationRequest: input.applicationRequest,
    reservationId: input.reservationId,
  });
  let sqliteReceipt;
  let recoveredOpenAttempt = false;
  if (sqliteRecovery.status === "blocked") {
    if (sqliteRecovery.reason !== "admitted_attempt_open") {
      return Object.freeze({
        status: "blocked" as const,
        reason: "sqlite_evidence_missing_or_conflicting" as const,
      });
    }
    try {
      sqliteReceipt = commitPr6rOpenAttemptRecovery({
        ledger: input.ledger,
        applicationRequest: input.applicationRequest,
        reservationId: input.reservationId,
        createdAt: recoveryAt,
        eventIds: recoveryEventIds,
        terminalLedgerEntryId,
      });
    } catch {
      return Object.freeze({
        status: "blocked" as const,
        reason: "sqlite_evidence_missing_or_conflicting" as const,
      });
    }
    recoveredOpenAttempt = true;
    input.faultInjector?.("after_sqlite_recovery_commit");
  } else {
    sqliteReceipt = sqliteRecovery.receipt;
  }

  let terminalAuthority: Pr6rCrossStoreReconciledTerminalAuthority;
  try {
    terminalAuthority =
      osRecovery.status === "recovery_only"
        ? await terminalizePr6rCloudSlotFromSqliteReceipt(osRecovery, {
            sqliteTerminalReceipt: sqliteReceipt,
            applicationRequest: input.applicationRequest,
            reservationId: input.reservationId,
          })
        : await reconcilePr6rCloudSlotTerminal(
            await recoverPr6rPersistedCloudSlotTerminal(
              input.campaignAuthority,
              slotBinding,
            ),
            {
              sqliteTerminalReceipt: sqliteReceipt,
              applicationRequest: input.applicationRequest,
              reservationId: input.reservationId,
            },
          );
  } catch {
    return Object.freeze({
      status: "blocked" as const,
      reason: "cross_store_evidence_conflicting" as const,
    });
  }
  input.faultInjector?.("after_os_terminal");
  return Object.freeze({
    status: "reconciled" as const,
    recoveredOpenAttempt,
    terminalAuthority,
  });
}
