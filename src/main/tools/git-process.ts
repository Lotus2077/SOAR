import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants, type BigIntStats } from "node:fs";
import {
  chmod,
  lstat,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TextDecoder } from "node:util";

import {
  createIsolatedGitEnvironment,
  DEFAULT_GIT_EXECUTABLE,
  DEFAULT_GIT_TIMEOUT_MS,
  GIT_CONFIG_PREFLIGHT_STDOUT_LIMIT_BYTES,
  GIT_INDEX_COPY_LIMIT_BYTES,
  GIT_INDEX_VISIBILITY_STDOUT_LIMIT_BYTES,
  GIT_STDERR_LIMIT_BYTES,
  GIT_STDOUT_LIMIT_BYTES,
  GIT_TERMINATION_GRACE_MS,
  isFullGitObjectId,
  requireAbsoluteGitExecutable,
  requireAbsoluteGitTemporaryParent,
  requireAbsoluteGitWorkspace,
  requireFullGitObjectId,
  requireGitTimeoutMs,
} from "./git-command-policy";

const FATAL_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const ZERO_OBJECT_ID_PATTERN = /^0+$/u;
const OBJECT_TYPE_PATTERN = /^(?:blob|commit|tag|tree)$/u;

const FIXED_CONFIG_PREFIX = [
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
] as const;

type FixedGitOperation =
  | { kind: "probe_inside_work_tree" }
  | { kind: "show_top_level" }
  | { kind: "show_object_format" }
  | { kind: "resolve_base_commit" }
  | { kind: "resolve_index_path" }
  | { kind: "show_shared_index_path" }
  | { kind: "find_unsafe_repository_config" }
  | { kind: "status_porcelain_v2" }
  | { kind: "list_index_stage" }
  | { kind: "list_index_visibility" }
  | { kind: "diff_raw"; baseCommitOid: string }
  | { kind: "diff_numstat"; baseCommitOid: string }
  | { kind: "cat_file_check"; objectId: string }
  | { kind: "cat_file_content"; objectId: string };

type TerminationReason = "cancelled" | "output_limit" | "timeout";

export type GitProcessErrorCode =
  | "CANCELLED"
  | "CAPTURED_BASE_MISMATCH"
  | "GIT_FAILED"
  | "INDEX_COPY_FAILED"
  | "INVALID_OUTPUT"
  | "OBJECT_NOT_AUTHORIZED"
  | "OBJECT_UNAVAILABLE"
  | "OUTPUT_LIMIT"
  | "SPAWN_FAILED"
  | "TIMEOUT"
  | "UNSUPPORTED_INDEX_FORMAT"
  | "UNSAFE_INDEX_VISIBILITY"
  | "UNSAFE_REPOSITORY_CONFIG";

export class GitProcessError extends Error {
  readonly code: GitProcessErrorCode;

  constructor(code: GitProcessErrorCode, message: string) {
    super(message);
    this.name = "GitProcessError";
    this.code = code;
  }
}

export interface GitObjectMetadata {
  objectId: string;
  type: "blob" | "commit" | "tag" | "tree";
  size: number;
}

export interface GitProcessRunnerOptions {
  cwd: string;
  /** Application-owned test/platform seam. Model/tool arguments never reach it. */
  gitExecutable?: string;
  /** Per-command process deadline. Overall tool deadlines remain the caller's job. */
  timeoutMs?: number;
  /** Application-owned test/platform seam. Model/tool arguments never reach it. */
  temporaryIndexParent?: string;
}

export interface GitDiscoveryViews {
  indexBytes: Buffer;
  indexVisibilityBytes: Buffer;
  statusBytes: Buffer;
  rawBytes: Buffer;
  numstatBytes: Buffer;
}

interface GitOperationResult {
  exitCode: number;
  output: Buffer;
}

interface StableIndexCopy {
  contents: Buffer;
  sourceMtimeNs: bigint;
}

