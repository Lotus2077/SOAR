import { describe, expect, it } from "vitest";

import {
  completedRequiredToolPrefix,
  reduceSessionEvent,
  replaySession,
} from "../../src/shared/session-reducer";
import type {
  CompletionObligations,
  CompletionObligationToolName,
  ContextCompilationMode,
  ContextCompilationReason,
  JsonValue,
  SessionEventData,
  StoredSessionEvent,
} from "../../src/shared/session-events";

function stored(
  sessionId: string,
  sequence: number,
  event: SessionEventData,
): StoredSessionEvent {
  return {
    id: `${sessionId}:event:${sequence}`,
    sessionId,
    sequence,
    createdAt: new Date(Date.UTC(2026, 7, 29, 0, 0, sequence)).toISOString(),
    ...event,
  };
}

function created(
  sessionId: string,
  obligations?: CompletionObligations,
  inferenceRounds = 2,
  toolCalls = 1,
): StoredSessionEvent {
  return stored(sessionId, 1, {
    type: "session.created",
    payload: {
      title: "Adversarial replay",
      objective: "Prove the persisted completion contract.",
      workspaceRoot: "/tmp/workspace",
      profile: "balanced",
      ...(obligations === undefined
        ? {}
        : { completionObligations: obligations }),
      executionPolicy: {
        schemaVersion: "agentic-execution-v1",
        inferenceRounds,
        toolCalls,
      },
    },
  });
}

function legacyCreated(sessionId: string): StoredSessionEvent {
  return stored(sessionId, 1, {
    type: "session.created",
    payload: {
      title: "Legacy replay",
      objective: "Preserve an event stream without a versioned policy.",
      workspaceRoot: "/tmp/workspace",
      profile: "balanced",
    },
  });
}

function route(sessionId: string, sequence: number): StoredSessionEvent {
  return stored(sessionId, sequence, {
    type: "route.assigned",
    payload: {
      providerId: "local-vllm",
      model: "RM-01 VLM",
      reason: "Persisted local route",
      leaseId: `${sessionId}:lease:1`,
    },
  });
}

function assistantStarted(
  sessionId: string,
  sequence: number,
  messageId: string,
): StoredSessionEvent {
  return stored(sessionId, sequence, {
    type: "assistant.message.started",
    payload: {
      messageId,
      providerId: "local-vllm",
      model: "RM-01 VLM",
    },
  });
}

function checkpoint(
  sessionId: string,
  sequence: number,
  ordinal: number,
  reason: ContextCompilationReason,
  mode: ContextCompilationMode,
): StoredSessionEvent {
  return stored(sessionId, sequence, {
    type: "context.compiled",
    payload: {
      checkpointId: `${sessionId}:context:${ordinal}`,
      compilerVersion: "context-compiler-v1",
      reason,
      mode,
      providerId: "local-vllm",
      model: "RM-01 VLM",
      maxTokens: 1_000,
      estimatedTokens: 100,
      estimator: "utf8-bytes-v1",
      reservedInputTokens: 100,
      effectiveInputTokenBudget: 800,
      sourceMessageCount: 1,
      messageCount: 1,
      evidenceCount: 0,
      deduplicatedEvidenceCount: 0,
      omittedEvidenceCount: 0,
      packetSha256: "a".repeat(64),
      messagesSha256: "b".repeat(64),
      safetyMargin: 0.1,
    },
  });
}

