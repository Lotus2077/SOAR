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
  PR6R_SIMULATION_PRICING_SNAPSHOT_ID,
  Pr6rCampaignV1Schema,
  Pr6rComparisonV1Schema,
  Pr6rSafeProjectionV1Schema,
  buildPr6rOsAuthorityClaimV1,
  canonicalPr6rCloudApplicationRequestSha256,
  canonicalPr6rJsonV1,
  type Pr6rOsAuthorityClaimV1,
} from "../../shared/pr6r-development-contracts";
import {
  assertPr6rSqliteTerminalWitnessLedger,
  consumePr6rSqliteTerminalReceiptForReconciliation,
  revalidatePr6rSqliteTerminalWitness,
  type Pr6rSqliteTerminalBinding,
  type Pr6rSqliteTerminalReceipt,
  type Pr6rSqliteTerminalWitness,
} from "./sqlite-attempt-authority";
import type { BudgetLedger } from "../budget-ledger";
import type { Pr6rCanaryReplay } from "./canary-store";

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
const SCHEMA_REJECTED_OUTPUT_CODES = new Set<string>([
  "loopback.response_malformed",
  "loopback.protocol_invalid",
  "loopback.review_result_invalid",
  "loopback.invalid_response",
]);

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

export interface Pr6rLiveSlotAuthorityBinding {
  readonly campaignId: typeof PR6R_CAMPAIGN_ID;
  readonly implementationRevision: string;
  readonly slotId: Pr6rCloudSlotId;
  readonly requestId: string;
  readonly origin: string;
  readonly applicationRequestSha256: string;
  readonly canonicalBodySha256: string;
  readonly commonCheckpointSha256: string;
  readonly synthesisSessionId: string;
  readonly attemptId: string;
  readonly reservationId: string;
  readonly slotClaimSha256: string;
}

export interface Pr6rCloudSlotDispatchArm {
  readonly status: "armed";
  readonly slotId: Pr6rCloudSlotId;
  readonly requestId: string;
  readonly attemptId: string;
  readonly reservationId: string;
}

export interface Pr6rConsumedOsDispatchAuthority {
  readonly status: "dispatch_consumed";
  readonly slotId: Pr6rCloudSlotId;
  readonly requestId: string;
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

/** Nominal proof that one durable SQLite terminal matches one live OS terminal. */
export interface Pr6rCrossStoreReconciledTerminalAuthority {
  readonly status: "cross_store_reconciled";
  readonly campaignId: typeof PR6R_CAMPAIGN_ID;
  readonly slotId: Pr6rCloudSlotId;
  readonly requestId: string;
  readonly synthesisSessionId: string;
  readonly attemptId: string;
  readonly reservationId: string;
  readonly terminalOutcome: Pr6rSlotTerminalOutcome;
  readonly requestDisposition: Pr6rRequestDisposition;
  readonly stableCode: string;
  readonly osTerminalRecordSha256: string;
}

export interface Pr6rComparisonProjectionAppendInput {
  readonly comparisonRecordId: string;
  readonly safeProjectionRecordId: string;
  readonly expectedSequence: number;
  readonly comparison: unknown;
  readonly safeProjection: unknown;
  readonly createdAt: string;
}

export type Pr6rComparisonProjectionUseAuthority = Readonly<
  | {
      readonly kind: "pr6r_comparison_projection_use";
      readonly scope: "initial_baseline";
      readonly campaignId: typeof PR6R_CAMPAIGN_ID;
    }
  | {
      readonly kind: "pr6r_comparison_projection_use";
      readonly scope: "terminal_transition";
      readonly campaignId: typeof PR6R_CAMPAIGN_ID;
      readonly requestId: string;
      readonly attemptId: string;
      readonly reservationId: string;
    }
>;

export interface Pr6rComparisonProjectionStore<T> {
  replay(): Pr6rCanaryReplay | undefined;
  appendComparisonProjection(
    input: Pr6rComparisonProjectionAppendInput & {
      readonly authority: Pr6rComparisonProjectionUseAuthority;
    },
  ): T;
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
  runtime: {
    phase:
    | "claimed"
    | "preparing"
    | "armed"
    | "dispatch_consumed"
    | "terminalizing"
    | "terminalized";
  };
}

interface SlotTerminalPrivateState extends SlotPrivateState {
  terminalRecord: SlotTerminalRecord;
}

interface ReconciledTerminalPrivateState {
  readonly os: SlotTerminalPrivateState;
  readonly sqliteWitness: Pr6rSqliteTerminalWitness;
  readonly sqliteBinding: Pr6rSqliteTerminalBinding;
  readonly applicationRequest: z.infer<typeof CloudApplicationRequestV1Schema>;
  readonly reservationId: string;
  comparisonTransitionConsumed: boolean;
}

const campaignPrivateState = new WeakMap<
  Pr6rCampaignAuthority,
  CampaignPrivateState
>();
const slotPrivateState = new WeakMap<Pr6rSlotAuthority, SlotPrivateState>();
const slotDispatchArmPrivateState = new WeakMap<
  Pr6rCloudSlotDispatchArm,
  { slot: SlotPrivateState; binding: Pr6rLiveSlotAuthorityBinding; consumed: boolean }
>();
const consumedOsDispatchPrivateState = new WeakMap<
  Pr6rConsumedOsDispatchAuthority,
  { slot: SlotPrivateState; binding: Pr6rLiveSlotAuthorityBinding }
>();
const slotRecoveryPrivateState = new WeakMap<
  Pr6rSlotRecoveryAuthority,
  SlotPrivateState
>();
const slotTerminalPrivateState = new WeakMap<
  Pr6rSlotTerminalAuthority,
  SlotTerminalPrivateState
>();
const reconciledTerminalPrivateState = new WeakMap<
  Pr6rCrossStoreReconciledTerminalAuthority,
  ReconciledTerminalPrivateState
>();
const downstreamUsePrivateState = new WeakMap<
  Pr6rComparisonProjectionUseAuthority,
  {
    consumed: boolean;
    readonly store: object;
    readonly appendInput: object;
    readonly appendInputSha256: string;
    readonly priorRecordCount: number;
    readonly priorReplaySha256: string;
  }
>();
const initialBaselineUseByCampaign = new Set<string>();
const campaignExecutionAuthorityByRecord = new Map<string, object>();
const slotRuntimeStateByClaim = new Map<
  string,
  SlotPrivateState["runtime"]
>();

function runtimeStateForSlot(
  ledgerRoot: string,
  record: SlotRecord,
  initialPhase: SlotPrivateState["runtime"]["phase"],
): SlotPrivateState["runtime"] {
  const key = `${ledgerRoot}\0${recordSha256(record)}`;
  const existing = slotRuntimeStateByClaim.get(key);
  if (existing !== undefined) return existing;
  const runtime = { phase: initialPhase };
  slotRuntimeStateByClaim.set(key, runtime);
  return runtime;
}

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

function captureAuthorityInput<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    throw authorityError("authority_input_invalid");
  }
}

