import {
  parseSessionEventData,
  type InferenceAttemptFinishedPayload,
  type RoutingDecisionPayload,
  type SessionEventData,
  type StoredSessionEvent,
} from "../shared/session-events";
import type {
  InferenceAttemptRecord,
  SessionState,
} from "../shared/session-reducer";
import {
  RuntimeCostScopeSchema,
  type RuntimeCostScope,
} from "../shared/hybrid-simulation-contracts";
import {
  BUDGET_CACHE_ASSUMPTION,
  BUDGET_ROUNDING_POLICY,
  BudgetLedger,
  type BudgetBillingSnapshot,
  type BudgetProjectionInput,
  type BudgetReservationResolution,
  type BudgetTerminalEntry,
  episodeBudgetCap,
} from "./budget-ledger";
import { SequenceConflictError } from "./event-store";

export type AtomicPersistenceFaultPoint =
  | "after_budget_mutation"
  | "after_event_append"
  | `after_event_append:${number}`;

export interface AttemptUnitOfWorkOptions {
  /** Deterministic rollback seam for tests. Production callers omit it. */
  faultInjector?: (point: AtomicPersistenceFaultPoint) => void;
}

interface AtomicEventBatch {
  sessionId: string;
  expectedSequence: number;
  createdAt: string;
  eventIds: readonly string[];
  events: readonly SessionEventData[];
}

export interface CommitLocalStartInput extends AtomicEventBatch {
  costScope: RuntimeCostScope;
  cloudEgressAdmissionId?: string;
}

export interface CommitBudgetedStartInput
  extends Omit<AtomicEventBatch, "events" | "eventIds"> {
  /**
   * Both possible batches are allocated before admission. The transaction
   * chooses one only after it has observed the locked budget position.
   */
  eventIds: {
    admitted: readonly string[];
    denied: readonly string[];
  };
  campaignId: string;
  reservationId: string;
  attemptId: string;
  providerId: string;
  pricingSnapshotId: string;
  costScope: RuntimeCostScope;
  cloudEgressAdmissionId?: string;
  projection: BudgetProjectionInput;
  /**
   * Synchronous and side-effect free. It runs while the SQLite immediate lock
   * is held and must return the exact admitted-cloud or retained-local batch.
   */
  buildEvents: (
    resolution: BudgetReservationResolution,
  ) => readonly SessionEventData[];
}

function validateBudgetedStartEventIds(
  input: CommitBudgetedStartInput,
): void {
  const eventIds = input.eventIds;
  const expectedAdmitted = 6;
  const expectedDenied = 5;
  if (
    eventIds.admitted.length !== expectedAdmitted ||
    eventIds.denied.length !== expectedDenied
  ) {
    throw new Error(
      `budgeted start requires ${expectedAdmitted} admitted and ${expectedDenied} denied preallocated event IDs`,
    );
  }
  const allIds = [...eventIds.admitted, ...eventIds.denied];
  if (allIds.some((eventId) => eventId.trim().length === 0)) {
    throw new Error("preallocated event IDs cannot be empty");
  }
  if (new Set(allIds).size !== allIds.length) {
    throw new Error(
      "admitted and denied event IDs must be unique across both alternatives",
    );
  }
}

export interface CommitAttemptFinishInput extends AtomicEventBatch {
  /** Required only when the attempt owns a budget reservation. */
  terminalLedgerEntryId?: string;
  /**
   * Optional synchronous state assertion executed inside the same immediate
   * transaction before accounting or events mutate. Recovery adapters use it
   * to preserve their narrower replay contract.
   */
  assertOpenState?: (state: Readonly<SessionState>) => unknown;
}

export interface CommittedAttemptStart {
  events: StoredSessionEvent[];
  attemptId: string;
  providerId: string;
  dispatchAuthorized: true;
  paidDispatchAuthorized: boolean;
  budgetResolution?: BudgetReservationResolution;
  /** Opaque, process-local proof that the SQLite transaction committed. */
  persistenceReceipt: AttemptStartPersistenceReceipt;
}

export interface CommittedAttemptFinish {
  events: StoredSessionEvent[];
  attemptId: string;
  terminalBudgetEntry?: BudgetTerminalEntry;
  /** Opaque, process-local proof that the SQLite transaction committed. */
  persistenceReceipt: AttemptFinishPersistenceReceipt;
}

