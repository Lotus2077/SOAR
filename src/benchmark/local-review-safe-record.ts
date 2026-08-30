import { createHash } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rmdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { EventStore } from "../main/event-store";
import type { ChangeReviewView } from "../shared/contracts";
import {
  parseSessionEventData,
  type SessionEventData,
  type StoredSessionEvent,
} from "../shared/session-events";
import { ReviewResultV1Schema } from "../shared/review-result-contract";

const id = z.string().trim().min(1).max(256);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);
const nonNegativeInteger = z.number().int().nonnegative().safe();
const nonNegativeNumber = z.number().finite().nonnegative();
const optionalId = id.optional();
const safeToolCallId = z
  .string()
  .regex(/^tool-call-[1-9][0-9]*$/u, "Expected a host-assigned tool-call ordinal.");
const SafeFinishReasonSchema = z.enum([
  "stop",
  "tool_calls",
  "length",
  "content_filter",
  "cancelled",
  "timeout",
  "error",
  "unreported",
  "other",
]);

function envelope<T extends string, S extends z.ZodType>(
  type: T,
  payload: S,
) {
  return z
    .object({
      schemaVersion: z.literal("local-review-safe-event-v1"),
      id,
      sequence: z.number().int().positive().safe(),
      type: z.literal(type),
      createdAt: z.string().datetime({ offset: true }),
      payload,
    })
    .strict();
}

const SafeEventV1Schema = z.discriminatedUnion("type", [
  envelope(
    "session.created",
    z
      .object({
        profile: z.enum(["quality", "balanced", "economy", "fast"]),
        taskTrack: z.literal("change-review-v1"),
        executionSchemaVersion: z.literal("agentic-execution-v2"),
        routingPolicy: z.literal("local_only_v1"),
        egressConsent: z.literal("none"),
      })
      .strict(),
  ),
  envelope(
    "session.started",
    z.object({ hasPersistedDeadline: z.boolean() }).strict(),
  ),
  envelope(
    "user.message",
    z.object({ messageId: id, contentBytes: nonNegativeInteger }).strict(),
  ),
  envelope(
    "routing.decision.recorded",
    z
      .object({
        decisionId: id,
        boundary: z.enum(["session_start", "evidence_complete", "provider_failure"]),
        phase: z.enum(["investigation", "synthesis"]),
        action: z.enum(["assign_new_lease", "retain_lease"]),
        reasonCode: id,
        selectedProviderId: id,
        selectedModel: id,
        selectedLeaseId: id,
        priorLeaseId: optionalId,
        checkpointId: optionalId,
        packetSha256: sha256.optional(),
        messagesSha256: sha256.optional(),
      })
      .strict(),
  ),
  envelope(
    "route.assigned",
    z
      .object({
        providerId: id,
        model: id,
        leaseId: optionalId,
        decisionId: optionalId,
        phase: z.enum(["investigation", "synthesis"]).optional(),
      })
      .strict(),
  ),
  envelope(
    "assistant.message.started",
    z
      .object({
        messageId: id,
        providerId: id,
        model: id,
        decisionId: optionalId,
        leaseId: optionalId,
        checkpointId: optionalId,
        attemptId: optionalId,
      })
      .strict(),
  ),
  envelope(
    "assistant.message.delta",
    z.object({ messageId: id, deltaBytes: nonNegativeInteger }).strict(),
  ),
  envelope(
    "assistant.message.completed",
    z
      .object({
        messageId: id,
        contentBytes: nonNegativeInteger,
        stopReason: SafeFinishReasonSchema.optional(),
        completionState: z.enum(["complete", "incomplete"]).optional(),
        reviewParseStatus: z
          .enum([
            "accepted",
            "invalid_json",
            "schema_invalid",
            "semantic_invalid",
            "snapshot_stale",
            "not_received",
          ])
          .optional(),
        attemptId: optionalId,
      })
      .strict(),
  ),
  envelope(
    "tool.call.requested",
    z
      .object({ toolCallId: safeToolCallId, name: id, messageId: optionalId })
      .strict(),
  ),
  envelope(
    "tool.call.completed",
    z
      .object({
        toolCallId: safeToolCallId,
        name: id,
        status: z.enum(["completed", "failed"]),
        durationMs: nonNegativeNumber.optional(),
      })
      .strict(),
  ),
  envelope(
    "context.compiled",
    z
      .object({
        checkpointId: id,
        compilerVersion: z.enum(["context-compiler-v1", "review-context-compiler-v1"]),
        reason: id,
        mode: id,
        providerId: id,
        model: id,
        maxTokens: nonNegativeInteger,
        estimatedTokens: nonNegativeInteger,
        reservedInputTokens: nonNegativeInteger,
        effectiveInputTokenBudget: nonNegativeInteger,
        sourceMessageCount: nonNegativeInteger,
        messageCount: nonNegativeInteger,
        evidenceCount: nonNegativeInteger,
        deduplicatedEvidenceCount: nonNegativeInteger,
        omittedEvidenceCount: nonNegativeInteger,
        packetSha256: sha256,
        messagesSha256: sha256,
        decisionId: optionalId,
        leaseId: optionalId,
        messageId: optionalId,
        attemptId: optionalId,
        reviewSnapshotId: sha256.optional(),
        reviewEvidenceSetId: sha256.optional(),
        reviewProvenanceSha256: sha256.optional(),
      })
      .strict(),
  ),
  envelope(
    "inference.attempt.started",
    z
      .object({
        attemptId: id,
        round: z.number().int().positive().safe(),
        checkpointId: id,
        messageId: id,
        decisionId: id,
        leaseId: id,
        providerId: id,
        requestedModel: id,
        phase: z.enum(["investigation", "synthesis"]),
        requestedMaxOutputTokens: z.number().int().positive().safe(),
        allowTools: z.boolean(),
        allowedToolNames: z.array(id).optional(),
        requireToolCall: z.boolean(),
        structuredOutputContract: z.literal("change-review-result-v1").optional(),
        structuredOutputSchemaSha256: sha256.optional(),
      })
      .strict(),
  ),
  envelope(
    "inference.attempt.finished",
    z
      .object({
        attemptId: id,
        checkpointId: id,
        outcome: z.enum([
          "succeeded",
          "provider_error",
          "protocol_error",
          "cancelled",
          "timeout",
          "interrupted",
        ]),
        requestDisposition: z.enum(["not_sent", "sent", "unknown"]),
        finishReason: SafeFinishReasonSchema.optional(),
        servedModelMatchesRequested: z.boolean().optional(),
        usage: z
          .object({
            inputTokens: nonNegativeInteger,
            outputTokens: nonNegativeInteger,
            reasoningTokens: nonNegativeInteger,
            cacheReadTokens: nonNegativeInteger.optional(),
            reported: z.boolean(),
          })
          .strict(),
        cost: z
          .object({
            amountMicrousd: nonNegativeInteger,
            provenance: z.enum([
              "local_zero_cost_policy",
              "provider_reported",
              "host_pricing_snapshot",
              "reserved_unknown",
            ]),
            reservationId: optionalId,
          })
          .strict(),
        latencyMs: nonNegativeNumber,
        ttftMs: nonNegativeNumber.optional(),
        errorCode: optionalId,
      })
      .strict(),
  ),
  envelope(
    "completion.obligations.checked",
    z
      .object({
        checkId: id,
        messageId: id,
        round: z.number().int().positive().safe(),
        remainingRounds: nonNegativeInteger,
        successfulRequiredTools: z.array(id),
        missingRequiredTools: z.array(id),
        verifiedCitationCount: nonNegativeInteger,
        unresolvedCitationCount: nonNegativeInteger,
        outcome: z.enum(["accepted", "retry", "exhausted"]),
      })
      .strict(),
  ),
  envelope(
    "usage.recorded",
    z
      .object({
        inputTokens: nonNegativeInteger,
        outputTokens: nonNegativeInteger,
        reasoningTokens: nonNegativeInteger,
        reported: z.boolean().optional(),
        costUsd: nonNegativeNumber,
        costProvenance: id.optional(),
        latencyMs: nonNegativeNumber.optional(),
        ttftMs: nonNegativeNumber.optional(),
      })
      .strict(),
  ),
  envelope(
    "session.completed",
    z.object({ resultBytes: nonNegativeInteger }).strict(),
  ),
  envelope("session.failed", z.object({ terminal: z.literal("failed") }).strict()),
  envelope(
    "session.cancelled",
    z.object({ terminal: z.literal("cancelled") }).strict(),
  ),
  envelope(
    "session.interrupted",
    z.object({ terminal: z.literal("interrupted") }).strict(),
  ),
]);

