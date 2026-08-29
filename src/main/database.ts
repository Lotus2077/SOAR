import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import BetterSqlite3 from "better-sqlite3";

export type SoarDatabase = BetterSqlite3.Database;

export const IN_MEMORY_DATABASE = ":memory:";

const MIGRATION_LEDGER_SCHEMA = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY CHECK (version > 0),
    name TEXT NOT NULL UNIQUE CHECK (length(name) > 0),
    checksum_sha256 TEXT NOT NULL
      CHECK (
        length(checksum_sha256) = 64
        AND checksum_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
    applied_at TEXT NOT NULL
      CHECK (applied_at GLOB '????-??-??T??:??:??.???Z')
  );

  CREATE TRIGGER IF NOT EXISTS schema_migrations_no_update
  BEFORE UPDATE ON schema_migrations
  BEGIN
    SELECT RAISE(ABORT, 'schema_migrations is append-only');
  END;

  CREATE TRIGGER IF NOT EXISTS schema_migrations_no_delete
  BEFORE DELETE ON schema_migrations
  BEGIN
    SELECT RAISE(ABORT, 'schema_migrations is append-only');
  END;
`;

const BASELINE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    objective TEXT NOT NULL,
    workspace_root TEXT NOT NULL,
    profile TEXT NOT NULL CHECK (profile IN ('quality', 'balanced', 'economy', 'fast')),
    status TEXT NOT NULL CHECK (status IN ('created', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
    current_provider_id TEXT,
    current_model TEXT,
    route_reason TEXT,
    last_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
    total_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_input_tokens >= 0),
    total_output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_output_tokens >= 0),
    total_reasoning_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_reasoning_tokens >= 0),
    total_cost_usd REAL NOT NULL DEFAULT 0 CHECK (total_cost_usd >= 0),
    total_latency_ms REAL NOT NULL DEFAULT 0 CHECK (total_latency_ms >= 0),
    result TEXT,
    error TEXT,
    state_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (session_id, sequence)
  );

  CREATE INDEX IF NOT EXISTS session_events_session_sequence_idx
    ON session_events(session_id, sequence);

  CREATE INDEX IF NOT EXISTS sessions_updated_at_idx
    ON sessions(updated_at DESC);

  CREATE TRIGGER IF NOT EXISTS session_events_no_update
  BEFORE UPDATE ON session_events
  BEGIN
    SELECT RAISE(ABORT, 'session_events is append-only');
  END;

  CREATE TRIGGER IF NOT EXISTS session_events_no_delete
  BEFORE DELETE ON session_events
  BEGIN
    SELECT RAISE(ABORT, 'session_events is append-only');
  END;
`;

// Hash of the normalized sqlite_master objects produced by the frozen
// 4233eddf64b0f8e1ee290c9b067efb1494eadbff baseline. This is intentionally
// independent of BASELINE_SCHEMA so editing migration 1 cannot silently widen
// which unversioned databases are adopted as that historical schema.
const LEGACY_BASELINE_SCHEMA_FINGERPRINT =
  "994b3356d51bee8a07d5bca658d519731b0152033304af5bb504032dc069311a";
const MIGRATION_LEDGER_SCHEMA_FINGERPRINT =
  "a3e2e7d10f1dad52ab0592eacfec7740caa44c2d26b913c1ec96ac231eaab788";

