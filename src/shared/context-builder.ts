import type { JsonValue, StoredSessionEvent } from "./session-events";
import {
  replaySession,
  type CanonicalMessage,
  type SessionState,
} from "./session-reducer";

export interface ProviderToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export type ProviderContextMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: ProviderToolCall[];
    }
  | {
      role: "tool";
      content: string;
      tool_call_id: string;
    };

export interface BuildProviderContextOptions {
  systemPrompt?: string;
  includeIncompleteAssistant?: boolean;
}

function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

function convertMessage(
  message: CanonicalMessage,
  includeIncompleteAssistant: boolean,
): ProviderContextMessage | undefined {
  if (message.role === "user") {
    return { role: "user", content: message.content };
  }
  if (message.role === "tool") {
    if (!message.toolCallId) {
      return undefined;
    }
    return {
      role: "tool",
      content: message.content,
      tool_call_id: message.toolCallId,
    };
  }
  if (message.status !== "completed" && !includeIncompleteAssistant) {
    return undefined;
  }

  const toolCalls = message.toolCalls?.map((toolCall) => ({
    id: toolCall.id,
    type: "function" as const,
    function: {
      name: toolCall.name,
      arguments: stableJson(toolCall.arguments),
    },
  }));

  return {
    role: "assistant",
    content: message.content || null,
    ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
}

export function buildProviderContext(
  source: SessionState | readonly StoredSessionEvent[],
  options: BuildProviderContextOptions = {},
): ProviderContextMessage[] {
  const state = Array.isArray(source)
    ? replaySession(source)
    : (source as SessionState);
  const messages: ProviderContextMessage[] = [];

  if (options.systemPrompt) {
    messages.push({ role: "system", content: options.systemPrompt });
  }

  for (const message of state.messages) {
    const converted = convertMessage(
      message,
      options.includeIncompleteAssistant ?? false,
    );
    if (converted) {
      messages.push(converted);
    }
  }

  return messages;
}
