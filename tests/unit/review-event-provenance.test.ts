import { describe, expect, it } from "vitest";

import {
  buildChangeSnapshotV1,
  buildInspectGitChangesResultV1,
} from "../../src/main/change-acquisition-contracts";
import {
  assertVerifiedReviewEvidenceV1,
  deriveVerifiedReviewEvidenceV1,
} from "../../src/main/review-event-provenance";
import type { StoredSessionEvent } from "../../src/shared/session-events";
import {
  REVIEW_FIXTURE_SESSION_ID,
  reviewFixtureEvents,
  reviewFixtureSnapshot,
} from "../helpers/review-event-fixture";

function eventOfType<TType extends StoredSessionEvent["type"]>(
  events: StoredSessionEvent[],
  type: TType,
  ordinal: number,
): Extract<StoredSessionEvent, { type: TType }> {
  const event = events.filter(
    (candidate): candidate is Extract<StoredSessionEvent, { type: TType }> =>
      candidate.type === type,
  )[ordinal];
  if (!event) throw new Error(`Missing ${type} event ${ordinal}.`);
  return event;
}

describe("review event provenance", () => {
  it("derives one immutable evidence set from admitted successful event pairs", () => {
    const events = reviewFixtureEvents();
    const verified = deriveVerifiedReviewEvidenceV1(events);

    expect(verified.sessionId).toBe(REVIEW_FIXTURE_SESSION_ID);
    expect(verified.snapshot.snapshotId).toBe(reviewFixtureSnapshot().snapshotId);
    expect(verified.evidenceSet.changeHunkSha256s).toHaveLength(2);
    expect(verified.evidenceSet.completeBodies).toEqual([
      {
        path: "src/added.ts",
        side: "working",
        contentSha256:
          verified.snapshot.manifest[0]?.working?.admittedContentSha256,
      },
    ]);
    const completions = events.filter(
      (event) => event.type === "tool.call.completed",
    );
    expect(
      verified.evidenceSet.repositoryObservations.map(
        (observation) => observation.observationId,
      ),
    ).toEqual([completions[1]?.id, completions[2]?.id]);
    expect(verified.evidenceBodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "change_body",
          observationId: completions[0]?.id,
          path: "src/added.ts",
        }),
        expect.objectContaining({
          kind: "repository_file",
          observationId: completions[1]?.id,
          path: "src/router.ts",
        }),
        expect.objectContaining({
          kind: "repository_line",
          observationId: completions[2]?.id,
          path: "src/router.ts",
          line: 1,
        }),
      ]),
    );
    expect(verified.provenance.toolResults).toHaveLength(3);
    expect(verified.provenance.provenanceSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(assertVerifiedReviewEvidenceV1(verified)).toEqual(verified);
    expect(deriveVerifiedReviewEvidenceV1(events)).toEqual(verified);
  });

  it("fails closed when an attempt did not admit the completed tool", () => {
    const events = structuredClone(reviewFixtureEvents());
    const secondAttempt = eventOfType(
      events,
      "inference.attempt.started",
      1,
    );
    secondAttempt.payload.allowedToolNames = ["search_text"];

    expect(() => deriveVerifiedReviewEvidenceV1(events)).toThrow(
      /canonical replay-valid history|not allowed/u,
    );
  });

  it("rejects malformed result accounting and truncated search witnesses", () => {
    const badRead = reviewFixtureEvents({
      readContent: JSON.stringify({
        ok: true,
        text: "export const value = 2;\n",
        bytes: 1,
        truncated: false,
      }),
    });
    expect(() => deriveVerifiedReviewEvidenceV1(badRead)).toThrow(
      /not complete verified evidence/u,
    );

    const truncatedSearch = reviewFixtureEvents({
      searchContent: JSON.stringify({
        ok: true,
        matches: [
          {
            path: "src/router.ts",
            lineNumber: 1,
            text: "value = 2",
            textTruncated: true,
          },
        ],
        count: 1,
        filesSearched: 1,
        bytesScanned: 32,
        skipped: {
          binary: 0,
          ignored: 0,
          symlink: 0,
          tooLarge: 0,
          unreadable: 0,
        },
        truncated: false,
        outputBytes: 128,
      }),
    });
    expect(() => deriveVerifiedReviewEvidenceV1(truncatedSearch)).toThrow(
      /not complete verified evidence/u,
    );
  });

  it("rejects snapshot identity changes and repository observations that drift", () => {
    const inspectEnvelope = JSON.parse(
      eventOfType(
        reviewFixtureEvents(),
        "tool.call.completed",
        0,
      ).payload.content,
    ) as {
      snapshot: { manifest: Array<{ hunks: Array<{ lines: Array<{ content: string }> }> }> };
    };
    inspectEnvelope.snapshot.manifest[0]!.hunks[0]!.lines[0]!.content =
      "forged change";
    expect(() =>
      deriveVerifiedReviewEvidenceV1(
        reviewFixtureEvents({ inspectionContent: JSON.stringify(inspectEnvelope) }),
      ),
    ).toThrow(/identity or result validation/u);

    const driftedSearch = reviewFixtureEvents({
      searchContent: JSON.stringify({
        ok: true,
        matches: [
          {
            path: "src/router.ts",
            lineNumber: 1,
            text: "export const value = 2; // drift",
            textTruncated: false,
          },
        ],
        count: 1,
        filesSearched: 1,
        bytesScanned: 64,
        skipped: {
          binary: 0,
          ignored: 0,
          symlink: 0,
          tooLarge: 0,
          unreadable: 0,
        },
        truncated: false,
        outputBytes: 192,
      }),
    });
    expect(() => deriveVerifiedReviewEvidenceV1(driftedSearch)).toThrow(
      /conflicts with the inspected hunk/u,
    );
  });

  it("rejects two individually valid but conflicting inspections", () => {
    const events = structuredClone(reviewFixtureEvents());
    const original = reviewFixtureSnapshot();
    const conflicting = buildChangeSnapshotV1({
      schemaVersion: original.schemaVersion,
      baseCommitOid: original.baseCommitOid,
      indexSha256: original.indexSha256,
      discoverySha256: "f".repeat(64),
      manifest: original.manifest,
      omittedPathCount: original.omittedPathCount,
      omittedHunkCount: original.omittedHunkCount,
      manifestOmissionCodes: original.manifestOmissionCodes,
    });
    const conflictingContent = JSON.stringify({
      ok: true,
      ...buildInspectGitChangesResultV1(conflicting),
    });

    const secondAttempt = eventOfType(
      events,
      "inference.attempt.started",
      1,
    );
    secondAttempt.payload.allowedToolNames = ["inspect_git_changes"];
    const secondRequest = eventOfType(events, "tool.call.requested", 1);
    secondRequest.payload.name = "inspect_git_changes";
    secondRequest.payload.arguments = {
      schemaVersion: "inspect-git-changes-v1",
    };
    const secondCompletion = eventOfType(events, "tool.call.completed", 1);
    secondCompletion.payload.name = "inspect_git_changes";
    secondCompletion.payload.content = conflictingContent;

    expect(() => deriveVerifiedReviewEvidenceV1(events)).toThrow(
      /inspections conflict/u,
    );
  });

  it("detects any post-derivation mutation through the frozen provenance hash", () => {
    const verified = deriveVerifiedReviewEvidenceV1(reviewFixtureEvents());
    const mutated = structuredClone(verified);
    const repositoryLine = mutated.evidenceBodies.find(
      (body) => body.kind === "repository_line",
    );
    if (!repositoryLine) throw new Error("Missing repository line fixture.");
    repositoryLine.text = `${repositoryLine.text} changed`;

    expect(() => assertVerifiedReviewEvidenceV1(mutated)).toThrow(
      /does not match its content hash/u,
    );
  });
});
