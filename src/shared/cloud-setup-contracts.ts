import { z } from "zod";

/**
 * Provider-candidate metadata remains separate from credential authority. This
 * is not a ProviderDescriptor and cannot be registered or invoked.
 */
export const CLOUD_CANDIDATE_ID =
  "openrouter-deepseek-v4-flash-0731" as const;
export const CLOUD_CANDIDATE_PROVIDER_LABEL = "OpenRouter" as const;
export const CLOUD_CANDIDATE_MODEL_LABEL = "DeepSeek V4 Flash" as const;
export const CLOUD_CANDIDATE_ADAPTER_FAMILY = "openai-compatible" as const;
export const CLOUD_CANDIDATE_MODEL_SLUG =
  "deepseek/deepseek-v4-flash-0731" as const;

export const CloudCandidateMetadataSchema = z
  .object({
    candidateId: z.literal(CLOUD_CANDIDATE_ID),
    providerLabel: z.literal(CLOUD_CANDIDATE_PROVIDER_LABEL),
    modelLabel: z.literal(CLOUD_CANDIDATE_MODEL_LABEL),
    adapterFamily: z.literal(CLOUD_CANDIDATE_ADAPTER_FAMILY),
    intendedModelSlug: z.literal(CLOUD_CANDIDATE_MODEL_SLUG),
  })
  .strict();

export type CloudCandidateMetadata = z.infer<
  typeof CloudCandidateMetadataSchema
>;

export function cloudCandidateMetadata(): CloudCandidateMetadata {
  return Object.freeze({
    candidateId: CLOUD_CANDIDATE_ID,
    providerLabel: CLOUD_CANDIDATE_PROVIDER_LABEL,
    modelLabel: CLOUD_CANDIDATE_MODEL_LABEL,
    adapterFamily: CLOUD_CANDIDATE_ADAPTER_FAMILY,
    intendedModelSlug: CLOUD_CANDIDATE_MODEL_SLUG,
  });
}

export const HYBRID_LOCKED_REVIEW_REASON =
  "Cloud credential status does not enable Hybrid. Real cloud dispatch is locked in this build." as const;
export type HybridLockedReason = typeof HYBRID_LOCKED_REVIEW_REASON;

export const HYBRID_LOCKED_REVIEW_REACHABILITY =
  "This build performs no cloud-provider validation or dispatch." as const;
export type HybridLockedReachabilitySummary =
  typeof HYBRID_LOCKED_REVIEW_REACHABILITY;

export const CLOUD_CREDENTIAL_STATUS_SCHEMA_VERSION =
  "cloud-credential-status-v1" as const;
export const CREDENTIAL_AUTHORITY_CAPABILITY_VERSION =
  "credential-lease-authority-v1" as const;
export const CREDENTIAL_ACTIVATION_PHASE = "phase_b_locked" as const;

export const CREDENTIAL_BUILD_STATES = [
  "unsigned_or_adhoc",
  "ineligible",
  "eligibility_unknown",
  "eligible",
] as const;
export const CredentialBuildStateSchema = z.enum(CREDENTIAL_BUILD_STATES);
export type CredentialBuildState = z.infer<typeof CredentialBuildStateSchema>;

export const CREDENTIAL_INELIGIBILITY_REASON_CODES = [
  "wrong_bundle_identifier",
  "wrong_team_identifier",
  "hardened_runtime_missing",
  "library_validation_disabled",
  "forbidden_entitlement",
  "profile_authorization_missing",
  "module_identity_mismatch",
  "module_path_mismatch",
] as const;
export const CredentialIneligibilityReasonCodeSchema = z.enum(
  CREDENTIAL_INELIGIBILITY_REASON_CODES,
);

export const CREDENTIAL_ELIGIBILITY_UNKNOWN_REASON_CODES = [
  "unsupported_platform",
  "native_module_unavailable",
  "identity_check_unavailable",
] as const;
export const CredentialEligibilityUnknownReasonCodeSchema = z.enum(
  CREDENTIAL_ELIGIBILITY_UNKNOWN_REASON_CODES,
);

export const CredentialBuildEligibilitySchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("unsigned_or_adhoc"),
      reasonCode: z.literal("signed_build_required"),
    })
    .strict(),
  z
    .object({
      state: z.literal("ineligible"),
      reasonCode: CredentialIneligibilityReasonCodeSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal("eligibility_unknown"),
      reasonCode: CredentialEligibilityUnknownReasonCodeSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal("eligible"),
      reasonCode: z.literal("identity_policy_satisfied"),
    })
    .strict(),
]);
export type CredentialBuildEligibility = z.infer<
  typeof CredentialBuildEligibilitySchema
>;

export const LEGACY_STAGED_ITEM_STATES = [
  "present",
  "not_observed",
  "unknown",
] as const;
export const LegacyStagedItemStateSchema = z.enum(
  LEGACY_STAGED_ITEM_STATES,
);
export type LegacyStagedItemState = z.infer<
  typeof LegacyStagedItemStateSchema
>;

export const LegacyStagedItemStatusSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("present"),
      reasonCode: z.literal("legacy_metadata_present"),
    })
    .strict(),
  z
    .object({
      state: z.literal("not_observed"),
      reasonCode: z.literal("legacy_metadata_not_observed"),
    })
    .strict(),
  z
    .object({
      state: z.literal("unknown"),
      reasonCode: z.enum([
        "keychain_locked",
        "keychain_access_denied",
        "legacy_metadata_unavailable",
      ]),
    })
    .strict(),
]);
export type LegacyStagedItemStatus = z.infer<
  typeof LegacyStagedItemStatusSchema
>;

export const ProtectedCredentialItemStatusSchema = z.discriminatedUnion(
  "state",
  [
    z
      .object({
        state: z.literal("present"),
        reasonCode: z.literal("protected_metadata_present"),
      })
      .strict(),
    z
      .object({
        state: z.literal("not_observed"),
        reasonCode: z.literal("protected_metadata_not_observed"),
      })
      .strict(),
    z
      .object({
        state: z.literal("unknown"),
        reasonCode: z.enum([
          "activation_locked",
          "identity_unavailable",
          "protected_metadata_unavailable",
        ]),
      })
      .strict(),
  ],
);
export type ProtectedCredentialItemStatus = z.infer<
  typeof ProtectedCredentialItemStatusSchema
>;

export const CREDENTIAL_OPERATION_KINDS = [
  "store_protected",
  "replace_protected",
  "remove_protected",
  "remove_legacy_staged",
] as const;
export const CredentialOperationKindSchema = z.enum(
  CREDENTIAL_OPERATION_KINDS,
);
export type CredentialOperationKind = z.infer<
  typeof CredentialOperationKindSchema
>;

export const CREDENTIAL_OPERATION_RECOVERY_CODES = [
  "await_native_completion",
  "manual_recovery_required",
] as const;
export const CredentialOperationRecoveryCodeSchema = z.enum(
  CREDENTIAL_OPERATION_RECOVERY_CODES,
);
export type CredentialOperationRecoveryCode = z.infer<
  typeof CredentialOperationRecoveryCodeSchema
>;

export const CredentialOperationProjectionSchema = z.discriminatedUnion(
  "state",
  [
    z.object({ state: z.literal("none") }).strict(),
    z
      .object({
        state: z.literal("pending"),
        kind: CredentialOperationKindSchema,
      })
      .strict(),
    z
      .object({
        state: z.literal("confirmed"),
        kind: CredentialOperationKindSchema,
      })
      .strict(),
    z
      .object({
        state: z.literal("outcome_unknown"),
        kind: CredentialOperationKindSchema,
        recoveryCode: CredentialOperationRecoveryCodeSchema,
      })
      .strict(),
    z
      .object({
        state: z.literal("superseded"),
        kind: CredentialOperationKindSchema,
      })
      .strict(),
  ],
);
export type CredentialOperationProjection = z.infer<
  typeof CredentialOperationProjectionSchema
>;

export const CLOUD_DISPATCH_LOCK_REASON_CODE =
  "pr6b1_phase_b_locked" as const;
export const CLOUD_DISPATCH_LOCK_EXPLANATION =
  "Real cloud dispatch remains locked until the later credential, provider, egress, and budget gates pass." as const;

export const CloudCredentialStatusSchema = z
  .object({
    schemaVersion: z.literal(CLOUD_CREDENTIAL_STATUS_SCHEMA_VERSION),
    capabilityVersion: z.literal(CREDENTIAL_AUTHORITY_CAPABILITY_VERSION),
    activationPhase: z.literal(CREDENTIAL_ACTIVATION_PHASE),
    build: CredentialBuildEligibilitySchema,
    legacyStagedItem: LegacyStagedItemStatusSchema,
    protectedItem: ProtectedCredentialItemStatusSchema,
    providerCheck: z
      .object({
        providerLabel: z.literal(CLOUD_CANDIDATE_PROVIDER_LABEL),
        state: z.literal("not_run"),
      })
      .strict(),
    dispatch: z
      .object({
        state: z.literal("locked"),
        reasonCode: z.literal(CLOUD_DISPATCH_LOCK_REASON_CODE),
        explanation: z.literal(CLOUD_DISPATCH_LOCK_EXPLANATION),
      })
      .strict(),
    providerContact: z
      .object({
        providerLabel: z.literal(CLOUD_CANDIDATE_PROVIDER_LABEL),
        state: z.literal("not_contacted"),
        scope: z.literal("credential_operation"),
      })
      .strict(),
    latestOperation: CredentialOperationProjectionSchema,
  })
  .strict();

export type CloudCredentialStatus = z.infer<
  typeof CloudCredentialStatusSchema
>;

export function cloudDispatchLock(): CloudCredentialStatus["dispatch"] {
  return Object.freeze({
    state: "locked",
    reasonCode: CLOUD_DISPATCH_LOCK_REASON_CODE,
    explanation: CLOUD_DISPATCH_LOCK_EXPLANATION,
  });
}

export function cloudProviderCheckNotRun(): CloudCredentialStatus["providerCheck"] {
  return Object.freeze({
    providerLabel: CLOUD_CANDIDATE_PROVIDER_LABEL,
    state: "not_run",
  });
}

export function cloudProviderNotContacted(): CloudCredentialStatus["providerContact"] {
  return Object.freeze({
    providerLabel: CLOUD_CANDIDATE_PROVIDER_LABEL,
    state: "not_contacted",
    scope: "credential_operation",
  });
}
