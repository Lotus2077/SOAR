import { afterEach, describe, expect, it, vi } from "vitest";

const checkpointImportTest = vi.hoisted(() => ({
  assertImported: vi.fn(),
}));
const loopbackTransportTest = vi.hoisted(() => ({
  consumeResult: vi.fn(),
}));

vi.mock(
  "../../src/main/pr6r-development/checkpoint-import",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/main/pr6r-development/checkpoint-import")
      >();
    return {
      ...actual,
      assertPr6rImportedCheckpoint: checkpointImportTest.assertImported,
    };
  },
);

vi.mock(
  "../../src/main/pr6r-development/loopback-transport",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/main/pr6r-development/loopback-transport")
      >();
    return {
      ...actual,
      consumePr6rLoopbackTransportResult: loopbackTransportTest.consumeResult,
    };
  },
);

import { AttemptUnitOfWork } from "../../src/main/attempt-unit-of-work";
import {
  BudgetLedger,
  projectWorstCaseCostMicrousd,
} from "../../src/main/budget-ledger";
import {
  createSoarDatabase,
  type SoarDatabase,
} from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";
import type {
  Pr6rImportedCheckpointAuthority,
  Pr6rImportedCheckpointBinding,
} from "../../src/main/pr6r-development/checkpoint-import";
import {
  assertPr6rPreparedLoopbackAttempt,
  consumePr6rPreparedLoopbackAttemptAuthority,
  consumePr6rPreparedLoopbackFinishAuthority,
  preparePr6rLoopbackAttempt,
  preparePr6rLoopbackAttemptFinish,
} from "../../src/main/pr6r-development/loopback-attempt-adapter";
import { PR6R_LOOPBACK_RESPONSE_SCHEMA_VERSION } from "../../src/main/pr6r-development/loopback-response";
import type { Pr6rLoopbackTransportResult } from "../../src/main/pr6r-development/loopback-transport";
import {
  HYBRID_SIMULATION_CAMPAIGN_CREATED_AT,
  HYBRID_SIMULATION_CONSENT_ID,
  HYBRID_SIMULATION_DISCLOSURE_TEXT_SHA256,
  HYBRID_SIMULATION_DISCLOSURE_VERSION,
  HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
  HYBRID_SIMULATION_RESULT_MARKER,
  HYBRID_SIMULATION_ROUTE,
  HybridSimulationSessionAuthorityV1Schema,
} from "../../src/shared/hybrid-simulation-contracts";
import {
  PR6R_CAMPAIGN_ID,
  PR6R_COST_SCOPE,
  PR6R_DEVELOPMENT_AUTHORITY_ID,
  PR6R_FIXTURE_SNAPSHOT_ID,
  PR6R_MODEL_SLUG,
  PR6R_REQUESTED_OUTPUT_TOKENS,
  PR6R_SIMULATION_INPUT_RATE_MICROUSD_PER_MILLION,
  PR6R_SIMULATION_OUTPUT_RATE_MICROUSD_PER_MILLION,
  PR6R_SIMULATION_PRICING_SNAPSHOT_ID,
  PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID,
  PR6R_SYNTHETIC_PROVIDER_ID,
  PR6R_SYNTHETIC_UPSTREAM_SLUG,
  buildPr6rCommonCheckpointV1,
  buildPr6rLoopbackProviderValidationV1,
  buildPr6rSimulationPricingSnapshotV1,
  canonicalPr6rJsonV1,
  canonicalPr6rReviewResultSha256,
  sealCloudApplicationRequestV1,
} from "../../src/shared/pr6r-development-contracts";
import type { ReviewResultV1 } from "../../src/shared/review-result-contract";
import { reviewResultV1ResponseFormat } from "../../src/shared/review-result-contract";

const IMPLEMENTATION_REVISION = "a".repeat(40);
const PARENT_SESSION_ID = "pr6r-parent-session";
const CHILD_SESSION_ID = "pr6r-loopback-child";
const IMPORT_ID = "pr6r-loopback-import";
const LOCAL_PROVIDER_ID = "local-vllm";
const LOCAL_MODEL = "local-review-model";
const RETAINED_LOCAL_LEASE_ID = "pr6r-retained-local-lease";
const IMPORTED_AT = "2026-09-02T00:00:00.000Z";
const AS_OF = "2026-09-02T00:00:01.000Z";
const CLOUD_EGRESS_ADMISSION_ID = "pr6r-loopback-egress-1";
const DECISION_ID = "pr6r-loopback-decision-1";
const CLOUD_LEASE_ID = "pr6r-loopback-cloud-lease-1";
const RESERVATION_ID = "pr6r-loopback-reservation-1";
const MESSAGE_ID = "pr6r-loopback-message-1";
const ATTEMPT_ID = "pr6r-loopback-attempt-1";
const CLOUD_HEALTH_SNAPSHOT_ID = "pr6r-loopback-health-1";
const PACKET_UTF8 = canonicalPr6rJsonV1({
  fixture: "cal-007",
  scope: "adapter-unit",
});
const SEMANTIC_MESSAGES = [
  { role: "system" as const, content: "Review the admitted public fixture." },
  { role: "user" as const, content: `Packet:\n${PACKET_UTF8}` },
];

const databases: SoarDatabase[] = [];

afterEach(() => {
  checkpointImportTest.assertImported.mockReset();
  loopbackTransportTest.consumeResult.mockReset();
  for (const database of databases.splice(0)) database.close();
});

