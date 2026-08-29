import { afterEach, describe, expect, it } from "vitest";

import {
  AttemptUnitOfWork,
  type AtomicPersistenceFaultPoint,
} from "../../src/main/attempt-unit-of-work";
import {
  BUDGET_CACHE_ASSUMPTION,
  BudgetLedger,
  type BudgetReservationResolution,
} from "../../src/main/budget-ledger";
import {
  createSoarDatabase,
  type SoarDatabase,
} from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";
import type {
  RoutingDecisionPayload,
  SessionEventData,
} from "../../src/shared/session-events";

const databases: SoarDatabase[] = [];

const SESSION_ID = "atomic-session";
const LOCAL_PROVIDER = "local-vllm";
const LOCAL_MODEL = "local-model";
const CLOUD_PROVIDER = "fake-cloud";
const CLOUD_MODEL = "fake-cloud-model";
const CAMPAIGN_ID = "campaign-1";
const CREDENTIAL_ID = "credential-1";
const PRICING_ID = "pricing-1";
const RESERVATION_ID = "reservation-1";
const CLOUD_ATTEMPT_ID = `${SESSION_ID}:attempt:2`;
const INITIAL_DECISION_ID = `${SESSION_ID}:decision:1`;

function eventIds(prefix: string, length: number): string[] {
  return Array.from({ length }, (_, index) => `${prefix}:event:${index + 1}`);
}

function budgetedStartEventIds(prefix: string) {
  return {
    admitted: eventIds(`${prefix}:admitted`, 5),
    denied: eventIds(`${prefix}:denied`, 4),
  };
}

function localAdmission(): RoutingDecisionPayload["admission"] {
  const notApplicable = {
    status: "not_applicable" as const,
    reasonCode: "not_applicable" as const,
  };
  return {
    capability: { status: "passed", reasonCode: "capability_ok" },
    credential: notApplicable,
    health: notApplicable,
    egress: notApplicable,
    deadline: { status: "passed", reasonCode: "deadline_ok" },
    budget: notApplicable,
  };
}

function cloudAdmission(
  budget: "passed" | "denied",
): RoutingDecisionPayload["admission"] {
  return {
    capability: { status: "passed", reasonCode: "capability_ok" },
    credential: { status: "passed", reasonCode: "credential_ok" },
    health: { status: "passed", reasonCode: "health_ok" },
    pricing: { status: "passed", reasonCode: "pricing_ok" },
    egress: { status: "passed", reasonCode: "egress_ok" },
    deadline: { status: "passed", reasonCode: "deadline_ok" },
    budget:
      budget === "passed"
        ? { status: "passed", reasonCode: "budget_ok" }
        : { status: "denied", reasonCode: "budget_denial" },
  };
}

function localRouterInputSnapshot(sessionId = SESSION_ID) {
  return {
    schemaVersion: "checkpoint-router-input-v0" as const,
    boundary: "session_start" as const,
    asOf: "2026-08-29T00:00:02.000Z",
    providers: [
      {
        providerId: LOCAL_PROVIDER,
        model: LOCAL_MODEL,
        locality: "local" as const,
        enabled: true,
        capabilities: ["chat_completions", "streaming", "tool_calling"],
        accountingKind: "local_zero_cost" as const,
        contextWindowTokens: 2_000,
        maxOutputTokens: 512,
        requestReserveTokens: 100,
      },
    ],
    targetProviderId: LOCAL_PROVIDER,
    targetModel: LOCAL_MODEL,
    requiredCapabilities: ["chat_completions", "streaming", "tool_calling"],
    deadline: {
      deadlineAt: "2026-08-29T00:02:01.000Z",
      remainingMs: 119_000,
      attemptTimeoutMs: 30_000,
      requiredRemainingMs: 1,
      sufficient: true,
    },
    healthSnapshots: [
      {
        snapshotId: `${sessionId}:health:local`,
        providerId: LOCAL_PROVIDER,
        model: LOCAL_MODEL,
        checkedAt: "2026-08-29T00:00:02.000Z",
        expiresAt: "2026-08-29T00:01:02.000Z",
        status: "healthy" as const,
        resultCode: "model_available",
      },
    ],
  };
}

function cloudRouterInputSnapshot() {
  return {
    schemaVersion: "checkpoint-router-input-v0" as const,
    boundary: "evidence_complete" as const,
    asOf: "2026-08-29T00:00:04.000Z",
    providers: [
      {
        providerId: CLOUD_PROVIDER,
        model: CLOUD_MODEL,
        locality: "cloud" as const,
        enabled: true,
        capabilities: ["chat_completions", "streaming"],
        accountingKind: "metered" as const,
        contextWindowTokens: 2_000,
        maxOutputTokens: 100,
        requestReserveTokens: 0,
      },
      {
        providerId: LOCAL_PROVIDER,
        model: LOCAL_MODEL,
        locality: "local" as const,
        enabled: true,
        capabilities: ["chat_completions", "streaming", "tool_calling"],
        accountingKind: "local_zero_cost" as const,
        contextWindowTokens: 2_000,
        maxOutputTokens: 512,
        requestReserveTokens: 100,
      },
    ],
    targetProviderId: CLOUD_PROVIDER,
    targetModel: CLOUD_MODEL,
    requiredCapabilities: ["chat_completions", "streaming"],
    deadline: {
      deadlineAt: "2026-08-29T00:02:01.000Z",
      remainingMs: 117_000,
      attemptTimeoutMs: 30_000,
      requiredRemainingMs: 30_000,
      sufficient: true,
    },
    healthSnapshots: [
      {
        snapshotId: "health-1",
        providerId: CLOUD_PROVIDER,
        model: CLOUD_MODEL,
        checkedAt: "2026-08-29T00:00:04.000Z",
        expiresAt: "2026-08-29T00:01:04.000Z",
        status: "healthy" as const,
        resultCode: "model_available",
      },
      {
        snapshotId: "health-local",
        providerId: LOCAL_PROVIDER,
        model: LOCAL_MODEL,
        checkedAt: "2026-08-29T00:00:04.000Z",
        expiresAt: "2026-08-29T00:01:04.000Z",
        status: "healthy" as const,
        resultCode: "model_available",
      },
    ],
    pricingSnapshot: {
      snapshotId: PRICING_ID,
      providerId: CLOUD_PROVIDER,
      model: CLOUD_MODEL,
      verifiedAt: "2026-08-29T00:00:04.000Z",
      expiresAt: "2026-08-30T00:00:04.000Z",
      status: "available" as const,
      inputMicrousdPerMillionTokens: 1_000_000,
      outputMicrousdPerMillionTokens: 1_000_000,
      cacheReadMicrousdPerMillionTokens: 0,
      pricingSourceSha256: "9".repeat(64),
    },
  };
}

