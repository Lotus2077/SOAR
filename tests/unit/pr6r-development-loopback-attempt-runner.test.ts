import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const authorityTestOs = vi.hoisted(() => ({
  homeDirectory: "/soar-pr6r-runner-home-not-configured",
}));
const checkpointImportTest = vi.hoisted(() => ({
  assertImported: vi.fn(),
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    userInfo: (...args: Parameters<typeof actual.userInfo>) => ({
      ...actual.userInfo(...args),
      homedir: authorityTestOs.homeDirectory,
    }),
  };
});

vi.mock(
  "../../src/main/pr6r-development/checkpoint-import",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/main/pr6r-development/checkpoint-import")
      >();
    return {
      ...actual,
      assertPr6rImportedCheckpoint: checkpointImportTest.assertImported,
    };
  },
);

import {
  CHANGE_REVIEW_SYNTHESIS_CAPABILITIES,
  PROVIDER_HEALTH_MAX_AGE_MS,
} from "../../src/shared/checkpoint-router";
import { projectSafeLocalReviewEventV1 } from "../../src/benchmark/local-review-safe-record";
import type { SoarDatabase } from "../../src/main/database";
import type {
  Pr6rImportedCheckpointAuthority,
  Pr6rImportedCheckpointBinding,
} from "../../src/main/pr6r-development/checkpoint-import";
import {
  claimPr6rCampaignAuthority,
  inspectPr6rAuthorityLedger,
} from "../../src/main/pr6r-development/authority-ledger";
import {
  startPr6rLoopbackFixtureServer,
  type Pr6rCapturedFixtureRequest,
  type Pr6rFixtureListenerCapability,
  type Pr6rLoopbackFixtureServer,
} from "../../src/main/pr6r-development/fixture-server";
import { preparePr6rLoopbackAttempt } from "../../src/main/pr6r-development/loopback-attempt-adapter";
import {
  runPreparedPr6rLoopbackAttempt,
  type Pr6rLoopbackSagaFaultPoint,
} from "../../src/main/pr6r-development/loopback-attempt-runner";
import { buildCanonicalPr6rLoopbackResponseBody } from "../../src/main/pr6r-development/loopback-response";
import {
  bindPr6rCanonicalLedgerAuthorityForRuntime,
  createPr6rDevelopmentRuntimeAuthorityForBuild,
  type Pr6rCanonicalLedgerAuthority,
  type Pr6rDevelopmentRuntimeAuthority,
} from "../../src/main/pr6r-development/runtime-authority";
import {
  PR6R_FIXTURE_SNAPSHOT_ID,
  buildPr6rLoopbackProviderValidationV1,
  buildPr6rSimulationPricingSnapshotV1,
  calculatePr6rHostPricedSimulationCostMicrousd,
  canonicalPr6rJsonV1,
  type CloudApplicationRequestV1,
} from "../../src/shared/pr6r-development-contracts";
import type { ReviewResultV1 } from "../../src/shared/review-result-contract";
import { createPr6rA2ImportedSqliteFixture } from "../helpers/pr6r-a2-sqlite-fixture";

const IMPLEMENTATION_REVISION = "a".repeat(40);
const AS_OF = "2026-09-02T00:00:02.000Z";
const FINISHED_AT = "2026-09-02T00:00:02.500Z";
const RAW_REQUEST_ONLY_MARKER = "Return the strict review result.";
const homes: string[] = [];
const servers: Pr6rLoopbackFixtureServer[] = [];
const databases: SoarDatabase[] = [];

afterEach(async () => {
  checkpointImportTest.assertImported.mockReset();
  vi.useRealTimers();
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
  );
});

function reviewResult(marker = "runner-private-result"): ReviewResultV1 {
  return {
    schemaVersion: "change-review-result-v1",
    snapshotId: PR6R_FIXTURE_SNAPSHOT_ID,
    summary: marker,
    conclusion: "no_blocking_findings",
    evidenceSetId: "e".repeat(64),
    omissions: [],
    findings: [],
  };
}

function importedBinding(
  fixture: ReturnType<typeof createPr6rA2ImportedSqliteFixture>,
): Pr6rImportedCheckpointBinding {
  const state = fixture.store.replay(
    fixture.applicationRequest.synthesisSessionId,
  );
  const imported = state.synthesisCheckpointImport;
  const localRoute = state.routes.at(-1);
  if (
    imported === undefined ||
    localRoute?.leaseId === undefined ||
    state.executionPolicy?.schemaVersion !== "agentic-execution-v2" ||
    state.hybridSimulation === undefined
  ) {
    throw new Error("runner fixture is not at the imported checkpoint");
  }
  return Object.freeze({
    childSessionId: state.id,
    childLastSequence: state.lastSequence,
    imported: Object.freeze(structuredClone(imported)),
    localRoute: Object.freeze({
      providerId: localRoute.providerId,
      model: localRoute.model,
      leaseId: localRoute.leaseId,
    }),
    executionPolicy: Object.freeze(structuredClone(state.executionPolicy)),
    hybridSimulation: Object.freeze(structuredClone(state.hybridSimulation)),
  });
}

function idSource(prefix: string): () => string {
  let sequence = 0;
  return () => `${prefix}:${++sequence}`;
}

