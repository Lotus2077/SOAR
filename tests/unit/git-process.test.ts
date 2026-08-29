import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  createIsolatedGitEnvironment,
  GIT_CONFIG_PREFLIGHT_STDOUT_LIMIT_BYTES,
  GIT_INDEX_VISIBILITY_STDOUT_LIMIT_BYTES,
  GIT_STDERR_LIMIT_BYTES,
  GIT_STDOUT_LIMIT_BYTES,
} from "../../src/main/tools/git-command-policy";
import {
  createGitProcessRunner,
  GitProcessError,
} from "../../src/main/tools/git-process";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), `soar-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function createFakeGit(
  directory: string,
  body: string,
  name = "fake-git",
): Promise<string> {
  const executable = path.join(directory, name);
  await writeFile(executable, `#!/bin/sh\n${body}\n`, "utf8");
  await chmod(executable, 0o755);
  return executable;
}

async function createRepository(): Promise<string> {
  const repository = await createTemporaryDirectory("git-process-repository");
  await execFileAsync("/usr/bin/git", ["init", "--quiet"], { cwd: repository });
  await execFileAsync("/usr/bin/git", ["config", "user.name", "SOAR Test"], {
    cwd: repository,
  });
  await execFileAsync("/usr/bin/git", ["config", "user.email", "soar@example.invalid"], {
    cwd: repository,
  });
  await writeFile(path.join(repository, "tracked.txt"), "base\n", "utf8");
  await execFileAsync("/usr/bin/git", ["add", "tracked.txt"], { cwd: repository });
  await execFileAsync("/usr/bin/git", ["commit", "--quiet", "-m", "base"], {
    cwd: repository,
  });
  return repository;
}

async function waitForPath(targetPath: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      await lstat(targetPath);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the Git fixture marker.");
}

