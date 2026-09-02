import { createHash } from "node:crypto";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";

import {
  PR6R_CAMPAIGN_ID,
  PR6R_COST_SCOPE,
  PR6R_DEVELOPMENT_AUTHORITY_ID,
  PR6R_FIXTURE_ID,
  Pr6rCampaignV1Schema,
  Pr6rComparisonV1Schema,
  Pr6rSafeProjectionV1Schema,
  canonicalPr6rJsonV1,
  projectPr6rSafeCampaignFallbackStateV1,
  type Pr6rCampaignV1,
  type Pr6rComparisonV1,
  type Pr6rSafeProjectionV1,
} from "../../shared/pr6r-development-contracts";
import { REVIEW_RESULT_V1_LIMITS } from "../../shared/review-result-contract";
import {
  consumePr6rComparisonProjectionUseAuthority,
  type Pr6rComparisonProjectionUseAuthority,
} from "./authority-ledger";

export const PR6R_CANARY_STORE_SCHEMA_VERSION = 1 as const;
export const PR6R_CANARY_MAX_RECORDS = 17 as const;
/**
 * A safe projection can contain one bounded ReviewResultV1 for each of the
 * three synthesis slots. Reserve one additional result-sized allowance for
 * the versioned projection envelope instead of incorrectly treating the
 * single-result bound as the whole-record bound.
 */
export const PR6R_CANARY_MAX_PAYLOAD_BYTES =
  REVIEW_RESULT_V1_LIMITS.maxSerializedRecordBytes * 4;
export const PR6R_CANARY_STORE_MIGRATION_NAME =
  "pr6r-comparison-aggregate-v1" as const;
export const PR6R_CANARY_PAYLOAD_CONTRACT_VERSION =
  "pr6r-canary-payload-contract-v6" as const;

const PR6R_CANARY_PAYLOAD_CONTRACT_DESCRIPTOR = Object.freeze({
  version: PR6R_CANARY_PAYLOAD_CONTRACT_VERSION,
  canonicalEncoding: "canonical-pr6r-json-v1",
  recordSchemas: Object.freeze({
    campaign: "pr6r-campaign-v1",
    comparison: "pr6r-comparison-v1",
    safeProjection: "pr6r-safe-projection-v1",
    fallbackState: "pr6r-safe-campaign-fallback-state-v1",
  }),
  aggregateTopology:
    "campaign-once-then-at-most-8-changing-atomic-comparison-safe-projection-pairs-v2",
  comparisonTransition:
    "monotone-terminal-with-fallback-disposition-accounting-and-shared-loopback-body-v2",
  projectionBinding: "exact-safe-subset-v1",
  recordBounds: Object.freeze({
    maximumRecords: PR6R_CANARY_MAX_RECORDS,
    maximumPayloadBytes: PR6R_CANARY_MAX_PAYLOAD_BYTES,
    maximumProjectedReviewResults: 3,
    reviewResultMaximumSerializedBytes:
      REVIEW_RESULT_V1_LIMITS.maxSerializedRecordBytes,
  }),
  evidenceChronology:
    "record-not-before-authority-provider-pricing-fallback-and-provider-before-pricing-v2",
});

export const PR6R_CANARY_PAYLOAD_CONTRACT_FINGERPRINT_SHA256 = sha256(
  canonicalPr6rJsonV1(PR6R_CANARY_PAYLOAD_CONTRACT_DESCRIPTOR),
);

const MIGRATION_LEDGER_SQL = `
  CREATE TABLE pr6r_schema_migrations (
    version INTEGER PRIMARY KEY CHECK (version > 0),
    name TEXT NOT NULL UNIQUE CHECK (length(name) > 0),
    checksum_sha256 TEXT NOT NULL
      CHECK (
        length(checksum_sha256) = 64
        AND checksum_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
    schema_fingerprint_sha256 TEXT NOT NULL
      CHECK (
        length(schema_fingerprint_sha256) = 64
        AND schema_fingerprint_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
    payload_contract_version TEXT NOT NULL
      CHECK (
        payload_contract_version = '${PR6R_CANARY_PAYLOAD_CONTRACT_VERSION}'
      ),
    payload_contract_fingerprint_sha256 TEXT NOT NULL
      CHECK (
        payload_contract_fingerprint_sha256 = '${PR6R_CANARY_PAYLOAD_CONTRACT_FINGERPRINT_SHA256}'
      ),
    applied_at TEXT NOT NULL
      CHECK (applied_at GLOB '????-??-??T??:??:??.???Z')
  );

  CREATE TRIGGER pr6r_schema_migrations_no_update
  BEFORE UPDATE ON pr6r_schema_migrations
  BEGIN
    SELECT RAISE(ABORT, 'pr6r_schema_migrations is append-only');
  END;

  CREATE TRIGGER pr6r_schema_migrations_no_delete
  BEFORE DELETE ON pr6r_schema_migrations
  BEGIN
    SELECT RAISE(ABORT, 'pr6r_schema_migrations is append-only');
  END;
`;

