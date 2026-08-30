import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";

export const HELD_OUT_REVIEW_AGGREGATE_FILE_NAME = "aggregate.json" as const;
export const HELD_OUT_REVIEW_COMPLETION_MARKER_FILE_NAME =
  "publication.complete-v1.json" as const;
export const HELD_OUT_REVIEW_PUBLICATION_PARENT =
  "held-out-review-v1" as const;
export const MAX_HELD_OUT_REVIEW_AGGREGATE_BYTES = 256 * 1024;

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_DEPTH = 32;
const MAX_NODES = 50_000;
const MAX_OBJECT_KEYS = 512;
const MAX_ARRAY_ITEMS = 8_192;
const MAX_KEY_BYTES = 128;
const MAX_STRING_BYTES = 64 * 1024;
const MAX_SENSITIVE_VALUES = 256;
const MAX_SENSITIVE_VALUE_BYTES = 16 * 1024;

export type HeldOutReviewPublicationErrorCode =
  | "publication_input_invalid"
  | "publication_input_too_large"
  | "publication_input_unsafe"
  | "publication_path_unsafe"
  | "publication_target_exists"
  | "publication_io_failed";

/** Stable, non-disclosing error surface for the offline evaluator CLI. */
export class HeldOutReviewPublicationError extends Error {
  readonly code: HeldOutReviewPublicationErrorCode;

  constructor(code: HeldOutReviewPublicationErrorCode) {
    super(code);
    this.code = code;
    this.name = "HeldOutReviewPublicationError";
  }
}

type StrictJson =
  | null
  | boolean
  | number
  | string
  | StrictJson[]
  | { [key: string]: StrictJson };

export interface PublishHeldOutReviewAggregateV1Input {
  /** Existing or safely creatable root. The function creates its own children. */
  outputRoot: string;
  /** Safe, non-secret namespace segment; never copied into an artifact. */
  publicationId: string;
  /** An already-public aggregate object or JSON string. */
  aggregate: unknown;
  /** Exact private values which must not occur in any published byte. */
  sensitiveValues?: readonly string[];
}

export interface HeldOutReviewPublicationSummaryV1 {
  schemaVersion: "held-out-review-publication-summary-v1";
  aggregateRelativePath: typeof HELD_OUT_REVIEW_AGGREGATE_FILE_NAME;
  completionMarkerRelativePath: typeof HELD_OUT_REVIEW_COMPLETION_MARKER_FILE_NAME;
  aggregateSha256: string;
  aggregateBytes: number;
  completionMarkerSha256: string;
  completionMarkerBytes: number;
}

interface NormalizationState {
  readonly active: WeakSet<object>;
  nodes: number;
}

interface DirectoryIdentity {
  readonly dev: number;
  readonly ino: number;
}

const FORBIDDEN_NORMALIZED_KEYS = new Set([
  "id",
  "identity",
  "ordinal",
  "runnerordinal",
  "fixtureid",
  "fixtureidentity",
  "fixturecommitment",
  "repository",
  "repositoryid",
  "repositoryurl",
  "revision",
  "baserevision",
  "changerevision",
  "commit",
  "commitsha",
  "path",
  "paths",
  "absolutepath",
  "relativepath",
  "workspace",
  "workspaceroot",
  "root",
  "file",
  "filename",
  "source",
  "sourcepath",
  "sourceurl",
  "patch",
  "prompt",
  "oracle",
  "gold",
  "rubric",
  "witness",
  "witnesses",
  "defect",
  "defects",
  "defectid",
  "finding",
  "findings",
  "findingid",
  "evidenceregion",
  "evidenceregions",
  "review",
  "reviewprose",
  "rawreview",
  "result",
  "results",
  "judgment",
  "judgments",
  "adjudication",
  "adjudications",
  "adjudicator",
  "adjudicatorid",
  "studyid",
  "coordinatorsignature",
  "signature",
  "salt",
  "stdout",
  "stderr",
  "diagnostic",
  "diagnostics",
  "rawdiagnostics",
  "endpoint",
  "baseurl",
  "url",
  "uri",
  "credential",
  "credentials",
  "apikey",
  "password",
  "secret",
  "authtoken",
  "accesstoken",
  "privatekey",
  "privateinputhash",
  "privateinputbytes",
  "artifact",
  "artifacts",
  "sha256",
  "hash",
  "bytes",
  "bytecount",
  "model",
  "provider",
  "deployment",
  "configuration",
  "__proto__",
  "prototype",
  "constructor",
]);

