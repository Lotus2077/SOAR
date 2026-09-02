import {
  AttemptUnitOfWork,
  consumeAttemptFinishPersistenceReceipt,
  consumeAttemptStartPersistenceReceipt,
  type CommittedAttemptFinish,
  type CommittedAttemptStart,
} from "../attempt-unit-of-work";
import {
  BUDGET_CACHE_ASSUMPTION,
  BUDGET_ROUNDING_POLICY,
  type BudgetLedger,
  type BudgetLedgerTransaction,
  type BudgetReservation,
  type BudgetTerminalEntry,
} from "../budget-ledger";
import type { SessionState } from "../../shared/session-reducer";
import {
  consumePr6rPreparedLoopbackAttemptAuthority,
  consumePr6rPreparedLoopbackFinishAuthority,
  type Pr6rPreparedLoopbackAttemptAuthority,
  type Pr6rPreparedLoopbackFinishAuthority,
} from "./loopback-attempt-adapter";
import {
  CloudApplicationRequestV1Schema,
  PR6R_CAMPAIGN_ID,
  PR6R_LOOPBACK_CANCELLED_NOT_SENT_REASONS,
  PR6R_LOOPBACK_CANCELLED_UNKNOWN_REASONS,
  PR6R_LOOPBACK_FAILED_NOT_SENT_REASONS,
  PR6R_LOOPBACK_FAILED_SENT_REASONS,
  PR6R_LOOPBACK_FAILED_UNKNOWN_REASONS,
  PR6R_REQUESTED_OUTPUT_TOKENS,
  PR6R_SIMULATION_INPUT_RATE_MICROUSD_PER_MILLION,
  PR6R_SIMULATION_OUTPUT_RATE_MICROUSD_PER_MILLION,
  PR6R_SIMULATION_PRICING_SNAPSHOT_ID,
  PR6R_SYNTHETIC_PROVIDER_ID,
  calculatePr6rHostPricedSimulationCostMicrousd,
  canonicalPr6rJsonV1,
  canonicalPr6rCloudApplicationRequestSha256,
  type CloudApplicationRequestV1,
} from "../../shared/pr6r-development-contracts";

export class Pr6rSqliteAuthorityError extends Error {
  readonly code = "PR6R_SQLITE_AUTHORITY_INVALID";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "Pr6rSqliteAuthorityError";
  }
}

export interface Pr6rSqliteRequestBinding {
  readonly slotId: "cloud_synthesis" | "hybrid_cloud_if_selected";
  readonly requestId: string;
  readonly origin: string;
  readonly applicationRequestSha256: string;
  readonly canonicalBodySha256: string;
  readonly commonCheckpointSha256: string;
  readonly synthesisSessionId: string;
  readonly attemptId: string;
  readonly reservationId: string;
}

export interface Pr6rSqliteDispatchBinding
  extends Pr6rSqliteRequestBinding {
  readonly providerId: string;
  readonly cloudEgressAdmissionId: string;
  readonly projectedMicrousd: number;
  readonly dispatchChain: Pr6rSqliteDispatchChain;
}

export interface Pr6rSqliteDispatchChain {
  readonly kind: "pr6r_sqlite_dispatch_chain";
  readonly attemptId: string;
  readonly reservationId: string;
}

export interface Pr6rSqliteTerminalBinding
  extends Pr6rSqliteRequestBinding {
  readonly terminalOutcome: "completed" | "failed" | "cancelled";
  readonly requestDisposition: "not_sent" | "sent" | "unknown";
  readonly stableCode: string;
  readonly terminalAt: string;
  readonly reservationProjectedMicrousd?: number;
  readonly attemptEvidence?: Pr6rSqliteAttemptTerminalEvidence;
  readonly terminalBudgetEntry?: BudgetTerminalEntry;
}

export interface Pr6rSqliteAttemptTerminalEvidence {
  readonly outcome:
    | "succeeded"
    | "provider_error"
    | "protocol_error"
    | "cancelled"
    | "timeout"
    | "interrupted";
  readonly requestDisposition: "not_sent" | "sent" | "unknown";
  readonly stableCode: string;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly reasoningTokens: number;
    readonly cacheReadTokens: number;
    readonly cacheWriteTokens: 0;
    readonly reported: boolean;
  };
  readonly cost: {
    readonly amountMicrousd: number;
    readonly provenance:
      | "local_zero_cost_policy"
      | "provider_reported"
      | "host_pricing_snapshot"
      | "reserved_unknown";
    readonly reservationId: string;
    readonly costScope: "simulation";
  };
  readonly latencyMs: number;
  readonly responseBodySha256?: string;
  readonly reviewResultSha256?: string;
}

export interface Pr6rSqliteDispatchAuthority {
  readonly kind: "pr6r_sqlite_dispatch_authority";
  readonly requestId: string;
  readonly attemptId: string;
  readonly reservationId: string;
  readonly dispatchChain: Pr6rSqliteDispatchChain;
}

export interface Pr6rSqliteTerminalReceipt {
  readonly kind: "pr6r_sqlite_terminal_receipt";
  readonly requestId: string;
  readonly attemptId: string;
  readonly reservationId: string;
}

export interface Pr6rSqliteTerminalWitness {
  readonly kind: "pr6r_sqlite_terminal_witness";
  readonly requestId: string;
  readonly attemptId: string;
  readonly reservationId: string;
}

export interface Pr6rConsumedSqliteTerminalForReconciliation {
  readonly binding: Pr6rSqliteTerminalBinding;
  readonly witness: Pr6rSqliteTerminalWitness;
}

interface DispatchPrivateState {
  consumed: boolean;
  ledger: BudgetLedger;
  binding: Pr6rSqliteDispatchBinding;
}

interface TerminalPrivateState {
  consumed: boolean;
  ledger: BudgetLedger;
  binding: Pr6rSqliteTerminalBinding;
}

const dispatchPrivateState = new WeakMap<
  Pr6rSqliteDispatchAuthority,
  DispatchPrivateState
>();
const terminalPrivateState = new WeakMap<
  Pr6rSqliteTerminalReceipt,
  TerminalPrivateState
>();
const dispatchChainPrivateState = new WeakMap<
  Pr6rSqliteDispatchChain,
  BudgetLedger
>();
const terminalWitnessPrivateState = new WeakMap<
  Pr6rSqliteTerminalWitness,
  { readonly ledger: BudgetLedger; readonly binding: Pr6rSqliteTerminalBinding }
>();

function fail(message: string, cause?: unknown): never {
  throw new Pr6rSqliteAuthorityError(
    message,
    cause === undefined ? undefined : { cause },
  );
}

