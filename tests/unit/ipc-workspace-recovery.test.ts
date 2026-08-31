import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
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
import { CloudCredentialSetupService } from "../../src/main/cloud-credential-service";
import type { SoarConfig } from "../../src/main/config";
import { createSoarDatabase, type SoarDatabase } from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";
import { registerIpcHandlers } from "../../src/main/ipc";
import type { SetupOnlyCredentialStore } from "../../src/main/providers/macos-keychain-credential-store";
import {
  createSessionInputSchema,
  IPC_CHANNELS,
} from "../../src/shared/contracts";

const temporaryDirectories: string[] = [];
const databases: SoarDatabase[] = [];

function config(): SoarConfig {
  return {
    providerMode: "local",
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

const runner = {
  startSession: vi.fn().mockResolvedValue(undefined),
  cancelSession: vi.fn(),
  getLocalReviewProviderDescriptor: vi.fn().mockReturnValue({
    id: "local-vllm",
    model: "local-review-model",
  }),
} as unknown as SessionRunner;

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
          "Cloud setup does not enable Hybrid. Hybrid dispatch is locked in this build.",
        separatelyConfiguredPaidProviderReachable: false,
        reachabilitySummary:
          "This build performs no cloud-provider validation or dispatch.",
        consent: "none",
      },
    });

    const snapshot = (await handler(
      IPC_CHANNELS.createChangeReviewSession,
    )(undefined, { workspaceRoot })) as { id: string };
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
    const setupStore: SetupOnlyCredentialStore = {
      status: unexpectedSetupCall,
      has: unexpectedSetupCall,
      write: unexpectedSetupCall,
      replace: unexpectedSetupCall,
      delete: unexpectedSetupCall,
    };
    const unexpectedFetch = vi.fn(() => {
      throw new Error("unexpected network call");
    });
    vi.stubGlobal("fetch", unexpectedFetch);
    await registerIpcHandlers({
      store,
      runner,
      config: config(),
      cloudCredentialSetup: new CloudCredentialSetupService(setupStore),
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
    )(undefined, { workspaceRoot })) as { id: string; status: string };

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