function hybridAuthority() {
  return HybridSimulationSessionAuthorityV1Schema.parse({
    schemaVersion: "hybrid-simulation-session-authority-v1",
    simulationAuthorityId: PR6R_DEVELOPMENT_AUTHORITY_ID,
    disclosureVersion: HYBRID_SIMULATION_DISCLOSURE_VERSION,
    disclosureTextSha256: HYBRID_SIMULATION_DISCLOSURE_TEXT_SHA256,
    route: HYBRID_SIMULATION_ROUTE,
    resultMarker: HYBRID_SIMULATION_RESULT_MARKER,
    costScope: PR6R_COST_SCOPE,
    simulationConsent: HYBRID_SIMULATION_CONSENT_ID,
    egressConsent: "none",
    maxSimulatedSpendMicrousd: HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
    fakeLocalProvider: {
      providerId: LOCAL_PROVIDER_ID,
      model: LOCAL_MODEL,
    },
    fakeCloudProvider: {
      providerId: PR6R_SYNTHETIC_PROVIDER_ID,
      model: PR6R_MODEL_SLUG,
    },
    riskPolicyId: "review-risk-v1",
    routerPolicyVersion: "hybrid-lease-router-v0",
    healthSnapshotId: CLOUD_HEALTH_SNAPSHOT_ID,
    pricingSnapshotId: PR6R_SIMULATION_PRICING_SNAPSHOT_ID,
    credentialMetadataId: PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID,
    campaignId: PR6R_CAMPAIGN_ID,
    campaignCreatedAt: HYBRID_SIMULATION_CAMPAIGN_CREATED_AT,
  });
}

function childExecutionPolicy() {
  return {
    schemaVersion: "agentic-execution-v2" as const,
    inferenceRounds: 2,
    toolCalls: 1,
    routingPolicy: "hybrid_simulation_v1" as const,
    maxProviderChanges: 2 as const,
    maxPaidAttempts: 1 as const,
    maxPaidEpisodeMicrousd: HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
    maxEpisodeDurationMs: 120_000,
    attemptTimeoutMs: 30_000,
    egressConsent: "none" as const,
    simulationConsent: HYBRID_SIMULATION_CONSENT_ID,
  };
}

function localProvider() {
  return {
    providerId: LOCAL_PROVIDER_ID,
    model: LOCAL_MODEL,
    locality: "local" as const,
    enabled: true,
    capabilities: [
      "chat_completions" as const,
      "streaming" as const,
      "structured_json_schema" as const,
      "tool_calling" as const,
    ],
    accountingKind: "local_zero_cost" as const,
    contextWindowTokens: 100_000,
    maxOutputTokens: 4_096,
    requestReserveTokens: 256,
  };
}

function localHealth() {
  return {
    snapshotId: "pr6r-local-health-1",
    providerId: LOCAL_PROVIDER_ID,
    model: LOCAL_MODEL,
    checkedAt: IMPORTED_AT,
    expiresAt: "2026-09-02T00:01:00.000Z",
    status: "healthy" as const,
    resultCode: "configured_model_available",
  };
}

function exactImportedBinding(
  store: EventStore,
): Pr6rImportedCheckpointBinding {
  const state = store.replay(CHILD_SESSION_ID);
  const imported = state.synthesisCheckpointImport;
  const localRoute = state.routes.at(-1);
  if (
    imported === undefined ||
    localRoute === undefined ||
    state.executionPolicy?.schemaVersion !== "agentic-execution-v2" ||
    state.hybridSimulation === undefined
  ) {
    throw new Error("adapter fixture did not create an imported child");
  }
  return Object.freeze({
    childSessionId: CHILD_SESSION_ID,
    childLastSequence: state.lastSequence,
    imported: Object.freeze(structuredClone(imported)),
    localRoute: Object.freeze({
      providerId: localRoute.providerId,
      model: localRoute.model,
      leaseId: localRoute.leaseId!,
    }),
    executionPolicy: Object.freeze(structuredClone(state.executionPolicy)),
    hybridSimulation: Object.freeze(structuredClone(state.hybridSimulation)),
  });
}

