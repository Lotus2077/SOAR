import { randomUUID } from "node:crypto";

import { buildProviderContext } from "../../shared/context-builder";
import type { JsonValue, SessionEventData } from "../../shared/session-events";
import type { SoarConfig } from "../config";
import { EventStore } from "../event-store";
import {
  ProviderAbortedError,
  type InferenceProvider,
  type ProviderMessage,
  type ProviderToolCall,
} from "../providers/types";
import { assignLocalRoute } from "../routing/local-router";
import { executeToolCall } from "../tools/tool-gateway";

export type RuntimeUpdate =
  | { sessionId: string; kind: "persisted" }
  | { sessionId: string; kind: "stream"; delta: string };

export interface SessionRunnerOptions {
  store: EventStore;
  provider: InferenceProvider;
  limits: SoarConfig["limits"];
  onUpdate?: (update: RuntimeUpdate) => void;
}

const SYSTEM_PROMPT = `You are the local execution model inside SOAR.
Work only from the user-visible conversation and tool results supplied to you.
Use read_text_file when the task requires file contents. It accepts only a workspace-relative path.
Do not claim to have read a file unless a tool result confirms it.
Never reveal private chain-of-thought. Return a concise, useful answer and mention any unresolved limitation.`;

function parseToolArguments(value: string): JsonValue {
  try {
    const parsed = JSON.parse(value) as JsonValue;
    return parsed === undefined ? value : parsed;
  } catch {
    return value;
  }
}

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "The local run failed for an unknown reason.";
  const withoutSecrets = error.message.replace(/sk-[A-Za-z0-9_-]{12,}/gu, "[redacted]");
  return withoutSecrets.slice(0, 2_000) || "The local run failed.";
}

export class SessionRunner {
  private readonly store: EventStore;
  private readonly provider: InferenceProvider;
  private readonly limits: SoarConfig["limits"];
  private readonly onUpdate?: (update: RuntimeUpdate) => void;
  private readonly controllers = new Map<string, AbortController>();
  private readonly promises = new Map<string, Promise<void>>();

  constructor(options: SessionRunnerOptions) {
    this.store = options.store;
    this.provider = options.provider;
    this.limits = options.limits;
    this.onUpdate = options.onUpdate;
  }

  isRunning(sessionId: string): boolean {
    return this.controllers.has(sessionId);
  }

  startSession(sessionId: string): Promise<void> {
    const active = this.promises.get(sessionId);
    if (active) return active;

    const session = this.store.requireSession(sessionId);
    if (session.status !== "created") {
      throw new Error(`Session ${sessionId} cannot start from status ${session.status}.`);
    }

    const controller = new AbortController();
    this.controllers.set(sessionId, controller);
    const promise = this.run(sessionId, controller)
      .catch(() => {
        // run() always persists a terminal failure before rejecting is suppressed.
      })
      .finally(() => {
        this.controllers.delete(sessionId);
        this.promises.delete(sessionId);
      });
    this.promises.set(sessionId, promise);
    return promise;
  }

  cancelSession(sessionId: string): void {
    const controller = this.controllers.get(sessionId);
    if (controller) {
      controller.abort();
      return;
    }

    const session = this.store.requireSession(sessionId);
    if (session.status === "created") {
      this.append(sessionId, {
        type: "session.cancelled",
        payload: { reason: "Cancelled before inference started." },
      });
    }
  }

  private append(sessionId: string, event: SessionEventData): void {
    this.store.append(sessionId, event);
    this.onUpdate?.({ sessionId, kind: "persisted" });
  }

  private appendMany(sessionId: string, events: SessionEventData[]): void {
    this.store.appendMany(sessionId, events);
    this.onUpdate?.({ sessionId, kind: "persisted" });
  }