describe("cloud setup IPC boundary", () => {
  it("returns local review readiness without consulting Keychain status", async () => {
    const database = createSoarDatabase();
    databases.push(database);
    const unexpectedStatus = vi.fn(async () => {
      throw new Error("review readiness must not wait for Keychain");
    });
    const setupStore: SetupOnlyCredentialStore = {
      status: unexpectedStatus,
      has: unexpectedStatus,
      write: vi.fn(),
      replace: vi.fn(),
      delete: vi.fn(),
    };
    await registerIpcHandlers({
      store: new EventStore(database),
      runner,
      config: config(),
      cloudCredentialSetup: new CloudCredentialSetupService(setupStore),
    });

    await expect(
      handler(IPC_CHANNELS.getReviewAvailability)(undefined),
    ).resolves.toMatchObject({
      local: { enabled: true, providerId: "local-vllm" },
      hybrid: {
        enabled: false,
        reason:
          "Cloud setup does not enable Hybrid. Hybrid dispatch is locked in this build.",
        consent: "none",
      },
    });
    expect(unexpectedStatus).not.toHaveBeenCalled();
  });

  it("accepts only a bounded credential and returns metadata while Hybrid stays locked", async () => {
    const database = createSoarDatabase();
    databases.push(database);
    const store = new EventStore(database);
    let stored = false;
    const replace = vi.fn(async () => {
      stored = true;
    });
    const remove = vi.fn(async () => {
      const existed = stored;
      stored = false;
      return existed;
    });
    const setupStore: SetupOnlyCredentialStore = {
      status: vi.fn(async () => ({
        state: stored ? ("stored" as const) : ("not_stored" as const),
      })),
      has: vi.fn(async () => stored),
      write: vi.fn(async () => {
        stored = true;
      }),
      replace,
      delete: remove,
    };
    await registerIpcHandlers({
      store,
      runner,
      config: config(),
      cloudCredentialSetup: new CloudCredentialSetupService(setupStore),
    });

    await expect(
      handler(IPC_CHANNELS.getCloudSetupStatus)(undefined),
    ).resolves.toMatchObject({
      state: "not_configured",
      candidate: {
        providerLabel: "OpenRouter",
        modelLabel: "DeepSeek V4 Flash",
      },
      dispatch: { state: "locked", reasonCode: "pr6a_dispatch_locked" },
    });
    await expect(
      handler(IPC_CHANNELS.getCloudSetupStatus)(undefined, {
        credential: "must-not-be-accepted",
      }),
    ).rejects.toThrow("does not accept an input payload");

    const secret = "SOAR_SYNTHETIC_IPC_CREDENTIAL_SENTINEL";
    const secretAsUnknownKey =
      "SOAR_SYNTHETIC_IPC_SECRET_AS_PROPERTY_NAME_SENTINEL";
    const rejectedWrite = await handler(
      IPC_CHANNELS.saveCloudCredential,
    )(undefined, {
      credential: secret,
      [secretAsUnknownKey]: true,
    });
    expect(rejectedWrite).toMatchObject({
      state: "local_storage_error",
      errorCode: "invalid_credential",
      dispatch: { state: "locked", reasonCode: "pr6a_dispatch_locked" },
    });
    expect(JSON.stringify(rejectedWrite)).not.toContain(secret);
    expect(JSON.stringify(rejectedWrite)).not.toContain(secretAsUnknownKey);
    expect(replace).not.toHaveBeenCalled();

    const saved = await handler(IPC_CHANNELS.saveCloudCredential)(undefined, {
      credential: secret,
    });
    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith(secret);
    expect(saved).toMatchObject({
      state: "stored_unvalidated",
      candidate: {
        providerLabel: "OpenRouter",
        modelLabel: "DeepSeek V4 Flash",
      },
      dispatch: { state: "locked", reasonCode: "pr6a_dispatch_locked" },
    });
    expect(JSON.stringify(saved)).not.toContain(secret);
    expect(JSON.stringify(saved)).not.toContain("candidateId");
    expect(JSON.stringify(saved)).not.toContain("intendedModelSlug");
    expect(
      JSON.stringify({
        sessions: database.prepare("SELECT * FROM sessions").all(),
        events: database.prepare("SELECT * FROM session_events").all(),
        budget: database
          .prepare("SELECT * FROM budget_ledger_entries")
          .all(),
      }),
    ).not.toContain(secret);

    await expect(
      handler(IPC_CHANNELS.getReviewAvailability)(undefined),
    ).resolves.toMatchObject({
      hybrid: {
        enabled: false,
        reason:
          "Cloud setup does not enable Hybrid. Hybrid dispatch is locked in this build.",
        separatelyConfiguredPaidProviderReachable: false,
        consent: "none",
      },
    });

    await expect(
      handler(IPC_CHANNELS.deleteCloudCredential)(undefined),
    ).resolves.toMatchObject({
      state: "not_configured",
      dispatch: { state: "locked" },
    });
    expect(remove).toHaveBeenCalledOnce();
    await expect(
      handler(IPC_CHANNELS.deleteCloudCredential)(undefined, {
        credential: "must-not-be-accepted",
      }),
    ).rejects.toThrow("does not accept an input payload");
    expect(remove).toHaveBeenCalledOnce();
  });

  it("rejects concurrent credential mutations before another IPC secret reaches the store", async () => {
    const database = createSoarDatabase();
    databases.push(database);
    const store = new EventStore(database);
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const replace = vi.fn((_credential: string) => firstPending);
    const remove = vi.fn().mockResolvedValue(false);
    const setupStore: SetupOnlyCredentialStore = {
      status: vi.fn().mockResolvedValue({ state: "not_stored" }),
      has: vi.fn().mockResolvedValue(false),
      write: vi.fn().mockResolvedValue(undefined),
      replace,
      delete: remove,
    };
    await registerIpcHandlers({
      store,
      runner,
      config: config(),
      cloudCredentialSetup: new CloudCredentialSetupService(setupStore),
    });
    const accepted = "SOAR_IPC_ACCEPTED_MUTATION_SENTINEL";
    const rejected = "SOAR_IPC_REJECTED_MUTATION_SENTINEL";

    const first = handler(IPC_CHANNELS.saveCloudCredential)(undefined, {
      credential: accepted,
    }) as Promise<unknown>;
    await vi.waitFor(() => expect(replace).toHaveBeenCalledOnce());

    const blockedSave = await handler(IPC_CHANNELS.saveCloudCredential)(
      undefined,
      { credential: rejected },
    );
    const blockedDelete = await handler(IPC_CHANNELS.deleteCloudCredential)(
      undefined,
    );

    for (const result of [blockedSave, blockedDelete]) {
      expect(result).toMatchObject({
        state: "local_storage_error",
        errorCode: "operation_in_progress",
        dispatch: { state: "locked", reasonCode: "pr6a_dispatch_locked" },
      });
      expect(JSON.stringify(result)).not.toContain(rejected);
    }
    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith(accepted);
    expect(remove).not.toHaveBeenCalled();
    expect(JSON.stringify(replace.mock.calls)).not.toContain(rejected);

    releaseFirst();
    await expect(first).resolves.toMatchObject({ state: "stored_unvalidated" });
    await expect(
      handler(IPC_CHANNELS.deleteCloudCredential)(undefined),
    ).resolves.toMatchObject({ state: "not_configured" });
    expect(remove).toHaveBeenCalledOnce();
  });

  it("fails closed with metadata-only storage status when setup is unavailable", async () => {
    const database = createSoarDatabase();
    databases.push(database);
    await registerIpcHandlers({
      store: new EventStore(database),
      runner,
      config: config(),
    });

    const results = await Promise.all([
      handler(IPC_CHANNELS.getCloudSetupStatus)(undefined),
      handler(IPC_CHANNELS.saveCloudCredential)(undefined, {
        credential: "synthetic-unavailable-value",
      }),
      handler(IPC_CHANNELS.deleteCloudCredential)(undefined),
    ]);
    for (const result of results) {
      expect(result).toMatchObject({
        state: "local_storage_error",
        errorCode: "keychain_unavailable",
        dispatch: { state: "locked", reasonCode: "pr6a_dispatch_locked" },
      });
      expect(JSON.stringify(result)).not.toContain("synthetic-unavailable-value");
    }
  });
});