function deepFreezeAuthorityInput<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreezeAuthorityInput(nested);
  }
  return Object.freeze(value);
}

function captureCanaryReplay(
  replay: Pr6rCanaryReplay | undefined,
): Pr6rCanaryReplay | undefined {
  if (replay === undefined) return undefined;
  const captured = captureAuthorityInput(replay);
  const campaign = parseAuthorityInput(
    Pr6rCampaignV1Schema,
    captured.campaign,
  );
  const comparison =
    captured.comparison === undefined
      ? undefined
      : parseAuthorityInput(Pr6rComparisonV1Schema, captured.comparison);
  if (
    !Array.isArray(captured.records) ||
    captured.records.length < 1 ||
    (captured.safeProjection === undefined) !== (comparison === undefined)
  ) {
    throw authorityError("authority_input_invalid");
  }
  try {
    canonicalPr6rJsonV1(captured.records);
    if (captured.safeProjection !== undefined) {
      canonicalPr6rJsonV1(captured.safeProjection);
    }
  } catch {
    throw authorityError("authority_input_invalid");
  }
  return {
    campaign,
    ...(comparison === undefined ? {} : { comparison }),
    ...(captured.safeProjection === undefined
      ? {}
      : { safeProjection: captured.safeProjection }),
    records: captured.records,
  };
}

function canaryReplaySha256(replay: Pr6rCanaryReplay): string {
  return createHash("sha256")
    .update(
      canonicalPr6rJsonV1({
        campaign: replay.campaign,
        comparison: replay.comparison ?? null,
        safeProjection: replay.safeProjection ?? null,
        records: replay.records,
      }),
    )
    .digest("hex");
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

function maxCanonicalTimestamp(left: string, right: string): string {
  const canonicalLeft = parseAuthorityInput(canonicalTimestamp, left);
  const canonicalRight = parseAuthorityInput(canonicalTimestamp, right);
  return timestampAtOrAfter(canonicalLeft, canonicalRight)
    ? canonicalLeft
    : canonicalRight;
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

/**
 * Bind every normal-run slot in one live campaign to one exact process-local
 * runtime/ledger authority. Reacquiring the campaign handle cannot transplant
 * the second slot to another SQLite ledger in the same process.
 */
export async function bindPr6rCampaignExecutionAuthority(
  authority: Pr6rCampaignAuthority,
  input: {
    readonly executionAuthority: object;
    readonly implementationRevision: string;
  },
): Promise<void> {
  const privateState = campaignPrivateState.get(authority);
  if (
    privateState === undefined ||
    typeof input.executionAuthority !== "object" ||
    input.executionAuthority === null
  ) {
    throw authorityError("authority_handle_invalid");
  }
  const implementationRevision = parseAuthorityInput(
    canonicalRevision,
    input.implementationRevision,
  );
  await assertLiveCampaign(privateState);
  if (privateState.record.implementationRevision !== implementationRevision) {
    throw authorityError("authority_record_invalid");
  }
  const key = `${privateState.ledgerRoot}\0${recordSha256(privateState.record)}`;
  const existing = campaignExecutionAuthorityByRecord.get(key);
  if (existing !== undefined && existing !== input.executionAuthority) {
    throw authorityError("authority_handle_invalid");
  }
  campaignExecutionAuthorityByRecord.set(key, input.executionAuthority);
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
  priorTerminalAuthority?: Pr6rCrossStoreReconciledTerminalAuthority,
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
  if (normalizedSlotId === "hybrid_cloud_if_selected") {
    if (ledger.slots.cloud_synthesis?.terminal === undefined) {
      throw authorityError("authority_record_invalid");
    }
    const reconciled =
      priorTerminalAuthority === undefined
        ? undefined
        : await assertLiveReconciledTerminal(priorTerminalAuthority);
    if (
      reconciled === undefined ||
      reconciled.privateState.os.ledgerRoot !== privateState.ledgerRoot ||
      reconciled.privateState.os.record.slotId !== "cloud_synthesis"
    ) {
      throw authorityError("authority_handle_invalid");
    }
    if (
      JSON.stringify(ledger.slots.cloud_synthesis?.terminal) !==
      JSON.stringify(reconciled.privateState.os.terminalRecord)
    ) {
      throw authorityError("authority_record_invalid");
    }
  } else if (priorTerminalAuthority !== undefined) {
    throw authorityError("authority_input_invalid");
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
    runtime: runtimeStateForSlot(privateState.ledgerRoot, record, "claimed"),
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
    runtime: runtimeStateForSlot(privateState.ledgerRoot, claim, "claimed"),
  });
  return recoveryAuthority;
}

/** Revalidate an open nominal OS slot without exposing ledger paths or records. */
export async function readPr6rLiveSlotAuthorityBinding(
  slotAuthority: Pr6rSlotAuthority,
): Promise<Pr6rLiveSlotAuthorityBinding> {
  const privateState = slotPrivateState.get(slotAuthority);
  if (privateState === undefined) {
    throw authorityError("authority_handle_invalid");
  }
  const ledger = await assertLiveSlot(privateState);
  const slot = ledger.slots[privateState.record.slotId];
  if (
    slot === undefined ||
    slot.terminal !== undefined ||
    JSON.stringify(slot.claim) !== JSON.stringify(privateState.record)
  ) {
    throw authorityError("authority_record_invalid");
  }
  return Object.freeze({
    campaignId: PR6R_CAMPAIGN_ID,
    implementationRevision: privateState.record.implementationRevision,
    slotId: privateState.record.slotId,
    requestId: privateState.record.requestId,
    origin: privateState.record.origin,
    applicationRequestSha256: privateState.record.applicationRequestSha256,
    canonicalBodySha256: privateState.record.canonicalBodySha256,
    commonCheckpointSha256: privateState.record.commonCheckpointSha256,
    synthesisSessionId: privateState.record.synthesisSessionId,
    attemptId: privateState.record.attemptId,
    reservationId: privateState.record.reservationId,
    slotClaimSha256: recordSha256(privateState.record),
  });
}

/**
 * Perform the final asynchronous OS-ledger revalidation before SQLite reserve.
 * The returned arm is nominal and can be consumed exactly once, synchronously.
 */
export async function preparePr6rCloudSlotDispatchArm(
  slotAuthority: Pr6rSlotAuthority,
): Promise<Pr6rCloudSlotDispatchArm> {
  const privateState = slotPrivateState.get(slotAuthority);
  if (privateState === undefined) {
    throw authorityError("authority_handle_invalid");
  }
  if (privateState.runtime.phase !== "claimed") {
    throw authorityError("authority_slot_consumed");
  }
  privateState.runtime.phase = "preparing";
  const binding = await readPr6rLiveSlotAuthorityBinding(slotAuthority);
  if (privateState.runtime.phase !== "preparing") {
    throw authorityError("authority_slot_consumed");
  }
  privateState.runtime.phase = "armed";
  const arm = Object.freeze({
    status: "armed" as const,
    slotId: binding.slotId,
    requestId: binding.requestId,
    attemptId: binding.attemptId,
    reservationId: binding.reservationId,
  });
  slotDispatchArmPrivateState.set(arm, {
    slot: privateState,
    binding,
    consumed: false,
  });
  return arm;
}

/** Consume a prevalidated OS arm synchronously after SQLite admission. */
export function consumePr6rCloudSlotDispatchArm(
  arm: Pr6rCloudSlotDispatchArm,
): Pr6rConsumedOsDispatchAuthority {
  const state = slotDispatchArmPrivateState.get(arm);
  if (state === undefined) {
    throw authorityError("authority_handle_invalid");
  }
  if (state.consumed || state.slot.runtime.phase !== "armed") {
    throw authorityError("authority_slot_consumed");
  }
  state.consumed = true;
  state.slot.runtime.phase = "dispatch_consumed";
  const consumed = Object.freeze({
    status: "dispatch_consumed" as const,
    slotId: state.binding.slotId,
    requestId: state.binding.requestId,
    attemptId: state.binding.attemptId,
    reservationId: state.binding.reservationId,
  });
  consumedOsDispatchPrivateState.set(consumed, {
    slot: state.slot,
    binding: state.binding,
  });
  return consumed;
}

/** Synchronously prove the armed OS slot is still in its dispatch state. */
export function readPr6rConsumedOsDispatchAuthorityBinding(
  authority: Pr6rConsumedOsDispatchAuthority,
): Pr6rLiveSlotAuthorityBinding {
  const state = consumedOsDispatchPrivateState.get(authority);
  if (state === undefined) {
    throw authorityError("authority_handle_invalid");
  }
  if (state.slot.runtime.phase !== "dispatch_consumed") {
    throw authorityError("authority_slot_consumed");
  }
  return state.binding;
}

async function terminalizePr6rCloudSlotPrivate(
  privateState: SlotPrivateState,
  input: {
    terminalOutcome: Pr6rSlotTerminalOutcome;
    requestDisposition: Pr6rRequestDisposition;
    stableCode: string;
    terminalAt?: string;
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
    terminalAt: input.terminalAt ?? new Date().toISOString(),
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
  privateState.runtime.phase = "terminalized";
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
    runtime: privateState.runtime,
    terminalRecord: persisted,
  });
  return terminalAuthority;
}