  private async run(sessionId: string, controller: AbortController): Promise<void> {
    const route = assignLocalRoute(this.provider);
    let currentMessageId: string | undefined;
    let currentPartial = "";
    let completedCurrentMessage = false;
    let totalToolCalls = 0;

    try {
      this.appendMany(sessionId, [
        { type: "session.started", payload: {} },
        { type: "route.assigned", payload: route },
      ]);

      for (let round = 0; round < this.limits.inferenceRounds; round += 1) {
        if (controller.signal.aborted) throw new ProviderAbortedError("Inference cancelled", "");

        currentMessageId = randomUUID();
        currentPartial = "";
        completedCurrentMessage = false;
        this.append(sessionId, {
          type: "assistant.message.started",
          payload: {
            messageId: currentMessageId,
            providerId: route.providerId,
            model: route.model,
          },
        });

        const context = buildProviderContext(this.store.getProjectedState(sessionId), {
          systemPrompt: SYSTEM_PROMPT,
        }) as ProviderMessage[];
        const result = await this.provider.complete({
          messages: context,
          signal: controller.signal,
          onDelta: (delta) => {
            if (controller.signal.aborted) return;
            currentPartial += delta;
            this.onUpdate?.({ sessionId, kind: "stream", delta });
          },
        });

        const completionEvents: SessionEventData[] = [
          {
            type: "assistant.message.completed",
            payload: {
              messageId: currentMessageId,
              content: result.content,
              stopReason: result.finishReason ?? undefined,
            },
          },
        ];

        for (const toolCall of result.toolCalls) {
          completionEvents.push({
            type: "tool.call.requested",
            payload: {
              toolCallId: toolCall.id,
              name: toolCall.function.name,
              arguments: parseToolArguments(toolCall.function.arguments),
              messageId: currentMessageId,
            },
          });
        }

        completionEvents.push({
          type: "usage.recorded",
          payload: {
            inputTokens: result.usage?.inputTokens ?? 0,
            outputTokens: result.usage?.outputTokens ?? 0,
            reasoningTokens: 0,
            costUsd: 0,
            latencyMs: result.durationMs,
            ...(result.timeToFirstTokenMs === undefined
              ? {}
              : { ttftMs: result.timeToFirstTokenMs }),
          },
        });

        if (result.toolCalls.length === 0) {
          completionEvents.push({
            type: "session.completed",
            payload: { result: result.content },
          });
          this.appendMany(sessionId, completionEvents);
          completedCurrentMessage = true;
          return;
        }

        totalToolCalls += result.toolCalls.length;
        if (totalToolCalls > this.limits.toolCalls) {
          completionEvents.push({
            type: "session.failed",
            payload: { error: `Tool-call limit of ${this.limits.toolCalls} was exceeded.` },
          });
          this.appendMany(sessionId, completionEvents);
          completedCurrentMessage = true;
          return;
        }

        this.appendMany(sessionId, completionEvents);
        completedCurrentMessage = true;

        for (const toolCall of result.toolCalls) {
          if (controller.signal.aborted) {
            throw new ProviderAbortedError("Inference cancelled", currentPartial);
          }
          await this.runTool(sessionId, toolCall);
        }
      }

      this.append(sessionId, {
        type: "session.failed",
        payload: {
          error: `The local agent reached the ${this.limits.inferenceRounds}-round inference limit.`,
        },
      });
    } catch (error) {
      const aborted = controller.signal.aborted || error instanceof ProviderAbortedError;
      const terminalEvents: SessionEventData[] = [];
      const partial = error instanceof ProviderAbortedError ? error.partialContent : currentPartial;

      if (currentMessageId && !completedCurrentMessage) {
        terminalEvents.push({
          type: "assistant.message.completed",
          payload: {
            messageId: currentMessageId,
            content: partial,
            stopReason: aborted ? "cancelled" : "error",
          },
        });
      }

      terminalEvents.push(
        aborted
          ? {
              type: "session.cancelled",
              payload: { reason: "Cancelled by the user." },
            }
          : {
              type: "session.failed",
              payload: { error: safeErrorMessage(error) },
            },
      );

      const status = this.store.requireSession(sessionId).status;
      if (!(["completed", "failed", "cancelled"] as const).includes(status as never)) {
        this.appendMany(sessionId, terminalEvents);
      }
    }
  }

  private async runTool(sessionId: string, toolCall: ProviderToolCall): Promise<void> {
    const session = this.store.requireSession(sessionId);
    const result = await executeToolCall(session.workspaceRoot, toolCall);
    this.append(sessionId, {
      type: "tool.call.completed",
      payload: {
        toolCallId: toolCall.id,
        name: toolCall.function.name,
        content: result.content,
        isError: result.isError,
        durationMs: result.durationMs,
      },
    });
  }
}
