import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { SessionRunner } from "../../src/main/agent/run-session";
import { BudgetLedger } from "../../src/main/budget-ledger";
import { toChangeReviewView } from "../../src/main/change-review-view";
import {
  createSoarDatabase,
  type SoarDatabase,
} from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";
import { recoverRunningSessions } from "../../src/main/recovery";
import {
  HYBRID_SIMULATION_CAMPAIGN_ID,
  createHybridSimulationRuntimeV1,
  hybridSimulationAuthoritySnapshotV1,
  assertHybridSimulationRuntimeV1,
} from "../../src/main/hybrid-simulation-runtime";
import {
  createFakeCloudReviewProviderV1,
  type FakeCloudReviewScenarioV1,
} from "../../src/main/providers/fake-cloud-review-provider";
import { FakeProvider } from "../../src/main/providers/fake-provider";
import { ProviderRegistry } from "../../src/main/providers/provider-registry";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const databases: SoarDatabase[] = [];
const LIMITS = { inferenceRounds: 4, toolCalls: 3 } as const;
const NOW = "2026-08-31T00:00:01.000Z";
const HIGH_RISK_PATH = "src/main/providers/risky-provider.ts";

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("/usr/bin/git", args, {
    cwd,
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
    maxBuffer: 8 * 1024 * 1024,
  });
}

async function createRepository(options: {
  highRisk?: boolean;
  content?: string;
} = {}): Promise<string> {
  const workspaceRoot = await mkdtemp(
    path.join(tmpdir(), "soar-hybrid-simulation-"),
  );
  temporaryDirectories.push(workspaceRoot);
  await git(workspaceRoot, "init", "--quiet");
  await git(workspaceRoot, "config", "user.name", "SOAR Test");
  await git(workspaceRoot, "config", "user.email", "soar@example.invalid");
  const relativePath = options.highRisk === false
    ? "src/ui-copy.ts"
    : HIGH_RISK_PATH;
  await mkdir(path.join(workspaceRoot, path.dirname(relativePath)), {
    recursive: true,
  });
  await writeFile(
    path.join(workspaceRoot, relativePath),
    "export const reviewedValue = 1;\n",
    "utf8",
  );
  await git(workspaceRoot, "add", relativePath);
  await git(workspaceRoot, "commit", "--quiet", "-m", "base");
  await writeFile(
    path.join(workspaceRoot, relativePath),
    options.content ?? "export const reviewedValue = 2;\n",
    "utf8",
  );
  return workspaceRoot;
}

function store(): EventStore {
  const database = createSoarDatabase();
  databases.push(database);
  return new EventStore(database);
}

function fixture(options: {
  scenario?: FakeCloudReviewScenarioV1;
  localReviewFailure?: boolean;
  delayMs?: number;
  onCloudInvocationStarted?: () => void;
  beforeDispatch?: () => void | Promise<void>;
  afterRevalidation?: () => void | Promise<void>;
  afterFailure?: () => void | Promise<void>;
} = {}) {
  const local = new FakeProvider({
    delayMs: 0,
    ...(options.localReviewFailure
      ? { structuredReviewScenario: "provider_error" as const }
      : {}),
  });
  const cloud = createFakeCloudReviewProviderV1({
    pricingVerifiedAt: NOW,
    delayMs: options.delayMs ?? 0,
    scenario: options.scenario ?? "success",
    ...(options.onCloudInvocationStarted === undefined
      ? {}
      : { onInvocationStarted: options.onCloudInvocationStarted }),
  });
  const providerRegistry = new ProviderRegistry([
    { descriptor: local.descriptor, provider: local },
    { descriptor: cloud.descriptor, provider: cloud },
  ]);
  let nextId = 0;
  const runtime = createHybridSimulationRuntimeV1({
    providerRegistry,
    defaultLocalProviderId: local.id,
    clock: () => new Date(NOW),
    idFactory: () => `hybrid-test-id-${++nextId}`,
    testHooks: {
      ...(options.beforeDispatch === undefined
        ? {}
        : { beforeFakeCloudDispatch: options.beforeDispatch }),
      ...(options.afterRevalidation === undefined
        ? {}
        : { afterCloudWorkspaceRevalidation: options.afterRevalidation }),
      ...(options.afterFailure === undefined
        ? {}
        : { afterFakeCloudFailurePersisted: options.afterFailure }),
    },
  });
  const admitted = assertHybridSimulationRuntimeV1({
    runtime,
    providerRegistry,
    defaultLocalProviderId: local.id,
  });
  return { local, cloud, providerRegistry, runtime, admitted };
}

