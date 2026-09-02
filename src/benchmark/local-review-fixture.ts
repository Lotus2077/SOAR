import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { deriveVerifiedCalibrationSourceDiffV1, extractVerifiedReviewRiskV1 } from "../main/review-risk";
import { inspectGitChanges } from "../main/tools/inspect-git-changes";
import type { ChangeSnapshotV1 } from "../shared/change-review-contracts";
import {
  ChangeReviewCalibrationSetV1Schema,
  type ChangeReviewCalibrationChangeV1,
} from "../shared/review-risk-evaluation";

export const LOCAL_REVIEW_FIXTURE_ID = "cal-001-soar-plan-approval" as const;

const GIT_ENVIRONMENT: NodeJS.ProcessEnv = {
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

const GIT_CONFIG = [
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

interface GitOptions {
  input?: Buffer;
  encoding?: BufferEncoding;
}

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
    [...GIT_CONFIG, "-C", repositoryRoot, ...arguments_],
    {
      encoding: options.encoding,
      env: GIT_ENVIRONMENT,
      input: options.input,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}

function sha256(contents: Buffer | string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function requireEqual(
  actual: unknown,
  expected: unknown,
  label: string,
): void {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(`Frozen local-review fixture ${label} mismatch.`);
  }
}

function requireCommit(repositoryRoot: string, revision: string): void {
  const objectType = git(repositoryRoot, ["cat-file", "-t", revision], {
    encoding: "utf8",
  }).trim();
  const resolved = git(
    repositoryRoot,
    ["rev-parse", "--verify", `${revision}^{commit}`],
    { encoding: "utf8" },
  ).trim();
  if (objectType !== "commit" || resolved !== revision) {
    throw new Error("Frozen local-review fixture commit identity mismatch.");
  }
}

function loadFixture(projectRoot: string, fixtureId: string): {
  change: ChangeReviewCalibrationChangeV1;
  manifestSha256: string;
} {
  const manifestPath = path.join(
    projectRoot,
    "benchmarks",
    "change-review",
    "calibration-v1.json",
  );
  const protocolPath = path.join(
    projectRoot,
    "benchmarks",
    "change-review",
    "protocol-v1.json",
  );
  const manifestBytes = readFileSync(manifestPath);
  const calibration = ChangeReviewCalibrationSetV1Schema.parse(
    JSON.parse(manifestBytes.toString("utf8")),
  );
  const protocol = JSON.parse(readFileSync(protocolPath, "utf8")) as {
    calibration?: { manifestSha256?: unknown };
  };
  const manifestSha256 = sha256(manifestBytes);
  if (protocol.calibration?.manifestSha256 !== manifestSha256) {
    throw new Error("Frozen local-review fixture manifest hash mismatch.");
  }
  const change = calibration.changes.find(
    (candidate) => candidate.id === fixtureId,
  );
  if (!change) throw new Error("Frozen local-review fixture is missing.");
  return { change, manifestSha256 };
}

export interface MaterializedFrozenReviewFixtureV1<
  FixtureId extends string = string,
> {
  fixtureId: FixtureId;
  manifestSha256: string;
  workspaceRoot: string;
  snapshot: ChangeSnapshotV1;
  repository: string;
  baseRevision: string;
  changeRevision: string;
  subject: string;
  materialization: string;
  changedPathCount: number;
  changedLineCount: number;
  cleanup(): void;
}

export type MaterializedLocalReviewFixtureV1 =
  MaterializedFrozenReviewFixtureV1<typeof LOCAL_REVIEW_FIXTURE_ID>;

/**
 * Reproduces one frozen public change from explicit local Git objects. The
 * shared clone is local-only, copies every required base object into its own
 * object database, and has its remote and alternates removed before the patch
 * is applied. This function never clones from or fetches a URL.
 */
export async function materializeFrozenReviewFixtureV1<
  const FixtureId extends string,
>(options: {
  projectRoot: string;
  sourceRepository: string;
  fixtureId: FixtureId;
}): Promise<MaterializedFrozenReviewFixtureV1<FixtureId>> {
  const projectRoot = realpathSync(options.projectRoot);
  const sourceRepository = realpathSync(options.sourceRepository);
  const repositoryTopLevel = git(
    sourceRepository,
    ["rev-parse", "--show-toplevel"],
    { encoding: "utf8" },
  ).trim();
  if (realpathSync(repositoryTopLevel) !== sourceRepository) {
    throw new Error("The local-review source must be a Git repository root.");
  }

  const { change, manifestSha256 } = loadFixture(
    projectRoot,
    options.fixtureId,
  );
  const { baseRevision, changeRevision } = change.source;
  requireCommit(sourceRepository, baseRevision);
  requireCommit(sourceRepository, changeRevision);
  const parent = git(
    sourceRepository,
    ["rev-parse", `${changeRevision}^`],
    { encoding: "utf8" },
  ).trim();
  if (parent !== baseRevision) {
    throw new Error("Frozen local-review fixture direct-parent mismatch.");
  }
  const [committedAt, subject] = git(
    sourceRepository,
    ["show", "-s", "--format=%cI%x00%s", changeRevision],
    { encoding: "utf8" },
  )
    .trimEnd()
    .split("\0");
  if (
    committedAt !== change.source.committedAt ||
    subject !== change.source.subject
  ) {
    throw new Error("Frozen local-review fixture commit metadata mismatch.");
  }

  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "soar-local-review-evaluation-"),
  );
  const workspaceRoot = path.join(temporaryRoot, "repository");
  let keep = false;
  try {
    execFileSync(
      "/usr/bin/git",
      [
        ...GIT_CONFIG,
        "-c",
        "protocol.file.allow=always",
        "clone",
        "--quiet",
        "--shared",
        "--no-checkout",
        sourceRepository,
        workspaceRoot,
      ],
      {
        env: GIT_ENVIRONMENT,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    git(workspaceRoot, ["remote", "remove", "origin"]);
    git(workspaceRoot, ["checkout", "--quiet", "--detach", baseRevision]);
    const retainedRefs = git(
      workspaceRoot,
      ["for-each-ref", "--format=%(refname)"],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter((reference) => reference.length > 0);
    for (const reference of retainedRefs) {
      git(workspaceRoot, ["update-ref", "-d", reference]);
    }
    git(workspaceRoot, ["reflog", "expire", "--expire=now", "--all"]);
    // `--shared` makes otherwise-unadvertised local objects available for the
    // exact detached checkout. Repack while HEAD names the base, then remove
    // the alternate so the returned workspace cannot depend on the source.
    const baseObjectIds = git(
      workspaceRoot,
      ["ls-tree", "-r", "-t", "--full-tree", baseRevision],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const match = /^[0-7]{6} (?:blob|tree|commit) ([0-9a-f]{40,64})\t/u.exec(
          line,
        );
        if (match?.[1] === undefined) {
          throw new Error("Frozen local-review fixture object list is malformed.");
        }
        return match[1];
      });
    const baseTree = git(
      workspaceRoot,
      ["rev-parse", `${baseRevision}^{tree}`],
      { encoding: "utf8" },
    ).trim();
    git(
      workspaceRoot,
      [
        "pack-objects",
        path.join(workspaceRoot, ".git", "objects", "pack", "pack"),
      ],
      {
        input: Buffer.from(
          `${[baseRevision, baseTree, ...baseObjectIds].join("\n")}\n`,
        ),
      },
    );
    // The exact base is intentionally a shallow boundary: its tree is fully
    // present, while historical parents are neither needed nor retained.
    writeFileSync(
      path.join(workspaceRoot, ".git", "shallow"),
      `${baseRevision}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    const alternatesPath = path.join(
      workspaceRoot,
      ".git",
      "objects",
      "info",
      "alternates",
    );
    rmSync(alternatesPath, { force: true });
    if (existsSync(alternatesPath)) {
      throw new Error("Frozen local-review fixture retained Git alternates.");
    }
    if (
      git(workspaceRoot, ["remote"], { encoding: "utf8" }).trim() !== ""
    ) {
      throw new Error("Frozen local-review fixture retained a Git remote.");
    }
    requireCommit(workspaceRoot, baseRevision);
    git(workspaceRoot, ["fsck", "--connectivity-only", "--no-dangling"]);
    const patch = git(sourceRepository, [
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      "--no-textconv",
      "--find-renames",
      baseRevision,
      changeRevision,
    ]);
    if (patch.byteLength === 0) {
      throw new Error("Frozen local-review fixture patch is empty.");
    }
    git(workspaceRoot, ["apply", "--index", "--check", "-"], { input: patch });
    git(workspaceRoot, ["apply", "--index", "-"], { input: patch });
    const materializedTree = git(workspaceRoot, ["write-tree"], {
      encoding: "utf8",
    }).trim();
    const expectedTree = git(
      sourceRepository,
      ["rev-parse", `${changeRevision}^{tree}`],
      { encoding: "utf8" },
    ).trim();
    if (materializedTree !== expectedTree) {
      throw new Error("Frozen local-review fixture tree mismatch.");
    }

    const inspection = await inspectGitChanges({
      workspaceRoot,
      request: { schemaVersion: "inspect-git-changes-v1" },
    });
    const snapshot = inspection.snapshot;
    const risk = extractVerifiedReviewRiskV1(snapshot);
    requireEqual(
      deriveVerifiedCalibrationSourceDiffV1(snapshot),
      change.acquisition.sourceDiff,
      "source diff",
    );
    requireEqual(snapshot.snapshotId, change.acquisition.snapshotId, "snapshot identity");
    requireEqual(snapshot.indexSha256, change.acquisition.indexSha256, "index identity");
    requireEqual(
      snapshot.discoverySha256,
      change.acquisition.discoverySha256,
      "discovery identity",
    );
    requireEqual(risk.facts, change.acquisition.verifiedFeatureFacts, "risk facts");
    requireEqual(risk.score, change.acquisition.verifiedScore, "risk score");
    requireEqual(
      risk.classification,
      change.acquisition.verifiedClassification,
      "risk classification",
    );
    if (
      !risk.complete ||
      snapshot.manifest.length === 0 ||
      snapshot.omittedPathCount !== 0 ||
      snapshot.omittedHunkCount !== 0 ||
      snapshot.manifestOmissionCodes.length !== 0
    ) {
      throw new Error("Frozen local-review fixture acquisition is incomplete.");
    }

    keep = true;
    return {
      fixtureId: options.fixtureId,
      manifestSha256,
      workspaceRoot,
      snapshot,
      repository: change.source.repository,
      baseRevision,
      changeRevision,
      subject: change.source.subject,
      materialization: change.materialization.protocol,
      changedPathCount: change.acquisition.verifiedFeatureFacts.changedPathCount,
      changedLineCount: change.acquisition.verifiedFeatureFacts.changedLineCount,
      cleanup: () => rmSync(temporaryRoot, { recursive: true, force: true }),
    };
  } finally {
    if (!keep) rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

/** Existing cal-001 compatibility wrapper used by the local evaluation bridge. */
export async function materializeLocalReviewFixtureV1(options: {
  projectRoot: string;
  sourceRepository: string;
}): Promise<MaterializedLocalReviewFixtureV1> {
  return materializeFrozenReviewFixtureV1({
    ...options,
    fixtureId: LOCAL_REVIEW_FIXTURE_ID,
  });
}