function requestBinding(
  request: CloudApplicationRequestV1,
  reservationId: string,
): Pr6rSqliteRequestBinding {
  return Object.freeze({
    slotId: request.slotId,
    requestId: request.requestId,
    origin: request.origin,
    applicationRequestSha256:
      canonicalPr6rCloudApplicationRequestSha256(request),
    canonicalBodySha256: request.canonicalBodySha256,
    commonCheckpointSha256: request.commonCheckpointSha256,
    synthesisSessionId: request.synthesisSessionId,
    attemptId: request.attemptId,
    reservationId,
  });
}

function sameRequestBinding(
  left: Pr6rSqliteRequestBinding,
  right: Pr6rSqliteRequestBinding,
): boolean {
  return (
    left.slotId === right.slotId &&
    left.requestId === right.requestId &&
    left.origin === right.origin &&
    left.applicationRequestSha256 === right.applicationRequestSha256 &&
    left.canonicalBodySha256 === right.canonicalBodySha256 &&
    left.commonCheckpointSha256 === right.commonCheckpointSha256 &&
    left.synthesisSessionId === right.synthesisSessionId &&
    left.attemptId === right.attemptId &&
    left.reservationId === right.reservationId
  );
}

function assertRequestMatchesImport(
  state: SessionState,
  request: CloudApplicationRequestV1,
): void {
  const imported = state.synthesisCheckpointImport;
  if (
    imported === undefined ||
    imported.parentSessionId !== request.parentSessionId ||
    imported.commonCheckpointSha256 !== request.commonCheckpointSha256 ||
    imported.packetSha256 !== request.packetSha256 ||
    imported.semanticMessagesSha256 !== request.semanticMessagesSha256 ||
    imported.responseSchemaSha256 !== request.responseSchemaSha256 ||
    imported.reviewSnapshotId !== request.snapshotId ||
    state.id !== request.synthesisSessionId
  ) {
    fail("SQLite child does not match the sealed application request import.");
  }
}

function assertReservationMatches(
  reservation: BudgetReservation,
  request: CloudApplicationRequestV1,
  reservationId: string,
): void {
  if (
    reservation.id !== reservationId ||
    reservation.campaignId !== PR6R_CAMPAIGN_ID ||
    reservation.sessionId !== request.synthesisSessionId ||
    reservation.attemptId !== request.attemptId ||
    reservation.providerId !== PR6R_SYNTHETIC_PROVIDER_ID ||
    reservation.pricingSnapshotId !== PR6R_SIMULATION_PRICING_SNAPSHOT_ID ||
    reservation.costScope !== "simulation" ||
    reservation.cloudEgressAdmissionId === undefined ||
    reservation.billableEstimatedInputTokens !==
      request.estimatedInputTokens ||
    reservation.requestedMaxOutputTokens !== PR6R_REQUESTED_OUTPUT_TOKENS ||
    reservation.cacheReadTokensAssumed !== 0 ||
    reservation.inputRateMicrousdPerMillion !==
      PR6R_SIMULATION_INPUT_RATE_MICROUSD_PER_MILLION ||
    reservation.outputRateMicrousdPerMillion !==
      PR6R_SIMULATION_OUTPUT_RATE_MICROUSD_PER_MILLION ||
    reservation.cacheReadRateMicrousdPerMillion !== 0 ||
    reservation.providerFeeCeilingMicrousd !== 0 ||
    reservation.cacheAssumption !== BUDGET_CACHE_ASSUMPTION ||
    reservation.roundingPolicy !== BUDGET_ROUNDING_POLICY
  ) {
    fail("Simulation reservation does not match the sealed application request.");
  }
}

function exactCommittedEventsStillPresent(
  ledger: BudgetLedger,
  sessionId: string,
  committedEvents: readonly {
    id: string;
    sequence: number;
    type: string;
    payload: unknown;
    createdAt: string;
  }[],
): boolean {
  const events = ledger.eventStore.getEvents(sessionId);
  const bySequence = new Map(events.map((event) => [event.sequence, event]));
  return committedEvents.every((committed) => {
    const stored = bySequence.get(committed.sequence);
    return (
      stored?.id === committed.id &&
      stored.type === committed.type &&
      stored.createdAt === committed.createdAt &&
      JSON.stringify(stored.payload) === JSON.stringify(committed.payload)
    );
  });
}

function committedEventsMatchPrepared(
  committedEvents: readonly {
    type: string;
    payload: unknown;
  }[],
  preparedEvents: readonly {
    type: string;
    payload: unknown;
  }[],
): boolean {
  return (
    committedEvents.length === preparedEvents.length &&
    committedEvents.every((committed, index) => {
      const prepared = preparedEvents[index];
      return (
        prepared !== undefined &&
        committed.type === prepared.type &&
        canonicalPr6rJsonV1(committed.payload) ===
          canonicalPr6rJsonV1(prepared.payload)
      );
    })
  );
}

const FAILED_NOT_SENT_CODES = new Set<string>(
  PR6R_LOOPBACK_FAILED_NOT_SENT_REASONS,
);
const FAILED_SENT_CODES = new Set<string>(
  PR6R_LOOPBACK_FAILED_SENT_REASONS,
);
const FAILED_UNKNOWN_CODES = new Set<string>(
  PR6R_LOOPBACK_FAILED_UNKNOWN_REASONS,
);
const CANCELLED_NOT_SENT_CODES = new Set<string>(
  PR6R_LOOPBACK_CANCELLED_NOT_SENT_REASONS,
);
const CANCELLED_UNKNOWN_CODES = new Set<string>(
  PR6R_LOOPBACK_CANCELLED_UNKNOWN_REASONS,
);

function terminalEvidenceAllowed(value: {
  terminalOutcome: "completed" | "failed" | "cancelled";
  requestDisposition: "not_sent" | "sent" | "unknown";
  stableCode: string;
}): boolean {
  if (value.terminalOutcome === "completed") {
    return (
      value.requestDisposition === "sent" && value.stableCode === "completed"
    );
  }
  if (value.terminalOutcome === "cancelled") {
    if (value.requestDisposition === "not_sent") {
      return CANCELLED_NOT_SENT_CODES.has(value.stableCode);
    }
    if (value.requestDisposition === "unknown") {
      return CANCELLED_UNKNOWN_CODES.has(value.stableCode);
    }
    return false;
  }
  if (value.requestDisposition === "not_sent") {
    return FAILED_NOT_SENT_CODES.has(value.stableCode);
  }
  if (value.requestDisposition === "sent") {
    return FAILED_SENT_CODES.has(value.stableCode);
  }
  return FAILED_UNKNOWN_CODES.has(value.stableCode);
}

function sameBudgetTerminalEntry(
  left: BudgetTerminalEntry | undefined,
  right: BudgetTerminalEntry | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.id === right.id &&
    left.rowType === right.rowType &&
    left.campaignId === right.campaignId &&
    left.reservationId === right.reservationId &&
    left.costScope === right.costScope &&
    left.amountMicrousd === right.amountMicrousd &&
    left.costProvenance === right.costProvenance &&
    left.requestDisposition === right.requestDisposition &&
    left.reasonCode === right.reasonCode &&
    left.createdAt === right.createdAt
  );
}