// This migration creates storage constraints only. Paid admission and ledger
// mutation APIs intentionally land later; callers cannot reserve budget merely
// because this table exists.
const BUDGET_LEDGER_SCHEMA = `
  CREATE TABLE budget_ledger_entries (
    id TEXT PRIMARY KEY CHECK (length(id) > 0),
    row_type TEXT NOT NULL
      CHECK (row_type IN ('campaign', 'reservation', 'settlement', 'release', 'overrun')),
    campaign_id TEXT NOT NULL CHECK (length(campaign_id) > 0),
    reservation_id TEXT CHECK (reservation_id IS NULL OR length(reservation_id) > 0),
    session_id TEXT REFERENCES sessions(id),
    attempt_id TEXT CHECK (attempt_id IS NULL OR length(attempt_id) > 0),
    provider_id TEXT CHECK (provider_id IS NULL OR length(provider_id) > 0),
    credential_metadata_id TEXT
      CHECK (credential_metadata_id IS NULL OR length(credential_metadata_id) > 0),
    pricing_snapshot_id TEXT
      CHECK (pricing_snapshot_id IS NULL OR length(pricing_snapshot_id) > 0),
    amount_microusd INTEGER NOT NULL
      CHECK (typeof(amount_microusd) = 'integer' AND amount_microusd >= 0),
    opening_exposure_microusd INTEGER
      CHECK (
        opening_exposure_microusd IS NULL
        OR (
          typeof(opening_exposure_microusd) = 'integer'
          AND opening_exposure_microusd >= 0
        )
      ),
    automatic_stop_microusd INTEGER
      CHECK (
        automatic_stop_microusd IS NULL
        OR (
          typeof(automatic_stop_microusd) = 'integer'
          AND automatic_stop_microusd >= 0
        )
      ),
    hard_ceiling_microusd INTEGER
      CHECK (
        hard_ceiling_microusd IS NULL
        OR (
          typeof(hard_ceiling_microusd) = 'integer'
          AND hard_ceiling_microusd > 0
        )
      ),
    billable_estimated_input_tokens INTEGER
      CHECK (
        billable_estimated_input_tokens IS NULL
        OR (
          typeof(billable_estimated_input_tokens) = 'integer'
          AND billable_estimated_input_tokens >= 0
        )
      ),
    requested_max_output_tokens INTEGER
      CHECK (
        requested_max_output_tokens IS NULL
        OR (
          typeof(requested_max_output_tokens) = 'integer'
          AND requested_max_output_tokens > 0
        )
      ),
    cache_read_tokens_assumed INTEGER
      CHECK (
        cache_read_tokens_assumed IS NULL
        OR (
          typeof(cache_read_tokens_assumed) = 'integer'
          AND cache_read_tokens_assumed >= 0
        )
      ),
    input_rate_microusd_per_million INTEGER
      CHECK (
        input_rate_microusd_per_million IS NULL
        OR (
          typeof(input_rate_microusd_per_million) = 'integer'
          AND input_rate_microusd_per_million >= 0
        )
      ),
    output_rate_microusd_per_million INTEGER
      CHECK (
        output_rate_microusd_per_million IS NULL
        OR (
          typeof(output_rate_microusd_per_million) = 'integer'
          AND output_rate_microusd_per_million >= 0
        )
      ),
    cache_read_rate_microusd_per_million INTEGER
      CHECK (
        cache_read_rate_microusd_per_million IS NULL
        OR (
          typeof(cache_read_rate_microusd_per_million) = 'integer'
          AND cache_read_rate_microusd_per_million >= 0
        )
      ),
    provider_fee_ceiling_microusd INTEGER
      CHECK (
        provider_fee_ceiling_microusd IS NULL
        OR (
          typeof(provider_fee_ceiling_microusd) = 'integer'
          AND provider_fee_ceiling_microusd >= 0
        )
      ),
    cache_assumption TEXT CHECK (cache_assumption IS NULL OR length(cache_assumption) > 0),
    rounding_policy TEXT
      CHECK (rounding_policy IS NULL OR rounding_policy = 'ceil_each_component_v1'),
    cost_provenance TEXT
      CHECK (
        cost_provenance IS NULL
        OR cost_provenance IN (
          'provider_reported',
          'host_pricing_snapshot',
          'reserved_unknown'
        )
      ),
    request_disposition TEXT
      CHECK (
        request_disposition IS NULL
        OR request_disposition IN ('not_sent', 'sent', 'unknown')
      ),
    reason_code TEXT CHECK (reason_code IS NULL OR length(reason_code) > 0),
    created_at TEXT NOT NULL
      CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
    FOREIGN KEY (campaign_id) REFERENCES budget_ledger_entries(id),
    FOREIGN KEY (reservation_id) REFERENCES budget_ledger_entries(id),
    CHECK (
      CASE row_type
        WHEN 'campaign' THEN
          id = campaign_id
          AND reservation_id IS NULL
          AND session_id IS NULL
          AND attempt_id IS NULL
          AND provider_id IS NOT NULL
          AND credential_metadata_id IS NOT NULL
          AND pricing_snapshot_id IS NULL
          AND opening_exposure_microusd IS NOT NULL
          AND amount_microusd = opening_exposure_microusd
          AND automatic_stop_microusd IS NOT NULL
          AND hard_ceiling_microusd IS NOT NULL
          AND opening_exposure_microusd <= automatic_stop_microusd
          AND automatic_stop_microusd <= hard_ceiling_microusd
          AND billable_estimated_input_tokens IS NULL
          AND requested_max_output_tokens IS NULL
          AND cache_read_tokens_assumed IS NULL
          AND input_rate_microusd_per_million IS NULL
          AND output_rate_microusd_per_million IS NULL
          AND cache_read_rate_microusd_per_million IS NULL
          AND provider_fee_ceiling_microusd IS NULL
          AND cache_assumption IS NULL
          AND rounding_policy IS NULL
          AND cost_provenance IS NULL
          AND request_disposition IS NULL
          AND reason_code IS NULL
        WHEN 'reservation' THEN
          id = reservation_id
          AND id <> campaign_id
          AND session_id IS NOT NULL
          AND attempt_id IS NOT NULL
          AND provider_id IS NOT NULL
          AND credential_metadata_id IS NULL
          AND pricing_snapshot_id IS NOT NULL
          AND amount_microusd > 0
          AND opening_exposure_microusd IS NULL
          AND automatic_stop_microusd IS NULL
          AND hard_ceiling_microusd IS NULL
          AND billable_estimated_input_tokens IS NOT NULL
          AND requested_max_output_tokens IS NOT NULL
          AND cache_read_tokens_assumed IS NOT NULL
          AND input_rate_microusd_per_million IS NOT NULL
          AND output_rate_microusd_per_million IS NOT NULL
          AND cache_read_rate_microusd_per_million IS NOT NULL
          AND provider_fee_ceiling_microusd IS NOT NULL
          AND cache_assumption IS NOT NULL
          AND rounding_policy = 'ceil_each_component_v1'
          AND cost_provenance IS NULL
          AND request_disposition IS NULL
          AND reason_code IS NULL
        WHEN 'settlement' THEN
          id <> campaign_id
          AND id <> reservation_id
          AND reservation_id IS NOT NULL
          AND session_id IS NULL
          AND attempt_id IS NULL
          AND provider_id IS NULL
          AND credential_metadata_id IS NULL
          AND pricing_snapshot_id IS NULL
          AND opening_exposure_microusd IS NULL
          AND automatic_stop_microusd IS NULL
          AND hard_ceiling_microusd IS NULL
          AND billable_estimated_input_tokens IS NULL
          AND requested_max_output_tokens IS NULL
          AND cache_read_tokens_assumed IS NULL
          AND input_rate_microusd_per_million IS NULL
          AND output_rate_microusd_per_million IS NULL
          AND cache_read_rate_microusd_per_million IS NULL
          AND provider_fee_ceiling_microusd IS NULL
          AND cache_assumption IS NULL
          AND rounding_policy IS NULL
          AND cost_provenance IS NOT NULL
          AND request_disposition IN ('sent', 'unknown')
          AND reason_code IS NULL
        WHEN 'release' THEN
          id <> campaign_id
          AND id <> reservation_id
          AND reservation_id IS NOT NULL
          AND session_id IS NULL
          AND attempt_id IS NULL
          AND provider_id IS NULL
          AND credential_metadata_id IS NULL
          AND pricing_snapshot_id IS NULL
          AND amount_microusd = 0
          AND opening_exposure_microusd IS NULL
          AND automatic_stop_microusd IS NULL
          AND hard_ceiling_microusd IS NULL
          AND billable_estimated_input_tokens IS NULL
          AND requested_max_output_tokens IS NULL
          AND cache_read_tokens_assumed IS NULL
          AND input_rate_microusd_per_million IS NULL
          AND output_rate_microusd_per_million IS NULL
          AND cache_read_rate_microusd_per_million IS NULL
          AND provider_fee_ceiling_microusd IS NULL
          AND cache_assumption IS NULL
          AND rounding_policy IS NULL
          AND cost_provenance IS NULL
          AND request_disposition = 'not_sent'
          AND reason_code IS NOT NULL
        WHEN 'overrun' THEN
          id <> campaign_id
          AND id <> reservation_id
          AND reservation_id IS NOT NULL
          AND session_id IS NULL
          AND attempt_id IS NULL
          AND provider_id IS NULL
          AND credential_metadata_id IS NULL
          AND pricing_snapshot_id IS NULL
          AND amount_microusd > 0
          AND opening_exposure_microusd IS NULL
          AND automatic_stop_microusd IS NULL
          AND hard_ceiling_microusd IS NULL
          AND billable_estimated_input_tokens IS NULL
          AND requested_max_output_tokens IS NULL
          AND cache_read_tokens_assumed IS NULL
          AND input_rate_microusd_per_million IS NULL
          AND output_rate_microusd_per_million IS NULL
          AND cache_read_rate_microusd_per_million IS NULL
          AND provider_fee_ceiling_microusd IS NULL
          AND cache_assumption IS NULL
          AND rounding_policy IS NULL
          AND cost_provenance IN ('provider_reported', 'host_pricing_snapshot')
          AND request_disposition IN ('sent', 'unknown')
          AND reason_code = 'budget_overrun'
        ELSE 0
      END
    )
  );

  CREATE UNIQUE INDEX budget_ledger_terminal_reservation_idx
    ON budget_ledger_entries(reservation_id)
    WHERE row_type IN ('settlement', 'release', 'overrun');

  CREATE INDEX budget_ledger_campaign_created_idx
    ON budget_ledger_entries(campaign_id, created_at, id);

  CREATE UNIQUE INDEX budget_ledger_campaign_credential_idx
    ON budget_ledger_entries(credential_metadata_id)
    WHERE row_type = 'campaign';

  CREATE UNIQUE INDEX budget_ledger_reservation_attempt_idx
    ON budget_ledger_entries(attempt_id)
    WHERE row_type = 'reservation';

  CREATE TRIGGER budget_ledger_reservation_parent_guard
  BEFORE INSERT ON budget_ledger_entries
  WHEN NEW.row_type = 'reservation'
  BEGIN
    SELECT CASE WHEN NOT EXISTS (
      SELECT 1
      FROM budget_ledger_entries AS campaign
      WHERE campaign.id = NEW.campaign_id
        AND campaign.row_type = 'campaign'
        AND campaign.provider_id = NEW.provider_id
    ) THEN RAISE(ABORT, 'budget reservation campaign/provider mismatch') END;
  END;

  CREATE TRIGGER budget_ledger_terminal_parent_guard
  BEFORE INSERT ON budget_ledger_entries
  WHEN NEW.row_type IN ('settlement', 'release', 'overrun')
  BEGIN
    SELECT CASE WHEN NOT EXISTS (
      SELECT 1
      FROM budget_ledger_entries AS reservation
      WHERE reservation.id = NEW.reservation_id
        AND reservation.row_type = 'reservation'
        AND reservation.campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'budget terminal row reservation/campaign mismatch') END;
  END;

  CREATE TRIGGER budget_ledger_settlement_amount_guard
  BEFORE INSERT ON budget_ledger_entries
  WHEN NEW.row_type = 'settlement'
  BEGIN
    SELECT CASE WHEN NEW.amount_microusd > (
      SELECT reservation.amount_microusd
      FROM budget_ledger_entries AS reservation
      WHERE reservation.id = NEW.reservation_id
    ) THEN RAISE(ABORT, 'budget settlement exceeds reservation') END;
  END;

  CREATE TRIGGER budget_ledger_overrun_amount_guard
  BEFORE INSERT ON budget_ledger_entries
  WHEN NEW.row_type = 'overrun'
  BEGIN
    SELECT CASE WHEN NEW.amount_microusd <= (
      SELECT reservation.amount_microusd
      FROM budget_ledger_entries AS reservation
      WHERE reservation.id = NEW.reservation_id
    ) THEN RAISE(ABORT, 'budget overrun must exceed reservation') END;
  END;

  CREATE TRIGGER budget_ledger_reserved_unknown_amount_guard
  BEFORE INSERT ON budget_ledger_entries
  WHEN NEW.row_type = 'settlement'
    AND NEW.cost_provenance = 'reserved_unknown'
  BEGIN
    SELECT CASE WHEN NEW.amount_microusd <> (
      SELECT reservation.amount_microusd
      FROM budget_ledger_entries AS reservation
      WHERE reservation.id = NEW.reservation_id
    ) THEN RAISE(ABORT, 'unknown cost must consume the full reservation') END;
  END;

  CREATE TRIGGER budget_ledger_no_update
  BEFORE UPDATE ON budget_ledger_entries
  BEGIN
    SELECT RAISE(ABORT, 'budget_ledger_entries is append-only');
  END;

  CREATE TRIGGER budget_ledger_no_delete
  BEFORE DELETE ON budget_ledger_entries
  BEGIN
    SELECT RAISE(ABORT, 'budget_ledger_entries is append-only');
  END;
`;

