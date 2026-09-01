import { mkdir, mkdtemp, realpath, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    dialog: {
      showOpenDialog: vi.fn(),
    },
    ipcMain: {
      handle: vi.fn(
        (channel: string, handler: (...args: unknown[]) => unknown): void => {
          handlers.set(channel, handler);
        },
      ),
      removeHandler: vi.fn((channel: string): void => {
        handlers.delete(channel);
      }),
    },
  };
});

vi.mock("electron", () => ({
  dialog: electron.dialog,
  ipcMain: electron.ipcMain,
}));

import type { SessionRunner } from "../../src/main/agent/run-session";
import type { CloudCredentialStatusService } from "../../src/main/cloud-credential-service";
import type { SoarConfig } from "../../src/main/config";
import { createSoarDatabase, type SoarDatabase } from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";
import { HybridSimulationConsentChallengeStore } from "../../src/main/hybrid-simulation-consent";
import {
  HYBRID_SIMULATION_AUTHORITY_ID,
  HYBRID_SIMULATION_CAMPAIGN_ID,
  HYBRID_SIMULATION_CLOUD_HEALTH_SNAPSHOT_ID,
  HYBRID_SIMULATION_CREDENTIAL_METADATA_ID,
  HYBRID_SIMULATION_PRICING_SNAPSHOT_ID,
} from "../../src/main/hybrid-simulation-runtime";
import {
  registerIpcHandlers as registerIpcHandlersBase,
  type CredentialIpcAuthority,
  type RegisterIpcOptions,
} from "../../src/main/ipc";
import {
  FAKE_CLOUD_REVIEW_MODEL,
  FAKE_CLOUD_REVIEW_PROVIDER_ID,
} from "../../src/main/providers/fake-cloud-review-provider";
import {
  createSessionInputSchema,
  IPC_CHANNELS,
} from "../../src/shared/contracts";
import {
  HYBRID_SIMULATION_CAMPAIGN_CREATED_AT,
  HYBRID_SIMULATION_CONSENT_ID,
  HYBRID_SIMULATION_DISCLOSURE_TEXT_SHA256,
  HYBRID_SIMULATION_DISCLOSURE_VERSION,
  HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
  HYBRID_SIMULATION_RESULT_MARKER,
  HYBRID_SIMULATION_ROUTE,
  type HybridSimulationSessionAuthorityV1,
} from "../../src/shared/hybrid-simulation-contracts";
import {
  CLOUD_DISPATCH_LOCK_EXPLANATION,
  type CloudCredentialStatus,
} from "../../src/shared/cloud-setup-contracts";

const temporaryDirectories: string[] = [];
const databases: SoarDatabase[] = [];

function config(): SoarConfig {
  return {
    providerMode: "local",
    hybridSimulationEnabled: false,
    fakeCloudScenario: "success",
    fakeDelayMs: 0,
    vllm: {
      baseUrl: "http://localhost:8000/v1",
      apiKey: "local-vllm",
      model: "test-model",
      costPolicy: "local_zero_cost",
      maxOutputTokens: 1_024,
      timeoutMs: 30_000,
    },
    limits: { inferenceRounds: 4, toolCalls: 8 },
    context: { maxInputTokens: 8_192, safetyMargin: 0.2 },
  };
}

function createScenarioRunner(model = "local-review-model"): SessionRunner {
  return {
    startSession: vi.fn().mockResolvedValue(undefined),
    cancelSession: vi.fn(),
    getLocalReviewProviderDescriptor: vi.fn().mockReturnValue({
      id: "local-vllm",
      model,
    }),
  } as unknown as SessionRunner;
}

const runner = createScenarioRunner();

const TEST_RENDERER_URL = "file:///Applications/SOAR.app/renderer/index.html";
const trustedCredentialFrame = { url: TEST_RENDERER_URL };
const trustedCredentialWebContents = {
  mainFrame: trustedCredentialFrame,
  getURL: () => TEST_RENDERER_URL,
  isDestroyed: () => false,
};
const trustedCredentialWindow = {
  isDestroyed: () => false,
  webContents: trustedCredentialWebContents,
};
const trustedCredentialIpcAuthority = {
  expectedRendererUrl: TEST_RENDERER_URL,
  currentWindow: () => trustedCredentialWindow,
} as unknown as CredentialIpcAuthority;
const trustedCredentialEvent = {
  sender: trustedCredentialWebContents,
  senderFrame: trustedCredentialFrame,
};

type TestRegisterIpcOptions = Omit<
  RegisterIpcOptions,
  "credentialIpcAuthority"
> & {
  credentialIpcAuthority?: CredentialIpcAuthority;
};

function registerIpcHandlers(options: TestRegisterIpcOptions) {
  const {
    credentialIpcAuthority = trustedCredentialIpcAuthority,
    ...runtimeOptions
  } = options;
  return registerIpcHandlersBase({
    ...runtimeOptions,
    credentialIpcAuthority,
  });
}

