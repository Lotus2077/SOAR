import {
  CHANGE_REVIEW_SYNTHESIS_CAPABILITIES,
  AttemptPlanV0Schema,
  CheckpointProviderV0Schema,
  PROVIDER_HEALTH_MAX_AGE_MS,
  PROVIDER_PRICING_MAX_AGE_MS,
  type AttemptPlanV0,
  type CheckpointProviderV0,
} from "../../shared/checkpoint-router";
import {
  HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
  HYBRID_SIMULATION_ROUTING_POLICY_ID,
} from "../../shared/hybrid-simulation-contracts";
import {
  CloudApplicationRequestV1Schema,
  PR6R_CAMPAIGN_ID,
  PR6R_COST_SCOPE,
  PR6R_DEVELOPMENT_AUTHORITY_ID,
  PR6R_MAX_ADMITTED_INPUT_TOKENS,
  PR6R_MAX_RECORDED_DURATION_MS,
  PR6R_MODEL_SLUG,
  PR6R_LOOPBACK_FAILED_SENT_REASONS,
  PR6R_LOOPBACK_FAILED_UNKNOWN_REASONS,
  PR6R_REQUESTED_OUTPUT_TOKENS,
  PR6R_SIMULATION_INPUT_RATE_MICROUSD_PER_MILLION,
  PR6R_SIMULATION_OUTPUT_RATE_MICROUSD_PER_MILLION,
  PR6R_SIMULATION_PRICING_SNAPSHOT_ID,
  PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID,
  PR6R_SYNTHETIC_PROVIDER_ID,
  Pr6rLoopbackProviderValidationV1Schema,
  Pr6rSimulationPricingSnapshotV1Schema,
  calculatePr6rHostPricedSimulationCostMicrousd,
  canonicalPr6rCloudApplicationRequestSha256,
  canonicalPr6rJsonV1,
  canonicalPr6rReviewResult,
  canonicalPr6rReviewResultSha256,
  type CloudApplicationRequestV1,
  type Pr6rLoopbackProviderValidationV1,
  type Pr6rSimulationPricingSnapshotV1,
} from "../../shared/pr6r-development-contracts";
import {
  CloudEgressAdmissionRecordV1Schema,
  ProviderHealthSnapshotV0Schema,
  ProviderPricingSnapshotV0Schema,
  RouterInputSnapshotV0Schema,
  RoutingDecisionPayloadSchema,
  parseSessionEventData,
  type ProviderHealthSnapshotV0,
  type RouterInputSnapshotV0,
  type RoutingDecisionPayload,
  type SessionEventData,
} from "../../shared/session-events";
import type { ReviewResultV1 } from "../../shared/review-result-contract";
import type { EventStore } from "../event-store";
import {
  BUDGET_CACHE_ASSUMPTION,
  BUDGET_ROUNDING_POLICY,
  projectWorstCaseCostMicrousd,
  type BudgetBillingSnapshot,
  type BudgetProjectionInput,
  type BudgetReservation,
  type BudgetReservationResolution,
} from "../budget-ledger";
import {
  assertRequestMatchesImportedCheckpoint,
  assertPr6rImportedCheckpoint,
  pr6rImportedEvidenceTriggerFacts,
  type Pr6rImportedCheckpointAuthority,
  type Pr6rImportedCheckpointBinding,
} from "./checkpoint-import";
import {
  PR6R_LOOPBACK_RESPONSE_SCHEMA_VERSION,
  type Pr6rLoopbackNormalizedUsage,
} from "./loopback-response";
import {
  consumePr6rLoopbackTransportResult,
  type Pr6rConsumedLoopbackTransportResult,
  type Pr6rLoopbackTransportResult,
} from "./loopback-transport";

const CLOUD_CONTEXT_WINDOW_TOKENS =
  PR6R_MAX_ADMITTED_INPUT_TOKENS + PR6R_REQUESTED_OUTPUT_TOKENS;
const ZERO_SAFETY_MARGIN = 0 as const;

const PASSED_ADMISSION = Object.freeze({
  capability: { status: "passed" as const, reasonCode: "capability_ok" as const },
  credential: { status: "passed" as const, reasonCode: "credential_ok" as const },
  health: { status: "passed" as const, reasonCode: "health_ok" as const },
  pricing: { status: "passed" as const, reasonCode: "pricing_ok" as const },
  egress: { status: "passed" as const, reasonCode: "egress_ok" as const },
  deadline: { status: "passed" as const, reasonCode: "deadline_ok" as const },
});

export interface PreparePr6rLoopbackAttemptInput {
  readonly store: EventStore;
  readonly importedCheckpointAuthority: Pr6rImportedCheckpointAuthority;
  readonly applicationRequest: unknown;
  readonly providerValidation: unknown;
  readonly pricingSnapshot: unknown;
  readonly retainedLocalProvider: unknown;
  readonly retainedLocalHealthSnapshot: unknown;
  readonly asOf: string;
  readonly cloudEgressAdmissionId: string;
  readonly decisionId: string;
  readonly selectedCloudLeaseId: string;
  readonly reservationId: string;
  readonly messageId: string;
}

export interface PreparedPr6rLoopbackAttempt {
  readonly applicationRequest: CloudApplicationRequestV1;
  readonly implementationRevision: string;
  readonly childSessionId: string;
  readonly expectedSequence: number;
  readonly createdAt: string;
  readonly campaignId: typeof PR6R_CAMPAIGN_ID;
  readonly reservationId: string;
  readonly attemptId: string;
  readonly providerId: typeof PR6R_SYNTHETIC_PROVIDER_ID;
  readonly pricingSnapshotId: string;
  readonly costScope: typeof PR6R_COST_SCOPE;
  readonly cloudEgressAdmissionId: string;
  readonly projection: BudgetProjectionInput;
  readonly routerInputSnapshot: RouterInputSnapshotV0;
  readonly commitAuthority: Pr6rPreparedLoopbackAttemptAuthority;
  readonly buildEvents: (
    resolution: BudgetReservationResolution,
  ) => readonly SessionEventData[];
}

export interface Pr6rPreparedLoopbackAttemptAuthority {
  readonly kind: "pr6r_prepared_loopback_attempt";
  readonly childSessionId: string;
  readonly attemptId: string;
  readonly reservationId: string;
}

export interface ConsumedPr6rPreparedLoopbackAttemptBinding {
  readonly childSessionId: string;
  readonly implementationRevision: string;
  readonly expectedSequence: number;
  readonly createdAt: string;
  readonly campaignId: typeof PR6R_CAMPAIGN_ID;
  readonly attemptId: string;
  readonly providerId: typeof PR6R_SYNTHETIC_PROVIDER_ID;
  readonly pricingSnapshotId: string;
  readonly costScope: typeof PR6R_COST_SCOPE;
  readonly cloudEgressAdmissionId: string;
  readonly reservationId: string;
  readonly selectedStart?: {
    readonly resolution: BudgetReservationResolution;
    readonly events: readonly SessionEventData[];
  };
}

