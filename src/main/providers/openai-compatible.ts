import OpenAI from "openai";

import type { SoarConfig } from "../config";
import { MODEL_TOOL_DEFINITIONS } from "../tools/tool-registry";
import {
  ProviderAbortedError,
  type CompleteInput,
  type InferenceProvider,
  type ProviderAbortKind,
  type ProviderResult,
  type ProviderToolCall,
} from "./types";

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

const PROVIDER_TEMPLATE_RESERVE_TOKENS = 512;

function conservativeTokenReserve(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

const WORKING_REQUEST_RESERVE_TOKENS =
  PROVIDER_TEMPLATE_RESERVE_TOKENS +
  conservativeTokenReserve({
    tools: MODEL_TOOL_DEFINITIONS,
    tool_choice: "auto",
    parallel_tool_calls: false,
  });
const FINALIZATION_REQUEST_RESERVE_TOKENS =
  PROVIDER_TEMPLATE_RESERVE_TOKENS +
  conservativeTokenReserve({
    tool_choice: "none",
    reasoning_effort: "none",
  });

export class OpenAICompatibleProvider implements InferenceProvider {
  readonly id = "local-vllm";
  readonly model: string;
  private readonly client: OpenAI;
  private readonly maxOutputTokens: number;
  private readonly timeoutMs: number;

  constructor(config: SoarConfig["vllm"]) {
    this.model = config.model;
    this.maxOutputTokens = config.maxOutputTokens;
    this.timeoutMs = config.timeoutMs;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeoutMs,
      maxRetries: 0,
    });
  }

  estimateInputTokenReserve(allowTools: boolean): number {
    const requestReserve = allowTools
      ? WORKING_REQUEST_RESERVE_TOKENS
      : FINALIZATION_REQUEST_RESERVE_TOKENS;
    return requestReserve + new TextEncoder().encode(this.model).length;
  }

  async complete({
    messages,
    signal,
    allowTools = true,
    onDelta,
  }: CompleteInput): Promise<ProviderResult> {
    const startedAt = performance.now();
    let firstTokenAt: number | undefined;
    let content = "";
    let finishReason: string | null = null;
    let usage: ProviderResult["usage"];
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
      const stream = await this.client.chat.completions.create(
        {
          model: this.model,
          messages,
          ...(allowTools
            ? {
                tools: [...MODEL_TOOL_DEFINITIONS],
                tool_choice: "auto" as const,
                parallel_tool_calls: false,
              }
            : {
                tool_choice: "none" as const,
                reasoning_effort: "none" as const,
              }),
          stream: true,
          stream_options: { include_usage: true },
          max_completion_tokens: this.maxOutputTokens,
        },
        { signal: combinedSignal },
      );

      for await (const chunk of stream) {
        if (combinedSignal.aborted) throw abortError();
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

    const normalizedToolCalls: ProviderToolCall[] = [...toolCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, call]) => ({
        id: call.id || `tool-call-${index}`,
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
      timeToFirstTokenMs: firstTokenAt === undefined ? undefined : firstTokenAt - startedAt,
      durationMs: performance.now() - startedAt,
    };
  }
}