function cloudCredentialStatus(
  overrides: Partial<CloudCredentialStatus> = {},
): CloudCredentialStatus {
  return {
    schemaVersion: "cloud-credential-status-v1",
    capabilityVersion: "credential-lease-authority-v1",
    activationPhase: "phase_b_locked",
    build: {
      state: "unsigned_or_adhoc",
      reasonCode: "signed_build_required",
    },
    legacyStagedItem: {
      state: "not_observed",
      reasonCode: "legacy_metadata_not_observed",
    },
    protectedItem: { state: "unknown", reasonCode: "activation_locked" },
    providerCheck: { providerLabel: "OpenRouter", state: "not_run" },
    dispatch: {
      state: "locked",
      reasonCode: "pr6b1_phase_b_locked",
      explanation: CLOUD_DISPATCH_LOCK_EXPLANATION,
    },
    providerContact: {
      providerLabel: "OpenRouter",
      state: "not_contacted",
      scope: "credential_operation",
    },
    latestOperation: { state: "none" },
    ...overrides,
  };
}

function statusService(
  getStatus: () => Promise<CloudCredentialStatus>,
): CloudCredentialStatusService {
  return { getStatus } as unknown as CloudCredentialStatusService;
}

const HYBRID_TEST_NOW_MS = Date.parse("2026-09-01T01:00:00.000Z");

function hybridSimulationAuthority(): HybridSimulationSessionAuthorityV1 {
  return {
    schemaVersion: "hybrid-simulation-session-authority-v1",
    simulationAuthorityId: HYBRID_SIMULATION_AUTHORITY_ID,
    disclosureVersion: HYBRID_SIMULATION_DISCLOSURE_VERSION,
    disclosureTextSha256: HYBRID_SIMULATION_DISCLOSURE_TEXT_SHA256,
    route: HYBRID_SIMULATION_ROUTE,
    resultMarker: HYBRID_SIMULATION_RESULT_MARKER,
    costScope: "simulation",
    simulationConsent: HYBRID_SIMULATION_CONSENT_ID,
    egressConsent: "none",
    maxSimulatedSpendMicrousd: HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
    fakeLocalProvider: {
      providerId: "local-vllm",
      model: "RM-01 VLM (deterministic test double)",
    },
    fakeCloudProvider: {
      providerId: FAKE_CLOUD_REVIEW_PROVIDER_ID,
      model: FAKE_CLOUD_REVIEW_MODEL,
    },
    riskPolicyId: "review-risk-v1",
    routerPolicyVersion: "hybrid-lease-router-v0",
    healthSnapshotId: HYBRID_SIMULATION_CLOUD_HEALTH_SNAPSHOT_ID,
    pricingSnapshotId: HYBRID_SIMULATION_PRICING_SNAPSHOT_ID,
    credentialMetadataId: HYBRID_SIMULATION_CREDENTIAL_METADATA_ID,
    campaignId: HYBRID_SIMULATION_CAMPAIGN_ID,
    campaignCreatedAt: HYBRID_SIMULATION_CAMPAIGN_CREATED_AT,
  };
}

function hybridConfig(): SoarConfig {
  return {
    ...config(),
    providerMode: "fake",
    hybridSimulationEnabled: true,
  };
}

async function createTemporaryRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "soar-ipc-restart-"));
  temporaryDirectories.push(directory);
  return directory;
}

function handler(channel: string): (...args: unknown[]) => unknown {
  const registered = electron.handlers.get(channel);
  if (!registered) throw new Error(`Missing IPC handler ${channel}`);
  return registered;
}

