import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type FakeOnlyHybridRuntimeV0,
} from "../../src/main/agent/run-session-v2";
import { SessionRunner } from "../../src/main/agent/run-session";
import { AttemptUnitOfWork } from "../../src/main/attempt-unit-of-work";
import { BudgetLedger } from "../../src/main/budget-ledger";
import {
  createSoarDatabase,
  type SoarDatabase,
} from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";
import { ProviderRegistry } from "../../src/main/providers/provider-registry";
import type { ProviderDescriptor } from "../../src/main/providers/provider-descriptor";
import {
  ProviderAbortedError,
  type DescribedInferenceProvider,
  type ProviderResult,
  type ProviderToolCall,
} from "../../src/main/providers/types";
import { providerMessagesSha256 } from "../../src/shared/context-compiler";
import {
  REVIEW_RISK_POLICY_ID,
  REVIEW_RISK_THRESHOLD,
  scoreCompleteReviewRiskFactsV1,
  type ReviewRiskFactsV1,
  type ReviewRiskResultV1,
} from "../../src/shared/review-risk";
import {
  ScriptedProvider,
  cloudScriptedDescriptor,
  localScriptedDescriptor,
} from "../helpers/scripted-provider";

const databases: SoarDatabase[] = [];
const temporaryDirectories: string[] = [];

const NOW = "2026-08-29T12:00:00.000Z";
const LOCAL_ID = "fake-local";
const CLOUD_ID = "fake-cloud";
const CAMPAIGN_ID = "fake-campaign";
const CREDENTIAL_ID = "fake-credential-metadata";

function usage(inputTokens = 100, outputTokens = 20) {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    reasoningTokens: 0,
  };
}

function toolCall(
  id: string,
  name: "list_files" | "read_text_file",
  arguments_: object,
): ProviderToolCall {
  return {
    id,
    type: "function",
    function: { name, arguments: JSON.stringify(arguments_) },
  };
}

function toolResult(model: string, call: ProviderToolCall): ProviderResult {
  return {
    content: "",
    toolCalls: [call],
    finishReason: "tool_calls",
    servedModel: model,
    usage: usage(80, 8),
    durationMs: 5,
    timeToFirstTokenMs: 1,
  };
}

function finalResult(model: string, content: string): ProviderResult {
  return {
    content,
    toolCalls: [],
    finishReason: "stop",
    servedModel: model,
    usage: usage(),
    durationMs: 8,
    timeToFirstTokenMs: 2,
  };
}

function highRisk(): ReviewRiskResultV1 {
  const facts: ReviewRiskFactsV1 = {
    changedPathCount: 1,
    changedLineCount: 20,
    surfaces: ["main"],
    sensitivePaths: ["src/main/agent/run-session.ts"],
    runtimePaths: ["src/main/agent/run-session.ts"],
    relevantTestPaths: [],
  };
  const scored = scoreCompleteReviewRiskFactsV1(facts);
  expect(scored.classification).toBe("high_risk");
  return {
    schemaVersion: "review-risk-result-v1",
    policyId: REVIEW_RISK_POLICY_ID,
    snapshotId: "1".repeat(64),
    complete: true,
    threshold: REVIEW_RISK_THRESHOLD,
    score: scored.score,
    classification: scored.classification,
    signals: scored.signals,
    facts,
    incompleteReasons: [],
  };
}

function healthFixtures(
  cloudStatus: "healthy" | "unhealthy" = "healthy",
): FakeOnlyHybridRuntimeV0["healthSnapshots"] {
  return [
    {
      snapshotId: "health-cloud",
      providerId: CLOUD_ID,
      model: "fake-cloud-model",
      checkedAt: "2026-08-29T11:59:30.000Z",
      expiresAt: "2026-08-29T12:00:30.000Z",
      status: cloudStatus,
      resultCode: cloudStatus === "healthy" ? "fake_healthy" : "fake_unhealthy",
    },
    {
      snapshotId: "health-local",
      providerId: LOCAL_ID,
      model: "fake-local-model",
      checkedAt: "2026-08-29T11:59:30.000Z",
      expiresAt: "2026-08-29T12:00:30.000Z",
      status: "healthy",
      resultCode: "fake_healthy",
    },
  ];
}

function unavailablePricing(): FakeOnlyHybridRuntimeV0["pricingSnapshot"] {
  return {
    snapshotId: "pricing-cloud-unavailable",
    providerId: CLOUD_ID,
    model: "fake-cloud-model",
    verifiedAt: "2026-08-29T00:00:00.000Z",
    expiresAt: "2026-08-30T00:00:00.000Z",
    status: "unavailable",
    inputMicrousdPerMillionTokens: 1_000,
    outputMicrousdPerMillionTokens: 2_000,
    cacheReadMicrousdPerMillionTokens: 0,
    pricingSourceSha256: "3".repeat(64),
  };
}

interface FixtureOptions {
  cloudStep: ConstructorParameters<typeof ScriptedProvider>[1][number];
  initialStep?: ConstructorParameters<typeof ScriptedProvider>[1][number];
  initialToolCall?: ProviderToolCall;
  secondToolCall?: ProviderToolCall;
  localFinal?: string;
  localFinalFailure?: string;
  episodeCapMicrousd?: number;
  attemptTimeoutMs?: number;
  cancelAfterCloudFailure?: boolean;
  cancelAfterEvidence?: boolean;
  onPersisted?: () => void;
  cacheReadRateMicrousd?: number;
  cloudEstimatedReserveTokens?: number;
  cloudDescriptorOverrides?: Partial<ProviderDescriptor>;
  runtimeOverrides?: Partial<FakeOnlyHybridRuntimeV0>;
}

