import { afterEach, describe, expect, it } from "vitest";

import {
  BUDGET_CACHE_ASSUMPTION,
  BudgetLedger,
  type BudgetLedgerTransaction,
  projectWorstCaseCostMicrousd,
  type BudgetProjectionInput,
} from "../../src/main/budget-ledger";
import {
  createSoarDatabase,
  type SoarDatabase,
} from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";

const databases: SoarDatabase[] = [];

const CREATED_AT = "2026-08-29T01:00:00.000Z";
const DEFAULT_PROJECTION: BudgetProjectionInput = {
  billableInputTokens: 100,
  billableCacheReadTokens: 0,
  requestedMaxOutputTokens: 100,
  inputMicrousdPerMillionTokens: 1_000_000,
  outputMicrousdPerMillionTokens: 1_000_000,
  providerFeeCeilingMicrousd: 50,
  cacheAssumption: BUDGET_CACHE_ASSUMPTION,
};

function fixture(options: {
  sessionId?: string;
  episodeCapMicrousd?: number;
  automaticStopMicrousd?: number;
  hardCeilingMicrousd?: number;
  openingExposureMicrousd?: number;
} = {}) {
  const database = createSoarDatabase();
  databases.push(database);
  const store = new EventStore(database);
  const sessionId = options.sessionId ?? "budget-session";
  store.createSession({
    id: sessionId,
    title: "Budget test",
    objective: "Exercise operational budget accounting.",
    workspaceRoot: "/tmp/workspace",
    executionPolicy: {
      schemaVersion: "agentic-execution-v2",
      inferenceRounds: 4,
      toolCalls: 2,
      routingPolicy: "hybrid_v0",
      maxProviderChanges: 2,
      maxPaidAttempts: 1,
      maxPaidEpisodeMicrousd: options.episodeCapMicrousd ?? 250,
      maxEpisodeDurationMs: 120_000,
      attemptTimeoutMs: 30_000,
      egressConsent: "session_cloud_synthesis_v1",
    },
    createdAt: "2026-08-29T00:59:58.000Z",
  });
  const ledger = new BudgetLedger(store);
  ledger.createCampaign({
    id: "campaign-1",
    providerId: "fake-cloud",
    credentialMetadataId: "fake-credential-metadata",
    openingExposureMicrousd: options.openingExposureMicrousd ?? 0,
    automaticStopMicrousd: options.automaticStopMicrousd ?? 90_000_000,
    hardCeilingMicrousd: options.hardCeilingMicrousd ?? 100_000_000,
    createdAt: CREATED_AT,
  });
  return { database, store, ledger, sessionId };
}