function operationArguments(operation: FixedGitOperation): string[] {
  const common = [...FIXED_CONFIG_PREFIX];
  switch (operation.kind) {
    case "probe_inside_work_tree":
      return [...common, "rev-parse", "--is-inside-work-tree"];
    case "show_top_level":
      return [...common, "rev-parse", "--path-format=absolute", "--show-toplevel"];
    case "show_object_format":
      return [...common, "rev-parse", "--show-object-format=storage"];
    case "resolve_base_commit":
      return [...common, "rev-parse", "--verify", "--end-of-options", "HEAD^{commit}"];
    case "resolve_index_path":
      return [...common, "rev-parse", "--path-format=absolute", "--git-path", "index"];
    case "show_shared_index_path":
      return [...common, "rev-parse", "--path-format=absolute", "--shared-index-path"];
    case "find_unsafe_repository_config":
      // With global/system files isolated by the child environment, omitting a
      // file selector examines the effective repository-local and worktree
      // scopes, including files reached from their include directives.
      return [
        ...common,
        "config",
        "--includes",
        "--name-only",
        "-z",
        "--get-regexp",
        "^(filter\\..*\\.(clean|process)|protocol\\..*\\.allow)$",
      ];
    case "status_porcelain_v2":
      return [
        ...common,
        "status",
        "--porcelain=v2",
        "-z",
        "--untracked-files=all",
        "--no-ignored",
        "--ignore-submodules=dirty",
        "--find-renames=50%",
      ];
    case "list_index_stage":
      return [...common, "ls-files", "--cached", "--stage", "--full-name", "-z", "--"];
    case "list_index_visibility":
      return [
        ...common,
        "ls-files",
        "--cached",
        "--full-name",
        "-v",
        "-f",
        "-z",
        "--",
      ];
    case "diff_raw":
      return [
        ...common,
        "diff",
        "--raw",
        "-z",
        "--no-abbrev",
        "--find-renames=50%",
        "--no-ext-diff",
        "--no-textconv",
        "--ignore-submodules=dirty",
        operation.baseCommitOid,
        "--",
      ];
    case "diff_numstat":
      return [
        ...common,
        "diff",
        "--numstat",
        "-z",
        "--find-renames=50%",
        "--no-ext-diff",
        "--no-textconv",
        "--ignore-submodules=dirty",
        operation.baseCommitOid,
        "--",
      ];
    case "cat_file_check":
      return [
        ...common,
        "cat-file",
        "--batch-check=%(objectname) %(objecttype) %(objectsize)",
      ];
    case "cat_file_content":
      return [
        ...common,
        "cat-file",
        "--batch=%(objectname) %(objecttype) %(objectsize)",
      ];
  }
}

function operationInput(operation: FixedGitOperation): Buffer | undefined {
  if (operation.kind === "cat_file_check" || operation.kind === "cat_file_content") {
    return Buffer.from(`${operation.objectId}\n`, "ascii");
  }
  return undefined;
}

function sanitizedOperationLabel(operation: FixedGitOperation): string {
  switch (operation.kind) {
    case "probe_inside_work_tree":
    case "show_top_level":
    case "show_object_format":
    case "resolve_base_commit":
    case "resolve_index_path":
    case "show_shared_index_path":
      return "rev-parse";
    case "status_porcelain_v2":
      return "status";
    case "find_unsafe_repository_config":
      return "config";
    case "list_index_stage":
    case "list_index_visibility":
      return "ls-files";
    case "diff_raw":
    case "diff_numstat":
      return "diff";
    case "cat_file_check":
    case "cat_file_content":
      return "cat-file";
  }
}

function operationStdoutLimit(operation: FixedGitOperation): number {
  switch (operation.kind) {
    case "find_unsafe_repository_config":
      return GIT_CONFIG_PREFLIGHT_STDOUT_LIMIT_BYTES;
    case "list_index_visibility":
      return GIT_INDEX_VISIBILITY_STDOUT_LIMIT_BYTES;
    default:
      return GIT_STDOUT_LIMIT_BYTES;
  }
}

function assertBaselineIndexVisibility(output: Buffer): void {
  if (output.length === 0) return;
  if (output[output.length - 1] !== 0) {
    throw new GitProcessError(
      "INVALID_OUTPUT",
      "Git returned malformed index visibility metadata.",
    );
  }

  let offset = 0;
  while (offset < output.length) {
    const end = output.indexOf(0, offset);
    if (end < 0 || end - offset < 3 || output[offset + 1] !== 0x20) {
      throw new GitProcessError(
        "INVALID_OUTPUT",
        "Git returned malformed index visibility metadata.",
      );
    }
    if (output[offset] !== 0x48) {
      throw new GitProcessError(
        "UNSAFE_INDEX_VISIBILITY",
        "Git index visibility flags prevent complete change inspection.",
      );
    }
    offset = end + 1;
  }
}

function signalProcessGroup(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      try {
        child.kill(signal);
      } catch {
        // The close event is the authoritative process-lifecycle result.
      }
    }
  }
}

function decodeSingleLine(output: Buffer): string {
  let decoded: string;
  try {
    decoded = FATAL_UTF8_DECODER.decode(output);
  } catch {
    throw new GitProcessError("INVALID_OUTPUT", "Git returned invalid UTF-8 metadata.");
  }
  const value = decoded.endsWith("\n") ? decoded.slice(0, -1) : decoded;
  if (value.length === 0 || /[\r\n\0]/u.test(value)) {
    throw new GitProcessError("INVALID_OUTPUT", "Git returned malformed metadata.");
  }
  return value;
}

