import { randomUUID } from "node:crypto";

import OpenAI from "openai";

import {
  selectModelToolDefinitions,
  type RegisteredToolName,
} from "../tools/tool-registry";
import {
  REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
  reviewResultV1ResponseFormat,
} from "../../shared/review-result-contract";
import {
  hasProviderCapabilities,
  parseProviderDescriptor,
  type ProviderDescriptor,
} from "./provider-descriptor";
import {
  ProviderAbortedError,
  type CompleteInput,
  type DescribedInferenceProvider,
  type ProviderAbortKind,
  type ProviderModelAvailabilityResult,
  type ProviderResult,
  type ProviderToolCall,
  type StructuredOutputContract,
} from "./types";

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

export const OPENAI_COMPATIBLE_BASE_REQUEST_RESERVE_TOKENS = 512;
export const OPENAI_COMPATIBLE_MODEL_LIST_TIMEOUT_MS = 30_000;
export const OPENAI_COMPATIBLE_MODEL_LIST_MAX_BYTES = 1024 * 1024;

export interface AdvertisedModelCapacity {
  advertisedMaxModelLen: number | null | undefined;
  configuredMaxInputTokens: number;
  maximumRequestedOutputTokens: number;
}

/**
 * vLLM advertises a total context limit. SOAR admits it only when that limit
 * covers both the full configured input allowance and the largest completion
 * the transport may request.
 */
export function assertAdvertisedModelCapacity(
  capacity: AdvertisedModelCapacity,
): void {
  if (
    !Number.isSafeInteger(capacity.configuredMaxInputTokens) ||
    capacity.configuredMaxInputTokens <= 0
  ) {
    throw new RangeError(
      "configuredMaxInputTokens must be a positive safe integer.",
    );
  }
  if (
    !Number.isSafeInteger(capacity.maximumRequestedOutputTokens) ||
    capacity.maximumRequestedOutputTokens <= 0
  ) {
    throw new RangeError(
      "maximumRequestedOutputTokens must be a positive safe integer.",
    );
  }
  const requiredMaxModelLen =
    capacity.configuredMaxInputTokens +
    capacity.maximumRequestedOutputTokens;
  if (!Number.isSafeInteger(requiredMaxModelLen)) {
    throw new RangeError(
      "The configured input and maximum output token allowances overflow the safe-integer range.",
    );
  }
  if (
    capacity.advertisedMaxModelLen === null ||
    capacity.advertisedMaxModelLen === undefined ||
    !Number.isSafeInteger(capacity.advertisedMaxModelLen) ||
    capacity.advertisedMaxModelLen <= 0
  ) {
    throw new RangeError(
      "The configured model must advertise a positive safe-integer max_model_len.",
    );
  }
  if (capacity.advertisedMaxModelLen < requiredMaxModelLen) {
    throw new RangeError(
      `The configured model advertises max_model_len ${capacity.advertisedMaxModelLen}, ` +
        `but SOAR requires at least ${requiredMaxModelLen} ` +
        `(${capacity.configuredMaxInputTokens} input + ${capacity.maximumRequestedOutputTokens} output) tokens.`,
    );
  }
}

export interface OpenAICompatibleProviderOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  descriptor: ProviderDescriptor;
}

function conservativeTokenReserve(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function modelAvailabilityResult(
  descriptor: ProviderDescriptor,
  status: ProviderModelAvailabilityResult["status"],
  code: ProviderModelAvailabilityResult["code"],
): ProviderModelAvailabilityResult {
  return Object.freeze({
    providerId: descriptor.id,
    model: descriptor.model,
    locality: descriptor.locality,
    status,
    code,
  });
}

async function readBoundedResponseBody(
  response: Response,
): Promise<string | undefined> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > OPENAI_COMPATIBLE_MODEL_LIST_MAX_BYTES
    ) {
      await response.body?.cancel();
      return undefined;
    }
  }
  if (response.body === null) return "";

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const reader = response.body.getReader();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > OPENAI_COMPATIBLE_MODEL_LIST_MAX_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function selectedToolDefinitions(
  allowedToolNames?: readonly RegisteredToolName[],
): ReturnType<typeof selectModelToolDefinitions> {
  return selectModelToolDefinitions(allowedToolNames);
}