interface DatabaseMigration {
  version: number;
  name: string;
  sql: string;
}

const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  {
    version: 1,
    name: "baseline-session-event-store",
    sql: BASELINE_SCHEMA,
  },
  {
    version: 2,
    name: "append-only-operational-budget-ledger",
    sql: BUDGET_LEDGER_SCHEMA,
  },
];

// Applied migration SQL is checksummed. Never edit an existing migration after
// release; add a new numbered migration instead.

export const LATEST_DATABASE_SCHEMA_VERSION =
  DATABASE_MIGRATIONS[DATABASE_MIGRATIONS.length - 1].version;

export interface AppliedDatabaseMigration {
  version: number;
  name: string;
  checksumSha256: string;
  appliedAt: string;
}

interface MigrationRow {
  version: number;
  name: string;
  checksum_sha256: string;
  applied_at: string;
}

interface SchemaObjectRow {
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
}

function migrationChecksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

function normalizeSchemaSql(sql: string): string {
  return sql
    .replace(/\bIF\s+NOT\s+EXISTS\b/giu, "")
    .replace(/\s+/gu, " ")
    .replace(/\s*([(),])\s*/gu, "$1")
    .trim();
}

function userSchemaObjects(database: SoarDatabase): SchemaObjectRow[] {
  return database
    .prepare(
      `SELECT type, name, tbl_name, sql
       FROM sqlite_master
       WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
       ORDER BY type ASC, name ASC`,
    )
    .all() as SchemaObjectRow[];
}

