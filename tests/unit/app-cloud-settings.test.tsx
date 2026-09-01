/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/renderer/src/App";
import { CloudSettings } from "../../src/renderer/src/CloudSettings";
import {
  CLOUD_DISPATCH_LOCK_EXPLANATION,
  type CloudCredentialStatus,
} from "../../src/shared/cloud-setup-contracts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function status(
  overrides: Partial<CloudCredentialStatus> = {},
): CloudCredentialStatus {
  return {
    schemaVersion: "cloud-credential-status-v1",
    capabilityVersion: "credential-lease-authority-v1",
    activationPhase: "phase_b_locked",
    build: {
      state: "unsigned_or_adhoc",
      reasonCode: "signed_build_required",
    },
    legacyStagedItem: {
      state: "not_observed",
      reasonCode: "legacy_metadata_not_observed",
    },
    protectedItem: {
      state: "unknown",
      reasonCode: "activation_locked",
    },
    providerCheck: { providerLabel: "OpenRouter", state: "not_run" },
    dispatch: {
      state: "locked",
      reasonCode: "pr6b1_phase_b_locked",
      explanation: CLOUD_DISPATCH_LOCK_EXPLANATION,
    },
    providerContact: {
      providerLabel: "OpenRouter",
      state: "not_contacted",
      scope: "credential_operation",
    },
    latestOperation: { state: "none" },
    ...overrides,
  };
}

