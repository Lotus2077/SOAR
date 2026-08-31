import type {
  InferenceAttemptRecord,
  SessionState,
} from "../shared/session-reducer";
import {
  RuntimeCostScopeSchema,
  type CostScope,
  type RuntimeCostScope,
} from "../shared/hybrid-simulation-contracts";
import { EventStore } from "./event-store";
import type { SoarDatabase } from "./database";

const MICROUSD_PER_MILLION_TOKENS = 1_000_000n;
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_ID_LENGTH = 256;

export const BUDGET_ROUNDING_POLICY = "ceil_each_component_v1" as const;
export const BUDGET_CACHE_ASSUMPTION = "no_cache_credit" as const;

export type BudgetTerminalRowType = "settlement" | "release" | "overrun";
export type BudgetCostProvenance =
  | "provider_reported"
  | "host_pricing_snapshot"
  | "reserved_unknown";
export type BudgetRequestDisposition = "not_sent" | "sent" | "unknown";

export interface CreateBudgetCampaignInput {
  id: string;
  providerId: string;
  credentialMetadataId: string;
  openingExposureMicrousd: number;
  automaticStopMicrousd: number;
  hardCeilingMicrousd: number;
  costScope: RuntimeCostScope;
  createdAt: string;
}

export interface BudgetCampaign {
  id: string;
  providerId: string;
  credentialMetadataId: string;
  openingExposureMicrousd: number;
  automaticStopMicrousd: number;
  hardCeilingMicrousd: number;
  costScope: CostScope;
  createdAt: string;
}

export interface BudgetProjectionInput {
  billableInputTokens: number;
  billableCacheReadTokens: number;
  requestedMaxOutputTokens: number;
  inputMicrousdPerMillionTokens: number;
  outputMicrousdPerMillionTokens: number;
  cacheReadMicrousdPerMillionTokens?: number;
  providerFeeCeilingMicrousd: number;
  cacheAssumption: typeof BUDGET_CACHE_ASSUMPTION;
}

export interface BudgetBillingSnapshot {
  billableInputTokens: number;
  billableCacheReadTokens: number;
  requestedMaxOutputTokens: number;
  inputMicrousdPerMillionTokens: number;
  outputMicrousdPerMillionTokens: number;
  cacheReadMicrousdPerMillionTokens?: number;
  providerFeeCeilingMicrousd: number;
  roundingPolicy: typeof BUDGET_ROUNDING_POLICY;
  projectedCostMicrousd: number;
  remainingEpisodeMicrousd: number;
  remainingCampaignMicrousd: number;
}

export interface BudgetPosition {
  campaignId: string;
  sessionId: string;
  episodeCapMicrousd: number;
  episodeExposureMicrousd: number;
  campaignExposureMicrousd: number;
  remainingEpisodeMicrousd: number;
  remainingAutomaticStopMicrousd: number;
  remainingHardCeilingMicrousd: number;
  remainingCampaignMicrousd: number;
  automaticStopMicrousd: number;
  hardCeilingMicrousd: number;
  campaignDisabled: boolean;
}

export interface BudgetReservation {
  id: string;
  campaignId: string;
  sessionId: string;
  attemptId: string;
  providerId: string;
  pricingSnapshotId: string;
  costScope: CostScope;
  cloudEgressAdmissionId?: string;
  amountMicrousd: number;
  billableEstimatedInputTokens: number;
  requestedMaxOutputTokens: number;
  cacheReadTokensAssumed: number;
  inputRateMicrousdPerMillion: number;
  outputRateMicrousdPerMillion: number;
  cacheReadRateMicrousdPerMillion: number;
  providerFeeCeilingMicrousd: number;
  cacheAssumption: typeof BUDGET_CACHE_ASSUMPTION;
  roundingPolicy: typeof BUDGET_ROUNDING_POLICY;
  createdAt: string;
}

export interface BudgetTerminalEntry {
  id: string;
  rowType: BudgetTerminalRowType;
  campaignId: string;
  reservationId: string;
  costScope: CostScope;
  amountMicrousd: number;
  costProvenance?: BudgetCostProvenance;
  requestDisposition: BudgetRequestDisposition;
  reasonCode?: string;
  createdAt: string;
}

export interface BudgetCostScopeAmounts {
  rowCount: number;
  openingExposureMicrousd: number;
  outstandingReservationMicrousd: number;
  settledMicrousd: number;
}

export interface BudgetCostScopeSummary {
  actual: BudgetCostScopeAmounts;
  simulation: BudgetCostScopeAmounts;
  legacyUnclassified: BudgetCostScopeAmounts & { present: boolean };
}

export type BudgetDenialReason =
  | "campaign_overrun"
  | "episode_cap"
  | "campaign_automatic_stop"
  | "campaign_hard_ceiling";

export type BudgetReservationResolution =
  | {
      status: "admitted";
      billing: BudgetBillingSnapshot;
      position: BudgetPosition;
      reservation: BudgetReservation;
    }
  | {
      status: "denied";
      reason: BudgetDenialReason;
      billing: BudgetBillingSnapshot;
      position: BudgetPosition;
    };

export interface ReserveBudgetInput {
  campaignId: string;
  reservationId: string;
  sessionId: string;
  attemptId: string;
  providerId: string;
  pricingSnapshotId: string;
  costScope: RuntimeCostScope;
  cloudEgressAdmissionId?: string;
  episodeCapMicrousd: number;
  projection: BudgetProjectionInput;
  createdAt: string;
}

export interface ResolveBudgetReservationInput {
  terminalEntryId: string;
  reservationId: string;
  rowType: BudgetTerminalRowType;
  amountMicrousd: number;
  costProvenance?: BudgetCostProvenance;
  requestDisposition: BudgetRequestDisposition;
  reasonCode?: string;
  createdAt: string;
}

interface CampaignRow {
  id: string;
  provider_id: string;
  credential_metadata_id: string;
  amount_microusd: bigint;
  opening_exposure_microusd: bigint;
  automatic_stop_microusd: bigint;
  hard_ceiling_microusd: bigint;
  cost_scope: CostScope;
  created_at: string;
}

interface ReservationRow {
  id: string;
  campaign_id: string;
  session_id: string;
  attempt_id: string;
  provider_id: string;
  pricing_snapshot_id: string;
  cost_scope: CostScope;
  cloud_egress_admission_id: string | null;
  amount_microusd: bigint;
  billable_estimated_input_tokens: bigint;
  requested_max_output_tokens: bigint;
  cache_read_tokens_assumed: bigint;
  input_rate_microusd_per_million: bigint;
  output_rate_microusd_per_million: bigint;
  cache_read_rate_microusd_per_million: bigint;
  provider_fee_ceiling_microusd: bigint;
  cache_assumption: string;
  rounding_policy: string;
  created_at: string;
}

interface ExposureRow {
  id: string;
  row_type: "reservation" | BudgetTerminalRowType;
  reservation_id: string;
  session_id: string | null;
  amount_microusd: bigint;
  cost_scope: CostScope;
}

