import { app, BrowserWindow, dialog } from "electron";

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

  app.on("will-quit", () => {
    controller?.close();
    controller = undefined;
  });
}
