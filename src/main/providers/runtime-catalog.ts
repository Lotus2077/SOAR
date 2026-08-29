import type { SoarConfig } from "../config";
import { FakeProvider } from "./fake-provider";
import {
  OPENAI_COMPATIBLE_BASE_REQUEST_RESERVE_TOKENS,
  OpenAICompatibleProvider,
} from "./openai-compatible";
import { parseProviderDescriptor, type ProviderDescriptor } from "./provider-descriptor";
import { ProviderRegistry } from "./provider-registry";
import type { DescribedInferenceProvider } from "./types";

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
  selected: DescribedInferenceProvider;
}

/**
 * PR 2 intentionally constructs one local or fake provider only. Cloud
 * construction is approval-gated and does not exist in this catalog.
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
  return { registry, selected };
}