function setup() {
  const database = createSoarDatabase();
  databases.push(database);
  const store = new EventStore(database);
  const checkpoint = buildPr6rCommonCheckpointV1({
    parentSessionId: PARENT_SESSION_ID,
    packetUtf8: PACKET_UTF8,
    semanticMessages: SEMANTIC_MESSAGES,
  });
  const authority = hybridAuthority();
  const executionPolicy = childExecutionPolicy();
  store.createSession({
    id: CHILD_SESSION_ID,
    title: "PR6R adapter synthesis child",
    objective: "Review the exact public fixture.",
    workspaceRoot: "/tmp/pr6r-adapter-unit",
    profile: "quality",
    taskTrack: "change-review-v1",
    completionObligations: {
      requiredSuccessfulTools: ["inspect_git_changes"],
      minimumVerifiedPathLineCitations: 0,
    },
    executionPolicy,
    hybridSimulation: authority,
    createdAt: IMPORTED_AT,
  });
  store.appendMany(
    CHILD_SESSION_ID,
    [
      {
        type: "session.started",
        payload: {
          startedAt: IMPORTED_AT,
          deadlineAt: "2026-09-02T00:02:00.000Z",
        },
      },
      {
        type: "synthesis.checkpoint.imported",
        payload: {
          schemaVersion: "synthesis-checkpoint-import-v1",
          importId: IMPORT_ID,
          parentSessionId: PARENT_SESSION_ID,
          parentLastSequence: 26,
          commonInvestigationSha256: "a".repeat(64),
          commonCheckpointSha256: checkpoint.checkpointSha256,
          checkpointId: `${CHILD_SESSION_ID}:context:1`,
          packetSha256: checkpoint.packetSha256,
          semanticMessagesSha256: checkpoint.semanticMessagesSha256,
          responseSchemaSha256: checkpoint.responseSchemaSha256,
          provenanceSemanticSha256: "b".repeat(64),
          reviewSnapshotId: PR6R_FIXTURE_SNAPSHOT_ID,
          reviewEvidenceSetId: "c".repeat(64),
          reviewProvenanceSha256: "b".repeat(64),
          completedRequiredToolNames: ["inspect_git_changes"],
          retainedLocalLeaseId: RETAINED_LOCAL_LEASE_ID,
          importedAt: IMPORTED_AT,
        },
      },
    ],
    {
      expectedSequence: 2,
      createdAt: IMPORTED_AT,
      eventIds: ["pr6r-loopback-child-start", "pr6r-loopback-child-import"],
    },
  );

  const nominalImportAuthority = Object.freeze({
    kind: "pr6r_imported_checkpoint" as const,
    childSessionId: CHILD_SESSION_ID,
    importId: IMPORT_ID,
  }) satisfies Pr6rImportedCheckpointAuthority;
  checkpointImportTest.assertImported.mockImplementation(
    (
      candidate: Pr6rImportedCheckpointAuthority,
      input: { store: EventStore; childSessionId: string },
    ) => {
      if (
        candidate !== nominalImportAuthority ||
        input.store !== store ||
        input.childSessionId !== CHILD_SESSION_ID
      ) {
        throw new Error("Imported checkpoint authority is forged or transplanted.");
      }
      const binding = exactImportedBinding(store);
      if (
        binding.childLastSequence !== 4 ||
        binding.imported.importId !== IMPORT_ID
      ) {
        throw new Error("Imported child is no longer at its checkpoint boundary.");
      }
      return binding;
    },
  );

  const body = {
    model: PR6R_MODEL_SLUG,
    messages: SEMANTIC_MESSAGES,
    max_completion_tokens: PR6R_REQUESTED_OUTPUT_TOKENS,
    temperature: 0 as const,
    stream: false as const,
    response_format: reviewResultV1ResponseFormat(),
    provider: {
      only: [PR6R_SYNTHETIC_UPSTREAM_SLUG],
      order: [PR6R_SYNTHETIC_UPSTREAM_SLUG],
      allow_fallbacks: false,
      require_parameters: true,
    },
  };
  const applicationRequest = sealCloudApplicationRequestV1({
    requestId: "pr6r-loopback-request-1",
    parentSessionId: PARENT_SESSION_ID,
    synthesisSessionId: CHILD_SESSION_ID,
    attemptId: ATTEMPT_ID,
    slotId: "cloud_synthesis",
    commonCheckpoint: checkpoint,
    packetUtf8: PACKET_UTF8,
    origin: "http://127.0.0.1:43123",
    body,
  });
  const providerValidation = buildPr6rLoopbackProviderValidationV1({
    implementationRevision: IMPLEMENTATION_REVISION,
    validatedAt: IMPORTED_AT,
  });
  const pricingSnapshot = buildPr6rSimulationPricingSnapshotV1({
    implementationRevision: IMPLEMENTATION_REVISION,
    providerValidationSha256: providerValidation.validationSha256,
    validatedAt: IMPORTED_AT,
  });
  loopbackTransportTest.consumeResult.mockImplementation(
    (
      result: Pr6rLoopbackTransportResult,
      input: { applicationRequest: unknown; reservationId: string },
    ) => {
      if (
        input.reservationId !== RESERVATION_ID ||
        canonicalPr6rJsonV1(input.applicationRequest) !==
          canonicalPr6rJsonV1(applicationRequest)
      ) {
        throw new Error("loopback transport binding mismatch");
      }
      return Object.freeze({
        applicationRequest,
        reservationId: RESERVATION_ID,
        result,
      });
    },
  );
  const prepareInput = {
    store,
    importedCheckpointAuthority: nominalImportAuthority,
    applicationRequest,
    providerValidation,
    pricingSnapshot,
    retainedLocalProvider: localProvider(),
    retainedLocalHealthSnapshot: localHealth(),
    asOf: AS_OF,
    cloudEgressAdmissionId: CLOUD_EGRESS_ADMISSION_ID,
    decisionId: DECISION_ID,
    selectedCloudLeaseId: CLOUD_LEASE_ID,
    reservationId: RESERVATION_ID,
    messageId: MESSAGE_ID,
  };
  return {
    store,
    checkpoint,
    body,
    applicationRequest,
    providerValidation,
    pricingSnapshot,
    nominalImportAuthority,
    prepareInput,
  };
}

