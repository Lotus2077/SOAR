import { app, BrowserWindow, dialog } from "electron";
import { loadEnvironmentFiles } from "./config";
import { startQuit } from "./liveness";
import { decideUserDataFolder, type UserDataFolder } from "./user-data-folder";

import type { BootstrapController } from "./bootstrap";

let controller: BootstrapController | undefined;

function startupErrorMessage(error: unknown): string {
  const detail =
    error instanceof Error ? error.message : "An unknown startup error occurred.";
  const redacted = detail
    .replace(/sk-[A-Za-z0-9_-]{12,}/gu, "[redacted]")
    .slice(0, 2_000);
  return `SOAR could not finish starting.\n\n${redacted}\n\nCheck the app configuration and try again.`;
}

/**
 * Backlog item 13a, requirement A: the user-data folder is the first decision. Electron keeps the single-instance lock in it, so it
 * is chosen before that lock and before any setting or database there is opened, from the settings readable without it
 * (user-data-folder.ts). A refusal takes no lock and starts nothing.
 */
function chooseUserDataFolder(): UserDataFolder {
  let folder: UserDataFolder;
  try {
    folder = decideUserDataFolder(loadEnvironmentFiles({ appPath: app.getAppPath() }).SOAR_ENABLE_LOCAL_RESEARCH_BETA, app.getPath("userData"));
  } catch {
    return { kind: "refused", reason: "SOAR could not read the settings that choose its user-data folder." };
  }
  if (folder.kind !== "beta") return folder;
  app.setPath("userData", folder.path);
  app.setPath("sessionData", folder.path);
  return app.getPath("userData") === folder.path && app.getPath("sessionData") === folder.path ? folder
    : { kind: "refused", reason: "The local research beta could not move to its own user-data folder." };
}
const userDataFolder = chooseUserDataFolder();

// After the folder's own move, the lock is the first mutable app decision. The bootstrap module (and therefore
// SQLite and every credential/native module) is imported only after the
// primary process owns Electron's single-instance lock.
const primaryInstance = userDataFolder.kind !== "refused" && app.requestSingleInstanceLock();
if (userDataFolder.kind === "refused") {
  dialog.showErrorBox("SOAR could not start", startupErrorMessage(new Error(userDataFolder.reason)));
  app.quit();
} else if (!primaryInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  app
    .whenReady()
    .then(async () => {
      const { bootstrap } = await import("./bootstrap");
      controller = await bootstrap({ userDataFolder });
    })
    .catch((error: unknown) => {
      console.error("SOAR failed to start", error);
      try {
        dialog.showErrorBox("SOAR could not start", startupErrorMessage(error));
      } catch (dialogError) {
        console.error("SOAR could not show its startup error dialog", dialogError);
      }
      app.quit();
    });

  app.on("window-all-closed", () => {
    if (
      process.platform !== "darwin" ||
      process.env.SOAR_PROVIDER_MODE === "fake"
    ) {
      app.quit();
    }
  });

  let quitting: ReturnType<typeof startQuit> | undefined, quitHost: BrowserWindow | undefined;
  /**
   * A visible window for the quit offer, so it is a sheet: a box without a visible parent is a synchronous modal on
   * macOS that would hold the main loop the task needs to reach its pause. The open window is restored and shown;
   * with none (closed on macOS), a small host window carries the offer until the quit.
   */
  const quitOfferParent = (): BrowserWindow => {
    const open = BrowserWindow.getAllWindows().find(item => !item.isDestroyed() && item !== quitHost);
    const window = open ?? (quitHost !== undefined && !quitHost.isDestroyed() ? quitHost
      : (quitHost = new BrowserWindow({ width: 480, height: 160, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
        title: "SOAR is waiting for a task to pause", webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })));
    if (window.isMinimized()) window.restore();
    if (!window.isVisible()) window.show();
    return window;
  };
  app.on("before-quit", (event) => {
    if (!controller) return;
    event.preventDefault();
    if (quitting) { quitting.ask(); return; }
    const current = controller;
    // PR-B: a running task pauses at its next action boundary and stays resumable; the owner may quit at once instead.
    quitting = startQuit({
      close: () => current.close(), busy: current.busy(), quit: () => { controller = undefined; app.quit(); },
      askQuitNow: async signal => {
        const { response } = await dialog.showMessageBox(quitOfferParent(), { type: "info", buttons: ["Keep waiting", "Quit now"], defaultId: 0, cancelId: 0, signal,
          message: "Waiting for the running task to pause",
          detail: "The task pauses after its current step (a model reply or a command can take several minutes) and can be resumed later. Quitting now interrupts that step, and the task will then have to be cancelled instead of resumed." });
        return response === 1;
      },
    });
  });
}
