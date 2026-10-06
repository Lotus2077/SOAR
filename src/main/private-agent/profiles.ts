/**
 * Coordinator profiles: the single source of truth for the local model's output
 * limit, thinking mode, request timeout and request body cap, and for the task
 * budgets the desktop applies. "standard" is the September desktop configuration
 * that every earlier result was measured under; "heavy" follows the model vendor's
 * guidance for agentic work (thinking on, long outputs) within the measured
 * serving limits. Ceilings in the runtime schemas sit above both.
 */

export type CoordinatorProfileName = "standard" | "heavy";

export interface CoordinatorModelProfile {
  thinking: "disabled" | "medium";
  maxOutputTokens: number;
  /** Per-request transport timeout. The measured remote cut for one long request was about 947 s. */
  requestTimeoutMs: number;
  /**
   * Request body cap in bytes. At a conservative 3 bytes per token this plus
   * maxOutputTokens stays under the 262,144-token context window, which is how the
   * plan's token-estimate guard is implemented.
   */
  maxRequestBytes: number;
  /** Vendor sampling for thinking mode; absent keeps the server defaults. */
  sampling?: { temperature: number; top_p: number; top_k: number };
}

export interface GeneralTaskBudget {
  modelCalls: number;
  toolCalls: number;
  elapsedMs: number;
  /** Broker request allowance shared by every phase of the session (model calls plus public fetches). */
  sessionRequests: number;
}

export const COORDINATOR_PROFILES: Readonly<Record<CoordinatorProfileName, Readonly<CoordinatorModelProfile>>> = Object.freeze({
  standard: Object.freeze({ thinking: "disabled", maxOutputTokens: 4096, requestTimeoutMs: 300_000, maxRequestBytes: 192 * 1024 }),
  heavy: Object.freeze({ thinking: "medium", maxOutputTokens: 16_384, requestTimeoutMs: 900_000, maxRequestBytes: 640 * 1024,
    sampling: Object.freeze({ temperature: 1, top_p: 0.95, top_k: 20 }) }),
});

export const GENERAL_TASK_BUDGETS: Readonly<Record<CoordinatorProfileName, Readonly<GeneralTaskBudget>>> = Object.freeze({
  standard: Object.freeze({ modelCalls: 20, toolCalls: 30, elapsedMs: 900_000, sessionRequests: 40 }),
  heavy: Object.freeze({ modelCalls: 80, toolCalls: 120, elapsedMs: 5_400_000, sessionRequests: 200 }),
});

export const DEFAULT_COORDINATOR_PROFILE: CoordinatorProfileName = "heavy";

export function isCoordinatorProfileName(value: unknown): value is CoordinatorProfileName {
  return value === "standard" || value === "heavy";
}