export type SafeLocalReviewEventV1 = z.infer<typeof SafeEventV1Schema>;

function utf8Bytes(value: string | undefined): number {
  return Buffer.byteLength(value ?? "", "utf8");
}

interface SafeProjectionState {
  readonly toolCallIds: Map<string, string>;
  readonly requestedModelsByAttemptId: Map<string, string>;
}

function createSafeProjectionState(): SafeProjectionState {
  return {
    toolCallIds: new Map<string, string>(),
    requestedModelsByAttemptId: new Map<string, string>(),
  };
}

function projectToolCallId(
  providerToolCallId: string,
  state: SafeProjectionState,
): string {
  const existing = state.toolCallIds.get(providerToolCallId);
  if (existing) return existing;
  const projected = `tool-call-${state.toolCallIds.size + 1}`;
  state.toolCallIds.set(providerToolCallId, projected);
  return projected;
}

function projectFinishReason(
  value: string | null | undefined,
): z.infer<typeof SafeFinishReasonSchema> | undefined {
  if (value === undefined) return undefined;
  if (value === null) return "unreported";
  const parsed = SafeFinishReasonSchema.safeParse(value);
  return parsed.success ? parsed.data : "other";
}

function assertNever(value: never): never {
  throw new Error(`Unsupported canonical event type: ${String(value)}`);
}

function projectSafeLocalReviewEventWithStateV1(
  event: StoredSessionEvent,
  state: SafeProjectionState,
): SafeLocalReviewEventV1 {
  const data = parseSessionEventData({ type: event.type, payload: event.payload });
  const common = {
    schemaVersion: "local-review-safe-event-v1" as const,
    id: event.id,
    sequence: event.sequence,
    type: data.type,
    createdAt: event.createdAt,
  };
  let projected: unknown;
  switch (data.type) {
    case "session.created": {
      const policy = data.payload.executionPolicy;
      if (
        data.payload.taskTrack !== "change-review-v1" ||
        policy?.schemaVersion !== "agentic-execution-v2"
      ) {
        throw new Error("Safe review projection requires a v2 change-review session.");
      }
      projected = {
        ...common,
        payload: {
          profile: data.payload.profile,
          taskTrack: data.payload.taskTrack,
          executionSchemaVersion: policy.schemaVersion,
          routingPolicy: policy.routingPolicy,
          egressConsent: policy.egressConsent,
        },
      };
      break;
    }
    case "session.started":
      projected = {
        ...common,
        payload: { hasPersistedDeadline: data.payload.deadlineAt !== undefined },
      };
      break;
    case "user.message":
      projected = {
        ...common,
        payload: {
          messageId: data.payload.messageId,
          contentBytes: utf8Bytes(data.payload.content),
        },
      };
      break;
    case "routing.decision.recorded": {
      const payload = data.payload;
      projected = {
        ...common,
        payload: {
          decisionId: payload.decisionId,
          boundary: payload.boundary,
          phase: payload.phase,
          action: payload.action,
          reasonCode: payload.reasonCode,
          selectedProviderId: payload.selectedProviderId,
          selectedModel: payload.selectedModel,
          selectedLeaseId: payload.selectedLeaseId,
          ...(payload.priorLeaseId ? { priorLeaseId: payload.priorLeaseId } : {}),
          ...(payload.checkpointId ? { checkpointId: payload.checkpointId } : {}),
          ...(payload.packetSha256 ? { packetSha256: payload.packetSha256 } : {}),
          ...(payload.messagesSha256 ? { messagesSha256: payload.messagesSha256 } : {}),
        },
      };
      break;
    }
    case "route.assigned":
      projected = {
        ...common,
        payload: {
          providerId: data.payload.providerId,
          model: data.payload.model,
          ...(data.payload.leaseId ? { leaseId: data.payload.leaseId } : {}),
          ...(data.payload.decisionId ? { decisionId: data.payload.decisionId } : {}),
          ...(data.payload.phase ? { phase: data.payload.phase } : {}),
        },
      };
      break;
    case "assistant.message.started":
      projected = {
        ...common,
        payload: {
          messageId: data.payload.messageId,
          providerId: data.payload.providerId,
          model: data.payload.model,
          ...(data.payload.decisionId ? { decisionId: data.payload.decisionId } : {}),
          ...(data.payload.leaseId ? { leaseId: data.payload.leaseId } : {}),
          ...(data.payload.checkpointId ? { checkpointId: data.payload.checkpointId } : {}),
          ...(data.payload.attemptId ? { attemptId: data.payload.attemptId } : {}),
        },
      };
      break;
    case "assistant.message.delta":
      projected = {
        ...common,
        payload: {
          messageId: data.payload.messageId,
          deltaBytes: utf8Bytes(data.payload.delta),
        },
      };
      break;
    case "assistant.message.completed":
      projected = {
        ...common,
        payload: {
          messageId: data.payload.messageId,
          contentBytes: utf8Bytes(data.payload.content),
          ...(data.payload.stopReason !== undefined
            ? { stopReason: projectFinishReason(data.payload.stopReason) }
            : {}),
          ...(data.payload.completionState
            ? { completionState: data.payload.completionState }
            : {}),
          ...(data.payload.reviewParseStatus
            ? { reviewParseStatus: data.payload.reviewParseStatus }
            : {}),
          ...(data.payload.attemptId ? { attemptId: data.payload.attemptId } : {}),
        },
      };
      break;
    case "tool.call.requested":
      projected = {
        ...common,
        payload: {
          toolCallId: projectToolCallId(data.payload.toolCallId, state),
          name: data.payload.name,
          ...(data.payload.messageId ? { messageId: data.payload.messageId } : {}),
        },
      };
      break;
    case "tool.call.completed":
      projected = {
        ...common,
        payload: {
          toolCallId: projectToolCallId(data.payload.toolCallId, state),
          name: data.payload.name,
          status: data.payload.isError ? "failed" : "completed",
          ...(data.payload.durationMs === undefined
            ? {}
            : { durationMs: data.payload.durationMs }),
        },
      };
      break;
    case "context.compiled": {
      const payload = data.payload;
      projected = {
        ...common,
        payload: {
          checkpointId: payload.checkpointId,
          compilerVersion: payload.compilerVersion,
          reason: payload.reason,
          mode: payload.mode,
          providerId: payload.providerId,
          model: payload.model,
          maxTokens: payload.maxTokens,
          estimatedTokens: payload.estimatedTokens,
          reservedInputTokens: payload.reservedInputTokens,
          effectiveInputTokenBudget: payload.effectiveInputTokenBudget,
          sourceMessageCount: payload.sourceMessageCount,
          messageCount: payload.messageCount,
          evidenceCount: payload.evidenceCount,
          deduplicatedEvidenceCount: payload.deduplicatedEvidenceCount,
          omittedEvidenceCount: payload.omittedEvidenceCount,
          packetSha256: payload.packetSha256,
          messagesSha256: payload.messagesSha256,
          ...(payload.decisionId ? { decisionId: payload.decisionId } : {}),
          ...(payload.leaseId ? { leaseId: payload.leaseId } : {}),
          ...(payload.messageId ? { messageId: payload.messageId } : {}),
          ...(payload.attemptId ? { attemptId: payload.attemptId } : {}),
          ...(payload.reviewSnapshotId ? { reviewSnapshotId: payload.reviewSnapshotId } : {}),
          ...(payload.reviewEvidenceSetId
            ? { reviewEvidenceSetId: payload.reviewEvidenceSetId }
            : {}),
          ...(payload.reviewProvenanceSha256
            ? { reviewProvenanceSha256: payload.reviewProvenanceSha256 }
            : {}),
        },
      };
      break;
    }
    case "inference.attempt.started": {
      const payload = data.payload;
      state.requestedModelsByAttemptId.set(
        payload.attemptId,
        payload.requestedModel,
      );
      projected = {
        ...common,
        payload: {
          attemptId: payload.attemptId,
          round: payload.round,
          checkpointId: payload.checkpointId,
          messageId: payload.messageId,
          decisionId: payload.decisionId,
          leaseId: payload.leaseId,
          providerId: payload.providerId,
          requestedModel: payload.requestedModel,
          phase: payload.phase,
          requestedMaxOutputTokens: payload.requestedMaxOutputTokens,
          allowTools: payload.allowTools,
          ...(payload.allowedToolNames
            ? { allowedToolNames: [...payload.allowedToolNames] }
            : {}),
          requireToolCall: payload.requireToolCall,
          ...(payload.structuredOutputContract
            ? { structuredOutputContract: payload.structuredOutputContract }
            : {}),
          ...(payload.structuredOutputSchemaSha256
            ? { structuredOutputSchemaSha256: payload.structuredOutputSchemaSha256 }
            : {}),
        },
      };
      break;
    }
    case "inference.attempt.finished": {
      const payload = data.payload;
      const requestedModel = state.requestedModelsByAttemptId.get(
        payload.attemptId,
      );
      projected = {
        ...common,
        payload: {
          attemptId: payload.attemptId,
          checkpointId: payload.checkpointId,
          outcome: payload.outcome,
          requestDisposition: payload.requestDisposition,
          ...(payload.finishReason !== undefined
            ? { finishReason: projectFinishReason(payload.finishReason) }
            : {}),
          ...(requestedModel === undefined || payload.servedModel === undefined
            ? {}
            : {
                servedModelMatchesRequested:
                  payload.servedModel === requestedModel,
              }),
          usage: {
            inputTokens: payload.usage.inputTokens,
            outputTokens: payload.usage.outputTokens,
            reasoningTokens: payload.usage.reasoningTokens,
            ...(payload.usage.cacheReadTokens === undefined
              ? {}
              : { cacheReadTokens: payload.usage.cacheReadTokens }),
            reported: payload.usage.reported,
          },
          cost: {
            amountMicrousd: payload.cost.amountMicrousd,
            provenance: payload.cost.provenance,
            ...(payload.cost.reservationId === undefined
              ? {}
              : { reservationId: payload.cost.reservationId }),
          },
          latencyMs: payload.latencyMs,
          ...(payload.ttftMs === undefined ? {} : { ttftMs: payload.ttftMs }),
          ...(payload.errorCode ? { errorCode: payload.errorCode } : {}),
        },
      };
      break;
    }
    case "completion.obligations.checked":
      projected = {
        ...common,
        payload: {
          checkId: data.payload.checkId,
          messageId: data.payload.messageId,
          round: data.payload.round,
          remainingRounds: data.payload.remainingRounds,
          successfulRequiredTools: [...data.payload.successfulRequiredTools],
          missingRequiredTools: [...data.payload.missingRequiredTools],
          verifiedCitationCount: data.payload.verifiedPathLineCitations.length,
          unresolvedCitationCount: data.payload.unresolvedCitationCount,
          outcome: data.payload.outcome,
        },
      };
      break;
    case "usage.recorded":
      projected = {
        ...common,
        payload: {
          inputTokens: data.payload.inputTokens,
          outputTokens: data.payload.outputTokens,
          reasoningTokens: data.payload.reasoningTokens,
          ...(data.payload.reported === undefined
            ? {}
            : { reported: data.payload.reported }),
          costUsd: data.payload.costUsd,
          ...(data.payload.costProvenance === undefined
            ? {}
            : { costProvenance: data.payload.costProvenance }),
          ...(data.payload.latencyMs === undefined
            ? {}
            : { latencyMs: data.payload.latencyMs }),
          ...(data.payload.ttftMs === undefined
            ? {}
            : { ttftMs: data.payload.ttftMs }),
        },
      };
      break;
    case "session.completed":
      projected = {
        ...common,
        payload: { resultBytes: utf8Bytes(data.payload.result) },
      };
      break;
    case "session.failed":
      projected = { ...common, payload: { terminal: "failed" } };
      break;
    case "session.cancelled":
      projected = { ...common, payload: { terminal: "cancelled" } };
      break;
    case "session.interrupted":
      projected = { ...common, payload: { terminal: "interrupted" } };
      break;
    default:
      return assertNever(data);
  }
  return SafeEventV1Schema.parse(projected);
}