function createSessionAndCampaign(options: {
  eventStore: EventStore;
  workspaceRoot: string;
  fixture: ReturnType<typeof fixture>;
  id: string;
  objective?: string;
  attemptTimeoutMs?: number;
}): void {
  const authority = hybridSimulationAuthoritySnapshotV1(
    options.fixture.runtime,
    options.fixture.admitted,
  );
  options.eventStore.createSession({
    id: options.id,
    title: "Hybrid simulation review",
    objective:
      options.objective ??
      "Review the current changes for concrete defects or bounded risks.",
    workspaceRoot: options.workspaceRoot,
    profile: "balanced",
    taskTrack: "change-review-v1",
    completionObligations: {
      requiredSuccessfulTools: ["inspect_git_changes"],
      minimumVerifiedPathLineCitations: 0,
    },
    executionPolicy: {
      schemaVersion: "agentic-execution-v2",
      ...LIMITS,
      routingPolicy: "hybrid_simulation_v1",
      maxProviderChanges: 2,
      maxPaidAttempts: 1,
      maxPaidEpisodeMicrousd: 250_000,
      maxEpisodeDurationMs: 120_000,
      attemptTimeoutMs: options.attemptTimeoutMs ?? 30_000,
      egressConsent: "none",
      simulationConsent: "simulation_cloud_synthesis_v1",
    },
    hybridSimulation: authority,
  });
  new BudgetLedger(options.eventStore).ensureCampaign({
    id: HYBRID_SIMULATION_CAMPAIGN_ID,
    providerId: authority.fakeCloudProvider.providerId,
    credentialMetadataId: authority.credentialMetadataId,
    openingExposureMicrousd: 0,
    automaticStopMicrousd: authority.maxSimulatedSpendMicrousd,
    hardCeilingMicrousd: authority.maxSimulatedSpendMicrousd,
    costScope: "simulation",
    createdAt: authority.campaignCreatedAt,
  });
}