function providerRequestFields(
  descriptor: ProviderDescriptor,
  allowTools: boolean,
  allowedToolNames?: readonly RegisteredToolName[],
  requireToolCall = false,
  structuredOutputContract?: StructuredOutputContract,
) {
  if (
    structuredOutputContract !== undefined &&
    structuredOutputContract !== REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT
  ) {
    throw new RangeError(
      `unsupported structured output contract: ${String(structuredOutputContract)}`,
    );
  }
  if (
    structuredOutputContract !== undefined &&
    (allowTools || allowedToolNames !== undefined || requireToolCall)
  ) {
    throw new RangeError(
      "structured output is mutually exclusive with provider tools",
    );
  }
  if (
    structuredOutputContract !== undefined &&
    !hasProviderCapabilities(descriptor, ["structured_json_schema"])
  ) {
    throw new Error(
      `provider ${descriptor.id} does not advertise structured_json_schema`,
    );
  }
  const tools = selectedToolDefinitions(allowedToolNames);
  const toolsEnabled = allowTools && tools.length > 0;
  const supportsToolCalling = hasProviderCapabilities(descriptor, [
    "tool_calling",
  ]);
  if (toolsEnabled && !supportsToolCalling) {
    throw new Error(
      `provider ${descriptor.id} does not advertise tool_calling`,
    );
  }
  if (
    requireToolCall &&
    (!toolsEnabled || allowedToolNames?.length !== 1 || tools.length !== 1)
  ) {
    throw new RangeError(
      "requireToolCall needs exactly one enabled scheduler-selected tool definition.",
    );
  }
  const reasoningFields = hasProviderCapabilities(descriptor, [
    "reasoning_effort",
  ])
    ? { reasoning_effort: "none" as const }
    : {};
  if (structuredOutputContract !== undefined) {
    return {
      ...reasoningFields,
      response_format: reviewResultV1ResponseFormat(),
    };
  }
  if (!toolsEnabled) {
    return supportsToolCalling
      ? { ...reasoningFields, tool_choice: "none" as const }
      : reasoningFields;
  }
  return {
    ...reasoningFields,
    tools: [...tools],
    tool_choice: requireToolCall ? ("required" as const) : ("auto" as const),
    parallel_tool_calls: false,
  };
}

function requestReserveTokens(
  descriptor: ProviderDescriptor,
  baseReserveTokens: number,
  allowTools: boolean,
  allowedToolNames?: readonly RegisteredToolName[],
  requireToolCall = false,
  structuredOutputContract?: StructuredOutputContract,
): number {
  return (
    baseReserveTokens +
    conservativeTokenReserve(
      providerRequestFields(
        descriptor,
        allowTools,
        allowedToolNames,
        requireToolCall,
        structuredOutputContract,
      ),
    )
  );
}