function parseObjectMetadataLine(line: Buffer): GitObjectMetadata {
  let value: string;
  try {
    value = FATAL_UTF8_DECODER.decode(line);
  } catch {
    throw new GitProcessError("INVALID_OUTPUT", "Git returned invalid object metadata.");
  }
  if (/^[0-9a-f]+ missing$/u.test(value)) {
    throw new GitProcessError("OBJECT_UNAVAILABLE", "The requested Git object is unavailable.");
  }
  const match = /^(\S+) (\S+) ([0-9]+)$/u.exec(value);
  if (!match) {
    throw new GitProcessError("INVALID_OUTPUT", "Git returned malformed object metadata.");
  }
  const [, objectId = "", type = "", sizeText = ""] = match;
  if (!isFullGitObjectId(objectId) || !OBJECT_TYPE_PATTERN.test(type)) {
    throw new GitProcessError("INVALID_OUTPUT", "Git returned malformed object metadata.");
  }
  const size = Number(sizeText);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new GitProcessError("INVALID_OUTPUT", "Git returned an invalid object size.");
  }
  return {
    objectId,
    type: type as GitObjectMetadata["type"],
    size,
  };
}

function splitBatchHeader(output: Buffer): { metadata: GitObjectMetadata; bodyOffset: number } {
  const newline = output.indexOf(0x0a);
  if (newline < 0) {
    throw new GitProcessError("INVALID_OUTPUT", "Git returned malformed batch output.");
  }
  return {
    metadata: parseObjectMetadataLine(output.subarray(0, newline)),
    bodyOffset: newline + 1,
  };
}

function fileIdentity(value: BigIntStats): string {
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

function assertRegularSingleLinkIndex(value: BigIntStats): void {
  if (!value.isFile() || value.isSymbolicLink() || value.nlink !== 1n) {
    throw new GitProcessError(
      "INDEX_COPY_FAILED",
      "The Git index could not be copied safely.",
    );
  }
}

function boundedIndexSize(value: BigIntStats): number {
  if (value.size < 0n || value.size > BigInt(GIT_INDEX_COPY_LIMIT_BYTES)) {
    throw new GitProcessError(
      "INDEX_COPY_FAILED",
      "The Git index exceeded the temporary-copy limit.",
    );
  }
  return Number(value.size);
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new GitProcessError("CANCELLED", "Git execution was cancelled.");
  }
}

export class GitProcessRunner {
  readonly cwd: string;
  readonly gitExecutable: string;
  readonly timeoutMs: number;
  readonly temporaryIndexParent: string;

  private capturedBaseCommitOid?: string;
  private capturedIndexPath?: string;
  private objectIdLength?: 40 | 64;
  private readonly observedObjectIds = new Set<string>();
  private readonly activeTemporaryIndexPaths = new Set<string>();
  private worktreeSensitiveOperationTail: Promise<void> = Promise.resolve();

  constructor(options: GitProcessRunnerOptions) {
    this.cwd = requireAbsoluteGitWorkspace(options.cwd);
    this.gitExecutable = requireAbsoluteGitExecutable(
      options.gitExecutable ?? DEFAULT_GIT_EXECUTABLE,
    );
    this.timeoutMs = requireGitTimeoutMs(options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS);
    this.temporaryIndexParent = requireAbsoluteGitTemporaryParent(
      options.temporaryIndexParent ?? tmpdir(),
    );
  }

  async probeInsideWorkTree(signal?: AbortSignal): Promise<boolean> {
    const value = decodeSingleLine(
      await this.runOperation({ kind: "probe_inside_work_tree" }, signal),
    );
    if (value !== "true" && value !== "false") {
      throw new GitProcessError("INVALID_OUTPUT", "Git returned an invalid worktree probe.");
    }
    return value === "true";
  }

  async showTopLevel(signal?: AbortSignal): Promise<string> {
    const value = decodeSingleLine(await this.runOperation({ kind: "show_top_level" }, signal));
    return requireAbsoluteGitWorkspace(value);
  }

  async showObjectFormat(signal?: AbortSignal): Promise<"sha1" | "sha256"> {
    const value = decodeSingleLine(
      await this.runOperation({ kind: "show_object_format" }, signal),
    );
    if (value !== "sha1" && value !== "sha256") {
      throw new GitProcessError("INVALID_OUTPUT", "Git returned an unsupported object format.");
    }
    this.objectIdLength = value === "sha1" ? 40 : 64;
    return value;
  }

