import type { JsonValue } from "./session-events";

type SuccessfulRepositoryToolOutput = Record<string, unknown> & {
  ok: true;
  truncated: boolean;
};

function asJsonRecord(
  value: JsonValue,
): Record<string, JsonValue> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

function asUnknownRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function hasOnlyKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(record).every((key) => allowed.has(key));
}

function validOptionalPath(
  value: unknown,
  allowRoot: boolean,
): boolean {
  if (value === undefined) return true;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 4_096 &&
    normalizedWorkspacePath(trimmed, allowRoot) !== undefined
  );
}

function validOptionalInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): boolean {
  return (
    value === undefined ||
    (typeof value === "number" &&
      Number.isInteger(value) &&
      value >= minimum &&
      value <= maximum)
  );
}

function validRepositoryToolArguments(
  toolName: string,
  arguments_: JsonValue,
): boolean {
  const record = asJsonRecord(arguments_);
  if (!record) return false;

  if (toolName === "read_text_file") {
    return (
      hasOnlyKeys(record, ["relativePath"]) &&
      Object.prototype.hasOwnProperty.call(record, "relativePath") &&
      validOptionalPath(record.relativePath, false)
    );
  }
  if (toolName === "list_files") {
    return (
      hasOnlyKeys(record, [
        "relativePath",
        "recursive",
        "maxDepth",
        "maxItems",
      ]) &&
      validOptionalPath(record.relativePath, true) &&
      (record.recursive === undefined || typeof record.recursive === "boolean") &&
      validOptionalInteger(record.maxDepth, 1, 12) &&
      validOptionalInteger(record.maxItems, 1, 1_000)
    );
  }
  if (toolName === "search_text") {
    return (
      hasOnlyKeys(record, [
        "query",
        "relativePath",
        "caseSensitive",
        "maxDepth",
        "maxMatches",
      ]) &&
      typeof record.query === "string" &&
      record.query.length >= 1 &&
      record.query.length <= 512 &&
      validOptionalPath(record.relativePath, true) &&
      (record.caseSensitive === undefined ||
        typeof record.caseSensitive === "boolean") &&
      validOptionalInteger(record.maxDepth, 1, 20) &&
      validOptionalInteger(record.maxMatches, 1, 500)
    );
  }
  return false;
}

function validListEntry(value: unknown): boolean {
  const entry = asUnknownRecord(value);
  return (
    typeof entry?.path === "string" &&
    normalizedWorkspacePath(entry.path, false) !== undefined &&
    (entry.type === "file" ||
      entry.type === "directory" ||
      entry.type === "symlink") &&
    (entry.size === undefined || isSafeNonNegativeInteger(entry.size))
  );
}

function validSearchMatch(value: unknown): boolean {
  const match = asUnknownRecord(value);
  return (
    typeof match?.path === "string" &&
    normalizedWorkspacePath(match.path, false) !== undefined &&
    typeof match.text === "string" &&
    typeof match.textTruncated === "boolean" &&
    typeof match.lineNumber === "number" &&
    Number.isSafeInteger(match.lineNumber) &&
    match.lineNumber > 0
  );
}

function validCounterRecord(
  value: unknown,
  keys: readonly string[],
): boolean {
  const record = asUnknownRecord(value);
  return (
    record !== undefined &&
    hasOnlyKeys(record, keys) &&
    keys.every((key) => isSafeNonNegativeInteger(record[key]))
  );
}

/**
 * Parse only gateway-schema-conformant successful outputs from the registered
 * repository tools. A generic `{ok:true}` envelope is not proof that a tool
 * completed, and this structural check is not cryptographic attestation.
 */
function parseSuccessfulRepositoryToolOutput(
  toolName: string,
  content: string | undefined,
): SuccessfulRepositoryToolOutput | undefined {
  if (!content) return undefined;
  let output: Record<string, unknown> | undefined;
  try {
    output = asUnknownRecord(JSON.parse(content) as unknown);
  } catch {
    return undefined;
  }
  if (output?.ok !== true || typeof output.truncated !== "boolean") {
    return undefined;
  }
  if (
    toolName === "list_files" &&
    Array.isArray(output.entries) &&
    output.entries.every(validListEntry) &&
    output.count === output.entries.length &&
    validCounterRecord(output.skipped, ["ignored", "unreadable"]) &&
    isSafeNonNegativeInteger(output.outputBytes)
  ) {
    return output as SuccessfulRepositoryToolOutput;
  }
  if (
    toolName === "search_text" &&
    Array.isArray(output.matches) &&
    output.matches.every(validSearchMatch) &&
    output.count === output.matches.length &&
    isSafeNonNegativeInteger(output.filesSearched) &&
    isSafeNonNegativeInteger(output.bytesScanned) &&
    validCounterRecord(output.skipped, [
      "binary",
      "ignored",
      "symlink",
      "tooLarge",
      "unreadable",
    ]) &&
    isSafeNonNegativeInteger(output.outputBytes)
  ) {
    return output as SuccessfulRepositoryToolOutput;
  }
  if (
    toolName === "read_text_file" &&
    typeof output.text === "string" &&
    isSafeNonNegativeInteger(output.bytes) &&
    output.bytes === new TextEncoder().encode(output.text).length &&
    output.truncated === false
  ) {
    return output as SuccessfulRepositoryToolOutput;
  }
  return undefined;
}

