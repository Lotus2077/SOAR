import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildChangeHunkV1,
  buildChangeSnapshotV1,
  buildInspectGitChangesResultV1,
  canonicalizeReviewEvidenceSetV1,
  canonicalChangeJson,
  canonicalGitIndexStageOutput,
  changeSnapshotPreimage,
  deriveReviewCoverageV1,
  reviewEvidenceSetPreimage,
  sha256CanonicalChangeRecord,
  sha256GitIndexStageEntries,
  assertChangeHunkIdentity,
  assertChangeSnapshotIdentity,
  assertReviewCoverageV1,
  assertReviewEvidenceSetIdentity,
} from "../../src/main/change-acquisition-contracts";
import {
  CHANGE_REVIEW_CONTRACT_LIMITS,
  ChangeSnapshotPreimageV1Schema,
  ReviewEvidenceSetPreimageV1Schema,
} from "../../src/shared/change-review-contracts";
import type {
  ChangeManifestEntryV1,
  ChangeSnapshotV1,
  ReviewEvidenceSetV1,
} from "../../src/shared/change-review-contracts";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function modifiedEntry(path = "src/main/runtime.ts"): ChangeManifestEntryV1 {
  const hunk = buildChangeHunkV1({
    schemaVersion: "change-hunk-v1",
    oldPath: path,
    newPath: path,
    oldStart: 7,
    oldLines: 1,
    newStart: 7,
    newLines: 1,
    lines: [
      {
        kind: "deletion",
        content: "return unsafe();",
        terminator: "lf",
        oldLine: 7,
        newLine: null,
      },
      {
        kind: "addition",
        content: "return guarded();",
        terminator: "lf",
        oldLine: null,
        newLine: 7,
      },
    ],
  });
  return {
    changeKind: "modified",
    oldPath: path,
    newPath: path,
    staged: true,
    unstaged: false,
    base: {
      mode: "100644",
      sizeBytes: 16,
      admittedContentSha256: sha256("return unsafe();\n"),
    },
    working: {
      mode: "100644",
      sizeBytes: 17,
      admittedContentSha256: sha256("return guarded();\n"),
    },
    omissionCodes: [],
    hunks: [hunk],
  };
}

function addedTestEntry(): ChangeManifestEntryV1 {
  const path = "tests/runtime.test.ts";
  const hunk = buildChangeHunkV1({
    schemaVersion: "change-hunk-v1",
    oldPath: null,
    newPath: path,
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: 1,
    lines: [
      {
        kind: "addition",
        content: "expect(guarded()).toBe(true);",
        terminator: "lf",
        oldLine: null,
        newLine: 1,
      },
    ],
  });
  return {
    changeKind: "added",
    oldPath: null,
    newPath: path,
    staged: true,
    unstaged: false,
    base: null,
    working: {
      mode: "100644",
      sizeBytes: 30,
      admittedContentSha256: sha256("expect(guarded()).toBe(true);\n"),
    },
    omissionCodes: [],
    hunks: [hunk],
  };
}

function completeSnapshot(reverse = false): ChangeSnapshotV1 {
  const manifest = [modifiedEntry(), addedTestEntry()];
  if (reverse) manifest.reverse();
  return buildChangeSnapshotV1({
    schemaVersion: "change-snapshot-v1",
    baseCommitOid: "a".repeat(40),
    indexSha256: sha256GitIndexStageEntries([
      {
        mode: "100644",
        objectId: "b".repeat(40),
        stage: 0,
        path: "tests/runtime.test.ts",
      },
      {
        mode: "100644",
        objectId: "c".repeat(40),
        stage: 0,
        path: "src/main/runtime.ts",
      },
    ]),
    discoverySha256: sha256("test discovery"),
    manifest,
    omittedPathCount: 0,
    omittedHunkCount: 0,
    manifestOmissionCodes: [],
  });
}

function snapshotWithModifiedPaths(paths: readonly string[]): ChangeSnapshotV1 {
  return buildChangeSnapshotV1({
    schemaVersion: "change-snapshot-v1",
    baseCommitOid: "a".repeat(40),
    indexSha256: "b".repeat(64),
    discoverySha256: "c".repeat(64),
    manifest: [...paths].sort().map((path) => modifiedEntry(path)),
    omittedPathCount: 0,
    omittedHunkCount: 0,
    manifestOmissionCodes: [],
  });
}

