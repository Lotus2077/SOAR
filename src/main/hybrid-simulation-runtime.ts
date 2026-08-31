import { randomUUID } from "node:crypto";

import { sha256Hex } from "../shared/context-compiler";
import {
  PROVIDER_PRICING_MAX_AGE_MS,
} from "../shared/checkpoint-router";
import {
  HYBRID_SIMULATION_CONSENT_ID,
  HYBRID_SIMULATION_CAMPAIGN_CREATED_AT,
  HYBRID_SIMULATION_DISCLOSURE_TEXT_SHA256,
  HYBRID_SIMULATION_DISCLOSURE_VERSION,
  HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
  HYBRID_SIMULATION_RESULT_MARKER,
  HYBRID_SIMULATION_ROUTE,
  HybridSimulationSessionAuthorityV1Schema,
  type HybridSimulationSessionAuthorityV1,
} from "../shared/hybrid-simulation-contracts";
import {
  ProviderHealthSnapshotV0Schema,
  ProviderPricingSnapshotV0Schema,
  type ProviderHealthSnapshotV0,
  type ProviderPricingSnapshotV0,
} from "../shared/session-events";
import type { AttemptUnitOfWork } from "./attempt-unit-of-work";
import type { BudgetLedger } from "./budget-ledger";
import {
  FAKE_CLOUD_INPUT_MICROUSD_PER_MILLION_TOKENS,
  FAKE_CLOUD_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
  FAKE_CLOUD_REVIEW_PROVIDER_ID,
  isFakeCloudReviewProviderV1,
} from "./providers/fake-cloud-review-provider";
import { isFakeLocalProviderV1 } from "./providers/fake-provider";
import type { ProviderDescriptor } from "./providers/provider-descriptor";
import {
  ProviderRegistry,
  type ProviderRegistration,
} from "./providers/provider-registry";

export const HYBRID_SIMULATION_AUTHORITY_ID =
  "soar-hybrid-simulation-authority-v1";
export const HYBRID_SIMULATION_CAMPAIGN_ID =
  "soar-hybrid-simulation-campaign-v1";
export const HYBRID_SIMULATION_CREDENTIAL_METADATA_ID =
  "soar-fake-cloud-credential-v1";
export const HYBRID_SIMULATION_LOCAL_HEALTH_SNAPSHOT_ID =
  "fake-local-health-v1";
export const HYBRID_SIMULATION_CLOUD_HEALTH_SNAPSHOT_ID =
  "fake-cloud-health-v1";
export const HYBRID_SIMULATION_PRICING_SNAPSHOT_ID =
  "fake-cloud-pricing-v1";

const HYBRID_SIMULATION_RUNTIME_V1 = Symbol(
  "soar.hybrid-simulation-runtime-v1",
);
const HYBRID_SIMULATION_RUNTIMES_V1 = new WeakSet<object>();
const SYNTHETIC_FACT_TTL_MS = 60_000;

export interface HybridSimulationTestHooksV1 {
  beforeFakeCloudDispatch?: () => void | Promise<void>;
  afterCloudWorkspaceRevalidation?: () => void | Promise<void>;
  afterFakeCloudFailurePersisted?: () => void | Promise<void>;
}

export interface HybridSimulationRuntimeV1 {
  readonly [HYBRID_SIMULATION_RUNTIME_V1]: true;
  readonly kind: "hybrid-simulation-runtime-v1";
  readonly fakeProviderIds: readonly [string, string];
  readonly localProviderId: string;
  readonly cloudProviderId: typeof FAKE_CLOUD_REVIEW_PROVIDER_ID;
  readonly campaignId: typeof HYBRID_SIMULATION_CAMPAIGN_ID;
  readonly credentialMetadataId: typeof HYBRID_SIMULATION_CREDENTIAL_METADATA_ID;
  readonly simulationAuthorityId: typeof HYBRID_SIMULATION_AUTHORITY_ID;
  readonly disclosureVersion: typeof HYBRID_SIMULATION_DISCLOSURE_VERSION;
  readonly disclosureTextSha256: typeof HYBRID_SIMULATION_DISCLOSURE_TEXT_SHA256;
  readonly maxSimulatedSpendMicrousd: typeof HYBRID_SIMULATION_MAX_SPEND_MICROUSD;
  readonly credentialAvailable: boolean;
  readonly clock: () => Date;
  readonly idFactory: () => string;
  readonly healthSnapshotProvider: (
    provider: ProviderDescriptor,
    asOf: string,
  ) => ProviderHealthSnapshotV0;
  readonly pricingSnapshotProvider: (
    provider: ProviderDescriptor,
    asOf: string,
  ) => ProviderPricingSnapshotV0;
  readonly attemptUnitOfWorkFactory?: (
    ledger: BudgetLedger,
  ) => AttemptUnitOfWork;
  readonly testHooks?: HybridSimulationTestHooksV1;
}

