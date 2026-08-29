import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ChangeReviewContractError,
  ChangeSnapshotV1Schema,
  ReviewCoverageV1Schema,
  ReviewEvidenceSetV1Schema,
  type ChangeManifestEntryV1,
  type ChangeSnapshotV1,
  type ReviewEvidenceSetV1,
} from "../../src/shared/change-review-contracts";
import {
  buildChangeHunkV1,
  buildChangeSnapshotV1,
  canonicalizeReviewEvidenceSetV1,
  assertReviewEvidenceRefAdmitted,
  sha256GitIndexStageEntries,
} from "../../src/main/change-acquisition-contracts";
import { extractVerifiedReviewRiskV1 } from "../../src/main/review-risk";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function modifiedEntry(): ChangeManifestEntryV1 {
  const hunk = buildChangeHunkV1({
    schemaVersion: "change-hunk-v1",
    oldPath: "src/router.ts",
    newPath: "src/router.ts",
    oldStart: 1,
    oldLines: 2,
    newStart: 1,
    newLines: 2,
    lines: [
      {
        kind: "context",
        content: "export function route() {",
        terminator: "lf",
        oldLine: 1,
        newLine: 1,
      },
      {
        kind: "deletion",
        content: "  return 'local';",
        terminator: "lf",
        oldLine: 2,
        newLine: null,
      },
      {
        kind: "addition",
        content: "  return chooseProvider();",
        terminator: "lf",
        oldLine: null,
        newLine: 2,
      },
    ],
  });
  return {
    changeKind: "modified",
    oldPath: "src/router.ts",
    newPath: "src/router.ts",
    staged: true,
    unstaged: false,
    base: {
      mode: "100644",
      sizeBytes: 48,
      admittedContentSha256: sha256("old router"),
    },
    working: {
      mode: "100644",
      sizeBytes: 56,
      admittedContentSha256: sha256("new router"),
    },
    omissionCodes: [],
    hunks: [hunk],
  };
}

function snapshot(): ChangeSnapshotV1 {
  return buildChangeSnapshotV1({
    schemaVersion: "change-snapshot-v1",
    baseCommitOid: "a".repeat(40),
    indexSha256: sha256GitIndexStageEntries([
      {
        mode: "100644",
        objectId: "b".repeat(40),
        stage: 0,
        path: "src/router.ts",
      },
    ]),
    discoverySha256: sha256("test discovery"),
    manifest: [modifiedEntry()],
    omittedPathCount: 0,
    omittedHunkCount: 0,
    manifestOmissionCodes: [],
  });
}

function evidenceSet(changeSnapshot: ChangeSnapshotV1): ReviewEvidenceSetV1 {
  const entry = changeSnapshot.manifest[0];
  const hunk = entry?.hunks[0];
  if (!entry?.working?.admittedContentSha256 || !hunk) {
    throw new Error("Invalid test fixture.");
  }
  return canonicalizeReviewEvidenceSetV1({
    schemaVersion: "review-evidence-set-v1",
    snapshotId: changeSnapshot.snapshotId,
    changeHunkSha256s: [hunk.hunkSha256],
    completeBodies: [],
    repositoryObservations: [
      {
        observationId: "tool-read-1",
        toolName: "read_text_file",
        scope: "full_file",
        path: "src/router.ts",
        line: null,
        lineCount: 2,
        contentSha256: entry.working.admittedContentSha256,
      },
      {
        observationId: "tool-search-1",
        toolName: "search_text",
        scope: "matched_line",
        path: "src/router.ts",
        line: 2,
        lineCount: null,
        contentSha256: sha256("  return chooseProvider();"),
      },
    ],
  });
}