interface TerminalRow {
  id: string;
  row_type: BudgetTerminalRowType;
  campaign_id: string;
  reservation_id: string;
  cost_scope: CostScope;
  amount_microusd: bigint;
  cost_provenance: BudgetCostProvenance | null;
  request_disposition: BudgetRequestDisposition;
  reason_code: string | null;
  created_at: string;
}

interface AttemptEventPayloadRow {
  session_id: string;
  payload_json: string;
}

interface CostScopeAggregateRow {
  cost_scope: CostScope;
  row_count: bigint;
  opening_exposure_microusd: bigint;
  outstanding_reservation_microusd: bigint;
  settled_microusd: bigint;
}

function assertBoundedId(value: string, label: string): string {
  if (value !== value.trim() || value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw new RangeError(`${label} must be a trimmed non-empty ID of at most 256 characters`);
  }
  return value;
}

function assertReasonCode(value: string, label = "reasonCode"): string {
  if (
    value !== value.trim() ||
    value.length === 0 ||
    value.length > 128 ||
    !/^[a-z0-9][a-z0-9._-]*$/u.test(value)
  ) {
    throw new RangeError(`${label} must be a bounded canonical reason code`);
  }
  return value;
}

function assertCanonicalTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== value) {
    throw new RangeError(`createdAt must be a canonical ISO timestamp: ${value}`);
  }
  return value;
}

function assertSafeInteger(
  value: number,
  label: string,
  options: { positive?: boolean } = {},
): number {
  if (
    !Number.isSafeInteger(value) ||
    (options.positive ? value <= 0 : value < 0)
  ) {
    throw new RangeError(
      `${label} must be a ${options.positive ? "positive" : "non-negative"} safe integer`,
    );
  }
  return value;
}

function normalizeCampaignInput(
  input: CreateBudgetCampaignInput,
): CreateBudgetCampaignInput {
  const normalized = {
    id: assertBoundedId(input.id, "campaignId"),
    providerId: assertBoundedId(input.providerId, "providerId"),
    credentialMetadataId: assertBoundedId(
      input.credentialMetadataId,
      "credentialMetadataId",
    ),
    openingExposureMicrousd: assertSafeInteger(
      input.openingExposureMicrousd,
      "openingExposureMicrousd",
    ),
    automaticStopMicrousd: assertSafeInteger(
      input.automaticStopMicrousd,
      "automaticStopMicrousd",
    ),
    hardCeilingMicrousd: assertSafeInteger(
      input.hardCeilingMicrousd,
      "hardCeilingMicrousd",
      { positive: true },
    ),
    costScope: RuntimeCostScopeSchema.parse(input.costScope),
    createdAt: assertCanonicalTimestamp(input.createdAt),
  };
  if (
    normalized.openingExposureMicrousd > normalized.automaticStopMicrousd ||
    normalized.automaticStopMicrousd > normalized.hardCeilingMicrousd
  ) {
    throw new RangeError(
      "campaign limits require opening exposure <= automatic stop <= hard ceiling",
    );
  }
  return normalized;
}

function campaignMatchesInput(
  campaign: BudgetCampaign,
  input: CreateBudgetCampaignInput,
): boolean {
  return (
    campaign.id === input.id &&
    campaign.providerId === input.providerId &&
    campaign.credentialMetadataId === input.credentialMetadataId &&
    campaign.openingExposureMicrousd === input.openingExposureMicrousd &&
    campaign.automaticStopMicrousd === input.automaticStopMicrousd &&
    campaign.hardCeilingMicrousd === input.hardCeilingMicrousd &&
    campaign.costScope === input.costScope &&
    campaign.createdAt === input.createdAt
  );
}

function safeNumber(value: bigint, label: string): number {
  if (value < 0n || value > MAX_SAFE_INTEGER) {
    throw new RangeError(`${label} exceeds the supported safe-integer range`);
  }
  return Number(value);
}

function ceilTokenComponent(tokens: number, rate: number): bigint {
  const product = BigInt(tokens) * BigInt(rate);
  return (product + MICROUSD_PER_MILLION_TOKENS - 1n) /
    MICROUSD_PER_MILLION_TOKENS;
}

export function projectWorstCaseCostMicrousd(
  input: BudgetProjectionInput,
): number {
  assertSafeInteger(input.billableInputTokens, "billableInputTokens");
  assertSafeInteger(input.billableCacheReadTokens, "billableCacheReadTokens");
  assertSafeInteger(input.requestedMaxOutputTokens, "requestedMaxOutputTokens", {
    positive: true,
  });
  assertSafeInteger(
    input.inputMicrousdPerMillionTokens,
    "inputMicrousdPerMillionTokens",
  );
  assertSafeInteger(
    input.outputMicrousdPerMillionTokens,
    "outputMicrousdPerMillionTokens",
  );
  if (input.cacheReadMicrousdPerMillionTokens !== undefined) {
    assertSafeInteger(
      input.cacheReadMicrousdPerMillionTokens,
      "cacheReadMicrousdPerMillionTokens",
    );
    if (
      input.cacheReadMicrousdPerMillionTokens >
      input.inputMicrousdPerMillionTokens
    ) {
      throw new RangeError(
        "no_cache_credit requires the cache-read rate not to exceed the input rate",
      );
    }
  } else if (input.billableCacheReadTokens !== 0) {
    throw new RangeError("billable cache-read tokens require a cache-read rate");
  }
  assertSafeInteger(
    input.providerFeeCeilingMicrousd,
    "providerFeeCeilingMicrousd",
  );
  if (input.cacheAssumption !== BUDGET_CACHE_ASSUMPTION) {
    throw new RangeError(`unsupported cache assumption: ${String(input.cacheAssumption)}`);
  }

  const projected =
    ceilTokenComponent(
      input.billableInputTokens,
      input.inputMicrousdPerMillionTokens,
    ) +
    ceilTokenComponent(
      input.requestedMaxOutputTokens,
      input.outputMicrousdPerMillionTokens,
    ) +
    ceilTokenComponent(
      input.billableCacheReadTokens,
      input.cacheReadMicrousdPerMillionTokens ?? 0,
    ) +
    BigInt(input.providerFeeCeilingMicrousd);
  return safeNumber(projected, "projected cost");
}

function toCampaign(row: CampaignRow): BudgetCampaign {
  return {
    id: row.id,
    providerId: row.provider_id,
    credentialMetadataId: row.credential_metadata_id,
    openingExposureMicrousd: safeNumber(
      row.opening_exposure_microusd,
      "campaign opening exposure",
    ),
    automaticStopMicrousd: safeNumber(
      row.automatic_stop_microusd,
      "campaign automatic stop",
    ),
    hardCeilingMicrousd: safeNumber(
      row.hard_ceiling_microusd,
      "campaign hard ceiling",
    ),
    costScope: row.cost_scope,
    createdAt: row.created_at,
  };
}