afterEach(async () => {
  electron.handlers.clear();
  electron.dialog.showOpenDialog.mockReset();
  electron.ipcMain.handle.mockClear();
  electron.ipcMain.removeHandler.mockClear();
  vi.mocked(runner.startSession).mockClear();
  vi.mocked(runner.cancelSession).mockClear();
  vi.unstubAllGlobals();
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("persisted workspace authorization", () => {
  it("allows a new task in a previously selected workspace after a real database reopen", async () => {
    const root = await createTemporaryRoot();
    const workspaceRoot = path.join(root, "workspace");
    const databasePath = path.join(root, "soar.sqlite");
    await mkdir(workspaceRoot);
    const canonicalWorkspaceRoot = await realpath(workspaceRoot);

    const firstDatabase = createSoarDatabase(databasePath);
    new EventStore(firstDatabase).createSession({
      title: "Historical task",
      objective: "Remember this workspace",
      workspaceRoot: canonicalWorkspaceRoot,
    });
    firstDatabase.close();

    const reopenedDatabase = createSoarDatabase(databasePath);
    databases.push(reopenedDatabase);
    const reopenedStore = new EventStore(reopenedDatabase);
    await registerIpcHandlers({
      store: reopenedStore,
      runner,
      config: config(),
    });

    const snapshot = (await handler(IPC_CHANNELS.createSession)(undefined, {
      task: "Run a second task without opening the picker",
      workspaceRoot,
      taskTrack: "repository-investigator-v1",
    })) as { id: string };

    expect(snapshot).toMatchObject({
      workspaceRoot: canonicalWorkspaceRoot,
      status: "created",
      taskTrack: "repository-investigator-v1",
    });
    expect(reopenedStore.listSessions()).toHaveLength(2);
    expect(
      reopenedStore.getProjectedState(snapshot.id).completionObligations,
    ).toEqual({
      requiredSuccessfulTools: [
        "list_files",
        "search_text",
        "read_text_file",
      ],
      minimumVerifiedPathLineCitations: 1,
    });
    expect(reopenedStore.getProjectedState(snapshot.id).taskTrack).toBe(
      "repository-investigator-v1",
    );
    expect(
      reopenedStore.getProjectedState(snapshot.id).executionPolicy,
    ).toEqual({
      schemaVersion: "agentic-execution-v1",
      inferenceRounds: 4,
      toolCalls: 8,
    });
    expect(electron.dialog.showOpenDialog).not.toHaveBeenCalled();
  });

  it("rejects unsupported app task tracks", () => {
    expect(() =>
      createSessionInputSchema.parse({
        task: "Inspect the repository",
        workspaceRoot: "/tmp/workspace",
        taskTrack: "untrusted-custom-track",
      }),
    ).toThrow();
    expect(() =>
      createSessionInputSchema.parse({
        task: "Bypass the review-specific policy",
        workspaceRoot: "/tmp/workspace",
        taskTrack: "change-review-v1",
      }),
    ).toThrow();
  });

  it("creates only the fixed local review policy through review-specific IPC", async () => {
    const root = await createTemporaryRoot();
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const canonicalWorkspaceRoot = await realpath(workspaceRoot);
    const database = createSoarDatabase();
    databases.push(database);
    const store = new EventStore(database);
    store.createSession({
      title: "Workspace approval",
      objective: "Remember this selected workspace",
      workspaceRoot: canonicalWorkspaceRoot,
    });
    await registerIpcHandlers({ store, runner, config: config() });

    await expect(
      handler(IPC_CHANNELS.getReviewAvailability)(undefined),
    ).resolves.toEqual({
      local: {
        enabled: true,
        label: "Local model",
        providerId: "local-vllm",
        model: "local-review-model",
        declaredTokenFeeMicrousd: 0,
        costAccountingSummary:
          "The configured vLLM route declares a $0 token fee; endpoint billing and infrastructure costs are not independently verified.",
        evidenceTransportSummary:
          "Review evidence is sent to the configured vLLM endpoint.",
      },
      hybrid: {
        enabled: false,
        reason:
          "Cloud credential status does not enable Hybrid. Real cloud dispatch is locked in this build.",
        separatelyConfiguredPaidProviderReachable: false,
        reachabilitySummary:
          "This build performs no cloud-provider validation or dispatch.",
        consent: "none",
      },
    });

    const snapshot = (await handler(
      IPC_CHANNELS.createChangeReviewSession,
    )(undefined, { workspaceRoot, route: "local" })) as { id: string };
    const state = store.getProjectedState(snapshot.id);
    expect(state.taskTrack).toBe("change-review-v1");
    expect(state.completionObligations).toEqual({
      requiredSuccessfulTools: ["inspect_git_changes"],
      minimumVerifiedPathLineCitations: 0,
    });
    expect(state.executionPolicy).toEqual({
      schemaVersion: "agentic-execution-v2",
      inferenceRounds: 4,
      toolCalls: 8,
      routingPolicy: "local_only_v1",
      maxProviderChanges: 2,
      maxPaidAttempts: 1,
      maxPaidEpisodeMicrousd: 250_000,
      maxEpisodeDurationMs: 900_000,
      attemptTimeoutMs: 30_000,
      egressConsent: "none",
    });
    expect(runner.startSession).toHaveBeenCalledOnce();
    expect(runner.startSession).toHaveBeenCalledWith(snapshot.id);
  });

  it("rejects forged Hybrid authority before credential, network, session, or budget work", async () => {
    const root = await createTemporaryRoot();
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const canonicalWorkspaceRoot = await realpath(workspaceRoot);
    const database = createSoarDatabase();
    databases.push(database);
    const store = new EventStore(database);
    store.createSession({
      title: "Workspace approval",
      objective: "Remember this selected workspace",
      workspaceRoot: canonicalWorkspaceRoot,
    });
    const unexpectedSetupCall = vi.fn(async () => {
      throw new Error("unexpected credential-store call");
    });
    const unexpectedFetch = vi.fn(() => {
      throw new Error("unexpected network call");
    });
    vi.stubGlobal("fetch", unexpectedFetch);
    await registerIpcHandlers({
      store,
      runner,
      config: config(),
      cloudCredentialStatus: statusService(unexpectedSetupCall),
    });

    await expect(
      handler(IPC_CHANNELS.createChangeReviewSession)(undefined, {
        workspaceRoot,
        route: "hybrid_v0",
        providerId: "renderer-cloud-provider",
        egressConsent: "granted",
        campaignId: "renderer-campaign",
        maxPaidEpisodeMicrousd: 250_000,
      }) as Promise<unknown>,
    ).rejects.toThrow();

    expect(unexpectedSetupCall).not.toHaveBeenCalled();
    expect(unexpectedFetch).not.toHaveBeenCalled();
    expect(runner.startSession).not.toHaveBeenCalled();
    expect(store.listSessions()).toHaveLength(1);
    const budgetRows = database
      .prepare("SELECT COUNT(*) AS count FROM budget_ledger_entries")
      .get() as { count: number };
    expect(budgetRows.count).toBe(0);
  });

  it("fails closed on invalid Hybrid challenges before new session, ledger, runner, provider, network, or workspace work", async () => {
    const scenarios = [
      "unknown",
      "replayed",
      "expired",
      "workspace_mismatch",
      "unapproved_workspace",
      "route_mismatch",
      "extra_field",
    ] as const;

    for (const scenario of scenarios) {
      const root = await createTemporaryRoot();
      const workspaceAPath = path.join(root, "workspace-a");
      const workspaceBPath = path.join(root, "workspace-b");
      await mkdir(workspaceAPath);
      await mkdir(workspaceBPath);
      const workspaceA = await realpath(workspaceAPath);
      const workspaceB = await realpath(workspaceBPath);
      const database = createSoarDatabase();
      databases.push(database);
      const store = new EventStore(database);
      const approvedRoots =
        scenario === "unapproved_workspace"
          ? [workspaceA]
          : [workspaceA, workspaceB];
      for (const [index, workspaceRoot] of approvedRoots.entries()) {
        store.createSession({
          id: `hybrid-consent-approval-${scenario}-${index}`,
          title: "Workspace approval",
          objective: "Remember this selected workspace",
          workspaceRoot,
        });
      }

      let nowMs = HYBRID_TEST_NOW_MS;
      let nextChallengeId = 0;
      const consent = new HybridSimulationConsentChallengeStore({
        authority: hybridSimulationAuthority(),
        nowMs: () => nowMs,
        idFactory: () => `${scenario}-challenge-${++nextChallengeId}`,
        challengeTtlMs: 1_000,
      });
      const scenarioRunner = createScenarioRunner(
        "RM-01 VLM (deterministic test double)",
      );
      const unexpectedCredentialCall = vi.fn(async () => {
        throw new Error("unexpected credential-store call");
      });
      const unexpectedFetch = vi.fn(() => {
        throw new Error("unexpected network call");
      });
      vi.stubGlobal("fetch", unexpectedFetch);
      await registerIpcHandlers({
        store,
        runner: scenarioRunner,
        config: hybridConfig(),
        cloudCredentialStatus: statusService(unexpectedCredentialCall),
        hybridSimulationConsent: consent,
      });

      const challenge = (await handler(
        IPC_CHANNELS.issueHybridSimulationConsentChallenge,
      )(undefined, {
        workspaceRoot: workspaceA,
        route: HYBRID_SIMULATION_ROUTE,
      })) as { challengeId: string };
      const acknowledgement = {
        workspaceRoot: workspaceA,
        route: HYBRID_SIMULATION_ROUTE,
        challengeId: challenge.challengeId,
        acknowledged: true as const,
      };

      let invalidInput: Record<string, unknown> = acknowledgement;
      let removedWorkspace = workspaceA;
      let expectedError = /unknown or was already used/u;
      if (scenario === "unknown") {
        invalidInput = {
          ...acknowledgement,
          challengeId: "unknown-challenge-id",
        };
      } else if (scenario === "replayed") {
        await handler(IPC_CHANNELS.createChangeReviewSession)(
          undefined,
          acknowledgement,
        );
      } else if (scenario === "expired") {
        nowMs += 1_000;
        expectedError = /consent expired/u;
      } else if (scenario === "workspace_mismatch") {
        invalidInput = { ...acknowledgement, workspaceRoot: workspaceB };
        removedWorkspace = workspaceB;
        expectedError = /no longer matches this request/u;
      } else if (scenario === "unapproved_workspace") {
        invalidInput = { ...acknowledgement, workspaceRoot: workspaceB };
        removedWorkspace = workspaceB;
        expectedError = /Choose this workspace/u;
      } else if (scenario === "route_mismatch") {
        invalidInput = { ...acknowledgement, route: "local" };
        expectedError = /unrecognized_keys|challengeId/u;
      } else {
        invalidInput = {
          ...acknowledgement,
          challengeId: `  ${challenge.challengeId}  `,
          providerId: "forged-renderer-provider",
          model: "forged-renderer-model",
          campaignId: "forged-renderer-campaign",
          maxSimulatedSpendMicrousd: 1,
          pricingSnapshotId: "forged-renderer-pricing",
          endpoint: "https://forged.invalid/v1",
          egressConsent: "session_cloud_synthesis_v1",
        };
        expectedError = /unrecognized_keys|providerId/u;
      }

      const countsBefore = {
        sessions: store.listSessions().length,
        budgetRows: (
          database
            .prepare("SELECT COUNT(*) AS count FROM budget_ledger_entries")
            .get() as { count: number }
        ).count,
        runnerStarts: vi.mocked(scenarioRunner.startSession).mock.calls.length,
        providerValidations: vi.mocked(
          scenarioRunner.getLocalReviewProviderDescriptor,
        ).mock.calls.length,
        credentialCalls: unexpectedCredentialCall.mock.calls.length,
        fetchCalls: unexpectedFetch.mock.calls.length,
      };

      // The approved identity remains in main memory while its directory is
      // deliberately removed. A challenge-specific/schema error therefore
      // proves rejection happened before canonicalDirectory realpath/stat work.
      await rm(removedWorkspace, { recursive: true, force: true });
      await expect(
        handler(IPC_CHANNELS.createChangeReviewSession)(
          undefined,
          invalidInput,
        ) as Promise<unknown>,
      ).rejects.toThrow(expectedError);

      if (
        scenario === "extra_field" ||
        scenario === "unapproved_workspace" ||
        scenario === "route_mismatch"
      ) {
        if (scenario === "unapproved_workspace") {
          await rm(workspaceA, { recursive: true, force: true });
        }
        await expect(
          handler(IPC_CHANNELS.createChangeReviewSession)(
            undefined,
            acknowledgement,
          ) as Promise<unknown>,
        ).rejects.toThrow(/unknown or was already used/u);
      }

      expect({
        sessions: store.listSessions().length,
        budgetRows: (
          database
            .prepare("SELECT COUNT(*) AS count FROM budget_ledger_entries")
            .get() as { count: number }
        ).count,
        runnerStarts: vi.mocked(scenarioRunner.startSession).mock.calls.length,
        providerValidations: vi.mocked(
          scenarioRunner.getLocalReviewProviderDescriptor,
        ).mock.calls.length,
        credentialCalls: unexpectedCredentialCall.mock.calls.length,
        fetchCalls: unexpectedFetch.mock.calls.length,
      }).toEqual(countsBefore);
    }
  });

  it("burns an outstanding Hybrid challenge through main IPC before stale-ID reuse", async () => {
    const root = await createTemporaryRoot();
    const workspacePath = path.join(root, "workspace");
    await mkdir(workspacePath);
    const workspaceRoot = await realpath(workspacePath);
    const database = createSoarDatabase();
    databases.push(database);
    const store = new EventStore(database);
    store.createSession({
      title: "Workspace approval",
      objective: "Remember this selected workspace",
      workspaceRoot,
    });
    const consent = new HybridSimulationConsentChallengeStore({
      authority: hybridSimulationAuthority(),
      nowMs: () => HYBRID_TEST_NOW_MS,
      idFactory: () => "route-change-challenge",
    });
    const scenarioRunner = createScenarioRunner(
      "RM-01 VLM (deterministic test double)",
    );
    const unexpectedFetch = vi.fn(() => {
      throw new Error("unexpected network call");
    });
    vi.stubGlobal("fetch", unexpectedFetch);
    await registerIpcHandlers({
      store,
      runner: scenarioRunner,
      config: hybridConfig(),
      hybridSimulationConsent: consent,
    });

    const challenge = (await handler(
      IPC_CHANNELS.issueHybridSimulationConsentChallenge,
    )(undefined, {
      workspaceRoot,
      route: HYBRID_SIMULATION_ROUTE,
    })) as { challengeId: string };
    await expect(
      handler(IPC_CHANNELS.invalidateHybridSimulationConsentChallenges)(
        undefined,
      ),
    ).resolves.toBeUndefined();

    const countsBefore = {
      sessions: store.listSessions().length,
      budgetRows: (
        database
          .prepare("SELECT COUNT(*) AS count FROM budget_ledger_entries")
          .get() as { count: number }
      ).count,
      runnerStarts: vi.mocked(scenarioRunner.startSession).mock.calls.length,
      providerValidations: vi.mocked(
        scenarioRunner.getLocalReviewProviderDescriptor,
      ).mock.calls.length,
      fetchCalls: unexpectedFetch.mock.calls.length,
    };
    // A stale ID must fail before resolving or inspecting its removed path.
    await rm(workspaceRoot, { recursive: true, force: true });
    await expect(
      handler(IPC_CHANNELS.createChangeReviewSession)(undefined, {
        workspaceRoot,
        route: HYBRID_SIMULATION_ROUTE,
        challengeId: challenge.challengeId,
        acknowledged: true,
      }) as Promise<unknown>,
    ).rejects.toThrow(/unknown or was already used/u);
    expect({
      sessions: store.listSessions().length,
      budgetRows: (
        database
          .prepare("SELECT COUNT(*) AS count FROM budget_ledger_entries")
          .get() as { count: number }
      ).count,
      runnerStarts: vi.mocked(scenarioRunner.startSession).mock.calls.length,
      providerValidations: vi.mocked(
        scenarioRunner.getLocalReviewProviderDescriptor,
      ).mock.calls.length,
      fetchCalls: unexpectedFetch.mock.calls.length,
    }).toEqual(countsBefore);
  });

  it("rejects same-path directory replacement before session, ledger, provider, network, or evidence work", async () => {
    const root = await createTemporaryRoot();
    const workspacePath = path.join(root, "workspace");
    const originalWorkspacePath = path.join(root, "workspace-original");
    await mkdir(workspacePath);
    const workspaceRoot = await realpath(workspacePath);
    const database = createSoarDatabase();
    databases.push(database);
    const store = new EventStore(database);
    store.createSession({
      title: "Workspace approval",
      objective: "Remember this selected workspace",
      workspaceRoot,
    });
    const consent = new HybridSimulationConsentChallengeStore({
      authority: hybridSimulationAuthority(),
      nowMs: () => HYBRID_TEST_NOW_MS,
      idFactory: () => "same-path-replacement-challenge",
    });
    const scenarioRunner = createScenarioRunner(
      "RM-01 VLM (deterministic test double)",
    );
    const unexpectedFetch = vi.fn(() => {
      throw new Error("unexpected network call");
    });
    vi.stubGlobal("fetch", unexpectedFetch);
    await registerIpcHandlers({
      store,
      runner: scenarioRunner,
      config: hybridConfig(),
      hybridSimulationConsent: consent,
    });

    const challenge = (await handler(
      IPC_CHANNELS.issueHybridSimulationConsentChallenge,
    )(undefined, {
      workspaceRoot,
      route: HYBRID_SIMULATION_ROUTE,
    })) as { challengeId: string };
    await rename(workspaceRoot, originalWorkspacePath);
    await mkdir(workspaceRoot);

    await expect(
      handler(IPC_CHANNELS.createChangeReviewSession)(undefined, {
        workspaceRoot,
        route: HYBRID_SIMULATION_ROUTE,
        challengeId: challenge.challengeId,
        acknowledged: true,
      }) as Promise<unknown>,
    ).rejects.toThrow(/no longer matches this request/u);
    await expect(
      handler(IPC_CHANNELS.createChangeReviewSession)(undefined, {
        workspaceRoot,
        route: HYBRID_SIMULATION_ROUTE,
        challengeId: challenge.challengeId,
        acknowledged: true,
      }) as Promise<unknown>,
    ).rejects.toThrow(/unknown or was already used/u);

    expect(store.listSessions()).toHaveLength(1);
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM budget_ledger_entries")
        .get(),
    ).toEqual({ count: 0 });
    expect(scenarioRunner.startSession).not.toHaveBeenCalled();
    expect(scenarioRunner.getLocalReviewProviderDescriptor).not.toHaveBeenCalled();
    expect(unexpectedFetch).not.toHaveBeenCalled();
  });

  it("revalidates an open directory identity lease at synchronous session admission", async () => {
    const root = await createTemporaryRoot();
    const workspacePath = path.join(root, "workspace");
    const originalWorkspacePath = path.join(root, "workspace-original");
    await mkdir(workspacePath);
    const workspaceRoot = await realpath(workspacePath);
    const database = createSoarDatabase();
    databases.push(database);
    const store = new EventStore(database);
    store.createSession({
      title: "Workspace approval",
      objective: "Remember this selected workspace",
      workspaceRoot,
    });
    const consent = new HybridSimulationConsentChallengeStore({
      authority: hybridSimulationAuthority(),
      nowMs: () => HYBRID_TEST_NOW_MS,
      idFactory: () => "admission-race-challenge",
    });
    const originalConsume = consent.consume.bind(consent);
    vi.spyOn(consent, "consume").mockImplementationOnce(async (...args) => {
      const consumed = await originalConsume(...args);
      // Simulate replacement after the consent identity check but before IPC
      // can enter the synchronous ledger/session admission callback.
      await rename(workspaceRoot, originalWorkspacePath);
      await mkdir(workspaceRoot);
      return consumed;
    });
    const scenarioRunner = createScenarioRunner(
      "RM-01 VLM (deterministic test double)",
    );
    const unexpectedFetch = vi.fn(() => {
      throw new Error("unexpected network call");
    });
    vi.stubGlobal("fetch", unexpectedFetch);
    await registerIpcHandlers({
      store,
      runner: scenarioRunner,
      config: hybridConfig(),
      hybridSimulationConsent: consent,
    });

    const challenge = (await handler(
      IPC_CHANNELS.issueHybridSimulationConsentChallenge,
    )(undefined, {
      workspaceRoot,
      route: HYBRID_SIMULATION_ROUTE,
    })) as { challengeId: string };
    await expect(
      handler(IPC_CHANNELS.createChangeReviewSession)(undefined, {
        workspaceRoot,
        route: HYBRID_SIMULATION_ROUTE,
        challengeId: challenge.challengeId,
        acknowledged: true,
      }) as Promise<unknown>,
    ).rejects.toThrow(/workspace identity changed/u);

    expect(store.listSessions()).toHaveLength(1);
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM budget_ledger_entries")
        .get(),
    ).toEqual({ count: 0 });
    expect(scenarioRunner.startSession).not.toHaveBeenCalled();
    expect(scenarioRunner.getLocalReviewProviderDescriptor).not.toHaveBeenCalled();
    expect(unexpectedFetch).not.toHaveBeenCalled();
  });

  it("rejects an unready review runtime before creating or starting a session", async () => {
    const root = await createTemporaryRoot();
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const canonicalWorkspaceRoot = await realpath(workspaceRoot);
    const database = createSoarDatabase();
    databases.push(database);
    const store = new EventStore(database);
    store.createSession({
      title: "Workspace approval",
      objective: "Remember this selected workspace",
      workspaceRoot: canonicalWorkspaceRoot,
    });
    vi.mocked(runner.getLocalReviewProviderDescriptor).mockReturnValueOnce(
      undefined,
    );
    await registerIpcHandlers({ store, runner, config: config() });

    await expect(
      handler(IPC_CHANNELS.createChangeReviewSession)(undefined, {
        workspaceRoot,
        route: "local",
      }) as Promise<unknown>,
    ).rejects.toThrow(
      "The configured local provider cannot run structured change reviews.",
    );
    expect(store.listSessions()).toHaveLength(1);
    expect(runner.startSession).not.toHaveBeenCalled();
  });

  it("returns the created review snapshot without observing background completion", async () => {
    const root = await createTemporaryRoot();
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const canonicalWorkspaceRoot = await realpath(workspaceRoot);
    const database = createSoarDatabase();
    databases.push(database);
    const store = new EventStore(database);
    store.createSession({
      title: "Workspace approval",
      objective: "Remember this selected workspace",
      workspaceRoot: canonicalWorkspaceRoot,
    });
    const completionThen = vi.fn(() => {
      throw new Error("IPC awaited the background review completion.");
    });
    vi.mocked(runner.startSession).mockReturnValueOnce({
      then: completionThen,
    } as unknown as Promise<void>);
    await registerIpcHandlers({ store, runner, config: config() });

    const snapshot = (await handler(
      IPC_CHANNELS.createChangeReviewSession,
    )(undefined, { workspaceRoot, route: "local" })) as {
      id: string;
      status: string;
    };

    expect(snapshot.status).toBe("created");
    expect(runner.startSession).toHaveBeenCalledOnce();
    expect(runner.startSession).toHaveBeenCalledWith(snapshot.id);
    expect(completionThen).not.toHaveBeenCalled();
  });

  it("keeps review workspace authorization ahead of session creation", async () => {
    const root = await createTemporaryRoot();
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const database = createSoarDatabase();
    databases.push(database);
    const store = new EventStore(database);
    await registerIpcHandlers({ store, runner, config: config() });

    await expect(
      handler(IPC_CHANNELS.createChangeReviewSession)(undefined, {
        workspaceRoot,
        route: "local",
      }) as Promise<unknown>,
    ).rejects.toThrow(
      "Choose this workspace in SOAR before starting a review.",
    );
    expect(store.listSessions()).toEqual([]);
    expect(runner.startSession).not.toHaveBeenCalled();
  });

  it("does not trust a persisted path that now resolves through a symlink", async () => {
    const root = await createTemporaryRoot();
    const actualWorkspace = path.join(root, "actual-workspace");
    const historicalAlias = path.join(root, "historical-alias");
    await mkdir(actualWorkspace);
    await symlink(actualWorkspace, historicalAlias);

    const database = createSoarDatabase();
    databases.push(database);
    const store = new EventStore(database);
    // This simulates a stale or externally modified historical record. Normal
    // IPC creation always persists the canonical target instead.
    const stale = store.createSession({
      title: "Stale session",
      objective: "Do not grant from an alias",
      workspaceRoot: historicalAlias,
    });
    await registerIpcHandlers({ store, runner, config: config() });

    await expect(
      handler(IPC_CHANNELS.createSession)(undefined, {
        task: "Attempt silent reuse",
        workspaceRoot: historicalAlias,
        taskTrack: "repository-investigator-v1",
      }) as Promise<unknown>,
    ).rejects.toThrow("Choose this workspace in SOAR before starting a task.");
    expect(store.listSessions()).toHaveLength(1);
    await expect(
      handler(IPC_CHANNELS.getChangeReviewView)(undefined, stale.id) as Promise<unknown>,
    ).rejects.toThrow(
      "Choose this workspace in SOAR before reading its review state.",
    );
  });
});