function schemaFingerprint(objects: readonly SchemaObjectRow[]): string {
  const canonical = objects.map((object) => ({
    ...object,
    sql: object.sql === null ? null : normalizeSchemaSql(object.sql),
  }));
  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}

function assertFrozenLegacyBaseline(
  database: SoarDatabase,
  objects: readonly SchemaObjectRow[],
): void {
  if (objects.length === 0) return;

  if (schemaFingerprint(objects) !== LEGACY_BASELINE_SCHEMA_FINGERPRINT) {
    throw new Error(
      "Unversioned database schema does not match the frozen 4233edd baseline; refusing migration",
    );
  }
  const integrity = database.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") {
    throw new Error(
      `Unversioned baseline database failed integrity_check: ${String(integrity)}`,
    );
  }
  const foreignKeyViolations = database.pragma("foreign_key_check") as unknown[];
  if (foreignKeyViolations.length > 0) {
    throw new Error(
      "Unversioned baseline database contains foreign-key violations; refusing migration",
    );
  }
}

function assertMigrationMatches(
  row: AppliedDatabaseMigration,
  expected: DatabaseMigration,
): void {
  const expectedChecksum = migrationChecksum(expected.sql);
  if (
    row.version !== expected.version ||
    row.name !== expected.name ||
    row.checksumSha256 !== expectedChecksum
  ) {
    throw new Error(
      `Database migration ${row.version} does not match the supported name/checksum`,
    );
  }
}