function sameDispatchBinding(
  left: Pr6rSqliteDispatchBinding,
  right: Omit<Pr6rSqliteDispatchBinding, "dispatchChain">,
): boolean {
  return (
    sameRequestBinding(left, right) &&
    left.providerId === right.providerId &&
    left.cloudEgressAdmissionId === right.cloudEgressAdmissionId &&
    left.projectedMicrousd === right.projectedMicrousd
  );
}

function sameTerminalBinding(
  left: Pr6rSqliteTerminalBinding,
  right: Pr6rSqliteTerminalBinding,
): boolean {
  return (
    sameRequestBinding(left, right) &&
    left.terminalOutcome === right.terminalOutcome &&
    left.requestDisposition === right.requestDisposition &&
    left.stableCode === right.stableCode &&
    left.terminalAt === right.terminalAt &&
    left.reservationProjectedMicrousd ===
      right.reservationProjectedMicrousd &&
    JSON.stringify(left.attemptEvidence) ===
      JSON.stringify(right.attemptEvidence) &&
    sameBudgetTerminalEntry(
      left.terminalBudgetEntry,
      right.terminalBudgetEntry,
    )
  );
}

function freezeAttemptEvidence(
  evidence: Pr6rSqliteAttemptTerminalEvidence,
): Pr6rSqliteAttemptTerminalEvidence {
  return Object.freeze({
    ...evidence,
    usage: Object.freeze({ ...evidence.usage }),
    cost: Object.freeze({ ...evidence.cost }),
  });
}

function freezeTerminalBinding(
  binding: Pr6rSqliteTerminalBinding,
): Pr6rSqliteTerminalBinding {
  return Object.freeze({
    ...binding,
    ...(binding.attemptEvidence === undefined
      ? {}
      : { attemptEvidence: freezeAttemptEvidence(binding.attemptEvidence) }),
    ...(binding.terminalBudgetEntry === undefined
      ? {}
      : {
          terminalBudgetEntry: Object.freeze({
            ...binding.terminalBudgetEntry,
          }),
        }),
  });
}

function mintDispatchAuthority(
  ledger: BudgetLedger,
  binding: Omit<Pr6rSqliteDispatchBinding, "dispatchChain">,
): Pr6rSqliteDispatchAuthority {
  const dispatchChain = Object.freeze({
    kind: "pr6r_sqlite_dispatch_chain" as const,
    attemptId: binding.attemptId,
    reservationId: binding.reservationId,
  });
  dispatchChainPrivateState.set(dispatchChain, ledger);
  const exactBinding = Object.freeze({ ...binding, dispatchChain });
  const authority = Object.freeze({
    kind: "pr6r_sqlite_dispatch_authority" as const,
    requestId: binding.requestId,
    attemptId: binding.attemptId,
    reservationId: binding.reservationId,
    dispatchChain,
  });
  dispatchPrivateState.set(authority, {
    consumed: false,
    ledger,
    binding: exactBinding,
  });
  return authority;
}

function mintTerminalReceipt(
  ledger: BudgetLedger,
  binding: Pr6rSqliteTerminalBinding,
): Pr6rSqliteTerminalReceipt {
  const receipt = Object.freeze({
    kind: "pr6r_sqlite_terminal_receipt" as const,
    requestId: binding.requestId,
    attemptId: binding.attemptId,
    reservationId: binding.reservationId,
  });
  terminalPrivateState.set(receipt, { consumed: false, ledger, binding });
  return receipt;
}

function terminalBinding(
  base: Pr6rSqliteRequestBinding,
  terminal: Omit<
    Pr6rSqliteTerminalBinding,
    keyof Pr6rSqliteRequestBinding
  >,
): Pr6rSqliteTerminalBinding {
  return freezeTerminalBinding({
    ...base,
    ...terminal,
  });
}

export type Pr6rCommittedBudgetedStartBinding =
  | {
      readonly status: "admitted";
      readonly authority: Pr6rSqliteDispatchAuthority;
    }
  | {
      readonly status: "budget_denied";
      readonly reason:
        | "campaign_overrun"
        | "episode_cap"
        | "campaign_automatic_stop"
        | "campaign_hard_ceiling";
      readonly receipt: Pr6rSqliteTerminalReceipt;
    };