  async resolveBaseCommit(signal?: AbortSignal): Promise<string> {
    const objectId = decodeSingleLine(
      await this.runOperation({ kind: "resolve_base_commit" }, signal),
    );
    this.validateObjectId(objectId);
    this.capturedBaseCommitOid = objectId;
    this.observedObjectIds.add(objectId);
    return objectId;
  }

  async resolveIndexPath(signal?: AbortSignal): Promise<string> {
    const value = decodeSingleLine(
      await this.runOperation({ kind: "resolve_index_path" }, signal),
    );
    this.capturedIndexPath = requireAbsoluteGitWorkspace(value);
    return this.capturedIndexPath;
  }

  async readStatus(signal?: AbortSignal): Promise<Buffer> {
    const output = await this.runWorktreeSensitiveOperation(
      { kind: "status_porcelain_v2" },
      signal,
    );
    this.registerStatusObjectIds(output);
    return output;
  }

  async readIndexStage(signal?: AbortSignal): Promise<Buffer> {
    const output = await this.runOperation({ kind: "list_index_stage" }, signal);
    this.registerIndexObjectIds(output);
    return output;
  }

  async readIndexVisibility(signal?: AbortSignal): Promise<Buffer> {
    const output = await this.runOperation({ kind: "list_index_visibility" }, signal);
    assertBaselineIndexVisibility(output);
    return output;
  }

  async readDiscoveryViews(
    baseCommitOid: string,
    signal?: AbortSignal,
  ): Promise<GitDiscoveryViews> {
    this.requireCapturedBase(baseCommitOid);
    if (this.capturedIndexPath === undefined) {
      throw new GitProcessError(
        "INDEX_COPY_FAILED",
        "Discovery requires a captured Git index path.",
      );
    }

    return this.runSerializedWorktreeRead(async () => {
      await this.assertNoSharedIndex(signal);
      return this.withTemporaryIndex(async (temporaryIndexPath) => {
        const indexBytes = await this.runOperation(
          { kind: "list_index_stage" },
          signal,
          temporaryIndexPath,
        );
        this.registerIndexObjectIds(indexBytes);
        const indexVisibilityBytes = await this.runOperation(
          { kind: "list_index_visibility" },
          signal,
          temporaryIndexPath,
        );
        assertBaselineIndexVisibility(indexVisibilityBytes);

        await this.assertNoUnsafeRepositoryConfig(signal);
        const statusBytes = await this.runOperation(
          { kind: "status_porcelain_v2" },
          signal,
          temporaryIndexPath,
        );
        this.registerStatusObjectIds(statusBytes);

        await this.tightenTemporaryIndex(temporaryIndexPath);
        await this.assertNoUnsafeRepositoryConfig(signal);
        const rawBytes = await this.runOperation(
          { kind: "diff_raw", baseCommitOid },
          signal,
          temporaryIndexPath,
        );
        this.registerRawDiffObjectIds(rawBytes);

        await this.tightenTemporaryIndex(temporaryIndexPath);
        await this.assertNoUnsafeRepositoryConfig(signal);
        const numstatBytes = await this.runOperation(
          { kind: "diff_numstat", baseCommitOid },
          signal,
          temporaryIndexPath,
        );

        await this.tightenTemporaryIndex(temporaryIndexPath);
        await this.assertTemporaryIndexSemantics(
          temporaryIndexPath,
          indexBytes,
          indexVisibilityBytes,
          signal,
        );
        await this.assertOnlyTemporaryIndexRemains(temporaryIndexPath);
        return {
          indexBytes,
          indexVisibilityBytes,
          statusBytes,
          rawBytes,
          numstatBytes,
        };
      }, signal);
    });
  }

  async checkObject(objectId: string, signal?: AbortSignal): Promise<GitObjectMetadata> {
    this.requireObservedObjectId(objectId);
    const output = await this.runOperation({ kind: "cat_file_check", objectId }, signal);
    const newline = output.indexOf(0x0a);
    const line = newline < 0 ? output : output.subarray(0, newline);
    if (newline >= 0 && newline !== output.length - 1) {
      throw new GitProcessError("INVALID_OUTPUT", "Git returned trailing batch-check output.");
    }
    const metadata = parseObjectMetadataLine(line);
    if (metadata.objectId !== objectId) {
      throw new GitProcessError("INVALID_OUTPUT", "Git returned the wrong object identity.");
    }
    return metadata;
  }

