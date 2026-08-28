import { afterEach, describe, expect, it } from "vitest";

import { createSoarDatabase, type SoarDatabase } from "../../src/main/database";
import {
  EventStore,
  SequenceConflictError,
} from "../../src/main/event-store";

const databases: SoarDatabase[] = [];

function createStore(): { database: SoarDatabase; store: EventStore } {
  const database = createSoarDatabase();
  databases.push(database);
  return { database, store: new EventStore(database) };
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

describe("EventStore", () => {
  it("atomically appends ordered events and updates the sessions projection", () => {
    const { store } = createStore();
    const session = store.createSession({
      id: "session-1",
      title: "Task",
      objective: "Read notes.txt",
      workspaceRoot: "/tmp/workspace",
      createdAt: "2026-08-27T00:00:01.000Z",
    });
    expect(session).toMatchObject({
      id: "session-1",
      status: "created",
      lastSequence: 2,
      totalCostUsd: 0,
    });

    store.appendMany(
      session.id,
      [
        { type: "session.started", payload: {} },
        {
          type: "route.assigned",
          payload: {
            providerId: "local-vllm",
            model: "RM-01 VLM",
            reason: "Local-only vertical slice",
          },
        },
        {
          type: "usage.recorded",
          payload: {
            inputTokens: 12,
            outputTokens: 3,
            reasoningTokens: 2,
            costUsd: 0,
            latencyMs: 42,
          },
        },
      ],
      {
        expectedSequence: 2,
        createdAt: "2026-08-27T00:00:02.000Z",
      },
    );

    expect(store.requireSession(session.id)).toMatchObject({
      status: "running",
      currentProviderId: "local-vllm",
      currentModel: "RM-01 VLM",
      routeReason: "Local-only vertical slice",
      lastSequence: 5,
      totalInputTokens: 12,
      totalOutputTokens: 3,
      totalReasoningTokens: 2,
      totalCostUsd: 0,
      totalLatencyMs: 42,
    });
    expect(store.getProjectedState(session.id)).toEqual(store.replay(session.id));
    expect(store.getEvents(session.id).map((event) => event.sequence)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it("rejects stale expected sequences without writing", () => {
    const { store } = createStore();
    store.createSession({
      id: "session-1",
      title: "Task",
      objective: "Do the task",
      workspaceRoot: "/tmp/workspace",
    });

    expect(() =>
      store.append(
        "session-1",
        { type: "session.started", payload: {} },
        { expectedSequence: 0 },
      ),
    ).toThrow(SequenceConflictError);
    expect(store.getEvents("session-1")).toHaveLength(2);
    expect(store.requireSession("session-1").lastSequence).toBe(2);
  });

  it("rolls back an entire batch when a later event is invalid", () => {
    const { store } = createStore();
    store.createSession({
      id: "session-1",
      title: "Task",
      objective: "Do the task",
      workspaceRoot: "/tmp/workspace",
    });

    expect(() =>
      store.appendMany(
        "session-1",
        [
          { type: "session.completed", payload: { result: "done" } },
          {
            type: "user.message",
            payload: { messageId: "too-late", content: "Keep going" },
          },
        ],
        { expectedSequence: 2 },
      ),
    ).toThrow(/terminal status completed/);

    expect(store.getEvents("session-1")).toHaveLength(2);
    expect(store.requireSession("session-1")).toMatchObject({
      status: "created",
      lastSequence: 2,
    });
  });

  it("enforces append-only storage at the database boundary", () => {
    const { database, store } = createStore();
    store.createSession({
      id: "session-1",
      title: "Task",
      objective: "Do the task",
      workspaceRoot: "/tmp/workspace",
    });

    expect(() =>
      database
        .prepare("UPDATE session_events SET type = ? WHERE session_id = ?")
        .run("tampered", "session-1"),
    ).toThrow(/append-only/);
    expect(() =>
      database
        .prepare("DELETE FROM session_events WHERE session_id = ?")
        .run("session-1"),
    ).toThrow(/append-only/);
  });

  it("loads and upgrades projections written before context telemetry", () => {
    const { database, store } = createStore();
    const session = store.createSession({
      id: "legacy-session",
      title: "Legacy task",
      objective: "Continue from an older projection",
      workspaceRoot: "/tmp/workspace",
    });
    const legacyState = JSON.parse(
      JSON.stringify(store.getProjectedState(session.id)),
    ) as Record<string, unknown>;
    delete legacyState.contextCompilations;
    database
      .prepare("UPDATE sessions SET state_json = ? WHERE id = ?")
      .run(JSON.stringify(legacyState), session.id);

    expect(store.getProjectedState(session.id).contextCompilations).toEqual([]);

    store.append(session.id, { type: "session.started", payload: {} });
    expect(store.getProjectedState(session.id)).toMatchObject({
      status: "running",
      contextCompilations: [],
    });
    expect(store.getProjectedState(session.id)).toEqual(store.replay(session.id));
  });
});