function toReservation(row: ReservationRow): BudgetReservation {
  if (
    row.cache_assumption !== BUDGET_CACHE_ASSUMPTION ||
    row.rounding_policy !== BUDGET_ROUNDING_POLICY
  ) {
    throw new Error(`Reservation ${row.id} uses an unsupported accounting contract`);
  }
  return {
    id: row.id,
    campaignId: row.campaign_id,
    sessionId: row.session_id,
    attemptId: row.attempt_id,
    providerId: row.provider_id,
    pricingSnapshotId: row.pricing_snapshot_id,
    costScope: row.cost_scope,
    ...(row.cloud_egress_admission_id === null
      ? {}
      : { cloudEgressAdmissionId: row.cloud_egress_admission_id }),
    amountMicrousd: safeNumber(row.amount_microusd, "reservation amount"),
    billableEstimatedInputTokens: safeNumber(
      row.billable_estimated_input_tokens,
      "reservation input tokens",
    ),
    requestedMaxOutputTokens: safeNumber(
      row.requested_max_output_tokens,
      "reservation output tokens",
    ),
    cacheReadTokensAssumed: safeNumber(
      row.cache_read_tokens_assumed,
      "reservation cache-read tokens",
    ),
    inputRateMicrousdPerMillion: safeNumber(
      row.input_rate_microusd_per_million,
      "reservation input rate",
    ),
    outputRateMicrousdPerMillion: safeNumber(
      row.output_rate_microusd_per_million,
      "reservation output rate",
    ),
    cacheReadRateMicrousdPerMillion: safeNumber(
      row.cache_read_rate_microusd_per_million,
      "reservation cache-read rate",
    ),
    providerFeeCeilingMicrousd: safeNumber(
      row.provider_fee_ceiling_microusd,
      "reservation provider fee",
    ),
    cacheAssumption: BUDGET_CACHE_ASSUMPTION,
    roundingPolicy: BUDGET_ROUNDING_POLICY,
    createdAt: row.created_at,
  };
}

function toTerminal(row: TerminalRow): BudgetTerminalEntry {
  return {
    id: row.id,
    rowType: row.row_type,
    campaignId: row.campaign_id,
    reservationId: row.reservation_id,
    costScope: row.cost_scope,
    amountMicrousd: safeNumber(row.amount_microusd, "terminal amount"),
    ...(row.cost_provenance === null
      ? {}
      : { costProvenance: row.cost_provenance }),
    requestDisposition: row.request_disposition,
    ...(row.reason_code === null ? {} : { reasonCode: row.reason_code }),
    createdAt: row.created_at,
  };
}

function v2EpisodeCap(state: SessionState): number {
  if (state.executionPolicy?.schemaVersion !== "agentic-execution-v2") {
    throw new Error(`Session ${state.id} does not have an agentic-execution-v2 policy`);
  }
  return assertSafeInteger(
    state.executionPolicy.maxPaidEpisodeMicrousd,
    "episode cap",
  );
}

function reconciliationFailure(subjectId: string, detail: string): never {
  throw new Error(
    `Budget/event reconciliation failed for ${subjectId}: ${detail}`,
  );
}

function persistedEventCostScope(
  scope: "simulation" | "actual" | undefined,
): CostScope {
  return scope ?? "legacy_unclassified";
}

function assertReservationProjection(reservation: BudgetReservation): void {
  if (reservation.amountMicrousd <= 0) {
    reconciliationFailure(reservation.id, "reservation amount is not positive");
  }
  let projectedCostMicrousd: number;
  try {
    projectedCostMicrousd = projectWorstCaseCostMicrousd({
      billableInputTokens: reservation.billableEstimatedInputTokens,
      billableCacheReadTokens: reservation.cacheReadTokensAssumed,
      requestedMaxOutputTokens: reservation.requestedMaxOutputTokens,
      inputMicrousdPerMillionTokens:
        reservation.inputRateMicrousdPerMillion,
      outputMicrousdPerMillionTokens:
        reservation.outputRateMicrousdPerMillion,
      cacheReadMicrousdPerMillionTokens:
        reservation.cacheReadRateMicrousdPerMillion,
      providerFeeCeilingMicrousd:
        reservation.providerFeeCeilingMicrousd,
      cacheAssumption: reservation.cacheAssumption,
    });
  } catch {
    reconciliationFailure(reservation.id, "invalid reservation projection");
  }
  if (projectedCostMicrousd !== reservation.amountMicrousd) {
    reconciliationFailure(
      reservation.id,
      "reservation amount does not match its persisted projection",
    );
  }
}

function billingMatchesReservation(
  billing: NonNullable<SessionState["routingDecisions"][number]["billing"]>,
  reservation: BudgetReservation,
): boolean {
  return (
    billing.billableInputTokens ===
      reservation.billableEstimatedInputTokens &&
    billing.billableCacheReadTokens === reservation.cacheReadTokensAssumed &&
    billing.requestedMaxOutputTokens ===
      reservation.requestedMaxOutputTokens &&
    billing.inputMicrousdPerMillionTokens ===
      reservation.inputRateMicrousdPerMillion &&
    billing.outputMicrousdPerMillionTokens ===
      reservation.outputRateMicrousdPerMillion &&
    (billing.cacheReadMicrousdPerMillionTokens ?? 0) ===
      reservation.cacheReadRateMicrousdPerMillion &&
    billing.providerFeeCeilingMicrousd ===
      reservation.providerFeeCeilingMicrousd &&
    billing.roundingPolicy === reservation.roundingPolicy &&
    billing.projectedCostMicrousd === reservation.amountMicrousd
  );
}

function expectedTerminalRowType(
  reservation: BudgetReservation,
  finish: NonNullable<InferenceAttemptRecord["finished"]>,
): BudgetTerminalRowType {
  if (finish.requestDisposition === "not_sent") return "release";
  return finish.cost.amountMicrousd > reservation.amountMicrousd
    ? "overrun"
    : "settlement";
}

function actualHostPricedCostMicrousd(
  reservation: BudgetReservation,
  finish: NonNullable<InferenceAttemptRecord["finished"]>,
): number {
  if (!finish.usage.reported) {
    throw new Error("host pricing requires reported usage");
  }
  if (
    reservation.cacheReadRateMicrousdPerMillion > 0 &&
    finish.usage.cacheReadTokens === undefined
  ) {
    throw new Error("host pricing requires cache-read usage");
  }
  const cacheReadTokens = finish.usage.cacheReadTokens ?? 0;
  if (cacheReadTokens > finish.usage.inputTokens) {
    throw new Error("cache-read usage exceeds total input usage");
  }
  const component = (tokens: bigint, rate: number): bigint => {
    const product = tokens * BigInt(rate);
    return (product + MICROUSD_PER_MILLION_TOKENS - 1n) /
      MICROUSD_PER_MILLION_TOKENS;
  };
  const amount =
    component(
      BigInt(finish.usage.inputTokens - cacheReadTokens),
      reservation.inputRateMicrousdPerMillion,
    ) +
    component(
      BigInt(finish.usage.outputTokens) +
        BigInt(finish.usage.reasoningTokens),
      reservation.outputRateMicrousdPerMillion,
    ) +
    component(
      BigInt(cacheReadTokens),
      reservation.cacheReadRateMicrousdPerMillion,
    ) +
    BigInt(reservation.providerFeeCeilingMicrousd);
  return safeNumber(amount, "host-priced actual cost");
}

