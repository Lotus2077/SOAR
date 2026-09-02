import { AttemptUnitOfWork } from "../../src/main/attempt-unit-of-work";
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
  Pr6rPreparedLoopbackAttemptAuthority,
  Pr6rPreparedLoopbackFinishAuthority,
} from "../../src/main/pr6r-development/loopback-attempt-adapter";
import {
  bindPr6rCommittedAttemptFinish,
  bindPr6rCommittedBudgetedStart,
  type Pr6rSqliteDispatchChain,
  type Pr6rSqliteDispatchAuthority,
  type Pr6rSqliteTerminalReceipt,
} from "../../src/main/pr6r-development/sqlite-attempt-authority";
import {
  CHANGE_REVIEW_SYNTHESIS_CAPABILITIES,
} from "../../src/shared/checkpoint-router";
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
  PR6R_MAX_ADMITTED_INPUT_TOKENS,
  PR6R_MODEL_SLUG,
  PR6R_REQUESTED_OUTPUT_TOKENS,
  PR6R_SIMULATION_INPUT_RATE_MICROUSD_PER_MILLION,
  PR6R_SIMULATION_OUTPUT_RATE_MICROUSD_PER_MILLION,
  PR6R_SIMULATION_PRICING_SNAPSHOT_ID,
  PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID,
  PR6R_SYNTHETIC_PROVIDER_ID,
  PR6R_SYNTHETIC_UPSTREAM_SLUG,
  buildPr6rCommonCheckpointV1,
  canonicalPr6rJsonV1,
  sealCloudApplicationRequestV1,
  type CloudApplicationRequestV1,
} from "../../src/shared/pr6r-development-contracts";
import { reviewResultV1ResponseFormat } from "../../src/shared/review-result-contract";
import {
  RouterInputSnapshotV0Schema,
  RoutingDecisionPayloadSchema,
  type RoutingDecisionPayload,
  type SessionEventData,
} from "../../src/shared/session-events";

const CREATED_AT = "2026-09-02T00:00:00.000Z";
const IMPORTED_AT = "2026-09-02T00:00:01.000Z";
const ATTEMPT_AT = "2026-09-02T00:00:02.000Z";
const PARENT_SESSION_ID = "pr6r-a2-parent";
const CHILD_SESSION_ID = "pr6r-a2-child";
const ATTEMPT_ID = "pr6r-a2-attempt";
const REQUEST_ID = "pr6r-a2-request";
const RESERVATION_ID = "pr6r-a2-reservation";
const IMPORT_ID = "pr6r-a2-import";
const LOCAL_PROVIDER_ID = "local-vllm";
const LOCAL_MODEL = "local-review-model";
const LOCAL_LEASE_ID = "pr6r-a2-local-lease";
const CLOUD_LEASE_ID = "pr6r-a2-cloud-lease";
const EGRESS_ID = "pr6r-a2-egress";
const DECISION_ID = "pr6r-a2-decision";
const MESSAGE_ID = "pr6r-a2-message";
const CLOUD_HEALTH_ID = "pr6r-a2-cloud-health";
const LOCAL_HEALTH_ID = "pr6r-a2-local-health";
const PROVENANCE_SHA256 = "f".repeat(64);
const EVIDENCE_SET_ID = "e".repeat(64);
const INVESTIGATION_SHA256 = "d".repeat(64);
const PACKET_UTF8 = canonicalPr6rJsonV1({
  fixture: "cal-007",
  scope: "public",
});

function ids(prefix: string, length: number): string[] {
  return Array.from({ length }, (_, index) => `${prefix}:${index + 1}`);
}

function testOnlyPreparedAttemptAuthority(selectedStart?: {
  readonly resolution: BudgetReservationResolution;
  readonly events: readonly SessionEventData[];
}): Pr6rPreparedLoopbackAttemptAuthority {
  const authority = Object.freeze({
    kind: "pr6r_prepared_loopback_attempt",
    childSessionId: CHILD_SESSION_ID,
    attemptId: ATTEMPT_ID,
    reservationId: RESERVATION_ID,
    ...(selectedStart === undefined
      ? {}
      : {
          __testOnlySelectedStart: Object.freeze({
            resolution: structuredClone(selectedStart.resolution),
            events: Object.freeze(structuredClone(selectedStart.events)),
          }),
        }),
  });
  return authority;
}