/** Convert one fresh UoW commit proof into transport or terminal authority. */
export function bindPr6rCommittedBudgetedStart(input: {
  committed: CommittedAttemptStart;
  preparedAttemptAuthority: Pr6rPreparedLoopbackAttemptAuthority;
  applicationRequest: unknown;
  reservationId: string;
}): Pr6rCommittedBudgetedStartBinding {
  const request = CloudApplicationRequestV1Schema.parse(
    input.applicationRequest,
  );
  const proof = consumeAttemptStartPersistenceReceipt(
    input.committed.persistenceReceipt,
  );
  const prepared = consumePr6rPreparedLoopbackAttemptAuthority(
    input.preparedAttemptAuthority,
    {
      store: proof.ledger.eventStore,
      applicationRequest: request,
      reservationId: input.reservationId,
    },
  );
  const base = requestBinding(request, input.reservationId);
  try {
    if (
      prepared.childSessionId !== request.synthesisSessionId ||
      prepared.expectedSequence !== (proof.events[0]?.sequence ?? 0) - 1 ||
      prepared.createdAt !== proof.createdAt ||
      prepared.campaignId !== proof.campaignId ||
      prepared.attemptId !== proof.inputAttemptId ||
      prepared.providerId !== proof.inputProviderId ||
      prepared.pricingSnapshotId !== proof.pricingSnapshotId ||
      prepared.costScope !== proof.costScope ||
      prepared.cloudEgressAdmissionId !== proof.cloudEgressAdmissionId ||
      prepared.reservationId !== proof.reservationId ||
      prepared.selectedStart === undefined ||
      proof.budgetResolution === undefined ||
      canonicalPr6rJsonV1(prepared.selectedStart.resolution) !==
        canonicalPr6rJsonV1(proof.budgetResolution) ||
      !committedEventsMatchPrepared(
        proof.events,
        prepared.selectedStart.events,
      ) ||
      proof.sessionId !== request.synthesisSessionId ||
      proof.inputAttemptId !== request.attemptId ||
      proof.inputProviderId !== PR6R_SYNTHETIC_PROVIDER_ID ||
      proof.campaignId !== PR6R_CAMPAIGN_ID ||
      proof.reservationId !== input.reservationId ||
      proof.pricingSnapshotId !== PR6R_SIMULATION_PRICING_SNAPSHOT_ID ||
      proof.costScope !== "simulation" ||
      proof.budgetResolution === undefined ||
      !exactCommittedEventsStillPresent(
        proof.ledger,
        proof.sessionId,
        proof.events,
      )
    ) {
      fail("Committed start proof does not match the PR6R request.");
    }
    const budgetResolution = proof.budgetResolution;
    return proof.ledger.runImmediate((transaction) => {
      transaction.assertEventReconciled();
      const state = proof.ledger.eventStore.replay(request.synthesisSessionId);
      assertRequestMatchesImport(state, request);
      const latestAttempt = state.inferenceAttempts.at(-1);
      const latestDecision = state.routingDecisions.at(-1);
      if (
        latestAttempt?.attemptId !== request.attemptId ||
        latestAttempt.finished !== undefined ||
        latestDecision?.cloudEgressAdmissionId !==
          latestAttempt.cloudEgressAdmissionId
      ) {
        fail("Committed start is not the matching open SQLite attempt.");
      }
      if (budgetResolution.status === "admitted") {
        const reservation = transaction.requireReservation(input.reservationId);
        assertReservationMatches(reservation, request, input.reservationId);
        if (
          !input.committed.paidDispatchAuthorized ||
          input.committed.providerId !== PR6R_SYNTHETIC_PROVIDER_ID ||
          latestAttempt.providerId !== PR6R_SYNTHETIC_PROVIDER_ID ||
          latestAttempt.budgetReservationId !== input.reservationId ||
          latestDecision?.reasonCode !== "cloud_admitted" ||
          transaction.getTerminalEntry(input.reservationId) !== undefined ||
          latestAttempt.cloudEgressAdmissionId === undefined
        ) {
          fail("Admitted SQLite attempt lacks exact dispatch accounting evidence.");
        }
        return Object.freeze({
          status: "admitted" as const,
          authority: mintDispatchAuthority(
            proof.ledger,
            Object.freeze({
              ...base,
              providerId: reservation.providerId,
              cloudEgressAdmissionId: latestAttempt.cloudEgressAdmissionId,
              projectedMicrousd: reservation.amountMicrousd,
            }),
          ),
        });
      }
      if (
        input.committed.paidDispatchAuthorized ||
        latestAttempt.budgetReservationId !== undefined ||
        latestDecision?.reasonCode !== "budget_denial" ||
        transaction.listOutstandingReservations({
          sessionId: request.synthesisSessionId,
        }).length !== 0 ||
        transaction.getTerminalEntry(input.reservationId) !== undefined
      ) {
        fail("Budget denial SQLite state contains dispatch or reservation evidence.");
      }
      return Object.freeze({
        status: "budget_denied" as const,
        reason: budgetResolution.reason,
        receipt: mintTerminalReceipt(
          proof.ledger,
          terminalBinding(base, {
            terminalOutcome: "failed",
            requestDisposition: "not_sent",
            stableCode: "loopback.budget_denied",
            terminalAt: proof.createdAt,
          }),
        ),
      });
    });
  } catch (error) {
    if (error instanceof Pr6rSqliteAuthorityError) throw error;
    return fail("Committed PR6R start could not be persistence-verified.", error);
  }
}

function expectedTerminalFromState(
  state: SessionState,
  request: CloudApplicationRequestV1,
  transaction: BudgetLedgerTransaction,
  reservationId: string,
): Omit<Pr6rSqliteTerminalBinding, keyof Pr6rSqliteRequestBinding> {
  const attempt = state.inferenceAttempts.find(
    (candidate) => candidate.attemptId === request.attemptId,
  );
  const finish = attempt?.finished;
  const finishIsLast = finish?.sequence === state.lastSequence;
  const terminalFollowsFinish =
    finish !== undefined && finish.sequence + 1 === state.lastSequence;
  const compatibleSessionBoundary =
    finish !== undefined &&
    ((finishIsLast && state.status === "running") ||
      (terminalFollowsFinish &&
        ((finish.outcome === "succeeded" &&
          state.status === "completed" &&
          state.lastV2EventType === "session.completed") ||
          (finish.outcome === "cancelled" &&
            state.status === "cancelled" &&
            state.lastV2EventType === "session.cancelled") ||
          (finish.outcome === "interrupted" &&
            state.status === "interrupted" &&
            state.lastV2EventType === "session.interrupted") ||
          (![
            "succeeded",
            "cancelled",
            "interrupted",
          ].includes(finish.outcome) &&
            state.status === "failed" &&
            state.lastV2EventType === "session.failed"))));
  if (
    !compatibleSessionBoundary ||
    (finishIsLast && state.lastV2EventType !== "inference.attempt.finished") ||
    state.inferenceAttempts.at(-1)?.attemptId !== request.attemptId ||
    attempt === undefined ||
    finish === undefined ||
    attempt.budgetReservationId !== reservationId ||
    finish.cost.reservationId !== reservationId ||
    finish.cost.costScope !== "simulation"
  ) {
    fail("SQLite replay has no matching terminal reserved attempt.");
  }
  const reservation = transaction.requireReservation(reservationId);
  assertReservationMatches(reservation, request, reservationId);
  const terminalBudgetEntry = transaction.getTerminalEntry(reservationId);
  if (
    terminalBudgetEntry === undefined ||
    terminalBudgetEntry.campaignId !== PR6R_CAMPAIGN_ID ||
    terminalBudgetEntry.costScope !== "simulation" ||
    terminalBudgetEntry.requestDisposition !== finish.requestDisposition ||
    terminalBudgetEntry.amountMicrousd !== finish.cost.amountMicrousd ||
    terminalBudgetEntry.costProvenance !== finish.cost.provenance ||
    terminalBudgetEntry.createdAt !== finish.createdAt
  ) {
    fail("Terminal budget row does not match the finished attempt.");
  }
  const cacheReadTokens = finish.usage.cacheReadTokens ?? 0;
  if (
    cacheReadTokens > finish.usage.inputTokens ||
    finish.usage.reasoningTokens + finish.usage.outputTokens >
      PR6R_REQUESTED_OUTPUT_TOKENS
  ) {
    fail("Finished PR6R usage does not match the sealed request bounds.");
  }
  if (finish.usage.reported) {
    if (finish.usage.inputTokens !== request.estimatedInputTokens) {
      fail("Reported PR6R input usage does not match the sealed request.");
    }
    const expectedCost = calculatePr6rHostPricedSimulationCostMicrousd({
      inputTokens: finish.usage.inputTokens,
      cacheReadTokens,
      cacheWriteTokens: 0,
      reasoningTokens: finish.usage.reasoningTokens,
      visibleOutputTokens: finish.usage.outputTokens,
    });
    if (
      finish.cost.provenance !== "host_pricing_snapshot" ||
      finish.cost.amountMicrousd !== expectedCost
    ) {
      fail("Reported PR6R usage lacks exact host-priced simulation cost.");
    }
  } else if (
    finish.usage.inputTokens !== 0 ||
    finish.usage.outputTokens !== 0 ||
    finish.usage.reasoningTokens !== 0 ||
    cacheReadTokens !== 0 ||
    finish.cost.provenance !== "reserved_unknown" ||
    finish.cost.amountMicrousd !== reservation.amountMicrousd
  ) {
    fail("Unreported PR6R usage must consume the exact reserved amount.");
  }
  if (
    finish.outcome === "succeeded" &&
    (finish.requestDisposition !== "sent" ||
      finish.responseBodySha256 === undefined ||
      finish.reviewResultSha256 === undefined)
  ) {
    fail("Successful PR6R finish requires persisted response and result hashes.");
  }
  const terminalOutcome =
    finish.outcome === "succeeded"
      ? "completed"
      : finish.outcome === "cancelled"
        ? "cancelled"
        : "failed";
  const stableCode =
    finish.outcome === "succeeded" ? "completed" : finish.errorCode;
  if (stableCode === undefined) {
    fail("Unsuccessful PR6R finish has no stable terminal code.");
  }
  const terminal: Omit<
    Pr6rSqliteTerminalBinding,
    keyof Pr6rSqliteRequestBinding
  > = {
    terminalOutcome,
    requestDisposition: finish.requestDisposition,
    stableCode,
    terminalAt: finish.createdAt,
    reservationProjectedMicrousd: reservation.amountMicrousd,
    attemptEvidence: freezeAttemptEvidence({
      outcome: finish.outcome,
      requestDisposition: finish.requestDisposition,
      stableCode,
      usage: {
        inputTokens: finish.usage.inputTokens,
        outputTokens: finish.usage.outputTokens,
        reasoningTokens: finish.usage.reasoningTokens,
        cacheReadTokens: finish.usage.cacheReadTokens ?? 0,
        cacheWriteTokens: 0,
        reported: finish.usage.reported,
      },
      cost: {
        amountMicrousd: finish.cost.amountMicrousd,
        provenance: finish.cost.provenance,
        reservationId,
        costScope: "simulation",
      },
      latencyMs: finish.latencyMs,
      ...(finish.responseBodySha256 === undefined
        ? {}
        : { responseBodySha256: finish.responseBodySha256 }),
      ...(finish.reviewResultSha256 === undefined
        ? {}
        : { reviewResultSha256: finish.reviewResultSha256 }),
    }),
    terminalBudgetEntry,
  };
  if (!terminalEvidenceAllowed(terminal)) {
    fail("Finished attempt has an invalid PR6R terminal evidence tuple.");
  }
  return terminal;
}

