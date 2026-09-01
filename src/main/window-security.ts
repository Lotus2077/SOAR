import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Event as ElectronEvent, WebContents } from "electron";

export interface RendererTarget {
  expectedUrl: string;
  kind: "sealed_file" | "loopback_development";
}

export function resolvePreloadPath(applicationPath: string): string {
  return path.resolve(applicationPath, "out/preload/index.cjs");
}

function loopbackDevelopmentUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !loopback ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error(
      "The development renderer URL must be an unauthenticated loopback HTTP URL.",
    );
  }
  return url.href;
}

export function resolveRendererTarget(options: {
  isPackaged: boolean;
  applicationPath: string;
  developmentUrl?: string;
}): RendererTarget {
  const sealedRendererUrl = pathToFileURL(
    path.resolve(options.applicationPath, "out/renderer/index.html"),
  ).href;
  if (options.isPackaged || options.developmentUrl === undefined) {
    return Object.freeze({
      expectedUrl: sealedRendererUrl,
      kind: "sealed_file",
    });
  }
  return Object.freeze({
    expectedUrl: loopbackDevelopmentUrl(options.developmentUrl),
    kind: "loopback_development",
  });
}

/** Install exact main-frame navigation policy before the first renderer load. */
export function installRendererNavigationPolicy(
  webContents: WebContents,
  expectedRendererUrl: string,
): void {
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  webContents.on("will-attach-webview", (event) => event.preventDefault());
  const rejectForeignTarget = (
    event: ElectronEvent,
    targetUrl: string,
  ): void => {
    if (targetUrl !== expectedRendererUrl) event.preventDefault();
  };
  webContents.on("will-navigate", rejectForeignTarget);
  webContents.on("will-redirect", rejectForeignTarget);
  webContents.on("will-frame-navigate", (details) => {
    if (details.url !== expectedRendererUrl) details.preventDefault();
  });
}
