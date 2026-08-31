import { describe, expect, it } from "vitest";

import {
  AgenticExecutionPolicySchema,
  parseSessionEventData,
  parseStoredSessionEvent,
  type AgenticExecutionPolicyV2,
  type CompletionObligations,
  type RoutingDecisionPayload,
  type SessionEventData,
  type StoredSessionEvent,
} from "../../src/shared/session-events";
import {
  reduceSessionEvent,
  replaySession,
  type SessionState,
} from "../../src/shared/session-reducer";

const sessionId = "v2-session";
const localProvider = "local-vllm";
const localModel = "RM-01 VLM";
const initialDecisionId = `${sessionId}:decision:1`;
const initialLeaseId = `${sessionId}:lease:1`;
const V2_POLICY = {
  schemaVersion: "agentic-execution-v2",
  inferenceRounds: 8,
  toolCalls: 4,
  routingPolicy: "hybrid_v0",
  maxProviderChanges: 2,
  maxPaidAttempts: 1,
  maxPaidEpisodeMicrousd: 250_000,
  maxEpisodeDurationMs: 120_000,
  attemptTimeoutMs: 30_000,
  egressConsent: "session_cloud_synthesis_v1",
} as const;

function timestamp(sequence: number): string {
  return new Date(Date.UTC(2026, 7, 29, 0, 0, sequence)).toISOString();
}

function stored(
  sequence: number,
  event: SessionEventData,
  id = sessionId,
): StoredSessionEvent {
  return parseStoredSessionEvent({
    id: `${id}:event:${sequence}`,
    sessionId: id,
    sequence,
    createdAt: timestamp(sequence),
    ...event,
  });
}

function created(
  id = sessionId,
  completionObligations?: CompletionObligations,
  executionPolicy: AgenticExecutionPolicyV2 = V2_POLICY,
): StoredSessionEvent {
  return stored(
    1,
    {
      type: "session.created",
      payload: {
        title: "V2 task",
        objective: "Exercise the replay contract.",
        workspaceRoot: "/tmp/workspace",
        profile: "balanced",
        ...(completionObligations === undefined
          ? {}
          : { completionObligations }),
        executionPolicy,
      },
    },
    id,
  );
}

function started(sequence = 2, id = sessionId): StoredSessionEvent {
  const startedAt = timestamp(sequence);
  return stored(
    sequence,
    {
      type: "session.started",
      payload: {
        startedAt,
        deadlineAt: new Date(Date.parse(startedAt) + 120_000).toISOString(),
      },
    },
    id,
  );
}

function admission(
  status: "local" | "all_passed" = "local",
): RoutingDecisionPayload["admission"] {
  const notApplicable = {
    status: "not_applicable" as const,
    reasonCode: "not_applicable" as const,
  };
  const passed = (
    reasonCode:
      | "budget_ok"
      | "capability_ok"
      | "credential_ok"
      | "deadline_ok"
      | "egress_ok"
      | "health_ok",
  ) => ({
    status: "passed" as const,
    reasonCode,
  });
  return status === "all_passed"
    ? {
        capability: passed("capability_ok"),
        credential: passed("credential_ok"),
        health: passed("health_ok"),
        egress: passed("egress_ok"),
        deadline: passed("deadline_ok"),
        budget: passed("budget_ok"),
      }
    : {
        capability: passed("capability_ok"),
        credential: notApplicable,
        health: notApplicable,
        egress: notApplicable,
        deadline: passed("deadline_ok"),
        budget: notApplicable,
      };
}

function initialDecisionPayload(
  overrides: Partial<RoutingDecisionPayload> = {},
): RoutingDecisionPayload {
  return {
    decisionId: initialDecisionId,
    policyVersion: "hybrid-lease-router-v0",
    boundary: "session_start",
    phase: "investigation",
    action: "assign_new_lease",
    reasonCode: "local_investigation",
    candidateProviderIds: [localProvider],
    selectedProviderId: localProvider,
    selectedModel: localModel,
    selectedLeaseId: initialLeaseId,
    riskSignals: [],
    triggerFacts: [],
    admission: admission(),
    ...overrides,
  };
}

function decision(
  overrides: Partial<RoutingDecisionPayload> = {},
): StoredSessionEvent {
  const payload = initialDecisionPayload(overrides);
  return stored(3, { type: "routing.decision.recorded", payload });
}

function cloudDecisionPayload(
  overrides: Partial<RoutingDecisionPayload> = {},
): RoutingDecisionPayload {
  return {
    ...initialDecisionPayload(),
    decisionId: `${sessionId}:decision:cloud`,
    boundary: "evidence_complete",
    phase: "synthesis",
    reasonCode: "cloud_admitted",
    candidateProviderIds: ["cloud-provider", localProvider],
    selectedProviderId: "cloud-provider",
    selectedModel: "cloud-model",
    priorLeaseId: initialLeaseId,
    selectedLeaseId: `${sessionId}:lease:cloud`,
    admission: admission("all_passed"),
    healthSnapshotId: "health-1",
    pricingSnapshotId: "pricing-1",
    campaignId: "campaign-1",
    budgetReservationId: "reservation-1",
    credentialMetadataId: "credential-1",
    billing: {
      billableInputTokens: 200,
      billableCacheReadTokens: 0,
      requestedMaxOutputTokens: 512,
      inputMicrousdPerMillionTokens: 1,
      outputMicrousdPerMillionTokens: 1,
      providerFeeCeilingMicrousd: 0,
      roundingPolicy: "ceil_each_component_v1",
      projectedCostMicrousd: 2,
      remainingEpisodeMicrousd: 2,
      remainingCampaignMicrousd: 2,
    },
    checkpointId: `${sessionId}:context:2`,
    packetSha256: "a".repeat(64),
    messagesSha256: "b".repeat(64),
    ...overrides,
  };
}

