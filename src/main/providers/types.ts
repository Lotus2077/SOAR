import type {
  ProviderContextMessage,
  ProviderToolCall as ContextProviderToolCall,
} from "../../shared/context-builder";

export type ProviderToolCall = ContextProviderToolCall;

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

export type ProviderMessage = ProviderContextMessage;

export interface CompleteInput {
  messages: ProviderMessage[];
  signal: AbortSignal;
  allowTools?: boolean;
  onDelta(delta: string): void;
}

export interface InferenceProvider {
  readonly id: string;
  readonly model: string;
  /** Conservative allowance for adapter-owned request fields outside messages. */
  estimateInputTokenReserve?(allowTools: boolean): number;
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
