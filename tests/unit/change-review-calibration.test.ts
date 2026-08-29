import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { validateFrozenCalibrationMaterialization } from "../../benchmarks/change-review/validate-materialization";
import { MAX_CHANGE_SOURCE_BYTES_PER_SIDE } from "../../src/main/tools/change-content-reader";
import {
  MAX_INSPECT_CHANGED_PATHS,
  MAX_INSPECT_HUNKS,
  MAX_INSPECT_RESULT_BYTES,
  MAX_INSPECT_TOTAL_SOURCE_BYTES,
} from "../../src/main/tools/inspect-git-changes";
import {
  CALIBRATION_SOURCE_DIFF_PROTOCOL_V1,
  ChangeReviewCalibrationChangeV1Schema,
  ChangeReviewCalibrationSetV1Schema,
  ChangeReviewEvalProtocolV1Schema,
} from "../../src/shared/review-risk-evaluation";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const calibrationPath = path.join(
  projectRoot,
  "benchmarks/change-review/calibration-v1.json",
);
const protocolPath = path.join(
  projectRoot,
  "benchmarks/change-review/protocol-v1.json",
);

const repositoryEnvironment = {
  "https://github.com/Lotus2077/SOAR.git": "SOAR_CALIBRATION_SOAR_REPO",
  "https://github.com/pallets/flask.git": "SOAR_CALIBRATION_FLASK_REPO",
  "https://github.com/pytest-dev/pytest.git": "SOAR_CALIBRATION_PYTEST_REPO",
} as const;

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function objectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(objectKeys);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...objectKeys(child)]);
}

function explicitRepositoryRoots(): ReadonlyMap<string, string> | null {
  const entries = Object.entries(repositoryEnvironment).map(
    ([repository, environmentName]) => [
      repository,
      process.env[environmentName]?.trim() ?? "",
    ] as const,
  );
  const configuredCount = entries.filter(([, repositoryRoot]) => repositoryRoot !== "")
    .length;
  if (configuredCount === 0) return null;
  if (configuredCount !== entries.length) {
    throw new Error(
      `Set all calibration repository variables together: ${Object.values(repositoryEnvironment).join(", ")}.`,
    );
  }
  return new Map(
    entries.map(([repository, repositoryRoot]) => [
      repository,
      path.resolve(repositoryRoot),
    ]),
  );
}

const localRepositoryRoots = explicitRepositoryRoots();