async function physicalFileIdentity(targetPath: string): Promise<string> {
  const value = await lstat(targetPath, { bigint: true });
  return [
    value.dev,
    value.ino,
    value.mode,
    value.nlink,
    value.size,
    value.mtimeNs,
    value.ctimeNs,
  ].join(":");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("Git command policy", () => {
  it("constructs only the documented minimal environment", () => {
    expect(createIsolatedGitEnvironment()).toEqual({
      PATH: "/usr/bin:/bin",
      LANG: "C",
      LC_ALL: "C",
      TZ: "UTC",
      GIT_ATTR_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_NO_LAZY_FETCH: "1",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_PAGER: "cat",
      GIT_PROTOCOL_FROM_USER: "0",
      GIT_TERMINAL_PROMPT: "0",
      PAGER: "cat",
    });
    expect(createIsolatedGitEnvironment()).not.toHaveProperty("HOME");
    expect(createIsolatedGitEnvironment()).not.toHaveProperty("SSH_AUTH_SOCK");
    expect(createIsolatedGitEnvironment()).not.toHaveProperty("HTTPS_PROXY");
  });

  it("builds the fixed probe argv without accepting caller arguments", async () => {
    const directory = await createTemporaryDirectory("git-process-argv");
    const capturePath = path.join(directory, "argv.bin");
    const lazyFetchEnvironmentPath = path.join(directory, "lazy-fetch-env");
    const executable = await createFakeGit(
      directory,
      `for argument in "$@"; do printf '%s\\0' "$argument"; done > ${shellQuote(capturePath)}
printf '%s' "$GIT_NO_LAZY_FETCH" > ${shellQuote(lazyFetchEnvironmentPath)}
printf 'true\\n'`,
    );
    const runner = createGitProcessRunner({ cwd: directory, gitExecutable: executable });

    await expect(runner.probeInsideWorkTree()).resolves.toBe(true);

    const args = (await readFile(capturePath))
      .toString("utf8")
      .split("\0")
      .filter(Boolean);
    expect(args).toEqual([
      "--no-pager",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
      "-c",
      "core.fileMode=true",
      "-c",
      "core.ignoreStat=false",
      "-c",
      "core.trustctime=true",
      "-c",
      "core.checkStat=default",
      "-c",
      "core.excludesFile=/dev/null",
      "-c",
      "diff.external=",
      "-c",
      "diff.trustExitCode=false",
      "-c",
      "submodule.recurse=false",
      "-c",
      "status.submoduleSummary=false",
      "-c",
      "diff.renames=true",
      "-c",
      "diff.renameLimit=200",
      "-c",
      "status.renames=true",
      "-c",
      "status.renameLimit=200",
      "-c",
      "color.ui=false",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "protocol.allow=never",
      "-c",
      "pager.diff=false",
      "-c",
      "pager.status=false",
      "rev-parse",
      "--is-inside-work-tree",
    ]);
    await expect(readFile(lazyFetchEnvironmentPath, "utf8")).resolves.toBe("1");
  });

  it("requires absolute application-owned workspace and executable paths", () => {
    expect(() => createGitProcessRunner({ cwd: "relative" })).toThrowError(
      expect.objectContaining({ code: "INVALID_ARGUMENT" }),
    );
    expect(() =>
      createGitProcessRunner({ cwd: "/tmp", gitExecutable: "git" }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_EXECUTABLE" }));
    expect(() => createGitProcessRunner({ cwd: "/tmp", timeoutMs: 0 })).toThrowError(
      expect.objectContaining({ code: "INVALID_ARGUMENT" }),
    );
    expect(() =>
      createGitProcessRunner({ cwd: "/tmp", temporaryIndexParent: "relative" }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
  });
});

describe("GitProcessRunner", () => {
  it("reads real repository metadata and preserves byte-oriented command output", async () => {
    const repository = await createRepository();
    const runner = createGitProcessRunner({ cwd: repository });
    const canonicalRepository = await realpath(repository);

    await expect(runner.probeInsideWorkTree()).resolves.toBe(true);
    await expect(runner.showTopLevel()).resolves.toBe(canonicalRepository);
    await expect(runner.showObjectFormat()).resolves.toBe("sha1");
    const baseCommitOid = await runner.resolveBaseCommit();
    await expect(runner.resolveIndexPath()).resolves.toBe(
      path.join(canonicalRepository, ".git", "index"),
    );

    const index = await runner.readIndexStage();
    expect(Buffer.isBuffer(index)).toBe(true);
    const indexMatch = /^100644 ([0-9a-f]{40}) 0\ttracked\.txt\0$/u.exec(
      index.toString("utf8"),
    );
    expect(indexMatch?.[1]).toBeDefined();
    const blobObjectId = indexMatch?.[1] ?? "";
    const indexVisibility = await runner.readIndexVisibility();
    expect(indexVisibility).toEqual(Buffer.from("H tracked.txt\0"));

    await expect(runner.checkObject(baseCommitOid)).resolves.toMatchObject({
      objectId: baseCommitOid,
      type: "commit",
    });
    await expect(runner.checkObject(blobObjectId)).resolves.toEqual({
      objectId: blobObjectId,
      type: "blob",
      size: 5,
    });
    await expect(runner.readBlob(blobObjectId)).resolves.toEqual(Buffer.from("base\n"));

    await writeFile(path.join(repository, "tracked.txt"), "working\n", "utf8");
    await writeFile(path.join(repository, "untracked.txt"), "new\n", "utf8");
    const {
      statusBytes: status,
      rawBytes: raw,
      numstatBytes: numstat,
    } = await runner.readDiscoveryViews(baseCommitOid);

    expect(Buffer.isBuffer(status)).toBe(true);
    expect(status.includes(Buffer.from("untracked.txt\0"))).toBe(true);
    expect(Buffer.isBuffer(raw)).toBe(true);
    expect(raw.includes(Buffer.from("tracked.txt\0"))).toBe(true);
    expect(Buffer.isBuffer(numstat)).toBe(true);
    expect(numstat.includes(Buffer.from("tracked.txt\0"))).toBe(true);
  });

  it("isolates exact-reversal diffs from the canonical index and removes the copy", async () => {
    const repository = await createRepository();
    const temporaryIndexParent = await createTemporaryDirectory("git-index-copy");
    const canonicalIndexPath = path.join(repository, ".git", "index");
    await writeFile(path.join(repository, "tracked.txt"), "staged change\n", "utf8");
    await execFileAsync("/usr/bin/git", ["add", "tracked.txt"], { cwd: repository });
    await writeFile(path.join(repository, "tracked.txt"), "base\n", "utf8");

    const canonicalBytesBefore = await readFile(canonicalIndexPath);
    const canonicalIdentityBefore = await physicalFileIdentity(canonicalIndexPath);
    const runner = createGitProcessRunner({ cwd: repository, temporaryIndexParent });
    await runner.showObjectFormat();
    const baseCommitOid = await runner.resolveBaseCommit();
    await runner.resolveIndexPath();
    const discovery = await runner.readDiscoveryViews(baseCommitOid);
    const status = discovery.statusBytes;
    expect(status.toString("utf8")).toContain("1 MM ");

    expect(discovery.rawBytes).toEqual(Buffer.alloc(0));
    expect(discovery.numstatBytes).toEqual(Buffer.alloc(0));
    expect(await readFile(canonicalIndexPath)).toEqual(canonicalBytesBefore);
    expect(await physicalFileIdentity(canonicalIndexPath)).toBe(canonicalIdentityBefore);
    await expect(readdir(temporaryIndexParent)).resolves.toEqual([]);
  });

  it("keeps status, raw, and numstat coherent for a same-size restored-mtime rewrite", async () => {
    const repository = await createRepository();
    const temporaryIndexParent = await createTemporaryDirectory("git-index-racy");
    const trackedPath = path.join(repository, "tracked.txt");
    const originalStat = await stat(trackedPath);
    await writeFile(trackedPath, "evil\n", "utf8");
    await utimes(trackedPath, originalStat.atime, originalStat.mtime);
    const restoredStat = await stat(trackedPath);
    expect(restoredStat.size).toBe(originalStat.size);
    expect(restoredStat.mtime.getTime()).toBe(originalStat.mtime.getTime());

    const canonicalIndexPath = path.join(repository, ".git", "index");
    const canonicalBytesBefore = await readFile(canonicalIndexPath);
    const canonicalIdentityBefore = await physicalFileIdentity(canonicalIndexPath);
    const runner = createGitProcessRunner({ cwd: repository, temporaryIndexParent });
    await runner.showObjectFormat();
    const baseCommitOid = await runner.resolveBaseCommit();
    await runner.resolveIndexPath();
    const discovery = await runner.readDiscoveryViews(baseCommitOid);

    expect(discovery.statusBytes.toString("utf8")).toContain("1 .M ");
    expect(discovery.rawBytes.includes(Buffer.from("tracked.txt\0"))).toBe(true);
    expect(discovery.numstatBytes.includes(Buffer.from("tracked.txt\0"))).toBe(true);
    expect(await readFile(canonicalIndexPath)).toEqual(canonicalBytesBefore);
    expect(await physicalFileIdentity(canonicalIndexPath)).toBe(canonicalIdentityBefore);
    await expect(readdir(temporaryIndexParent)).resolves.toEqual([]);
  });

  it("removes the temporary index after cancellation without writing the original", async () => {
    const repository = await createRepository();
    const temporaryIndexParent = await createTemporaryDirectory("git-index-cancel");
    const fixtureDirectory = await createTemporaryDirectory("git-index-cancel-fixture");
    const startedMarker = path.join(fixtureDirectory, "diff-started");
    const executable = await createFakeGit(
      fixtureDirectory,
      `operation=unknown
for argument in "$@"; do
  case "$argument" in
    config|status|diff|rev-parse|ls-files|cat-file)
      operation="$argument"
      break
      ;;
  esac
done
if [ "$operation" = "diff" ]; then
  printf 'started' > ${shellQuote(startedMarker)}
  trap '' TERM
  /bin/sleep 30 &
  wait
fi
exec /usr/bin/git "$@"`,
    );
    const canonicalIndexPath = path.join(repository, ".git", "index");
    const canonicalBytesBefore = await readFile(canonicalIndexPath);
    const canonicalIdentityBefore = await physicalFileIdentity(canonicalIndexPath);
    const runner = createGitProcessRunner({
      cwd: repository,
      gitExecutable: executable,
      temporaryIndexParent,
    });
    await runner.showObjectFormat();
    const baseCommitOid = await runner.resolveBaseCommit();
    await runner.resolveIndexPath();
    const controller = new AbortController();
    const operation = runner.readDiscoveryViews(baseCommitOid, controller.signal);
    await waitForPath(startedMarker);
    controller.abort();

    await expect(operation).rejects.toMatchObject({ code: "CANCELLED" });
    expect(await readFile(canonicalIndexPath)).toEqual(canonicalBytesBefore);
    expect(await physicalFileIdentity(canonicalIndexPath)).toBe(canonicalIdentityBefore);
    await expect(readdir(temporaryIndexParent)).resolves.toEqual([]);
  });

  it("removes the temporary index after a diff process failure", async () => {
    const repository = await createRepository();
    const temporaryIndexParent = await createTemporaryDirectory("git-index-error");
    const fixtureDirectory = await createTemporaryDirectory("git-index-error-fixture");
    const executable = await createFakeGit(
      fixtureDirectory,
      `for argument in "$@"; do
  if [ "$argument" = "diff" ]; then exit 27; fi
done
exec /usr/bin/git "$@"`,
    );
    const canonicalIndexPath = path.join(repository, ".git", "index");
    const canonicalBytesBefore = await readFile(canonicalIndexPath);
    const canonicalIdentityBefore = await physicalFileIdentity(canonicalIndexPath);
    const runner = createGitProcessRunner({
      cwd: repository,
      gitExecutable: executable,
      temporaryIndexParent,
    });
    await runner.showObjectFormat();
    const baseCommitOid = await runner.resolveBaseCommit();
    await runner.resolveIndexPath();

    await expect(
      runner.readDiscoveryViews(baseCommitOid),
    ).rejects.toMatchObject({
      code: "GIT_FAILED",
      message: "Git diff could not complete.",
    });
    expect(await readFile(canonicalIndexPath)).toEqual(canonicalBytesBefore);
    expect(await physicalFileIdentity(canonicalIndexPath)).toBe(canonicalIdentityBefore);
    await expect(readdir(temporaryIndexParent)).resolves.toEqual([]);
  });

  it("rejects split indexes before creating a temporary diff index", async () => {
    const repository = await createRepository();
    const temporaryIndexParent = await createTemporaryDirectory("git-index-split");
    await execFileAsync("/usr/bin/git", ["update-index", "--split-index"], {
      cwd: repository,
    });
    const runner = createGitProcessRunner({ cwd: repository, temporaryIndexParent });
    await runner.showObjectFormat();
    const baseCommitOid = await runner.resolveBaseCommit();
    await runner.resolveIndexPath();

    await expect(
      runner.readDiscoveryViews(baseCommitOid),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_INDEX_FORMAT",
      message: "Split Git indexes are not supported for change inspection.",
    });
    await expect(readdir(temporaryIndexParent)).resolves.toEqual([]);
  });

  it("returns status bytes without lossy UTF-8 decoding", async () => {
    const directory = await createTemporaryDirectory("git-process-bytes");
    const executable = await createFakeGit(
      directory,
      `for argument in "$@"; do
  if [ "$argument" = "config" ]; then exit 1; fi
done
printf '\\377\\000'`,
    );
    const runner = createGitProcessRunner({ cwd: directory, gitExecutable: executable });

    await expect(runner.readStatus()).resolves.toEqual(Buffer.from([0xff, 0x00]));
  });

  it.each([
    ["assume-unchanged", "h tracked.txt\\0"],
    ["skip-worktree", "S tracked.txt\\0"],
    ["another non-baseline tag", "C tracked.txt\\0"],
  ])("rejects %s index visibility metadata", async (_label, output) => {
    const directory = await createTemporaryDirectory("git-process-visibility");
    const executable = await createFakeGit(directory, `printf '${output}'`);
    const runner = createGitProcessRunner({ cwd: directory, gitExecutable: executable });

    await expect(runner.readIndexVisibility()).rejects.toMatchObject({
      code: "UNSAFE_INDEX_VISIBILITY",
      message: "Git index visibility flags prevent complete change inspection.",
    });
  });

  it.each(["printf 'H tracked.txt'", "printf 'H \\0'"])(
    "rejects malformed index visibility metadata",
    async (body) => {
      const directory = await createTemporaryDirectory("git-process-visibility-malformed");
      const executable = await createFakeGit(directory, body);
      const runner = createGitProcessRunner({ cwd: directory, gitExecutable: executable });

      await expect(runner.readIndexVisibility()).rejects.toMatchObject({
        code: "INVALID_OUTPUT",
        message: "Git returned malformed index visibility metadata.",
      });
    },
  );

  it("bounds index visibility output independently", async () => {
    const directory = await createTemporaryDirectory("git-process-visibility-limit");
    const executable = await createFakeGit(directory, "/usr/bin/yes 'H tracked.txt'");
    const runner = createGitProcessRunner({ cwd: directory, gitExecutable: executable });

    expect(GIT_INDEX_VISIBILITY_STDOUT_LIMIT_BYTES).toBeGreaterThan(0);
    await expect(runner.readIndexVisibility()).rejects.toMatchObject({ code: "OUTPUT_LIMIT" });
  });

  it("preflights every status and diff immediately before the worktree read", async () => {
    const repository = await createRepository();
    const directory = await createTemporaryDirectory("git-process-sequencing");
    const operationLog = path.join(directory, "operations.log");
    const configArgumentsLog = path.join(directory, "config-arguments.bin");
    const executable = await createFakeGit(
      directory,
      `operation=unknown
for argument in "$@"; do
  case "$argument" in
    config|status|diff|rev-parse|ls-files|cat-file)
      operation="$argument"
      break
      ;;
  esac
done
printf '%s\\n' "$operation" >> ${shellQuote(operationLog)}
if [ "$operation" = "config" ]; then
  for argument in "$@"; do printf '%s\\0' "$argument"; done > ${shellQuote(configArgumentsLog)}
fi
exec /usr/bin/git "$@"`,
    );
    const runner = createGitProcessRunner({ cwd: repository, gitExecutable: executable });
    await runner.showObjectFormat();
    const baseCommitOid = await runner.resolveBaseCommit();
    await runner.resolveIndexPath();
    await writeFile(operationLog, "", "utf8");

    await runner.readStatus();
    await runner.readDiscoveryViews(baseCommitOid);

    expect((await readFile(operationLog, "utf8")).trim().split("\n")).toEqual([
      "config",
      "status",
      "rev-parse",
      "ls-files",
      "ls-files",
      "config",
      "status",
      "config",
      "diff",
      "config",
      "diff",
      "ls-files",
      "ls-files",
    ]);
    const configArguments = (await readFile(configArgumentsLog))
      .toString("utf8")
      .split("\0")
      .filter(Boolean);
    expect(configArguments.slice(-6)).toEqual([
      "config",
      "--includes",
      "--name-only",
      "-z",
      "--get-regexp",
      "^(filter\\..*\\.(clean|process)|protocol\\..*\\.allow)$",
    ]);
  });

  it("rejects direct clean-filter config before status or diff can execute it", async () => {
    const repository = await createRepository();
    const marker = path.join(repository, "filter-executed");
    const driver = await createFakeGit(
      repository,
      `printf 'executed' > ${shellQuote(marker)}
exec /bin/cat`,
      "hostile-clean-filter",
    );
    await writeFile(path.join(repository, ".gitattributes"), "tracked.txt filter=hostile\n");
    await execFileAsync("/usr/bin/git", ["add", ".gitattributes"], { cwd: repository });
    await execFileAsync("/usr/bin/git", ["commit", "--quiet", "-m", "attributes"], {
      cwd: repository,
    });
    await execFileAsync("/usr/bin/git", ["config", "filter.hostile.clean", driver], {
      cwd: repository,
    });
    await writeFile(path.join(repository, "tracked.txt"), "working\n", "utf8");
    const runner = createGitProcessRunner({ cwd: repository });
    await runner.showObjectFormat();
    const baseCommitOid = await runner.resolveBaseCommit();
    await runner.resolveIndexPath();

    for (const operation of [
      runner.readStatus(),
      runner.readDiscoveryViews(baseCommitOid),
    ]) {
      await expect(operation).rejects.toMatchObject({
        code: "UNSAFE_REPOSITORY_CONFIG",
        message: "Git repository config declares an external filter or transport override.",
      });
    }
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("detects process filters loaded from local includes without exposing values", async () => {
    const repository = await createRepository();
    const includedConfig = path.join(repository, "included-filter.config");
    const privateValue = "PRIVATE_FILTER_COMMAND_VALUE";
    await writeFile(
      includedConfig,
      `[filter "included"]\n\tprocess = ${privateValue}\n`,
      "utf8",
    );
    await execFileAsync(
      "/usr/bin/git",
      ["config", "--local", "include.path", includedConfig],
      { cwd: repository },
    );
    const runner = createGitProcessRunner({ cwd: repository });

    let failure: unknown;
    try {
      await runner.readStatus();
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "UNSAFE_REPOSITORY_CONFIG" });
    expect(String(failure)).not.toContain(privateValue);
  });

  it("detects worktree-scoped filters and repository transport overrides", async () => {
    const repository = await createRepository();
    await execFileAsync("/usr/bin/git", ["config", "extensions.worktreeConfig", "true"], {
      cwd: repository,
    });
    await execFileAsync(
      "/usr/bin/git",
      ["config", "--worktree", "filter.worktree.clean", "/bin/cat"],
      { cwd: repository },
    );
    const worktreeRunner = createGitProcessRunner({ cwd: repository });
    await expect(worktreeRunner.readStatus()).rejects.toMatchObject({
      code: "UNSAFE_REPOSITORY_CONFIG",
    });

    await execFileAsync(
      "/usr/bin/git",
      ["config", "--worktree", "--unset-all", "filter.worktree.clean"],
      { cwd: repository },
    );
    await execFileAsync("/usr/bin/git", ["config", "protocol.file.allow", "always"], {
      cwd: repository,
    });
    const protocolRunner = createGitProcessRunner({ cwd: repository });
    await expect(protocolRunner.readStatus()).rejects.toMatchObject({
      code: "UNSAFE_REPOSITORY_CONFIG",
    });
  });

  it.each([
    ["zero with empty output", "exit 0", "INVALID_OUTPUT"],
    ["one with output", "printf 'filter.hostile.clean\\0'; exit 1", "INVALID_OUTPUT"],
    ["an unexpected exit", "exit 2", "GIT_FAILED"],
  ])("fails closed when config returns %s", async (_label, configResult, expectedCode) => {
    const directory = await createTemporaryDirectory("git-process-config-exit");
    const executable = await createFakeGit(
      directory,
      `for argument in "$@"; do
  if [ "$argument" = "config" ]; then ${configResult}; fi
done
printf 'status'`,
    );
    const runner = createGitProcessRunner({ cwd: directory, gitExecutable: executable });

    await expect(runner.readStatus()).rejects.toMatchObject({ code: expectedCode });
  });

  it("bounds names-only repository config output independently", async () => {
    const directory = await createTemporaryDirectory("git-process-config-limit");
    const executable = await createFakeGit(directory, "/usr/bin/yes filter.hostile.clean");
    const runner = createGitProcessRunner({ cwd: directory, gitExecutable: executable });

    expect(GIT_CONFIG_PREFLIGHT_STDOUT_LIMIT_BYTES).toBeLessThan(GIT_STDOUT_LIMIT_BYTES);
    await expect(runner.readStatus()).rejects.toMatchObject({ code: "OUTPUT_LIMIT" });
  });

  it("rejects invalid, uncaptured, and unobserved object IDs before execution", async () => {
    const repository = await createRepository();
    const runner = createGitProcessRunner({ cwd: repository });

    await expect(
      runner.readDiscoveryViews("HEAD"),
    ).rejects.toMatchObject({
      code: "INVALID_OBJECT_ID",
    });
    await expect(
      runner.readDiscoveryViews("a".repeat(40)),
    ).rejects.toMatchObject({
      code: "CAPTURED_BASE_MISMATCH",
    });
    await expect(runner.checkObject("b".repeat(40))).rejects.toMatchObject({
      code: "OBJECT_NOT_AUTHORIZED",
    });
  });

  it("does not spawn an already-aborted operation", async () => {
    const directory = await createTemporaryDirectory("git-process-preabort");
    const marker = path.join(directory, "spawned");
    const executable = await createFakeGit(
      directory,
      `printf 'spawned' > ${shellQuote(marker)}\nprintf 'true\\n'`,
    );
    const runner = createGitProcessRunner({ cwd: directory, gitExecutable: executable });
    const controller = new AbortController();
    controller.abort();

    await expect(runner.probeInsideWorkTree(controller.signal)).rejects.toMatchObject({
      code: "CANCELLED",
    });
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("kills the process group after cancellation and reports no process output", async () => {
    const directory = await createTemporaryDirectory("git-process-cancel");
    const executable = await createFakeGit(
      directory,
      "trap '' TERM\n/bin/sleep 30 &\nwait",
    );
    const runner = createGitProcessRunner({ cwd: directory, gitExecutable: executable });
    const controller = new AbortController();
    const operation = runner.readStatus(controller.signal);
    setTimeout(() => controller.abort(), 25);

    const startedAt = Date.now();
    await expect(operation).rejects.toMatchObject({
      code: "CANCELLED",
      message: "Git execution was cancelled.",
    });
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it("enforces the per-command timeout through the same process-group cleanup", async () => {
    const directory = await createTemporaryDirectory("git-process-timeout");
    const executable = await createFakeGit(
      directory,
      "trap '' TERM\n/bin/sleep 30 &\nwait",
    );
    const runner = createGitProcessRunner({
      cwd: directory,
      gitExecutable: executable,
      timeoutMs: 25,
    });

    await expect(runner.readStatus()).rejects.toMatchObject({
      code: "TIMEOUT",
      message: "Git execution exceeded its process deadline.",
    });
  });

  it.each([
    ["stdout", `/usr/bin/yes x`, GIT_STDOUT_LIMIT_BYTES],
    ["stderr", `/usr/bin/yes x >&2`, GIT_STDERR_LIMIT_BYTES],
  ])("kills a command that exceeds the %s hard limit", async (_stream, body, limit) => {
    const directory = await createTemporaryDirectory("git-process-limit");
    const executable = await createFakeGit(
      directory,
      `for argument in "$@"; do
  if [ "$argument" = "config" ]; then exit 1; fi
done
${body}`,
    );
    const runner = createGitProcessRunner({ cwd: directory, gitExecutable: executable });

    expect(limit).toBeGreaterThan(0);
    await expect(runner.readStatus()).rejects.toMatchObject({
      code: "OUTPUT_LIMIT",
      message: "Git output exceeded a hard process limit.",
    });
  });

  it("sanitizes nonzero exits and spawn failures without exposing stderr", async () => {
    const directory = await createTemporaryDirectory("git-process-errors");
    const executable = await createFakeGit(
      directory,
      `for argument in "$@"; do
  if [ "$argument" = "config" ]; then exit 1; fi
done
printf 'PRIVATE_STDERR_PAYLOAD\\n' >&2
exit 27`,
    );
    const failedRunner = createGitProcessRunner({ cwd: directory, gitExecutable: executable });

    let failure: unknown;
    try {
      await failedRunner.readStatus();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(GitProcessError);
    expect(failure).toMatchObject({
      code: "GIT_FAILED",
      message: "Git status could not complete.",
    });
    expect(String(failure)).not.toContain("PRIVATE_STDERR_PAYLOAD");

    const missingRunner = createGitProcessRunner({
      cwd: directory,
      gitExecutable: path.join(directory, "does-not-exist"),
    });
    await expect(missingRunner.readStatus()).rejects.toMatchObject({
      code: "SPAWN_FAILED",
      message: "Git process could not be started.",
    });
  });
});