export interface AttemptStartPersistenceReceipt {
  readonly kind: "attempt_start_persistence_receipt";
}

export interface AttemptFinishPersistenceReceipt {
  readonly kind: "attempt_finish_persistence_receipt";
}

export interface ConsumedAttemptStartPersistenceProof {
  readonly ledger: BudgetLedger;
  readonly sessionId: string;
  readonly createdAt: string;
  readonly inputAttemptId: string;
  readonly inputProviderId: string;
  readonly committedAttemptId: string;
  readonly committedProviderId: string;
  readonly costScope: RuntimeCostScope;
  readonly cloudEgressAdmissionId?: string;
  readonly campaignId?: string;
  readonly reservationId?: string;
  readonly pricingSnapshotId?: string;
  readonly budgetResolution?: BudgetReservationResolution;
  readonly events: readonly StoredSessionEvent[];
}

export interface ConsumedAttemptFinishPersistenceProof {
  readonly ledger: BudgetLedger;
  readonly sessionId: string;
  readonly createdAt: string;
  readonly attemptId: string;
  readonly terminalBudgetEntry?: BudgetTerminalEntry;
  readonly events: readonly StoredSessionEvent[];
}

interface AttemptStartPersistenceState
  extends ConsumedAttemptStartPersistenceProof {
  consumed: boolean;
}

interface AttemptFinishPersistenceState
  extends ConsumedAttemptFinishPersistenceProof {
  consumed: boolean;
}

const attemptStartPersistenceState = new WeakMap<
  AttemptStartPersistenceReceipt,
  AttemptStartPersistenceState
>();
const attemptFinishPersistenceState = new WeakMap<
  AttemptFinishPersistenceReceipt,
  AttemptFinishPersistenceState
>();

function frozenStoredEvents(
  events: readonly StoredSessionEvent[],
): readonly StoredSessionEvent[] {
  return Object.freeze(events.map((event) => Object.freeze(structuredClone(event))));
}

export function consumeAttemptStartPersistenceReceipt(
  receipt: AttemptStartPersistenceReceipt,
): ConsumedAttemptStartPersistenceProof {
  const state = attemptStartPersistenceState.get(receipt);
  if (state === undefined || state.consumed) {
    throw new Error("Attempt start persistence receipt is forged or already consumed");
  }
  state.consumed = true;
  const { consumed: _consumed, ...proof } = state;
  return Object.freeze(proof);
}

export function consumeAttemptFinishPersistenceReceipt(
  receipt: AttemptFinishPersistenceReceipt,
): ConsumedAttemptFinishPersistenceProof {
  const state = attemptFinishPersistenceState.get(receipt);
  if (state === undefined || state.consumed) {
    throw new Error("Attempt finish persistence receipt is forged or already consumed");
  }
  state.consumed = true;
  const { consumed: _consumed, ...proof } = state;
  return Object.freeze(proof);
}

function withStartPersistenceReceipt(
  ledger: BudgetLedger,
  input: {
    sessionId: string;
    createdAt: string;
    attemptId: string;
    providerId: string;
    costScope: RuntimeCostScope;
    cloudEgressAdmissionId?: string;
    campaignId?: string;
    reservationId?: string;
    pricingSnapshotId?: string;
  },
  committed: Omit<CommittedAttemptStart, "persistenceReceipt">,
): CommittedAttemptStart {
  const receipt = Object.freeze({
    kind: "attempt_start_persistence_receipt" as const,
  });
  attemptStartPersistenceState.set(receipt, {
    ledger,
    sessionId: input.sessionId,
    createdAt: input.createdAt,
    inputAttemptId: input.attemptId,
    inputProviderId: input.providerId,
    committedAttemptId: committed.attemptId,
    committedProviderId: committed.providerId,
    costScope: input.costScope,
    ...(input.cloudEgressAdmissionId === undefined
      ? {}
      : { cloudEgressAdmissionId: input.cloudEgressAdmissionId }),
    ...(input.campaignId === undefined ? {} : { campaignId: input.campaignId }),
    ...(input.reservationId === undefined
      ? {}
      : { reservationId: input.reservationId }),
    ...(input.pricingSnapshotId === undefined
      ? {}
      : { pricingSnapshotId: input.pricingSnapshotId }),
    ...(committed.budgetResolution === undefined
      ? {}
      : { budgetResolution: structuredClone(committed.budgetResolution) }),
    events: frozenStoredEvents(committed.events),
    consumed: false,
  });
  return { ...committed, persistenceReceipt: receipt };
}

