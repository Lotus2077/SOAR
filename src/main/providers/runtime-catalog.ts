import type { SoarConfig } from "../config";
import { FakeProvider } from "./fake-provider";
import {
  OPENAI_COMPATIBLE_BASE_REQUEST_RESERVE_TOKENS,
  OpenAICompatibleProvider,
} from "./openai-compatible";
import { parseProviderDescriptor, type ProviderDescriptor } from "./provider-descriptor";
import { ProviderRegistry } from "./provider-registry";
import type { DescribedInferenceProvider } from "./types";
import {
  LOCKED_CLOUD_PROVIDER_CANDIDATES,
} from "./cloud-provider-candidate";
import type { CloudCandidateMetadata } from "../../shared/cloud-setup-contracts";

export function createLocalVllmDescriptor(config: SoarConfig): ProviderDescriptor {
  return parseProviderDescriptor({
    id: "local-vllm",
    adapter: "openai-compatible",
    locality: "local",
    model: config.vllm.model,
    enabled: true,
    capabilities: [
      "chat_completions",
      "reasoning_effort",
      "streaming",
      "structured_json_schema",
      "tool_calling",
    ],
    contextWindowTokens:
      config.context.maxInputTokens + config.vllm.maxOutputTokens,
    maxOutputTokens: config.vllm.maxOutputTokens,
    requestReserveTokens: OPENAI_COMPATIBLE_BASE_REQUEST_RESERVE_TOKENS,
    accounting: { kind: config.vllm.costPolicy },
  });
}

export function createLocalVllmProvider(
  config: SoarConfig,
): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    baseUrl: config.vllm.baseUrl,
    apiKey: config.vllm.apiKey,
    timeoutMs: config.vllm.timeoutMs,
    descriptor: createLocalVllmDescriptor(config),
  });
}

export interface RuntimeProviderCatalog {
  registry: ProviderRegistry;
  defaultLocalProviderId: string;
  /** Metadata-only candidates; never dispatch registrations in PR6A. */
  cloudCandidates: readonly CloudCandidateMetadata[];
}

/**
 * Production constructs one local or fake provider only. PR6A exposes a
 * separately typed locked candidate for setup UI, never a cloud provider.
 */
export function createRuntimeProviderCatalog(
  config: SoarConfig,
): RuntimeProviderCatalog {
  const selected: DescribedInferenceProvider =
    config.providerMode === "fake"
      ? new FakeProvider({ delayMs: config.fakeDelayMs })
      : createLocalVllmProvider(config);
  const registry = new ProviderRegistry([
    { descriptor: selected.descriptor, provider: selected },
  ]);
  return {
    registry,
    defaultLocalProviderId: selected.id,
    cloudCandidates: LOCKED_CLOUD_PROVIDER_CANDIDATES,
  };
}