describe("cloud credential status IPC boundary", () => {
  it("returns local review readiness without consulting credential status", async () => {
    const database = createSoarDatabase();
    databases.push(database);
    const unexpectedStatus = vi.fn(async () => {
      throw new Error("review readiness must not wait for credential status");
    });
    await registerIpcHandlers({
      store: new EventStore(database),
      runner,
      config: config(),
      cloudCredentialStatus: statusService(unexpectedStatus),
    });

    await expect(
      handler(IPC_CHANNELS.getReviewAvailability)(undefined),
    ).resolves.toMatchObject({
      local: { enabled: true, providerId: "local-vllm" },
      hybrid: {
        enabled: false,
        reason:
          "Cloud credential status does not enable Hybrid. Real cloud dispatch is locked in this build.",
        consent: "none",
      },
    });
    expect(unexpectedStatus).not.toHaveBeenCalled();
  });

  it("returns strict metadata only to the current top-level renderer", async () => {
    const database = createSoarDatabase();
    databases.push(database);
    const projected = cloudCredentialStatus({
      legacyStagedItem: {
        state: "present",
        reasonCode: "legacy_metadata_present",
      },
    });
    const getStatus = vi.fn().mockResolvedValue(projected);
    await registerIpcHandlers({
      store: new EventStore(database),
      runner,
      config: config(),
      cloudCredentialStatus: statusService(getStatus),
    });

    await expect(
      handler(IPC_CHANNELS.getCloudCredentialStatus)(trustedCredentialEvent),
    ).resolves.toEqual(projected);
    expect(getStatus).toHaveBeenCalledOnce();
    expect(JSON.stringify(projected)).not.toMatch(
      /credentialValue|authorization|leaseHandle|endpoint|modelSlug/u,
    );

    await expect(
      handler(IPC_CHANNELS.getCloudCredentialStatus)(trustedCredentialEvent, {
        credential: "must-not-be-accepted",
      }),
    ).rejects.toThrow("does not accept an input payload");
    expect(getStatus).toHaveBeenCalledOnce();
  });

  it("strict-parses primary and unavailable status sources at the IPC boundary", async () => {
    const database = createSoarDatabase();
    databases.push(database);
    const getStatus = vi.fn().mockResolvedValue({
      ...cloudCredentialStatus(),
      unexpectedDiagnostic: "SOAR_NATIVE_DETAIL_SENTINEL",
    });
    const getUnavailableStatus = vi.fn().mockReturnValue({
      ...cloudCredentialStatus(),
      unexpectedFallbackDiagnostic: "SOAR_NATIVE_FALLBACK_SENTINEL",
    });
    await registerIpcHandlers({
      store: new EventStore(database),
      runner,
      config: config(),
      cloudCredentialStatus: { getStatus, getUnavailableStatus },
    });

    const result = await handler(IPC_CHANNELS.getCloudCredentialStatus)(
      trustedCredentialEvent,
    );
    expect(result).toMatchObject({
      build: {
        state: "eligibility_unknown",
        reasonCode: "identity_check_unavailable",
      },
      dispatch: { state: "locked" },
      latestOperation: { state: "none" },
    });
    expect(JSON.stringify(result)).not.toContain("SOAR_NATIVE_DETAIL_SENTINEL");
    expect(JSON.stringify(result)).not.toContain(
      "SOAR_NATIVE_FALLBACK_SENTINEL",
    );
    expect(getUnavailableStatus).toHaveBeenCalledOnce();
  });

  it("rejects foreign WebContents, subframes, and URL mismatch before status access", async () => {
    const database = createSoarDatabase();
    databases.push(database);
    const getStatus = vi.fn().mockResolvedValue(cloudCredentialStatus());
    await registerIpcHandlers({
      store: new EventStore(database),
      runner,
      config: config(),
      cloudCredentialStatus: statusService(getStatus),
    });

    const sameUrlForeignFrame = { url: TEST_RENDERER_URL };
    const sameUrlForeignContents = {
      mainFrame: sameUrlForeignFrame,
      getURL: () => TEST_RENDERER_URL,
      isDestroyed: () => false,
    };
    const hostilePayload = {
      credential: "SOAR_FOREIGN_RENDERER_SECRET_SENTINEL",
    };
    for (const event of [
      {
        sender: sameUrlForeignContents,
        senderFrame: sameUrlForeignFrame,
      },
      {
        sender: trustedCredentialWebContents,
        senderFrame: { url: TEST_RENDERER_URL },
      },
    ]) {
      await expect(
        handler(IPC_CHANNELS.getCloudCredentialStatus)(event, hostilePayload),
      ).rejects.toThrow(
        "Cloud credential status is unavailable from this renderer.",
      );
    }

    const wrongUrlAuthority = {
      ...trustedCredentialIpcAuthority,
      expectedRendererUrl: "file:///foreign/renderer.html",
    };
    electron.handlers.clear();
    await registerIpcHandlers({
      store: new EventStore(database),
      runner,
      config: config(),
      credentialIpcAuthority: wrongUrlAuthority,
      cloudCredentialStatus: statusService(getStatus),
    });
    await expect(
      handler(IPC_CHANNELS.getCloudCredentialStatus)(
        trustedCredentialEvent,
        hostilePayload,
      ),
    ).rejects.toThrow(
      "Cloud credential status is unavailable from this renderer.",
    );
    expect(getStatus).not.toHaveBeenCalled();
  });

  it("has no renderer IPC channel for staged credential mutation", async () => {
    const database = createSoarDatabase();
    databases.push(database);
    await registerIpcHandlers({
      store: new EventStore(database),
      runner,
      config: config(),
    });

    expect(IPC_CHANNELS).not.toHaveProperty("saveCloudCredential");
    expect(IPC_CHANNELS).not.toHaveProperty("deleteCloudCredential");
    expect(electron.handlers.has("soar:save-cloud-credential")).toBe(false);
    expect(electron.handlers.has("soar:delete-cloud-credential")).toBe(false);
  });

  it("fails closed with metadata-only status when the authority is unavailable", async () => {
    const database = createSoarDatabase();
    databases.push(database);
    await registerIpcHandlers({
      store: new EventStore(database),
      runner,
      config: config(),
    });

    await expect(
      handler(IPC_CHANNELS.getCloudCredentialStatus)(trustedCredentialEvent),
    ).resolves.toMatchObject({
      schemaVersion: "cloud-credential-status-v1",
      build: {
        state: "eligibility_unknown",
        reasonCode: "identity_check_unavailable",
      },
      protectedItem: { state: "unknown", reasonCode: "activation_locked" },
      providerCheck: { state: "not_run" },
      dispatch: { state: "locked", reasonCode: "pr6b1_phase_b_locked" },
      providerContact: { state: "not_contacted" },
      latestOperation: { state: "none" },
    });
  });

  it("preserves an unresolved operation when native status projection fails", async () => {
    const database = createSoarDatabase();
    databases.push(database);
    const unavailableStatus = cloudCredentialStatus({
      build: {
        state: "eligibility_unknown",
        reasonCode: "identity_check_unavailable",
      },
      legacyStagedItem: {
        state: "unknown",
        reasonCode: "legacy_metadata_unavailable",
      },
      latestOperation: {
        state: "outcome_unknown",
        kind: "replace_protected",
        recoveryCode: "manual_recovery_required",
      },
    });
    const getStatus = vi.fn().mockRejectedValue(new Error("native failure"));
    const getUnavailableStatus = vi.fn().mockReturnValue(unavailableStatus);
    await registerIpcHandlers({
      store: new EventStore(database),
      runner,
      config: config(),
      cloudCredentialStatus: {
        getStatus,
        getUnavailableStatus,
      },
    });

    await expect(
      handler(IPC_CHANNELS.getCloudCredentialStatus)(trustedCredentialEvent),
    ).resolves.toEqual(unavailableStatus);
    expect(getStatus).toHaveBeenCalledOnce();
    expect(getUnavailableStatus).toHaveBeenCalledOnce();
  });
});