function withFinishPersistenceReceipt(
  ledger: BudgetLedger,
  input: Pick<CommitAttemptFinishInput, "sessionId" | "createdAt">,
  committed: Omit<CommittedAttemptFinish, "persistenceReceipt">,
): CommittedAttemptFinish {
  const receipt = Object.freeze({
    kind: "attempt_finish_persistence_receipt" as const,
  });
  attemptFinishPersistenceState.set(receipt, {
    ledger,
    sessionId: input.sessionId,
    createdAt: input.createdAt,
    attemptId: committed.attemptId,
    ...(committed.terminalBudgetEntry === undefined
      ? {}
      : { terminalBudgetEntry: { ...committed.terminalBudgetEntry } }),
    events: frozenStoredEvents(committed.events),
    consumed: false,
  });
  return { ...committed, persistenceReceipt: receipt };
}

function parseBatch(events: readonly SessionEventData[]): SessionEventData[] {
  if (events.length === 0) throw new RangeError("atomic event batch cannot be empty");
  return events.map((event) => parseSessionEventData(event));
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function requireSingleAttemptStart(events: readonly SessionEventData[]) {
  const attempts = events.filter(
    (event) => event.type === "inference.attempt.started",
  );
  if (attempts.length !== 1) {
    throw new Error("attempt-start batch requires exactly one inference attempt start");
  }
  const attempt = attempts[0];
  if (attempt === undefined || events.at(-1) !== attempt) {
    throw new Error("inference.attempt.started must be the last start-batch event");
  }
  return attempt;
}

const LOCAL_START_PATTERNS: readonly (readonly SessionEventData["type"][])[] = [
  [
    "cloud.egress.admission.recorded",
    "routing.decision.recorded",
    "assistant.message.started",
    "context.compiled",
    "inference.attempt.started",
  ],
  [
    "session.started",
    "routing.decision.recorded",
    "route.assigned",
    "assistant.message.started",
    "context.compiled",
    "inference.attempt.started",
  ],
  [
    "routing.decision.recorded",
    "route.assigned",
    "assistant.message.started",
    "context.compiled",
    "inference.attempt.started",
  ],
  [
    "routing.decision.recorded",
    "assistant.message.started",
    "context.compiled",
    "inference.attempt.started",
  ],
  [
    "assistant.message.started",
    "context.compiled",
    "inference.attempt.started",
  ],
];

function validateLocalStartBatch(
  events: readonly SessionEventData[],
  createdAt: string,
  costScopeValue: RuntimeCostScope,
  cloudEgressAdmissionId?: string,
) {
  const costScope = RuntimeCostScopeSchema.parse(costScopeValue);
  if (
    !LOCAL_START_PATTERNS.some((pattern) => exactTypes(events, pattern))
  ) {
    throw new Error(
      "local start must be an exact initial, routed, or retained-lease event batch",
    );
  }
  const attempt = requireSingleAttemptStart(events);
  if (
    attempt.payload.costScope !== costScope ||
    attempt.payload.cloudEgressAdmissionId !== cloudEgressAdmissionId
  ) {
    throw new Error(
      "commitLocalStart attempt does not match its cost scope and egress admission input",
    );
  }
  if (attempt.payload.budgetReservationId !== undefined) {
    throw new Error("commitLocalStart cannot authorize a reserved attempt");
  }
  const decision = events.find(
    (event) => event.type === "routing.decision.recorded",
  );
  if (decision?.type === "routing.decision.recorded") {
    if (
      decision.payload.costScope !== costScope ||
      decision.payload.cloudEgressAdmissionId !== cloudEgressAdmissionId
    ) {
      throw new Error(
        "commitLocalStart decision does not match its cost scope and egress admission input",
      );
    }
    if (decision.payload.routerInputSnapshot === undefined) {
      throw new Error(
        "commitLocalStart requires the current checkpoint-router input snapshot",
      );
    }
    if (decision.payload.routerInputSnapshot.asOf !== createdAt) {
      throw new Error(
        "commitLocalStart requires router snapshot asOf to match the atomic batch timestamp",
      );
    }
    if (
      decision.payload.reasonCode === "cloud_admitted" ||
      decision.payload.reasonCode === "budget_denial" ||
      decision.payload.billing !== undefined ||
      decision.payload.budgetReservationId !== undefined ||
      decision.payload.campaignId !== undefined
    ) {
      throw new Error(
        "commitLocalStart cannot persist paid reservation, billing, campaign, or budget-denial metadata",
      );
    }
    const target = decision.payload.routerInputSnapshot?.providers.find(
      (provider) => provider.providerId === attempt.payload.providerId,
    );
    if (
      target !== undefined &&
      (target.locality !== "local" ||
        target.accountingKind !== "local_zero_cost")
    ) {
      throw new Error(
        `commitLocalStart cannot authorize metered provider ${attempt.payload.providerId}`,
      );
    }
  }
  const egressRecords = events.filter(
    (event) => event.type === "cloud.egress.admission.recorded",
  );
  if (egressRecords.length > 1) {
    throw new Error("commitLocalStart accepts at most one egress admission record");
  }
  const egress = egressRecords[0];
  if (
    egress?.type === "cloud.egress.admission.recorded" &&
    (egress.payload.admissionId !== cloudEgressAdmissionId ||
      egress.payload.evaluatedAt !== createdAt ||
      decision?.type !== "routing.decision.recorded" ||
      decision.payload.provenanceSemanticSha256 !==
        egress.payload.provenanceSemanticSha256)
  ) {
    throw new Error(
      "commitLocalStart egress admission does not match its atomic batch",
    );
  }
  return attempt;
}

function requireSingleAttemptFinish(events: readonly SessionEventData[]) {
  const finishes = events.filter(
    (event) => event.type === "inference.attempt.finished",
  );
  if (finishes.length !== 1) {
    throw new Error("attempt-finish batch requires exactly one inference attempt finish");
  }
  return finishes[0]!;
}

const ATTEMPT_TERMINAL_EVENT_TYPES = new Set<SessionEventData["type"]>([
  "session.completed",
  "session.failed",
  "session.cancelled",
  "session.interrupted",
]);

function validateAttemptFinishBatch(events: readonly SessionEventData[]) {
  const finish = requireSingleAttemptFinish(events);
  const finishIndex = events.indexOf(finish);
  const hasAssistantCompletion =
    events[0]?.type === "assistant.message.completed";
  if (finishIndex !== (hasAssistantCompletion ? 1 : 0)) {
    throw new Error(
      "attempt finish must follow its optional assistant completion immediately",
    );
  }
  if (events.length > finishIndex + 2) {
    throw new Error("attempt finish batch may contain at most one session terminal event");
  }
  const terminal = events[finishIndex + 1];
  if (
    terminal !== undefined &&
    !ATTEMPT_TERMINAL_EVENT_TYPES.has(terminal.type)
  ) {
    throw new Error(
      "only a session terminal event may follow an inference attempt finish",
    );
  }
  const assistant = events[0];
  if (
    assistant?.type === "assistant.message.completed" &&
    assistant.payload.attemptId !== finish.payload.attemptId
  ) {
    throw new Error("assistant completion and attempt finish identities differ");
  }
  return finish;
}

function billingMatches(
  actual: RoutingDecisionPayload["billing"],
  expected: BudgetBillingSnapshot,
): boolean {
  return (
    actual !== undefined &&
    actual.billableInputTokens === expected.billableInputTokens &&
    actual.billableCacheReadTokens === expected.billableCacheReadTokens &&
    actual.requestedMaxOutputTokens === expected.requestedMaxOutputTokens &&
    actual.inputMicrousdPerMillionTokens ===
      expected.inputMicrousdPerMillionTokens &&
    actual.outputMicrousdPerMillionTokens ===
      expected.outputMicrousdPerMillionTokens &&
    actual.cacheReadMicrousdPerMillionTokens ===
      expected.cacheReadMicrousdPerMillionTokens &&
    actual.providerFeeCeilingMicrousd ===
      expected.providerFeeCeilingMicrousd &&
    actual.roundingPolicy === BUDGET_ROUNDING_POLICY &&
    actual.projectedCostMicrousd === expected.projectedCostMicrousd &&
    actual.remainingEpisodeMicrousd === expected.remainingEpisodeMicrousd &&
    actual.remainingCampaignMicrousd === expected.remainingCampaignMicrousd
  );
}

function exactTypes(
  events: readonly SessionEventData[],
  expected: readonly SessionEventData["type"][],
): boolean {
  return (
    events.length === expected.length &&
    events.every((event, index) => event.type === expected[index])
  );
}

function validateBudgetedStartBatch(
  input: CommitBudgetedStartInput,
  resolution: BudgetReservationResolution,
  events: readonly SessionEventData[],
  credentialMetadataId: string,
): { attemptId: string; providerId: string } {
  const expectedTypes =
    resolution.status === "admitted"
      ? ([
          "cloud.egress.admission.recorded",
          "routing.decision.recorded",
          "route.assigned",
          "assistant.message.started",
          "context.compiled",
          "inference.attempt.started",
        ] as const)
      : ([
          "cloud.egress.admission.recorded",
          "routing.decision.recorded",
          "assistant.message.started",
          "context.compiled",
          "inference.attempt.started",
        ] as const);
  if (!exactTypes(events, expectedTypes)) {
    throw new Error(
      `budgeted ${resolution.status} start requires exact event order ${expectedTypes.join(" -> ")}`,
    );
  }
  const egressEvent = events[0];
  const decisionEvent = events[1];
  const attemptEvent = events.at(-1);
  if (
    egressEvent?.type !== "cloud.egress.admission.recorded" ||
    decisionEvent?.type !== "routing.decision.recorded" ||
    attemptEvent?.type !== "inference.attempt.started"
  ) {
    throw new Error("budgeted start is missing its decision or attempt");
  }
  const decision = decisionEvent.payload;
  const attempt = attemptEvent.payload;
  const costScope = RuntimeCostScopeSchema.parse(input.costScope);
  const egressMatches =
    egressEvent.type === "cloud.egress.admission.recorded" &&
    egressEvent.payload.admissionId === input.cloudEgressAdmissionId &&
    egressEvent.payload.decision === "pass" &&
    egressEvent.payload.evaluatedAt === input.createdAt &&
    decision.cloudEgressAdmissionId === input.cloudEgressAdmissionId &&
    decision.provenanceSemanticSha256 ===
      egressEvent.payload.provenanceSemanticSha256 &&
    attempt.cloudEgressAdmissionId === input.cloudEgressAdmissionId;
  if (
    !egressMatches ||
    decision.costScope !== costScope ||
    attempt.costScope !== costScope
  ) {
    throw new Error(
      "budgeted start requires one passed egress admission and exact cost-scope links",
    );
  }
  if (decision.routerInputSnapshot === undefined) {
    throw new Error(
      "budgeted start requires the current checkpoint-router input snapshot",
    );
  }
  if (decision.routerInputSnapshot.asOf !== input.createdAt) {
    throw new Error(
      "budgeted start requires router snapshot asOf to match the atomic batch timestamp",
    );
  }
  if (!billingMatches(decision.billing, resolution.billing)) {
    throw new Error("routing decision billing does not match the locked budget position");
  }
  if (
    decision.campaignId !== input.campaignId ||
    decision.pricingSnapshotId !== input.pricingSnapshotId ||
    decision.credentialMetadataId !== credentialMetadataId
  ) {
    throw new Error(
      "routing decision campaign, pricing, or credential identity does not match the reservation",
    );
  }
  if (attempt.attemptId !== input.attemptId) {
    throw new Error(`budgeted start expected attempt ${input.attemptId}`);
  }

  if (resolution.status === "admitted") {
    const checkpoint = events.find(
      (event) => event.type === "context.compiled",
    );
    if (checkpoint?.type !== "context.compiled") {
      throw new Error("admitted cloud start requires its context checkpoint");
    }
    const billableInputTokens =
      checkpoint.payload.estimatedTokens +
      checkpoint.payload.reservedInputTokens;
    if (
      decision.reasonCode !== "cloud_admitted" ||
      decision.selectedProviderId !== input.providerId ||
      decision.budgetReservationId !== input.reservationId ||
      attempt.providerId !== input.providerId ||
      attempt.budgetReservationId !== input.reservationId ||
      attempt.requestedMaxOutputTokens !==
        resolution.billing.requestedMaxOutputTokens ||
      !Number.isSafeInteger(billableInputTokens) ||
      resolution.billing.billableInputTokens !== billableInputTokens
    ) {
      throw new Error(
        "admitted cloud start does not match its provider, reservation, output allowance, or billable packet size",
      );
    }
  } else {
    const denialFact = decision.triggerFacts.find(
      (fact) => fact.key === "budget_denial_reason",
    );
    if (
      decision.reasonCode !== "budget_denial" ||
      decision.proposedProviderId !== input.providerId ||
      decision.budgetReservationId !== undefined ||
      attempt.budgetReservationId !== undefined ||
      denialFact?.value !== resolution.reason
    ) {
      throw new Error(
        "budget denial must retain local execution and persist its exact denial reason",
      );
    }
  }
  return { attemptId: attempt.attemptId, providerId: attempt.providerId };
}

function actualHostPricedCost(
  reservation: ReturnType<
    import("./budget-ledger").BudgetLedgerTransaction["requireReservation"]
  >,
  finish: InferenceAttemptFinishedPayload,
): number {
  if (!finish.usage.reported) {
    throw new Error("host pricing requires trustworthy reported usage");
  }
  if (
    reservation.cacheReadRateMicrousdPerMillion > 0 &&
    finish.usage.cacheReadTokens === undefined
  ) {
    throw new Error(
      "host pricing requires reported cache-read usage when the cache rate is nonzero",
    );
  }
  const cacheReadTokens = finish.usage.cacheReadTokens ?? 0;
  if (cacheReadTokens > finish.usage.inputTokens) {
    throw new Error("host pricing cache-read tokens exceed total input tokens");
  }
  const uncachedInputTokens = finish.usage.inputTokens - cacheReadTokens;
  const billableOutputTokens =
    BigInt(finish.usage.outputTokens) +
    BigInt(finish.usage.reasoningTokens);
  const component = (tokens: number | bigint, rate: number): bigint => {
    const product = BigInt(tokens) * BigInt(rate);
    return (product + 999_999n) / 1_000_000n;
  };
  const amount =
    component(
      uncachedInputTokens,
      reservation.inputRateMicrousdPerMillion,
    ) +
    component(
      billableOutputTokens,
      reservation.outputRateMicrousdPerMillion,
    ) +
    component(
      cacheReadTokens,
      reservation.cacheReadRateMicrousdPerMillion,
    ) +
    BigInt(reservation.providerFeeCeilingMicrousd);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("host-priced actual cost exceeds the safe-integer range");
  }
  return Number(amount);
}