function serializeDurableTables(database: SoarDatabase): string {
  const tables = database
    .prepare<[], { name: string }>(
      `SELECT name
         FROM sqlite_master
        WHERE type = 'table'
        ORDER BY name ASC`,
    )
    .all();
  return JSON.stringify(
    tables.map(({ name }) => {
      const escaped = name.replaceAll('"', '""');
      return {
        name,
        rows: database.prepare(`SELECT * FROM "${escaped}"`).all(),
      };
    }),
    (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
  );
}

function expectNoRawMarkers(
  material: string | Uint8Array,
  markers: readonly string[],
): void {
  const bytes =
    typeof material === "string" ? Buffer.from(material) : Buffer.from(material);
  for (const marker of markers) {
    expect(bytes.includes(Buffer.from(marker))).toBe(false);
  }
}

async function closeAndScanDatabase(input: {
  readonly database: SoarDatabase;
  readonly databaseDirectory: string;
  readonly databasePath: string;
  readonly markers: readonly string[];
}): Promise<void> {
  expectNoRawMarkers(serializeDurableTables(input.database), input.markers);
  const index = databases.indexOf(input.database);
  if (index >= 0) databases.splice(index, 1);
  input.database.close();
  const baseName = path.basename(input.databasePath);
  const durableFiles = (await readdir(input.databaseDirectory)).filter((name) =>
    name.startsWith(baseName),
  );
  expect(durableFiles).not.toEqual([]);
  for (const fileName of durableFiles) {
    expectNoRawMarkers(
      await readFile(path.join(input.databaseDirectory, fileName)),
      input.markers,
    );
  }
}

interface ReadyRunner {
  readonly fixture: ReturnType<typeof createPr6rA2ImportedSqliteFixture>;
  readonly server: Pr6rLoopbackFixtureServer;
  readonly prepared: ReturnType<typeof preparePr6rLoopbackAttempt>;
  readonly campaign: Awaited<ReturnType<typeof claimPr6rCampaignAuthority>>;
  readonly runtimeAuthority: Pr6rDevelopmentRuntimeAuthority;
  readonly canonicalLedgerAuthority: Pr6rCanonicalLedgerAuthority;
  readonly requestObservedAfterStart: () => boolean;
}

async function readyRunner(input: {
  readonly automaticStopMicrousd?: number;
  readonly databasePath?: string;
  readonly preparedImplementationRevision?: string;
  readonly response?: (
    request: Pr6rCapturedFixtureRequest,
    applicationRequest: CloudApplicationRequestV1,
  ) => Uint8Array;
  } = {}): Promise<ReadyRunner> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime("2026-09-02T00:00:02.500Z");

  let fixture:
    | ReturnType<typeof createPr6rA2ImportedSqliteFixture>
    | undefined;
  let observedAfterStart = false;
  const server = await startPr6rLoopbackFixtureServer({
    maxRequests: 1,
    respond: (captured) => {
      if (fixture === undefined) throw new Error("runner fixture unavailable");
      const state = fixture.store.replay(
        fixture.applicationRequest.synthesisSessionId,
      );
      observedAfterStart =
        state.lastV2EventType === "inference.attempt.started" &&
        state.inferenceAttempts.at(-1)?.attemptId ===
          fixture.applicationRequest.attemptId;
      return {
        body:
          input.response?.(captured, fixture.applicationRequest) ??
          buildCanonicalPr6rLoopbackResponseBody({
            requestId: fixture.applicationRequest.requestId,
            content: canonicalPr6rJsonV1(reviewResult()),
            promptTokens: fixture.applicationRequest.estimatedInputTokens,
            completionTokens: 7,
            cachedTokens: 2,
            reasoningTokens: 3,
          }),
      };
    },
  });
  servers.push(server);
  fixture = createPr6rA2ImportedSqliteFixture({
    origin: server.listenerCapability.origin,
    ...(input.databasePath === undefined
      ? {}
      : { databasePath: input.databasePath }),
    ...(input.automaticStopMicrousd === undefined
      ? {}
      : { automaticStopMicrousd: input.automaticStopMicrousd }),
  });
  databases.push(fixture.database);

  const binding = importedBinding(fixture);
  const nominalImportAuthority = Object.freeze({
    kind: "pr6r_imported_checkpoint" as const,
    childSessionId: binding.childSessionId,
    importId: binding.imported.importId,
  }) satisfies Pr6rImportedCheckpointAuthority;
  checkpointImportTest.assertImported.mockImplementation(
    (
      candidate: Pr6rImportedCheckpointAuthority,
      options: { store: typeof fixture.store; childSessionId: string },
    ) => {
      if (
        candidate !== nominalImportAuthority ||
        options.store !== fixture?.store ||
        options.childSessionId !== binding.childSessionId
      ) {
        throw new Error("runner import authority is forged or transplanted");
      }
      return importedBinding(fixture);
    },
  );

  const providerValidation = buildPr6rLoopbackProviderValidationV1({
    implementationRevision:
      input.preparedImplementationRevision ?? IMPLEMENTATION_REVISION,
    validatedAt: binding.imported.importedAt,
  });
  const pricingSnapshot = buildPr6rSimulationPricingSnapshotV1({
    implementationRevision:
      input.preparedImplementationRevision ?? IMPLEMENTATION_REVISION,
    providerValidationSha256: providerValidation.validationSha256,
    validatedAt: binding.imported.importedAt,
  });
  const prepared = preparePr6rLoopbackAttempt({
    store: fixture.store,
    importedCheckpointAuthority: nominalImportAuthority,
    applicationRequest: fixture.applicationRequest,
    providerValidation,
    pricingSnapshot,
    retainedLocalProvider: {
      providerId: binding.localRoute.providerId,
      model: binding.localRoute.model,
      locality: "local",
      enabled: true,
      capabilities: [...CHANGE_REVIEW_SYNTHESIS_CAPABILITIES],
      accountingKind: "local_zero_cost",
      contextWindowTokens: 100_000,
      maxOutputTokens: 4_096,
      requestReserveTokens: 256,
    },
    retainedLocalHealthSnapshot: {
      snapshotId: "pr6r-a2-runner-local-health",
      providerId: binding.localRoute.providerId,
      model: binding.localRoute.model,
      checkedAt: binding.imported.importedAt,
      expiresAt: new Date(
        Date.parse(binding.imported.importedAt) + PROVIDER_HEALTH_MAX_AGE_MS,
      ).toISOString(),
      status: "healthy",
      resultCode: "configured_model_available",
    },
    asOf: AS_OF,
    cloudEgressAdmissionId: "pr6r-a2-runner-egress",
    decisionId: "pr6r-a2-runner-decision",
    selectedCloudLeaseId: "pr6r-a2-runner-cloud-lease",
    reservationId: fixture.reservationId,
    messageId: "pr6r-a2-runner-message",
  });

  const home = await realpath(
    await mkdtemp(path.join(tmpdir(), "soar-pr6r-a2-runner-")),
  );
  homes.push(home);
  authorityTestOs.homeDirectory = home;
  const campaign = await claimPr6rCampaignAuthority({
    implementationRevision: IMPLEMENTATION_REVISION,
  });
  const runtimeAuthority = createPr6rDevelopmentRuntimeAuthorityForBuild();
  const canonicalLedgerAuthority = bindPr6rCanonicalLedgerAuthorityForRuntime(
    runtimeAuthority,
    fixture.ledger,
  );
  return {
    fixture,
    server,
    prepared,
    campaign,
    runtimeAuthority,
    canonicalLedgerAuthority,
    requestObservedAfterStart: () => observedAfterStart,
  };
}

async function waitForObservedRequests(
  server: Pr6rLoopbackFixtureServer,
  expected: number,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (server.observedRequestCount === expected) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  expect(server.observedRequestCount).toBe(expected);
}

async function openRecoveryProcess(databasePath: string) {
  vi.resetModules();
  const [
    { createSoarDatabase },
    { EventStore },
    { BudgetLedger },
    authority,
    runner,
    runtime,
  ] = await Promise.all([
    import("../../src/main/database"),
    import("../../src/main/event-store"),
    import("../../src/main/budget-ledger"),
    import("../../src/main/pr6r-development/authority-ledger"),
    import("../../src/main/pr6r-development/loopback-attempt-runner"),
    import("../../src/main/pr6r-development/runtime-authority"),
  ]);
  const database = createSoarDatabase(databasePath);
  databases.push(database);
  const store = new EventStore(database);
  const ledger = new BudgetLedger(store);
  const campaignAuthority = await authority.claimPr6rCampaignAuthority({
    implementationRevision: IMPLEMENTATION_REVISION,
  });
  const runtimeAuthority = runtime.createPr6rDevelopmentRuntimeAuthorityForBuild();
  const canonicalLedgerAuthority =
    runtime.bindPr6rCanonicalLedgerAuthorityForRuntime(
      runtimeAuthority,
      ledger,
    );
  return {
    authority,
    runner,
    database,
    store,
    ledger,
    campaignAuthority,
    canonicalLedgerAuthority,
  };
}

