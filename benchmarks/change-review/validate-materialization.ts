import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import type { ReviewRiskResultV1 } from "../../src/shared/review-risk";
import {
  deriveVerifiedCalibrationSourceDiffV1,
  extractVerifiedReviewRiskV1,
} from "../../src/main/review-risk";
import type { ChangeSnapshotV1 } from "../../src/shared/change-review-contracts";
import { inspectGitChanges } from "../../src/main/tools/inspect-git-changes";
import {
  ChangeReviewCalibrationSetV1Schema,
  type ChangeReviewCalibrationSetV1,
} from "../../src/shared/review-risk-evaluation";

interface GitOptions {
  input?: Buffer;
  encoding?: BufferEncoding;
}

const CALIBRATION_GIT_ENV: NodeJS.ProcessEnv = {
  PATH: "/usr/bin:/bin",
  LANG: "C",
  LC_ALL: "C",
  TMPDIR: "/tmp",
  TZ: "UTC",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_NO_LAZY_FETCH: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  GIT_PROTOCOL_FROM_USER: "0",
  GIT_TERMINAL_PROMPT: "0",
};

const CALIBRATION_GIT_CONFIG = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "diff.external=",
  "-c",
  "diff.trustExitCode=false",
  "-c",
  "protocol.allow=never",
] as const;