function completeEvidence(snapshot: ChangeSnapshotV1): ReviewEvidenceSetV1 {
  const runtime = snapshot.manifest.find((entry) => entry.newPath === "src/main/runtime.ts");
  const test = snapshot.manifest.find((entry) => entry.newPath === "tests/runtime.test.ts");
  if (!runtime?.working?.admittedContentSha256 || !test?.working?.admittedContentSha256) {
    throw new Error("Invalid test fixture.");
  }
  return canonicalizeReviewEvidenceSetV1({
    schemaVersion: "review-evidence-set-v1",
    snapshotId: snapshot.snapshotId,
    changeHunkSha256s: [test.hunks[0]!.hunkSha256, runtime.hunks[0]!.hunkSha256],
    completeBodies: [
      {
        path: "tests/runtime.test.ts",
        side: "working",
        contentSha256: test.working.admittedContentSha256,
      },
    ],
    repositoryObservations: [
      {
        observationId: "read-runtime",
        toolName: "read_text_file",
        scope: "full_file",
        path: "src/main/runtime.ts",
        line: null,
        lineCount: 7,
        contentSha256: runtime.working.admittedContentSha256,
      },
    ],
  });
}

describe("canonical change acquisition records", () => {
  it("uses sorted Git index stage records as the exact index hash preimage", () => {
    const entries = [
      {
        mode: "100755" as const,
        objectId: "b".repeat(40),
        stage: 0 as const,
        path: "z.sh",
      },
      {
        mode: "100644" as const,
        objectId: "a".repeat(40),
        stage: 0 as const,
        path: "a.ts",
      },
    ];
    const canonical =
      `100644 ${"a".repeat(40)} 0\ta.ts\0` +
      `100755 ${"b".repeat(40)} 0\tz.sh\0`;
    expect(canonicalGitIndexStageOutput(entries)).toBe(canonical);
    expect(sha256GitIndexStageEntries(entries)).toBe(sha256(canonical));
    expect(sha256GitIndexStageEntries([...entries].reverse())).toBe(
      sha256GitIndexStageEntries(entries),
    );
    expect(() => canonicalGitIndexStageOutput([...entries, entries[0]!])).toThrow(
      /Duplicate Git index stage record/u,
    );
    expect(() =>
      canonicalGitIndexStageOutput([{ ...entries[0]!, path: "../escape" }]),
    ).toThrow();
  });

  it("canonicalizes object keys and rejects non-JSON or unsafe numeric values", () => {
    expect(canonicalChangeJson({ z: 1, a: [true, null, "x"] })).toBe(
      '{"a":[true,null,"x"],"z":1}',
    );
    expect(() => canonicalChangeJson({ invalid: undefined })).toThrow(/undefined/u);
    expect(() => canonicalChangeJson({ invalid: 1.5 })).toThrow(/safe integers/u);
    expect(() => canonicalChangeJson(new Date())).toThrow(/plain objects/u);
  });

  it("builds stable hunk and snapshot IDs from explicit ID-free preimages", () => {
    const left = completeSnapshot(false);
    const right = completeSnapshot(true);
    expect(right).toEqual(left);
    expect(left.snapshotId).toBe(
      sha256CanonicalChangeRecord(changeSnapshotPreimage(left)),
    );
    expect(assertChangeSnapshotIdentity(left)).toEqual(left);

    const tamperedHunk = structuredClone(left.manifest[0]!.hunks[0]!);
    tamperedHunk.lines[0]!.content = "tampered";
    expect(() => assertChangeHunkIdentity(tamperedHunk)).toThrow(/identity mismatch/u);

    const tamperedSnapshot = structuredClone(left);
    tamperedSnapshot.indexSha256 = "0".repeat(64);
    expect(() => assertChangeSnapshotIdentity(tamperedSnapshot)).toThrow(
      /snapshot identity mismatch/u,
    );

    const omittedDiscoveryTamper = structuredClone(left);
    omittedDiscoveryTamper.discoverySha256 = "f".repeat(64);
    expect(() => assertChangeSnapshotIdentity(omittedDiscoveryTamper)).toThrow(
      /snapshot identity mismatch/u,
    );
  });

  it("reserves final snapshot-ID bytes at the preimage size boundary", () => {
    const makePreimage = (fillerLength: number) => ({
      schemaVersion: "change-snapshot-v1" as const,
      baseCommitOid: "a".repeat(40),
      indexSha256: "b".repeat(64),
      discoverySha256: "c".repeat(64),
      manifest: Array.from({ length: 64 }, (_, index) => {
        const path = `p${String(index).padStart(3, "0")}-${"x".repeat(fillerLength)}`;
        return {
          changeKind: "added" as const,
          oldPath: null,
          newPath: path,
          staged: true,
          unstaged: false,
          base: null,
          working: {
            mode: "100644" as const,
            sizeBytes: 0,
            admittedContentSha256: null,
          },
          omissionCodes: ["unreadable" as const],
          hunks: [],
        };
      }),
      omittedPathCount: 0,
      omittedHunkCount: 0,
      manifestOmissionCodes: ["unreadable" as const],
    });
    let low = 0;
    let high = CHANGE_REVIEW_CONTRACT_LIMITS.maxPathCharacters - 6;
    let largestAccepted = makePreimage(0);
    let largestFiller = 0;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = makePreimage(middle);
      if (ChangeSnapshotPreimageV1Schema.safeParse(candidate).success) {
        largestAccepted = candidate;
        largestFiller = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    expect(ChangeSnapshotPreimageV1Schema.safeParse(largestAccepted).success).toBe(true);
    const snapshot = buildChangeSnapshotV1(largestAccepted);
    expect(Buffer.byteLength(JSON.stringify(snapshot), "utf8")).toBeLessThanOrEqual(
      CHANGE_REVIEW_CONTRACT_LIMITS.maxSerializedRecordBytes,
    );
    expect(
      ChangeSnapshotPreimageV1Schema.safeParse(makePreimage(largestFiller + 1)).success,
    ).toBe(false);
  });

  it("reserves final evidence-set-ID bytes at the preimage size boundary", () => {
    const makePreimage = (fillerLength: number) => ({
      schemaVersion: "review-evidence-set-v1" as const,
      snapshotId: "a".repeat(64),
      changeHunkSha256s: [],
      completeBodies: [],
      repositoryObservations: Array.from({ length: 64 }, (_, index) => ({
        observationId: `obs-${String(index).padStart(3, "0")}`,
        toolName: "read_text_file" as const,
        scope: "full_file" as const,
        path: `p${String(index).padStart(3, "0")}-${"x".repeat(fillerLength)}`,
        line: null,
        lineCount: 0,
        contentSha256: "b".repeat(64),
      })),
    });
    let low = 0;
    let high = CHANGE_REVIEW_CONTRACT_LIMITS.maxPathCharacters - 6;
    let largestAccepted = makePreimage(0);
    let largestFiller = 0;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = makePreimage(middle);
      if (ReviewEvidenceSetPreimageV1Schema.safeParse(candidate).success) {
        largestAccepted = candidate;
        largestFiller = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    expect(ReviewEvidenceSetPreimageV1Schema.safeParse(largestAccepted).success).toBe(true);
    const evidenceSet = canonicalizeReviewEvidenceSetV1(largestAccepted);
    expect(Buffer.byteLength(JSON.stringify(evidenceSet), "utf8")).toBeLessThanOrEqual(
      CHANGE_REVIEW_CONTRACT_LIMITS.maxSerializedRecordBytes,
    );
    expect(
      ReviewEvidenceSetPreimageV1Schema.safeParse(makePreimage(largestFiller + 1))
        .success,
    ).toBe(false);
  });

  it("projects an identity-valid near-bound snapshot into a larger inspect result", () => {
    const paths = Array.from({ length: 100 }, (_, index) =>
      `src/${String(index).padStart(3, "0")}-${"x".repeat(274)}.ts`,
    );
    const snapshot = snapshotWithModifiedPaths(paths);
    const result = buildInspectGitChangesResultV1(snapshot);
    const snapshotBytes = Buffer.byteLength(JSON.stringify(snapshot), "utf8");
    const resultBytes = Buffer.byteLength(JSON.stringify(result), "utf8");

    expect(snapshotBytes).toBeLessThanOrEqual(
      CHANGE_REVIEW_CONTRACT_LIMITS.maxSerializedRecordBytes,
    );
    expect(resultBytes).toBeGreaterThan(
      CHANGE_REVIEW_CONTRACT_LIMITS.maxSerializedRecordBytes,
    );
    expect(resultBytes).toBeLessThanOrEqual(
      CHANGE_REVIEW_CONTRACT_LIMITS.maxInspectResultSerializedRecordBytes,
    );
  });

  it("accounts for worst-case JSON-escaped UTF-16 paths in the inspect bound", () => {
    const paths = ["00", "01"].map(
      (prefix) => `${prefix}/${"\ud800".repeat(4_093)}`,
    );
    expect(paths.every((path) => path.length === 4_096)).toBe(true);

    const snapshot = snapshotWithModifiedPaths(paths);
    const result = buildInspectGitChangesResultV1(snapshot);
    const snapshotBytes = Buffer.byteLength(JSON.stringify(snapshot), "utf8");
    const resultBytes = Buffer.byteLength(JSON.stringify(result), "utf8");

    expect(snapshotBytes).toBeLessThanOrEqual(
      CHANGE_REVIEW_CONTRACT_LIMITS.maxSerializedRecordBytes,
    );
    expect(resultBytes).toBeGreaterThan(
      CHANGE_REVIEW_CONTRACT_LIMITS.maxSerializedRecordBytes,
    );
    expect(resultBytes).toBeLessThanOrEqual(
      CHANGE_REVIEW_CONTRACT_LIMITS.maxInspectResultSerializedRecordBytes,
    );
  });

  it("fails closed on duplicate set records instead of silently deduplicating them", () => {
    const snapshot = completeSnapshot();
    const hunk = snapshot.manifest[0]!.hunks[0]!;
    expect(() =>
      canonicalizeReviewEvidenceSetV1({
        schemaVersion: "review-evidence-set-v1",
        snapshotId: snapshot.snapshotId,
        changeHunkSha256s: [hunk.hunkSha256, hunk.hunkSha256],
        completeBodies: [],
        repositoryObservations: [],
      }),
    ).toThrow(/strictly sorted and unique/u);
  });

  it("binds the evidence-set ID and rejects hunks or bodies outside the snapshot", () => {
    const snapshot = completeSnapshot();
    const evidence = completeEvidence(snapshot);
    expect(evidence.evidenceSetId).toBe(
      sha256CanonicalChangeRecord(reviewEvidenceSetPreimage(evidence)),
    );
    expect(assertReviewEvidenceSetIdentity(evidence, snapshot)).toEqual(evidence);

    const unknownHunk = canonicalizeReviewEvidenceSetV1({
      ...reviewEvidenceSetPreimage(evidence),
      changeHunkSha256s: ["f".repeat(64)],
    });
    expect(() => assertReviewEvidenceSetIdentity(unknownHunk, snapshot)).toThrow(
      /unknown change hunk/u,
    );

    const wrongBody = canonicalizeReviewEvidenceSetV1({
      ...reviewEvidenceSetPreimage(evidence),
      completeBodies: [
        {
          ...evidence.completeBodies[0]!,
          contentSha256: "e".repeat(64),
        },
      ],
    });
    expect(() => assertReviewEvidenceSetIdentity(wrongBody, snapshot)).toThrow(
      /does not match snapshot content/u,
    );

    const modifiedBody = canonicalizeReviewEvidenceSetV1({
      ...reviewEvidenceSetPreimage(evidence),
      completeBodies: [
        {
          path: "src/main/runtime.ts",
          side: "working",
          contentSha256:
            snapshot.manifest[0]!.working!.admittedContentSha256!,
        },
      ],
    });
    expect(() =>
      assertReviewEvidenceSetIdentity(modifiedBody, snapshot),
    ).toThrow(/not a required complete side/u);
  });
});

describe("host-derived ReviewCoverageV1", () => {
  it("derives complete coverage only with all hunks, bodies, reads, packet, and revalidation", () => {
    const snapshot = completeSnapshot();
    const evidence = completeEvidence(snapshot);
    const coverage = deriveReviewCoverageV1({
      snapshot,
      evidenceSet: evidence,
      packetRetainedEvidenceSet: true,
      snapshotRevalidated: true,
    });

    expect(coverage).toMatchObject({
      status: "complete",
      manifestStatus: "complete",
      counts: {
        changedPaths: 2,
        admittedPaths: 2,
        omittedPaths: 0,
        changedHunks: 2,
        admittedHunks: 2,
        omittedHunks: 0,
      },
      changedTestPaths: ["tests/runtime.test.ts"],
      runtimeCodeChangedWithoutChangedTest: false,
      packetRetainedEvidenceSet: true,
      snapshotRevalidated: true,
      omissionCodes: [],
    });
    expect(
      assertReviewCoverageV1({
        coverage,
        snapshot,
        evidenceSet: evidence,
        packetRetainedEvidenceSet: true,
        snapshotRevalidated: true,
      }),
    ).toEqual(coverage);
  });

  it("keeps coverage counts safe at the maximum omitted-count contract", () => {
    const base = completeSnapshot();
    const snapshot = buildChangeSnapshotV1({
      schemaVersion: "change-snapshot-v1",
      baseCommitOid: base.baseCommitOid,
      indexSha256: base.indexSha256,
      discoverySha256: base.discoverySha256,
      manifest: base.manifest,
      omittedPathCount: CHANGE_REVIEW_CONTRACT_LIMITS.maxOmittedPaths,
      omittedHunkCount: CHANGE_REVIEW_CONTRACT_LIMITS.maxOmittedHunks,
      manifestOmissionCodes: ["file_count_limit", "hunk_count_limit"],
    });
    const evidence = completeEvidence(snapshot);

    const coverage = deriveReviewCoverageV1({
      snapshot,
      evidenceSet: evidence,
      packetRetainedEvidenceSet: true,
      snapshotRevalidated: false,
    });

    expect(coverage.counts.changedPaths).toBe(
      CHANGE_REVIEW_CONTRACT_LIMITS.maxOmittedPaths + 2,
    );
    expect(coverage.counts.changedHunks).toBe(
      CHANGE_REVIEW_CONTRACT_LIMITS.maxOmittedHunks + 2,
    );
    expect(Number.isSafeInteger(coverage.counts.changedPaths)).toBe(true);
    expect(Number.isSafeInteger(coverage.counts.changedHunks)).toBe(true);
  });

  it("rejects forged derived coverage fields and recognizes multi-dot test names", () => {
    const runtime = modifiedEntry("src/main/runtime.ts");
    const originalTest = addedTestEntry();
    const { hunkSha256: _discardedHunkId, ...testHunkPreimage } =
      originalTest.hunks[0]!;
    const test = {
      ...originalTest,
      newPath: "tests/router.test.integration.ts",
      hunks: [
        buildChangeHunkV1({
          ...testHunkPreimage,
          newPath: "tests/router.test.integration.ts",
        }),
      ],
    };
    const snapshot = buildChangeSnapshotV1({
      schemaVersion: "change-snapshot-v1",
      baseCommitOid: "a".repeat(40),
      indexSha256: "b".repeat(64),
      discoverySha256: "c".repeat(64),
      manifest: [runtime, test],
      omittedPathCount: 0,
      omittedHunkCount: 0,
      manifestOmissionCodes: [],
    });
    const runtimeHash = runtime.working!.admittedContentSha256!;
    const testHash = test.working!.admittedContentSha256!;
    const evidence = canonicalizeReviewEvidenceSetV1({
      schemaVersion: "review-evidence-set-v1",
      snapshotId: snapshot.snapshotId,
      changeHunkSha256s: snapshot.manifest.flatMap((entry) =>
        entry.hunks.map((hunk) => hunk.hunkSha256),
      ),
      completeBodies: [
        { path: test.newPath, side: "working", contentSha256: testHash },
      ],
      repositoryObservations: [
        {
          observationId: "read-runtime-multidot",
          toolName: "read_text_file",
          scope: "full_file",
          path: runtime.newPath,
          line: null,
          lineCount: 1,
          contentSha256: runtimeHash,
        },
      ],
    });
    const coverage = deriveReviewCoverageV1({
      snapshot,
      evidenceSet: evidence,
      packetRetainedEvidenceSet: true,
      snapshotRevalidated: true,
    });
    expect(coverage.changedTestPaths).toEqual(["tests/router.test.integration.ts"]);
    expect(coverage.runtimeCodeChangedWithoutChangedTest).toBe(false);

    const forged = structuredClone(coverage);
    forged.files[1]!.completeBodyRequired = false;
    forged.files[1]!.completeBodyRetained = false;
    expect(() =>
      assertReviewCoverageV1({
        coverage: forged,
        snapshot,
        evidenceSet: evidence,
        packetRetainedEvidenceSet: true,
        snapshotRevalidated: true,
      }),
    ).toThrow();

    const staleGate = structuredClone(coverage);
    expect(() =>
      assertReviewCoverageV1({
        coverage: staleGate,
        snapshot,
        evidenceSet: evidence,
        packetRetainedEvidenceSet: false,
        snapshotRevalidated: true,
      }),
    ).toThrow(/does not match host-derived/u);
  });

  it("retains the old runtime side when a rename crosses out of src", () => {
    const contentSha256 = sha256("same content\n");
    const renamed: ChangeManifestEntryV1 = {
      changeKind: "renamed",
      oldPath: "src/main/runtime.ts",
      newPath: "docs/runtime.ts",
      staged: true,
      unstaged: false,
      base: {
        mode: "100644",
        sizeBytes: 13,
        admittedContentSha256: contentSha256,
      },
      working: {
        mode: "100644",
        sizeBytes: 13,
        admittedContentSha256: contentSha256,
      },
      omissionCodes: [],
      hunks: [],
    };
    const snapshot = buildChangeSnapshotV1({
      schemaVersion: "change-snapshot-v1",
      baseCommitOid: "a".repeat(40),
      indexSha256: "b".repeat(64),
      discoverySha256: "c".repeat(64),
      manifest: [renamed],
      omittedPathCount: 0,
      omittedHunkCount: 0,
      manifestOmissionCodes: [],
    });
    const evidence = canonicalizeReviewEvidenceSetV1({
      schemaVersion: "review-evidence-set-v1",
      snapshotId: snapshot.snapshotId,
      changeHunkSha256s: [],
      completeBodies: [],
      repositoryObservations: [
        {
          observationId: "read-renamed-runtime",
          toolName: "read_text_file",
          scope: "full_file",
          path: "docs/runtime.ts",
          line: null,
          lineCount: 1,
          contentSha256,
        },
      ],
    });

    const coverage = deriveReviewCoverageV1({
      snapshot,
      evidenceSet: evidence,
      packetRetainedEvidenceSet: true,
      snapshotRevalidated: true,
    });

    expect(coverage.files[0]).toMatchObject({
      path: "docs/runtime.ts",
      oldPath: "src/main/runtime.ts",
      newPath: "docs/runtime.ts",
      changedTest: false,
    });
    expect(coverage.changedTestPaths).toEqual([]);
    expect(coverage.runtimeCodeChangedWithoutChangedTest).toBe(true);
  });

  it("keeps coverage derivation total for a large valid rename projection", () => {
    const deepPrefix = [
      "src",
      "a".repeat(220),
      "b".repeat(220),
      "c".repeat(220),
    ].join("/");
    const contentSha256 = sha256("x");
    const manifest = Array.from({ length: 100 }, (_, index) => {
      const suffix = index.toString().padStart(3, "0");
      return {
        changeKind: "renamed" as const,
        oldPath: `${deepPrefix}/budget-old-${suffix}.test.ts`,
        newPath: `${deepPrefix}/budget-new-${suffix}.test.ts`,
        staged: true,
        unstaged: false,
        base: {
          mode: "100644" as const,
          sizeBytes: 1,
          admittedContentSha256: contentSha256,
        },
        working: {
          mode: "100644" as const,
          sizeBytes: 1,
          admittedContentSha256: contentSha256,
        },
        omissionCodes: [],
        hunks: [],
      } satisfies ChangeManifestEntryV1;
    });
    const snapshot = buildChangeSnapshotV1({
      schemaVersion: "change-snapshot-v1",
      baseCommitOid: "a".repeat(40),
      indexSha256: "b".repeat(64),
      discoverySha256: "c".repeat(64),
      manifest,
      omittedPathCount: 0,
      omittedHunkCount: 0,
      manifestOmissionCodes: [],
    });
    const evidence = canonicalizeReviewEvidenceSetV1({
      schemaVersion: "review-evidence-set-v1",
      snapshotId: snapshot.snapshotId,
      changeHunkSha256s: [],
      completeBodies: [],
      repositoryObservations: manifest.map((entry, index) => ({
        observationId: `read-${index.toString().padStart(3, "0")}`,
        toolName: "read_text_file" as const,
        scope: "full_file" as const,
        path: entry.newPath,
        line: null,
        lineCount: 1,
        contentSha256,
      })),
    });

    expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThanOrEqual(
      256 * 1024,
    );
    expect(Buffer.byteLength(JSON.stringify(evidence))).toBeLessThanOrEqual(
      256 * 1024,
    );
    const coverage = deriveReviewCoverageV1({
      snapshot,
      evidenceSet: evidence,
      packetRetainedEvidenceSet: true,
      snapshotRevalidated: true,
    });
    expect(coverage.status).toBe("complete");
    expect(coverage.files).toHaveLength(100);
    expect(coverage.changedTestPaths).toHaveLength(200);
    expect(Buffer.byteLength(JSON.stringify(coverage))).toBeGreaterThan(
      256 * 1024,
    );
    expect(Buffer.byteLength(JSON.stringify(coverage))).toBeLessThanOrEqual(
      4 * 256 * 1024,
    );
  });

  it("derives explicit incomplete coverage and never upgrades missing evidence", () => {
    const snapshot = completeSnapshot();
    const complete = completeEvidence(snapshot);
    const partial = canonicalizeReviewEvidenceSetV1({
      ...reviewEvidenceSetPreimage(complete),
      changeHunkSha256s: [complete.changeHunkSha256s[0]!],
      completeBodies: [],
      repositoryObservations: [],
    });
    const coverage = deriveReviewCoverageV1({
      snapshot,
      evidenceSet: partial,
      packetRetainedEvidenceSet: false,
      snapshotRevalidated: false,
    });

    expect(coverage.status).toBe("incomplete");
    expect(coverage.counts).toEqual({
      changedPaths: 2,
      admittedPaths: 0,
      omittedPaths: 2,
      changedHunks: 2,
      admittedHunks: 1,
      omittedHunks: 1,
    });
    expect(coverage.omissionCodes).toEqual([
      "change_hunk_not_retained",
      "changed_file_not_fully_read",
      "complete_body_not_retained",
      "packet_evidence_not_retained",
      "snapshot_not_revalidated",
    ]);
  });

  it("carries bounded-manifest omissions into path/hunk counts and incomplete status", () => {
    const complete = completeSnapshot();
    const snapshot = buildChangeSnapshotV1({
      ...changeSnapshotPreimage(complete),
      omittedPathCount: 1,
      omittedHunkCount: 3,
      manifestOmissionCodes: ["file_count_limit", "hunk_count_limit"],
    });
    const evidence = canonicalizeReviewEvidenceSetV1({
      ...reviewEvidenceSetPreimage(completeEvidence(complete)),
      snapshotId: snapshot.snapshotId,
    });
    const coverage = deriveReviewCoverageV1({
      snapshot,
      evidenceSet: evidence,
      packetRetainedEvidenceSet: true,
      snapshotRevalidated: true,
    });

    expect(coverage).toMatchObject({
      status: "incomplete",
      manifestStatus: "incomplete",
      counts: {
        changedPaths: 3,
        admittedPaths: 2,
        omittedPaths: 1,
        changedHunks: 5,
        admittedHunks: 2,
        omittedHunks: 3,
      },
    });
    expect(coverage.omissionCodes).toEqual([
      "change_hunk_not_retained",
      "manifest_incomplete",
      "manifest_path_omitted",
    ]);
  });
});