function contextEvent(options: {
  checkpointId: string;
  reason: "session_start" | "finalization_boundary";
  providerId: string;
  model: string;
  estimatedTokens: number;
  packetSha256: string;
  messagesSha256: string;
  decisionId: string;
  leaseId: string;
  messageId: string;
  attemptId: string;
  reservedInputTokens?: number;
}): SessionEventData {
  const reservedInputTokens = options.reservedInputTokens ?? 100;
  return {
    type: "context.compiled",
    payload: {
      checkpointId: options.checkpointId,
      compilerVersion: "context-compiler-v1",
      reason: options.reason,
      mode: options.reason === "session_start" ? "working" : "finalization",
      providerId: options.providerId,
      model: options.model,
      maxTokens: 2_000,
      estimatedTokens: options.estimatedTokens,
      estimator: "utf8-bytes-v1",
      reservedInputTokens,
      effectiveInputTokenBudget: 1_800 - reservedInputTokens,
      sourceMessageCount: 1,
      messageCount: 1,
      evidenceCount: 0,
      deduplicatedEvidenceCount: 0,
      omittedEvidenceCount: 0,
      packetSha256: options.packetSha256,
      messagesSha256: options.messagesSha256,
      safetyMargin: 0.1,
      decisionId: options.decisionId,
      leaseId: options.leaseId,
      messageId: options.messageId,
      attemptId: options.attemptId,
    },
  };
}

function createV2Session(
  store: EventStore,
  options: { sessionId?: string; episodeCapMicrousd?: number } = {},
): string {
  const sessionId = options.sessionId ?? SESSION_ID;
  store.createSession({
    id: sessionId,
    title: "Atomic budget session",
    objective: "Collect evidence and synthesize.",
    workspaceRoot: "/tmp/workspace",
    executionPolicy: {
      schemaVersion: "agentic-execution-v2",
      inferenceRounds: 4,
      toolCalls: 2,
      routingPolicy: "hybrid_v0",
      maxProviderChanges: 2,
      maxPaidAttempts: 1,
      maxPaidEpisodeMicrousd: options.episodeCapMicrousd ?? 250,
      maxEpisodeDurationMs: 120_000,
      attemptTimeoutMs: 30_000,
      egressConsent: "session_cloud_synthesis_v1",
    },
    createdAt: "2026-08-29T00:00:00.000Z",
  });
  store.append(
    sessionId,
    {
      type: "session.started",
      payload: {
        startedAt: "2026-08-29T00:00:01.000Z",
        deadlineAt: "2026-08-29T00:02:01.000Z",
      },
    },
    {
      expectedSequence: 2,
      eventId: `${sessionId}:started-event`,
      createdAt: "2026-08-29T00:00:01.000Z",
    },
  );
  return sessionId;
}

function initialLocalStartEvents(sessionId = SESSION_ID): SessionEventData[] {
  const decisionId = `${sessionId}:decision:1`;
  const leaseId = `${sessionId}:lease:1`;
  const messageId = `${sessionId}:assistant:1`;
  const checkpointId = `${sessionId}:context:1`;
  const attemptId = `${sessionId}:attempt:1`;
  return [
    {
      type: "routing.decision.recorded",
      payload: {
        decisionId,
        policyVersion: "hybrid-lease-router-v0",
        boundary: "session_start",
        phase: "investigation",
        action: "assign_new_lease",
        reasonCode: "local_investigation",
        candidateProviderIds: [LOCAL_PROVIDER],
        selectedProviderId: LOCAL_PROVIDER,
        selectedModel: LOCAL_MODEL,
        selectedLeaseId: leaseId,
        riskSignals: [],
        triggerFacts: [],
        admission: localAdmission(),
        routerInputSnapshot: localRouterInputSnapshot(sessionId),
      },
    },
    {
      type: "route.assigned",
      payload: {
        providerId: LOCAL_PROVIDER,
        model: LOCAL_MODEL,
        reason: "local investigation",
        decisionId,
        leaseId,
        phase: "investigation",
      },
    },
    {
      type: "assistant.message.started",
      payload: {
        messageId,
        providerId: LOCAL_PROVIDER,
        model: LOCAL_MODEL,
        decisionId,
        leaseId,
        checkpointId,
        attemptId,
      },
    },
    contextEvent({
      checkpointId,
      reason: "session_start",
      providerId: LOCAL_PROVIDER,
      model: LOCAL_MODEL,
      estimatedTokens: 100,
      packetSha256: "1".repeat(64),
      messagesSha256: "2".repeat(64),
      decisionId,
      leaseId,
      messageId,
      attemptId,
    }),
    {
      type: "inference.attempt.started",
      payload: {
        attemptId,
        round: 1,
        checkpointId,
        messageId,
        decisionId,
        leaseId,
        providerId: LOCAL_PROVIDER,
        requestedModel: LOCAL_MODEL,
        phase: "investigation",
        requestedMaxOutputTokens: 512,
        allowTools: true,
        allowedToolNames: ["read_text_file"],
        requireToolCall: true,
      },
    },
  ];
}

