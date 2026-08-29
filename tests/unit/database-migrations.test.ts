import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  createSoarDatabase,
  LATEST_DATABASE_SCHEMA_VERSION,
  listAppliedDatabaseMigrations,
  type SoarDatabase,
} from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";

const databases: SoarDatabase[] = [];
const temporaryDirectories: string[] = [];

function trackDatabase(database: SoarDatabase): SoarDatabase {
  databases.push(database);
  return database;
}

function closeDatabase(database: SoarDatabase): void {
  const index = databases.indexOf(database);
  if (index >= 0) databases.splice(index, 1);
  database.close();
}

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "soar-database-migration-"));
  temporaryDirectories.push(directory);
  return join(directory, "soar.sqlite");
}

function createBaselineDatabase(databasePath: string): SoarDatabase {
  const database = new BetterSqlite3(databasePath);
  database.pragma("foreign_keys = ON");
  database.exec(
    readFileSync(
      new URL("../fixtures/database/baseline-4233edd.sql", import.meta.url),
      "utf8",
    ),
  );
  return trackDatabase(database);
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    if (database.open) database.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("database migrations", () => {
  it("records a checksummed, append-only migration prefix on a fresh database", () => {
    const database = trackDatabase(createSoarDatabase());
    const migrations = listAppliedDatabaseMigrations(database);

    expect(migrations.map(({ version, name }) => ({ version, name }))).toEqual([
      { version: 1, name: "baseline-session-event-store" },
      { version: 2, name: "append-only-operational-budget-ledger" },
    ]);
    expect(migrations).toHaveLength(LATEST_DATABASE_SCHEMA_VERSION);
    for (const migration of migrations) {
      expect(migration.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(new Date(migration.appliedAt).toISOString()).toBe(
        migration.appliedAt,
      );
    }

    expect(() =>
      database
        .prepare("UPDATE schema_migrations SET name = ? WHERE version = 1")
        .run("rewritten"),
    ).toThrow(/schema_migrations is append-only/);
    expect(() =>
      database
        .prepare("DELETE FROM schema_migrations WHERE version = 1")
        .run(),
    ).toThrow(/schema_migrations is append-only/);
    expect(() =>
      database
        .prepare(
          `INSERT OR REPLACE INTO schema_migrations
           SELECT version, name, checksum_sha256, applied_at
           FROM schema_migrations
           WHERE version = 1`,
        )
        .run(),
    ).toThrow(/schema_migrations is append-only/);
  });

  it("upgrades a baseline database without rewriting legacy events and remains idempotent", () => {
    const databasePath = temporaryDatabasePath();
    const baselineDatabase = createBaselineDatabase(databasePath);
    const baselineStore = new EventStore(baselineDatabase);
    const session = baselineStore.createSession({
      id: "legacy-session",
      title: "Legacy task",
      objective: "Preserve the baseline event history",
      workspaceRoot: "/tmp/legacy-workspace",
      createdAt: "2026-08-29T00:00:00.000Z",
    });
    baselineStore.appendMany(
      session.id,
      [
        { type: "session.started", payload: {} },
        {
          type: "route.assigned",
          payload: {
            providerId: "local-vllm",
            model: "legacy-local-model",
            reason: "Legacy local-only route",
          },
        },
      ],
      {
        expectedSequence: 2,
        createdAt: "2026-08-29T00:00:01.000Z",
      },
    );
    const legacyEvents = baselineStore.getEvents(session.id);
    const legacyReplay = baselineStore.replay(session.id);
    const legacyRows = baselineDatabase
      .prepare(
        `SELECT id, session_id, sequence, type, payload_json, created_at
         FROM session_events
         ORDER BY sequence`,
      )
      .all();
    expect(listAppliedDatabaseMigrations(baselineDatabase)).toEqual([]);
    closeDatabase(baselineDatabase);

    const upgraded = trackDatabase(createSoarDatabase(databasePath));
    const upgradedStore = new EventStore(upgraded);
    expect(listAppliedDatabaseMigrations(upgraded)).toHaveLength(2);
    expect(upgradedStore.getEvents(session.id)).toEqual(legacyEvents);
    expect(upgradedStore.replay(session.id)).toEqual(legacyReplay);
    expect(
      upgraded
        .prepare(
          `SELECT id, session_id, sequence, type, payload_json, created_at
           FROM session_events
           ORDER BY sequence`,
        )
        .all(),
    ).toEqual(legacyRows);
    expect(upgraded.pragma("foreign_key_check")).toEqual([]);
    expect(
      upgraded.pragma("integrity_check", { simple: true }),
    ).toBe("ok");

    upgradedStore.append(
      session.id,
      {
        type: "usage.recorded",
        payload: {
          inputTokens: 7,
          outputTokens: 3,
          reasoningTokens: 0,
          costUsd: 0,
          latencyMs: 12,
        },
      },
      {
        expectedSequence: 4,
        createdAt: "2026-08-29T00:00:02.000Z",
      },
    );
    const migrationsBeforeReopen = listAppliedDatabaseMigrations(upgraded);
    const eventsBeforeReopen = upgradedStore.getEvents(session.id);
    closeDatabase(upgraded);

    const reopened = trackDatabase(createSoarDatabase(databasePath));
    expect(listAppliedDatabaseMigrations(reopened)).toEqual(
      migrationsBeforeReopen,
    );
    const reopenedStore = new EventStore(reopened);
    expect(reopenedStore.getEvents(session.id)).toEqual(eventsBeforeReopen);
    expect(reopenedStore.getProjectedState(session.id)).toEqual(
      reopenedStore.replay(session.id),
    );
  });

  it("rejects an unversioned lookalike before creating migration state", () => {
    const databasePath = temporaryDatabasePath();
    const lookalike = trackDatabase(new BetterSqlite3(databasePath));
    lookalike.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, title TEXT, objective TEXT, workspace_root TEXT,
        profile TEXT, status TEXT, current_provider_id TEXT,
        current_model TEXT, route_reason TEXT, last_sequence INTEGER,
        total_input_tokens INTEGER, total_output_tokens INTEGER,
        total_reasoning_tokens INTEGER, total_cost_usd REAL,
        total_latency_ms REAL, result TEXT, error TEXT, state_json TEXT,
        created_at TEXT, updated_at TEXT
      );
      CREATE TABLE session_events (
        id TEXT PRIMARY KEY, session_id TEXT, sequence INTEGER, type TEXT,
        payload_json TEXT, created_at TEXT
      );
      CREATE INDEX session_events_session_sequence_idx
        ON session_events(session_id, sequence);
      CREATE INDEX sessions_updated_at_idx ON sessions(updated_at DESC);
      CREATE TRIGGER session_events_no_update BEFORE UPDATE ON session_events
      BEGIN SELECT RAISE(ABORT, 'session_events is append-only'); END;
      CREATE TRIGGER session_events_no_delete BEFORE DELETE ON session_events
      BEGIN SELECT RAISE(ABORT, 'session_events is append-only'); END;
    `);
    const journalModeBefore = lookalike.pragma("journal_mode", {
      simple: true,
    });
    closeDatabase(lookalike);

    expect(() => createSoarDatabase(databasePath)).toThrow(
      /does not match the frozen 4233edd baseline/,
    );

    const unchanged = trackDatabase(new BetterSqlite3(databasePath));
    expect(unchanged.pragma("journal_mode", { simple: true })).toBe(
      journalModeBefore,
    );
    expect(
      unchanged
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE name IN ('schema_migrations', 'budget_ledger_entries')`,
        )
        .all(),
    ).toEqual([]);
    expect(() =>
      unchanged
        .prepare(
          `INSERT INTO sessions (
             id, profile, status, last_sequence, total_cost_usd
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run("invalid", "bogus", "bogus", -1, -1),
    ).not.toThrow();
  });

  it("fails closed when the migration ledger contains an unknown future version", () => {
    const databasePath = temporaryDatabasePath();
    const current = trackDatabase(createSoarDatabase(databasePath));
    current
      .prepare(
        `INSERT INTO schema_migrations (
           version, name, checksum_sha256, applied_at
         ) VALUES (?, ?, ?, ?)`,
      )
      .run(
        3,
        "future-migration",
        "a".repeat(64),
        "2026-08-29T00:00:00.000Z",
      );
    closeDatabase(current);

    expect(() => createSoarDatabase(databasePath)).toThrow(
      /newer than supported version 2/,
    );

    const raw = trackDatabase(new BetterSqlite3(databasePath, { readonly: true }));
    expect(
      raw.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get(),
    ).toEqual({ count: 3 });
  });

  it("provides a constrained append-only schema without a budget runtime", () => {
    const database = trackDatabase(createSoarDatabase());
    const store = new EventStore(database);
    store.createSession({
      id: "budget-schema-session",
      title: "Schema test",
      objective: "Exercise dormant budget constraints",
      workspaceRoot: "/tmp/workspace",
    });

    const insert = database.prepare(`
      INSERT INTO budget_ledger_entries (
        id, row_type, campaign_id, reservation_id, session_id, attempt_id,
        provider_id, credential_metadata_id, pricing_snapshot_id,
        amount_microusd, opening_exposure_microusd,
        automatic_stop_microusd, hard_ceiling_microusd,
        billable_estimated_input_tokens, requested_max_output_tokens,
        cache_read_tokens_assumed, input_rate_microusd_per_million,
        output_rate_microusd_per_million,
        cache_read_rate_microusd_per_million,
        provider_fee_ceiling_microusd, cache_assumption, rounding_policy,
        cost_provenance, request_disposition, reason_code, created_at
      ) VALUES (
        @id, @rowType, @campaignId, @reservationId, @sessionId, @attemptId,
        @providerId, @credentialMetadataId, @pricingSnapshotId,
        @amountMicrousd, @openingExposureMicrousd,
        @automaticStopMicrousd, @hardCeilingMicrousd,
        @billableEstimatedInputTokens, @requestedMaxOutputTokens,
        @cacheReadTokensAssumed, @inputRateMicrousdPerMillion,
        @outputRateMicrousdPerMillion,
        @cacheReadRateMicrousdPerMillion,
        @providerFeeCeilingMicrousd, @cacheAssumption, @roundingPolicy,
        @costProvenance, @requestDisposition, @reasonCode, @createdAt
      )
    `);
    const empty = {
      reservationId: null,
      sessionId: null,
      attemptId: null,
      providerId: null,
      credentialMetadataId: null,
      pricingSnapshotId: null,
      openingExposureMicrousd: null,
      automaticStopMicrousd: null,
      hardCeilingMicrousd: null,
      billableEstimatedInputTokens: null,
      requestedMaxOutputTokens: null,
      cacheReadTokensAssumed: null,
      inputRateMicrousdPerMillion: null,
      outputRateMicrousdPerMillion: null,
      cacheReadRateMicrousdPerMillion: null,
      providerFeeCeilingMicrousd: null,
      cacheAssumption: null,
      roundingPolicy: null,
      costProvenance: null,
      requestDisposition: null,
      reasonCode: null,
      createdAt: "2026-08-29T01:00:00.000Z",
    };

    insert.run({
      ...empty,
      id: "campaign-1",
      rowType: "campaign",
      campaignId: "campaign-1",
      providerId: "fake-cloud",
      credentialMetadataId: "credential-metadata-1",
      amountMicrousd: 0,
      openingExposureMicrousd: 0,
      automaticStopMicrousd: 90_000_000,
      hardCeilingMicrousd: 100_000_000,
    });
    insert.run({
      ...empty,
      id: "reservation-1",
      rowType: "reservation",
      campaignId: "campaign-1",
      reservationId: "reservation-1",
      sessionId: "budget-schema-session",
      attemptId: "attempt-1",
      providerId: "fake-cloud",
      pricingSnapshotId: "pricing-1",
      amountMicrousd: 250_000,
      billableEstimatedInputTokens: 1_500,
      requestedMaxOutputTokens: 2_000,
      cacheReadTokensAssumed: 0,
      inputRateMicrousdPerMillion: 60_000,
      outputRateMicrousdPerMillion: 120_000,
      cacheReadRateMicrousdPerMillion: 0,
      providerFeeCeilingMicrousd: 1_000,
      cacheAssumption: "no_cache_credit",
      roundingPolicy: "ceil_each_component_v1",
    });
    for (const [reservationId, attemptId] of [
      ["reservation-2", "attempt-2"],
      ["reservation-3", "attempt-3"],
    ] as const) {
      insert.run({
        ...empty,
        id: reservationId,
        rowType: "reservation",
        campaignId: "campaign-1",
        reservationId,
        sessionId: "budget-schema-session",
        attemptId,
        providerId: "fake-cloud",
        pricingSnapshotId: "pricing-1",
        amountMicrousd: 250_000,
        billableEstimatedInputTokens: 1_500,
        requestedMaxOutputTokens: 2_000,
        cacheReadTokensAssumed: 0,
        inputRateMicrousdPerMillion: 60_000,
        outputRateMicrousdPerMillion: 120_000,
        cacheReadRateMicrousdPerMillion: 0,
        providerFeeCeilingMicrousd: 1_000,
        cacheAssumption: "no_cache_credit",
        roundingPolicy: "ceil_each_component_v1",
      });
    }

    expect(() =>
      insert.run({
        ...empty,
        id: "wrong-provider-reservation",
        rowType: "reservation",
        campaignId: "campaign-1",
        reservationId: "wrong-provider-reservation",
        sessionId: "budget-schema-session",
        attemptId: "attempt-wrong-provider",
        providerId: "different-provider",
        pricingSnapshotId: "pricing-1",
        amountMicrousd: 10,
        billableEstimatedInputTokens: 1,
        requestedMaxOutputTokens: 1,
        cacheReadTokensAssumed: 0,
        inputRateMicrousdPerMillion: 1,
        outputRateMicrousdPerMillion: 1,
        cacheReadRateMicrousdPerMillion: 0,
        providerFeeCeilingMicrousd: 0,
        cacheAssumption: "no_cache_credit",
        roundingPolicy: "ceil_each_component_v1",
      }),
    ).toThrow(/campaign\/provider mismatch/);

    expect(() =>
      insert.run({
        ...empty,
        id: "not-an-overrun",
        rowType: "overrun",
        campaignId: "campaign-1",
        reservationId: "reservation-1",
        amountMicrousd: 250_000,
        costProvenance: "provider_reported",
        requestDisposition: "sent",
        reasonCode: "budget_overrun",
      }),
    ).toThrow(/must exceed reservation/);

    insert.run({
      ...empty,
      id: "settlement-1",
      rowType: "settlement",
      campaignId: "campaign-1",
      reservationId: "reservation-1",
      amountMicrousd: 180_000,
      costProvenance: "provider_reported",
      requestDisposition: "sent",
    });
    expect(() =>
      insert.run({
        ...empty,
        id: "partial-unknown-settlement",
        rowType: "settlement",
        campaignId: "campaign-1",
        reservationId: "reservation-2",
        amountMicrousd: 249_999,
        costProvenance: "reserved_unknown",
        requestDisposition: "unknown",
      }),
    ).toThrow(/must consume the full reservation/);
    insert.run({
      ...empty,
      id: "release-1",
      rowType: "release",
      campaignId: "campaign-1",
      reservationId: "reservation-2",
      amountMicrousd: 0,
      requestDisposition: "not_sent",
      reasonCode: "definitely_unsent",
    });
    insert.run({
      ...empty,
      id: "overrun-1",
      rowType: "overrun",
      campaignId: "campaign-1",
      reservationId: "reservation-3",
      amountMicrousd: 250_001,
      costProvenance: "host_pricing_snapshot",
      requestDisposition: "sent",
      reasonCode: "budget_overrun",
    });

    expect(() =>
      insert.run({
        ...empty,
        id: "second-terminal",
        rowType: "release",
        campaignId: "campaign-1",
        reservationId: "reservation-1",
        amountMicrousd: 0,
        requestDisposition: "not_sent",
        reasonCode: "definitely_unsent",
      }),
    ).toThrow(/UNIQUE constraint failed/);

    expect(() =>
      database
        .prepare(
          "UPDATE budget_ledger_entries SET amount_microusd = 1 WHERE id = ?",
        )
        .run("campaign-1"),
    ).toThrow(/budget_ledger_entries is append-only/);
    expect(() =>
      database
        .prepare("DELETE FROM budget_ledger_entries WHERE id = ?")
        .run("reservation-1"),
    ).toThrow(/budget_ledger_entries is append-only/);
    expect(() =>
      database
        .prepare(
          `INSERT OR REPLACE INTO budget_ledger_entries
           SELECT * FROM budget_ledger_entries WHERE id = ?`,
        )
        .run("campaign-1"),
    ).toThrow(/budget_ledger_entries is append-only/);

    expect(
      database
        .prepare(
          "SELECT row_type FROM budget_ledger_entries ORDER BY rowid",
        )
        .all(),
    ).toEqual([
      { row_type: "campaign" },
      { row_type: "reservation" },
      { row_type: "reservation" },
      { row_type: "reservation" },
      { row_type: "settlement" },
      { row_type: "release" },
      { row_type: "overrun" },
    ]);
    expect(database.pragma("foreign_key_check")).toEqual([]);
    expect(
      database.pragma("integrity_check", { simple: true }),
    ).toBe("ok");
  });
});