export class BudgetLedgerTransaction {
  constructor(
    private readonly database: SoarDatabase,
    private readonly store: EventStore,
    private readonly lifetime: { active: boolean } = { active: true },
  ) {
    this.assertActive();
  }

  private assertActive(): void {
    if (!this.lifetime.active || !this.database.inTransaction) {
      throw new Error(
        "BudgetLedgerTransaction is valid only inside its active SQLite transaction",
      );
    }
  }

  getCampaign(campaignId: string): BudgetCampaign | undefined {
    this.assertActive();
    assertBoundedId(campaignId, "campaignId");
    const row = this.database
      .prepare<unknown[], CampaignRow>(
        `SELECT id, provider_id, credential_metadata_id, amount_microusd,
                opening_exposure_microusd, automatic_stop_microusd,
                hard_ceiling_microusd, cost_scope, created_at
         FROM budget_ledger_entries
         WHERE id = ? AND row_type = 'campaign'`,
      )
      .safeIntegers(true)
      .get(campaignId);
    if (row === undefined) return undefined;
    if (row.amount_microusd !== row.opening_exposure_microusd) {
      throw new Error(`Campaign ${campaignId} has inconsistent opening exposure`);
    }
    return toCampaign(row);
  }

  requireCampaign(campaignId: string): BudgetCampaign {
    const campaign = this.getCampaign(campaignId);
    if (campaign === undefined) {
      throw new Error(`Unknown budget campaign ${campaignId}`);
    }
    return campaign;
  }