const PRIVATE_MEASURE_SUBJECT_PATTERN =
  /(?:private|fixture|oracle|gold|witness|repository|revision|path|artifact|input)/u;
const PRIVATE_MEASURE_KIND_PATTERN =
  /(?:sha1|sha256|sha512|md5|hash|digest|checksum|crc32|bytes|bytecount|octets|size|length)/u;
const PRIVATE_INPUT_KEY_PATTERN = /(?:private.*input|input.*private)/u;

const SECRET_PATTERNS = [
  /(?<![A-Za-z0-9_-])sk-(?:or-v1-)?[A-Za-z0-9_-]{20,}/u,
  /gh[pousr]_[A-Za-z0-9]{36,}/u,
  /github_pat_[A-Za-z0-9_]{20,}/u,
  /glpat-[A-Za-z0-9_-]{20,}/u,
  /xox[baprs]-[A-Za-z0-9-]{20,}/u,
  /npm_[A-Za-z0-9]{20,}/u,
  /pypi-[A-Za-z0-9_-]{20,}/u,
  /AIza[0-9A-Za-z_-]{35}/u,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/u,
  /(?:sk|rk)_live_[A-Za-z0-9]{20,}/u,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}\b/iu,
  /\bBasic\s+[A-Za-z0-9+/]{20,}={0,2}\b/iu,
  /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/u,
  /-----BEGIN PGP PRIVATE KEY BLOCK-----/u,
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{16,}/iu,
] as const;

const URL_PATTERN =
  /(?:\b[A-Za-z][A-Za-z0-9+.-]{1,31}:\/\/|\bwww\.[A-Za-z0-9.-]+\.)/iu;