function requireOverrunFailure(events: readonly SessionEventData[]): void {
  const terminal = events.at(-1);
  if (
    terminal?.type !== "session.failed" ||
    !terminal.payload.error.toLowerCase().includes("budget overrun")
  ) {
    throw new Error(
      "a budget overrun must fail the session in the same atomic event batch",
    );
  }
}

export class AttemptUnitOfWork {
  private readonly store;
  private readonly faultInjector?: (
    point: AtomicPersistenceFaultPoint,
  ) => void;

  constructor(
    private readonly ledger: BudgetLedger,
    options: AttemptUnitOfWorkOptions = {},
  ) {
    this.store = ledger.eventStore;
    this.faultInjector = options.faultInjector;
  }

  commitLocalStart(input: CommitLocalStartInput): CommittedAttemptStart {
    const events = parseBatch(input.events);
    const attempt = validateLocalStartBatch(
      events,
      input.createdAt,
      input.costScope,
      input.cloudEgressAdmissionId,
    );
    const stored = this.appendAtomicEvents(input, events, input.eventIds);
    return withStartPersistenceReceipt(
      this.ledger,
      {
        sessionId: input.sessionId,
        createdAt: input.createdAt,
        attemptId: attempt.payload.attemptId,
        providerId: attempt.payload.providerId,
        costScope: input.costScope,
        ...(input.cloudEgressAdmissionId === undefined
          ? {}
          : { cloudEgressAdmissionId: input.cloudEgressAdmissionId }),
      },
      {
        events: stored,
        attemptId: attempt.payload.attemptId,
        providerId: attempt.payload.providerId,
        dispatchAuthorized: true,
        paidDispatchAuthorized: false,
      },
    );
  }