function sqliteTerminalMatchesSlot(
  privateState: SlotTerminalPrivateState,
  sqlite: Pr6rSqliteTerminalBinding,
  request: z.infer<typeof CloudApplicationRequestV1Schema>,
  reservationId: string,
): boolean {
  const claim = privateState.record;
  const terminal = privateState.terminalRecord;
  return (
    sqlite.slotId === claim.slotId &&
    sqlite.requestId === claim.requestId &&
    sqlite.origin === claim.origin &&
    sqlite.applicationRequestSha256 === claim.applicationRequestSha256 &&
    sqlite.canonicalBodySha256 === claim.canonicalBodySha256 &&
    sqlite.commonCheckpointSha256 === claim.commonCheckpointSha256 &&
    sqlite.synthesisSessionId === claim.synthesisSessionId &&
    sqlite.attemptId === claim.attemptId &&
    sqlite.reservationId === claim.reservationId &&
    reservationId === claim.reservationId &&
    request.slotId === claim.slotId &&
    request.requestId === claim.requestId &&
    request.origin === claim.origin &&
    canonicalPr6rCloudApplicationRequestSha256(request) ===
      claim.applicationRequestSha256 &&
    request.canonicalBodySha256 === claim.canonicalBodySha256 &&
    request.commonCheckpointSha256 === claim.commonCheckpointSha256 &&
    request.synthesisSessionId === claim.synthesisSessionId &&
    request.attemptId === claim.attemptId &&
    sqlite.terminalOutcome === terminal.terminalOutcome &&
    sqlite.requestDisposition === terminal.requestDisposition &&
    sqlite.stableCode === terminal.stableCode &&
    timestampAtOrAfter(terminal.terminalAt, sqlite.terminalAt)
  );
}

function sqliteTerminalMatchesOpenSlot(
  privateState: SlotPrivateState,
  sqlite: Pr6rSqliteTerminalBinding,
  request: z.infer<typeof CloudApplicationRequestV1Schema>,
  reservationId: string,
): boolean {
  const claim = privateState.record;
  return (
    sqlite.slotId === claim.slotId &&
    sqlite.requestId === claim.requestId &&
    sqlite.origin === claim.origin &&
    sqlite.applicationRequestSha256 === claim.applicationRequestSha256 &&
    sqlite.canonicalBodySha256 === claim.canonicalBodySha256 &&
    sqlite.commonCheckpointSha256 === claim.commonCheckpointSha256 &&
    sqlite.synthesisSessionId === claim.synthesisSessionId &&
    sqlite.attemptId === claim.attemptId &&
    sqlite.reservationId === claim.reservationId &&
    reservationId === claim.reservationId &&
    request.slotId === claim.slotId &&
    request.requestId === claim.requestId &&
    request.origin === claim.origin &&
    canonicalPr6rCloudApplicationRequestSha256(request) ===
      claim.applicationRequestSha256 &&
    request.canonicalBodySha256 === claim.canonicalBodySha256 &&
    request.commonCheckpointSha256 === claim.commonCheckpointSha256 &&
    request.synthesisSessionId === claim.synthesisSessionId &&
    request.attemptId === claim.attemptId
  );
}

async function assertLiveTerminal(
  privateState: SlotTerminalPrivateState,
): Promise<Pr6rAuthorityLedgerSnapshot> {
  const ledger = await assertLiveSlot(privateState);
  const terminal = ledger.slots[privateState.record.slotId]?.terminal;
  if (
    terminal === undefined ||
    JSON.stringify(terminal) !== JSON.stringify(privateState.terminalRecord)
  ) {
    throw authorityError("authority_record_invalid");
  }
  return ledger;
}