describe("active-policy adversarial replay integrity", () => {
  it("cannot accept a shape-valid read result whose persisted arguments are invalid", () => {
    const sessionId = "invalid-read-observation";
    const events: StoredSessionEvent[] = [
      created(sessionId, {
        requiredSuccessfulTools: ["read_text_file"],
        minimumVerifiedPathLineCitations: 1,
      }),
      stored(sessionId, 2, { type: "session.started", payload: {} }),
      route(sessionId, 3),
      assistantStarted(sessionId, 4, "tool-round"),
      checkpoint(sessionId, 5, 1, "session_start", "working"),
      stored(sessionId, 6, {
        type: "assistant.message.completed",
        payload: { messageId: "tool-round", stopReason: "tool_calls" },
      }),
      stored(sessionId, 7, {
        type: "tool.call.requested",
        payload: {
          toolCallId: "invalid-read",
          messageId: "tool-round",
          name: "read_text_file",
          arguments: {},
        },
      }),
      stored(sessionId, 8, {
        type: "tool.call.completed",
        payload: {
          toolCallId: "invalid-read",
          name: "read_text_file",
          content: JSON.stringify({
            ok: true,
            text: "line one\n",
            bytes: 9,
            truncated: false,
          }),
          isError: false,
        },
      }),
      assistantStarted(sessionId, 9, "final-answer"),
      checkpoint(
        sessionId,
        10,
        2,
        "finalization_boundary",
        "finalization",
      ),
      stored(sessionId, 11, {
        type: "assistant.message.completed",
        payload: {
          messageId: "final-answer",
          content: "Verified at src/a.ts:1.",
          stopReason: "stop",
          completionState: "complete",
        },
      }),
      stored(sessionId, 12, {
        type: "completion.obligations.checked",
        payload: {
          checkId: `${sessionId}:completion:2`,
          messageId: "final-answer",
          round: 2,
          remainingRounds: 0,
          successfulRequiredTools: ["read_text_file"],
          missingRequiredTools: [],
          verifiedPathLineCitations: ["src/a.ts:1"],
          unresolvedCitationCount: 0,
          outcome: "accepted",
        },
      }),
      stored(sessionId, 13, {
        type: "session.completed",
        payload: { result: "Verified at src/a.ts:1." },
      }),
    ];

    expect(() => replaySession(events)).toThrow(
      /does not match replayed tool progress/,
    );
  });

  it("cannot use a nonmatching forged search result as accepted citation evidence", () => {
    const sessionId = "nonmatching-search-observation";
    const events: StoredSessionEvent[] = [
      created(sessionId, {
        requiredSuccessfulTools: [],
        minimumVerifiedPathLineCitations: 1,
      }),
      stored(sessionId, 2, { type: "session.started", payload: {} }),
      route(sessionId, 3),
      assistantStarted(sessionId, 4, "search-round"),
      checkpoint(sessionId, 5, 1, "session_start", "working"),
      stored(sessionId, 6, {
        type: "assistant.message.completed",
        payload: { messageId: "search-round", stopReason: "tool_calls" },
      }),
      stored(sessionId, 7, {
        type: "tool.call.requested",
        payload: {
          toolCallId: "forged-search",
          messageId: "search-round",
          name: "search_text",
          arguments: { query: "needle" },
        },
      }),
      stored(sessionId, 8, {
        type: "tool.call.completed",
        payload: {
          toolCallId: "forged-search",
          name: "search_text",
          content: JSON.stringify({
            ok: true,
            matches: [
              {
                path: "src/a.ts",
                lineNumber: 999,
                text: "unrelated content",
                textTruncated: false,
              },
            ],
            count: 1,
            filesSearched: 1,
            bytesScanned: 17,
            skipped: {
              binary: 0,
              ignored: 0,
              symlink: 0,
              tooLarge: 0,
              unreadable: 0,
            },
            truncated: false,
            outputBytes: 200,
          }),
          isError: false,
        },
      }),
      assistantStarted(sessionId, 9, "final-answer"),
      checkpoint(
        sessionId,
        10,
        2,
        "finalization_boundary",
        "finalization",
      ),
      stored(sessionId, 11, {
        type: "assistant.message.completed",
        payload: {
          messageId: "final-answer",
          content: "Claimed evidence at src/a.ts:999.",
          stopReason: "stop",
          completionState: "complete",
        },
      }),
      stored(sessionId, 12, {
        type: "completion.obligations.checked",
        payload: {
          checkId: `${sessionId}:completion:2`,
          messageId: "final-answer",
          round: 2,
          remainingRounds: 0,
          successfulRequiredTools: [],
          missingRequiredTools: [],
          verifiedPathLineCitations: ["src/a.ts:999"],
          unresolvedCitationCount: 0,
          outcome: "accepted",
        },
      }),
      stored(sessionId, 13, {
        type: "session.completed",
        payload: { result: "Claimed evidence at src/a.ts:999." },
      }),
    ];

    expect(() => replaySession(events)).toThrow(
      /does not match replayed citation evidence/,
    );
  });

  it("binds completion-check round and remaining budget to persisted execution", () => {
    const sessionId = "bounded-check";
    const candidate = replaySession([
      created(
        sessionId,
        {
          requiredSuccessfulTools: [],
          minimumVerifiedPathLineCitations: 1,
        },
        2,
      ),
      stored(sessionId, 2, { type: "session.started", payload: {} }),
      route(sessionId, 3),
      assistantStarted(sessionId, 4, "candidate"),
      checkpoint(sessionId, 5, 1, "session_start", "working"),
      stored(sessionId, 6, {
        type: "assistant.message.completed",
        payload: {
          messageId: "candidate",
          content: "No verified citation.",
          stopReason: "stop",
          completionState: "incomplete",
        },
      }),
    ]);

    expect(() =>
      reduceSessionEvent(
        candidate,
        stored(sessionId, 7, {
          type: "completion.obligations.checked",
          payload: {
            checkId: `${sessionId}:completion:2`,
            messageId: "candidate",
            round: 2,
            remainingRounds: 0,
            successfulRequiredTools: [],
            missingRequiredTools: [],
            verifiedPathLineCitations: [],
            unresolvedCitationCount: 0,
            outcome: "exhausted",
          },
        }),
      ),
    ).toThrow(/round must equal assistant ordinal 1/);

    expect(() =>
      reduceSessionEvent(
        candidate,
        stored(sessionId, 7, {
          type: "completion.obligations.checked",
          payload: {
            checkId: `${sessionId}:completion:1`,
            messageId: "candidate",
            round: 1,
            remainingRounds: 2,
            successfulRequiredTools: [],
            missingRequiredTools: [],
            verifiedPathLineCitations: [],
            unresolvedCitationCount: 0,
            outcome: "retry",
          },
        }),
      ),
    ).toThrow(/exceeds the persisted inference-round budget/);
  });

  it("requires an active route and exactly one pre-inference checkpoint", () => {
    const sessionId = "strict-trace";
    const started = replaySession([
      created(sessionId),
      stored(sessionId, 2, { type: "session.started", payload: {} }),
    ]);

    expect(() =>
      reduceSessionEvent(
        started,
        assistantStarted(sessionId, 3, "without-route"),
      ),
    ).toThrow(/does not match the active route/);

    const routed = reduceSessionEvent(started, route(sessionId, 3));
    const streaming = reduceSessionEvent(
      routed,
      assistantStarted(sessionId, 4, "assistant"),
    );
    expect(() =>
      reduceSessionEvent(
        streaming,
        stored(sessionId, 5, {
          type: "assistant.message.completed",
          payload: {
            messageId: "assistant",
            content: "No checkpoint.",
            stopReason: "stop",
          },
        }),
      ),
    ).toThrow(/cannot complete without exactly one context checkpoint/);

    const checkpointed = reduceSessionEvent(
      streaming,
      checkpoint(sessionId, 5, 1, "session_start", "working"),
    );
    expect(() =>
      reduceSessionEvent(
        checkpointed,
        checkpoint(sessionId, 6, 2, "tool_result_boundary", "working"),
      ),
    ).toThrow(/single pre-inference checkpoint/);
  });

  it("rejects inference-derived events before the active assistant checkpoint", () => {
    const sessionId = "pre-checkpoint-output";
    const streaming = replaySession([
      created(sessionId),
      stored(sessionId, 2, { type: "session.started", payload: {} }),
      route(sessionId, 3),
      assistantStarted(sessionId, 4, "assistant"),
    ]);

    expect(() =>
      reduceSessionEvent(
        streaming,
        stored(sessionId, 5, {
          type: "assistant.message.delta",
          payload: { messageId: "assistant", delta: "premature" },
        }),
      ),
    ).toThrow(/pre-inference context checkpoint/);

    expect(() =>
      reduceSessionEvent(
        streaming,
        stored(sessionId, 5, {
          type: "tool.call.requested",
          payload: {
            toolCallId: "premature-tool",
            messageId: "assistant",
            name: "list_files",
            arguments: {},
          },
        }),
      ),
    ).toThrow(/pre-inference context checkpoint/);

    expect(() =>
      reduceSessionEvent(
        streaming,
        stored(sessionId, 5, {
          type: "usage.recorded",
          payload: {
            inputTokens: 1,
            outputTokens: 1,
            reasoningTokens: 0,
            costUsd: 0,
          },
        }),
      ),
    ).toThrow(/pre-inference context checkpoint/);
  });

  it("rejects tool requests and usage while a checkpointed assistant is still streaming", () => {
    const sessionId = "checkpointed-streaming-output";
    const streaming = replaySession([
      created(sessionId),
      stored(sessionId, 2, { type: "session.started", payload: {} }),
      route(sessionId, 3),
      assistantStarted(sessionId, 4, "assistant"),
      checkpoint(sessionId, 5, 1, "session_start", "working"),
    ]);

    expect(() =>
      reduceSessionEvent(
        streaming,
        stored(sessionId, 6, {
          type: "tool.call.requested",
          payload: {
            toolCallId: "streaming-tool",
            messageId: "assistant",
            name: "list_files",
            arguments: {},
          },
        }),
      ),
    ).toThrow(/requires a completed assistant with stop reason tool_calls/);

    expect(() =>
      reduceSessionEvent(
        streaming,
        stored(sessionId, 6, {
          type: "usage.recorded",
          payload: {
            inputTokens: 1,
            outputTokens: 1,
            reasoningTokens: 0,
            costUsd: 0,
          },
        }),
      ),
    ).toThrow(/requires the current assistant to be non-streaming/);
  });

  it("rejects multiple tool requests from one active-policy inference round", () => {
    const sessionId = "multiple-tools-one-round";
    const firstRequest = replaySession([
      created(sessionId, undefined, 2, 2),
      stored(sessionId, 2, { type: "session.started", payload: {} }),
      route(sessionId, 3),
      assistantStarted(sessionId, 4, "assistant"),
      checkpoint(sessionId, 5, 1, "session_start", "working"),
      stored(sessionId, 6, {
        type: "assistant.message.completed",
        payload: {
          messageId: "assistant",
          stopReason: "tool_calls",
          completionState: "complete",
        },
      }),
      stored(sessionId, 7, {
        type: "tool.call.requested",
        payload: {
          toolCallId: "first-tool",
          messageId: "assistant",
          name: "list_files",
          arguments: {},
        },
      }),
    ]);

    expect(() =>
      reduceSessionEvent(
        firstRequest,
        stored(sessionId, 8, {
          type: "tool.call.requested",
          payload: {
            toolCallId: "second-tool",
            messageId: "assistant",
            name: "search_text",
            arguments: { query: "needle" },
          },
        }),
      ),
    ).toThrow(/exactly one sequential tool call/);
  });

  it("advances repeated list, search, and read requirements only in exact successful order", () => {
    const sessionId = "repeated-required-tools";
    const requiredTools: CompletionObligationToolName[] = [
      "list_files",
      "list_files",
      "search_text",
      "search_text",
      "read_text_file",
      "read_text_file",
    ];
    const steps: Array<{
      name: CompletionObligationToolName;
      arguments: JsonValue;
      content: string;
    }> = [
      {
        name: "list_files",
        arguments: {},
        content: JSON.stringify({
          ok: true,
          entries: [{ path: "src", type: "directory" }],
          count: 1,
          skipped: { ignored: 0, unreadable: 0 },
          truncated: false,
          outputBytes: 1,
        }),
      },
      {
        name: "list_files",
        arguments: { relativePath: "src" },
        content: JSON.stringify({
          ok: true,
          entries: [{ path: "src/a.ts", type: "file", size: 6 }],
          count: 1,
          skipped: { ignored: 0, unreadable: 0 },
          truncated: false,
          outputBytes: 1,
        }),
      },
      {
        name: "search_text",
        arguments: { query: "alpha" },
        content: JSON.stringify({
          ok: true,
          matches: [
            {
              path: "src/a.ts",
              lineNumber: 1,
              text: "alpha",
              textTruncated: false,
            },
          ],
          count: 1,
          filesSearched: 1,
          bytesScanned: 6,
          skipped: {
            binary: 0,
            ignored: 0,
            symlink: 0,
            tooLarge: 0,
            unreadable: 0,
          },
          truncated: false,
          outputBytes: 1,
        }),
      },
      {
        name: "search_text",
        arguments: { query: "beta" },
        content: JSON.stringify({
          ok: true,
          matches: [
            {
              path: "src/b.ts",
              lineNumber: 1,
              text: "beta",
              textTruncated: false,
            },
          ],
          count: 1,
          filesSearched: 1,
          bytesScanned: 5,
          skipped: {
            binary: 0,
            ignored: 0,
            symlink: 0,
            tooLarge: 0,
            unreadable: 0,
          },
          truncated: false,
          outputBytes: 1,
        }),
      },
      {
        name: "read_text_file",
        arguments: { relativePath: "src/a.ts" },
        content: JSON.stringify({
          ok: true,
          text: "alpha\n",
          bytes: 6,
          truncated: false,
        }),
      },
      {
        name: "read_text_file",
        arguments: { relativePath: "src/b.ts" },
        content: JSON.stringify({
          ok: true,
          text: "beta\n",
          bytes: 5,
          truncated: false,
        }),
      },
    ];
    const events: StoredSessionEvent[] = [
      created(
        sessionId,
        {
          requiredSuccessfulTools: requiredTools,
          minimumVerifiedPathLineCitations: 0,
        },
        steps.length + 1,
        steps.length,
      ),
      stored(sessionId, 2, { type: "session.started", payload: {} }),
      route(sessionId, 3),
    ];

    for (const [index, step] of steps.entries()) {
      const ordinal = index + 1;
      const messageId = `tool-round-${ordinal}`;
      const toolCallId = `required-tool-${ordinal}`;
      events.push(
        assistantStarted(sessionId, events.length + 1, messageId),
        checkpoint(
          sessionId,
          events.length + 2,
          ordinal,
          index === 0 ? "session_start" : "tool_result_boundary",
          "working",
        ),
        stored(sessionId, events.length + 3, {
          type: "assistant.message.completed",
          payload: {
            messageId,
            stopReason: "tool_calls",
            completionState: "complete",
          },
        }),
        stored(sessionId, events.length + 4, {
          type: "tool.call.requested",
          payload: {
            toolCallId,
            messageId,
            name: step.name,
            arguments: step.arguments,
          },
        }),
        stored(sessionId, events.length + 5, {
          type: "tool.call.completed",
          payload: {
            toolCallId,
            name: step.name,
            content: step.content,
            isError: false,
          },
        }),
      );
    }

    const afterFirstStep = replaySession(events.slice(0, 8));
    expect(
      completedRequiredToolPrefix(afterFirstStep.messages, requiredTools),
    ).toEqual(["list_files"]);
    const beforeOutOfOrderRequest = replaySession([
      ...events.slice(0, 8),
      assistantStarted(sessionId, 9, "out-of-order-round"),
      checkpoint(
        sessionId,
        10,
        2,
        "tool_result_boundary",
        "working",
      ),
      stored(sessionId, 11, {
        type: "assistant.message.completed",
        payload: {
          messageId: "out-of-order-round",
          stopReason: "tool_calls",
          completionState: "complete",
        },
      }),
    ]);
    expect(() =>
      reduceSessionEvent(
        beforeOutOfOrderRequest,
        stored(sessionId, 12, {
          type: "tool.call.requested",
          payload: {
            toolCallId: "skipped-duplicate-list",
            messageId: "out-of-order-round",
            name: "search_text",
            arguments: { query: "alpha" },
          },
        }),
      ),
    ).toThrow(/must request required tool list_files/);

    const finalOrdinal = steps.length + 1;
    const finalMessageId = "final-answer";
    events.push(
      assistantStarted(sessionId, events.length + 1, finalMessageId),
      checkpoint(
        sessionId,
        events.length + 2,
        finalOrdinal,
        "finalization_boundary",
        "finalization",
      ),
      stored(sessionId, events.length + 3, {
        type: "assistant.message.completed",
        payload: {
          messageId: finalMessageId,
          content: "All repeated tool steps completed.",
          stopReason: "stop",
          completionState: "complete",
        },
      }),
      stored(sessionId, events.length + 4, {
        type: "completion.obligations.checked",
        payload: {
          checkId: `${sessionId}:completion:${finalOrdinal}`,
          messageId: finalMessageId,
          round: finalOrdinal,
          remainingRounds: 0,
          successfulRequiredTools: requiredTools,
          missingRequiredTools: [],
          verifiedPathLineCitations: [],
          unresolvedCitationCount: 0,
          outcome: "accepted",
        },
      }),
      stored(sessionId, events.length + 5, {
        type: "session.completed",
        payload: { result: "All repeated tool steps completed." },
      }),
    );

    const completed = replaySession(events);
    expect(completed.status).toBe("completed");
    expect(
      completedRequiredToolPrefix(completed.messages, requiredTools),
    ).toEqual(requiredTools);
    expect(completed.completionChecks.at(-1)).toMatchObject({
      successfulRequiredTools: requiredTools,
      missingRequiredTools: [],
      outcome: "accepted",
    });
  });

  it("preserves pre-checkpoint ordering compatibility without an execution policy", () => {
    const sessionId = "legacy-pre-checkpoint-output";
    let state = replaySession([
      legacyCreated(sessionId),
      stored(sessionId, 2, { type: "session.started", payload: {} }),
      assistantStarted(sessionId, 3, "assistant"),
    ]);

    state = reduceSessionEvent(
      state,
      stored(sessionId, 4, {
        type: "assistant.message.delta",
        payload: { messageId: "assistant", delta: "legacy" },
      }),
    );
    state = reduceSessionEvent(
      state,
      stored(sessionId, 5, {
        type: "tool.call.requested",
        payload: {
          toolCallId: "legacy-tool",
          messageId: "assistant",
          name: "list_files",
          arguments: {},
        },
      }),
    );
    state = reduceSessionEvent(
      state,
      stored(sessionId, 6, {
        type: "usage.recorded",
        payload: {
          inputTokens: 1,
          outputTokens: 1,
          reasoningTokens: 0,
          costUsd: 0,
        },
      }),
    );

    expect(state.messages.at(-1)).toMatchObject({
      id: "assistant",
      content: "legacy",
      status: "streaming",
      toolCalls: [{ id: "legacy-tool", status: "requested" }],
    });
    expect(state.usage).toMatchObject({ inputTokens: 1, outputTokens: 1 });
  });
});
