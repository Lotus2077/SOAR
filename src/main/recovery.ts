import {
  EventStore,
  SequenceConflictError,
  type SessionRecord,
} from "./event-store";
import type { StoredSessionEvent } from "../shared/session-events";

export interface RecoveryOptions {
  reason?: string;
  createdAt?: string;
}

export interface RecoveredSession {
  session: SessionRecord;
  event: StoredSessionEvent;
}

export function recoverRunningSessions(
  store: EventStore,
  options: RecoveryOptions = {},
): RecoveredSession[] {
  const running = store.listSessions({ status: "running", limit: 1_000 });
  const recovered: RecoveredSession[] = [];

  for (const session of running) {
    try {
      const event = store.append(
        session.id,
        {
          type: "session.interrupted",
          payload: {
            reason:
              options.reason ??
              "The application stopped before this session reached a terminal state.",
          },
        },
        {
          expectedSequence: session.lastSequence,
          createdAt: options.createdAt,
        },
      );
      recovered.push({
        session: store.requireSession(session.id),
        event,
      });
    } catch (error) {
      // A concurrently updated session no longer needs this startup recovery pass.
      if (!(error instanceof SequenceConflictError)) {
        throw error;
      }
    }
  }

  return recovered;
}