function finishInitialEvidenceRound(store: EventStore, sessionId = SESSION_ID): void {
  const messageId = `${sessionId}:assistant:1`;
  const attemptId = `${sessionId}:attempt:1`;
  store.appendMany(
    sessionId,
    [
      {
        type: "assistant.message.completed",
        payload: {
          messageId,
          stopReason: "tool_calls",
          completionState: "complete",
          attemptId,
        },
      },
      {
        type: "inference.attempt.finished",
        payload: {
          attemptId,
          checkpointId: `${sessionId}:context:1`,
          outcome: "succeeded",
          requestDisposition: "sent",
          finishReason: "tool_calls",
          servedModel: LOCAL_MODEL,
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            reasoningTokens: 0,
            reported: true,
          },
          cost: { amountMicrousd: 0, provenance: "local_zero_cost_policy" },
          latencyMs: 10,
        },
      },
      {
        type: "tool.call.requested",
        payload: {
          toolCallId: `${sessionId}:tool:1`,
          messageId,
          name: "read_text_file",
          arguments: { relativePath: "README.md" },
        },
      },
      {
        type: "tool.call.completed",
        payload: {
          toolCallId: `${sessionId}:tool:1`,
          name: "read_text_file",
          content: JSON.stringify({
            ok: true,
            text: "evidence",
            bytes: 8,
            truncated: false,
          }),
          isError: false,
          durationMs: 1,
        },
      },
    ],
    {
      expectedSequence: 8,
      eventIds: eventIds(`${sessionId}:evidence`, 4),
      createdAt: "2026-08-29T00:00:03.000Z",
    },
  );
}

function setup(options: {
  episodeCapMicrousd?: number;
  campaignAutomaticStopMicrousd?: number;
  faultPoint?: AtomicPersistenceFaultPoint;
} = {}) {
  const database = createSoarDatabase();
  databases.push(database);
  const store = new EventStore(database);
  createV2Session(store, {
    episodeCapMicrousd: options.episodeCapMicrousd,
  });
  const ledger = new BudgetLedger(store);
  ledger.createCampaign({
    id: CAMPAIGN_ID,
    providerId: CLOUD_PROVIDER,
    credentialMetadataId: CREDENTIAL_ID,
    openingExposureMicrousd: 0,
    automaticStopMicrousd:
      options.campaignAutomaticStopMicrousd ?? 90_000_000,
    hardCeilingMicrousd: 100_000_000,
    createdAt: "2026-08-29T00:00:00.000Z",
  });
  const attempts = new AttemptUnitOfWork(ledger, {
    ...(options.faultPoint === undefined
      ? {}
      : {
          faultInjector: (point) => {
            if (point === options.faultPoint) throw new Error(`fault:${point}`);
          },
        }),
  });
  return { database, store, ledger, attempts };
}

function makeEvidenceReady(options: {
  episodeCapMicrousd?: number;
  campaignAutomaticStopMicrousd?: number;
  faultPoint?: AtomicPersistenceFaultPoint;
} = {}) {
  const fixture = setup(options);
  const initial = initialLocalStartEvents();
  new AttemptUnitOfWork(fixture.ledger).commitLocalStart({
    sessionId: SESSION_ID,
    expectedSequence: 3,
    createdAt: "2026-08-29T00:00:02.000Z",
    eventIds: eventIds("initial", initial.length),
    events: initial,
  });
  finishInitialEvidenceRound(fixture.store);
  return fixture;
}

function projection() {
  return {
    billableInputTokens: 100,
    billableCacheReadTokens: 0,
    requestedMaxOutputTokens: 100,
    inputMicrousdPerMillionTokens: 1_000_000,
    outputMicrousdPerMillionTokens: 1_000_000,
    providerFeeCeilingMicrousd: 50,
    cacheAssumption: BUDGET_CACHE_ASSUMPTION,
  } as const;
}

function cloudStartEvents(
  resolution: BudgetReservationResolution,
  options: {
    sessionId?: string;
    reservationId?: string;
    attemptId?: string;
  } = {},
): SessionEventData[] {
  const sessionId = options.sessionId ?? SESSION_ID;
  const reservationId = options.reservationId ?? RESERVATION_ID;
  const attemptId = options.attemptId ?? CLOUD_ATTEMPT_ID;
  const initialLeaseId = `${sessionId}:lease:1`;
  const decisionId = `${sessionId}:decision:2`;
  const messageId = `${sessionId}:assistant:2`;
  const checkpointId = `${sessionId}:context:2`;
  if (resolution.status === "admitted") {
    const leaseId = `${sessionId}:lease:2`;
    return [
      {
        type: "routing.decision.recorded",
        payload: {
          decisionId,
          policyVersion: "hybrid-lease-router-v0",
          boundary: "evidence_complete",
          phase: "synthesis",
          action: "assign_new_lease",
          reasonCode: "cloud_admitted",
          candidateProviderIds: [CLOUD_PROVIDER, LOCAL_PROVIDER],
          selectedProviderId: CLOUD_PROVIDER,
          selectedModel: CLOUD_MODEL,
          priorLeaseId: initialLeaseId,
          selectedLeaseId: leaseId,
          riskSignals: [],
          triggerFacts: [
            { key: "router_evidence_ready", value: true },
            {
              key: "router_successful_investigation_attempt_count",
              value: 1,
            },
          ],
          admission: cloudAdmission("passed"),
          routerInputSnapshot: cloudRouterInputSnapshot(),
          healthSnapshotId: "health-1",
          pricingSnapshotId: PRICING_ID,
          campaignId: CAMPAIGN_ID,
          budgetReservationId: reservationId,
          credentialMetadataId: CREDENTIAL_ID,
          billing: resolution.billing,
          checkpointId,
          packetSha256: "3".repeat(64),
          messagesSha256: "4".repeat(64),
        },
      },
      {
        type: "route.assigned",
        payload: {
          providerId: CLOUD_PROVIDER,
          model: CLOUD_MODEL,
          reason: "admitted fake cloud synthesis",
          decisionId,
          leaseId,
          phase: "synthesis",
        },
      },
      {
        type: "assistant.message.started",
        payload: {
          messageId,
          providerId: CLOUD_PROVIDER,
          model: CLOUD_MODEL,
          decisionId,
          leaseId,
          checkpointId,
          attemptId,
        },
      },
      contextEvent({
        checkpointId,
        reason: "finalization_boundary",
        providerId: CLOUD_PROVIDER,
        model: CLOUD_MODEL,
        estimatedTokens: resolution.billing.billableInputTokens,
        reservedInputTokens: 0,
        packetSha256: "3".repeat(64),
        messagesSha256: "4".repeat(64),
        decisionId,
        leaseId,
        messageId,
        attemptId,
      }),
      {
        type: "inference.attempt.started",
        payload: {
          attemptId,
          round: 2,
          checkpointId,
          messageId,
          decisionId,
          leaseId,
          providerId: CLOUD_PROVIDER,
          requestedModel: CLOUD_MODEL,
          phase: "synthesis",
          requestedMaxOutputTokens: resolution.billing.requestedMaxOutputTokens,
          allowTools: false,
          requireToolCall: false,
          budgetReservationId: reservationId,
        },
      },
    ];
  }

  return [
    {
      type: "routing.decision.recorded",
      payload: {
        decisionId,
        policyVersion: "hybrid-lease-router-v0",
        boundary: "evidence_complete",
        phase: "synthesis",
        action: "retain_lease",
        reasonCode: "budget_denial",
        candidateProviderIds: [CLOUD_PROVIDER, LOCAL_PROVIDER],
        selectedProviderId: LOCAL_PROVIDER,
        selectedModel: LOCAL_MODEL,
        proposedProviderId: CLOUD_PROVIDER,
        proposedModel: CLOUD_MODEL,
        priorLeaseId: initialLeaseId,
        selectedLeaseId: initialLeaseId,
        riskSignals: [],
        triggerFacts: [
          { key: "budget_denial_reason", value: resolution.reason },
          { key: "router_evidence_ready", value: true },
          {
            key: "router_successful_investigation_attempt_count",
            value: 1,
          },
        ],
        admission: cloudAdmission("denied"),
        routerInputSnapshot: cloudRouterInputSnapshot(),
        healthSnapshotId: "health-1",
        pricingSnapshotId: PRICING_ID,
        campaignId: CAMPAIGN_ID,
        credentialMetadataId: CREDENTIAL_ID,
        billing: resolution.billing,
        proposalCheckpointId: `${sessionId}:proposal:2`,
        proposalPacketSha256: "5".repeat(64),
        proposalMessagesSha256: "6".repeat(64),
      },
    },
    {
      type: "assistant.message.started",
      payload: {
        messageId,
        providerId: LOCAL_PROVIDER,
        model: LOCAL_MODEL,
        decisionId,
        leaseId: initialLeaseId,
        checkpointId,
        attemptId,
      },
    },
    contextEvent({
      checkpointId,
      reason: "finalization_boundary",
      providerId: LOCAL_PROVIDER,
      model: LOCAL_MODEL,
      estimatedTokens: 80,
      packetSha256: "7".repeat(64),
      messagesSha256: "8".repeat(64),
      decisionId,
      leaseId: initialLeaseId,
      messageId,
      attemptId,
    }),
    {
      type: "inference.attempt.started",
      payload: {
        attemptId,
        round: 2,
        checkpointId,
        messageId,
        decisionId,
        leaseId: initialLeaseId,
        providerId: LOCAL_PROVIDER,
        requestedModel: LOCAL_MODEL,
        phase: "synthesis",
        requestedMaxOutputTokens: 512,
        allowTools: false,
        requireToolCall: false,
      },
    },
  ];
}

