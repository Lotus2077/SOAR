import path from "node:path";

import { app, BrowserWindow, dialog } from "electron";

import { SessionRunner, type RuntimeUpdate } from "./agent/run-session";
import { loadConfig } from "./config";
import { createSoarDatabase, type SoarDatabase } from "./database";
import { EventStore } from "./event-store";
import { registerIpcHandlers } from "./ipc";
import { FakeProvider } from "./providers/fake-provider";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";
import type { InferenceProvider } from "./providers/types";
import { recoverRunningSessions } from "./recovery";
import { toSessionSnapshot } from "./session-view";
import { IPC_CHANNELS, type SessionUpdate } from "../shared/contracts";

let database: SoarDatabase | undefined;
let unregisterIpc: (() => void) | undefined;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1_420,
    height: 900,
    minWidth: 760,
    minHeight: 560,
    show: false,
    backgroundColor: "#f8faff",
    title: "SOAR",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    const currentUrl = window.webContents.getURL();
    if (currentUrl && new URL(targetUrl).origin !== new URL(currentUrl).origin) {
      event.preventDefault();
    }
  });
  window.once("ready-to-show", () => window.show());

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  return window;
}

function publish(store: EventStore, update: RuntimeUpdate): void {
  const payload: SessionUpdate =
    update.kind === "stream"
      ? update
      : {
          sessionId: update.sessionId,
          kind: "snapshot",
          snapshot: toSessionSnapshot(store, update.sessionId),
        };

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.sessionUpdate, payload);
  }
}

async function bootstrap(): Promise<void> {
  const userDataPath = app.getPath("userData");
  const config = loadConfig({
    appPath: app.getAppPath(),
    userDataPath,
  });
  const databasePath = config.databasePath ?? path.join(userDataPath, "soar.sqlite");
  database = createSoarDatabase(databasePath);
  const store = new EventStore(database);
  recoverRunningSessions(store);

  const provider: InferenceProvider =
    config.providerMode === "fake"
      ? new FakeProvider({ delayMs: config.fakeDelayMs })
      : new OpenAICompatibleProvider(config.vllm);
  const runner = new SessionRunner({
    store,
    provider,
    limits: config.limits,
    onUpdate: (update) => publish(store, update),
  });

  unregisterIpc = await registerIpcHandlers({ store, runner, config });
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

function startupErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : "An unknown startup error occurred.";
  const redacted = detail.replace(/sk-[A-Za-z0-9_-]{12,}/gu, "[redacted]").slice(0, 2_000);
  return `SOAR could not finish starting.\n\n${redacted}\n\nCheck the app configuration and try again.`;
}

app.whenReady().then(bootstrap).catch((error: unknown) => {
  console.error("SOAR failed to start", error);
  try {
    dialog.showErrorBox("SOAR could not start", startupErrorMessage(error));
  } catch (dialogError) {
    console.error("SOAR could not show its startup error dialog", dialogError);
  }
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" || process.env.SOAR_PROVIDER_MODE === "fake") app.quit();
});

app.on("will-quit", () => {
  unregisterIpc?.();
  database?.close();
});
