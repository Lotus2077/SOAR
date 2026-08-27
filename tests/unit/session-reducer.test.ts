import { describe, expect, it } from "vitest";

import {
  reduceSessionEvent,
  replaySession,
} from "../../src/shared/session-reducer";
import type {
  SessionEventData,
  StoredSessionEvent,
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
      stored(sessionId, 13, {
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
      lastSequence: 13,
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        reasoningTokens: 5,
        costUsd: 0,
        latencyMs: 650,
        ttftMs: 120,
      },
    });
    expect(first.messages.find((message) => message.id === "assistant-1"))
      .toMatchObject({
        status: "completed",
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
});