const POSIX_ABSOLUTE_PATH_PATTERN =
  /(?:^|[^A-Za-z0-9._~/-])\/(?!\/)(?:[^\s"'<>`]|$)+/mu;
const WINDOWS_ABSOLUTE_PATH_PATTERN =
  /(?:^|[^A-Za-z0-9._~\\/-])(?:[A-Za-z]:\\{1,2}|\\{2})[^\s"'<>`]+/mu;
const HOME_RELATIVE_PATH_PATTERN =
  /(?:^|[^A-Za-z0-9._~/-])~\/[^\s"'<>`]+/mu;

const TRUSTED_MACOS_SYSTEM_ALIASES = new Map<string, string>([
  ["/etc", "/private/etc"],
  ["/tmp", "/private/tmp"],
  ["/var", "/private/var"],
]);

function failure(
  code: HeldOutReviewPublicationErrorCode,
): HeldOutReviewPublicationError {
  return new HeldOutReviewPublicationError(code);
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function normalizedKey(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9_]/gu, "");
}

function assertSafeKey(key: string): void {
  const normalized = normalizedKey(key);
  if (
    !/^[A-Za-z][A-Za-z0-9]{0,127}$/u.test(key) ||
    utf8Bytes(key) > MAX_KEY_BYTES ||
    FORBIDDEN_NORMALIZED_KEYS.has(normalized) ||
    PRIVATE_INPUT_KEY_PATTERN.test(normalized) ||
    (PRIVATE_MEASURE_SUBJECT_PATTERN.test(normalized) &&
      PRIVATE_MEASURE_KIND_PATTERN.test(normalized))
  ) {
    throw failure("publication_input_unsafe");
  }
}

function assertSafeText(
  value: string,
  sensitiveValues: readonly string[],
): void {
  for (const sensitiveValue of sensitiveValues) {
    if (sensitiveValue.length > 0 && value.includes(sensitiveValue)) {
      throw failure("publication_input_unsafe");
    }
  }
  if (
    URL_PATTERN.test(value) ||
    POSIX_ABSOLUTE_PATH_PATTERN.test(value) ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(value) ||
    HOME_RELATIVE_PATH_PATTERN.test(value) ||
    SECRET_PATTERNS.some((pattern) => pattern.test(value))
  ) {
    throw failure("publication_input_unsafe");
  }
}

function validateSensitiveValues(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_SENSITIVE_VALUES) {
    throw failure("publication_input_invalid");
  }
  const result: string[] = [];
  for (const item of value) {
    if (
      typeof item !== "string" ||
      utf8Bytes(item) > MAX_SENSITIVE_VALUE_BYTES
    ) {
      throw failure("publication_input_invalid");
    }
    result.push(item);
  }
  return result;
}

function normalizeStrictJson(
  value: unknown,
  sensitiveValues: readonly string[],
  state: NormalizationState,
  depth: number,
): StrictJson {
  state.nodes += 1;
  if (state.nodes > MAX_NODES || depth > MAX_DEPTH) {
    throw failure("publication_input_too_large");
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw failure("publication_input_invalid");
    }
    return value;
  }
  if (typeof value === "string") {
    if (utf8Bytes(value) > MAX_STRING_BYTES) {
      throw failure("publication_input_too_large");
    }
    assertSafeText(value, sensitiveValues);
    return value;
  }
  if (typeof value !== "object") {
    throw failure("publication_input_invalid");
  }
  if (state.active.has(value)) {
    throw failure("publication_input_invalid");
  }
  state.active.add(value);
  try {
    if (Array.isArray(value)) {
      if (
        Object.getPrototypeOf(value) !== Array.prototype ||
        value.length > MAX_ARRAY_ITEMS ||
        Object.getOwnPropertySymbols(value).length !== 0
      ) {
        throw failure("publication_input_invalid");
      }
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const names = Object.getOwnPropertyNames(value);
      const indices = names.filter((name) => name !== "length");
      if (
        names.length !== value.length + 1 ||
        indices.length !== value.length ||
        indices.some((name) => {
          const descriptor = descriptors[name];
          return (
            !/^(?:0|[1-9][0-9]*)$/u.test(name) ||
            Number(name) >= value.length ||
            !descriptor ||
            !descriptor.enumerable ||
            !("value" in descriptor) ||
            descriptor.get !== undefined ||
            descriptor.set !== undefined
          );
        })
      ) {
        throw failure("publication_input_invalid");
      }
      const normalized: StrictJson[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor)) {
          throw failure("publication_input_invalid");
        }
        normalized.push(
          normalizeStrictJson(
            descriptor.value,
            sensitiveValues,
            state,
            depth + 1,
          ),
        );
      }
      return normalized;
    }

    const prototype = Object.getPrototypeOf(value);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      Object.getOwnPropertySymbols(value).length !== 0
    ) {
      throw failure("publication_input_invalid");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).sort();
    if (keys.length > MAX_OBJECT_KEYS) {
      throw failure("publication_input_too_large");
    }
    const normalized: Record<string, StrictJson> = Object.create(null) as Record<
      string,
      StrictJson
    >;
    for (const key of keys) {
      assertSafeKey(key);
      const descriptor = descriptors[key];
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !("value" in descriptor) ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined
      ) {
        throw failure("publication_input_invalid");
      }
      normalized[key] = normalizeStrictJson(
        descriptor.value,
        sensitiveValues,
        state,
        depth + 1,
      );
    }
    return normalized;
  } finally {
    state.active.delete(value);
  }
}

function aggregateContents(
  aggregate: unknown,
  sensitiveValues: readonly string[],
): string {
  let input = aggregate;
  if (typeof aggregate === "string") {
    if (utf8Bytes(aggregate) > MAX_HELD_OUT_REVIEW_AGGREGATE_BYTES) {
      throw failure("publication_input_too_large");
    }
    try {
      input = JSON.parse(aggregate) as unknown;
    } catch {
      throw failure("publication_input_invalid");
    }
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw failure("publication_input_invalid");
  }
  const normalized = normalizeStrictJson(
    input,
    sensitiveValues,
    { active: new WeakSet<object>(), nodes: 0 },
    0,
  );
  const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
  if (utf8Bytes(serialized) > MAX_HELD_OUT_REVIEW_AGGREGATE_BYTES) {
    throw failure("publication_input_too_large");
  }
  assertSafeText(serialized, sensitiveValues);
  return serialized;
}

function safePublicationId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)
  ) {
    throw failure("publication_input_invalid");
  }
  return value;
}

function sameIdentity(
  left: { dev: number; ino: number },
  right: { dev: number; ino: number },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function lstatIfPresent(filePath: string) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function assertNoUntrustedSymlinkComponents(candidate: string): Promise<void> {
  const resolved = path.resolve(candidate);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  const segments = resolved
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean);
  for (const segment of segments) {
    current = path.join(current, segment);
    const information = await lstatIfPresent(current);
    if (!information) break;
    if (!information.isSymbolicLink()) continue;
    const trustedTarget = TRUSTED_MACOS_SYSTEM_ALIASES.get(current);
    if (!trustedTarget || (await realpath(current)) !== trustedTarget) {
      throw failure("publication_path_unsafe");
    }
  }
}