function budgetDeniedDecisionPayload(
  overrides: Partial<RoutingDecisionPayload> = {},
): RoutingDecisionPayload {
  const allPassed = admission("all_passed");
  return {
    ...initialDecisionPayload(),
    decisionId: `${sessionId}:decision:budget-denied`,
    boundary: "evidence_complete",
    phase: "synthesis",
    action: "retain_lease",
    reasonCode: "budget_denial",
    candidateProviderIds: ["cloud-provider", localProvider],
    selectedProviderId: localProvider,
    selectedModel: localModel,
    proposedProviderId: "cloud-provider",
    proposedModel: "cloud-model",
    priorLeaseId: initialLeaseId,
    selectedLeaseId: initialLeaseId,
    admission: {
      ...allPassed,
      budget: { status: "denied", reasonCode: "budget_denial" },
    },
    healthSnapshotId: "health-1",
    pricingSnapshotId: "pricing-1",
    campaignId: "campaign-1",
    credentialMetadataId: "credential-1",
    billing: {
      billableInputTokens: 777,
      billableCacheReadTokens: 0,
      requestedMaxOutputTokens: 2_048,
      inputMicrousdPerMillionTokens: 1,
      outputMicrousdPerMillionTokens: 1,
      providerFeeCeilingMicrousd: 0,
      roundingPolicy: "ceil_each_component_v1",
      projectedCostMicrousd: 2,
      remainingEpisodeMicrousd: 1,
      remainingCampaignMicrousd: 2,
    },
    proposalCheckpointId: `${sessionId}:proposal-context:1`,
    proposalPacketSha256: "c".repeat(64),
    proposalMessagesSha256: "d".repeat(64),
    ...overrides,
  };
}

function route(sequence = 4): StoredSessionEvent {
  return stored(sequence, {
    type: "route.assigned",
    payload: {
      providerId: localProvider,
      model: localModel,
      reason: "local investigation",
      decisionId: initialDecisionId,
      leaseId: initialLeaseId,
      phase: "investigation",
    },
  });
}

function cloudRoute(sequence: number): StoredSessionEvent {
  return stored(sequence, {
    type: "route.assigned",
    payload: {
      providerId: "cloud-provider",
      model: "cloud-model",
      reason: "admitted cloud synthesis",
      decisionId: `${sessionId}:decision:cloud`,
      leaseId: `${sessionId}:lease:cloud`,
      phase: "synthesis",
    },
  });
}

interface RoundOptions {
  sequence: number;
  ordinal: number;
  messageId: string;
  decisionId?: string;
  leaseId?: string;
  phase?: "investigation" | "synthesis";
  reason?:
    | "session_start"
    | "tool_result_boundary"
    | "obligation_retry_boundary"
    | "finalization_boundary";
  mode?: "working" | "finalization";
  allowTools?: boolean;
  requireToolCall?: boolean;
  providerId?: string;
  model?: string;
  budgetReservationId?: string;
}

function roundStart(options: RoundOptions): StoredSessionEvent[] {
  const decisionId = options.decisionId ?? initialDecisionId;
  const leaseId = options.leaseId ?? initialLeaseId;
  const phase = options.phase ?? "investigation";
  const checkpointId = `${sessionId}:context:${options.ordinal}`;
  const attemptId = `${sessionId}:attempt:${options.ordinal}`;
  const allowTools = options.allowTools ?? false;
  const providerId = options.providerId ?? localProvider;
  const model = options.model ?? localModel;
  return [
    stored(options.sequence, {
      type: "assistant.message.started",
      payload: {
        messageId: options.messageId,
        providerId,
        model,
        decisionId,
        leaseId,
        checkpointId,
        attemptId,
      },
    }),
    stored(options.sequence + 1, {
      type: "context.compiled",
      payload: {
        checkpointId,
        compilerVersion: "context-compiler-v1",
        reason: options.reason ?? "session_start",
        mode: options.mode ?? "working",
        providerId,
        model,
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
        messageId: options.messageId,
        attemptId,
      },
    }),
    stored(options.sequence + 2, {
      type: "inference.attempt.started",
      payload: {
        attemptId,
        round: options.ordinal,
        checkpointId,
        messageId: options.messageId,
        decisionId,
        leaseId,
        providerId,
        requestedModel: model,
        phase,
        requestedMaxOutputTokens: 512,
        allowTools,
        ...(options.budgetReservationId === undefined
          ? {}
          : { budgetReservationId: options.budgetReservationId }),
        ...(allowTools
          ? { allowedToolNames: ["read_text_file"], requireToolCall: options.requireToolCall ?? false }
          : { requireToolCall: false }),
      },
    }),
  ];
}

function assistantCompleted(
  sequence: number,
  ordinal: number,
  messageId: string,
  stopReason = "stop",
): StoredSessionEvent {
  return stored(sequence, {
    type: "assistant.message.completed",
    payload: {
      messageId,
      ...(stopReason === "tool_calls" ? {} : { content: "Done." }),
      stopReason,
      completionState: "complete",
      attemptId: `${sessionId}:attempt:${ordinal}`,
    },
  });
}

function attemptFinished(
  sequence: number,
  ordinal: number,
  outcome: "succeeded" | "provider_error" | "cancelled" = "succeeded",
  finishReason = "stop",
): StoredSessionEvent {
  return stored(sequence, {
    type: "inference.attempt.finished",
    payload: {
      attemptId: `${sessionId}:attempt:${ordinal}`,
      checkpointId: `${sessionId}:context:${ordinal}`,
      outcome,
      requestDisposition: "sent",
      ...(outcome === "succeeded"
        ? { finishReason, servedModel: localModel }
        : { errorCode: outcome === "cancelled" ? "user_cancelled" : "provider_failed" }),
      usage: {
        inputTokens: outcome === "succeeded" ? 20 : 0,
        outputTokens: outcome === "succeeded" ? 5 : 0,
        reasoningTokens: 0,
        reported: outcome === "succeeded",
      },
      cost: {
        amountMicrousd: 0,
        provenance: "local_zero_cost_policy",
      },
      latencyMs: 25,
      ...(outcome === "succeeded" ? { ttftMs: 5 } : {}),
    },
  });
}

