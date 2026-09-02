import { createHash, randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";

import { z } from "zod";

import {
  CloudApplicationRequestV1Schema,
  PR6R_CAMPAIGN_ID,
  PR6R_COST_SCOPE,
  PR6R_DEVELOPMENT_AUTHORITY_ID,
  PR6R_LOOPBACK_CANCELLED_NOT_SENT_REASONS,
  PR6R_LOOPBACK_CANCELLED_UNKNOWN_REASONS,
  PR6R_LOOPBACK_FAILED_NOT_SENT_REASONS,
  PR6R_LOOPBACK_FAILED_SENT_REASONS,
  PR6R_LOOPBACK_FAILED_UNKNOWN_REASONS,
  PR6R_PLAN_ID,
  buildPr6rOsAuthorityClaimV1,
  canonicalPr6rCloudApplicationRequestSha256,
  type Pr6rOsAuthorityClaimV1,
} from "../../shared/pr6r-development-contracts";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_RECORD_BYTES = 8_192;
const CAMPAIGN_FILE = "campaign.json";
const FALLBACK_FILE = "fallback.claimed.json";
const GUARD_FILE_SUFFIX = ".pr6r-authority.guard.json";

export const PR6R_AUTHORITY_LEDGER_SCHEMA_VERSION =
  "pr6r-authority-ledger-v1" as const;
export const PR6R_CLOUD_SLOT_IDS = [
  "cloud_synthesis",
  "hybrid_cloud_if_selected",
] as const;
export type Pr6rCloudSlotId = (typeof PR6R_CLOUD_SLOT_IDS)[number];
export type Pr6rRequestDisposition = "not_sent" | "sent" | "unknown";
export type Pr6rSlotTerminalOutcome = "completed" | "failed" | "cancelled";

const canonicalRevision = z
  .string()
  .regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u);
const canonicalTimestamp = z
  .string()
  .datetime({ offset: true })
  .refine((value) => {
    const milliseconds = Date.parse(value);
    return (
      Number.isFinite(milliseconds) &&
      new Date(milliseconds).toISOString() === value
    );
  });
const canonicalBoundedId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const canonicalSha256 = z.string().regex(/^[0-9a-f]{64}$/u);
const canonicalLoopbackOrigin = z.string().superRefine((value, context) => {
  if (!/^http:\/\/(?:127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}$/u.test(value)) {
    context.addIssue({ code: "custom", message: "loopback origin invalid" });
    return;
  }
  try {
    const parsed = new URL(value);
    const port = Number(parsed.port);
    if (
      parsed.origin !== value ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      !Number.isSafeInteger(port) ||
      port < 1 ||
      port > 65_535
    ) {
      context.addIssue({ code: "custom", message: "loopback origin invalid" });
    }
  } catch {
    context.addIssue({ code: "custom", message: "loopback origin invalid" });
  }
});

const CloudSlotBindingSchema = z
  .object({
    slotId: z.enum(PR6R_CLOUD_SLOT_IDS),
    requestId: canonicalBoundedId,
    origin: canonicalLoopbackOrigin,
    applicationRequestSha256: canonicalSha256,
    canonicalBodySha256: canonicalSha256,
    commonCheckpointSha256: canonicalSha256,
    synthesisSessionId: canonicalBoundedId,
    attemptId: canonicalBoundedId,
    reservationId: canonicalBoundedId,
  })
  .strict();
const TerminalInputSchema = z
  .object({
    terminalOutcome: z.enum(["completed", "failed", "cancelled"]),
    requestDisposition: z.enum(["not_sent", "sent", "unknown"]),
    stableCode: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u),
    terminalAt: canonicalTimestamp,
  })
  .strict()
  .superRefine((value, context) => {
    if (!terminalEvidenceAllowed(value)) {
      context.addIssue({
        code: "custom",
        message: "terminal outcome, disposition, and stable code disagree",
      });
    }
  });

const AuthorityGuardRecordSchema = z
  .object({
    schemaVersion: z.literal(PR6R_AUTHORITY_LEDGER_SCHEMA_VERSION),
    recordType: z.literal("authority_guard"),
    planId: z.literal(PR6R_PLAN_ID),
    authorityId: z.literal(PR6R_DEVELOPMENT_AUTHORITY_ID),
    campaignId: z.literal(PR6R_CAMPAIGN_ID),
    implementationRevision: canonicalRevision,
    costScope: z.literal(PR6R_COST_SCOPE),
    actualPaidAuthority: z.literal(false),
    provisionedAt: canonicalTimestamp,
  })
  .strict();

const CampaignRecordSchema = z
  .object({
    schemaVersion: z.literal(PR6R_AUTHORITY_LEDGER_SCHEMA_VERSION),
    recordType: z.literal("campaign_claimed"),
    planId: z.literal(PR6R_PLAN_ID),
    authorityId: z.literal(PR6R_DEVELOPMENT_AUTHORITY_ID),
    campaignId: z.literal(PR6R_CAMPAIGN_ID),
    implementationRevision: canonicalRevision,
    authorityGuardSha256: canonicalSha256,
    costScope: z.literal(PR6R_COST_SCOPE),
    actualPaidAuthority: z.literal(false),
    claimedAt: canonicalTimestamp,
  })
  .strict();

const SlotRecordSchema = z
  .object({
    schemaVersion: z.literal(PR6R_AUTHORITY_LEDGER_SCHEMA_VERSION),
    recordType: z.literal("slot_claimed"),
    authorityId: z.literal(PR6R_DEVELOPMENT_AUTHORITY_ID),
    campaignId: z.literal(PR6R_CAMPAIGN_ID),
    implementationRevision: canonicalRevision,
    campaignClaimSha256: canonicalSha256,
    slotId: z.enum(PR6R_CLOUD_SLOT_IDS),
    requestId: canonicalBoundedId,
    origin: canonicalLoopbackOrigin,
    applicationRequestSha256: canonicalSha256,
    canonicalBodySha256: canonicalSha256,
    commonCheckpointSha256: canonicalSha256,
    synthesisSessionId: canonicalBoundedId,
    attemptId: canonicalBoundedId,
    reservationId: canonicalBoundedId,
    costScope: z.literal(PR6R_COST_SCOPE),
    actualPaidAuthority: z.literal(false),
    claimedAt: canonicalTimestamp,
  })
  .strict();

const SlotTerminalRecordSchema = z
  .object({
    schemaVersion: z.literal(PR6R_AUTHORITY_LEDGER_SCHEMA_VERSION),
    recordType: z.literal("slot_terminal"),
    authorityId: z.literal(PR6R_DEVELOPMENT_AUTHORITY_ID),
    campaignId: z.literal(PR6R_CAMPAIGN_ID),
    implementationRevision: canonicalRevision,
    slotId: z.enum(PR6R_CLOUD_SLOT_IDS),
    slotClaimSha256: canonicalSha256,
    terminalOutcome: z.enum(["completed", "failed", "cancelled"]),
    requestDisposition: z.enum(["not_sent", "sent", "unknown"]),
    stableCode: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u),
    terminalAt: canonicalTimestamp,
  })
  .strict()
  .superRefine((value, context) => {
    if (!terminalEvidenceAllowed(value)) {
      context.addIssue({
        code: "custom",
        message: "terminal outcome, disposition, and stable code disagree",
      });
    }
  });

