import {
  ChangePathSchema,
  GitObjectIdSchema,
  type ChangeKind,
} from "../../shared/change-review-contracts";

const decoder = new TextDecoder("utf-8", { fatal: true });
const MODE_PATTERN = /^(?:000000|100644|100755|120000|160000)$/u;
const STATUS_OID_PATTERN = /^(?:0{40}|0{64}|[0-9a-f]{40}|[0-9a-f]{64})$/u;

export class GitChangeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitChangeParseError";
  }
}

export interface ParsedUnsafePath {
  recordKind: "status" | "index" | "raw" | "numstat";
  reason: "invalid_utf8" | "unsafe_path";
  rawSha256Input: Uint8Array;
}

export interface ParsedGitStatusEntry {
  recordKind: "ordinary" | "renamed" | "untracked";
  changeKind: ChangeKind;
  oldPath: string | null;
  newPath: string | null;
  staged: boolean;
  unstaged: boolean;
  headMode: string;
  indexMode: string;
  worktreeMode: string;
  headObjectId: string | null;
  indexObjectId: string | null;
  renameScore: number | null;
  /** Path named by the status record, including an index-only intermediate path. */
  statusPath: string;
  /** False only when a normalized untracked final side supplies no Git mode. */
  worktreeModeKnown: boolean;
}

export interface ParsedGitStatus {
  entries: ParsedGitStatusEntry[];
  unsafePaths: ParsedUnsafePath[];
  unsafeTrackedEntryCount: number;
  unsafeUntrackedEntryCount: number;
}

export interface ParsedGitIndexEntry {
  mode: "100644" | "100755" | "120000" | "160000";
  objectId: string;
  stage: 0 | 1 | 2 | 3;
  path: string;
}

export interface ParsedGitIndex {
  entries: ParsedGitIndexEntry[];
  unsafePaths: ParsedUnsafePath[];
}

export interface ParsedGitRawEntry {
  oldMode: string;
  newMode: string;
  oldObjectId: string | null;
  newObjectId: string | null;
  status: string;
  score: number | null;
  oldPath: string | null;
  newPath: string | null;
}

export interface ParsedGitRawDiff {
  entries: ParsedGitRawEntry[];
  unsafePaths: ParsedUnsafePath[];
  unsafeEntryCount: number;
}

export interface ParsedGitNumstatEntry {
  additions: number | null;
  deletions: number | null;
  oldPath: string | null;
  newPath: string | null;
}

export interface ParsedGitNumstat {
  entries: ParsedGitNumstatEntry[];
  unsafePaths: ParsedUnsafePath[];
  unsafeEntryCount: number;
}

function splitNul(input: Uint8Array): Uint8Array[] {
  const records: Uint8Array[] = [];
  let start = 0;
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] !== 0) continue;
    records.push(input.subarray(start, index));
    start = index + 1;
  }
  if (start !== input.length) {
    throw new GitChangeParseError("Git machine output was not NUL terminated.");
  }
  return records;
}

function decode(record: Uint8Array): string {
  try {
    return decoder.decode(record);
  } catch {
    throw new GitChangeParseError("Git output contained a non-UTF-8 metadata record.");
  }
}

function safePath(
  record: Uint8Array,
  recordKind: ParsedUnsafePath["recordKind"],
): { path: string } | { unsafe: ParsedUnsafePath } {
  let value: string;
  try {
    value = decoder.decode(record);
  } catch {
    return {
      unsafe: { recordKind, reason: "invalid_utf8", rawSha256Input: record },
    };
  }
  const result = ChangePathSchema.safeParse(value);
  return result.success
    ? { path: result.data }
    : {
        unsafe: { recordKind, reason: "unsafe_path", rawSha256Input: record },
      };
}

function expectMode(value: string, field: string): string {
  if (!MODE_PATTERN.test(value)) {
    throw new GitChangeParseError(`Git ${field} contained an unsupported file mode.`);
  }
  return value;
}

