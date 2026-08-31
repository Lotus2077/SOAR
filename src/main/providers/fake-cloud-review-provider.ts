import {
  REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
} from "../../shared/review-result-contract";
import { parseProviderDescriptor } from "./provider-descriptor";
import {
  deterministicFakeReviewResultV1,
  extractFakeReviewSynthesisPacketV1,
} from "./fake-review-synthesis";
import {
  ProviderAbortedError,
  type CompleteInput,
  type DescribedInferenceProvider,
  type ProviderModelAvailabilityResult,
  type ProviderResult,
} from "./types";

export const FAKE_CLOUD_REVIEW_PROVIDER_ID = "fake-cloud-review";
export const FAKE_CLOUD_REVIEW_MODEL =
  "Fake Cloud Review v1 (deterministic test double)";

export const FAKE_CLOUD_INPUT_MICROUSD_PER_MILLION_TOKENS = 1_000_000;
export const FAKE_CLOUD_OUTPUT_MICROUSD_PER_MILLION_TOKENS = 4_000_000;

const FAKE_CLOUD_REVIEW_PROVIDER_V1 = Symbol(
  "soar.fake-cloud-review-provider-v1",
);
const FAKE_CLOUD_REVIEW_PROVIDERS_V1 = new WeakSet<object>();

export type FakeCloudReviewScenarioV1 =
  | "success"
  | "provider_error"
  | "invalid_json"
  | "schema_invalid"
  | "model_mismatch"
  | "usage_missing"
  | "usage_invalid"
  | "cost_overrun"
  | "finish_length"
  | "tool_call_protocol";

export interface FakeCloudReviewProviderOptionsV1 {
  /** Synthetic pricing fact only; never a provider or network configuration. */
  pricingVerifiedAt: string;
  delayMs?: number;
  /** Deterministic test seam. Production simulation construction uses success. */
  scenario?: FakeCloudReviewScenarioV1;
  /** Test-only signal that the in-process invocation has begun. */
  onInvocationStarted?: () => void;
}

function waitForDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(
      new ProviderAbortedError("Fake cloud inference cancelled", ""),
    );
  }
  if (delayMs === 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(new ProviderAbortedError("Fake cloud inference cancelled", ""));
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

class FakeCloudReviewProviderV1 implements DescribedInferenceProvider {
  readonly [FAKE_CLOUD_REVIEW_PROVIDER_V1] = true as const;
  readonly id = FAKE_CLOUD_REVIEW_PROVIDER_ID;
  readonly model = FAKE_CLOUD_REVIEW_MODEL;
  readonly descriptor;
  private readonly delayMs: number;
  private readonly scenario: FakeCloudReviewScenarioV1;
  private readonly onInvocationStarted?: () => void;

  constructor(options: FakeCloudReviewProviderOptionsV1) {
    FAKE_CLOUD_REVIEW_PROVIDERS_V1.add(this);
    this.delayMs = options.delayMs ?? 12;
    if (!Number.isSafeInteger(this.delayMs) || this.delayMs < 0) {
      throw new RangeError("fake cloud delay must be a non-negative safe integer");
    }
    this.scenario = options.scenario ?? "success";
    this.onInvocationStarted = options.onInvocationStarted;
    this.descriptor = parseProviderDescriptor({
      id: this.id,
      adapter: "openai-compatible",
      locality: "cloud",
      model: this.model,
      enabled: true,
      capabilities: [
        "chat_completions",
        "streaming",
        "structured_json_schema",
      ],
      contextWindowTokens: 32_768,
      maxOutputTokens: 8_192,
      requestReserveTokens: 512,
      accounting: {
        kind: "metered",
        inputMicrousdPerMillionTokens:
          FAKE_CLOUD_INPUT_MICROUSD_PER_MILLION_TOKENS,
        outputMicrousdPerMillionTokens:
          FAKE_CLOUD_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
        pricingVerifiedAt: options.pricingVerifiedAt,
        pricingSource: "https://localhost.invalid/soar/fake-cloud-pricing-v1",
      },
    });
  }

  async checkConfiguredModelAvailability(
    signal?: AbortSignal,
  ): Promise<ProviderModelAvailabilityResult> {
    return {
      providerId: this.id,
      model: this.model,
      locality: "cloud",
      status: signal?.aborted ? "unhealthy" : "healthy",
      code: signal?.aborted ? "cancelled" : "configured_model_available",
    };
  }

  async complete(input: CompleteInput): Promise<ProviderResult> {
    if (
      input.structuredOutputContract !==
      REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT ||
      input.allowTools !== false ||
      input.allowedToolNames !== undefined ||
      input.requireToolCall === true
    ) {
      throw new RangeError(
        "The fake cloud review provider accepts only tool-free ReviewResultV1 synthesis.",
      );
    }

    const startedAt = performance.now();
    this.onInvocationStarted?.();
    await waitForDelay(this.delayMs, input.signal);
    if (this.scenario === "provider_error") {
      throw new Error("Deterministic fake cloud provider failure");
    }
    const packet = extractFakeReviewSynthesisPacketV1(input.messages);
    const validContent = deterministicFakeReviewResultV1(packet);
    const content =
      this.scenario === "invalid_json"
        ? "{invalid"
        : this.scenario === "schema_invalid"
          ? "{}"
          : validContent;
    const usage =
      this.scenario === "usage_missing"
        ? undefined
        : this.scenario === "usage_invalid"
          ? { inputTokens: 320, outputTokens: 160, totalTokens: 999 }
          : { inputTokens: 320, outputTokens: 160, totalTokens: 480 };
    return {
      content,
      toolCalls:
        this.scenario === "tool_call_protocol"
          ? [
              {
                id: "fake-cloud-forbidden-tool-call",
                type: "function",
                function: { name: "read_text_file", arguments: "{}" },
              },
            ]
          : [],
      finishReason: this.scenario === "finish_length" ? "length" : "stop",
      ...(usage === undefined ? {} : { usage }),
      servedModel:
        this.scenario === "model_mismatch"
          ? "Fake Cloud Review unexpected model"
          : this.model,
      costUsd: this.scenario === "cost_overrun" ? 1 : 0.00096,
      timeToFirstTokenMs: Math.min(1, this.delayMs),
      durationMs: performance.now() - startedAt,
    };
  }
}

export function createFakeCloudReviewProviderV1(
  options: FakeCloudReviewProviderOptionsV1,
): DescribedInferenceProvider {
  return new FakeCloudReviewProviderV1(options);
}

export function isFakeCloudReviewProviderV1(
  provider: DescribedInferenceProvider,
): boolean {
  return FAKE_CLOUD_REVIEW_PROVIDERS_V1.has(provider);
}