async function reopenAndRecover(input: {
  readonly ready: ReadyRunner;
  readonly databasePath: string;
  readonly request: CloudApplicationRequestV1;
  readonly idPrefix: string;
  readonly faultInjector?: (point: Pr6rLoopbackSagaFaultPoint) => void;
}) {
  const originalIndex = databases.indexOf(input.ready.fixture.database);
  if (originalIndex >= 0) databases.splice(originalIndex, 1);
  input.ready.fixture.database.close();

  // Re-import the durable recovery side after clearing all process-local
  // WeakMap capabilities. This simulates a fresh main-process lifetime while
  // preserving only the SQLite and OS ledgers.
  const process = await openRecoveryProcess(input.databasePath);
  const recovered = await process.runner.recoverPr6rLoopbackAttempt({
    campaignAuthority: process.campaignAuthority,
    canonicalLedgerAuthority: process.canonicalLedgerAuthority,
    applicationRequest: input.request,
    reservationId: input.ready.fixture.reservationId,
    ledger: process.ledger,
    nextId: idSource(input.idPrefix),
    now: () => FINISHED_AT,
    ...(input.faultInjector === undefined
      ? {}
      : { faultInjector: input.faultInjector }),
  });
  return {
    recovered,
    reopenedStore: process.store,
    reopenedLedger: process.ledger,
    resumedCampaign: process.campaignAuthority,
    canonicalLedgerAuthority: process.canonicalLedgerAuthority,
    runner: process.runner,
  };
}

