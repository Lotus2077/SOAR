import { createHash } from "node:crypto";
import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";

import {
  assertChangeSnapshotIdentity,
  buildChangeSnapshotV1,
  buildInspectGitChangesResultV1,
  sha256GitIndexStageEntries,
} from "../change-acquisition-contracts";
import {
  InspectGitChangesRequestV1Schema,
  type ChangeManifestEntryV1,
  type ChangeManifestOmissionCode,
  type ChangeSideIdentityV1,
  type ChangeSnapshotV1,
  type InspectGitChangesResultV1,
} from "../../shared/change-review-contracts";
import {
  admitGitBlobSide,
  MAX_CHANGE_SOURCE_BYTES_PER_SIDE,
  readWorkingTreeSide,
  type AdmittedChangeSide,
} from "./change-content-reader";
import { buildTextHunks } from "./change-hunk-builder";
import {
  parseGitIndexStage,
  parseGitNumstat,
  parseGitRawDiff,
  parseGitStatusPorcelainV2,
  GitChangeParseError,
  type ParsedGitRawEntry,
  type ParsedGitStatusEntry,
} from "./git-change-parsers";
import {
  createGitProcessRunner,
  GitProcessError,
  type GitProcessRunner,
} from "./git-process";
import { isIgnoredRelativePath, throwIfAborted } from "./workspace-policy";

export const MAX_INSPECT_CHANGED_PATHS = 200;
export const MAX_INSPECT_TOTAL_SOURCE_BYTES = 4 * 1024 * 1024;
export const MAX_INSPECT_HUNKS = 200;
export const MAX_INSPECT_RESULT_BYTES = 192 * 1024;
export const MAX_INSPECT_DURATION_MS = 20_000;

export type InspectGitChangesErrorCode =
  | "CANCELLED"
  | "EMPTY_OR_UNBORN_REPOSITORY"
  | "GIT_INSPECTION_FAILED"
  | "INVALID_REPOSITORY_STATE"
  | "NOT_GIT_WORKSPACE"
  | "OUTPUT_TOO_LARGE"
  | "UNSUPPORTED_PLATFORM"
  | "WORKSPACE_DRIFT"
  | "WORKSPACE_MISMATCH";

export class InspectGitChangesError extends Error {
  readonly code: InspectGitChangesErrorCode;

  constructor(code: InspectGitChangesErrorCode, message: string) {
    super(message);
    this.name = "InspectGitChangesError";
    this.code = code;
  }
}

export interface InspectGitChangesInput {
  workspaceRoot: string;
  request: unknown;
  signal?: AbortSignal;
}

export interface InspectGitChangesDependencies {
  createRunner?(cwd: string): GitProcessRunner;
}