function commitPrepared(
  fixture: ReturnType<typeof setup>,
  automaticStopMicrousd: number,
) {
  const ledger = new BudgetLedger(fixture.store);
  ledger.createCampaign({
    id: PR6R_CAMPAIGN_ID,
    providerId: PR6R_SYNTHETIC_PROVIDER_ID,
    credentialMetadataId: PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID,
    openingExposureMicrousd: 0,
    automaticStopMicrousd,
    hardCeilingMicrousd: HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
    costScope: PR6R_COST_SCOPE,
    createdAt: IMPORTED_AT,
  });
  const prepared = preparePr6rLoopbackAttempt(fixture.prepareInput);
  const attempts = new AttemptUnitOfWork(ledger);
  const committed = attempts.commitBudgetedStart({
    sessionId: prepared.childSessionId,
    expectedSequence: prepared.expectedSequence,
    createdAt: prepared.createdAt,
    eventIds: {
      admitted: Array.from(
        { length: 6 },
        (_, index) => `pr6r-admitted-event-${index + 1}`,
      ),
      denied: Array.from(
        { length: 5 },
        (_, index) => `pr6r-denied-event-${index + 1}`,
      ),
    },
    campaignId: prepared.campaignId,
    reservationId: prepared.reservationId,
    attemptId: prepared.attemptId,
    providerId: prepared.providerId,
    pricingSnapshotId: prepared.pricingSnapshotId,
    costScope: prepared.costScope,
    cloudEgressAdmissionId: prepared.cloudEgressAdmissionId,
    projection: prepared.projection,
    buildEvents: prepared.buildEvents,
  });
  return { prepared, committed, attempts, ledger };
}

function reviewResult(): ReviewResultV1 {
  return {
    schemaVersion: "change-review-result-v1",
    snapshotId: PR6R_FIXTURE_SNAPSHOT_ID,
    summary: "No blocking findings in the bounded fixture response.",
    conclusion: "no_blocking_findings",
    evidenceSetId: "c".repeat(64),
    omissions: [],
    findings: [],
  };
}

function normalizedUsage(fixture: ReturnType<typeof setup>) {
  return {
    inputTokens: fixture.applicationRequest.estimatedInputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0 as const,
    reasoningTokens: 2,
    outputTokens: 3,
    totalTokens: fixture.applicationRequest.estimatedInputTokens + 5,
  };
}

function successfulTransport(
  fixture: ReturnType<typeof setup>,
): Pr6rLoopbackTransportResult {
  const result = reviewResult();
  return {
    outcome: "succeeded",
    requestDisposition: "sent",
    stableCode: "completed",
    durationMs: 23,
    response: {
      schemaVersion: PR6R_LOOPBACK_RESPONSE_SCHEMA_VERSION,
      requestId: fixture.applicationRequest.requestId,
      reviewResult: result,
      usage: normalizedUsage(fixture),
      responseBodySha256: "d".repeat(64),
      reviewResultSha256: canonicalPr6rReviewResultSha256(result),
    },
  };
}

function admittedFinishInput(
  fixture: ReturnType<typeof setup>,
  start: ReturnType<typeof commitPrepared>,
  transportResult: Pr6rLoopbackTransportResult,
) {
  const resolution = start.committed.budgetResolution;
  if (resolution?.status !== "admitted") {
    throw new Error("finish fixture requires an admitted reservation");
  }
  return {
    applicationRequest: fixture.applicationRequest,
    checkpointId: `${CHILD_SESSION_ID}:context:1`,
    messageId: MESSAGE_ID,
    reservation: resolution.reservation,
    transportResult,
    cancelledAfterTransport: false,
  };
}

