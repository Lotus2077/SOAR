import { describe, expect, it } from "vitest";

import {
  buildFinalizationContext,
  buildProviderContext,
} from "../../src/shared/context-builder";
import type { StoredSessionEvent } from "../../src/shared/session-events";

const events: StoredSessionEvent[] = [
  {
    id: "event-1",
    sessionId: "session-1",
    sequence: 1,
    createdAt: "2026-08-27T00:00:01.000Z",
    type: "session.created",
    payload: {
      title: "Task",
      objective: "Read the file",
      workspaceRoot: "/tmp/workspace",
      profile: "balanced",
    },
  },
  {
    id: "event-2",
    sessionId: "session-1",
    sequence: 2,
    createdAt: "2026-08-27T00:00:02.000Z",
    type: "user.message",
    payload: {
      messageId: "user-1",
      content: "Read the file",
    },
  },
  {
    id: "event-3",
    sessionId: "session-1",
    sequence: 3,
    createdAt: "2026-08-27T00:00:03.000Z",
    type: "assistant.message.started",
    payload: {
      messageId: "assistant-1",
      providerId: "local-vllm",
      model: "RM-01 VLM",
    },
  },
  {
    id: "event-4",
    sessionId: "session-1",
    sequence: 4,
    createdAt: "2026-08-27T00:00:04.000Z",
    type: "tool.call.requested",
    payload: {
      toolCallId: "call-1",
      messageId: "assistant-1",
      name: "read_text_file",
      arguments: { z: 1, a: { y: true, x: null } },
    },
  },
  {
    id: "event-5",
    sessionId: "session-1",
    sequence: 5,
    createdAt: "2026-08-27T00:00:05.000Z",
    type: "assistant.message.completed",
    payload: { messageId: "assistant-1" },
  },
  {
    id: "event-6",
    sessionId: "session-1",
    sequence: 6,
    createdAt: "2026-08-27T00:00:06.000Z",
    type: "tool.call.completed",
    payload: {
      toolCallId: "call-1",
      name: "read_text_file",
      content: "contents",
      isError: false,
    },
  },
  {
    id: "event-7",
    sessionId: "session-1",
    sequence: 7,
    createdAt: "2026-08-27T00:00:07.000Z",
    type: "assistant.message.started",
    payload: {
      messageId: "assistant-incomplete",
      providerId: "local-vllm",
      model: "RM-01 VLM",
    },
  },
  {
    id: "event-8",
    sessionId: "session-1",
    sequence: 8,
    createdAt: "2026-08-27T00:00:08.000Z",
    type: "assistant.message.delta",
    payload: { messageId: "assistant-incomplete", delta: "partial" },
  },
];

describe("buildProviderContext", () => {
  it("builds deterministic OpenAI-style observable context", () => {
    expect(
      buildProviderContext(events, { systemPrompt: "Use tools safely." }),
    ).toEqual([
      { role: "system", content: "Use tools safely." },
      { role: "user", content: "Read the file" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "read_text_file",
              arguments: '{"a":{"x":null,"y":true},"z":1}',
            },
          },
        ],
      },
      { role: "tool", content: "contents", tool_call_id: "call-1" },
    ]);
  });

  it("can include an interrupted partial assistant message for inspection", () => {
    expect(
      buildProviderContext(events, { includeIncompleteAssistant: true }).at(-1),
    ).toEqual({ role: "assistant", content: "partial" });
  });

  it("flattens tool history into an inert text-only finalization packet", () => {
    const context = buildFinalizationContext(events, {
      systemPrompt: "Write the final answer without tools.",
    });

    expect(context).toHaveLength(2);
    expect(context[0]).toEqual({
      role: "system",
      content: "Write the final answer without tools.",
    });
    expect(context[1]).toMatchObject({ role: "user" });
    expect(context[1]?.content).toContain("--- TASK OBJECTIVE ---\n\nRead the file");
    expect(context[1]?.content).toContain("tool: read_text_file");
    expect(context[1]?.content).toContain(
      'arguments: {"a":{"x":null,"y":true},"z":1}',
    );
    expect(context[1]?.content).toContain("status: completed\nresult:\ncontents");
    expect(context.some((message) => message.role === "tool")).toBe(false);
    expect(context.some((message) => "tool_calls" in message)).toBe(false);
    expect(context[1]?.content).not.toContain("partial");
  });
});