function objectIdOrNull(value: string, field: string): string | null {
  if (!STATUS_OID_PATTERN.test(value)) {
    throw new GitChangeParseError(`Git ${field} contained an invalid object ID.`);
  }
  return /^0+$/u.test(value) ? null : GitObjectIdSchema.parse(value);
}

function parseXy(xy: string): { staged: boolean; unstaged: boolean } {
  if (!/^[.MADRCUT?][.MADRCUT?]$/u.test(xy)) {
    throw new GitChangeParseError("Git status contained an unsupported XY state.");
  }
  return { staged: xy[0] !== ".", unstaged: xy[1] !== "." };
}

function kindFromStatus(
  xy: string,
  headMode: string,
  worktreeMode: string,
  renamed: boolean,
): ChangeKind {
  if (renamed || xy.includes("R") || xy.includes("C")) return "renamed";
  if (xy.includes("T") || (headMode !== "000000" && worktreeMode !== "000000" && headMode !== worktreeMode)) {
    return "type_changed";
  }
  if (headMode === "000000" || xy.includes("A")) return "added";
  if (worktreeMode === "000000" || xy.includes("D")) return "deleted";
  return "modified";
}

function parseStatusHeader(record: Uint8Array): {
  text: string;
  fields: string[];
  pathBytes: Uint8Array;
} {
  // Porcelain-v2 metadata is ASCII and has eight fixed space-separated fields
  // before the path. Work on bytes so an unsafe path does not poison metadata.
  let spaces = 0;
  let pathOffset = -1;
  const recordType = record[0];
  const requiredSpaces = recordType === 0x31 ? 8 : recordType === 0x32 ? 9 : -1;
  if (requiredSpaces < 0) {
    throw new GitChangeParseError("Git status contained an unsupported record type.");
  }
  for (let index = 0; index < record.length; index += 1) {
    if (record[index] === 0x20) {
      spaces += 1;
      if (spaces === requiredSpaces) {
        pathOffset = index + 1;
        break;
      }
    }
  }
  if (pathOffset < 0 || pathOffset >= record.length) {
    throw new GitChangeParseError("Git status record was incomplete.");
  }
  const text = decode(record.subarray(0, pathOffset - 1));
  return { text, fields: text.split(" "), pathBytes: record.subarray(pathOffset) };
}

export function parseGitStatusPorcelainV2(input: Uint8Array): ParsedGitStatus {
  const records = splitNul(input);
  const entries: ParsedGitStatusEntry[] = [];
  const unsafePaths: ParsedUnsafePath[] = [];
  let unsafeTrackedEntryCount = 0;
  let unsafeUntrackedEntryCount = 0;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length === 0) continue;
    if (record[0] === 0x3f) {
      if (record[1] !== 0x20 || record.length <= 2) {
        throw new GitChangeParseError("Git untracked status record was incomplete.");
      }
      const result = safePath(record.subarray(2), "status");
      if ("unsafe" in result) {
        unsafePaths.push(result.unsafe);
        unsafeUntrackedEntryCount += 1;
      } else {
        entries.push({
          recordKind: "untracked",
          changeKind: "untracked",
          oldPath: null,
          newPath: result.path,
          staged: false,
          unstaged: true,
          headMode: "000000",
          indexMode: "000000",
          worktreeMode: "100644",
          headObjectId: null,
          indexObjectId: null,
          renameScore: null,
          statusPath: result.path,
          worktreeModeKnown: false,
        });
      }
      continue;
    }
    if (record[0] === 0x21) {
      throw new GitChangeParseError("Git unexpectedly returned an ignored status record.");
    }
    if (record[0] === 0x75) {
      throw new GitChangeParseError("Unmerged Git index state is not reviewable.");
    }
    const { fields, pathBytes } = parseStatusHeader(record);
    const isRename = fields[0] === "2";
    if ((!isRename && fields.length !== 8) || (isRename && fields.length !== 9)) {
      throw new GitChangeParseError("Git status record had the wrong field count.");
    }
    const xy = fields[1] ?? "";
    const { staged, unstaged } = parseXy(xy);
    const headMode = expectMode(fields[3] ?? "", "status head mode");
    const indexMode = expectMode(fields[4] ?? "", "status index mode");
    const worktreeMode = expectMode(fields[5] ?? "", "status worktree mode");
    const headObjectId = objectIdOrNull(fields[6] ?? "", "status head");
    const indexObjectId = objectIdOrNull(fields[7] ?? "", "status index");
    const newResult = safePath(pathBytes, "status");
    let oldResult: ReturnType<typeof safePath> | undefined;
    let renameScore: number | null = null;
    if (isRename) {
      const score = fields[8] ?? "";
      if (!/^[RC][0-9]{1,3}$/u.test(score)) {
        throw new GitChangeParseError("Git rename status contained an invalid score.");
      }
      renameScore = Number(score.slice(1));
      const oldPathRecord = records[index + 1];
      if (!oldPathRecord) throw new GitChangeParseError("Git rename status omitted its old path.");
      index += 1;
      oldResult = safePath(oldPathRecord, "status");
    }
    if ("unsafe" in newResult || (oldResult && "unsafe" in oldResult)) {
      if ("unsafe" in newResult) unsafePaths.push(newResult.unsafe);
      if (oldResult && "unsafe" in oldResult) unsafePaths.push(oldResult.unsafe);
      unsafeTrackedEntryCount += 1;
      continue;
    }
    entries.push({
      recordKind: isRename ? "renamed" : "ordinary",
      changeKind: kindFromStatus(xy, headMode, worktreeMode, isRename),
      oldPath: headMode === "000000" ? null : isRename ? oldResult!.path : newResult.path,
      newPath: worktreeMode === "000000" ? null : newResult.path,
      staged,
      unstaged,
      headMode,
      indexMode,
      worktreeMode,
      headObjectId,
      indexObjectId,
      renameScore,
      statusPath: newResult.path,
      worktreeModeKnown: true,
    });
  }
  return {
    entries,
    unsafePaths,
    unsafeTrackedEntryCount,
    unsafeUntrackedEntryCount,
  };
}