const FallbackRecordSchema = z
  .object({
    schemaVersion: z.literal(PR6R_AUTHORITY_LEDGER_SCHEMA_VERSION),
    recordType: z.literal("fallback_claimed"),
    authorityId: z.literal(PR6R_DEVELOPMENT_AUTHORITY_ID),
    campaignId: z.literal(PR6R_CAMPAIGN_ID),
    implementationRevision: canonicalRevision,
    triggerSlotId: z.enum(PR6R_CLOUD_SLOT_IDS),
    triggerTerminalSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/u),
    claimedAt: canonicalTimestamp,
  })
  .strict();

type AuthorityGuardRecord = z.infer<typeof AuthorityGuardRecordSchema>;
type CampaignRecord = z.infer<typeof CampaignRecordSchema>;
type SlotRecord = z.infer<typeof SlotRecordSchema>;
type SlotTerminalRecord = z.infer<typeof SlotTerminalRecordSchema>;
type FallbackRecord = z.infer<typeof FallbackRecordSchema>;

const FAILED_NOT_SENT_CODES = new Set<string>(
  PR6R_LOOPBACK_FAILED_NOT_SENT_REASONS,
);
const FAILED_SENT_CODES = new Set<string>(PR6R_LOOPBACK_FAILED_SENT_REASONS);
const FAILED_UNKNOWN_CODES = new Set<string>(
  PR6R_LOOPBACK_FAILED_UNKNOWN_REASONS,
);
const CANCELLED_NOT_SENT_CODES = new Set<string>(
  PR6R_LOOPBACK_CANCELLED_NOT_SENT_REASONS,
);
const CANCELLED_UNKNOWN_CODES = new Set<string>(
  PR6R_LOOPBACK_CANCELLED_UNKNOWN_REASONS,
);

function terminalEvidenceAllowed(value: {
  terminalOutcome: Pr6rSlotTerminalOutcome;
  requestDisposition: Pr6rRequestDisposition;
  stableCode: string;
}): boolean {
  if (value.terminalOutcome === "completed") {
    return (
      value.requestDisposition === "sent" && value.stableCode === "completed"
    );
  }
  if (value.terminalOutcome === "cancelled") {
    if (value.requestDisposition === "not_sent") {
      return CANCELLED_NOT_SENT_CODES.has(value.stableCode);
    }
    if (value.requestDisposition === "unknown") {
      return CANCELLED_UNKNOWN_CODES.has(value.stableCode);
    }
    return false;
  }
  if (value.requestDisposition === "not_sent") {
    return FAILED_NOT_SENT_CODES.has(value.stableCode);
  }
  if (value.requestDisposition === "sent") {
    return FAILED_SENT_CODES.has(value.stableCode);
  }
  return FAILED_UNKNOWN_CODES.has(value.stableCode);
}

export type Pr6rAuthorityErrorCode =
  | "authority_input_invalid"
  | "authority_path_unsafe"
  | "authority_record_invalid"
  | "authority_handle_invalid"
  | "authority_slot_consumed"
  | "authority_terminal_exists"
  | "authority_fallback_consumed";

export class Pr6rAuthorityError extends Error {
  constructor(readonly code: Pr6rAuthorityErrorCode) {
    super(code);
    this.name = "Pr6rAuthorityError";
  }
}

export interface Pr6rCampaignAuthority {
  readonly status: "claimed" | "resumed";
  readonly campaignId: typeof PR6R_CAMPAIGN_ID;
  readonly implementationRevision: string;
  readonly claimedAt: string;
  readonly recordSha256: string;
  readonly guardRecordSha256: string;
}

export type Pr6rCloudSlotBinding = Readonly<
  z.infer<typeof CloudSlotBindingSchema>
>;

const genuineSlotBindings = new WeakSet<Pr6rCloudSlotBinding>();

export function buildPr6rCloudSlotBinding(input: {
  applicationRequest: unknown;
  reservationId: string;
}): Pr6rCloudSlotBinding {
  const request = parseAuthorityInput(
    CloudApplicationRequestV1Schema,
    input.applicationRequest,
  );
  const binding = Object.freeze(
    parseAuthorityInput(CloudSlotBindingSchema, {
      slotId: request.slotId,
      requestId: request.requestId,
      origin: request.origin,
      applicationRequestSha256:
        canonicalPr6rCloudApplicationRequestSha256(request),
      canonicalBodySha256: request.canonicalBodySha256,
      commonCheckpointSha256: request.commonCheckpointSha256,
      synthesisSessionId: request.synthesisSessionId,
      attemptId: request.attemptId,
      reservationId: input.reservationId,
    }),
  );
  genuineSlotBindings.add(binding);
  return binding;
}

export interface Pr6rSlotAuthority {
  readonly status: "claimed";
  readonly campaignId: typeof PR6R_CAMPAIGN_ID;
  readonly slotId: Pr6rCloudSlotId;
  readonly claimedAt: string;
  readonly requestId: string;
  readonly origin: string;
  readonly applicationRequestSha256: string;
  readonly canonicalBodySha256: string;
  readonly commonCheckpointSha256: string;
  readonly synthesisSessionId: string;
  readonly attemptId: string;
  readonly reservationId: string;
}

export interface Pr6rSlotRecoveryAuthority {
  readonly status: "recovery_only";
  readonly campaignId: typeof PR6R_CAMPAIGN_ID;
  readonly slotId: Pr6rCloudSlotId;
  readonly requestId: string;
  readonly applicationRequestSha256: string;
  readonly synthesisSessionId: string;
  readonly attemptId: string;
  readonly reservationId: string;
}

export interface Pr6rSlotTerminalAuthority {
  readonly status: "terminal";
  readonly campaignId: typeof PR6R_CAMPAIGN_ID;
  readonly slotId: Pr6rCloudSlotId;
  readonly terminalOutcome: Pr6rSlotTerminalOutcome;
  readonly requestDisposition: Pr6rRequestDisposition;
  readonly stableCode: string;
  readonly terminalAt: string;
  readonly slotClaimSha256: string;
  readonly recordSha256: string;
}

export type Pr6rSlotClaimResult =
  | Pr6rSlotAuthority
  | {
      readonly status: "already_consumed";
      readonly campaignId: typeof PR6R_CAMPAIGN_ID;
      readonly slotId: Pr6rCloudSlotId;
    };

export type Pr6rSlotRecoveryResult =
  | Pr6rSlotRecoveryAuthority
  | {
      readonly status: "already_terminalized";
      readonly campaignId: typeof PR6R_CAMPAIGN_ID;
      readonly slotId: Pr6rCloudSlotId;
    };

export type Pr6rFallbackClaimResult =
  | {
      readonly status: "claimed";
      readonly campaignId: typeof PR6R_CAMPAIGN_ID;
      readonly triggerSlotId: Pr6rCloudSlotId;
      readonly triggerTerminalSha256: string;
      readonly fallbackClaimSha256: string;
      readonly claimedAt: string;
    }
  | {
      readonly status: "already_consumed";
      readonly campaignId: typeof PR6R_CAMPAIGN_ID;
      readonly triggerSlotId: Pr6rCloudSlotId;
      readonly triggerTerminalSha256: string;
      readonly fallbackClaimSha256: string;
      readonly claimedAt: string;
    };

