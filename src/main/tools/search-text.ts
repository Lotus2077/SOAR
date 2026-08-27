import { constants as fsConstants } from "node:fs";
import { lstat, open, readdir, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import {
  isIgnoredRelativePath,
  isWithinRoot,
  resolveWorkspacePath,
  throwIfAborted,
  validatePositiveInteger,
  WorkspaceToolError,
} from "./workspace-policy";

export const DEFAULT_SEARCH_TEXT_MAX_MATCHES = 100;
export const MAX_SEARCH_TEXT_MATCHES = 500;
export const DEFAULT_SEARCH_TEXT_MAX_DEPTH = 12;
export const MAX_SEARCH_TEXT_DEPTH = 20;
export const DEFAULT_SEARCH_TEXT_FILE_BYTE_CAP = 1024 * 1024;
export const DEFAULT_SEARCH_TEXT_SCAN_BYTE_CAP = 16 * 1024 * 1024;
export const DEFAULT_SEARCH_TEXT_OUTPUT_BYTE_CAP = 64 * 1024;
export const MAX_SEARCH_TEXT_OUTPUT_BYTE_CAP = 128 * 1024;

const MAX_SEARCH_FILES = 5_000;
const MAX_QUERY_CHARACTERS = 512;
const MAX_MATCH_TEXT_BYTES = 1_024;

export interface SearchTextInput {
  workspaceRoot: string;
  query: string;
  relativePath?: string;
  caseSensitive?: boolean;
  maxMatches?: number;
  maxDepth?: number;
  outputByteCap?: number;
  fileByteCap?: number;
  scanByteCap?: number;
  signal?: AbortSignal;
}

export interface SearchTextMatch {
  path: string;
  lineNumber: number;
  text: string;
  textTruncated: boolean;
}

export type SearchTextTruncationReason =
  | "depth_limit"
  | "file_limit"
  | "match_limit"
  | "output_byte_limit"
  | "scan_byte_limit";

export interface SearchTextResult {
  matches: SearchTextMatch[];
  count: number;
  filesSearched: number;
  bytesScanned: number;
  skipped: {
    binary: number;
    ignored: number;
    symlink: number;
    tooLarge: number;
    unreadable: number;
  };
  truncated: boolean;
  truncation?: {
    reasons: SearchTextTruncationReason[];
    message: string;
  };
  outputBytes: number;
}

function compareNames(left: { name: string }, right: { name: string }): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function decodeText(buffer: Buffer): string | undefined {
  if (buffer.includes(0)) return undefined;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return undefined;
  }
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      codePoint < 0x20 &&
      character !== "\t" &&
      character !== "\n" &&
      character !== "\r" &&
      character !== "\f"
    ) {
      return undefined;
    }
  }
  return text;
}

function truncateMatchText(line: string, matchIndex: number): { text: string; textTruncated: boolean } {
  if (Buffer.byteLength(line, "utf8") <= MAX_MATCH_TEXT_BYTES) {
    return { text: line, textTruncated: false };
  }

  const start = Math.max(0, matchIndex - 180);
  const candidate = line.slice(start, start + 500);
  let text = start > 0 ? `…${candidate}` : candidate;
  const omittedEnd = start + candidate.length < line.length;
  if (omittedEnd) text += "…";

  while (Buffer.byteLength(text, "utf8") > MAX_MATCH_TEXT_BYTES && text.length > 1) {
    text = `${text.slice(0, Math.max(1, text.length - 32))}…`;
  }
  return { text, textTruncated: true };
}

