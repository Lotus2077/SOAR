import { constants as fsConstants } from "node:fs";
import { open, realpath, stat, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import {
  assertPathAllowed,
  normalizeWorkspaceRelativePath,
  throwIfAborted,
  toPosixPath,
  WorkspaceToolError,
} from "./workspace-policy";

export const DEFAULT_READ_TEXT_FILE_BYTE_CAP = 256 * 1024;

export type ReadTextFileErrorCode =
  | "INVALID_ARGUMENT"
  | "ABSOLUTE_PATH"
  | "PATH_TRAVERSAL"
  | "PATH_OUTSIDE_WORKSPACE"
  | "PATH_IGNORED"
  | "WORKSPACE_NOT_FOUND"
  | "FILE_NOT_FOUND"
  | "NOT_A_FILE"
  | "FILE_TOO_LARGE"
  | "BINARY_FILE"
  | "CANCELLED"
  | "READ_FAILED";

export class ReadTextFileError extends Error {
  readonly code: ReadTextFileErrorCode;

  constructor(code: ReadTextFileErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReadTextFileError";
    this.code = code;
  }
}

export interface ReadTextFileInput {
  workspaceRoot: string;
  relativePath: string;
  byteCap?: number;
  signal?: AbortSignal;
}

export interface ReadTextFileResult {
  text: string;
  bytes: number;
  truncated: false;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function validateInput(input: ReadTextFileInput): number {
  if (!input || typeof input !== "object") {
    throw new ReadTextFileError("INVALID_ARGUMENT", "Tool input must be an object.");
  }

  if (typeof input.workspaceRoot !== "string" || input.workspaceRoot.trim() === "") {
    throw new ReadTextFileError("INVALID_ARGUMENT", "workspaceRoot must be a non-empty string.");
  }

  normalizeWorkspaceRelativePath(input.relativePath, false);
  assertPathAllowed(normalizeWorkspaceRelativePath(input.relativePath, false), "file");

  const byteCap = input.byteCap ?? DEFAULT_READ_TEXT_FILE_BYTE_CAP;
  if (!Number.isSafeInteger(byteCap) || byteCap <= 0) {
    throw new ReadTextFileError("INVALID_ARGUMENT", "byteCap must be a positive safe integer.");
  }

  return byteCap;
}

function decodeUtf8Text(buffer: Buffer): string {
  if (buffer.includes(0)) {
    throw new ReadTextFileError("BINARY_FILE", "Binary files cannot be read with read_text_file.");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    throw new ReadTextFileError("BINARY_FILE", "The file is not valid UTF-8 text.", { cause: error });
  }

  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && codePoint < 0x20 && character !== "\t" && character !== "\n" && character !== "\r" && character !== "\f") {
      throw new ReadTextFileError("BINARY_FILE", "Binary files cannot be read with read_text_file.");
    }
  }

  return text;
}

async function resolveWorkspaceRoot(workspaceRoot: string): Promise<string> {
  try {
    const canonicalRoot = await realpath(path.resolve(workspaceRoot));
    const rootStats = await stat(canonicalRoot);
    if (!rootStats.isDirectory()) {
      throw new ReadTextFileError("WORKSPACE_NOT_FOUND", "workspaceRoot must resolve to a directory.");
    }
    return canonicalRoot;
  } catch (error) {
    if (error instanceof ReadTextFileError || error instanceof WorkspaceToolError) {
      throw error;
    }
    if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      throw new ReadTextFileError("WORKSPACE_NOT_FOUND", "The workspace root does not exist.", { cause: error });
    }
    throw new ReadTextFileError("READ_FAILED", "The workspace root could not be inspected.", { cause: error });
  }
}

