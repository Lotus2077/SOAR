import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  deriveVerifiedCalibrationSourceDiffV1,
  extractVerifiedReviewRiskV1,
} from "../../src/main/review-risk";
import {
  GitProcessRunner,
  type GitDiscoveryViews,
} from "../../src/main/tools/git-process";
import {
  inspectGitChanges,
  MAX_INSPECT_CHANGED_PATHS,
  MAX_INSPECT_RESULT_BYTES,
  verifyChangeSnapshot,
} from "../../src/main/tools/inspect-git-changes";
import { MAX_CHANGE_SOURCE_BYTES_PER_SIDE } from "../../src/main/tools/change-content-reader";
import {
  deriveCalibrationRiskFactsV1,
} from "../../src/shared/review-risk-evaluation";
import { scoreCompleteReviewRiskFactsV1 } from "../../src/shared/review-risk";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("/usr/bin/git", args, {
    cwd,
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
    maxBuffer: 8 * 1024 * 1024,
  });
  return result.stdout;
}

async function makeDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), `soar-inspect-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}

async function makeRepository(label = "repo"): Promise<string> {
  const repository = await makeDirectory(label);
  await git(repository, "init", "--quiet");
  await git(repository, "config", "user.name", "SOAR Test");
  await git(repository, "config", "user.email", "soar@example.invalid");
  await writeFile(path.join(repository, ".gitignore"), "ignored.txt\n");
  await writeFile(path.join(repository, "modified.txt"), "base\n");
  await git(repository, "add", ".");
  await git(repository, "commit", "--quiet", "-m", "base");
  return repository;
}

async function statusBytes(repository: string): Promise<Buffer> {
  const result = await execFileAsync(
    "/usr/bin/git",
    ["status", "--porcelain=v2", "-z", "--untracked-files=all"],
    { cwd: repository, encoding: "buffer", maxBuffer: 8 * 1024 * 1024 },
  );
  return result.stdout;
}

function nul(...records: Array<string | Uint8Array>): Buffer {
  return Buffer.concat(
    records.flatMap((record) => [Buffer.from(record), Buffer.from([0])]),
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("inspect_git_changes host acquisition", () => {
  it("returns a deterministic empty snapshot for a clean committed repository", async () => {
    const repository = await makeRepository("clean");
    const request = { schemaVersion: "inspect-git-changes-v1" } as const;
    const before = await statusBytes(repository);
    const first = await inspectGitChanges({ workspaceRoot: repository, request });
    const second = await inspectGitChanges({ workspaceRoot: repository, request });

    expect(first).toEqual(second);
    expect(first.snapshot.manifest).toEqual([]);
    expect(first.snapshot.omittedPathCount).toBe(0);
    expect(first.evidenceMap).toEqual([]);
    expect(await statusBytes(repository)).toEqual(before);
    await expect(
      verifyChangeSnapshot({ workspaceRoot: repository, snapshot: first.snapshot }),
    ).resolves.toBe(true);
  });

  it("counts an unsafe two-sided rename as one omitted changed path", async () => {
    const repository = await makeRepository("unsafe-rename-count");
    const oidA = "a".repeat(40);
    const oidB = "b".repeat(40);
    const invalidOldPath = Buffer.concat([
      Buffer.from("src/old-"),
      Buffer.from([0xff]),
    ]);
    const invalidNewPath = Buffer.concat([
      Buffer.from("src/new-"),
      Buffer.from([0xfe]),
    ]);
    const unsafeStatus = nul(
      Buffer.concat([
        Buffer.from(
          `2 R. N... 100644 100644 100644 ${oidA} ${oidB} R100 `,
        ),
        invalidNewPath,
      ]),
      invalidOldPath,
    );
    const unsafeRaw = nul(
      `:100644 100644 ${oidA} ${oidB} R100`,
      invalidOldPath,
      invalidNewPath,
    );
    const unsafeNumstat = nul("0\t0\t", invalidOldPath, invalidNewPath);

    class UnsafeRenameRunner extends GitProcessRunner {
      override async readDiscoveryViews(
        baseCommitOid: string,
        signal?: AbortSignal,
      ): Promise<GitDiscoveryViews> {
        const actual = await super.readDiscoveryViews(baseCommitOid, signal);
        return {
          ...actual,
          statusBytes: unsafeStatus,
          rawBytes: unsafeRaw,
          numstatBytes: unsafeNumstat,
        };
      }
    }

    const result = await inspectGitChanges(
      {
        workspaceRoot: repository,
        request: { schemaVersion: "inspect-git-changes-v1" },
      },
      { createRunner: (cwd) => new UnsafeRenameRunner({ cwd }) },
    );

    expect(result.snapshot.manifest).toEqual([]);
    expect(result.snapshot.omittedPathCount).toBe(1);
    expect(result.snapshot.manifestOmissionCodes).toEqual(["unsafe_path"]);
    await expect(
      verifyChangeSnapshot({ workspaceRoot: repository, snapshot: result.snapshot }),
    ).resolves.toBe(false);

    class MismatchedUnsafeCountRunner extends UnsafeRenameRunner {
      override async readDiscoveryViews(
        baseCommitOid: string,
        signal?: AbortSignal,
      ): Promise<GitDiscoveryViews> {
        const actual = await super.readDiscoveryViews(baseCommitOid, signal);
        return {
          ...actual,
          rawBytes: unsafeRaw,
          numstatBytes: Buffer.concat([unsafeNumstat, unsafeNumstat]),
        };
      }
    }
    await expect(
      inspectGitChanges(
        {
          workspaceRoot: repository,
          request: { schemaVersion: "inspect-git-changes-v1" },
        },
        { createRunner: (cwd) => new MismatchedUnsafeCountRunner({ cwd }) },
      ),
    ).rejects.toMatchObject({
      code: "INVALID_REPOSITORY_STATE",
      message:
        "Git status, raw, and numstat views disagreed on unsafe tracked changes.",
    });
  });

  it("rejects an ordinary numstat identity substituted for a raw rename", async () => {
    const repository = await makeRepository("numstat-rename-mismatch");
    const oidA = "a".repeat(40);
    const oidB = "b".repeat(40);
    const statusBytes = nul(
      `2 R. N... 100644 100644 100644 ${oidA} ${oidB} R100 new.ts`,
      "old.ts",
    );
    const rawBytes = nul(
      `:100644 100644 ${oidA} ${oidB} R100`,
      "old.ts",
      "new.ts",
    );
    const numstatBytes = nul("0\t0\tnew.ts");

    class MismatchedRenameRunner extends GitProcessRunner {
      override async readDiscoveryViews(
        baseCommitOid: string,
        signal?: AbortSignal,
      ): Promise<GitDiscoveryViews> {
        const actual = await super.readDiscoveryViews(baseCommitOid, signal);
        return { ...actual, statusBytes, rawBytes, numstatBytes };
      }
    }

    await expect(
      inspectGitChanges(
        {
          workspaceRoot: repository,
          request: { schemaVersion: "inspect-git-changes-v1" },
        },
        { createRunner: (cwd) => new MismatchedRenameRunner({ cwd }) },
      ),
    ).rejects.toMatchObject({
      code: "INVALID_REPOSITORY_STATE",
      message: "Git raw and numstat views did not describe the same changes.",
    });
  });

  it.each(["raw", "numstat"] as const)(
    "rejects duplicate normalized %s identities",
    async (duplicateView) => {
      const repository = await makeRepository(`duplicate-${duplicateView}`);
      const oidA = "a".repeat(40);
      const rawRecord = nul(
        `:100644 100644 ${oidA} ${"0".repeat(40)} M`,
        "modified.txt",
      );
      const normalizedDuplicateRaw = nul(
        `:000000 100644 ${"0".repeat(40)} ${oidA} A`,
        "modified.txt",
        `:100644 000000 ${oidA} ${"0".repeat(40)} D`,
        "modified.txt",
      );
      const numstatRecord = nul("1\t1\tmodified.txt");
      const statusBytes = nul(
        `1 .M N... 100644 100644 100644 ${oidA} ${oidA} modified.txt`,
      );
      const rawBytes =
        duplicateView === "raw" ? normalizedDuplicateRaw : rawRecord;
      const numstatBytes =
        duplicateView === "numstat"
          ? Buffer.concat([numstatRecord, numstatRecord])
          : numstatRecord;

      class DuplicateViewRunner extends GitProcessRunner {
        override async readDiscoveryViews(
          baseCommitOid: string,
          signal?: AbortSignal,
        ): Promise<GitDiscoveryViews> {
          const actual = await super.readDiscoveryViews(baseCommitOid, signal);
          return { ...actual, statusBytes, rawBytes, numstatBytes };
        }
      }

      await expect(
        inspectGitChanges(
          {
            workspaceRoot: repository,
            request: { schemaVersion: "inspect-git-changes-v1" },
          },
          { createRunner: (cwd) => new DuplicateViewRunner({ cwd }) },
        ),
      ).rejects.toMatchObject({
        code: "INVALID_REPOSITORY_STATE",
        message: `Git ${duplicateView} contained duplicate normalized change identities.`,
      });
    },
  );

  it("keeps a literal <none> path distinct from a null path component", async () => {
    const repository = await makeRepository("nullable-path-key");
    const oidA = "a".repeat(40);
    const oidB = "b".repeat(40);
    const zero = "0".repeat(40);
    const statusBytes = nul(
      `1 A. N... 000000 100644 100644 ${zero} ${oidA} x`,
    );
    const rawBytes = nul(
      `:000000 100644 ${zero} ${oidA} A`,
      "x",
      `:100644 100644 ${oidA} ${oidB} R100`,
      "<none>",
      "x",
    );
    const numstatBytes = nul("1\t0\tx", "0\t0\t", "<none>", "x");

    class NullablePathRunner extends GitProcessRunner {
      override async readDiscoveryViews(
        baseCommitOid: string,
        signal?: AbortSignal,
      ): Promise<GitDiscoveryViews> {
        const actual = await super.readDiscoveryViews(baseCommitOid, signal);
        return { ...actual, statusBytes, rawBytes, numstatBytes };
      }
    }

    await expect(
      inspectGitChanges(
        {
          workspaceRoot: repository,
          request: { schemaVersion: "inspect-git-changes-v1" },
        },
        { createRunner: (cwd) => new NullablePathRunner({ cwd }) },
      ),
    ).rejects.toMatchObject({
      code: "INVALID_REPOSITORY_STATE",
      message: "Git raw diff contained a change absent from status.",
    });
  });

  it.each([
    ["assume-unchanged", "--assume-unchanged"],
    ["skip-worktree", "--skip-worktree"],
  ])("rejects a tracked change hidden by %s", async (_label, flag) => {
    const repository = await makeRepository("hidden-index-state");
    await git(repository, "update-index", flag, "modified.txt");
    await writeFile(path.join(repository, "modified.txt"), "hidden working change\n");

    expect(await statusBytes(repository)).toEqual(Buffer.alloc(0));
    await expect(
      inspectGitChanges({
        workspaceRoot: repository,
        request: { schemaVersion: "inspect-git-changes-v1" },
      }),
    ).rejects.toMatchObject({
      code: "INVALID_REPOSITORY_STATE",
      message: "Git index visibility flags prevent complete change inspection.",
    });
  });

  it(
    "detects an executable-bit change even when repository config disables file-mode checks",
    async () => {
      const repository = await makeRepository("file-mode-visibility");
      await git(repository, "config", "core.fileMode", "false");
      await chmod(path.join(repository, "modified.txt"), 0o755);

      expect(await statusBytes(repository)).toEqual(Buffer.alloc(0));
      const result = await inspectGitChanges({
        workspaceRoot: repository,
        request: { schemaVersion: "inspect-git-changes-v1" },
      });

      expect(result.snapshot.manifest).toEqual([
        expect.objectContaining({
          oldPath: "modified.txt",
          newPath: "modified.txt",
          changeKind: "type_changed",
          staged: false,
          unstaged: true,
          base: expect.objectContaining({ mode: "100644" }),
          working: expect.objectContaining({ mode: "100755" }),
          omissionCodes: [],
        }),
      ]);
      expect(result.snapshot.manifestOmissionCodes).toEqual([]);
      await expect(
        verifyChangeSnapshot({ workspaceRoot: repository, snapshot: result.snapshot }),
      ).resolves.toBe(true);
    },
  );

  it.each([
    ["0645", 0o645],
    ["0654", 0o654],
  ])(
    "does not project non-owner execute mode %s as Git executable",
    async (_label, fileMode) => {
      const repository = await makeRepository("non-owner-execute");
      const trackedPath = path.join(repository, "modified.txt");
      await writeFile(trackedPath, "working change\n");
      await chmod(trackedPath, fileMode);

      const result = await inspectGitChanges({
        workspaceRoot: repository,
        request: { schemaVersion: "inspect-git-changes-v1" },
      });

      expect(result.snapshot.manifest).toEqual([
        expect.objectContaining({
          oldPath: "modified.txt",
          newPath: "modified.txt",
          changeKind: "modified",
          base: expect.objectContaining({ mode: "100644" }),
          working: expect.objectContaining({ mode: "100644" }),
        }),
      ]);
      await expect(
        verifyChangeSnapshot({ workspaceRoot: repository, snapshot: result.snapshot }),
      ).resolves.toBe(true);
    },
  );

  it("pins rename semantics against local copy detection and low rename limits", async () => {
    const repository = await makeRepository("rename-config-override");
    const stableLines = Array.from(
      { length: 20 },
      (_, index) => `stable-line-${String(index).padStart(2, "0")}\n`,
    );
    for (let index = 0; index < 4; index += 1) {
      await writeFile(
        path.join(repository, `old-${index}.txt`),
        stableLines.join(""),
      );
    }
    await git(repository, "add", ".");
    await git(repository, "commit", "--quiet", "-m", "rename bases");
    for (let index = 0; index < 4; index += 1) {
      const newPath = path.join(repository, `new-${index}.txt`);
      await rename(path.join(repository, `old-${index}.txt`), newPath);
      await writeFile(
        newPath,
        stableLines
          .map((line, lineIndex) =>
            lineIndex < 5 ? `changed-line-${String(lineIndex).padStart(2, "0")}\n` : line,
          )
          .join(""),
      );
    }
    await git(repository, "add", "-A");

    const request = { schemaVersion: "inspect-git-changes-v1" } as const;
    const neutral = await inspectGitChanges({ workspaceRoot: repository, request });
    expect(neutral.snapshot.manifest).toHaveLength(4);
    expect(
      neutral.snapshot.manifest.every((entry) => entry.changeKind === "renamed"),
    ).toBe(true);

    await git(repository, "config", "status.renames", "copies");
    await git(repository, "config", "status.renameLimit", "1");
    await git(repository, "config", "diff.renames", "copies");
    await git(repository, "config", "diff.renameLimit", "1");
    const hostile = await inspectGitChanges({ workspaceRoot: repository, request });

    expect(hostile).toEqual(neutral);
  });

  it("covers staged, unstaged, rename, delete, untracked, binary, symlink, and ignored state", async () => {
    const repository = await makeRepository("states");
    await writeFile(path.join(repository, "staged.txt"), "base staged\n");
    await writeFile(path.join(repository, "deleted.txt"), "remove me\n");
    await writeFile(path.join(repository, "rename.txt"), "rename me\n");
    await writeFile(path.join(repository, "binary.bin"), Buffer.from([0, 1, 2]));
    await symlink("modified.txt", path.join(repository, "link"));
    await git(repository, "add", ".");
    await git(repository, "commit", "--quiet", "-m", "fixtures");

    await writeFile(path.join(repository, "modified.txt"), "working change\n");
    await writeFile(path.join(repository, "staged.txt"), "staged change\n");
    await git(repository, "add", "staged.txt");
    await rm(path.join(repository, "deleted.txt"));
    await git(repository, "mv", "rename.txt", "renamed.txt");
    await writeFile(path.join(repository, "new.txt"), "untracked\n");
    await writeFile(path.join(repository, "ignored.txt"), "must not appear\n");
    await writeFile(path.join(repository, "binary.bin"), Buffer.from([0, 9, 2]));
    await unlink(path.join(repository, "link"));
    await symlink("new.txt", path.join(repository, "link"));

    const before = await statusBytes(repository);
    const result = await inspectGitChanges({
      workspaceRoot: repository,
      request: { schemaVersion: "inspect-git-changes-v1" },
    });
    const byPath = new Map(
      result.snapshot.manifest.map((entry) => [entry.newPath ?? entry.oldPath, entry]),
    );

    expect(byPath.get("modified.txt")).toMatchObject({
      changeKind: "modified",
      staged: false,
      unstaged: true,
      omissionCodes: [],
    });
    expect(byPath.get("staged.txt")).toMatchObject({
      changeKind: "modified",
      staged: true,
      unstaged: false,
    });
    expect(byPath.get("deleted.txt")).toMatchObject({
      changeKind: "deleted",
      newPath: null,
    });
    expect(byPath.get("renamed.txt")).toMatchObject({
      changeKind: "renamed",
      oldPath: "rename.txt",
    });
    expect(byPath.get("new.txt")).toMatchObject({ changeKind: "untracked" });
    expect(byPath.get("binary.bin")?.omissionCodes).toContain("binary");
    expect(byPath.get("link")?.omissionCodes).toContain("symlink");
    expect(byPath.has("ignored.txt")).toBe(false);
    expect(result.snapshot.manifestOmissionCodes).toEqual(
      expect.arrayContaining(["binary", "symlink"]),
    );
    expect(result.evidenceMap.length).toBeGreaterThan(0);
    expect(await statusBytes(repository)).toEqual(before);
  });

  it("fails closed for a non-root selection, unborn repository, and unmerged index", async () => {
    const repository = await makeRepository("invalid-state");
    const baseBranch = (await git(repository, "branch", "--show-current")).trim();
    await mkdir(path.join(repository, "nested"));
    await expect(
      inspectGitChanges({
        workspaceRoot: path.join(repository, "nested"),
        request: { schemaVersion: "inspect-git-changes-v1" },
      }),
    ).rejects.toMatchObject({ code: "WORKSPACE_MISMATCH" });

    const unborn = await makeDirectory("unborn");
    await git(unborn, "init", "--quiet");
    await expect(
      inspectGitChanges({
        workspaceRoot: unborn,
        request: { schemaVersion: "inspect-git-changes-v1" },
      }),
    ).rejects.toMatchObject({ code: "EMPTY_OR_UNBORN_REPOSITORY" });

    await git(repository, "checkout", "-b", "conflict", "--quiet");
    await writeFile(path.join(repository, "modified.txt"), "branch\n");
    await git(repository, "commit", "-am", "branch", "--quiet");
    await git(repository, "checkout", baseBranch, "--quiet");
    await writeFile(path.join(repository, "modified.txt"), "main\n");
    await git(repository, "commit", "-am", "main", "--quiet");
    await expect(git(repository, "merge", "conflict", "--no-edit")).rejects.toBeDefined();
    await expect(
      inspectGitChanges({
        workspaceRoot: repository,
        request: { schemaVersion: "inspect-git-changes-v1" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_REPOSITORY_STATE" });
  });

  it("marks oversize content and bounds the number of represented paths", async () => {
    const repository = await makeRepository("bounds");
    await writeFile(
      path.join(repository, "large.txt"),
      Buffer.alloc(MAX_CHANGE_SOURCE_BYTES_PER_SIDE + 1, 0x61),
    );
    for (let index = 0; index < MAX_INSPECT_CHANGED_PATHS + 3; index += 1) {
      await writeFile(path.join(repository, `new-${String(index).padStart(3, "0")}.txt`), "x\n");
    }
    const result = await inspectGitChanges({
      workspaceRoot: repository,
      request: { schemaVersion: "inspect-git-changes-v1" },
    });
    expect(result.snapshot.manifest).toHaveLength(MAX_INSPECT_CHANGED_PATHS);
    expect(result.snapshot.omittedPathCount).toBe(4);
    expect(result.snapshot.manifestOmissionCodes).toEqual(
      expect.arrayContaining(["file_count_limit", "oversized"]),
    );
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(
      MAX_INSPECT_RESULT_BYTES,
    );
  });

  it("evicts trailing long-path entries instead of failing the result byte bound", async () => {
    const repository = await makeRepository("long-path-result-bound");
    const longDirectory = path.join(
      repository,
      "a".repeat(230),
      "b".repeat(230),
      "c".repeat(230),
      "d".repeat(80),
    );
    await mkdir(longDirectory, { recursive: true });
    for (let index = 0; index < MAX_INSPECT_CHANGED_PATHS; index += 1) {
      await writeFile(
        path.join(longDirectory, `new-${String(index).padStart(3, "0")}.txt`),
        "x\n",
      );
    }

    const request = { schemaVersion: "inspect-git-changes-v1" } as const;
    const first = await inspectGitChanges({ workspaceRoot: repository, request });
    const second = await inspectGitChanges({ workspaceRoot: repository, request });

    expect(first).toEqual(second);
    expect(first.snapshot.manifest.length).toBeGreaterThan(0);
    expect(first.snapshot.manifest.length).toBeLessThan(MAX_INSPECT_CHANGED_PATHS);
    expect(first.snapshot.omittedPathCount).toBe(
      MAX_INSPECT_CHANGED_PATHS - first.snapshot.manifest.length,
    );
    expect(first.snapshot.manifestOmissionCodes).toContain("file_count_limit");
    expect(first.snapshot.manifest[0]?.newPath).toMatch(/new-000\.txt$/u);
    expect(Buffer.byteLength(JSON.stringify(first), "utf8")).toBeLessThanOrEqual(
      MAX_INSPECT_RESULT_BYTES,
    );
    await expect(
      verifyChangeSnapshot({ workspaceRoot: repository, snapshot: first.snapshot }),
    ).resolves.toBe(false);
  });

  it("uses the same admitted-hunk line facts for live and frozen CR-only risk", async () => {
    const repository = await makeRepository("cr-only-risk-parity");
    const sourceDirectory = path.join(repository, "src", "main");
    await mkdir(sourceDirectory, { recursive: true });
    const oldContent = Array.from({ length: 50 }, () => "a").join("\r");
    const newContent = Array.from({ length: 50 }, () => "b").join("\r");
    for (const name of ["a.ts", "b.ts", "c.ts"]) {
      await writeFile(path.join(sourceDirectory, name), oldContent);
    }
    await git(repository, "add", "src/main");
    await git(repository, "commit", "--quiet", "-m", "CR-only base");
    for (const name of ["a.ts", "b.ts", "c.ts"]) {
      await writeFile(path.join(sourceDirectory, name), newContent);
    }

    const gitNumstatLines = (await git(repository, "diff", "--numstat", "HEAD", "--"))
      .trim()
      .split("\n")
      .reduce((total, record) => {
        const [additions = "", deletions = ""] = record.split("\t");
        return total + Number(additions) + Number(deletions);
      }, 0);
    expect(gitNumstatLines).toBe(6);

    const inspection = await inspectGitChanges({
      workspaceRoot: repository,
      request: { schemaVersion: "inspect-git-changes-v1" },
    });
    const liveRisk = extractVerifiedReviewRiskV1(inspection.snapshot);
    const sourceDiff = deriveVerifiedCalibrationSourceDiffV1(
      inspection.snapshot,
    );
    const frozenFacts = deriveCalibrationRiskFactsV1(sourceDiff);
    const frozenScore = scoreCompleteReviewRiskFactsV1(frozenFacts);

    expect(sourceDiff).toEqual(
      ["a.ts", "b.ts", "c.ts"].map((name) => ({
        oldPath: `src/main/${name}`,
        newPath: `src/main/${name}`,
        changeKind: "modified",
        additions: 50,
        deletions: 50,
      })),
    );
    expect(liveRisk.complete).toBe(true);
    expect(liveRisk.facts.changedLineCount).toBe(300);
    expect(frozenFacts).toEqual(liveRisk.facts);
    expect(frozenScore.score).toBe(liveRisk.score);
    expect(frozenScore.classification).toBe(liveRisk.classification);
    expect(liveRisk).toMatchObject({ score: 3, classification: "high_risk" });
  });

  it("binds omitted path identities into snapshot revalidation", async () => {
    const repository = await makeRepository("omitted-identity");
    for (let index = 0; index < MAX_INSPECT_CHANGED_PATHS + 1; index += 1) {
      await writeFile(
        path.join(repository, `new-${String(index).padStart(3, "0")}.txt`),
        "x\n",
      );
    }
    const first = await inspectGitChanges({
      workspaceRoot: repository,
      request: { schemaVersion: "inspect-git-changes-v1" },
    });
    expect(first.snapshot.omittedPathCount).toBe(1);

    await unlink(path.join(repository, "new-200.txt"));
    await writeFile(path.join(repository, "new-201.txt"), "x\n");
    const second = await inspectGitChanges({
      workspaceRoot: repository,
      request: { schemaVersion: "inspect-git-changes-v1" },
    });

    expect(second.snapshot.manifest).toEqual(first.snapshot.manifest);
    expect(second.snapshot.omittedPathCount).toBe(first.snapshot.omittedPathCount);
    expect(second.snapshot.discoverySha256).not.toBe(first.snapshot.discoverySha256);
    expect(second.snapshot.snapshotId).not.toBe(first.snapshot.snapshotId);
    await expect(
      verifyChangeSnapshot({ workspaceRoot: repository, snapshot: first.snapshot }),
    ).resolves.toBe(false);
  });

  it("marks repositories with gitlinks incomplete instead of hiding dirty submodules", async () => {
    const repository = await makeRepository("submodule");
    const nested = path.join(repository, "vendor", "dependency");
    await mkdir(nested, { recursive: true });
    await git(nested, "init", "--quiet");
    await git(nested, "config", "user.name", "SOAR Test");
    await git(nested, "config", "user.email", "soar@example.invalid");
    await writeFile(path.join(nested, "dependency.txt"), "base\n");
    await git(nested, "add", ".");
    await git(nested, "commit", "--quiet", "-m", "nested base");
    const nestedCommit = (await git(nested, "rev-parse", "HEAD")).trim();
    await git(
      repository,
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${nestedCommit},vendor/dependency`,
    );
    await git(repository, "commit", "--quiet", "-m", "add gitlink");
    await writeFile(path.join(nested, "dependency.txt"), "dirty\n");

    const result = await inspectGitChanges({
      workspaceRoot: repository,
      request: { schemaVersion: "inspect-git-changes-v1" },
    });
    expect(result.snapshot.manifestOmissionCodes).toContain("submodule");
  });

  it("detects repository drift between acquisition phases", async () => {
    const repository = await makeRepository("drift");
    await writeFile(path.join(repository, "modified.txt"), "first change\n");

    class DriftingRunner extends GitProcessRunner {
      private discoveryReads = 0;

      override async readDiscoveryViews(
        baseCommitOid: string,
        signal?: AbortSignal,
      ): Promise<GitDiscoveryViews> {
        this.discoveryReads += 1;
        if (this.discoveryReads === 2) {
          await writeFile(path.join(repository, "modified.txt"), "second, larger change\n");
        }
        return super.readDiscoveryViews(baseCommitOid, signal);
      }
    }

    await expect(
      inspectGitChanges(
        {
          workspaceRoot: repository,
          request: { schemaVersion: "inspect-git-changes-v1" },
        },
        { createRunner: (cwd) => new DriftingRunner({ cwd }) },
      ),
    ).rejects.toMatchObject({ code: "WORKSPACE_DRIFT" });
  });

  it("binds exact index visibility bytes into acquisition drift detection", async () => {
    const repository = await makeRepository("visibility-drift");

    class VisibilityDriftingRunner extends GitProcessRunner {
      private visibilityReads = 0;

      override async readDiscoveryViews(
        baseCommitOid: string,
        signal?: AbortSignal,
      ): Promise<GitDiscoveryViews> {
        const output = await super.readDiscoveryViews(baseCommitOid, signal);
        this.visibilityReads += 1;
        if (this.visibilityReads !== 2) return output;
        const records = output.indexVisibilityBytes
          .toString("latin1")
          .split("\0")
          .filter(Boolean)
          .reverse();
        return {
          ...output,
          indexVisibilityBytes: Buffer.from(`${records.join("\0")}\0`, "latin1"),
        };
      }
    }

    await expect(
      inspectGitChanges(
        {
          workspaceRoot: repository,
          request: { schemaVersion: "inspect-git-changes-v1" },
        },
        { createRunner: (cwd) => new VisibilityDriftingRunner({ cwd }) },
      ),
    ).rejects.toMatchObject({ code: "WORKSPACE_DRIFT" });
  });

  it("marks simultaneous staged and unstaged edits incomplete", async () => {
    const repository = await makeRepository("three-state");
    await writeFile(path.join(repository, "modified.txt"), "a=0\nb=0\n");
    await git(repository, "add", "modified.txt");
    await git(repository, "commit", "--quiet", "-m", "three-state base");

    await writeFile(path.join(repository, "modified.txt"), "a=1\nb=0\n");
    await git(repository, "add", "modified.txt");
    await writeFile(path.join(repository, "modified.txt"), "a=0\nb=1\n");

    const result = await inspectGitChanges({
      workspaceRoot: repository,
      request: { schemaVersion: "inspect-git-changes-v1" },
    });
    expect(result.snapshot.manifest[0]).toMatchObject({
      staged: true,
      unstaged: true,
      omissionCodes: ["staged_unstaged_overlap"],
    });
    expect(result.snapshot.manifestOmissionCodes).toContain(
      "staged_unstaged_overlap",
    );
    await expect(
      verifyChangeSnapshot({ workspaceRoot: repository, snapshot: result.snapshot }),
    ).resolves.toBe(false);
  });

  it("represents an exact staged-to-unstaged reversal as incomplete", async () => {
    const repository = await makeRepository("exact-three-state-reversal");
    await writeFile(path.join(repository, "modified.txt"), "staged change\n");
    await git(repository, "add", "modified.txt");
    await writeFile(path.join(repository, "modified.txt"), "base\n");

    expect(await git(repository, "diff", "--raw", "HEAD", "--")).toBe("");
    const result = await inspectGitChanges({
      workspaceRoot: repository,
      request: { schemaVersion: "inspect-git-changes-v1" },
    });
    const entry = result.snapshot.manifest[0];

    expect(entry).toMatchObject({
      changeKind: "modified",
      oldPath: "modified.txt",
      newPath: "modified.txt",
      staged: true,
      unstaged: true,
      omissionCodes: ["staged_unstaged_overlap"],
      hunks: [],
    });
    expect(entry?.base).toEqual(entry?.working);
    expect(entry?.base?.admittedContentSha256).not.toBeNull();
    expect(result.snapshot.manifestOmissionCodes).toContain(
      "staged_unstaged_overlap",
    );
    await expect(
      verifyChangeSnapshot({ workspaceRoot: repository, snapshot: result.snapshot }),
    ).resolves.toBe(false);
  });

  it("represents a staged add deleted from the worktree as one incomplete path", async () => {
    const repository = await makeRepository("add-delete-overlap");
    const addedPath = path.join(repository, "transient.txt");
    await writeFile(addedPath, "staged only\n");
    await git(repository, "add", "transient.txt");
    await unlink(addedPath);

    const result = await inspectGitChanges({
      workspaceRoot: repository,
      request: { schemaVersion: "inspect-git-changes-v1" },
    });
    expect(result.snapshot.manifest).toEqual([
      expect.objectContaining({
        changeKind: "added",
        oldPath: null,
        newPath: "transient.txt",
        staged: true,
        unstaged: true,
        base: null,
        working: null,
        omissionCodes: ["staged_unstaged_overlap"],
        hunks: [],
      }),
    ]);
    expect(result.snapshot.manifestOmissionCodes).toContain(
      "staged_unstaged_overlap",
    );
    await expect(
      verifyChangeSnapshot({ workspaceRoot: repository, snapshot: result.snapshot }),
    ).resolves.toBe(false);
  });

  it("coalesces a staged deletion and same-path recreation into one incomplete path", async () => {
    const repository = await makeRepository("delete-recreate-overlap");
    await git(repository, "rm", "--quiet", "modified.txt");
    await writeFile(path.join(repository, "modified.txt"), "recreated content\n");

    const result = await inspectGitChanges({
      workspaceRoot: repository,
      request: { schemaVersion: "inspect-git-changes-v1" },
    });
    expect(result.snapshot.manifest).toHaveLength(1);
    expect(result.snapshot.manifest[0]).toMatchObject({
      changeKind: "modified",
      oldPath: "modified.txt",
      newPath: "modified.txt",
      staged: true,
      unstaged: true,
      omissionCodes: ["staged_unstaged_overlap"],
    });
    expect(result.snapshot.manifest[0]?.hunks.length).toBeGreaterThan(0);
  });

  it("normalizes a staged rename whose worktree destination is deleted", async () => {
    const repository = await makeRepository("rename-delete-overlap");
    await git(repository, "mv", "modified.txt", "renamed.txt");
    await unlink(path.join(repository, "renamed.txt"));

    const result = await inspectGitChanges({
      workspaceRoot: repository,
      request: { schemaVersion: "inspect-git-changes-v1" },
    });
    expect(result.snapshot.manifest).toEqual([
      expect.objectContaining({
        changeKind: "deleted",
        oldPath: "modified.txt",
        newPath: null,
        staged: true,
        unstaged: true,
        working: null,
        omissionCodes: ["staged_unstaged_overlap"],
      }),
    ]);
  });

  it("coalesces a staged rename moved back in the worktree into one incomplete path", async () => {
    const repository = await makeRepository("rename-back-overlap");
    await git(repository, "mv", "modified.txt", "renamed.txt");
    await rename(
      path.join(repository, "renamed.txt"),
      path.join(repository, "modified.txt"),
    );

    const result = await inspectGitChanges({
      workspaceRoot: repository,
      request: { schemaVersion: "inspect-git-changes-v1" },
    });
    expect(result.snapshot.manifest).toHaveLength(1);
    expect(result.snapshot.manifest[0]).toMatchObject({
      changeKind: "modified",
      oldPath: "modified.txt",
      newPath: "modified.txt",
      staged: true,
      unstaged: true,
      omissionCodes: ["staged_unstaged_overlap"],
      hunks: [],
    });
    expect(result.snapshot.manifest[0]?.base).toEqual(
      result.snapshot.manifest[0]?.working,
    );
  });

  it("rejects a raw-less both-states path whose base and final content differ", async () => {
    const repository = await makeRepository("invalid-rawless-three-state");
    await writeFile(path.join(repository, "modified.txt"), "staged change\n");
    await git(repository, "add", "modified.txt");
    await writeFile(path.join(repository, "modified.txt"), "different final change\n");

    class RawlessRunner extends GitProcessRunner {
      override async readDiscoveryViews(
        baseCommitOid: string,
        signal?: AbortSignal,
      ): Promise<GitDiscoveryViews> {
        const actual = await super.readDiscoveryViews(baseCommitOid, signal);
        return {
          ...actual,
          rawBytes: Buffer.alloc(0),
          numstatBytes: Buffer.alloc(0),
        };
      }
    }

    await expect(
      inspectGitChanges(
        {
          workspaceRoot: repository,
          request: { schemaVersion: "inspect-git-changes-v1" },
        },
        { createRunner: (cwd) => new RawlessRunner({ cwd }) },
      ),
    ).rejects.toMatchObject({
      code: "INVALID_REPOSITORY_STATE",
      message:
        "A raw-less staged and unstaged path did not prove identical base and working content.",
    });
  });

  it("coalesces a staged rename split by a large unstaged rewrite", async () => {
    const repository = await makeRepository("renamed-three-state");
    const oldPath = path.join(repository, "rename-source.txt");
    const newPath = path.join(repository, "rename-target.txt");
    await writeFile(
      oldPath,
      Array.from({ length: 20 }, (_, index) => `original-${index}\n`).join(""),
    );
    await git(repository, "add", "rename-source.txt");
    await git(repository, "commit", "--quiet", "-m", "rename base");

    await git(repository, "mv", "rename-source.txt", "rename-target.txt");
    await writeFile(
      newPath,
      Array.from({ length: 20 }, (_, index) => `replacement-${index}\n`).join(""),
    );

    expect(await git(repository, "status", "--short", "--find-renames=50%"))
      .toBe("RM rename-source.txt -> rename-target.txt\n");
    expect(
      (await git(repository, "diff", "--name-status", "--find-renames=50%", "HEAD", "--"))
        .trim()
        .split("\n")
        .sort(),
    ).toEqual(["A\trename-target.txt", "D\trename-source.txt"]);

    const result = await inspectGitChanges({
      workspaceRoot: repository,
      request: { schemaVersion: "inspect-git-changes-v1" },
    });
    expect(result.snapshot.manifest).toHaveLength(1);
    expect(result.snapshot.manifest[0]).toMatchObject({
      changeKind: "renamed",
      oldPath: "rename-source.txt",
      newPath: "rename-target.txt",
      staged: true,
      unstaged: true,
      omissionCodes: ["staged_unstaged_overlap"],
    });
    expect(result.snapshot.manifest[0]?.hunks.length).toBeGreaterThan(0);
    expect(result.snapshot.manifestOmissionCodes).toContain(
      "staged_unstaged_overlap",
    );
    await expect(
      verifyChangeSnapshot({ workspaceRoot: repository, snapshot: result.snapshot }),
    ).resolves.toBe(false);
  });

  it("does not invoke hostile repository diff, pager, filter, or hook configuration", async () => {
    const repository = await makeRepository("hostile-config");
    const marker = path.join(repository, "marker");
    const hostile = path.join(repository, "hostile.sh");
    await writeFile(hostile, `#!/bin/sh\nprintf invoked >> '${marker}'\nexit 1\n`);
    await chmod(hostile, 0o755);
    await git(repository, "config", "diff.external", hostile);
    await git(repository, "config", "core.fsmonitor", hostile);
    await git(repository, "config", "pager.status", hostile);
    await git(repository, "config", "diff.hostile.command", hostile);
    await git(repository, "config", "diff.hostile.textconv", hostile);
    await writeFile(path.join(repository, ".gitattributes"), "*.txt diff=hostile\n");
    await writeFile(path.join(repository, "modified.txt"), "changed\n");

    await inspectGitChanges({
      workspaceRoot: repository,
      request: { schemaVersion: "inspect-git-changes-v1" },
    });
    await expect(lstat(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("honors pre-cancellation and strict request fields", async () => {
    const repository = await makeRepository("cancel");
    const controller = new AbortController();
    controller.abort();
    await expect(
      inspectGitChanges({
        workspaceRoot: repository,
        request: { schemaVersion: "inspect-git-changes-v1" },
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(
      inspectGitChanges({
        workspaceRoot: repository,
        request: { schemaVersion: "inspect-git-changes-v1", arbitraryRevision: "HEAD~1" },
      }),
    ).rejects.toBeDefined();
  });

  it("marks a snapshot stale after a subsequent working change", async () => {
    const repository = await makeRepository("revalidate");
    await writeFile(path.join(repository, "modified.txt"), "first\n");
    const result = await inspectGitChanges({
      workspaceRoot: repository,
      request: { schemaVersion: "inspect-git-changes-v1" },
    });
    await writeFile(path.join(repository, "modified.txt"), "second\n");
    await expect(
      verifyChangeSnapshot({ workspaceRoot: repository, snapshot: result.snapshot }),
    ).resolves.toBe(false);
  });

  it("never revalidates omitted content, including same-size binary drift", async () => {
    const repository = await makeRepository("omitted-revalidate");
    await writeFile(path.join(repository, "binary.bin"), Buffer.from([0, 1, 2, 3]));
    await git(repository, "add", "binary.bin");
    await git(repository, "commit", "--quiet", "-m", "binary base");
    await writeFile(path.join(repository, "binary.bin"), Buffer.from([0, 4, 5, 6]));
    const result = await inspectGitChanges({
      workspaceRoot: repository,
      request: { schemaVersion: "inspect-git-changes-v1" },
    });
    expect(result.snapshot.manifestOmissionCodes).toContain("binary");
    await expect(
      verifyChangeSnapshot({ workspaceRoot: repository, snapshot: result.snapshot }),
    ).resolves.toBe(false);

    await writeFile(path.join(repository, "binary.bin"), Buffer.from([0, 7, 8, 9]));
    await expect(
      verifyChangeSnapshot({ workspaceRoot: repository, snapshot: result.snapshot }),
    ).resolves.toBe(false);

    const tampered = structuredClone(result.snapshot);
    tampered.discoverySha256 = "f".repeat(64);
    await expect(
      verifyChangeSnapshot({ workspaceRoot: repository, snapshot: tampered }),
    ).rejects.toThrow(/snapshot identity mismatch/u);
  });
});