interface PreparedAttemptAuthorityState {
  consumed: boolean;
  store: EventStore;
  applicationRequestSha256: string;
  binding: Omit<
    ConsumedPr6rPreparedLoopbackAttemptBinding,
    "selectedStart"
  >;
  selectedStart?: NonNullable<
    ConsumedPr6rPreparedLoopbackAttemptBinding["selectedStart"]
  >;
}

const preparedAttemptAuthorityState = new WeakMap<
  Pr6rPreparedLoopbackAttemptAuthority,
  PreparedAttemptAuthorityState
>();
const preparedAttemptWrapperState = new WeakMap<
  PreparedPr6rLoopbackAttempt,
  {
    readonly store: EventStore;
    readonly applicationRequestSha256: string;
    readonly commitAuthority: Pr6rPreparedLoopbackAttemptAuthority;
    readonly importedCheckpointAuthority: Pr6rImportedCheckpointAuthority;
    readonly importedCheckpointBindingCanonical: string;
  }
>();

export interface PreparePr6rLoopbackAttemptFinishInput {
  readonly applicationRequest: unknown;
  readonly checkpointId: string;
  readonly messageId: string;
  readonly reservation: BudgetReservation;
  readonly transportResult: Pr6rLoopbackTransportResult;
  /** Synchronous host cancellation snapshot taken immediately before commit. */
  readonly cancelledAfterTransport: boolean;
}

export interface PreparedPr6rLoopbackAttemptFinish {
  readonly childSessionId: string;
  readonly attemptId: string;
  readonly reservationId: string;
  readonly terminal: {
    readonly terminalOutcome: "completed" | "failed" | "cancelled";
    readonly requestDisposition: "sent" | "unknown";
    readonly stableCode: string;
  };
  readonly events: readonly SessionEventData[];
  readonly commitAuthority: Pr6rPreparedLoopbackFinishAuthority;
  /** Main-process-only parsed output. A2 does not persist this value. */
  readonly reviewResult?: ReviewResultV1;
}

export interface Pr6rPreparedLoopbackFinishAuthority {
  readonly kind: "pr6r_prepared_loopback_finish";
  readonly childSessionId: string;
  readonly attemptId: string;
  readonly reservationId: string;
}

export interface ConsumedPr6rPreparedLoopbackFinishBinding {
  readonly childSessionId: string;
  readonly attemptId: string;
  readonly reservationId: string;
  readonly terminal: {
    readonly terminalOutcome: "completed" | "failed" | "cancelled";
    readonly requestDisposition: "sent" | "unknown";
    readonly stableCode: string;
  };
  readonly events: readonly SessionEventData[];
  readonly sqliteDispatchChain: Pr6rConsumedLoopbackTransportResult["sqliteDispatchChain"];
}

interface PreparedFinishAuthorityState {
  consumed: boolean;
  applicationRequestSha256: string;
  binding: ConsumedPr6rPreparedLoopbackFinishBinding;
}

const preparedFinishAuthorityState = new WeakMap<
  Pr6rPreparedLoopbackFinishAuthority,
  PreparedFinishAuthorityState
>();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (
    value !== null &&
    typeof value === "object" &&
    !Object.isFrozen(value)
  ) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function parsedTimestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is not a timestamp`);
  return parsed;
}

function requireCanonicalTimestamp(value: string, label: string): number {
  const parsed = parsedTimestamp(value, label);
  if (new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} is not a canonical UTC timestamp`);
  }
  return parsed;
}

function requireBoundedId(value: string, label: string): void {
  if (value.trim() !== value || value.length < 1 || value.length > 256) {
    throw new Error(`${label} is not a bounded canonical ID`);
  }
}

function addMilliseconds(value: string, milliseconds: number): string {
  return new Date(parsedTimestamp(value, "timestamp") + milliseconds).toISOString();
}

function requireProviderBindings(options: {
  binding: Pr6rImportedCheckpointBinding;
  localProvider: CheckpointProviderV0;
  localHealth: ProviderHealthSnapshotV0;
  providerValidation: Pr6rLoopbackProviderValidationV1;
  pricing: Pr6rSimulationPricingSnapshotV1;
  asOf: string;
}): void {
  const { binding, localProvider, localHealth, providerValidation, pricing } =
    options;
  const authority = binding.hybridSimulation;
  const policy = binding.executionPolicy;
  const asOfMs = parsedTimestamp(options.asOf, "asOf");
  const localCheckedAt = parsedTimestamp(localHealth.checkedAt, "local checkedAt");
  const localExpiresAt = parsedTimestamp(localHealth.expiresAt, "local expiresAt");
  const validationAt = parsedTimestamp(
    providerValidation.validatedAt,
    "provider validatedAt",
  );
  const pricingAt = parsedTimestamp(pricing.validatedAt, "pricing validatedAt");

  if (
    policy.routingPolicy !== HYBRID_SIMULATION_ROUTING_POLICY_ID ||
    policy.simulationConsent !== "simulation_cloud_synthesis_v1" ||
    policy.egressConsent !== "none" ||
    policy.maxPaidAttempts !== 1 ||
    policy.maxPaidEpisodeMicrousd !== HYBRID_SIMULATION_MAX_SPEND_MICROUSD ||
    authority.simulationAuthorityId !== PR6R_DEVELOPMENT_AUTHORITY_ID ||
    authority.costScope !== PR6R_COST_SCOPE ||
    authority.fakeCloudProvider.providerId !== PR6R_SYNTHETIC_PROVIDER_ID ||
    authority.fakeCloudProvider.model !== PR6R_MODEL_SLUG ||
    authority.fakeLocalProvider.providerId !== localProvider.providerId ||
    authority.fakeLocalProvider.model !== localProvider.model ||
    authority.pricingSnapshotId !== pricing.pricingSnapshotId ||
    authority.credentialMetadataId !==
      PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID ||
    authority.campaignId !== PR6R_CAMPAIGN_ID ||
    authority.riskPolicyId !== "review-risk-v1" ||
    authority.routerPolicyVersion !== "hybrid-lease-router-v0" ||
    binding.localRoute.providerId !== localProvider.providerId ||
    binding.localRoute.model !== localProvider.model ||
    binding.localRoute.leaseId !== binding.imported.retainedLocalLeaseId
  ) {
    throw new Error("PR6R child authority does not match its fixed providers");
  }
  if (
    localProvider.locality !== "local" ||
    localProvider.accountingKind !== "local_zero_cost" ||
    !localProvider.enabled ||
    localHealth.providerId !== localProvider.providerId ||
    localHealth.model !== localProvider.model ||
    localHealth.status !== "healthy" ||
    localExpiresAt - localCheckedAt !== PROVIDER_HEALTH_MAX_AGE_MS ||
    localCheckedAt > asOfMs ||
    asOfMs >= localExpiresAt
  ) {
    throw new Error("PR6R retained Local provider is not currently usable");
  }
  if (
    providerValidation.syntheticProviderId !== PR6R_SYNTHETIC_PROVIDER_ID ||
    providerValidation.model !== PR6R_MODEL_SLUG ||
    providerValidation.credentialMetadataId !==
      PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID ||
    pricing.syntheticProviderId !== providerValidation.syntheticProviderId ||
    pricing.model !== providerValidation.model ||
    pricing.providerValidationId !== providerValidation.validationId ||
    pricing.providerValidationSha256 !== providerValidation.validationSha256 ||
    pricing.implementationRevision !== providerValidation.implementationRevision ||
    pricingAt < validationAt ||
    validationAt > asOfMs ||
    asOfMs >= validationAt + PROVIDER_HEALTH_MAX_AGE_MS ||
    pricingAt > asOfMs ||
    asOfMs >= pricingAt + PROVIDER_PRICING_MAX_AGE_MS
  ) {
    throw new Error("PR6R loopback provider validation or pricing is stale or mismatched");
  }
  const available = new Set(localProvider.capabilities);
  if (
    !CHANGE_REVIEW_SYNTHESIS_CAPABILITIES.every((capability) =>
      available.has(capability),
    )
  ) {
    throw new Error("PR6R retained Local provider lacks synthesis capability");
  }
}

