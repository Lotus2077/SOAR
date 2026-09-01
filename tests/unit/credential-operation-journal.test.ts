import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CredentialOperationJournal } from "../../src/main/credentials/credential-operation-journal";
import {
  createSoarDatabase,
  type SoarDatabase,
} from "../../src/main/database";

const databases: SoarDatabase[] = [];
const temporaryDirectories: string[] = [];
const GENERATION_ONE =
  "generation-00000000-0000-4000-8000-000000000001";
const GENERATION_TWO =
  "generation-00000000-0000-4000-8000-000000000002";
const DIFFERENT_GENERATION =
  "generation-00000000-0000-4000-8000-000000000003";
const OPERATION_ID_PATTERN =
  /^operation-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function setup(): {
  database: SoarDatabase;
  journal: CredentialOperationJournal;
} {
  const database = createSoarDatabase();
  databases.push(database);
  return { database, journal: new CredentialOperationJournal(database) };
}

describe("CredentialOperationJournal", () => {
  it("persists only bounded non-secret operation metadata", () => {
    const { database, journal } = setup();
    const operation = journal.begin({
      operationKind: "store_protected",
      requestedGeneration: GENERATION_ONE,
      startedAt: "2026-09-01T00:00:00.000Z",
    });

    expect(operation).toEqual({
      operationId: expect.stringMatching(OPERATION_ID_PATTERN),
      operationKind: "store_protected",
      requestedGeneration: GENERATION_ONE,
      startedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      state: "pending",
      identityCapabilityVersion: "credential-lease-authority-v1",
    });
    expect(
      database.prepare("PRAGMA table_info(credential_operation_journal)").all(),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "operation_id" }),
        expect.objectContaining({ name: "operation_kind" }),
        expect.objectContaining({ name: "requested_generation" }),
        expect.objectContaining({ name: "started_at" }),
        expect.objectContaining({ name: "updated_at" }),
        expect.objectContaining({ name: "state" }),
        expect.objectContaining({ name: "result_code" }),
        expect.objectContaining({ name: "recovery_code" }),
        expect.objectContaining({ name: "identity_capability_version" }),
      ]),
    );
    expect(
      (
        database.prepare("PRAGMA table_info(credential_operation_journal)").all() as Array<{
          name: string;
        }>
      ).map((column) => column.name),
    ).toEqual([
      "operation_id",
      "operation_kind",
      "requested_generation",
      "started_at",
      "updated_at",
      "state",
      "result_code",
      "recovery_code",
      "identity_capability_version",
    ]);
  });

  it("requires generations only for store and replace operations", () => {
    const { journal } = setup();
    expect(() =>
      journal.begin({
        operationKind: "store_protected",
        startedAt: "2026-09-01T00:00:00.000Z",
      }),
    ).toThrow(/generation/u);
    expect(() =>
      journal.begin({
        operationKind: "remove_protected",
        requestedGeneration: GENERATION_ONE,
        startedAt: "2026-09-01T00:00:00.000Z",
      }),
    ).toThrow(/generation/u);
    expect(
      journal.begin({
        operationKind: "remove_protected",
        startedAt: "2026-09-01T00:00:00.000Z",
      }),
    ).toMatchObject({ state: "pending" });
  });

  it("denies a duplicate mutation while one outcome is unresolved", () => {
    const { journal } = setup();
    const first = journal.begin({
      operationKind: "replace_protected",
      requestedGeneration: GENERATION_ONE,
      startedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(() =>
      journal.begin({
        operationKind: "replace_protected",
        requestedGeneration: GENERATION_TWO,
        startedAt: "2026-09-01T00:00:01.000Z",
      }),
    ).toThrow(/UNIQUE constraint failed/u);

    journal.markCallerAbandoned(
      first.operationId,
      "2026-09-01T00:00:02.000Z",
    );
    expect(() =>
      journal.begin({
        operationKind: "remove_protected",
        startedAt: "2026-09-01T00:00:03.000Z",
      }),
    ).toThrow(/UNIQUE constraint failed/u);
  });

  it("keeps the native observer alive after caller abandonment and accepts one late completion", () => {
    const { journal } = setup();
    const operation = journal.begin({
      operationKind: "replace_protected",
      requestedGeneration: GENERATION_ONE,
      startedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(
      journal.markCallerAbandoned(
        operation.operationId,
        "2026-09-01T00:00:01.000Z",
      ),
    ).toMatchObject({
      state: "outcome_unknown",
      resultCode: "caller_abandoned",
      recoveryCode: "await_native_completion",
    });
    expect(
      journal.confirmFromLiveCompletion(
        operation.operationId,
        "success",
        "2026-09-01T00:00:02.000Z",
      ),
    ).toMatchObject({
      state: "confirmed",
      resultCode: "native_success_confirmed",
    });
    expect(() =>
      journal.confirmFromLiveCompletion(
        operation.operationId,
        "success",
        "2026-09-01T00:00:03.000Z",
      ),
    ).toThrow(/cannot accept a live completion/u);
  });

  it("turns a process restart into conservative ambiguity and never treats mismatch as failure", () => {
    const { journal } = setup();
    const operation = journal.begin({
      operationKind: "replace_protected",
      requestedGeneration: GENERATION_ONE,
      startedAt: "2026-09-01T00:00:00.000Z",
    });

    expect(
      journal.recoverAfterRestart("2026-09-01T00:00:01.000Z"),
    ).toMatchObject({
      state: "outcome_unknown",
      resultCode: "process_interrupted",
      recoveryCode: "manual_recovery_required",
    });
    expect(() =>
      journal.confirmFromExactGeneration(
        operation.operationId,
        DIFFERENT_GENERATION,
        "2026-09-01T00:00:02.000Z",
      ),
    ).toThrow(/does not prove/u);
    expect(journal.unresolved()).toMatchObject({
      state: "outcome_unknown",
      requestedGeneration: GENERATION_ONE,
    });
    expect(
      journal.markMetadataMismatch(
        operation.operationId,
        "2026-09-01T00:00:03.000Z",
      ),
    ).toMatchObject({
      state: "outcome_unknown",
      recoveryCode: "manual_recovery_required",
    });
  });

  it("recovers conservatively when the wall clock moved behind persisted time", () => {
    const { journal } = setup();
    journal.begin({
      operationKind: "replace_protected",
      requestedGeneration: GENERATION_ONE,
      startedAt: "2026-09-01T00:00:10.000Z",
    });

    expect(
      journal.recoverAfterRestart("2026-09-01T00:00:00.000Z"),
    ).toMatchObject({
      state: "outcome_unknown",
      resultCode: "process_interrupted",
      recoveryCode: "manual_recovery_required",
      updatedAt: "2026-09-01T00:00:10.000Z",
    });
  });

  it("reconciles an awaiting observer after a real database close and reopen", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "soar-credential-journal-restart-"),
    );
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "soar.sqlite");
    const first = createSoarDatabase(databasePath);
    const firstJournal = new CredentialOperationJournal(first);
    const operation = firstJournal.begin({
      operationKind: "replace_protected",
      requestedGeneration: GENERATION_ONE,
      startedAt: "2026-09-01T00:00:00.000Z",
    });
    firstJournal.markCallerAbandoned(
      operation.operationId,
      "2026-09-01T00:00:01.000Z",
    );
    first.close();

    const reopened = createSoarDatabase(databasePath);
    databases.push(reopened);
    expect(
      new CredentialOperationJournal(reopened).recoverAfterRestart(
        "2026-09-01T00:00:02.000Z",
      ),
    ).toMatchObject({
      operationId: operation.operationId,
      state: "outcome_unknown",
      resultCode: "process_interrupted",
      recoveryCode: "manual_recovery_required",
    });
  });

  it("enforces the unresolved-operation lock across database connections", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "soar-credential-journal-connections-"),
    );
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "soar.sqlite");
    const first = createSoarDatabase(databasePath);
    const second = createSoarDatabase(databasePath);
    databases.push(first, second);
    new CredentialOperationJournal(first).begin({
      operationKind: "store_protected",
      requestedGeneration: GENERATION_ONE,
      startedAt: "2026-09-01T00:00:00.000Z",
    });

    expect(() =>
      new CredentialOperationJournal(second).begin({
        operationKind: "replace_protected",
        requestedGeneration: GENERATION_TWO,
        startedAt: "2026-09-01T00:00:01.000Z",
      }),
    ).toThrow(/UNIQUE constraint failed/u);
  });

  it("confirms an unknown store or replace only from its exact generation", () => {
    const { journal } = setup();
    const operation = journal.begin({
      operationKind: "store_protected",
      requestedGeneration: GENERATION_ONE,
      startedAt: "2026-09-01T00:00:00.000Z",
    });
    journal.recoverAfterRestart("2026-09-01T00:00:01.000Z");

    expect(
      journal.confirmFromExactGeneration(
        operation.operationId,
        GENERATION_ONE,
        "2026-09-01T00:00:02.000Z",
      ),
    ).toMatchObject({
      state: "confirmed",
      resultCode: "metadata_match_confirmed",
    });
    expect(journal.unresolved()).toBeUndefined();
    expect(
      journal.begin({
        operationKind: "remove_protected",
        startedAt: "2026-09-01T00:00:03.000Z",
      }),
    ).toMatchObject({ state: "pending" });
  });

  it("enforces immutable identity, monotonic time, terminal states, and no deletion in SQLite", () => {
    const { database, journal } = setup();
    const operation = journal.begin({
      operationKind: "remove_protected",
      startedAt: "2026-09-01T00:00:00.000Z",
    });
    journal.confirmFromLiveCompletion(
      operation.operationId,
      "failure",
      "2026-09-01T00:00:01.000Z",
    );

    expect(() =>
      database
        .prepare(
          "UPDATE credential_operation_journal SET operation_kind = 'remove_legacy_staged' WHERE operation_id = ?",
        )
        .run(operation.operationId),
    ).toThrow(/identity is immutable|state transition/u);
    expect(() =>
      database
        .prepare(
          "UPDATE credential_operation_journal SET updated_at = ? WHERE operation_id = ?",
        )
        .run("2026-08-31T23:59:59.999Z", operation.operationId),
    ).toThrow(/move backward|state transition/u);
    expect(() =>
      database
        .prepare(
          `UPDATE credential_operation_journal
           SET state = 'outcome_unknown', result_code = 'process_interrupted',
               recovery_code = 'manual_recovery_required', updated_at = ?
           WHERE operation_id = ?`,
        )
        .run("2026-09-01T00:00:02.000Z", operation.operationId),
    ).toThrow(/invalid credential operation state transition/u);
    expect(() =>
      database
        .prepare(
          "DELETE FROM credential_operation_journal WHERE operation_id = ?",
        )
        .run(operation.operationId),
    ).toThrow(/cannot be deleted/u);
    expect(() =>
      database
        .prepare(
          `INSERT OR REPLACE INTO credential_operation_journal
           SELECT * FROM credential_operation_journal WHERE operation_id = ?`,
        )
        .run(operation.operationId),
    ).toThrow(/cannot be deleted|identity is immutable|state transition/u);
  });

  it("projects no operation identity or requested generation to shared status", () => {
    const { journal } = setup();
    const operation = journal.begin({
      operationKind: "store_protected",
      requestedGeneration: GENERATION_ONE,
      startedAt: "2026-09-01T00:00:00.000Z",
    });

    const projection = journal.latestProjection();
    expect(projection).toEqual({
      state: "pending",
      kind: "store_protected",
    });
    expect(JSON.stringify(projection)).not.toContain(operation.operationId);
    expect(JSON.stringify(projection)).not.toContain(GENERATION_ONE);
  });

  it("rejects credential-shaped values, private paths, and malformed UUID identities before persistence", () => {
    const { journal } = setup();
    const credentialShaped = `sk-or-v1-${"x".repeat(32)}`;
    const privatePath = path.join("/Users", "example", ".config", "provider-key");
    const invalidGenerations = [
      credentialShaped,
      privatePath,
      "generation-not-a-uuid",
      "generation-00000000-0000-3000-8000-000000000001",
      "generation-00000000-0000-4000-7000-000000000001",
      "generation-00000000-0000-4000-8000-00000000000A",
    ];

    for (const requestedGeneration of invalidGenerations) {
      expect(() =>
        journal.begin({
          operationKind: "store_protected",
          requestedGeneration,
          startedAt: "2026-09-01T00:00:00.000Z",
        }),
      ).toThrow();
    }
    const invalidOperationIds = [
      credentialShaped,
      privatePath,
      "operation-not-a-uuid",
      "operation-00000000-0000-3000-8000-000000000001",
      "operation-00000000-0000-4000-7000-000000000001",
      "operation-00000000-0000-4000-8000-00000000000A",
    ];
    for (const callerIdentity of invalidOperationIds) {
      expect(() => journal.get(callerIdentity)).toThrow();
      expect(() =>
        journal.markCallerAbandoned(
          callerIdentity,
          "2026-09-01T00:00:01.000Z",
        ),
      ).toThrow();
    }
    expect(journal.listForTest()).toEqual([]);
  });

  it("rejects invalid branded UUIDv4 operation IDs and generations in direct SQL", () => {
    const { database } = setup();
    const credentialShaped = `sk-or-v1-${"x".repeat(32)}`;
    const privatePath = path.join("/Users", "example", ".config", "provider-key");
    const validOperation =
      "operation-00000000-0000-4000-8000-000000000001";
    const validGeneration = GENERATION_ONE;
    const insert = database.prepare(
      `INSERT INTO credential_operation_journal (
         operation_id, operation_kind, requested_generation, started_at,
         updated_at, state, result_code, recovery_code,
         identity_capability_version
       ) VALUES (?, 'store_protected', ?, ?, ?, 'pending', NULL, NULL, ?)`,
    );
    const invalidOperationIds = [
      credentialShaped,
      privatePath,
      "operation-not-a-uuid",
      "operation-00000000-0000-3000-8000-000000000001",
      "operation-00000000-0000-4000-7000-000000000001",
      "operation-00000000-0000-4000-8000-00000000000A",
    ];
    const invalidGenerations = [
      credentialShaped,
      privatePath,
      "generation-not-a-uuid",
      "generation-00000000-0000-3000-8000-000000000001",
      "generation-00000000-0000-4000-7000-000000000001",
      "generation-00000000-0000-4000-8000-00000000000A",
    ];
    const timestamp = "2026-09-01T00:00:00.000Z";

    for (const operationId of invalidOperationIds) {
      expect(() =>
        insert.run(
          operationId,
          validGeneration,
          timestamp,
          timestamp,
          "credential-lease-authority-v1",
        ),
      ).toThrow(/CHECK constraint failed/u);
    }
    expect(() =>
      insert.run(
        null,
        validGeneration,
        timestamp,
        timestamp,
        "credential-lease-authority-v1",
      ),
    ).toThrow(/NOT NULL constraint failed/u);
    for (const generation of invalidGenerations) {
      expect(() =>
        insert.run(
          validOperation,
          generation,
          timestamp,
          timestamp,
          "credential-lease-authority-v1",
        ),
      ).toThrow(/CHECK constraint failed/u);
    }
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM credential_operation_journal")
        .get(),
    ).toEqual({ count: 0 });
  });
});
