import { describe, expect, it } from "vitest";

import { createSoarDatabase } from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";
import {
  mintPr6rCheckpointImportCapability,
} from "../../src/main/pr6r-development/checkpoint-import";
import { compileReviewContextV1 } from "../../src/main/review-context-compiler-v1";
import { deriveVerifiedReviewEvidenceV1 } from "../../src/main/review-event-provenance";
import {
  buildPr6rCommonCheckpointV1,
  buildPr6rCommonInvestigationV1,
  canonicalPr6rJsonV1,
} from "../../src/shared/pr6r-development-contracts";
import {
  parseSessionEventData,
  type SessionEventData,
} from "../../src/shared/session-events";
import { replaySession } from "../../src/shared/session-reducer";
import {
  createPr6rA2ImportedSqliteFixture,
} from "../helpers/pr6r-a2-sqlite-fixture";
import {
  REVIEW_FIXTURE_SESSION_ID,
  reviewFixtureEvents,
} from "../helpers/review-event-fixture";

function populateParent(store: EventStore): void {
  const events = reviewFixtureEvents();
  const created = events[0];
  if (created?.type !== "session.created") {
    throw new Error("review fixture must start with session.created");
  }
  store.createSession({
    id: REVIEW_FIXTURE_SESSION_ID,
    title: created.payload.title,
    objective: created.payload.objective,
    workspaceRoot: created.payload.workspaceRoot,
    profile: created.payload.profile,
    taskTrack: created.payload.taskTrack,
    completionObligations: created.payload.completionObligations,
    executionPolicy: created.payload.executionPolicy,
    createdAt: created.createdAt,
  });
  for (const event of events.slice(1)) {
    store.append(
      REVIEW_FIXTURE_SESSION_ID,
      {
        type: event.type,
        payload: structuredClone(event.payload),
      } as SessionEventData,
      {
        expectedSequence: store.replay(REVIEW_FIXTURE_SESSION_ID).lastSequence,
        eventId: `checkpoint-parent:${event.id}`,
        createdAt: event.createdAt,
      },
    );
  }
}

describe("PR6R checkpoint import and finish hash compatibility", () => {
  it("replays historical finish events without synthesizing new hashes", () => {
    const state = replaySession(reviewFixtureEvents());
    expect(state.inferenceAttempts).toHaveLength(3);
    for (const attempt of state.inferenceAttempts) {
      expect(attempt.finished).toBeDefined();
      expect(attempt.finished?.responseBodySha256).toBeUndefined();
      expect(attempt.finished?.reviewResultSha256).toBeUndefined();
    }
  });

  it("strictly couples response and result hashes to a successful sent finish", () => {
    const base = {
      attemptId: "hash-attempt",
      checkpointId: "hash-checkpoint",
      outcome: "succeeded" as const,
      requestDisposition: "sent" as const,
      finishReason: "stop",
      servedModel: "hash-model",
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        reasoningTokens: 0,
        reported: true,
      },
      cost: {
        amountMicrousd: 0,
        provenance: "local_zero_cost_policy" as const,
      },
      latencyMs: 1,
    };
    expect(() =>
      parseSessionEventData({
        type: "inference.attempt.finished",
        payload: {
          ...base,
          requestDisposition: "unknown",
          outcome: "interrupted",
          errorCode: "loopback.dispatch_unknown",
          responseBodySha256: "a".repeat(64),
        },
      }),
    ).toThrow();
    expect(() =>
      parseSessionEventData({
        type: "inference.attempt.finished",
        payload: { ...base, reviewResultSha256: "b".repeat(64) },
      }),
    ).toThrow();
    expect(
      parseSessionEventData({
        type: "inference.attempt.finished",
        payload: {
          ...base,
          responseBodySha256: "a".repeat(64),
          reviewResultSha256: "b".repeat(64),
        },
      }),
    ).toMatchObject({
      payload: {
        responseBodySha256: "a".repeat(64),
        reviewResultSha256: "b".repeat(64),
      },
    });
  });

  it("projects one inherited Local lease and zero child attempts from the hash-only import", () => {
    const fixture = createPr6rA2ImportedSqliteFixture();
    try {
      const state = fixture.store.replay(
        fixture.applicationRequest.synthesisSessionId,
      );
      expect(state.synthesisCheckpointImport).toMatchObject({
        schemaVersion: "synthesis-checkpoint-import-v1",
        parentSessionId: fixture.applicationRequest.parentSessionId,
        commonCheckpointSha256:
          fixture.applicationRequest.commonCheckpointSha256,
        packetSha256: fixture.applicationRequest.packetSha256,
        semanticMessagesSha256:
          fixture.applicationRequest.semanticMessagesSha256,
        completedRequiredToolNames: ["inspect_git_changes"],
      });
      expect(state.routes).toHaveLength(1);
      expect(state.routes[0]).toMatchObject({
        providerId: "local-vllm",
        phase: "investigation",
      });
      expect(state.inferenceAttempts).toEqual([]);
      const imported = state.synthesisCheckpointImport;
      if (imported === undefined) {
        throw new Error("expected imported checkpoint fixture");
      }
      const {
        sequence: _sequence,
        createdAt: _createdAt,
        ...duplicatePayload
      } = imported;
      expect(() =>
        fixture.store.append(
          state.id,
          {
            type: "synthesis.checkpoint.imported",
            payload: structuredClone(duplicatePayload),
          },
          { expectedSequence: state.lastSequence },
        ),
      ).toThrow();
    } finally {
      fixture.database.close();
    }
  });

  it("rejects relabeling a generic review snapshot as the frozen PR6R checkpoint", () => {
    const database = createSoarDatabase();
    try {
      const store = new EventStore(database);
      populateParent(store);
      const parent = store.replay(REVIEW_FIXTURE_SESSION_ID);
      const verified = deriveVerifiedReviewEvidenceV1(
        store.getEvents(REVIEW_FIXTURE_SESSION_ID),
      );
      const compiled = compileReviewContextV1({
        objective: parent.objective,
        verifiedEvidence: verified,
        systemPrompt: "Review only host-verified evidence.",
        maxInputTokens: 163_840,
        safetyMargin: 0,
      });
      const packetUtf8 = canonicalPr6rJsonV1(compiled.packet);
      const checkpoint = buildPr6rCommonCheckpointV1({
        parentSessionId: parent.id,
        packetUtf8,
        semanticMessages: compiled.messages,
      });
      const investigation = buildPr6rCommonInvestigationV1({
        implementationRevision: "a".repeat(40),
        parentSessionId: parent.id,
        commonCheckpointSha256: checkpoint.checkpointSha256,
        durationMs: 1,
        toolCallCount: verified.provenance.toolResults.length,
      });
      expect(() =>
        mintPr6rCheckpointImportCapability({
          store,
          parentLastSequence: parent.lastSequence,
          commonInvestigation: investigation,
          commonCheckpoint: checkpoint,
          packetUtf8,
          semanticMessages: compiled.messages,
          target: {
            childSessionId: "generic-relabel-child",
            importId: "generic-relabel-import",
            retainedLocalLeaseId: "review-lease-1",
          },
        }),
      ).toThrow(/packet does not match|capability input is invalid/u);
    } finally {
      database.close();
    }
  });
});
