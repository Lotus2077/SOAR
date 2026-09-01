import { z } from "zod";

import {
  LegacyStagedItemStatusSchema,
  ProtectedCredentialItemStatusSchema,
  type LegacyStagedItemStatus,
  type ProtectedCredentialItemStatus,
} from "../../shared/cloud-setup-contracts";

export const NATIVE_CREDENTIAL_LEASE_SCHEMA_VERSION =
  "soar-native-credential-lease-v1" as const;
export const MAX_CREDENTIAL_LEASE_TTL_MS = 30_000;

export const NATIVE_CREDENTIAL_INELIGIBILITY_REASON_CODES = [
  "signed_build_required",
  "wrong_bundle_identifier",
  "wrong_team_identifier",
  "hardened_runtime_missing",
  "library_validation_disabled",
  "forbidden_entitlement",
  "profile_authorization_missing",
  "module_identity_mismatch",
  "module_path_mismatch",
] as const;
export const NativeCredentialIneligibilityReasonCodeSchema = z.enum(
  NATIVE_CREDENTIAL_INELIGIBILITY_REASON_CODES,
);

export const NATIVE_CREDENTIAL_UNAVAILABLE_REASON_CODES = [
  "unsupported_platform",
  "native_module_unavailable",
  "identity_check_unavailable",
] as const;
export const NativeCredentialUnavailableReasonCodeSchema = z.enum(
  NATIVE_CREDENTIAL_UNAVAILABLE_REASON_CODES,
);

export const NativeCredentialCapabilitySchema = z.discriminatedUnion(
  "eligibility",
  [
    z
      .object({
        schemaVersion: z.literal(NATIVE_CREDENTIAL_LEASE_SCHEMA_VERSION),
        flavor: z.literal("locked"),
        eligibility: z.literal("eligible"),
        reasonCode: z.literal("identity_policy_satisfied"),
      })
      .strict(),
    z
      .object({
        schemaVersion: z.literal(NATIVE_CREDENTIAL_LEASE_SCHEMA_VERSION),
        flavor: z.literal("locked"),
        eligibility: z.literal("ineligible"),
        reasonCode: NativeCredentialIneligibilityReasonCodeSchema,
      })
      .strict(),
    z
      .object({
        schemaVersion: z.literal(NATIVE_CREDENTIAL_LEASE_SCHEMA_VERSION),
        flavor: z.literal("locked"),
        eligibility: z.literal("unavailable"),
        reasonCode: NativeCredentialUnavailableReasonCodeSchema,
      })
      .strict(),
  ],
);
export type NativeCredentialCapability = z.infer<
  typeof NativeCredentialCapabilitySchema
>;

export const NativeLegacyCredentialStatusSchema =
  LegacyStagedItemStatusSchema;
export type NativeLegacyCredentialStatus = LegacyStagedItemStatus;

export const ActivationLockedResultSchema = z
  .object({
    state: z.literal("activation_locked"),
    reasonCode: z.literal("activation_locked"),
  })
  .strict();
export type ActivationLockedResult = z.infer<
  typeof ActivationLockedResultSchema
>;

const boundedNativeId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);

export const CredentialLeasePurposeSchema = z.literal(
  "phase_b_state_machine_test",
);
export type CredentialLeasePurpose = z.infer<
  typeof CredentialLeasePurposeSchema
>;

export const AcquireCredentialLeaseInputSchema = z
  .object({
    purpose: CredentialLeasePurposeSchema,
    ttlMs: z.number().int().positive().max(MAX_CREDENTIAL_LEASE_TTL_MS),
    generation: boundedNativeId,
    nonce: boundedNativeId,
  })
  .strict();
export type AcquireCredentialLeaseInput = z.infer<
  typeof AcquireCredentialLeaseInputSchema
>;

export const AcquireCredentialLeaseResultSchema = z.discriminatedUnion(
  "state",
  [
    ActivationLockedResultSchema,
    z
      .object({
        state: z.literal("denied"),
        reasonCode: z.enum([
          "protected_item_unavailable",
          "generation_mismatch",
          "lease_already_active",
        ]),
      })
      .strict(),
    z
      .object({
        state: z.literal("active"),
        handle: boundedNativeId,
        expiresAtMonotonicMs: z.number().finite().nonnegative(),
      })
      .strict(),
  ],
);
export type AcquireCredentialLeaseResult = z.infer<
  typeof AcquireCredentialLeaseResultSchema
>;

export const ConsumeCredentialLeaseInputSchema = z
  .object({
    handle: boundedNativeId,
    expectedPurpose: CredentialLeasePurposeSchema,
    nonce: boundedNativeId,
  })
  .strict();
