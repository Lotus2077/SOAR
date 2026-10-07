import { app, BrowserWindow, dialog } from "electron";
import { startQuit } from "./liveness";

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

// This is the first mutable app decision. The bootstrap module (and therefore
// SQLite and every credential/native module) is imported only after the
// primary process owns Electron's single-instance lock.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) {
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
      controller = await bootstrap();
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