  insertCampaign(input: CreateBudgetCampaignInput): BudgetCampaign {
    this.assertActive();
    this.database
      .prepare(
        `INSERT INTO budget_ledger_entries (
           id, row_type, campaign_id, provider_id, credential_metadata_id,
           amount_microusd, opening_exposure_microusd,
           automatic_stop_microusd, hard_ceiling_microusd, cost_scope, created_at
         ) VALUES (?, 'campaign', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.id,
        input.providerId,
        input.credentialMetadataId,
        input.openingExposureMicrousd,
        input.openingExposureMicrousd,
        input.automaticStopMicrousd,
        input.hardCeilingMicrousd,
        input.costScope,
        input.createdAt,
      );
    return this.requireCampaign(input.id);
  }

  requireReservation(reservationId: string): BudgetReservation {
    this.assertActive();
    assertBoundedId(reservationId, "reservationId");
    const row = this.database
      .prepare<unknown[], ReservationRow>(
        `SELECT id, campaign_id, session_id, attempt_id, provider_id,
                pricing_snapshot_id, cost_scope, cloud_egress_admission_id,
                amount_microusd,
                billable_estimated_input_tokens, requested_max_output_tokens,
                cache_read_tokens_assumed, input_rate_microusd_per_million,
                output_rate_microusd_per_million,
                cache_read_rate_microusd_per_million,
                provider_fee_ceiling_microusd, cache_assumption,
                rounding_policy, created_at
         FROM budget_ledger_entries
         WHERE id = ? AND row_type = 'reservation'`,
      )
      .safeIntegers(true)
      .get(reservationId);
    if (row === undefined) {
      throw new Error(`Unknown budget reservation ${reservationId}`);
    }
    return toReservation(row);
  }

  getTerminalEntry(reservationId: string): BudgetTerminalEntry | undefined {
    this.assertActive();
    assertBoundedId(reservationId, "reservationId");
    const row = this.database
      .prepare<unknown[], TerminalRow>(
        `SELECT id, row_type, campaign_id, reservation_id, amount_microusd,
                cost_scope, cost_provenance, request_disposition, reason_code,
                created_at
         FROM budget_ledger_entries
         WHERE reservation_id = ?
           AND row_type IN ('settlement', 'release', 'overrun')`,
      )
      .safeIntegers(true)
      .get(reservationId);
    return row === undefined ? undefined : toTerminal(row);
  }

  /**
   * Fail-closed integrity gate between the append-only budget ledger and the
   * canonical session event log. Callers admitting new paid work must run this
   * while holding the same BEGIN IMMEDIATE transaction used for reservation.
   */
  assertEventReconciled(): void {
    this.assertActive();
    const reservations = this.database
      .prepare<unknown[], ReservationRow>(
        `SELECT id, campaign_id, session_id, attempt_id, provider_id,
                pricing_snapshot_id, cost_scope, cloud_egress_admission_id,
                amount_microusd,
                billable_estimated_input_tokens, requested_max_output_tokens,
                cache_read_tokens_assumed, input_rate_microusd_per_million,
                output_rate_microusd_per_million,
                cache_read_rate_microusd_per_million,
                provider_fee_ceiling_microusd, cache_assumption,
                rounding_policy, created_at
         FROM budget_ledger_entries
         WHERE row_type = 'reservation'
         ORDER BY created_at ASC, id ASC`,
      )
      .safeIntegers(true)
      .all()
      .map(toReservation);
    const terminals = this.database
      .prepare<unknown[], TerminalRow>(
        `SELECT id, row_type, campaign_id, reservation_id, amount_microusd,
                cost_scope, cost_provenance, request_disposition, reason_code,
                created_at
         FROM budget_ledger_entries
         WHERE row_type IN ('settlement', 'release', 'overrun')
         ORDER BY created_at ASC, id ASC`,
      )
      .safeIntegers(true)
      .all()
      .map(toTerminal);

    const reservationById = new Map<string, BudgetReservation>();
    const sessionIds = new Set<string>();
    for (const reservation of reservations) {
      if (reservationById.has(reservation.id)) {
        reconciliationFailure(reservation.id, "duplicate reservation row");
      }
      assertReservationProjection(reservation);
      reservationById.set(reservation.id, reservation);
      sessionIds.add(reservation.sessionId);
    }

    const terminalByReservationId = new Map<string, BudgetTerminalEntry>();
    for (const terminal of terminals) {
      const parentReservation = reservationById.get(terminal.reservationId);
      if (parentReservation === undefined) {
        reconciliationFailure(
          terminal.id,
          "terminal row has no reservation row",
        );
      }
      if (terminal.costScope !== parentReservation.costScope) {
        reconciliationFailure(
          terminal.id,
          "terminal row cost scope does not match its reservation",
        );
      }
      if (terminalByReservationId.has(terminal.reservationId)) {
        reconciliationFailure(
          terminal.reservationId,
          "multiple terminal rows resolve one reservation",
        );
      }
      terminalByReservationId.set(terminal.reservationId, terminal);
    }

    // The reverse scan catches a paid event whose reservation row was never
    // inserted. Querying every paid-attempt session prevents the ledger from
    // defining its own (possibly incomplete) reconciliation universe.
    const attemptEventRows = this.database
      .prepare<unknown[], AttemptEventPayloadRow>(
        `SELECT session_id, payload_json
         FROM session_events
         WHERE type = 'inference.attempt.started'
         ORDER BY session_id ASC, sequence ASC`,
      )
      .all();
    for (const row of attemptEventRows) {
      let payload: unknown;
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        reconciliationFailure(row.session_id, "malformed attempt event");
      }
      if (typeof payload !== "object" || payload === null) {
        reconciliationFailure(row.session_id, "malformed attempt event");
      }
      if (!("budgetReservationId" in payload)) continue;
      const reservationId = payload.budgetReservationId;
      if (reservationId === undefined) continue;
      if (typeof reservationId !== "string" || reservationId.length === 0) {
        reconciliationFailure(
          row.session_id,
          "attempt event has an invalid reservation ID",
        );
      }
      sessionIds.add(row.session_id);
    }

    const campaignById = new Map<string, BudgetCampaign>();
    const linkedAttemptByReservationId = new Map<
      string,
      { state: SessionState; attempt: InferenceAttemptRecord }
    >();
    for (const sessionId of [...sessionIds].sort()) {
      const state = this.store.replay(sessionId);
      for (const attempt of state.inferenceAttempts) {
        const reservationId = attempt.budgetReservationId;
        if (reservationId === undefined) continue;
        const reservation = reservationById.get(reservationId);
        if (reservation === undefined) {
          reconciliationFailure(
            reservationId,
            `attempt ${attempt.attemptId} has no ledger reservation`,
          );
        }
        if (linkedAttemptByReservationId.has(reservationId)) {
          reconciliationFailure(
            reservationId,
            "reservation is linked to multiple canonical attempts",
          );
        }
        linkedAttemptByReservationId.set(reservationId, { state, attempt });

        if (
          reservation.sessionId !== state.id ||
          reservation.attemptId !== attempt.attemptId ||
          reservation.providerId !== attempt.providerId ||
          reservation.requestedMaxOutputTokens !==
            attempt.requestedMaxOutputTokens ||
          reservation.createdAt !== attempt.createdAt ||
          reservation.costScope !==
            persistedEventCostScope(attempt.costScope) ||
          reservation.cloudEgressAdmissionId !==
            attempt.cloudEgressAdmissionId
        ) {
          reconciliationFailure(
            reservationId,
            "reservation does not match its canonical attempt start",
          );
        }

        const decision = state.routingDecisions.find(
          (candidate) => candidate.decisionId === attempt.decisionId,
        );
        if (
          decision === undefined ||
          decision.reasonCode !== "cloud_admitted" ||
          decision.selectedProviderId !== reservation.providerId ||
          decision.budgetReservationId !== reservation.id ||
          decision.campaignId !== reservation.campaignId ||
          decision.pricingSnapshotId !== reservation.pricingSnapshotId ||
          decision.billing === undefined ||
          persistedEventCostScope(decision.costScope) !==
            reservation.costScope ||
          decision.cloudEgressAdmissionId !==
            reservation.cloudEgressAdmissionId ||
          !billingMatchesReservation(decision.billing, reservation)
        ) {
          reconciliationFailure(
            reservationId,
            "reservation does not match its cloud-admission decision",
          );
        }

        let campaign = campaignById.get(reservation.campaignId);
        if (campaign === undefined) {
          campaign = this.requireCampaign(reservation.campaignId);
          campaignById.set(campaign.id, campaign);
        }
        if (
          campaign.providerId !== reservation.providerId ||
          decision.credentialMetadataId !== campaign.credentialMetadataId ||
          campaign.costScope !== reservation.costScope
        ) {
          reconciliationFailure(
            reservationId,
            "reservation does not match its campaign authority",
          );
        }
        const maximumCampaignRemaining =
          Math.min(
            campaign.automaticStopMicrousd,
            campaign.hardCeilingMicrousd,
          ) - campaign.openingExposureMicrousd;
        if (
          decision.billing.remainingEpisodeMicrousd !== v2EpisodeCap(state) ||
          decision.billing.remainingCampaignMicrousd >
            maximumCampaignRemaining
        ) {
          reconciliationFailure(
            reservationId,
            "decision records an impossible remaining budget",
          );
        }

        if (reservation.costScope === "simulation") {
          const admissionId = reservation.cloudEgressAdmissionId;
          const admission = state.cloudEgressAdmissions.find(
            (candidate) => candidate.admissionId === admissionId,
          );
          if (
            admissionId === undefined ||
            admission === undefined ||
            admission.decision !== "pass" ||
            decision.cloudEgressAdmissionId !== admissionId ||
            decision.messagesSha256 !== admission.messagesSemanticSha256 ||
            decision.provenanceSemanticSha256 !==
              admission.provenanceSemanticSha256 ||
            decision.checkpointId !== admission.checkpointId
          ) {
            reconciliationFailure(
              reservationId,
              "simulation reservation does not match a passed egress admission record",
            );
          }
        }

        const finish = attempt.finished;
        const terminal = terminalByReservationId.get(reservationId);
        if (finish === undefined || terminal === undefined) {
          if (finish !== undefined || terminal !== undefined) {
            reconciliationFailure(
              reservationId,
              finish === undefined
                ? "terminal row exists while the attempt is open"
                : "finished attempt has no terminal row",
            );
          }
          if (state.status !== "running") {
            reconciliationFailure(
              reservationId,
              "outstanding reservation belongs to a non-running session",
            );
          }
          continue;
        }

        const expectedRowType = expectedTerminalRowType(reservation, finish);
        if (
          terminal.rowType !== expectedRowType ||
          terminal.campaignId !== reservation.campaignId ||
          terminal.amountMicrousd !== finish.cost.amountMicrousd ||
          terminal.requestDisposition !== finish.requestDisposition ||
          terminal.createdAt !== finish.createdAt ||
          finish.cost.reservationId !== reservation.id ||
          persistedEventCostScope(finish.cost.costScope) !==
            reservation.costScope ||
          terminal.costScope !== reservation.costScope
        ) {
          reconciliationFailure(
            reservationId,
            "terminal row does not match its canonical attempt finish",
          );
        }
        if (expectedRowType === "release") {
          if (
            finish.cost.provenance !== "host_pricing_snapshot" ||
            terminal.costProvenance !== undefined ||
            terminal.reasonCode !== finish.errorCode
          ) {
            reconciliationFailure(
              reservationId,
              "release provenance or reason does not match its finish",
            );
          }
        } else {
          const expectedReasonCode =
            expectedRowType === "overrun" ? "budget_overrun" : undefined;
          if (
            terminal.costProvenance !== finish.cost.provenance ||
            terminal.reasonCode !== expectedReasonCode
          ) {
            reconciliationFailure(
              reservationId,
              "settlement provenance or reason does not match its finish",
            );
          }
          if (finish.cost.provenance === "host_pricing_snapshot") {
            let expectedCostMicrousd: number;
            try {
              expectedCostMicrousd = actualHostPricedCostMicrousd(
                reservation,
                finish,
              );
            } catch {
              reconciliationFailure(
                reservationId,
                "host-priced finish has invalid usage",
              );
            }
            if (finish.cost.amountMicrousd !== expectedCostMicrousd) {
              reconciliationFailure(
                reservationId,
                "host-priced finish amount does not match usage",
              );
            }
          }
          if (
            expectedRowType === "overrun" &&
            (state.status !== "failed" ||
              !state.error?.toLowerCase().includes("budget overrun"))
          ) {
            reconciliationFailure(
              reservationId,
              "budget overrun did not fail its session",
            );
          }
        }
      }
    }

    for (const reservation of reservations) {
      if (!linkedAttemptByReservationId.has(reservation.id)) {
        reconciliationFailure(
          reservation.id,
          "ledger reservation has no canonical attempt",
        );
      }
    }
  }

  listOutstandingReservations(options: {
    sessionId?: string;
  } = {}): BudgetReservation[] {
    this.assertActive();
    if (options.sessionId !== undefined) {
      assertBoundedId(options.sessionId, "sessionId");
    }
    const sql = `
      SELECT reservation.id, reservation.campaign_id, reservation.session_id,
             reservation.attempt_id, reservation.provider_id,
             reservation.pricing_snapshot_id, reservation.cost_scope,
             reservation.cloud_egress_admission_id,
             reservation.amount_microusd,
             reservation.billable_estimated_input_tokens,
             reservation.requested_max_output_tokens,
             reservation.cache_read_tokens_assumed,
             reservation.input_rate_microusd_per_million,
             reservation.output_rate_microusd_per_million,
             reservation.cache_read_rate_microusd_per_million,
             reservation.provider_fee_ceiling_microusd,
             reservation.cache_assumption, reservation.rounding_policy,
             reservation.created_at
      FROM budget_ledger_entries AS reservation
      LEFT JOIN budget_ledger_entries AS terminal
        ON terminal.reservation_id = reservation.id
       AND terminal.row_type IN ('settlement', 'release', 'overrun')
      WHERE reservation.row_type = 'reservation'
        AND terminal.id IS NULL
        ${options.sessionId === undefined ? "" : "AND reservation.session_id = ?"}
      ORDER BY reservation.created_at ASC, reservation.id ASC`;
    const statement = this.database
      .prepare<unknown[], ReservationRow>(sql)
      .safeIntegers(true);
    const rows =
      options.sessionId === undefined
        ? statement.all()
        : statement.all(options.sessionId);
    return rows.map(toReservation);
  }

  getCostScopeSummary(options: {
    sessionId?: string;
  } = {}): BudgetCostScopeSummary {
    this.assertActive();
    if (options.sessionId !== undefined) {
      assertBoundedId(options.sessionId, "sessionId");
    }
    const sessionFilter =
      options.sessionId === undefined
        ? ""
        : `WHERE (
             (entry.row_type = 'reservation' AND entry.session_id = ?)
             OR (
               entry.row_type IN ('settlement', 'release', 'overrun')
               AND EXISTS (
                 SELECT 1
                 FROM budget_ledger_entries AS reservation
                 WHERE reservation.id = entry.reservation_id
                   AND reservation.row_type = 'reservation'
                   AND reservation.session_id = ?
               )
             )
           )`;
    const statement = this.database
      .prepare<unknown[], CostScopeAggregateRow>(
        `SELECT entry.cost_scope,
                COUNT(*) AS row_count,
                COALESCE(SUM(
                  CASE WHEN entry.row_type = 'campaign'
                    THEN entry.amount_microusd ELSE 0 END
                ), 0) AS opening_exposure_microusd,
                COALESCE(SUM(
                  CASE WHEN entry.row_type = 'reservation'
                    AND NOT EXISTS (
                      SELECT 1
                      FROM budget_ledger_entries AS terminal
                      WHERE terminal.reservation_id = entry.id
                        AND terminal.row_type IN ('settlement', 'release', 'overrun')
                    ) THEN entry.amount_microusd ELSE 0 END
                ), 0) AS outstanding_reservation_microusd,
                COALESCE(SUM(
                  CASE WHEN entry.row_type IN ('settlement', 'overrun')
                    THEN entry.amount_microusd ELSE 0 END
                ), 0) AS settled_microusd
         FROM budget_ledger_entries AS entry
         ${sessionFilter}
         GROUP BY entry.cost_scope
         ORDER BY entry.cost_scope ASC`,
      )
      .safeIntegers(true);
    const rows =
      options.sessionId === undefined
        ? statement.all()
        : statement.all(options.sessionId, options.sessionId);
    const empty = (): BudgetCostScopeAmounts => ({
      rowCount: 0,
      openingExposureMicrousd: 0,
      outstandingReservationMicrousd: 0,
      settledMicrousd: 0,
    });
    const actual = empty();
    const simulation = empty();
    const legacyUnclassified = { ...empty(), present: false };
    for (const row of rows) {
      const values: BudgetCostScopeAmounts = {
        rowCount: safeNumber(row.row_count, "cost-scope row count"),
        openingExposureMicrousd: safeNumber(
          row.opening_exposure_microusd,
          "cost-scope opening exposure",
        ),
        outstandingReservationMicrousd: safeNumber(
          row.outstanding_reservation_microusd,
          "cost-scope outstanding reservation",
        ),
        settledMicrousd: safeNumber(
          row.settled_microusd,
          "cost-scope settled amount",
        ),
      };
      if (row.cost_scope === "actual") Object.assign(actual, values);
      else if (row.cost_scope === "simulation") {
        Object.assign(simulation, values);
      } else {
        Object.assign(legacyUnclassified, values, { present: true });
      }
    }
    return { actual, simulation, legacyUnclassified };
  }

  getPosition(
    campaignId: string,
    sessionId: string,
    episodeCapMicrousd: number,
  ): BudgetPosition {
    this.assertActive();
    const campaign = this.requireCampaign(campaignId);
    assertBoundedId(sessionId, "sessionId");
    assertSafeInteger(episodeCapMicrousd, "episodeCapMicrousd");

    const rows = this.database
      .prepare<unknown[], ExposureRow>(
        `SELECT id, row_type, reservation_id, session_id, amount_microusd,
                cost_scope
         FROM budget_ledger_entries
         WHERE campaign_id = ? AND row_type <> 'campaign'
         ORDER BY created_at ASC, id ASC`,
      )
      .safeIntegers(true)
      .all(campaignId);
    const terminalReservationIds = new Set(
      rows
        .filter((row) => row.row_type !== "reservation")
        .map((row) => row.reservation_id),
    );
    let campaignExposure = BigInt(campaign.openingExposureMicrousd);
    let episodeExposure = 0n;
    let campaignDisabled = false;
    const reservationsById = new Map(
      rows
        .filter((row) => row.row_type === "reservation")
        .map((row) => [row.id, row] as const),
    );
    for (const row of rows) {
      if (row.row_type === "reservation") {
        if (!terminalReservationIds.has(row.id)) {
          campaignExposure += row.amount_microusd;
          if (row.session_id === sessionId) episodeExposure += row.amount_microusd;
        }
        continue;
      }
      if (row.row_type === "overrun") campaignDisabled = true;
      campaignExposure += row.amount_microusd;
      const reservation = reservationsById.get(row.reservation_id);
      if (!reservation) {
        throw new Error(
          `Terminal budget entry ${row.id} has no reservation in campaign ${campaignId}`,
        );
      }
      if (reservation.session_id === sessionId) {
        episodeExposure += row.amount_microusd;
      }
    }

    const episodeCap = BigInt(episodeCapMicrousd);
    const automaticStop = BigInt(campaign.automaticStopMicrousd);
    const hardCeiling = BigInt(campaign.hardCeilingMicrousd);
    const remainingEpisode =
      episodeExposure >= episodeCap ? 0n : episodeCap - episodeExposure;
    const remainingAutomatic =
      campaignExposure >= automaticStop ? 0n : automaticStop - campaignExposure;
    const remainingHard =
      campaignExposure >= hardCeiling ? 0n : hardCeiling - campaignExposure;
    const remainingCampaign =
      remainingAutomatic < remainingHard ? remainingAutomatic : remainingHard;

    return {
      campaignId,
      sessionId,
      episodeCapMicrousd,
      episodeExposureMicrousd: safeNumber(
        episodeExposure,
        "episode exposure",
      ),
      campaignExposureMicrousd: safeNumber(
        campaignExposure,
        "campaign exposure",
      ),
      remainingEpisodeMicrousd: safeNumber(
        remainingEpisode,
        "remaining episode budget",
      ),
      remainingAutomaticStopMicrousd: safeNumber(
        remainingAutomatic,
        "remaining automatic-stop budget",
      ),
      remainingHardCeilingMicrousd: safeNumber(
        remainingHard,
        "remaining hard-ceiling budget",
      ),
      remainingCampaignMicrousd: safeNumber(
        remainingCampaign,
        "remaining campaign budget",
      ),
      automaticStopMicrousd: campaign.automaticStopMicrousd,
      hardCeilingMicrousd: campaign.hardCeilingMicrousd,
      campaignDisabled,
    };
  }

  reserve(input: ReserveBudgetInput): BudgetReservationResolution {
    this.assertActive();
    assertBoundedId(input.campaignId, "campaignId");
    assertBoundedId(input.reservationId, "reservationId");
    assertBoundedId(input.sessionId, "sessionId");
    assertBoundedId(input.attemptId, "attemptId");
    assertBoundedId(input.providerId, "providerId");
    assertBoundedId(input.pricingSnapshotId, "pricingSnapshotId");
    const costScope = RuntimeCostScopeSchema.parse(input.costScope);
    if (input.cloudEgressAdmissionId === undefined) {
      throw new Error(
        "A runtime reservation requires cloud egress admission identity",
      );
    } else {
      assertBoundedId(
        input.cloudEgressAdmissionId,
        "cloudEgressAdmissionId",
      );
    }
    assertCanonicalTimestamp(input.createdAt);
    assertSafeInteger(input.episodeCapMicrousd, "episodeCapMicrousd");
    const projectedCostMicrousd = projectWorstCaseCostMicrousd(input.projection);
    if (projectedCostMicrousd <= 0) {
      throw new RangeError("a paid budget reservation must be greater than zero");
    }

    const campaign = this.requireCampaign(input.campaignId);
    if (
      campaign.providerId !== input.providerId ||
      campaign.costScope !== costScope
    ) {
      throw new Error(
        `Campaign ${campaign.id} does not match provider and cost scope`,
      );
    }
    if (costScope === "actual") {
      const legacy = this.database
        .prepare(
          `SELECT id
           FROM budget_ledger_entries
           WHERE cost_scope = 'legacy_unclassified'
           LIMIT 1`,
        )
        .get() as { id: string } | undefined;
      if (legacy !== undefined) {
        throw new Error(
          "Actual budget admission is blocked by unclassified historical exposure",
        );
      }
    }
    const priorEpisodeReservation = this.database
      .prepare(
        `SELECT id FROM budget_ledger_entries
         WHERE row_type = 'reservation' AND session_id = ?
         LIMIT 1`,
      )
      .get(input.sessionId) as { id: string } | undefined;
    if (priorEpisodeReservation !== undefined) {
      throw new Error(
        `Session ${input.sessionId} already has paid reservation ${priorEpisodeReservation.id}`,
      );
    }

    const position = this.getPosition(
      input.campaignId,
      input.sessionId,
      input.episodeCapMicrousd,
    );
    const billing: BudgetBillingSnapshot = {
      billableInputTokens: input.projection.billableInputTokens,
      billableCacheReadTokens: input.projection.billableCacheReadTokens,
      requestedMaxOutputTokens: input.projection.requestedMaxOutputTokens,
      inputMicrousdPerMillionTokens:
        input.projection.inputMicrousdPerMillionTokens,
      outputMicrousdPerMillionTokens:
        input.projection.outputMicrousdPerMillionTokens,
      ...(input.projection.cacheReadMicrousdPerMillionTokens === undefined
        ? {}
        : {
            cacheReadMicrousdPerMillionTokens:
              input.projection.cacheReadMicrousdPerMillionTokens,
          }),
      providerFeeCeilingMicrousd:
        input.projection.providerFeeCeilingMicrousd,
      roundingPolicy: BUDGET_ROUNDING_POLICY,
      projectedCostMicrousd,
      remainingEpisodeMicrousd: position.remainingEpisodeMicrousd,
      remainingCampaignMicrousd: position.remainingCampaignMicrousd,
    };
    const denialReason: BudgetDenialReason | undefined = position.campaignDisabled
      ? "campaign_overrun"
      : projectedCostMicrousd > position.remainingEpisodeMicrousd
        ? "episode_cap"
        : projectedCostMicrousd > position.remainingHardCeilingMicrousd
          ? "campaign_hard_ceiling"
          : projectedCostMicrousd > position.remainingAutomaticStopMicrousd
            ? "campaign_automatic_stop"
            : undefined;
    if (denialReason !== undefined) {
      return { status: "denied", reason: denialReason, billing, position };
    }

    this.database
      .prepare(
        `INSERT INTO budget_ledger_entries (
           id, row_type, campaign_id, reservation_id, session_id, attempt_id,
           provider_id, pricing_snapshot_id, cost_scope,
           cloud_egress_admission_id, amount_microusd,
           billable_estimated_input_tokens, requested_max_output_tokens,
           cache_read_tokens_assumed, input_rate_microusd_per_million,
           output_rate_microusd_per_million,
           cache_read_rate_microusd_per_million,
           provider_fee_ceiling_microusd, cache_assumption, rounding_policy,
           created_at
         ) VALUES (
           ?, 'reservation', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         )`,
      )
      .run(
        input.reservationId,
        input.campaignId,
        input.reservationId,
        input.sessionId,
        input.attemptId,
        input.providerId,
        input.pricingSnapshotId,
        costScope,
        input.cloudEgressAdmissionId,
        projectedCostMicrousd,
        input.projection.billableInputTokens,
        input.projection.requestedMaxOutputTokens,
        input.projection.billableCacheReadTokens,
        input.projection.inputMicrousdPerMillionTokens,
        input.projection.outputMicrousdPerMillionTokens,
        input.projection.cacheReadMicrousdPerMillionTokens ?? 0,
        input.projection.providerFeeCeilingMicrousd,
        input.projection.cacheAssumption,
        BUDGET_ROUNDING_POLICY,
        input.createdAt,
      );
    const reservation = this.requireReservation(input.reservationId);
    return { status: "admitted", billing, position, reservation };
  }

  resolve(input: ResolveBudgetReservationInput): BudgetTerminalEntry {
    this.assertActive();
    assertBoundedId(input.terminalEntryId, "terminalEntryId");
    assertBoundedId(input.reservationId, "reservationId");
    assertCanonicalTimestamp(input.createdAt);
    assertSafeInteger(input.amountMicrousd, "amountMicrousd");
    if (input.reasonCode !== undefined) assertReasonCode(input.reasonCode);
    const reservation = this.requireReservation(input.reservationId);
    const existing = this.getTerminalEntry(input.reservationId);
    if (existing !== undefined) {
      throw new Error(
        `Budget reservation ${input.reservationId} already resolved by ${existing.id}`,
      );
    }

    if (input.rowType === "release") {
      if (
        input.amountMicrousd !== 0 ||
        input.requestDisposition !== "not_sent" ||
        input.costProvenance !== undefined ||
        input.reasonCode === undefined
      ) {
        throw new Error("release requires zero, not_sent, no cost provenance, and a reason");
      }
    } else {
      if (
        input.requestDisposition === "not_sent" ||
        input.costProvenance === undefined ||
        input.reasonCode !== (input.rowType === "overrun" ? "budget_overrun" : undefined)
      ) {
        throw new Error(
          `${input.rowType} requires sent/unknown disposition and exact provenance/reason fields`,
        );
      }
      if (
        input.rowType === "settlement" &&
        input.amountMicrousd > reservation.amountMicrousd
      ) {
        throw new Error("settlement cannot exceed its reservation");
      }
      if (
        input.rowType === "overrun" &&
        input.amountMicrousd <= reservation.amountMicrousd
      ) {
        throw new Error("overrun must exceed its reservation");
      }
      if (
        input.costProvenance === "reserved_unknown" &&
        input.amountMicrousd !== reservation.amountMicrousd
      ) {
        throw new Error("reserved_unknown must consume the full reservation");
      }
      if (
        input.rowType === "overrun" &&
        input.costProvenance === "reserved_unknown"
      ) {
        throw new Error("reserved_unknown cannot create an overrun");
      }
    }

    this.database
      .prepare(
        `INSERT INTO budget_ledger_entries (
           id, row_type, campaign_id, reservation_id, cost_scope, amount_microusd,
           cost_provenance, request_disposition, reason_code, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.terminalEntryId,
        input.rowType,
        reservation.campaignId,
        input.reservationId,
        reservation.costScope,
        input.amountMicrousd,
        input.costProvenance ?? null,
        input.requestDisposition,
        input.reasonCode ?? null,
        input.createdAt,
      );
    const terminal = this.getTerminalEntry(input.reservationId);
    if (terminal === undefined) {
      throw new Error(`Budget terminal entry ${input.terminalEntryId} was not persisted`);
    }
    return terminal;
  }
}

export class BudgetLedger {
  constructor(private readonly store: EventStore) {}