async function assertLiveReconciledTerminal(
  authority: Pr6rCrossStoreReconciledTerminalAuthority,
): Promise<{
  privateState: ReconciledTerminalPrivateState;
  osSnapshot: Pr6rAuthorityLedgerSnapshot;
}> {
  const privateState = reconciledTerminalPrivateState.get(authority);
  if (privateState === undefined) {
    throw authorityError("authority_handle_invalid");
  }
  const osSnapshot = await assertLiveTerminal(privateState.os);
  let sqlite: Pr6rSqliteTerminalBinding;
  try {
    sqlite = revalidatePr6rSqliteTerminalWitness(privateState.sqliteWitness, {
      applicationRequest: privateState.applicationRequest,
      reservationId: privateState.reservationId,
    });
  } catch {
    throw authorityError("authority_record_invalid");
  }
  if (
    JSON.stringify(sqlite) !== JSON.stringify(privateState.sqliteBinding) ||
    !sqliteTerminalMatchesSlot(
      privateState.os,
      sqlite,
      privateState.applicationRequest,
      privateState.reservationId,
    )
  ) {
    throw authorityError("authority_record_invalid");
  }
  return { privateState, osSnapshot };
}

/**
 * Gate a comparison or safe-projection composition on fresh OS and SQLite
 * reconciliation. Raw OS terminals and structural lookalikes are rejected.
 */
export async function assertPr6rCrossStoreReconciledTerminalAuthority(
  authority: Pr6rCrossStoreReconciledTerminalAuthority,
): Promise<void> {
  await assertLiveReconciledTerminal(authority);
}

/** Require the reconciled terminal to belong to this exact SQLite ledger. */
export async function assertPr6rCrossStoreReconciledTerminalLedger(
  authority: Pr6rCrossStoreReconciledTerminalAuthority,
  ledger: BudgetLedger,
): Promise<void> {
  const live = await assertLiveReconciledTerminal(authority);
  try {
    assertPr6rSqliteTerminalWitnessLedger(
      live.privateState.sqliteWitness,
      ledger,
    );
  } catch {
    throw authorityError("authority_record_invalid");
  }
}

function comparisonMatchesReconciledTerminal(
  live: {
    privateState: ReconciledTerminalPrivateState;
    osSnapshot: Pr6rAuthorityLedgerSnapshot;
  },
  comparison: z.infer<typeof Pr6rComparisonV1Schema>,
): boolean {
  const { os, sqliteBinding: sqlite, applicationRequest: request } =
    live.privateState;
  const decision = comparison.synthesisDecisions.find(
    (candidate) => candidate.slotId === os.record.slotId,
  );
  if (decision === undefined) return false;
  const expectedState =
    sqlite.terminalOutcome === "completed"
      ? "completed"
      : sqlite.terminalOutcome === "cancelled"
        ? "cancelled"
        : "failed";
  const attempt = sqlite.attemptEvidence;
  const expectedOutputValidity =
    expectedState === "completed"
      ? {
          schemaVersion: "pr6r-output-validity-v1" as const,
          status: "post_schema_validity_deferred" as const,
          schemaAccepted: true as const,
          citationSupport: null,
          evidenceIntegrity: null,
          snapshotFreshness: null,
          coverageComplete: null,
        }
      : expectedState === "failed" &&
          SCHEMA_REJECTED_OUTPUT_CODES.has(sqlite.stableCode) &&
          attempt?.responseBodySha256 !== undefined
        ? {
            schemaVersion: "pr6r-output-validity-v1" as const,
            status: "failed" as const,
            schemaAccepted: false as const,
            citationSupport: false as const,
            evidenceIntegrity: false as const,
            snapshotFreshness: false as const,
            coverageComplete: false as const,
          }
        : {
            schemaVersion: "pr6r-output-validity-v1" as const,
            status: "not_available" as const,
            schemaAccepted: null,
            citationSupport: null,
            evidenceIntegrity: null,
            snapshotFreshness: null,
            coverageComplete: null,
          };
  const expectedTokenAccounting =
    attempt?.usage.reported === true
      ? {
          schemaVersion: "pr6r-token-accounting-v1" as const,
          reported: true as const,
          provenance: "provider_reported" as const,
          inputTokens: attempt.usage.inputTokens,
          cacheReadTokens: attempt.usage.cacheReadTokens,
          cacheWriteTokens: attempt.usage.cacheWriteTokens,
          reasoningTokens: attempt.usage.reasoningTokens,
          visibleOutputTokens: attempt.usage.outputTokens,
          totalTokens:
            attempt.usage.inputTokens +
            attempt.usage.reasoningTokens +
            attempt.usage.outputTokens,
        }
      : {
          schemaVersion: "pr6r-token-accounting-v1" as const,
          reported: false as const,
          provenance: "provider_unreported" as const,
          inputTokens: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          reasoningTokens: null,
          visibleOutputTokens: null,
          totalTokens: null,
        };
  const terminalBudget = sqlite.terminalBudgetEntry;
  let expectedSimulationCost: unknown;
  if (terminalBudget === undefined) {
    if (
      attempt !== undefined ||
      sqlite.reservationProjectedMicrousd !== undefined
    ) {
      return false;
    }
    expectedSimulationCost = {
      schemaVersion: "pr6r-simulation-cost-v1",
      pricingSnapshotId: PR6R_SIMULATION_PRICING_SNAPSHOT_ID,
      pricingSnapshotSha256:
        comparison.pricingSnapshot.pricingSnapshotSha256,
      costScope: PR6R_COST_SCOPE,
      actualPaidAuthority: false,
      actualExternalSpendMicrousd: 0,
      settlementState: "not_reserved",
      reservationId: null,
      projectedMicrousd: 0,
      reservedMicrousd: 0,
      settledMicrousd: 0,
      provenance: "not_settled",
    };
  } else {
    const projectedMicrousd = sqlite.reservationProjectedMicrousd;
    if (
      attempt === undefined ||
      projectedMicrousd === undefined ||
      terminalBudget.rowType !== "settlement" ||
      terminalBudget.reservationId !== sqlite.reservationId ||
      terminalBudget.costScope !== PR6R_COST_SCOPE ||
      terminalBudget.amountMicrousd !== attempt.cost.amountMicrousd ||
      terminalBudget.costProvenance !== attempt.cost.provenance
    ) {
      return false;
    }
    const unknown = attempt.cost.provenance === "reserved_unknown";
    if (
      (!unknown && attempt.cost.provenance !== "host_pricing_snapshot") ||
      (unknown && terminalBudget.amountMicrousd !== projectedMicrousd)
    ) {
      return false;
    }
    expectedSimulationCost = {
      schemaVersion: "pr6r-simulation-cost-v1",
      pricingSnapshotId: PR6R_SIMULATION_PRICING_SNAPSHOT_ID,
      pricingSnapshotSha256:
        comparison.pricingSnapshot.pricingSnapshotSha256,
      costScope: PR6R_COST_SCOPE,
      actualPaidAuthority: false,
      actualExternalSpendMicrousd: 0,
      settlementState: unknown ? "unknown" : "settled",
      reservationId: sqlite.reservationId,
      projectedMicrousd,
      reservedMicrousd: projectedMicrousd,
      settledMicrousd: unknown ? null : terminalBudget.amountMicrousd,
      provenance: unknown ? "reserved_unknown" : "host_pricing_snapshot",
    };
  }
  const expectedOsClaim = buildPr6rOsAuthorityClaimV1({
    implementationRevision:
      live.osSnapshot.campaign.implementationRevision,
    claimedAt: live.osSnapshot.campaign.claimedAt,
    ledgerCampaignRecordSha256: recordSha256(live.osSnapshot.campaign),
    ledgerGuardRecordSha256: recordSha256(live.osSnapshot.guard),
  });
  return (
    comparison.implementationRevision === os.record.implementationRevision &&
    comparison.parentSessionId === request.parentSessionId &&
    comparison.commonCheckpointSha256 === os.record.commonCheckpointSha256 &&
    canonicalPr6rJsonV1(comparison.osAuthorityClaim) ===
      canonicalPr6rJsonV1(expectedOsClaim) &&
    decision.synthesisSessionId === os.record.synthesisSessionId &&
    decision.applicationRequestSha256 ===
      os.record.applicationRequestSha256 &&
    decision.authoritySlotClaimSha256 === recordSha256(os.record) &&
    decision.authoritySlotTerminalSha256 ===
      recordSha256(os.terminalRecord) &&
    decision.requestBodySha256 === os.record.canonicalBodySha256 &&
    decision.state === expectedState &&
    decision.requestDisposition === sqlite.requestDisposition &&
    decision.terminalReason === sqlite.stableCode &&
    decision.synthesisLatencyMs === (attempt?.latencyMs ?? 0) &&
    decision.responseBodySha256 ===
      (attempt?.responseBodySha256 ?? null) &&
    decision.reviewResultSha256 ===
      (attempt?.reviewResultSha256 ?? null) &&
    canonicalPr6rJsonV1(decision.tokenAccounting) ===
      canonicalPr6rJsonV1(expectedTokenAccounting) &&
    canonicalPr6rJsonV1(decision.simulationCost) ===
      canonicalPr6rJsonV1(expectedSimulationCost) &&
    sameCanonicalValue(decision.outputValidity, expectedOutputValidity)
  );
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return canonicalPr6rJsonV1(left) === canonicalPr6rJsonV1(right);
}

