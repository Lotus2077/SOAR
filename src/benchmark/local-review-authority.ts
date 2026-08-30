import { constants, type Stats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";

export const LOCAL_REVIEW_AUTHORITY_PLAN_ID =
  "local-evaluation-bridge-v1-plan-1" as const;

const AUTHORITY_SCHEMA_VERSION = "local-review-live-authority-v1" as const;
const AUTHORITY_FILE_NAME = `${LOCAL_REVIEW_AUTHORITY_PLAN_ID}.json`;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_AUTHORITY_RECORD_BYTES = 4_096;

type AuthorityErrorCode =
  | "authority_input_invalid"
  | "authority_path_unsafe"
  | "authority_claim_invalid"
  | "authority_release_not_permitted";

export class LocalReviewAuthorityError extends Error {
  constructor(readonly code: AuthorityErrorCode) {
    super(code);
    this.name = "LocalReviewAuthorityError";
  }
}

export interface LocalReviewAuthorityInput {
  runId: string;
  implementationRevision: string;
}

export interface ClaimedLocalReviewAuthority {
  readonly status: "claimed";
  readonly planId: typeof LOCAL_REVIEW_AUTHORITY_PLAN_ID;
  readonly runId: string;
  readonly implementationRevision: string;
  readonly claimedAt: string;
}

export interface AlreadyConsumedLocalReviewAuthority {
  readonly status: "already_consumed";
  readonly planId: typeof LOCAL_REVIEW_AUTHORITY_PLAN_ID;
}

export type LocalReviewAuthorityResult =
  | ClaimedLocalReviewAuthority
  | AlreadyConsumedLocalReviewAuthority;

export interface LocalReviewDispatchEvidence {
  readonly inferenceAttempts: readonly {
    readonly finished?: {
      readonly requestDisposition: "not_sent" | "sent" | "unknown";
    };
  }[];
}

interface AuthorityRecord {
  schemaVersion: typeof AUTHORITY_SCHEMA_VERSION;
  planId: typeof LOCAL_REVIEW_AUTHORITY_PLAN_ID;
  runId: string;
  implementationRevision: string;
  claimedAt: string;
}

interface PrivateClaimState {
  authorityPath: string;
  ledgerRoot: string;
  serializedRecord: string;
}

const privateClaims = new WeakMap<ClaimedLocalReviewAuthority, PrivateClaimState>();

function authorityError(code: AuthorityErrorCode): LocalReviewAuthorityError {
  return new LocalReviewAuthorityError(code);
}

function validateInput(input: LocalReviewAuthorityInput): void {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(input.runId) ||
    !/^[0-9a-f]{40,64}$/u.test(input.implementationRevision)
  ) {
    throw authorityError("authority_input_invalid");
  }
}

function fixedLedgerRoot(options: {
  platform: NodeJS.Platform;
  homeDirectory: string;
}): string {
  if (!path.isAbsolute(options.homeDirectory)) {
    throw authorityError("authority_path_unsafe");
  }
  return options.platform === "darwin"
    ? path.join(
        options.homeDirectory,
        "Library",
        "Application Support",
        "SOAR",
        "evaluation-ledger",
      )
    : path.join(
        options.homeDirectory,
        ".local",
        "state",
        "SOAR",
        "evaluation-ledger",
      );
}