function git(
  repositoryRoot: string,
  arguments_: readonly string[],
  options: GitOptions & { encoding: BufferEncoding },
): string;
function git(
  repositoryRoot: string,
  arguments_: readonly string[],
  options?: GitOptions,
): Buffer;
function git(
  repositoryRoot: string,
  arguments_: readonly string[],
  options: GitOptions = {},
): string | Buffer {
  return execFileSync(
    "/usr/bin/git",
    [...CALIBRATION_GIT_CONFIG, "-C", repositoryRoot, ...arguments_],
    {
      encoding: options.encoding,
      env: CALIBRATION_GIT_ENV,
      input: options.input,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
}

export async function acquireMaterializedChangeSnapshot(
  repositoryRoot: string,
  baseRevision: string,
  changeRevision: string,
): Promise<{ snapshot: ChangeSnapshotV1; risk: ReviewRiskResultV1 }> {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "soar-calibration-"));
  const cloneRoot = path.join(temporaryRoot, "repository");
  try {
    execFileSync(
      "/usr/bin/git",
      [
        ...CALIBRATION_GIT_CONFIG,
        "-c",
        "protocol.file.allow=always",
        "clone",
        "--quiet",
        "--shared",
        "--no-checkout",
        repositoryRoot,
        cloneRoot,
      ],
      { env: CALIBRATION_GIT_ENV, maxBuffer: 64 * 1024 * 1024 },
    );
    git(cloneRoot, ["checkout", "--quiet", "--detach", baseRevision]);
    const patch = git(repositoryRoot, [
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      "--no-textconv",
      "--find-renames",
      baseRevision,
      changeRevision,
    ]);
    git(cloneRoot, ["apply", "--index", "--check", "-"], {
      input: patch,
    });
    git(cloneRoot, ["apply", "--index", "-"], {
      input: patch,
    });
    const materializedTree = git(cloneRoot, ["write-tree"], {
      encoding: "utf8",
    }).trim();
    const targetTree = git(
      repositoryRoot,
      ["rev-parse", `${changeRevision}^{tree}`],
      { encoding: "utf8" },
    ).trim();
    if (materializedTree !== targetTree) {
      throw new Error(
        `Patch materialization tree mismatch (${materializedTree} != ${targetTree}).`,
      );
    }
    const inspection = await inspectGitChanges({
      workspaceRoot: cloneRoot,
      request: { schemaVersion: "inspect-git-changes-v1" },
    });
    return {
      snapshot: inspection.snapshot,
      risk: extractVerifiedReviewRiskV1(inspection.snapshot),
    };
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

export type CalibrationRepositoryResolver =
  | Readonly<Record<string, string>>
  | ReadonlyMap<string, string>
  | ((repository: string) => string | undefined | Promise<string | undefined>);

export interface FrozenCalibrationChangeValidation {
  id: string;
  repository: string;
  baseRevision: string;
  changeRevision: string;
  snapshotId: string;
  indexSha256: string;
  discoverySha256: string;
  complete: true;
  score: number;
  classification: "low_risk" | "high_risk";
  incompleteReasons: [];
}

export interface FrozenCalibrationValidationReport {
  schemaVersion: "change-review-calibration-materialization-report-v1";
  status: "verified_frozen_materialization";
  setId: "change-review-calibration-v1";
  calibrationStatus: "frozen";
  repositoriesResolved: number;
  sourcePinsVerified: number;
  directParentsVerified: number;
  commitMetadataVerified: number;
  sourceDiffsVerified: number;
  patchApplicationsVerified: number;
  changeSnapshotsVerified: number;
  riskFactsVerified: number;
  riskResultsVerified: number;
  changes: FrozenCalibrationChangeValidation[];
  frozen: true;
}

async function resolveRepositoryRoot(
  resolver: CalibrationRepositoryResolver,
  repository: string,
): Promise<string> {
  let resolved: string | undefined;
  if (typeof resolver === "function") {
    resolved = await resolver(repository);
  } else if (isRepositoryMap(resolver)) {
    resolved = resolver.get(repository);
  } else if (Object.prototype.hasOwnProperty.call(resolver, repository)) {
    resolved = resolver[repository];
  }
  if (resolved === undefined || resolved.trim() === "") {
    throw new Error(
      `No local repository was resolved for ${repository}.`,
    );
  }
  return path.resolve(resolved);
}

function isRepositoryMap(
  value: Readonly<Record<string, string>> | ReadonlyMap<string, string>,
): value is ReadonlyMap<string, string> {
  return typeof (value as { get?: unknown }).get === "function";
}

function assertEqual<T>(
  actual: T,
  expected: T,
  label: string,
  changeId: string,
): void {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(`${label} mismatch for ${changeId}.`);
  }
}

/**
 * Reproduces every pinned public change through the host acquisition path.
 * The resolver is the explicit trust boundary from a manifest repository URL
 * to a local Git checkout; this function does not perform network access.
 */
export async function validateFrozenCalibrationMaterialization(
  resolver: CalibrationRepositoryResolver,
  input: ChangeReviewCalibrationSetV1,
): Promise<FrozenCalibrationValidationReport> {
  const calibration = ChangeReviewCalibrationSetV1Schema.parse(input);
  const changes: FrozenCalibrationChangeValidation[] = [];
  const repositoryRoots = new Map<string, string>();
  for (const change of calibration.changes) {
    let repositoryRoot = repositoryRoots.get(change.source.repository);
    if (repositoryRoot === undefined) {
      repositoryRoot = await resolveRepositoryRoot(
        resolver,
        change.source.repository,
      );
      repositoryRoots.set(change.source.repository, repositoryRoot);
    }
    const { baseRevision, changeRevision } = change.source;
    for (const revision of [baseRevision, changeRevision]) {
      const objectType = git(repositoryRoot, ["cat-file", "-t", revision], {
        encoding: "utf8",
      }).trim();
      if (objectType !== "commit") {
        throw new Error(`${revision} is not a commit object.`);
      }
      const resolvedRevision = git(
        repositoryRoot,
        ["rev-parse", "--verify", `${revision}^{commit}`],
        { encoding: "utf8" },
      ).trim();
      if (resolvedRevision !== revision) {
        throw new Error(`Pinned commit identity mismatch for ${change.id}.`);
      }
    }
    const directParent = git(
      repositoryRoot,
      ["rev-parse", `${changeRevision}^`],
      { encoding: "utf8" },
    ).trim();
    if (directParent !== baseRevision) {
      throw new Error(
        `${changeRevision} is not directly based on ${baseRevision}.`,
      );
    }
    const [committedAt, subject] = git(
      repositoryRoot,
      ["show", "-s", "--format=%cI%x00%s", changeRevision],
      { encoding: "utf8" },
    )
      .trimEnd()
      .split("\0");
    if (
      committedAt !== change.source.committedAt ||
      subject !== change.source.subject
    ) {
      throw new Error(`Pinned commit metadata mismatch for ${change.id}.`);
    }
    const acquired = await acquireMaterializedChangeSnapshot(
      repositoryRoot,
      baseRevision,
      changeRevision,
    );
    const sourceDiff = deriveVerifiedCalibrationSourceDiffV1(
      acquired.snapshot,
    );
    assertEqual(
      sourceDiff,
      change.acquisition.sourceDiff,
      "Pinned host snapshot-hunk source diff",
      change.id,
    );
    assertEqual(
      acquired.snapshot.snapshotId,
      change.acquisition.snapshotId,
      "Change snapshot identity",
      change.id,
    );
    assertEqual(
      acquired.snapshot.indexSha256,
      change.acquisition.indexSha256,
      "Change snapshot index identity",
      change.id,
    );
    assertEqual(
      acquired.snapshot.discoverySha256,
      change.acquisition.discoverySha256,
      "Change snapshot discovery identity",
      change.id,
    );
    if (!acquired.risk.complete) {
      throw new Error(`Acquired review risk was incomplete for ${change.id}.`);
    }
    if (
      acquired.risk.score === null ||
      acquired.risk.classification === "incomplete"
    ) {
      throw new Error(`Acquired review risk was not scoreable for ${change.id}.`);
    }
    assertEqual(
      acquired.risk.incompleteReasons,
      change.acquisition.incompleteReasons,
      "Review risk incomplete reasons",
      change.id,
    );
    assertEqual(
      acquired.risk.facts,
      change.acquisition.verifiedFeatureFacts,
      "Review risk feature facts",
      change.id,
    );
    assertEqual(
      acquired.risk.score,
      change.acquisition.verifiedScore,
      "Review risk score",
      change.id,
    );
    assertEqual(
      acquired.risk.classification,
      change.acquisition.verifiedClassification,
      "Review risk classification",
      change.id,
    );
    changes.push({
      id: change.id,
      repository: change.source.repository,
      baseRevision,
      changeRevision,
      snapshotId: acquired.snapshot.snapshotId,
      indexSha256: acquired.snapshot.indexSha256,
      discoverySha256: acquired.snapshot.discoverySha256,
      complete: true,
      score: acquired.risk.score,
      classification: acquired.risk.classification,
      incompleteReasons: [],
    });
  }
  return {
    schemaVersion: "change-review-calibration-materialization-report-v1",
    status: "verified_frozen_materialization",
    setId: calibration.setId,
    calibrationStatus: calibration.status,
    repositoriesResolved: repositoryRoots.size,
    sourcePinsVerified: calibration.changes.length,
    directParentsVerified: calibration.changes.length,
    commitMetadataVerified: calibration.changes.length,
    sourceDiffsVerified: calibration.changes.length,
    patchApplicationsVerified: calibration.changes.length,
    changeSnapshotsVerified: changes.length,
    riskFactsVerified: changes.length,
    riskResultsVerified: changes.length,
    changes,
    frozen: true,
  };
}
