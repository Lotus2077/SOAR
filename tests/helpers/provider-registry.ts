import {
  parseProviderDescriptor,
  type ProviderDescriptor,
} from "../../src/main/providers/provider-descriptor";
import { ProviderRegistry } from "../../src/main/providers/provider-registry";
import type {
  DescribedInferenceProvider,
  InferenceProvider,
} from "../../src/main/providers/types";

export interface TestProviderRegistryOptions {
  descriptor?: Partial<ProviderDescriptor>;
}

/**
 * Wraps a focused provider test double in the same descriptor/registry
 * admission boundary used by the production runner.
 */
export function createTestProviderRegistry(
  provider: InferenceProvider,
  options: TestProviderRegistryOptions = {},
): { providerRegistry: ProviderRegistry; defaultLocalProviderId: string } {
  const descriptor = parseProviderDescriptor({
    id: provider.id,
    adapter: "openai-compatible",
    locality: "local",
    model: provider.model,
    enabled: true,
    capabilities: ["chat_completions", "streaming", "tool_calling"],
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_536,
    requestReserveTokens: 0,
    accounting: { kind: "local_zero_cost" },
    ...options.descriptor,
  });
  const described: DescribedInferenceProvider = {
    descriptor,
    id: descriptor.id,
    model: descriptor.model,
    costPolicy: "local_zero_cost",
    ...(provider.estimateInputTokenReserve === undefined
      ? {}
      : {
          estimateInputTokenReserve: (
            allowTools,
            allowedToolNames,
            requireToolCall,
          ) =>
            provider.estimateInputTokenReserve?.(
              allowTools,
              allowedToolNames,
              requireToolCall,
            ) ?? 0,
        }),
    complete: (input) => provider.complete(input),
  };
  return {
    providerRegistry: new ProviderRegistry([
      { descriptor, provider: described },
    ]),
    defaultLocalProviderId: descriptor.id,
  };
}