  commitBudgetedStart(
    input: CommitBudgetedStartInput,
  ): CommittedAttemptStart {
    const costScope = RuntimeCostScopeSchema.parse(input.costScope);
    if (costScope !== "simulation") {
      throw new Error(
        "Actual cloud dispatch is not authorized by the PR6B0 attempt unit of work",
      );
    }
    validateBudgetedStartEventIds(input);
    const committed = this.ledger.runImmediate((transaction) => {
      const state = this.store.replay(input.sessionId);
      if (state.lastSequence !== input.expectedSequence) {
        throw new SequenceConflictError(
          input.sessionId,
          input.expectedSequence,
          state.lastSequence,
        );
      }
      transaction.assertEventReconciled();
      const campaign = transaction.requireCampaign(input.campaignId);
      if (campaign.costScope !== input.costScope) {
        throw new Error("budgeted start campaign cost scope mismatch");
      }
      const resolution = transaction.reserve({
        campaignId: input.campaignId,
        reservationId: input.reservationId,
        sessionId: input.sessionId,
        attemptId: input.attemptId,
        providerId: input.providerId,
        pricingSnapshotId: input.pricingSnapshotId,
        costScope: input.costScope,
        cloudEgressAdmissionId: input.cloudEgressAdmissionId,
        episodeCapMicrousd: episodeBudgetCap(state),
        projection: input.projection,
        createdAt: input.createdAt,
      });
      this.faultInjector?.("after_budget_mutation");
      const events = parseBatch(input.buildEvents(resolution));
      const start = validateBudgetedStartBatch(
        input,
        resolution,
        events,
        campaign.credentialMetadataId,
      );
      const stored = this.appendAtomicEvents(
        input,
        events,
        input.eventIds[resolution.status],
      );
      this.faultInjector?.("after_event_append");
      return {
        events: stored,
        ...start,
        dispatchAuthorized: true as const,
        paidDispatchAuthorized: resolution.status === "admitted",
        budgetResolution: resolution,
      };
    });
    return withStartPersistenceReceipt(
      this.ledger,
      {
        sessionId: input.sessionId,
        createdAt: input.createdAt,
        attemptId: input.attemptId,
        providerId: input.providerId,
        costScope,
        ...(input.cloudEgressAdmissionId === undefined
          ? {}
          : { cloudEgressAdmissionId: input.cloudEgressAdmissionId }),
        campaignId: input.campaignId,
        reservationId: input.reservationId,
        pricingSnapshotId: input.pricingSnapshotId,
      },
      committed,
    );
  }

