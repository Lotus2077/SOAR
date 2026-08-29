import { randomUUID } from "node:crypto";

import { AttemptUnitOfWork } from "./attempt-unit-of-work";
import { BudgetLedger } from "./budget-ledger";
import {
  EventStore,
  SequenceConflictError,
  type SessionRecord,
} from "./event-store";
import type { StoredSessionEvent } from "../shared/session-events";
import type { InferenceAttemptRecord } from "../shared/session-reducer";

export interface RecoveryOptions {
  reason?: string;
  createdAt?: string;
  /** Test seam; production creates the ledger-aware unit on this EventStore. */
  attemptUnitOfWork?: AttemptUnitOfWork;
}

export interface RecoveredSession {
  session: SessionRecord;
  event: StoredSessionEvent;
  attemptEvent?: StoredSessionEvent;
  toolEvent?: StoredSessionEvent;
}

function interruptedAttemptEvent(
  state: ReturnType<EventStore["replay"]>,
  attempt: InferenceAttemptRecord,
  recoveredAt: string,
) {
  const decision = state.routingDecisions.find(
    (candidate) => candidate.decisionId === attempt.decisionId,
  );
  const reservationId = attempt.budgetReservationId;
  if (reservationId !== undefined && decision?.billing === undefined) {
    throw new Error(
      `Cannot conservatively recover reserved attempt ${attempt.attemptId} without its billing projection`,
    );
  }
  return {
    type: "inference.attempt.finished" as const,
    payload: {
      attemptId: attempt.attemptId,
      checkpointId: attempt.checkpointId,
      outcome: "interrupted" as const,
      requestDisposition: "unknown" as const,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        reported: false,
      },
      cost:
        reservationId === undefined
          ? {
              amountMicrousd: 0,
              provenance: "local_zero_cost_policy" as const,
            }
          : {
              amountMicrousd: decision?.billing?.projectedCostMicrousd ?? 0,
              provenance: "reserved_unknown" as const,
              reservationId,
            },
      latencyMs: Math.max(
        0,
        Date.parse(recoveredAt) - Date.parse(attempt.createdAt),
      ),
      errorCode: "startup_recovery",
    },
  };
}

export function recoverRunningSessions(
  store: EventStore,
  options: RecoveryOptions = {},
): RecoveredSession[] {
  const recovered: RecoveredSession[] = [];
  const budgetLedger = new BudgetLedger(store);
  const attemptUnitOfWork =
    options.attemptUnitOfWork ??
    new AttemptUnitOfWork(budgetLedger);

  while (true) {
    const running = store.listSessions({ status: "running", limit: 1_000 });
    if (running.length === 0) break;

    let removedFromRunning = 0;
    for (const session of running) {
      try {
      const state = store.replay(session.id);
      const openAttempts = state.inferenceAttempts.filter(
        (attempt) => attempt.finished === undefined,
      );
      if (openAttempts.length > 1) {
        throw new Error(
          `Cannot recover session ${session.id} with multiple open inference attempts`,
        );
      }
      const attempt = openAttempts[0];
      const pendingToolCalls = state.messages.flatMap((message) =>
        (message.toolCalls ?? []).filter(
          (toolCall) => toolCall.status === "requested",
        ),
      );
      if (pendingToolCalls.length > 1) {
        throw new Error(
          `Cannot recover session ${session.id} with multiple pending tool calls`,
        );
      }
      const pendingToolCall = pendingToolCalls[0];
      if (attempt !== undefined && pendingToolCall !== undefined) {
        throw new Error(
          `Cannot recover session ${session.id} with both an open attempt and pending tool call`,
        );
      }
      const recoveredAt = options.createdAt ?? new Date().toISOString();
      const recoveryReason =
        options.reason ??
        "The application stopped before this session reached a terminal state.";
      const lastAttemptOutcome = state.inferenceAttempts.at(-1)?.finished?.outcome;
      const recoveryEvents = [
        ...(attempt === undefined
          ? []
          : [interruptedAttemptEvent(state, attempt, recoveredAt)]),
        ...(pendingToolCall === undefined
          ? []
          : [
              {
                type: "tool.call.completed" as const,
                payload: {
                  toolCallId: pendingToolCall.id,
                  name: pendingToolCall.name,
                  content: JSON.stringify({
                    ok: false,
                    error: {
                      code: "startup_recovery",
                      message: recoveryReason,
                    },
                  }),
                  isError: true,
                  durationMs: 0,
                },
              },
            ]),
        lastAttemptOutcome === "cancelled"
          ? {
              type: "session.cancelled" as const,
              payload: { reason: recoveryReason },
            }
          : {
              type: "session.interrupted" as const,
              payload: { reason: recoveryReason },
          },
      ] as const;
      const appended =
        attempt === undefined
          ? store.appendMany(session.id, recoveryEvents, {
              expectedSequence: session.lastSequence,
              createdAt: recoveredAt,
            })
          : attemptUnitOfWork.commitRecoveryFinish({
              sessionId: session.id,
              expectedSequence: session.lastSequence,
              createdAt: recoveredAt,
              eventIds: recoveryEvents.map(() => randomUUID()),
              events: recoveryEvents,
              ...(attempt.budgetReservationId === undefined
                ? {}
                : { terminalLedgerEntryId: randomUUID() }),
            }).events;
      const event = appended.at(-1);
      if (!event) throw new Error("Startup recovery did not append a terminal event");
        recovered.push({
          session: store.requireSession(session.id),
          event,
          ...(attempt === undefined ? {} : { attemptEvent: appended[0] }),
          ...(pendingToolCall === undefined
            ? {}
            : { toolEvent: appended.at(-2) }),
        });
        removedFromRunning += 1;
      } catch (error) {
        if (!(error instanceof SequenceConflictError)) {
          throw error;
        }
        // A concurrent terminal update also counts as progress. A conflict that
        // leaves the session running would otherwise make the paged recovery
        // loop spin forever, so fail closed and surface it to startup.
        if (store.requireSession(session.id).status !== "running") {
          removedFromRunning += 1;
        } else {
          throw error;
        }
      }
    }

    if (removedFromRunning === 0) {
      throw new Error("Startup recovery made no progress");
    }
  }

  budgetLedger.assertEventReconciled();
  return recovered;
}
