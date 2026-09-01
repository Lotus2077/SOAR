import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  installRendererNavigationPolicy,
  resolvePreloadPath,
  resolveRendererTarget,
} from "../../src/main/window-security";

describe("renderer target security", () => {
  it("anchors preload to the application root rather than a code-split chunk", () => {
    const applicationPath = path.join(
      "/Applications",
      "SOAR.app",
      "Contents",
      "Resources",
      "app.asar",
    );
    expect(resolvePreloadPath(applicationPath)).toBe(
      path.resolve(applicationPath, "out/preload/index.cjs"),
    );
  });

  it("ignores an environment renderer URL in a packaged build", () => {
    const applicationPath = path.join(
      "/Applications",
      "SOAR.app",
      "Contents",
      "Resources",
      "app.asar",
    );
    const target = resolveRendererTarget({
      isPackaged: true,
      applicationPath,
      developmentUrl: "https://attacker.invalid/renderer",
    });
    expect(target).toEqual({
      expectedUrl: pathToFileURL(
        path.resolve(applicationPath, "out/renderer/index.html"),
      ).href,
      kind: "sealed_file",
    });
    expect(target.expectedUrl).not.toContain("attacker.invalid");
  });

  it("admits only exact unauthenticated loopback development URLs", () => {
    expect(
      resolveRendererTarget({
        isPackaged: false,
        applicationPath: "/tmp/project",
        developmentUrl: "http://127.0.0.1:5173",
      }),
    ).toEqual({
      expectedUrl: "http://127.0.0.1:5173/",
      kind: "loopback_development",
    });
    for (const developmentUrl of [
      "https://attacker.invalid/",
      "file:///tmp/foreign.html",
      "http://name:password@localhost:5173/",
    ]) {
      expect(() =>
        resolveRendererTarget({
          isPackaged: false,
          applicationPath: "/tmp/project",
          developmentUrl,
        }),
      ).toThrow(/loopback HTTP URL/u);
    }
  });

  it("denies windows, webviews, frame navigation, and redirects outside the exact entry URL", () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    const setWindowOpenHandler = vi.fn();
    const webContents = {
      setWindowOpenHandler,
      on: vi.fn((name: string, handler: (...args: any[]) => void) => {
        handlers.set(name, handler);
      }),
    };
    installRendererNavigationPolicy(
      webContents as never,
      "file:///sealed/renderer/index.html",
    );

    expect(setWindowOpenHandler.mock.calls[0]![0]()).toEqual({ action: "deny" });
    const webviewEvent = { preventDefault: vi.fn() };
    handlers.get("will-attach-webview")!(webviewEvent);
    expect(webviewEvent.preventDefault).toHaveBeenCalledOnce();

    for (const name of ["will-navigate", "will-redirect"]) {
      const admitted = { preventDefault: vi.fn() };
      handlers.get(name)!(admitted, "file:///sealed/renderer/index.html");
      expect(admitted.preventDefault).not.toHaveBeenCalled();
      const denied = { preventDefault: vi.fn() };
      handlers.get(name)!(denied, "file:///tmp/foreign.html");
      expect(denied.preventDefault).toHaveBeenCalledOnce();
    }

    const admittedFrame = {
      url: "file:///sealed/renderer/index.html",
      preventDefault: vi.fn(),
    };
    handlers.get("will-frame-navigate")!(admittedFrame);
    expect(admittedFrame.preventDefault).not.toHaveBeenCalled();
    const deniedFrame = {
      url: "https://attacker.invalid/frame",
      preventDefault: vi.fn(),
    };
    handlers.get("will-frame-navigate")!(deniedFrame);
    expect(deniedFrame.preventDefault).toHaveBeenCalledOnce();
  });
});
