import { describe, expect, it } from "vitest";

import { EphemeralSetupCredentialStore } from "../../src/main/providers/ephemeral-setup-credential-store";

describe("EphemeralSetupCredentialStore", () => {
  it("models fake-mode presence without retaining the supplied value", async () => {
    const store = new EphemeralSetupCredentialStore();
    const sentinel = "synthetic-secret-that-must-not-be-retained";

    await expect(store.status()).resolves.toEqual({ state: "not_stored" });
    await store.replace(sentinel);
    await expect(store.has()).resolves.toBe(true);
    expect(JSON.stringify(store)).not.toContain(sentinel);
    await expect(store.delete()).resolves.toBe(true);
    await expect(store.has()).resolves.toBe(false);
  });
});