export function listAppliedDatabaseMigrations(
  database: SoarDatabase,
): AppliedDatabaseMigration[] {
  const ledgerExists = database
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
    )
    .get();
  if (ledgerExists === undefined) {
    return [];
  }

  return (
    database
      .prepare(
        `SELECT version, name, checksum_sha256, applied_at
         FROM schema_migrations
         ORDER BY version ASC`,
      )
      .all() as MigrationRow[]
  ).map((row) => ({
    version: row.version,
    name: row.name,
    checksumSha256: row.checksum_sha256,
    appliedAt: row.applied_at,
  }));
}

function applyDatabaseMigrations(database: SoarDatabase): void {
  const existingObjects = userSchemaObjects(database);
  const migrationLedgerExists = database
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
    )
    .get();
  if (migrationLedgerExists === undefined) {
    // Validate before creating the migration ledger so rejection cannot stamp
    // a malformed lookalike database as the historical baseline.
    assertFrozenLegacyBaseline(database, existingObjects);
  } else {
    const ledgerObjects = existingObjects.filter(
      (object) => object.tbl_name === "schema_migrations",
    );
    if (
      schemaFingerprint(ledgerObjects) !==
      MIGRATION_LEDGER_SCHEMA_FINGERPRINT
    ) {
      throw new Error(
        "Existing schema_migrations ledger does not match the supported immutable ledger schema",
      );
    }
    const existingApplied = listAppliedDatabaseMigrations(database);
    if (existingApplied.length === 0) {
      // A crash can leave the ledger bootstrap committed before migration 1.
      // In that case the remaining schema must still be empty or the exact
      // frozen baseline; a crafted empty ledger cannot authorize a lookalike.
      assertFrozenLegacyBaseline(
        database,
        existingObjects.filter(
          (object) => object.tbl_name !== "schema_migrations",
        ),
      );
    }
  }
  database.transaction(() => database.exec(MIGRATION_LEDGER_SCHEMA))();

  const applied = listAppliedDatabaseMigrations(database);
  if (applied.length > DATABASE_MIGRATIONS.length) {
    throw new Error(
      `Database schema version ${applied.at(-1)?.version ?? "unknown"} is newer than supported version ${LATEST_DATABASE_SCHEMA_VERSION}`,
    );
  }

  for (const [index, row] of applied.entries()) {
    const expected = DATABASE_MIGRATIONS[index];
    if (expected === undefined || row.version !== expected.version) {
      throw new Error(
        `Database migration ledger is not a contiguous supported prefix at version ${row.version}`,
      );
    }
    assertMigrationMatches(row, expected);
  }

  const insertMigration = database.prepare(
    `INSERT INTO schema_migrations (
       version, name, checksum_sha256, applied_at
     ) VALUES (?, ?, ?, ?)`,
  );

  const applyMigration = database.transaction(
    (migration: DatabaseMigration): void => {
      // A second app process may have applied this migration after the initial
      // read. Re-check while holding the immediate write lock so concurrent
      // startup is idempotent rather than a duplicate-key failure.
      const existingRow = database
        .prepare(
          `SELECT version, name, checksum_sha256, applied_at
           FROM schema_migrations
           WHERE version = ?`,
        )
        .get(migration.version) as MigrationRow | undefined;
      if (existingRow !== undefined) {
        assertMigrationMatches(
          {
            version: existingRow.version,
            name: existingRow.name,
            checksumSha256: existingRow.checksum_sha256,
            appliedAt: existingRow.applied_at,
          },
          migration,
        );
        return;
      }
      database.exec(migration.sql);
      insertMigration.run(
        migration.version,
        migration.name,
        migrationChecksum(migration.sql),
        new Date().toISOString(),
      );
    },
  );

  for (const migration of DATABASE_MIGRATIONS.slice(applied.length)) {
    applyMigration.immediate(migration);
  }
}

