import type {
  SessionEventView,
  SessionSnapshot,
  SessionSummary,
  SessionUpdate,
} from "../shared/contracts";
import type { StoredSessionEvent } from "../shared/session-events";
import { EventStore, type SessionRecord } from "./event-store";
import type { SessionState } from "../shared/session-reducer";
import { HYBRID_SIMULATION_RESULT_MARKER } from "../shared/hybrid-simulation-contracts";

export function toSessionSummary(
  session: SessionRecord,
  state?: SessionState,
): SessionSummary {
  const isSimulation = state?.hybridSimulation !== undefined;
  return {
    id: session.id,
    title: session.title,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    ...(isSimulation
      ? {
          executionMode: "hybrid_simulation" as const,
          simulationMarker: HYBRID_SIMULATION_RESULT_MARKER,
        }
      : {}),
  };
}

function reviewSafePayload(event: StoredSessionEvent): unknown {
  switch (event.type) {
    case "routing.decision.recorded":
      return {
        decisionId: event.payload.decisionId,
        boundary: event.payload.boundary,
        phase: event.payload.phase,
        action: event.payload.action,
        reasonCode: event.payload.reasonCode,
        selectedProviderId: event.payload.selectedProviderId,
        selectedModel: event.payload.selectedModel,
        costScope: event.payload.costScope,
        cloudEgressAdmissionId: event.payload.cloudEgressAdmissionId,
        ...(event.payload.costScope === "simulation" &&
        event.payload.budgetReservationId !== undefined &&
        event.payload.billing !== undefined
          ? {
              // The renderer reconstructs fail-closed simulation accounting
              // from this allowlisted projection. Reservation identity plus
              // the projected total are sufficient; component rates, token
              // estimates, and remaining-budget details stay main-only.
              budgetReservationId: event.payload.budgetReservationId,
              billing: {
                projectedCostMicrousd:
                  event.payload.billing.projectedCostMicrousd,
              },
            }
          : {}),
        ...(event.payload.routerInputSnapshot === undefined
          ? {}
          : {
              routerInputSnapshot: {
                providers: event.payload.routerInputSnapshot.providers.map(
                  (provider) => ({
                    providerId: provider.providerId,
                    model: provider.model,
                    locality: provider.locality,
                  }),
                ),
              },
            }),
      };
    case "cloud.egress.admission.recorded":
      return {
        admissionId: event.payload.admissionId,
        policyVersion: event.payload.policyVersion,
        decision: event.payload.decision,
        reasonCodes: event.payload.reasonCodes,
        checkpointId: event.payload.checkpointId,
        simulationAuthorityId: event.payload.simulationAuthorityId,
        evaluatedAt: event.payload.evaluatedAt,
      };
    case "route.assigned":
      return {
        providerId: event.payload.providerId,
        model: event.payload.model,
        reason: event.payload.reason,
        decisionId: event.payload.decisionId,
        leaseId: event.payload.leaseId,
        phase: event.payload.phase,
      };
    case "assistant.message.started":
      return {
        messageId: event.payload.messageId,
        providerId: event.payload.providerId,
        model: event.payload.model,
        decisionId: event.payload.decisionId,
        leaseId: event.payload.leaseId,
        checkpointId: event.payload.checkpointId,
        attemptId: event.payload.attemptId,
      };
    case "assistant.message.delta":
      return { messageId: event.payload.messageId, delta: "" };
    case "assistant.message.completed":
      return {
        messageId: event.payload.messageId,
        stopReason: event.payload.stopReason,
        completionState: event.payload.completionState,
        reviewParseStatus: event.payload.reviewParseStatus,
        attemptId: event.payload.attemptId,
      };
    case "tool.call.requested":
      return {
        toolCallId: event.payload.toolCallId,
        name: event.payload.name,
        messageId: event.payload.messageId,
      };
    case "tool.call.completed":
      return {
        toolCallId: event.payload.toolCallId,
        name: event.payload.name,
        isError: event.payload.isError,
        durationMs: event.payload.durationMs,
      };
    case "context.compiled":
      return {
        checkpointId: event.payload.checkpointId,
        compilerVersion: event.payload.compilerVersion,
        reason: event.payload.reason,
        mode: event.payload.mode,
        providerId: event.payload.providerId,
        model: event.payload.model,
        estimatedTokens: event.payload.estimatedTokens,
        evidenceCount: event.payload.evidenceCount,
        omittedEvidenceCount: event.payload.omittedEvidenceCount,
        decisionId: event.payload.decisionId,
        leaseId: event.payload.leaseId,
        messageId: event.payload.messageId,
        attemptId: event.payload.attemptId,
      };
    case "inference.attempt.started":
      return {
        attemptId: event.payload.attemptId,
        checkpointId: event.payload.checkpointId,
        messageId: event.payload.messageId,
        decisionId: event.payload.decisionId,
        leaseId: event.payload.leaseId,
        providerId: event.payload.providerId,
        requestedModel: event.payload.requestedModel,
        phase: event.payload.phase,
        requestedMaxOutputTokens: event.payload.requestedMaxOutputTokens,
        allowTools: event.payload.allowTools,
        allowedToolNames: event.payload.allowedToolNames,
        requireToolCall: event.payload.requireToolCall,
        structuredOutputContract: event.payload.structuredOutputContract,
        structuredOutputSchemaSha256:
          event.payload.structuredOutputSchemaSha256,
        costScope: event.payload.costScope,
        cloudEgressAdmissionId: event.payload.cloudEgressAdmissionId,
      };
    case "inference.attempt.finished":
      return {
        attemptId: event.payload.attemptId,
        checkpointId: event.payload.checkpointId,
        outcome: event.payload.outcome,
        requestDisposition: event.payload.requestDisposition,
        finishReason: event.payload.finishReason,
        servedModel: event.payload.servedModel,
        usage: event.payload.usage,
        cost: event.payload.cost,
        latencyMs: event.payload.latencyMs,
        ttftMs: event.payload.ttftMs,
        errorCode: event.payload.errorCode,
      };
    case "completion.obligations.checked":
      return {
        checkId: event.payload.checkId,
        messageId: event.payload.messageId,
        round: event.payload.round,
        remainingRounds: event.payload.remainingRounds,
        successfulRequiredTools: event.payload.successfulRequiredTools,
        missingRequiredTools: event.payload.missingRequiredTools,
        unresolvedCitationCount: event.payload.unresolvedCitationCount,
        outcome: event.payload.outcome,
      };
    case "session.completed":
      return {};
    case "session.failed":
      return {
        error:
          "The local review failed. Detailed diagnostics remain in the main-process event log.",
      };
    case "session.cancelled":
      return { reason: "The local review was cancelled." };
    case "session.interrupted":
      return { reason: "The local review was interrupted." };
    default:
      // Review snapshots are an explicit allowlist. A new event cannot leak
      // repository/provider content merely because its projection was omitted.
      return {};
  }
}

