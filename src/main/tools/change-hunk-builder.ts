import { structuredPatch } from "diff";

import { buildChangeHunkV1 } from "../change-acquisition-contracts";
import type {
  ChangeHunkLineV1,
  ChangeHunkV1,
  ChangeManifestOmissionCode,
} from "../../shared/change-review-contracts";
import { throwIfAborted } from "./workspace-policy";

export const CHANGE_DIFF_CONTEXT_LINES = 3;
export const MAX_CHANGE_DIFF_EDIT_LENGTH = 20_000;
export const MAX_CHANGE_DIFF_MILLISECONDS = 250;
export const MAX_CHANGE_HUNK_LINES = 160;
export const MAX_CHANGE_HUNK_BYTES = 12 * 1024;

interface SourceLine {
  content: string;
  terminator: "lf" | "crlf" | "cr" | "none";
}

export interface BuildTextHunksInput {
  oldPath: string | null;
  newPath: string | null;
  oldText: string;
  newText: string;
  maxHunks: number;
  signal?: AbortSignal;
}

export interface BuildTextHunksResult {
  hunks: ChangeHunkV1[];
  omittedHunkCount: number;
  omissionCodes: ChangeManifestOmissionCode[];
}

function splitSourceLines(text: string): SourceLine[] {
  if (text.length === 0) return [];
  const lines: SourceLine[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charCodeAt(index);
    if (character !== 0x0a && character !== 0x0d) continue;
    let terminator: SourceLine["terminator"];
    let end = index;
    if (character === 0x0d && text.charCodeAt(index + 1) === 0x0a) {
      terminator = "crlf";
      index += 1;
    } else {
      terminator = character === 0x0a ? "lf" : "cr";
    }
    lines.push({ content: text.slice(start, end), terminator });
    start = index + 1;
  }
  if (start < text.length) lines.push({ content: text.slice(start), terminator: "none" });
  return lines;
}

function encodeLines(lines: readonly SourceLine[]): string {
  // NUL is refused by text admission, so it is an unambiguous private marker.
  // Encoding terminators makes a CRLF/LF-only change visible to the diff engine.
  return lines.map((line) => `${line.content}\0${line.terminator}\n`).join("");
}

function lineAt(lines: readonly SourceLine[], line: number, side: string): SourceLine {
  const value = lines[line - 1];
  if (!value) throw new Error(`Diff engine produced an invalid ${side} line number.`);
  return value;
}

function addOmissionCode(
  codes: ChangeManifestOmissionCode[],
  code: ChangeManifestOmissionCode,
): void {
  if (!codes.includes(code)) codes.push(code);
}

export function buildTextHunks(input: BuildTextHunksInput): BuildTextHunksResult {
  throwIfAborted(input.signal);
  if (!Number.isSafeInteger(input.maxHunks) || input.maxHunks < 0) {
    throw new TypeError("maxHunks must be a non-negative safe integer.");
  }
  if (input.oldPath === null && input.newPath === null) {
    throw new TypeError("Text hunks require an old or new path.");
  }

  const oldLines = splitSourceLines(input.oldText);
  const newLines = splitSourceLines(input.newText);
  const patch = structuredPatch(
    input.oldPath ?? "/dev/null",
    input.newPath ?? "/dev/null",
    encodeLines(oldLines),
    encodeLines(newLines),
    undefined,
    undefined,
    {
      context: CHANGE_DIFF_CONTEXT_LINES,
      maxEditLength: MAX_CHANGE_DIFF_EDIT_LENGTH,
      timeout: MAX_CHANGE_DIFF_MILLISECONDS,
    },
  );
  throwIfAborted(input.signal);
  if (!patch) {
    return { hunks: [], omittedHunkCount: 1, omissionCodes: ["truncated"] };
  }

  const hunks: ChangeHunkV1[] = [];
  const omissionCodes: ChangeManifestOmissionCode[] = [];
  let omittedHunkCount = 0;
  for (const rawHunk of patch.hunks) {
    throwIfAborted(input.signal);
    if (hunks.length >= input.maxHunks) {
      omittedHunkCount += 1;
      addOmissionCode(omissionCodes, "hunk_count_limit");
      continue;
    }
    const lines: ChangeHunkLineV1[] = [];
    let oldLine = rawHunk.oldStart;
    let newLine = rawHunk.newStart;
    for (const rawLine of rawHunk.lines) {
      const prefix = rawLine[0];
      if (prefix === " ") {
        const source = lineAt(oldLines, oldLine, "old context");
        const other = lineAt(newLines, newLine, "new context");
        if (source.content !== other.content || source.terminator !== other.terminator) {
          throw new Error("Diff context did not match both source sides.");
        }
        lines.push({
          kind: "context",
          content: source.content,
          terminator: source.terminator,
          oldLine,
          newLine,
        });
        oldLine += 1;
        newLine += 1;
      } else if (prefix === "-") {
        const source = lineAt(oldLines, oldLine, "old deletion");
        lines.push({
          kind: "deletion",
          content: source.content,
          terminator: source.terminator,
          oldLine,
          newLine: null,
        });
        oldLine += 1;
      } else if (prefix === "+") {
        const source = lineAt(newLines, newLine, "new addition");
        lines.push({
          kind: "addition",
          content: source.content,
          terminator: source.terminator,
          oldLine: null,
          newLine,
        });
        newLine += 1;
      } else {
        throw new Error("Diff engine produced an unsupported hunk line.");
      }
    }

    if (
      lines.length > MAX_CHANGE_HUNK_LINES ||
      lines.some((line) => line.content.length > 65_536)
    ) {
      omittedHunkCount += 1;
      addOmissionCode(omissionCodes, "truncated");
      continue;
    }
    const hunk = buildChangeHunkV1({
      schemaVersion: "change-hunk-v1",
      oldPath: input.oldPath,
      newPath: input.newPath,
      oldStart: rawHunk.oldStart,
      oldLines: rawHunk.oldLines,
      newStart: rawHunk.newStart,
      newLines: rawHunk.newLines,
      lines,
    });
    if (Buffer.byteLength(JSON.stringify(hunk), "utf8") > MAX_CHANGE_HUNK_BYTES) {
      omittedHunkCount += 1;
      addOmissionCode(omissionCodes, "truncated");
      continue;
    }
    hunks.push(hunk);
  }
  omissionCodes.sort();
  return { hunks, omittedHunkCount, omissionCodes };
}