function reservedUnknownFinished(
  sequence: number,
  ordinal: number,
  amountMicrousd: number,
): StoredSessionEvent {
  return stored(sequence, {
    type: "inference.attempt.finished",
    payload: {
      attemptId: `${sessionId}:attempt:${ordinal}`,
      checkpointId: `${sessionId}:context:${ordinal}`,
      outcome: "interrupted",
      requestDisposition: "unknown",
      errorCode: "startup_recovery",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        reported: false,
      },
      cost: {
        amountMicrousd,
        provenance: "reserved_unknown",
        reservationId: "reservation-1",
      },
      latencyMs: 0,
    },
  });
}

function initialStateThroughAttempt(): SessionState {
  return replaySession([
    created(),
    started(),
    decision(),
    route(),
    ...roundStart({ sequence: 5, ordinal: 1, messageId: "assistant-1" }),
  ]);
}

function evidenceReadyPrefix(
  executionPolicy: AgenticExecutionPolicyV2 = V2_POLICY,
): StoredSessionEvent[] {
  return [
    created(sessionId, undefined, executionPolicy),
    started(),
    decision(),
    route(),
    ...roundStart({
      sequence: 5,
      ordinal: 1,
      messageId: "tool-round",
      allowTools: true,
      requireToolCall: true,
    }),
    assistantCompleted(8, 1, "tool-round", "tool_calls"),
    attemptFinished(9, 1, "succeeded", "tool_calls"),
    stored(10, {
      type: "tool.call.requested",
      payload: {
        toolCallId: "read-1",
        messageId: "tool-round",
        name: "read_text_file",
        arguments: { relativePath: "README.md" },
      },
    }),
    stored(11, {
      type: "tool.call.completed",
      payload: {
        toolCallId: "read-1",
        name: "read_text_file",
        content: JSON.stringify({
          ok: true,
          text: "SOAR",
          bytes: 4,
          truncated: false,
        }),
        isError: false,
      },
    }),
  ];
}

