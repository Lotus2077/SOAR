import { describe, expect, it } from "vitest";

import {
  MAX_CREDENTIAL_LEASE_TTL_MS,
  NativeCredentialCapabilitySchema,
  UnavailableCredentialLeaseAuthority,
} from "../../src/main/credentials/credential-lease-authority";
import { FakeCredentialLeaseAuthority } from "../../src/main/credentials/fake-credential-lease-authority";

const acquireInput = {
  purpose: "phase_b_state_machine_test",
  ttlMs: 30_000,
  generation: "generation-1",
  nonce: "nonce-1",
} as const;

describe("credential lease authority", () => {
  it("binds every native eligibility state to one allow-listed reason", () => {
    expect(
      NativeCredentialCapabilitySchema.parse({
        schemaVersion: "soar-native-credential-lease-v1",
        flavor: "locked",
        eligibility: "ineligible",
        reasonCode: "signed_build_required",
      }),
    ).toMatchObject({ eligibility: "ineligible" });
    for (const capability of [
      {
        schemaVersion: "soar-native-credential-lease-v1",
        flavor: "locked",
        eligibility: "eligible",
        reasonCode: "signed_build_required",
      },
      {
        schemaVersion: "soar-native-credential-lease-v1",
        flavor: "locked",
        eligibility: "unavailable",
        reasonCode: "wrong_team_identifier",
      },
      {
        schemaVersion: "soar-native-credential-lease-v1",
        flavor: "production",
        eligibility: "eligible",
        reasonCode: "identity_policy_satisfied",
      },
      {
        schemaVersion: "soar-native-credential-lease-v1",
        flavor: "locked",
        eligibility: "eligible",
        reasonCode: "identity_policy_satisfied",
        diagnostic: "private-native-detail",
      },
    ]) {
      expect(NativeCredentialCapabilitySchema.safeParse(capability).success).toBe(
        false,
      );
    }
  });

  it("keeps unavailable hosts structurally activation-locked", async () => {
    const authority = new UnavailableCredentialLeaseAuthority(
      "native_module_unavailable",
    );
    await expect(authority.getSnapshot()).resolves.toMatchObject({
      capability: {
        flavor: "locked",
        eligibility: "unavailable",
        reasonCode: "native_module_unavailable",
      },
      legacyStagedItem: { state: "unknown" },
      protectedItem: { state: "unknown", reasonCode: "activation_locked" },
    });
    await expect(authority.acquireLease(acquireInput)).resolves.toEqual({
      state: "activation_locked",
      reasonCode: "activation_locked",
    });
    await expect(
      authority.consumeLease({
        handle: "lease-1",
        expectedPurpose: "phase_b_state_machine_test",
        nonce: "nonce-1",
      }),
    ).resolves.toEqual({
      state: "activation_locked",
      reasonCode: "activation_locked",
    });
    await expect(
      authority.releaseLease({ handle: "lease-1" }),
    ).resolves.toEqual({
      state: "activation_locked",
      reasonCode: "activation_locked",
    });
  });

  it("models one atomic, single-use, purpose-and-nonce-bound fake lease", async () => {
    let now = 100;
    const authority = new FakeCredentialLeaseAuthority({
      protectedGeneration: "generation-1",
      monotonicNow: () => now,
      handleFactory: () => "lease-1",
    });
    const acquired = await authority.acquireLease(acquireInput);
    expect(acquired).toEqual({
      state: "active",
      handle: "lease-1",
      expiresAtMonotonicMs: 30_100,
    });
    await expect(authority.acquireLease(acquireInput)).resolves.toEqual({
      state: "denied",
      reasonCode: "lease_already_active",
    });
    await expect(
      authority.consumeLease({
        handle: "lease-1",
        expectedPurpose: "phase_b_state_machine_test",
        nonce: "wrong-nonce",
      }),
    ).resolves.toEqual({ state: "denied", reasonCode: "nonce_mismatch" });
    await expect(
      authority.consumeLease({
        handle: "lease-1",
        expectedPurpose: "phase_b_state_machine_test",
        nonce: "nonce-1",
      }),
    ).resolves.toEqual({
      state: "consumed",
      resultCode: "phase_b_test_consumer_completed",
    });
    expect(authority.controlledMetadataForTest("lease-1")).toEqual({
      hasNonce: false,
      state: "consumed",
    });
    await expect(
      authority.consumeLease({
        handle: "lease-1",
        expectedPurpose: "phase_b_state_machine_test",
        nonce: "nonce-1",
      }),
    ).resolves.toEqual({
      state: "denied",
      reasonCode: "lease_not_active",
    });

    now = 101;
    await expect(authority.releaseLease({ handle: "lease-1" })).resolves.toEqual({
      state: "denied",
      reasonCode: "lease_not_active",
    });
  });

  it("uses monotonic expiry and invalidates an active lease on generation change", async () => {
    let now = 1_000;
    let nextHandle = 0;
    const authority = new FakeCredentialLeaseAuthority({
      protectedGeneration: "generation-1",
      monotonicNow: () => now,
      handleFactory: () => `lease-${++nextHandle}`,
    });
    await authority.acquireLease({ ...acquireInput, ttlMs: 10 });
    now = 1_010;
    await expect(
      authority.consumeLease({
        handle: "lease-1",
        expectedPurpose: "phase_b_state_machine_test",
        nonce: "nonce-1",
      }),
    ).resolves.toEqual({ state: "denied", reasonCode: "lease_expired" });
    expect(authority.lifecycleForTest("lease-1")).toBe("expired");

    now = 1_011;
    await authority.acquireLease({ ...acquireInput, ttlMs: 10 });
    authority.setProtectedGenerationForTest("generation-2");
    expect(authority.lifecycleForTest("lease-2")).toBe("abandoned");
    await expect(
      authority.consumeLease({
        handle: "lease-2",
        expectedPurpose: "phase_b_state_machine_test",
        nonce: "nonce-1",
      }),
    ).resolves.toEqual({
      state: "denied",
      reasonCode: "lease_not_active",
    });
  });

  it("never reuses a completed default handle or lets its replay reach a later lease", async () => {
    const authority = new FakeCredentialLeaseAuthority({
      protectedGeneration: "generation-1",
    });
    const first = await authority.acquireLease(acquireInput);
    expect(first).toMatchObject({ state: "active", handle: "fake-lease-1" });
    if (first.state !== "active") throw new Error("expected an active fake lease");
    await authority.releaseLease({ handle: first.handle });

    const second = await authority.acquireLease(acquireInput);
    expect(second).toMatchObject({ state: "active", handle: "fake-lease-2" });
    if (second.state !== "active") throw new Error("expected an active fake lease");
    await expect(
      authority.consumeLease({
        handle: first.handle,
        expectedPurpose: "phase_b_state_machine_test",
        nonce: "nonce-1",
      }),
    ).resolves.toEqual({ state: "denied", reasonCode: "lease_not_active" });
    await expect(
      authority.consumeLease({
        handle: second.handle,
        expectedPurpose: "phase_b_state_machine_test",
        nonce: "nonce-1",
      }),
    ).resolves.toMatchObject({ state: "consumed" });
  });

  it("fails closed when an injected handle factory collides", async () => {
    const authority = new FakeCredentialLeaseAuthority({
      protectedGeneration: "generation-1",
      handleFactory: () => "colliding-handle",
    });
    const acquired = await authority.acquireLease(acquireInput);
    if (acquired.state !== "active") throw new Error("expected an active fake lease");
    await authority.releaseLease({ handle: acquired.handle });
    await expect(authority.acquireLease(acquireInput)).rejects.toThrow(
      /handle collision/u,
    );
  });

  it("fails closed on invalid TTLs, purposes, handles, and generations", async () => {
    const authority = new FakeCredentialLeaseAuthority({
      protectedGeneration: "generation-1",
    });
    await expect(
      authority.acquireLease({
        ...acquireInput,
        ttlMs: MAX_CREDENTIAL_LEASE_TTL_MS + 1,
      }),
    ).rejects.toThrow();
    await expect(
      authority.acquireLease({
        ...acquireInput,
        purpose: "provider_validation" as never,
      }),
    ).rejects.toThrow();
    await expect(
      authority.releaseLease({ handle: "../escape" }),
    ).rejects.toThrow();
    expect(() => authority.setProtectedGenerationForTest(" private ")).toThrow();
  });
});
