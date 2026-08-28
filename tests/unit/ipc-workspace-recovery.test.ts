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
import { IPC_CHANNELS } from "../../src/shared/contracts";

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
      maxOutputTokens: 1_024,
      timeoutMs: 30_000,
    },
    limits: { inferenceRounds: 4, toolCalls: 8 },
    context: { maxInputTokens: 8_192, safetyMargin: 0.2 },
  };
}

const runner = {
  startSession: vi.fn(),
  cancelSession: vi.fn(),
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

    const snapshot = await handler(IPC_CHANNELS.createSession)(undefined, {
      task: "Run a second task without opening the picker",
      workspaceRoot,
    });

    expect(snapshot).toMatchObject({
      workspaceRoot: canonicalWorkspaceRoot,
      status: "created",
    });
    expect(reopenedStore.listSessions()).toHaveLength(2);
    expect(electron.dialog.showOpenDialog).not.toHaveBeenCalled();
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
    store.createSession({
      title: "Stale session",
      objective: "Do not grant from an alias",
      workspaceRoot: historicalAlias,
    });
    await registerIpcHandlers({ store, runner, config: config() });

    await expect(
      handler(IPC_CHANNELS.createSession)(undefined, {
        task: "Attempt silent reuse",
        workspaceRoot: historicalAlias,
      }) as Promise<unknown>,
    ).rejects.toThrow("Choose this workspace in SOAR before starting a task.");
    expect(store.listSessions()).toHaveLength(1);
  });
});