describe("PR6R loopback attempt preparation", () => {
  it("asserts the exact prepared wrapper before side effects without consuming its commit authority", () => {
    const fixture = setup();
    const prepared = preparePr6rLoopbackAttempt(fixture.prepareInput);

    expect(() =>
      assertPr6rPreparedLoopbackAttempt(prepared, {
        store: fixture.store,
        applicationRequest: fixture.applicationRequest,
        asOf: prepared.createdAt,
      }),
    ).not.toThrow();
    expect(() =>
      assertPr6rPreparedLoopbackAttempt(prepared, {
        store: fixture.store,
        applicationRequest: fixture.applicationRequest,
        asOf: prepared.createdAt,
      }),
    ).not.toThrow();

    expect(() =>
      assertPr6rPreparedLoopbackAttempt({ ...prepared }, {
        store: fixture.store,
        applicationRequest: fixture.applicationRequest,
        asOf: prepared.createdAt,
      }),
    ).toThrow("forged, stale, or transplanted");

    const copiedFixture = setup();
    expect(() =>
      assertPr6rPreparedLoopbackAttempt(prepared, {
        store: copiedFixture.store,
        applicationRequest: copiedFixture.applicationRequest,
        asOf: prepared.createdAt,
      }),
    ).toThrow("forged, stale, or transplanted");

    const ledger = new BudgetLedger(fixture.store);
    ledger.createCampaign({
      id: PR6R_CAMPAIGN_ID,
      providerId: PR6R_SYNTHETIC_PROVIDER_ID,
      credentialMetadataId: PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID,
      openingExposureMicrousd: 0,
      automaticStopMicrousd: HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
      hardCeilingMicrousd: HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
      costScope: PR6R_COST_SCOPE,
      createdAt: IMPORTED_AT,
    });
    const committed = new AttemptUnitOfWork(ledger).commitBudgetedStart({
      sessionId: prepared.childSessionId,
      expectedSequence: prepared.expectedSequence,
      createdAt: prepared.createdAt,
      eventIds: {
        admitted: Array.from(
          { length: 6 },
          (_, index) => `pr6r-assert-admitted-event-${index + 1}`,
        ),
        denied: Array.from(
          { length: 5 },
          (_, index) => `pr6r-assert-denied-event-${index + 1}`,
        ),
      },
      campaignId: prepared.campaignId,
      reservationId: prepared.reservationId,
      attemptId: prepared.attemptId,
      providerId: prepared.providerId,
      pricingSnapshotId: prepared.pricingSnapshotId,
      costScope: prepared.costScope,
      cloudEgressAdmissionId: prepared.cloudEgressAdmissionId,
      projection: prepared.projection,
      buildEvents: prepared.buildEvents,
    });
    expect(committed.budgetResolution?.status).toBe("admitted");
    expect(() =>
      assertPr6rPreparedLoopbackAttempt(prepared, {
        store: fixture.store,
        applicationRequest: fixture.applicationRequest,
        asOf: prepared.createdAt,
      }),
    ).toThrow("forged, stale, or transplanted");
    expect(
      consumePr6rPreparedLoopbackAttemptAuthority(prepared.commitAuthority, {
        store: fixture.store,
        applicationRequest: fixture.applicationRequest,
        reservationId: RESERVATION_ID,
      }),
    ).toMatchObject({
      childSessionId: CHILD_SESSION_ID,
      attemptId: ATTEMPT_ID,
      reservationId: RESERVATION_ID,
      selectedStart: {
        resolution: { status: "admitted" },
      },
    });
  });

  it("rejects a child-session mutation that lands after preparation", () => {
    const fixture = setup();
    const prepared = preparePr6rLoopbackAttempt(fixture.prepareInput);

    fixture.store.append(
      CHILD_SESSION_ID,
      {
        type: "session.cancelled",
        payload: { reason: "cancelled after PR6R preparation" },
      },
      {
        expectedSequence: prepared.expectedSequence,
        eventId: "pr6r-post-prepare-cancellation",
        createdAt: AS_OF,
      },
    );

    expect(() =>
      assertPr6rPreparedLoopbackAttempt(prepared, {
        store: fixture.store,
        applicationRequest: fixture.applicationRequest,
        asOf: prepared.createdAt,
      }),
    ).toThrow("forged, stale, or transplanted");
  });

  it("builds the exact immutable six-event admitted batch accepted by the real UoW", () => {
    const fixture = setup();
    const { prepared, committed } = commitPrepared(
      fixture,
      HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
    );

    expect(prepared.projection).toEqual({
      billableInputTokens: fixture.applicationRequest.estimatedInputTokens,
      billableCacheReadTokens: 0,
      requestedMaxOutputTokens: PR6R_REQUESTED_OUTPUT_TOKENS,
      inputMicrousdPerMillionTokens:
        PR6R_SIMULATION_INPUT_RATE_MICROUSD_PER_MILLION,
      outputMicrousdPerMillionTokens:
        PR6R_SIMULATION_OUTPUT_RATE_MICROUSD_PER_MILLION,
      cacheReadMicrousdPerMillionTokens: 0,
      providerFeeCeilingMicrousd: 0,
      cacheAssumption: "no_cache_credit",
    });
    expect(projectWorstCaseCostMicrousd(prepared.projection)).toBe(
      fixture.applicationRequest.estimatedInputTokens + 32_768,
    );
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.routerInputSnapshot.providers)).toBe(true);
    expect(committed.paidDispatchAuthorized).toBe(true);
    expect(committed.budgetResolution?.status).toBe("admitted");
    expect(committed.events.map((event) => event.type)).toEqual([
      "cloud.egress.admission.recorded",
      "routing.decision.recorded",
      "route.assigned",
      "assistant.message.started",
      "context.compiled",
      "inference.attempt.started",
    ]);

    const state = fixture.store.replay(CHILD_SESSION_ID);
    expect(state.inferenceAttempts).toHaveLength(1);
    expect(state.inferenceAttempts[0]).toMatchObject({
      attemptId: ATTEMPT_ID,
      phase: "synthesis",
      providerId: PR6R_SYNTHETIC_PROVIDER_ID,
      requestedMaxOutputTokens: PR6R_REQUESTED_OUTPUT_TOKENS,
      budgetReservationId: RESERVATION_ID,
    });
    expect(state.inferenceAttempts[0]).not.toHaveProperty(
      "structuredOutputContract",
    );
    expect(state.contextCompilations[0]).not.toHaveProperty(
      "structuredOutputContract",
    );
    expect(state.routingDecisions[0]?.triggerFacts).toEqual([
      { key: "router_evidence_import_id", value: IMPORT_ID },
      { key: "router_evidence_ready", value: true },
      {
        key: "router_evidence_source",
        value: "pr6r_imported_checkpoint_v1",
      },
      {
        key: "router_successful_investigation_attempt_count",
        value: 0,
      },
    ]);
    expect(state.routingDecisions[0]?.routerInputSnapshot?.schemaVersion).toBe(
      "checkpoint-router-input-v0",
    );
    const copiedFixture = setup();
    expect(() =>
      consumePr6rPreparedLoopbackAttemptAuthority(prepared.commitAuthority, {
        store: copiedFixture.store,
        applicationRequest: copiedFixture.applicationRequest,
        reservationId: RESERVATION_ID,
      }),
    ).toThrow("binding mismatch");
    expect(
      consumePr6rPreparedLoopbackAttemptAuthority(prepared.commitAuthority, {
        store: fixture.store,
        applicationRequest: fixture.applicationRequest,
        reservationId: RESERVATION_ID,
      }),
    ).toMatchObject({
      childSessionId: CHILD_SESSION_ID,
      attemptId: ATTEMPT_ID,
      reservationId: RESERVATION_ID,
    });
    expect(() =>
      consumePr6rPreparedLoopbackAttemptAuthority(prepared.commitAuthority, {
        store: fixture.store,
        applicationRequest: fixture.applicationRequest,
        reservationId: RESERVATION_ID,
      }),
    ).toThrow("already consumed");
  });

  it("builds the exact five-event denial branch and opens only the retained Local attempt", () => {
    const fixture = setup();
    const { committed, prepared } = commitPrepared(fixture, 1);

    expect(committed.paidDispatchAuthorized).toBe(false);
    expect(committed.budgetResolution).toMatchObject({
      status: "denied",
      reason: "campaign_automatic_stop",
    });
    expect(committed.events.map((event) => event.type)).toEqual([
      "cloud.egress.admission.recorded",
      "routing.decision.recorded",
      "assistant.message.started",
      "context.compiled",
      "inference.attempt.started",
    ]);

    const state = fixture.store.replay(CHILD_SESSION_ID);
    expect(state.routes).toHaveLength(1);
    expect(state.routes[0]).toMatchObject({
      providerId: LOCAL_PROVIDER_ID,
      model: LOCAL_MODEL,
      leaseId: RETAINED_LOCAL_LEASE_ID,
    });
    expect(state.inferenceAttempts).toHaveLength(1);
    expect(state.inferenceAttempts[0]).toMatchObject({
      attemptId: ATTEMPT_ID,
      phase: "synthesis",
      providerId: LOCAL_PROVIDER_ID,
      requestedMaxOutputTokens: 4_096,
    });
    expect(state.inferenceAttempts[0]?.budgetReservationId).toBeUndefined();
    expect(state.routingDecisions[0]).toMatchObject({
      reasonCode: "budget_denial",
      action: "retain_lease",
      selectedLeaseId: RETAINED_LOCAL_LEASE_ID,
      proposedProviderId: PR6R_SYNTHETIC_PROVIDER_ID,
    });
    expect(state.routingDecisions[0]?.triggerFacts[0]).toEqual({
      key: "budget_denial_reason",
      value: "campaign_automatic_stop",
    });
    const selected = consumePr6rPreparedLoopbackAttemptAuthority(
      prepared.commitAuthority,
      {
        store: fixture.store,
        applicationRequest: fixture.applicationRequest,
        reservationId: RESERVATION_ID,
      },
    ).selectedStart;
    expect(selected?.resolution).toMatchObject({
      status: "denied",
      reason: "campaign_automatic_stop",
    });
    expect(selected?.events.map((event) => event.type)).toEqual(
      committed.events.map((event) => event.type),
    );
  });

  it("delegates import authority validation and rejects request, provider, lease, or freshness mismatches", () => {
    const fixture = setup();

    expect(() =>
      preparePr6rLoopbackAttempt({
        ...fixture.prepareInput,
        importedCheckpointAuthority: {
          ...fixture.nominalImportAuthority,
        },
      }),
    ).toThrow("forged or transplanted");

    const changedMessages = SEMANTIC_MESSAGES.map((message, index) =>
      index === 0
        ? { ...message, content: `${message.content} changed` }
        : message,
    );
    const changedCheckpoint = buildPr6rCommonCheckpointV1({
      parentSessionId: PARENT_SESSION_ID,
      packetUtf8: PACKET_UTF8,
      semanticMessages: changedMessages,
    });
    const changedRequest = sealCloudApplicationRequestV1({
      requestId: "pr6r-loopback-request-mismatch",
      parentSessionId: PARENT_SESSION_ID,
      synthesisSessionId: CHILD_SESSION_ID,
      attemptId: ATTEMPT_ID,
      slotId: "cloud_synthesis",
      commonCheckpoint: changedCheckpoint,
      packetUtf8: PACKET_UTF8,
      origin: "http://127.0.0.1:43123",
      body: { ...fixture.body, messages: changedMessages },
    });
    expect(() =>
      preparePr6rLoopbackAttempt({
        ...fixture.prepareInput,
        applicationRequest: changedRequest,
      }),
    ).toThrow("does not match the imported checkpoint");

    expect(() =>
      preparePr6rLoopbackAttempt({
        ...fixture.prepareInput,
        retainedLocalProvider: {
          ...localProvider(),
          model: "different-local-model",
        },
      }),
    ).toThrow("does not match its fixed providers");

    expect(() =>
      preparePr6rLoopbackAttempt({
        ...fixture.prepareInput,
        selectedCloudLeaseId: RETAINED_LOCAL_LEASE_ID,
      }),
    ).toThrow("must assign a new lease");

    expect(() =>
      preparePr6rLoopbackAttempt({
        ...fixture.prepareInput,
        asOf: "2026-09-02T00:01:01.000Z",
      }),
    ).toThrow("not currently usable");
  });

  it("builds an immutable hash-only success batch and settles exact host-priced usage", () => {
    const fixture = setup();
    const start = commitPrepared(
      fixture,
      HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
    );
    const prepared = preparePr6rLoopbackAttemptFinish(
      admittedFinishInput(fixture, start, successfulTransport(fixture)),
    );

    expect(prepared.events.map((event) => event.type)).toEqual([
      "assistant.message.completed",
      "inference.attempt.finished",
    ]);
    expect(prepared.terminal).toEqual({
      terminalOutcome: "completed",
      requestDisposition: "sent",
      stableCode: "completed",
    });
    expect(prepared.reviewResult).toEqual(reviewResult());
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.events)).toBe(true);
    expect(Object.isFrozen(prepared.reviewResult)).toBe(true);
    expect(JSON.stringify(prepared.events)).not.toContain(
      "No blocking findings",
    );
    expect(prepared.events[0]).toEqual({
      type: "assistant.message.completed",
      payload: {
        messageId: MESSAGE_ID,
        stopReason: "stop",
        completionState: "complete",
        attemptId: ATTEMPT_ID,
      },
    });
    expect(prepared.events[1]).toMatchObject({
      type: "inference.attempt.finished",
      payload: {
        attemptId: ATTEMPT_ID,
        outcome: "succeeded",
        requestDisposition: "sent",
        servedModel: PR6R_MODEL_SLUG,
        usage: {
          inputTokens: fixture.applicationRequest.estimatedInputTokens,
          outputTokens: 3,
          reasoningTokens: 2,
          cacheReadTokens: 0,
          reported: true,
        },
        cost: {
          amountMicrousd:
            fixture.applicationRequest.estimatedInputTokens + 20,
          provenance: "host_pricing_snapshot",
          reservationId: RESERVATION_ID,
          costScope: PR6R_COST_SCOPE,
        },
        responseBodySha256: "d".repeat(64),
        reviewResultSha256: canonicalPr6rReviewResultSha256(reviewResult()),
      },
    });

    const committed = start.attempts.commitAttemptFinish({
      sessionId: CHILD_SESSION_ID,
      expectedSequence: fixture.store.requireSession(CHILD_SESSION_ID)
        .lastSequence,
      createdAt: "2026-09-02T00:00:02.000Z",
      eventIds: ["pr6r-success-completion", "pr6r-success-finish"],
      events: prepared.events,
      terminalLedgerEntryId: "pr6r-success-settlement",
    });
    expect(committed.terminalBudgetEntry).toMatchObject({
      rowType: "settlement",
      amountMicrousd: fixture.applicationRequest.estimatedInputTokens + 20,
      costProvenance: "host_pricing_snapshot",
      requestDisposition: "sent",
    });
    const state = fixture.store.replay(CHILD_SESSION_ID);
    expect(state.messages.at(-1)).toMatchObject({
      id: MESSAGE_ID,
      content: "",
      completionState: "complete",
    });
    expect(state.messages.at(-1)).not.toHaveProperty("reviewResult");
    expect(state.inferenceAttempts.at(-1)?.finished).toMatchObject({
      responseBodySha256: "d".repeat(64),
      reviewResultSha256: canonicalPr6rReviewResultSha256(reviewResult()),
    });
    expect(start.ledger.listOutstandingReservations()).toEqual([]);
    expect(
      consumePr6rPreparedLoopbackFinishAuthority(prepared.commitAuthority, {
        applicationRequest: fixture.applicationRequest,
        reservationId: RESERVATION_ID,
      }),
    ).toMatchObject({
      childSessionId: CHILD_SESSION_ID,
      attemptId: ATTEMPT_ID,
      terminal: { terminalOutcome: "completed", stableCode: "completed" },
    });
    expect(() =>
      consumePr6rPreparedLoopbackFinishAuthority(prepared.commitAuthority, {
        applicationRequest: fixture.applicationRequest,
        reservationId: RESERVATION_ID,
      }),
    ).toThrow("already consumed");
  });

  it("maps parser, HTTP, dispatch, timeout, and cancellation outcomes without raw output", () => {
    const fixture = setup();
    const start = commitPrepared(
      fixture,
      HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
    );
    const responseHash = "e".repeat(64);
    const cases: Array<{
      transport: Pr6rLoopbackTransportResult;
      expectedOutcome:
        | "protocol_error"
        | "provider_error"
        | "timeout"
        | "cancelled";
      expectedCost: "host_pricing_snapshot" | "reserved_unknown";
      expectedEventCount: 2 | 3;
    }> = [
      {
        transport: {
          outcome: "failed",
          requestDisposition: "sent",
          stableCode: "loopback.review_result_invalid",
          durationMs: 11,
          responseBodySha256: responseHash,
          usage: normalizedUsage(fixture),
        },
        expectedOutcome: "protocol_error",
        expectedCost: "host_pricing_snapshot",
        expectedEventCount: 2,
      },
      {
        transport: {
          outcome: "failed",
          requestDisposition: "sent",
          stableCode: "loopback.http_error",
          durationMs: 12,
          responseBodySha256: responseHash,
        },
        expectedOutcome: "provider_error",
        expectedCost: "reserved_unknown",
        expectedEventCount: 2,
      },
      {
        transport: {
          outcome: "failed",
          requestDisposition: "unknown",
          stableCode: "loopback.dispatch_unknown",
          durationMs: 13,
        },
        expectedOutcome: "provider_error",
        expectedCost: "reserved_unknown",
        expectedEventCount: 2,
      },
      {
        transport: {
          outcome: "failed",
          requestDisposition: "unknown",
          stableCode: "loopback.timeout",
          durationMs: 30_000,
        },
        expectedOutcome: "timeout",
        expectedCost: "reserved_unknown",
        expectedEventCount: 2,
      },
      {
        transport: {
          outcome: "cancelled",
          requestDisposition: "unknown",
          stableCode: "loopback.cancelled_after_dispatch",
          durationMs: 14,
        },
        expectedOutcome: "cancelled",
        expectedCost: "reserved_unknown",
        expectedEventCount: 3,
      },
    ];

    for (const testCase of cases) {
      const prepared = preparePr6rLoopbackAttemptFinish(
        admittedFinishInput(fixture, start, testCase.transport),
      );
      const finish = prepared.events[1];
      if (finish?.type !== "inference.attempt.finished") {
        throw new Error("fixture expected an attempt finish");
      }
      expect(finish.payload).toMatchObject({
        outcome: testCase.expectedOutcome,
        requestDisposition: testCase.transport.requestDisposition,
        errorCode: testCase.transport.stableCode,
        cost: {
          provenance: testCase.expectedCost,
          amountMicrousd:
            testCase.expectedCost === "reserved_unknown"
              ? start.committed.budgetResolution?.status === "admitted"
                ? start.committed.budgetResolution.reservation.amountMicrousd
                : -1
              : fixture.applicationRequest.estimatedInputTokens + 20,
        },
      });
      expect(prepared.events).toHaveLength(testCase.expectedEventCount);
      expect(prepared.reviewResult).toBeUndefined();
      expect(JSON.stringify(prepared.events)).not.toContain("choices");
      if (testCase.expectedOutcome === "cancelled") {
        expect(prepared.events[2]?.type).toBe("session.cancelled");
      }
    }

    const cancelledAfterResponse = preparePr6rLoopbackAttemptFinish({
      ...admittedFinishInput(fixture, start, successfulTransport(fixture)),
      cancelledAfterTransport: true,
    });
    const cancelledFinish = cancelledAfterResponse.events[1];
    if (cancelledFinish?.type !== "inference.attempt.finished") {
      throw new Error("fixture expected a cancelled attempt finish");
    }
    expect(cancelledFinish.payload).toMatchObject({
      outcome: "cancelled",
      requestDisposition: "unknown",
      errorCode: "loopback.cancelled_after_dispatch",
      usage: { reported: false },
      cost: { provenance: "reserved_unknown" },
    });
    expect(cancelledFinish.payload).not.toHaveProperty("responseBodySha256");
    expect(cancelledFinish.payload).not.toHaveProperty("reviewResultSha256");
    expect(cancelledAfterResponse.reviewResult).toBeUndefined();
    expect(cancelledAfterResponse.events[2]?.type).toBe("session.cancelled");
  });

  it("rejects result-hash, usage, reservation, and terminal-tuple mismatches", () => {
    const fixture = setup();
    const start = commitPrepared(
      fixture,
      HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
    );
    const success = successfulTransport(fixture);
    if (success.outcome !== "succeeded") {
      throw new Error("fixture expected successful transport");
    }
    expect(() =>
      preparePr6rLoopbackAttemptFinish(
        admittedFinishInput(fixture, start, {
          ...success,
          response: {
            ...success.response,
            reviewResultSha256: "0".repeat(64),
          },
        }),
      ),
    ).toThrow("result hash does not match");
    expect(() =>
      preparePr6rLoopbackAttemptFinish(
        admittedFinishInput(fixture, start, {
          ...success,
          response: {
            ...success.response,
            usage: {
              ...success.response.usage,
              inputTokens: success.response.usage.inputTokens + 1,
            },
          },
        }),
      ),
    ).toThrow("reported usage does not match");

    const admitted = start.committed.budgetResolution;
    if (admitted?.status !== "admitted") {
      throw new Error("fixture expected admitted start");
    }
    expect(() =>
      preparePr6rLoopbackAttemptFinish({
        ...admittedFinishInput(fixture, start, success),
        reservation: {
          ...admitted.reservation,
          outputRateMicrousdPerMillion:
            admitted.reservation.outputRateMicrousdPerMillion + 1,
        },
      }),
    ).toThrow("reservation does not match");
    expect(() =>
      preparePr6rLoopbackAttemptFinish(
        admittedFinishInput(fixture, start, {
          outcome: "failed",
          requestDisposition: "unknown",
          stableCode: "loopback.timeout",
          durationMs: 30_000,
          responseBodySha256: "f".repeat(64),
        }),
      ),
    ).toThrow("invalid terminal tuple");
  });

  it("loads the accepted A2 nominal-authority ESM cycle in either public import order", async () => {
    vi.doUnmock("../../src/main/pr6r-development/checkpoint-import");
    vi.doUnmock("../../src/main/pr6r-development/loopback-transport");
    vi.resetModules();
    const adapterFirst = await import(
      "../../src/main/pr6r-development/loopback-attempt-adapter"
    );
    const sqliteSecond = await import(
      "../../src/main/pr6r-development/sqlite-attempt-authority"
    );
    expect(adapterFirst.preparePr6rLoopbackAttempt).toBeTypeOf("function");
    expect(sqliteSecond.bindPr6rCommittedBudgetedStart).toBeTypeOf("function");

    vi.resetModules();
    const sqliteFirst = await import(
      "../../src/main/pr6r-development/sqlite-attempt-authority"
    );
    const adapterSecond = await import(
      "../../src/main/pr6r-development/loopback-attempt-adapter"
    );
    expect(sqliteFirst.bindPr6rCommittedAttemptFinish).toBeTypeOf("function");
    expect(adapterSecond.preparePr6rLoopbackAttemptFinish).toBeTypeOf(
      "function",
    );
  });
});
