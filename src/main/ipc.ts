import { stat, realpath } from "node:fs/promises";
import path from "node:path";

import { dialog, ipcMain } from "electron";

import {
  IPC_CHANNELS,
  createSessionInputSchema,
  sessionIdSchema,
  type WorkspaceSelection,
} from "../shared/contracts";
import type { SoarConfig } from "./config";
import { EventStore } from "./event-store";
import { SessionRunner } from "./agent/run-session";
import { toSessionSnapshot, toSessionSummary } from "./session-view";

export interface RegisterIpcOptions {
  store: EventStore;
  runner: SessionRunner;
  config: SoarConfig;
}

async function canonicalDirectory(candidate: string): Promise<string> {
  const canonical = await realpath(candidate);
  const metadata = await stat(canonical);
  if (!metadata.isDirectory()) throw new Error("The selected workspace is not a directory.");
  return canonical;
}

function titleFromTask(task: string): string {
  const firstLine = task.split(/\r?\n/u, 1)[0].replace(/\s+/gu, " ").trim();
  if (firstLine.length <= 56) return firstLine;
  return `${firstLine.slice(0, 53).trimEnd()}...`;
}

async function restorePersistedWorkspaceApprovals(
  store: EventStore,
  approvedWorkspaces: Set<string>,
): Promise<void> {
  for (const session of store.listSessions({ limit: 1_000 })) {
    const recordedRoot = path.resolve(session.workspaceRoot);
    try {
      const canonicalRoot = await canonicalDirectory(recordedRoot);
      // Session roots are canonicalized before persistence. Refuse a root that
      // has since become a symlink to a different directory.
      if (canonicalRoot === recordedRoot) {
        approvedWorkspaces.add(canonicalRoot);
      }
    } catch {
      // Missing or inaccessible historical workspaces stay unapproved until
      // the user explicitly selects a directory again.
    }
  }
}

export async function registerIpcHandlers({
  store,
  runner,
  config,
}: RegisterIpcOptions): Promise<() => void> {
  const approvedWorkspaces = new Set<string>();

  await restorePersistedWorkspaceApprovals(store, approvedWorkspaces);

  if (config.providerMode === "fake" && config.testWorkspace) {
    approvedWorkspaces.add(await canonicalDirectory(config.testWorkspace));
  }

  ipcMain.handle(IPC_CHANNELS.chooseWorkspace, async (): Promise<WorkspaceSelection | null> => {
    if (config.providerMode === "fake" && config.testWorkspace) {
      const workspacePath = await canonicalDirectory(config.testWorkspace);
      approvedWorkspaces.add(workspacePath);
      return { path: workspacePath, name: path.basename(workspacePath) };
    }

    const result = await dialog.showOpenDialog({
      title: "Choose a workspace",
      buttonLabel: "Use workspace",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const workspacePath = await canonicalDirectory(result.filePaths[0]);
    approvedWorkspaces.add(workspacePath);
    return { path: workspacePath, name: path.basename(workspacePath) };
  });

  ipcMain.handle(IPC_CHANNELS.createSession, async (_event, rawInput: unknown) => {
    const input = createSessionInputSchema.parse(rawInput);
    const workspaceRoot = await canonicalDirectory(input.workspaceRoot);
    if (!approvedWorkspaces.has(workspaceRoot)) {
      throw new Error("Choose this workspace in SOAR before starting a task.");
    }
    const session = store.createSession({
      title: titleFromTask(input.task),
      objective: input.task,
      workspaceRoot,
      profile: "balanced",
    });
    return toSessionSnapshot(store, session.id);
  });

  ipcMain.handle(IPC_CHANNELS.listSessions, () =>
    store.listSessions({ limit: 200 }).map(toSessionSummary),
  );

  ipcMain.handle(IPC_CHANNELS.getSession, (_event, rawId: unknown) => {
    const sessionId = sessionIdSchema.parse(rawId);
    return toSessionSnapshot(store, sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.startSession, (_event, rawId: unknown) => {
    const sessionId = sessionIdSchema.parse(rawId);
    void runner.startSession(sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.cancelSession, (_event, rawId: unknown) => {
    const sessionId = sessionIdSchema.parse(rawId);
    runner.cancelSession(sessionId);
  });

  return () => {
    for (const channel of Object.values(IPC_CHANNELS)) {
      if (channel !== IPC_CHANNELS.sessionUpdate) ipcMain.removeHandler(channel);
    }
  };
}
