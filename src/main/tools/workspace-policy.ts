import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export type WorkspaceToolErrorCode =
  | "INVALID_ARGUMENT"
  | "ABSOLUTE_PATH"
  | "PATH_TRAVERSAL"
  | "PATH_OUTSIDE_WORKSPACE"
  | "PATH_IGNORED"
  | "WORKSPACE_NOT_FOUND"
  | "TARGET_NOT_FOUND"
  | "NOT_A_FILE"
  | "NOT_A_DIRECTORY"
  | "FILE_TOO_LARGE"
  | "BINARY_FILE"
  | "CANCELLED"
  | "READ_FAILED";

export class WorkspaceToolError extends Error {
  readonly code: WorkspaceToolErrorCode;

  constructor(code: WorkspaceToolErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkspaceToolError";
    this.code = code;
  }
}

const IGNORED_DIRECTORY_NAMES = new Set([
  ".aws",
  ".azure",
  ".cache",
  ".git",
  ".gnupg",
  ".hg",
  ".kube",
  ".next",
  ".nuxt",
  ".pnpm-store",
  ".ssh",
  ".svn",
  ".turbo",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
  "venv",
]);

const SENSITIVE_FILE_NAMES = new Set([
  ".netrc",
  ".npmrc",
  ".pypirc",
  "credentials.json",
  "id_dsa",
  "id_ed25519",
  "id_ecdsa",
  "id_rsa",
  "secrets.json",
]);

const SENSITIVE_FILE_EXTENSIONS = new Set([".key", ".p12", ".pem", ".pfx"]);

const IGNORED_RELATIVE_PATH_PREFIXES = ["benchmarks/cache", "benchmarks/runs"];

export interface ResolvedWorkspacePath {
  canonicalRoot: string;
  lexicalTarget: string;
  canonicalTarget: string;
  relativePath: string;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

export function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

export function normalizeWorkspaceRelativePath(relativePath: string, allowRoot = true): string {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new WorkspaceToolError("INVALID_ARGUMENT", "relativePath must be a non-empty string.");
  }
  if (relativePath.includes("\0")) {
    throw new WorkspaceToolError("INVALID_ARGUMENT", "relativePath cannot contain a null byte.");
  }
  if (path.posix.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    throw new WorkspaceToolError("ABSOLUTE_PATH", "Only workspace-relative paths are allowed.");
  }

  const segments = relativePath.split(/[\\/]+/u);
  if (segments.includes("..")) {
    throw new WorkspaceToolError("PATH_TRAVERSAL", "Parent-directory traversal is not allowed.");
  }

  const normalized = segments.filter((segment) => segment !== "" && segment !== ".").join("/");
  if (normalized === "") {
    if (allowRoot) return ".";
    throw new WorkspaceToolError("INVALID_ARGUMENT", "relativePath must identify a file.");
  }
  return normalized;
}

export function isIgnoredDirectoryName(name: string): boolean {
  return IGNORED_DIRECTORY_NAMES.has(name.toLowerCase());
}

export function isSensitiveFileName(name: string): boolean {
  const lowerName = name.toLowerCase();
  return (
    lowerName === ".env" ||
    lowerName.startsWith(".env.") ||
    SENSITIVE_FILE_NAMES.has(lowerName) ||
    SENSITIVE_FILE_EXTENSIONS.has(path.posix.extname(lowerName))
  );
}

export function isIgnoredRelativePath(relativePath: string, kind?: "file" | "directory"): boolean {
  if (relativePath === ".") return false;
  const lowerPath = relativePath.toLowerCase();
  if (
    IGNORED_RELATIVE_PATH_PREFIXES.some(
      (prefix) => lowerPath === prefix || lowerPath.startsWith(`${prefix}/`),
    )
  ) {
    return true;
  }
  const segments = relativePath.split("/");
  if (segments.some((segment) => isIgnoredDirectoryName(segment))) return true;
  return kind !== "directory" && isSensitiveFileName(segments.at(-1) ?? "");
}

export function assertPathAllowed(relativePath: string, kind?: "file" | "directory"): void {
  if (isIgnoredRelativePath(relativePath, kind)) {
    throw new WorkspaceToolError(
      "PATH_IGNORED",
      "The requested path is excluded by the repository safety policy.",
    );
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new WorkspaceToolError("CANCELLED", "Tool execution was cancelled.");
  }
}

export async function resolveWorkspacePath(
  workspaceRoot: string,
  relativePath: string,
  options: { allowRoot?: boolean; signal?: AbortSignal } = {},
): Promise<ResolvedWorkspacePath> {
  throwIfAborted(options.signal);
  if (typeof workspaceRoot !== "string" || workspaceRoot.trim() === "") {
    throw new WorkspaceToolError("INVALID_ARGUMENT", "workspaceRoot must be a non-empty string.");
  }

  const normalized = normalizeWorkspaceRelativePath(relativePath, options.allowRoot ?? true);
  assertPathAllowed(normalized);

  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(path.resolve(workspaceRoot));
    if (!(await stat(canonicalRoot)).isDirectory()) {
      throw new WorkspaceToolError("WORKSPACE_NOT_FOUND", "workspaceRoot must resolve to a directory.");
    }
  } catch (error) {
    if (error instanceof WorkspaceToolError) throw error;
    if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      throw new WorkspaceToolError("WORKSPACE_NOT_FOUND", "The workspace root does not exist.", {
        cause: error,
      });
    }
    throw new WorkspaceToolError("READ_FAILED", "The workspace root could not be inspected.", {
      cause: error,
    });
  }

  const lexicalTarget =
    normalized === "." ? canonicalRoot : path.join(canonicalRoot, ...normalized.split("/"));
  if (!isWithinRoot(canonicalRoot, lexicalTarget)) {
    throw new WorkspaceToolError("PATH_OUTSIDE_WORKSPACE", "The requested path is outside the workspace.");
  }

  let canonicalTarget: string;
  try {
    canonicalTarget = await realpath(lexicalTarget);
  } catch (error) {
    if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      throw new WorkspaceToolError("TARGET_NOT_FOUND", "The requested path does not exist.", {
        cause: error,
      });
    }
    if (isNodeError(error) && error.code === "ELOOP") {
      throw new WorkspaceToolError(
        "PATH_OUTSIDE_WORKSPACE",
        "The requested path contains an unsafe symbolic link.",
        { cause: error },
      );
    }
    throw new WorkspaceToolError("READ_FAILED", "The requested path could not be resolved.", {
      cause: error,
    });
  }

  if (!isWithinRoot(canonicalRoot, canonicalTarget)) {
    throw new WorkspaceToolError("PATH_OUTSIDE_WORKSPACE", "Symbolic links cannot escape the workspace.");
  }

  const canonicalRelative = toPosixPath(path.relative(canonicalRoot, canonicalTarget)) || ".";
  assertPathAllowed(canonicalRelative);
  throwIfAborted(options.signal);
  return { canonicalRoot, lexicalTarget, canonicalTarget, relativePath: normalized };
}

export function validatePositiveInteger(
  value: number,
  name: string,
  maximum: number,
  minimum = 1,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new WorkspaceToolError(
      "INVALID_ARGUMENT",
      `${name} must be a safe integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}