/** Validate the persisted request and response as one executable observation. */
export function parseSuccessfulRepositoryToolObservation(
  toolName: string,
  arguments_: JsonValue,
  content: string | undefined,
): SuccessfulRepositoryToolOutput | undefined {
  if (!validRepositoryToolArguments(toolName, arguments_)) return undefined;
  const output = parseSuccessfulRepositoryToolOutput(toolName, content);
  if (!output) return undefined;
  const request = asJsonRecord(arguments_);
  if (!request) return undefined;

  const requestedScope =
    typeof request.relativePath === "string"
      ? normalizedWorkspacePath(request.relativePath.trim(), true)
      : ".";
  const pathIsInRequestedScope = (rawPath: unknown): boolean => {
    if (typeof rawPath !== "string" || requestedScope === undefined) {
      return false;
    }
    const candidate = normalizedWorkspacePath(rawPath, false);
    return (
      candidate !== undefined &&
      (requestedScope === "." ||
        candidate === requestedScope ||
        candidate.startsWith(`${requestedScope}/`))
    );
  };

  if (toolName === "list_files") {
    return (output.entries as unknown[]).every((entry) =>
      pathIsInRequestedScope(asUnknownRecord(entry)?.path),
    )
      ? output
      : undefined;
  }
  if (toolName === "search_text") {
    const query = request.query as string;
    const caseSensitive = request.caseSensitive ?? true;
    const expectedNeedle = caseSensitive
      ? query
      : query.toLocaleLowerCase("en-US");
    const matches = output.matches as unknown[];
    const semanticallyValid = matches.every((value) => {
      const match = asUnknownRecord(value);
      if (!match || !pathIsInRequestedScope(match.path)) return false;
      const text = match.text as string;
      const haystack = caseSensitive
        ? text
        : text.toLocaleLowerCase("en-US");
      return haystack.includes(expectedNeedle);
    });
    if (
      !semanticallyValid ||
      (matches.length > 0 &&
        (output.filesSearched === 0 || output.bytesScanned === 0))
    ) {
      return undefined;
    }
  }
  return output;
}

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`,
    )
    .join(",")}}`;
}

function normalizedWorkspacePath(
  value: JsonValue | undefined,
  allowRoot: boolean,
): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  if (
    value.includes("\0") ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/u.test(value)
  ) {
    return undefined;
  }
  const segments = value.split(/[\\/]+/u);
  if (segments.includes("..")) return undefined;
  const normalized = segments
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");
  if (normalized.length > 0) return normalized;
  return allowRoot ? "." : undefined;
}

/**
 * Normalize provider tool arguments without changing their semantic scope.
 * Explicit default values and lexical path aliases compile to one canonical
 * representation for packet deduplication and runtime no-progress checks.
 */
export function normalizeToolArguments(
  toolName: string,
  arguments_: JsonValue,
): JsonValue {
  const record = asJsonRecord(arguments_);
  if (!record) return arguments_;
  const normalized: Record<string, JsonValue> = { ...record };
  const normalizedPath = normalizedWorkspacePath(
    normalized.relativePath,
    toolName !== "read_text_file",
  );
  if (normalizedPath !== undefined) {
    normalized.relativePath = normalizedPath;
  }

  const removeDefault = (name: string, defaultValue: JsonValue): void => {
    if (normalized[name] === defaultValue) delete normalized[name];
  };
  if (toolName === "search_text") {
    removeDefault("relativePath", ".");
    removeDefault("caseSensitive", true);
    removeDefault("maxMatches", 100);
    removeDefault("maxDepth", 12);
  } else if (toolName === "list_files") {
    removeDefault("relativePath", ".");
    removeDefault("recursive", true);
    removeDefault("maxItems", 400);
    removeDefault("maxDepth", 6);
  }
  return normalized;
}

export function workspaceRelativePathForTool(
  toolName: string,
  arguments_: JsonValue,
): string | undefined {
  const normalized = asJsonRecord(
    normalizeToolArguments(toolName, arguments_),
  );
  if (typeof normalized?.relativePath === "string") {
    return normalized.relativePath;
  }
  return toolName === "search_text" || toolName === "list_files"
    ? "."
    : undefined;
}

function sourceResultIsComplete(
  toolName: string,
  arguments_: JsonValue,
  content: string,
): boolean {
  return (
    parseSuccessfulRepositoryToolObservation(
      toolName,
      arguments_,
      content,
    )?.truncated === false
  );
}

/** Build the deterministic semantic key used by the no-progress guard. */
export function toolObservationScope(
  toolName: string,
  arguments_: JsonValue,
  content: string,
): string {
  const normalizedArguments = normalizeToolArguments(toolName, arguments_);
  const record = asJsonRecord(normalizedArguments);
  if (!record) return `${toolName}:${canonicalJson(normalizedArguments)}`;
  const complete = sourceResultIsComplete(toolName, arguments_, content);

  if (toolName === "read_text_file") {
    return canonicalJson({
      toolName,
      relativePath: record.relativePath ?? null,
    });
  }
  if (toolName === "search_text") {
    return canonicalJson({
      toolName,
      query: record.query ?? null,
      relativePath: record.relativePath ?? ".",
      caseSensitive: record.caseSensitive ?? true,
      ...(complete
        ? {}
        : {
            maxDepth: record.maxDepth ?? 12,
            maxMatches: record.maxMatches ?? 100,
          }),
    });
  }
  if (toolName === "list_files") {
    return canonicalJson({
      toolName,
      relativePath: record.relativePath ?? ".",
      recursive: record.recursive ?? true,
      ...(complete
        ? {}
        : {
            maxDepth: record.maxDepth ?? 6,
            maxItems: record.maxItems ?? 400,
          }),
    });
  }
  return `${toolName}:${canonicalJson(normalizedArguments)}`;
}
