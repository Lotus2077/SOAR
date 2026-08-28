import type {
  SessionEventView,
  SessionSnapshot,
  SessionSummary,
} from "../shared/contracts";
import type { StoredSessionEvent } from "../shared/session-events";
import { EventStore, type SessionRecord } from "./event-store";

export function toSessionSummary(session: SessionRecord): SessionSummary {
  return {
    id: session.id,
    title: session.title,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function toEventView(event: StoredSessionEvent): SessionEventView {
  return {
    id: event.id,
    sequence: event.sequence,
    type: event.type,
    createdAt: event.createdAt,
    payload: event.payload,
  };
}

export function toSessionSnapshot(store: EventStore, sessionId: string): SessionSnapshot {
  const session = store.requireSession(sessionId);
  const state = store.getProjectedState(sessionId);
  return {
    ...toSessionSummary(session),
    workspaceRoot: session.workspaceRoot,
    ...(state.taskTrack === undefined ? {} : { taskTrack: state.taskTrack }),
    events: store.getEvents(sessionId).map(toEventView),
  };
}
