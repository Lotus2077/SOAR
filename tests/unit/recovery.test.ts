import { afterEach, describe, expect, it } from "vitest";

import { createSoarDatabase, type SoarDatabase } from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";
import { recoverRunningSessions } from "../../src/main/recovery";

const databases: SoarDatabase[] = [];

function createStore(): EventStore {
  const database = createSoarDatabase();
  databases.push(database);
  return new EventStore(database);
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
});