describe("change-review v1 schemas", () => {
  it("rejects unknown fields, non-canonical paths, and unsorted manifests", () => {
    const valid = snapshot();
    expect(
      ChangeSnapshotV1Schema.safeParse({ ...valid, unexpected: true }).success,
    ).toBe(false);

    const invalidPath = structuredClone(valid);
    invalidPath.manifest[0]!.newPath = "../outside.ts";
    expect(ChangeSnapshotV1Schema.safeParse(invalidPath).success).toBe(false);

    const second = {
      ...modifiedEntry(),
      oldPath: "a.ts",
      newPath: "a.ts",
      hunks: [],
      base: {
        mode: "100644" as const,
        sizeBytes: 1,
        admittedContentSha256: sha256("a"),
      },
      working: {
        mode: "100644" as const,
        sizeBytes: 1,
        admittedContentSha256: sha256("b"),
      },
    };
    expect(
      ChangeSnapshotV1Schema.safeParse({
        ...valid,
        manifest: [valid.manifest[0], second],
      }).success,
    ).toBe(false);
  });

  it("cross-validates hunk line ranges and manifest side paths", () => {
    const invalidSequence = {
      schemaVersion: "change-hunk-v1",
      oldPath: "src/a.ts",
      newPath: "src/a.ts",
      oldStart: 4,
      oldLines: 1,
      newStart: 4,
      newLines: 1,
      lines: [
        {
          kind: "context",
          content: "line",
          terminator: "lf",
          oldLine: 5,
          newLine: 4,
        },
      ],
    };
    expect(() => buildChangeHunkV1(invalidSequence)).toThrow(/consecutive old line 4/u);

    const valid = snapshot();
    const wrongPath = structuredClone(valid);
    wrongPath.manifest[0]!.hunks[0]!.newPath = "src/other.ts";
    expect(ChangeSnapshotV1Schema.safeParse(wrongPath).success).toBe(false);
  });

  it("requires explicit non-text omissions and hunks for changed admitted text", () => {
    const valid = snapshot();
    const missingSymlinkOmission = structuredClone(valid);
    const entry = missingSymlinkOmission.manifest[0]!;
    entry.base!.mode = "120000";
    entry.working!.mode = "120000";
    entry.hunks = [];
    expect(ChangeSnapshotV1Schema.safeParse(missingSymlinkOmission).success).toBe(false);

    const missingHunks = structuredClone(valid);
    missingHunks.manifest[0]!.hunks = [];
    expect(ChangeSnapshotV1Schema.safeParse(missingHunks).success).toBe(false);

    const contentIdenticalRename = structuredClone(valid.manifest[0]!);
    contentIdenticalRename.changeKind = "renamed";
    contentIdenticalRename.oldPath = "src/old-router.ts";
    contentIdenticalRename.newPath = "src/router.ts";
    contentIdenticalRename.working!.admittedContentSha256 =
      contentIdenticalRename.base!.admittedContentSha256;
    contentIdenticalRename.hunks = [];
    expect(
      ChangeSnapshotV1Schema.safeParse({
        ...valid,
        manifest: [contentIdenticalRename],
      }).success,
    ).toBe(true);
  });

  it("requires an explicit omission for simultaneous staged and unstaged state", () => {
    const entry = modifiedEntry();
    entry.unstaged = true;

    expect(() =>
      buildChangeSnapshotV1({
        schemaVersion: "change-snapshot-v1",
        baseCommitOid: "a".repeat(40),
        indexSha256: "b".repeat(64),
        discoverySha256: "c".repeat(64),
        manifest: [entry],
        omittedPathCount: 0,
        omittedHunkCount: 0,
        manifestOmissionCodes: [],
      }),
    ).toThrow(/requires staged_unstaged_overlap/u);

    entry.omissionCodes = ["staged_unstaged_overlap"];
    const explicitlyIncomplete = buildChangeSnapshotV1({
      schemaVersion: "change-snapshot-v1",
      baseCommitOid: "a".repeat(40),
      indexSha256: "b".repeat(64),
      discoverySha256: "c".repeat(64),
      manifest: [entry],
      omittedPathCount: 0,
      omittedHunkCount: 0,
      manifestOmissionCodes: ["staged_unstaged_overlap"],
    });
    expect(extractVerifiedReviewRiskV1(explicitlyIncomplete)).toMatchObject({
      complete: false,
      classification: "incomplete",
      score: null,
      incompleteReasons: expect.arrayContaining([
        "manifest:staged_unstaged_overlap",
      ]),
    });
  });

  it("rejects duplicate observations and conflicting observation identities", () => {
    const validSnapshot = snapshot();
    const validEvidence = evidenceSet(validSnapshot);
    expect(ReviewEvidenceSetV1Schema.parse(validEvidence)).toEqual(validEvidence);

    const duplicate = structuredClone(validEvidence);
    duplicate.changeHunkSha256s.push(duplicate.changeHunkSha256s[0]!);
    expect(ReviewEvidenceSetV1Schema.safeParse(duplicate).success).toBe(false);

    const conflicting = structuredClone(validEvidence);
    conflicting.repositoryObservations.push({
      observationId: "tool-read-1",
      toolName: "read_text_file",
      scope: "full_file",
      path: "src/router.ts",
      line: null,
      lineCount: 2,
      contentSha256: sha256("different content"),
    });
    conflicting.repositoryObservations.sort((left, right) =>
      left.contentSha256 < right.contentSha256 ? -1 : 1,
    );
    expect(ReviewEvidenceSetV1Schema.safeParse(conflicting).success).toBe(false);
  });
});

