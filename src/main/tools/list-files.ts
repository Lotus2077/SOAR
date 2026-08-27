import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import {
  isIgnoredRelativePath,
  isWithinRoot,
  resolveWorkspacePath,
  throwIfAborted,
  validatePositiveInteger,
  WorkspaceToolError,
} from "./workspace-policy";

export const DEFAULT_LIST_FILES_MAX_ITEMS = 400;
export const MAX_LIST_FILES_ITEMS = 1_000;
export const DEFAULT_LIST_FILES_MAX_DEPTH = 6;
export const MAX_LIST_FILES_DEPTH = 12;
export const DEFAULT_LIST_FILES_OUTPUT_BYTE_CAP = 64 * 1024;
export const MAX_LIST_FILES_OUTPUT_BYTE_CAP = 128 * 1024;

export interface ListFilesInput {
  workspaceRoot: string;
  relativePath?: string;
  recursive?: boolean;
  maxDepth?: number;
  maxItems?: number;
  outputByteCap?: number;
  signal?: AbortSignal;
}

export interface ListedRepositoryEntry {
  path: string;
  type: "directory" | "file" | "symlink";
  size?: number;
}

export type ListFilesTruncationReason = "depth_limit" | "item_limit" | "output_byte_limit";

export interface ListFilesResult {
  entries: ListedRepositoryEntry[];
  count: number;
  skipped: {
    ignored: number;
    unreadable: number;
  };
  truncated: boolean;
  truncation?: {
    reasons: ListFilesTruncationReason[];
    message: string;
  };
  outputBytes: number;
}

function compareNames(left: { name: string }, right: { name: string }): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function truncationMessage(reasons: Set<ListFilesTruncationReason>): string {
  const descriptions: Record<ListFilesTruncationReason, string> = {
    depth_limit: "maximum traversal depth reached",
    item_limit: "maximum item count reached",
    output_byte_limit: "maximum output size reached",
  };
  return `Results were truncated: ${[...reasons].sort().map((reason) => descriptions[reason]).join(", ")}.`;
}

function buildResult(
  entries: ListedRepositoryEntry[],
  skipped: ListFilesResult["skipped"],
  reasons: Set<ListFilesTruncationReason>,
): ListFilesResult {
  const result: ListFilesResult = {
    entries,
    count: entries.length,
    skipped,
    truncated: reasons.size > 0,
    ...(reasons.size > 0
      ? { truncation: { reasons: [...reasons].sort(), message: truncationMessage(reasons) } }
      : {}),
    outputBytes: 0,
  };
  // outputBytes affects its own digit count, so settle it before returning.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const measured = Buffer.byteLength(JSON.stringify(result), "utf8");
    if (measured === result.outputBytes) break;
    result.outputBytes = measured;
  }
  return result;
}

function fitToOutputLimit(
  entries: ListedRepositoryEntry[],
  skipped: ListFilesResult["skipped"],
  reasons: Set<ListFilesTruncationReason>,
  byteCap: number,
): ListFilesResult {
  let result = buildResult(entries, skipped, reasons);
  while (result.outputBytes > byteCap && entries.length > 0) {
    entries.pop();
    reasons.add("output_byte_limit");
    result = buildResult(entries, skipped, reasons);
  }
  if (result.outputBytes > byteCap) {
    throw new WorkspaceToolError(
      "INVALID_ARGUMENT",
      "outputByteCap is too small to contain list_files metadata.",
    );
  }
  return result;
}

/**
 * Return a deterministic, bounded view of a repository subtree.
 *
 * Directory symlinks are reported but never followed. Heavy build/dependency
 * directories and likely credential files are omitted from recursive output.
 */
export async function listFiles(input: ListFilesInput): Promise<ListFilesResult> {
  if (!input || typeof input !== "object") {
    throw new WorkspaceToolError("INVALID_ARGUMENT", "Tool input must be an object.");
  }

  const maxItems = validatePositiveInteger(
    input.maxItems ?? DEFAULT_LIST_FILES_MAX_ITEMS,
    "maxItems",
    MAX_LIST_FILES_ITEMS,
  );
  const maxDepth = validatePositiveInteger(
    input.maxDepth ?? DEFAULT_LIST_FILES_MAX_DEPTH,
    "maxDepth",
    MAX_LIST_FILES_DEPTH,
    1,
  );
  const outputByteCap = validatePositiveInteger(
    input.outputByteCap ?? DEFAULT_LIST_FILES_OUTPUT_BYTE_CAP,
    "outputByteCap",
    MAX_LIST_FILES_OUTPUT_BYTE_CAP,
    256,
  );
  const recursive = input.recursive ?? true;
  if (typeof recursive !== "boolean") {
    throw new WorkspaceToolError("INVALID_ARGUMENT", "recursive must be a boolean.");
  }

  const resolved = await resolveWorkspacePath(input.workspaceRoot, input.relativePath ?? ".", {
    signal: input.signal,
  });
  const targetStats = await lstat(resolved.lexicalTarget);
  const entries: ListedRepositoryEntry[] = [];
  const skipped = { ignored: 0, unreadable: 0 };
  const reasons = new Set<ListFilesTruncationReason>();

  if (targetStats.isSymbolicLink()) {
    entries.push({ path: resolved.relativePath, type: "symlink" });
    return fitToOutputLimit(entries, skipped, reasons, outputByteCap);
  }
  if (targetStats.isFile()) {
    entries.push({ path: resolved.relativePath, type: "file", size: targetStats.size });
    return fitToOutputLimit(entries, skipped, reasons, outputByteCap);
  }
  if (!targetStats.isDirectory()) {
    throw new WorkspaceToolError("NOT_A_DIRECTORY", "The requested path is not a file or directory.");
  }

  let itemLimitReached = false;
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
      throwIfAborted(input.signal);
      if (entries.length >= maxItems) {
        reasons.add("item_limit");
        itemLimitReached = true;
        return;
      }

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

      const childAbsolute = path.join(canonicalDirectory, child.name);
      if (child.isSymbolicLink()) {
        entries.push({ path: childRelative, type: "symlink" });
        continue;
      }
      if (child.isDirectory()) {
        entries.push({ path: childRelative, type: "directory" });
        const childDepth = depth + 1;
        if (recursive && childDepth < maxDepth) {
          await walk(childAbsolute, childRelative, childDepth);
          if (itemLimitReached) return;
        } else if (recursive && childDepth >= maxDepth) {
          reasons.add("depth_limit");
        }
        continue;
      }
      if (child.isFile()) {
        try {
          const childStats = await lstat(childAbsolute);
          if (childStats.isSymbolicLink()) {
            entries.push({ path: childRelative, type: "symlink" });
            continue;
          }
          if (!childStats.isFile()) continue;
          entries.push({ path: childRelative, type: "file", size: childStats.size });
        } catch {
          skipped.unreadable += 1;
        }
      }
    }
  };

  await walk(resolved.canonicalTarget, resolved.relativePath, 0);
  throwIfAborted(input.signal);
  return fitToOutputLimit(entries, skipped, reasons, outputByteCap);
}