export interface Pr6rAuthorityLedgerSnapshot {
  guard: AuthorityGuardRecord;
  campaign: CampaignRecord;
  slots: Readonly<
    Partial<
      Record<
        Pr6rCloudSlotId,
        { claim: SlotRecord; terminal?: SlotTerminalRecord }
      >
    >
  >;
  fallback?: FallbackRecord;
}

interface CampaignPrivateState {
  ledgerRoot: string;
  guard: AuthorityGuardRecord;
  record: CampaignRecord;
}

interface SlotPrivateState {
  ledgerRoot: string;
  record: SlotRecord;
}

interface SlotTerminalPrivateState extends SlotPrivateState {
  terminalRecord: SlotTerminalRecord;
}

const campaignPrivateState = new WeakMap<
  Pr6rCampaignAuthority,
  CampaignPrivateState
>();
const slotPrivateState = new WeakMap<Pr6rSlotAuthority, SlotPrivateState>();
const slotRecoveryPrivateState = new WeakMap<
  Pr6rSlotRecoveryAuthority,
  SlotPrivateState
>();
const slotTerminalPrivateState = new WeakMap<
  Pr6rSlotTerminalAuthority,
  SlotTerminalPrivateState
>();

function authorityError(code: Pr6rAuthorityErrorCode): Pr6rAuthorityError {
  return new Pr6rAuthorityError(code);
}

function parseAuthorityInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw authorityError("authority_input_invalid");
  }
  return result.data;
}

function recordSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function slotRecordMatchesBinding(
  record: SlotRecord,
  implementationRevision: string,
  campaignClaimSha256: string,
  binding: Pr6rCloudSlotBinding,
): boolean {
  return (
    record.implementationRevision === implementationRevision &&
    record.campaignClaimSha256 === campaignClaimSha256 &&
    record.slotId === binding.slotId &&
    record.requestId === binding.requestId &&
    record.origin === binding.origin &&
    record.applicationRequestSha256 === binding.applicationRequestSha256 &&
    record.canonicalBodySha256 === binding.canonicalBodySha256 &&
    record.commonCheckpointSha256 === binding.commonCheckpointSha256 &&
    record.synthesisSessionId === binding.synthesisSessionId &&
    record.attemptId === binding.attemptId &&
    record.reservationId === binding.reservationId
  );
}

function timestampAtOrAfter(value: string, lowerBound: string): boolean {
  return Date.parse(value) >= Date.parse(lowerBound);
}

const crossSlotUniqueFields = [
  "requestId",
  "applicationRequestSha256",
  "synthesisSessionId",
  "attemptId",
  "reservationId",
] as const;
const crossSlotSharedFields = [
  "origin",
  "canonicalBodySha256",
  "commonCheckpointSha256",
] as const;

function slotClaimsShareCampaignEvidenceAndDifferByAttempt(
  left: SlotRecord,
  right: SlotRecord,
): boolean {
  return (
    crossSlotUniqueFields.every((field) => left[field] !== right[field]) &&
    crossSlotSharedFields.every((field) => left[field] === right[field])
  );
}