function exactCancellationTerminal(
  state: SessionState,
  request: CloudApplicationRequestV1,
  transaction: BudgetLedgerTransaction,
  reservationId: string,
): Omit<Pr6rSqliteTerminalBinding, keyof Pr6rSqliteRequestBinding> | undefined {
  const imported = state.synthesisCheckpointImport;
  if (state.status !== "cancelled") return undefined;
  // A post-dispatch cancellation has a real finished attempt and must be
  // validated by the reserved-attempt terminal path below, not mistaken for
  // the attempt-free pre-reservation boundary.
  if (state.inferenceAttempts.length !== 0) return undefined;
  if (
    imported === undefined ||
    state.lastV2EventType !== "session.cancelled" ||
    state.lastSequence !== imported.sequence + 1 ||
    state.routingDecisions.length !== 0 ||
    state.cloudEgressAdmissions.length !== 0 ||
    state.contextCompilations.length !== 0 ||
    transaction.listOutstandingReservations({
      sessionId: request.synthesisSessionId,
    }).length !== 0 ||
    transaction.getTerminalEntry(reservationId) !== undefined
  ) {
    fail("Cancelled child is not the exact pre-reservation terminal boundary.");
  }
  return {
    terminalOutcome: "cancelled",
    requestDisposition: "not_sent",
    stableCode: "loopback.cancelled_before_dispatch",
    terminalAt: state.updatedAt,
  };
}

function exactBudgetDenialTerminal(
  state: SessionState,
  request: CloudApplicationRequestV1,
  transaction: BudgetLedgerTransaction,
  reservationId: string,
): Omit<Pr6rSqliteTerminalBinding, keyof Pr6rSqliteRequestBinding> | undefined {
  const attempt = state.inferenceAttempts.find(
    (candidate) => candidate.attemptId === request.attemptId,
  );
  const latestDecision = state.routingDecisions.at(-1);
  if (
    attempt === undefined ||
    attempt.finished !== undefined ||
    attempt.budgetReservationId !== undefined ||
    latestDecision?.reasonCode !== "budget_denial"
  ) {
    return undefined;
  }
  if (
    state.status !== "running" ||
    state.lastV2EventType !== "inference.attempt.started" ||
    state.inferenceAttempts.at(-1)?.attemptId !== request.attemptId ||
    latestDecision.proposedProviderId !== PR6R_SYNTHETIC_PROVIDER_ID ||
    latestDecision.selectedProviderId !== state.routes.at(-1)?.providerId ||
    attempt.providerId !== latestDecision.selectedProviderId ||
    attempt.cloudEgressAdmissionId !==
      latestDecision.cloudEgressAdmissionId ||
    transaction.listOutstandingReservations({
      sessionId: request.synthesisSessionId,
    }).length !== 0 ||
    transaction.getTerminalEntry(reservationId) !== undefined
  ) {
    fail("Budget-denied child is not the exact no-reservation terminal boundary.");
  }
  return {
    terminalOutcome: "failed",
    requestDisposition: "not_sent",
    stableCode: "loopback.budget_denied",
    terminalAt: latestDecision.createdAt,
  };
}

function revalidateTerminalBinding(
  ledger: BudgetLedger,
  request: CloudApplicationRequestV1,
  reservationId: string,
): Pr6rSqliteTerminalBinding {
  const base = requestBinding(request, reservationId);
  return ledger.runImmediate((transaction) => {
    transaction.assertEventReconciled();
    const state = ledger.eventStore.replay(request.synthesisSessionId);
    assertRequestMatchesImport(state, request);
    const cancellation = exactCancellationTerminal(
      state,
      request,
      transaction,
      reservationId,
    );
    if (cancellation !== undefined) {
      return terminalBinding(base, cancellation);
    }
    const denial = exactBudgetDenialTerminal(
      state,
      request,
      transaction,
      reservationId,
    );
    if (denial !== undefined) {
      return terminalBinding(base, denial);
    }
    return terminalBinding(
      base,
      expectedTerminalFromState(state, request, transaction, reservationId),
    );
  });
}