function baselineComparisonMatchesCampaign(
  snapshot: Pr6rAuthorityLedgerSnapshot,
  replay: Pr6rCanaryReplay,
  comparison: z.infer<typeof Pr6rComparisonV1Schema>,
): boolean {
  const campaign = replay.campaign;
  const expectedOsClaim = buildPr6rOsAuthorityClaimV1({
    implementationRevision: snapshot.campaign.implementationRevision,
    claimedAt: snapshot.campaign.claimedAt,
    ledgerCampaignRecordSha256: recordSha256(snapshot.campaign),
    ledgerGuardRecordSha256: recordSha256(snapshot.guard),
  });
  return (
    Object.keys(snapshot.slots).length === 0 &&
    snapshot.fallback === undefined &&
    replay.records.length === 1 &&
    replay.comparison === undefined &&
    replay.safeProjection === undefined &&
    campaign.implementationRevision ===
      snapshot.campaign.implementationRevision &&
    sameCanonicalValue(campaign.osAuthorityClaim, expectedOsClaim) &&
    comparison.implementationRevision === campaign.implementationRevision &&
    comparison.parentSessionId === campaign.parent.sessionId &&
    comparison.commonCheckpointSha256 ===
      campaign.parent.commonCheckpoint.checkpointSha256 &&
    sameCanonicalValue(comparison.osAuthorityClaim, campaign.osAuthorityClaim) &&
    sameCanonicalValue(
      comparison.providerValidation,
      campaign.providerValidation,
    ) &&
    sameCanonicalValue(comparison.pricingSnapshot, campaign.pricingSnapshot) &&
    sameCanonicalValue(
      comparison.commonInvestigation,
      campaign.commonInvestigation,
    ) &&
    sameCanonicalValue(comparison.fallbackState, campaign.fallbackState) &&
    comparison.fallbackState.state === "available" &&
    comparison.synthesisDecisions.every((decision, index) => {
      const campaignDecision = campaign.synthesisDecisions[index];
      return (
        campaignDecision !== undefined &&
        decision.state === "pending" &&
        decision.slotId === campaignDecision.slot.slotId &&
        decision.ordinal === campaignDecision.slot.ordinal &&
        decision.parentSessionId === campaignDecision.parentSessionId &&
        decision.commonCheckpointSha256 ===
          campaignDecision.commonCheckpointSha256
      );
    })
  );
}

function comparisonChangesOnlyAuthorizedDecision(
  previous: z.infer<typeof Pr6rComparisonV1Schema>,
  next: z.infer<typeof Pr6rComparisonV1Schema>,
  slotId: Pr6rCloudSlotId,
): boolean {
  const targetIndex = slotId === "cloud_synthesis" ? 1 : 2;
  const { synthesisDecisions: previousDecisions, ...previousAggregate } =
    previous;
  const { synthesisDecisions: nextDecisions, ...nextAggregate } = next;
  return (
    sameCanonicalValue(previousAggregate, nextAggregate) &&
    previousDecisions[targetIndex]?.state === "pending" &&
    nextDecisions.every(
      (decision, index) =>
        index === targetIndex ||
        sameCanonicalValue(decision, previousDecisions[index]),
    )
  );
}