  commitAttemptFinish(
    input: CommitAttemptFinishInput,
  ): CommittedAttemptFinish {
    const parsedEvents = parseBatch(input.events);
    const finishEvent = validateAttemptFinishBatch(parsedEvents);
    const committed = this.ledger.runImmediate((transaction) => {
      const state = this.store.replay(input.sessionId);
      if (state.lastSequence !== input.expectedSequence) {
        throw new SequenceConflictError(
          input.sessionId,
          input.expectedSequence,
          state.lastSequence,
        );
      }
      const assertionResult = input.assertOpenState?.(state);
      if (isPromiseLike(assertionResult)) {
        throw new TypeError("attempt finish state assertions must be synchronous");
      }
      const attempt = state.inferenceAttempts.find(
        (candidate) => candidate.attemptId === finishEvent.payload.attemptId,
      );
      if (attempt === undefined || attempt.finished !== undefined) {
        throw new Error(
          `Attempt ${finishEvent.payload.attemptId} is not the open persisted attempt`,
        );
      }

      let terminalBudgetEntry: BudgetTerminalEntry | undefined;
      if (attempt.budgetReservationId === undefined) {
        if (input.terminalLedgerEntryId !== undefined) {
          throw new Error("an unreserved attempt cannot create a budget terminal row");
        }
        if (
          finishEvent.payload.cost.amountMicrousd !== 0 ||
          finishEvent.payload.cost.provenance !== "local_zero_cost_policy" ||
          finishEvent.payload.cost.reservationId !== undefined
        ) {
          throw new Error(
            "an unreserved attempt must finish under the local zero-cost policy",
          );
        }
      } else {
        if (input.terminalLedgerEntryId === undefined) {
          throw new Error("a reserved attempt requires a preallocated terminal ledger ID");
        }
        terminalBudgetEntry = this.resolveAttemptBudget(
          transaction,
          input,
          attempt,
          finishEvent.payload,
          parsedEvents,
        );
        this.faultInjector?.("after_budget_mutation");
      }

      const stored = this.appendAtomicEvents(
        input,
        parsedEvents,
        input.eventIds,
      );
      this.faultInjector?.("after_event_append");
      return {
        events: stored,
        attemptId: attempt.attemptId,
        ...(terminalBudgetEntry === undefined ? {} : { terminalBudgetEntry }),
      };
    });
    return withFinishPersistenceReceipt(this.ledger, input, committed);
  }