describe("agentic-execution-v2 schemas", () => {
  it("strictly validates v2 policy limits without changing the v1 policy shape", () => {
    const v1 = {
      schemaVersion: "agentic-execution-v1",
      inferenceRounds: 2,
      toolCalls: 1,
    } as const;
    expect(AgenticExecutionPolicySchema.parse(v1)).toEqual(v1);
    expect(() =>
      AgenticExecutionPolicySchema.parse({
        ...V2_POLICY,
        attemptTimeoutMs: 120_001,
      }),
    ).toThrow(/attemptTimeoutMs/);
    expect(() =>
      AgenticExecutionPolicySchema.parse({
        ...V2_POLICY,
        unknown: true,
      }),
    ).toThrow();
  });

  it("rejects unsorted candidates, incoherent retained leases, and incomplete cloud admission", () => {
    expect(() =>
      parseSessionEventData({
        type: decision().type,
      }),
    ).toThrow();

    expect(() =>
      parseSessionEventData({
        type: "routing.decision.recorded",
        payload: {
          ...initialDecisionPayload(),
          candidateProviderIds: ["z-provider", "a-provider"],
        },
      }),
    ).toThrow(/sorted/);

    expect(() =>
      parseSessionEventData({
        type: "routing.decision.recorded",
        payload: {
          ...initialDecisionPayload(),
          action: "retain_lease",
          priorLeaseId: "other-lease",
        },
      }),
    ).toThrow(/matching prior/);

    expect(() =>
      parseSessionEventData({
        type: "routing.decision.recorded",
        payload: {
          ...initialDecisionPayload(),
          reasonCode: "cloud_admitted",
          admission: admission("all_passed"),
        },
      }),
    ).toThrow(/cloud admission requires/);

    expect(() =>
      parseSessionEventData({
        type: "routing.decision.recorded",
        payload: {
          ...initialDecisionPayload(),
          budgetReservationId: "forged-reservation",
        },
      }),
    ).toThrow(/reserved for cloud admission or proposal/);

    expect(() =>
      parseSessionEventData({
        type: "routing.decision.recorded",
        payload: cloudDecisionPayload({
          boundary: "session_start",
          phase: "investigation",
          priorLeaseId: undefined,
        }),
      }),
    ).toThrow(/only at evidence_complete/);

    expect(
      parseSessionEventData({
        type: "routing.decision.recorded",
        payload: cloudDecisionPayload(),
      }),
    ).toMatchObject({
      payload: { billing: { projectedCostMicrousd: 2 } },
    });

    expect(() =>
      parseSessionEventData({
        type: "routing.decision.recorded",
        payload: cloudDecisionPayload({
          billing: {
            ...cloudDecisionPayload().billing!,
            projectedCostMicrousd: 1,
          },
        }),
      }),
    ).toThrow(/ceil_each_component_v1/);

    expect(() =>
      parseSessionEventData({
        type: "routing.decision.recorded",
        payload: cloudDecisionPayload({
          billing: {
            ...cloudDecisionPayload().billing!,
            remainingEpisodeMicrousd: 1,
          },
        }),
      }),
    ).toThrow(/passed budget check cannot exceed/);
  });

  it("persists exact denied cloud-proposal inputs without creating a reservation", () => {
    expect(
      parseSessionEventData({
        type: "routing.decision.recorded",
        payload: budgetDeniedDecisionPayload(),
      }),
    ).toMatchObject({
      payload: {
        reasonCode: "budget_denial",
        selectedProviderId: localProvider,
        proposedProviderId: "cloud-provider",
        billing: {
          projectedCostMicrousd: 2,
          remainingEpisodeMicrousd: 1,
        },
        proposalCheckpointId: `${sessionId}:proposal-context:1`,
      },
    });

    const notApplicable = {
      status: "not_applicable" as const,
      reasonCode: "not_applicable" as const,
    };
    const allPassed = admission("all_passed");
    expect(
      parseSessionEventData({
        type: "routing.decision.recorded",
        payload: budgetDeniedDecisionPayload({
          reasonCode: "egress_denial",
          admission: {
            ...allPassed,
            egress: { status: "denied", reasonCode: "egress_denial" },
            budget: notApplicable,
          },
          billing: undefined,
        }),
      }),
    ).toMatchObject({
      payload: {
        reasonCode: "egress_denial",
        proposalMessagesSha256: "d".repeat(64),
      },
    });
    expect(
      parseSessionEventData({
        type: "routing.decision.recorded",
        payload: budgetDeniedDecisionPayload({
          reasonCode: "unhealthy_provider",
          admission: {
            ...allPassed,
            health: { status: "denied", reasonCode: "unhealthy_provider" },
            egress: notApplicable,
            budget: notApplicable,
          },
          pricingSnapshotId: undefined,
          campaignId: undefined,
          billing: undefined,
          proposalCheckpointId: undefined,
          proposalPacketSha256: undefined,
          proposalMessagesSha256: undefined,
        }),
      }),
    ).toMatchObject({
      payload: {
        reasonCode: "unhealthy_provider",
        healthSnapshotId: "health-1",
      },
    });

    expect(() =>
      parseSessionEventData({
        type: "routing.decision.recorded",
        payload: budgetDeniedDecisionPayload({
          budgetReservationId: "forged-reservation",
        }),
      }),
    ).toThrow(/denied cloud proposal cannot reserve paid budget/);

    expect(() =>
      parseSessionEventData({
        type: "routing.decision.recorded",
        payload: budgetDeniedDecisionPayload({
          proposalMessagesSha256: undefined,
        }),
      }),
    ).toThrow(/proposal checkpoint, packet hash, and message hash/);

    expect(() =>
      parseSessionEventData({
        type: "routing.decision.recorded",
        payload: budgetDeniedDecisionPayload({ billing: undefined }),
      }),
    ).toThrow(/budget_denial requires an exact billing projection/);

    expect(() =>
      parseSessionEventData({
        type: "routing.decision.recorded",
        payload: budgetDeniedDecisionPayload({
          billing: {
            ...budgetDeniedDecisionPayload().billing!,
            remainingEpisodeMicrousd: 2,
          },
        }),
      }),
    ).toThrow(/projected cost to exceed a remaining budget/);
  });

  it("keeps disabled-provider denials unmapped and restricts risk data to evidence_complete", () => {
    const notApplicable = {
      status: "not_applicable" as const,
      reasonCode: "not_applicable" as const,
    };
    expect(
      parseSessionEventData({
        type: "routing.decision.recorded",
        payload: budgetDeniedDecisionPayload({
          reasonCode: "disabled_provider",
          admission: {
            capability: notApplicable,
            credential: notApplicable,
            health: notApplicable,
            egress: notApplicable,
            deadline: notApplicable,
            budget: notApplicable,
          },
          healthSnapshotId: undefined,
          pricingSnapshotId: undefined,
          campaignId: undefined,
          credentialMetadataId: undefined,
          billing: undefined,
          proposalCheckpointId: undefined,
          proposalPacketSha256: undefined,
          proposalMessagesSha256: undefined,
        }),
      }),
    ).toMatchObject({ payload: { reasonCode: "disabled_provider" } });

    expect(() =>
      parseSessionEventData({
        type: "routing.decision.recorded",
        payload: initialDecisionPayload({
          riskPolicyId: "review-risk-v1",
          riskScore: 0,
        }),
      }),
    ).toThrow(/risk data is allowed only at evidence_complete/);

    expect(() =>
      parseSessionEventData({
        type: "routing.decision.recorded",
        payload: budgetDeniedDecisionPayload({
          admission: admission("all_passed"),
        }),
      }),
    ).toThrow(/requires a denied budget admission check/);
  });
});