export interface CreateHybridSimulationRuntimeOptionsV1 {
  providerRegistry: ProviderRegistry;
  defaultLocalProviderId: string;
  credentialAvailable?: boolean;
  localHealthStatus?: "healthy" | "unhealthy" | "unavailable";
  cloudHealthStatus?: "healthy" | "unhealthy" | "unavailable";
  pricingStatus?: "available" | "unavailable";
  clock?: () => Date;
  idFactory?: () => string;
  attemptUnitOfWorkFactory?: (ledger: BudgetLedger) => AttemptUnitOfWork;
  /** Deterministic orchestration seams; never populated by renderer input. */
  testHooks?: HybridSimulationTestHooksV1;
}

export interface AdmittedHybridSimulationProvidersV1 {
  local: ProviderRegistration;
  cloud: ProviderRegistration;
  descriptors: readonly [ProviderDescriptor, ProviderDescriptor];
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right);
}

function requireExactFakeProviders(options: {
  providerRegistry: ProviderRegistry;
  defaultLocalProviderId: string;
  fakeProviderIds?: readonly string[];
}): AdmittedHybridSimulationProvidersV1 {
  const descriptors = options.providerRegistry.listDescriptors({
    includeDisabled: true,
  });
  const actualIds = descriptors.map((descriptor) => descriptor.id).sort(compareText);
  const requiredIds = [
    options.defaultLocalProviderId,
    FAKE_CLOUD_REVIEW_PROVIDER_ID,
  ].sort(compareText);
  const admittedIds = options.fakeProviderIds
    ? [...options.fakeProviderIds].sort(compareText)
    : requiredIds;
  if (
    actualIds.length !== 2 ||
    admittedIds.length !== 2 ||
    new Set(admittedIds).size !== 2 ||
    actualIds.some((id, index) => id !== admittedIds[index]) ||
    requiredIds.some((id, index) => id !== admittedIds[index])
  ) {
    throw new Error(
      "Hybrid simulation requires exactly its branded fake Local and fake Cloud providers.",
    );
  }

  const local = options.providerRegistry.require(options.defaultLocalProviderId, [
    "chat_completions",
    "streaming",
    "structured_json_schema",
    "tool_calling",
  ]);
  const cloudDescriptor = options.providerRegistry.getDescriptor(
    FAKE_CLOUD_REVIEW_PROVIDER_ID,
  );
  if (cloudDescriptor === undefined) {
    throw new Error("Hybrid simulation is missing its fake Cloud descriptor.");
  }
  const cloud = options.providerRegistry.require(
    FAKE_CLOUD_REVIEW_PROVIDER_ID,
    ["chat_completions", "streaming", "structured_json_schema"],
    { asOf: cloudDescriptor.accounting.kind === "metered"
        ? cloudDescriptor.accounting.pricingVerifiedAt
        : new Date(0) },
  );
  if (
    !isFakeLocalProviderV1(local.provider) ||
    local.descriptor.locality !== "local" ||
    local.descriptor.accounting.kind !== "local_zero_cost"
  ) {
    throw new Error(
      "Hybrid simulation requires its nominally branded local zero-cost fake.",
    );
  }
  if (
    !isFakeCloudReviewProviderV1(cloud.provider) ||
    cloud.descriptor.locality !== "cloud" ||
    cloud.descriptor.accounting.kind !== "metered" ||
    cloud.descriptor.capabilities.includes("tool_calling")
  ) {
    throw new Error(
      "Hybrid simulation requires its nominally branded tool-free metered fake Cloud review provider.",
    );
  }
  return {
    local,
    cloud,
    descriptors: [local.descriptor, cloud.descriptor],
  };
}