/** Mint an OS-publishable receipt from one fresh atomic finish/accounting commit. */
export function bindPr6rCommittedAttemptFinish(input: {
  committed: CommittedAttemptFinish;
  preparedFinishAuthority: Pr6rPreparedLoopbackFinishAuthority;
  applicationRequest: unknown;
  reservationId: string;
}): Pr6rSqliteTerminalReceipt {
  const request = CloudApplicationRequestV1Schema.parse(
    input.applicationRequest,
  );
  const proof = consumeAttemptFinishPersistenceReceipt(
    input.committed.persistenceReceipt,
  );
  const prepared = consumePr6rPreparedLoopbackFinishAuthority(
    input.preparedFinishAuthority,
    {
      applicationRequest: request,
      reservationId: input.reservationId,
    },
  );
  const base = requestBinding(request, input.reservationId);
  try {
    if (
      prepared.childSessionId !== request.synthesisSessionId ||
      prepared.attemptId !== request.attemptId ||
      prepared.reservationId !== input.reservationId ||
      proof.sessionId !== request.synthesisSessionId ||
      proof.attemptId !== request.attemptId ||
      input.committed.attemptId !== request.attemptId ||
      !committedEventsMatchPrepared(proof.events, prepared.events) ||
      !exactCommittedEventsStillPresent(
        proof.ledger,
        proof.sessionId,
        proof.events,
      )
    ) {
      fail("Committed finish proof does not match the PR6R request.");
    }
    return proof.ledger.runImmediate((transaction) => {
      transaction.assertEventReconciled();
      const state = proof.ledger.eventStore.replay(request.synthesisSessionId);
      assertRequestMatchesImport(state, request);
      const terminal = expectedTerminalFromState(
        state,
        request,
        transaction,
        input.reservationId,
      );
      if (
        prepared.terminal.terminalOutcome !== terminal.terminalOutcome ||
        prepared.terminal.requestDisposition !== terminal.requestDisposition ||
      prepared.terminal.stableCode !== terminal.stableCode ||
        dispatchChainPrivateState.get(prepared.sqliteDispatchChain) !==
          proof.ledger ||
        proof.terminalBudgetEntry === undefined ||
        terminal.terminalBudgetEntry?.id !== proof.terminalBudgetEntry.id
      ) {
        fail("Fresh finish receipt does not bind its terminal budget row.");
      }
      return mintTerminalReceipt(
        proof.ledger,
        terminalBinding(base, terminal),
      );
    });
  } catch (error) {
    if (error instanceof Pr6rSqliteAuthorityError) throw error;
    return fail("Committed PR6R finish could not be persistence-verified.", error);
  }
}

/**
 * Persist cancellation and mint its receipt inside the same BEGIN IMMEDIATE.
 * No reservation or attempt may exist at this boundary.
 */
export function commitPr6rPreReservationCancellation(input: {
  ledger: BudgetLedger;
  preparedAttemptAuthority: Pr6rPreparedLoopbackAttemptAuthority;
  applicationRequest: unknown;
  reservationId: string;
  reason: string;
  eventId: string;
  createdAt: string;
}): Pr6rSqliteTerminalReceipt {
  const request = CloudApplicationRequestV1Schema.parse(
    input.applicationRequest,
  );
  const prepared = consumePr6rPreparedLoopbackAttemptAuthority(
    input.preparedAttemptAuthority,
    {
      store: input.ledger.eventStore,
      applicationRequest: request,
      reservationId: input.reservationId,
    },
  );
  const base = requestBinding(request, input.reservationId);
  try {
    return input.ledger.runImmediate((transaction) => {
      transaction.assertEventReconciled();
      const state = input.ledger.eventStore.replay(request.synthesisSessionId);
      assertRequestMatchesImport(state, request);
      if (
        prepared.childSessionId !== request.synthesisSessionId ||
        prepared.expectedSequence !== state.lastSequence ||
        prepared.attemptId !== request.attemptId ||
        prepared.providerId !== PR6R_SYNTHETIC_PROVIDER_ID ||
        prepared.campaignId !== PR6R_CAMPAIGN_ID ||
        prepared.pricingSnapshotId !== PR6R_SIMULATION_PRICING_SNAPSHOT_ID ||
        prepared.costScope !== "simulation" ||
        prepared.reservationId !== input.reservationId ||
        Date.parse(input.createdAt) < Date.parse(prepared.createdAt) ||
        state.status !== "running" ||
        state.lastV2EventType !== "synthesis.checkpoint.imported" ||
        state.inferenceAttempts.length !== 0 ||
        state.routingDecisions.length !== 0 ||
        state.cloudEgressAdmissions.length !== 0 ||
        transaction.listOutstandingReservations({
          sessionId: request.synthesisSessionId,
        }).length !== 0 ||
        transaction.getTerminalEntry(input.reservationId) !== undefined
      ) {
        fail("Pre-reservation cancellation boundary is no longer empty.");
      }
      input.ledger.eventStore.append(
        request.synthesisSessionId,
        {
          type: "session.cancelled",
          payload: { reason: input.reason },
        },
        {
          expectedSequence: state.lastSequence,
          eventId: input.eventId,
          createdAt: input.createdAt,
        },
      );
      transaction.assertEventReconciled();
      return mintTerminalReceipt(
        input.ledger,
        terminalBinding(base, {
          terminalOutcome: "cancelled",
          requestDisposition: "not_sent",
          stableCode: "loopback.cancelled_before_dispatch",
          terminalAt: input.createdAt,
        }),
      );
    });
  } catch (error) {
    if (error instanceof Pr6rSqliteAuthorityError) throw error;
    return fail("Pre-reservation cancellation could not be committed.", error);
  }
}

export type Pr6rSqliteTerminalRecovery =
  | {
      readonly status: "terminal";
      readonly receipt: Pr6rSqliteTerminalReceipt;
    }
  | {
      readonly status: "blocked";
      readonly reason:
        | "sqlite_evidence_missing_or_conflicting"
        | "admitted_attempt_open";
    };

export interface CommitPr6rOpenAttemptRecoveryInput {
  readonly ledger: BudgetLedger;
  readonly applicationRequest: unknown;
  readonly reservationId: string;
  readonly createdAt: string;
  readonly eventIds: readonly [attemptFinishEventId: string, sessionEventId: string];
  readonly terminalLedgerEntryId: string;
}

/**
 * Atomically convert one exact admitted/open PR6R attempt found on restart into
 * unknown/full-reservation accounting. This can mint terminal authority but
 * never dispatch authority.
 */
