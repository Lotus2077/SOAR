import { afterEach, describe, expect, it } from "vitest";

import { createSoarDatabase, type SoarDatabase } from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";
import { toRendererSessionUpdate } from "../../src/main/session-view";

const databases: SoarDatabase[] = [];

function store(): EventStore {
  const database = createSoarDatabase();
  databases.push(database);
  return new EventStore(database);
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("review renderer update boundary", () => {
  it("suppresses live deltas and default-denies unprojected review event fields", () => {
    const events = store();
    const objective = "PRIVATE_REVIEW_OBJECTIVE_MUST_STAY_IN_MAIN";
    const session = events.createSession({
      id: "review-renderer-redaction",
      title: "Review current changes",
      objective,
      workspaceRoot: "/tmp/review-renderer-redaction",
      profile: "balanced",
      taskTrack: "change-review-v1",
      completionObligations: {
        requiredSuccessfulTools: ["inspect_git_changes"],
        minimumVerifiedPathLineCitations: 0,
      },
      executionPolicy: {
        schemaVersion: "agentic-execution-v2",
        inferenceRounds: 4,
        toolCalls: 3,
        routingPolicy: "local_only_v1",
        maxProviderChanges: 2,
        maxPaidAttempts: 1,
        maxPaidEpisodeMicrousd: 250_000,
        maxEpisodeDurationMs: 120_000,
        attemptTimeoutMs: 30_000,
        egressConsent: "none",
      },
    });

    const projected = toRendererSessionUpdate(events, {
      sessionId: session.id,
      kind: "stream",
      delta: "RAW_REVIEW_STREAM_MUST_NOT_CROSS",
    });

    expect(projected.kind).toBe("snapshot");
    expect(JSON.stringify(projected)).not.toContain(objective);
    expect(JSON.stringify(projected)).not.toContain(
      "RAW_REVIEW_STREAM_MUST_NOT_CROSS",
    );
  });

  it("preserves ordinary Repository Investigator streaming", () => {
    const events = store();
    const session = events.createSession({
      id: "ordinary-renderer-stream",
      title: "Inspect repository",
      objective: "Inspect repository",
      workspaceRoot: "/tmp/ordinary-renderer-stream",
      profile: "balanced",
      taskTrack: "repository-investigator-v1",
    });
    const update = {
      sessionId: session.id,
      kind: "stream" as const,
      delta: "visible ordinary answer",
    };

    expect(toRendererSessionUpdate(events, update)).toEqual(update);
  });
});