  async readBlob(objectId: string, signal?: AbortSignal): Promise<Buffer> {
    this.requireObservedObjectId(objectId);
    const checked = await this.checkObject(objectId, signal);
    if (checked.type !== "blob") {
      throw new GitProcessError("OBJECT_UNAVAILABLE", "The requested Git object is not a blob.");
    }
    const output = await this.runOperation({ kind: "cat_file_content", objectId }, signal);
    const { metadata, bodyOffset } = splitBatchHeader(output);
    if (metadata.objectId !== objectId) {
      throw new GitProcessError("INVALID_OUTPUT", "Git returned the wrong object identity.");
    }
    if (metadata.type !== "blob") {
      throw new GitProcessError("OBJECT_UNAVAILABLE", "The requested Git object is not a blob.");
    }
    const bodyEnd = bodyOffset + metadata.size;
    if (bodyEnd + 1 !== output.length || output[bodyEnd] !== 0x0a) {
      throw new GitProcessError("INVALID_OUTPUT", "Git returned malformed blob content.");
    }
    return Buffer.from(output.subarray(bodyOffset, bodyEnd));
  }

  private validateObjectId(objectId: string): void {
    requireFullGitObjectId(objectId);
    if (this.objectIdLength !== undefined && objectId.length !== this.objectIdLength) {
      throw new GitProcessError(
        "INVALID_OUTPUT",
        "Git returned an object ID with the wrong object-format length.",
      );
    }
  }

  private requireCapturedBase(baseCommitOid: string): void {
    requireFullGitObjectId(baseCommitOid);
    if (baseCommitOid !== this.capturedBaseCommitOid) {
      throw new GitProcessError(
        "CAPTURED_BASE_MISMATCH",
        "Diff operations require the captured base commit.",
      );
    }
  }

  private requireObservedObjectId(objectId: string): void {
    requireFullGitObjectId(objectId);
    if (!this.observedObjectIds.has(objectId)) {
      throw new GitProcessError(
        "OBJECT_NOT_AUTHORIZED",
        "Git object access is limited to IDs observed by this runner.",
      );
    }
  }

  private registerIndexObjectIds(output: Buffer): void {
    for (const record of output.toString("latin1").split("\0")) {
      if (record.length === 0) continue;
      const tab = record.indexOf("\t");
      const header = tab < 0 ? "" : record.slice(0, tab);
      const match = /^(?:100644|100755|120000|160000) ([0-9a-f]+) [0-3]$/u.exec(header);
      if (match?.[1]) this.registerObservedObjectId(match[1]);
    }
  }

  private registerStatusObjectIds(output: Buffer): void {
    for (const record of output.toString("latin1").split("\0")) {
      if (!record.startsWith("1 ") && !record.startsWith("2 ")) continue;
      const fields = record.split(" ");
      for (const objectId of [fields[6], fields[7]]) {
        if (objectId && !ZERO_OBJECT_ID_PATTERN.test(objectId)) {
          this.registerObservedObjectId(objectId);
        }
      }
    }
  }

  private registerRawDiffObjectIds(output: Buffer): void {
    for (const record of output.toString("latin1").split("\0")) {
      if (!record.startsWith(":")) continue;
      const match =
        /^:[0-7]{6} [0-7]{6} ([0-9a-f]+) ([0-9a-f]+) [A-Z][0-9]*$/u.exec(record);
      if (!match) continue;
      for (const objectId of [match[1], match[2]]) {
        if (objectId && !ZERO_OBJECT_ID_PATTERN.test(objectId)) {
          this.registerObservedObjectId(objectId);
        }
      }
    }
  }

  private registerObservedObjectId(objectId: string): void {
    if (!isFullGitObjectId(objectId)) return;
    if (this.objectIdLength !== undefined && objectId.length !== this.objectIdLength) return;
    this.observedObjectIds.add(objectId);
  }

  private async assertNoSharedIndex(signal?: AbortSignal): Promise<void> {
    const output = await this.runOperation({ kind: "show_shared_index_path" }, signal);
    if (output.length !== 0) {
      // Decode only to reject malformed output deterministically. The private
      // path itself never crosses the sanitized error boundary.
      decodeSingleLine(output);
      throw new GitProcessError(
        "UNSUPPORTED_INDEX_FORMAT",
        "Split Git indexes are not supported for change inspection.",
      );
    }
  }

