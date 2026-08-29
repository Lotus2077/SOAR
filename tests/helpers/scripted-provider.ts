import {
  parseProviderDescriptor,
  type ProviderDescriptor,
} from "../../src/main/providers/provider-descriptor";
import { FAKE_ONLY_PROVIDER_V0 } from "../../src/main/agent/run-session-v2";
import type {
  CompleteInput,
  DescribedInferenceProvider,
  ProviderMessage,
  ProviderResult,
} from "../../src/main/providers/types";

export interface CapturedProviderInput {
  messages: ProviderMessage[];
  requestedMaxOutputTokens?: number;
  allowTools?: boolean;
  allowedToolNames?: CompleteInput["allowedToolNames"];
  requireToolCall?: boolean;
}

export type ScriptedProviderStep = (
  input: CompleteInput,
  call: number,
) => ProviderResult | Promise<ProviderResult>;

export class ScriptedProvider implements DescribedInferenceProvider {
  readonly [FAKE_ONLY_PROVIDER_V0] = true as const;
  readonly id: string;
  readonly model: string;
  readonly costPolicy?: "local_zero_cost";
  readonly inputs: CapturedProviderInput[] = [];
  private nextStep = 0;

  constructor(
    readonly descriptor: ProviderDescriptor,
    private readonly steps: readonly ScriptedProviderStep[],
    private readonly inputTokenReserve = descriptor.requestReserveTokens,
  ) {
    this.id = descriptor.id;
    this.model = descriptor.model;
    this.costPolicy =
      descriptor.accounting.kind === "local_zero_cost"
        ? "local_zero_cost"
        : undefined;
  }

  estimateInputTokenReserve(): number {
    return this.inputTokenReserve;
  }

  async complete(input: CompleteInput): Promise<ProviderResult> {
    const call = this.nextStep;
    const step = this.steps[call];
    if (!step) {
      throw new Error(`Unexpected scripted provider call ${call + 1} for ${this.id}`);
    }
    this.nextStep += 1;
    this.inputs.push({
      messages: structuredClone(input.messages),
      ...(input.requestedMaxOutputTokens === undefined
        ? {}
        : { requestedMaxOutputTokens: input.requestedMaxOutputTokens }),
      ...(input.allowTools === undefined
        ? {}
        : { allowTools: input.allowTools }),
      ...(input.allowedToolNames === undefined
        ? {}
        : { allowedToolNames: [...input.allowedToolNames] }),
      ...(input.requireToolCall === undefined
        ? {}
        : { requireToolCall: input.requireToolCall }),
    });
    return step(input, call + 1);
  }
}

export function localScriptedDescriptor(
  overrides: Partial<ProviderDescriptor> = {},
): ProviderDescriptor {
  return parseProviderDescriptor({
    id: "fake-local",
    adapter: "openai-compatible",
    locality: "local",
    model: "fake-local-model",
    enabled: true,
    capabilities: ["chat_completions", "streaming", "tool_calling"],
    contextWindowTokens: 16_384,
    maxOutputTokens: 1_024,
    requestReserveTokens: 128,
    accounting: { kind: "local_zero_cost" },
    ...overrides,
  });
}

export function cloudScriptedDescriptor(
  overrides: Partial<ProviderDescriptor> = {},
): ProviderDescriptor {
  return parseProviderDescriptor({
    id: "fake-cloud",
    adapter: "openai-compatible",
    locality: "cloud",
    model: "fake-cloud-model",
    enabled: true,
    capabilities: ["chat_completions", "streaming"],
    contextWindowTokens: 32_768,
    maxOutputTokens: 2_048,
    requestReserveTokens: 256,
    accounting: {
      kind: "metered",
      inputMicrousdPerMillionTokens: 1_000,
      outputMicrousdPerMillionTokens: 2_000,
      pricingVerifiedAt: "2026-08-29T00:00:00.000Z",
      pricingSource: "https://example.invalid/fake-cloud-pricing",
    },
    ...overrides,
  });
}
