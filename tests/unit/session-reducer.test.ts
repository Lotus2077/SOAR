import { describe, expect, it } from "vitest";

import {
  reduceSessionEvent,
  replaySession,
} from "../../src/shared/session-reducer";
import {
  parseSessionEventData,
  type SessionEventData,
  type StoredSessionEvent,
} from "../../src/shared/session-events";

function stored(
  sessionId: string,
  sequence: number,
  event: SessionEventData,
): StoredSessionEvent {
  return {
    id: `event-${sequence}`,
    sessionId,
    sequence,
    createdAt: new Date(Date.UTC(2026, 7, 27, 0, 0, sequence)).toISOString(),
    ...event,
  };
}

describe("session reducer", () => {
  it("replays a complete local tool-calling trajectory deterministically", () => {
    const sessionId = "session-1";
    const events: StoredSessionEvent[] = [
      stored(sessionId, 1, {
        type: "session.created",
        payload: {
          title: "Summarize the notes",
          objective: "Read notes.txt and summarize it.",
          workspaceRoot: "/tmp/workspace",
          profile: "balanced",
        },
      }),
      stored(sessionId, 2, {
        type: "user.message",
        payload: {
          messageId: "user-1",
          content: "Read notes.txt and summarize it.",
        },
      }),
      stored(sessionId, 3, {
        type: "session.started",
        payload: {},
      }),
      stored(sessionId, 4, {
        type: "route.assigned",
        payload: {
          providerId: "local-vllm",
          model: "RM-01 VLM",
          reason: "Local-only vertical slice",
          leaseId: "lease-1",
        },
      }),
      stored(sessionId, 5, {
        type: "assistant.message.started",
        payload: {
          messageId: "assistant-1",
          providerId: "local-vllm",
          model: "RM-01 VLM",
        },
      }),
      stored(sessionId, 6, {
        type: "assistant.message.delta",
        payload: { messageId: "assistant-1", delta: "I will read the file." },
      }),
      stored(sessionId, 7, {
        type: "tool.call.requested",
        payload: {
          toolCallId: "call-1",
          messageId: "assistant-1",
          name: "read_text_file",
          arguments: { relativePath: "notes.txt" },
        },
      }),
      stored(sessionId, 8, {
        type: "assistant.message.completed",
        payload: { messageId: "assistant-1", stopReason: "tool_calls" },
      }),
      stored(sessionId, 9, {
        type: "tool.call.completed",
        payload: {
          toolCallId: "call-1",
          name: "read_text_file",
          content: "Hello from the workspace",
          isError: false,
          durationMs: 3,
        },
      }),
      stored(sessionId, 10, {
        type: "assistant.message.started",
        payload: {
          messageId: "assistant-2",
          providerId: "local-vllm",
          model: "RM-01 VLM",
        },
      }),
      stored(sessionId, 11, {
        type: "assistant.message.completed",
        payload: {
          messageId: "assistant-2",
          content: "The note greets the workspace.",
        },
      }),
      stored(sessionId, 12, {
        type: "context.compiled",
        payload: {
          checkpointId: "checkpoint-1",
          compilerVersion: "context-compiler-v1",
          reason: "phase-boundary",
          mode: "bounded",
          providerId: "local-vllm",
          model: "RM-01 VLM",
          maxTokens: 16_000,
          estimatedTokens: 4_096,
          estimator: "utf8-bytes-v1",
          reservedInputTokens: 1_000,
          effectiveInputTokenBudget: 13_400,
          sourceMessageCount: 5,
          messageCount: 3,
          evidenceCount: 1,
          deduplicatedEvidenceCount: 1,
          omittedEvidenceCount: 0,
          packetSha256:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          messagesSha256:
            "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
          safetyMargin: 0.1,
        },
      }),
      stored(sessionId, 13, {
        type: "usage.recorded",
        payload: {
          inputTokens: 100,
          outputTokens: 20,
          reasoningTokens: 5,
          costUsd: 0,
          latencyMs: 650,
          ttftMs: 120,
        },
      }),
      stored(sessionId, 14, {
        type: "session.completed",
        payload: {},
      }),
    ];

    const first = replaySession(events);
    const second = events.reduce(
      (state, event) => reduceSessionEvent(state, event),
      undefined as ReturnType<typeof replaySession> | undefined,
    );

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      id: sessionId,
      status: "completed",
      result: "The note greets the workspace.",
      lastSequence: 14,
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        reasoningTokens: 5,
        costUsd: 0,
        latencyMs: 650,
        ttftMs: 120,
      },
      contextCompilations: [
        {
          checkpointId: "checkpoint-1",
          compilerVersion: "context-compiler-v1",
          reason: "phase-boundary",
          mode: "bounded",
          providerId: "local-vllm",
          model: "RM-01 VLM",
          maxTokens: 16_000,
          estimatedTokens: 4_096,
          estimator: "utf8-bytes-v1",
          reservedInputTokens: 1_000,
          effectiveInputTokenBudget: 13_400,
          sourceMessageCount: 5,
          messageCount: 3,
          evidenceCount: 1,
          deduplicatedEvidenceCount: 1,
          omittedEvidenceCount: 0,
          packetSha256:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          messagesSha256:
            "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
          safetyMargin: 0.1,
          sequence: 12,
          createdAt: "2026-08-27T00:00:12.000Z",
        },
      ],
    });
    expect(first.messages.find((message) => message.id === "assistant-1"))
      .toMatchObject({
        status: "completed",
        stopReason: "tool_calls",
        completionState: "complete",
        toolCalls: [
          {
            id: "call-1",
            name: "read_text_file",
            status: "completed",
            content: "Hello from the workspace",
          },
        ],
      });
  });

  it("preserves an incomplete provider finish state and marks its message failed", () => {
    const sessionId = "session-1";
    const state = replaySession([
      stored(sessionId, 1, {
        type: "session.created",
        payload: {
          title: "Task",
          objective: "Return a complete answer.",
          workspaceRoot: "/tmp/workspace",
          profile: "balanced",
        },
      }),
      stored(sessionId, 2, { type: "session.started", payload: {} }),
      stored(sessionId, 3, {
        type: "assistant.message.started",
        payload: {
          messageId: "assistant-1",
          providerId: "local-vllm",
          model: "RM-01 VLM",
        },
      }),
      stored(sessionId, 4, {
        type: "assistant.message.completed",
        payload: {
          messageId: "assistant-1",
          content: "Partial answer",
          stopReason: "length",
          completionState: "incomplete",
        },
      }),
      stored(sessionId, 5, {
        type: "session.failed",
        payload: { error: "Provider output was incomplete." },
      }),
    ]);

    expect(state).toMatchObject({
      status: "failed",
      error: "Provider output was incomplete.",
      messages: [
        {
          content: "Partial answer",
          status: "failed",
          stopReason: "length",
          completionState: "incomplete",
        },
      ],
    });
  });

  it("rejects gaps and cross-session events", () => {
    const created = stored("session-1", 1, {
      type: "session.created",
      payload: {
        title: "Task",
        objective: "Do the task",
        workspaceRoot: "/tmp/workspace",
        profile: "economy",
      },
    });
    const state = reduceSessionEvent(undefined, created);

    expect(() =>
      reduceSessionEvent(
        state,
        stored("session-1", 3, { type: "session.started", payload: {} }),
      ),
    ).toThrow(/expected event sequence 2/);
    expect(() =>
      reduceSessionEvent(
        state,
        stored("session-2", 2, { type: "session.started", payload: {} }),
      ),
    ).toThrow(/Cannot apply event for session session-2/);
  });

  it("marks unfinished output failed when startup recovery interrupts a run", () => {
    const sessionId = "session-1";
    const state = replaySession([
      stored(sessionId, 1, {
        type: "session.created",
        payload: {
          title: "Task",
          objective: "Do the task",
          workspaceRoot: "/tmp/workspace",
          profile: "balanced",
        },
      }),
      stored(sessionId, 2, { type: "session.started", payload: {} }),
      stored(sessionId, 3, {
        type: "assistant.message.started",
        payload: {
          messageId: "assistant-1",
          providerId: "local-vllm",
          model: "RM-01 VLM",
        },
      }),
      stored(sessionId, 4, {
        type: "session.interrupted",
        payload: { reason: "App restarted" },
      }),
    ]);

    expect(state.status).toBe("interrupted");
    expect(state.messages.at(-1)?.status).toBe("failed");
    expect(state.error).toBe("App restarted");
  });

  it("strictly validates context compilation telemetry and safe ranges", () => {
    const valid = {
      type: "context.compiled",
      payload: {
        checkpointId: "checkpoint-1",
        compilerVersion: "context-compiler-v1",
        reason: "provider-switch",
        mode: "bounded",
        providerId: "local-vllm",
        model: "RM-01 VLM",
        maxTokens: 8_000,
        estimatedTokens: 2_000,
        estimator: "utf8-bytes-v1",
        reservedInputTokens: 500,
        effectiveInputTokenBudget: 6_300,
        sourceMessageCount: 12,
        messageCount: 6,
        evidenceCount: 3,
        deduplicatedEvidenceCount: 2,
        omittedEvidenceCount: 1,
        packetSha256:
          "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        messagesSha256:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        safetyMargin: 0.15,
      },
    };

    expect(parseSessionEventData(valid)).toEqual(valid);
    expect(() =>
      parseSessionEventData({
        ...valid,
        payload: { ...valid.payload, estimatedTokens: 6_301 },
      }),
    ).toThrow(/estimatedTokens must not exceed effectiveInputTokenBudget/);
    expect(() =>
      parseSessionEventData({
        ...valid,
        payload: { ...valid.payload, effectiveInputTokenBudget: 6_301 },
      }),
    ).toThrow(/effectiveInputTokenBudget must equal/);
    expect(() =>
      parseSessionEventData({
        ...valid,
        payload: { ...valid.payload, messageCount: Number.MAX_SAFE_INTEGER + 1 },
      }),
    ).toThrow();
    expect(() =>
      parseSessionEventData({
        ...valid,
        payload: { ...valid.payload, safetyMargin: 1 },
      }),
    ).toThrow();
    expect(() =>
      parseSessionEventData({
        ...valid,
        payload: { ...valid.payload, estimator: "characters-v0" },
      }),
    ).toThrow();
    expect(() =>
      parseSessionEventData({
        ...valid,
        payload: { ...valid.payload, messagesSha256: "not-a-sha256" },
      }),
    ).toThrow();
    expect(() =>
      parseSessionEventData({
        ...valid,
        payload: { ...valid.payload, unexpected: true },
      }),
    ).toThrow();
  });

  it("rejects context compilation telemetry after a terminal event", () => {
    const sessionId = "session-1";
    const state = replaySession([
      stored(sessionId, 1, {
        type: "session.created",
        payload: {
          title: "Task",
          objective: "Do the task",
          workspaceRoot: "/tmp/workspace",
          profile: "balanced",
        },
      }),
      stored(sessionId, 2, {
        type: "session.completed",
        payload: { result: "Done" },
      }),
    ]);

    expect(() =>
      reduceSessionEvent(
        state,
        stored(sessionId, 3, {
          type: "context.compiled",
          payload: {
            checkpointId: "checkpoint-late",
            compilerVersion: "context-compiler-v1",
            reason: "finalization",
            mode: "bounded",
            providerId: "local-vllm",
            model: "RM-01 VLM",
            maxTokens: 8_000,
            estimatedTokens: 2_000,
            estimator: "utf8-bytes-v1",
            reservedInputTokens: 500,
            effectiveInputTokenBudget: 6_300,
            sourceMessageCount: 1,
            messageCount: 1,
            evidenceCount: 0,
            deduplicatedEvidenceCount: 0,
            omittedEvidenceCount: 0,
            packetSha256:
              "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
            messagesSha256:
              "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            safetyMargin: 0.15,
          },
        }),
      ),
    ).toThrow(/after session entered terminal status completed/);
  });
});
