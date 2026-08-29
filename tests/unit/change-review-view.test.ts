import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildChangeSnapshotV1,
  buildInspectGitChangesResultV1,
  deriveReviewCoverageV1,
} from "../../src/main/change-acquisition-contracts";
import { toChangeReviewView } from "../../src/main/change-review-view";
import type { EventStore } from "../../src/main/event-store";
import { deriveVerifiedReviewEvidenceV1 } from "../../src/main/review-event-provenance";
import { inspectGitChanges } from "../../src/main/tools/inspect-git-changes";
import type { ChangeSnapshotV1 } from "../../src/shared/change-review-contracts";
import type { ReviewResultV1 } from "../../src/shared/review-result-contract";
import type { StoredSessionEvent } from "../../src/shared/session-events";
import { replaySession, type SessionState } from "../../src/shared/session-reducer";
import {
  REVIEW_FIXTURE_SESSION_ID,
  REVIEW_FIXTURE_SYNTHESIS_MESSAGE_ID,
  completedReviewFixtureEvents,
  reviewFixtureEvents,
  reviewFixtureSnapshot,
} from "../helpers/review-event-fixture";

vi.mock("../../src/main/tools/inspect-git-changes", () => ({
  inspectGitChanges: vi.fn(),
}));

const inspectGitChangesMock = vi.mocked(inspectGitChanges);

function storeFor(
  events: readonly StoredSessionEvent[],
  stateOverride?: SessionState,
): EventStore {
  const replayed = stateOverride ?? replaySession(events);
  return {
    replay: () => structuredClone(replayed),
    getEvents: () => structuredClone(events),
  } as unknown as EventStore;
}

function changedSnapshot(snapshot: ChangeSnapshotV1): ChangeSnapshotV1 {
  const { snapshotId: _snapshotId, ...preimage } = snapshot;
  return buildChangeSnapshotV1({
    ...preimage,
    discoverySha256: "f".repeat(64),
  });
}

function incompleteSnapshot(snapshot: ChangeSnapshotV1): ChangeSnapshotV1 {
  const { snapshotId: _snapshotId, ...preimage } = snapshot;
  return buildChangeSnapshotV1({
    ...preimage,
    omittedPathCount: 1,
    omittedHunkCount: 1,
    manifestOmissionCodes: ["file_count_limit", "hunk_count_limit"],
  });
}

function acceptedResult(
  events: readonly StoredSessionEvent[],
): ReviewResultV1 {
  const completion = events.find(
    (event) =>
      event.type === "assistant.message.completed" &&
      event.payload.messageId === REVIEW_FIXTURE_SYNTHESIS_MESSAGE_ID,
  );
  if (
    completion?.type !== "assistant.message.completed" ||
    completion.payload.reviewResult === undefined
  ) {
    throw new Error("Expected an accepted structured result fixture.");
  }
  return structuredClone(completion.payload.reviewResult);
}

afterEach(() => {
  inspectGitChangesMock.mockReset();
});