interface DiscoveryCapture {
  baseCommitOid: string;
  indexBytes: Buffer;
  indexVisibilityBytes: Buffer;
  indexFingerprint: string;
  statusBytes: Buffer;
  rawBytes: Buffer;
  numstatBytes: Buffer;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function changePath(entry: ParsedGitStatusEntry): string {
  return entry.newPath ?? entry.oldPath ?? "";
}

function changeKey(oldPath: string | null, newPath: string | null): string {
  const encode = (value: string | null): string =>
    value === null ? "N" : `P${value.length}:${value}`;
  return `${encode(oldPath)}\0${encode(newPath)}`;
}

function addCodes(
  target: ChangeManifestOmissionCode[],
  ...sources: readonly ChangeManifestOmissionCode[][]
): void {
  for (const source of sources) {
    for (const code of source) if (!target.includes(code)) target.push(code);
  }
  target.sort(compareText);
}

function mode(value: string): ChangeSideIdentityV1["mode"] {
  if (value === "100644" || value === "100755" || value === "120000" || value === "160000") {
    return value;
  }
  throw new InspectGitChangesError(
    "INVALID_REPOSITORY_STATE",
    "Git reported a file mode that cannot be represented safely.",
  );
}

function omittedSide(
  fileMode: ChangeSideIdentityV1["mode"],
  sizeBytes: number,
  omissionCodes: ChangeManifestOmissionCode[],
): AdmittedChangeSide {
  return {
    identity: { mode: fileMode, sizeBytes, admittedContentSha256: null },
    text: null,
    omissionCodes: [...new Set(omissionCodes)].sort(compareText),
    filesystemFingerprint: null,
  };
}

async function readBaseSide(
  runner: GitProcessRunner,
  fileMode: ChangeSideIdentityV1["mode"],
  objectId: string | null,
  relativePath: string,
  remainingAdmissionBytes: number,
  signal: AbortSignal,
): Promise<AdmittedChangeSide> {
  if (fileMode === "160000") return omittedSide(fileMode, 0, ["submodule"]);
  if (!objectId) return omittedSide(fileMode, 0, ["unreadable"]);
  const metadata = await runner.checkObject(objectId, signal);
  if (metadata.type !== "blob") return omittedSide(fileMode, metadata.size, ["unreadable"]);
  if (fileMode === "120000") {
    return omittedSide(fileMode, metadata.size, ["symlink"]);
  }
  if (isIgnoredRelativePath(relativePath, "file")) {
    return omittedSide(fileMode, metadata.size, ["unsafe_path"]);
  }
  if (metadata.size > MAX_CHANGE_SOURCE_BYTES_PER_SIDE) {
    return omittedSide(fileMode, metadata.size, ["oversized"]);
  }
  if (metadata.size > remainingAdmissionBytes) {
    return omittedSide(fileMode, metadata.size, ["total_byte_limit"]);
  }
  return admitGitBlobSide(fileMode, await runner.readBlob(objectId, signal));
}

async function indexFingerprint(indexPath: string): Promise<string> {
  try {
    const value = await lstat(indexPath, { bigint: true });
    if (!value.isFile()) {
      throw new InspectGitChangesError(
        "INVALID_REPOSITORY_STATE",
        "The Git index is not a regular file.",
      );
    }
    try {
      await lstat(`${indexPath}.lock`);
      throw new InspectGitChangesError(
        "WORKSPACE_DRIFT",
        "The Git index is currently locked.",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return [value.dev, value.ino, value.mode, value.size, value.mtimeNs, value.ctimeNs]
      .map(String)
      .join(":");
  } catch (error) {
    if (error instanceof InspectGitChangesError) throw error;
    throw new InspectGitChangesError(
      "INVALID_REPOSITORY_STATE",
      "The Git index could not be inspected.",
    );
  }
}

async function captureDiscovery(
  runner: GitProcessRunner,
  indexPath: string,
  signal: AbortSignal,
): Promise<DiscoveryCapture> {
  const baseCommitOid = await runner.resolveBaseCommit(signal).catch((error) => {
    if (error instanceof GitProcessError && error.code === "GIT_FAILED") {
      throw new InspectGitChangesError(
        "EMPTY_OR_UNBORN_REPOSITORY",
        "A committed Git HEAD is required for change inspection.",
      );
    }
    throw error;
  });
  const indexBefore = await indexFingerprint(indexPath);
  const {
    indexBytes,
    indexVisibilityBytes,
    statusBytes,
    rawBytes,
    numstatBytes,
  } = await runner.readDiscoveryViews(baseCommitOid, signal);
  const indexAfter = await indexFingerprint(indexPath);
  if (indexBefore !== indexAfter) {
    throw new InspectGitChangesError(
      "WORKSPACE_DRIFT",
      "The Git index changed during inspection.",
    );
  }
  return {
    baseCommitOid,
    indexBytes,
    indexVisibilityBytes,
    indexFingerprint: indexAfter,
    statusBytes,
    rawBytes,
    numstatBytes,
  };
}

function captureIdentity(capture: DiscoveryCapture): string {
  return [
    capture.baseCommitOid,
    sha256(capture.indexBytes),
    sha256(capture.indexVisibilityBytes),
    capture.indexFingerprint,
    sha256(capture.statusBytes),
    sha256(capture.rawBytes),
    sha256(capture.numstatBytes),
  ].join(":");
}

/**
 * Stable identity for every Git-emitted discovery byte, including paths that
 * cannot be admitted into the bounded manifest. Filesystem fingerprints remain
 * outside this digest because they are drift guards, not repository content.
 */
function discoverySha256(capture: DiscoveryCapture): string {
  return sha256(
    Buffer.from(
      JSON.stringify({
        schemaVersion: "change-discovery-v1",
        baseCommitOid: capture.baseCommitOid,
        indexBytesSha256: sha256(capture.indexBytes),
        indexVisibilityBytesSha256: sha256(capture.indexVisibilityBytes),
        statusBytesSha256: sha256(capture.statusBytes),
        rawBytesSha256: sha256(capture.rawBytes),
        numstatBytesSha256: sha256(capture.numstatBytes),
      }),
      "utf8",
    ),
  );
}

function rawKind(entry: ParsedGitRawEntry): ParsedGitStatusEntry["changeKind"] {
  switch (entry.status) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
    case "C":
      return "renamed";
    case "T":
      return "type_changed";
    case "M":
      return entry.oldMode !== entry.newMode ? "type_changed" : "modified";
    case "U":
      return "modified";
    default:
      throw new InspectGitChangesError(
        "INVALID_REPOSITORY_STATE",
        "Git reported an unsupported raw change state.",
      );
  }
}

function coalesceSplitRawRename(
  statusEntry: ParsedGitStatusEntry,
  rawByKey: Map<string, ParsedGitRawEntry>,
): ParsedGitRawEntry | undefined {
  if (
    statusEntry.changeKind !== "renamed" ||
    !statusEntry.staged ||
    !statusEntry.unstaged ||
    statusEntry.oldPath === null ||
    statusEntry.newPath === null
  ) {
    return undefined;
  }

  // Porcelain v2 reports rename identity from HEAD to the index. The raw view
  // compares HEAD to the final working tree, so a sufficiently large unstaged
  // rewrite can legitimately fall below rename similarity and appear there as
  // a delete/add pair. Preserve the staged rename identity while combining the
  // two raw sides used for base/working metadata. The existing overlap omission
  // still prevents this three-state record from becoming complete evidence.
  const deletedKey = changeKey(statusEntry.oldPath, null);
  const addedKey = changeKey(null, statusEntry.newPath);
  const deleted = rawByKey.get(deletedKey);
  const added = rawByKey.get(addedKey);
  if (
    deleted === undefined ||
    added === undefined ||
    rawKind(deleted) !== "deleted" ||
    rawKind(added) !== "added"
  ) {
    return undefined;
  }

  rawByKey.delete(deletedKey);
  rawByKey.delete(addedKey);
  const coalesced: ParsedGitRawEntry = {
    oldMode: deleted.oldMode,
    newMode: added.newMode,
    oldObjectId: deleted.oldObjectId,
    newObjectId: added.newObjectId,
    status: "R",
    score: statusEntry.renameScore,
    oldPath: statusEntry.oldPath,
    newPath: statusEntry.newPath,
  };
  rawByKey.set(changeKey(coalesced.oldPath, coalesced.newPath), coalesced);
  return coalesced;
}

function normalizedDiffCoverageIdentity(entry: {
  oldPath: string | null;
  newPath: string | null;
}): string {
  const canonicalPath = entry.newPath ?? entry.oldPath;
  if (canonicalPath === null) {
    throw new InspectGitChangesError(
      "INVALID_REPOSITORY_STATE",
      "Git diff metadata omitted its change path.",
    );
  }
  const renameOldPath =
    entry.oldPath !== null &&
    entry.newPath !== null &&
    entry.oldPath !== entry.newPath
      ? entry.oldPath
      : null;
  return changeKey(renameOldPath, canonicalPath);
}

function uniqueDiffCoverageIdentities(
  entries: readonly { oldPath: string | null; newPath: string | null }[],
  view: "raw" | "numstat",
): Set<string> {
  const identities = new Set<string>();
  for (const entry of entries) {
    const identity = normalizedDiffCoverageIdentity(entry);
    if (identities.has(identity)) {
      throw new InspectGitChangesError(
        "INVALID_REPOSITORY_STATE",
        `Git ${view} contained duplicate normalized change identities.`,
      );
    }
    identities.add(identity);
  }
  return identities;
}

function normalizeBothStateStatus(
  status: ReturnType<typeof parseGitStatusPorcelainV2>,
  rawByKey: Map<string, ParsedGitRawEntry>,
): ReturnType<typeof parseGitStatusPorcelainV2> {
  const untrackedByPath = new Map<string, ParsedGitStatusEntry>();
  for (const entry of status.entries) {
    if (entry.changeKind !== "untracked" || entry.newPath === null) continue;
    if (untrackedByPath.has(entry.newPath)) {
      throw new InspectGitChangesError(
        "INVALID_REPOSITORY_STATE",
        "Git status contained duplicate untracked paths.",
      );
    }
    untrackedByPath.set(entry.newPath, entry);
  }

  const consumedUntrackedPaths = new Set<string>();
  const normalizedEntries: ParsedGitStatusEntry[] = [];
  for (const entry of status.entries) {
    if (entry.changeKind === "untracked") continue;

    if (
      entry.staged &&
      entry.unstaged &&
      entry.headMode === "000000" &&
      entry.indexMode !== "000000" &&
      entry.worktreeMode === "000000" &&
      entry.oldPath === null &&
      entry.newPath === null
    ) {
      // A staged add deleted again in the worktree has no base or final side,
      // but its index-only path must remain explicit and incomplete.
      normalizedEntries.push({
        ...entry,
        changeKind: "added",
        newPath: entry.statusPath,
        worktreeModeKnown: false,
      });
      continue;
    }

    if (entry.staged && entry.oldPath !== null && entry.newPath === null) {
      const recreated = untrackedByPath.get(entry.oldPath);
      const deletedKey = changeKey(entry.oldPath, null);
      const deleted = rawByKey.get(deletedKey);
      if (recreated !== undefined) {
        if (deleted === undefined || rawKind(deleted) !== "deleted") {
          throw new InspectGitChangesError(
            "INVALID_REPOSITORY_STATE",
            "A recreated staged-deletion path lacked its base deletion identity.",
          );
        }
        const recreatedKey = changeKey(entry.oldPath, entry.oldPath);
        if (rawByKey.has(recreatedKey)) {
          throw new InspectGitChangesError(
            "INVALID_REPOSITORY_STATE",
            "Git raw diff contained conflicting recreated-path identities.",
          );
        }
        rawByKey.delete(deletedKey);
        rawByKey.set(recreatedKey, {
          ...deleted,
          newMode: deleted.oldMode,
          newObjectId: null,
          status: "M",
          score: null,
          newPath: entry.oldPath,
        });
        consumedUntrackedPaths.add(entry.oldPath);
        normalizedEntries.push({
          ...entry,
          recordKind: "ordinary",
          changeKind: "modified",
          newPath: entry.oldPath,
          unstaged: true,
          worktreeMode: deleted.oldMode,
          renameScore: null,
          statusPath: entry.oldPath,
          worktreeModeKnown: false,
        });
        continue;
      }

      if (entry.unstaged && entry.recordKind === "renamed") {
        // A staged rename whose destination is then deleted is a final
        // base-path deletion, while the index-only rename remains omitted.
        normalizedEntries.push({
          ...entry,
          recordKind: "ordinary",
          changeKind: "deleted",
          renameScore: null,
          statusPath: entry.oldPath,
        });
        continue;
      }
    }

    normalizedEntries.push(entry);
  }

  for (const entry of status.entries) {
    if (
      entry.changeKind === "untracked" &&
      entry.newPath !== null &&
      !consumedUntrackedPaths.has(entry.newPath)
    ) {
      normalizedEntries.push(entry);
    }
  }
  return { ...status, entries: normalizedEntries };
}

function crossCheckDiscovery(capture: DiscoveryCapture): {
  status: ReturnType<typeof parseGitStatusPorcelainV2>;
  index: ReturnType<typeof parseGitIndexStage>;
  rawByKey: Map<string, ParsedGitRawEntry>;
  unsafeChangedPathCount: number;
} {
  let status = parseGitStatusPorcelainV2(capture.statusBytes);
  const index = parseGitIndexStage(capture.indexBytes);
  const raw = parseGitRawDiff(capture.rawBytes);
  const numstat = parseGitNumstat(capture.numstatBytes);
  if (index.entries.some((entry) => entry.stage !== 0)) {
    throw new InspectGitChangesError(
      "INVALID_REPOSITORY_STATE",
      "Unmerged Git index stages are not reviewable.",
    );
  }
  if (
    status.unsafeTrackedEntryCount !== raw.unsafeEntryCount ||
    raw.unsafeEntryCount !== numstat.unsafeEntryCount
  ) {
    throw new InspectGitChangesError(
      "INVALID_REPOSITORY_STATE",
      "Git status, raw, and numstat views disagreed on unsafe tracked changes.",
    );
  }
  const rawByKey = new Map<string, ParsedGitRawEntry>();
  for (const entry of raw.entries) {
    const key = changeKey(entry.oldPath, entry.newPath);
    if (rawByKey.has(key)) {
      throw new InspectGitChangesError(
        "INVALID_REPOSITORY_STATE",
        "Git raw diff contained duplicate change identities.",
      );
    }
    rawByKey.set(key, entry);
  }
  const rawCoveragePaths = uniqueDiffCoverageIdentities(raw.entries, "raw");
  const numstatCoveragePaths = uniqueDiffCoverageIdentities(
    numstat.entries,
    "numstat",
  );
  if (
    numstatCoveragePaths.size !== rawCoveragePaths.size ||
    [...rawCoveragePaths].some((changedPath) => !numstatCoveragePaths.has(changedPath))
  ) {
    throw new InspectGitChangesError(
      "INVALID_REPOSITORY_STATE",
      "Git raw and numstat views did not describe the same changes.",
    );
  }
  status = normalizeBothStateStatus(status, rawByKey);
  const statusKeys = new Set<string>();
  for (const entry of status.entries) {
    const key = changeKey(entry.oldPath, entry.newPath);
    if (statusKeys.has(key)) {
      throw new InspectGitChangesError(
        "INVALID_REPOSITORY_STATE",
        "Git status contained duplicate change identities.",
      );
    }
    statusKeys.add(key);
    if (entry.changeKind === "untracked") continue;
    const rawEntry =
      rawByKey.get(key) ?? coalesceSplitRawRename(entry, rawByKey);
    if (rawEntry === undefined) {
      if (entry.staged && entry.unstaged) continue;
      throw new InspectGitChangesError(
        "INVALID_REPOSITORY_STATE",
        "Git status and raw views did not describe the same change.",
      );
    }
    if (rawKind(rawEntry) !== entry.changeKind) {
      throw new InspectGitChangesError(
        "INVALID_REPOSITORY_STATE",
        "Git status and raw views did not describe the same change.",
      );
    }
  }
  if ([...rawByKey.keys()].some((key) => !statusKeys.has(key))) {
    throw new InspectGitChangesError(
      "INVALID_REPOSITORY_STATE",
      "Git raw diff contained a change absent from status.",
    );
  }
  return {
    status,
    index,
    rawByKey,
    unsafeChangedPathCount:
      status.unsafeTrackedEntryCount + status.unsafeUntrackedEntryCount,
  };
}

async function buildManifestEntry(input: {
  canonicalRoot: string;
  runner: GitProcessRunner;
  status: ParsedGitStatusEntry;
  raw: ParsedGitRawEntry | undefined;
  remainingAdmissionBytes: number;
  remainingHunks: number;
  signal: AbortSignal;
}): Promise<{
  entry: ChangeManifestEntryV1;
  admittedBytes: number;
  omittedHunks: number;
  workingState: AdmittedChangeSide | null;
}> {
  const { status, raw, signal } = input;
  const rawlessTrackedOverlap =
    status.changeKind !== "untracked" && raw === undefined;
  const absentFinalAddedOverlap =
    rawlessTrackedOverlap &&
    status.changeKind === "added" &&
    status.staged &&
    status.unstaged &&
    status.oldPath === null &&
    status.newPath !== null &&
    status.headMode === "000000" &&
    status.worktreeMode === "000000";
  if (rawlessTrackedOverlap && !(status.staged && status.unstaged)) {
    throw new InspectGitChangesError(
      "INVALID_REPOSITORY_STATE",
      "A tracked status entry had no raw diff identity.",
    );
  }
  if (status.oldPath === null && status.newPath === null) {
    throw new InspectGitChangesError(
      "INVALID_REPOSITORY_STATE",
      "The staged/index state cannot be represented as a base-to-working change.",
    );
  }

  let remainingBytes = input.remainingAdmissionBytes;
  let base: AdmittedChangeSide | null = null;
  if (status.oldPath !== null) {
    const oldMode = mode(raw?.oldMode ?? status.headMode);
    base = await readBaseSide(
      input.runner,
      oldMode,
      raw?.oldObjectId ?? status.headObjectId,
      status.oldPath,
      remainingBytes,
      signal,
    );
    if (base.text !== null) remainingBytes -= base.identity.sizeBytes;
  }

  let working: AdmittedChangeSide | null = null;
  if (status.newPath !== null && !absentFinalAddedOverlap) {
    const newMode =
      status.changeKind === "untracked"
        ? undefined
        : mode(raw?.newMode ?? status.worktreeMode);
    if (newMode === "160000") {
      working = omittedSide(newMode, 0, ["submodule"]);
    } else {
      working = await readWorkingTreeSide({
        canonicalRoot: input.canonicalRoot,
        relativePath: status.newPath,
        remainingAdmissionBytes: remainingBytes,
        signal,
      });
      if (
        newMode !== undefined &&
        status.worktreeModeKnown &&
        working.identity.mode !== newMode
      ) {
        throw new InspectGitChangesError(
          "WORKSPACE_DRIFT",
          "A changed file mode changed during inspection.",
        );
      }
      if (working.text !== null) remainingBytes -= working.identity.sizeBytes;
    }
  }

  if (
    rawlessTrackedOverlap &&
    !absentFinalAddedOverlap &&
    (status.oldPath !== status.newPath ||
      base === null ||
      working === null ||
      base.identity.mode !== working.identity.mode ||
      base.identity.sizeBytes !== working.identity.sizeBytes ||
      base.identity.admittedContentSha256 === null ||
      working.identity.admittedContentSha256 === null ||
      base.identity.admittedContentSha256 !==
        working.identity.admittedContentSha256)
  ) {
    throw new InspectGitChangesError(
      "INVALID_REPOSITORY_STATE",
      "A raw-less staged and unstaged path did not prove identical base and working content.",
    );
  }

  const omissionCodes: ChangeManifestOmissionCode[] = [];
  addCodes(
    omissionCodes,
    base?.omissionCodes ?? [],
    working?.omissionCodes ?? [],
  );
  if (status.staged && status.unstaged) {
    // The v1 manifest has base and working sides, but no separately admitted
    // index side. A net base-to-working diff can hide a staged edit that an
    // unstaged edit reverses, so this three-state case is never complete.
    addCodes(omissionCodes, ["staged_unstaged_overlap"]);
  }
  const canDiff =
    !absentFinalAddedOverlap &&
    (base === null || base.text !== null) &&
    (working === null || working.text !== null) &&
    !omissionCodes.some((code) =>
      ["binary", "submodule", "symlink", "unreadable", "unsafe_path", "oversized", "total_byte_limit"].includes(code),
    );
  let hunks: ChangeManifestEntryV1["hunks"] = [];
  let omittedHunks = 0;
  if (canDiff) {
    const result = buildTextHunks({
      oldPath: status.oldPath,
      newPath: status.newPath,
      oldText: base?.text ?? "",
      newText: working?.text ?? "",
      maxHunks: input.remainingHunks,
      signal,
    });
    hunks = result.hunks;
    omittedHunks = result.omittedHunkCount;
    addCodes(omissionCodes, result.omissionCodes);
  }

  const manifestChangeKind =
    status.changeKind === "modified" &&
    !status.worktreeModeKnown &&
    base !== null &&
    working !== null &&
    base.identity.mode !== working.identity.mode
      ? "type_changed"
      : status.changeKind;

  return {
    entry: {
      changeKind: manifestChangeKind,
      oldPath: status.oldPath,
      newPath: status.newPath,
      staged: status.staged,
      unstaged: status.unstaged,
      base: base?.identity ?? null,
      working: working?.identity ?? null,
      omissionCodes,
      hunks,
    },
    admittedBytes: input.remainingAdmissionBytes - remainingBytes,
    omittedHunks,
    workingState: working,
  };
}

function buildBoundedResult(
  baseCommitOid: string,
  indexSha256: string,
  discoveryIdentitySha256: string,
  manifest: ChangeManifestEntryV1[],
  initialOmittedPathCount: number,
  initialOmittedHunks: number,
  initialManifestCodes: ChangeManifestOmissionCode[],
): InspectGitChangesResultV1 {
  let omittedPathCount = initialOmittedPathCount;
  let omittedHunkCount = initialOmittedHunks;
  const manifestOmissionCodes = [...new Set(initialManifestCodes)].sort(compareText);
  const removeTrailingHunk = (): boolean => {
    for (let index = manifest.length - 1; index >= 0; index -= 1) {
      const entry = manifest[index];
      if (!entry || entry.hunks.length === 0) continue;
      entry.hunks.pop();
      if (!entry.omissionCodes.includes("truncated")) {
        entry.omissionCodes.push("truncated");
        entry.omissionCodes.sort(compareText);
      }
      omittedHunkCount += 1;
      if (!manifestOmissionCodes.includes("truncated")) {
        manifestOmissionCodes.push("truncated");
        manifestOmissionCodes.sort(compareText);
      }
      return true;
    }
    return false;
  };
  const removeTrailingManifestEntry = (): boolean => {
    if (manifest.pop() === undefined) return false;
    omittedPathCount += 1;
    if (!Number.isSafeInteger(omittedPathCount)) {
      throw new InspectGitChangesError(
        "OUTPUT_TOO_LARGE",
        "The bounded change manifest exceeded the safe omitted-path count.",
      );
    }
    if (!manifestOmissionCodes.includes("file_count_limit")) {
      manifestOmissionCodes.push("file_count_limit");
      manifestOmissionCodes.sort(compareText);
    }
    return true;
  };
  const reduceTrailingEvidence = (): boolean =>
    removeTrailingHunk() || removeTrailingManifestEntry();
  while (true) {
    const evidenceMap = manifest
      .flatMap((entry) =>
        entry.hunks.map((hunk) => ({
          hunkSha256: hunk.hunkSha256,
          oldPath: hunk.oldPath,
          newPath: hunk.newPath,
          baseLines: hunk.lines.flatMap((line) =>
            line.oldLine === null ? [] : [line.oldLine],
          ),
          workingLines: hunk.lines.flatMap((line) =>
            line.newLine === null ? [] : [line.newLine],
          ),
        })),
      )
      .sort((left, right) => compareText(left.hunkSha256, right.hunkSha256));
    const estimatedResult = {
      schemaVersion: "inspect-git-changes-result-v1",
      snapshot: {
        schemaVersion: "change-snapshot-v1",
        baseCommitOid,
        indexSha256,
        discoverySha256: discoveryIdentitySha256,
        manifest,
        omittedPathCount,
        omittedHunkCount,
        manifestOmissionCodes,
        snapshotId: "0".repeat(64),
      },
      evidenceMap,
    };
    if (
      Buffer.byteLength(JSON.stringify(estimatedResult), "utf8") >
      MAX_INSPECT_RESULT_BYTES
    ) {
      if (!reduceTrailingEvidence()) {
        throw new InspectGitChangesError(
          "OUTPUT_TOO_LARGE",
          "The bounded change manifest could not fit the host gateway limit.",
        );
      }
      continue;
    }
    const snapshot = buildChangeSnapshotV1({
      schemaVersion: "change-snapshot-v1",
      baseCommitOid,
      indexSha256,
      discoverySha256: discoveryIdentitySha256,
      manifest,
      omittedPathCount,
      omittedHunkCount,
      manifestOmissionCodes,
    });
    const result = buildInspectGitChangesResultV1(snapshot);
    if (Buffer.byteLength(JSON.stringify(result), "utf8") <= MAX_INSPECT_RESULT_BYTES) {
      return result;
    }
    if (!reduceTrailingEvidence()) {
      throw new InspectGitChangesError(
        "OUTPUT_TOO_LARGE",
        "The bounded change manifest could not fit the host gateway limit.",
      );
    }
  }
}

async function inspectWithSignal(
  input: InspectGitChangesInput,
  dependencies: InspectGitChangesDependencies,
  signal: AbortSignal,
): Promise<InspectGitChangesResultV1> {
  if (process.platform === "win32") {
    throw new InspectGitChangesError(
      "UNSUPPORTED_PLATFORM",
      "Change inspection currently requires POSIX process-group cleanup.",
    );
  }
  InspectGitChangesRequestV1Schema.parse(input.request);
  throwIfAborted(signal);
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(path.resolve(input.workspaceRoot));
    if (!(await stat(canonicalRoot)).isDirectory()) throw new Error("not-directory");
  } catch {
    throw new InspectGitChangesError(
      "NOT_GIT_WORKSPACE",
      "The selected workspace is not an inspectable directory.",
    );
  }
  const runner = dependencies.createRunner?.(canonicalRoot) ?? createGitProcessRunner({ cwd: canonicalRoot });
  if (!(await runner.probeInsideWorkTree(signal))) {
    throw new InspectGitChangesError("NOT_GIT_WORKSPACE", "The selected workspace is not a Git worktree.");
  }
  const topLevel = await realpath(await runner.showTopLevel(signal));
  if (topLevel !== canonicalRoot) {
    throw new InspectGitChangesError(
      "WORKSPACE_MISMATCH",
      "Select the Git worktree root before inspecting changes.",
    );
  }
  await runner.showObjectFormat(signal);
  const indexPath = await runner.resolveIndexPath(signal);
  if (!path.isAbsolute(indexPath)) {
    throw new InspectGitChangesError("INVALID_REPOSITORY_STATE", "Git returned a non-absolute index path.");
  }
  const before = await captureDiscovery(runner, indexPath, signal);
  let discovery: ReturnType<typeof crossCheckDiscovery>;
  try {
    discovery = crossCheckDiscovery(before);
  } catch (error) {
    if (error instanceof GitChangeParseError) {
      throw new InspectGitChangesError(
        "INVALID_REPOSITORY_STATE",
        "Git metadata could not be parsed into a safe change snapshot.",
      );
    }
    throw error;
  }
  const safeEntries = [...discovery.status.entries].sort((left, right) =>
    compareText(changePath(left), changePath(right)) ||
    compareText(left.oldPath ?? "", right.oldPath ?? ""),
  );
  const admittedStatuses = safeEntries.slice(0, MAX_INSPECT_CHANGED_PATHS);
  let omittedPathCount =
    discovery.unsafeChangedPathCount + Math.max(0, safeEntries.length - admittedStatuses.length);
  const manifestCodes: ChangeManifestOmissionCode[] = [];
  if (discovery.unsafeChangedPathCount > 0) manifestCodes.push("unsafe_path");
  if (safeEntries.length > admittedStatuses.length) manifestCodes.push("file_count_limit");
  if (discovery.index.entries.some((entry) => entry.mode === "160000")) {
    // Nested worktree dirtiness is deliberately not inspected. Marking every
    // repository containing a gitlink incomplete prevents an apparently clean,
    // scoreable result from hiding submodule changes.
    manifestCodes.push("submodule");
  }

  const manifest: ChangeManifestEntryV1[] = [];
  const workingStates = new Map<string, AdmittedChangeSide>();
  let admittedBytes = 0;
  let admittedHunks = 0;
  let omittedHunks = 0;
  for (const statusEntry of admittedStatuses) {
    throwIfAborted(signal);
    const raw =
      statusEntry.changeKind === "untracked"
        ? undefined
        : discovery.rawByKey.get(changeKey(statusEntry.oldPath, statusEntry.newPath));
    const built = await buildManifestEntry({
      canonicalRoot,
      runner,
      status: statusEntry,
      raw,
      remainingAdmissionBytes: Math.max(0, MAX_INSPECT_TOTAL_SOURCE_BYTES - admittedBytes),
      remainingHunks: Math.max(0, MAX_INSPECT_HUNKS - admittedHunks),
      signal,
    });
    manifest.push(built.entry);
    if (statusEntry.newPath !== null && built.workingState !== null) {
      workingStates.set(statusEntry.newPath, built.workingState);
    }
    admittedBytes += built.admittedBytes;
    admittedHunks += built.entry.hunks.length;
    omittedHunks += built.omittedHunks;
    addCodes(manifestCodes, built.entry.omissionCodes);
  }

  const after = await captureDiscovery(runner, indexPath, signal);
  if (captureIdentity(before) !== captureIdentity(after)) {
    throw new InspectGitChangesError(
      "WORKSPACE_DRIFT",
      "The Git workspace changed during inspection.",
    );
  }
  for (const entry of manifest) {
    if (!entry.newPath || !entry.working) continue;
    const expectedWorking = workingStates.get(entry.newPath);
    if (!expectedWorking || entry.working.mode === "160000") continue;
    const wasTotalLimited = expectedWorking.omissionCodes.includes("total_byte_limit");
    const current = await readWorkingTreeSide({
      canonicalRoot,
      relativePath: entry.newPath,
      remainingAdmissionBytes: wasTotalLimited ? 0 : MAX_CHANGE_SOURCE_BYTES_PER_SIDE,
      signal,
    });
    if (
      current.identity.mode !== expectedWorking.identity.mode ||
      current.identity.sizeBytes !== expectedWorking.identity.sizeBytes ||
      current.identity.admittedContentSha256 !==
        expectedWorking.identity.admittedContentSha256 ||
      current.filesystemFingerprint !== expectedWorking.filesystemFingerprint ||
      JSON.stringify(current.omissionCodes) !==
        JSON.stringify(expectedWorking.omissionCodes)
    ) {
      throw new InspectGitChangesError(
        "WORKSPACE_DRIFT",
        "Changed working content drifted during inspection.",
      );
    }
  }

  const parsedIndex = discovery.index;
  const indexSha256 =
    parsedIndex.unsafePaths.length === 0
      ? sha256GitIndexStageEntries(parsedIndex.entries)
      : sha256(before.indexBytes);
  if (parsedIndex.unsafePaths.length > 0) {
    // The exact Git-emitted, NUL-delimited stage output remains the hash
    // preimage when a path cannot enter the safe decoded contract.
    // No decoded path is needed to retain this exact byte-level identity.
  }
  return buildBoundedResult(
    before.baseCommitOid,
    indexSha256,
    discoverySha256(before),
    manifest,
    omittedPathCount,
    omittedHunks,
    manifestCodes,
  );
}

export async function inspectGitChanges(
  input: InspectGitChangesInput,
  dependencies: InspectGitChangesDependencies = {},
): Promise<InspectGitChangesResultV1> {
  if (input.signal?.aborted) {
    throw new InspectGitChangesError("CANCELLED", "Change inspection was cancelled.");
  }
  const deadlineController = new AbortController();
  const timer = setTimeout(() => deadlineController.abort(), MAX_INSPECT_DURATION_MS);
  timer.unref();
  const signal = input.signal
    ? AbortSignal.any([input.signal, deadlineController.signal])
    : deadlineController.signal;
  try {
    return await inspectWithSignal(input, dependencies, signal);
  } catch (error) {
    if (deadlineController.signal.aborted && !input.signal?.aborted) {
      throw new InspectGitChangesError(
        "GIT_INSPECTION_FAILED",
        "Change inspection exceeded its overall deadline.",
      );
    }
    if (input.signal?.aborted || (error instanceof GitProcessError && error.code === "CANCELLED")) {
      throw new InspectGitChangesError("CANCELLED", "Change inspection was cancelled.");
    }
    if (error instanceof InspectGitChangesError) throw error;
    if (error instanceof GitProcessError && error.code === "UNSAFE_INDEX_VISIBILITY") {
      throw new InspectGitChangesError(
        "INVALID_REPOSITORY_STATE",
        "Git index visibility flags prevent complete change inspection.",
      );
    }
    if (error instanceof GitProcessError) {
      throw new InspectGitChangesError(
        "GIT_INSPECTION_FAILED",
        "The bounded Git inspection could not complete.",
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyChangeSnapshot(input: {
  workspaceRoot: string;
  snapshot: ChangeSnapshotV1;
  signal?: AbortSignal;
}): Promise<boolean> {
  const expected = assertChangeSnapshotIdentity(input.snapshot);
  if (
    expected.omittedPathCount > 0 ||
    expected.omittedHunkCount > 0 ||
    expected.manifestOmissionCodes.length > 0 ||
    expected.manifest.some((entry) => entry.omissionCodes.length > 0)
  ) {
    // Omitted content is intentionally not hashed/read in full. It can never
    // satisfy an acceptance-time freshness proof, even when visible metadata
    // happens to be unchanged.
    return false;
  }
  const current = await inspectGitChanges({
    workspaceRoot: input.workspaceRoot,
    request: { schemaVersion: "inspect-git-changes-v1" },
    signal: input.signal,
  });
  return current.snapshot.snapshotId === expected.snapshotId;
}