function importedFacts(
  binding: Pr6rImportedCheckpointBinding,
  budgetDenialReason?: string,
) {
  return [
    ...(budgetDenialReason === undefined
      ? []
      : [{ key: "budget_denial_reason", value: budgetDenialReason }]),
    ...pr6rImportedEvidenceTriggerFacts(binding),
  ];
}

function requireBilling(
  billing: BudgetBillingSnapshot,
  projection: BudgetProjectionInput,
): void {
  const projectedCostMicrousd = projectWorstCaseCostMicrousd(projection);
  if (
    billing.billableInputTokens !== projection.billableInputTokens ||
    billing.billableCacheReadTokens !== projection.billableCacheReadTokens ||
    billing.requestedMaxOutputTokens !== projection.requestedMaxOutputTokens ||
    billing.inputMicrousdPerMillionTokens !==
      projection.inputMicrousdPerMillionTokens ||
    billing.outputMicrousdPerMillionTokens !==
      projection.outputMicrousdPerMillionTokens ||
    billing.cacheReadMicrousdPerMillionTokens !==
      projection.cacheReadMicrousdPerMillionTokens ||
    billing.providerFeeCeilingMicrousd !==
      projection.providerFeeCeilingMicrousd ||
    billing.roundingPolicy !== BUDGET_ROUNDING_POLICY ||
    billing.projectedCostMicrousd !== projectedCostMicrousd
  ) {
    throw new Error("PR6R locked billing does not match its fixed projection");
  }
}

function contextEvent(options: {
  binding: Pr6rImportedCheckpointBinding;
  request: CloudApplicationRequestV1;
  decision: RoutingDecisionPayload;
  plan: AttemptPlanV0;
  messageId: string;
}): Extract<SessionEventData, { type: "context.compiled" }> {
  const maxTokens =
    options.plan.providerId === PR6R_SYNTHETIC_PROVIDER_ID
      ? CLOUD_CONTEXT_WINDOW_TOKENS - options.plan.requestedMaxOutputTokens
      : options.decision.routerInputSnapshot!.providers.find(
          (provider) => provider.providerId === options.plan.providerId,
        )!.contextWindowTokens - options.plan.requestedMaxOutputTokens;
  const reserve = options.decision.routerInputSnapshot!.providers.find(
    (provider) => provider.providerId === options.plan.providerId,
  )!.requestReserveTokens;
  if (options.request.estimatedInputTokens > maxTokens - reserve) {
    throw new Error("PR6R semantic messages exceed the selected provider context");
  }
  return {
    type: "context.compiled",
    payload: {
      checkpointId: options.binding.imported.checkpointId,
      compilerVersion: "context-compiler-v1",
      reason: "session_start",
      mode: "finalization",
      providerId: options.plan.providerId,
      model: options.plan.model,
      maxTokens,
      estimatedTokens: options.request.estimatedInputTokens,
      estimator: "utf8-bytes-v1",
      reservedInputTokens: reserve,
      effectiveInputTokenBudget: maxTokens - reserve,
      sourceMessageCount: 2,
      messageCount: 2,
      evidenceCount: 0,
      deduplicatedEvidenceCount: 0,
      omittedEvidenceCount: 0,
      packetSha256: options.binding.imported.packetSha256,
      messagesSha256: options.binding.imported.semanticMessagesSha256,
      safetyMargin: ZERO_SAFETY_MARGIN,
      decisionId: options.decision.decisionId,
      leaseId: options.plan.leaseId,
      messageId: options.messageId,
      attemptId: options.request.attemptId,
    },
  };
}

function startEvents(options: {
  binding: Pr6rImportedCheckpointBinding;
  request: CloudApplicationRequestV1;
  egressEvent: Extract<
    SessionEventData,
    { type: "cloud.egress.admission.recorded" }
  >;
  decision: RoutingDecisionPayload;
  plan: AttemptPlanV0;
  messageId: string;
  includeRoute: boolean;
}): readonly SessionEventData[] {
  return [
    options.egressEvent,
    { type: "routing.decision.recorded", payload: options.decision },
    ...(options.includeRoute
      ? [
          {
            type: "route.assigned" as const,
            payload: {
              providerId: options.plan.providerId,
              model: options.plan.model,
              reason: options.decision.reasonCode,
              leaseId: options.plan.leaseId,
              decisionId: options.decision.decisionId,
              phase: options.plan.phase,
            },
          },
        ]
      : []),
    {
      type: "assistant.message.started",
      payload: {
        messageId: options.messageId,
        providerId: options.plan.providerId,
        model: options.plan.model,
        decisionId: options.decision.decisionId,
        leaseId: options.plan.leaseId,
        checkpointId: options.binding.imported.checkpointId,
        attemptId: options.request.attemptId,
      },
    },
    contextEvent(options),
    {
      type: "inference.attempt.started",
      payload: {
        attemptId: options.request.attemptId,
        round: 1,
        checkpointId: options.binding.imported.checkpointId,
        messageId: options.messageId,
        decisionId: options.decision.decisionId,
        leaseId: options.plan.leaseId,
        providerId: options.plan.providerId,
        requestedModel: options.plan.model,
        phase: "synthesis",
        requestedMaxOutputTokens: options.plan.requestedMaxOutputTokens,
        allowTools: false,
        requireToolCall: false,
        ...(options.plan.budgetReservationId === undefined
          ? {}
          : { budgetReservationId: options.plan.budgetReservationId }),
        costScope: PR6R_COST_SCOPE,
        cloudEgressAdmissionId: options.egressEvent.payload.admissionId,
      },
    },
  ];
}

/**
 * Prepare the exact two event alternatives consumed by commitBudgetedStart.
 * This function performs only validation and immutable object construction; it
 * does not reserve budget, mutate either store, claim a slot, or dispatch HTTP.
 */