const PR6R_CANARY_STORE_SCHEMA = `
  CREATE TABLE pr6r_campaigns (
    campaign_id TEXT PRIMARY KEY CHECK (campaign_id = '${PR6R_CAMPAIGN_ID}'),
    authority_id TEXT NOT NULL
      CHECK (authority_id = '${PR6R_DEVELOPMENT_AUTHORITY_ID}'),
    fixture_id TEXT NOT NULL CHECK (fixture_id = '${PR6R_FIXTURE_ID}'),
    cost_scope TEXT NOT NULL CHECK (cost_scope = '${PR6R_COST_SCOPE}'),
    created_at TEXT NOT NULL
      CHECK (created_at GLOB '????-??-??T??:??:??.???Z')
  );

  CREATE TABLE pr6r_campaign_records (
    id TEXT PRIMARY KEY CHECK (length(id) > 0 AND length(id) <= 128),
    campaign_id TEXT NOT NULL REFERENCES pr6r_campaigns(campaign_id),
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    record_type TEXT NOT NULL
      CHECK (record_type IN ('campaign', 'comparison', 'safe_projection')),
    payload_json TEXT NOT NULL
      CHECK (
        length(CAST(payload_json AS BLOB)) > 0
        AND length(CAST(payload_json AS BLOB)) <= ${PR6R_CANARY_MAX_PAYLOAD_BYTES}
      ),
    payload_sha256 TEXT NOT NULL
      CHECK (
        length(payload_sha256) = 64
        AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
    created_at TEXT NOT NULL
      CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
    UNIQUE (campaign_id, sequence)
  );

  CREATE INDEX pr6r_campaign_records_sequence_idx
    ON pr6r_campaign_records(campaign_id, sequence);

  CREATE TRIGGER pr6r_campaigns_no_update
  BEFORE UPDATE ON pr6r_campaigns
  BEGIN
    SELECT RAISE(ABORT, 'pr6r_campaigns is append-only');
  END;

  CREATE TRIGGER pr6r_campaigns_no_delete
  BEFORE DELETE ON pr6r_campaigns
  BEGIN
    SELECT RAISE(ABORT, 'pr6r_campaigns is append-only');
  END;

  CREATE TRIGGER pr6r_campaign_records_no_update
  BEFORE UPDATE ON pr6r_campaign_records
  BEGIN
    SELECT RAISE(ABORT, 'pr6r_campaign_records is append-only');
  END;

  CREATE TRIGGER pr6r_campaign_records_no_delete
  BEFORE DELETE ON pr6r_campaign_records
  BEGIN
    SELECT RAISE(ABORT, 'pr6r_campaign_records is append-only');
  END;
`;

type Pr6rRecordType = "campaign" | "comparison" | "safe_projection";

interface MigrationRow {
  version: number;
  name: string;
  checksum_sha256: string;
  schema_fingerprint_sha256: string;
  payload_contract_version: string;
  payload_contract_fingerprint_sha256: string;
  applied_at: string;
}

interface CampaignRow {
  campaign_id: string;
  authority_id: string;
  fixture_id: string;
  cost_scope: string;
  created_at: string;
}

interface RecordRow {
  id: string;
  campaign_id: string;
  sequence: number;
  record_type: string;
  payload_json: string;
  payload_sha256: string;
  created_at: string;
}

interface SchemaRow {
  type: string;
  name: string;
  tbl_name: string;
  sql: string;
}

export interface Pr6rCanaryRecord {
  id: string;
  campaignId: typeof PR6R_CAMPAIGN_ID;
  sequence: number;
  recordType: Pr6rRecordType;
  createdAt: string;
  payload: Pr6rCampaignV1 | Pr6rComparisonV1 | Pr6rSafeProjectionV1;
}

export interface Pr6rCanaryRecordPair {
  comparison: Pr6rCanaryRecord;
  safeProjection: Pr6rCanaryRecord;
}

export interface Pr6rCanaryReplay {
  campaign: Pr6rCampaignV1;
  comparison?: Pr6rComparisonV1;
  safeProjection?: Pr6rSafeProjectionV1;
  records: readonly Pr6rCanaryRecord[];
}

export class Pr6rCanarySequenceConflictError extends Error {
  constructor(
    readonly expectedSequence: number,
    readonly actualSequence: number,
  ) {
    super(
      `PR6R canary sequence conflict: expected ${expectedSequence}, actual ${actualSequence}`,
    );
    this.name = "Pr6rCanarySequenceConflictError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

function canonicalTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new RangeError("PR6R store timestamps must be canonical ISO strings.");
  }
  return value;
}

function boundedRecordId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    throw new RangeError("PR6R record ID is not a bounded canonical ID.");
  }
  return value;
}

function recordType(value: string): Pr6rRecordType {
  if (
    value !== "campaign" &&
    value !== "comparison" &&
    value !== "safe_projection"
  ) {
    throw new Error("PR6R persisted record type is invalid.");
  }
  return value;
}