describe("change-review renderer projection", () => {
  it("re-proves one completed, checked review before exposing a fresh result", async () => {
    const snapshot = reviewFixtureSnapshot();
    const events = completedReviewFixtureEvents();
    inspectGitChangesMock.mockResolvedValue(
      buildInspectGitChangesResultV1(snapshot),
    );

    const view = await toChangeReviewView(
      storeFor(events),
      REVIEW_FIXTURE_SESSION_ID,
    );

    expect(view).toMatchObject({
      sessionId: REVIEW_FIXTURE_SESSION_ID,
      status: "completed",
      freshness: "fresh_complete",
      route: {
        providerId: "local-vllm",
        model: "local-review-model",
        locality: "local",
        reasonCode: "low_risk_local_review",
      },
      phases: [
        { id: "inspection", status: "complete", label: "Local inspection" },
        { id: "checkpoint", status: "complete", label: "Routing checkpoint" },
        { id: "synthesis", status: "complete", label: "Local synthesis" },
        { id: "fallback", status: "pending", label: "Fallback" },
      ],
      reviewResult: {
        conclusion: "no_blocking_findings",
        snapshotId: snapshot.snapshotId,
      },
      coverage: {
        status: "complete",
        snapshotRevalidated: true,
      },
    });
    expect(view.coverage).toEqual({
      schemaVersion: "review-coverage-view-v1",
      status: "complete",
      counts: {
        changedPaths: 2,
        admittedPaths: 2,
        omittedPaths: 0,
        changedHunks: 2,
        admittedHunks: 2,
        omittedHunks: 0,
      },
      changedTestCount: 0,
      runtimeCodeChangedWithoutChangedTest: true,
      snapshotRevalidated: true,
      omissionCodes: [],
    });
    const serializedCoverage = JSON.stringify(view.coverage);
    expect(serializedCoverage).not.toContain("src/added.ts");
    expect(serializedCoverage).not.toContain("src/router.ts");
    expect(serializedCoverage).not.toContain(snapshot.snapshotId);
    expect(serializedCoverage).not.toContain(acceptedResult(events).evidenceSetId);
    expect(view.coverage).not.toHaveProperty("files");
    expect(view.coverage).not.toHaveProperty("changedTestPaths");
    expect(view.coverage).not.toHaveProperty("snapshotId");
    expect(view.coverage).not.toHaveProperty("evidenceSetId");
    expect(inspectGitChangesMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(view)).not.toContain("/tmp/review-workspace");
  });

  it("withholds an otherwise accepted review when the workspace has drifted", async () => {
    const snapshot = reviewFixtureSnapshot();
    inspectGitChangesMock.mockResolvedValue(
      buildInspectGitChangesResultV1(changedSnapshot(snapshot)),
    );

    const view = await toChangeReviewView(
      storeFor(completedReviewFixtureEvents()),
      REVIEW_FIXTURE_SESSION_ID,
    );

    expect(view.freshness).toBe("drifted");
    expect(view.reviewResult).toBeUndefined();
    expect(view.coverage).toBeUndefined();
    expect(view.acceptanceNote).toMatch(/workspace changed/u);
  });

  it("shows a host-accepted incomplete review only when its snapshot identity still matches", async () => {
    const snapshot = incompleteSnapshot(reviewFixtureSnapshot());
    const events = completedReviewFixtureEvents({ snapshot });
    inspectGitChangesMock.mockResolvedValue(
      buildInspectGitChangesResultV1(snapshot),
    );

    const view = await toChangeReviewView(
      storeFor(events),
      REVIEW_FIXTURE_SESSION_ID,
    );

    expect(view.freshness).toBe("identity_same_unverifiable");
    expect(view.reviewResult).toMatchObject({
      conclusion: "incomplete",
      omissions: [{ code: "change_hunk_not_retained" }],
    });
    expect(view.coverage).toMatchObject({
      status: "incomplete",
      snapshotRevalidated: false,
      omissionCodes: expect.arrayContaining([
        "change_hunk_not_retained",
        "manifest_incomplete",
        "manifest_path_omitted",
        "snapshot_not_revalidated",
      ]),
    });
    expect(view.acceptanceNote).toMatch(/identity still matches/u);
    expect(view.acceptanceNote).toMatch(/copying is disabled/u);
  });

  it("keeps a missing full read incomplete, identity-unverifiable, and non-copyable", async () => {
    const snapshot = reviewFixtureSnapshot();
    const events = completedReviewFixtureEvents({
      evidenceOverrides: { readRelativePath: "README.md" },
    });
    inspectGitChangesMock.mockResolvedValue(
      buildInspectGitChangesResultV1(snapshot),
    );

    const view = await toChangeReviewView(
      storeFor(events),
      REVIEW_FIXTURE_SESSION_ID,
    );

    expect(view.freshness).toBe("identity_same_unverifiable");
    expect(view.freshness).not.toBe("fresh_complete");
    expect(view.reviewResult).toMatchObject({
      conclusion: "incomplete",
      omissions: [{ code: "changed_file_not_fully_read" }],
    });
    expect(view.coverage).toEqual({
      schemaVersion: "review-coverage-view-v1",
      status: "incomplete",
      counts: {
        changedPaths: 2,
        admittedPaths: 1,
        omittedPaths: 1,
        changedHunks: 2,
        admittedHunks: 2,
        omittedHunks: 0,
      },
      changedTestCount: 0,
      runtimeCodeChangedWithoutChangedTest: true,
      snapshotRevalidated: true,
      omissionCodes: ["changed_file_not_fully_read"],
    });
    expect(view.acceptanceNote).toMatch(/copying is disabled/u);
  });

  it("keeps a model-declared omission incomplete and non-copyable even with complete host coverage", async () => {
    const snapshot = reviewFixtureSnapshot();
    const baseline = completedReviewFixtureEvents();
    const result: ReviewResultV1 = {
      ...acceptedResult(baseline),
      summary: "The model could not complete one bounded analysis step.",
      conclusion: "incomplete",
      omissions: [
        {
          code: "model_analysis_incomplete",
          description: "One bounded analysis step was not completed.",
        },
      ],
    };
    const events = completedReviewFixtureEvents({ result });
    inspectGitChangesMock.mockResolvedValue(
      buildInspectGitChangesResultV1(snapshot),
    );

    const view = await toChangeReviewView(
      storeFor(events),
      REVIEW_FIXTURE_SESSION_ID,
    );

    expect(view.freshness).toBe("identity_same_unverifiable");
    expect(view.freshness).not.toBe("fresh_complete");
    expect(view.reviewResult).toMatchObject({
      conclusion: "incomplete",
      omissions: [{ code: "model_analysis_incomplete" }],
    });
    expect(view.coverage).toMatchObject({
      status: "complete",
      snapshotRevalidated: true,
      omissionCodes: [],
    });
    expect(view.acceptanceNote).toMatch(/accepted result is incomplete/u);
    expect(view.acceptanceNote).toMatch(/copying is disabled/u);
  });

  it("withholds accepted data when bounded freshness inspection is unavailable", async () => {
    inspectGitChangesMock.mockRejectedValue(new Error("private workspace path"));

    const view = await toChangeReviewView(
      storeFor(completedReviewFixtureEvents()),
      REVIEW_FIXTURE_SESSION_ID,
    );

    expect(view.freshness).toBe("unavailable");
    expect(view.reviewResult).toBeUndefined();
    expect(view.coverage).toBeUndefined();
    expect(view.acceptanceNote).toMatch(/could not revalidate/u);
    expect(JSON.stringify(view)).not.toContain("private workspace path");
  });

  it("does not expose or reinspect a crash-window result without terminal completion", async () => {
    for (const terminal of ["running", "interrupted"] as const) {
      const events = completedReviewFixtureEvents({ terminal });
      const replayed = replaySession(events);
      const acceptedMessage = replayed.messages.find(
        (message) => message.id === REVIEW_FIXTURE_SYNTHESIS_MESSAGE_ID,
      );
      expect(acceptedMessage?.reviewParseStatus).toBe("accepted");

      const view = await toChangeReviewView(
        storeFor(events),
        REVIEW_FIXTURE_SESSION_ID,
      );
      expect(view.freshness).toBe(
        terminal === "running" ? "pending" : "not_available",
      );
      expect(view.reviewResult).toBeUndefined();
      expect(view.coverage).toBeUndefined();
    }
    expect(inspectGitChangesMock).not.toHaveBeenCalled();
  });

  it("withholds when the final accepted check is no longer bound to the result message", async () => {
    const events = completedReviewFixtureEvents();
    const replayed = replaySession(events);
    const finalCheck = replayed.completionChecks.at(-1);
    if (finalCheck === undefined) throw new Error("Expected a final completion check.");
    finalCheck.messageId = "different-assistant-message";

    const view = await toChangeReviewView(
      storeFor(events, replayed),
      REVIEW_FIXTURE_SESSION_ID,
    );

    expect(view.freshness).toBe("not_available");
    expect(view.reviewResult).toBeUndefined();
    expect(inspectGitChangesMock).not.toHaveBeenCalled();
  });

  it("classifies terminal raw-invalid results as not_available", async () => {
    const baseline = completedReviewFixtureEvents();
    const rawResult = {
      ...acceptedResult(baseline),
      summary: "A different but shape-valid model result.",
    };
    const mismatched = completedReviewFixtureEvents({
      rawContent: JSON.stringify(rawResult),
    });
    const malformed = completedReviewFixtureEvents({
      rawContent: `${JSON.stringify(acceptedResult(baseline))}\ntrailing provider text`,
    });

    for (const events of [mismatched, malformed]) {
      const replayed = replaySession(events);
      expect(replayed.status).toBe("completed");
      expect(
        replayed.messages.find(
          (message) => message.id === REVIEW_FIXTURE_SYNTHESIS_MESSAGE_ID,
        )?.reviewParseStatus,
      ).toBe("accepted");
      const view = await toChangeReviewView(
        storeFor(events),
        REVIEW_FIXTURE_SESSION_ID,
      );
      expect(view.freshness).toBe("not_available");
      expect(view.reviewResult).toBeUndefined();
      expect(view.coverage).toBeUndefined();
      expect(JSON.stringify(view)).not.toContain("provider text");
    }
    expect(inspectGitChangesMock).not.toHaveBeenCalled();
  });

  it("rederives provenance, host coverage, and semantic acceptance before exposure", async () => {
    const provenanceMismatch = structuredClone(completedReviewFixtureEvents());
    const checkpoint = provenanceMismatch.find(
      (event) =>
        event.type === "context.compiled" &&
        event.payload.compilerVersion === "review-context-compiler-v1",
    );
    if (checkpoint?.type !== "context.compiled") {
      throw new Error("Expected a review checkpoint.");
    }
    checkpoint.payload.reviewProvenanceSha256 = "0".repeat(64);

    const evidenceEvents = reviewFixtureEvents();
    const verified = deriveVerifiedReviewEvidenceV1(evidenceEvents);
    const forgedCoverage = deriveReviewCoverageV1({
      snapshot: verified.snapshot,
      evidenceSet: verified.evidenceSet,
      packetRetainedEvidenceSet: true,
      snapshotRevalidated: false,
    });
    const forgedResult: ReviewResultV1 = {
      ...acceptedResult(completedReviewFixtureEvents()),
      summary: "Coverage claims a host fact that replay cannot trust.",
      conclusion: "incomplete",
      omissions: [
        {
          code: "snapshot_not_revalidated",
          description: "The snapshot was not revalidated.",
        },
      ],
    };
    const coverageMismatch = completedReviewFixtureEvents({
      coverage: forgedCoverage,
      result: forgedResult,
    });

    const semanticallyInvalid = completedReviewFixtureEvents({
      result: {
        ...acceptedResult(completedReviewFixtureEvents()),
        conclusion: "blocking_findings",
      },
    });

    for (const events of [
      provenanceMismatch,
      coverageMismatch,
      semanticallyInvalid,
    ]) {
      expect(replaySession(events).status).toBe("completed");
      const view = await toChangeReviewView(
        storeFor(events),
        REVIEW_FIXTURE_SESSION_ID,
      );
      expect(view).toMatchObject({
        status: "completed",
        freshness: "not_available",
      });
      expect(view.reviewResult).toBeUndefined();
      expect(view.coverage).toBeUndefined();
    }
    expect(inspectGitChangesMock).not.toHaveBeenCalled();
  });

  it("does not touch the workspace before any accepted synthesis exists", async () => {
    const events = reviewFixtureEvents();
    const view = await toChangeReviewView(
      storeFor(events),
      REVIEW_FIXTURE_SESSION_ID,
    );

    expect(view.freshness).toBe("pending");
    expect(view.phases[0]).toMatchObject({ status: "complete" });
    expect(view.phases[1]).toMatchObject({ status: "active" });
    expect(view.phases[2]).toMatchObject({ status: "pending" });
    expect(inspectGitChangesMock).not.toHaveBeenCalled();
  });

  it("rejects attempts to project an unrelated session track", async () => {
    const events = reviewFixtureEvents();
    const state = replaySession(events);
    state.taskTrack = "repository-investigator-v1";

    await expect(
      toChangeReviewView(
        storeFor(events, state),
        REVIEW_FIXTURE_SESSION_ID,
      ),
    ).rejects.toThrow(/change-review-v1/u);
  });
});
