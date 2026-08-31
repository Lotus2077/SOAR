/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/renderer/src/App";
import { CloudSettings } from "../../src/renderer/src/CloudSettings";
import type { CloudSetupStatus } from "../../src/shared/cloud-setup-contracts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const candidate = {
  providerLabel: "OpenRouter",
  modelLabel: "DeepSeek V4 Flash",
} as const;

const dispatch = {
  state: "locked",
  reasonCode: "pr6a_dispatch_locked",
  explanation:
    "This build cannot validate a cloud credential or dispatch a cloud request.",
} as const;

const notConfigured: CloudSetupStatus = {
  schemaVersion: "cloud-setup-status-v1",
  candidate,
  state: "not_configured",
  dispatch,
};

const storedUnvalidated: CloudSetupStatus = {
  schemaVersion: "cloud-setup-status-v1",
  candidate,
  state: "stored_unvalidated",
  dispatch,
};

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
    getCloudSetupStatus: vi.fn().mockResolvedValue(notConfigured),
    saveCloudCredential: vi.fn().mockResolvedValue(storedUnvalidated),
    deleteCloudCredential: vi.fn().mockResolvedValue(notConfigured),
    subscribeSessionEvents: vi.fn().mockReturnValue(() => undefined),
    ...overrides,
  };
  Object.defineProperty(window, "soar", {
    configurable: true,
    value: api,
  });
  return api;
}