function parseRecordPayload(
  type: Pr6rRecordType,
  payloadJson: string,
): Pr6rCampaignV1 | Pr6rComparisonV1 | Pr6rSafeProjectionV1 {
  let raw: unknown;
  try {
    raw = JSON.parse(payloadJson);
  } catch {
    throw new Error("PR6R persisted record is not valid JSON.");
  }
  switch (type) {
    case "campaign":
      return deepFreeze(Pr6rCampaignV1Schema.parse(raw));
    case "comparison":
      return deepFreeze(Pr6rComparisonV1Schema.parse(raw));
    case "safe_projection":
      return deepFreeze(Pr6rSafeProjectionV1Schema.parse(raw));
  }
}

function assertRecordEvidenceChronology(
  type: Pr6rRecordType,
  payload: Pr6rCampaignV1 | Pr6rComparisonV1 | Pr6rSafeProjectionV1,
  createdAt: string,
): void {
  const pricingValidatedAt =
    "validatedAt" in payload.pricingSnapshot
      ? payload.pricingSnapshot.validatedAt
      : null;
  const evidenceTimestamps = [
    ["OS authority claim", payload.osAuthorityClaim.claimedAt],
    ["provider validation", payload.providerValidation.validatedAt],
    ["pricing snapshot", pricingValidatedAt],
    ["fallback claim", payload.fallbackState.claimedAt],
    ["fallback terminal", payload.fallbackState.terminalAt],
  ] as const;
  for (const [label, evidenceAt] of evidenceTimestamps) {
    if (
      typeof evidenceAt === "string" &&
      createdAt < canonicalTimestamp(evidenceAt)
    ) {
      throw new Error(
        `PR6R ${type} record timestamp precedes embedded ${label} evidence.`,
      );
    }
  }
}

function schemaRows(database: BetterSqlite3.Database): SchemaRow[] {
  return (
    database
      .prepare(
        `SELECT type, name, tbl_name, sql
         FROM sqlite_schema
         WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
         ORDER BY type, name, tbl_name, sql`,
      )
      .all() as SchemaRow[]
  ).map((row) => ({
    type: row.type,
    name: row.name,
    tbl_name: row.tbl_name,
    sql: row.sql,
  }));
}

function schemaFingerprint(database: BetterSqlite3.Database): string {
  return sha256(canonicalPr6rJsonV1(schemaRows(database)));
}

let expectedSchemaFingerprintCache: string | undefined;

function expectedSchemaFingerprint(): string {
  if (expectedSchemaFingerprintCache !== undefined) {
    return expectedSchemaFingerprintCache;
  }
  const reference = new BetterSqlite3(":memory:");
  try {
    reference.exec(MIGRATION_LEDGER_SQL);
    reference.exec(PR6R_CANARY_STORE_SCHEMA);
    expectedSchemaFingerprintCache = schemaFingerprint(reference);
    return expectedSchemaFingerprintCache;
  } finally {
    reference.close();
  }
}

function migrationChecksum(): string {
  return sha256(`${MIGRATION_LEDGER_SQL}\n${PR6R_CANARY_STORE_SCHEMA}`);
}

function assertDatabaseReady(database: BetterSqlite3.Database): void {
  if (schemaFingerprint(database) !== expectedSchemaFingerprint()) {
    throw new Error("PR6R canary schema fingerprint does not match this build.");
  }

  const rows = database
    .prepare(
      `SELECT version, name, checksum_sha256, schema_fingerprint_sha256,
              payload_contract_version,
              payload_contract_fingerprint_sha256, applied_at
       FROM pr6r_schema_migrations
       ORDER BY version`,
    )
    .all() as MigrationRow[];
  if (rows.length !== 1) {
    throw new Error("PR6R canary database has an invalid migration ledger.");
  }
  const migration = rows[0]!;
  if (
    migration.version !== PR6R_CANARY_STORE_SCHEMA_VERSION ||
    migration.name !== PR6R_CANARY_STORE_MIGRATION_NAME ||
    migration.checksum_sha256 !== migrationChecksum() ||
    migration.schema_fingerprint_sha256 !== expectedSchemaFingerprint() ||
    migration.payload_contract_version !==
      PR6R_CANARY_PAYLOAD_CONTRACT_VERSION ||
    migration.payload_contract_fingerprint_sha256 !==
      PR6R_CANARY_PAYLOAD_CONTRACT_FINGERPRINT_SHA256 ||
    canonicalTimestamp(migration.applied_at) !== migration.applied_at
  ) {
    throw new Error("PR6R canary migration ledger does not match this build.");
  }

  const recordBounds = database
    .prepare(
      `SELECT COUNT(*) AS record_count,
              COALESCE(MAX(length(CAST(payload_json AS BLOB))), 0)
                AS max_payload_bytes
       FROM pr6r_campaign_records`,
    )
    .get() as { record_count: number; max_payload_bytes: number };
  if (recordBounds.record_count > PR6R_CANARY_MAX_RECORDS) {
    throw new Error("PR6R canary record-count bound exceeded.");
  }
  if (recordBounds.max_payload_bytes > PR6R_CANARY_MAX_PAYLOAD_BYTES) {
    throw new Error("PR6R canary raw payload byte bound exceeded.");
  }

  const foreignKeys = database.pragma("foreign_keys", {
    simple: true,
  }) as number;
  if (foreignKeys !== 1) {
    throw new Error("PR6R canary foreign-key enforcement is disabled.");
  }
  const integrity = database.pragma("integrity_check") as Array<
    Record<string, unknown>
  >;
  if (
    integrity.length !== 1 ||
    Object.values(integrity[0] ?? {})[0] !== "ok"
  ) {
    throw new Error("PR6R canary database integrity check failed.");
  }
  const foreignKeyViolations = database.pragma("foreign_key_check") as unknown[];
  if (foreignKeyViolations.length !== 0) {
    throw new Error("PR6R canary database foreign-key check failed.");
  }
}

