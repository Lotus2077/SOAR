import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { SoarConfig } from "../../src/main/config";
import {
  parseProviderDescriptor,
  ProviderDescriptorSchema,
  type ProviderDescriptor,
} from "../../src/main/providers/provider-descriptor";
import { ProviderRegistry } from "../../src/main/providers/provider-registry";
import { createRuntimeProviderCatalog } from "../../src/main/providers/runtime-catalog";
import type { DescribedInferenceProvider } from "../../src/main/providers/types";

function localDescriptor(
  overrides: Partial<ProviderDescriptor> = {},
): ProviderDescriptor {
  return parseProviderDescriptor({
    id: "local-primary",
    adapter: "openai-compatible",
    locality: "local",
    model: "local-model",
    enabled: true,
    capabilities: ["chat_completions", "streaming", "tool_calling"],
    contextWindowTokens: 32_768,
    maxOutputTokens: 8_192,
    requestReserveTokens: 512,
    accounting: { kind: "local_zero_cost" },
    ...overrides,
  });
}

function providerFor(
  descriptor: ProviderDescriptor,
): DescribedInferenceProvider {
  return {
    descriptor,
    id: descriptor.id,
    model: descriptor.model,
    costPolicy:
      descriptor.accounting.kind === "local_zero_cost"
        ? "local_zero_cost"
        : undefined,
    async complete() {
      return {
        content: "unused",
        toolCalls: [],
        finishReason: "stop",
        durationMs: 0,
      };
    },
  };
}

function meteredDescriptor(pricingVerifiedAt: string): ProviderDescriptor {
  return parseProviderDescriptor({
    id: "cloud-primary",
    adapter: "openai-compatible",
    locality: "cloud",
    model: "cloud-model",
    enabled: true,
    capabilities: ["chat_completions", "streaming"],
    contextWindowTokens: 65_536,
    maxOutputTokens: 8_192,
    requestReserveTokens: 1_024,
    accounting: {
      kind: "metered",
      inputMicrousdPerMillionTokens: 60_000,
      outputMicrousdPerMillionTokens: 120_000,
      pricingVerifiedAt,
      pricingSource: "https://provider.example/models/cloud-model",
    },
  });
}

describe("ProviderDescriptor", () => {
  it("accepts explicit local-zero-cost and metered cloud accounting", () => {
    expect(localDescriptor().accounting).toEqual({ kind: "local_zero_cost" });
    const cloud = parseProviderDescriptor({
      id: "cloud-primary",
      adapter: "openai-compatible",
      locality: "cloud",
      model: "cloud-model",
      enabled: false,
      capabilities: ["chat_completions", "streaming"],
      contextWindowTokens: 65_536,
      maxOutputTokens: 8_192,
      requestReserveTokens: 1_024,
      accounting: {
        kind: "metered",
        inputMicrousdPerMillionTokens: 60_000,
        outputMicrousdPerMillionTokens: 120_000,
        cacheReadMicrousdPerMillionTokens: 12_000,
        pricingVerifiedAt: "2026-08-29T00:00:00Z",
        pricingSource: "https://provider.example/models/cloud-model",
      },
    });
    expect(cloud.accounting.kind).toBe("metered");
  });

  it("fails closed on duplicates, missing core capabilities, and invalid limits", () => {
    const base = {
      id: "invalid",
      adapter: "openai-compatible",
      locality: "local",
      model: "model",
      enabled: true,
      contextWindowTokens: 2_048,
      maxOutputTokens: 1_024,
      requestReserveTokens: 1_024,
      accounting: { kind: "local_zero_cost" },
    };
    expect(() =>
      parseProviderDescriptor({
        ...base,
        capabilities: ["chat_completions", "streaming", "streaming"],
      }),
    ).toThrow(/sorted and unique|contextWindowTokens/u);
    expect(() =>
      parseProviderDescriptor({
        ...base,
        contextWindowTokens: 4_096,
        capabilities: ["tool_calling"],
      }),
    ).toThrow(/chat_completions|streaming/u);
    expect(() =>
      parseProviderDescriptor({
        ...base,
        locality: "cloud",
        contextWindowTokens: 4_096,
        capabilities: ["chat_completions", "streaming"],
      }),
    ).toThrow(/metered accounting/u);
  });
});