function toEventView(
  event: StoredSessionEvent,
  redactReviewContent: boolean,
): SessionEventView {
  return {
    id: event.id,
    sequence: event.sequence,
    type: event.type,
    createdAt: event.createdAt,
    payload: redactReviewContent ? reviewSafePayload(event) : event.payload,
  };
}

export function toSessionSnapshot(store: EventStore, sessionId: string): SessionSnapshot {
  const session = store.requireSession(sessionId);
  const state = store.getProjectedState(sessionId);
  return {
    ...toSessionSummary(session, state),
    workspaceRoot: session.workspaceRoot,
    ...(state.taskTrack === undefined ? {} : { taskTrack: state.taskTrack }),
    events: store
      .getEvents(sessionId)
      .map((event) => toEventView(event, state.taskTrack === "change-review-v1")),
  };
}

export function toRendererSessionUpdate(
  store: EventStore,
  update:
    | { sessionId: string; kind: "persisted" }
    | { sessionId: string; kind: "stream"; delta: string },
): SessionUpdate {
  const state = store.getProjectedState(update.sessionId);
  if (update.kind === "stream" && state.taskTrack !== "change-review-v1") {
    return update;
  }
  return {
    sessionId: update.sessionId,
    kind: "snapshot",
    snapshot: toSessionSnapshot(store, update.sessionId),
  };
}