describe("PR6R A2 deterministic loopback saga", () => {
  it("persists start before one exact request and reconciles host-priced finish without completing the child", async () => {
    const databaseDirectory = await mkdtemp(
      path.join(tmpdir(), "soar-pr6r-a2-success-db-"),
    );
    homes.push(databaseDirectory);
    const databasePath = path.join(databaseDirectory, "sessions.sqlite");
    const ready = await readyRunner({ databasePath });
    const result = await runPreparedPr6rLoopbackAttempt({
      campaignAuthority: ready.campaign,
      runtimeAuthority: ready.runtimeAuthority,
      canonicalLedgerAuthority: ready.canonicalLedgerAuthority,
      listenerCapability: ready.server.listenerCapability,
      preparedAttempt: ready.prepared,
      ledger: ready.fixture.ledger,
      nextId: idSource("runner-success"),
      now: () => FINISHED_AT,
    });

    expect(result).toMatchObject({
      status: "finished",
      reviewResult: reviewResult(),
      terminalAuthority: {
        status: "cross_store_reconciled",
        terminalOutcome: "completed",
        requestDisposition: "sent",
        stableCode: "completed",
      },
    });
    expect(ready.server.requests).toHaveLength(1);
    expect(ready.server.observedRequestCount).toBe(1);
    expect(ready.requestObservedAfterStart()).toBe(true);
    const state = ready.fixture.store.replay(
      ready.fixture.applicationRequest.synthesisSessionId,
    );
    const expectedCostMicrousd =
      calculatePr6rHostPricedSimulationCostMicrousd({
        inputTokens: ready.fixture.applicationRequest.estimatedInputTokens,
        cacheReadTokens: 2,
        cacheWriteTokens: 0,
        reasoningTokens: 3,
        visibleOutputTokens: 4,
      });
    expect(state.status).toBe("running");
    expect(state.lastV2EventType).toBe("inference.attempt.finished");
    expect(state.inferenceAttempts.at(-1)?.finished).toMatchObject({
      outcome: "succeeded",
      requestDisposition: "sent",
      usage: {
        inputTokens: ready.fixture.applicationRequest.estimatedInputTokens,
        outputTokens: 4,
        reasoningTokens: 3,
        cacheReadTokens: 2,
        reported: true,
      },
      cost: {
        amountMicrousd: expectedCostMicrousd,
        provenance: "host_pricing_snapshot",
        reservationId: ready.fixture.reservationId,
      },
    });
    expect(ready.fixture.ledger.listOutstandingReservations()).toEqual([]);
    expect(
      ready.fixture.ledger.runImmediate((transaction) =>
        transaction.getTerminalEntry(ready.fixture.reservationId),
      ),
    ).toMatchObject({
      rowType: "settlement",
      amountMicrousd: expectedCostMicrousd,
      costProvenance: "host_pricing_snapshot",
      requestDisposition: "sent",
    });
    const persisted = JSON.stringify(
      ready.fixture.store.getEvents(state.id),
    );
    expect(persisted).not.toContain("runner-private-result");
    expect(persisted).not.toContain("choices");
    expect(await inspectPr6rAuthorityLedger()).toMatchObject({
      slots: {
        cloud_synthesis: {
          terminal: {
            terminalOutcome: "completed",
            requestDisposition: "sent",
            stableCode: "completed",
          },
        },
      },
    });
    const rawMarkers = [
      "runner-private-result",
      RAW_REQUEST_ONLY_MARKER,
      ready.fixture.applicationRequest.requestId,
      ready.server.listenerCapability.origin,
    ];
    const persistedFinish = ready.fixture.store
      .getEvents(ready.fixture.applicationRequest.synthesisSessionId)
      .find((event) => event.type === "inference.attempt.finished");
    if (persistedFinish === undefined) {
      throw new Error("runner success did not persist its finish event");
    }
    const safeFinish = projectSafeLocalReviewEventV1(persistedFinish);
    expect(safeFinish).toMatchObject({
      type: "inference.attempt.finished",
      payload: {
        responseBodySha256: persistedFinish.payload.responseBodySha256,
        reviewResultSha256: persistedFinish.payload.reviewResultSha256,
      },
    });
    expectNoRawMarkers(JSON.stringify(safeFinish), rawMarkers);
    await closeAndScanDatabase({
      database: ready.fixture.database,
      databaseDirectory,
      databasePath,
      markers: rawMarkers,
    });
  });

  it("timestamps finish from the host completion observation while retaining monotonic latency", async () => {
    const ready = await readyRunner();
    const completionObservedAt = "2026-09-02T00:00:05.000Z";
    await runPreparedPr6rLoopbackAttempt({
      campaignAuthority: ready.campaign,
      runtimeAuthority: ready.runtimeAuthority,
      canonicalLedgerAuthority: ready.canonicalLedgerAuthority,
      listenerCapability: ready.server.listenerCapability,
      preparedAttempt: ready.prepared,
      ledger: ready.fixture.ledger,
      nextId: idSource("runner-completion-observation"),
      now: () => FINISHED_AT,
      faultInjector: (point) => {
        if (point === "after_transport_result") {
          vi.setSystemTime(completionObservedAt);
        }
      },
    });

    const finishEvent = ready.fixture.store
      .getEvents(ready.fixture.applicationRequest.synthesisSessionId)
      .find((event) => event.type === "inference.attempt.finished");
    expect(finishEvent?.createdAt).toBe(completionObservedAt);
    if (finishEvent?.type !== "inference.attempt.finished") {
      throw new Error("Expected one persisted finish event");
    }
    expect(finishEvent.payload.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Number.isSafeInteger(finishEvent.payload.latencyMs)).toBe(true);
  });

  it("persists only bounded hashes/accounting for a malformed response and leaks no raw transport material", async () => {
    const databaseDirectory = await mkdtemp(
      path.join(tmpdir(), "soar-pr6r-a2-malformed-db-"),
    );
    homes.push(databaseDirectory);
    const databasePath = path.join(databaseDirectory, "sessions.sqlite");
    const malformedMarker = "malformed-private-response-marker-9e312";
    const ready = await readyRunner({
      databasePath,
      response: () =>
        new TextEncoder().encode(`{"${malformedMarker}":`),
    });
    const result = await runPreparedPr6rLoopbackAttempt({
      campaignAuthority: ready.campaign,
      runtimeAuthority: ready.runtimeAuthority,
      canonicalLedgerAuthority: ready.canonicalLedgerAuthority,
      listenerCapability: ready.server.listenerCapability,
      preparedAttempt: ready.prepared,
      ledger: ready.fixture.ledger,
      nextId: idSource("runner-malformed"),
      now: () => FINISHED_AT,
    });

    expect(result).toMatchObject({
      status: "finished",
      terminalAuthority: {
        terminalOutcome: "failed",
        requestDisposition: "sent",
        stableCode: "loopback.response_malformed",
      },
    });
    expect("reviewResult" in result).toBe(false);
    expect(ready.server.observedRequestCount).toBe(1);
    const state = ready.fixture.store.replay(
      ready.fixture.applicationRequest.synthesisSessionId,
    );
    const finish = state.inferenceAttempts.at(-1)?.finished;
    expect(finish).toMatchObject({
      outcome: "protocol_error",
      requestDisposition: "sent",
      errorCode: "loopback.response_malformed",
      usage: { reported: false },
      cost: {
        amountMicrousd:
          result.status === "finished"
            ? result.reservation.amountMicrousd
            : -1,
        provenance: "reserved_unknown",
      },
    });
    expect(finish).toHaveProperty("responseBodySha256");
    expect(finish).not.toHaveProperty("reviewResultSha256");
    expect(
      ready.fixture.ledger.runImmediate((transaction) =>
        transaction.getTerminalEntry(ready.fixture.reservationId),
      ),
    ).toMatchObject({
      rowType: "settlement",
      amountMicrousd:
        result.status === "finished"
          ? result.reservation.amountMicrousd
          : -1,
      costProvenance: "reserved_unknown",
      requestDisposition: "sent",
    });

    const rawMarkers = [
      malformedMarker,
      RAW_REQUEST_ONLY_MARKER,
      ready.fixture.applicationRequest.requestId,
      ready.server.listenerCapability.origin,
    ];
    const persistedFinish = ready.fixture.store
      .getEvents(ready.fixture.applicationRequest.synthesisSessionId)
      .find((event) => event.type === "inference.attempt.finished");
    if (persistedFinish === undefined) {
      throw new Error("runner malformed path did not persist its finish event");
    }
    const safeFinish = projectSafeLocalReviewEventV1(persistedFinish);
    expect(safeFinish).toMatchObject({
      type: "inference.attempt.finished",
      payload: {
        responseBodySha256: persistedFinish.payload.responseBodySha256,
      },
    });
    expect(safeFinish.payload).not.toHaveProperty("reviewResultSha256");
    expectNoRawMarkers(JSON.stringify(safeFinish), rawMarkers);
    await closeAndScanDatabase({
      database: ready.fixture.database,
      databaseDirectory,
      databasePath,
      markers: rawMarkers,
    });
  });

  it("turns pre-reservation cancellation into a reconciled not-sent terminal with zero requests", async () => {
    const ready = await readyRunner();
    const controller = new AbortController();
    controller.abort();
    const result = await runPreparedPr6rLoopbackAttempt({
      campaignAuthority: ready.campaign,
      runtimeAuthority: ready.runtimeAuthority,
      canonicalLedgerAuthority: ready.canonicalLedgerAuthority,
      listenerCapability: ready.server.listenerCapability,
      preparedAttempt: ready.prepared,
      ledger: ready.fixture.ledger,
      signal: controller.signal,
      nextId: idSource("runner-pre-cancel"),
      now: () => FINISHED_AT,
    });

    expect(result).toMatchObject({
      status: "cancelled_before_dispatch",
      terminalAuthority: {
        terminalOutcome: "cancelled",
        requestDisposition: "not_sent",
        stableCode: "loopback.cancelled_before_dispatch",
      },
    });
    expect(ready.server.requests).toEqual([]);
    expect(ready.server.observedRequestCount).toBe(0);
    expect(ready.fixture.ledger.listOutstandingReservations()).toEqual([]);
    expect(
      ready.fixture.store.replay(
        ready.fixture.applicationRequest.synthesisSessionId,
      ),
    ).toMatchObject({ status: "cancelled", inferenceAttempts: [] });
  });

  it("rejects a structurally cloned prepared attempt before claiming the OS slot", async () => {
    const ready = await readyRunner();
    const clonedPrepared = Object.freeze({ ...ready.prepared });

    await expect(
      runPreparedPr6rLoopbackAttempt({
        campaignAuthority: ready.campaign,
        runtimeAuthority: ready.runtimeAuthority,
        canonicalLedgerAuthority: ready.canonicalLedgerAuthority,
        listenerCapability: ready.server.listenerCapability,
        preparedAttempt: clonedPrepared,
        ledger: ready.fixture.ledger,
        nextId: idSource("runner-cloned-prepared"),
        now: () => FINISHED_AT,
      }),
    ).rejects.toThrow(
      "PR6R prepared loopback attempt is forged, stale, or transplanted",
    );

    expect(ready.server.requests).toEqual([]);
    expect(ready.server.observedRequestCount).toBe(0);
    expect(await inspectPr6rAuthorityLedger()).toMatchObject({ slots: {} });
    expect(
      ready.fixture.store.replay(
        ready.fixture.applicationRequest.synthesisSessionId,
      ).lastV2EventType,
    ).toBe("synthesis.checkpoint.imported");
  });

  it("rejects a child mutation after preparation before claiming the OS slot", async () => {
    const ready = await readyRunner();
    ready.fixture.store.append(
      ready.fixture.applicationRequest.synthesisSessionId,
      {
        type: "session.cancelled",
        payload: { reason: "cancelled after runner preparation" },
      },
      {
        expectedSequence: ready.prepared.expectedSequence,
        eventId: "runner-post-prepare-cancellation",
        createdAt: AS_OF,
      },
    );

    await expect(
      runPreparedPr6rLoopbackAttempt({
        campaignAuthority: ready.campaign,
        runtimeAuthority: ready.runtimeAuthority,
        canonicalLedgerAuthority: ready.canonicalLedgerAuthority,
        listenerCapability: ready.server.listenerCapability,
        preparedAttempt: ready.prepared,
        ledger: ready.fixture.ledger,
        nextId: idSource("runner-stale-prepared"),
        now: () => FINISHED_AT,
      }),
    ).rejects.toThrow(
      "PR6R prepared loopback attempt is forged, stale, or transplanted",
    );

    expect(ready.server.observedRequestCount).toBe(0);
    expect(await inspectPr6rAuthorityLedger()).toMatchObject({ slots: {} });
  });

  it("preflights runtime and listener nominality before any OS or SQLite side effect", async () => {
    const ready = await readyRunner();
    const runtimeAuthority = createPr6rDevelopmentRuntimeAuthorityForBuild();
    const canonicalLedgerAuthority = bindPr6rCanonicalLedgerAuthorityForRuntime(
      runtimeAuthority,
      ready.fixture.ledger,
    );
    const secondServer = await startPr6rLoopbackFixtureServer({
      maxRequests: 1,
      respond: () => ({ body: new Uint8Array() }),
    });
    servers.push(secondServer);
    const inputs: readonly {
      label: string;
      runtimeAuthority: Pr6rDevelopmentRuntimeAuthority;
      listenerCapability: Pr6rFixtureListenerCapability;
    }[] = [
      {
        label: "forged runtime",
        runtimeAuthority: {
          ...runtimeAuthority,
        } as Pr6rDevelopmentRuntimeAuthority,
        listenerCapability: ready.server.listenerCapability,
      },
      {
        label: "forged listener",
        runtimeAuthority,
        listenerCapability: {
          ...ready.server.listenerCapability,
        } as Pr6rFixtureListenerCapability,
      },
      {
        label: "mismatched listener origin",
        runtimeAuthority,
        listenerCapability: secondServer.listenerCapability,
      },
    ];

    for (const candidate of inputs) {
      await expect(
        runPreparedPr6rLoopbackAttempt({
          campaignAuthority: ready.campaign,
          runtimeAuthority: candidate.runtimeAuthority,
          canonicalLedgerAuthority,
          listenerCapability: candidate.listenerCapability,
          preparedAttempt: ready.prepared,
          ledger: ready.fixture.ledger,
          nextId: idSource(`runner-preflight-${candidate.label}`),
          now: () => FINISHED_AT,
        }),
        candidate.label,
      ).rejects.toThrow("pr6r_dispatch_preflight_invalid");
    }

    await ready.server.close();
    await expect(
      runPreparedPr6rLoopbackAttempt({
        campaignAuthority: ready.campaign,
        runtimeAuthority,
        canonicalLedgerAuthority,
        listenerCapability: ready.server.listenerCapability,
        preparedAttempt: ready.prepared,
        ledger: ready.fixture.ledger,
        nextId: idSource("runner-preflight-closed-listener"),
        now: () => FINISHED_AT,
      }),
    ).rejects.toThrow("pr6r_dispatch_preflight_invalid");

    expect(ready.server.observedRequestCount).toBe(0);
    expect(secondServer.observedRequestCount).toBe(0);
    expect(await inspectPr6rAuthorityLedger()).toMatchObject({ slots: {} });
    expect(
      ready.fixture.store.replay(
        ready.fixture.applicationRequest.synthesisSessionId,
      ).lastV2EventType,
    ).toBe("synthesis.checkpoint.imported");
  });

  it("revalidates prepared state after an ID callback mutates the child", async () => {
    const ready = await readyRunner();
    let sequence = 0;
    const nextId = (): string => {
      sequence += 1;
      if (sequence === 1) {
        ready.fixture.store.append(
          ready.fixture.applicationRequest.synthesisSessionId,
          {
            type: "session.cancelled",
            payload: { reason: "mutated inside deterministic ID callback" },
          },
          {
            expectedSequence: ready.prepared.expectedSequence,
            eventId: "runner-id-callback-mutation",
            createdAt: AS_OF,
          },
        );
      }
      return `runner-id-callback:${sequence}`;
    };

    await expect(
      runPreparedPr6rLoopbackAttempt({
        campaignAuthority: ready.campaign,
        runtimeAuthority: ready.runtimeAuthority,
        canonicalLedgerAuthority: ready.canonicalLedgerAuthority,
        listenerCapability: ready.server.listenerCapability,
        preparedAttempt: ready.prepared,
        ledger: ready.fixture.ledger,
        nextId,
        now: () => FINISHED_AT,
      }),
    ).rejects.toThrow("forged, stale, or transplanted");

    expect(ready.server.observedRequestCount).toBe(0);
    expect(await inspectPr6rAuthorityLedger()).toMatchObject({ slots: {} });
    expect(
      ready.fixture.store.replay(
        ready.fixture.applicationRequest.synthesisSessionId,
      ),
    ).toMatchObject({ status: "cancelled", inferenceAttempts: [] });
  });

  it("revalidates listener liveness after the clock callback closes it", async () => {
    const ready = await readyRunner();

    await expect(
      runPreparedPr6rLoopbackAttempt({
        campaignAuthority: ready.campaign,
        runtimeAuthority: ready.runtimeAuthority,
        canonicalLedgerAuthority: ready.canonicalLedgerAuthority,
        listenerCapability: ready.server.listenerCapability,
        preparedAttempt: ready.prepared,
        ledger: ready.fixture.ledger,
        nextId: idSource("runner-clock-callback"),
        now: () => {
          void ready.server.close();
          return FINISHED_AT;
        },
      }),
    ).rejects.toThrow("pr6r_dispatch_preflight_invalid");

    expect(ready.server.observedRequestCount).toBe(0);
    expect(await inspectPr6rAuthorityLedger()).toMatchObject({ slots: {} });
    expect(
      ready.fixture.store.replay(
        ready.fixture.applicationRequest.synthesisSessionId,
      ).lastV2EventType,
    ).toBe("synthesis.checkpoint.imported");
  });

  it("rejects a prepared attempt after its health/deadline lease expires", async () => {
    const ready = await readyRunner();
    const expiredAt = "2026-09-02T00:01:02.000Z";
    vi.setSystemTime(expiredAt);

    await expect(
      runPreparedPr6rLoopbackAttempt({
        campaignAuthority: ready.campaign,
        runtimeAuthority: ready.runtimeAuthority,
        canonicalLedgerAuthority: ready.canonicalLedgerAuthority,
        listenerCapability: ready.server.listenerCapability,
        preparedAttempt: ready.prepared,
        ledger: ready.fixture.ledger,
        nextId: idSource("runner-expired-preparation"),
        now: () => expiredAt,
      }),
    ).rejects.toThrow("forged, stale, or transplanted");

    expect(ready.server.observedRequestCount).toBe(0);
    expect(await inspectPr6rAuthorityLedger()).toMatchObject({ slots: {} });
  });

  it.each(["health", "pricing"] as const)(
    "rejects a prepared attempt at the exact %s expiry boundary",
    async (boundary) => {
      const ready = await readyRunner();
      const expiresAt =
        boundary === "health"
          ? ready.prepared.routerInputSnapshot.healthSnapshots.find(
              (snapshot) =>
                snapshot.providerId === ready.prepared.providerId &&
                snapshot.model === ready.prepared.applicationRequest.model,
            )?.expiresAt
          : ready.prepared.routerInputSnapshot.pricingSnapshot?.expiresAt;
      if (expiresAt === undefined) {
        throw new Error(`Prepared attempt lacks its ${boundary} expiry`);
      }
      vi.setSystemTime(expiresAt);

      await expect(
        runPreparedPr6rLoopbackAttempt({
          campaignAuthority: ready.campaign,
          runtimeAuthority: ready.runtimeAuthority,
          canonicalLedgerAuthority: ready.canonicalLedgerAuthority,
          listenerCapability: ready.server.listenerCapability,
          preparedAttempt: ready.prepared,
          ledger: ready.fixture.ledger,
          nextId: idSource(`runner-exact-${boundary}-expiry`),
          now: () => expiresAt,
        }),
      ).rejects.toThrow("forged, stale, or transplanted");

      expect(ready.server.observedRequestCount).toBe(0);
      expect(await inspectPr6rAuthorityLedger()).toMatchObject({ slots: {} });
    },
  );

  it("requires the exact runtime-to-canonical-ledger binding before OS claim", async () => {
    const ready = await readyRunner();
    const otherRuntime = createPr6rDevelopmentRuntimeAuthorityForBuild();

    await expect(
      runPreparedPr6rLoopbackAttempt({
        campaignAuthority: ready.campaign,
        runtimeAuthority: otherRuntime,
        canonicalLedgerAuthority: ready.canonicalLedgerAuthority,
        listenerCapability: ready.server.listenerCapability,
        preparedAttempt: ready.prepared,
        ledger: ready.fixture.ledger,
        nextId: idSource("runner-runtime-ledger-mismatch"),
        now: () => FINISHED_AT,
      }),
    ).rejects.toThrow("pr6r_dispatch_preflight_invalid");

    expect(ready.server.observedRequestCount).toBe(0);
    expect(await inspectPr6rAuthorityLedger()).toMatchObject({ slots: {} });
  });

  it("rejects a prepared implementation revision that differs from the OS campaign", async () => {
    const ready = await readyRunner({
      preparedImplementationRevision: "b".repeat(40),
    });

    await expect(
      runPreparedPr6rLoopbackAttempt({
        campaignAuthority: ready.campaign,
        runtimeAuthority: ready.runtimeAuthority,
        canonicalLedgerAuthority: ready.canonicalLedgerAuthority,
        listenerCapability: ready.server.listenerCapability,
        preparedAttempt: ready.prepared,
        ledger: ready.fixture.ledger,
        nextId: idSource("runner-revision-mismatch"),
        now: () => FINISHED_AT,
      }),
    ).rejects.toThrow("pr6r_dispatch_preflight_invalid");

    expect(ready.server.observedRequestCount).toBe(0);
    expect(await inspectPr6rAuthorityLedger()).toMatchObject({ slots: {} });
  });

  it.each([
    {
      label: "duplicate IDs",
      nextId: () => "runner-duplicate-id",
      now: () => FINISHED_AT,
    },
    {
      label: "invalid IDs",
      nextId: () => "",
      now: () => FINISHED_AT,
    },
    {
      label: "throwing ID source",
      nextId: () => {
        throw new Error("id-source-failed");
      },
      now: () => FINISHED_AT,
    },
    {
      label: "noncanonical clock",
      nextId: idSource("runner-invalid-clock"),
      now: () => "not-a-time",
    },
    {
      label: "backward clock",
      nextId: idSource("runner-backward-clock"),
      now: () => "2026-09-02T00:00:01.999Z",
    },
    {
      label: "future clock",
      nextId: idSource("runner-future-clock"),
      now: () => "2026-09-02T00:00:02.501Z",
    },
    {
      label: "throwing clock",
      nextId: idSource("runner-throwing-clock"),
      now: () => {
        throw new Error("clock-source-failed");
      },
    },
  ])("rejects $label before claiming the OS slot", async ({ nextId, now }) => {
    const ready = await readyRunner();

    await expect(
      runPreparedPr6rLoopbackAttempt({
        campaignAuthority: ready.campaign,
        runtimeAuthority: ready.runtimeAuthority,
        canonicalLedgerAuthority: ready.canonicalLedgerAuthority,
        listenerCapability: ready.server.listenerCapability,
        preparedAttempt: ready.prepared,
        ledger: ready.fixture.ledger,
        nextId,
        now,
      }),
    ).rejects.toThrow("pr6r_runtime_source_invalid");

    expect(ready.server.observedRequestCount).toBe(0);
    expect(await inspectPr6rAuthorityLedger()).toMatchObject({ slots: {} });
    expect(
      ready.fixture.store.replay(
        ready.fixture.applicationRequest.synthesisSessionId,
      ).lastV2EventType,
    ).toBe("synthesis.checkpoint.imported");
  });

  it("keeps budget denial not-sent and never opens a socket", async () => {
    const ready = await readyRunner({ automaticStopMicrousd: 0 });
    const result = await runPreparedPr6rLoopbackAttempt({
      campaignAuthority: ready.campaign,
      runtimeAuthority: ready.runtimeAuthority,
      canonicalLedgerAuthority: ready.canonicalLedgerAuthority,
      listenerCapability: ready.server.listenerCapability,
      preparedAttempt: ready.prepared,
      ledger: ready.fixture.ledger,
      nextId: idSource("runner-denied"),
      now: () => FINISHED_AT,
    });

    expect(result).toMatchObject({
      status: "budget_denied",
      reason: "campaign_automatic_stop",
      terminalAuthority: {
        terminalOutcome: "failed",
        requestDisposition: "not_sent",
        stableCode: "loopback.budget_denied",
      },
    });
    expect(ready.server.requests).toEqual([]);
    expect(ready.server.observedRequestCount).toBe(0);
    expect(ready.fixture.ledger.listOutstandingReservations()).toEqual([]);
    const state = ready.fixture.store.replay(
      ready.fixture.applicationRequest.synthesisSessionId,
    );
    expect(state.status).toBe("running");
    expect(state.routingDecisions.at(-1)?.reasonCode).toBe("budget_denial");
  });

  it("uses the final synchronous cancellation snapshot and charges the full reservation", async () => {
    const ready = await readyRunner();
    const controller = new AbortController();
    const result = await runPreparedPr6rLoopbackAttempt({
      campaignAuthority: ready.campaign,
      runtimeAuthority: ready.runtimeAuthority,
      canonicalLedgerAuthority: ready.canonicalLedgerAuthority,
      listenerCapability: ready.server.listenerCapability,
      preparedAttempt: ready.prepared,
      ledger: ready.fixture.ledger,
      signal: controller.signal,
      nextId: idSource("runner-post-cancel"),
      now: () => FINISHED_AT,
      faultInjector: (point) => {
        if (point === "after_transport_result") controller.abort();
      },
    });

    expect(result).toMatchObject({
      status: "finished",
      terminalAuthority: {
        terminalOutcome: "cancelled",
        requestDisposition: "unknown",
        stableCode: "loopback.cancelled_after_dispatch",
      },
    });
    expect("reviewResult" in result).toBe(false);
    expect(ready.server.requests).toHaveLength(1);
    expect(ready.server.observedRequestCount).toBe(1);
    const state = ready.fixture.store.replay(
      ready.fixture.applicationRequest.synthesisSessionId,
    );
    expect(state.status).toBe("cancelled");
    const finish = state.inferenceAttempts.at(-1)?.finished;
    expect(finish).toMatchObject({
      outcome: "cancelled",
      requestDisposition: "unknown",
      usage: { reported: false },
      cost: {
        provenance: "reserved_unknown",
        amountMicrousd: result.status === "finished"
          ? result.reservation.amountMicrousd
          : -1,
      },
    });
    expect(finish).not.toHaveProperty("responseBodySha256");
    expect(finish).not.toHaveProperty("reviewResultSha256");
  });

  it.each([
    "after_os_slot_claim",
    "after_os_dispatch_arm",
  ] as const)(
    "keeps an OS-only crash at %s blocked after close/reopen with zero redispatch",
    async (faultPoint) => {
      const databaseDirectory = await mkdtemp(
        path.join(tmpdir(), "soar-pr6r-a2-os-only-crash-"),
      );
      homes.push(databaseDirectory);
      const databasePath = path.join(databaseDirectory, "sessions.sqlite");
      const ready = await readyRunner({ databasePath });
      const request = structuredClone(ready.fixture.applicationRequest);

      await expect(
        runPreparedPr6rLoopbackAttempt({
          campaignAuthority: ready.campaign,
          runtimeAuthority: ready.runtimeAuthority,
          canonicalLedgerAuthority: ready.canonicalLedgerAuthority,
          listenerCapability: ready.server.listenerCapability,
          preparedAttempt: ready.prepared,
          ledger: ready.fixture.ledger,
          nextId: idSource(`runner-${faultPoint}`),
          now: () => FINISHED_AT,
          faultInjector: (point) => {
            if (point === faultPoint) throw new Error("simulated-process-crash");
          },
        }),
      ).rejects.toThrow("simulated-process-crash");
      expect(ready.server.observedRequestCount).toBe(0);

      const reopened = await reopenAndRecover({
        ready,
        databasePath,
        request,
        idPrefix: `recover-${faultPoint}`,
      });
      expect(reopened.recovered).toEqual({
        status: "blocked",
        reason: "sqlite_evidence_missing_or_conflicting",
      });
      expect(ready.server.observedRequestCount).toBe(0);
      expect(
        reopened.reopenedStore.replay(request.synthesisSessionId).lastV2EventType,
      ).toBe("synthesis.checkpoint.imported");
    },
  );

  it.each([
    {
      mode: "cancelled" as const,
      faultPoint: "after_sqlite_cancellation_commit" as const,
      terminalOutcome: "cancelled",
      requestDisposition: "not_sent",
      stableCode: "loopback.cancelled_before_dispatch",
    },
    {
      mode: "cancelled" as const,
      faultPoint: "after_os_terminal" as const,
      terminalOutcome: "cancelled",
      requestDisposition: "not_sent",
      stableCode: "loopback.cancelled_before_dispatch",
    },
    {
      mode: "denied" as const,
      faultPoint: "after_sqlite_start_commit" as const,
      terminalOutcome: "failed",
      requestDisposition: "not_sent",
      stableCode: "loopback.budget_denied",
    },
    {
      mode: "denied" as const,
      faultPoint: "after_os_terminal" as const,
      terminalOutcome: "failed",
      requestDisposition: "not_sent",
      stableCode: "loopback.budget_denied",
    },
  ])(
    "reconciles $mode crash at $faultPoint without dispatch",
    async ({
      mode,
      faultPoint,
      terminalOutcome,
      requestDisposition,
      stableCode,
    }) => {
      const databaseDirectory = await mkdtemp(
        path.join(tmpdir(), "soar-pr6r-a2-pre-dispatch-crash-"),
      );
      homes.push(databaseDirectory);
      const databasePath = path.join(databaseDirectory, "sessions.sqlite");
      const ready = await readyRunner({
        databasePath,
        ...(mode === "denied" ? { automaticStopMicrousd: 0 } : {}),
      });
      const request = structuredClone(ready.fixture.applicationRequest);
      const controller = new AbortController();
      if (mode === "cancelled") controller.abort();

      await expect(
        runPreparedPr6rLoopbackAttempt({
          campaignAuthority: ready.campaign,
          runtimeAuthority: ready.runtimeAuthority,
          canonicalLedgerAuthority: ready.canonicalLedgerAuthority,
          listenerCapability: ready.server.listenerCapability,
          preparedAttempt: ready.prepared,
          ledger: ready.fixture.ledger,
          ...(mode === "cancelled" ? { signal: controller.signal } : {}),
          nextId: idSource(`runner-${mode}-${faultPoint}`),
          now: () => FINISHED_AT,
          faultInjector: (point) => {
            if (point === faultPoint) throw new Error("simulated-process-crash");
          },
        }),
      ).rejects.toThrow("simulated-process-crash");
      expect(ready.server.observedRequestCount).toBe(0);

      const reopened = await reopenAndRecover({
        ready,
        databasePath,
        request,
        idPrefix: `recover-${mode}-${faultPoint}`,
      });
      expect(reopened.recovered).toMatchObject({
        status: "reconciled",
        recoveredOpenAttempt: false,
        terminalAuthority: {
          terminalOutcome,
          requestDisposition,
          stableCode,
        },
      });
      expect(ready.server.observedRequestCount).toBe(0);
      expect(reopened.reopenedLedger.listOutstandingReservations()).toEqual([]);
    },
  );

  it.each([
    {
      faultPoint: "after_transport_started" as const,
      recoveredOpenAttempt: true,
      terminalOutcome: "failed",
      requestDisposition: "unknown",
      stableCode: "loopback.recovery_required",
    },
    {
      faultPoint: "after_transport_result" as const,
      recoveredOpenAttempt: true,
      terminalOutcome: "failed",
      requestDisposition: "unknown",
      stableCode: "loopback.recovery_required",
    },
    {
      faultPoint: "after_sqlite_finish_commit" as const,
      recoveredOpenAttempt: false,
      terminalOutcome: "completed",
      requestDisposition: "sent",
      stableCode: "completed",
    },
    {
      faultPoint: "after_os_terminal" as const,
      recoveredOpenAttempt: false,
      terminalOutcome: "completed",
      requestDisposition: "sent",
      stableCode: "completed",
    },
  ])(
    "recovers a sent crash at $faultPoint with exactly one observed request",
    async ({
      faultPoint,
      recoveredOpenAttempt,
      terminalOutcome,
      requestDisposition,
      stableCode,
    }) => {
      const databaseDirectory = await mkdtemp(
        path.join(tmpdir(), "soar-pr6r-a2-sent-crash-"),
      );
      homes.push(databaseDirectory);
      const databasePath = path.join(databaseDirectory, "sessions.sqlite");
      const ready = await readyRunner({ databasePath });
      const request = structuredClone(ready.fixture.applicationRequest);

      await expect(
        runPreparedPr6rLoopbackAttempt({
          campaignAuthority: ready.campaign,
          runtimeAuthority: ready.runtimeAuthority,
          canonicalLedgerAuthority: ready.canonicalLedgerAuthority,
          listenerCapability: ready.server.listenerCapability,
          preparedAttempt: ready.prepared,
          ledger: ready.fixture.ledger,
          nextId: idSource(`runner-${faultPoint}`),
          now: () => FINISHED_AT,
          faultInjector: (point) => {
            if (point === faultPoint) throw new Error("simulated-process-crash");
          },
        }),
      ).rejects.toThrow("simulated-process-crash");
      await waitForObservedRequests(ready.server, 1);

      const reopened = await reopenAndRecover({
        ready,
        databasePath,
        request,
        idPrefix: `recover-${faultPoint}`,
      });
      expect(reopened.recovered).toMatchObject({
        status: "reconciled",
        recoveredOpenAttempt,
        terminalAuthority: {
          terminalOutcome,
          requestDisposition,
          stableCode,
        },
      });
      expect(ready.server.observedRequestCount).toBe(1);
      expect(reopened.reopenedLedger.listOutstandingReservations()).toEqual([]);
    },
  );

  it.each([
    "after_sqlite_finish_commit",
    "after_os_terminal",
  ] as const)(
    "recovers post-dispatch cancellation crash at %s without redispatch",
    async (faultPoint) => {
      const databaseDirectory = await mkdtemp(
        path.join(tmpdir(), "soar-pr6r-a2-cancelled-crash-"),
      );
      homes.push(databaseDirectory);
      const databasePath = path.join(databaseDirectory, "sessions.sqlite");
      const ready = await readyRunner({ databasePath });
      const request = structuredClone(ready.fixture.applicationRequest);
      const controller = new AbortController();

      await expect(
        runPreparedPr6rLoopbackAttempt({
          campaignAuthority: ready.campaign,
          runtimeAuthority: ready.runtimeAuthority,
          canonicalLedgerAuthority: ready.canonicalLedgerAuthority,
          listenerCapability: ready.server.listenerCapability,
          preparedAttempt: ready.prepared,
          ledger: ready.fixture.ledger,
          signal: controller.signal,
          nextId: idSource(`runner-cancelled-${faultPoint}`),
          now: () => FINISHED_AT,
          faultInjector: (point) => {
            if (point === "after_transport_result") controller.abort();
            if (point === faultPoint) throw new Error("simulated-process-crash");
          },
        }),
      ).rejects.toThrow("simulated-process-crash");
      await waitForObservedRequests(ready.server, 1);
      const terminalBeforeRestart = ready.fixture.ledger.runImmediate(
        (transaction) =>
          transaction.getTerminalEntry(ready.fixture.reservationId),
      );
      expect(terminalBeforeRestart).toMatchObject({
        rowType: "settlement",
        costProvenance: "reserved_unknown",
        requestDisposition: "unknown",
      });

      const reopened = await reopenAndRecover({
        ready,
        databasePath,
        request,
        idPrefix: `recover-cancelled-${faultPoint}`,
      });
      expect(reopened.recovered).toMatchObject({
        status: "reconciled",
        recoveredOpenAttempt: false,
        terminalAuthority: {
          terminalOutcome: "cancelled",
          requestDisposition: "unknown",
          stableCode: "loopback.cancelled_after_dispatch",
        },
      });
      expect(ready.server.observedRequestCount).toBe(1);
      expect(reopened.reopenedLedger.listOutstandingReservations()).toEqual([]);
      expect(
        reopened.reopenedLedger.runImmediate((transaction) =>
          transaction.getTerminalEntry(ready.fixture.reservationId),
        ),
      ).toEqual(terminalBeforeRestart);
      const state = reopened.reopenedStore.replay(request.synthesisSessionId);
      expect(state.status).toBe("cancelled");
      expect(state.inferenceAttempts.at(-1)?.finished).toMatchObject({
        outcome: "cancelled",
        requestDisposition: "unknown",
        cost: {
          provenance: "reserved_unknown",
          amountMicrousd: terminalBeforeRestart?.amountMicrousd,
        },
      });
    },
  );

  it("closes and reopens an admitted crash as unknown/full-reservation without redispatch", async () => {
    const databaseDirectory = await mkdtemp(
      path.join(tmpdir(), "soar-pr6r-a2-runner-db-"),
    );
    homes.push(databaseDirectory);
    const databasePath = path.join(databaseDirectory, "sessions.sqlite");
    const ready = await readyRunner({ databasePath });
    const request = structuredClone(ready.fixture.applicationRequest);

    await expect(
      runPreparedPr6rLoopbackAttempt({
        campaignAuthority: ready.campaign,
        runtimeAuthority: ready.runtimeAuthority,
        canonicalLedgerAuthority: ready.canonicalLedgerAuthority,
        listenerCapability: ready.server.listenerCapability,
        preparedAttempt: ready.prepared,
        ledger: ready.fixture.ledger,
        nextId: idSource("runner-crash"),
        now: () => FINISHED_AT,
        faultInjector: (point) => {
          if (point === "after_sqlite_start_commit") {
            throw new Error("simulated-process-crash");
          }
        },
      }),
    ).rejects.toThrow("simulated-process-crash");
    expect(ready.server.requests).toEqual([]);
    expect(ready.server.observedRequestCount).toBe(0);
    const reservedMicrousd =
      ready.fixture.ledger.listOutstandingReservations()[0]?.amountMicrousd;
    expect(reservedMicrousd).toBeGreaterThan(0);

    const originalIndex = databases.indexOf(ready.fixture.database);
    if (originalIndex >= 0) databases.splice(originalIndex, 1);
    ready.fixture.database.close();

    const firstRecoveryProcess = await openRecoveryProcess(databasePath);
    await expect(
      firstRecoveryProcess.runner.recoverPr6rLoopbackAttempt({
        campaignAuthority: firstRecoveryProcess.campaignAuthority,
        canonicalLedgerAuthority:
          firstRecoveryProcess.canonicalLedgerAuthority,
        applicationRequest: request,
        reservationId: ready.fixture.reservationId,
        ledger: firstRecoveryProcess.ledger,
        nextId: idSource("runner-recovery-sqlite-crash"),
        now: () => FINISHED_AT,
        faultInjector: (point) => {
          if (point === "after_sqlite_recovery_commit") {
            throw new Error("simulated-recovery-crash");
          }
        },
      }),
    ).rejects.toThrow("simulated-recovery-crash");
    expect(ready.server.requests).toEqual([]);
    expect(ready.server.observedRequestCount).toBe(0);
    expect(firstRecoveryProcess.ledger.listOutstandingReservations()).toEqual([]);
    const recoveredState = firstRecoveryProcess.store.replay(
      request.synthesisSessionId,
    );
    expect(recoveredState.status).toBe("interrupted");
    expect(recoveredState.inferenceAttempts.at(-1)?.finished).toMatchObject({
      outcome: "interrupted",
      requestDisposition: "unknown",
      errorCode: "loopback.recovery_required",
      usage: { reported: false },
      cost: { provenance: "reserved_unknown" },
    });
    const terminalRows = firstRecoveryProcess.database
      .prepare<
        [string],
        { amount_microusd: number | bigint; cost_provenance: string }
      >(
        `SELECT amount_microusd, cost_provenance
           FROM budget_ledger_entries
          WHERE reservation_id = ?
            AND row_type IN ('settlement', 'release', 'overrun')`,
      )
      .safeIntegers(true)
      .all(ready.fixture.reservationId);
    expect(terminalRows).toEqual([
      {
        amount_microusd: BigInt(reservedMicrousd ?? -1),
        cost_provenance: "reserved_unknown",
      },
    ]);

    const firstIndex = databases.indexOf(firstRecoveryProcess.database);
    if (firstIndex >= 0) databases.splice(firstIndex, 1);
    firstRecoveryProcess.database.close();

    // A second fresh process publishes the already-durable SQLite terminal.
    // The injected post-publication crash then proves a third process observes
    // that OS write idempotently rather than publishing or dispatching again.
    const secondRecoveryProcess = await openRecoveryProcess(databasePath);
    await expect(
      secondRecoveryProcess.runner.recoverPr6rLoopbackAttempt({
        campaignAuthority: secondRecoveryProcess.campaignAuthority,
        canonicalLedgerAuthority:
          secondRecoveryProcess.canonicalLedgerAuthority,
        applicationRequest: request,
        reservationId: ready.fixture.reservationId,
        ledger: secondRecoveryProcess.ledger,
        nextId: idSource("runner-recovery-os-crash"),
        now: () => FINISHED_AT,
        faultInjector: (point) => {
          if (point === "after_os_terminal") {
            throw new Error("simulated-recovery-crash");
          }
        },
      }),
    ).rejects.toThrow("simulated-recovery-crash");
    expect(await secondRecoveryProcess.authority.inspectPr6rAuthorityLedger())
      .toMatchObject({
        slots: {
          cloud_synthesis: {
            terminal: {
              terminalOutcome: "failed",
              requestDisposition: "unknown",
              stableCode: "loopback.recovery_required",
            },
          },
        },
      });
    const secondIndex = databases.indexOf(secondRecoveryProcess.database);
    if (secondIndex >= 0) databases.splice(secondIndex, 1);
    secondRecoveryProcess.database.close();

    const thirdRecoveryProcess = await openRecoveryProcess(databasePath);
    const idempotent = await thirdRecoveryProcess.runner.recoverPr6rLoopbackAttempt({
      campaignAuthority: thirdRecoveryProcess.campaignAuthority,
      canonicalLedgerAuthority: thirdRecoveryProcess.canonicalLedgerAuthority,
      applicationRequest: request,
      reservationId: ready.fixture.reservationId,
      ledger: thirdRecoveryProcess.ledger,
      nextId: idSource("runner-recovery-replay"),
      now: () => FINISHED_AT,
    });
    expect(idempotent).toMatchObject({
      status: "reconciled",
      recoveredOpenAttempt: false,
      terminalAuthority: {
        terminalOutcome: "failed",
        requestDisposition: "unknown",
        stableCode: "loopback.recovery_required",
      },
    });
    expect(ready.server.requests).toEqual([]);
    expect(ready.server.observedRequestCount).toBe(0);
  });
});