export function preparePr6rLoopbackAttempt(
  input: PreparePr6rLoopbackAttemptInput,
): PreparedPr6rLoopbackAttempt {
  const request = deepFreeze(
    CloudApplicationRequestV1Schema.parse(input.applicationRequest),
  );
  const providerValidation = Pr6rLoopbackProviderValidationV1Schema.parse(
    input.providerValidation,
  );
  const pricing = Pr6rSimulationPricingSnapshotV1Schema.parse(
    input.pricingSnapshot,
  );
  const binding = assertPr6rImportedCheckpoint(
    input.importedCheckpointAuthority,
    { store: input.store, childSessionId: request.synthesisSessionId },
  );
  const localProvider = deepFreeze(
    CheckpointProviderV0Schema.parse(input.retainedLocalProvider),
  );
  const localHealth = deepFreeze(
    ProviderHealthSnapshotV0Schema.parse(input.retainedLocalHealthSnapshot),
  );
  for (const [value, label] of [
    [input.cloudEgressAdmissionId, "cloudEgressAdmissionId"],
    [input.decisionId, "decisionId"],
    [input.selectedCloudLeaseId, "selectedCloudLeaseId"],
    [input.reservationId, "reservationId"],
    [input.messageId, "messageId"],
  ] as const) {
    requireBoundedId(value, label);
  }
  assertRequestMatchesImportedCheckpoint(request, binding);
  requireProviderBindings({
    binding,
    localProvider,
    localHealth,
    providerValidation,
    pricing,
    asOf: input.asOf,
  });

  const state = input.store.replay(binding.childSessionId);
  const asOfMs = requireCanonicalTimestamp(input.asOf, "asOf");
  const deadlineAt = state.deadlineAt;
  if (
    state.lastSequence !== binding.childLastSequence ||
    deadlineAt === undefined ||
    asOfMs < parsedTimestamp(state.updatedAt, "child updatedAt")
  ) {
    throw new Error("PR6R imported child changed before attempt preparation");
  }
  if (input.selectedCloudLeaseId === binding.imported.retainedLocalLeaseId) {
    throw new Error("PR6R cloud attempt must assign a new lease");
  }
  const remainingMs = Math.max(
    0,
    parsedTimestamp(deadlineAt, "child deadlineAt") - asOfMs,
  );
  if (
    !Number.isSafeInteger(remainingMs) ||
    remainingMs < binding.executionPolicy.attemptTimeoutMs
  ) {
    throw new Error("PR6R imported child lacks one complete attempt window");
  }

  const cloudProvider = CheckpointProviderV0Schema.parse({
    providerId: PR6R_SYNTHETIC_PROVIDER_ID,
    model: PR6R_MODEL_SLUG,
    locality: "cloud",
    enabled: true,
    capabilities: [...CHANGE_REVIEW_SYNTHESIS_CAPABILITIES],
    accountingKind: "metered",
    contextWindowTokens: CLOUD_CONTEXT_WINDOW_TOKENS,
    maxOutputTokens: PR6R_REQUESTED_OUTPUT_TOKENS,
    requestReserveTokens: 0,
  });
  const cloudHealth = ProviderHealthSnapshotV0Schema.parse({
    snapshotId: binding.hybridSimulation.healthSnapshotId,
    providerId: PR6R_SYNTHETIC_PROVIDER_ID,
    model: PR6R_MODEL_SLUG,
    checkedAt: providerValidation.validatedAt,
    expiresAt: addMilliseconds(
      providerValidation.validatedAt,
      PROVIDER_HEALTH_MAX_AGE_MS,
    ),
    status: "healthy",
    resultCode: "configured_model_available",
  });
  const routerPricing = ProviderPricingSnapshotV0Schema.parse({
    snapshotId: pricing.pricingSnapshotId,
    providerId: PR6R_SYNTHETIC_PROVIDER_ID,
    model: PR6R_MODEL_SLUG,
    verifiedAt: pricing.validatedAt,
    expiresAt: addMilliseconds(
      pricing.validatedAt,
      PROVIDER_PRICING_MAX_AGE_MS,
    ),
    status: "available",
    inputMicrousdPerMillionTokens: pricing.inputRateMicrousdPerMillion,
    outputMicrousdPerMillionTokens: pricing.outputRateMicrousdPerMillion,
    cacheReadMicrousdPerMillionTokens: pricing.cacheReadRateMicrousdPerMillion,
    pricingSourceSha256: pricing.pricingSnapshotSha256,
  });
  const providers = [localProvider, cloudProvider].sort((left, right) =>
    compareText(left.providerId, right.providerId),
  );
  const healthSnapshots = [localHealth, cloudHealth].sort((left, right) =>
    compareText(left.providerId, right.providerId),
  );
  const routerInputSnapshot = deepFreeze(RouterInputSnapshotV0Schema.parse({
    schemaVersion: "checkpoint-router-input-v0",
    boundary: "evidence_complete",
    asOf: input.asOf,
    providers,
    targetProviderId: PR6R_SYNTHETIC_PROVIDER_ID,
    targetModel: PR6R_MODEL_SLUG,
    requiredCapabilities: [...CHANGE_REVIEW_SYNTHESIS_CAPABILITIES],
    deadline: {
      deadlineAt,
      remainingMs,
      attemptTimeoutMs: binding.executionPolicy.attemptTimeoutMs,
      requiredRemainingMs: binding.executionPolicy.attemptTimeoutMs,
      sufficient: true,
    },
    healthSnapshots,
    pricingSnapshot: routerPricing,
  }));
  const projection: BudgetProjectionInput = deepFreeze({
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
  });
  const egressEvent = {
    type: "cloud.egress.admission.recorded" as const,
    payload: CloudEgressAdmissionRecordV1Schema.parse({
      schemaVersion: "cloud-egress-admission-record-v1",
      admissionId: input.cloudEgressAdmissionId,
      policyVersion: "cloud-egress-policy-v1",
      decision: "pass",
      reasonCodes: [],
      messagesSemanticSha256: binding.imported.semanticMessagesSha256,
      provenanceSemanticSha256: binding.imported.provenanceSemanticSha256,
      checkpointId: binding.imported.checkpointId,
      simulationAuthorityId: binding.hybridSimulation.simulationAuthorityId,
      evaluatedAt: input.asOf,
    }),
  };

  const buildEvents = (
    resolution: BudgetReservationResolution,
  ): readonly SessionEventData[] => {
    requireBilling(resolution.billing, projection);
    if (
      resolution.position.campaignId !== PR6R_CAMPAIGN_ID ||
      resolution.position.sessionId !== binding.childSessionId ||
      resolution.position.episodeCapMicrousd !==
        binding.executionPolicy.maxPaidEpisodeMicrousd ||
      resolution.billing.remainingEpisodeMicrousd !==
        resolution.position.remainingEpisodeMicrousd ||
      resolution.billing.remainingCampaignMicrousd !==
        resolution.position.remainingCampaignMicrousd
    ) {
      throw new Error("PR6R budget position does not match the imported child");
    }
    const admitted = resolution.status === "admitted";
    if (admitted) {
      const reservation = resolution.reservation;
      if (
        reservation.id !== input.reservationId ||
        reservation.campaignId !== PR6R_CAMPAIGN_ID ||
        reservation.sessionId !== binding.childSessionId ||
        reservation.attemptId !== request.attemptId ||
        reservation.providerId !== PR6R_SYNTHETIC_PROVIDER_ID ||
        reservation.pricingSnapshotId !== pricing.pricingSnapshotId ||
        reservation.costScope !== PR6R_COST_SCOPE ||
        reservation.cloudEgressAdmissionId !== input.cloudEgressAdmissionId ||
        reservation.amountMicrousd !== resolution.billing.projectedCostMicrousd ||
        reservation.billableEstimatedInputTokens !==
          projection.billableInputTokens ||
        reservation.requestedMaxOutputTokens !==
          projection.requestedMaxOutputTokens ||
        reservation.cacheReadTokensAssumed !==
          projection.billableCacheReadTokens ||
        reservation.inputRateMicrousdPerMillion !==
          projection.inputMicrousdPerMillionTokens ||
        reservation.outputRateMicrousdPerMillion !==
          projection.outputMicrousdPerMillionTokens ||
        reservation.cacheReadRateMicrousdPerMillion !==
          (projection.cacheReadMicrousdPerMillionTokens ?? 0) ||
        reservation.providerFeeCeilingMicrousd !==
          projection.providerFeeCeilingMicrousd ||
        reservation.cacheAssumption !== BUDGET_CACHE_ASSUMPTION ||
        reservation.roundingPolicy !== BUDGET_ROUNDING_POLICY ||
        reservation.createdAt !== input.asOf
      ) {
        throw new Error("PR6R admitted reservation does not match the sealed request");
      }
    }
    const admission = {
      ...PASSED_ADMISSION,
      budget: admitted
        ? { status: "passed" as const, reasonCode: "budget_ok" as const }
        : { status: "denied" as const, reasonCode: "budget_denial" as const },
    };
    const decision = RoutingDecisionPayloadSchema.parse({
      decisionId: input.decisionId,
      policyVersion: "hybrid-lease-router-v0",
      costScope: PR6R_COST_SCOPE,
      cloudEgressAdmissionId: input.cloudEgressAdmissionId,
      boundary: "evidence_complete",
      phase: "synthesis",
      action: admitted ? "assign_new_lease" : "retain_lease",
      reasonCode: admitted ? "cloud_admitted" : "budget_denial",
      candidateProviderIds: providers.map((provider) => provider.providerId),
      selectedProviderId: admitted
        ? PR6R_SYNTHETIC_PROVIDER_ID
        : localProvider.providerId,
      selectedModel: admitted ? PR6R_MODEL_SLUG : localProvider.model,
      ...(admitted
        ? {}
        : {
            proposedProviderId: PR6R_SYNTHETIC_PROVIDER_ID,
            proposedModel: PR6R_MODEL_SLUG,
          }),
      priorLeaseId: binding.imported.retainedLocalLeaseId,
      selectedLeaseId: admitted
        ? input.selectedCloudLeaseId
        : binding.imported.retainedLocalLeaseId,
      riskSignals: [],
      triggerFacts: importedFacts(
        binding,
        admitted ? undefined : resolution.reason,
      ),
      admission,
      routerInputSnapshot,
      healthSnapshotId: cloudHealth.snapshotId,
      pricingSnapshotId: routerPricing.snapshotId,
      campaignId: PR6R_CAMPAIGN_ID,
      ...(admitted ? { budgetReservationId: input.reservationId } : {}),
      credentialMetadataId: PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID,
      billing: resolution.billing,
      provenanceSemanticSha256: binding.imported.provenanceSemanticSha256,
      ...(admitted
        ? {
            checkpointId: binding.imported.checkpointId,
            packetSha256: binding.imported.packetSha256,
            messagesSha256: binding.imported.semanticMessagesSha256,
          }
        : {
            proposalCheckpointId: binding.imported.checkpointId,
            proposalPacketSha256: binding.imported.packetSha256,
            proposalMessagesSha256: binding.imported.semanticMessagesSha256,
          }),
    });
    const plan: AttemptPlanV0 = AttemptPlanV0Schema.parse({
      providerId: admitted
        ? PR6R_SYNTHETIC_PROVIDER_ID
        : localProvider.providerId,
      model: admitted ? PR6R_MODEL_SLUG : localProvider.model,
      leaseId: admitted
        ? input.selectedCloudLeaseId
        : binding.imported.retainedLocalLeaseId,
      phase: "synthesis",
      requestedMaxOutputTokens: admitted
        ? PR6R_REQUESTED_OUTPUT_TOKENS
        : localProvider.maxOutputTokens,
      allowTools: false,
      requireToolCall: false,
      ...(admitted ? { budgetReservationId: input.reservationId } : {}),
      costScope: PR6R_COST_SCOPE,
      cloudEgressAdmissionId: input.cloudEgressAdmissionId,
    });
    const events = startEvents({
      binding,
      request,
      egressEvent,
      decision,
      plan,
      messageId: input.messageId,
      includeRoute: admitted,
    });
    const expectedLength = admitted ? 6 : 5;
    if (events.length !== expectedLength) {
      throw new Error(`PR6R prepared start expected ${expectedLength} events`);
    }
    const frozenEvents = deepFreeze([...events]);
    const authorityState = preparedAttemptAuthorityState.get(commitAuthority);
    if (authorityState === undefined || authorityState.consumed) {
      throw new Error("PR6R prepared-attempt authority is no longer active");
    }
    if (authorityState.selectedStart !== undefined) {
      throw new Error("PR6R prepared-attempt event batch was already selected");
    }
    authorityState.selectedStart = deepFreeze({
      resolution: structuredClone(resolution),
      events: frozenEvents,
    });
    return frozenEvents;
  };

  const authorityBinding = deepFreeze({
    childSessionId: binding.childSessionId,
    implementationRevision: providerValidation.implementationRevision,
    expectedSequence: binding.childLastSequence,
    createdAt: input.asOf,
    campaignId: PR6R_CAMPAIGN_ID,
    attemptId: request.attemptId,
    providerId: PR6R_SYNTHETIC_PROVIDER_ID,
    pricingSnapshotId: pricing.pricingSnapshotId,
    costScope: PR6R_COST_SCOPE,
    cloudEgressAdmissionId: input.cloudEgressAdmissionId,
    reservationId: input.reservationId,
  }) satisfies ConsumedPr6rPreparedLoopbackAttemptBinding;
  const commitAuthority = Object.freeze({
    kind: "pr6r_prepared_loopback_attempt" as const,
    childSessionId: binding.childSessionId,
    attemptId: request.attemptId,
    reservationId: input.reservationId,
  });
  preparedAttemptAuthorityState.set(commitAuthority, {
    consumed: false,
    store: input.store,
    applicationRequestSha256:
      canonicalPr6rCloudApplicationRequestSha256(request),
    binding: authorityBinding,
  });
  const prepared = deepFreeze({
    applicationRequest: request,
    implementationRevision: providerValidation.implementationRevision,
    childSessionId: binding.childSessionId,
    expectedSequence: binding.childLastSequence,
    createdAt: input.asOf,
    campaignId: PR6R_CAMPAIGN_ID,
    reservationId: input.reservationId,
    attemptId: request.attemptId,
    providerId: PR6R_SYNTHETIC_PROVIDER_ID,
    pricingSnapshotId: pricing.pricingSnapshotId,
    costScope: PR6R_COST_SCOPE,
    cloudEgressAdmissionId: input.cloudEgressAdmissionId,
    projection,
    routerInputSnapshot,
    commitAuthority,
    buildEvents,
  });
  preparedAttemptWrapperState.set(prepared, {
    store: input.store,
    applicationRequestSha256:
      canonicalPr6rCloudApplicationRequestSha256(request),
    commitAuthority,
    importedCheckpointAuthority: input.importedCheckpointAuthority,
    importedCheckpointBindingCanonical: canonicalPr6rJsonV1(binding),
  });
  return prepared;
}

