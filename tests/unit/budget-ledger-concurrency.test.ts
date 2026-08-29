import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

import { afterEach, describe, expect, it } from "vitest";

import {
  BUDGET_CACHE_ASSUMPTION,
  BudgetLedger,
  type BudgetReservationResolution,
  type ReserveBudgetInput,
} from "../../src/main/budget-ledger";
import {
  createSoarDatabase,
  type SoarDatabase,
} from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";

const temporaryDirectories: string[] = [];
const databases: SoarDatabase[] = [];
const workers: Worker[] = [];

function createSession(store: EventStore, sessionId: string): void {
  store.createSession({
    id: sessionId,
    title: "Concurrent budget test",
    objective: "Prove serialized campaign admission.",
    workspaceRoot: "/tmp/workspace",
    executionPolicy: {
      schemaVersion: "agentic-execution-v2",
      inferenceRounds: 2,
      toolCalls: 1,
      routingPolicy: "hybrid_v0",
      maxProviderChanges: 2,
      maxPaidAttempts: 1,
      maxPaidEpisodeMicrousd: 250,
      maxEpisodeDurationMs: 60_000,
      attemptTimeoutMs: 30_000,
      egressConsent: "session_cloud_synthesis_v1",
    },
    createdAt: "2026-08-29T02:00:00.000Z",
  });
}

function reservationInput(
  sessionId: string,
  reservationId: string,
): ReserveBudgetInput {
  return {
    campaignId: "concurrent-campaign",
    reservationId,
    sessionId,
    attemptId: `${sessionId}:attempt:1`,
    providerId: "fake-cloud",
    pricingSnapshotId: "pricing-1",
    episodeCapMicrousd: 250,
    projection: {
      billableInputTokens: 100,
      billableCacheReadTokens: 0,
      requestedMaxOutputTokens: 100,
      inputMicrousdPerMillionTokens: 1_000_000,
      outputMicrousdPerMillionTokens: 1_000_000,
      providerFeeCeilingMicrousd: 50,
      cacheAssumption: BUDGET_CACHE_ASSUMPTION,
    },
    createdAt: "2026-08-29T02:00:01.000Z",
  };
}

interface WorkerResultMessage {
  type: "result";
  resolution: BudgetReservationResolution;
}

function startReservationWorker(
  databasePath: string,
  startSignal: SharedArrayBuffer,
  input: ReserveBudgetInput,
): {
  ready: Promise<void>;
  result: Promise<BudgetReservationResolution>;
  exited: Promise<void>;
  worker: Worker;
} {
  const worker = new Worker(
    new URL("../fixtures/budget-reservation-worker.ts", import.meta.url),
    {
      execArgv: ["--import", "tsx"],
      workerData: { databasePath, startSignal, input },
    },
  );
  workers.push(worker);

  let markReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let resolveResult!: (resolution: BudgetReservationResolution) => void;
  let rejectResult!: (error: Error) => void;
  let markExited!: () => void;
  let rejectExited!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    rejectReady = reject;
  });
  const result = new Promise<BudgetReservationResolution>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const exited = new Promise<void>((resolve, reject) => {
    markExited = resolve;
    rejectExited = reject;
  });
  // A worker can fail before its first message. Attach handlers to every
  // deferred promise immediately so one root failure cannot become an
  // unrelated unhandled-rejection warning while the test awaits another.
  void ready.catch(() => undefined);
  void result.catch(() => undefined);
  void exited.catch(() => undefined);

  let failureReported = false;
  let sawReady = false;
  let sawTerminalMessage = false;
  const reportFailure = (error: Error): void => {
    if (failureReported) return;
    failureReported = true;
    rejectReady(error);
    rejectResult(error);
    rejectExited(error);
  };
  worker.once("error", reportFailure);
  worker.once("exit", (code) => {
    if (failureReported) return;
    if (code !== 0) {
      reportFailure(new Error(`budget worker exited ${code}`));
    } else if (!sawReady) {
      reportFailure(new Error("budget worker exited before becoming ready"));
    } else if (!sawTerminalMessage) {
      reportFailure(new Error("budget worker exited before a terminal result"));
    } else {
      markExited();
    }
  });
  worker.on("message", (message: unknown) => {
    if (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      message.type === "ready"
    ) {
      sawReady = true;
      markReady();
      return;
    }
    if (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      message.type === "result"
    ) {
      sawTerminalMessage = true;
      resolveResult((message as WorkerResultMessage).resolution);
      return;
    }
    const detail =
      typeof message === "object" &&
      message !== null &&
      "message" in message
        ? String(message.message)
        : "unknown worker failure";
    sawTerminalMessage = true;
    reportFailure(new Error(detail));
  });
  return { ready, result, exited, worker };
}

afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.terminate()));
  for (const database of databases.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("BudgetLedger concurrent admission", () => {
  it("serializes simultaneous reservations so only one can consume the exact campaign cap", async () => {
    const directory = mkdtempSync(join(tmpdir(), "soar-budget-concurrency-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "soar.sqlite");
    const database = createSoarDatabase(databasePath);
    databases.push(database);
    const store = new EventStore(database);
    createSession(store, "concurrent-session-1");
    createSession(store, "concurrent-session-2");
    const ledger = new BudgetLedger(store);
    ledger.createCampaign({
      id: "concurrent-campaign",
      providerId: "fake-cloud",
      credentialMetadataId: "credential-1",
      openingExposureMicrousd: 0,
      automaticStopMicrousd: 250,
      hardCeilingMicrousd: 500,
      createdAt: "2026-08-29T02:00:00.000Z",
    });

    const startSignal = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const first = startReservationWorker(
      databasePath,
      startSignal,
      reservationInput("concurrent-session-1", "concurrent-reservation-1"),
    );
    const second = startReservationWorker(
      databasePath,
      startSignal,
      reservationInput("concurrent-session-2", "concurrent-reservation-2"),
    );
    await Promise.all([first.ready, second.ready]);
    Atomics.store(new Int32Array(startSignal), 0, 1);
    Atomics.notify(new Int32Array(startSignal), 0, 2);

    const resolutions = await Promise.all([first.result, second.result]);
    await Promise.all([first.exited, second.exited]);

    expect(resolutions.map((resolution) => resolution.status).sort()).toEqual([
      "admitted",
      "denied",
    ]);
    expect(
      resolutions.find((resolution) => resolution.status === "denied"),
    ).toMatchObject({
      status: "denied",
      reason: "campaign_automatic_stop",
      billing: { remainingCampaignMicrousd: 0 },
    });
    expect(ledger.listOutstandingReservations()).toHaveLength(1);
    expect(
      ledger.getBudgetPosition({
        campaignId: "concurrent-campaign",
        sessionId: "concurrent-session-1",
      }),
    ).toMatchObject({ campaignExposureMicrousd: 250 });
  }, 15_000);
});