const lockedStatus = status();

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function relativeLuminance([red, green, blue]: readonly number[]): number {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const normalized = channel! / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrastRatio(
  foreground: readonly number[],
  background: readonly number[],
): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

function hexChannels(value: string): number[] {
  return value.match(/../gu)!.map((channel) => parseInt(channel, 16));
}

function installAppApi(overrides: Record<string, unknown> = {}) {
  const api = {
    chooseWorkspace: vi.fn().mockResolvedValue(null),
    createSession: vi.fn(),
    listSessions: vi.fn().mockResolvedValue([]),
    getSession: vi.fn(),
    startSession: vi.fn(),
    cancelSession: vi.fn(),
    getReviewAvailability: vi.fn(),
    createChangeReviewSession: vi.fn(),
    getChangeReviewView: vi.fn(),
    getCloudCredentialStatus: vi.fn().mockResolvedValue(lockedStatus),
    subscribeSessionEvents: vi.fn().mockReturnValue(() => undefined),
    ...overrides,
  };
  Object.defineProperty(window, "soar", {
    configurable: true,
    value: api,
  });
  return api;
}

describe("Cloud credential settings", () => {
  it("keeps dark-theme operation-status small text above WCAG AA contrast", () => {
    const css = readFileSync("src/renderer/src/styles.css", "utf8");
    const darkTheme = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
    const foregroundHex = darkTheme.match(
      /--text-secondary:\s*#([0-9a-f]{6})/iu,
    )?.[1];
    const surfaceHex = darkTheme.match(/--surface:\s*#([0-9a-f]{6})/iu)?.[1];
    const soft = darkTheme.match(
      /--orange-soft:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/u,
    );
    if (!foregroundHex || !surfaceHex || !soft) {
      throw new Error("Dark operation-status colors are missing.");
    }
    expect(css).toMatch(
      /\.cloud-operation-status\s*\{[^}]*color:\s*var\(--text-secondary\)/u,
    );
    const foreground = hexChannels(foregroundHex);
    const surface = hexChannels(surfaceHex);
    const alpha = Number(soft[4]);
    const background = soft.slice(1, 4).map((channel, index) =>
      Math.round(Number(channel) * alpha + surface[index]! * (1 - alpha)),
    );

    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("is optional on first run and reads only local metadata when opened", async () => {
    const user = userEvent.setup();
    const api = installAppApi();

    render(<App />);
    await screen.findByText("Your sessions will appear here.");
    expect(api.getCloudCredentialStatus).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Manage cloud credential" }),
    );

    const heading = await screen.findByRole("heading", {
      name: "Cloud credential",
    });
    expect(heading).toHaveFocus();
    expect(api.getCloudCredentialStatus).toHaveBeenCalledOnce();
    expect(
      screen.getByText("Signed setup is not available in this build"),
    ).toBeVisible();
    expect(screen.getByText("No older setup item found")).toBeVisible();
    expect(screen.getByText("Protected credential not inspected")).toBeVisible();
    expect(screen.getByText("Not run")).toBeVisible();
    expect(screen.getByText("Locked")).toBeVisible();
    expect(
      screen.getByText(
        "OpenRouter was not contacted by this credential operation.",
      ),
    ).toBeVisible();
  });

  it("exposes no credential input or mutation action in any locked state", () => {
    const present = status({
      build: { state: "eligible", reasonCode: "identity_policy_satisfied" },
      legacyStagedItem: {
        state: "present",
        reasonCode: "legacy_metadata_present",
      },
    });

    render(
      <CloudSettings
        status={present}
        loading={false}
        loadFailed={false}
        onRetry={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    expect(screen.getByText("Real credential setup is still locked")).toBeVisible();
    expect(screen.getByText("Older setup item present")).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(
      screen.queryByRole("button", { name: /save|replace|delete|remove/u }),
    ).not.toBeInTheDocument();
  });

  it("uses the signed-setup headline for an ineligible signed host", () => {
    render(
      <CloudSettings
        status={status({
          build: {
            state: "ineligible",
            reasonCode: "wrong_bundle_identifier",
          },
        })}
        loading={false}
        loadFailed={false}
        onRetry={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Signed setup is not available in this build"),
    ).toBeVisible();
    expect(
      screen.queryByText("This build's credential identity could not be confirmed"),
    ).not.toBeInTheDocument();
  });

  it("distinguishes a locked Keychain from denied and unavailable metadata", () => {
    render(
      <CloudSettings
        status={status({
          legacyStagedItem: {
            state: "unknown",
            reasonCode: "keychain_locked",
          },
        })}
        loading={false}
        loadFailed={false}
        onRetry={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Unlock your Mac Keychain to continue"),
    ).toBeVisible();
    expect(screen.getByRole("alert")).toHaveAccessibleName(
      "Older setup item",
    );
    expect(
      screen.getByText(/did not show an authentication prompt/u),
    ).toBeVisible();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("retains the last source-proven legacy state across a denied refresh", async () => {
    const first = status({
      legacyStagedItem: {
        state: "present",
        reasonCode: "legacy_metadata_present",
      },
    });
    const denied = status({
      legacyStagedItem: {
        state: "unknown",
        reasonCode: "keychain_access_denied",
      },
    });
    installAppApi({
      getCloudCredentialStatus: vi
        .fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(denied),
    });
    const user = userEvent.setup();

    render(<App />);
    const trigger = await screen.findByRole("button", {
      name: "Manage cloud credential",
    });
    await user.click(trigger);
    expect(await screen.findByText("Older setup item present")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Done" }));
    await user.click(trigger);

    expect(await screen.findByText("Keychain access was denied")).toBeVisible();
    expect(
      screen.getByText(/last completed metadata check observed the older setup item/u),
    ).toBeVisible();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("keeps operation progress and unknown outcome copy bounded and accessible", () => {
    const { rerender } = render(
      <CloudSettings
        status={status({
          latestOperation: {
            state: "pending",
            kind: "replace_protected",
          },
        })}
        loading={false}
        loadFailed={false}
        onRetry={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    const progress = screen.getByTestId("cloud-credential-live-status");
    expect(progress).toHaveAttribute("role", "status");
    expect(progress).toHaveTextContent("Replacing credential in Keychain…");
    expect(progress).toHaveAttribute("aria-busy", "true");

    rerender(
      <CloudSettings
        status={status({
          latestOperation: {
            state: "outcome_unknown",
            kind: "replace_protected",
            recoveryCode: "await_native_completion",
          },
        })}
        loading={false}
        loadFailed={false}
        onRetry={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The previous credential replacement has not been confirmed.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "duplicate changes remain locked",
    );
  });

  it("uses one persistent polite region for metadata progress and bounded success", async () => {
    const request = deferred<CloudCredentialStatus>();
    installAppApi({
      getCloudCredentialStatus: vi.fn().mockReturnValue(request.promise),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(
      screen.getByRole("button", { name: "Manage cloud credential" }),
    );
    const liveRegion = await screen.findByTestId(
      "cloud-credential-live-status",
    );
    expect(liveRegion).toHaveAttribute("role", "status");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
    expect(liveRegion).toHaveAttribute("aria-atomic", "true");
    expect(liveRegion).toHaveTextContent(
      "Reading non-secret local credential status…",
    );

    request.resolve(lockedStatus);
    await waitFor(() =>
      expect(liveRegion).toHaveTextContent(
        "Local credential status loaded. Cloud requests remain locked.",
      ),
    );
    expect(screen.getAllByRole("status")).toEqual([liveRegion]);
  });

  it("renders allow-listed unavailable status and restores focus after retry", async () => {
    const user = userEvent.setup();
    const getCloudCredentialStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error("raw status detail"))
      .mockResolvedValueOnce(lockedStatus);
    installAppApi({ getCloudCredentialStatus });

    render(<App />);
    await user.click(
      screen.getByRole("button", { name: "Manage cloud credential" }),
    );
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Local credential status unavailable");
    expect(error).not.toHaveTextContent("raw status detail");

    await user.click(
      within(error).getByRole("button", { name: "Retry local status" }),
    );
    const heading = await screen.findByRole("heading", {
      name: "Cloud credential",
    });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText("No older setup item found")).toBeVisible();
  });

  it("restores focus to the exact navigation trigger after Done", async () => {
    const user = userEvent.setup();
    installAppApi();

    render(<App />);
    const trigger = await screen.findByRole("button", {
      name: "Manage cloud credential",
    });
    await user.click(trigger);
    await screen.findByRole("heading", { name: "Cloud credential" });
    await user.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("restores compact-layout focus to the sessions menu when the origin becomes inert", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query === "(max-width: 880px)",
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    const user = userEvent.setup();
    installAppApi();

    render(<App />);
    const menu = await screen.findByRole("button", { name: "Open sessions" });
    await user.click(menu);
    const trigger = screen.getByRole("button", {
      name: "Manage cloud credential",
    });
    await user.click(trigger);
    await screen.findByRole("heading", { name: "Cloud credential" });
    await user.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(menu).toHaveFocus());
  });

  it("ignores a stale status response after the screen is reopened", async () => {
    const user = userEvent.setup();
    const stale = deferred<CloudCredentialStatus>();
    const current = status({
      legacyStagedItem: {
        state: "present",
        reasonCode: "legacy_metadata_present",
      },
    });
    const getCloudCredentialStatus = vi
      .fn()
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(current);
    installAppApi({ getCloudCredentialStatus });

    render(<App />);
    const trigger = await screen.findByRole("button", {
      name: "Manage cloud credential",
    });
    await user.click(trigger);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Reading non-secret local credential status",
    );
    await user.click(screen.getByRole("button", { name: "Done" }));
    await user.click(trigger);

    expect(await screen.findByText("Older setup item present")).toBeVisible();
    stale.resolve(lockedStatus);
    await Promise.resolve();
    expect(screen.getByText("Older setup item present")).toBeVisible();
    expect(screen.queryByText("No older setup item found")).not.toBeInTheDocument();
  });
});
