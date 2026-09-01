import path from "node:path";

import { app, BrowserWindow } from "electron";

import { SessionRunner, type RuntimeUpdate } from "./agent/run-session";
import { CloudCredentialStatusService } from "./cloud-credential-service";
import { withFakeCredentialOperationStatus } from "./cloud-credential-status-test-fixture";
import { loadConfig } from "./config";
import { createCredentialLeaseAuthority } from "./credentials/native-credential-lease-broker";
import { CredentialOperationJournal } from "./credentials/credential-operation-journal";
import { createSoarDatabase, type SoarDatabase } from "./database";
import { EventStore } from "./event-store";
import {
  assertHybridSimulationRuntimeV1,
  hybridSimulationAuthoritySnapshotV1,
} from "./hybrid-simulation-runtime";
import { HybridSimulationConsentChallengeStore } from "./hybrid-simulation-consent";
import {
  registerIpcHandlers,
  type CredentialIpcAuthority,
} from "./ipc";
import { recoverRunningSessions } from "./recovery";
import { toRendererSessionUpdate } from "./session-view";
import {
  installRendererNavigationPolicy,
  resolvePreloadPath,
  resolveRendererTarget,
  type RendererTarget,
} from "./window-security";
import { createRuntimeProviderCatalog } from "./providers/runtime-catalog";
import { IPC_CHANNELS } from "../shared/contracts";

export interface BootstrapController {
  close(): void;
}

function createWindowShell(
  target: RendererTarget,
  preloadPath: string,
): BrowserWindow {
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
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });
  installRendererNavigationPolicy(window.webContents, target.expectedUrl);
  window.once("ready-to-show", () => window.show());
  return window;
}

async function loadRenderer(
  window: BrowserWindow,
  target: RendererTarget,
): Promise<void> {
  // One URL value is both loaded and admitted by credential IPC.
  await window.loadURL(target.expectedUrl);
}

function publish(store: EventStore, update: RuntimeUpdate): void {
  const payload = toRendererSessionUpdate(store, update);
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.sessionUpdate, payload);
    }
  }
}

/** Called only by the primary process after app readiness and lock admission. */
export async function bootstrap(): Promise<BootstrapController> {
  let database: SoarDatabase | undefined;
  let unregisterIpc: (() => void) | undefined;
  let mainWindow: BrowserWindow | undefined;
  let disposed = false;

  const rendererTarget = resolveRendererTarget({
    isPackaged: app.isPackaged,
    // app.getAppPath() is stable even though this module is emitted as a
    // code-split chunk under out/main/chunks in production.
    applicationPath: app.getAppPath(),
    ...(!app.isPackaged && process.env.ELECTRON_RENDERER_URL !== undefined
      ? { developmentUrl: process.env.ELECTRON_RENDERER_URL }
      : {}),
  });
  const preloadPath = resolvePreloadPath(app.getAppPath());
  const credentialIpcAuthority: CredentialIpcAuthority = Object.freeze({
    expectedRendererUrl: rendererTarget.expectedUrl,
    currentWindow: () => mainWindow,
  });

  const openWindow = async (): Promise<void> => {
    if (disposed || mainWindow !== undefined) return;
    const window = createWindowShell(rendererTarget, preloadPath);
    mainWindow = window;
    window.once("closed", () => {
      if (mainWindow === window) mainWindow = undefined;
    });
    try {
      await loadRenderer(window, rendererTarget);
    } catch (error) {
      if (mainWindow === window) mainWindow = undefined;
      if (!window.isDestroyed()) window.destroy();
      throw error;
    }
  };

  const activate = (): void => {
    if (mainWindow !== undefined || disposed) return;
    void openWindow().catch((error: unknown) => {
      console.error("SOAR could not recreate its main window", error);
    });
  };

  try {
    const userDataPath = app.getPath("userData");
    const config = loadConfig({
      appPath: app.getAppPath(),
      userDataPath,
    });
    const databasePath =
      config.databasePath ?? path.join(userDataPath, "soar.sqlite");
    database = createSoarDatabase(databasePath);
    const store = new EventStore(database);
    recoverRunningSessions(store);
    const credentialOperationJournal = new CredentialOperationJournal(database);
    // A prior process can disappear after securityd accepted a request but
    // before its observer recorded completion. Reconcile persisted journal
    // state before status IPC or renderer code can observe it.
    credentialOperationJournal.recoverAfterRestart();

    const credentialAuthority = createCredentialLeaseAuthority({
      deterministicFake: config.providerMode === "fake",
    });
    const baseCloudCredentialStatus = new CloudCredentialStatusService(
      credentialAuthority,
      credentialOperationJournal,
    );
    const cloudCredentialStatus = withFakeCredentialOperationStatus({
      base: baseCloudCredentialStatus,
      providerMode: config.providerMode,
      testWorkspace: config.testWorkspace,
      fixture: config.testCredentialOperationState,
      packagedRuntime: app.isPackaged,
    });
    const providerCatalog = createRuntimeProviderCatalog(config);
    const hybridSimulationConsent =
      providerCatalog.hybridSimulationRuntime === undefined
        ? undefined
        : new HybridSimulationConsentChallengeStore({
            authority: hybridSimulationAuthoritySnapshotV1(
              providerCatalog.hybridSimulationRuntime,
              assertHybridSimulationRuntimeV1({
                runtime: providerCatalog.hybridSimulationRuntime,
                providerRegistry: providerCatalog.registry,
                defaultLocalProviderId: providerCatalog.defaultLocalProviderId,
              }),
            ),
          });
    const runner = new SessionRunner({
      store,
      providerRegistry: providerCatalog.registry,
      defaultLocalProviderId: providerCatalog.defaultLocalProviderId,
      ...(providerCatalog.hybridSimulationRuntime === undefined
        ? {}
        : { hybridSimulationRuntime: providerCatalog.hybridSimulationRuntime }),
      limits: config.limits,
      context: config.context,
      localReviewSensitiveValues: [
        ...(config.vllm.sensitiveApiKey === undefined
          ? []
          : [config.vllm.sensitiveApiKey]),
        config.vllm.baseUrl,
      ],
      onUpdate: (update) => publish(store, update),
    });

    // Create without loading; install exact IPC authority before renderer code.
    mainWindow = createWindowShell(rendererTarget, preloadPath);
    const initialWindow = mainWindow;
    initialWindow.once("closed", () => {
      if (mainWindow === initialWindow) mainWindow = undefined;
    });
    unregisterIpc = await registerIpcHandlers({
      store,
      runner,
      config,
      credentialIpcAuthority,
      cloudCredentialStatus,
      ...(hybridSimulationConsent === undefined
        ? {}
        : { hybridSimulationConsent }),
    });
    await loadRenderer(initialWindow, rendererTarget);
    app.on("activate", activate);

    return Object.freeze({
      close(): void {
        if (disposed) return;
        disposed = true;
        app.removeListener("activate", activate);
        unregisterIpc?.();
        unregisterIpc = undefined;
        if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
          mainWindow.destroy();
        }
        mainWindow = undefined;
        database?.close();
        database = undefined;
      },
    });
  } catch (error) {
    disposed = true;
    unregisterIpc?.();
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
    }
    database?.close();
    throw error;
  }
}
