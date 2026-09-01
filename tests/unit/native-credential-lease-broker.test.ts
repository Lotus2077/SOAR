import { describe, expect, it, vi } from "vitest";

import {
  NativeCredentialLeaseAuthority,
  createCredentialLeaseAuthority,
} from "../../src/main/credentials/native-credential-lease-broker";

const capability = {
  schemaVersion: "soar-native-credential-lease-v1",
  flavor: "locked",
  eligibility: "ineligible",
  reasonCode: "signed_build_required",
} as const;
const legacyStatus = {
  state: "not_observed",
  reasonCode: "legacy_metadata_not_observed",
} as const;
const activationLocked = {
  state: "activation_locked",
  reasonCode: "activation_locked",
} as const;

function nativeModule(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    acquireLease: vi.fn(() => activationLocked),
    capability: vi.fn(() => capability),
    consumeLease: vi.fn(() => activationLocked),
    legacyStatus: vi.fn(async () => legacyStatus),
    releaseLease: vi.fn(() => activationLocked),
    ...overrides,
  };
}

describe("NativeCredentialLeaseAuthority", () => {
  it("projects only strict native metadata and keeps protected state locked", async () => {
    const module = nativeModule();
    const authority = new NativeCredentialLeaseAuthority(() => module);

    await expect(authority.getSnapshot()).resolves.toEqual({
      capability,
      legacyStagedItem: legacyStatus,
      protectedItem: {
        state: "unknown",
        reasonCode: "activation_locked",
      },
    });
    await expect(
      authority.acquireLease({
        purpose: "phase_b_state_machine_test",
        ttlMs: 30_000,
        generation: "generation-a",
        nonce: "nonce-a",
      }),
    ).resolves.toEqual(activationLocked);
    await expect(
      authority.consumeLease({
        handle: "handle-a",
        expectedPurpose: "phase_b_state_machine_test",
        nonce: "nonce-a",
      }),
    ).resolves.toEqual(activationLocked);
    await expect(
      authority.releaseLease({ handle: "handle-a" }),
    ).resolves.toEqual(activationLocked);
  });

  it("fails closed for extra exports, malformed results, loader errors, and native rejection", async () => {
    for (const loader of [
      () => nativeModule({ unexpected: vi.fn() }),
      () => nativeModule({ capability: vi.fn(() => ({ ...capability, extra: true })) }),
      () => {
        throw new Error("private native detail");
      },
    ]) {
      const authority = new NativeCredentialLeaseAuthority(loader);
      const snapshot = await authority.getSnapshot();
      expect(snapshot.capability).toMatchObject({
        eligibility: "unavailable",
        reasonCode: "native_module_unavailable",
      });
      expect(JSON.stringify(snapshot)).not.toContain("private native detail");
    }

    const malformedLegacy = new NativeCredentialLeaseAuthority(() =>
      nativeModule({
        legacyStatus: vi.fn(async () => ({
          state: "present",
          reasonCode: "legacy_metadata_present",
          secret: "must-not-cross",
        })),
        acquireLease: vi.fn(() => {
          throw new Error("native failure detail");
        }),
      }),
    );
    const snapshot = await malformedLegacy.getSnapshot();
    expect(snapshot.legacyStagedItem).toEqual({
      state: "unknown",
      reasonCode: "legacy_metadata_unavailable",
    });
    await expect(
      malformedLegacy.acquireLease({
        purpose: "phase_b_state_machine_test",
        ttlMs: 1,
        generation: "generation-a",
        nonce: "nonce-a",
      }),
    ).resolves.toEqual(activationLocked);
    expect(JSON.stringify(snapshot)).not.toContain("must-not-cross");
  });

  it("never invokes a Darwin loader on unsupported or deterministic-fake paths", async () => {
    const loader = vi.fn();
    const linux = createCredentialLeaseAuthority({
      platform: "linux",
      loader,
    });
    const fake = createCredentialLeaseAuthority({
      platform: "darwin",
      deterministicFake: true,
      loader,
    });

    await expect(linux.getSnapshot()).resolves.toMatchObject({
      capability: { reasonCode: "unsupported_platform" },
    });
    await expect(fake.getSnapshot()).resolves.toMatchObject({
      capability: { reasonCode: "native_module_unavailable" },
    });
    expect(loader).not.toHaveBeenCalled();
  });
});