  get eventStore(): EventStore {
    return this.store;
  }

  /**
   * Internal persistence seam for AttemptUnitOfWork and ledger tests. Keeping
   * this public is tracked architecture debt; production callers must not use
   * it to mutate reservations outside the atomic event unit of work.
   */
  runImmediate<T>(
    operation: (
      transaction: BudgetLedgerTransaction,
    ) => T extends PromiseLike<unknown> ? never : T,
  ): T extends PromiseLike<unknown> ? never : T {
    return this.store.runImmediatePersistenceTransaction((database) => {
      const lifetime = { active: true };
      const transaction = new BudgetLedgerTransaction(
        database,
        this.store,
        lifetime,
      );
      try {
        return operation(transaction);
      } finally {
        lifetime.active = false;
      }
    });
  }

  createCampaign(input: CreateBudgetCampaignInput): BudgetCampaign {
    const normalized = normalizeCampaignInput(input);
    return this.runImmediate((transaction) => {
      return transaction.insertCampaign(normalized);
    });
  }

  /**
   * Idempotent bootstrap for the one fixed simulation campaign. An existing ID
   * is accepted only when every authority and accounting field is identical.
   */
  ensureCampaign(input: CreateBudgetCampaignInput): BudgetCampaign {
    const normalized = normalizeCampaignInput(input);
    return this.runImmediate((transaction) => {
      const existing = transaction.getCampaign(normalized.id);
      if (existing === undefined) {
        return transaction.insertCampaign(normalized);
      }
      if (!campaignMatchesInput(existing, normalized)) {
        throw new Error(
          `Budget campaign ${normalized.id} exists with different immutable authority`,
        );
      }
      return existing;
    });
  }

