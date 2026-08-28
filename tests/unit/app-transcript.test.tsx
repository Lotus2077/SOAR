import { describe, expect, it } from "vitest";

import {
  latestAssistantStartEventId,
  transcriptFrom,
} from "../../src/renderer/src/App";
import type { SessionSnapshot } from "../../src/shared/contracts";

describe("app transcript", () => {
  it("keeps rejected completion-obligation drafts in the activity trace, not the conversation", () => {
    const snapshot: SessionSnapshot = {
      id: "00000000-0000-4000-8000-000000000001",
      title: "Investigate the repository",
      workspaceRoot: "/tmp/workspace",
      status: "completed",
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:05.000Z",
      events: [
        {
          id: "user",
          sequence: 1,
          type: "user.message",
          createdAt: "2026-08-28T00:00:01.000Z",
          payload: {
            messageId: "user-1",
            content: "Investigate the repository",
          },
        },
        {
          id: "rejected",
          sequence: 2,
          type: "assistant.message.completed",
          createdAt: "2026-08-28T00:00:02.000Z",
          payload: {
            messageId: "assistant-1",
            content: "Unsupported draft without citations.",
            completionState: "incomplete",
          },
        },
        {
          id: "accepted",
          sequence: 3,
          type: "assistant.message.completed",
          createdAt: "2026-08-28T00:00:03.000Z",
          payload: {
            messageId: "assistant-2",
            content: "Supported final answer at src/main/index.ts:1.",
            completionState: "complete",
          },
        },
        {
          id: "completed",
          sequence: 4,
          type: "session.completed",
          createdAt: "2026-08-28T00:00:04.000Z",
          payload: { result: "Supported final answer at src/main/index.ts:1." },
        },
      ],
    };

    const transcript = transcriptFrom(snapshot);
    expect(transcript).toEqual([
      expect.objectContaining({
        kind: "user",
        text: "Investigate the repository",
      }),
      expect.objectContaining({
        kind: "assistant",
        text: "Supported final answer at src/main/index.ts:1.",
      }),
    ]);
    expect(JSON.stringify(transcript)).not.toContain("Unsupported draft");
  });

  it("finds a new assistant round even when context telemetry is the latest event", () => {
    const snapshot: SessionSnapshot = {
      id: "00000000-0000-4000-8000-000000000002",
      title: "Continue the investigation",
      workspaceRoot: "/tmp/workspace",
      status: "running",
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:03.000Z",
      events: [
        {
          id: "assistant-start-1",
          sequence: 1,
          type: "assistant.message.started",
          createdAt: "2026-08-28T00:00:01.000Z",
          payload: { messageId: "assistant-1" },
        },
        {
          id: "context-1",
          sequence: 2,
          type: "context.compiled",
          createdAt: "2026-08-28T00:00:02.000Z",
          payload: { checkpointId: "context-1" },
        },
        {
          id: "assistant-start-2",
          sequence: 3,
          type: "assistant.message.started",
          createdAt: "2026-08-28T00:00:03.000Z",
          payload: { messageId: "assistant-2" },
        },
        {
          id: "context-2",
          sequence: 4,
          type: "context.compiled",
          createdAt: "2026-08-28T00:00:03.000Z",
          payload: { checkpointId: "context-2" },
        },
      ],
    };

    expect(latestAssistantStartEventId(snapshot)).toBe("assistant-start-2");
  });
});