describe("ProviderRegistry", () => {
  it("sorts descriptors and resolves only enabled capable providers", () => {
    const first = localDescriptor({ id: "z-local" });
    const disabled = localDescriptor({ id: "a-disabled", enabled: false });
    const registry = new ProviderRegistry([
      { descriptor: first, provider: providerFor(first) },
      { descriptor: disabled, provider: providerFor(disabled) },
    ]);

    expect(registry.listDescriptors().map(({ id }) => id)).toEqual(["z-local"]);
    expect(
      registry.listDescriptors({ includeDisabled: true }).map(({ id }) => id),
    ).toEqual(["a-disabled", "z-local"]);
    expect(registry.getDescriptor("a-disabled")?.enabled).toBe(false);
    expect(registry.getDescriptor("missing")).toBeUndefined();
    expect(registry.require("z-local", ["tool_calling"]).provider.id).toBe(
      "z-local",
    );
    expect(() => registry.require("a-disabled")).toThrow(/disabled/u);
    expect(() =>
      registry.require("z-local", ["structured_json_schema"]),
    ).toThrow(/lacks required capabilities/u);
  });

  it("keeps one dispatch registration and a separately typed locked cloud candidate", () => {
    const config: SoarConfig = {
      providerMode: "local",
      fakeDelayMs: 0,
      vllm: {
        baseUrl: "https://local-provider.example/v1",
        apiKey: "test-local-value",
        model: "configured-local-model",
        costPolicy: "local_zero_cost",
        maxOutputTokens: 8_192,
        timeoutMs: 30_000,
      },
      limits: { inferenceRounds: 24, toolCalls: 24 },
      context: { maxInputTokens: 16_384, safetyMargin: 0.2 },
    };
    const catalog = createRuntimeProviderCatalog(config);

    expect(catalog.defaultLocalProviderId).toBe("local-vllm");
    expect(
      catalog.registry.require(catalog.defaultLocalProviderId).provider,
    ).toMatchObject({
      id: "local-vllm",
      model: "configured-local-model",
      costPolicy: "local_zero_cost",
    });
    expect(catalog.registry.listDescriptors()).toHaveLength(1);
    expect(catalog.registry.listDescriptors()[0]).toMatchObject({
      locality: "local",
      accounting: { kind: "local_zero_cost" },
    });
    expect(
      catalog.registry.listDescriptors()[0]?.capabilities,
    ).toContain("structured_json_schema");
    expect(catalog.cloudCandidates).toEqual([
      {
        candidateId: "openrouter-deepseek-v4-flash-0731",
        providerLabel: "OpenRouter",
        modelLabel: "DeepSeek V4 Flash",
        adapterFamily: "openai-compatible",
        intendedModelSlug: "deepseek/deepseek-v4-flash-0731",
      },
    ]);
    expect(
      ProviderDescriptorSchema.safeParse(catalog.cloudCandidates[0]).success,
    ).toBe(false);
    expect(
      catalog.registry.getDescriptor(catalog.cloudCandidates[0]!.candidateId),
    ).toBeUndefined();
  });

  it("keeps production bootstrap free of a cloud-provider or Hybrid constructor path", () => {
    const bootstrapSource = readFileSync(
      new URL("../../src/main/index.ts", import.meta.url),
      "utf8",
    );
    const catalogSource = readFileSync(
      new URL(
        "../../src/main/providers/runtime-catalog.ts",
        import.meta.url,
      ),
      "utf8",
    );

    expect(bootstrapSource).not.toMatch(/\bhybridRuntime\s*:/u);
    expect(bootstrapSource).not.toMatch(
      /\b(?:new|create)[A-Za-z0-9_]*(?:Cloud|OpenRouter)[A-Za-z0-9_]*Provider\b/u,
    );
    expect(catalogSource).not.toMatch(
      /\b(?:new|create)[A-Za-z0-9_]*(?:Cloud|OpenRouter)[A-Za-z0-9_]*Provider\b/u,
    );
    expect(catalogSource.match(/\bnew\s+[A-Za-z0-9_]+Provider\b/gu)).toEqual([
      "new OpenAICompatibleProvider",
      "new FakeProvider",
    ]);
  });

  it("rejects duplicate ids and mismatched implementation identity", () => {
    const descriptor = localDescriptor();
    const provider = providerFor(descriptor);
    expect(
      () =>
        new ProviderRegistry([
          { descriptor, provider },
          { descriptor, provider },
        ]),
    ).toThrow(/duplicate provider id/u);

    expect(
      () =>
        new ProviderRegistry([
          {
            descriptor,
            provider: { ...provider, model: "substituted-model" },
          },
        ]),
    ).toThrow(/identity does not match/u);

    expect(
      () =>
        new ProviderRegistry([
          {
            descriptor,
            provider: { ...provider, costPolicy: undefined },
          },
        ]),
    ).toThrow(/cost policy does not match/u);
  });

  it("requires replayable, fresh paid pricing at selection time", () => {
    const verifiedAt = "2026-08-29T00:00:00.000Z";
    const descriptor = meteredDescriptor(verifiedAt);
    const registry = new ProviderRegistry([
      { descriptor, provider: providerFor(descriptor) },
    ]);

    expect(() => registry.require(descriptor.id)).toThrow(/explicit pricing as-of/u);
    expect(
      registry.require(descriptor.id, [], {
        asOf: "2026-08-29T23:59:59.999Z",
      }).provider.id,
    ).toBe(descriptor.id);
    expect(() =>
      registry.require(descriptor.id, [], {
        asOf: "2026-08-30T00:00:00.000Z",
      }),
    ).toThrow(/stale/u);
    expect(() =>
      registry.require(descriptor.id, [], {
        asOf: "2026-08-28T23:59:59.999Z",
      }),
    ).toThrow(/future/u);
  });
});
