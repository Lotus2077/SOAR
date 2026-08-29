import { describe, expect, it } from "vitest";

import {
  buildChangeHunkV1,
  buildChangeSnapshotV1,
} from "../../src/main/change-acquisition-contracts";
import {
  deriveVerifiedCalibrationSourceDiffV1,
  extractVerifiedReviewRiskV1,
} from "../../src/main/review-risk";
import {
  CHANGE_MANIFEST_OMISSION_CODES,
  CHANGE_REVIEW_CONTRACT_LIMITS,
  isChangedTestPathV1,
  type ChangeManifestEntryV1,
} from "../../src/shared/change-review-contracts";
import {
  CALIBRATION_SOURCE_DIFF_PROTOCOL_V1,
  FrozenCalibrationAcquisitionV1Schema,
  deriveCalibrationRiskFactsV1,
} from "../../src/shared/review-risk-evaluation";
import {
  REVIEW_RISK_CONTRACT_LIMITS,
  REVIEW_RISK_SENSITIVE_PATH_GLOBS,
  REVIEW_RISK_SIGNAL_IDS,
  ReviewRiskFactsV1Schema,
  ReviewRiskResultV1Schema,
  extractReviewRiskV1,
  isReviewRiskRelevantTestPath,
  isReviewRiskSensitivePath,
  scoreCompleteReviewRiskFactsV1,
} from "../../src/shared/review-risk";

const contentHash = "a".repeat(64);

function modifiedEntry(
  path: string,
  additions: number,
  deletions = 0,
): ChangeManifestEntryV1 {
  const lines = [
    ...Array.from({ length: deletions }, (_, index) => ({
      kind: "deletion" as const,
      content: `old-${index}`,
      terminator: "lf" as const,
      oldLine: index + 1,
      newLine: null,
    })),
    ...Array.from({ length: additions }, (_, index) => ({
      kind: "addition" as const,
      content: `new-${index}`,
      terminator: "lf" as const,
      oldLine: null,
      newLine: index + 1,
    })),
  ];
  const hunks =
    lines.length === 0
      ? []
      : [
          buildChangeHunkV1({
            schemaVersion: "change-hunk-v1",
            oldPath: path,
            newPath: path,
            oldStart: deletions > 0 ? 1 : 0,
            oldLines: deletions,
            newStart: additions > 0 ? 1 : 0,
            newLines: additions,
            lines,
          }),
        ];
  return {
    changeKind: "modified",
    oldPath: path,
    newPath: path,
    staged: true,
    unstaged: false,
    base: { mode: "100644", sizeBytes: 10, admittedContentSha256: contentHash },
    working: {
      mode: "100644",
      sizeBytes: 10 + additions,
      admittedContentSha256: contentHash,
    },
    omissionCodes: [],
    hunks,
  };
}

function snapshot(manifest: ChangeManifestEntryV1[]) {
  return buildChangeSnapshotV1({
    schemaVersion: "change-snapshot-v1",
    baseCommitOid: "1".repeat(40),
    indexSha256: "2".repeat(64),
    discoverySha256: "3".repeat(64),
    manifest,
    omittedPathCount: 0,
    omittedHunkCount: 0,
    manifestOmissionCodes: [],
  });
}