describe("agentic-execution-v2 replay state machine", () => {
  it("accepts equal batch timestamps and rejects backdated v2 events", () => {
    const message = stored(2, {
      type: "user.message",
      payload: { messageId: "same-timestamp", content: "Continue." },
    });
    const equalTimestamp = parseStoredSessionEvent({
      ...message,
      createdAt: timestamp(1),
    });
    expect(replaySession([created(), equalTimestamp])).toMatchObject({
      lastSequence: 2,
      updatedAt: timestamp(1),
    });

    const backdated = parseStoredSessionEvent({
      ...message,
      createdAt: timestamp(0),
    });
    expect(() => replaySession([created(), backdated])).toThrow(
      /createdAt must be nondecreasing/,
    );
  });

  it("replays one complete attempt and derives usage only from its finish", () => {
    const state = replaySession([
      created(),
      started(),
      decision(),
      route(),
      ...roundStart({ sequence: 5, ordinal: 1, messageId: "assistant-1" }),
      assistantCompleted(8, 1, "assistant-1"),
      attemptFinished(9, 1),
      stored(10, { type: "session.completed", payload: { result: "Done." } }),
    ]);

    expect(state).toMatchObject({
      status: "completed",
      result: "Done.",
      startedAt: timestamp(2),
      routingDecisions: [{ decisionId: initialDecisionId }],
      routes: [{ leaseId: initialLeaseId, decisionId: initialDecisionId }],
      inferenceAttempts: [
        {
          attemptId: `${sessionId}:attempt:1`,
          finished: { outcome: "succeeded" },
        },
      ],
      usage: {
        inputTokens: 20,
        outputTokens: 5,
        reasoningTokens: 0,
        costUsd: 0,
        latencyMs: 25,
        ttftMs: 5,
      },
    });
  });

  it("enforces the exact routing-boundary start order", () => {
    const decided = replaySession([created(), started(), decision()]);
    expect(() =>
      reduceSessionEvent(
        decided,
        roundStart({ sequence: 4, ordinal: 1, messageId: "assistant-1" })[0],
      ),
    ).toThrow(/must be followed by route\.assigned/);

    const routed = reduceSessionEvent(decided, route());
    expect(() =>
      reduceSessionEvent(
        routed,
        stored(5, { type: "session.failed", payload: { error: "skip start" } }),
      ),
    ).toThrow(/followed by assistant\.message\.started/);

    const assistant = reduceSessionEvent(
      routed,
      roundStart({ sequence: 5, ordinal: 1, messageId: "assistant-1" })[0],
    );
    const attemptedWithoutContext = roundStart({
      sequence: 5,
      ordinal: 1,
      messageId: "assistant-1",
    })[2];
    if (attemptedWithoutContext?.type !== "inference.attempt.started") {
      throw new Error("roundStart did not produce an attempt start");
    }
    expect(() =>
      reduceSessionEvent(
        assistant,
        stored(6, {
          type: attemptedWithoutContext.type,
          payload: attemptedWithoutContext.payload,
        }),
      ),
    ).toThrow(/followed by context\.compiled/);
  });

  it("permits a routine retained-lease round only after a completed tool and emits no route decision", () => {
    const state = replaySession([
      created(),
      started(),
      decision(),
      route(),
      ...roundStart({
        sequence: 5,
        ordinal: 1,
        messageId: "tool-round",
        allowTools: true,
        requireToolCall: true,
      }),
      assistantCompleted(8, 1, "tool-round", "tool_calls"),
      attemptFinished(9, 1, "succeeded", "tool_calls"),
      stored(10, {
        type: "tool.call.requested",
        payload: {
          toolCallId: "read-1",
          messageId: "tool-round",
          name: "read_text_file",
          arguments: { relativePath: "README.md" },
        },
      }),
      stored(11, {
        type: "tool.call.completed",
        payload: {
          toolCallId: "read-1",
          name: "read_text_file",
          content: JSON.stringify({ ok: true, text: "SOAR", bytes: 4, truncated: false }),
          isError: false,
        },
      }),
      ...roundStart({
        sequence: 12,
        ordinal: 2,
        messageId: "routine-round",
        reason: "tool_result_boundary",
      }),
      assistantCompleted(15, 2, "routine-round"),
      attemptFinished(16, 2),
    ]);

    expect(state.routes).toHaveLength(1);
    expect(state.routingDecisions).toHaveLength(1);
    expect(state.inferenceAttempts).toHaveLength(2);

    expect(() =>
      reduceSessionEvent(
        replaySession([
          created(),
          started(),
          decision(),
          route(),
          ...roundStart({ sequence: 5, ordinal: 1, messageId: "assistant-1" }),
          assistantCompleted(8, 1, "assistant-1"),
          attemptFinished(9, 1),
        ]),
        roundStart({ sequence: 10, ordinal: 2, messageId: "illegal-routine" })[0],
      ),
    ).toThrow(/must immediately follow tool completion or an obligation retry/);
  });

  it("records an evidence boundary while retaining the existing lease without another route", () => {
    const evidenceReady = replaySession([
      created(),
      started(),
      decision(),
      route(),
      ...roundStart({
        sequence: 5,
        ordinal: 1,
        messageId: "tool-round",
        allowTools: true,
        requireToolCall: true,
      }),
      assistantCompleted(8, 1, "tool-round", "tool_calls"),
      attemptFinished(9, 1, "succeeded", "tool_calls"),
      stored(10, {
        type: "tool.call.requested",
        payload: {
          toolCallId: "read-1",
          messageId: "tool-round",
          name: "read_text_file",
          arguments: { relativePath: "README.md" },
        },
      }),
      stored(11, {
        type: "tool.call.completed",
        payload: {
          toolCallId: "read-1",
          name: "read_text_file",
          content: JSON.stringify({ ok: true, text: "SOAR", bytes: 4, truncated: false }),
          isError: false,
        },
      }),
    ]);
    const synthesisDecisionId = `${sessionId}:decision:2`;
    const retained = reduceSessionEvent(
      evidenceReady,
      stored(12, {
        type: "routing.decision.recorded",
        payload: initialDecisionPayload({
          decisionId: synthesisDecisionId,
          boundary: "evidence_complete",
          phase: "synthesis",
          action: "retain_lease",
          reasonCode: "low_risk_local_review",
          priorLeaseId: initialLeaseId,
          riskPolicyId: "review-risk-v1",
          riskScore: 0,
          riskSignals: [],
        }),
      }),
    );
    const synthesis = replaySession([
      ...[
        created(),
        started(),
        decision(),
        route(),
        ...roundStart({
          sequence: 5,
          ordinal: 1,
          messageId: "tool-round",
          allowTools: true,
          requireToolCall: true,
        }),
        assistantCompleted(8, 1, "tool-round", "tool_calls"),
        attemptFinished(9, 1, "succeeded", "tool_calls"),
        stored(10, {
          type: "tool.call.requested",
          payload: {
            toolCallId: "read-1",
            messageId: "tool-round",
            name: "read_text_file",
            arguments: { relativePath: "README.md" },
          },
        }),
        stored(11, {
          type: "tool.call.completed",
          payload: {
            toolCallId: "read-1",
            name: "read_text_file",
            content: JSON.stringify({ ok: true, text: "SOAR", bytes: 4, truncated: false }),
            isError: false,
          },
        }),
      ],
      stored(12, {
        type: "routing.decision.recorded",
        payload: initialDecisionPayload({
          decisionId: synthesisDecisionId,
          boundary: "evidence_complete",
          phase: "synthesis",
          action: "retain_lease",
          reasonCode: "low_risk_local_review",
          priorLeaseId: initialLeaseId,
          riskPolicyId: "review-risk-v1",
          riskScore: 0,
          riskSignals: [],
        }),
      }),
      ...roundStart({
        sequence: 13,
        ordinal: 2,
        messageId: "synthesis",
        decisionId: synthesisDecisionId,
        phase: "synthesis",
        reason: "finalization_boundary",
        mode: "finalization",
      }),
    ]);

    expect(retained.routes).toHaveLength(1);
    expect(synthesis.routes).toHaveLength(1);
    expect(synthesis.routingDecisions).toHaveLength(2);
    expect(synthesis.inferenceAttempts.at(-1)).toMatchObject({
      decisionId: synthesisDecisionId,
      leaseId: initialLeaseId,
      phase: "synthesis",
    });

    expect(() => reduceSessionEvent(retained, route(13))).toThrow(
      /must be followed by assistant\.message\.started/,
    );
  });

  it("rejects evidence_complete when the investigation produced only failed evidence", () => {
    const failedEvidence = evidenceReadyPrefix();
    const completion = failedEvidence.at(-1);
    if (completion?.type !== "tool.call.completed") {
      throw new Error("expected a tool completion fixture");
    }
    completion.payload.isError = true;

    const investigated = replaySession(failedEvidence);
    expect(() =>
      reduceSessionEvent(
        investigated,
        stored(12, {
          type: "routing.decision.recorded",
          payload: initialDecisionPayload({
            decisionId: `${sessionId}:decision:failed-evidence`,
            boundary: "evidence_complete",
            phase: "synthesis",
            action: "retain_lease",
            reasonCode: "low_risk_local_review",
            priorLeaseId: initialLeaseId,
            riskPolicyId: "review-risk-v1",
            riskScore: 0,
            riskSignals: [],
          }),
        }),
      ),
    ).toThrow(
      /evidence_complete requires successful investigation and completed evidence obligations/u,
    );
  });

  it("retains local synthesis while preserving a denied cloud proposal packet", () => {
    const deniedDecisionId = `${sessionId}:decision:budget-denied`;
    const state = replaySession([
      created(),
      started(),
      decision(),
      route(),
      ...roundStart({
        sequence: 5,
        ordinal: 1,
        messageId: "tool-round",
        allowTools: true,
        requireToolCall: true,
      }),
      assistantCompleted(8, 1, "tool-round", "tool_calls"),
      attemptFinished(9, 1, "succeeded", "tool_calls"),
      stored(10, {
        type: "tool.call.requested",
        payload: {
          toolCallId: "read-1",
          messageId: "tool-round",
          name: "read_text_file",
          arguments: { relativePath: "README.md" },
        },
      }),
      stored(11, {
        type: "tool.call.completed",
        payload: {
          toolCallId: "read-1",
          name: "read_text_file",
          content: JSON.stringify({
            ok: true,
            text: "SOAR",
            bytes: 4,
            truncated: false,
          }),
          isError: false,
        },
      }),
      stored(12, {
        type: "routing.decision.recorded",
        payload: budgetDeniedDecisionPayload(),
      }),
      ...roundStart({
        sequence: 13,
        ordinal: 2,
        messageId: "local-denied-fallback",
        decisionId: deniedDecisionId,
        leaseId: initialLeaseId,
        phase: "synthesis",
        reason: "finalization_boundary",
        mode: "finalization",
      }),
    ]);

    expect(state.routes).toHaveLength(1);
    expect(state.inferenceAttempts.at(-1)).toMatchObject({
      decisionId: deniedDecisionId,
      providerId: localProvider,
      requestedMaxOutputTokens: 512,
    });
    expect(state.routingDecisions.at(-1)).toMatchObject({
      selectedProviderId: localProvider,
      proposedProviderId: "cloud-provider",
      proposalPacketSha256: "c".repeat(64),
      billing: {
        billableInputTokens: 777,
        requestedMaxOutputTokens: 2_048,
      },
    });
  });

  it("requires hybrid policy and consent for a denial after egress passed", () => {
    const noConsentHybrid = {
      ...V2_POLICY,
      egressConsent: "none",
    } as const;
    const localOnly = {
      ...noConsentHybrid,
      routingPolicy: "local_only_v1",
    } as const;
    const deniedDecision = stored(12, {
      type: "routing.decision.recorded",
      payload: budgetDeniedDecisionPayload(),
    });

    expect(() =>
      replaySession([...evidenceReadyPrefix(localOnly), deniedDecision]),
    ).toThrow(/requires the hybrid_v0 routing policy/);
    expect(() =>
      replaySession([
        ...evidenceReadyPrefix(noConsentHybrid),
        deniedDecision,
      ]),
    ).toThrow(/cannot record passed egress without session cloud-synthesis consent/);

    const notApplicable = {
      status: "not_applicable" as const,
      reasonCode: "not_applicable" as const,
    };
    const allPassed = admission("all_passed");
    const egressDeniedPayload = budgetDeniedDecisionPayload({
      reasonCode: "egress_denial",
      admission: {
        ...allPassed,
        egress: { status: "denied", reasonCode: "egress_denial" },
        budget: notApplicable,
      },
    });
    delete egressDeniedPayload.billing;
    const egressDenied = replaySession([
      ...evidenceReadyPrefix(noConsentHybrid),
      stored(12, {
        type: "routing.decision.recorded",
        payload: egressDeniedPayload,
      }),
    ]);
    expect(egressDenied.routingDecisions.at(-1)).toMatchObject({
      reasonCode: "egress_denial",
      admission: { egress: { status: "denied" } },
    });
  });

  it("keeps an unscoped reserved_unknown charge out of actual session spend", () => {
    const investigation = [
      created(),
      started(),
      decision(),
      route(),
      ...roundStart({
        sequence: 5,
        ordinal: 1,
        messageId: "tool-round",
        allowTools: true,
        requireToolCall: true,
      }),
      assistantCompleted(8, 1, "tool-round", "tool_calls"),
      attemptFinished(9, 1, "succeeded", "tool_calls"),
      stored(10, {
        type: "tool.call.requested" as const,
        payload: {
          toolCallId: "read-1",
          messageId: "tool-round",
          name: "read_text_file",
          arguments: { relativePath: "README.md" },
        },
      }),
      stored(11, {
        type: "tool.call.completed" as const,
        payload: {
          toolCallId: "read-1",
          name: "read_text_file",
          content: JSON.stringify({
            ok: true,
            text: "SOAR",
            bytes: 4,
            truncated: false,
          }),
          isError: false,
        },
      }),
      stored(12, {
        type: "routing.decision.recorded" as const,
        payload: cloudDecisionPayload(),
      }),
      cloudRoute(13),
      ...roundStart({
        sequence: 14,
        ordinal: 2,
        messageId: "cloud-synthesis",
        decisionId: `${sessionId}:decision:cloud`,
        leaseId: `${sessionId}:lease:cloud`,
        phase: "synthesis",
        reason: "finalization_boundary",
        mode: "finalization",
        providerId: "cloud-provider",
        model: "cloud-model",
        budgetReservationId: "reservation-1",
      }),
    ];
    const state = replaySession([
      ...investigation,
      reservedUnknownFinished(17, 2, 2),
      stored(18, {
        type: "session.interrupted",
        payload: { reason: "startup recovery" },
      }),
    ]);

    expect(state).toMatchObject({
      status: "interrupted",
      usage: { costUsd: 0 },
      costScopes: {
        actual: { reservedMicrousd: 0, settledMicrousd: 0 },
        legacyUnclassified: {
          reservedMicrousd: 2,
          settledMicrousd: 2,
          present: true,
        },
      },
      inferenceAttempts: [
        {},
        {
          budgetReservationId: "reservation-1",
          finished: {
            cost: {
              amountMicrousd: 2,
              provenance: "reserved_unknown",
              reservationId: "reservation-1",
            },
          },
        },
      ],
    });

    for (const understatedAmount of [0, 1]) {
      expect(() =>
        replaySession([
          ...investigation,
          reservedUnknownFinished(17, 2, understatedAmount),
        ]),
      ).toThrow(/must equal its originating full reservation/);
    }
  });

  it("starts an obligation-retry round on the retained lease without rerouting", () => {
    const retrying = replaySession([
      created(sessionId, {
        requiredSuccessfulTools: [],
        minimumVerifiedPathLineCitations: 1,
      }),
      started(),
      decision(),
      route(),
      ...roundStart({ sequence: 5, ordinal: 1, messageId: "candidate" }),
      stored(8, {
        type: "assistant.message.completed",
        payload: {
          messageId: "candidate",
          content: "No verified evidence.",
          stopReason: "stop",
          completionState: "incomplete",
          attemptId: `${sessionId}:attempt:1`,
        },
      }),
      attemptFinished(9, 1),
      stored(10, {
        type: "completion.obligations.checked",
        payload: {
          checkId: `${sessionId}:completion:1`,
          messageId: "candidate",
          round: 1,
          remainingRounds: 7,
          successfulRequiredTools: [],
          missingRequiredTools: [],
          verifiedPathLineCitations: [],
          unresolvedCitationCount: 0,
          outcome: "retry",
        },
      }),
      ...roundStart({
        sequence: 11,
        ordinal: 2,
        messageId: "retry",
        reason: "obligation_retry_boundary",
        mode: "finalization",
      }),
    ]);

    expect(retrying.routes).toHaveLength(1);
    expect(retrying.routingDecisions).toHaveLength(1);
    expect(retrying.inferenceAttempts).toHaveLength(2);
    expect(retrying.inferenceAttempts.at(-1)).toMatchObject({
      decisionId: initialDecisionId,
      leaseId: initialLeaseId,
      round: 2,
    });
  });

  it("rejects mismatched cross-links and output before attempt start", () => {
    const routed = replaySession([created(), started(), decision(), route()]);
    const startEvents = roundStart({ sequence: 5, ordinal: 1, messageId: "assistant-1" });
    const assistantStart = startEvents[0];
    const contextCheckpoint = startEvents[1];
    if (
      assistantStart?.type !== "assistant.message.started" ||
      contextCheckpoint?.type !== "context.compiled"
    ) {
      throw new Error("roundStart returned an invalid event tuple");
    }
    const assistant = reduceSessionEvent(routed, assistantStart);
    expect(() =>
      reduceSessionEvent(
        assistant,
        stored(6, {
          type: "context.compiled",
          payload: {
            ...contextCheckpoint.payload,
            attemptId: "forged-attempt",
          },
        }),
      ),
    ).toThrow(/does not match its v2/);

    const checkpointed = reduceSessionEvent(assistant, contextCheckpoint);
    expect(() =>
      reduceSessionEvent(
        checkpointed,
        stored(7, {
          type: "assistant.message.delta",
          payload: { messageId: "assistant-1", delta: "premature" },
        }),
      ),
    ).toThrow(/followed by inference\.attempt\.started/);
  });

  it("allows tools and completion checks only after a successful terminal attempt", () => {
    const open = initialStateThroughAttempt();
    expect(() =>
      reduceSessionEvent(
        open,
        stored(8, {
          type: "tool.call.requested",
          payload: {
            toolCallId: "premature",
            messageId: "assistant-1",
            name: "read_text_file",
            arguments: {},
          },
        }),
      ),
    ).toThrow(/Open inference attempt|successful v2 attempt|completed assistant/);

    const failed = replaySession([
      created(),
      started(),
      decision(),
      route(),
      ...roundStart({ sequence: 5, ordinal: 1, messageId: "assistant-1" }),
      attemptFinished(8, 1, "provider_error"),
    ]);
    expect(failed.messages.at(-1)).toMatchObject({
      status: "failed",
      completionState: "incomplete",
    });
  });

  it("rejects terminal events with an open attempt and rejects legacy usage in v2", () => {
    const open = initialStateThroughAttempt();
    expect(() =>
      reduceSessionEvent(
        open,
        stored(8, { type: "session.interrupted", payload: { reason: "restart" } }),
      ),
    ).toThrow(/Open inference attempt|open attempt/);
    const finished = replaySession([
      created(),
      started(),
      decision(),
      route(),
      ...roundStart({ sequence: 5, ordinal: 1, messageId: "assistant-1" }),
      assistantCompleted(8, 1, "assistant-1"),
      attemptFinished(9, 1),
    ]);
    expect(() =>
      reduceSessionEvent(
        finished,
        stored(10, {
          type: "usage.recorded",
          payload: {
            inputTokens: 1,
            outputTokens: 1,
            reasoningTokens: 0,
            costUsd: 0,
          },
        }),
      ),
    ).toThrow(/v1-only source/);
  });

  it("rejects positive or metered cost on an unreserved attempt", () => {
    const completed = reduceSessionEvent(
      initialStateThroughAttempt(),
      assistantCompleted(8, 1, "assistant-1"),
    );
    const validFinish = attemptFinished(9, 1);
    if (validFinish.type !== "inference.attempt.finished") {
      throw new Error("attemptFinished returned the wrong event type");
    }
    expect(() =>
      reduceSessionEvent(
        completed,
        stored(9, {
          type: "inference.attempt.finished",
          payload: {
            ...validFinish.payload,
            cost: {
              amountMicrousd: 1,
              provenance: "provider_reported",
            },
          },
        }),
      ),
    ).toThrow(/must use local zero-cost accounting/);
  });

  it("rejects provider-failure routing after local or cancelled attempts", () => {
    const failed = replaySession([
      created(),
      started(),
      decision(),
      route(),
      ...roundStart({ sequence: 5, ordinal: 1, messageId: "assistant-1" }),
      attemptFinished(8, 1, "provider_error"),
    ]);
    const fallback = stored(9, {
      type: "routing.decision.recorded",
      payload: {
        ...initialDecisionPayload(),
        decisionId: `${sessionId}:decision:2`,
        boundary: "provider_failure",
        phase: "synthesis",
        action: "assign_new_lease",
        reasonCode: "local_fallback",
        priorLeaseId: initialLeaseId,
        selectedLeaseId: `${sessionId}:lease:2`,
      },
    });
    expect(() => reduceSessionEvent(failed, fallback)).toThrow(
      /failed admitted-cloud attempt/,
    );

    const cancelled = replaySession([
      created(),
      started(),
      decision(),
      route(),
      ...roundStart({ sequence: 5, ordinal: 1, messageId: "assistant-1" }),
      attemptFinished(8, 1, "cancelled"),
    ]);
    expect(() => reduceSessionEvent(cancelled, fallback)).toThrow(
      /cancelled v2 attempt|failed admitted-cloud attempt/,
    );
  });
});