function reserve(
  ledger: BudgetLedger,
  options: {
    sessionId?: string;
    reservationId?: string;
    attemptId?: string;
    episodeCapMicrousd?: number;
    projection?: BudgetProjectionInput;
  } = {},
) {
  return ledger.runImmediate((transaction) =>
    transaction.reserve({
      campaignId: "campaign-1",
      reservationId: options.reservationId ?? "reservation-1",
      sessionId: options.sessionId ?? "budget-session",
      attemptId: options.attemptId ?? "attempt-1",
      providerId: "fake-cloud",
      pricingSnapshotId: "pricing-1",
      episodeCapMicrousd: options.episodeCapMicrousd ?? 250,
      projection: options.projection ?? DEFAULT_PROJECTION,
      createdAt: "2026-08-29T01:00:01.000Z",
    }),
  );
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("BudgetLedger", () => {
  it("rejects async transaction callbacks and invalidates leaked handles", () => {
    const { ledger } = fixture();
    let leaked: BudgetLedgerTransaction | undefined;
    const unsafeRun = ledger.runImmediate.bind(ledger) as unknown as (
      operation: (transaction: BudgetLedgerTransaction) => unknown,
    ) => unknown;

    expect(() =>
      unsafeRun(async (transaction) => {
        leaked = transaction;
        transaction.reserve({
          campaignId: "campaign-1",
          reservationId: "rolled-back-reservation",
          sessionId: "budget-session",
          attemptId: "rolled-back-attempt",
          providerId: "fake-cloud",
          pricingSnapshotId: "pricing-1",
          episodeCapMicrousd: 250,
          projection: DEFAULT_PROJECTION,
          createdAt: "2026-08-29T01:00:01.000Z",
        });
      }),
    ).toThrow(/synchronous callback/);
    expect(ledger.listOutstandingReservations()).toEqual([]);
    expect(() => leaked?.requireCampaign("campaign-1")).toThrow(
      /active SQLite transaction/,
    );
    expect(() =>
      ledger.runImmediate(() => leaked?.requireCampaign("campaign-1")),
    ).toThrow(/active SQLite transaction/);
  });

  it("fails reconciliation on a standalone orphan reservation", () => {
    const { ledger } = fixture();
    expect(reserve(ledger)).toMatchObject({ status: "admitted" });

    expect(() => ledger.assertEventReconciled()).toThrow(
      /reservation-1: ledger reservation has no canonical attempt/,
    );
  });

  it("uses exact BigInt component rounding and rejects unsafe projections", () => {
    expect(
      projectWorstCaseCostMicrousd({
        billableInputTokens: 1,
        billableCacheReadTokens: 1,
        requestedMaxOutputTokens: 1,
        inputMicrousdPerMillionTokens: 1,
        outputMicrousdPerMillionTokens: 1,
        cacheReadMicrousdPerMillionTokens: 1,
        providerFeeCeilingMicrousd: 1,
        cacheAssumption: BUDGET_CACHE_ASSUMPTION,
      }),
    ).toBe(4);
    expect(() =>
      projectWorstCaseCostMicrousd({
        ...DEFAULT_PROJECTION,
        billableInputTokens: 1,
        requestedMaxOutputTokens: 1,
        inputMicrousdPerMillionTokens: 1,
        outputMicrousdPerMillionTokens: 1,
        providerFeeCeilingMicrousd: Number.MAX_SAFE_INTEGER,
      }),
    ).toThrow(/safe-integer range/);
    expect(() =>
      projectWorstCaseCostMicrousd({
        ...DEFAULT_PROJECTION,
        billableCacheReadTokens: 1,
      }),
    ).toThrow(/cache-read rate/);
    expect(() =>
      projectWorstCaseCostMicrousd({
        ...DEFAULT_PROJECTION,
        cacheReadMicrousdPerMillionTokens:
          DEFAULT_PROJECTION.inputMicrousdPerMillionTokens + 1,
      }),
    ).toThrow(/no_cache_credit/);
  });

  it("admits the exact episode cap and denies one micro-USD over", () => {
    const exact = fixture({ episodeCapMicrousd: 250 });
    expect(reserve(exact.ledger)).toMatchObject({
      status: "admitted",
      billing: {
        projectedCostMicrousd: 250,
        remainingEpisodeMicrousd: 250,
      },
    });

    const over = fixture({
      sessionId: "over-cap-session",
      episodeCapMicrousd: 249,
    });
    expect(
      reserve(over.ledger, {
        sessionId: "over-cap-session",
        episodeCapMicrousd: 249,
      }),
    ).toMatchObject({
      status: "denied",
      reason: "episode_cap",
      billing: {
        projectedCostMicrousd: 250,
        remainingEpisodeMicrousd: 249,
      },
    });
    expect(over.ledger.listOutstandingReservations()).toEqual([]);
  });

  it("enforces the campaign automatic stop at the exact micro-USD boundary", () => {
    const exact = fixture({
      episodeCapMicrousd: 250,
      automaticStopMicrousd: 250,
      hardCeilingMicrousd: 500,
    });
    expect(reserve(exact.ledger)).toMatchObject({ status: "admitted" });

    const over = fixture({
      sessionId: "campaign-over-session",
      episodeCapMicrousd: 251,
      automaticStopMicrousd: 250,
      hardCeilingMicrousd: 500,
    });
    expect(
      reserve(over.ledger, {
        sessionId: "campaign-over-session",
        episodeCapMicrousd: 251,
        projection: {
          ...DEFAULT_PROJECTION,
          providerFeeCeilingMicrousd: 51,
        },
      }),
    ).toMatchObject({
      status: "denied",
      reason: "campaign_automatic_stop",
      billing: { projectedCostMicrousd: 251, remainingCampaignMicrousd: 250 },
    });
  });

  it("distinguishes the provider hard ceiling from the lower automatic stop", () => {
    const over = fixture({
      episodeCapMicrousd: 501,
      automaticStopMicrousd: 500,
      hardCeilingMicrousd: 500,
    });
    expect(
      reserve(over.ledger, {
        episodeCapMicrousd: 501,
        projection: {
          ...DEFAULT_PROJECTION,
          providerFeeCeilingMicrousd: 301,
        },
      }),
    ).toMatchObject({
      status: "denied",
      reason: "campaign_hard_ceiling",
      billing: { projectedCostMicrousd: 501 },
    });
  });

  it("keeps reservation and terminal rows immutable and reconciles exposure", () => {
    const { database, ledger } = fixture();
    const admitted = reserve(ledger);
    expect(admitted.status).toBe("admitted");
    expect(ledger.listOutstandingReservations()).toHaveLength(1);

    const settlement = ledger.runImmediate((transaction) =>
      transaction.resolve({
        terminalEntryId: "settlement-1",
        reservationId: "reservation-1",
        rowType: "settlement",
        amountMicrousd: 180,
        costProvenance: "provider_reported",
        requestDisposition: "sent",
        createdAt: "2026-08-29T01:00:02.000Z",
      }),
    );
    expect(settlement).toMatchObject({ rowType: "settlement", amountMicrousd: 180 });
    expect(ledger.listOutstandingReservations()).toEqual([]);
    expect(
      ledger.getBudgetPosition({
        campaignId: "campaign-1",
        sessionId: "budget-session",
      }),
    ).toMatchObject({
      episodeExposureMicrousd: 180,
      campaignExposureMicrousd: 180,
    });

    expect(() =>
      database
        .prepare("UPDATE budget_ledger_entries SET amount_microusd = 1 WHERE id = ?")
        .run("reservation-1"),
    ).toThrow(/append-only/);
    expect(() =>
      database
        .prepare("DELETE FROM budget_ledger_entries WHERE id = ?")
        .run("settlement-1"),
    ).toThrow(/append-only/);
    expect(() =>
      ledger.runImmediate((transaction) =>
        transaction.resolve({
          terminalEntryId: "settlement-duplicate",
          reservationId: "reservation-1",
          rowType: "settlement",
          amountMicrousd: 180,
          costProvenance: "provider_reported",
          requestDisposition: "sent",
          createdAt: "2026-08-29T01:00:03.000Z",
        }),
      ),
    ).toThrow(/already resolved/);
  });

  it("records a full overrun and permanently disables later campaign admission", () => {
    const { store, ledger } = fixture({ episodeCapMicrousd: 1_000 });
    expect(
      reserve(ledger, { episodeCapMicrousd: 1_000 }),
    ).toMatchObject({ status: "admitted" });
    ledger.runImmediate((transaction) =>
      transaction.resolve({
        terminalEntryId: "overrun-1",
        reservationId: "reservation-1",
        rowType: "overrun",
        amountMicrousd: 251,
        costProvenance: "provider_reported",
        requestDisposition: "sent",
        reasonCode: "budget_overrun",
        createdAt: "2026-08-29T01:00:02.000Z",
      }),
    );
    store.createSession({
      id: "second-session",
      title: "Second budget test",
      objective: "Prove overrun shutdown.",
      workspaceRoot: "/tmp/workspace",
      executionPolicy: {
        schemaVersion: "agentic-execution-v2",
        inferenceRounds: 4,
        toolCalls: 2,
        routingPolicy: "hybrid_v0",
        maxProviderChanges: 2,
        maxPaidAttempts: 1,
        maxPaidEpisodeMicrousd: 1_000,
        maxEpisodeDurationMs: 120_000,
        attemptTimeoutMs: 30_000,
        egressConsent: "session_cloud_synthesis_v1",
      },
    });
    expect(
      reserve(ledger, {
        sessionId: "second-session",
        reservationId: "reservation-2",
        attemptId: "attempt-2",
        episodeCapMicrousd: 1_000,
      }),
    ).toMatchObject({ status: "denied", reason: "campaign_overrun" });
    expect(
      ledger.getBudgetPosition({
        campaignId: "campaign-1",
        sessionId: "second-session",
      }),
    ).toMatchObject({ campaignDisabled: true, campaignExposureMicrousd: 251 });
  });

  it("releases only definitely-unsent reservations and charges unknown cost in full", () => {
    const released = fixture();
    reserve(released.ledger);
    expect(
      released.ledger.runImmediate((transaction) =>
        transaction.resolve({
          terminalEntryId: "release-1",
          reservationId: "reservation-1",
          rowType: "release",
          amountMicrousd: 0,
          requestDisposition: "not_sent",
          reasonCode: "pre_dispatch_failure",
          createdAt: "2026-08-29T01:00:02.000Z",
        }),
      ),
    ).toMatchObject({ rowType: "release", amountMicrousd: 0 });
    expect(
      released.ledger.getBudgetPosition({
        campaignId: "campaign-1",
        sessionId: "budget-session",
      }),
    ).toMatchObject({ episodeExposureMicrousd: 0 });

    const unknown = fixture();
    reserve(unknown.ledger);
    expect(() =>
      unknown.ledger.runImmediate((transaction) =>
        transaction.resolve({
          terminalEntryId: "partial-unknown",
          reservationId: "reservation-1",
          rowType: "settlement",
          amountMicrousd: 249,
          costProvenance: "reserved_unknown",
          requestDisposition: "unknown",
          createdAt: "2026-08-29T01:00:02.000Z",
        }),
      ),
    ).toThrow(/full reservation/);
    expect(
      unknown.ledger.runImmediate((transaction) =>
        transaction.resolve({
          terminalEntryId: "full-unknown",
          reservationId: "reservation-1",
          rowType: "settlement",
          amountMicrousd: 250,
          costProvenance: "reserved_unknown",
          requestDisposition: "unknown",
          createdAt: "2026-08-29T01:00:03.000Z",
        }),
      ),
    ).toMatchObject({ amountMicrousd: 250, costProvenance: "reserved_unknown" });
  });
});