async function readBoundedFile(
  absolutePath: string,
  byteCap: number,
  signal?: AbortSignal,
): Promise<Buffer | undefined> {
  let handle: FileHandle | undefined;
  try {
    throwIfAborted(signal);
    handle = await open(absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const fileStats = await handle.stat();
    if (!fileStats.isFile() || fileStats.size > byteCap) return undefined;

    const chunks: Buffer[] = [];
    let bytesRead = 0;
    while (bytesRead <= byteCap) {
      throwIfAborted(signal);
      const chunkSize = Math.min(64 * 1024, byteCap - bytesRead + 1);
      const chunk = Buffer.allocUnsafe(chunkSize);
      const result = await handle.read(chunk, 0, chunk.length, bytesRead);
      if (result.bytesRead === 0) break;
      chunks.push(chunk.subarray(0, result.bytesRead));
      bytesRead += result.bytesRead;
    }
    return bytesRead > byteCap ? undefined : Buffer.concat(chunks, bytesRead);
  } finally {
    await handle?.close();
  }
}

function truncationMessage(reasons: Set<SearchTextTruncationReason>): string {
  const descriptions: Record<SearchTextTruncationReason, string> = {
    depth_limit: "maximum traversal depth reached",
    file_limit: "maximum file count reached",
    match_limit: "maximum match count reached",
    output_byte_limit: "maximum output size reached",
    scan_byte_limit: "maximum scanned byte count reached",
  };
  return `Results were truncated: ${[...reasons].sort().map((reason) => descriptions[reason]).join(", ")}.`;
}

function buildResult(
  matches: SearchTextMatch[],
  filesSearched: number,
  bytesScanned: number,
  skipped: SearchTextResult["skipped"],
  reasons: Set<SearchTextTruncationReason>,
): SearchTextResult {
  const result: SearchTextResult = {
    matches,
    count: matches.length,
    filesSearched,
    bytesScanned,
    skipped,
    truncated: reasons.size > 0,
    ...(reasons.size > 0
      ? { truncation: { reasons: [...reasons].sort(), message: truncationMessage(reasons) } }
      : {}),
    outputBytes: 0,
  };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const measured = Buffer.byteLength(JSON.stringify(result), "utf8");
    if (measured === result.outputBytes) break;
    result.outputBytes = measured;
  }
  return result;
}

function fitToOutputLimit(
  matches: SearchTextMatch[],
  filesSearched: number,
  bytesScanned: number,
  skipped: SearchTextResult["skipped"],
  reasons: Set<SearchTextTruncationReason>,
  byteCap: number,
): SearchTextResult {
  let result = buildResult(matches, filesSearched, bytesScanned, skipped, reasons);
  while (result.outputBytes > byteCap && matches.length > 0) {
    matches.pop();
    reasons.add("output_byte_limit");
    result = buildResult(matches, filesSearched, bytesScanned, skipped, reasons);
  }
  if (result.outputBytes > byteCap) {
    throw new WorkspaceToolError(
      "INVALID_ARGUMENT",
      "outputByteCap is too small to contain search_text metadata.",
    );
  }
  return result;
}

