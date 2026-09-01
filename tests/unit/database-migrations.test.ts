import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { BudgetLedger } from "../../src/main/budget-ledger";
import {
  createSoarDatabase,
  LATEST_DATABASE_SCHEMA_VERSION,
  listAppliedDatabaseMigrations,
  type SoarDatabase,
} from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";
import { recoverRunningSessions } from "../../src/main/recovery";

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
      {
        version: 3,
        name: "immutable-budget-cost-scope-and-egress-identity",
      },
      {
        version: 4,
        name: "credential-operation-journal-v1",
      },
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
    expect(listAppliedDatabaseMigrations(upgraded)).toHaveLength(4);
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

  it("upgrades an exact v3 database to the empty credential journal without rewriting existing data", () => {
    const databasePath = temporaryDatabasePath();
    const current = trackDatabase(createSoarDatabase(databasePath));
    const store = new EventStore(current);
    store.createSession({
      id: "v3-session",
      title: "V3 session",
      objective: "Preserve this row while adding the credential journal.",
      workspaceRoot: "/tmp/v3-workspace",
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    const sessionBefore = store.requireSession("v3-session");
    const migrationDeleteTrigger = current
      .prepare(
        `SELECT sql FROM sqlite_master
         WHERE type = 'trigger' AND name = 'schema_migrations_no_delete'`,
      )
      .get() as { sql: string };
    current.exec(`
      DROP TABLE credential_operation_journal;
      DROP TRIGGER schema_migrations_no_delete;
      DELETE FROM schema_migrations WHERE version = 4;
    `);
    current.exec(migrationDeleteTrigger.sql);
    closeDatabase(current);

    const upgraded = trackDatabase(createSoarDatabase(databasePath));
    expect(listAppliedDatabaseMigrations(upgraded).map(({ version }) => version)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(new EventStore(upgraded).requireSession("v3-session")).toEqual(
      sessionBefore,
    );
    expect(
      upgraded
        .prepare("SELECT COUNT(*) AS count FROM credential_operation_journal")
        .get(),
    ).toEqual({ count: 0 });
    expect(upgraded.pragma("foreign_key_check")).toEqual([]);
    expect(upgraded.pragma("integrity_check", { simple: true })).toBe("ok");
    const migrationsBeforeReopen = listAppliedDatabaseMigrations(upgraded);
    closeDatabase(upgraded);

    const reopened = trackDatabase(createSoarDatabase(databasePath));
    expect(listAppliedDatabaseMigrations(reopened)).toEqual(
      migrationsBeforeReopen,
    );
    expect(
      reopened
        .prepare("SELECT COUNT(*) AS count FROM credential_operation_journal")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("rejects credential journal migration checksum drift", () => {
    const databasePath = temporaryDatabasePath();
    const current = trackDatabase(createSoarDatabase(databasePath));
    const noUpdateTrigger = current
      .prepare(
        `SELECT sql FROM sqlite_master
         WHERE type = 'trigger' AND name = 'schema_migrations_no_update'`,
      )
      .get() as { sql: string };
    current.exec("DROP TRIGGER schema_migrations_no_update");
    current
      .prepare(
        "UPDATE schema_migrations SET checksum_sha256 = ? WHERE version = 4",
      )
      .run("a".repeat(64));
    current.exec(noUpdateTrigger.sql);
    closeDatabase(current);

    expect(() => createSoarDatabase(databasePath)).toThrow(
      /Database migration 4 does not match the supported name\/checksum/u,
    );
  });

  it("migrates and terminally recovers a real pre-v3 open reservation", () => {
    const databasePath = temporaryDatabasePath();
    const current = trackDatabase(createSoarDatabase(databasePath));
    const currentStore = new EventStore(current);
    currentStore.createSession({
      id: "pre-v3-open-session",
      title: "Pre-v3 open reservation",
      objective: "Prove migrated legacy exposure can be terminalized.",
      workspaceRoot: "/tmp/pre-v3-open-workspace",
      completionObligations: {
        requiredSuccessfulTools: ["read_text_file"],
        minimumVerifiedPathLineCitations: 0,
      },
      executionPolicy: {
        schemaVersion: "agentic-execution-v2",
        inferenceRounds: 2,
        toolCalls: 1,
        routingPolicy: "hybrid_v0",
        maxProviderChanges: 2,
        maxPaidAttempts: 1,
        maxPaidEpisodeMicrousd: 250,
        maxEpisodeDurationMs: 120_000,
        attemptTimeoutMs: 30_000,
        egressConsent: "session_cloud_synthesis_v1",
      },
      createdAt: "2026-08-29T00:00:00.000Z",
    });
    currentStore.append(
      "pre-v3-open-session",
      {
        type: "session.started",
        payload: {
          startedAt: "2026-08-29T00:00:01.000Z",
          deadlineAt: "2026-08-29T00:02:01.000Z",
        },
      },
      {
        expectedSequence: 2,
        createdAt: "2026-08-29T00:00:01.000Z",
      },
    );
    currentStore.appendMany(
      "pre-v3-open-session",
      [
        {
          type: "routing.decision.recorded",
          payload: {
            decisionId: "pre-v3-local-decision",
            policyVersion: "hybrid-lease-router-v0",
            boundary: "session_start",
            phase: "investigation",
            action: "assign_new_lease",
            reasonCode: "local_investigation",
            candidateProviderIds: ["pre-v3-local"],
            selectedProviderId: "pre-v3-local",
            selectedModel: "pre-v3-local-model",
            selectedLeaseId: "pre-v3-local-lease",
            riskSignals: [],
            triggerFacts: [],
            admission: {
              capability: { status: "passed", reasonCode: "capability_ok" },
              credential: {
                status: "not_applicable",
                reasonCode: "not_applicable",
              },
              health: {
                status: "not_applicable",
                reasonCode: "not_applicable",
              },
              egress: {
                status: "not_applicable",
                reasonCode: "not_applicable",
              },
              deadline: { status: "passed", reasonCode: "deadline_ok" },
              budget: {
                status: "not_applicable",
                reasonCode: "not_applicable",
              },
            },
          },
        },
        {
          type: "route.assigned",
          payload: {
            providerId: "pre-v3-local",
            model: "pre-v3-local-model",
            reason: "pre-v3 local investigation",
            decisionId: "pre-v3-local-decision",
            leaseId: "pre-v3-local-lease",
            phase: "investigation",
          },
        },
        {
          type: "assistant.message.started",
          payload: {
            messageId: "pre-v3-local-message",
            providerId: "pre-v3-local",
            model: "pre-v3-local-model",
            decisionId: "pre-v3-local-decision",
            leaseId: "pre-v3-local-lease",
            checkpointId: "pre-v3-open-session:context:1",
            attemptId: "pre-v3-local-attempt",
          },
        },
        {
          type: "context.compiled",
          payload: {
            checkpointId: "pre-v3-open-session:context:1",
            compilerVersion: "context-compiler-v1",
            reason: "session_start",
            mode: "working",
            providerId: "pre-v3-local",
            model: "pre-v3-local-model",
            maxTokens: 2_000,
            estimatedTokens: 100,
            estimator: "utf8-bytes-v1",
            reservedInputTokens: 100,
            effectiveInputTokenBudget: 1_700,
            sourceMessageCount: 1,
            messageCount: 1,
            evidenceCount: 0,
            deduplicatedEvidenceCount: 0,
            omittedEvidenceCount: 0,
            packetSha256: "1".repeat(64),
            messagesSha256: "2".repeat(64),
            safetyMargin: 0.1,
            decisionId: "pre-v3-local-decision",
            leaseId: "pre-v3-local-lease",
            messageId: "pre-v3-local-message",
            attemptId: "pre-v3-local-attempt",
          },
        },
        {
          type: "inference.attempt.started",
          payload: {
            attemptId: "pre-v3-local-attempt",
            round: 1,
            checkpointId: "pre-v3-open-session:context:1",
            messageId: "pre-v3-local-message",
            decisionId: "pre-v3-local-decision",
            leaseId: "pre-v3-local-lease",
            providerId: "pre-v3-local",
            requestedModel: "pre-v3-local-model",
            phase: "investigation",
            requestedMaxOutputTokens: 100,
            allowTools: true,
            allowedToolNames: ["read_text_file"],
            requireToolCall: true,
          },
        },
      ],
      {
        expectedSequence: 3,
        createdAt: "2026-08-29T00:00:02.000Z",
      },
    );
    currentStore.appendMany(
      "pre-v3-open-session",
      [
        {
          type: "assistant.message.completed",
          payload: {
            messageId: "pre-v3-local-message",
            stopReason: "tool_calls",
            completionState: "complete",
            attemptId: "pre-v3-local-attempt",
          },
        },
        {
          type: "inference.attempt.finished",
          payload: {
            attemptId: "pre-v3-local-attempt",
            checkpointId: "pre-v3-open-session:context:1",
            outcome: "succeeded",
            requestDisposition: "sent",
            finishReason: "tool_calls",
            servedModel: "pre-v3-local-model",
            usage: {
              inputTokens: 10,
              outputTokens: 5,
              reasoningTokens: 0,
              reported: true,
            },
            cost: {
              amountMicrousd: 0,
              provenance: "local_zero_cost_policy",
            },
            latencyMs: 10,
          },
        },
        {
          type: "tool.call.requested",
          payload: {
            toolCallId: "pre-v3-local-tool",
            messageId: "pre-v3-local-message",
            name: "read_text_file",
            arguments: { relativePath: "README.md" },
          },
        },
        {
          type: "tool.call.completed",
          payload: {
            toolCallId: "pre-v3-local-tool",
            name: "read_text_file",
            content: JSON.stringify({
              ok: true,
              text: "pre-v3 evidence",
              bytes: 15,
              truncated: false,
            }),
            isError: false,
            durationMs: 1,
          },
        },
      ],
      {
        expectedSequence: 8,
        createdAt: "2026-08-29T00:00:03.000Z",
      },
    );
    currentStore.appendMany(
      "pre-v3-open-session",
      [
        {
          type: "routing.decision.recorded",
          payload: {
            decisionId: "pre-v3-cloud-decision",
            policyVersion: "hybrid-lease-router-v0",
            boundary: "evidence_complete",
            phase: "synthesis",
            action: "assign_new_lease",
            reasonCode: "cloud_admitted",
            candidateProviderIds: ["pre-v3-local", "pre-v3-provider"],
            selectedProviderId: "pre-v3-provider",
            selectedModel: "pre-v3-cloud-model",
            priorLeaseId: "pre-v3-local-lease",
            selectedLeaseId: "pre-v3-cloud-lease",
            riskSignals: [],
            triggerFacts: [],
            admission: {
              capability: { status: "passed", reasonCode: "capability_ok" },
              credential: { status: "passed", reasonCode: "credential_ok" },
              health: { status: "passed", reasonCode: "health_ok" },
              pricing: { status: "passed", reasonCode: "pricing_ok" },
              egress: { status: "passed", reasonCode: "egress_ok" },
              deadline: { status: "passed", reasonCode: "deadline_ok" },
              budget: { status: "passed", reasonCode: "budget_ok" },
            },
            healthSnapshotId: "pre-v3-health",
            pricingSnapshotId: "pre-v3-pricing",
            campaignId: "pre-v3-campaign",
            budgetReservationId: "pre-v3-reservation",
            credentialMetadataId: "pre-v3-credential",
            billing: {
              billableInputTokens: 100,
              billableCacheReadTokens: 0,
              requestedMaxOutputTokens: 100,
              inputMicrousdPerMillionTokens: 1_000_000,
              outputMicrousdPerMillionTokens: 1_000_000,
              cacheReadMicrousdPerMillionTokens: 0,
              providerFeeCeilingMicrousd: 50,
              roundingPolicy: "ceil_each_component_v1",
              projectedCostMicrousd: 250,
              remainingEpisodeMicrousd: 250,
              remainingCampaignMicrousd: 250,
            },
            checkpointId: "pre-v3-open-session:context:2",
            packetSha256: "3".repeat(64),
            messagesSha256: "4".repeat(64),
          },
        },
        {
          type: "route.assigned",
          payload: {
            providerId: "pre-v3-provider",
            model: "pre-v3-cloud-model",
            reason: "pre-v3 admitted cloud synthesis",
            decisionId: "pre-v3-cloud-decision",
            leaseId: "pre-v3-cloud-lease",
            phase: "synthesis",
          },
        },
        {
          type: "assistant.message.started",
          payload: {
            messageId: "pre-v3-cloud-message",
            providerId: "pre-v3-provider",
            model: "pre-v3-cloud-model",
            decisionId: "pre-v3-cloud-decision",
            leaseId: "pre-v3-cloud-lease",
            checkpointId: "pre-v3-open-session:context:2",
            attemptId: "pre-v3-attempt",
          },
        },
        {
          type: "context.compiled",
          payload: {
            checkpointId: "pre-v3-open-session:context:2",
            compilerVersion: "context-compiler-v1",
            reason: "finalization_boundary",
            mode: "finalization",
            providerId: "pre-v3-provider",
            model: "pre-v3-cloud-model",
            maxTokens: 2_000,
            estimatedTokens: 100,
            estimator: "utf8-bytes-v1",
            reservedInputTokens: 0,
            effectiveInputTokenBudget: 1_800,
            sourceMessageCount: 1,
            messageCount: 1,
            evidenceCount: 1,
            deduplicatedEvidenceCount: 1,
            omittedEvidenceCount: 0,
            packetSha256: "3".repeat(64),
            messagesSha256: "4".repeat(64),
            safetyMargin: 0.1,
            decisionId: "pre-v3-cloud-decision",
            leaseId: "pre-v3-cloud-lease",
            messageId: "pre-v3-cloud-message",
            attemptId: "pre-v3-attempt",
          },
        },
        {
          type: "inference.attempt.started",
          payload: {
            attemptId: "pre-v3-attempt",
            round: 2,
            checkpointId: "pre-v3-open-session:context:2",
            messageId: "pre-v3-cloud-message",
            decisionId: "pre-v3-cloud-decision",
            leaseId: "pre-v3-cloud-lease",
            providerId: "pre-v3-provider",
            requestedModel: "pre-v3-cloud-model",
            phase: "synthesis",
            requestedMaxOutputTokens: 100,
            allowTools: false,
            requireToolCall: false,
            budgetReservationId: "pre-v3-reservation",
          },
        },
      ],
      {
        expectedSequence: 12,
        createdAt: "2026-08-29T00:00:04.000Z",
      },
    );
    current.prepare(
      `INSERT INTO budget_ledger_entries (
         id, row_type, campaign_id, provider_id, credential_metadata_id,
         amount_microusd, opening_exposure_microusd,
         automatic_stop_microusd, hard_ceiling_microusd, cost_scope, created_at
       ) VALUES (?, 'campaign', ?, ?, ?, ?, ?, ?, ?, 'simulation', ?)`,
    ).run(
      "pre-v3-campaign",
      "pre-v3-campaign",
      "pre-v3-provider",
      "pre-v3-credential",
      0,
      0,
      250,
      250,
      "2026-08-29T00:00:00.000Z",
    );
    current.prepare(
      `INSERT INTO budget_ledger_entries (
         id, row_type, campaign_id, reservation_id, session_id, attempt_id,
         provider_id, pricing_snapshot_id, amount_microusd,
         billable_estimated_input_tokens, requested_max_output_tokens,
         cache_read_tokens_assumed, input_rate_microusd_per_million,
         output_rate_microusd_per_million,
         cache_read_rate_microusd_per_million, provider_fee_ceiling_microusd,
         cache_assumption, rounding_policy, cost_scope,
         cloud_egress_admission_id, created_at
       ) VALUES (
         ?, 'reservation', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         'no_cache_credit', 'ceil_each_component_v1', 'simulation', ?, ?
       )`,
    ).run(
      "pre-v3-reservation",
      "pre-v3-campaign",
      "pre-v3-reservation",
      "pre-v3-open-session",
      "pre-v3-attempt",
      "pre-v3-provider",
      "pre-v3-pricing",
      250,
      100,
      100,
      0,
      1_000_000,
      1_000_000,
      0,
      50,
      "pre-v3-egress",
      "2026-08-29T00:00:04.000Z",
    );

    const migrationDeleteTrigger = current
      .prepare(
        `SELECT sql FROM sqlite_master
         WHERE type = 'trigger' AND name = 'schema_migrations_no_delete'`,
      )
      .get() as { sql: string };
    current.exec(`
      DROP TRIGGER budget_ledger_runtime_cost_scope_guard;
      DROP TRIGGER budget_ledger_egress_identity_guard;
      DROP TRIGGER budget_ledger_actual_legacy_exposure_guard;
      DROP TRIGGER budget_ledger_reservation_parent_guard;
      DROP TRIGGER budget_ledger_terminal_parent_guard;
      DROP INDEX budget_ledger_reservation_egress_admission_idx;
      DROP INDEX budget_ledger_cost_scope_row_type_idx;
      ALTER TABLE budget_ledger_entries DROP COLUMN cloud_egress_admission_id;
      ALTER TABLE budget_ledger_entries DROP COLUMN cost_scope;
      CREATE TRIGGER budget_ledger_reservation_parent_guard
      BEFORE INSERT ON budget_ledger_entries
      WHEN NEW.row_type = 'reservation'
      BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM budget_ledger_entries AS campaign
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
          SELECT 1 FROM budget_ledger_entries AS reservation
          WHERE reservation.id = NEW.reservation_id
            AND reservation.row_type = 'reservation'
            AND reservation.campaign_id = NEW.campaign_id
        ) THEN RAISE(ABORT, 'budget terminal row reservation/campaign mismatch') END;
      END;
      DROP TABLE credential_operation_journal;
      DROP TRIGGER schema_migrations_no_delete;
      DELETE FROM schema_migrations WHERE version IN (3, 4);
    `);
    current.exec(migrationDeleteTrigger.sql);
    closeDatabase(current);

    const migrated = trackDatabase(createSoarDatabase(databasePath));
    expect(listAppliedDatabaseMigrations(migrated)).toHaveLength(4);
    expect(
      migrated
        .prepare(
          `SELECT id, cost_scope, cloud_egress_admission_id
           FROM budget_ledger_entries
           WHERE id IN ('pre-v3-campaign', 'pre-v3-reservation')
           ORDER BY id`,
        )
        .all(),
    ).toEqual([
      {
        id: "pre-v3-campaign",
        cost_scope: "legacy_unclassified",
        cloud_egress_admission_id: null,
      },
      {
        id: "pre-v3-reservation",
        cost_scope: "legacy_unclassified",
        cloud_egress_admission_id: null,
      },
    ]);

    const migratedStore = new EventStore(migrated);
    expect(migratedStore.requireSession("pre-v3-open-session")).toMatchObject({
      status: "running",
      lastSequence: 17,
    });
    const migratedState = migratedStore.replay("pre-v3-open-session");
    expect(migratedState.costScopes).toMatchObject({
      actual: { reservedMicrousd: 0, settledMicrousd: 0 },
      simulation: { reservedMicrousd: 0, settledMicrousd: 0 },
      legacyUnclassified: {
        present: true,
        reservedMicrousd: 250,
        settledMicrousd: 0,
      },
    });
    const migratedOpenAttempt = migratedState.inferenceAttempts.at(-1);
    expect(migratedOpenAttempt).toMatchObject({
      attemptId: "pre-v3-attempt",
      budgetReservationId: "pre-v3-reservation",
    });
    expect(migratedOpenAttempt).not.toHaveProperty("costScope");
    expect(migratedOpenAttempt).not.toHaveProperty("finished");

    const recovered = recoverRunningSessions(migratedStore, {
      reason: "Recover the migrated pre-v3 provider dispatch.",
      createdAt: "2026-08-29T00:00:05.000Z",
    });
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.attemptEvent).toMatchObject({
      sequence: 18,
      type: "inference.attempt.finished",
      payload: {
        attemptId: "pre-v3-attempt",
        outcome: "interrupted",
        requestDisposition: "unknown",
        cost: {
          amountMicrousd: 250,
          provenance: "reserved_unknown",
          reservationId: "pre-v3-reservation",
        },
      },
    });
    expect(recovered[0]?.event).toMatchObject({
      sequence: 19,
      type: "session.interrupted",
    });
    const recoveredState = migratedStore.replay("pre-v3-open-session");
    expect(recoveredState).toMatchObject({
      status: "interrupted",
      lastSequence: 19,
      costScopes: {
        actual: { reservedMicrousd: 0, settledMicrousd: 0 },
        simulation: { reservedMicrousd: 0, settledMicrousd: 0 },
        legacyUnclassified: {
          present: true,
          reservedMicrousd: 250,
          settledMicrousd: 250,
        },
      },
    });
    expect(recoveredState.inferenceAttempts.at(-1)?.finished?.cost).not.toHaveProperty(
      "costScope",
    );
    expect(migratedStore.getProjectedState("pre-v3-open-session")).toEqual(
      recoveredState,
    );

    const ledger = new BudgetLedger(migratedStore);
    expect(ledger.listOutstandingReservations()).toEqual([]);
    expect(ledger.getCostScopeSummary().legacyUnclassified).toMatchObject({
      rowCount: 3,
      outstandingReservationMicrousd: 0,
      settledMicrousd: 250,
      present: true,
    });
    expect(
      migrated
        .prepare(
          `SELECT row_type, amount_microusd, cost_provenance,
                  request_disposition, cost_scope
           FROM budget_ledger_entries
           WHERE reservation_id = 'pre-v3-reservation'
             AND row_type IN ('settlement', 'release', 'overrun')`,
        )
        .all(),
    ).toEqual([
      {
        row_type: "settlement",
        amount_microusd: 250,
        cost_provenance: "reserved_unknown",
        request_disposition: "unknown",
        cost_scope: "legacy_unclassified",
      },
    ]);
    expect(migratedStore.requireSession("pre-v3-open-session").totalCostUsd).toBe(
      0,
    );
    expect(recoverRunningSessions(migratedStore)).toEqual([]);
    ledger.assertEventReconciled();
    closeDatabase(migrated);

    const restarted = trackDatabase(createSoarDatabase(databasePath));
    const restartedStore = new EventStore(restarted);
    const restartedLedger = new BudgetLedger(restartedStore);
    expect(restartedLedger.listOutstandingReservations()).toEqual([]);
    expect(recoverRunningSessions(restartedStore)).toEqual([]);
    expect(restartedStore.getProjectedState("pre-v3-open-session")).toEqual(
      restartedStore.replay("pre-v3-open-session"),
    );
    expect(
      restarted
        .prepare(
          `SELECT COUNT(*) AS count FROM budget_ledger_entries
           WHERE reservation_id = 'pre-v3-reservation'
             AND row_type IN ('settlement', 'release', 'overrun')`,
        )
        .get(),
    ).toEqual({ count: 1 });
    restartedLedger.assertEventReconciled();
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
        5,
        "future-migration",
        "a".repeat(64),
        "2026-08-29T00:00:00.000Z",
      );
    closeDatabase(current);

    expect(() => createSoarDatabase(databasePath)).toThrow(
      /newer than supported version 4/,
    );

    const raw = trackDatabase(new BetterSqlite3(databasePath, { readonly: true }));
    expect(
      raw.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get(),
    ).toEqual({ count: 5 });
  });

  it("provides a scoped, egress-linked append-only budget schema", () => {
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
        cost_scope, cloud_egress_admission_id,
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
        @costScope, @cloudEgressAdmissionId,
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
      costScope: "actual",
      cloudEgressAdmissionId: null,
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
      cloudEgressAdmissionId: "egress-reservation-1",
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
        cloudEgressAdmissionId: `egress-${reservationId}`,
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
        cloudEgressAdmissionId: "egress-wrong-provider-reservation",
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
    ).toThrow(/campaign\/provider\/scope mismatch/);

    expect(() =>
      insert.run({
        ...empty,
        id: "wrong-scope-reservation",
        rowType: "reservation",
        campaignId: "campaign-1",
        reservationId: "wrong-scope-reservation",
        sessionId: "budget-schema-session",
        attemptId: "attempt-wrong-scope",
        providerId: "fake-cloud",
        pricingSnapshotId: "pricing-1",
        costScope: "simulation",
        cloudEgressAdmissionId: "egress-wrong-scope-reservation",
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
    ).toThrow(/campaign\/provider\/scope mismatch/);

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

    expect(() =>
      insert.run({
        ...empty,
        id: "wrong-scope-settlement",
        rowType: "settlement",
        campaignId: "campaign-1",
        reservationId: "reservation-1",
        costScope: "simulation",
        amountMicrousd: 180_000,
        costProvenance: "provider_reported",
        requestDisposition: "sent",
      }),
    ).toThrow(/reservation\/campaign\/scope mismatch/);

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

    // Migration may legitimately leave historical rows unclassified. Bypass
    // only the new-row legacy guard to construct that migrated state; the
    // independent actual-admission trigger must still deny a new reservation.
    database.exec("DROP TRIGGER budget_ledger_runtime_cost_scope_guard");
    insert.run({
      ...empty,
      id: "legacy-campaign",
      rowType: "campaign",
      campaignId: "legacy-campaign",
      providerId: "legacy-provider",
      credentialMetadataId: "legacy-credential",
      costScope: "legacy_unclassified",
      amountMicrousd: 17,
      openingExposureMicrousd: 17,
      automaticStopMicrousd: 100,
      hardCeilingMicrousd: 100,
    });
    expect(() =>
      insert.run({
        ...empty,
        id: "actual-blocked-by-legacy",
        rowType: "reservation",
        campaignId: "campaign-1",
        reservationId: "actual-blocked-by-legacy",
        sessionId: "budget-schema-session",
        attemptId: "attempt-blocked-by-legacy",
        providerId: "fake-cloud",
        pricingSnapshotId: "pricing-1",
        cloudEgressAdmissionId: "egress-blocked-by-legacy",
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
    ).toThrow(/actual admission blocked by legacy unclassified exposure/);
  });
});