describe("review-risk-v1", () => {
  it("refuses to freeze source facts from an incomplete host snapshot", () => {
    const incompleteEntry = modifiedEntry("src/main/runtime.ts", 1);
    incompleteEntry.hunks = [];
    incompleteEntry.omissionCodes = ["truncated"];
    const incompleteSnapshot = buildChangeSnapshotV1({
      schemaVersion: "change-snapshot-v1",
      baseCommitOid: "1".repeat(40),
      indexSha256: "2".repeat(64),
      discoverySha256: "3".repeat(64),
      manifest: [incompleteEntry],
      omittedPathCount: 0,
      omittedHunkCount: 1,
      manifestOmissionCodes: ["truncated"],
    });

    expect(() =>
      deriveVerifiedCalibrationSourceDiffV1(incompleteSnapshot),
    ).toThrow(/complete host change snapshot/u);
  });

  it("rejects forged snapshot or hunk identities at the calibration host boundary", () => {
    const valid = snapshot([modifiedEntry("src/main/runtime.ts", 1, 1)]);
    const forgedSnapshot = structuredClone(valid);
    forgedSnapshot.snapshotId = "f".repeat(64);
    expect(() => deriveVerifiedCalibrationSourceDiffV1(forgedSnapshot)).toThrow(
      /snapshot identity mismatch/u,
    );

    const forgedHunk = structuredClone(valid);
    forgedHunk.manifest[0]!.hunks[0]!.hunkSha256 = "f".repeat(64);
    expect(() => deriveVerifiedCalibrationSourceDiffV1(forgedHunk)).toThrow(
      /hunk identity mismatch/u,
    );
  });

  it("uses the frozen canonical signal order and exact threshold arithmetic", () => {
    const result = extractReviewRiskV1(
      snapshot([
        modifiedEntry("src/main/providers/adapter.ts", 146),
        modifiedEntry("src/preload/index.ts", 1),
        modifiedEntry("src/renderer/src/App.tsx", 1),
        modifiedEntry("tests/adapter.test.ts", 1),
        modifiedEntry("docs/a.md", 148),
        modifiedEntry("docs/b.md", 1),
        modifiedEntry("docs/c.md", 1),
        modifiedEntry("docs/d.md", 1),
      ]),
    );

    expect(result.complete).toBe(true);
    expect(result.score).toBe(6);
    expect(result.classification).toBe("high_risk");
    expect(result.facts).toMatchObject({
      changedPathCount: 8,
      changedLineCount: 300,
      surfaces: ["main", "preload", "renderer", "test"],
      relevantTestPaths: ["tests/adapter.test.ts"],
    });
    expect(result.signals.map((signal) => signal.id)).toEqual(
      REVIEW_RISK_SIGNAL_IDS,
    );
    expect(result.signals.map((signal) => signal.contribution)).toEqual([
      1, 1, 2, 0, 2,
    ]);

    const forged = structuredClone(result);
    forged.signals[0] = {
      ...forged.signals[0]!,
      triggerAt: 1_000,
      triggered: false,
      contribution: 0,
    };
    forged.score = 5;
    expect(ReviewRiskResultV1Schema.safeParse(forged).success).toBe(false);
  });

  it("keeps a score of two below the approved escalation threshold", () => {
    const result = extractReviewRiskV1(
      snapshot([modifiedEntry("src/renderer/src/panel.tsx", 1)]),
    );

    expect(result.score).toBe(2);
    expect(result.classification).toBe("low_risk");
    expect(
      result.signals.find(
        (signal) => signal.id === "runtime_without_relevant_test",
      ),
    ).toMatchObject({ triggered: true, contribution: 2 });
  });

  it("combines a sensitive runtime path and missing test into high risk", () => {
    const result = extractReviewRiskV1(
      snapshot([modifiedEntry("src/main/providers/adapter.ts", 1)]),
    );

    expect(result.score).toBe(4);
    expect(result.classification).toBe("high_risk");
    expect(result.facts.sensitivePaths).toEqual([
      "src/main/providers/adapter.ts",
    ]);
  });

  it("recognizes the old side of a content-identical sensitive rename", () => {
    const renamed: ChangeManifestEntryV1 = {
      changeKind: "renamed",
      oldPath: "src/main/providers/old.ts",
      newPath: "docs/old.ts",
      staged: true,
      unstaged: false,
      base: { mode: "100644", sizeBytes: 10, admittedContentSha256: contentHash },
      working: {
        mode: "100644",
        sizeBytes: 10,
        admittedContentSha256: contentHash,
      },
      omissionCodes: [],
      hunks: [],
    };
    const result = extractReviewRiskV1(snapshot([renamed]));

    expect(result.facts.changedLineCount).toBe(0);
    expect(result.facts.sensitivePaths).toEqual([
      "src/main/providers/old.ts",
    ]);
    expect(result.facts.runtimePaths).toEqual([
      "src/main/providers/old.ts",
    ]);
    expect(result.score).toBe(4);
    expect(result.classification).toBe("high_risk");
  });

  it("uses both rename sides for runtime and surface risk with calibration parity", () => {
    const renamed: ChangeManifestEntryV1 = {
      changeKind: "renamed",
      oldPath: "src/main/core.ts",
      newPath: "docs/core.ts",
      staged: true,
      unstaged: false,
      base: { mode: "100644", sizeBytes: 10, admittedContentSha256: contentHash },
      working: {
        mode: "100644",
        sizeBytes: 10,
        admittedContentSha256: contentHash,
      },
      omissionCodes: [],
      hunks: [],
    };
    const documentationEntries = Array.from({ length: 7 }, (_, index) =>
      modifiedEntry(`docs/change-${index}.md`, 1),
    );
    const result = extractReviewRiskV1(
      snapshot([renamed, ...documentationEntries]),
    );
    const calibrationFacts = deriveCalibrationRiskFactsV1([
      {
        oldPath: "src/main/core.ts",
        newPath: "docs/core.ts",
        changeKind: "renamed",
        additions: 0,
        deletions: 0,
      },
      ...Array.from({ length: 7 }, (_, index) => ({
        oldPath: `docs/change-${index}.md`,
        newPath: `docs/change-${index}.md`,
        changeKind: "modified" as const,
        additions: 1,
        deletions: 0,
      })),
    ]);

    expect(result.facts).toEqual(calibrationFacts);
    expect(result.facts).toMatchObject({
      surfaces: ["main"],
      runtimePaths: ["src/main/core.ts"],
    });
    expect(result.score).toBe(3);
    expect(result.classification).toBe("high_risk");
  });

  it("counts both surfaces when a rename crosses a code boundary", () => {
    const renamed: ChangeManifestEntryV1 = {
      changeKind: "renamed",
      oldPath: "src/main/old.ts",
      newPath: "src/preload/new.ts",
      staged: true,
      unstaged: false,
      base: { mode: "100644", sizeBytes: 10, admittedContentSha256: contentHash },
      working: {
        mode: "100644",
        sizeBytes: 10,
        admittedContentSha256: contentHash,
      },
      omissionCodes: [],
      hunks: [],
    };
    const result = extractReviewRiskV1(snapshot([renamed]));
    const calibrationFacts = deriveCalibrationRiskFactsV1([
      {
        oldPath: "src/main/old.ts",
        newPath: "src/preload/new.ts",
        changeKind: "renamed",
        additions: 0,
        deletions: 0,
      },
    ]);

    expect(result.facts).toEqual(calibrationFacts);
    expect(result.facts.surfaces).toEqual(["main", "preload"]);
    expect(result.facts.runtimePaths).toEqual([
      "src/main/old.ts",
      "src/preload/new.ts",
    ]);
  });

  it("returns no score for any omitted or non-text evidence", () => {
    const binary: ChangeManifestEntryV1 = {
      changeKind: "modified",
      oldPath: "assets/image.png",
      newPath: "assets/image.png",
      staged: true,
      unstaged: false,
      base: { mode: "100644", sizeBytes: 10, admittedContentSha256: null },
      working: { mode: "100644", sizeBytes: 11, admittedContentSha256: null },
      omissionCodes: ["binary"],
      hunks: [],
    };
    const result = extractReviewRiskV1(snapshot([binary]));

    expect(result).toMatchObject({
      complete: false,
      score: null,
      classification: "incomplete",
      signals: [],
      incompleteReasons: ["assets/image.png:binary"],
    });

    const symlink: ChangeManifestEntryV1 = {
      changeKind: "modified",
      oldPath: "src/link",
      newPath: "src/link",
      staged: true,
      unstaged: false,
      base: { mode: "120000", sizeBytes: 6, admittedContentSha256: contentHash },
      working: { mode: "120000", sizeBytes: 7, admittedContentSha256: contentHash },
      omissionCodes: ["symlink"],
      hunks: [],
    };
    expect(extractReviewRiskV1(snapshot([symlink]))).toMatchObject({
      complete: false,
      score: null,
      incompleteReasons: ["src/link:symlink"],
    });
  });

  it("returns incomplete risk for an omitted maximum-length path", () => {
    const path = "a".repeat(CHANGE_REVIEW_CONTRACT_LIMITS.maxPathCharacters);
    const binary: ChangeManifestEntryV1 = {
      changeKind: "modified",
      oldPath: path,
      newPath: path,
      staged: true,
      unstaged: false,
      base: { mode: "100644", sizeBytes: 10, admittedContentSha256: null },
      working: { mode: "100644", sizeBytes: 11, admittedContentSha256: null },
      omissionCodes: ["binary"],
      hunks: [],
    };

    const result = extractVerifiedReviewRiskV1(snapshot([binary]));
    expect(result).toMatchObject({
      complete: false,
      classification: "incomplete",
      score: null,
      incompleteReasons: expect.arrayContaining([`${path}:binary`]),
    });
  });

  it("keeps derived counts safe at the maximum omitted-count contract", () => {
    const validSnapshot = buildChangeSnapshotV1({
      schemaVersion: "change-snapshot-v1",
      baseCommitOid: "1".repeat(40),
      indexSha256: "2".repeat(64),
      discoverySha256: "3".repeat(64),
      manifest: [modifiedEntry("docs/a.md", 1)],
      omittedPathCount: CHANGE_REVIEW_CONTRACT_LIMITS.maxOmittedPaths,
      omittedHunkCount: CHANGE_REVIEW_CONTRACT_LIMITS.maxOmittedHunks,
      manifestOmissionCodes: ["file_count_limit", "hunk_count_limit"],
    });

    const result = extractVerifiedReviewRiskV1(validSnapshot);
    expect(result.complete).toBe(false);
    expect(result.facts.changedPathCount).toBe(
      CHANGE_REVIEW_CONTRACT_LIMITS.maxOmittedPaths + 1,
    );
    expect(Number.isSafeInteger(result.facts.changedPathCount)).toBe(true);
  });

  it("fails closed on a malformed acquisition identity", () => {
    const valid = snapshot([modifiedEntry("docs/a.md", 1)]);
    expect(() =>
      extractReviewRiskV1({ ...valid, snapshotId: "not-a-sha256" }),
    ).toThrow(/invalid string|pattern|snapshotId/iu);

    expect(() =>
      extractVerifiedReviewRiskV1({
        ...valid,
        discoverySha256: "f".repeat(64),
      }),
    ).toThrow(/snapshot identity mismatch/iu);
  });

  it("keeps the sensitive path table sorted, frozen in behavior, and bounded", () => {
    expect([...REVIEW_RISK_SENSITIVE_PATH_GLOBS].sort()).toEqual(
      REVIEW_RISK_SENSITIVE_PATH_GLOBS,
    );
    expect(isReviewRiskSensitivePath("src/main/database.ts")).toBe(true);
    expect(isReviewRiskSensitivePath("src/core/budget-ledger.ts")).toBe(true);
    expect(isReviewRiskSensitivePath("src/renderer/src/App.tsx")).toBe(false);
    expect(isReviewRiskSensitivePath("docs/src/main/database.ts")).toBe(false);
  });

  it.each([
    ["tests/router.test.ts", true],
    ["tests/router.spec.integration.ts", true],
    ["tests/test.ts", false],
    ["tests/spec.ts", false],
  ])("shares the frozen relevant-test matcher for %s", (path, expected) => {
    expect(isChangedTestPathV1(path)).toBe(expected);
    expect(isReviewRiskRelevantTestPath(path)).toBe(expected);
  });

  it.each([
    "budget-ledger.ts",
    "cancel-session.ts",
    "concurrency-guard.ts",
    "credential-store.ts",
    "egress-policy.ts",
    "migration-runner.ts",
    "permission-gate.ts",
    "security-policy.ts",
  ])("matches direct and nested sensitive-family path %s", (basename) => {
    expect(isReviewRiskSensitivePath(`src/${basename}`)).toBe(true);
    expect(isReviewRiskSensitivePath(`src/deep/nested/${basename}`)).toBe(true);
  });

  it("derives path and omission bounds from the admitted snapshot limits", () => {
    expect(REVIEW_RISK_CONTRACT_LIMITS).toMatchObject({
      maxSensitivePaths: CHANGE_REVIEW_CONTRACT_LIMITS.maxManifestEntries * 2,
      maxRuntimePaths: CHANGE_REVIEW_CONTRACT_LIMITS.maxManifestEntries * 2,
      maxRelevantTestPaths:
        CHANGE_REVIEW_CONTRACT_LIMITS.maxManifestEntries * 2,
      maxFactsSerializedRecordBytes:
        CHANGE_REVIEW_CONTRACT_LIMITS.maxSerializedRecordBytes * 4,
      maxSerializedRecordBytes:
        CHANGE_REVIEW_CONTRACT_LIMITS.maxSerializedRecordBytes *
        (CHANGE_MANIFEST_OMISSION_CODES.length + 3),
    });

    const runtimePaths = Array.from(
      { length: CHANGE_REVIEW_CONTRACT_LIMITS.maxManifestEntries * 2 },
      (_, index) => `src/runtime-${index.toString().padStart(3, "0")}.ts`,
    );
    const sensitivePaths = [...runtimePaths];
    const facts = {
      changedPathCount: CHANGE_REVIEW_CONTRACT_LIMITS.maxManifestEntries,
      changedLineCount: 0,
      surfaces: ["main"],
      sensitivePaths,
      runtimePaths,
      relevantTestPaths: runtimePaths.map((path) =>
        path.replace("src/", "tests/").replace(".ts", ".test.ts"),
      ),
    };

    expect(ReviewRiskFactsV1Schema.safeParse(facts).success).toBe(true);
    expect(
      ReviewRiskFactsV1Schema.safeParse({
        ...facts,
        runtimePaths: [...runtimePaths, "src/runtime-over-limit.ts"].sort(),
      }).success,
    ).toBe(false);
  });

  it("keeps risk extraction total for a large valid rename projection", () => {
    const deepPrefix = [
      "src",
      "a".repeat(220),
      "b".repeat(220),
      "c".repeat(220),
    ].join("/");
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
          admittedContentSha256: contentHash,
        },
        working: {
          mode: "100644" as const,
          sizeBytes: 1,
          admittedContentSha256: contentHash,
        },
        omissionCodes: [],
        hunks: [],
      } satisfies ChangeManifestEntryV1;
    });
    const validSnapshot = snapshot(manifest);

    expect(Buffer.byteLength(JSON.stringify(validSnapshot))).toBeLessThanOrEqual(
      CHANGE_REVIEW_CONTRACT_LIMITS.maxSerializedRecordBytes,
    );
    const result = extractVerifiedReviewRiskV1(validSnapshot);
    expect(result.complete).toBe(true);
    expect(result.facts.sensitivePaths).toHaveLength(200);
    expect(result.facts.runtimePaths).toHaveLength(200);
    expect(result.facts.relevantTestPaths).toHaveLength(200);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(
      REVIEW_RISK_CONTRACT_LIMITS.maxSerializedRecordBytes,
    );
  });

  it("rejects calibration source diffs beyond the host manifest maximum", () => {
    const sourceDiff = Array.from(
      { length: CHANGE_REVIEW_CONTRACT_LIMITS.maxManifestEntries + 1 },
      (_, index) => {
        const path = `docs/file-${index.toString().padStart(3, "0")}.md`;
        return {
          oldPath: path,
          newPath: path,
          changeKind: "modified" as const,
          additions: 1,
          deletions: 0,
        };
      },
    );
    const verifiedFeatureFacts = deriveCalibrationRiskFactsV1(sourceDiff);
    const score = scoreCompleteReviewRiskFactsV1(verifiedFeatureFacts);

    expect(
      FrozenCalibrationAcquisitionV1Schema.safeParse({
        status: "verified_change_snapshot_v1",
        inspectorContractVersion: "inspect-git-changes-v1",
        acquisitionComplete: true,
        incompleteReasons: [],
        snapshotId: "1".repeat(64),
        indexSha256: "2".repeat(64),
        discoverySha256: "3".repeat(64),
        sourceDiffProtocol: CALIBRATION_SOURCE_DIFF_PROTOCOL_V1,
        sourceDiff,
        verifiedFeatureFacts,
        verifiedScore: score.score,
        verifiedClassification: score.classification,
      }).success,
    ).toBe(false);
  });

  it("caps a frozen calibration acquisition at the shared serialized limit", () => {
    const sourceDiff = Array.from(
      { length: CHANGE_REVIEW_CONTRACT_LIMITS.maxManifestEntries },
      (_, index) => {
        const path = `docs/${index.toString().padStart(3, "0")}-${"x".repeat(700)}.md`;
        return {
          oldPath: path,
          newPath: path,
          changeKind: "modified" as const,
          additions: 1,
          deletions: 0,
        };
      },
    );
    const verifiedFeatureFacts = deriveCalibrationRiskFactsV1(sourceDiff);
    const score = scoreCompleteReviewRiskFactsV1(verifiedFeatureFacts);

    expect(
      FrozenCalibrationAcquisitionV1Schema.safeParse({
        status: "verified_change_snapshot_v1",
        inspectorContractVersion: "inspect-git-changes-v1",
        acquisitionComplete: true,
        incompleteReasons: [],
        snapshotId: "1".repeat(64),
        indexSha256: "2".repeat(64),
        discoverySha256: "3".repeat(64),
        sourceDiffProtocol: CALIBRATION_SOURCE_DIFF_PROTOCOL_V1,
        sourceDiff,
        verifiedFeatureFacts,
        verifiedScore: score.score,
        verifiedClassification: score.classification,
      }).success,
    ).toBe(false);
  });

  it("rejects oversized derived calibration facts without escaping safeParse", () => {
    const sourceDiff = Array.from(
      { length: CHANGE_REVIEW_CONTRACT_LIMITS.maxManifestEntries },
      (_, index) => {
        const path = `src/${index.toString().padStart(3, "0")}-${"x".repeat(1_400)}.ts`;
        return {
          oldPath: path,
          newPath: path,
          changeKind: "modified" as const,
          additions: 1,
          deletions: 0,
        };
      },
    );
    const candidate = {
      status: "verified_change_snapshot_v1",
      inspectorContractVersion: "inspect-git-changes-v1",
      acquisitionComplete: true,
      incompleteReasons: [],
      snapshotId: "1".repeat(64),
      indexSha256: "2".repeat(64),
      discoverySha256: "3".repeat(64),
      sourceDiffProtocol: CALIBRATION_SOURCE_DIFF_PROTOCOL_V1,
      sourceDiff,
      verifiedFeatureFacts: {
        changedPathCount: sourceDiff.length,
        changedLineCount: sourceDiff.length,
        surfaces: [],
        sensitivePaths: [],
        runtimePaths: [],
        relevantTestPaths: [],
      },
      verifiedScore: 0,
      verifiedClassification: "low_risk",
    };

    expect(() =>
      FrozenCalibrationAcquisitionV1Schema.safeParse(candidate),
    ).not.toThrow();
    expect(
      FrozenCalibrationAcquisitionV1Schema.safeParse(candidate).success,
    ).toBe(false);
  });

  it("caps serialized review-risk facts and results", () => {
    const deepPathPrefix = [
      "src",
      ...Array.from({ length: 12 }, (_, index) =>
        `${String.fromCharCode(97 + index)}${"x".repeat(239)}`,
      ),
    ].join("/");
    const oversizedSensitivePaths = Array.from(
      { length: REVIEW_RISK_CONTRACT_LIMITS.maxSensitivePaths },
      (_, index) =>
        `${deepPathPrefix}/security-${index.toString().padStart(3, "0")}.ts`,
    );
    const oversizedFacts = {
      changedPathCount: CHANGE_REVIEW_CONTRACT_LIMITS.maxManifestEntries,
      changedLineCount: 0,
      surfaces: [],
      sensitivePaths: oversizedSensitivePaths,
      runtimePaths: [],
      relevantTestPaths: [],
    };
    expect(ReviewRiskFactsV1Schema.safeParse(oversizedFacts).success).toBe(false);

    const smallFacts = {
      changedPathCount: 0,
      changedLineCount: 0,
      surfaces: [],
      sensitivePaths: [],
      runtimePaths: [],
      relevantTestPaths: [],
    };
    const oversizedReasons = Array.from(
      { length: 1_000 },
      (_, index) => `${index.toString().padStart(4, "0")}:${"x".repeat(4_000)}`,
    );
    expect(
      ReviewRiskResultV1Schema.safeParse({
        schemaVersion: "review-risk-result-v1",
        policyId: "review-risk-v1",
        snapshotId: "1".repeat(64),
        complete: false,
        threshold: 3,
        score: null,
        classification: "incomplete",
        signals: [],
        facts: smallFacts,
        incompleteReasons: oversizedReasons,
      }).success,
    ).toBe(false);
  });
});