export function projectSafeLocalReviewEventV1(
  event: StoredSessionEvent,
): SafeLocalReviewEventV1 {
  return projectSafeLocalReviewEventWithStateV1(event, createSafeProjectionState());
}

export function projectSafeLocalReviewEventsV1(
  events: readonly StoredSessionEvent[],
): SafeLocalReviewEventV1[] {
  if (events.length === 0) throw new Error("Canonical local-review trace is empty.");
  const sessionId = events[0]?.sessionId;
  events.forEach((event, index) => {
    if (event.sessionId !== sessionId) {
      throw new Error("Canonical local-review trace mixes session identities.");
    }
    if (event.sequence !== index + 1) {
      throw new Error("Canonical local-review trace sequence is not contiguous.");
    }
  });
  const state = createSafeProjectionState();
  const projected = events.map((event) =>
    projectSafeLocalReviewEventWithStateV1(event, state),
  );
  return validateSafeLocalReviewTraceV1(projected);
}

function validateSafeLocalReviewTraceV1(
  events: readonly SafeLocalReviewEventV1[],
): SafeLocalReviewEventV1[] {
  const parsed = events.map((event) => SafeEventV1Schema.parse(event));
  if (parsed.length === 0) return parsed;
  if (parsed[0]?.type !== "session.created") {
    throw new Error("Safe local-review trace must begin with session.created.");
  }
  const eventIds = new Set<string>();
  const requestedToolCalls = new Set<string>();
  const requestedToolNames = new Map<string, string>();
  const completedToolCalls = new Set<string>();
  const startedAttempts = new Set<string>();
  const finishedAttempts = new Set<string>();
  const terminalTypes = new Set([
    "session.completed",
    "session.failed",
    "session.cancelled",
    "session.interrupted",
  ]);
  let nextToolCallOrdinal = 1;
  let terminalSeen = false;

  parsed.forEach((event, index) => {
    if (event.sequence !== index + 1) {
      throw new Error("Safe local-review trace sequence is not contiguous.");
    }
    if (eventIds.has(event.id)) {
      throw new Error("Safe local-review trace event ids are not unique.");
    }
    eventIds.add(event.id);

    if (terminalSeen) {
      throw new Error("Safe local-review trace contains an event after termination.");
    }
    if (terminalTypes.has(event.type)) {
      terminalSeen = true;
      if (index !== parsed.length - 1) {
        throw new Error("Safe local-review terminal event must be last.");
      }
    }

    if (event.type === "tool.call.requested") {
      const expected = `tool-call-${nextToolCallOrdinal}`;
      if (event.payload.toolCallId !== expected) {
        throw new Error("Safe local-review tool-call ordinals are not contiguous.");
      }
      if (requestedToolCalls.has(event.payload.toolCallId)) {
        throw new Error("Safe local-review tool-call ordinal was requested twice.");
      }
      requestedToolCalls.add(event.payload.toolCallId);
      requestedToolNames.set(event.payload.toolCallId, event.payload.name);
      nextToolCallOrdinal += 1;
    } else if (event.type === "tool.call.completed") {
      if (
        !requestedToolCalls.has(event.payload.toolCallId) ||
        completedToolCalls.has(event.payload.toolCallId) ||
        requestedToolNames.get(event.payload.toolCallId) !== event.payload.name
      ) {
        throw new Error(
          "Safe local-review tool completion does not match one prior request.",
        );
      }
      completedToolCalls.add(event.payload.toolCallId);
    } else if (event.type === "inference.attempt.started") {
      if (startedAttempts.has(event.payload.attemptId)) {
        throw new Error("Safe local-review attempt identity was started twice.");
      }
      startedAttempts.add(event.payload.attemptId);
    } else if (event.type === "inference.attempt.finished") {
      if (
        !startedAttempts.has(event.payload.attemptId) ||
        finishedAttempts.has(event.payload.attemptId)
      ) {
        throw new Error(
          "Safe local-review attempt completion does not match one prior start.",
        );
      }
      finishedAttempts.add(event.payload.attemptId);
    }
  });

  return parsed;
}

const EvaluationStatusSchema = z.enum([
  "passed",
  "blocked",
  "failed",
  "cancelled",
  "invalid",
]);

const ReviewCoverageViewSchema = z
  .object({
    schemaVersion: z.literal("review-coverage-view-v1"),
    status: z.enum(["complete", "incomplete"]),
    counts: z
      .object({
        changedPaths: nonNegativeInteger,
        admittedPaths: nonNegativeInteger,
        omittedPaths: nonNegativeInteger,
        changedHunks: nonNegativeInteger,
        admittedHunks: nonNegativeInteger,
        omittedHunks: nonNegativeInteger,
      })
      .strict(),
    changedTestCount: nonNegativeInteger,
    runtimeCodeChangedWithoutChangedTest: z.boolean(),
    snapshotRevalidated: z.boolean(),
    omissionCodes: z.array(id),
  })
  .strict();