function fixture(options: FixtureOptions) {
  const database = createSoarDatabase();
  databases.push(database);
  const store = new EventStore(database);
  const workspaceRoot = mkdtempSync(join(tmpdir(), "soar-v2-runner-"));
  temporaryDirectories.push(workspaceRoot);
  writeFileSync(join(workspaceRoot, "README.md"), "# Fake repository\n", "utf8");

  const localDescriptor = localScriptedDescriptor({ maxOutputTokens: 512 });
  const cloudDescriptor = cloudScriptedDescriptor({
    maxOutputTokens: 768,
    ...options.cloudDescriptorOverrides,
  });
  const localFinal = options.localFinal;
  const localSteps: ConstructorParameters<typeof ScriptedProvider>[1] = [
    options.initialStep ??
      (() =>
        toolResult(
          localDescriptor.model,
          options.initialToolCall ??
            toolCall("list-root", "list_files", {
              relativePath: ".",
              recursive: false,
            }),
        )),
    () =>
      toolResult(
        localDescriptor.model,
        options.secondToolCall ??
          toolCall("read-readme", "read_text_file", {
            relativePath: "README.md",
          }),
      ),
    ...(localFinal === undefined
      ? options.localFinalFailure === undefined
        ? []
        : [() => {
            throw new Error(options.localFinalFailure);
          }]
      : [() => finalResult(localDescriptor.model, localFinal)]),
  ];
  const local = new ScriptedProvider(localDescriptor, localSteps);
  const cloud = new ScriptedProvider(
    cloudDescriptor,
    [options.cloudStep],
    options.cloudEstimatedReserveTokens,
  );
  const providerRegistry = new ProviderRegistry([
    { descriptor: localDescriptor, provider: local },
    { descriptor: cloudDescriptor, provider: cloud },
  ]);

  const sessionId = "fake-hybrid-session";
  store.createSession({
    id: sessionId,
    title: "Fake hybrid proof",
    objective: "Inspect the repository and synthesize the result.",
    workspaceRoot,
    completionObligations: {
      requiredSuccessfulTools: ["list_files", "read_text_file"],
      minimumVerifiedPathLineCitations: 0,
    },
    executionPolicy: {
      schemaVersion: "agentic-execution-v2",
      inferenceRounds: 4,
      toolCalls: 2,
      routingPolicy: "hybrid_v0",
      maxProviderChanges: 2,
      maxPaidAttempts: 1,
      maxPaidEpisodeMicrousd: options.episodeCapMicrousd ?? 250_000,
      maxEpisodeDurationMs: 120_000,
      attemptTimeoutMs: options.attemptTimeoutMs ?? 30_000,
      egressConsent: "session_cloud_synthesis_v1",
    },
    createdAt: "2026-08-29T11:59:00.000Z",
  });
  const ledger = new BudgetLedger(store);
  ledger.createCampaign({
    id: CAMPAIGN_ID,
    providerId: CLOUD_ID,
    credentialMetadataId: CREDENTIAL_ID,
    openingExposureMicrousd: 0,
    automaticStopMicrousd: 90_000_000,
    hardCeilingMicrousd: 100_000_000,
    createdAt: "2026-08-29T11:59:30.000Z",
  });

  let id = 0;
  const runtime: FakeOnlyHybridRuntimeV0 = {
    kind: "fake-only-hybrid-runtime-v0",
    fakeProviderIds: [CLOUD_ID, LOCAL_ID],
    cloudProviderId: CLOUD_ID,
    campaignId: CAMPAIGN_ID,
    credentialMetadataId: CREDENTIAL_ID,
    credentialAvailable: true,
    healthSnapshots: [
      {
        snapshotId: "health-cloud",
        providerId: CLOUD_ID,
        model: cloudDescriptor.model,
        checkedAt: "2026-08-29T11:59:30.000Z",
        expiresAt: "2026-08-29T12:00:30.000Z",
        status: "healthy",
        resultCode: "fake_healthy",
      },
      {
        snapshotId: "health-local",
        providerId: LOCAL_ID,
        model: localDescriptor.model,
        checkedAt: "2026-08-29T11:59:30.000Z",
        expiresAt: "2026-08-29T12:00:30.000Z",
        status: "healthy",
        resultCode: "fake_healthy",
      },
    ],
    pricingSnapshot: {
      snapshotId: "pricing-cloud",
      providerId: CLOUD_ID,
      model: cloudDescriptor.model,
      verifiedAt: "2026-08-29T00:00:00.000Z",
      expiresAt: "2026-08-30T00:00:00.000Z",
      status: "available",
      inputMicrousdPerMillionTokens: 1_000,
      outputMicrousdPerMillionTokens: 2_000,
      cacheReadMicrousdPerMillionTokens:
        options.cacheReadRateMicrousd ?? 0,
      pricingSourceSha256: "2".repeat(64),
    },
    reviewRisk: highRisk(),
    egressAllowed: true,
    clock: () => new Date(NOW),
    idFactory: () => `fake-id-${++id}`,
    ...options.runtimeOverrides,
  };
  let runner: SessionRunner;
  runner = new SessionRunner({
    store,
    providerRegistry,
    defaultLocalProviderId: LOCAL_ID,
    limits: { inferenceRounds: 4, toolCalls: 2 },
    context: { maxInputTokens: 16_384, safetyMargin: 0.1 },
    hybridRuntime: runtime,
    ...(options.cancelAfterCloudFailure ||
    options.cancelAfterEvidence ||
    options.onPersisted !== undefined
      ? {
          onUpdate: () => {
            options.onPersisted?.();
            const state = store.getProjectedState(sessionId);
            const latest = state.inferenceAttempts.at(-1);
            if (
              options.cancelAfterCloudFailure &&
              latest?.providerId === CLOUD_ID &&
              latest.finished !== undefined &&
              latest.finished.outcome !== "succeeded" &&
              latest.finished.outcome !== "cancelled"
            ) {
              runner.cancelSession(sessionId);
              return;
            }
            const successfulToolResults = state.messages.reduce(
              (count, message) =>
                count +
                (message.toolCalls ?? []).filter(
                  (tool) => tool.status === "completed",
                ).length,
              0,
            );
            if (
              options.cancelAfterEvidence &&
              successfulToolResults >= 2 &&
              state.inferenceAttempts.every(
                (attempt) => attempt.finished !== undefined,
              )
            ) {
              runner.cancelSession(sessionId);
            }
          },
        }
      : {}),
  });
  return {
    database,
    store,
    ledger,
    local,
    cloud,
    providerRegistry,
    runner,
    runtime,
    sessionId,
  };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("fake-only agentic-execution-v2 runner", () => {
  it("retains the local investigation lease, atomically admits cloud synthesis, and dispatches the exact packet", async () => {
    let dispatchObservedReservation = false;
    const context = fixture({
      cloudStep: () => {
        const state = context.store.getProjectedState(context.sessionId);
        dispatchObservedReservation =
          state.inferenceAttempts.at(-1)?.budgetReservationId !== undefined &&
          context.ledger.listOutstandingReservations({
            sessionId: context.sessionId,
          }).length === 1;
        return finalResult("fake-cloud-model", "Cloud synthesis complete.");
      },
    });

    await context.runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    const events = context.store.getEvents(context.sessionId);
    expect(state.status, state.error ?? "").toBe("completed");
    expect(state.result).toBe("Cloud synthesis complete.");
    expect(dispatchObservedReservation).toBe(true);
    expect(context.local.inputs).toHaveLength(2);
    expect(context.cloud.inputs).toHaveLength(1);
    expect(context.cloud.inputs[0]).toMatchObject({
      requestedMaxOutputTokens: 768,
      allowTools: false,
      requireToolCall: false,
    });
    expect(context.cloud.inputs[0]).not.toHaveProperty("allowedToolNames");
    expect(state.routingDecisions.map((decision) => decision.reasonCode)).toEqual([
      "local_investigation",
      "cloud_admitted",
    ]);
    expect(state.routes.map((route) => route.providerId)).toEqual([
      LOCAL_ID,
      CLOUD_ID,
    ]);
    expect(state.inferenceAttempts).toHaveLength(3);
    expect(state.inferenceAttempts[0]?.leaseId).toBe(
      state.inferenceAttempts[1]?.leaseId,
    );
    expect(state.inferenceAttempts[0]?.decisionId).toBe(
      state.inferenceAttempts[1]?.decisionId,
    );
    expect(state.inferenceAttempts[2]?.leaseId).not.toBe(
      state.inferenceAttempts[1]?.leaseId,
    );
    const cloudCheckpoint = state.contextCompilations[2]!;
    const cloudDecision = state.routingDecisions[1]!;
    expect(providerMessagesSha256(context.cloud.inputs[0]!.messages)).toBe(
      cloudCheckpoint.messagesSha256,
    );
    expect(cloudDecision.messagesSha256).toBe(cloudCheckpoint.messagesSha256);
    expect(cloudDecision.packetSha256).toBe(cloudCheckpoint.packetSha256);
    expect(context.cloud.inputs[0]?.requestedMaxOutputTokens).toBe(
      state.inferenceAttempts[2]?.requestedMaxOutputTokens,
    );
    expect(events.filter((event) => event.type === "usage.recorded")).toEqual([]);
    expect(context.ledger.listOutstandingReservations({
      sessionId: context.sessionId,
    })).toEqual([]);
  });

  it("freezes health observations before the atomic budget callback", async () => {
    const healthReads = new Map<string, number>();
    const context = fixture({
      cloudStep: () =>
        finalResult("fake-cloud-model", "Cloud synthesis with frozen health."),
      runtimeOverrides: {
        healthSnapshotProvider: (providerId, asOf) => {
          healthReads.set(providerId, (healthReads.get(providerId) ?? 0) + 1);
          const asOfMs = Date.parse(asOf);
          return {
            snapshotId: `health-${providerId}-${healthReads.get(providerId)}`,
            providerId,
            model:
              providerId === CLOUD_ID
                ? "fake-cloud-model"
                : "fake-local-model",
            checkedAt: new Date(asOfMs - 30_000).toISOString(),
            expiresAt: new Date(asOfMs + 30_000).toISOString(),
            status: "healthy",
            resultCode: "fake_healthy",
          };
        },
      },
    });

    await context.runner.startSession(context.sessionId);

    expect(context.store.getProjectedState(context.sessionId).status).toBe(
      "completed",
    );
    expect(healthReads.get(LOCAL_ID)).toBe(2);
    expect(healthReads.get(CLOUD_ID)).toBe(1);
    expect(context.cloud.inputs).toHaveLength(1);
  });

  it("uses the dispatched cloud adapter's larger input reserve for compilation and budget admission", async () => {
    const context = fixture({
      cloudStep: () =>
        finalResult("fake-cloud-model", "Cloud synthesis with adapter reserve."),
      cloudEstimatedReserveTokens: 777,
    });

    await context.runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    const checkpoint = state.contextCompilations[2]!;
    const decision = state.routingDecisions[1]!;
    expect(state.status).toBe("completed");
    expect(checkpoint.reservedInputTokens).toBe(777);
    expect(decision.billing?.billableInputTokens).toBe(
      checkpoint.estimatedTokens + checkpoint.reservedInputTokens,
    );
    expect(context.cloud.inputs).toHaveLength(1);
  });

  it("narrows initial tool authority to the next required evidence step", async () => {
    const context = fixture({
      cloudStep: () => finalResult("fake-cloud-model", "must not dispatch"),
      initialToolCall: toolCall("read-first", "read_text_file", {
        relativePath: "README.md",
      }),
    });

    await context.runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    const toolCalls = state.messages.reduce(
      (count, message) => count + (message.toolCalls?.length ?? 0),
      0,
    );
    expect(state.status).toBe("failed");
    expect(state.error).toMatch(/did not return exactly one permitted tool call/u);
    expect(context.local.inputs[0]?.allowedToolNames).toEqual(["list_files"]);
    expect(toolCalls).toBe(0);
    expect(context.local.inputs).toHaveLength(1);
    expect(context.cloud.inputs).toHaveLength(0);
    expect(context.ledger.listOutstandingReservations({
      sessionId: context.sessionId,
    })).toEqual([]);
  });

  it("rejects an adapter reserve below the persisted descriptor minimum before paid admission", async () => {
    const context = fixture({
      cloudStep: () => finalResult("fake-cloud-model", "must not dispatch"),
      cloudEstimatedReserveTokens: 0,
    });

    await context.runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    const reservationRows = context.database
      .prepare(
        `SELECT COUNT(*) AS count FROM budget_ledger_entries
         WHERE row_type = 'reservation' AND session_id = ?`,
      )
      .get(context.sessionId) as { count: number };
    expect(state.status).toBe("failed");
    expect(state.error).toMatch(/no smaller than its persisted descriptor reserve/u);
    expect(context.local.inputs).toHaveLength(2);
    expect(context.cloud.inputs).toHaveLength(0);
    expect(reservationRows.count).toBe(0);
  });

  it("accounts for one cloud failure and performs exactly one local fallback", async () => {
    const context = fixture({
      cloudStep: () => {
        throw new Error("scripted cloud failure");
      },
      localFinal: "Local fallback complete.",
    });

    await context.runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    expect(state.status).toBe("completed");
    expect(state.result).toBe("Local fallback complete.");
    expect(context.cloud.inputs).toHaveLength(1);
    expect(context.local.inputs).toHaveLength(3);
    expect(state.routingDecisions.map((decision) => decision.boundary)).toEqual([
      "session_start",
      "evidence_complete",
      "provider_failure",
    ]);
    expect(state.routingDecisions.at(-1)?.reasonCode).toBe("local_fallback");
    expect(state.inferenceAttempts.map((attempt) => attempt.finished?.outcome)).toEqual([
      "succeeded",
      "succeeded",
      "provider_error",
      "succeeded",
    ]);
    expect(context.ledger.listOutstandingReservations({
      sessionId: context.sessionId,
    })).toEqual([]);
  });

  it("terminalizes a failed local fallback after closing every attempt", async () => {
    const context = fixture({
      cloudStep: () => {
        throw new Error("scripted cloud failure");
      },
      localFinalFailure: "scripted local fallback failure",
    });

    await context.runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    expect(state.status).toBe("failed");
    expect(state.error).toMatch(/scripted local fallback failure/u);
    expect(context.cloud.inputs).toHaveLength(1);
    expect(context.local.inputs).toHaveLength(3);
    expect(state.inferenceAttempts).toHaveLength(4);
    expect(state.inferenceAttempts.every(
      (attempt) => attempt.finished !== undefined,
    )).toBe(true);
    expect(context.ledger.listOutstandingReservations({
      sessionId: context.sessionId,
    })).toEqual([]);
  });

  it("times out one cloud attempt, settles it, and performs one local fallback", async () => {
    const context = fixture({
      cloudStep: (input) =>
        new Promise<ProviderResult>((_resolve, reject) => {
          const rejectTimedOut = () =>
            reject(new ProviderAbortedError("Inference timed out", "", "timeout"));
          if (input.signal.aborted) rejectTimedOut();
          else input.signal.addEventListener("abort", rejectTimedOut, { once: true });
        }),
      localFinal: "Local fallback after timeout.",
      attemptTimeoutMs: 10,
    });

    await context.runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    expect(state.status).toBe("completed");
    expect(state.result).toBe("Local fallback after timeout.");
    expect(context.cloud.inputs).toHaveLength(1);
    expect(context.local.inputs).toHaveLength(3);
    expect(state.inferenceAttempts[2]?.finished).toMatchObject({
      outcome: "timeout",
      requestDisposition: "unknown",
      errorCode: "attempt_timeout",
    });
    expect(state.routingDecisions.at(-1)?.reasonCode).toBe("local_fallback");
    expect(context.ledger.listOutstandingReservations({
      sessionId: context.sessionId,
    })).toEqual([]);
  });

  it("treats an adapter-mapped cancelled abort as a coordinator timeout", async () => {
    const context = fixture({
      cloudStep: (input) =>
        new Promise<ProviderResult>((_resolve, reject) => {
          const rejectCancelled = () =>
            reject(
              new ProviderAbortedError(
                "Adapter mapped the combined abort signal to cancellation",
                "",
                "cancelled",
              ),
            );
          if (input.signal.aborted) rejectCancelled();
          else input.signal.addEventListener("abort", rejectCancelled, { once: true });
        }),
      localFinal: "Local fallback after adapter-mapped timeout.",
      attemptTimeoutMs: 10,
    });

    await context.runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    expect(state.status).toBe("completed");
    expect(state.result).toBe("Local fallback after adapter-mapped timeout.");
    expect(state.inferenceAttempts[2]?.finished).toMatchObject({
      outcome: "timeout",
      requestDisposition: "unknown",
      errorCode: "attempt_timeout",
    });
    expect(state.routingDecisions.at(-1)?.reasonCode).toBe("local_fallback");
    expect(context.cloud.inputs).toHaveLength(1);
    expect(context.local.inputs).toHaveLength(3);
    expect(context.ledger.listOutstandingReservations({
      sessionId: context.sessionId,
    })).toEqual([]);
  });

  it("settles and falls back when a cloud provider ignores abort and never resolves", async () => {
    const context = fixture({
      cloudStep: () => new Promise<ProviderResult>(() => undefined),
      localFinal: "Local fallback after non-cooperative timeout.",
      attemptTimeoutMs: 10,
    });
    const startedAt = performance.now();

    await context.runner.startSession(context.sessionId);

    const elapsedMs = performance.now() - startedAt;
    const state = context.store.getProjectedState(context.sessionId);
    expect(elapsedMs).toBeLessThan(1_000);
    expect(state.status).toBe("completed");
    expect(state.result).toBe("Local fallback after non-cooperative timeout.");
    expect(state.inferenceAttempts[2]?.finished).toMatchObject({
      outcome: "timeout",
      requestDisposition: "unknown",
      errorCode: "attempt_timeout",
    });
    expect(context.cloud.inputs).toHaveLength(1);
    expect(context.local.inputs).toHaveLength(3);
    expect(context.ledger.listOutstandingReservations({
      sessionId: context.sessionId,
    })).toEqual([]);
  });

  it("does not reroute when cancellation arrives after the failed cloud finish", async () => {
    const context = fixture({
      cloudStep: () => {
        throw new Error("scripted cloud failure before cancellation boundary");
      },
      localFinal: "must not dispatch",
      cancelAfterCloudFailure: true,
    });

    await context.runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    expect(state.status).toBe("cancelled");
    expect(context.cloud.inputs).toHaveLength(1);
    expect(context.local.inputs).toHaveLength(2);
    expect(state.routingDecisions.map((decision) => decision.boundary)).toEqual([
      "session_start",
      "evidence_complete",
    ]);
    expect(context.ledger.listOutstandingReservations({
      sessionId: context.sessionId,
    })).toEqual([]);
  });

  it("does not route after cancellation at the evidence-complete boundary", async () => {
    const context = fixture({
      cloudStep: () => finalResult("fake-cloud-model", "must not dispatch"),
      cancelAfterEvidence: true,
    });

    await context.runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    const reservationRows = context.database
      .prepare(
        `SELECT COUNT(*) AS count FROM budget_ledger_entries
         WHERE row_type = 'reservation' AND session_id = ?`,
      )
      .get(context.sessionId) as { count: number };
    expect(state.status).toBe("cancelled");
    expect(context.local.inputs).toHaveLength(2);
    expect(context.cloud.inputs).toHaveLength(0);
    expect(state.routingDecisions.map((decision) => decision.boundary)).toEqual([
      "session_start",
    ]);
    expect(reservationRows.count).toBe(0);
  });

  it("closes and accounts for malformed post-response billing before local fallback", async () => {
    const context = fixture({
      cloudStep: () => ({
        ...finalResult("fake-cloud-model", "unsafe accounting"),
        costUsd: Number.MAX_VALUE,
      }),
      localFinal: "Recovered after unsafe cloud accounting.",
    });

    await context.runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    const cloudAttempt = state.inferenceAttempts[2]!;
    expect(state.status).toBe("completed");
    expect(state.result).toBe("Recovered after unsafe cloud accounting.");
    expect(cloudAttempt.finished).toMatchObject({
      outcome: "protocol_error",
      requestDisposition: "unknown",
      errorCode: "post_response_normalization",
      cost: {
        provenance: "reserved_unknown",
        reservationId: cloudAttempt.budgetReservationId,
      },
    });
    expect(context.cloud.inputs).toHaveLength(1);
    expect(context.local.inputs).toHaveLength(3);
    expect(state.inferenceAttempts.every((attempt) => attempt.finished !== undefined)).toBe(
      true,
    );
    expect(context.ledger.listOutstandingReservations({
      sessionId: context.sessionId,
    })).toEqual([]);
  });

  it("rejects incoherent provider usage and conservatively consumes the reservation", async () => {
    const context = fixture({
      cloudStep: () => ({
        ...finalResult("fake-cloud-model", "malformed usage"),
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          totalTokens: 10_000,
        },
      }),
      localFinal: "Recovered after malformed cloud usage.",
    });

    await context.runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    const cloudAttempt = state.inferenceAttempts[2]!;
    expect(state.status).toBe("completed");
    expect(state.result).toBe("Recovered after malformed cloud usage.");
    expect(cloudAttempt.finished).toMatchObject({
      outcome: "protocol_error",
      requestDisposition: "unknown",
      errorCode: "post_response_normalization",
      usage: { reported: false },
      cost: {
        amountMicrousd: state.routingDecisions[1]?.billing?.projectedCostMicrousd,
        provenance: "reserved_unknown",
        reservationId: cloudAttempt.budgetReservationId,
      },
    });
    expect(context.cloud.inputs).toHaveLength(1);
    expect(context.local.inputs).toHaveLength(3);
    expect(context.ledger.listOutstandingReservations({
      sessionId: context.sessionId,
    })).toEqual([]);
  });

  it("uses reserved-unknown when cache pricing is nonzero but cache usage is absent", async () => {
    const context = fixture({
      cloudStep: () =>
        finalResult("fake-cloud-model", "Cloud synthesis without cache detail."),
      cacheReadRateMicrousd: 500,
    });

    await context.runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    const cloudAttempt = state.inferenceAttempts[2]!;
    const cloudDecision = state.routingDecisions[1]!;
    expect(state.status).toBe("completed");
    expect(cloudAttempt.finished?.cost).toEqual({
      amountMicrousd: cloudDecision.billing?.projectedCostMicrousd,
      provenance: "reserved_unknown",
      reservationId: cloudAttempt.budgetReservationId,
    });
    expect(state.inferenceAttempts.every(
      (attempt) => attempt.finished !== undefined,
    )).toBe(true);
    expect(context.ledger.listOutstandingReservations({
      sessionId: context.sessionId,
    })).toEqual([]);
  });

  it("settles host-priced usage from the locked billing snapshot after runtime price mutation", async () => {
    const context = fixture({
      cloudStep: () => {
        context.runtime.pricingSnapshot = {
          ...context.runtime.pricingSnapshot,
          inputMicrousdPerMillionTokens: 900_000,
          outputMicrousdPerMillionTokens: 900_000,
        };
        return finalResult("fake-cloud-model", "Locked-price synthesis.");
      },
    });

    await context.runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    const cloudAttempt = state.inferenceAttempts[2]!;
    expect(state.status).toBe("completed");
    expect(cloudAttempt.finished?.cost).toMatchObject({
      amountMicrousd: 2,
      provenance: "host_pricing_snapshot",
      reservationId: cloudAttempt.budgetReservationId,
    });
    expect(context.ledger.listOutstandingReservations({
      sessionId: context.sessionId,
    })).toEqual([]);
  });

  it("closes a local attempt when the injected clock and ID source fail after dispatch", async () => {
    const context = fixture({
      cloudStep: () => finalResult("fake-cloud-model", "must not dispatch"),
      initialStep: () => {
        context.runtime.clock = () => new Date(Number.NaN);
        context.runtime.idFactory = () => "";
        return toolResult(
          "fake-local-model",
          toolCall("list-root", "list_files", {
            relativePath: ".",
            recursive: false,
          }),
        );
      },
    });

    await context.runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    expect(state.status).toBe("failed");
    expect(context.local.inputs).toHaveLength(1);
    expect(context.cloud.inputs).toHaveLength(0);
    expect(state.inferenceAttempts).toHaveLength(1);
    expect(state.inferenceAttempts[0]?.finished).toBeDefined();
    expect(state.inferenceAttempts.every(
      (attempt) => attempt.finished !== undefined,
    )).toBe(true);
    expect(context.ledger.listOutstandingReservations({
      sessionId: context.sessionId,
    })).toEqual([]);
  });

  it("settles a paid attempt when the injected clock and ID source fail after dispatch", async () => {
    const context = fixture({
      cloudStep: () => {
        context.runtime.clock = () => new Date(Number.NaN);
        context.runtime.idFactory = () => "";
        return finalResult("fake-cloud-model", "Paid finish fallback complete.");
      },
    });

    await context.runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    expect(state.status).toBe("completed");
    expect(state.result).toBe("Paid finish fallback complete.");
    expect(state.inferenceAttempts[2]?.finished).toBeDefined();
    expect(state.inferenceAttempts.every(
      (attempt) => attempt.finished !== undefined,
    )).toBe(true);
    expect(context.cloud.inputs).toHaveLength(1);
    expect(context.ledger.listOutstandingReservations({
      sessionId: context.sessionId,
    })).toEqual([]);
  });

  it("rounds a positive fractional micro-USD provider cost upward", async () => {
    const context = fixture({
      cloudStep: () => ({
        ...finalResult("fake-cloud-model", "Fractional-cost synthesis."),
        costUsd: 0.000_000_1,
      }),
    });

    await context.runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    expect(state.status).toBe("completed");
    expect(state.inferenceAttempts[2]?.finished?.cost).toMatchObject({
      amountMicrousd: 1,
      provenance: "provider_reported",
    });
    expect(context.ledger.listOutstandingReservations({
      sessionId: context.sessionId,
    })).toEqual([]);
  });

  it("cancels an admitted cloud call without routing to fallback", async () => {
    const context = fixture({
      cloudStep: (input) =>
        new Promise<ProviderResult>((_resolve, reject) => {
          const rejectCancelled = () =>
            reject(new ProviderAbortedError("Inference cancelled", "", "cancelled"));
          if (input.signal.aborted) rejectCancelled();
          else input.signal.addEventListener("abort", rejectCancelled, { once: true });
        }),
    });

    const running = context.runner.startSession(context.sessionId);
    await expect.poll(() => context.cloud.inputs.length).toBe(1);
    context.runner.cancelSession(context.sessionId);
    await running;

    const state = context.store.getProjectedState(context.sessionId);
    expect(state.status).toBe("cancelled");
    expect(context.cloud.inputs).toHaveLength(1);
    expect(context.local.inputs).toHaveLength(2);
    expect(state.routingDecisions.map((decision) => decision.boundary)).toEqual([
      "session_start",
      "evidence_complete",
    ]);
    expect(state.inferenceAttempts.at(-1)?.finished?.outcome).toBe("cancelled");
    expect(context.ledger.listOutstandingReservations({
      sessionId: context.sessionId,
    })).toEqual([]);
  });

  it("records a trustworthy paid overrun as failure even when cancellation follows the response", async () => {
    const context = fixture({
      cloudStep: () => {
        context.runner.cancelSession(context.sessionId);
        return {
          ...finalResult("fake-cloud-model", "cancelled overrun response"),
          costUsd: 1,
        };
      },
    });

    await context.runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    const cloudAttempt = state.inferenceAttempts[2]!;
    expect(state.status).toBe("failed");
    expect(state.error).toMatch(/budget overrun/u);
    expect(cloudAttempt.finished).toMatchObject({
      outcome: "protocol_error",
      requestDisposition: "sent",
      errorCode: "budget_overrun",
      cost: {
        amountMicrousd: 1_000_000,
        provenance: "provider_reported",
      },
    });
    expect(context.cloud.inputs).toHaveLength(1);
    expect(context.local.inputs).toHaveLength(2);
    expect(state.routingDecisions.map((decision) => decision.boundary)).toEqual([
      "session_start",
      "evidence_complete",
    ]);
    expect(context.ledger.listOutstandingReservations({
      sessionId: context.sessionId,
    })).toEqual([]);
  });

  it("retains local synthesis on a locked episode-cap denial without calling cloud", async () => {
    const context = fixture({
      cloudStep: () => finalResult("fake-cloud-model", "must not dispatch"),
      localFinal: "Budget-denied local synthesis.",
      episodeCapMicrousd: 1,
    });

    await context.runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    expect(state.status).toBe("completed");
    expect(state.result).toBe("Budget-denied local synthesis.");
    expect(context.cloud.inputs).toHaveLength(0);
    expect(context.local.inputs).toHaveLength(3);
    const denial = state.routingDecisions.at(-1)!;
    expect(denial.reasonCode).toBe("budget_denial");
    expect(denial.action).toBe("retain_lease");
    expect(denial.triggerFacts).toContainEqual({
      key: "budget_denial_reason",
      value: "episode_cap",
    });
    expect(state.routes).toHaveLength(1);
    expect(context.ledger.listOutstandingReservations({
      sessionId: context.sessionId,
    })).toEqual([]);
  });

  it("terminalizes a failed retained-local synthesis", async () => {
    const context = fixture({
      cloudStep: () => finalResult("fake-cloud-model", "must not dispatch"),
      localFinalFailure: "scripted retained-local synthesis failure",
      episodeCapMicrousd: 1,
    });

    await context.runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    expect(state.status).toBe("failed");
    expect(state.error).toMatch(/retained-local synthesis failure/u);
    expect(context.cloud.inputs).toHaveLength(0);
    expect(context.local.inputs).toHaveLength(3);
    expect(state.inferenceAttempts.every(
      (attempt) => attempt.finished !== undefined,
    )).toBe(true);
    expect(context.ledger.listOutstandingReservations({
      sessionId: context.sessionId,
    })).toEqual([]);
  });

  it.each([
    {
      label: "disabled provider",
      reasonCode: "disabled_provider",
      fixtureOptions: {
        cloudDescriptorOverrides: { enabled: false },
      },
    },
    {
      label: "missing credential",
      reasonCode: "missing_credential",
      fixtureOptions: {
        runtimeOverrides: { credentialAvailable: false },
      },
    },
    {
      label: "unhealthy provider",
      reasonCode: "unhealthy_provider",
      fixtureOptions: {
        runtimeOverrides: { healthSnapshots: healthFixtures("unhealthy") },
      },
    },
    {
      label: "unavailable pricing",
      reasonCode: "pricing_denial",
      fixtureOptions: {
        runtimeOverrides: { pricingSnapshot: unavailablePricing() },
      },
    },
    {
      label: "egress denial",
      reasonCode: "egress_denial",
      fixtureOptions: {
        runtimeOverrides: { egressAllowed: false },
      },
    },
  ] as const)(
    "persists local synthesis before budget for $label",
    async ({ reasonCode, fixtureOptions }) => {
      const context = fixture({
        cloudStep: () => finalResult("fake-cloud-model", "must not dispatch"),
        localFinal: `Local synthesis after ${reasonCode}.`,
        ...fixtureOptions,
      });

      await context.runner.startSession(context.sessionId);

      const state = context.store.getProjectedState(context.sessionId);
      const reservationRows = context.database
        .prepare(
          `SELECT COUNT(*) AS count FROM budget_ledger_entries
           WHERE row_type = 'reservation' AND session_id = ?`,
        )
        .get(context.sessionId) as { count: number };
      expect(state.status).toBe("completed");
      expect(state.routingDecisions.at(-1)?.reasonCode).toBe(reasonCode);
      expect(state.routingDecisions.at(-1)?.action).toBe("retain_lease");
      expect(state.routes).toHaveLength(1);
      expect(context.cloud.inputs).toHaveLength(0);
      expect(context.local.inputs).toHaveLength(3);
      expect(reservationRows.count).toBe(0);
      expect(context.ledger.listOutstandingReservations({
        sessionId: context.sessionId,
      })).toEqual([]);
    },
  );

  it("persists deadline denial locally before budget when a full fallback window no longer remains", async () => {
    let clockCalls = 0;
    const context = fixture({
      cloudStep: () => finalResult("fake-cloud-model", "must not dispatch"),
      localFinal: "Local synthesis after deadline denial.",
      runtimeOverrides: {
        clock: () =>
          new Date(
            clockCalls++ === 0
              ? NOW
              : "2026-08-29T12:01:40.000Z",
          ),
        healthSnapshotProvider: (providerId, asOf) => {
          const asOfMs = Date.parse(asOf);
          return {
            snapshotId: `health-${providerId}-${asOfMs}`,
            providerId,
            model:
              providerId === CLOUD_ID
                ? "fake-cloud-model"
                : "fake-local-model",
            checkedAt: new Date(asOfMs - 30_000).toISOString(),
            expiresAt: new Date(asOfMs + 30_000).toISOString(),
            status: "healthy",
            resultCode: "fake_healthy",
          };
        },
      },
    });

    await context.runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    const reservationRows = context.database
      .prepare(
        `SELECT COUNT(*) AS count FROM budget_ledger_entries
         WHERE row_type = 'reservation' AND session_id = ?`,
      )
      .get(context.sessionId) as { count: number };
    expect(state.status).toBe("completed");
    expect(state.routingDecisions.at(-1)?.reasonCode).toBe("deadline_denial");
    expect(context.cloud.inputs).toHaveLength(0);
    expect(context.local.inputs).toHaveLength(3);
    expect(reservationRows.count).toBe(0);
  });

  it("does not start a routine retained-lease attempt at the episode deadline", async () => {
    let clockCalls = 0;
    const context = fixture({
      cloudStep: () => finalResult("fake-cloud-model", "must not dispatch"),
      runtimeOverrides: {
        clock: () =>
          new Date(
            clockCalls++ <= 1 ? NOW : "2026-08-29T12:02:00.000Z",
          ),
      },
    });

    await context.runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    expect(state.status).toBe("failed");
    expect(state.error).toMatch(/episode deadline was reached/u);
    expect(context.local.inputs).toHaveLength(1);
    expect(context.cloud.inputs).toHaveLength(0);
    expect(state.inferenceAttempts).toHaveLength(1);
    expect(state.inferenceAttempts[0]?.finished).toBeDefined();
    expect(state.routingDecisions.map((decision) => decision.boundary)).toEqual([
      "session_start",
    ]);
    expect(context.ledger.listOutstandingReservations({
      sessionId: context.sessionId,
    })).toEqual([]);
  });

  it("does not dispatch when the persisted episode deadline is reached after start commit", async () => {
    let now = NOW;
    let advancedAfterStart = false;
    const context = fixture({
      cloudStep: () => finalResult("fake-cloud-model", "must not dispatch"),
      runtimeOverrides: {
        clock: () => new Date(now),
      },
      onPersisted: () => {
        if (!advancedAfterStart) {
          now = "2026-08-29T12:02:00.000Z";
          advancedAfterStart = true;
        }
      },
    });

    await context.runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    expect(state.status).toBe("failed");
    expect(context.local.inputs).toHaveLength(0);
    expect(context.cloud.inputs).toHaveLength(0);
    expect(state.inferenceAttempts).toHaveLength(1);
    expect(state.inferenceAttempts[0]?.finished).toMatchObject({
      outcome: "timeout",
      requestDisposition: "not_sent",
      errorCode: "attempt_timeout",
    });
    expect(context.ledger.listOutstandingReservations({
      sessionId: context.sessionId,
    })).toEqual([]);
  });

  it("makes synthesis capability mismatch unrepresentable in the admitted registry", () => {
    expect(() =>
      cloudScriptedDescriptor({
        capabilities: ["chat_completions"],
      }),
    ).toThrow(/must support streaming/u);
  });

  it("rolls back an injected atomic budget fault and never exposes dispatch authority", async () => {
    const context = fixture({
      cloudStep: () => finalResult("fake-cloud-model", "must not dispatch"),
      runtimeOverrides: {
        attemptUnitOfWorkFactory: (ledger) =>
          new AttemptUnitOfWork(ledger, {
            faultInjector: (point) => {
              if (point === "after_budget_mutation") {
                throw new Error("injected atomic budget fault");
              }
            },
          }),
      },
    });

    await context.runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    expect(state.status).toBe("failed");
    expect(state.error).toMatch(/injected atomic budget fault/u);
    expect(context.cloud.inputs).toHaveLength(0);
    expect(context.local.inputs).toHaveLength(2);
    expect(state.routingDecisions.map((decision) => decision.boundary)).toEqual([
      "session_start",
    ]);
    expect(context.ledger.listOutstandingReservations({
      sessionId: context.sessionId,
    })).toEqual([]);
  });

  it("fails closed for v2 when the explicit fake-only runtime is absent", async () => {
    const context = fixture({
      cloudStep: () => finalResult("fake-cloud-model", "must not dispatch"),
    });
    const runner = new SessionRunner({
      store: context.store,
      providerRegistry: new ProviderRegistry([
        {
          descriptor: context.local.descriptor,
          provider: context.local,
        },
      ]),
      defaultLocalProviderId: LOCAL_ID,
      limits: { inferenceRounds: 4, toolCalls: 2 },
    });

    await runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    expect(state.status).toBe("failed");
    expect(state.error).toMatch(/No provider request was dispatched/u);
    expect(context.local.inputs).toHaveLength(0);
    expect(context.cloud.inputs).toHaveLength(0);
  });

  it("terminalizes malformed explicit fake-runtime preflight without dispatch", async () => {
    const context = fixture({
      cloudStep: () => finalResult("fake-cloud-model", "must not dispatch"),
    });
    const runner = new SessionRunner({
      store: context.store,
      providerRegistry: context.providerRegistry,
      defaultLocalProviderId: LOCAL_ID,
      limits: { inferenceRounds: 4, toolCalls: 2 },
      hybridRuntime: {
        ...context.runtime,
        fakeProviderIds: [LOCAL_ID],
      },
    });

    await runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    expect(state.status).toBe("failed");
    expect(state.error).toMatch(/exactly two explicitly admitted fake providers/u);
    expect(context.local.inputs).toHaveLength(0);
    expect(context.cloud.inputs).toHaveLength(0);
  });

  it.each([
    {
      label: "invalid clock",
      runtimeOverrides: {
        clock: () => new Date(Number.NaN),
      },
      expectedError: /invalid date/u,
    },
    {
      label: "empty ID source",
      runtimeOverrides: {
        idFactory: () => "",
      },
      expectedError: /empty identity/u,
    },
  ])(
    "uses host envelope defaults to terminalize a $label failure",
    async ({ runtimeOverrides, expectedError }) => {
      const context = fixture({
        cloudStep: () => finalResult("fake-cloud-model", "must not dispatch"),
        runtimeOverrides,
      });

      await context.runner.startSession(context.sessionId);

      const state = context.store.getProjectedState(context.sessionId);
      expect(state.status).toBe("failed");
      expect(state.error).toMatch(expectedError);
      expect(context.local.inputs).toHaveLength(0);
      expect(context.cloud.inputs).toHaveLength(0);
    },
  );

  it("rejects an unbranded provider implementation before dispatch", async () => {
    const context = fixture({
      cloudStep: () => finalResult("fake-cloud-model", "must not dispatch"),
    });
    const unbrandedLocal: DescribedInferenceProvider = {
      descriptor: context.local.descriptor,
      id: context.local.id,
      model: context.local.model,
      costPolicy: "local_zero_cost",
      estimateInputTokenReserve: () =>
        context.local.estimateInputTokenReserve(),
      complete: (input) => context.local.complete(input),
    };
    const providerRegistry = new ProviderRegistry([
      {
        descriptor: context.local.descriptor,
        provider: unbrandedLocal,
      },
      {
        descriptor: context.cloud.descriptor,
        provider: context.cloud,
      },
    ]);
    const runner = new SessionRunner({
      store: context.store,
      providerRegistry,
      defaultLocalProviderId: LOCAL_ID,
      limits: { inferenceRounds: 4, toolCalls: 2 },
      hybridRuntime: context.runtime,
    });

    await runner.startSession(context.sessionId);

    const state = context.store.getProjectedState(context.sessionId);
    expect(state.status).toBe("failed");
    expect(state.error).toMatch(/not a nominally branded fake provider/u);
    expect(context.local.inputs).toHaveLength(0);
    expect(context.cloud.inputs).toHaveLength(0);
  });
});