function testOnlyPreparedFinishAuthority(
  events: readonly SessionEventData[],
  terminal: {
    readonly terminalOutcome: "completed" | "failed" | "cancelled";
    readonly requestDisposition: "sent" | "unknown";
    readonly stableCode: string;
  },
  sqliteDispatchChain: Pr6rSqliteDispatchChain,
): Pr6rPreparedLoopbackFinishAuthority {
  return Object.freeze({
    kind: "pr6r_prepared_loopback_finish" as const,
    childSessionId: CHILD_SESSION_ID,
    attemptId: ATTEMPT_ID,
    reservationId: RESERVATION_ID,
    // Only the SQLite authority unit test's explicit module mock reads this.
    // The production WeakMap consumer rejects this structural token.
    __testOnlyBinding: Object.freeze({
      childSessionId: CHILD_SESSION_ID,
      attemptId: ATTEMPT_ID,
      reservationId: RESERVATION_ID,
      terminal: Object.freeze({ ...terminal }),
      events: Object.freeze(structuredClone(events)),
      sqliteDispatchChain,
    }),
  });
}

function childPolicy() {
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
    healthSnapshotId: CLOUD_HEALTH_ID,
    pricingSnapshotId: PR6R_SIMULATION_PRICING_SNAPSHOT_ID,
    credentialMetadataId: PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID,
    campaignId: PR6R_CAMPAIGN_ID,
    campaignCreatedAt: HYBRID_SIMULATION_CAMPAIGN_CREATED_AT,
  });
}

function applicationRequest(
  checkpoint: ReturnType<typeof buildPr6rCommonCheckpointV1>,
  origin: string,
) {
  const messages = [
    { role: "system" as const, content: "Review the frozen public change." },
    { role: "user" as const, content: "Return the strict review result." },
  ];
  return sealCloudApplicationRequestV1({
    requestId: REQUEST_ID,
    parentSessionId: PARENT_SESSION_ID,
    synthesisSessionId: CHILD_SESSION_ID,
    attemptId: ATTEMPT_ID,
    slotId: "cloud_synthesis",
    commonCheckpoint: checkpoint,
    packetUtf8: PACKET_UTF8,
    origin,
    body: {
      model: PR6R_MODEL_SLUG,
      messages,
      max_completion_tokens: PR6R_REQUESTED_OUTPUT_TOKENS,
      temperature: 0,
      stream: false,
      response_format: reviewResultV1ResponseFormat(),
      provider: {
        only: [PR6R_SYNTHETIC_UPSTREAM_SLUG],
        order: [PR6R_SYNTHETIC_UPSTREAM_SLUG],
        allow_fallbacks: false,
        require_parameters: true,
      },
    },
  });
}

function createImportedChild(store: EventStore, request: CloudApplicationRequestV1) {
  const policy = childPolicy();
  store.createSession({
    id: CHILD_SESSION_ID,
    title: "PR6R A2 synthesis child",
    objective: "Review the frozen public change.",
    workspaceRoot: "/tmp/pr6r-a2-public-fixture",
    profile: "quality",
    taskTrack: "change-review-v1",
    completionObligations: {
      requiredSuccessfulTools: ["inspect_git_changes"],
      minimumVerifiedPathLineCitations: 0,
    },
    executionPolicy: policy,
    hybridSimulation: hybridAuthority(),
    createdAt: CREATED_AT,
  });
  store.appendMany(
    CHILD_SESSION_ID,
    [
      {
        type: "session.started",
        payload: {
          startedAt: IMPORTED_AT,
          deadlineAt: new Date(
            Date.parse(IMPORTED_AT) + policy.maxEpisodeDurationMs,
          ).toISOString(),
        },
      },
      {
        type: "synthesis.checkpoint.imported",
        payload: {
          schemaVersion: "synthesis-checkpoint-import-v1",
          importId: IMPORT_ID,
          parentSessionId: PARENT_SESSION_ID,
          parentLastSequence: 10,
          commonInvestigationSha256: INVESTIGATION_SHA256,
          commonCheckpointSha256: request.commonCheckpointSha256,
          checkpointId: `${CHILD_SESSION_ID}:context:1`,
          packetSha256: request.packetSha256,
          semanticMessagesSha256: request.semanticMessagesSha256,
          responseSchemaSha256: request.responseSchemaSha256,
          provenanceSemanticSha256: PROVENANCE_SHA256,
          reviewSnapshotId: PR6R_FIXTURE_SNAPSHOT_ID,
          reviewEvidenceSetId: EVIDENCE_SET_ID,
          reviewProvenanceSha256: PROVENANCE_SHA256,
          completedRequiredToolNames: ["inspect_git_changes"],
          retainedLocalLeaseId: LOCAL_LEASE_ID,
          importedAt: IMPORTED_AT,
        },
      },
    ],
    {
      expectedSequence: 2,
      createdAt: IMPORTED_AT,
      eventIds: ["pr6r-a2-started", "pr6r-a2-imported"],
    },
  );
}