function captureComparisonProjectionAttempt<T>(
  store: Pr6rComparisonProjectionStore<T>,
  input: Pr6rComparisonProjectionAppendInput,
): {
  appendComparisonProjection: Pr6rComparisonProjectionStore<T>["appendComparisonProjection"];
  priorReplay: Pr6rCanaryReplay;
  priorReplaySha256: string;
  comparison: z.infer<typeof Pr6rComparisonV1Schema>;
  safeProjection: unknown;
  comparisonRecordId: string;
  safeProjectionRecordId: string;
  expectedSequence: number;
  createdAt: string;
} {
  const appendComparisonProjection = store.appendComparisonProjection;
  const replay = store.replay;
  if (
    typeof appendComparisonProjection !== "function" ||
    typeof replay !== "function"
  ) {
    throw authorityError("authority_input_invalid");
  }
  const comparison = parseAuthorityInput(
    Pr6rComparisonV1Schema,
    input.comparison,
  );
  const safeProjection = parseAuthorityInput(
    Pr6rSafeProjectionV1Schema,
    input.safeProjection,
  );
  const comparisonRecordId = input.comparisonRecordId;
  const safeProjectionRecordId = input.safeProjectionRecordId;
  const expectedSequence = input.expectedSequence;
  const createdAt = parseAuthorityInput(canonicalTimestamp, input.createdAt);
  if (
    typeof comparisonRecordId !== "string" ||
    typeof safeProjectionRecordId !== "string" ||
    !Number.isSafeInteger(expectedSequence)
  ) {
    throw authorityError("authority_input_invalid");
  }
  let priorReplay: Pr6rCanaryReplay | undefined;
  try {
    priorReplay = captureCanaryReplay(replay.call(store));
  } catch {
    throw authorityError("authority_record_invalid");
  }
  if (priorReplay === undefined) {
    throw authorityError("authority_record_invalid");
  }
  return {
    appendComparisonProjection,
    priorReplay,
    priorReplaySha256: canaryReplaySha256(priorReplay),
    comparison,
    safeProjection,
    comparisonRecordId,
    safeProjectionRecordId,
    expectedSequence,
    createdAt,
  };
}

function comparisonProjectionAppendSha256(value: object): string {
  try {
    return createHash("sha256")
      .update(canonicalPr6rJsonV1(value))
      .digest("hex");
  } catch {
    throw authorityError("authority_input_invalid");
  }
}

function assertComparisonProjectionAppendPostcondition<T>(
  store: Pr6rComparisonProjectionStore<T>,
  captured: ReturnType<typeof captureComparisonProjectionAttempt<T>>,
): void {
  let replay: Pr6rCanaryReplay | undefined;
  try {
    replay = captureCanaryReplay(store.replay());
  } catch {
    throw authorityError("authority_record_invalid");
  }
  const priorCount = captured.priorReplay.records.length;
  const comparisonRecord = replay?.records[priorCount];
  const safeProjectionRecord = replay?.records[priorCount + 1];
  if (
    replay === undefined ||
    captured.expectedSequence !== priorCount ||
    replay.records.length !== priorCount + 2 ||
    !sameCanonicalValue(
      replay.records.slice(0, priorCount),
      captured.priorReplay.records,
    ) ||
    !sameCanonicalValue(replay.campaign, captured.priorReplay.campaign) ||
    !sameCanonicalValue(replay.comparison, captured.comparison) ||
    !sameCanonicalValue(replay.safeProjection, captured.safeProjection) ||
    comparisonRecord?.id !== captured.comparisonRecordId ||
    comparisonRecord.sequence !== priorCount + 1 ||
    comparisonRecord.recordType !== "comparison" ||
    comparisonRecord.createdAt !== captured.createdAt ||
    !sameCanonicalValue(comparisonRecord.payload, captured.comparison) ||
    safeProjectionRecord?.id !== captured.safeProjectionRecordId ||
    safeProjectionRecord.sequence !== priorCount + 2 ||
    safeProjectionRecord.recordType !== "safe_projection" ||
    safeProjectionRecord.createdAt !== captured.createdAt ||
    !sameCanonicalValue(safeProjectionRecord.payload, captured.safeProjection)
  ) {
    throw authorityError("authority_record_invalid");
  }
}

function mintComparisonProjectionUseAuthority<T>(
  publicAuthority: Pr6rComparisonProjectionUseAuthority,
  store: Pr6rComparisonProjectionStore<T>,
  captured: ReturnType<typeof captureComparisonProjectionAttempt<T>>,
): T {
  const appendInput = deepFreezeAuthorityInput({
    authority: publicAuthority,
    comparisonRecordId: captured.comparisonRecordId,
    safeProjectionRecordId: captured.safeProjectionRecordId,
    expectedSequence: captured.expectedSequence,
    comparison: captured.comparison,
    safeProjection: captured.safeProjection,
    createdAt: captured.createdAt,
  });
  const privateState = {
    consumed: false,
    store,
    appendInput,
    appendInputSha256: comparisonProjectionAppendSha256(appendInput),
    priorRecordCount: captured.priorReplay.records.length,
    priorReplaySha256: captured.priorReplaySha256,
  };
  downstreamUsePrivateState.set(publicAuthority, privateState);
  let result: T;
  try {
    result = captured.appendComparisonProjection.call(store, appendInput);
  } catch (error) {
    privateState.consumed = true;
    throw error;
  }
  if (!privateState.consumed) {
    privateState.consumed = true;
    throw authorityError("authority_handle_invalid");
  }
  if (
    typeof result === "object" &&
    result !== null &&
    "then" in result &&
    typeof result.then === "function"
  ) {
    throw authorityError("authority_input_invalid");
  }
  assertComparisonProjectionAppendPostcondition(store, captured);
  return result;
}

/** Consume the exact one-use token attached to one exact store append call. */
export function consumePr6rComparisonProjectionUseAuthority(
  authority: unknown,
  input: {
    store: object;
    appendInput: object;
    priorReplay: Pr6rCanaryReplay | undefined;
  },
): void {
  if (
    typeof authority !== "object" ||
    authority === null ||
    typeof input.store !== "object" ||
    input.store === null ||
    typeof input.appendInput !== "object" ||
    input.appendInput === null
  ) {
    throw authorityError("authority_handle_invalid");
  }
  const privateState = downstreamUsePrivateState.get(
    authority as Pr6rComparisonProjectionUseAuthority,
  );
  if (
    privateState === undefined ||
    privateState.consumed
  ) {
    throw authorityError("authority_handle_invalid");
  }
  privateState.consumed = true;
  if (
    privateState.store !== input.store ||
    privateState.appendInput !== input.appendInput
  ) {
    throw authorityError("authority_handle_invalid");
  }
  if (
    comparisonProjectionAppendSha256(input.appendInput) !==
    privateState.appendInputSha256
  ) {
    throw authorityError("authority_record_invalid");
  }
  const priorReplay = captureCanaryReplay(input.priorReplay);
  if (
    priorReplay === undefined ||
    priorReplay.records.length !== privateState.priorRecordCount ||
    canaryReplaySha256(priorReplay) !== privateState.priorReplaySha256
  ) {
    throw authorityError("authority_record_invalid");
  }
}