export const LocalReviewEvaluationRecordV1Schema = z
  .object({
    schemaVersion: z.literal("local-change-review-evaluation-v1"),
    runId: id,
    implementationRevision: z.string().regex(/^[0-9a-f]{40}$/u),
    status: EvaluationStatusSchema,
    source: z.enum(["canonical_event_store", "preflight"]),
    projection: z.literal("local-review-safe-v1"),
    lossy: z.literal(true),
    rawCanonicalTraceExported: z.literal(false),
    fixture: z
      .object({
        id: z.literal("cal-001-soar-plan-approval"),
        manifestSha256: sha256,
        snapshotId: sha256,
        baseRevision: z.string().regex(/^[0-9a-f]{40}$/u),
        changeRevision: z.string().regex(/^[0-9a-f]{40}$/u),
        changedPathCount: z.number().int().positive().safe(),
        changedLineCount: z.number().int().positive().safe(),
      })
      .strict(),
    execution: z
      .object({
        sessionId: id,
        terminalStatus: z.enum(["completed", "failed", "cancelled", "interrupted"]),
        providerId: id,
        model: id,
        locality: z.literal("local"),
        routingBoundaries: z.array(
          z.enum(["session_start", "evidence_complete", "provider_failure"]),
        ),
        routingDecisionCount: nonNegativeInteger,
        providerSwitchCount: nonNegativeInteger,
        inferenceAttemptCount: nonNegativeInteger,
        successfulToolCount: nonNegativeInteger,
        healthCheckCount: nonNegativeInteger,
        eventCount: z.number().int().positive().safe(),
        usage: z
          .object({
            inputTokens: nonNegativeInteger,
            outputTokens: nonNegativeInteger,
            reasoningTokens: nonNegativeInteger,
            cacheReadTokens: nonNegativeInteger,
            reportedAttempts: nonNegativeInteger,
          })
          .strict(),
        latency: z
          .object({
            inferenceMs: nonNegativeNumber,
            toolMs: nonNegativeNumber,
            endToEndMs: nonNegativeNumber,
          })
          .strict(),
        cost: z
          .object({
            amountMicrousd: z.literal(0),
            provenance: z.literal("local_zero_cost_policy"),
            endpointBillingVerified: z.literal(false),
            infrastructureCostMeasured: z.literal(false),
          })
          .strict(),
      })
      .strict()
      .optional(),
    review: z
      .object({
        freshness: z.literal("fresh_complete"),
        result: ReviewResultV1Schema,
        coverage: ReviewCoverageViewSchema,
      })
      .strict()
      .optional(),
    failureCode: id.optional(),
    artifacts: z
      .object({
        safeTrace: z
          .object({
            relativePath: z.literal("canonical-events.safe-v1.jsonl"),
            sha256,
            bytes: nonNegativeInteger,
            events: nonNegativeInteger,
          })
          .strict(),
      })
      .strict(),
    nonClaims: z.array(z.string().trim().min(1).max(512)).min(1),
  })
  .strict()
  .superRefine((record, context) => {
    const issue = (path: PropertyKey[], message: string): void => {
      context.addIssue({ code: "custom", path, message });
    };
    const isSafeProjectionEmergencyRecord =
      record.status !== "passed" &&
      record.source === "canonical_event_store" &&
      record.review === undefined &&
      (record.failureCode === "safe_projection_failed" ||
        record.failureCode === "unsafe_output");

    if (
      record.source === "preflight" &&
      (record.execution !== undefined ||
        record.review !== undefined ||
        record.artifacts.safeTrace.events !== 0)
    ) {
      issue(
        ["source"],
        "Preflight records cannot claim canonical execution, review, or trace evidence.",
      );
    }
    if (
      record.source === "canonical_event_store" &&
      !isSafeProjectionEmergencyRecord &&
      (record.execution === undefined || record.artifacts.safeTrace.events === 0)
    ) {
      issue(
        ["source"],
        "Canonical records require execution evidence and a nonempty safe trace.",
      );
    }
    if (
      isSafeProjectionEmergencyRecord &&
      record.execution === undefined &&
      record.artifacts.safeTrace.events !== 0
    ) {
      issue(
        ["artifacts", "safeTrace", "events"],
        "Emergency records without execution evidence require an empty safe trace.",
      );
    }
    if (record.review !== undefined && record.status !== "passed") {
      issue(["review"], "Only passing evaluations may retain a structured review.");
    }
    if (
      record.execution &&
      record.execution.routingDecisionCount !==
        record.execution.routingBoundaries.length
    ) {
      issue(
        ["execution", "routingDecisionCount"],
        "Routing decision count must match the recorded boundary list.",
      );
    }

    if (record.execution) {
      const terminalStatus = record.execution.terminalStatus;
      const terminalMatchesStatus =
        (record.status === "passed" && terminalStatus === "completed") ||
        (record.status === "invalid" && terminalStatus === "completed") ||
        (record.status === "blocked" && terminalStatus === "failed") ||
        (record.status === "cancelled" && terminalStatus === "cancelled") ||
        (record.status === "failed" &&
          (terminalStatus === "failed" || terminalStatus === "interrupted"));
      if (!terminalMatchesStatus) {
        issue(
          ["execution", "terminalStatus"],
          "Evaluation status does not match the canonical terminal state.",
        );
      }
    }

    if (record.status === "passed") {
      const execution = record.execution;
      const review = record.review;
      if (!execution || !review) {
        issue(
          [],
          "Passing local-review evaluations require execution and review evidence.",
        );
        return;
      }
      if (
        record.source !== "canonical_event_store" ||
        record.artifacts.safeTrace.events === 0
      ) {
        issue(
          ["source"],
          "Passing evaluations require a nonempty canonical event trace.",
        );
      }
      if (record.failureCode !== undefined) {
        issue(["failureCode"], "Passing evaluations cannot include a failure code.");
      }
      if (execution.terminalStatus !== "completed") {
        issue(
          ["execution", "terminalStatus"],
          "Passing evaluations require a completed canonical session.",
        );
      }
      if (
        JSON.stringify(execution.routingBoundaries) !==
        JSON.stringify(["session_start", "evidence_complete"])
      ) {
        issue(
          ["execution", "routingBoundaries"],
          "Passing evaluations require the exact two local-review routing boundaries.",
        );
      }
      if (execution.routingDecisionCount !== 2) {
        issue(
          ["execution", "routingDecisionCount"],
          "Passing evaluations require exactly two routing decisions.",
        );
      }
      if (execution.providerSwitchCount !== 0) {
        issue(
          ["execution", "providerSwitchCount"],
          "Passing evaluations cannot switch providers.",
        );
      }
      if (execution.inferenceAttemptCount !== 4) {
        issue(
          ["execution", "inferenceAttemptCount"],
          "Passing evaluations require exactly four inference attempts.",
        );
      }
      if (execution.successfulToolCount !== 3) {
        issue(
          ["execution", "successfulToolCount"],
          "Passing evaluations require exactly three successful tools.",
        );
      }
      if (execution.healthCheckCount < 2 || execution.healthCheckCount > 3) {
        issue(
          ["execution", "healthCheckCount"],
          "Passing evaluations require the bridge preflight, coordinator admission, and at most one synthesis revalidation health check.",
        );
      }
      if (
        execution.usage.inputTokens <= 0 ||
        execution.usage.outputTokens <= 0 ||
        execution.usage.reportedAttempts !== execution.inferenceAttemptCount
      ) {
        issue(
          ["execution", "usage"],
          "Passing evaluations require positive input/output usage reported for every attempt.",
        );
      }
      if (execution.cost.amountMicrousd !== 0) {
        issue(
          ["execution", "cost", "amountMicrousd"],
          "Passing evaluations require zero metered provider cost.",
        );
      }
      if (execution.eventCount !== record.artifacts.safeTrace.events) {
        issue(
          ["execution", "eventCount"],
          "Execution and safe-trace event counts must match.",
        );
      }
      if (
        review.freshness !== "fresh_complete" ||
        review.coverage.status !== "complete" ||
        !review.coverage.snapshotRevalidated
      ) {
        issue(
          ["review", "coverage"],
          "Passing evaluations require fresh, complete, revalidated review coverage.",
        );
      }
      const coverage = review.coverage;
      if (
        coverage.counts.changedPaths !== record.fixture.changedPathCount ||
        coverage.counts.admittedPaths !== coverage.counts.changedPaths ||
        coverage.counts.omittedPaths !== 0 ||
        coverage.counts.admittedHunks !== coverage.counts.changedHunks ||
        coverage.counts.omittedHunks !== 0 ||
        coverage.omissionCodes.length !== 0 ||
        review.result.omissions.length !== 0
      ) {
        issue(
          ["review", "coverage"],
          "Passing evaluations require full path/hunk admission and no omissions.",
        );
      }
      const hasBlockingFinding = review.result.findings.some(
        (finding) => finding.severity === "P0" || finding.severity === "P1",
      );
      const expectedConclusion = hasBlockingFinding
        ? "blocking_findings"
        : "no_blocking_findings";
      if (review.result.conclusion !== expectedConclusion) {
        issue(
          ["review", "result", "conclusion"],
          `Passing review conclusion must be ${expectedConclusion}.`,
        );
      }
      if (review.result.snapshotId !== record.fixture.snapshotId) {
        issue(
          ["review", "result", "snapshotId"],
          "The accepted review must match the frozen fixture snapshot.",
        );
      }
    }
    if (record.status !== "passed" && !record.failureCode) {
      issue(
        ["failureCode"],
        "Non-passing local-review evaluations require a stable failure code.",
      );
    }
  });

