import type { WebContents } from "electron";

/** Keep the A1 development renderer on its single admitted URL. */
export function installPr6rDevelopmentNavigationPolicy(
  webContents: WebContents,
  expectedUrl: string,
): void {
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  webContents.on("will-attach-webview", (event) => event.preventDefault());
  const preventUnexpectedUrl = (
    event: { preventDefault(): void },
    url: string,
  ): void => {
    if (url !== expectedUrl) event.preventDefault();
  };
  webContents.on("will-navigate", preventUnexpectedUrl);
  webContents.on("will-redirect", preventUnexpectedUrl);
  webContents.on("will-frame-navigate", (event) => {
    if (event.url !== expectedUrl) event.preventDefault();
  });
}