async function secureOutputRoot(configuredRoot: string): Promise<string> {
  const requestedRoot = path.resolve(configuredRoot);
  if (requestedRoot === path.parse(requestedRoot).root) {
    throw failure("publication_path_unsafe");
  }
  await assertNoUntrustedSymlinkComponents(requestedRoot);

  const missingSegments: string[] = [];
  let existingAncestor = requestedRoot;
  let information = await lstatIfPresent(existingAncestor);
  while (!information) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) {
      throw failure("publication_path_unsafe");
    }
    missingSegments.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
    information = await lstatIfPresent(existingAncestor);
  }
  if (information.isSymbolicLink()) {
    const trustedTarget = TRUSTED_MACOS_SYSTEM_ALIASES.get(existingAncestor);
    if (!trustedTarget || (await realpath(existingAncestor)) !== trustedTarget) {
      throw failure("publication_path_unsafe");
    }
    existingAncestor = trustedTarget;
    information = await lstat(existingAncestor);
  }
  if (information.isSymbolicLink() || !information.isDirectory()) {
    throw failure("publication_path_unsafe");
  }

  let current = await realpath(existingAncestor);
  for (const segment of missingSegments) {
    current = path.join(current, segment);
    try {
      await mkdir(current, { mode: DIRECTORY_MODE });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const created = await lstat(current);
    if (created.isSymbolicLink() || !created.isDirectory()) {
      throw failure("publication_path_unsafe");
    }
    if ((await realpath(current)) !== path.resolve(current)) {
      throw failure("publication_path_unsafe");
    }
    await syncDirectory(path.dirname(current));
  }

  const canonicalRoot = await realpath(requestedRoot);
  const finalInformation = await lstat(requestedRoot);
  if (finalInformation.isSymbolicLink() || !finalInformation.isDirectory()) {
    throw failure("publication_path_unsafe");
  }
  return canonicalRoot;
}

