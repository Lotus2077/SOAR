import { describe, expect, it, vi } from "vitest";

import { CloudCredentialSetupService } from "../../src/main/cloud-credential-service";
import {
  SetupCredentialStoreError,
  type SetupOnlyCredentialStore,
} from "../../src/main/providers/macos-keychain-credential-store";

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function store(overrides: Partial<SetupOnlyCredentialStore> = {}): SetupOnlyCredentialStore {
  return {
    status: vi.fn().mockResolvedValue({ state: "not_stored" }),
    has: vi.fn().mockResolvedValue(false),
    write: vi.fn().mockResolvedValue(undefined),
    replace: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

describe("CloudCredentialSetupService", () => {
  it("projects missing and stored Keychain state without dispatch authority", async () => {
    const missing = new CloudCredentialSetupService(store());
    await expect(missing.getStatus()).resolves.toMatchObject({
      schemaVersion: "cloud-setup-status-v1",
      state: "not_configured",
      dispatch: {
        state: "locked",
        reasonCode: "pr6a_dispatch_locked",
      },
    });

    const stored = new CloudCredentialSetupService(
      store({ has: vi.fn().mockResolvedValue(true) }),
    );
    await expect(stored.getStatus()).resolves.toMatchObject({
      state: "stored_unvalidated",
      dispatch: { state: "locked" },
    });
  });

  it("upserts once and never returns or retains the submitted credential", async () => {
    const replace = vi.fn().mockResolvedValue(undefined);
    const setupStore = store({ replace });
    const service = new CloudCredentialSetupService(setupStore);
    const sentinel = "SOAR_SYNTHETIC_CLOUD_CREDENTIAL_SENTINEL";

    const result = await service.save(sentinel);

    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith(sentinel);
    expect(setupStore.has).not.toHaveBeenCalled();
    expect(setupStore.write).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(JSON.stringify(service)).not.toContain(sentinel);
    expect(result).toMatchObject({
      state: "stored_unvalidated",
      dispatch: { state: "locked" },
    });
  });

  it("deletes idempotently and keeps Hybrid locked", async () => {
    const remove = vi.fn().mockResolvedValue(false);
    const service = new CloudCredentialSetupService(store({ delete: remove }));

    await expect(service.delete()).resolves.toMatchObject({
      state: "not_configured",
      dispatch: { state: "locked" },
    });
    expect(remove).toHaveBeenCalledOnce();
  });

  it("rejects concurrent save and delete mutations before another secret reaches the store", async () => {
    const active = deferred();
    const replace = vi.fn((_credential: string) => active.promise);
    const remove = vi.fn().mockResolvedValue(false);
    const service = new CloudCredentialSetupService(
      store({ replace, delete: remove }),
    );
    const accepted = "SOAR_ACCEPTED_MUTATION_SENTINEL";
    const rejected = "SOAR_REJECTED_MUTATION_SENTINEL";

    const first = service.save(accepted);
    await vi.waitFor(() => expect(replace).toHaveBeenCalledOnce());

    const [secondSave, concurrentDelete] = await Promise.all([
      service.save(rejected),
      service.delete(),
    ]);

    for (const result of [secondSave, concurrentDelete]) {
      expect(result).toMatchObject({
        state: "local_storage_error",
        errorCode: "operation_in_progress",
        dispatch: { state: "locked" },
      });
      expect(JSON.stringify(result)).not.toContain(rejected);
    }
    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith(accepted);
    expect(remove).not.toHaveBeenCalled();
    expect(JSON.stringify(service)).not.toContain(rejected);

    active.resolve();
    await expect(first).resolves.toMatchObject({
      state: "stored_unvalidated",
    });
    await expect(service.delete()).resolves.toMatchObject({
      state: "not_configured",
    });
    expect(remove).toHaveBeenCalledOnce();
  });

  it("rejects a save before its secret reaches the store while delete is active", async () => {
    const active = deferred();
    const replace = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn(() => active.promise.then(() => true));
    const service = new CloudCredentialSetupService(
      store({ replace, delete: remove }),
    );
    const rejected = "SOAR_DELETE_BLOCKED_SAVE_SENTINEL";

    const first = service.delete();
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
    const blocked = await service.save(rejected);

    expect(blocked).toMatchObject({
      state: "local_storage_error",
      errorCode: "operation_in_progress",
    });
    expect(replace).not.toHaveBeenCalled();
    expect(JSON.stringify(blocked)).not.toContain(rejected);

    active.resolve();
    await expect(first).resolves.toMatchObject({ state: "not_configured" });
  });

  it("coalesces concurrent status reads so they cannot build a queue ahead of a secret", async () => {
    const active = deferred();
    const has = vi.fn(() => active.promise.then(() => false));
    const service = new CloudCredentialSetupService(store({ has }));

    const first = service.getStatus();
    const second = service.getStatus();

    expect(second).toBe(first);
    expect(has).toHaveBeenCalledOnce();
    active.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ state: "not_configured" }),
      expect.objectContaining({ state: "not_configured" }),
    ]);
  });

  it("maps allow-listed Keychain failures without exposing raw errors", async () => {
    const sentinel = "SOAR_RAW_KEYCHAIN_ERROR_SENTINEL";
    const service = new CloudCredentialSetupService(
      store({
        has: vi
          .fn()
          .mockRejectedValue(
            new SetupCredentialStoreError("keychain_status_failed"),
          ),
        replace: vi.fn().mockRejectedValue(new Error(sentinel)),
        delete: vi
          .fn()
          .mockRejectedValue(
            new SetupCredentialStoreError("keychain_delete_failed"),
          ),
      }),
    );

    const statuses = [
      await service.getStatus(),
      await service.save("synthetic-value"),
      await service.delete(),
    ];

    expect(statuses.map((entry) => entry.state)).toEqual([
      "local_storage_error",
      "local_storage_error",
      "local_storage_error",
    ]);
    expect(statuses.map((entry) =>
      entry.state === "local_storage_error" ? entry.errorCode : undefined,
    )).toEqual([
      "keychain_status_failed",
      "keychain_unavailable",
      "keychain_delete_failed",
    ]);
    expect(JSON.stringify(statuses)).not.toContain(sentinel);
  });
});
