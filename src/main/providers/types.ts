import type {
  ProviderContextMessage,
  ProviderToolCall as ContextProviderToolCall,
} from "../../shared/context-builder";
import type { RegisteredToolName } from "../tools/tool-registry";

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
  /** Model identifier observed in the provider response, not only requested. */
  servedModel?: string;
  /** Provider-reported request cost when the transport supplies it. */
  costUsd?: number;
  timeToFirstTokenMs?: number;
  durationMs: number;
}

export type ProviderMessage = ProviderContextMessage;

export interface CompleteInput {
  messages: ProviderMessage[];
  signal: AbortSignal;
  allowTools?: boolean;
  /** When supplied, expose only this deterministic subset of workspace tools. */
  allowedToolNames?: RegisteredToolName[];
  onDelta(delta: string): void;
}

export interface InferenceProvider {
  readonly id: string;
  readonly model: string;
  /** Explicit provenance for zero cost when the provider does not report money. */
  readonly costPolicy?: "local_zero_cost";
  /** Conservative allowance for adapter-owned request fields outside messages. */
  estimateInputTokenReserve?(
    allowTools: boolean,
    allowedToolNames?: RegisteredToolName[],
  ): number;
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
