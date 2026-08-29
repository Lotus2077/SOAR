import { afterEach, describe, expect, it } from "vitest";

import { createSoarDatabase, type SoarDatabase } from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";
import { recoverRunningSessions } from "../../src/main/recovery";
import { parseSessionEventData } from "../../src/shared/session-events";

const databases: SoarDatabase[] = [];

function createStore(): EventStore {
  const database = createSoarDatabase();
  databases.push(database);
  return new EventStore(database);
}

function cloneOpenV2Session(
  store: EventStore,
  sourceSessionId: string,
  targetSessionId: string,
): void {
  const sourceEvents = store
    .getEvents(sourceSessionId)
    .filter((event) => event.sequence <= 8);
  const created = sourceEvents[0];
  if (created?.type !== "session.created") {
    throw new Error("V2 recovery fixture has no creation event");
  }
  store.createSession({
    id: targetSessionId,
    title: created.payload.title,
    objective: created.payload.objective,
    workspaceRoot: created.payload.workspaceRoot,
    profile: created.payload.profile,
    executionPolicy: created.payload.executionPolicy,
    createdAt: created.createdAt,
  });
  for (const sourceEvent of sourceEvents.slice(2)) {
    const replaced = JSON.parse(
      JSON.stringify({
        type: sourceEvent.type,
        payload: sourceEvent.payload,
      }).replaceAll(sourceSessionId, targetSessionId),
    ) as unknown;
    store.append(targetSessionId, parseSessionEventData(replaced), {
      expectedSequence: sourceEvent.sequence - 1,
      createdAt: sourceEvent.createdAt,
    });
  }
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

describe("recoverRunningSessions", () => {
  it("moves only running sessions to interrupted and is idempotent", () => {
    const store = createStore();
    store.createSession({
      id: "running-session",
      title: "Running",
      objective: "Keep working",
      workspaceRoot: "/tmp/workspace",
    });
    store.append(
      "running-session",
      { type: "session.started", payload: {} },
      { expectedSequence: 2 },
    );
    store.createSession({
      id: "created-session",
      title: "Created",
      objective: "Wait",
      workspaceRoot: "/tmp/workspace",
    });

    const recovered = recoverRunningSessions(store, {
      reason: "Desktop process restarted",
      createdAt: "2026-08-27T00:00:03.000Z",
    });

    expect(recovered).toHaveLength(1);
    expect(recovered[0].session).toMatchObject({
      id: "running-session",
      status: "interrupted",
      lastSequence: 4,
      error: "Desktop process restarted",
    });
    expect(store.requireSession("created-session").status).toBe("created");
    expect(recoverRunningSessions(store)).toEqual([]);
  });

  it("recovers every v2 crash window with an explicit terminal record", () => {
    const store = createStore();
    const sessionId = "running-v2-session";
    const startedAt = "2026-08-29T00:00:03.000Z";
    const decisionId = `${sessionId}:decision:1`;
    const leaseId = `${sessionId}:lease:1`;
    const checkpointId = `${sessionId}:context:1`;
    const attemptId = `${sessionId}:attempt:1`;
    const messageId = `${sessionId}:assistant:1`;
    store.createSession({
      id: sessionId,
      title: "Running v2",
      objective: "Recover the open attempt.",
      workspaceRoot: "/tmp/workspace",
      createdAt: "2026-08-29T00:00:01.000Z",
      executionPolicy: {
        schemaVersion: "agentic-execution-v2",
        inferenceRounds: 2,
        toolCalls: 1,
        routingPolicy: "hybrid_v0",
        maxProviderChanges: 2,
        maxPaidAttempts: 1,
        maxPaidEpisodeMicrousd: 250_000,
        maxEpisodeDurationMs: 120_000,
        attemptTimeoutMs: 30_000,
        egressConsent: "none",
      },
    });
    store.append(
      sessionId,
      {
        type: "session.started",
        payload: {
          startedAt,
          deadlineAt: "2026-08-29T00:02:03.000Z",
        },
      },
      { expectedSequence: 2, createdAt: startedAt },
    );
    store.appendMany(
      sessionId,
      [
        {
          type: "routing.decision.recorded",
          payload: {
            decisionId,
            policyVersion: "hybrid-lease-router-v0",
            boundary: "session_start",
            phase: "investigation",
            action: "assign_new_lease",
            reasonCode: "local_investigation",
            candidateProviderIds: ["local-vllm"],
            selectedProviderId: "local-vllm",
            selectedModel: "RM-01 VLM",
            selectedLeaseId: leaseId,
            riskSignals: [],
            triggerFacts: [],
            admission: {
              capability: { status: "passed", reasonCode: "capability_ok" },
              credential: {
                status: "not_applicable",
                reasonCode: "not_applicable",
              },
              health: {
                status: "not_applicable",
                reasonCode: "not_applicable",
              },
              egress: {
                status: "not_applicable",
                reasonCode: "not_applicable",
              },
              deadline: { status: "passed", reasonCode: "deadline_ok" },
              budget: {
                status: "not_applicable",
                reasonCode: "not_applicable",
              },
            },
          },
        },
        {
          type: "route.assigned",
          payload: {
            providerId: "local-vllm",
            model: "RM-01 VLM",
            reason: "local investigation",
            decisionId,
            leaseId,
            phase: "investigation",
          },
        },
        {
          type: "assistant.message.started",
          payload: {
            messageId,
            providerId: "local-vllm",
            model: "RM-01 VLM",
            decisionId,
            leaseId,
            checkpointId,
            attemptId,
          },
        },
        {
          type: "context.compiled",
          payload: {
            checkpointId,
            compilerVersion: "context-compiler-v1",
            reason: "session_start",
            mode: "working",
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
            decisionId,
            leaseId,
            messageId,
            attemptId,
          },
        },
        {
          type: "inference.attempt.started",
          payload: {
            attemptId,
            round: 1,
            checkpointId,
            messageId,
            decisionId,
            leaseId,
            providerId: "local-vllm",
            requestedModel: "RM-01 VLM",
            phase: "investigation",
            requestedMaxOutputTokens: 512,
            allowTools: true,
            allowedToolNames: ["read_text_file"],
            requireToolCall: false,
          },
        },
      ],
      {
        expectedSequence: 3,
        createdAt: "2026-08-29T00:00:04.000Z",
      },
    );

    const recovered = recoverRunningSessions(store, {
      reason: "Desktop process restarted",
      createdAt: "2026-08-29T00:00:10.000Z",
    });

    expect(recovered).toHaveLength(1);
    expect(recovered[0].attemptEvent).toMatchObject({
      sequence: 9,
      type: "inference.attempt.finished",
      payload: {
        attemptId,
        outcome: "interrupted",
        requestDisposition: "unknown",
        errorCode: "startup_recovery",
      },
    });
    expect(recovered[0].event).toMatchObject({
      sequence: 10,
      type: "session.interrupted",
    });
    const recoveredState = store.getProjectedState(sessionId);
    expect(recoveredState).toMatchObject({
      status: "interrupted",
      lastSequence: 10,
      inferenceAttempts: [
        { attemptId, finished: { outcome: "interrupted" } },
      ],
    });
    expect(
      recoveredState.messages.find((message) => message.id === messageId),
    ).toMatchObject({ status: "failed" });
    expect(recoverRunningSessions(store)).toEqual([]);

    const toolFinishSession = "tool-finish-crash";
    cloneOpenV2Session(store, sessionId, toolFinishSession);
    store.appendMany(
      toolFinishSession,
      [
        {
          type: "assistant.message.completed",
          payload: {
            messageId: `${toolFinishSession}:assistant:1`,
            stopReason: "tool_calls",
            completionState: "complete",
            attemptId: `${toolFinishSession}:attempt:1`,
          },
        },
        {
          type: "inference.attempt.finished",
          payload: {
            attemptId: `${toolFinishSession}:attempt:1`,
            checkpointId: `${toolFinishSession}:context:1`,
            outcome: "succeeded",
            requestDisposition: "sent",
            finishReason: "tool_calls",
            servedModel: "RM-01 VLM",
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              reasoningTokens: 0,
              reported: true,
            },
            cost: {
              amountMicrousd: 0,
              provenance: "local_zero_cost_policy",
            },
            latencyMs: 1,
          },
        },
      ],
      { expectedSequence: 8, createdAt: "2026-08-29T00:00:05.000Z" },
    );
    const recoveredAfterToolFinish = recoverRunningSessions(store, {
      reason: "Restart before tool request persistence",
      createdAt: "2026-08-29T00:00:10.000Z",
    });
    expect(recoveredAfterToolFinish).toHaveLength(1);
    expect(recoveredAfterToolFinish[0].event).toMatchObject({
      type: "session.interrupted",
      sequence: 11,
    });

    const pendingToolSession = "pending-tool-crash";
    cloneOpenV2Session(store, sessionId, pendingToolSession);
    store.appendMany(
      pendingToolSession,
      [
        {
          type: "assistant.message.completed",
          payload: {
            messageId: `${pendingToolSession}:assistant:1`,
            stopReason: "tool_calls",
            completionState: "complete",
            attemptId: `${pendingToolSession}:attempt:1`,
          },
        },
        {
          type: "inference.attempt.finished",
          payload: {
            attemptId: `${pendingToolSession}:attempt:1`,
            checkpointId: `${pendingToolSession}:context:1`,
            outcome: "succeeded",
            requestDisposition: "sent",
            finishReason: "tool_calls",
            servedModel: "RM-01 VLM",
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              reasoningTokens: 0,
              reported: true,
            },
            cost: {
              amountMicrousd: 0,
              provenance: "local_zero_cost_policy",
            },
            latencyMs: 1,
          },
        },
        {
          type: "tool.call.requested",
          payload: {
            toolCallId: "pending-read",
            messageId: `${pendingToolSession}:assistant:1`,
            name: "read_text_file",
            arguments: { relativePath: "README.md" },
          },
        },
      ],
      { expectedSequence: 8, createdAt: "2026-08-29T00:00:05.000Z" },
    );
    const recoveredPendingTool = recoverRunningSessions(store, {
      reason: "Restart during tool execution",
      createdAt: "2026-08-29T00:00:10.000Z",
    });
    expect(recoveredPendingTool).toHaveLength(1);
    expect(recoveredPendingTool[0].toolEvent).toMatchObject({
      type: "tool.call.completed",
      payload: {
        toolCallId: "pending-read",
        isError: true,
      },
    });
    expect(store.getProjectedState(pendingToolSession)).toMatchObject({
      status: "interrupted",
      lastSequence: 13,
    });

    const cancelledSession = "cancelled-attempt-crash";
    cloneOpenV2Session(store, sessionId, cancelledSession);
    store.append(
      cancelledSession,
      {
        type: "inference.attempt.finished",
        payload: {
          attemptId: `${cancelledSession}:attempt:1`,
          checkpointId: `${cancelledSession}:context:1`,
          outcome: "cancelled",
          requestDisposition: "sent",
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            reported: false,
          },
          cost: {
            amountMicrousd: 0,
            provenance: "local_zero_cost_policy",
          },
          latencyMs: 1,
          errorCode: "user_cancelled",
        },
      },
      { expectedSequence: 8, createdAt: "2026-08-29T00:00:05.000Z" },
    );
    const recoveredCancellation = recoverRunningSessions(store, {
      reason: "Restart after cancellation persistence",
      createdAt: "2026-08-29T00:00:10.000Z",
    });
    expect(recoveredCancellation).toHaveLength(1);
    expect(recoveredCancellation[0].event).toMatchObject({
      type: "session.cancelled",
      sequence: 10,
    });
    expect(recoverRunningSessions(store)).toEqual([]);
  });
});