export type ConsumeCredentialLeaseInput = z.infer<
  typeof ConsumeCredentialLeaseInputSchema
>;

export const ConsumeCredentialLeaseResultSchema = z.discriminatedUnion(
  "state",
  [
    ActivationLockedResultSchema,
    z
      .object({
        state: z.literal("denied"),
        reasonCode: z.enum([
          "unknown_lease",
          "lease_expired",
          "purpose_mismatch",
          "nonce_mismatch",
          "generation_mismatch",
          "lease_not_active",
        ]),
      })
      .strict(),
    z
      .object({
        state: z.literal("consumed"),
        resultCode: z.literal("phase_b_test_consumer_completed"),
      })
      .strict(),
  ],
);
export type ConsumeCredentialLeaseResult = z.infer<
  typeof ConsumeCredentialLeaseResultSchema
>;

export const ReleaseCredentialLeaseInputSchema = z
  .object({ handle: boundedNativeId })
  .strict();
export type ReleaseCredentialLeaseInput = z.infer<
  typeof ReleaseCredentialLeaseInputSchema
>;

export const ReleaseCredentialLeaseResultSchema = z.discriminatedUnion(
  "state",
  [
    ActivationLockedResultSchema,
    z
      .object({
        state: z.literal("released"),
      })
      .strict(),
    z
      .object({
        state: z.literal("denied"),
        reasonCode: z.enum(["unknown_lease", "lease_not_active"]),
      })
      .strict(),
  ],
);
export type ReleaseCredentialLeaseResult = z.infer<
  typeof ReleaseCredentialLeaseResultSchema
>;

export interface CredentialAuthoritySnapshot {
  capability: NativeCredentialCapability;
  legacyStagedItem: LegacyStagedItemStatus;
  protectedItem: ProtectedCredentialItemStatus;
}

/** Main-process-only capability. No secret, authorization header, or consumer exists here. */
export interface CredentialLeaseAuthority {
  getSnapshot(): Promise<CredentialAuthoritySnapshot>;
  acquireLease(
    input: AcquireCredentialLeaseInput,
  ): Promise<AcquireCredentialLeaseResult>;
  consumeLease(
    input: ConsumeCredentialLeaseInput,
  ): Promise<ConsumeCredentialLeaseResult>;
  releaseLease(
    input: ReleaseCredentialLeaseInput,
  ): Promise<ReleaseCredentialLeaseResult>;
}

export const ACTIVATION_LOCKED_RESULT: ActivationLockedResult = Object.freeze({
  state: "activation_locked",
  reasonCode: "activation_locked",
});

/**
 * Structural fallback for Linux, missing native modules, and other unavailable
 * hosts. It has no locator and cannot perform any Keychain or lease operation.
 */
export class UnavailableCredentialLeaseAuthority
  implements CredentialLeaseAuthority
{
  private readonly capability: NativeCredentialCapability;

  constructor(
    reasonCode: z.infer<typeof NativeCredentialUnavailableReasonCodeSchema> =
      "native_module_unavailable",
  ) {
    this.capability = NativeCredentialCapabilitySchema.parse({
      schemaVersion: NATIVE_CREDENTIAL_LEASE_SCHEMA_VERSION,
      flavor: "locked",
      eligibility: "unavailable",
      reasonCode,
    });
  }

  async getSnapshot(): Promise<CredentialAuthoritySnapshot> {
    return Object.freeze({
      capability: this.capability,
      legacyStagedItem: LegacyStagedItemStatusSchema.parse({
        state: "unknown",
        reasonCode: "legacy_metadata_unavailable",
      }),
      protectedItem: ProtectedCredentialItemStatusSchema.parse({
        state: "unknown",
        reasonCode: "activation_locked",
      }),
    });
  }

  async acquireLease(
    input: AcquireCredentialLeaseInput,
  ): Promise<AcquireCredentialLeaseResult> {
    AcquireCredentialLeaseInputSchema.parse(input);
    return ACTIVATION_LOCKED_RESULT;
  }

  async consumeLease(
    input: ConsumeCredentialLeaseInput,
  ): Promise<ConsumeCredentialLeaseResult> {
    ConsumeCredentialLeaseInputSchema.parse(input);
    return ACTIVATION_LOCKED_RESULT;
  }

  async releaseLease(
    input: ReleaseCredentialLeaseInput,
  ): Promise<ReleaseCredentialLeaseResult> {
    ReleaseCredentialLeaseInputSchema.parse(input);
    return ACTIVATION_LOCKED_RESULT;
  }
}