export function commitPr6rOpenAttemptRecovery(
  input: CommitPr6rOpenAttemptRecoveryInput,
): Pr6rSqliteTerminalReceipt {
  const request = CloudApplicationRequestV1Schema.parse(
    input.applicationRequest,
  );
  const recoveryTimestamp = Date.parse(input.createdAt);
  if (
    !Number.isFinite(recoveryTimestamp) ||
    new Date(recoveryTimestamp).toISOString() !== input.createdAt
  ) {
    fail("Open-attempt recovery timestamp is not canonical UTC.");
  }
  try {
    const open = revalidateDispatchBinding(
      input.ledger,
      request,
      input.reservationId,
    );
    const before = input.ledger.eventStore.replay(request.synthesisSessionId);
    const attempt = before.inferenceAttempts.at(-1);
    if (
      attempt?.attemptId !== request.attemptId ||
      attempt.checkpointId === undefined ||
      recoveryTimestamp < Date.parse(before.updatedAt)
    ) {
      fail("Open-attempt recovery does not match the latest PR6R attempt.");
    }
    const recoveryEvents = Object.freeze([
      Object.freeze({
        type: "inference.attempt.finished" as const,
        payload: Object.freeze({
          attemptId: request.attemptId,
          checkpointId: attempt.checkpointId,
          outcome: "interrupted" as const,
          requestDisposition: "unknown" as const,
          usage: Object.freeze({
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            reported: false,
          }),
          cost: Object.freeze({
            amountMicrousd: open.projectedMicrousd,
            provenance: "reserved_unknown" as const,
            reservationId: input.reservationId,
            costScope: "simulation" as const,
          }),
          latencyMs: 0,
          errorCode: "loopback.recovery_required",
        }),
      }),
      Object.freeze({
        type: "session.interrupted" as const,
        payload: Object.freeze({
          reason: "Application restarted with an open PR6R loopback attempt.",
        }),
      }),
    ]);
    const committed = new AttemptUnitOfWork(input.ledger).commitRecoveryFinish({
      sessionId: request.synthesisSessionId,
      expectedSequence: before.lastSequence,
      createdAt: input.createdAt,
      eventIds: input.eventIds,
      events: recoveryEvents,
      terminalLedgerEntryId: input.terminalLedgerEntryId,
      assertOpenState: (state) => {
        assertRequestMatchesImport(state, request);
        const currentAttempt = state.inferenceAttempts.at(-1);
        const currentDecision = state.routingDecisions.at(-1);
        const currentAdmission = state.cloudEgressAdmissions.at(-1);
        if (
          state.status !== "running" ||
          state.lastV2EventType !== "inference.attempt.started" ||
          state.lastSequence !== before.lastSequence ||
          currentAttempt?.attemptId !== request.attemptId ||
          currentAttempt.finished !== undefined ||
          currentAttempt.providerId !== PR6R_SYNTHETIC_PROVIDER_ID ||
          currentAttempt.budgetReservationId !== input.reservationId ||
          currentAttempt.cloudEgressAdmissionId !==
            open.cloudEgressAdmissionId ||
          currentDecision?.reasonCode !== "cloud_admitted" ||
          currentDecision.selectedProviderId !== PR6R_SYNTHETIC_PROVIDER_ID ||
          currentDecision.budgetReservationId !== input.reservationId ||
          currentDecision.cloudEgressAdmissionId !==
            open.cloudEgressAdmissionId ||
          currentAdmission?.admissionId !== open.cloudEgressAdmissionId ||
          currentAdmission.decision !== "pass"
        ) {
          fail("Open-attempt recovery lost its exact admitted PR6R state.");
        }
      },
    });
    const proof = consumeAttemptFinishPersistenceReceipt(
      committed.persistenceReceipt,
    );
    if (
      proof.sessionId !== request.synthesisSessionId ||
      proof.attemptId !== request.attemptId ||
      proof.terminalBudgetEntry?.id !== input.terminalLedgerEntryId ||
      !committedEventsMatchPrepared(proof.events, recoveryEvents) ||
      !exactCommittedEventsStillPresent(
        proof.ledger,
        proof.sessionId,
        proof.events,
      )
    ) {
      fail("Committed open-attempt recovery proof is incomplete.");
    }
    const base = requestBinding(request, input.reservationId);
    return proof.ledger.runImmediate((transaction) => {
      transaction.assertEventReconciled();
      const state = proof.ledger.eventStore.replay(request.synthesisSessionId);
      assertRequestMatchesImport(state, request);
      const terminal = expectedTerminalFromState(
        state,
        request,
        transaction,
        input.reservationId,
      );
      if (
        terminal.terminalOutcome !== "failed" ||
        terminal.requestDisposition !== "unknown" ||
        terminal.stableCode !== "loopback.recovery_required" ||
        terminal.terminalBudgetEntry?.id !== input.terminalLedgerEntryId ||
        terminal.terminalBudgetEntry.amountMicrousd !== open.projectedMicrousd
      ) {
        fail("Open-attempt recovery did not settle the exact unknown terminal.");
      }
      return mintTerminalReceipt(
        proof.ledger,
        terminalBinding(base, terminal),
      );
    });
  } catch (error) {
    if (error instanceof Pr6rSqliteAuthorityError) throw error;
    return fail("Open PR6R attempt could not be recovered atomically.", error);
  }
}

/** Mint reconciliation-only authority from exact durable SQLite replay. */
export function recoverPr6rSqliteTerminalReceipt(input: {
  ledger: BudgetLedger;
  applicationRequest: unknown;
  reservationId: string;
}): Pr6rSqliteTerminalRecovery {
  const request = CloudApplicationRequestV1Schema.parse(
    input.applicationRequest,
  );
  const base = requestBinding(request, input.reservationId);
  try {
    return input.ledger.runImmediate((transaction) => {
      transaction.assertEventReconciled();
      const state = input.ledger.eventStore.replay(request.synthesisSessionId);
      assertRequestMatchesImport(state, request);
      const cancellation = exactCancellationTerminal(
        state,
        request,
        transaction,
        input.reservationId,
      );
      if (cancellation !== undefined) {
        return Object.freeze({
          status: "terminal" as const,
          receipt: mintTerminalReceipt(
            input.ledger,
            terminalBinding(base, cancellation),
          ),
        });
      }
      const attempt = state.inferenceAttempts.find(
        (candidate) => candidate.attemptId === request.attemptId,
      );
      const denial = exactBudgetDenialTerminal(
        state,
        request,
        transaction,
        input.reservationId,
      );
      if (denial !== undefined) {
        return Object.freeze({
          status: "terminal" as const,
          receipt: mintTerminalReceipt(
            input.ledger,
            terminalBinding(base, denial),
          ),
        });
      }
      if (
        attempt?.finished === undefined &&
        attempt?.budgetReservationId === input.reservationId
      ) {
        return Object.freeze({
          status: "blocked" as const,
          reason: "admitted_attempt_open" as const,
        });
      }
      const terminal = expectedTerminalFromState(
        state,
        request,
        transaction,
        input.reservationId,
      );
      return Object.freeze({
        status: "terminal" as const,
        receipt: mintTerminalReceipt(
          input.ledger,
          terminalBinding(base, terminal),
        ),
      });
    });
  } catch {
    return Object.freeze({
      status: "blocked" as const,
      reason: "sqlite_evidence_missing_or_conflicting" as const,
    });
  }
}