async function resolveTarget(canonicalRoot: string, relativePath: string): Promise<string> {
  const lexicalTarget = path.resolve(canonicalRoot, relativePath);
  if (!isWithinRoot(canonicalRoot, lexicalTarget)) {
    throw new ReadTextFileError("PATH_OUTSIDE_WORKSPACE", "The requested path is outside the workspace.");
  }

  let canonicalTarget: string;
  try {
    canonicalTarget = await realpath(lexicalTarget);
  } catch (error) {
    if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      throw new ReadTextFileError("FILE_NOT_FOUND", "The requested file does not exist.", { cause: error });
    }
    if (isNodeError(error) && error.code === "ELOOP") {
      throw new ReadTextFileError("PATH_OUTSIDE_WORKSPACE", "The requested path contains an unsafe symbolic link.", {
        cause: error,
      });
    }
    throw new ReadTextFileError("READ_FAILED", "The requested path could not be resolved.", { cause: error });
  }

  if (!isWithinRoot(canonicalRoot, canonicalTarget)) {
    throw new ReadTextFileError("PATH_OUTSIDE_WORKSPACE", "Symbolic links cannot escape the workspace.");
  }

  return canonicalTarget;
}

async function readBoundedFile(
  canonicalTarget: string,
  byteCap: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  let handle: FileHandle | undefined;
  try {
    throwIfAborted(signal);
    handle = await open(canonicalTarget, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const fileStats = await handle.stat();
    if (!fileStats.isFile()) {
      throw new ReadTextFileError("NOT_A_FILE", "The requested path is not a regular file.");
    }
    if (fileStats.size > byteCap) {
      throw new ReadTextFileError("FILE_TOO_LARGE", `The requested file exceeds the ${byteCap}-byte limit.`);
    }

    // Read at most one byte beyond the cap so a file that grows after stat() is
    // still rejected without ever being loaded unboundedly into memory.
    const chunks: Buffer[] = [];
    let bytesRead = 0;
    while (bytesRead <= byteCap) {
      throwIfAborted(signal);
      const chunkLength = Math.min(64 * 1024, byteCap - bytesRead + 1);
      const chunk = Buffer.allocUnsafe(chunkLength);
      const result = await handle.read(chunk, 0, chunk.length, bytesRead);
      if (result.bytesRead === 0) {
        break;
      }
      chunks.push(chunk.subarray(0, result.bytesRead));
      bytesRead += result.bytesRead;
    }

    if (bytesRead > byteCap) {
      throw new ReadTextFileError("FILE_TOO_LARGE", `The requested file exceeds the ${byteCap}-byte limit.`);
    }
    return Buffer.concat(chunks, bytesRead);
  } catch (error) {
    if (error instanceof ReadTextFileError || error instanceof WorkspaceToolError) {
      throw error;
    }
    if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      throw new ReadTextFileError("FILE_NOT_FOUND", "The requested file does not exist.", { cause: error });
    }
    if (isNodeError(error) && error.code === "ELOOP") {
      throw new ReadTextFileError("PATH_OUTSIDE_WORKSPACE", "The requested path changed to an unsafe symbolic link.", {
        cause: error,
      });
    }
    throw new ReadTextFileError("READ_FAILED", "The requested file could not be read.", { cause: error });
  } finally {
    await handle?.close();
  }
}

/**
 * Read one bounded UTF-8 text file from a workspace.
 *
 * Paths are checked both lexically and after resolving symbolic links. Files
 * larger than byteCap are rejected instead of partially returned so tool output
 * is never silently incomplete.
 */
export async function readTextFile(input: ReadTextFileInput): Promise<ReadTextFileResult> {
  const byteCap = validateInput(input);
  throwIfAborted(input.signal);
  const canonicalRoot = await resolveWorkspaceRoot(input.workspaceRoot);
  const canonicalTarget = await resolveTarget(canonicalRoot, input.relativePath);
  const canonicalRelative = toPosixPath(path.relative(canonicalRoot, canonicalTarget));
  assertPathAllowed(canonicalRelative, "file");
  const buffer = await readBoundedFile(canonicalTarget, byteCap, input.signal);
  throwIfAborted(input.signal);

  return {
    text: decodeUtf8Text(buffer),
    bytes: buffer.byteLength,
    truncated: false,
  };
}