export function parseGitIndexStage(input: Uint8Array): ParsedGitIndex {
  const records = splitNul(input);
  const entries: ParsedGitIndexEntry[] = [];
  const unsafePaths: ParsedUnsafePath[] = [];
  for (const record of records) {
    if (record.length === 0) continue;
    const tab = record.indexOf(0x09);
    if (tab <= 0 || tab === record.length - 1) {
      throw new GitChangeParseError("Git index record was incomplete.");
    }
    const metadata = decode(record.subarray(0, tab)).split(" ");
    if (metadata.length !== 3) throw new GitChangeParseError("Git index record had the wrong field count.");
    const mode = metadata[0];
    if (mode !== "100644" && mode !== "100755" && mode !== "120000" && mode !== "160000") {
      throw new GitChangeParseError("Git index contained an unsupported mode.");
    }
    const objectId = GitObjectIdSchema.parse(metadata[1]);
    const stage = Number(metadata[2]);
    if (stage !== 0 && stage !== 1 && stage !== 2 && stage !== 3) {
      throw new GitChangeParseError("Git index contained an invalid stage.");
    }
    const pathResult = safePath(record.subarray(tab + 1), "index");
    if ("unsafe" in pathResult) unsafePaths.push(pathResult.unsafe);
    else entries.push({ mode, objectId, stage, path: pathResult.path });
  }
  return { entries, unsafePaths };
}

function parseRawHeader(record: Uint8Array): {
  oldMode: string;
  newMode: string;
  oldObjectId: string | null;
  newObjectId: string | null;
  status: string;
  score: number | null;
} {
  const fields = decode(record).split(" ");
  if (fields.length !== 5 || !fields[0]?.startsWith(":")) {
    throw new GitChangeParseError("Git raw diff record had the wrong field count.");
  }
  const status = fields[4] ?? "";
  if (!/^[MADTURC][0-9]{0,3}$/u.test(status)) {
    throw new GitChangeParseError("Git raw diff contained an unsupported status.");
  }
  return {
    oldMode: expectMode(fields[0].slice(1), "raw old mode"),
    newMode: expectMode(fields[1] ?? "", "raw new mode"),
    oldObjectId: objectIdOrNull(fields[2] ?? "", "raw old object"),
    newObjectId: objectIdOrNull(fields[3] ?? "", "raw new object"),
    status: status[0] ?? "",
    score: status.length > 1 ? Number(status.slice(1)) : null,
  };
}