export type LocalReviewEvaluationRecordV1 = z.infer<
  typeof LocalReviewEvaluationRecordV1Schema
>;

export const LOCAL_REVIEW_EVALUATION_NON_CLAIMS = Object.freeze([
  "No claim of review quality, defect recall, precision, or false-accept rate.",
  "No claim of dynamic, cloud, paid, fallback, or multi-provider routing.",
  "No claim that endpoint billing or infrastructure cost was independently verified.",
  "No claim that the shipping default context budget can run this fixture.",
  "No claim that the research or coding workload manifests were executed.",
] as const);

const SECRET_PATTERNS = [
  /(?<![A-Za-z0-9_-])sk-(?:or-v1-)?[A-Za-z0-9_-]{20,}/u,
  /gh[pousr]_[A-Za-z0-9]{36,}/u,
  /github_pat_[A-Za-z0-9_]{20,}/u,
  /glpat-[A-Za-z0-9_-]{20,}/u,
  /xox[baprs]-[A-Za-z0-9-]{20,}/u,
  /npm_[A-Za-z0-9]{20,}/u,
  /pypi-[A-Za-z0-9_-]{20,}/u,
  /AIza[0-9A-Za-z_-]{35}/u,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/u,
  /(?:sk|rk)_live_[A-Za-z0-9]{20,}/u,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}\b/iu,
  /\bBasic\s+[A-Za-z0-9+/]{20,}={0,2}\b/iu,
  /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/u,
  /-----BEGIN PGP PRIVATE KEY BLOCK-----/u,
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{16,}/iu,
] as const;

const URL_PATTERN =
  /(?:\b[A-Za-z][A-Za-z0-9+.-]{1,31}:\/\/|\bwww\.[A-Za-z0-9.-]+\.)/iu;
const POSIX_ABSOLUTE_PATH_PATTERN =
  /(?:^|[^A-Za-z0-9._~/-])\/(?!\/)[^\s"'<>`]+/u;
const WINDOWS_ABSOLUTE_PATH_PATTERN =
  /(?:^|[^A-Za-z0-9._~\\/-])(?:[A-Za-z]:\\{1,2}|\\{2})[^\s"'<>`]+/u;
const HOME_RELATIVE_PATH_PATTERN =
  /(?:^|[^A-Za-z0-9._~/-])~\/[^\s"'<>`]+/u;
const SENSITIVE_PROVIDER_OUTPUT_MARKER =
  /"errorCode"\s*:\s*"provider_sensitive_output"/u;

export function assertSafeLocalReviewArtifactContents(
  contents: string,
  sensitiveValues: readonly string[],
): void {
  for (const value of sensitiveValues) {
    const serializedValue = JSON.stringify(value).slice(1, -1);
    if (
      value.length > 0 &&
      (contents.includes(value) || contents.includes(serializedValue))
    ) {
      throw new Error("Local-review artifact contains an exact sensitive value.");
    }
  }
  if (URL_PATTERN.test(contents)) {
    throw new Error("Local-review artifact contains a URL.");
  }
  if (
    POSIX_ABSOLUTE_PATH_PATTERN.test(contents) ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(contents) ||
    HOME_RELATIVE_PATH_PATTERN.test(contents)
  ) {
    throw new Error("Local-review artifact contains an absolute local path.");
  }
  if (SECRET_PATTERNS.some((pattern) => pattern.test(contents))) {
    throw new Error("Local-review artifact contains a credential-like value.");
  }
  if (SENSITIVE_PROVIDER_OUTPUT_MARKER.test(contents)) {
    throw new Error("Local-review artifact derives from sensitive provider output.");
  }
}

function safeSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw new Error(`${label} contains unsafe path characters.`);
  }
  return value;
}

const LocalReviewRunReservationV1Schema = z
  .object({
    schemaVersion: z.literal("local-review-run-reservation-v1"),
    runId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),
    fixtureId: z.literal("cal-001-soar-plan-approval"),
    implementationRevision: z.string().regex(/^[0-9a-f]{40}$/u),
  })
  .strict();

export type LocalReviewRunReservationV1 = Readonly<
  z.infer<typeof LocalReviewRunReservationV1Schema>
>;

interface LocalReviewArtifactPathsV1 {
  canonicalOutputRoot: string;
  canonicalParent: string;
  canonicalLedgerDirectory: string;
  canonicalReservationPath: string;
  canonicalRunParent: string;
  canonicalRunDirectory: string;
  configuredRunDirectory: string;
}