function revalidateDispatchBinding(
  ledger: BudgetLedger,
  request: CloudApplicationRequestV1,
  reservationId: string,
): Omit<Pr6rSqliteDispatchBinding, "dispatchChain"> {
  const base = requestBinding(request, reservationId);
  return ledger.runImmediate((transaction) => {
    transaction.assertEventReconciled();
    const state = ledger.eventStore.replay(request.synthesisSessionId);
    assertRequestMatchesImport(state, request);
    const attempt = state.inferenceAttempts.at(-1);
    const decision = state.routingDecisions.at(-1);
    const admission = state.cloudEgressAdmissions.at(-1);
    const reservation = transaction.requireReservation(reservationId);
    assertReservationMatches(reservation, request, reservationId);
    if (
      state.status !== "running" ||
      state.lastV2EventType !== "inference.attempt.started" ||
      attempt?.attemptId !== request.attemptId ||
      attempt.finished !== undefined ||
      attempt.providerId !== PR6R_SYNTHETIC_PROVIDER_ID ||
      attempt.budgetReservationId !== reservationId ||
      attempt.cloudEgressAdmissionId === undefined ||
      decision?.reasonCode !== "cloud_admitted" ||
      decision.selectedProviderId !== PR6R_SYNTHETIC_PROVIDER_ID ||
      decision.budgetReservationId !== reservationId ||
      decision.cloudEgressAdmissionId !== attempt.cloudEgressAdmissionId ||
      admission?.admissionId !== attempt.cloudEgressAdmissionId ||
      admission.decision !== "pass" ||
      reservation.cloudEgressAdmissionId !== attempt.cloudEgressAdmissionId ||
      transaction.getTerminalEntry(reservationId) !== undefined ||
      transaction.listOutstandingReservations({
        sessionId: request.synthesisSessionId,
      }).length !== 1
    ) {
      fail("SQLite dispatch authority no longer has an exact open admission.");
    }
    return Object.freeze({
      ...base,
      providerId: reservation.providerId,
      cloudEgressAdmissionId: attempt.cloudEgressAdmissionId,
      projectedMicrousd: reservation.amountMicrousd,
    });
  });
}

/** Synchronously consume a one-use admitted start proof before transport use. */
export function consumePr6rSqliteDispatchAuthority(
  authority: Pr6rSqliteDispatchAuthority,
  input: { applicationRequest: unknown; reservationId: string },
): Pr6rSqliteDispatchBinding {
  const privateState = dispatchPrivateState.get(authority);
  const request = CloudApplicationRequestV1Schema.parse(
    input.applicationRequest,
  );
  const expected = requestBinding(request, input.reservationId);
  if (
    privateState === undefined ||
    privateState.consumed ||
    !sameRequestBinding(privateState.binding, expected)
  ) {
    fail("SQLite dispatch authority is forged, mismatched, or already consumed.");
  }
  const durableBinding = revalidateDispatchBinding(
    privateState.ledger,
    request,
    input.reservationId,
  );
  if (
    dispatchChainPrivateState.get(privateState.binding.dispatchChain) !==
      privateState.ledger ||
    !sameDispatchBinding(privateState.binding, durableBinding)
  ) {
    fail("SQLite dispatch authority is stale or no longer exact.");
  }
  privateState.consumed = true;
  return Object.freeze({
    ...durableBinding,
    dispatchChain: privateState.binding.dispatchChain,
  });
}

/** Consume a one-use SQLite terminal proof before publishing the OS terminal. */
export function consumePr6rSqliteTerminalReceipt(
  receipt: Pr6rSqliteTerminalReceipt,
  input: { applicationRequest: unknown; reservationId: string },
): Pr6rSqliteTerminalBinding {
  const privateState = terminalPrivateState.get(receipt);
  const request = CloudApplicationRequestV1Schema.parse(
    input.applicationRequest,
  );
  const expected = requestBinding(request, input.reservationId);
  if (
    privateState === undefined ||
    privateState.consumed ||
    !sameRequestBinding(privateState.binding, expected)
  ) {
    fail("SQLite terminal receipt is forged, mismatched, or already consumed.");
  }
  const durableBinding = revalidateTerminalBinding(
    privateState.ledger,
    request,
    input.reservationId,
  );
  if (!sameTerminalBinding(privateState.binding, durableBinding)) {
    fail("SQLite terminal receipt is stale or no longer exact.");
  }
  privateState.consumed = true;
  return freezeTerminalBinding(durableBinding);
}

/**
 * Consume a terminal receipt once and retain a nominal replay witness for a
 * cross-store authority that must revalidate SQLite before every later use.
 */
export function consumePr6rSqliteTerminalReceiptForReconciliation(
  receipt: Pr6rSqliteTerminalReceipt,
  input: { applicationRequest: unknown; reservationId: string },
): Pr6rConsumedSqliteTerminalForReconciliation {
  const privateState = terminalPrivateState.get(receipt);
  const binding = consumePr6rSqliteTerminalReceipt(receipt, input);
  if (privateState === undefined) {
    return fail("SQLite terminal receipt has no replay-capable private state.");
  }
  const witness = Object.freeze({
    kind: "pr6r_sqlite_terminal_witness" as const,
    requestId: binding.requestId,
    attemptId: binding.attemptId,
    reservationId: binding.reservationId,
  });
  terminalWitnessPrivateState.set(witness, {
    ledger: privateState.ledger,
    binding,
  });
  return Object.freeze({ binding, witness });
}

/** Re-run exact SQLite reconciliation for one genuine durable witness. */
export function revalidatePr6rSqliteTerminalWitness(
  witness: Pr6rSqliteTerminalWitness,
  input: { applicationRequest: unknown; reservationId: string },
): Pr6rSqliteTerminalBinding {
  const privateState = terminalWitnessPrivateState.get(witness);
  const request = CloudApplicationRequestV1Schema.parse(
    input.applicationRequest,
  );
  const expected = requestBinding(request, input.reservationId);
  if (
    privateState === undefined ||
    !sameRequestBinding(privateState.binding, expected)
  ) {
    return fail("SQLite terminal witness is forged or mismatched.");
  }
  const durable = revalidateTerminalBinding(
    privateState.ledger,
    request,
    input.reservationId,
  );
  if (!sameTerminalBinding(privateState.binding, durable)) {
    return fail("SQLite terminal witness is stale or no longer exact.");
  }
  return freezeTerminalBinding(durable);
}

/** Prove that a terminal witness was minted from this exact ledger object. */
export function assertPr6rSqliteTerminalWitnessLedger(
  witness: Pr6rSqliteTerminalWitness,
  ledger: BudgetLedger,
): void {
  if (terminalWitnessPrivateState.get(witness)?.ledger !== ledger) {
    return fail("SQLite terminal witness belongs to a different ledger.");
  }
}
