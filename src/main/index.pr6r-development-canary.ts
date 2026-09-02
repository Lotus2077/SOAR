import { app, BrowserWindow } from "electron";

import type { Pr6rDevelopmentCanaryController } from "./pr6r-development/bootstrap";

/**
 * Compile-time-only entry for the approved PR6R-A development canary flavor.
 *
 * The marker is intentionally retained in this flavor's emitted main bundle so
 * the normal package verifier can reject accidental inclusion. This entry
 * creates only a nominal simulation-scoped capability; later PR6R-A
 * checkpoints must remain behind this structurally separate build graph.
 */
export const PR6R_DEVELOPMENT_CANARY_BUILD_MARKER =
  "SOAR_PR6R_DEVELOPMENT_CANARY_V1" as const;

let controller: Pr6rDevelopmentCanaryController | undefined;

// This check precedes every PR6R runtime import and every mutable app action.
// Compile-time exclusion and the package marker are the primary boundary; this
// is the required defense in depth if somebody packages the special graph while
// bypassing the normal package verifier.
if (app.isPackaged) {
  console.error("pr6r_development_canary_packaged_runtime_denied");
  app.exit(1);
} else {
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
        const [{ bootstrapPr6rDevelopmentCanary }, runtimeAuthority] =
          await Promise.all([
            import("./pr6r-development/bootstrap"),
            import("./pr6r-development/runtime-authority"),
          ]);
        const authority =
          runtimeAuthority.createPr6rDevelopmentRuntimeAuthorityForBuild();
        controller = await bootstrapPr6rDevelopmentCanary(authority);
      })
      .catch(() => {
        console.error("pr6r_development_canary_startup_failed");
        app.quit();
      });

    app.on("window-all-closed", () => app.quit());
    app.on("will-quit", () => {
      controller?.close();
      controller = undefined;
    });
  }
}
