import { randomUUID } from "node:crypto";

import OpenAI from "openai";

import {
  MODEL_TOOL_DEFINITIONS,
  type RegisteredToolName,
} from "../tools/tool-registry";
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
  type ProviderResult,
  type ProviderToolCall,
} from "./types";

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

export const OPENAI_COMPATIBLE_BASE_REQUEST_RESERVE_TOKENS = 512;

export interface OpenAICompatibleProviderOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  descriptor: ProviderDescriptor;
}

function conservativeTokenReserve(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function selectedToolDefinitions(
  allowedToolNames?: readonly RegisteredToolName[],
): typeof MODEL_TOOL_DEFINITIONS {
  if (allowedToolNames === undefined) return MODEL_TOOL_DEFINITIONS;
  const allowed = new Set<string>(allowedToolNames);
  return Object.freeze(
    MODEL_TOOL_DEFINITIONS.filter((definition) =>
      definition.type === "function" &&
      allowed.has(definition.function.name),
    ),
  );
}

function providerRequestFields(
  descriptor: ProviderDescriptor,
  allowTools: boolean,
  allowedToolNames?: readonly RegisteredToolName[],
  requireToolCall = false,
) {
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
): number {
  return (
    baseReserveTokens +
    conservativeTokenReserve(
      providerRequestFields(
        descriptor,
        allowTools,
        allowedToolNames,
        requireToolCall,
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

  constructor(config: OpenAICompatibleProviderOptions) {
    this.descriptor = parseProviderDescriptor(config.descriptor);
    if (
      hasProviderCapabilities(this.descriptor, ["structured_json_schema"])
    ) {
      throw new Error(
        "structured_json_schema cannot be advertised before the adapter implements and proves it",
      );
    }
    this.id = this.descriptor.id;
    this.model = this.descriptor.model;
    this.costPolicy =
      this.descriptor.accounting.kind === "local_zero_cost"
        ? "local_zero_cost"
        : undefined;
    this.maxOutputTokens = this.descriptor.maxOutputTokens;
    this.timeoutMs = config.timeoutMs;
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
  ): number {
    return (
      requestReserveTokens(
        this.descriptor,
        this.descriptor.requestReserveTokens,
        allowTools,
        allowedToolNames,
        requireToolCall,
      ) +
      new TextEncoder().encode(this.model).length
    );
  }

  async complete({
    messages,
    signal,
    requestedMaxOutputTokens = this.maxOutputTokens,
    allowTools = true,
    allowedToolNames,
    requireToolCall = false,
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