/** Append the sole canonical all-pending baseline from a live empty campaign. */
export async function appendPr6rInitialComparisonProjectionWithCampaignAuthority<T>(
  authority: Pr6rCampaignAuthority,
  store: Pr6rComparisonProjectionStore<T>,
  input: Pr6rComparisonProjectionAppendInput,
): Promise<T> {
  const privateState = campaignPrivateState.get(authority);
  if (privateState === undefined) {
    throw authorityError("authority_handle_invalid");
  }
  const baselineKey = `${privateState.ledgerRoot}\0${recordSha256(privateState.record)}`;
  if (initialBaselineUseByCampaign.has(baselineKey)) {
    throw authorityError("authority_slot_consumed");
  }
  initialBaselineUseByCampaign.add(baselineKey);
  const observedAt = new Date().toISOString();
  const captured = captureComparisonProjectionAttempt(store, input);
  const snapshot = await assertLiveCampaign(privateState);
  if (
    captured.expectedSequence !== 1 ||
    !baselineComparisonMatchesCampaign(
      snapshot,
      captured.priorReplay,
      captured.comparison,
    ) ||
    !timestampAtOrAfter(captured.createdAt, snapshot.campaign.claimedAt) ||
    !timestampAtOrAfter(observedAt, captured.createdAt)
  ) {
    throw authorityError("authority_record_invalid");
  }
  const useAuthority = Object.freeze({
    kind: "pr6r_comparison_projection_use" as const,
    scope: "initial_baseline" as const,
    campaignId: PR6R_CAMPAIGN_ID,
  });
  return mintComparisonProjectionUseAuthority(useAuthority, store, captured);
}

/**
 * Revalidate both stores, mint a private one-use capability, and consume it in
 * the same synchronous turn around the comparison/safe-projection append.
 * The store append itself consumes the capability, so a raw OS terminal,
 * structural input, or cloned handle cannot append.
 */
export async function appendPr6rComparisonProjectionWithReconciledAuthority<T>(
  authority: Pr6rCrossStoreReconciledTerminalAuthority,
  store: Pr6rComparisonProjectionStore<T>,
  input: Pr6rComparisonProjectionAppendInput,
): Promise<T> {
  const terminalState = reconciledTerminalPrivateState.get(authority);
  if (terminalState === undefined) {
    throw authorityError("authority_handle_invalid");
  }
  if (terminalState.comparisonTransitionConsumed) {
    throw authorityError("authority_slot_consumed");
  }
  // Reserve this terminal synchronously before the first await. Failure at
  // any later validation or append point burns the transition authority.
  terminalState.comparisonTransitionConsumed = true;
  const observedAt = new Date().toISOString();
  const captured = captureComparisonProjectionAttempt(store, input);
  const reconciled = await assertLiveReconciledTerminal(authority);
  const previous = captured.priorReplay.comparison;
  if (
    previous === undefined ||
    captured.priorReplay.safeProjection === undefined ||
    captured.expectedSequence !== captured.priorReplay.records.length ||
    !comparisonChangesOnlyAuthorizedDecision(
      previous,
      captured.comparison,
      reconciled.privateState.os.record.slotId,
    ) ||
    !comparisonMatchesReconciledTerminal(reconciled, captured.comparison)
  ) {
    throw authorityError("authority_record_invalid");
  }
  if (
    !timestampAtOrAfter(
      captured.createdAt,
      reconciled.privateState.os.terminalRecord.terminalAt,
    ) ||
    !timestampAtOrAfter(observedAt, captured.createdAt)
  ) {
    throw authorityError("authority_input_invalid");
  }
  const useAuthority = Object.freeze({
    kind: "pr6r_comparison_projection_use" as const,
    scope: "terminal_transition" as const,
    campaignId: PR6R_CAMPAIGN_ID,
    requestId: reconciled.privateState.os.record.requestId,
    attemptId: reconciled.privateState.os.record.attemptId,
    reservationId: reconciled.privateState.os.record.reservationId,
  });
  return mintComparisonProjectionUseAuthority(useAuthority, store, captured);
}

function mintReconciledTerminalAuthority(
  os: SlotTerminalPrivateState,
  input: {
    sqliteWitness: Pr6rSqliteTerminalWitness;
    sqliteBinding: Pr6rSqliteTerminalBinding;
    applicationRequest: z.infer<typeof CloudApplicationRequestV1Schema>;
    reservationId: string;
  },
): Pr6rCrossStoreReconciledTerminalAuthority {
  const authority = Object.freeze({
    status: "cross_store_reconciled" as const,
    campaignId: PR6R_CAMPAIGN_ID,
    slotId: os.record.slotId,
    requestId: os.record.requestId,
    synthesisSessionId: os.record.synthesisSessionId,
    attemptId: os.record.attemptId,
    reservationId: os.record.reservationId,
    terminalOutcome: os.terminalRecord.terminalOutcome,
    requestDisposition: os.terminalRecord.requestDisposition,
    stableCode: os.terminalRecord.stableCode,
    osTerminalRecordSha256: recordSha256(os.terminalRecord),
  });
  reconciledTerminalPrivateState.set(authority, {
    os,
    sqliteWitness: input.sqliteWitness,
    sqliteBinding: input.sqliteBinding,
    applicationRequest: input.applicationRequest,
    reservationId: input.reservationId,
    comparisonTransitionConsumed: false,
  });
  return authority;
}

async function consumeSqliteReceiptForTerminal(
  terminalAuthority: Pr6rSlotTerminalAuthority,
  input: {
    sqliteTerminalReceipt: Pr6rSqliteTerminalReceipt;
    applicationRequest: unknown;
    reservationId: string;
  },
): Promise<Pr6rCrossStoreReconciledTerminalAuthority> {
  const privateState = slotTerminalPrivateState.get(terminalAuthority);
  if (privateState === undefined) {
    throw authorityError("authority_handle_invalid");
  }
  await assertLiveTerminal(privateState);
  const request = parseAuthorityInput(
    CloudApplicationRequestV1Schema,
    input.applicationRequest,
  );
  let reconciliation: {
    binding: Pr6rSqliteTerminalBinding;
    witness: Pr6rSqliteTerminalWitness;
  };
  try {
    reconciliation = consumePr6rSqliteTerminalReceiptForReconciliation(
      input.sqliteTerminalReceipt,
      {
        applicationRequest: request,
        reservationId: input.reservationId,
      },
    );
  } catch {
    throw authorityError("authority_handle_invalid");
  }
  if (
    !sqliteTerminalMatchesSlot(
      privateState,
      reconciliation.binding,
      request,
      input.reservationId,
    )
  ) {
    throw authorityError("authority_record_invalid");
  }
  return mintReconciledTerminalAuthority(privateState, {
    sqliteWitness: reconciliation.witness,
    sqliteBinding: reconciliation.binding,
    applicationRequest: request,
    reservationId: input.reservationId,
  });
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
  const terminalInput = parseAuthorityInput(TerminalInputSchema, {
    terminalOutcome: input.terminalOutcome,
    requestDisposition: input.requestDisposition,
    stableCode: input.stableCode,
    terminalAt: new Date().toISOString(),
  });
  if (!timestampAtOrAfter(terminalInput.terminalAt, privateState.record.claimedAt)) {
    throw authorityError("authority_input_invalid");
  }
  if (privateState.runtime.phase !== "claimed") {
    throw authorityError("authority_slot_consumed");
  }
  privateState.runtime.phase = "terminalizing";
  return terminalizePr6rCloudSlotPrivate(privateState, terminalInput);
}