export function parseGitRawDiff(input: Uint8Array): ParsedGitRawDiff {
  const records = splitNul(input);
  const entries: ParsedGitRawEntry[] = [];
  const unsafePaths: ParsedUnsafePath[] = [];
  let unsafeEntryCount = 0;
  for (let index = 0; index < records.length; index += 1) {
    const headerRecord = records[index];
    if (!headerRecord || headerRecord.length === 0) continue;
    const header = parseRawHeader(headerRecord);
    const firstPath = records[index + 1];
    if (!firstPath) throw new GitChangeParseError("Git raw diff omitted a path.");
    index += 1;
    const first = safePath(firstPath, "raw");
    const isPair = header.status === "R" || header.status === "C";
    let second: ReturnType<typeof safePath> | undefined;
    if (isPair) {
      const secondPath = records[index + 1];
      if (!secondPath) throw new GitChangeParseError("Git raw rename omitted its new path.");
      index += 1;
      second = safePath(secondPath, "raw");
    }
    if ("unsafe" in first || (second && "unsafe" in second)) {
      if ("unsafe" in first) unsafePaths.push(first.unsafe);
      if (second && "unsafe" in second) unsafePaths.push(second.unsafe);
      unsafeEntryCount += 1;
      continue;
    }
    const oldPath = header.oldMode === "000000" ? null : first.path;
    const newPath = header.newMode === "000000" ? null : isPair ? second!.path : first.path;
    entries.push({ ...header, oldPath, newPath });
  }
  return { entries, unsafePaths, unsafeEntryCount };
}

function parseCount(value: string): number | null {
  if (value === "-") return null;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new GitChangeParseError("Git numstat contained an invalid line count.");
  }
  const count = Number(value);
  if (!Number.isSafeInteger(count)) throw new GitChangeParseError("Git numstat line count overflowed.");
  return count;
}

export function parseGitNumstat(input: Uint8Array): ParsedGitNumstat {
  const records = splitNul(input);
  const entries: ParsedGitNumstatEntry[] = [];
  const unsafePaths: ParsedUnsafePath[] = [];
  let unsafeEntryCount = 0;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length === 0) continue;
    const firstTab = record.indexOf(0x09);
    const secondTab = firstTab < 0 ? -1 : record.indexOf(0x09, firstTab + 1);
    if (firstTab <= 0 || secondTab <= firstTab) {
      throw new GitChangeParseError("Git numstat record was incomplete.");
    }
    const additions = parseCount(decode(record.subarray(0, firstTab)));
    const deletions = parseCount(decode(record.subarray(firstTab + 1, secondTab)));
    const inlinePath = record.subarray(secondTab + 1);
    if (inlinePath.length > 0) {
      const result = safePath(inlinePath, "numstat");
      if ("unsafe" in result) {
        unsafePaths.push(result.unsafe);
        unsafeEntryCount += 1;
      } else {
        entries.push({
          additions,
          deletions,
          oldPath: result.path,
          newPath: result.path,
        });
      }
      continue;
    }
    const oldRecord = records[index + 1];
    const newRecord = records[index + 2];
    if (!oldRecord || !newRecord) throw new GitChangeParseError("Git numstat rename omitted paths.");
    index += 2;
    const oldResult = safePath(oldRecord, "numstat");
    const newResult = safePath(newRecord, "numstat");
    if ("unsafe" in oldResult || "unsafe" in newResult) {
      if ("unsafe" in oldResult) unsafePaths.push(oldResult.unsafe);
      if ("unsafe" in newResult) unsafePaths.push(newResult.unsafe);
      unsafeEntryCount += 1;
    } else {
      entries.push({ additions, deletions, oldPath: oldResult.path, newPath: newResult.path });
    }
  }
  return { entries, unsafePaths, unsafeEntryCount };
}