export function createHybridSimulationRuntimeV1(
  options: CreateHybridSimulationRuntimeOptionsV1,
): HybridSimulationRuntimeV1 {
  const admitted = requireExactFakeProviders(options);
  const clock = options.clock ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;
  const localHealthStatus = options.localHealthStatus ?? "healthy";
  const cloudHealthStatus = options.cloudHealthStatus ?? "healthy";
  const pricingStatus = options.pricingStatus ?? "available";
  const fakeProviderIds = admitted.descriptors
    .map((descriptor) => descriptor.id)
    .sort(compareText) as [string, string];

  const runtime: HybridSimulationRuntimeV1 = {
    [HYBRID_SIMULATION_RUNTIME_V1]: true,
    kind: "hybrid-simulation-runtime-v1",
    fakeProviderIds: Object.freeze(fakeProviderIds),
    localProviderId: admitted.local.descriptor.id,
    cloudProviderId: FAKE_CLOUD_REVIEW_PROVIDER_ID,
    campaignId: HYBRID_SIMULATION_CAMPAIGN_ID,
    credentialMetadataId: HYBRID_SIMULATION_CREDENTIAL_METADATA_ID,
    simulationAuthorityId: HYBRID_SIMULATION_AUTHORITY_ID,
    disclosureVersion: HYBRID_SIMULATION_DISCLOSURE_VERSION,
    disclosureTextSha256: HYBRID_SIMULATION_DISCLOSURE_TEXT_SHA256,
    maxSimulatedSpendMicrousd: HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
    credentialAvailable: options.credentialAvailable ?? true,
    clock,
    idFactory,
    healthSnapshotProvider: (provider, asOf) => {
      const status =
        provider.id === admitted.local.descriptor.id
          ? localHealthStatus
          : provider.id === admitted.cloud.descriptor.id
            ? cloudHealthStatus
            : undefined;
      if (status === undefined) {
        throw new Error(`Provider ${provider.id} is outside Hybrid simulation authority.`);
      }
      return ProviderHealthSnapshotV0Schema.parse({
        snapshotId:
          provider.id === admitted.local.descriptor.id
            ? HYBRID_SIMULATION_LOCAL_HEALTH_SNAPSHOT_ID
            : HYBRID_SIMULATION_CLOUD_HEALTH_SNAPSHOT_ID,
        providerId: provider.id,
        model: provider.model,
        checkedAt: asOf,
        expiresAt: new Date(
          Date.parse(asOf) + SYNTHETIC_FACT_TTL_MS,
        ).toISOString(),
        status,
        resultCode:
          status === "healthy"
            ? "configured_model_available"
            : "synthetic_model_unavailable",
      });
    },
    pricingSnapshotProvider: (provider, asOf) => {
      if (provider.id !== admitted.cloud.descriptor.id) {
        throw new Error("Only the fake Cloud provider has simulated pricing.");
      }
      return ProviderPricingSnapshotV0Schema.parse({
        snapshotId: HYBRID_SIMULATION_PRICING_SNAPSHOT_ID,
        providerId: provider.id,
        model: provider.model,
        verifiedAt: asOf,
        expiresAt: new Date(
          Date.parse(asOf) + PROVIDER_PRICING_MAX_AGE_MS,
        ).toISOString(),
        status: pricingStatus,
        inputMicrousdPerMillionTokens:
          FAKE_CLOUD_INPUT_MICROUSD_PER_MILLION_TOKENS,
        outputMicrousdPerMillionTokens:
          FAKE_CLOUD_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
        cacheReadMicrousdPerMillionTokens: 0,
        pricingSourceSha256: sha256Hex(
          "soar://hybrid-simulation/fake-cloud-pricing-v1",
        ),
      });
    },
    ...(options.attemptUnitOfWorkFactory === undefined
      ? {}
      : { attemptUnitOfWorkFactory: options.attemptUnitOfWorkFactory }),
    ...(options.testHooks === undefined
      ? {}
      : { testHooks: Object.freeze({ ...options.testHooks }) }),
  };
  HYBRID_SIMULATION_RUNTIMES_V1.add(runtime);
  return Object.freeze(runtime);
}