async function openDirectory(directory: string): Promise<FileHandle> {
  const handle = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const [handleState, pathState] = await Promise.all([
    handle.stat(),
    lstat(directory),
  ]);
  if (
    !handleState.isDirectory() ||
    pathState.isSymbolicLink() ||
    !pathState.isDirectory() ||
    !sameIdentity(handleState, pathState)
  ) {
    await handle.close();
    throw failure("publication_path_unsafe");
  }
  return handle;
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await openDirectory(directory);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function privateDirectoryIdentity(
  directory: string,
): Promise<DirectoryIdentity> {
  const handle = await openDirectory(directory);
  try {
    await handle.chmod(DIRECTORY_MODE);
    await handle.sync();
    const state = await handle.stat();
    if ((state.mode & 0o777) !== DIRECTORY_MODE) {
      throw failure("publication_path_unsafe");
    }
    return { dev: state.dev, ino: state.ino };
  } finally {
    await handle.close();
  }
}

async function assertDirectoryIdentity(
  directory: string,
  expected: DirectoryIdentity,
): Promise<void> {
  const handle = await openDirectory(directory);
  try {
    const state = await handle.stat();
    if (!sameIdentity(state, expected) || (state.mode & 0o777) !== DIRECTORY_MODE) {
      throw failure("publication_path_unsafe");
    }
  } finally {
    await handle.close();
  }
}

async function ensurePrivateParent(
  canonicalOutputRoot: string,
): Promise<string> {
  const parent = path.join(
    canonicalOutputRoot,
    HELD_OUT_REVIEW_PUBLICATION_PARENT,
  );
  let created = false;
  try {
    await mkdir(parent, { mode: DIRECTORY_MODE });
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const information = await lstat(parent);
  if (
    information.isSymbolicLink() ||
    !information.isDirectory() ||
    (await realpath(parent)) !== parent
  ) {
    throw failure("publication_path_unsafe");
  }
  await privateDirectoryIdentity(parent);
  if (created) await syncDirectory(canonicalOutputRoot);
  return parent;
}

async function createPublicationDirectory(
  parent: string,
  publicationId: string,
): Promise<{ directory: string; identity: DirectoryIdentity }> {
  const directory = path.join(parent, publicationId);
  try {
    await mkdir(directory, { mode: DIRECTORY_MODE });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw failure("publication_target_exists");
    }
    throw error;
  }
  const information = await lstat(directory);
  if (
    information.isSymbolicLink() ||
    !information.isDirectory() ||
    (await realpath(directory)) !== directory
  ) {
    throw failure("publication_path_unsafe");
  }
  const identity = await privateDirectoryIdentity(directory);
  await syncDirectory(parent);
  return { directory, identity };
}

async function writeExclusiveSynced(
  filePath: string,
  contents: string,
): Promise<void> {
  let handle: FileHandle;
  try {
    handle = await open(
      filePath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      FILE_MODE,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw failure("publication_target_exists");
    }
    throw error;
  }
  let handleState: Awaited<ReturnType<FileHandle["stat"]>> | undefined;
  try {
    await handle.writeFile(contents, "utf8");
    await handle.chmod(FILE_MODE);
    await handle.sync();
    handleState = await handle.stat();
    if (
      !handleState.isFile() ||
      handleState.nlink !== 1 ||
      (handleState.mode & 0o777) !== FILE_MODE
    ) {
      throw failure("publication_io_failed");
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
  const pathState = await lstat(filePath);
  if (
    !handleState ||
    pathState.isSymbolicLink() ||
    !pathState.isFile() ||
    pathState.nlink !== 1 ||
    (pathState.mode & 0o777) !== FILE_MODE ||
    !sameIdentity(handleState, pathState)
  ) {
    throw failure("publication_io_failed");
  }
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function completionMarkerContents(options: {
  aggregateSha256: string;
  aggregateBytes: number;
}): string {
  return `${JSON.stringify(
    {
      schemaVersion: "held-out-review-publication-complete-v1",
      aggregateSha256: options.aggregateSha256,
      aggregateBytes: options.aggregateBytes,
    },
    null,
    2,
  )}\n`;
}

/**
 * Publishes one pre-sanitized aggregate. Marker absence always means that a
 * crash or error left an incomplete target; the target is deliberately not
 * cleaned up or reused.
 */
export async function publishHeldOutReviewAggregateV1(
  input: PublishHeldOutReviewAggregateV1Input,
): Promise<HeldOutReviewPublicationSummaryV1> {
  try {
    if (typeof input.outputRoot !== "string" || input.outputRoot.length === 0) {
      throw failure("publication_input_invalid");
    }
    const sensitiveValues = validateSensitiveValues(input.sensitiveValues);
    const publicationId = safePublicationId(input.publicationId);
    assertSafeText(publicationId, sensitiveValues);
    const aggregate = aggregateContents(input.aggregate, sensitiveValues);
    const aggregateSha256 = sha256(aggregate);
    const aggregateBytes = utf8Bytes(aggregate);
    const marker = completionMarkerContents({
      aggregateSha256,
      aggregateBytes,
    });
    assertSafeText(marker, sensitiveValues);
    const completionMarkerSha256 = sha256(marker);
    const completionMarkerBytes = utf8Bytes(marker);

    // No filesystem mutation occurs until the complete aggregate and marker
    // have passed their bounds and disclosure checks.
    const canonicalOutputRoot = await secureOutputRoot(input.outputRoot);
    const parent = await ensurePrivateParent(canonicalOutputRoot);
    const publication = await createPublicationDirectory(parent, publicationId);

    const aggregatePath = path.join(
      publication.directory,
      HELD_OUT_REVIEW_AGGREGATE_FILE_NAME,
    );
    const markerPath = path.join(
      publication.directory,
      HELD_OUT_REVIEW_COMPLETION_MARKER_FILE_NAME,
    );

    await assertDirectoryIdentity(publication.directory, publication.identity);
    await writeExclusiveSynced(aggregatePath, aggregate);
    await syncDirectory(publication.directory);
    await assertDirectoryIdentity(publication.directory, publication.identity);
    await writeExclusiveSynced(markerPath, marker);
    await syncDirectory(publication.directory);
    await assertDirectoryIdentity(publication.directory, publication.identity);

    return Object.freeze({
      schemaVersion: "held-out-review-publication-summary-v1" as const,
      aggregateRelativePath: HELD_OUT_REVIEW_AGGREGATE_FILE_NAME,
      completionMarkerRelativePath:
        HELD_OUT_REVIEW_COMPLETION_MARKER_FILE_NAME,
      aggregateSha256,
      aggregateBytes,
      completionMarkerSha256,
      completionMarkerBytes,
    });
  } catch (error) {
    if (error instanceof HeldOutReviewPublicationError) throw error;
    throw failure("publication_io_failed");
  }
}
