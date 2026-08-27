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
  outputTokens: number;
  totalTokens: number;
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
  onDelta(delta: string): void;
}

export interface InferenceProvider {
  readonly id: string;
  readonly model: string;
  complete(input: CompleteInput): Promise<ProviderResult>;
}

export class ProviderAbortedError extends Error {
  constructor(
    message: string,
    readonly partialContent: string,
  ) {
    super(message);
    this.name = "ProviderAbortedError";
  }
}