  getBudgetPosition(input: {
    campaignId: string;
    sessionId: string;
  }): BudgetPosition {
    return this.runImmediate((transaction) => {
      const state = this.store.replay(input.sessionId);
      return transaction.getPosition(
        input.campaignId,
        input.sessionId,
        v2EpisodeCap(state),
      );
    });
  }

  listOutstandingReservations(options: {
    sessionId?: string;
  } = {}): BudgetReservation[] {
    return this.runImmediate((transaction) =>
      transaction.listOutstandingReservations(options),
    );
  }

  getCostScopeSummary(options: {
    sessionId?: string;
  } = {}): BudgetCostScopeSummary {
    return this.runImmediate((transaction) =>
      transaction.getCostScopeSummary(options),
    );
  }

  assertEventReconciled(): void {
    this.runImmediate((transaction) => transaction.assertEventReconciled());
  }

  assertNoOutstandingReservation(sessionId: string): void {
    const outstanding = this.listOutstandingReservations({ sessionId });
    if (outstanding.length > 0) {
      throw new Error(
        `Session ${sessionId} has unresolved budget reservation ${outstanding[0]?.id ?? "unknown"}`,
      );
    }
  }
}

export function episodeBudgetCap(state: SessionState): number {
  return v2EpisodeCap(state);
}
