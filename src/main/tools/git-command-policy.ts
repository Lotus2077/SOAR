import path from "node:path";

export const DEFAULT_GIT_EXECUTABLE = "/usr/bin/git";
export const DEFAULT_GIT_TIMEOUT_MS = 5_000;
export const GIT_CONFIG_PREFLIGHT_STDOUT_LIMIT_BYTES = 64 * 1024;
export const GIT_INDEX_COPY_LIMIT_BYTES = 16 * 1024 * 1024;
export const GIT_INDEX_VISIBILITY_STDOUT_LIMIT_BYTES = 4 * 1024 * 1024;
export const GIT_STDOUT_LIMIT_BYTES = 4 * 1024 * 1024;
export const GIT_STDERR_LIMIT_BYTES = 64 * 1024;
export const GIT_TERMINATION_GRACE_MS = 500;

const FULL_GIT_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export type GitCommandPolicyErrorCode =
  | "INVALID_ARGUMENT"
  | "INVALID_EXECUTABLE"
  | "INVALID_OBJECT_ID";

export class GitCommandPolicyError extends Error {
  readonly code: GitCommandPolicyErrorCode;

  constructor(code: GitCommandPolicyErrorCode, message: string) {
    super(message);
    this.name = "GitCommandPolicyError";
    this.code = code;
  }
}

export function requireAbsoluteGitExecutable(executable: string): string {
  if (
    typeof executable !== "string" ||
    executable.length === 0 ||
    executable.includes("\0") ||
    !path.isAbsolute(executable)
  ) {
    throw new GitCommandPolicyError(
      "INVALID_EXECUTABLE",
      "The Git executable must be an absolute path.",
    );
  }
  return executable;
}

export function requireAbsoluteGitWorkspace(cwd: string): string {
  if (
    typeof cwd !== "string" ||
    cwd.length === 0 ||
    cwd.includes("\0") ||
    !path.isAbsolute(cwd)
  ) {
    throw new GitCommandPolicyError(
      "INVALID_ARGUMENT",
      "The Git workspace must be an absolute path.",
    );
  }
  return cwd;
}

export function requireAbsoluteGitTemporaryParent(directory: string): string {
  if (
    typeof directory !== "string" ||
    directory.length === 0 ||
    directory.includes("\0") ||
    !path.isAbsolute(directory)
  ) {
    throw new GitCommandPolicyError(
      "INVALID_ARGUMENT",
      "The Git temporary-index parent must be an absolute path.",
    );
  }
  return directory;
}

export function requireGitTimeoutMs(timeoutMs: number): number {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new GitCommandPolicyError(
      "INVALID_ARGUMENT",
      "The Git timeout must be a positive safe integer.",
    );
  }
  return timeoutMs;
}

export function isFullGitObjectId(value: string): boolean {
  return FULL_GIT_OBJECT_ID_PATTERN.test(value);
}

export function requireFullGitObjectId(value: string): string {
  if (!isFullGitObjectId(value)) {
    throw new GitCommandPolicyError(
      "INVALID_OBJECT_ID",
      "A full lowercase Git object ID is required.",
    );
  }
  return value;
}

/**
 * Intentionally does not inherit `process.env`. In particular, no caller-owned
 * Git configuration, executable hooks, transports, proxies, or SSH settings
 * cross this process boundary.
 */
export function createIsolatedGitEnvironment(): Readonly<NodeJS.ProcessEnv> {
  return Object.freeze({
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
}
