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
import type { SoarConfig } from "../../src/main/config";
import { createSoarDatabase, type SoarDatabase } from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";
import { registerIpcHandlers } from "../../src/main/ipc";
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

    expect(handler(IPC_CHANNELS.getReviewAvailability)(undefined)).toEqual({
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
        reason: "Cloud setup is not available in this build.",
        separatelyConfiguredPaidProviderReachable: false,
        reachabilitySummary:
          "No separately configured paid provider is available in this build.",
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