function admission(budget: "passed" | "denied"): RoutingDecisionPayload["admission"] {
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

function routerInput(request: CloudApplicationRequestV1) {
  const cloudContextWindow =
    PR6R_MAX_ADMITTED_INPUT_TOKENS + PR6R_REQUESTED_OUTPUT_TOKENS;
  return RouterInputSnapshotV0Schema.parse({
    schemaVersion: "checkpoint-router-input-v0",
    boundary: "evidence_complete",
    asOf: ATTEMPT_AT,
    providers: [
      {
        providerId: LOCAL_PROVIDER_ID,
        model: LOCAL_MODEL,
        locality: "local",
        enabled: true,
        capabilities: [...CHANGE_REVIEW_SYNTHESIS_CAPABILITIES],
        accountingKind: "local_zero_cost",
        contextWindowTokens: cloudContextWindow,
        maxOutputTokens: PR6R_REQUESTED_OUTPUT_TOKENS,
        requestReserveTokens: 0,
      },
      {
        providerId: PR6R_SYNTHETIC_PROVIDER_ID,
        model: PR6R_MODEL_SLUG,
        locality: "cloud",
        enabled: true,
        capabilities: [...CHANGE_REVIEW_SYNTHESIS_CAPABILITIES],
        accountingKind: "metered",
        contextWindowTokens: cloudContextWindow,
        maxOutputTokens: PR6R_REQUESTED_OUTPUT_TOKENS,
        requestReserveTokens: 0,
      },
    ],
    targetProviderId: PR6R_SYNTHETIC_PROVIDER_ID,
    targetModel: PR6R_MODEL_SLUG,
    requiredCapabilities: [...CHANGE_REVIEW_SYNTHESIS_CAPABILITIES],
    deadline: {
      deadlineAt: "2026-09-02T00:02:01.000Z",
      remainingMs: 119_000,
      attemptTimeoutMs: 30_000,
      requiredRemainingMs: 30_000,
      sufficient: true,
    },
    healthSnapshots: [
      {
        snapshotId: LOCAL_HEALTH_ID,
        providerId: LOCAL_PROVIDER_ID,
        model: LOCAL_MODEL,
        checkedAt: ATTEMPT_AT,
        expiresAt: "2026-09-02T00:01:02.000Z",
        status: "healthy",
        resultCode: "configured_model_available",
      },
      {
        snapshotId: CLOUD_HEALTH_ID,
        providerId: PR6R_SYNTHETIC_PROVIDER_ID,
        model: PR6R_MODEL_SLUG,
        checkedAt: ATTEMPT_AT,
        expiresAt: "2026-09-02T00:01:02.000Z",
        status: "healthy",
        resultCode: "configured_model_available",
      },
    ],
    pricingSnapshot: {
      snapshotId: PR6R_SIMULATION_PRICING_SNAPSHOT_ID,
      providerId: PR6R_SYNTHETIC_PROVIDER_ID,
      model: PR6R_MODEL_SLUG,
      verifiedAt: ATTEMPT_AT,
      expiresAt: "2026-09-03T00:00:02.000Z",
      status: "available",
      inputMicrousdPerMillionTokens:
        PR6R_SIMULATION_INPUT_RATE_MICROUSD_PER_MILLION,
      outputMicrousdPerMillionTokens:
        PR6R_SIMULATION_OUTPUT_RATE_MICROUSD_PER_MILLION,
      cacheReadMicrousdPerMillionTokens: 0,
      pricingSourceSha256: "9".repeat(64),
    },
  });
}

function startEvents(
  request: CloudApplicationRequestV1,
  resolution: BudgetReservationResolution,
): SessionEventData[] {
  const admitted = resolution.status === "admitted";
  const selectedProviderId = admitted
    ? PR6R_SYNTHETIC_PROVIDER_ID
    : LOCAL_PROVIDER_ID;
  const selectedModel = admitted ? PR6R_MODEL_SLUG : LOCAL_MODEL;
  const selectedLeaseId = admitted ? CLOUD_LEASE_ID : LOCAL_LEASE_ID;
  const decision = RoutingDecisionPayloadSchema.parse({
    decisionId: DECISION_ID,
    policyVersion: "hybrid-lease-router-v0",
    costScope: PR6R_COST_SCOPE,
    cloudEgressAdmissionId: EGRESS_ID,
    boundary: "evidence_complete",
    phase: "synthesis",
    action: admitted ? "assign_new_lease" : "retain_lease",
    reasonCode: admitted ? "cloud_admitted" : "budget_denial",
    candidateProviderIds: [LOCAL_PROVIDER_ID, PR6R_SYNTHETIC_PROVIDER_ID],
    selectedProviderId,
    selectedModel,
    ...(admitted
      ? {}
      : {
          proposedProviderId: PR6R_SYNTHETIC_PROVIDER_ID,
          proposedModel: PR6R_MODEL_SLUG,
        }),
    priorLeaseId: LOCAL_LEASE_ID,
    selectedLeaseId,
    riskSignals: [],
    triggerFacts: [
      ...(admitted
        ? []
        : [{ key: "budget_denial_reason", value: resolution.reason }]),
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
    ],
    admission: admission(admitted ? "passed" : "denied"),
    routerInputSnapshot: routerInput(request),
    healthSnapshotId: CLOUD_HEALTH_ID,
    pricingSnapshotId: PR6R_SIMULATION_PRICING_SNAPSHOT_ID,
    campaignId: PR6R_CAMPAIGN_ID,
    ...(admitted ? { budgetReservationId: RESERVATION_ID } : {}),
    credentialMetadataId: PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID,
    billing: resolution.billing,
    provenanceSemanticSha256: PROVENANCE_SHA256,
    ...(admitted
      ? {
          checkpointId: `${CHILD_SESSION_ID}:context:1`,
          packetSha256: request.packetSha256,
          messagesSha256: request.semanticMessagesSha256,
        }
      : {
          proposalCheckpointId: `${CHILD_SESSION_ID}:context:1`,
          proposalPacketSha256: request.packetSha256,
          proposalMessagesSha256: request.semanticMessagesSha256,
        }),
  });
  return [
    {
      type: "cloud.egress.admission.recorded",
      payload: {
        schemaVersion: "cloud-egress-admission-record-v1",
        admissionId: EGRESS_ID,
        policyVersion: "cloud-egress-policy-v1",
        decision: "pass",
        reasonCodes: [],
        messagesSemanticSha256: request.semanticMessagesSha256,
        provenanceSemanticSha256: PROVENANCE_SHA256,
        checkpointId: `${CHILD_SESSION_ID}:context:1`,
        simulationAuthorityId: PR6R_DEVELOPMENT_AUTHORITY_ID,
        evaluatedAt: ATTEMPT_AT,
      },
    },
    { type: "routing.decision.recorded", payload: decision },
    ...(admitted
      ? [
          {
            type: "route.assigned" as const,
            payload: {
              providerId: selectedProviderId,
              model: selectedModel,
              reason: "cloud_admitted",
              decisionId: DECISION_ID,
              leaseId: selectedLeaseId,
              phase: "synthesis" as const,
            },
          },
        ]
      : []),
    {
      type: "assistant.message.started",
      payload: {
        messageId: MESSAGE_ID,
        providerId: selectedProviderId,
        model: selectedModel,
        decisionId: DECISION_ID,
        leaseId: selectedLeaseId,
        checkpointId: `${CHILD_SESSION_ID}:context:1`,
        attemptId: ATTEMPT_ID,
      },
    },
    {
      type: "context.compiled",
      payload: {
        checkpointId: `${CHILD_SESSION_ID}:context:1`,
        compilerVersion: "context-compiler-v1",
        reason: "session_start",
        mode: "finalization",
        providerId: selectedProviderId,
        model: selectedModel,
        maxTokens: PR6R_MAX_ADMITTED_INPUT_TOKENS,
        estimatedTokens: request.estimatedInputTokens,
        estimator: "utf8-bytes-v1",
        reservedInputTokens: 0,
        effectiveInputTokenBudget: PR6R_MAX_ADMITTED_INPUT_TOKENS,
        sourceMessageCount: 2,
        messageCount: 2,
        evidenceCount: 0,
        deduplicatedEvidenceCount: 0,
        omittedEvidenceCount: 0,
        packetSha256: request.packetSha256,
        messagesSha256: request.semanticMessagesSha256,
        safetyMargin: 0,
        decisionId: DECISION_ID,
        leaseId: selectedLeaseId,
        messageId: MESSAGE_ID,
        attemptId: ATTEMPT_ID,
      },
    },
    {
      type: "inference.attempt.started",
      payload: {
        attemptId: ATTEMPT_ID,
        round: 1,
        checkpointId: `${CHILD_SESSION_ID}:context:1`,
        messageId: MESSAGE_ID,
        decisionId: DECISION_ID,
        leaseId: selectedLeaseId,
        providerId: selectedProviderId,
        requestedModel: selectedModel,
        phase: "synthesis",
        requestedMaxOutputTokens: PR6R_REQUESTED_OUTPUT_TOKENS,
        allowTools: false,
        requireToolCall: false,
        ...(admitted ? { budgetReservationId: RESERVATION_ID } : {}),
        costScope: PR6R_COST_SCOPE,
        cloudEgressAdmissionId: EGRESS_ID,
      },
    },
  ];
}

export interface Pr6rA2SqliteFixture {
  readonly database: SoarDatabase;
  readonly store: EventStore;
  readonly ledger: BudgetLedger;
  readonly attempts: AttemptUnitOfWork;
  readonly applicationRequest: CloudApplicationRequestV1;
  readonly reservationId: string;
  readonly dispatchAuthority?: Pr6rSqliteDispatchAuthority;
  readonly terminalReceipt?: Pr6rSqliteTerminalReceipt;
}

export interface Pr6rA2SqliteFixtureOptions {
  budget?: "admitted" | "denied" | "unstarted";
  origin?: string;
  databasePath?: string;
  automaticStopMicrousd?: number;
  /** Explicit adversarial seam; production modules never import this helper. */
  testOnlyMutateCommittedStartEvents?: (
    events: readonly SessionEventData[],
  ) => readonly SessionEventData[];
}

export function createPr6rA2SqliteFixture(
  options: Pr6rA2SqliteFixtureOptions = {},
): Pr6rA2SqliteFixture {
  const budget = options.budget ?? "admitted";
  const database = createSoarDatabase(options.databasePath);
  const store = new EventStore(database);
  const messages = [
    { role: "system" as const, content: "Review the frozen public change." },
    { role: "user" as const, content: "Return the strict review result." },
  ];
  const checkpoint = buildPr6rCommonCheckpointV1({
    parentSessionId: PARENT_SESSION_ID,
    packetUtf8: PACKET_UTF8,
    semanticMessages: messages,
  });
  const request = applicationRequest(
    checkpoint,
    options.origin ?? "http://127.0.0.1:43123",
  );
  createImportedChild(store, request);
  const ledger = new BudgetLedger(store);
  const automaticStopMicrousd =
    options.automaticStopMicrousd ?? (budget === "denied" ? 0 : 250_000);
  ledger.createCampaign({
    id: PR6R_CAMPAIGN_ID,
    providerId: PR6R_SYNTHETIC_PROVIDER_ID,
    credentialMetadataId: PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID,
    openingExposureMicrousd: 0,
    automaticStopMicrousd,
    hardCeilingMicrousd: 250_000,
    costScope: PR6R_COST_SCOPE,
    createdAt: CREATED_AT,
  });
  const attempts = new AttemptUnitOfWork(ledger);
  if (budget === "unstarted") {
    return {
      database,
      store,
      ledger,
      attempts,
      applicationRequest: request,
      reservationId: RESERVATION_ID,
    };
  }
  const committed = attempts.commitBudgetedStart({
    sessionId: CHILD_SESSION_ID,
    expectedSequence: 4,
    createdAt: ATTEMPT_AT,
    eventIds: {
      admitted: ids("pr6r-a2-admitted", 6),
      denied: ids("pr6r-a2-denied", 5),
    },
    campaignId: PR6R_CAMPAIGN_ID,
    reservationId: RESERVATION_ID,
    attemptId: ATTEMPT_ID,
    providerId: PR6R_SYNTHETIC_PROVIDER_ID,
    pricingSnapshotId: PR6R_SIMULATION_PRICING_SNAPSHOT_ID,
    costScope: PR6R_COST_SCOPE,
    cloudEgressAdmissionId: EGRESS_ID,
    projection: {
      billableInputTokens: request.estimatedInputTokens,
      billableCacheReadTokens: 0,
      requestedMaxOutputTokens: PR6R_REQUESTED_OUTPUT_TOKENS,
      inputMicrousdPerMillionTokens:
        PR6R_SIMULATION_INPUT_RATE_MICROUSD_PER_MILLION,
      outputMicrousdPerMillionTokens:
        PR6R_SIMULATION_OUTPUT_RATE_MICROUSD_PER_MILLION,
      cacheReadMicrousdPerMillionTokens: 0,
      providerFeeCeilingMicrousd: 0,
      cacheAssumption: BUDGET_CACHE_ASSUMPTION,
    },
    buildEvents: (resolution) => {
      const exactEvents = startEvents(request, resolution);
      return options.testOnlyMutateCommittedStartEvents?.(exactEvents) ?? exactEvents;
    },
  });
  if (committed.budgetResolution === undefined) {
    throw new Error("Expected a PR6R A2 budget resolution.");
  }
  const selectedStart = {
    resolution: committed.budgetResolution,
    events: startEvents(request, committed.budgetResolution),
  };
  let bound: ReturnType<typeof bindPr6rCommittedBudgetedStart>;
  try {
    bound = bindPr6rCommittedBudgetedStart({
      committed,
      // This token is accepted only when a test explicitly mocks the adapter's
      // nominal import assertion/consumer. Production code rejects it.
      preparedAttemptAuthority: testOnlyPreparedAttemptAuthority(selectedStart),
      applicationRequest: request,
      reservationId: RESERVATION_ID,
    });
  } catch (error) {
    database.close();
    throw error;
  }
  if (budget === "admitted" && bound.status !== "admitted") {
    throw new Error("Expected admitted PR6R A2 test fixture.");
  }
  if (budget === "denied" && bound.status !== "budget_denied") {
    throw new Error("Expected denied PR6R A2 test fixture.");
  }
  return {
    database,
    store,
    ledger,
    attempts,
    applicationRequest: request,
    reservationId: RESERVATION_ID,
    ...(bound.status === "admitted"
      ? { dispatchAuthority: bound.authority }
      : { terminalReceipt: bound.receipt }),
  };
}

export function createPr6rA2AdmittedSqliteFixture(
  options: Omit<Pr6rA2SqliteFixtureOptions, "budget"> = {},
): Pr6rA2SqliteFixture & {
  readonly dispatchAuthority: Pr6rSqliteDispatchAuthority;
} {
  return createPr6rA2SqliteFixture({
    budget: "admitted",
    ...options,
  }) as Pr6rA2SqliteFixture & {
    readonly dispatchAuthority: Pr6rSqliteDispatchAuthority;
  };
}

export function createPr6rA2DeniedSqliteFixture(
  options: Omit<Pr6rA2SqliteFixtureOptions, "budget"> = {},
): Pr6rA2SqliteFixture & {
  readonly terminalReceipt: Pr6rSqliteTerminalReceipt;
} {
  return createPr6rA2SqliteFixture({
    budget: "denied",
    ...options,
  }) as Pr6rA2SqliteFixture & {
    readonly terminalReceipt: Pr6rSqliteTerminalReceipt;
  };
}

export function createPr6rA2ImportedSqliteFixture(
  options: Omit<Pr6rA2SqliteFixtureOptions, "budget"> = {},
): Pr6rA2SqliteFixture {
  return createPr6rA2SqliteFixture({ budget: "unstarted", ...options });
}

export function finishPr6rA2FixtureSuccessfully(
  fixture: Pr6rA2SqliteFixture,
  options: { sqliteDispatchChain?: Pr6rSqliteDispatchChain } = {},
): Pr6rSqliteTerminalReceipt {
  const amountMicrousd = fixture.applicationRequest.estimatedInputTokens + 4;
  const sqliteDispatchChain =
    options.sqliteDispatchChain ?? fixture.dispatchAuthority?.dispatchChain;
  if (sqliteDispatchChain === undefined) {
    throw new Error("Expected a PR6R A2 dispatch chain.");
  }
  const events: readonly SessionEventData[] = [
    {
      type: "assistant.message.completed",
      payload: {
        messageId: MESSAGE_ID,
        stopReason: "stop",
        completionState: "complete",
        attemptId: ATTEMPT_ID,
      },
    },
    {
      type: "inference.attempt.finished",
      payload: {
        attemptId: ATTEMPT_ID,
        checkpointId: `${CHILD_SESSION_ID}:context:1`,
        outcome: "succeeded",
        requestDisposition: "sent",
        finishReason: "stop",
        servedModel: PR6R_MODEL_SLUG,
        usage: {
          inputTokens: fixture.applicationRequest.estimatedInputTokens,
          outputTokens: 1,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          reported: true,
        },
        cost: {
          amountMicrousd,
          provenance: "host_pricing_snapshot",
          reservationId: fixture.reservationId,
          costScope: PR6R_COST_SCOPE,
        },
        latencyMs: 1,
        responseBodySha256: "a".repeat(64),
        reviewResultSha256: "b".repeat(64),
      },
    },
  ];
  const committed = fixture.attempts.commitAttemptFinish({
    sessionId: fixture.applicationRequest.synthesisSessionId,
    expectedSequence: 10,
    createdAt: "2026-09-02T00:00:03.000Z",
    eventIds: ["pr6r-a2-assistant-completed", "pr6r-a2-attempt-finished"],
    terminalLedgerEntryId: "pr6r-a2-settlement",
    events,
  });
  return bindPr6rCommittedAttemptFinish({
    committed,
    preparedFinishAuthority: testOnlyPreparedFinishAuthority(events, {
      terminalOutcome: "completed",
      requestDisposition: "sent",
      stableCode: "completed",
    }, sqliteDispatchChain),
    applicationRequest: fixture.applicationRequest,
    reservationId: fixture.reservationId,
  });
}

export function finishPr6rA2FixtureWithSchemaRejection(
  fixture: Pr6rA2SqliteFixture,
): Pr6rSqliteTerminalReceipt {
  const sqliteDispatchChain = fixture.dispatchAuthority?.dispatchChain;
  if (sqliteDispatchChain === undefined) {
    throw new Error("Expected a PR6R A2 dispatch chain.");
  }
  const amountMicrousd = fixture.applicationRequest.estimatedInputTokens + 4;
  const events: readonly SessionEventData[] = [
    {
      type: "assistant.message.completed",
      payload: {
        messageId: MESSAGE_ID,
        stopReason: "error",
        completionState: "incomplete",
        attemptId: ATTEMPT_ID,
      },
    },
    {
      type: "inference.attempt.finished",
      payload: {
        attemptId: ATTEMPT_ID,
        checkpointId: `${CHILD_SESSION_ID}:context:1`,
        outcome: "protocol_error",
        requestDisposition: "sent",
        finishReason: "error",
        usage: {
          inputTokens: fixture.applicationRequest.estimatedInputTokens,
          outputTokens: 1,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          reported: true,
        },
        cost: {
          amountMicrousd,
          provenance: "host_pricing_snapshot",
          reservationId: fixture.reservationId,
          costScope: PR6R_COST_SCOPE,
        },
        latencyMs: 11,
        errorCode: "loopback.review_result_invalid",
        responseBodySha256: "e".repeat(64),
      },
    },
  ];
  const committed = fixture.attempts.commitAttemptFinish({
    sessionId: fixture.applicationRequest.synthesisSessionId,
    expectedSequence: 10,
    createdAt: "2026-09-02T00:00:03.000Z",
    eventIds: [
      "pr6r-a2-schema-rejected-assistant",
      "pr6r-a2-schema-rejected-finish",
    ],
    terminalLedgerEntryId: "pr6r-a2-schema-rejected-settlement",
    events,
  });
  return bindPr6rCommittedAttemptFinish({
    committed,
    preparedFinishAuthority: testOnlyPreparedFinishAuthority(
      events,
      {
        terminalOutcome: "failed",
        requestDisposition: "sent",
        stableCode: "loopback.review_result_invalid",
      },
      sqliteDispatchChain,
    ),
    applicationRequest: fixture.applicationRequest,
    reservationId: fixture.reservationId,
  });
}

export function finishPr6rA2FixtureAfterDispatchCancellation(
  fixture: Pr6rA2SqliteFixture,
): Pr6rSqliteTerminalReceipt {
  const reservation = fixture.ledger.listOutstandingReservations({
    sessionId: fixture.applicationRequest.synthesisSessionId,
  })[0];
  if (reservation === undefined || reservation.id !== fixture.reservationId) {
    throw new Error("Expected one outstanding PR6R A2 reservation.");
  }
  const sqliteDispatchChain = fixture.dispatchAuthority?.dispatchChain;
  if (sqliteDispatchChain === undefined) {
    throw new Error("Expected a PR6R A2 dispatch chain.");
  }
  const events: readonly SessionEventData[] = [
    {
      type: "assistant.message.completed",
      payload: {
        messageId: MESSAGE_ID,
        stopReason: "cancelled",
        completionState: "incomplete",
        attemptId: ATTEMPT_ID,
      },
    },
    {
      type: "inference.attempt.finished",
      payload: {
        attemptId: ATTEMPT_ID,
        checkpointId: `${CHILD_SESSION_ID}:context:1`,
        outcome: "cancelled",
        requestDisposition: "unknown",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          reported: false,
        },
        cost: {
          amountMicrousd: reservation.amountMicrousd,
          provenance: "reserved_unknown",
          reservationId: fixture.reservationId,
          costScope: PR6R_COST_SCOPE,
        },
        latencyMs: 1,
        errorCode: "loopback.cancelled_after_dispatch",
      },
    },
    {
      type: "session.cancelled",
      payload: { reason: "Cancelled after PR6R loopback dispatch." },
    },
  ];
  const committed = fixture.attempts.commitAttemptFinish({
    sessionId: fixture.applicationRequest.synthesisSessionId,
    expectedSequence: 10,
    createdAt: "2026-09-02T00:00:03.000Z",
    eventIds: [
      "pr6r-a2-cancelled-assistant",
      "pr6r-a2-cancelled-finish",
      "pr6r-a2-cancelled-session",
    ],
    terminalLedgerEntryId: "pr6r-a2-cancelled-settlement",
    events,
  });
  return bindPr6rCommittedAttemptFinish({
    committed,
    preparedFinishAuthority: testOnlyPreparedFinishAuthority(events, {
      terminalOutcome: "cancelled",
      requestDisposition: "unknown",
      stableCode: "loopback.cancelled_after_dispatch",
    }, sqliteDispatchChain),
    applicationRequest: fixture.applicationRequest,
    reservationId: fixture.reservationId,
  });
}