  commitRecoveryFinish(
    input: CommitAttemptFinishInput,
  ): CommittedAttemptFinish {
    const events = parseBatch(input.events);
    const finish = requireSingleAttemptFinish(events);
    const terminal = events.at(-1);
    if (
      finish.payload.outcome !== "interrupted" ||
      finish.payload.requestDisposition !== "unknown" ||
      terminal?.type !== "session.interrupted"
    ) {
      throw new Error(
        "recovery finish requires an unknown interrupted attempt followed by session.interrupted",
      );
    }
    return this.commitAttemptFinish({ ...input, events });
  }

  private appendAtomicEvents(
    input: Pick<
      AtomicEventBatch,
      "sessionId" | "expectedSequence" | "createdAt"
    >,
    events: readonly SessionEventData[],
    eventIds: readonly string[],
  ): StoredSessionEvent[] {
    return this.store.appendMany(input.sessionId, events, {
      expectedSequence: input.expectedSequence,
      createdAt: input.createdAt,
      eventIds,
      ...(this.faultInjector === undefined
        ? {}
        : {
            afterEachPersistedForTest: (zeroBasedIndex: number) => {
              this.faultInjector?.(
                `after_event_append:${zeroBasedIndex + 1}`,
              );
            },
          }),
    });
  }

  private resolveAttemptBudget(
    transaction: import("./budget-ledger").BudgetLedgerTransaction,
    input: CommitAttemptFinishInput,
    attempt: InferenceAttemptRecord,
    finish: InferenceAttemptFinishedPayload,
    events: readonly SessionEventData[],
  ): BudgetTerminalEntry {
    const reservationId = attempt.budgetReservationId;
    if (reservationId === undefined || input.terminalLedgerEntryId === undefined) {
      throw new Error("reserved attempt budget resolution is missing an identity");
    }
    const reservation = transaction.requireReservation(reservationId);
    if (
      reservation.sessionId !== input.sessionId ||
      reservation.attemptId !== attempt.attemptId ||
      finish.cost.reservationId !== reservationId
    ) {
      throw new Error(
        "attempt finish does not match its budget reservation session and attempt identity",
      );
    }

    if (finish.requestDisposition === "not_sent") {
      if (
        finish.cost.amountMicrousd !== 0 ||
        finish.cost.provenance !== "host_pricing_snapshot"
      ) {
        throw new Error(
          "a definitely unsent reserved attempt requires host-proven zero cost",
        );
      }
      return transaction.resolve({
        terminalEntryId: input.terminalLedgerEntryId,
        reservationId,
        rowType: "release",
        amountMicrousd: 0,
        requestDisposition: "not_sent",
        reasonCode: finish.errorCode ?? "definitely_unsent",
        createdAt: input.createdAt,
      });
    }

    if (finish.cost.provenance === "local_zero_cost_policy") {
      throw new Error("a reserved attempt cannot use local zero-cost provenance");
    }
    if (finish.cost.provenance === "host_pricing_snapshot") {
      const expected = actualHostPricedCost(reservation, finish);
      if (finish.cost.amountMicrousd !== expected) {
        throw new Error(
          `host-priced cost ${finish.cost.amountMicrousd} does not match ${expected}`,
        );
      }
    }
    if (
      finish.cost.provenance === "reserved_unknown" &&
      finish.cost.amountMicrousd !== reservation.amountMicrousd
    ) {
      throw new Error("reserved_unknown must consume the exact full reservation");
    }

    const overrun = finish.cost.amountMicrousd > reservation.amountMicrousd;
    if (overrun) requireOverrunFailure(events);
    return transaction.resolve({
      terminalEntryId: input.terminalLedgerEntryId,
      reservationId,
      rowType: overrun ? "overrun" : "settlement",
      amountMicrousd: finish.cost.amountMicrousd,
      costProvenance: finish.cost.provenance,
      requestDisposition: finish.requestDisposition,
      ...(overrun ? { reasonCode: "budget_overrun" } : {}),
      createdAt: input.createdAt,
    });
  }
}

export { BUDGET_CACHE_ASSUMPTION };