async function lstatIfPresent(filePath: string) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function isContainedPath(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

const TRUSTED_MACOS_SYSTEM_ALIASES = new Map<string, string>([
  ["/etc", "/private/etc"],
  ["/tmp", "/private/tmp"],
  ["/var", "/private/var"],
]);

async function assertNoUntrustedSymlinkComponents(
  candidate: string,
): Promise<void> {
  const resolved = path.resolve(candidate);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  const segments = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const segment of segments) {
    current = path.join(current, segment);
    const information = await lstatIfPresent(current);
    if (!information) break;
    if (!information.isSymbolicLink()) continue;
    const trustedTarget = TRUSTED_MACOS_SYSTEM_ALIASES.get(current);
    if (!trustedTarget || (await realpath(current)) !== trustedTarget) {
      throw new Error(
        "Local-review output root cannot traverse an untrusted symbolic link.",
      );
    }
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function ensurePrivateDirectory(
  directory: string,
  canonicalOutputRoot: string,
  label: string,
): Promise<void> {
  let information = await lstatIfPresent(directory);
  let created = false;
  if (!information) {
    try {
      await mkdir(directory, { mode: 0o700 });
      created = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    information = await lstatIfPresent(directory);
  }
  if (!information || information.isSymbolicLink() || !information.isDirectory()) {
    throw new Error(`${label} must be a real directory, not a symbolic link.`);
  }
  const canonicalDirectory = await realpath(directory);
  if (
    canonicalDirectory !== path.resolve(directory) ||
    !isContainedPath(canonicalDirectory, canonicalOutputRoot)
  ) {
    throw new Error(`${label} escaped the canonical local-review output root.`);
  }
  await chmod(directory, 0o700);
  if (created) await syncDirectory(path.dirname(directory));
}

async function createOutputRootWithoutSymlinks(
  configuredOutputRoot: string,
): Promise<void> {
  await assertNoUntrustedSymlinkComponents(configuredOutputRoot);
  const missingSegments: string[] = [];
  let existingAncestor = configuredOutputRoot;
  let information = await lstatIfPresent(existingAncestor);
  while (!information) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) {
      throw new Error("Local-review output root has no existing directory ancestor.");
    }
    missingSegments.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
    information = await lstatIfPresent(existingAncestor);
  }
  if (information.isSymbolicLink() || !information.isDirectory()) {
    throw new Error(
      "Local-review output root cannot be created through a symbolic link.",
    );
  }

  // macOS exposes trusted system aliases such as /var -> /private/var. Resolve
  // the nearest existing directory once, then create every missing segment on
  // that canonical path. A symlink encountered in any newly admitted segment
  // is still rejected.
  let current = await realpath(existingAncestor);
  for (const segment of missingSegments) {
    current = path.join(current, segment);
    await mkdir(current, { mode: 0o700 });
    const created = await lstat(current);
    if (created.isSymbolicLink() || !created.isDirectory()) {
      throw new Error("Local-review output root creation encountered a symlink.");
    }
    if ((await realpath(current)) !== path.resolve(current)) {
      throw new Error("Local-review output root creation escaped its lexical path.");
    }
    await syncDirectory(path.dirname(current));
  }
}

async function resolveLocalReviewArtifactPathsV1(options: {
  projectRoot: string;
  outputRoot?: string;
  runId: string;
  fixtureId: "cal-001-soar-plan-approval";
}): Promise<LocalReviewArtifactPathsV1> {
  const runId = safeSegment(options.runId, "run id");
  const configuredOutputRoot = path.resolve(
    options.outputRoot ?? path.join(options.projectRoot, "benchmarks", "runs"),
  );
  await assertNoUntrustedSymlinkComponents(configuredOutputRoot);
  const outputInformation = await lstatIfPresent(configuredOutputRoot);
  if (outputInformation?.isSymbolicLink()) {
    throw new Error("Local-review output root cannot be a symbolic link.");
  }
  if (outputInformation && !outputInformation.isDirectory()) {
    throw new Error("Local-review output root must be a directory.");
  }
  if (!outputInformation) {
    await createOutputRootWithoutSymlinks(configuredOutputRoot);
  }
  const createdOutputInformation = await lstat(configuredOutputRoot);
  if (
    createdOutputInformation.isSymbolicLink() ||
    !createdOutputInformation.isDirectory()
  ) {
    throw new Error("Local-review output root must be a real directory.");
  }

  const [canonicalOutputRoot, canonicalProjectRoot] = await Promise.all([
    realpath(configuredOutputRoot),
    realpath(options.projectRoot),
  ]);
  if (
    canonicalOutputRoot === canonicalProjectRoot ||
    canonicalProjectRoot.startsWith(`${canonicalOutputRoot}${path.sep}`)
  ) {
    throw new Error("Local-review output cannot contain the project root.");
  }

  const canonicalParent = path.join(canonicalOutputRoot, "local-review-v1");
  await ensurePrivateDirectory(
    canonicalParent,
    canonicalOutputRoot,
    "Local-review artifact parent",
  );
  const canonicalLedgerDirectory = path.join(canonicalParent, ".run-ledger");
  await ensurePrivateDirectory(
    canonicalLedgerDirectory,
    canonicalOutputRoot,
    "Local-review run ledger",
  );

  const canonicalRunParent = path.join(canonicalParent, runId);
  const canonicalRunDirectory = path.join(
    canonicalRunParent,
    options.fixtureId,
  );
  const configuredParent = path.join(configuredOutputRoot, "local-review-v1");
  return {
    canonicalOutputRoot,
    canonicalParent,
    canonicalLedgerDirectory,
    canonicalReservationPath: path.join(
      canonicalLedgerDirectory,
      `${runId}.json`,
    ),
    canonicalRunParent,
    canonicalRunDirectory,
    configuredRunDirectory: path.join(
      configuredParent,
      runId,
      options.fixtureId,
    ),
  };
}

function reservationContents(
  reservation: LocalReviewRunReservationV1,
): string {
  return `${JSON.stringify(reservation, null, 2)}\n`;
}

async function assertFinalRunTargetAbsent(
  paths: LocalReviewArtifactPathsV1,
): Promise<void> {
  if (await lstatIfPresent(paths.canonicalRunDirectory)) {
    throw new Error("Local-review final run target already exists.");
  }
}

async function assertPrivateRunNamespace(
  paths: LocalReviewArtifactPathsV1,
): Promise<void> {
  const information = await lstatIfPresent(paths.canonicalRunParent);
  if (
    !information ||
    information.isSymbolicLink() ||
    !information.isDirectory() ||
    (information.mode & 0o777) !== 0o700
  ) {
    throw new Error(
      "Local-review run namespace must be a real private directory.",
    );
  }
  const canonicalDirectory = await realpath(paths.canonicalRunParent);
  if (
    canonicalDirectory !== paths.canonicalRunParent ||
    !isContainedPath(canonicalDirectory, paths.canonicalOutputRoot)
  ) {
    throw new Error("Local-review run namespace escaped the output root.");
  }
}

async function createReservationAtPaths(
  paths: LocalReviewArtifactPathsV1,
  reservationInput: LocalReviewRunReservationV1,
): Promise<LocalReviewRunReservationV1> {
  const reservation = LocalReviewRunReservationV1Schema.parse(reservationInput);
  await assertFinalRunTargetAbsent(paths);
  try {
    await mkdir(paths.canonicalRunParent, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        "Local-review run namespace already exists, is reserved, or is unsafe.",
      );
    }
    throw error;
  }
  await chmod(paths.canonicalRunParent, 0o700);
  await assertPrivateRunNamespace(paths);
  await syncDirectory(paths.canonicalRunParent);
  await syncDirectory(paths.canonicalParent);

  let handle;
  try {
    handle = await open(paths.canonicalReservationPath, "wx", 0o600);
  } catch (error) {
    // The namespace was created by this call and is still expected to be
    // empty. Best-effort removal avoids leaving a false claim when a prior
    // durable ledger entry wins the admission race. A ledger created by this
    // call is never removed.
    await rmdir(paths.canonicalRunParent).catch(() => undefined);
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Local-review run id was already reserved.");
    }
    throw error;
  }
  try {
    await handle.writeFile(reservationContents(reservation), "utf8");
    await handle.chmod(0o600);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(paths.canonicalLedgerDirectory);
  await syncDirectory(paths.canonicalParent);
  await assertPrivateRunNamespace(paths);
  await assertFinalRunTargetAbsent(paths);
  return Object.freeze({ ...reservation });
}

export async function reserveLocalReviewRunNamespaceV1(options: {
  projectRoot: string;
  outputRoot?: string;
  runId: string;
  fixtureId: "cal-001-soar-plan-approval";
  implementationRevision: string;
}): Promise<LocalReviewRunReservationV1> {
  const reservation = LocalReviewRunReservationV1Schema.parse({
    schemaVersion: "local-review-run-reservation-v1",
    runId: safeSegment(options.runId, "run id"),
    fixtureId: options.fixtureId,
    implementationRevision: options.implementationRevision,
  });
  const paths = await resolveLocalReviewArtifactPathsV1({
    projectRoot: options.projectRoot,
    ...(options.outputRoot ? { outputRoot: options.outputRoot } : {}),
    runId: reservation.runId,
    fixtureId: reservation.fixtureId,
  });
  return createReservationAtPaths(paths, reservation);
}

async function assertReservationAtPaths(
  paths: LocalReviewArtifactPathsV1,
  reservationInput: LocalReviewRunReservationV1,
  expected: LocalReviewRunReservationV1,
): Promise<LocalReviewRunReservationV1> {
  const reservation = LocalReviewRunReservationV1Schema.parse(reservationInput);
  if (JSON.stringify(reservation) !== JSON.stringify(expected)) {
    throw new Error("Local-review run reservation does not match the export.");
  }
  const information = await lstatIfPresent(paths.canonicalReservationPath);
  if (
    !information ||
    information.isSymbolicLink() ||
    !information.isFile() ||
    information.nlink !== 1 ||
    (information.mode & 0o777) !== 0o600
  ) {
    throw new Error("Local-review run reservation is missing or unsafe.");
  }
  const stored = await readFile(paths.canonicalReservationPath, "utf8");
  if (stored !== reservationContents(expected)) {
    throw new Error("Local-review run reservation was modified.");
  }
  await assertPrivateRunNamespace(paths);
  await assertFinalRunTargetAbsent(paths);
  return reservation;
}

async function writeSynced(filePath: string, contents: string): Promise<void> {
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(filePath, 0o600);
}

export interface ExportedLocalReviewEvaluationV1 {
  runDirectory: string;
  resultPath: string;
  safeTracePath: string;
  commitMarkerPath: string;
  resultSha256: string;
  safeTraceSha256: string;
  commitMarkerSha256: string;
  resultBytes: number;
  safeTraceBytes: number;
  commitMarkerBytes: number;
}

