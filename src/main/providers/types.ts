export interface ProviderToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ProviderUsage {
  inputTokens: number;
  /** Visible completion tokens, excluding reasoning tokens when reported separately. */
  outputTokens: number;
  totalTokens: number;
  /** Hidden reasoning tokens reported by the provider. */
  reasoningTokens?: number;
}

export interface ProviderResult {
  content: string;
  toolCalls: ProviderToolCall[];
  finishReason: string | null;
  usage?: ProviderUsage;
  timeToFirstTokenMs?: number;
  durationMs: number;
}

export interface ProviderMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ProviderToolCall[];
}

export interface CompleteInput {
  messages: ProviderMessage[];
  signal: AbortSignal;
  allowTools?: boolean;
  onDelta(delta: string): void;
}

export interface InferenceProvider {
  readonly id: string;
  readonly model: string;
  complete(input: CompleteInput): Promise<ProviderResult>;
}

export type ProviderAbortKind = "cancelled" | "timeout";

export class ProviderAbortedError extends Error {
  constructor(
    message: string,
    readonly partialContent: string,
    readonly abortKind: ProviderAbortKind = "cancelled",
  ) {
    super(message);
    this.name = "ProviderAbortedError";
  }
}
