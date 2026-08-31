import { z } from "zod";

export const CLOUD_SETUP_SCHEMA_VERSION = "cloud-setup-status-v1" as const;
export const CLOUD_CANDIDATE_ID =
  "openrouter-deepseek-v4-flash-0731" as const;
export const CLOUD_CANDIDATE_PROVIDER_LABEL = "OpenRouter" as const;
export const CLOUD_CANDIDATE_MODEL_LABEL = "DeepSeek V4 Flash" as const;
export const CLOUD_CANDIDATE_ADAPTER_FAMILY = "openai-compatible" as const;
export const CLOUD_CANDIDATE_MODEL_SLUG =
  "deepseek/deepseek-v4-flash-0731" as const;

export const CLOUD_SETUP_STATES = [
  "not_configured",
  "stored_unvalidated",
  "local_storage_error",
] as const;

export const CloudSetupStateSchema = z.enum(CLOUD_SETUP_STATES);
export type CloudSetupState = z.infer<typeof CloudSetupStateSchema>;

export const HYBRID_LOCKED_REVIEW_REASON =
  "Cloud setup does not enable Hybrid. Hybrid dispatch is locked in this build." as const;
export type HybridLockedReason = typeof HYBRID_LOCKED_REVIEW_REASON;

export const HYBRID_LOCKED_REVIEW_REACHABILITY =
  "This build performs no cloud-provider validation or dispatch." as const;
export type HybridLockedReachabilitySummary =
  typeof HYBRID_LOCKED_REVIEW_REACHABILITY;

export const CLOUD_SETUP_ERROR_CODES = [
  "unsupported_platform",
  "invalid_credential",
  "operation_in_progress",
  "keychain_unavailable",
  "keychain_timeout",
  "keychain_output_limit",
  "keychain_status_failed",
  "keychain_write_failed",
  "keychain_replace_failed",
  "keychain_delete_failed",
] as const;

export const CloudSetupErrorCodeSchema = z.enum(CLOUD_SETUP_ERROR_CODES);
export type CloudSetupErrorCode = z.infer<typeof CloudSetupErrorCodeSchema>;

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

/** Renderer projection: labels only, with no candidate or model authority. */
export const CloudCandidateViewSchema = z
  .object({
    providerLabel: z.literal(CLOUD_CANDIDATE_PROVIDER_LABEL),
    modelLabel: z.literal(CLOUD_CANDIDATE_MODEL_LABEL),
  })
  .strict();

export type CloudCandidateView = z.infer<typeof CloudCandidateViewSchema>;

export const CLOUD_DISPATCH_LOCK_REASON_CODE =
  "pr6a_dispatch_locked" as const;
export const CLOUD_DISPATCH_LOCK_EXPLANATION =
  "This build cannot validate a cloud credential or dispatch a cloud request." as const;

export const CloudDispatchLockSchema = z
  .object({
    state: z.literal("locked"),
    reasonCode: z.literal(CLOUD_DISPATCH_LOCK_REASON_CODE),
    explanation: z.literal(CLOUD_DISPATCH_LOCK_EXPLANATION),
  })
  .strict();

export type CloudDispatchLock = z.infer<typeof CloudDispatchLockSchema>;

const cloudSetupStatusBaseShape = {
  schemaVersion: z.literal(CLOUD_SETUP_SCHEMA_VERSION),
  candidate: CloudCandidateViewSchema,
  dispatch: CloudDispatchLockSchema,
} as const;

export const CloudSetupStatusSchema = z.discriminatedUnion("state", [
  z
    .object({
      ...cloudSetupStatusBaseShape,
      state: z.literal("not_configured"),
    })
    .strict(),
  z
    .object({
      ...cloudSetupStatusBaseShape,
      state: z.literal("stored_unvalidated"),
    })
    .strict(),
  z
    .object({
      ...cloudSetupStatusBaseShape,
      state: z.literal("local_storage_error"),
      errorCode: CloudSetupErrorCodeSchema,
    })
    .strict(),
]);

export type CloudSetupStatus = z.infer<typeof CloudSetupStatusSchema>;

export const CLOUD_CREDENTIAL_MAX_BYTES = 16 * 1024;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export const SaveCloudCredentialInputSchema = z
  .object({
    credential: z
      .string()
      .min(1)
      .max(CLOUD_CREDENTIAL_MAX_BYTES)
      .refine((value) => value.trim() === value, {
        message: "Credential must not have leading or trailing whitespace.",
      })
      .refine(
        (value) =>
          !value.includes("\0") &&
          !value.includes("\r") &&
          !value.includes("\n"),
        { message: "Credential must be one line and contain no NUL bytes." },
      )
      .refine((value) => utf8ByteLength(value) <= CLOUD_CREDENTIAL_MAX_BYTES, {
        message: "Credential exceeds the byte limit.",
      }),
  })
  .strict();

export type SaveCloudCredentialInput = z.input<
  typeof SaveCloudCredentialInputSchema
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

export function cloudCandidateView(): CloudCandidateView {
  return Object.freeze({
    providerLabel: CLOUD_CANDIDATE_PROVIDER_LABEL,
    modelLabel: CLOUD_CANDIDATE_MODEL_LABEL,
  });
}

export function cloudDispatchLock(): CloudDispatchLock {
  return Object.freeze({
    state: "locked",
    reasonCode: CLOUD_DISPATCH_LOCK_REASON_CODE,
    explanation: CLOUD_DISPATCH_LOCK_EXPLANATION,
  });
}