function productionLedgerRoot(): string {
  let accountHomeDirectory: string;
  try {
    accountHomeDirectory = userInfo().homedir;
  } catch {
    throw authorityError("authority_path_unsafe");
  }
  return fixedLedgerRoot({
    platform: process.platform,
    homeDirectory: accountHomeDirectory,
  });
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertDirectory(value: Stats): void {
  if (value.isSymbolicLink() || !value.isDirectory()) {
    throw authorityError("authority_path_unsafe");
  }
}

function assertClaimFile(value: Stats): void {
  if (
    value.isSymbolicLink() ||
    !value.isFile() ||
    value.nlink !== 1 ||
    (value.mode & 0o777) !== FILE_MODE
  ) {
    throw authorityError("authority_claim_invalid");
  }
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const handleState = await handle.stat();
    const pathState = await lstat(directory);
    assertDirectory(handleState);
    assertDirectory(pathState);
    if (!sameIdentity(handleState, pathState)) {
      throw authorityError("authority_path_unsafe");
    }
    await handle.sync();
  } catch (error) {
    if (error instanceof LocalReviewAuthorityError) throw error;
    throw authorityError("authority_path_unsafe");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function restrictDirectory(directory: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const handleState = await handle.stat();
    const pathState = await lstat(directory);
    assertDirectory(handleState);
    assertDirectory(pathState);
    if (!sameIdentity(handleState, pathState)) {
      throw authorityError("authority_path_unsafe");
    }
    await handle.chmod(DIRECTORY_MODE);
    const restricted = await handle.stat();
    if ((restricted.mode & 0o777) !== DIRECTORY_MODE) {
      throw authorityError("authority_path_unsafe");
    }
    await handle.sync();
  } catch (error) {
    if (error instanceof LocalReviewAuthorityError) throw error;
    throw authorityError("authority_path_unsafe");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function secureLedgerRoot(
  requestedRoot: string,
  options: { create: boolean },
): Promise<string> {
  const ledgerRoot = path.resolve(requestedRoot);
  const parsed = path.parse(ledgerRoot);
  if (ledgerRoot === parsed.root) {
    throw authorityError("authority_path_unsafe");
  }

  let current = parsed.root;
  const segments = ledgerRoot
    .slice(parsed.root.length)
    .split(path.sep)
    .filter((segment) => segment.length > 0);

  for (const segment of segments) {
    const candidate = path.join(current, segment);
    let created = false;
    let state: Awaited<ReturnType<typeof lstat>>;
    try {
      state = await lstat(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !options.create) {
        throw authorityError("authority_path_unsafe");
      }
      try {
        await mkdir(candidate, { mode: DIRECTORY_MODE });
        created = true;
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") {
          throw authorityError("authority_path_unsafe");
        }
      }
      state = await lstat(candidate).catch(() => {
        throw authorityError("authority_path_unsafe");
      });
    }
    assertDirectory(state);
    const canonical = await realpath(candidate).catch(() => {
      throw authorityError("authority_path_unsafe");
    });
    if (canonical !== candidate) {
      throw authorityError("authority_path_unsafe");
    }
    if (created) {
      await restrictDirectory(candidate);
      await syncDirectory(current);
    }
    current = candidate;
  }

  const canonicalRoot = await realpath(ledgerRoot).catch(() => {
    throw authorityError("authority_path_unsafe");
  });
  if (canonicalRoot !== ledgerRoot) {
    throw authorityError("authority_path_unsafe");
  }

  await restrictDirectory(canonicalRoot);
  return canonicalRoot;
}

function authorityPathWithin(ledgerRoot: string): string {
  const authorityPath = path.join(ledgerRoot, AUTHORITY_FILE_NAME);
  const relative = path.relative(ledgerRoot, authorityPath);
  if (
    relative.length === 0 ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    throw authorityError("authority_path_unsafe");
  }
  return authorityPath;
}

async function verifyExistingClaim(authorityPath: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    const pathState = await lstat(authorityPath);
    assertClaimFile(pathState);
    handle = await open(
      authorityPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const handleState = await handle.stat();
    assertClaimFile(handleState);
    if (!sameIdentity(pathState, handleState)) {
      throw authorityError("authority_claim_invalid");
    }
  } catch (error) {
    if (error instanceof LocalReviewAuthorityError) throw error;
    throw authorityError("authority_claim_invalid");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function claimAtLedgerRoot(
  input: LocalReviewAuthorityInput,
  ledgerRootOverride: string,
): Promise<LocalReviewAuthorityResult> {
  validateInput(input);
  const ledgerRoot = await secureLedgerRoot(ledgerRootOverride, { create: true });
  const authorityPath = authorityPathWithin(ledgerRoot);
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      authorityPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      FILE_MODE,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      await verifyExistingClaim(authorityPath);
      return {
        status: "already_consumed",
        planId: LOCAL_REVIEW_AUTHORITY_PLAN_ID,
      };
    }
    if (error instanceof LocalReviewAuthorityError) throw error;
    throw authorityError("authority_claim_invalid");
  }

  const record: AuthorityRecord = {
    schemaVersion: AUTHORITY_SCHEMA_VERSION,
    planId: LOCAL_REVIEW_AUTHORITY_PLAN_ID,
    runId: input.runId,
    implementationRevision: input.implementationRevision,
    claimedAt: new Date().toISOString(),
  };
  const serializedRecord = `${JSON.stringify(record)}\n`;
  let claim: ClaimedLocalReviewAuthority | undefined;
  try {
    await handle.writeFile(serializedRecord, "utf8");
    await handle.chmod(FILE_MODE);
    await handle.sync();
    const handleState = await handle.stat();
    const pathState = await lstat(authorityPath);
    assertClaimFile(handleState);
    assertClaimFile(pathState);
    if (!sameIdentity(handleState, pathState)) {
      throw authorityError("authority_claim_invalid");
    }
    await syncDirectory(ledgerRoot);
    claim = Object.freeze({
      status: "claimed" as const,
      planId: LOCAL_REVIEW_AUTHORITY_PLAN_ID,
      runId: input.runId,
      implementationRevision: input.implementationRevision,
      claimedAt: record.claimedAt,
    });
    privateClaims.set(claim, {
      authorityPath,
      ledgerRoot,
      serializedRecord,
    });
    return claim;
  } catch (error) {
    if (error instanceof LocalReviewAuthorityError) throw error;
    throw authorityError("authority_claim_invalid");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export async function claimLocalReviewLiveAuthority(
  input: LocalReviewAuthorityInput,
): Promise<LocalReviewAuthorityResult> {
  return claimAtLedgerRoot(input, productionLedgerRoot());
}

export async function releaseLocalReviewLiveAuthorityAfterNoDispatch(
  claim: ClaimedLocalReviewAuthority,
  evidence: LocalReviewDispatchEvidence,
): Promise<void> {
  if (
    evidence.inferenceAttempts.some(
      (attempt) => attempt.finished?.requestDisposition !== "not_sent",
    )
  ) {
    throw authorityError("authority_release_not_permitted");
  }
  const privateState = privateClaims.get(claim);
  if (!privateState) {
    throw authorityError("authority_release_not_permitted");
  }
  const ledgerRoot = await secureLedgerRoot(privateState.ledgerRoot, {
    create: false,
  });
  if (authorityPathWithin(ledgerRoot) !== privateState.authorityPath) {
    throw authorityError("authority_claim_invalid");
  }

  let handle: FileHandle | undefined;
  try {
    const pathState = await lstat(privateState.authorityPath);
    assertClaimFile(pathState);
    if (pathState.size > MAX_AUTHORITY_RECORD_BYTES) {
      throw authorityError("authority_claim_invalid");
    }
    handle = await open(
      privateState.authorityPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const handleState = await handle.stat();
    assertClaimFile(handleState);
    if (
      !sameIdentity(pathState, handleState) ||
      handleState.size > MAX_AUTHORITY_RECORD_BYTES
    ) {
      throw authorityError("authority_claim_invalid");
    }
    const contents = await handle.readFile("utf8");
    if (contents !== privateState.serializedRecord) {
      throw authorityError("authority_claim_invalid");
    }
    const finalPathState = await lstat(privateState.authorityPath);
    if (!sameIdentity(handleState, finalPathState)) {
      throw authorityError("authority_claim_invalid");
    }
    await unlink(privateState.authorityPath);
    await syncDirectory(ledgerRoot);
    privateClaims.delete(claim);
  } catch (error) {
    if (error instanceof LocalReviewAuthorityError) throw error;
    throw authorityError("authority_claim_invalid");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** @internal Tests only. Production callers must use the fixed-root wrapper. */
export const localReviewAuthorityInternals = Object.freeze({
  authorityFilePath: (ledgerRoot: string) =>
    authorityPathWithin(path.resolve(ledgerRoot)),
  claimAtLedgerRoot: (
    input: LocalReviewAuthorityInput,
    options: { ledgerRoot: string },
  ) => claimAtLedgerRoot(input, options.ledgerRoot),
  fixedLedgerRoot,
  productionLedgerRoot,
});