/**
 * Read-only pre-side-effect check for the exact prepared wrapper. The later
 * commit authority remains active and one-use.
 */
export function assertPr6rPreparedLoopbackAttempt(
  prepared: PreparedPr6rLoopbackAttempt,
  input: {
    readonly store: EventStore;
    readonly applicationRequest: unknown;
    readonly asOf: string;
  },
): void {
  const request = CloudApplicationRequestV1Schema.parse(
    input.applicationRequest,
  );
  const asOfMs = requireCanonicalTimestamp(input.asOf, "dispatch asOf");
  const wrapperState = preparedAttemptWrapperState.get(prepared);
  const authorityState = preparedAttemptAuthorityState.get(
    prepared.commitAuthority,
  );
  if (
    wrapperState === undefined ||
    authorityState === undefined ||
    authorityState.consumed ||
    authorityState.selectedStart !== undefined ||
    wrapperState.store !== input.store ||
    authorityState.store !== input.store ||
    wrapperState.commitAuthority !== prepared.commitAuthority ||
    wrapperState.applicationRequestSha256 !==
      canonicalPr6rCloudApplicationRequestSha256(request) ||
    wrapperState.applicationRequestSha256 !==
      canonicalPr6rCloudApplicationRequestSha256(
        prepared.applicationRequest,
      ) ||
    prepared.childSessionId !== authorityState.binding.childSessionId ||
    prepared.implementationRevision !==
      authorityState.binding.implementationRevision ||
    prepared.expectedSequence !== authorityState.binding.expectedSequence ||
    prepared.createdAt !== authorityState.binding.createdAt ||
    prepared.campaignId !== authorityState.binding.campaignId ||
    prepared.attemptId !== authorityState.binding.attemptId ||
    prepared.providerId !== authorityState.binding.providerId ||
    prepared.pricingSnapshotId !== authorityState.binding.pricingSnapshotId ||
    prepared.costScope !== authorityState.binding.costScope ||
    prepared.cloudEgressAdmissionId !==
      authorityState.binding.cloudEgressAdmissionId ||
    prepared.reservationId !== authorityState.binding.reservationId
  ) {
    throw new Error(
      "PR6R prepared loopback attempt is forged, stale, or transplanted",
    );
  }
  try {
    const liveBinding = assertPr6rImportedCheckpoint(
      wrapperState.importedCheckpointAuthority,
      { store: input.store, childSessionId: prepared.childSessionId },
    );
    assertRequestMatchesImportedCheckpoint(request, liveBinding);
    if (
      liveBinding.childLastSequence !== prepared.expectedSequence ||
      canonicalPr6rJsonV1(liveBinding) !==
        wrapperState.importedCheckpointBindingCanonical
    ) {
      throw new Error("PR6R imported child changed after preparation");
    }
    const preparedAtMs = parsedTimestamp(prepared.createdAt, "prepared at");
    const deadline = prepared.routerInputSnapshot.deadline;
    const cloudHealth = prepared.routerInputSnapshot.healthSnapshots.find(
      (snapshot) =>
        snapshot.providerId === prepared.providerId &&
        snapshot.model === prepared.applicationRequest.model,
    );
    const pricing = prepared.routerInputSnapshot.pricingSnapshot;
    if (
      input.asOf < prepared.createdAt ||
      asOfMs < preparedAtMs ||
      prepared.routerInputSnapshot.asOf !== prepared.createdAt ||
      deadline.sufficient !== true ||
      parsedTimestamp(deadline.deadlineAt, "dispatch deadline") - asOfMs <
        deadline.requiredRemainingMs ||
      cloudHealth === undefined ||
      cloudHealth.providerId !== prepared.providerId ||
      asOfMs >= parsedTimestamp(cloudHealth.expiresAt, "cloud health expiry") ||
      pricing === undefined ||
      pricing.snapshotId !== prepared.pricingSnapshotId ||
      pricing.providerId !== prepared.providerId ||
      asOfMs >= parsedTimestamp(pricing.expiresAt, "pricing expiry")
    ) {
      throw new Error("PR6R prepared attempt expired before dispatch");
    }
  } catch {
    throw new Error(
      "PR6R prepared loopback attempt is forged, stale, or transplanted",
    );
  }
}

