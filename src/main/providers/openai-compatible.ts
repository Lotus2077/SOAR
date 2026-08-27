import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

import type { SoarConfig } from "../config";
import {
  ProviderAbortedError,
  type CompleteInput,
  type InferenceProvider,
  type ProviderResult,
  type ProviderToolCall,
} from "./types";

const readTextFileTool: ChatCompletionTool = {
  type: "function",
  function: {
    name: "read_text_file",
    description: "Read one UTF-8 text file inside the user-selected workspace.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["relativePath"],
      properties: {
        relativePath: {
          type: "string",
          description: "Path relative to the selected workspace root.",
        },
      },
    },
  },
};

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

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

  async complete({ messages, signal, onDelta }: CompleteInput): Promise<ProviderResult> {
    const startedAt = performance.now();
    let firstTokenAt: number | undefined;
    let content = "";
    let finishReason: string | null = null;
    let usage: ProviderResult["usage"];
    const toolCalls = new Map<number, ToolCallAccumulator>();

    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const combinedSignal = AbortSignal.any([signal, timeoutController.signal]);

    try {
      const stream = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: messages as ChatCompletionMessageParam[],
          tools: [readTextFileTool],
          tool_choice: "auto",
          parallel_tool_calls: false,
          stream: true,
          stream_options: { include_usage: true },
          max_completion_tokens: this.maxOutputTokens,
        },
        { signal: combinedSignal },
      );

      for await (const chunk of stream) {
        if (combinedSignal.aborted) throw new ProviderAbortedError("Inference aborted", content);
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
          usage = {
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          };
        }
      }

      if (combinedSignal.aborted) {
        throw new ProviderAbortedError(
          timeoutController.signal.aborted ? "Inference timed out" : "Inference cancelled",
          content,
        );
      }
    } catch (error) {
      if (combinedSignal.aborted) {
        throw new ProviderAbortedError(
          timeoutController.signal.aborted ? "Inference timed out" : "Inference cancelled",
          content,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
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