describe("v1 compatibility", () => {
  it("parses and replays a legacy stream without adding links or attempt usage", () => {
    const legacyEvents = [
      stored(1, {
        type: "session.created",
        payload: {
          title: "Legacy",
          objective: "Keep v1 stable.",
          workspaceRoot: "/tmp/workspace",
          profile: "balanced",
          executionPolicy: {
            schemaVersion: "agentic-execution-v1",
            inferenceRounds: 1,
            toolCalls: 1,
          },
        },
      }, "legacy"),
      stored(2, { type: "session.started", payload: {} }, "legacy"),
      stored(3, {
        type: "route.assigned",
        payload: { providerId: localProvider, model: localModel, reason: "legacy local" },
      }, "legacy"),
      stored(4, {
        type: "assistant.message.started",
        payload: { messageId: "legacy-answer", providerId: localProvider, model: localModel },
      }, "legacy"),
      stored(5, {
        type: "context.compiled",
        payload: {
          checkpointId: "legacy:context:1",
          compilerVersion: "context-compiler-v1",
          reason: "session_start",
          mode: "finalization",
          providerId: localProvider,
          model: localModel,
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
      }, "legacy"),
      stored(6, {
        type: "assistant.message.completed",
        payload: { messageId: "legacy-answer", content: "Legacy done.", stopReason: "stop" },
      }, "legacy"),
      stored(7, {
        type: "usage.recorded",
        payload: { inputTokens: 4, outputTokens: 2, reasoningTokens: 0, costUsd: 0 },
      }, "legacy"),
      stored(8, { type: "session.completed", payload: { result: "Legacy done." } }, "legacy"),
    ];
    const state = replaySession(legacyEvents);
    expect(state).toMatchObject({
      id: "legacy",
      status: "completed",
      executionPolicy: { schemaVersion: "agentic-execution-v1" },
      routingDecisions: [],
      inferenceAttempts: [],
      usage: { inputTokens: 4, outputTokens: 2, costUsd: 0 },
    });
    expect(state.routes[0]).not.toHaveProperty("decisionId");
    expect(state.messages.at(-1)).not.toHaveProperty("attemptId");
    expect(state).not.toHaveProperty("lastV2EventType");
  });
});