/**
 * Consume the process-local proof that start preparation passed the genuine
 * imported-checkpoint authority boundary. A structural import event or cloned
 * object can never mint this token.
 */
export function consumePr6rPreparedLoopbackAttemptAuthority(
  authority: Pr6rPreparedLoopbackAttemptAuthority,
  input: {
    readonly store: EventStore;
    readonly applicationRequest: unknown;
    readonly reservationId: string;
  },
): ConsumedPr6rPreparedLoopbackAttemptBinding {
  const request = CloudApplicationRequestV1Schema.parse(
    input.applicationRequest,
  );
  requireBoundedId(input.reservationId, "reservationId");
  const state = preparedAttemptAuthorityState.get(authority);
  if (state === undefined) {
    throw new Error("PR6R prepared-attempt authority is forged or cloned");
  }
  if (
    canonicalPr6rCloudApplicationRequestSha256(request) !==
      state.applicationRequestSha256 ||
    input.store !== state.store ||
    input.reservationId !== state.binding.reservationId ||
    authority.childSessionId !== state.binding.childSessionId ||
    authority.attemptId !== state.binding.attemptId ||
    authority.reservationId !== state.binding.reservationId
  ) {
    throw new Error("PR6R prepared-attempt authority binding mismatch");
  }
  if (state.consumed) {
    throw new Error("PR6R prepared-attempt authority was already consumed");
  }
  state.consumed = true;
  return deepFreeze({
    ...state.binding,
    ...(state.selectedStart === undefined
      ? {}
      : { selectedStart: state.selectedStart }),
  });
}