function applyMigration(database: BetterSqlite3.Database): void {
  const existingObjects = schemaRows(database);
  if (existingObjects.length === 0) {
    database.transaction(() => {
      database.exec(MIGRATION_LEDGER_SQL);
      database.exec(PR6R_CANARY_STORE_SCHEMA);
      const fingerprint = schemaFingerprint(database);
      if (fingerprint !== expectedSchemaFingerprint()) {
        throw new Error("PR6R canary fresh schema fingerprint mismatch.");
      }
      database
        .prepare(
          `INSERT INTO pr6r_schema_migrations (
             version, name, checksum_sha256, schema_fingerprint_sha256,
             payload_contract_version,
             payload_contract_fingerprint_sha256, applied_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          PR6R_CANARY_STORE_SCHEMA_VERSION,
          PR6R_CANARY_STORE_MIGRATION_NAME,
          migrationChecksum(),
          fingerprint,
          PR6R_CANARY_PAYLOAD_CONTRACT_VERSION,
          PR6R_CANARY_PAYLOAD_CONTRACT_FINGERPRINT_SHA256,
          new Date().toISOString(),
        );
    }).immediate();
  }
  // Never repair or recreate missing objects on reopen. A partial or lookalike
  // schema must remain visible as corruption and fail closed here.
  assertDatabaseReady(database);
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return canonicalPr6rJsonV1(left) === canonicalPr6rJsonV1(right);
}

function assertComparisonTopology(
  campaign: Pr6rCampaignV1,
  comparison: Pr6rComparisonV1,
): void {
  const checkpoint = campaign.parent.commonCheckpoint;
  if (
    comparison.parentSessionId !== campaign.parent.sessionId ||
    comparison.commonCheckpointSha256 !== checkpoint.checkpointSha256
  ) {
    throw new Error("PR6R comparison topology does not match the campaign.");
  }
  if (
    comparison.implementationRevision !== campaign.implementationRevision ||
    !sameCanonicalValue(
      comparison.osAuthorityClaim,
      campaign.osAuthorityClaim,
    ) ||
    !sameCanonicalValue(
      comparison.providerValidation,
      campaign.providerValidation,
    ) ||
    !sameCanonicalValue(comparison.pricingSnapshot, campaign.pricingSnapshot) ||
    !sameCanonicalValue(
      comparison.commonInvestigation,
      campaign.commonInvestigation,
    )
  ) {
    throw new Error("PR6R comparison evidence does not match the campaign.");
  }

  const [local, cloud, hybrid] = comparison.synthesisDecisions;
  if (
    local.synthesisSessionId !== null &&
    local.synthesisSessionId !== campaign.parent.sessionId
  ) {
    throw new Error("PR6R Local synthesis must continue the campaign parent.");
  }
  const childSessionIds = [cloud.synthesisSessionId, hybrid.synthesisSessionId].filter(
    (value): value is string => value !== null,
  );
  if (
    childSessionIds.some((value) => value === campaign.parent.sessionId) ||
    new Set(childSessionIds).size !== childSessionIds.length
  ) {
    throw new Error("PR6R Cloud synthesis sessions must be distinct children.");
  }
  if (
    comparison.synthesisDecisions.some(
      (decision) =>
        decision.simulationCost.pricingSnapshotSha256 !==
        campaign.pricingSnapshot.pricingSnapshotSha256,
    )
  ) {
    throw new Error(
      "PR6R comparison pricing topology does not match the campaign.",
    );
  }

  let earlierPending = false;
  for (const decision of comparison.synthesisDecisions) {
    if (decision.state === "pending") {
      earlierPending = true;
    } else if (earlierPending) {
      throw new Error("PR6R synthesis decisions violate deterministic slot order.");
    }
  }
}

function assertComparisonTransition(
  previous: Pr6rComparisonV1 | undefined,
  next: Pr6rComparisonV1,
): void {
  if (previous === undefined) {
    if (next.fallbackState.state !== "available") {
      throw new Error("PR6R comparison must begin with fallback available.");
    }
    if (next.synthesisDecisions.some((decision) => decision.state !== "pending")) {
      throw new Error("PR6R comparison must begin with all slots pending.");
    }
    return;
  }
  if (sameCanonicalValue(previous, next)) {
    throw new Error("PR6R comparison transition must change state.");
  }

  const priorFallback = previous.fallbackState;
  const candidateFallback = next.fallbackState;
  if (priorFallback.state === "available") {
    if (
      candidateFallback.state !== "available" &&
      candidateFallback.state !== "claimed" &&
      candidateFallback.state !== "not_used"
    ) {
      throw new Error("PR6R fallback transition is not monotonic.");
    }
    if (
      candidateFallback.state === "available" &&
      !sameCanonicalValue(priorFallback, candidateFallback)
    ) {
      throw new Error("PR6R available fallback state is immutable.");
    }
  } else if (priorFallback.state === "claimed") {
    if (
      candidateFallback.state !== "claimed" &&
      candidateFallback.state !== "completed"
    ) {
      throw new Error("PR6R fallback transition is not monotonic.");
    }
    if (
      priorFallback.triggerSlotId !== candidateFallback.triggerSlotId ||
      priorFallback.triggerTerminalSha256 !==
        candidateFallback.triggerTerminalSha256 ||
      priorFallback.fallbackClaimSha256 !==
        candidateFallback.fallbackClaimSha256 ||
      priorFallback.claimedAt !== candidateFallback.claimedAt ||
      priorFallback.resolution !== candidateFallback.resolution ||
      priorFallback.sourceSlotId !== candidateFallback.sourceSlotId ||
      priorFallback.sourceSynthesisSessionId !==
        candidateFallback.sourceSynthesisSessionId ||
      priorFallback.sourceReviewResultSha256 !==
        candidateFallback.sourceReviewResultSha256
    ) {
      throw new Error("PR6R fallback trigger identity is immutable.");
    }
    if (
      candidateFallback.state === "claimed" &&
      !sameCanonicalValue(priorFallback, candidateFallback)
    ) {
      throw new Error("PR6R claimed fallback state is immutable.");
    }
  } else if (!sameCanonicalValue(priorFallback, candidateFallback)) {
    throw new Error("PR6R terminal fallback state is immutable.");
  }

  previous.synthesisDecisions.forEach((prior, index) => {
    const candidate = next.synthesisDecisions[index]!;
    if (prior.state !== "pending" && !sameCanonicalValue(prior, candidate)) {
      throw new Error("PR6R terminal synthesis state is immutable.");
    }
  });
}

function assertProjectionEquality(
  campaign: Pr6rCampaignV1,
  comparison: Pr6rComparisonV1,
  projection: Pr6rSafeProjectionV1,
): void {
  const checkpoint = campaign.parent.commonCheckpoint;
  if (
    projection.implementationRevision !== campaign.implementationRevision ||
    projection.commonCheckpointSha256 !== checkpoint.checkpointSha256 ||
    projection.packetSha256 !== checkpoint.packetSha256 ||
    projection.semanticMessagesSha256 !== checkpoint.semanticMessagesSha256 ||
    projection.outputContractSha256 !== checkpoint.responseSchemaSha256 ||
    projection.actualExternalSpendMicrousd !==
      comparison.actualExternalSpendMicrousd
  ) {
    throw new Error("PR6R safe projection topology does not match the campaign.");
  }

  const expectedAuthorityClaim = {
    authorityClaimId: comparison.osAuthorityClaim.authorityClaimId,
    authorityClaimSha256: comparison.osAuthorityClaim.authorityClaimSha256,
    implementationRevision:
      comparison.osAuthorityClaim.implementationRevision,
    storageScope: comparison.osAuthorityClaim.storageScope,
    claimedAt: comparison.osAuthorityClaim.claimedAt,
    actualPaidAuthority: comparison.osAuthorityClaim.actualPaidAuthority,
    actualExternalSpendMicrousd:
      comparison.osAuthorityClaim.actualExternalSpendMicrousd,
  };
  const expectedProviderValidation = {
    validationId: comparison.providerValidation.validationId,
    validationSha256: comparison.providerValidation.validationSha256,
    syntheticProviderId: comparison.providerValidation.syntheticProviderId,
    implementationRevision:
      comparison.providerValidation.implementationRevision,
    model: comparison.providerValidation.model,
    upstreamSlug: comparison.providerValidation.upstreamSlug,
    providerKind: comparison.providerValidation.providerKind,
    transport: comparison.providerValidation.transport,
    validationOutcome: comparison.providerValidation.validationOutcome,
    validatedAt: comparison.providerValidation.validatedAt,
    externalProviderContact:
      comparison.providerValidation.externalProviderContact,
    actualPaidAuthority:
      comparison.providerValidation.actualPaidAuthority,
    actualExternalSpendMicrousd:
      comparison.providerValidation.actualExternalSpendMicrousd,
  };
  const expectedPricingSnapshot = {
    pricingSnapshotId: comparison.pricingSnapshot.pricingSnapshotId,
    pricingSnapshotSha256: comparison.pricingSnapshot.pricingSnapshotSha256,
    providerValidationId: comparison.pricingSnapshot.providerValidationId,
    providerValidationSha256:
      comparison.pricingSnapshot.providerValidationSha256,
    implementationRevision: comparison.pricingSnapshot.implementationRevision,
    model: comparison.pricingSnapshot.model,
    upstreamSlug: comparison.pricingSnapshot.upstreamSlug,
    currency: comparison.pricingSnapshot.currency,
    rateUnit: comparison.pricingSnapshot.rateUnit,
    inputRateMicrousdPerMillion:
      comparison.pricingSnapshot.inputRateMicrousdPerMillion,
    outputRateMicrousdPerMillion:
      comparison.pricingSnapshot.outputRateMicrousdPerMillion,
    cacheReadRateMicrousdPerMillion:
      comparison.pricingSnapshot.cacheReadRateMicrousdPerMillion,
    cacheWriteRateMicrousdPerMillion:
      comparison.pricingSnapshot.cacheWriteRateMicrousdPerMillion,
    reasoningBilling: comparison.pricingSnapshot.reasoningBilling,
    source: comparison.pricingSnapshot.source,
    costScope: comparison.pricingSnapshot.costScope,
    actualPaidAuthority: comparison.pricingSnapshot.actualPaidAuthority,
    actualExternalSpendMicrousd:
      comparison.pricingSnapshot.actualExternalSpendMicrousd,
  };
  const expectedCommonInvestigation = {
    investigationId: comparison.commonInvestigation.investigationId,
    investigationSha256: comparison.commonInvestigation.investigationSha256,
    implementationRevision:
      comparison.commonInvestigation.implementationRevision,
    durationMs: comparison.commonInvestigation.durationMs,
    toolCallCount: comparison.commonInvestigation.toolCallCount,
    terminalReason: comparison.commonInvestigation.terminalReason,
  };
  if (
    !sameCanonicalValue(projection.osAuthorityClaim, expectedAuthorityClaim) ||
    !sameCanonicalValue(
      projection.providerValidation,
      expectedProviderValidation,
    ) ||
    !sameCanonicalValue(projection.pricingSnapshot, expectedPricingSnapshot) ||
    !sameCanonicalValue(
      projection.commonInvestigation,
      expectedCommonInvestigation,
    ) ||
    !sameCanonicalValue(
      projection.fallbackState,
      projectPr6rSafeCampaignFallbackStateV1(comparison.fallbackState),
    )
  ) {
    throw new Error("PR6R safe projection evidence does not equal its comparison.");
  }

  comparison.synthesisDecisions.forEach((decision, index) => {
    const projected = projection.synthesisDecisions[index]!;
    const projectedResultSha256 = projected.output?.reviewResultSha256 ?? null;
    const { reservationId: _reservationId, ...simulationCost } =
      decision.simulationCost;
    const expectedSafeSimulationCost = {
      ...simulationCost,
      schemaVersion: "pr6r-safe-simulation-cost-v1",
    };
    if (
      projected.slotId !== decision.slotId ||
      projected.ordinal !== decision.ordinal ||
      projected.state !== decision.state ||
      projected.requestDisposition !== decision.requestDisposition ||
      projected.synthesisLatencyMs !== decision.synthesisLatencyMs ||
      !sameCanonicalValue(
        projected.tokenAccounting,
        decision.tokenAccounting,
      ) ||
      !sameCanonicalValue(
        projected.simulationCost,
        expectedSafeSimulationCost,
      ) ||
      !sameCanonicalValue(
        projected.outputValidity,
        decision.outputValidity,
      ) ||
      projected.terminalReason !== decision.terminalReason ||
      projectedResultSha256 !== decision.reviewResultSha256
    ) {
      throw new Error("PR6R safe projection does not equal its comparison.");
    }
  });
}

function reduceRecords(input: {
  campaignCreatedAt: string;
  records: readonly Pr6rCanaryRecord[];
}): Pr6rCanaryReplay {
  const { records } = input;
  if (records.length === 0 || records[0]?.recordType !== "campaign") {
    throw new Error("PR6R first campaign record must be the campaign contract.");
  }
  if ((records.length - 1) % 2 !== 0) {
    throw new Error("PR6R comparison records require an atomic safe projection.");
  }
  if (records[0].createdAt !== input.campaignCreatedAt) {
    throw new Error("PR6R campaign timestamp does not match its creation record.");
  }
  for (let index = 1; index < records.length; index += 1) {
    if (records[index]!.createdAt < records[index - 1]!.createdAt) {
      throw new Error("PR6R campaign record timestamps are not monotonic.");
    }
  }
  records.forEach((record) => {
    assertRecordEvidenceChronology(
      record.recordType,
      record.payload,
      record.createdAt,
    );
  });

  const campaign = Pr6rCampaignV1Schema.parse(records[0].payload);
  let comparison: Pr6rComparisonV1 | undefined;
  let safeProjection: Pr6rSafeProjectionV1 | undefined;
  for (let index = 1; index < records.length; index += 2) {
    const comparisonRecord = records[index]!;
    const projectionRecord = records[index + 1]!;
    if (
      comparisonRecord.recordType !== "comparison" ||
      projectionRecord.recordType !== "safe_projection" ||
      comparisonRecord.createdAt !== projectionRecord.createdAt
    ) {
      throw new Error("PR6R campaign record order is invalid.");
    }
    const nextComparison = Pr6rComparisonV1Schema.parse(
      comparisonRecord.payload,
    );
    const nextProjection = Pr6rSafeProjectionV1Schema.parse(
      projectionRecord.payload,
    );
    assertComparisonTopology(campaign, nextComparison);
    assertComparisonTransition(comparison, nextComparison);
    assertProjectionEquality(campaign, nextComparison, nextProjection);
    comparison = nextComparison;
    safeProjection = nextProjection;
  }
  return deepFreeze({
    campaign,
    ...(comparison === undefined ? {} : { comparison }),
    ...(safeProjection === undefined ? {} : { safeProjection }),
    records: Object.freeze([...records]),
  });
}

export class Pr6rCanaryStore {
  private readonly database: BetterSqlite3.Database;

  constructor(databasePath: string) {
    if (
      typeof databasePath !== "string" ||
      databasePath.trim() !== databasePath ||
      databasePath.length === 0 ||
      databasePath === ":memory:" ||
      !path.isAbsolute(databasePath)
    ) {
      throw new TypeError(
        "PR6R canary storage requires an explicit absolute database path.",
      );
    }
    this.database = new BetterSqlite3(databasePath);
    try {
      this.database.pragma("foreign_keys = ON");
      applyMigration(this.database);
      this.database.transaction(() => this.replayLocked()).deferred();
    } catch (error) {
      // A rejected on-disk database must not leave an unreachable native
      // handle open.
      this.database.close();
      throw error;
    }
  }

  close(): void {
    this.database.close();
  }

  createCampaign(input: {
    recordId: string;
    campaign: unknown;
    createdAt: string;
  }): Pr6rCanaryRecord {
    const campaign = deepFreeze(Pr6rCampaignV1Schema.parse(input.campaign));
    const createdAt = canonicalTimestamp(input.createdAt);
    return this.database.transaction(() => {
      assertDatabaseReady(this.database);
      if (this.replayLocked() !== undefined) {
        throw new Error("The fixed PR6R campaign already exists.");
      }
      this.database
        .prepare(
          `INSERT INTO pr6r_campaigns (
             campaign_id, authority_id, fixture_id, cost_scope, created_at
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          PR6R_CAMPAIGN_ID,
          PR6R_DEVELOPMENT_AUTHORITY_ID,
          PR6R_FIXTURE_ID,
          PR6R_COST_SCOPE,
          createdAt,
        );
      return this.appendRecordLocked({
        recordId: input.recordId,
        expectedSequence: 0,
        recordType: "campaign",
        payload: campaign,
        createdAt,
      });
    }).immediate();
  }

  appendComparisonProjection(input: {
    authority: Pr6rComparisonProjectionUseAuthority;
    comparisonRecordId: string;
    safeProjectionRecordId: string;
    expectedSequence: number;
    comparison: unknown;
    safeProjection: unknown;
    createdAt: string;
  }): Pr6rCanaryRecordPair {
    return this.database.transaction(() => {
      assertDatabaseReady(this.database);
      const replay = this.replayLocked();
      consumePr6rComparisonProjectionUseAuthority(input.authority, {
        store: this,
        appendInput: input,
        priorReplay: replay,
      });
      const comparison = deepFreeze(
        Pr6rComparisonV1Schema.parse(input.comparison),
      );
      const safeProjection = deepFreeze(
        Pr6rSafeProjectionV1Schema.parse(input.safeProjection),
      );
      const createdAt = canonicalTimestamp(input.createdAt);
      if (replay === undefined) {
        throw new Error("PR6R campaign must exist before comparison records.");
      }
      if (replay.records.length !== input.expectedSequence) {
        throw new Pr6rCanarySequenceConflictError(
          input.expectedSequence,
          replay.records.length,
        );
      }
      const previousCreatedAt = replay.records.at(-1)!.createdAt;
      if (createdAt < previousCreatedAt) {
        throw new Error("PR6R campaign record timestamps are not monotonic.");
      }
      assertComparisonTopology(replay.campaign, comparison);
      assertComparisonTransition(replay.comparison, comparison);
      assertProjectionEquality(replay.campaign, comparison, safeProjection);

      const comparisonRecord = this.appendRecordLocked({
        recordId: input.comparisonRecordId,
        expectedSequence: input.expectedSequence,
        recordType: "comparison",
        payload: comparison,
        createdAt,
      });
      const safeProjectionRecord = this.appendRecordLocked({
        recordId: input.safeProjectionRecordId,
        expectedSequence: input.expectedSequence + 1,
        recordType: "safe_projection",
        payload: safeProjection,
        createdAt,
      });
      return Object.freeze({
        comparison: comparisonRecord,
        safeProjection: safeProjectionRecord,
      });
    }).immediate();
  }

  replay(): Pr6rCanaryReplay | undefined {
    return this.database.transaction(() => {
      assertDatabaseReady(this.database);
      return this.replayLocked();
    }).deferred();
  }

  private replayLocked(): Pr6rCanaryReplay | undefined {
    const campaignRows = this.database
      .prepare(
        `SELECT campaign_id, authority_id, fixture_id, cost_scope, created_at
         FROM pr6r_campaigns ORDER BY campaign_id`,
      )
      .all() as CampaignRow[];
    if (campaignRows.length === 0) {
      const count = this.database
        .prepare("SELECT COUNT(*) AS count FROM pr6r_campaign_records")
        .get() as { count: number };
      if (count.count !== 0) {
        throw new Error("PR6R records exist without their campaign.");
      }
      return undefined;
    }
    if (campaignRows.length !== 1) {
      throw new Error("PR6R canary database contains multiple campaigns.");
    }
    const campaignRow = campaignRows[0]!;
    if (
      campaignRow.campaign_id !== PR6R_CAMPAIGN_ID ||
      campaignRow.authority_id !== PR6R_DEVELOPMENT_AUTHORITY_ID ||
      campaignRow.fixture_id !== PR6R_FIXTURE_ID ||
      campaignRow.cost_scope !== PR6R_COST_SCOPE ||
      canonicalTimestamp(campaignRow.created_at) !== campaignRow.created_at
    ) {
      throw new Error("PR6R campaign identity is corrupt.");
    }
    const rows = this.database
      .prepare(
        `SELECT id, campaign_id, sequence, record_type, payload_json,
                payload_sha256, created_at
         FROM pr6r_campaign_records
         WHERE campaign_id = ? ORDER BY sequence`,
      )
      .all(PR6R_CAMPAIGN_ID) as RecordRow[];
    if (rows.length === 0) {
      throw new Error("PR6R campaign is missing its creation record.");
    }
    const records = rows.map((row, index): Pr6rCanaryRecord => {
      const type = recordType(row.record_type);
      if (
        row.sequence !== index + 1 ||
        row.campaign_id !== PR6R_CAMPAIGN_ID ||
        boundedRecordId(row.id) !== row.id ||
        sha256(row.payload_json) !== row.payload_sha256 ||
        canonicalTimestamp(row.created_at) !== row.created_at
      ) {
        throw new Error("PR6R campaign record integrity check failed.");
      }
      const payload = parseRecordPayload(type, row.payload_json);
      if (canonicalPr6rJsonV1(payload) !== row.payload_json) {
        throw new Error("PR6R campaign record is not canonically encoded.");
      }
      return deepFreeze({
        id: row.id,
        campaignId: PR6R_CAMPAIGN_ID,
        sequence: row.sequence,
        recordType: type,
        createdAt: row.created_at,
        payload,
      });
    });
    return reduceRecords({
      campaignCreatedAt: campaignRow.created_at,
      records,
    });
  }

  private appendRecordLocked(input: {
    recordId: string;
    expectedSequence: number;
    recordType: Pr6rRecordType;
    payload: Pr6rCampaignV1 | Pr6rComparisonV1 | Pr6rSafeProjectionV1;
    createdAt: string;
  }): Pr6rCanaryRecord {
    assertRecordEvidenceChronology(
      input.recordType,
      input.payload,
      input.createdAt,
    );
    if (
      !Number.isSafeInteger(input.expectedSequence) ||
      input.expectedSequence < 0
    ) {
      throw new RangeError("PR6R expected sequence must be non-negative.");
    }
    const current = this.database
      .prepare(
        "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM pr6r_campaign_records WHERE campaign_id = ?",
      )
      .get(PR6R_CAMPAIGN_ID) as { sequence: number };
    if (current.sequence !== input.expectedSequence) {
      throw new Pr6rCanarySequenceConflictError(
        input.expectedSequence,
        current.sequence,
      );
    }
    if (current.sequence >= PR6R_CANARY_MAX_RECORDS) {
      throw new Error("PR6R canary record-count bound exceeded.");
    }
    const payloadJson = canonicalPr6rJsonV1(input.payload);
    if (Buffer.byteLength(payloadJson, "utf8") > PR6R_CANARY_MAX_PAYLOAD_BYTES) {
      throw new Error("PR6R canary raw payload byte bound exceeded.");
    }
    const createdAt = canonicalTimestamp(input.createdAt);
    const sequence = current.sequence + 1;
    const id = boundedRecordId(input.recordId);
    this.database
      .prepare(
        `INSERT INTO pr6r_campaign_records (
           id, campaign_id, sequence, record_type, payload_json,
           payload_sha256, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        PR6R_CAMPAIGN_ID,
        sequence,
        input.recordType,
        payloadJson,
        sha256(payloadJson),
        createdAt,
      );
    return deepFreeze({
      id,
      campaignId: PR6R_CAMPAIGN_ID,
      sequence,
      recordType: input.recordType,
      createdAt,
      payload: input.payload,
    });
  }
}