function runner(options: {
  eventStore: EventStore;
  fixture: ReturnType<typeof fixture>;
  controller?: AbortController;
}): SessionRunner {
  return new SessionRunner({
    store: options.eventStore,
    providerRegistry: options.fixture.providerRegistry,
    defaultLocalProviderId: options.fixture.local.id,
    hybridSimulationRuntime: options.fixture.runtime,
    limits: LIMITS,
    context: { maxInputTokens: 24_576, safetyMargin: 0.1 },
  });
}

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Hybrid simulation strict change review", () => {
  it("persists egress admission, simulated reservation/settlement, and an accepted fake Cloud review", async () => {
    const workspaceRoot = await createRepository();
    const eventStore = store();
    let dispatches = 0;
    const testRuntime = fixture({
      beforeDispatch: () => {
        dispatches += 1;
      },
    });
    createSessionAndCampaign({
      eventStore,
      workspaceRoot,
      fixture: testRuntime,
      id: "hybrid-success",
    });

    await runner({ eventStore, fixture: testRuntime }).startSession(
      "hybrid-success",
    );

    const state = eventStore.getProjectedState("hybrid-success");
    const ledger = new BudgetLedger(eventStore);
    expect(state.status).toBe("completed");
    expect(dispatches).toBe(1);
    expect(state.cloudEgressAdmissions).toHaveLength(1);
    expect(state.cloudEgressAdmissions[0]?.decision).toBe("pass");
    expect(
      state.inferenceAttempts.filter(
        (attempt) => attempt.providerId === "fake-cloud-review",
      ),
    ).toHaveLength(1);
    expect(state.inferenceAttempts.at(-1)?.costScope).toBe("simulation");
    expect(ledger.listOutstandingReservations({ sessionId: state.id })).toEqual(
      [],
    );
    expect(ledger.getCostScopeSummary({ sessionId: state.id })).toMatchObject({
      actual: { settledMicrousd: 0 },
      simulation: { settledMicrousd: 960 },
    });
    ledger.assertEventReconciled();
  });

  it("uses one Local fallback after one eligible fake Cloud provider failure", async () => {
    const workspaceRoot = await createRepository();
    const eventStore = store();
    let afterFailure = 0;
    const testRuntime = fixture({
      scenario: "provider_error",
      afterFailure: () => {
        afterFailure += 1;
      },
    });
    createSessionAndCampaign({
      eventStore,
      workspaceRoot,
      fixture: testRuntime,
      id: "hybrid-fallback",
    });

    await runner({ eventStore, fixture: testRuntime }).startSession(
      "hybrid-fallback",
    );

    const state = eventStore.getProjectedState("hybrid-fallback");
    const cloudAttempts = state.inferenceAttempts.filter(
      (attempt) => attempt.providerId === "fake-cloud-review",
    );
    expect(state.status).toBe("completed");
    expect(afterFailure).toBe(1);
    expect(cloudAttempts).toHaveLength(1);
    expect(cloudAttempts[0]?.finished?.outcome).toBe("provider_error");
    expect(
      state.routingDecisions.filter(
        (decision) => decision.boundary === "provider_failure",
      ),
    ).toHaveLength(1);
    expect(state.inferenceAttempts.at(-1)?.providerId).toBe("local-vllm");
    expect(state.inferenceAttempts.at(-1)?.costScope).toBe("simulation");

    const view = await toChangeReviewView(eventStore, state.id);
    expect(view.phases.find((phase) => phase.id === "synthesis")).toMatchObject({
      label: "Fake cloud synthesis",
      status: "failed",
      providerLabel: "Fake Cloud",
      reason: "provider_error",
    });
    expect(view.phases.find((phase) => phase.id === "fallback")).toMatchObject({
      label: "Optional Local fallback",
      status: "complete",
      providerLabel: "Fake Local",
    });
    expect(
      view.routes?.filter(
        (route) => route.phaseId === "synthesis" || route.phaseId === "fallback",
      ),
    ).toEqual([
      expect.objectContaining({
        phaseId: "synthesis",
        providerLabel: "Fake Cloud",
        locality: "cloud",
        status: "failed",
        reason: "provider_error",
      }),
      expect.objectContaining({
        phaseId: "fallback",
        providerLabel: "Fake Local",
        locality: "local",
        status: "complete",
      }),
    ]);
  });

  it("fails after one Local fallback failure without retrying either provider", async () => {
    const workspaceRoot = await createRepository();
    const eventStore = store();
    const testRuntime = fixture({
      scenario: "provider_error",
      localReviewFailure: true,
    });
    createSessionAndCampaign({
      eventStore,
      workspaceRoot,
      fixture: testRuntime,
      id: "hybrid-fallback-failure",
    });

    await runner({ eventStore, fixture: testRuntime }).startSession(
      "hybrid-fallback-failure",
    );

    const state = eventStore.getProjectedState("hybrid-fallback-failure");
    expect(state.status).toBe("failed");
    expect(
      state.inferenceAttempts.filter(
        (attempt) => attempt.providerId === "fake-cloud-review",
      ),
    ).toHaveLength(1);
    expect(
      state.inferenceAttempts.filter(
        (attempt) =>
          attempt.providerId === "local-vllm" &&
          attempt.phase === "synthesis",
      ),
    ).toHaveLength(1);
    expect(
      state.routingDecisions.filter(
        (decision) => decision.boundary === "provider_failure",
      ),
    ).toHaveLength(1);
    expect(
      new BudgetLedger(eventStore).listOutstandingReservations({
        sessionId: state.id,
      }),
    ).toEqual([]);
  });

  it("records a real egress denial and continues Local with zero fake Cloud reservation", async () => {
    const workspaceRoot = await createRepository();
    const eventStore = store();
    let dispatches = 0;
    const testRuntime = fixture({
      beforeDispatch: () => {
        dispatches += 1;
      },
    });
    createSessionAndCampaign({
      eventStore,
      workspaceRoot,
      fixture: testRuntime,
      id: "hybrid-egress-denial",
      objective: `Review the changes under ${workspaceRoot}.`,
    });

    await runner({ eventStore, fixture: testRuntime }).startSession(
      "hybrid-egress-denial",
    );

    const state = eventStore.getProjectedState("hybrid-egress-denial");
    const ledger = new BudgetLedger(eventStore);
    expect(state.status).toBe("completed");
    expect(dispatches).toBe(0);
    expect(state.cloudEgressAdmissions[0]).toMatchObject({
      decision: "deny",
      reasonCodes: ["absolute_workspace_path"],
    });
    expect(
      state.routingDecisions.find(
        (decision) => decision.boundary === "evidence_complete",
      )?.reasonCode,
    ).toBe("egress_denial");
    expect(
      state.inferenceAttempts.some(
        (attempt) => attempt.providerId === "fake-cloud-review",
      ),
    ).toBe(false);
    expect(ledger.getCostScopeSummary({ sessionId: state.id }).simulation)
      .toMatchObject({ outstandingReservationMicrousd: 0, settledMicrousd: 0 });

    const view = await toChangeReviewView(eventStore, state.id);
    expect(
      view.routes?.filter((route) => route.phaseId === "synthesis"),
    ).toEqual([
      expect.objectContaining({
        providerLabel: "Fake Cloud",
        locality: "cloud",
        status: "failed",
        reason: "absolute_workspace_path",
      }),
      expect.objectContaining({
        providerLabel: "Fake Local",
        locality: "local",
        status: "complete",
        reason: "egress_denial",
      }),
    ]);
  });

  it("cancels a committed fake Cloud attempt without creating a Local fallback", async () => {
    const workspaceRoot = await createRepository();
    const eventStore = store();
    let markDispatchReady!: () => void;
    let releaseDispatch!: () => void;
    const dispatchReady = new Promise<void>((resolve) => {
      markDispatchReady = resolve;
    });
    const dispatchGate = new Promise<void>((resolve) => {
      releaseDispatch = resolve;
    });
    const testRuntime = fixture({
      delayMs: 100,
      beforeDispatch: async () => {
        markDispatchReady();
        await dispatchGate;
      },
    });
    createSessionAndCampaign({
      eventStore,
      workspaceRoot,
      fixture: testRuntime,
      id: "hybrid-cancelled",
    });
    const sessionRunner = runner({ eventStore, fixture: testRuntime });
    const completion = sessionRunner.startSession("hybrid-cancelled");
    await dispatchReady;
    sessionRunner.cancelSession("hybrid-cancelled");
    releaseDispatch();
    await completion;

    const state = eventStore.getProjectedState("hybrid-cancelled");
    expect(state.status).toBe("cancelled");
    expect(
      state.inferenceAttempts.filter(
        (attempt) => attempt.providerId === "fake-cloud-review",
      ),
    ).toHaveLength(1);
    expect(
      state.routingDecisions.filter(
        (decision) => decision.boundary === "provider_failure",
      ),
    ).toHaveLength(0);
    expect(new BudgetLedger(eventStore).listOutstandingReservations({
      sessionId: state.id,
    })).toEqual([]);
  });

  it("cancels after the Fake Cloud invocation begins and conservatively settles once", async () => {
    const workspaceRoot = await createRepository();
    const eventStore = store();
    let signalInvocationStarted!: () => void;
    const invocationStarted = new Promise<void>((resolve) => {
      signalInvocationStarted = resolve;
    });
    const testRuntime = fixture({
      delayMs: 1_000,
      onCloudInvocationStarted: signalInvocationStarted,
    });
    createSessionAndCampaign({
      eventStore,
      workspaceRoot,
      fixture: testRuntime,
      id: "hybrid-cancelled-after-invocation",
    });
    const sessionRunner = runner({ eventStore, fixture: testRuntime });
    const completion = sessionRunner.startSession(
      "hybrid-cancelled-after-invocation",
    );
    await invocationStarted;
    sessionRunner.cancelSession("hybrid-cancelled-after-invocation");
    await completion;

    const state = eventStore.getProjectedState(
      "hybrid-cancelled-after-invocation",
    );
    const cloudAttempt = state.inferenceAttempts.find(
      (attempt) => attempt.providerId === "fake-cloud-review",
    );
    expect(state.status).toBe("cancelled");
    expect(cloudAttempt?.finished).toMatchObject({
      outcome: "cancelled",
      requestDisposition: "unknown",
      cost: {
        costScope: "simulation",
        provenance: "reserved_unknown",
      },
    });
    expect(
      state.routingDecisions.filter(
        (decision) => decision.boundary === "provider_failure",
      ),
    ).toHaveLength(0);
    expect(
      new BudgetLedger(eventStore).listOutstandingReservations({
        sessionId: state.id,
      }),
    ).toEqual([]);
    expect(cloudAttempt?.finished?.cost.amountMicrousd).toBe(
      state.routingDecisions.find(
        (decision) => decision.reasonCode === "cloud_admitted",
      )?.billing?.projectedCostMicrousd,
    );
  });

  it("lets Stop win during post-response revalidation and never accepts the review", async () => {
    const workspaceRoot = await createRepository();
    const eventStore = store();
    let sessionRunner!: SessionRunner;
    const testRuntime = fixture({
      afterRevalidation: () =>
        sessionRunner.cancelSession("hybrid-cancelled-after-revalidation"),
    });
    createSessionAndCampaign({
      eventStore,
      workspaceRoot,
      fixture: testRuntime,
      id: "hybrid-cancelled-after-revalidation",
    });

    sessionRunner = runner({ eventStore, fixture: testRuntime });
    await sessionRunner.startSession("hybrid-cancelled-after-revalidation");

    const state = eventStore.getProjectedState(
      "hybrid-cancelled-after-revalidation",
    );
    const cloudAttempt = state.inferenceAttempts.find(
      (attempt) => attempt.providerId === "fake-cloud-review",
    );
    expect(state.status).toBe("cancelled");
    expect(cloudAttempt?.finished).toMatchObject({
      outcome: "cancelled",
      requestDisposition: "sent",
      cost: {
        costScope: "simulation",
        provenance: "reserved_unknown",
      },
    });
    expect(
      state.routingDecisions.filter(
        (decision) => decision.boundary === "provider_failure",
      ),
    ).toHaveLength(0);
    expect(
      state.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.status === "completed" &&
          message.content.length > 0,
      ),
    ).toBe(false);
    expect(
      new BudgetLedger(eventStore).listOutstandingReservations({
        sessionId: state.id,
      }),
    ).toEqual([]);
    expect(cloudAttempt?.finished?.cost.amountMicrousd).toBe(
      state.routingDecisions.find(
        (decision) => decision.reasonCode === "cloud_admitted",
      )?.billing?.projectedCostMicrousd,
    );
  });

  it("cancels after fake Cloud failure persistence without starting fallback", async () => {
    const workspaceRoot = await createRepository();
    const eventStore = store();
    let sessionRunner!: SessionRunner;
    const testRuntime = fixture({
      scenario: "provider_error",
      afterFailure: () =>
        sessionRunner.cancelSession("hybrid-cancelled-before-fallback"),
    });
    createSessionAndCampaign({
      eventStore,
      workspaceRoot,
      fixture: testRuntime,
      id: "hybrid-cancelled-before-fallback",
    });
    sessionRunner = runner({ eventStore, fixture: testRuntime });

    await sessionRunner.startSession("hybrid-cancelled-before-fallback");

    const state = eventStore.getProjectedState(
      "hybrid-cancelled-before-fallback",
    );
    expect(state.status).toBe("cancelled");
    expect(
      state.inferenceAttempts.filter(
        (attempt) => attempt.providerId === "fake-cloud-review",
      ),
    ).toHaveLength(1);
    expect(
      state.routingDecisions.filter(
        (decision) => decision.boundary === "provider_failure",
      ),
    ).toHaveLength(0);
    expect(
      new BudgetLedger(eventStore).listOutstandingReservations({
        sessionId: state.id,
      }),
    ).toEqual([]);
  });

  it("routes a low-risk review directly to Local without egress or ledger work", async () => {
    const workspaceRoot = await createRepository({ highRisk: false });
    const eventStore = store();
    let dispatches = 0;
    const testRuntime = fixture({
      beforeDispatch: () => {
        dispatches += 1;
      },
    });
    createSessionAndCampaign({
      eventStore,
      workspaceRoot,
      fixture: testRuntime,
      id: "hybrid-low-risk",
    });

    await runner({ eventStore, fixture: testRuntime }).startSession(
      "hybrid-low-risk",
    );

    const state = eventStore.getProjectedState("hybrid-low-risk");
    expect(state.status).toBe("completed");
    expect(dispatches).toBe(0);
    expect(state.cloudEgressAdmissions).toEqual([]);
    expect(
      state.routingDecisions.find(
        (decision) => decision.boundary === "evidence_complete",
      )?.reasonCode,
    ).toBe("low_risk_local_review");
    expect(
      new BudgetLedger(eventStore).getCostScopeSummary({ sessionId: state.id })
        .simulation,
    ).toMatchObject({ outstandingReservationMicrousd: 0, settledMicrousd: 0 });

    const view = await toChangeReviewView(eventStore, state.id);
    expect(view.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phaseId: "checkpoint",
          providerLabel: "Fake Local",
          locality: "local",
          status: "complete",
          reason: "low_risk_local_review",
        }),
        expect.objectContaining({
          phaseId: "synthesis",
          providerLabel: "Fake Local",
          locality: "local",
          status: "complete",
          reason: "low_risk_local_review",
        }),
      ]),
    );
    expect(
      view.routes?.some((route) => route.providerLabel.startsWith("Fake Cloud")),
    ).toBe(false);
    expect(view.phases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "synthesis",
          label: "Local synthesis",
          status: "complete",
        }),
        expect.objectContaining({
          id: "fallback",
          label: "Optional Local fallback",
          status: "pending",
        }),
      ]),
    );
  });

  it("settles a timed-out fake Cloud request conservatively and falls back once", async () => {
    const workspaceRoot = await createRepository();
    const eventStore = store();
    const testRuntime = fixture({ delayMs: 100 });
    createSessionAndCampaign({
      eventStore,
      workspaceRoot,
      fixture: testRuntime,
      id: "hybrid-timeout",
      attemptTimeoutMs: 10,
    });

    await runner({ eventStore, fixture: testRuntime }).startSession(
      "hybrid-timeout",
    );

    const state = eventStore.getProjectedState("hybrid-timeout");
    const cloud = state.inferenceAttempts.find(
      (attempt) => attempt.providerId === "fake-cloud-review",
    );
    expect(state.status).toBe("completed");
    expect(cloud?.finished).toMatchObject({
      outcome: "timeout",
      requestDisposition: "unknown",
      cost: { provenance: "reserved_unknown", costScope: "simulation" },
    });
    expect(
      state.routingDecisions.filter(
        (decision) => decision.boundary === "provider_failure",
      ),
    ).toHaveLength(1);

    const view = await toChangeReviewView(eventStore, state.id);
    expect(view.phases.find((phase) => phase.id === "synthesis")).toMatchObject({
      label: "Fake cloud synthesis",
      status: "failed",
      providerLabel: "Fake Cloud",
      reason: "attempt_timeout",
    });
    expect(
      view.routes?.find(
        (route) =>
          route.phaseId === "synthesis" && route.locality === "cloud",
      ),
    ).toMatchObject({ status: "failed", reason: "attempt_timeout" });
  });

  it("charges the full reservation for missing usage and then falls back once", async () => {
    const workspaceRoot = await createRepository();
    const eventStore = store();
    const testRuntime = fixture({ scenario: "usage_missing" });
    createSessionAndCampaign({
      eventStore,
      workspaceRoot,
      fixture: testRuntime,
      id: "hybrid-unknown-usage",
    });

    await runner({ eventStore, fixture: testRuntime }).startSession(
      "hybrid-unknown-usage",
    );

    const state = eventStore.getProjectedState("hybrid-unknown-usage");
    const cloud = state.inferenceAttempts.find(
      (attempt) => attempt.providerId === "fake-cloud-review",
    );
    expect(state.status).toBe("completed");
    expect(cloud?.finished).toMatchObject({
      outcome: "protocol_error",
      requestDisposition: "sent",
      usage: { reported: false },
      cost: { provenance: "reserved_unknown", costScope: "simulation" },
    });
    const reservation = new BudgetLedger(eventStore)
      .getCostScopeSummary({ sessionId: state.id }).simulation;
    expect(reservation.outstandingReservationMicrousd).toBe(0);
    expect(reservation.settledMicrousd).toBeGreaterThan(0);
  });

  it("records a simulated overrun in full and terminalizes without fallback", async () => {
    const workspaceRoot = await createRepository();
    const eventStore = store();
    const testRuntime = fixture({ scenario: "cost_overrun" });
    createSessionAndCampaign({
      eventStore,
      workspaceRoot,
      fixture: testRuntime,
      id: "hybrid-overrun",
    });

    await runner({ eventStore, fixture: testRuntime }).startSession(
      "hybrid-overrun",
    );

    const state = eventStore.getProjectedState("hybrid-overrun");
    expect(state.status).toBe("failed");
    expect(state.error).toContain("budget overrun");
    expect(
      state.routingDecisions.filter(
        (decision) => decision.boundary === "provider_failure",
      ),
    ).toHaveLength(0);
    expect(
      new BudgetLedger(eventStore).getCostScopeSummary({ sessionId: state.id })
        .simulation.settledMicrousd,
    ).toBe(1_000_000);
  });

  it("retains Local with zero new dispatch when the simulated campaign is disabled", async () => {
    const workspaceRoot = await createRepository();
    const eventStore = store();
    let dispatches = 0;
    const testRuntime = fixture({
      scenario: "cost_overrun",
      beforeDispatch: () => {
        dispatches += 1;
      },
    });
    createSessionAndCampaign({
      eventStore,
      workspaceRoot,
      fixture: testRuntime,
      id: "hybrid-campaign-overrun-source",
    });
    await runner({ eventStore, fixture: testRuntime }).startSession(
      "hybrid-campaign-overrun-source",
    );
    expect(
      eventStore.getProjectedState("hybrid-campaign-overrun-source").status,
    ).toBe("failed");

    createSessionAndCampaign({
      eventStore,
      workspaceRoot,
      fixture: testRuntime,
      id: "hybrid-campaign-denied",
    });
    await runner({ eventStore, fixture: testRuntime }).startSession(
      "hybrid-campaign-denied",
    );

    const denied = eventStore.getProjectedState("hybrid-campaign-denied");
    expect(denied.status).toBe("completed");
    expect(dispatches).toBe(1);
    expect(
      denied.routingDecisions.find(
        (decision) => decision.boundary === "evidence_complete",
      ),
    ).toMatchObject({
      reasonCode: "budget_denial",
      selectedProviderId: "local-vllm",
    });
    expect(
      denied.inferenceAttempts.some(
        (attempt) => attempt.providerId === "fake-cloud-review",
      ),
    ).toBe(false);
    expect(
      new BudgetLedger(eventStore).listOutstandingReservations({
        sessionId: denied.id,
      }),
    ).toEqual([]);
  });

  it("rejects a stale post-response workspace snapshot without Local fallback", async () => {
    const workspaceRoot = await createRepository();
    const eventStore = store();
    const testRuntime = fixture({
      beforeDispatch: async () => {
        await writeFile(
          path.join(workspaceRoot, HIGH_RISK_PATH),
          "export const reviewedValue = 3;\n",
          "utf8",
        );
      },
    });
    createSessionAndCampaign({
      eventStore,
      workspaceRoot,
      fixture: testRuntime,
      id: "hybrid-stale",
    });

    await runner({ eventStore, fixture: testRuntime }).startSession(
      "hybrid-stale",
    );

    const state = eventStore.getProjectedState("hybrid-stale");
    expect(state.status).toBe("failed");
    expect(state.error).toContain("stale review was rejected");
    expect(
      state.routingDecisions.filter(
        (decision) => decision.boundary === "provider_failure",
      ),
    ).toHaveLength(0);
    expect(
      state.inferenceAttempts.find(
        (attempt) => attempt.providerId === "fake-cloud-review",
      )?.finished?.errorCode,
    ).toBe("workspace_snapshot_stale");
  });

  it("recovers a committed cloud start as unknown and never redispatches it", async () => {
    const workspaceRoot = await createRepository();
    const eventStore = store();
    let dispatchBoundaryCount = 0;
    const testRuntime = fixture({
      beforeDispatch: () => {
        dispatchBoundaryCount += 1;
        throw new Error("simulated process stop after committed start");
      },
    });
    createSessionAndCampaign({
      eventStore,
      workspaceRoot,
      fixture: testRuntime,
      id: "hybrid-recovery",
    });

    await runner({ eventStore, fixture: testRuntime }).startSession(
      "hybrid-recovery",
    );
    const open = eventStore.getProjectedState("hybrid-recovery");
    expect(open.status).toBe("running");
    expect(open.inferenceAttempts.at(-1)?.finished).toBeUndefined();
    expect(dispatchBoundaryCount).toBe(1);

    recoverRunningSessions(eventStore);
    const recovered = eventStore.getProjectedState("hybrid-recovery");
    expect(recovered.status).toBe("interrupted");
    expect(recovered.inferenceAttempts.at(-1)?.finished).toMatchObject({
      outcome: "interrupted",
      requestDisposition: "unknown",
      cost: { provenance: "reserved_unknown", costScope: "simulation" },
    });
    expect(dispatchBoundaryCount).toBe(1);
    expect(() =>
      runner({ eventStore, fixture: testRuntime }).startSession(
        "hybrid-recovery",
      ),
    ).toThrow("cannot start from status interrupted");
    expect(new BudgetLedger(eventStore).listOutstandingReservations({
      sessionId: recovered.id,
    })).toEqual([]);
  });
});