  private async readStableIndexCopy(signal?: AbortSignal): Promise<StableIndexCopy> {
    const indexPath = this.capturedIndexPath;
    if (indexPath === undefined) {
      throw new GitProcessError(
        "INDEX_COPY_FAILED",
        "Diff operations require a captured Git index path.",
      );
    }

    throwIfCancelled(signal);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const pathBefore = await lstat(indexPath, { bigint: true });
      assertRegularSingleLinkIndex(pathBefore);
      handle = await open(indexPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const handleBefore = await handle.stat({ bigint: true });
      assertRegularSingleLinkIndex(handleBefore);
      if (fileIdentity(pathBefore) !== fileIdentity(handleBefore)) {
        throw new GitProcessError(
          "INDEX_COPY_FAILED",
          "The Git index changed while it was being copied.",
        );
      }

      const size = boundedIndexSize(handleBefore);
      const output = Buffer.allocUnsafe(size);
      let offset = 0;
      while (offset < size) {
        throwIfCancelled(signal);
        const { bytesRead } = await handle.read(output, offset, size - offset, offset);
        if (bytesRead === 0) {
          throw new GitProcessError(
            "INDEX_COPY_FAILED",
            "The Git index changed while it was being copied.",
          );
        }
        offset += bytesRead;
      }

      const handleAfter = await handle.stat({ bigint: true });
      const pathAfter = await lstat(indexPath, { bigint: true });
      assertRegularSingleLinkIndex(handleAfter);
      assertRegularSingleLinkIndex(pathAfter);
      const expectedIdentity = fileIdentity(pathBefore);
      if (
        fileIdentity(handleBefore) !== expectedIdentity ||
        fileIdentity(handleAfter) !== expectedIdentity ||
        fileIdentity(pathAfter) !== expectedIdentity
      ) {
        throw new GitProcessError(
          "INDEX_COPY_FAILED",
          "The Git index changed while it was being copied.",
        );
      }
      return { contents: output, sourceMtimeNs: handleBefore.mtimeNs };
    } catch (error) {
      if (error instanceof GitProcessError) throw error;
      throw new GitProcessError(
        "INDEX_COPY_FAILED",
        "The Git index could not be copied safely.",
      );
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  private async writeTemporaryIndex(
    temporaryIndexPath: string,
    source: StableIndexCopy,
    signal?: AbortSignal,
  ): Promise<void> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      throwIfCancelled(signal);
      handle = await open(
        temporaryIndexPath,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      let offset = 0;
      while (offset < source.contents.length) {
        throwIfCancelled(signal);
        const { bytesWritten } = await handle.write(
          source.contents,
          offset,
          source.contents.length - offset,
          offset,
        );
        if (bytesWritten === 0) {
          throw new GitProcessError(
            "INDEX_COPY_FAILED",
            "The temporary Git index could not be written safely.",
          );
        }
        offset += bytesWritten;
      }
      await handle.sync();
      // The copied bytes contain stat-cache entries interpreted relative to
      // the index file's mtime. Preserve the canonical timestamp so two
      // discovery bundles apply identical racy-clean semantics instead of
      // depending on when each private copy happened to be created.
      await handle.utimes(0, Number(source.sourceMtimeNs) / 1_000_000_000);
      const written = await handle.stat({ bigint: true });
      assertRegularSingleLinkIndex(written);
      const mtimeDelta =
        written.mtimeNs >= source.sourceMtimeNs
          ? written.mtimeNs - source.sourceMtimeNs
          : source.sourceMtimeNs - written.mtimeNs;
      if (
        boundedIndexSize(written) !== source.contents.length ||
        (Number(written.mode) & 0o777) !== 0o600 ||
        mtimeDelta > 1_000_000n
      ) {
        throw new GitProcessError(
          "INDEX_COPY_FAILED",
          "The temporary Git index could not be verified.",
        );
      }
    } catch (error) {
      if (error instanceof GitProcessError) throw error;
      throw new GitProcessError(
        "INDEX_COPY_FAILED",
        "The temporary Git index could not be written safely.",
      );
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  private async withTemporaryIndex<T>(
    callback: (temporaryIndexPath: string) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    let temporaryRoot: string | undefined;
    let temporaryIndexPath: string | undefined;
    try {
      throwIfCancelled(signal);
      const canonicalParent = await realpath(this.temporaryIndexParent);
      const parentStat = await lstat(canonicalParent, { bigint: true });
      if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
        throw new GitProcessError(
          "INDEX_COPY_FAILED",
          "The temporary Git index parent is not a safe directory.",
        );
      }

      temporaryRoot = await mkdtemp(path.join(canonicalParent, "soar-git-index-"));
      if (path.dirname(temporaryRoot) !== canonicalParent) {
        throw new GitProcessError(
          "INDEX_COPY_FAILED",
          "The temporary Git index directory could not be verified.",
        );
      }
      await chmod(temporaryRoot, 0o700);
      const rootStat = await lstat(temporaryRoot, { bigint: true });
      if (
        !rootStat.isDirectory() ||
        rootStat.isSymbolicLink() ||
        rootStat.nlink < 1n ||
        (Number(rootStat.mode) & 0o777) !== 0o700
      ) {
        throw new GitProcessError(
          "INDEX_COPY_FAILED",
          "The temporary Git index directory could not be verified.",
        );
      }

      const source = await this.readStableIndexCopy(signal);
      temporaryIndexPath = path.join(temporaryRoot, "index");
      await this.writeTemporaryIndex(temporaryIndexPath, source, signal);
      this.activeTemporaryIndexPaths.add(temporaryIndexPath);
      return await callback(temporaryIndexPath);
    } catch (error) {
      if (error instanceof GitProcessError) throw error;
      throw new GitProcessError(
        "INDEX_COPY_FAILED",
        "The temporary Git index operation could not complete.",
      );
    } finally {
      if (temporaryIndexPath !== undefined) {
        this.activeTemporaryIndexPaths.delete(temporaryIndexPath);
      }
      if (temporaryRoot !== undefined) {
        try {
          await rm(temporaryRoot, { force: true, recursive: true });
        } catch {
          throw new GitProcessError(
            "INDEX_COPY_FAILED",
            "The temporary Git index could not be removed.",
          );
        }
      }
    }
  }

  private async assertTemporaryIndexSemantics(
    temporaryIndexPath: string,
    expectedIndexStageBytes: Buffer,
    expectedIndexVisibilityBytes: Buffer,
    signal?: AbortSignal,
  ): Promise<void> {
    const indexStageBytes = await this.runOperation(
      { kind: "list_index_stage" },
      signal,
      temporaryIndexPath,
    );
    const indexVisibilityBytes = await this.runOperation(
      { kind: "list_index_visibility" },
      signal,
      temporaryIndexPath,
    );
    assertBaselineIndexVisibility(indexVisibilityBytes);
    if (
      !indexStageBytes.equals(expectedIndexStageBytes) ||
      !indexVisibilityBytes.equals(expectedIndexVisibilityBytes)
    ) {
      throw new GitProcessError(
        "INDEX_COPY_FAILED",
        "The temporary Git index did not preserve captured index semantics.",
      );
    }
  }

  private async tightenTemporaryIndex(temporaryIndexPath: string): Promise<void> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporaryIndexPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      await handle.chmod(0o600);
      const value = await handle.stat({ bigint: true });
      const pathValue = await lstat(temporaryIndexPath, { bigint: true });
      assertRegularSingleLinkIndex(value);
      assertRegularSingleLinkIndex(pathValue);
      if (
        fileIdentity(value) !== fileIdentity(pathValue) ||
        (Number(value.mode) & 0o777) !== 0o600
      ) {
        throw new GitProcessError(
          "INDEX_COPY_FAILED",
          "The temporary Git index permissions could not be verified.",
        );
      }
    } catch (error) {
      if (error instanceof GitProcessError) throw error;
      throw new GitProcessError(
        "INDEX_COPY_FAILED",
        "The temporary Git index permissions could not be restricted.",
      );
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  private async assertOnlyTemporaryIndexRemains(
    temporaryIndexPath: string,
  ): Promise<void> {
    const entries = await readdir(path.dirname(temporaryIndexPath));
    if (entries.length !== 1 || entries[0] !== path.basename(temporaryIndexPath)) {
      throw new GitProcessError(
        "UNSUPPORTED_INDEX_FORMAT",
        "Git created unsupported temporary-index state.",
      );
    }
  }

  /**
   * Git does not expose a read lock spanning a config lookup and a subsequent
   * status/diff process. Serializing each pair prevents this runner from
   * interleaving its own worktree reads, but an external writer can still alter
   * repository config between the two processes. Callers must therefore keep
   * the selected repository outside concurrently hostile control.
   */
  private async runWorktreeSensitiveOperation(
    operation: Extract<FixedGitOperation, { kind: "status_porcelain_v2" }>,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    return this.runSerializedWorktreeRead(async () => {
      await this.assertNoUnsafeRepositoryConfig(signal);
      return this.runOperation(operation, signal);
    });
  }

  private async runSerializedWorktreeRead<T>(callback: () => Promise<T>): Promise<T> {
    const predecessor = this.worktreeSensitiveOperationTail;
    let release!: () => void;
    this.worktreeSensitiveOperationTail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await predecessor;
    try {
      return await callback();
    } finally {
      release();
    }
  }

  private async assertNoUnsafeRepositoryConfig(signal?: AbortSignal): Promise<void> {
    const result = await this.runOperationWithAcceptedExitCodes(
      { kind: "find_unsafe_repository_config" },
      new Set([0, 1]),
      signal,
    );

    if (result.exitCode === 1) {
      if (result.output.length !== 0) {
        throw new GitProcessError(
          "INVALID_OUTPUT",
          "Git returned malformed repository security configuration metadata.",
        );
      }
      return;
    }

    if (result.output.length === 0) {
      throw new GitProcessError(
        "INVALID_OUTPUT",
        "Git returned malformed repository security configuration metadata.",
      );
    }

    throw new GitProcessError(
      "UNSAFE_REPOSITORY_CONFIG",
      "Git repository config declares an external filter or transport override.",
    );
  }

  private async runOperation(
    operation: FixedGitOperation,
    signal?: AbortSignal,
    temporaryIndexPath?: string,
  ): Promise<Buffer> {
    const result = await this.runOperationWithAcceptedExitCodes(
      operation,
      new Set([0]),
      signal,
      temporaryIndexPath,
    );
    return result.output;
  }

  private async runOperationWithAcceptedExitCodes(
    operation: FixedGitOperation,
    acceptedExitCodes: ReadonlySet<number>,
    signal?: AbortSignal,
    temporaryIndexPath?: string,
  ): Promise<GitOperationResult> {
    if (signal?.aborted) {
      throw new GitProcessError("CANCELLED", "Git execution was cancelled.");
    }

    const args = operationArguments(operation);
    const input = operationInput(operation);
    const label = sanitizedOperationLabel(operation);
    const stdoutLimitBytes = operationStdoutLimit(operation);
    const environment: NodeJS.ProcessEnv = { ...createIsolatedGitEnvironment() };
    if (temporaryIndexPath !== undefined) {
      if (!this.activeTemporaryIndexPaths.has(temporaryIndexPath)) {
        throw new GitProcessError(
          "INDEX_COPY_FAILED",
          "Git refused an index path not owned by this operation.",
        );
      }
      environment.GIT_INDEX_FILE = temporaryIndexPath;
    }

    return new Promise<GitOperationResult>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(this.gitExecutable, args, {
          cwd: this.cwd,
          detached: true,
          env: environment,
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch {
        reject(new GitProcessError("SPAWN_FAILED", "Git process could not be started."));
        return;
      }

      const stdout: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let spawnFailed = false;
      let terminationReason: TerminationReason | undefined;
      let killTimer: NodeJS.Timeout | undefined;
      let terminationGate: Promise<void> | undefined;

      const terminate = (reason: TerminationReason): void => {
        if (terminationReason !== undefined) return;
        terminationReason = reason;
        signalProcessGroup(child, "SIGTERM");
        terminationGate = new Promise((gateResolved) => {
          killTimer = setTimeout(() => {
            signalProcessGroup(child, "SIGKILL");
            gateResolved();
          }, GIT_TERMINATION_GRACE_MS);
        });
      };

      const onAbort = (): void => terminate("cancelled");
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) terminate("cancelled");

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > stdoutLimitBytes) {
          terminate("output_limit");
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > GIT_STDERR_LIMIT_BYTES) terminate("output_limit");
      });
      child.once("error", () => {
        spawnFailed = true;
      });

      const timeout = setTimeout(() => terminate("timeout"), this.timeoutMs);
      timeout.unref();

      child.stdin.on("error", () => {
        // A sanitized exit/spawn error is reported after `close`.
      });
      child.stdin.end(input);

      child.once("close", (exitCode) => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);

        const settle = (): void => {
          if (killTimer !== undefined) clearTimeout(killTimer);
          if (terminationReason === "cancelled") {
            reject(new GitProcessError("CANCELLED", "Git execution was cancelled."));
            return;
          }
          if (terminationReason === "timeout") {
            reject(new GitProcessError("TIMEOUT", "Git execution exceeded its process deadline."));
            return;
          }
          if (terminationReason === "output_limit") {
            reject(new GitProcessError("OUTPUT_LIMIT", "Git output exceeded a hard process limit."));
            return;
          }
          if (spawnFailed) {
            reject(new GitProcessError("SPAWN_FAILED", "Git process could not be started."));
            return;
          }
          if (exitCode === null || !acceptedExitCodes.has(exitCode)) {
            reject(new GitProcessError("GIT_FAILED", `Git ${label} could not complete.`));
            return;
          }
          resolve({
            exitCode,
            output: Buffer.concat(stdout, stdoutBytes),
          });
        };

        if (terminationGate !== undefined) {
          void terminationGate.then(settle);
        } else {
          settle();
        }
      });
    });
  }
}

export function createGitProcessRunner(options: GitProcessRunnerOptions): GitProcessRunner {
  return new GitProcessRunner(options);
}