export interface CreateDatabaseOptions {
  readonly?: boolean;
}

export function createSoarDatabase(
  databasePath = IN_MEMORY_DATABASE,
  options: CreateDatabaseOptions = {},
): SoarDatabase {
  const isMemory = databasePath === IN_MEMORY_DATABASE;
  const resolvedPath = isMemory ? databasePath : resolve(databasePath);

  if (!isMemory && !options.readonly) {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const database = new BetterSqlite3(resolvedPath, {
    readonly: options.readonly ?? false,
    fileMustExist: options.readonly ?? false,
  });
  database.pragma("foreign_keys = ON");
  // SQLite REPLACE performs an implicit delete. Recursive triggers ensure the
  // append-only delete guards also reject that rewrite path.
  database.pragma("recursive_triggers = ON");
  database.pragma("busy_timeout = 5000");

  if (!options.readonly) {
    try {
      // Validate and migrate before changing persistent connection settings.
      // A database that fails the frozen legacy-schema preflight must remain
      // byte-for-byte outside SOAR's ownership, including its journal mode.
      applyDatabaseMigrations(database);
      if (!isMemory) {
        database.pragma("journal_mode = WAL");
        database.pragma("synchronous = NORMAL");
      }
    } catch (error) {
      database.close();
      throw error;
    }
  }

  return database;
}
