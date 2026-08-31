import { describe, expect, it } from "vitest";

import {
  HYBRID_SIMULATION_AUTHORITY_ID,
  HYBRID_SIMULATION_CAMPAIGN_ID,
  assertHybridSimulationRuntimeV1,
  createHybridSimulationRuntimeV1,
  hybridSimulationAuthoritySnapshotV1,
} from "../../src/main/hybrid-simulation-runtime";
import {
  HYBRID_SIMULATION_DISCLOSURE_TEXT_SHA256,
  HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
} from "../../src/shared/hybrid-simulation-contracts";
import { createFakeCloudReviewProviderV1 } from "../../src/main/providers/fake-cloud-review-provider";
import { FakeProvider } from "../../src/main/providers/fake-provider";
import { ProviderRegistry } from "../../src/main/providers/provider-registry";
import type { DescribedInferenceProvider } from "../../src/main/providers/types";

const NOW = "2026-09-01T00:00:00.000Z";

function registry() {
  const local = new FakeProvider({ delayMs: 0 });
  const cloud = createFakeCloudReviewProviderV1({
    pricingVerifiedAt: NOW,
    delayMs: 0,
  });
  return {
    local,
    cloud,
    providerRegistry: new ProviderRegistry([
      { descriptor: local.descriptor, provider: local },
      { descriptor: cloud.descriptor, provider: cloud },
    ]),
  };
}

describe("HybridSimulationRuntimeV1", () => {
  it("binds exactly two branded fake providers and fixed simulation authority", () => {
    const fixture = registry();
    const runtime = createHybridSimulationRuntimeV1({
      providerRegistry: fixture.providerRegistry,
      defaultLocalProviderId: fixture.local.id,
      clock: () => new Date(NOW),
      idFactory: () => "runtime-id",
    });
    const providers = assertHybridSimulationRuntimeV1({
      runtime,
      providerRegistry: fixture.providerRegistry,
      defaultLocalProviderId: fixture.local.id,
    });

    expect(runtime).toMatchObject({
      kind: "hybrid-simulation-runtime-v1",
      campaignId: HYBRID_SIMULATION_CAMPAIGN_ID,
      simulationAuthorityId: HYBRID_SIMULATION_AUTHORITY_ID,
      maxSimulatedSpendMicrousd: HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
      disclosureTextSha256: HYBRID_SIMULATION_DISCLOSURE_TEXT_SHA256,
      credentialAvailable: true,
    });
    expect(runtime.fakeProviderIds).toEqual([
      "fake-cloud-review",
      "local-vllm",
    ]);
    expect(hybridSimulationAuthoritySnapshotV1(runtime, providers)).toMatchObject({
      schemaVersion: "hybrid-simulation-session-authority-v1",
      costScope: "simulation",
      simulationConsent: "simulation_cloud_synthesis_v1",
      egressConsent: "none",
      fakeLocalProvider: { providerId: "local-vllm" },
      fakeCloudProvider: { providerId: "fake-cloud-review" },
    });
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(Object.isFrozen(runtime.fakeProviderIds)).toBe(true);
  });

  it("produces bounded synthetic health and pricing facts only for admitted providers", () => {
    const fixture = registry();
    const runtime = createHybridSimulationRuntimeV1({
      providerRegistry: fixture.providerRegistry,
      defaultLocalProviderId: fixture.local.id,
      clock: () => new Date(NOW),
    });
    const providers = assertHybridSimulationRuntimeV1({
      runtime,
      providerRegistry: fixture.providerRegistry,
      defaultLocalProviderId: fixture.local.id,
    });

    expect(runtime.healthSnapshotProvider(providers.local.descriptor, NOW)).toMatchObject({
      providerId: "local-vllm",
      status: "healthy",
    });
    expect(runtime.healthSnapshotProvider(providers.cloud.descriptor, NOW)).toMatchObject({
      providerId: "fake-cloud-review",
      status: "healthy",
    });
    expect(runtime.pricingSnapshotProvider(providers.cloud.descriptor, NOW)).toMatchObject({
      providerId: "fake-cloud-review",
      status: "available",
      inputMicrousdPerMillionTokens: 1_000_000,
      outputMicrousdPerMillionTokens: 4_000_000,
    });
    expect(() =>
      runtime.pricingSnapshotProvider(providers.local.descriptor, NOW),
    ).toThrow("Only the fake Cloud provider");
  });

  it("rejects extra registrations and unbranded provider lookalikes", () => {
    const fixture = registry();
    const extra = new FakeProvider({ delayMs: 0 });
    const extraDescriptor = { ...extra.descriptor, id: "extra-local-fake" };
    const extraProvider = {
      ...extra,
      id: extraDescriptor.id,
      descriptor: extraDescriptor,
    } as unknown as DescribedInferenceProvider;
    expect(
      () =>
        createHybridSimulationRuntimeV1({
          providerRegistry: new ProviderRegistry([
            { descriptor: fixture.local.descriptor, provider: fixture.local },
            { descriptor: fixture.cloud.descriptor, provider: fixture.cloud },
            { descriptor: extraDescriptor, provider: extraProvider },
          ]),
          defaultLocalProviderId: fixture.local.id,
        }),
    ).toThrow("exactly its branded fake Local and fake Cloud providers");

    const lookalike: DescribedInferenceProvider = {
      ...fixture.cloud,
      descriptor: fixture.cloud.descriptor,
      complete: (input) => fixture.cloud.complete(input),
    };
    expect(
      () =>
        createHybridSimulationRuntimeV1({
          providerRegistry: new ProviderRegistry([
            { descriptor: fixture.local.descriptor, provider: fixture.local },
            { descriptor: lookalike.descriptor, provider: lookalike },
          ]),
          defaultLocalProviderId: fixture.local.id,
        }),
    ).toThrow("nominally branded tool-free metered fake Cloud");
  });
});
