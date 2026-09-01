import { describe, expect, it } from "vitest";

import {
  CloudCredentialStatusSchema,
  cloudDispatchLock,
  cloudProviderCheckNotRun,
  cloudProviderNotContacted,
  type CloudCredentialStatus,
} from "../../src/shared/cloud-setup-contracts";

function lockedStatus(
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
    protectedItem: { state: "unknown", reasonCode: "activation_locked" },
    providerCheck: cloudProviderCheckNotRun(),
    dispatch: cloudDispatchLock(),
    providerContact: cloudProviderNotContacted(),
    latestOperation: { state: "none" },
    ...overrides,
  };
}

describe("cloud credential status contracts", () => {
  it("accepts only bounded, status-only phase-B projections", () => {
    expect(CloudCredentialStatusSchema.parse(lockedStatus())).toEqual(
      lockedStatus(),
    );
    expect(
      CloudCredentialStatusSchema.parse(
        lockedStatus({
          build: {
            state: "eligible",
            reasonCode: "identity_policy_satisfied",
          },
          legacyStagedItem: {
            state: "present",
            reasonCode: "legacy_metadata_present",
          },
          latestOperation: {
            state: "outcome_unknown",
            kind: "replace_protected",
            recoveryCode: "manual_recovery_required",
          },
        }),
      ),
    ).toMatchObject({
      activationPhase: "phase_b_locked",
      providerCheck: { state: "not_run" },
      dispatch: { state: "locked" },
      providerContact: { state: "not_contacted" },
    });
  });

  it("rejects secret-shaped, provider-authority, locator, and unknown fields", () => {
    for (const projection of [
      { ...lockedStatus(), credential: "synthetic-secret" },
      { ...lockedStatus(), authorization: "Bearer synthetic-secret" },
      { ...lockedStatus(), endpoint: "https://example.invalid/v1" },
      { ...lockedStatus(), leaseHandle: "opaque-handle" },
      { ...lockedStatus(), requestedGeneration: "generation-1" },
      { ...lockedStatus(), operationId: "operation-1" },
      {
        ...lockedStatus(),
        providerCheck: {
          ...cloudProviderCheckNotRun(),
          model: "forged-model",
        },
      },
      {
        ...lockedStatus(),
        dispatch: { ...cloudDispatchLock(), state: "enabled" },
      },
      {
        ...lockedStatus(),
        providerContact: {
          ...cloudProviderNotContacted(),
          state: "contacted",
        },
      },
      {
        ...lockedStatus(),
        latestOperation: {
          state: "pending",
          kind: "store_protected",
          credential: "synthetic-secret",
        },
      },
    ]) {
      expect(CloudCredentialStatusSchema.safeParse(projection).success).toBe(
        false,
      );
    }
  });

  it("binds every build and item state to an allow-listed reason", () => {
    for (const projection of [
      lockedStatus({
        build: {
          state: "eligible",
          reasonCode: "signed_build_required",
        } as never,
      }),
      lockedStatus({
        legacyStagedItem: {
          state: "present",
          reasonCode: "legacy_metadata_not_observed",
        } as never,
      }),
      lockedStatus({
        protectedItem: {
          state: "not_observed",
          reasonCode: "activation_locked",
        } as never,
      }),
      lockedStatus({
        latestOperation: {
          state: "outcome_unknown",
          kind: "remove_protected",
        } as never,
      }),
    ]) {
      expect(CloudCredentialStatusSchema.safeParse(projection).success).toBe(
        false,
      );
    }
  });
});