describe("structured review evidence admission", () => {
  it("admits exact base/working hunk references and repository observations", () => {
    const validSnapshot = snapshot();
    const validEvidence = evidenceSet(validSnapshot);
    const hunk = validSnapshot.manifest[0]!.hunks[0]!;

    expect(
      assertReviewEvidenceRefAdmitted(
        {
          kind: "change",
          snapshotId: validSnapshot.snapshotId,
          path: "src/router.ts",
          side: "base",
          line: 2,
          hunkSha256: hunk.hunkSha256,
        },
        validSnapshot,
        validEvidence,
      ),
    ).toMatchObject({ kind: "change", side: "base", line: 2 });

    expect(
      assertReviewEvidenceRefAdmitted(
        {
          kind: "repository",
          snapshotId: validSnapshot.snapshotId,
          evidenceSetId: validEvidence.evidenceSetId,
          observationId: "tool-search-1",
          path: "src/router.ts",
          line: 2,
          contentSha256: sha256("  return chooseProvider();"),
        },
        validSnapshot,
        validEvidence,
      ),
    ).toMatchObject({ kind: "repository", observationId: "tool-search-1" });
  });

  it("admits snapshot-bound metadata evidence for a zero-hunk rename", () => {
    const contentSha256 = sha256("unchanged content");
    const renamedSnapshot = buildChangeSnapshotV1({
      schemaVersion: "change-snapshot-v1",
      baseCommitOid: "a".repeat(40),
      indexSha256: sha256("renamed index"),
      discoverySha256: sha256("renamed discovery"),
      manifest: [
        {
          changeKind: "renamed",
          oldPath: "src/old-name.ts",
          newPath: "src/new-name.ts",
          staged: true,
          unstaged: false,
          base: {
            mode: "100644",
            sizeBytes: 17,
            admittedContentSha256: contentSha256,
          },
          working: {
            mode: "100644",
            sizeBytes: 17,
            admittedContentSha256: contentSha256,
          },
          omissionCodes: [],
          hunks: [],
        },
      ],
      omittedPathCount: 0,
      omittedHunkCount: 0,
      manifestOmissionCodes: [],
    });
    const evidence = canonicalizeReviewEvidenceSetV1({
      schemaVersion: "review-evidence-set-v1",
      snapshotId: renamedSnapshot.snapshotId,
      changeHunkSha256s: [],
      completeBodies: [],
      repositoryObservations: [],
    });

    expect(
      assertReviewEvidenceRefAdmitted(
        {
          kind: "change_metadata",
          snapshotId: renamedSnapshot.snapshotId,
          path: "src/new-name.ts",
          changeKind: "renamed",
        },
        renamedSnapshot,
        evidence,
      ),
    ).toMatchObject({ kind: "change_metadata", changeKind: "renamed" });
    expect(() =>
      assertReviewEvidenceRefAdmitted(
        {
          kind: "change_metadata",
          snapshotId: renamedSnapshot.snapshotId,
          path: "src/new-name.ts",
          changeKind: "modified",
        },
        renamedSnapshot,
        evidence,
      ),
    ).toThrow(/does not match an admitted manifest entry/u);
  });

  it("rejects metadata evidence for a hunk-bearing change", () => {
    const validSnapshot = snapshot();
    const validEvidence = evidenceSet(validSnapshot);

    expect(() =>
      assertReviewEvidenceRefAdmitted(
        {
          kind: "change_metadata",
          snapshotId: validSnapshot.snapshotId,
          path: "src/router.ts",
          changeKind: "modified",
        },
        validSnapshot,
        validEvidence,
      ),
    ).toThrow(/limited to manifest entries with no content hunks/u);
  });

  it.each([
    ["wrong side path", { path: "src/other.ts", side: "working", line: 2 }],
    ["wrong side line", { path: "src/router.ts", side: "working", line: 3 }],
    ["wrong side", { path: "src/router.ts", side: "base", line: 99 }],
  ])("rejects a %s reference", (_label, override) => {
    const validSnapshot = snapshot();
    const validEvidence = evidenceSet(validSnapshot);
    const hunk = validSnapshot.manifest[0]!.hunks[0]!;
    const reference = Object.assign(
      {
        kind: "change",
        snapshotId: validSnapshot.snapshotId,
        path: "src/router.ts",
        side: "working",
        line: 2,
        hunkSha256: hunk.hunkSha256,
      },
      override,
    );
    expect(() =>
      assertReviewEvidenceRefAdmitted(
        reference,
        validSnapshot,
        validEvidence,
      ),
    ).toThrow(ChangeReviewContractError);
  });

  it("rejects stale IDs and repository content not bound by the observation", () => {
    const validSnapshot = snapshot();
    const validEvidence = evidenceSet(validSnapshot);
    expect(() =>
      assertReviewEvidenceRefAdmitted(
        {
          kind: "repository",
          snapshotId: validSnapshot.snapshotId,
          evidenceSetId: "0".repeat(64),
          observationId: "tool-search-1",
          path: "src/router.ts",
          line: 2,
          contentSha256: sha256("wrong"),
        },
        validSnapshot,
        validEvidence,
      ),
    ).toThrow(/stale evidence-set ID/u);
  });

  it("re-verifies immutable identities before admitting a reference", () => {
    const validSnapshot = snapshot();
    const validEvidence = evidenceSet(validSnapshot);
    const hunk = validSnapshot.manifest[0]!.hunks[0]!;
    const reference = {
      kind: "change",
      snapshotId: validSnapshot.snapshotId,
      path: "src/router.ts",
      side: "working",
      line: 2,
      hunkSha256: hunk.hunkSha256,
    };

    const tamperedSnapshot = structuredClone(validSnapshot);
    tamperedSnapshot.manifest[0]!.hunks[0]!.lines[2]!.content = "tampered";
    expect(() =>
      assertReviewEvidenceRefAdmitted(reference, tamperedSnapshot, validEvidence),
    ).toThrow(/identity mismatch/u);

    const tamperedEvidence = structuredClone(validEvidence);
    tamperedEvidence.repositoryObservations[0]!.contentSha256 = "f".repeat(64);
    expect(() =>
      assertReviewEvidenceRefAdmitted(reference, validSnapshot, tamperedEvidence),
    ).toThrow(/identity mismatch/u);
  });

  it("does not allow an externally-authored complete coverage state", () => {
    const validSnapshot = snapshot();
    const validEvidence = evidenceSet(validSnapshot);
    expect(
      ReviewCoverageV1Schema.safeParse({
        schemaVersion: "review-coverage-v1",
        snapshotId: validSnapshot.snapshotId,
        evidenceSetId: validEvidence.evidenceSetId,
        status: "complete",
        manifestStatus: "complete",
        counts: {
          changedPaths: 1,
          admittedPaths: 0,
          omittedPaths: 1,
          changedHunks: 1,
          admittedHunks: 0,
          omittedHunks: 1,
        },
        files: [
          {
            path: "src/router.ts",
            changeKind: "modified",
            requiredReadSide: "working",
            fullRead: false,
            completeBodyRequired: false,
            completeBodyRetained: false,
            hunkCount: 1,
            retainedHunkCount: 0,
            changedTest: false,
            manifestOmissionCodes: [],
            coverageOmissionCodes: ["change_hunk_not_retained"],
          },
        ],
        changedTestPaths: [],
        runtimeCodeChangedWithoutChangedTest: true,
        packetRetainedEvidenceSet: true,
        snapshotRevalidated: true,
        omissionCodes: ["change_hunk_not_retained"],
      }).success,
    ).toBe(false);
  });
});