function commitCloudStart(
  fixture: ReturnType<typeof makeEvidenceReady>,
) {
  return fixture.attempts.commitBudgetedStart({
    sessionId: SESSION_ID,
    expectedSequence: 12,
    createdAt: "2026-08-29T00:00:04.000Z",
    eventIds: budgetedStartEventIds("cloud-start"),
    campaignId: CAMPAIGN_ID,
    reservationId: RESERVATION_ID,
    attemptId: CLOUD_ATTEMPT_ID,
    providerId: CLOUD_PROVIDER,
    pricingSnapshotId: PRICING_ID,
    projection: projection(),
    buildEvents: cloudStartEvents,
  });
}

function successfulCloudFinishEvents(options: {
  amountMicrousd?: number;
  provenance?: "provider_reported" | "host_pricing_snapshot";
  includeOverrunFailure?: boolean;
} = {}): SessionEventData[] {
  const amount = options.amountMicrousd ?? 125;
  const events: SessionEventData[] = [
    {
      type: "assistant.message.completed",
      payload: {
        messageId: `${SESSION_ID}:assistant:2`,
        content: "Review complete.",
        stopReason: "stop",
        completionState: "complete",
        attemptId: CLOUD_ATTEMPT_ID,
      },
    },
    {
      type: "inference.attempt.finished",
      payload: {
        attemptId: CLOUD_ATTEMPT_ID,
        checkpointId: `${SESSION_ID}:context:2`,
        outcome: "succeeded",
        requestDisposition: "sent",
        finishReason: "stop",
        servedModel: CLOUD_MODEL,
        usage: {
          inputTokens: 50,
          outputTokens: 25,
          reasoningTokens: 0,
          reported: true,
        },
        cost: {
          amountMicrousd: amount,
          provenance: options.provenance ?? "host_pricing_snapshot",
          reservationId: RESERVATION_ID,
        },
        latencyMs: 20,
      },
    },
  ];
  if (options.includeOverrunFailure) {
    events.push({
      type: "session.failed",
      payload: { error: "Budget overrun: actual provider cost exceeded reservation." },
    });
  }
  return events;
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("AttemptUnitOfWork", () => {
  it("commits a local start with preallocated envelope IDs and no budget row", () => {
    const { store, ledger, attempts } = setup();
    const events = initialLocalStartEvents();
    const ids = eventIds("local-start", events.length);
    const committed = attempts.commitLocalStart({
      sessionId: SESSION_ID,
      expectedSequence: 3,
      createdAt: "2026-08-29T00:00:02.000Z",
      eventIds: ids,
      events,
    });
    expect(committed).toMatchObject({
      attemptId: `${SESSION_ID}:attempt:1`,
      providerId: LOCAL_PROVIDER,
      dispatchAuthorized: true,
      paidDispatchAuthorized: false,
    });
    expect(committed.events.map((event) => event.id)).toEqual(ids);
    expect(store.requireSession(SESSION_ID).lastSequence).toBe(8);
    expect(ledger.listOutstandingReservations()).toEqual([]);
  });

  for (const point of [
    "after_event_append:1",
    "after_event_append:2",
    "after_event_append:3",
    "after_event_append:4",
    "after_event_append:5",
  ] as const) {
    it(`rolls back the complete local start at ${point}`, () => {
      const fixture = setup({ faultPoint: point });
      const events = initialLocalStartEvents();
      expect(() =>
        fixture.attempts.commitLocalStart({
          sessionId: SESSION_ID,
          expectedSequence: 3,
          createdAt: "2026-08-29T00:00:02.000Z",
          eventIds: eventIds(`fault-local-${point}`, events.length),
          events,
        }),
      ).toThrow(`fault:${point}`);
      expect(fixture.store.requireSession(SESSION_ID).lastSequence).toBe(3);
      expect(fixture.store.getProjectedState(SESSION_ID).inferenceAttempts).toEqual([]);
    });
  }

  it("rejects a local routing snapshot from a different batch time", () => {
    const fixture = setup();
    const events = initialLocalStartEvents();
    expect(() =>
      fixture.attempts.commitLocalStart({
        sessionId: SESSION_ID,
        expectedSequence: 3,
        createdAt: "2026-08-29T00:00:03.000Z",
        eventIds: eventIds("stale-local-snapshot", events.length),
        events,
      }),
    ).toThrow(/router snapshot asOf to match the atomic batch timestamp/u);
    expect(fixture.store.requireSession(SESSION_ID).lastSequence).toBe(3);
  });

  it("rejects widened local batches and any unreserved metered finish", () => {
    const fixture = setup();
    const startEvents = initialLocalStartEvents();
    const widened: SessionEventData[] = [
      ...startEvents.slice(0, -1),
      {
        type: "session.failed",
        payload: { error: "This event cannot be smuggled into a start batch." },
      },
      startEvents.at(-1)!,
    ];
    expect(() =>
      fixture.attempts.commitLocalStart({
        sessionId: SESSION_ID,
        expectedSequence: 3,
        createdAt: "2026-08-29T00:00:02.000Z",
        eventIds: eventIds("widened-local-start", widened.length),
        events: widened,
      }),
    ).toThrow(/exact initial, routed, or retained-lease/);
    expect(fixture.store.requireSession(SESSION_ID).lastSequence).toBe(3);

    fixture.attempts.commitLocalStart({
      sessionId: SESSION_ID,
      expectedSequence: 3,
      createdAt: "2026-08-29T00:00:02.000Z",
      eventIds: eventIds("valid-local-start", startEvents.length),
      events: startEvents,
    });
    const pricedFinish: SessionEventData[] = [
      {
        type: "assistant.message.completed",
        payload: {
          messageId: `${SESSION_ID}:assistant:1`,
          content: "Unexpected paid output.",
          stopReason: "stop",
          completionState: "complete",
          attemptId: `${SESSION_ID}:attempt:1`,
        },
      },
      {
        type: "inference.attempt.finished",
        payload: {
          attemptId: `${SESSION_ID}:attempt:1`,
          checkpointId: `${SESSION_ID}:context:1`,
          outcome: "succeeded",
          requestDisposition: "sent",
          finishReason: "stop",
          servedModel: LOCAL_MODEL,
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            reasoningTokens: 0,
            reported: true,
          },
          cost: { amountMicrousd: 1, provenance: "provider_reported" },
          latencyMs: 1,
        },
      },
    ];
    expect(() =>
      fixture.attempts.commitAttemptFinish({
        sessionId: SESSION_ID,
        expectedSequence: 8,
        createdAt: "2026-08-29T00:00:03.000Z",
        eventIds: eventIds("priced-local-finish", pricedFinish.length),
        events: pricedFinish,
      }),
    ).toThrow(/local zero-cost policy/);
    expect(fixture.store.requireSession(SESSION_ID).lastSequence).toBe(8);
  });

  it("atomically commits reservation and admitted cloud start", () => {
    const fixture = makeEvidenceReady();
    const committed = commitCloudStart(fixture);
    expect(committed).toMatchObject({
      attemptId: CLOUD_ATTEMPT_ID,
      providerId: CLOUD_PROVIDER,
      dispatchAuthorized: true,
      paidDispatchAuthorized: true,
      budgetResolution: { status: "admitted" },
    });
    expect(fixture.ledger.listOutstandingReservations()).toMatchObject([
      {
        id: RESERVATION_ID,
        sessionId: SESSION_ID,
        attemptId: CLOUD_ATTEMPT_ID,
        amountMicrousd: 250,
      },
    ]);
    expect(fixture.store.requireSession(SESSION_ID).lastSequence).toBe(17);
    expect(fixture.store.replay(SESSION_ID)).toEqual(
      fixture.store.getProjectedState(SESSION_ID),
    );
  });

  it("rejects and rolls back a budgeted routing snapshot from a different batch time", () => {
    const fixture = makeEvidenceReady();
    expect(() =>
      fixture.attempts.commitBudgetedStart({
        sessionId: SESSION_ID,
        expectedSequence: 12,
        createdAt: "2026-08-29T00:00:05.000Z",
        eventIds: budgetedStartEventIds("stale-cloud-snapshot"),
        campaignId: CAMPAIGN_ID,
        reservationId: RESERVATION_ID,
        attemptId: CLOUD_ATTEMPT_ID,
        providerId: CLOUD_PROVIDER,
        pricingSnapshotId: PRICING_ID,
        projection: projection(),
        buildEvents: cloudStartEvents,
      }),
    ).toThrow(/router snapshot asOf to match the atomic batch timestamp/u);
    expect(fixture.store.requireSession(SESSION_ID).lastSequence).toBe(12);
    expect(fixture.ledger.listOutstandingReservations()).toEqual([]);
  });

  it("blocks paid admission when a prior reservation has no canonical start", () => {
    const fixture = makeEvidenceReady();
    const orphan = fixture.ledger.runImmediate((transaction) =>
      transaction.reserve({
        campaignId: CAMPAIGN_ID,
        reservationId: "orphan-reservation",
        sessionId: SESSION_ID,
        attemptId: "orphan-attempt",
        providerId: CLOUD_PROVIDER,
        pricingSnapshotId: PRICING_ID,
        episodeCapMicrousd: 250,
        projection: projection(),
        createdAt: "2026-08-29T00:00:04.000Z",
      }),
    );
    expect(orphan).toMatchObject({ status: "admitted" });

    expect(() => commitCloudStart(fixture)).toThrow(
      /orphan-reservation: ledger reservation has no canonical attempt/,
    );
    expect(fixture.store.requireSession(SESSION_ID).lastSequence).toBe(12);
  });

  it("detects a terminal ledger row written without its canonical finish", () => {
    const fixture = makeEvidenceReady();
    commitCloudStart(fixture);
    fixture.ledger.runImmediate((transaction) =>
      transaction.resolve({
        terminalEntryId: "orphan-terminal",
        reservationId: RESERVATION_ID,
        rowType: "settlement",
        amountMicrousd: 125,
        costProvenance: "host_pricing_snapshot",
        requestDisposition: "sent",
        createdAt: "2026-08-29T00:00:05.000Z",
      }),
    );

    expect(() => fixture.ledger.assertEventReconciled()).toThrow(
      /reservation-1: terminal row exists while the attempt is open/,
    );
  });

  it("detects an aligned host-priced finish with false charged-token math", () => {
    const fixture = makeEvidenceReady();
    commitCloudStart(fixture);
    fixture.ledger.runImmediate((transaction) =>
      transaction.resolve({
        terminalEntryId: "false-host-price",
        reservationId: RESERVATION_ID,
        rowType: "settlement",
        amountMicrousd: 126,
        costProvenance: "host_pricing_snapshot",
        requestDisposition: "sent",
        createdAt: "2026-08-29T00:00:05.000Z",
      }),
    );
    const events = successfulCloudFinishEvents({ amountMicrousd: 126 });
    fixture.store.appendMany(SESSION_ID, events, {
      expectedSequence: 17,
      createdAt: "2026-08-29T00:00:05.000Z",
      eventIds: eventIds("false-host-price", events.length),
    });

    expect(() => fixture.ledger.assertEventReconciled()).toThrow(
      /reservation-1: host-priced finish amount does not match usage/,
    );
  });

  it("detects an overrun that did not fail its session", () => {
    const fixture = makeEvidenceReady({ episodeCapMicrousd: 1_000 });
    commitCloudStart(fixture);
    fixture.ledger.runImmediate((transaction) =>
      transaction.resolve({
        terminalEntryId: "unfailed-overrun",
        reservationId: RESERVATION_ID,
        rowType: "overrun",
        amountMicrousd: 251,
        costProvenance: "provider_reported",
        requestDisposition: "sent",
        reasonCode: "budget_overrun",
        createdAt: "2026-08-29T00:00:05.000Z",
      }),
    );
    const events = successfulCloudFinishEvents({
      amountMicrousd: 251,
      provenance: "provider_reported",
    });
    fixture.store.appendMany(SESSION_ID, events, {
      expectedSequence: 17,
      createdAt: "2026-08-29T00:00:05.000Z",
      eventIds: eventIds("unfailed-overrun", events.length),
    });

    expect(() => fixture.ledger.assertEventReconciled()).toThrow(
      /reservation-1: budget overrun did not fail its session/,
    );
  });

  it("detects a canonical paid start whose reservation transaction rolled back", () => {
    const fixture = makeEvidenceReady();
    let phantomResolution:
      | Extract<BudgetReservationResolution, { status: "admitted" }>
      | undefined;
    expect(() =>
      fixture.ledger.runImmediate((transaction) => {
        const resolution = transaction.reserve({
          campaignId: CAMPAIGN_ID,
          reservationId: RESERVATION_ID,
          sessionId: SESSION_ID,
          attemptId: CLOUD_ATTEMPT_ID,
          providerId: CLOUD_PROVIDER,
          pricingSnapshotId: PRICING_ID,
          episodeCapMicrousd: 250,
          projection: projection(),
          createdAt: "2026-08-29T00:00:04.000Z",
        });
        if (resolution.status !== "admitted") {
          throw new Error("expected phantom reservation admission");
        }
        phantomResolution = resolution;
        throw new Error("rollback phantom reservation");
      }),
    ).toThrow("rollback phantom reservation");
    if (phantomResolution === undefined) {
      throw new Error("phantom resolution was not captured");
    }
    const events = cloudStartEvents(phantomResolution);
    fixture.store.appendMany(SESSION_ID, events, {
      expectedSequence: 12,
      createdAt: "2026-08-29T00:00:04.000Z",
      eventIds: budgetedStartEventIds("phantom-start").admitted,
    });

    expect(() => fixture.ledger.assertEventReconciled()).toThrow(
      /reservation-1: attempt .* has no ledger reservation/,
    );
  });

  it("atomically records a cap-plus-one denial and starts retained local synthesis", () => {
    const fixture = makeEvidenceReady({ episodeCapMicrousd: 249 });
    const committed = fixture.attempts.commitBudgetedStart({
      sessionId: SESSION_ID,
      expectedSequence: 12,
      createdAt: "2026-08-29T00:00:04.000Z",
      eventIds: budgetedStartEventIds("denied-start"),
      campaignId: CAMPAIGN_ID,
      reservationId: RESERVATION_ID,
      attemptId: CLOUD_ATTEMPT_ID,
      providerId: CLOUD_PROVIDER,
      pricingSnapshotId: PRICING_ID,
      projection: projection(),
      buildEvents: cloudStartEvents,
    });
    expect(committed).toMatchObject({
      providerId: LOCAL_PROVIDER,
      paidDispatchAuthorized: false,
      budgetResolution: { status: "denied", reason: "episode_cap" },
    });
    expect(fixture.ledger.listOutstandingReservations()).toEqual([]);
    expect(fixture.store.getProjectedState(SESSION_ID).routingDecisions.at(-1)).toMatchObject({
      reasonCode: "budget_denial",
      triggerFacts: [
        { key: "budget_denial_reason", value: "episode_cap" },
        { key: "router_evidence_ready", value: true },
        {
          key: "router_successful_investigation_attempt_count",
          value: 1,
        },
      ],
    });
  });

  it("does not treat a stale preflight balance as dispatch authority", () => {
    const fixture = makeEvidenceReady({ campaignAutomaticStopMicrousd: 250 });
    const preflight = fixture.ledger.getBudgetPosition({
      campaignId: CAMPAIGN_ID,
      sessionId: SESSION_ID,
    });
    expect(preflight.remainingCampaignMicrousd).toBe(250);

    const competingSessionId = "competing-session";
    createV2Session(fixture.store, {
      sessionId: competingSessionId,
      episodeCapMicrousd: 250,
    });
    const competingInitial = initialLocalStartEvents(competingSessionId);
    fixture.attempts.commitLocalStart({
      sessionId: competingSessionId,
      expectedSequence: 3,
      createdAt: "2026-08-29T00:00:02.000Z",
      eventIds: eventIds("competing-initial", competingInitial.length),
      events: competingInitial,
    });
    finishInitialEvidenceRound(fixture.store, competingSessionId);

    const competingReservationId = "competing-reservation";
    const competingAttemptId = `${competingSessionId}:attempt:2`;
    const competing = fixture.attempts.commitBudgetedStart({
      sessionId: competingSessionId,
      expectedSequence: 12,
      createdAt: "2026-08-29T00:00:04.000Z",
      eventIds: budgetedStartEventIds("competing-cloud-start"),
      campaignId: CAMPAIGN_ID,
      reservationId: competingReservationId,
      attemptId: competingAttemptId,
      providerId: CLOUD_PROVIDER,
      pricingSnapshotId: PRICING_ID,
      projection: projection(),
      buildEvents: (resolution) =>
        cloudStartEvents(resolution, {
          sessionId: competingSessionId,
          reservationId: competingReservationId,
          attemptId: competingAttemptId,
        }),
    });
    expect(competing).toMatchObject({
      paidDispatchAuthorized: true,
      budgetResolution: { status: "admitted" },
    });

    const ids = budgetedStartEventIds("locked-denial");
    const committed = fixture.attempts.commitBudgetedStart({
      sessionId: SESSION_ID,
      expectedSequence: 12,
      createdAt: "2026-08-29T00:00:04.000Z",
      eventIds: ids,
      campaignId: CAMPAIGN_ID,
      reservationId: RESERVATION_ID,
      attemptId: CLOUD_ATTEMPT_ID,
      providerId: CLOUD_PROVIDER,
      pricingSnapshotId: PRICING_ID,
      projection: projection(),
      buildEvents: cloudStartEvents,
    });

    expect(committed).toMatchObject({
      paidDispatchAuthorized: false,
      budgetResolution: {
        status: "denied",
        reason: "campaign_automatic_stop",
      },
    });
    expect(committed.events.map((event) => event.id)).toEqual(ids.denied);
    const storedIds = new Set(
      fixture.store.getEvents(SESSION_ID).map((event) => event.id),
    );
    expect(ids.admitted.every((id) => !storedIds.has(id))).toBe(true);
  });

  for (const point of [
    "after_budget_mutation",
    "after_event_append",
  ] as const) {
    it(`rolls back reservation and all events on ${point}`, () => {
      const fixture = makeEvidenceReady({ faultPoint: point });
      expect(() => commitCloudStart(fixture)).toThrow(`fault:${point}`);
      expect(fixture.ledger.listOutstandingReservations()).toEqual([]);
      expect(fixture.store.requireSession(SESSION_ID).lastSequence).toBe(12);
      expect(
        fixture.store
          .getEvents(SESSION_ID)
          .some((event) => event.type === "routing.decision.recorded" && event.sequence > 12),
      ).toBe(false);
    });
  }

  for (const point of [
    "after_event_append:1",
    "after_event_append:2",
    "after_event_append:3",
    "after_event_append:4",
    "after_event_append:5",
  ] as const) {
    it(`rolls back reservation and all admitted-start events at ${point}`, () => {
      const fixture = makeEvidenceReady({ faultPoint: point });
      expect(() => commitCloudStart(fixture)).toThrow(`fault:${point}`);
      expect(fixture.ledger.listOutstandingReservations()).toEqual([]);
      expect(fixture.store.requireSession(SESSION_ID).lastSequence).toBe(12);
    });
  }

  it("atomically settles exact host-priced usage with its attempt finish", () => {
    const fixture = makeEvidenceReady();
    commitCloudStart(fixture);
    const events = successfulCloudFinishEvents();
    const committed = fixture.attempts.commitAttemptFinish({
      sessionId: SESSION_ID,
      expectedSequence: 17,
      createdAt: "2026-08-29T00:00:05.000Z",
      eventIds: eventIds("cloud-finish", events.length),
      events,
      terminalLedgerEntryId: "settlement-1",
    });
    expect(committed.terminalBudgetEntry).toMatchObject({
      id: "settlement-1",
      rowType: "settlement",
      amountMicrousd: 125,
      costProvenance: "host_pricing_snapshot",
    });
    expect(fixture.ledger.listOutstandingReservations()).toEqual([]);
    expect(fixture.store.getProjectedState(SESSION_ID).inferenceAttempts.at(-1)).toMatchObject({
      attemptId: CLOUD_ATTEMPT_ID,
      finished: { outcome: "succeeded", cost: { amountMicrousd: 125 } },
    });
  });

  it("releases a definitely-unsent attempt without charging it", () => {
    const fixture = makeEvidenceReady();
    commitCloudStart(fixture);
    const events: SessionEventData[] = [
      {
        type: "inference.attempt.finished",
        payload: {
          attemptId: CLOUD_ATTEMPT_ID,
          checkpointId: `${SESSION_ID}:context:2`,
          outcome: "provider_error",
          requestDisposition: "not_sent",
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            reported: false,
          },
          cost: {
            amountMicrousd: 0,
            provenance: "host_pricing_snapshot",
            reservationId: RESERVATION_ID,
          },
          latencyMs: 0,
          errorCode: "pre_dispatch_failure",
        },
      },
      {
        type: "session.failed",
        payload: { error: "Cloud request failed before dispatch." },
      },
    ];
    const committed = fixture.attempts.commitAttemptFinish({
      sessionId: SESSION_ID,
      expectedSequence: 17,
      createdAt: "2026-08-29T00:00:05.000Z",
      eventIds: eventIds("released-finish", events.length),
      events,
      terminalLedgerEntryId: "release-1",
    });
    expect(committed.terminalBudgetEntry).toMatchObject({
      rowType: "release",
      amountMicrousd: 0,
      requestDisposition: "not_sent",
    });
    expect(
      fixture.ledger.getBudgetPosition({
        campaignId: CAMPAIGN_ID,
        sessionId: SESSION_ID,
      }),
    ).toMatchObject({ episodeExposureMicrousd: 0 });
  });

  it("atomically charges an unknown recovered request in full exactly once", () => {
    const fixture = makeEvidenceReady();
    commitCloudStart(fixture);
    const events: SessionEventData[] = [
      {
        type: "inference.attempt.finished",
        payload: {
          attemptId: CLOUD_ATTEMPT_ID,
          checkpointId: `${SESSION_ID}:context:2`,
          outcome: "interrupted",
          requestDisposition: "unknown",
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            reported: false,
          },
          cost: {
            amountMicrousd: 250,
            provenance: "reserved_unknown",
            reservationId: RESERVATION_ID,
          },
          latencyMs: 1,
          errorCode: "startup_recovery",
        },
      },
      {
        type: "session.interrupted",
        payload: { reason: "Application restarted during provider dispatch." },
      },
    ];
    const input = {
      sessionId: SESSION_ID,
      expectedSequence: 17,
      createdAt: "2026-08-29T00:00:05.000Z",
      eventIds: eventIds("recovery", events.length),
      events,
      terminalLedgerEntryId: "recovery-settlement-1",
    };
    const committed = fixture.attempts.commitRecoveryFinish(input);
    expect(committed.terminalBudgetEntry).toMatchObject({
      rowType: "settlement",
      amountMicrousd: 250,
      costProvenance: "reserved_unknown",
    });
    expect(fixture.store.requireSession(SESSION_ID).status).toBe("interrupted");
    expect(fixture.ledger.listOutstandingReservations()).toEqual([]);
    expect(() => fixture.attempts.commitRecoveryFinish(input)).toThrow();
    expect(
      fixture.database
        .prepare(
          `SELECT COUNT(*) AS count FROM budget_ledger_entries
           WHERE reservation_id = ? AND row_type = 'settlement'`,
        )
        .get(RESERVATION_ID),
    ).toEqual({ count: 1 });
  });

  it("records the full actual overrun and fails the session atomically", () => {
    const fixture = makeEvidenceReady();
    commitCloudStart(fixture);
    const events = successfulCloudFinishEvents({
      amountMicrousd: 251,
      provenance: "provider_reported",
      includeOverrunFailure: true,
    });
    const committed = fixture.attempts.commitAttemptFinish({
      sessionId: SESSION_ID,
      expectedSequence: 17,
      createdAt: "2026-08-29T00:00:05.000Z",
      eventIds: eventIds("overrun-finish", events.length),
      events,
      terminalLedgerEntryId: "overrun-1",
    });
    expect(committed.terminalBudgetEntry).toMatchObject({
      rowType: "overrun",
      amountMicrousd: 251,
      reasonCode: "budget_overrun",
    });
    expect(fixture.store.requireSession(SESSION_ID).status).toBe("failed");
    expect(
      fixture.ledger.getBudgetPosition({
        campaignId: CAMPAIGN_ID,
        sessionId: SESSION_ID,
      }),
    ).toMatchObject({ campaignDisabled: true, campaignExposureMicrousd: 251 });
  });

  for (const point of [
    "after_budget_mutation",
    "after_event_append",
  ] as const) {
    it(`rolls back terminal settlement and finish events on ${point}`, () => {
      const fixture = makeEvidenceReady();
      commitCloudStart(fixture);
      const faulting = new AttemptUnitOfWork(fixture.ledger, {
        faultInjector: (candidate) => {
          if (candidate === point) throw new Error(`fault:${candidate}`);
        },
      });
      const events = successfulCloudFinishEvents();
      expect(() =>
        faulting.commitAttemptFinish({
          sessionId: SESSION_ID,
          expectedSequence: 17,
          createdAt: "2026-08-29T00:00:05.000Z",
          eventIds: eventIds(`fault-finish-${point}`, events.length),
          events,
          terminalLedgerEntryId: `fault-terminal-${point}`,
        }),
      ).toThrow(`fault:${point}`);
      expect(fixture.store.requireSession(SESSION_ID).lastSequence).toBe(17);
      expect(fixture.ledger.listOutstandingReservations()).toHaveLength(1);
      expect(
        fixture.database
          .prepare(
            `SELECT COUNT(*) AS count FROM budget_ledger_entries
             WHERE reservation_id = ? AND row_type IN ('settlement', 'release', 'overrun')`,
          )
          .get(RESERVATION_ID),
      ).toEqual({ count: 0 });
    });
  }

  for (const point of [
    "after_event_append:1",
    "after_event_append:2",
  ] as const) {
    it(`rolls back terminal settlement and each finish event at ${point}`, () => {
      const fixture = makeEvidenceReady();
      commitCloudStart(fixture);
      const faulting = new AttemptUnitOfWork(fixture.ledger, {
        faultInjector: (candidate) => {
          if (candidate === point) throw new Error(`fault:${candidate}`);
        },
      });
      const events = successfulCloudFinishEvents();
      expect(() =>
        faulting.commitAttemptFinish({
          sessionId: SESSION_ID,
          expectedSequence: 17,
          createdAt: "2026-08-29T00:00:05.000Z",
          eventIds: eventIds(`fault-finish-${point}`, events.length),
          events,
          terminalLedgerEntryId: `fault-terminal-${point}`,
        }),
      ).toThrow(`fault:${point}`);
      expect(fixture.store.requireSession(SESSION_ID).lastSequence).toBe(17);
      expect(fixture.ledger.listOutstandingReservations()).toHaveLength(1);
      expect(
        fixture.database
          .prepare(
            `SELECT COUNT(*) AS count FROM budget_ledger_entries
             WHERE reservation_id = ? AND row_type IN ('settlement', 'release', 'overrun')`,
          )
          .get(RESERVATION_ID),
      ).toEqual({ count: 0 });
    });
  }

  it("rejects an understated or forged host-priced finish without mutating either store", () => {
    const fixture = makeEvidenceReady();
    commitCloudStart(fixture);
    const events = successfulCloudFinishEvents({ amountMicrousd: 124 });
    expect(() =>
      fixture.attempts.commitAttemptFinish({
        sessionId: SESSION_ID,
        expectedSequence: 17,
        createdAt: "2026-08-29T00:00:05.000Z",
        eventIds: eventIds("forged-finish", events.length),
        events,
        terminalLedgerEntryId: "forged-settlement",
      }),
    ).toThrow(/does not match 125/);
    expect(fixture.store.requireSession(SESSION_ID).lastSequence).toBe(17);
    expect(fixture.ledger.listOutstandingReservations()).toHaveLength(1);
  });
});