export function assertHybridSimulationRuntimeV1(options: {
  runtime: HybridSimulationRuntimeV1;
  providerRegistry: ProviderRegistry;
  defaultLocalProviderId: string;
}): AdmittedHybridSimulationProvidersV1 {
  if (
    options.runtime.kind !== "hybrid-simulation-runtime-v1" ||
    options.runtime[HYBRID_SIMULATION_RUNTIME_V1] !== true ||
    !HYBRID_SIMULATION_RUNTIMES_V1.has(options.runtime) ||
    options.runtime.localProviderId !== options.defaultLocalProviderId ||
    options.runtime.cloudProviderId !== FAKE_CLOUD_REVIEW_PROVIDER_ID ||
    options.runtime.campaignId !== HYBRID_SIMULATION_CAMPAIGN_ID ||
    options.runtime.credentialMetadataId !==
      HYBRID_SIMULATION_CREDENTIAL_METADATA_ID ||
    options.runtime.simulationAuthorityId !== HYBRID_SIMULATION_AUTHORITY_ID ||
    options.runtime.disclosureVersion !== HYBRID_SIMULATION_DISCLOSURE_VERSION ||
    options.runtime.disclosureTextSha256 !==
      HYBRID_SIMULATION_DISCLOSURE_TEXT_SHA256 ||
    options.runtime.maxSimulatedSpendMicrousd !==
      HYBRID_SIMULATION_MAX_SPEND_MICROUSD
  ) {
    throw new Error("The Hybrid simulation runtime authority is invalid.");
  }
  return requireExactFakeProviders({
    providerRegistry: options.providerRegistry,
    defaultLocalProviderId: options.defaultLocalProviderId,
    fakeProviderIds: options.runtime.fakeProviderIds,
  });
}

export function hybridSimulationAuthoritySnapshotV1(
  runtime: HybridSimulationRuntimeV1,
  providers: AdmittedHybridSimulationProvidersV1,
): HybridSimulationSessionAuthorityV1 {
  return Object.freeze(HybridSimulationSessionAuthorityV1Schema.parse({
    schemaVersion: "hybrid-simulation-session-authority-v1",
    disclosureVersion: runtime.disclosureVersion,
    disclosureTextSha256: runtime.disclosureTextSha256,
    simulationAuthorityId: runtime.simulationAuthorityId,
    route: HYBRID_SIMULATION_ROUTE,
    resultMarker: HYBRID_SIMULATION_RESULT_MARKER,
    fakeLocalProvider: {
      providerId: providers.local.descriptor.id,
      model: providers.local.descriptor.model,
    },
    fakeCloudProvider: {
      providerId: providers.cloud.descriptor.id,
      model: providers.cloud.descriptor.model,
    },
    maxSimulatedSpendMicrousd: runtime.maxSimulatedSpendMicrousd,
    costScope: "simulation",
    simulationConsent: HYBRID_SIMULATION_CONSENT_ID,
    egressConsent: "none",
    riskPolicyId: "review-risk-v1",
    routerPolicyVersion: "hybrid-lease-router-v0",
    healthSnapshotId: HYBRID_SIMULATION_CLOUD_HEALTH_SNAPSHOT_ID,
    pricingSnapshotId: HYBRID_SIMULATION_PRICING_SNAPSHOT_ID,
    campaignId: runtime.campaignId,
    campaignCreatedAt: HYBRID_SIMULATION_CAMPAIGN_CREATED_AT,
    credentialMetadataId: runtime.credentialMetadataId,
  }));
}
