import { describe, expect, it } from "vitest";

import {
  hasSuccessfulToolResult,
  reduceSessionEvent,
  replaySession,
  type CanonicalToolCall,
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
  it("counts only gateway-schema-conformant repository-tool results as successful", () => {
    const call = (
      name: "list_files" | "search_text" | "read_text_file",
      arguments_: Record<string, unknown>,
      output: Record<string, unknown>,
    ) => ({
      id: `${name}-1`,
      name,
      arguments: arguments_ as CanonicalToolCall["arguments"],
      status: "completed" as const,
      content: JSON.stringify(output),
    });

    expect(
      hasSuccessfulToolResult(
        call("read_text_file", { relativePath: "src/a.ts" }, { ok: true }),
      ),
    ).toBe(false);
    expect(
      hasSuccessfulToolResult(
        call(
          "read_text_file",
          {},
          { ok: true, text: "line\n", bytes: 5, truncated: false },
        ),
      ),
    ).toBe(false);
    expect(
      hasSuccessfulToolResult(
        call(
          "read_text_file",
          { relativePath: "src/a.ts" },
          {
            ok: true,
            text: "line\n",
            bytes: 5,
            truncated: false,
          },
        ),
      ),
    ).toBe(true);
    expect(
      hasSuccessfulToolResult(
        call("list_files", {}, {
          ok: true,
          entries: [],
          count: 0,
          skipped: { ignored: 0, unreadable: 0 },
          truncated: false,
          outputBytes: 1,
        }),
      ),
    ).toBe(true);
    expect(
      hasSuccessfulToolResult(
        call("search_text", { query: "needle" }, {
          ok: true,
          matches: [],
          count: 0,
          filesSearched: 1,
          bytesScanned: 1,
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
      ),
    ).toBe(true);
  });

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
          checkpointId: `${sessionId}:context:1`,
          compilerVersion: "context-compiler-v1",
          reason: "session_start",
          mode: "working",
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
          checkpointId: `${sessionId}:context:1`,
          compilerVersion: "context-compiler-v1",
          reason: "session_start",
          mode: "working",
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
      completionObligations: {
        requiredSuccessfulTools: [],
        minimumVerifiedPathLineCitations: 0,
      },
      completionChecks: [],
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
    expect(() =>
      reduceSessionEvent(
        state,
        stored(sessionId, 5, {
          type: "session.completed",
          payload: { result: "Forged recovery" },
        }),
      ),
    ).toThrow(/after session entered terminal status interrupted/);
  });

  it("strictly validates context compilation telemetry and safe ranges", () => {
    const valid = {
      type: "context.compiled",
      payload: {
        checkpointId: "checkpoint-1",
        compilerVersion: "context-compiler-v1",
        reason: "tool_result_boundary",
        mode: "working",
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
        payload: { ...valid.payload, compilerVersion: "context-compiler-v0" },
      }),
    ).toThrow();
    expect(() =>
      parseSessionEventData({
        ...valid,
        payload: { ...valid.payload, reason: "provider-switch" },
      }),
    ).toThrow();
    expect(() =>
      parseSessionEventData({
        ...valid,
        payload: { ...valid.payload, mode: "bounded" },
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

  it("binds context checkpoints to the active route, assistant, sequence, and mode", () => {
    const sessionId = "context-binding";
    const active = replaySession([
      stored(sessionId, 1, {
        type: "session.created",
        payload: {
          title: "Context binding",
          objective: "Bind telemetry to its inference round.",
          workspaceRoot: "/tmp/workspace",
          profile: "balanced",
          executionPolicy: {
            schemaVersion: "agentic-execution-v1",
            inferenceRounds: 2,
            toolCalls: 2,
          },
        },
      }),
      stored(sessionId, 2, { type: "session.started", payload: {} }),
      stored(sessionId, 3, {
        type: "route.assigned",
        payload: {
          providerId: "local-vllm",
          model: "RM-01 VLM",
          reason: "test",
        },
      }),
      stored(sessionId, 4, {
        type: "assistant.message.started",
        payload: {
          messageId: "assistant-context",
          providerId: "local-vllm",
          model: "RM-01 VLM",
        },
      }),
    ]);
    const payload = {
      checkpointId: `${sessionId}:context:1`,
      compilerVersion: "context-compiler-v1" as const,
      reason: "session_start" as const,
      mode: "working" as const,
      providerId: "local-vllm",
      model: "RM-01 VLM",
      maxTokens: 8_000,
      estimatedTokens: 2_000,
      estimator: "utf8-bytes-v1" as const,
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
    };

    expect(() =>
      reduceSessionEvent(
        active,
        stored(sessionId, 5, {
          type: "assistant.message.completed",
          payload: {
            messageId: "assistant-context",
            content: "No checkpoint.",
            stopReason: "stop",
          },
        }),
      ),
    ).toThrow(/without exactly one context checkpoint/);

    expect(() =>
      reduceSessionEvent(
        active,
        stored(sessionId, 5, {
          type: "context.compiled",
          payload: { ...payload, checkpointId: "forged" },
        }),
      ),
    ).toThrow(/expected context-binding:context:1/);
    expect(() =>
      reduceSessionEvent(
        active,
        stored(sessionId, 5, {
          type: "context.compiled",
          payload: { ...payload, providerId: "other-provider" },
        }),
      ),
    ).toThrow(/does not match the active route/);
    expect(() =>
      reduceSessionEvent(
        active,
        stored(sessionId, 5, {
          type: "context.compiled",
          payload: {
            ...payload,
            reason: "finalization_boundary",
          },
        }),
      ),
    ).toThrow(/incompatible with mode working/);

    const first = reduceSessionEvent(
      active,
      stored(sessionId, 5, { type: "context.compiled", payload }),
    );
    expect(() =>
      reduceSessionEvent(
        first,
        stored(sessionId, 6, {
          type: "context.compiled",
          payload: {
            ...payload,
            checkpointId: `${sessionId}:context:2`,
          },
        }),
      ),
    ).toThrow(/single pre-inference checkpoint/);
  });

  it("strictly validates completion obligations and check telemetry", () => {
    const declared = {
      type: "session.created",
      payload: {
        title: "Investigate",
        objective: "Inspect the repository with evidence.",
        workspaceRoot: "/tmp/workspace",
        profile: "balanced",
        completionObligations: {
          requiredSuccessfulTools: ["search_text", "read_text_file"],
          minimumVerifiedPathLineCitations: 2,
        },
        executionPolicy: {
          schemaVersion: "agentic-execution-v1",
          inferenceRounds: 4,
          toolCalls: 4,
        },
      },
    };
    expect(parseSessionEventData(declared)).toEqual(declared);
    const withoutPolicy = structuredClone(declared);
    delete (withoutPolicy.payload as { executionPolicy?: unknown })
      .executionPolicy;
    expect(() => parseSessionEventData(withoutPolicy)).toThrow(
      /active completion obligations require agentic-execution-v1 policy/,
    );
    expect(() =>
      parseSessionEventData({
        ...declared,
        payload: {
          ...declared.payload,
          executionPolicy: {
            ...declared.payload.executionPolicy,
            toolCalls: 1,
          },
        },
      }),
    ).toThrow(/enough tool calls/);
    expect(() =>
      parseSessionEventData({
        ...declared,
        payload: {
          ...declared.payload,
          executionPolicy: {
            ...declared.payload.executionPolicy,
            inferenceRounds: 2,
          },
        },
      }),
    ).toThrow(/plus final synthesis/);

    const repeatedRequirements = {
      ...declared,
      payload: {
        ...declared.payload,
        completionObligations: {
          ...declared.payload.completionObligations,
          requiredSuccessfulTools: [
            "search_text",
            "search_text",
            "read_text_file",
          ],
        },
      },
    };
    expect(parseSessionEventData(repeatedRequirements)).toEqual(
      repeatedRequirements,
    );
    expect(() =>
      parseSessionEventData({
        ...repeatedRequirements,
        payload: {
          ...repeatedRequirements.payload,
          executionPolicy: {
            ...repeatedRequirements.payload.executionPolicy,
            toolCalls: 2,
          },
        },
      }),
    ).toThrow(/enough tool calls/);
    expect(() =>
      parseSessionEventData({
        ...repeatedRequirements,
        payload: {
          ...repeatedRequirements.payload,
          executionPolicy: {
            ...repeatedRequirements.payload.executionPolicy,
            inferenceRounds: 3,
            toolCalls: 3,
          },
        },
      }),
    ).toThrow(/plus final synthesis/);
    expect(() =>
      parseSessionEventData({
        ...declared,
        payload: {
          ...declared.payload,
          completionObligations: {
            ...declared.payload.completionObligations,
            requiredSuccessfulTools: Array.from(
              { length: 33 },
              () => "search_text",
            ),
          },
        },
      }),
    ).toThrow();
    expect(() =>
      parseSessionEventData({
        ...declared,
        payload: {
          ...declared.payload,
          completionObligations: {
            ...declared.payload.completionObligations,
            requiredSuccessfulTools: ["run_shell"],
          },
        },
      }),
    ).toThrow();
    expect(() =>
      parseSessionEventData({
        ...declared,
        payload: {
          ...declared.payload,
          completionObligations: {
            ...declared.payload.completionObligations,
            minimumVerifiedPathLineCitations: 101,
          },
        },
      }),
    ).toThrow();

    const retryCheck = {
      type: "completion.obligations.checked",
      payload: {
        checkId: "session-1:completion:2",
        messageId: "assistant-2",
        round: 2,
        remainingRounds: 2,
        successfulRequiredTools: ["search_text"],
        missingRequiredTools: ["read_text_file"],
        verifiedPathLineCitations: ["src/a.ts:1", "src/b.ts:2"],
        unresolvedCitationCount: 0,
        outcome: "retry",
      },
    };
    expect(parseSessionEventData(retryCheck)).toEqual(retryCheck);
    expect(() =>
      parseSessionEventData({
        ...retryCheck,
        payload: {
          ...retryCheck.payload,
          verifiedPathLineCitations: ["src/b.ts:2", "src/a.ts:1"],
        },
      }),
    ).toThrow(/sorted and unique/);
    expect(() =>
      parseSessionEventData({
        ...retryCheck,
        payload: { ...retryCheck.payload, remainingRounds: 0 },
      }),
    ).toThrow(/retry obligation checks require/);
    expect(() =>
      parseSessionEventData({
        ...retryCheck,
        payload: {
          ...retryCheck.payload,
          outcome: "accepted",
        },
      }),
    ).toThrow(/accepted obligation checks cannot have missing tools/);
    expect(() =>
      parseSessionEventData({
        ...retryCheck,
        payload: {
          ...retryCheck.payload,
          outcome: "exhausted",
          unexpected: true,
        },
      }),
    ).toThrow();
  });

  it("replays ordered completion-obligation progress and gates terminal success", () => {
    const sessionId = "obligated-session";
    const beforeCompletion = replaySession([
      stored(sessionId, 1, {
        type: "session.created",
        payload: {
          title: "Investigate",
          objective: "Find and cite the implementation.",
          workspaceRoot: "/tmp/workspace",
          profile: "balanced",
          completionObligations: {
            requiredSuccessfulTools: ["search_text", "read_text_file"],
            minimumVerifiedPathLineCitations: 1,
          },
        },
      }),
      stored(sessionId, 2, { type: "session.started", payload: {} }),
      stored(sessionId, 3, {
        type: "assistant.message.started",
        payload: {
          messageId: "assistant-tools-1",
          providerId: "local-vllm",
          model: "RM-01 VLM",
        },
      }),
      stored(sessionId, 4, {
        type: "tool.call.requested",
        payload: {
          toolCallId: "search-1",
          messageId: "assistant-tools-1",
          name: "search_text",
          arguments: { query: "needle" },
        },
      }),
      stored(sessionId, 5, {
        type: "assistant.message.completed",
        payload: {
          messageId: "assistant-tools-1",
          stopReason: "tool_calls",
        },
      }),
      stored(sessionId, 6, {
        type: "tool.call.completed",
        payload: {
          toolCallId: "search-1",
          name: "search_text",
          content: JSON.stringify({
            ok: true,
            matches: [
              {
                path: "src/needle.ts",
                lineNumber: 1,
                text: "needle line one",
                textTruncated: false,
              },
            ],
            count: 1,
            filesSearched: 1,
            bytesScanned: 9,
            skipped: {
              binary: 0,
              ignored: 0,
              symlink: 0,
              tooLarge: 0,
              unreadable: 0,
            },
            truncated: false,
            outputBytes: 9,
          }),
          isError: false,
        },
      }),
      stored(sessionId, 7, {
        type: "assistant.message.started",
        payload: {
          messageId: "assistant-premature",
          providerId: "local-vllm",
          model: "RM-01 VLM",
        },
      }),
      stored(sessionId, 8, {
        type: "assistant.message.completed",
        payload: {
          messageId: "assistant-premature",
          content: "A premature answer without evidence.",
          stopReason: "stop",
          completionState: "incomplete",
        },
      }),
      stored(sessionId, 9, {
        type: "completion.obligations.checked",
        payload: {
          checkId: `${sessionId}:completion:2`,
          messageId: "assistant-premature",
          round: 2,
          remainingRounds: 2,
          successfulRequiredTools: ["search_text"],
          missingRequiredTools: ["read_text_file"],
          verifiedPathLineCitations: [],
          unresolvedCitationCount: 0,
          outcome: "retry",
        },
      }),
      stored(sessionId, 10, {
        type: "assistant.message.started",
        payload: {
          messageId: "assistant-tools-2",
          providerId: "local-vllm",
          model: "RM-01 VLM",
        },
      }),
      stored(sessionId, 11, {
        type: "tool.call.requested",
        payload: {
          toolCallId: "read-1",
          messageId: "assistant-tools-2",
          name: "read_text_file",
          arguments: { relativePath: "src/needle.ts" },
        },
      }),
      stored(sessionId, 12, {
        type: "assistant.message.completed",
        payload: {
          messageId: "assistant-tools-2",
          stopReason: "tool_calls",
        },
      }),
      stored(sessionId, 13, {
        type: "tool.call.completed",
        payload: {
          toolCallId: "read-1",
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
      stored(sessionId, 14, {
        type: "assistant.message.started",
        payload: {
          messageId: "assistant-final",
          providerId: "local-vllm",
          model: "RM-01 VLM",
        },
      }),
      stored(sessionId, 15, {
        type: "assistant.message.completed",
        payload: {
          messageId: "assistant-final",
          content: "The implementation is at src/needle.ts:1.",
          stopReason: "stop",
          completionState: "complete",
        },
      }),
      stored(sessionId, 16, {
        type: "completion.obligations.checked",
        payload: {
          checkId: `${sessionId}:completion:4`,
          messageId: "assistant-final",
          round: 4,
          remainingRounds: 0,
          successfulRequiredTools: ["search_text", "read_text_file"],
          missingRequiredTools: [],
          verifiedPathLineCitations: ["src/needle.ts:1"],
          unresolvedCitationCount: 0,
          outcome: "accepted",
        },
      }),
    ]);

    expect(beforeCompletion).toMatchObject({
      status: "running",
      completionObligations: {
        requiredSuccessfulTools: ["search_text", "read_text_file"],
        minimumVerifiedPathLineCitations: 1,
      },
      completionChecks: [
        {
          messageId: "assistant-premature",
          outcome: "retry",
          successfulRequiredTools: ["search_text"],
          missingRequiredTools: ["read_text_file"],
          sequence: 9,
        },
        {
          messageId: "assistant-final",
          outcome: "accepted",
          successfulRequiredTools: ["search_text", "read_text_file"],
          verifiedPathLineCitations: ["src/needle.ts:1"],
          sequence: 16,
        },
      ],
    });
    expect(() =>
      reduceSessionEvent(
        beforeCompletion,
        stored(sessionId, 17, {
          type: "session.completed",
          payload: { result: "A different unchecked result." },
        }),
      ),
    ).toThrow(/does not match its accepted assistant message/);

    const completed = reduceSessionEvent(
      beforeCompletion,
      stored(sessionId, 17, {
        type: "session.completed",
        payload: { result: "The implementation is at src/needle.ts:1." },
      }),
    );
    expect(completed).toMatchObject({
      status: "completed",
      result: "The implementation is at src/needle.ts:1.",
    });
    expect(() =>
      reduceSessionEvent(
        completed,
        stored(sessionId, 18, {
          type: "completion.obligations.checked",
          payload: {
            checkId: `${sessionId}:completion:5`,
            messageId: "assistant-final",
            round: 5,
            remainingRounds: 0,
            successfulRequiredTools: ["search_text", "read_text_file"],
            missingRequiredTools: [],
            verifiedPathLineCitations: ["src/needle.ts:1"],
            unresolvedCitationCount: 0,
            outcome: "accepted",
          },
        }),
      ),
    ).toThrow(/after session entered terminal status completed/);
  });

  it("rejects false completion checks and out-of-order tool progress", () => {
    const sessionId = "guarded-session";
    const noCheck = replaySession([
      stored(sessionId, 1, {
        type: "session.created",
        payload: {
          title: "Guarded task",
          objective: "Return one citation.",
          workspaceRoot: "/tmp/workspace",
          profile: "balanced",
          completionObligations: {
            requiredSuccessfulTools: [],
            minimumVerifiedPathLineCitations: 1,
          },
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
          content: "No citation.",
          stopReason: "stop",
          completionState: "complete",
        },
      }),
    ]);
    expect(() =>
      reduceSessionEvent(
        noCheck,
        stored(sessionId, 5, {
          type: "session.completed",
          payload: { result: "No citation." },
        }),
      ),
    ).toThrow(/without an immediately preceding accepted obligation check/);
    expect(() =>
      reduceSessionEvent(
        noCheck,
        stored(sessionId, 5, {
          type: "completion.obligations.checked",
          payload: {
            checkId: `${sessionId}:completion:1`,
            messageId: "assistant-1",
            round: 1,
            remainingRounds: 1,
            successfulRequiredTools: [],
            missingRequiredTools: [],
            verifiedPathLineCitations: [],
            unresolvedCitationCount: 0,
            outcome: "accepted",
          },
        }),
      ),
    ).toThrow(/expected outcome retry/);
    expect(() =>
      reduceSessionEvent(
        noCheck,
        stored(sessionId, 5, {
          type: "completion.obligations.checked",
          payload: {
            checkId: `${sessionId}:completion:1`,
            messageId: "assistant-1",
            round: 1,
            remainingRounds: 1,
            successfulRequiredTools: [],
            missingRequiredTools: [],
            verifiedPathLineCitations: ["src/invented.ts:9"],
            unresolvedCitationCount: 0,
            outcome: "accepted",
          },
        }),
      ),
    ).toThrow(/does not match replayed citation evidence/);

    const orderedSession = "ordered-tools";
    expect(() => replaySession([
      stored(orderedSession, 1, {
        type: "session.created",
        payload: {
          title: "Ordered tools",
          objective: "Search, then read.",
          workspaceRoot: "/tmp/workspace",
          profile: "balanced",
          completionObligations: {
            requiredSuccessfulTools: ["search_text", "read_text_file"],
            minimumVerifiedPathLineCitations: 0,
          },
        },
      }),
      stored(orderedSession, 2, { type: "session.started", payload: {} }),
      stored(orderedSession, 3, {
        type: "assistant.message.started",
        payload: {
          messageId: "assistant-tools",
          providerId: "local-vllm",
          model: "RM-01 VLM",
        },
      }),
      stored(orderedSession, 4, {
        type: "tool.call.requested",
        payload: {
          toolCallId: "read-first",
          messageId: "assistant-tools",
          name: "read_text_file",
          arguments: { relativePath: "src/a.ts" },
        },
      }),
      stored(orderedSession, 5, {
        type: "tool.call.requested",
        payload: {
          toolCallId: "search-second",
          messageId: "assistant-tools",
          name: "search_text",
          arguments: { query: "a" },
        },
      }),
      stored(orderedSession, 6, {
        type: "assistant.message.completed",
        payload: { messageId: "assistant-tools", stopReason: "tool_calls" },
      }),
      stored(orderedSession, 7, {
        type: "tool.call.completed",
        payload: {
          toolCallId: "read-first",
          name: "read_text_file",
          content: "read",
          isError: false,
        },
      }),
      stored(orderedSession, 8, {
        type: "tool.call.completed",
        payload: {
          toolCallId: "search-second",
          name: "search_text",
          content: "search",
          isError: false,
        },
      }),
      stored(orderedSession, 9, {
        type: "assistant.message.started",
        payload: {
          messageId: "assistant-candidate",
          providerId: "local-vllm",
          model: "RM-01 VLM",
        },
      }),
      stored(orderedSession, 10, {
        type: "assistant.message.completed",
        payload: {
          messageId: "assistant-candidate",
          content: "Done.",
          stopReason: "stop",
          completionState: "incomplete",
        },
      }),
    ])).toThrow(/must request required tool search_text/);
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
            reason: "finalization_boundary",
            mode: "finalization",
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

  it("enforces immutable message and tool-call lifecycles with global identities", () => {
    const sessionId = "immutable-lifecycle";
    const completedMessage = replaySession([
      stored(sessionId, 1, {
        type: "session.created",
        payload: {
          title: "Lifecycle",
          objective: "Prove immutable replay.",
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
        payload: { messageId: "assistant-1", content: "Original." },
      }),
    ]);

    expect(() =>
      reduceSessionEvent(
        completedMessage,
        stored(sessionId, 5, {
          type: "assistant.message.completed",
          payload: { messageId: "assistant-1", content: "Rewritten." },
        }),
      ),
    ).toThrow(/already completed/);
    expect(() =>
      reduceSessionEvent(
        completedMessage,
        stored(sessionId, 5, {
          type: "assistant.message.delta",
          payload: { messageId: "assistant-1", delta: "late" },
        }),
      ),
    ).toThrow(/no longer streaming/);
    expect(() =>
      reduceSessionEvent(
        completedMessage,
        stored(sessionId, 5, {
          type: "user.message",
          payload: { messageId: "assistant-1", content: "collision" },
        }),
      ),
    ).toThrow(/Duplicate message assistant-1/);

    const pendingTool = replaySession([
      stored("tool-lifecycle", 1, {
        type: "session.created",
        payload: {
          title: "Tool lifecycle",
          objective: "Complete one tool.",
          workspaceRoot: "/tmp/workspace",
          profile: "balanced",
        },
      }),
      stored("tool-lifecycle", 2, { type: "session.started", payload: {} }),
      stored("tool-lifecycle", 3, {
        type: "assistant.message.started",
        payload: {
          messageId: "assistant-tool-1",
          providerId: "local-vllm",
          model: "RM-01 VLM",
        },
      }),
      stored("tool-lifecycle", 4, {
        type: "tool.call.requested",
        payload: {
          toolCallId: "provider-call-0",
          messageId: "assistant-tool-1",
          name: "search_text",
          arguments: { query: "needle" },
        },
      }),
      stored("tool-lifecycle", 5, {
        type: "assistant.message.completed",
        payload: {
          messageId: "assistant-tool-1",
          stopReason: "tool_calls",
        },
      }),
    ]);
    expect(() =>
      reduceSessionEvent(
        pendingTool,
        stored("tool-lifecycle", 6, {
          type: "tool.call.completed",
          payload: {
            toolCallId: "provider-call-0",
            name: "read_text_file",
            content: "mismatch",
            isError: false,
          },
        }),
      ),
    ).toThrow(/expected search_text, received read_text_file/);

    const completedTool = reduceSessionEvent(
      pendingTool,
      stored("tool-lifecycle", 6, {
        type: "tool.call.completed",
        payload: {
          toolCallId: "provider-call-0",
          name: "search_text",
          content: "complete",
          isError: false,
        },
      }),
    );
    expect(() =>
      reduceSessionEvent(
        completedTool,
        stored("tool-lifecycle", 7, {
          type: "tool.call.completed",
          payload: {
            toolCallId: "provider-call-0",
            name: "search_text",
            content: "overwrite",
            isError: true,
          },
        }),
      ),
    ).toThrow(/already completed/);
    expect(() =>
      reduceSessionEvent(
        completedTool,
        stored("tool-lifecycle", 7, {
          type: "tool.call.requested",
          payload: {
            toolCallId: "provider-call-late",
            messageId: "assistant-tool-1",
            name: "search_text",
            arguments: { query: "late" },
          },
        }),
      ),
    ).toThrow(/cannot add tool calls after tool execution begins/);

    const nextAssistant = reduceSessionEvent(
      completedTool,
      stored("tool-lifecycle", 7, {
        type: "assistant.message.started",
        payload: {
          messageId: "assistant-tool-2",
          providerId: "local-vllm",
          model: "RM-01 VLM",
        },
      }),
    );
    expect(() =>
      reduceSessionEvent(
        nextAssistant,
        stored("tool-lifecycle", 8, {
          type: "tool.call.requested",
          payload: {
            toolCallId: "retroactive-call",
            messageId: "assistant-tool-1",
            name: "search_text",
            arguments: { query: "retroactive" },
          },
        }),
      ),
    ).toThrow(/must belong to the latest assistant message/);
    expect(() =>
      reduceSessionEvent(
        nextAssistant,
        stored("tool-lifecycle", 8, {
          type: "tool.call.requested",
          payload: {
            toolCallId: "provider-call-0",
            messageId: "assistant-tool-2",
            name: "search_text",
            arguments: { query: "different" },
          },
        }),
      ),
    ).toThrow(/Duplicate tool call provider-call-0/);

    const wrongStopReason = replaySession([
      stored("wrong-tool-stop", 1, {
        type: "session.created",
        payload: {
          title: "Wrong stop",
          objective: "Reject inconsistent transport events.",
          workspaceRoot: "/tmp/workspace",
          profile: "balanced",
        },
      }),
      stored("wrong-tool-stop", 2, { type: "session.started", payload: {} }),
      stored("wrong-tool-stop", 3, {
        type: "assistant.message.started",
        payload: {
          messageId: "assistant-wrong-stop",
          providerId: "local-vllm",
          model: "RM-01 VLM",
        },
      }),
      stored("wrong-tool-stop", 4, {
        type: "tool.call.requested",
        payload: {
          toolCallId: "wrong-stop-call",
          messageId: "assistant-wrong-stop",
          name: "read_text_file",
          arguments: { relativePath: "src/a.ts" },
        },
      }),
      stored("wrong-tool-stop", 5, {
        type: "assistant.message.completed",
        payload: {
          messageId: "assistant-wrong-stop",
          stopReason: "stop",
        },
      }),
    ]);
    expect(() =>
      reduceSessionEvent(
        wrongStopReason,
        stored("wrong-tool-stop", 6, {
          type: "tool.call.completed",
          payload: {
            toolCallId: "wrong-stop-call",
            name: "read_text_file",
            content: JSON.stringify({
              ok: true,
              text: "line\n",
              bytes: 5,
              truncated: false,
            }),
            isError: false,
          },
        }),
      ),
    ).toThrow(/requires assistant stop reason tool_calls/);
  });

  it("permits inference events only while running and rejects duplicate starts", () => {
    const sessionId = "running-state";
    const created = replaySession([
      stored(sessionId, 1, {
        type: "session.created",
        payload: {
          title: "State transitions",
          objective: "Enforce the running state.",
          workspaceRoot: "/tmp/workspace",
          profile: "balanced",
        },
      }),
    ]);
    expect(() =>
      reduceSessionEvent(
        created,
        stored(sessionId, 2, {
          type: "assistant.message.started",
          payload: {
            messageId: "assistant-before-start",
            providerId: "local-vllm",
            model: "RM-01 VLM",
          },
        }),
      ),
    ).toThrow(/while session status is created/);

    const running = reduceSessionEvent(
      created,
      stored(sessionId, 2, { type: "session.started", payload: {} }),
    );
    expect(() =>
      reduceSessionEvent(
        running,
        stored(sessionId, 3, { type: "session.started", payload: {} }),
      ),
    ).toThrow(/cannot start from status running/);
  });

  it("recomputes citation proof and requires the accepted check immediately before completion", () => {
    const sessionId = "citation-replay";
    const unchecked = replaySession([
      stored(sessionId, 1, {
        type: "session.created",
        payload: {
          title: "Citation replay",
          objective: "Return one verified citation.",
          workspaceRoot: "/tmp/workspace",
          profile: "balanced",
          completionObligations: {
            requiredSuccessfulTools: [],
            minimumVerifiedPathLineCitations: 1,
          },
        },
      }),
      stored(sessionId, 2, { type: "session.started", payload: {} }),
      stored(sessionId, 3, {
        type: "assistant.message.started",
        payload: {
          messageId: "assistant-final",
          providerId: "local-vllm",
          model: "RM-01 VLM",
        },
      }),
      stored(sessionId, 4, {
        type: "assistant.message.completed",
        payload: {
          messageId: "assistant-final",
          content: "A forged prefix src/a.ts:10 is not line one.",
          stopReason: "stop",
          completionState: "complete",
        },
      }),
    ]);
    expect(() =>
      reduceSessionEvent(
        unchecked,
        stored(sessionId, 5, {
          type: "completion.obligations.checked",
          payload: {
            checkId: `${sessionId}:completion:1`,
            messageId: "assistant-final",
            round: 1,
            remainingRounds: 0,
            successfulRequiredTools: [],
            missingRequiredTools: [],
            verifiedPathLineCitations: ["src/a.ts:1"],
            unresolvedCitationCount: 0,
            outcome: "accepted",
          },
        }),
      ),
    ).toThrow(/does not match replayed citation evidence/);

    const accepted = replaySession([
      stored("adjacent-check", 1, {
        type: "session.created",
        payload: {
          title: "Adjacent check",
          objective: "Return a citation.",
          workspaceRoot: "/tmp/workspace",
          profile: "balanced",
          completionObligations: {
            requiredSuccessfulTools: [],
            minimumVerifiedPathLineCitations: 1,
          },
        },
      }),
      stored("adjacent-check", 2, { type: "session.started", payload: {} }),
      stored("adjacent-check", 3, {
        type: "assistant.message.started",
        payload: {
          messageId: "evidence",
          providerId: "local-vllm",
          model: "RM-01 VLM",
        },
      }),
      stored("adjacent-check", 4, {
        type: "tool.call.requested",
        payload: {
          toolCallId: "read",
          messageId: "evidence",
          name: "read_text_file",
          arguments: { relativePath: "src/a.ts" },
        },
      }),
      stored("adjacent-check", 5, {
        type: "assistant.message.completed",
        payload: { messageId: "evidence", stopReason: "tool_calls" },
      }),
      stored("adjacent-check", 6, {
        type: "tool.call.completed",
        payload: {
          toolCallId: "read",
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
      stored("adjacent-check", 7, {
        type: "assistant.message.started",
        payload: {
          messageId: "final",
          providerId: "local-vllm",
          model: "RM-01 VLM",
        },
      }),
      stored("adjacent-check", 8, {
        type: "assistant.message.completed",
        payload: {
          messageId: "final",
          content: "Verified at src/a.ts:1.",
          stopReason: "stop",
          completionState: "complete",
        },
      }),
      stored("adjacent-check", 9, {
        type: "completion.obligations.checked",
        payload: {
          checkId: "adjacent-check:completion:2",
          messageId: "final",
          round: 2,
          remainingRounds: 0,
          successfulRequiredTools: [],
          missingRequiredTools: [],
          verifiedPathLineCitations: ["src/a.ts:1"],
          unresolvedCitationCount: 0,
          outcome: "accepted",
        },
      }),
    ]);
    expect(() =>
      reduceSessionEvent(
        accepted,
        stored("adjacent-check", 10, {
          type: "usage.recorded",
          payload: {
            inputTokens: 1,
            outputTokens: 1,
            reasoningTokens: 0,
            costUsd: 0,
          },
        }),
      ),
    ).toThrow(/must be followed immediately by session.completed/);
  });
});
