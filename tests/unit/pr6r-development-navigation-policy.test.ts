import { describe, expect, it, vi } from "vitest";

import { installPr6rDevelopmentNavigationPolicy } from "../../src/main/pr6r-development/navigation-policy";

describe("PR6R development renderer navigation policy", () => {
  it("denies windows, webviews, redirects, and frame navigation outside the exact URL", () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    const setWindowOpenHandler = vi.fn();
    const webContents = {
      setWindowOpenHandler,
      on: vi.fn((name: string, handler: (...args: any[]) => void) => {
        handlers.set(name, handler);
      }),
    };
    const expectedUrl = "http://127.0.0.1:5173/";

    installPr6rDevelopmentNavigationPolicy(
      webContents as never,
      expectedUrl,
    );

    expect(setWindowOpenHandler.mock.calls[0]![0]()).toEqual({
      action: "deny",
    });
    const webview = { preventDefault: vi.fn() };
    handlers.get("will-attach-webview")!(webview);
    expect(webview.preventDefault).toHaveBeenCalledOnce();

    for (const name of ["will-navigate", "will-redirect"]) {
      const admitted = { preventDefault: vi.fn() };
      handlers.get(name)!(admitted, expectedUrl);
      expect(admitted.preventDefault).not.toHaveBeenCalled();
      const denied = { preventDefault: vi.fn() };
      handlers.get(name)!(denied, "https://example.invalid/redirect");
      expect(denied.preventDefault).toHaveBeenCalledOnce();
    }

    const frame = {
      url: "https://example.invalid/frame",
      preventDefault: vi.fn(),
    };
    handlers.get("will-frame-navigate")!(frame);
    expect(frame.preventDefault).toHaveBeenCalledOnce();
  });
});