describe("Cloud Settings", () => {
  it("is optional on first run and reads only local setup status when opened", async () => {
    const user = userEvent.setup();
    const api = installAppApi();

    render(<App />);
    await screen.findByText("Your sessions will appear here.");
    expect(api.getCloudSetupStatus).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Open settings" }));

    const heading = await screen.findByRole("heading", {
      name: "Cloud synthesis",
    });
    expect(heading).toBeVisible();
    expect(heading).toHaveFocus();
    expect(api.getCloudSetupStatus).toHaveBeenCalledOnce();
    expect(screen.getByText("Not configured")).toBeVisible();
    expect(screen.getByText("Not validated")).toBeVisible();
    expect(screen.getByText("Hybrid locked")).toBeVisible();
    expect(screen.queryByRole("button", { name: /validate/u })).not.toBeInTheDocument();
  });

  it("clears the uncontrolled password field before awaiting save and never uses browser storage", async () => {
    const user = userEvent.setup();
    const pending = deferred<CloudSetupStatus>();
    const onSave = vi.fn(() => pending.promise);
    const localSet = vi.fn();
    const sessionSet = vi.fn();
    vi.stubGlobal("localStorage", { setItem: localSet });
    vi.stubGlobal("sessionStorage", { setItem: sessionSet });
    const syntheticCredential = "synthetic-cloud-credential-value";

    render(
      <CloudSettings
        status={notConfigured}
        loading={false}
        loadFailed={false}
        onRetry={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    const field = screen.getByLabelText("OpenRouter credential");
    await user.type(field, syntheticCredential);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(syntheticCredential);
    expect(field).toHaveValue("");
    expect(document.body).not.toHaveTextContent(syntheticCredential);
    expect(localSet).not.toHaveBeenCalled();
    expect(sessionSet).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();

    pending.resolve(storedUnvalidated);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
  });

  it("supports replace and delete without echoing a rejected credential", async () => {
    const user = userEvent.setup();
    const replacement = "synthetic-replacement-value";
    const onSave = vi
      .fn<(credential: string) => Promise<CloudSetupStatus>>()
      .mockRejectedValue(new Error(`unsafe backend echo: ${replacement}`));
    const onDelete = vi.fn().mockResolvedValue(notConfigured);

    render(
      <CloudSettings
        status={storedUnvalidated}
        loading={false}
        loadFailed={false}
        onRetry={vi.fn()}
        onSave={onSave}
        onDelete={onDelete}
        onDone={vi.fn()}
      />,
    );

    expect(screen.getByText("Stored locally")).toBeVisible();
    const field = screen.getByLabelText("Replacement OpenRouter credential");
    await user.type(field, replacement);
    await user.click(screen.getByRole("button", { name: "Replace" }));

    expect(field).toHaveValue("");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "SOAR could not confirm the replacement.",
    );
    expect(document.body).not.toHaveTextContent(replacement);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Remove the stored credential?")).toBeVisible();
    const remove = screen.getByRole("button", { name: "Remove credential" });
    await waitFor(() => expect(remove).toHaveFocus());
    await user.tab();
    expect(screen.getByRole("button", { name: "Keep credential" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus(),
    );
    await user.keyboard("{Enter}");
    const confirmedRemove = screen.getByRole("button", {
      name: "Remove credential",
    });
    await waitFor(() => expect(confirmedRemove).toHaveFocus());
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onDelete).toHaveBeenCalledOnce());
    await waitFor(() => expect(field).toHaveFocus());
  });

  it("wires save and delete results back into the app status view", async () => {
    const user = userEvent.setup();
    const api = installAppApi();

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open settings" }));
    const field = await screen.findByLabelText("OpenRouter credential");
    await user.type(field, "synthetic-app-flow-value");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Stored locally")).toBeVisible();
    expect(api.saveCloudCredential).toHaveBeenCalledWith({
      credential: "synthetic-app-flow-value",
    });

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Remove credential" }));

    expect(await screen.findByText("Not configured")).toBeVisible();
    expect(api.deleteCloudCredential).toHaveBeenCalledOnce();
  });

  it("restores focus to the Settings trigger after Done", async () => {
    const user = userEvent.setup();
    installAppApi();

    render(<App />);
    const trigger = await screen.findByRole("button", { name: "Open settings" });
    await user.click(trigger);
    await screen.findByRole("heading", { name: "Cloud synthesis" });
    await user.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("renders only allow-listed local storage error copy", () => {
    render(
      <CloudSettings
        status={{
          ...notConfigured,
          state: "local_storage_error",
          errorCode: "keychain_status_failed",
        }}
        loading={false}
        loadFailed={false}
        onRetry={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    expect(screen.getByText("Local storage error")).toBeVisible();
    expect(
      screen.getByText("SOAR could not read the local credential status."),
    ).toBeVisible();
    expect(screen.getByText("Hybrid locked")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Retry local status" }),
    ).toBeVisible();
    expect(
      screen.queryByLabelText("OpenRouter credential"),
    ).not.toBeInTheDocument();
  });

  it("treats resolved save failures as unknown local state and focuses recovery", async () => {
    const user = userEvent.setup();
    const errorStatus: CloudSetupStatus = {
      ...notConfigured,
      state: "local_storage_error",
      errorCode: "keychain_write_failed",
    };
    installAppApi({ saveCloudCredential: vi.fn().mockResolvedValue(errorStatus) });

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open settings" }));
    const field = await screen.findByLabelText("OpenRouter credential");
    await user.type(field, "synthetic-resolved-save-failure");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Local storage error")).toBeVisible();
    const retry = screen.getByRole("button", { name: "Retry local status" });
    await waitFor(() => expect(retry).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("does not treat a resolved delete failure as successful", async () => {
    const user = userEvent.setup();
    const errorStatus: CloudSetupStatus = {
      ...notConfigured,
      state: "local_storage_error",
      errorCode: "keychain_delete_failed",
    };
    installAppApi({
      getCloudSetupStatus: vi.fn().mockResolvedValue(storedUnvalidated),
      deleteCloudCredential: vi.fn().mockResolvedValue(errorStatus),
    });

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open settings" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await user.click(
      screen.getByRole("button", { name: "Remove credential" }),
    );

    expect(await screen.findByText("Local storage error")).toBeVisible();
    const retry = screen.getByRole("button", { name: "Retry local status" });
    await waitFor(() => expect(retry).toHaveFocus());
    expect(screen.queryByText("Not configured")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("restores focus after retrying local status", async () => {
    const user = userEvent.setup();
    const errorStatus: CloudSetupStatus = {
      ...notConfigured,
      state: "local_storage_error",
      errorCode: "keychain_status_failed",
    };
    const getCloudSetupStatus = vi
      .fn()
      .mockResolvedValueOnce(errorStatus)
      .mockResolvedValueOnce(notConfigured);
    installAppApi({ getCloudSetupStatus });

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open settings" }));
    await user.click(
      await screen.findByRole("button", { name: "Retry local status" }),
    );

    const heading = await screen.findByRole("heading", {
      name: "Cloud synthesis",
    });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText("Not configured")).toBeVisible();
  });
});
