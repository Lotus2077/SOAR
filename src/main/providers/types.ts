import type {
  ProviderContextMessage,
  ProviderToolCall as ContextProviderToolCall,
} from "../../shared/context-builder";
import type {
  REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
} from "../../shared/review-result-contract";
import type { RegisteredToolName } from "../tools/tool-registry";
import type { ProviderDescriptor } from "./provider-descriptor";

export type ProviderToolCall = ContextProviderToolCall;
export type StructuredOutputContract =
  typeof REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT;

export interface ProviderUsage {
  inputTokens: number;
  /** Input tokens served from a provider cache when the transport reports them. */
  cacheReadTokens?: number;
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

export interface ProviderModelAvailabilityResult {
  providerId: string;
  model: string;
  locality: "local" | "cloud";
  status: "healthy" | "unhealthy";
  code:
    | "configured_model_available"
    | "configured_model_missing"
    | "configured_model_duplicated"
    | "http_error"
    | "response_too_large"
    | "malformed_response"
    | "cancelled"
    | "timeout"
    | "network_error";
}

export type ProviderMessage = ProviderContextMessage;

export interface CompleteInput {
  messages: ProviderMessage[];
  signal: AbortSignal;
  /** Exact persisted output allowance for this attempt. V1 callers may omit it. */
  requestedMaxOutputTokens?: number;
  allowTools?: boolean;
  /** When supplied, expose only this deterministic subset of workspace tools. */
  allowedToolNames?: RegisteredToolName[];
  /** Require the sole scheduler-selected tool instead of returning text. */
  requireToolCall?: boolean;
  /** Select one fixed, host-owned structured-output contract. */
  structuredOutputContract?: StructuredOutputContract;
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
    requireToolCall?: boolean,
    structuredOutputContract?: StructuredOutputContract,
  ): number;
  /** Bounded model-list discovery only; it must never perform inference. */
  checkConfiguredModelAvailability?(
    signal?: AbortSignal,
  ): Promise<ProviderModelAvailabilityResult>;
  complete(input: CompleteInput): Promise<ProviderResult>;
}

export interface DescribedInferenceProvider extends InferenceProvider {
  readonly descriptor: ProviderDescriptor;
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
