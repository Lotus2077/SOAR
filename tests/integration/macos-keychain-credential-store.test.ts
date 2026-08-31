import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { MacOsKeychainCredentialSetupStore } from "../../src/main/providers/macos-keychain-credential-store";

const integrationEnabled =
  process.platform === "darwin" &&
  process.env.SOAR_RUN_KEYCHAIN_INTEGRATION === "true";

const servicesToClean = new Set<{ service: string; account: string }>();

afterEach(async () => {
  await Promise.all(
    [...servicesToClean].map(async ({ service, account }) => {
      const store = new MacOsKeychainCredentialSetupStore({ service, account });
      await store.delete();
      await expect(store.has()).resolves.toBe(false);
    }),
  );
  servicesToClean.clear();
});

describe.runIf(integrationEnabled)("macOS Keychain setup integration", () => {
  it("adds, observes after reconstruction, replaces, deletes, and proves cleanup", async () => {
    const suffix = randomUUID();
    const service = `ai.soar.synthetic-test.${suffix}`;
    const account = `synthetic-${suffix}`;
    servicesToClean.add({ service, account });
    const first = new MacOsKeychainCredentialSetupStore({ service, account });

    await first.delete();
    await expect(first.has()).resolves.toBe(false);
    expect("read" in first).toBe(false);

    await first.write(`synthetic-first-${randomUUID()}`);
    await expect(first.status()).resolves.toEqual({ state: "stored" });

    const reconstructed = new MacOsKeychainCredentialSetupStore({
      service,
      account,
    });
    await expect(reconstructed.has()).resolves.toBe(true);
    await reconstructed.replace(`synthetic-replacement-${randomUUID()}`);
    await expect(reconstructed.status()).resolves.toEqual({ state: "stored" });

    await expect(reconstructed.delete()).resolves.toBe(true);
    await expect(
      new MacOsKeychainCredentialSetupStore({ service, account }).has(),
    ).resolves.toBe(false);
  });
});