function bindingSharesCampaignEvidenceAndDiffersByAttempt(
  binding: Pr6rCloudSlotBinding,
  claim: SlotRecord,
): boolean {
  return (
    crossSlotUniqueFields.every((field) => binding[field] !== claim[field]) &&
    crossSlotSharedFields.every((field) => binding[field] === claim[field])
  );
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertDirectory(state: Stats): void {
  if (state.isSymbolicLink() || !state.isDirectory()) {
    throw authorityError("authority_path_unsafe");
  }
}

function assertRecordFile(state: Stats): void {
  if (
    state.isSymbolicLink() ||
    !state.isFile() ||
    state.nlink !== 1 ||
    (state.mode & 0o777) !== FILE_MODE ||
    state.size <= 0 ||
    state.size > MAX_RECORD_BYTES
  ) {
    throw authorityError("authority_record_invalid");
  }
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const [handleState, pathState] = await Promise.all([
      handle.stat(),
      lstat(directory),
    ]);
    assertDirectory(handleState);
    assertDirectory(pathState);
    if (!sameIdentity(handleState, pathState)) {
      throw authorityError("authority_path_unsafe");
    }
    await handle.sync();
  } catch (error) {
    if (error instanceof Pr6rAuthorityError) throw error;
    throw authorityError("authority_path_unsafe");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function resolveLedgerRoot(requestedRoot: string): string {
  const ledgerRoot = path.resolve(requestedRoot);
  const parsed = path.parse(ledgerRoot);
  if (!path.isAbsolute(requestedRoot) || ledgerRoot === parsed.root) {
    throw authorityError("authority_path_unsafe");
  }
  return ledgerRoot;
}

async function secureLedgerRoot(requestedRoot: string): Promise<string> {
  const ledgerRoot = resolveLedgerRoot(requestedRoot);
  const parsed = path.parse(ledgerRoot);

  let current = parsed.root;
  const segments = ledgerRoot
    .slice(parsed.root.length)
    .split(path.sep)
    .filter((segment) => segment.length > 0);
  for (const segment of segments) {
    const candidate = path.join(current, segment);
    let created = false;
    let state: Stats;
    try {
      state = await lstat(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
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
    if (created) await syncDirectory(current);
    current = candidate;
  }

  const canonicalRoot = await realpath(ledgerRoot).catch(() => {
    throw authorityError("authority_path_unsafe");
  });
  if (canonicalRoot !== ledgerRoot) {
    throw authorityError("authority_path_unsafe");
  }
  let rootHandle: FileHandle | undefined;
  try {
    rootHandle = await open(
      canonicalRoot,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    await rootHandle.chmod(DIRECTORY_MODE);
    const state = await rootHandle.stat();
    if ((state.mode & 0o777) !== DIRECTORY_MODE) {
      throw authorityError("authority_path_unsafe");
    }
    await rootHandle.sync();
  } catch (error) {
    if (error instanceof Pr6rAuthorityError) throw error;
    throw authorityError("authority_path_unsafe");
  } finally {
    await rootHandle?.close().catch(() => undefined);
  }
  return canonicalRoot;
}

function productionLedgerRoot(): string {
  let homeDirectory: string;
  try {
    homeDirectory = userInfo().homedir;
  } catch {
    throw authorityError("authority_path_unsafe");
  }
  if (!path.isAbsolute(homeDirectory)) {
    throw authorityError("authority_path_unsafe");
  }
  return process.platform === "darwin"
    ? path.join(
        homeDirectory,
        "Library",
        "Application Support",
        "ai.soar.shared-authority",
        "pr6r-v1",
      )
    : path.join(
        homeDirectory,
        ".local",
        "state",
        "SOAR",
        "shared-authority",
        "pr6r-v1",
      );
}

function recordPath(ledgerRoot: string, fileName: string): string {
  const value = path.join(ledgerRoot, fileName);
  const relative = path.relative(ledgerRoot, value);
  if (
    relative.length === 0 ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw authorityError("authority_path_unsafe");
  }
  return value;
}

function authorityGuardFileName(ledgerRoot: string): string {
  return `${path.basename(ledgerRoot)}${GUARD_FILE_SUFFIX}`;
}

function authorityGuardPath(ledgerRoot: string): string {
  const parent = path.dirname(ledgerRoot);
  return recordPath(parent, authorityGuardFileName(ledgerRoot));
}

async function optionalLstat(filePath: string): Promise<Stats | undefined> {
  try {
    return await lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw authorityError("authority_path_unsafe");
  }
}

function slotClaimFile(slotId: Pr6rCloudSlotId): string {
  return `slot.${slotId}.claimed.json`;
}

function slotTerminalFile(slotId: Pr6rCloudSlotId): string {
  return `slot.${slotId}.terminal.json`;
}

function authorityRecordGuardFileName(
  ledgerRoot: string,
  fileName: string,
): string {
  return `${path.basename(ledgerRoot)}.pr6r-record.${fileName}.guard`;
}

function authorityRecordGuardPath(
  ledgerRoot: string,
  fileName: string,
): string {
  return recordPath(
    path.dirname(ledgerRoot),
    authorityRecordGuardFileName(ledgerRoot, fileName),
  );
}

async function readRecord<T>(
  filePath: string,
  schema: z.ZodType<T>,
): Promise<T> {
  let handle: FileHandle | undefined;
  try {
    const pathState = await lstat(filePath);
    assertRecordFile(pathState);
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const handleState = await handle.stat();
    assertRecordFile(handleState);
    if (!sameIdentity(pathState, handleState)) {
      throw authorityError("authority_record_invalid");
    }
    const contents = await handle.readFile({ encoding: "utf8" });
    if (Buffer.byteLength(contents) > MAX_RECORD_BYTES) {
      throw authorityError("authority_record_invalid");
    }
    return schema.parse(JSON.parse(contents)) as T;
  } catch (error) {
    if (error instanceof Pr6rAuthorityError) throw error;
    throw authorityError("authority_record_invalid");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function createRecord<T>(
  ledgerRoot: string,
  fileName: string,
  value: T,
): Promise<"created" | "exists"> {
  const filePath = recordPath(ledgerRoot, fileName);
  const temporaryPath = recordPath(
    ledgerRoot,
    `.${fileName}.${randomUUID()}.tmp`,
  );
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      temporaryPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      FILE_MODE,
    );
  } catch (error) {
    throw authorityError("authority_record_invalid");
  }
  try {
    const serialized = `${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(serialized) > MAX_RECORD_BYTES) {
      throw authorityError("authority_record_invalid");
    }
    await handle.writeFile(serialized, "utf8");
    await handle.chmod(FILE_MODE);
    await handle.sync();
    const [handleState, temporaryState] = await Promise.all([
      handle.stat(),
      lstat(temporaryPath),
    ]);
    assertRecordFile(handleState);
    assertRecordFile(temporaryState);
    if (!sameIdentity(handleState, temporaryState)) {
      throw authorityError("authority_record_invalid");
    }
    await handle.close();
    handle = undefined;
    let outcome: "created" | "exists" = "created";
    try {
      await link(temporaryPath, filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw authorityError("authority_record_invalid");
      }
      outcome = "exists";
    }
    await unlink(temporaryPath);
    if (outcome === "created") {
      assertRecordFile(await lstat(filePath));
    }
    await syncDirectory(ledgerRoot);
    return outcome;
  } catch (error) {
    if (error instanceof Pr6rAuthorityError) throw error;
    throw authorityError("authority_record_invalid");
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function readOptionalGuardedRecord<T>(
  ledgerRoot: string,
  fileName: string,
  schema: z.ZodType<T>,
): Promise<T | undefined> {
  const primaryPath = recordPath(ledgerRoot, fileName);
  const guardPath = authorityRecordGuardPath(ledgerRoot, fileName);
  const [primaryState, guardState] = await Promise.all([
    optionalLstat(primaryPath),
    optionalLstat(guardPath),
  ]);
  if (primaryState === undefined && guardState === undefined) return undefined;
  if (primaryState === undefined || guardState === undefined) {
    throw authorityError("authority_record_invalid");
  }
  const [primary, guard] = await Promise.all([
    readRecord(primaryPath, schema),
    readRecord(guardPath, schema),
  ]);
  if (JSON.stringify(primary) !== JSON.stringify(guard)) {
    throw authorityError("authority_record_invalid");
  }
  return primary;
}

async function createGuardedRecord<T>(
  ledgerRoot: string,
  fileName: string,
  value: T,
  schema: z.ZodType<T>,
): Promise<"created" | "exists"> {
  const primaryPath = recordPath(ledgerRoot, fileName);
  const guardPath = authorityRecordGuardPath(ledgerRoot, fileName);
  const [primaryState, guardState] = await Promise.all([
    optionalLstat(primaryPath),
    optionalLstat(guardPath),
  ]);
  if (primaryState !== undefined && guardState !== undefined) {
    const existing = await readOptionalGuardedRecord(
      ledgerRoot,
      fileName,
      schema,
    );
    if (existing === undefined) {
      throw authorityError("authority_record_invalid");
    }
    return "exists";
  }
  if (primaryState !== undefined) {
    const primary = await readRecord(primaryPath, schema);
    const outcome = await createRecord(
      path.dirname(ledgerRoot),
      authorityRecordGuardFileName(ledgerRoot, fileName),
      primary,
    );
    if (outcome !== "created") {
      const guard = await readRecord(guardPath, schema);
      if (JSON.stringify(primary) !== JSON.stringify(guard)) {
        throw authorityError("authority_record_invalid");
      }
    }
    return "exists";
  }
  if (guardState !== undefined) {
    const guard = await readRecord(guardPath, schema);
    const outcome = await createRecord(ledgerRoot, fileName, guard);
    if (outcome !== "created") {
      const primary = await readRecord(primaryPath, schema);
      if (JSON.stringify(primary) !== JSON.stringify(guard)) {
        throw authorityError("authority_record_invalid");
      }
    }
    return "exists";
  }

  const primaryOutcome = await createRecord(ledgerRoot, fileName, value);
  if (primaryOutcome === "exists") {
    return createGuardedRecord(ledgerRoot, fileName, value, schema);
  }
  const persisted = await readRecord(primaryPath, schema);
  if (JSON.stringify(persisted) !== JSON.stringify(value)) {
    throw authorityError("authority_record_invalid");
  }
  const guardOutcome = await createRecord(
    path.dirname(ledgerRoot),
    authorityRecordGuardFileName(ledgerRoot, fileName),
    persisted,
  );
  if (guardOutcome === "exists") {
    const guard = await readRecord(guardPath, schema);
    if (JSON.stringify(persisted) !== JSON.stringify(guard)) {
      throw authorityError("authority_record_invalid");
    }
  }
  const guarded = await readOptionalGuardedRecord(
    ledgerRoot,
    fileName,
    schema,
  );
  if (guarded === undefined) {
    throw authorityError("authority_record_invalid");
  }
  return "created";
}

function guardMatchesRevision(
  guard: AuthorityGuardRecord,
  implementationRevision: string,
): boolean {
  return guard.implementationRevision === implementationRevision;
}

async function provisionOrOpenLedger(input: {
  requestedRoot: string;
  guardRecord: AuthorityGuardRecord;
}): Promise<{
  ledgerRoot: string;
  guard: AuthorityGuardRecord;
  firstProvision: boolean;
}> {
  const ledgerRoot = resolveLedgerRoot(input.requestedRoot);
  const guardPath = authorityGuardPath(ledgerRoot);
  const [rootState, guardState] = await Promise.all([
    optionalLstat(ledgerRoot),
    optionalLstat(guardPath),
  ]);
  if (rootState !== undefined) assertDirectory(rootState);
  if ((rootState === undefined) !== (guardState === undefined)) {
    throw authorityError("authority_record_invalid");
  }

  const firstProvision = rootState === undefined;
  if (firstProvision) {
    const parent = await secureLedgerRoot(path.dirname(ledgerRoot));
    try {
      await mkdir(ledgerRoot, { mode: DIRECTORY_MODE });
      await syncDirectory(parent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw authorityError("authority_path_unsafe");
      }
    }
  }

  const securedRoot = await secureLedgerRoot(ledgerRoot);
  if (firstProvision) {
    const parent = path.dirname(securedRoot);
    await createRecord(
      parent,
      authorityGuardFileName(securedRoot),
      input.guardRecord,
    );
  }
  const guard = await readRecord(
    authorityGuardPath(securedRoot),
    AuthorityGuardRecordSchema,
  );
  if (
    !guardMatchesRevision(guard, input.guardRecord.implementationRevision) ||
    (firstProvision && JSON.stringify(guard) !== JSON.stringify(input.guardRecord))
  ) {
    throw authorityError("authority_record_invalid");
  }
  return { ledgerRoot: securedRoot, guard, firstProvision };
}

async function claimCampaignAtRoot(input: {
  implementationRevision: string;
  ledgerRoot: string;
}): Promise<Pr6rCampaignAuthority> {
  const implementationRevision = parseAuthorityInput(
    canonicalRevision,
    input.implementationRevision,
  );
  const claimedAt = parseAuthorityInput(
    canonicalTimestamp,
    new Date().toISOString(),
  );
  const requestedRoot = resolveLedgerRoot(input.ledgerRoot);
  const guardRecord = AuthorityGuardRecordSchema.parse({
    schemaVersion: PR6R_AUTHORITY_LEDGER_SCHEMA_VERSION,
    recordType: "authority_guard",
    planId: PR6R_PLAN_ID,
    authorityId: PR6R_DEVELOPMENT_AUTHORITY_ID,
    campaignId: PR6R_CAMPAIGN_ID,
    implementationRevision,
    costScope: PR6R_COST_SCOPE,
    actualPaidAuthority: false,
    provisionedAt: claimedAt,
  });
  const { ledgerRoot, guard, firstProvision } = await provisionOrOpenLedger({
    requestedRoot,
    guardRecord,
  });
  const record = CampaignRecordSchema.parse({
    schemaVersion: PR6R_AUTHORITY_LEDGER_SCHEMA_VERSION,
    recordType: "campaign_claimed",
    planId: PR6R_PLAN_ID,
    authorityId: PR6R_DEVELOPMENT_AUTHORITY_ID,
    campaignId: PR6R_CAMPAIGN_ID,
    implementationRevision,
    authorityGuardSha256: recordSha256(guard),
    costScope: PR6R_COST_SCOPE,
    actualPaidAuthority: false,
    claimedAt,
  });
  const outcome = firstProvision
    ? await createRecord(ledgerRoot, CAMPAIGN_FILE, record)
    : "exists";
  const persisted =
    outcome === "created"
      ? record
      : await readRecord(
          recordPath(ledgerRoot, CAMPAIGN_FILE),
          CampaignRecordSchema,
        );
  if (
    persisted.implementationRevision !== implementationRevision ||
    persisted.authorityGuardSha256 !== recordSha256(guard)
  ) {
    throw authorityError("authority_record_invalid");
  }
  const authority = Object.freeze({
    status: outcome === "created" ? ("claimed" as const) : ("resumed" as const),
    campaignId: PR6R_CAMPAIGN_ID,
    implementationRevision,
    claimedAt: persisted.claimedAt,
    recordSha256: recordSha256(persisted),
    guardRecordSha256: recordSha256(guard),
  });
  campaignPrivateState.set(authority, { ledgerRoot, guard, record: persisted });
  return authority;
}

export async function claimPr6rCampaignAuthority(input: {
  implementationRevision: string;
}): Promise<Pr6rCampaignAuthority> {
  return claimCampaignAtRoot({
    implementationRevision: input.implementationRevision,
    ledgerRoot: productionLedgerRoot(),
  });
}

async function assertLiveCampaign(
  privateState: CampaignPrivateState,
): Promise<Pr6rAuthorityLedgerSnapshot> {
  const snapshot = await inspectPr6rAuthorityLedgerAtRoot(
    privateState.ledgerRoot,
  );
  if (
    snapshot === undefined ||
    JSON.stringify(snapshot.guard) !== JSON.stringify(privateState.guard) ||
    JSON.stringify(snapshot.campaign) !== JSON.stringify(privateState.record)
  ) {
    throw authorityError("authority_record_invalid");
  }
  return snapshot;
}

export async function buildPr6rOsAuthorityClaimFromLedger(
  authority: Pr6rCampaignAuthority,
): Promise<Pr6rOsAuthorityClaimV1> {
  const privateState = campaignPrivateState.get(authority);
  if (privateState === undefined) {
    throw authorityError("authority_handle_invalid");
  }
  await assertLiveCampaign(privateState);
  return buildPr6rOsAuthorityClaimV1({
    implementationRevision: privateState.record.implementationRevision,
    claimedAt: privateState.record.claimedAt,
    ledgerCampaignRecordSha256: recordSha256(privateState.record),
    ledgerGuardRecordSha256: recordSha256(privateState.guard),
  });
}

async function assertLiveSlot(
  privateState: SlotPrivateState,
): Promise<Pr6rAuthorityLedgerSnapshot> {
  const snapshot = await inspectPr6rAuthorityLedgerAtRoot(
    privateState.ledgerRoot,
  );
  const persisted = snapshot?.slots[privateState.record.slotId]?.claim;
  if (
    snapshot === undefined ||
    snapshot.campaign.implementationRevision !==
      privateState.record.implementationRevision ||
    persisted === undefined ||
    JSON.stringify(persisted) !== JSON.stringify(privateState.record)
  ) {
    throw authorityError("authority_record_invalid");
  }
  return snapshot;
}

export async function claimPr6rCloudSlot(
  authority: Pr6rCampaignAuthority,
  input: Pr6rCloudSlotBinding,
): Promise<Pr6rSlotClaimResult> {
  const privateState = campaignPrivateState.get(authority);
  if (privateState === undefined) {
    throw authorityError("authority_handle_invalid");
  }
  if (!genuineSlotBindings.has(input)) {
    throw authorityError("authority_handle_invalid");
  }
  const binding = parseAuthorityInput(CloudSlotBindingSchema, input);
  const normalizedSlotId = binding.slotId;
  const ledger = await assertLiveCampaign(privateState);
  if (
    normalizedSlotId === "hybrid_cloud_if_selected" &&
    ledger.slots.cloud_synthesis?.terminal === undefined
  ) {
    throw authorityError("authority_record_invalid");
  }
  const priorCloudClaim = ledger.slots.cloud_synthesis?.claim;
  if (
    normalizedSlotId === "hybrid_cloud_if_selected" &&
    (priorCloudClaim === undefined ||
      !bindingSharesCampaignEvidenceAndDiffersByAttempt(
        binding,
        priorCloudClaim,
      ))
  ) {
    throw authorityError("authority_input_invalid");
  }
  const terminalBeforeClaim = await readOptionalGuardedRecord(
    privateState.ledgerRoot,
    slotTerminalFile(normalizedSlotId),
    SlotTerminalRecordSchema,
  );
  if (terminalBeforeClaim !== undefined) {
    const existingClaim = await readOptionalGuardedRecord(
      privateState.ledgerRoot,
      slotClaimFile(normalizedSlotId),
      SlotRecordSchema,
    );
    if (
      existingClaim === undefined ||
      !slotRecordMatchesBinding(
        existingClaim,
        privateState.record.implementationRevision,
        recordSha256(privateState.record),
        binding,
      ) ||
      terminalBeforeClaim.slotId !== normalizedSlotId ||
      terminalBeforeClaim.implementationRevision !==
        privateState.record.implementationRevision ||
      terminalBeforeClaim.slotClaimSha256 !== recordSha256(existingClaim)
    ) {
      throw authorityError("authority_record_invalid");
    }
    return Object.freeze({
      status: "already_consumed" as const,
      campaignId: PR6R_CAMPAIGN_ID,
      slotId: normalizedSlotId,
    });
  }
  const claimedAt = parseAuthorityInput(
    canonicalTimestamp,
    new Date().toISOString(),
  );
  const cloudTerminal = ledger.slots.cloud_synthesis?.terminal;
  if (
    !timestampAtOrAfter(claimedAt, privateState.record.claimedAt) ||
    (normalizedSlotId === "hybrid_cloud_if_selected" &&
      (cloudTerminal === undefined ||
        !timestampAtOrAfter(claimedAt, cloudTerminal.terminalAt)))
  ) {
    throw authorityError("authority_input_invalid");
  }
  const record = SlotRecordSchema.parse({
    schemaVersion: PR6R_AUTHORITY_LEDGER_SCHEMA_VERSION,
    recordType: "slot_claimed",
    authorityId: PR6R_DEVELOPMENT_AUTHORITY_ID,
    campaignId: PR6R_CAMPAIGN_ID,
    implementationRevision: privateState.record.implementationRevision,
    campaignClaimSha256: recordSha256(privateState.record),
    slotId: normalizedSlotId,
    requestId: binding.requestId,
    origin: binding.origin,
    applicationRequestSha256: binding.applicationRequestSha256,
    canonicalBodySha256: binding.canonicalBodySha256,
    commonCheckpointSha256: binding.commonCheckpointSha256,
    synthesisSessionId: binding.synthesisSessionId,
    attemptId: binding.attemptId,
    reservationId: binding.reservationId,
    costScope: PR6R_COST_SCOPE,
    actualPaidAuthority: false,
    claimedAt,
  });
  const outcome = await createGuardedRecord(
    privateState.ledgerRoot,
    slotClaimFile(normalizedSlotId),
    record,
    SlotRecordSchema,
  );
  if (outcome === "exists") {
    const existing = await readRecord(
      recordPath(privateState.ledgerRoot, slotClaimFile(normalizedSlotId)),
      SlotRecordSchema,
    );
    if (
      !slotRecordMatchesBinding(
        existing,
        privateState.record.implementationRevision,
        recordSha256(privateState.record),
        binding,
      )
    ) {
      throw authorityError("authority_record_invalid");
    }
    return Object.freeze({
      status: "already_consumed" as const,
      campaignId: PR6R_CAMPAIGN_ID,
      slotId: normalizedSlotId,
    });
  }
  // A terminal record cannot legitimately appear for the claim we just won:
  // no other process can possess the nominal handle created below. Fail closed
  // if a corrupt or hostile writer raced the atomic claim publication.
  if (
    (await readOptionalGuardedRecord(
      privateState.ledgerRoot,
      slotTerminalFile(normalizedSlotId),
      SlotTerminalRecordSchema,
    )) !== undefined
  ) {
    throw authorityError("authority_record_invalid");
  }
  const reconciled = await assertLiveCampaign(privateState);
  const reconciledSlot = reconciled.slots[normalizedSlotId];
  if (
    reconciledSlot === undefined ||
    reconciledSlot.terminal !== undefined ||
    JSON.stringify(reconciledSlot.claim) !== JSON.stringify(record)
  ) {
    throw authorityError("authority_record_invalid");
  }
  const slotAuthority = Object.freeze({
    status: "claimed" as const,
    campaignId: PR6R_CAMPAIGN_ID,
    slotId: normalizedSlotId,
    claimedAt: record.claimedAt,
    requestId: record.requestId,
    origin: record.origin,
    applicationRequestSha256: record.applicationRequestSha256,
    canonicalBodySha256: record.canonicalBodySha256,
    commonCheckpointSha256: record.commonCheckpointSha256,
    synthesisSessionId: record.synthesisSessionId,
    attemptId: record.attemptId,
    reservationId: record.reservationId,
  });
  slotPrivateState.set(slotAuthority, {
    ledgerRoot: privateState.ledgerRoot,
    record,
  });
  return slotAuthority;
}

export async function recoverPr6rCloudSlot(
  authority: Pr6rCampaignAuthority,
  input: Pr6rCloudSlotBinding,
): Promise<Pr6rSlotRecoveryResult> {
  const privateState = campaignPrivateState.get(authority);
  if (privateState === undefined) {
    throw authorityError("authority_handle_invalid");
  }
  if (!genuineSlotBindings.has(input)) {
    throw authorityError("authority_handle_invalid");
  }
  const binding = parseAuthorityInput(CloudSlotBindingSchema, input);
  await assertLiveCampaign(privateState);
  const claim = await readRecord(
    recordPath(privateState.ledgerRoot, slotClaimFile(binding.slotId)),
    SlotRecordSchema,
  );
  if (
    !slotRecordMatchesBinding(
      claim,
      privateState.record.implementationRevision,
      recordSha256(privateState.record),
      binding,
    )
  ) {
    throw authorityError("authority_record_invalid");
  }
  const terminal = await readOptionalGuardedRecord(
    privateState.ledgerRoot,
    slotTerminalFile(binding.slotId),
    SlotTerminalRecordSchema,
  );
  if (terminal !== undefined) {
    if (
      terminal.slotId !== binding.slotId ||
      terminal.implementationRevision !==
        privateState.record.implementationRevision ||
      terminal.slotClaimSha256 !== recordSha256(claim)
    ) {
      throw authorityError("authority_record_invalid");
    }
    return Object.freeze({
      status: "already_terminalized" as const,
      campaignId: PR6R_CAMPAIGN_ID,
      slotId: binding.slotId,
    });
  }
  const recoveryAuthority = Object.freeze({
    status: "recovery_only" as const,
    campaignId: PR6R_CAMPAIGN_ID,
    slotId: binding.slotId,
    requestId: binding.requestId,
    applicationRequestSha256: binding.applicationRequestSha256,
    synthesisSessionId: binding.synthesisSessionId,
    attemptId: binding.attemptId,
    reservationId: binding.reservationId,
  });
  slotRecoveryPrivateState.set(recoveryAuthority, {
    ledgerRoot: privateState.ledgerRoot,
    record: claim,
  });
  return recoveryAuthority;
}

async function terminalizePr6rCloudSlotPrivate(
  privateState: SlotPrivateState,
  input: {
    terminalOutcome: Pr6rSlotTerminalOutcome;
    requestDisposition: Pr6rRequestDisposition;
    stableCode: string;
  },
): Promise<Pr6rSlotTerminalAuthority> {
  await assertLiveSlot(privateState);
  const persistedClaim = await readRecord(
    recordPath(
      privateState.ledgerRoot,
      slotClaimFile(privateState.record.slotId),
    ),
    SlotRecordSchema,
  );
  if (JSON.stringify(persistedClaim) !== JSON.stringify(privateState.record)) {
    throw authorityError("authority_record_invalid");
  }
  const terminalInput = parseAuthorityInput(TerminalInputSchema, {
    terminalOutcome: input.terminalOutcome,
    requestDisposition: input.requestDisposition,
    stableCode: input.stableCode,
    terminalAt: new Date().toISOString(),
  });
  if (!timestampAtOrAfter(terminalInput.terminalAt, privateState.record.claimedAt)) {
    throw authorityError("authority_input_invalid");
  }
  const record = SlotTerminalRecordSchema.parse({
    schemaVersion: PR6R_AUTHORITY_LEDGER_SCHEMA_VERSION,
    recordType: "slot_terminal",
    authorityId: PR6R_DEVELOPMENT_AUTHORITY_ID,
    campaignId: PR6R_CAMPAIGN_ID,
    implementationRevision: privateState.record.implementationRevision,
    slotId: privateState.record.slotId,
    slotClaimSha256: recordSha256(privateState.record),
    terminalOutcome: terminalInput.terminalOutcome,
    requestDisposition: terminalInput.requestDisposition,
    stableCode: terminalInput.stableCode,
    terminalAt: terminalInput.terminalAt,
  });
  const outcome = await createGuardedRecord(
    privateState.ledgerRoot,
    slotTerminalFile(privateState.record.slotId),
    record,
    SlotTerminalRecordSchema,
  );
  const persisted =
    outcome === "exists"
      ? await readRecord(
      recordPath(
        privateState.ledgerRoot,
        slotTerminalFile(privateState.record.slotId),
      ),
      SlotTerminalRecordSchema,
        )
      : record;
  if (
    outcome === "exists" &&
    JSON.stringify(persisted) !== JSON.stringify(record)
  ) {
      throw authorityError("authority_terminal_exists");
  }
  const terminalAuthority = Object.freeze({
    status: "terminal" as const,
    campaignId: PR6R_CAMPAIGN_ID,
    slotId: persisted.slotId,
    terminalOutcome: persisted.terminalOutcome,
    requestDisposition: persisted.requestDisposition,
    stableCode: persisted.stableCode,
    terminalAt: persisted.terminalAt,
    slotClaimSha256: persisted.slotClaimSha256,
    recordSha256: recordSha256(persisted),
  });
  slotTerminalPrivateState.set(terminalAuthority, {
    ledgerRoot: privateState.ledgerRoot,
    record: privateState.record,
    terminalRecord: persisted,
  });
  return terminalAuthority;
}

export async function terminalizePr6rCloudSlot(
  slotAuthority: Pr6rSlotAuthority,
  input: {
    terminalOutcome: Pr6rSlotTerminalOutcome;
    requestDisposition: Pr6rRequestDisposition;
    stableCode: string;
  },
): Promise<Pr6rSlotTerminalAuthority> {
  const privateState = slotPrivateState.get(slotAuthority);
  if (privateState === undefined) {
    throw authorityError("authority_handle_invalid");
  }
  return terminalizePr6rCloudSlotPrivate(privateState, input);
}

export async function terminalizeRecoveredPr6rCloudSlot(
  recoveryAuthority: Pr6rSlotRecoveryAuthority,
): Promise<Pr6rSlotTerminalAuthority> {
  const privateState = slotRecoveryPrivateState.get(recoveryAuthority);
  if (privateState === undefined) {
    throw authorityError("authority_handle_invalid");
  }
  return terminalizePr6rCloudSlotPrivate(privateState, {
    terminalOutcome: "failed",
    requestDisposition: "unknown",
    stableCode: "loopback.recovery_required",
  });
}

export async function recoverPr6rFailedTerminalForFallback(
  authority: Pr6rCampaignAuthority,
  input: Pr6rCloudSlotBinding,
): Promise<Pr6rSlotTerminalAuthority> {
  const privateState = campaignPrivateState.get(authority);
  if (privateState === undefined) {
    throw authorityError("authority_handle_invalid");
  }
  if (!genuineSlotBindings.has(input)) {
    throw authorityError("authority_handle_invalid");
  }
  const binding = parseAuthorityInput(CloudSlotBindingSchema, input);
  await assertLiveCampaign(privateState);
  const claim = await readRecord(
    recordPath(privateState.ledgerRoot, slotClaimFile(binding.slotId)),
    SlotRecordSchema,
  );
  if (
    !slotRecordMatchesBinding(
      claim,
      privateState.record.implementationRevision,
      recordSha256(privateState.record),
      binding,
    )
  ) {
    throw authorityError("authority_record_invalid");
  }
  const terminal = await readRecord(
    recordPath(privateState.ledgerRoot, slotTerminalFile(binding.slotId)),
    SlotTerminalRecordSchema,
  );
  if (
    terminal.implementationRevision !== claim.implementationRevision ||
    terminal.slotId !== claim.slotId ||
    terminal.slotClaimSha256 !== recordSha256(claim) ||
    terminal.terminalOutcome !== "failed"
  ) {
    throw authorityError("authority_record_invalid");
  }
  const terminalAuthority = Object.freeze({
    status: "terminal" as const,
    campaignId: PR6R_CAMPAIGN_ID,
    slotId: terminal.slotId,
    terminalOutcome: terminal.terminalOutcome,
    requestDisposition: terminal.requestDisposition,
    stableCode: terminal.stableCode,
    terminalAt: terminal.terminalAt,
    slotClaimSha256: terminal.slotClaimSha256,
    recordSha256: recordSha256(terminal),
  });
  slotTerminalPrivateState.set(terminalAuthority, {
    ledgerRoot: privateState.ledgerRoot,
    record: claim,
    terminalRecord: terminal,
  });
  return terminalAuthority;
}

export async function claimPr6rLocalFallback(
  terminalAuthority: Pr6rSlotTerminalAuthority,
): Promise<Pr6rFallbackClaimResult> {
  const privateState = slotTerminalPrivateState.get(terminalAuthority);
  if (privateState === undefined) {
    throw authorityError("authority_handle_invalid");
  }
  await assertLiveSlot(privateState);
  const persistedTerminal = await readRecord(
    recordPath(
      privateState.ledgerRoot,
      slotTerminalFile(privateState.record.slotId),
    ),
    SlotTerminalRecordSchema,
  );
  if (
    JSON.stringify(persistedTerminal) !==
      JSON.stringify(privateState.terminalRecord) ||
    persistedTerminal.slotClaimSha256 !== recordSha256(privateState.record) ||
    persistedTerminal.terminalOutcome !== "failed"
  ) {
    throw authorityError("authority_record_invalid");
  }
  const claimedAt = parseAuthorityInput(
    canonicalTimestamp,
    new Date().toISOString(),
  );
  if (!timestampAtOrAfter(claimedAt, persistedTerminal.terminalAt)) {
    throw authorityError("authority_input_invalid");
  }
  const record = FallbackRecordSchema.parse({
    schemaVersion: PR6R_AUTHORITY_LEDGER_SCHEMA_VERSION,
    recordType: "fallback_claimed",
    authorityId: PR6R_DEVELOPMENT_AUTHORITY_ID,
    campaignId: PR6R_CAMPAIGN_ID,
    implementationRevision: privateState.record.implementationRevision,
    triggerSlotId: persistedTerminal.slotId,
    triggerTerminalSha256: recordSha256(persistedTerminal),
    claimedAt,
  });
  const outcome = await createGuardedRecord(
    privateState.ledgerRoot,
    FALLBACK_FILE,
    record,
    FallbackRecordSchema,
  );
  if (outcome === "exists") {
    const existing = await readRecord(
      recordPath(privateState.ledgerRoot, FALLBACK_FILE),
      FallbackRecordSchema,
    );
    const existingTerminal = await readRecord(
      recordPath(
        privateState.ledgerRoot,
        slotTerminalFile(existing.triggerSlotId),
      ),
      SlotTerminalRecordSchema,
    );
    const existingClaim = await readRecord(
      recordPath(
        privateState.ledgerRoot,
        slotClaimFile(existing.triggerSlotId),
      ),
      SlotRecordSchema,
    );
    if (
      existing.implementationRevision !==
        privateState.record.implementationRevision ||
      existingTerminal.slotClaimSha256 !== recordSha256(existingClaim) ||
      existingTerminal.terminalOutcome !== "failed" ||
      existing.triggerTerminalSha256 !== recordSha256(existingTerminal)
    ) {
      throw authorityError("authority_record_invalid");
    }
    return Object.freeze({
      status: "already_consumed" as const,
      campaignId: PR6R_CAMPAIGN_ID,
      triggerSlotId: existing.triggerSlotId,
      triggerTerminalSha256: existing.triggerTerminalSha256,
      fallbackClaimSha256: recordSha256(existing),
      claimedAt: existing.claimedAt,
    });
  }
  return Object.freeze({
    status: "claimed" as const,
    campaignId: PR6R_CAMPAIGN_ID,
    triggerSlotId: record.triggerSlotId,
    triggerTerminalSha256: record.triggerTerminalSha256,
    fallbackClaimSha256: recordSha256(record),
    claimedAt: record.claimedAt,
  });
}

async function readOptionalRecord<T>(
  filePath: string,
  schema: z.ZodType<T>,
): Promise<T | undefined> {
  try {
    return await readRecord(filePath, schema);
  } catch (error) {
    const pathState = await lstat(filePath).catch(
      (cause: NodeJS.ErrnoException) => cause,
    );
    if (pathState instanceof Error && pathState.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function inspectPr6rAuthorityLedgerAtRoot(
  requestedLedgerRoot: string,
): Promise<
  Pr6rAuthorityLedgerSnapshot | undefined
> {
  const requestedRoot = resolveLedgerRoot(requestedLedgerRoot);
  const guardPath = authorityGuardPath(requestedRoot);
  const [rootState, guardState] = await Promise.all([
    optionalLstat(requestedRoot),
    optionalLstat(guardPath),
  ]);
  if (rootState === undefined && guardState === undefined) return undefined;
  if (rootState !== undefined) assertDirectory(rootState);
  if (rootState === undefined || guardState === undefined) {
    throw authorityError("authority_record_invalid");
  }
  const ledgerRoot = await secureLedgerRoot(requestedRoot);
  const guard = await readRecord(
    authorityGuardPath(ledgerRoot),
    AuthorityGuardRecordSchema,
  );
  const campaignPath = recordPath(ledgerRoot, CAMPAIGN_FILE);
  const campaign = await readRecord(campaignPath, CampaignRecordSchema);
  if (
    campaign.implementationRevision !== guard.implementationRevision ||
    campaign.authorityGuardSha256 !== recordSha256(guard) ||
    !timestampAtOrAfter(campaign.claimedAt, guard.provisionedAt)
  ) {
    throw authorityError("authority_record_invalid");
  }
  const slots: Partial<
    Record<
      Pr6rCloudSlotId,
      { claim: SlotRecord; terminal?: SlotTerminalRecord }
    >
  > = {};
  for (const slotId of PR6R_CLOUD_SLOT_IDS) {
    const claim = await readOptionalGuardedRecord(
      ledgerRoot,
      slotClaimFile(slotId),
      SlotRecordSchema,
    );
    const terminal = await readOptionalGuardedRecord(
      ledgerRoot,
      slotTerminalFile(slotId),
      SlotTerminalRecordSchema,
    );
    if (claim === undefined) {
      if (terminal !== undefined) {
        throw authorityError("authority_record_invalid");
      }
      continue;
    }
    if (
      claim.slotId !== slotId ||
      claim.implementationRevision !== campaign.implementationRevision ||
      claim.campaignClaimSha256 !== recordSha256(campaign) ||
      !timestampAtOrAfter(claim.claimedAt, campaign.claimedAt) ||
      (terminal !== undefined &&
        (terminal.slotId !== slotId ||
          terminal.implementationRevision !== campaign.implementationRevision ||
          terminal.slotClaimSha256 !== recordSha256(claim) ||
          !timestampAtOrAfter(terminal.terminalAt, claim.claimedAt)))
    ) {
      throw authorityError("authority_record_invalid");
    }
    slots[slotId] = terminal === undefined ? { claim } : { claim, terminal };
  }
  const fallback = await readOptionalGuardedRecord(
    ledgerRoot,
    FALLBACK_FILE,
    FallbackRecordSchema,
  );
  if (fallback !== undefined) {
    const triggerTerminal = slots[fallback.triggerSlotId]?.terminal;
    if (
      fallback.implementationRevision !== campaign.implementationRevision ||
      triggerTerminal === undefined ||
      triggerTerminal.terminalOutcome !== "failed" ||
      fallback.triggerTerminalSha256 !== recordSha256(triggerTerminal) ||
      !timestampAtOrAfter(fallback.claimedAt, triggerTerminal.terminalAt)
    ) {
      throw authorityError("authority_record_invalid");
    }
  }
  const hybrid = slots.hybrid_cloud_if_selected;
  if (hybrid !== undefined) {
    const cloudTerminal = slots.cloud_synthesis?.terminal;
    const cloudClaim = slots.cloud_synthesis?.claim;
    if (
      cloudTerminal === undefined ||
      cloudClaim === undefined ||
      !slotClaimsShareCampaignEvidenceAndDifferByAttempt(
        cloudClaim,
        hybrid.claim,
      ) ||
      !timestampAtOrAfter(hybrid.claim.claimedAt, cloudTerminal.terminalAt)
    ) {
      throw authorityError("authority_record_invalid");
    }
  }
  return Object.freeze({
    guard,
    campaign,
    slots: Object.freeze(slots),
    ...(fallback === undefined ? {} : { fallback }),
  });
}

export async function inspectPr6rAuthorityLedger(): Promise<
  Pr6rAuthorityLedgerSnapshot | undefined
> {
  return inspectPr6rAuthorityLedgerAtRoot(productionLedgerRoot());
}