/** Search literal text in a deterministic, bounded set of repository files. */
export async function searchText(input: SearchTextInput): Promise<SearchTextResult> {
  if (!input || typeof input !== "object") {
    throw new WorkspaceToolError("INVALID_ARGUMENT", "Tool input must be an object.");
  }
  if (typeof input.query !== "string" || input.query.length === 0 || input.query.length > MAX_QUERY_CHARACTERS) {
    throw new WorkspaceToolError(
      "INVALID_ARGUMENT",
      `query must contain between 1 and ${MAX_QUERY_CHARACTERS} characters.`,
    );
  }
  const caseSensitive = input.caseSensitive ?? true;
  if (typeof caseSensitive !== "boolean") {
    throw new WorkspaceToolError("INVALID_ARGUMENT", "caseSensitive must be a boolean.");
  }
  const maxMatches = validatePositiveInteger(
    input.maxMatches ?? DEFAULT_SEARCH_TEXT_MAX_MATCHES,
    "maxMatches",
    MAX_SEARCH_TEXT_MATCHES,
  );
  const maxDepth = validatePositiveInteger(
    input.maxDepth ?? DEFAULT_SEARCH_TEXT_MAX_DEPTH,
    "maxDepth",
    MAX_SEARCH_TEXT_DEPTH,
  );
  const outputByteCap = validatePositiveInteger(
    input.outputByteCap ?? DEFAULT_SEARCH_TEXT_OUTPUT_BYTE_CAP,
    "outputByteCap",
    MAX_SEARCH_TEXT_OUTPUT_BYTE_CAP,
    384,
  );
  const fileByteCap = validatePositiveInteger(
    input.fileByteCap ?? DEFAULT_SEARCH_TEXT_FILE_BYTE_CAP,
    "fileByteCap",
    DEFAULT_SEARCH_TEXT_FILE_BYTE_CAP,
    256,
  );
  const scanByteCap = validatePositiveInteger(
    input.scanByteCap ?? DEFAULT_SEARCH_TEXT_SCAN_BYTE_CAP,
    "scanByteCap",
    DEFAULT_SEARCH_TEXT_SCAN_BYTE_CAP,
    256,
  );

  const resolved = await resolveWorkspacePath(input.workspaceRoot, input.relativePath ?? ".", {
    signal: input.signal,
  });
  const targetStats = await lstat(resolved.lexicalTarget);
  if (
    !targetStats.isSymbolicLink() &&
    !targetStats.isFile() &&
    !targetStats.isDirectory()
  ) {
    throw new WorkspaceToolError("NOT_A_FILE", "The requested path is not a regular file or directory.");
  }

  const matches: SearchTextMatch[] = [];
  const skipped = { binary: 0, ignored: 0, symlink: 0, tooLarge: 0, unreadable: 0 };
  const reasons = new Set<SearchTextTruncationReason>();
  let filesSearched = 0;
  let bytesScanned = 0;
  let stop = false;
  const needle = caseSensitive ? input.query : input.query.toLocaleLowerCase("en-US");

  if (targetStats.isSymbolicLink()) {
    skipped.symlink += 1;
    return fitToOutputLimit(
      matches,
      filesSearched,
      bytesScanned,
      skipped,
      reasons,
      outputByteCap,
    );
  }

  const inspectFile = async (absolutePath: string, relativePath: string): Promise<void> => {
    throwIfAborted(input.signal);
    let fileStats;
    try {
      fileStats = await lstat(absolutePath);
    } catch {
      skipped.unreadable += 1;
      return;
    }
    if (fileStats.isSymbolicLink()) {
      skipped.symlink += 1;
      return;
    }
    if (!fileStats.isFile()) return;
    if (fileStats.size > fileByteCap) {
      skipped.tooLarge += 1;
      return;
    }
    if (bytesScanned + fileStats.size > scanByteCap) {
      reasons.add("scan_byte_limit");
      stop = true;
      return;
    }
    if (filesSearched >= MAX_SEARCH_FILES) {
      reasons.add("file_limit");
      stop = true;
      return;
    }

    let buffer: Buffer | undefined;
    try {
      buffer = await readBoundedFile(absolutePath, fileByteCap, input.signal);
    } catch (error) {
      if (error instanceof WorkspaceToolError) throw error;
      skipped.unreadable += 1;
      return;
    }
    if (buffer === undefined) {
      skipped.tooLarge += 1;
      return;
    }
    const text = decodeText(buffer);
    if (text === undefined) {
      skipped.binary += 1;
      return;
    }

    filesSearched += 1;
    bytesScanned += buffer.byteLength;
    const lines = text.split(/\r\n|\n|\r/u);
    for (let index = 0; index < lines.length; index += 1) {
      throwIfAborted(input.signal);
      const line = lines[index] ?? "";
      const haystack = caseSensitive ? line : line.toLocaleLowerCase("en-US");
      const matchIndex = haystack.indexOf(needle);
      if (matchIndex === -1) continue;
      if (matches.length >= maxMatches) {
        reasons.add("match_limit");
        stop = true;
        return;
      }
      matches.push({ path: relativePath, lineNumber: index + 1, ...truncateMatchText(line, matchIndex) });
    }
  };

  const walk = async (absoluteDirectory: string, relativeDirectory: string, depth: number): Promise<void> => {
    throwIfAborted(input.signal);
    let children;
    let canonicalDirectory: string;
    try {
      canonicalDirectory = await realpath(absoluteDirectory);
      if (!isWithinRoot(resolved.canonicalRoot, canonicalDirectory)) {
        skipped.unreadable += 1;
        return;
      }
      children = (await readdir(canonicalDirectory, { withFileTypes: true })).sort(compareNames);
    } catch {
      skipped.unreadable += 1;
      return;
    }

    for (const child of children) {
      if (stop) return;
      throwIfAborted(input.signal);
      const childRelative = relativeDirectory === "." ? child.name : `${relativeDirectory}/${child.name}`;
      if (
        isIgnoredRelativePath(
          childRelative,
          child.isDirectory() ? "directory" : "file",
        )
      ) {
        skipped.ignored += 1;
        continue;
      }
      if (child.isSymbolicLink()) {
        skipped.symlink += 1;
        continue;
      }
      if (child.isDirectory()) {
        const childDepth = depth + 1;
        if (childDepth < maxDepth) {
          await walk(path.join(canonicalDirectory, child.name), childRelative, childDepth);
        } else {
          reasons.add("depth_limit");
        }
        continue;
      }
      if (child.isFile()) {
        await inspectFile(path.join(canonicalDirectory, child.name), childRelative);
      }
    }
  };

  if (targetStats.isFile()) {
    await inspectFile(resolved.canonicalTarget, resolved.relativePath);
  } else {
    await walk(resolved.canonicalTarget, resolved.relativePath, 0);
  }
  throwIfAborted(input.signal);
  return fitToOutputLimit(
    matches,
    filesSearched,
    bytesScanned,
    skipped,
    reasons,
    outputByteCap,
  );
}