const PR6R_TRANSPORT_SENT_FAILURE_CODES = new Set<string>(
  PR6R_LOOPBACK_FAILED_SENT_REASONS.filter(
    (code) => code !== "loopback.accounting_invalid",
  ),
);
const PR6R_TRANSPORT_UNKNOWN_FAILURE_CODES = new Set<string>(
  PR6R_LOOPBACK_FAILED_UNKNOWN_REASONS.filter(
    (code) => code !== "loopback.recovery_required",
  ),
);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function requireNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is not a nonnegative safe integer`);
  }
}

function requireSha256(value: string, label: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`${label} is not a canonical SHA-256`);
  }
}

function requirePr6rReservation(
  reservation: BudgetReservation,
  request: CloudApplicationRequestV1,
): void {
  requireBoundedId(reservation.id, "reservation.id");
  requireCanonicalTimestamp(reservation.createdAt, "reservation.createdAt");
  if (reservation.cloudEgressAdmissionId === undefined) {
    throw new Error("PR6R reservation has no Cloud egress admission identity");
  }
  requireBoundedId(
    reservation.cloudEgressAdmissionId,
    "reservation.cloudEgressAdmissionId",
  );
  for (const [value, label] of [
    [reservation.amountMicrousd, "reservation.amountMicrousd"],
    [
      reservation.billableEstimatedInputTokens,
      "reservation.billableEstimatedInputTokens",
    ],
    [
      reservation.requestedMaxOutputTokens,
      "reservation.requestedMaxOutputTokens",
    ],
    [reservation.cacheReadTokensAssumed, "reservation.cacheReadTokensAssumed"],
    [
      reservation.inputRateMicrousdPerMillion,
      "reservation.inputRateMicrousdPerMillion",
    ],
    [
      reservation.outputRateMicrousdPerMillion,
      "reservation.outputRateMicrousdPerMillion",
    ],
    [
      reservation.cacheReadRateMicrousdPerMillion,
      "reservation.cacheReadRateMicrousdPerMillion",
    ],
    [
      reservation.providerFeeCeilingMicrousd,
      "reservation.providerFeeCeilingMicrousd",
    ],
  ] as const) {
    requireNonNegativeSafeInteger(value, label);
  }
  const expectedProjection: BudgetProjectionInput = {
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
  };
  if (
    reservation.campaignId !== PR6R_CAMPAIGN_ID ||
    reservation.sessionId !== request.synthesisSessionId ||
    reservation.attemptId !== request.attemptId ||
    reservation.providerId !== PR6R_SYNTHETIC_PROVIDER_ID ||
    reservation.pricingSnapshotId !== PR6R_SIMULATION_PRICING_SNAPSHOT_ID ||
    reservation.costScope !== PR6R_COST_SCOPE ||
    reservation.billableEstimatedInputTokens !== request.estimatedInputTokens ||
    reservation.requestedMaxOutputTokens !== PR6R_REQUESTED_OUTPUT_TOKENS ||
    reservation.cacheReadTokensAssumed !== 0 ||
    reservation.inputRateMicrousdPerMillion !==
      PR6R_SIMULATION_INPUT_RATE_MICROUSD_PER_MILLION ||
    reservation.outputRateMicrousdPerMillion !==
      PR6R_SIMULATION_OUTPUT_RATE_MICROUSD_PER_MILLION ||
    reservation.cacheReadRateMicrousdPerMillion !== 0 ||
    reservation.providerFeeCeilingMicrousd !== 0 ||
    reservation.cacheAssumption !== BUDGET_CACHE_ASSUMPTION ||
    reservation.roundingPolicy !== BUDGET_ROUNDING_POLICY ||
    reservation.amountMicrousd !==
      projectWorstCaseCostMicrousd(expectedProjection)
  ) {
    throw new Error("PR6R finish reservation does not match the sealed request");
  }
}

function requirePr6rReportedUsage(
  usage: Pr6rLoopbackNormalizedUsage,
  request: CloudApplicationRequestV1,
): Readonly<{
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  reported: true;
}> {
  for (const [value, label] of [
    [usage.inputTokens, "usage.inputTokens"],
    [usage.cacheReadTokens, "usage.cacheReadTokens"],
    [usage.cacheWriteTokens, "usage.cacheWriteTokens"],
    [usage.reasoningTokens, "usage.reasoningTokens"],
    [usage.outputTokens, "usage.outputTokens"],
    [usage.totalTokens, "usage.totalTokens"],
  ] as const) {
    requireNonNegativeSafeInteger(value, label);
  }
  if (
    usage.inputTokens !== request.estimatedInputTokens ||
    usage.cacheReadTokens > usage.inputTokens ||
    usage.cacheWriteTokens !== 0 ||
    usage.reasoningTokens + usage.outputTokens >
      request.requestedOutputTokens ||
    usage.totalTokens !==
      usage.inputTokens + usage.reasoningTokens + usage.outputTokens
  ) {
    throw new Error("PR6R reported usage does not match the sealed request");
  }
  return deepFreeze({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    cacheReadTokens: usage.cacheReadTokens,
    reported: true as const,
  });
}

function unreportedUsage() {
  return deepFreeze({
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    reported: false as const,
  });
}

/**
 * Convert one bounded loopback result into the exact atomic SQLite finish
 * batch. Raw response material and the parsed result are deliberately absent
 * from the events; the latter is returned separately for A3's main-only host
 * acceptance bridge.
 */
export function preparePr6rLoopbackAttemptFinish(
  input: PreparePr6rLoopbackAttemptFinishInput,
): PreparedPr6rLoopbackAttemptFinish {
  const request = CloudApplicationRequestV1Schema.parse(
    input.applicationRequest,
  );
  requireBoundedId(input.checkpointId, "checkpointId");
  requireBoundedId(input.messageId, "messageId");
  requirePr6rReservation(input.reservation, request);
  if (typeof input.cancelledAfterTransport !== "boolean") {
    throw new Error("cancelledAfterTransport must be a boolean snapshot");
  }
  const consumedTransport = consumePr6rLoopbackTransportResult(
    input.transportResult,
    {
      applicationRequest: request,
      reservationId: input.reservation.id,
    },
  );
  const transport: Pr6rLoopbackTransportResult = input.cancelledAfterTransport
    ? Object.freeze({
        outcome: "cancelled" as const,
        requestDisposition: "unknown" as const,
        stableCode: "loopback.cancelled_after_dispatch" as const,
        durationMs: consumedTransport.result.durationMs,
      })
    : consumedTransport.result;
  requireNonNegativeSafeInteger(transport.durationMs, "transport.durationMs");
  if (transport.durationMs > PR6R_MAX_RECORDED_DURATION_MS) {
    throw new Error("PR6R transport duration exceeds the persisted bound");
  }

  let outcome: "succeeded" | "provider_error" | "protocol_error" | "timeout" | "cancelled";
  let finishReason: "stop" | "error" | "timeout" | "cancelled";
  let usage:
    | ReturnType<typeof requirePr6rReportedUsage>
    | ReturnType<typeof unreportedUsage>;
  let responseBodySha256: string | undefined;
  let reviewResultSha256: string | undefined;
  let reviewResult: ReviewResultV1 | undefined;
  let terminalOutcome: "completed" | "failed" | "cancelled";
  let requestDisposition: "sent" | "unknown";
  let stableCode: string;

  if (transport.outcome === "succeeded") {
    if (
      transport.requestDisposition !== "sent" ||
      transport.stableCode !== "completed" ||
      transport.response.schemaVersion !==
        PR6R_LOOPBACK_RESPONSE_SCHEMA_VERSION ||
      transport.response.requestId !== request.requestId
    ) {
      throw new Error("PR6R successful transport does not match its sealed request");
    }
    reviewResult = canonicalPr6rReviewResult(transport.response.reviewResult);
    responseBodySha256 = transport.response.responseBodySha256;
    reviewResultSha256 = transport.response.reviewResultSha256;
    requireSha256(responseBodySha256, "responseBodySha256");
    requireSha256(reviewResultSha256, "reviewResultSha256");
    if (
      reviewResultSha256 !== canonicalPr6rReviewResultSha256(reviewResult)
    ) {
      throw new Error("PR6R result hash does not match the parsed ReviewResult");
    }
    usage = requirePr6rReportedUsage(transport.response.usage, request);
    outcome = "succeeded";
    finishReason = "stop";
    terminalOutcome = "completed";
    requestDisposition = "sent";
    stableCode = "completed";
  } else if (transport.outcome === "failed") {
    stableCode = transport.stableCode;
    const sent = PR6R_TRANSPORT_SENT_FAILURE_CODES.has(stableCode);
    const unknown = PR6R_TRANSPORT_UNKNOWN_FAILURE_CODES.has(stableCode);
    if (
      sent === unknown ||
      transport.requestDisposition !== (sent ? "sent" : "unknown") ||
      (transport.requestDisposition === "unknown" &&
        (transport.responseBodySha256 !== undefined ||
          transport.usage !== undefined)) ||
      (stableCode === "loopback.response_too_large" &&
        transport.responseBodySha256 !== undefined) ||
      (transport.usage !== undefined &&
        transport.responseBodySha256 === undefined)
    ) {
      throw new Error("PR6R failed transport has an invalid terminal tuple");
    }
    if (transport.responseBodySha256 !== undefined) {
      requireSha256(transport.responseBodySha256, "responseBodySha256");
      responseBodySha256 = transport.responseBodySha256;
    }
    usage =
      transport.usage === undefined
        ? unreportedUsage()
        : requirePr6rReportedUsage(transport.usage, request);
    outcome =
      stableCode === "loopback.timeout"
        ? "timeout"
        : stableCode === "loopback.http_error" ||
            stableCode === "loopback.dispatch_unknown"
          ? "provider_error"
          : "protocol_error";
    finishReason = outcome === "timeout" ? "timeout" : "error";
    terminalOutcome = "failed";
    requestDisposition = transport.requestDisposition;
  } else if (transport.outcome === "cancelled") {
    if (
      transport.requestDisposition !== "unknown" ||
      transport.stableCode !== "loopback.cancelled_after_dispatch"
    ) {
      throw new Error("PR6R cancelled transport has an invalid terminal tuple");
    }
    outcome = "cancelled";
    finishReason = "cancelled";
    usage = unreportedUsage();
    terminalOutcome = "cancelled";
    requestDisposition = "unknown";
    stableCode = transport.stableCode;
  } else {
    throw new Error("PR6R transport result has an unknown outcome");
  }

  const cost = usage.reported
    ? {
        amountMicrousd: calculatePr6rHostPricedSimulationCostMicrousd({
          inputTokens: usage.inputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: 0,
          reasoningTokens: usage.reasoningTokens,
          visibleOutputTokens: usage.outputTokens,
        }),
        provenance: "host_pricing_snapshot" as const,
        reservationId: input.reservation.id,
        costScope: PR6R_COST_SCOPE,
      }
    : {
        amountMicrousd: input.reservation.amountMicrousd,
        provenance: "reserved_unknown" as const,
        reservationId: input.reservation.id,
        costScope: PR6R_COST_SCOPE,
      };
  if (cost.amountMicrousd > input.reservation.amountMicrousd) {
    throw new Error("PR6R reported usage exceeds its full reservation");
  }

  const rawEvents: SessionEventData[] = [
    {
      type: "assistant.message.completed",
      payload: {
        messageId: input.messageId,
        stopReason: finishReason,
        completionState: outcome === "succeeded" ? "complete" : "incomplete",
        attemptId: request.attemptId,
      },
    },
    {
      type: "inference.attempt.finished",
      payload: {
        attemptId: request.attemptId,
        checkpointId: input.checkpointId,
        outcome,
        requestDisposition,
        finishReason,
        ...(outcome === "succeeded" ? { servedModel: PR6R_MODEL_SLUG } : {}),
        usage,
        cost,
        latencyMs: transport.durationMs,
        ...(outcome === "succeeded" ? {} : { errorCode: stableCode }),
        ...(responseBodySha256 === undefined ? {} : { responseBodySha256 }),
        ...(reviewResultSha256 === undefined ? {} : { reviewResultSha256 }),
      },
    },
    ...(outcome === "cancelled"
      ? [
          {
            type: "session.cancelled" as const,
            payload: { reason: "Cancelled during PR6R loopback dispatch." },
          },
        ]
      : []),
  ];
  const events = deepFreeze(rawEvents.map(parseSessionEventData));
  const terminal = deepFreeze({
    terminalOutcome,
    requestDisposition,
    stableCode,
  });
  const finishBinding = deepFreeze({
    childSessionId: request.synthesisSessionId,
    attemptId: request.attemptId,
    reservationId: input.reservation.id,
    terminal,
    events,
    sqliteDispatchChain: consumedTransport.sqliteDispatchChain,
  }) satisfies ConsumedPr6rPreparedLoopbackFinishBinding;
  const commitAuthority = Object.freeze({
    kind: "pr6r_prepared_loopback_finish" as const,
    childSessionId: request.synthesisSessionId,
    attemptId: request.attemptId,
    reservationId: input.reservation.id,
  });
  preparedFinishAuthorityState.set(commitAuthority, {
    consumed: false,
    applicationRequestSha256:
      canonicalPr6rCloudApplicationRequestSha256(request),
    binding: finishBinding,
  });
  return deepFreeze({
    childSessionId: request.synthesisSessionId,
    attemptId: request.attemptId,
    reservationId: input.reservation.id,
    terminal,
    events,
    commitAuthority,
    ...(reviewResult === undefined ? {} : { reviewResult }),
  });
}

/** Consume one genuine prepared finish after its atomic UoW commit. */
export function consumePr6rPreparedLoopbackFinishAuthority(
  authority: Pr6rPreparedLoopbackFinishAuthority,
  input: { readonly applicationRequest: unknown; readonly reservationId: string },
): ConsumedPr6rPreparedLoopbackFinishBinding {
  const request = CloudApplicationRequestV1Schema.parse(
    input.applicationRequest,
  );
  requireBoundedId(input.reservationId, "reservationId");
  const state = preparedFinishAuthorityState.get(authority);
  if (state === undefined) {
    throw new Error("PR6R prepared-finish authority is forged or cloned");
  }
  if (
    canonicalPr6rCloudApplicationRequestSha256(request) !==
      state.applicationRequestSha256 ||
    input.reservationId !== state.binding.reservationId ||
    authority.childSessionId !== state.binding.childSessionId ||
    authority.attemptId !== state.binding.attemptId ||
    authority.reservationId !== state.binding.reservationId
  ) {
    throw new Error("PR6R prepared-finish authority binding mismatch");
  }
  if (state.consumed) {
    throw new Error("PR6R prepared-finish authority was already consumed");
  }
  state.consumed = true;
  return state.binding;
}
