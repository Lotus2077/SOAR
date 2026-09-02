import path from "node:path";
import { pathToFileURL } from "node:url";

import { app, BrowserWindow } from "electron";

import { installPr6rDevelopmentNavigationPolicy } from "./navigation-policy";
import {
  assertPr6rDevelopmentRuntimeAuthority,
  type Pr6rDevelopmentRuntimeAuthority,
} from "./runtime-authority";

export interface Pr6rDevelopmentCanaryController {
  close(): void;
}

function loopbackDevelopmentRendererUrl(value: string): string {
  const parsed = new URL(value);
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname) ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error("pr6r_development_renderer_url_denied");
  }
  return parsed.toString();
}

function rendererUrl(): string {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  if (developmentUrl !== undefined) {
    return loopbackDevelopmentRendererUrl(developmentUrl);
  }
  return pathToFileURL(
    path.resolve(app.getAppPath(), "out", "renderer", "index.html"),
  ).toString();
}

/** Standalone A1 shell: no normal config, provider, credential, DB, or IPC. */
export async function bootstrapPr6rDevelopmentCanary(
  authority: Pr6rDevelopmentRuntimeAuthority,
): Promise<Pr6rDevelopmentCanaryController> {
  assertPr6rDevelopmentRuntimeAuthority(authority);
  if (app.isPackaged) {
    throw new Error("pr6r_development_canary_packaged_runtime_denied");
  }

  const expectedUrl = rendererUrl();
  const window = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 720,
    minHeight: 520,
    show: false,
    backgroundColor: "#f4f2ed",
    title: "SOAR Development Canary",
    webPreferences: {
      preload: path.resolve(app.getAppPath(), "out", "preload", "index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });
  installPr6rDevelopmentNavigationPolicy(window.webContents, expectedUrl);
  window.once("ready-to-show", () => window.show());
  await window.loadURL(expectedUrl);

  let closed = false;
  return Object.freeze({
    close(): void {
      if (closed) return;
      closed = true;
      if (!window.isDestroyed()) window.destroy();
    },
  });
}