/**
 * Publish an OS terminal only from one genuine SQLite terminal/accounting
 * receipt, then return the sole downstream-capable reconciled authority.
 */
export async function terminalizePr6rCloudSlotFromSqliteReceipt(
  slotAuthority: Pr6rSlotAuthority | Pr6rSlotRecoveryAuthority,
  input: {
    sqliteTerminalReceipt: Pr6rSqliteTerminalReceipt;
    applicationRequest: unknown;
    reservationId: string;
  },
): Promise<Pr6rCrossStoreReconciledTerminalAuthority> {
  const directState = slotPrivateState.get(
    slotAuthority as Pr6rSlotAuthority,
  );
  const recoveryState = slotRecoveryPrivateState.get(
    slotAuthority as Pr6rSlotRecoveryAuthority,
  );
  const privateState = directState ?? recoveryState;
  if (privateState === undefined) {
    throw authorityError("authority_handle_invalid");
  }
  const dispatchState = privateState.runtime.phase;
  if (
    recoveryState === undefined &&
    dispatchState !== "armed" &&
    dispatchState !== "dispatch_consumed"
  ) {
    throw authorityError("authority_slot_consumed");
  }
  if (recoveryState !== undefined && dispatchState !== "claimed") {
    throw authorityError("authority_slot_consumed");
  }
  privateState.runtime.phase = "terminalizing";
  const ledger = await assertLiveSlot(privateState);
  if (ledger.slots[privateState.record.slotId]?.terminal !== undefined) {
    throw authorityError("authority_terminal_exists");
  }
  const request = parseAuthorityInput(
    CloudApplicationRequestV1Schema,
    input.applicationRequest,
  );
  let reconciliation: {
    binding: Pr6rSqliteTerminalBinding;
    witness: Pr6rSqliteTerminalWitness;
  };
  try {
    reconciliation = consumePr6rSqliteTerminalReceiptForReconciliation(
      input.sqliteTerminalReceipt,
      {
        applicationRequest: request,
        reservationId: input.reservationId,
      },
    );
  } catch {
    throw authorityError("authority_handle_invalid");
  }
  const sqlite = reconciliation.binding;
  if (!sqliteTerminalMatchesOpenSlot(privateState, sqlite, request, input.reservationId)) {
    throw authorityError("authority_record_invalid");
  }
  if (
    recoveryState === undefined &&
    ((dispatchState === "armed" && sqlite.requestDisposition !== "not_sent") ||
      (dispatchState === "dispatch_consumed" &&
        sqlite.requestDisposition === "not_sent"))
  ) {
    throw authorityError("authority_record_invalid");
  }
  const terminal = await terminalizePr6rCloudSlotPrivate(privateState, {
    terminalOutcome: sqlite.terminalOutcome,
    requestDisposition: sqlite.requestDisposition,
    stableCode: sqlite.stableCode,
    terminalAt: maxCanonicalTimestamp(
      new Date().toISOString(),
      sqlite.terminalAt,
    ),
  });
  const terminalPrivate = slotTerminalPrivateState.get(terminal);
  if (
    terminalPrivate === undefined ||
    !sqliteTerminalMatchesSlot(
      terminalPrivate,
      sqlite,
      request,
      input.reservationId,
    )
  ) {
    throw authorityError("authority_record_invalid");
  }
  return mintReconciledTerminalAuthority(terminalPrivate, {
    sqliteWitness: reconciliation.witness,
    sqliteBinding: sqlite,
    applicationRequest: request,
    reservationId: input.reservationId,
  });
}

/** Reconcile an already-persisted OS terminal with fresh trusted SQLite replay. */
export async function reconcilePr6rCloudSlotTerminal(
  terminalAuthority: Pr6rSlotTerminalAuthority,
  input: {
    sqliteTerminalReceipt: Pr6rSqliteTerminalReceipt;
    applicationRequest: unknown;
    reservationId: string;
  },
): Promise<Pr6rCrossStoreReconciledTerminalAuthority> {
  return consumeSqliteReceiptForTerminal(terminalAuthority, input);
}

export async function terminalizeRecoveredPr6rCloudSlot(
  recoveryAuthority: Pr6rSlotRecoveryAuthority,
): Promise<Pr6rSlotTerminalAuthority> {
  const privateState = slotRecoveryPrivateState.get(recoveryAuthority);
  if (privateState === undefined) {
    throw authorityError("authority_handle_invalid");
  }
  throw authorityError("authority_handle_invalid");
}

export async function recoverPr6rPersistedCloudSlotTerminal(
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
    terminal.slotClaimSha256 !== recordSha256(claim)
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
  const runtime = runtimeStateForSlot(
    privateState.ledgerRoot,
    claim,
    "terminalized",
  );
  runtime.phase = "terminalized";
  slotTerminalPrivateState.set(terminalAuthority, {
    ledgerRoot: privateState.ledgerRoot,
    record: claim,
    runtime,
    terminalRecord: terminal,
  });
  return terminalAuthority;
}

/**
 * Compatibility recovery returns only raw OS evidence. It cannot authorize
 * fallback until reconcilePr6rCloudSlotTerminal consumes matching SQLite proof.
 */
export async function recoverPr6rFailedTerminalForFallback(
  authority: Pr6rCampaignAuthority,
  input: Pr6rCloudSlotBinding,
): Promise<Pr6rSlotTerminalAuthority> {
  const terminal = await recoverPr6rPersistedCloudSlotTerminal(authority, input);
  if (terminal.terminalOutcome !== "failed") {
    throw authorityError("authority_record_invalid");
  }
  return terminal;
}

export async function claimPr6rLocalFallback(
  terminalAuthority: Pr6rCrossStoreReconciledTerminalAuthority,
): Promise<Pr6rFallbackClaimResult> {
  const reconciled = await assertLiveReconciledTerminal(terminalAuthority);
  const privateState = reconciled.privateState.os;
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