describe("change-review-eval-v1 frozen calibration contracts", () => {
  it("strictly validates the frozen protocol and its hash-bound 12-change manifest offline", async () => {
    const calibrationBytes = await readFile(calibrationPath);
    const calibration = ChangeReviewCalibrationSetV1Schema.parse(
      JSON.parse(calibrationBytes.toString("utf8")),
    );
    const protocol = ChangeReviewEvalProtocolV1Schema.parse(
      await readJson(protocolPath),
    );

    expect(calibration.status).toBe("frozen");
    expect(calibration.changes).toHaveLength(12);
    expect(
      calibration.changes.every(
        (change) =>
          change.acquisition.status === "verified_change_snapshot_v1" &&
          change.acquisition.acquisitionComplete &&
          change.acquisition.incompleteReasons.length === 0,
      ),
    ).toBe(true);
    expect(protocol.status).toBe("frozen");
    expect(protocol.riskPolicy.changedLineProtocol).toBe(
      CALIBRATION_SOURCE_DIFF_PROTOCOL_V1,
    );
    expect(protocol.calibration).toMatchObject({
      status: "verified_change_snapshots_v1",
      fixtureCount: 12,
    });
    expect(protocol.calibration.manifestSha256).toBe(
      createHash("sha256").update(calibrationBytes).digest("hex"),
    );
    const packageManifest = (await readJson(
      path.join(projectRoot, "package.json"),
    )) as { dependencies?: Record<string, string> };
    expect(protocol.acquisitionProfile).toEqual({
      requestSchemaVersion: "inspect-git-changes-v1",
      resultSchemaVersion: "inspect-git-changes-result-v1",
      diffEngine: `diff@${packageManifest.dependencies?.diff}`,
      maxChangedPaths: MAX_INSPECT_CHANGED_PATHS,
      maxSourceBytesPerSide: MAX_CHANGE_SOURCE_BYTES_PER_SIDE,
      maxTotalSourceBytes: MAX_INSPECT_TOTAL_SOURCE_BYTES,
      maxHunks: MAX_INSPECT_HUNKS,
      maxResultBytes: MAX_INSPECT_RESULT_BYTES,
    });
    expect(protocol.heldOut).toMatchObject({
      fixtureIdentitiesIncluded: false,
      goldIncluded: false,
      storageBoundary: "sealed_outside_agent_workspace",
    });
  });

  it("pins 12 real changes across the three named public repositories", async () => {
    const calibration = ChangeReviewCalibrationSetV1Schema.parse(
      await readJson(calibrationPath),
    );
    const repositoryCounts = Object.fromEntries(
      Object.keys(repositoryEnvironment).map((repository) => [
        repository,
        calibration.changes.filter(
          (change) => change.source.repository === repository,
        ).length,
      ]),
    );

    expect(repositoryCounts).toEqual({
      "https://github.com/Lotus2077/SOAR.git": 3,
      "https://github.com/pallets/flask.git": 6,
      "https://github.com/pytest-dev/pytest.git": 3,
    });
    expect(
      calibration.changes.every(
        (change) =>
          change.source.changeUrl.endsWith(change.source.changeRevision) &&
          change.source.baseRevision !== change.source.changeRevision,
      ),
    ).toBe(true);
  });

  it("pins the expected risk arithmetic and preserves its one label disagreement", async () => {
    const calibration = ChangeReviewCalibrationSetV1Schema.parse(
      await readJson(calibrationPath),
    );
    const lowRisk = calibration.changes.filter(
      (change) => change.acquisition.verifiedClassification === "low_risk",
    );
    const highRisk = calibration.changes.filter(
      (change) => change.acquisition.verifiedClassification === "high_risk",
    );
    const mismatches = calibration.changes.filter((change) => {
      const thresholdAttention =
        change.acquisition.verifiedClassification === "high_risk"
          ? "heightened"
          : "routine";
      return change.label.reviewAttention !== thresholdAttention;
    });

    expect(lowRisk).toHaveLength(5);
    expect(highRisk).toHaveLength(7);
    expect(mismatches.map((change) => change.id)).toEqual([
      "cal-010-pytest-source-line-memoization",
    ]);
    expect(mismatches[0]?.acquisition).toMatchObject({
      verifiedScore: 2,
      verifiedClassification: "low_risk",
    });
    expect(mismatches[0]?.label.reviewAttention).toBe("heightened");
  });

  it("keeps held-out identities and evaluator gold structurally absent", async () => {
    const calibrationInput = await readJson(calibrationPath);
    const keys = new Set(objectKeys(calibrationInput));
    expect(keys).not.toContain("heldOut");
    expect(keys).not.toContain("gold");
    expect(keys).not.toContain("oracle");
    expect(keys).not.toContain("defects");
    expect(keys).not.toContain("expectedFindings");
    expect(keys).not.toContain("findings");

    const files = (
      await readdir(path.join(projectRoot, "benchmarks/change-review"), {
        recursive: true,
      })
    ).sort();
    expect(files.some((file) => /held.?out|oracle|gold/iu.test(file))).toBe(false);
  });

  it("rejects pending-state, derived-risk, and hidden-evaluator tampering", async () => {
    const calibrationInput = (await readJson(calibrationPath)) as Record<
      string,
      unknown
    >;
    expect(
      ChangeReviewCalibrationSetV1Schema.safeParse({
        ...calibrationInput,
        status: "pending_acquisition",
      }).success,
    ).toBe(false);

    const calibration = ChangeReviewCalibrationSetV1Schema.parse(calibrationInput);
    const firstChange = calibration.changes[0]!;
    expect(
      ChangeReviewCalibrationChangeV1Schema.safeParse({
        ...firstChange,
        acquisition: {
          ...firstChange.acquisition,
          verifiedScore: firstChange.acquisition.verifiedScore + 1,
        },
      }).success,
    ).toBe(false);
    const protocol = ChangeReviewEvalProtocolV1Schema.parse(
      await readJson(protocolPath),
    );
    expect(
      ChangeReviewEvalProtocolV1Schema.safeParse({
        ...protocol,
        riskPolicy: {
          ...protocol.riskPolicy,
          changedLineProtocol: "git_numstat_v1",
        },
      }).success,
    ).toBe(false);
    expect(
      ChangeReviewCalibrationChangeV1Schema.safeParse({
        ...firstChange,
        gold: [{ severity: "P0", title: "must remain sealed" }],
      }).success,
    ).toBe(false);
  });

  it.skipIf(localRepositoryRoots === null)(
    "optionally reproduces all source pins, patches, snapshots, and risk facts from explicit local clones",
    async () => {
      const calibration = ChangeReviewCalibrationSetV1Schema.parse(
        await readJson(calibrationPath),
      );
      const materialization = await validateFrozenCalibrationMaterialization(
        localRepositoryRoots!,
        calibration,
      );

      expect(materialization).toMatchObject({
        status: "verified_frozen_materialization",
        repositoriesResolved: 3,
        sourcePinsVerified: 12,
        directParentsVerified: 12,
        commitMetadataVerified: 12,
        sourceDiffsVerified: 12,
        patchApplicationsVerified: 12,
        changeSnapshotsVerified: 12,
        riskFactsVerified: 12,
        riskResultsVerified: 12,
      });
    },
    180_000,
  );
});