export class OpenAICompatibleProvider implements DescribedInferenceProvider {
  readonly descriptor: ProviderDescriptor;
  readonly id: string;
  readonly model: string;
  readonly costPolicy?: "local_zero_cost";
  private readonly client: OpenAI;
  private readonly maxOutputTokens: number;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: OpenAICompatibleProviderOptions) {
    this.descriptor = parseProviderDescriptor(config.descriptor);
    this.id = this.descriptor.id;
    this.model = this.descriptor.model;
    this.costPolicy =
      this.descriptor.accounting.kind === "local_zero_cost"
        ? "local_zero_cost"
        : undefined;
    this.maxOutputTokens = this.descriptor.maxOutputTokens;
    this.timeoutMs = config.timeoutMs;
    this.baseUrl = config.baseUrl.replace(/\/+$/u, "");
    this.apiKey = config.apiKey;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeoutMs,
      maxRetries: 0,
    });
  }

  estimateInputTokenReserve(
    allowTools: boolean,
    allowedToolNames?: RegisteredToolName[],
    requireToolCall = false,
    structuredOutputContract?: StructuredOutputContract,
  ): number {
    return (
      requestReserveTokens(
        this.descriptor,
        this.descriptor.requestReserveTokens,
        allowTools,
        allowedToolNames,
        requireToolCall,
        structuredOutputContract,
      ) +
      new TextEncoder().encode(this.model).length
    );
  }

  async checkConfiguredModelAvailability(
    signal?: AbortSignal,
  ): Promise<ProviderModelAvailabilityResult> {
    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () => timeoutController.abort(),
      OPENAI_COMPATIBLE_MODEL_LIST_TIMEOUT_MS,
    );
    const combinedSignal =
      signal === undefined
        ? timeoutController.signal
        : AbortSignal.any([signal, timeoutController.signal]);
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        redirect: "error",
        signal: combinedSignal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        return modelAvailabilityResult(
          this.descriptor,
          "unhealthy",
          "http_error",
        );
      }
      let body: string | undefined;
      try {
        body = await readBoundedResponseBody(response);
      } catch {
        return modelAvailabilityResult(
          this.descriptor,
          "unhealthy",
          "malformed_response",
        );
      }
      if (body === undefined) {
        return modelAvailabilityResult(
          this.descriptor,
          "unhealthy",
          "response_too_large",
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return modelAvailabilityResult(
          this.descriptor,
          "unhealthy",
          "malformed_response",
        );
      }
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        (parsed as { object?: unknown }).object !== "list" ||
        !Array.isArray((parsed as { data?: unknown }).data)
      ) {
        return modelAvailabilityResult(
          this.descriptor,
          "unhealthy",
          "malformed_response",
        );
      }
      const data = (parsed as { data: unknown[] }).data;
      if (
        data.some(
          (entry) =>
            entry === null ||
            typeof entry !== "object" ||
            Array.isArray(entry) ||
            typeof (entry as { id?: unknown }).id !== "string",
        )
      ) {
        return modelAvailabilityResult(
          this.descriptor,
          "unhealthy",
          "malformed_response",
        );
      }
      const matches = data.filter(
        (entry) =>
          (entry as { id: string }).id === this.descriptor.model,
      );
      if (matches.length !== 1) {
        return modelAvailabilityResult(
          this.descriptor,
          "unhealthy",
          matches.length === 0
            ? "configured_model_missing"
            : "configured_model_duplicated",
        );
      }
      const advertisedMaxModelLen = (
        matches[0] as { max_model_len?: unknown }
      ).max_model_len;
      if (
        typeof advertisedMaxModelLen !== "number" ||
        !Number.isSafeInteger(advertisedMaxModelLen) ||
        advertisedMaxModelLen <= 0
      ) {
        return modelAvailabilityResult(
          this.descriptor,
          "unhealthy",
          "configured_model_capacity_unknown",
        );
      }
      try {
        assertAdvertisedModelCapacity({
          advertisedMaxModelLen,
          configuredMaxInputTokens:
            this.descriptor.contextWindowTokens -
            this.descriptor.maxOutputTokens,
          maximumRequestedOutputTokens:
            this.descriptor.maxOutputTokens,
        });
      } catch {
        return modelAvailabilityResult(
          this.descriptor,
          "unhealthy",
          "configured_model_capacity_insufficient",
        );
      }
      return modelAvailabilityResult(
        this.descriptor,
        "healthy",
        "configured_model_available",
      );
    } catch {
      return modelAvailabilityResult(
        this.descriptor,
        "unhealthy",
        signal?.aborted
          ? "cancelled"
          : timeoutController.signal.aborted
            ? "timeout"
            : "network_error",
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async complete({
    messages,
    signal,
    requestedMaxOutputTokens = this.maxOutputTokens,
    allowTools = true,
    allowedToolNames,
    requireToolCall = false,
    structuredOutputContract,
    onDelta,
  }: CompleteInput): Promise<ProviderResult> {
    if (
      !Number.isSafeInteger(requestedMaxOutputTokens) ||
      requestedMaxOutputTokens <= 0 ||
      requestedMaxOutputTokens > this.maxOutputTokens
    ) {
      throw new RangeError(
        `requestedMaxOutputTokens must be a positive safe integer no greater than ${this.maxOutputTokens}`,
      );
    }
    const startedAt = performance.now();
    let firstTokenAt: number | undefined;
    let content = "";
    let finishReason: string | null = null;
    let usage: ProviderResult["usage"];
    let servedModel: string | undefined;
    const toolCalls = new Map<number, ToolCallAccumulator>();

    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    let firstAbortKind: ProviderAbortKind | undefined = signal.aborted
      ? "cancelled"
      : undefined;
    const markCancelled = (): void => {
      firstAbortKind ??= "cancelled";
    };
    const markTimedOut = (): void => {
      firstAbortKind ??= "timeout";
    };
    signal.addEventListener("abort", markCancelled, { once: true });
    timeoutController.signal.addEventListener("abort", markTimedOut, { once: true });
    const combinedSignal = AbortSignal.any([signal, timeoutController.signal]);
    const abortError = (): ProviderAbortedError => {
      const timedOut = firstAbortKind === "timeout";
      return new ProviderAbortedError(
        timedOut ? "Inference timed out" : "Inference cancelled",
        content,
        timedOut ? "timeout" : "cancelled",
      );
    };

    try {
      const requestFields = providerRequestFields(
        this.descriptor,
        allowTools,
        allowedToolNames,
        requireToolCall,
        structuredOutputContract,
      );
      const stream = await this.client.chat.completions.create(
        {
          model: this.model,
          messages,
          ...requestFields,
          stream: true,
          stream_options: { include_usage: true },
          max_completion_tokens: requestedMaxOutputTokens,
        },
        { signal: combinedSignal },
      );

      for await (const chunk of stream) {
        if (combinedSignal.aborted) throw abortError();
        if (chunk.model) {
          if (chunk.model !== this.model) {
            throw new Error(
              `Provider served unexpected model (${chunk.model}; requested ${this.model}).`,
            );
          }
          if (servedModel !== undefined && servedModel !== chunk.model) {
            throw new Error(
              `Provider changed served model within one response (${servedModel} -> ${chunk.model}).`,
            );
          }
          servedModel = chunk.model;
        }
        const choice = chunk.choices[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;

        const delta = choice?.delta;
        if (typeof delta?.content === "string" && delta.content.length > 0) {
          firstTokenAt ??= performance.now();
          content += delta.content;
          onDelta(delta.content);
        }

        for (const fragment of delta?.tool_calls ?? []) {
          firstTokenAt ??= performance.now();
          const index = fragment.index;
          const current = toolCalls.get(index) ?? { id: "", name: "", arguments: "" };
          if (fragment.id) current.id += fragment.id;
          if (fragment.function?.name) current.name += fragment.function.name;
          if (fragment.function?.arguments) current.arguments += fragment.function.arguments;
          toolCalls.set(index, current);
        }

        if (chunk.usage) {
          const reasoningTokens =
            chunk.usage.completion_tokens_details?.reasoning_tokens ?? 0;
          usage = {
            inputTokens: chunk.usage.prompt_tokens,
            ...(chunk.usage.prompt_tokens_details?.cached_tokens === undefined
              ? {}
              : {
                  cacheReadTokens:
                    chunk.usage.prompt_tokens_details.cached_tokens,
                }),
            outputTokens: Math.max(
              0,
              chunk.usage.completion_tokens - reasoningTokens,
            ),
            totalTokens: chunk.usage.total_tokens,
            reasoningTokens,
          };
        }
      }

      if (combinedSignal.aborted) {
        throw abortError();
      }
    } catch (error) {
      if (combinedSignal.aborted) {
        throw abortError();
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", markCancelled);
      timeoutController.signal.removeEventListener("abort", markTimedOut);
    }

    const fallbackToolCallRequestId = randomUUID();
    const normalizedToolCalls: ProviderToolCall[] = [...toolCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, call]) => ({
        id: call.id || `tool-call-${fallbackToolCallRequestId}-${index}`,
        type: "function",
        function: {
          name: call.name,
          arguments: call.arguments,
        },
      }));

    return {
      content,
      toolCalls: normalizedToolCalls,
      finishReason,
      usage,
      ...(servedModel === undefined ? {} : { servedModel }),
      timeToFirstTokenMs: firstTokenAt === undefined ? undefined : firstTokenAt - startedAt,
      durationMs: performance.now() - startedAt,
    };
  }
}