function assertRecordMatchesSafeTraceV1(
  record: LocalReviewEvaluationRecordV1,
  events: readonly SafeLocalReviewEventV1[],
): void {
  if (record.source === "preflight") {
    if (events.length !== 0) {
      throw new Error("Preflight local-review records require an empty safe trace.");
    }
    return;
  }
  if (
    record.status !== "passed" &&
    events.length === 0 &&
    (record.failureCode === "safe_projection_failed" ||
      record.failureCode === "unsafe_output")
  ) {
    return;
  }
  const execution = record.execution;
  if (!execution || events.length === 0) {
    throw new Error("Canonical local-review records require a nonempty safe trace.");
  }
  if (execution.eventCount !== events.length) {
    throw new Error("Local-review execution and safe-trace event counts differ.");
  }

  const terminal = events.at(-1)?.type;
  const expectedTerminal = `session.${execution.terminalStatus}`;
  if (terminal !== expectedTerminal) {
    throw new Error("Local-review terminal state does not match the safe trace.");
  }

  const boundaries = events.flatMap((event) =>
    event.type === "routing.decision.recorded" ? [event.payload.boundary] : [],
  );
  if (
    execution.routingDecisionCount !== boundaries.length ||
    JSON.stringify(execution.routingBoundaries) !== JSON.stringify(boundaries)
  ) {
    throw new Error("Local-review routing evidence does not match the safe trace.");
  }

  const startedAttempts = events.flatMap((event) =>
    event.type === "inference.attempt.started" ? [event] : [],
  );
  const finishedAttempts = events.flatMap((event) =>
    event.type === "inference.attempt.finished" ? [event] : [],
  );
  if (execution.inferenceAttemptCount !== startedAttempts.length) {
    throw new Error("Local-review attempt count does not match the safe trace.");
  }
  const startedAttemptIds = new Set(
    startedAttempts.map((event) => event.payload.attemptId),
  );
  if (startedAttemptIds.size !== startedAttempts.length) {
    throw new Error("Local-review attempt starts contain duplicate identities.");
  }
  const startedAttemptsById = new Map(
    startedAttempts.map((event) => [event.payload.attemptId, event] as const),
  );
  const finishedAttemptIds = new Set<string>();
  for (const event of finishedAttempts) {
    if (
      !startedAttemptIds.has(event.payload.attemptId) ||
      finishedAttemptIds.has(event.payload.attemptId)
    ) {
      throw new Error("Local-review attempt completion is not paired with one start.");
    }
    finishedAttemptIds.add(event.payload.attemptId);
  }

  const successfulTools = events.flatMap((event) =>
    event.type === "tool.call.completed" && event.payload.status === "completed"
      ? [event]
      : [],
  );
  const successfulToolCount = successfulTools.length;
  if (execution.successfulToolCount !== successfulTools.length) {
    throw new Error("Local-review tool count does not match the safe trace.");
  }

  const routes = events.flatMap((event) =>
    event.type === "route.assigned"
      ? [{ providerId: event.payload.providerId, model: event.payload.model }]
      : [],
  );
  let providerSwitches = 0;
  for (let index = 1; index < routes.length; index += 1) {
    const prior = routes[index - 1];
    const current = routes[index];
    if (
      prior &&
      current &&
      (prior.providerId !== current.providerId || prior.model !== current.model)
    ) {
      providerSwitches += 1;
    }
  }
  if (execution.providerSwitchCount !== providerSwitches) {
    throw new Error("Local-review provider-switch count does not match the safe trace.");
  }

  const traceUsage = finishedAttempts.reduce(
    (total, event) => ({
      inputTokens: total.inputTokens + event.payload.usage.inputTokens,
      outputTokens: total.outputTokens + event.payload.usage.outputTokens,
      reasoningTokens: total.reasoningTokens + event.payload.usage.reasoningTokens,
      cacheReadTokens:
        total.cacheReadTokens + (event.payload.usage.cacheReadTokens ?? 0),
      reportedAttempts:
        total.reportedAttempts + (event.payload.usage.reported ? 1 : 0),
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      reportedAttempts: 0,
    },
  );
  if (JSON.stringify(execution.usage) !== JSON.stringify(traceUsage)) {
    throw new Error("Local-review usage does not match the safe trace.");
  }

  if (record.status === "passed") {
    if (terminal !== "session.completed") {
      throw new Error("Passing local-review traces must end in session.completed.");
    }
    const requestedTools = events.flatMap((event) =>
      event.type === "tool.call.requested" ? [event] : [],
    );
    if (
      finishedAttemptIds.size !== startedAttemptIds.size ||
      requestedTools.length !== successfulToolCount
    ) {
      throw new Error("Passing local-review traces require terminal attempts and tools.");
    }
    if (
      finishedAttempts.some(
        (event) =>
          event.payload.outcome !== "succeeded" ||
          event.payload.requestDisposition !== "sent" ||
          !event.payload.usage.reported ||
          event.payload.usage.inputTokens <= 0 ||
          event.payload.usage.outputTokens <= 0 ||
          event.payload.cost.amountMicrousd !== 0 ||
          event.payload.cost.provenance !== "local_zero_cost_policy" ||
          event.payload.cost.reservationId !== undefined,
      )
    ) {
      throw new Error("Passing local-review attempts lack valid zero-cost evidence.");
    }
    if (
      startedAttempts.some(
        (event) =>
          event.payload.providerId !== execution.providerId ||
          event.payload.requestedModel !== execution.model,
      )
    ) {
      throw new Error(
        "Passing local-review attempt starts do not match the execution identity.",
      );
    }
    const expectedToolSequence = [
      "inspect_git_changes",
      "read_text_file",
      "read_text_file",
    ];
    if (
      JSON.stringify(requestedTools.map((event) => event.payload.name)) !==
        JSON.stringify(expectedToolSequence) ||
      JSON.stringify(successfulTools.map((event) => event.payload.name)) !==
        JSON.stringify(expectedToolSequence)
    ) {
      throw new Error(
        "Passing local-review traces require the exact bounded acquisition tool sequence.",
      );
    }
    const expectedFinishReasons = ["tool_calls", "tool_calls", "tool_calls", "stop"];
    if (
      JSON.stringify(finishedAttempts.map((event) => event.payload.finishReason)) !==
      JSON.stringify(expectedFinishReasons)
    ) {
      throw new Error(
        "Passing local-review attempts require three tool calls and one complete synthesis.",
      );
    }
    if (
      finishedAttempts.some((event) => {
        const started = startedAttemptsById.get(event.payload.attemptId);
        return (
          !started ||
          event.payload.checkpointId !== started.payload.checkpointId ||
          event.payload.servedModelMatchesRequested !== true
        );
      })
    ) {
      throw new Error(
        "Passing local-review attempt completions lack requested-model evidence.",
      );
    }
    const contexts = events.flatMap((event) =>
      event.type === "context.compiled" ? [event] : [],
    );
    if (contexts.length !== startedAttempts.length) {
      throw new Error(
        "Passing local-review traces require exactly one context checkpoint per attempt.",
      );
    }
    for (const started of startedAttempts) {
      const matchingContexts = contexts.filter(
        (event) => event.payload.attemptId === started.payload.attemptId,
      );
      const context = matchingContexts[0];
      if (
        matchingContexts.length !== 1 ||
        !context ||
        context.payload.checkpointId !== started.payload.checkpointId ||
        context.payload.providerId !== execution.providerId ||
        context.payload.model !== execution.model ||
        context.payload.omittedEvidenceCount !== 0
      ) {
        throw new Error(
          "Passing local-review context checkpoints are incomplete or misbound.",
        );
      }
    }
    const finalContext = contexts.at(-1);
    if (
      finalContext?.payload.compilerVersion !== "review-context-compiler-v1" ||
      finalContext.payload.reviewSnapshotId !== record.fixture.snapshotId ||
      finalContext.payload.reviewEvidenceSetId !== record.review?.result.evidenceSetId ||
      finalContext.payload.reviewProvenanceSha256 === undefined
    ) {
      throw new Error(
        "Passing local-review synthesis context lacks immutable review identities.",
      );
    }
    const assistantStarts = events.flatMap((event) =>
      event.type === "assistant.message.started" ? [event] : [],
    );
    if (
      assistantStarts.length !== startedAttempts.length ||
      assistantStarts.some((event) => {
        const started = event.payload.attemptId
          ? startedAttemptsById.get(event.payload.attemptId)
          : undefined;
        return (
          !started ||
          event.payload.providerId !== execution.providerId ||
          event.payload.model !== execution.model ||
          event.payload.checkpointId !== started.payload.checkpointId ||
          event.payload.messageId !== started.payload.messageId
        );
      })
    ) {
      throw new Error(
        "Passing local-review assistant starts do not match their attempts.",
      );
    }
    const assistantCompletions = events.flatMap((event) =>
      event.type === "assistant.message.completed" ? [event] : [],
    );
    const finalCompletion = assistantCompletions.at(-1);
    if (
      assistantCompletions.length !== startedAttempts.length ||
      !finalCompletion ||
      finalCompletion.payload.attemptId !== startedAttempts.at(-1)?.payload.attemptId ||
      finalCompletion.payload.completionState !== "complete" ||
      finalCompletion.payload.reviewParseStatus !== "accepted"
    ) {
      throw new Error(
        "Passing local-review synthesis lacks one host-accepted final response.",
      );
    }
    const completionChecks = events.flatMap((event) =>
      event.type === "completion.obligations.checked" ? [event] : [],
    );
    const acceptedCheck = completionChecks.at(-1);
    if (
      completionChecks.length !== 1 ||
      events.at(-2) !== acceptedCheck ||
      acceptedCheck?.payload.outcome !== "accepted" ||
      acceptedCheck.payload.missingRequiredTools.length !== 0 ||
      JSON.stringify(acceptedCheck.payload.successfulRequiredTools) !==
        JSON.stringify(["inspect_git_changes"])
    ) {
      throw new Error(
        "Passing local-review trace lacks the final accepted completion check.",
      );
    }
    if (
      routes.length !== 1 ||
      routes.some(
        (route) =>
          route.providerId !== execution.providerId || route.model !== execution.model,
      )
    ) {
      throw new Error("Passing local-review routes do not match the execution identity.");
    }
    const decisions = events.flatMap((event) =>
      event.type === "routing.decision.recorded" ? [event] : [],
    );
    if (
      decisions.length !== 2 ||
      decisions.some(
        (event) =>
          event.payload.selectedProviderId !== execution.providerId ||
          event.payload.selectedModel !== execution.model,
      )
    ) {
      throw new Error(
        "Passing local-review routing decisions do not match the execution identity.",
      );
    }
    if (
      events.some(
        (event) =>
          event.type === "usage.recorded" &&
          (event.payload.costUsd !== 0 ||
            event.payload.costProvenance !== "local_zero_cost_policy"),
      )
    ) {
      throw new Error("Passing local-review usage contains nonzero cost evidence.");
    }
  }
}

export async function exportLocalReviewEvaluationV1(options: {
  projectRoot: string;
  outputRoot?: string;
  runId: string;
  record: Omit<LocalReviewEvaluationRecordV1, "artifacts">;
  safeEvents: readonly SafeLocalReviewEventV1[];
  sensitiveValues: readonly string[];
  reservation?: LocalReviewRunReservationV1;
}): Promise<ExportedLocalReviewEvaluationV1> {
  const runId = safeSegment(options.runId, "run id");
  if (options.record.runId !== runId) {
    throw new Error("Local-review record run id does not match the export run id.");
  }
  const safeEvents = validateSafeLocalReviewTraceV1(options.safeEvents);
  const traceContents = safeEvents.length
    ? `${safeEvents.map((event) => JSON.stringify(event)).join("\n")}\n`
    : "";
  assertSafeLocalReviewArtifactContents(traceContents, options.sensitiveValues);
  const safeTraceSha256 = createHash("sha256")
    .update(traceContents)
    .digest("hex");
  const safeTraceBytes = Buffer.byteLength(traceContents, "utf8");
  const record = LocalReviewEvaluationRecordV1Schema.parse({
    ...options.record,
    artifacts: {
      safeTrace: {
        relativePath: "canonical-events.safe-v1.jsonl",
        sha256: safeTraceSha256,
        bytes: safeTraceBytes,
        events: safeEvents.length,
      },
    },
  });
  if (record.runId !== runId) {
    throw new Error("Local-review record run id does not match the export run id.");
  }
  assertRecordMatchesSafeTraceV1(record, safeEvents);
  const resultContents = `${JSON.stringify(record, null, 2)}\n`;
  assertSafeLocalReviewArtifactContents(resultContents, options.sensitiveValues);
  const resultSha256 = createHash("sha256")
    .update(resultContents)
    .digest("hex");
  const resultBytes = Buffer.byteLength(resultContents, "utf8");

  const expectedReservation = LocalReviewRunReservationV1Schema.parse({
    schemaVersion: "local-review-run-reservation-v1",
    runId,
    fixtureId: record.fixture.id,
    implementationRevision: record.implementationRevision,
  });
  const paths = await resolveLocalReviewArtifactPathsV1({
    projectRoot: options.projectRoot,
    ...(options.outputRoot ? { outputRoot: options.outputRoot } : {}),
    runId,
    fixtureId: record.fixture.id,
  });
  if (options.reservation) {
    await assertReservationAtPaths(
      paths,
      options.reservation,
      expectedReservation,
    );
  } else {
    await createReservationAtPaths(paths, expectedReservation);
  }

  try {
    await mkdir(paths.canonicalRunDirectory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Local-review final run target already exists.");
    }
    throw error;
  }
  await chmod(paths.canonicalRunDirectory, 0o700);
  await ensurePrivateDirectory(
    paths.canonicalRunDirectory,
    paths.canonicalOutputRoot,
    "Local-review final run directory",
  );
  await syncDirectory(paths.canonicalRunParent);

  // The final directory is exclusively created above. Fully sync hidden
  // files first, publish each fixed filename with hard-link no-replace
  // semantics, remove the hidden links, and only then publish the commit
  // marker. Readers must treat marker absence as an incomplete, unpublished
  // run. If any step fails, the durable reservation and partial directory
  // remain fail-closed; no prior target is replaced.
  const safeTraceTemporaryPath = path.join(
    paths.canonicalRunDirectory,
    ".canonical-events.safe-v1.jsonl.partial",
  );
  const resultTemporaryPath = path.join(
    paths.canonicalRunDirectory,
    ".result.json.partial",
  );
  const safeTracePath = path.join(
    paths.canonicalRunDirectory,
    "canonical-events.safe-v1.jsonl",
  );
  const resultPath = path.join(paths.canonicalRunDirectory, "result.json");
  const commitMarkerPath = path.join(
    paths.canonicalRunDirectory,
    "publication.complete-v1.json",
  );
  const commitMarkerTemporaryPath = path.join(
    paths.canonicalRunDirectory,
    ".publication.complete-v1.json.partial",
  );
  const commitMarkerContents = `${JSON.stringify(
    {
      schemaVersion: "local-review-publication-complete-v1",
      resultSha256,
      safeTraceSha256,
      resultBytes,
      safeTraceBytes,
    },
    null,
    2,
  )}\n`;
  assertSafeLocalReviewArtifactContents(
    commitMarkerContents,
    options.sensitiveValues,
  );
  const commitMarkerSha256 = createHash("sha256")
    .update(commitMarkerContents)
    .digest("hex");
  const commitMarkerBytes = Buffer.byteLength(commitMarkerContents, "utf8");
  await writeSynced(safeTraceTemporaryPath, traceContents);
  await writeSynced(resultTemporaryPath, resultContents);
  await syncDirectory(paths.canonicalRunDirectory);
  await link(safeTraceTemporaryPath, safeTracePath);
  await link(resultTemporaryPath, resultPath);
  await unlink(safeTraceTemporaryPath);
  await unlink(resultTemporaryPath);
  await syncDirectory(paths.canonicalRunDirectory);
  await writeSynced(commitMarkerTemporaryPath, commitMarkerContents);
  await link(commitMarkerTemporaryPath, commitMarkerPath);
  await unlink(commitMarkerTemporaryPath);
  await syncDirectory(paths.canonicalRunDirectory);
  return {
    runDirectory: paths.configuredRunDirectory,
    resultPath: path.join(paths.configuredRunDirectory, "result.json"),
    safeTracePath: path.join(
      paths.configuredRunDirectory,
      "canonical-events.safe-v1.jsonl",
    ),
    commitMarkerPath: path.join(
      paths.configuredRunDirectory,
      "publication.complete-v1.json",
    ),
    resultSha256,
    safeTraceSha256,
    commitMarkerSha256,
    resultBytes,
    safeTraceBytes,
    commitMarkerBytes,
  };
}

export function canonicalLocalReviewEvents(
  store: EventStore,
  sessionId: string,
): SafeLocalReviewEventV1[] {
  return projectSafeLocalReviewEventsV1(store.getEvents(sessionId));
}

export function acceptedReviewForRecord(view: ChangeReviewView) {
  if (
    view.status !== "completed" ||
    view.freshness !== "fresh_complete" ||
    !view.reviewResult ||
    !view.coverage ||
    view.coverage.status !== "complete" ||
    !view.coverage.snapshotRevalidated
  ) {
    return undefined;
  }
  return {
    freshness: view.freshness,
    result: ReviewResultV1Schema.parse(view.reviewResult),
    coverage: ReviewCoverageViewSchema.parse(view.coverage),
  } as const;
}

export function sessionData(event: StoredSessionEvent): SessionEventData {
  return parseSessionEventData({ type: event.type, payload: event.payload });
}
